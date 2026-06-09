/**
 * Tests for the Sprint 47 SNIPER PREFLIGHT INPUT artifact (`sniper.preflight.input.v1`). All inputs
 * are INJECTED, offline test data — real well-known mints as deterministic fixtures, hand-built
 * inspection/risk shaped like token:inspect / token:risk output. Validating an input artifact is
 * LOCAL-ONLY: nothing here fetches chain data or verifies an on-chain fact.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeSniperPreflightInput,
  validateSniperPreflightInput,
  formatSniperPreflightInput,
  SniperPreflightInputError,
  SNIPER_PREFLIGHT_INPUT_SCHEMA_VERSION,
  SNIPER_PREFLIGHT_INPUT_BANNER,
} from "./preflight-input.js";
import { normalizeSniperCandidateList } from "./candidate-list.js";
import { buildSniperTokenPreflightReport } from "./token-preflight.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

const cleanInspection = (mint: string) => ({ mint, decimals: 6, supplyRaw: "1", uiSupply: 1, mintAuthorityPresent: false, freezeAuthorityPresent: false, isInitialized: true, programLabel: "spl-token" });
const riskPass = (mint: string) => ({ mint, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [], summary: [] });

const listOf = (...cands: { candidateId: string; mint: string }[]) =>
  normalizeSniperCandidateList({ sourceLabel: "test", candidates: cands });

describe("normalizeSniperPreflightInput — valid input", () => {
  it("normalizes a fully-covered input with no warnings (status valid)", () => {
    const artifact = normalizeSniperPreflightInput({
      sourceLabel: "ops",
      candidateListRef: "cands.json",
      entries: [
        { candidateId: "c1", mint: USDC, inspection: cleanInspection(USDC), risk: riskPass(USDC) },
      ],
    });
    expect(artifact.schemaVersion).toBe(SNIPER_PREFLIGHT_INPUT_SCHEMA_VERSION);
    expect(artifact.banner).toBe(SNIPER_PREFLIGHT_INPUT_BANNER);
    expect(artifact.validationStatus).toBe("valid");
    expect(artifact.hasWarnings).toBe(false);
    expect(artifact.entries[0]!.inspectionSummary?.mintMatches).toBe(true);
    expect(artifact.entries[0]!.riskSummary?.mintMatches).toBe(true);
    expect(artifact.missingInspectionCount).toBe(0);
    expect(artifact.missingRiskCount).toBe(0);
    expect(artifact.uncoveredCandidateCount).toBeNull();
    expect(() => validateSniperPreflightInput(artifact)).not.toThrow();
  });

  it("is deterministic and idempotent (canonical re-normalizes to itself)", () => {
    const input = {
      entries: [{ candidateId: "c1", mint: USDC, inspection: cleanInspection(USDC), risk: riskPass(USDC) }],
    };
    const a = normalizeSniperPreflightInput(input);
    const b = normalizeSniperPreflightInput(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const again = normalizeSniperPreflightInput(a as never);
    expect(JSON.stringify(again)).toBe(JSON.stringify(a));
  });
});

describe("normalizeSniperPreflightInput — missing / unsupported sections (honest warnings)", () => {
  it("flags missing risk and missing inspection per entry and in the aggregates", () => {
    const artifact = normalizeSniperPreflightInput({
      entries: [
        { candidateId: "no-risk", mint: USDC, inspection: cleanInspection(USDC) },
        { candidateId: "no-insp", mint: WSOL, risk: riskPass(WSOL) },
        { candidateId: "nothing", mint: USDC },
      ],
    });
    expect(artifact.missingRiskCount).toBe(2);
    expect(artifact.missingInspectionCount).toBe(2);
    expect(artifact.validationStatus).toBe("valid-with-warnings");
    const nothing = artifact.entries.find((e) => e.candidateId === "nothing")!;
    expect(nothing.warnings.some((w) => /preflight would mark this candidate unknown/.test(w))).toBe(true);
    expect(() => validateSniperPreflightInput(artifact)).not.toThrow();
  });

  it("treats a non-object inspection/risk as an UNSUPPORTED shape (never silently dropped)", () => {
    const artifact = normalizeSniperPreflightInput({
      entries: [{ candidateId: "c1", mint: USDC, inspection: "not-an-object", risk: 42 }],
    });
    const e = artifact.entries[0]!;
    expect(e.unsupportedInspectionShape).toBe(true);
    expect(e.unsupportedRiskShape).toBe(true);
    expect(e.inspectionSummary).toBeNull();
    expect(e.riskSummary).toBeNull();
    expect(artifact.unsupportedShapeCount).toBe(1);
    expect(e.warnings.some((w) => /unsupported local inspection shape/.test(w))).toBe(true);
    expect(() => validateSniperPreflightInput(artifact)).not.toThrow();
  });

  it("flags inspection/risk supplied for a DIFFERENT mint", () => {
    const artifact = normalizeSniperPreflightInput({
      entries: [{ candidateId: "c1", mint: USDC, inspection: cleanInspection(WSOL), risk: riskPass(WSOL) }],
    });
    expect(artifact.mintMismatchCount).toBe(1);
    expect(artifact.entries[0]!.inspectionSummary?.mintMatches).toBe(false);
    expect(artifact.entries[0]!.warnings.some((w) => /different mint/.test(w))).toBe(true);
  });
});

describe("normalizeSniperPreflightInput — refusals (structural problems throw)", () => {
  it("refuses an invalid mint and NEVER echoes secret-length input", () => {
    expect(() => normalizeSniperPreflightInput({ entries: [{ candidateId: "c1", mint: "tooshort" }] }))
      .toThrow(SniperPreflightInputError);
    const secretish = "5".repeat(88);
    try {
      normalizeSniperPreflightInput({ entries: [{ candidateId: "c1", mint: secretish }] });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).message).not.toContain(secretish);
      expect((err as Error).message).toMatch(/never paste a private key/i);
    }
  });

  it("refuses duplicate candidateIds and a non-array entries", () => {
    expect(() =>
      normalizeSniperPreflightInput({
        entries: [
          { candidateId: "c1", mint: USDC },
          { candidateId: "c1", mint: WSOL },
        ],
      }),
    ).toThrow(/duplicate entry/);
    expect(() => normalizeSniperPreflightInput({ entries: {} as never })).toThrow(/must be an array/);
  });
});

describe("normalizeSniperPreflightInput — candidate list cross-check", () => {
  const list = () => listOf({ candidateId: "c1", mint: USDC }, { candidateId: "c2", mint: WSOL });

  it("refuses an entry for an unknown candidateId (candidate mismatch)", () => {
    expect(() =>
      normalizeSniperPreflightInput({
        entries: [{ candidateId: "ghost", mint: USDC }],
        candidateList: list(),
      }),
    ).toThrow(/unknown candidateId "ghost"/);
  });

  it("refuses an entry whose mint disagrees with the candidate list", () => {
    expect(() =>
      normalizeSniperPreflightInput({
        entries: [{ candidateId: "c1", mint: WSOL }],
        candidateList: list(),
      }),
    ).toThrow(/carries mint .* but the candidate list has/);
  });

  it("warns about (never invents) uncovered candidates", () => {
    const artifact = normalizeSniperPreflightInput({
      entries: [{ candidateId: "c1", mint: USDC, inspection: cleanInspection(USDC), risk: riskPass(USDC) }],
      candidateList: list(),
    });
    expect(artifact.crossCheckedAgainstCandidateList).toBe(true);
    expect(artifact.uncoveredCandidateCount).toBe(1);
    expect(artifact.warnings.some((w) => /c2/.test(w))).toBe(true);
    expect(artifact.entryCount).toBe(1); // nothing invented
    expect(() => validateSniperPreflightInput(artifact)).not.toThrow();
  });

  it("refuses an invalid candidate list", () => {
    expect(() =>
      normalizeSniperPreflightInput({ entries: [], candidateList: { schemaVersion: "nope" } }),
    ).toThrow(/candidate list is invalid/);
  });
});

describe("the artifact drives the real preflight builder without loss", () => {
  it("verbatim raw values produce the same preflight entries as direct candidateData", () => {
    const cands = listOf({ candidateId: "c1", mint: USDC }, { candidateId: "c2", mint: WSOL });
    const artifact = normalizeSniperPreflightInput({
      entries: [
        { candidateId: "c1", mint: USDC, inspection: cleanInspection(USDC), risk: riskPass(USDC) },
        { candidateId: "c2", mint: WSOL, risk: riskPass(WSOL) },
      ],
      candidateList: cands,
    });
    const viaArtifact = buildSniperTokenPreflightReport({
      candidateList: cands,
      candidateData: artifact.entries.map((e) => ({
        candidateId: e.candidateId,
        ...(e.inspection !== null ? { inspection: e.inspection } : {}),
        ...(e.risk !== null ? { risk: e.risk } : {}),
      })),
    });
    const direct = buildSniperTokenPreflightReport({
      candidateList: cands,
      candidateData: [
        { candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
        { candidateId: "c2", risk: riskPass(WSOL) },
      ],
    });
    expect(JSON.stringify(viaArtifact)).toBe(JSON.stringify(direct));
  });
});

describe("validateSniperPreflightInput — strict backstop", () => {
  const valid = () =>
    normalizeSniperPreflightInput({
      entries: [{ candidateId: "c1", mint: USDC, inspection: cleanInspection(USDC), risk: riskPass(USDC) }],
    });

  it("rejects wrong schema/banner, tampered summaries, and tampered aggregates", () => {
    const a = JSON.parse(JSON.stringify(valid()));
    a.schemaVersion = "nope";
    expect(() => validateSniperPreflightInput(a)).toThrow(/schemaVersion/);

    const b = JSON.parse(JSON.stringify(valid()));
    b.entries[0].inspectionSummary = null;
    expect(() => validateSniperPreflightInput(b)).toThrow(/projection of the verbatim inspection/);

    const c = JSON.parse(JSON.stringify(valid()));
    c.missingRiskCount = 5;
    expect(() => validateSniperPreflightInput(c)).toThrow(/recomputed value/);
  });

  it("rejects an inconsistent hasWarnings / validationStatus pair", () => {
    const a = JSON.parse(JSON.stringify(valid()));
    a.hasWarnings = true;
    expect(() => validateSniperPreflightInput(a)).toThrow(/validationStatus|mirror/);

    const b = JSON.parse(JSON.stringify(valid()));
    b.validationStatus = "valid-with-warnings";
    expect(() => validateSniperPreflightInput(b)).toThrow(/mirror/);
  });

  it("rejects uncoveredCandidateCount without a cross-check", () => {
    const a = JSON.parse(JSON.stringify(valid()));
    a.uncoveredCandidateCount = 0;
    expect(() => validateSniperPreflightInput(a)).toThrow(/must be null when no candidate list/);
  });
});

describe("formatSniperPreflightInput — deterministic operator output", () => {
  it("shows the banner, coverage, per-entry availability, and the disclaimers", () => {
    const artifact = normalizeSniperPreflightInput({
      sourceLabel: "ops",
      entries: [
        { candidateId: "full", mint: USDC, inspection: cleanInspection(USDC), risk: riskPass(USDC) },
        { candidateId: "bare", mint: WSOL },
      ],
    });
    const text = formatSniperPreflightInput(artifact, { label: "t" });
    expect(text).toContain(SNIPER_PREFLIGHT_INPUT_BANNER);
    expect(text).toContain("Coverage:");
    expect(text).toContain("- full  ");
    expect(text).toContain("inspection ✓ | risk ✓");
    expect(text).toContain("inspection — | risk —");
    expect(text).toContain("Not a trade signal.");
    expect(formatSniperPreflightInput(artifact, { label: "t" })).toBe(text);
  });
});
