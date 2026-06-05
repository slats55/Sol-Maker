/**
 * Deterministic strategy scoring (0–100).
 *
 * The score is a transparent, additive model: start at a neutral base, subtract
 * a portion of the advisory **risk** score, then add small bonuses for positive
 * injected metrics (liquidity, volume, holders, age, healthy momentum) and a
 * small penalty for negative momentum. The result is clamped to `[0, 100]`.
 *
 * Every input is optional: a missing metric contributes nothing (neither bonus
 * nor penalty). The score is advisory and feeds *paper* decisioning only — it is
 * not a probability, a price target, or any claim of profitability. Disqualifiers
 * (handled in `evaluate.ts`) always override the score: a high score can never
 * turn a hard disqualifier into a buy.
 */

import type { StrategyMetrics } from "./types.js";

/** Neutral starting score before risk penalty and metric bonuses. */
export const SCORE_BASE = 60;
/** Fraction of the advisory risk score subtracted (risk 100 ⇒ −60). */
export const RISK_PENALTY_FACTOR = 0.6;

/** Bonus when liquidity is present (and meets the configured min, if any). */
export const LIQUIDITY_BONUS = 15;
/** Bonus when volume is present (and meets the configured min, if any). */
export const VOLUME_BONUS = 10;
/** Holder-count bonuses (stepped, deterministic). */
export const HOLDERS_BONUS_HIGH = 10; // ≥ HOLDERS_HIGH_AT holders
export const HOLDERS_BONUS_MED = 5; //  ≥ HOLDERS_MED_AT holders
export const HOLDERS_HIGH_AT = 500;
export const HOLDERS_MED_AT = 100;
/** Bonus when the token is at least AGE_BONUS_AT seconds old. */
export const AGE_BONUS = 5;
export const AGE_BONUS_AT = 3600; // 1 hour
/** Bonus for healthy positive momentum (0 ≤ pct ≤ MOMENTUM_BONUS_MAX_PCT). */
export const MOMENTUM_BONUS = 10;
export const MOMENTUM_BONUS_MAX_PCT = 100;
/** Penalty for negative momentum (pct < 0). */
export const MOMENTUM_PENALTY = 10;

export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

function clampScore(raw: number): number {
  if (!Number.isFinite(raw)) return SCORE_MIN;
  if (raw < SCORE_MIN) return SCORE_MIN;
  if (raw > SCORE_MAX) return SCORE_MAX;
  // Round to avoid floating-point dust in a stable, comparable integer-ish score.
  return Math.round(raw);
}

/**
 * Bound the advisory risk score into [0, 100] before it drives the penalty.
 * `@soulmaker/risk` always emits a clamped score, but the input to the strategy
 * engine can be injected/untrusted JSON — a non-finite or negative value must
 * never *inflate* the strategy score (a negative "penalty" would be a bonus).
 * A non-finite score is treated as **maximally risky** (never as safe).
 */
function clampRiskScore(raw: number): number {
  if (!Number.isFinite(raw)) return SCORE_MAX;
  if (raw < SCORE_MIN) return SCORE_MIN;
  if (raw > SCORE_MAX) return SCORE_MAX;
  return raw;
}

export interface ScoreInputs {
  /** Advisory risk score from `@soulmaker/risk` (0–100), or null if absent. */
  riskScore: number | null;
  metrics?: StrategyMetrics;
  /** Configured minimum liquidity, if any (gates the liquidity bonus). */
  minLiquidityUsd?: number;
  /** Configured minimum volume, if any (gates the volume bonus). */
  minVolumeUsd?: number;
}

/**
 * Compute the deterministic strategy score. Pure: depends only on its inputs.
 * A `null` risk score (no report) applies the maximum risk penalty — absence of
 * a risk judgment is treated as maximally risky, never as safe.
 */
export function scoreCandidate(inputs: ScoreInputs): number {
  const { metrics, minLiquidityUsd, minVolumeUsd } = inputs;
  // missing ⇒ riskiest; out-of-range / non-finite ⇒ bounded (never inflates).
  const riskScore = clampRiskScore(inputs.riskScore ?? SCORE_MAX);
  let score = SCORE_BASE - riskScore * RISK_PENALTY_FACTOR;

  if (metrics) {
    if (typeof metrics.liquidityUsd === "number") {
      const meetsMin =
        minLiquidityUsd === undefined
          ? metrics.liquidityUsd > 0
          : metrics.liquidityUsd >= minLiquidityUsd;
      if (meetsMin) score += LIQUIDITY_BONUS;
    }

    if (typeof metrics.volumeUsd === "number") {
      const meetsMin =
        minVolumeUsd === undefined
          ? metrics.volumeUsd > 0
          : metrics.volumeUsd >= minVolumeUsd;
      if (meetsMin) score += VOLUME_BONUS;
    }

    if (typeof metrics.holderCount === "number") {
      if (metrics.holderCount >= HOLDERS_HIGH_AT) score += HOLDERS_BONUS_HIGH;
      else if (metrics.holderCount >= HOLDERS_MED_AT) score += HOLDERS_BONUS_MED;
    }

    if (typeof metrics.ageSeconds === "number" && metrics.ageSeconds >= AGE_BONUS_AT) {
      score += AGE_BONUS;
    }

    if (typeof metrics.priceChangePct === "number") {
      const pct = metrics.priceChangePct;
      if (pct < 0) score -= MOMENTUM_PENALTY;
      else if (pct <= MOMENTUM_BONUS_MAX_PCT) score += MOMENTUM_BONUS;
      // pct > MOMENTUM_BONUS_MAX_PCT (overheated) earns no bonus.
    }
  }

  return clampScore(score);
}
