import { describe, it, expect } from "vitest";
import { generateScenarioVariants, ScenarioVariantError } from "./scenario-variants.js";
import { buildExampleBacktestScenario } from "./templates.js";
import { runBacktest } from "./backtest.js";
import { lintBacktestScenario } from "./lint.js";
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

  it("refuses an unknown target", () => {
    expect(() =>
      generateScenarioVariants(priceBase(), {
        variants: [{ suffix: "x", perturbations: [{ target: "caps.maxTradeSizeUsd", op: "add", value: 1 }] }],
      }),
    ).toThrow(/is not allowed — use "price" or "metric/);
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
