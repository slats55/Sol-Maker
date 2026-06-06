/**
 * Tests for the pure, deterministic backtest SUITE model (Sprint 11). Every input
 * is an injected fixture (built from the in-repo templates); nothing here touches a
 * file, the network, a wallet, or a key. The suite is simulated bookkeeping only.
 */

import { describe, it, expect } from "vitest";
import {
  runBacktestSuite,
  buildBacktestSuiteIndex,
  validateBacktestSuiteInput,
  BacktestSuiteInputError,
  formatBacktestSuiteIndex,
  buildExampleBacktestScenario,
  BACKTEST_SUITE_SCHEMA_VERSION,
} from "./index.js";
import type { BacktestSuiteScenario } from "./index.js";

/** A buy-and-hold scenario (passes, 1 buy fill, 0 warnings). */
function buyHold(): unknown {
  return buildExampleBacktestScenario("buy-hold", { name: "bh" });
}
/** A buy → full-exit scenario (passes, 1 buy + 1 sell, 0 warnings). */
function buyFullExit(): unknown {
  return buildExampleBacktestScenario("buy-full-exit", { name: "bfe" });
}
/** A seed-journal scenario (passes, carries the "initial-journal-open-positions" warning). */
function seedJournal(): unknown {
  return buildExampleBacktestScenario("seed-journal-continuation", { name: "seed" });
}
/** A structurally-invalid scenario (empty steps ⇒ a lint error). */
function emptySteps(): unknown {
  return { name: "bad", strategyConfig: { minScoreForPaperBuy: 50, minScoreForWatch: 30, maxRiskScore: 60 }, caps: { maxTradeSizeUsd: 100, maxDailyLossUsd: 100, maxOpenPositions: 1 }, steps: [] };
}

function envelopes(): BacktestSuiteScenario[] {
  return [
    { scenario: buyHold(), file: "a.scenario.json", id: "a" },
    { scenario: buyFullExit(), file: "b.scenario.json", id: "b" },
    { scenario: seedJournal(), file: "c.scenario.json", id: "c" },
  ];
}

describe("validateBacktestSuiteInput", () => {
  it("throws on a globally-invalid input shape", () => {
    expect(() => validateBacktestSuiteInput(42)).toThrow(BacktestSuiteInputError);
    expect(() => validateBacktestSuiteInput(null)).toThrow(BacktestSuiteInputError);
    expect(() => validateBacktestSuiteInput({})).toThrow(/scenarios must be an array/);
    expect(() => validateBacktestSuiteInput({ scenarios: [], name: 7 })).toThrow(/name must be a string/);
  });

  it("accepts an empty scenario list (the pure layer does not require a non-empty suite)", () => {
    const parsed = validateBacktestSuiteInput({ name: "x", scenarios: [] });
    expect(parsed.scenarios).toEqual([]);
    expect(parsed.name).toBe("x");
  });
});

describe("runBacktestSuite + buildBacktestSuiteIndex", () => {
  it("runs a multi-scenario suite into a deterministic index in input order", () => {
    const index = buildBacktestSuiteIndex(runBacktestSuite({ name: "suite", scenarios: envelopes() }));
    expect(index.schemaVersion).toBe(BACKTEST_SUITE_SCHEMA_VERSION);
    expect(index.name).toBe("suite");
    expect(index.entries.map((e) => e.id)).toEqual(["a", "b", "c"]); // input order preserved
    expect(index.summary.scenarioCount).toBe(3);
    expect(index.summary.passedCount).toBe(3);
    expect(index.summary.failedCount).toBe(0);
    // buy-hold (1 buy), buy-full-exit (1 buy + 1 sell), seed-journal (continues an open pos).
    expect(index.summary.totalBuyFills).toBeGreaterThanOrEqual(2);
    expect(index.summary.totalFills).toBe(index.summary.totalBuyFills + index.summary.totalSellFills);
  });

  it("records lint warnings for a scenario that still runs", () => {
    const result = runBacktestSuite({ scenarios: [{ scenario: seedJournal(), id: "seed" }] });
    const e = result.entries[0]!;
    expect(e.status).toBe("passed");
    expect(e.runStatus).toBe("passed");
    expect(e.warnings.map((w) => w.code)).toContain("initial-journal-open-positions");
    const index = buildBacktestSuiteIndex(result);
    expect(index.entries[0]!.warningCodes).toContain("initial-journal-open-positions");
    expect(index.summary.warningCount).toBe(1);
  });

  it("fails a lint-error scenario WITHOUT running it (skipped), not crashing the suite", () => {
    const result = runBacktestSuite({
      scenarios: [
        { scenario: emptySteps(), id: "bad" },
        { scenario: buyHold(), id: "good" },
      ],
    });
    const [bad, good] = result.entries;
    expect(bad!.status).toBe("failed");
    expect(bad!.lintStatus).toBe("invalid");
    expect(bad!.runStatus).toBe("skipped");
    expect(bad!.summary).toBeNull();
    expect(bad!.report).toBeNull();
    expect(bad!.errors.length).toBeGreaterThan(0);
    // The valid scenario after it still runs fine.
    expect(good!.status).toBe("passed");
  });

  it("fails ONE malformed scenario entry but keeps the rest of the suite running", () => {
    const result = runBacktestSuite({
      scenarios: [
        { scenario: buyHold(), id: "ok1" },
        { scenario: 42, id: "garbage" }, // not an object ⇒ lint structural error
        { scenario: buyFullExit(), id: "ok2" },
      ],
    });
    expect(result.entries.map((e) => e.status)).toEqual(["passed", "failed", "passed"]);
    expect(result.entries[1]!.errors[0]!.code).toBeTruthy();
  });

  it("aggregate counts exactly match the sum over entries", () => {
    const result = runBacktestSuite({
      scenarios: [
        { scenario: buyHold(), id: "a" },
        { scenario: emptySteps(), id: "bad" },
        { scenario: buyFullExit(), id: "b" },
      ],
    });
    const index = buildBacktestSuiteIndex(result);
    const passed = index.entries.filter((e) => e.status === "passed");
    expect(index.summary.scenarioCount).toBe(index.entries.length);
    expect(index.summary.passedCount).toBe(passed.length);
    expect(index.summary.failedCount).toBe(index.entries.length - passed.length);
    const sumBuy = passed.reduce((acc, e) => acc + (e.summary?.buyFills ?? 0), 0);
    const sumSell = passed.reduce((acc, e) => acc + (e.summary?.sellFills ?? 0), 0);
    expect(index.summary.totalBuyFills).toBe(sumBuy);
    expect(index.summary.totalSellFills).toBe(sumSell);
    expect(index.summary.totalFills).toBe(sumBuy + sumSell);
  });

  it("produces a byte-stable index JSON for the same input", () => {
    const a = JSON.stringify(buildBacktestSuiteIndex(runBacktestSuite({ name: "s", scenarios: envelopes() })));
    const b = JSON.stringify(buildBacktestSuiteIndex(runBacktestSuite({ name: "s", scenarios: envelopes() })));
    expect(a).toBe(b);
  });

  it("never mutates the input scenarios", () => {
    const input = { name: "s", scenarios: envelopes() };
    const snapshot = JSON.parse(JSON.stringify(input));
    runBacktestSuite(input);
    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });

  it("carries the required PAPER-ONLY suite disclaimers + banner", () => {
    const index = buildBacktestSuiteIndex(runBacktestSuite({ scenarios: envelopes() }));
    expect(index.banner).toBe("SIMULATED PAPER-ONLY SUITE");
    const joined = index.disclaimers.join("\n");
    expect(joined).toContain("SIMULATED PAPER-ONLY SUITE");
    expect(joined).toContain("Uses injected scenario data only");
    expect(joined).toContain("Not a live result");
    expect(joined).toContain("Not financial advice");
    expect(joined).toContain("Not a profitability claim");
    expect(index.paperOnly).toBe(true);
    expect(index.notProfitabilityClaim).toBe(true);
  });

  it("derives entry ids from id, then file, then a positional fallback", () => {
    const result = runBacktestSuite({
      scenarios: [
        { scenario: buyHold() }, // no id/file ⇒ scenario-1
        { scenario: buyHold(), file: "named.scenario.json" }, // ⇒ file
        { scenario: buyHold(), id: "explicit", file: "f.json" }, // ⇒ id
      ],
    });
    expect(result.entries.map((e) => e.id)).toEqual(["scenario-1", "named.scenario.json", "explicit"]);
  });

  it("echoes a report filename only for a PASSED scenario", () => {
    const result = runBacktestSuite({
      scenarios: [
        { scenario: buyHold(), id: "ok", reportFile: "ok.report.json" },
        { scenario: emptySteps(), id: "bad", reportFile: "bad.report.json" },
      ],
    });
    expect(result.entries[0]!.reportFile).toBe("ok.report.json");
    expect(result.entries[1]!.reportFile).toBeNull(); // failed ⇒ no report written
  });
});

describe("formatBacktestSuiteIndex", () => {
  it("renders a deterministic, sectioned, PAPER-ONLY report", () => {
    const index = buildBacktestSuiteIndex(runBacktestSuite({ name: "demo", scenarios: envelopes() }));
    const text = formatBacktestSuiteIndex(index);
    expect(text).toContain("SIMULATED PAPER-ONLY SUITE");
    expect(text).toContain("Suite:");
    expect(text).toContain("Aggregate (simulated, passed scenarios only):");
    expect(text).toContain("Entries (3):");
    expect(text).toContain("Not a profitability claim");
    // Stable for a given index object.
    expect(formatBacktestSuiteIndex(index)).toBe(text);
  });
});
