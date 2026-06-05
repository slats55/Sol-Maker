import { describe, it, expect } from "vitest";
import { runBacktest, validateScenario, BacktestScenarioError } from "./backtest.js";
import { formatBacktestReport, BACKTEST_BANNER } from "./report.js";

const A = "So11111111111111111111111111111111111111112";
const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";

/** A minimal advisory PASS risk report (the strategy reads decision + score). */
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

function rejectRisk(mint: string) {
  return {
    mint,
    decision: "REJECT",
    score: 95,
    flags: [],
    summary: [],
    generatedAt: T1,
    disclaimer: "advisory only",
  };
}

function price(mint: string, priceUsd: number, observedAt: string) {
  return { mint, priceUsd, observedAt, source: "injected-fixture" };
}

const STRATEGY_CONFIG = {
  minScoreForPaperBuy: 50,
  minScoreForWatch: 30,
  maxRiskScore: 60,
};

const CAPS = {
  maxTradeSizeUsd: 1000,
  maxDailyLossUsd: 1000,
  maxOpenPositions: 5,
  killSwitch: false,
};

/** A one-step buy scenario for MINT_A (opens a simulated position). */
function buyOnlyScenario(): unknown {
  return {
    name: "buy-only",
    strategyConfig: STRATEGY_CONFIG,
    caps: CAPS,
    defaultPaperSizeUsd: 100,
    steps: [
      {
        id: "step-1",
        at: T1,
        candidates: [{ mint: A, riskReport: passRisk(A), source: "snipe-list" }],
        prices: [price(A, 2, T1)],
      },
    ],
  };
}

/**
 * Buy A in step 1, then take-profit full-exit A in step 2 (cross-step continuity).
 * The buy carries its OWN `proposedSizeUsd` so a full-exit sell can keep the size-0
 * "exit the whole position" default (a scenario-wide `defaultPaperSizeUsd` would
 * also size the sell, turning a full exit into a partial — see DEFAULT_PAPER_SIZE_USD).
 */
function buyThenSellScenario(): unknown {
  return {
    name: "buy-then-sell",
    strategyConfig: { ...STRATEGY_CONFIG, takeProfitPct: 50 },
    caps: CAPS,
    steps: [
      {
        id: "step-1",
        at: T1,
        candidates: [{ mint: A, riskReport: passRisk(A), proposedSizeUsd: 100, source: "snipe-list" }],
        prices: [price(A, 2, T1)],
      },
      {
        id: "step-2",
        at: T2,
        // A is held now; priceChangePct 60 ≥ takeProfitPct 50 ⇒ FULL exit candidate.
        candidates: [
          { mint: A, riskReport: passRisk(A), metrics: { priceChangePct: 60 } },
        ],
        prices: [price(A, 3, T2)],
      },
    ],
  };
}

describe("validateScenario / runBacktest — refusals", () => {
  it("refuses a non-object scenario", () => {
    expect(() => runBacktest(42)).toThrow(BacktestScenarioError);
    expect(() => runBacktest(42)).toThrow(/scenario must be a JSON object/);
  });

  it("refuses a scenario with no name", () => {
    expect(() => runBacktest({ strategyConfig: STRATEGY_CONFIG, caps: CAPS, steps: [] })).toThrow(
      /scenario\.name/,
    );
  });

  it("refuses an empty steps array deliberately (documented behavior)", () => {
    expect(() =>
      runBacktest({ name: "x", strategyConfig: STRATEGY_CONFIG, caps: CAPS, steps: [] }),
    ).toThrow(/steps must not be empty/);
  });

  it("refuses a malformed strategy config", () => {
    expect(() =>
      runBacktest({
        name: "x",
        strategyConfig: { minScoreForWatch: 30 },
        caps: CAPS,
        steps: [{ id: "s", at: T1, candidates: [], prices: [] }],
      }),
    ).toThrow(/strategyConfig\.minScoreForPaperBuy/);
  });

  it("refuses malformed caps", () => {
    expect(() =>
      runBacktest({
        name: "x",
        strategyConfig: STRATEGY_CONFIG,
        caps: { maxTradeSizeUsd: 100, maxDailyLossUsd: 100 }, // missing maxOpenPositions
        steps: [{ id: "s", at: T1, candidates: [], prices: [] }],
      }),
    ).toThrow(/caps\.maxOpenPositions/);
  });

  it("refuses a step missing its id / at", () => {
    expect(() =>
      runBacktest({
        name: "x",
        strategyConfig: STRATEGY_CONFIG,
        caps: CAPS,
        steps: [{ at: T1, candidates: [], prices: [] }],
      }),
    ).toThrow(/steps\[0\]\.id/);
  });

  it("refuses a candidate with no mint, naming the path", () => {
    expect(() =>
      runBacktest({
        name: "x",
        strategyConfig: STRATEGY_CONFIG,
        caps: CAPS,
        steps: [{ id: "s", at: T1, candidates: [{ symbol: "X" }], prices: [] }],
      }),
    ).toThrow(/steps\[0\]\.candidates\[0\]\.mint/);
  });

  it("refuses a malformed initial journal (does not silently drop events)", () => {
    expect(() =>
      runBacktest({
        ...(buyOnlyScenario() as object),
        initialJournal: ['{"type":"RUN_STARTED","at":"x","caps":{},"note":"n"}', "{not json"].join(
          "\n",
        ),
      }),
    ).toThrow(/initialJournal is malformed/);
  });

  it("validateScenario narrows a good scenario without throwing", () => {
    const s = validateScenario(buyOnlyScenario());
    expect(s.name).toBe("buy-only");
    expect(s.steps).toHaveLength(1);
  });
});

describe("runBacktest — deterministic replay", () => {
  it("produces a byte-stable JSON report for repeated runs of the same scenario", () => {
    const a = runBacktest(buyThenSellScenario());
    const b = runBacktest(buyThenSellScenario());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("carries the required PAPER-ONLY / not-live / not-advice / not-profit labels", () => {
    const report = runBacktest(buyOnlyScenario());
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
    expect(report.banner).toBe(BACKTEST_BANNER);
  });

  it("reports a single simulated buy for a one-step buy scenario", () => {
    const report = runBacktest(buyOnlyScenario());
    expect(report.stepCount).toBe(1);
    expect(report.totalCandidateCount).toBe(1);
    expect(report.fillCounts).toEqual({ buyCount: 1, sellCount: 0 });
    expect(report.positionCounts.open).toBe(1);
    expect(report.openPositions[0]?.mint).toBe(A);
    expect(report.openPositions[0]?.quantity).toBe(50); // 100 / 2
  });

  it("missing prices reject the affected paper trade safely (no throw)", () => {
    const scenario = buyOnlyScenario() as { steps: { prices: unknown[] }[] };
    scenario.steps[0]!.prices = []; // candidate present, but no injected price
    const report = runBacktest(scenario);
    expect(report.fillCounts.buyCount).toBe(0);
    expect(report.rejectedCounts.byPrice).toBe(1);
    expect(report.positionCounts.open).toBe(0);
  });

  it("a REJECT risk report still blocks the simulated buy", () => {
    const report = runBacktest({
      name: "risk-reject",
      strategyConfig: STRATEGY_CONFIG,
      caps: CAPS,
      defaultPaperSizeUsd: 100,
      steps: [
        {
          id: "step-1",
          at: T1,
          candidates: [{ mint: A, riskReport: rejectRisk(A) }],
          prices: [price(A, 2, T1)],
        },
      ],
    });
    expect(report.fillCounts.buyCount).toBe(0);
    expect(report.planCounts.paperBuyCandidateCount).toBe(0);
    expect(report.planCounts.rejectedCount).toBe(1); // disqualified by the risk gate
  });
});

describe("runBacktest — journal/state continuity", () => {
  it("sells in a later step a position opened in an earlier step (full exit closes it)", () => {
    const report = runBacktest(buyThenSellScenario());
    expect(report.fillCounts).toEqual({ buyCount: 1, sellCount: 1 });
    expect(report.planCounts.paperSellCandidateCount).toBe(1);
    expect(report.positionCounts.open).toBe(0);
    expect(report.positionCounts.closed).toBe(1);
    expect(report.pnl.realizedUsd).toBe(50); // (3 - 2) * 50
    // Per-step continuity is visible in the breakdown.
    expect(report.steps[0]?.openPositionCount).toBe(1);
    expect(report.steps[1]?.openPositionCount).toBe(0);
  });

  it("a partial exit across steps REDUCES the position rather than closing it", () => {
    const report = runBacktest({
      name: "partial",
      // partial take-profit at 30% of a sized position, scale out half; no full TP.
      strategyConfig: { ...STRATEGY_CONFIG, takeProfitPartialPct: 30, partialExitFraction: 0.5 },
      caps: CAPS,
      defaultPaperSizeUsd: 100,
      steps: [
        {
          id: "step-1",
          at: T1,
          candidates: [{ mint: A, riskReport: passRisk(A) }],
          prices: [price(A, 2, T1)], // buy 50 @ 2 (cost basis 100)
        },
        {
          id: "step-2",
          at: T2,
          candidates: [{ mint: A, riskReport: passRisk(A), metrics: { priceChangePct: 40 } }],
          prices: [price(A, 3, T2)], // partial sells 50 USD / 3 ≈ 16.67 units
        },
      ],
    });
    expect(report.fillCounts.sellCount).toBe(1);
    expect(report.positionCounts.open).toBe(1); // still holding the remainder
    expect(report.positionCounts.closed).toBe(0);
    const remaining = report.openPositions[0]?.quantity ?? 0;
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThan(50);
  });

  it("seeds the starting state from an initial journal and sells the seeded position", () => {
    // A scenario whose initial journal already holds 50 units of A @ 2.
    const seedScenario = runBacktest(buyOnlyScenario());
    expect(seedScenario.openPositions[0]?.quantity).toBe(50);
    const initialJournal =
      JSON.stringify({
        type: "PAPER_BUY_FILLED",
        at: T1,
        fill: {
          id: "fill-seed",
          orderId: "order-seed",
          mint: A,
          side: "BUY",
          priceUsd: 2,
          quantity: 50,
          notionalUsd: 100,
          feeUsd: 0,
          filledAt: T1,
        },
      }) + "\n";
    const report = runBacktest({
      name: "seeded",
      strategyConfig: { ...STRATEGY_CONFIG, takeProfitPct: 50 },
      caps: CAPS,
      initialJournal,
      steps: [
        {
          id: "step-1",
          at: T2,
          candidates: [{ mint: A, riskReport: passRisk(A), metrics: { priceChangePct: 60 } }],
          prices: [price(A, 3, T2)],
        },
      ],
    });
    // The seeded position was sold in the first step.
    expect(report.fillCounts.sellCount).toBe(1);
    expect(report.positionCounts.open).toBe(0);
    expect(report.pnl.realizedUsd).toBe(50);
  });
});

describe("runBacktest — safety & purity", () => {
  it("does not mutate the input scenario", () => {
    const scenario = buyThenSellScenario();
    const before = JSON.stringify(scenario);
    runBacktest(scenario);
    expect(JSON.stringify(scenario)).toBe(before);
  });

  it("the kill switch blocks all simulated trading in the replay", () => {
    const scenario = buyOnlyScenario() as { caps: { killSwitch: boolean } };
    scenario.caps = { ...CAPS, killSwitch: true };
    const report = runBacktest(scenario);
    expect(report.fillCounts.buyCount).toBe(0);
    expect(report.positionCounts.open).toBe(0);
  });

  it("does not leak a secret-looking injected value into the human report", () => {
    const leaky = "https://rpc.example.com/?api-key=SUPERSECRET";
    const report = runBacktest({
      name: "redact",
      strategyConfig: STRATEGY_CONFIG,
      caps: CAPS,
      defaultPaperSizeUsd: 100,
      steps: [
        {
          id: "step-1",
          at: T1,
          candidates: [{ mint: A, riskReport: passRisk(A), source: leaky }],
          prices: [price(A, 2, T1)],
        },
      ],
    });
    expect(formatBacktestReport(report)).not.toContain("SUPERSECRET");
  });
});
