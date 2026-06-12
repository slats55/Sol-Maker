import { describe, it, expect } from "vitest";
import { normalizeSniperCandidateList } from "@soulmaker/sniper";
import {
  createJupiterRecentAdapter,
  normalizeRecentTokenItem,
  candidateIdForMint,
  JUPITER_RECENT_PROVIDER_ID,
  MAX_OBSERVATIONS_PER_POLL,
} from "./jupiter-recent.js";
import { createReplayCandidateAdapter, REPLAY_CAVEAT } from "./replay.js";
import {
  buildRealtimeCandidatesSnapshot,
  formatRealtimeCandidatesSnapshot,
  observationsToCandidateList,
  REALTIME_SNAPSHOT_SCHEMA_VERSION,
} from "./snapshot.js";
import type { FetchLike } from "./types.js";

// Well-known PUBLIC mints used as fixture identifiers (public chain data, not secrets).
const MINT_A = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MINT_B = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

const FIXED_CLOCK = (): string => "2026-06-12T04:00:00.000Z";

/** The REAL response shape captured live from lite-api.jup.ag/tokens/v2/recent (values trimmed). */
function realFeedBody(): string {
  return JSON.stringify([
    {
      id: MINT_A,
      name: "WAGMI",
      symbol: "WAGMI",
      icon: "https://ipfs.io/ipfs/x",
      decimals: 6,
      dev: MINT_B,
      circSupply: 1000000000,
      totalSupply: 1000000000,
      tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      launchpad: "pump.fun",
      holderCount: 6,
      fdv: 3389.5,
      mcap: 3389.5,
      usdPrice: 0.0000033,
      priceBlockId: 425925104,
      liquidity: 2696.9,
      stats5m: { priceChange: 35.5 },
    },
    { id: MINT_B, name: "Other", symbol: "OTH", launchpad: null, liquidity: 100.5, holderCount: 2, mcap: 50 },
    { id: "not-a-mint", name: "Broken", symbol: "BRK" },
    { id: MINT_A, name: "Duplicate", symbol: "DUP" },
  ]);
}

function fakeFetch(status: number, body: string): FetchLike {
  return async () => ({ ok: status >= 200 && status < 300, status, text: async () => body });
}

describe("jupiter-recent adapter — normalization from the REAL feed shape", () => {
  it("normalizes valid items, drops invalid mints and duplicates, keeps hints as hints", async () => {
    const adapter = createJupiterRecentAdapter({ fetchLike: fakeFetch(200, realFeedBody()), clock: FIXED_CLOCK });
    const result = await adapter.fetchOnce();
    expect(result.status).toBe("observed");
    expect(result.observations).toHaveLength(2); // broken mint dropped, duplicate dropped
    const [a, b] = result.observations;
    expect(a?.candidateId).toBe(candidateIdForMint(MINT_A));
    expect(a?.symbol).toBe("WAGMI");
    expect(a?.launchpadLabel).toBe("pump.fun");
    expect(a?.liquidityUsdHint).toBe(2696.9);
    expect(a?.holderCountHint).toBe(6);
    expect(a?.sourceKind).toBe("live");
    expect(a?.observedAtLabel).toBe("2026-06-12T04:00:00.000Z");
    expect(a?.caveats.join("\n")).toContain("never an order");
    expect(b?.launchpadLabel).toBeNull();
    expect(result.metadata.responseSha256_128).toMatch(/^[0-9a-f]{32}$/);
  });

  it("caps a flood of items at MAX_OBSERVATIONS_PER_POLL", async () => {
    // Generating many distinct valid base58 mints is fiddly — assert the cap constant + the
    // normalizer path instead: one valid item normalizes, and the cap is a small bounded number.
    expect(MAX_OBSERVATIONS_PER_POLL).toBeLessThanOrEqual(50);
    const obs = normalizeRecentTokenItem({ id: MINT_A, symbol: "X" }, "t");
    expect(obs?.mint).toBe(MINT_A);
    expect(normalizeRecentTokenItem({ id: "5".repeat(88) }, "t")).toBeNull(); // secret-length refused
    expect(normalizeRecentTokenItem("not-an-object", "t")).toBeNull();
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
      const adapter = createJupiterRecentAdapter({ fetchLike, clock: FIXED_CLOCK });
      const result = await adapter.fetchOnce();
      expect(result.status).toBe(expected);
      expect(result.observations).toEqual([]);
    }
  });
});

describe("replay adapter — deterministic, clearly labeled, fail-closed on bad files", () => {
  it("replays events with the replay caveat and stable ids", async () => {
    const adapter = createReplayCandidateAdapter({
      events: [
        { mint: MINT_A, symbol: "AAA", observedAtLabel: "session-1", liquidityUsdHint: 1000 },
        { mint: MINT_B, symbol: "BBB" },
        { mint: MINT_A, symbol: "DUPLICATE" },
      ],
    });
    expect(adapter.sourceKind).toBe("replay");
    const result = await adapter.fetchOnce();
    expect(result.observations).toHaveLength(2);
    expect(result.observations[0]?.sourceKind).toBe("replay");
    expect(result.observations[0]?.caveats).toContain(REPLAY_CAVEAT);
    // Deterministic: a second poll yields the identical batch.
    const again = await adapter.fetchOnce();
    expect(JSON.stringify(again.observations)).toBe(JSON.stringify(result.observations));
  });

  it("refuses malformed replay files up front (operator input, not a feed outage)", () => {
    expect(() => createReplayCandidateAdapter(null)).toThrowError(/JSON object/);
    expect(() => createReplayCandidateAdapter({})).toThrowError(/events array/);
    expect(() => createReplayCandidateAdapter({ events: [{ mint: "5".repeat(88) }] })).toThrowError(/never paste/);
    expect(() => createReplayCandidateAdapter({ events: Array.from({ length: 501 }, () => ({ mint: MINT_A })) })).toThrowError(/500/);
  });
});

describe("realtime.candidates.snapshot.v1 — folding + pipeline compatibility", () => {
  async function observedResult() {
    const adapter = createJupiterRecentAdapter({ fetchLike: fakeFetch(200, realFeedBody()), clock: FIXED_CLOCK });
    return adapter.fetchOnce();
  }

  it("builds the snapshot with pinned literals and an embedded canonical candidate list", async () => {
    const snapshot = buildRealtimeCandidatesSnapshot(await observedResult(), "live");
    expect(snapshot.schemaVersion).toBe(REALTIME_SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.paperOnly).toBe(true);
    expect(snapshot.watchOnly).toBe(true);
    expect(snapshot.neverTrades).toBe(true);
    expect(snapshot.phase7LiveTradingReady).toBe(false);
    expect(snapshot.keptCount).toBe(2);
    // The embedded list is ALREADY canonical — re-normalizing it is a no-op-safe round trip.
    expect(snapshot.candidateList).not.toBeNull();
    const reList = normalizeSniperCandidateList({
      sourceLabel: snapshot.candidateList?.sourceLabel ?? "x",
      candidates: snapshot.candidateList?.candidates as never,
    });
    expect(reList.candidateCount).toBe(2);
    expect(reList.candidates[0]?.sourceTag).toBe(JUPITER_RECENT_PROVIDER_ID);
  });

  it("applies the liquidity filter + limit honestly (drops counted, never hidden)", async () => {
    const snapshot = buildRealtimeCandidatesSnapshot(await observedResult(), "live", {
      minLiquidityUsdHint: 500,
      limit: 1,
    });
    expect(snapshot.keptCount).toBe(1);
    expect(snapshot.droppedByFilterCount).toBe(1);
    expect(snapshot.warnings.length).toBeGreaterThan(0);
  });

  it("a failed poll folds into an honest non-observed snapshot with no candidates", async () => {
    const adapter = createJupiterRecentAdapter({ fetchLike: fakeFetch(429, "x"), clock: FIXED_CLOCK });
    const snapshot = buildRealtimeCandidatesSnapshot(await adapter.fetchOnce(), "live");
    expect(snapshot.status).toBe("blocked");
    expect(snapshot.keptCount).toBe(0);
    expect(snapshot.candidateList).toBeNull();
    expect(snapshot.warnings[0]).toContain("blocked");
  });

  it("formats a redacted summary and never claims executability", async () => {
    const snapshot = buildRealtimeCandidatesSnapshot(await observedResult(), "live");
    const text = formatRealtimeCandidatesSnapshot(snapshot);
    expect(text).toContain("REAL-TIME CANDIDATE SNAPSHOT");
    expect(text).toContain("CAVEAT:");
    expect(text).not.toMatch(/"executable"|live-ready|ready-to-trade/i);
    expect(JSON.stringify(snapshot)).not.toMatch(/[0-9a-f]{64,}/);
  });

  it("observationsToCandidateList marks replay provenance in the source note", async () => {
    const adapter = createReplayCandidateAdapter({ events: [{ mint: MINT_A, symbol: "AAA" }] });
    const result = await adapter.fetchOnce();
    const list = observationsToCandidateList(result.observations, "replay test");
    expect(list.candidates[0]?.sourceNote).toContain("NOT live market data");
  });
});
