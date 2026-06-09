/**
 * Tests for the Sprint 31 SNIPER RUN REPORT DIFF. All inputs are INJECTED run reports built from the
 * real candidate/preflight/decision builders. The diff compares them VERBATIM; nothing here is a live
 * result or a trade signal. A `paper-enter` transition is between two SIMULATED classifications.
 */

import { describe, it, expect } from "vitest";
import { REDACTED } from "@soulmaker/security";
import {
  diffSniperRunReports,
  validateSniperRunReportDiff,
  formatSniperRunReportDiff,
  SniperRunReportDiffError,
  SNIPER_RUN_REPORT_DIFF_SCHEMA_VERSION,
  SNIPER_RUN_REPORT_DIFF_BANNER,
  type SniperRunReportDiff,
} from "./run-report-diff.js";
import { buildSniperRunReport, type SniperRunReport } from "./run-report.js";
import { normalizeSniperCandidateList, type SniperCandidateInput } from "./candidate-list.js";
import { buildSniperTokenPreflightReport, type SniperPreflightCandidateData } from "./token-preflight.js";
import { buildPaperSniperDecisionReport } from "./paper-decision.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

const listOf = (...cands: SniperCandidateInput[]) =>
  normalizeSniperCandidateList({ sourceLabel: "src", candidates: cands });
const cand = (over: Partial<SniperCandidateInput> & { candidateId: string; mint: string }): SniperCandidateInput => over;

const cleanInspection = (mint: string) => ({ mint, decimals: 6, supplyRaw: "1", uiSupply: 1, mintAuthorityPresent: false, freezeAuthorityPresent: false, isInitialized: true, programLabel: "spl-token" });
const freezeInspection = (mint: string) => ({ ...cleanInspection(mint), freezeAuthorityPresent: true });
const riskPass = (mint: string) => ({ mint, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [], summary: [] });
const riskReject = (mint: string) => ({ mint, score: 95, decision: "REJECT", flags: [{ id: "rug", severity: "critical", title: "Rug" }], summary: [] });

/** Build a full run report (candidate list + preflight + decision) from per-candidate preflight data. */
function runReport(cands: SniperCandidateInput[], data: SniperPreflightCandidateData[]): SniperRunReport {
  const list = listOf(...cands);
  const pf = buildSniperTokenPreflightReport({ candidateList: list, candidateData: data });
  const dec = buildPaperSniperDecisionReport({ candidateList: list, preflight: pf });
  return buildSniperRunReport({ candidateList: list, preflight: pf, decision: dec });
}

describe("diffSniperRunReports — membership", () => {
  it("reports added and removed candidates", () => {
    const base = runReport([cand({ candidateId: "c1", mint: USDC })], [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const next = runReport(
      [cand({ candidateId: "c1", mint: USDC }), cand({ candidateId: "c2", mint: WSOL })],
      [
        { candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
        { candidateId: "c2", inspection: cleanInspection(WSOL), risk: riskPass(WSOL) },
      ],
    );
    const diff = diffSniperRunReports(base, next);
    expect(diff.candidatesAdded).toEqual(["c2"]);
    expect(diff.candidatesRemoved).toEqual([]);
    expect(diff.commonCount).toBe(1);
    expect(diff.hasChange).toBe(true);
    expect(diff.deltas.candidateCount).toBe(1);
    expect(() => validateSniperRunReportDiff(diff)).not.toThrow();
  });

  it("reports an unchanged pair as no change", () => {
    const data: SniperPreflightCandidateData[] = [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }];
    const base = runReport([cand({ candidateId: "c1", mint: USDC })], data);
    const next = runReport([cand({ candidateId: "c1", mint: USDC })], data);
    const diff = diffSniperRunReports(base, next);
    expect(diff.hasChange).toBe(false);
    expect(diff.decisionChanges).toEqual([]);
    expect(diff.preflightStatusChanges).toEqual([]);
    expect(diff.deltas.candidateCount).toBe(0);
  });
});

describe("diffSniperRunReports — transitions", () => {
  it("detects a newly risk-blocked + newly paper-reject candidate (decision + preflight change)", () => {
    const base = runReport([cand({ candidateId: "c1", mint: USDC })], [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const next = runReport([cand({ candidateId: "c1", mint: USDC })], [{ candidateId: "c1", risk: riskReject(USDC) }]);
    const diff = diffSniperRunReports(base, next);
    expect(diff.newlyRiskBlockedIds).toEqual(["c1"]);
    expect(diff.newlyPreflightFailedIds).toEqual(["c1"]);
    expect(diff.noLongerPaperEnterIds).toEqual(["c1"]); // was paper-enter, now paper-reject
    expect(diff.hasNewRiskBlock).toBe(true);
    expect(diff.hasNewPreflightFailure).toBe(true);
    expect(diff.decisionChanges[0]).toEqual({ candidateId: "c1", from: "paper-enter", to: "paper-reject" });
  });

  it("detects a newly paper-enter candidate (watch → paper-enter)", () => {
    // base: freeze warn → watch; next: clean pass → paper-enter
    const base = runReport([cand({ candidateId: "c1", mint: USDC })], [{ candidateId: "c1", inspection: freezeInspection(USDC) }]);
    const next = runReport([cand({ candidateId: "c1", mint: USDC })], [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const diff = diffSniperRunReports(base, next);
    expect(diff.newlyPaperEnterIds).toEqual(["c1"]);
    expect(diff.hasNewPaperEnter).toBe(true);
    expect(diff.recoveryIds).toEqual([]); // a freeze warn is not a "concern" (not invalid/fail/risk/unknown)
  });

  it("detects recovery (risk reject → clean pass)", () => {
    const base = runReport([cand({ candidateId: "c1", mint: USDC })], [{ candidateId: "c1", risk: riskReject(USDC) }]);
    const next = runReport([cand({ candidateId: "c1", mint: USDC })], [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const diff = diffSniperRunReports(base, next);
    expect(diff.recoveryIds).toEqual(["c1"]);
    expect(diff.hasRecovery).toBe(true);
    expect(diff.newlyPaperEnterIds).toEqual(["c1"]);
  });

  it("detects newly unknown and no-longer unknown", () => {
    // base: clean pass; next: no data → unknown
    const base = runReport([cand({ candidateId: "c1", mint: USDC })], [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const next = runReport([cand({ candidateId: "c1", mint: USDC })], []);
    const fwd = diffSniperRunReports(base, next);
    expect(fwd.newlyUnknownIds).toEqual(["c1"]);
    expect(fwd.hasNewUnknown).toBe(true);
    // reverse: unknown → pass
    const rev = diffSniperRunReports(next, base);
    expect(rev.noLongerUnknownIds).toEqual(["c1"]);
    expect(rev.recoveryIds).toEqual(["c1"]); // unknown IS a concern; resolving it is recovery
  });
});

describe("diffSniperRunReports — determinism + rejection", () => {
  it("is byte-stable and carries no timestamp", () => {
    const base = runReport([cand({ candidateId: "c1", mint: USDC })], [{ candidateId: "c1", risk: riskReject(USDC) }]);
    const next = runReport([cand({ candidateId: "c1", mint: USDC })], [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const a = JSON.stringify(diffSniperRunReports(base, next));
    const b = JSON.stringify(diffSniperRunReports(base, next));
    expect(a).toBe(b);
    expect(a).not.toMatch(/"generatedAt"|"createdAt"|"timestamp"|"ranAt"/);
  });

  it("does not mutate its inputs", () => {
    const base = runReport([cand({ candidateId: "c1", mint: USDC })], [{ candidateId: "c1", risk: riskPass(USDC) }]);
    const next = runReport([cand({ candidateId: "c1", mint: USDC })], [{ candidateId: "c1", risk: riskReject(USDC) }]);
    const before = JSON.stringify({ base, next });
    diffSniperRunReports(base, next);
    expect(JSON.stringify({ base, next })).toBe(before);
  });

  it("refuses a non-run-report input on either side", () => {
    const ok = runReport([cand({ candidateId: "c1", mint: USDC })], []);
    expect(() => diffSniperRunReports({ schemaVersion: "x" }, ok)).toThrow(/base run report is invalid/);
    expect(() => diffSniperRunReports(ok, { schemaVersion: "x" })).toThrow(/next run report is invalid/);
    expect(() => diffSniperRunReports(null, ok)).toThrow(SniperRunReportDiffError);
  });
});

describe("validateSniperRunReportDiff", () => {
  const sample = (): SniperRunReportDiff => {
    const base = runReport([cand({ candidateId: "c1", mint: USDC })], [{ candidateId: "c1", risk: riskReject(USDC) }]);
    const next = runReport([cand({ candidateId: "c1", mint: USDC })], [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    return diffSniperRunReports(base, next);
  };

  it("accepts a freshly-built diff (round-trips through JSON)", () => {
    expect(() => validateSniperRunReportDiff(JSON.parse(JSON.stringify(sample())))).not.toThrow();
  });

  it("rejects a wrong schemaVersion and a non-object", () => {
    expect(() => validateSniperRunReportDiff(null)).toThrow(SniperRunReportDiffError);
    const d = JSON.parse(JSON.stringify(sample())) as { schemaVersion: string };
    d.schemaVersion = "sniper.run.report.diff.v2";
    expect(() => validateSniperRunReportDiff(d)).toThrow(/schemaVersion/);
  });

  it("rejects a malformed decision change and a non-integer delta", () => {
    const d = JSON.parse(JSON.stringify(sample())) as SniperRunReportDiff;
    (d.decisionChanges as unknown[]).push({ candidateId: "", from: null, to: null });
    expect(() => validateSniperRunReportDiff(d)).toThrow(/decisionChanges\[/);
    const d2 = JSON.parse(JSON.stringify(sample())) as SniperRunReportDiff;
    (d2.deltas as unknown as { paperEnter: number }).paperEnter = 1.5;
    expect(() => validateSniperRunReportDiff(d2)).toThrow(/deltas.paperEnter/);
  });
});

describe("formatSniperRunReportDiff", () => {
  it("renders a stable, sectioned PAPER-ONLY human diff", () => {
    const base = runReport([cand({ candidateId: "c1", mint: USDC })], [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const next = runReport([cand({ candidateId: "c1", mint: USDC })], [{ candidateId: "c1", risk: riskReject(USDC) }]);
    const diff = diffSniperRunReports(base, next);
    const text = formatSniperRunReportDiff(diff);
    expect(text).toBe(formatSniperRunReportDiff(diff)); // deterministic
    expect(text).toContain(SNIPER_RUN_REPORT_DIFF_BANNER);
    expect(text).toContain("PAPER ONLY");
    expect(text).toContain("Decision changes:");
    expect(text).toContain("Any new risk block:      YES");
    expect(text.toLowerCase()).toContain("not a trade signal");
    expect(diff.schemaVersion).toBe(SNIPER_RUN_REPORT_DIFF_SCHEMA_VERSION);
  });

  it("routes the whole output through the shared redactor", () => {
    const secretish = "a".repeat(64);
    const list = normalizeSniperCandidateList({ sourceLabel: secretish, candidates: [{ candidateId: "c1", mint: USDC }] });
    const r = buildSniperRunReport({ candidateList: list });
    const text = formatSniperRunReportDiff(diffSniperRunReports(r, r));
    expect(text).toContain(REDACTED);
    expect(text).not.toContain(secretish);
  });
});
