//! The memecoin candidate SCORING hot path (Sprint 101): turn one
//! TypeScript-produced `sniper.score.input.v1` bundle (arriving over BOUNDED
//! stdin) into operator INTELLIGENCE — a deterministic per-candidate score
//! (0..100), a closed verdict (`watch` / `caution` / `reject` /
//! `insufficient-evidence`), closed reason codes, and a deterministic ranking.
//!
//! A candidate score is intelligence about a candidate and nothing else: never
//! a buy signal, never a profitability claim, never execution readiness. A
//! `REJECT` risk decision (or a critical risk flag, or a Token-2022 blocker)
//! is carried VERBATIM and the candidate stays `reject` no matter how high the
//! component sum is — the score can never bypass a hard disqualifier. Missing
//! facts produce `insufficient-evidence`, never a fake green.
//!
//! The scoring instant (`--created-at`) is an orchestrator argument; the engine
//! reads no clock, no env, no filesystem, no network. The TypeScript validator
//! RE-DERIVES every component, every verdict, every reason set, and the full
//! ranking from the same echoed facts and refuses the whole artifact on any
//! disagreement — Rust is never the authority.

use serde::Serialize;
use serde_json::{Number, Value};

use crate::ipc::IPC_VERSION;
use crate::label_safety::label_is_redaction_safe;
use crate::mint::parse_mint;
use crate::schema::ENGINE_SNIPER_SCORE_SCHEMA_VERSION;
use crate::status::check_created_at;

/// The input bundle schema this scorer consumes (produced + validated by TS).
pub const INPUT_SCHEMA_VERSION: &str = "sniper.score.input.v1";

/// Hard ceiling on candidates (mirrors SNIPER_SCORE_INPUT_MAX_CANDIDATES upstream).
pub const MAX_CANDIDATES: usize = 500;

/// Hard ceiling on caveats per candidate (mirrors the upstream bound).
const MAX_CAVEATS: usize = 12;

const BANNER: &str = "RUST ENGINE SNIPER CANDIDATE SCORES — operator intelligence computed from a read-only facts bundle; never a buy signal, never a profitability claim, never execution readiness. A high score is NOT 'safe to trade'.";

const REPORT_CAVEATS: [&str; 5] = [
    "A candidate score is INTELLIGENCE about a candidate (risk, quote quality, token mechanics, simulation evidence) — never a buy signal, never a profitability claim, never execution readiness.",
    "A high score is NOT a 'safe to trade' judgment: a REJECT risk decision, a critical risk flag, or a Token-2022 blocker keeps a candidate `reject` regardless of its component sum. The score can never bypass a hard disqualifier.",
    "Scoring feeds nothing downstream, gates nothing, satisfies none of the fourteen mainnet live-gate conditions, and leaves the dry-run evidence chain UNCHANGED. The default state of every gate stays blocked.",
    "Missing facts produce `insufficient-evidence`, never a fake green; absent evidence is an honest gap, never assumed safe.",
    "createdAt is orchestrator-supplied (--created-at); the engine reads no clock. TypeScript re-derives every score, verdict, reason set, and the ranking and refuses the artifact on any disagreement.",
];

/// Closed verdict set (parity-pinned on both sides).
const VERDICT_WATCH: &str = "watch";
const VERDICT_CAUTION: &str = "caution";
const VERDICT_REJECT: &str = "reject";
const VERDICT_INSUFFICIENT: &str = "insufficient-evidence";

/// Closed reason codes (alphabetical; the TS validator pins the set).
pub const REASON_CODES: [&str; 17] = [
    "candidate-duplicate",
    "high-price-impact",
    "holder-concentration-risk",
    "insufficient-evidence",
    "low-liquidity",
    "mainnet-live-disabled",
    "metadata-mutable-risk",
    "paper-only",
    "quote-missing",
    "quote-stale",
    "quote-unavailable",
    "risk-over-threshold",
    "risk-rejected",
    "simulation-failed",
    "simulation-unavailable",
    "token2022-blocker",
    "tx-build-refused",
];

/// Closed next-safe-action set (one per verdict).
const NEXT_WATCH: &str = "watch-and-paper-dry-run";
const NEXT_CAUTION: &str = "review-cautions-before-dry-run";
const NEXT_REJECT: &str = "do-not-proceed-risk-gate";
const NEXT_INSUFFICIENT: &str = "gather-risk-and-quote-evidence";

const RISK_DECISIONS: [&str; 3] = ["REJECT", "CAUTION", "PASS_FOR_PAPER_EVALUATION"];
const LIQUIDITY_HINTS: [&str; 3] = ["low", "adequate", "unknown"];
const QUOTE_FRESHNESS: [&str; 5] = [
    "fresh",
    "stale",
    "missing-timestamp",
    "malformed-timestamp",
    "future-timestamp",
];
const SIMULATION_OUTCOMES: [&str; 3] = ["simulated-ok", "failed", "unavailable"];
const SIMULATION_CLASSIFICATIONS: [&str; 6] = [
    "slippage-or-route-error",
    "compute-exceeded",
    "blockhash-error",
    "account-error",
    "program-error",
    "unclassified-error",
];
const SCORE_MODES: [&str; 3] = ["paper", "mainnet-dry-run", "devnet"];

/// The six transparent component buckets. Score = clamp(sum, 0, 100).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScoreComponents {
    pub risk_safety: u32,
    pub quote_quality: u32,
    pub quote_freshness: u32,
    pub liquidity: u32,
    pub token_mechanics: u32,
    pub simulation_evidence: u32,
}

/// The canonical per-candidate facts, read from the bundle (absent → None).
#[derive(Debug, Clone, PartialEq)]
struct CandidateFacts {
    risk_decision: Option<String>,
    risk_score: Option<Number>,
    risk_critical_flag_count: Option<u32>,
    risk_high_flag_count: Option<u32>,
    freeze_authority_present: Option<bool>,
    mint_authority_present: Option<bool>,
    token2022_blocker: Option<bool>,
    holder_concentration_risk: Option<bool>,
    metadata_mutable: Option<bool>,
    liquidity_hint: Option<String>,
    quote_observed: Option<bool>,
    quote_score: Option<u32>,
    quote_freshness: Option<String>,
    price_impact_high: Option<bool>,
    simulation_outcome: Option<String>,
    simulation_classification: Option<String>,
    tx_build_refused: Option<bool>,
}

/// One scored candidate. Echoed facts are carried VERBATIM so the TypeScript
/// parity wall can re-derive everything from them and cross-check the bundle.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScoredCandidate {
    pub candidate_id: String,
    pub mint: String,
    pub source: Option<String>,
    pub rank: u32,
    pub score: u32,
    pub verdict: &'static str,
    pub reason_codes: Vec<&'static str>,
    pub components: ScoreComponents,
    pub next_safe_action: &'static str,
    pub risk_decision: Option<String>,
    pub risk_score: Option<Number>,
    pub risk_critical_flag_count: Option<u32>,
    pub risk_high_flag_count: Option<u32>,
    pub freeze_authority_present: Option<bool>,
    pub mint_authority_present: Option<bool>,
    pub token2022_blocker: Option<bool>,
    pub holder_concentration_risk: Option<bool>,
    pub metadata_mutable: Option<bool>,
    pub liquidity_hint: Option<String>,
    pub quote_observed: Option<bool>,
    pub quote_score: Option<u32>,
    pub quote_freshness: Option<String>,
    pub price_impact_high: Option<bool>,
    pub simulation_outcome: Option<String>,
    pub simulation_classification: Option<String>,
    pub tx_build_refused: Option<bool>,
    pub caveats: Vec<String>,
}

/// `engine.sniper.score.report.v1`. Field order IS the serialized order; the
/// TypeScript validator treats the key set as CLOSED.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SniperScoreReport {
    pub schema_version: &'static str,
    pub banner: &'static str,
    pub engine_name: &'static str,
    pub engine_version: &'static str,
    pub ipc_version: &'static str,
    pub created_at: Option<String>,
    pub scoring_engine: &'static str,
    pub engine_source: &'static str,
    pub mode: String,
    pub network: Option<String>,
    pub candidate_count: usize,
    pub ranked_candidates: Vec<ScoredCandidate>,
    pub ranking: Vec<String>,
    pub best_candidate_id: Option<String>,
    pub caveats: Vec<&'static str>,
    pub redaction_applied: bool,
    pub not_executable: bool,
    pub not_profitability_claim: bool,
    pub never_signs: bool,
    pub never_sends: bool,
    pub phase7_live_trading_ready: bool,
    pub score_is_not_live_readiness: bool,
    pub high_score_is_not_safe_to_trade: bool,
}

/// Why a score invocation was refused (exit 2; nothing is emitted). Messages
/// carry indexes and lengths, never input values.
#[derive(Debug, PartialEq, Eq)]
pub enum ScoreError {
    InputNotJson,
    NotAnObject,
    WrongSchema,
    MissingField(&'static str),
    BadMode,
    TooManyCandidates(usize),
    BadCandidate(usize, String),
    BadCreatedAt,
}

impl std::fmt::Display for ScoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ScoreError::InputNotJson => write!(f, "stdin is not valid JSON"),
            ScoreError::NotAnObject => write!(f, "score input must be a JSON object"),
            ScoreError::WrongSchema => {
                write!(f, "score input schemaVersion must be {INPUT_SCHEMA_VERSION:?}")
            }
            ScoreError::MissingField(name) => {
                write!(f, "score input is missing required field {name:?}")
            }
            ScoreError::BadMode => write!(f, "score input mode must be one of paper|mainnet-dry-run|devnet"),
            ScoreError::TooManyCandidates(n) => {
                write!(f, "score input carries {n} candidates - more than {MAX_CANDIDATES}; bound it")
            }
            ScoreError::BadCandidate(i, reason) => write!(f, "score input candidates[{i}]: {reason}"),
            ScoreError::BadCreatedAt => write!(
                f,
                "--created-at must be ISO-8601-shaped (the orchestrator supplies the scoring instant)"
            ),
        }
    }
}

// --- field readers (defensive; absent or null → None) ------------------------

fn bounded_string(value: Option<&Value>, max: usize) -> Option<String> {
    let raw = value?.as_str()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().count() > max || !label_is_redaction_safe(trimmed) {
        return None;
    }
    Some(trimmed.to_string())
}

fn read_opt_bool(
    facts: &serde_json::Map<String, Value>,
    key: &'static str,
) -> Result<Option<bool>, String> {
    match facts.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Bool(b)) => Ok(Some(*b)),
        Some(_) => Err(format!("facts.{key} must be a boolean or null")),
    }
}

fn read_opt_enum(
    facts: &serde_json::Map<String, Value>,
    key: &'static str,
    allowed: &[&str],
) -> Result<Option<String>, String> {
    match facts.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if allowed.contains(&s.as_str()) => Ok(Some(s.clone())),
        Some(_) => Err(format!(
            "facts.{key} must be one of the closed values or null"
        )),
    }
}

fn read_opt_count(
    facts: &serde_json::Map<String, Value>,
    key: &'static str,
) -> Result<Option<u32>, String> {
    match facts.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => match n.as_u64() {
            Some(v) if v <= u32::MAX as u64 => Ok(Some(v as u32)),
            _ => Err(format!(
                "facts.{key} must be a non-negative integer or null"
            )),
        },
        Some(_) => Err(format!(
            "facts.{key} must be a non-negative integer or null"
        )),
    }
}

fn read_opt_quote_score(
    facts: &serde_json::Map<String, Value>,
    key: &'static str,
) -> Result<Option<u32>, String> {
    match facts.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => match n.as_u64() {
            Some(v) if v <= 100 => Ok(Some(v as u32)),
            _ => Err(format!(
                "facts.{key} must be an integer between 0 and 100 or null"
            )),
        },
        Some(_) => Err(format!(
            "facts.{key} must be an integer between 0 and 100 or null"
        )),
    }
}

fn read_opt_risk_score(
    facts: &serde_json::Map<String, Value>,
    key: &'static str,
) -> Result<Option<Number>, String> {
    match facts.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => match n.as_f64() {
            Some(v) if v.is_finite() && (0.0..=100.0).contains(&v) => Ok(Some(n.clone())),
            _ => Err(format!(
                "facts.{key} must be a number between 0 and 100 or null"
            )),
        },
        Some(_) => Err(format!(
            "facts.{key} must be a number between 0 and 100 or null"
        )),
    }
}

fn read_facts(object: &serde_json::Map<String, Value>) -> Result<CandidateFacts, String> {
    let facts = object
        .get("facts")
        .and_then(Value::as_object)
        .ok_or_else(|| "facts must be an object".to_string())?;
    Ok(CandidateFacts {
        risk_decision: read_opt_enum(facts, "riskDecision", &RISK_DECISIONS)?,
        risk_score: read_opt_risk_score(facts, "riskScore")?,
        risk_critical_flag_count: read_opt_count(facts, "riskCriticalFlagCount")?,
        risk_high_flag_count: read_opt_count(facts, "riskHighFlagCount")?,
        freeze_authority_present: read_opt_bool(facts, "freezeAuthorityPresent")?,
        mint_authority_present: read_opt_bool(facts, "mintAuthorityPresent")?,
        token2022_blocker: read_opt_bool(facts, "token2022Blocker")?,
        holder_concentration_risk: read_opt_bool(facts, "holderConcentrationRisk")?,
        metadata_mutable: read_opt_bool(facts, "metadataMutable")?,
        liquidity_hint: read_opt_enum(facts, "liquidityHint", &LIQUIDITY_HINTS)?,
        quote_observed: read_opt_bool(facts, "quoteObserved")?,
        quote_score: read_opt_quote_score(facts, "quoteScore")?,
        quote_freshness: read_opt_enum(facts, "quoteFreshness", &QUOTE_FRESHNESS)?,
        price_impact_high: read_opt_bool(facts, "priceImpactHigh")?,
        simulation_outcome: read_opt_enum(facts, "simulationOutcome", &SIMULATION_OUTCOMES)?,
        simulation_classification: read_opt_enum(
            facts,
            "simulationClassification",
            &SIMULATION_CLASSIFICATIONS,
        )?,
        tx_build_refused: read_opt_bool(facts, "txBuildRefused")?,
    })
}

// --- scoring (the spec the TypeScript parity wall re-derives) ----------------

/// Compute the six component buckets from the facts. Pure integer math.
fn compute_components(facts: &CandidateFacts) -> ScoreComponents {
    // risk safety (0..40)
    let risk_base = match facts.risk_decision.as_deref() {
        Some("PASS_FOR_PAPER_EVALUATION") => 40u32,
        Some("CAUTION") => 18,
        _ => 0,
    };
    let high_penalty = facts
        .risk_high_flag_count
        .unwrap_or(0)
        .saturating_mul(4)
        .min(16);
    let risk_safety = risk_base.saturating_sub(high_penalty).min(40);

    // quote quality (0..25) — only when a quote was observed AND a score exists
    let quote_quality = if facts.quote_observed == Some(true) {
        match facts.quote_score {
            Some(s) => (s.saturating_mul(25)) / 100,
            None => 0,
        }
    } else {
        0
    };

    // quote freshness (0..10)
    let quote_freshness = if facts.quote_freshness.as_deref() == Some("fresh") {
        10
    } else {
        0
    };

    // liquidity (0..10)
    let liquidity = match facts.liquidity_hint.as_deref() {
        Some("adequate") => 10,
        Some("low") => 0,
        _ => 4,
    };

    // token mechanics (0..10)
    let mechanics_absent = facts.freeze_authority_present.is_none()
        && facts.mint_authority_present.is_none()
        && facts.token2022_blocker.is_none()
        && facts.holder_concentration_risk.is_none()
        && facts.metadata_mutable.is_none();
    let token_mechanics = if mechanics_absent {
        4
    } else {
        let mut v: i32 = 10;
        if facts.freeze_authority_present == Some(true) {
            v -= 5;
        }
        if facts.mint_authority_present == Some(true) {
            v -= 3;
        }
        if facts.holder_concentration_risk == Some(true) {
            v -= 3;
        }
        if facts.metadata_mutable == Some(true) {
            v -= 2;
        }
        if facts.token2022_blocker == Some(true) {
            v -= 10;
        }
        v.clamp(0, 10) as u32
    };

    // simulation evidence (0..5)
    let simulation_evidence = match facts.simulation_outcome.as_deref() {
        Some("simulated-ok") => 5,
        Some("failed") => 0,
        _ => 2,
    };

    ScoreComponents {
        risk_safety,
        quote_quality,
        quote_freshness,
        liquidity,
        token_mechanics,
        simulation_evidence,
    }
}

fn sum_components(c: &ScoreComponents) -> u32 {
    (c.risk_safety
        + c.quote_quality
        + c.quote_freshness
        + c.liquidity
        + c.token_mechanics
        + c.simulation_evidence)
        .min(100)
}

/// Derive the verdict, the ordered reason codes, and the next safe action from
/// the facts. The order of `reasons` is fixed so the TS wall re-derives it
/// byte-for-byte.
fn derive_verdict(facts: &CandidateFacts) -> (&'static str, Vec<&'static str>, &'static str) {
    let mut reasons: Vec<&'static str> = Vec::new();
    reasons.push("paper-only");
    reasons.push("mainnet-live-disabled");

    let mut hard_reject = false;
    if facts.risk_decision.as_deref() == Some("REJECT") {
        reasons.push("risk-rejected");
        hard_reject = true;
    }
    if facts.risk_critical_flag_count.unwrap_or(0) > 0 {
        reasons.push("risk-over-threshold");
        hard_reject = true;
    }
    if facts.token2022_blocker == Some(true) {
        reasons.push("token2022-blocker");
        hard_reject = true;
    }

    let mut caution = false;
    if facts.risk_decision.as_deref() == Some("CAUTION") {
        caution = true;
    }

    match facts.quote_observed {
        Some(true) => {
            if facts.quote_freshness.as_deref() != Some("fresh") {
                reasons.push("quote-stale");
                caution = true;
            }
            if facts.price_impact_high == Some(true) {
                reasons.push("high-price-impact");
                caution = true;
            }
        }
        Some(false) => {
            reasons.push("quote-unavailable");
            caution = true;
        }
        None => {
            reasons.push("quote-missing");
            caution = true;
        }
    }

    if facts.liquidity_hint.as_deref() == Some("low") {
        reasons.push("low-liquidity");
        caution = true;
    }
    if facts.holder_concentration_risk == Some(true) {
        reasons.push("holder-concentration-risk");
        caution = true;
    }
    if facts.metadata_mutable == Some(true) {
        reasons.push("metadata-mutable-risk");
        caution = true;
    }

    match facts.simulation_outcome.as_deref() {
        Some("failed") => {
            reasons.push("simulation-failed");
            caution = true;
        }
        Some("simulated-ok") => {}
        _ => {
            reasons.push("simulation-unavailable");
        }
    }

    if facts.tx_build_refused == Some(true) {
        reasons.push("tx-build-refused");
        caution = true;
    }

    let risk_assessed = facts.risk_decision.is_some();
    if !hard_reject && !risk_assessed {
        reasons.push("insufficient-evidence");
    }

    let verdict = if hard_reject {
        VERDICT_REJECT
    } else if !risk_assessed {
        VERDICT_INSUFFICIENT
    } else if caution {
        VERDICT_CAUTION
    } else {
        VERDICT_WATCH
    };
    let next = match verdict {
        VERDICT_WATCH => NEXT_WATCH,
        VERDICT_CAUTION => NEXT_CAUTION,
        VERDICT_REJECT => NEXT_REJECT,
        _ => NEXT_INSUFFICIENT,
    };
    (verdict, reasons, next)
}

fn verdict_rank(verdict: &str) -> u32 {
    match verdict {
        VERDICT_WATCH => 3,
        VERDICT_CAUTION => 2,
        VERDICT_INSUFFICIENT => 1,
        _ => 0,
    }
}

fn normalize_caveats(object: &serde_json::Map<String, Value>) -> Result<Vec<String>, String> {
    match object.get("caveats") {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(items)) => {
            if items.len() > MAX_CAVEATS {
                return Err(format!("caveats carries more than {MAX_CAVEATS} entries"));
            }
            let mut out = Vec::with_capacity(items.len());
            for (i, item) in items.iter().enumerate() {
                match bounded_string(Some(item), 280) {
                    Some(s) => out.push(s),
                    None => {
                        return Err(format!(
                            "caveats[{i}] must be a bounded, redaction-safe string"
                        ))
                    }
                }
            }
            Ok(out)
        }
        Some(_) => Err("caveats must be an array".to_string()),
    }
}

fn score_candidate(index: usize, entry: &Value) -> Result<ScoredCandidate, ScoreError> {
    let object = entry
        .as_object()
        .ok_or_else(|| ScoreError::BadCandidate(index, "must be an object".to_string()))?;

    let candidate_id = bounded_string(object.get("candidateId"), 64).ok_or_else(|| {
        ScoreError::BadCandidate(
            index,
            "candidateId must be a bounded safe string".to_string(),
        )
    })?;
    let mint = match object.get("mint").and_then(Value::as_str) {
        Some(raw) => {
            parse_mint(raw).map_err(|e| ScoreError::BadCandidate(index, format!("mint: {e}")))?
        }
        None => {
            return Err(ScoreError::BadCandidate(
                index,
                "mint must be a string".to_string(),
            ))
        }
    };
    let source = bounded_string(object.get("source"), 64);
    let facts = read_facts(object).map_err(|e| ScoreError::BadCandidate(index, e))?;
    let caveats = normalize_caveats(object).map_err(|e| ScoreError::BadCandidate(index, e))?;

    let components = compute_components(&facts);
    let score = sum_components(&components);
    let (verdict, reason_codes, next_safe_action) = derive_verdict(&facts);

    Ok(ScoredCandidate {
        candidate_id,
        mint,
        source,
        rank: 0,
        score,
        verdict,
        reason_codes,
        components,
        next_safe_action,
        risk_decision: facts.risk_decision,
        risk_score: facts.risk_score,
        risk_critical_flag_count: facts.risk_critical_flag_count,
        risk_high_flag_count: facts.risk_high_flag_count,
        freeze_authority_present: facts.freeze_authority_present,
        mint_authority_present: facts.mint_authority_present,
        token2022_blocker: facts.token2022_blocker,
        holder_concentration_risk: facts.holder_concentration_risk,
        metadata_mutable: facts.metadata_mutable,
        liquidity_hint: facts.liquidity_hint,
        quote_observed: facts.quote_observed,
        quote_score: facts.quote_score,
        quote_freshness: facts.quote_freshness,
        price_impact_high: facts.price_impact_high,
        simulation_outcome: facts.simulation_outcome,
        simulation_classification: facts.simulation_classification,
        tx_build_refused: facts.tx_build_refused,
        caveats,
    })
}

/// Score one `sniper.score.input.v1` bundle. Pure: same input + same arguments,
/// same report, always.
pub fn score_input(input: &str, created_at: Option<&str>) -> Result<SniperScoreReport, ScoreError> {
    if let Some(value) = created_at {
        if check_created_at(value).is_err() {
            return Err(ScoreError::BadCreatedAt);
        }
    }

    let document: Value = serde_json::from_str(input).map_err(|_| ScoreError::InputNotJson)?;
    let object = document.as_object().ok_or(ScoreError::NotAnObject)?;
    if object.get("schemaVersion").and_then(Value::as_str) != Some(INPUT_SCHEMA_VERSION) {
        return Err(ScoreError::WrongSchema);
    }

    let mode = match object.get("mode").and_then(Value::as_str) {
        Some(m) if SCORE_MODES.contains(&m) => m.to_string(),
        Some(_) => return Err(ScoreError::BadMode),
        None => return Err(ScoreError::MissingField("mode")),
    };
    let network = bounded_string(object.get("network"), 64);

    let raw_candidates = object
        .get("candidates")
        .and_then(Value::as_array)
        .ok_or(ScoreError::MissingField("candidates"))?;
    if raw_candidates.len() > MAX_CANDIDATES {
        return Err(ScoreError::TooManyCandidates(raw_candidates.len()));
    }

    let mut ranked: Vec<ScoredCandidate> = Vec::with_capacity(raw_candidates.len());
    for (index, raw) in raw_candidates.iter().enumerate() {
        ranked.push(score_candidate(index, raw)?);
    }

    // Deterministic ranking: verdict rank desc, then score desc, then candidateId asc.
    ranked.sort_by(|a, b| {
        verdict_rank(b.verdict)
            .cmp(&verdict_rank(a.verdict))
            .then_with(|| b.score.cmp(&a.score))
            .then_with(|| a.candidate_id.cmp(&b.candidate_id))
    });
    for (i, candidate) in ranked.iter_mut().enumerate() {
        candidate.rank = (i + 1) as u32;
    }
    let ranking: Vec<String> = ranked.iter().map(|c| c.candidate_id.clone()).collect();
    let best_candidate_id = ranking.first().cloned();
    let candidate_count = ranked.len();

    Ok(SniperScoreReport {
        schema_version: ENGINE_SNIPER_SCORE_SCHEMA_VERSION,
        banner: BANNER,
        engine_name: "solmaker-engine",
        engine_version: env!("CARGO_PKG_VERSION"),
        ipc_version: IPC_VERSION,
        created_at: created_at.map(str::to_string),
        scoring_engine: "solmaker-engine",
        engine_source: "rust",
        mode,
        network,
        candidate_count,
        ranked_candidates: ranked,
        ranking,
        best_candidate_id,
        caveats: REPORT_CAVEATS.to_vec(),
        redaction_applied: true,
        not_executable: true,
        not_profitability_claim: true,
        never_signs: true,
        never_sends: true,
        phase7_live_trading_ready: false,
        score_is_not_live_readiness: true,
        high_score_is_not_safe_to_trade: true,
    })
}

/// Serialize exactly as the IPC contract requires: pretty JSON, trailing
/// newline, nothing else.
pub fn to_ipc_json(report: &SniperScoreReport) -> String {
    let mut json = serde_json::to_string_pretty(report).expect("score report serializes");
    json.push('\n');
    json
}

/// Human-readable rendering for a terminal (used when --json is absent).
pub fn to_text(report: &SniperScoreReport) -> String {
    let mut lines = vec![
        "RUST ENGINE SNIPER CANDIDATE SCORES".to_string(),
        format!(
            "mode:      {} ({}) - {} candidate(s)",
            report.mode,
            report.network.as_deref().unwrap_or("network unspecified"),
            report.candidate_count
        ),
    ];
    for candidate in &report.ranked_candidates {
        let reasons = if candidate.reason_codes.is_empty() {
            String::new()
        } else {
            format!(" [{}]", candidate.reason_codes.join(", "))
        };
        lines.push(format!(
            "  #{:<2} {:>3}  {:<22} {}{}",
            candidate.rank, candidate.score, candidate.verdict, candidate.candidate_id, reasons
        ));
    }
    lines.push(String::new());
    match &report.best_candidate_id {
        Some(id) => lines.push(format!(
            "best:      {id} (intelligence only — never a buy signal, never readiness, never 'safe to trade')"
        )),
        None => lines.push("best:      none (no candidates)".to_string()),
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
    const NOW: &str = "2026-06-13T12:00:00.000Z";

    fn empty_facts() -> String {
        "{\"riskDecision\":null,\"riskScore\":null,\"riskCriticalFlagCount\":null,\"riskHighFlagCount\":null,\"freezeAuthorityPresent\":null,\"mintAuthorityPresent\":null,\"token2022Blocker\":null,\"holderConcentrationRisk\":null,\"metadataMutable\":null,\"liquidityHint\":null,\"quoteObserved\":null,\"quoteScore\":null,\"quoteFreshness\":null,\"priceImpactHigh\":null,\"simulationOutcome\":null,\"simulationClassification\":null,\"txBuildRefused\":null}".to_string()
    }

    fn candidate(id: &str, mint: &str, facts: &str) -> String {
        format!("{{\"candidateId\":\"{id}\",\"mint\":\"{mint}\",\"source\":\"test\",\"facts\":{facts},\"caveats\":[]}}")
    }

    fn bundle(candidates: &[String]) -> String {
        format!(
            "{{\"schemaVersion\":\"sniper.score.input.v1\",\"mode\":\"mainnet-dry-run\",\"network\":\"mainnet-beta-readonly\",\"candidates\":[{}]}}",
            candidates.join(",")
        )
    }

    fn facts_with(overrides: &[(&str, &str)]) -> String {
        let base = empty_facts();
        let mut value: serde_json::Value = serde_json::from_str(&base).unwrap();
        let obj = value.as_object_mut().unwrap();
        for (k, v) in overrides {
            obj.insert((*k).to_string(), serde_json::from_str(v).unwrap());
        }
        serde_json::to_string(&value).unwrap()
    }

    #[test]
    fn clean_candidate_ranks_above_incomplete_candidate() {
        let clean = facts_with(&[
            ("riskDecision", "\"PASS_FOR_PAPER_EVALUATION\""),
            ("riskScore", "12"),
            ("quoteObserved", "true"),
            ("quoteScore", "90"),
            ("quoteFreshness", "\"fresh\""),
            ("liquidityHint", "\"adequate\""),
            ("simulationOutcome", "\"simulated-ok\""),
            ("freezeAuthorityPresent", "false"),
            ("mintAuthorityPresent", "false"),
        ]);
        let incomplete = empty_facts(); // no risk → insufficient-evidence
        let input = bundle(&[
            candidate("clean", WSOL, &clean),
            candidate("incomplete", BONK, &incomplete),
        ]);
        let report = score_input(&input, Some(NOW)).unwrap();
        assert_eq!(report.ranking, vec!["clean", "incomplete"]);
        let clean_c = &report.ranked_candidates[0];
        assert_eq!(clean_c.verdict, "watch");
        assert_eq!(clean_c.rank, 1);
        // risk 40 + quote 22 + fresh 10 + liq 10 + mechanics 10 + sim 5 = 97
        assert_eq!(clean_c.score, 97);
        let incomplete_c = &report.ranked_candidates[1];
        assert_eq!(incomplete_c.verdict, "insufficient-evidence");
        assert!(incomplete_c.reason_codes.contains(&"insufficient-evidence"));
    }

    #[test]
    fn rejected_risk_is_always_reject_regardless_of_quote_score() {
        // A perfect quote cannot rescue a REJECT.
        let rejected = facts_with(&[
            ("riskDecision", "\"REJECT\""),
            ("riskScore", "100"),
            ("quoteObserved", "true"),
            ("quoteScore", "100"),
            ("quoteFreshness", "\"fresh\""),
            ("liquidityHint", "\"adequate\""),
            ("simulationOutcome", "\"simulated-ok\""),
        ]);
        let input = bundle(&[candidate("bad", USDC, &rejected)]);
        let report = score_input(&input, Some(NOW)).unwrap();
        let c = &report.ranked_candidates[0];
        assert_eq!(c.verdict, "reject");
        assert!(c.reason_codes.contains(&"risk-rejected"));
        assert_eq!(c.next_safe_action, "do-not-proceed-risk-gate");
    }

    #[test]
    fn critical_flag_and_token2022_blocker_force_reject() {
        let crit = facts_with(&[
            ("riskDecision", "\"PASS_FOR_PAPER_EVALUATION\""),
            ("riskCriticalFlagCount", "1"),
        ]);
        let t22 = facts_with(&[
            ("riskDecision", "\"PASS_FOR_PAPER_EVALUATION\""),
            ("token2022Blocker", "true"),
        ]);
        let report = score_input(
            &bundle(&[candidate("crit", WSOL, &crit), candidate("t22", BONK, &t22)]),
            Some(NOW),
        )
        .unwrap();
        for c in &report.ranked_candidates {
            assert_eq!(c.verdict, "reject");
        }
        assert!(report
            .ranked_candidates
            .iter()
            .any(|c| c.reason_codes.contains(&"risk-over-threshold")));
        assert!(report
            .ranked_candidates
            .iter()
            .any(|c| c.reason_codes.contains(&"token2022-blocker")));
    }

    #[test]
    fn stale_quote_blocks_watch() {
        let stale = facts_with(&[
            ("riskDecision", "\"PASS_FOR_PAPER_EVALUATION\""),
            ("quoteObserved", "true"),
            ("quoteScore", "80"),
            ("quoteFreshness", "\"stale\""),
            ("liquidityHint", "\"adequate\""),
        ]);
        let report = score_input(&bundle(&[candidate("c", WSOL, &stale)]), Some(NOW)).unwrap();
        let c = &report.ranked_candidates[0];
        assert_eq!(c.verdict, "caution");
        assert!(c.reason_codes.contains(&"quote-stale"));
    }

    #[test]
    fn missing_quote_produces_caution_quote_missing() {
        let pass_no_quote = facts_with(&[("riskDecision", "\"PASS_FOR_PAPER_EVALUATION\"")]);
        let report =
            score_input(&bundle(&[candidate("c", WSOL, &pass_no_quote)]), Some(NOW)).unwrap();
        let c = &report.ranked_candidates[0];
        assert_eq!(c.verdict, "caution");
        assert!(c.reason_codes.contains(&"quote-missing"));
    }

    #[test]
    fn missing_risk_produces_insufficient_evidence() {
        let only_quote = facts_with(&[
            ("quoteObserved", "true"),
            ("quoteScore", "80"),
            ("quoteFreshness", "\"fresh\""),
        ]);
        let report = score_input(&bundle(&[candidate("c", WSOL, &only_quote)]), Some(NOW)).unwrap();
        let c = &report.ranked_candidates[0];
        assert_eq!(c.verdict, "insufficient-evidence");
        assert!(c.reason_codes.contains(&"insufficient-evidence"));
        assert_eq!(c.next_safe_action, "gather-risk-and-quote-evidence");
    }

    #[test]
    fn ties_break_deterministically_on_score_then_candidate_id() {
        let same = facts_with(&[
            ("riskDecision", "\"PASS_FOR_PAPER_EVALUATION\""),
            ("quoteObserved", "true"),
            ("quoteScore", "80"),
            ("quoteFreshness", "\"fresh\""),
            ("liquidityHint", "\"adequate\""),
        ]);
        let report = score_input(
            &bundle(&[candidate("z", USDC, &same), candidate("a", BONK, &same)]),
            Some(NOW),
        )
        .unwrap();
        // Same verdict + same score → candidateId asc.
        assert_eq!(report.ranking, vec!["a", "z"]);
    }

    #[test]
    fn malformed_input_and_arguments_are_refused() {
        assert_eq!(
            score_input("nope{", Some(NOW)).unwrap_err(),
            ScoreError::InputNotJson
        );
        assert_eq!(
            score_input("{\"schemaVersion\":\"other.v1\"}", Some(NOW)).unwrap_err(),
            ScoreError::WrongSchema
        );
        let good = bundle(&[candidate("c", WSOL, &empty_facts())]);
        assert_eq!(
            score_input(&good, Some("not-a-time")).unwrap_err(),
            ScoreError::BadCreatedAt
        );
        let bad_mode = good.replace("mainnet-dry-run", "live");
        assert_eq!(
            score_input(&bad_mode, Some(NOW)).unwrap_err(),
            ScoreError::BadMode
        );
        let bad_mint = bundle(&[candidate("c", "tooshort", &empty_facts())]);
        assert!(matches!(
            score_input(&bad_mint, Some(NOW)).unwrap_err(),
            ScoreError::BadCandidate(0, _)
        ));
    }

    #[test]
    fn caveats_are_preserved_verbatim() {
        let entry = format!(
            "{{\"candidateId\":\"c\",\"mint\":\"{WSOL}\",\"source\":null,\"facts\":{},\"caveats\":[\"operator note: watch the LP\"]}}",
            facts_with(&[("riskDecision", "\"PASS_FOR_PAPER_EVALUATION\"")])
        );
        let report = score_input(&bundle(&[entry]), Some(NOW)).unwrap();
        assert_eq!(
            report.ranked_candidates[0].caveats,
            vec!["operator note: watch the LP"]
        );
    }

    #[test]
    fn identical_input_serializes_byte_identically_and_pins_literals() {
        let input = bundle(&[candidate(
            "c",
            WSOL,
            &facts_with(&[("riskDecision", "\"PASS_FOR_PAPER_EVALUATION\"")]),
        )]);
        let a = to_ipc_json(&score_input(&input, Some(NOW)).unwrap());
        let b = to_ipc_json(&score_input(&input, Some(NOW)).unwrap());
        assert_eq!(a, b);
        assert!(a.ends_with('\n'));
        let report = score_input(&input, Some(NOW)).unwrap();
        assert!(report.not_executable);
        assert!(report.not_profitability_claim);
        assert!(report.never_signs);
        assert!(report.never_sends);
        assert!(!report.phase7_live_trading_ready);
        assert!(report.score_is_not_live_readiness);
        assert!(report.high_score_is_not_safe_to_trade);
        assert_eq!(report.engine_source, "rust");
        let text = to_text(&report);
        assert_eq!(text.matches("CAVEAT:").count(), report.caveats.len());
    }

    #[test]
    fn every_emitted_reason_and_verdict_is_in_the_closed_set() {
        let varied = vec![
            candidate("a", WSOL, &facts_with(&[("riskDecision", "\"REJECT\"")])),
            candidate(
                "b",
                USDC,
                &facts_with(&[("riskDecision", "\"CAUTION\""), ("quoteObserved", "false")]),
            ),
            candidate(
                "c",
                BONK,
                &facts_with(&[
                    ("holderConcentrationRisk", "true"),
                    ("metadataMutable", "true"),
                    ("liquidityHint", "\"low\""),
                    ("simulationOutcome", "\"failed\""),
                    ("simulationClassification", "\"account-error\""),
                    ("txBuildRefused", "true"),
                    ("priceImpactHigh", "true"),
                    ("quoteObserved", "true"),
                    ("quoteFreshness", "\"future-timestamp\""),
                    ("riskDecision", "\"PASS_FOR_PAPER_EVALUATION\""),
                ]),
            ),
        ];
        let report = score_input(&bundle(&varied), Some(NOW)).unwrap();
        for c in &report.ranked_candidates {
            assert!([
                VERDICT_WATCH,
                VERDICT_CAUTION,
                VERDICT_REJECT,
                VERDICT_INSUFFICIENT
            ]
            .contains(&c.verdict));
            for reason in &c.reason_codes {
                assert!(REASON_CODES.contains(reason), "{reason} not in closed set");
            }
        }
    }
}
