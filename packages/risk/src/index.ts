/**
 * @soulmaker/risk — Phase 3 read-only, advisory token risk engine.
 *
 * Turns the read-only mint facts gathered by `@soulmaker/solana` into structured,
 * explained risk flags and a numeric advisory score, with allowlist / denylist /
 * previously-traded inputs. It is **advisory only**:
 *
 *  - It is NOT a buy/sell recommendation engine.
 *  - It NEVER builds, signs, simulates, or sends a transaction.
 *  - It holds no secret key, signer, or keypair — there is no such type here.
 *  - `PASS_FOR_PAPER_EVALUATION` only permits *paper-trading* evaluation later;
 *    it is never a live-trading safety judgment.
 */

export const RISK_PACKAGE_PHASE = 3 as const;

export {
  evaluateRiskFlags,
  SUSPICIOUS_DECIMALS_THRESHOLD,
  HOLDER_TOP1_EXTREME_PCT,
  HOLDER_TOP1_ELEVATED_PCT,
  HOLDER_TOP5_ELEVATED_PCT,
  QUOTE_IMPACT_VERY_THIN_PCT,
  QUOTE_IMPACT_THIN_PCT,
} from "./risk-flags.js";

export {
  scoreRiskFlags,
  SEVERITY_WEIGHTS,
  ALLOWLIST_CREDIT,
  CREDIT_FLAG_IDS,
  DECISION_THRESHOLDS,
  SCORE_MIN,
  SCORE_MAX,
} from "./risk-score.js";
export type { RiskScoreResult } from "./risk-score.js";

export {
  buildTokenRiskReport,
  formatTokenRiskReport,
  RISK_DISCLAIMER,
} from "./risk-report.js";
export type { BuildRiskReportOptions } from "./risk-report.js";

export { normalizeMint, parseList, dedupeList, listIncludes } from "./lists.js";
export type { ParsedList } from "./lists.js";

export type {
  RiskSeverity,
  RiskDecision,
  RiskFlag,
  TokenRiskInput,
  TokenRiskReport,
} from "./types.js";
