/**
 * Tests for the Sprint 27 PAPER SNIPER DECISION pipeline. All inputs are INJECTED, offline test data
 * — real well-known mints as deterministic fixtures, hand-built inspection/risk shaped like
 * token:inspect / token:risk output, fed through the real preflight builder. A `paper-enter` here is a
 * SIMULATED decision; nothing is a live result, a verified on-chain fact, or a trade signal.
 */

import { describe, it, expect } from "vitest";
import { REDACTED } from "@soulmaker/security";
import {
  buildPaperSniperDecisionReport,
  validatePaperSniperDecisionReport,
  formatPaperSniperDecisionReport,
  PaperSniperDecisionReportError,
  SNIPER_PAPER_DECISION_REPORT_SCHEMA_VERSION,
  SNIPER_PAPER_DECISION_REPORT_BANNER,
  type SniperDecisionRules,
  type SniperPaperDecisionReport,
} from "./paper-decision.js";
import { normalizeSniperCandidateList, type SniperCandidateInput } from "./candidate-list.js";
import { buildSniperTokenPreflightReport, type SniperPreflightCandidateData } from "./token-preflight.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

const listOf = (...cands: SniperCandidateInput[]) =>
  normalizeSniperCandidateList({ sourceLabel: "test", candidates: cands });
const cand = (over: Partial<SniperCandidateInput> & { candidateId: string; mint: string }): SniperCandidateInput => over;

const cleanInspection = (mint: string) => ({ mint, decimals: 6, supplyRaw: "1", uiSupply: 1, mintAuthorityPresent: false, freezeAuthorityPresent: false, isInitialized: true, programLabel: "spl-token" });
const freezeInspection = (mint: string) => ({ ...cleanInspection(mint), freezeAuthorityPresent: true });
const riskPass = (mint: string) => ({ mint, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [], summary: [] });
const riskCaution = (mint: string) => ({ mint, score: 55, decision: "CAUTION", flags: [{ id: "x", severity: "high", title: "High" }], summary: [] });
const riskReject = (mint: string) => ({ mint, score: 95, decision: "REJECT", flags: [{ id: "rug", severity: "critical", title: "Rug" }], summary: [] });

const preflightFor = (list: ReturnType<typeof listOf>, data: SniperPreflightCandidateData[]) =>
  buildSniperTokenPreflightReport({ candidateList: list, candidateData: data });

const decide = (list: ReturnType<typeof listOf>, preflight?: unknown, rules?: SniperDecisionRules) =>
  buildPaperSniperDecisionReport({ candidateList: list, preflight, rules });

describe("buildPaperSniperDecisionReport — per-candidate decisions", () => {
  it("paper-enters a clean-pass candidate (preflight pass + PASS risk)", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const r = decide(list, pf);
    const d = r.decisions[0]!;
    expect(d.decision).toBe("paper-enter");
    expect(d.preflightStatus).toBe("pass");
    expect(r.paperEnterCount).toBe(1);
    expect(r.hasPaperEnter).toBe(true);
    expect(r.wouldFailOnPaperEnter).toBe(true);
    expect(() => validatePaperSniperDecisionReport(r)).not.toThrow();
  });

  it("paper-rejects a candidate whose preflight failed (risk REJECT) and records blocking flags", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", risk: riskReject(USDC) }]);
    const r = decide(list, pf);
    const d = r.decisions[0]!;
    expect(d.decision).toBe("paper-reject");
    expect(d.blockingRiskFlags.length).toBeGreaterThan(0);
    expect(r.hasRiskReject).toBe(true);
    expect(r.wouldFailOnRisk).toBe(true);
  });

  it("watches a candidate whose preflight warned", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: freezeInspection(USDC) }]);
    const r = decide(list, pf);
    expect(r.decisions[0]!.decision).toBe("watch");
    expect(r.watchCount).toBe(1);
  });

  it("watches a candidate with missing info (preflight unknown)", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, []); // no data → preflight unknown
    const r = decide(list, pf);
    expect(r.decisions[0]!.decision).toBe("watch");
    expect(r.decisions[0]!.reasons.some((x) => /could not assess/.test(x))).toBe(true);
  });

  it("watches every candidate when no preflight report is supplied", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }), cand({ candidateId: "c2", mint: WSOL }));
    const r = decide(list);
    expect(r.hasPreflight).toBe(false);
    expect(r.decisions.every((d) => d.decision === "watch")).toBe(true);
    expect(r.warnings.some((w) => /no preflight report supplied/.test(w))).toBe(true);
  });

  it("skips a denylisted mint outright (before evaluation)", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const r = decide(list, pf, { denyMints: [USDC] });
    expect(r.decisions[0]!.decision).toBe("skip");
    expect(r.decisions[0]!.appliedRules).toContain("denyMints");
  });
});

describe("buildPaperSniperDecisionReport — rules", () => {
  it("paper-rejects when a risk score exceeds maxRiskScore", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    // a CAUTION (warn) preflight that would otherwise be 'watch', but score 55 > max 50 → reject
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskCaution(USDC) }]);
    const r = decide(list, pf, { maxRiskScore: 50 });
    expect(r.decisions[0]!.decision).toBe("paper-reject");
    expect(r.decisions[0]!.reasons.some((x) => /exceeds the max/.test(x))).toBe(true);
    expect(r.hasRiskReject).toBe(true);
  });

  it("watches a pass candidate whose observed liquidity is below minObservedLiquidityUsd", () => {
    const list = listOf(cand({ candidateId: "lo", mint: USDC, observedLiquidityUsd: 100 }), cand({ candidateId: "hi", mint: WSOL, observedLiquidityUsd: 100000 }));
    const pf = preflightFor(list, [
      { candidateId: "lo", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
      { candidateId: "hi", inspection: cleanInspection(WSOL), risk: riskPass(WSOL) },
    ]);
    const r = decide(list, pf, { minObservedLiquidityUsd: 1000 });
    expect(r.decisions.find((d) => d.candidateId === "lo")!.decision).toBe("watch");
    expect(r.decisions.find((d) => d.candidateId === "hi")!.decision).toBe("paper-enter");
  });

  it("watches a pass candidate with no observed liquidity when a floor is set", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC })); // no observedLiquidityUsd
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const r = decide(list, pf, { minObservedLiquidityUsd: 1000 });
    expect(r.decisions[0]!.decision).toBe("watch");
    expect(r.decisions[0]!.assumptions.some((a) => /no observed liquidity/.test(a))).toBe(true);
  });

  it("echoes the resolved rules (defaults made explicit)", () => {
    const r = decide(listOf(cand({ candidateId: "c1", mint: USDC })));
    expect(r.rules.requirePreflightPass).toBe(true);
    expect(r.rules.maxRiskScore).toBeNull();
    expect(r.rules.minObservedLiquidityUsd).toBeNull();
    expect(r.rules.denyMints).toEqual([]);
  });

  it("rejects malformed rules", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    expect(() => decide(list, undefined, { maxRiskScore: -1 })).toThrow(/non-negative/);
    expect(() => decide(list, undefined, { denyMints: [5 as unknown as string] })).toThrow(/array of strings/);
  });
});

describe("buildPaperSniperDecisionReport — determinism + rejection", () => {
  it("is byte-stable, preserves candidate order, and carries no timestamp", () => {
    const list = listOf(cand({ candidateId: "z", mint: WSOL }), cand({ candidateId: "a", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "a", risk: riskReject(USDC) }]);
    const first = JSON.stringify(decide(list, pf));
    const second = JSON.stringify(decide(list, pf));
    expect(first).toBe(second);
    expect(JSON.parse(first).decisions.map((d: { candidateId: string }) => d.candidateId)).toEqual(["z", "a"]);
    expect(first).not.toMatch(/"generatedAt"|"createdAt"|"timestamp"|"ranAt"/);
  });

  it("does not mutate its inputs", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", risk: riskPass(USDC) }]);
    const before = JSON.stringify({ list, pf });
    decide(list, pf);
    expect(JSON.stringify({ list, pf })).toBe(before);
  });

  it("refuses a non-candidate-list input and a preflight referencing an unknown candidateId", () => {
    expect(() => buildPaperSniperDecisionReport({ candidateList: { schemaVersion: "x" } })).toThrow(
      PaperSniperDecisionReportError,
    );
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const otherList = listOf(cand({ candidateId: "ghost", mint: WSOL }));
    const pf = preflightFor(otherList, [{ candidateId: "ghost", risk: riskPass(WSOL) }]);
    expect(() => decide(list, pf)).toThrow(/unknown candidateId "ghost"/);
  });
});

describe("validatePaperSniperDecisionReport", () => {
  const sample = () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }), cand({ candidateId: "c2", mint: WSOL }));
    const pf = preflightFor(list, [
      { candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
      { candidateId: "c2", risk: riskReject(WSOL) },
    ]);
    return decide(list, pf);
  };

  it("accepts a freshly-built report (round-trips through JSON)", () => {
    expect(() => validatePaperSniperDecisionReport(JSON.parse(JSON.stringify(sample())))).not.toThrow();
  });

  it("rejects a wrong schemaVersion and a non-object", () => {
    expect(() => validatePaperSniperDecisionReport(null)).toThrow(PaperSniperDecisionReportError);
    const r = JSON.parse(JSON.stringify(sample())) as { schemaVersion: string };
    r.schemaVersion = "sniper.paper.decision.report.v2";
    expect(() => validatePaperSniperDecisionReport(r)).toThrow(/schemaVersion/);
  });

  it("rejects a CI gate that does not mirror its flag", () => {
    const r = JSON.parse(JSON.stringify(sample())) as SniperPaperDecisionReport;
    r.wouldFailOnPaperEnter = !r.hasPaperEnter;
    expect(() => validatePaperSniperDecisionReport(r)).toThrow(/must mirror/);
  });

  it("rejects an entry with an invalid decision", () => {
    const r = JSON.parse(JSON.stringify(sample())) as SniperPaperDecisionReport;
    (r.decisions[0] as unknown as { decision: string }).decision = "buy";
    expect(() => validatePaperSniperDecisionReport(r)).toThrow(/decision must be/);
  });
});

describe("formatPaperSniperDecisionReport", () => {
  it("renders a stable, sectioned PAPER-ONLY human report", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }), cand({ candidateId: "c2", mint: WSOL }));
    const pf = preflightFor(list, [
      { candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
      { candidateId: "c2", risk: riskReject(WSOL) },
    ]);
    const text = formatPaperSniperDecisionReport(decide(list, pf));
    expect(text).toBe(formatPaperSniperDecisionReport(decide(list, pf))); // deterministic
    expect(text).toContain(SNIPER_PAPER_DECISION_REPORT_BANNER);
    expect(text).toContain("PAPER ONLY");
    expect(text).toContain("[PAPER-ENTER]");
    expect(text).toContain("[PAPER-REJECT]");
    expect(text.toLowerCase()).toContain("not a trade signal");
    expect(decide(list, pf).schemaVersion).toBe(SNIPER_PAPER_DECISION_REPORT_SCHEMA_VERSION);
  });

  it("routes the whole output through the shared redactor", () => {
    const secretish = "a".repeat(64);
    const list = normalizeSniperCandidateList({ sourceLabel: secretish, candidates: [{ candidateId: "c1", mint: USDC }] });
    const text = formatPaperSniperDecisionReport(buildPaperSniperDecisionReport({ candidateList: list }));
    expect(text).toContain(REDACTED);
    expect(text).not.toContain(secretish);
  });
});
