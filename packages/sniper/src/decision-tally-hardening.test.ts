/**
 * Sprint 77 — DECISION TALLY HARDENING. Closes the known gap where
 * `validatePaperSniperDecisionReportV2` (and the v1 validator) accepted a corrupted
 * `paperEnterCount`/tally as long as it was a non-negative integer. Both validators now RECOMPUTE
 * the five per-decision tallies and the three verdict booleans from the verbatim entries and
 * refuse any mismatch. All inputs are INJECTED offline test data fed through the REAL builders —
 * nothing here is a live result or a trade signal.
 */

import { describe, it, expect } from "vitest";
import {
  buildPaperSniperDecisionReport,
  validatePaperSniperDecisionReport,
  type SniperPaperDecisionReport,
} from "./paper-decision.js";
import {
  buildPaperSniperDecisionReportV2,
  validatePaperSniperDecisionReportV2,
  upgradePaperSniperDecisionReportV1ToV2,
  type SniperPaperDecisionReportV2,
} from "./paper-decision-v2.js";
import { normalizeSniperPolicyConfig, enforceSniperPolicy } from "./policy-config.js";
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

/** One clean paper-enter + one risk-rejected candidate (the standard two-candidate scenario). */
function scenario() {
  const list = listOf(cand({ candidateId: "good", mint: USDC }), cand({ candidateId: "bad", mint: WSOL }));
  const pf = preflightFor(list, [
    { candidateId: "good", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
    { candidateId: "bad", risk: riskReject(WSOL) },
  ]);
  return { list, pf };
}

function v1Report(): SniperPaperDecisionReport {
  const { list, pf } = scenario();
  return buildPaperSniperDecisionReport({ candidateList: list, preflight: pf });
}

function v2Report(): SniperPaperDecisionReportV2 {
  const { list, pf } = scenario();
  return buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("decision tally hardening — valid artifacts keep passing", () => {
  it("builder-produced v1 and v2 reports round-trip (including via JSON)", () => {
    expect(() => validatePaperSniperDecisionReport(clone(v1Report()))).not.toThrow();
    expect(() => validatePaperSniperDecisionReportV2(clone(v2Report()))).not.toThrow();
  });

  it("the v1→v2 upgrade path still validates (compatibility preserved)", () => {
    const lifted = upgradePaperSniperDecisionReportV1ToV2(v1Report());
    expect(() => validatePaperSniperDecisionReportV2(clone(lifted))).not.toThrow();
  });

  it("the policy-enforcement path still validates (its recomputed tallies agree)", () => {
    const policy = normalizeSniperPolicyConfig({ policyLabel: "test", allowPaperEnter: false });
    const enforced = enforceSniperPolicy(v1Report(), policy);
    expect(enforced.paperEnterCount).toBe(0);
    expect(() => validatePaperSniperDecisionReport(clone(enforced))).not.toThrow();
  });
});

describe("decision tally hardening — corrupted tallies refuse (v2)", () => {
  it("a corrupted paperEnterCount refuses with the recomputed value named", () => {
    const r = clone(v2Report()) as unknown as Record<string, unknown>;
    expect(r.paperEnterCount).toBe(1);
    r.paperEnterCount = 0; // hide the paper-enter — the whole Phase 6 chain keys off this count
    expect(() => validatePaperSniperDecisionReportV2(r)).toThrow(/paperEnterCount must equal the recomputed tally \(1\)/);
  });

  it("every other corrupted tally refuses too", () => {
    for (const field of ["skipCount", "watchCount", "paperRejectCount", "unknownCount"] as const) {
      const r = clone(v2Report()) as unknown as Record<string, number>;
      r[field] = (r[field] ?? 0) + 1;
      expect(() => validatePaperSniperDecisionReportV2(r), field).toThrow(new RegExp(`${field} must equal the recomputed tally`));
    }
  });

  it("a corrupted hasPaperEnter / hasRiskReject verdict refuses (and the CI mirror cannot mask it)", () => {
    // Flipping hasPaperEnter alone trips the existing wouldFail mirror; flipping both used to
    // slip through — the recomputation now refuses it.
    const r = clone(v2Report()) as unknown as Record<string, unknown>;
    r.hasPaperEnter = false;
    r.wouldFailOnPaperEnter = false;
    expect(() => validatePaperSniperDecisionReportV2(r)).toThrow(/hasPaperEnter must mirror the recomputed/);

    const r2 = clone(v2Report()) as unknown as Record<string, unknown>;
    r2.hasRiskReject = false;
    r2.wouldFailOnRisk = false;
    expect(() => validatePaperSniperDecisionReportV2(r2)).toThrow(/hasRiskReject must mirror the recomputed/);
  });

  it("a mutated candidate decision changes the expected tally (stale counts refuse; v1)", () => {
    // On v2 entries a status mutation already trips the entry-level reason-code coupling (an even
    // earlier refusal); v1 entries carry no codes, so the mutation is entry-legal there and the
    // stale tally is exactly what the new recomputation must catch.
    const r = clone(v1Report());
    const good = r.decisions.find((d) => d.candidateId === "good")!;
    expect(good.decision).toBe("paper-enter");
    (good as { decision: string }).decision = "skip";
    expect(() => validatePaperSniperDecisionReport(r)).toThrow(/recomputed tally/);
  });

  it("on v2 the same mutation is refused even earlier (entry-level code coupling)", () => {
    const r = clone(v2Report());
    const good = r.decisions.find((d) => d.candidateId === "good")!;
    (good as { decision: string }).decision = "skip";
    expect(() => validatePaperSniperDecisionReportV2(r)).toThrow();
  });
});

describe("decision tally hardening — corrupted tallies refuse (v1)", () => {
  it("a corrupted paperEnterCount refuses on the v1 validator too", () => {
    const r = clone(v1Report()) as unknown as Record<string, unknown>;
    r.paperEnterCount = 5;
    expect(() => validatePaperSniperDecisionReport(r)).toThrow(/paperEnterCount must equal the recomputed tally/);
  });

  it("a v1 report with a hidden paper-enter verdict refuses", () => {
    const r = clone(v1Report()) as unknown as Record<string, unknown>;
    r.hasPaperEnter = false;
    r.wouldFailOnPaperEnter = false;
    expect(() => validatePaperSniperDecisionReport(r)).toThrow(/hasPaperEnter must mirror the recomputed/);
  });
});
