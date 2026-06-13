//! The realtime REPLAY normalization hot path (Sprint 98): turn an
//! operator-supplied replay events document into normalized candidate
//! observations, mirroring `packages/realtime/src/replay.ts` field by field.
//!
//! Boundaries, deliberately narrow:
//!   - Input arrives over BOUNDED stdin as one JSON document — the engine
//!     still reads no clock, no environment, no filesystem, and no network.
//!   - Replay data is labeled replay on every observation and can never be
//!     presented as live market data.
//!   - A malformed document is REFUSED up front (exit 2) — a replay file is
//!     operator input, not a feed; a bad file is a mistake to surface, not a
//!     provider outage to tolerate.
//!   - TypeScript validates every observation in this artifact and refuses
//!     the whole document on any mismatch; downstream consumers only ever see
//!     the existing `realtime.candidates.snapshot.v1` built by TypeScript.

use serde::Serialize;
use serde_json::{Number, Value};

use crate::ipc::IPC_VERSION;
use crate::label_safety::label_is_redaction_safe;
use crate::mint::parse_mint;
use crate::schema::ENGINE_REALTIME_OBSERVATIONS_SCHEMA_VERSION;
use crate::status::{check_created_at, CreatedAtError};

/// Verbatim mirror of `REPLAY_PROVIDER_ID` in packages/realtime.
pub const REPLAY_PROVIDER_ID: &str = "replay-file";
/// Verbatim mirror of the replay adapter's endpoint label.
pub const REPLAY_ENDPOINT_HOST: &str = "local-replay-file";
/// Verbatim mirror of the replay adapter's `fetchedAt` label.
pub const REPLAY_FETCHED_AT: &str = "replay";
/// Hard ceiling on replay events, mirroring packages/realtime/src/replay.ts.
pub const MAX_REPLAY_EVENTS: usize = 500;

/// Verbatim mirror of `CANDIDATE_OBSERVATION_CAVEATS` in packages/realtime —
/// the TypeScript validator pins these byte for byte.
const OBSERVATION_CAVEATS: [&str; 3] = [
    "A watched candidate is an OBSERVATION — never an order, never a trade, never execution.",
    "Market figures are provider-reported HINTS and are unverified; inspect and risk-check before any paper decision.",
    "Watching a feed can never trigger an order: this layer has no wallet, no keys, no signing, no sending.",
];

/// Verbatim mirror of `REPLAY_CAVEAT` in packages/realtime.
const REPLAY_CAVEAT: &str =
    "REPLAY data: these observations were replayed from a local file and are NOT live market data.";

const BANNER: &str = "RUST ENGINE REALTIME REPLAY — candidate observations normalized from an operator-supplied replay file; read-only, deterministic, and validated by TypeScript before anything reads them.";

const REPORT_CAVEATS: [&str; 3] = [
    "Replay normalization only: every observation comes from an operator-supplied replay file and is NEVER live market data.",
    "TypeScript validates every observation in this artifact and remains the authority; the engine cannot sign, send, or touch the network by construction.",
    "createdAt is supplied by the orchestrator (--created-at) so identical invocations stay byte-identical; the engine reads no clock.",
];

/// One normalized observation — the field set mirrors the TypeScript
/// `CandidateObservation` exactly (the validator treats it as CLOSED).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReplayObservation {
    pub candidate_id: String,
    pub mint: String,
    pub symbol: Option<String>,
    pub name: Option<String>,
    pub source_provider_id: &'static str,
    pub source_kind: &'static str,
    pub observed_at_label: String,
    pub launchpad_label: Option<String>,
    pub liquidity_usd_hint: Option<Number>,
    pub market_cap_usd_hint: Option<Number>,
    pub holder_count_hint: Option<Number>,
    pub caveats: Vec<&'static str>,
}

/// `engine.realtime.observations.report.v1`. Field order IS the serialized
/// order; the TypeScript validator treats the key set as CLOSED.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeObservationsReport {
    pub schema_version: &'static str,
    pub banner: &'static str,
    pub engine_name: &'static str,
    pub engine_version: &'static str,
    pub ipc_version: &'static str,
    pub provider_id: &'static str,
    pub source_kind: &'static str,
    pub endpoint_host: &'static str,
    pub fetched_at: &'static str,
    pub status: &'static str,
    pub status_detail: Option<String>,
    pub event_count: usize,
    pub observation_count: usize,
    pub duplicate_mint_count: usize,
    pub observations: Vec<ReplayObservation>,
    pub created_at: Option<String>,
    pub caveats: Vec<&'static str>,
    pub never_sends: bool,
    pub phase7_live_trading_ready: bool,
}

/// Why a replay document was refused (exit 2; nothing is emitted). Messages
/// carry indexes and lengths, never input values.
#[derive(Debug, PartialEq, Eq)]
pub enum NormalizeError {
    InputNotJson,
    NotAnObject,
    EventsMissing,
    TooManyEvents(usize),
    EventNotAnObject(usize),
    BadMint(usize, String),
    BadCreatedAt(CreatedAtError),
}

impl std::fmt::Display for NormalizeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            NormalizeError::InputNotJson => write!(f, "stdin is not valid JSON"),
            NormalizeError::NotAnObject => {
                write!(f, "replay file must be a JSON object with an events array")
            }
            NormalizeError::EventsMissing => write!(f, "replay file must carry an events array"),
            NormalizeError::TooManyEvents(n) => write!(
                f,
                "replay file carries {n} events - more than {MAX_REPLAY_EVENTS}; bound it"
            ),
            NormalizeError::EventNotAnObject(i) => {
                write!(f, "replay events[{i}] must be an object")
            }
            NormalizeError::BadMint(i, reason) => write!(f, "replay events[{i}].mint: {reason}"),
            NormalizeError::BadCreatedAt(err) => write!(f, "{err}"),
        }
    }
}

/// Deterministic candidate id from a validated mint — verbatim mirror of
/// `candidateIdForMint` in packages/realtime.
fn candidate_id_for_mint(mint: &str) -> String {
    let prefix: String = mint.chars().take(8).collect();
    format!("rt-{}", prefix.to_lowercase())
}

/// Mirror of the replay adapter's `boundedLabel`: trim, cap at `max` UTF-16
/// code units, refuse empty, drop anything secret-shaped (TS redacts; we drop).
fn bounded_label(value: Option<&Value>, max: usize) -> Option<String> {
    let raw = value?.as_str()?;
    let trimmed = raw.trim();
    let mut capped = String::new();
    let mut units = 0usize;
    for ch in trimmed.chars() {
        let width = ch.len_utf16();
        if units + width > max {
            break;
        }
        units += width;
        capped.push(ch);
    }
    if capped.is_empty() || !label_is_redaction_safe(&capped) {
        return None;
    }
    Some(capped)
}

/// Mirror of `finiteNumber`: a JSON number >= 0 is kept VERBATIM (no float
/// round-trip); anything else is null.
fn hint_number(value: Option<&Value>) -> Option<Number> {
    match value? {
        Value::Number(n) if n.as_f64().is_some_and(|f| f >= 0.0) => Some(n.clone()),
        _ => None,
    }
}

/// Normalize one replay events document (raw JSON text from bounded stdin)
/// into the observations artifact. Pure: same input, same report, always.
pub fn normalize_replay_events(
    input: &str,
    created_at: Option<&str>,
) -> Result<RealtimeObservationsReport, NormalizeError> {
    if let Some(value) = created_at {
        check_created_at(value).map_err(NormalizeError::BadCreatedAt)?;
    }
    let document: Value = serde_json::from_str(input).map_err(|_| NormalizeError::InputNotJson)?;
    let object = document.as_object().ok_or(NormalizeError::NotAnObject)?;
    let events = object
        .get("events")
        .and_then(Value::as_array)
        .ok_or(NormalizeError::EventsMissing)?;
    if events.len() > MAX_REPLAY_EVENTS {
        return Err(NormalizeError::TooManyEvents(events.len()));
    }

    let mut observations: Vec<ReplayObservation> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for (index, raw) in events.iter().enumerate() {
        let event = raw
            .as_object()
            .ok_or(NormalizeError::EventNotAnObject(index))?;
        let mint = match event.get("mint") {
            Some(Value::String(s)) => {
                parse_mint(s).map_err(|e| NormalizeError::BadMint(index, e.to_string()))?
            }
            _ => {
                return Err(NormalizeError::BadMint(
                    index,
                    "mint address must be a string".to_string(),
                ))
            }
        };
        if seen.contains(&mint) {
            continue;
        }
        seen.push(mint.clone());
        let mut caveats: Vec<&'static str> = OBSERVATION_CAVEATS.to_vec();
        caveats.push(REPLAY_CAVEAT);
        observations.push(ReplayObservation {
            candidate_id: candidate_id_for_mint(&mint),
            mint,
            symbol: bounded_label(event.get("symbol"), 16),
            name: bounded_label(event.get("name"), 64),
            source_provider_id: REPLAY_PROVIDER_ID,
            source_kind: "replay",
            observed_at_label: bounded_label(event.get("observedAtLabel"), 64)
                .unwrap_or_else(|| "replay-event".to_string()),
            launchpad_label: bounded_label(event.get("launchpadLabel"), 32),
            liquidity_usd_hint: hint_number(event.get("liquidityUsdHint")),
            market_cap_usd_hint: hint_number(event.get("marketCapUsdHint")),
            holder_count_hint: hint_number(event.get("holderCountHint")),
            caveats,
        });
    }

    Ok(RealtimeObservationsReport {
        schema_version: ENGINE_REALTIME_OBSERVATIONS_SCHEMA_VERSION,
        banner: BANNER,
        engine_name: "solmaker-engine",
        engine_version: env!("CARGO_PKG_VERSION"),
        ipc_version: IPC_VERSION,
        provider_id: REPLAY_PROVIDER_ID,
        source_kind: "replay",
        endpoint_host: REPLAY_ENDPOINT_HOST,
        fetched_at: REPLAY_FETCHED_AT,
        status: "observed",
        status_detail: None,
        event_count: events.len(),
        observation_count: observations.len(),
        duplicate_mint_count: events.len() - observations.len(),
        observations,
        created_at: created_at.map(str::to_string),
        caveats: REPORT_CAVEATS.to_vec(),
        never_sends: true,
        phase7_live_trading_ready: false,
    })
}

/// Serialize exactly as the IPC contract requires: pretty JSON, trailing
/// newline, nothing else.
pub fn to_ipc_json(report: &RealtimeObservationsReport) -> String {
    let mut json = serde_json::to_string_pretty(report).expect("realtime report serializes");
    json.push('\n');
    json
}

/// Human-readable rendering for a terminal (used when --json is absent).
pub fn to_text(report: &RealtimeObservationsReport) -> String {
    let mut lines = vec![
        "RUST ENGINE REALTIME REPLAY".to_string(),
        format!(
            "provider:     {} ({}; {})",
            report.provider_id, report.source_kind, report.endpoint_host
        ),
        format!(
            "events:       {} ({} observations, {} duplicate mints skipped)",
            report.event_count, report.observation_count, report.duplicate_mint_count
        ),
    ];
    for obs in &report.observations {
        let symbol = obs.symbol.as_deref().unwrap_or("?");
        lines.push(format!(
            "  - {} {} ({})",
            obs.candidate_id, symbol, obs.mint
        ));
    }
    for caveat in &report.caveats {
        lines.push(format!("CAVEAT: {caveat}"));
    }
    lines.join("\n") + "\n"
}

#[cfg(test)]
mod tests {
    use super::*;

    const WSOL: &str = "So11111111111111111111111111111111111111112";
    const USDC: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

    fn events(json: &str) -> String {
        format!("{{\"events\":{json}}}")
    }

    #[test]
    fn a_valid_event_normalizes_with_every_field_mapped() {
        let input = events(&format!(
            "[{{\"mint\":\"{WSOL}\",\"symbol\":\"SOL\",\"name\":\"Wrapped SOL\",\"observedAtLabel\":\"t0\",\"launchpadLabel\":\"pump.fun\",\"liquidityUsdHint\":1250.5,\"marketCapUsdHint\":100,\"holderCountHint\":42}}]"
        ));
        let report = normalize_replay_events(&input, None).unwrap();
        assert_eq!(report.observation_count, 1);
        let obs = &report.observations[0];
        assert_eq!(obs.candidate_id, "rt-so111111");
        assert_eq!(obs.mint, WSOL);
        assert_eq!(obs.symbol.as_deref(), Some("SOL"));
        assert_eq!(obs.name.as_deref(), Some("Wrapped SOL"));
        assert_eq!(obs.source_provider_id, "replay-file");
        assert_eq!(obs.source_kind, "replay");
        assert_eq!(obs.observed_at_label, "t0");
        assert_eq!(obs.launchpad_label.as_deref(), Some("pump.fun"));
        assert_eq!(
            obs.liquidity_usd_hint.as_ref().unwrap().as_f64(),
            Some(1250.5)
        );
        assert_eq!(obs.holder_count_hint.as_ref().unwrap().as_i64(), Some(42));
        assert_eq!(obs.caveats.len(), 4);
        assert!(obs.caveats[3].starts_with("REPLAY data:"));
    }

    #[test]
    fn defaults_apply_when_optional_fields_are_absent_or_unusable() {
        let input = events(&format!(
            "[{{\"mint\":\"{WSOL}\",\"symbol\":\"   \",\"name\":17,\"liquidityUsdHint\":-5,\"holderCountHint\":\"many\"}}]"
        ));
        let report = normalize_replay_events(&input, None).unwrap();
        let obs = &report.observations[0];
        assert_eq!(obs.symbol, None);
        assert_eq!(obs.name, None);
        assert_eq!(obs.observed_at_label, "replay-event");
        assert_eq!(obs.launchpad_label, None);
        assert_eq!(obs.liquidity_usd_hint, None);
        assert_eq!(obs.holder_count_hint, None);
    }

    #[test]
    fn labels_are_trimmed_capped_and_secret_shapes_dropped() {
        let long_name = "n".repeat(100);
        let hex_name = "a1".repeat(32);
        let input = events(&format!(
            "[{{\"mint\":\"{WSOL}\",\"symbol\":\"  padded  \",\"name\":\"{long_name}\"}},{{\"mint\":\"{USDC}\",\"name\":\"{hex_name}\"}}]"
        ));
        let report = normalize_replay_events(&input, None).unwrap();
        assert_eq!(report.observations[0].symbol.as_deref(), Some("padded"));
        assert_eq!(
            report.observations[0].name.as_deref().map(str::len),
            Some(64)
        );
        assert_eq!(
            report.observations[1].name, None,
            "64-hex name must be dropped"
        );
    }

    #[test]
    fn duplicate_mints_keep_the_first_and_are_counted() {
        let input = events(&format!(
            "[{{\"mint\":\"{WSOL}\",\"symbol\":\"A\"}},{{\"mint\":\"{WSOL}\",\"symbol\":\"B\"}},{{\"mint\":\"{USDC}\"}}]"
        ));
        let report = normalize_replay_events(&input, None).unwrap();
        assert_eq!(report.event_count, 3);
        assert_eq!(report.observation_count, 2);
        assert_eq!(report.duplicate_mint_count, 1);
        assert_eq!(report.observations[0].symbol.as_deref(), Some("A"));
    }

    #[test]
    fn malformed_documents_are_refused_with_index_but_never_the_value() {
        assert_eq!(
            normalize_replay_events("not json{", None).unwrap_err(),
            NormalizeError::InputNotJson
        );
        assert_eq!(
            normalize_replay_events("[1,2]", None).unwrap_err(),
            NormalizeError::NotAnObject
        );
        assert_eq!(
            normalize_replay_events("{\"other\":true}", None).unwrap_err(),
            NormalizeError::EventsMissing
        );
        assert_eq!(
            normalize_replay_events(&events("[42]"), None).unwrap_err(),
            NormalizeError::EventNotAnObject(0)
        );
        let secret_shaped = "5".repeat(88);
        let err = normalize_replay_events(
            &events(&format!("[{{\"mint\":\"{secret_shaped}\"}}]")),
            None,
        )
        .unwrap_err();
        let msg = err.to_string();
        assert!(msg.starts_with("replay events[0].mint:"));
        assert!(!msg.contains(&secret_shaped));
    }

    #[test]
    fn more_than_500_events_are_refused() {
        let one = format!("{{\"mint\":\"{WSOL}\"}}");
        let many = vec![one; 501].join(",");
        assert_eq!(
            normalize_replay_events(&events(&format!("[{many}]")), None).unwrap_err(),
            NormalizeError::TooManyEvents(501)
        );
    }

    #[test]
    fn created_at_is_validated_and_echoed() {
        let input = events(&format!("[{{\"mint\":\"{WSOL}\"}}]"));
        let report = normalize_replay_events(&input, Some("2026-06-12T00:00:00.000Z")).unwrap();
        assert_eq!(
            report.created_at.as_deref(),
            Some("2026-06-12T00:00:00.000Z")
        );
        assert!(matches!(
            normalize_replay_events(&input, Some("C:/secrets/id.json")).unwrap_err(),
            NormalizeError::BadCreatedAt(_)
        ));
    }

    #[test]
    fn identical_input_serializes_byte_identically() {
        let input = events(&format!(
            "[{{\"mint\":\"{WSOL}\",\"liquidityUsdHint\":10.25}}]"
        ));
        let a = to_ipc_json(
            &normalize_replay_events(&input, Some("2026-06-12T00:00:00.000Z")).unwrap(),
        );
        let b = to_ipc_json(
            &normalize_replay_events(&input, Some("2026-06-12T00:00:00.000Z")).unwrap(),
        );
        assert_eq!(a, b);
        assert!(a.ends_with('\n'));
    }

    #[test]
    fn json_uses_camel_case_keys_and_closed_field_sets() {
        let input = events(&format!("[{{\"mint\":\"{WSOL}\"}}]"));
        let report = normalize_replay_events(&input, None).unwrap();
        let value: Value = serde_json::from_str(&to_ipc_json(&report)).unwrap();
        let mut keys: Vec<&str> = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "banner",
                "caveats",
                "createdAt",
                "duplicateMintCount",
                "endpointHost",
                "engineName",
                "engineVersion",
                "eventCount",
                "fetchedAt",
                "ipcVersion",
                "neverSends",
                "observationCount",
                "observations",
                "phase7LiveTradingReady",
                "providerId",
                "schemaVersion",
                "sourceKind",
                "status",
                "statusDetail",
            ]
        );
        let mut obs_keys: Vec<&str> = value["observations"][0]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        obs_keys.sort_unstable();
        assert_eq!(
            obs_keys,
            vec![
                "candidateId",
                "caveats",
                "holderCountHint",
                "launchpadLabel",
                "liquidityUsdHint",
                "marketCapUsdHint",
                "mint",
                "name",
                "observedAtLabel",
                "sourceKind",
                "sourceProviderId",
                "symbol",
            ]
        );
    }

    #[test]
    fn report_pins_safety_literals() {
        let input = events(&format!("[{{\"mint\":\"{WSOL}\"}}]"));
        let report = normalize_replay_events(&input, None).unwrap();
        assert_eq!(
            report.schema_version,
            "engine.realtime.observations.report.v1"
        );
        assert_eq!(report.status, "observed");
        assert!(report.never_sends);
        assert!(!report.phase7_live_trading_ready);
        let text = to_text(&report);
        assert_eq!(text.matches("CAVEAT:").count(), report.caveats.len());
    }
}
