//! The simulation-failure CLASSIFICATION parity hot path (Sprint 100): map a
//! bounded `{ errLabel, logs }` simulation result onto the S95 CLOSED
//! classification set, mirroring `classifySimulationFailure`
//! (`packages/txpreview/src/simulate.ts`) pattern for pattern. The guidance
//! strings are reproduced verbatim so the TypeScript validator can pin them.
//!
//! Pure string matching over bounded input from stdin — nothing here simulates,
//! signs, sends, or reaches a network. The TypeScript bridge re-runs the REAL
//! `classifySimulationFailure` and refuses the artifact on any disagreement.

use serde::Serialize;
use serde_json::Value;

use crate::ipc::IPC_VERSION;
use crate::schema::ENGINE_SIM_CLASSIFICATION_SCHEMA_VERSION;
use crate::status::check_created_at;

const BANNER: &str = "RUST ENGINE SIM CLASSIFY — deterministic classification of a simulation failure into the S95 closed set; read-only, mirrors the TypeScript classifier, and is re-checked by TypeScript before anything trusts it.";

const REPORT_CAVEATS: [&str; 3] = [
    "Classification is derived ONLY from the program error label and bounded logs, mapped onto a CLOSED set — an unmatched failure stays unclassified-error, honest over clever.",
    "TypeScript re-runs the real classifier on the same input and refuses the artifact on any disagreement — the engine is never the authority.",
    "A classification explains WHY a simulation failed; it is never an execution signal and never suggests bypassing a gate.",
];

/// Max log lines accepted (mirrors the TypeScript 50-line bound on report logs).
pub const MAX_LOG_LINES: usize = 50;
/// Max characters per log line (mirrors the TypeScript 300-char bound).
pub const MAX_LOG_LINE_LEN: usize = 300;

/// Operator guidance for one classification — message + exact next safe action,
/// reproduced VERBATIM from TX_SIMULATION_CLASSIFICATION_GUIDANCE.
struct Guidance {
    classification: &'static str,
    message: &'static str,
    next_action: &'static str,
}

const GUIDANCE: [Guidance; 6] = [
    Guidance {
        classification: "slippage-or-route-error",
        message: "The swap's slippage tolerance tripped during simulation — the route's price moved past your tolerance.",
        next_action: "Re-quote and rebuild (prices moved). Never raise slippage to force a thin route through; a tripping tolerance is the protection working.",
    },
    Guidance {
        classification: "compute-exceeded",
        message: "The transaction exceeded its compute budget during simulation.",
        next_action: "Rebuild from a fresh quote (routes change shape). A persistently compute-heavy route is not snipe material.",
    },
    Guidance {
        classification: "blockhash-error",
        message: "A blockhash problem surfaced even though the preview replaces the blockhash — the transaction's lifetime material is suspect.",
        next_action: "Rebuild the transaction from scratch. Do not retry the same envelope.",
    },
    Guidance {
        classification: "account-error",
        message: "An account the transaction needs is missing, invalid, or underfunded (e.g. the fee payer has no balance at simulation state).",
        next_action: "Check the wallet's balance and the token accounts involved, then rebuild. An account error at simulation time would also fail at execution time.",
    },
    Guidance {
        classification: "program-error",
        message: "An instruction failed at the program level for a reason other than slippage/compute/accounts.",
        next_action: "Read the bounded logs in the report. Rebuild from a fresh quote; if the same program fails repeatedly, treat the route as untradeable.",
    },
    Guidance {
        classification: "unclassified-error",
        message: "The simulation failed but the error matches no known pattern.",
        next_action: "Read errLabel and the logs verbatim. Do not proceed to any execution path on an unclassified failure.",
    },
];

fn guidance_for(classification: &str) -> &'static Guidance {
    GUIDANCE
        .iter()
        .find(|g| g.classification == classification)
        .expect("every classification has guidance")
}

/// `engine.sim.classification.report.v1`. Field order IS the serialized order;
/// the TypeScript validator treats the key set as CLOSED.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SimClassificationReport {
    pub schema_version: &'static str,
    pub banner: &'static str,
    pub engine_name: &'static str,
    pub engine_version: &'static str,
    pub ipc_version: &'static str,
    pub classification: &'static str,
    pub classification_message: &'static str,
    pub classification_next_action: &'static str,
    pub err_label_present: bool,
    pub log_line_count: usize,
    pub created_at: Option<String>,
    pub caveats: Vec<&'static str>,
    pub not_executable: bool,
    pub never_signs: bool,
    pub never_sends: bool,
    pub phase7_live_trading_ready: bool,
}

/// Why a sim-classify invocation was refused (exit 2; nothing emitted).
#[derive(Debug, PartialEq, Eq)]
pub enum SimClassifyError {
    InputNotJson,
    NotAnObject,
    BadErrLabel,
    BadLogs,
    TooManyLogs(usize),
    BadCreatedAt,
}

impl std::fmt::Display for SimClassifyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SimClassifyError::InputNotJson => write!(f, "stdin is not valid JSON"),
            SimClassifyError::NotAnObject => {
                write!(
                    f,
                    "simulation result must be a JSON object {{ errLabel, logs }}"
                )
            }
            SimClassifyError::BadErrLabel => {
                write!(f, "errLabel must be a string or null")
            }
            SimClassifyError::BadLogs => write!(f, "logs must be an array of strings"),
            SimClassifyError::TooManyLogs(n) => {
                write!(
                    f,
                    "logs carries {n} lines - more than {MAX_LOG_LINES}; bound it"
                )
            }
            SimClassifyError::BadCreatedAt => {
                write!(f, "--created-at must be ISO-8601-shaped")
            }
        }
    }
}

/// Classify a failed simulation deterministically from the error label and
/// logs. Pattern order is fixed (most specific first); anything unmatched is
/// `unclassified-error`. VERBATIM mirror of `classifySimulationFailure`.
pub fn classify(err_label: Option<&str>, logs: &[String]) -> &'static str {
    let haystack = format!("{}\n{}", err_label.unwrap_or(""), logs.join("\n")).to_lowercase();
    if haystack.contains("slippage") || haystack.contains("0x1771") {
        return "slippage-or-route-error";
    }
    if haystack.contains("computebudgetexceeded")
        || haystack.contains("compute budget exceeded")
        || haystack.contains("exceeded cus meter")
        || haystack.contains("max compute units")
        || compute_units_failed(&haystack)
    {
        return "compute-exceeded";
    }
    if haystack.contains("blockhashnotfound")
        || haystack.contains("blockhash not found")
        || haystack.contains("invalid blockhash")
    {
        return "blockhash-error";
    }
    if haystack.contains("accountnotfound")
        || haystack.contains("account not found")
        || haystack.contains("accountinuse")
        || haystack.contains("accountloadedtwice")
        || haystack.contains("invalidaccount")
        || haystack.contains("insufficientfundsforfee")
        || haystack.contains("insufficient funds")
        || haystack.contains("missing account")
        || haystack.contains("could not find account")
        || haystack.contains("incorrect program id")
    {
        return "account-error";
    }
    if haystack.contains("instructionerror")
        || haystack.contains("custom program error")
        || haystack.contains("program failed")
        || haystack.contains("invalidinstructiondata")
        || haystack.contains("programfailedtocomplete")
    {
        return "program-error";
    }
    "unclassified-error"
}

/// Mirror of the TS regex `consumed \d+ of \d+ compute units.*failed`.
fn compute_units_failed(haystack: &str) -> bool {
    let Some(start) = haystack.find("consumed ") else {
        return false;
    };
    let rest = &haystack[start..];
    let Some(units_at) = rest.find(" of ") else {
        return false;
    };
    if !rest[..units_at]["consumed ".len()..]
        .chars()
        .all(|c| c.is_ascii_digit())
    {
        return false;
    }
    let after_of = &rest[units_at + 4..];
    let digit_count = after_of.chars().take_while(|c| c.is_ascii_digit()).count();
    if digit_count == 0 {
        return false;
    }
    let tail = &after_of[digit_count..];
    if !tail.starts_with(" compute units") {
        return false;
    }
    // The TS regex `.*failed` does not cross a newline — match on this line only.
    let line_end = tail.find('\n').unwrap_or(tail.len());
    tail[..line_end].contains("failed")
}

/// Classify one simulation-result document (raw JSON from bounded stdin). Pure.
pub fn classify_document(
    input: &str,
    created_at: Option<&str>,
) -> Result<SimClassificationReport, SimClassifyError> {
    if let Some(value) = created_at {
        if check_created_at(value).is_err() {
            return Err(SimClassifyError::BadCreatedAt);
        }
    }
    let document: Value =
        serde_json::from_str(input).map_err(|_| SimClassifyError::InputNotJson)?;
    let object = document.as_object().ok_or(SimClassifyError::NotAnObject)?;

    let err_label: Option<String> = match object.get("errLabel") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => Some(s.clone()),
        Some(_) => return Err(SimClassifyError::BadErrLabel),
    };

    let logs: Vec<String> = match object.get("logs") {
        None => Vec::new(),
        Some(Value::Array(items)) => {
            if items.len() > MAX_LOG_LINES {
                return Err(SimClassifyError::TooManyLogs(items.len()));
            }
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                let line = item.as_str().ok_or(SimClassifyError::BadLogs)?;
                out.push(line.chars().take(MAX_LOG_LINE_LEN).collect());
            }
            out
        }
        Some(_) => return Err(SimClassifyError::BadLogs),
    };

    let classification = classify(err_label.as_deref(), &logs);
    let guidance = guidance_for(classification);

    Ok(SimClassificationReport {
        schema_version: ENGINE_SIM_CLASSIFICATION_SCHEMA_VERSION,
        banner: BANNER,
        engine_name: "solmaker-engine",
        engine_version: env!("CARGO_PKG_VERSION"),
        ipc_version: IPC_VERSION,
        classification,
        classification_message: guidance.message,
        classification_next_action: guidance.next_action,
        err_label_present: err_label.is_some(),
        log_line_count: logs.len(),
        created_at: created_at.map(str::to_string),
        caveats: REPORT_CAVEATS.to_vec(),
        not_executable: true,
        never_signs: true,
        never_sends: true,
        phase7_live_trading_ready: false,
    })
}

/// Serialize exactly as the IPC contract requires.
pub fn to_ipc_json(report: &SimClassificationReport) -> String {
    let mut json = serde_json::to_string_pretty(report).expect("sim classification serializes");
    json.push('\n');
    json
}

/// Human-readable rendering for a terminal (used when --json is absent).
pub fn to_text(report: &SimClassificationReport) -> String {
    let mut lines = vec![
        "RUST ENGINE SIM CLASSIFY".to_string(),
        format!("classification: {}", report.classification),
        format!("meaning:        {}", report.classification_message),
        format!("next:           {}", report.classification_next_action),
        format!(
            "input:          errLabel {}, {} log line(s)",
            if report.err_label_present {
                "present"
            } else {
                "absent"
            },
            report.log_line_count
        ),
    ];
    for caveat in &report.caveats {
        lines.push(format!("CAVEAT: {caveat}"));
    }
    lines.join("\n") + "\n"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn logs(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn classifies_the_s95_fixture_cases_verbatim() {
        // The exact cases from packages/txpreview/src/classification.test.ts.
        assert_eq!(
            classify(
                Some("{\"InstructionError\":[3,{\"Custom\":6001}]}"),
                &logs(&["Program log: custom program error: 0x1771"])
            ),
            "slippage-or-route-error"
        );
        assert_eq!(
            classify(
                Some("{\"InstructionError\":[2,{\"Custom\":1}]}"),
                &logs(&["Program log: Slippage tolerance exceeded"])
            ),
            "slippage-or-route-error"
        );
        assert_eq!(
            classify(
                Some("{\"InstructionError\":[1,\"ComputeBudgetExceeded\"]}"),
                &[]
            ),
            "compute-exceeded"
        );
        assert_eq!(
            classify(
                Some("{\"InstructionError\":[1,\"ProgramFailedToComplete\"]}"),
                &logs(&["Program X exceeded CUs meter at BPF instruction"])
            ),
            "compute-exceeded"
        );
        assert_eq!(
            classify(Some("\"BlockhashNotFound\""), &[]),
            "blockhash-error"
        );
        assert_eq!(classify(Some("\"AccountNotFound\""), &[]), "account-error");
        assert_eq!(
            classify(Some("\"InsufficientFundsForFee\""), &[]),
            "account-error"
        );
        assert_eq!(
            classify(
                Some("{\"InstructionError\":[0,{\"Custom\":1}]}"),
                &logs(&["Transfer: insufficient funds"])
            ),
            "account-error"
        );
        assert_eq!(
            classify(
                Some("{\"InstructionError\":[4,{\"Custom\":42}]}"),
                &logs(&["Program log: something else"])
            ),
            "program-error"
        );
        assert_eq!(
            classify(Some("completely unrecognizable"), &[]),
            "unclassified-error"
        );
        assert_eq!(classify(None, &[]), "unclassified-error");
    }

    #[test]
    fn the_compute_units_consumed_pattern_matches() {
        assert_eq!(
            classify(
                Some("Program failed: consumed 200000 of 200000 compute units: failed"),
                &[]
            ),
            "compute-exceeded"
        );
        // "program failed" alone (no compute-units phrase) is a program-error.
        assert_eq!(
            classify(Some("program failed for reasons"), &[]),
            "program-error"
        );
    }

    #[test]
    fn classification_is_deterministic() {
        let a = classify(Some("\"AccountNotFound\""), &logs(&["x"]));
        let b = classify(Some("\"AccountNotFound\""), &logs(&["x"]));
        assert_eq!(a, b);
    }

    #[test]
    fn document_classification_carries_guidance_and_input_facts() {
        let input = "{\"errLabel\":\"\\\"AccountNotFound\\\"\",\"logs\":[\"a\",\"b\"]}";
        let report = classify_document(input, None).unwrap();
        assert_eq!(report.classification, "account-error");
        assert!(report.classification_next_action.contains("rebuild"));
        assert!(report.err_label_present);
        assert_eq!(report.log_line_count, 2);
        assert!(report.not_executable);
        assert!(!report.phase7_live_trading_ready);
    }

    #[test]
    fn malformed_documents_are_refused() {
        assert_eq!(
            classify_document("nope{", None).unwrap_err(),
            SimClassifyError::InputNotJson
        );
        assert_eq!(
            classify_document("[1,2]", None).unwrap_err(),
            SimClassifyError::NotAnObject
        );
        assert_eq!(
            classify_document("{\"errLabel\":42}", None).unwrap_err(),
            SimClassifyError::BadErrLabel
        );
        assert_eq!(
            classify_document("{\"logs\":[1]}", None).unwrap_err(),
            SimClassifyError::BadLogs
        );
        let many = format!("{{\"logs\":[{}]}}", vec!["\"x\""; 51].join(","));
        assert_eq!(
            classify_document(&many, None).unwrap_err(),
            SimClassifyError::TooManyLogs(51)
        );
        assert_eq!(
            classify_document("{}", Some("not-a-time")).unwrap_err(),
            SimClassifyError::BadCreatedAt
        );
    }

    #[test]
    fn no_guidance_suggests_bypassing_a_gate() {
        for g in &GUIDANCE {
            let text = format!("{} {}", g.message, g.next_action).to_lowercase();
            assert!(!text.contains("bypass"));
            assert!(!text.contains("force it"));
            assert!(!text.contains("skip the simulation"));
        }
    }

    #[test]
    fn identical_input_serializes_byte_identically() {
        let input = "{\"errLabel\":\"\\\"BlockhashNotFound\\\"\"}";
        let a = to_ipc_json(&classify_document(input, Some("2026-06-12T00:00:00.000Z")).unwrap());
        let b = to_ipc_json(&classify_document(input, Some("2026-06-12T00:00:00.000Z")).unwrap());
        assert_eq!(a, b);
        assert!(a.ends_with('\n'));
    }
}
