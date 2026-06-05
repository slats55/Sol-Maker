/**
 * Advisory scoring + decision model. Simple, documented, deterministic.
 *
 * Score is a 0–100 *advisory* number (0 = safest, 100 = riskiest), built by
 * summing per-severity weights for risk flags, applying a small credit for an
 * explicit allowlist match, then clamping to [0, 100].
 *
 * Positive informational flags (renounced authorities, standard program) carry
 * weight 0: the reward for safety is *not incurring* the corresponding risk
 * weight, not a separate bonus (which would double-count and could wrongly pull
 * a genuinely risky token across a decision tier). The single exception is an
 * operator **allowlist** match, an active trust signal, which credits a small
 * amount — but it can never rescue a mint that has a critical flag, because any
 * critical flag forces REJECT regardless of the numeric score.
 */

import type { RiskDecision, RiskFlag, RiskSeverity } from "./types.js";

/** Per-severity score weight for risk flags. */
export const SEVERITY_WEIGHTS: Readonly<Record<RiskSeverity, number>> = {
  info: 0,
  low: 5,
  medium: 15,
  high: 30,
  critical: 100,
};

/** Small score credit applied once when the mint is on the operator allowlist. */
export const ALLOWLIST_CREDIT = -10;

/** Flag id → fixed score credit (negative). Extensible, explicit, testable. */
export const CREDIT_FLAG_IDS: Readonly<Record<string, number>> = {
  "allowlisted-mint": ALLOWLIST_CREDIT,
};

/** Decision thresholds on the final clamped score. */
export const DECISION_THRESHOLDS = {
  /** Score at or above this → REJECT. */
  REJECT_AT: 70,
  /** Score at or above this (but below REJECT_AT) → CAUTION. */
  CAUTION_AT: 30,
} as const;

export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

export interface RiskScoreResult {
  /** Clamped advisory score in [0, 100]. */
  score: number;
  decision: RiskDecision;
  /** True when at least one critical flag fired (forces REJECT). */
  hasCritical: boolean;
}

function clampScore(raw: number): number {
  if (raw < SCORE_MIN) return SCORE_MIN;
  if (raw > SCORE_MAX) return SCORE_MAX;
  return raw;
}

/** Score a set of flags and derive the advisory decision. Deterministic. */
export function scoreRiskFlags(flags: readonly RiskFlag[]): RiskScoreResult {
  let raw = 0;
  let hasCritical = false;

  for (const flag of flags) {
    const credit = CREDIT_FLAG_IDS[flag.id];
    if (credit !== undefined) {
      raw += credit;
      continue;
    }
    if (flag.severity === "critical") hasCritical = true;
    raw += SEVERITY_WEIGHTS[flag.severity];
  }

  const score = clampScore(raw);

  // Any critical flag forces REJECT regardless of the numeric score (a credit
  // can never buy back a deal-breaker). Otherwise the score decides the tier.
  let decision: RiskDecision;
  if (hasCritical || score >= DECISION_THRESHOLDS.REJECT_AT) {
    decision = "REJECT";
  } else if (score >= DECISION_THRESHOLDS.CAUTION_AT) {
    decision = "CAUTION";
  } else {
    decision = "PASS_FOR_PAPER_EVALUATION";
  }

  return { score, decision, hasCritical };
}
