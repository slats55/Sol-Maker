import { describe, it, expect } from "vitest";
import {
  ROUTE_QUOTE_OBSERVATION_INPUT_SCHEMA_VERSION,
  ROUTE_QUOTE_STATUSES,
  validateRouteQuoteObservationInput,
  safeQuoteLabel,
  RouteQuoteError,
} from "./observation.js";

/** FICTIONAL fixture mints (32-byte base58; do not exist on-chain). */
const FICA_MINT = "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx";
const FICB_MINT = "k7FaK87WHGVXzkaoHb7CdVPgkKDQhZ29VLDeBVbDfYn";
/** Well-known PUBLIC mint (wrapped SOL) used as a quote input side. */
const WSOL_MINT = "So11111111111111111111111111111111111111112";

function observed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: ROUTE_QUOTE_OBSERVATION_INPUT_SCHEMA_VERSION,
    source: "operator-supplied",
    candidateMint: FICA_MINT,
    quoteStatus: "quote-observed",
    inputMint: WSOL_MINT,
    outputMint: FICA_MINT,
    amountInLabel: "0.05 SOL (paper units)",
    amountOutLabel: "12345 FICA (paper units)",
    venueLabel: "fictional-amm",
    feeLabel: "0.3% pool fee (label only)",
    observedAtLabel: "rehearsal-session",
    statusReason: null,
    notes: ["fictional rehearsal observation"],
    ...overrides,
  };
}

describe("routequote.observation.input.v1 — closed outcome set", () => {
  it("pins the closed status set exactly (no executable/live outcome can ever appear)", () => {
    expect([...ROUTE_QUOTE_STATUSES]).toEqual(["quote-observed", "unavailable", "blocked", "error", "unsupported"]);
  });

  it("accepts a fully-populated observed quote and canonicalizes labels", () => {
    const obs = validateRouteQuoteObservationInput(observed({ venueLabel: "  fictional-amm  " }));
    expect(obs.quoteStatus).toBe("quote-observed");
    expect(obs.venueLabel).toBe("fictional-amm");
    expect(obs.inputMint).toBe(WSOL_MINT);
    expect(obs.outputMint).toBe(FICA_MINT);
  });

  it("accepts a minimal observed quote (mints only, all optional labels absent)", () => {
    const obs = validateRouteQuoteObservationInput({
      schemaVersion: ROUTE_QUOTE_OBSERVATION_INPUT_SCHEMA_VERSION,
      source: "operator-supplied",
      candidateMint: FICA_MINT,
      quoteStatus: "quote-observed",
      inputMint: WSOL_MINT,
      outputMint: FICA_MINT,
    });
    expect(obs.amountInLabel).toBeNull();
    expect(obs.feeLabel).toBeNull();
    expect(obs.notes).toEqual([]);
  });

  it("accepts honest unavailable / blocked / error / unsupported observations", () => {
    for (const quoteStatus of ["blocked", "error", "unsupported"] as const) {
      const obs = validateRouteQuoteObservationInput({
        schemaVersion: ROUTE_QUOTE_OBSERVATION_INPUT_SCHEMA_VERSION,
        source: "operator-supplied",
        candidateMint: FICA_MINT,
        quoteStatus,
        statusReason: "no quote source configured for this rehearsal",
      });
      expect(obs.quoteStatus).toBe(quoteStatus);
      expect(obs.inputMint).toBeNull();
      expect(obs.outputMint).toBeNull();
    }
    const unavailable = validateRouteQuoteObservationInput({
      schemaVersion: ROUTE_QUOTE_OBSERVATION_INPUT_SCHEMA_VERSION,
      source: "operator-supplied",
      candidateMint: FICA_MINT,
      quoteStatus: "unavailable",
    });
    expect(unavailable.statusReason).toBeNull();
  });
});

describe("routequote.observation.input.v1 — fail-closed refusals", () => {
  it("refuses a wrong/cross-kind schemaVersion", () => {
    expect(() => validateRouteQuoteObservationInput(observed({ schemaVersion: "sniper.preflight.input.v1" }))).toThrow(
      RouteQuoteError,
    );
  });

  it("refuses an unknown status (the set is CLOSED)", () => {
    for (const bad of ["EXECUTABLE", "ready-to-trade", "live-ready", "QUOTE_OBSERVED", "ok"]) {
      expect(() => validateRouteQuoteObservationInput(observed({ quoteStatus: bad }))).toThrow(RouteQuoteError);
    }
  });

  it("refuses an observed quote whose outputMint differs from the candidate mint (contradiction)", () => {
    expect(() => validateRouteQuoteObservationInput(observed({ outputMint: FICB_MINT }))).toThrow(/contradiction/);
  });

  it("refuses an observed quote without input/output mints", () => {
    expect(() => validateRouteQuoteObservationInput(observed({ inputMint: null }))).toThrow(/required/);
    expect(() => validateRouteQuoteObservationInput(observed({ outputMint: undefined }))).toThrow(/required/);
  });

  it("refuses quote facts on a non-observed status (a fact without an observation)", () => {
    expect(() =>
      validateRouteQuoteObservationInput({
        schemaVersion: ROUTE_QUOTE_OBSERVATION_INPUT_SCHEMA_VERSION,
        source: "operator-supplied",
        candidateMint: FICA_MINT,
        quoteStatus: "unavailable",
        inputMint: WSOL_MINT,
      }),
    ).toThrow(/without an observation/);
    expect(() =>
      validateRouteQuoteObservationInput({
        schemaVersion: ROUTE_QUOTE_OBSERVATION_INPUT_SCHEMA_VERSION,
        source: "operator-supplied",
        candidateMint: FICA_MINT,
        quoteStatus: "error",
        statusReason: "boom",
        feeLabel: "0.3%",
      }),
    ).toThrow(/without an observation/);
  });

  it("requires a statusReason for blocked/error/unsupported and refuses one on observed", () => {
    expect(() =>
      validateRouteQuoteObservationInput({
        schemaVersion: ROUTE_QUOTE_OBSERVATION_INPUT_SCHEMA_VERSION,
        source: "operator-supplied",
        candidateMint: FICA_MINT,
        quoteStatus: "error",
      }),
    ).toThrow(/statusReason is required/);
    expect(() => validateRouteQuoteObservationInput(observed({ statusReason: "looks great" }))).toThrow(/must be null/);
  });

  it("refuses unknown fields (CLOSED schema) and sensitive-named fields pointedly", () => {
    expect(() => validateRouteQuoteObservationInput(observed({ swapTransaction: "AAAA" }))).toThrow(/CLOSED/);
    expect(() => validateRouteQuoteObservationInput(observed({ apiKey: "x" }))).toThrow(/sensitive-named/);
  });

  it("refuses a secret-length candidate mint without echoing it", () => {
    const secretish = "5".repeat(88);
    try {
      validateRouteQuoteObservationInput(observed({ candidateMint: secretish }));
      expect.unreachable("must throw");
    } catch (err) {
      expect((err as Error).message).not.toContain(secretish);
    }
  });

  it("refuses secret-shaped label values without echoing them", () => {
    const keyShaped = "a".repeat(64); // 64-hex-shaped blob the shared redactor scrubs
    try {
      validateRouteQuoteObservationInput(observed({ venueLabel: `pool ${keyShaped}` }));
      expect.unreachable("must throw");
    } catch (err) {
      expect((err as Error).message).toMatch(/secret-shaped/);
      expect((err as Error).message).not.toContain(keyShaped);
    }
  });

  it("safeQuoteLabel bounds length and passes ordinary labels through", () => {
    expect(safeQuoteLabel(null, "x")).toBeNull();
    expect(safeQuoteLabel(" hello ", "x")).toBe("hello");
    expect(() => safeQuoteLabel("y".repeat(201), "x")).toThrow(/at most/);
  });
});
