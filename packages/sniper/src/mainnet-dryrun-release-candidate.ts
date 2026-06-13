/**
 * Deterministic, **no-send** MAINNET DRY-RUN RELEASE CANDIDATE artifact (Sprint 102).
 *
 * One operator command (`paper:sniper:rehearse --mode mainnet-dry-run`) chains the whole evidence
 * pipeline — candidate discovery/replay → memecoin candidate scoring → deep risk → quote fetch →
 * quote score → tx build dry-run → tx inspection → simulation classification → readiness — over a
 * single run folder. This module folds the per-stage evidence that pipeline already produced into
 * ONE auditable summary: `sniper.mainnet_dryrun.release_candidate.v1`.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work — the orchestrator reads the
 * artifacts and hands their summarized evidence here. The builder never signs, never sends, never
 * loads a key, and is structurally incapable of claiming the live path is enabled:
 *
 *   - `liveSendStatus` is the literal `"disabled"`, always;
 *   - `mode` is the literal `"mainnet-dry-run"` and `network` the literal `"mainnet-beta"`;
 *   - `neverSigns` / `neverSends` / `notExecutable` are pinned true, `phase7LiveTradingReady` false.
 *
 * The VERDICT is RE-DERIVED from the structured stage evidence alone and the validator recomputes
 * it independently: a candidate's score — however high — can never move a blocked verdict, because
 * the derivation never reads a score. A REJECT risk decision, a critical risk flag, or a Token-2022
 * blocker forces `dryrun-blocked-risk` no matter what else is present. The closed verdict set is:
 *
 *   - `dryrun-error`                 — a pipeline stage hard-errored (the run could not complete);
 *   - `dryrun-blocked-risk`          — risk rejected / critical flag / Token-2022 blocker;
 *   - `dryrun-blocked-quote`         — a quote was attempted but is not fresh-and-observed;
 *   - `dryrun-blocked-build`         — the unsigned build was refused;
 *   - `dryrun-blocked-simulation`    — the real simulateTransaction failed;
 *   - `dryrun-insufficient-evidence` — nothing is blocking but required evidence is missing;
 *   - `dryrun-complete-blocked-live` — the dry-run evidence is complete; live stays DISABLED.
 *
 * `dryrun-complete-blocked-live` is the BEST possible outcome — it means "dry-run evidence complete;
 * live still disabled," never "ready to trade." There is no verdict that authorizes a live send.
 */

import { redactString } from "@soulmaker/security";
import { parseMintAddress } from "./mint-address.js";

/** Stable schema identifier for the release-candidate artifact. Bump only on a breaking change. */
export const SNIPER_RELEASE_CANDIDATE_SCHEMA_VERSION = "sniper.mainnet_dryrun.release_candidate.v1";

/** The banner that prefixes every release-candidate artifact (required label). */
export const SNIPER_RELEASE_CANDIDATE_BANNER =
  "MAINNET DRY-RUN RELEASE CANDIDATE — a no-send rehearsal summary. LIVE SENDING IS DISABLED.";

/** Required disclaimer statements carried by every release-candidate artifact (stable order). */
export const SNIPER_RELEASE_CANDIDATE_DISCLAIMERS: readonly string[] = [
  "MAINNET DRY-RUN RELEASE CANDIDATE — a folded summary of one no-send mainnet rehearsal (scoring, risk, quote, build, tx inspection, simulation, readiness).",
  "Live sending is DISABLED. This artifact is structurally incapable of reporting a live send, a signature, or an armed state; mainnet sending has NO CLI surface.",
  "A high candidate score is NOT a buy signal and NOT 'safe to trade'; a rejected risk stays rejected no matter the score, and scoring gates nothing in the live path.",
  "'dryrun-complete-blocked-live' means dry-run evidence complete and live STILL disabled — it is never live-trading readiness.",
  "No wallet, key, signing, sending, or live execution is involved anywhere in producing this artifact.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
];

/** The fixed network every release candidate is evaluated for. */
export const SNIPER_RELEASE_CANDIDATE_NETWORK = "mainnet-beta";
/** The fixed mode every release candidate is produced in. */
export const SNIPER_RELEASE_CANDIDATE_MODE = "mainnet-dry-run";
/** The fixed live-send status. There is no input that can change it. */
export const SNIPER_RELEASE_CANDIDATE_LIVE_SEND_STATUS = "disabled";

/** Closed verdict set, in precedence order (error first, complete last). */
export const SNIPER_RELEASE_CANDIDATE_VERDICTS = [
  "dryrun-error",
  "dryrun-blocked-risk",
  "dryrun-blocked-quote",
  "dryrun-blocked-build",
  "dryrun-blocked-simulation",
  "dryrun-insufficient-evidence",
  "dryrun-complete-blocked-live",
] as const;
export type SniperReleaseCandidateVerdict = (typeof SNIPER_RELEASE_CANDIDATE_VERDICTS)[number];

const RISK_DECISIONS: ReadonlySet<string> = new Set(["REJECT", "CAUTION", "PASS_FOR_PAPER_EVALUATION"]);
const QUOTE_FRESHNESS: ReadonlySet<string> = new Set([
  "fresh",
  "stale",
  "missing-timestamp",
  "malformed-timestamp",
  "future-timestamp",
]);
const SIMULATION_OUTCOMES: ReadonlySet<string> = new Set(["simulated-ok", "failed", "unavailable"]);
const CANDIDATE_SOURCE_KINDS: ReadonlySet<string> = new Set(["file", "replay"]);
const SCORE_VERDICTS: ReadonlySet<string> = new Set(["watch", "caution", "reject", "insufficient-evidence"]);
const ENGINE_SOURCES: ReadonlySet<string> = new Set(["rust", "none"]);
const RISK_SOURCES: ReadonlySet<string> = new Set(["automatic", "operator", "none"]);

const MAX_RANKED = 500;
const MAX_LABEL_LEN = 200;
const MAX_REFS = 64;
const MAX_LINE_LEN = 400;
const MAX_LINES = 32;

/** Thrown when a release-candidate INPUT or produced artifact is structurally invalid. */
export class SniperReleaseCandidateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperReleaseCandidateError";
  }
}

// --- evidence model ----------------------------------------------------------

/** Where the candidate set came from. */
export interface ReleaseCandidateSource {
  kind: "file" | "replay";
  label: string;
}

/** One ranked candidate, echoed from the Rust score report (intelligence only). */
export interface ReleaseCandidateRankedEntry {
  candidateId: string;
  mint: string;
  rank: number;
  score: number;
  verdict: string;
  reasonCodes: string[];
}

/** Candidate-scoring summary (the S101 intelligence layer). */
export interface ReleaseCandidateScoringEvidence {
  available: boolean;
  engineSource: "rust" | "none";
  candidateCount: number;
  bestCandidateId: string | null;
  rankedCandidates: ReleaseCandidateRankedEntry[];
}

/** Deep-risk summary across the candidate set. */
export interface ReleaseCandidateRiskEvidence {
  assessed: boolean;
  source: "automatic" | "operator" | "none";
  worstDecision: string | null;
  rejected: boolean;
  criticalFlagCount: number | null;
  highFlagCount: number | null;
  token2022Blocker: boolean;
  token2022BlockerMints: string[];
}

/** Quote fetch + freshness + (optional) Rust quote-score summary. */
export interface ReleaseCandidateQuoteEvidence {
  attempted: boolean;
  observed: boolean;
  freshness: string | null;
  scoreAvailable: boolean;
  score: number | null;
}

/** Unsigned tx build dry-run summary. */
export interface ReleaseCandidateBuildEvidence {
  attempted: boolean;
  refused: boolean;
  succeeded: boolean;
  refusalCodes: string[];
}

/** Rust tx-inspection summary (optional — Rust-only). */
export interface ReleaseCandidateTxInspectionEvidence {
  available: boolean;
  versionSupported: boolean | null;
  blockhashPresent: boolean | null;
  instructionCount: number | null;
  unresolvableProgramIdCount: number | null;
}

/** Real simulateTransaction outcome + classification. */
export interface ReleaseCandidateSimulationEvidence {
  attempted: boolean;
  outcome: string | null;
  classification: string | null;
  failed: boolean;
}

/** Mainnet readiness checklist summary (verdict is always blocked by design). */
export interface ReleaseCandidateReadinessEvidence {
  available: boolean;
  verdict: string | null;
  satisfiedCount: number | null;
  totalChecks: number | null;
}

/** A pipeline stage hard-error (distinct from a blocked stage, which is the system working). */
export interface ReleaseCandidateStageError {
  occurred: boolean;
  detail: string | null;
}

/** Everything {@link buildMainnetDryRunReleaseCandidate} accepts. */
export interface BuildMainnetDryRunReleaseCandidateInput {
  runId?: string | null;
  generatedAt?: string | null;
  /** Defaults to (and must equal) "mainnet-beta". */
  network?: string;
  candidateSource: ReleaseCandidateSource;
  scoring: ReleaseCandidateScoringEvidence;
  risk: ReleaseCandidateRiskEvidence;
  quote: ReleaseCandidateQuoteEvidence;
  build: ReleaseCandidateBuildEvidence;
  txInspection: ReleaseCandidateTxInspectionEvidence;
  simulation: ReleaseCandidateSimulationEvidence;
  readiness: ReleaseCandidateReadinessEvidence;
  stageError?: ReleaseCandidateStageError;
  artifactRefs?: string[];
}

// --- artifact model ----------------------------------------------------------

/** The full, deterministic, JSON-serializable release-candidate artifact. */
export interface SniperMainnetDryRunReleaseCandidate {
  schemaVersion: string;
  banner: string;
  disclaimers: string[];
  runId: string | null;
  generatedAt: string | null;
  network: "mainnet-beta";
  mode: "mainnet-dry-run";
  verdict: SniperReleaseCandidateVerdict;
  candidateSource: ReleaseCandidateSource;
  scoring: ReleaseCandidateScoringEvidence;
  risk: ReleaseCandidateRiskEvidence;
  quote: ReleaseCandidateQuoteEvidence;
  build: ReleaseCandidateBuildEvidence;
  txInspection: ReleaseCandidateTxInspectionEvidence;
  simulation: ReleaseCandidateSimulationEvidence;
  readiness: ReleaseCandidateReadinessEvidence;
  stageError: ReleaseCandidateStageError;
  liveSendStatus: "disabled";
  whyLiveBlocked: string[];
  nextSafeActions: string[];
  caveats: string[];
  artifactRefs: string[];
  redactionApplied: true;
  notExecutable: true;
  neverSigns: true;
  neverSends: true;
  phase7LiveTradingReady: false;
  scoreIsNotLiveReadiness: true;
  highScoreIsNotSafeToTrade: true;
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeLabel(value: unknown, name: string, max: number, nullable: boolean): string | null {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw new SniperReleaseCandidateError(`${name} is required`);
  }
  if (typeof value !== "string") throw new SniperReleaseCandidateError(`${name} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (nullable) return null;
    throw new SniperReleaseCandidateError(`${name} must be a non-empty string`);
  }
  if (trimmed.length > max) throw new SniperReleaseCandidateError(`${name} exceeds ${max} characters`);
  if (redactString(trimmed) !== trimmed) throw new SniperReleaseCandidateError(`${name} is secret-shaped and is refused`);
  return trimmed;
}

function reqBool(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new SniperReleaseCandidateError(`${name} must be a boolean`);
  return value;
}

function optBool(value: unknown, name: string): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") throw new SniperReleaseCandidateError(`${name} must be a boolean or null`);
  return value;
}

function optCount(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new SniperReleaseCandidateError(`${name} must be a non-negative integer or null`);
  }
  return value;
}

function reqCount(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new SniperReleaseCandidateError(`${name} must be a non-negative integer`);
  }
  return value;
}

function optEnum(value: unknown, name: string, allowed: ReadonlySet<string>): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new SniperReleaseCandidateError(`${name} must be one of: ${[...allowed].join(", ")}`);
  }
  return value;
}

function reqEnum(value: unknown, name: string, allowed: ReadonlySet<string>): string {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new SniperReleaseCandidateError(`${name} must be one of: ${[...allowed].join(", ")}`);
  }
  return value;
}

function normalizeMints(value: unknown, name: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SniperReleaseCandidateError(`${name} must be an array of mints`);
  return value.map((m, i) => {
    try {
      return parseMintAddress(m);
    } catch (err) {
      throw new SniperReleaseCandidateError(`${name}[${i}]: ${(err as Error).message}`);
    }
  });
}

function normalizeStringList(value: unknown, name: string, maxCount: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SniperReleaseCandidateError(`${name} must be an array of strings`);
  if (value.length > maxCount) throw new SniperReleaseCandidateError(`${name} exceeds ${maxCount} entries`);
  return value.map((s, i) => {
    if (typeof s !== "string" || s.trim().length === 0) throw new SniperReleaseCandidateError(`${name}[${i}] must be a non-empty string`);
    const trimmed = s.trim();
    if (trimmed.length > MAX_LINE_LEN) throw new SniperReleaseCandidateError(`${name}[${i}] exceeds ${MAX_LINE_LEN} characters`);
    return redactString(trimmed);
  });
}

function buildRankedEntry(raw: unknown, index: number): ReleaseCandidateRankedEntry {
  if (!isObject(raw)) throw new SniperReleaseCandidateError(`scoring.rankedCandidates[${index}] must be an object`);
  const candidateId = safeLabel(raw.candidateId, `scoring.rankedCandidates[${index}].candidateId`, 64, false) as string;
  let mint: string;
  try {
    mint = parseMintAddress(raw.mint);
  } catch (err) {
    throw new SniperReleaseCandidateError(`scoring.rankedCandidates[${index}].mint: ${(err as Error).message}`);
  }
  const rank = raw.rank;
  if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 1) {
    throw new SniperReleaseCandidateError(`scoring.rankedCandidates[${index}].rank must be a positive integer`);
  }
  const score = raw.score;
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 100) {
    throw new SniperReleaseCandidateError(`scoring.rankedCandidates[${index}].score must be an integer 0-100`);
  }
  const verdict = reqEnum(raw.verdict, `scoring.rankedCandidates[${index}].verdict`, SCORE_VERDICTS);
  const reasonCodes = normalizeStringList(raw.reasonCodes, `scoring.rankedCandidates[${index}].reasonCodes`, 32);
  return { candidateId, mint, rank, score, verdict, reasonCodes };
}

// --- verdict derivation (the parity heart) -----------------------------------

/** Inputs the verdict derivation reads — a SCORE is deliberately not among them. */
interface VerdictEvidence {
  stageError: boolean;
  riskRejected: boolean;
  riskCriticalFlagCount: number | null;
  token2022Blocker: boolean;
  quoteAttempted: boolean;
  quoteObserved: boolean;
  quoteFreshness: string | null;
  buildAttempted: boolean;
  buildRefused: boolean;
  buildSucceeded: boolean;
  simulationAttempted: boolean;
  simulationFailed: boolean;
  simulationOutcome: string | null;
  scoringAvailable: boolean;
  riskAssessed: boolean;
  readinessAvailable: boolean;
}

/**
 * Re-derive the closed verdict from structured stage evidence ALONE. A candidate's score is never
 * read here, so no score can move a blocked verdict. Risk blocking is supreme; then quote, build,
 * simulation; then completeness vs. missing evidence. Pure and deterministic.
 */
export function deriveReleaseCandidateVerdict(ev: VerdictEvidence): SniperReleaseCandidateVerdict {
  if (ev.stageError) return "dryrun-error";

  const riskBlocking = ev.riskRejected || (ev.riskCriticalFlagCount ?? 0) > 0 || ev.token2022Blocker;
  if (riskBlocking) return "dryrun-blocked-risk";

  const quoteBlocking = ev.quoteAttempted && !(ev.quoteObserved && ev.quoteFreshness === "fresh");
  if (quoteBlocking) return "dryrun-blocked-quote";

  const buildBlocking = ev.buildAttempted && ev.buildRefused;
  if (buildBlocking) return "dryrun-blocked-build";

  const simBlocking = ev.simulationAttempted && ev.simulationFailed;
  if (simBlocking) return "dryrun-blocked-simulation";

  const complete =
    ev.scoringAvailable &&
    ev.riskAssessed &&
    ev.quoteAttempted &&
    ev.quoteObserved &&
    ev.quoteFreshness === "fresh" &&
    ev.buildAttempted &&
    ev.buildSucceeded &&
    ev.simulationAttempted &&
    ev.simulationOutcome === "simulated-ok" &&
    ev.readinessAvailable;
  if (complete) return "dryrun-complete-blocked-live";

  return "dryrun-insufficient-evidence";
}

function verdictEvidenceFromArtifact(a: {
  stageError: ReleaseCandidateStageError;
  scoring: ReleaseCandidateScoringEvidence;
  risk: ReleaseCandidateRiskEvidence;
  quote: ReleaseCandidateQuoteEvidence;
  build: ReleaseCandidateBuildEvidence;
  simulation: ReleaseCandidateSimulationEvidence;
  readiness: ReleaseCandidateReadinessEvidence;
}): VerdictEvidence {
  return {
    stageError: a.stageError.occurred,
    riskRejected: a.risk.rejected,
    riskCriticalFlagCount: a.risk.criticalFlagCount,
    token2022Blocker: a.risk.token2022Blocker,
    quoteAttempted: a.quote.attempted,
    quoteObserved: a.quote.observed,
    quoteFreshness: a.quote.freshness,
    buildAttempted: a.build.attempted,
    buildRefused: a.build.refused,
    buildSucceeded: a.build.succeeded,
    simulationAttempted: a.simulation.attempted,
    simulationFailed: a.simulation.failed,
    simulationOutcome: a.simulation.outcome,
    scoringAvailable: a.scoring.available,
    riskAssessed: a.risk.assessed,
    readinessAvailable: a.readiness.available,
  };
}

// --- explanation derivation --------------------------------------------------

const POLICY_LINE =
  "Mainnet live trading is DISABLED by policy: the fourteen-condition live gate is default-blocked-no-override, and mainnet sending has no CLI surface in this command or anywhere else.";
const NO_SIGNER_LINE = "No signer, key, or wallet is loaded anywhere in this dry-run, and no send seam is ever called.";

function deriveWhyLiveBlocked(verdict: SniperReleaseCandidateVerdict, a: BuildMainnetDryRunReleaseCandidateInput): string[] {
  const lines: string[] = [POLICY_LINE, NO_SIGNER_LINE];
  switch (verdict) {
    case "dryrun-error":
      lines.push(`A pipeline stage hard-errored, so the rehearsal could not complete: ${a.stageError?.detail ?? "see the run folder"}.`);
      break;
    case "dryrun-blocked-risk":
      lines.push(
        a.risk.rejected
          ? "Deep risk REJECTED a candidate — a rejected risk stays rejected no matter any candidate score."
          : a.risk.token2022Blocker
            ? "A Token-2022 extension blocker was found — the build is refused before any provider call."
            : "A critical risk flag was found — the build is refused before any provider call.",
      );
      break;
    case "dryrun-blocked-quote":
      lines.push("The route quote was attempted but is not fresh-and-observed (stale / unavailable) — the build is refused before any provider call.");
      break;
    case "dryrun-blocked-build":
      lines.push(`The unsigned tx build was refused${a.build.refusalCodes.length > 0 ? ` (${a.build.refusalCodes.join(", ")})` : ""} — nothing was simulated or sent.`);
      break;
    case "dryrun-blocked-simulation":
      lines.push(`The real transaction simulation failed${a.simulation.classification !== null ? ` (${a.simulation.classification})` : ""} — the exact unsigned envelope did not pass against recent chain state.`);
      break;
    case "dryrun-insufficient-evidence":
      lines.push("Required dry-run evidence is missing (scoring, risk, quote, build, simulation, or readiness) — the rehearsal cannot claim a complete picture.");
      break;
    case "dryrun-complete-blocked-live":
      lines.push("The dry-run evidence is complete, but live sending remains disabled by policy — completeness is never live-trading readiness.");
      break;
  }
  return lines;
}

function deriveNextSafeActions(verdict: SniperReleaseCandidateVerdict, a: BuildMainnetDryRunReleaseCandidateInput): string[] {
  const actions: string[] = [];
  switch (verdict) {
    case "dryrun-error":
      actions.push("Inspect the failed stage in the run folder, fix the input, and re-run paper:sniper:rehearse --mode mainnet-dry-run.");
      break;
    case "dryrun-blocked-risk":
      actions.push("Drop the rejected/critical/Token-2022 candidate from the list and re-run the rehearsal; never override a risk gate.");
      break;
    case "dryrun-blocked-quote":
      actions.push("Re-fetch a fresh quote (paper:routequote:fetch) within the configured age cap, then re-run the rehearsal.");
      break;
    case "dryrun-blocked-build":
      actions.push("Read the refusal codes in txbuild-report.json, address the named cap/shape, and re-run the rehearsal.");
      break;
    case "dryrun-blocked-simulation":
      actions.push("Read the simulation classification + next action in tx-simulation.json; the failure is a real signal, not a bug to bypass.");
      break;
    case "dryrun-insufficient-evidence":
      actions.push(
        a.scoring.available
          ? "Supply the missing evidence (deep risk / a fresh quote / the build + simulation) and re-run the rehearsal."
          : "Install Rust (https://rustup.rs) + pnpm rust:build for candidate scoring, and supply the missing risk/quote/build/simulation evidence; the paper pipeline still runs without Rust.",
      );
      break;
    case "dryrun-complete-blocked-live":
      actions.push("Review this release candidate; the only authorized next step toward live is a separate, explicitly-approved sprint (security audit → micro-trade) — this command never sends.");
      break;
  }
  actions.push("Inspect the full run folder with `pnpm web:inspect --dir <run folder>` for the operator command-center view.");
  return actions;
}

function deriveCaveats(a: BuildMainnetDryRunReleaseCandidateInput): string[] {
  const caveats: string[] = [
    "Every summary here is folded from the existing per-stage production artifacts in the run folder — read them standalone for the full detail.",
    "A blocked verdict is the system working, not a bug; only 'dryrun-complete-blocked-live' means the evidence is complete, and even then live stays disabled.",
    "A candidate score is intelligence only — never a buy signal, never live readiness; the verdict is derived from risk/quote/build/simulation evidence, never from a score.",
  ];
  if (!a.scoring.available) {
    caveats.push("Candidate scoring was UNAVAILABLE (Rust engine not built) — ranking is absent; the paper evidence chain is otherwise unaffected.");
  }
  if (!a.txInspection.available) {
    caveats.push("Rust tx inspection was UNAVAILABLE — the unsigned-shape facts are absent; the build/simulation evidence is otherwise unaffected.");
  }
  return caveats;
}

// --- build -------------------------------------------------------------------

function normalizeScoring(raw: ReleaseCandidateScoringEvidence): ReleaseCandidateScoringEvidence {
  if (!isObject(raw)) throw new SniperReleaseCandidateError("scoring must be an object");
  const available = reqBool(raw.available, "scoring.available");
  const engineSource = reqEnum(raw.engineSource, "scoring.engineSource", ENGINE_SOURCES) as "rust" | "none";
  const candidateCount = reqCount(raw.candidateCount, "scoring.candidateCount");
  const bestCandidateId = safeLabel(raw.bestCandidateId, "scoring.bestCandidateId", 64, true);
  if (!Array.isArray(raw.rankedCandidates)) throw new SniperReleaseCandidateError("scoring.rankedCandidates must be an array");
  if (raw.rankedCandidates.length > MAX_RANKED) throw new SniperReleaseCandidateError(`scoring.rankedCandidates exceeds ${MAX_RANKED} entries`);
  const rankedCandidates = raw.rankedCandidates.map((r, i) => buildRankedEntry(r, i));
  return { available, engineSource, candidateCount, bestCandidateId, rankedCandidates };
}

function normalizeRisk(raw: ReleaseCandidateRiskEvidence): ReleaseCandidateRiskEvidence {
  if (!isObject(raw)) throw new SniperReleaseCandidateError("risk must be an object");
  return {
    assessed: reqBool(raw.assessed, "risk.assessed"),
    source: reqEnum(raw.source, "risk.source", RISK_SOURCES) as "automatic" | "operator" | "none",
    worstDecision: optEnum(raw.worstDecision, "risk.worstDecision", RISK_DECISIONS),
    rejected: reqBool(raw.rejected, "risk.rejected"),
    criticalFlagCount: optCount(raw.criticalFlagCount, "risk.criticalFlagCount"),
    highFlagCount: optCount(raw.highFlagCount, "risk.highFlagCount"),
    token2022Blocker: reqBool(raw.token2022Blocker, "risk.token2022Blocker"),
    token2022BlockerMints: normalizeMints(raw.token2022BlockerMints, "risk.token2022BlockerMints"),
  };
}

function normalizeQuote(raw: ReleaseCandidateQuoteEvidence): ReleaseCandidateQuoteEvidence {
  if (!isObject(raw)) throw new SniperReleaseCandidateError("quote must be an object");
  const score = raw.score;
  if (score !== null && score !== undefined && (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 100)) {
    throw new SniperReleaseCandidateError("quote.score must be an integer 0-100 or null");
  }
  return {
    attempted: reqBool(raw.attempted, "quote.attempted"),
    observed: reqBool(raw.observed, "quote.observed"),
    freshness: optEnum(raw.freshness, "quote.freshness", QUOTE_FRESHNESS),
    scoreAvailable: reqBool(raw.scoreAvailable, "quote.scoreAvailable"),
    score: score === undefined || score === null ? null : score,
  };
}

function normalizeBuild(raw: ReleaseCandidateBuildEvidence): ReleaseCandidateBuildEvidence {
  if (!isObject(raw)) throw new SniperReleaseCandidateError("build must be an object");
  return {
    attempted: reqBool(raw.attempted, "build.attempted"),
    refused: reqBool(raw.refused, "build.refused"),
    succeeded: reqBool(raw.succeeded, "build.succeeded"),
    refusalCodes: normalizeStringList(raw.refusalCodes, "build.refusalCodes", 32),
  };
}

function normalizeTxInspection(raw: ReleaseCandidateTxInspectionEvidence): ReleaseCandidateTxInspectionEvidence {
  if (!isObject(raw)) throw new SniperReleaseCandidateError("txInspection must be an object");
  return {
    available: reqBool(raw.available, "txInspection.available"),
    versionSupported: optBool(raw.versionSupported, "txInspection.versionSupported"),
    blockhashPresent: optBool(raw.blockhashPresent, "txInspection.blockhashPresent"),
    instructionCount: optCount(raw.instructionCount, "txInspection.instructionCount"),
    unresolvableProgramIdCount: optCount(raw.unresolvableProgramIdCount, "txInspection.unresolvableProgramIdCount"),
  };
}

function normalizeSimulation(raw: ReleaseCandidateSimulationEvidence): ReleaseCandidateSimulationEvidence {
  if (!isObject(raw)) throw new SniperReleaseCandidateError("simulation must be an object");
  return {
    attempted: reqBool(raw.attempted, "simulation.attempted"),
    outcome: optEnum(raw.outcome, "simulation.outcome", SIMULATION_OUTCOMES),
    classification: safeLabel(raw.classification, "simulation.classification", 64, true),
    failed: reqBool(raw.failed, "simulation.failed"),
  };
}

function normalizeReadiness(raw: ReleaseCandidateReadinessEvidence): ReleaseCandidateReadinessEvidence {
  if (!isObject(raw)) throw new SniperReleaseCandidateError("readiness must be an object");
  return {
    available: reqBool(raw.available, "readiness.available"),
    verdict: safeLabel(raw.verdict, "readiness.verdict", 32, true),
    satisfiedCount: optCount(raw.satisfiedCount, "readiness.satisfiedCount"),
    totalChecks: optCount(raw.totalChecks, "readiness.totalChecks"),
  };
}

function normalizeStageError(raw: ReleaseCandidateStageError | undefined): ReleaseCandidateStageError {
  if (raw === undefined || raw === null) return { occurred: false, detail: null };
  if (!isObject(raw)) throw new SniperReleaseCandidateError("stageError must be an object");
  return {
    occurred: reqBool(raw.occurred, "stageError.occurred"),
    detail: safeLabel(raw.detail, "stageError.detail", MAX_LINE_LEN, true),
  };
}

/**
 * Build a canonical {@link SniperMainnetDryRunReleaseCandidate} from per-stage evidence. Pure,
 * non-mutating, deterministic. The network MUST be "mainnet-beta", the live-send status is pinned
 * "disabled", and the verdict is RE-DERIVED from the evidence (never from a candidate score).
 * Throws {@link SniperReleaseCandidateError} on any structural problem.
 */
export function buildMainnetDryRunReleaseCandidate(
  input: BuildMainnetDryRunReleaseCandidateInput,
): SniperMainnetDryRunReleaseCandidate {
  if (!isObject(input)) throw new SniperReleaseCandidateError("release-candidate input must be an object");

  const network = input.network ?? SNIPER_RELEASE_CANDIDATE_NETWORK;
  if (network !== SNIPER_RELEASE_CANDIDATE_NETWORK) {
    throw new SniperReleaseCandidateError(`network must be "${SNIPER_RELEASE_CANDIDATE_NETWORK}" — a release candidate is mainnet dry-run only`);
  }

  if (!isObject(input.candidateSource)) throw new SniperReleaseCandidateError("candidateSource must be an object");
  const candidateSource: ReleaseCandidateSource = {
    kind: reqEnum(input.candidateSource.kind, "candidateSource.kind", CANDIDATE_SOURCE_KINDS) as "file" | "replay",
    label: safeLabel(input.candidateSource.label, "candidateSource.label", MAX_LABEL_LEN, false) as string,
  };

  const scoring = normalizeScoring(input.scoring);
  const risk = normalizeRisk(input.risk);
  const quote = normalizeQuote(input.quote);
  const build = normalizeBuild(input.build);
  const txInspection = normalizeTxInspection(input.txInspection);
  const simulation = normalizeSimulation(input.simulation);
  const readiness = normalizeReadiness(input.readiness);
  const stageError = normalizeStageError(input.stageError);

  const runId = safeLabel(input.runId, "runId", 128, true);
  const generatedAt = safeLabel(input.generatedAt, "generatedAt", 40, true);

  let artifactRefs: string[] = [];
  if (input.artifactRefs !== undefined && input.artifactRefs !== null) {
    if (!Array.isArray(input.artifactRefs)) throw new SniperReleaseCandidateError("artifactRefs must be an array of strings");
    if (input.artifactRefs.length > MAX_REFS) throw new SniperReleaseCandidateError(`artifactRefs exceeds ${MAX_REFS} entries`);
    artifactRefs = input.artifactRefs.map((r, i) => safeLabel(r, `artifactRefs[${i}]`, MAX_LABEL_LEN, false) as string);
  }

  const verdict = deriveReleaseCandidateVerdict(
    verdictEvidenceFromArtifact({ stageError, scoring, risk, quote, build, simulation, readiness }),
  );

  const whyLiveBlocked = deriveWhyLiveBlocked(verdict, { ...input, candidateSource, scoring, risk, quote, build, txInspection, simulation, readiness, stageError });
  const nextSafeActions = deriveNextSafeActions(verdict, { ...input, candidateSource, scoring, risk, quote, build, txInspection, simulation, readiness, stageError });
  const caveats = deriveCaveats({ ...input, candidateSource, scoring, risk, quote, build, txInspection, simulation, readiness, stageError });

  if (whyLiveBlocked.length > MAX_LINES || nextSafeActions.length > MAX_LINES || caveats.length > MAX_LINES) {
    throw new SniperReleaseCandidateError("derived explanation lists exceed the line ceiling");
  }

  return {
    schemaVersion: SNIPER_RELEASE_CANDIDATE_SCHEMA_VERSION,
    banner: SNIPER_RELEASE_CANDIDATE_BANNER,
    disclaimers: [...SNIPER_RELEASE_CANDIDATE_DISCLAIMERS],
    runId,
    generatedAt,
    network: SNIPER_RELEASE_CANDIDATE_NETWORK,
    mode: SNIPER_RELEASE_CANDIDATE_MODE,
    verdict,
    candidateSource,
    scoring,
    risk,
    quote,
    build,
    txInspection,
    simulation,
    readiness,
    stageError,
    liveSendStatus: SNIPER_RELEASE_CANDIDATE_LIVE_SEND_STATUS,
    whyLiveBlocked,
    nextSafeActions,
    caveats,
    artifactRefs,
    redactionApplied: true,
    notExecutable: true,
    neverSigns: true,
    neverSends: true,
    phase7LiveTradingReady: false,
    scoreIsNotLiveReadiness: true,
    highScoreIsNotSafeToTrade: true,
  };
}

// --- validation (backstop + parity wall) -------------------------------------

const EXPECTED_KEYS = [
  "schemaVersion",
  "banner",
  "disclaimers",
  "runId",
  "generatedAt",
  "network",
  "mode",
  "verdict",
  "candidateSource",
  "scoring",
  "risk",
  "quote",
  "build",
  "txInspection",
  "simulation",
  "readiness",
  "stageError",
  "liveSendStatus",
  "whyLiveBlocked",
  "nextSafeActions",
  "caveats",
  "artifactRefs",
  "redactionApplied",
  "notExecutable",
  "neverSigns",
  "neverSends",
  "phase7LiveTradingReady",
  "scoreIsNotLiveReadiness",
  "highScoreIsNotSafeToTrade",
] as const;

/**
 * Strictly validate a value as a canonical {@link SniperMainnetDryRunReleaseCandidate} and return it
 * narrowed. A backstop AND a parity wall: the key set is CLOSED; the network/mode/live-send/safety
 * literals are pinned; the verdict is INDEPENDENTLY re-derived from the echoed evidence and must
 * match — so no echoed candidate score can move a blocked verdict. Throws
 * {@link SniperReleaseCandidateError} on the first problem. Pure.
 */
export function validateMainnetDryRunReleaseCandidate(value: unknown): SniperMainnetDryRunReleaseCandidate {
  if (!isObject(value)) throw new SniperReleaseCandidateError("release candidate must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) {
      throw new SniperReleaseCandidateError(`release candidate has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  for (const key of EXPECTED_KEYS) {
    if (!(key in value)) throw new SniperReleaseCandidateError(`release candidate is missing field "${key}"`);
  }

  if (value.schemaVersion !== SNIPER_RELEASE_CANDIDATE_SCHEMA_VERSION) {
    throw new SniperReleaseCandidateError(`schemaVersion must be "${SNIPER_RELEASE_CANDIDATE_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_RELEASE_CANDIDATE_BANNER) throw new SniperReleaseCandidateError("banner must be the canonical banner");
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperReleaseCandidateError("disclaimers must be a non-empty array");
  }
  if (value.network !== SNIPER_RELEASE_CANDIDATE_NETWORK) {
    throw new SniperReleaseCandidateError(`network must literally be "${SNIPER_RELEASE_CANDIDATE_NETWORK}"`);
  }
  if (value.mode !== SNIPER_RELEASE_CANDIDATE_MODE) {
    throw new SniperReleaseCandidateError(`mode must literally be "${SNIPER_RELEASE_CANDIDATE_MODE}"`);
  }
  if (value.liveSendStatus !== SNIPER_RELEASE_CANDIDATE_LIVE_SEND_STATUS) {
    throw new SniperReleaseCandidateError(`liveSendStatus must literally be "${SNIPER_RELEASE_CANDIDATE_LIVE_SEND_STATUS}" — a release candidate can never report live enabled`);
  }
  if (!(SNIPER_RELEASE_CANDIDATE_VERDICTS as readonly string[]).includes(value.verdict as string)) {
    throw new SniperReleaseCandidateError(`verdict must be one of: ${SNIPER_RELEASE_CANDIDATE_VERDICTS.join(", ")}`);
  }

  // Re-normalize the structured evidence (this validates every nested field) and re-derive the
  // verdict from it — the echoed verdict must match. No candidate score participates.
  // candidateSource + txInspection are validated for their nested fields only (not used in the
  // verdict), so they are checked for side effects without binding an unused result.
  if (!isObject(value.candidateSource)) throw new SniperReleaseCandidateError("candidateSource must be an object");
  reqEnum(value.candidateSource.kind, "candidateSource.kind", CANDIDATE_SOURCE_KINDS);
  safeLabel(value.candidateSource.label, "candidateSource.label", MAX_LABEL_LEN, false);
  normalizeTxInspection(value.txInspection as ReleaseCandidateTxInspectionEvidence);
  const scoring = normalizeScoring(value.scoring as ReleaseCandidateScoringEvidence);
  const risk = normalizeRisk(value.risk as ReleaseCandidateRiskEvidence);
  const quote = normalizeQuote(value.quote as ReleaseCandidateQuoteEvidence);
  const build = normalizeBuild(value.build as ReleaseCandidateBuildEvidence);
  const simulation = normalizeSimulation(value.simulation as ReleaseCandidateSimulationEvidence);
  const readiness = normalizeReadiness(value.readiness as ReleaseCandidateReadinessEvidence);
  const stageError = normalizeStageError(value.stageError as ReleaseCandidateStageError);

  const expectedVerdict = deriveReleaseCandidateVerdict(
    verdictEvidenceFromArtifact({ stageError, scoring, risk, quote, build, simulation, readiness }),
  );
  if (value.verdict !== expectedVerdict) {
    throw new SniperReleaseCandidateError(`verdict must be ${JSON.stringify(expectedVerdict)} (re-derived from the echoed evidence), got ${JSON.stringify(value.verdict)}`);
  }

  if (!Array.isArray(value.whyLiveBlocked) || value.whyLiveBlocked.length === 0) {
    throw new SniperReleaseCandidateError("whyLiveBlocked must be a non-empty array");
  }
  if (!value.whyLiveBlocked.includes(POLICY_LINE)) {
    throw new SniperReleaseCandidateError("whyLiveBlocked must pin the live-disabled policy line");
  }
  for (const field of ["nextSafeActions", "caveats", "artifactRefs"] as const) {
    if (!Array.isArray(value[field])) throw new SniperReleaseCandidateError(`${field} must be an array`);
  }
  if ((value.nextSafeActions as unknown[]).length === 0) throw new SniperReleaseCandidateError("nextSafeActions must be non-empty");
  if ((value.caveats as unknown[]).length === 0) throw new SniperReleaseCandidateError("caveats must be non-empty");

  for (const [field, expected] of [
    ["redactionApplied", true],
    ["notExecutable", true],
    ["neverSigns", true],
    ["neverSends", true],
    ["phase7LiveTradingReady", false],
    ["scoreIsNotLiveReadiness", true],
    ["highScoreIsNotSafeToTrade", true],
  ] as const) {
    if (value[field] !== expected) throw new SniperReleaseCandidateError(`${field} must literally be ${String(expected)}`);
  }

  return value as unknown as SniperMainnetDryRunReleaseCandidate;
}
