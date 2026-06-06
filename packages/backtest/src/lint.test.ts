import { describe, it, expect } from "vitest";
import { lintBacktestScenario, collectScenarioIssues } from "./lint.js";
import { validateBacktestScenario, BacktestScenarioError } from "./backtest.js";

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

/** A structurally-valid scenario that triggers ZERO warnings. */
function cleanScenario(): Record<string, unknown> {
  return {
    name: "clean",
    strategyConfig: { ...STRATEGY_CONFIG },
    caps: { ...CAPS },
    defaultPaperSizeUsd: 100,
    steps: [
      { id: "step-1", at: T1, candidates: [{ mint: A, riskReport: passRisk(A) }], prices: [price(A, 2, T1)] },
    ],
  };
}

/** A seed journal holding 50 units of A @ 2 with no realized PnL. */
function seedJournalOpenOnly(): string {
  return (
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
    }) + "\n"
  );
}

describe("lintBacktestScenario — valid / invalid", () => {
  it("a clean scenario is valid with no warnings", () => {
    const result = lintBacktestScenario(cleanScenario());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.summary.name).toBe("clean");
    expect(result.summary.stepCount).toBe(1);
    expect(result.summary.candidateCount).toBe(1);
    expect(result.summary.priceCount).toBe(1);
    expect(result.summary.hasInitialJournal).toBe(false);
  });

  it("a valid-but-suspicious scenario is valid WITH warnings", () => {
    const s = cleanScenario();
    (s.caps as Record<string, unknown>).killSwitch = true;
    const result = lintBacktestScenario(s);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.summary.warningCount).toBe(result.warnings.length);
  });

  it("an invalid scenario is not valid and reports errors (no run possible)", () => {
    const result = lintBacktestScenario({ name: "x", strategyConfig: STRATEGY_CONFIG, caps: CAPS, steps: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.message).toMatch(/steps must not be empty/);
    // Warnings are not computed for an unrunnable scenario.
    expect(result.warnings).toEqual([]);
  });

  it("reports a structural error path for a bad candidate mint", () => {
    const result = lintBacktestScenario({
      name: "x",
      strategyConfig: STRATEGY_CONFIG,
      caps: CAPS,
      steps: [{ id: "s", at: T1, candidates: [{ symbol: "X" }], prices: [] }],
    });
    expect(result.valid).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("candidate-mint");
    expect(result.errors.find((e) => e.code === "candidate-mint")?.path).toBe("steps[0].candidates[0].mint");
  });
});

describe("lintBacktestScenario — warnings", () => {
  function warn(scenario: unknown): string[] {
    return lintBacktestScenario(scenario).warnings.map((w) => w.code);
  }

  it("flags duplicate step ids", () => {
    const s = cleanScenario();
    s.steps = [
      { id: "dup", at: T1, candidates: [{ mint: A, riskReport: passRisk(A) }], prices: [price(A, 2, T1)] },
      { id: "dup", at: T2, candidates: [{ mint: A, riskReport: passRisk(A) }], prices: [price(A, 3, T2)] },
    ];
    expect(warn(s)).toContain("duplicate-step-id");
  });

  it("flags non-monotonic step timestamps", () => {
    const s = cleanScenario();
    s.steps = [
      { id: "step-1", at: T2, candidates: [{ mint: A, riskReport: passRisk(A) }], prices: [price(A, 2, T2)] },
      { id: "step-2", at: T1, candidates: [{ mint: A, riskReport: passRisk(A) }], prices: [price(A, 3, T1)] },
    ];
    expect(warn(s)).toContain("non-monotonic-timestamp");
  });

  it("flags missing sizing (no default size and no proposed size)", () => {
    const s = cleanScenario();
    delete s.defaultPaperSizeUsd; // and the candidate carries no proposedSizeUsd
    expect(warn(s)).toContain("no-sizing");
  });

  it("flags a step whose candidates have no matching injected prices", () => {
    const s = cleanScenario();
    s.steps = [
      { id: "step-1", at: T1, candidates: [{ mint: A, riskReport: passRisk(A) }], prices: [price(B, 2, T1)] },
    ];
    expect(warn(s)).toContain("no-matching-prices");
  });

  it("flags the kill switch", () => {
    const s = cleanScenario();
    (s.caps as Record<string, unknown>).killSwitch = true;
    expect(warn(s)).toContain("kill-switch-on");
  });

  it("flags caps that guarantee no buys (zero caps)", () => {
    const s = cleanScenario();
    (s.caps as Record<string, unknown>).maxOpenPositions = 0;
    expect(warn(s)).toContain("zero-caps-no-buys");
  });

  it("flags allowCautionRiskReports", () => {
    const s = cleanScenario();
    (s.caps as Record<string, unknown>).allowCautionRiskReports = true;
    expect(warn(s)).toContain("allow-caution");
  });

  it("flags duplicate mints within a step", () => {
    const s = cleanScenario();
    s.steps = [
      {
        id: "step-1",
        at: T1,
        candidates: [{ mint: A, riskReport: passRisk(A) }, { mint: A, riskReport: passRisk(A) }],
        prices: [price(A, 2, T1)],
      },
    ];
    expect(warn(s)).toContain("duplicate-mint-in-step");
  });

  it("flags empty candidate / price arrays", () => {
    const s = cleanScenario();
    s.steps = [{ id: "step-1", at: T1, candidates: [], prices: [] }];
    const codes = warn(s);
    expect(codes).toContain("empty-candidates");
    expect(codes).toContain("empty-prices");
  });

  it("flags a default size larger than the max trade cap", () => {
    const s = cleanScenario();
    s.defaultPaperSizeUsd = 5000; // > maxTradeSizeUsd 1000
    expect(warn(s)).toContain("default-size-exceeds-max-trade");
  });

  it("flags extreme/disabled-by-value exit thresholds", () => {
    const s = cleanScenario();
    (s.steps as Record<string, unknown>[])[0]!.takeProfitPct = 0; // disabled-by-value
    (s.steps as Record<string, unknown>[])[0]!.stopLossPct = 250; // extreme
    const codes = warn(s);
    expect(codes).toContain("extreme-take-profit");
    expect(codes).toContain("extreme-stop-loss");
  });

  it("flags an initial journal that seeds open positions before step 1", () => {
    const s = cleanScenario();
    s.initialJournal = seedJournalOpenOnly();
    const result = lintBacktestScenario(s);
    expect(result.valid).toBe(true);
    expect(result.summary.hasInitialJournal).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("initial-journal-open-positions");
  });

  it("flags an initial journal that carries realized PnL before step 1", () => {
    const s = cleanScenario();
    // Buy then fully sell at a higher price → realized PnL, no open position.
    const buy = JSON.stringify({
      type: "PAPER_BUY_FILLED",
      at: T1,
      fill: { id: "f1", orderId: "o1", mint: A, side: "BUY", priceUsd: 2, quantity: 50, notionalUsd: 100, feeUsd: 0, filledAt: T1 },
    });
    const sell = JSON.stringify({
      type: "PAPER_SELL_FILLED",
      at: T1,
      realizedPnlUsd: 50,
      fill: { id: "f2", orderId: "o2", mint: A, side: "SELL", priceUsd: 3, quantity: 50, notionalUsd: 150, feeUsd: 0, filledAt: T1 },
    });
    s.initialJournal = `${buy}\n${sell}\n`;
    const codes = lintBacktestScenario(s).warnings.map((w) => w.code);
    expect(codes).toContain("initial-journal-realized-pnl");
    expect(codes).not.toContain("initial-journal-open-positions");
  });
});

describe("lintBacktestScenario — malformed journal is an error", () => {
  it("treats a malformed embedded journal as a blocking error", () => {
    const s = cleanScenario();
    s.initialJournal = ['{"type":"RUN_STARTED","at":"x","caps":{},"note":"n"}', "{not json"].join("\n");
    const result = lintBacktestScenario(s);
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("initial-journal-malformed");
  });
});

describe("lintBacktestScenario — determinism", () => {
  it("produces byte-stable JSON for repeated lints of the same scenario", () => {
    const a = JSON.stringify(lintBacktestScenario(cleanScenario()));
    const b = JSON.stringify(lintBacktestScenario(cleanScenario()));
    expect(a).toBe(b);
  });

  it("does not mutate the input scenario", () => {
    const s = cleanScenario();
    const before = JSON.stringify(s);
    lintBacktestScenario(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("collectScenarioIssues / validateBacktestScenario", () => {
  it("collectScenarioIssues narrows a good scenario and returns no errors", () => {
    const { errors, scenario } = collectScenarioIssues(cleanScenario());
    expect(errors).toEqual([]);
    expect(scenario?.name).toBe("clean");
  });

  it("validateBacktestScenario throws the first structural error", () => {
    expect(() => validateBacktestScenario(42)).toThrow(BacktestScenarioError);
    expect(() => validateBacktestScenario(42)).toThrow(/scenario must be a JSON object/);
  });
});
