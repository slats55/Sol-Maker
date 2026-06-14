/**
 * Deterministic, **no-send** SNIPER DRY-RUN CAMPAIGN artifact (Sprint 104-C operator layer).
 *
 * A campaign is a SAFE, no-send session that compares many candidates across the existing paper /
 * dry-run evidence — ranking, watchlist status, deep risk, route quote, unsigned build, simulation,
 * the mainnet dry-run release candidate, and the token preflight. This module folds the per-candidate
 * evidence the operator already gathered (each piece read + projected by the CLI) into ONE auditable
 * comparison artifact: `sniper.dryrun.campaign.v1`.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work — the orchestrator reads the
 * artifacts and hands their summarized evidence here. The builder never signs, never sends, never
 * loads a key, and is structurally incapable of claiming the live path is enabled:
 *
 *   - `liveSendStatus` is the literal `"disabled"`, always; the schema is CLOSED and refuses any
 *     `signature` / `txid` / `sendResult` field;
 *   - `neverSends` / `notExecutable` are pinned true and `phase7LiveTradingReady` pinned false.
 *
 * Each candidate's `finalOperatorVerdict` (`watch` | `review` | `blocked` | `insufficient-evidence`)
 * is RE-DERIVED from the structured evidence ALONE and the validator recomputes it independently. A
 * candidate's score — however high — can NEVER move a blocked verdict, because the derivation never
 * reads a score: a REJECT risk decision, a critical risk flag, a Token-2022 blocker, a refused build,
 * a failed simulation, a `fail` preflight, a `blocked` watchlist status, or a blocking release-candidate
 * verdict each force `blocked`. Missing core evidence (no risk, no preflight, no release candidate)
 * is surfaced honestly as `insufficient-evidence`, never hidden behind a clean-looking score.
 */

import { redactString } from "@soulmaker/security";
import { parseMintAddress, isValidMintAddress } from "./mint-address.js";
import { SNIPER_WATCHLIST_STATUSES, type SniperWatchlistStatus } from "./watchlist.js";
import { SNIPER_RELEASE_CANDIDATE_VERDICTS } from "./mainnet-dryrun-release-candidate.js";

/** Stable schema identifier for the campaign artifact. Bump only on a breaking change. */
export const SNIPER_DRYRUN_CAMPAIGN_SCHEMA_VERSION = "sniper.dryrun.campaign.v1";

/** The banner that prefixes every campaign artifact (required label). */
export const SNIPER_DRYRUN_CAMPAIGN_BANNER =
  "SNIPER DRY-RUN CAMPAIGN — a no-send comparison of candidates across paper / dry-run evidence. LIVE SENDING IS DISABLED.";

/** Closed mode set a campaign can run in. None of them can send. */
export const SNIPER_DRYRUN_CAMPAIGN_MODES = ["paper", "mainnet-dry-run", "devnet-review"] as const;
export type SniperDryRunCampaignMode = (typeof SNIPER_DRYRUN_CAMPAIGN_MODES)[number];

/** Closed network set a campaign can be scoped to. */
export const SNIPER_DRYRUN_CAMPAIGN_NETWORKS = ["mainnet-beta", "devnet", "testnet"] as const;
export type SniperDryRunCampaignNetwork = (typeof SNIPER_DRYRUN_CAMPAIGN_NETWORKS)[number];

/** Closed per-candidate operator verdict set. `watch` is the BEST a candidate gets — never "buy". */
export const SNIPER_CAMPAIGN_CANDIDATE_VERDICTS = ["watch", "review", "blocked", "insufficient-evidence"] as const;
export type SniperCampaignCandidateVerdict = (typeof SNIPER_CAMPAIGN_CANDIDATE_VERDICTS)[number];

/** Closed quote-status set (projected from the route-quote evidence). */
export const SNIPER_CAMPAIGN_QUOTE_STATUSES = [
  "observed",
  "stale",
  "unavailable",
  "blocked",
  "error",
  "unsupported",
  "not-attempted",
] as const;
export type SniperCampaignQuoteStatus = (typeof SNIPER_CAMPAIGN_QUOTE_STATUSES)[number];

/** Closed unsigned-build status set. */
export const SNIPER_CAMPAIGN_BUILD_STATUSES = ["succeeded", "refused", "not-attempted"] as const;
export type SniperCampaignBuildStatus = (typeof SNIPER_CAMPAIGN_BUILD_STATUSES)[number];

/** Closed simulation status set (mirrors the txpreview outcomes; nothing here is a live send). */
export const SNIPER_CAMPAIGN_SIMULATION_STATUSES = ["simulated-ok", "failed", "unavailable", "not-attempted"] as const;
export type SniperCampaignSimulationStatus = (typeof SNIPER_CAMPAIGN_SIMULATION_STATUSES)[number];

/** Closed risk-decision set (mirrors @soulmaker/risk). */
export const SNIPER_CAMPAIGN_RISK_DECISIONS = ["REJECT", "CAUTION", "PASS_FOR_PAPER_EVALUATION"] as const;
/** Closed preflight verdict set (mirrors the token preflight). */
export const SNIPER_CAMPAIGN_PREFLIGHT_VERDICTS = ["pass", "warn", "fail", "unknown"] as const;

/** Required disclaimer statements carried by every campaign artifact (stable order). */
export const SNIPER_DRYRUN_CAMPAIGN_DISCLAIMERS: readonly string[] = [
  "SNIPER DRY-RUN CAMPAIGN — a no-send comparison of operator-supplied candidates across paper / dry-run evidence (ranking, watchlist, risk, quote, build, simulation, release candidate, preflight).",
  "Live sending is DISABLED. This artifact is structurally incapable of reporting a live send, a signature, or an armed state; mainnet sending has NO CLI surface.",
  "A candidate's verdict is RE-DERIVED from risk / build / simulation / preflight evidence — a high candidate score can NEVER override a blocked verdict, and a score is never a buy signal.",
  "'watch' is the best a candidate reaches here — it means 'keep monitoring', never 'ready' or 'safe to trade'. 'insufficient-evidence' means evidence is missing, not that a candidate is fine.",
  "No wallet, key, signing, sending, or live execution is involved anywhere in producing this artifact.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
];

/** The fixed live-send status. There is no input that can change it. */
export const SNIPER_DRYRUN_CAMPAIGN_LIVE_SEND_STATUS = "disabled";

const MAX_CANDIDATES = 1000;
const MAX_LABEL_LEN = 200;
const MAX_LINE_LEN = 400;
const MAX_LIST = 64;

/** Verdicts of a release candidate that BLOCK (error or any blocked-*). */
const BLOCKING_RELEASE_VERDICTS: ReadonlySet<string> = new Set([
  "dryrun-error",
  "dryrun-blocked-risk",
  "dryrun-blocked-quote",
  "dryrun-blocked-build",
  "dryrun-blocked-simulation",
]);

/** Thrown when a campaign INPUT or produced artifact is structurally invalid. */
export class SniperDryRunCampaignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperDryRunCampaignError";
  }
}

// --- evidence model ----------------------------------------------------------

/** One candidate's per-stage evidence (raw input; the CLI projects each piece from a real artifact). */
export interface SniperDryRunCampaignCandidateInput {
  candidateId: string;
  mint: string;
  rank?: number | null;
  score?: number | null;
  watchlistStatus?: string | null;
  riskDecision?: string | null;
  riskCriticalFlagCount?: number | null;
  token2022Blocker?: boolean | null;
  quoteStatus?: string | null;
  buildStatus?: string | null;
  buildRefusalCodes?: string[];
  simulationStatus?: string | null;
  releaseCandidateVerdict?: string | null;
  preflightVerdict?: string | null;
  notes?: string[];
}

/** Everything {@link buildSniperDryRunCampaign} accepts. */
export interface BuildSniperDryRunCampaignInput {
  campaignId?: string | null;
  generatedAt?: string | null;
  mode?: string | null;
  network?: string | null;
  candidates: SniperDryRunCampaignCandidateInput[];
  artifactRefs?: string[];
}

// --- artifact model ----------------------------------------------------------

/** One candidate's normalized comparison row + re-derived verdict. */
export interface SniperDryRunCampaignCandidate {
  candidateId: string;
  mint: string;
  rank: number | null;
  score: number | null;
  watchlistStatus: SniperWatchlistStatus | null;
  riskDecision: string | null;
  riskCriticalFlagCount: number | null;
  token2022Blocker: boolean;
  quoteStatus: SniperCampaignQuoteStatus | null;
  buildStatus: SniperCampaignBuildStatus | null;
  buildRefusalCodes: string[];
  simulationStatus: SniperCampaignSimulationStatus | null;
  releaseCandidateVerdict: string | null;
  preflightVerdict: string | null;
  finalOperatorVerdict: SniperCampaignCandidateVerdict;
  blockers: string[];
  nextSafeAction: string;
  notes: string[];
}

/** Per-verdict tally (re-derived). */
export interface SniperCampaignVerdictCounts {
  watch: number;
  review: number;
  blocked: number;
  insufficientEvidence: number;
}

/** One pipeline stage's coverage across the candidate set (re-derived). */
export interface SniperCampaignStage {
  stage: string;
  description: string;
  candidatesCovered: number;
  candidateCount: number;
}

/** The full, deterministic, JSON-serializable campaign artifact. */
export interface SniperDryRunCampaign {
  schemaVersion: string;
  banner: string;
  disclaimers: string[];
  campaignId: string;
  generatedAt: string | null;
  mode: SniperDryRunCampaignMode;
  network: SniperDryRunCampaignNetwork;
  candidateCount: number;
  verdictCounts: SniperCampaignVerdictCounts;
  stages: SniperCampaignStage[];
  candidates: SniperDryRunCampaignCandidate[];
  nextSafeAction: string;
  artifactRefs: string[];
  liveSendStatus: "disabled";
  caveats: string[];
  redactionApplied: true;
  notExecutable: true;
  neverSends: true;
  phase7LiveTradingReady: false;
  scoreCannotOverrideBlock: true;
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectControlChars(value: string, name: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    const isBomOrSeparator = code === 0xfeff || code === 0x2028 || code === 0x2029;
    if (isControl || isBomOrSeparator) {
      throw new SniperDryRunCampaignError(`${name} contains a control character, NUL, or BOM and is refused`);
    }
  }
}

function safeLabel(value: unknown, name: string, max: number, nullable: boolean): string | null {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw new SniperDryRunCampaignError(`${name} is required`);
  }
  if (typeof value !== "string") throw new SniperDryRunCampaignError(`${name} must be a string`);
  rejectControlChars(value, name);
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (nullable) return null;
    throw new SniperDryRunCampaignError(`${name} must be a non-empty string`);
  }
  if (trimmed.length > max) throw new SniperDryRunCampaignError(`${name} exceeds ${max} characters`);
  if (redactString(trimmed) !== trimmed) throw new SniperDryRunCampaignError(`${name} is secret-shaped and is refused`);
  return trimmed;
}

function optEnum(value: unknown, name: string, allowed: readonly string[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new SniperDryRunCampaignError(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function optRank(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new SniperDryRunCampaignError(`${name} must be a positive integer or null`);
  }
  return value;
}

function optScore(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new SniperDryRunCampaignError(`${name} must be an integer 0-100 or null`);
  }
  return value;
}

function optCount(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new SniperDryRunCampaignError(`${name} must be a non-negative integer or null`);
  }
  return value;
}

function normalizeStringList(value: unknown, name: string, maxCount: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SniperDryRunCampaignError(`${name} must be an array of strings`);
  if (value.length > maxCount) throw new SniperDryRunCampaignError(`${name} exceeds ${maxCount} entries`);
  return value.map((s, i) => {
    if (typeof s !== "string") throw new SniperDryRunCampaignError(`${name}[${i}] must be a string`);
    rejectControlChars(s, `${name}[${i}]`);
    const trimmed = s.trim();
    if (trimmed.length === 0) throw new SniperDryRunCampaignError(`${name}[${i}] must be a non-empty string`);
    if (trimmed.length > MAX_LINE_LEN) throw new SniperDryRunCampaignError(`${name}[${i}] exceeds ${MAX_LINE_LEN} characters`);
    if (redactString(trimmed) !== trimmed) throw new SniperDryRunCampaignError(`${name}[${i}] is secret-shaped and is refused`);
    return trimmed;
  });
}

// --- verdict derivation (the parity heart; a SCORE is never read) -------------

/** The structured fields the verdict derivation reads — `score` is deliberately not among them. */
interface CampaignVerdictEvidence {
  watchlistStatus: SniperWatchlistStatus | null;
  riskDecision: string | null;
  riskCriticalFlagCount: number | null;
  token2022Blocker: boolean;
  quoteStatus: SniperCampaignQuoteStatus | null;
  buildStatus: SniperCampaignBuildStatus | null;
  buildRefusalCodes: string[];
  simulationStatus: SniperCampaignSimulationStatus | null;
  releaseCandidateVerdict: string | null;
  preflightVerdict: string | null;
}

/** Collect the human-readable hard-blocker reasons (drives the `blocked` verdict). */
function blockerReasons(ev: CampaignVerdictEvidence): string[] {
  const reasons: string[] = [];
  if (ev.watchlistStatus === "blocked") reasons.push("watchlist status is blocked");
  if (ev.riskDecision === "REJECT") reasons.push("deep risk REJECTED this candidate");
  if ((ev.riskCriticalFlagCount ?? 0) > 0) reasons.push(`risk has ${ev.riskCriticalFlagCount} critical flag(s)`);
  if (ev.token2022Blocker) reasons.push("a Token-2022 extension blocker is present");
  if (ev.preflightVerdict === "fail") reasons.push("token preflight FAILED");
  if (ev.buildStatus === "refused") {
    reasons.push(
      ev.buildRefusalCodes.length > 0 ? `unsigned build refused (${ev.buildRefusalCodes.join(", ")})` : "unsigned build refused",
    );
  }
  if (ev.simulationStatus === "failed") reasons.push("real simulation FAILED");
  if (ev.releaseCandidateVerdict !== null && BLOCKING_RELEASE_VERDICTS.has(ev.releaseCandidateVerdict)) {
    reasons.push(`mainnet dry-run release candidate is ${ev.releaseCandidateVerdict}`);
  }
  return reasons;
}

/** Collect the review-level concern reasons (drives the `review` verdict). */
function reviewReasons(ev: CampaignVerdictEvidence): string[] {
  const reasons: string[] = [];
  if (ev.watchlistStatus === "review") reasons.push("watchlist status is review");
  if (ev.riskDecision === "CAUTION") reasons.push("deep risk returned CAUTION");
  if (ev.preflightVerdict === "warn") reasons.push("token preflight WARNED");
  if (ev.preflightVerdict === "unknown") reasons.push("token preflight is unknown (no data)");
  if (ev.quoteStatus === "stale") reasons.push("the route quote is stale");
  if (ev.quoteStatus !== null && ev.quoteStatus !== "observed" && ev.quoteStatus !== "stale" && ev.quoteStatus !== "not-attempted") {
    reasons.push(`the route quote is ${ev.quoteStatus}`);
  }
  if (ev.simulationStatus === "unavailable") reasons.push("the simulation was unavailable");
  if (ev.releaseCandidateVerdict === "dryrun-insufficient-evidence") reasons.push("the release candidate has insufficient evidence");
  return reasons;
}

/** True if this candidate has at least one piece of CORE safety evidence (risk / preflight / RC). */
function hasCoreEvidence(ev: CampaignVerdictEvidence): boolean {
  return ev.riskDecision !== null || ev.preflightVerdict !== null || ev.releaseCandidateVerdict !== null;
}

/** True if this candidate carries a POSITIVE clean signal (risk PASS / preflight pass / RC complete). */
function hasCleanSignal(ev: CampaignVerdictEvidence): boolean {
  return (
    ev.riskDecision === "PASS_FOR_PAPER_EVALUATION" ||
    ev.preflightVerdict === "pass" ||
    ev.releaseCandidateVerdict === "dryrun-complete-blocked-live"
  );
}

/**
 * Re-derive the closed per-candidate verdict from structured evidence ALONE. A score is never read,
 * so no score can move a blocked verdict. Pure and deterministic. Precedence:
 *   blocked  → any hard blocker (risk REJECT / critical flag / Token-2022 / preflight fail / build
 *              refused / simulation failed / blocking release-candidate verdict / watchlist blocked);
 *   insufficient-evidence → no CORE evidence (risk / preflight / release candidate) at all;
 *   review   → core evidence present but a concern OR no positive clean signal;
 *   watch    → core evidence present, a positive clean signal, and no concern.
 */
export function deriveSniperCampaignCandidateVerdict(ev: CampaignVerdictEvidence): SniperCampaignCandidateVerdict {
  if (blockerReasons(ev).length > 0) return "blocked";
  if (!hasCoreEvidence(ev)) return "insufficient-evidence";
  if (reviewReasons(ev).length > 0 || !hasCleanSignal(ev)) return "review";
  return "watch";
}

function deriveCandidateNextSafeAction(verdict: SniperCampaignCandidateVerdict, ev: CampaignVerdictEvidence): string {
  switch (verdict) {
    case "blocked":
      return `BLOCKED: ${blockerReasons(ev).join("; ")}. Drop or remediate this candidate; never override a risk / build / simulation gate. Nothing here trades.`;
    case "review": {
      const reasons = reviewReasons(ev);
      const detail = reasons.length > 0 ? reasons.join("; ") : "a positive clean signal is missing";
      return `REVIEW: ${detail}. Re-check risk / quote / simulation before any further step; live trading stays disabled.`;
    }
    case "insufficient-evidence":
      return "INSUFFICIENT EVIDENCE: gather deep risk (token:risk), a token preflight, or a mainnet dry-run release candidate for this candidate, then re-run the campaign.";
    case "watch":
      return "WATCH: clean dry-run evidence — keep on the watchlist and keep monitoring. This is NOT a buy signal; live trading stays disabled.";
  }
}

// --- stage coverage ----------------------------------------------------------

interface StageSpec {
  stage: string;
  description: string;
  covered: (c: SniperDryRunCampaignCandidate) => boolean;
}

const STAGE_SPECS: readonly StageSpec[] = [
  { stage: "ranking", description: "memecoin candidate scoring (intelligence only; never a buy signal)", covered: (c) => c.score !== null },
  { stage: "watchlist", description: "operator watchlist status (bookkeeping only)", covered: (c) => c.watchlistStatus !== null },
  { stage: "risk", description: "deep read-only risk decision", covered: (c) => c.riskDecision !== null },
  { stage: "quote", description: "route-quote observation status", covered: (c) => c.quoteStatus !== null && c.quoteStatus !== "not-attempted" },
  { stage: "build", description: "refusal-first unsigned build status (never signs / sends)", covered: (c) => c.buildStatus !== null && c.buildStatus !== "not-attempted" },
  { stage: "simulation", description: "real transaction simulation outcome (no send)", covered: (c) => c.simulationStatus !== null && c.simulationStatus !== "not-attempted" },
  { stage: "release-candidate", description: "mainnet dry-run release-candidate verdict", covered: (c) => c.releaseCandidateVerdict !== null },
  { stage: "preflight", description: "token preflight verdict", covered: (c) => c.preflightVerdict !== null },
];

function deriveStages(candidates: readonly SniperDryRunCampaignCandidate[]): SniperCampaignStage[] {
  return STAGE_SPECS.map((spec) => ({
    stage: spec.stage,
    description: spec.description,
    candidatesCovered: candidates.filter((c) => spec.covered(c)).length,
    candidateCount: candidates.length,
  }));
}

function deriveVerdictCounts(candidates: readonly SniperDryRunCampaignCandidate[]): SniperCampaignVerdictCounts {
  return {
    watch: candidates.filter((c) => c.finalOperatorVerdict === "watch").length,
    review: candidates.filter((c) => c.finalOperatorVerdict === "review").length,
    blocked: candidates.filter((c) => c.finalOperatorVerdict === "blocked").length,
    insufficientEvidence: candidates.filter((c) => c.finalOperatorVerdict === "insufficient-evidence").length,
  };
}

function deriveCampaignNextSafeAction(counts: SniperCampaignVerdictCounts): string {
  if (counts.blocked > 0) {
    return `${counts.blocked} candidate(s) BLOCKED — review the blockers below; never override a risk / build / simulation gate. Live trading stays disabled. Inspect with \`pnpm web:inspect --dir <campaign folder>\`.`;
  }
  if (counts.review > 0 || counts.insufficientEvidence > 0) {
    return `${counts.review} candidate(s) need review and ${counts.insufficientEvidence} need more evidence — gather risk / quote / dry-run evidence and re-run. Live trading stays disabled.`;
  }
  return "All candidates are clean-to-watch on the current evidence — keep monitoring. This is NOT a buy signal; live trading stays disabled.";
}

const DEFAULT_CAVEATS: readonly string[] = [
  "A campaign compares evidence; it never trades, never sends, and never authorizes a live path.",
  "Every per-candidate verdict is derived from risk / build / simulation / preflight evidence — a candidate's score is never read by the derivation, so a high score cannot rescue a blocked candidate.",
  "Missing evidence is shown as 'insufficient-evidence', not hidden — re-run after gathering the missing stage.",
  "Live trading is disabled by policy; there is no mainnet-send command anywhere in Sol Maker.",
];

// --- candidate normalization -------------------------------------------------

function normalizeCandidate(raw: unknown, index: number, seenIds: Set<string>): SniperDryRunCampaignCandidate {
  const where = `candidates[${index}]`;
  if (!isObject(raw)) throw new SniperDryRunCampaignError(`${where} must be an object`);

  const candidateId = safeLabel(raw.candidateId, `${where}.candidateId`, 128, false) as string;
  if (seenIds.has(candidateId)) throw new SniperDryRunCampaignError(`duplicate candidateId "${candidateId}"`);
  seenIds.add(candidateId);

  let mint: string;
  try {
    mint = parseMintAddress(raw.mint);
  } catch (err) {
    throw new SniperDryRunCampaignError(`${where}: ${(err as Error).message}`);
  }

  const token2022Blocker = raw.token2022Blocker === undefined || raw.token2022Blocker === null ? false : raw.token2022Blocker;
  if (typeof token2022Blocker !== "boolean") throw new SniperDryRunCampaignError(`${where}.token2022Blocker must be a boolean or null`);

  const evidence: CampaignVerdictEvidence = {
    watchlistStatus: optEnum(raw.watchlistStatus, `${where}.watchlistStatus`, SNIPER_WATCHLIST_STATUSES) as SniperWatchlistStatus | null,
    riskDecision: optEnum(raw.riskDecision, `${where}.riskDecision`, SNIPER_CAMPAIGN_RISK_DECISIONS),
    riskCriticalFlagCount: optCount(raw.riskCriticalFlagCount, `${where}.riskCriticalFlagCount`),
    token2022Blocker,
    quoteStatus: optEnum(raw.quoteStatus, `${where}.quoteStatus`, SNIPER_CAMPAIGN_QUOTE_STATUSES) as SniperCampaignQuoteStatus | null,
    buildStatus: optEnum(raw.buildStatus, `${where}.buildStatus`, SNIPER_CAMPAIGN_BUILD_STATUSES) as SniperCampaignBuildStatus | null,
    buildRefusalCodes: normalizeStringList(raw.buildRefusalCodes, `${where}.buildRefusalCodes`, 32),
    simulationStatus: optEnum(raw.simulationStatus, `${where}.simulationStatus`, SNIPER_CAMPAIGN_SIMULATION_STATUSES) as SniperCampaignSimulationStatus | null,
    releaseCandidateVerdict: optEnum(raw.releaseCandidateVerdict, `${where}.releaseCandidateVerdict`, SNIPER_RELEASE_CANDIDATE_VERDICTS),
    preflightVerdict: optEnum(raw.preflightVerdict, `${where}.preflightVerdict`, SNIPER_CAMPAIGN_PREFLIGHT_VERDICTS),
  };

  const finalOperatorVerdict = deriveSniperCampaignCandidateVerdict(evidence);
  const blockers = blockerReasons(evidence);

  return {
    candidateId,
    mint,
    rank: optRank(raw.rank, `${where}.rank`),
    score: optScore(raw.score, `${where}.score`),
    watchlistStatus: evidence.watchlistStatus,
    riskDecision: evidence.riskDecision,
    riskCriticalFlagCount: evidence.riskCriticalFlagCount,
    token2022Blocker: evidence.token2022Blocker,
    quoteStatus: evidence.quoteStatus,
    buildStatus: evidence.buildStatus,
    buildRefusalCodes: evidence.buildRefusalCodes,
    simulationStatus: evidence.simulationStatus,
    releaseCandidateVerdict: evidence.releaseCandidateVerdict,
    preflightVerdict: evidence.preflightVerdict,
    finalOperatorVerdict,
    blockers,
    nextSafeAction: deriveCandidateNextSafeAction(finalOperatorVerdict, evidence),
    notes: normalizeStringList(raw.notes, `${where}.notes`, MAX_LIST),
  };
}

function evidenceOf(c: SniperDryRunCampaignCandidate): CampaignVerdictEvidence {
  return {
    watchlistStatus: c.watchlistStatus,
    riskDecision: c.riskDecision,
    riskCriticalFlagCount: c.riskCriticalFlagCount,
    token2022Blocker: c.token2022Blocker,
    quoteStatus: c.quoteStatus,
    buildStatus: c.buildStatus,
    buildRefusalCodes: c.buildRefusalCodes,
    simulationStatus: c.simulationStatus,
    releaseCandidateVerdict: c.releaseCandidateVerdict,
    preflightVerdict: c.preflightVerdict,
  };
}

// --- build -------------------------------------------------------------------

/**
 * Build a canonical {@link SniperDryRunCampaign} from per-candidate evidence. Pure, non-mutating,
 * deterministic. Each candidate's `finalOperatorVerdict` is RE-DERIVED from the structured evidence
 * (never from a score); the verdict counts, stage coverage, and campaign next-safe-action are
 * re-derived; `liveSendStatus` is pinned "disabled". Throws {@link SniperDryRunCampaignError} on any
 * structural problem.
 */
export function buildSniperDryRunCampaign(input: BuildSniperDryRunCampaignInput): SniperDryRunCampaign {
  if (!isObject(input)) throw new SniperDryRunCampaignError("campaign input must be an object");

  const campaignId = (safeLabel(input.campaignId, "campaignId", 128, true) as string | null) ?? "sniper-dryrun-campaign";
  const generatedAt = safeLabel(input.generatedAt, "generatedAt", 40, true);
  const mode = (optEnum(input.mode, "mode", SNIPER_DRYRUN_CAMPAIGN_MODES) as SniperDryRunCampaignMode | null) ?? "paper";
  const network = (optEnum(input.network, "network", SNIPER_DRYRUN_CAMPAIGN_NETWORKS) as SniperDryRunCampaignNetwork | null) ?? "mainnet-beta";

  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    throw new SniperDryRunCampaignError("campaign input.candidates must be a non-empty array");
  }
  if (input.candidates.length > MAX_CANDIDATES) {
    throw new SniperDryRunCampaignError(`campaign input.candidates exceeds ${MAX_CANDIDATES} entries`);
  }
  const seenIds = new Set<string>();
  const candidates = input.candidates.map((c, i) => normalizeCandidate(c, i, seenIds));

  let artifactRefs: string[] = [];
  if (input.artifactRefs !== undefined && input.artifactRefs !== null) {
    if (!Array.isArray(input.artifactRefs)) throw new SniperDryRunCampaignError("artifactRefs must be an array of strings");
    if (input.artifactRefs.length > MAX_LIST) throw new SniperDryRunCampaignError(`artifactRefs exceeds ${MAX_LIST} entries`);
    artifactRefs = input.artifactRefs.map((r, i) => safeLabel(r, `artifactRefs[${i}]`, MAX_LABEL_LEN, false) as string);
  }

  const verdictCounts = deriveVerdictCounts(candidates);
  const stages = deriveStages(candidates);

  return {
    schemaVersion: SNIPER_DRYRUN_CAMPAIGN_SCHEMA_VERSION,
    banner: SNIPER_DRYRUN_CAMPAIGN_BANNER,
    disclaimers: [...SNIPER_DRYRUN_CAMPAIGN_DISCLAIMERS],
    campaignId,
    generatedAt,
    mode,
    network,
    candidateCount: candidates.length,
    verdictCounts,
    stages,
    candidates,
    nextSafeAction: deriveCampaignNextSafeAction(verdictCounts),
    artifactRefs,
    liveSendStatus: SNIPER_DRYRUN_CAMPAIGN_LIVE_SEND_STATUS,
    caveats: [...DEFAULT_CAVEATS],
    redactionApplied: true,
    notExecutable: true,
    neverSends: true,
    phase7LiveTradingReady: false,
    scoreCannotOverrideBlock: true,
  };
}

// --- validation (backstop + parity wall) -------------------------------------

const EXPECTED_KEYS = [
  "schemaVersion",
  "banner",
  "disclaimers",
  "campaignId",
  "generatedAt",
  "mode",
  "network",
  "candidateCount",
  "verdictCounts",
  "stages",
  "candidates",
  "nextSafeAction",
  "artifactRefs",
  "liveSendStatus",
  "caveats",
  "redactionApplied",
  "notExecutable",
  "neverSends",
  "phase7LiveTradingReady",
  "scoreCannotOverrideBlock",
] as const;

const EXPECTED_CANDIDATE_KEYS = [
  "candidateId",
  "mint",
  "rank",
  "score",
  "watchlistStatus",
  "riskDecision",
  "riskCriticalFlagCount",
  "token2022Blocker",
  "quoteStatus",
  "buildStatus",
  "buildRefusalCodes",
  "simulationStatus",
  "releaseCandidateVerdict",
  "preflightVerdict",
  "finalOperatorVerdict",
  "blockers",
  "nextSafeAction",
  "notes",
] as const;

function validateCandidate(value: unknown, where: string): SniperDryRunCampaignCandidate {
  if (!isObject(value)) throw new SniperDryRunCampaignError(`${where} must be an object`);
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_CANDIDATE_KEYS as readonly string[]).includes(key)) {
      throw new SniperDryRunCampaignError(`${where} has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  // Re-normalize the structured evidence (this validates every nested field) and re-derive the verdict.
  const renorm = normalizeCandidate(
    {
      candidateId: value.candidateId,
      mint: value.mint,
      rank: value.rank,
      score: value.score,
      watchlistStatus: value.watchlistStatus,
      riskDecision: value.riskDecision,
      riskCriticalFlagCount: value.riskCriticalFlagCount,
      token2022Blocker: value.token2022Blocker,
      quoteStatus: value.quoteStatus,
      buildStatus: value.buildStatus,
      buildRefusalCodes: value.buildRefusalCodes,
      simulationStatus: value.simulationStatus,
      releaseCandidateVerdict: value.releaseCandidateVerdict,
      preflightVerdict: value.preflightVerdict,
      notes: value.notes,
    },
    0,
    new Set<string>(),
  );

  if (!(SNIPER_CAMPAIGN_CANDIDATE_VERDICTS as readonly string[]).includes(value.finalOperatorVerdict as string)) {
    throw new SniperDryRunCampaignError(`${where}.finalOperatorVerdict must be one of: ${SNIPER_CAMPAIGN_CANDIDATE_VERDICTS.join(", ")}`);
  }
  // The PARITY WALL: the echoed verdict must equal the independently re-derived one (no score can move it).
  if (value.finalOperatorVerdict !== renorm.finalOperatorVerdict) {
    throw new SniperDryRunCampaignError(
      `${where}.finalOperatorVerdict must be ${JSON.stringify(renorm.finalOperatorVerdict)} (re-derived from the echoed evidence), got ${JSON.stringify(value.finalOperatorVerdict)}`,
    );
  }
  if (!Array.isArray(value.blockers) || (value.blockers as unknown[]).some((b) => typeof b !== "string")) {
    throw new SniperDryRunCampaignError(`${where}.blockers must be an array of strings`);
  }
  // A blocked candidate MUST carry at least one blocker; a non-blocked one must carry none.
  if (renorm.finalOperatorVerdict === "blocked" && (value.blockers as unknown[]).length === 0) {
    throw new SniperDryRunCampaignError(`${where} is blocked but carries no blocker reasons`);
  }
  if (renorm.finalOperatorVerdict !== "blocked" && (value.blockers as unknown[]).length > 0) {
    throw new SniperDryRunCampaignError(`${where} is not blocked but carries blocker reasons`);
  }
  if (typeof value.nextSafeAction !== "string" || value.nextSafeAction.trim().length === 0) {
    throw new SniperDryRunCampaignError(`${where}.nextSafeAction must be a non-empty string`);
  }
  return value as unknown as SniperDryRunCampaignCandidate;
}

/**
 * Strictly validate a value as a canonical {@link SniperDryRunCampaign}. A backstop AND a parity wall:
 * the key set is CLOSED (no `signature` / `txid` / `sendResult` field can ever appear); the
 * banner / mode / network / live-send / safety literals are pinned; every candidate's verdict is
 * INDEPENDENTLY re-derived from its echoed evidence and must match (no score can move a blocked
 * verdict); the verdict counts and stage coverage are re-derived. Throws
 * {@link SniperDryRunCampaignError} on the first problem. Pure.
 */
export function validateSniperDryRunCampaign(value: unknown): SniperDryRunCampaign {
  if (!isObject(value)) throw new SniperDryRunCampaignError("campaign must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) {
      throw new SniperDryRunCampaignError(`campaign has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  for (const key of EXPECTED_KEYS) {
    if (!(key in value)) throw new SniperDryRunCampaignError(`campaign is missing field "${key}"`);
  }

  if (value.schemaVersion !== SNIPER_DRYRUN_CAMPAIGN_SCHEMA_VERSION) {
    throw new SniperDryRunCampaignError(`schemaVersion must be "${SNIPER_DRYRUN_CAMPAIGN_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_DRYRUN_CAMPAIGN_BANNER) throw new SniperDryRunCampaignError("banner must be the canonical banner");
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperDryRunCampaignError("disclaimers must be a non-empty array");
  }
  safeLabel(value.campaignId, "campaignId", 128, false);
  safeLabel(value.generatedAt, "generatedAt", 40, true);
  if (!(SNIPER_DRYRUN_CAMPAIGN_MODES as readonly string[]).includes(value.mode as string)) {
    throw new SniperDryRunCampaignError(`mode must be one of: ${SNIPER_DRYRUN_CAMPAIGN_MODES.join(", ")}`);
  }
  if (!(SNIPER_DRYRUN_CAMPAIGN_NETWORKS as readonly string[]).includes(value.network as string)) {
    throw new SniperDryRunCampaignError(`network must be one of: ${SNIPER_DRYRUN_CAMPAIGN_NETWORKS.join(", ")}`);
  }
  if (value.liveSendStatus !== SNIPER_DRYRUN_CAMPAIGN_LIVE_SEND_STATUS) {
    throw new SniperDryRunCampaignError(`liveSendStatus must literally be "${SNIPER_DRYRUN_CAMPAIGN_LIVE_SEND_STATUS}" — a campaign can never report live enabled`);
  }

  if (!Array.isArray(value.candidates) || value.candidates.length === 0) {
    throw new SniperDryRunCampaignError("candidates must be a non-empty array");
  }
  const seenIds = new Set<string>();
  const candidates = (value.candidates as unknown[]).map((c, i) => {
    const cand = validateCandidate(c, `candidates[${i}]`);
    if (seenIds.has(cand.candidateId)) throw new SniperDryRunCampaignError(`duplicate candidateId "${cand.candidateId}"`);
    seenIds.add(cand.candidateId);
    return cand;
  });
  if (value.candidateCount !== candidates.length) {
    throw new SniperDryRunCampaignError("candidateCount must equal candidates.length");
  }

  // Re-derive verdict counts + stage coverage from the (validated) candidates; they must match.
  const verdictCounts = deriveVerdictCounts(candidates);
  if (!isObject(value.verdictCounts) || JSON.stringify(value.verdictCounts) !== JSON.stringify(verdictCounts)) {
    throw new SniperDryRunCampaignError("verdictCounts must be re-derived from the candidates");
  }
  const stages = deriveStages(candidates);
  if (JSON.stringify(value.stages) !== JSON.stringify(stages)) {
    throw new SniperDryRunCampaignError("stages must be re-derived from the candidates");
  }

  if (typeof value.nextSafeAction !== "string" || value.nextSafeAction.trim().length === 0) {
    throw new SniperDryRunCampaignError("nextSafeAction must be a non-empty string");
  }
  for (const field of ["artifactRefs", "caveats"] as const) {
    if (!Array.isArray(value[field])) throw new SniperDryRunCampaignError(`${field} must be an array`);
  }
  if ((value.caveats as unknown[]).length === 0) throw new SniperDryRunCampaignError("caveats must be non-empty");

  for (const [field, expected] of [
    ["redactionApplied", true],
    ["notExecutable", true],
    ["neverSends", true],
    ["phase7LiveTradingReady", false],
    ["scoreCannotOverrideBlock", true],
  ] as const) {
    if (value[field] !== expected) throw new SniperDryRunCampaignError(`${field} must literally be ${String(expected)}`);
  }

  return value as unknown as SniperDryRunCampaign;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperDryRunCampaign}. */
export interface FormatSniperDryRunCampaignOptions {
  label?: string;
  /** Cap on the number of candidate rows printed (default 100; the rest are summarized). */
  maxRows?: number;
}

const VERDICT_MARK: Record<SniperCampaignCandidateVerdict, string> = {
  watch: "[watch]",
  review: "[review]",
  blocked: "[BLOCKED]",
  "insufficient-evidence": "[insufficient]",
};

/** Validate that a candidate evidence object is internally consistent (exported for the CLI/tests). */
export function isBlockingReleaseCandidateVerdict(verdict: string): boolean {
  return BLOCKING_RELEASE_VERDICTS.has(verdict);
}

/**
 * Render a redacted, stable, human-readable campaign summary. Deterministic and path-stable (no
 * timestamps). Leads with the banner + the verdict tally, prints a ranked candidate comparison
 * (rank, mint, verdict, score, risk/quote/build/sim/preflight), then the blockers, the campaign
 * next-safe-action, the caveats, and the disclaimers. The whole output passes through the redactor.
 */
export function formatSniperDryRunCampaign(
  campaign: SniperDryRunCampaign,
  opts: FormatSniperDryRunCampaignOptions = {},
): string {
  const maxRows = opts.maxRows ?? 100;
  const header = `${campaign.banner}`;
  const lines: string[] = [header, "=".repeat(Math.min(header.length, 80))];
  if (opts.label) lines.push(`label:    ${opts.label}`);
  lines.push(`id:       ${campaign.campaignId}`);
  lines.push(`mode:     ${campaign.mode} (${campaign.network})`);
  lines.push(`live:     ${campaign.liveSendStatus.toUpperCase()} (no mainnet-send command exists)`);
  lines.push(
    `verdicts: watch ${campaign.verdictCounts.watch} · review ${campaign.verdictCounts.review} · BLOCKED ${campaign.verdictCounts.blocked} · insufficient ${campaign.verdictCounts.insufficientEvidence}`,
  );

  lines.push("");
  lines.push("Candidates (by input order):");
  for (const c of campaign.candidates.slice(0, maxRows)) {
    const bits: string[] = [];
    if (c.rank !== null) bits.push(`#${c.rank}`);
    if (c.score !== null) bits.push(`score=${c.score}`);
    if (c.riskDecision !== null) bits.push(`risk=${c.riskDecision}`);
    if (c.quoteStatus !== null) bits.push(`quote=${c.quoteStatus}`);
    if (c.buildStatus !== null) bits.push(`build=${c.buildStatus}`);
    if (c.simulationStatus !== null) bits.push(`sim=${c.simulationStatus}`);
    if (c.preflightVerdict !== null) bits.push(`preflight=${c.preflightVerdict}`);
    if (c.releaseCandidateVerdict !== null) bits.push(`rc=${c.releaseCandidateVerdict}`);
    lines.push(`${VERDICT_MARK[c.finalOperatorVerdict]} ${c.candidateId}  ${c.mint}${bits.length > 0 ? `  [${bits.join("; ")}]` : ""}`);
    if (c.blockers.length > 0) lines.push(`    blockers: ${c.blockers.join("; ")}`);
    for (const note of c.notes) lines.push(`    note: ${note}`);
  }
  const hidden = campaign.candidates.length - Math.min(campaign.candidates.length, maxRows);
  if (hidden > 0) lines.push(`… and ${hidden} more (summarized; see the campaign JSON for the full set)`);

  lines.push("");
  lines.push("Stage coverage:");
  for (const s of campaign.stages) lines.push(`- ${s.stage}: ${s.candidatesCovered}/${s.candidateCount}`);

  lines.push("");
  lines.push(`next safe action: ${campaign.nextSafeAction}`);
  lines.push("");
  lines.push("Caveats:");
  for (const c of campaign.caveats) lines.push(`- ${c}`);
  lines.push("");
  for (const d of campaign.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
