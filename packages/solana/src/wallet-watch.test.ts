import { describe, it, expect } from "vitest";
import {
  buildWalletWatchReport,
  formatWalletWatchReport,
} from "./wallet-watch.js";
import { InvalidPublicKeyError } from "./public-key.js";
import type { ReadOnlySolanaClient } from "./types.js";

const OWNER = "So11111111111111111111111111111111111111112";
const FIXED_TIME = "2026-01-01T00:00:00.000Z";

function fakeClient(
  overrides: Partial<ReadOnlySolanaClient> = {},
): ReadOnlySolanaClient {
  const base: ReadOnlySolanaClient = {
    endpointHost: "rpc.example.com",
    getRpcHealth: async () => ({ ok: true, endpointHost: "rpc.example.com" }),
    getVersion: async () => ({ solanaCore: "1.18.22" }),
    getSolBalance: async () => ({
      ownerBase58: OWNER,
      lamports: 1_500_000_000,
      sol: 1.5,
    }),
    getTokenAccounts: async () => [
      {
        tokenAccount: "Tok1111111111111111111111111111111111111111",
        mint: "Min1111111111111111111111111111111111111111",
        programLabel: "spl-token",
        amountRaw: "1000",
        decimals: 3,
        uiAmount: 1,
      },
    ],
    getTokenMintInfo: async () => {
      throw new Error("not used");
    },
  };
  return { ...base, ...overrides };
}

describe("buildWalletWatchReport", () => {
  it("composes balance and token accounts with a deterministic timestamp", async () => {
    const report = await buildWalletWatchReport(fakeClient(), OWNER, {
      now: () => FIXED_TIME,
      capabilityNote: "WATCH_ONLY",
    });
    expect(report.owner).toBe(OWNER);
    expect(report.solBalance.sol).toBe(1.5);
    expect(report.tokenAccountCount).toBe(1);
    expect(report.timestamp).toBe(FIXED_TIME);
    expect(report.endpointHost).toBe("rpc.example.com");
    expect(report.capabilityNote).toBe("WATCH_ONLY");
  });

  it("rejects an invalid owner public key before any RPC call", async () => {
    let balanceCalled = false;
    const client = fakeClient({
      getSolBalance: async () => {
        balanceCalled = true;
        return { ownerBase58: "x", lamports: 0, sol: 0 };
      },
    });
    await expect(buildWalletWatchReport(client, "not-valid")).rejects.toThrow(
      InvalidPublicKeyError,
    );
    expect(balanceCalled).toBe(false);
  });
});

describe("formatWalletWatchReport", () => {
  it("renders a READ-ONLY report containing the owner", async () => {
    const report = await buildWalletWatchReport(fakeClient(), OWNER, {
      now: () => FIXED_TIME,
    });
    const text = formatWalletWatchReport(report);
    expect(text).toContain("Wallet watch (READ-ONLY)");
    expect(text).toContain(OWNER);
    expect(text).toContain("no transaction was built, signed, or sent");
  });
});
