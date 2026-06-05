/**
 * Shared types for the read-only Solana layer.
 *
 * Everything here describes *reads* of public chain state. There are no types
 * for signers, secret keys, keypairs, or transactions — by design. If you find
 * yourself wanting to add one, stop: that belongs to a later, gated phase.
 */

import type {
  Commitment,
  PublicKey,
  AccountInfo,
  ParsedAccountData,
  RpcResponseAndContext,
} from "@solana/web3.js";

/** Anything we accept where a public key is expected: a base58 string or a PublicKey. */
export type PublicKeyInput = string | PublicKey;

export interface ReadOnlyClientConfig {
  /** Read-only RPC HTTP endpoint. Required — chain reads cannot run without it. */
  rpcUrl: string;
  /** Commitment level for reads. Defaults to "confirmed". */
  commitment?: Commitment;
  /** Injectable clock (ISO string) for deterministic output/tests. */
  now?: () => string;
}

export interface RpcHealth {
  ok: boolean;
  /** Host of the RPC endpoint, never the full URL (drops any api-key query). */
  endpointHost: string;
  solanaCore?: string;
  featureSet?: number;
  slot?: number;
  /** Present only when ok=false; already redacted. */
  error?: string;
}

export interface RpcVersion {
  solanaCore: string;
  featureSet?: number;
}

export interface SolBalance {
  ownerBase58: string;
  lamports: number;
  sol: number;
}

/** The SPL token program that owns a given token account. */
export type TokenProgramLabel = "spl-token" | "spl-token-2022";

export interface TokenAccountSummary {
  tokenAccount: string;
  mint: string;
  programLabel: TokenProgramLabel;
  /** Raw integer amount as a string (no precision loss). */
  amountRaw: string;
  decimals: number;
  /** Human amount as reported by the RPC; may be null → coerced to 0. */
  uiAmount: number;
}

export interface TokenMintInfo {
  mint: string;
  decimals: number;
  /** Raw supply as a string (authoritative, no precision loss). */
  supplyRaw: string;
  /** Approximate UI supply (supply / 10^decimals). May lose precision — display only. */
  uiSupply: number;
  /** True when a mint authority is set (can mint more — dilution/rug risk). */
  mintAuthorityPresent: boolean;
  /** True when a freeze authority is set (can freeze your token — can't sell). */
  freezeAuthorityPresent: boolean;
  isInitialized: boolean;
  /** The owning token program (classic SPL or Token-2022). */
  programLabel: TokenProgramLabel | "unknown";
  /** How this was read, for auditability. */
  source: string;
}

/** A read-only Solana client. Exposes ONLY read methods — no send/sign/airdrop. */
export interface ReadOnlySolanaClient {
  /** Host only (never the full URL / api-key). */
  readonly endpointHost: string;
  getRpcHealth(): Promise<RpcHealth>;
  getVersion(): Promise<RpcVersion>;
  getSolBalance(owner: PublicKeyInput): Promise<SolBalance>;
  getTokenAccounts(owner: PublicKeyInput): Promise<TokenAccountSummary[]>;
  getTokenMintInfo(mint: PublicKeyInput): Promise<TokenMintInfo>;
}

export interface ParsedTokenAccount {
  pubkey: PublicKey;
  account: AccountInfo<ParsedAccountData>;
}

/**
 * The narrow slice of `@solana/web3.js` `Connection` that the client depends on.
 * A real `Connection` satisfies this; tests pass an in-memory fake. Only read
 * methods appear here — there is intentionally no way to send from this seam.
 */
export interface SolanaRpcLike {
  getVersion(): Promise<{ "solana-core": string; "feature-set"?: number }>;
  getSlot(commitment?: Commitment): Promise<number>;
  getBalance(publicKey: PublicKey, commitment?: Commitment): Promise<number>;
  getParsedAccountInfo(
    publicKey: PublicKey,
    commitment?: Commitment,
  ): Promise<
    RpcResponseAndContext<AccountInfo<Buffer | ParsedAccountData> | null>
  >;
  getParsedTokenAccountsByOwner(
    owner: PublicKey,
    filter: { programId: PublicKey },
    commitment?: Commitment,
  ): Promise<RpcResponseAndContext<ParsedTokenAccount[]>>;
}

export interface WalletWatchReport {
  owner: string;
  solBalance: SolBalance;
  tokenAccountCount: number;
  tokenAccounts: TokenAccountSummary[];
  endpointHost: string;
  timestamp: string;
  capabilityNote: string;
}

export interface TokenInspectReport extends TokenMintInfo {
  endpointHost: string;
  timestamp: string;
  note: string;
}
