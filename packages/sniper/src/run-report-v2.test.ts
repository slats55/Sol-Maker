/**
 * Tests for the Sprint 50 SNIPER RUN REPORT V2 (`sniper.run.report.v2`). All inputs are INJECTED,
 * offline test data fed through the REAL builders (candidate list → preflight → decision v1/v2 →
 * run report). Nothing here is a live result or a trade signal.
 */

import { describe, it, expect } from "vitest";
import {
  buildSniperRunReportV2,
  validateSniperRunReportV2,
  formatSniperRunReportV2,
  upgradeSniperRunReportV1ToV2,
  SniperRunReportV2Error,
  SNIPER_RUN_REPORT_V2_SCHEMA_VERSION,
  SNIPER_RUN_REPORT_V2_BANNER,
} from "./run-report-v2.js";
import { buildSniperRunReport, validateSniperRunReport } from "./run-report.js";
import { buildPaperSniperDecisionReport } from "./paper-decision.js";
import { buildPaperSniperDecisionReportV2 } from "./paper-decision-v2.js";
import { normalizeSniperPolicyConfig } from "./policy-config.js";
import { normalizeSniperPolicyConfigV2 } from "./policy-config-v2.js";
import { normalizeSniperPreflightInput } from "./preflight-input.js";
import { normalizeSniperCandidateList, type SniperCandidateInput } from "./candidate-list.js";
import { buildSniperTokenPreflightReport, type SniperPreflightCandidateData } from "./token-preflight.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

const listOf = (...cands: SniperCandidateInput[]) =>
  normalizeSniperCandidateList({ sourceLabel: "test", candidates: cands });
const cand = (over: Partial<SniperCandidateInput> & { candidateId: string; mint: string }): SniperCandidateInput => over;
const cleanInspection = (mint: string) => ({ mint, decimals: 6, supplyRaw: "1", uiSupply: 1, mintAuthorityPresent: false, freezeAuthorityPresent: false, isInitialized: true, programLabel: "spl-token" });
const riskPass = (mint: string) => ({ mint, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [], summary: [] });
const riskReject = (mint: string) => ({ mint, score: 95, decision: "REJECT", flags: [{ id: "rug", severity: "critical", title: "Rug" }], summary: [] });
const preflightFor = (list: ReturnType<typeof listOf>, data: SniperPreflightCandidateData[]) =>
  buildSniperTokenPreflightReport({ candidateList: list, candidateData: data });

/** A standard two-candidate scenario: one clean paper-enter, one risk-rejected. */
function scenario() {
  const list = listOf(cand({ candidateId: "good", mint: USDC }), cand({ candidateId: "bad", mint: WSOL }));
  const pf = preflightFor(list, [
    { candidateId: "good", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
    { candidateId: "bad", risk: riskReject(WSOL) },
  ]);
  return { list, pf };
}

describe("buildSniperRunReportV2 — with a v2 decision (reason-code rollups)", () => {
  it("carries the rollup, per-candidate trails, and the decision schemaVersion verbatim", () => {
    const { list, pf } = scenario();
    const decision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf });
    const r = buildSniperRunReportV2({ candidateList: list, preflight: pf, decision });
    expect(r.schemaVersion).toBe(SNIPER_RUN_REPORT_V2_SCHEMA_VERSION);
    expect(r.banner).toBe(SNIPER_RUN_REPORT_V2_BANNER);
    expect(r.decisionSchemaVersion).toBe("sniper.paper.decision.report.v2");
    expect(r.reasonCodeRollup).not.toBeNull();
    expect(r.reasonCodeRollup!.reasonCodeCounts).toEqual(decision.reasonCodeCounts);
    expect(r.reasonCodeRollup!.blockingReasonCodeCounts).toEqual({ "preflight-fail": 1, "risk-blocked": 1 });
    expect(r.candidates.find((c) => c.candidateId === "bad")!.reasonCodes).toEqual([
      "preflight-fail",
      "risk-blocked",
      "paper-reject-candidate",
    ]);
    // the v1 core join is intact
    expect(r.paperEnterIds).toEqual(["good"]);
    expect(r.riskBlockedIds).toEqual(["bad"]);
    expect(r.upgradedFromV1).toBe(false);
    expect(() => validateSniperRunReportV2(r)).not.toThrow();
  });

  it("is deterministic (same inputs, byte-identical report)", () => {
    const { list, pf } = scenario();
    const decision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf });
    const a = buildSniperRunReportV2({ candidateList: list, preflight: pf, decision });
    const b = buildSniperRunReportV2({ candidateList: list, preflight: pf, decision });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("buildSniperRunReportV2 — with a v1 decision (no invented rollup)", () => {
  it("keeps the rollup null and every trail empty; never invents codes", () => {
    const { list, pf } = scenario();
    const decision = buildPaperSniperDecisionReport({ candidateList: list, preflight: pf });
    const r = buildSniperRunReportV2({ candidateList: list, preflight: pf, decision });
    expect(r.decisionSchemaVersion).toBe("sniper.paper.decision.report.v1");
    expect(r.reasonCodeRollup).toBeNull();
    expect(r.candidates.every((c) => c.reasonCodes.length === 0)).toBe(true);
    expect(r.policySummary.appliedPerDecision).toBeNull();
    expect(() => validateSniperRunReportV2(r)).not.toThrow();
  });
});

describe("buildSniperRunReportV2 — policy visibility + preflight-input coverage", () => {
  it("echoes the decision's policy facts and the supplied v2 policy's mode + risk limits", () => {
    const { list, pf } = scenario();
    const policy = normalizeSniperPolicyConfigV2({ policyLabel: "ops", policyMode: "research-only" });
    const decision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy });
    const r = buildSniperRunReportV2({ candidateList: list, preflight: pf, decision, policy });
    expect(r.policySummary.appliedPerDecision).toBe(true);
    expect(r.policySummary.policyLabel).toBe("ops");
    expect(r.policySummary.policySchemaVersion).toBe("sniper.policy.config.v2");
    expect(r.policySummary.suppliedPolicySchemaVersion).toBe("sniper.policy.config.v2");
    expect(r.policySummary.policyMode).toBe("research-only");
    expect(r.policySummary.riskLimits).not.toBeNull();
    expect(() => validateSniperRunReportV2(r)).not.toThrow();
  });

  it("surfaces a policy/decision schemaVersion mismatch as a warning", () => {
    const { list, pf } = scenario();
    const policyV1 = normalizeSniperPolicyConfig({ policyLabel: "old" });
    const policyV2 = normalizeSniperPolicyConfigV2({ policyLabel: "new" });
    const decision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy: policyV2 });
    const r = buildSniperRunReportV2({ candidateList: list, preflight: pf, decision, policy: policyV1 });
    expect(r.warnings.some((w) => /differs|but the decision was built with/.test(w))).toBe(true);
  });

  it("carries preflight-input coverage and flags a policy-required-but-missing input as blocking", () => {
    const { list, pf } = scenario();
    const input = normalizeSniperPreflightInput({
      entries: [{ candidateId: "good", mint: USDC, inspection: cleanInspection(USDC), risk: riskPass(USDC) }],
      candidateList: list,
    });
    const policy = normalizeSniperPolicyConfigV2({ riskLimits: { requirePreflightInputArtifact: true } });
    const decision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy });
    const withInput = buildSniperRunReportV2({ candidateList: list, preflight: pf, decision, policy, preflightInput: input });
    expect(withInput.preflightInputCoverage).toEqual({
      entryCount: 1,
      missingInspectionCount: 0,
      missingRiskCount: 0,
      unsupportedShapeCount: 0,
      mintMismatchCount: 0,
      uncoveredCandidateCount: 1,
      validationStatus: "valid-with-warnings",
    });
    expect(withInput.missingRequiredPreflightInput).toBe(false);
    const withoutInput = buildSniperRunReportV2({ candidateList: list, preflight: pf, decision, policy });
    expect(withoutInput.missingRequiredPreflightInput).toBe(true);
    expect(withoutInput.operatorBlockingReasons.some((x) => /requires a validated preflight input/.test(x))).toBe(true);
    expect(() => validateSniperRunReportV2(withInput)).not.toThrow();
    expect(() => validateSniperRunReportV2(withoutInput)).not.toThrow();
  });
});

describe("buildSniperRunReportV2 — unresolved unknowns + operator-blocking reasons", () => {
  it("collects unresolved unknowns and lists every blocking condition deterministically", () => {
    const list = listOf(cand({ candidateId: "mystery", mint: USDC }), cand({ candidateId: "good", mint: WSOL }));
    const pf = preflightFor(list, [{ candidateId: "good", inspection: cleanInspection(WSOL), risk: riskPass(WSOL) }]);
    const decision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf });
    const r = buildSniperRunReportV2({ candidateList: list, preflight: pf, decision });
    expect(r.unresolvedUnknownIds).toEqual(["mystery"]);
    expect(r.operatorBlockingReasons.some((x) => /unresolved/.test(x))).toBe(true);
    expect(r.operatorBlockingReasons.some((x) => /paper-enter/.test(x))).toBe(true);
    const again = buildSniperRunReportV2({ candidateList: list, preflight: pf, decision });
    expect(again.operatorBlockingReasons).toEqual(r.operatorBlockingReasons);
  });

  it("a fully-resolved run with no enters has no blocking reasons", () => {
    const list = listOf(cand({ candidateId: "bad", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "bad", risk: riskReject(USDC) }]);
    const decision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf });
    const r = buildSniperRunReportV2({ candidateList: list, preflight: pf, decision });
    // a risk-block IS a blocking reason; remove it to test the empty path → use a skip-only run
    expect(r.operatorBlockingReasons.some((x) => /risk-blocked/.test(x))).toBe(true);
    const denyList = listOf(cand({ candidateId: "c1", mint: USDC }));
    const denyPf = preflightFor(denyList, [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const denyDecision = buildPaperSniperDecisionReportV2({ candidateList: denyList, preflight: denyPf, rules: { denyMints: [USDC] } });
    const clean = buildSniperRunReportV2({ candidateList: denyList, preflight: denyPf, decision: denyDecision });
    expect(clean.operatorBlockingReasons).toEqual([]);
    expect(clean.unresolvedUnknownIds).toEqual([]);
  });
});

describe("upgradeSniperRunReportV1ToV2 — structured-fields-only adapter", () => {
  it("lifts a v1 run report without inventing rollups or policy facts", () => {
    const { list, pf } = scenario();
    const decision = buildPaperSniperDecisionReport({ candidateList: list, preflight: pf });
    const v1 = buildSniperRunReport({ candidateList: list, preflight: pf, decision });
    expect(() => validateSniperRunReport(v1)).not.toThrow();
    const v2 = upgradeSniperRunReportV1ToV2(v1);
    expect(() => validateSniperRunReportV2(v2)).not.toThrow();
    expect(v2.upgradedFromV1).toBe(true);
    expect(v2.reasonCodeRollup).toBeNull();
    expect(v2.policySummary.appliedPerDecision).toBeNull();
    expect(v2.candidates.every((c) => c.reasonCodes.length === 0)).toBe(true);
    expect(v2.decisionSchemaVersion).toBe("sniper.paper.decision.report.v1");
    expect(v2.unresolvedUnknownIds).toEqual([]);
    expect(v2.operatorBlockingReasons.some((x) => /risk-blocked|paper-enter/.test(x))).toBe(true);
    expect(v2.notes.some((n) => /Upgraded from v1/.test(n))).toBe(true);
  });

  it("refuses a non-v1 input", () => {
    expect(() => upgradeSniperRunReportV1ToV2({ schemaVersion: "nope" })).toThrow(SniperRunReportV2Error);
  });
});

describe("v1 compatibility — the v1 run report is unchanged", () => {
  it("v1 build + validate still work and carry no v2 fields", () => {
    const { list, pf } = scenario();
    const v1 = buildSniperRunReport({ candidateList: list, preflight: pf });
    expect(() => validateSniperRunReport(v1)).not.toThrow();
    expect("reasonCodeRollup" in v1).toBe(false);
    expect("operatorBlockingReasons" in v1).toBe(false);
  });
});

describe("validateSniperRunReportV2 — strict backstop", () => {
  const valid = () => {
    const { list, pf } = scenario();
    const decision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf });
    return buildSniperRunReportV2({ candidateList: list, preflight: pf, decision });
  };

  it("rejects wrong schema/banner, unknown entry codes, tampered blocking counts, tampered unknowns", () => {
    const a = JSON.parse(JSON.stringify(valid()));
    a.schemaVersion = "sniper.run.report.v1";
    expect(() => validateSniperRunReportV2(a)).toThrow(/schemaVersion/);

    const b = JSON.parse(JSON.stringify(valid()));
    b.candidates[0].reasonCodes = ["not-a-code"];
    expect(() => validateSniperRunReportV2(b)).toThrow(/unknown code/);

    const c = JSON.parse(JSON.stringify(valid()));
    c.reasonCodeRollup.blockingReasonCodeCounts = { "preflight-fail": 99 };
    expect(() => validateSniperRunReportV2(c)).toThrow(/recomputed blocking counts/);

    const d = JSON.parse(JSON.stringify(valid()));
    d.unresolvedUnknownIds = ["ghost"];
    expect(() => validateSniperRunReportV2(d)).toThrow(/recomputed unresolved set/);
  });
});

describe("formatSniperRunReportV2 — deterministic operator output", () => {
  it("renders the v1 body plus the v2 sections, closing with the disclaimers", () => {
    const { list, pf } = scenario();
    const policy = normalizeSniperPolicyConfigV2({ policyLabel: "fmt" });
    const decision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy });
    const r = buildSniperRunReportV2({ candidateList: list, preflight: pf, decision, policy });
    const text = formatSniperRunReportV2(r, { label: "t" });
    expect(text).toContain(SNIPER_RUN_REPORT_V2_BANNER);
    expect(text).toContain("Candidates:"); // v1 body
    expect(text).toContain("Policy (v2):");
    expect(text).toContain("Reason-code rollup (v2):");
    expect(text).toContain("Preflight-input coverage (v2):");
    expect(text).toContain("Operator-blocking reasons:");
    expect(text.trimEnd().endsWith("No wallet, key, signing, sending, or transaction planning is involved anywhere in this report.")).toBe(true);
    expect(formatSniperRunReportV2(r, { label: "t" })).toBe(text);
  });
});
