/**
 * Deterministic diff of two Sprint 13 SENSITIVITY reports, for regression-reviewing a
 * variant-sensitivity sweep across two runs (Sprint 14, Slice C). It is the
 * sensitivity-report analogue of {@link diffBacktestSuites} (`suite-diff.ts`).
 *
 * `diffScenarioVariantSensitivityReports(base, next)` validates both inputs (refusing
 * a non-report via {@link validateScenarioVariantSensitivityReport}), then produces a
 * {@link ScenarioVariantSensitivityDiff}: schema/base/plan compatibility, baseline
 * summary deltas, per-variant (paired by suffix) added/removed/changed lists with
 * per-field summary deltas, warning/failed-count deltas, top-of-ranking movement, and
 * a conservative `hasRegression` flag with reasons. It is **pure**: no network, no
 * RPC, no wallet, no filesystem, no `Date.now`, no `Math.random`, and it never mutates
 * its inputs (every value placed in the diff is a fresh copy with stable key order, so
 * the JSON is byte-stable for a given input pair).
 *
 * Conservative by design: a SAME-digest variant (identical variant scenario content)
 * should replay byte-identically, so any simulated bookkeeping drift is a regression
 * to review. A CHANGED-digest variant (different content, e.g. an edited base) is
 * "changed", NOT a regression — EXCEPT a newly-failing variant, which is always a
 * regression. Every number is a bookkeeping difference between two SIMULATIONS — never
 * profit, loss, a prediction, or advice.
 */

import { redactString } from "@soulmaker/security";
import type { BacktestNumberDelta } from "./diff.js";
import {
  BACKTEST_SENSITIVITY_SCHEMA_VERSION,
  type ScenarioVariantSensitivityReport,
  type ScenarioVariantSensitivityEntry,
  type ScenarioVariantSensitivityBaseline,
  type SensitivityRankings,
} from "./sensitivity.js";
import type { BacktestSuiteEntrySummary, BacktestSuiteEntryStatus } from "./suite.js";

/** Stable schema identifier for the sensitivity-diff shape. Bump only on a breaking change. */
export const BACKTEST_SENSITIVITY_DIFF_SCHEMA_VERSION = "backtest.sensitivity.diff.v1";

/** Required disclaimers carried by every sensitivity diff (stable order). */
export const BACKTEST_SENSITIVITY_DIFF_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY sensitivity diff — compares two injected, simulated sensitivity reports.",
  "Every value is a bookkeeping delta between two simulations, not a prediction.",
  "A negative or positive simulated delta is not profit, loss, or advice.",
  "A changed variant (different scenario content) is not a regression — only same-content drift is.",
  "Uses injected sensitivity report data only — no live data was fetched and nothing was traded.",
  "Not a live result. Not financial advice. Not a profitability claim.",
];

/** Thrown when an `unknown` value is not a structurally valid sensitivity report/diff. */
export class ScenarioVariantSensitivityDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioVariantSensitivityDiffError";
  }
}

// --- diff data model ---------------------------------------------------------

export type SensitivityDiffCompatibilityStatus = "same-schema" | "schema-mismatch";

/** A single nullable-string comparison (plan name / base name / base digest). */
export interface SensitivityDiffStringField {
  base: string | null;
  next: string | null;
  match: boolean;
}

/** Whether the two sensitivity reports can be meaningfully compared, and on what basis. */
export interface SensitivityDiffCompatibility {
  status: SensitivityDiffCompatibilityStatus;
  /** False only when the report schema versions differ (numeric deltas may be moot). */
  compatible: boolean;
  expectedSchemaVersion: string;
  schemaVersion: {
    base: string;
    next: string;
    match: boolean;
    baseIsExpected: boolean;
    nextIsExpected: boolean;
  };
  planName: SensitivityDiffStringField;
  baseScenarioName: SensitivityDiffStringField;
  baseScenarioDigest: SensitivityDiffStringField;
  /** Human, redaction-safe notes explaining the compatibility verdict (stable order). */
  notes: string[];
}

/** Per-field summary deltas (mirrors the 11 simulated summary fields). */
export interface SensitivitySummaryFieldDiff {
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

/** The baseline-run delta between the two reports. */
export interface SensitivityBaselineDiff {
  baseStatus: BacktestSuiteEntryStatus;
  nextStatus: BacktestSuiteEntryStatus;
  statusChanged: boolean;
  warningCount: BacktestNumberDelta;
  /** Summary deltas when BOTH baselines ran (have a summary); null otherwise. */
  summary: SensitivitySummaryFieldDiff | null;
}

/** A compact reference to one variant entry (for added/removed lists). */
export interface SensitivityVariantRef {
  suffix: string;
  scenarioName: string | null;
  scenarioDigest: string | null;
  status: BacktestSuiteEntryStatus;
}

/** A paired variant present in BOTH reports, with its deltas + regression verdict. */
export interface SensitivityVariantChange {
  suffix: string;
  scenarioName: string | null;
  baseDigest: string | null;
  nextDigest: string | null;
  digestMatch: boolean;
  baseStatus: BacktestSuiteEntryStatus;
  nextStatus: BacktestSuiteEntryStatus;
  baseChangeCount: number;
  nextChangeCount: number;
  warningCount: BacktestNumberDelta;
  warningCodes: { added: string[]; removed: string[] };
  /** Summary deltas when BOTH sides ran (have a summary); null otherwise. */
  summary: SensitivitySummaryFieldDiff | null;
  isRegression: boolean;
  regressionReasons: string[];
}

/** Movement of the top-ranked variant for one ranking dimension. */
export interface SensitivityRankingMovement {
  dimension: keyof SensitivityRankings;
  baseTop: string | null;
  nextTop: string | null;
  changed: boolean;
}

/** The full, deterministic, JSON-serializable diff of two sensitivity reports. */
export interface ScenarioVariantSensitivityDiff {
  schemaVersion: string;
  compatibility: SensitivityDiffCompatibility;
  basePlanName: string | null;
  nextPlanName: string | null;
  baseVariantCount: number;
  nextVariantCount: number;
  variantCount: BacktestNumberDelta;
  failedVariantCount: BacktestNumberDelta;
  warningCount: BacktestNumberDelta;
  baseline: SensitivityBaselineDiff;
  added: SensitivityVariantRef[];
  removed: SensitivityVariantRef[];
  changed: SensitivityVariantChange[];
  /** Subset of `changed` where the passed/failed status flipped (stable order). */
  failedChanged: SensitivityVariantChange[];
  rankingMovement: SensitivityRankingMovement[];
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

function stringField(base: string | null, next: string | null): SensitivityDiffStringField {
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

/**
 * Whether a paired variant ACTUALLY differs between the two reports. Unlike the
 * suite diff (which lists every paired entry), the sensitivity diff lists only
 * meaningful changes, so two identical reports produce an empty `changed` list.
 */
function isMeaningfulVariantChange(c: SensitivityVariantChange): boolean {
  return (
    !c.digestMatch ||
    c.baseStatus !== c.nextStatus ||
    c.baseChangeCount !== c.nextChangeCount ||
    c.warningCount.delta !== 0 ||
    c.warningCodes.added.length > 0 ||
    c.warningCodes.removed.length > 0 ||
    (c.summary !== null && summaryChanged(c.summary))
  );
}

/** Codes in `next` not in `base` (added) and in `base` not in `next` (removed), sorted. */
function warningCodeSetDiff(base: string[], next: string[]): { added: string[]; removed: string[] } {
  const baseSet = new Set(base);
  const nextSet = new Set(next);
  const added = [...new Set(next.filter((c) => !baseSet.has(c)))].sort();
  const removed = [...new Set(base.filter((c) => !nextSet.has(c)))].sort();
  return { added, removed };
}

function refOf(e: ScenarioVariantSensitivityEntry): SensitivityVariantRef {
  return {
    suffix: e.suffix,
    scenarioName: e.scenarioName,
    scenarioDigest: e.scenarioDigest,
    status: e.status,
  };
}

function usdAbs(n: number): string {
  return `$${Math.abs(n).toFixed(2)}`;
}

// --- compatibility -----------------------------------------------------------

function buildCompatibility(
  base: ScenarioVariantSensitivityReport,
  next: ScenarioVariantSensitivityReport,
): SensitivityDiffCompatibility {
  const expected = BACKTEST_SENSITIVITY_SCHEMA_VERSION;
  const match = base.schemaVersion === next.schemaVersion;
  const baseIsExpected = base.schemaVersion === expected;
  const nextIsExpected = next.schemaVersion === expected;

  const planName = stringField(base.planName, next.planName);
  const baseScenarioName = stringField(base.baseScenarioName, next.baseScenarioName);
  const baseScenarioDigest = stringField(base.baseScenarioDigest, next.baseScenarioDigest);

  const notes: string[] = [];
  if (!match) {
    notes.push(
      `Sensitivity report schema versions differ ("${base.schemaVersion}" vs "${next.schemaVersion}"); ` +
        "numeric deltas may not be comparable.",
    );
  } else {
    notes.push("Same sensitivity report schema: baseline and variant deltas are comparable.");
  }
  notes.push(
    baseScenarioDigest.match
      ? "Same base scenario digest — same-suffix variants should replay byte-identically."
      : "Base scenario digest differs — this compares two DIFFERENT base scenarios (variant changes are 'changed', not regressions).",
  );
  if (!planName.match) {
    notes.push(`Variant plan name differs ("${base.planName ?? "(unnamed)"}" → "${next.planName ?? "(unnamed)"}").`);
  }
  if (!nextIsExpected) {
    notes.push(`Next sensitivity report schemaVersion "${next.schemaVersion}" is not the expected "${expected}".`);
  }
  if (!baseIsExpected) {
    notes.push(`Base sensitivity report schemaVersion "${base.schemaVersion}" is not the expected "${expected}".`);
  }

  return {
    status: match ? "same-schema" : "schema-mismatch",
    compatible: match,
    expectedSchemaVersion: expected,
    schemaVersion: { base: base.schemaVersion, next: next.schemaVersion, match, baseIsExpected, nextIsExpected },
    planName,
    baseScenarioName,
    baseScenarioDigest,
    notes,
  };
}

// --- baseline ----------------------------------------------------------------

function buildBaselineDiff(
  base: ScenarioVariantSensitivityBaseline,
  next: ScenarioVariantSensitivityBaseline,
): SensitivityBaselineDiff {
  return {
    baseStatus: base.status,
    nextStatus: next.status,
    statusChanged: base.status !== next.status,
    warningCount: delta(base.warningCount, next.warningCount),
    summary: base.summary && next.summary ? summaryDiff(base.summary, next.summary) : null,
  };
}

// --- per-variant regression --------------------------------------------------

/**
 * Conservative, bookkeeping-oriented per-variant regression detection. A newly-failing
 * variant is ALWAYS a regression. For a SAME-digest variant (identical content), any
 * simulated drift is a regression (a deterministic replay should be byte-identical). A
 * different-digest variant is "changed", never a regression by default.
 */
function variantRegressionReasons(change: SensitivityVariantChange): string[] {
  const reasons: string[] = [];
  if (change.baseStatus === "passed" && change.nextStatus === "failed") {
    reasons.push(`variant "${change.suffix}" passed in base but failed in next`);
  }
  if (change.digestMatch && change.summary && summaryChanged(change.summary)) {
    const s = change.summary;
    reasons.push(
      `variant "${change.suffix}" has an identical digest but its simulated results differ — a ` +
        "deterministic replay should be byte-identical (an engine/config change to review)",
    );
    if (s.totalPnlUsd.delta < 0) reasons.push(`["${change.suffix}"] total simulated PnL decreased by ${usdAbs(s.totalPnlUsd.delta)}`);
    if (s.realizedPnlUsd.delta < 0) reasons.push(`["${change.suffix}"] realized simulated PnL decreased by ${usdAbs(s.realizedPnlUsd.delta)}`);
    if (s.rejects.delta > 0) reasons.push(`["${change.suffix}"] paper rejects increased by ${s.rejects.delta}`);
    if (s.buyFills.delta + s.sellFills.delta < 0) reasons.push(`["${change.suffix}"] simulated fill count dropped for an identical variant`);
  }
  if (change.digestMatch && change.warningCount.delta > 0) {
    reasons.push(`["${change.suffix}"] ${change.warningCount.delta} scenario warning(s) appeared for an identical variant`);
  }
  return reasons;
}

// --- ranking movement --------------------------------------------------------

const RANKING_DIMENSIONS: readonly (keyof SensitivityRankings)[] = [
  "byTotalSimulatedPnlDelta",
  "byRealizedSimulatedPnlDelta",
  "byUnrealizedSimulatedPnlDelta",
  "byFillDelta",
  "byRejectDelta",
  "byWarningDelta",
  "byNotionalDelta",
];

function topSuffix(rankings: SensitivityRankings, dimension: keyof SensitivityRankings): string | null {
  return rankings[dimension][0]?.suffix ?? null;
}

function buildRankingMovement(
  base: ScenarioVariantSensitivityReport,
  next: ScenarioVariantSensitivityReport,
): SensitivityRankingMovement[] {
  return RANKING_DIMENSIONS.map((dimension) => {
    const baseTop = topSuffix(base.rankings, dimension);
    const nextTop = topSuffix(next.rankings, dimension);
    return { dimension, baseTop, nextTop, changed: baseTop !== nextTop };
  });
}

// --- structural validation of an input report (lenient on schemaVersion) ----

const ENTRY_SUMMARY_FIELDS: readonly (keyof BacktestSuiteEntrySummary)[] = SUMMARY_FIELDS;
const VALID_STATUS = new Set<string>(["passed", "failed"]);

function checkEntrySummary(value: unknown, where: string): void {
  if (value === null) return; // a failed entry legitimately has a null summary
  if (!isObject(value)) {
    throw new ScenarioVariantSensitivityDiffError(`${where}.summary must be an object or null`);
  }
  for (const f of ENTRY_SUMMARY_FIELDS) {
    if (!isFiniteNumber(value[f])) {
      throw new ScenarioVariantSensitivityDiffError(`${where}.summary.${f} must be a finite number`);
    }
  }
}

/**
 * Structurally validate one INPUT sensitivity report for diffing and narrow it. Like
 * {@link import("./suite-validate.js").validateBacktestSuiteIndex}, it is deliberately
 * lenient on `schemaVersion` (any non-empty string) so the diff can SURFACE a version
 * mismatch rather than refuse, while being strict about every field the diff reads. It
 * does NOT mutate or normalize. Throws {@link ScenarioVariantSensitivityDiffError}.
 */
function readReportForDiff(value: unknown, side: string): ScenarioVariantSensitivityReport {
  if (!isObject(value)) {
    throw new ScenarioVariantSensitivityDiffError(`${side} sensitivity report must be a JSON object`);
  }
  if (!nonEmptyString(value.schemaVersion)) {
    throw new ScenarioVariantSensitivityDiffError(`${side} report.schemaVersion must be a non-empty string`);
  }
  for (const f of ["variantCount", "failedVariantCount", "warningCount"] as const) {
    if (!isFiniteNumber(value[f])) {
      throw new ScenarioVariantSensitivityDiffError(`${side} report.${f} must be a finite number`);
    }
  }
  if (!isObject(value.baseline)) {
    throw new ScenarioVariantSensitivityDiffError(`${side} report.baseline must be an object`);
  }
  if (typeof value.baseline.status !== "string" || !VALID_STATUS.has(value.baseline.status)) {
    throw new ScenarioVariantSensitivityDiffError(`${side} report.baseline.status must be "passed" or "failed"`);
  }
  if (!isFiniteNumber(value.baseline.warningCount)) {
    throw new ScenarioVariantSensitivityDiffError(`${side} report.baseline.warningCount must be a finite number`);
  }
  checkEntrySummary(value.baseline.summary, `${side} report.baseline`);
  if (!Array.isArray(value.variants)) {
    throw new ScenarioVariantSensitivityDiffError(`${side} report.variants must be an array`);
  }
  value.variants.forEach((v, i) => {
    const where = `${side} report.variants[${i}]`;
    if (!isObject(v)) throw new ScenarioVariantSensitivityDiffError(`${where} must be an object`);
    if (!nonEmptyString(v.suffix)) throw new ScenarioVariantSensitivityDiffError(`${where}.suffix must be a non-empty string`);
    if (typeof v.status !== "string" || !VALID_STATUS.has(v.status)) {
      throw new ScenarioVariantSensitivityDiffError(`${where}.status must be "passed" or "failed"`);
    }
    if (v.scenarioDigest !== null && typeof v.scenarioDigest !== "string") {
      throw new ScenarioVariantSensitivityDiffError(`${where}.scenarioDigest must be a string or null`);
    }
    if (!isFiniteNumber(v.changeCount)) throw new ScenarioVariantSensitivityDiffError(`${where}.changeCount must be a finite number`);
    if (!isFiniteNumber(v.warningCount)) throw new ScenarioVariantSensitivityDiffError(`${where}.warningCount must be a finite number`);
    if (!Array.isArray(v.warningCodes)) throw new ScenarioVariantSensitivityDiffError(`${where}.warningCodes must be an array`);
    checkEntrySummary(v.summary, where);
  });
  if (!isObject(value.rankings)) {
    throw new ScenarioVariantSensitivityDiffError(`${side} report.rankings must be an object`);
  }
  for (const dim of RANKING_DIMENSIONS) {
    if (!Array.isArray(value.rankings[dim])) {
      throw new ScenarioVariantSensitivityDiffError(`${side} report.rankings.${dim} must be an array`);
    }
  }
  return value as unknown as ScenarioVariantSensitivityReport;
}

// --- public API --------------------------------------------------------------

/**
 * Compute the deterministic diff of two sensitivity reports. Both inputs are
 * structurally validated (a non-report throws
 * {@link ScenarioVariantSensitivityDiffError}); neither is mutated. Validation is
 * lenient on `schemaVersion` so a version mismatch is surfaced, not refused. Variants
 * are paired by `suffix`; the rest mirrors the suite-diff conservative regression model
 * adapted to the sensitivity report shape.
 */
export function diffScenarioVariantSensitivityReports(
  base: unknown,
  next: unknown,
): ScenarioVariantSensitivityDiff {
  const baseReport = readReportForDiff(base, "base");
  const nextReport = readReportForDiff(next, "next");

  const compatibility = buildCompatibility(baseReport, nextReport);
  const baseline = buildBaselineDiff(baseReport.baseline, nextReport.baseline);

  // Pair variants by suffix (the stable id within a sensitivity report).
  const baseBySuffix = new Map(baseReport.variants.map((v) => [v.suffix, v]));
  const nextBySuffix = new Map(nextReport.variants.map((v) => [v.suffix, v]));

  const added: SensitivityVariantRef[] = nextReport.variants
    .filter((v) => !baseBySuffix.has(v.suffix))
    .map(refOf);
  const removed: SensitivityVariantRef[] = baseReport.variants
    .filter((v) => !nextBySuffix.has(v.suffix))
    .map(refOf);

  // Changed entries follow NEXT order.
  const changed: SensitivityVariantChange[] = [];
  for (const n of nextReport.variants) {
    const b = baseBySuffix.get(n.suffix);
    if (!b) continue;
    const digestMatch = b.scenarioDigest !== null && b.scenarioDigest === n.scenarioDigest;
    const change: SensitivityVariantChange = {
      suffix: n.suffix,
      scenarioName: n.scenarioName ?? b.scenarioName,
      baseDigest: b.scenarioDigest,
      nextDigest: n.scenarioDigest,
      digestMatch,
      baseStatus: b.status,
      nextStatus: n.status,
      baseChangeCount: b.changeCount,
      nextChangeCount: n.changeCount,
      warningCount: delta(b.warningCount, n.warningCount),
      warningCodes: warningCodeSetDiff(b.warningCodes, n.warningCodes),
      summary: b.summary && n.summary ? summaryDiff(b.summary, n.summary) : null,
      isRegression: false,
      regressionReasons: [],
    };
    if (!isMeaningfulVariantChange(change)) continue;
    change.regressionReasons = variantRegressionReasons(change);
    change.isRegression = change.regressionReasons.length > 0;
    changed.push(change);
  }
  const failedChanged = changed.filter((c) => c.baseStatus !== c.nextStatus);

  const rankingMovement = buildRankingMovement(baseReport, nextReport);

  const failedVariantCount = delta(baseReport.failedVariantCount, nextReport.failedVariantCount);
  const warningCount = delta(baseReport.warningCount, nextReport.warningCount);

  // Aggregate regression reasons (top-level), then per-entry reasons.
  const regressionReasons: string[] = [];
  if (compatibility.status === "schema-mismatch") {
    regressionReasons.push(
      `sensitivity report schemaVersion differs ("${compatibility.schemaVersion.base}" → "${compatibility.schemaVersion.next}")`,
    );
  }
  if (failedVariantCount.delta > 0) {
    regressionReasons.push(`failed variant count increased by ${failedVariantCount.delta}`);
  }
  // A passed variant present in base but missing from next is lost coverage.
  for (const r of removed) {
    if (r.status === "passed") {
      regressionReasons.push(`passed variant "${r.suffix}" from base is missing from next`);
    }
  }
  // Baseline drift when the base scenario is identical (digests match).
  if (baseline.statusChanged && baseline.baseStatus === "passed" && baseline.nextStatus === "failed") {
    regressionReasons.push("the baseline passed in base but failed in next");
  }
  if (compatibility.baseScenarioDigest.match && baseline.summary && summaryChanged(baseline.summary)) {
    regressionReasons.push(
      "baseline simulated results drifted for an identical base scenario (a deterministic replay should be byte-identical)",
    );
  }
  for (const c of changed) {
    for (const r of c.regressionReasons) regressionReasons.push(r);
  }

  return {
    schemaVersion: BACKTEST_SENSITIVITY_DIFF_SCHEMA_VERSION,
    compatibility,
    basePlanName: baseReport.planName,
    nextPlanName: nextReport.planName,
    baseVariantCount: baseReport.variantCount,
    nextVariantCount: nextReport.variantCount,
    variantCount: delta(baseReport.variantCount, nextReport.variantCount),
    failedVariantCount,
    warningCount,
    baseline,
    added,
    removed,
    changed,
    failedChanged,
    rankingMovement,
    hasRegression: regressionReasons.length > 0,
    regressionReasons,
    disclaimers: [...BACKTEST_SENSITIVITY_DIFF_DISCLAIMERS],
  };
}

// --- validation (backstop) ---------------------------------------------------

/**
 * Strictly validate a value as a {@link ScenarioVariantSensitivityDiff} and return it
 * narrowed. A backstop mirroring the other validators: checks the schema version, the
 * disclaimers, the regression flag/reasons, and the added/removed/changed shapes.
 * Throws {@link ScenarioVariantSensitivityDiffError} on the first problem. Pure.
 */
export function validateScenarioVariantSensitivityDiff(
  value: unknown,
): ScenarioVariantSensitivityDiff {
  if (!isObject(value)) {
    throw new ScenarioVariantSensitivityDiffError("diff must be a JSON object");
  }
  if (value.schemaVersion !== BACKTEST_SENSITIVITY_DIFF_SCHEMA_VERSION) {
    throw new ScenarioVariantSensitivityDiffError(
      `diff.schemaVersion must be "${BACKTEST_SENSITIVITY_DIFF_SCHEMA_VERSION}"`,
    );
  }
  if (!isObject(value.compatibility)) {
    throw new ScenarioVariantSensitivityDiffError("diff.compatibility must be an object");
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new ScenarioVariantSensitivityDiffError("diff.disclaimers must be a non-empty array");
  }
  if (typeof value.hasRegression !== "boolean") {
    throw new ScenarioVariantSensitivityDiffError("diff.hasRegression must be a boolean");
  }
  if (!Array.isArray(value.regressionReasons)) {
    throw new ScenarioVariantSensitivityDiffError("diff.regressionReasons must be an array");
  }
  for (const key of ["added", "removed", "changed"] as const) {
    if (!Array.isArray(value[key])) {
      throw new ScenarioVariantSensitivityDiffError(`diff.${key} must be an array`);
    }
  }
  return value as unknown as ScenarioVariantSensitivityDiff;
}

// --- human formatter ---------------------------------------------------------

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

function refLine(r: SensitivityVariantRef): string {
  const name = r.scenarioName ? `  ${r.scenarioName}` : "";
  const digest = r.scenarioDigest ? ` [${r.scenarioDigest}]` : "";
  return `  - ${r.suffix} (${r.status})${name}${digest}`;
}

export interface FormatScenarioVariantSensitivityDiffOptions {
  /** Override the labels shown for the two reports (e.g. file paths). */
  baseLabel?: string;
  nextLabel?: string;
}

/**
 * Render a redacted, human-readable, PAPER-ONLY sensitivity diff. Sectioned and stable
 * for a given diff object. Uses neutral "simulated drift / changed delta" wording —
 * never "profit"/"improvement" — and keeps the simulated/injected/not-live/not-advice
 * notes.
 */
export function formatScenarioVariantSensitivityDiff(
  diff: ScenarioVariantSensitivityDiff,
  opts: FormatScenarioVariantSensitivityDiffOptions = {},
): string {
  const baseLabel = opts.baseLabel ?? diff.basePlanName ?? "base";
  const nextLabel = opts.nextLabel ?? diff.nextPlanName ?? "next";
  const c = diff.compatibility;
  const lines: string[] = [];

  const header = "Sensitivity report diff (SIMULATED PAPER-ONLY)";
  lines.push(header);
  lines.push("=".repeat(header.length));

  lines.push("Report pair:");
  lines.push(`- base (${baseLabel}): plan ${diff.basePlanName ?? "(unnamed)"}  (${diff.baseVariantCount} variants)`);
  lines.push(`- next (${nextLabel}): plan ${diff.nextPlanName ?? "(unnamed)"}  (${diff.nextVariantCount} variants)`);
  lines.push(`- schema: ${c.schemaVersion.base} → ${c.schemaVersion.next}`);
  lines.push(`- base scenario digest: ${c.baseScenarioDigest.base ?? "(none)"} → ${c.baseScenarioDigest.next ?? "(none)"} (${c.baseScenarioDigest.match ? "same" : "changed"})`);
  lines.push("");

  lines.push("Compatibility:");
  lines.push(`- status:     ${c.status}`);
  lines.push(`- comparable: ${c.compatible ? "yes" : "no"}`);
  for (const note of c.notes) lines.push(`- note: ${note}`);
  lines.push("");

  lines.push("Counts (simulated):");
  lines.push(numDeltaLine("variants", diff.variantCount));
  lines.push(numDeltaLine("failed variants", diff.failedVariantCount));
  lines.push(numDeltaLine("warnings", diff.warningCount));
  lines.push("");

  lines.push("Baseline:");
  lines.push(`- status: ${diff.baseline.baseStatus} → ${diff.baseline.nextStatus}${diff.baseline.statusChanged ? "  (changed)" : ""}`);
  lines.push(numDeltaLine("baseline warnings", diff.baseline.warningCount));
  if (diff.baseline.summary) {
    lines.push(numDeltaLine("baseline total PnL", diff.baseline.summary.totalPnlUsd));
    lines.push(numDeltaLine("baseline fills (buy)", diff.baseline.summary.buyFills));
    lines.push(numDeltaLine("baseline rejects", diff.baseline.summary.rejects));
  } else {
    lines.push("- baseline summary delta: (one side did not run)");
  }
  lines.push("");

  lines.push(`Added variants (${diff.added.length}):`);
  if (diff.added.length === 0) lines.push("  - (none)");
  else for (const r of diff.added) lines.push(refLine(r));
  lines.push(`Removed variants (${diff.removed.length}):`);
  if (diff.removed.length === 0) lines.push("  - (none)");
  else for (const r of diff.removed) lines.push(refLine(r));
  lines.push(`Changed variants (${diff.changed.length}):`);
  if (diff.changed.length === 0) lines.push("  - (none)");
  else {
    for (const ch of diff.changed) {
      const total = ch.summary ? ` total ${signedUsd(ch.summary.totalPnlUsd.delta)}` : "";
      const reg = ch.isRegression ? "  ⚠ regression" : "";
      lines.push(
        `  - ${ch.suffix} [${ch.baseStatus}→${ch.nextStatus}; digest ${ch.digestMatch ? "same" : "changed"}]${total}${reg}`,
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
