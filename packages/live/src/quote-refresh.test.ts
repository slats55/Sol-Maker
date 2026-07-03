import { describe, expect, it } from "vitest";

import { quoteAgeFresh, refreshQuotes } from "./quote-refresh.js";
import type { QuoteProviderObservation } from "./quote-refresh.js";

const MINT = "So11111111111111111111111111111111111111112";
const NOW = 1_000_000;

function obs(over: Partial<QuoteProviderObservation> = {}): QuoteProviderObservation {
  return {
    provider: "jupiter",
    role: "primary",
    outcome: "observed",
    outAmountRaw: "1000",
    priceImpactPct: 0.5,
    slippageBps: 50,
    routeLabels: ["Orca"],
    observedAtMs: NOW - 1_000,
    latencyMs: 42,
    ...over,
  };
}

const CAPS = { ttlMs: 8_000, maxSlippageBps: 100, maxPriceImpactPct: 3 } as const;

describe("quote refresh — TTL", () => {
  it("quoteAgeFresh is true within TTL, false beyond, false for future timestamps", () => {
    expect(quoteAgeFresh(NOW - 5_000, NOW, 8_000)).toBe(true);
    expect(quoteAgeFresh(NOW - 9_000, NOW, 8_000)).toBe(false);
    expect(quoteAgeFresh(NOW + 1_000, NOW, 8_000)).toBe(false);
  });
});

describe("quote refresh — selection + provider redundancy", () => {
  it("selects the primary when usable", () => {
    const r = refreshQuotes({ mint: MINT, observations: [obs(), obs({ provider: "dexscreener", role: "fallback" })], nowMs: NOW, ...CAPS });
    expect(r.selected?.provider).toBe("jupiter");
    expect(r.isUsable).toBe(true);
    expect(r.failClosed).toBe(false);
    expect(r.latencyMs).toBe(42);
  });

  it("falls back when the primary is unavailable", () => {
    const r = refreshQuotes({
      mint: MINT,
      observations: [obs({ outcome: "unavailable", outAmountRaw: null }), obs({ provider: "dexscreener", role: "fallback" })],
      nowMs: NOW,
      ...CAPS,
    });
    expect(r.selected?.provider).toBe("dexscreener");
    expect(r.isUsable).toBe(true);
  });

  it("FAILS CLOSED when every provider is unavailable", () => {
    const r = refreshQuotes({
      mint: MINT,
      observations: [obs({ outcome: "unavailable" }), obs({ provider: "dexscreener", role: "fallback", outcome: "error" })],
      nowMs: NOW,
      ...CAPS,
    });
    expect(r.selected).toBeNull();
    expect(r.failClosed).toBe(true);
    expect(r.blockingReasons).toContain("all-providers-unavailable");
  });
});

describe("quote refresh — caps + freshness fail closed", () => {
  it("a price impact over the cap yields no usable quote (fail closed)", () => {
    const r = refreshQuotes({ mint: MINT, observations: [obs({ priceImpactPct: 9 })], nowMs: NOW, ...CAPS });
    expect(r.failClosed).toBe(true);
    expect(r.blockingReasons).toContain("price-impact-over-cap");
    expect(r.blockingReasons).toContain("no-usable-quote");
  });

  it("slippage over the cap yields no usable quote (fail closed)", () => {
    const r = refreshQuotes({ mint: MINT, observations: [obs({ slippageBps: 999 })], nowMs: NOW, ...CAPS });
    expect(r.failClosed).toBe(true);
    expect(r.blockingReasons).toContain("slippage-over-cap");
  });

  it("a stale selected quote is not usable (quote-stale, fail closed)", () => {
    const r = refreshQuotes({ mint: MINT, observations: [obs({ observedAtMs: NOW - 99_999 })], nowMs: NOW, ...CAPS });
    expect(r.isFresh).toBe(false);
    expect(r.failClosed).toBe(true);
    expect(r.blockingReasons).toContain("quote-stale");
  });
});

describe("quote refresh — route change", () => {
  it("detects a route change vs the previous cycle", () => {
    const r = refreshQuotes({ mint: MINT, observations: [obs({ routeLabels: ["Raydium"] })], prevRouteLabels: ["Orca"], nowMs: NOW, ...CAPS });
    expect(r.routeChanged).toBe(true);
  });

  it("no route change when labels match", () => {
    const r = refreshQuotes({ mint: MINT, observations: [obs({ routeLabels: ["Orca"] })], prevRouteLabels: ["Orca"], nowMs: NOW, ...CAPS });
    expect(r.routeChanged).toBe(false);
  });
});
