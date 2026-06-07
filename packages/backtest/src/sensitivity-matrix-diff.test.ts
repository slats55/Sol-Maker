/**
 * Tests for the Sprint 15 sensitivity MATRIX diff. Everything here is INJECTED test data —
 * fake mints and made-up prices — exercised purely offline. Nothing is real market data, a
 * live result, or a profitability claim.
 *
 * The diff is asserted to (a) report no change for two identical matrices, (b) detect
 * added / removed / content-changed bases, (c) flag conservative regressions (a newly-failing
 * or same-digest-drifted base/cell, a removed passed base, an increased failed count, a
 * schema mismatch) while NOT flagging a legitimately changed (different-content) base, (d)
 * be byte-stable for a given input pair, and (e) refuse a non-matrix input.
 */

import { describe, it, expect } from "vitest";
import {
  diffScenarioVariantSensitivityMatrixReports,
  validateScenarioVariantSensitivityMatrixDiff,
  formatScenarioVariantSensitivityMatrixDiff,
  ScenarioVariantSensitivityMatrixDiffError,
  BACKTEST_SENSITIVITY_MATRIX_DIFF_SCHEMA_VERSION,
} from "./sensitivity-matrix-diff.js";
import {
  runScenarioVariantSensitivityMatrix,
  type ScenarioVariantSensitivityMatrixReport,
} from "./sensitivity-matrix.js";

const MINT = "FakeAAA1111111111111111111111111111111111111";

function buyHold(name: string, p0: number, p1: number): Record<string, unknown> {
  return {
    name: `${name} — INJECTED FIXTURE (simulated, not real market data)`,
    strategyConfig: { minScoreForPaperBuy: 50, minScoreForWatch: 30, maxRiskScore: 60 },
    caps: { maxTradeSizeUsd: 1000, maxDailyLossUsd: 1000, maxOpenPositions: 5, killSwitch: false },
    defaultPaperSizeUsd: 100,
    steps: [
      {
        id: "step-1",
        at: "2026-01-01T00:00:00.000Z",
        candidates: [
          {
            mint: MINT,
            symbol: "FAKEA",
            source: "injected-fixture",
            riskReport: {
              mint: MINT,
              decision: "PASS_FOR_PAPER_EVALUATION",
              score: 12,
              flags: [],
              summary: [],
              generatedAt: "2026-01-01T00:00:00.000Z",
              disclaimer: "Advisory only — INJECTED FIXTURE, not a real risk assessment.",
            },
          },
        ],
        prices: [
          { mint: MINT, priceUsd: p0, observedAt: "2026-01-01T00:00:00.000Z", source: "injected-fixture" },
          { mint: MINT, priceUsd: p1, observedAt: "2026-01-01T01:00:00.000Z", source: "injected-fixture" },
        ],
      },
    ],
  };
}

function plan(): Record<string, unknown> {
  return {
    name: "price-sensitivity — INJECTED, simulated local variants (not live, not advice)",
    variants: [
      { suffix: "price-up-10pct", perturbations: [{ target: "price", op: "multiply", value: 1.1, min: 0 }] },
      { suffix: "price-plus-1usd", perturbations: [{ target: "price", op: "add", value: 1, min: 0, max: 1000000 }] },
    ],
  };
}

/** Run a matrix over alpha(2,3) + beta(4,5). */
function twoBaseMatrix(): ScenarioVariantSensitivityMatrixReport {
  return runScenarioVariantSensitivityMatrix({
    name: "cross-scenario",
    bases: [
      { id: "alpha", scenario: buyHold("alpha", 2, 3) },
      { id: "beta", scenario: buyHold("beta", 4, 5) },
    ],
    plan: plan(),
  }).report;
}

function oneBaseMatrix(): ScenarioVariantSensitivityMatrixReport {
  return runScenarioVariantSensitivityMatrix({
    name: "cross-scenario",
    bases: [{ id: "alpha", scenario: buyHold("alpha", 2, 3) }],
    plan: plan(),
  }).report;
}

function clone(r: ScenarioVariantSensitivityMatrixReport): ScenarioVariantSensitivityMatrixReport {
  return JSON.parse(JSON.stringify(r));
}

describe("diffScenarioVariantSensitivityMatrixReports — identical", () => {
  it("reports no change and no regression for two identical matrices", () => {
    const base = twoBaseMatrix();
    const diff = diffScenarioVariantSensitivityMatrixReports(base, clone(base));

    expect(diff.schemaVersion).toBe(BACKTEST_SENSITIVITY_MATRIX_DIFF_SCHEMA_VERSION);
    expect(diff.compatibility.status).toBe("same-schema");
    expect(diff.addedBases).toEqual([]);
    expect(diff.removedBases).toEqual([]);
    expect(diff.changedBases).toEqual([]);
    expect(diff.variantAggregateChanges).toEqual([]);
    expect(diff.hasRegression).toBe(false);
    expect(diff.regressionReasons).toEqual([]);
    expect(diff.baseCount.delta).toBe(0);
  });
});

describe("diffScenarioVariantSensitivityMatrixReports — added / removed bases", () => {
  it("detects a removed passed base as lost coverage (a regression)", () => {
    const diff = diffScenarioVariantSensitivityMatrixReports(twoBaseMatrix(), oneBaseMatrix());
    expect(diff.removedBases.map((b) => b.id)).toEqual(["beta"]);
    expect(diff.addedBases).toEqual([]);
    expect(diff.baseCount.delta).toBe(-1);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.join("\n")).toMatch(/passed base "beta" from base matrix is missing/);
  });

  it("treats an added base as new coverage, not a regression", () => {
    const diff = diffScenarioVariantSensitivityMatrixReports(oneBaseMatrix(), twoBaseMatrix());
    expect(diff.addedBases.map((b) => b.id)).toEqual(["beta"]);
    expect(diff.removedBases).toEqual([]);
    expect(diff.baseCount.delta).toBe(1);
    expect(diff.hasRegression).toBe(false);
  });
});

describe("diffScenarioVariantSensitivityMatrixReports — changed base (different content)", () => {
  it("lists a content-changed base as 'changed' but NOT a regression", () => {
    const base = twoBaseMatrix();
    const next = runScenarioVariantSensitivityMatrix({
      name: "cross-scenario",
      bases: [
        { id: "alpha", scenario: buyHold("alpha", 2, 3) },
        { id: "beta", scenario: buyHold("beta", 4, 6) }, // different exit price → different digest
      ],
      plan: plan(),
    }).report;

    const diff = diffScenarioVariantSensitivityMatrixReports(base, next);
    const beta = diff.changedBases.find((c) => c.id === "beta");
    expect(beta).toBeDefined();
    expect(beta!.digestMatch).toBe(false);
    expect(beta!.isRegression).toBe(false);
    expect(diff.hasRegression).toBe(false);
  });
});

describe("diffScenarioVariantSensitivityMatrixReports — regressions", () => {
  it("flags a same-digest baseline drift (deterministic replay should be byte-identical)", () => {
    const base = twoBaseMatrix();
    const next = clone(base);
    // Keep the digest, perturb the baseline's simulated total PnL — an impossible
    // deterministic drift that must be flagged.
    next.bases[0]!.baselineSummary!.totalPnlUsd += 7;

    const diff = diffScenarioVariantSensitivityMatrixReports(base, next);
    const changed = diff.changedBases.find((c) => c.id === next.bases[0]!.id)!;
    expect(changed.digestMatch).toBe(true);
    expect(changed.isRegression).toBe(true);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.join("\n")).toMatch(/identical scenario digest but its baseline simulated results differ/);
  });

  it("flags a same-digest cell drift", () => {
    const base = twoBaseMatrix();
    const next = clone(base);
    next.bases[0]!.cells[0]!.summary!.totalPnlUsd += 3;

    const diff = diffScenarioVariantSensitivityMatrixReports(base, next);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.join("\n")).toMatch(/identical digest but its simulated results differ/);
  });

  it("flags a newly-failing baseline", () => {
    const base = twoBaseMatrix();
    const next = clone(base);
    next.bases[0]!.baselineStatus = "failed";

    const diff = diffScenarioVariantSensitivityMatrixReports(base, next);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.join("\n")).toMatch(/baseline passed in base but failed in next/);
  });

  it("flags an increased failed-variant-run count", () => {
    const base = twoBaseMatrix();
    const next = clone(base);
    next.failedVariantRunCount += 2;

    const diff = diffScenarioVariantSensitivityMatrixReports(base, next);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.join("\n")).toMatch(/failed variant run count increased by 2/);
  });

  it("flags a schema-version mismatch", () => {
    const base = twoBaseMatrix();
    const next = clone(base);
    next.schemaVersion = "backtest.sensitivity.matrix.v2";

    const diff = diffScenarioVariantSensitivityMatrixReports(base, next);
    expect(diff.compatibility.status).toBe("schema-mismatch");
    expect(diff.compatibility.compatible).toBe(false);
    expect(diff.hasRegression).toBe(true);
  });
});

describe("diffScenarioVariantSensitivityMatrixReports — purity & stability", () => {
  it("never mutates its inputs", () => {
    const base = twoBaseMatrix();
    const next = twoBaseMatrix();
    const snapB = JSON.stringify(base);
    const snapN = JSON.stringify(next);
    diffScenarioVariantSensitivityMatrixReports(base, next);
    expect(JSON.stringify(base)).toBe(snapB);
    expect(JSON.stringify(next)).toBe(snapN);
  });

  it("is byte-stable for a given input pair", () => {
    const base = twoBaseMatrix();
    const next = oneBaseMatrix();
    const a = diffScenarioVariantSensitivityMatrixReports(base, next);
    const b = diffScenarioVariantSensitivityMatrixReports(base, next);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("diffScenarioVariantSensitivityMatrixReports — refusals", () => {
  it("refuses a non-matrix base input", () => {
    expect(() => diffScenarioVariantSensitivityMatrixReports({}, twoBaseMatrix())).toThrow(
      ScenarioVariantSensitivityMatrixDiffError,
    );
  });

  it("refuses a non-matrix next input", () => {
    expect(() => diffScenarioVariantSensitivityMatrixReports(twoBaseMatrix(), { bases: "nope" })).toThrow(
      ScenarioVariantSensitivityMatrixDiffError,
    );
  });

  it("refuses a malformed cell.scenarioDigest (drives the regression-core digestMatch)", () => {
    const base = twoBaseMatrix();
    const bad = clone(base);
    (bad.bases[0]!.cells[0] as unknown as { scenarioDigest: unknown }).scenarioDigest = 42;
    expect(() => diffScenarioVariantSensitivityMatrixReports(bad, base)).toThrow(/scenarioDigest must be a string or null/);
  });

  it("refuses a malformed cell.changeCount / warningCount", () => {
    const base = twoBaseMatrix();
    const badChange = clone(base);
    (badChange.bases[0]!.cells[0] as unknown as { changeCount: unknown }).changeCount = "x";
    expect(() => diffScenarioVariantSensitivityMatrixReports(badChange, base)).toThrow(/changeCount must be a finite number/);

    const badWarn = clone(base);
    delete (badWarn.bases[0]!.cells[0] as unknown as { warningCount?: unknown }).warningCount;
    expect(() => diffScenarioVariantSensitivityMatrixReports(badWarn, base)).toThrow(/warningCount must be a finite number/);
  });

  it("refuses a malformed base.variantCount and base.baseScenarioName", () => {
    const base = twoBaseMatrix();
    const badCount = clone(base);
    (badCount.bases[0] as unknown as { variantCount: unknown }).variantCount = null;
    expect(() => diffScenarioVariantSensitivityMatrixReports(badCount, base)).toThrow(/variantCount must be a finite number/);

    const badName = clone(base);
    (badName.bases[0] as unknown as { baseScenarioName: unknown }).baseScenarioName = 7;
    expect(() => diffScenarioVariantSensitivityMatrixReports(badName, base)).toThrow(/baseScenarioName must be a string or null/);
  });
});

describe("validateScenarioVariantSensitivityMatrixDiff — backstop", () => {
  it("accepts a produced diff", () => {
    const diff = diffScenarioVariantSensitivityMatrixReports(twoBaseMatrix(), oneBaseMatrix());
    const round = JSON.parse(JSON.stringify(diff));
    expect(validateScenarioVariantSensitivityMatrixDiff(round)).toEqual(diff);
  });

  it("rejects a wrong schema version", () => {
    const diff = diffScenarioVariantSensitivityMatrixReports(twoBaseMatrix(), twoBaseMatrix());
    expect(() =>
      validateScenarioVariantSensitivityMatrixDiff({ ...diff, schemaVersion: "x" }),
    ).toThrow(/schemaVersion/);
  });

  it("rejects a non-object", () => {
    expect(() => validateScenarioVariantSensitivityMatrixDiff(42)).toThrow(/must be a JSON object/);
  });
});

describe("formatScenarioVariantSensitivityMatrixDiff — human output", () => {
  it("renders a sectioned, disclaimered report", () => {
    const diff = diffScenarioVariantSensitivityMatrixReports(twoBaseMatrix(), oneBaseMatrix());
    const text = formatScenarioVariantSensitivityMatrixDiff(diff, { baseLabel: "base/", nextLabel: "next/" });

    expect(text).toContain("Sensitivity matrix diff (SIMULATED PAPER-ONLY)");
    expect(text).toContain("Removed bases (1):");
    expect(text).toContain("Regression: YES");
    expect(text).toContain("Not a live result.");
    expect(text).toContain("Not financial advice.");
  });

  it("is deterministic for a given diff", () => {
    const diff = diffScenarioVariantSensitivityMatrixReports(twoBaseMatrix(), twoBaseMatrix());
    expect(formatScenarioVariantSensitivityMatrixDiff(diff)).toBe(
      formatScenarioVariantSensitivityMatrixDiff(diff),
    );
  });
});
