/**
 * Tests for the pure, deterministic backtest SUITE DIFF (Sprint 11). It compares
 * two injected suite indexes; nothing here touches a file, the network, a wallet,
 * or a key. A delta is simulated bookkeeping, never profit/loss or advice.
 */

import { describe, it, expect } from "vitest";
import {
  runBacktestSuite,
  buildBacktestSuiteIndex,
  diffBacktestSuites,
  formatBacktestSuiteDiff,
  buildExampleBacktestScenario,
  BacktestSuiteIndexError,
  BACKTEST_SUITE_DIFF_SCHEMA_VERSION,
} from "./index.js";
import type { BacktestSuiteIndex, BacktestSuiteScenario } from "./index.js";

function buyHold(name = "bh"): unknown {
  return buildExampleBacktestScenario("buy-hold", { name });
}
function buyFullExit(name = "bfe"): unknown {
  return buildExampleBacktestScenario("buy-full-exit", { name });
}
function emptySteps(name = "bad"): unknown {
  return { name, strategyConfig: { minScoreForPaperBuy: 50, minScoreForWatch: 30, maxRiskScore: 60 }, caps: { maxTradeSizeUsd: 100, maxDailyLossUsd: 100, maxOpenPositions: 1 }, steps: [] };
}

/** Build a suite index from a list of scenario envelopes. */
function indexFrom(scenarios: BacktestSuiteScenario[], name = "suite"): BacktestSuiteIndex {
  return buildBacktestSuiteIndex(runBacktestSuite({ name, scenarios }));
}

/** Deep-clone a suite index (plain JSON) so a test can tweak the "next" side. */
function clone(index: BacktestSuiteIndex): BacktestSuiteIndex {
  return JSON.parse(JSON.stringify(index)) as BacktestSuiteIndex;
}

describe("diffBacktestSuites — input validation", () => {
  it("refuses a non-index input", () => {
    expect(() => diffBacktestSuites(42, indexFrom([{ scenario: buyHold() }]))).toThrow(BacktestSuiteIndexError);
    expect(() => diffBacktestSuites(indexFrom([{ scenario: buyHold() }]), { not: "an index" })).toThrow(
      BacktestSuiteIndexError,
    );
  });
});

describe("diffBacktestSuites — pairing + regressions", () => {
  it("an identical suite diffs to no regression and zero deltas", () => {
    const base = indexFrom([{ scenario: buyHold(), id: "a" }, { scenario: buyFullExit(), id: "b" }]);
    const next = indexFrom([{ scenario: buyHold(), id: "a" }, { scenario: buyFullExit(), id: "b" }]);
    const diff = diffBacktestSuites(base, next);
    expect(diff.schemaVersion).toBe(BACKTEST_SUITE_DIFF_SCHEMA_VERSION);
    expect(diff.hasRegression).toBe(false);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed.every((c) => c.isRegression === false)).toBe(true);
    expect(diff.changed.every((c) => c.digestMatch === true)).toBe(true);
    expect(diff.summary.totalSimulatedPnlUsd.delta).toBe(0);
  });

  it("detects an added scenario (no regression for a pure addition)", () => {
    const base = indexFrom([{ scenario: buyHold(), id: "a" }]);
    const next = indexFrom([{ scenario: buyHold(), id: "a" }, { scenario: buyFullExit(), id: "b" }]);
    const diff = diffBacktestSuites(base, next);
    expect(diff.added.map((r) => r.id)).toEqual(["b"]);
    expect(diff.removed).toEqual([]);
    expect(diff.hasRegression).toBe(false);
  });

  it("detects a removed scenario (a dropped passed scenario is a regression)", () => {
    const base = indexFrom([{ scenario: buyHold(), id: "a" }, { scenario: buyFullExit(), id: "b" }]);
    const next = indexFrom([{ scenario: buyHold(), id: "a" }]);
    const diff = diffBacktestSuites(base, next);
    expect(diff.removed.map((r) => r.id)).toEqual(["b"]);
    expect(diff.added).toEqual([]);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.some((r) => /missing from next/.test(r))).toBe(true);
  });

  it("marks a SAME-digest result change as a regression", () => {
    const base = indexFrom([{ scenario: buyHold(), id: "a" }]);
    const next = clone(base);
    // Same scenarioDigest, but a worse simulated total/realized PnL.
    const e = next.entries[0]!;
    e.summary!.realizedPnlUsd -= 10;
    e.summary!.totalPnlUsd -= 10;
    const diff = diffBacktestSuites(base, next);
    expect(diff.changed[0]!.pairing).toBe("same-digest");
    expect(diff.changed[0]!.digestMatch).toBe(true);
    expect(diff.changed[0]!.isRegression).toBe(true);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.some((r) => /total simulated PnL decreased/.test(r))).toBe(true);
  });

  it("marks a DIFFERENT-digest pair (same name) as changed but NOT a regression by default", () => {
    const base = indexFrom([{ scenario: buyHold("shared"), id: "a" }]);
    const next = indexFrom([{ scenario: buyFullExit("shared"), id: "a" }]);
    const diff = diffBacktestSuites(base, next);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]!.pairing).toBe("same-name");
    expect(diff.changed[0]!.digestMatch).toBe(false);
    expect(diff.changed[0]!.isRegression).toBe(false);
    expect(diff.hasRegression).toBe(false);
  });

  it("marks an increased failed count as a regression", () => {
    const base = indexFrom([{ scenario: buyHold(), id: "a" }]);
    const next = indexFrom([{ scenario: buyHold(), id: "a" }, { scenario: emptySteps(), id: "bad" }]);
    const diff = diffBacktestSuites(base, next);
    expect(diff.summary.failedCount.delta).toBe(1);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.some((r) => /failed scenario count increased/.test(r))).toBe(true);
  });

  it("marks an increased warning count for a SAME-digest scenario as a regression", () => {
    const base = indexFrom([{ scenario: buyHold(), id: "a" }]);
    const next = clone(base);
    next.entries[0]!.warningCodes.push("some-warning");
    next.summary.warningCount += 1;
    const diff = diffBacktestSuites(base, next);
    expect(diff.changed[0]!.warningCodes.added).toEqual(["some-warning"]);
    expect(diff.changed[0]!.isRegression).toBe(true);
    expect(diff.regressionReasons.some((r) => /warning\(s\) appeared/.test(r))).toBe(true);
  });

  it("flags a newly-failing scenario as a regression even when the digest changed", () => {
    const base = indexFrom([{ scenario: buyHold("shared"), id: "a" }]); // passes
    const next = clone(base);
    // Same name, different digest, and now failed.
    next.entries[0]!.scenarioDigest = "ffffffffffffffff";
    next.entries[0]!.status = "failed";
    next.entries[0]!.summary = null;
    next.summary.passedCount = 0;
    next.summary.failedCount = 1;
    const diff = diffBacktestSuites(base, next);
    expect(diff.hasRegression).toBe(true);
    expect(diff.failedChanged).toHaveLength(1);
  });

  it("orders changed entries by NEXT order; added by next order; removed by base order", () => {
    const base = indexFrom([{ scenario: buyHold(), id: "a" }, { scenario: buyFullExit(), id: "b" }]);
    const next = indexFrom([{ scenario: buyFullExit(), id: "b" }, { scenario: buyHold(), id: "a" }]);
    const diff = diffBacktestSuites(base, next);
    expect(diff.changed.map((c) => c.id)).toEqual(["b", "a"]); // next order
  });

  it("is byte-stable for the same input pair and does not mutate its inputs", () => {
    const base = indexFrom([{ scenario: buyHold(), id: "a" }, { scenario: buyFullExit(), id: "b" }]);
    const next = indexFrom([{ scenario: buyHold(), id: "a" }]);
    const baseSnap = JSON.stringify(base);
    const nextSnap = JSON.stringify(next);
    const a = JSON.stringify(diffBacktestSuites(base, next));
    const b = JSON.stringify(diffBacktestSuites(base, next));
    expect(a).toBe(b);
    expect(JSON.stringify(base)).toBe(baseSnap); // inputs unchanged
    expect(JSON.stringify(next)).toBe(nextSnap);
  });

  it("flags a suite index schema mismatch as a regression", () => {
    const base = indexFrom([{ scenario: buyHold(), id: "a" }]);
    const next = clone(base);
    next.schemaVersion = "backtest.suite.v2";
    const diff = diffBacktestSuites(base, next);
    expect(diff.compatibility.status).toBe("schema-mismatch");
    expect(diff.hasRegression).toBe(true);
  });
});

describe("formatBacktestSuiteDiff", () => {
  it("renders a deterministic, sectioned, PAPER-ONLY suite diff", () => {
    const base = indexFrom([{ scenario: buyHold(), id: "a" }]);
    const next = indexFrom([{ scenario: buyHold(), id: "a" }, { scenario: buyFullExit(), id: "b" }]);
    const text = formatBacktestSuiteDiff(diffBacktestSuites(base, next));
    expect(text).toContain("Backtest suite diff (SIMULATED PAPER-ONLY)");
    expect(text).toContain("Suite pair:");
    expect(text).toContain("Compatibility:");
    expect(text).toContain("Aggregate deltas (simulated):");
    expect(text).toContain("Added scenarios (1):");
    expect(text).toContain("Not a profitability claim");
    expect(formatBacktestSuiteDiff(diffBacktestSuites(base, next))).toBe(text);
  });
});
