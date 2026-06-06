/**
 * Deterministic, offline, **simulated-only** SUITE COVERAGE summary (Sprint 14,
 * Slice E). It answers ONE question over an already-produced suite index: "did this
 * suite actually exercise different simulated paper-trading paths, or did every
 * scenario do the same thing?"
 *
 * `summarizeBacktestSuiteCoverage(index)` validates the index (refusing a non-index
 * via {@link validateBacktestSuiteIndex}) and reports — using ONLY fields the index
 * already carries — per-behaviour scenario counts, which behaviours were exercised
 * anywhere, the unique run/entry statuses, the scenario id lists per behaviour, and a
 * transparently-derived "path behaviour" coverage ratio. It is **pure**: no network,
 * no RPC, no wallet, no filesystem, no `Date.now`, no `Math.random`, and it never
 * mutates its input (the JSON is byte-stable for a given index).
 *
 * This is **behavioural bookkeeping coverage** — NOT market coverage, NOT test/code
 * coverage, and NOT a profitability claim. The ratio is the fraction of a FIXED list
 * of simulated-behaviour dimensions that at least one scenario exercised; it is not a
 * score and not a quality judgement. Every count comes from injected, simulated
 * scenario data.
 */

import { redactString } from "@soulmaker/security";
import { validateBacktestSuiteIndex } from "./suite-validate.js";
import type { BacktestSuiteEntry, BacktestSuiteIndex } from "./suite.js";

/** Stable schema identifier for the coverage report. Bump only on a breaking change. */
export const BACKTEST_COVERAGE_SCHEMA_VERSION = "backtest.coverage.v1";

/** The banner that prefixes every coverage report (required label). */
export const BACKTEST_COVERAGE_BANNER = "SIMULATED PAPER-ONLY COVERAGE";

/** Required disclaimer statements carried by every coverage report (stable order). */
export const BACKTEST_COVERAGE_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY COVERAGE — behavioural bookkeeping coverage over an injected suite.",
  "This is NOT market coverage and NOT test/code coverage — it only reports which simulated paths the suite exercised.",
  "Uses injected suite index data only — no live data was fetched and nothing was traded.",
  "Every count and ratio is derived transparently from existing report counts.",
  "Not a live result.",
  "Not financial advice.",
  "Not a profitability claim.",
];

/** Thrown only when the coverage INPUT or a produced REPORT is structurally invalid. */
export class BacktestCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestCoverageError";
  }
}

// --- report model ------------------------------------------------------------

/** How many scenarios exhibited each behaviour (every value is a count of scenarios). */
export interface BacktestCoverageCounts {
  scenarioCount: number;
  passed: number;
  failed: number;
  /** Scenarios whose run was skipped (a lint error blocked the run). */
  skipped: number;
  withWarnings: number;
  withRejects: number;
  withBuyFills: number;
  withSellFills: number;
  /** Passed scenarios that produced NO simulated fills (a "did nothing" path). */
  withNoFills: number;
  withOpenPositions: number;
  withClosedTrades: number;
  withRealizedPnl: number;
  withUnrealizedPnl: number;
}

/** Whether each behaviour was exercised by AT LEAST ONE scenario (boolean coverage). */
export interface BacktestCoverageFlags {
  anyBuyFills: boolean;
  anySellFills: boolean;
  anyRejects: boolean;
  anyWarnings: boolean;
  anyOpenPositions: boolean;
  anyClosedTrades: boolean;
  anyRealizedPnl: boolean;
  anyUnrealizedPnl: boolean;
  anyFailed: boolean;
  anySkipped: boolean;
}

/** Scenario id lists per behaviour (in suite-index entry order). */
export interface BacktestCoverageScenarioLists {
  passed: string[];
  failed: string[];
  withWarnings: string[];
  withRejects: string[];
  withNoFills: string[];
  withOpenPositions: string[];
  withClosedTrades: string[];
}

/**
 * The transparently-derived "path behaviour" coverage: the fraction of a FIXED list of
 * simulated-behaviour dimensions that at least one scenario exercised. Clearly defined
 * and deterministic — NOT a market/test-coverage percentage and NOT a quality score.
 */
export interface BacktestPathBehaviourCoverage {
  /** The fixed dimensions considered (stable order). */
  tracked: string[];
  /** The subset exercised by ≥1 scenario (stable order). */
  covered: string[];
  /** `tracked` minus `covered` (stable order). */
  missing: string[];
  coveredCount: number;
  trackedCount: number;
  /** `coveredCount / trackedCount`, rounded to 4 decimals (0 when trackedCount is 0). */
  ratio: number;
}

/**
 * The full, deterministic, byte-stable coverage report. JSON-serializable as-is. It
 * carries the required PAPER-ONLY / not-a-live-result / not-advice / not-a-profit and
 * not-market/test-coverage language so that survives serialization.
 */
export interface BacktestSuiteCoverageReport {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  /** Explicit marker: this is behavioural bookkeeping coverage, not market/test coverage. */
  notMarketCoverage: true;
  disclaimers: string[];
  suiteName: string | null;
  counts: BacktestCoverageCounts;
  flags: BacktestCoverageFlags;
  /** Sorted unique `runStatus` values across the entries. */
  uniqueRunStatuses: string[];
  /** Sorted unique entry `status` values across the entries. */
  uniqueEntryStatuses: string[];
  pathBehaviours: BacktestPathBehaviourCoverage;
  scenarios: BacktestCoverageScenarioLists;
  notes: string[];
}

// --- helpers -----------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function round4(n: number): number {
  const r = Number.parseFloat(n.toFixed(4));
  return Object.is(r, -0) ? 0 : r;
}

/** The fixed simulated-behaviour dimensions the coverage ratio is computed over. */
const PATH_BEHAVIOURS = [
  "buyFills",
  "sellFills",
  "rejects",
  "openPositions",
  "closedTrades",
  "realizedPnl",
  "unrealizedPnl",
] as const;

// --- builder -----------------------------------------------------------------

/**
 * Summarize a {@link BacktestSuiteIndex} into a deterministic, byte-stable
 * {@link BacktestSuiteCoverageReport}. Validates the input as a suite index first
 * (a non-index throws {@link import("./suite-validate.js").BacktestSuiteIndexError});
 * the input is never mutated. Uses ONLY fields the index already carries.
 */
export function summarizeBacktestSuiteCoverage(index: unknown): BacktestSuiteCoverageReport {
  const suite: BacktestSuiteIndex = validateBacktestSuiteIndex(index);

  const counts: BacktestCoverageCounts = {
    scenarioCount: suite.entries.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    withWarnings: 0,
    withRejects: 0,
    withBuyFills: 0,
    withSellFills: 0,
    withNoFills: 0,
    withOpenPositions: 0,
    withClosedTrades: 0,
    withRealizedPnl: 0,
    withUnrealizedPnl: 0,
  };

  const scenarios: BacktestCoverageScenarioLists = {
    passed: [],
    failed: [],
    withWarnings: [],
    withRejects: [],
    withNoFills: [],
    withOpenPositions: [],
    withClosedTrades: [],
  };

  const runStatuses = new Set<string>();
  const entryStatuses = new Set<string>();

  for (const e of suite.entries as BacktestSuiteEntry[]) {
    runStatuses.add(e.runStatus);
    entryStatuses.add(e.status);

    if (e.status === "passed") {
      counts.passed += 1;
      scenarios.passed.push(e.id);
    } else {
      counts.failed += 1;
      scenarios.failed.push(e.id);
    }
    if (e.runStatus === "skipped") counts.skipped += 1;
    if (e.warningCodes.length > 0) {
      counts.withWarnings += 1;
      scenarios.withWarnings.push(e.id);
    }

    const s = e.summary;
    if (!s) continue; // a failed/skipped entry has no simulated summary to count

    if (s.rejects > 0) {
      counts.withRejects += 1;
      scenarios.withRejects.push(e.id);
    }
    if (s.buyFills > 0) counts.withBuyFills += 1;
    if (s.sellFills > 0) counts.withSellFills += 1;
    if (s.buyFills + s.sellFills === 0) {
      counts.withNoFills += 1;
      scenarios.withNoFills.push(e.id);
    }
    if (s.openPositions > 0) {
      counts.withOpenPositions += 1;
      scenarios.withOpenPositions.push(e.id);
    }
    if (s.closedTrades > 0) {
      counts.withClosedTrades += 1;
      scenarios.withClosedTrades.push(e.id);
    }
    if (s.realizedPnlUsd !== 0) counts.withRealizedPnl += 1;
    if (s.unrealizedPnlUsd !== 0) counts.withUnrealizedPnl += 1;
  }

  const flags: BacktestCoverageFlags = {
    anyBuyFills: counts.withBuyFills > 0,
    anySellFills: counts.withSellFills > 0,
    anyRejects: counts.withRejects > 0,
    anyWarnings: counts.withWarnings > 0,
    anyOpenPositions: counts.withOpenPositions > 0,
    anyClosedTrades: counts.withClosedTrades > 0,
    anyRealizedPnl: counts.withRealizedPnl > 0,
    anyUnrealizedPnl: counts.withUnrealizedPnl > 0,
    anyFailed: counts.failed > 0,
    anySkipped: counts.skipped > 0,
  };

  // Path-behaviour coverage: fraction of the fixed dimensions exercised by ≥1 scenario.
  const exercised: Record<(typeof PATH_BEHAVIOURS)[number], boolean> = {
    buyFills: flags.anyBuyFills,
    sellFills: flags.anySellFills,
    rejects: flags.anyRejects,
    openPositions: flags.anyOpenPositions,
    closedTrades: flags.anyClosedTrades,
    realizedPnl: flags.anyRealizedPnl,
    unrealizedPnl: flags.anyUnrealizedPnl,
  };
  const covered = PATH_BEHAVIOURS.filter((b) => exercised[b]);
  const missing = PATH_BEHAVIOURS.filter((b) => !exercised[b]);
  const trackedCount: number = PATH_BEHAVIOURS.length;
  const pathBehaviours: BacktestPathBehaviourCoverage = {
    tracked: [...PATH_BEHAVIOURS],
    covered: [...covered],
    missing: [...missing],
    coveredCount: covered.length,
    trackedCount,
    ratio: trackedCount === 0 ? 0 : round4(covered.length / trackedCount),
  };

  const notes = [
    `${counts.scenarioCount} scenario(s): ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped.`,
    `Exercised ${pathBehaviours.coveredCount}/${pathBehaviours.trackedCount} simulated path behaviour(s): ${covered.join(", ") || "(none)"}.`,
    missing.length > 0
      ? `No scenario exercised: ${missing.join(", ")} — add a scenario that does to broaden coverage.`
      : "Every tracked simulated path behaviour was exercised by at least one scenario.",
    "Coverage here is simulated bookkeeping over injected data — not market coverage, not test coverage, not a profitability claim.",
  ];

  return {
    schemaVersion: BACKTEST_COVERAGE_SCHEMA_VERSION,
    banner: BACKTEST_COVERAGE_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    notMarketCoverage: true,
    disclaimers: [...BACKTEST_COVERAGE_DISCLAIMERS],
    suiteName: suite.name,
    counts,
    flags,
    uniqueRunStatuses: [...runStatuses].sort(),
    uniqueEntryStatuses: [...entryStatuses].sort(),
    pathBehaviours,
    scenarios,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

const COUNT_FIELDS: readonly (keyof BacktestCoverageCounts)[] = [
  "scenarioCount",
  "passed",
  "failed",
  "skipped",
  "withWarnings",
  "withRejects",
  "withBuyFills",
  "withSellFills",
  "withNoFills",
  "withOpenPositions",
  "withClosedTrades",
  "withRealizedPnl",
  "withUnrealizedPnl",
];

/**
 * Strictly validate a value as a {@link BacktestSuiteCoverageReport} and return it
 * narrowed. A backstop mirroring the other validators: checks the schema version, the
 * required PAPER-ONLY / not-market-coverage labelling, the disclaimers, and the
 * counts/path-behaviour shapes. Throws {@link BacktestCoverageError}. Pure.
 */
export function validateBacktestSuiteCoverage(value: unknown): BacktestSuiteCoverageReport {
  if (!isObject(value)) {
    throw new BacktestCoverageError("coverage report must be a JSON object");
  }
  if (value.schemaVersion !== BACKTEST_COVERAGE_SCHEMA_VERSION) {
    throw new BacktestCoverageError(`coverage.schemaVersion must be "${BACKTEST_COVERAGE_SCHEMA_VERSION}"`);
  }
  if (value.banner !== BACKTEST_COVERAGE_BANNER) {
    throw new BacktestCoverageError(`coverage.banner must be "${BACKTEST_COVERAGE_BANNER}"`);
  }
  for (const flag of [
    "paperOnly",
    "simulated",
    "notLiveResult",
    "notFinancialAdvice",
    "notProfitabilityClaim",
    "notMarketCoverage",
  ] as const) {
    if (value[flag] !== true) {
      throw new BacktestCoverageError(`coverage.${flag} must be true`);
    }
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new BacktestCoverageError("coverage.disclaimers must be a non-empty array");
  }
  if (!isObject(value.counts)) {
    throw new BacktestCoverageError("coverage.counts must be an object");
  }
  for (const f of COUNT_FIELDS) {
    if (typeof value.counts[f] !== "number") {
      throw new BacktestCoverageError(`coverage.counts.${f} must be a number`);
    }
  }
  if (!isObject(value.pathBehaviours)) {
    throw new BacktestCoverageError("coverage.pathBehaviours must be an object");
  }
  if (typeof value.pathBehaviours.ratio !== "number") {
    throw new BacktestCoverageError("coverage.pathBehaviours.ratio must be a number");
  }
  for (const key of ["tracked", "covered", "missing"] as const) {
    if (!Array.isArray(value.pathBehaviours[key])) {
      throw new BacktestCoverageError(`coverage.pathBehaviours.${key} must be an array`);
    }
  }
  return value as unknown as BacktestSuiteCoverageReport;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatBacktestSuiteCoverage}. */
export interface FormatBacktestSuiteCoverageOptions {
  /** Optional label (e.g. the suite-index file path) echoed into the header. */
  label?: string;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

/**
 * Render a redacted, stable, human-readable coverage report. Deterministic and
 * path-stable (no timestamps). Leads with the PAPER-ONLY banner and closes with the
 * not-live / not-advice / not-market-coverage disclaimers so it can never be mistaken
 * for a live result, a market measure, or a test-coverage report.
 */
export function formatBacktestSuiteCoverage(
  report: BacktestSuiteCoverageReport,
  opts: FormatBacktestSuiteCoverageOptions = {},
): string {
  const title = report.suiteName ?? "backtest suite";
  const header = `${report.banner} — ${title} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];

  if (opts.label) lines.push(`index:     ${opts.label}`);
  lines.push(`suite:     ${report.suiteName ?? "(unnamed)"}`);
  const c = report.counts;
  lines.push(`scenarios: ${c.scenarioCount} (${c.passed} passed, ${c.failed} failed, ${c.skipped} skipped)`);
  lines.push(`statuses:  run=[${report.uniqueRunStatuses.join(", ")}]  entry=[${report.uniqueEntryStatuses.join(", ")}]`);
  lines.push("");

  lines.push("Behaviour counts (scenarios exhibiting each):");
  lines.push(`- buy fills:        ${c.withBuyFills}`);
  lines.push(`- sell fills:       ${c.withSellFills}`);
  lines.push(`- no fills:         ${c.withNoFills}`);
  lines.push(`- rejects:          ${c.withRejects}`);
  lines.push(`- warnings:         ${c.withWarnings}`);
  lines.push(`- open positions:   ${c.withOpenPositions}`);
  lines.push(`- closed trades:    ${c.withClosedTrades}`);
  lines.push(`- realized PnL:     ${c.withRealizedPnl}`);
  lines.push(`- unrealized PnL:   ${c.withUnrealizedPnl}`);
  lines.push("");

  lines.push("Exercised anywhere:");
  lines.push(`- buy fills ${yesNo(report.flags.anyBuyFills)}, sell fills ${yesNo(report.flags.anySellFills)}, rejects ${yesNo(report.flags.anyRejects)}`);
  lines.push(`- open positions ${yesNo(report.flags.anyOpenPositions)}, closed trades ${yesNo(report.flags.anyClosedTrades)}`);
  lines.push(`- realized PnL ${yesNo(report.flags.anyRealizedPnl)}, unrealized PnL ${yesNo(report.flags.anyUnrealizedPnl)}`);
  lines.push("");

  const pb = report.pathBehaviours;
  lines.push(
    `Path-behaviour coverage: ${pb.coveredCount}/${pb.trackedCount} (ratio ${pb.ratio}) — ` +
      "fraction of tracked simulated behaviours exercised by ≥1 scenario (not market/test coverage).",
  );
  lines.push(`- covered: ${pb.covered.join(", ") || "(none)"}`);
  lines.push(`- missing: ${pb.missing.join(", ") || "(none)"}`);
  lines.push("");

  lines.push("Notes:");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of report.disclaimers) lines.push(d);

  return redactString(lines.join("\n"));
}
