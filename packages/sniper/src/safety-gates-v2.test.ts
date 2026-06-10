/**
 * Tests for the Sprint 51 SNIPER SAFETY GATES V2 (`sniper.safety.gates.report.v2`). All inputs are
 * INJECTED, offline test data fed through the REAL builders. Passing every gate is local/paper
 * readiness only — these gates can NEVER authorize Phase 6, and the tests prove it.
 */

import { describe, it, expect } from "vitest";
import {
  buildSniperSafetyGatesReportV2,
  validateSniperSafetyGatesReportV2,
  formatSniperSafetyGatesReportV2,
  SNIPER_SAFETY_GATES_REPORT_V2_SCHEMA_VERSION,
  SNIPER_SAFETY_GATES_REPORT_V2_BANNER,
  type SniperSafetyGatesReportV2,
} from "./safety-gates-v2.js";
import { buildPaperSniperDecisionReport } from "./paper-decision.js";
import { buildPaperSniperDecisionReportV2 } from "./paper-decision-v2.js";
import { buildSniperRunReport } from "./run-report.js";
import { buildSniperRunReportV2 } from "./run-report-v2.js";
import { buildSniperSessionPack } from "./session-pack.js";
import { buildSniperAuditLog } from "./audit-log.js";
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

const gate = (r: SniperSafetyGatesReportV2, id: string) => r.gates.find((g) => g.id === id)!;

/** A complete, conservatively-clean session: one rejected candidate, governed by a research-only policy. */
function fullSession() {
  const list = listOf(cand({ candidateId: "bad", mint: USDC }));
  const pf = preflightFor(list, [{ candidateId: "bad", risk: riskReject(USDC) }]);
  const policy = normalizeSniperPolicyConfigV2({ policyLabel: "gov", policyMode: "research-only" });
  const preflightInput = normalizeSniperPreflightInput({
    entries: [{ candidateId: "bad", mint: USDC, risk: riskReject(USDC) }],
    candidateList: list,
  });
  const decision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy });
  const runReport = buildSniperRunReportV2({ candidateList: list, preflight: pf, decision, policy, preflightInput });
  // The audit log + session pack still consume v1-shaped artifacts (S33/S34 — unchanged).
  const decisionV1 = buildPaperSniperDecisionReport({ candidateList: list, preflight: pf });
  const runV1 = buildSniperRunReport({ candidateList: list, preflight: pf, decision: decisionV1 });
  const auditLog = buildSniperAuditLog({ runReport: runV1, runLabel: "test-run" });
  const sessionPack = buildSniperSessionPack({
    sessionLabel: "s",
    artifacts: [
      { label: "candidates", value: list },
      { label: "decision", value: decisionV1 },
      { label: "audit", value: auditLog },
    ],
  });
  return { list, pf, policy, preflightInput, decision, runReport, auditLog, sessionPack };
}

describe("buildSniperSafetyGatesReportV2 — ready / not-ready", () => {
  it("a complete governed session is READY (blocking codes warned under the policy)", () => {
    const s = fullSession();
    const r = buildSniperSafetyGatesReportV2({
      candidateList: s.list,
      preflightInput: s.preflightInput,
      preflight: s.pf,
      policy: s.policy,
      decision: s.decision,
      runReport: s.runReport,
      sessionPack: s.sessionPack,
      auditLog: s.auditLog,
    });
    expect(r.schemaVersion).toBe(SNIPER_SAFETY_GATES_REPORT_V2_SCHEMA_VERSION);
    expect(r.banner).toBe(SNIPER_SAFETY_GATES_REPORT_V2_BANNER);
    expect(r.ready).toBe(true);
    expect(gate(r, "NO_UNGOVERNED_BLOCKING_CODES").status).toBe("warn");
    expect(gate(r, "NO_PAPER_ENTER").status).toBe("pass");
    expect(r.neverAuthorizesPhase6).toBe(true);
    expect(() => validateSniperSafetyGatesReportV2(r)).not.toThrow();
  });

  it("an empty input is NOT ready (every required artifact gate fails) — fail-closed default", () => {
    const r = buildSniperSafetyGatesReportV2({});
    expect(r.ready).toBe(false);
    expect(gate(r, "CANDIDATE_LIST_VALID").status).toBe("fail");
    expect(gate(r, "DECISION_V2_VALID").status).toBe("fail");
    expect(gate(r, "RUN_REPORT_V2_VALID").status).toBe("fail");
    expect(gate(r, "SESSION_PACK_PRESENT").status).toBe("fail");
    expect(gate(r, "AUDIT_LOG_PRESENT").status).toBe("fail");
    // the code gates skip deterministically when there is no decision to read
    expect(gate(r, "NO_UNKNOWNS").status).toBe("skip");
    expect(() => validateSniperSafetyGatesReportV2(r)).not.toThrow();
  });

  it("a present-but-INVALID artifact fails its gate with the validation error", () => {
    const r = buildSniperSafetyGatesReportV2({ candidateList: { schemaVersion: "nope" } });
    const g = gate(r, "CANDIDATE_LIST_VALID");
    expect(g.status).toBe("fail");
    expect(g.reason).toMatch(/INVALID/);
    expect(r.artifactsChecked.candidateList).toEqual({ present: true, valid: false });
  });

  it("a v1 decision FAILS the decision gate (the code-aware checks need v2 — fail-closed)", () => {
    const s = fullSession();
    const v1Decision = buildPaperSniperDecisionReport({ candidateList: s.list, preflight: s.pf });
    const r = buildSniperSafetyGatesReportV2({ candidateList: s.list, decision: v1Decision });
    const g = gate(r, "DECISION_V2_VALID");
    expect(g.status).toBe("fail");
    expect(g.reason).toMatch(/need sniper\.paper\.decision\.report\.v2/);
    expect(r.ready).toBe(false);
  });
});

describe("policy-derived allowances (the policy is the single source)", () => {
  const enterSession = () => {
    const list = listOf(cand({ candidateId: "good", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "good", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    return { list, pf };
  };

  it("paper-enters FAIL with no policy and WARN when the policy allows them", () => {
    const { list, pf } = enterSession();
    const decision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf });
    const noPolicy = buildSniperSafetyGatesReportV2({ candidateList: list, decision });
    expect(gate(noPolicy, "NO_PAPER_ENTER").status).toBe("fail");
    expect(noPolicy.policyDerivedAllowances.paperEnterAllowedByPolicy).toBe(false);

    const policy = normalizeSniperPolicyConfigV2({ policyLabel: "open", allowPaperEnter: true });
    const decisionGoverned = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy });
    const withPolicy = buildSniperSafetyGatesReportV2({ candidateList: list, decision: decisionGoverned, policy });
    expect(gate(withPolicy, "NO_PAPER_ENTER").status).toBe("warn");
    expect(withPolicy.policyDerivedAllowances.paperEnterAllowedByPolicy).toBe(true);
  });

  it("unknowns FAIL under a fail-closed policy and WARN when the policy tolerates them", () => {
    const list = listOf(cand({ candidateId: "mystery", mint: USDC }));
    const pf = preflightFor(list, []); // unknown status
    const strict = normalizeSniperPolicyConfigV2({});
    const strictDecision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy: strict });
    const strictGates = buildSniperSafetyGatesReportV2({ candidateList: list, decision: strictDecision, policy: strict });
    // under the strict policy the unknown was fail-closed REJECTED, so no unknown remains…
    expect(gate(strictGates, "NO_UNKNOWNS").status).toBe("pass");

    const tolerant = normalizeSniperPolicyConfigV2({ failClosedOnUnknownPreflight: false });
    const tolerantDecision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy: tolerant });
    const tolerantGates = buildSniperSafetyGatesReportV2({ candidateList: list, decision: tolerantDecision, policy: tolerant });
    expect(gate(tolerantGates, "NO_UNKNOWNS").status).toBe("warn"); // present, but tolerated by policy

    const ungoverned = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf });
    const ungovernedGates = buildSniperSafetyGatesReportV2({ candidateList: list, decision: ungoverned });
    expect(gate(ungovernedGates, "NO_UNKNOWNS").status).toBe("fail"); // nothing tolerated without a policy
  });

  it("blocking codes FAIL without a governing policy", () => {
    const list = listOf(cand({ candidateId: "bad", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "bad", risk: riskReject(USDC) }]);
    const decision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf });
    const r = buildSniperSafetyGatesReportV2({ candidateList: list, decision });
    expect(gate(r, "NO_UNGOVERNED_BLOCKING_CODES").status).toBe("fail");
  });
});

describe("required-section gates (policy v2 riskLimits)", () => {
  it("RISK_PRESENT_WHEN_REQUIRED fails when the policy demands risk and a candidate lacks it", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC) }]); // no risk
    const policy = normalizeSniperPolicyConfigV2({});
    const decision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy });
    const r = buildSniperSafetyGatesReportV2({ candidateList: list, decision, policy });
    expect(gate(r, "RISK_PRESENT_WHEN_REQUIRED").status).toBe("fail");
    expect(r.ready).toBe(false);
  });

  it("INSPECTION_PRESENT_WHEN_REQUIRED fails when required and missing; both SKIP when not demanded", () => {
    const list = listOf(cand({ candidateId: "c1", mint: WSOL }));
    const pf = preflightFor(list, [{ candidateId: "c1", risk: riskPass(WSOL) }]); // no inspection
    const demanding = normalizeSniperPolicyConfigV2({ riskLimits: { requireInspectionPresent: true } });
    const decision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy: demanding });
    const r = buildSniperSafetyGatesReportV2({ candidateList: list, decision, policy: demanding });
    expect(gate(r, "INSPECTION_PRESENT_WHEN_REQUIRED").status).toBe("fail");

    const lax = normalizeSniperPolicyConfigV2({ failClosedOnMissingRisk: false, riskLimits: { requireRiskPresent: false } });
    const laxDecision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy: lax });
    const laxGates = buildSniperSafetyGatesReportV2({ candidateList: list, decision: laxDecision, policy: lax });
    expect(gate(laxGates, "RISK_PRESENT_WHEN_REQUIRED").status).toBe("skip");
    expect(gate(laxGates, "INSPECTION_PRESENT_WHEN_REQUIRED").status).toBe("skip");
  });

  it("PREFLIGHT_INPUT_VALID is required (fails) when the policy demands the artifact", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const policy = normalizeSniperPolicyConfigV2({ riskLimits: { requirePreflightInputArtifact: true } });
    const decision = buildPaperSniperDecisionReportV2({ candidateList: list, policy });
    const r = buildSniperSafetyGatesReportV2({ candidateList: list, decision, policy });
    const g = gate(r, "PREFLIGHT_INPUT_VALID");
    expect(g.required).toBe(true);
    expect(g.status).toBe("fail");
  });
});

describe("Phase 6 can NEVER be authorized", () => {
  it("even a fully-ready report carries neverAuthorizesPhase6=true and a permanently-skip boundary gate", () => {
    const s = fullSession();
    const r = buildSniperSafetyGatesReportV2({
      candidateList: s.list,
      preflightInput: s.preflightInput,
      preflight: s.pf,
      policy: s.policy,
      decision: s.decision,
      runReport: s.runReport,
      sessionPack: s.sessionPack,
      auditLog: s.auditLog,
    });
    expect(r.ready).toBe(true);
    expect(r.neverAuthorizesPhase6).toBe(true);
    expect(gate(r, "PHASE6_NOT_AUTO_AUTHORIZED").status).toBe("skip");
    expect(r.recommendation).toMatch(/NEVER Phase 6 authorization/);
    // no "authorized" string anywhere in the serialized report
    expect(JSON.stringify(r)).not.toMatch(/phase\s*6\s+authorized|authorization granted/i);
  });

  it("the validator REFUSES a report whose boundary gate was tampered to pass or whose flag is false", () => {
    const s = fullSession();
    const r = buildSniperSafetyGatesReportV2({ candidateList: s.list, decision: s.decision, policy: s.policy });
    const a = JSON.parse(JSON.stringify(r));
    a.neverAuthorizesPhase6 = false;
    expect(() => validateSniperSafetyGatesReportV2(a)).toThrow(/neverAuthorizesPhase6/);

    const b = JSON.parse(JSON.stringify(r));
    const boundary = (b.gates as { id: string; status: string }[]).find((g) => g.id === "PHASE6_NOT_AUTO_AUTHORIZED")!;
    boundary.status = "pass";
    b.passCount += 1;
    b.skipCount -= 1;
    expect(() => validateSniperSafetyGatesReportV2(b)).toThrow(/PHASE6_NOT_AUTO_AUTHORIZED/);
  });
});

describe("validateSniperSafetyGatesReportV2 — strict backstop", () => {
  it("rejects tampered counts and a ready flag that does not mirror the required gates", () => {
    const s = fullSession();
    const r = buildSniperSafetyGatesReportV2({ candidateList: s.list, decision: s.decision, policy: s.policy });
    const a = JSON.parse(JSON.stringify(r));
    a.passCount += 1;
    expect(() => validateSniperSafetyGatesReportV2(a)).toThrow(/recomputed tally/);

    const b = JSON.parse(JSON.stringify(r));
    b.ready = !b.ready;
    expect(() => validateSniperSafetyGatesReportV2(b)).toThrow(/mirror the required gates/);
  });
});

describe("formatSniperSafetyGatesReportV2 — deterministic operator output", () => {
  it("shows READY, the artifact checklist, the gates, and the never-authorizes disclaimers", () => {
    const s = fullSession();
    const r = buildSniperSafetyGatesReportV2({ candidateList: s.list, decision: s.decision, policy: s.policy });
    const text = formatSniperSafetyGatesReportV2(r, { label: "t" });
    expect(text).toContain(SNIPER_SAFETY_GATES_REPORT_V2_BANNER);
    expect(text).toContain("READY:    NO");
    expect(text).toContain("Artifacts checked:");
    expect(text).toContain("- candidateList: present, valid");
    expect(text).toContain("PHASE6_NOT_AUTO_AUTHORIZED");
    expect(text).toContain("NEVER authorization to start Phase 6");
    expect(formatSniperSafetyGatesReportV2(r, { label: "t" })).toBe(text);
  });
});
