import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { createClientFromRpc, endpointHostOf } from "./rpc-client.js";
import type {
  ParsedTokenAccount,
  SolanaRpcLike,
} from "./types.js";

// Deterministic valid public keys from fixed 32-byte buffers.
const pk = (fill: number): PublicKey =>
  new PublicKey(new Uint8Array(32).fill(fill));
const OWNER = pk(1);
const MINT = pk(2);
const TOKEN_ACCT = pk(9);

interface RpcCtx<T> {
  context: { slot: number };
  value: T;
}
const ctx = <T>(value: T): RpcCtx<T> => ({ context: { slot: 1000 }, value });

function mintAccount(
  info: {
    decimals: number;
    mintAuthority: string | null;
    freezeAuthority: string | null;
    supply: string;
    isInitialized: boolean;
  },
  owner: PublicKey = TOKEN_PROGRAM_ID,
) {
  return {
    executable: false,
    owner,
    lamports: 1_000_000,
    rentEpoch: 0,
    data: { program: "spl-token", parsed: { type: "mint", info }, space: 82 },
  };
}

function tokenAccountEntry(): ParsedTokenAccount {
  return {
    pubkey: TOKEN_ACCT,
    account: {
      executable: false,
      owner: TOKEN_PROGRAM_ID,
      lamports: 2_039_280,
      rentEpoch: 0,
      data: {
        program: "spl-token",
        parsed: {
          type: "account",
          info: {
            mint: MINT.toBase58(),
            tokenAmount: { amount: "5000000", decimals: 6, uiAmount: 5 },
          },
        },
        space: 165,
      },
    },
  } as unknown as ParsedTokenAccount;
}

function makeFakeRpc(overrides: Partial<SolanaRpcLike> = {}): SolanaRpcLike {
  const base: SolanaRpcLike = {
    getVersion: async () => ({ "solana-core": "1.18.22", "feature-set": 1234 }),
    getSlot: async () => 1000,
    getBalance: async () => 2_000_000_000,
    getParsedAccountInfo: async () =>
      ctx(
        mintAccount({
          decimals: 6,
          mintAuthority: null,
          freezeAuthority: null,
          supply: "1000000000",
          isInitialized: true,
        }),
      ),
    getParsedTokenAccountsByOwner: async (_owner, filter) => {
      if (filter.programId.equals(TOKEN_PROGRAM_ID)) {
        return ctx([tokenAccountEntry()]);
      }
      return ctx([]);
    },
  };
  return { ...base, ...overrides };
}

const client = (rpc: SolanaRpcLike = makeFakeRpc()) =>
  createClientFromRpc(rpc, { endpointHost: "rpc.example.com" });

describe("endpointHostOf", () => {
  it("strips path and api-key query, keeping only the host", () => {
    const host = endpointHostOf("https://mainnet.example.com/v2/?api-key=SECRET");
    expect(host).toBe("mainnet.example.com");
    expect(host).not.toContain("SECRET");
  });
});

describe("read-only client surface", () => {
  it("exposes NO send/sign/airdrop/secret method", () => {
    const c = client();
    for (const key of Object.keys(c)) {
      expect(key).not.toMatch(/sign|send|airdrop|sweep|secret|keypair|transfer/i);
    }
    expect("sendTransaction" in c).toBe(false);
    expect("signTransaction" in c).toBe(false);
    expect("sendRawTransaction" in c).toBe(false);
    expect("requestAirdrop" in c).toBe(false);
  });

  it("is frozen (cannot have a send method bolted on later)", () => {
    const c = client();
    expect(Object.isFrozen(c)).toBe(true);
  });
});

describe("getVersion / getRpcHealth", () => {
  it("returns the solana-core version", async () => {
    expect(await client().getVersion()).toEqual({
      solanaCore: "1.18.22",
      featureSet: 1234,
    });
  });

  it("reports healthy with version + slot", async () => {
    const health = await client().getRpcHealth();
    expect(health.ok).toBe(true);
    expect(health.solanaCore).toBe("1.18.22");
    expect(health.slot).toBe(1000);
  });

  it("reports unhealthy and redacts secrets in the error", async () => {
    const rpc = makeFakeRpc({
      getVersion: async () => {
        throw new Error("connect failed https://x/?api-key=SUPERSECRET");
      },
    });
    const health = await client(rpc).getRpcHealth();
    expect(health.ok).toBe(false);
    expect(health.error).toBeDefined();
    expect(health.error).not.toContain("SUPERSECRET");
  });
});

describe("getSolBalance", () => {
  it("converts lamports to SOL", async () => {
    const bal = await client().getSolBalance(OWNER);
    expect(bal.lamports).toBe(2_000_000_000);
    expect(bal.sol).toBe(2);
    expect(bal.ownerBase58).toBe(OWNER.toBase58());
  });

  it("validates a string owner and rejects secret-length input", async () => {
    await expect(client().getSolBalance("5".repeat(88))).rejects.toThrow(
      /never paste a private key/i,
    );
  });
});

describe("getTokenAccounts", () => {
  it("merges token programs and maps fields", async () => {
    const accts = await client().getTokenAccounts(OWNER);
    expect(accts).toHaveLength(1);
    expect(accts[0]).toMatchObject({
      mint: MINT.toBase58(),
      programLabel: "spl-token",
      amountRaw: "5000000",
      decimals: 6,
      uiAmount: 5,
    });
  });

  it("includes Token-2022 accounts when present", async () => {
    const rpc = makeFakeRpc({
      getParsedTokenAccountsByOwner: async (_owner, filter) =>
        filter.programId.equals(TOKEN_2022_PROGRAM_ID)
          ? ctx([tokenAccountEntry()])
          : ctx([]),
    });
    const accts = await client(rpc).getTokenAccounts(OWNER);
    expect(accts).toHaveLength(1);
    expect(accts[0]?.programLabel).toBe("spl-token-2022");
  });
});

describe("getTokenMintInfo", () => {
  it("reports renounced authorities", async () => {
    const info = await client().getTokenMintInfo(MINT);
    expect(info.mintAuthorityPresent).toBe(false);
    expect(info.freezeAuthorityPresent).toBe(false);
    expect(info.isInitialized).toBe(true);
    expect(info.decimals).toBe(6);
    expect(info.supplyRaw).toBe("1000000000");
    expect(info.programLabel).toBe("spl-token");
  });

  it("flags present mint and freeze authorities", async () => {
    const rpc = makeFakeRpc({
      getParsedAccountInfo: async () =>
        ctx(
          mintAccount({
            decimals: 9,
            mintAuthority: OWNER.toBase58(),
            freezeAuthority: OWNER.toBase58(),
            supply: "42",
            isInitialized: true,
          }),
        ),
    });
    const info = await client(rpc).getTokenMintInfo(MINT);
    expect(info.mintAuthorityPresent).toBe(true);
    expect(info.freezeAuthorityPresent).toBe(true);
  });

  it("throws when the account is missing", async () => {
    const rpc = makeFakeRpc({ getParsedAccountInfo: async () => ctx(null) });
    await expect(client(rpc).getTokenMintInfo(MINT)).rejects.toThrow(/not found/);
  });

  it("throws when the account is not a mint", async () => {
    const rpc = makeFakeRpc({
      getParsedAccountInfo: async () =>
        ctx({
          executable: false,
          owner: TOKEN_PROGRAM_ID,
          lamports: 1,
          rentEpoch: 0,
          data: { program: "spl-token", parsed: { type: "account", info: {} }, space: 165 },
        }),
    });
    await expect(client(rpc).getTokenMintInfo(MINT)).rejects.toThrow(/not a mint/);
  });
});
