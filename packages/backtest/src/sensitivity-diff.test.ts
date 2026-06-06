/**
 * Tests for the Sprint 14 (Slice C) SENSITIVITY-report diff. Everything here is
 * INJECTED test data — fake mints and made-up prices — exercised purely offline.
 * Nothing is real market data, a live result, or a profitability claim.
 *
 * The diff is asserted to: pair variants by suffix; detect added / removed / changed
 * variants; flag conservative bookkeeping regressions (same-digest drift, new failure,
 * lost coverage, reject/warning increase, schema mismatch) while treating a different
 * scenario as "changed" not a regression; stay byte-stable; and refuse a non-report.
 */

import { describe, it, expect } from "vitest";
import { runScenarioVariantSensitivity } from "./sensitivity.js";
import {
  diffScenarioVariantSensitivityReports,
  validateScenarioVariantSensitivityDiff,
  formatScenarioVariantSensitivityDiff,
  ScenarioVariantSensitivityDiffError,
  BACKTEST_SENSITIVITY_DIFF_SCHEMA_VERSION,
} from "./sensitivity-diff.js";
import type { ScenarioVariantSensitivityReport } from "./sensitivity.js";

const MINT = "FakeAAA1111111111111111111111111111111111111";

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

function plan(): Record<string, unknown> {
  return {
    name: "sens-sweep — INJECTED (not live, not advice)",
    variants: [
      { suffix: "up10", perturbations: [{ target: "price", op: "multiply", value: 1.1, min: 0 }] },
      { suffix: "plus1", perturbations: [{ target: "price", op: "add", value: 1, min: 0, max: 1000000 }] },
    ],
  };
}

function makeReport(): ScenarioVariantSensitivityReport {
  return runScenarioVariantSensitivity({ base: buyHoldScenario(), plan: plan() }).report;
}

function clone(r: ScenarioVariantSensitivityReport): ScenarioVariantSensitivityReport {
  return JSON.parse(JSON.stringify(r));
}

describe("diffScenarioVariantSensitivityReports — identical reports", () => {
  it("reports no added/removed/changed variants and no regression", () => {
    const r = makeReport();
    const diff = diffScenarioVariantSensitivityReports(r, clone(r));
    expect(diff.schemaVersion).toBe(BACKTEST_SENSITIVITY_DIFF_SCHEMA_VERSION);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
    expect(diff.hasRegression).toBe(false);
    expect(diff.variantCount.delta).toBe(0);
    expect(diff.compatibility.status).toBe("same-schema");
    expect(diff.compatibility.baseScenarioDigest.match).toBe(true);
  });

  it("is byte-stable across two diffs of the same pair", () => {
    const r = makeReport();
    const a = diffScenarioVariantSensitivityReports(r, clone(r));
    const b = diffScenarioVariantSensitivityReports(r, clone(r));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("never mutates its inputs", () => {
    const base = makeReport();
    const next = makeReport();
    const baseBefore = JSON.stringify(base);
    const nextBefore = JSON.stringify(next);
    diffScenarioVariantSensitivityReports(base, next);
    expect(JSON.stringify(base)).toBe(baseBefore);
    expect(JSON.stringify(next)).toBe(nextBefore);
  });
});

describe("diffScenarioVariantSensitivityReports — variant set changes", () => {
  it("detects an added variant", () => {
    const base = makeReport();
    const next = clone(base);
    const extra = clone(base).variants[0]!;
    extra.suffix = "brand-new";
    next.variants.push(extra);
    next.variantCount += 1;
    const diff = diffScenarioVariantSensitivityReports(base, next);
    expect(diff.added.map((r) => r.suffix)).toEqual(["brand-new"]);
    expect(diff.removed).toHaveLength(0);
    expect(diff.variantCount.delta).toBe(1);
  });

  it("detects a removed (passed) variant as lost coverage → regression", () => {
    const base = makeReport();
    const next = clone(base);
    next.variants = next.variants.filter((v) => v.suffix !== "plus1");
    next.variantCount -= 1;
    const diff = diffScenarioVariantSensitivityReports(base, next);
    expect(diff.removed.map((r) => r.suffix)).toEqual(["plus1"]);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.some((r) => r.includes("plus1") && r.includes("missing"))).toBe(true);
  });
});

describe("diffScenarioVariantSensitivityReports — conservative regressions", () => {
  it("flags same-digest simulated drift (total PnL decreased) as a regression", () => {
    const base = makeReport();
    const next = clone(base);
    const v = next.variants.find((x) => x.suffix === "up10")!;
    v.summary!.totalPnlUsd -= 10; // same digest, drifted bookkeeping
    v.summary!.unrealizedPnlUsd -= 10;
    const diff = diffScenarioVariantSensitivityReports(base, next);
    const change = diff.changed.find((c) => c.suffix === "up10")!;
    expect(change.digestMatch).toBe(true);
    expect(change.isRegression).toBe(true);
    expect(change.regressionReasons.some((r) => r.includes("total simulated PnL decreased"))).toBe(true);
    expect(diff.hasRegression).toBe(true);
  });

  it("treats a CHANGED-digest variant (different content) as changed, NOT a regression", () => {
    const base = makeReport();
    const next = clone(base);
    const v = next.variants.find((x) => x.suffix === "up10")!;
    v.scenarioDigest = "0000different0000"; // different scenario content
    v.summary!.totalPnlUsd -= 10;
    const diff = diffScenarioVariantSensitivityReports(base, next);
    const change = diff.changed.find((c) => c.suffix === "up10")!;
    expect(change.digestMatch).toBe(false);
    expect(change.isRegression).toBe(false);
  });

  it("flags a newly-failed variant as a regression", () => {
    const base = makeReport();
    const next = clone(base);
    const v = next.variants.find((x) => x.suffix === "plus1")!;
    v.status = "failed";
    v.summary = null;
    v.deltas = null;
    next.failedVariantCount += 1;
    next.passedVariantCount -= 1;
    const diff = diffScenarioVariantSensitivityReports(base, next);
    const change = diff.changed.find((c) => c.suffix === "plus1")!;
    expect(change.nextStatus).toBe("failed");
    expect(change.isRegression).toBe(true);
    expect(diff.failedChanged.map((c) => c.suffix)).toContain("plus1");
    expect(diff.failedVariantCount.delta).toBe(1);
    expect(diff.hasRegression).toBe(true);
  });

  it("flags a same-digest reject increase as a regression", () => {
    const base = makeReport();
    const next = clone(base);
    const v = next.variants.find((x) => x.suffix === "up10")!;
    v.summary!.rejects += 1;
    const diff = diffScenarioVariantSensitivityReports(base, next);
    const change = diff.changed.find((c) => c.suffix === "up10")!;
    expect(change.regressionReasons.some((r) => r.includes("rejects increased"))).toBe(true);
    expect(diff.hasRegression).toBe(true);
  });

  it("flags a same-digest warning increase as a regression", () => {
    const base = makeReport();
    const next = clone(base);
    const v = next.variants.find((x) => x.suffix === "up10")!;
    v.warningCount += 1;
    v.warningCodes = [...v.warningCodes, "synthetic-warning"];
    next.warningCount += 1;
    const diff = diffScenarioVariantSensitivityReports(base, next);
    const change = diff.changed.find((c) => c.suffix === "up10")!;
    expect(change.warningCount.delta).toBe(1);
    expect(change.regressionReasons.some((r) => r.includes("warning"))).toBe(true);
    expect(diff.hasRegression).toBe(true);
  });

  it("detects a schema mismatch and flags it as a regression", () => {
    const base = makeReport();
    const next = clone(base);
    next.schemaVersion = "backtest.sensitivity.v2"; // lenient validation surfaces this
    const diff = diffScenarioVariantSensitivityReports(base, next);
    expect(diff.compatibility.status).toBe("schema-mismatch");
    expect(diff.compatibility.compatible).toBe(false);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.some((r) => r.includes("schemaVersion differs"))).toBe(true);
  });

  it("flags baseline drift for an identical base scenario", () => {
    const base = makeReport();
    const next = clone(base);
    next.baseline.summary!.totalPnlUsd -= 5; // same base digest, drifted baseline
    const diff = diffScenarioVariantSensitivityReports(base, next);
    expect(diff.baseline.summary).not.toBeNull();
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.some((r) => r.includes("baseline simulated results drifted"))).toBe(true);
  });
});

describe("diffScenarioVariantSensitivityReports — ranking movement", () => {
  it("reports the top-of-ranking movement per dimension", () => {
    const base = makeReport();
    const next = clone(base);
    const diff = diffScenarioVariantSensitivityReports(base, next);
    expect(diff.rankingMovement).toHaveLength(7);
    for (const m of diff.rankingMovement) {
      expect(m.changed).toBe(false); // identical reports ⇒ no movement
    }
  });
});

describe("diffScenarioVariantSensitivityReports — validation & formatting", () => {
  it("refuses a non-report input on either side", () => {
    const r = makeReport();
    expect(() => diffScenarioVariantSensitivityReports(7, r)).toThrow(ScenarioVariantSensitivityDiffError);
    expect(() => diffScenarioVariantSensitivityReports(r, { schemaVersion: "x" })).toThrow(
      ScenarioVariantSensitivityDiffError,
    );
  });

  it("validates a produced diff and rejects a malformed one", () => {
    const diff = diffScenarioVariantSensitivityReports(makeReport(), makeReport());
    expect(validateScenarioVariantSensitivityDiff(diff)).toBe(diff);
    expect(() => validateScenarioVariantSensitivityDiff({ ...diff, schemaVersion: "nope" })).toThrow(
      ScenarioVariantSensitivityDiffError,
    );
    expect(() => validateScenarioVariantSensitivityDiff({ ...diff, added: "x" })).toThrow(
      ScenarioVariantSensitivityDiffError,
    );
    expect(() => validateScenarioVariantSensitivityDiff(7)).toThrow(ScenarioVariantSensitivityDiffError);
  });

  it("formats a human diff with the PAPER-only / not-live / not-advice labels", () => {
    const diff = diffScenarioVariantSensitivityReports(makeReport(), makeReport());
    const text = formatScenarioVariantSensitivityDiff(diff, { baseLabel: "a.json", nextLabel: "b.json" });
    expect(text).toContain("Sensitivity report diff (SIMULATED PAPER-ONLY)");
    expect(text.toLowerCase()).toContain("not a live result");
    expect(text.toLowerCase()).toContain("not financial advice");
    expect(text.toLowerCase()).toContain("not a profitability claim");
    expect(text).toContain("Regression: no");
    // Deterministic.
    expect(formatScenarioVariantSensitivityDiff(diff)).toBe(formatScenarioVariantSensitivityDiff(diff));
  });

  it("uses neutral wording (no profit/advice framing)", () => {
    const diff = diffScenarioVariantSensitivityReports(makeReport(), makeReport());
    const lower = formatScenarioVariantSensitivityDiff(diff).toLowerCase();
    expect(lower).not.toContain("most profitable");
    expect(lower).not.toContain("buy this");
    expect(lower).not.toContain("trading edge");
  });
});
