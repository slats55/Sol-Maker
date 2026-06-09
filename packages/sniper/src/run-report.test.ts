/**
 * Tests for the Sprint 30 SNIPER RUN REPORT. All inputs are INJECTED, offline test data — real
 * well-known mints as deterministic fixtures, fed through the real candidate/preflight/decision/workflow
 * builders. The run report joins them VERBATIM; nothing here is a live result or a trade signal. A
 * `paper-enter` carried through is a SIMULATED classification only.
 */

import { describe, it, expect } from "vitest";
import { REDACTED } from "@soulmaker/security";
import {
  buildSniperRunReport,
  validateSniperRunReport,
  formatSniperRunReport,
  SniperRunReportError,
  SNIPER_RUN_REPORT_SCHEMA_VERSION,
  SNIPER_RUN_REPORT_BANNER,
  type SniperRunReport,
} from "./run-report.js";
import { normalizeSniperCandidateList, type SniperCandidateInput } from "./candidate-list.js";
import { buildSniperTokenPreflightReport, type SniperPreflightCandidateData } from "./token-preflight.js";
import { buildPaperSniperDecisionReport, type SniperDecisionRules } from "./paper-decision.js";
import { buildSniperWorkflowPlan } from "./workflow.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

const listOf = (...cands: SniperCandidateInput[]) =>
  normalizeSniperCandidateList({ sourceLabel: "test-source", candidates: cands });
const cand = (over: Partial<SniperCandidateInput> & { candidateId: string; mint: string }): SniperCandidateInput => over;

const cleanInspection = (mint: string) => ({ mint, decimals: 6, supplyRaw: "1", uiSupply: 1, mintAuthorityPresent: false, freezeAuthorityPresent: false, isInitialized: true, programLabel: "spl-token" });
const freezeInspection = (mint: string) => ({ ...cleanInspection(mint), freezeAuthorityPresent: true });
const riskPass = (mint: string) => ({ mint, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [], summary: [] });
const riskReject = (mint: string) => ({ mint, score: 95, decision: "REJECT", flags: [{ id: "rug", severity: "critical", title: "Rug" }], summary: [] });

const preflightFor = (list: ReturnType<typeof listOf>, data: SniperPreflightCandidateData[]) =>
  buildSniperTokenPreflightReport({ candidateList: list, candidateData: data });
const decisionFor = (list: ReturnType<typeof listOf>, preflight?: unknown, rules?: SniperDecisionRules) =>
  buildPaperSniperDecisionReport({ candidateList: list, preflight, rules });

describe("buildSniperRunReport — happy path (all artifacts)", () => {
  it("joins candidate list + preflight + decision + workflow into one navigable report", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }), cand({ candidateId: "c2", mint: WSOL }));
    const pf = preflightFor(list, [
      { candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
      { candidateId: "c2", risk: riskReject(WSOL) },
    ]);
    const dec = decisionFor(list, pf);
    const wf = buildSniperWorkflowPlan({
      candidates: { path: "c.json", present: true, valid: true },
      preflight: { path: "p.json", present: true, valid: true },
      decide: { path: "d.json", present: true, valid: true },
    });
    const report = buildSniperRunReport({ candidateList: list, preflight: pf, decision: dec, workflow: wf });

    expect(report.schemaVersion).toBe(SNIPER_RUN_REPORT_SCHEMA_VERSION);
    expect(report.candidateCount).toBe(2);
    expect(report.artifactsPresent).toEqual({ candidates: true, preflight: true, decision: true, workflow: true });
    expect(report.hasMissingRecommendedArtifact).toBe(false);

    // c1 = clean pass → paper-enter; c2 = risk REJECT → preflight fail → paper-reject on risk.
    expect(report.paperEnterIds).toEqual(["c1"]);
    expect(report.paperRejectIds).toEqual(["c2"]);
    expect(report.preflightFailedIds).toEqual(["c2"]);
    expect(report.riskBlockedIds).toEqual(["c2"]);
    expect(report.hasPaperEnter).toBe(true);
    expect(report.hasRiskBlock).toBe(true);
    expect(report.hasPreflightFailure).toBe(true);

    // The per-candidate reason trail carries provenance-prefixed lines from both artifacts.
    const c2 = report.candidates.find((e) => e.candidateId === "c2")!;
    expect(c2.preflightStatus).toBe("fail");
    expect(c2.decision).toBe("paper-reject");
    expect(c2.reasons.some((r) => r.startsWith("preflight ✗"))).toBe(true);
    expect(c2.reasons.some((r) => r.startsWith("decision ·"))).toBe(true);
    expect(c2.blockingRiskFlags.length).toBeGreaterThan(0);

    expect(report.workflowSummary).toEqual({ stageCount: 3, doneCount: 3, complete: true, nextStage: null, hasInvalidArtifact: false });
    expect(() => validateSniperRunReport(report)).not.toThrow();
  });

  it("echoes the operator label and a source override", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const report = buildSniperRunReport({ candidateList: list, operatorLabel: "alice@run-7", sourceLabel: "override-src" });
    expect(report.operatorLabel).toBe("alice@run-7");
    expect(report.sourceLabel).toBe("override-src");
  });

  it("defaults sourceLabel to the candidate list's sourceLabel and operatorLabel to null", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const report = buildSniperRunReport({ candidateList: list });
    expect(report.sourceLabel).toBe("test-source");
    expect(report.operatorLabel).toBeNull();
  });
});

describe("buildSniperRunReport — missing artifacts", () => {
  it("flags hasMissingRecommendedArtifact when only the candidate list is supplied", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }), cand({ candidateId: "c2", mint: WSOL }));
    const report = buildSniperRunReport({ candidateList: list });
    expect(report.artifactsPresent).toEqual({ candidates: true, preflight: false, decision: false, workflow: false });
    expect(report.hasMissingRecommendedArtifact).toBe(true);
    expect(report.preflightSummary).toBeNull();
    expect(report.decisionSummary).toBeNull();
    expect(report.workflowSummary).toBeNull();
    // No preflight signal at all → every candidate is "watched due to missing info".
    expect(report.watchedMissingInfoIds).toEqual(["c1", "c2"]);
    expect(report.failReasons.some((r) => /missing recommended artifact/.test(r))).toBe(true);
    expect(report.candidates.every((e) => e.preflightStatus === null && e.decision === null)).toBe(true);
  });

  it("includes a preflight but no decision (still flags a missing recommended artifact)", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const report = buildSniperRunReport({ candidateList: list, preflight: pf });
    expect(report.artifactsPresent.preflight).toBe(true);
    expect(report.artifactsPresent.decision).toBe(false);
    expect(report.hasMissingRecommendedArtifact).toBe(true);
    expect(report.candidates[0]!.preflightStatus).toBe("pass");
    expect(report.candidates[0]!.decision).toBeNull();
  });
});

describe("buildSniperRunReport — classifications", () => {
  it("surfaces a preflight `unknown` as hasUnknown + watched-missing-info", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, []); // no inspection/risk → unknown
    const dec = decisionFor(list, pf);
    const report = buildSniperRunReport({ candidateList: list, preflight: pf, decision: dec });
    expect(report.preflightUnknownIds).toEqual(["c1"]);
    expect(report.hasUnknown).toBe(true);
    expect(report.watchedMissingInfoIds).toEqual(["c1"]);
    expect(report.watchIds).toEqual(["c1"]); // decision watched it
  });

  it("classifies a freeze-authority warn as watch (not risk-blocked, not missing-info)", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: freezeInspection(USDC) }]);
    const dec = decisionFor(list, pf);
    const report = buildSniperRunReport({ candidateList: list, preflight: pf, decision: dec });
    expect(report.candidates[0]!.preflightStatus).toBe("warn");
    expect(report.watchIds).toEqual(["c1"]);
    expect(report.riskBlockedIds).toEqual([]);
    expect(report.watchedMissingInfoIds).toEqual([]); // warn IS a signal, not missing info
  });

  it("reads a hand-edited mintValid:false preflight entry VERBATIM (hasInvalidCandidate)", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    // A list candidate is always valid, but a supplied preflight is read verbatim. Patch one entry to
    // report an invalid mint (keeping the report self-consistent: a disqualifier ⇒ status fail).
    const patched = JSON.parse(JSON.stringify(pf)) as typeof pf;
    patched.candidates[0]!.mintValid = false;
    patched.candidates[0]!.status = "fail";
    patched.candidates[0]!.disqualifiers = ["mint is not a valid 32-byte Solana public key"];
    const report = buildSniperRunReport({ candidateList: list, preflight: patched });
    expect(report.invalidCandidateIds).toEqual(["c1"]);
    expect(report.hasInvalidCandidate).toBe(true);
    expect(report.candidates[0]!.mintValid).toBe(false);
  });

  it("treats a denylist skip as skip (and not risk-blocked / missing-info)", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const dec = decisionFor(list, pf, { denyMints: [USDC] });
    const report = buildSniperRunReport({ candidateList: list, preflight: pf, decision: dec });
    expect(report.skipIds).toEqual(["c1"]);
    expect(report.riskBlockedIds).toEqual([]);
    expect(report.watchedMissingInfoIds).toEqual([]);
  });

  it("builds a stable, only-non-empty navigation index", () => {
    const list = listOf(cand({ candidateId: "ok", mint: USDC }), cand({ candidateId: "bad", mint: WSOL }));
    const pf = preflightFor(list, [
      { candidateId: "ok", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
      { candidateId: "bad", risk: riskReject(WSOL) },
    ]);
    const dec = decisionFor(list, pf);
    const report = buildSniperRunReport({ candidateList: list, preflight: pf, decision: dec });
    const labels = report.navigation.map((g) => g.label);
    expect(labels).toContain("paper-enter (SIMULATED)");
    expect(labels).toContain("paper-reject");
    expect(labels).toContain("risk-blocked");
    // Empty groups are omitted.
    expect(labels).not.toContain("invalid-mint");
    expect(report.navigation.find((g) => g.label === "paper-enter (SIMULATED)")!.candidateIds).toEqual(["ok"]);
  });
});

describe("buildSniperRunReport — determinism + rejection", () => {
  it("is byte-stable, preserves candidate order, and carries no timestamp", () => {
    const list = listOf(cand({ candidateId: "z", mint: WSOL }), cand({ candidateId: "a", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "a", risk: riskReject(USDC) }]);
    const dec = decisionFor(list, pf);
    const first = JSON.stringify(buildSniperRunReport({ candidateList: list, preflight: pf, decision: dec }));
    const second = JSON.stringify(buildSniperRunReport({ candidateList: list, preflight: pf, decision: dec }));
    expect(first).toBe(second);
    expect(JSON.parse(first).candidates.map((e: { candidateId: string }) => e.candidateId)).toEqual(["z", "a"]);
    expect(first).not.toMatch(/"generatedAt"|"createdAt"|"timestamp"|"ranAt"/);
  });

  it("does not mutate its inputs", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", risk: riskPass(USDC) }]);
    const dec = decisionFor(list, pf);
    const before = JSON.stringify({ list, pf, dec });
    buildSniperRunReport({ candidateList: list, preflight: pf, decision: dec });
    expect(JSON.stringify({ list, pf, dec })).toBe(before);
  });

  it("refuses a non-candidate-list input", () => {
    expect(() => buildSniperRunReport({ candidateList: { schemaVersion: "x" } })).toThrow(SniperRunReportError);
    expect(() => buildSniperRunReport({ candidateList: null as unknown as object })).toThrow(/candidate list is invalid/);
  });

  it("refuses a preflight/decision referencing an unknown candidateId (wrong pairing)", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const otherList = listOf(cand({ candidateId: "ghost", mint: WSOL }));
    const pf = preflightFor(otherList, [{ candidateId: "ghost", risk: riskPass(WSOL) }]);
    expect(() => buildSniperRunReport({ candidateList: list, preflight: pf })).toThrow(/unknown candidateId "ghost"/);
    const dec = decisionFor(otherList, pf);
    expect(() => buildSniperRunReport({ candidateList: list, decision: dec })).toThrow(/unknown candidateId "ghost"/);
  });

  it("refuses a malformed sub-artifact", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    expect(() => buildSniperRunReport({ candidateList: list, preflight: { schemaVersion: "wrong" } })).toThrow(/preflight report is invalid/);
    expect(() => buildSniperRunReport({ candidateList: list, decision: { schemaVersion: "wrong" } })).toThrow(/decision report is invalid/);
    expect(() => buildSniperRunReport({ candidateList: list, workflow: { schemaVersion: "wrong" } })).toThrow(/workflow plan is invalid/);
  });
});

describe("validateSniperRunReport", () => {
  const sample = (): SniperRunReport => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }), cand({ candidateId: "c2", mint: WSOL }));
    const pf = preflightFor(list, [
      { candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
      { candidateId: "c2", risk: riskReject(WSOL) },
    ]);
    return buildSniperRunReport({ candidateList: list, preflight: pf, decision: decisionFor(list, pf) });
  };

  it("accepts a freshly-built report (round-trips through JSON)", () => {
    expect(() => validateSniperRunReport(JSON.parse(JSON.stringify(sample())))).not.toThrow();
  });

  it("rejects a wrong schemaVersion and a non-object", () => {
    expect(() => validateSniperRunReport(null)).toThrow(SniperRunReportError);
    const r = JSON.parse(JSON.stringify(sample())) as { schemaVersion: string };
    r.schemaVersion = "sniper.run.report.v2";
    expect(() => validateSniperRunReport(r)).toThrow(/schemaVersion/);
  });

  it("rejects an entry with an invalid preflightStatus / decision", () => {
    const r = JSON.parse(JSON.stringify(sample())) as SniperRunReport;
    (r.candidates[0] as unknown as { preflightStatus: string }).preflightStatus = "nope";
    expect(() => validateSniperRunReport(r)).toThrow(/preflightStatus must be/);
    const r2 = JSON.parse(JSON.stringify(sample())) as SniperRunReport;
    (r2.candidates[0] as unknown as { decision: string }).decision = "buy";
    expect(() => validateSniperRunReport(r2)).toThrow(/decision must be/);
  });

  it("rejects a candidates length that disagrees with candidateCount", () => {
    const r = JSON.parse(JSON.stringify(sample())) as SniperRunReport;
    r.candidates.pop();
    expect(() => validateSniperRunReport(r)).toThrow(/length must equal candidateCount/);
  });

  it("rejects a malformed navigation group", () => {
    const r = JSON.parse(JSON.stringify(sample())) as SniperRunReport;
    (r.navigation as unknown[]).push({ label: "", candidateIds: [] });
    expect(() => validateSniperRunReport(r)).toThrow(/navigation\[/);
  });
});

describe("formatSniperRunReport", () => {
  it("renders a stable, sectioned PAPER-ONLY human report with a navigation index", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }), cand({ candidateId: "c2", mint: WSOL }));
    const pf = preflightFor(list, [
      { candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
      { candidateId: "c2", risk: riskReject(WSOL) },
    ]);
    const report = buildSniperRunReport({ candidateList: list, preflight: pf, decision: decisionFor(list, pf) });
    const text = formatSniperRunReport(report);
    expect(text).toBe(formatSniperRunReport(report)); // deterministic
    expect(text).toContain(SNIPER_RUN_REPORT_BANNER);
    expect(text).toContain("PAPER ONLY");
    expect(text).toContain("Navigation:");
    expect(text).toContain("Any paper-enter (SIMULATED):  YES");
    expect(text.toLowerCase()).toContain("not a trade signal");
  });

  it("routes the whole output through the shared redactor", () => {
    const secretish = "a".repeat(64);
    const list = normalizeSniperCandidateList({ sourceLabel: secretish, candidates: [{ candidateId: "c1", mint: USDC }] });
    const text = formatSniperRunReport(buildSniperRunReport({ candidateList: list }));
    expect(text).toContain(REDACTED);
    expect(text).not.toContain(secretish);
  });
});
