/**
 * @soulmaker/adapters — Phase 6+ (external integrations).
 *
 * Planned surface (not yet implemented):
 *  - DEX quote/route adapters (e.g. Jupiter) behind a narrow interface.
 *  - Data-provider adapters for token/pool metadata.
 *  - Wallet-adapter signing bridge for the Phase 8 web dashboard (manual
 *    approve flow — the bot never custodies the dashboard user's key).
 *
 * Every adapter is individually audited and documented before use; none is
 * vendored from a reference repo without a recorded license + security review.
 */

export const ADAPTERS_PACKAGE_PHASE = 6 as const;

export interface AdapterPlaceholder {
  readonly implemented: false;
}
