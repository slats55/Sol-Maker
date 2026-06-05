import { describe, it, expect } from "vitest";
import {
  scoreCandidate,
  SCORE_BASE,
  SCORE_MIN,
  SCORE_MAX,
} from "./score.js";
import type { StrategyMetrics } from "./types.js";

describe("scoreCandidate", () => {
  it("a clean PASS (riskScore 0) with no metrics scores the neutral base", () => {
    expect(scoreCandidate({ riskScore: 0 })).toBe(SCORE_BASE);
  });

  it("subtracts a portion of the advisory risk score", () => {
    // base 60 - 50 * 0.6 = 30
    expect(scoreCandidate({ riskScore: 50 })).toBe(30);
  });

  it("treats a missing (null) risk score as maximally risky", () => {
    // riskScore null ⇒ treated as 100 ⇒ 60 - 60 = 0
    expect(scoreCandidate({ riskScore: null })).toBe(0);
  });

  it("clamps to 100 when all positive metric bonuses stack", () => {
    const metrics: StrategyMetrics = {
      liquidityUsd: 50_000,
      volumeUsd: 25_000,
      holderCount: 600,
      ageSeconds: 7200,
      priceChangePct: 20,
    };
    // 60 + 15 + 10 + 10 + 5 + 10 = 110 ⇒ clamped to 100
    expect(scoreCandidate({ riskScore: 0, metrics })).toBe(SCORE_MAX);
  });

  it("clamps to 0 when risk + negative momentum push below zero", () => {
    const metrics: StrategyMetrics = { priceChangePct: -40 };
    // 60 - 60 - 10 = -10 ⇒ clamped to 0
    expect(scoreCandidate({ riskScore: 100, metrics })).toBe(SCORE_MIN);
  });

  it("awards the medium holder bonus below the high threshold", () => {
    expect(scoreCandidate({ riskScore: 0, metrics: { holderCount: 150 } })).toBe(65);
    expect(scoreCandidate({ riskScore: 0, metrics: { holderCount: 50 } })).toBe(60);
  });

  it("gives no momentum bonus for an overheated (>100%) move", () => {
    expect(scoreCandidate({ riskScore: 0, metrics: { priceChangePct: 150 } })).toBe(60);
  });

  it("penalizes negative momentum", () => {
    // 60 - 10 = 50
    expect(scoreCandidate({ riskScore: 0, metrics: { priceChangePct: -5 } })).toBe(50);
  });

  it("withholds the liquidity/volume bonus when below a configured minimum", () => {
    const metrics: StrategyMetrics = { liquidityUsd: 500, volumeUsd: 100 };
    const score = scoreCandidate({
      riskScore: 0,
      metrics,
      minLiquidityUsd: 1000,
      minVolumeUsd: 1000,
    });
    expect(score).toBe(SCORE_BASE); // neither bonus applied
  });

  it("awards the liquidity/volume bonus when at/above a configured minimum", () => {
    const metrics: StrategyMetrics = { liquidityUsd: 1000, volumeUsd: 2000 };
    const score = scoreCandidate({
      riskScore: 0,
      metrics,
      minLiquidityUsd: 1000,
      minVolumeUsd: 1000,
    });
    expect(score).toBe(SCORE_BASE + 15 + 10);
  });

  it("treats a non-finite risk score as maximally risky (never as safe)", () => {
    // NaN is not null, so the ?? fallback does not catch it — clamping must.
    expect(scoreCandidate({ riskScore: Number.NaN })).toBe(0);
  });

  it("clamps a negative (invalid) risk score so it cannot INFLATE the score", () => {
    // Without clamping this would be 60 - (-50)*0.6 = 90; clamped risk ⇒ 60.
    expect(scoreCandidate({ riskScore: -50 })).toBe(SCORE_BASE);
  });

  it("clamps an over-range (>100) risk score to the maximum penalty", () => {
    // riskScore 200 ⇒ clamped to 100 ⇒ 60 - 60 = 0 (same as a 100 score).
    expect(scoreCandidate({ riskScore: 200 })).toBe(SCORE_MIN);
  });

  it("is pure: identical inputs yield identical output", () => {
    const metrics: StrategyMetrics = { liquidityUsd: 1000, holderCount: 200 };
    expect(scoreCandidate({ riskScore: 10, metrics })).toBe(
      scoreCandidate({ riskScore: 10, metrics }),
    );
  });
});
