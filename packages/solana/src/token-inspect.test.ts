import { describe, it, expect } from "vitest";
import {
  buildTokenInspectReport,
  formatTokenInspectReport,
} from "./token-inspect.js";
import type { ReadOnlySolanaClient, TokenMintInfo } from "./types.js";

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const FIXED_TIME = "2026-01-01T00:00:00.000Z";

function fakeClient(mintInfo: TokenMintInfo): ReadOnlySolanaClient {
  return {
    endpointHost: "rpc.example.com",
    getRpcHealth: async () => ({ ok: true, endpointHost: "rpc.example.com" }),
    getVersion: async () => ({ solanaCore: "1.18.22" }),
    getSolBalance: async () => ({ ownerBase58: MINT, lamports: 0, sol: 0 }),
    getTokenAccounts: async () => [],
    getTokenMintInfo: async () => mintInfo,
  };
}

const RENOUNCED: TokenMintInfo = {
  mint: MINT,
  decimals: 6,
  supplyRaw: "1000000000000",
  uiSupply: 1_000_000,
  mintAuthorityPresent: false,
  freezeAuthorityPresent: false,
  isInitialized: true,
  programLabel: "spl-token",
  source: "getParsedAccountInfo(jsonParsed)",
};

describe("buildTokenInspectReport", () => {
  it("wraps mint info with a timestamp and an explicit non-recommendation note", async () => {
    const report = await buildTokenInspectReport(fakeClient(RENOUNCED), MINT, {
      now: () => FIXED_TIME,
    });
    expect(report.mint).toBe(MINT);
    expect(report.timestamp).toBe(FIXED_TIME);
    expect(report.note).toMatch(/not a buy recommendation/i);
    expect(report.mintAuthorityPresent).toBe(false);
  });
});

describe("formatTokenInspectReport", () => {
  it("warns it is inspection, not a buy recommendation", async () => {
    const report = await buildTokenInspectReport(fakeClient(RENOUNCED), MINT, {
      now: () => FIXED_TIME,
    });
    const text = formatTokenInspectReport(report);
    expect(text).toContain("Token mint inspection (READ-ONLY)");
    expect(text).toMatch(/NOT a buy recommendation/i);
    expect(text).toContain("renounced");
  });

  it("flags a present mint authority as a dilution/rug risk", async () => {
    const risky: TokenMintInfo = { ...RENOUNCED, mintAuthorityPresent: true };
    const report = await buildTokenInspectReport(fakeClient(risky), MINT, {
      now: () => FIXED_TIME,
    });
    expect(formatTokenInspectReport(report)).toMatch(/PRESENT.*mint/i);
  });
});
