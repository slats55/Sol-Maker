/**
 * @soulmaker/strategy — Phase 4+ (strategy engine).
 *
 * Planned surface (not yet implemented):
 *  - Snipe-list ingestion.
 *  - Entry/exit decisioning fed by @soulmaker/risk scores.
 *  - Take-profit / stop-loss rule evaluation.
 *
 * Strategies emit intents; they never sign or send. Execution is gated
 * separately by @soulmaker/core's live gate.
 */

export const STRATEGY_PACKAGE_PHASE = 4 as const;

export interface StrategyPlaceholder {
  readonly implemented: false;
}
