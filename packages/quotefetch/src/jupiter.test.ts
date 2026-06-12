import { describe, it, expect } from "vitest";
import {
  validateRouteQuoteObservationInput,
  normalizeRouteQuotePrepared,
  toRouteQuoteFacts,
} from "@soulmaker/routequote";
import { normalizeSniperCandidateList } from "@soulmaker/sniper";
import { createJupiterQuoteAdapter, validateQuoteFetchRequest, JUPITER_LITE_PROVIDER_ID } from "./jupiter.js";
import type { FetchLike, QuoteFetchRequest } from "./types.js";

// Well-known PUBLIC mints (mainnet WSOL / USDC) — public chain identifiers, not secrets.
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const FIXED_CLOCK = (): string => "2026-06-12T03:00:00.000Z";

/** The REAL response shape captured live from lite-api.jup.ag during Sprint 92 (values trimmed). */
function realQuoteBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    inputMint: WSOL,
    inAmount: "10000000",
    outputMint: USDC,
    outAmount: "665932",
    otherAmountThreshold: "662603",
    swapMode: "ExactIn",
    slippageBps: 50,
    platformFee: null,
    priceImpactPct: "0.0001774999230400000000000007",
    routePlan: [
      {
        swapInfo: {
          ammKey: "DbuvwPuLvH8uy2B1sKuu18aCd2QpCvfZdfDtdRZztBd2",
          label: "1DEX",
          inputMint: WSOL,
          outputMint: USDC,
          inAmount: "10000000",
          outAmount: "665932",
        },
        percent: 100,
        bps: null,
      },
    ],
    contextSlot: 425924951,
    timeTaken: 0.001652548,
    ...overrides,
  });
}

function fakeFetch(status: number, body: string): FetchLike {
  return async () => ({ ok: status >= 200 && status < 300, status, text: async () => body });
}

function failingFetch(message: string): FetchLike {
  return async () => {
    throw new Error(message);
  };
}

const REQUEST: QuoteFetchRequest = {
  candidateMint: USDC,
  inputMint: WSOL,
  amountRaw: "10000000",
  slippageBps: 50,
};

describe("jupiter adapter — request validation (caller programming errors throw)", () => {
  it("refuses a secret-length candidate mint and never echoes it", () => {
    const secretShaped = "5".repeat(88);
    expect(() => validateQuoteFetchRequest({ ...REQUEST, candidateMint: secretShaped })).toThrowError(
      /never paste a private key/,
    );
    try {
      validateQuoteFetchRequest({ ...REQUEST, candidateMint: secretShaped });
    } catch (err) {
      expect((err as Error).message).not.toContain(secretShaped);
    }
  });

  it("refuses identical input/output mints, non-integer amounts, zero amounts, bad slippage", () => {
    expect(() => validateQuoteFetchRequest({ ...REQUEST, inputMint: USDC })).toThrowError(/must differ/);
    expect(() => validateQuoteFetchRequest({ ...REQUEST, amountRaw: "1.5" })).toThrowError(/integer string/);
    expect(() => validateQuoteFetchRequest({ ...REQUEST, amountRaw: "0" })).toThrowError(/integer string/);
    expect(() => validateQuoteFetchRequest({ ...REQUEST, slippageBps: -1 })).toThrowError(/slippageBps/);
    expect(() => validateQuoteFetchRequest({ ...REQUEST, slippageBps: 10001 })).toThrowError(/slippageBps/);
    expect(() => validateQuoteFetchRequest({ ...REQUEST, slippageBps: 0.5 })).toThrowError(/slippageBps/);
  });
});

describe("jupiter adapter — successful quote normalization", () => {
  it("normalizes the REAL captured response into a validated quote-observed observation", async () => {
    const adapter = createJupiterQuoteAdapter({ fetchLike: fakeFetch(200, realQuoteBody()), clock: FIXED_CLOCK });
    const result = await adapter.fetchQuote(REQUEST);

    expect(result.status).toBe("quote-observed");
    // The emitted observation IS a valid routequote.observation.input.v1 — re-validates cleanly.
    const revalidated = validateRouteQuoteObservationInput(result.observation);
    expect(revalidated.source).toBe(JUPITER_LITE_PROVIDER_ID);
    expect(revalidated.quoteStatus).toBe("quote-observed");
    expect(revalidated.inputMint).toBe(WSOL);
    expect(revalidated.outputMint).toBe(USDC);
    expect(revalidated.amountInLabel).toBe("10000000 raw in (ExactIn)");
    expect(revalidated.amountOutLabel).toBe("665932 raw out; min 662603 @ 50 bps slippage");
    expect(revalidated.venueLabel).toBe("1DEX");
    expect(revalidated.observedAtLabel).toBe("2026-06-12T03:00:00.000Z");
    expect(revalidated.notes.join("\n")).toContain("NOT execution");

    // Freshness/provenance metadata lives BESIDE the observation.
    expect(result.metadata.fetchedAt).toBe("2026-06-12T03:00:00.000Z");
    expect(result.metadata.httpStatus).toBe(200);
    expect(result.metadata.contextSlot).toBe(425924951);
    expect(result.metadata.priceImpactPct).toBe("0.0001774999230400000000000007");
    expect(result.metadata.routeLabels).toEqual(["1DEX"]);
    expect(result.metadata.responseSha256_128).toMatch(/^[0-9a-f]{32}$/);
  });

  it("the fetched observation flows VERBATIM into the existing S91 prepare chain", async () => {
    const adapter = createJupiterQuoteAdapter({ fetchLike: fakeFetch(200, realQuoteBody()), clock: FIXED_CLOCK });
    const result = await adapter.fetchQuote(REQUEST);

    const list = normalizeSniperCandidateList({
      sourceLabel: "quotefetch-test",
      candidates: [{ candidateId: "c1", mint: USDC }],
    });
    const prepared = normalizeRouteQuotePrepared({
      candidateList: list,
      observations: [result.observation],
      sourceLabel: "fetched by jupiter adapter (test)",
    });
    expect(prepared.observedCount).toBe(1);
    expect(prepared.entries[0]?.quoteStatus).toBe("quote-observed");
    expect(prepared.entries[0]?.destinationLabel).toBeNull();

    const facts = toRouteQuoteFacts(prepared);
    expect(facts.facts).toHaveLength(1);
    expect(facts.facts[0]?.mint).toBe(USDC);
  });

  it("caps a long multi-hop route plan in the venue label", async () => {
    const plan = Array.from({ length: 6 }, (_, i) => ({ swapInfo: { label: `Venue${i}` } }));
    const adapter = createJupiterQuoteAdapter({
      fetchLike: fakeFetch(200, realQuoteBody({ routePlan: plan })),
      clock: FIXED_CLOCK,
    });
    const result = await adapter.fetchQuote(REQUEST);
    expect(result.status).toBe("quote-observed");
    expect(result.observation.venueLabel).toBe("Venue0 > Venue1 > Venue2 > Venue3 > …");
  });
});

describe("jupiter adapter — closed failure modes (provider problems NEVER throw)", () => {
  it("network failure / timeout -> unavailable", async () => {
    const adapter = createJupiterQuoteAdapter({ fetchLike: failingFetch("getaddrinfo ENOTFOUND"), clock: FIXED_CLOCK });
    const result = await adapter.fetchQuote(REQUEST);
    expect(result.status).toBe("unavailable");
    expect(result.observation.quoteStatus).toBe("unavailable");
    expect(result.observation.inputMint).toBeNull();
    expect(result.metadata.httpStatus).toBeNull();
    expect(() => validateRouteQuoteObservationInput(result.observation)).not.toThrow();
  });

  it("HTTP 429 / 403 / 401 -> blocked with the status in the reason", async () => {
    for (const status of [429, 403, 401]) {
      const adapter = createJupiterQuoteAdapter({ fetchLike: fakeFetch(status, "rate limited"), clock: FIXED_CLOCK });
      const result = await adapter.fetchQuote(REQUEST);
      expect(result.status).toBe("blocked");
      expect(result.observation.statusReason).toContain(`HTTP ${status}`);
    }
  });

  it("other non-2xx -> error", async () => {
    const adapter = createJupiterQuoteAdapter({ fetchLike: fakeFetch(500, "boom"), clock: FIXED_CLOCK });
    const result = await adapter.fetchQuote(REQUEST);
    expect(result.status).toBe("error");
    expect(result.observation.statusReason).toContain("HTTP 500");
  });

  it("non-JSON body -> unsupported", async () => {
    const adapter = createJupiterQuoteAdapter({ fetchLike: fakeFetch(200, "<html>not json</html>"), clock: FIXED_CLOCK });
    const result = await adapter.fetchQuote(REQUEST);
    expect(result.status).toBe("unsupported");
  });

  it("missing required response fields -> unsupported", async () => {
    const adapter = createJupiterQuoteAdapter({
      fetchLike: fakeFetch(200, JSON.stringify({ hello: "world" })),
      clock: FIXED_CLOCK,
    });
    const result = await adapter.fetchQuote(REQUEST);
    expect(result.status).toBe("unsupported");
    expect(result.observation.statusReason).toContain("unsupported shape");
  });

  it("response mints contradicting the request -> error (a quote for a different pair is refused)", async () => {
    const adapter = createJupiterQuoteAdapter({
      fetchLike: fakeFetch(200, realQuoteBody({ outputMint: WSOL, inputMint: USDC })),
      clock: FIXED_CLOCK,
    });
    const result = await adapter.fetchQuote(REQUEST);
    expect(result.status).toBe("error");
    expect(result.observation.statusReason).toContain("contradict");
  });

  it("a secret-shaped provider value degrades the result to unsupported (never half-trusted)", async () => {
    // An 88-char base58 blob in the route label is secret-shaped — the shared validator refuses it.
    const adapter = createJupiterQuoteAdapter({
      fetchLike: fakeFetch(200, realQuoteBody({ priceImpactPct: "z".repeat(99), routePlan: [{ swapInfo: { label: "5".repeat(88) } }] })),
      clock: FIXED_CLOCK,
    });
    const result = await adapter.fetchQuote(REQUEST);
    // The label is sanitized away (boundedLabel refuses it) so the quote still observes,
    // OR degrades to unsupported — either way nothing secret-shaped survives.
    expect(JSON.stringify(result)).not.toContain("5".repeat(88));
    expect(JSON.stringify(result)).not.toContain("z".repeat(99));
  });
});

describe("jupiter adapter — can never produce executable readiness", () => {
  it("every outcome is inside the closed observation status set and carries no live-shaped field", async () => {
    const bodies: Array<[number, string]> = [
      [200, realQuoteBody()],
      [500, "x"],
      [429, "x"],
      [200, "not json"],
    ];
    for (const [status, body] of bodies) {
      const adapter = createJupiterQuoteAdapter({ fetchLike: fakeFetch(status, body), clock: FIXED_CLOCK });
      const result = await adapter.fetchQuote(REQUEST);
      expect(["quote-observed", "unavailable", "blocked", "error", "unsupported"]).toContain(result.status);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/"executable"|"live-ready"|"ready-to-trade"/i);
      expect(serialized).not.toMatch(/phase7LiveTradingReady.{0,4}true/);
    }
  });
});
