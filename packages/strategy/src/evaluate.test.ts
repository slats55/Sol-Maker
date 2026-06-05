import { describe, it, expect } from "vitest";
import { evaluateStrategy } from "./evaluate.js";
import { REASON_IDS } from "./reasons.js";
import { buildTokenRiskReport } from "@soulmaker/risk";
import type { RiskDecision, TokenRiskReport } from "@soulmaker/risk";
import type { StrategyCandidate, StrategyConfig } from "./types.js";

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NOW = "2026-06-05T12:00:00.000Z";
const at = () => NOW;

/** A controllable advisory risk report literal (decision + score independent). */
function risk(decision: RiskDecision, score: number): TokenRiskReport {
  return {
    mint: MINT,
    score,
    decision,
    flags: [],
    summary: ["advisory only"],
    generatedAt: NOW,
    disclaimer: "advisory only",
  };
}

const PASS = risk("PASS_FOR_PAPER_EVALUATION", 0);

/** Base config: a clean PASS with no metrics scores 60 ⇒ a paper buy. */
const baseConfig: StrategyConfig = {
  minScoreForPaperBuy: 55,
  minScoreForWatch: 30,
  maxRiskScore: 60,
};

function ids(reasons: { id: string }[]): string[] {
  return reasons.map((r) => r.id);
}

describe("evaluateStrategy — risk gate", () => {
  it("REJECT risk report ⇒ SKIP", () => {
    const candidate: StrategyCandidate = { mint: MINT, riskReport: risk("REJECT", 90) };
    const report = evaluateStrategy({ candidate, config: baseConfig, now: at });
    expect(report.decision).toBe("SKIP");
    expect(ids(report.disqualifiers)).toContain(REASON_IDS.RISK_DECISION_REJECT);
    expect(report.riskDecision).toBe("REJECT");
  });

  it("missing risk report ⇒ SKIP (fail-safe), riskDecision MISSING, riskScore null", () => {
    const candidate: StrategyCandidate = { mint: MINT };
    const report = evaluateStrategy({ candidate, config: baseConfig, now: at });
    expect(report.decision).toBe("SKIP");
    expect(ids(report.disqualifiers)).toContain(REASON_IDS.RISK_REPORT_MISSING);
    expect(report.riskDecision).toBe("MISSING");
    expect(report.riskScore).toBeNull();
  });

  it("CAUTION risk report ⇒ SKIP by default", () => {
    const candidate: StrategyCandidate = { mint: MINT, riskReport: risk("CAUTION", 35) };
    const report = evaluateStrategy({ candidate, config: baseConfig, now: at });
    expect(report.decision).toBe("SKIP");
    expect(ids(report.disqualifiers)).toContain(REASON_IDS.RISK_DECISION_CAUTION);
  });

  it("CAUTION with allowCaution continues past the decision but cannot bypass another disqualifier", () => {
    const candidate: StrategyCandidate = { mint: MINT, riskReport: risk("CAUTION", 35) };
    const config: StrategyConfig = {
      ...baseConfig,
      allowCaution: true,
      maxRiskScore: 40, // 35 ≤ 40, so the risk-score cap does NOT fire here
      minLiquidityUsd: 1000, // but a configured-missing metric DOES disqualify
    };
    const report = evaluateStrategy({ candidate, config, now: at });
    expect(report.decision).toBe("SKIP");
    expect(ids(report.reasons)).toContain(REASON_IDS.RISK_CAUTION_ALLOWED);
    expect(ids(report.disqualifiers)).toContain(REASON_IDS.LIQUIDITY_METRIC_MISSING);
  });

  it("risk score above maxRiskScore ⇒ SKIP even for PASS", () => {
    const candidate: StrategyCandidate = {
      mint: MINT,
      riskReport: risk("PASS_FOR_PAPER_EVALUATION", 20),
    };
    const config: StrategyConfig = { ...baseConfig, maxRiskScore: 10 };
    const report = evaluateStrategy({ candidate, config, now: at });
    expect(report.decision).toBe("SKIP");
    expect(ids(report.disqualifiers)).toContain(REASON_IDS.RISK_SCORE_ABOVE_MAX);
  });

  it("an unrecognized risk decision ⇒ SKIP (fail-safe), never a buy", () => {
    const candidate: StrategyCandidate = {
      mint: MINT,
      // Simulates malformed/injected input that bypassed the type system.
      riskReport: risk("APPROVED" as RiskDecision, 0),
    };
    const report = evaluateStrategy({ candidate, config: baseConfig, now: at });
    expect(report.decision).toBe("SKIP");
    expect(ids(report.disqualifiers)).toContain(REASON_IDS.RISK_DECISION_UNKNOWN);
  });

  it("a non-finite or out-of-range risk score ⇒ SKIP (fail-safe), not a cap bypass", () => {
    const nan = evaluateStrategy({
      candidate: { mint: MINT, riskReport: risk("PASS_FOR_PAPER_EVALUATION", Number.NaN) },
      config: baseConfig,
      now: at,
    });
    expect(nan.decision).toBe("SKIP");
    expect(ids(nan.disqualifiers)).toContain(REASON_IDS.RISK_SCORE_INVALID);

    // A negative score must not inflate the strategy score into a buy.
    const negative = evaluateStrategy({
      candidate: { mint: MINT, riskReport: risk("PASS_FOR_PAPER_EVALUATION", -50) },
      config: baseConfig,
      now: at,
    });
    expect(negative.decision).toBe("SKIP");
    expect(ids(negative.disqualifiers)).toContain(REASON_IDS.RISK_SCORE_INVALID);
    expect(negative.score).toBeLessThanOrEqual(100);
  });
});

describe("evaluateStrategy — PASS outcomes", () => {
  it("PASS can become a PAPER_BUY_CANDIDATE", () => {
    const candidate: StrategyCandidate = { mint: MINT, riskReport: PASS };
    const report = evaluateStrategy({ candidate, config: baseConfig, now: at });
    expect(report.decision).toBe("PAPER_BUY_CANDIDATE");
    expect(ids(report.reasons)).toContain(REASON_IDS.RISK_GATE_PASS);
    expect(ids(report.reasons)).toContain(REASON_IDS.SCORE_MEETS_BUY_THRESHOLD);
  });

  it("PASS can become a WATCH when the score is between the watch and buy thresholds", () => {
    const candidate: StrategyCandidate = { mint: MINT, riskReport: PASS };
    const config: StrategyConfig = { ...baseConfig, minScoreForPaperBuy: 90 };
    const report = evaluateStrategy({ candidate, config, now: at });
    expect(report.decision).toBe("WATCH");
    expect(ids(report.reasons)).toContain(REASON_IDS.SCORE_MEETS_WATCH_THRESHOLD);
  });

  it("PASS with a sub-watch score ⇒ SKIP (no disqualifier, just a low score)", () => {
    // riskScore 50 ⇒ strategy score 30; require watch ≥ 40 ⇒ below watch.
    const candidate: StrategyCandidate = {
      mint: MINT,
      riskReport: risk("PASS_FOR_PAPER_EVALUATION", 50),
    };
    const config: StrategyConfig = {
      minScoreForPaperBuy: 70,
      minScoreForWatch: 40,
      maxRiskScore: 60,
    };
    const report = evaluateStrategy({ candidate, config, now: at });
    expect(report.decision).toBe("SKIP");
    expect(report.disqualifiers).toHaveLength(0);
    expect(ids(report.reasons)).toContain(REASON_IDS.SCORE_BELOW_WATCH_THRESHOLD);
  });
});

describe("evaluateStrategy — entry metric gates", () => {
  it("configured-but-missing liquidity ⇒ SKIP", () => {
    const candidate: StrategyCandidate = { mint: MINT, riskReport: PASS };
    const config: StrategyConfig = { ...baseConfig, minLiquidityUsd: 1000 };
    const report = evaluateStrategy({ candidate, config, now: at });
    expect(report.decision).toBe("SKIP");
    expect(ids(report.disqualifiers)).toContain(REASON_IDS.LIQUIDITY_METRIC_MISSING);
  });

  it("low liquidity ⇒ SKIP", () => {
    const candidate: StrategyCandidate = {
      mint: MINT,
      riskReport: PASS,
      metrics: { liquidityUsd: 500 },
    };
    const config: StrategyConfig = { ...baseConfig, minLiquidityUsd: 1000 };
    const report = evaluateStrategy({ candidate, config, now: at });
    expect(report.decision).toBe("SKIP");
    expect(ids(report.disqualifiers)).toContain(REASON_IDS.LIQUIDITY_BELOW_MIN);
  });

  it("low volume ⇒ SKIP", () => {
    const candidate: StrategyCandidate = {
      mint: MINT,
      riskReport: PASS,
      metrics: { volumeUsd: 100 },
    };
    const config: StrategyConfig = { ...baseConfig, minVolumeUsd: 1000 };
    const report = evaluateStrategy({ candidate, config, now: at });
    expect(report.decision).toBe("SKIP");
    expect(ids(report.disqualifiers)).toContain(REASON_IDS.VOLUME_BELOW_MIN);
  });

  it("excessive price movement ⇒ SKIP", () => {
    const candidate: StrategyCandidate = {
      mint: MINT,
      riskReport: PASS,
      metrics: { priceChangePct: 120 },
    };
    const config: StrategyConfig = { ...baseConfig, maxPriceChangePct: 50 };
    const report = evaluateStrategy({ candidate, config, now: at });
    expect(report.decision).toBe("SKIP");
    expect(ids(report.disqualifiers)).toContain(REASON_IDS.PRICE_CHANGE_EXCESSIVE);
  });
});

describe("evaluateStrategy — cooldowns", () => {
  it("within the post-loss cooldown ⇒ SKIP", () => {
    const candidate: StrategyCandidate = {
      mint: MINT,
      riskReport: PASS,
      previousPaperTrade: { lastLossAt: "2026-06-05T11:30:00.000Z" }, // 30 min before NOW
    };
    const config: StrategyConfig = { ...baseConfig, cooldownAfterLossMinutes: 60 };
    const report = evaluateStrategy({ candidate, config, now: at });
    expect(report.decision).toBe("SKIP");
    expect(ids(report.disqualifiers)).toContain(REASON_IDS.COOLDOWN_AFTER_LOSS);
  });

  it("past the post-loss cooldown ⇒ no loss disqualifier (buys again)", () => {
    const candidate: StrategyCandidate = {
      mint: MINT,
      riskReport: PASS,
      previousPaperTrade: { lastLossAt: "2026-06-05T10:00:00.000Z" }, // 120 min before NOW
    };
    const config: StrategyConfig = { ...baseConfig, cooldownAfterLossMinutes: 60 };
    const report = evaluateStrategy({ candidate, config, now: at });
    expect(report.decision).toBe("PAPER_BUY_CANDIDATE");
    expect(ids(report.disqualifiers)).not.toContain(REASON_IDS.COOLDOWN_AFTER_LOSS);
  });

  it("a FUTURE loss timestamp is NOT in cooldown (window is the past)", () => {
    const candidate: StrategyCandidate = {
      mint: MINT,
      riskReport: PASS,
      previousPaperTrade: { lastLossAt: "2026-06-05T13:00:00.000Z" }, // 60 min AFTER NOW
    };
    const config: StrategyConfig = { ...baseConfig, cooldownAfterLossMinutes: 120 };
    const report = evaluateStrategy({ candidate, config, now: at });
    expect(report.decision).toBe("PAPER_BUY_CANDIDATE");
    expect(ids(report.disqualifiers)).not.toContain(REASON_IDS.COOLDOWN_AFTER_LOSS);
  });

  it("within the post-trade cooldown ⇒ WATCH instead of a new buy", () => {
    const candidate: StrategyCandidate = {
      mint: MINT,
      riskReport: PASS,
      previousPaperTrade: { lastTradeAt: "2026-06-05T11:45:00.000Z" }, // 15 min before NOW
    };
    const config: StrategyConfig = { ...baseConfig, cooldownAfterTradeMinutes: 60 };
    const report = evaluateStrategy({ candidate, config, now: at });
    expect(report.decision).toBe("WATCH");
    expect(ids(report.reasons)).toContain(REASON_IDS.COOLDOWN_AFTER_TRADE);
  });
});

describe("evaluateStrategy — position awareness", () => {
  it("at max open positions ⇒ no new PAPER_BUY_CANDIDATE (WATCH)", () => {
    const candidate: StrategyCandidate = { mint: MINT, riskReport: PASS };
    const config: StrategyConfig = { ...baseConfig, maxOpenPositions: 3 };
    const report = evaluateStrategy({
      candidate,
      config,
      portfolio: { openPositionCount: 3 },
      now: at,
    });
    expect(report.decision).toBe("WATCH");
    expect(ids(report.reasons)).toContain(REASON_IDS.MAX_OPEN_POSITIONS_REACHED);
  });

  it("above the concentration cap ⇒ no new PAPER_BUY_CANDIDATE (WATCH)", () => {
    const candidate: StrategyCandidate = { mint: MINT, riskReport: PASS };
    const config: StrategyConfig = { ...baseConfig, maxPositionConcentrationPct: 40 };
    const report = evaluateStrategy({
      candidate,
      config,
      portfolio: { openPositionCount: 1, topPositionConcentrationPct: 55 },
      now: at,
    });
    expect(report.decision).toBe("WATCH");
    expect(ids(report.reasons)).toContain(REASON_IDS.CONCENTRATION_CAP_REACHED);
  });

  it("holding + take-profit signal ⇒ PAPER_SELL_CANDIDATE", () => {
    const candidate: StrategyCandidate = {
      mint: MINT,
      riskReport: PASS,
      previousPaperTrade: { holdingPosition: true },
      metrics: { priceChangePct: 80 },
    };
    const config: StrategyConfig = { ...baseConfig, takeProfitPct: 50, stopLossPct: 30 };
    const report = evaluateStrategy({ candidate, config, now: at });
    expect(report.decision).toBe("PAPER_SELL_CANDIDATE");
    expect(ids(report.reasons)).toContain(REASON_IDS.SELL_TAKE_PROFIT);
  });

  it("holding + stop-loss signal ⇒ PAPER_SELL_CANDIDATE", () => {
    const candidate: StrategyCandidate = {
      mint: MINT,
      riskReport: PASS,
      previousPaperTrade: { holdingPosition: true },
      metrics: { priceChangePct: -60 },
    };
    const config: StrategyConfig = { ...baseConfig, takeProfitPct: 50, stopLossPct: 30 };
    const report = evaluateStrategy({ candidate, config, now: at });
    expect(report.decision).toBe("PAPER_SELL_CANDIDATE");
    expect(ids(report.reasons)).toContain(REASON_IDS.SELL_STOP_LOSS);
  });

  it("holding with no exit signal ⇒ WATCH (never SKIPs the entry gates while held)", () => {
    const candidate: StrategyCandidate = {
      mint: MINT,
      riskReport: PASS,
      previousPaperTrade: { holdingPosition: true },
      metrics: { priceChangePct: 10 },
    };
    const config: StrategyConfig = { ...baseConfig, takeProfitPct: 50, stopLossPct: 30 };
    const report = evaluateStrategy({ candidate, config, now: at });
    expect(report.decision).toBe("WATCH");
    expect(ids(report.reasons)).toContain(REASON_IDS.HOLDING_NO_EXIT_SIGNAL);
  });

  it("holding via the injected portfolio's heldMints ⇒ exit path", () => {
    const candidate: StrategyCandidate = {
      mint: MINT,
      riskReport: PASS,
      metrics: { priceChangePct: 80 },
    };
    const config: StrategyConfig = { ...baseConfig, takeProfitPct: 50 };
    const report = evaluateStrategy({
      candidate,
      config,
      portfolio: { openPositionCount: 1, heldMints: [MINT] },
      now: at,
    });
    expect(report.decision).toBe("PAPER_SELL_CANDIDATE");
    expect(ids(report.reasons)).toContain(REASON_IDS.HOLDING_POSITION);
  });
});

describe("evaluateStrategy — score, determinism, purity", () => {
  it("report score is always clamped to [0, 100]", () => {
    const hi: StrategyCandidate = {
      mint: MINT,
      riskReport: PASS,
      metrics: {
        liquidityUsd: 50_000,
        volumeUsd: 25_000,
        holderCount: 600,
        ageSeconds: 7200,
        priceChangePct: 20,
      },
    };
    expect(evaluateStrategy({ candidate: hi, config: baseConfig, now: at }).score).toBe(100);

    const lo: StrategyCandidate = { mint: MINT, metrics: { priceChangePct: -40 } };
    expect(evaluateStrategy({ candidate: lo, config: baseConfig, now: at }).score).toBe(0);
  });

  it("a hard disqualifier overrides a high score (decision SKIP, score still high)", () => {
    const candidate: StrategyCandidate = {
      mint: MINT,
      riskReport: PASS,
      // No liquidity metric, but rich on every other metric ⇒ score ~95.
      metrics: { volumeUsd: 25_000, holderCount: 600, ageSeconds: 7200, priceChangePct: 20 },
    };
    const config: StrategyConfig = {
      minScoreForPaperBuy: 50,
      minScoreForWatch: 30,
      maxRiskScore: 100,
      minLiquidityUsd: 1000, // configured ⇒ missing liquidity disqualifies
    };
    const report = evaluateStrategy({ candidate, config, now: at });
    expect(report.score).toBeGreaterThanOrEqual(90);
    expect(report.decision).toBe("SKIP");
    expect(ids(report.disqualifiers)).toContain(REASON_IDS.LIQUIDITY_METRIC_MISSING);
  });

  it("an injected clock makes reports deterministic", () => {
    const candidate: StrategyCandidate = { mint: MINT, riskReport: PASS };
    const a = evaluateStrategy({ candidate, config: baseConfig, now: at });
    const b = evaluateStrategy({ candidate, config: baseConfig, now: at });
    expect(a.createdAt).toBe(NOW);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("does not mutate the input candidate or config", () => {
    const candidate: StrategyCandidate = {
      mint: MINT,
      riskReport: PASS,
      metrics: { liquidityUsd: 1000, priceChangePct: 10 },
      previousPaperTrade: { holdingPosition: false },
      source: "snipe-list",
    };
    const config: StrategyConfig = { ...baseConfig, minLiquidityUsd: 500 };
    const candidateSnapshot = JSON.stringify(candidate);
    const configSnapshot = JSON.stringify(config);

    deepFreeze(candidate);
    deepFreeze(config);
    expect(() => evaluateStrategy({ candidate, config, now: at })).not.toThrow();

    expect(JSON.stringify(candidate)).toBe(candidateSnapshot);
    expect(JSON.stringify(config)).toBe(configSnapshot);
  });

  it("echoes the injected, read-only source label", () => {
    const candidate: StrategyCandidate = { mint: MINT, riskReport: PASS, source: "snipe-list" };
    const report = evaluateStrategy({ candidate, config: baseConfig, now: at });
    expect(report.source).toBe("snipe-list");
  });

  it("composes with a real @soulmaker/risk PASS report", () => {
    const riskReport = buildTokenRiskReport(
      {
        mint: MINT,
        decimals: 6,
        supplyRaw: "1000000",
        uiSupply: 1,
        mintAuthorityPresent: false,
        freezeAuthorityPresent: false,
        isInitialized: true,
        programLabel: "spl-token",
      },
      { now: at },
    );
    expect(riskReport.decision).toBe("PASS_FOR_PAPER_EVALUATION");
    const report = evaluateStrategy({
      candidate: { mint: MINT, riskReport },
      config: baseConfig,
      now: at,
    });
    expect(report.decision).toBe("PAPER_BUY_CANDIDATE");
    expect(report.riskScore).toBe(0);
  });
});

/** Deep-freeze so any attempted mutation throws in strict mode. */
function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object") {
    for (const value of Object.values(obj)) deepFreeze(value);
    Object.freeze(obj);
  }
  return obj;
}
