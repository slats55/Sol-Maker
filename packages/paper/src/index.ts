/**
 * @soulmaker/paper — Phase 4 (paper trading engine).
 *
 * Planned surface (not yet implemented):
 *  - Simulated buy/sell against observed/mocked prices.
 *  - TP/SL handling.
 *  - Append-only trade journal.
 *  - PnL report.
 *
 * Deterministic and offline by design so it can be unit-tested without RPC.
 */

export const PAPER_PACKAGE_PHASE = 4 as const;

export interface PaperEnginePlaceholder {
  readonly implemented: false;
}
