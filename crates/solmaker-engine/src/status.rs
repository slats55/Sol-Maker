//! The `engine.status.report.v1` artifact: what this engine is, what it can
//! do, and — more importantly — the closed list of what it cannot do.
//!
//! Determinism: the report is a pure function of the crate's compile-time
//! constants plus the orchestrator-supplied `--created-at` value. The engine
//! reads no clock, no environment, and no filesystem.

use serde::Serialize;

use crate::ipc::IPC_VERSION;
use crate::safety::{
    DISABLED_CAPABILITIES, MAINNET_SEND_SUPPORT, SAFETY_MODE, SEND_SUPPORT, SIGNER_SUPPORT,
    SUPPORTED_CAPABILITIES,
};
use crate::schema::ENGINE_STATUS_SCHEMA_VERSION;

const BANNER: &str = "RUST ENGINE STATUS — sidecar foundation report. This engine has no signing, sending, wallet, key, or network capability by construction; TypeScript validates every byte it emits before anything reads it.";

const CAVEATS: [&str; 3] = [
    "Foundation sidecar only: status, JSON IPC, and schema parity. No realtime ingestion, quoting, simulation, or execution capability exists in this engine yet.",
    "The engine cannot sign, send, or load wallet/key material — those capabilities have no code path here, and capability scans on both sides enforce that.",
    "createdAt is supplied by the orchestrator (--created-at) so identical invocations stay byte-identical; the engine reads no clock.",
];

/// `engine.status.report.v1`. Field order here IS the serialized order, and the
/// TypeScript validator treats the key set as CLOSED — adding a field requires
/// updating both sides in the same change.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StatusReport {
    pub schema_version: &'static str,
    pub banner: &'static str,
    pub engine_name: &'static str,
    pub engine_version: &'static str,
    /// `debug` or `release`, from the compile profile.
    pub build_profile: &'static str,
    /// Embedded at build time by build.rs; `None` when the build script could
    /// not capture it (reported honestly as null, never guessed).
    pub rustc_version: Option<&'static str>,
    pub ipc_version: &'static str,
    pub safety_mode: &'static str,
    pub signer_support: &'static str,
    pub send_support: &'static str,
    pub mainnet_send_support: &'static str,
    pub supported_capabilities: Vec<&'static str>,
    pub disabled_capabilities: Vec<&'static str>,
    /// Orchestrator-supplied timestamp; null when none was provided.
    pub created_at: Option<String>,
    pub caveats: Vec<&'static str>,
    pub never_sends: bool,
    pub phase7_live_trading_ready: bool,
}

/// Reasons a `--created-at` value is refused (exit 2; nothing is emitted).
#[derive(Debug, PartialEq, Eq)]
pub enum CreatedAtError {
    TooLong,
    NotIsoShaped,
}

impl std::fmt::Display for CreatedAtError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CreatedAtError::TooLong => write!(f, "--created-at is longer than 40 characters"),
            CreatedAtError::NotIsoShaped => {
                write!(
                    f,
                    "--created-at must be ISO-8601-shaped (e.g. 2026-06-12T00:00:00.000Z)"
                )
            }
        }
    }
}

/// Accept only an ISO-8601-shaped UTC timestamp. This is a SHAPE check, not a
/// calendar check: its job is to keep arbitrary strings (paths, key material,
/// shell metacharacters) out of the artifact, not to validate dates.
fn check_created_at(value: &str) -> Result<(), CreatedAtError> {
    if value.len() > 40 {
        return Err(CreatedAtError::TooLong);
    }
    let bytes = value.as_bytes();
    let ok_shape = value.len() >= 20
        && bytes
            .iter()
            .all(|b| b.is_ascii_digit() || matches!(b, b'-' | b':' | b'.' | b'T' | b'Z'))
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[4] == b'-'
        && bytes[10] == b'T'
        && value.ends_with('Z');
    if ok_shape {
        Ok(())
    } else {
        Err(CreatedAtError::NotIsoShaped)
    }
}

/// Build the status report. Pure: same input, same report, always.
pub fn build_status_report(created_at: Option<&str>) -> Result<StatusReport, CreatedAtError> {
    if let Some(value) = created_at {
        check_created_at(value)?;
    }
    let rustc_version = option_env!("SOLMAKER_RUSTC_VERSION").filter(|v| !v.is_empty());
    Ok(StatusReport {
        schema_version: ENGINE_STATUS_SCHEMA_VERSION,
        banner: BANNER,
        engine_name: "solmaker-engine",
        engine_version: env!("CARGO_PKG_VERSION"),
        build_profile: if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
        rustc_version,
        ipc_version: IPC_VERSION,
        safety_mode: SAFETY_MODE,
        signer_support: SIGNER_SUPPORT,
        send_support: SEND_SUPPORT,
        mainnet_send_support: MAINNET_SEND_SUPPORT,
        supported_capabilities: SUPPORTED_CAPABILITIES.to_vec(),
        disabled_capabilities: DISABLED_CAPABILITIES.to_vec(),
        created_at: created_at.map(str::to_string),
        caveats: CAVEATS.to_vec(),
        never_sends: true,
        phase7_live_trading_ready: false,
    })
}

/// Serialize the report exactly as the IPC contract requires: pretty JSON,
/// trailing newline, nothing else.
pub fn to_ipc_json(report: &StatusReport) -> String {
    let mut json = serde_json::to_string_pretty(report).expect("status report serializes");
    json.push('\n');
    json
}

/// Human-readable rendering for a terminal (used when --json is absent).
pub fn to_text(report: &StatusReport) -> String {
    let mut lines = vec![
        "RUST ENGINE STATUS".to_string(),
        format!(
            "engine:      {} {} ({}; {})",
            report.engine_name,
            report.engine_version,
            report.build_profile,
            report.rustc_version.unwrap_or("rustc version unavailable"),
        ),
        format!("ipc:         {}", report.ipc_version),
        format!("safety mode: {}", report.safety_mode),
        format!(
            "signer: {} | send: {} | mainnet send: {}",
            report.signer_support, report.send_support, report.mainnet_send_support
        ),
        format!("supported:   {}", report.supported_capabilities.join(", ")),
        format!("disabled:    {}", report.disabled_capabilities.join(", ")),
    ];
    for caveat in &report.caveats {
        lines.push(format!("CAVEAT: {caveat}"));
    }
    lines.join("\n") + "\n"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_pins_schema_and_disabled_markers() {
        let report = build_status_report(None).expect("builds");
        assert_eq!(report.schema_version, "engine.status.report.v1");
        assert_eq!(report.signer_support, "disabled");
        assert_eq!(report.send_support, "disabled");
        assert_eq!(report.mainnet_send_support, "disabled");
        assert!(report.never_sends);
        assert!(!report.phase7_live_trading_ready);
        assert_eq!(report.created_at, None);
    }

    #[test]
    fn identical_input_serializes_byte_identically() {
        let a = to_ipc_json(&build_status_report(Some("2026-06-12T00:00:00.000Z")).unwrap());
        let b = to_ipc_json(&build_status_report(Some("2026-06-12T00:00:00.000Z")).unwrap());
        assert_eq!(a, b);
        assert!(a.ends_with('\n'));
    }

    #[test]
    fn created_at_is_echoed_verbatim() {
        let report = build_status_report(Some("2026-06-12T01:02:03.456Z")).unwrap();
        assert_eq!(
            report.created_at.as_deref(),
            Some("2026-06-12T01:02:03.456Z")
        );
    }

    #[test]
    fn created_at_refuses_non_iso_shapes() {
        assert_eq!(
            build_status_report(Some("not-a-time")).unwrap_err(),
            CreatedAtError::NotIsoShaped
        );
        assert_eq!(
            build_status_report(Some("2026-06-12T00:00:00.000Z-extra-extra-extra-extra"))
                .unwrap_err(),
            CreatedAtError::TooLong
        );
        // A path or key-shaped string must never reach the artifact.
        assert!(build_status_report(Some("C:/secrets/id.json")).is_err());
        assert!(build_status_report(Some("2026-06-12 00:00:00")).is_err());
    }

    #[test]
    fn json_uses_camel_case_keys_and_closed_field_set() {
        let report = build_status_report(None).unwrap();
        let value: serde_json::Value = serde_json::from_str(&to_ipc_json(&report)).unwrap();
        let obj = value.as_object().unwrap();
        let mut keys: Vec<&str> = obj.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "banner",
                "buildProfile",
                "caveats",
                "createdAt",
                "disabledCapabilities",
                "engineName",
                "engineVersion",
                "ipcVersion",
                "mainnetSendSupport",
                "neverSends",
                "phase7LiveTradingReady",
                "rustcVersion",
                "safetyMode",
                "schemaVersion",
                "sendSupport",
                "signerSupport",
                "supportedCapabilities",
            ]
        );
    }

    #[test]
    fn text_rendering_carries_every_caveat() {
        let report = build_status_report(None).unwrap();
        let text = to_text(&report);
        assert!(text.starts_with("RUST ENGINE STATUS"));
        assert_eq!(text.matches("CAVEAT:").count(), report.caveats.len());
    }
}
