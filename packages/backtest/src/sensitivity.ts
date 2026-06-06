/**
 * Deterministic, offline, **simulated-only** scenario-variant SENSITIVITY workflow
 * (Sprint 13).
 *
 * This is the report layer that ties Sprint 11 (suites) and Sprint 12 (variant
 * generation) together into one reviewable answer to "how sensitive are the
 * simulated outputs to a bounded perturbation of the injected data?". It:
 *
 *   1. generates deterministic variants from one base scenario + a variant plan,
 *      via the SAME {@link generateScenarioVariants} used by Sprint 12;
 *   2. runs the BASELINE (the base scenario, run once) AND every generated variant
 *      through the SAME {@link runBacktestSuite} production path used by Sprint 11
 *      (lint → `runBacktest` → validate); and
 *   3. summarizes each variant's simulated outputs and its per-field DELTA versus
 *      the baseline into one stable, versioned sensitivity report.
 *
 * Design choice (Option A): the base scenario IS run, exactly once, as the first
 * entry of the underlying suite, so every variant has a real baseline to diff
 * against. No backtest, suite, or variant logic is re-implemented here — this
 * module is only deterministic bookkeeping ON TOP of those existing functions.
 *
 * Pure: no network, no RPC, no filesystem, no `Date.now`, no `Math.random`, no RNG
 * of any kind. Non-mutating: the base scenario and the plan are never modified (the
 * baseline is run on an independent deep copy, and variant generation already deep
 * copies). The report carries NO timestamps so identical inputs produce a
 * byte-identical report.
 *
 * Every number is simulated USD bookkeeping computed from injected prices. A delta
 * is the change between two simulated runs — it is NOT a live result, NOT real
 * market performance, NOT a prediction, NOT a profitability claim, and NOT
 * financial advice. Nothing here builds, signs, simulates, or sends a transaction.
 */

import { generateScenarioVariants, type ScenarioVariantsResult } from "./scenario-variants.js";
import {
  runBacktestSuite,
  buildBacktestSuiteIndex,
  type BacktestSuiteResult,
  type BacktestSuiteRunEntry,
  type BacktestSuiteIndex,
  type BacktestSuiteScenario,
  type BacktestSuiteEntrySummary,
  type BacktestSuiteError,
  type BacktestSuiteSummary,
  type BacktestSuiteLintStatus,
  type BacktestSuiteRunStatus,
  type BacktestSuiteEntryStatus,
} from "./suite.js";

/** Stable schema identifier for the sensitivity report. Bump only on a breaking change. */
export const BACKTEST_SENSITIVITY_SCHEMA_VERSION = "backtest.sensitivity.v1";

/** The banner that prefixes every sensitivity report (required label). */
export const BACKTEST_SENSITIVITY_BANNER = "SIMULATED PAPER-ONLY SENSITIVITY";

/** The reserved baseline entry id (a variant suffix may not collide with it). */
export const SENSITIVITY_BASELINE_ID = "base";

/** Required disclaimer statements carried by every sensitivity report (stable order). */
export const BACKTEST_SENSITIVITY_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SENSITIVITY — runs a base scenario and bounded variants of it.",
  "Uses injected, simulated local scenario data only.",
  "Not a live result.",
  "Not financial advice.",
  "Not a profitability claim.",
  "Every total and delta is bookkeeping summed from injected prices, not real market performance.",
  "A delta is the change between two simulated runs, not a prediction and not a recommendation.",
  "No transaction was built, signed, simulated, or sent.",
];

/** Thrown only when the sensitivity INPUT or a produced REPORT is structurally invalid. */
export class ScenarioVariantSensitivityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioVariantSensitivityError";
  }
}

// --- input -------------------------------------------------------------------

/** The two already-parsed local JSON values this workflow runs over. */
export interface ScenarioVariantSensitivityInput {
  /** The base scenario JSON value (validated by variant generation; run as baseline). */
  base: unknown;
  /** The variant plan JSON value (`{ name?, variants: [{ suffix, perturbations }] }`). */
  plan: unknown;
}

// --- report model ------------------------------------------------------------

/** One numeric field's value under the baseline and a variant, plus their difference. */
export interface SensitivityNumberDelta {
  base: number;
  next: number;
  delta: number;
}

/**
 * Per-field deltas of a variant's simulated summary versus the baseline. Each field
 * mirrors a real {@link BacktestSuiteEntrySummary} field — no metric is invented.
 */
export interface SensitivitySummaryDeltas {
  stepCount: SensitivityNumberDelta;
  candidateCount: SensitivityNumberDelta;
  buyFills: SensitivityNumberDelta;
  sellFills: SensitivityNumberDelta;
  rejects: SensitivityNumberDelta;
  realizedPnlUsd: SensitivityNumberDelta;
  unrealizedPnlUsd: SensitivityNumberDelta;
  totalPnlUsd: SensitivityNumberDelta;
  openPositions: SensitivityNumberDelta;
  closedTrades: SensitivityNumberDelta;
  simulatedNotionalUsd: SensitivityNumberDelta;
}

/** The baseline run: the base scenario executed once through the production path. */
export interface ScenarioVariantSensitivityBaseline {
  id: string;
  scenarioName: string | null;
  scenarioDigest: string | null;
  status: BacktestSuiteEntryStatus;
  lintStatus: BacktestSuiteLintStatus;
  runStatus: BacktestSuiteRunStatus;
  warningCount: number;
  warningCodes: string[];
  errors: BacktestSuiteError[];
  /** Exact simulated summary when the baseline ran; null only if it failed. */
  summary: BacktestSuiteEntrySummary | null;
}

/** One variant's run outcome, simulated summary, and per-field delta vs baseline. */
export interface ScenarioVariantSensitivityEntry {
  /** Plan order (0-based), matching the variant plan. */
  index: number;
  /** The variant suffix (also its underlying suite entry id). */
  suffix: string;
  scenarioName: string | null;
  scenarioDigest: string | null;
  /** How many injected numeric values this variant's perturbations changed. */
  changeCount: number;
  status: BacktestSuiteEntryStatus;
  lintStatus: BacktestSuiteLintStatus;
  runStatus: BacktestSuiteRunStatus;
  warningCount: number;
  warningCodes: string[];
  errors: BacktestSuiteError[];
  /** Exact simulated summary on pass; null when the variant failed/did not run. */
  summary: BacktestSuiteEntrySummary | null;
  /** Per-field deltas vs baseline; null when either side has no summary. */
  deltas: SensitivitySummaryDeltas | null;
}

/**
 * One ranked variant under a single ranking dimension. `value` is the variant's
 * signed delta versus the baseline for that dimension (e.g. its total-PnL delta);
 * `magnitude` is `|value|`, the sort key, so a ranking surfaces the LARGEST movement
 * regardless of direction. It is a bookkeeping delta between two simulated runs —
 * never a profit, a loss, a winner, or a recommendation.
 */
export interface SensitivityRankingEntry {
  /** The variant suffix (its underlying suite entry id). */
  suffix: string;
  /** The variant's scenario digest when it ran, else null. */
  scenarioDigest: string | null;
  /** The signed delta (variant − baseline) for this ranking's dimension. */
  value: number;
  /** `|value|` — the deterministic sort key (largest movement first). */
  magnitude: number;
}

/**
 * Deterministic rankings of the diffable variants by the size of each simulated
 * bookkeeping delta versus the baseline. Every dimension maps to a REAL per-field
 * delta already in the report — no metric is invented. Each list is ordered by
 * `magnitude` descending (largest movement first), ties broken stably by `suffix`
 * then `scenarioDigest`, so the order never depends on plan/input order. A list is
 * empty when no variant is diffable (e.g. the baseline failed). These are NOT a
 * "best"/"winner"/"most profitable" ordering — only the largest simulated movement.
 */
export interface SensitivityRankings {
  /** By total simulated PnL delta (realized + unrealized). */
  byTotalSimulatedPnlDelta: SensitivityRankingEntry[];
  /** By realized simulated PnL delta. */
  byRealizedSimulatedPnlDelta: SensitivityRankingEntry[];
  /** By unrealized simulated PnL delta. */
  byUnrealizedSimulatedPnlDelta: SensitivityRankingEntry[];
  /** By total simulated fill-count delta (buy + sell). */
  byFillDelta: SensitivityRankingEntry[];
  /** By paper reject-count delta. */
  byRejectDelta: SensitivityRankingEntry[];
  /** By lint warning-count change (variant − baseline). */
  byWarningDelta: SensitivityRankingEntry[];
  /** By simulated notional (turnover) delta. */
  byNotionalDelta: SensitivityRankingEntry[];
}

/**
 * The full, deterministic, byte-stable sensitivity report. JSON-serializable as-is.
 * Carries the required PAPER-ONLY / not-a-live-result / not-advice / not-a-profit
 * language so it survives serialization. It is simulated bookkeeping — never a live
 * result, never a prediction, never a profitability claim, never advice.
 */
export interface ScenarioVariantSensitivityReport {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  /** Stable report label: the plan name when present, else null. */
  label: string | null;
  planName: string | null;
  baseScenarioName: string | null;
  baseScenarioDigest: string | null;
  variantCount: number;
  passedVariantCount: number;
  failedVariantCount: number;
  /** Total lint warnings across the baseline AND every variant. */
  warningCount: number;
  baseline: ScenarioVariantSensitivityBaseline;
  variants: ScenarioVariantSensitivityEntry[];
  /**
   * Deterministic rankings of the diffable variants by the magnitude of each
   * simulated bookkeeping delta vs the baseline (largest movement first). Bookkeeping
   * ordering only — never a "best"/"winner"/"most profitable" ranking.
   */
  rankings: SensitivityRankings;
  /** The aggregate suite summary over baseline + variants (Sprint 11 shape). */
  suiteSummary: BacktestSuiteSummary;
  /** Bookkeeping-only notes (never profitability claims). */
  notes: string[];
}

/** Everything {@link runScenarioVariantSensitivity} produces (carries artifacts for a CLI). */
export interface ScenarioVariantSensitivityRun {
  /** The generated variants (with their scenarios) — for a CLI to write variant files. */
  variantsResult: ScenarioVariantsResult;
  /** The underlying suite result over baseline + variants (carries full reports). */
  suiteResult: BacktestSuiteResult;
  /** The aggregate suite index over baseline + variants (Sprint 11 artifact). */
  suiteIndex: BacktestSuiteIndex;
  /** The stable Sprint 13 sensitivity report. */
  report: ScenarioVariantSensitivityReport;
}

// --- small, local helpers ----------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Round to 6 decimals deterministically (kills float noise; normalizes -0 to 0). */
function round6(n: number): number {
  const r = Number.parseFloat(n.toFixed(6));
  return Object.is(r, -0) ? 0 : r;
}

function numberDelta(base: number, next: number): SensitivityNumberDelta {
  return { base, next, delta: round6(next - base) };
}

/** Deep-clone a pure-JSON value via round-trip (scenarios/plans are pure JSON). */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function copyError(e: BacktestSuiteError): BacktestSuiteError {
  return e.path === undefined
    ? { code: e.code, message: e.message }
    : { code: e.code, message: e.message, path: e.path };
}

/** Per-field deltas of a variant summary vs the baseline summary (both must exist). */
function buildDeltas(
  base: BacktestSuiteEntrySummary,
  next: BacktestSuiteEntrySummary,
): SensitivitySummaryDeltas {
  return {
    stepCount: numberDelta(base.stepCount, next.stepCount),
    candidateCount: numberDelta(base.candidateCount, next.candidateCount),
    buyFills: numberDelta(base.buyFills, next.buyFills),
    sellFills: numberDelta(base.sellFills, next.sellFills),
    rejects: numberDelta(base.rejects, next.rejects),
    realizedPnlUsd: numberDelta(base.realizedPnlUsd, next.realizedPnlUsd),
    unrealizedPnlUsd: numberDelta(base.unrealizedPnlUsd, next.unrealizedPnlUsd),
    totalPnlUsd: numberDelta(base.totalPnlUsd, next.totalPnlUsd),
    openPositions: numberDelta(base.openPositions, next.openPositions),
    closedTrades: numberDelta(base.closedTrades, next.closedTrades),
    simulatedNotionalUsd: numberDelta(base.simulatedNotionalUsd, next.simulatedNotionalUsd),
  };
}

/** Magnitude (|value|) normalized to kill -0 and float noise, for a stable sort key. */
function magnitudeOf(value: number): number {
  return round6(Math.abs(value));
}

/**
 * Rank the diffable variants (those with non-null per-field deltas) by the size of
 * one chosen simulated delta, largest movement first. Pure and deterministic:
 * `select` maps a variant + its (non-null) deltas to a signed value for this
 * dimension; the result is sorted by `magnitude` descending then by `suffix` then
 * `scenarioDigest` (both ascending), so the order never depends on plan/input order
 * and ties resolve stably. A failed variant (null deltas) never appears.
 */
function rankBy(
  variants: ScenarioVariantSensitivityEntry[],
  select: (deltas: SensitivitySummaryDeltas, v: ScenarioVariantSensitivityEntry) => number,
): SensitivityRankingEntry[] {
  const entries: SensitivityRankingEntry[] = [];
  for (const v of variants) {
    if (v.deltas === null) continue; // narrows v.deltas for the select call below
    const value = round6(select(v.deltas, v));
    entries.push({
      suffix: v.suffix,
      scenarioDigest: v.scenarioDigest,
      value,
      magnitude: magnitudeOf(value),
    });
  }
  entries.sort((a, b) => {
    if (b.magnitude !== a.magnitude) return b.magnitude - a.magnitude;
    if (a.suffix !== b.suffix) return a.suffix < b.suffix ? -1 : 1;
    // Stable digest tie-break (null sorts last); suffixes are unique so this is a backstop.
    if (a.scenarioDigest !== b.scenarioDigest) {
      if (a.scenarioDigest === null) return 1;
      if (b.scenarioDigest === null) return -1;
      return a.scenarioDigest < b.scenarioDigest ? -1 : 1;
    }
    return 0;
  });
  return entries;
}

/**
 * Build the deterministic {@link SensitivityRankings} over the variant entries. Each
 * dimension reuses an EXISTING per-field delta (or the baseline-relative warning-count
 * change) — nothing is invented. The warning-count delta is `variant − baseline`
 * warning counts; only diffable (passed) variants are ranked. Pure; never mutates.
 */
function buildSensitivityRankings(
  variants: ScenarioVariantSensitivityEntry[],
  baselineWarningCount: number,
): SensitivityRankings {
  return {
    byTotalSimulatedPnlDelta: rankBy(variants, (d) => d.totalPnlUsd.delta),
    byRealizedSimulatedPnlDelta: rankBy(variants, (d) => d.realizedPnlUsd.delta),
    byUnrealizedSimulatedPnlDelta: rankBy(variants, (d) => d.unrealizedPnlUsd.delta),
    byFillDelta: rankBy(variants, (d) => d.buyFills.delta + d.sellFills.delta),
    byRejectDelta: rankBy(variants, (d) => d.rejects.delta),
    byWarningDelta: rankBy(variants, (_d, v) => v.warningCount - baselineWarningCount),
    byNotionalDelta: rankBy(variants, (d) => d.simulatedNotionalUsd.delta),
  };
}

// --- report builder ----------------------------------------------------------

/**
 * Build a deterministic, byte-stable {@link ScenarioVariantSensitivityReport} from
 * an already-run suite. The suite MUST have been built by
 * {@link runScenarioVariantSensitivity}: its first entry is the baseline (the base
 * scenario run once) and the remaining entries are the generated variants, in plan
 * order, one per `variantsResult.variants` entry. Pure and non-mutating.
 *
 * Throws {@link ScenarioVariantSensitivityError} if the suite/variant shapes do not
 * line up (a programmer error, not a user-data error).
 */
export function buildScenarioVariantSensitivityReport(
  suiteResult: BacktestSuiteResult,
  variantsResult: ScenarioVariantsResult,
): ScenarioVariantSensitivityReport {
  const entries = suiteResult.entries;
  if (entries.length < 1) {
    throw new ScenarioVariantSensitivityError("suite result must include the baseline entry");
  }
  const baselineEntry = entries[0] as BacktestSuiteRunEntry;
  const variantEntries = entries.slice(1);
  if (variantEntries.length !== variantsResult.variants.length) {
    throw new ScenarioVariantSensitivityError(
      `suite variant count (${variantEntries.length}) does not match generated variants ` +
        `(${variantsResult.variants.length})`,
    );
  }

  const baseSummary = baselineEntry.summary;

  const baseline: ScenarioVariantSensitivityBaseline = {
    id: baselineEntry.id,
    scenarioName: baselineEntry.scenarioName,
    scenarioDigest: baselineEntry.scenarioDigest,
    status: baselineEntry.status,
    lintStatus: baselineEntry.lintStatus,
    runStatus: baselineEntry.runStatus,
    warningCount: baselineEntry.warnings.length,
    warningCodes: baselineEntry.warnings.map((w) => w.code),
    errors: baselineEntry.errors.map(copyError),
    summary: baseSummary ? { ...baseSummary } : null,
  };

  let passedVariantCount = 0;
  let failedVariantCount = 0;
  let warningCount = baselineEntry.warnings.length;

  const variants: ScenarioVariantSensitivityEntry[] = variantEntries.map((entry, i) => {
    const generated = variantsResult.variants[i];
    if (!generated) {
      throw new ScenarioVariantSensitivityError(`missing generated variant at index ${i}`);
    }
    if (entry.id !== generated.suffix) {
      throw new ScenarioVariantSensitivityError(
        `suite entry id "${entry.id}" does not match variant suffix "${generated.suffix}" at index ${i}`,
      );
    }

    if (entry.status === "passed") passedVariantCount += 1;
    else failedVariantCount += 1;
    warningCount += entry.warnings.length;

    const deltas =
      baseSummary && entry.summary ? buildDeltas(baseSummary, entry.summary) : null;

    return {
      index: i,
      suffix: generated.suffix,
      scenarioName: entry.scenarioName,
      scenarioDigest: entry.scenarioDigest,
      changeCount: generated.changeCount,
      status: entry.status,
      lintStatus: entry.lintStatus,
      runStatus: entry.runStatus,
      warningCount: entry.warnings.length,
      warningCodes: entry.warnings.map((w) => w.code),
      errors: entry.errors.map(copyError),
      summary: entry.summary ? { ...entry.summary } : null,
      deltas,
    };
  });

  const suiteIndex = buildBacktestSuiteIndex(suiteResult);

  const notes = [
    `Baseline + ${variants.length} variant(s): ${passedVariantCount} passed, ${failedVariantCount} failed.`,
    "The baseline is the base scenario run once through the same plan → paper engine as a single backtest.",
    "Each variant delta is (variant − baseline) over simulated bookkeeping from injected prices.",
    "Review any failed entry before trusting its row; a delta is not a profit, loss, or prediction.",
  ];

  return {
    schemaVersion: BACKTEST_SENSITIVITY_SCHEMA_VERSION,
    banner: BACKTEST_SENSITIVITY_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...BACKTEST_SENSITIVITY_DISCLAIMERS],
    label: variantsResult.name,
    planName: variantsResult.name,
    baseScenarioName: baselineEntry.scenarioName,
    baseScenarioDigest: baselineEntry.scenarioDigest,
    variantCount: variants.length,
    passedVariantCount,
    failedVariantCount,
    warningCount,
    baseline,
    variants,
    rankings: buildSensitivityRankings(variants, baselineEntry.warnings.length),
    suiteSummary: suiteIndex.summary,
    notes,
  };
}

// --- workflow runner ---------------------------------------------------------

/**
 * Run the deterministic, PAPER-ONLY variant-sensitivity workflow over one base
 * scenario and a variant plan. Generates variants (Sprint 12), runs the baseline
 * plus every variant through the suite path (Sprint 11), and builds the sensitivity
 * report. Pure and non-mutating: `input.base`/`input.plan` are never modified and
 * the baseline runs on an independent deep copy.
 *
 * Throws {@link import("./scenario-variants.js").ScenarioVariantError} when the base
 * scenario or the plan is invalid (refused before anything is run), or
 * {@link ScenarioVariantSensitivityError} if the wired-up shapes disagree.
 */
export function runScenarioVariantSensitivity(
  input: ScenarioVariantSensitivityInput,
): ScenarioVariantSensitivityRun {
  if (!isObject(input)) {
    throw new ScenarioVariantSensitivityError("sensitivity input must be an object");
  }

  // Generate variants first: this validates BOTH the base scenario and the plan and
  // throws ScenarioVariantError on either being invalid (so an invalid base/plan is
  // refused here, before any run).
  const variantsResult = generateScenarioVariants(input.base, input.plan);

  // Build one suite: baseline first (the base scenario, deep-copied so the caller's
  // value is never touched), then every generated variant in plan order. Running
  // them together reuses the EXACT Sprint 11 suite path and yields one suite index.
  const baselineClone = cloneJson(input.base);
  const scenarios: BacktestSuiteScenario[] = [
    { scenario: baselineClone, id: SENSITIVITY_BASELINE_ID },
    ...variantsResult.variants.map((v) => ({ scenario: v.scenario, id: v.suffix })),
  ];

  const suiteInput =
    variantsResult.name === null
      ? { scenarios }
      : { name: variantsResult.name, scenarios };
  const suiteResult = runBacktestSuite(suiteInput);
  const suiteIndex = buildBacktestSuiteIndex(suiteResult);
  const report = buildScenarioVariantSensitivityReport(suiteResult, variantsResult);

  return { variantsResult, suiteResult, suiteIndex, report };
}

// --- validation (backstop) ---------------------------------------------------

function isNumberDelta(value: unknown): value is SensitivityNumberDelta {
  return (
    isObject(value) &&
    typeof value.base === "number" &&
    typeof value.next === "number" &&
    typeof value.delta === "number"
  );
}

/** The fixed set of ranking dimensions a {@link SensitivityRankings} must carry. */
const RANKING_KEYS: readonly (keyof SensitivityRankings)[] = [
  "byTotalSimulatedPnlDelta",
  "byRealizedSimulatedPnlDelta",
  "byUnrealizedSimulatedPnlDelta",
  "byFillDelta",
  "byRejectDelta",
  "byWarningDelta",
  "byNotionalDelta",
];

function isRankingEntry(value: unknown): value is SensitivityRankingEntry {
  return (
    isObject(value) &&
    nonEmptyString(value.suffix) &&
    (value.scenarioDigest === null || typeof value.scenarioDigest === "string") &&
    typeof value.value === "number" &&
    typeof value.magnitude === "number"
  );
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

function isEntrySummary(value: unknown): value is BacktestSuiteEntrySummary {
  if (!isObject(value)) return false;
  return SUMMARY_FIELDS.every((f) => typeof value[f] === "number");
}

/**
 * Strictly validate a value as a {@link ScenarioVariantSensitivityReport} and return
 * it narrowed. A backstop mirroring the other validators: it checks the schema
 * version, the required PAPER-ONLY labelling, the disclaimers, and the baseline +
 * variant shapes. Throws {@link ScenarioVariantSensitivityError} on the first
 * problem. Pure; never mutates.
 */
export function validateScenarioVariantSensitivityReport(
  value: unknown,
): ScenarioVariantSensitivityReport {
  if (!isObject(value)) {
    throw new ScenarioVariantSensitivityError("report must be a JSON object");
  }
  if (value.schemaVersion !== BACKTEST_SENSITIVITY_SCHEMA_VERSION) {
    throw new ScenarioVariantSensitivityError(
      `report.schemaVersion must be "${BACKTEST_SENSITIVITY_SCHEMA_VERSION}"`,
    );
  }
  if (value.banner !== BACKTEST_SENSITIVITY_BANNER) {
    throw new ScenarioVariantSensitivityError(
      `report.banner must be "${BACKTEST_SENSITIVITY_BANNER}"`,
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
      throw new ScenarioVariantSensitivityError(`report.${flag} must be true`);
    }
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new ScenarioVariantSensitivityError("report.disclaimers must be a non-empty array");
  }
  if (!isObject(value.baseline)) {
    throw new ScenarioVariantSensitivityError("report.baseline must be an object");
  }
  if (value.baseline.summary !== null && !isEntrySummary(value.baseline.summary)) {
    throw new ScenarioVariantSensitivityError("report.baseline.summary is malformed");
  }
  if (!Array.isArray(value.variants)) {
    throw new ScenarioVariantSensitivityError("report.variants must be an array");
  }
  value.variants.forEach((v, i) => {
    if (!isObject(v)) {
      throw new ScenarioVariantSensitivityError(`report.variants[${i}] must be an object`);
    }
    if (!nonEmptyString(v.suffix)) {
      throw new ScenarioVariantSensitivityError(`report.variants[${i}].suffix must be a non-empty string`);
    }
    if (v.summary !== null && !isEntrySummary(v.summary)) {
      throw new ScenarioVariantSensitivityError(`report.variants[${i}].summary is malformed`);
    }
    if (v.deltas !== null) {
      if (!isObject(v.deltas)) {
        throw new ScenarioVariantSensitivityError(`report.variants[${i}].deltas must be an object or null`);
      }
      for (const f of SUMMARY_FIELDS) {
        if (!isNumberDelta(v.deltas[f])) {
          throw new ScenarioVariantSensitivityError(
            `report.variants[${i}].deltas.${f} is malformed`,
          );
        }
      }
    }
  });
  if (!isObject(value.rankings)) {
    throw new ScenarioVariantSensitivityError("report.rankings must be an object");
  }
  for (const key of RANKING_KEYS) {
    const list = value.rankings[key];
    if (!Array.isArray(list)) {
      throw new ScenarioVariantSensitivityError(`report.rankings.${key} must be an array`);
    }
    list.forEach((entry, i) => {
      if (!isRankingEntry(entry)) {
        throw new ScenarioVariantSensitivityError(`report.rankings.${key}[${i}] is malformed`);
      }
    });
  }
  return value as unknown as ScenarioVariantSensitivityReport;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatScenarioVariantSensitivityReport}. */
export interface FormatScenarioVariantSensitivityOptions {
  /** Optional label (e.g. the base file path) echoed into the header. */
  label?: string;
}

/** Format a signed number for a delta column (+0 normalizes to 0). */
function signed(n: number): string {
  if (n > 0) return `+${n}`;
  return String(n === 0 ? 0 : n);
}

/**
 * One concise ranked line: the largest-magnitude entry for a ranking dimension, or a
 * neutral "(no diffable variant)" when the list is empty. `usd` appends the simulated
 * USD unit. Deliberately neutral wording — the LARGEST movement, never the "best".
 */
function topRankLine(label: string, list: SensitivityRankingEntry[], usd: boolean): string {
  const top = list[0];
  if (!top) return `- ${label}: (no diffable variant)`;
  const unit = usd ? " USD (sim)" : "";
  return `- ${label}: ${top.suffix} (Δ${signed(top.value)}${unit})`;
}

/**
 * Render a stable, human-readable sensitivity report. Deterministic and
 * path-stable (no timestamps). Leads with the PAPER-ONLY banner and closes with the
 * not-live / not-advice / not-a-profitability-claim disclaimers so a glanced report
 * can never be mistaken for a live result.
 */
export function formatScenarioVariantSensitivityReport(
  report: ScenarioVariantSensitivityReport,
  opts: FormatScenarioVariantSensitivityOptions = {},
): string {
  const title = report.label ?? report.baseScenarioName ?? "scenario variant sensitivity";
  const header = `${report.banner} — ${title} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];

  if (opts.label) lines.push(`base:      ${opts.label}`);
  lines.push(`base name: ${report.baseScenarioName ?? "(unnamed)"}`);
  lines.push(`base digest: ${report.baseScenarioDigest ?? "(none)"}`);
  lines.push(`plan:      ${report.planName ?? "(unnamed)"}`);
  lines.push(
    `variants:  ${report.variantCount} (${report.passedVariantCount} passed, ${report.failedVariantCount} failed)`,
  );
  lines.push(`warnings:  ${report.warningCount}`);

  const b = report.baseline.summary;
  lines.push("");
  lines.push("Baseline (base scenario, run once):");
  if (b) {
    lines.push(
      `  fills ${b.buyFills + b.sellFills} (buy ${b.buyFills} / sell ${b.sellFills})` +
        `, rejects ${b.rejects}, total PnL ${b.totalPnlUsd} USD (sim), notional ${b.simulatedNotionalUsd} USD (sim)`,
    );
    lines.push(
      `  realized ${b.realizedPnlUsd} / unrealized ${b.unrealizedPnlUsd} USD (sim)` +
        `, open ${b.openPositions} / closed ${b.closedTrades}`,
    );
  } else {
    lines.push(`  FAILED — ${report.baseline.errors.map((e) => e.code).join(", ") || "no summary"}`);
  }

  lines.push("");
  lines.push("Variants vs baseline (Δ = variant − baseline, simulated bookkeeping):");
  for (const v of report.variants) {
    if (v.summary && v.deltas) {
      const d = v.deltas;
      lines.push(
        `- ${v.suffix}: PASSED [${v.changeCount} value(s) changed]` +
          `  fills ${v.summary.buyFills + v.summary.sellFills} (Δ${signed(d.buyFills.delta + d.sellFills.delta)})` +
          `, total PnL ${v.summary.totalPnlUsd} (Δ${signed(d.totalPnlUsd.delta)}) USD (sim)` +
          `, notional ${v.summary.simulatedNotionalUsd} (Δ${signed(d.simulatedNotionalUsd.delta)}) USD (sim)`,
      );
    } else {
      lines.push(
        `- ${v.suffix}: FAILED [${v.changeCount} value(s) changed] — ` +
          (v.errors.map((e) => e.code).join(", ") || "no summary; no delta"),
      );
    }
  }

  lines.push("");
  lines.push(
    "Rankings (largest simulated bookkeeping movement vs baseline — not a best/winner/profit ranking):",
  );
  const r = report.rankings;
  lines.push(topRankLine("Largest simulated total-PnL delta", r.byTotalSimulatedPnlDelta, true));
  lines.push(topRankLine("Largest realized-PnL delta", r.byRealizedSimulatedPnlDelta, true));
  lines.push(topRankLine("Largest unrealized-PnL delta", r.byUnrealizedSimulatedPnlDelta, true));
  lines.push(topRankLine("Largest fill-count change", r.byFillDelta, false));
  lines.push(topRankLine("Largest reject-count change", r.byRejectDelta, false));
  lines.push(topRankLine("Largest warning-count change", r.byWarningDelta, false));
  lines.push(topRankLine("Largest simulated-notional delta", r.byNotionalDelta, true));

  lines.push("");
  lines.push("Notes:");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of report.disclaimers) lines.push(d);
  return lines.join("\n");
}
