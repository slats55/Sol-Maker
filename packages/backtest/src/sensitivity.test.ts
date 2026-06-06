/**
 * Tests for the Sprint 13 scenario-variant SENSITIVITY workflow. Everything here is
 * INJECTED test data — fake mints and made-up prices — exercised purely offline.
 * Nothing in this file is real market data, a live result, or a profitability claim.
 *
 * The workflow is asserted to (a) reuse the real Sprint 11 suite path and Sprint 12
 * variant generator rather than re-implement them, (b) produce a byte-stable report,
 * (c) never mutate its inputs, (d) compute per-field deltas that exactly equal
 * variant−baseline, and (e) refuse invalid input.
 */

import { describe, it, expect } from "vitest";
import {
  runScenarioVariantSensitivity,
  buildScenarioVariantSensitivityReport,
  validateScenarioVariantSensitivityReport,
  formatScenarioVariantSensitivityReport,
  ScenarioVariantSensitivityError,
  BACKTEST_SENSITIVITY_SCHEMA_VERSION,
  BACKTEST_SENSITIVITY_BANNER,
  SENSITIVITY_BASELINE_ID,
} from "./sensitivity.js";
import { generateScenarioVariants } from "./scenario-variants.js";
import { BACKTEST_SUITE_SCHEMA_VERSION } from "./suite.js";
import type { BacktestSuiteResult, BacktestSuiteEntrySummary } from "./suite.js";
import type { SensitivitySummaryDeltas } from "./sensitivity.js";
import type { ScenarioVariantsResult } from "./scenario-variants.js";

const MINT = "FakeAAA1111111111111111111111111111111111111";

/** A fresh, valid INJECTED buy & hold scenario (deep new object on every call). */
function buyHoldScenario(): Record<string, unknown> {
  return {
    name: "single-mint buy & hold — INJECTED FIXTURE (simulated, not real market data)",
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
          { mint: MINT, priceUsd: 2, observedAt: "2026-01-01T00:00:00.000Z", source: "injected-fixture" },
          { mint: MINT, priceUsd: 3, observedAt: "2026-01-01T01:00:00.000Z", source: "injected-fixture" },
        ],
      },
    ],
  };
}

/** A plan with one uniform-scale and one additive variant (changes the held PnL). */
function plan(): Record<string, unknown> {
  return {
    name: "price-sensitivity — INJECTED, simulated local variants (not live, not advice)",
    variants: [
      { suffix: "price-up-10pct", perturbations: [{ target: "price", op: "multiply", value: 1.1, min: 0 }] },
      { suffix: "price-plus-1usd", perturbations: [{ target: "price", op: "add", value: 1, min: 0, max: 1000000 }] },
    ],
  };
}

const SUMMARY_FIELDS: (keyof BacktestSuiteEntrySummary)[] = [
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

describe("runScenarioVariantSensitivity — happy path", () => {
  it("produces a labelled, paper-only report with a baseline and one entry per variant", () => {
    const { report } = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: plan() });

    expect(report.schemaVersion).toBe(BACKTEST_SENSITIVITY_SCHEMA_VERSION);
    expect(report.banner).toBe(BACKTEST_SENSITIVITY_BANNER);
    expect(report.paperOnly).toBe(true);
    expect(report.simulated).toBe(true);
    expect(report.notLiveResult).toBe(true);
    expect(report.notFinancialAdvice).toBe(true);
    expect(report.notProfitabilityClaim).toBe(true);
    expect(report.disclaimers.length).toBeGreaterThan(0);

    expect(report.planName).toBe(plan().name);
    expect(report.label).toBe(plan().name);
    expect(report.variantCount).toBe(2);
    expect(report.variants.map((v) => v.suffix)).toEqual(["price-up-10pct", "price-plus-1usd"]);
  });

  it("runs the base scenario as the baseline (passed, with a digest and a real summary)", () => {
    const { report } = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: plan() });

    expect(report.baseline.id).toBe(SENSITIVITY_BASELINE_ID);
    expect(report.baseline.status).toBe("passed");
    expect(report.baseline.runStatus).toBe("passed");
    expect(report.baseScenarioDigest).toBeTruthy();
    expect(report.baseScenarioName).toBe(buyHoldScenario().name);
    // From the known fixture: one buy, $100 sized, held to a 50% higher price.
    expect(report.baseline.summary).toMatchObject({ buyFills: 1, sellFills: 0, totalPnlUsd: 50, simulatedNotionalUsd: 100 });
  });

  it("passes both variants and records how many values each one changed", () => {
    const { report } = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: plan() });
    expect(report.passedVariantCount).toBe(2);
    expect(report.failedVariantCount).toBe(0);
    for (const v of report.variants) {
      expect(v.status).toBe("passed");
      expect(v.changeCount).toBe(2); // two injected price points per variant
      expect(v.summary).not.toBeNull();
      expect(v.deltas).not.toBeNull();
    }
  });
});

describe("runScenarioVariantSensitivity — deltas are exactly variant − baseline", () => {
  it("computes every per-field delta as (variant − baseline)", () => {
    const { report } = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: plan() });
    const base = report.baseline.summary;
    expect(base).not.toBeNull();
    for (const v of report.variants) {
      expect(v.summary).not.toBeNull();
      expect(v.deltas).not.toBeNull();
      const summary = v.summary as BacktestSuiteEntrySummary;
      const deltas = v.deltas as SensitivitySummaryDeltas;
      const baseSummary = base as BacktestSuiteEntrySummary;
      for (const f of SUMMARY_FIELDS) {
        const expected = Number((summary[f] - baseSummary[f]).toFixed(6));
        expect(deltas[f].delta).toBe(expected === 0 ? 0 : expected);
        expect(deltas[f].base).toBe(baseSummary[f]);
        expect(deltas[f].next).toBe(summary[f]);
      }
    }
  });

  it("a uniform price scale leaves held PnL unchanged, while a flat +1 shift moves it", () => {
    const { report } = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: plan() });
    const up = report.variants.find((v) => v.suffix === "price-up-10pct");
    const plus = report.variants.find((v) => v.suffix === "price-plus-1usd");
    // A fixed-USD buy held through a uniform ×1.1 keeps the same 1.5× ratio → no PnL change.
    expect(up?.deltas?.totalPnlUsd.delta).toBe(0);
    // A flat +1 changes the buy/exit ratio, so the held PnL genuinely moves.
    expect(plus?.deltas?.totalPnlUsd.delta).not.toBe(0);
  });
});

describe("runScenarioVariantSensitivity — determinism & non-mutation", () => {
  it("is byte-identical across two runs of the same input", () => {
    const a = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: plan() }).report;
    const b = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: plan() }).report;
    expect(JSON.stringify(a, null, 2)).toBe(JSON.stringify(b, null, 2));
  });

  it("never mutates the base scenario", () => {
    const base = buyHoldScenario();
    const before = JSON.stringify(base);
    runScenarioVariantSensitivity({ base, plan: plan() });
    expect(JSON.stringify(base)).toBe(before);
  });

  it("never mutates the plan", () => {
    const p = plan();
    const before = JSON.stringify(p);
    runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: p });
    expect(JSON.stringify(p)).toBe(before);
  });

  it("derives a null label/planName when the plan is unnamed", () => {
    const unnamed = { variants: plan().variants };
    const { report } = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: unnamed });
    expect(report.planName).toBeNull();
    expect(report.label).toBeNull();
  });
});

describe("runScenarioVariantSensitivity — reuses the existing suite + variant paths", () => {
  it("carries a real Sprint 11 suite index whose summary is the report's suiteSummary", () => {
    const { suiteIndex, report, suiteResult } = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: plan() });
    expect(suiteIndex.schemaVersion).toBe(BACKTEST_SUITE_SCHEMA_VERSION);
    expect(report.suiteSummary).toEqual(suiteIndex.summary);
    // baseline + 2 variants ran through the same suite.
    expect(suiteResult.entries).toHaveLength(3);
    expect(suiteResult.entries[0]?.id).toBe(SENSITIVITY_BASELINE_ID);
  });

  it("uses the SAME variants the public generateScenarioVariants would produce", () => {
    const { variantsResult } = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: plan() });
    const direct = generateScenarioVariants(buyHoldScenario(), plan());
    expect(variantsResult.variants.map((v) => v.suffix)).toEqual(direct.variants.map((v) => v.suffix));
    expect(variantsResult.variants.map((v) => v.changeCount)).toEqual(direct.variants.map((v) => v.changeCount));
    expect(variantsResult.variants.map((v) => v.scenario.name)).toEqual(direct.variants.map((v) => v.scenario.name));
  });
});

describe("runScenarioVariantSensitivity — refuses invalid input", () => {
  it("refuses an invalid base scenario", () => {
    expect(() => runScenarioVariantSensitivity({ base: { name: "x", steps: [] }, plan: plan() })).toThrow();
  });

  it("refuses a base that is not an object", () => {
    expect(() => runScenarioVariantSensitivity({ base: 42, plan: plan() })).toThrow();
  });

  it("refuses an invalid plan (empty variants)", () => {
    expect(() => runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: { variants: [] } })).toThrow();
  });

  it("refuses a plan that is not an object", () => {
    expect(() => runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: "nope" })).toThrow();
  });

  it("refuses a non-object input", () => {
    expect(() => runScenarioVariantSensitivity(null as unknown as { base: unknown; plan: unknown })).toThrow(
      ScenarioVariantSensitivityError,
    );
  });
});

describe("buildScenarioVariantSensitivityReport — failure bookkeeping", () => {
  // Hand-built suite result: a passed baseline + one FAILED variant. This exercises
  // the failed-entry branch (summary null → deltas null) that a generated, validated
  // variant rarely reaches in practice.
  function entrySummary(over: Partial<BacktestSuiteEntrySummary> = {}): BacktestSuiteEntrySummary {
    return {
      stepCount: 1,
      candidateCount: 1,
      buyFills: 1,
      sellFills: 0,
      rejects: 0,
      realizedPnlUsd: 0,
      unrealizedPnlUsd: 50,
      totalPnlUsd: 50,
      openPositions: 1,
      closedTrades: 0,
      simulatedNotionalUsd: 100,
      ...over,
    };
  }

  it("marks a failed variant with a null summary and null deltas, and counts the failure", () => {
    const suiteResult: BacktestSuiteResult = {
      name: "hand-built",
      entries: [
        {
          index: 0,
          id: "base",
          file: null,
          scenarioName: "base",
          scenarioDigest: "deadbeefdeadbeef",
          status: "passed",
          lintStatus: "valid",
          runStatus: "passed",
          errors: [],
          warnings: [],
          summary: entrySummary(),
          report: null,
          reportFile: null,
        },
        {
          index: 1,
          id: "boom",
          file: null,
          scenarioName: null,
          scenarioDigest: null,
          status: "failed",
          lintStatus: "valid",
          runStatus: "failed",
          errors: [{ code: "run-error", message: "synthetic failure" }],
          warnings: [],
          summary: null,
          report: null,
          reportFile: null,
        },
      ],
    };
    const variantsResult: ScenarioVariantsResult = {
      name: "hand-built",
      variants: [
        // The builder reads only suffix + changeCount; the scenario is unused here.
        { suffix: "boom", changeCount: 3, scenario: { name: "x", steps: [] } as never },
      ],
    };

    const report = buildScenarioVariantSensitivityReport(suiteResult, variantsResult);
    expect(report.failedVariantCount).toBe(1);
    expect(report.passedVariantCount).toBe(0);
    const v = report.variants[0];
    expect(v?.status).toBe("failed");
    expect(v?.summary).toBeNull();
    expect(v?.deltas).toBeNull();
    expect(v?.errors[0]?.code).toBe("run-error");
  });

  it("throws when the suite/variant counts disagree", () => {
    const suiteResult: BacktestSuiteResult = {
      name: null,
      entries: [
        {
          index: 0,
          id: "base",
          file: null,
          scenarioName: "base",
          scenarioDigest: "x",
          status: "passed",
          lintStatus: "valid",
          runStatus: "passed",
          errors: [],
          warnings: [],
          summary: entrySummary(),
          report: null,
          reportFile: null,
        },
      ],
    };
    const variantsResult: ScenarioVariantsResult = {
      name: null,
      variants: [{ suffix: "a", changeCount: 1, scenario: { name: "x", steps: [] } as never }],
    };
    expect(() => buildScenarioVariantSensitivityReport(suiteResult, variantsResult)).toThrow(
      ScenarioVariantSensitivityError,
    );
  });
});

describe("validateScenarioVariantSensitivityReport", () => {
  it("accepts a freshly produced report", () => {
    const { report } = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: plan() });
    expect(validateScenarioVariantSensitivityReport(report)).toBe(report);
  });

  it("rejects a wrong schema version", () => {
    const { report } = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: plan() });
    const bad = { ...report, schemaVersion: "backtest.sensitivity.v999" };
    expect(() => validateScenarioVariantSensitivityReport(bad)).toThrow(ScenarioVariantSensitivityError);
  });

  it("rejects a missing paper-only flag", () => {
    const { report } = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: plan() });
    const bad = { ...report, notLiveResult: false };
    expect(() => validateScenarioVariantSensitivityReport(bad)).toThrow(ScenarioVariantSensitivityError);
  });

  it("rejects a malformed variant delta", () => {
    const { report } = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: plan() });
    const bad = JSON.parse(JSON.stringify(report));
    bad.variants[0].deltas.totalPnlUsd = { base: 1 }; // missing next/delta
    expect(() => validateScenarioVariantSensitivityReport(bad)).toThrow(ScenarioVariantSensitivityError);
  });

  it("rejects a non-object", () => {
    expect(() => validateScenarioVariantSensitivityReport(7)).toThrow(ScenarioVariantSensitivityError);
  });
});

describe("runScenarioVariantSensitivity — deterministic rankings (Sprint 14, Slice A)", () => {
  /**
   * Three variants whose suffixes are intentionally out of plan order vs. sort order:
   * `c-plus1` moves the held PnL (Δ ≈ −16.67) while the two multiply variants are
   * PnL-invariant (Δ 0). So the total-PnL ranking must put `c-plus1` first and then
   * break the 0-magnitude tie by suffix (`a-down10` before `b-up10`), proving the
   * order never depends on plan/input order.
   */
  function rankPlan(): Record<string, unknown> {
    return {
      name: "rank-sweep — INJECTED, simulated (not live, not advice)",
      variants: [
        { suffix: "b-up10", perturbations: [{ target: "price", op: "multiply", value: 1.1, min: 0 }] },
        { suffix: "a-down10", perturbations: [{ target: "price", op: "multiply", value: 0.9, min: 0 }] },
        { suffix: "c-plus1", perturbations: [{ target: "price", op: "add", value: 1, min: 0, max: 1000000 }] },
      ],
    };
  }

  it("exposes all seven ranking dimensions as arrays", () => {
    const { report } = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: rankPlan() });
    const r = report.rankings;
    for (const key of [
      "byTotalSimulatedPnlDelta",
      "byRealizedSimulatedPnlDelta",
      "byUnrealizedSimulatedPnlDelta",
      "byFillDelta",
      "byRejectDelta",
      "byWarningDelta",
      "byNotionalDelta",
    ] as const) {
      expect(Array.isArray(r[key])).toBe(true);
      // Every diffable (passed) variant appears in every dimension.
      expect(r[key]).toHaveLength(3);
    }
  });

  it("orders by |delta| descending and breaks ties stably by suffix (not plan order)", () => {
    const { report } = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: rankPlan() });
    const total = report.rankings.byTotalSimulatedPnlDelta;
    // c-plus1 (the only PnL-mover) first; then the 0-magnitude tie resolves a-down10 < b-up10.
    expect(total.map((e) => e.suffix)).toEqual(["c-plus1", "a-down10", "b-up10"]);
    // Magnitudes are non-increasing and equal |value|.
    for (let i = 0; i < total.length; i += 1) {
      const e = total[i];
      expect(e?.magnitude).toBe(Math.abs(e?.value ?? NaN));
      if (i > 0) expect((total[i - 1]?.magnitude ?? 0) >= (e?.magnitude ?? 0)).toBe(true);
    }
  });

  it("ranks a NEGATIVE movement first by magnitude (direction kept in the signed value)", () => {
    const { report } = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: rankPlan() });
    const top = report.rankings.byTotalSimulatedPnlDelta[0];
    expect(top?.suffix).toBe("c-plus1");
    expect(top?.value).toBeLessThan(0); // the largest movement is a negative delta
    expect(top?.magnitude).toBeGreaterThan(0);
  });

  it("breaks an all-zero ranking purely by suffix (notional is invariant here)", () => {
    const { report } = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: rankPlan() });
    // Every variant buys the same $100 notional, so every notional delta is 0 → suffix order.
    const notional = report.rankings.byNotionalDelta;
    expect(notional.map((e) => e.value)).toEqual([0, 0, 0]);
    expect(notional.map((e) => e.suffix)).toEqual(["a-down10", "b-up10", "c-plus1"]);
  });

  it("keeps rankings byte-stable across two identical runs", () => {
    const a = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: rankPlan() }).report.rankings;
    const b = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: rankPlan() }).report.rankings;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces empty rankings when the baseline did not run (no diffable variant)", () => {
    // Hand-built: a FAILED baseline (null summary) ⇒ every variant delta is null ⇒ no ranking entries.
    const suiteResult: BacktestSuiteResult = {
      name: null,
      entries: [
        {
          index: 0, id: "base", file: null, scenarioName: null, scenarioDigest: null,
          status: "failed", lintStatus: "valid", runStatus: "failed",
          errors: [{ code: "run-error", message: "synthetic baseline failure" }],
          warnings: [], summary: null, report: null, reportFile: null,
        },
        {
          index: 1, id: "v1", file: null, scenarioName: "v1", scenarioDigest: "abc123abc123abc1",
          status: "passed", lintStatus: "valid", runStatus: "passed",
          errors: [], warnings: [],
          summary: {
            stepCount: 1, candidateCount: 1, buyFills: 1, sellFills: 0, rejects: 0,
            realizedPnlUsd: 0, unrealizedPnlUsd: 50, totalPnlUsd: 50,
            openPositions: 1, closedTrades: 0, simulatedNotionalUsd: 100,
          },
          report: null, reportFile: null,
        },
      ],
    };
    const variantsResult: ScenarioVariantsResult = {
      name: null,
      variants: [{ suffix: "v1", changeCount: 1, scenario: { name: "x", steps: [] } as never }],
    };
    const report = buildScenarioVariantSensitivityReport(suiteResult, variantsResult);
    for (const list of Object.values(report.rankings)) {
      expect(list).toHaveLength(0);
    }
  });

  it("validates valid rankings and rejects malformed rankings", () => {
    const { report } = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: rankPlan() });
    expect(validateScenarioVariantSensitivityReport(report)).toBe(report);

    const missingDim = JSON.parse(JSON.stringify(report));
    delete missingDim.rankings.byRejectDelta;
    expect(() => validateScenarioVariantSensitivityReport(missingDim)).toThrow(ScenarioVariantSensitivityError);

    const badEntry = JSON.parse(JSON.stringify(report));
    badEntry.rankings.byTotalSimulatedPnlDelta[0] = { suffix: "x" }; // missing value/magnitude
    expect(() => validateScenarioVariantSensitivityReport(badEntry)).toThrow(ScenarioVariantSensitivityError);

    const notObject = JSON.parse(JSON.stringify(report));
    notObject.rankings = [];
    expect(() => validateScenarioVariantSensitivityReport(notObject)).toThrow(ScenarioVariantSensitivityError);
  });

  it("renders a concise ranked summary in the human report with neutral wording", () => {
    const { report } = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: rankPlan() });
    const text = formatScenarioVariantSensitivityReport(report);
    expect(text).toContain("Rankings (largest simulated bookkeeping movement vs baseline");
    expect(text).toContain("Largest simulated total-PnL delta: c-plus1");
    // The header explicitly disclaims a best/winner/profit framing.
    expect(text).toContain("not a best/winner/profit ranking");
    // No AFFIRMATIVE profit/advice framing (the guardrails' forbidden phrasings).
    const lower = text.toLowerCase();
    expect(lower).not.toContain("most profitable");
    expect(lower).not.toContain("buy this");
    expect(lower).not.toContain("trading edge");
    expect(lower).not.toContain("profit prediction");
  });
});

describe("formatScenarioVariantSensitivityReport", () => {
  it("renders the banner and the required not-live / not-advice / not-profit labels", () => {
    const { report } = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: plan() });
    const text = formatScenarioVariantSensitivityReport(report, { label: "base.json" });
    expect(text).toContain(BACKTEST_SENSITIVITY_BANNER);
    expect(text).toContain("PAPER ONLY");
    expect(text.toLowerCase()).toContain("not a live result");
    expect(text.toLowerCase()).toContain("not financial advice");
    expect(text.toLowerCase()).toContain("not a profitability claim");
    expect(text).toContain("price-up-10pct");
    expect(text).toContain("price-plus-1usd");
  });

  it("is deterministic across two formats of the same report", () => {
    const { report } = runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: plan() });
    expect(formatScenarioVariantSensitivityReport(report)).toBe(formatScenarioVariantSensitivityReport(report));
  });
});
