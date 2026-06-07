/**
 * Deterministic diff of two Sprint 15 sensitivity MATRIX reports, for regression-reviewing
 * a multi-base / cross-scenario sensitivity sweep across two runs (Sprint 15, the matrix
 * analogue of `sensitivity-diff.ts`).
 *
 * `diffScenarioVariantSensitivityMatrixReports(base, next)` validates both inputs (refusing
 * a non-matrix via the structural reader), then produces a
 * {@link ScenarioVariantSensitivityMatrixDiff}: schema/plan/matrix compatibility, top-level
 * count deltas, per-base (paired by id) added/removed/changed rows — each carrying its
 * baseline-summary delta and per-cell (paired by suffix) changes — descriptive per-variant
 * aggregate deltas, top-of-ranking movement, and a conservative `hasRegression` flag with
 * reasons. It is **pure**: no network, no RPC, no wallet, no filesystem, no `Date.now`, no
 * `Math.random`, and it never mutates its inputs (every value placed in the diff is a fresh
 * copy with stable key order, so the JSON is byte-stable for a given input pair).
 *
 * Conservative by design: a SAME-digest base or cell (identical injected content) should
 * replay byte-identically, so any simulated bookkeeping drift is a regression to review. A
 * CHANGED-digest base/cell (different content, e.g. an edited scenario) is "changed", NOT a
 * regression — EXCEPT a newly-failing baseline/cell, a removed passed base, or an increased
 * failed count, which are always regressions. A per-variant CROSS-BASE aggregate change is
 * purely descriptive (it depends on which bases ran), never a regression on its own. Every
 * number is a bookkeeping difference between two SIMULATIONS — never profit, loss, a
 * prediction, or advice.
 */

import { redactString } from "@soulmaker/security";
import type { BacktestNumberDelta } from "./diff.js";
import type { SensitivitySummaryFieldDiff } from "./sensitivity-diff.js";
import {
  BACKTEST_SENSITIVITY_MATRIX_SCHEMA_VERSION,
  type ScenarioVariantSensitivityMatrixReport,
  type ScenarioVariantSensitivityMatrixBaseEntry,
  type ScenarioVariantSensitivityMatrixCell,
  type ScenarioVariantSensitivityMatrixVariantAggregate,
  type ScenarioVariantSensitivityMatrixRankings,
} from "./sensitivity-matrix.js";
import type { BacktestSuiteEntrySummary, BacktestSuiteEntryStatus } from "./suite.js";

/** Stable schema identifier for the matrix-diff shape. Bump only on a breaking change. */
export const BACKTEST_SENSITIVITY_MATRIX_DIFF_SCHEMA_VERSION = "backtest.sensitivity.matrix.diff.v1";

/** Required disclaimers carried by every matrix diff (stable order). */
export const BACKTEST_SENSITIVITY_MATRIX_DIFF_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY sensitivity matrix diff — compares two injected, simulated matrix reports.",
  "Every value is a bookkeeping delta between two simulations, not a prediction.",
  "A negative or positive simulated delta is not profit, loss, or advice.",
  "A changed base or variant (different scenario content) is not a regression — only same-content drift is.",
  "A cross-base aggregate change is descriptive (it depends on which bases ran), never a regression on its own.",
  "Uses injected matrix report data only — no live data was fetched and nothing was traded.",
  "Not a live result. Not financial advice. Not a profitability claim.",
];

/** Thrown when an `unknown` value is not a structurally valid matrix report/diff. */
export class ScenarioVariantSensitivityMatrixDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioVariantSensitivityMatrixDiffError";
  }
}

// --- diff data model ---------------------------------------------------------

export type MatrixDiffCompatibilityStatus = "same-schema" | "schema-mismatch";

/** A single nullable-string comparison (matrix name / plan name). */
export interface MatrixDiffStringField {
  base: string | null;
  next: string | null;
  match: boolean;
}

/** Whether the two matrix reports can be meaningfully compared, and on what basis. */
export interface MatrixDiffCompatibility {
  status: MatrixDiffCompatibilityStatus;
  /** False only when the matrix report schema versions differ. */
  compatible: boolean;
  expectedSchemaVersion: string;
  schemaVersion: {
    base: string;
    next: string;
    match: boolean;
    baseIsExpected: boolean;
    nextIsExpected: boolean;
  };
  matrixName: MatrixDiffStringField;
  planName: MatrixDiffStringField;
  /** Human, redaction-safe notes explaining the compatibility verdict (stable order). */
  notes: string[];
}

/** A compact reference to one base row (for added/removed lists). */
export interface MatrixBaseRef {
  id: string;
  baseScenarioName: string | null;
  baseScenarioDigest: string | null;
  baselineStatus: BacktestSuiteEntryStatus;
  variantCount: number;
  passedVariantCount: number;
}

/** A paired (base × variant) cell present in BOTH matrices, with its drift + verdict. */
export interface MatrixCellChange {
  suffix: string;
  baseDigest: string | null;
  nextDigest: string | null;
  digestMatch: boolean;
  baseStatus: BacktestSuiteEntryStatus;
  nextStatus: BacktestSuiteEntryStatus;
  statusChanged: boolean;
  /** Summary deltas when BOTH cells ran (have a summary); null otherwise. */
  summary: SensitivitySummaryFieldDiff | null;
  isRegression: boolean;
  regressionReasons: string[];
}

/** A base row present in BOTH matrices, with its baseline delta + per-cell changes. */
export interface MatrixBaseChange {
  id: string;
  baseScenarioName: string | null;
  baseDigest: string | null;
  nextDigest: string | null;
  digestMatch: boolean;
  baseBaselineStatus: BacktestSuiteEntryStatus;
  nextBaselineStatus: BacktestSuiteEntryStatus;
  baselineStatusChanged: boolean;
  warningCount: BacktestNumberDelta;
  /** Baseline summary deltas when BOTH baselines ran; null otherwise. */
  baselineSummary: SensitivitySummaryFieldDiff | null;
  /** Only the cells that meaningfully changed (stable, suffix order from next). */
  cellsChanged: MatrixCellChange[];
  isRegression: boolean;
  regressionReasons: string[];
}

/** A per-variant CROSS-BASE aggregate change (descriptive — never a regression alone). */
export interface MatrixVariantAggregateChange {
  suffix: string;
  diffableCount: BacktestNumberDelta;
  totalPnlSum: BacktestNumberDelta;
  totalPnlMaxMagnitude: BacktestNumberDelta;
  fillMaxMagnitude: BacktestNumberDelta;
  notionalMaxMagnitude: BacktestNumberDelta;
  changed: boolean;
}

/** Movement of the top-ranked suffix for one cross-base ranking dimension. */
export interface MatrixRankingMovement {
  dimension: keyof ScenarioVariantSensitivityMatrixRankings;
  baseTop: string | null;
  nextTop: string | null;
  changed: boolean;
}

/** The full, deterministic, JSON-serializable diff of two matrix reports. */
export interface ScenarioVariantSensitivityMatrixDiff {
  schemaVersion: string;
  compatibility: MatrixDiffCompatibility;
  baseMatrixName: string | null;
  nextMatrixName: string | null;
  basePlanName: string | null;
  nextPlanName: string | null;
  baseBaseCount: number;
  nextBaseCount: number;
  baseCount: BacktestNumberDelta;
  variantCount: BacktestNumberDelta;
  passedBaseCount: BacktestNumberDelta;
  failedBaseCount: BacktestNumberDelta;
  passedVariantRunCount: BacktestNumberDelta;
  failedVariantRunCount: BacktestNumberDelta;
  warningCount: BacktestNumberDelta;
  addedBases: MatrixBaseRef[];
  removedBases: MatrixBaseRef[];
  changedBases: MatrixBaseChange[];
  variantAggregateChanges: MatrixVariantAggregateChange[];
  rankingMovement: MatrixRankingMovement[];
  hasRegression: boolean;
  regressionReasons: string[];
  disclaimers: string[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function round6(n: number): number {
  const r = Number.parseFloat(n.toFixed(6));
  return Object.is(r, -0) ? 0 : r;
}

function delta(base: number, next: number): BacktestNumberDelta {
  return { base, next, delta: round6(next - base) };
}

function stringField(base: string | null, next: string | null): MatrixDiffStringField {
  return { base, next, match: base === next };
}

const SUMMARY_FIELDS: readonly (keyof BacktestSuiteEntrySummary)[] = [
  "stepCount",
  "candidateCount",
  "buyFills",
  "sellFills",
  "rejects",
  "realizedPnlUsd",
  "unrealizedPnlUsd",
  "totalPnlUsd",
  "openPositions",
  "closedTrades",
  "simulatedNotionalUsd",
];

function summaryDiff(
  b: BacktestSuiteEntrySummary,
  n: BacktestSuiteEntrySummary,
): SensitivitySummaryFieldDiff {
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

function summaryChanged(d: SensitivitySummaryFieldDiff): boolean {
  return SUMMARY_FIELDS.some((f) => d[f].delta !== 0);
}

function usdAbs(n: number): string {
  return `$${Math.abs(n).toFixed(2)}`;
}

function refOf(b: ScenarioVariantSensitivityMatrixBaseEntry): MatrixBaseRef {
  return {
    id: b.id,
    baseScenarioName: b.baseScenarioName,
    baseScenarioDigest: b.baseScenarioDigest,
    baselineStatus: b.baselineStatus,
    variantCount: b.variantCount,
    passedVariantCount: b.passedVariantCount,
  };
}

// --- compatibility -----------------------------------------------------------

function buildCompatibility(
  base: ScenarioVariantSensitivityMatrixReport,
  next: ScenarioVariantSensitivityMatrixReport,
): MatrixDiffCompatibility {
  const expected = BACKTEST_SENSITIVITY_MATRIX_SCHEMA_VERSION;
  const match = base.schemaVersion === next.schemaVersion;
  const baseIsExpected = base.schemaVersion === expected;
  const nextIsExpected = next.schemaVersion === expected;

  const matrixName = stringField(base.matrixName, next.matrixName);
  const planName = stringField(base.planName, next.planName);

  const notes: string[] = [];
  notes.push(
    match
      ? "Same matrix report schema: base, cell, and aggregate deltas are comparable."
      : `Matrix report schema versions differ ("${base.schemaVersion}" vs "${next.schemaVersion}"); numeric deltas may not be comparable.`,
  );
  if (!planName.match) {
    notes.push(`Variant plan name differs ("${base.planName ?? "(unnamed)"}" → "${next.planName ?? "(unnamed)"}").`);
  }
  if (!matrixName.match) {
    notes.push(`Matrix name differs ("${base.matrixName ?? "(unnamed)"}" → "${next.matrixName ?? "(unnamed)"}").`);
  }
  if (!nextIsExpected) {
    notes.push(`Next matrix report schemaVersion "${next.schemaVersion}" is not the expected "${expected}".`);
  }
  if (!baseIsExpected) {
    notes.push(`Base matrix report schemaVersion "${base.schemaVersion}" is not the expected "${expected}".`);
  }

  return {
    status: match ? "same-schema" : "schema-mismatch",
    compatible: match,
    expectedSchemaVersion: expected,
    schemaVersion: { base: base.schemaVersion, next: next.schemaVersion, match, baseIsExpected, nextIsExpected },
    matrixName,
    planName,
    notes,
  };
}

// --- per-cell change ---------------------------------------------------------

function buildCellChange(
  b: ScenarioVariantSensitivityMatrixCell,
  n: ScenarioVariantSensitivityMatrixCell,
): MatrixCellChange | null {
  const digestMatch = b.scenarioDigest !== null && b.scenarioDigest === n.scenarioDigest;
  const summary = b.summary && n.summary ? summaryDiff(b.summary, n.summary) : null;
  const statusChanged = b.status !== n.status;

  const meaningful =
    !digestMatch ||
    statusChanged ||
    b.changeCount !== n.changeCount ||
    b.warningCount !== n.warningCount ||
    (summary !== null && summaryChanged(summary));
  if (!meaningful) return null;

  const change: MatrixCellChange = {
    suffix: n.suffix,
    baseDigest: b.scenarioDigest,
    nextDigest: n.scenarioDigest,
    digestMatch,
    baseStatus: b.status,
    nextStatus: n.status,
    statusChanged,
    summary,
    isRegression: false,
    regressionReasons: [],
  };

  const reasons: string[] = [];
  if (b.status === "passed" && n.status === "failed") {
    reasons.push(`cell "${n.suffix}" passed in base but failed in next`);
  }
  if (digestMatch && summary && summaryChanged(summary)) {
    reasons.push(
      `cell "${n.suffix}" has an identical digest but its simulated results differ — a ` +
        "deterministic replay should be byte-identical (an engine/config change to review)",
    );
    if (summary.totalPnlUsd.delta < 0) {
      reasons.push(`["${n.suffix}"] total simulated PnL decreased by ${usdAbs(summary.totalPnlUsd.delta)}`);
    }
    if (summary.rejects.delta > 0) {
      reasons.push(`["${n.suffix}"] paper rejects increased by ${summary.rejects.delta}`);
    }
  }
  change.regressionReasons = reasons;
  change.isRegression = reasons.length > 0;
  return change;
}

// --- per-base change ---------------------------------------------------------

function buildBaseChange(
  b: ScenarioVariantSensitivityMatrixBaseEntry,
  n: ScenarioVariantSensitivityMatrixBaseEntry,
): MatrixBaseChange {
  const digestMatch = b.baseScenarioDigest !== null && b.baseScenarioDigest === n.baseScenarioDigest;
  const baselineSummary =
    b.baselineSummary && n.baselineSummary ? summaryDiff(b.baselineSummary, n.baselineSummary) : null;
  const baselineStatusChanged = b.baselineStatus !== n.baselineStatus;

  // Pair cells by suffix; keep next's order for stability.
  const baseCellBySuffix = new Map(b.cells.map((c) => [c.suffix, c]));
  const cellsChanged: MatrixCellChange[] = [];
  for (const nCell of n.cells) {
    const bCell = baseCellBySuffix.get(nCell.suffix);
    if (!bCell) continue; // a new cell within a paired base is rare (rectangular plan)
    const change = buildCellChange(bCell, nCell);
    if (change) cellsChanged.push(change);
  }

  const reasons: string[] = [];
  if (b.baselineStatus === "passed" && n.baselineStatus === "failed") {
    reasons.push(`base "${n.id}" baseline passed in base but failed in next`);
  }
  if (digestMatch && baselineSummary && summaryChanged(baselineSummary)) {
    reasons.push(
      `base "${n.id}" has an identical scenario digest but its baseline simulated results differ — ` +
        "a deterministic replay should be byte-identical (an engine/config change to review)",
    );
  }
  for (const c of cellsChanged) {
    for (const r of c.regressionReasons) reasons.push(`[base "${n.id}"] ${r}`);
  }

  return {
    id: n.id,
    baseScenarioName: n.baseScenarioName ?? b.baseScenarioName,
    baseDigest: b.baseScenarioDigest,
    nextDigest: n.baseScenarioDigest,
    digestMatch,
    baseBaselineStatus: b.baselineStatus,
    nextBaselineStatus: n.baselineStatus,
    baselineStatusChanged,
    warningCount: delta(b.warningCount, n.warningCount),
    baselineSummary,
    cellsChanged,
    isRegression: reasons.length > 0,
    regressionReasons: reasons,
  };
}

function isMeaningfulBaseChange(c: MatrixBaseChange): boolean {
  return (
    !c.digestMatch ||
    c.baselineStatusChanged ||
    c.warningCount.delta !== 0 ||
    c.cellsChanged.length > 0 ||
    (c.baselineSummary !== null && summaryChanged(c.baselineSummary))
  );
}

// --- per-variant aggregate change --------------------------------------------

function buildAggregateChange(
  b: ScenarioVariantSensitivityMatrixVariantAggregate,
  n: ScenarioVariantSensitivityMatrixVariantAggregate,
): MatrixVariantAggregateChange {
  const diffableCount = delta(b.diffableCount, n.diffableCount);
  const totalPnlSum = delta(b.totalPnlDelta.sum, n.totalPnlDelta.sum);
  const totalPnlMaxMagnitude = delta(b.totalPnlDelta.maxMagnitude, n.totalPnlDelta.maxMagnitude);
  const fillMaxMagnitude = delta(b.fillDelta.maxMagnitude, n.fillDelta.maxMagnitude);
  const notionalMaxMagnitude = delta(b.notionalDelta.maxMagnitude, n.notionalDelta.maxMagnitude);
  const changed =
    diffableCount.delta !== 0 ||
    totalPnlSum.delta !== 0 ||
    totalPnlMaxMagnitude.delta !== 0 ||
    fillMaxMagnitude.delta !== 0 ||
    notionalMaxMagnitude.delta !== 0;
  return {
    suffix: n.suffix,
    diffableCount,
    totalPnlSum,
    totalPnlMaxMagnitude,
    fillMaxMagnitude,
    notionalMaxMagnitude,
    changed,
  };
}

// --- ranking movement --------------------------------------------------------

const RANKING_DIMENSIONS: readonly (keyof ScenarioVariantSensitivityMatrixRankings)[] = [
  "byMaxTotalPnlMagnitude",
  "byMeanTotalPnlMagnitude",
  "byMaxFillMagnitude",
  "byMaxRejectMagnitude",
  "byMaxNotionalMagnitude",
];

function topSuffix(
  rankings: ScenarioVariantSensitivityMatrixRankings,
  dimension: keyof ScenarioVariantSensitivityMatrixRankings,
): string | null {
  const top = rankings[dimension][0];
  // A ranking entry with value 0 means "no movement" — report no top to avoid noise.
  return top && top.value > 0 ? top.suffix : null;
}

function buildRankingMovement(
  base: ScenarioVariantSensitivityMatrixReport,
  next: ScenarioVariantSensitivityMatrixReport,
): MatrixRankingMovement[] {
  return RANKING_DIMENSIONS.map((dimension) => {
    const baseTop = topSuffix(base.rankings, dimension);
    const nextTop = topSuffix(next.rankings, dimension);
    return { dimension, baseTop, nextTop, changed: baseTop !== nextTop };
  });
}

// --- structural validation of an input report (lenient on schemaVersion) ----

const VALID_STATUS = new Set<string>(["passed", "failed"]);

function checkSummary(value: unknown, where: string): void {
  if (value === null) return;
  if (!isObject(value)) {
    throw new ScenarioVariantSensitivityMatrixDiffError(`${where} must be an object or null`);
  }
  for (const f of SUMMARY_FIELDS) {
    if (!isFiniteNumber(value[f])) {
      throw new ScenarioVariantSensitivityMatrixDiffError(`${where}.${f} must be a finite number`);
    }
  }
}

/**
 * Structurally validate one INPUT matrix report for diffing and narrow it. Deliberately
 * lenient on `schemaVersion` (any non-empty string) so the diff can SURFACE a version
 * mismatch rather than refuse, while being strict about every field the diff reads. Does
 * NOT mutate or normalize. Throws {@link ScenarioVariantSensitivityMatrixDiffError}.
 */
function readMatrixForDiff(value: unknown, side: string): ScenarioVariantSensitivityMatrixReport {
  if (!isObject(value)) {
    throw new ScenarioVariantSensitivityMatrixDiffError(`${side} matrix report must be a JSON object`);
  }
  if (!nonEmptyString(value.schemaVersion)) {
    throw new ScenarioVariantSensitivityMatrixDiffError(`${side} report.schemaVersion must be a non-empty string`);
  }
  for (const f of [
    "baseCount",
    "variantCount",
    "passedBaseCount",
    "failedBaseCount",
    "passedVariantRunCount",
    "failedVariantRunCount",
    "warningCount",
  ] as const) {
    if (!isFiniteNumber(value[f])) {
      throw new ScenarioVariantSensitivityMatrixDiffError(`${side} report.${f} must be a finite number`);
    }
  }
  if (!Array.isArray(value.bases)) {
    throw new ScenarioVariantSensitivityMatrixDiffError(`${side} report.bases must be an array`);
  }
  value.bases.forEach((b, i) => {
    const where = `${side} report.bases[${i}]`;
    if (!isObject(b)) throw new ScenarioVariantSensitivityMatrixDiffError(`${where} must be an object`);
    if (!nonEmptyString(b.id)) throw new ScenarioVariantSensitivityMatrixDiffError(`${where}.id must be a non-empty string`);
    if (typeof b.baselineStatus !== "string" || !VALID_STATUS.has(b.baselineStatus)) {
      throw new ScenarioVariantSensitivityMatrixDiffError(`${where}.baselineStatus must be "passed" or "failed"`);
    }
    if (b.baseScenarioDigest !== null && typeof b.baseScenarioDigest !== "string") {
      throw new ScenarioVariantSensitivityMatrixDiffError(`${where}.baseScenarioDigest must be a string or null`);
    }
    if (b.baseScenarioName !== null && typeof b.baseScenarioName !== "string") {
      throw new ScenarioVariantSensitivityMatrixDiffError(`${where}.baseScenarioName must be a string or null`);
    }
    // Every numeric field the diff reads (refOf / count deltas / the human formatter) must be finite.
    for (const f of ["variantCount", "passedVariantCount", "failedVariantCount", "warningCount"] as const) {
      if (!isFiniteNumber(b[f])) {
        throw new ScenarioVariantSensitivityMatrixDiffError(`${where}.${f} must be a finite number`);
      }
    }
    checkSummary(b.baselineSummary, `${where}.baselineSummary`);
    if (!Array.isArray(b.cells)) throw new ScenarioVariantSensitivityMatrixDiffError(`${where}.cells must be an array`);
    b.cells.forEach((c, j) => {
      const cWhere = `${where}.cells[${j}]`;
      if (!isObject(c)) throw new ScenarioVariantSensitivityMatrixDiffError(`${cWhere} must be an object`);
      if (!nonEmptyString(c.suffix)) throw new ScenarioVariantSensitivityMatrixDiffError(`${cWhere}.suffix must be a non-empty string`);
      if (typeof c.status !== "string" || !VALID_STATUS.has(c.status)) {
        throw new ScenarioVariantSensitivityMatrixDiffError(`${cWhere}.status must be "passed" or "failed"`);
      }
      // scenarioDigest drives digestMatch (the regression core); changeCount/warningCount
      // gate isMeaningfulCellChange — both are read, so both must be strictly typed.
      if (c.scenarioDigest !== null && typeof c.scenarioDigest !== "string") {
        throw new ScenarioVariantSensitivityMatrixDiffError(`${cWhere}.scenarioDigest must be a string or null`);
      }
      for (const f of ["changeCount", "warningCount"] as const) {
        if (!isFiniteNumber(c[f])) {
          throw new ScenarioVariantSensitivityMatrixDiffError(`${cWhere}.${f} must be a finite number`);
        }
      }
      checkSummary(c.summary, `${cWhere}.summary`);
    });
  });
  if (!Array.isArray(value.variantAggregates)) {
    throw new ScenarioVariantSensitivityMatrixDiffError(`${side} report.variantAggregates must be an array`);
  }
  if (!isObject(value.rankings)) {
    throw new ScenarioVariantSensitivityMatrixDiffError(`${side} report.rankings must be an object`);
  }
  for (const dim of RANKING_DIMENSIONS) {
    if (!Array.isArray(value.rankings[dim])) {
      throw new ScenarioVariantSensitivityMatrixDiffError(`${side} report.rankings.${dim} must be an array`);
    }
  }
  return value as unknown as ScenarioVariantSensitivityMatrixReport;
}

// --- public API --------------------------------------------------------------

/**
 * Compute the deterministic diff of two matrix reports. Both inputs are structurally
 * validated (a non-matrix throws {@link ScenarioVariantSensitivityMatrixDiffError}); neither
 * is mutated. Validation is lenient on `schemaVersion` so a version mismatch is surfaced,
 * not refused. Bases are paired by `id` and cells by `suffix`; the conservative regression
 * model mirrors the sensitivity diff adapted to the matrix shape.
 */
export function diffScenarioVariantSensitivityMatrixReports(
  base: unknown,
  next: unknown,
): ScenarioVariantSensitivityMatrixDiff {
  const baseReport = readMatrixForDiff(base, "base");
  const nextReport = readMatrixForDiff(next, "next");

  const compatibility = buildCompatibility(baseReport, nextReport);

  // Pair bases by id.
  const baseById = new Map(baseReport.bases.map((b) => [b.id, b]));
  const nextById = new Map(nextReport.bases.map((b) => [b.id, b]));

  const addedBases: MatrixBaseRef[] = nextReport.bases
    .filter((b) => !baseById.has(b.id))
    .map(refOf);
  const removedBases: MatrixBaseRef[] = baseReport.bases
    .filter((b) => !nextById.has(b.id))
    .map(refOf);

  const changedBases: MatrixBaseChange[] = [];
  for (const n of nextReport.bases) {
    const b = baseById.get(n.id);
    if (!b) continue;
    const change = buildBaseChange(b, n);
    if (isMeaningfulBaseChange(change)) changedBases.push(change);
  }

  // Pair variant aggregates by suffix (descriptive cross-base changes).
  const baseAggBySuffix = new Map(baseReport.variantAggregates.map((a) => [a.suffix, a]));
  const variantAggregateChanges: MatrixVariantAggregateChange[] = [];
  for (const n of nextReport.variantAggregates) {
    const b = baseAggBySuffix.get(n.suffix);
    if (!b) continue;
    const change = buildAggregateChange(b, n);
    if (change.changed) variantAggregateChanges.push(change);
  }

  const rankingMovement = buildRankingMovement(baseReport, nextReport);

  const baseCount = delta(baseReport.baseCount, nextReport.baseCount);
  const variantCount = delta(baseReport.variantCount, nextReport.variantCount);
  const passedBaseCount = delta(baseReport.passedBaseCount, nextReport.passedBaseCount);
  const failedBaseCount = delta(baseReport.failedBaseCount, nextReport.failedBaseCount);
  const passedVariantRunCount = delta(baseReport.passedVariantRunCount, nextReport.passedVariantRunCount);
  const failedVariantRunCount = delta(baseReport.failedVariantRunCount, nextReport.failedVariantRunCount);
  const warningCount = delta(baseReport.warningCount, nextReport.warningCount);

  // Aggregate regression reasons (top-level), then per-base reasons.
  const regressionReasons: string[] = [];
  if (compatibility.status === "schema-mismatch") {
    regressionReasons.push(
      `matrix report schemaVersion differs ("${compatibility.schemaVersion.base}" → "${compatibility.schemaVersion.next}")`,
    );
  }
  if (failedBaseCount.delta > 0) {
    regressionReasons.push(`failed base count increased by ${failedBaseCount.delta}`);
  }
  if (failedVariantRunCount.delta > 0) {
    regressionReasons.push(`failed variant run count increased by ${failedVariantRunCount.delta}`);
  }
  for (const r of removedBases) {
    if (r.baselineStatus === "passed") {
      regressionReasons.push(`passed base "${r.id}" from base matrix is missing from next`);
    }
  }
  for (const c of changedBases) {
    for (const r of c.regressionReasons) regressionReasons.push(r);
  }

  return {
    schemaVersion: BACKTEST_SENSITIVITY_MATRIX_DIFF_SCHEMA_VERSION,
    compatibility,
    baseMatrixName: baseReport.matrixName,
    nextMatrixName: nextReport.matrixName,
    basePlanName: baseReport.planName,
    nextPlanName: nextReport.planName,
    baseBaseCount: baseReport.baseCount,
    nextBaseCount: nextReport.baseCount,
    baseCount,
    variantCount,
    passedBaseCount,
    failedBaseCount,
    passedVariantRunCount,
    failedVariantRunCount,
    warningCount,
    addedBases,
    removedBases,
    changedBases,
    variantAggregateChanges,
    rankingMovement,
    hasRegression: regressionReasons.length > 0,
    regressionReasons,
    disclaimers: [...BACKTEST_SENSITIVITY_MATRIX_DIFF_DISCLAIMERS],
  };
}

// --- validation (backstop) ---------------------------------------------------

/**
 * Strictly validate a value as a {@link ScenarioVariantSensitivityMatrixDiff} and return it
 * narrowed. A backstop mirroring the other validators: checks the schema version, the
 * disclaimers, the regression flag/reasons, and the added/removed/changed shapes. Throws
 * {@link ScenarioVariantSensitivityMatrixDiffError} on the first problem. Pure.
 */
export function validateScenarioVariantSensitivityMatrixDiff(
  value: unknown,
): ScenarioVariantSensitivityMatrixDiff {
  if (!isObject(value)) {
    throw new ScenarioVariantSensitivityMatrixDiffError("matrix diff must be a JSON object");
  }
  if (value.schemaVersion !== BACKTEST_SENSITIVITY_MATRIX_DIFF_SCHEMA_VERSION) {
    throw new ScenarioVariantSensitivityMatrixDiffError(
      `matrix diff.schemaVersion must be "${BACKTEST_SENSITIVITY_MATRIX_DIFF_SCHEMA_VERSION}"`,
    );
  }
  if (!isObject(value.compatibility)) {
    throw new ScenarioVariantSensitivityMatrixDiffError("matrix diff.compatibility must be an object");
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new ScenarioVariantSensitivityMatrixDiffError("matrix diff.disclaimers must be a non-empty array");
  }
  if (typeof value.hasRegression !== "boolean") {
    throw new ScenarioVariantSensitivityMatrixDiffError("matrix diff.hasRegression must be a boolean");
  }
  if (!Array.isArray(value.regressionReasons)) {
    throw new ScenarioVariantSensitivityMatrixDiffError("matrix diff.regressionReasons must be an array");
  }
  for (const key of ["addedBases", "removedBases", "changedBases", "variantAggregateChanges"] as const) {
    if (!Array.isArray(value[key])) {
      throw new ScenarioVariantSensitivityMatrixDiffError(`matrix diff.${key} must be an array`);
    }
  }
  return value as unknown as ScenarioVariantSensitivityMatrixDiff;
}

// --- human formatter ---------------------------------------------------------

function trimNum(n: number): string {
  return Number.parseFloat(n.toFixed(6)).toString();
}

function signedNum(n: number): string {
  return `${n >= 0 ? "+" : ""}${trimNum(n)}`;
}

function numDeltaLine(label: string, d: BacktestNumberDelta): string {
  return `- ${label}: ${trimNum(d.base)} → ${trimNum(d.next)} (Δ ${signedNum(d.delta)})`;
}

function baseRefLine(r: MatrixBaseRef): string {
  const name = r.baseScenarioName ? `  ${r.baseScenarioName}` : "";
  const digest = r.baseScenarioDigest ? ` [${r.baseScenarioDigest}]` : "";
  return `  - ${r.id} (baseline ${r.baselineStatus}, ${r.passedVariantCount}/${r.variantCount} variant(s) passed)${name}${digest}`;
}

export interface FormatScenarioVariantSensitivityMatrixDiffOptions {
  /** Override the labels shown for the two matrices (e.g. file paths). */
  baseLabel?: string;
  nextLabel?: string;
}

/**
 * Render a redacted, human-readable, PAPER-ONLY matrix diff. Sectioned and stable for a
 * given diff object. Uses neutral "simulated drift / changed delta" wording — never
 * "profit"/"improvement" — and keeps the simulated/injected/not-live/not-advice notes.
 */
export function formatScenarioVariantSensitivityMatrixDiff(
  diff: ScenarioVariantSensitivityMatrixDiff,
  opts: FormatScenarioVariantSensitivityMatrixDiffOptions = {},
): string {
  const baseLabel = opts.baseLabel ?? diff.baseMatrixName ?? "base";
  const nextLabel = opts.nextLabel ?? diff.nextMatrixName ?? "next";
  const c = diff.compatibility;
  const lines: string[] = [];

  const header = "Sensitivity matrix diff (SIMULATED PAPER-ONLY)";
  lines.push(header);
  lines.push("=".repeat(header.length));

  lines.push("Matrix pair:");
  lines.push(`- base (${baseLabel}): plan ${diff.basePlanName ?? "(unnamed)"}  (${diff.baseBaseCount} base(s))`);
  lines.push(`- next (${nextLabel}): plan ${diff.nextPlanName ?? "(unnamed)"}  (${diff.nextBaseCount} base(s))`);
  lines.push(`- schema: ${c.schemaVersion.base} → ${c.schemaVersion.next}`);
  lines.push("");

  lines.push("Compatibility:");
  lines.push(`- status:     ${c.status}`);
  lines.push(`- comparable: ${c.compatible ? "yes" : "no"}`);
  for (const note of c.notes) lines.push(`- note: ${note}`);
  lines.push("");

  lines.push("Counts (simulated):");
  lines.push(numDeltaLine("bases", diff.baseCount));
  lines.push(numDeltaLine("variants per base", diff.variantCount));
  lines.push(numDeltaLine("baselines passed", diff.passedBaseCount));
  lines.push(numDeltaLine("baselines failed", diff.failedBaseCount));
  lines.push(numDeltaLine("variant runs passed", diff.passedVariantRunCount));
  lines.push(numDeltaLine("variant runs failed", diff.failedVariantRunCount));
  lines.push(numDeltaLine("warnings", diff.warningCount));
  lines.push("");

  lines.push(`Added bases (${diff.addedBases.length}):`);
  if (diff.addedBases.length === 0) lines.push("  - (none)");
  else for (const r of diff.addedBases) lines.push(baseRefLine(r));
  lines.push(`Removed bases (${diff.removedBases.length}):`);
  if (diff.removedBases.length === 0) lines.push("  - (none)");
  else for (const r of diff.removedBases) lines.push(baseRefLine(r));
  lines.push(`Changed bases (${diff.changedBases.length}):`);
  if (diff.changedBases.length === 0) lines.push("  - (none)");
  else {
    for (const ch of diff.changedBases) {
      const reg = ch.isRegression ? "  ⚠ regression" : "";
      lines.push(
        `  - ${ch.id} [baseline ${ch.baseBaselineStatus}→${ch.nextBaselineStatus}; digest ${ch.digestMatch ? "same" : "changed"}; ${ch.cellsChanged.length} cell(s) changed]${reg}`,
      );
    }
  }
  lines.push("");

  lines.push(`Per-variant aggregate changes (${diff.variantAggregateChanges.length}):`);
  if (diff.variantAggregateChanges.length === 0) lines.push("  - (none)");
  else {
    for (const a of diff.variantAggregateChanges) {
      lines.push(
        `  - ${a.suffix}: total-PnL Δsum ${signedNum(a.totalPnlSum.delta)}, max|Δ| ${signedNum(a.totalPnlMaxMagnitude.delta)} (descriptive)`,
      );
    }
  }
  lines.push("");

  lines.push("Top-of-ranking movement:");
  for (const m of diff.rankingMovement) {
    lines.push(
      `- ${m.dimension}: ${m.baseTop ?? "(none)"} → ${m.nextTop ?? "(none)"}${m.changed ? "  (changed)" : ""}`,
    );
  }
  lines.push("");

  lines.push(`Regression: ${diff.hasRegression ? "YES" : "no"}`);
  if (diff.hasRegression) for (const r of diff.regressionReasons) lines.push(`- ${r}`);
  lines.push("");

  lines.push("Notes:");
  for (const note of diff.disclaimers) lines.push(`- ${note}`);

  return redactString(lines.join("\n"));
}
