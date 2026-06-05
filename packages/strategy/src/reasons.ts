/**
 * Stable reason / disqualifier identifiers.
 *
 * Every reason the engine can emit has a fixed kebab-case id here so tests can
 * assert exact behavior and downstream tooling can branch on stable strings
 * rather than human-readable prose. `REASON_IDS` is the single source of truth;
 * `reason(...)` builds a {@link StrategyReason} from an id + message + evidence.
 */

import type { StrategyReason } from "./types.js";

/**
 * The catalog of stable reason ids. Grouped by the rule that emits them.
 * Disqualifiers (force `SKIP`) and soft reasons (shape `WATCH`/buy/sell) share
 * this catalog; whether an id is a disqualifier is decided by the engine, not
 * by the id itself.
 */
export const REASON_IDS = {
  // --- risk gate ----------------------------------------------------------
  RISK_REPORT_MISSING: "risk-report-missing",
  RISK_DECISION_REJECT: "risk-decision-reject",
  RISK_DECISION_CAUTION: "risk-decision-caution",
  RISK_DECISION_UNKNOWN: "risk-decision-unknown",
  RISK_CAUTION_ALLOWED: "risk-caution-allowed",
  RISK_GATE_PASS: "risk-gate-pass",
  RISK_SCORE_ABOVE_MAX: "risk-score-above-max",
  RISK_SCORE_INVALID: "risk-score-invalid",

  // --- entry metric gates -------------------------------------------------
  LIQUIDITY_METRIC_MISSING: "liquidity-metric-missing",
  LIQUIDITY_BELOW_MIN: "liquidity-below-min",
  LIQUIDITY_OK: "liquidity-ok",
  VOLUME_METRIC_MISSING: "volume-metric-missing",
  VOLUME_BELOW_MIN: "volume-below-min",
  VOLUME_OK: "volume-ok",
  PRICE_CHANGE_METRIC_MISSING: "price-change-metric-missing",
  PRICE_CHANGE_EXCESSIVE: "price-change-excessive",
  PRICE_CHANGE_OK: "price-change-ok",

  // --- cooldowns ----------------------------------------------------------
  COOLDOWN_AFTER_LOSS: "cooldown-after-loss",
  COOLDOWN_AFTER_TRADE: "cooldown-after-trade",

  // --- position awareness -------------------------------------------------
  HOLDING_POSITION: "holding-position",
  MAX_OPEN_POSITIONS_REACHED: "max-open-positions-reached",
  CONCENTRATION_CAP_REACHED: "concentration-cap-reached",

  // --- entry decision (not held) -----------------------------------------
  SCORE_MEETS_BUY_THRESHOLD: "score-meets-buy-threshold",
  SCORE_MEETS_WATCH_THRESHOLD: "score-meets-watch-threshold",
  SCORE_BELOW_WATCH_THRESHOLD: "score-below-watch-threshold",

  // --- exit decision (held) ----------------------------------------------
  SELL_TAKE_PROFIT: "sell-take-profit",
  SELL_STOP_LOSS: "sell-stop-loss",
  HOLDING_NO_EXIT_SIGNAL: "holding-no-exit-signal",
  HOLDING_NO_PRICE_METRIC: "holding-no-price-metric",
} as const;

/** Union of every stable reason id. */
export type ReasonId = (typeof REASON_IDS)[keyof typeof REASON_IDS];

/** Build a {@link StrategyReason}. `evidence` is optional and never holds secrets. */
export function reason(
  id: ReasonId,
  message: string,
  evidence?: Record<string, unknown>,
): StrategyReason {
  return evidence ? { id, message, evidence } : { id, message };
}
