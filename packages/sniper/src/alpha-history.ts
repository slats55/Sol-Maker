/**
 * Deterministic, **no-send** SNIPER ALPHA HISTORY artifact (Sprint 106 alpha layer).
 *
 * An operator runs the no-send live-read-only alpha campaign repeatedly (each run lands a folder
 * under the gitignored `runs/` tree with a `campaign.json` + `alpha-report.json`). This module folds
 * MANY such runs into ONE deterministic rollup so a reviewer can see how the candidate set, the
 * verdict tally, the provider health, and the evidence provenance moved across runs — without ever
 * re-running anything and without pretending a run is live-ready.
 *
 * The spine of each ingested run is its validated {@link SniperDryRunCampaign} (the source of truth
 * for the verdict counts, the per-candidate blockers, and the stage spine). The optional validated
 * {@link SniperAlphaRunReport} enriches it with the provider health, the evidence provenance, the
 * Rust engine status, and the Phase 7 posture. The CLI reads the files and hands the validated
 * objects here; this module is **pure** and does NO filesystem / network / RPC / wallet work.
 *
 * It is structurally incapable of claiming a live send or live readiness:
 *
 *   - every ingested run is asserted to be live-disabled (`liveSendStatus` "disabled",
 *     `authorizesLiveTrading` false) — a run that claims otherwise is REFUSED, never folded in;
 *   - the rollup deep-scans every ingested run for a `signature` / `txid` / `sendResult` / key-shaped
 *     field and refuses if one appears, then pins the honest scan result;
 *   - `liveTradingStatus` is the literal "disabled", `authorizesLiveTrading` /
 *     `anyRunAuthorizesLiveTrading` are pinned false, `neverSends` is pinned true, and the schema is
 *     CLOSED (it can never carry a send field of its own).
 *
 * Every aggregate (run count, candidate total, verdict tally, provider/provenance rollups, the
 * blocker-reason frequencies) is RE-DERIVED from the per-run entries and the validator recomputes
 * them independently as a parity wall. Byte-identical input yields a byte-identical artifact.
 */

import { redactString } from "@soulmaker/security";
import { parseMintAddress } from "./mint-address.js";
import {
  SNIPER_CAMPAIGN_CANDIDATE_VERDICTS,
  type SniperDryRunCampaign,
} from "./dryrun-campaign.js";
import {
  SNIPER_ALPHA_RUN_REPORT_MODES,
  SNIPER_ALPHA_RUN_REPORT_NETWORKS,
  SNIPER_ALPHA_RUN_EVIDENCE_PROVENANCE,
  SNIPER_ALPHA_RUN_RUST_ENGINE_STATUSES,
  SNIPER_ALPHA_RUN_PROVIDER_STATUSES,
  type SniperAlphaRunReport,
  type SniperAlphaRunReportMode,
  type SniperAlphaRunReportNetwork,
  type SniperAlphaRunEvidenceProvenance,
  type SniperAlphaRunRustEngineStatus,
  type SniperAlphaRunProviderStatus,
} from "./alpha-run-report.js";

/** Stable schema identifier for the alpha history artifact. Bump only on a breaking change. */
export const SNIPER_ALPHA_HISTORY_SCHEMA_VERSION = "sniper.alpha_history.v1";

/** The banner that prefixes every alpha history artifact (required label). */
export const SNIPER_ALPHA_HISTORY_BANNER =
  "SNIPER ALPHA HISTORY — a no-send rollup across many live-read-only alpha runs. NOT a profitability claim, NOT live readiness. LIVE TRADING IS DISABLED.";

/** The fixed live-trading status. There is no input that can change it. */
export const SNIPER_ALPHA_HISTORY_LIVE_TRADING_STATUS = "disabled";

/** Required disclaimer statements carried by every alpha history artifact (stable order). */
export const SNIPER_ALPHA_HISTORY_DISCLAIMERS: readonly string[] = [
  "SNIPER ALPHA HISTORY — a no-send rollup across many live-read-only alpha runs over Solana memecoin candidates.",
  "Live trading is DISABLED. This rollup is structurally incapable of reporting a live send, a signature, or an armed state; mainnet sending has NO CLI surface.",
  "Per-run verdict counts come from each run's own re-derivation (a high score can never override a blocker); this rollup only aggregates and ranks them.",
  "'watch' is the best a candidate reaches — it means keep monitoring, never ready or safe to trade. Real read-only evidence is labelled separately from fixture / fictional-example evidence.",
  "Invalid or unrecognized artifacts are listed honestly and are NEVER counted as runs.",
  "No wallet, key, signing, sending, or live execution is involved anywhere in producing this rollup.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "Not a live-readiness claim.",
];

const DEFAULT_CAVEATS: readonly string[] = [
  "A history rolls up evidence; it never trades, never sends, and never authorizes a live path.",
  "Aggregate counts are re-derived from the per-run summaries — a run that claims live authorization is refused, never folded in.",
  "Provenance is honest: real read-only network runs are distinguished from fixture / fictional-example runs; a run missing its alpha report defaults to not-attempted provider health, never a faked one.",
  "Live trading is disabled by policy; there is no mainnet-send command anywhere in Sol Maker.",
];

const MAX_RUNS = 1000;
const MAX_INVALID = 1000;
const MAX_LABEL_LEN = 200;
const MAX_REF_LEN = 400;
const MAX_LINE_LEN = 400;
const MAX_LIST = 64;
const MAX_BLOCKER_REASONS_PER_RUN = 64;
const MAX_TOP_BLOCKER_REASONS = 24;

/**
 * The deep-scan forbidden send/signature key set — a run carrying any of these is refused outright.
 * Key MATERIAL (private keys, mnemonics) is caught instead by the secret-shaped VALUE scan below
 * (via `redactString`), so this set deliberately covers only the send/result/signature family — both
 * because that is the meaningful leak for a no-send rollup, and so this module's own source carries
 * no wallet-capability token for the safety regression to trip on.
 */
const FORBIDDEN_SENSITIVE_KEY = /^(signature|txSignature|txid|txId|sendResult|sendResults|sendOutcome)$/i;

/** Thrown when an alpha history INPUT or produced artifact is structurally invalid. */
export class SniperAlphaHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperAlphaHistoryError";
  }
}

// --- input model -------------------------------------------------------------

/** One run's validated source artifacts. The campaign is the spine; the report enriches it. */
export interface SniperAlphaHistoryRunInput {
  /** Operator-facing reference for the run (a label or a folder path). Sanitized, never a secret. */
  runRef: string;
  /** The validated campaign (source of verdict counts, blockers, candidate spine). */
  campaign: SniperDryRunCampaign;
  /** The optional validated alpha report (provider health / provenance / Rust / Phase 7). */
  report?: SniperAlphaRunReport | null;
}

/** One recognized-but-invalid or unrecognized artifact encountered while ingesting (never a run). */
export interface SniperAlphaHistoryInvalidArtifactInput {
  ref: string;
  reason: string;
}

/** Everything {@link buildSniperAlphaHistory} accepts. */
export interface BuildSniperAlphaHistoryInput {
  historyId?: string | null;
  generatedAt?: string | null;
  runs: SniperAlphaHistoryRunInput[];
  invalidArtifacts?: SniperAlphaHistoryInvalidArtifactInput[];
  caveats?: string[];
  artifactRefs?: string[];
}

// --- artifact model ----------------------------------------------------------

/** Per-run verdict tally (full, copied from the campaign's own re-derivation). */
export interface SniperAlphaHistoryVerdictCounts {
  watch: number;
  review: number;
  blocked: number;
  insufficientEvidence: number;
}

/** Per-provider run rollup (count of runs by reachability status). */
export interface SniperAlphaHistoryProviderRollup {
  ok: number;
  degraded: number;
  unavailable: number;
  notAttempted: number;
}

/** Per-provenance run rollup (count of runs by evidence provenance). */
export interface SniperAlphaHistoryProvenanceRollup {
  realReadonly: number;
  fixture: number;
  fictionalExample: number;
  mixed: number;
}

/** One normalized run row in the history. */
export interface SniperAlphaHistoryRun {
  runRef: string;
  runId: string;
  mode: SniperAlphaRunReportMode;
  network: SniperAlphaRunReportNetwork;
  evidenceProvenance: SniperAlphaRunEvidenceProvenance;
  candidateCount: number;
  verdictCounts: SniperAlphaHistoryVerdictCounts;
  providerHealth: {
    risk: SniperAlphaRunProviderStatus;
    quote: SniperAlphaRunProviderStatus;
    simulation: SniperAlphaRunProviderStatus;
  };
  rustEngineStatus: SniperAlphaRunRustEngineStatus;
  phase7Status: string;
  /** Whether a valid alpha report enriched this run (vs. campaign-only with defaulted provider health). */
  hasAlphaReport: boolean;
  /** Best monitorable candidate's mint (rank asc, score desc), or null when none monitorable. */
  topMint: string | null;
  /** Distinct blocker reasons across the run's blocked candidates (sorted). */
  blockerReasons: string[];
  liveTradingStatus: "disabled";
  authorizesLiveTrading: false;
}

/** One invalid / unrecognized artifact entry. */
export interface SniperAlphaHistoryInvalidArtifact {
  ref: string;
  reason: string;
}

/** One blocker reason and how many runs carried it (sorted by frequency then reason). */
export interface SniperAlphaHistoryBlockerFrequency {
  reason: string;
  runCount: number;
}

/** The honest deep-scan result over the ingested runs (every flag pinned false or the build refuses). */
export interface SniperAlphaHistorySensitiveScan {
  scanned: true;
  signaturePresent: false;
  txidPresent: false;
  sendResultPresent: false;
  keyLikePresent: false;
}

/** The full, deterministic, JSON-serializable alpha history artifact. */
export interface SniperAlphaHistory {
  schemaVersion: string;
  banner: string;
  disclaimers: string[];
  historyId: string;
  generatedAt: string | null;
  runCount: number;
  invalidArtifactCount: number;
  totalCandidateCount: number;
  aggregateVerdictCounts: SniperAlphaHistoryVerdictCounts;
  providerHealthRollup: {
    risk: SniperAlphaHistoryProviderRollup;
    quote: SniperAlphaHistoryProviderRollup;
    simulation: SniperAlphaHistoryProviderRollup;
  };
  evidenceProvenanceRollup: SniperAlphaHistoryProvenanceRollup;
  phase7Postures: string[];
  topBlockerReasons: SniperAlphaHistoryBlockerFrequency[];
  runs: SniperAlphaHistoryRun[];
  invalidArtifacts: SniperAlphaHistoryInvalidArtifact[];
  sensitiveFieldScan: SniperAlphaHistorySensitiveScan;
  anyRunAuthorizesLiveTrading: false;
  nextSafeActions: string[];
  caveats: string[];
  artifactRefs: string[];
  liveTradingStatus: "disabled";
  authorizesLiveTrading: false;
  redactionApplied: true;
  neverSends: true;
  phase7LiveTradingReady: false;
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function rejectControlChars(value: string, name: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    const isBomOrSeparator = code === 0xfeff || code === 0x2028 || code === 0x2029;
    if (isControl || isBomOrSeparator) {
      throw new SniperAlphaHistoryError(`${name} contains a control character, NUL, or BOM and is refused`);
    }
  }
}

function safeLabel(value: unknown, name: string, max: number, nullable: boolean): string | null {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw new SniperAlphaHistoryError(`${name} is required`);
  }
  if (typeof value !== "string") throw new SniperAlphaHistoryError(`${name} must be a string`);
  rejectControlChars(value, name);
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (nullable) return null;
    throw new SniperAlphaHistoryError(`${name} must be a non-empty string`);
  }
  if (trimmed.length > max) throw new SniperAlphaHistoryError(`${name} exceeds ${max} characters`);
  if (redactString(trimmed) !== trimmed) throw new SniperAlphaHistoryError(`${name} is secret-shaped and is refused`);
  return trimmed;
}

function optEnum(value: unknown, name: string, allowed: readonly string[], fallback: string): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new SniperAlphaHistoryError(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function normalizeStringList(value: unknown, name: string, maxCount: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SniperAlphaHistoryError(`${name} must be an array of strings`);
  if (value.length > maxCount) throw new SniperAlphaHistoryError(`${name} exceeds ${maxCount} entries`);
  return value.map((s, i) => {
    if (typeof s !== "string") throw new SniperAlphaHistoryError(`${name}[${i}] must be a string`);
    rejectControlChars(s, `${name}[${i}]`);
    const trimmed = s.trim();
    if (trimmed.length === 0) throw new SniperAlphaHistoryError(`${name}[${i}] must be a non-empty string`);
    if (trimmed.length > MAX_LINE_LEN) throw new SniperAlphaHistoryError(`${name}[${i}] exceeds ${MAX_LINE_LEN} characters`);
    if (redactString(trimmed) !== trimmed) throw new SniperAlphaHistoryError(`${name}[${i}] is secret-shaped and is refused`);
    return trimmed;
  });
}

/**
 * Deep-scan a raw ingested object for a forbidden sensitive key or a secret-shaped string value.
 * Pure and bounded by the already-validated artifact's shape. Throws on the first problem.
 */
function deepScanForSensitive(value: unknown, where: string): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => deepScanForSensitive(v, `${where}[${i}]`));
    return;
  }
  if (isObject(value)) {
    for (const [key, v] of Object.entries(value)) {
      if (FORBIDDEN_SENSITIVE_KEY.test(key)) {
        throw new SniperAlphaHistoryError(`${where}.${key} is a forbidden send/signature/key field — this run is refused`);
      }
      deepScanForSensitive(v, `${where}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && value.length > 0 && redactString(value) !== value) {
    throw new SniperAlphaHistoryError(`${where} carries a secret-shaped value — this run is refused`);
  }
}

/** Assert one ingested campaign is structurally live-disabled (refuses if it ever claims otherwise). */
function assertCampaignLiveDisabled(campaign: SniperDryRunCampaign, where: string): void {
  if (campaign.liveSendStatus !== "disabled") {
    throw new SniperAlphaHistoryError(`${where}.campaign claims a non-disabled live-send status — refused`);
  }
  if (campaign.neverSends !== true || campaign.phase7LiveTradingReady !== false) {
    throw new SniperAlphaHistoryError(`${where}.campaign does not pin neverSends/phase7LiveTradingReady — refused`);
  }
}

/** Assert one ingested alpha report is structurally live-disabled (refuses if it ever claims otherwise). */
function assertReportLiveDisabled(report: SniperAlphaRunReport, where: string): void {
  if (report.liveTradingStatus !== "disabled" || report.authorizesLiveTrading !== false) {
    throw new SniperAlphaHistoryError(`${where}.report claims live authorization — refused`);
  }
  if (report.neverSends !== true || report.phase7LiveTradingReady !== false) {
    throw new SniperAlphaHistoryError(`${where}.report does not pin neverSends/phase7LiveTradingReady — refused`);
  }
}

// --- per-run projection ------------------------------------------------------

/** The verdict order for the monitorable "top" pick: rank asc (nulls last), score desc (nulls last). */
function compareMonitorable(
  a: { rank: number | null; score: number | null; candidateId: string },
  b: { rank: number | null; score: number | null; candidateId: string },
): number {
  const ra = a.rank ?? Number.POSITIVE_INFINITY;
  const rb = b.rank ?? Number.POSITIVE_INFINITY;
  if (ra !== rb) return ra - rb;
  const sa = a.score ?? -1;
  const sb = b.score ?? -1;
  if (sa !== sb) return sb - sa;
  return compareString(a.candidateId, b.candidateId);
}

function projectRun(raw: SniperAlphaHistoryRunInput, index: number, seenRefs: Set<string>): SniperAlphaHistoryRun {
  const where = `runs[${index}]`;
  if (!isObject(raw)) throw new SniperAlphaHistoryError(`${where} must be an object`);

  const runRef = safeLabel(raw.runRef, `${where}.runRef`, MAX_REF_LEN, false) as string;
  if (seenRefs.has(runRef)) throw new SniperAlphaHistoryError(`duplicate runRef "${runRef}"`);
  seenRefs.add(runRef);

  const campaign = raw.campaign;
  if (!isObject(campaign) || !Array.isArray(campaign.candidates)) {
    throw new SniperAlphaHistoryError(`${where}.campaign must be a validated campaign object`);
  }
  assertCampaignLiveDisabled(campaign as unknown as SniperDryRunCampaign, where);
  deepScanForSensitive(campaign, `${where}.campaign`);

  const report = raw.report ?? null;
  if (report !== null) {
    if (!isObject(report)) throw new SniperAlphaHistoryError(`${where}.report must be a validated alpha report object or null`);
    assertReportLiveDisabled(report as unknown as SniperAlphaRunReport, where);
    deepScanForSensitive(report, `${where}.report`);
    if (typeof report.candidateCount === "number" && report.candidateCount !== campaign.candidateCount) {
      throw new SniperAlphaHistoryError(`${where}: alpha report candidateCount does not match the campaign — mismatched pair`);
    }
  }

  // Verdict counts: the campaign's own re-derived tally is the source of truth (full, never capped).
  const verdictCounts = campaign.verdictCounts as SniperAlphaHistoryVerdictCounts;
  if (
    !isObject(verdictCounts) ||
    typeof verdictCounts.watch !== "number" ||
    typeof verdictCounts.review !== "number" ||
    typeof verdictCounts.blocked !== "number" ||
    typeof verdictCounts.insufficientEvidence !== "number"
  ) {
    throw new SniperAlphaHistoryError(`${where}.campaign.verdictCounts is malformed`);
  }
  const candidateCount = campaign.candidateCount as number;
  const summed = verdictCounts.watch + verdictCounts.review + verdictCounts.blocked + verdictCounts.insufficientEvidence;
  if (summed !== candidateCount) {
    throw new SniperAlphaHistoryError(`${where}.campaign verdict counts do not sum to candidateCount`);
  }

  // Distinct blocker reasons across the campaign's blocked candidates (the run's "risk reasons").
  const blockerSet = new Set<string>();
  for (const c of campaign.candidates as Array<{ blockers?: unknown }>) {
    if (Array.isArray(c.blockers)) {
      for (const b of c.blockers) {
        if (typeof b === "string" && b.trim().length > 0) blockerSet.add(b.trim());
      }
    }
  }
  const blockerReasons = [...blockerSet].sort(compareString).slice(0, MAX_BLOCKER_REASONS_PER_RUN);

  // Best monitorable (watch/review) candidate mint, computed from the campaign deterministically.
  const monitorable = (campaign.candidates as Array<{
    finalOperatorVerdict?: unknown;
    rank?: unknown;
    score?: unknown;
    candidateId?: unknown;
    mint?: unknown;
  }>)
    .filter((c) => c.finalOperatorVerdict === "watch" || c.finalOperatorVerdict === "review")
    .map((c) => ({
      rank: typeof c.rank === "number" ? c.rank : null,
      score: typeof c.score === "number" ? c.score : null,
      candidateId: typeof c.candidateId === "string" ? c.candidateId : "",
      mint: typeof c.mint === "string" ? c.mint : "",
    }))
    .sort(compareMonitorable);
  const topMint = monitorable.length > 0 && monitorable[0]!.mint.length > 0 ? monitorable[0]!.mint : null;

  // Mode / network: prefer the report (operator-facing), else the campaign.
  const mode = optEnum(
    report?.mode ?? campaign.mode,
    `${where}.mode`,
    SNIPER_ALPHA_RUN_REPORT_MODES,
    "paper",
  ) as SniperAlphaRunReportMode;
  const network = optEnum(
    report?.network ?? campaign.network,
    `${where}.network`,
    SNIPER_ALPHA_RUN_REPORT_NETWORKS,
    "mainnet-beta",
  ) as SniperAlphaRunReportNetwork;

  const evidenceProvenance = optEnum(
    report?.evidenceProvenance,
    `${where}.evidenceProvenance`,
    SNIPER_ALPHA_RUN_EVIDENCE_PROVENANCE,
    "mixed",
  ) as SniperAlphaRunEvidenceProvenance;

  const providerSummary = isObject(report?.providerHealthSummary) ? report!.providerHealthSummary : {};
  const providerHealth = {
    risk: optEnum((providerSummary as Record<string, unknown>).risk, `${where}.providerHealth.risk`, SNIPER_ALPHA_RUN_PROVIDER_STATUSES, "not-attempted") as SniperAlphaRunProviderStatus,
    quote: optEnum((providerSummary as Record<string, unknown>).quote, `${where}.providerHealth.quote`, SNIPER_ALPHA_RUN_PROVIDER_STATUSES, "not-attempted") as SniperAlphaRunProviderStatus,
    simulation: optEnum((providerSummary as Record<string, unknown>).simulation, `${where}.providerHealth.simulation`, SNIPER_ALPHA_RUN_PROVIDER_STATUSES, "not-attempted") as SniperAlphaRunProviderStatus,
  };

  const rustEngineStatus = optEnum(
    report?.rustEngineStatus,
    `${where}.rustEngineStatus`,
    SNIPER_ALPHA_RUN_RUST_ENGINE_STATUSES,
    "not-used",
  ) as SniperAlphaRunRustEngineStatus;

  const phase7Status =
    (safeLabel(report?.phase7Status, `${where}.phase7Status`, MAX_LABEL_LEN, true) as string | null) ?? "not-checked";

  const runId = (safeLabel(report?.runId ?? campaign.campaignId, `${where}.runId`, 128, true) as string | null) ?? "sniper-alpha-run";

  return {
    runRef,
    runId,
    mode,
    network,
    evidenceProvenance,
    candidateCount,
    verdictCounts: {
      watch: verdictCounts.watch,
      review: verdictCounts.review,
      blocked: verdictCounts.blocked,
      insufficientEvidence: verdictCounts.insufficientEvidence,
    },
    providerHealth,
    rustEngineStatus,
    phase7Status,
    hasAlphaReport: report !== null,
    topMint: topMint !== null ? parseMintAddress(topMint) : null,
    blockerReasons,
    liveTradingStatus: SNIPER_ALPHA_HISTORY_LIVE_TRADING_STATUS,
    authorizesLiveTrading: false,
  };
}

// --- aggregate derivation ----------------------------------------------------

function zeroVerdictCounts(): SniperAlphaHistoryVerdictCounts {
  return { watch: 0, review: 0, blocked: 0, insufficientEvidence: 0 };
}

function deriveAggregateVerdictCounts(runs: readonly SniperAlphaHistoryRun[]): SniperAlphaHistoryVerdictCounts {
  return runs.reduce((acc, r) => {
    acc.watch += r.verdictCounts.watch;
    acc.review += r.verdictCounts.review;
    acc.blocked += r.verdictCounts.blocked;
    acc.insufficientEvidence += r.verdictCounts.insufficientEvidence;
    return acc;
  }, zeroVerdictCounts());
}

function zeroProviderRollup(): SniperAlphaHistoryProviderRollup {
  return { ok: 0, degraded: 0, unavailable: 0, notAttempted: 0 };
}

function tallyProvider(runs: readonly SniperAlphaHistoryRun[], pick: (r: SniperAlphaHistoryRun) => SniperAlphaRunProviderStatus): SniperAlphaHistoryProviderRollup {
  const out = zeroProviderRollup();
  for (const r of runs) {
    switch (pick(r)) {
      case "ok":
        out.ok += 1;
        break;
      case "degraded":
        out.degraded += 1;
        break;
      case "unavailable":
        out.unavailable += 1;
        break;
      case "not-attempted":
        out.notAttempted += 1;
        break;
    }
  }
  return out;
}

function deriveProviderHealthRollup(runs: readonly SniperAlphaHistoryRun[]): SniperAlphaHistory["providerHealthRollup"] {
  return {
    risk: tallyProvider(runs, (r) => r.providerHealth.risk),
    quote: tallyProvider(runs, (r) => r.providerHealth.quote),
    simulation: tallyProvider(runs, (r) => r.providerHealth.simulation),
  };
}

function deriveProvenanceRollup(runs: readonly SniperAlphaHistoryRun[]): SniperAlphaHistoryProvenanceRollup {
  const out: SniperAlphaHistoryProvenanceRollup = { realReadonly: 0, fixture: 0, fictionalExample: 0, mixed: 0 };
  for (const r of runs) {
    switch (r.evidenceProvenance) {
      case "real-readonly":
        out.realReadonly += 1;
        break;
      case "fixture":
        out.fixture += 1;
        break;
      case "fictional-example":
        out.fictionalExample += 1;
        break;
      case "mixed":
        out.mixed += 1;
        break;
    }
  }
  return out;
}

function derivePhase7Postures(runs: readonly SniperAlphaHistoryRun[]): string[] {
  return [...new Set(runs.map((r) => r.phase7Status))].sort(compareString);
}

function deriveTopBlockerReasons(runs: readonly SniperAlphaHistoryRun[]): SniperAlphaHistoryBlockerFrequency[] {
  const counts = new Map<string, number>();
  for (const r of runs) {
    for (const reason of r.blockerReasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([reason, runCount]) => ({ reason, runCount }))
    .sort((a, b) => (b.runCount !== a.runCount ? b.runCount - a.runCount : compareString(a.reason, b.reason)))
    .slice(0, MAX_TOP_BLOCKER_REASONS);
}

function deriveNextSafeActions(runs: readonly SniperAlphaHistoryRun[], invalidCount: number, agg: SniperAlphaHistoryVerdictCounts): string[] {
  const actions: string[] = [];
  if (runs.length === 0) {
    actions.push("No valid runs were ingested — run `paper:sniper:campaign:auto-run` to produce an alpha folder, then re-run the history.");
  } else {
    if (agg.blocked > 0) {
      actions.push(`${agg.blocked} candidate-run(s) ended BLOCKED across the history — review the blocker reasons; never override a risk / build / simulation gate.`);
    }
    if (agg.insufficientEvidence > 0) {
      actions.push(`${agg.insufficientEvidence} candidate-run(s) lacked evidence — gather deep risk / a quote / a dry-run release candidate and re-run the affected campaign.`);
    }
    if (agg.watch + agg.review > 0) {
      actions.push(`${agg.watch} watch + ${agg.review} review candidate-run(s) — keep monitoring. This is NOT a buy list.`);
    }
  }
  if (invalidCount > 0) {
    actions.push(`${invalidCount} artifact(s) were invalid or unrecognized and were NOT counted — see the invalidArtifacts list and re-generate them.`);
  }
  actions.push("Live trading stays DISABLED. The Phase 7 path requires a separate, explicit written human sign-off and a separate authorization sprint — nothing here authorizes it.");
  return actions;
}

// --- build -------------------------------------------------------------------

/**
 * Build a canonical {@link SniperAlphaHistory} from validated per-run artifacts. Pure, non-mutating,
 * deterministic. Each run is asserted live-disabled and deep-scanned for a send / signature / key
 * field (a run that fails is REFUSED, never folded in); runs are sorted by `runRef`; every aggregate
 * is re-derived from the per-run entries; the live-trading / safety literals are pinned. Throws
 * {@link SniperAlphaHistoryError} on any structural problem.
 */
export function buildSniperAlphaHistory(input: BuildSniperAlphaHistoryInput): SniperAlphaHistory {
  if (!isObject(input)) throw new SniperAlphaHistoryError("alpha history input must be an object");

  const historyId = (safeLabel(input.historyId, "historyId", 128, true) as string | null) ?? "sniper-alpha-history";
  const generatedAt = safeLabel(input.generatedAt, "generatedAt", 40, true);

  if (!Array.isArray(input.runs)) throw new SniperAlphaHistoryError("input.runs must be an array");
  if (input.runs.length > MAX_RUNS) throw new SniperAlphaHistoryError(`input.runs exceeds ${MAX_RUNS} entries`);

  const seenRefs = new Set<string>();
  const runs = input.runs
    .map((r, i) => projectRun(r, i, seenRefs))
    .sort((a, b) => compareString(a.runRef, b.runRef));

  // Invalid / unrecognized artifacts (never runs).
  let invalidArtifacts: SniperAlphaHistoryInvalidArtifact[] = [];
  if (input.invalidArtifacts !== undefined && input.invalidArtifacts !== null) {
    if (!Array.isArray(input.invalidArtifacts)) throw new SniperAlphaHistoryError("invalidArtifacts must be an array");
    if (input.invalidArtifacts.length > MAX_INVALID) throw new SniperAlphaHistoryError(`invalidArtifacts exceeds ${MAX_INVALID} entries`);
    invalidArtifacts = input.invalidArtifacts.map((a, i) => {
      if (!isObject(a)) throw new SniperAlphaHistoryError(`invalidArtifacts[${i}] must be an object`);
      return {
        ref: safeLabel(a.ref, `invalidArtifacts[${i}].ref`, MAX_REF_LEN, false) as string,
        reason: safeLabel(a.reason, `invalidArtifacts[${i}].reason`, MAX_LINE_LEN, false) as string,
      };
    });
    invalidArtifacts.sort((a, b) => (compareString(a.ref, b.ref) !== 0 ? compareString(a.ref, b.ref) : compareString(a.reason, b.reason)));
  }

  const totalCandidateCount = runs.reduce((n, r) => n + r.candidateCount, 0);
  const aggregateVerdictCounts = deriveAggregateVerdictCounts(runs);

  const extraCaveats = normalizeStringList(input.caveats, "caveats", MAX_LIST);
  const artifactRefs = normalizeStringList(input.artifactRefs, "artifactRefs", MAX_LIST);

  return {
    schemaVersion: SNIPER_ALPHA_HISTORY_SCHEMA_VERSION,
    banner: SNIPER_ALPHA_HISTORY_BANNER,
    disclaimers: [...SNIPER_ALPHA_HISTORY_DISCLAIMERS],
    historyId,
    generatedAt,
    runCount: runs.length,
    invalidArtifactCount: invalidArtifacts.length,
    totalCandidateCount,
    aggregateVerdictCounts,
    providerHealthRollup: deriveProviderHealthRollup(runs),
    evidenceProvenanceRollup: deriveProvenanceRollup(runs),
    phase7Postures: derivePhase7Postures(runs),
    topBlockerReasons: deriveTopBlockerReasons(runs),
    runs,
    invalidArtifacts,
    sensitiveFieldScan: {
      scanned: true,
      signaturePresent: false,
      txidPresent: false,
      sendResultPresent: false,
      keyLikePresent: false,
    },
    anyRunAuthorizesLiveTrading: false,
    nextSafeActions: deriveNextSafeActions(runs, invalidArtifacts.length, aggregateVerdictCounts),
    caveats: [...DEFAULT_CAVEATS, ...extraCaveats],
    artifactRefs,
    liveTradingStatus: SNIPER_ALPHA_HISTORY_LIVE_TRADING_STATUS,
    authorizesLiveTrading: false,
    redactionApplied: true,
    neverSends: true,
    phase7LiveTradingReady: false,
  };
}

// --- validation (backstop + parity wall) -------------------------------------

const EXPECTED_KEYS = [
  "schemaVersion",
  "banner",
  "disclaimers",
  "historyId",
  "generatedAt",
  "runCount",
  "invalidArtifactCount",
  "totalCandidateCount",
  "aggregateVerdictCounts",
  "providerHealthRollup",
  "evidenceProvenanceRollup",
  "phase7Postures",
  "topBlockerReasons",
  "runs",
  "invalidArtifacts",
  "sensitiveFieldScan",
  "anyRunAuthorizesLiveTrading",
  "nextSafeActions",
  "caveats",
  "artifactRefs",
  "liveTradingStatus",
  "authorizesLiveTrading",
  "redactionApplied",
  "neverSends",
  "phase7LiveTradingReady",
] as const;

const EXPECTED_RUN_KEYS = [
  "runRef",
  "runId",
  "mode",
  "network",
  "evidenceProvenance",
  "candidateCount",
  "verdictCounts",
  "providerHealth",
  "rustEngineStatus",
  "phase7Status",
  "hasAlphaReport",
  "topMint",
  "blockerReasons",
  "liveTradingStatus",
  "authorizesLiveTrading",
] as const;

function validateVerdictCounts(value: unknown, where: string): SniperAlphaHistoryVerdictCounts {
  if (!isObject(value)) throw new SniperAlphaHistoryError(`${where} must be an object`);
  for (const k of ["watch", "review", "blocked", "insufficientEvidence"] as const) {
    const n = (value as Record<string, unknown>)[k];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
      throw new SniperAlphaHistoryError(`${where}.${k} must be a non-negative integer`);
    }
  }
  for (const k of Object.keys(value)) {
    if (!(["watch", "review", "blocked", "insufficientEvidence"] as readonly string[]).includes(k)) {
      throw new SniperAlphaHistoryError(`${where} has unknown field "${k}"`);
    }
  }
  return value as unknown as SniperAlphaHistoryVerdictCounts;
}

function validateRun(value: unknown, where: string): SniperAlphaHistoryRun {
  if (!isObject(value)) throw new SniperAlphaHistoryError(`${where} must be an object`);
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_RUN_KEYS as readonly string[]).includes(key)) {
      throw new SniperAlphaHistoryError(`${where} has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  for (const key of EXPECTED_RUN_KEYS) {
    if (!(key in value)) throw new SniperAlphaHistoryError(`${where} is missing field "${key}"`);
  }

  safeLabel(value.runRef, `${where}.runRef`, MAX_REF_LEN, false);
  safeLabel(value.runId, `${where}.runId`, 128, false);
  if (!(SNIPER_ALPHA_RUN_REPORT_MODES as readonly string[]).includes(value.mode as string)) {
    throw new SniperAlphaHistoryError(`${where}.mode must be one of: ${SNIPER_ALPHA_RUN_REPORT_MODES.join(", ")}`);
  }
  if (!(SNIPER_ALPHA_RUN_REPORT_NETWORKS as readonly string[]).includes(value.network as string)) {
    throw new SniperAlphaHistoryError(`${where}.network must be one of: ${SNIPER_ALPHA_RUN_REPORT_NETWORKS.join(", ")}`);
  }
  if (!(SNIPER_ALPHA_RUN_EVIDENCE_PROVENANCE as readonly string[]).includes(value.evidenceProvenance as string)) {
    throw new SniperAlphaHistoryError(`${where}.evidenceProvenance must be one of: ${SNIPER_ALPHA_RUN_EVIDENCE_PROVENANCE.join(", ")}`);
  }
  if (typeof value.candidateCount !== "number" || !Number.isInteger(value.candidateCount) || value.candidateCount < 0) {
    throw new SniperAlphaHistoryError(`${where}.candidateCount must be a non-negative integer`);
  }
  const verdictCounts = validateVerdictCounts(value.verdictCounts, `${where}.verdictCounts`);
  const summed = verdictCounts.watch + verdictCounts.review + verdictCounts.blocked + verdictCounts.insufficientEvidence;
  if (summed !== value.candidateCount) {
    throw new SniperAlphaHistoryError(`${where}.verdictCounts must sum to candidateCount`);
  }

  if (!isObject(value.providerHealth)) throw new SniperAlphaHistoryError(`${where}.providerHealth must be an object`);
  for (const k of ["risk", "quote", "simulation"] as const) {
    if (!(SNIPER_ALPHA_RUN_PROVIDER_STATUSES as readonly string[]).includes((value.providerHealth as Record<string, unknown>)[k] as string)) {
      throw new SniperAlphaHistoryError(`${where}.providerHealth.${k} must be one of: ${SNIPER_ALPHA_RUN_PROVIDER_STATUSES.join(", ")}`);
    }
  }
  for (const k of Object.keys(value.providerHealth)) {
    if (!(["risk", "quote", "simulation"] as readonly string[]).includes(k)) {
      throw new SniperAlphaHistoryError(`${where}.providerHealth has unknown field "${k}"`);
    }
  }
  if (!(SNIPER_ALPHA_RUN_RUST_ENGINE_STATUSES as readonly string[]).includes(value.rustEngineStatus as string)) {
    throw new SniperAlphaHistoryError(`${where}.rustEngineStatus must be one of: ${SNIPER_ALPHA_RUN_RUST_ENGINE_STATUSES.join(", ")}`);
  }
  safeLabel(value.phase7Status, `${where}.phase7Status`, MAX_LABEL_LEN, false);
  if (typeof value.hasAlphaReport !== "boolean") throw new SniperAlphaHistoryError(`${where}.hasAlphaReport must be a boolean`);
  if (value.topMint !== null) {
    try {
      parseMintAddress(value.topMint);
    } catch (err) {
      throw new SniperAlphaHistoryError(`${where}.topMint: ${(err as Error).message}`);
    }
  }
  if (!Array.isArray(value.blockerReasons) || (value.blockerReasons as unknown[]).some((b) => typeof b !== "string")) {
    throw new SniperAlphaHistoryError(`${where}.blockerReasons must be an array of strings`);
  }
  if (value.liveTradingStatus !== SNIPER_ALPHA_HISTORY_LIVE_TRADING_STATUS) {
    throw new SniperAlphaHistoryError(`${where}.liveTradingStatus must literally be "${SNIPER_ALPHA_HISTORY_LIVE_TRADING_STATUS}"`);
  }
  if (value.authorizesLiveTrading !== false) {
    throw new SniperAlphaHistoryError(`${where}.authorizesLiveTrading must literally be false`);
  }
  return value as unknown as SniperAlphaHistoryRun;
}

function validateProviderRollup(value: unknown, where: string): SniperAlphaHistoryProviderRollup {
  if (!isObject(value)) throw new SniperAlphaHistoryError(`${where} must be an object`);
  for (const k of ["ok", "degraded", "unavailable", "notAttempted"] as const) {
    const n = (value as Record<string, unknown>)[k];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
      throw new SniperAlphaHistoryError(`${where}.${k} must be a non-negative integer`);
    }
  }
  for (const k of Object.keys(value)) {
    if (!(["ok", "degraded", "unavailable", "notAttempted"] as readonly string[]).includes(k)) {
      throw new SniperAlphaHistoryError(`${where} has unknown field "${k}"`);
    }
  }
  return value as unknown as SniperAlphaHistoryProviderRollup;
}

/**
 * Strictly validate a value as a canonical {@link SniperAlphaHistory}. A backstop AND a parity wall:
 * the key set is CLOSED (no `signature` / `txid` / `sendResult` field can appear); the banner / live-
 * trading / safety literals are pinned; every run is re-validated and its verdict counts must sum to
 * its candidate count; every aggregate (run count, candidate total, verdict tally, provider /
 * provenance rollups, phase7 postures, blocker frequencies) is INDEPENDENTLY re-derived from the
 * runs and must match. Throws {@link SniperAlphaHistoryError} on the first problem. Pure.
 */
export function validateSniperAlphaHistory(value: unknown): SniperAlphaHistory {
  if (!isObject(value)) throw new SniperAlphaHistoryError("alpha history must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) {
      throw new SniperAlphaHistoryError(`alpha history has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  for (const key of EXPECTED_KEYS) {
    if (!(key in value)) throw new SniperAlphaHistoryError(`alpha history is missing field "${key}"`);
  }

  if (value.schemaVersion !== SNIPER_ALPHA_HISTORY_SCHEMA_VERSION) {
    throw new SniperAlphaHistoryError(`schemaVersion must be "${SNIPER_ALPHA_HISTORY_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_ALPHA_HISTORY_BANNER) throw new SniperAlphaHistoryError("banner must be the canonical banner");
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperAlphaHistoryError("disclaimers must be a non-empty array");
  }
  safeLabel(value.historyId, "historyId", 128, false);
  safeLabel(value.generatedAt, "generatedAt", 40, true);

  if (!Array.isArray(value.runs)) throw new SniperAlphaHistoryError("runs must be an array");
  const seenRefs = new Set<string>();
  const runs = (value.runs as unknown[]).map((r, i) => {
    const run = validateRun(r, `runs[${i}]`);
    if (seenRefs.has(run.runRef)) throw new SniperAlphaHistoryError(`duplicate runRef "${run.runRef}"`);
    seenRefs.add(run.runRef);
    return run;
  });
  // Runs must be sorted by runRef (deterministic ordering).
  for (let i = 1; i < runs.length; i++) {
    if (compareString(runs[i - 1]!.runRef, runs[i]!.runRef) > 0) {
      throw new SniperAlphaHistoryError("runs must be sorted by runRef ascending");
    }
  }

  if (!Array.isArray(value.invalidArtifacts)) throw new SniperAlphaHistoryError("invalidArtifacts must be an array");
  const invalidArtifacts = (value.invalidArtifacts as unknown[]).map((a, i) => {
    if (!isObject(a)) throw new SniperAlphaHistoryError(`invalidArtifacts[${i}] must be an object`);
    for (const k of Object.keys(a)) {
      if (!(["ref", "reason"] as readonly string[]).includes(k)) {
        throw new SniperAlphaHistoryError(`invalidArtifacts[${i}] has unknown field "${k}"`);
      }
    }
    safeLabel(a.ref, `invalidArtifacts[${i}].ref`, MAX_REF_LEN, false);
    safeLabel(a.reason, `invalidArtifacts[${i}].reason`, MAX_LINE_LEN, false);
    return a as unknown as SniperAlphaHistoryInvalidArtifact;
  });

  if (value.runCount !== runs.length) throw new SniperAlphaHistoryError("runCount must equal runs.length");
  if (value.invalidArtifactCount !== invalidArtifacts.length) {
    throw new SniperAlphaHistoryError("invalidArtifactCount must equal invalidArtifacts.length");
  }

  const totalCandidateCount = runs.reduce((n, r) => n + r.candidateCount, 0);
  if (value.totalCandidateCount !== totalCandidateCount) {
    throw new SniperAlphaHistoryError("totalCandidateCount must be re-derived from the runs");
  }
  const aggregateVerdictCounts = deriveAggregateVerdictCounts(runs);
  if (JSON.stringify(value.aggregateVerdictCounts) !== JSON.stringify(aggregateVerdictCounts)) {
    throw new SniperAlphaHistoryError("aggregateVerdictCounts must be re-derived from the runs");
  }

  if (!isObject(value.providerHealthRollup)) throw new SniperAlphaHistoryError("providerHealthRollup must be an object");
  for (const k of ["risk", "quote", "simulation"] as const) {
    validateProviderRollup((value.providerHealthRollup as Record<string, unknown>)[k], `providerHealthRollup.${k}`);
  }
  for (const k of Object.keys(value.providerHealthRollup)) {
    if (!(["risk", "quote", "simulation"] as readonly string[]).includes(k)) {
      throw new SniperAlphaHistoryError(`providerHealthRollup has unknown field "${k}"`);
    }
  }
  if (JSON.stringify(value.providerHealthRollup) !== JSON.stringify(deriveProviderHealthRollup(runs))) {
    throw new SniperAlphaHistoryError("providerHealthRollup must be re-derived from the runs");
  }
  if (JSON.stringify(value.evidenceProvenanceRollup) !== JSON.stringify(deriveProvenanceRollup(runs))) {
    throw new SniperAlphaHistoryError("evidenceProvenanceRollup must be re-derived from the runs");
  }
  if (JSON.stringify(value.phase7Postures) !== JSON.stringify(derivePhase7Postures(runs))) {
    throw new SniperAlphaHistoryError("phase7Postures must be re-derived from the runs");
  }
  if (JSON.stringify(value.topBlockerReasons) !== JSON.stringify(deriveTopBlockerReasons(runs))) {
    throw new SniperAlphaHistoryError("topBlockerReasons must be re-derived from the runs");
  }

  if (!isObject(value.sensitiveFieldScan)) throw new SniperAlphaHistoryError("sensitiveFieldScan must be an object");
  const scan = value.sensitiveFieldScan as Record<string, unknown>;
  for (const [field, expected] of [
    ["scanned", true],
    ["signaturePresent", false],
    ["txidPresent", false],
    ["sendResultPresent", false],
    ["keyLikePresent", false],
  ] as const) {
    if (scan[field] !== expected) throw new SniperAlphaHistoryError(`sensitiveFieldScan.${field} must literally be ${String(expected)}`);
  }
  for (const k of Object.keys(scan)) {
    if (!(["scanned", "signaturePresent", "txidPresent", "sendResultPresent", "keyLikePresent"] as readonly string[]).includes(k)) {
      throw new SniperAlphaHistoryError(`sensitiveFieldScan has unknown field "${k}"`);
    }
  }

  for (const field of ["nextSafeActions", "caveats", "artifactRefs"] as const) {
    if (!Array.isArray(value[field])) throw new SniperAlphaHistoryError(`${field} must be an array`);
  }
  if ((value.caveats as unknown[]).length === 0) throw new SniperAlphaHistoryError("caveats must be non-empty");

  if (value.liveTradingStatus !== SNIPER_ALPHA_HISTORY_LIVE_TRADING_STATUS) {
    throw new SniperAlphaHistoryError(`liveTradingStatus must literally be "${SNIPER_ALPHA_HISTORY_LIVE_TRADING_STATUS}" — an alpha history can never report live enabled`);
  }
  for (const [field, expected] of [
    ["anyRunAuthorizesLiveTrading", false],
    ["authorizesLiveTrading", false],
    ["redactionApplied", true],
    ["neverSends", true],
    ["phase7LiveTradingReady", false],
  ] as const) {
    if (value[field] !== expected) throw new SniperAlphaHistoryError(`${field} must literally be ${String(expected)}`);
  }

  // Belt-and-braces: the closed verdict set must still recognize the verdict-count keys.
  for (const k of ["watch", "review", "blocked", "insufficient-evidence"]) {
    if (!(SNIPER_CAMPAIGN_CANDIDATE_VERDICTS as readonly string[]).includes(k)) {
      throw new SniperAlphaHistoryError("the campaign verdict vocabulary changed — alpha history is out of date");
    }
  }

  return value as unknown as SniperAlphaHistory;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperAlphaHistory}. */
export interface FormatSniperAlphaHistoryOptions {
  label?: string;
  /** Cap on the number of run rows printed (default 50; the rest are summarized). */
  maxRows?: number;
}

/**
 * Render a redacted, stable, human-readable alpha history summary. Deterministic and path-stable
 * (no timestamps). The whole output passes through the redactor.
 */
export function formatSniperAlphaHistory(history: SniperAlphaHistory, opts: FormatSniperAlphaHistoryOptions = {}): string {
  const maxRows = opts.maxRows ?? 50;
  const header = `${history.banner}`;
  const lines: string[] = [header, "=".repeat(Math.min(header.length, 80))];
  if (opts.label) lines.push(`label:      ${opts.label}`);
  lines.push(`history id: ${history.historyId}`);
  lines.push(`live:       ${history.liveTradingStatus.toUpperCase()} (authorizes live trading: ${String(history.authorizesLiveTrading)})`);
  lines.push(`runs:       ${history.runCount} valid · ${history.invalidArtifactCount} invalid/unrecognized`);
  lines.push(`candidates: ${history.totalCandidateCount} total`);
  lines.push(
    `verdicts:   watch ${history.aggregateVerdictCounts.watch} · review ${history.aggregateVerdictCounts.review} · BLOCKED ${history.aggregateVerdictCounts.blocked} · insufficient ${history.aggregateVerdictCounts.insufficientEvidence}`,
  );
  lines.push(`provenance: real-readonly ${history.evidenceProvenanceRollup.realReadonly} · fixture ${history.evidenceProvenanceRollup.fixture} · fictional ${history.evidenceProvenanceRollup.fictionalExample} · mixed ${history.evidenceProvenanceRollup.mixed}`);

  lines.push("");
  lines.push("Runs (by ref):");
  for (const r of history.runs.slice(0, maxRows)) {
    const bits: string[] = [`${r.mode}/${r.network}`, r.evidenceProvenance];
    bits.push(`watch=${r.verdictCounts.watch}`);
    bits.push(`review=${r.verdictCounts.review}`);
    bits.push(`blocked=${r.verdictCounts.blocked}`);
    bits.push(`insufficient=${r.verdictCounts.insufficientEvidence}`);
    lines.push(`- ${r.runRef}  [${bits.join("; ")}]`);
    if (r.blockerReasons.length > 0) lines.push(`    blockers: ${r.blockerReasons.join("; ")}`);
  }
  const hidden = history.runs.length - Math.min(history.runs.length, maxRows);
  if (hidden > 0) lines.push(`… and ${hidden} more (summarized; see the history JSON for the full set)`);
  if (history.runs.length === 0) lines.push("(no valid runs)");

  if (history.invalidArtifacts.length > 0) {
    lines.push("");
    lines.push("Invalid / unrecognized artifacts (NOT counted as runs):");
    for (const a of history.invalidArtifacts) lines.push(`- ${a.ref}: ${a.reason}`);
  }

  if (history.topBlockerReasons.length > 0) {
    lines.push("");
    lines.push("Most common blocker reasons:");
    for (const b of history.topBlockerReasons) lines.push(`- ${b.reason} (${b.runCount} run${b.runCount === 1 ? "" : "s"})`);
  }

  lines.push("");
  lines.push(`provider health (runs): risk ok=${history.providerHealthRollup.risk.ok}/unavailable=${history.providerHealthRollup.risk.unavailable} · quote ok=${history.providerHealthRollup.quote.ok}/unavailable=${history.providerHealthRollup.quote.unavailable} · sim ok=${history.providerHealthRollup.simulation.ok}/unavailable=${history.providerHealthRollup.simulation.unavailable}`);
  lines.push(`phase 7 postures: ${history.phase7Postures.length > 0 ? history.phase7Postures.join(", ") : "(none)"}`);

  lines.push("");
  lines.push("Next safe actions:");
  for (const a of history.nextSafeActions) lines.push(`- ${a}`);
  lines.push("");
  lines.push("Caveats:");
  for (const c of history.caveats) lines.push(`- ${c}`);
  lines.push("");
  for (const d of history.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
