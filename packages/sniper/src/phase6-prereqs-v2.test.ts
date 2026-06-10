/**
 * Tests for the Sprint 52 PHASE 6 PREREQUISITE TRACKER V2 (`phase6.prerequisite.report.v2`). All
 * inputs are INJECTED, offline test data built with the REAL builders. The tracker can NEVER
 * authorize Phase 6 or ready Phase 7 — these tests prove the invariants hold in every state.
 */

import { describe, it, expect } from "vitest";
import {
  buildPhase6PrerequisiteReportV2,
  validatePhase6PrerequisiteReportV2,
  formatPhase6PrerequisiteReportV2,
  Phase6PrerequisiteReportV2Error,
  PHASE6_PREREQUISITE_REPORT_V2_SCHEMA_VERSION,
  PHASE6_READINESS_BUCKETS,
  type Phase6PrerequisiteReportV2,
} from "./phase6-prereqs-v2.js";
import { buildPaperSniperDecisionReport } from "./paper-decision.js";
import { buildPaperSniperDecisionReportV2 } from "./paper-decision-v2.js";
import { buildSniperRunReport } from "./run-report.js";
import { buildSniperRunReportV2 } from "./run-report-v2.js";
import { buildSniperSafetyGatesReportV2 } from "./safety-gates-v2.js";
import { buildSniperSessionPack } from "./session-pack.js";
import { buildSniperAuditLog } from "./audit-log.js";
import { normalizeSniperPolicyConfig } from "./policy-config.js";
import { normalizeSniperPolicyConfigV2 } from "./policy-config-v2.js";
import { normalizeSniperCandidateList, type SniperCandidateInput } from "./candidate-list.js";
import { buildSniperTokenPreflightReport, type SniperPreflightCandidateData } from "./token-preflight.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const listOf = (...cands: SniperCandidateInput[]) =>
  normalizeSniperCandidateList({ sourceLabel: "test", candidates: cands });
const cand = (over: Partial<SniperCandidateInput> & { candidateId: string; mint: string }): SniperCandidateInput => over;
const cleanInspection = (mint: string) => ({ mint, decimals: 6, supplyRaw: "1", uiSupply: 1, mintAuthorityPresent: false, freezeAuthorityPresent: false, isInitialized: true, programLabel: "spl-token" });
const riskPass = (mint: string) => ({ mint, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [], summary: [] });
const preflightFor = (list: ReturnType<typeof listOf>, data: SniperPreflightCandidateData[]) =>
  buildSniperTokenPreflightReport({ candidateList: list, candidateData: data });

const bucketOf = (r: Phase6PrerequisiteReportV2, bucket: string) => r.buckets.find((b) => b.bucket === bucket)!;

/** Build every artifact the v2 tracker can consume — a GENUINELY clean, governed session: the one
 * candidate passes preflight cleanly but is denylisted by the research-only policy, so the run ends
 * with a skip, no risk block, no paper-enter, no unknowns, and no operator-blocking reason. */
function fullInputs(operatorLabel = "op") {
  const list = listOf(cand({ candidateId: "skipme", mint: USDC }));
  const pf = preflightFor(list, [{ candidateId: "skipme", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
  const policy = normalizeSniperPolicyConfigV2({ policyLabel: "gov", policyMode: "research-only", denyMints: [USDC] });
  const decision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy });
  const runReport = buildSniperRunReportV2({ candidateList: list, preflight: pf, decision, policy });
  const decisionV1 = buildPaperSniperDecisionReport({ candidateList: list, preflight: pf, rules: { denyMints: [USDC] } });
  const runV1 = buildSniperRunReport({ candidateList: list, preflight: pf, decision: decisionV1 });
  const auditLog = buildSniperAuditLog({ runReport: runV1, runLabel: "run" });
  const sessionPack = buildSniperSessionPack({
    sessionLabel: "s",
    artifacts: [
      { label: "candidates", value: list },
      { label: "decision", value: decisionV1 },
      { label: "audit", value: auditLog },
    ],
  });
  const safetyGates = buildSniperSafetyGatesReportV2({
    candidateList: list,
    preflight: pf,
    policy,
    decision,
    runReport,
    sessionPack,
    auditLog,
  });
  return { sessionPack, policy, safetyGates, decision, runReport, auditLog, operatorLabel };
}

describe("buildPhase6PrerequisiteReportV2 — incomplete inputs (fail-closed)", () => {
  it("an empty input is far from ready: every checkable bucket not-ready", () => {
    const r = buildPhase6PrerequisiteReportV2({});
    expect(r.schemaVersion).toBe(PHASE6_PREREQUISITE_REPORT_V2_SCHEMA_VERSION);
    expect(r.phase6ImplementationReady).toBe(false);
    for (const bucket of ["artifact", "policy", "safety", "audit", "operator", "kill-switch", "secrets-policy", "burner-isolation"]) {
      expect(bucketOf(r, bucket).ready, `${bucket} must not be ready`).toBe(false);
    }
    expect(bucketOf(r, "test").ready).toBe(true); // design-documented
    expect(() => validatePhase6PrerequisiteReportV2(r)).not.toThrow();
  });

  it("an INVALID artifact keeps its item not-met with the validation error surfaced", () => {
    const r = buildPhase6PrerequisiteReportV2({ decision: { schemaVersion: "sniper.paper.decision.report.v1" } });
    const item = r.prerequisites.find((p) => p.id === "DECISION_V2")!;
    expect(item.status).toBe("not-met");
    expect(item.reason).toMatch(/INVALID/);
    expect(item.reason).toMatch(/sniper\.paper\.decision\.report\.v2/);
  });

  it("a v1 policy meets POLICY_PRESENT but not POLICY_V2_RISK_LIMITS (upgrade nudge)", () => {
    const v1Policy = normalizeSniperPolicyConfig({ policyLabel: "old" });
    const r = buildPhase6PrerequisiteReportV2({ policy: v1Policy });
    expect(r.prerequisites.find((p) => p.id === "POLICY_PRESENT")!.status).toBe("met");
    const limits = r.prerequisites.find((p) => p.id === "POLICY_V2_RISK_LIMITS")!;
    expect(limits.status).toBe("not-met");
    expect(limits.reason).toMatch(/upgrade to v2/);
    expect(bucketOf(r, "policy").ready).toBe(false);
  });
});

describe("buildPhase6PrerequisiteReportV2 — complete-for-pure-simulation (everything available today)", () => {
  it("with every available artifact ready, ONLY the three spec buckets remain not-met", () => {
    const inputs = fullInputs();
    const r = buildPhase6PrerequisiteReportV2(inputs);
    expect(bucketOf(r, "artifact").ready).toBe(true);
    expect(bucketOf(r, "policy").ready).toBe(true);
    expect(bucketOf(r, "safety").ready).toBe(true);
    expect(bucketOf(r, "audit").ready).toBe(true);
    expect(bucketOf(r, "operator").ready).toBe(true);
    expect(bucketOf(r, "test").ready).toBe(true);
    // the spec artifacts do not exist yet — readiness stays fail-closed
    expect(bucketOf(r, "kill-switch").ready).toBe(false);
    expect(bucketOf(r, "secrets-policy").ready).toBe(false);
    expect(bucketOf(r, "burner-isolation").ready).toBe(false);
    expect(r.phase6ImplementationReady).toBe(false);
    expect(r.notMet).toEqual(["KILL_SWITCH_SPEC_ARTIFACT", "SECRETS_POLICY_ARTIFACT", "BURNER_ISOLATION_SPEC_ARTIFACT"]);
    expect(() => validatePhase6PrerequisiteReportV2(r)).not.toThrow();
  });

  it("is deterministic", () => {
    const inputs = fullInputs();
    expect(JSON.stringify(buildPhase6PrerequisiteReportV2(inputs))).toBe(JSON.stringify(buildPhase6PrerequisiteReportV2(inputs)));
  });
});

describe("the tracker can NEVER authorize Phase 6 or ready Phase 7", () => {
  it("the hard invariants hold in every state (empty AND complete)", () => {
    for (const r of [buildPhase6PrerequisiteReportV2({}), buildPhase6PrerequisiteReportV2(fullInputs())]) {
      expect(r.phase6ImplementationStarted).toBe(false);
      expect(r.requiresExplicitHumanApproval).toBe(true);
      expect(r.phase7LiveTradingReady).toBe(false);
      expect(r.neverAuthorizesLiveTrading).toBe(true);
    }
  });

  it("no authorization string appears anywhere in the serialized report", () => {
    const r = buildPhase6PrerequisiteReportV2(fullInputs());
    const json = JSON.stringify(r).toLowerCase();
    expect(json).not.toMatch(/authorization granted|authorized to (start|begin|trade)|go live/);
  });

  it("the validator REFUSES any tampered invariant", () => {
    const r = buildPhase6PrerequisiteReportV2(fullInputs());
    for (const [field, bad] of [
      ["phase6ImplementationStarted", true],
      ["requiresExplicitHumanApproval", false],
      ["phase7LiveTradingReady", true],
      ["neverAuthorizesLiveTrading", false],
    ] as const) {
      const tampered = JSON.parse(JSON.stringify(r));
      tampered[field] = bad;
      expect(() => validatePhase6PrerequisiteReportV2(tampered), field).toThrow(/ALWAYS/);
    }
  });
});

describe("validatePhase6PrerequisiteReportV2 — strict backstop", () => {
  it("rejects tampered bucket rollups, notMet lists, and a forged ready flag", () => {
    const r = buildPhase6PrerequisiteReportV2(fullInputs());
    const a = JSON.parse(JSON.stringify(r));
    a.buckets[0].metCount = 0;
    expect(() => validatePhase6PrerequisiteReportV2(a)).toThrow(/recomputed rollup/);

    const b = JSON.parse(JSON.stringify(r));
    b.notMet = [];
    expect(() => validatePhase6PrerequisiteReportV2(b)).toThrow(/recomputed not-met/);

    const c = JSON.parse(JSON.stringify(r));
    c.phase6ImplementationReady = true; // but the spec buckets are not ready
    expect(() => validatePhase6PrerequisiteReportV2(c)).toThrow(/mirror the bucket rollups/);
  });

  it("every readiness bucket name is covered by the report", () => {
    const r = buildPhase6PrerequisiteReportV2({});
    expect(r.buckets.map((b) => b.bucket)).toEqual([...PHASE6_READINESS_BUCKETS]);
  });
});

describe("formatPhase6PrerequisiteReportV2 — deterministic operator output", () => {
  it("shows the NOT-AUTHORIZATION banner, the bucket rollup, and the never-live invariants", () => {
    const r = buildPhase6PrerequisiteReportV2(fullInputs());
    const text = formatPhase6PrerequisiteReportV2(r, { label: "t" });
    expect(text).toContain("PHASE 6 PREREQUISITE TRACKER V2 (PAPER-ONLY, NOT AUTHORIZATION)");
    expect(text).toContain("phase6ImplementationReady: NO");
    expect(text).toContain("phase7LiveTradingReady: false");
    expect(text).toContain("✗ Kill-switch readiness: 0/1");
    expect(text).toContain("✓ Safety readiness: 2/2");
    expect(formatPhase6PrerequisiteReportV2(r, { label: "t" })).toBe(text);
  });
});

describe("input shape errors", () => {
  it("refuses a non-object input and a bad operatorLabel", () => {
    expect(() => buildPhase6PrerequisiteReportV2(42 as never)).toThrow(Phase6PrerequisiteReportV2Error);
    expect(() => buildPhase6PrerequisiteReportV2({ operatorLabel: 42 as never })).toThrow(/operatorLabel/);
  });
});
