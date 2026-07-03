import { describe, it, expect } from "vitest";
import {
  createDexscreenerAdapter,
  dexscreenerCandidateIdForMint,
  normalizeTokenProfileItem,
  DEXSCREENER_PROVIDER_ID,
  DEXSCREENER_MAX_OBSERVATIONS_PER_POLL,
} from "./dexscreener.js";
import type { FetchLike } from "./types.js";

// Well-known PUBLIC mints used as fixture identifiers (public chain data, not secrets).
const MINT_A = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MINT_B = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

const FIXED_CLOCK = (): string => "2026-07-02T04:00:00.000Z";

/** The REAL response shape of GET /token-profiles/latest/v1 (values trimmed). */
function realProfilesBody(): string {
  return JSON.stringify([
    {
      url: "https://dexscreener.com/solana/x",
      chainId: "solana",
      tokenAddress: MINT_A,
      icon: "https://cdn.dexscreener.com/x.png",
      header: "https://cdn.dexscreener.com/y.png",
      description: "A memecoin about something",
      links: [{ type: "twitter", url: "https://x.com/x" }],
    },
    { url: "https://dexscreener.com/ethereum/y", chainId: "ethereum", tokenAddress: "0xabc" },
    { url: "https://dexscreener.com/solana/z", chainId: "solana", tokenAddress: "not-a-mint" },
    { url: "https://dexscreener.com/solana/b", chainId: "solana", tokenAddress: MINT_B },
    { url: "https://dexscreener.com/solana/dup", chainId: "solana", tokenAddress: MINT_A },
  ]);
}

function fakeFetch(status: number, body: string): FetchLike {
  return async () => ({ ok: status >= 200 && status < 300, status, text: async () => body });
}

describe("dexscreener adapter — normalization from the REAL profiles shape", () => {
  it("keeps only valid solana entries, drops other chains / bad mints / duplicates", async () => {
    const adapter = createDexscreenerAdapter({ fetchLike: fakeFetch(200, realProfilesBody()), clock: FIXED_CLOCK });
    const result = await adapter.fetchOnce();
    expect(result.status).toBe("observed");
    expect(result.observations).toHaveLength(2);
    const [a, b] = result.observations;
    expect(a?.mint).toBe(MINT_A);
    expect(a?.candidateId).toBe(dexscreenerCandidateIdForMint(MINT_A));
    expect(a?.sourceProviderId).toBe(DEXSCREENER_PROVIDER_ID);
    expect(a?.sourceKind).toBe("live");
    expect(b?.mint).toBe(MINT_B);
    expect(result.metadata.responseSha256_128).toMatch(/^[0-9a-f]{32}$/);
  });

  it("carries NO market hints — the profiles feed has none, and none are invented", () => {
    const obs = normalizeTokenProfileItem({ chainId: "solana", tokenAddress: MINT_A, description: "d" }, "t");
    expect(obs?.liquidityUsdHint).toBeNull();
    expect(obs?.marketCapUsdHint).toBeNull();
    expect(obs?.holderCountHint).toBeNull();
    expect(obs?.symbol).toBeNull();
  });

  it("refuses secret-length token addresses and non-objects", () => {
    expect(normalizeTokenProfileItem({ chainId: "solana", tokenAddress: "5".repeat(88) }, "t")).toBeNull();
    expect(normalizeTokenProfileItem("nope", "t")).toBeNull();
    expect(normalizeTokenProfileItem({ chainId: "solana" }, "t")).toBeNull();
  });

  it("maps provider failures onto the closed status set (never throws)", async () => {
    const cases: Array<[FetchLike, string]> = [
      [async () => { throw new Error("ENOTFOUND"); }, "unavailable"],
      [fakeFetch(429, "rate limited"), "blocked"],
      [fakeFetch(500, "boom"), "error"],
      [fakeFetch(200, "<html>"), "unsupported"],
      [fakeFetch(200, JSON.stringify({ not: "an array" })), "unsupported"],
    ];
    for (const [fetchLike, expected] of cases) {
      const adapter = createDexscreenerAdapter({ fetchLike, clock: FIXED_CLOCK });
      const result = await adapter.fetchOnce();
      expect(result.status).toBe(expected);
      expect(result.observations).toEqual([]);
    }
  });

  it("bounds one poll", () => {
    expect(DEXSCREENER_MAX_OBSERVATIONS_PER_POLL).toBeLessThanOrEqual(50);
  });
});
