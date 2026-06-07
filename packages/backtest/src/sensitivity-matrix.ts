/**
 * Deterministic, offline, **simulated-only** MULTI-BASE sensitivity MATRIX (Sprint 15).
 *
 * Sprint 13 answered "how sensitive is ONE base scenario to a bounded perturbation of
 * its injected data?". This module answers the cross-scenario question: "how does the
 * SAME bounded variant plan move the simulated bookkeeping across SEVERAL injected base
 * scenarios?". It:
 *
 *   1. takes N already-parsed base scenarios (each with a stable, unique id) and ONE
 *      shared variant plan;
 *   2. runs the EXACT Sprint 13 {@link runScenarioVariantSensitivity} workflow for each
 *      base against that one plan (so every base re-uses the real Sprint 11 suite path
 *      and Sprint 12 variant generator — nothing is re-implemented here); and
 *   3. aggregates every (base × variant) cell into one stable, versioned matrix report:
 *      per-base rows, per-variant cross-base aggregates (sum / signed min・max / mean &
 *      max magnitude of each simulated delta), and deterministic cross-base rankings.
 *
 * Rectangular by construction: the plan is shared, so every base produces the same
 * ordered set of variant suffixes; the runner asserts this (a wiring backstop). A base
 * that is structurally invalid, or that is incompatible with the plan (a perturbation
 * matching none of its injected values), refuses the WHOLE matrix — named by its id —
 * before any aggregate is built, so there is never a partial matrix.
 *
 * Pure: no network, no RPC, no filesystem, no `Date.now`, no `Math.random`, no RNG of
 * any kind. Non-mutating: each base scenario and the plan are never modified (every
 * underlying sensitivity run deep-copies before running). The report carries NO
 * timestamps, so identical inputs produce a byte-identical report.
 *
 * Every number is simulated USD bookkeeping computed from injected prices. A delta is
 * the change between two simulated runs of ONE base; a cross-base aggregate is plain
 * arithmetic over those deltas — it is NOT a live result, NOT real market performance,
 * NOT a prediction, NOT a profitability claim, and NOT financial advice. Comparing two
 * different base scenarios is a bookkeeping comparison, never a "which token is better"
 * claim. Nothing here builds, signs, simulates, or sends a transaction.
 */

import { ScenarioVariantError } from "./scenario-variants.js";
import {
  runScenarioVariantSensitivity,
  type ScenarioVariantSensitivityRun,
  type ScenarioVariantSensitivityReport,
  type ScenarioVariantSensitivityEntry,
  type SensitivitySummaryDeltas,
} from "./sensitivity.js";
import type { BacktestSuiteEntrySummary, BacktestSuiteEntryStatus } from "./suite.js";

/** Stable schema identifier for the sensitivity matrix report. Bump only on a breaking change. */
export const BACKTEST_SENSITIVITY_MATRIX_SCHEMA_VERSION = "backtest.sensitivity.matrix.v1";

/** The banner that prefixes every sensitivity matrix report (required label). */
export const BACKTEST_SENSITIVITY_MATRIX_BANNER = "SIMULATED PAPER-ONLY SENSITIVITY MATRIX";

/** Required disclaimer statements carried by every matrix report (stable order). */
export const BACKTEST_SENSITIVITY_MATRIX_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SENSITIVITY MATRIX — sweeps one variant plan across several base scenarios.",
  "Uses injected, simulated local scenario data only.",
  "Not a live result.",
  "Not financial advice.",
  "Not a profitability claim.",
  "Every total, delta, and aggregate is bookkeeping summed from injected prices, not real market performance.",
  "A delta is the change between two simulated runs of ONE base; a cross-base aggregate is arithmetic over those deltas.",
  "Comparing two different base scenarios is a bookkeeping comparison, never a 'which token is better' claim.",
  "No transaction was built, signed, simulated, or sent.",
];

/** Thrown only when the matrix INPUT or a produced matrix REPORT is structurally invalid. */
export class ScenarioVariantSensitivityMatrixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioVariantSensitivityMatrixError";
  }
}

// --- input -------------------------------------------------------------------

/** One base scenario to sweep, with a stable id (the filename stem at the CLI). */
export interface ScenarioVariantSensitivityMatrixBase {
  /** A non-empty id, unique within the matrix (used as the base row key). */
  id: string;
  /** The base scenario JSON value (validated by the underlying sensitivity run). */
  scenario: unknown;
}

/** The already-parsed local JSON values this matrix runs over. */
export interface ScenarioVariantSensitivityMatrixInput {
  /** Optional matrix label (e.g. the scenarios directory name). */
  name?: string;
  /** The base scenarios to sweep (≥1), each with a unique id. */
  bases: ScenarioVariantSensitivityMatrixBase[];
  /** The SHARED variant plan JSON value applied to every base. */
  plan: unknown;
}

// --- report model ------------------------------------------------------------

/**
 * One (base × variant) cell: a variant's outcome under a SINGLE base, plus its per-field
 * delta versus THAT base's baseline. Mirrors the Sprint 13 per-variant entry, trimmed to
 * the fields a matrix needs (no invented metric).
 */
export interface ScenarioVariantSensitivityMatrixCell {
  /** The variant suffix (its underlying suite entry id). */
  suffix: string;
  /** The variant's scenario digest when it ran, else null. */
  scenarioDigest: string | null;
  status: BacktestSuiteEntryStatus;
  /** How many injected numeric values this variant's perturbations changed for this base. */
  changeCount: number;
  warningCount: number;
  /** Exact simulated summary on pass; null when the variant failed/did not run. */
  summary: BacktestSuiteEntrySummary | null;
  /** Per-field deltas vs this base's baseline; null when either side has no summary. */
  deltas: SensitivitySummaryDeltas | null;
}

/** One base's row in the matrix: its baseline plus a cell per variant (in plan order). */
export interface ScenarioVariantSensitivityMatrixBaseEntry {
  /** 0-based position in the deterministically id-sorted base list. */
  index: number;
  /** The base id (unique within the matrix). */
  id: string;
  baseScenarioName: string | null;
  baseScenarioDigest: string | null;
  baselineStatus: BacktestSuiteEntryStatus;
  /** The baseline's simulated summary when it ran; null only if it failed. */
  baselineSummary: BacktestSuiteEntrySummary | null;
  variantCount: number;
  passedVariantCount: number;
  failedVariantCount: number;
  /** Total lint warnings for this base (its baseline AND every variant). */
  warningCount: number;
  /** One cell per variant suffix, in plan order. */
  cells: ScenarioVariantSensitivityMatrixCell[];
}

/**
 * The cross-base aggregate of one numeric delta dimension for a single variant suffix.
 * Computed over the DIFFABLE cells only (a passed variant with a passed baseline). When
 * no cell is diffable every field is 0. `meanMagnitude`/`maxMagnitude` use `|delta|`, so
 * they measure the SIZE of the cross-base movement regardless of direction.
 */
export interface ScenarioVariantSensitivityMatrixDeltaStat {
  /** Number of diffable cells contributing to this aggregate. */
  count: number;
  /** Sum of the signed deltas across diffable cells. */
  sum: number;
  /** Smallest (most negative) signed delta across diffable cells. */
  min: number;
  /** Largest (most positive) signed delta across diffable cells. */
  max: number;
  /** Mean of `|delta|` across diffable cells (0 when count === 0). */
  meanMagnitude: number;
  /** Max of `|delta|` across diffable cells (0 when count === 0). */
  maxMagnitude: number;
}

/**
 * The cross-base aggregate for ONE variant suffix: how the same bounded perturbation moved
 * each simulated dimension across all the bases it ran on. Every dimension reuses a REAL
 * per-field delta already in the cells — nothing is invented. Bookkeeping only.
 */
export interface ScenarioVariantSensitivityMatrixVariantAggregate {
  suffix: string;
  /** Number of bases in which this suffix appeared (== baseCount with one shared plan). */
  baseCount: number;
  /** Cells where the variant passed. */
  passedCount: number;
  /** Cells where the variant failed/did not run. */
  failedCount: number;
  /** Cells with a non-null delta (variant passed AND its baseline passed). */
  diffableCount: number;
  totalPnlDelta: ScenarioVariantSensitivityMatrixDeltaStat;
  realizedPnlDelta: ScenarioVariantSensitivityMatrixDeltaStat;
  unrealizedPnlDelta: ScenarioVariantSensitivityMatrixDeltaStat;
  /** Buy + sell fill-count delta. */
  fillDelta: ScenarioVariantSensitivityMatrixDeltaStat;
  rejectDelta: ScenarioVariantSensitivityMatrixDeltaStat;
  notionalDelta: ScenarioVariantSensitivityMatrixDeltaStat;
}

/** One ranked variant suffix under a single cross-base ranking dimension. */
export interface ScenarioVariantSensitivityMatrixRankingEntry {
  suffix: string;
  /** The aggregate magnitude (≥ 0) being ranked, e.g. the max |totalPnl delta| across bases. */
  value: number;
  /** How many diffable cells contributed to `value`. */
  diffableCount: number;
}

/**
 * Deterministic cross-base rankings of the variant suffixes by the SIZE of each simulated
 * bookkeeping movement across the bases. Each list is ordered by `value` descending
 * (largest movement first), ties broken stably by `suffix` ascending, so the order never
 * depends on plan/base/input order. A suffix with no diffable cell ranks last with value 0.
 * These are NOT a "best"/"winner"/"most profitable" ordering — only the largest simulated
 * movement across the swept bases.
 */
export interface ScenarioVariantSensitivityMatrixRankings {
  /** By the max |total-PnL delta| any base showed for the suffix. */
  byMaxTotalPnlMagnitude: ScenarioVariantSensitivityMatrixRankingEntry[];
  /** By the mean |total-PnL delta| across the bases for the suffix. */
  byMeanTotalPnlMagnitude: ScenarioVariantSensitivityMatrixRankingEntry[];
  /** By the max |fill-count delta| any base showed. */
  byMaxFillMagnitude: ScenarioVariantSensitivityMatrixRankingEntry[];
  /** By the max |reject-count delta| any base showed. */
  byMaxRejectMagnitude: ScenarioVariantSensitivityMatrixRankingEntry[];
  /** By the max |simulated-notional delta| any base showed. */
  byMaxNotionalMagnitude: ScenarioVariantSensitivityMatrixRankingEntry[];
}

/**
 * The full, deterministic, byte-stable sensitivity matrix report. JSON-serializable as-is.
 * Carries the required PAPER-ONLY / not-a-live-result / not-advice / not-a-profitability
 * language so it survives serialization. It is simulated bookkeeping across injected base
 * scenarios — never a live result, never a prediction, never a profitability claim.
 */
export interface ScenarioVariantSensitivityMatrixReport {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  /** Stable report label: the matrix name when present, else the plan name, else null. */
  label: string | null;
  matrixName: string | null;
  planName: string | null;
  /** Number of base scenarios swept. */
  baseCount: number;
  /** Number of distinct variant suffixes (== the shared plan's variant count). */
  variantCount: number;
  /** Bases whose baseline passed / failed. */
  passedBaseCount: number;
  failedBaseCount: number;
  /** Total passed / failed variant runs across all bases (baseCount × variantCount cells). */
  passedVariantRunCount: number;
  failedVariantRunCount: number;
  /** Total lint warnings across every base (each base's baseline + variants). */
  warningCount: number;
  /** One row per base, ordered by id ascending. */
  bases: ScenarioVariantSensitivityMatrixBaseEntry[];
  /** One aggregate per variant suffix, ordered by suffix ascending. */
  variantAggregates: ScenarioVariantSensitivityMatrixVariantAggregate[];
  /**
   * Deterministic cross-base rankings of the variant suffixes by the magnitude of each
   * simulated movement across the bases (largest first). Bookkeeping ordering only —
   * never a "best"/"winner"/"most profitable" ranking.
   */
  rankings: ScenarioVariantSensitivityMatrixRankings;
  /** Bookkeeping-only notes (never profitability claims). */
  notes: string[];
}

/** Everything {@link runScenarioVariantSensitivityMatrix} produces (carries artifacts for a CLI). */
export interface ScenarioVariantSensitivityMatrixRun {
  /** The per-base Sprint 13 sensitivity runs, in id-sorted order (carry full artifacts). */
  baseRuns: { id: string; run: ScenarioVariantSensitivityRun }[];
  /** The stable Sprint 15 matrix report. */
  report: ScenarioVariantSensitivityMatrixReport;
}

// --- small, local helpers ----------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Round to 6 decimals deterministically (kills float noise; normalizes -0 to 0). */
function round6(n: number): number {
  const r = Number.parseFloat(n.toFixed(6));
  return Object.is(r, -0) ? 0 : r;
}

/** `|value|` normalized to kill -0 and float noise (a stable, non-negative sort key). */
function magnitudeOf(value: number): number {
  return round6(Math.abs(value));
}

// --- aggregation -------------------------------------------------------------

/**
 * The fixed numeric dimensions a {@link ScenarioVariantSensitivityMatrixVariantAggregate}
 * carries, each mapping a cell's per-field delta to one signed value. Order is stable.
 */
const AGGREGATE_DIMENSIONS = [
  "totalPnlDelta",
  "realizedPnlDelta",
  "unrealizedPnlDelta",
  "fillDelta",
  "rejectDelta",
  "notionalDelta",
] as const;

type AggregateDimension = (typeof AGGREGATE_DIMENSIONS)[number];

/** Map a (non-null) cell delta set to the signed value for one aggregate dimension. */
function selectDelta(deltas: SensitivitySummaryDeltas, dimension: AggregateDimension): number {
  switch (dimension) {
    case "totalPnlDelta":
      return deltas.totalPnlUsd.delta;
    case "realizedPnlDelta":
      return deltas.realizedPnlUsd.delta;
    case "unrealizedPnlDelta":
      return deltas.unrealizedPnlUsd.delta;
    case "fillDelta":
      return deltas.buyFills.delta + deltas.sellFills.delta;
    case "rejectDelta":
      return deltas.rejects.delta;
    case "notionalDelta":
      return deltas.simulatedNotionalUsd.delta;
  }
}

/** Build one delta aggregate from a list of signed delta values (already collected). */
function aggregateStat(values: number[]): ScenarioVariantSensitivityMatrixDeltaStat {
  if (values.length === 0) {
    return { count: 0, sum: 0, min: 0, max: 0, meanMagnitude: 0, maxMagnitude: 0 };
  }
  let sum = 0;
  let min = values[0] as number;
  let max = values[0] as number;
  let magnitudeSum = 0;
  let maxMagnitude = 0;
  for (const v of values) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
    const mag = Math.abs(v);
    magnitudeSum += mag;
    if (mag > maxMagnitude) maxMagnitude = mag;
  }
  return {
    count: values.length,
    sum: round6(sum),
    min: round6(min),
    max: round6(max),
    meanMagnitude: round6(magnitudeSum / values.length),
    maxMagnitude: round6(maxMagnitude),
  };
}

/**
 * Build the per-suffix cross-base aggregates from the matrix rows. For each variant suffix
 * (the union across bases — identical for one shared plan), it walks every base's matching
 * cell, counts passed/failed/diffable, and aggregates each numeric dimension over the
 * diffable cells. Returned sorted by suffix ascending. Pure; never mutates.
 */
function buildVariantAggregates(
  bases: ScenarioVariantSensitivityMatrixBaseEntry[],
): ScenarioVariantSensitivityMatrixVariantAggregate[] {
  // Preserve first-seen order while collecting the union of suffixes, then sort.
  const suffixes: string[] = [];
  const seen = new Set<string>();
  for (const base of bases) {
    for (const cell of base.cells) {
      if (!seen.has(cell.suffix)) {
        seen.add(cell.suffix);
        suffixes.push(cell.suffix);
      }
    }
  }
  suffixes.sort();

  return suffixes.map((suffix) => {
    let baseCount = 0;
    let passedCount = 0;
    let failedCount = 0;
    let diffableCount = 0;
    const values: Record<AggregateDimension, number[]> = {
      totalPnlDelta: [],
      realizedPnlDelta: [],
      unrealizedPnlDelta: [],
      fillDelta: [],
      rejectDelta: [],
      notionalDelta: [],
    };
    for (const base of bases) {
      const cell = base.cells.find((c) => c.suffix === suffix);
      if (!cell) continue;
      baseCount += 1;
      if (cell.status === "passed") passedCount += 1;
      else failedCount += 1;
      if (cell.deltas !== null) {
        diffableCount += 1;
        for (const dim of AGGREGATE_DIMENSIONS) {
          values[dim].push(selectDelta(cell.deltas, dim));
        }
      }
    }
    return {
      suffix,
      baseCount,
      passedCount,
      failedCount,
      diffableCount,
      totalPnlDelta: aggregateStat(values.totalPnlDelta),
      realizedPnlDelta: aggregateStat(values.realizedPnlDelta),
      unrealizedPnlDelta: aggregateStat(values.unrealizedPnlDelta),
      fillDelta: aggregateStat(values.fillDelta),
      rejectDelta: aggregateStat(values.rejectDelta),
      notionalDelta: aggregateStat(values.notionalDelta),
    };
  });
}

/**
 * Rank the variant suffixes by one non-negative aggregate magnitude, largest first. Pure
 * and deterministic: ties on `value` resolve by `suffix` ascending, so the order never
 * depends on plan/base/input order.
 */
function rankBy(
  aggregates: ScenarioVariantSensitivityMatrixVariantAggregate[],
  select: (a: ScenarioVariantSensitivityMatrixVariantAggregate) => number,
): ScenarioVariantSensitivityMatrixRankingEntry[] {
  const entries = aggregates.map((a) => ({
    suffix: a.suffix,
    value: magnitudeOf(select(a)),
    diffableCount: a.diffableCount,
  }));
  entries.sort((x, y) => {
    if (y.value !== x.value) return y.value - x.value;
    return x.suffix < y.suffix ? -1 : x.suffix > y.suffix ? 1 : 0;
  });
  return entries;
}

function buildRankings(
  aggregates: ScenarioVariantSensitivityMatrixVariantAggregate[],
): ScenarioVariantSensitivityMatrixRankings {
  return {
    byMaxTotalPnlMagnitude: rankBy(aggregates, (a) => a.totalPnlDelta.maxMagnitude),
    byMeanTotalPnlMagnitude: rankBy(aggregates, (a) => a.totalPnlDelta.meanMagnitude),
    byMaxFillMagnitude: rankBy(aggregates, (a) => a.fillDelta.maxMagnitude),
    byMaxRejectMagnitude: rankBy(aggregates, (a) => a.rejectDelta.maxMagnitude),
    byMaxNotionalMagnitude: rankBy(aggregates, (a) => a.notionalDelta.maxMagnitude),
  };
}

// --- per-base row ------------------------------------------------------------

/** Trim a Sprint 13 per-variant entry to a matrix cell (a fresh, stable-key copy). */
function cellOf(entry: ScenarioVariantSensitivityEntry): ScenarioVariantSensitivityMatrixCell {
  return {
    suffix: entry.suffix,
    scenarioDigest: entry.scenarioDigest,
    status: entry.status,
    changeCount: entry.changeCount,
    warningCount: entry.warningCount,
    summary: entry.summary ? { ...entry.summary } : null,
    deltas: entry.deltas ? cloneDeltas(entry.deltas) : null,
  };
}

/** Deep-copy a deltas object field-by-field (stable key order, no shared references). */
function cloneDeltas(d: SensitivitySummaryDeltas): SensitivitySummaryDeltas {
  return {
    stepCount: { ...d.stepCount },
    candidateCount: { ...d.candidateCount },
    buyFills: { ...d.buyFills },
    sellFills: { ...d.sellFills },
    rejects: { ...d.rejects },
    realizedPnlUsd: { ...d.realizedPnlUsd },
    unrealizedPnlUsd: { ...d.unrealizedPnlUsd },
    totalPnlUsd: { ...d.totalPnlUsd },
    openPositions: { ...d.openPositions },
    closedTrades: { ...d.closedTrades },
    simulatedNotionalUsd: { ...d.simulatedNotionalUsd },
  };
}

/** Build one base row from its id and Sprint 13 sensitivity report. */
function baseEntryOf(
  index: number,
  id: string,
  report: ScenarioVariantSensitivityReport,
): ScenarioVariantSensitivityMatrixBaseEntry {
  return {
    index,
    id,
    baseScenarioName: report.baseScenarioName,
    baseScenarioDigest: report.baseScenarioDigest,
    baselineStatus: report.baseline.status,
    baselineSummary: report.baseline.summary ? { ...report.baseline.summary } : null,
    variantCount: report.variantCount,
    passedVariantCount: report.passedVariantCount,
    failedVariantCount: report.failedVariantCount,
    warningCount: report.warningCount,
    cells: report.variants.map(cellOf),
  };
}

// --- report builder ----------------------------------------------------------

/** Options for {@link buildScenarioVariantSensitivityMatrixReport}. */
export interface BuildScenarioVariantSensitivityMatrixOptions {
  /** Optional matrix label (e.g. the scenarios directory name). */
  name?: string | null;
}

/**
 * Build a deterministic, byte-stable {@link ScenarioVariantSensitivityMatrixReport} from a
 * list of (id, Sprint 13 report) base runs. The bases are sorted by id ascending; every
 * base MUST carry the SAME ordered set of variant suffixes (the runner guarantees this).
 * Pure and non-mutating. Throws {@link ScenarioVariantSensitivityMatrixError} if the rows
 * are empty, an id is duplicated, or the suffix sets are not rectangular.
 */
export function buildScenarioVariantSensitivityMatrixReport(
  baseRuns: { id: string; report: ScenarioVariantSensitivityReport }[],
  opts: BuildScenarioVariantSensitivityMatrixOptions = {},
): ScenarioVariantSensitivityMatrixReport {
  if (baseRuns.length === 0) {
    throw new ScenarioVariantSensitivityMatrixError("matrix requires at least one base run");
  }

  // Stable order: sort base rows by id ascending (independent of input order).
  const sorted = [...baseRuns].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const ids = new Set<string>();
  for (const { id } of sorted) {
    if (!nonEmptyString(id)) {
      throw new ScenarioVariantSensitivityMatrixError("every base id must be a non-empty string");
    }
    if (ids.has(id)) {
      throw new ScenarioVariantSensitivityMatrixError(`duplicate base id "${id}"`);
    }
    ids.add(id);
  }

  const bases = sorted.map(({ id, report }, i) => baseEntryOf(i, id, report));

  // Rectangular check: every base must carry the same ordered variant suffixes.
  const reference = bases[0]!.cells.map((c) => c.suffix);
  const refKey = reference.join(" ");
  for (const base of bases) {
    if (base.cells.map((c) => c.suffix).join(" ") !== refKey) {
      throw new ScenarioVariantSensitivityMatrixError(
        `base "${base.id}" has a different variant set than base "${bases[0]!.id}" — ` +
          "every base must be swept through the same plan",
      );
    }
  }

  const planName = sorted[0]!.report.planName;
  const matrixName = opts.name ?? null;

  let passedBaseCount = 0;
  let failedBaseCount = 0;
  let passedVariantRunCount = 0;
  let failedVariantRunCount = 0;
  let warningCount = 0;
  for (const base of bases) {
    if (base.baselineStatus === "passed") passedBaseCount += 1;
    else failedBaseCount += 1;
    passedVariantRunCount += base.passedVariantCount;
    failedVariantRunCount += base.failedVariantCount;
    warningCount += base.warningCount;
  }

  const variantAggregates = buildVariantAggregates(bases);
  const rankings = buildRankings(variantAggregates);

  const notes = [
    `${bases.length} base(s) × ${reference.length} variant(s): ` +
      `${passedBaseCount} baseline(s) passed, ${failedBaseCount} failed; ` +
      `${passedVariantRunCount} variant run(s) passed, ${failedVariantRunCount} failed.`,
    "Each base is the Sprint 13 sensitivity workflow run once; a cell delta is (variant − that base's baseline).",
    "A cross-base aggregate is plain arithmetic over per-base deltas — not a profit, loss, or prediction.",
    "Review any failed base or cell before trusting its row; comparing two bases is bookkeeping, not advice.",
  ];

  return {
    schemaVersion: BACKTEST_SENSITIVITY_MATRIX_SCHEMA_VERSION,
    banner: BACKTEST_SENSITIVITY_MATRIX_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...BACKTEST_SENSITIVITY_MATRIX_DISCLAIMERS],
    label: matrixName ?? planName ?? null,
    matrixName,
    planName,
    baseCount: bases.length,
    variantCount: reference.length,
    passedBaseCount,
    failedBaseCount,
    passedVariantRunCount,
    failedVariantRunCount,
    warningCount,
    bases,
    variantAggregates,
    rankings,
    notes,
  };
}

// --- workflow runner ---------------------------------------------------------

/**
 * Run the deterministic, PAPER-ONLY multi-base sensitivity MATRIX over N base scenarios and
 * one shared variant plan. For each base it runs the EXACT Sprint 13
 * {@link runScenarioVariantSensitivity} workflow (variant generation → baseline + variant
 * suite path → sensitivity report), then aggregates every (base × variant) cell into one
 * stable matrix report. Pure and non-mutating: no base scenario or the plan is ever
 * modified.
 *
 * Refuses the WHOLE matrix (throws {@link ScenarioVariantSensitivityMatrixError}) before any
 * aggregate is built when the input is structurally invalid, a base id is missing/duplicated,
 * or a base is invalid or incompatible with the plan (a perturbation matching none of its
 * injected values) — the failing base is named. No partial matrix is ever produced.
 */
export function runScenarioVariantSensitivityMatrix(
  input: ScenarioVariantSensitivityMatrixInput,
): ScenarioVariantSensitivityMatrixRun {
  if (!isObject(input)) {
    throw new ScenarioVariantSensitivityMatrixError("matrix input must be an object");
  }
  if (!Array.isArray(input.bases) || input.bases.length === 0) {
    throw new ScenarioVariantSensitivityMatrixError("matrix input.bases must be a non-empty array");
  }
  if (input.name !== undefined && typeof input.name !== "string") {
    throw new ScenarioVariantSensitivityMatrixError("matrix input.name must be a string when present");
  }

  // Validate the base descriptors and refuse duplicate ids up front (preflight).
  const ids = new Set<string>();
  input.bases.forEach((base, i) => {
    if (!isObject(base)) {
      throw new ScenarioVariantSensitivityMatrixError(`matrix input.bases[${i}] must be an object`);
    }
    if (!nonEmptyString(base.id)) {
      throw new ScenarioVariantSensitivityMatrixError(`matrix input.bases[${i}].id must be a non-empty string`);
    }
    if (ids.has(base.id)) {
      throw new ScenarioVariantSensitivityMatrixError(`duplicate base id "${base.id}"`);
    }
    ids.add(base.id);
  });

  // Run each base through the Sprint 13 workflow against the shared plan. A base that is
  // invalid or incompatible with the plan refuses the whole matrix, named by its id.
  const baseRuns = input.bases.map((base) => {
    let run: ScenarioVariantSensitivityRun;
    try {
      run = runScenarioVariantSensitivity({ base: base.scenario, plan: input.plan });
    } catch (err) {
      if (err instanceof ScenarioVariantError) {
        throw new ScenarioVariantSensitivityMatrixError(
          `base "${base.id}" could not be swept through the plan: ${err.message}`,
        );
      }
      throw err;
    }
    return { id: base.id, run };
  });

  const report = buildScenarioVariantSensitivityMatrixReport(
    baseRuns.map(({ id, run }) => ({ id, report: run.report })),
    input.name === undefined ? {} : { name: input.name },
  );

  // Return base runs in the SAME id-sorted order as the report rows (stable for a CLI).
  const sortedRuns = [...baseRuns].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { baseRuns: sortedRuns, report };
}

// --- validation (backstop) ---------------------------------------------------

const DELTA_STAT_FIELDS: readonly (keyof ScenarioVariantSensitivityMatrixDeltaStat)[] = [
  "count",
  "sum",
  "min",
  "max",
  "meanMagnitude",
  "maxMagnitude",
];

function isDeltaStat(value: unknown): value is ScenarioVariantSensitivityMatrixDeltaStat {
  return isObject(value) && DELTA_STAT_FIELDS.every((f) => isFiniteNumber(value[f]));
}

const AGGREGATE_STAT_KEYS: readonly (keyof ScenarioVariantSensitivityMatrixVariantAggregate)[] = [
  "totalPnlDelta",
  "realizedPnlDelta",
  "unrealizedPnlDelta",
  "fillDelta",
  "rejectDelta",
  "notionalDelta",
];

const RANKING_KEYS: readonly (keyof ScenarioVariantSensitivityMatrixRankings)[] = [
  "byMaxTotalPnlMagnitude",
  "byMeanTotalPnlMagnitude",
  "byMaxFillMagnitude",
  "byMaxRejectMagnitude",
  "byMaxNotionalMagnitude",
];

/**
 * Strictly validate a value as a {@link ScenarioVariantSensitivityMatrixReport} and return
 * it narrowed. A backstop mirroring the other validators: it checks the schema version, the
 * required PAPER-ONLY labelling, the disclaimers, and the base / aggregate / ranking shapes.
 * Throws {@link ScenarioVariantSensitivityMatrixError} on the first problem. Pure; never
 * mutates.
 */
export function validateScenarioVariantSensitivityMatrixReport(
  value: unknown,
): ScenarioVariantSensitivityMatrixReport {
  if (!isObject(value)) {
    throw new ScenarioVariantSensitivityMatrixError("matrix report must be a JSON object");
  }
  if (value.schemaVersion !== BACKTEST_SENSITIVITY_MATRIX_SCHEMA_VERSION) {
    throw new ScenarioVariantSensitivityMatrixError(
      `matrix report.schemaVersion must be "${BACKTEST_SENSITIVITY_MATRIX_SCHEMA_VERSION}"`,
    );
  }
  if (value.banner !== BACKTEST_SENSITIVITY_MATRIX_BANNER) {
    throw new ScenarioVariantSensitivityMatrixError(
      `matrix report.banner must be "${BACKTEST_SENSITIVITY_MATRIX_BANNER}"`,
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
      throw new ScenarioVariantSensitivityMatrixError(`matrix report.${flag} must be true`);
    }
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new ScenarioVariantSensitivityMatrixError("matrix report.disclaimers must be a non-empty array");
  }
  for (const f of ["baseCount", "variantCount", "passedBaseCount", "failedBaseCount", "warningCount"] as const) {
    if (!isFiniteNumber(value[f])) {
      throw new ScenarioVariantSensitivityMatrixError(`matrix report.${f} must be a finite number`);
    }
  }
  if (!Array.isArray(value.bases)) {
    throw new ScenarioVariantSensitivityMatrixError("matrix report.bases must be an array");
  }
  value.bases.forEach((b, i) => {
    if (!isObject(b)) {
      throw new ScenarioVariantSensitivityMatrixError(`matrix report.bases[${i}] must be an object`);
    }
    if (!nonEmptyString(b.id)) {
      throw new ScenarioVariantSensitivityMatrixError(`matrix report.bases[${i}].id must be a non-empty string`);
    }
    if (!Array.isArray(b.cells)) {
      throw new ScenarioVariantSensitivityMatrixError(`matrix report.bases[${i}].cells must be an array`);
    }
  });
  if (!Array.isArray(value.variantAggregates)) {
    throw new ScenarioVariantSensitivityMatrixError("matrix report.variantAggregates must be an array");
  }
  value.variantAggregates.forEach((a, i) => {
    if (!isObject(a)) {
      throw new ScenarioVariantSensitivityMatrixError(`matrix report.variantAggregates[${i}] must be an object`);
    }
    if (!nonEmptyString(a.suffix)) {
      throw new ScenarioVariantSensitivityMatrixError(
        `matrix report.variantAggregates[${i}].suffix must be a non-empty string`,
      );
    }
    for (const key of AGGREGATE_STAT_KEYS) {
      if (!isDeltaStat(a[key])) {
        throw new ScenarioVariantSensitivityMatrixError(
          `matrix report.variantAggregates[${i}].${key} is malformed`,
        );
      }
    }
  });
  if (!isObject(value.rankings)) {
    throw new ScenarioVariantSensitivityMatrixError("matrix report.rankings must be an object");
  }
  for (const key of RANKING_KEYS) {
    const list = value.rankings[key];
    if (!Array.isArray(list)) {
      throw new ScenarioVariantSensitivityMatrixError(`matrix report.rankings.${key} must be an array`);
    }
    list.forEach((entry, i) => {
      if (!isObject(entry) || !nonEmptyString(entry.suffix) || !isFiniteNumber(entry.value)) {
        throw new ScenarioVariantSensitivityMatrixError(`matrix report.rankings.${key}[${i}] is malformed`);
      }
    });
  }
  return value as unknown as ScenarioVariantSensitivityMatrixReport;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatScenarioVariantSensitivityMatrixReport}. */
export interface FormatScenarioVariantSensitivityMatrixOptions {
  /** Optional label (e.g. the scenarios directory) echoed into the header. */
  label?: string;
}

/** Format a signed number for a delta column (+0 normalizes to 0). */
function signed(n: number): string {
  if (n > 0) return `+${n}`;
  return String(n === 0 ? 0 : n);
}

/** One concise ranked line: the top suffix for a ranking dimension, or a neutral note. */
function topRankLine(
  label: string,
  list: ScenarioVariantSensitivityMatrixRankingEntry[],
  usd: boolean,
): string {
  const top = list[0];
  if (!top || top.value === 0) return `- ${label}: (no movement)`;
  const unit = usd ? " USD (sim)" : "";
  return `- ${label}: ${top.suffix} (${top.value}${unit} across ${top.diffableCount} base(s))`;
}

/**
 * Render a stable, human-readable sensitivity matrix report. Deterministic and path-stable
 * (no timestamps). Leads with the PAPER-ONLY banner and closes with the not-live /
 * not-advice / not-a-profitability-claim disclaimers so a glanced report can never be
 * mistaken for a live result.
 */
export function formatScenarioVariantSensitivityMatrixReport(
  report: ScenarioVariantSensitivityMatrixReport,
  opts: FormatScenarioVariantSensitivityMatrixOptions = {},
): string {
  const title = report.label ?? "scenario variant sensitivity matrix";
  const header = `${report.banner} — ${title} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];

  if (opts.label) lines.push(`scenarios: ${opts.label}`);
  lines.push(`matrix:    ${report.matrixName ?? "(unnamed)"}`);
  lines.push(`plan:      ${report.planName ?? "(unnamed)"}`);
  lines.push(
    `bases:     ${report.baseCount} (${report.passedBaseCount} baseline passed, ${report.failedBaseCount} failed)`,
  );
  lines.push(
    `variants:  ${report.variantCount} per base ` +
      `(${report.passedVariantRunCount} run(s) passed, ${report.failedVariantRunCount} failed)`,
  );
  lines.push(`warnings:  ${report.warningCount}`);

  lines.push("");
  lines.push("Bases (baseline, simulated bookkeeping):");
  for (const base of report.bases) {
    const b = base.baselineSummary;
    if (b) {
      lines.push(
        `- ${base.id}: baseline PASSED  total PnL ${b.totalPnlUsd} USD (sim), ` +
          `fills ${b.buyFills + b.sellFills}, rejects ${b.rejects}` +
          `  [${base.passedVariantCount}/${base.variantCount} variant(s) passed]`,
      );
    } else {
      lines.push(
        `- ${base.id}: baseline FAILED  [${base.passedVariantCount}/${base.variantCount} variant(s) passed]`,
      );
    }
  }

  lines.push("");
  lines.push("Per-variant across bases (Δ = variant − that base's baseline, simulated bookkeeping):");
  for (const a of report.variantAggregates) {
    const t = a.totalPnlDelta;
    lines.push(
      `- ${a.suffix}: ${a.diffableCount}/${a.baseCount} diffable` +
        `  total PnL Δ sum ${signed(t.sum)} (min ${signed(t.min)} / max ${signed(t.max)})` +
        `, mean |Δ| ${t.meanMagnitude} USD (sim)`,
    );
  }

  lines.push("");
  lines.push(
    "Cross-base rankings (largest simulated bookkeeping movement — not a best/winner/profit ranking):",
  );
  const r = report.rankings;
  lines.push(topRankLine("Largest total-PnL movement (max |Δ|)", r.byMaxTotalPnlMagnitude, true));
  lines.push(topRankLine("Largest total-PnL movement (mean |Δ|)", r.byMeanTotalPnlMagnitude, true));
  lines.push(topRankLine("Largest fill-count movement (max |Δ|)", r.byMaxFillMagnitude, false));
  lines.push(topRankLine("Largest reject-count movement (max |Δ|)", r.byMaxRejectMagnitude, false));
  lines.push(topRankLine("Largest notional movement (max |Δ|)", r.byMaxNotionalMagnitude, true));

  lines.push("");
  lines.push("Notes:");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of report.disclaimers) lines.push(d);
  return lines.join("\n");
}
