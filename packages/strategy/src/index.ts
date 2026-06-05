/**
 * @soulmaker/strategy — Phase 5 deterministic, **paper-only** strategy rules
 * engine.
 *
 * Decides whether a token candidate should be skipped, watched, or submitted to
 * `@soulmaker/paper` as a simulated paper-buy / paper-sell candidate. It consumes
 * an advisory `@soulmaker/risk` report plus injected, read-only metrics and emits
 * a deterministic {@link StrategyReport}. Its output only ever feeds *paper*
 * simulation.
 *
 * Hard rules (enforced by code + tests): nothing here builds, signs, simulates,
 * or sends a transaction; there is no signer, no keypair, no secret key, no RPC,
 * no wallet, no network, no filesystem, no `Date.now`, and no `Math.random`. A
 * `PAPER_BUY_CANDIDATE` means "candidate for simulated paper evaluation" — never
 * "safe to buy", "approved for live trading", "profitable", or a buy
 * recommendation.
 */

export const STRATEGY_PACKAGE_PHASE = 5 as const;

export { evaluateStrategy } from "./evaluate.js";
export type { EvaluateStrategyInput } from "./evaluate.js";

export { scoreCandidate } from "./score.js";
export type { ScoreInputs } from "./score.js";
export {
  SCORE_BASE,
  RISK_PENALTY_FACTOR,
  LIQUIDITY_BONUS,
  VOLUME_BONUS,
  HOLDERS_BONUS_HIGH,
  HOLDERS_BONUS_MED,
  HOLDERS_HIGH_AT,
  HOLDERS_MED_AT,
  AGE_BONUS,
  AGE_BONUS_AT,
  MOMENTUM_BONUS,
  MOMENTUM_BONUS_MAX_PCT,
  MOMENTUM_PENALTY,
  SCORE_MIN,
  SCORE_MAX,
} from "./score.js";

export { REASON_IDS, reason } from "./reasons.js";
export type { ReasonId } from "./reasons.js";

export {
  formatStrategyReport,
  buildStrategyEnvelope,
  STRATEGY_DISCLAIMER,
  STRATEGY_NOTES,
  STRATEGY_ONLY_BANNER,
} from "./report.js";
export type { StrategyReportEnvelope } from "./report.js";

export {
  planStrategyBatch,
  strategyReportToPaperCandidate,
  buildPaperCandidateBatch,
  formatStrategyPlanReport,
  buildStrategyPlanEnvelope,
  DEFAULT_PAPER_SIZE_USD,
} from "./plan.js";
export type {
  StrategyPlanInput,
  StrategyPlanItem,
  StrategyPlanResult,
  StrategyPlanEnvelope,
  PaperCandidateConversionOptions,
  FormatStrategyPlanOptions,
} from "./plan.js";

export { portfolioFromPaperState } from "./portfolio.js";

export { makeIdGen } from "./ids.js";
export type { IdGen } from "./ids.js";

export type {
  StrategyDecision,
  StrategyMetrics,
  PreviousPaperTradeMeta,
  StrategyCandidate,
  StrategyPortfolio,
  StrategyConfig,
  StrategyReason,
  StrategyReport,
} from "./types.js";
