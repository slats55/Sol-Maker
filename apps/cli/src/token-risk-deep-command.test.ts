/**
 * Sprint 92 — `token:risk --deep` + `--price-impact-pct` (deep read-only risk intelligence).
 *
 * Pins:
 *   - WITHOUT --deep the report carries NO deep flags (byte-stable for existing fixtures);
 *   - WITH --deep over a client that supports the deep reads, the holder/metadata flags appear
 *     with their evidence;
 *   - WITH --deep over a client that LACKS the deep reads (older seam), each check degrades to
 *     its explicit unknown caution — never a silent pass;
 *   - --price-impact-pct feeds the liquidity flags and refuses garbage input.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PublicKeyInput,
  ReadOnlySolanaClient,
  TokenHolderConcentration,
  TokenMetadataInfo,
} from "@soulmaker/solana";
import { tokenRiskReport } from "./commands.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

async function withTmpAsync<T>(fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), "risk-deep-"));
  try {
    return await fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function baseClient(): ReadOnlySolanaClient {
  return {
    endpointHost: "rpc.example.com",
    getRpcHealth: async () => ({ ok: true, endpointHost: "rpc.example.com" }),
    getVersion: async () => ({ solanaCore: "test" }),
    getSolBalance: async () => ({ ownerBase58: USDC, lamports: 0, sol: 0 }),
    getTokenAccounts: async () => [],
    getTokenMintInfo: async (mint: PublicKeyInput) => ({
      mint: typeof mint === "string" ? mint : mint.toBase58(),
      decimals: 6,
      supplyRaw: "1000000000",
      uiSupply: 1000,
      mintAuthorityPresent: false,
      freezeAuthorityPresent: false,
      isInitialized: true,
      programLabel: "spl-token",
      source: "test",
    }),
  };
}

function deepClient(): ReadOnlySolanaClient {
  return {
    ...baseClient(),
    getTokenHolderConcentration: async (mint: PublicKeyInput): Promise<TokenHolderConcentration> => ({
      mint: typeof mint === "string" ? mint : mint.toBase58(),
      supplyRaw: "1000000000",
      accountsReturned: 2,
      topAccounts: [],
      top1Pct: 61.5,
      top5Pct: 88.2,
      source: "test",
      caveat: "test caveat",
    }),
    getTokenMetadataInfo: async (mint: PublicKeyInput): Promise<TokenMetadataInfo> => ({
      mint: typeof mint === "string" ? mint : mint.toBase58(),
      metadataAccountFound: true,
      isMutable: true,
      updateAuthority: USDC,
      nameLabel: "Test Token",
      symbolLabel: "TEST",
      source: "test",
    }),
  };
}

function ctx(tmp: string, client: ReadOnlySolanaClient) {
  writeFileSync(
    join(tmp, "soulmaker.config.json"),
    JSON.stringify({ mode: "WATCH_ONLY", rpcUrl: "https://rpc.example.com" }),
  );
  return { cwd: tmp, env: {}, createClient: () => client, now: () => "2026-06-12T00:00:00.000Z" };
}

describe("token:risk --deep", () => {
  it("WITHOUT --deep: no deep flag appears (pre-S92 reports stay stable)", async () => {
    await withTmpAsync(async (tmp) => {
      const out = await tokenRiskReport(USDC, ctx(tmp, deepClient()), { json: true });
      const report = JSON.parse(out) as { flags: Array<{ id: string }> };
      expect(report.flags.some((f) => /holder-concentration|metadata-|liquidity-/.test(f.id))).toBe(false);
    });
  });

  it("WITH --deep over a deep-capable client: holder + metadata flags appear with evidence", async () => {
    await withTmpAsync(async (tmp) => {
      const out = await tokenRiskReport(USDC, ctx(tmp, deepClient()), { json: true, deep: true });
      const report = JSON.parse(out) as { flags: Array<{ id: string; evidence?: Record<string, unknown> }> };
      const extreme = report.flags.find((f) => f.id === "holder-concentration-extreme");
      expect(extreme?.evidence?.topHolderPct).toBe(61.5);
      expect(report.flags.some((f) => f.id === "metadata-mutable")).toBe(true);
    });
  });

  it("WITH --deep over an older client lacking the deep reads: explicit unknown cautions", async () => {
    await withTmpAsync(async (tmp) => {
      const out = await tokenRiskReport(USDC, ctx(tmp, baseClient()), { json: true, deep: true });
      const report = JSON.parse(out) as { flags: Array<{ id: string }> };
      expect(report.flags.some((f) => f.id === "holder-concentration-unknown")).toBe(true);
      expect(report.flags.some((f) => f.id === "metadata-unavailable")).toBe(true);
    });
  });

  it("a deep read that THROWS degrades to the unknown caution (per-check isolation)", async () => {
    await withTmpAsync(async (tmp) => {
      const flaky: ReadOnlySolanaClient = {
        ...deepClient(),
        getTokenHolderConcentration: async () => {
          throw new Error("rpc exploded");
        },
      };
      const out = await tokenRiskReport(USDC, ctx(tmp, flaky), { json: true, deep: true });
      const report = JSON.parse(out) as { flags: Array<{ id: string }> };
      expect(report.flags.some((f) => f.id === "holder-concentration-unknown")).toBe(true);
      // The other deep check still ran.
      expect(report.flags.some((f) => f.id === "metadata-mutable")).toBe(true);
    });
  });

  it("--price-impact-pct feeds the liquidity flags and refuses garbage", async () => {
    await withTmpAsync(async (tmp) => {
      const out = await tokenRiskReport(USDC, ctx(tmp, baseClient()), { json: true, priceImpactPct: "12.5" });
      const report = JSON.parse(out) as { flags: Array<{ id: string }> };
      expect(report.flags.some((f) => f.id === "liquidity-very-thin")).toBe(true);

      const refused = await tokenRiskReport(USDC, ctx(tmp, baseClient()), { priceImpactPct: "not-a-number" });
      expect(refused).toMatch(/^Refusing: --price-impact-pct/);
    });
  });
});
