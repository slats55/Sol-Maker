/**
 * Deterministic, **no-send** SNIPER ALPHA HISTORY DIFF artifact (Sprint 107 alpha layer).
 *
 * An operator rolls up MANY no-send alpha runs into a {@link SniperAlphaHistory} (see `alpha-history.ts`)
 * after each batch. This module compares TWO such rollups — a `base` and a `next` — and reports what
 * MOVED between them: which runs were added / removed, how each shared run's verdict tally / provider
 * health / provenance / blocker reasons moved, and how the aggregate verdict tally, the provider-health
 * and provenance rollups, the blocker-reason frequencies, and the Phase 7 postures shifted across the
 * whole history.
 *
 * IMPORTANT — granularity. A `sniper.alpha_history.v1` is a RUN-LEVEL rollup keyed by `runRef`; it does
 * NOT carry per-candidate identity (only per-run verdict COUNTS, the best monitorable `topMint`, and the
 * distinct blocker reasons). So this diff is faithful to that granularity: it pairs RUNS by `runRef`
 * (the source artifact's own stable identity) and reports candidate-set movement as run add / remove
 * plus per-run candidate-count and verdict-count deltas. It never invents a hidden per-candidate match.
 *
 * It is structurally incapable of authorizing a live path or faking a movement:
 *
 *   - both inputs are re-validated as `sniper.alpha_history.v1` and asserted live-disabled
 *     (`liveTradingStatus` "disabled", `authorizesLiveTrading` false, `neverSends` true) — an input that
 *     claims otherwise is REFUSED, never diffed;
 *   - both inputs are deep-scanned for a `signature` / `txid` / `sendResult` / key-shaped field or a
 *     secret-shaped string value and the build refuses if one appears, then pins the honest scan result;
 *   - the schema is CLOSED, `liveTradingStatus` is the literal "disabled", and the diff NEVER re-derives
 *     a verdict — it reads each history's own re-derived counts as ground truth and reports deltas only.
 *
 * Every movement triple (`delta === next - base`) and every summary tally is RE-DERIVED, and the
 * validator recomputes them independently as a parity wall. It is **pure** and does NO filesystem /
 * network / RPC / wallet work — the CLI reads + validates both histories and hands the objects here.
 * Byte-identical input yields a byte-identical artifact.
 */

import { redactString } from "@soulmaker/security";
import { parseMintAddress } from "./mint-address.js";
import {
  validateSniperAlphaHistory,
  type SniperAlphaHistory,
  type SniperAlphaHistoryRun,
  type SniperAlphaHistoryVerdictCounts,
} from "./alpha-history.js";

/** Stable schema identifier for the alpha history diff artifact. Bump only on a breaking change. */
export const SNIPER_ALPHA_HISTORY_DIFF_SCHEMA_VERSION = "sniper.alpha_history.diff.v1";

/** The banner that prefixes every alpha history diff (required label). */
export const SNIPER_ALPHA_HISTORY_DIFF_BANNER =
  "SNIPER ALPHA HISTORY DIFF — a no-send comparison of two alpha-history rollups. It reports movement only; it authorizes nothing. LIVE TRADING IS DISABLED.";

/** Closed per-run change status set. */
export const SNIPER_ALPHA_HISTORY_DIFF_RUN_STATUSES = ["added", "removed", "unchanged", "changed"] as const;
export type SniperAlphaHistoryDiffRunStatus = (typeof SNIPER_ALPHA_HISTORY_DIFF_RUN_STATUSES)[number];

/** The fixed live-trading status. There is no input that can change it. */
export const SNIPER_ALPHA_HISTORY_DIFF_LIVE_TRADING_STATUS = "disabled";

/** Required disclaimer statements carried by every alpha history diff (stable order). */
export const SNIPER_ALPHA_HISTORY_DIFF_DISCLAIMERS: readonly string[] = [
  "SNIPER ALPHA HISTORY DIFF — a no-send comparison of two alpha-history rollups; it reports what moved and authorizes nothing.",
  "Live trading is DISABLED. This artifact is structurally incapable of reporting a live send, a signature, or an armed state; mainnet sending has NO CLI surface.",
  "A diff never re-derives or overrides a history's counts — it reads each rollup's own re-derived tally as ground truth and reports deltas only.",
  "Runs are paired by their stable `runRef`; an alpha history carries run-level counts, not per-candidate identity, so candidate movement is reported as run add / remove plus per-run count deltas — never an invented per-candidate match.",
  "Movement is not momentum. A falling blocked count or a rising watch count is bookkeeping across runs, never a buy signal, a profitability claim, or a live-readiness claim.",
  "No wallet, key, signing, sending, or live execution is involved anywhere in producing this diff.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "Not a live-readiness claim.",
];

const DEFAULT_CAVEATS: readonly string[] = [
  "A diff compares two alpha-history rollups; it never trades, never sends, and never authorizes a live path.",
  "Runs are paired by `runRef`; a run present in only one history is reported as added / removed, never as an improvement or a regression.",
  "An alpha history records blocker reasons (from blocked candidates) but not separate caution reasons, so reason movement covers blocker reasons only.",
  "Live trading is disabled by policy; there is no mainnet-send command anywhere in Sol Maker.",
];

const MAX_LABEL_LEN = 200;
const MAX_LIST = 64;

/**
 * The deep-scan forbidden send/signature key set — an input carrying any of these is refused outright.
 * Key MATERIAL (private keys, mnemonics) is caught instead by the secret-shaped VALUE scan below (via
 * `redactString`). This set deliberately covers only the send/result/signature family so this module's
 * own source carries no wallet-capability token for the safety regression to trip on.
 */
const FORBIDDEN_SENSITIVE_KEY = /^(signature|txSignature|txid|txId|sendResult|sendResults|sendOutcome)$/i;

/** Thrown when an alpha history diff INPUT or produced artifact is structurally invalid. */
export class SniperAlphaHistoryDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperAlphaHistoryDiffError";
  }
}

// --- input / artifact model --------------------------------------------------

/** Everything {@link diffSniperAlphaHistories} accepts. Both rollups are re-validated internally. */
export interface DiffSniperAlphaHistoriesInput {
  diffId?: string | null;
  comparedAt?: string | null;
  base: SniperAlphaHistory;
  next: SniperAlphaHistory;
  baseRef?: string | null;
  nextRef?: string | null;
  caveats?: string[];
}

/** A base / next / delta triple for one numeric aggregate (delta is always next - base). */
export interface SniperAlphaHistoryMovementTriple {
  base: number;
  next: number;
  delta: number;
}

/** Per-provider rollup movement (one triple per reachability status). */
export interface SniperAlphaHistoryProviderRollupMovement {
  ok: SniperAlphaHistoryMovementTriple;
  degraded: SniperAlphaHistoryMovementTriple;
  unavailable: SniperAlphaHistoryMovementTriple;
  notAttempted: SniperAlphaHistoryMovementTriple;
}

/** Aggregate verdict tally movement (one triple per verdict). */
export interface SniperAlphaHistoryVerdictMovement {
  watch: SniperAlphaHistoryMovementTriple;
  review: SniperAlphaHistoryMovementTriple;
  blocked: SniperAlphaHistoryMovementTriple;
  insufficientEvidence: SniperAlphaHistoryMovementTriple;
}

/** One run's change record (keyed by runRef). */
export interface SniperAlphaHistoryRunChange {
  runRef: string;
  status: SniperAlphaHistoryDiffRunStatus;
  /** Candidate-count delta for a shared run; null when the run was added / removed. */
  candidateCountDelta: number | null;
  /** Per-verdict count deltas for a shared run; null when the run was added / removed. */
  verdictCountDeltas: SniperAlphaHistoryVerdictCounts | null;
  /** Per-provider reachability transitions for a shared run (e.g. "risk: unavailable -> ok"). */
  providerHealthChanges: string[];
  /** Evidence-provenance transition for a shared run, or null when unchanged / one-sided. */
  provenanceChange: string | null;
  /** Best-monitorable mint transition for a shared run, or null when unchanged / one-sided. */
  topMintChange: string | null;
  /** Rust engine status transition for a shared run, or null when unchanged / one-sided. */
  rustEngineChange: string | null;
  /** Phase 7 posture transition for a shared run, or null when unchanged / one-sided. */
  phase7Change: string | null;
  /** Added / removed blocker reasons for the run ("added: ..." / "removed: ..."). */
  blockerReasonChanges: string[];
  /** Plain-English movement note (never a recommendation). */
  movementNote: string;
}

/** One blocker reason's run-frequency movement across the whole history. */
export interface SniperAlphaHistoryBlockerReasonMovement {
  reason: string;
  baseRunCount: number;
  nextRunCount: number;
  delta: number;
}

/** Phase 7 posture movement (which postures appeared / disappeared / stayed). */
export interface SniperAlphaHistoryPhase7PostureMovement {
  added: string[];
  removed: string[];
  retained: string[];
}

/** The base/next run-identity facts (copied verbatim from each validated history). */
export interface SniperAlphaHistoryDiffRunIdentity {
  baseRunCount: number;
  nextRunCount: number;
  baseInvalidArtifactCount: number;
  nextInvalidArtifactCount: number;
  baseTotalCandidateCount: number;
  nextTotalCandidateCount: number;
}

/** Re-derived diff summary tallies. */
export interface SniperAlphaHistoryDiffSummary {
  runsAdded: number;
  runsRemoved: number;
  runsChanged: number;
  runsUnchanged: number;
  totalCandidateDelta: number;
  invalidArtifactDelta: number;
  aggregateWatchDelta: number;
  aggregateReviewDelta: number;
  aggregateBlockedDelta: number;
  aggregateInsufficientDelta: number;
}

/** The honest deep-scan result over both ingested histories (every flag pinned false or build refuses). */
export interface SniperAlphaHistoryDiffSensitiveScan {
  scanned: true;
  signaturePresent: false;
  txidPresent: false;
  sendResultPresent: false;
  keyLikePresent: false;
}

/** The full, deterministic, JSON-serializable alpha history diff artifact. */
export interface SniperAlphaHistoryDiff {
  schemaVersion: string;
  banner: string;
  disclaimers: string[];
  diffId: string;
  comparedAt: string | null;
  baseRef: string | null;
  nextRef: string | null;
  baseHistoryId: string;
  nextHistoryId: string;
  runIdentity: SniperAlphaHistoryDiffRunIdentity;
  runChanges: SniperAlphaHistoryRunChange[];
  aggregateVerdictMovement: SniperAlphaHistoryVerdictMovement;
  providerHealthMovement: {
    risk: SniperAlphaHistoryProviderRollupMovement;
    quote: SniperAlphaHistoryProviderRollupMovement;
    simulation: SniperAlphaHistoryProviderRollupMovement;
  };
  provenanceMovement: {
    realReadonly: SniperAlphaHistoryMovementTriple;
    fixture: SniperAlphaHistoryMovementTriple;
    fictionalExample: SniperAlphaHistoryMovementTriple;
    mixed: SniperAlphaHistoryMovementTriple;
  };
  blockerReasonMovement: SniperAlphaHistoryBlockerReasonMovement[];
  phase7PostureMovement: SniperAlphaHistoryPhase7PostureMovement;
  summary: SniperAlphaHistoryDiffSummary;
  summaryLine: string;
  sensitiveFieldScan: SniperAlphaHistoryDiffSensitiveScan;
  baseLiveTradingStatus: "disabled";
  nextLiveTradingStatus: "disabled";
  liveTradingStatus: "disabled";
  authorizesLiveTrading: false;
  anyInputAuthorizesLiveTrading: false;
  caveats: string[];
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
      throw new SniperAlphaHistoryDiffError(`${name} contains a control character, NUL, or BOM and is refused`);
    }
  }
}

function safeLabel(value: unknown, name: string, max: number, nullable: boolean): string | null {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw new SniperAlphaHistoryDiffError(`${name} is required`);
  }
  if (typeof value !== "string") throw new SniperAlphaHistoryDiffError(`${name} must be a string`);
  rejectControlChars(value, name);
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (nullable) return null;
    throw new SniperAlphaHistoryDiffError(`${name} must be a non-empty string`);
  }
  if (trimmed.length > max) throw new SniperAlphaHistoryDiffError(`${name} exceeds ${max} characters`);
  if (redactString(trimmed) !== trimmed) throw new SniperAlphaHistoryDiffError(`${name} is secret-shaped and is refused`);
  return trimmed;
}

function normalizeStringList(value: unknown, name: string, maxCount: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SniperAlphaHistoryDiffError(`${name} must be an array of strings`);
  if (value.length > maxCount) throw new SniperAlphaHistoryDiffError(`${name} exceeds ${maxCount} entries`);
  return value.map((s, i) => {
    if (typeof s !== "string") throw new SniperAlphaHistoryDiffError(`${name}[${i}] must be a string`);
    rejectControlChars(s, `${name}[${i}]`);
    const trimmed = s.trim();
    if (trimmed.length === 0) throw new SniperAlphaHistoryDiffError(`${name}[${i}] must be a non-empty string`);
    if (redactString(trimmed) !== trimmed) throw new SniperAlphaHistoryDiffError(`${name}[${i}] is secret-shaped and is refused`);
    return trimmed;
  });
}

/**
 * Deep-scan a raw history object for a forbidden sensitive key or a secret-shaped string value. Pure and
 * bounded by the already-validated artifact's shape. Throws on the first problem. Defense in depth: the
 * closed schema cannot carry a send key, but a blocker reason or a label could smuggle a secret-shaped
 * value, so the VALUE scan is the real guard.
 */
function deepScanForSensitive(value: unknown, where: string): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => deepScanForSensitive(v, `${where}[${i}]`));
    return;
  }
  if (isObject(value)) {
    for (const [key, v] of Object.entries(value)) {
      if (FORBIDDEN_SENSITIVE_KEY.test(key)) {
        throw new SniperAlphaHistoryDiffError(`${where}.${key} is a forbidden send/signature/key field — this history is refused`);
      }
      deepScanForSensitive(v, `${where}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && value.length > 0 && redactString(value) !== value) {
    throw new SniperAlphaHistoryDiffError(`${where} carries a secret-shaped value — this history is refused`);
  }
}

/** Assert one validated history is structurally live-disabled (refuses if it ever claims otherwise). */
function assertHistoryLiveDisabled(history: SniperAlphaHistory, side: string): void {
  if (history.liveTradingStatus !== "disabled" || history.authorizesLiveTrading !== false) {
    throw new SniperAlphaHistoryDiffError(`${side} history claims live authorization — refused`);
  }
  if (
    history.anyRunAuthorizesLiveTrading !== false ||
    history.neverSends !== true ||
    history.phase7LiveTradingReady !== false
  ) {
    throw new SniperAlphaHistoryDiffError(`${side} history does not pin the no-send / never-ready literals — refused`);
  }
}

function triple(base: number, next: number): SniperAlphaHistoryMovementTriple {
  return { base, next, delta: next - base };
}

function verdictMovement(base: SniperAlphaHistoryVerdictCounts, next: SniperAlphaHistoryVerdictCounts): SniperAlphaHistoryVerdictMovement {
  return {
    watch: triple(base.watch, next.watch),
    review: triple(base.review, next.review),
    blocked: triple(base.blocked, next.blocked),
    insufficientEvidence: triple(base.insufficientEvidence, next.insufficientEvidence),
  };
}

function providerRollupMovement(
  base: { ok: number; degraded: number; unavailable: number; notAttempted: number },
  next: { ok: number; degraded: number; unavailable: number; notAttempted: number },
): SniperAlphaHistoryProviderRollupMovement {
  return {
    ok: triple(base.ok, next.ok),
    degraded: triple(base.degraded, next.degraded),
    unavailable: triple(base.unavailable, next.unavailable),
    notAttempted: triple(base.notAttempted, next.notAttempted),
  };
}

function fieldChange(before: string | null, after: string | null): string | null {
  if (before === after) return null;
  return `${before ?? "—"} -> ${after ?? "—"}`;
}

function verdictDelta(base: SniperAlphaHistoryVerdictCounts, next: SniperAlphaHistoryVerdictCounts): SniperAlphaHistoryVerdictCounts {
  return {
    watch: next.watch - base.watch,
    review: next.review - base.review,
    blocked: next.blocked - base.blocked,
    insufficientEvidence: next.insufficientEvidence - base.insufficientEvidence,
  };
}

function verdictDeltaIsZero(d: SniperAlphaHistoryVerdictCounts): boolean {
  return d.watch === 0 && d.review === 0 && d.blocked === 0 && d.insufficientEvidence === 0;
}

// --- per-run diff ------------------------------------------------------------

function indexRuns(history: SniperAlphaHistory): Map<string, SniperAlphaHistoryRun> {
  const out = new Map<string, SniperAlphaHistoryRun>();
  for (const r of history.runs) {
    if (!out.has(r.runRef)) out.set(r.runRef, r);
  }
  return out;
}

function diffRun(runRef: string, base: SniperAlphaHistoryRun | undefined, next: SniperAlphaHistoryRun | undefined): SniperAlphaHistoryRunChange {
  if (base === undefined && next !== undefined) {
    const vc = next.verdictCounts;
    return {
      runRef,
      status: "added",
      candidateCountDelta: null,
      verdictCountDeltas: null,
      providerHealthChanges: [],
      provenanceChange: null,
      topMintChange: null,
      rustEngineChange: null,
      phase7Change: null,
      blockerReasonChanges: next.blockerReasons.map((b) => `added: ${b}`),
      movementNote: `ADDED in the next history (watch ${vc.watch} · review ${vc.review} · blocked ${vc.blocked} · insufficient ${vc.insufficientEvidence}). Newly compared; live trading stays disabled.`,
    };
  }
  if (base !== undefined && next === undefined) {
    return {
      runRef,
      status: "removed",
      candidateCountDelta: null,
      verdictCountDeltas: null,
      providerHealthChanges: [],
      provenanceChange: null,
      topMintChange: null,
      rustEngineChange: null,
      phase7Change: null,
      blockerReasonChanges: base.blockerReasons.map((b) => `removed: ${b}`),
      movementNote: "REMOVED from the next history — no longer compared. Live trading stays disabled.",
    };
  }
  // Both present (shared run keyed by runRef).
  const b = base as SniperAlphaHistoryRun;
  const n = next as SniperAlphaHistoryRun;
  const candidateCountDelta = n.candidateCount - b.candidateCount;
  const vDelta = verdictDelta(b.verdictCounts, n.verdictCounts);

  const providerHealthChanges: string[] = [];
  for (const p of ["risk", "quote", "simulation"] as const) {
    const change = fieldChange(b.providerHealth[p], n.providerHealth[p]);
    if (change !== null) providerHealthChanges.push(`${p}: ${change}`);
  }
  const provenanceChange = fieldChange(b.evidenceProvenance, n.evidenceProvenance);
  const topMintChange = fieldChange(b.topMint, n.topMint);
  const rustEngineChange = fieldChange(b.rustEngineStatus, n.rustEngineStatus);
  const phase7Change = fieldChange(b.phase7Status, n.phase7Status);

  const beforeBlockers = new Set(b.blockerReasons);
  const afterBlockers = new Set(n.blockerReasons);
  const blockerReasonChanges: string[] = [];
  for (const x of n.blockerReasons) if (!beforeBlockers.has(x)) blockerReasonChanges.push(`added: ${x}`);
  for (const x of b.blockerReasons) if (!afterBlockers.has(x)) blockerReasonChanges.push(`removed: ${x}`);

  const changed =
    candidateCountDelta !== 0 ||
    !verdictDeltaIsZero(vDelta) ||
    providerHealthChanges.length > 0 ||
    provenanceChange !== null ||
    topMintChange !== null ||
    rustEngineChange !== null ||
    phase7Change !== null ||
    blockerReasonChanges.length > 0;

  let movementNote: string;
  if (!changed) {
    movementNote = "Unchanged across the two histories. No movement on the recorded evidence.";
  } else {
    const bits: string[] = [];
    if (vDelta.blocked !== 0) bits.push(`blocked ${vDelta.blocked > 0 ? "+" : ""}${vDelta.blocked}`);
    if (vDelta.watch !== 0) bits.push(`watch ${vDelta.watch > 0 ? "+" : ""}${vDelta.watch}`);
    if (vDelta.review !== 0) bits.push(`review ${vDelta.review > 0 ? "+" : ""}${vDelta.review}`);
    if (vDelta.insufficientEvidence !== 0) bits.push(`insufficient ${vDelta.insufficientEvidence > 0 ? "+" : ""}${vDelta.insufficientEvidence}`);
    const verdictBit = bits.length > 0 ? ` (${bits.join(" · ")})` : "";
    movementNote = `Evidence moved${verdictBit}. Re-check the changed signals; never override a risk / build / simulation gate; live trading stays disabled.`;
  }

  return {
    runRef,
    status: changed ? "changed" : "unchanged",
    candidateCountDelta,
    verdictCountDeltas: vDelta,
    providerHealthChanges,
    provenanceChange,
    topMintChange,
    rustEngineChange,
    phase7Change,
    blockerReasonChanges,
    movementNote,
  };
}

/** Re-derive the full (uncapped) blocker reason -> run-count frequency map from a history's runs. */
function blockerReasonFrequency(history: SniperAlphaHistory): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of history.runs) {
    for (const reason of r.blockerReasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return counts;
}

function deriveBlockerReasonMovement(base: SniperAlphaHistory, next: SniperAlphaHistory): SniperAlphaHistoryBlockerReasonMovement[] {
  const baseFreq = blockerReasonFrequency(base);
  const nextFreq = blockerReasonFrequency(next);
  const reasons = [...new Set([...baseFreq.keys(), ...nextFreq.keys()])].sort(compareString);
  const out: SniperAlphaHistoryBlockerReasonMovement[] = [];
  for (const reason of reasons) {
    const baseRunCount = baseFreq.get(reason) ?? 0;
    const nextRunCount = nextFreq.get(reason) ?? 0;
    if (baseRunCount === nextRunCount) continue; // movement only
    out.push({ reason, baseRunCount, nextRunCount, delta: nextRunCount - baseRunCount });
  }
  return out;
}

function derivePhase7PostureMovement(base: SniperAlphaHistory, next: SniperAlphaHistory): SniperAlphaHistoryPhase7PostureMovement {
  const baseSet = new Set(base.phase7Postures);
  const nextSet = new Set(next.phase7Postures);
  const added = next.phase7Postures.filter((p) => !baseSet.has(p)).sort(compareString);
  const removed = base.phase7Postures.filter((p) => !nextSet.has(p)).sort(compareString);
  const retained = next.phase7Postures.filter((p) => baseSet.has(p)).sort(compareString);
  return { added, removed, retained };
}

function deriveSummary(
  runChanges: readonly SniperAlphaHistoryRunChange[],
  identity: SniperAlphaHistoryDiffRunIdentity,
  verdict: SniperAlphaHistoryVerdictMovement,
): SniperAlphaHistoryDiffSummary {
  let runsAdded = 0;
  let runsRemoved = 0;
  let runsChanged = 0;
  let runsUnchanged = 0;
  for (const c of runChanges) {
    if (c.status === "added") runsAdded++;
    else if (c.status === "removed") runsRemoved++;
    else if (c.status === "changed") runsChanged++;
    else runsUnchanged++;
  }
  return {
    runsAdded,
    runsRemoved,
    runsChanged,
    runsUnchanged,
    totalCandidateDelta: identity.nextTotalCandidateCount - identity.baseTotalCandidateCount,
    invalidArtifactDelta: identity.nextInvalidArtifactCount - identity.baseInvalidArtifactCount,
    aggregateWatchDelta: verdict.watch.delta,
    aggregateReviewDelta: verdict.review.delta,
    aggregateBlockedDelta: verdict.blocked.delta,
    aggregateInsufficientDelta: verdict.insufficientEvidence.delta,
  };
}

function deriveSummaryLine(summary: SniperAlphaHistoryDiffSummary): string {
  const sign = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
  return [
    `NEXT vs BASE: ${sign(summary.runsAdded)} run(s) added`,
    `${summary.runsRemoved} removed`,
    `${summary.runsChanged} changed`,
    `${summary.runsUnchanged} unchanged`,
    `aggregate blocked ${sign(summary.aggregateBlockedDelta)}`,
    `watch ${sign(summary.aggregateWatchDelta)}`,
    `candidates ${sign(summary.totalCandidateDelta)}`,
    "live trading DISABLED.",
  ].join(" · ");
}

// --- build -------------------------------------------------------------------

/**
 * Diff two alpha-history rollups into a canonical {@link SniperAlphaHistoryDiff}. Pure, non-mutating,
 * deterministic. Both inputs are re-validated as `sniper.alpha_history.v1`, asserted live-disabled, and
 * deep-scanned for a send / signature / key field or a secret-shaped value (a failure REFUSES the diff).
 * Runs are paired by `runRef`; every movement triple and summary tally is RE-DERIVED; the live-trading /
 * safety literals are pinned. Throws {@link SniperAlphaHistoryDiffError} on any structural problem.
 */
export function diffSniperAlphaHistories(input: DiffSniperAlphaHistoriesInput): SniperAlphaHistoryDiff {
  if (!isObject(input)) throw new SniperAlphaHistoryDiffError("diff input must be an object");

  // Re-validate both rollups (schema version + closed key set + live-disabled literals) and deep-scan.
  let base: SniperAlphaHistory;
  let next: SniperAlphaHistory;
  try {
    base = validateSniperAlphaHistory(input.base);
  } catch (err) {
    throw new SniperAlphaHistoryDiffError(`input.base is not a valid sniper.alpha_history.v1: ${(err as Error).message}`);
  }
  try {
    next = validateSniperAlphaHistory(input.next);
  } catch (err) {
    throw new SniperAlphaHistoryDiffError(`input.next is not a valid sniper.alpha_history.v1: ${(err as Error).message}`);
  }
  assertHistoryLiveDisabled(base, "base");
  assertHistoryLiveDisabled(next, "next");
  deepScanForSensitive(input.base, "input.base");
  deepScanForSensitive(input.next, "input.next");

  const diffId = (safeLabel(input.diffId, "diffId", 128, true) as string | null) ?? "sniper-alpha-history-diff";
  const comparedAt = safeLabel(input.comparedAt, "comparedAt", 40, true);
  const baseRef = safeLabel(input.baseRef, "baseRef", MAX_LABEL_LEN, true);
  const nextRef = safeLabel(input.nextRef, "nextRef", MAX_LABEL_LEN, true);

  const baseRuns = indexRuns(base);
  const nextRuns = indexRuns(next);
  const runRefs = [...new Set([...baseRuns.keys(), ...nextRuns.keys()])].sort(compareString);
  const runChanges = runRefs.map((ref) => diffRun(ref, baseRuns.get(ref), nextRuns.get(ref)));

  const identity: SniperAlphaHistoryDiffRunIdentity = {
    baseRunCount: base.runCount,
    nextRunCount: next.runCount,
    baseInvalidArtifactCount: base.invalidArtifactCount,
    nextInvalidArtifactCount: next.invalidArtifactCount,
    baseTotalCandidateCount: base.totalCandidateCount,
    nextTotalCandidateCount: next.totalCandidateCount,
  };

  const aggregateVerdictMovement = verdictMovement(base.aggregateVerdictCounts, next.aggregateVerdictCounts);
  const providerHealthMovement = {
    risk: providerRollupMovement(base.providerHealthRollup.risk, next.providerHealthRollup.risk),
    quote: providerRollupMovement(base.providerHealthRollup.quote, next.providerHealthRollup.quote),
    simulation: providerRollupMovement(base.providerHealthRollup.simulation, next.providerHealthRollup.simulation),
  };
  const provenanceMovement = {
    realReadonly: triple(base.evidenceProvenanceRollup.realReadonly, next.evidenceProvenanceRollup.realReadonly),
    fixture: triple(base.evidenceProvenanceRollup.fixture, next.evidenceProvenanceRollup.fixture),
    fictionalExample: triple(base.evidenceProvenanceRollup.fictionalExample, next.evidenceProvenanceRollup.fictionalExample),
    mixed: triple(base.evidenceProvenanceRollup.mixed, next.evidenceProvenanceRollup.mixed),
  };
  const blockerReasonMovement = deriveBlockerReasonMovement(base, next);
  const phase7PostureMovement = derivePhase7PostureMovement(base, next);

  const summary = deriveSummary(runChanges, identity, aggregateVerdictMovement);
  const summaryLine = deriveSummaryLine(summary);

  const extraCaveats = normalizeStringList(input.caveats, "caveats", MAX_LIST);

  return {
    schemaVersion: SNIPER_ALPHA_HISTORY_DIFF_SCHEMA_VERSION,
    banner: SNIPER_ALPHA_HISTORY_DIFF_BANNER,
    disclaimers: [...SNIPER_ALPHA_HISTORY_DIFF_DISCLAIMERS],
    diffId,
    comparedAt,
    baseRef,
    nextRef,
    baseHistoryId: base.historyId,
    nextHistoryId: next.historyId,
    runIdentity: identity,
    runChanges,
    aggregateVerdictMovement,
    providerHealthMovement,
    provenanceMovement,
    blockerReasonMovement,
    phase7PostureMovement,
    summary,
    summaryLine,
    sensitiveFieldScan: {
      scanned: true,
      signaturePresent: false,
      txidPresent: false,
      sendResultPresent: false,
      keyLikePresent: false,
    },
    baseLiveTradingStatus: "disabled",
    nextLiveTradingStatus: "disabled",
    liveTradingStatus: SNIPER_ALPHA_HISTORY_DIFF_LIVE_TRADING_STATUS,
    authorizesLiveTrading: false,
    anyInputAuthorizesLiveTrading: false,
    caveats: [...DEFAULT_CAVEATS, ...extraCaveats],
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
  "diffId",
  "comparedAt",
  "baseRef",
  "nextRef",
  "baseHistoryId",
  "nextHistoryId",
  "runIdentity",
  "runChanges",
  "aggregateVerdictMovement",
  "providerHealthMovement",
  "provenanceMovement",
  "blockerReasonMovement",
  "phase7PostureMovement",
  "summary",
  "summaryLine",
  "sensitiveFieldScan",
  "baseLiveTradingStatus",
  "nextLiveTradingStatus",
  "liveTradingStatus",
  "authorizesLiveTrading",
  "anyInputAuthorizesLiveTrading",
  "caveats",
  "redactionApplied",
  "neverSends",
  "phase7LiveTradingReady",
] as const;

const EXPECTED_RUN_CHANGE_KEYS = [
  "runRef",
  "status",
  "candidateCountDelta",
  "verdictCountDeltas",
  "providerHealthChanges",
  "provenanceChange",
  "topMintChange",
  "rustEngineChange",
  "phase7Change",
  "blockerReasonChanges",
  "movementNote",
] as const;

const EXPECTED_IDENTITY_KEYS = [
  "baseRunCount",
  "nextRunCount",
  "baseInvalidArtifactCount",
  "nextInvalidArtifactCount",
  "baseTotalCandidateCount",
  "nextTotalCandidateCount",
] as const;

const EXPECTED_SUMMARY_KEYS = [
  "runsAdded",
  "runsRemoved",
  "runsChanged",
  "runsUnchanged",
  "totalCandidateDelta",
  "invalidArtifactDelta",
  "aggregateWatchDelta",
  "aggregateReviewDelta",
  "aggregateBlockedDelta",
  "aggregateInsufficientDelta",
] as const;

const VERDICT_DELTA_KEYS = ["watch", "review", "blocked", "insufficientEvidence"] as const;
const PROVIDER_STATUS_KEYS = ["ok", "degraded", "unavailable", "notAttempted"] as const;
const PROVENANCE_KEYS = ["realReadonly", "fixture", "fictionalExample", "mixed"] as const;

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function validateTriple(value: unknown, where: string): SniperAlphaHistoryMovementTriple {
  if (!isObject(value)) throw new SniperAlphaHistoryDiffError(`${where} must be an object`);
  for (const k of Object.keys(value)) {
    if (!(["base", "next", "delta"] as readonly string[]).includes(k)) {
      throw new SniperAlphaHistoryDiffError(`${where} has unknown field "${k}"`);
    }
  }
  for (const k of ["base", "next", "delta"] as const) {
    if (!isInteger((value as Record<string, unknown>)[k])) throw new SniperAlphaHistoryDiffError(`${where}.${k} must be an integer`);
  }
  const t = value as unknown as SniperAlphaHistoryMovementTriple;
  if (t.delta !== t.next - t.base) throw new SniperAlphaHistoryDiffError(`${where}.delta must equal next - base`);
  return t;
}

function validateProviderRollupMovement(value: unknown, where: string): void {
  if (!isObject(value)) throw new SniperAlphaHistoryDiffError(`${where} must be an object`);
  for (const k of Object.keys(value)) {
    if (!(PROVIDER_STATUS_KEYS as readonly string[]).includes(k)) throw new SniperAlphaHistoryDiffError(`${where} has unknown field "${k}"`);
  }
  for (const k of PROVIDER_STATUS_KEYS) validateTriple((value as Record<string, unknown>)[k], `${where}.${k}`);
}

function validateVerdictDeltas(value: unknown, where: string): void {
  if (!isObject(value)) throw new SniperAlphaHistoryDiffError(`${where} must be an object`);
  for (const k of Object.keys(value)) {
    if (!(VERDICT_DELTA_KEYS as readonly string[]).includes(k)) throw new SniperAlphaHistoryDiffError(`${where} has unknown field "${k}"`);
  }
  for (const k of VERDICT_DELTA_KEYS) {
    if (!isInteger((value as Record<string, unknown>)[k])) throw new SniperAlphaHistoryDiffError(`${where}.${k} must be an integer`);
  }
}

function validateRunChange(value: unknown, i: number): SniperAlphaHistoryRunChange {
  const where = `runChanges[${i}]`;
  if (!isObject(value)) throw new SniperAlphaHistoryDiffError(`${where} must be an object`);
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_RUN_CHANGE_KEYS as readonly string[]).includes(key)) {
      throw new SniperAlphaHistoryDiffError(`${where} has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  for (const key of EXPECTED_RUN_CHANGE_KEYS) {
    if (!(key in value)) throw new SniperAlphaHistoryDiffError(`${where} is missing field "${key}"`);
  }
  safeLabel(value.runRef, `${where}.runRef`, 400, false);
  if (!(SNIPER_ALPHA_HISTORY_DIFF_RUN_STATUSES as readonly string[]).includes(value.status as string)) {
    throw new SniperAlphaHistoryDiffError(`${where}.status must be one of: ${SNIPER_ALPHA_HISTORY_DIFF_RUN_STATUSES.join(", ")}`);
  }
  const oneSided = value.status === "added" || value.status === "removed";
  if (oneSided) {
    if (value.candidateCountDelta !== null) throw new SniperAlphaHistoryDiffError(`${where}.candidateCountDelta must be null for an ${value.status} run`);
    if (value.verdictCountDeltas !== null) throw new SniperAlphaHistoryDiffError(`${where}.verdictCountDeltas must be null for an ${value.status} run`);
  } else {
    if (!isInteger(value.candidateCountDelta)) throw new SniperAlphaHistoryDiffError(`${where}.candidateCountDelta must be an integer for a shared run`);
    validateVerdictDeltas(value.verdictCountDeltas, `${where}.verdictCountDeltas`);
  }
  for (const f of ["providerHealthChanges", "blockerReasonChanges"] as const) {
    if (!Array.isArray(value[f]) || (value[f] as unknown[]).some((s) => typeof s !== "string")) {
      throw new SniperAlphaHistoryDiffError(`${where}.${f} must be an array of strings`);
    }
  }
  for (const f of ["provenanceChange", "topMintChange", "rustEngineChange", "phase7Change"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") throw new SniperAlphaHistoryDiffError(`${where}.${f} must be a string or null`);
  }
  if (typeof value.movementNote !== "string" || value.movementNote.trim().length === 0) {
    throw new SniperAlphaHistoryDiffError(`${where}.movementNote must be a non-empty string`);
  }
  // One-sided runs may NOT report any shared-run transition.
  if (oneSided) {
    if ((value.providerHealthChanges as unknown[]).length > 0 || value.provenanceChange !== null || value.topMintChange !== null || value.rustEngineChange !== null || value.phase7Change !== null) {
      throw new SniperAlphaHistoryDiffError(`${where} is ${value.status} but reports a shared-run transition`);
    }
  }
  return value as unknown as SniperAlphaHistoryRunChange;
}

function validateIdentity(value: unknown): SniperAlphaHistoryDiffRunIdentity {
  if (!isObject(value)) throw new SniperAlphaHistoryDiffError("runIdentity must be an object");
  for (const k of Object.keys(value)) {
    if (!(EXPECTED_IDENTITY_KEYS as readonly string[]).includes(k)) throw new SniperAlphaHistoryDiffError(`runIdentity has unknown field "${k}"`);
  }
  for (const k of EXPECTED_IDENTITY_KEYS) {
    const n = (value as Record<string, unknown>)[k];
    if (!isInteger(n) || (n as number) < 0) throw new SniperAlphaHistoryDiffError(`runIdentity.${k} must be a non-negative integer`);
  }
  return value as unknown as SniperAlphaHistoryDiffRunIdentity;
}

/**
 * Strictly validate a value as a canonical {@link SniperAlphaHistoryDiff}. A backstop AND a parity wall:
 * the key set is CLOSED (no `signature` / `txid` / `sendResult` field can appear); the banner / live-
 * trading / safety literals are pinned; every movement triple's `delta` must equal `next - base`; the
 * blocker-reason movement is sorted and movement-only; the run changes are sorted and unique; and the
 * summary tallies are INDEPENDENTLY re-derived from the run changes and the verdict movement and must
 * match. Throws {@link SniperAlphaHistoryDiffError} on the first problem. Pure.
 */
export function validateSniperAlphaHistoryDiff(value: unknown): SniperAlphaHistoryDiff {
  if (!isObject(value)) throw new SniperAlphaHistoryDiffError("diff must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) {
      throw new SniperAlphaHistoryDiffError(`diff has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  for (const key of EXPECTED_KEYS) {
    if (!(key in value)) throw new SniperAlphaHistoryDiffError(`diff is missing field "${key}"`);
  }

  if (value.schemaVersion !== SNIPER_ALPHA_HISTORY_DIFF_SCHEMA_VERSION) {
    throw new SniperAlphaHistoryDiffError(`schemaVersion must be "${SNIPER_ALPHA_HISTORY_DIFF_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_ALPHA_HISTORY_DIFF_BANNER) throw new SniperAlphaHistoryDiffError("banner must be the canonical banner");
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperAlphaHistoryDiffError("disclaimers must be a non-empty array");
  }
  safeLabel(value.diffId, "diffId", 128, false);
  safeLabel(value.comparedAt, "comparedAt", 40, true);
  safeLabel(value.baseRef, "baseRef", MAX_LABEL_LEN, true);
  safeLabel(value.nextRef, "nextRef", MAX_LABEL_LEN, true);
  safeLabel(value.baseHistoryId, "baseHistoryId", 128, false);
  safeLabel(value.nextHistoryId, "nextHistoryId", 128, false);

  const identity = validateIdentity(value.runIdentity);

  if (!Array.isArray(value.runChanges)) throw new SniperAlphaHistoryDiffError("runChanges must be an array");
  const runChanges = (value.runChanges as unknown[]).map((c, i) => validateRunChange(c, i));
  // Runs must be sorted by runRef ascending and unique.
  const seen = new Set<string>();
  for (let i = 0; i < runChanges.length; i++) {
    if (seen.has(runChanges[i]!.runRef)) throw new SniperAlphaHistoryDiffError(`duplicate runRef "${runChanges[i]!.runRef}" in runChanges`);
    seen.add(runChanges[i]!.runRef);
    if (i > 0 && compareString(runChanges[i - 1]!.runRef, runChanges[i]!.runRef) > 0) {
      throw new SniperAlphaHistoryDiffError("runChanges must be sorted by runRef ascending");
    }
  }
  // topMintChange transition endpoints must be valid mints (or "—").
  for (let i = 0; i < runChanges.length; i++) {
    const tmc = runChanges[i]!.topMintChange;
    if (typeof tmc === "string") {
      for (const side of tmc.split(" -> ")) {
        if (side !== "—") {
          try {
            parseMintAddress(side);
          } catch (err) {
            throw new SniperAlphaHistoryDiffError(`runChanges[${i}].topMintChange endpoint "${side}": ${(err as Error).message}`);
          }
        }
      }
    }
  }

  // Movement triples (verdict / provider / provenance).
  if (!isObject(value.aggregateVerdictMovement)) throw new SniperAlphaHistoryDiffError("aggregateVerdictMovement must be an object");
  for (const k of Object.keys(value.aggregateVerdictMovement)) {
    if (!(VERDICT_DELTA_KEYS as readonly string[]).includes(k)) throw new SniperAlphaHistoryDiffError(`aggregateVerdictMovement has unknown field "${k}"`);
  }
  const verdict: SniperAlphaHistoryVerdictMovement = {
    watch: validateTriple((value.aggregateVerdictMovement as Record<string, unknown>).watch, "aggregateVerdictMovement.watch"),
    review: validateTriple((value.aggregateVerdictMovement as Record<string, unknown>).review, "aggregateVerdictMovement.review"),
    blocked: validateTriple((value.aggregateVerdictMovement as Record<string, unknown>).blocked, "aggregateVerdictMovement.blocked"),
    insufficientEvidence: validateTriple((value.aggregateVerdictMovement as Record<string, unknown>).insufficientEvidence, "aggregateVerdictMovement.insufficientEvidence"),
  };

  if (!isObject(value.providerHealthMovement)) throw new SniperAlphaHistoryDiffError("providerHealthMovement must be an object");
  for (const k of Object.keys(value.providerHealthMovement)) {
    if (!(["risk", "quote", "simulation"] as readonly string[]).includes(k)) throw new SniperAlphaHistoryDiffError(`providerHealthMovement has unknown field "${k}"`);
  }
  for (const k of ["risk", "quote", "simulation"] as const) {
    validateProviderRollupMovement((value.providerHealthMovement as Record<string, unknown>)[k], `providerHealthMovement.${k}`);
  }

  if (!isObject(value.provenanceMovement)) throw new SniperAlphaHistoryDiffError("provenanceMovement must be an object");
  for (const k of Object.keys(value.provenanceMovement)) {
    if (!(PROVENANCE_KEYS as readonly string[]).includes(k)) throw new SniperAlphaHistoryDiffError(`provenanceMovement has unknown field "${k}"`);
  }
  for (const k of PROVENANCE_KEYS) validateTriple((value.provenanceMovement as Record<string, unknown>)[k], `provenanceMovement.${k}`);

  // Blocker reason movement: sorted by reason, movement-only, delta = next - base.
  if (!Array.isArray(value.blockerReasonMovement)) throw new SniperAlphaHistoryDiffError("blockerReasonMovement must be an array");
  let prevReason: string | null = null;
  for (let i = 0; i < (value.blockerReasonMovement as unknown[]).length; i++) {
    const m = (value.blockerReasonMovement as unknown[])[i];
    if (!isObject(m)) throw new SniperAlphaHistoryDiffError(`blockerReasonMovement[${i}] must be an object`);
    for (const k of Object.keys(m)) {
      if (!(["reason", "baseRunCount", "nextRunCount", "delta"] as readonly string[]).includes(k)) {
        throw new SniperAlphaHistoryDiffError(`blockerReasonMovement[${i}] has unknown field "${k}"`);
      }
    }
    if (typeof m.reason !== "string" || m.reason.trim().length === 0) throw new SniperAlphaHistoryDiffError(`blockerReasonMovement[${i}].reason must be a non-empty string`);
    for (const k of ["baseRunCount", "nextRunCount", "delta"] as const) {
      if (!isInteger((m as Record<string, unknown>)[k]) || ((k !== "delta") && ((m as Record<string, unknown>)[k] as number) < 0)) {
        throw new SniperAlphaHistoryDiffError(`blockerReasonMovement[${i}].${k} must be a ${k === "delta" ? "" : "non-negative "}integer`);
      }
    }
    if ((m.delta as number) !== (m.nextRunCount as number) - (m.baseRunCount as number)) {
      throw new SniperAlphaHistoryDiffError(`blockerReasonMovement[${i}].delta must equal nextRunCount - baseRunCount`);
    }
    if ((m.delta as number) === 0) throw new SniperAlphaHistoryDiffError(`blockerReasonMovement[${i}] has a zero delta (movement-only)`);
    if (prevReason !== null && compareString(prevReason, m.reason as string) >= 0) {
      throw new SniperAlphaHistoryDiffError("blockerReasonMovement must be sorted by reason ascending and unique");
    }
    prevReason = m.reason as string;
  }

  // Phase 7 posture movement: three sorted, disjoint string lists.
  if (!isObject(value.phase7PostureMovement)) throw new SniperAlphaHistoryDiffError("phase7PostureMovement must be an object");
  for (const k of Object.keys(value.phase7PostureMovement)) {
    if (!(["added", "removed", "retained"] as readonly string[]).includes(k)) throw new SniperAlphaHistoryDiffError(`phase7PostureMovement has unknown field "${k}"`);
  }
  const postureBuckets: Record<string, string[]> = {};
  for (const k of ["added", "removed", "retained"] as const) {
    const arr = (value.phase7PostureMovement as Record<string, unknown>)[k];
    if (!Array.isArray(arr) || arr.some((s) => typeof s !== "string")) throw new SniperAlphaHistoryDiffError(`phase7PostureMovement.${k} must be an array of strings`);
    for (let i = 1; i < arr.length; i++) {
      if (compareString(arr[i - 1] as string, arr[i] as string) >= 0) throw new SniperAlphaHistoryDiffError(`phase7PostureMovement.${k} must be sorted and unique`);
    }
    postureBuckets[k] = arr as string[];
  }
  // added / removed / retained must be pairwise disjoint.
  const allPostures = [...postureBuckets.added!, ...postureBuckets.removed!, ...postureBuckets.retained!];
  if (new Set(allPostures).size !== allPostures.length) throw new SniperAlphaHistoryDiffError("phase7PostureMovement buckets must be pairwise disjoint");

  // Summary: re-derived from the run changes + identity + verdict movement.
  if (!isObject(value.summary)) throw new SniperAlphaHistoryDiffError("summary must be an object");
  for (const key of Object.keys(value.summary)) {
    if (!(EXPECTED_SUMMARY_KEYS as readonly string[]).includes(key)) throw new SniperAlphaHistoryDiffError(`summary has unknown field "${key}" (the schema is CLOSED)`);
  }
  const expectedSummary = deriveSummary(runChanges, identity, verdict);
  if (JSON.stringify(value.summary) !== JSON.stringify(expectedSummary)) {
    throw new SniperAlphaHistoryDiffError("summary must be re-derived from the run changes, run identity, and verdict movement");
  }
  if (value.summaryLine !== deriveSummaryLine(expectedSummary)) {
    throw new SniperAlphaHistoryDiffError("summaryLine must be re-derived from the summary");
  }

  // Sensitive scan literals.
  if (!isObject(value.sensitiveFieldScan)) throw new SniperAlphaHistoryDiffError("sensitiveFieldScan must be an object");
  const scan = value.sensitiveFieldScan as Record<string, unknown>;
  for (const [field, expected] of [
    ["scanned", true],
    ["signaturePresent", false],
    ["txidPresent", false],
    ["sendResultPresent", false],
    ["keyLikePresent", false],
  ] as const) {
    if (scan[field] !== expected) throw new SniperAlphaHistoryDiffError(`sensitiveFieldScan.${field} must literally be ${String(expected)}`);
  }
  for (const k of Object.keys(scan)) {
    if (!(["scanned", "signaturePresent", "txidPresent", "sendResultPresent", "keyLikePresent"] as readonly string[]).includes(k)) {
      throw new SniperAlphaHistoryDiffError(`sensitiveFieldScan has unknown field "${k}"`);
    }
  }

  if (!Array.isArray(value.caveats) || (value.caveats as unknown[]).length === 0) {
    throw new SniperAlphaHistoryDiffError("caveats must be a non-empty array");
  }

  for (const field of ["baseLiveTradingStatus", "nextLiveTradingStatus", "liveTradingStatus"] as const) {
    if (value[field] !== SNIPER_ALPHA_HISTORY_DIFF_LIVE_TRADING_STATUS) {
      throw new SniperAlphaHistoryDiffError(`${field} must literally be "${SNIPER_ALPHA_HISTORY_DIFF_LIVE_TRADING_STATUS}" — a diff can never report live enabled`);
    }
  }
  for (const [field, expected] of [
    ["authorizesLiveTrading", false],
    ["anyInputAuthorizesLiveTrading", false],
    ["redactionApplied", true],
    ["neverSends", true],
    ["phase7LiveTradingReady", false],
  ] as const) {
    if (value[field] !== expected) throw new SniperAlphaHistoryDiffError(`${field} must literally be ${String(expected)}`);
  }

  return value as unknown as SniperAlphaHistoryDiff;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperAlphaHistoryDiff}. */
export interface FormatSniperAlphaHistoryDiffOptions {
  label?: string;
  /** Cap on the number of run-change rows printed (default 100). */
  maxRows?: number;
}

/** Render a redacted, stable, human-readable diff summary. Deterministic and path-stable. */
export function formatSniperAlphaHistoryDiff(diff: SniperAlphaHistoryDiff, opts: FormatSniperAlphaHistoryDiffOptions = {}): string {
  const maxRows = opts.maxRows ?? 100;
  const header = `${diff.banner}`;
  const lines: string[] = [header, "=".repeat(Math.min(header.length, 80))];
  if (opts.label) lines.push(`label:    ${opts.label}`);
  lines.push(`id:       ${diff.diffId}`);
  lines.push(`base:     ${diff.baseHistoryId} (${diff.runIdentity.baseRunCount} runs, ${diff.runIdentity.baseTotalCandidateCount} candidates)`);
  lines.push(`next:     ${diff.nextHistoryId} (${diff.runIdentity.nextRunCount} runs, ${diff.runIdentity.nextTotalCandidateCount} candidates)`);
  lines.push(`live:     ${diff.liveTradingStatus.toUpperCase()} (authorizes live trading: ${String(diff.authorizesLiveTrading)})`);
  lines.push(`summary:  ${diff.summaryLine}`);

  lines.push("");
  lines.push("Run changes:");
  const shown = diff.runChanges.filter((c) => c.status !== "unchanged").slice(0, maxRows);
  for (const c of shown) {
    const bits: string[] = [];
    if (c.verdictCountDeltas) {
      for (const [k, v] of Object.entries(c.verdictCountDeltas)) {
        if (v !== 0) bits.push(`${k} ${v > 0 ? "+" : ""}${v}`);
      }
    }
    for (const ph of c.providerHealthChanges) bits.push(ph);
    if (c.provenanceChange) bits.push(`provenance ${c.provenanceChange}`);
    if (c.topMintChange) bits.push(`top ${c.topMintChange}`);
    lines.push(`[${c.status}] ${c.runRef}${bits.length > 0 ? `  (${bits.join("; ")})` : ""}`);
    for (const b of c.blockerReasonChanges) lines.push(`    blocker ${b}`);
  }
  if (shown.length === 0) lines.push("(no run-level changes)");

  if (diff.blockerReasonMovement.length > 0) {
    lines.push("");
    lines.push("Blocker reason movement (by run frequency):");
    for (const m of diff.blockerReasonMovement) {
      lines.push(`- ${m.reason}: ${m.baseRunCount} -> ${m.nextRunCount} (${m.delta > 0 ? "+" : ""}${m.delta} run${Math.abs(m.delta) === 1 ? "" : "s"})`);
    }
  }

  if (diff.phase7PostureMovement.added.length > 0 || diff.phase7PostureMovement.removed.length > 0) {
    lines.push("");
    lines.push("Phase 7 posture movement:");
    if (diff.phase7PostureMovement.added.length > 0) lines.push(`  appeared: ${diff.phase7PostureMovement.added.join(", ")}`);
    if (diff.phase7PostureMovement.removed.length > 0) lines.push(`  gone:     ${diff.phase7PostureMovement.removed.join(", ")}`);
  }

  lines.push("");
  lines.push("Caveats:");
  for (const c of diff.caveats) lines.push(`- ${c}`);
  lines.push("");
  for (const d of diff.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
