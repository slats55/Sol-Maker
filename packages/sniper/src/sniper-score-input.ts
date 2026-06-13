/**
 * Deterministic, offline, **PAPER-only** SNIPER SCORE INPUT bundle (Sprint 101).
 *
 * The candidate scoring layer needs ONE normalized, versioned bundle of already-collected facts to
 * rank. This module builds and validates `sniper.score.input.v1`: a per-candidate set of facts
 * (advisory risk, token mechanics, route-quote quality, simulation/build evidence) that the Rust
 * `sniper-score` engine consumes over bounded stdin and the TypeScript parity wall cross-checks.
 *
 *   candidates + facts → **score input normalize/validate** → Rust sniper-score → TS parity wall
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work — it normalizes LOCAL,
 * already-loaded values and NEVER fetches chain data. Risk + inspection facts are derived from
 * supplied `token:risk` / `token:inspect`-shaped objects with the SAME projections the sniper
 * preflight uses ({@link projectSniperPreflightRisk} / {@link projectSniperPreflightInspection}), so
 * the bundle is grounded in real artifacts. Every mint is validated with the pure base58 parser,
 * which REFUSES secret-length input outright (never echoed). Carries no wall-clock time.
 *
 * The bundle is INPUT only: it is not a score, not a verdict, not a trade signal, and not a
 * profitability claim. The score and the closed verdicts (`watch` / `caution` / `reject` /
 * `insufficient-evidence`) are produced downstream by the Rust engine and validated by TypeScript.
 */

import { redactString } from "@soulmaker/security";
import type { RiskDecision } from "@soulmaker/risk";
import { parseMintAddress } from "./mint-address.js";
import {
  projectSniperPreflightInspection,
  projectSniperPreflightRisk,
} from "./token-preflight.js";

/** Stable schema identifier for the score input bundle. Bump only on a breaking change. */
export const SNIPER_SCORE_INPUT_SCHEMA_VERSION = "sniper.score.input.v1";

/** The banner that prefixes every score input bundle (required label). */
export const SNIPER_SCORE_INPUT_BANNER = "SIMULATED PAPER-ONLY SNIPER SCORE INPUT";

/** Required disclaimer statements carried by every score input bundle (stable order). */
export const SNIPER_SCORE_INPUT_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SNIPER SCORE INPUT — a normalized bundle of LOCAL, already-collected per-candidate facts (risk, token mechanics, quote quality, simulation evidence) for the deterministic candidate scorer.",
  "LOCAL-ONLY: nothing here fetches chain data, and a well-formed bundle verifies NO on-chain fact. Risk/inspection facts are projected from supplied token:risk / token:inspect output, never re-derived from chain.",
  "This bundle is INPUT — it is NOT a score, NOT a verdict, NOT a trade signal, and NOT a profitability claim. The score and verdicts are produced downstream and re-checked by TypeScript.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this bundle.",
];

/** The scoring mode a bundle was collected for (closed set). */
export type SniperScoreMode = "paper" | "mainnet-dry-run" | "devnet";
export const SNIPER_SCORE_MODES: readonly SniperScoreMode[] = ["paper", "mainnet-dry-run", "devnet"];

/** Liquidity evidence hint (closed set). `unknown`/absent are honest gaps, never assumed adequate. */
export type SniperScoreLiquidityHint = "low" | "adequate" | "unknown";
const LIQUIDITY_HINTS: ReadonlySet<string> = new Set(["low", "adequate", "unknown"]);

/** Quote freshness verdict — mirrors the closed QUOTE_FRESHNESS_VERDICTS set. */
export type SniperScoreQuoteFreshness =
  | "fresh"
  | "stale"
  | "missing-timestamp"
  | "malformed-timestamp"
  | "future-timestamp";
const QUOTE_FRESHNESS: ReadonlySet<string> = new Set([
  "fresh",
  "stale",
  "missing-timestamp",
  "malformed-timestamp",
  "future-timestamp",
]);

/** Simulation outcome (closed set). `unavailable`/absent never invents a pass. */
export type SniperScoreSimulationOutcome = "simulated-ok" | "failed" | "unavailable";
const SIMULATION_OUTCOMES: ReadonlySet<string> = new Set(["simulated-ok", "failed", "unavailable"]);

/** Simulation-failure classification — mirrors the S95 closed set (only meaningful when failed). */
export type SniperScoreSimulationClassification =
  | "slippage-or-route-error"
  | "compute-exceeded"
  | "blockhash-error"
  | "account-error"
  | "program-error"
  | "unclassified-error";
const SIMULATION_CLASSIFICATIONS: ReadonlySet<string> = new Set([
  "slippage-or-route-error",
  "compute-exceeded",
  "blockhash-error",
  "account-error",
  "program-error",
  "unclassified-error",
]);

const RISK_DECISIONS: ReadonlySet<string> = new Set(["REJECT", "CAUTION", "PASS_FOR_PAPER_EVALUATION"]);

/** Bounds (mirrored in the Rust engine + the bridge validator). */
export const SNIPER_SCORE_INPUT_MAX_CANDIDATES = 500;
const MAX_CAVEATS_PER_CANDIDATE = 12;
const MAX_LABEL_LEN = 64;
const MAX_CAVEAT_LEN = 280;

/** The canonical, fully-populated per-candidate facts (every field present; absent → null). */
export interface SniperScoreFacts {
  riskDecision: RiskDecision | null;
  riskScore: number | null;
  riskCriticalFlagCount: number | null;
  riskHighFlagCount: number | null;
  freezeAuthorityPresent: boolean | null;
  mintAuthorityPresent: boolean | null;
  token2022Blocker: boolean | null;
  holderConcentrationRisk: boolean | null;
  metadataMutable: boolean | null;
  liquidityHint: SniperScoreLiquidityHint | null;
  quoteObserved: boolean | null;
  quoteScore: number | null;
  quoteFreshness: SniperScoreQuoteFreshness | null;
  priceImpactHigh: boolean | null;
  simulationOutcome: SniperScoreSimulationOutcome | null;
  simulationClassification: SniperScoreSimulationClassification | null;
  txBuildRefused: boolean | null;
}

/** The closed key set of the canonical facts object, in serialized order. */
export const SNIPER_SCORE_FACT_KEYS: readonly (keyof SniperScoreFacts)[] = [
  "riskDecision",
  "riskScore",
  "riskCriticalFlagCount",
  "riskHighFlagCount",
  "freezeAuthorityPresent",
  "mintAuthorityPresent",
  "token2022Blocker",
  "holderConcentrationRisk",
  "metadataMutable",
  "liquidityHint",
  "quoteObserved",
  "quoteScore",
  "quoteFreshness",
  "priceImpactHigh",
  "simulationOutcome",
  "simulationClassification",
  "txBuildRefused",
];

/** Thrown when a score-input INPUT or a produced bundle is structurally invalid. */
export class SniperScoreInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperScoreInputError";
  }
}

// --- raw input ---------------------------------------------------------------

/** One operator-supplied raw entry. Explicit fact fields win over values derived from risk/inspection. */
export interface SniperScoreInputEntryInput {
  candidateId: string;
  mint: string;
  source?: string | null;
  /** A parsed `token:risk` report — risk facts are projected from it when the explicit fields are absent. */
  risk?: unknown;
  /** A parsed `token:inspect` report — freeze/mint authority is projected from it when absent. */
  inspection?: unknown;
  /** A nested canonical facts object (lets a canonical bundle round-trip through normalize). */
  facts?: Partial<SniperScoreFacts>;
  // Explicit fact overrides (all optional; a top-level field wins over the same key inside `facts`):
  riskDecision?: RiskDecision | null;
  riskScore?: number | null;
  riskCriticalFlagCount?: number | null;
  riskHighFlagCount?: number | null;
  freezeAuthorityPresent?: boolean | null;
  mintAuthorityPresent?: boolean | null;
  token2022Blocker?: boolean | null;
  holderConcentrationRisk?: boolean | null;
  metadataMutable?: boolean | null;
  liquidityHint?: SniperScoreLiquidityHint | null;
  quoteObserved?: boolean | null;
  quoteScore?: number | null;
  quoteFreshness?: SniperScoreQuoteFreshness | null;
  priceImpactHigh?: boolean | null;
  simulationOutcome?: SniperScoreSimulationOutcome | null;
  simulationClassification?: SniperScoreSimulationClassification | null;
  txBuildRefused?: boolean | null;
  caveats?: string[];
}

/** Everything {@link normalizeSniperScoreInput} accepts. */
export interface NormalizeSniperScoreInputInput {
  sourceLabel?: string | null;
  mode?: SniperScoreMode;
  network?: string | null;
  entries?: SniperScoreInputEntryInput[];
}

// --- model -------------------------------------------------------------------

/** One validated entry in the canonical bundle. */
export interface SniperScoreInputEntry {
  candidateId: string;
  mint: string;
  source: string | null;
  facts: SniperScoreFacts;
  caveats: string[];
}

/** The full, deterministic, JSON-serializable score input bundle. */
export interface SniperScoreInput {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  sourceLabel: string | null;
  mode: SniperScoreMode;
  network: string | null;
  candidateCount: number;
  candidates: SniperScoreInputEntry[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeLabel(value: unknown, name: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new SniperScoreInputError(`${name} must be a string when present`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) throw new SniperScoreInputError(`${name} exceeds ${max} characters`);
  if (redactString(trimmed) !== trimmed) throw new SniperScoreInputError(`${name} is secret-shaped and is refused`);
  return trimmed;
}

function optBool(value: unknown, name: string): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw new SniperScoreInputError(`${name} must be a boolean when present`);
  return value;
}

function optScore(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new SniperScoreInputError(`${name} must be a number between 0 and 100 when present`);
  }
  return value;
}

function optQuoteScore(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new SniperScoreInputError(`${name} must be an integer between 0 and 100 when present`);
  }
  return value;
}

function optCount(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new SniperScoreInputError(`${name} must be a non-negative integer when present`);
  }
  return value;
}

function optEnum<T extends string>(value: unknown, name: string, allowed: ReadonlySet<string>): T | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new SniperScoreInputError(`${name} must be one of: ${[...allowed].join(", ")}`);
  }
  return value as T;
}

/** Pick the explicit value when present, else the value derived from a raw artifact, else null. */
function pick<T>(explicit: T | null, derived: T | null): T | null {
  return explicit !== null ? explicit : derived;
}

/** Build one canonical entry from a raw entry (pure). */
function buildEntry(raw: SniperScoreInputEntryInput, index: number): SniperScoreInputEntry {
  if (!isObject(raw)) throw new SniperScoreInputError(`entries[${index}] must be an object`);
  if (typeof raw.candidateId !== "string" || raw.candidateId.trim().length === 0) {
    throw new SniperScoreInputError(`entries[${index}].candidateId must be a non-empty string`);
  }
  const candidateId = raw.candidateId.trim();
  if (candidateId.length > MAX_LABEL_LEN) throw new SniperScoreInputError(`entries[${index}].candidateId exceeds ${MAX_LABEL_LEN} characters`);
  if (redactString(candidateId) !== candidateId) throw new SniperScoreInputError(`entries[${index}].candidateId is secret-shaped and is refused`);
  let mint: string;
  try {
    mint = parseMintAddress(raw.mint);
  } catch (err) {
    throw new SniperScoreInputError(`entries[${index}] ("${candidateId}"): ${(err as Error).message}`);
  }

  // Derive risk + inspection facts from supplied raw artifacts (same projections the preflight uses).
  const riskProjection = raw.risk !== undefined && raw.risk !== null ? projectSniperPreflightRisk(raw.risk, mint) : null;
  const inspectionProjection =
    raw.inspection !== undefined && raw.inspection !== null ? projectSniperPreflightInspection(raw.inspection, mint) : null;

  const where = `entries[${index}]`;
  const nested = isObject(raw.facts) ? (raw.facts as Record<string, unknown>) : {};
  // A top-level explicit field wins over the same key nested under `facts` (which lets a canonical
  // bundle round-trip through normalize); both win over a value derived from a raw artifact.
  const field = (key: keyof SniperScoreFacts): unknown =>
    (raw as Record<string, unknown>)[key] !== undefined ? (raw as Record<string, unknown>)[key] : nested[key];

  const facts: SniperScoreFacts = {
    riskDecision: pick(optEnum<RiskDecision>(field("riskDecision"), `${where}.riskDecision`, RISK_DECISIONS), riskProjection?.decision ?? null),
    riskScore: pick(optScore(field("riskScore"), `${where}.riskScore`), riskProjection?.score ?? null),
    riskCriticalFlagCount: pick(optCount(field("riskCriticalFlagCount"), `${where}.riskCriticalFlagCount`), riskProjection?.criticalFlagCount ?? null),
    riskHighFlagCount: pick(optCount(field("riskHighFlagCount"), `${where}.riskHighFlagCount`), riskProjection?.highFlagCount ?? null),
    freezeAuthorityPresent: pick(optBool(field("freezeAuthorityPresent"), `${where}.freezeAuthorityPresent`), inspectionProjection?.freezeAuthorityPresent ?? null),
    mintAuthorityPresent: pick(optBool(field("mintAuthorityPresent"), `${where}.mintAuthorityPresent`), inspectionProjection?.mintAuthorityPresent ?? null),
    token2022Blocker: optBool(field("token2022Blocker"), `${where}.token2022Blocker`),
    holderConcentrationRisk: optBool(field("holderConcentrationRisk"), `${where}.holderConcentrationRisk`),
    metadataMutable: optBool(field("metadataMutable"), `${where}.metadataMutable`),
    liquidityHint: optEnum<SniperScoreLiquidityHint>(field("liquidityHint"), `${where}.liquidityHint`, LIQUIDITY_HINTS),
    quoteObserved: optBool(field("quoteObserved"), `${where}.quoteObserved`),
    quoteScore: optQuoteScore(field("quoteScore"), `${where}.quoteScore`),
    quoteFreshness: optEnum<SniperScoreQuoteFreshness>(field("quoteFreshness"), `${where}.quoteFreshness`, QUOTE_FRESHNESS),
    priceImpactHigh: optBool(field("priceImpactHigh"), `${where}.priceImpactHigh`),
    simulationOutcome: optEnum<SniperScoreSimulationOutcome>(field("simulationOutcome"), `${where}.simulationOutcome`, SIMULATION_OUTCOMES),
    simulationClassification: optEnum<SniperScoreSimulationClassification>(
      field("simulationClassification"),
      `${where}.simulationClassification`,
      SIMULATION_CLASSIFICATIONS,
    ),
    txBuildRefused: optBool(field("txBuildRefused"), `${where}.txBuildRefused`),
  };

  const caveats = normalizeCaveats(raw.caveats, where);
  return { candidateId, mint, source: safeLabel(raw.source, `${where}.source`, MAX_LABEL_LEN), facts, caveats };
}

function normalizeCaveats(value: unknown, where: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SniperScoreInputError(`${where}.caveats must be an array of strings`);
  if (value.length > MAX_CAVEATS_PER_CANDIDATE) throw new SniperScoreInputError(`${where}.caveats exceeds ${MAX_CAVEATS_PER_CANDIDATE} entries`);
  return value.map((c, i) => {
    if (typeof c !== "string" || c.trim().length === 0) throw new SniperScoreInputError(`${where}.caveats[${i}] must be a non-empty string`);
    const trimmed = c.trim();
    if (trimmed.length > MAX_CAVEAT_LEN) throw new SniperScoreInputError(`${where}.caveats[${i}] exceeds ${MAX_CAVEAT_LEN} characters`);
    if (redactString(trimmed) !== trimmed) throw new SniperScoreInputError(`${where}.caveats[${i}] is secret-shaped and is refused`);
    return trimmed;
  });
}

// --- normalize ----------------------------------------------------------------

/**
 * Normalize operator-friendly raw input into a canonical {@link SniperScoreInput}. Pure,
 * non-mutating, and idempotent (a canonical bundle re-normalizes to itself). Duplicate candidateIds
 * are REFUSED; every mint is validated with the pure base58 parser (a secret-length string is
 * refused and never echoed). Throws {@link SniperScoreInputError} on any structural problem.
 */
export function normalizeSniperScoreInput(input: NormalizeSniperScoreInputInput = {}): SniperScoreInput {
  if (!isObject(input)) throw new SniperScoreInputError("score input must be an object");
  if (input.entries !== undefined && !Array.isArray(input.entries)) {
    throw new SniperScoreInputError("score input.entries must be an array when present");
  }
  const rawEntries = input.entries ?? [];
  if (rawEntries.length > SNIPER_SCORE_INPUT_MAX_CANDIDATES) {
    throw new SniperScoreInputError(`score input carries ${rawEntries.length} entries — more than ${SNIPER_SCORE_INPUT_MAX_CANDIDATES}; bound it`);
  }
  const candidates = rawEntries.map((raw, i) => buildEntry(raw, i));

  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.candidateId)) throw new SniperScoreInputError(`duplicate entry for candidateId "${c.candidateId}"`);
    seen.add(c.candidateId);
  }

  const mode = (input.mode ?? "paper") as SniperScoreMode;
  if (!(SNIPER_SCORE_MODES as readonly string[]).includes(mode)) {
    throw new SniperScoreInputError(`score input.mode must be one of: ${SNIPER_SCORE_MODES.join(", ")}`);
  }

  return {
    schemaVersion: SNIPER_SCORE_INPUT_SCHEMA_VERSION,
    banner: SNIPER_SCORE_INPUT_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...SNIPER_SCORE_INPUT_DISCLAIMERS],
    sourceLabel: safeLabel(input.sourceLabel, "score input.sourceLabel", MAX_LABEL_LEN),
    mode,
    network: safeLabel(input.network, "score input.network", MAX_LABEL_LEN),
    candidateCount: candidates.length,
    candidates,
  };
}

// --- validation (backstop) ---------------------------------------------------

function validateFacts(value: unknown, where: string): void {
  if (!isObject(value)) throw new SniperScoreInputError(`${where}.facts must be an object`);
  for (const key of Object.keys(value)) {
    if (!(SNIPER_SCORE_FACT_KEYS as readonly string[]).includes(key)) {
      throw new SniperScoreInputError(`${where}.facts has unknown field "${key}" (the facts set is CLOSED)`);
    }
  }
  for (const key of SNIPER_SCORE_FACT_KEYS) {
    if (!(key in value)) throw new SniperScoreInputError(`${where}.facts is missing field "${key}"`);
  }
  // Re-run the per-field guards on the canonical facts (they accept the canonical value or null).
  optEnum(value.riskDecision, `${where}.facts.riskDecision`, RISK_DECISIONS);
  optScore(value.riskScore, `${where}.facts.riskScore`);
  optCount(value.riskCriticalFlagCount, `${where}.facts.riskCriticalFlagCount`);
  optCount(value.riskHighFlagCount, `${where}.facts.riskHighFlagCount`);
  optBool(value.freezeAuthorityPresent, `${where}.facts.freezeAuthorityPresent`);
  optBool(value.mintAuthorityPresent, `${where}.facts.mintAuthorityPresent`);
  optBool(value.token2022Blocker, `${where}.facts.token2022Blocker`);
  optBool(value.holderConcentrationRisk, `${where}.facts.holderConcentrationRisk`);
  optBool(value.metadataMutable, `${where}.facts.metadataMutable`);
  optEnum(value.liquidityHint, `${where}.facts.liquidityHint`, LIQUIDITY_HINTS);
  optBool(value.quoteObserved, `${where}.facts.quoteObserved`);
  optQuoteScore(value.quoteScore, `${where}.facts.quoteScore`);
  optEnum(value.quoteFreshness, `${where}.facts.quoteFreshness`, QUOTE_FRESHNESS);
  optBool(value.priceImpactHigh, `${where}.facts.priceImpactHigh`);
  optEnum(value.simulationOutcome, `${where}.facts.simulationOutcome`, SIMULATION_OUTCOMES);
  optEnum(value.simulationClassification, `${where}.facts.simulationClassification`, SIMULATION_CLASSIFICATIONS);
  optBool(value.txBuildRefused, `${where}.facts.txBuildRefused`);
}

/**
 * Strictly validate a value as a canonical {@link SniperScoreInput} and return it narrowed. A
 * backstop mirroring the package's sibling validators: schema/banner/labels/disclaimers, the closed
 * facts set per entry (mint re-parsed), and the recomputed candidate count. Throws
 * {@link SniperScoreInputError} on the first problem. Pure.
 */
export function validateSniperScoreInput(value: unknown): SniperScoreInput {
  if (!isObject(value)) throw new SniperScoreInputError("score input bundle must be a JSON object");
  if (value.schemaVersion !== SNIPER_SCORE_INPUT_SCHEMA_VERSION) {
    throw new SniperScoreInputError(`score input.schemaVersion must be "${SNIPER_SCORE_INPUT_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_SCORE_INPUT_BANNER) {
    throw new SniperScoreInputError(`score input.banner must be "${SNIPER_SCORE_INPUT_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new SniperScoreInputError(`score input.${flag} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperScoreInputError("score input.disclaimers must be a non-empty array");
  }
  if (value.sourceLabel !== null && typeof value.sourceLabel !== "string") {
    throw new SniperScoreInputError("score input.sourceLabel must be a string or null");
  }
  if (value.network !== null && typeof value.network !== "string") {
    throw new SniperScoreInputError("score input.network must be a string or null");
  }
  if (typeof value.mode !== "string" || !SNIPER_SCORE_MODES.includes(value.mode as SniperScoreMode)) {
    throw new SniperScoreInputError(`score input.mode must be one of: ${SNIPER_SCORE_MODES.join(", ")}`);
  }
  if (!Array.isArray(value.candidates)) throw new SniperScoreInputError("score input.candidates must be an array");
  if (value.candidates.length > SNIPER_SCORE_INPUT_MAX_CANDIDATES) {
    throw new SniperScoreInputError(`score input.candidates exceeds the ${SNIPER_SCORE_INPUT_MAX_CANDIDATES}-entry ceiling`);
  }
  if (value.candidateCount !== value.candidates.length) {
    throw new SniperScoreInputError("score input.candidateCount must equal candidates.length");
  }

  const seen = new Set<string>();
  (value.candidates as unknown[]).forEach((e, i) => {
    const where = `score input.candidates[${i}]`;
    if (!isObject(e)) throw new SniperScoreInputError(`${where} must be an object`);
    for (const key of Object.keys(e)) {
      if (!["candidateId", "mint", "source", "facts", "caveats"].includes(key)) {
        throw new SniperScoreInputError(`${where} has unknown field "${key}" (the entry set is CLOSED)`);
      }
    }
    if (typeof e.candidateId !== "string" || e.candidateId.length === 0) {
      throw new SniperScoreInputError(`${where}.candidateId must be a non-empty string`);
    }
    if (seen.has(e.candidateId)) throw new SniperScoreInputError(`${where} duplicates candidateId "${e.candidateId}"`);
    seen.add(e.candidateId);
    let mint: string;
    try {
      mint = parseMintAddress(e.mint);
    } catch (err) {
      throw new SniperScoreInputError(`${where}: ${(err as Error).message}`);
    }
    if (mint !== e.mint) throw new SniperScoreInputError(`${where}.mint must be the canonical trimmed form`);
    if (e.source !== null && typeof e.source !== "string") throw new SniperScoreInputError(`${where}.source must be a string or null`);
    validateFacts(e.facts, where);
    normalizeCaveats(e.caveats, where);
  });
  return value as unknown as SniperScoreInput;
}
