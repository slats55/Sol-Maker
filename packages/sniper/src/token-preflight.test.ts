/**
 * Tests for the Sprint 26 SNIPER TOKEN PREFLIGHT. All inputs are INJECTED, offline test data —
 * real well-known mints used as deterministic fixtures, hand-built inspection/risk objects shaped like
 * the output of token:inspect / token:risk. Nothing here is live data, a verified on-chain fact, or a
 * trade signal.
 */

import { describe, it, expect } from "vitest";
import { REDACTED } from "@soulmaker/security";
import {
  buildSniperTokenPreflightReport,
  validateSniperTokenPreflightReport,
  formatSniperTokenPreflightReport,
  SniperTokenPreflightReportError,
  SNIPER_TOKEN_PREFLIGHT_REPORT_SCHEMA_VERSION,
  SNIPER_TOKEN_PREFLIGHT_REPORT_BANNER,
  type SniperPreflightCandidateData,
  type SniperTokenPreflightReport,
} from "./token-preflight.js";
import { normalizeSniperCandidateList } from "./candidate-list.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";
const SYSTEM = "11111111111111111111111111111111";

const listOf = (...ids: [string, string][]) =>
  normalizeSniperCandidateList({ sourceLabel: "test", candidates: ids.map(([candidateId, mint]) => ({ candidateId, mint })) });

const cleanInspection = (mint: string) => ({
  mint,
  decimals: 6,
  supplyRaw: "1000",
  uiSupply: 0.001,
  mintAuthorityPresent: false,
  freezeAuthorityPresent: false,
  isInitialized: true,
  programLabel: "spl-token",
});
const freezeInspection = (mint: string) => ({ ...cleanInspection(mint), freezeAuthorityPresent: true });
const mintAuthInspection = (mint: string) => ({ ...cleanInspection(mint), mintAuthorityPresent: true });

const riskPass = (mint: string) => ({ mint, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [], summary: [] });
const riskCaution = (mint: string) => ({ mint, score: 55, decision: "CAUTION", flags: [{ id: "freeze", severity: "high", title: "Freeze authority" }], summary: [] });
const riskReject = (mint: string) => ({ mint, score: 95, decision: "REJECT", flags: [{ id: "rug", severity: "critical", title: "Critical rug flag" }], summary: [] });

const build = (list: ReturnType<typeof listOf>, candidateData?: SniperPreflightCandidateData[]) =>
  buildSniperTokenPreflightReport({ candidateList: list, candidateData });

describe("buildSniperTokenPreflightReport — per-candidate status", () => {
  it("passes a candidate with clean inspection + a PASS risk report", () => {
    const r = build(listOf(["c1", USDC]), [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const e = r.candidates[0]!;
    expect(e.status).toBe("pass");
    expect(e.mintValid).toBe(true);
    expect(e.disqualifiers).toEqual([]);
    expect(e.warnings).toEqual([]);
    expect(r.passCount).toBe(1);
    expect(r.hasFail).toBe(false);
    expect(() => validateSniperTokenPreflightReport(r)).not.toThrow();
  });

  it("fails a candidate whose risk decision is REJECT (a critical flag is a disqualifier)", () => {
    const r = build(listOf(["c1", USDC]), [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskReject(USDC) }]);
    const e = r.candidates[0]!;
    expect(e.status).toBe("fail");
    expect(e.disqualifiers.some((d) => /REJECT/.test(d))).toBe(true);
    expect(e.disqualifiers.some((d) => /critical/.test(d))).toBe(true);
    expect(r.hasFail).toBe(true);
    expect(r.wouldFailOnFail).toBe(true);
  });

  it("warns a candidate with a CAUTION risk or a high-severity flag", () => {
    const r = build(listOf(["c1", USDC]), [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskCaution(USDC) }]);
    const e = r.candidates[0]!;
    expect(e.status).toBe("warn");
    expect(e.warnings.some((w) => /CAUTION/.test(w))).toBe(true);
    expect(r.hasWarn).toBe(true);
    expect(r.wouldFailOnWarning).toBe(true);
  });

  it("warns on a freeze authority and on a mint authority", () => {
    const freeze = build(listOf(["c1", USDC]), [{ candidateId: "c1", inspection: freezeInspection(USDC) }]);
    expect(freeze.candidates[0]!.status).toBe("warn");
    expect(freeze.candidates[0]!.warnings.some((w) => /freeze authority/.test(w))).toBe(true);
    const dilute = build(listOf(["c1", USDC]), [{ candidateId: "c1", inspection: mintAuthInspection(USDC) }]);
    expect(dilute.candidates[0]!.status).toBe("warn");
    expect(dilute.candidates[0]!.warnings.some((w) => /mint authority/.test(w))).toBe(true);
  });

  it("marks a candidate UNKNOWN when no inspection and no risk data is supplied", () => {
    const r = build(listOf(["c1", USDC]));
    const e = r.candidates[0]!;
    expect(e.status).toBe("unknown");
    expect(e.inspection).toBeNull();
    expect(e.risk).toBeNull();
    expect(r.unknownCount).toBe(1);
    expect(r.missingDataCount).toBe(1);
    expect(r.hasUnknown).toBe(true);
  });

  it("warns when supplied inspection/risk is for a different mint than the candidate", () => {
    const r = build(listOf(["c1", USDC]), [{ candidateId: "c1", inspection: cleanInspection(WSOL), risk: riskPass(WSOL) }]);
    const e = r.candidates[0]!;
    expect(e.warnings.some((w) => /different mint/.test(w))).toBe(true);
    expect(e.inspection!.mintMatches).toBe(false);
    expect(e.risk!.mintMatches).toBe(false);
  });
});

describe("buildSniperTokenPreflightReport — aggregate + projection", () => {
  it("counts pass/warn/fail/unknown across a mixed list", () => {
    const r = build(listOf(["pass", USDC], ["warn", WSOL], ["fail", SYSTEM], ["unk", USDC]), [
      { candidateId: "pass", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
      { candidateId: "warn", inspection: freezeInspection(WSOL) },
      { candidateId: "fail", risk: riskReject(SYSTEM) },
    ]);
    expect(r.passCount).toBe(1);
    expect(r.warnCount).toBe(1);
    expect(r.failCount).toBe(1);
    expect(r.unknownCount).toBe(1);
    expect(r.candidateCount).toBe(4);
  });

  it("projects the most-severe risk flags first (capped) and counts severities", () => {
    const risk = {
      mint: USDC,
      score: 80,
      decision: "REJECT",
      flags: [
        { id: "low1", severity: "low", title: "Low" },
        { id: "crit1", severity: "critical", title: "Critical" },
        { id: "high1", severity: "high", title: "High" },
      ],
      summary: [],
    };
    const r = build(listOf(["c1", USDC]), [{ candidateId: "c1", risk }]);
    const rk = r.candidates[0]!.risk!;
    expect(rk.topFlags[0]!.severity).toBe("critical");
    expect(rk.criticalFlagCount).toBe(1);
    expect(rk.highFlagCount).toBe(1);
    expect(rk.flagCount).toBe(3);
  });

  it("treats a malformed inspection/risk value as absent (defensive projection)", () => {
    const r = build(listOf(["c1", USDC]), [{ candidateId: "c1", inspection: "not-an-object" }]);
    const e = r.candidates[0]!;
    expect(e.inspection).toBeNull();
    expect(e.status).toBe("unknown");
  });
});

describe("buildSniperTokenPreflightReport — determinism + rejection", () => {
  it("is byte-stable and carries no timestamp", () => {
    const list = listOf(["c1", USDC], ["c2", WSOL]);
    const data: SniperPreflightCandidateData[] = [{ candidateId: "c1", risk: riskCaution(USDC) }];
    const first = JSON.stringify(build(list, data));
    const second = JSON.stringify(build(list, data));
    expect(first).toBe(second);
    expect(first).not.toMatch(/"generatedAt"|"createdAt"|"timestamp"|"ranAt"/);
  });

  it("does not mutate its inputs", () => {
    const list = listOf(["c1", USDC]);
    const data: SniperPreflightCandidateData[] = [{ candidateId: "c1", inspection: cleanInspection(USDC) }];
    const before = JSON.stringify({ list, data });
    build(list, data);
    expect(JSON.stringify({ list, data })).toBe(before);
  });

  it("refuses a non-candidate-list input", () => {
    expect(() => buildSniperTokenPreflightReport({ candidateList: { schemaVersion: "x" } })).toThrow(
      SniperTokenPreflightReportError,
    );
  });

  it("refuses candidateData referencing an unknown candidateId", () => {
    expect(() => build(listOf(["c1", USDC]), [{ candidateId: "ghost", risk: riskPass(USDC) }])).toThrow(
      /unknown candidateId "ghost"/,
    );
  });

  it("refuses duplicate candidateData for the same candidateId", () => {
    expect(() =>
      build(listOf(["c1", USDC]), [
        { candidateId: "c1", risk: riskPass(USDC) },
        { candidateId: "c1", inspection: cleanInspection(USDC) },
      ]),
    ).toThrow(/duplicate candidateData/);
  });
});

describe("validateSniperTokenPreflightReport", () => {
  const sample = () =>
    build(listOf(["c1", USDC], ["c2", WSOL]), [
      { candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
      { candidateId: "c2", risk: riskReject(WSOL) },
    ]);

  it("accepts a freshly-built report (round-trips through JSON)", () => {
    expect(() => validateSniperTokenPreflightReport(JSON.parse(JSON.stringify(sample())))).not.toThrow();
  });

  it("rejects a wrong schemaVersion and a non-object", () => {
    expect(() => validateSniperTokenPreflightReport(null)).toThrow(SniperTokenPreflightReportError);
    const r = JSON.parse(JSON.stringify(sample())) as { schemaVersion: string };
    r.schemaVersion = "sniper.token.preflight.report.v2";
    expect(() => validateSniperTokenPreflightReport(r)).toThrow(/schemaVersion/);
  });

  it("rejects a CI gate that does not mirror its flag", () => {
    const r = JSON.parse(JSON.stringify(sample())) as SniperTokenPreflightReport;
    r.wouldFailOnFail = !r.hasFail;
    expect(() => validateSniperTokenPreflightReport(r)).toThrow(/must mirror/);
  });

  it("rejects an entry whose disqualifier does not imply a fail status", () => {
    const r = JSON.parse(JSON.stringify(sample())) as SniperTokenPreflightReport;
    r.candidates[0]!.disqualifiers = ["forced"];
    r.candidates[0]!.status = "warn";
    expect(() => validateSniperTokenPreflightReport(r)).toThrow(/requires status "fail"/);
  });
});

describe("formatSniperTokenPreflightReport", () => {
  it("renders a stable, sectioned PAPER-ONLY human report", () => {
    const r = build(listOf(["c1", USDC], ["c2", WSOL]), [
      { candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
      { candidateId: "c2", inspection: freezeInspection(WSOL), risk: riskReject(WSOL) },
    ]);
    const text = formatSniperTokenPreflightReport(r);
    expect(text).toBe(formatSniperTokenPreflightReport(r)); // deterministic
    expect(text).toContain(SNIPER_TOKEN_PREFLIGHT_REPORT_BANNER);
    expect(text).toContain("PAPER ONLY");
    expect(text).toContain("[FAIL]");
    expect(text).toContain("[PASS]");
    expect(text.toLowerCase()).toContain("not a trade signal");
    expect(r.schemaVersion).toBe(SNIPER_TOKEN_PREFLIGHT_REPORT_SCHEMA_VERSION);
  });

  it("routes the whole output through the shared redactor", () => {
    const secretish = "a".repeat(64); // a 64-char hex-looking token the redactor must mask
    const list = normalizeSniperCandidateList({ sourceLabel: secretish, candidates: [{ candidateId: "c1", mint: USDC }] });
    const text = formatSniperTokenPreflightReport(buildSniperTokenPreflightReport({ candidateList: list }));
    expect(text).toContain(REDACTED);
    expect(text).not.toContain(secretish);
  });
});
