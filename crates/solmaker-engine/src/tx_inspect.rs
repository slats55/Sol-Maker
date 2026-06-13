//! The transaction ENVELOPE inspection hot path (Sprint 100): decode a
//! strictly-UNSIGNED `txpreview.envelope.v1` from bounded stdin and report its
//! SHAPE facts, mirroring the TypeScript `inspectUnsignedTransactionShape`
//! (`packages/txbuilder/src/inspect.ts`) field by field.
//!
//! The Solana transaction wire format is parsed BYTE BY BYTE in pure Rust —
//! there is no `solana-sdk`, no `bincode`, the dependency allowlist stays
//! exactly `serde + serde_json`. This module READS transaction bytes; it never
//! signs, never sends, never opens a socket, and refuses (exit 2) any
//! transaction carrying a non-zero signature slot — exactly as the TypeScript
//! envelope boundary does. The TypeScript bridge re-runs the real
//! `@solana/web3.js` decoder and refuses the artifact unless every fact agrees.

use serde::Serialize;
use serde_json::{json, Value};

use crate::base58;
use crate::base64;
use crate::ipc::IPC_VERSION;
use crate::label_safety::label_is_redaction_safe;
use crate::schema::ENGINE_TX_INSPECT_SCHEMA_VERSION;
use crate::status::check_created_at;

/// The envelope schema this inspector consumes (validated by TS first/again).
pub const TX_ENVELOPE_SCHEMA_VERSION: &str = "txpreview.envelope.v1";

/// Transaction versions the dry-run pipeline understands (mirrors TS).
const SUPPORTED_LEGACY: &str = "legacy";
const SUPPORTED_V0: u64 = 0;

const BANNER: &str = "RUST ENGINE TX INSPECT — shape facts decoded from a strictly-UNSIGNED transaction envelope; read-only, never signs, never sends, and validated against the TypeScript decoder before anything trusts it.";

const REPORT_CAVEATS: [&str; 4] = [
    "Shape facts only: version, blockhash presence, instruction/account counts, static program ids. The transaction BODY is never echoed.",
    "The envelope was proven UNSIGNED (every signature slot is zero); a signed transaction is refused at this boundary.",
    "TypeScript re-decodes the same envelope with @solana/web3.js and refuses the artifact unless every fact matches — the engine is never the authority.",
    "An inspectable envelope is not readiness: nothing here signs, sends, or proves a transaction would land.",
];

/// Decoded SHAPE facts — mirrors the TypeScript `TxShapeFacts` plus an explicit
/// `accountKeyCount` (the static account-key count).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TxShapeFacts {
    /// `"legacy"` or the integer version (only 0 exists today).
    pub version: Value,
    pub version_supported: bool,
    pub blockhash_present: bool,
    pub instruction_count: usize,
    pub account_key_count: usize,
    pub static_program_ids: Vec<String>,
    pub address_table_lookup_count: usize,
    pub unresolvable_program_id_count: usize,
}

/// `engine.tx.inspect.report.v1`. Field order IS the serialized order; the
/// TypeScript validator treats the key set as CLOSED.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TxInspectReport {
    pub schema_version: &'static str,
    pub banner: &'static str,
    pub engine_name: &'static str,
    pub engine_version: &'static str,
    pub ipc_version: &'static str,
    pub network: String,
    pub fee_payer_public_key: String,
    pub builder_id: String,
    pub candidate_mint: Option<String>,
    pub shape: TxShapeFacts,
    pub unsigned: bool,
    pub created_at: Option<String>,
    pub caveats: Vec<&'static str>,
    pub not_executable: bool,
    pub never_signs: bool,
    pub never_sends: bool,
    pub phase7_live_trading_ready: bool,
}

/// Why a tx-inspect invocation was refused (exit 2; nothing is emitted).
/// Messages carry positions/lengths, never transaction bytes or key material.
#[derive(Debug, PartialEq, Eq)]
pub enum TxInspectError {
    InputNotJson,
    NotAnObject,
    WrongSchema,
    MissingField(&'static str),
    BadBase64,
    TxTooLarge(usize),
    Signed,
    Malformed(&'static str),
    BadCreatedAt,
}

impl std::fmt::Display for TxInspectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TxInspectError::InputNotJson => write!(f, "stdin is not valid JSON"),
            TxInspectError::NotAnObject => write!(f, "envelope must be a JSON object"),
            TxInspectError::WrongSchema => {
                write!(f, "envelope schemaVersion must be {TX_ENVELOPE_SCHEMA_VERSION:?}")
            }
            TxInspectError::MissingField(name) => {
                write!(f, "envelope is missing or malformed field {name:?}")
            }
            TxInspectError::BadBase64 => write!(f, "envelope txBase64 is not valid base64"),
            TxInspectError::TxTooLarge(n) => {
                write!(f, "envelope transaction is {n} bytes - out of bounds for a Solana transaction")
            }
            TxInspectError::Signed => write!(
                f,
                "envelope transaction carries a signature - a SIGNED transaction is refused at this boundary"
            ),
            TxInspectError::Malformed(what) => {
                write!(f, "envelope transaction does not parse as a VersionedTransaction ({what})")
            }
            TxInspectError::BadCreatedAt => write!(
                f,
                "--created-at must be ISO-8601-shaped (the orchestrator supplies the timestamp)"
            ),
        }
    }
}

/// A forward-only byte cursor with the bounds checks the wire format needs.
struct Cursor<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Cursor { bytes, pos: 0 }
    }

    fn read_u8(&mut self) -> Option<u8> {
        let b = self.bytes.get(self.pos).copied()?;
        self.pos += 1;
        Some(b)
    }

    fn read_bytes(&mut self, n: usize) -> Option<&'a [u8]> {
        let end = self.pos.checked_add(n)?;
        let slice = self.bytes.get(self.pos..end)?;
        self.pos = end;
        Some(slice)
    }

    /// Solana shortvec (compact-u16): up to three bytes, 7 value bits each.
    fn read_compact_u16(&mut self) -> Option<usize> {
        let mut value: usize = 0;
        let mut shift: u32 = 0;
        loop {
            let byte = self.read_u8()?;
            value |= ((byte & 0x7f) as usize) << shift;
            if byte & 0x80 == 0 {
                break;
            }
            shift += 7;
            if shift > 14 {
                return None;
            }
        }
        if value > 0xffff {
            return None;
        }
        Some(value)
    }

    fn done(&self) -> bool {
        self.pos >= self.bytes.len()
    }
}

/// Parse the transaction wire format into shape facts. Mirrors what
/// `VersionedTransaction.deserialize` + `inspectUnsignedTransactionShape`
/// produce; returns `Signed` if any signature slot is non-zero.
fn parse_transaction_shape(raw: &[u8]) -> Result<TxShapeFacts, TxInspectError> {
    let mut cursor = Cursor::new(raw);

    // Signatures: shortvec of 64-byte slots, every byte must be zero (unsigned).
    let signature_count = cursor
        .read_compact_u16()
        .ok_or(TxInspectError::Malformed("signature count"))?;
    for _ in 0..signature_count {
        let slot = cursor
            .read_bytes(64)
            .ok_or(TxInspectError::Malformed("signature slot"))?;
        if slot.iter().any(|b| *b != 0) {
            return Err(TxInspectError::Signed);
        }
    }

    // Version prefix: high bit set => versioned (version = low 7 bits); else legacy.
    let prefix = *raw
        .get(cursor.pos)
        .ok_or(TxInspectError::Malformed("message header"))?;
    let (version, versioned): (Value, bool) = if prefix & 0x80 != 0 {
        cursor.pos += 1;
        (json!((prefix & 0x7f) as u64), true)
    } else {
        (json!(SUPPORTED_LEGACY), false)
    };
    let version_supported = version == json!(SUPPORTED_LEGACY) || version == json!(SUPPORTED_V0);

    // Message header: three bytes.
    cursor
        .read_bytes(3)
        .ok_or(TxInspectError::Malformed("message header"))?;

    // Static account keys: shortvec of 32-byte keys.
    let account_key_count = cursor
        .read_compact_u16()
        .ok_or(TxInspectError::Malformed("account key count"))?;
    let mut account_keys: Vec<&[u8]> = Vec::with_capacity(account_key_count);
    for _ in 0..account_key_count {
        let key = cursor
            .read_bytes(32)
            .ok_or(TxInspectError::Malformed("account key"))?;
        account_keys.push(key);
    }

    // Recent blockhash: 32 bytes; "present" means not all-zero.
    let blockhash = cursor
        .read_bytes(32)
        .ok_or(TxInspectError::Malformed("recent blockhash"))?;
    let blockhash_present = blockhash.iter().any(|b| *b != 0);

    // Instructions: shortvec of (programIdIndex, accounts, data).
    let instruction_count = cursor
        .read_compact_u16()
        .ok_or(TxInspectError::Malformed("instruction count"))?;
    let mut program_ids: Vec<String> = Vec::new();
    let mut unresolvable = 0usize;
    for _ in 0..instruction_count {
        let program_id_index = cursor
            .read_u8()
            .ok_or(TxInspectError::Malformed("program id index"))?
            as usize;
        let account_len = cursor
            .read_compact_u16()
            .ok_or(TxInspectError::Malformed("instruction accounts"))?;
        cursor
            .read_bytes(account_len)
            .ok_or(TxInspectError::Malformed("instruction accounts"))?;
        let data_len = cursor
            .read_compact_u16()
            .ok_or(TxInspectError::Malformed("instruction data"))?;
        cursor
            .read_bytes(data_len)
            .ok_or(TxInspectError::Malformed("instruction data"))?;

        match account_keys.get(program_id_index) {
            Some(key) => {
                let encoded = base58::encode(key);
                if !program_ids.contains(&encoded) {
                    program_ids.push(encoded);
                }
            }
            None => unresolvable += 1,
        }
    }
    program_ids.sort();

    // Address-lookup tables (versioned only): shortvec of (key, writable, readonly).
    let address_table_lookup_count = if versioned {
        let count = cursor
            .read_compact_u16()
            .ok_or(TxInspectError::Malformed("address table lookups"))?;
        for _ in 0..count {
            cursor
                .read_bytes(32)
                .ok_or(TxInspectError::Malformed("lookup table key"))?;
            let writable = cursor
                .read_compact_u16()
                .ok_or(TxInspectError::Malformed("lookup writable indexes"))?;
            cursor
                .read_bytes(writable)
                .ok_or(TxInspectError::Malformed("lookup writable indexes"))?;
            let readonly = cursor
                .read_compact_u16()
                .ok_or(TxInspectError::Malformed("lookup readonly indexes"))?;
            cursor
                .read_bytes(readonly)
                .ok_or(TxInspectError::Malformed("lookup readonly indexes"))?;
        }
        count
    } else {
        0
    };

    if !cursor.done() {
        return Err(TxInspectError::Malformed("trailing bytes"));
    }

    Ok(TxShapeFacts {
        version,
        version_supported,
        blockhash_present,
        instruction_count,
        account_key_count,
        static_program_ids: program_ids,
        address_table_lookup_count,
        unresolvable_program_id_count: unresolvable,
    })
}

/// Read a bounded, redaction-safe public-key-shaped string from the envelope.
fn bounded_key(value: Option<&Value>, field: &'static str) -> Result<String, TxInspectError> {
    let raw = value
        .and_then(Value::as_str)
        .ok_or(TxInspectError::MissingField(field))?;
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 44 || !label_is_redaction_safe(trimmed) {
        return Err(TxInspectError::MissingField(field));
    }
    Ok(trimmed.to_string())
}

/// Inspect one envelope document (raw JSON text from bounded stdin). Pure: same
/// input + same arguments, same report, always.
pub fn inspect_envelope(
    input: &str,
    created_at: Option<&str>,
) -> Result<TxInspectReport, TxInspectError> {
    if let Some(value) = created_at {
        if check_created_at(value).is_err() {
            return Err(TxInspectError::BadCreatedAt);
        }
    }
    let document: Value = serde_json::from_str(input).map_err(|_| TxInspectError::InputNotJson)?;
    let object = document.as_object().ok_or(TxInspectError::NotAnObject)?;
    if object.get("schemaVersion").and_then(Value::as_str) != Some(TX_ENVELOPE_SCHEMA_VERSION) {
        return Err(TxInspectError::WrongSchema);
    }

    let network = match object.get("network").and_then(Value::as_str) {
        Some(n @ ("devnet" | "mainnet-beta")) => n.to_string(),
        _ => return Err(TxInspectError::MissingField("network")),
    };
    let fee_payer_public_key = bounded_key(object.get("feePayerPublicKey"), "feePayerPublicKey")?;
    let builder_id = match object.get("builderId").and_then(Value::as_str) {
        Some(b)
            if !b.is_empty()
                && b.len() <= 64
                && b.bytes()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-') =>
        {
            b.to_string()
        }
        _ => return Err(TxInspectError::MissingField("builderId")),
    };
    let candidate_mint = match object.get("candidateMint") {
        None | Some(Value::Null) => None,
        other => Some(bounded_key(other, "candidateMint")?),
    };

    let tx_base64 = object
        .get("txBase64")
        .and_then(Value::as_str)
        .ok_or(TxInspectError::MissingField("txBase64"))?;
    if tx_base64.is_empty() || tx_base64.len() > 4096 {
        return Err(TxInspectError::MissingField("txBase64"));
    }
    let raw = base64::decode(tx_base64).ok_or(TxInspectError::BadBase64)?;
    if raw.is_empty() || raw.len() > 1500 {
        return Err(TxInspectError::TxTooLarge(raw.len()));
    }
    let shape = parse_transaction_shape(&raw)?;

    Ok(TxInspectReport {
        schema_version: ENGINE_TX_INSPECT_SCHEMA_VERSION,
        banner: BANNER,
        engine_name: "solmaker-engine",
        engine_version: env!("CARGO_PKG_VERSION"),
        ipc_version: IPC_VERSION,
        network,
        fee_payer_public_key,
        builder_id,
        candidate_mint,
        shape,
        unsigned: true,
        created_at: created_at.map(str::to_string),
        caveats: REPORT_CAVEATS.to_vec(),
        not_executable: true,
        never_signs: true,
        never_sends: true,
        phase7_live_trading_ready: false,
    })
}

/// Serialize exactly as the IPC contract requires: pretty JSON, trailing
/// newline, nothing else.
pub fn to_ipc_json(report: &TxInspectReport) -> String {
    let mut json = serde_json::to_string_pretty(report).expect("tx inspect report serializes");
    json.push('\n');
    json
}

/// Human-readable rendering for a terminal (used when --json is absent).
pub fn to_text(report: &TxInspectReport) -> String {
    let version = match &report.shape.version {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    };
    let mut lines = vec![
        "RUST ENGINE TX INSPECT".to_string(),
        format!("network:     {} (builder {})", report.network, report.builder_id),
        format!("fee payer:   {} (public key)", report.fee_payer_public_key),
        format!(
            "version:     {} ({})",
            version,
            if report.shape.version_supported {
                "supported"
            } else {
                "UNSUPPORTED"
            }
        ),
        format!(
            "blockhash:   {}",
            if report.shape.blockhash_present {
                "present"
            } else {
                "MISSING (zero)"
            }
        ),
        format!(
            "counts:      {} instruction(s), {} account key(s), {} ALT lookup(s), {} unresolvable program id(s)",
            report.shape.instruction_count,
            report.shape.account_key_count,
            report.shape.address_table_lookup_count,
            report.shape.unresolvable_program_id_count
        ),
        format!("programs:    {}", report.shape.static_program_ids.join(", ")),
    ];
    for caveat in &report.caveats {
        lines.push(format!("CAVEAT: {caveat}"));
    }
    lines.join("\n") + "\n"
}

#[cfg(test)]
mod tests {
    use super::*;

    fn envelope_json(tx_base64: &str, network: &str, candidate_mint: &str) -> String {
        format!(
            "{{\"schemaVersion\":\"txpreview.envelope.v1\",\"network\":\"{network}\",\"feePayerPublicKey\":\"So11111111111111111111111111111111111111112\",\"txBase64\":\"{tx_base64}\",\"builderId\":\"test-builder\",\"candidateMint\":{candidate_mint},\"routeCaveats\":[],\"constraints\":{{}},\"unsigned\":true,\"neverSigned\":true,\"phase7LiveTradingReady\":false}}"
        )
    }

    // Build a minimal valid legacy transaction by hand for deterministic tests:
    // 1 signature slot (zero), legacy header, 2 account keys, a non-zero
    // blockhash, 1 instruction invoking account index 1.
    fn hand_built_legacy(blockhash_zero: bool, signed: bool) -> Vec<u8> {
        let mut bytes: Vec<u8> = Vec::new();
        bytes.push(1); // signature count
        let mut sig = [0u8; 64];
        if signed {
            sig[0] = 9;
        }
        bytes.extend_from_slice(&sig);
        // legacy header (numReqSigs=1, readonlySigned=0, readonlyUnsigned=1)
        bytes.extend_from_slice(&[1, 0, 1]);
        // 2 static account keys
        bytes.push(2);
        bytes.extend_from_slice(&[1u8; 32]); // fee payer
        bytes.extend_from_slice(&[2u8; 32]); // program
                                             // blockhash
        bytes.extend_from_slice(&[if blockhash_zero { 0 } else { 9 }; 32]);
        // 1 instruction: programIdIndex=1, 1 account index [0], data [5]
        bytes.push(1);
        bytes.push(1); // programIdIndex
        bytes.push(1); // accounts len
        bytes.push(0); // account index 0
        bytes.push(1); // data len
        bytes.push(5); // data byte
        bytes
    }

    fn b64(bytes: &[u8]) -> String {
        // Tiny standard base64 encoder for test fixtures only.
        const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let b = [
                chunk[0],
                *chunk.get(1).unwrap_or(&0),
                *chunk.get(2).unwrap_or(&0),
            ];
            let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
            out.push(A[((n >> 18) & 63) as usize] as char);
            out.push(A[((n >> 12) & 63) as usize] as char);
            out.push(if chunk.len() > 1 {
                A[((n >> 6) & 63) as usize] as char
            } else {
                '='
            });
            out.push(if chunk.len() > 2 {
                A[(n & 63) as usize] as char
            } else {
                '='
            });
        }
        out
    }

    #[test]
    fn a_legacy_unsigned_transaction_inspects() {
        let tx = hand_built_legacy(false, false);
        let json = envelope_json(&b64(&tx), "mainnet-beta", "null");
        let report = inspect_envelope(&json, None).unwrap();
        assert_eq!(report.shape.version, json!("legacy"));
        assert!(report.shape.version_supported);
        assert!(report.shape.blockhash_present);
        assert_eq!(report.shape.instruction_count, 1);
        assert_eq!(report.shape.account_key_count, 2);
        assert_eq!(report.shape.address_table_lookup_count, 0);
        assert_eq!(report.shape.unresolvable_program_id_count, 0);
        // The program is account key index 1 = 32 bytes of value 2.
        assert_eq!(
            report.shape.static_program_ids,
            vec![base58::encode(&[2u8; 32])]
        );
        assert!(report.unsigned);
        assert!(report.not_executable);
        assert!(!report.phase7_live_trading_ready);
    }

    #[test]
    fn a_v0_transaction_reports_version_zero_and_alt_lookups() {
        let mut bytes: Vec<u8> = Vec::new();
        bytes.push(0); // no signatures
        bytes.push(0x80); // v0 prefix
        bytes.extend_from_slice(&[1, 0, 0]); // header
        bytes.push(1); // 1 static key
        bytes.extend_from_slice(&[3u8; 32]);
        bytes.extend_from_slice(&[7u8; 32]); // blockhash present
        bytes.push(1); // 1 instruction
        bytes.push(0); // programIdIndex 0
        bytes.push(0); // 0 accounts
        bytes.push(0); // 0 data
        bytes.push(1); // 1 ALT lookup
        bytes.extend_from_slice(&[4u8; 32]); // lookup key
        bytes.push(1); // 1 writable index
        bytes.push(5);
        bytes.push(0); // 0 readonly indexes
        let json = envelope_json(&b64(&bytes), "devnet", "null");
        let report = inspect_envelope(&json, None).unwrap();
        assert_eq!(report.shape.version, json!(0));
        assert!(report.shape.version_supported);
        assert_eq!(report.shape.address_table_lookup_count, 1);
        assert_eq!(report.shape.instruction_count, 1);
    }

    #[test]
    fn an_instruction_with_an_alt_loaded_program_is_unresolvable() {
        let mut bytes: Vec<u8> = Vec::new();
        bytes.push(0);
        bytes.push(0x80);
        bytes.extend_from_slice(&[1, 0, 0]);
        bytes.push(1); // 1 static key (index 0)
        bytes.extend_from_slice(&[3u8; 32]);
        bytes.extend_from_slice(&[7u8; 32]);
        bytes.push(1);
        bytes.push(5); // programIdIndex 5 -> beyond static keys
        bytes.push(0);
        bytes.push(0);
        bytes.push(0); // 0 ALT lookups
        let json = envelope_json(&b64(&bytes), "devnet", "null");
        let report = inspect_envelope(&json, None).unwrap();
        assert_eq!(report.shape.unresolvable_program_id_count, 1);
        assert!(report.shape.static_program_ids.is_empty());
    }

    #[test]
    fn a_zero_blockhash_is_reported_absent() {
        let tx = hand_built_legacy(true, false);
        let json = envelope_json(&b64(&tx), "mainnet-beta", "null");
        let report = inspect_envelope(&json, None).unwrap();
        assert!(!report.shape.blockhash_present);
    }

    #[test]
    fn a_signed_transaction_is_refused() {
        let tx = hand_built_legacy(false, true);
        let json = envelope_json(&b64(&tx), "mainnet-beta", "null");
        assert_eq!(
            inspect_envelope(&json, None).unwrap_err(),
            TxInspectError::Signed
        );
    }

    #[test]
    fn malformed_envelopes_and_arguments_are_refused() {
        assert_eq!(
            inspect_envelope("nope{", None).unwrap_err(),
            TxInspectError::InputNotJson
        );
        assert_eq!(
            inspect_envelope("{\"schemaVersion\":\"other.v1\"}", None).unwrap_err(),
            TxInspectError::WrongSchema
        );
        let bad_b64 = envelope_json("not!base64!", "devnet", "null");
        assert_eq!(
            inspect_envelope(&bad_b64, None).unwrap_err(),
            TxInspectError::BadBase64
        );
        let truncated = envelope_json(&b64(&[1, 0, 0, 0]), "devnet", "null");
        assert!(matches!(
            inspect_envelope(&truncated, None).unwrap_err(),
            TxInspectError::Malformed(_)
        ));
        let tx = hand_built_legacy(false, false);
        let good = envelope_json(&b64(&tx), "mainnet-beta", "null");
        assert_eq!(
            inspect_envelope(&good, Some("not-a-time")).unwrap_err(),
            TxInspectError::BadCreatedAt
        );
    }

    #[test]
    fn identical_input_serializes_byte_identically_and_text_carries_caveats() {
        let tx = hand_built_legacy(false, false);
        let json = envelope_json(&b64(&tx), "mainnet-beta", "null");
        let a = to_ipc_json(&inspect_envelope(&json, Some("2026-06-12T00:00:00.000Z")).unwrap());
        let b = to_ipc_json(&inspect_envelope(&json, Some("2026-06-12T00:00:00.000Z")).unwrap());
        assert_eq!(a, b);
        assert!(a.ends_with('\n'));
        let report = inspect_envelope(&json, None).unwrap();
        let text = to_text(&report);
        assert_eq!(text.matches("CAVEAT:").count(), report.caveats.len());
    }

    #[test]
    fn json_uses_camel_case_closed_key_sets() {
        let tx = hand_built_legacy(false, false);
        let json = envelope_json(&b64(&tx), "mainnet-beta", "null");
        let report = inspect_envelope(&json, None).unwrap();
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
                "builderId",
                "candidateMint",
                "caveats",
                "createdAt",
                "engineName",
                "engineVersion",
                "feePayerPublicKey",
                "ipcVersion",
                "network",
                "neverSends",
                "neverSigns",
                "notExecutable",
                "phase7LiveTradingReady",
                "schemaVersion",
                "shape",
                "unsigned",
            ]
        );
        let mut shape_keys: Vec<&str> = value["shape"]
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        shape_keys.sort_unstable();
        assert_eq!(
            shape_keys,
            vec![
                "accountKeyCount",
                "addressTableLookupCount",
                "blockhashPresent",
                "instructionCount",
                "staticProgramIds",
                "unresolvableProgramIdCount",
                "version",
                "versionSupported",
            ]
        );
    }
}
