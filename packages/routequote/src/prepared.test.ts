import { describe, it, expect } from "vitest";
import { normalizeSniperCandidateList } from "@soulmaker/sniper";
import { ROUTE_QUOTE_OBSERVATION_INPUT_SCHEMA_VERSION } from "./observation.js";
import {
  ROUTE_QUOTE_PREPARED_SCHEMA_VERSION,
  ROUTE_QUOTE_RESOLVER_ID,
  ROUTE_QUOTE_CAVEATS,
  deriveRouteQuoteLabel,
  normalizeRouteQuotePrepared,
  validateRouteQuotePrepared,
  toRouteQuoteFacts,
  formatRouteQuotePrepared,
  type RouteQuotePrepared,
} from "./prepared.js";
import { RouteQuoteError } from "./observation.js";

/** FICTIONAL fixture mints (32-byte base58; do not exist on-chain). */
const FICA_MINT = "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx";
const FICB_MINT = "k7FaK87WHGVXzkaoHb7CdVPgkKDQhZ29VLDeBVbDfYn";
const WSOL_MINT = "So11111111111111111111111111111111111111112";

const CANDIDATE_LIST = {
  sourceLabel: "routequote-test",
  candidates: [
    { candidateId: "fica", mint: FICA_MINT, symbol: "FICA" },
    { candidateId: "ficb", mint: FICB_MINT, symbol: "FICB" },
  ],
};

function ficaObservation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    ...overrides,
  };
}

function canonicalCandidateList(): unknown {
  // The prepared normalizer requires a CANONICAL list — build it through the sniper package.
  return normalizeSniperCandidateList(CANDIDATE_LIST as never);
}

describe("routequote.prepared.v1 — normalize", () => {
  it("pairs an observation to its candidate BY MINT and leaves the rest honestly unavailable", () => {
    const prepared = normalizeRouteQuotePrepared({
      candidateList: canonicalCandidateList(),
      observations: [ficaObservation()],
      sourceLabel: "test-run",
      candidateListRef: "candidates.json",
    });
    expect(prepared.schemaVersion).toBe(ROUTE_QUOTE_PREPARED_SCHEMA_VERSION);
    expect(prepared.resolverId).toBe(ROUTE_QUOTE_RESOLVER_ID);
    expect(prepared.entryCount).toBe(2);
    expect(prepared.observedCount).toBe(1);
    expect(prepared.unavailableCount).toBe(1);
    const fica = prepared.entries.find((e) => e.candidateId === "fica")!;
    expect(fica.quoteStatus).toBe("quote-observed");
    expect(fica.routeLabel).toContain("read-only quote (operator-supplied)");
    expect(fica.routeLabel).toContain("NOT executable");
    expect(fica.caveats).toEqual([...ROUTE_QUOTE_CAVEATS]);
    expect(fica.destinationLabel).toBeNull();
    const ficb = prepared.entries.find((e) => e.candidateId === "ficb")!;
    expect(ficb.quoteStatus).toBe("unavailable");
    expect(ficb.observationSupplied).toBe(false);
    expect(ficb.routeLabel).toBeNull();
    expect(prepared.hasWarnings).toBe(true);
    expect(prepared.validationStatus).toBe("valid-with-warnings");
    expect(prepared.phase7LiveTradingReady).toBe(false);
  });

  it("is deterministic (same input → byte-identical JSON)", () => {
    const build = () =>
      JSON.stringify(
        normalizeRouteQuotePrepared({ candidateList: canonicalCandidateList(), observations: [ficaObservation()] }),
      );
    expect(build()).toBe(build());
  });

  it("REFUSES an observation for a mint that matches no candidate (unknown mint)", () => {
    const stranger = ficaObservation({
      candidateMint: WSOL_MINT,
      outputMint: WSOL_MINT,
      inputMint: FICA_MINT,
    });
    expect(() =>
      normalizeRouteQuotePrepared({ candidateList: canonicalCandidateList(), observations: [stranger] }),
    ).toThrow(/unknown-mint/);
  });

  it("REFUSES duplicate observations for the same mint", () => {
    expect(() =>
      normalizeRouteQuotePrepared({
        candidateList: canonicalCandidateList(),
        observations: [ficaObservation(), ficaObservation({ venueLabel: "another-amm" })],
      }),
    ).toThrow(/duplicates mint/);
  });

  it("REFUSES a malformed observation and an invalid candidate list", () => {
    expect(() =>
      normalizeRouteQuotePrepared({ candidateList: canonicalCandidateList(), observations: [{ nope: true }] }),
    ).toThrow(RouteQuoteError);
    expect(() => normalizeRouteQuotePrepared({ candidateList: { bogus: 1 }, observations: [] })).toThrow(
      /candidate list is invalid/,
    );
    expect(() => normalizeRouteQuotePrepared({ observations: [] })).toThrow(/candidateList is required/);
  });

  it("carries a non-observed observation's status and reason verbatim", () => {
    const prepared = normalizeRouteQuotePrepared({
      candidateList: canonicalCandidateList(),
      observations: [
        {
          schemaVersion: ROUTE_QUOTE_OBSERVATION_INPUT_SCHEMA_VERSION,
          source: "operator-supplied",
          candidateMint: FICA_MINT,
          quoteStatus: "error",
          statusReason: "quote endpoint unreachable during rehearsal",
        },
      ],
    });
    const fica = prepared.entries.find((e) => e.candidateId === "fica")!;
    expect(fica.quoteStatus).toBe("error");
    expect(fica.statusReason).toBe("quote endpoint unreachable during rehearsal");
    expect(fica.routeLabel).toBeNull();
    expect(fica.caveats).toEqual([]);
    expect(prepared.errorCount).toBe(1);
  });
});

describe("routequote.prepared.v1 — validate (backstop)", () => {
  const build = (): RouteQuotePrepared =>
    normalizeRouteQuotePrepared({ candidateList: canonicalCandidateList(), observations: [ficaObservation()] });

  it("round-trips the normalizer's own output (JSON-safe)", () => {
    const prepared = JSON.parse(JSON.stringify(build())) as unknown;
    expect(() => validateRouteQuotePrepared(prepared)).not.toThrow();
  });

  it("refuses a tampered route label (recomputed, never trusted)", () => {
    const prepared = JSON.parse(JSON.stringify(build())) as { entries: Array<{ routeLabel: string | null }> };
    prepared.entries[0]!.routeLabel = "executable route via mega-dex";
    expect(() => validateRouteQuotePrepared(prepared)).toThrow(/recomputed deterministic label/);
  });

  it("refuses a dropped caveat set on an observed entry", () => {
    const prepared = JSON.parse(JSON.stringify(build())) as { entries: Array<{ caveats: string[] }> };
    prepared.entries[0]!.caveats = [];
    expect(() => validateRouteQuotePrepared(prepared)).toThrow(/never drop a caveat/);
  });

  it("refuses a flipped phase7LiveTradingReady or safety literal", () => {
    const ready = JSON.parse(JSON.stringify(build())) as Record<string, unknown>;
    ready.phase7LiveTradingReady = true;
    expect(() => validateRouteQuotePrepared(ready)).toThrow(/literally false/);
    const notReadOnly = JSON.parse(JSON.stringify(build())) as Record<string, unknown>;
    notReadOnly.readOnly = false;
    expect(() => validateRouteQuotePrepared(notReadOnly)).toThrow(/readOnly must be true/);
  });

  it("refuses an invented destination label", () => {
    const prepared = JSON.parse(JSON.stringify(build())) as { entries: Array<{ destinationLabel: string | null }> };
    prepared.entries[0]!.destinationLabel = "some-pool-address";
    expect(() => validateRouteQuotePrepared(prepared)).toThrow(/none may be invented/);
  });

  it("refuses tampered tallies and unknown/sensitive fields", () => {
    const tampered = JSON.parse(JSON.stringify(build())) as Record<string, unknown>;
    tampered.observedCount = 2;
    expect(() => validateRouteQuotePrepared(tampered)).toThrow(/recomputed tally/);
    const foreign = JSON.parse(JSON.stringify(build())) as Record<string, unknown>;
    foreign.swapTransaction = "AAAA";
    expect(() => validateRouteQuotePrepared(foreign)).toThrow(/CLOSED/);
    const sensitive = JSON.parse(JSON.stringify(build())) as Record<string, unknown>;
    sensitive.walletSecret = "x";
    expect(() => validateRouteQuotePrepared(sensitive)).toThrow(/sensitive-named/);
  });

  it("refuses a wrong resolver id (the provenance id is fixed)", () => {
    const prepared = JSON.parse(JSON.stringify(build())) as Record<string, unknown>;
    prepared.resolverId = "mega-dex-live-router";
    expect(() => validateRouteQuotePrepared(prepared)).toThrow(/resolverId must be/);
  });
});

describe("routequote.prepared.v1 — conversion to route facts", () => {
  it("produces facts ONLY for observed entries, destination always null", () => {
    const prepared = normalizeRouteQuotePrepared({
      candidateList: canonicalCandidateList(),
      observations: [ficaObservation()],
    });
    const facts = toRouteQuoteFacts(prepared);
    expect(facts.resolverId).toBe(ROUTE_QUOTE_RESOLVER_ID);
    expect(facts.facts).toHaveLength(1);
    expect(facts.facts[0]!.candidateId).toBe("fica");
    expect(facts.facts[0]!.mint).toBe(FICA_MINT);
    expect(facts.facts[0]!.routeLabel).toBe(deriveRouteQuoteLabel(prepared.entries.find((e) => e.candidateId === "fica")!.observation!));
    expect(facts.facts[0]!.destinationLabel).toBeNull();
    expect(facts.facts[0]!.feeLabel).toBe("0.3% pool fee (label only)");
  });

  it("produces zero facts when nothing was observed (honest empty, never defaulted)", () => {
    const prepared = normalizeRouteQuotePrepared({ candidateList: canonicalCandidateList(), observations: [] });
    expect(toRouteQuoteFacts(prepared).facts).toEqual([]);
  });
});

describe("routequote.prepared.v1 — formatter", () => {
  it("renders deterministically with the observation-only framing and caveats", () => {
    const prepared = normalizeRouteQuotePrepared({
      candidateList: canonicalCandidateList(),
      observations: [ficaObservation()],
    });
    const text = formatRouteQuotePrepared(prepared, { label: "test" });
    expect(text).toContain("OBSERVATION ONLY");
    expect(text).toContain("quote-observed: 1");
    expect(text).toContain("NOT executable");
    expect(text).toContain(ROUTE_QUOTE_CAVEATS[0]!);
    expect(formatRouteQuotePrepared(prepared, { label: "test" })).toBe(text);
  });
});
