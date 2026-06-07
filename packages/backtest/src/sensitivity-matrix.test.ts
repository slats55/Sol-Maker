/**
 * Tests for the Sprint 15 MULTI-BASE sensitivity MATRIX. Everything here is INJECTED
 * test data — fake mints and made-up prices — exercised purely offline. Nothing in this
 * file is real market data, a live result, or a profitability claim.
 *
 * The matrix is asserted to (a) reuse the real Sprint 13 sensitivity workflow per base
 * rather than re-implement it, (b) produce a byte-stable, base-order-independent report,
 * (c) never mutate its inputs, (d) aggregate each (base × variant) cell delta exactly
 * (cross-checked against an independent naive reduction), (e) rank suffixes by cross-base
 * magnitude with stable tie-breaks, and (f) refuse invalid / duplicate / incompatible
 * input by naming the offending base.
 */

import { describe, it, expect } from "vitest";
import {
  runScenarioVariantSensitivityMatrix,
  buildScenarioVariantSensitivityMatrixReport,
  validateScenarioVariantSensitivityMatrixReport,
  formatScenarioVariantSensitivityMatrixReport,
  ScenarioVariantSensitivityMatrixError,
  BACKTEST_SENSITIVITY_MATRIX_SCHEMA_VERSION,
  BACKTEST_SENSITIVITY_MATRIX_BANNER,
} from "./sensitivity-matrix.js";
import type {
  ScenarioVariantSensitivityMatrixReport,
  ScenarioVariantSensitivityMatrixDeltaStat,
} from "./sensitivity-matrix.js";
import { runScenarioVariantSensitivity } from "./sensitivity.js";

const MINT = "FakeAAA1111111111111111111111111111111111111";

/**
 * A fresh, valid INJECTED buy & hold scenario with a parametrized entry/exit price (deep
 * new object on every call). Fixed-USD sizing at `p0` then held to `p1`, so the simulated
 * unrealized PnL is `100 * (p1 - p0) / p0`.
 */
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

/** A plan with a uniform-scale (PnL-invariant), a downscale, and an additive variant. */
function plan(): Record<string, unknown> {
  return {
    name: "price-sensitivity — INJECTED, simulated local variants (not live, not advice)",
    variants: [
      { suffix: "price-up-10pct", perturbations: [{ target: "price", op: "multiply", value: 1.1, min: 0 }] },
      { suffix: "price-down-10pct", perturbations: [{ target: "price", op: "multiply", value: 0.9, min: 0 }] },
      { suffix: "price-plus-1usd", perturbations: [{ target: "price", op: "add", value: 1, min: 0, max: 1000000 }] },
    ],
  };
}

function round6(n: number): number {
  const r = Number.parseFloat(n.toFixed(6));
  return Object.is(r, -0) ? 0 : r;
}

/** Independent, naive reference reduction of a list of signed deltas → a delta stat. */
function naiveStat(values: number[]): ScenarioVariantSensitivityMatrixDeltaStat {
  if (values.length === 0) return { count: 0, sum: 0, min: 0, max: 0, meanMagnitude: 0, maxMagnitude: 0 };
  const mags = values.map((v) => Math.abs(v));
  return {
    count: values.length,
    sum: round6(values.reduce((a, b) => a + b, 0)),
    min: round6(Math.min(...values)),
    max: round6(Math.max(...values)),
    meanMagnitude: round6(mags.reduce((a, b) => a + b, 0) / values.length),
    maxMagnitude: round6(Math.max(...mags)),
  };
}

/** Pull every diffable cell's total-PnL delta for a suffix from the report rows. */
function cellTotalPnlDeltas(report: ScenarioVariantSensitivityMatrixReport, suffix: string): number[] {
  const out: number[] = [];
  for (const base of report.bases) {
    const cell = base.cells.find((c) => c.suffix === suffix);
    if (cell?.deltas) out.push(cell.deltas.totalPnlUsd.delta);
  }
  return out;
}

function twoBaseInput() {
  return {
    name: "cross-scenario price sensitivity",
    bases: [
      { id: "alpha", scenario: buyHold("alpha", 2, 3) },
      { id: "beta", scenario: buyHold("beta", 4, 5) },
    ],
    plan: plan(),
  };
}

describe("runScenarioVariantSensitivityMatrix — happy path", () => {
  it("produces a paper-only, labelled matrix over multiple bases", () => {
    const { report } = runScenarioVariantSensitivityMatrix(twoBaseInput());

    expect(report.schemaVersion).toBe(BACKTEST_SENSITIVITY_MATRIX_SCHEMA_VERSION);
    expect(report.banner).toBe(BACKTEST_SENSITIVITY_MATRIX_BANNER);
    expect(report.paperOnly).toBe(true);
    expect(report.simulated).toBe(true);
    expect(report.notLiveResult).toBe(true);
    expect(report.notFinancialAdvice).toBe(true);
    expect(report.notProfitabilityClaim).toBe(true);
    expect(report.disclaimers.length).toBeGreaterThan(0);

    expect(report.matrixName).toBe("cross-scenario price sensitivity");
    expect(report.label).toBe("cross-scenario price sensitivity");
    expect(report.planName).toBe(plan().name);
    expect(report.baseCount).toBe(2);
    expect(report.variantCount).toBe(3);
    expect(report.passedBaseCount).toBe(2);
    expect(report.failedBaseCount).toBe(0);
    expect(report.passedVariantRunCount).toBe(6); // 2 bases × 3 variants, all pass
    expect(report.failedVariantRunCount).toBe(0);
  });

  it("orders base rows by id and gives each a rectangular set of variant cells", () => {
    const { report } = runScenarioVariantSensitivityMatrix(twoBaseInput());
    expect(report.bases.map((b) => b.id)).toEqual(["alpha", "beta"]);
    for (const base of report.bases) {
      expect(base.cells.map((c) => c.suffix)).toEqual([
        "price-up-10pct",
        "price-down-10pct",
        "price-plus-1usd",
      ]);
      expect(base.baselineStatus).toBe("passed");
      expect(base.baselineSummary).not.toBeNull();
    }
  });

  it("returns base runs in id-sorted order carrying the full Sprint 13 artifacts", () => {
    const { baseRuns } = runScenarioVariantSensitivityMatrix(twoBaseInput());
    expect(baseRuns.map((r) => r.id)).toEqual(["alpha", "beta"]);
    expect(baseRuns[0]!.run.report.schemaVersion).toBe("backtest.sensitivity.v1");
    expect(baseRuns[0]!.run.suiteIndex).toBeDefined();
  });

  it("each cell delta equals the underlying Sprint 13 entry delta (reuses, not re-implements)", () => {
    const input = twoBaseInput();
    const { report } = runScenarioVariantSensitivityMatrix(input);

    // Independently run the Sprint 13 workflow for base alpha and compare its variant
    // deltas to the matrix cells — the matrix must carry the SAME numbers.
    const alpha = runScenarioVariantSensitivity({ base: buyHold("alpha", 2, 3), plan: plan() });
    const alphaRow = report.bases.find((b) => b.id === "alpha")!;
    for (const entry of alpha.report.variants) {
      const cell = alphaRow.cells.find((c) => c.suffix === entry.suffix)!;
      expect(cell.deltas).toEqual(entry.deltas);
      expect(cell.summary).toEqual(entry.summary);
      expect(cell.status).toBe(entry.status);
    }
  });
});

describe("runScenarioVariantSensitivityMatrix — aggregation correctness", () => {
  it("aggregates each variant's total-PnL delta across bases (vs an independent reduction)", () => {
    const { report } = runScenarioVariantSensitivityMatrix(twoBaseInput());

    for (const agg of report.variantAggregates) {
      const expected = naiveStat(cellTotalPnlDeltas(report, agg.suffix));
      expect(agg.totalPnlDelta).toEqual(expected);
      expect(agg.baseCount).toBe(2);
      expect(agg.diffableCount).toBe(2);
    }
  });

  it("the additive variant lowers simulated PnL on both bases (sum/max-magnitude reflect it)", () => {
    const { report } = runScenarioVariantSensitivityMatrix(twoBaseInput());
    const plus = report.variantAggregates.find((a) => a.suffix === "price-plus-1usd")!;

    // alpha: 100*(1)/3 - 50 = -16.666667 ; beta: 100*(1)/5 - 25 = -5
    const deltas = cellTotalPnlDeltas(report, "price-plus-1usd");
    expect(deltas).toHaveLength(2);
    expect(plus.totalPnlDelta.sum).toBeLessThan(0);
    expect(plus.totalPnlDelta.max).toBeLessThanOrEqual(0); // every base moved down or flat
    expect(plus.totalPnlDelta.maxMagnitude).toBe(round6(Math.max(...deltas.map((d) => Math.abs(d)))));
  });

  it("a uniform price multiply is PnL-invariant — its total-PnL aggregate is ~0", () => {
    const { report } = runScenarioVariantSensitivityMatrix(twoBaseInput());
    const up = report.variantAggregates.find((a) => a.suffix === "price-up-10pct")!;
    expect(up.totalPnlDelta.maxMagnitude).toBeCloseTo(0, 5);
    expect(up.totalPnlDelta.sum).toBeCloseTo(0, 5);
  });

  it("variantAggregates are sorted by suffix ascending", () => {
    const { report } = runScenarioVariantSensitivityMatrix(twoBaseInput());
    const suffixes = report.variantAggregates.map((a) => a.suffix);
    expect(suffixes).toEqual([...suffixes].sort());
  });
});

describe("runScenarioVariantSensitivityMatrix — rankings", () => {
  it("ranks the additive variant first by total-PnL magnitude; zero-movement ties break by suffix", () => {
    const { report } = runScenarioVariantSensitivityMatrix(twoBaseInput());
    const ranked = report.rankings.byMaxTotalPnlMagnitude;
    expect(ranked[0]!.suffix).toBe("price-plus-1usd");
    // The two PnL-invariant variants share value 0 → ordered by suffix ascending.
    const zeros = ranked.filter((r) => r.value === 0).map((r) => r.suffix);
    expect(zeros).toEqual([...zeros].sort());
    // Every plan suffix is present exactly once in every ranking.
    expect(ranked.map((r) => r.suffix).sort()).toEqual([
      "price-down-10pct",
      "price-plus-1usd",
      "price-up-10pct",
    ]);
  });

  it("ranking values are non-negative magnitudes sorted descending", () => {
    const { report } = runScenarioVariantSensitivityMatrix(twoBaseInput());
    for (const list of Object.values(report.rankings)) {
      for (const e of list) expect(e.value).toBeGreaterThanOrEqual(0);
      for (let i = 1; i < list.length; i += 1) {
        expect(list[i - 1]!.value).toBeGreaterThanOrEqual(list[i]!.value);
      }
    }
  });
});

describe("runScenarioVariantSensitivityMatrix — determinism & purity", () => {
  it("is byte-stable across two runs of identical input", () => {
    const a = runScenarioVariantSensitivityMatrix(twoBaseInput()).report;
    const b = runScenarioVariantSensitivityMatrix(twoBaseInput()).report;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("is independent of base input order (sorted by id)", () => {
    const forward = runScenarioVariantSensitivityMatrix(twoBaseInput()).report;
    const reversed = runScenarioVariantSensitivityMatrix({
      name: "cross-scenario price sensitivity",
      bases: [
        { id: "beta", scenario: buyHold("beta", 4, 5) },
        { id: "alpha", scenario: buyHold("alpha", 2, 3) },
      ],
      plan: plan(),
    }).report;
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
  });

  it("never mutates the input scenarios or plan", () => {
    const input = twoBaseInput();
    const snapshot = JSON.stringify(input);
    runScenarioVariantSensitivityMatrix(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("carries no timestamp-like fields anywhere in the report", () => {
    const { report } = runScenarioVariantSensitivityMatrix(twoBaseInput());
    const json = JSON.stringify(report);
    // The only ISO strings are the INJECTED step/price observation times echoed in
    // scenario digests' inputs — the report itself has no generatedAt/createdAt.
    expect(json).not.toMatch(/"generatedAt"/);
    expect(json).not.toMatch(/"createdAt"/);
    expect(json).not.toMatch(/"timestamp"/);
  });
});

describe("runScenarioVariantSensitivityMatrix — refusals", () => {
  it("refuses a non-object input", () => {
    expect(() => runScenarioVariantSensitivityMatrix(null as never)).toThrow(
      ScenarioVariantSensitivityMatrixError,
    );
  });

  it("refuses an empty base list", () => {
    expect(() =>
      runScenarioVariantSensitivityMatrix({ bases: [], plan: plan() }),
    ).toThrow(/non-empty array/);
  });

  it("refuses a base with a missing id", () => {
    expect(() =>
      runScenarioVariantSensitivityMatrix({
        bases: [{ id: "", scenario: buyHold("x", 2, 3) }],
        plan: plan(),
      }),
    ).toThrow(/non-empty string/);
  });

  it("refuses duplicate base ids (before any run)", () => {
    expect(() =>
      runScenarioVariantSensitivityMatrix({
        bases: [
          { id: "dup", scenario: buyHold("a", 2, 3) },
          { id: "dup", scenario: buyHold("b", 4, 5) },
        ],
        plan: plan(),
      }),
    ).toThrow(/duplicate base id "dup"/);
  });

  it("refuses a malformed plan, surfacing the failing base id", () => {
    expect(() =>
      runScenarioVariantSensitivityMatrix({
        bases: [{ id: "alpha", scenario: buyHold("a", 2, 3) }],
        plan: { variants: [] },
      }),
    ).toThrow(/base "alpha" could not be swept through the plan/);
  });

  it("refuses an invalid base scenario, surfacing the base id", () => {
    expect(() =>
      runScenarioVariantSensitivityMatrix({
        bases: [
          { id: "alpha", scenario: buyHold("a", 2, 3) },
          { id: "broken", scenario: {} },
        ],
        plan: plan(),
      }),
    ).toThrow(/base "broken" could not be swept through the plan/);
  });

  it("refuses a base incompatible with the plan (a perturbation matching nothing)", () => {
    const mintFilteredPlan = {
      name: "mint-filtered",
      variants: [
        {
          suffix: "ghost",
          perturbations: [{ target: "price", op: "multiply", value: 1.1, min: 0, mint: "FakeZZZ9999999999999999999999999999999999999" }],
        },
      ],
    };
    expect(() =>
      runScenarioVariantSensitivityMatrix({
        bases: [{ id: "alpha", scenario: buyHold("a", 2, 3) }],
        plan: mintFilteredPlan,
      }),
    ).toThrow(/base "alpha" could not be swept through the plan/);
  });
});

describe("buildScenarioVariantSensitivityMatrixReport — direct builder", () => {
  it("refuses an empty base-run list", () => {
    expect(() => buildScenarioVariantSensitivityMatrixReport([])).toThrow(
      /at least one base run/,
    );
  });

  it("refuses non-rectangular bases (different variant sets)", () => {
    const alpha = runScenarioVariantSensitivity({ base: buyHold("a", 2, 3), plan: plan() }).report;
    const oneVariantPlan = {
      name: "one",
      variants: [{ suffix: "only", perturbations: [{ target: "price", op: "multiply", value: 1.1, min: 0 }] }],
    };
    const beta = runScenarioVariantSensitivity({ base: buyHold("b", 4, 5), plan: oneVariantPlan }).report;
    expect(() =>
      buildScenarioVariantSensitivityMatrixReport([
        { id: "alpha", report: alpha },
        { id: "beta", report: beta },
      ]),
    ).toThrow(/different variant set/);
  });

  it("refuses duplicate ids", () => {
    const r = runScenarioVariantSensitivity({ base: buyHold("a", 2, 3), plan: plan() }).report;
    expect(() =>
      buildScenarioVariantSensitivityMatrixReport([
        { id: "same", report: r },
        { id: "same", report: r },
      ]),
    ).toThrow(/duplicate base id "same"/);
  });
});

describe("validateScenarioVariantSensitivityMatrixReport — backstop", () => {
  it("accepts a produced report and returns it narrowed", () => {
    const { report } = runScenarioVariantSensitivityMatrix(twoBaseInput());
    const round = JSON.parse(JSON.stringify(report));
    expect(validateScenarioVariantSensitivityMatrixReport(round)).toEqual(report);
  });

  it("rejects a non-object", () => {
    expect(() => validateScenarioVariantSensitivityMatrixReport(null)).toThrow(
      /must be a JSON object/,
    );
  });

  it("rejects a wrong schema version", () => {
    const { report } = runScenarioVariantSensitivityMatrix(twoBaseInput());
    const bad = { ...report, schemaVersion: "backtest.sensitivity.matrix.v2" };
    expect(() => validateScenarioVariantSensitivityMatrixReport(bad)).toThrow(/schemaVersion/);
  });

  it("rejects a missing paper-only flag", () => {
    const { report } = runScenarioVariantSensitivityMatrix(twoBaseInput());
    const bad = { ...report, paperOnly: false };
    expect(() => validateScenarioVariantSensitivityMatrixReport(bad)).toThrow(/paperOnly must be true/);
  });

  it("rejects a malformed variant aggregate", () => {
    const { report } = runScenarioVariantSensitivityMatrix(twoBaseInput());
    const bad = JSON.parse(JSON.stringify(report));
    bad.variantAggregates[0].totalPnlDelta = { count: 1 }; // missing fields
    expect(() => validateScenarioVariantSensitivityMatrixReport(bad)).toThrow(/is malformed/);
  });
});

describe("formatScenarioVariantSensitivityMatrixReport — human output", () => {
  it("leads with the banner and carries the required PAPER-ONLY disclaimers", () => {
    const { report } = runScenarioVariantSensitivityMatrix(twoBaseInput());
    const text = formatScenarioVariantSensitivityMatrixReport(report, { label: "scenarios/" });

    expect(text.startsWith(BACKTEST_SENSITIVITY_MATRIX_BANNER)).toBe(true);
    expect(text).toContain("scenarios: scenarios/");
    expect(text).toContain("Not a live result.");
    expect(text).toContain("Not financial advice.");
    expect(text).toContain("Not a profitability claim.");
    // Neutral ranking wording — the only mention of "winner" is the disclaimer that
    // it is NOT a best/winner/profit ranking.
    expect(text).toContain("not a best/winner/profit ranking");
    // Lists each base id and each variant suffix.
    expect(text).toContain("alpha");
    expect(text).toContain("beta");
    expect(text).toContain("price-plus-1usd");
  });

  it("is deterministic for a given report", () => {
    const { report } = runScenarioVariantSensitivityMatrix(twoBaseInput());
    expect(formatScenarioVariantSensitivityMatrixReport(report)).toBe(
      formatScenarioVariantSensitivityMatrixReport(report),
    );
  });
});
