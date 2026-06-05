/**
 * @soulmaker/risk — Phase 3 (filter & risk engine).
 *
 * Planned surface (not yet implemented):
 *  - Token risk flags: mint authority present, freeze authority present,
 *    metadata mutable, missing socials, suspicious pool size, denylisted mint,
 *    previously-traded mint, liquidity/burn status.
 *  - Allowlist / denylist.
 *  - Scoring output (RiskScore).
 *
 * The risk engine is advisory input to the trade decision; it never sends.
 */

export const RISK_PACKAGE_PHASE = 3 as const;

/** Placeholder shape for the eventual risk score output. */
export interface RiskScorePlaceholder {
  readonly implemented: false;
}
