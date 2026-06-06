import { describe, it, expect } from "vitest";
import {
  generateScenarioVariants,
  explainScenarioVariantPlan,
  validateScenarioVariantPlanExplanation,
  formatScenarioVariantPlanExplanation,
  ScenarioVariantError,
  BACKTEST_VARIANT_PLAN_EXPLAIN_SCHEMA_VERSION,
  BACKTEST_VARIANT_PLAN_EXPLAIN_BANNER,
} from "./scenario-variants.js";
import { buildExampleBacktestScenario } from "./templates.js";
import { runBacktest } from "./backtest.js";
import { lintBacktestScenario } from "./lint.js";
import { digestContent } from "./digest.js";
import { runScenarioVariantSensitivity } from "./sensitivity.js";
import type { BacktestScenario } from "./types.js";

const MINT_A = "FakeAAA1111111111111111111111111111111111111";
const MINT_B = "FakeBBB2222222222222222222222222222222222222";

/** buy-hold base: two MINT_A price points (2, 3); candidate has no metrics. */
function priceBase(): BacktestScenario {
  return buildExampleBacktestScenario("buy-hold", { name: "variants base — INJECTED FIXTURE" });
}

/** A base whose single candidate carries injected numeric metrics to perturb. */
function metricBase(): BacktestScenario {
  const s = priceBase();
  s.steps[0]!.candidates[0]!.metrics = {
    priceUsd: 2,
    liquidityUsd: 10_000,
    volumeUsd: 5_000,
    holderCount: 100,
  };
  return s;
}

/** Multi-mint base (partial-exit): MINT_A appears in two steps, plus B and C. */
function multiMintBase(): BacktestScenario {
  return buildExampleBacktestScenario("partial-exit", { name: "multi base — INJECTED FIXTURE" });
}

const PRICE_UP = {
  name: "price-sensitivity",
  variants: [
    { suffix: "price-up-10pct", perturbations: [{ target: "price", op: "multiply", value: 1.1, min: 0 }] },
    { suffix: "price-down-10pct", perturbations: [{ target: "price", op: "multiply", value: 0.9, min: 0 }] },
  ],
};

describe("generateScenarioVariants — happy path", () => {
  it("generates validating variants with derived names and exact perturbed prices", () => {
    // Exact-in-binary multipliers so the value assertions are precise.
    const result = generateScenarioVariants(priceBase(), {
      name: "price-sweep",
      variants: [
        { suffix: "x2", perturbations: [{ target: "price", op: "multiply", value: 2 }] },
        { suffix: "half", perturbations: [{ target: "price", op: "multiply", value: 0.5 }] },
      ],
    });
    expect(result.name).toBe("price-sweep");
    expect(result.variants.map((v) => v.suffix)).toEqual(["x2", "half"]);
    // Names keep the base name (+ INJECTED labelling) and append the suffix.
    expect(result.variants[0]?.scenario.name).toBe("variants base — INJECTED FIXTURE [x2]");
    // Both MINT_A price points (2, 3) were perturbed.
    expect(result.variants[0]?.changeCount).toBe(2);
    expect(result.variants[0]?.scenario.steps[0]?.prices.map((p) => p.priceUsd)).toEqual([4, 6]);
    expect(result.variants[1]?.scenario.steps[0]?.prices.map((p) => p.priceUsd)).toEqual([1, 1.5]);
    // Every variant lints valid and runs.
    for (const v of result.variants) {
      expect(lintBacktestScenario(v.scenario).valid).toBe(true);
      expect(() => runBacktest(v.scenario)).not.toThrow();
    }
  });

  it("is deterministic (byte-stable) even for non-terminating IEEE results", () => {
    // 3 * 1.1 is 3.3000000000000003 — fine, as long as it is the SAME every time.
    const a = generateScenarioVariants(priceBase(), PRICE_UP);
    const b = generateScenarioVariants(priceBase(), PRICE_UP);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Lints valid + runs (the realistic ±10% sweep used by the shipped example plan).
    for (const v of a.variants) {
      expect(lintBacktestScenario(v.scenario).valid).toBe(true);
      expect(() => runBacktest(v.scenario)).not.toThrow();
    }
  });

  it("applies the `add` op as an additive delta", () => {
    const result = generateScenarioVariants(priceBase(), {
      variants: [{ suffix: "plus5", perturbations: [{ target: "price", op: "add", value: 5 }] }],
    });
    expect(result.variants[0]?.scenario.steps[0]?.prices.map((p) => p.priceUsd)).toEqual([7, 8]);
  });

  it("perturbs a candidate metric field (metric.<field>) and leaves others alone", () => {
    const result = generateScenarioVariants(metricBase(), {
      variants: [
        { suffix: "liq-up", perturbations: [{ target: "metric.liquidityUsd", op: "multiply", value: 2 }] },
      ],
    });
    const metrics = result.variants[0]?.scenario.steps[0]?.candidates[0]?.metrics;
    expect(metrics?.liquidityUsd).toBe(20_000); // perturbed
    expect(metrics?.volumeUsd).toBe(5_000); // untouched
    expect(result.variants[0]?.changeCount).toBe(1);
  });

  it("restricts a perturbation to a single mint when `mint` is set", () => {
    const result = generateScenarioVariants(multiMintBase(), {
      variants: [
        { suffix: "a-only", perturbations: [{ target: "price", op: "multiply", value: 10, mint: MINT_A }] },
      ],
    });
    const v = result.variants[0]!.scenario;
    // MINT_A appears once in step-1 and once in step-2 → 2 changes; B/C untouched.
    expect(result.variants[0]?.changeCount).toBe(2);
    const aPrices = v.steps.flatMap((s) => s.prices).filter((p) => p.mint === MINT_A).map((p) => p.priceUsd);
    const bPrices = v.steps.flatMap((s) => s.prices).filter((p) => p.mint === MINT_B).map((p) => p.priceUsd);
    expect(aPrices).toEqual([20, 30]); // 2→20, 3→30
    expect(bPrices).toEqual([4, 5]); // unchanged
  });
});

describe("generateScenarioVariants — bounds enforcement", () => {
  it("clamps the result to the explicit [min, max] bounds", () => {
    const result = generateScenarioVariants(priceBase(), {
      variants: [{ suffix: "capped", perturbations: [{ target: "price", op: "multiply", value: 10, max: 25 }] }],
    });
    // 2*10=20 (<=25 kept); 3*10=30 → clamped to 25.
    expect(result.variants[0]?.scenario.steps[0]?.prices.map((p) => p.priceUsd)).toEqual([20, 25]);
  });

  it("clamps up to a min bound", () => {
    const result = generateScenarioVariants(priceBase(), {
      variants: [{ suffix: "floored", perturbations: [{ target: "price", op: "multiply", value: 0, min: 1 }] }],
    });
    expect(result.variants[0]?.scenario.steps[0]?.prices.map((p) => p.priceUsd)).toEqual([1, 1]);
  });

  it("refuses min > max", () => {
    expect(() =>
      generateScenarioVariants(priceBase(), {
        variants: [{ suffix: "bad", perturbations: [{ target: "price", op: "add", value: 1, min: 5, max: 1 }] }],
      }),
    ).toThrow(/must be <= max/);
  });

  it("refuses a perturbation that produces a non-finite value (no usable bound)", () => {
    const huge = priceBase();
    huge.steps[0]!.prices[0]!.priceUsd = 1e308;
    expect(() =>
      generateScenarioVariants(huge, {
        variants: [{ suffix: "overflow", perturbations: [{ target: "price", op: "multiply", value: 10 }] }],
      }),
    ).toThrow(/non-finite price/);
  });
});

describe("generateScenarioVariants — safety + refusals", () => {
  it("refuses an empty or missing variants array", () => {
    expect(() => generateScenarioVariants(priceBase(), { variants: [] })).toThrow(ScenarioVariantError);
    expect(() => generateScenarioVariants(priceBase(), { variants: [] })).toThrow(/non-empty array/);
    expect(() => generateScenarioVariants(priceBase(), {})).toThrow(/non-empty array/);
  });

  it("refuses an empty perturbations array", () => {
    expect(() =>
      generateScenarioVariants(priceBase(), { variants: [{ suffix: "x", perturbations: [] }] }),
    ).toThrow(/perturbations must be a non-empty array/);
  });

  it("refuses an unknown target (a bare section prefix is not a config target)", () => {
    // "caps.*" is NOT a valid target — config fields are reached via "config.<field>".
    expect(() =>
      generateScenarioVariants(priceBase(), {
        variants: [{ suffix: "x", perturbations: [{ target: "caps.maxTradeSizeUsd", op: "add", value: 1 }] }],
      }),
    ).toThrow(/is not allowed — use "price", "metric/);
  });

  it("refuses an unknown metric field", () => {
    expect(() =>
      generateScenarioVariants(priceBase(), {
        variants: [{ suffix: "x", perturbations: [{ target: "metric.notAField", op: "add", value: 1 }] }],
      }),
    ).toThrow(/metric field must be one of/);
  });

  it("refuses an unknown op", () => {
    expect(() =>
      generateScenarioVariants(priceBase(), {
        variants: [{ suffix: "x", perturbations: [{ target: "price", op: "divide", value: 2 }] }],
      }),
    ).toThrow(/op must be one of/);
  });

  it("refuses a non-finite value", () => {
    for (const value of ["1", null, { nested: 1 }]) {
      expect(() =>
        generateScenarioVariants(priceBase(), {
          variants: [{ suffix: "x", perturbations: [{ target: "price", op: "add", value }] }],
        }),
      ).toThrow(/value must be a finite number/);
    }
  });

  it("refuses an unknown perturbation key (no smuggling)", () => {
    expect(() =>
      generateScenarioVariants(priceBase(), {
        variants: [{ suffix: "x", perturbations: [{ target: "price", op: "add", value: 1, eval: "x" }] }],
      }),
    ).toThrow(/may only set target, op, value, min, max, mint/);
  });

  it("refuses a perturbation that matches no values", () => {
    // metric.liquidityUsd is absent on the buy-hold candidate.
    expect(() =>
      generateScenarioVariants(priceBase(), {
        variants: [{ suffix: "x", perturbations: [{ target: "metric.liquidityUsd", op: "add", value: 1 }] }],
      }),
    ).toThrow(/matched no values/);
    // A mint filter that matches nothing.
    expect(() =>
      generateScenarioVariants(priceBase(), {
        variants: [{ suffix: "y", perturbations: [{ target: "price", op: "add", value: 1, mint: "Nope" }] }],
      }),
    ).toThrow(/matched no values/);
  });

  it("refuses a duplicate suffix", () => {
    expect(() =>
      generateScenarioVariants(priceBase(), {
        variants: [
          { suffix: "dup", perturbations: [{ target: "price", op: "add", value: 1 }] },
          { suffix: "dup", perturbations: [{ target: "price", op: "add", value: 2 }] },
        ],
      }),
    ).toThrow(/duplicated/);
  });

  it("refuses an unsafe suffix (path separators / traversal / spaces)", () => {
    for (const suffix of ["a/b", "..", "a\\b", "has space"]) {
      expect(() =>
        generateScenarioVariants(priceBase(), {
          variants: [{ suffix, perturbations: [{ target: "price", op: "add", value: 1 }] }],
        }),
      ).toThrow(/path separators/);
    }
  });

  it("refuses an invalid base scenario", () => {
    expect(() => generateScenarioVariants({ not: "a scenario" }, PRICE_UP)).toThrow(
      /base scenario is invalid/,
    );
  });

  it("does not mutate a deeply frozen base scenario", () => {
    const b = priceBase();
    Object.freeze(b);
    Object.freeze(b.strategyConfig);
    Object.freeze(b.caps);
    Object.freeze(b.steps);
    for (const step of b.steps) {
      Object.freeze(step);
      Object.freeze(step.prices);
      for (const price of step.prices) Object.freeze(price);
      Object.freeze(step.candidates);
      for (const c of step.candidates) Object.freeze(c);
    }
    const snapshot = JSON.stringify(b);
    expect(() => generateScenarioVariants(b, PRICE_UP)).not.toThrow();
    expect(JSON.stringify(b)).toBe(snapshot);
  });
});

describe("explainScenarioVariantPlan — dry-run inspection (Sprint 14, Slice B)", () => {
  it("explains a valid plan with matched counts, bounds, and a base digest — without running anything", () => {
    const base = priceBase();
    const baseDigest = digestContent(base);
    const ex = explainScenarioVariantPlan(base, PRICE_UP);

    expect(ex.schemaVersion).toBe(BACKTEST_VARIANT_PLAN_EXPLAIN_SCHEMA_VERSION);
    expect(ex.banner).toBe(BACKTEST_VARIANT_PLAN_EXPLAIN_BANNER);
    expect(ex.paperOnly).toBe(true);
    expect(ex.dryRun).toBe(true);
    expect(ex.planName).toBe("price-sensitivity");
    expect(ex.baseScenarioName).toBe("variants base — INJECTED FIXTURE");
    expect(ex.baseScenarioDigest).toBe(baseDigest); // matches a real run's scenarioDigest
    expect(ex.variantCount).toBe(2);
    expect(ex.totalPerturbationCount).toBe(2);
    // Two MINT_A price points per variant ⇒ 2 each ⇒ 4 total.
    expect(ex.totalMatchedValueCount).toBe(4);
    expect(ex.valid).toBe(true);

    const up = ex.variants[0];
    expect(up?.suffix).toBe("price-up-10pct");
    expect(up?.variantName).toBe("variants base — INJECTED FIXTURE [price-up-10pct]");
    expect(up?.valid).toBe(true);
    const p = up?.perturbations[0];
    expect(p?.target).toBe("price");
    expect(p?.targetKind).toBe("price");
    expect(p?.op).toBe("multiply");
    expect(p?.value).toBe(1.1);
    expect(p?.min).toBe(0);
    expect(p?.max).toBeNull();
    expect(p?.mint).toBeNull();
    expect(p?.matchedValueCount).toBe(2);
    expect(p?.matchesNothing).toBe(false);
  });

  it("explains a metric perturbation and reports its target accurately", () => {
    const ex = explainScenarioVariantPlan(metricBase(), {
      name: "metric-sweep",
      variants: [
        { suffix: "liq-up", perturbations: [{ target: "metric.liquidityUsd", op: "multiply", value: 2, max: 1_000_000 }] },
      ],
    });
    const p = ex.variants[0]?.perturbations[0];
    expect(p?.target).toBe("metric.liquidityUsd");
    expect(p?.targetKind).toBe("metric");
    expect(p?.min).toBeNull();
    expect(p?.max).toBe(1_000_000);
    expect(p?.matchedValueCount).toBe(1);
    expect(ex.valid).toBe(true);
  });

  it("reports a mint filter and an accurate restricted match count", () => {
    const ex = explainScenarioVariantPlan(multiMintBase(), {
      variants: [{ suffix: "a-only", perturbations: [{ target: "price", op: "multiply", value: 1.1, min: 0, mint: MINT_A }] }],
    });
    const p = ex.variants[0]?.perturbations[0];
    expect(p?.mint).toBe(MINT_A);
    // The mint-filtered count equals what generation actually changes for MINT_A.
    const generated = generateScenarioVariants(multiMintBase(), {
      variants: [{ suffix: "a-only", perturbations: [{ target: "price", op: "multiply", value: 1.1, min: 0, mint: MINT_A }] }],
    });
    expect(p?.matchedValueCount).toBe(generated.variants[0]?.changeCount);
    expect(p?.matchesNothing).toBe(false);
  });

  it("REPORTS (does not throw on) a perturbation that matches no values, marking it invalid", () => {
    const ex = explainScenarioVariantPlan(priceBase(), {
      variants: [{ suffix: "nomatch", perturbations: [{ target: "price", op: "multiply", value: 1.1, mint: "FakeZZZ9999999999999999999999999999999999999" }] }],
    });
    const p = ex.variants[0]?.perturbations[0];
    expect(p?.matchedValueCount).toBe(0);
    expect(p?.matchesNothing).toBe(true);
    expect(ex.variants[0]?.valid).toBe(false);
    expect(ex.valid).toBe(false);
    expect(ex.refusals.length).toBeGreaterThan(0);
    // Generation, by contrast, REFUSES the same plan by throwing.
    expect(() =>
      generateScenarioVariants(priceBase(), {
        variants: [{ suffix: "nomatch", perturbations: [{ target: "price", op: "multiply", value: 1.1, mint: "FakeZZZ9999999999999999999999999999999999999" }] }],
      }),
    ).toThrow(ScenarioVariantError);
  });

  it("is deterministic (byte-stable) and never mutates the base or plan", () => {
    const base = priceBase();
    const plan = JSON.parse(JSON.stringify(PRICE_UP));
    const baseBefore = JSON.stringify(base);
    const planBefore = JSON.stringify(plan);
    const a = explainScenarioVariantPlan(base, plan);
    const b = explainScenarioVariantPlan(priceBase(), PRICE_UP);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(base)).toBe(baseBefore);
    expect(JSON.stringify(plan)).toBe(planBefore);
  });

  it("refuses an invalid base scenario", () => {
    expect(() => explainScenarioVariantPlan({ name: "x", steps: [] }, PRICE_UP)).toThrow(ScenarioVariantError);
  });

  it("refuses an invalid plan (not an object / empty variants / bad perturbation)", () => {
    expect(() => explainScenarioVariantPlan(priceBase(), "nope")).toThrow(ScenarioVariantError);
    expect(() => explainScenarioVariantPlan(priceBase(), { variants: [] })).toThrow(ScenarioVariantError);
    expect(() =>
      explainScenarioVariantPlan(priceBase(), {
        variants: [{ suffix: "bad", perturbations: [{ target: "price", op: "divide", value: 2 }] }],
      }),
    ).toThrow(ScenarioVariantError);
    expect(() =>
      explainScenarioVariantPlan(priceBase(), {
        variants: [{ suffix: "../escape", perturbations: [{ target: "price", op: "multiply", value: 2 }] }],
      }),
    ).toThrow(ScenarioVariantError);
  });

  it("validates a produced explanation and rejects a malformed one", () => {
    const ex = explainScenarioVariantPlan(priceBase(), PRICE_UP);
    expect(validateScenarioVariantPlanExplanation(ex)).toBe(ex);

    const badSchema = { ...ex, schemaVersion: "backtest.variant-plan.explain.v999" };
    expect(() => validateScenarioVariantPlanExplanation(badSchema)).toThrow(ScenarioVariantError);

    const badFlag = { ...ex, dryRun: false };
    expect(() => validateScenarioVariantPlanExplanation(badFlag)).toThrow(ScenarioVariantError);

    const badPerturbation = JSON.parse(JSON.stringify(ex));
    badPerturbation.variants[0].perturbations[0] = { target: "price" }; // missing fields
    expect(() => validateScenarioVariantPlanExplanation(badPerturbation)).toThrow(ScenarioVariantError);

    expect(() => validateScenarioVariantPlanExplanation(7)).toThrow(ScenarioVariantError);
  });

  it("formats a human report with the PAPER-only / dry-run / not-advice labels", () => {
    const ex = explainScenarioVariantPlan(priceBase(), PRICE_UP);
    const text = formatScenarioVariantPlanExplanation(ex, { baseLabel: "base.json", planLabel: "plan.json" });
    expect(text).toContain(BACKTEST_VARIANT_PLAN_EXPLAIN_BANNER);
    expect(text).toContain("PAPER ONLY");
    expect(text).toContain("DRY RUN");
    expect(text.toLowerCase()).toContain("injected");
    expect(text.toLowerCase()).toContain("not a live result");
    expect(text.toLowerCase()).toContain("not financial advice");
    expect(text.toLowerCase()).toContain("not a profitability claim");
    expect(text).toContain("price-up-10pct");
    // Deterministic.
    expect(formatScenarioVariantPlanExplanation(ex)).toBe(formatScenarioVariantPlanExplanation(ex));
  });

  it("a refused explanation surfaces a Refusals section in the human report", () => {
    const ex = explainScenarioVariantPlan(priceBase(), {
      variants: [{ suffix: "nomatch", perturbations: [{ target: "price", op: "multiply", value: 1.1, mint: "FakeZZZ9999999999999999999999999999999999999" }] }],
    });
    const text = formatScenarioVariantPlanExplanation(ex);
    expect(text).toContain("Refusals:");
    expect(text).toContain("MATCHES NOTHING");
  });
});

describe("generateScenarioVariants — config perturbations (Sprint 14, Slice D)", () => {
  /** A base that carries the optional exit/cap fields so config targets have something to perturb. */
  function configBase(): BacktestScenario {
    const s = priceBase();
    s.caps.maxTradeSizeUsd = 1000;
    s.strategyConfig.takeProfitPct = 20;
    s.strategyConfig.stopLossPct = 10;
    s.defaultPaperSizeUsd = 100;
    return s;
  }

  it("applies an `add` op to an allowlisted caps field (one value changed)", () => {
    const result = generateScenarioVariants(configBase(), {
      variants: [{ suffix: "bigger-cap", perturbations: [{ target: "config.maxTradeSizeUsd", op: "add", value: 500 }] }],
    });
    expect(result.variants[0]?.changeCount).toBe(1);
    expect(result.variants[0]?.scenario.caps.maxTradeSizeUsd).toBe(1500);
    // The strategyConfig and steps are untouched.
    expect(result.variants[0]?.scenario.strategyConfig.takeProfitPct).toBe(20);
  });

  it("applies a `multiply` op to an allowlisted strategyConfig field", () => {
    const result = generateScenarioVariants(configBase(), {
      variants: [{ suffix: "tp-up", perturbations: [{ target: "config.takeProfitPct", op: "multiply", value: 1.5 }] }],
    });
    expect(result.variants[0]?.scenario.strategyConfig.takeProfitPct).toBe(30);
    expect(result.variants[0]?.changeCount).toBe(1);
  });

  it("perturbs the top-level defaultPaperSizeUsd", () => {
    const result = generateScenarioVariants(configBase(), {
      variants: [{ suffix: "size-up", perturbations: [{ target: "config.defaultPaperSizeUsd", op: "multiply", value: 2 }] }],
    });
    expect(result.variants[0]?.scenario.defaultPaperSizeUsd).toBe(200);
  });

  it("clamps a config perturbation to explicit [min, max] bounds", () => {
    const result = generateScenarioVariants(configBase(), {
      variants: [{ suffix: "capped", perturbations: [{ target: "config.maxTradeSizeUsd", op: "multiply", value: 10, max: 5000 }] }],
    });
    // 1000*10 = 10000 → clamped to 5000.
    expect(result.variants[0]?.scenario.caps.maxTradeSizeUsd).toBe(5000);
  });

  it("refuses an unknown config field", () => {
    expect(() =>
      generateScenarioVariants(configBase(), {
        variants: [{ suffix: "x", perturbations: [{ target: "config.totallyBogus", op: "add", value: 1 }] }],
      }),
    ).toThrow(/config field must be one of/);
  });

  it("refuses an arbitrary dotted path under config.*", () => {
    expect(() =>
      generateScenarioVariants(configBase(), {
        variants: [{ suffix: "x", perturbations: [{ target: "config.caps.maxTradeSizeUsd", op: "add", value: 1 }] }],
      }),
    ).toThrow(/config field must be one of/);
    expect(() =>
      generateScenarioVariants(configBase(), {
        variants: [{ suffix: "y", perturbations: [{ target: "config.any.deep.path", op: "add", value: 1 }] }],
      }),
    ).toThrow(/config field must be one of/);
  });

  it("refuses the ambiguous maxOpenPositions field (intentionally not allowlisted)", () => {
    expect(() =>
      generateScenarioVariants(configBase(), {
        variants: [{ suffix: "x", perturbations: [{ target: "config.maxOpenPositions", op: "add", value: 1 }] }],
      }),
    ).toThrow(/config field must be one of/);
  });

  it("refuses (matches nothing) when an allowlisted-but-ABSENT optional field is targeted", () => {
    const noTp = priceBase(); // has no takeProfitPct
    delete noTp.strategyConfig.takeProfitPct;
    expect(() =>
      generateScenarioVariants(noTp, {
        variants: [{ suffix: "x", perturbations: [{ target: "config.takeProfitPct", op: "multiply", value: 1.1 }] }],
      }),
    ).toThrow(/matched no values/);
  });

  it("refuses a mint filter on a config target", () => {
    expect(() =>
      generateScenarioVariants(configBase(), {
        variants: [{ suffix: "x", perturbations: [{ target: "config.maxTradeSizeUsd", op: "add", value: 1, mint: MINT_A }] }],
      }),
    ).toThrow(/mint is not allowed for a "config/);
  });

  it("refuses a config perturbation that produces an invalid scenario", () => {
    // A negative max trade size is structurally invalid → variant validation refuses.
    expect(() =>
      generateScenarioVariants(configBase(), {
        variants: [{ suffix: "x", perturbations: [{ target: "config.maxTradeSizeUsd", op: "multiply", value: -1 }] }],
      }),
    ).toThrow(ScenarioVariantError);
  });

  it("does not mutate the base scenario", () => {
    const base = configBase();
    const before = JSON.stringify(base);
    generateScenarioVariants(base, {
      variants: [{ suffix: "x", perturbations: [{ target: "config.maxTradeSizeUsd", op: "add", value: 500 }] }],
    });
    expect(JSON.stringify(base)).toBe(before);
  });

  it("produces a scenario that lints valid and runs", () => {
    const result = generateScenarioVariants(configBase(), {
      variants: [{ suffix: "tp-up", perturbations: [{ target: "config.takeProfitPct", op: "multiply", value: 1.25 }] }],
    });
    const variant = result.variants[0]!.scenario;
    expect(lintBacktestScenario(variant).valid).toBe(true);
    expect(() => runBacktest(variant)).not.toThrow();
  });

  it("explainScenarioVariantPlan reports a config target accurately (Slice B integration)", () => {
    const ex = explainScenarioVariantPlan(configBase(), {
      variants: [{ suffix: "cap", perturbations: [{ target: "config.maxTradeSizeUsd", op: "add", value: 500, max: 9000 }] }],
    });
    const p = ex.variants[0]?.perturbations[0];
    expect(p?.target).toBe("config.maxTradeSizeUsd");
    expect(p?.targetKind).toBe("config");
    expect(p?.max).toBe(9000);
    expect(p?.matchedValueCount).toBe(1);
    expect(ex.valid).toBe(true);
  });
});

describe("runScenarioVariantSensitivity — config variants (Sprint 14, Slice D)", () => {
  it("runs a sensitivity sweep over a config perturbation", () => {
    const base = priceBase();
    base.caps.maxTradeSizeUsd = 1000;
    base.strategyConfig.takeProfitPct = 20;
    const { report } = runScenarioVariantSensitivity({
      base,
      plan: {
        name: "config-sweep",
        variants: [
          { suffix: "tp-up", perturbations: [{ target: "config.takeProfitPct", op: "multiply", value: 1.5 }] },
          { suffix: "cap-down", perturbations: [{ target: "config.maxTradeSizeUsd", op: "multiply", value: 0.5 }] },
        ],
      },
    });
    expect(report.variantCount).toBe(2);
    expect(report.variants.map((v) => v.suffix)).toEqual(["tp-up", "cap-down"]);
    for (const v of report.variants) {
      expect(v.status).toBe("passed");
      expect(v.changeCount).toBe(1); // one config value changed per variant
    }
  });
});
