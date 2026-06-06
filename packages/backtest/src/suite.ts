/**
 * Deterministic, offline, **simulated-only** backtest SUITE model (Sprint 11).
 *
 * A "suite" is an ordered list of already-parsed injected scenarios run together
 * so their simulated reports can be aggregated into one stable, reviewable index.
 * This module is **pure**: it does not scan directories, read files, write files,
 * fetch the network, hold a key, or read a wall-clock/RNG. The CLI performs all
 * directory traversal and file I/O and hands this layer already-parsed scenarios.
 *
 * Every scenario flows through the SAME production code paths as a single
 * backtest — `lintBacktestScenario` (pre-flight) → `runBacktest` (replay) →
 * `validateBacktestReport` (backstop). No backtest logic is duplicated here: the
 * suite is only deterministic bookkeeping ON TOP of those existing functions.
 *
 * Behaviour:
 *  - The input is a deterministic, ordered list of scenarios; output order matches.
 *  - Every scenario is linted. A scenario with lint ERRORS is marked failed and is
 *    NOT run. A scenario with only warnings runs but surfaces those warnings.
 *  - A backtest runtime error marks that one scenario failed without crashing the
 *    whole suite; only a globally-invalid input SHAPE throws.
 *  - Nothing in the input is ever mutated; the aggregate index is byte-stable.
 *
 * Every number is simulated USD bookkeeping computed from injected prices. A suite
 * is NOT a live result, NOT real market performance, NOT a profitability claim,
 * and NOT financial advice. Nothing here builds, signs, simulates, or sends a
 * transaction.
 */

import { runBacktest } from "./backtest.js";
import { lintBacktestScenario } from "./lint.js";
import { validateBacktestReport } from "./report-validate.js";
import type { BacktestLintIssue, BacktestReport } from "./types.js";

/** Stable schema identifier for the suite index shape. Bump only on a breaking change. */
export const BACKTEST_SUITE_SCHEMA_VERSION = "backtest.suite.v1";

/** The banner that prefixes every suite index (required label). */
export const BACKTEST_SUITE_BANNER = "SIMULATED PAPER-ONLY SUITE";

/** Required disclaimer statements carried by every suite index (stable order). */
export const BACKTEST_SUITE_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SUITE — aggregates injected, simulated backtest scenarios.",
  "Uses injected scenario data only.",
  "Not a live result.",
  "Not financial advice.",
  "Not a profitability claim.",
  "Every total is bookkeeping summed from injected prices, not real market performance.",
  "No transaction was built, signed, simulated, or sent.",
];

// --- input model -------------------------------------------------------------

/**
 * One already-parsed scenario to include in the suite, with optional source
 * labels supplied by the CLI. `scenario` is the raw parsed JSON value — it is
 * linted/validated here exactly like a single backtest (so an invalid value fails
 * that one entry rather than the whole suite).
 */
export interface BacktestSuiteScenario {
  /** The parsed-but-unvalidated scenario JSON value (linted + run by the suite). */
  scenario: unknown;
  /** Optional source file label (e.g. "foo.scenario.json"); echoed into the entry. */
  file?: string;
  /** Optional stable entry id; defaults to `file`, else `scenario-<n>`. */
  id?: string;
  /**
   * Optional intended report output filename the CLI will write for a PASSED
   * scenario. Echoed into the index entry only when the scenario passes (a failed
   * scenario produces no report); the pure layer never writes anything.
   */
  reportFile?: string;
}

/** A validated, ordered suite input: an optional name plus the scenario list. */
export interface BacktestSuiteInput {
  /** Optional suite name (echoed into the index). */
  name?: string;
  /** Deterministic, ordered list of scenarios. */
  scenarios: BacktestSuiteScenario[];
}

// --- per-entry result model --------------------------------------------------

/** A blocking problem for one suite entry (stable `code`, redaction-safe `message`). */
export interface BacktestSuiteError {
  /** Stable code: a lint code, "run-error", or "report-invalid". */
  code: string;
  message: string;
  path?: string;
}

/** A suspicious-but-allowed finding for one suite entry (mirrors a lint warning). */
export interface BacktestSuiteWarning {
  code: string;
  message: string;
  path?: string;
}

/** Exact per-entry summary, mirroring the fields a single report exposes. */
export interface BacktestSuiteEntrySummary {
  stepCount: number;
  candidateCount: number;
  buyFills: number;
  sellFills: number;
  rejects: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  openPositions: number;
  closedTrades: number;
  simulatedNotionalUsd: number;
}

/** Whether a lint pre-flight found blocking errors. */
export type BacktestSuiteLintStatus = "valid" | "invalid";
/** Whether the scenario was run, and the outcome. */
export type BacktestSuiteRunStatus = "passed" | "failed" | "skipped";
/** Overall entry verdict. */
export type BacktestSuiteEntryStatus = "passed" | "failed";

/**
 * One suite RUN entry: the per-scenario outcome plus (on pass) the full report,
 * which the CLI uses to write a per-scenario report file. Kept separate from the
 * lighter index entry so the index stays small and serialization-friendly.
 */
export interface BacktestSuiteRunEntry {
  /** 0-based position in the input order. */
  index: number;
  /** Stable entry id (supplied id, else file, else "scenario-<n>"). */
  id: string;
  /** Source file label if supplied, else null. */
  file: string | null;
  /** Scenario name from the scenario JSON when a non-empty string, else null. */
  scenarioName: string | null;
  /** Scenario digest when the scenario ran successfully, else null. */
  scenarioDigest: string | null;
  status: BacktestSuiteEntryStatus;
  lintStatus: BacktestSuiteLintStatus;
  runStatus: BacktestSuiteRunStatus;
  errors: BacktestSuiteError[];
  warnings: BacktestSuiteWarning[];
  /** Exact summary on pass; null when the scenario failed/did not run. */
  summary: BacktestSuiteEntrySummary | null;
  /** The full report on pass (for the CLI to write); null otherwise. */
  report: BacktestReport | null;
  /** Intended report filename echoed for a PASSED scenario, else null. */
  reportFile: string | null;
}

/** The deterministic result of running a suite (carries full reports for the CLI). */
export interface BacktestSuiteResult {
  name: string | null;
  entries: BacktestSuiteRunEntry[];
}

// --- index model -------------------------------------------------------------

/** Deterministic aggregate counts + simulated PnL totals over a suite. */
export interface BacktestSuiteSummary {
  scenarioCount: number;
  passedCount: number;
  failedCount: number;
  warningCount: number;
  totalStepCount: number;
  totalCandidateCount: number;
  totalBuyFills: number;
  totalSellFills: number;
  totalFills: number;
  totalRejects: number;
  totalRealizedPnlUsd: number;
  totalUnrealizedPnlUsd: number;
  totalSimulatedPnlUsd: number;
  totalSimulatedNotionalUsd: number;
  totalOpenPositions: number;
  totalClosedTrades: number;
}

/** One lightweight, JSON-serializable index entry (no full report). */
export interface BacktestSuiteEntry {
  index: number;
  id: string;
  file: string | null;
  scenarioName: string | null;
  scenarioDigest: string | null;
  status: BacktestSuiteEntryStatus;
  lintStatus: BacktestSuiteLintStatus;
  runStatus: BacktestSuiteRunStatus;
  errors: BacktestSuiteError[];
  warningCodes: string[];
  summary: BacktestSuiteEntrySummary | null;
  reportFile: string | null;
}

/**
 * The full, deterministic, byte-stable suite index. JSON-serializable as-is. It
 * carries the required PAPER-ONLY / not-a-live-result / not-advice / not-a-profit
 * language so that survives serialization. It is simulated bookkeeping — never a
 * live result, never a profitability claim, never advice.
 */
export interface BacktestSuiteIndex {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  name: string | null;
  summary: BacktestSuiteSummary;
  entries: BacktestSuiteEntry[];
  notes: string[];
}

/** Thrown only when the suite INPUT SHAPE is globally invalid (never per-scenario). */
export class BacktestSuiteError_ extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestSuiteInputError";
  }
}
// Exported under a clear name; the trailing-underscore class avoids colliding with
// the per-entry `BacktestSuiteError` data interface above.
export { BacktestSuiteError_ as BacktestSuiteInputError };

// --- small, local guards + helpers ------------------------------------------

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

function copyIssue(i: BacktestLintIssue): BacktestSuiteError {
  return i.path === undefined
    ? { code: i.code, message: i.message }
    : { code: i.code, message: i.message, path: i.path };
}

/** The scenario name when the raw scenario carries a non-empty string `name`, else null. */
function scenarioNameOf(scenario: unknown): string | null {
  return isObject(scenario) && nonEmptyString(scenario.name) ? scenario.name : null;
}

function summaryFromReport(report: BacktestReport): BacktestSuiteEntrySummary {
  return {
    stepCount: report.stepCount,
    candidateCount: report.totalCandidateCount,
    buyFills: report.fillCounts.buyCount,
    sellFills: report.fillCounts.sellCount,
    rejects: report.rejectedCounts.total,
    realizedPnlUsd: report.pnl.realizedUsd,
    unrealizedPnlUsd: report.pnl.unrealizedUsd,
    totalPnlUsd: report.pnl.totalUsd,
    openPositions: report.positionCounts.open,
    closedTrades: report.positionCounts.closed,
    simulatedNotionalUsd: report.simulatedNotionalUsd,
  };
}

// --- input validation --------------------------------------------------------

/**
 * Validate the global suite INPUT SHAPE and narrow it to {@link BacktestSuiteInput}.
 * Throws {@link BacktestSuiteInputError} only for a globally-invalid container
 * (not an object, missing/!array `scenarios`, wrong `name` type). It deliberately
 * does NOT validate individual scenarios — a malformed scenario must fail just that
 * one entry, never the whole suite. Pure: it never mutates `input`.
 */
export function validateBacktestSuiteInput(input: unknown): BacktestSuiteInput {
  if (!isObject(input)) {
    throw new BacktestSuiteError_("suite input must be a JSON object");
  }
  if (input.name !== undefined && typeof input.name !== "string") {
    throw new BacktestSuiteError_("suite input.name must be a string when present");
  }
  if (!Array.isArray(input.scenarios)) {
    throw new BacktestSuiteError_("suite input.scenarios must be an array");
  }
  const out: BacktestSuiteInput = { scenarios: input.scenarios as BacktestSuiteScenario[] };
  if (typeof input.name === "string") out.name = input.name;
  return out;
}

/** Normalize one raw envelope into its scenario value + source labels (never throws). */
function readEnvelope(raw: unknown, index: number): {
  scenario: unknown;
  file: string | null;
  id: string;
  reportFile: string | null;
} {
  // A non-object envelope is treated as a malformed entry whose scenario value is
  // the raw thing itself, so the linter reports the structural error for it.
  if (!isObject(raw)) {
    return { scenario: raw, file: null, id: `scenario-${index + 1}`, reportFile: null };
  }
  const file = nonEmptyString(raw.file) ? raw.file : null;
  const id = nonEmptyString(raw.id) ? raw.id : (file ?? `scenario-${index + 1}`);
  const reportFile = nonEmptyString(raw.reportFile) ? raw.reportFile : null;
  return { scenario: raw.scenario, file, id, reportFile };
}

// --- suite runner ------------------------------------------------------------

/**
 * Run a deterministic, PAPER-ONLY suite over an ordered list of injected scenarios.
 * Each scenario is linted, then (only if lint-valid) replayed through `runBacktest`
 * and validated. Lint errors → failed + skipped; a runtime error → failed; neither
 * crashes the suite. Output order matches input order. Pure and non-mutating.
 *
 * Throws {@link BacktestSuiteInputError} ONLY when the input shape is globally
 * invalid (see {@link validateBacktestSuiteInput}).
 */
export function runBacktestSuite(input: unknown): BacktestSuiteResult {
  const parsed = validateBacktestSuiteInput(input);
  const entries: BacktestSuiteRunEntry[] = [];

  parsed.scenarios.forEach((raw, index) => {
    const env = readEnvelope(raw, index);
    const scenarioName = scenarioNameOf(env.scenario);

    const lint = lintBacktestScenario(env.scenario);
    const warnings: BacktestSuiteWarning[] = lint.warnings.map(copyIssue);

    // Lint errors block a run: mark failed + skipped, never invoke runBacktest.
    if (!lint.valid) {
      entries.push({
        index,
        id: env.id,
        file: env.file,
        scenarioName,
        scenarioDigest: null,
        status: "failed",
        lintStatus: "invalid",
        runStatus: "skipped",
        errors: lint.errors.map(copyIssue),
        warnings,
        summary: null,
        report: null,
        reportFile: null,
      });
      return;
    }

    // Lint-valid: replay through the production engine, guarding runtime errors so
    // one bad scenario cannot crash the suite.
    let report: BacktestReport;
    try {
      report = runBacktest(env.scenario);
      // Backstop: the engine produces a valid report by construction, but validate
      // it through the same strict validator the diff/report tools use.
      validateBacktestReport(report);
    } catch (err) {
      entries.push({
        index,
        id: env.id,
        file: env.file,
        scenarioName,
        scenarioDigest: null,
        status: "failed",
        lintStatus: "valid",
        runStatus: "failed",
        errors: [{ code: "run-error", message: (err as Error).message }],
        warnings,
        summary: null,
        report: null,
        reportFile: null,
      });
      return;
    }

    entries.push({
      index,
      id: env.id,
      file: env.file,
      scenarioName: nonEmptyString(report.scenarioName) ? report.scenarioName : scenarioName,
      scenarioDigest: report.scenarioDigest,
      status: "passed",
      lintStatus: "valid",
      runStatus: "passed",
      errors: [],
      warnings,
      summary: summaryFromReport(report),
      report,
      reportFile: env.reportFile,
    });
  });

  return { name: parsed.name ?? null, entries };
}

// --- index aggregation -------------------------------------------------------

function emptySummary(): BacktestSuiteSummary {
  return {
    scenarioCount: 0,
    passedCount: 0,
    failedCount: 0,
    warningCount: 0,
    totalStepCount: 0,
    totalCandidateCount: 0,
    totalBuyFills: 0,
    totalSellFills: 0,
    totalFills: 0,
    totalRejects: 0,
    totalRealizedPnlUsd: 0,
    totalUnrealizedPnlUsd: 0,
    totalSimulatedPnlUsd: 0,
    totalSimulatedNotionalUsd: 0,
    totalOpenPositions: 0,
    totalClosedTrades: 0,
  };
}

/**
 * Aggregate a {@link BacktestSuiteResult} into a deterministic, byte-stable
 * {@link BacktestSuiteIndex}. Totals sum EXACT report fields over the PASSED
 * entries only (a failed entry contributes no PnL/fills); counts cover every
 * entry. Entries keep input order. Pure and non-mutating.
 */
export function buildBacktestSuiteIndex(result: BacktestSuiteResult): BacktestSuiteIndex {
  const summary = emptySummary();
  const entries: BacktestSuiteEntry[] = [];

  for (const e of result.entries) {
    summary.scenarioCount += 1;
    if (e.status === "passed") summary.passedCount += 1;
    else summary.failedCount += 1;
    summary.warningCount += e.warnings.length;

    if (e.summary) {
      summary.totalStepCount += e.summary.stepCount;
      summary.totalCandidateCount += e.summary.candidateCount;
      summary.totalBuyFills += e.summary.buyFills;
      summary.totalSellFills += e.summary.sellFills;
      summary.totalRejects += e.summary.rejects;
      summary.totalRealizedPnlUsd += e.summary.realizedPnlUsd;
      summary.totalUnrealizedPnlUsd += e.summary.unrealizedPnlUsd;
      summary.totalSimulatedNotionalUsd += e.summary.simulatedNotionalUsd;
      summary.totalOpenPositions += e.summary.openPositions;
      summary.totalClosedTrades += e.summary.closedTrades;
    }

    entries.push({
      index: e.index,
      id: e.id,
      file: e.file,
      scenarioName: e.scenarioName,
      scenarioDigest: e.scenarioDigest,
      status: e.status,
      lintStatus: e.lintStatus,
      runStatus: e.runStatus,
      errors: e.errors.map((x) => ({ ...x })),
      warningCodes: e.warnings.map((w) => w.code),
      summary: e.summary ? { ...e.summary } : null,
      reportFile: e.reportFile,
    });
  }

  // Derived totals + float-noise normalization (byte-stable across runs).
  summary.totalFills = summary.totalBuyFills + summary.totalSellFills;
  summary.totalSimulatedPnlUsd = round6(summary.totalRealizedPnlUsd + summary.totalUnrealizedPnlUsd);
  summary.totalRealizedPnlUsd = round6(summary.totalRealizedPnlUsd);
  summary.totalUnrealizedPnlUsd = round6(summary.totalUnrealizedPnlUsd);
  summary.totalSimulatedNotionalUsd = round6(summary.totalSimulatedNotionalUsd);

  const notes = [
    `${summary.scenarioCount} scenario(s): ${summary.passedCount} passed, ${summary.failedCount} failed.`,
    "Each entry is one injected scenario replayed through the same plan → paper engine as a single backtest.",
    "Totals are simulated bookkeeping over injected prices — review failed entries before trusting any total.",
  ];

  return {
    schemaVersion: BACKTEST_SUITE_SCHEMA_VERSION,
    banner: BACKTEST_SUITE_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...BACKTEST_SUITE_DISCLAIMERS],
    name: result.name,
    summary,
    entries,
    notes,
  };
}
