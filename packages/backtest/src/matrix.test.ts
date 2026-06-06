import { describe, it, expect } from "vitest";
import { expandScenarioMatrix, ScenarioMatrixError } from "./matrix.js";
import { buildExampleBacktestScenario } from "./templates.js";
import { runBacktest } from "./backtest.js";
import { lintBacktestScenario } from "./lint.js";

function base() {
  return buildExampleBacktestScenario("buy-hold", { name: "sweep base — INJECTED FIXTURE" });
}

const SIZING_MATRIX = {
  name: "sizing-sweep",
  variants: [
    { suffix: "size-25", patch: { defaultPaperSizeUsd: 25 } },
    { suffix: "size-50", patch: { defaultPaperSizeUsd: 50 } },
  ],
};

describe("expandScenarioMatrix — happy path", () => {
  it("expands deterministic, validating variants with derived names", () => {
    const result = expandScenarioMatrix(base(), SIZING_MATRIX);
    expect(result.name).toBe("sizing-sweep");
    expect(result.variants.map((v) => v.suffix)).toEqual(["size-25", "size-50"]);
    // Names keep the base name (+ INJECTED labelling) and append the suffix.
    expect(result.variants[0]?.scenario.name).toBe("sweep base — INJECTED FIXTURE [size-25]");
    // The patch applied.
    expect(result.variants[0]?.scenario.defaultPaperSizeUsd).toBe(25);
    expect(result.variants[1]?.scenario.defaultPaperSizeUsd).toBe(50);
    // Every variant lints valid and runs.
    for (const v of result.variants) {
      expect(lintBacktestScenario(v.scenario).valid).toBe(true);
      expect(() => runBacktest(v.scenario)).not.toThrow();
    }
  });

  it("is deterministic (byte-stable for the same inputs)", () => {
    const a = expandScenarioMatrix(base(), SIZING_MATRIX);
    const b = expandScenarioMatrix(base(), SIZING_MATRIX);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("merges strategyConfig and caps patches without dropping base keys", () => {
    const result = expandScenarioMatrix(base(), {
      variants: [{ suffix: "tight", patch: { strategyConfig: { maxRiskScore: 40 }, caps: { maxOpenPositions: 3 } } }],
    });
    const v = result.variants[0]!.scenario;
    expect(v.strategyConfig.maxRiskScore).toBe(40);
    expect(v.strategyConfig.minScoreForPaperBuy).toBe(50); // base key preserved
    expect(v.caps.maxOpenPositions).toBe(3);
    expect(v.caps.maxTradeSizeUsd).toBe(1000); // base key preserved
  });
});

describe("expandScenarioMatrix — safety + refusals", () => {
  it("refuses a patch that touches a protected key (steps/name/initialJournal)", () => {
    for (const key of ["steps", "name", "initialJournal"]) {
      expect(() =>
        expandScenarioMatrix(base(), { variants: [{ suffix: "x", patch: { [key]: 1 } }] }),
      ).toThrow(ScenarioMatrixError);
    }
  });

  it("refuses a non-scalar patch value (no nested/arbitrary structures)", () => {
    expect(() =>
      expandScenarioMatrix(base(), {
        variants: [{ suffix: "x", patch: { strategyConfig: { maxRiskScore: { nested: 1 } } } }],
      }),
    ).toThrow(/must be a finite number or boolean/);
  });

  it("refuses an empty or missing variants array", () => {
    expect(() => expandScenarioMatrix(base(), { variants: [] })).toThrow(/non-empty array/);
    expect(() => expandScenarioMatrix(base(), {})).toThrow(/non-empty array/);
  });

  it("refuses a duplicate suffix", () => {
    expect(() =>
      expandScenarioMatrix(base(), {
        variants: [
          { suffix: "dup", patch: { defaultPaperSizeUsd: 1 } },
          { suffix: "dup", patch: { defaultPaperSizeUsd: 2 } },
        ],
      }),
    ).toThrow(/duplicated/);
  });

  it("refuses an unsafe suffix (path separators / traversal / spaces)", () => {
    for (const suffix of ["a/b", "..", "a\\b", "has space"]) {
      expect(() =>
        expandScenarioMatrix(base(), { variants: [{ suffix, patch: { defaultPaperSizeUsd: 1 } }] }),
      ).toThrow(/path separators/);
    }
  });

  it("refuses a patch that produces an invalid scenario", () => {
    // maxOpenPositions must be a non-negative integer; -1 fails scenario validation.
    expect(() =>
      expandScenarioMatrix(base(), {
        variants: [{ suffix: "bad", patch: { caps: { maxOpenPositions: -1 } } }],
      }),
    ).toThrow(/produced an invalid scenario/);
  });

  it("refuses an invalid base scenario", () => {
    expect(() => expandScenarioMatrix({ not: "a scenario" }, SIZING_MATRIX)).toThrow(
      /base scenario is invalid/,
    );
  });

  it("does not mutate a deeply frozen base scenario", () => {
    const b = base();
    // Freeze base + nested config/caps so any mutation attempt would throw.
    Object.freeze(b);
    Object.freeze(b.strategyConfig);
    Object.freeze(b.caps);
    Object.freeze(b.steps);
    const snapshot = JSON.stringify(b);
    expect(() => expandScenarioMatrix(b, SIZING_MATRIX)).not.toThrow();
    expect(JSON.stringify(b)).toBe(snapshot);
  });
});
