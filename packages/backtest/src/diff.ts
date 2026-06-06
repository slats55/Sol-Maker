/**
 * Deterministic diff of two {@link BacktestReport} objects, for reviewing and
 * regression-testing the injected-only paper backtest.
 *
 * `diffBacktestReports(base, next)` validates both inputs (refusing non-reports),
 * then produces a {@link BacktestReportDiff}: metadata/compatibility, summary
 * deltas, a warnings set-diff, per-step equity-curve deltas, per-mint deltas, and a
 * conservative `hasRegression` flag. It is **pure**: no network, no RPC, no wallet,
 * no filesystem, no `Date.now`, no `Math.random`, and it never mutates its inputs
 * (every value placed in the diff is a fresh copy with stable key order, so the
 * JSON is byte-stable for a given input pair).
 *
 * Every number here is a bookkeeping difference between two SIMULATIONS computed
 * from injected prices. A delta is NOT profit, loss, a prediction, or advice — it
 * is the change between two simulated reports and nothing more.
 */

import { redactString } from "@soulmaker/security";
import {
  validateBacktestReport,
  type BacktestEquityPoint,
  type BacktestLintIssue,
  type BacktestPerMintAggregate,
} from "./report-validate.js";
import { BACKTEST_REPORT_SCHEMA_VERSION } from "./report.js";
import type { BacktestReport } from "./types.js";

/** Stable schema identifier for the diff shape. Bump only on a breaking change. */
export const BACKTEST_DIFF_SCHEMA_VERSION = "backtest.diff.v1";

/** Required disclaimers carried by every diff (stable order). */
export const BACKTEST_DIFF_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY diff — compares two injected, simulated backtest reports.",
  "Every value is a bookkeeping delta between two simulations, not a prediction.",
  "A negative or positive simulated delta is not profit, loss, or advice.",
  "Uses injected report data only — no live data was fetched and nothing was traded.",
  "Not a live result. Not financial advice. Not a profitability claim.",
];

// --- diff data model ---------------------------------------------------------

/** A single numeric comparison. `delta = next - base`, rounded for stability. */
export interface BacktestNumberDelta {
  base: number;
  next: number;
  delta: number;
}

/** A single string comparison (schema/name/digest). */
export interface BacktestDiffStringField {
  base: string;
  next: string;
  match: boolean;
}

export type BacktestDiffCompatibilityStatus =
  | "same-scenario"
  | "different-scenario"
  | "schema-mismatch";

/** Whether the two reports can be meaningfully compared, and on what basis. */
export interface BacktestDiffCompatibility {
  status: BacktestDiffCompatibilityStatus;
  /** False only when the report schema versions differ (numeric deltas may be moot). */
  compatible: boolean;
  expectedReportSchemaVersion: string;
  schemaVersion: {
    base: string;
    next: string;
    match: boolean;
    baseIsExpected: boolean;
    nextIsExpected: boolean;
  };
  scenarioName: BacktestDiffStringField;
  scenarioDigest: BacktestDiffStringField;
  /** Human, redaction-safe notes explaining the compatibility verdict (stable order). */
  notes: string[];
}

/** Summary-level deltas (counts + simulated PnL). */
export interface BacktestSummaryDiff {
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

/** Set-diff of scenario warnings, keyed by (code, message, path). */
export interface BacktestWarningsDiff {
  added: BacktestLintIssue[];
  removed: BacktestLintIssue[];
  unchanged: BacktestLintIssue[];
  baseCount: number;
  nextCount: number;
  countDelta: number;
}

/** Per-step equity-curve delta for a step present in BOTH reports. */
export interface BacktestEquityStepDiff {
  stepId: string;
  baseAt: string;
  nextAt: string;
  realizedPnlUsd: BacktestNumberDelta;
  unrealizedPnlUsd: BacktestNumberDelta;
  totalPnlUsd: BacktestNumberDelta;
  simulatedNotionalUsd: BacktestNumberDelta;
  openPositionCount: BacktestNumberDelta;
  closedTradeCount: BacktestNumberDelta;
}

/** Equity-curve diff: common steps (base order) + added (next order) + removed (base order). */
export interface BacktestEquityCurveDiff {
  common: BacktestEquityStepDiff[];
  addedSteps: BacktestEquityPoint[];
  removedSteps: BacktestEquityPoint[];
}

/** Per-mint delta for a mint present in BOTH reports. */
export interface BacktestPerMintDelta {
  mint: string;
  buyFillCount: BacktestNumberDelta;
  sellFillCount: BacktestNumberDelta;
  openQuantity: BacktestNumberDelta;
  realizedPnlUsd: BacktestNumberDelta;
  unrealizedPnlUsd: BacktestNumberDelta;
  totalPnlUsd: BacktestNumberDelta;
  simulatedNotionalUsd: BacktestNumberDelta;
}

/** Per-mint diff, all lists sorted by mint. */
export interface BacktestPerMintDiff {
  common: BacktestPerMintDelta[];
  addedMints: BacktestPerMintAggregate[];
  removedMints: BacktestPerMintAggregate[];
}

/** The full, deterministic, JSON-serializable diff of two backtest reports. */
export interface BacktestReportDiff {
  schemaVersion: string;
  compatibility: BacktestDiffCompatibility;
  summary: BacktestSummaryDiff;
  warnings: BacktestWarningsDiff;
  equityCurve: BacktestEquityCurveDiff;
  perMint: BacktestPerMintDiff;
  /** Conservative, bookkeeping-oriented regression flag (never trading advice). */
  hasRegression: boolean;
  /** Why `hasRegression` is set (empty when false). Stable order. */
  regressionReasons: string[];
  disclaimers: string[];
}

// --- pure helpers ------------------------------------------------------------

/** Round to 6 decimals deterministically (kills float noise; normalizes -0 to 0). */
function round6(n: number): number {
  const r = Number.parseFloat(n.toFixed(6));
  return Object.is(r, -0) ? 0 : r;
}

function delta(base: number, next: number): BacktestNumberDelta {
  return { base, next, delta: round6(next - base) };
}

function warningKey(w: BacktestLintIssue): string {
  // A JSON tuple is an unambiguous, control-char-free key for (code, message, path).
  return JSON.stringify([w.code, w.message, w.path ?? null]);
}

function copyWarning(w: BacktestLintIssue): BacktestLintIssue {
  return w.path === undefined
    ? { code: w.code, message: w.message }
    : { code: w.code, message: w.message, path: w.path };
}

function copyEquityPoint(e: BacktestEquityPoint): BacktestEquityPoint {
  return {
    stepId: e.stepId,
    at: e.at,
    realizedPnlUsd: e.realizedPnlUsd,
    unrealizedPnlUsd: e.unrealizedPnlUsd,
    totalPnlUsd: e.totalPnlUsd,
    simulatedNotionalUsd: e.simulatedNotionalUsd,
    openPositionCount: e.openPositionCount,
    closedTradeCount: e.closedTradeCount,
  };
}

function copyPerMint(m: BacktestPerMintAggregate): BacktestPerMintAggregate {
  return {
    mint: m.mint,
    buyFillCount: m.buyFillCount,
    sellFillCount: m.sellFillCount,
    openQuantity: m.openQuantity,
    realizedPnlUsd: m.realizedPnlUsd,
    unrealizedPnlUsd: m.unrealizedPnlUsd,
    totalPnlUsd: m.totalPnlUsd,
    simulatedNotionalUsd: m.simulatedNotionalUsd,
  };
}

function byWarning(a: BacktestLintIssue, b: BacktestLintIssue): number {
  return warningKey(a).localeCompare(warningKey(b));
}

function byMintAggregate(a: { mint: string }, b: { mint: string }): number {
  return a.mint.localeCompare(b.mint);
}

// --- compatibility -----------------------------------------------------------

function buildCompatibility(base: BacktestReport, next: BacktestReport): BacktestDiffCompatibility {
  const expected = BACKTEST_REPORT_SCHEMA_VERSION;
  const schemaMatch = base.schemaVersion === next.schemaVersion;
  const baseIsExpected = base.schemaVersion === expected;
  const nextIsExpected = next.schemaVersion === expected;
  const digestMatch = base.scenarioDigest === next.scenarioDigest;
  const nameMatch = base.scenarioName === next.scenarioName;

  const status: BacktestDiffCompatibilityStatus = !schemaMatch
    ? "schema-mismatch"
    : digestMatch
      ? "same-scenario"
      : "different-scenario";

  const notes: string[] = [];
  if (status === "schema-mismatch") {
    notes.push(
      `Report schema versions differ ("${base.schemaVersion}" vs "${next.schemaVersion}"); ` +
        "numeric deltas may not be comparable.",
    );
  } else if (status === "same-scenario") {
    notes.push("Same scenarioDigest: a deterministic replay should reproduce identical numbers.");
  } else {
    notes.push("Different scenarioDigest: the two reports describe different scenarios; deltas are expected.");
  }
  if (!nextIsExpected) {
    notes.push(`Next report schemaVersion "${next.schemaVersion}" is not the expected "${expected}".`);
  }
  if (!baseIsExpected) {
    notes.push(`Base report schemaVersion "${base.schemaVersion}" is not the expected "${expected}".`);
  }

  return {
    status,
    compatible: schemaMatch,
    expectedReportSchemaVersion: expected,
    schemaVersion: {
      base: base.schemaVersion,
      next: next.schemaVersion,
      match: schemaMatch,
      baseIsExpected,
      nextIsExpected,
    },
    scenarioName: { base: base.scenarioName, next: next.scenarioName, match: nameMatch },
    scenarioDigest: { base: base.scenarioDigest, next: next.scenarioDigest, match: digestMatch },
    notes,
  };
}

// --- section builders --------------------------------------------------------

function buildSummary(base: BacktestReport, next: BacktestReport): BacktestSummaryDiff {
  return {
    stepCount: delta(base.stepCount, next.stepCount),
    candidateCount: delta(base.totalCandidateCount, next.totalCandidateCount),
    buyFills: delta(base.fillCounts.buyCount, next.fillCounts.buyCount),
    sellFills: delta(base.fillCounts.sellCount, next.fillCounts.sellCount),
    rejects: delta(base.rejectedCounts.total, next.rejectedCounts.total),
    realizedPnlUsd: delta(base.pnl.realizedUsd, next.pnl.realizedUsd),
    unrealizedPnlUsd: delta(base.pnl.unrealizedUsd, next.pnl.unrealizedUsd),
    totalPnlUsd: delta(base.pnl.totalUsd, next.pnl.totalUsd),
    openPositions: delta(base.positionCounts.open, next.positionCounts.open),
    closedTrades: delta(base.positionCounts.closed, next.positionCounts.closed),
    simulatedNotionalUsd: delta(base.simulatedNotionalUsd, next.simulatedNotionalUsd),
  };
}

function buildWarningsDiff(base: BacktestReport, next: BacktestReport): BacktestWarningsDiff {
  const baseByKey = new Map(base.warnings.map((w) => [warningKey(w), w]));
  const nextByKey = new Map(next.warnings.map((w) => [warningKey(w), w]));

  const added: BacktestLintIssue[] = [];
  const removed: BacktestLintIssue[] = [];
  const unchanged: BacktestLintIssue[] = [];
  for (const [key, w] of nextByKey) {
    if (baseByKey.has(key)) unchanged.push(copyWarning(w));
    else added.push(copyWarning(w));
  }
  for (const [key, w] of baseByKey) {
    if (!nextByKey.has(key)) removed.push(copyWarning(w));
  }
  added.sort(byWarning);
  removed.sort(byWarning);
  unchanged.sort(byWarning);

  return {
    added,
    removed,
    unchanged,
    baseCount: base.warnings.length,
    nextCount: next.warnings.length,
    countDelta: next.warnings.length - base.warnings.length,
  };
}

function buildEquityDiff(base: BacktestReport, next: BacktestReport): BacktestEquityCurveDiff {
  const baseById = new Map(base.equityCurve.map((e) => [e.stepId, e]));
  const nextById = new Map(next.equityCurve.map((e) => [e.stepId, e]));

  // Common steps follow BASE replay order; additions follow NEXT order; removals BASE order.
  const common: BacktestEquityStepDiff[] = [];
  for (const b of base.equityCurve) {
    const n = nextById.get(b.stepId);
    if (!n) continue;
    common.push({
      stepId: b.stepId,
      baseAt: b.at,
      nextAt: n.at,
      realizedPnlUsd: delta(b.realizedPnlUsd, n.realizedPnlUsd),
      unrealizedPnlUsd: delta(b.unrealizedPnlUsd, n.unrealizedPnlUsd),
      totalPnlUsd: delta(b.totalPnlUsd, n.totalPnlUsd),
      simulatedNotionalUsd: delta(b.simulatedNotionalUsd, n.simulatedNotionalUsd),
      openPositionCount: delta(b.openPositionCount, n.openPositionCount),
      closedTradeCount: delta(b.closedTradeCount, n.closedTradeCount),
    });
  }
  const addedSteps = next.equityCurve.filter((e) => !baseById.has(e.stepId)).map(copyEquityPoint);
  const removedSteps = base.equityCurve.filter((e) => !nextById.has(e.stepId)).map(copyEquityPoint);

  return { common, addedSteps, removedSteps };
}

function buildPerMintDiff(base: BacktestReport, next: BacktestReport): BacktestPerMintDiff {
  const baseByMint = new Map(base.perMint.map((m) => [m.mint, m]));
  const nextByMint = new Map(next.perMint.map((m) => [m.mint, m]));

  const common: BacktestPerMintDelta[] = [];
  for (const b of base.perMint) {
    const n = nextByMint.get(b.mint);
    if (!n) continue;
    common.push({
      mint: b.mint,
      buyFillCount: delta(b.buyFillCount, n.buyFillCount),
      sellFillCount: delta(b.sellFillCount, n.sellFillCount),
      openQuantity: delta(b.openQuantity, n.openQuantity),
      realizedPnlUsd: delta(b.realizedPnlUsd, n.realizedPnlUsd),
      unrealizedPnlUsd: delta(b.unrealizedPnlUsd, n.unrealizedPnlUsd),
      totalPnlUsd: delta(b.totalPnlUsd, n.totalPnlUsd),
      simulatedNotionalUsd: delta(b.simulatedNotionalUsd, n.simulatedNotionalUsd),
    });
  }
  common.sort(byMintAggregate);
  const addedMints = next.perMint.filter((m) => !baseByMint.has(m.mint)).map(copyPerMint).sort(byMintAggregate);
  const removedMints = base.perMint.filter((m) => !nextByMint.has(m.mint)).map(copyPerMint).sort(byMintAggregate);

  return { common, addedMints, removedMints };
}

// --- regression detection ----------------------------------------------------

function usdAbs(n: number): string {
  return `$${Math.abs(n).toFixed(2)}`;
}

/**
 * Conservative, bookkeeping-oriented regression detection. It is NOT trading
 * advice: it answers "did the simulated bookkeeping get worse or less consistent?"
 *
 * Schema problems are always flagged. PnL/fills/rejects/warnings regressions are
 * flagged ONLY when the two reports describe the SAME scenario (identical digest),
 * because for two DIFFERENT scenarios a delta is expected, not a regression.
 */
function detectRegression(
  compat: BacktestDiffCompatibility,
  summary: BacktestSummaryDiff,
  warnings: BacktestWarningsDiff,
  equityChanged: boolean,
  perMintChanged: boolean,
): string[] {
  const reasons: string[] = [];

  if (compat.status === "schema-mismatch") {
    reasons.push(
      `report schemaVersion differs ("${compat.schemaVersion.base}" → "${compat.schemaVersion.next}")`,
    );
  }
  if (!compat.schemaVersion.nextIsExpected) {
    reasons.push(
      `next report schemaVersion "${compat.schemaVersion.next}" is not the expected ` +
        `"${compat.expectedReportSchemaVersion}"`,
    );
  }

  if (compat.status === "same-scenario") {
    const resultsDiffer =
      summary.stepCount.delta !== 0 ||
      summary.candidateCount.delta !== 0 ||
      summary.buyFills.delta !== 0 ||
      summary.sellFills.delta !== 0 ||
      summary.rejects.delta !== 0 ||
      summary.realizedPnlUsd.delta !== 0 ||
      summary.unrealizedPnlUsd.delta !== 0 ||
      summary.totalPnlUsd.delta !== 0 ||
      summary.openPositions.delta !== 0 ||
      summary.closedTrades.delta !== 0 ||
      summary.simulatedNotionalUsd.delta !== 0 ||
      warnings.added.length > 0 ||
      warnings.removed.length > 0 ||
      equityChanged ||
      perMintChanged;

    if (resultsDiffer) {
      reasons.push(
        "same scenarioDigest but the simulated results differ — a deterministic replay of " +
          "one scenario should be byte-identical, so this likely reflects an engine/config change to review",
      );
    }
    // Targeted, actionable specifics (bookkeeping "got worse" for an identical scenario).
    if (summary.totalPnlUsd.delta < 0) {
      reasons.push(`total simulated PnL decreased by ${usdAbs(summary.totalPnlUsd.delta)}`);
    }
    if (summary.realizedPnlUsd.delta < 0) {
      reasons.push(`realized simulated PnL decreased by ${usdAbs(summary.realizedPnlUsd.delta)}`);
    }
    if (summary.rejects.delta > 0) {
      reasons.push(`paper rejects increased by ${summary.rejects.delta}`);
    }
    if (summary.buyFills.delta < 0 || summary.sellFills.delta < 0) {
      reasons.push("simulated fill count dropped for an identical scenario");
    }
    if (warnings.added.length > 0) {
      reasons.push(`${warnings.added.length} scenario warning(s) appeared`);
    }
  }

  return reasons;
}

// --- public API --------------------------------------------------------------

/**
 * Compute the deterministic diff of two backtest reports. Both inputs are validated
 * (a non-report throws {@link BacktestReportError}); neither is mutated.
 */
export function diffBacktestReports(base: unknown, next: unknown): BacktestReportDiff {
  const baseReport = validateBacktestReport(base);
  const nextReport = validateBacktestReport(next);

  const compatibility = buildCompatibility(baseReport, nextReport);
  const summary = buildSummary(baseReport, nextReport);
  const warnings = buildWarningsDiff(baseReport, nextReport);
  const equityCurve = buildEquityDiff(baseReport, nextReport);
  const perMint = buildPerMintDiff(baseReport, nextReport);

  const equityChanged =
    equityCurve.addedSteps.length > 0 ||
    equityCurve.removedSteps.length > 0 ||
    equityCurve.common.some(
      (s) =>
        s.realizedPnlUsd.delta !== 0 ||
        s.unrealizedPnlUsd.delta !== 0 ||
        s.totalPnlUsd.delta !== 0 ||
        s.simulatedNotionalUsd.delta !== 0 ||
        s.openPositionCount.delta !== 0 ||
        s.closedTradeCount.delta !== 0,
    );
  const perMintChanged =
    perMint.addedMints.length > 0 ||
    perMint.removedMints.length > 0 ||
    perMint.common.some(
      (m) =>
        m.buyFillCount.delta !== 0 ||
        m.sellFillCount.delta !== 0 ||
        m.openQuantity.delta !== 0 ||
        m.realizedPnlUsd.delta !== 0 ||
        m.unrealizedPnlUsd.delta !== 0 ||
        m.totalPnlUsd.delta !== 0 ||
        m.simulatedNotionalUsd.delta !== 0,
    );

  const regressionReasons = detectRegression(compatibility, summary, warnings, equityChanged, perMintChanged);

  return {
    schemaVersion: BACKTEST_DIFF_SCHEMA_VERSION,
    compatibility,
    summary,
    warnings,
    equityCurve,
    perMint,
    hasRegression: regressionReasons.length > 0,
    regressionReasons,
    disclaimers: [...BACKTEST_DIFF_DISCLAIMERS],
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

function usdDeltaLine(label: string, d: BacktestNumberDelta): string {
  return `- ${label}: ${usd(d.base)} → ${usd(d.next)} (Δ ${signedUsd(d.delta)})`;
}

function numDeltaLine(label: string, d: BacktestNumberDelta): string {
  return `- ${label}: ${trimNum(d.base)} → ${trimNum(d.next)} (Δ ${signedNum(d.delta)})`;
}

function warningLine(w: BacktestLintIssue): string {
  return w.path ? `  - [${w.code}] ${w.message} (at ${w.path})` : `  - [${w.code}] ${w.message}`;
}

export interface FormatBacktestReportDiffOptions {
  /** Override the labels shown for the two reports (e.g. file names). */
  baseLabel?: string;
  nextLabel?: string;
}

/**
 * Render a redacted, human-readable, PAPER-ONLY report diff. Sectioned and stable
 * for a given diff object. Uses neutral "simulated delta" wording — never "profit"
 * or "improvement" — and keeps the simulated/injected/not-live/not-advice notes.
 */
export function formatBacktestReportDiff(
  diff: BacktestReportDiff,
  opts: FormatBacktestReportDiffOptions = {},
): string {
  const baseLabel = opts.baseLabel ?? "base";
  const nextLabel = opts.nextLabel ?? "next";
  const c = diff.compatibility;
  const lines: string[] = [];

  const header = "Backtest report diff (SIMULATED PAPER-ONLY)";
  lines.push(header);
  lines.push("=".repeat(header.length));

  // Report pair.
  lines.push("Report pair:");
  lines.push(`- base (${baseLabel}): ${c.scenarioName.base}  [${c.scenarioDigest.base}]`);
  lines.push(`- next (${nextLabel}): ${c.scenarioName.next}  [${c.scenarioDigest.next}]`);
  lines.push(`- schema: ${c.schemaVersion.base} → ${c.schemaVersion.next}`);
  lines.push("");

  // Compatibility.
  lines.push("Compatibility:");
  lines.push(`- status:     ${c.status}`);
  lines.push(`- comparable: ${c.compatible ? "yes" : "no"}`);
  lines.push(`- scenario name match:   ${c.scenarioName.match ? "yes" : "no"}`);
  lines.push(`- scenario digest match: ${c.scenarioDigest.match ? "yes" : "no"}`);
  for (const note of c.notes) lines.push(`- note: ${note}`);
  lines.push("");

  // Summary deltas.
  lines.push("Summary deltas (simulated):");
  lines.push(numDeltaLine("steps", diff.summary.stepCount));
  lines.push(numDeltaLine("candidates", diff.summary.candidateCount));
  lines.push(numDeltaLine("buy fills", diff.summary.buyFills));
  lines.push(numDeltaLine("sell fills", diff.summary.sellFills));
  lines.push(numDeltaLine("rejects", diff.summary.rejects));
  lines.push(numDeltaLine("open positions", diff.summary.openPositions));
  lines.push(numDeltaLine("closed trades", diff.summary.closedTrades));
  lines.push(usdDeltaLine("realized PnL", diff.summary.realizedPnlUsd));
  lines.push(usdDeltaLine("unrealized PnL", diff.summary.unrealizedPnlUsd));
  lines.push(usdDeltaLine("total PnL", diff.summary.totalPnlUsd));
  lines.push(usdDeltaLine("sim. notional", diff.summary.simulatedNotionalUsd));
  lines.push("");

  // Warning changes.
  lines.push(
    `Warning changes (base ${diff.warnings.baseCount} → next ${diff.warnings.nextCount}, ` +
      `Δ ${signedNum(diff.warnings.countDelta)}):`,
  );
  lines.push(`- added (${diff.warnings.added.length}):`);
  if (diff.warnings.added.length === 0) lines.push("  - (none)");
  else for (const w of diff.warnings.added) lines.push(warningLine(w));
  lines.push(`- removed (${diff.warnings.removed.length}):`);
  if (diff.warnings.removed.length === 0) lines.push("  - (none)");
  else for (const w of diff.warnings.removed) lines.push(warningLine(w));
  lines.push(`- unchanged: ${diff.warnings.unchanged.length}`);
  lines.push("");

  // Equity curve deltas.
  lines.push("Equity curve deltas (simulated, per shared step):");
  if (diff.equityCurve.common.length === 0) lines.push("- (no shared steps)");
  else {
    for (const s of diff.equityCurve.common) {
      lines.push(
        `- ${s.stepId}: total ${signedUsd(s.totalPnlUsd.delta)} ` +
          `(realized ${signedUsd(s.realizedPnlUsd.delta)}, unrealized ${signedUsd(s.unrealizedPnlUsd.delta)}); ` +
          `open ${signedNum(s.openPositionCount.delta)}; closed ${signedNum(s.closedTradeCount.delta)}`,
      );
    }
  }
  if (diff.equityCurve.addedSteps.length > 0) {
    lines.push(`- added steps (${diff.equityCurve.addedSteps.length}): ${diff.equityCurve.addedSteps.map((e) => e.stepId).join(", ")}`);
  }
  if (diff.equityCurve.removedSteps.length > 0) {
    lines.push(`- removed steps (${diff.equityCurve.removedSteps.length}): ${diff.equityCurve.removedSteps.map((e) => e.stepId).join(", ")}`);
  }
  lines.push("");

  // Per-mint deltas.
  lines.push("Per-mint deltas (simulated):");
  if (diff.perMint.common.length === 0) lines.push("- (no shared mints)");
  else {
    for (const m of diff.perMint.common) {
      lines.push(
        `- ${m.mint}: fills ${signedNum(m.buyFillCount.delta)}b/${signedNum(m.sellFillCount.delta)}s; ` +
          `open qty ${signedNum(m.openQuantity.delta)}; total ${signedUsd(m.totalPnlUsd.delta)} ` +
          `(realized ${signedUsd(m.realizedPnlUsd.delta)}, unrealized ${signedUsd(m.unrealizedPnlUsd.delta)})`,
      );
    }
  }
  if (diff.perMint.addedMints.length > 0) {
    lines.push(`- added mints (${diff.perMint.addedMints.length}): ${diff.perMint.addedMints.map((m) => m.mint).join(", ")}`);
  }
  if (diff.perMint.removedMints.length > 0) {
    lines.push(`- removed mints (${diff.perMint.removedMints.length}): ${diff.perMint.removedMints.map((m) => m.mint).join(", ")}`);
  }
  lines.push("");

  // Regression.
  lines.push(`Regression: ${diff.hasRegression ? "YES" : "no"}`);
  if (diff.hasRegression) {
    for (const r of diff.regressionReasons) lines.push(`- ${r}`);
  }
  lines.push("");

  // Notes (required disclaimers).
  lines.push("Notes:");
  for (const note of diff.disclaimers) lines.push(`- ${note}`);

  return redactString(lines.join("\n"));
}
