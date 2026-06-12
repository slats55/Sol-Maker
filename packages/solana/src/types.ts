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

/**
 * Holder concentration for one mint, computed from the chain's largest token accounts
 * (Sprint 92 deep read). HONESTY NOTE carried on the result: the largest accounts routinely
 * include AMM pools, vaults, and lockers — a high figure is a *prompt to look*, not proof of a
 * single controlling wallet.
 */
export interface TokenHolderConcentration {
  mint: string;
  /** Raw supply used as the denominator (authoritative integer string). */
  supplyRaw: string;
  /** How many largest accounts the RPC returned (chain caps this at 20). */
  accountsReturned: number;
  /** Largest token accounts, bounded to the top 10 for display. */
  topAccounts: Array<{ address: string; amountRaw: string; pctOfSupply: number }>;
  /** Percent of supply held by the single largest token account (2 dp). */
  top1Pct: number;
  /** Percent of supply held by the five largest token accounts (2 dp). */
  top5Pct: number;
  /** How this was read, for auditability. */
  source: string;
  /** The honesty caveat above, carried verbatim on every result. */
  caveat: string;
}

/**
 * Metaplex token-metadata facts for one mint (Sprint 92 deep read). Every field that cannot be
 * determined is null — never assumed. `isMutable` true means the metadata (name/symbol/URI) can
 * still be changed by the update authority.
 */
export interface TokenMetadataInfo {
  mint: string;
  /** True when a Metaplex metadata account exists for this mint. */
  metadataAccountFound: boolean;
  /** True/false when parsed; null when the account is missing or unparsable. */
  isMutable: boolean | null;
  /** The update authority (base58) when parsed; null otherwise. Public data. */
  updateAuthority: string | null;
  /** Bounded, redaction-stable display labels; null when missing/unsafe. */
  nameLabel: string | null;
  symbolLabel: string | null;
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
  /**
   * Sprint 92 deep reads — OPTIONAL so older fakes/seams stay valid: callers must treat an
   * absent method as "check unavailable" (honest), never as a pass.
   */
  getTokenHolderConcentration?(mint: PublicKeyInput): Promise<TokenHolderConcentration>;
  getTokenMetadataInfo?(mint: PublicKeyInput): Promise<TokenMetadataInfo>;
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
  /**
   * Sprint 92 deep reads — OPTIONAL on the seam (a real `Connection` always has them; older
   * fakes simply don't, and the client then reports the deep checks as unavailable).
   */
  getTokenLargestAccounts?(
    mint: PublicKey,
    commitment?: Commitment,
  ): Promise<RpcResponseAndContext<Array<{ address: PublicKey; amount: string; decimals: number }>>>;
  getAccountInfo?(
    publicKey: PublicKey,
    commitment?: Commitment,
  ): Promise<AccountInfo<Buffer> | null>;
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
