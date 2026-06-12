import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  buildTokenHolderConcentration,
  buildTokenMetadataInfo,
  metadataAddressForMint,
  parseMetadataAccount,
  HOLDER_CONCENTRATION_CAVEAT,
  METAPLEX_TOKEN_METADATA_PROGRAM_ID,
} from "./deep-inspect.js";
import type { SolanaRpcLike, TokenMintInfo } from "./types.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const HOLDER_A = "So11111111111111111111111111111111111111112";
const HOLDER_B = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

function mintInfo(overrides: Partial<TokenMintInfo> = {}): TokenMintInfo {
  return {
    mint: USDC,
    decimals: 6,
    supplyRaw: "1000",
    uiSupply: 0.001,
    mintAuthorityPresent: false,
    freezeAuthorityPresent: false,
    isInitialized: true,
    programLabel: "spl-token",
    source: "test",
    ...overrides,
  };
}

const baseRpc: SolanaRpcLike = {
  getVersion: async () => ({ "solana-core": "test" }),
  getSlot: async () => 1,
  getBalance: async () => 0,
  getParsedAccountInfo: async () => ({ context: { slot: 1 }, value: null }),
  getParsedTokenAccountsByOwner: async () => ({ context: { slot: 1 }, value: [] }),
};

describe("buildTokenHolderConcentration", () => {
  it("computes top1/top5 percentages with integer math (no float drift)", async () => {
    const rpc: SolanaRpcLike = {
      ...baseRpc,
      getTokenLargestAccounts: async () => ({
        context: { slot: 1 },
        value: [
          { address: new PublicKey(HOLDER_A), amount: "600", decimals: 6 },
          { address: new PublicKey(HOLDER_B), amount: "250", decimals: 6 },
        ],
      }),
    };
    const result = await buildTokenHolderConcentration(rpc, mintInfo());
    expect(result.top1Pct).toBe(60);
    expect(result.top5Pct).toBe(85);
    expect(result.accountsReturned).toBe(2);
    expect(result.topAccounts[0]?.pctOfSupply).toBe(60);
    expect(result.caveat).toBe(HOLDER_CONCENTRATION_CAVEAT);
  });

  it("re-sorts defensively and drops non-integer amounts", async () => {
    const rpc: SolanaRpcLike = {
      ...baseRpc,
      getTokenLargestAccounts: async () => ({
        context: { slot: 1 },
        value: [
          { address: new PublicKey(HOLDER_B), amount: "1", decimals: 6 },
          { address: new PublicKey(HOLDER_A), amount: "999", decimals: 6 },
          { address: new PublicKey(HOLDER_A), amount: "not-a-number", decimals: 6 },
        ],
      }),
    };
    const result = await buildTokenHolderConcentration(rpc, mintInfo());
    expect(result.accountsReturned).toBe(2);
    expect(result.top1Pct).toBe(99.9);
  });

  it("throws honestly when the seam lacks the method or the supply is unusable", async () => {
    await expect(buildTokenHolderConcentration(baseRpc, mintInfo())).rejects.toThrowError(/unavailable/);
    const rpc: SolanaRpcLike = {
      ...baseRpc,
      getTokenLargestAccounts: async () => ({ context: { slot: 1 }, value: [] }),
    };
    await expect(buildTokenHolderConcentration(rpc, mintInfo({ supplyRaw: "0" }))).rejects.toThrowError(/supply/);
  });
});

/** Borsh-encode a minimal valid metadata account for the parser. */
function encodeMetadata(opts: { name: string; symbol: string; isMutable: boolean }): Buffer {
  const str = (s: string, pad: number): Buffer => {
    const body = Buffer.alloc(pad);
    body.write(s, "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32LE(pad, 0);
    return Buffer.concat([len, body]);
  };
  return Buffer.concat([
    Buffer.from([4]), // key
    new PublicKey(HOLDER_A).toBuffer(), // update authority
    new PublicKey(USDC).toBuffer(), // mint
    str(opts.name, 32),
    str(opts.symbol, 10),
    str("https://example.invalid/meta.json", 200),
    Buffer.from([0, 0]), // seller fee bps
    Buffer.from([0]), // creators: none
    Buffer.from([0]), // primary sale happened
    Buffer.from([opts.isMutable ? 1 : 0]),
    Buffer.from([0, 0, 0]), // trailing optional fields (ignored)
  ]);
}

describe("parseMetadataAccount / buildTokenMetadataInfo", () => {
  it("derives the documented Metaplex PDA", () => {
    const address = metadataAddressForMint(USDC);
    expect(PublicKey.isOnCurve(address.toBytes())).toBe(false);
    expect(METAPLEX_TOKEN_METADATA_PROGRAM_ID.toBase58()).toBe("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
  });

  it("parses name/symbol/isMutable and trims NUL padding", async () => {
    const rpc: SolanaRpcLike = {
      ...baseRpc,
      getAccountInfo: async () => ({
        data: encodeMetadata({ name: "USD Coin", symbol: "USDC", isMutable: true }),
        executable: false,
        lamports: 1,
        owner: METAPLEX_TOKEN_METADATA_PROGRAM_ID,
      }),
    };
    const info = await buildTokenMetadataInfo(rpc, USDC);
    expect(info.metadataAccountFound).toBe(true);
    expect(info.isMutable).toBe(true);
    expect(info.nameLabel).toBe("USD Coin");
    expect(info.symbolLabel).toBe("USDC");
    expect(info.updateAuthority).toBe(HOLDER_A);
  });

  it("reports a missing account as not-found (never a guess)", async () => {
    const rpc: SolanaRpcLike = { ...baseRpc, getAccountInfo: async () => null };
    const info = await buildTokenMetadataInfo(rpc, USDC);
    expect(info.metadataAccountFound).toBe(false);
    expect(info.isMutable).toBeNull();
    expect(info.updateAuthority).toBeNull();
  });

  it("reports an unparsable account as found-but-null facts", async () => {
    const rpc: SolanaRpcLike = {
      ...baseRpc,
      getAccountInfo: async () => ({
        data: Buffer.from([1, 2, 3]),
        executable: false,
        lamports: 1,
        owner: METAPLEX_TOKEN_METADATA_PROGRAM_ID,
      }),
    };
    const info = await buildTokenMetadataInfo(rpc, USDC);
    expect(info.metadataAccountFound).toBe(true);
    expect(info.isMutable).toBeNull();
    expect(info.source).toContain("unparsable");
  });

  it("throws honestly when the seam lacks getAccountInfo", async () => {
    await expect(buildTokenMetadataInfo(baseRpc, USDC)).rejects.toThrowError(/unavailable/);
  });

  it("parser rejects truncated and implausible layouts", () => {
    expect(() => parseMetadataAccount(Buffer.from([4]))).toThrowError(/truncated/);
    const bogusLen = Buffer.concat([
      Buffer.from([4]),
      new PublicKey(HOLDER_A).toBuffer(),
      new PublicKey(USDC).toBuffer(),
      Buffer.from([0xff, 0xff, 0xff, 0xff]), // name length 4 GiB
    ]);
    expect(() => parseMetadataAccount(bogusLen)).toThrowError(/implausibly long/);
  });
});
