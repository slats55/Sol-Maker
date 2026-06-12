/**
 * Sprint 92 deep read-only inspections: holder concentration + Metaplex metadata.
 *
 * Both are pure READS of public chain state over the existing seam. They cannot sign, send, or
 * build anything. Both fail HONESTLY: a missing seam method, a missing account, or an
 * unparsable layout becomes an explicit "unavailable"/null fact — never a silent pass.
 */

import { PublicKey } from "@solana/web3.js";
import { redactString } from "@soulmaker/security";
import { parsePublicKey } from "./public-key.js";
import type {
  PublicKeyInput,
  SolanaRpcLike,
  TokenHolderConcentration,
  TokenMetadataInfo,
  TokenMintInfo,
} from "./types.js";

/** The Metaplex token-metadata program (public, well-known program id). */
export const METAPLEX_TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

/** The honesty caveat every holder-concentration result carries. */
export const HOLDER_CONCENTRATION_CAVEAT =
  "Largest token accounts routinely include AMM pools, vaults, and lockers — high concentration is a prompt to look, not proof of one controlling wallet.";

function coercePublicKey(input: PublicKeyInput): PublicKey {
  return typeof input === "string" ? parsePublicKey(input) : input;
}

/** Percent (2 dp) of `part` over `whole` using integer math — no float precision loss. */
function pctOfSupply(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  return Number((part * 10000n) / whole) / 100;
}

/**
 * Compute holder concentration from the chain's largest token accounts. Requires the seam's
 * optional `getTokenLargestAccounts`; throws a clear error when the seam (or supply) cannot
 * support the computation — callers surface that as "unavailable", never as a pass.
 */
export async function buildTokenHolderConcentration(
  rpc: SolanaRpcLike,
  mintInfo: TokenMintInfo,
): Promise<TokenHolderConcentration> {
  if (typeof rpc.getTokenLargestAccounts !== "function") {
    throw new Error("holder concentration unavailable: the RPC seam lacks getTokenLargestAccounts");
  }
  if (!/^[0-9]+$/.test(mintInfo.supplyRaw) || /^0+$/.test(mintInfo.supplyRaw)) {
    throw new Error("holder concentration unavailable: mint supply is missing, zero, or unparsable");
  }
  const pk = coercePublicKey(mintInfo.mint);
  const resp = await rpc.getTokenLargestAccounts(pk);
  const supply = BigInt(mintInfo.supplyRaw);

  const accounts = resp.value
    .filter((a) => /^[0-9]+$/.test(a.amount))
    .map((a) => ({ address: a.address.toBase58(), amountRaw: a.amount }));
  // The RPC returns these sorted descending, but recompute the order defensively.
  accounts.sort((a, b) => (BigInt(b.amountRaw) > BigInt(a.amountRaw) ? 1 : BigInt(b.amountRaw) < BigInt(a.amountRaw) ? -1 : 0));

  const sumTop = (n: number): bigint =>
    accounts.slice(0, n).reduce((acc, a) => acc + BigInt(a.amountRaw), 0n);

  return {
    mint: pk.toBase58(),
    supplyRaw: mintInfo.supplyRaw,
    accountsReturned: accounts.length,
    topAccounts: accounts.slice(0, 10).map((a) => ({
      address: a.address,
      amountRaw: a.amountRaw,
      pctOfSupply: pctOfSupply(BigInt(a.amountRaw), supply),
    })),
    top1Pct: pctOfSupply(sumTop(1), supply),
    top5Pct: pctOfSupply(sumTop(5), supply),
    source: "getTokenLargestAccounts",
    caveat: HOLDER_CONCENTRATION_CAVEAT,
  };
}

/** Derive the Metaplex metadata PDA for a mint (pure; public program id + public mint). */
export function metadataAddressForMint(mint: PublicKeyInput): PublicKey {
  const pk = coercePublicKey(mint);
  const [address] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), METAPLEX_TOKEN_METADATA_PROGRAM_ID.toBuffer(), pk.toBuffer()],
    METAPLEX_TOKEN_METADATA_PROGRAM_ID,
  );
  return address;
}

/** Bound + redact a chain-supplied display string; null when empty or unsafe. */
function safeChainLabel(value: string, max = 64): string | null {
  const trimmed = value.replace(/\0+/g, "").trim().slice(0, max);
  if (trimmed.length === 0) return null;
  if (redactString(trimmed) !== trimmed) return null;
  return trimmed;
}

/** A tiny bounds-checked cursor over the borsh-encoded metadata account. */
class ByteCursor {
  private offset = 0;
  constructor(private readonly buf: Buffer) {}
  take(n: number): Buffer {
    if (this.offset + n > this.buf.length) throw new Error("metadata account truncated");
    const out = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
  u8(): number {
    return this.take(1).readUInt8(0);
  }
  u16(): number {
    return this.take(2).readUInt16LE(0);
  }
  u32(): number {
    return this.take(4).readUInt32LE(0);
  }
  string(maxLen = 1024): string {
    const len = this.u32();
    if (len > maxLen) throw new Error("metadata string field implausibly long");
    return this.take(len).toString("utf8");
  }
  pubkey(): PublicKey {
    return new PublicKey(this.take(32));
  }
}

interface ParsedMetadata {
  updateAuthority: PublicKey;
  name: string;
  symbol: string;
  isMutable: boolean;
}

/**
 * Parse the prefix of a Metaplex token-metadata account we need:
 * key u8 | update_authority 32 | mint 32 | name str | symbol str | uri str |
 * seller_fee_basis_points u16 | creators Option<Vec<Creator{32+1+1}>> |
 * primary_sale_happened u8 | is_mutable u8 | …rest ignored.
 * Throws on any truncation/shape problem — callers report null facts, never guesses.
 */
export function parseMetadataAccount(data: Buffer): ParsedMetadata {
  const cur = new ByteCursor(data);
  cur.u8(); // key
  const updateAuthority = cur.pubkey();
  cur.pubkey(); // mint (caller already knows it; cross-checked upstream by the PDA derivation)
  const name = cur.string();
  const symbol = cur.string();
  cur.string(); // uri
  cur.u16(); // seller_fee_basis_points
  const hasCreators = cur.u8();
  if (hasCreators === 1) {
    const count = cur.u32();
    if (count > 16) throw new Error("metadata creators count implausible");
    for (let i = 0; i < count; i += 1) {
      cur.pubkey();
      cur.u8(); // verified
      cur.u8(); // share
    }
  } else if (hasCreators !== 0) {
    throw new Error("metadata creators option byte invalid");
  }
  cur.u8(); // primary_sale_happened
  const isMutable = cur.u8();
  if (isMutable !== 0 && isMutable !== 1) throw new Error("metadata is_mutable byte invalid");
  return { updateAuthority, name, symbol, isMutable: isMutable === 1 };
}

/**
 * Read the Metaplex metadata facts for a mint. Requires the seam's optional raw
 * `getAccountInfo`. A missing account → `metadataAccountFound: false`; an unparsable account →
 * found but null facts. Throws only when the seam cannot read at all.
 */
export async function buildTokenMetadataInfo(
  rpc: SolanaRpcLike,
  mint: PublicKeyInput,
): Promise<TokenMetadataInfo> {
  if (typeof rpc.getAccountInfo !== "function") {
    throw new Error("metadata read unavailable: the RPC seam lacks getAccountInfo");
  }
  const pk = coercePublicKey(mint);
  const address = metadataAddressForMint(pk);
  const account = await rpc.getAccountInfo(address);
  if (account === null || !Buffer.isBuffer(account.data)) {
    return {
      mint: pk.toBase58(),
      metadataAccountFound: false,
      isMutable: null,
      updateAuthority: null,
      nameLabel: null,
      symbolLabel: null,
      source: "getAccountInfo(metaplex-metadata-pda)",
    };
  }
  try {
    const parsed = parseMetadataAccount(account.data);
    return {
      mint: pk.toBase58(),
      metadataAccountFound: true,
      isMutable: parsed.isMutable,
      updateAuthority: parsed.updateAuthority.toBase58(),
      nameLabel: safeChainLabel(parsed.name),
      symbolLabel: safeChainLabel(parsed.symbol, 16),
      source: "getAccountInfo(metaplex-metadata-pda)",
    };
  } catch {
    // The account exists but does not parse as the known layout — null facts, never guesses.
    return {
      mint: pk.toBase58(),
      metadataAccountFound: true,
      isMutable: null,
      updateAuthority: null,
      nameLabel: null,
      symbolLabel: null,
      source: "getAccountInfo(metaplex-metadata-pda; layout unparsable)",
    };
  }
}
