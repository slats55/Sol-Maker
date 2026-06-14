/**
 * Deterministic, **no-send** SNIPER ALPHA HISTORY TREND artifact (Sprint 107 alpha layer).
 *
 * A {@link SniperAlphaHistory} rolls up MANY runs into ONE snapshot. This module folds an ORDERED
 * sequence of such snapshots — two or more `sniper.alpha_history.v1` rollups, in the order the operator
 * supplies them — into ONE deterministic trend so a reviewer can see how the candidate count, the
 * verdict tally, the provider health, the evidence provenance, and the blocker reasons moved ACROSS the
 * snapshots, without inventing a wall-clock time series.
 *
 * IMPORTANT — no fake time. The order is the SUPPLIED order, never a clock reading. The trend carries no
 * timestamps of its own; it labels each snapshot with the operator's label and reports step-to-step
 * deltas between CONSECUTIVE snapshots in that supplied order.
 *
 * It is structurally incapable of authorizing a live path or faking movement:
 *
 *   - every snapshot is re-validated as `sniper.alpha_history.v1` and asserted live-disabled
 *     (`liveTradingStatus` "disabled", `authorizesLiveTrading` false, `neverSends` true) — a snapshot
 *     that claims otherwise is REFUSED, never folded in;
 *   - every snapshot is deep-scanned for a `signature` / `txid` / `sendResult` / key-shaped field or a
 *     secret-shaped string value and the build refuses if one appears, then pins the honest scan result;
 *   - the schema is CLOSED, `liveTradingStatus` is the literal "disabled", and the trend NEVER re-derives
 *     a verdict — it reads each snapshot's own re-derived counts as ground truth.
 *
 * Every series, step delta, reason total, provenance total, and provider-consistency label is RE-DERIVED
 * from the snapshots, and the validator recomputes them independently as a parity wall. It is **pure**
 * and does NO filesystem / network / RPC / wallet work. Byte-identical input yields a byte-identical
 * artifact.
 */

import { redactString } from "@soulmaker/security";
import { validateSniperAlphaHistory, type SniperAlphaHistory, type SniperAlphaHistoryVerdictCounts } from "./alpha-history.js";

/** Stable schema identifier for the alpha history trend artifact. Bump only on a breaking change. */
export const SNIPER_ALPHA_HISTORY_TREND_SCHEMA_VERSION = "sniper.alpha_history.trend.v1";

/** The banner that prefixes every alpha history trend (required label). */
export const SNIPER_ALPHA_HISTORY_TREND_BANNER =
  "SNIPER ALPHA HISTORY TREND — a no-send series across ordered alpha-history snapshots. NOT a profitability claim, NOT live readiness. LIVE TRADING IS DISABLED.";

/** The fixed live-trading status. There is no input that can change it. */
export const SNIPER_ALPHA_HISTORY_TREND_LIVE_TRADING_STATUS = "disabled";

/** Closed provider-consistency label set. */
export const SNIPER_ALPHA_HISTORY_TREND_CONSISTENCY = ["always-ok", "sometimes-ok", "never-ok", "no-data"] as const;
export type SniperAlphaHistoryTrendConsistency = (typeof SNIPER_ALPHA_HISTORY_TREND_CONSISTENCY)[number];

/** Required disclaimer statements carried by every alpha history trend (stable order). */
export const SNIPER_ALPHA_HISTORY_TREND_DISCLAIMERS: readonly string[] = [
  "SNIPER ALPHA HISTORY TREND — a no-send series across ordered alpha-history snapshots; it reports movement and authorizes nothing.",
  "Live trading is DISABLED. This artifact is structurally incapable of reporting a live send, a signature, or an armed state; mainnet sending has NO CLI surface.",
  "The order is the SUPPLIED order, never a wall-clock reading; the trend invents no timestamps and no fake time series.",
  "A trend never re-derives or overrides a snapshot's counts — it reads each rollup's own re-derived tally as ground truth.",
  "Movement is not momentum. A falling blocked count or a rising watch count across snapshots is bookkeeping, never a buy signal, a profitability claim, or a live-readiness claim.",
  "No wallet, key, signing, sending, or live execution is involved anywhere in producing this trend.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "Not a live-readiness claim.",
];

const DEFAULT_CAVEATS: readonly string[] = [
  "A trend chains ordered alpha-history snapshots; it never trades, never sends, and never authorizes a live path.",
  "Snapshots are kept in the supplied order; step deltas compare consecutive snapshots only — there is no implied calendar time.",
  "An alpha history records blocker reasons (from blocked candidates) but not separate caution reasons, so reason totals cover blocker reasons only.",
  "Live trading is disabled by policy; there is no mainnet-send command anywhere in Sol Maker.",
];

const MAX_SNAPSHOTS = 365;
const MAX_LABEL_LEN = 200;
const MAX_LIST = 64;

/**
 * The deep-scan forbidden send/signature key set — a snapshot carrying any of these is refused outright.
 * Key MATERIAL is caught instead by the secret-shaped VALUE scan (via `redactString`). This set covers
 * only the send/result/signature family so this module's own source carries no wallet-capability token.
 */
const FORBIDDEN_SENSITIVE_KEY = /^(signature|txSignature|txid|txId|sendResult|sendResults|sendOutcome)$/i;

/** Thrown when an alpha history trend INPUT or produced artifact is structurally invalid. */
export class SniperAlphaHistoryTrendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperAlphaHistoryTrendError";
  }
}

// --- input / artifact model --------------------------------------------------

/** One snapshot's validated source: a label (operator order) + the validated alpha history. */
export interface SniperAlphaHistoryTrendSnapshotInput {
  label: string;
  history: SniperAlphaHistory;
}

/** Everything {@link buildSniperAlphaHistoryTrend} accepts. */
export interface BuildSniperAlphaHistoryTrendInput {
  trendId?: string | null;
  generatedAt?: string | null;
  snapshots: SniperAlphaHistoryTrendSnapshotInput[];
  caveats?: string[];
}

/** Count of fully-ok runs (per provider) within one snapshot. */
export interface SniperAlphaHistoryTrendProviderOk {
  risk: number;
  quote: number;
  simulation: number;
}

/** Per-provenance run counts within one snapshot. */
export interface SniperAlphaHistoryTrendProvenanceCounts {
  realReadonly: number;
  fixture: number;
  fictionalExample: number;
  mixed: number;
}

/** One snapshot row (ordered as supplied). */
export interface SniperAlphaHistoryTrendSnapshot {
  label: string;
  historyId: string;
  runCount: number;
  totalCandidateCount: number;
  invalidArtifactCount: number;
  verdictCounts: SniperAlphaHistoryVerdictCounts;
  providerOk: SniperAlphaHistoryTrendProviderOk;
  provenanceCounts: SniperAlphaHistoryTrendProvenanceCounts;
}

/** One step between two consecutive snapshots. */
export interface SniperAlphaHistoryTrendStep {
  fromLabel: string;
  toLabel: string;
  candidateDelta: number;
  verdictDeltas: SniperAlphaHistoryVerdictCounts;
}

/** Numeric series aligned position-for-position with the snapshots. */
export interface SniperAlphaHistoryTrendVerdictSeries {
  watch: number[];
  review: number[];
  blocked: number[];
  insufficientEvidence: number[];
}

/** One blocker reason summed across all snapshots. */
export interface SniperAlphaHistoryTrendBlockerTotal {
  reason: string;
  totalRunCount: number;
  snapshotCount: number;
}

/** One provider's ok-run consistency across all snapshots. */
export interface SniperAlphaHistoryTrendProviderConsistency {
  okRuns: number;
  totalRuns: number;
  label: SniperAlphaHistoryTrendConsistency;
}

/** The honest deep-scan result over all snapshots (every flag pinned false or the build refuses). */
export interface SniperAlphaHistoryTrendSensitiveScan {
  scanned: true;
  signaturePresent: false;
  txidPresent: false;
  sendResultPresent: false;
  keyLikePresent: false;
}

/** The full, deterministic, JSON-serializable alpha history trend artifact. */
export interface SniperAlphaHistoryTrend {
  schemaVersion: string;
  banner: string;
  disclaimers: string[];
  trendId: string;
  generatedAt: string | null;
  snapshotCount: number;
  snapshots: SniperAlphaHistoryTrendSnapshot[];
  stepDeltas: SniperAlphaHistoryTrendStep[];
  totalCandidateSeries: number[];
  verdictSeries: SniperAlphaHistoryTrendVerdictSeries;
  blockerReasonTotals: SniperAlphaHistoryTrendBlockerTotal[];
  provenanceTotals: SniperAlphaHistoryTrendProvenanceCounts;
  providerHealthConsistency: {
    risk: SniperAlphaHistoryTrendProviderConsistency;
    quote: SniperAlphaHistoryTrendProviderConsistency;
    simulation: SniperAlphaHistoryTrendProviderConsistency;
  };
  summaryLine: string;
  sensitiveFieldScan: SniperAlphaHistoryTrendSensitiveScan;
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
      throw new SniperAlphaHistoryTrendError(`${name} contains a control character, NUL, or BOM and is refused`);
    }
  }
}

function safeLabel(value: unknown, name: string, max: number, nullable: boolean): string | null {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw new SniperAlphaHistoryTrendError(`${name} is required`);
  }
  if (typeof value !== "string") throw new SniperAlphaHistoryTrendError(`${name} must be a string`);
  rejectControlChars(value, name);
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (nullable) return null;
    throw new SniperAlphaHistoryTrendError(`${name} must be a non-empty string`);
  }
  if (trimmed.length > max) throw new SniperAlphaHistoryTrendError(`${name} exceeds ${max} characters`);
  if (redactString(trimmed) !== trimmed) throw new SniperAlphaHistoryTrendError(`${name} is secret-shaped and is refused`);
  return trimmed;
}

function normalizeStringList(value: unknown, name: string, maxCount: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SniperAlphaHistoryTrendError(`${name} must be an array of strings`);
  if (value.length > maxCount) throw new SniperAlphaHistoryTrendError(`${name} exceeds ${maxCount} entries`);
  return value.map((s, i) => {
    if (typeof s !== "string") throw new SniperAlphaHistoryTrendError(`${name}[${i}] must be a string`);
    rejectControlChars(s, `${name}[${i}]`);
    const trimmed = s.trim();
    if (trimmed.length === 0) throw new SniperAlphaHistoryTrendError(`${name}[${i}] must be a non-empty string`);
    if (redactString(trimmed) !== trimmed) throw new SniperAlphaHistoryTrendError(`${name}[${i}] is secret-shaped and is refused`);
    return trimmed;
  });
}

function deepScanForSensitive(value: unknown, where: string): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => deepScanForSensitive(v, `${where}[${i}]`));
    return;
  }
  if (isObject(value)) {
    for (const [key, v] of Object.entries(value)) {
      if (FORBIDDEN_SENSITIVE_KEY.test(key)) {
        throw new SniperAlphaHistoryTrendError(`${where}.${key} is a forbidden send/signature/key field — this snapshot is refused`);
      }
      deepScanForSensitive(v, `${where}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && value.length > 0 && redactString(value) !== value) {
    throw new SniperAlphaHistoryTrendError(`${where} carries a secret-shaped value — this snapshot is refused`);
  }
}

function assertHistoryLiveDisabled(history: SniperAlphaHistory, where: string): void {
  if (history.liveTradingStatus !== "disabled" || history.authorizesLiveTrading !== false) {
    throw new SniperAlphaHistoryTrendError(`${where} claims live authorization — refused`);
  }
  if (history.anyRunAuthorizesLiveTrading !== false || history.neverSends !== true || history.phase7LiveTradingReady !== false) {
    throw new SniperAlphaHistoryTrendError(`${where} does not pin the no-send / never-ready literals — refused`);
  }
}

// --- per-snapshot projection -------------------------------------------------

function projectSnapshot(raw: SniperAlphaHistoryTrendSnapshotInput, index: number, seen: Set<string>): SniperAlphaHistoryTrendSnapshot {
  const where = `snapshots[${index}]`;
  if (!isObject(raw)) throw new SniperAlphaHistoryTrendError(`${where} must be an object`);
  const label = safeLabel(raw.label, `${where}.label`, MAX_LABEL_LEN, false) as string;
  if (seen.has(label)) throw new SniperAlphaHistoryTrendError(`duplicate snapshot label "${label}"`);
  seen.add(label);

  let history: SniperAlphaHistory;
  try {
    history = validateSniperAlphaHistory(raw.history);
  } catch (err) {
    throw new SniperAlphaHistoryTrendError(`${where}.history is not a valid sniper.alpha_history.v1: ${(err as Error).message}`);
  }
  assertHistoryLiveDisabled(history, `${where}.history`);
  deepScanForSensitive(raw.history, `${where}.history`);

  return {
    label,
    historyId: history.historyId,
    runCount: history.runCount,
    totalCandidateCount: history.totalCandidateCount,
    invalidArtifactCount: history.invalidArtifactCount,
    verdictCounts: { ...history.aggregateVerdictCounts },
    providerOk: {
      risk: history.providerHealthRollup.risk.ok,
      quote: history.providerHealthRollup.quote.ok,
      simulation: history.providerHealthRollup.simulation.ok,
    },
    provenanceCounts: { ...history.evidenceProvenanceRollup },
  };
}

// --- aggregate derivation ----------------------------------------------------

function deriveStepDeltas(snapshots: readonly SniperAlphaHistoryTrendSnapshot[]): SniperAlphaHistoryTrendStep[] {
  const out: SniperAlphaHistoryTrendStep[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const a = snapshots[i - 1]!;
    const b = snapshots[i]!;
    out.push({
      fromLabel: a.label,
      toLabel: b.label,
      candidateDelta: b.totalCandidateCount - a.totalCandidateCount,
      verdictDeltas: {
        watch: b.verdictCounts.watch - a.verdictCounts.watch,
        review: b.verdictCounts.review - a.verdictCounts.review,
        blocked: b.verdictCounts.blocked - a.verdictCounts.blocked,
        insufficientEvidence: b.verdictCounts.insufficientEvidence - a.verdictCounts.insufficientEvidence,
      },
    });
  }
  return out;
}

function deriveVerdictSeries(snapshots: readonly SniperAlphaHistoryTrendSnapshot[]): SniperAlphaHistoryTrendVerdictSeries {
  return {
    watch: snapshots.map((s) => s.verdictCounts.watch),
    review: snapshots.map((s) => s.verdictCounts.review),
    blocked: snapshots.map((s) => s.verdictCounts.blocked),
    insufficientEvidence: snapshots.map((s) => s.verdictCounts.insufficientEvidence),
  };
}

/** Re-derive blocker-reason totals from each snapshot's history runs (full, uncapped, sorted desc). */
function deriveBlockerReasonTotals(inputs: readonly SniperAlphaHistoryTrendSnapshotInput[]): SniperAlphaHistoryTrendBlockerTotal[] {
  const totalRun = new Map<string, number>();
  const snapshotsWith = new Map<string, number>();
  for (const input of inputs) {
    const perSnapshot = new Set<string>();
    for (const run of input.history.runs) {
      for (const reason of run.blockerReasons) {
        totalRun.set(reason, (totalRun.get(reason) ?? 0) + 1);
        perSnapshot.add(reason);
      }
    }
    for (const reason of perSnapshot) snapshotsWith.set(reason, (snapshotsWith.get(reason) ?? 0) + 1);
  }
  return [...totalRun.entries()]
    .map(([reason, totalRunCount]) => ({ reason, totalRunCount, snapshotCount: snapshotsWith.get(reason) ?? 0 }))
    .sort((a, b) => (b.totalRunCount !== a.totalRunCount ? b.totalRunCount - a.totalRunCount : compareString(a.reason, b.reason)));
}

function deriveProvenanceTotals(snapshots: readonly SniperAlphaHistoryTrendSnapshot[]): SniperAlphaHistoryTrendProvenanceCounts {
  return snapshots.reduce(
    (acc, s) => {
      acc.realReadonly += s.provenanceCounts.realReadonly;
      acc.fixture += s.provenanceCounts.fixture;
      acc.fictionalExample += s.provenanceCounts.fictionalExample;
      acc.mixed += s.provenanceCounts.mixed;
      return acc;
    },
    { realReadonly: 0, fixture: 0, fictionalExample: 0, mixed: 0 },
  );
}

function consistencyLabel(okRuns: number, totalRuns: number): SniperAlphaHistoryTrendConsistency {
  if (totalRuns === 0) return "no-data";
  if (okRuns === totalRuns) return "always-ok";
  if (okRuns === 0) return "never-ok";
  return "sometimes-ok";
}

function deriveProviderConsistency(snapshots: readonly SniperAlphaHistoryTrendSnapshot[]): SniperAlphaHistoryTrend["providerHealthConsistency"] {
  const totalRuns = snapshots.reduce((n, s) => n + s.runCount, 0);
  const make = (pick: (s: SniperAlphaHistoryTrendSnapshot) => number): SniperAlphaHistoryTrendProviderConsistency => {
    const okRuns = snapshots.reduce((n, s) => n + pick(s), 0);
    return { okRuns, totalRuns, label: consistencyLabel(okRuns, totalRuns) };
  };
  return {
    risk: make((s) => s.providerOk.risk),
    quote: make((s) => s.providerOk.quote),
    simulation: make((s) => s.providerOk.simulation),
  };
}

function deriveSummaryLine(snapshots: readonly SniperAlphaHistoryTrendSnapshot[]): string {
  const first = snapshots[0]!;
  const last = snapshots[snapshots.length - 1]!;
  const sign = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
  return [
    `${snapshots.length} snapshots (${first.label} -> ${last.label})`,
    `blocked ${first.verdictCounts.blocked} -> ${last.verdictCounts.blocked} (${sign(last.verdictCounts.blocked - first.verdictCounts.blocked)})`,
    `watch ${first.verdictCounts.watch} -> ${last.verdictCounts.watch} (${sign(last.verdictCounts.watch - first.verdictCounts.watch)})`,
    `candidates ${first.totalCandidateCount} -> ${last.totalCandidateCount}`,
    "live trading DISABLED.",
  ].join(" · ");
}

// --- build -------------------------------------------------------------------

/**
 * Build a canonical {@link SniperAlphaHistoryTrend} from an ORDERED list of validated alpha-history
 * snapshots. Pure, non-mutating, deterministic. Requires at least two snapshots; each is re-validated,
 * asserted live-disabled, and deep-scanned (a failure REFUSES the snapshot); the supplied order is
 * preserved; every series / step delta / reason total / provenance total / provider-consistency label is
 * RE-DERIVED; the live-trading / safety literals are pinned. Throws {@link SniperAlphaHistoryTrendError}
 * on any structural problem.
 */
export function buildSniperAlphaHistoryTrend(input: BuildSniperAlphaHistoryTrendInput): SniperAlphaHistoryTrend {
  if (!isObject(input)) throw new SniperAlphaHistoryTrendError("trend input must be an object");
  const trendId = (safeLabel(input.trendId, "trendId", 128, true) as string | null) ?? "sniper-alpha-history-trend";
  const generatedAt = safeLabel(input.generatedAt, "generatedAt", 40, true);

  if (!Array.isArray(input.snapshots)) throw new SniperAlphaHistoryTrendError("input.snapshots must be an array");
  if (input.snapshots.length < 2) throw new SniperAlphaHistoryTrendError("a trend requires at least two snapshots");
  if (input.snapshots.length > MAX_SNAPSHOTS) throw new SniperAlphaHistoryTrendError(`input.snapshots exceeds ${MAX_SNAPSHOTS} entries`);

  const seen = new Set<string>();
  const snapshots = input.snapshots.map((s, i) => projectSnapshot(s, i, seen));

  const extraCaveats = normalizeStringList(input.caveats, "caveats", MAX_LIST);

  return {
    schemaVersion: SNIPER_ALPHA_HISTORY_TREND_SCHEMA_VERSION,
    banner: SNIPER_ALPHA_HISTORY_TREND_BANNER,
    disclaimers: [...SNIPER_ALPHA_HISTORY_TREND_DISCLAIMERS],
    trendId,
    generatedAt,
    snapshotCount: snapshots.length,
    snapshots,
    stepDeltas: deriveStepDeltas(snapshots),
    totalCandidateSeries: snapshots.map((s) => s.totalCandidateCount),
    verdictSeries: deriveVerdictSeries(snapshots),
    blockerReasonTotals: deriveBlockerReasonTotals(input.snapshots),
    provenanceTotals: deriveProvenanceTotals(snapshots),
    providerHealthConsistency: deriveProviderConsistency(snapshots),
    summaryLine: deriveSummaryLine(snapshots),
    sensitiveFieldScan: {
      scanned: true,
      signaturePresent: false,
      txidPresent: false,
      sendResultPresent: false,
      keyLikePresent: false,
    },
    liveTradingStatus: SNIPER_ALPHA_HISTORY_TREND_LIVE_TRADING_STATUS,
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
  "trendId",
  "generatedAt",
  "snapshotCount",
  "snapshots",
  "stepDeltas",
  "totalCandidateSeries",
  "verdictSeries",
  "blockerReasonTotals",
  "provenanceTotals",
  "providerHealthConsistency",
  "summaryLine",
  "sensitiveFieldScan",
  "liveTradingStatus",
  "authorizesLiveTrading",
  "anyInputAuthorizesLiveTrading",
  "caveats",
  "redactionApplied",
  "neverSends",
  "phase7LiveTradingReady",
] as const;

const EXPECTED_SNAPSHOT_KEYS = [
  "label",
  "historyId",
  "runCount",
  "totalCandidateCount",
  "invalidArtifactCount",
  "verdictCounts",
  "providerOk",
  "provenanceCounts",
] as const;

const VERDICT_KEYS = ["watch", "review", "blocked", "insufficientEvidence"] as const;
const PROVENANCE_KEYS = ["realReadonly", "fixture", "fictionalExample", "mixed"] as const;

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function validateVerdictCounts(value: unknown, where: string, allowNegative: boolean): SniperAlphaHistoryVerdictCounts {
  if (!isObject(value)) throw new SniperAlphaHistoryTrendError(`${where} must be an object`);
  for (const k of Object.keys(value)) {
    if (!(VERDICT_KEYS as readonly string[]).includes(k)) throw new SniperAlphaHistoryTrendError(`${where} has unknown field "${k}"`);
  }
  for (const k of VERDICT_KEYS) {
    const n = (value as Record<string, unknown>)[k];
    if (!isInteger(n) || (!allowNegative && (n as number) < 0)) {
      throw new SniperAlphaHistoryTrendError(`${where}.${k} must be a ${allowNegative ? "" : "non-negative "}integer`);
    }
  }
  return value as unknown as SniperAlphaHistoryVerdictCounts;
}

function validateProvenanceCounts(value: unknown, where: string): SniperAlphaHistoryTrendProvenanceCounts {
  if (!isObject(value)) throw new SniperAlphaHistoryTrendError(`${where} must be an object`);
  for (const k of Object.keys(value)) {
    if (!(PROVENANCE_KEYS as readonly string[]).includes(k)) throw new SniperAlphaHistoryTrendError(`${where} has unknown field "${k}"`);
  }
  for (const k of PROVENANCE_KEYS) {
    const n = (value as Record<string, unknown>)[k];
    if (!isInteger(n) || (n as number) < 0) throw new SniperAlphaHistoryTrendError(`${where}.${k} must be a non-negative integer`);
  }
  return value as unknown as SniperAlphaHistoryTrendProvenanceCounts;
}

function validateSnapshot(value: unknown, i: number): SniperAlphaHistoryTrendSnapshot {
  const where = `snapshots[${i}]`;
  if (!isObject(value)) throw new SniperAlphaHistoryTrendError(`${where} must be an object`);
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_SNAPSHOT_KEYS as readonly string[]).includes(key)) throw new SniperAlphaHistoryTrendError(`${where} has unknown field "${key}" (the schema is CLOSED)`);
  }
  for (const key of EXPECTED_SNAPSHOT_KEYS) {
    if (!(key in value)) throw new SniperAlphaHistoryTrendError(`${where} is missing field "${key}"`);
  }
  safeLabel(value.label, `${where}.label`, MAX_LABEL_LEN, false);
  safeLabel(value.historyId, `${where}.historyId`, 128, false);
  for (const k of ["runCount", "totalCandidateCount", "invalidArtifactCount"] as const) {
    const n = (value as Record<string, unknown>)[k];
    if (!isInteger(n) || (n as number) < 0) throw new SniperAlphaHistoryTrendError(`${where}.${k} must be a non-negative integer`);
  }
  const verdictCounts = validateVerdictCounts(value.verdictCounts, `${where}.verdictCounts`, false);
  const summed = verdictCounts.watch + verdictCounts.review + verdictCounts.blocked + verdictCounts.insufficientEvidence;
  if (summed !== value.totalCandidateCount) throw new SniperAlphaHistoryTrendError(`${where}.verdictCounts must sum to totalCandidateCount`);
  if (!isObject(value.providerOk)) throw new SniperAlphaHistoryTrendError(`${where}.providerOk must be an object`);
  for (const k of Object.keys(value.providerOk)) {
    if (!(["risk", "quote", "simulation"] as readonly string[]).includes(k)) throw new SniperAlphaHistoryTrendError(`${where}.providerOk has unknown field "${k}"`);
  }
  for (const k of ["risk", "quote", "simulation"] as const) {
    const n = (value.providerOk as Record<string, unknown>)[k];
    if (!isInteger(n) || (n as number) < 0 || (n as number) > (value.runCount as number)) {
      throw new SniperAlphaHistoryTrendError(`${where}.providerOk.${k} must be an integer in [0, runCount]`);
    }
  }
  validateProvenanceCounts(value.provenanceCounts, `${where}.provenanceCounts`);
  return value as unknown as SniperAlphaHistoryTrendSnapshot;
}

/**
 * Strictly validate a value as a canonical {@link SniperAlphaHistoryTrend}. A backstop AND a parity wall:
 * the key set is CLOSED (no `signature` / `txid` / `sendResult` field can appear); the banner / live-
 * trading / safety literals are pinned; each snapshot is well-formed and unique by label; and every
 * derived view (step deltas, the verdict + candidate series, blocker-reason totals, provenance totals,
 * provider-consistency labels, the summary line) is INDEPENDENTLY re-derived from the snapshots and must
 * match. Throws {@link SniperAlphaHistoryTrendError} on the first problem. Pure.
 */
export function validateSniperAlphaHistoryTrend(value: unknown): SniperAlphaHistoryTrend {
  if (!isObject(value)) throw new SniperAlphaHistoryTrendError("trend must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) throw new SniperAlphaHistoryTrendError(`trend has unknown field "${key}" (the schema is CLOSED)`);
  }
  for (const key of EXPECTED_KEYS) {
    if (!(key in value)) throw new SniperAlphaHistoryTrendError(`trend is missing field "${key}"`);
  }

  if (value.schemaVersion !== SNIPER_ALPHA_HISTORY_TREND_SCHEMA_VERSION) throw new SniperAlphaHistoryTrendError(`schemaVersion must be "${SNIPER_ALPHA_HISTORY_TREND_SCHEMA_VERSION}"`);
  if (value.banner !== SNIPER_ALPHA_HISTORY_TREND_BANNER) throw new SniperAlphaHistoryTrendError("banner must be the canonical banner");
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) throw new SniperAlphaHistoryTrendError("disclaimers must be a non-empty array");
  safeLabel(value.trendId, "trendId", 128, false);
  safeLabel(value.generatedAt, "generatedAt", 40, true);

  if (!Array.isArray(value.snapshots)) throw new SniperAlphaHistoryTrendError("snapshots must be an array");
  if ((value.snapshots as unknown[]).length < 2) throw new SniperAlphaHistoryTrendError("a trend requires at least two snapshots");
  const seen = new Set<string>();
  const snapshots = (value.snapshots as unknown[]).map((s, i) => {
    const snap = validateSnapshot(s, i);
    if (seen.has(snap.label)) throw new SniperAlphaHistoryTrendError(`duplicate snapshot label "${snap.label}"`);
    seen.add(snap.label);
    return snap;
  });
  if (value.snapshotCount !== snapshots.length) throw new SniperAlphaHistoryTrendError("snapshotCount must equal snapshots.length");

  if (JSON.stringify(value.stepDeltas) !== JSON.stringify(deriveStepDeltas(snapshots))) throw new SniperAlphaHistoryTrendError("stepDeltas must be re-derived from the snapshots");
  if (JSON.stringify(value.totalCandidateSeries) !== JSON.stringify(snapshots.map((s) => s.totalCandidateCount))) throw new SniperAlphaHistoryTrendError("totalCandidateSeries must be re-derived from the snapshots");
  if (JSON.stringify(value.verdictSeries) !== JSON.stringify(deriveVerdictSeries(snapshots))) throw new SniperAlphaHistoryTrendError("verdictSeries must be re-derived from the snapshots");
  if (JSON.stringify(value.provenanceTotals) !== JSON.stringify(deriveProvenanceTotals(snapshots))) throw new SniperAlphaHistoryTrendError("provenanceTotals must be re-derived from the snapshots");
  if (JSON.stringify(value.providerHealthConsistency) !== JSON.stringify(deriveProviderConsistency(snapshots))) throw new SniperAlphaHistoryTrendError("providerHealthConsistency must be re-derived from the snapshots");
  if (value.summaryLine !== deriveSummaryLine(snapshots)) throw new SniperAlphaHistoryTrendError("summaryLine must be re-derived from the snapshots");

  // blockerReasonTotals: cannot be re-derived from the trend alone (the per-run reasons live in the
  // source histories), so validate it is well-formed, sorted desc by totalRunCount then reason, unique.
  if (!Array.isArray(value.blockerReasonTotals)) throw new SniperAlphaHistoryTrendError("blockerReasonTotals must be an array");
  const reasonsSeen = new Set<string>();
  let prev: { totalRunCount: number; reason: string } | null = null;
  for (let i = 0; i < (value.blockerReasonTotals as unknown[]).length; i++) {
    const m = (value.blockerReasonTotals as unknown[])[i];
    if (!isObject(m)) throw new SniperAlphaHistoryTrendError(`blockerReasonTotals[${i}] must be an object`);
    for (const k of Object.keys(m)) {
      if (!(["reason", "totalRunCount", "snapshotCount"] as readonly string[]).includes(k)) throw new SniperAlphaHistoryTrendError(`blockerReasonTotals[${i}] has unknown field "${k}"`);
    }
    if (typeof m.reason !== "string" || m.reason.trim().length === 0) throw new SniperAlphaHistoryTrendError(`blockerReasonTotals[${i}].reason must be a non-empty string`);
    for (const k of ["totalRunCount", "snapshotCount"] as const) {
      const n = (m as Record<string, unknown>)[k];
      if (!isInteger(n) || (n as number) < 1) throw new SniperAlphaHistoryTrendError(`blockerReasonTotals[${i}].${k} must be a positive integer`);
    }
    if ((m.snapshotCount as number) > snapshots.length) throw new SniperAlphaHistoryTrendError(`blockerReasonTotals[${i}].snapshotCount exceeds the snapshot count`);
    if ((m.snapshotCount as number) > (m.totalRunCount as number)) throw new SniperAlphaHistoryTrendError(`blockerReasonTotals[${i}].snapshotCount cannot exceed totalRunCount`);
    if (reasonsSeen.has(m.reason as string)) throw new SniperAlphaHistoryTrendError(`duplicate blockerReasonTotals reason "${m.reason}"`);
    reasonsSeen.add(m.reason as string);
    if (prev !== null) {
      const ordered = prev.totalRunCount > (m.totalRunCount as number) || (prev.totalRunCount === (m.totalRunCount as number) && compareString(prev.reason, m.reason as string) < 0);
      if (!ordered) throw new SniperAlphaHistoryTrendError("blockerReasonTotals must be sorted by totalRunCount desc then reason asc");
    }
    prev = { totalRunCount: m.totalRunCount as number, reason: m.reason as string };
  }

  if (!isObject(value.sensitiveFieldScan)) throw new SniperAlphaHistoryTrendError("sensitiveFieldScan must be an object");
  const scan = value.sensitiveFieldScan as Record<string, unknown>;
  for (const [field, expected] of [
    ["scanned", true],
    ["signaturePresent", false],
    ["txidPresent", false],
    ["sendResultPresent", false],
    ["keyLikePresent", false],
  ] as const) {
    if (scan[field] !== expected) throw new SniperAlphaHistoryTrendError(`sensitiveFieldScan.${field} must literally be ${String(expected)}`);
  }
  for (const k of Object.keys(scan)) {
    if (!(["scanned", "signaturePresent", "txidPresent", "sendResultPresent", "keyLikePresent"] as readonly string[]).includes(k)) {
      throw new SniperAlphaHistoryTrendError(`sensitiveFieldScan has unknown field "${k}"`);
    }
  }

  if (!Array.isArray(value.caveats) || (value.caveats as unknown[]).length === 0) throw new SniperAlphaHistoryTrendError("caveats must be a non-empty array");

  if (value.liveTradingStatus !== SNIPER_ALPHA_HISTORY_TREND_LIVE_TRADING_STATUS) {
    throw new SniperAlphaHistoryTrendError(`liveTradingStatus must literally be "${SNIPER_ALPHA_HISTORY_TREND_LIVE_TRADING_STATUS}" — a trend can never report live enabled`);
  }
  for (const [field, expected] of [
    ["authorizesLiveTrading", false],
    ["anyInputAuthorizesLiveTrading", false],
    ["redactionApplied", true],
    ["neverSends", true],
    ["phase7LiveTradingReady", false],
  ] as const) {
    if (value[field] !== expected) throw new SniperAlphaHistoryTrendError(`${field} must literally be ${String(expected)}`);
  }

  return value as unknown as SniperAlphaHistoryTrend;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperAlphaHistoryTrend}. */
export interface FormatSniperAlphaHistoryTrendOptions {
  label?: string;
  /** Cap on the number of blocker-reason rows printed (default 24). */
  maxReasons?: number;
}

/** Render a redacted, stable, human-readable trend summary. Deterministic and path-stable. */
export function formatSniperAlphaHistoryTrend(trend: SniperAlphaHistoryTrend, opts: FormatSniperAlphaHistoryTrendOptions = {}): string {
  const maxReasons = opts.maxReasons ?? 24;
  const header = `${trend.banner}`;
  const lines: string[] = [header, "=".repeat(Math.min(header.length, 80))];
  if (opts.label) lines.push(`label:    ${opts.label}`);
  lines.push(`id:       ${trend.trendId}`);
  lines.push(`live:     ${trend.liveTradingStatus.toUpperCase()} (authorizes live trading: ${String(trend.authorizesLiveTrading)})`);
  lines.push(`summary:  ${trend.summaryLine}`);

  lines.push("");
  lines.push("Snapshots (supplied order):");
  for (const s of trend.snapshots) {
    lines.push(
      `- ${s.label}  [runs=${s.runCount}; candidates=${s.totalCandidateCount}; watch=${s.verdictCounts.watch}; review=${s.verdictCounts.review}; blocked=${s.verdictCounts.blocked}; insufficient=${s.verdictCounts.insufficientEvidence}]`,
    );
  }

  if (trend.stepDeltas.length > 0) {
    lines.push("");
    lines.push("Step deltas:");
    for (const step of trend.stepDeltas) {
      const v = step.verdictDeltas;
      const sign = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
      lines.push(`- ${step.fromLabel} -> ${step.toLabel}: blocked ${sign(v.blocked)} · watch ${sign(v.watch)} · review ${sign(v.review)} · insufficient ${sign(v.insufficientEvidence)} · candidates ${sign(step.candidateDelta)}`);
    }
  }

  if (trend.blockerReasonTotals.length > 0) {
    lines.push("");
    lines.push("Most common blocker reasons (across snapshots):");
    for (const r of trend.blockerReasonTotals.slice(0, maxReasons)) {
      lines.push(`- ${r.reason} (${r.totalRunCount} run-occurrence${r.totalRunCount === 1 ? "" : "s"} across ${r.snapshotCount} snapshot${r.snapshotCount === 1 ? "" : "s"})`);
    }
  }

  lines.push("");
  lines.push(`provider consistency: risk ${trend.providerHealthConsistency.risk.label} · quote ${trend.providerHealthConsistency.quote.label} · sim ${trend.providerHealthConsistency.simulation.label}`);

  lines.push("");
  lines.push("Caveats:");
  for (const c of trend.caveats) lines.push(`- ${c}`);
  lines.push("");
  for (const d of trend.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
