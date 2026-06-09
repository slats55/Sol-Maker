/**
 * Tests for the Sprint 25 SNIPER CANDIDATE LIST intake. Everything here is INJECTED, operator-shaped
 * test data — fake candidate ids, real (well-known) mint public keys used purely as deterministic
 * fixtures, made-up operator notes. Nothing here is real market data, a live result, a verified
 * on-chain fact, or a profitability claim.
 */

import { describe, it, expect } from "vitest";
import { REDACTED } from "@soulmaker/security";
import {
  normalizeSniperCandidateList,
  validateSniperCandidateList,
  formatSniperCandidateList,
  SniperCandidateListError,
  SNIPER_CANDIDATE_LIST_SCHEMA_VERSION,
  SNIPER_CANDIDATE_LIST_BANNER,
  type SniperCandidateInput,
  type SniperCandidateList,
} from "./candidate-list.js";

// Real, well-known Solana mints used purely as deterministic, offline fixtures.
const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SYSTEM = "11111111111111111111111111111111";

const cand = (over: Partial<SniperCandidateInput> & { candidateId: string; mint: string }): SniperCandidateInput => over;
const list = (candidates: SniperCandidateInput[], sourceLabel?: string) =>
  normalizeSniperCandidateList(sourceLabel === undefined ? { candidates } : { sourceLabel, candidates });

describe("normalizeSniperCandidateList — valid", () => {
  it("normalizes a valid list and carries the PAPER-ONLY labelling", () => {
    const l = list(
      [
        cand({ candidateId: "c1", mint: WRAPPED_SOL, symbol: "SOL", sourceTag: "manual", observedLiquidityUsd: 1000 }),
        cand({ candidateId: "c2", mint: USDC, name: "USD Coin", tags: ["stable"], operatorNotes: ["watch only"] }),
      ],
      "watchlist.json",
    );
    expect(l.schemaVersion).toBe(SNIPER_CANDIDATE_LIST_SCHEMA_VERSION);
    expect(l.banner).toBe(SNIPER_CANDIDATE_LIST_BANNER);
    expect(l.paperOnly).toBe(true);
    expect(l.notLiveResult).toBe(true);
    expect(l.sourceLabel).toBe("watchlist.json");
    expect(l.candidateCount).toBe(2);
    expect(l.candidates[0]!.symbol).toBe("SOL");
    expect(l.candidates[0]!.observedLiquidityUsd).toBe(1000);
    expect(l.candidates[1]!.tags).toEqual(["stable"]);
    expect(l.distinctMints).toEqual([SYSTEM, USDC, WRAPPED_SOL].filter((m) => m === USDC || m === WRAPPED_SOL).sort());
    expect(l.duplicateMints).toEqual([]);
    expect(l.warnings).toEqual([]);
    expect(() => validateSniperCandidateList(l)).not.toThrow();
  });

  it("defaults every optional field to null / [] when absent", () => {
    const l = list([cand({ candidateId: "c1", mint: USDC })]);
    const c = l.candidates[0]!;
    expect(c.symbol).toBeNull();
    expect(c.name).toBeNull();
    expect(c.sourceTag).toBeNull();
    expect(c.observedLiquidityUsd).toBeNull();
    expect(c.observedAtLabel).toBeNull();
    expect(c.socialRefs).toEqual([]);
    expect(c.tags).toEqual([]);
    expect(c.operatorNotes).toEqual([]);
  });

  it("keeps social refs as plain strings (never fetched)", () => {
    const l = list([cand({ candidateId: "c1", mint: USDC, socialRefs: ["https://example.test/x", "@handle"] })]);
    expect(l.candidates[0]!.socialRefs).toEqual(["https://example.test/x", "@handle"]);
  });
});

describe("normalizeSniperCandidateList — rejection", () => {
  it("rejects an empty list by default but allows it with allowEmpty", () => {
    expect(() => normalizeSniperCandidateList({ candidates: [] })).toThrow(/at least one candidate/);
    const l = normalizeSniperCandidateList({ candidates: [], allowEmpty: true });
    expect(l.candidateCount).toBe(0);
    expect(l.warnings.some((w) => /empty/.test(w))).toBe(true);
  });

  it("rejects a duplicate candidateId", () => {
    expect(() => list([cand({ candidateId: "x", mint: USDC }), cand({ candidateId: "x", mint: WRAPPED_SOL })])).toThrow(
      /duplicate candidateId "x"/,
    );
  });

  it("rejects an invalid mint (not base58 / wrong length)", () => {
    expect(() => list([cand({ candidateId: "c1", mint: "not-a-real-mint" })])).toThrow(SniperCandidateListError);
    expect(() => list([cand({ candidateId: "c1", mint: "abc" })])).toThrow(/too short/);
  });

  it("REFUSES secret-length / private-key-like input without echoing it", () => {
    const secretLike = "z".repeat(88); // 64-byte secret key ~88 base58 chars
    let message = "";
    try {
      list([cand({ candidateId: "c1", mint: secretLike })]);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/too long to be a public key/);
    expect(message).not.toContain(secretLike);
  });

  it("rejects a wrong-typed optional field", () => {
    expect(() => list([cand({ candidateId: "c1", mint: USDC, observedLiquidityUsd: -5 })])).toThrow(/must not be negative/);
    expect(() =>
      normalizeSniperCandidateList({ candidates: [{ candidateId: "c1", mint: USDC, symbol: 5 as unknown as string }] }),
    ).toThrow(/symbol must be a string/);
  });
});

describe("normalizeSniperCandidateList — duplicate mints (allowed, surfaced)", () => {
  it("allows a duplicate mint across candidates but surfaces it as a warning", () => {
    const l = list([
      cand({ candidateId: "c1", mint: USDC, sourceTag: "scanner-a" }),
      cand({ candidateId: "c2", mint: USDC, sourceTag: "scanner-b" }),
    ]);
    expect(l.candidateCount).toBe(2);
    expect(l.duplicateMints).toEqual([USDC]);
    expect(l.distinctMints).toEqual([USDC]);
    expect(l.warnings.some((w) => /appear on more than one candidate/.test(w))).toBe(true);
  });
});

describe("normalizeSniperCandidateList — determinism + no mutation", () => {
  it("is byte-stable, preserves input order, and carries no timestamp", () => {
    const input = [
      cand({ candidateId: "zeta", mint: WRAPPED_SOL }),
      cand({ candidateId: "alpha", mint: USDC }),
    ];
    const first = JSON.stringify(list(input));
    const second = JSON.stringify(list(input));
    expect(first).toBe(second);
    // input order preserved (operator priority is data)
    expect(JSON.parse(first).candidates.map((c: { candidateId: string }) => c.candidateId)).toEqual(["zeta", "alpha"]);
    expect(first).not.toMatch(/"generatedAt"|"createdAt"|"timestamp"|"ranAt"/);
  });

  it("is idempotent (normalizing a normalized list yields the same list)", () => {
    const l = list([cand({ candidateId: "c1", mint: USDC, symbol: "USDC" })], "src");
    const again = normalizeSniperCandidateList({ sourceLabel: "src", candidates: l.candidates });
    expect(JSON.stringify(again)).toBe(JSON.stringify(l));
  });

  it("does not mutate its input", () => {
    const input = { candidates: [cand({ candidateId: "c1", mint: USDC, tags: ["a"] })] };
    const before = JSON.stringify(input);
    normalizeSniperCandidateList(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("validateSniperCandidateList", () => {
  const sample = () => list([cand({ candidateId: "c1", mint: USDC }), cand({ candidateId: "c2", mint: WRAPPED_SOL })], "s");

  it("accepts a freshly-built list (round-trips through JSON)", () => {
    const l = sample();
    expect(() => validateSniperCandidateList(JSON.parse(JSON.stringify(l)))).not.toThrow();
  });

  it("rejects a non-object and a wrong schemaVersion", () => {
    expect(() => validateSniperCandidateList(null)).toThrow(SniperCandidateListError);
    const l = JSON.parse(JSON.stringify(sample())) as { schemaVersion: string };
    l.schemaVersion = "sniper.candidate.list.v2";
    expect(() => validateSniperCandidateList(l)).toThrow(/schemaVersion/);
  });

  it("rejects a candidateCount that disagrees with the candidates length", () => {
    const l = JSON.parse(JSON.stringify(sample())) as { candidateCount: number };
    l.candidateCount = 99;
    expect(() => validateSniperCandidateList(l)).toThrow(/length must equal candidateCount/);
  });

  it("rejects a candidate with an invalid mint", () => {
    const l = JSON.parse(JSON.stringify(sample())) as SniperCandidateList;
    l.candidates[0]!.mint = "bogus";
    expect(() => validateSniperCandidateList(l)).toThrow(/valid Solana mint public key/);
  });
});

describe("formatSniperCandidateList", () => {
  it("renders a stable, sectioned PAPER-ONLY human report", () => {
    const l = list(
      [cand({ candidateId: "c1", mint: USDC, symbol: "USDC", sourceTag: "manual", observedLiquidityUsd: 5000, sourceNote: "seen in scanner" })],
      "watchlist.json",
    );
    const text = formatSniperCandidateList(l);
    expect(text).toBe(formatSniperCandidateList(l)); // deterministic
    expect(text).toContain(SNIPER_CANDIDATE_LIST_BANNER);
    expect(text).toContain("PAPER ONLY");
    expect(text).toContain("Candidates:");
    expect(text).toContain("USDC");
    expect(text.toLowerCase()).toContain("not live data");
  });

  it("routes the whole output through the shared redactor (no raw unsafe strings leak)", () => {
    const secretish = "a".repeat(64); // a 64-char hex-looking token the redactor must mask
    const l = list([cand({ candidateId: "c1", mint: USDC, sourceNote: secretish })]);
    const text = formatSniperCandidateList(l);
    expect(text).toContain(REDACTED);
    expect(text).not.toContain(secretish);
  });
});
