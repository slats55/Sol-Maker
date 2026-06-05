/**
 * @soulmaker/solana — Phase 2 (read-only watcher).
 *
 * Planned surface (not yet implemented):
 *  - RpcClient / WsClient abstraction over @solana/web3.js (read-only).
 *  - Public-key balance & transaction monitor.
 *  - Token metadata lookup interface.
 *  - Pool/token launch event abstraction.
 *
 * Hard rule: nothing in this package ever holds a secret key or sends a
 * transaction. It is read-only by construction.
 */

export const SOLANA_PACKAGE_PHASE = 2 as const;

export interface ChainWatcherPlaceholder {
  readonly implemented: false;
}
