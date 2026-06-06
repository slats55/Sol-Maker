import { describe, it, expect } from "vitest";
import { runBacktest } from "./backtest.js";
import { formatBacktestReport, BACKTEST_REPORT_SCHEMA_VERSION } from "./report.js";

const A = "So11111111111111111111111111111111111111112";
const B = "EsavkjFa5tD2gej6Pqg7d7ScjsZP3wMpD9rPYJ8mpump";
const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";

function passRisk(mint: string, score = 0) {
  return {
    mint,
    decision: "PASS_FOR_PAPER_EVALUATION",
    score,
    flags: [],
    summary: [],
    generatedAt: T1,
    disclaimer: "advisory only",
  };
}

function price(mint: string, priceUsd: number, observedAt: string) {
  return { mint, priceUsd, observedAt, source: "injected-fixture" };
}

const STRATEGY_CONFIG = { minScoreForPaperBuy: 50, minScoreForWatch: 30, maxRiskScore: 60 };
const CAPS = { maxTradeSizeUsd: 1000, maxDailyLossUsd: 1000, maxOpenPositions: 5, killSwitch: false };

/**
 * Two mints: A is fully exited in step 2 (closed, realized +50); B is held
 * (open, unrealized +25). This exercises the "closed-position realized PnL" path
 * — A's per-position realized is gone from the final state, so the per-mint
 * aggregate must recompute it from A's own fills.
 */
function multiMintScenario(): unknown {
  return {
    name: "multi-mint",
    strategyConfig: { ...STRATEGY_CONFIG },
    caps: { ...CAPS },
    steps: [
      {
        id: "step-1",
        at: T1,
        candidates: [
          { mint: A, riskReport: passRisk(A), proposedSizeUsd: 100 },
          { mint: B, riskReport: passRisk(B), proposedSizeUsd: 100 },
        ],
        prices: [price(A, 2, T1), price(B, 4, T1)],
      },
      {
        id: "step-2",
        at: T2,
        candidates: [],
        prices: [price(A, 3, T2), price(B, 5, T2)],
        takeProfitPct: 50, // A: +50% → full exit; B: +25% → hold
      },
    ],
  };
}

describe("backtest report — schema + stability", () => {
  it("carries the stable schema version", () => {
    const report = runBacktest(multiMintScenario());
    expect(report.schemaVersion).toBe(BACKTEST_REPORT_SCHEMA_VERSION);
    expect(report.schemaVersion).toBe("backtest.report.v1");
  });

  it("includes a deterministic 16-hex scenario digest, stable across runs", () => {
    const a = runBacktest(multiMintScenario());
    const b = runBacktest(multiMintScenario());
    expect(a.scenarioDigest).toMatch(/^[0-9a-f]{16}$/);
    expect(a.scenarioDigest).toBe(b.scenarioDigest);
  });

  it("produces byte-stable JSON for repeated runs of the same scenario", () => {
    expect(JSON.stringify(runBacktest(multiMintScenario()))).toBe(
      JSON.stringify(runBacktest(multiMintScenario())),
    );
  });

  it("still includes every required disclaimer label", () => {
    const report = runBacktest(multiMintScenario());
    const human = formatBacktestReport(report);
    for (const label of [
      "SIMULATED PAPER-ONLY REPORT",
      "Uses injected historical data only",
      "Not a live result",
      "Not financial advice",
      "Not a profitability claim",
    ]) {
      expect(human).toContain(label);
      expect(JSON.stringify(report)).toContain(label);
    }
  });
});

describe("backtest report — equity curve", () => {
  it("has exactly one entry per step, in order", () => {
    const report = runBacktest(multiMintScenario());
    expect(report.equityCurve).toHaveLength(report.stepCount);
    expect(report.equityCurve.map((e) => e.stepId)).toEqual(["step-1", "step-2"]);
  });

  it("reports deterministic cumulative values that match the final PnL", () => {
    const report = runBacktest(multiMintScenario());
    const first = report.equityCurve[0]!;
    const last = report.equityCurve[report.equityCurve.length - 1]!;
    // After step 1: both freshly bought at the marked price → zero PnL.
    expect(first.realizedPnlUsd).toBe(0);
    expect(first.totalPnlUsd).toBe(0);
    expect(first.openPositionCount).toBe(2);
    // After step 2: A realized +50, B unrealized +25 → total 75; A closed.
    expect(last.realizedPnlUsd).toBe(50);
    expect(last.unrealizedPnlUsd).toBe(25);
    expect(last.totalPnlUsd).toBe(75);
    expect(last.openPositionCount).toBe(1);
    expect(last.closedTradeCount).toBe(1);
    expect(last.totalPnlUsd).toBe(report.pnl.totalUsd);
  });
});

describe("backtest report — per-mint aggregates", () => {
  it("entries are sorted by mint", () => {
    const report = runBacktest(multiMintScenario());
    const mints = report.perMint.map((m) => m.mint);
    expect(mints).toEqual([...mints].sort());
  });

  it("computes EXACT realized PnL for a closed mint (not invented, not dropped)", () => {
    const report = runBacktest(multiMintScenario());
    const a = report.perMint.find((m) => m.mint === A)!;
    const b = report.perMint.find((m) => m.mint === B)!;
    // A was fully exited: realized +50, no open quantity, no unrealized.
    expect(a.buyFillCount).toBe(1);
    expect(a.sellFillCount).toBe(1);
    expect(a.openQuantity).toBe(0);
    expect(a.realizedPnlUsd).toBe(50);
    expect(a.unrealizedPnlUsd).toBe(0);
    expect(a.totalPnlUsd).toBe(50);
    expect(a.simulatedNotionalUsd).toBe(250); // buy 100 + sell 150
    // B is held: no realized, unrealized +25.
    expect(b.openQuantity).toBe(25);
    expect(b.realizedPnlUsd).toBe(0);
    expect(b.unrealizedPnlUsd).toBe(25);
    expect(b.simulatedNotionalUsd).toBe(100);
  });

  it("per-mint realized and total PnL sum to the report totals (exactness)", () => {
    const report = runBacktest(multiMintScenario());
    const realized = report.perMint.reduce((s, m) => s + m.realizedPnlUsd, 0);
    const total = report.perMint.reduce((s, m) => s + m.totalPnlUsd, 0);
    expect(realized).toBe(report.pnl.realizedUsd);
    expect(total).toBe(report.pnl.totalUsd);
  });
});

describe("backtest report — warnings surfaced", () => {
  it("includes scenario linter warnings in the report and the human output", () => {
    // killSwitch on → at least one warning; step-2 also has empty candidates.
    const report = runBacktest({
      name: "warned",
      strategyConfig: { ...STRATEGY_CONFIG },
      caps: { ...CAPS, killSwitch: true },
      defaultPaperSizeUsd: 100,
      steps: [
        { id: "step-1", at: T1, candidates: [{ mint: A, riskReport: passRisk(A) }], prices: [price(A, 2, T1)] },
      ],
    });
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.warnings.map((w) => w.code)).toContain("kill-switch-on");
    const human = formatBacktestReport(report);
    expect(human).toContain("Warnings (");
    expect(human).toContain("kill-switch-on");
  });

  it("surfaces exactly the expected warnings (no spurious ones)", () => {
    const report = runBacktest(multiMintScenario());
    // step-2 has empty candidates by design (TP sweep only) → exactly that warning.
    expect(report.warnings.map((w) => w.code)).toEqual(["empty-candidates"]);
  });
});
