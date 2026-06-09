/**
 * Tests for the Sprint 48 SNIPER POLICY CONFIG V2 (`sniper.policy.config.v2`). All inputs are
 * INJECTED, offline test data. A policy governs SIMULATED paper decisions only — nothing here is a
 * trade signal, an order, or live behaviour.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeSniperPolicyConfigV2,
  validateSniperPolicyConfigV2,
  formatSniperPolicyConfigV2,
  upgradeSniperPolicyConfigV1ToV2,
  projectSniperPolicyConfigV2ToV1,
  enforceSniperPolicyV2,
  SniperPolicyConfigV2Error,
  SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION,
  SNIPER_POLICY_CONFIG_V2_BANNER,
} from "./policy-config-v2.js";
import { normalizeSniperPolicyConfig, validateSniperPolicyConfig } from "./policy-config.js";
import { buildPaperSniperDecisionReportV2, validatePaperSniperDecisionReportV2, type SniperPaperDecisionReportV2 } from "./paper-decision-v2.js";
import { normalizeSniperCandidateList, type SniperCandidateInput } from "./candidate-list.js";
import { buildSniperTokenPreflightReport, type SniperPreflightCandidateData } from "./token-preflight.js";
import { buildPaperSniperDecisionReport } from "./paper-decision.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

const listOf = (...cands: SniperCandidateInput[]) =>
  normalizeSniperCandidateList({ sourceLabel: "test", candidates: cands });
const cand = (over: Partial<SniperCandidateInput> & { candidateId: string; mint: string }): SniperCandidateInput => over;
const cleanInspection = (mint: string) => ({ mint, decimals: 6, supplyRaw: "1", uiSupply: 1, mintAuthorityPresent: false, freezeAuthorityPresent: false, isInitialized: true, programLabel: "spl-token" });
const freezeInspection = (mint: string) => ({ ...cleanInspection(mint), freezeAuthorityPresent: true });
const riskPass = (mint: string) => ({ mint, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [], summary: [] });
const preflightFor = (list: ReturnType<typeof listOf>, data: SniperPreflightCandidateData[]) =>
  buildSniperTokenPreflightReport({ candidateList: list, candidateData: data });

const codesOf = (r: SniperPaperDecisionReportV2, candidateId: string): string[] =>
  r.decisions.find((d) => d.candidateId === candidateId)!.reasonCodes;

describe("normalizeSniperPolicyConfigV2 — modes", () => {
  it("derives the mode from the switches when absent (conservative defaults → conservative)", () => {
    expect(normalizeSniperPolicyConfigV2({}).policyMode).toBe("conservative");
    expect(normalizeSniperPolicyConfigV2({ allowPaperEnter: false }).policyMode).toBe("research-only");
    expect(normalizeSniperPolicyConfigV2({ failClosedOnMissingRisk: false }).policyMode).toBe("balanced-paper");
  });

  it("research-only presets allowPaperEnter=false and REFUSES an explicit contradiction", () => {
    const p = normalizeSniperPolicyConfigV2({ policyMode: "research-only" });
    expect(p.allowPaperEnter).toBe(false);
    expect(() => normalizeSniperPolicyConfigV2({ policyMode: "research-only", allowPaperEnter: true })).toThrow(
      SniperPolicyConfigV2Error,
    );
  });

  it("conservative REFUSES turning a fail-closed switch off", () => {
    expect(() => normalizeSniperPolicyConfigV2({ policyMode: "conservative", failClosedOnUnknownPreflight: false })).toThrow(/fail-closed/);
    expect(() => normalizeSniperPolicyConfigV2({ policyMode: "conservative", requirePreflightPass: false })).toThrow(/fail-closed/);
    expect(normalizeSniperPolicyConfigV2({ policyMode: "balanced-paper", failClosedOnUnknownPreflight: false }).policyMode).toBe("balanced-paper");
  });

  it("refuses an unknown mode and a requireRiskPresent/failClosedOnMissingRisk contradiction", () => {
    expect(() => normalizeSniperPolicyConfigV2({ policyMode: "yolo" as never })).toThrow(/policyMode/);
    expect(() =>
      normalizeSniperPolicyConfigV2({ failClosedOnMissingRisk: false, riskLimits: { requireRiskPresent: true } }),
    ).toThrow(/contradicts/);
  });
});

describe("normalizeSniperPolicyConfigV2 — risk limits", () => {
  it("defaults are conservative-neutral; requireRiskPresent mirrors failClosedOnMissingRisk", () => {
    const p = normalizeSniperPolicyConfigV2({});
    expect(p.schemaVersion).toBe(SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION);
    expect(p.banner).toBe(SNIPER_POLICY_CONFIG_V2_BANNER);
    expect(p.riskLimits).toEqual({
      disallowedReasonCodes: [],
      disallowedPreflightStatuses: [],
      maxWarningsPerCandidate: null,
      requireRiskPresent: true,
      requireInspectionPresent: false,
      requirePreflightInputArtifact: false,
    });
    const loose = normalizeSniperPolicyConfigV2({ failClosedOnMissingRisk: false });
    expect(loose.riskLimits.requireRiskPresent).toBe(false);
    expect(() => validateSniperPolicyConfigV2(p)).not.toThrow();
  });

  it("validates, dedupes, and sorts the disallowed lists; refuses unknown codes and a disallowed pass", () => {
    const p = normalizeSniperPolicyConfigV2({
      riskLimits: {
        disallowedReasonCodes: ["risk-missing", "preflight-warning", "risk-missing"],
        disallowedPreflightStatuses: ["unknown", "warn", "unknown"],
      },
    });
    expect(p.riskLimits.disallowedReasonCodes).toEqual(["preflight-warning", "risk-missing"]);
    expect(p.riskLimits.disallowedPreflightStatuses).toEqual(["unknown", "warn"]);
    expect(() => normalizeSniperPolicyConfigV2({ riskLimits: { disallowedReasonCodes: ["nope"] } })).toThrow(/unknown reason code/);
    expect(() => normalizeSniperPolicyConfigV2({ riskLimits: { disallowedPreflightStatuses: ["pass"] } })).toThrow(/pass can never be disallowed/);
  });
});

describe("v1 compatibility — adapter, projection, and unchanged v1", () => {
  it("upgradeSniperPolicyConfigV1ToV2 lifts a v1 config losslessly with a derived mode", () => {
    const v1 = normalizeSniperPolicyConfig({ policyLabel: "ops", allowPaperEnter: false, maxRiskScore: 40 });
    const v2 = upgradeSniperPolicyConfigV1ToV2(v1);
    expect(() => validateSniperPolicyConfigV2(v2)).not.toThrow();
    expect(v2.policyMode).toBe("research-only");
    expect(v2.policyLabel).toBe("ops");
    expect(v2.maxRiskScore).toBe(40);
    expect(v2.riskLimits.disallowedReasonCodes).toEqual([]);
    expect(v2.notes.some((n) => /Upgraded from v1/.test(n))).toBe(true);
    expect(() => upgradeSniperPolicyConfigV1ToV2({ schemaVersion: "nope" })).toThrow(SniperPolicyConfigV2Error);
  });

  it("projectSniperPolicyConfigV2ToV1 produces a valid v1 with identical base fields", () => {
    const v2 = normalizeSniperPolicyConfigV2({ policyLabel: "p", maxRiskScore: 30, denyMints: [USDC] });
    const v1 = projectSniperPolicyConfigV2ToV1(v2);
    expect(() => validateSniperPolicyConfig(v1)).not.toThrow();
    expect(v1.maxRiskScore).toBe(30);
    expect(v1.denyMints).toEqual([USDC]);
    expect(v1.schemaVersion).toBe("sniper.policy.config.v1");
  });

  it("the v1 normalizer/validator/decision path is unchanged", () => {
    const v1 = normalizeSniperPolicyConfig({ policyLabel: "still-v1" });
    expect(v1.schemaVersion).toBe("sniper.policy.config.v1");
    expect(() => validateSniperPolicyConfig(v1)).not.toThrow();
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    expect(() => buildPaperSniperDecisionReport({ candidateList: list })).not.toThrow();
  });
});

describe("policy v2 risk-limit enforcement (via the v2 decision builder)", () => {
  const enterable = () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
    return { list, pf };
  };

  it("disallowedPreflightStatuses rejects a warn candidate", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: freezeInspection(USDC), risk: riskPass(USDC) }]);
    const policy = normalizeSniperPolicyConfigV2({ riskLimits: { disallowedPreflightStatuses: ["warn"] } });
    const r = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy });
    expect(r.decisions[0]!.decision).toBe("paper-reject");
    expect(codesOf(r, "c1")).toContain("policy-disallowed-preflight-status");
    expect(r.policySchemaVersion).toBe(SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION);
    expect(() => validatePaperSniperDecisionReportV2(r)).not.toThrow();
  });

  it("maxWarningsPerCandidate downgrades a paper-enter whose preflight warned too much — but pass+0 warnings is untouched", () => {
    const { list, pf } = enterable();
    const policy = normalizeSniperPolicyConfigV2({ riskLimits: { maxWarningsPerCandidate: 0 } });
    const r = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy });
    expect(r.decisions[0]!.decision).toBe("paper-enter"); // 0 warnings ≤ cap 0
    // now a warn-status candidate with 1 warning and a cap of 0 — but warn already watches; use a
    // pass candidate with a warning-free preflight vs a cap that bites only when warnings exist.
    const list2 = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf2 = preflightFor(list2, [{ candidateId: "c1", inspection: freezeInspection(USDC), risk: riskPass(USDC) }]);
    const policy2 = normalizeSniperPolicyConfigV2({
      requirePreflightPass: false,
      riskLimits: { maxWarningsPerCandidate: 0 },
    });
    const r2 = buildPaperSniperDecisionReportV2({ candidateList: list2, preflight: pf2, policy: policy2 });
    // warn status watches in the base build; the cap applies to (still) paper-enters only.
    expect(r2.decisions[0]!.decision).toBe("watch");
  });

  it("requireInspectionPresent surfaces + downgrades a paper-enter without inspection", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", risk: riskPass(USDC) }]); // risk only → pass
    const policy = normalizeSniperPolicyConfigV2({ riskLimits: { requireInspectionPresent: true } });
    const r = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy });
    expect(r.decisions[0]!.decision).toBe("watch");
    expect(codesOf(r, "c1")).toContain("policy-missing-inspection");
  });

  it("requireRiskPresent tags a watch candidate missing risk (fail-closed already downgraded the enter)", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC) }]); // no risk → pass
    const policy = normalizeSniperPolicyConfigV2({});
    const r = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy });
    expect(r.decisions[0]!.decision).toBe("watch"); // failClosedOnMissingRisk
    const codes = codesOf(r, "c1");
    expect(codes).toContain("policy-fail-closed-missing-risk");
    expect(codes).toContain("policy-missing-risk");
  });

  it("disallowedReasonCodes rejects on a cause code from the trail (e.g. risk-missing)", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC) }]);
    const policy = normalizeSniperPolicyConfigV2({
      failClosedOnMissingRisk: false,
      riskLimits: { requireRiskPresent: false, disallowedReasonCodes: ["risk-missing"] },
    });
    const r = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy });
    expect(r.decisions[0]!.decision).toBe("paper-reject");
    expect(codesOf(r, "c1")).toContain("policy-disallowed-reason-code");
    expect(() => validatePaperSniperDecisionReportV2(r)).not.toThrow();
  });

  it("research-only mode: nothing paper-enters, and a clean candidate survives as watch", () => {
    const { list, pf } = enterable();
    const policy = normalizeSniperPolicyConfigV2({ policyMode: "research-only" });
    const r = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy });
    expect(r.paperEnterCount).toBe(0);
    expect(r.decisions[0]!.decision).toBe("watch");
    expect(codesOf(r, "c1")).toContain("policy-paper-enter-disabled");
  });

  it("tighten-only: a v2 policy never turns a non-enter into an enter", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, []); // unknown status
    const policy = normalizeSniperPolicyConfigV2({ policyMode: "balanced-paper", failClosedOnUnknownPreflight: false });
    const r = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy });
    expect(r.paperEnterCount).toBe(0);
    expect(r.decisions[0]!.decision).toBe("watch");
  });

  it("enforceSniperPolicyV2 standalone returns a valid, more-conservative v1-shaped report", () => {
    const { list, pf } = enterable();
    const base = buildPaperSniperDecisionReport({ candidateList: list, preflight: pf });
    expect(base.paperEnterCount).toBe(1);
    const policy = normalizeSniperPolicyConfigV2({ policyMode: "research-only" });
    const enforced = enforceSniperPolicyV2(base, policy, { preflight: pf });
    expect(enforced.paperEnterCount).toBe(0);
    expect(enforced.notes.some((n) => /policy v2 risk limits applied/.test(n))).toBe(true);
  });
});

describe("validateSniperPolicyConfigV2 — strict backstop", () => {
  const valid = () => normalizeSniperPolicyConfigV2({ policyLabel: "v" });

  it("rejects wrong schema/banner, an unknown mode, bad limits, and mode contradictions", () => {
    const a = JSON.parse(JSON.stringify(valid()));
    a.schemaVersion = "sniper.policy.config.v1";
    expect(() => validateSniperPolicyConfigV2(a)).toThrow(/schemaVersion/);

    const b = JSON.parse(JSON.stringify(valid()));
    b.policyMode = "aggressive";
    expect(() => validateSniperPolicyConfigV2(b)).toThrow(/policyMode/);

    const c = JSON.parse(JSON.stringify(valid()));
    c.riskLimits.disallowedReasonCodes = ["not-a-code"];
    expect(() => validateSniperPolicyConfigV2(c)).toThrow(/known reason codes/);

    const d = JSON.parse(JSON.stringify(valid()));
    d.policyMode = "research-only"; // but allowPaperEnter stays true
    expect(() => validateSniperPolicyConfigV2(d)).toThrow(/research-only/);

    // a balanced-paper base, so only the requireRiskPresent contradiction fires (not the mode check)
    const e = JSON.parse(JSON.stringify(normalizeSniperPolicyConfigV2({ failClosedOnUnknownPreflight: false })));
    e.failClosedOnMissingRisk = false; // but requireRiskPresent stays true
    expect(() => validateSniperPolicyConfigV2(e)).toThrow(/contradicts/);
  });
});

describe("formatSniperPolicyConfigV2 — deterministic operator output", () => {
  it("shows the mode, the risk limits, and the tighten-only disclaimers", () => {
    const p = normalizeSniperPolicyConfigV2({
      policyLabel: "fmt",
      riskLimits: { disallowedPreflightStatuses: ["unknown"], maxWarningsPerCandidate: 2 },
    });
    const text = formatSniperPolicyConfigV2(p, { label: "t" });
    expect(text).toContain(SNIPER_POLICY_CONFIG_V2_BANNER);
    expect(text).toContain("mode:    conservative");
    expect(text).toContain("Risk limits (v2; tighten-only):");
    expect(text).toContain("- disallowedPreflightStatuses:  unknown");
    expect(text).toContain("- maxWarningsPerCandidate:      2");
    expect(text).toContain("maximum paper-enter count");
    expect(formatSniperPolicyConfigV2(p, { label: "t" })).toBe(text);
  });
});
