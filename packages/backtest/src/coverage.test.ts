/**
 * Tests for the Sprint 14 (Slice E) SUITE COVERAGE summary. Everything here is
 * INJECTED test data exercised purely offline. Coverage here is behavioural
 * bookkeeping — NOT market coverage, NOT test coverage, and NOT a profitability claim.
 */

import { describe, it, expect } from "vitest";
import {
  summarizeBacktestSuiteCoverage,
  validateBacktestSuiteCoverage,
  formatBacktestSuiteCoverage,
  BacktestCoverageError,
  BACKTEST_COVERAGE_SCHEMA_VERSION,
  BACKTEST_COVERAGE_BANNER,
} from "./coverage.js";
import {
  runBacktestSuite,
  buildBacktestSuiteIndex,
  BACKTEST_SUITE_SCHEMA_VERSION,
  type BacktestSuiteEntry,
  type BacktestSuiteEntrySummary,
  type BacktestSuiteIndex,
} from "./suite.js";
import { buildExampleBacktestScenario } from "./templates.js";

function summary(over: Partial<BacktestSuiteEntrySummary> = {}): BacktestSuiteEntrySummary {
  return {
    stepCount: 1,
    candidateCount: 1,
    buyFills: 0,
    sellFills: 0,
    rejects: 0,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    totalPnlUsd: 0,
    openPositions: 0,
    closedTrades: 0,
    simulatedNotionalUsd: 0,
    ...over,
  };
}

function entry(over: Partial<BacktestSuiteEntry> & Pick<BacktestSuiteEntry, "id">): BacktestSuiteEntry {
  return {
    index: 0,
    file: null,
    scenarioName: over.id,
    scenarioDigest: "deadbeefdeadbeef",
    status: "passed",
    lintStatus: "valid",
    runStatus: "passed",
    errors: [],
    warningCodes: [],
    summary: summary(),
    reportFile: null,
    ...over,
  };
}

function emptySuiteSummary() {
  return {
    scenarioCount: 0, passedCount: 0, failedCount: 0, warningCount: 0,
    totalStepCount: 0, totalCandidateCount: 0, totalBuyFills: 0, totalSellFills: 0,
    totalFills: 0, totalRejects: 0, totalRealizedPnlUsd: 0, totalUnrealizedPnlUsd: 0,
    totalSimulatedPnlUsd: 0, totalSimulatedNotionalUsd: 0, totalOpenPositions: 0, totalClosedTrades: 0,
  };
}

function index(entries: BacktestSuiteEntry[], name: string | null = "coverage-suite"): BacktestSuiteIndex {
  return {
    schemaVersion: BACKTEST_SUITE_SCHEMA_VERSION,
    banner: "SIMULATED PAPER-ONLY SUITE",
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: ["x"],
    name,
    summary: emptySuiteSummary(),
    entries,
    notes: [],
  };
}

/** A diverse, hand-built index: a hold, a full exit, a pure-reject, and a failure. */
function diverseIndex(): BacktestSuiteIndex {
  return index([
    entry({ id: "buy-hold", summary: summary({ buyFills: 1, openPositions: 1, unrealizedPnlUsd: 50, totalPnlUsd: 50, simulatedNotionalUsd: 100 }) }),
    entry({ id: "full-exit", warningCodes: ["kill-switch-on"], summary: summary({ buyFills: 1, sellFills: 1, closedTrades: 1, realizedPnlUsd: 25, totalPnlUsd: 25, simulatedNotionalUsd: 200 }) }),
    entry({ id: "rejected", summary: summary({ rejects: 1 }) }),
    entry({ id: "broken", status: "failed", lintStatus: "invalid", runStatus: "skipped", summary: null }),
  ]);
}

describe("summarizeBacktestSuiteCoverage — counts & flags", () => {
  it("counts scenarios per behaviour from the index", () => {
    const cov = summarizeBacktestSuiteCoverage(diverseIndex());
    expect(cov.schemaVersion).toBe(BACKTEST_COVERAGE_SCHEMA_VERSION);
    expect(cov.banner).toBe(BACKTEST_COVERAGE_BANNER);
    expect(cov.notMarketCoverage).toBe(true);

    const c = cov.counts;
    expect(c.scenarioCount).toBe(4);
    expect(c.passed).toBe(3);
    expect(c.failed).toBe(1);
    expect(c.skipped).toBe(1);
    expect(c.withWarnings).toBe(1);
    expect(c.withRejects).toBe(1);
    expect(c.withBuyFills).toBe(2);
    expect(c.withSellFills).toBe(1);
    expect(c.withNoFills).toBe(1); // the pure-reject passed entry produced no fills
    expect(c.withOpenPositions).toBe(1);
    expect(c.withClosedTrades).toBe(1);
    expect(c.withRealizedPnl).toBe(1);
    expect(c.withUnrealizedPnl).toBe(1);
  });

  it("sets the any-behaviour flags and unique statuses", () => {
    const cov = summarizeBacktestSuiteCoverage(diverseIndex());
    expect(cov.flags).toMatchObject({
      anyBuyFills: true, anySellFills: true, anyRejects: true, anyWarnings: true,
      anyOpenPositions: true, anyClosedTrades: true, anyRealizedPnl: true,
      anyUnrealizedPnl: true, anyFailed: true, anySkipped: true,
    });
    expect(cov.uniqueRunStatuses).toEqual(["passed", "skipped"]);
    expect(cov.uniqueEntryStatuses).toEqual(["failed", "passed"]);
  });

  it("lists scenario ids per behaviour in entry order", () => {
    const cov = summarizeBacktestSuiteCoverage(diverseIndex());
    expect(cov.scenarios.passed).toEqual(["buy-hold", "full-exit", "rejected"]);
    expect(cov.scenarios.failed).toEqual(["broken"]);
    expect(cov.scenarios.withWarnings).toEqual(["full-exit"]);
    expect(cov.scenarios.withRejects).toEqual(["rejected"]);
    expect(cov.scenarios.withNoFills).toEqual(["rejected"]);
    expect(cov.scenarios.withOpenPositions).toEqual(["buy-hold"]);
    expect(cov.scenarios.withClosedTrades).toEqual(["full-exit"]);
  });
});

describe("summarizeBacktestSuiteCoverage — path-behaviour coverage ratio", () => {
  it("reports full coverage (7/7, ratio 1) for a diverse suite", () => {
    const pb = summarizeBacktestSuiteCoverage(diverseIndex()).pathBehaviours;
    expect(pb.trackedCount).toBe(7);
    expect(pb.coveredCount).toBe(7);
    expect(pb.ratio).toBe(1);
    expect(pb.missing).toEqual([]);
  });

  it("reports partial coverage with a clearly-defined ratio and a missing list", () => {
    // Only a single buy-hold: buyFills + openPositions + unrealizedPnl exercised (3/7).
    const cov = summarizeBacktestSuiteCoverage(
      index([entry({ id: "only-hold", summary: summary({ buyFills: 1, openPositions: 1, unrealizedPnlUsd: 50, totalPnlUsd: 50 }) })]),
    );
    const pb = cov.pathBehaviours;
    expect(pb.coveredCount).toBe(3);
    expect(pb.covered).toEqual(["buyFills", "openPositions", "unrealizedPnl"]);
    expect(pb.missing).toEqual(["sellFills", "rejects", "closedTrades", "realizedPnl"]);
    expect(pb.ratio).toBe(0.4286); // 3/7 rounded to 4 decimals
  });
});

describe("summarizeBacktestSuiteCoverage — determinism, validation, real suite", () => {
  it("is byte-stable across two summaries of the same index", () => {
    const a = summarizeBacktestSuiteCoverage(diverseIndex());
    const b = summarizeBacktestSuiteCoverage(diverseIndex());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("never mutates its input", () => {
    const idx = diverseIndex();
    const before = JSON.stringify(idx);
    summarizeBacktestSuiteCoverage(idx);
    expect(JSON.stringify(idx)).toBe(before);
  });

  it("refuses a value that is not a suite index", () => {
    expect(() => summarizeBacktestSuiteCoverage(7)).toThrow();
    expect(() => summarizeBacktestSuiteCoverage({ schemaVersion: "x" })).toThrow();
  });

  it("works on a REAL suite index produced by runBacktestSuite", () => {
    const result = runBacktestSuite({
      name: "real-suite",
      scenarios: [
        { scenario: buildExampleBacktestScenario("buy-hold"), id: "hold" },
        { scenario: buildExampleBacktestScenario("buy-full-exit"), id: "exit" },
      ],
    });
    const idx = buildBacktestSuiteIndex(result);
    const cov = summarizeBacktestSuiteCoverage(idx);
    expect(cov.counts.scenarioCount).toBe(2);
    expect(cov.counts.passed + cov.counts.failed).toBe(2);
    expect(cov.flags.anyBuyFills).toBe(true);
    expect(cov.pathBehaviours.trackedCount).toBe(7);
  });

  it("validates a produced report and rejects a malformed one", () => {
    const cov = summarizeBacktestSuiteCoverage(diverseIndex());
    expect(validateBacktestSuiteCoverage(cov)).toBe(cov);
    expect(() => validateBacktestSuiteCoverage({ ...cov, schemaVersion: "nope" })).toThrow(BacktestCoverageError);
    expect(() => validateBacktestSuiteCoverage({ ...cov, notMarketCoverage: false })).toThrow(BacktestCoverageError);
    expect(() => validateBacktestSuiteCoverage(7)).toThrow(BacktestCoverageError);
  });
});

describe("formatBacktestSuiteCoverage", () => {
  it("renders the banner and the required not-live / not-market-coverage labels", () => {
    const cov = summarizeBacktestSuiteCoverage(diverseIndex());
    const text = formatBacktestSuiteCoverage(cov, { label: "suite-index.json" });
    expect(text).toContain(BACKTEST_COVERAGE_BANNER);
    expect(text).toContain("PAPER ONLY");
    expect(text.toLowerCase()).toContain("not market coverage");
    expect(text.toLowerCase()).toContain("not a live result");
    expect(text.toLowerCase()).toContain("not a profitability claim");
    expect(text).toContain("Path-behaviour coverage: 7/7");
    // Deterministic.
    expect(formatBacktestSuiteCoverage(cov)).toBe(formatBacktestSuiteCoverage(cov));
  });

  it("uses neutral wording (no profit/advice framing)", () => {
    const lower = formatBacktestSuiteCoverage(summarizeBacktestSuiteCoverage(diverseIndex())).toLowerCase();
    expect(lower).not.toContain("most profitable");
    expect(lower).not.toContain("buy this");
    expect(lower).not.toContain("trading edge");
  });
});
