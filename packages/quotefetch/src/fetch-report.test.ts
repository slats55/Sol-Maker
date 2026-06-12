import { describe, it, expect } from "vitest";
import { normalizeSniperCandidateList } from "@soulmaker/sniper";
import { normalizeRouteQuotePrepared } from "@soulmaker/routequote";
import { createJupiterQuoteAdapter } from "./jupiter.js";
import {
  fetchQuotesForCandidates,
  formatRouteQuoteFetchReport,
  ROUTE_QUOTE_FETCH_REPORT_SCHEMA_VERSION,
} from "./fetch-report.js";
import type { FetchLike } from "./types.js";

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
// A second well-known PUBLIC mint (mainnet USDT) for multi-candidate batches.
const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

const FIXED_CLOCK = (): string => "2026-06-12T03:00:00.000Z";

function quoteBodyFor(outputMint: string): string {
  return JSON.stringify({
    inputMint: WSOL,
    inAmount: "10000000",
    outputMint,
    outAmount: "665932",
    otherAmountThreshold: "662603",
    priceImpactPct: "0.01",
    routePlan: [{ swapInfo: { label: "TestVenue" } }],
    contextSlot: 1,
  });
}

/** Succeeds for USDC, rate-limits USDT — exercises mixed outcomes in one pass. */
const mixedFetch: FetchLike = async (url: string) => {
  if (url.includes(USDT)) return { ok: false, status: 429, text: async () => "rate limited" };
  return { ok: true, status: 200, text: async () => quoteBodyFor(USDC) };
};

const list = normalizeSniperCandidateList({
  sourceLabel: "fetch-report-test",
  candidates: [
    { candidateId: "c-usdc", mint: USDC },
    { candidateId: "c-usdt", mint: USDT },
    { candidateId: "c-usdc-again", mint: USDC },
  ],
});

describe("routequote.fetch.report.v1 — building over a candidate list", () => {
  it("folds mixed outcomes with honest tallies; duplicate mints fetch ONCE", async () => {
    let calls = 0;
    const countingFetch: FetchLike = async (url) => {
      calls += 1;
      return mixedFetch(url);
    };
    const adapter = createJupiterQuoteAdapter({ fetchLike: countingFetch, clock: FIXED_CLOCK });
    const report = await fetchQuotesForCandidates(adapter, list, {
      inputMint: WSOL,
      amountRaw: "10000000",
      slippageBps: 50,
      candidateListRef: "candidates.json",
    });

    expect(report.schemaVersion).toBe(ROUTE_QUOTE_FETCH_REPORT_SCHEMA_VERSION);
    expect(report.entryCount).toBe(3);
    expect(report.observedCount).toBe(2); // both USDC candidates share the observed quote
    expect(report.blockedCount).toBe(1);
    expect(report.unavailableCount).toBe(0);
    expect(calls).toBe(2); // duplicate mint reused — exactly two provider calls
    expect(report.warnings.some((w) => w.includes("c-usdt"))).toBe(true);
    expect(report.fetchedAt).toBe("2026-06-12T03:00:00.000Z");
    expect(report.candidateListRef).toBe("candidates.json");
  });

  it("pins the never-executable literals and mandatory caveats", async () => {
    const adapter = createJupiterQuoteAdapter({ fetchLike: mixedFetch, clock: FIXED_CLOCK });
    const report = await fetchQuotesForCandidates(adapter, list, {
      inputMint: WSOL,
      amountRaw: "10000000",
      slippageBps: 50,
    });
    expect(report.paperOnly).toBe(true);
    expect(report.readOnly).toBe(true);
    expect(report.notExecutable).toBe(true);
    expect(report.neverSigns).toBe(true);
    expect(report.neverSends).toBe(true);
    expect(report.phase7LiveTradingReady).toBe(false);
    expect(report.caveats.length).toBeGreaterThanOrEqual(7);
    expect(report.caveats.join("\n")).toContain("expires within seconds");
    // The truncated digest convention (S88): 32 hex chars, never a full 64-hex key-shaped blob.
    for (const entry of report.entries) {
      if (entry.metadata.responseSha256_128 !== null) {
        expect(entry.metadata.responseSha256_128).toMatch(/^[0-9a-f]{32}$/);
      }
    }
    expect(JSON.stringify(report)).not.toMatch(/[0-9a-f]{64,}/);
  });

  it("one candidate's failure never aborts the batch (per-candidate isolation)", async () => {
    const explodingFetch: FetchLike = async (url) => {
      if (url.includes(USDT)) throw new Error("socket hang up");
      return { ok: true, status: 200, text: async () => quoteBodyFor(USDC) };
    };
    const adapter = createJupiterQuoteAdapter({ fetchLike: explodingFetch, clock: FIXED_CLOCK });
    const report = await fetchQuotesForCandidates(adapter, list, {
      inputMint: WSOL,
      amountRaw: "10000000",
      slippageBps: 50,
    });
    expect(report.entryCount).toBe(3);
    expect(report.unavailableCount).toBe(1);
    expect(report.observedCount).toBe(2);
  });

  it("the report's observations feed the S91 prepare step directly (downstream compatibility)", async () => {
    const adapter = createJupiterQuoteAdapter({ fetchLike: mixedFetch, clock: FIXED_CLOCK });
    const report = await fetchQuotesForCandidates(adapter, list, {
      inputMint: WSOL,
      amountRaw: "10000000",
      slippageBps: 50,
    });
    // De-duplicate by mint exactly as an operator writing files per mint would.
    const byMint = new Map(report.entries.map((e) => [e.mint, e.observation]));
    const prepared = normalizeRouteQuotePrepared({
      candidateList: list,
      observations: [...byMint.values()],
      sourceLabel: "prepared from fetched quotes (test)",
    });
    expect(prepared.entryCount).toBe(3);
    expect(prepared.observedCount).toBe(2);
    expect(prepared.blockedCount).toBe(1);
  });
});

describe("routequote.fetch.report.v1 — formatting", () => {
  it("renders a redacted human summary with statuses, caveats, and warnings", async () => {
    const adapter = createJupiterQuoteAdapter({ fetchLike: mixedFetch, clock: FIXED_CLOCK });
    const report = await fetchQuotesForCandidates(adapter, list, {
      inputMint: WSOL,
      amountRaw: "10000000",
      slippageBps: 50,
    });
    const text = formatRouteQuoteFetchReport(report);
    expect(text).toContain("READ-ONLY ROUTE QUOTE FETCH REPORT");
    expect(text).toContain("c-usdc [quote-observed]");
    expect(text).toContain("c-usdt [blocked]");
    expect(text).toContain("CAVEAT:");
    expect(text).not.toMatch(/"executable"|live-ready/i);
  });
});
