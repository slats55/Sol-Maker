/**
 * Tests for the Sprint 33 SNIPER AUDIT LOG. All inputs are INJECTED run reports built from the real
 * builders. The audit log is deterministic provenance over a SIMULATED run — NO wall-clock time, no
 * live result, no order.
 */

import { describe, it, expect } from "vitest";
import { REDACTED } from "@soulmaker/security";
import {
  buildSniperAuditLog,
  validateSniperAuditLog,
  formatSniperAuditLog,
  SniperAuditLogError,
  SNIPER_AUDIT_LOG_SCHEMA_VERSION,
  SNIPER_AUDIT_LOG_BANNER,
  type SniperAuditLog,
} from "./audit-log.js";
import { buildSniperRunReport, type SniperRunReport } from "./run-report.js";
import { normalizeSniperCandidateList, type SniperCandidateInput } from "./candidate-list.js";
import { buildSniperTokenPreflightReport, type SniperPreflightCandidateData } from "./token-preflight.js";
import { buildPaperSniperDecisionReport } from "./paper-decision.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

const listOf = (...cands: SniperCandidateInput[]) => normalizeSniperCandidateList({ sourceLabel: "src", candidates: cands });
const cand = (over: Partial<SniperCandidateInput> & { candidateId: string; mint: string }): SniperCandidateInput => over;
const cleanInspection = (mint: string) => ({ mint, decimals: 6, supplyRaw: "1", uiSupply: 1, mintAuthorityPresent: false, freezeAuthorityPresent: false, isInitialized: true, programLabel: "spl-token" });
const riskPass = (mint: string) => ({ mint, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [], summary: [] });
const riskReject = (mint: string) => ({ mint, score: 95, decision: "REJECT", flags: [{ id: "rug", severity: "critical", title: "Rug" }], summary: [] });

function fullRunReport(): SniperRunReport {
  const list = listOf(cand({ candidateId: "good", mint: USDC }), cand({ candidateId: "bad", mint: WSOL }));
  const pf = buildSniperTokenPreflightReport({
    candidateList: list,
    candidateData: [
      { candidateId: "good", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
      { candidateId: "bad", risk: riskReject(WSOL) },
    ] as SniperPreflightCandidateData[],
  });
  const dec = buildPaperSniperDecisionReport({ candidateList: list, preflight: pf });
  return buildSniperRunReport({ candidateList: list, preflight: pf, decision: dec });
}

describe("buildSniperAuditLog — full run", () => {
  it("records one entry per pipeline step with verbatim summaries", () => {
    const log = buildSniperAuditLog({ runReport: fullRunReport(), runLabel: "run-7" });
    expect(log.schemaVersion).toBe(SNIPER_AUDIT_LOG_SCHEMA_VERSION);
    expect(log.runLabel).toBe("run-7");
    expect(log.stepCount).toBe(4);
    expect(log.steps.map((s) => s.stepId)).toEqual(["intake", "preflight", "decide", "report"]);
    expect(log.steps.every((s) => s.ran)).toBe(true);

    const decide = log.steps.find((s) => s.stepId === "decide")!;
    expect(decide.inputArtifactLabels).toEqual(["candidate-list", "preflight-report"]);
    expect(decide.outputArtifactLabels).toEqual(["decision-report"]);
    expect(decide.decisionSummary).toMatch(/paper-enter/);
    expect(decide.notes.some((n) => /SIMULATED paper-enter/.test(n))).toBe(true);

    expect(log.hasPaperEnter).toBe(true);
    expect(log.hasRiskBlock).toBe(true);
    expect(log.hasFailure).toBe(true); // risk block + preflight fail recorded as failures
    expect(() => validateSniperAuditLog(log)).not.toThrow();
  });

  it("appends operator notes and carries no wall-clock time", () => {
    const log = buildSniperAuditLog({ runReport: fullRunReport(), runLabel: "r", notes: ["operator note A", "  "] });
    expect(log.notes).toContain("operator note A");
    const json = JSON.stringify(log);
    expect(json).not.toMatch(/"generatedAt"|"createdAt"|"timestamp"|"ranAt"|"\d{4}-\d{2}-\d{2}T/);
  });
});

describe("buildSniperAuditLog — partial run", () => {
  it("records absent recommended steps as not-run (candidates only)", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const report = buildSniperRunReport({ candidateList: list });
    const log = buildSniperAuditLog({ runReport: report });
    const preflight = log.steps.find((s) => s.stepId === "preflight")!;
    const decide = log.steps.find((s) => s.stepId === "decide")!;
    expect(preflight.ran).toBe(false);
    expect(preflight.outputArtifactLabels).toEqual([]);
    expect(preflight.warnings.some((w) => /not run/.test(w))).toBe(true);
    expect(decide.ran).toBe(false);
    expect(log.hasMissingRecommendedArtifact).toBe(true);
    expect(log.warnings.some((w) => /incomplete/.test(w))).toBe(true);
    // A merely-incomplete run is a WARNING, not a failure (no invalid / preflight-fail / risk-block).
    expect(log.hasFailure).toBe(false);
    expect(log.hasWarning).toBe(true);
    const reportStep = log.steps.find((s) => s.stepId === "report")!;
    expect(reportStep.failures).toEqual([]);
    expect(reportStep.warnings.some((w) => /recommended artifact/.test(w))).toBe(true);
  });
});

describe("buildSniperAuditLog — determinism + rejection", () => {
  it("is byte-stable and non-mutating", () => {
    const report = fullRunReport();
    const before = JSON.stringify(report);
    const a = JSON.stringify(buildSniperAuditLog({ runReport: report, runLabel: "x" }));
    const b = JSON.stringify(buildSniperAuditLog({ runReport: report, runLabel: "x" }));
    expect(a).toBe(b);
    expect(JSON.stringify(report)).toBe(before);
  });

  it("refuses a non-run-report input and a bad runLabel", () => {
    expect(() => buildSniperAuditLog({ runReport: { schemaVersion: "x" } })).toThrow(/run report is invalid/);
    expect(() => buildSniperAuditLog({ runReport: fullRunReport(), runLabel: 5 as never })).toThrow(SniperAuditLogError);
    expect(() => buildSniperAuditLog({ runReport: fullRunReport(), notes: [5 as never] })).toThrow(/array of strings/);
  });
});

describe("validateSniperAuditLog", () => {
  const sample = (): SniperAuditLog => buildSniperAuditLog({ runReport: fullRunReport(), runLabel: "r" });

  it("accepts a freshly-built log (round-trips through JSON)", () => {
    expect(() => validateSniperAuditLog(JSON.parse(JSON.stringify(sample())))).not.toThrow();
  });

  it("rejects a wrong schemaVersion and a bad step kind", () => {
    expect(() => validateSniperAuditLog(null)).toThrow(SniperAuditLogError);
    const l = JSON.parse(JSON.stringify(sample())) as SniperAuditLog;
    (l as unknown as { schemaVersion: string }).schemaVersion = "sniper.audit.log.v2";
    expect(() => validateSniperAuditLog(l)).toThrow(/schemaVersion/);
    const l2 = JSON.parse(JSON.stringify(sample())) as SniperAuditLog;
    (l2.steps[0] as unknown as { stepKind: string }).stepKind = "mystery";
    expect(() => validateSniperAuditLog(l2)).toThrow(/stepKind must be/);
  });

  it("rejects a steps length that disagrees with stepCount", () => {
    const l = JSON.parse(JSON.stringify(sample())) as SniperAuditLog;
    l.steps.pop();
    expect(() => validateSniperAuditLog(l)).toThrow(/length must equal stepCount/);
  });
});

describe("formatSniperAuditLog", () => {
  it("renders a stable, sectioned PAPER-ONLY human audit log", () => {
    const log = buildSniperAuditLog({ runReport: fullRunReport(), runLabel: "run-7" });
    const text = formatSniperAuditLog(log);
    expect(text).toBe(formatSniperAuditLog(log)); // deterministic
    expect(text).toContain(SNIPER_AUDIT_LOG_BANNER);
    expect(text).toContain("PAPER ONLY");
    expect(text).toContain("Steps:");
    expect(text).toContain("Any paper-enter:  YES");
    expect(text.toLowerCase()).toContain("no wall-clock time");
  });

  it("routes the whole output through the shared redactor", () => {
    const secretish = "a".repeat(64);
    const list = normalizeSniperCandidateList({ sourceLabel: secretish, candidates: [{ candidateId: "c1", mint: USDC }] });
    const report = buildSniperRunReport({ candidateList: list });
    const text = formatSniperAuditLog(buildSniperAuditLog({ runReport: report, runLabel: secretish }));
    expect(text).toContain(REDACTED);
    expect(text).not.toContain(secretish);
  });
});
