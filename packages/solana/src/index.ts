/**
 * @soulmaker/solana — Phase 2 (read-only Solana watcher).
 *
 * Read-only by construction: public-key validation, an RPC client that exposes
 * only read methods, a wallet watch report, and a token mint inspection report.
 *
 * Hard rule (enforced by code + tests): nothing here holds a secret key, builds,
 * signs, or sends a transaction. There is no signer and no `sendTransaction`.
 */

export const SOLANA_PACKAGE_PHASE = 2 as const;

export {
  parsePublicKey,
  isValidPublicKey,
  publicKeyToBase58,
  InvalidPublicKeyError,
} from "./public-key.js";

export {
  createReadOnlySolanaClient,
  createClientFromRpc,
  endpointHostOf,
} from "./rpc-client.js";
export type { ClientFromRpcOptions } from "./rpc-client.js";

export {
  buildWalletWatchReport,
  formatWalletWatchReport,
} from "./wallet-watch.js";
export type { WalletWatchOptions } from "./wallet-watch.js";

export {
  buildTokenInspectReport,
  formatTokenInspectReport,
} from "./token-inspect.js";
export type { TokenInspectOptions } from "./token-inspect.js";

export {
  METAPLEX_TOKEN_METADATA_PROGRAM_ID,
  HOLDER_CONCENTRATION_CAVEAT,
  buildTokenHolderConcentration,
  buildTokenMetadataInfo,
  metadataAddressForMint,
  parseMetadataAccount,
} from "./deep-inspect.js";

export type {
  PublicKeyInput,
  ReadOnlyClientConfig,
  ReadOnlySolanaClient,
  RpcHealth,
  RpcVersion,
  SolBalance,
  SolanaRpcLike,
  ParsedTokenAccount,
  TokenAccountSummary,
  TokenProgramLabel,
  TokenMintInfo,
  TokenHolderConcentration,
  TokenMetadataInfo,
  WalletWatchReport,
  TokenInspectReport,
} from "./types.js";
