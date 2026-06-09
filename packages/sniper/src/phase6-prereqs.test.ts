/**
 * Tests for the Sprint 40 PHASE 6 PREREQUISITE TRACKER. All inputs are INJECTED session packs. The
 * tracker can NEVER authorize Phase 6: phase6ImplementationStarted is always false and
 * requiresExplicitHumanApproval is always true, even when every prerequisite is addressed.
 */

import { describe, it, expect } from "vitest";
import { REDACTED } from "@soulmaker/security";
import {
  buildPhase6PrerequisiteReport,
  validatePhase6PrerequisiteReport,
  formatPhase6PrerequisiteReport,
  Phase6PrerequisiteReportError,
  PHASE6_PREREQUISITE_REPORT_SCHEMA_VERSION,
  PHASE6_PREREQUISITE_REPORT_BANNER,
  type Phase6PrerequisiteReport,
} from "./phase6-prereqs.js";
import { buildSniperSessionPack, type SniperSessionPackArtifactInput } from "./session-pack.js";
import { normalizeSniperCandidateList, type SniperCandidateInput } from "./candidate-list.js";
import { buildSniperTokenPreflightReport, type SniperPreflightCandidateData } from "./token-preflight.js";
import { buildPaperSniperDecisionReport } from "./paper-decision.js";
import { buildSniperRunReport } from "./run-report.js";
import { buildSniperAuditLog } from "./audit-log.js";
import { normalizeSniperPolicyConfig } from "./policy-config.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const listOf = (...cands: SniperCandidateInput[]) => normalizeSniperCandidateList({ sourceLabel: "src", candidates: cands });
const cand = (over: Partial<SniperCandidateInput> & { candidateId: string; mint: string }): SniperCandidateInput => over;
const cleanInspection = (mint: string) => ({ mint, decimals: 6, supplyRaw: "1", uiSupply: 1, mintAuthorityPresent: false, freezeAuthorityPresent: false, isInitialized: true, programLabel: "spl-token" });
const riskPass = (mint: string) => ({ mint, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [], summary: [] });
const art = (label: string, value: unknown): SniperSessionPackArtifactInput => ({ label, value });

/** A session pack with all five artifact prerequisites present. */
function fullPack() {
  const list = listOf(cand({ candidateId: "c1", mint: USDC }));
  const preflight = buildSniperTokenPreflightReport({ candidateList: list, candidateData: [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }] as SniperPreflightCandidateData[] });
  const decision = buildPaperSniperDecisionReport({ candidateList: list, preflight });
  const runReport = buildSniperRunReport({ candidateList: list, preflight, decision });
  const audit = buildSniperAuditLog({ runReport, runLabel: "r" });
  const policy = normalizeSniperPolicyConfig({ policyLabel: "p" });
  return buildSniperSessionPack({ sessionLabel: "full", artifacts: [art("cands", list), art("pf", preflight), art("dec", decision), art("audit", audit), art("policy", policy)] });
}

describe("buildPhase6PrerequisiteReport — checklist", () => {
  it("reports all 5 artifact prereqs met + 6 design prereqs documented for a full session", () => {
    const report = buildPhase6PrerequisiteReport({ sessionPack: fullPack(), operatorLabel: "op" });
    expect(report.schemaVersion).toBe(PHASE6_PREREQUISITE_REPORT_SCHEMA_VERSION);
    expect(report.artifactCount).toBe(5);
    expect(report.artifactMetCount).toBe(5);
    expect(report.designCount).toBe(6);
    expect(report.designDocumentedCount).toBe(6);
    expect(report.artifactPrerequisitesMet).toBe(true);
    expect(report.allPrerequisitesAddressed).toBe(true);
    expect(report.notMet).toEqual([]);
    expect(() => validatePhase6PrerequisiteReport(report)).not.toThrow();
  });

  it("NEVER authorizes Phase 6, even when all prerequisites are addressed", () => {
    const report = buildPhase6PrerequisiteReport({ sessionPack: fullPack() });
    expect(report.phase6ImplementationStarted).toBe(false);
    expect(report.requiresExplicitHumanApproval).toBe(true);
    expect(report.recommendation).toMatch(/NOT authorization to start Phase 6|explicit human decision/);
    expect(report.recommendation).not.toMatch(/you may now start Phase 6|authorized to begin|go ahead/i);
  });

  it("marks missing artifact prereqs not-met (candidate list only)", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pack = buildSniperSessionPack({ artifacts: [art("cands", list)] });
    const report = buildPhase6PrerequisiteReport({ sessionPack: pack });
    expect(report.artifactMetCount).toBe(1); // only candidate intake
    expect(report.notMet).toContain("TOKEN_PREFLIGHT");
    expect(report.notMet).toContain("PAPER_DECISIONS");
    expect(report.notMet).toContain("AUDIT_LOGGING");
    expect(report.notMet).toContain("OPERATOR_CONFIG");
    expect(report.artifactPrerequisitesMet).toBe(false);
    expect(report.allPrerequisitesAddressed).toBe(false);
    // design prereqs are still documented regardless
    expect(report.designDocumentedCount).toBe(6);
  });
});

describe("buildPhase6PrerequisiteReport — determinism + rejection", () => {
  it("is byte-stable and non-mutating", () => {
    const pack = fullPack();
    const before = JSON.stringify(pack);
    const a = JSON.stringify(buildPhase6PrerequisiteReport({ sessionPack: pack }));
    const b = JSON.stringify(buildPhase6PrerequisiteReport({ sessionPack: pack }));
    expect(a).toBe(b);
    expect(JSON.stringify(pack)).toBe(before);
  });

  it("refuses a non-session-pack input", () => {
    expect(() => buildPhase6PrerequisiteReport({ sessionPack: { schemaVersion: "x" } })).toThrow(/session pack is invalid/);
    expect(() => buildPhase6PrerequisiteReport({ sessionPack: fullPack(), operatorLabel: 5 as never })).toThrow(Phase6PrerequisiteReportError);
  });
});

describe("validatePhase6PrerequisiteReport", () => {
  const sample = (): Phase6PrerequisiteReport => buildPhase6PrerequisiteReport({ sessionPack: fullPack() });

  it("accepts a freshly-built report (round-trips through JSON)", () => {
    expect(() => validatePhase6PrerequisiteReport(JSON.parse(JSON.stringify(sample())))).not.toThrow();
  });

  it("enforces the HARD invariants (a tampered phase6ImplementationStarted is refused)", () => {
    const r = JSON.parse(JSON.stringify(sample())) as Phase6PrerequisiteReport;
    (r as unknown as { phase6ImplementationStarted: boolean }).phase6ImplementationStarted = true;
    expect(() => validatePhase6PrerequisiteReport(r)).toThrow(/phase6ImplementationStarted must be false/);
    const r2 = JSON.parse(JSON.stringify(sample())) as Phase6PrerequisiteReport;
    (r2 as unknown as { requiresExplicitHumanApproval: boolean }).requiresExplicitHumanApproval = false;
    expect(() => validatePhase6PrerequisiteReport(r2)).toThrow(/requiresExplicitHumanApproval must be true/);
  });

  it("rejects a wrong schemaVersion and a bad prereq status", () => {
    expect(() => validatePhase6PrerequisiteReport(null)).toThrow(Phase6PrerequisiteReportError);
    const r = JSON.parse(JSON.stringify(sample())) as Phase6PrerequisiteReport;
    (r.prerequisites[0] as unknown as { status: string }).status = "maybe";
    expect(() => validatePhase6PrerequisiteReport(r)).toThrow(/status must be/);
  });
});

describe("formatPhase6PrerequisiteReport", () => {
  it("renders a stable, NOT-AUTHORIZATION human report", () => {
    const report = buildPhase6PrerequisiteReport({ sessionPack: fullPack() });
    const text = formatPhase6PrerequisiteReport(report);
    expect(text).toBe(formatPhase6PrerequisiteReport(report)); // deterministic
    expect(text).toContain(PHASE6_PREREQUISITE_REPORT_BANNER);
    expect(text).toContain("NOT AUTHORIZATION");
    expect(text).toContain("Phase 6 implementation started: NO");
    expect(text.toLowerCase()).toContain("requires explicit human approval");
  });

  it("routes the whole output through the shared redactor", () => {
    const secretish = "a".repeat(64);
    const list = normalizeSniperCandidateList({ sourceLabel: secretish, candidates: [{ candidateId: "c1", mint: USDC }] });
    const pack = buildSniperSessionPack({ sessionLabel: secretish, artifacts: [art("c", list)] });
    const text = formatPhase6PrerequisiteReport(buildPhase6PrerequisiteReport({ sessionPack: pack, operatorLabel: secretish }));
    expect(text).toContain(REDACTED);
    expect(text).not.toContain(secretish);
  });
});
