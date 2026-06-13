//! The route-quote SCORING hot path (Sprint 99): turn one TypeScript-produced
//! `routequote.fetch.report.v1` (arriving over BOUNDED stdin) into route-quality
//! INTELLIGENCE — per-entry scores, a deterministic ranking, and closed reason
//! codes. A route score is intelligence about quote quality and nothing else:
//! never a profitability claim, never execution readiness, never an order.
//!
//! Freshness semantics MIRROR `packages/core/src/quote-freshness.ts` exactly
//! (same closed verdict set, same fail-closed rules, same epoch arithmetic via
//! `iso8601`), and the TypeScript validator re-runs the REAL evaluator on every
//! entry — any disagreement refuses the whole artifact. The scoring instant
//! (`--scored-at`) and the age cap (`--max-quote-age-ms`) are orchestrator
//! arguments: the engine still reads no clock, no env, no filesystem, no
//! network.

use serde::Serialize;
use serde_json::Value;

use crate::ipc::IPC_VERSION;
use crate::iso8601::parse_iso_instant_ms;
use crate::label_safety::label_is_redaction_safe;
use crate::mint::parse_mint;
use crate::schema::ENGINE_ROUTEQUOTE_SCORE_SCHEMA_VERSION;
use crate::status::check_created_at;

/// The fetch-report schema this scorer consumes (produced + validated by TS).
pub const FETCH_REPORT_SCHEMA_VERSION: &str = "routequote.fetch.report.v1";

/// Hard ceiling on entries (mirrors the candidate-list bounds upstream).
pub const MAX_ENTRIES: usize = 500;

const BANNER: &str = "RUST ENGINE ROUTE QUOTE SCORES — quote-quality intelligence computed from a read-only fetch report; never a profitability claim, never execution readiness, never an order.";

const REPORT_CAVEATS: [&str; 4] = [
    "A route score is INTELLIGENCE about quote quality (impact, hops, age) — never a profitability claim, never a trade signal, never execution readiness.",
    "Scores are computed from a point-in-time fetch report; the market has already moved on, and every market figure remains a provider-reported HINT.",
    "Freshness facts mirror the TypeScript evaluator exactly and the TypeScript validator re-evaluates every entry — a disagreement refuses the whole artifact.",
    "scoredAt and the age cap are orchestrator-supplied (--scored-at / --max-quote-age-ms); the engine reads no clock.",
];

/// Closed freshness verdicts — verbatim mirror of QUOTE_FRESHNESS_VERDICTS.
const FRESHNESS_FRESH: &str = "fresh";
const FRESHNESS_STALE: &str = "stale";
const FRESHNESS_MISSING: &str = "missing-timestamp";
const FRESHNESS_MALFORMED: &str = "malformed-timestamp";
const FRESHNESS_FUTURE: &str = "future-timestamp";

/// Closed per-entry reason codes (alphabetical; the TS validator pins the set).
pub const REASON_CODES: [&str; 9] = [
    "future-timestamp",
    "hop-count-high",
    "hop-count-unknown",
    "impact-unavailable",
    "malformed-timestamp",
    "missing-timestamp",
    "not-observed",
    "price-impact-high",
    "stale",
];

/// Penalty components for one INCLUDED entry. Score = max(0, 100 - sum).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScoreComponents {
    pub impact_penalty: u32,
    pub hop_penalty: u32,
    pub age_penalty: u32,
}

/// Facts the score was computed FROM (always present, honest about gaps).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScoreFacts {
    pub price_impact_pct: Option<String>,
    pub hop_count: u32,
    pub route_labels: Vec<String>,
    pub fetched_at: Option<String>,
    pub age_ms: Option<i64>,
    pub freshness_verdict: &'static str,
    pub context_slot: Option<u64>,
}

/// One scored (or excluded) entry.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScoredEntry {
    pub candidate_id: String,
    pub mint: String,
    pub status: String,
    pub included: bool,
    pub score: Option<u32>,
    pub components: Option<ScoreComponents>,
    pub facts: ScoreFacts,
    pub reasons: Vec<&'static str>,
}

/// `engine.routequote.score.report.v1`. Field order IS the serialized order;
/// the TypeScript validator treats the key set as CLOSED.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuoteScoreReport {
    pub schema_version: &'static str,
    pub banner: &'static str,
    pub engine_name: &'static str,
    pub engine_version: &'static str,
    pub ipc_version: &'static str,
    pub scored_at: String,
    pub max_quote_age_ms: u64,
    pub provider_id: String,
    pub endpoint_host: String,
    pub report_fetched_at: String,
    pub requested_input_mint: String,
    pub requested_amount_raw: String,
    pub requested_slippage_bps: u64,
    pub entry_count: usize,
    pub included_count: usize,
    pub excluded_count: usize,
    pub entries: Vec<ScoredEntry>,
    pub ranking: Vec<String>,
    pub best_candidate_id: Option<String>,
    pub caveats: Vec<&'static str>,
    pub not_executable: bool,
    pub not_profitability_claim: bool,
    pub never_signs: bool,
    pub never_sends: bool,
    pub phase7_live_trading_ready: bool,
}

/// Why a score invocation was refused (exit 2; nothing is emitted). Messages
/// carry indexes and lengths, never input values.
#[derive(Debug, PartialEq, Eq)]
pub enum ScoreError {
    InputNotJson,
    NotAnObject,
    WrongSchema,
    MissingField(&'static str),
    TooManyEntries(usize),
    BadEntry(usize, String),
    BadScoredAt,
    BadMaxAge,
}

impl std::fmt::Display for ScoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ScoreError::InputNotJson => write!(f, "stdin is not valid JSON"),
            ScoreError::NotAnObject => write!(f, "fetch report must be a JSON object"),
            ScoreError::WrongSchema => write!(
                f,
                "fetch report schemaVersion must be {FETCH_REPORT_SCHEMA_VERSION:?}"
            ),
            ScoreError::MissingField(name) => {
                write!(f, "fetch report is missing required field {name:?}")
            }
            ScoreError::TooManyEntries(n) => {
                write!(f, "fetch report carries {n} entries - more than {MAX_ENTRIES}; bound it")
            }
            ScoreError::BadEntry(i, reason) => write!(f, "fetch report entries[{i}]: {reason}"),
            ScoreError::BadScoredAt => write!(
                f,
                "--scored-at must be ISO-8601-shaped (the orchestrator supplies the scoring instant)"
            ),
            ScoreError::BadMaxAge => write!(
                f,
                "--max-quote-age-ms must be a positive integer (no default cap exists by design)"
            ),
        }
    }
}

const CLOSED_STATUSES: [&str; 5] = [
    "quote-observed",
    "unavailable",
    "blocked",
    "error",
    "unsupported",
];

fn bounded_string(value: Option<&Value>, max: usize) -> Option<String> {
    let raw = value?.as_str()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().count() > max || !label_is_redaction_safe(trimmed) {
        return None;
    }
    Some(trimmed.to_string())
}

fn required_string(
    object: &serde_json::Map<String, Value>,
    field: &'static str,
    max: usize,
) -> Result<String, ScoreError> {
    bounded_string(object.get(field), max).ok_or(ScoreError::MissingField(field))
}

/// Mirror of `evaluateQuoteFreshness` (cap is validated before any entry, so
/// the `cap-missing` verdict cannot occur here by construction).
fn evaluate_freshness(
    fetched_at: Option<&str>,
    now_ms: i64,
    max_age_ms: u64,
) -> (&'static str, Option<i64>) {
    let Some(raw) = fetched_at else {
        return (FRESHNESS_MISSING, None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return (FRESHNESS_MISSING, None);
    }
    let Some(parsed_ms) = parse_iso_instant_ms(trimmed) else {
        return (FRESHNESS_MALFORMED, None);
    };
    let age_ms = now_ms - parsed_ms;
    if age_ms < 0 {
        return (FRESHNESS_FUTURE, Some(age_ms));
    }
    if age_ms > max_age_ms as i64 {
        return (FRESHNESS_STALE, Some(age_ms));
    }
    (FRESHNESS_FRESH, Some(age_ms))
}

/// Parse a provider-reported price impact percent string into basis points
/// (1 bps = 0.01%). Conservative: anything unparseable or negative is `None`.
fn impact_bps(price_impact_pct: Option<&str>) -> Option<u64> {
    let raw = price_impact_pct?;
    let value: f64 = raw.parse().ok()?;
    if !value.is_finite() || !(0.0..=100.0).contains(&value) {
        return None;
    }
    Some((value * 100.0).round() as u64)
}

fn score_entry(
    index: usize,
    entry: &Value,
    now_ms: i64,
    max_age_ms: u64,
) -> Result<ScoredEntry, ScoreError> {
    let object = entry
        .as_object()
        .ok_or_else(|| ScoreError::BadEntry(index, "must be an object".to_string()))?;

    let candidate_id = bounded_string(object.get("candidateId"), 64).ok_or_else(|| {
        ScoreError::BadEntry(
            index,
            "candidateId must be a bounded safe string".to_string(),
        )
    })?;
    let mint = match object.get("mint").and_then(Value::as_str) {
        Some(raw) => {
            parse_mint(raw).map_err(|e| ScoreError::BadEntry(index, format!("mint: {e}")))?
        }
        None => {
            return Err(ScoreError::BadEntry(
                index,
                "mint must be a string".to_string(),
            ))
        }
    };
    let status = bounded_string(object.get("status"), 32)
        .filter(|s| CLOSED_STATUSES.contains(&s.as_str()))
        .ok_or_else(|| {
            ScoreError::BadEntry(
                index,
                "status must be one of the closed quote statuses".to_string(),
            )
        })?;

    let metadata = object
        .get("metadata")
        .and_then(Value::as_object)
        .ok_or_else(|| ScoreError::BadEntry(index, "metadata must be an object".to_string()))?;

    let fetched_at = bounded_string(metadata.get("fetchedAt"), 64);
    let price_impact_pct = bounded_string(metadata.get("priceImpactPct"), 32);
    let context_slot = metadata.get("contextSlot").and_then(Value::as_u64);
    let route_labels: Vec<String> = metadata
        .get("routeLabels")
        .and_then(Value::as_array)
        .map(|labels| {
            labels
                .iter()
                .take(8)
                .filter_map(|label| bounded_string(Some(label), 32))
                .collect()
        })
        .unwrap_or_default();
    let hop_count = route_labels.len() as u32;

    let (freshness_verdict, age_ms) = evaluate_freshness(fetched_at.as_deref(), now_ms, max_age_ms);

    let facts = ScoreFacts {
        price_impact_pct: price_impact_pct.clone(),
        hop_count,
        route_labels,
        fetched_at,
        age_ms,
        freshness_verdict,
        context_slot,
    };

    let mut reasons: Vec<&'static str> = Vec::new();

    if status != "quote-observed" {
        reasons.push("not-observed");
        return Ok(ScoredEntry {
            candidate_id,
            mint,
            status,
            included: false,
            score: None,
            components: None,
            facts,
            reasons,
        });
    }
    if freshness_verdict != FRESHNESS_FRESH {
        reasons.push(match freshness_verdict {
            FRESHNESS_STALE => "stale",
            FRESHNESS_FUTURE => "future-timestamp",
            FRESHNESS_MALFORMED => "malformed-timestamp",
            _ => "missing-timestamp",
        });
        return Ok(ScoredEntry {
            candidate_id,
            mint,
            status,
            included: false,
            score: None,
            components: None,
            facts,
            reasons,
        });
    }

    // Impact penalty: 1 point per 10 bps of provider-reported price impact,
    // capped at 60; unknown impact is penalized AND flagged, never ignored.
    let impact_penalty = match impact_bps(facts.price_impact_pct.as_deref()) {
        Some(bps) => {
            if bps >= 500 {
                reasons.push("price-impact-high");
            }
            bps.div_ceil(10).min(60) as u32
        }
        None => {
            reasons.push("impact-unavailable");
            15
        }
    };

    // Hop penalty: a single-hop route is best; each extra hop costs 5 (cap 15);
    // an empty route plan is flagged unknown and costs 5.
    let hop_penalty = if facts.hop_count == 0 {
        reasons.push("hop-count-unknown");
        5
    } else {
        if facts.hop_count >= 3 {
            reasons.push("hop-count-high");
        }
        (5 * (facts.hop_count - 1)).min(15)
    };

    // Age penalty: linear 0..20 across the explicit cap.
    let age = facts.age_ms.unwrap_or(0).max(0) as u64;
    let age_penalty = ((20 * age) / max_age_ms.max(1)).min(20) as u32;

    let total = impact_penalty + hop_penalty + age_penalty;
    let score = 100u32.saturating_sub(total);

    Ok(ScoredEntry {
        candidate_id,
        mint,
        status,
        included: true,
        score: Some(score),
        components: Some(ScoreComponents {
            impact_penalty,
            hop_penalty,
            age_penalty,
        }),
        facts,
        reasons,
    })
}

/// Score one fetch report document. Pure: same input + same arguments, same
/// report, always.
pub fn score_fetch_report(
    input: &str,
    scored_at: &str,
    max_quote_age_ms: u64,
) -> Result<QuoteScoreReport, ScoreError> {
    if check_created_at(scored_at).is_err() {
        return Err(ScoreError::BadScoredAt);
    }
    let Some(now_ms) = parse_iso_instant_ms(scored_at) else {
        return Err(ScoreError::BadScoredAt);
    };
    if max_quote_age_ms == 0 {
        return Err(ScoreError::BadMaxAge);
    }

    let document: Value = serde_json::from_str(input).map_err(|_| ScoreError::InputNotJson)?;
    let object = document.as_object().ok_or(ScoreError::NotAnObject)?;
    if object.get("schemaVersion").and_then(Value::as_str) != Some(FETCH_REPORT_SCHEMA_VERSION) {
        return Err(ScoreError::WrongSchema);
    }

    let provider_id = required_string(object, "providerId", 64)?;
    let endpoint_host = required_string(object, "endpointHost", 128)?;
    let report_fetched_at = required_string(object, "fetchedAt", 64)?;
    let requested_amount_raw = required_string(object, "requestedAmountRaw", 30)?;
    let requested_input_mint = match object.get("requestedInputMint").and_then(Value::as_str) {
        Some(raw) => parse_mint(raw).map_err(|_| ScoreError::MissingField("requestedInputMint"))?,
        None => return Err(ScoreError::MissingField("requestedInputMint")),
    };
    let requested_slippage_bps = object
        .get("requestedSlippageBps")
        .and_then(Value::as_u64)
        .filter(|bps| *bps <= 10_000)
        .ok_or(ScoreError::MissingField("requestedSlippageBps"))?;

    let raw_entries = object
        .get("entries")
        .and_then(Value::as_array)
        .ok_or(ScoreError::MissingField("entries"))?;
    if raw_entries.len() > MAX_ENTRIES {
        return Err(ScoreError::TooManyEntries(raw_entries.len()));
    }

    let mut entries: Vec<ScoredEntry> = Vec::with_capacity(raw_entries.len());
    for (index, raw) in raw_entries.iter().enumerate() {
        entries.push(score_entry(index, raw, now_ms, max_quote_age_ms)?);
    }

    // Deterministic ranking: score desc, then age asc, then candidateId asc.
    let mut ranked: Vec<&ScoredEntry> = entries.iter().filter(|e| e.included).collect();
    ranked.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| {
                a.facts
                    .age_ms
                    .unwrap_or(i64::MAX)
                    .cmp(&b.facts.age_ms.unwrap_or(i64::MAX))
            })
            .then_with(|| a.candidate_id.cmp(&b.candidate_id))
    });
    let ranking: Vec<String> = ranked.iter().map(|e| e.candidate_id.clone()).collect();
    let best_candidate_id = ranking.first().cloned();
    let included_count = ranking.len();
    let entry_count = entries.len();

    Ok(QuoteScoreReport {
        schema_version: ENGINE_ROUTEQUOTE_SCORE_SCHEMA_VERSION,
        banner: BANNER,
        engine_name: "solmaker-engine",
        engine_version: env!("CARGO_PKG_VERSION"),
        ipc_version: IPC_VERSION,
        scored_at: scored_at.to_string(),
        max_quote_age_ms,
        provider_id,
        endpoint_host,
        report_fetched_at,
        requested_input_mint,
        requested_amount_raw,
        requested_slippage_bps,
        entry_count,
        included_count,
        excluded_count: entry_count - included_count,
        entries,
        ranking,
        best_candidate_id,
        caveats: REPORT_CAVEATS.to_vec(),
        not_executable: true,
        not_profitability_claim: true,
        never_signs: true,
        never_sends: true,
        phase7_live_trading_ready: false,
    })
}

/// Serialize exactly as the IPC contract requires: pretty JSON, trailing
/// newline, nothing else.
pub fn to_ipc_json(report: &QuoteScoreReport) -> String {
    let mut json = serde_json::to_string_pretty(report).expect("score report serializes");
    json.push('\n');
    json
}

/// Human-readable rendering for a terminal (used when --json is absent).
pub fn to_text(report: &QuoteScoreReport) -> String {
    let mut lines = vec![
        "RUST ENGINE ROUTE QUOTE SCORES".to_string(),
        format!(
            "report:    {} ({}) fetched {}",
            report.provider_id, report.endpoint_host, report.report_fetched_at
        ),
        format!(
            "scored:    {} (cap {}ms) - {} included / {} excluded of {}",
            report.scored_at,
            report.max_quote_age_ms,
            report.included_count,
            report.excluded_count,
            report.entry_count
        ),
    ];
    for id in &report.ranking {
        if let Some(entry) = report.entries.iter().find(|e| &e.candidate_id == id) {
            let score = entry.score.map_or("-".to_string(), |s| s.to_string());
            let reasons = if entry.reasons.is_empty() {
                String::new()
            } else {
                format!(" [{}]", entry.reasons.join(", "))
            };
            lines.push(format!("  {score:>3}  {id}{reasons}"));
        }
    }
    for entry in report.entries.iter().filter(|e| !e.included) {
        lines.push(format!(
            "    -  {} EXCLUDED [{}]",
            entry.candidate_id,
            entry.reasons.join(", ")
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
    const BONK: &str = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
    const NOW: &str = "2026-06-12T12:00:00.000Z";

    fn entry(candidate_id: &str, mint: &str, status: &str, extras: &str) -> String {
        format!(
            "{{\"candidateId\":\"{candidate_id}\",\"mint\":\"{mint}\",\"status\":\"{status}\",\"observation\":{{}},\"metadata\":{{\"providerId\":\"jupiter-lite-api\",\"endpointHost\":\"lite-api.jup.ag\"{extras}}}}}"
        )
    }

    fn report(entries: &[String]) -> String {
        format!(
            "{{\"schemaVersion\":\"routequote.fetch.report.v1\",\"providerId\":\"jupiter-lite-api\",\"endpointHost\":\"lite-api.jup.ag\",\"fetchedAt\":\"2026-06-12T11:59:30.000Z\",\"requestedInputMint\":\"{WSOL}\",\"requestedAmountRaw\":\"10000000\",\"requestedSlippageBps\":50,\"entries\":[{}]}}",
            entries.join(",")
        )
    }

    fn fresh_extras(impact: &str, labels: &str) -> String {
        format!(
            ",\"fetchedAt\":\"2026-06-12T11:59:30.000Z\",\"priceImpactPct\":\"{impact}\",\"routeLabels\":[{labels}],\"contextSlot\":426052463"
        )
    }

    #[test]
    fn best_route_is_selected_deterministically() {
        let input = report(&[
            entry(
                "cand-a",
                USDC,
                "quote-observed",
                &fresh_extras("0.5", "\"Raydium\""),
            ),
            entry(
                "cand-b",
                BONK,
                "quote-observed",
                &fresh_extras("0.01", "\"Orca\""),
            ),
        ]);
        let result = score_fetch_report(&input, NOW, 60_000).unwrap();
        assert_eq!(result.best_candidate_id.as_deref(), Some("cand-b"));
        assert_eq!(result.ranking, vec!["cand-b", "cand-a"]);
        // cand-b: impact 1 bps -> ceil(1/10)=1; hops 1 -> 0; age 30s/60s -> 10. 100-11=89.
        let b = &result.entries[1];
        assert_eq!(b.score, Some(89));
        assert_eq!(
            b.components,
            Some(ScoreComponents {
                impact_penalty: 1,
                hop_penalty: 0,
                age_penalty: 10
            })
        );
    }

    #[test]
    fn ties_break_on_age_then_candidate_id() {
        let same = fresh_extras("0.1", "\"Raydium\"");
        let input = report(&[
            entry("cand-z", USDC, "quote-observed", &same),
            entry("cand-a", BONK, "quote-observed", &same),
        ]);
        let result = score_fetch_report(&input, NOW, 60_000).unwrap();
        assert_eq!(result.ranking, vec!["cand-a", "cand-z"]);
    }

    #[test]
    fn stale_and_future_quotes_are_excluded_with_closed_reasons() {
        let stale = ",\"fetchedAt\":\"2026-06-12T11:00:00.000Z\",\"priceImpactPct\":\"0.1\",\"routeLabels\":[\"Orca\"]";
        let future = ",\"fetchedAt\":\"2026-06-12T12:00:01.000Z\",\"priceImpactPct\":\"0.1\",\"routeLabels\":[\"Orca\"]";
        let input = report(&[
            entry("cand-stale", USDC, "quote-observed", stale),
            entry("cand-future", BONK, "quote-observed", future),
        ]);
        let result = score_fetch_report(&input, NOW, 60_000).unwrap();
        assert_eq!(result.included_count, 0);
        assert_eq!(result.best_candidate_id, None);
        assert_eq!(result.entries[0].reasons, vec!["stale"]);
        assert_eq!(result.entries[0].facts.freshness_verdict, "stale");
        assert_eq!(result.entries[1].reasons, vec!["future-timestamp"]);
        assert_eq!(result.entries[1].facts.age_ms, Some(-1_000));
    }

    #[test]
    fn non_observed_entries_are_excluded_not_scored() {
        let input = report(&[entry("cand-x", USDC, "blocked", "")]);
        let result = score_fetch_report(&input, NOW, 60_000).unwrap();
        let e = &result.entries[0];
        assert!(!e.included);
        assert_eq!(e.score, None);
        assert_eq!(e.reasons, vec!["not-observed"]);
        assert_eq!(e.facts.freshness_verdict, "missing-timestamp");
    }

    #[test]
    fn high_impact_unknown_impact_and_many_hops_are_penalized_and_flagged() {
        let high = fresh_extras("7.5", "\"A\",\"B\",\"C\"");
        let unknown_impact =
            ",\"fetchedAt\":\"2026-06-12T11:59:30.000Z\",\"routeLabels\":[\"Orca\"]";
        let no_hops = ",\"fetchedAt\":\"2026-06-12T11:59:30.000Z\",\"priceImpactPct\":\"0\",\"routeLabels\":[]";
        let input = report(&[
            entry("cand-h", USDC, "quote-observed", &high),
            entry("cand-u", BONK, "quote-observed", unknown_impact),
            entry("cand-n", WSOL, "quote-observed", no_hops),
        ]);
        let result = score_fetch_report(&input, NOW, 60_000).unwrap();
        let h = &result.entries[0];
        // impact 750 bps -> ceil(750/10)=75 capped 60; hops 3 -> 10; age 10. 100-80=20.
        assert_eq!(h.score, Some(20));
        assert!(h.reasons.contains(&"price-impact-high"));
        assert!(h.reasons.contains(&"hop-count-high"));
        let u = &result.entries[1];
        assert!(u.reasons.contains(&"impact-unavailable"));
        assert_eq!(u.components.as_ref().unwrap().impact_penalty, 15);
        let n = &result.entries[2];
        assert!(n.reasons.contains(&"hop-count-unknown"));
        assert_eq!(n.components.as_ref().unwrap().hop_penalty, 5);
    }

    #[test]
    fn malformed_documents_and_arguments_are_refused() {
        assert_eq!(
            score_fetch_report("nope{", NOW, 60_000).unwrap_err(),
            ScoreError::InputNotJson
        );
        assert_eq!(
            score_fetch_report("{\"schemaVersion\":\"other.v1\"}", NOW, 60_000).unwrap_err(),
            ScoreError::WrongSchema
        );
        let input = report(&[entry(
            "cand-a",
            USDC,
            "quote-observed",
            &fresh_extras("0", "\"Orca\""),
        )]);
        assert_eq!(
            score_fetch_report(&input, "not-a-time", 60_000).unwrap_err(),
            ScoreError::BadScoredAt
        );
        assert_eq!(
            score_fetch_report(&input, NOW, 0).unwrap_err(),
            ScoreError::BadMaxAge
        );
        let bad_mint = report(&[entry("cand-a", "tooshort", "quote-observed", "")]);
        assert!(matches!(
            score_fetch_report(&bad_mint, NOW, 60_000).unwrap_err(),
            ScoreError::BadEntry(0, _)
        ));
    }

    #[test]
    fn identical_input_serializes_byte_identically_and_pins_literals() {
        let input = report(&[entry(
            "cand-a",
            USDC,
            "quote-observed",
            &fresh_extras("0.5", "\"Raydium\""),
        )]);
        let a = to_ipc_json(&score_fetch_report(&input, NOW, 60_000).unwrap());
        let b = to_ipc_json(&score_fetch_report(&input, NOW, 60_000).unwrap());
        assert_eq!(a, b);
        assert!(a.ends_with('\n'));
        let report = score_fetch_report(&input, NOW, 60_000).unwrap();
        assert!(report.not_executable);
        assert!(report.not_profitability_claim);
        assert!(report.never_sends);
        assert!(!report.phase7_live_trading_ready);
        let text = to_text(&report);
        assert_eq!(text.matches("CAVEAT:").count(), report.caveats.len());
    }

    #[test]
    fn every_emitted_reason_is_in_the_closed_set() {
        let input = report(&[
            entry(
                "cand-a",
                USDC,
                "quote-observed",
                &fresh_extras("7.5", "\"A\",\"B\",\"C\""),
            ),
            entry("cand-b", BONK, "blocked", ""),
            entry(
                "cand-c",
                WSOL,
                "quote-observed",
                ",\"fetchedAt\":\"2026-06-12T11:00:00.000Z\"",
            ),
        ]);
        let result = score_fetch_report(&input, NOW, 60_000).unwrap();
        for entry in &result.entries {
            for reason in &entry.reasons {
                assert!(REASON_CODES.contains(reason), "{reason} not in closed set");
            }
        }
    }
}
