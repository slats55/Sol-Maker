import { describe, expect, it } from "vitest";

import {
  DISCOVERY_EVENTS,
  DiscoveryError,
  discoverCandidates,
  dedupeCandidates,
  isValidMint,
  normalizeManualMint,
  normalizeObservation,
  validateSniperCandidate,
} from "./discovery.js";

const VALID_MINT = "So11111111111111111111111111111111111111112";
const VALID_MINT_2 = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const AT = "2026-06-18T00:00:00.000Z";

describe("discovery — mint validation (fail-closed)", () => {
  it("accepts a real base58 mint (32..44 chars)", () => {
    expect(isValidMint(VALID_MINT)).toBe(true);
    expect(isValidMint(VALID_MINT_2)).toBe(true);
  });

  it("refuses a too-short, non-base58, or secret-length string", () => {
    expect(isValidMint("abc")).toBe(false);
    expect(isValidMint("0OIl" + VALID_MINT)).toBe(false); // contains base58-illegal chars
    expect(isValidMint("1".repeat(88))).toBe(false); // 64-byte secret key length — refused
    expect(isValidMint(123 as unknown)).toBe(false);
  });

  it("a malformed manual mint is REFUSED (never normalized)", () => {
    expect(() => normalizeManualMint({ mint: "not-a-mint" }, { discoveredAt: AT })).toThrow(DiscoveryError);
  });
});

describe("discovery — normalization + provenance", () => {
  it("normalizes a live observation with provenance + missingData + confidence", () => {
    const c = normalizeObservation(
      { mint: VALID_MINT, symbol: "WSOL", sourceProviderId: "jupiter-recent", sourceKind: "live", liquidityUsdHint: 50_000 },
      { discoveredAt: AT },
    );
    expect(c.mint).toBe(VALID_MINT);
    expect(c.sourceKind).toBe("live_feed");
    expect(c.provenance.providers).toEqual(["jupiter-recent"]);
    expect(c.liquidityUsd).toBe(50_000);
    expect(c.missingData).toContain("risk");
    expect(c.confidence).toBeGreaterThan(0);
    expect(c.isObservationNotTrade).toBe(true);
  });

  it("marks replay data as replay and never live (lower confidence)", () => {
    const live = normalizeObservation({ mint: VALID_MINT, sourceProviderId: "p", sourceKind: "live" }, { discoveredAt: AT });
    const replay = normalizeObservation({ mint: VALID_MINT, sourceProviderId: "p", sourceKind: "replay" }, { discoveredAt: AT });
    expect(replay.sourceKind).toBe("replay");
    expect(replay.provenance.note).toMatch(/REPLAY/);
    expect(replay.confidence).toBeLessThan(live.confidence);
  });

  it("provenance is REQUIRED — an observation with no provider is refused", () => {
    expect(() => normalizeObservation({ mint: VALID_MINT, sourceProviderId: "", sourceKind: "live" }, { discoveredAt: AT })).toThrow(/provenance/);
  });

  it("a secret-shaped symbol is dropped, never carried on a display field", () => {
    const c = normalizeManualMint({ mint: VALID_MINT, symbol: "x".repeat(60) }, { discoveredAt: AT });
    expect(c.symbol === null || c.symbol.length <= 32).toBe(true);
  });
});

describe("discovery — dedupe + batch", () => {
  it("de-duplicates by mint (first-seen wins, duplicate reported)", () => {
    const a = normalizeManualMint({ mint: VALID_MINT, sourceProvider: "first" }, { discoveredAt: AT });
    const b = normalizeManualMint({ mint: VALID_MINT, sourceProvider: "second" }, { discoveredAt: AT });
    const { kept, duplicates } = dedupeCandidates([a, b]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.sourceProvider).toBe("first");
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]!.reason).toMatch(/duplicate/);
  });

  it("discoverCandidates fails CLOSED per item without throwing the batch", () => {
    const result = discoverCandidates(
      {
        observations: [
          { mint: VALID_MINT, sourceProviderId: "jupiter-recent", sourceKind: "live" },
          { mint: "BAD", sourceProviderId: "jupiter-recent", sourceKind: "live" },
        ],
        manualMints: [{ mint: VALID_MINT_2 }, { mint: "also-bad" }],
      },
      { discoveredAt: AT },
    );
    expect(result.candidates).toHaveLength(2);
    expect(result.rejections.length).toBeGreaterThanOrEqual(2);
    const discovered = result.events.filter((e) => e.event === "candidate-discovered");
    const rejected = result.events.filter((e) => e.event === "candidate-rejected");
    expect(discovered).toHaveLength(2);
    expect(rejected.length).toBeGreaterThanOrEqual(2);
  });

  it("an empty input yields an honest empty result (no fake candidate)", () => {
    const result = discoverCandidates({}, { discoveredAt: AT });
    expect(result.candidates).toHaveLength(0);
    expect(result.rejections).toHaveLength(0);
    expect(result.notProfitabilityClaim).toBe(true);
  });

  it("every discovery event is in the closed event set", () => {
    const result = discoverCandidates({ manualMints: [{ mint: VALID_MINT }, { mint: "bad" }] }, { discoveredAt: AT });
    for (const e of result.events) expect(DISCOVERY_EVENTS).toContain(e.event);
  });
});

describe("discovery — closed-schema validation", () => {
  it("round-trips a built candidate through the validator", () => {
    const c = normalizeManualMint({ mint: VALID_MINT }, { discoveredAt: AT });
    expect(validateSniperCandidate(c)).toEqual(c);
  });

  it("rejects an unknown field and a sensitive-named field", () => {
    const c = normalizeManualMint({ mint: VALID_MINT }, { discoveredAt: AT });
    expect(() => validateSniperCandidate({ ...c, extra: 1 })).toThrow(/CLOSED/);
    expect(() => validateSniperCandidate({ ...c, secretKey: "x" })).toThrow(/sensitive/);
  });
});
