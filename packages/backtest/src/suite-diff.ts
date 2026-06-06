/**
 * Deterministic diff of two backtest SUITE indexes, for regression-reviewing the
 * injected-only paper backtest across whole directories of scenarios (Sprint 11).
 *
 * `diffBacktestSuites(base, next)` validates both inputs (refusing non-indexes),
 * pairs their entries (by scenario digest, then name, then file), and produces a
 * {@link BacktestSuiteDiff}: compatibility, aggregate summary deltas, a warning-count
 * delta, added/removed/changed scenario lists, the per-entry summary deltas, and a
 * conservative `hasRegression` flag with reasons. It is **pure**: no network, no
 * RPC, no wallet, no filesystem, no `Date.now`, no `Math.random`, and it never
 * mutates its inputs (every value placed in the diff is a fresh copy with stable
 * key order, so the JSON is byte-stable for a given input pair).
 *
 * It compares the two suite INDEXES (the per-entry summary fields each carries),
 * which mirror the summary deltas a single-report diff computes — sufficient for
 * the summary-level regression signals without re-reading every report file.
 *
 * Every number is a bookkeeping difference between two SIMULATIONS computed from
 * injected prices. A delta is NOT profit, loss, a prediction, or advice — it is the
 * change between two simulated suites and nothing more. Two DIFFERENT scenarios
 * having different results is "changed", never a regression.
 */

import { redactString } from "@soulmaker/security";
import type { BacktestNumberDelta } from "./diff.js";
import { BACKTEST_SUITE_SCHEMA_VERSION } from "./suite.js";
import { validateBacktestSuiteIndex } from "./suite-validate.js";
import type {
  BacktestSuiteEntry,
  BacktestSuiteEntrySummary,
  BacktestSuiteIndex,
} from "./suite.js";

/** Stable schema identifier for the suite-diff shape. Bump only on a breaking change. */
export const BACKTEST_SUITE_DIFF_SCHEMA_VERSION = "backtest.suite.diff.v1";

/** Required disclaimers carried by every suite diff (stable order). */
export const BACKTEST_SUITE_DIFF_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY suite diff — compares two injected, simulated backtest suites.",
  "Every value is a bookkeeping delta between two simulations, not a prediction.",
  "A negative or positive simulated delta is not profit, loss, or advice.",
  "A changed scenario (different content) is not a regression — only same-content drift is.",
  "Uses injected suite data only — no live data was fetched and nothing was traded.",
  "Not a live result. Not financial advice. Not a profitability claim.",
];

// --- diff data model ---------------------------------------------------------

/** How a base entry and a next entry were matched. */
export type BacktestSuitePairingMode = "same-digest" | "same-name" | "same-file";

export type BacktestSuiteDiffCompatibilityStatus = "same-schema" | "schema-mismatch";

/** Whether the two suite indexes can be meaningfully compared. */
export interface BacktestSuiteDiffCompatibility {
  status: BacktestSuiteDiffCompatibilityStatus;
  compatible: boolean;
  expectedSuiteSchemaVersion: string;
  schemaVersion: {
    base: string;
    next: string;
    match: boolean;
    baseIsExpected: boolean;
    nextIsExpected: boolean;
  };
  notes: string[];
}

/** Aggregate summary deltas over the two suites. */
export interface BacktestSuiteSummaryDiff {
  scenarioCount: BacktestNumberDelta;
  passedCount: BacktestNumberDelta;
  failedCount: BacktestNumberDelta;
  warningCount: BacktestNumberDelta;
  totalStepCount: BacktestNumberDelta;
  totalCandidateCount: BacktestNumberDelta;
  totalBuyFills: BacktestNumberDelta;
  totalSellFills: BacktestNumberDelta;
  totalFills: BacktestNumberDelta;
  totalRejects: BacktestNumberDelta;
  totalRealizedPnlUsd: BacktestNumberDelta;
  totalUnrealizedPnlUsd: BacktestNumberDelta;
  totalSimulatedPnlUsd: BacktestNumberDelta;
  totalSimulatedNotionalUsd: BacktestNumberDelta;
  totalOpenPositions: BacktestNumberDelta;
  totalClosedTrades: BacktestNumberDelta;
}

/** Per-entry summary deltas for a paired scenario present in BOTH suites. */
export interface BacktestSuiteEntrySummaryDiff {
  stepCount: BacktestNumberDelta;
  candidateCount: BacktestNumberDelta;
  buyFills: BacktestNumberDelta;
  sellFills: BacktestNumberDelta;
  rejects: BacktestNumberDelta;
  realizedPnlUsd: BacktestNumberDelta;
  unrealizedPnlUsd: BacktestNumberDelta;
  totalPnlUsd: BacktestNumberDelta;
  openPositions: BacktestNumberDelta;
  closedTrades: BacktestNumberDelta;
  simulatedNotionalUsd: BacktestNumberDelta;
}

/** A compact reference to one suite entry (for added/removed lists). */
export interface BacktestSuiteEntryRef {
  id: string;
  file: string | null;
  scenarioName: string | null;
  scenarioDigest: string | null;
  status: "passed" | "failed";
}

/** A paired entry present in BOTH suites, with its deltas + regression verdict. */
export interface BacktestSuiteEntryChange {
  pairing: BacktestSuitePairingMode;
  id: string;
  baseId: string;
  nextId: string;
  file: string | null;
  scenarioName: string | null;
  baseDigest: string | null;
  nextDigest: string | null;
  digestMatch: boolean;
  baseStatus: "passed" | "failed";
  nextStatus: "passed" | "failed";
  /** Summary deltas when BOTH sides ran (have a summary); null otherwise. */
  summary: BacktestSuiteEntrySummaryDiff | null;
  warningCodes: { added: string[]; removed: string[] };
  isRegression: boolean;
  regressionReasons: string[];
}

/** Suite-level warning-count delta. */
export interface BacktestSuiteWarningsDiff {
  baseCount: number;
  nextCount: number;
  countDelta: number;
}

/** The full, deterministic, JSON-serializable diff of two suite indexes. */
export interface BacktestSuiteDiff {
  schemaVersion: string;
  compatibility: BacktestSuiteDiffCompatibility;
  baseSuiteName: string | null;
  nextSuiteName: string | null;
  baseScenarioCount: number;
  nextScenarioCount: number;
  summary: BacktestSuiteSummaryDiff;
  warnings: BacktestSuiteWarningsDiff;
  added: BacktestSuiteEntryRef[];
  removed: BacktestSuiteEntryRef[];
  changed: BacktestSuiteEntryChange[];
  /** Subset of `changed` where the passed/failed status flipped (stable order). */
  failedChanged: BacktestSuiteEntryChange[];
  hasRegression: boolean;
  regressionReasons: string[];
  disclaimers: string[];
}

// --- pure helpers ------------------------------------------------------------

function round6(n: number): number {
  const r = Number.parseFloat(n.toFixed(6));
  return Object.is(r, -0) ? 0 : r;
}

function delta(base: number, next: number): BacktestNumberDelta {
  return { base, next, delta: round6(next - base) };
}

function refOf(e: BacktestSuiteEntry): BacktestSuiteEntryRef {
  return {
    id: e.id,
    file: e.file,
    scenarioName: e.scenarioName,
    scenarioDigest: e.scenarioDigest,
    status: e.status,
  };
}

function entrySummaryDiff(
  b: BacktestSuiteEntrySummary,
  n: BacktestSuiteEntrySummary,
): BacktestSuiteEntrySummaryDiff {
  return {
    stepCount: delta(b.stepCount, n.stepCount),
    candidateCount: delta(b.candidateCount, n.candidateCount),
    buyFills: delta(b.buyFills, n.buyFills),
    sellFills: delta(b.sellFills, n.sellFills),
    rejects: delta(b.rejects, n.rejects),
    realizedPnlUsd: delta(b.realizedPnlUsd, n.realizedPnlUsd),
    unrealizedPnlUsd: delta(b.unrealizedPnlUsd, n.unrealizedPnlUsd),
    totalPnlUsd: delta(b.totalPnlUsd, n.totalPnlUsd),
    openPositions: delta(b.openPositions, n.openPositions),
    closedTrades: delta(b.closedTrades, n.closedTrades),
    simulatedNotionalUsd: delta(b.simulatedNotionalUsd, n.simulatedNotionalUsd),
  };
}

/** Codes in `next` not in `base` (added) and in `base` not in `next` (removed), sorted. */
function warningCodeSetDiff(base: string[], next: string[]): { added: string[]; removed: string[] } {
  const baseSet = new Set(base);
  const nextSet = new Set(next);
  const added = [...new Set(next.filter((c) => !baseSet.has(c)))].sort();
  const removed = [...new Set(base.filter((c) => !nextSet.has(c)))].sort();
  return { added, removed };
}

// --- pairing -----------------------------------------------------------------

interface Pair {
  base: BacktestSuiteEntry;
  next: BacktestSuiteEntry;
  mode: BacktestSuitePairingMode;
}

/**
 * Pair base ↔ next entries deterministically: by digest first, then scenario name,
 * then file. Each base entry is consumed at most once; ties resolve to the FIRST
 * available base entry in base order. Returns the pairs plus the leftover
 * (added/removed) entries.
 */
function pairEntries(
  base: BacktestSuiteIndex,
  next: BacktestSuiteIndex,
): { pairs: Pair[]; added: BacktestSuiteEntry[]; removed: BacktestSuiteEntry[] } {
  const baseUsed = new Set<number>();
  const nextUsed = new Set<number>();
  const pairs: Pair[] = [];

  /** Consume and return the first not-yet-used base entry matching `key`, else undefined. */
  const takeBase = (
    keyOf: (e: BacktestSuiteEntry) => string | null,
    key: string,
  ): BacktestSuiteEntry | undefined => {
    for (let i = 0; i < base.entries.length; i += 1) {
      if (baseUsed.has(i)) continue;
      const b = base.entries[i];
      if (b && keyOf(b) === key) {
        baseUsed.add(i);
        return b;
      }
    }
    return undefined;
  };

  const pass = (
    mode: BacktestSuitePairingMode,
    keyOf: (e: BacktestSuiteEntry) => string | null,
  ): void => {
    next.entries.forEach((n, ni) => {
      if (nextUsed.has(ni)) return;
      const key = keyOf(n);
      if (key === null) return;
      const b = takeBase(keyOf, key);
      if (b) {
        nextUsed.add(ni);
        pairs.push({ base: b, next: n, mode });
      }
    });
  };

  pass("same-digest", (e) => e.scenarioDigest);
  pass("same-name", (e) => e.scenarioName);
  pass("same-file", (e) => e.file);

  const removed = base.entries.filter((_, i) => !baseUsed.has(i));
  const added = next.entries.filter((_, i) => !nextUsed.has(i));
  return { pairs, added, removed };
}

// --- regression detection (per entry) ---------------------------------------

function usdAbs(n: number): string {
  return `$${Math.abs(n).toFixed(2)}`;
}

function summaryChanged(d: BacktestSuiteEntrySummaryDiff): boolean {
  return (
    d.stepCount.delta !== 0 ||
    d.candidateCount.delta !== 0 ||
    d.buyFills.delta !== 0 ||
    d.sellFills.delta !== 0 ||
    d.rejects.delta !== 0 ||
    d.realizedPnlUsd.delta !== 0 ||
    d.unrealizedPnlUsd.delta !== 0 ||
    d.totalPnlUsd.delta !== 0 ||
    d.openPositions.delta !== 0 ||
    d.closedTrades.delta !== 0 ||
    d.simulatedNotionalUsd.delta !== 0
  );
}

/**
 * Conservative, bookkeeping-oriented per-entry regression detection. A SAME-digest
 * pair should replay byte-identically, so any drift is a regression to review. A
 * different-content pair (same name/file, different digest) is "changed", never a
 * regression by default — EXCEPT a newly-failing scenario, which is always a
 * regression regardless of how it was paired.
 */
function entryRegression(
  change: BacktestSuiteEntryChange,
): string[] {
  const reasons: string[] = [];
  const newFailure = change.baseStatus === "passed" && change.nextStatus === "failed";
  if (newFailure) {
    reasons.push(`scenario "${change.id}" passed in base but failed in next`);
  }

  if (change.pairing === "same-digest" && change.digestMatch) {
    if (change.summary && summaryChanged(change.summary)) {
      reasons.push(
        "same scenario digest but the simulated results differ — a deterministic replay should be " +
          "byte-identical, so this likely reflects an engine/config change to review",
      );
      const s = change.summary;
      if (s.totalPnlUsd.delta < 0) reasons.push(`total simulated PnL decreased by ${usdAbs(s.totalPnlUsd.delta)}`);
      if (s.realizedPnlUsd.delta < 0) reasons.push(`realized simulated PnL decreased by ${usdAbs(s.realizedPnlUsd.delta)}`);
      if (s.rejects.delta > 0) reasons.push(`paper rejects increased by ${s.rejects.delta}`);
      if (s.buyFills.delta < 0 || s.sellFills.delta < 0) reasons.push("simulated fill count dropped for an identical scenario");
    }
    if (change.warningCodes.added.length > 0) {
      reasons.push(`${change.warningCodes.added.length} scenario warning(s) appeared for an identical scenario`);
    }
  }
  return reasons;
}

// --- public API --------------------------------------------------------------

function buildCompatibility(
  base: BacktestSuiteIndex,
  next: BacktestSuiteIndex,
): BacktestSuiteDiffCompatibility {
  const expected = BACKTEST_SUITE_SCHEMA_VERSION;
  const match = base.schemaVersion === next.schemaVersion;
  const baseIsExpected = base.schemaVersion === expected;
  const nextIsExpected = next.schemaVersion === expected;

  const notes: string[] = [];
  if (!match) {
    notes.push(
      `Suite index schema versions differ ("${base.schemaVersion}" vs "${next.schemaVersion}"); ` +
        "numeric deltas may not be comparable.",
    );
  } else {
    notes.push("Same suite index schema: aggregate and per-entry deltas are comparable.");
  }
  if (!nextIsExpected) {
    notes.push(`Next suite index schemaVersion "${next.schemaVersion}" is not the expected "${expected}".`);
  }
  if (!baseIsExpected) {
    notes.push(`Base suite index schemaVersion "${base.schemaVersion}" is not the expected "${expected}".`);
  }

  return {
    status: match ? "same-schema" : "schema-mismatch",
    compatible: match,
    expectedSuiteSchemaVersion: expected,
    schemaVersion: { base: base.schemaVersion, next: next.schemaVersion, match, baseIsExpected, nextIsExpected },
    notes,
  };
}

function buildSummaryDiff(base: BacktestSuiteIndex, next: BacktestSuiteIndex): BacktestSuiteSummaryDiff {
  const b = base.summary;
  const n = next.summary;
  return {
    scenarioCount: delta(b.scenarioCount, n.scenarioCount),
    passedCount: delta(b.passedCount, n.passedCount),
    failedCount: delta(b.failedCount, n.failedCount),
    warningCount: delta(b.warningCount, n.warningCount),
    totalStepCount: delta(b.totalStepCount, n.totalStepCount),
    totalCandidateCount: delta(b.totalCandidateCount, n.totalCandidateCount),
    totalBuyFills: delta(b.totalBuyFills, n.totalBuyFills),
    totalSellFills: delta(b.totalSellFills, n.totalSellFills),
    totalFills: delta(b.totalFills, n.totalFills),
    totalRejects: delta(b.totalRejects, n.totalRejects),
    totalRealizedPnlUsd: delta(b.totalRealizedPnlUsd, n.totalRealizedPnlUsd),
    totalUnrealizedPnlUsd: delta(b.totalUnrealizedPnlUsd, n.totalUnrealizedPnlUsd),
    totalSimulatedPnlUsd: delta(b.totalSimulatedPnlUsd, n.totalSimulatedPnlUsd),
    totalSimulatedNotionalUsd: delta(b.totalSimulatedNotionalUsd, n.totalSimulatedNotionalUsd),
    totalOpenPositions: delta(b.totalOpenPositions, n.totalOpenPositions),
    totalClosedTrades: delta(b.totalClosedTrades, n.totalClosedTrades),
  };
}

/**
 * Compute the deterministic diff of two suite indexes. Both inputs are validated
 * (a non-index throws {@link BacktestSuiteIndexError}); neither is mutated.
 */
export function diffBacktestSuites(base: unknown, next: unknown): BacktestSuiteDiff {
  const baseIndex = validateBacktestSuiteIndex(base);
  const nextIndex = validateBacktestSuiteIndex(next);

  const compatibility = buildCompatibility(baseIndex, nextIndex);
  const summary = buildSummaryDiff(baseIndex, nextIndex);

  const { pairs, added, removed } = pairEntries(baseIndex, nextIndex);

  // Changed entries follow NEXT order (pairing iterates next in order).
  const changed: BacktestSuiteEntryChange[] = pairs.map(({ base: b, next: n, mode }) => {
    const digestMatch = b.scenarioDigest !== null && b.scenarioDigest === n.scenarioDigest;
    const warningCodes = warningCodeSetDiff(b.warningCodes, n.warningCodes);
    const summaryD = b.summary && n.summary ? entrySummaryDiff(b.summary, n.summary) : null;
    const change: BacktestSuiteEntryChange = {
      pairing: mode,
      id: n.id,
      baseId: b.id,
      nextId: n.id,
      file: n.file ?? b.file,
      scenarioName: n.scenarioName ?? b.scenarioName,
      baseDigest: b.scenarioDigest,
      nextDigest: n.scenarioDigest,
      digestMatch,
      baseStatus: b.status,
      nextStatus: n.status,
      summary: summaryD,
      warningCodes,
      isRegression: false,
      regressionReasons: [],
    };
    const reasons = entryRegression(change);
    change.regressionReasons = reasons;
    change.isRegression = reasons.length > 0;
    return change;
  });

  const failedChanged = changed.filter((c) => c.baseStatus !== c.nextStatus);

  // Aggregate regression reasons (top-level), then per-entry reasons.
  const regressionReasons: string[] = [];
  if (compatibility.status === "schema-mismatch") {
    regressionReasons.push(
      `suite index schemaVersion differs ("${compatibility.schemaVersion.base}" → "${compatibility.schemaVersion.next}")`,
    );
  }
  if (summary.failedCount.delta > 0) {
    regressionReasons.push(`failed scenario count increased by ${summary.failedCount.delta}`);
  }
  // A passed scenario present in base but missing from next is lost coverage.
  for (const r of removed) {
    if (r.status === "passed") {
      regressionReasons.push(`passed scenario "${r.id}" from base is missing from next`);
    }
  }
  for (const c of changed) {
    for (const r of c.regressionReasons) regressionReasons.push(`[${c.id}] ${r}`);
  }

  return {
    schemaVersion: BACKTEST_SUITE_DIFF_SCHEMA_VERSION,
    compatibility,
    baseSuiteName: baseIndex.name,
    nextSuiteName: nextIndex.name,
    baseScenarioCount: baseIndex.summary.scenarioCount,
    nextScenarioCount: nextIndex.summary.scenarioCount,
    summary,
    warnings: {
      baseCount: baseIndex.summary.warningCount,
      nextCount: nextIndex.summary.warningCount,
      countDelta: nextIndex.summary.warningCount - baseIndex.summary.warningCount,
    },
    added: added.map(refOf),
    removed: removed.map(refOf),
    changed,
    failedChanged,
    hasRegression: regressionReasons.length > 0,
    regressionReasons,
    disclaimers: [...BACKTEST_SUITE_DIFF_DISCLAIMERS],
  };
}

// --- human formatter ---------------------------------------------------------

function usd(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function trimNum(n: number): string {
  return Number.parseFloat(n.toFixed(6)).toString();
}

function signedUsd(n: number): string {
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(2)}`;
}

function signedNum(n: number): string {
  return `${n >= 0 ? "+" : ""}${trimNum(n)}`;
}

function numDeltaLine(label: string, d: BacktestNumberDelta): string {
  return `- ${label}: ${trimNum(d.base)} → ${trimNum(d.next)} (Δ ${signedNum(d.delta)})`;
}

function usdDeltaLine(label: string, d: BacktestNumberDelta): string {
  return `- ${label}: ${usd(d.base)} → ${usd(d.next)} (Δ ${signedUsd(d.delta)})`;
}

function refLine(r: BacktestSuiteEntryRef): string {
  const name = r.scenarioName ? `  ${r.scenarioName}` : "";
  const digest = r.scenarioDigest ? ` [${r.scenarioDigest}]` : "";
  return `  - ${r.id} (${r.status})${name}${digest}`;
}

export interface FormatBacktestSuiteDiffOptions {
  /** Override the labels shown for the two suites (e.g. directory names). */
  baseLabel?: string;
  nextLabel?: string;
}

/**
 * Render a redacted, human-readable, PAPER-ONLY suite diff. Sectioned and stable
 * for a given diff object. Uses neutral "simulated delta" wording — never "profit"
 * or "improvement" — and keeps the simulated/injected/not-live/not-advice notes.
 */
export function formatBacktestSuiteDiff(
  diff: BacktestSuiteDiff,
  opts: FormatBacktestSuiteDiffOptions = {},
): string {
  const baseLabel = opts.baseLabel ?? diff.baseSuiteName ?? "base";
  const nextLabel = opts.nextLabel ?? diff.nextSuiteName ?? "next";
  const c = diff.compatibility;
  const lines: string[] = [];

  const header = "Backtest suite diff (SIMULATED PAPER-ONLY)";
  lines.push(header);
  lines.push("=".repeat(header.length));

  // Suite pair.
  lines.push("Suite pair:");
  lines.push(`- base (${baseLabel}): ${diff.baseSuiteName ?? "(unnamed)"}  (${diff.baseScenarioCount} scenarios)`);
  lines.push(`- next (${nextLabel}): ${diff.nextSuiteName ?? "(unnamed)"}  (${diff.nextScenarioCount} scenarios)`);
  lines.push(`- schema: ${c.schemaVersion.base} → ${c.schemaVersion.next}`);
  lines.push("");

  // Compatibility.
  lines.push("Compatibility:");
  lines.push(`- status:     ${c.status}`);
  lines.push(`- comparable: ${c.compatible ? "yes" : "no"}`);
  for (const note of c.notes) lines.push(`- note: ${note}`);
  lines.push("");

  // Aggregate deltas.
  lines.push("Aggregate deltas (simulated):");
  lines.push(numDeltaLine("scenarios", diff.summary.scenarioCount));
  lines.push(numDeltaLine("passed", diff.summary.passedCount));
  lines.push(numDeltaLine("failed", diff.summary.failedCount));
  lines.push(numDeltaLine("warnings", diff.summary.warningCount));
  lines.push(numDeltaLine("steps", diff.summary.totalStepCount));
  lines.push(numDeltaLine("candidates", diff.summary.totalCandidateCount));
  lines.push(numDeltaLine("buy fills", diff.summary.totalBuyFills));
  lines.push(numDeltaLine("sell fills", diff.summary.totalSellFills));
  lines.push(numDeltaLine("rejects", diff.summary.totalRejects));
  lines.push(numDeltaLine("open positions", diff.summary.totalOpenPositions));
  lines.push(numDeltaLine("closed trades", diff.summary.totalClosedTrades));
  lines.push(usdDeltaLine("realized PnL", diff.summary.totalRealizedPnlUsd));
  lines.push(usdDeltaLine("unrealized PnL", diff.summary.totalUnrealizedPnlUsd));
  lines.push(usdDeltaLine("total PnL", diff.summary.totalSimulatedPnlUsd));
  lines.push(usdDeltaLine("sim. notional", diff.summary.totalSimulatedNotionalUsd));
  lines.push("");

  // Added / removed / changed scenarios.
  lines.push(`Added scenarios (${diff.added.length}):`);
  if (diff.added.length === 0) lines.push("  - (none)");
  else for (const r of diff.added) lines.push(refLine(r));
  lines.push(`Removed scenarios (${diff.removed.length}):`);
  if (diff.removed.length === 0) lines.push("  - (none)");
  else for (const r of diff.removed) lines.push(refLine(r));
  lines.push(`Changed scenarios (${diff.changed.length}):`);
  if (diff.changed.length === 0) lines.push("  - (none)");
  else {
    for (const ch of diff.changed) {
      const total = ch.summary ? ` total ${signedUsd(ch.summary.totalPnlUsd.delta)}` : "";
      const reg = ch.isRegression ? "  ⚠ regression" : "";
      lines.push(
        `  - ${ch.id} [${ch.pairing}; ${ch.baseStatus}→${ch.nextStatus}; ` +
          `digest ${ch.digestMatch ? "same" : "changed"}]${total}${reg}`,
      );
    }
  }
  lines.push("");

  // Regressions.
  lines.push(`Regression: ${diff.hasRegression ? "YES" : "no"}`);
  if (diff.hasRegression) for (const r of diff.regressionReasons) lines.push(`- ${r}`);
  lines.push("");

  // Notes (required disclaimers).
  lines.push("Notes:");
  for (const note of diff.disclaimers) lines.push(`- ${note}`);

  return redactString(lines.join("\n"));
}
