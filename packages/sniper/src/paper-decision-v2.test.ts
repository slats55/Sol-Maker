/**
 * Tests for the Sprint 46 PAPER SNIPER DECISION REPORT V2 (structured reason codes). All inputs are
 * INJECTED, offline test data — real well-known mints as deterministic fixtures, hand-built
 * inspection/risk shaped like token:inspect / token:risk output, fed through the real preflight
 * builder and the real policy normalizer. A `paper-enter` here is a SIMULATED decision; nothing is a
 * live result, a verified on-chain fact, or a trade signal.
 */

import { describe, it, expect } from "vitest";
import {
  buildPaperSniperDecisionReportV2,
  validatePaperSniperDecisionReportV2,
  formatPaperSniperDecisionReportV2,
  upgradePaperSniperDecisionReportV1ToV2,
  PaperSniperDecisionReportV2Error,
  SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION,
  SNIPER_PAPER_DECISION_REPORT_V2_BANNER,
  type SniperPaperDecisionReportV2,
} from "./paper-decision-v2.js";
import {
  buildPaperSniperDecisionReport,
  validatePaperSniperDecisionReport,
  type SniperDecisionRules,
} from "./paper-decision.js";
import {
  SNIPER_DECISION_REASON_CODES,
  SNIPER_DECISION_REASON_CODE_DEFINITIONS,
  dedupeSniperDecisionReasonCodes,
  isSniperDecisionReasonCode,
} from "./decision-reason-codes.js";
import { normalizeSniperPolicyConfig, enforceSniperPolicy, type NormalizeSniperPolicyConfigInput } from "./policy-config.js";
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

const buildV2 = (list: ReturnType<typeof listOf>, preflight?: unknown, rules?: SniperDecisionRules, policy?: unknown) =>
  buildPaperSniperDecisionReportV2({ candidateList: list, preflight, rules, policy });

const policyOf = (input: NormalizeSniperPolicyConfigInput) => normalizeSniperPolicyConfig(input);

const codesOf = (r: SniperPaperDecisionReportV2, candidateId: string): string[] =>
  r.decisions.find((d) => d.candidateId === candidateId)!.reasonCodes;

describe("decision-reason-codes — vocabulary integrity", () => {
  it("every code has a definition whose .code round-trips, and the union is closed", () => {
    for (const code of SNIPER_DECISION_REASON_CODES) {
      expect(SNIPER_DECISION_REASON_CODE_DEFINITIONS[code].code).toBe(code);
      expect(isSniperDecisionReasonCode(code)).toBe(true);
    }
    expect(isSniperDecisionReasonCode("not-a-code")).toBe(false);
    expect(isSniperDecisionReasonCode(42)).toBe(false);
  });

  it("no code is both blocking and warning; report-scoped codes are never outcome markers", () => {
    for (const code of SNIPER_DECISION_REASON_CODES) {
      const d = SNIPER_DECISION_REASON_CODE_DEFINITIONS[code];
      expect(d.blocking && d.warning, `${code} must not be blocking AND warning`).toBe(false);
      if (d.scope === "report") expect(d.category).not.toBe("decision");
    }
  });

  it("dedupe preserves first-occurrence order", () => {
    expect(dedupeSniperDecisionReasonCodes(["risk-missing", "preflight-fail", "risk-missing"])).toEqual([
      "risk-missing",
      "preflight-fail",
    ]);
  });
});

describe("buildPaperSniperDecisionReportV2 — cause codes match the v1 branches", () => {
  it("paper-enter (clean pass): paper-enter-candidate outcome, no blocking codes", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const r = buildV2(list, pf);
    expect(r.schemaVersion).toBe(SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION);
    expect(r.banner).toBe(SNIPER_PAPER_DECISION_REPORT_V2_BANNER);
    expect(codesOf(r, "c1")).toEqual(["paper-enter-candidate"]);
    expect(r.decisions[0]!.blockingReasonCodes).toEqual([]);
    expect(r.policyApplied).toBe(false);
    expect(r.upgradedFromV1).toBe(false);
    expect(() => validatePaperSniperDecisionReportV2(r)).not.toThrow();
  });

  it("preflight fail (risk REJECT): preflight-fail + risk-blocked + paper-reject-candidate", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", risk: riskReject(USDC) }]);
    const r = buildV2(list, pf);
    expect(codesOf(r, "c1")).toEqual(["preflight-fail", "risk-blocked", "paper-reject-candidate"]);
    const d = r.decisions[0]!;
    expect(d.blockingReasonCodes).toEqual(["preflight-fail", "risk-blocked"]);
    expect(d.riskReasonCodes).toEqual(["risk-blocked"]);
    expect(r.hasRiskReject).toBe(true);
    expect(() => validatePaperSniperDecisionReportV2(r)).not.toThrow();
  });

  it("preflight warn: preflight-warning + watch-candidate", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: freezeInspection(USDC) }]);
    const r = buildV2(list, pf);
    expect(codesOf(r, "c1")).toEqual(["preflight-warning", "watch-candidate"]);
    expect(r.decisions[0]!.warningReasonCodes).toEqual(["preflight-warning"]);
  });

  it("preflight unknown: preflight-unknown + watched-incomplete-info", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, []);
    const r = buildV2(list, pf);
    expect(codesOf(r, "c1")).toEqual(["preflight-unknown", "watched-incomplete-info", "watch-candidate"]);
  });

  it("no preflight report: missing-preflight per candidate + missing-preflight-report run-level", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }), cand({ candidateId: "c2", mint: WSOL }));
    const r = buildV2(list);
    expect(codesOf(r, "c1")).toEqual(["missing-preflight", "watched-incomplete-info", "watch-candidate"]);
    expect(r.reportReasonCodes).toEqual(["missing-preflight-report"]);
    expect(r.hasPreflight).toBe(false);
  });

  it("denylist: operator-denylist-mint + skip-candidate (policy-driven, blocking)", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const r = buildV2(list, pf, { denyMints: [USDC] });
    expect(codesOf(r, "c1")).toEqual(["operator-denylist-mint", "skip-candidate"]);
    const d = r.decisions[0]!;
    expect(d.blockingReasonCodes).toEqual(["operator-denylist-mint"]);
    expect(d.policyReasonCodes).toEqual(["operator-denylist-mint"]);
  });

  it("invalid mint (crafted preflight entry with mintValid=false): invalid-mint + skip-candidate", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    // Craft a preflight whose entry claims the mint failed validation (defensive branch).
    const crafted = JSON.parse(JSON.stringify(pf)) as { candidates: { mintValid: boolean }[] };
    crafted.candidates[0]!.mintValid = false;
    const r = buildV2(list, crafted);
    expect(codesOf(r, "c1")).toEqual(["invalid-mint", "skip-candidate"]);
  });

  it("risk score over cap: risk-score-exceeds-cap + risk-blocked + paper-reject-candidate", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskCaution(USDC) }]);
    const r = buildV2(list, pf, { maxRiskScore: 50 });
    expect(codesOf(r, "c1")).toEqual(["risk-score-exceeds-cap", "risk-blocked", "paper-reject-candidate"]);
  });

  it("risk missing on a paper-enter (no risk supplied): risk-missing warning code", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC) }]);
    const r = buildV2(list, pf);
    expect(codesOf(r, "c1")).toEqual(["risk-missing", "paper-enter-candidate"]);
    expect(r.decisions[0]!.riskReasonCodes).toEqual(["risk-missing"]);
  });

  it("liquidity floor: liquidity-below-floor for low, liquidity-unknown for absent", () => {
    const list = listOf(
      cand({ candidateId: "lo", mint: USDC, observedLiquidityUsd: 100 }),
      cand({ candidateId: "none", mint: WSOL }),
    );
    const pf = preflightFor(list, [
      { candidateId: "lo", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
      { candidateId: "none", inspection: cleanInspection(WSOL), risk: riskPass(WSOL) },
    ]);
    const r = buildV2(list, pf, { minObservedLiquidityUsd: 1000 });
    expect(codesOf(r, "lo")).toEqual(["liquidity-below-floor", "watch-candidate"]);
    expect(codesOf(r, "none")).toEqual(["liquidity-unknown", "watched-incomplete-info", "watch-candidate"]);
  });
});

describe("buildPaperSniperDecisionReportV2 — policy enforcement codes", () => {
  const enterableList = () => listOf(cand({ candidateId: "c1", mint: USDC }));
  const enterablePf = (list: ReturnType<typeof listOf>) =>
    preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);

  it("rules and policy together are refused", () => {
    const list = enterableList();
    expect(() => buildV2(list, undefined, {}, policyOf({}))).toThrow(PaperSniperDecisionReportV2Error);
  });

  it("policy-allowed-paper-enter when a paper-enter survives every policy check", () => {
    const list = enterableList();
    const r = buildV2(list, enterablePf(list), undefined, policyOf({ policyLabel: "ok" }));
    expect(codesOf(r, "c1")).toEqual(["policy-allowed-paper-enter", "paper-enter-candidate"]);
    expect(r.policyApplied).toBe(true);
    expect(r.policyLabel).toBe("ok");
    expect(() => validatePaperSniperDecisionReportV2(r)).not.toThrow();
  });

  it("policy-paper-enter-disabled when allowPaperEnter=false", () => {
    const list = enterableList();
    const r = buildV2(list, enterablePf(list), undefined, policyOf({ allowPaperEnter: false }));
    expect(codesOf(r, "c1")).toEqual(["policy-paper-enter-disabled", "watch-candidate"]);
    expect(r.paperEnterCount).toBe(0);
  });

  it("policy-paper-enter-cap-exceeded for entries over maxCandidatesToPaperEnter", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }), cand({ candidateId: "c2", mint: WSOL }));
    const pf = preflightFor(list, [
      { candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
      { candidateId: "c2", inspection: cleanInspection(WSOL), risk: riskPass(WSOL) },
    ]);
    const r = buildV2(list, pf, undefined, policyOf({ paperSizing: { maxCandidatesToPaperEnter: 1 } }));
    expect(codesOf(r, "c1")).toEqual(["policy-allowed-paper-enter", "paper-enter-candidate"]);
    expect(codesOf(r, "c2")).toEqual(["policy-paper-enter-cap-exceeded", "watch-candidate"]);
  });

  it("policy-fail-closed-unknown-preflight rejects an unassessable candidate", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, []);
    const r = buildV2(list, pf, undefined, policyOf({ failClosedOnUnknownPreflight: true }));
    expect(codesOf(r, "c1")).toEqual([
      "preflight-unknown",
      "watched-incomplete-info",
      "policy-fail-closed-unknown-preflight",
      "paper-reject-candidate",
    ]);
    expect(r.decisions[0]!.decision).toBe("paper-reject");
  });

  it("policy-fail-closed-missing-risk downgrades a riskless paper-enter to watch", () => {
    const list = enterableList();
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC) }]);
    const r = buildV2(list, pf, undefined, policyOf({ failClosedOnMissingRisk: true, failClosedOnUnknownPreflight: false }));
    expect(codesOf(r, "c1")).toEqual(["risk-missing", "policy-fail-closed-missing-risk", "watch-candidate"]);
  });

  it("policy-disallowed-risk-flag rejects on a disallowed flag id", () => {
    const list = enterableList();
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskCaution(USDC) }]);
    const r = buildV2(list, pf, undefined, policyOf({ disallowedRiskFlags: ["x"] }));
    expect(codesOf(r, "c1")).toEqual(["preflight-warning", "policy-disallowed-risk-flag", "paper-reject-candidate"]);
    expect(r.decisions[0]!.blockingRiskFlags.map((f) => f.id)).toEqual(["x"]);
  });

  it("policy-duplicate-mint skips duplicates under duplicateMintPolicy=reject", () => {
    const list = listOf(cand({ candidateId: "a", mint: USDC }), cand({ candidateId: "b", mint: USDC }));
    const pf = preflightFor(list, [
      { candidateId: "a", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
      { candidateId: "b", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
    ]);
    const r = buildV2(list, pf, undefined, policyOf({ duplicateMintPolicy: "reject" }));
    expect(codesOf(r, "a")).toEqual(["policy-duplicate-mint", "skip-candidate"]);
    expect(codesOf(r, "b")).toEqual(["policy-duplicate-mint", "skip-candidate"]);
  });

  it("run-level codes: duplicate-mints-present (warn mode) and policy-max-candidates-per-run-exceeded", () => {
    const list = listOf(cand({ candidateId: "a", mint: USDC }), cand({ candidateId: "b", mint: USDC }));
    const r = buildV2(list, undefined, undefined, policyOf({ duplicateMintPolicy: "warn", maxCandidatesPerRun: 1, failClosedOnUnknownPreflight: false }));
    expect(r.reportReasonCodes).toEqual([
      "missing-preflight-report",
      "policy-max-candidates-per-run-exceeded",
      "duplicate-mints-present",
    ]);
    expect(() => validatePaperSniperDecisionReportV2(r)).not.toThrow();
  });
});

describe("v2 summaries — deterministic counts", () => {
  it("reasonCodeCounts and categoryCounts are sorted, exact, and reproducible", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }), cand({ candidateId: "c2", mint: WSOL }));
    const pf = preflightFor(list, [{ candidateId: "c1", risk: riskReject(USDC) }]);
    const r1 = buildV2(list, pf);
    const r2 = buildV2(list, pf);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(r1.reasonCodeCounts).toEqual({
      "paper-reject-candidate": 1,
      "preflight-fail": 1,
      "preflight-unknown": 1,
      "risk-blocked": 1,
      "watch-candidate": 1,
      "watched-incomplete-info": 1,
    });
    expect(r1.categoryCounts).toEqual({ decision: 3, preflight: 2, risk: 1 });
    expect(Object.keys(r1.reasonCodeCounts)).toEqual([...Object.keys(r1.reasonCodeCounts)].sort());
  });
});

describe("upgradePaperSniperDecisionReportV1ToV2 — structured-fields-only adapter", () => {
  const v1Report = () => {
    const list = listOf(
      cand({ candidateId: "enter", mint: USDC }),
      cand({ candidateId: "reject", mint: WSOL }),
    );
    const pf = preflightFor(list, [
      { candidateId: "enter", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
      { candidateId: "reject", risk: riskReject(WSOL) },
    ]);
    return buildPaperSniperDecisionReport({ candidateList: list, preflight: pf });
  };

  it("lifts a v1 report into a valid v2 with conservative codes and honest provenance", () => {
    const v1 = v1Report();
    const v2 = upgradePaperSniperDecisionReportV1ToV2(v1);
    expect(() => validatePaperSniperDecisionReportV2(v2)).not.toThrow();
    expect(v2.upgradedFromV1).toBe(true);
    expect(v2.policyApplied).toBeNull();
    expect(v2.policyLabel).toBeNull();
    expect(codesOf(v2, "enter")).toEqual(["paper-enter-candidate"]);
    expect(codesOf(v2, "reject")).toEqual(["preflight-fail", "risk-blocked", "paper-reject-candidate"]);
    // v1 aggregates carried verbatim.
    expect(v2.paperEnterCount).toBe(v1.paperEnterCount);
    expect(v2.hasRiskReject).toBe(v1.hasRiskReject);
    expect(v2.ciFailReasons).toEqual(v1.ciFailReasons);
    expect(v2.notes.some((n) => /conservative subset/.test(n))).toBe(true);
  });

  it("derives denylist + missing-preflight + unknown-state codes from structured fields", () => {
    const list = listOf(cand({ candidateId: "deny", mint: USDC }), cand({ candidateId: "watch", mint: WSOL }));
    const v1 = buildPaperSniperDecisionReport({ candidateList: list, rules: { denyMints: [USDC] } });
    const v2 = upgradePaperSniperDecisionReportV1ToV2(v1);
    expect(codesOf(v2, "deny")).toEqual(["missing-preflight", "operator-denylist-mint", "skip-candidate"]);
    expect(codesOf(v2, "watch")).toEqual(["missing-preflight", "watched-incomplete-info", "watch-candidate"]);
    expect(v2.reportReasonCodes).toEqual(["missing-preflight-report"]);
  });

  it("NEVER parses free-text reasons: mutating reason strings does not change the derived codes", () => {
    const v1 = v1Report();
    const tampered = JSON.parse(JSON.stringify(v1)) as { decisions: { reasons: string[] }[] };
    tampered.decisions[0]!.reasons = ["policy ⛔ paper-enter disabled by policy", "risk score 999 exceeds the max 1"];
    const a = upgradePaperSniperDecisionReportV1ToV2(v1);
    const b = upgradePaperSniperDecisionReportV1ToV2(tampered);
    expect(b.decisions[0]!.reasonCodes).toEqual(a.decisions[0]!.reasonCodes);
  });

  it("handles a v1 'unknown' decision via preflight-status-unrecognized", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const v1 = buildPaperSniperDecisionReport({ candidateList: list, preflight: pf });
    const crafted = JSON.parse(JSON.stringify(v1)) as {
      decisions: { decision: string; preflightStatus: string }[];
      paperEnterCount: number; unknownCount: number; hasPaperEnter: boolean;
      wouldFailOnPaperEnter: boolean; ciFailReasons: string[];
    };
    crafted.decisions[0]!.decision = "unknown";
    crafted.decisions[0]!.preflightStatus = "weird";
    crafted.paperEnterCount = 0;
    crafted.unknownCount = 1;
    crafted.hasPaperEnter = false;
    crafted.wouldFailOnPaperEnter = false;
    crafted.ciFailReasons = [];
    expect(() => validatePaperSniperDecisionReport(crafted)).not.toThrow();
    const v2 = upgradePaperSniperDecisionReportV1ToV2(crafted);
    expect(v2.decisions[0]!.reasonCodes).toEqual(["preflight-status-unrecognized", "unknown-candidate"]);
  });

  it("refuses a non-v1 input", () => {
    expect(() => upgradePaperSniperDecisionReportV1ToV2({ schemaVersion: "nope" })).toThrow(PaperSniperDecisionReportV2Error);
  });
});

describe("v1 compatibility — the v1 surface is unchanged by the v2 refactor", () => {
  it("v1 build + enforce still validate and carry no code fields", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const v1 = buildPaperSniperDecisionReport({ candidateList: list, preflight: pf });
    expect(() => validatePaperSniperDecisionReport(v1)).not.toThrow();
    expect("reasonCodes" in v1.decisions[0]!).toBe(false);
    const enforced = enforceSniperPolicy(v1, policyOf({ allowPaperEnter: false }), { preflight: pf });
    expect(() => validatePaperSniperDecisionReport(enforced)).not.toThrow();
    expect("reasonCodes" in enforced.decisions[0]!).toBe(false);
    expect(enforced.decisions[0]!.decision).toBe("watch");
  });
});

describe("validatePaperSniperDecisionReportV2 — strict backstop", () => {
  const valid = () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    return buildV2(list, pf);
  };

  it("rejects an unknown reason code, a missing outcome marker, and a tampered derived array", () => {
    const a = JSON.parse(JSON.stringify(valid()));
    a.decisions[0].reasonCodes = ["definitely-not-a-code", "paper-enter-candidate"];
    expect(() => validatePaperSniperDecisionReportV2(a)).toThrow(/unknown reason code/);

    const b = JSON.parse(JSON.stringify(valid()));
    b.decisions[0].reasonCodes = ["risk-missing"];
    expect(() => validatePaperSniperDecisionReportV2(b)).toThrow(/outcome marker/);

    const c = JSON.parse(JSON.stringify(valid()));
    c.decisions[0].blockingReasonCodes = ["preflight-fail"];
    expect(() => validatePaperSniperDecisionReportV2(c)).toThrow(/derived from reasonCodes/);
  });

  it("rejects tampered summary counts and report-scoped codes in entries", () => {
    const a = JSON.parse(JSON.stringify(valid()));
    a.reasonCodeCounts = { "paper-enter-candidate": 99 };
    expect(() => validatePaperSniperDecisionReportV2(a)).toThrow(/recomputed per-code counts/);

    const b = JSON.parse(JSON.stringify(valid()));
    b.decisions[0].reasonCodes = ["missing-preflight-report", "paper-enter-candidate"];
    expect(() => validatePaperSniperDecisionReportV2(b)).toThrow(/report-scoped/);

    const c = JSON.parse(JSON.stringify(valid()));
    c.reportReasonCodes = ["paper-enter-candidate"];
    expect(() => validatePaperSniperDecisionReportV2(c)).toThrow(/candidate-scoped/);
  });

  it("rejects wrong schema/banner and broken CI mirrors", () => {
    const a = JSON.parse(JSON.stringify(valid()));
    a.schemaVersion = "sniper.paper.decision.report.v1";
    expect(() => validatePaperSniperDecisionReportV2(a)).toThrow(/schemaVersion/);

    const b = JSON.parse(JSON.stringify(valid()));
    b.wouldFailOnPaperEnter = false;
    expect(() => validatePaperSniperDecisionReportV2(b)).toThrow(/mirror/);
  });
});

describe("formatPaperSniperDecisionReportV2 — deterministic operator output (Sprint 49 quality pass)", () => {
  it("shows the banner, the classified code table, the grouped reason trail, and the disclaimers", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", risk: riskReject(USDC) }]);
    const r = buildV2(list, pf);
    const text = formatPaperSniperDecisionReportV2(r, { label: "t" });
    expect(text).toContain(SNIPER_PAPER_DECISION_REPORT_V2_BANNER);
    expect(text).toContain("Reason codes (per-candidate occurrences, sorted):");
    expect(text).toContain("- preflight-fail  ×1  [preflight blocking]");
    expect(text).toContain("PAPER-REJECT (1):");
    expect(text).toContain("codes: preflight-fail → risk-blocked → paper-reject-candidate");
    expect(text).toContain("risk flags: rug (critical)");
    expect(text).toContain("Not a trade signal.");
    expect(formatPaperSniperDecisionReportV2(r, { label: "t" })).toBe(text);
  });

  it("groups decisions in stable order (paper-enter → paper-reject → watch → skip → unknown)", () => {
    const list = listOf(
      cand({ candidateId: "watcher", mint: WSOL }),
      cand({ candidateId: "enterer", mint: USDC }),
    );
    // the enterer has NO risk report → its entry records an explicit assumption
    const pf = preflightFor(list, [{ candidateId: "enterer", inspection: cleanInspection(USDC) }]);
    const text = formatPaperSniperDecisionReportV2(buildV2(list, pf));
    const enterAt = text.indexOf("PAPER-ENTER (1):");
    const watchAt = text.indexOf("WATCH (1):");
    expect(enterAt).toBeGreaterThan(-1);
    expect(watchAt).toBeGreaterThan(enterAt);
    // each entry carries its preflight status and assumptions inline
    expect(text).toContain("(preflight: unknown)");
    expect(text).toContain("assumes: ");
  });

  it("shows the policy summary, the risk summary, and the CI verdict sections", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    const r = buildV2(list, pf, undefined, policyOf({ policyLabel: "ops" }));
    const text = formatPaperSniperDecisionReportV2(r);
    expect(text).toContain("Policy:");
    expect(text).toContain("- applied: ops (sniper.policy.config.v1)");
    expect(text).toContain("- rules: requirePreflightPass=true");
    expect(text).toContain("Risk summary:");
    expect(text).toContain("- candidates with blocking risk flags: 0");
    expect(text).toContain("CI verdict:");
    expect(text).toContain("- any paper-enter:  YES");
  });

  it("caps rows at maxRows and summarizes the rest", () => {
    const many = Array.from({ length: 7 }, (_, i) => cand({ candidateId: `c${i}`, mint: USDC }));
    const r = buildV2(listOf(...many));
    const text = formatPaperSniperDecisionReportV2(r, { maxRows: 3 });
    expect(text).toContain("… and 4 more");
  });
});
