/**
 * Deterministic, offline, **simulated-only** RESEARCH CAMPAIGN HISTORY REPORT (Sprint 20).
 *
 * Sprint 18 indexed MANY research runs under one campaign directory into a single comparable
 * campaign index. Sprint 19 diffed TWO campaign indexes ("what changed between two campaigns, and
 * did it break integrity?"). Sprint 20 sits one level higher in TIME: it folds an ORDERED SEQUENCE
 * of campaign index snapshots into one stable trend report, answering campaign-history questions at
 * a glance:
 *
 *   - Which runs first appeared, and which disappeared?
 *   - Which runs changed over time (since baseline, since the previous snapshot)?
 *   - Which runs newly regressed, and which recovered?
 *   - Which runs need attention now, and which have ever needed it?
 *   - Which runs have the longest current valid streak / attention streak?
 *   - Is there any CONSERVATIVE regression signal suitable for CI failure?
 *
 * It is **pure** and does NO filesystem/network IO of its own: like the index/diff builders it
 * accepts ALREADY-LOADED snapshots (the CLI reads the ordered campaign index JSON files and hands
 * the parsed values here). Each snapshot is strictly validated as a Sprint 18
 * `backtest.research.campaign.index.v1` via {@link validateBacktestResearchCampaignIndex} (so a
 * non-index / wrong-schema input is REFUSED, never silently mis-read). Per-run trajectories are
 * walked across the ordered snapshots; the "since baseline" and "since previous snapshot" deltas
 * REUSE the Sprint 19 {@link diffBacktestResearchCampaignIndexes} verbatim, so the change and the
 * CONSERVATIVE regression semantics are byte-identical to the diff — never re-implemented or
 * over-claimed. The report carries NO wall-clock timestamp, so an identical ordered set of
 * snapshots yields a byte-identical history report.
 *
 * This is bookkeeping over injected, simulated local summaries — NOT a live result, NOT real market
 * data, NOT advice, and NOT a profitability claim. Nothing here holds a key, or builds/signs/
 * simulates/sends a transaction. The conservative regression flag is an integrity/reproducibility
 * signal only, never a trading recommendation.
 */

import { redactString } from "@soulmaker/security";
import {
  validateBacktestResearchCampaignIndex,
  type BacktestResearchCampaignIndex,
  type BacktestResearchCampaignRunSummary,
} from "./research-campaign-index.js";
import {
  diffBacktestResearchCampaignIndexes,
  type BacktestResearchCampaignIndexDiff,
} from "./research-campaign-index-diff.js";

/** Stable schema identifier for the history report. Bump only on a breaking change. */
export const BACKTEST_RESEARCH_CAMPAIGN_HISTORY_REPORT_SCHEMA_VERSION =
  "backtest.research.campaign.history.report.v1";

/** The banner that prefixes every history report (required label). */
export const BACKTEST_RESEARCH_CAMPAIGN_HISTORY_REPORT_BANNER =
  "SIMULATED PAPER-ONLY RESEARCH CAMPAIGN HISTORY REPORT";

/** Required disclaimer statements carried by every history report (stable order). */
export const BACKTEST_RESEARCH_CAMPAIGN_HISTORY_REPORT_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY RESEARCH CAMPAIGN HISTORY REPORT — a deterministic trend summary of LOCAL campaign index snapshots.",
  "Summarizes an ordered set of local campaign index snapshots only — it embeds no artifact contents, is not live data, and fetched nothing.",
  "Change and conservative-regression signals reuse the Sprint 19 campaign-diff semantics; the conservative regression flag is integrity-only and is NOT financial advice.",
  "Reproducibility digests are non-cryptographic content fingerprints, NOT a security or anti-tamper guarantee.",
  "Not a live result.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this report.",
];

/** Thrown only when history INPUT or a produced history report is structurally invalid. */
export class BacktestResearchCampaignHistoryReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestResearchCampaignHistoryReportError";
  }
}

// --- input -------------------------------------------------------------------

/** Which snapshot the "since baseline" deltas compare the latest snapshot against. */
export type BacktestResearchCampaignHistoryBaselineSelector =
  | "first"
  | "previous"
  | { snapshotId: string };

/** One already-loaded, ordered campaign index snapshot (the CLI reads these in order). */
export interface BacktestResearchCampaignHistorySnapshotInput {
  /** Stable identifier for this snapshot — defaults to a positional `snapshot-<i>`. Unique. */
  snapshotId?: string;
  /** An already-parsed value expected to be a Sprint 18 campaign index (strictly validated). */
  index: unknown;
}

/** Everything {@link buildBacktestResearchCampaignHistoryReport} needs (ordered snapshots). */
export interface BuildBacktestResearchCampaignHistoryReportInput {
  /** Optional campaign label (e.g. the campaign directory name). */
  campaignName?: string;
  /** The ordered campaign index snapshots (oldest first, latest last). At least one. */
  snapshots: BacktestResearchCampaignHistorySnapshotInput[];
  /** How to choose the baseline for "since baseline" deltas (default `"first"`). */
  baseline?: BacktestResearchCampaignHistoryBaselineSelector;
}

// --- report model ------------------------------------------------------------

/** How the baseline snapshot was selected (recorded honestly in the report). */
export type BacktestResearchCampaignHistoryBaselineKind = "first" | "previous" | "explicit";

/** One run's deterministic trajectory across the ordered snapshots. */
export interface BacktestResearchCampaignHistoryRunSummary {
  runId: string;
  /** snapshotId of the first (oldest) snapshot that contains this run. */
  firstSeenSnapshot: string;
  /** snapshotId of the last (most recent) snapshot that contains this run. */
  lastSeenSnapshot: string;
  /** Present in the latest snapshot. */
  currentlyPresent: boolean;
  /** valid in the latest snapshot, or null when absent from it. */
  currentlyValid: boolean | null;
  /** present AND not valid in the latest snapshot, or null when absent from it. */
  currentlyNeedsAttention: boolean | null;
  /** Was present-and-invalid in ANY snapshot. */
  everNeedsAttention: boolean;
  /** Needs attention in latest but did NOT at baseline (mirrors diff.newlyNeedsAttention). */
  newlyNeedsAttentionSinceBaseline: boolean;
  /** Needed attention at baseline but does NOT in latest (mirrors diff.noLongerNeedsAttention). */
  recoveredSinceBaseline: boolean;
  /** Differs between baseline and latest (added, removed, or a paired changed run). */
  changedSinceBaseline: boolean;
  /** Differs between the previous snapshot and latest (added, removed, or paired changed). */
  changedSincePrevious: boolean;
  /** Number of run-digest changes across consecutive snapshots where the run was present in both. */
  digestChangeCount: number;
  /** Consecutive most-recent snapshots in which the run was present AND valid (0 if latest is not). */
  validStreak: number;
  /** Consecutive most-recent snapshots in which the run was present AND needs attention (0 if not). */
  attentionStreak: number;
  /**
   * Conservative, integrity-only regression since baseline for THIS run — true iff the Sprint 19
   * campaign diff attributes a regression to it: a previously-valid run removed, a paired run that
   * became invalid or changed run digest, or a paired run whose unknown/malformed count increased.
   */
  conservativeRegression: boolean;
}

/**
 * The full, deterministic, byte-stable research campaign history report. JSON-serializable as-is.
 * Carries the required PAPER-ONLY / local-snapshots-only / not-a-live-result / not-advice language
 * and the honest non-cryptographic-digest label so they survive serialization.
 */
export interface BacktestResearchCampaignHistoryReport {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  campaignName: string | null;
  // --- input summary ---
  snapshotCount: number;
  /** Ordered snapshot identifiers (oldest first, latest last). */
  snapshotIds: string[];
  baselineSnapshotId: string;
  latestSnapshotId: string;
  /** Second-to-last snapshot id, or null when there is only one snapshot. */
  previousSnapshotId: string | null;
  baselineSelector: BacktestResearchCampaignHistoryBaselineKind;
  // --- aggregate summary ---
  totalRunsObserved: number;
  runsCurrentlyPresent: number;
  runsCurrentlyValid: number;
  runsCurrentlyNeedingAttention: number;
  runsEverNeedingAttention: number;
  runsNewlyNeedingAttentionSinceBaseline: number;
  runsRecoveredSinceBaseline: number;
  runsAddedSinceBaseline: number;
  runsRemovedSinceBaseline: number;
  /** Paired runs (present in both baseline and latest) whose digest/validity/counts changed. */
  changedRunCountSinceBaseline: number;
  /** Paired runs (present in both previous and latest) whose digest/validity/counts changed. */
  changedRunCountSincePrevious: number;
  // --- streak leaders ---
  longestValidStreak: number;
  runsWithLongestValidStreak: string[];
  longestAttentionStreak: number;
  runsWithLongestAttentionStreak: string[];
  // --- per-run + rollups ---
  runs: BacktestResearchCampaignHistoryRunSummary[];
  /** Run ids needing attention in the latest snapshot, sorted ascending. */
  runsNeedingAttentionNow: string[];
  /**
   * Run ids the baseline→latest diff attributes a conservative regression to, sorted ascending.
   * This is per-run attribution only: `hasRegression` can still be true with this list EMPTY when
   * the regression is an aggregate-level signal not pinned to one run (e.g. a NEW invalid run raised
   * the total unknown/malformed count, or an incompatible campaign schema) — see `regressionReasons`.
   */
  runsWithConservativeRegression: string[];
  // --- CI flags ---
  /** Any change since baseline (mirrors the Sprint 19 diff.hasChange). */
  hasChange: boolean;
  /** A conservative integrity regression since baseline (mirrors the Sprint 19 diff.hasRegression). */
  hasRegression: boolean;
  /** Any run currently needs attention in the latest snapshot. */
  hasAttention: boolean;
  /** Any run newly needs attention since baseline. */
  hasNewAttentionSinceBaseline: boolean;
  /** Change reasons since baseline (verbatim from the Sprint 19 diff). */
  changeReasons: string[];
  /** Conservative regression reasons since baseline (verbatim from the Sprint 19 diff). */
  regressionReasons: string[];
  /** Reproducibility-only warnings (single snapshot, regression, attention, …). */
  warnings: string[];
  /** Bookkeeping-only notes. */
  notes: string[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const BASELINE_KINDS = new Set<string>(["first", "previous", "explicit"]);

/** One validated snapshot plus its assigned id and a runId → summary lookup. */
interface ReadSnapshot {
  snapshotId: string;
  index: BacktestResearchCampaignIndex;
  runs: Map<string, BacktestResearchCampaignRunSummary>;
}

/** Strictly read + validate one snapshot input into a {@link ReadSnapshot}. */
function readSnapshot(
  snapshot: unknown,
  position: number,
  seenIds: Set<string>,
): ReadSnapshot {
  if (!isObject(snapshot)) {
    throw new BacktestResearchCampaignHistoryReportError(`snapshots[${position}] must be an object`);
  }
  if (snapshot.snapshotId !== undefined && !nonEmptyString(snapshot.snapshotId)) {
    throw new BacktestResearchCampaignHistoryReportError(
      `snapshots[${position}].snapshotId must be a non-empty string when present`,
    );
  }
  const snapshotId = nonEmptyString(snapshot.snapshotId) ? snapshot.snapshotId : `snapshot-${position}`;
  if (seenIds.has(snapshotId)) {
    throw new BacktestResearchCampaignHistoryReportError(`duplicate snapshotId "${snapshotId}"`);
  }
  seenIds.add(snapshotId);

  let index: BacktestResearchCampaignIndex;
  try {
    index = validateBacktestResearchCampaignIndex(snapshot.index);
  } catch (err) {
    throw new BacktestResearchCampaignHistoryReportError(
      `snapshots[${position}] (${snapshotId}) is not a valid campaign index: ${(err as Error).message}`,
    );
  }
  const runs = new Map<string, BacktestResearchCampaignRunSummary>();
  for (const run of index.runs) runs.set(run.runId, run);
  return { snapshotId, index, runs };
}

/** Resolve the baseline snapshot index from the selector (default "first"). */
function resolveBaseline(
  snapshots: ReadSnapshot[],
  selector: BacktestResearchCampaignHistoryBaselineSelector | undefined,
): { index: number; kind: BacktestResearchCampaignHistoryBaselineKind } {
  const last = snapshots.length - 1;
  if (selector === undefined || selector === "first") return { index: 0, kind: "first" };
  if (selector === "previous") return { index: last >= 1 ? last - 1 : 0, kind: "previous" };
  if (isObject(selector) && nonEmptyString(selector.snapshotId)) {
    const found = snapshots.findIndex((s) => s.snapshotId === selector.snapshotId);
    if (found < 0) {
      throw new BacktestResearchCampaignHistoryReportError(
        `baseline snapshotId "${selector.snapshotId}" is not among the supplied snapshots`,
      );
    }
    return { index: found, kind: "explicit" };
  }
  throw new BacktestResearchCampaignHistoryReportError(
    'baseline must be "first", "previous", or { snapshotId }',
  );
}

/** The set of runIds the diff considers "different" between its two campaigns (added/removed/changed). */
function changedRunIds(diff: BacktestResearchCampaignIndexDiff): Set<string> {
  const ids = new Set<string>();
  for (const r of diff.addedRuns) ids.add(r.runId);
  for (const r of diff.removedRuns) ids.add(r.runId);
  for (const c of diff.changedRuns) ids.add(c.runId);
  return ids;
}

/** The set of runIds the diff attributes a CONSERVATIVE regression to (integrity breakage only). */
function regressionRunIds(diff: BacktestResearchCampaignIndexDiff): Set<string> {
  const ids = new Set<string>();
  for (const r of diff.removedRuns) if (r.valid) ids.add(r.runId); // previously-valid run removed
  for (const c of diff.changedRuns) {
    if (
      c.becameInvalid ||
      c.runDigestChanged ||
      c.unknownArtifactCount.delta > 0 ||
      c.malformedArtifactCount.delta > 0
    ) {
      ids.add(c.runId);
    }
  }
  return ids;
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic, byte-stable {@link BacktestResearchCampaignHistoryReport} from an ordered
 * list of already-loaded campaign index snapshots. Pure and non-mutating. Each snapshot is strictly
 * validated as a Sprint 18 campaign index (a non-index / wrong-schema input throws); per-run
 * trajectories are walked across the ordered snapshots; the "since baseline" / "since previous"
 * deltas reuse {@link diffBacktestResearchCampaignIndexes} verbatim. Throws
 * {@link BacktestResearchCampaignHistoryReportError} on structurally invalid input, an empty
 * snapshot list, a duplicate snapshotId, or an unresolvable baseline.
 */
export function buildBacktestResearchCampaignHistoryReport(
  input: BuildBacktestResearchCampaignHistoryReportInput,
): BacktestResearchCampaignHistoryReport {
  if (!isObject(input)) {
    throw new BacktestResearchCampaignHistoryReportError("history input must be an object");
  }
  if (input.campaignName !== undefined && typeof input.campaignName !== "string") {
    throw new BacktestResearchCampaignHistoryReportError(
      "history input.campaignName must be a string when present",
    );
  }
  if (!Array.isArray(input.snapshots)) {
    throw new BacktestResearchCampaignHistoryReportError("history input.snapshots must be an array");
  }
  if (input.snapshots.length === 0) {
    throw new BacktestResearchCampaignHistoryReportError(
      "history input.snapshots must contain at least one snapshot",
    );
  }

  const seenIds = new Set<string>();
  const snapshots = input.snapshots.map((s, i) => readSnapshot(s, i, seenIds));
  const n = snapshots.length;
  const latest = snapshots[n - 1]!;
  const previousIndex = n >= 2 ? n - 2 : 0;
  const { index: baselineIndex, kind: baselineSelector } = resolveBaseline(snapshots, input.baseline);

  const snapshotIds = snapshots.map((s) => s.snapshotId);
  const baselineSnapshotId = snapshots[baselineIndex]!.snapshotId;
  const latestSnapshotId = latest.snapshotId;
  const previousSnapshotId = n >= 2 ? snapshots[previousIndex]!.snapshotId : null;

  // Reuse the Sprint 19 diff verbatim for the two reference comparisons. When the baseline / previous
  // resolves to the latest snapshot itself (e.g. a single snapshot), the diff is index-vs-itself and
  // honestly reports no change and no regression.
  const sinceBaseline = diffBacktestResearchCampaignIndexes(
    snapshots[baselineIndex]!.index,
    latest.index,
  );
  const sincePrevious = diffBacktestResearchCampaignIndexes(
    snapshots[previousIndex]!.index,
    latest.index,
  );

  const newlyAttnBaseline = new Set(sinceBaseline.newlyNeedsAttention);
  const recoveredBaseline = new Set(sinceBaseline.noLongerNeedsAttention);
  const changedBaseline = changedRunIds(sinceBaseline);
  const changedPrevious = changedRunIds(sincePrevious);
  const regressionBaseline = regressionRunIds(sinceBaseline);

  // Union of every runId ever observed, sorted ascending for a stable per-run table.
  const allRunIds = [...new Set(snapshots.flatMap((s) => [...s.runs.keys()]))].sort(compareString);

  const runs: BacktestResearchCampaignHistoryRunSummary[] = allRunIds.map((runId) => {
    let firstSeen = -1;
    let lastSeen = -1;
    let everNeedsAttention = false;
    let digestChangeCount = 0;
    let prevPresentDigest: { digest: string | null } | null = null;
    for (let i = 0; i < n; i += 1) {
      const run = snapshots[i]!.runs.get(runId);
      if (!run) {
        prevPresentDigest = null;
        continue;
      }
      if (firstSeen < 0) firstSeen = i;
      lastSeen = i;
      if (!run.valid) everNeedsAttention = true;
      if (prevPresentDigest !== null && prevPresentDigest.digest !== run.runDigest) {
        digestChangeCount += 1;
      }
      prevPresentDigest = { digest: run.runDigest };
    }

    const latestRun = latest.runs.get(runId);
    const currentlyPresent = latestRun !== undefined;
    const currentlyValid = currentlyPresent ? latestRun!.valid : null;
    const currentlyNeedsAttention = currentlyPresent ? !latestRun!.valid : null;

    // Trailing streaks: count back from the latest snapshot while the condition holds.
    let validStreak = 0;
    for (let i = n - 1; i >= 0; i -= 1) {
      const run = snapshots[i]!.runs.get(runId);
      if (run && run.valid) validStreak += 1;
      else break;
    }
    let attentionStreak = 0;
    for (let i = n - 1; i >= 0; i -= 1) {
      const run = snapshots[i]!.runs.get(runId);
      if (run && !run.valid) attentionStreak += 1;
      else break;
    }

    return {
      runId,
      firstSeenSnapshot: snapshots[firstSeen]!.snapshotId,
      lastSeenSnapshot: snapshots[lastSeen]!.snapshotId,
      currentlyPresent,
      currentlyValid,
      currentlyNeedsAttention,
      everNeedsAttention,
      newlyNeedsAttentionSinceBaseline: newlyAttnBaseline.has(runId),
      recoveredSinceBaseline: recoveredBaseline.has(runId),
      changedSinceBaseline: changedBaseline.has(runId),
      changedSincePrevious: changedPrevious.has(runId),
      digestChangeCount,
      validStreak,
      attentionStreak,
      conservativeRegression: regressionBaseline.has(runId),
    };
  });

  // Aggregate rollups.
  const runsEverNeedingAttention = runs.filter((r) => r.everNeedsAttention).length;
  const runsNeedingAttentionNow = runs
    .filter((r) => r.currentlyNeedsAttention === true)
    .map((r) => r.runId)
    .sort(compareString);
  const runsWithConservativeRegression = runs
    .filter((r) => r.conservativeRegression)
    .map((r) => r.runId)
    .sort(compareString);

  const longestValidStreak = runs.reduce((m, r) => Math.max(m, r.validStreak), 0);
  const runsWithLongestValidStreak =
    longestValidStreak > 0
      ? runs.filter((r) => r.validStreak === longestValidStreak).map((r) => r.runId).sort(compareString)
      : [];
  const longestAttentionStreak = runs.reduce((m, r) => Math.max(m, r.attentionStreak), 0);
  const runsWithLongestAttentionStreak =
    longestAttentionStreak > 0
      ? runs
          .filter((r) => r.attentionStreak === longestAttentionStreak)
          .map((r) => r.runId)
          .sort(compareString)
      : [];

  const hasChange = sinceBaseline.hasChange;
  const hasRegression = sinceBaseline.hasRegression;
  const hasAttention = latest.index.invalidRunCount > 0;
  const hasNewAttentionSinceBaseline = sinceBaseline.newlyNeedsAttention.length > 0;

  const warnings: string[] = [];
  if (n < 2) {
    warnings.push(
      "only one snapshot supplied — there is no history to compare; the since-baseline / since-previous fields are empty.",
    );
  }
  if (hasRegression) {
    warnings.push(
      `conservative regression detected since baseline (${baselineSnapshotId} → ${latestSnapshotId}): ${sinceBaseline.regressionReasons.length} reason(s).`,
    );
  }
  if (hasAttention) {
    warnings.push(`${latest.index.invalidRunCount} run(s) currently need attention in the latest snapshot.`);
  }
  if (hasNewAttentionSinceBaseline) {
    warnings.push(`${sinceBaseline.newlyNeedsAttention.length} run(s) newly need attention since baseline.`);
  }

  const notes = [
    `${n} snapshot(s): baseline ${baselineSnapshotId} (${baselineSelector}), latest ${latestSnapshotId}.`,
    `${allRunIds.length} unique run(s) observed; ${latest.index.runCount} currently present, ${latest.index.validRunCount} valid, ${latest.index.invalidRunCount} need attention.`,
    "Change and conservative-regression since baseline reuse the Sprint 19 campaign-diff semantics; the conservative regression flag is integrity-only.",
    "This report summarizes local campaign index snapshots only; it embeds no artifact contents and is not a live result, advice, or a profitability claim.",
  ];

  return {
    schemaVersion: BACKTEST_RESEARCH_CAMPAIGN_HISTORY_REPORT_SCHEMA_VERSION,
    banner: BACKTEST_RESEARCH_CAMPAIGN_HISTORY_REPORT_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...BACKTEST_RESEARCH_CAMPAIGN_HISTORY_REPORT_DISCLAIMERS],
    campaignName: input.campaignName ?? latest.index.campaignName ?? null,
    snapshotCount: n,
    snapshotIds,
    baselineSnapshotId,
    latestSnapshotId,
    previousSnapshotId,
    baselineSelector,
    totalRunsObserved: allRunIds.length,
    runsCurrentlyPresent: latest.index.runCount,
    runsCurrentlyValid: latest.index.validRunCount,
    runsCurrentlyNeedingAttention: latest.index.invalidRunCount,
    runsEverNeedingAttention,
    runsNewlyNeedingAttentionSinceBaseline: sinceBaseline.newlyNeedsAttention.length,
    runsRecoveredSinceBaseline: sinceBaseline.noLongerNeedsAttention.length,
    runsAddedSinceBaseline: sinceBaseline.addedRuns.length,
    runsRemovedSinceBaseline: sinceBaseline.removedRuns.length,
    changedRunCountSinceBaseline: sinceBaseline.changedRuns.length,
    changedRunCountSincePrevious: sincePrevious.changedRuns.length,
    longestValidStreak,
    runsWithLongestValidStreak,
    longestAttentionStreak,
    runsWithLongestAttentionStreak,
    runs,
    runsNeedingAttentionNow,
    runsWithConservativeRegression,
    hasChange,
    hasRegression,
    hasAttention,
    hasNewAttentionSinceBaseline,
    changeReasons: [...sinceBaseline.changeReasons],
    regressionReasons: [...sinceBaseline.regressionReasons],
    warnings,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

/** Strictly validate one history run summary in-place. */
function validateRunSummary(value: unknown, where: string): void {
  if (!isObject(value)) {
    throw new BacktestResearchCampaignHistoryReportError(`${where} must be an object`);
  }
  if (!nonEmptyString(value.runId)) {
    throw new BacktestResearchCampaignHistoryReportError(`${where}.runId must be a non-empty string`);
  }
  for (const f of ["firstSeenSnapshot", "lastSeenSnapshot"] as const) {
    if (!nonEmptyString(value[f])) {
      throw new BacktestResearchCampaignHistoryReportError(`${where}.${f} must be a non-empty string`);
    }
  }
  if (typeof value.currentlyPresent !== "boolean") {
    throw new BacktestResearchCampaignHistoryReportError(`${where}.currentlyPresent must be a boolean`);
  }
  for (const f of ["currentlyValid", "currentlyNeedsAttention"] as const) {
    if (value[f] !== null && typeof value[f] !== "boolean") {
      throw new BacktestResearchCampaignHistoryReportError(`${where}.${f} must be a boolean or null`);
    }
  }
  for (const f of [
    "everNeedsAttention",
    "newlyNeedsAttentionSinceBaseline",
    "recoveredSinceBaseline",
    "changedSinceBaseline",
    "changedSincePrevious",
    "conservativeRegression",
  ] as const) {
    if (typeof value[f] !== "boolean") {
      throw new BacktestResearchCampaignHistoryReportError(`${where}.${f} must be a boolean`);
    }
  }
  for (const f of ["digestChangeCount", "validStreak", "attentionStreak"] as const) {
    if (!isNonNegativeInteger(value[f])) {
      throw new BacktestResearchCampaignHistoryReportError(`${where}.${f} must be a non-negative integer`);
    }
  }
  // Internal consistency: presence governs the nullable current-state fields.
  if (value.currentlyPresent === false) {
    if (value.currentlyValid !== null || value.currentlyNeedsAttention !== null) {
      throw new BacktestResearchCampaignHistoryReportError(
        `${where}: an absent run must have null currentlyValid/currentlyNeedsAttention`,
      );
    }
  } else {
    if (typeof value.currentlyValid !== "boolean" || typeof value.currentlyNeedsAttention !== "boolean") {
      throw new BacktestResearchCampaignHistoryReportError(
        `${where}: a present run must have boolean currentlyValid/currentlyNeedsAttention`,
      );
    }
    if (value.currentlyNeedsAttention !== !value.currentlyValid) {
      throw new BacktestResearchCampaignHistoryReportError(
        `${where}.currentlyNeedsAttention must be the negation of currentlyValid for a present run`,
      );
    }
  }
}

/**
 * Strictly validate a value as a {@link BacktestResearchCampaignHistoryReport} and return it
 * narrowed. A backstop mirroring the other validators: checks the schema version, the required
 * PAPER-ONLY labelling, the disclaimers, the input-summary fields, the aggregate counts (and their
 * internal consistency), the streak leaders, the CI flags, and every run summary. Throws
 * {@link BacktestResearchCampaignHistoryReportError} on the first problem. Pure.
 */
export function validateBacktestResearchCampaignHistoryReport(
  value: unknown,
): BacktestResearchCampaignHistoryReport {
  if (!isObject(value)) {
    throw new BacktestResearchCampaignHistoryReportError("history report must be a JSON object");
  }
  if (value.schemaVersion !== BACKTEST_RESEARCH_CAMPAIGN_HISTORY_REPORT_SCHEMA_VERSION) {
    throw new BacktestResearchCampaignHistoryReportError(
      `history report.schemaVersion must be "${BACKTEST_RESEARCH_CAMPAIGN_HISTORY_REPORT_SCHEMA_VERSION}"`,
    );
  }
  if (value.banner !== BACKTEST_RESEARCH_CAMPAIGN_HISTORY_REPORT_BANNER) {
    throw new BacktestResearchCampaignHistoryReportError(
      `history report.banner must be "${BACKTEST_RESEARCH_CAMPAIGN_HISTORY_REPORT_BANNER}"`,
    );
  }
  for (const flag of [
    "paperOnly",
    "simulated",
    "notLiveResult",
    "notFinancialAdvice",
    "notProfitabilityClaim",
  ] as const) {
    if (value[flag] !== true) {
      throw new BacktestResearchCampaignHistoryReportError(`history report.${flag} must be true`);
    }
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new BacktestResearchCampaignHistoryReportError("history report.disclaimers must be a non-empty array");
  }
  if (value.campaignName !== null && typeof value.campaignName !== "string") {
    throw new BacktestResearchCampaignHistoryReportError("history report.campaignName must be a string or null");
  }
  for (const f of [
    "snapshotCount",
    "totalRunsObserved",
    "runsCurrentlyPresent",
    "runsCurrentlyValid",
    "runsCurrentlyNeedingAttention",
    "runsEverNeedingAttention",
    "runsNewlyNeedingAttentionSinceBaseline",
    "runsRecoveredSinceBaseline",
    "runsAddedSinceBaseline",
    "runsRemovedSinceBaseline",
    "changedRunCountSinceBaseline",
    "changedRunCountSincePrevious",
    "longestValidStreak",
    "longestAttentionStreak",
  ] as const) {
    if (!isNonNegativeInteger(value[f])) {
      throw new BacktestResearchCampaignHistoryReportError(`history report.${f} must be a non-negative integer`);
    }
  }
  if ((value.snapshotCount as number) < 1) {
    throw new BacktestResearchCampaignHistoryReportError("history report.snapshotCount must be at least 1");
  }
  // A present run is either valid or needs attention — never both, never neither.
  if (
    (value.runsCurrentlyValid as number) + (value.runsCurrentlyNeedingAttention as number) !==
    (value.runsCurrentlyPresent as number)
  ) {
    throw new BacktestResearchCampaignHistoryReportError(
      "history report.runsCurrentlyValid + runsCurrentlyNeedingAttention must equal runsCurrentlyPresent",
    );
  }
  if ((value.runsCurrentlyPresent as number) > (value.totalRunsObserved as number)) {
    throw new BacktestResearchCampaignHistoryReportError(
      "history report.runsCurrentlyPresent must not exceed totalRunsObserved",
    );
  }
  for (const f of ["baselineSnapshotId", "latestSnapshotId"] as const) {
    if (!nonEmptyString(value[f])) {
      throw new BacktestResearchCampaignHistoryReportError(`history report.${f} must be a non-empty string`);
    }
  }
  if (value.previousSnapshotId !== null && !nonEmptyString(value.previousSnapshotId)) {
    throw new BacktestResearchCampaignHistoryReportError("history report.previousSnapshotId must be a non-empty string or null");
  }
  if (!nonEmptyString(value.baselineSelector) || !BASELINE_KINDS.has(value.baselineSelector)) {
    throw new BacktestResearchCampaignHistoryReportError(
      'history report.baselineSelector must be "first", "previous", or "explicit"',
    );
  }
  for (const flag of ["hasChange", "hasRegression", "hasAttention", "hasNewAttentionSinceBaseline"] as const) {
    if (typeof value[flag] !== "boolean") {
      throw new BacktestResearchCampaignHistoryReportError(`history report.${flag} must be a boolean`);
    }
  }
  for (const key of [
    "snapshotIds",
    "runsWithLongestValidStreak",
    "runsWithLongestAttentionStreak",
    "runsNeedingAttentionNow",
    "runsWithConservativeRegression",
    "changeReasons",
    "regressionReasons",
    "warnings",
    "notes",
  ] as const) {
    if (!Array.isArray(value[key])) {
      throw new BacktestResearchCampaignHistoryReportError(`history report.${key} must be an array`);
    }
    (value[key] as unknown[]).forEach((s, i) => {
      if (typeof s !== "string") {
        throw new BacktestResearchCampaignHistoryReportError(`history report.${key}[${i}] must be a string`);
      }
    });
  }
  if ((value.snapshotIds as unknown[]).length !== (value.snapshotCount as number)) {
    throw new BacktestResearchCampaignHistoryReportError("history report.snapshotIds length must equal snapshotCount");
  }
  if (!Array.isArray(value.runs)) {
    throw new BacktestResearchCampaignHistoryReportError("history report.runs must be an array");
  }
  if ((value.runs as unknown[]).length !== (value.totalRunsObserved as number)) {
    throw new BacktestResearchCampaignHistoryReportError("history report.runs length must equal totalRunsObserved");
  }
  (value.runs as unknown[]).forEach((r, i) => validateRunSummary(r, `history report.runs[${i}]`));
  return value as unknown as BacktestResearchCampaignHistoryReport;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatBacktestResearchCampaignHistoryReport}. */
export interface FormatBacktestResearchCampaignHistoryReportOptions {
  /** Optional label echoed into the header (e.g. the campaign directory). */
  label?: string;
  /** Cap on the number of per-run rows printed (default 100; the rest are summarized). */
  maxRunRows?: number;
}

function tri(value: boolean | null): string {
  return value === null ? "n/a" : value ? "yes" : "no";
}

/**
 * Render a redacted, stable, human-readable campaign history report. Deterministic and path-stable
 * (no timestamps). Leads with the PAPER-ONLY banner and the ordered snapshot list, summarizes the
 * aggregate trend and streak leaders, lists each run's trajectory (valid/attention streaks, change
 * + regression flags), surfaces the runs needing attention now and the conservative regressions,
 * and closes with the CHANGE / REGRESSION verdict since baseline and the not-live / not-advice
 * disclaimers. Long run lists are summarized (never an unsafe raw dump); the whole output is passed
 * through the shared redactor.
 */
export function formatBacktestResearchCampaignHistoryReport(
  report: BacktestResearchCampaignHistoryReport,
  opts: FormatBacktestResearchCampaignHistoryReportOptions = {},
): string {
  const maxRows = opts.maxRunRows ?? 100;
  const title = report.campaignName ?? "research campaign";
  const header = `${report.banner} — ${title} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];

  if (opts.label) lines.push(`dir:            ${opts.label}`);
  lines.push(`campaign:       ${report.campaignName ?? "(unnamed)"}`);
  lines.push(`snapshots:      ${report.snapshotCount}`);
  lines.push(`baseline:       ${report.baselineSnapshotId} (${report.baselineSelector})`);
  lines.push(`previous:       ${report.previousSnapshotId ?? "(none)"}`);
  lines.push(`latest:         ${report.latestSnapshotId}`);

  lines.push("");
  lines.push("Snapshots (oldest → latest):");
  const shownIds = report.snapshotIds.slice(0, maxRows);
  for (const id of shownIds) lines.push(`- ${id}`);
  const hiddenIds = report.snapshotIds.length - shownIds.length;
  if (hiddenIds > 0) lines.push(`- … and ${hiddenIds} more (summarized; see the report JSON)`);

  lines.push("");
  lines.push("Aggregate (latest snapshot):");
  lines.push(`- runs observed (all snapshots): ${report.totalRunsObserved}`);
  lines.push(`- currently present:             ${report.runsCurrentlyPresent}`);
  lines.push(`- currently valid:               ${report.runsCurrentlyValid}`);
  lines.push(`- currently need attention:      ${report.runsCurrentlyNeedingAttention}`);
  lines.push(`- ever needed attention:         ${report.runsEverNeedingAttention}`);

  lines.push("");
  lines.push("Since baseline:");
  lines.push(`- added:               ${report.runsAddedSinceBaseline}`);
  lines.push(`- removed:             ${report.runsRemovedSinceBaseline}`);
  lines.push(`- changed (paired):    ${report.changedRunCountSinceBaseline}`);
  lines.push(`- newly need attention:${report.runsNewlyNeedingAttentionSinceBaseline}`);
  lines.push(`- recovered:           ${report.runsRecoveredSinceBaseline}`);
  lines.push(`Since previous snapshot:`);
  lines.push(`- changed (paired):    ${report.changedRunCountSincePrevious}`);

  lines.push("");
  lines.push("Streak leaders:");
  lines.push(
    `- longest valid streak:     ${report.longestValidStreak}` +
      (report.runsWithLongestValidStreak.length > 0
        ? ` (${report.runsWithLongestValidStreak.join(", ")})`
        : ""),
  );
  lines.push(
    `- longest attention streak: ${report.longestAttentionStreak}` +
      (report.runsWithLongestAttentionStreak.length > 0
        ? ` (${report.runsWithLongestAttentionStreak.join(", ")})`
        : ""),
  );

  lines.push("");
  lines.push("Runs:");
  if (report.runs.length === 0) {
    lines.push("- (none)");
  } else {
    const shown = report.runs.slice(0, maxRows);
    for (const run of shown) {
      const tags: string[] = [];
      if (run.conservativeRegression) tags.push("regression");
      if (run.newlyNeedsAttentionSinceBaseline) tags.push("new-attention");
      if (run.recoveredSinceBaseline) tags.push("recovered");
      if (run.changedSinceBaseline) tags.push("changed-since-baseline");
      else if (run.changedSincePrevious) tags.push("changed-since-previous");
      const present = run.currentlyPresent ? "present" : "absent";
      lines.push(
        `- ${run.runId} [${present}; valid=${tri(run.currentlyValid)}; ` +
          `validStreak=${run.validStreak}; attnStreak=${run.attentionStreak}; ` +
          `digestChanges=${run.digestChangeCount}]` +
          (tags.length > 0 ? `  (${tags.join(", ")})` : ""),
      );
    }
    const hidden = report.runs.length - shown.length;
    if (hidden > 0) lines.push(`- … and ${hidden} more (summarized; see the report JSON for the full list)`);
  }

  lines.push("");
  lines.push("Needs attention now:");
  if (report.runsNeedingAttentionNow.length === 0) lines.push("- (none)");
  else for (const r of report.runsNeedingAttentionNow) lines.push(`- ${r}`);

  lines.push("");
  lines.push("Conservative regression (since baseline):");
  if (report.runsWithConservativeRegression.length === 0) lines.push("- (none)");
  else for (const r of report.runsWithConservativeRegression) lines.push(`- ${r}`);

  lines.push("");
  lines.push(`Changed since baseline: ${report.hasChange ? "YES" : "no"}`);
  if (report.hasChange) for (const r of report.changeReasons) lines.push(`- ${r}`);
  lines.push(`Regression since baseline: ${report.hasRegression ? "YES" : "no"}`);
  if (report.hasRegression) for (const r of report.regressionReasons) lines.push(`- ${r}`);
  lines.push(`Attention now: ${report.hasAttention ? "YES" : "no"}`);
  lines.push(`New attention since baseline: ${report.hasNewAttentionSinceBaseline ? "YES" : "no"}`);

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of report.warnings) lines.push(`- ${w}`);
  }

  lines.push("");
  lines.push("Notes:");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of report.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
