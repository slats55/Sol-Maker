/**
 * Sprint 74 — SNIPER RUN REPORT DIFF V2 (`sniper.run.report.diff.v2`). All inputs are INJECTED,
 * offline test data fed through the REAL builders. Proves: the v1 diff core is reused verbatim
 * (and v1 diff behavior is untouched), every v2 layer movement is surfaced structurally (policy
 * visibility/mismatch, preflight-input coverage, unresolved unknowns, operator-blocking reasons,
 * rollup deltas, per-candidate code trails), a v1 report or corrupt input refuses, the strict
 * validator catches tampering, and the output is byte-deterministic. Nothing here is a live
 * result or a trade signal.
 */

import { describe, it, expect } from "vitest";
import {
  diffSniperRunReportsV2,
  validateSniperRunReportDiffV2,
  formatSniperRunReportDiffV2,
  SniperRunReportDiffV2Error,
  SNIPER_RUN_REPORT_DIFF_V2_SCHEMA_VERSION,
} from "./run-report-v2-diff.js";
import { diffSniperRunReports } from "./run-report-diff.js";
import { buildSniperRunReport } from "./run-report.js";
import { buildSniperRunReportV2, upgradeSniperRunReportV1ToV2, type SniperRunReportV2 } from "./run-report-v2.js";
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

/** A clean run: two candidates with full data → one paper-enter, one risk-rejected. */
function cleanRun(extra: Record<string, unknown> = {}): SniperRunReportV2 {
  const list = listOf(cand({ candidateId: "good", mint: USDC }), cand({ candidateId: "bad", mint: WSOL }));
  const pf = preflightFor(list, [
    { candidateId: "good", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
    { candidateId: "bad", risk: riskReject(WSOL) },
  ]);
  const decision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf });
  return buildSniperRunReportV2({ candidateList: list, preflight: pf, decision, ...extra });
}

/** A degraded run: "good" loses its data (→ unknown/watch), so unknowns + codes move. */
function degradedRun(): SniperRunReportV2 {
  const list = listOf(cand({ candidateId: "good", mint: USDC }), cand({ candidateId: "bad", mint: WSOL }));
  const pf = preflightFor(list, [{ candidateId: "bad", risk: riskReject(WSOL) }]);
  const decision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf });
  return buildSniperRunReportV2({ candidateList: list, preflight: pf, decision });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("diffSniperRunReportsV2 — identical pair", () => {
  it("reports no change anywhere (core or v2 layers)", () => {
    const diff = diffSniperRunReportsV2(cleanRun(), cleanRun());
    expect(diff.schemaVersion).toBe(SNIPER_RUN_REPORT_DIFF_V2_SCHEMA_VERSION);
    expect(diff.hasChange).toBe(false);
    expect(diff.hasV2LayerChange).toBe(false);
    expect(diff.hasAnyChange).toBe(false);
    expect(diff.hasNewOperatorBlocking).toBe(false);
    expect(diff.policySummaryChangedFields).toEqual([]);
    expect(diff.candidateCodeChanges).toEqual([]);
    expect(diff.reasonCodeCountDeltas).toEqual({});
    expect(diff.operatorBlockingReasonsAdded).toEqual([]);
  });
});

describe("diffSniperRunReportsV2 — v2 layer movements", () => {
  it("surfaces unresolved unknowns, code-trail movements, rollup deltas, and blocking reasons (clean → degraded)", () => {
    const diff = diffSniperRunReportsV2(cleanRun(), degradedRun());
    expect(diff.hasAnyChange).toBe(true);
    // "good" lost its data → newly unresolved + decision change in the v1 core.
    expect(diff.newlyUnresolvedUnknownIds).toEqual(["good"]);
    expect(diff.decisionChanges.map((c) => c.candidateId)).toContain("good");
    // Its code trail moved.
    const change = diff.candidateCodeChanges.find((c) => c.candidateId === "good");
    expect(change).toBeDefined();
    expect(change!.codesAdded.length + change!.codesRemoved.length).toBeGreaterThan(0);
    // The rollup deltas are non-empty and integer-valued.
    expect(Object.keys(diff.reasonCodeCountDeltas).length).toBeGreaterThan(0);
    // Operator-blocking reasons moved (paper-enter review gone; unresolved unknowns appeared).
    expect(diff.operatorBlockingReasonsAdded.length).toBeGreaterThan(0);
    expect(diff.hasNewOperatorBlocking).toBe(true);
  });

  it("surfaces a NEW policy/decision mismatch structurally (not from prose)", () => {
    const list = listOf(cand({ candidateId: "good", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "good", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const policyV2 = normalizeSniperPolicyConfigV2({ policyLabel: "ops" });
    const decision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy: policyV2 });
    const matched = buildSniperRunReportV2({ candidateList: list, preflight: pf, decision, policy: policyV2 });
    const mismatched = buildSniperRunReportV2({
      candidateList: list,
      preflight: pf,
      decision,
      policy: normalizeSniperPolicyConfig({ policyLabel: "old" }),
    });
    const diff = diffSniperRunReportsV2(matched, mismatched);
    expect(diff.newlyPolicyMismatch).toBe(true);
    expect(diff.policySummaryChangedFields).toContain("suppliedPolicySchemaVersion");
    expect(diff.hasV2LayerChange).toBe(true);
    // And the reverse direction reports resolution.
    const back = diffSniperRunReportsV2(mismatched, matched);
    expect(back.noLongerPolicyMismatch).toBe(true);
  });

  it("surfaces preflight-input coverage presence + the required-but-missing transition", () => {
    const list = listOf(cand({ candidateId: "good", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "good", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const policy = normalizeSniperPolicyConfigV2({ riskLimits: { requirePreflightInputArtifact: true } });
    const decision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy });
    const input = normalizeSniperPreflightInput({
      entries: [{ candidateId: "good", mint: USDC, inspection: cleanInspection(USDC), risk: riskPass(USDC) }],
      candidateList: list,
    });
    const withInput = buildSniperRunReportV2({ candidateList: list, preflight: pf, decision, policy, preflightInput: input });
    const withoutInput = buildSniperRunReportV2({ candidateList: list, preflight: pf, decision, policy });
    const diff = diffSniperRunReportsV2(withInput, withoutInput);
    expect(diff.preflightCoveragePresenceChanged).toBe(true);
    expect(diff.newlyMissingRequiredPreflightInput).toBe(true);
    expect(diff.hasNewOperatorBlocking).toBe(true);
    const back = diffSniperRunReportsV2(withoutInput, withInput);
    expect(back.noLongerMissingRequiredPreflightInput).toBe(true);
  });

  it("surfaces a rollup presence change when one side was upgraded from v1", () => {
    const list = listOf(cand({ candidateId: "good", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "good", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const decision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf });
    const v2Native = buildSniperRunReportV2({ candidateList: list, preflight: pf, decision });
    const v1Report = buildSniperRunReport({ candidateList: list, preflight: pf });
    const lifted = upgradeSniperRunReportV1ToV2(v1Report);
    const diff = diffSniperRunReportsV2(v2Native, lifted);
    expect(diff.rollupPresenceChanged).toBe(true);
    expect(diff.upgradedFromV1Changed).toBe(true);
    expect(diff.hasV2LayerChange).toBe(true);
  });
});

describe("diffSniperRunReportsV2 — refusals and v1 preservation", () => {
  it("refuses a v1 run report on either side with a classified message", () => {
    const list = listOf(cand({ candidateId: "good", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "good", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const v1Report = buildSniperRunReport({ candidateList: list, preflight: pf });
    expect(() => diffSniperRunReportsV2(v1Report, cleanRun())).toThrow(SniperRunReportDiffV2Error);
    expect(() => diffSniperRunReportsV2(v1Report, cleanRun())).toThrow(/base run report v2 is invalid/);
    expect(() => diffSniperRunReportsV2(cleanRun(), v1Report)).toThrow(/next run report v2 is invalid/);
    expect(() => diffSniperRunReportsV2({ junk: true }, cleanRun())).toThrow(/base run report v2 is invalid/);
  });

  it("v1 diff behavior is untouched: the v1 differ still accepts v1 reports and refuses v2", () => {
    const list = listOf(cand({ candidateId: "good", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "good", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const v1Report = buildSniperRunReport({ candidateList: list, preflight: pf });
    expect(() => diffSniperRunReports(v1Report, v1Report)).not.toThrow();
    expect(() => diffSniperRunReports(cleanRun(), cleanRun())).toThrow();
  });

  it("the v1 core inside the v2 diff matches the standalone v1 diff over the v1 views", () => {
    const base = cleanRun();
    const next = degradedRun();
    const v2Diff = diffSniperRunReportsV2(base, next);
    const v1View = (r: SniperRunReportV2): unknown => ({
      ...r,
      schemaVersion: "sniper.run.report.v1",
      banner: "SIMULATED PAPER-ONLY SNIPER RUN REPORT",
    });
    const v1Diff = diffSniperRunReports(v1View(base), v1View(next));
    expect(v2Diff.decisionChanges).toEqual(v1Diff.decisionChanges);
    expect(v2Diff.preflightStatusChanges).toEqual(v1Diff.preflightStatusChanges);
    expect(v2Diff.deltas).toEqual(v1Diff.deltas);
    expect(v2Diff.hasChange).toBe(v1Diff.hasChange);
  });
});

describe("validateSniperRunReportDiffV2 — backstop", () => {
  it("round-trips a built diff (including via JSON)", () => {
    const diff = diffSniperRunReportsV2(cleanRun(), degradedRun());
    expect(validateSniperRunReportDiffV2(clone(diff))).toEqual(diff);
  });

  it("refuses tampered transitions, movement sets, deltas, and verdicts", () => {
    const fresh = () => clone(diffSniperRunReportsV2(cleanRun(), degradedRun()));

    const d1 = fresh();
    (d1 as { hasAnyChange: boolean }).hasAnyChange = false;
    expect(() => validateSniperRunReportDiffV2(d1)).toThrow(/hasAnyChange/);

    const d2 = fresh();
    (d2 as { newlyUnresolvedUnknownIds: string[] }).newlyUnresolvedUnknownIds = [];
    expect(() => validateSniperRunReportDiffV2(d2)).toThrow(/newlyUnresolvedUnknownIds/);

    const d3 = fresh();
    (d3 as { operatorBlockingReasonsAdded: string[] }).operatorBlockingReasonsAdded = [];
    expect(() => validateSniperRunReportDiffV2(d3)).toThrow(/operatorBlockingReasonsAdded/);

    const d4 = fresh();
    (d4 as { reasonCodeCountDeltas: Record<string, number> }).reasonCodeCountDeltas = {};
    expect(() => validateSniperRunReportDiffV2(d4)).toThrow(/reasonCodeCountDeltas/);

    const d5 = fresh();
    (d5 as { hasNewOperatorBlocking: boolean }).hasNewOperatorBlocking = false;
    expect(() => validateSniperRunReportDiffV2(d5)).toThrow(/hasNewOperatorBlocking/);
  });

  it("refuses a wrong schemaVersion or banner", () => {
    const diff = clone(diffSniperRunReportsV2(cleanRun(), cleanRun()));
    (diff as { schemaVersion: string }).schemaVersion = "sniper.run.report.diff.v1";
    expect(() => validateSniperRunReportDiffV2(diff)).toThrow(/schemaVersion/);
  });
});

describe("run report diff v2 — determinism and formatting", () => {
  it("the same pair yields a byte-identical diff and formatted text", () => {
    const a = diffSniperRunReportsV2(cleanRun(), degradedRun());
    const b = diffSniperRunReportsV2(cleanRun(), degradedRun());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(formatSniperRunReportDiffV2(a)).toBe(formatSniperRunReportDiffV2(b));
  });

  it("formatted output keeps the paper-only framing, the v1 sections, and the v2 layers", () => {
    const text = formatSniperRunReportDiffV2(diffSniperRunReportsV2(cleanRun(), degradedRun()), { label: "t" });
    expect(text).toContain("SIMULATED PAPER-ONLY SNIPER RUN REPORT DIFF V2 (PAPER ONLY)");
    expect(text).toContain("Decision / policy (v2):");
    expect(text).toContain("Operator-blocking reasons (v2; verbatim):");
    expect(text).toContain("Any v2-layer change:");
    expect(text).toContain("NOT a buy/sell order");
    const lower = text.toLowerCase();
    expect(lower).not.toContain("trade executed");
    expect(lower).not.toContain("guaranteed");
    expect(lower).not.toContain("ready for live");
  });
});
