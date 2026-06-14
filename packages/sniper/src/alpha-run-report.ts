/**
 * Deterministic, **no-send** ALPHA RUN REPORT artifact (Sprint 105-A alpha layer).
 *
 * One showable file that summarizes a whole no-send live-read-only alpha run for an operator or
 * reviewer: the plan it ran under, the campaign it produced, an optional diff against a previous
 * campaign, the top / blocked / insufficient-evidence candidates, stage coverage, provider + Rust
 * engine health, and the Phase 7 posture. It is a faithful PROJECTION of a validated campaign — the
 * candidate verdicts come from the campaign's own re-derivation, never re-invented here — and it is
 * structurally incapable of claiming a live send or live readiness:
 *
 *   - `liveTradingStatus` is the literal `"disabled"` and `authorizesLiveTrading` is pinned `false`;
 *   - the schema is CLOSED and refuses any `signature` / `txid` / `sendResult` field;
 *   - it distinguishes REAL read-only evidence from fixture / fictional-example evidence
 *     (`evidenceProvenance`), and never claims profitability or live readiness.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work — the CLI reads the campaign
 * (and plan / diff) and hands the validated objects here.
 */

import { redactString } from "@soulmaker/security";
import { parseMintAddress } from "./mint-address.js";
import {
  SNIPER_CAMPAIGN_CANDIDATE_VERDICTS,
  type SniperDryRunCampaign,
  type SniperCampaignCandidateVerdict,
} from "./dryrun-campaign.js";

/** Stable schema identifier for the alpha run report artifact. Bump only on a breaking change. */
export const SNIPER_ALPHA_RUN_REPORT_SCHEMA_VERSION = "sniper.alpha_run.report.v1";

/** The banner that prefixes every alpha run report (required label). */
export const SNIPER_ALPHA_RUN_REPORT_BANNER =
  "SNIPER ALPHA RUN REPORT — a no-send summary of a live-read-only campaign. NOT a profitability claim, NOT live readiness. LIVE TRADING IS DISABLED.";

/** Closed mode set (mirrors the campaign). */
export const SNIPER_ALPHA_RUN_REPORT_MODES = ["paper", "mainnet-dry-run", "devnet-review"] as const;
export type SniperAlphaRunReportMode = (typeof SNIPER_ALPHA_RUN_REPORT_MODES)[number];

/** Closed network set (mirrors the campaign). */
export const SNIPER_ALPHA_RUN_REPORT_NETWORKS = ["mainnet-beta", "devnet", "testnet"] as const;
export type SniperAlphaRunReportNetwork = (typeof SNIPER_ALPHA_RUN_REPORT_NETWORKS)[number];

/** Closed provenance set — REAL read-only vs fixture / fictional-example evidence (never faked). */
export const SNIPER_ALPHA_RUN_EVIDENCE_PROVENANCE = ["real-readonly", "fixture", "fictional-example", "mixed"] as const;
export type SniperAlphaRunEvidenceProvenance = (typeof SNIPER_ALPHA_RUN_EVIDENCE_PROVENANCE)[number];

/** Closed Rust engine status set. */
export const SNIPER_ALPHA_RUN_RUST_ENGINE_STATUSES = ["available", "unavailable", "mixed", "not-used"] as const;
export type SniperAlphaRunRustEngineStatus = (typeof SNIPER_ALPHA_RUN_RUST_ENGINE_STATUSES)[number];

/** Closed per-provider health status set (risk / quote / simulation). */
export const SNIPER_ALPHA_RUN_PROVIDER_STATUSES = ["ok", "degraded", "unavailable", "not-attempted"] as const;
export type SniperAlphaRunProviderStatus = (typeof SNIPER_ALPHA_RUN_PROVIDER_STATUSES)[number];

/** The fixed live-trading status. There is no input that can change it. */
export const SNIPER_ALPHA_RUN_LIVE_TRADING_STATUS = "disabled";

/** Required disclaimer statements carried by every alpha run report (stable order). */
export const SNIPER_ALPHA_RUN_REPORT_DISCLAIMERS: readonly string[] = [
  "SNIPER ALPHA RUN REPORT — a no-send summary of a live-read-only campaign over Solana memecoin candidates.",
  "Live trading is DISABLED. This report is structurally incapable of reporting a live send, a signature, or an armed state; mainnet sending has NO CLI surface.",
  "Candidate verdicts are taken from the campaign's own re-derivation (a high score can never override a blocker); this report only projects and ranks them.",
  "'watch' is the best a candidate reaches — it means keep monitoring, never ready or safe to trade. Real read-only evidence is labelled separately from fixture / fictional-example evidence.",
  "No wallet, key, signing, sending, or live execution is involved anywhere in producing this report.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "Not a live-readiness claim.",
];

const DEFAULT_CAVEATS: readonly string[] = [
  "This report summarizes a campaign; it never trades, never sends, and never authorizes a live path.",
  "Top candidates are the best-ranked watch / review candidates on the current evidence — never a buy list. A blocked candidate stays blocked no matter the score.",
  "Provenance is honest: real read-only network evidence is distinguished from fixture / fictional-example evidence; missing evidence is shown, never faked.",
  "Live trading is disabled by policy; there is no mainnet-send command anywhere in Sol Maker.",
];

const MAX_LABEL_LEN = 200;
const MAX_LINE_LEN = 400;
const MAX_LIST = 64;
const DEFAULT_TOP_LIMIT = 10;
const MAX_TOP_LIMIT = 200;

/** Thrown when an alpha run report INPUT or produced artifact is structurally invalid. */
export class SniperAlphaRunReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperAlphaRunReportError";
  }
}

// --- input / artifact model --------------------------------------------------

/** Per-provider read-only health (honest unavailable, never faked). */
export interface SniperAlphaRunProviderHealthInput {
  risk?: string | null;
  quote?: string | null;
  simulation?: string | null;
}

/** Everything {@link buildSniperAlphaRunReport} accepts. The campaign is the source of truth. */
export interface BuildSniperAlphaRunReportInput {
  runId?: string | null;
  generatedAt?: string | null;
  /** The validated campaign this report projects (source of candidate verdicts). */
  campaign: SniperDryRunCampaign;
  campaignRef: string;
  campaignPlanRef: string;
  watchlistRef?: string | null;
  diffRef?: string | null;
  providerHealth?: SniperAlphaRunProviderHealthInput;
  rustEngineStatus?: string | null;
  phase7Status?: string | null;
  evidenceProvenance?: string | null;
  topLimit?: number | null;
  nextSafeActions?: string[];
  caveats?: string[];
  artifactRefs?: string[];
}

/** One ranked / shown candidate (watch or review). */
export interface SniperAlphaTopCandidate {
  candidateId: string;
  mint: string;
  rank: number | null;
  score: number | null;
  verdict: SniperCampaignCandidateVerdict;
  riskDecision: string | null;
  quoteStatus: string | null;
  buildStatus: string | null;
  simulationStatus: string | null;
  nextSafeAction: string;
}

/** One blocked candidate (with its evidence-derived blockers). */
export interface SniperAlphaBlockedCandidate {
  candidateId: string;
  mint: string;
  verdict: "blocked";
  blockers: string[];
  nextSafeAction: string;
}

/** One insufficient-evidence candidate. */
export interface SniperAlphaInsufficientCandidate {
  candidateId: string;
  mint: string;
  verdict: "insufficient-evidence";
  nextSafeAction: string;
}

/** One pipeline stage's coverage (copied from the campaign). */
export interface SniperAlphaStageCoverage {
  stage: string;
  candidatesCovered: number;
  candidateCount: number;
}

/** Provider health summary block. */
export interface SniperAlphaProviderHealthSummary {
  risk: SniperAlphaRunProviderStatus;
  quote: SniperAlphaRunProviderStatus;
  simulation: SniperAlphaRunProviderStatus;
}

/** The full, deterministic, JSON-serializable alpha run report artifact. */
export interface SniperAlphaRunReport {
  schemaVersion: string;
  banner: string;
  disclaimers: string[];
  runId: string;
  generatedAt: string | null;
  mode: SniperAlphaRunReportMode;
  network: SniperAlphaRunReportNetwork;
  watchlistRef: string | null;
  campaignPlanRef: string;
  campaignRef: string;
  diffRef: string | null;
  candidateCount: number;
  topCandidates: SniperAlphaTopCandidate[];
  blockedCandidates: SniperAlphaBlockedCandidate[];
  insufficientEvidenceCandidates: SniperAlphaInsufficientCandidate[];
  stageCoverage: SniperAlphaStageCoverage[];
  providerHealthSummary: SniperAlphaProviderHealthSummary;
  rustEngineStatus: SniperAlphaRunRustEngineStatus;
  phase7Status: string;
  liveTradingStatus: "disabled";
  authorizesLiveTrading: false;
  nextSafeActions: string[];
  caveats: string[];
  artifactRefs: string[];
  evidenceProvenance: SniperAlphaRunEvidenceProvenance;
  redactionApplied: true;
  neverSends: true;
  phase7LiveTradingReady: false;
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
      throw new SniperAlphaRunReportError(`${name} contains a control character, NUL, or BOM and is refused`);
    }
  }
}

function safeLabel(value: unknown, name: string, max: number, nullable: boolean): string | null {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw new SniperAlphaRunReportError(`${name} is required`);
  }
  if (typeof value !== "string") throw new SniperAlphaRunReportError(`${name} must be a string`);
  rejectControlChars(value, name);
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (nullable) return null;
    throw new SniperAlphaRunReportError(`${name} must be a non-empty string`);
  }
  if (trimmed.length > max) throw new SniperAlphaRunReportError(`${name} exceeds ${max} characters`);
  if (redactString(trimmed) !== trimmed) throw new SniperAlphaRunReportError(`${name} is secret-shaped and is refused`);
  return trimmed;
}

function optEnum(value: unknown, name: string, allowed: readonly string[], fallback: string): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new SniperAlphaRunReportError(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function normalizeStringList(value: unknown, name: string, maxCount: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SniperAlphaRunReportError(`${name} must be an array of strings`);
  if (value.length > maxCount) throw new SniperAlphaRunReportError(`${name} exceeds ${maxCount} entries`);
  return value.map((s, i) => {
    if (typeof s !== "string") throw new SniperAlphaRunReportError(`${name}[${i}] must be a string`);
    rejectControlChars(s, `${name}[${i}]`);
    const trimmed = s.trim();
    if (trimmed.length === 0) throw new SniperAlphaRunReportError(`${name}[${i}] must be a non-empty string`);
    if (trimmed.length > MAX_LINE_LEN) throw new SniperAlphaRunReportError(`${name}[${i}] exceeds ${MAX_LINE_LEN} characters`);
    if (redactString(trimmed) !== trimmed) throw new SniperAlphaRunReportError(`${name}[${i}] is secret-shaped and is refused`);
    return trimmed;
  });
}

function normalizeTopLimit(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_TOP_LIMIT;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new SniperAlphaRunReportError("topLimit must be a non-negative integer or null");
  }
  return Math.min(value, MAX_TOP_LIMIT);
}

/** Rank comparator: by explicit rank ascending (nulls last), then by score descending (nulls last). */
function compareForTop(a: SniperAlphaTopCandidate, b: SniperAlphaTopCandidate): number {
  const ra = a.rank ?? Number.POSITIVE_INFINITY;
  const rb = b.rank ?? Number.POSITIVE_INFINITY;
  if (ra !== rb) return ra - rb;
  const sa = a.score ?? -1;
  const sb = b.score ?? -1;
  if (sa !== sb) return sb - sa;
  return a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0;
}

// --- build -------------------------------------------------------------------

/**
 * Build a canonical {@link SniperAlphaRunReport} from a validated campaign. Pure, non-mutating,
 * deterministic. Candidate partitions (top / blocked / insufficient) are derived from the campaign's
 * own verdicts; stage coverage and candidate count are copied; the live-trading / safety literals are
 * pinned. Throws {@link SniperAlphaRunReportError} on any structural problem.
 */
export function buildSniperAlphaRunReport(input: BuildSniperAlphaRunReportInput): SniperAlphaRunReport {
  if (!isObject(input)) throw new SniperAlphaRunReportError("alpha run report input must be an object");
  const campaign = input.campaign;
  if (!isObject(campaign) || !Array.isArray(campaign.candidates)) {
    throw new SniperAlphaRunReportError("input.campaign must be a campaign object with a candidates array");
  }

  const runId = (safeLabel(input.runId, "runId", 128, true) as string | null) ?? "sniper-alpha-run";
  const generatedAt = safeLabel(input.generatedAt, "generatedAt", 40, true);
  const mode = optEnum(campaign.mode, "mode", SNIPER_ALPHA_RUN_REPORT_MODES, "paper") as SniperAlphaRunReportMode;
  const network = optEnum(campaign.network, "network", SNIPER_ALPHA_RUN_REPORT_NETWORKS, "mainnet-beta") as SniperAlphaRunReportNetwork;

  const campaignRef = safeLabel(input.campaignRef, "campaignRef", MAX_LABEL_LEN, false) as string;
  const campaignPlanRef = safeLabel(input.campaignPlanRef, "campaignPlanRef", MAX_LABEL_LEN, false) as string;
  const watchlistRef = safeLabel(input.watchlistRef, "watchlistRef", MAX_LABEL_LEN, true);
  const diffRef = safeLabel(input.diffRef, "diffRef", MAX_LABEL_LEN, true);

  const topLimit = normalizeTopLimit(input.topLimit);

  // --- partition the campaign candidates by their (already re-derived) verdict ----
  const topAll: SniperAlphaTopCandidate[] = [];
  const blockedCandidates: SniperAlphaBlockedCandidate[] = [];
  const insufficientEvidenceCandidates: SniperAlphaInsufficientCandidate[] = [];
  for (const c of campaign.candidates) {
    const verdict = c.finalOperatorVerdict;
    if (verdict === "blocked") {
      blockedCandidates.push({
        candidateId: c.candidateId,
        mint: c.mint,
        verdict: "blocked",
        blockers: [...c.blockers],
        nextSafeAction: c.nextSafeAction,
      });
    } else if (verdict === "insufficient-evidence") {
      insufficientEvidenceCandidates.push({
        candidateId: c.candidateId,
        mint: c.mint,
        verdict: "insufficient-evidence",
        nextSafeAction: c.nextSafeAction,
      });
    } else {
      topAll.push({
        candidateId: c.candidateId,
        mint: c.mint,
        rank: c.rank,
        score: c.score,
        verdict,
        riskDecision: c.riskDecision,
        quoteStatus: c.quoteStatus,
        buildStatus: c.buildStatus,
        simulationStatus: c.simulationStatus,
        nextSafeAction: c.nextSafeAction,
      });
    }
  }
  const topCandidates = [...topAll].sort(compareForTop).slice(0, topLimit);

  const stageCoverage: SniperAlphaStageCoverage[] = (campaign.stages ?? []).map((s) => ({
    stage: s.stage,
    candidatesCovered: s.candidatesCovered,
    candidateCount: s.candidateCount,
  }));

  const providerHealthSummary: SniperAlphaProviderHealthSummary = {
    risk: optEnum(input.providerHealth?.risk, "providerHealth.risk", SNIPER_ALPHA_RUN_PROVIDER_STATUSES, "not-attempted") as SniperAlphaRunProviderStatus,
    quote: optEnum(input.providerHealth?.quote, "providerHealth.quote", SNIPER_ALPHA_RUN_PROVIDER_STATUSES, "not-attempted") as SniperAlphaRunProviderStatus,
    simulation: optEnum(
      input.providerHealth?.simulation,
      "providerHealth.simulation",
      SNIPER_ALPHA_RUN_PROVIDER_STATUSES,
      "not-attempted",
    ) as SniperAlphaRunProviderStatus,
  };

  const rustEngineStatus = optEnum(input.rustEngineStatus, "rustEngineStatus", SNIPER_ALPHA_RUN_RUST_ENGINE_STATUSES, "not-used") as SniperAlphaRunRustEngineStatus;
  const phase7Status = (safeLabel(input.phase7Status, "phase7Status", MAX_LABEL_LEN, true) as string | null) ?? "not-checked";
  const evidenceProvenance = optEnum(
    input.evidenceProvenance,
    "evidenceProvenance",
    SNIPER_ALPHA_RUN_EVIDENCE_PROVENANCE,
    "mixed",
  ) as SniperAlphaRunEvidenceProvenance;

  // --- next safe actions: always honest about the live-disabled state -----------
  const blockedCount = blockedCandidates.length;
  const insufficientCount = insufficientEvidenceCandidates.length;
  const watchCount = topAll.filter((c) => c.verdict === "watch").length;
  const reviewCount = topAll.filter((c) => c.verdict === "review").length;
  const derivedActions: string[] = [];
  if (blockedCount > 0) {
    derivedActions.push(`${blockedCount} candidate(s) BLOCKED — review the blockers; never override a risk / build / simulation gate. Nothing here trades.`);
  }
  if (insufficientCount > 0) {
    derivedActions.push(`${insufficientCount} candidate(s) need more evidence — gather deep risk / a quote / a dry-run release candidate and re-run the campaign.`);
  }
  if (reviewCount > 0) {
    derivedActions.push(`${reviewCount} candidate(s) need review — re-check risk / quote / simulation before any further step.`);
  }
  if (watchCount > 0) {
    derivedActions.push(`${watchCount} candidate(s) are clean-to-watch — keep monitoring. This is NOT a buy signal.`);
  }
  derivedActions.push("Live trading stays DISABLED. The Phase 7 path requires a separate, explicit written human sign-off and a separate authorization sprint — nothing here authorizes it.");
  const extraActions = normalizeStringList(input.nextSafeActions, "nextSafeActions", MAX_LIST);
  const nextSafeActions = [...derivedActions, ...extraActions];

  const extraCaveats = normalizeStringList(input.caveats, "caveats", MAX_LIST);
  const artifactRefs = normalizeStringList(input.artifactRefs, "artifactRefs", MAX_LIST);

  return {
    schemaVersion: SNIPER_ALPHA_RUN_REPORT_SCHEMA_VERSION,
    banner: SNIPER_ALPHA_RUN_REPORT_BANNER,
    disclaimers: [...SNIPER_ALPHA_RUN_REPORT_DISCLAIMERS],
    runId,
    generatedAt,
    mode,
    network,
    watchlistRef,
    campaignPlanRef,
    campaignRef,
    diffRef,
    candidateCount: typeof campaign.candidateCount === "number" ? campaign.candidateCount : campaign.candidates.length,
    topCandidates,
    blockedCandidates,
    insufficientEvidenceCandidates,
    stageCoverage,
    providerHealthSummary,
    rustEngineStatus,
    phase7Status,
    liveTradingStatus: SNIPER_ALPHA_RUN_LIVE_TRADING_STATUS,
    authorizesLiveTrading: false,
    nextSafeActions,
    caveats: [...DEFAULT_CAVEATS, ...extraCaveats],
    artifactRefs,
    evidenceProvenance,
    redactionApplied: true,
    neverSends: true,
    phase7LiveTradingReady: false,
  };
}

// --- validation (backstop) ---------------------------------------------------

const EXPECTED_KEYS = [
  "schemaVersion",
  "banner",
  "disclaimers",
  "runId",
  "generatedAt",
  "mode",
  "network",
  "watchlistRef",
  "campaignPlanRef",
  "campaignRef",
  "diffRef",
  "candidateCount",
  "topCandidates",
  "blockedCandidates",
  "insufficientEvidenceCandidates",
  "stageCoverage",
  "providerHealthSummary",
  "rustEngineStatus",
  "phase7Status",
  "liveTradingStatus",
  "authorizesLiveTrading",
  "nextSafeActions",
  "caveats",
  "artifactRefs",
  "evidenceProvenance",
  "redactionApplied",
  "neverSends",
  "phase7LiveTradingReady",
] as const;

function validateMint(value: unknown, where: string): string {
  try {
    return parseMintAddress(value);
  } catch (err) {
    throw new SniperAlphaRunReportError(`${where}: ${(err as Error).message}`);
  }
}

function validateTopCandidate(value: unknown, i: number): void {
  if (!isObject(value)) throw new SniperAlphaRunReportError(`topCandidates[${i}] must be an object`);
  safeLabel(value.candidateId, `topCandidates[${i}].candidateId`, 128, false);
  validateMint(value.mint, `topCandidates[${i}].mint`);
  if (value.verdict !== "watch" && value.verdict !== "review") {
    throw new SniperAlphaRunReportError(`topCandidates[${i}].verdict must be "watch" or "review"`);
  }
  if (typeof value.nextSafeAction !== "string" || value.nextSafeAction.trim().length === 0) {
    throw new SniperAlphaRunReportError(`topCandidates[${i}].nextSafeAction must be a non-empty string`);
  }
}

function validateBlocked(value: unknown, i: number): void {
  if (!isObject(value)) throw new SniperAlphaRunReportError(`blockedCandidates[${i}] must be an object`);
  safeLabel(value.candidateId, `blockedCandidates[${i}].candidateId`, 128, false);
  validateMint(value.mint, `blockedCandidates[${i}].mint`);
  if (value.verdict !== "blocked") throw new SniperAlphaRunReportError(`blockedCandidates[${i}].verdict must be "blocked"`);
  if (!Array.isArray(value.blockers) || (value.blockers as unknown[]).length === 0) {
    throw new SniperAlphaRunReportError(`blockedCandidates[${i}] must carry at least one blocker`);
  }
}

function validateInsufficient(value: unknown, i: number): void {
  if (!isObject(value)) throw new SniperAlphaRunReportError(`insufficientEvidenceCandidates[${i}] must be an object`);
  safeLabel(value.candidateId, `insufficientEvidenceCandidates[${i}].candidateId`, 128, false);
  validateMint(value.mint, `insufficientEvidenceCandidates[${i}].mint`);
  if (value.verdict !== "insufficient-evidence") {
    throw new SniperAlphaRunReportError(`insufficientEvidenceCandidates[${i}].verdict must be "insufficient-evidence"`);
  }
}

/**
 * Strictly validate a value as a canonical {@link SniperAlphaRunReport}. A backstop: the key set is
 * CLOSED (no `signature` / `txid` / `sendResult` field can appear); the banner / mode / network /
 * live-trading / safety literals are pinned; the candidate partitions are well-formed (valid mints,
 * verdicts in the right bucket, every blocked candidate carries a blocker); the candidate count is
 * consistent with the partitions. Throws {@link SniperAlphaRunReportError} on the first problem. Pure.
 */
export function validateSniperAlphaRunReport(value: unknown): SniperAlphaRunReport {
  if (!isObject(value)) throw new SniperAlphaRunReportError("alpha run report must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) {
      throw new SniperAlphaRunReportError(`alpha run report has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  for (const key of EXPECTED_KEYS) {
    if (!(key in value)) throw new SniperAlphaRunReportError(`alpha run report is missing field "${key}"`);
  }

  if (value.schemaVersion !== SNIPER_ALPHA_RUN_REPORT_SCHEMA_VERSION) {
    throw new SniperAlphaRunReportError(`schemaVersion must be "${SNIPER_ALPHA_RUN_REPORT_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_ALPHA_RUN_REPORT_BANNER) throw new SniperAlphaRunReportError("banner must be the canonical banner");
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperAlphaRunReportError("disclaimers must be a non-empty array");
  }
  safeLabel(value.runId, "runId", 128, false);
  safeLabel(value.generatedAt, "generatedAt", 40, true);
  if (!(SNIPER_ALPHA_RUN_REPORT_MODES as readonly string[]).includes(value.mode as string)) {
    throw new SniperAlphaRunReportError(`mode must be one of: ${SNIPER_ALPHA_RUN_REPORT_MODES.join(", ")}`);
  }
  if (!(SNIPER_ALPHA_RUN_REPORT_NETWORKS as readonly string[]).includes(value.network as string)) {
    throw new SniperAlphaRunReportError(`network must be one of: ${SNIPER_ALPHA_RUN_REPORT_NETWORKS.join(", ")}`);
  }
  safeLabel(value.watchlistRef, "watchlistRef", MAX_LABEL_LEN, true);
  safeLabel(value.campaignPlanRef, "campaignPlanRef", MAX_LABEL_LEN, false);
  safeLabel(value.campaignRef, "campaignRef", MAX_LABEL_LEN, false);
  safeLabel(value.diffRef, "diffRef", MAX_LABEL_LEN, true);

  if (typeof value.candidateCount !== "number" || !Number.isInteger(value.candidateCount) || value.candidateCount < 0) {
    throw new SniperAlphaRunReportError("candidateCount must be a non-negative integer");
  }
  for (const field of ["topCandidates", "blockedCandidates", "insufficientEvidenceCandidates", "stageCoverage", "nextSafeActions", "caveats", "artifactRefs"] as const) {
    if (!Array.isArray(value[field])) throw new SniperAlphaRunReportError(`${field} must be an array`);
  }
  (value.topCandidates as unknown[]).forEach((c, i) => validateTopCandidate(c, i));
  (value.blockedCandidates as unknown[]).forEach((c, i) => validateBlocked(c, i));
  (value.insufficientEvidenceCandidates as unknown[]).forEach((c, i) => validateInsufficient(c, i));

  // The full blocked + insufficient sets are exact; the candidate count must cover them plus the
  // (possibly capped) top set. A count smaller than the recorded blocked + insufficient is impossible.
  const blockedLen = (value.blockedCandidates as unknown[]).length;
  const insufficientLen = (value.insufficientEvidenceCandidates as unknown[]).length;
  if (value.candidateCount < blockedLen + insufficientLen) {
    throw new SniperAlphaRunReportError("candidateCount is smaller than the blocked + insufficient-evidence candidates (impossible)");
  }

  if (!isObject(value.providerHealthSummary)) throw new SniperAlphaRunReportError("providerHealthSummary must be an object");
  for (const k of ["risk", "quote", "simulation"] as const) {
    if (!(SNIPER_ALPHA_RUN_PROVIDER_STATUSES as readonly string[]).includes((value.providerHealthSummary as Record<string, unknown>)[k] as string)) {
      throw new SniperAlphaRunReportError(`providerHealthSummary.${k} must be one of: ${SNIPER_ALPHA_RUN_PROVIDER_STATUSES.join(", ")}`);
    }
  }
  if (!(SNIPER_ALPHA_RUN_RUST_ENGINE_STATUSES as readonly string[]).includes(value.rustEngineStatus as string)) {
    throw new SniperAlphaRunReportError(`rustEngineStatus must be one of: ${SNIPER_ALPHA_RUN_RUST_ENGINE_STATUSES.join(", ")}`);
  }
  safeLabel(value.phase7Status, "phase7Status", MAX_LABEL_LEN, false);
  if (!(SNIPER_ALPHA_RUN_EVIDENCE_PROVENANCE as readonly string[]).includes(value.evidenceProvenance as string)) {
    throw new SniperAlphaRunReportError(`evidenceProvenance must be one of: ${SNIPER_ALPHA_RUN_EVIDENCE_PROVENANCE.join(", ")}`);
  }
  if ((value.caveats as unknown[]).length === 0) throw new SniperAlphaRunReportError("caveats must be non-empty");

  if (value.liveTradingStatus !== SNIPER_ALPHA_RUN_LIVE_TRADING_STATUS) {
    throw new SniperAlphaRunReportError(`liveTradingStatus must literally be "${SNIPER_ALPHA_RUN_LIVE_TRADING_STATUS}" — an alpha report can never report live enabled`);
  }
  for (const [field, expected] of [
    ["authorizesLiveTrading", false],
    ["redactionApplied", true],
    ["neverSends", true],
    ["phase7LiveTradingReady", false],
  ] as const) {
    if (value[field] !== expected) throw new SniperAlphaRunReportError(`${field} must literally be ${String(expected)}`);
  }

  // Belt-and-braces: the closed verdict set must still recognize the partitions' verdicts.
  for (const c of value.topCandidates as Array<{ verdict?: unknown }>) {
    if (!(SNIPER_CAMPAIGN_CANDIDATE_VERDICTS as readonly string[]).includes(c.verdict as string)) {
      throw new SniperAlphaRunReportError("a top candidate carries an unknown verdict");
    }
  }

  return value as unknown as SniperAlphaRunReport;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperAlphaRunReport}. */
export interface FormatSniperAlphaRunReportOptions {
  label?: string;
  /** Cap on the number of top candidate rows printed (default 25). */
  maxRows?: number;
}

/**
 * Render a redacted, stable, human-readable alpha run summary. Deterministic and path-stable. The
 * whole output passes through the redactor.
 */
export function formatSniperAlphaRunReport(report: SniperAlphaRunReport, opts: FormatSniperAlphaRunReportOptions = {}): string {
  const maxRows = opts.maxRows ?? 25;
  const header = `${report.banner}`;
  const lines: string[] = [header, "=".repeat(Math.min(header.length, 80))];
  if (opts.label) lines.push(`label:      ${opts.label}`);
  lines.push(`run id:     ${report.runId}`);
  lines.push(`mode:       ${report.mode} (${report.network})`);
  lines.push(`provenance: ${report.evidenceProvenance}`);
  lines.push(`live:       ${report.liveTradingStatus.toUpperCase()} (authorizes live trading: ${String(report.authorizesLiveTrading)})`);
  lines.push(`phase 7:    ${report.phase7Status}`);
  lines.push(`candidates: ${report.candidateCount} (top ${report.topCandidates.length} · blocked ${report.blockedCandidates.length} · insufficient ${report.insufficientEvidenceCandidates.length})`);
  lines.push(`providers:  risk=${report.providerHealthSummary.risk} quote=${report.providerHealthSummary.quote} sim=${report.providerHealthSummary.simulation} · rust=${report.rustEngineStatus}`);

  lines.push("");
  lines.push("Top candidates (best-ranked watch / review — never a buy list):");
  for (const c of report.topCandidates.slice(0, maxRows)) {
    const bits: string[] = [];
    if (c.rank !== null) bits.push(`#${c.rank}`);
    if (c.score !== null) bits.push(`score=${c.score}`);
    if (c.riskDecision !== null) bits.push(`risk=${c.riskDecision}`);
    if (c.quoteStatus !== null) bits.push(`quote=${c.quoteStatus}`);
    if (c.simulationStatus !== null) bits.push(`sim=${c.simulationStatus}`);
    lines.push(`[${c.verdict}] ${c.candidateId}  ${c.mint}${bits.length > 0 ? `  [${bits.join("; ")}]` : ""}`);
  }
  if (report.topCandidates.length === 0) lines.push("(none)");

  if (report.blockedCandidates.length > 0) {
    lines.push("");
    lines.push("Blocked candidates:");
    for (const c of report.blockedCandidates) lines.push(`[BLOCKED] ${c.candidateId}  ${c.mint}  — ${c.blockers.join("; ")}`);
  }

  lines.push("");
  lines.push("Stage coverage:");
  for (const s of report.stageCoverage) lines.push(`- ${s.stage}: ${s.candidatesCovered}/${s.candidateCount}`);

  lines.push("");
  lines.push("Next safe actions:");
  for (const a of report.nextSafeActions) lines.push(`- ${a}`);
  lines.push("");
  lines.push("Caveats:");
  for (const c of report.caveats) lines.push(`- ${c}`);
  lines.push("");
  for (const d of report.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
