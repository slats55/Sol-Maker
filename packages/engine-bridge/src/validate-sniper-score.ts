/**
 * Strict validator for `engine.sniper.score.report.v1` — the memecoin candidate
 * scoring artifact the Rust sidecar emits (Sprint 101). TypeScript is the
 * validation AUTHORITY and never repairs Rust output:
 *
 *   - the key sets are CLOSED (report, every candidate, components);
 *   - every mint is re-parsed with the real `parseMintAddress`;
 *   - every component is RE-DERIVED from the echoed facts and compared;
 *   - every score is RECOMPUTED from its components (clamped sum);
 *   - every verdict, reason set, rank, and the ranking are RE-DERIVED with the
 *     same deterministic spec and compared — a disagreement refuses the whole
 *     artifact;
 *   - the HARD safety invariants are independently enforced: a REJECT risk
 *     decision, a critical risk flag, or a Token-2022 blocker cannot be `watch`;
 *     a stale quote cannot be `watch`; a failed simulation cannot be `watch`.
 *
 * When the original `sniper.score.input.v1` bundle is supplied, every echoed
 * fact is also cross-checked against it — Rust cannot fabricate, drop, or alter
 * a candidate's facts. A candidate score is INTELLIGENCE only: the validator
 * pins the literals that say so (notExecutable, scoreIsNotLiveReadiness, …).
 */

import { parseMintAddress } from "@soulmaker/sniper";
import { ENGINE_IPC_VERSION } from "./validate.js";

export const ENGINE_SNIPER_SCORE_SCHEMA_VERSION = "engine.sniper.score.report.v1";

/** The input bundle schema the engine consumes (mirrors the Rust + sniper-package value). */
export const ENGINE_SNIPER_SCORE_INPUT_SCHEMA_VERSION = "sniper.score.input.v1";

/** Mirrors MAX_CANDIDATES in the Rust crate. */
export const ENGINE_SNIPER_SCORE_MAX_CANDIDATES = 500;

/** Closed verdict set — verbatim mirror of the Rust verdicts. */
export const ENGINE_SNIPER_SCORE_VERDICTS = ["watch", "caution", "reject", "insufficient-evidence"] as const;
export type EngineSniperScoreVerdict = (typeof ENGINE_SNIPER_SCORE_VERDICTS)[number];

/** Closed reason codes — verbatim mirror of the Rust REASON_CODES (alphabetical). */
export const ENGINE_SNIPER_SCORE_REASON_CODES = [
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
] as const;

const SCORE_MODES = ["paper", "mainnet-dry-run", "devnet"] as const;
const RISK_DECISIONS = ["REJECT", "CAUTION", "PASS_FOR_PAPER_EVALUATION"] as const;
const LIQUIDITY_HINTS = ["low", "adequate", "unknown"] as const;
const QUOTE_FRESHNESS = ["fresh", "stale", "missing-timestamp", "malformed-timestamp", "future-timestamp"] as const;
const SIMULATION_OUTCOMES = ["simulated-ok", "failed", "unavailable"] as const;
const SIMULATION_CLASSIFICATIONS = [
  "slippage-or-route-error",
  "compute-exceeded",
  "blockhash-error",
  "account-error",
  "program-error",
  "unclassified-error",
] as const;

const NEXT_ACTION: Record<EngineSniperScoreVerdict, string> = {
  watch: "watch-and-paper-dry-run",
  caution: "review-cautions-before-dry-run",
  reject: "do-not-proceed-risk-gate",
  "insufficient-evidence": "gather-risk-and-quote-evidence",
};

export interface EngineSniperScoreComponents {
  readonly riskSafety: number;
  readonly quoteQuality: number;
  readonly quoteFreshness: number;
  readonly liquidity: number;
  readonly tokenMechanics: number;
  readonly simulationEvidence: number;
}

export interface EngineSniperScoreCandidate {
  readonly candidateId: string;
  readonly mint: string;
  readonly source: string | null;
  readonly rank: number;
  readonly score: number;
  readonly verdict: EngineSniperScoreVerdict;
  readonly reasonCodes: readonly string[];
  readonly components: EngineSniperScoreComponents;
  readonly nextSafeAction: string;
  readonly riskDecision: string | null;
  readonly riskScore: number | null;
  readonly riskCriticalFlagCount: number | null;
  readonly riskHighFlagCount: number | null;
  readonly freezeAuthorityPresent: boolean | null;
  readonly mintAuthorityPresent: boolean | null;
  readonly token2022Blocker: boolean | null;
  readonly holderConcentrationRisk: boolean | null;
  readonly metadataMutable: boolean | null;
  readonly liquidityHint: string | null;
  readonly quoteObserved: boolean | null;
  readonly quoteScore: number | null;
  readonly quoteFreshness: string | null;
  readonly priceImpactHigh: boolean | null;
  readonly simulationOutcome: string | null;
  readonly simulationClassification: string | null;
  readonly txBuildRefused: boolean | null;
  readonly caveats: readonly string[];
}

export interface EngineSniperScoreReportV1 {
  readonly schemaVersion: typeof ENGINE_SNIPER_SCORE_SCHEMA_VERSION;
  readonly banner: string;
  readonly engineName: "solmaker-engine";
  readonly engineVersion: string;
  readonly ipcVersion: typeof ENGINE_IPC_VERSION;
  readonly createdAt: string | null;
  readonly scoringEngine: "solmaker-engine";
  readonly engineSource: "rust";
  readonly mode: (typeof SCORE_MODES)[number];
  readonly network: string | null;
  readonly candidateCount: number;
  readonly rankedCandidates: readonly EngineSniperScoreCandidate[];
  readonly ranking: readonly string[];
  readonly bestCandidateId: string | null;
  readonly caveats: readonly string[];
  readonly redactionApplied: true;
  readonly notExecutable: true;
  readonly notProfitabilityClaim: true;
  readonly neverSigns: true;
  readonly neverSends: true;
  readonly phase7LiveTradingReady: false;
  readonly scoreIsNotLiveReadiness: true;
  readonly highScoreIsNotSafeToTrade: true;
}

const EXPECTED_KEYS = [
  "schemaVersion",
  "banner",
  "engineName",
  "engineVersion",
  "ipcVersion",
  "createdAt",
  "scoringEngine",
  "engineSource",
  "mode",
  "network",
  "candidateCount",
  "rankedCandidates",
  "ranking",
  "bestCandidateId",
  "caveats",
  "redactionApplied",
  "notExecutable",
  "notProfitabilityClaim",
  "neverSigns",
  "neverSends",
  "phase7LiveTradingReady",
  "scoreIsNotLiveReadiness",
  "highScoreIsNotSafeToTrade",
] as const;

const EXPECTED_CANDIDATE_KEYS = [
  "candidateId",
  "mint",
  "source",
  "rank",
  "score",
  "verdict",
  "reasonCodes",
  "components",
  "nextSafeAction",
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
  "caveats",
] as const;

const EXPECTED_COMPONENT_KEYS = ["riskSafety", "quoteQuality", "quoteFreshness", "liquidity", "tokenMechanics", "simulationEvidence"] as const;

const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/;
const VERSION_SHAPE = /^\d+\.\d+\.\d+$/;

/** The closed facts the scorer reads. Mirrors the Rust CandidateFacts (absent → null). */
interface ScoreFacts {
  riskDecision: string | null;
  riskCriticalFlagCount: number | null;
  riskHighFlagCount: number | null;
  freezeAuthorityPresent: boolean | null;
  mintAuthorityPresent: boolean | null;
  token2022Blocker: boolean | null;
  holderConcentrationRisk: boolean | null;
  metadataMutable: boolean | null;
  liquidityHint: string | null;
  quoteObserved: boolean | null;
  quoteScore: number | null;
  quoteFreshness: string | null;
  priceImpactHigh: boolean | null;
  simulationOutcome: string | null;
  txBuildRefused: boolean | null;
}

function factsOf(c: Record<string, unknown>): ScoreFacts {
  return {
    riskDecision: typeof c.riskDecision === "string" ? c.riskDecision : null,
    riskCriticalFlagCount: typeof c.riskCriticalFlagCount === "number" ? c.riskCriticalFlagCount : null,
    riskHighFlagCount: typeof c.riskHighFlagCount === "number" ? c.riskHighFlagCount : null,
    freezeAuthorityPresent: typeof c.freezeAuthorityPresent === "boolean" ? c.freezeAuthorityPresent : null,
    mintAuthorityPresent: typeof c.mintAuthorityPresent === "boolean" ? c.mintAuthorityPresent : null,
    token2022Blocker: typeof c.token2022Blocker === "boolean" ? c.token2022Blocker : null,
    holderConcentrationRisk: typeof c.holderConcentrationRisk === "boolean" ? c.holderConcentrationRisk : null,
    metadataMutable: typeof c.metadataMutable === "boolean" ? c.metadataMutable : null,
    liquidityHint: typeof c.liquidityHint === "string" ? c.liquidityHint : null,
    quoteObserved: typeof c.quoteObserved === "boolean" ? c.quoteObserved : null,
    quoteScore: typeof c.quoteScore === "number" ? c.quoteScore : null,
    quoteFreshness: typeof c.quoteFreshness === "string" ? c.quoteFreshness : null,
    priceImpactHigh: typeof c.priceImpactHigh === "boolean" ? c.priceImpactHigh : null,
    simulationOutcome: typeof c.simulationOutcome === "string" ? c.simulationOutcome : null,
    txBuildRefused: typeof c.txBuildRefused === "boolean" ? c.txBuildRefused : null,
  };
}

// --- the scoring spec, re-derived independently (the parity wall) -------------

function computeComponents(f: ScoreFacts): EngineSniperScoreComponents {
  const riskBase = f.riskDecision === "PASS_FOR_PAPER_EVALUATION" ? 40 : f.riskDecision === "CAUTION" ? 18 : 0;
  const highPenalty = Math.min((f.riskHighFlagCount ?? 0) * 4, 16);
  const riskSafety = Math.min(40, Math.max(0, riskBase - highPenalty));

  const quoteQuality = f.quoteObserved === true && f.quoteScore !== null ? Math.floor((f.quoteScore * 25) / 100) : 0;
  const quoteFreshness = f.quoteFreshness === "fresh" ? 10 : 0;
  const liquidity = f.liquidityHint === "adequate" ? 10 : f.liquidityHint === "low" ? 0 : 4;

  const mechanicsAbsent =
    f.freezeAuthorityPresent === null &&
    f.mintAuthorityPresent === null &&
    f.token2022Blocker === null &&
    f.holderConcentrationRisk === null &&
    f.metadataMutable === null;
  let tokenMechanics: number;
  if (mechanicsAbsent) {
    tokenMechanics = 4;
  } else {
    let v = 10;
    if (f.freezeAuthorityPresent === true) v -= 5;
    if (f.mintAuthorityPresent === true) v -= 3;
    if (f.holderConcentrationRisk === true) v -= 3;
    if (f.metadataMutable === true) v -= 2;
    if (f.token2022Blocker === true) v -= 10;
    tokenMechanics = Math.max(0, Math.min(10, v));
  }

  const simulationEvidence = f.simulationOutcome === "simulated-ok" ? 5 : f.simulationOutcome === "failed" ? 0 : 2;

  return { riskSafety, quoteQuality, quoteFreshness, liquidity, tokenMechanics, simulationEvidence };
}

function sumComponents(c: EngineSniperScoreComponents): number {
  return Math.min(100, c.riskSafety + c.quoteQuality + c.quoteFreshness + c.liquidity + c.tokenMechanics + c.simulationEvidence);
}

function deriveVerdict(f: ScoreFacts): { verdict: EngineSniperScoreVerdict; reasons: string[] } {
  const reasons: string[] = ["paper-only", "mainnet-live-disabled"];
  let hardReject = false;
  if (f.riskDecision === "REJECT") {
    reasons.push("risk-rejected");
    hardReject = true;
  }
  if ((f.riskCriticalFlagCount ?? 0) > 0) {
    reasons.push("risk-over-threshold");
    hardReject = true;
  }
  if (f.token2022Blocker === true) {
    reasons.push("token2022-blocker");
    hardReject = true;
  }

  let caution = false;
  if (f.riskDecision === "CAUTION") caution = true;

  if (f.quoteObserved === true) {
    if (f.quoteFreshness !== "fresh") {
      reasons.push("quote-stale");
      caution = true;
    }
    if (f.priceImpactHigh === true) {
      reasons.push("high-price-impact");
      caution = true;
    }
  } else if (f.quoteObserved === false) {
    reasons.push("quote-unavailable");
    caution = true;
  } else {
    reasons.push("quote-missing");
    caution = true;
  }

  if (f.liquidityHint === "low") {
    reasons.push("low-liquidity");
    caution = true;
  }
  if (f.holderConcentrationRisk === true) {
    reasons.push("holder-concentration-risk");
    caution = true;
  }
  if (f.metadataMutable === true) {
    reasons.push("metadata-mutable-risk");
    caution = true;
  }

  if (f.simulationOutcome === "failed") {
    reasons.push("simulation-failed");
    caution = true;
  } else if (f.simulationOutcome !== "simulated-ok") {
    reasons.push("simulation-unavailable");
  }

  if (f.txBuildRefused === true) {
    reasons.push("tx-build-refused");
    caution = true;
  }

  const riskAssessed = f.riskDecision !== null;
  if (!hardReject && !riskAssessed) reasons.push("insufficient-evidence");

  const verdict: EngineSniperScoreVerdict = hardReject
    ? "reject"
    : !riskAssessed
      ? "insufficient-evidence"
      : caution
        ? "caution"
        : "watch";
  return { verdict, reasons };
}

function verdictRank(v: string): number {
  return v === "watch" ? 3 : v === "caution" ? 2 : v === "insufficient-evidence" ? 1 : 0;
}

export type EngineSniperScoreValidation =
  | { readonly ok: true; readonly report: EngineSniperScoreReportV1 }
  | { readonly ok: false; readonly problems: readonly string[] };

/** One validated `sniper.score.input.v1` bundle, narrowed to what the cross-check needs. */
export interface SniperScoreInputCrossCheck {
  readonly mode: string;
  readonly network: string | null;
  readonly candidates: ReadonlyArray<{ readonly candidateId: string; readonly mint: string; readonly facts: Record<string, unknown> }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkClosedKeys(value: Record<string, unknown>, allowed: readonly string[], where: string, problems: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) problems.push(`${where} has unknown field ${JSON.stringify(key)} (the schema is CLOSED)`);
  }
  for (const key of allowed) {
    if (!(key in value)) problems.push(`${where} is missing field ${JSON.stringify(key)}`);
  }
}

function checkBoundedString(value: unknown, field: string, max: number, problems: string[], nullable = false): void {
  if (value === null && nullable) return;
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    problems.push(`${field} must be ${nullable ? "null or " : ""}a non-empty string (max ${max} chars)`);
  }
}

function checkNonNegIntOrNull(value: unknown, field: string, problems: string[]): void {
  if (value === null) return;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) problems.push(`${field} must be a non-negative integer or null`);
}

function checkBoolOrNull(value: unknown, field: string, problems: string[]): void {
  if (value !== null && typeof value !== "boolean") problems.push(`${field} must be a boolean or null`);
}

function checkEnumOrNull(value: unknown, field: string, allowed: readonly string[], problems: string[]): void {
  if (value === null) return;
  if (typeof value !== "string" || !allowed.includes(value)) problems.push(`${field} must be one of the closed values or null`);
}

function validateCandidate(
  value: unknown,
  index: number,
  crossCheck: SniperScoreInputCrossCheck | undefined,
  problems: string[],
): void {
  const at = `rankedCandidates[${index}]`;
  if (!isRecord(value)) {
    problems.push(`${at} is not a JSON object`);
    return;
  }
  checkClosedKeys(value, EXPECTED_CANDIDATE_KEYS, at, problems);

  checkBoundedString(value.candidateId, `${at}.candidateId`, 64, problems);
  try {
    const mint = parseMintAddress(value.mint);
    if (value.mint !== mint) problems.push(`${at}.mint must be the trimmed base58 mint, verbatim`);
  } catch (err) {
    problems.push(`${at}.mint: ${(err as Error).message}`);
  }
  checkBoundedString(value.source, `${at}.source`, 64, problems, true);

  checkEnumOrNull(value.riskDecision, `${at}.riskDecision`, RISK_DECISIONS, problems);
  if (value.riskScore !== null && (typeof value.riskScore !== "number" || !Number.isFinite(value.riskScore) || value.riskScore < 0 || value.riskScore > 100)) {
    problems.push(`${at}.riskScore must be a number between 0 and 100 or null`);
  }
  checkNonNegIntOrNull(value.riskCriticalFlagCount, `${at}.riskCriticalFlagCount`, problems);
  checkNonNegIntOrNull(value.riskHighFlagCount, `${at}.riskHighFlagCount`, problems);
  for (const b of ["freezeAuthorityPresent", "mintAuthorityPresent", "token2022Blocker", "holderConcentrationRisk", "metadataMutable", "priceImpactHigh", "txBuildRefused"] as const) {
    checkBoolOrNull(value[b], `${at}.${b}`, problems);
  }
  checkEnumOrNull(value.liquidityHint, `${at}.liquidityHint`, LIQUIDITY_HINTS, problems);
  checkBoolOrNull(value.quoteObserved, `${at}.quoteObserved`, problems);
  if (value.quoteScore !== null && (typeof value.quoteScore !== "number" || !Number.isInteger(value.quoteScore) || value.quoteScore < 0 || value.quoteScore > 100)) {
    problems.push(`${at}.quoteScore must be an integer between 0 and 100 or null`);
  }
  checkEnumOrNull(value.quoteFreshness, `${at}.quoteFreshness`, QUOTE_FRESHNESS, problems);
  checkEnumOrNull(value.simulationOutcome, `${at}.simulationOutcome`, SIMULATION_OUTCOMES, problems);
  checkEnumOrNull(value.simulationClassification, `${at}.simulationClassification`, SIMULATION_CLASSIFICATIONS, problems);

  if (!Array.isArray(value.caveats) || value.caveats.some((c) => typeof c !== "string" || c.length === 0 || c.length > 280)) {
    problems.push(`${at}.caveats must be an array of non-empty strings (max 280 chars each)`);
  }

  if (typeof value.rank !== "number" || value.rank !== index + 1) {
    problems.push(`${at}.rank must be ${index + 1} (1-based position in the ranking)`);
  }

  // --- PARITY WALL: cross-check echoed facts against the input bundle ---------
  if (crossCheck) {
    const input = crossCheck.candidates.find((cand) => cand.candidateId === value.candidateId);
    if (!input) {
      problems.push(`${at} candidateId ${JSON.stringify(value.candidateId)} is not in the score input bundle`);
    } else {
      if (input.mint !== value.mint) problems.push(`${at}.mint disagrees with the input bundle`);
      for (const key of Object.keys(input.facts)) {
        const echoed = (value as Record<string, unknown>)[key];
        const supplied = input.facts[key];
        if ((echoed ?? null) !== (supplied ?? null)) {
          problems.push(`${at}.${key} disagrees with the input bundle (echoed ${JSON.stringify(echoed)}, input ${JSON.stringify(supplied)})`);
        }
      }
    }
  }

  // --- PARITY WALL: re-derive components, score, verdict, reasons -------------
  if (!isRecord(value.components)) {
    problems.push(`${at}.components must be an object`);
    return;
  }
  checkClosedKeys(value.components, EXPECTED_COMPONENT_KEYS, `${at}.components`, problems);
  const facts = factsOf(value);
  const expectedComponents = computeComponents(facts);
  for (const key of EXPECTED_COMPONENT_KEYS) {
    if (value.components[key] !== expectedComponents[key]) {
      problems.push(`${at}.components.${key} must be ${expectedComponents[key]} (re-derived from the echoed facts), got ${String(value.components[key])}`);
    }
  }
  const expectedScore = sumComponents(expectedComponents);
  if (value.score !== expectedScore) {
    problems.push(`${at}.score must be ${expectedScore} (clamped component sum), got ${String(value.score)}`);
  }

  const { verdict, reasons } = deriveVerdict(facts);
  if (!(ENGINE_SNIPER_SCORE_VERDICTS as readonly string[]).includes(value.verdict as string)) {
    problems.push(`${at}.verdict must be one of the closed verdicts`);
  } else if (value.verdict !== verdict) {
    problems.push(`${at}.verdict must be ${JSON.stringify(verdict)} (re-derived from facts), got ${JSON.stringify(value.verdict)}`);
  }
  if (value.nextSafeAction !== NEXT_ACTION[verdict]) {
    problems.push(`${at}.nextSafeAction must be ${JSON.stringify(NEXT_ACTION[verdict])} for verdict ${JSON.stringify(verdict)}`);
  }
  if (!Array.isArray(value.reasonCodes) || value.reasonCodes.length !== reasons.length || value.reasonCodes.some((r, i) => r !== reasons[i])) {
    problems.push(`${at}.reasonCodes must be exactly the re-derived ordered reason set [${reasons.join(", ")}]`);
  }
  for (const r of Array.isArray(value.reasonCodes) ? value.reasonCodes : []) {
    if (!(ENGINE_SNIPER_SCORE_REASON_CODES as readonly string[]).includes(r as string)) {
      problems.push(`${at}.reasonCodes contains ${JSON.stringify(r)} which is not in the closed reason-code set`);
    }
  }

  // --- HARD safety invariants (independent of the re-derivation) -------------
  if (value.verdict === "watch") {
    if (facts.riskDecision === "REJECT") problems.push(`${at} is "watch" but its risk decision is REJECT — rejected risk can never be watch`);
    if ((facts.riskCriticalFlagCount ?? 0) > 0) problems.push(`${at} is "watch" but it carries a critical risk flag`);
    if (facts.token2022Blocker === true) problems.push(`${at} is "watch" but it carries a Token-2022 blocker`);
    if (facts.quoteObserved === true && facts.quoteFreshness !== "fresh") problems.push(`${at} is "watch" but its quote is not fresh`);
    if (facts.simulationOutcome === "failed") problems.push(`${at} is "watch" but its simulation failed`);
  }
}

/** Validate an unknown parsed value as `engine.sniper.score.report.v1`, strictly. */
export function validateEngineSniperScoreReportV1(
  value: unknown,
  crossCheck?: SniperScoreInputCrossCheck,
): EngineSniperScoreValidation {
  const problems: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, problems: ["artifact is not a JSON object"] };
  }
  checkClosedKeys(value, EXPECTED_KEYS, "artifact", problems);

  if (value.schemaVersion !== ENGINE_SNIPER_SCORE_SCHEMA_VERSION) {
    problems.push(`schemaVersion must be ${JSON.stringify(ENGINE_SNIPER_SCORE_SCHEMA_VERSION)}`);
  }
  checkBoundedString(value.banner, "banner", 500, problems);
  if (value.engineName !== "solmaker-engine") problems.push('engineName must be "solmaker-engine"');
  if (typeof value.engineVersion !== "string" || !VERSION_SHAPE.test(value.engineVersion)) {
    problems.push("engineVersion must be a semver-shaped string");
  }
  if (value.ipcVersion !== ENGINE_IPC_VERSION) problems.push(`ipcVersion must be ${JSON.stringify(ENGINE_IPC_VERSION)}`);
  if (value.createdAt !== null && (typeof value.createdAt !== "string" || value.createdAt.length > 40 || !ISO_SHAPE.test(value.createdAt))) {
    problems.push("createdAt must be null or an ISO-8601-shaped UTC string");
  }
  if (value.scoringEngine !== "solmaker-engine") problems.push('scoringEngine must be "solmaker-engine"');
  if (value.engineSource !== "rust") problems.push('engineSource must be "rust"');
  if (typeof value.mode !== "string" || !(SCORE_MODES as readonly string[]).includes(value.mode)) {
    problems.push("mode must be one of paper|mainnet-dry-run|devnet");
  } else if (crossCheck && value.mode !== crossCheck.mode) {
    problems.push("mode must match the score input bundle");
  }
  checkBoundedString(value.network, "network", 64, problems, true);
  if (crossCheck && (value.network ?? null) !== (crossCheck.network ?? null)) {
    problems.push("network must match the score input bundle");
  }

  if (!Array.isArray(value.rankedCandidates)) {
    problems.push("rankedCandidates must be an array");
  } else {
    if (value.rankedCandidates.length > ENGINE_SNIPER_SCORE_MAX_CANDIDATES) {
      problems.push(`rankedCandidates exceeds the ${ENGINE_SNIPER_SCORE_MAX_CANDIDATES}-candidate ceiling`);
    }
    value.rankedCandidates.forEach((candidate, index) => validateCandidate(candidate, index, crossCheck, problems));

    if (value.candidateCount !== value.rankedCandidates.length) problems.push("candidateCount must equal rankedCandidates.length");

    // Recompute the deterministic ranking: verdict rank desc, score desc, candidateId asc.
    const ordered = value.rankedCandidates
      .filter(isRecord)
      .slice()
      .sort((a, b) => {
        const vr = verdictRank(b.verdict as string) - verdictRank(a.verdict as string);
        if (vr !== 0) return vr;
        const sd = (b.score as number) - (a.score as number);
        if (sd !== 0) return sd;
        return (a.candidateId as string) < (b.candidateId as string) ? -1 : 1;
      })
      .map((c) => c.candidateId as string);
    const echoedOrder = value.rankedCandidates.filter(isRecord).map((c) => c.candidateId as string);
    if (echoedOrder.length !== ordered.length || echoedOrder.some((id, i) => id !== ordered[i])) {
      problems.push("rankedCandidates must be in the deterministic order (verdict rank desc, score desc, candidateId asc)");
    }
    if (!Array.isArray(value.ranking) || value.ranking.length !== ordered.length || value.ranking.some((id, i) => id !== ordered[i])) {
      problems.push("ranking must equal the recomputed deterministic order");
    }
    const expectedBest = ordered.length > 0 ? ordered[0] : null;
    if (value.bestCandidateId !== expectedBest) {
      problems.push(`bestCandidateId must be ${JSON.stringify(expectedBest)} (the recomputed ranking head)`);
    }

    if (crossCheck) {
      const inputIds = new Set(crossCheck.candidates.map((c) => c.candidateId));
      const echoedIds = new Set(echoedOrder);
      if (inputIds.size !== echoedIds.size || [...inputIds].some((id) => !echoedIds.has(id))) {
        problems.push("the scored candidate set must equal the score input candidate set (none added or dropped)");
      }
    }
  }

  if (!Array.isArray(value.caveats) || value.caveats.length === 0 || value.caveats.some((c) => typeof c !== "string" || c.length === 0 || c.length > 500)) {
    problems.push("caveats must be a non-empty array of non-empty strings (max 500 chars each)");
  }
  for (const [field, expected] of [
    ["redactionApplied", true],
    ["notExecutable", true],
    ["notProfitabilityClaim", true],
    ["neverSigns", true],
    ["neverSends", true],
    ["phase7LiveTradingReady", false],
    ["scoreIsNotLiveReadiness", true],
    ["highScoreIsNotSafeToTrade", true],
  ] as const) {
    if (value[field] !== expected) problems.push(`${field} must literally be ${String(expected)}`);
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, report: value as unknown as EngineSniperScoreReportV1 };
}
