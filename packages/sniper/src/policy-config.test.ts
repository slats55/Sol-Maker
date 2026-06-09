/**
 * Tests for the Sprint 32 SNIPER POLICY CONFIG. All inputs are INJECTED. A policy can only TIGHTEN the
 * paper pipeline; enforcement may downgrade a SIMULATED paper-enter but never the reverse, and never
 * enables live behaviour. Nothing here is a trade signal, an order, or a profit/currency claim.
 */

import { describe, it, expect } from "vitest";
import { REDACTED } from "@soulmaker/security";
import {
  normalizeSniperPolicyConfig,
  validateSniperPolicyConfig,
  formatSniperPolicyConfig,
  deriveSniperDecisionRules,
  enforceSniperPolicy,
  SniperPolicyConfigError,
  SNIPER_POLICY_CONFIG_SCHEMA_VERSION,
  SNIPER_POLICY_CONFIG_BANNER,
  type SniperPolicyConfig,
} from "./policy-config.js";
import { validatePaperSniperDecisionReport, buildPaperSniperDecisionReport } from "./paper-decision.js";
import { normalizeSniperCandidateList, type SniperCandidateInput } from "./candidate-list.js";
import { buildSniperTokenPreflightReport, type SniperPreflightCandidateData } from "./token-preflight.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

const listOf = (...cands: SniperCandidateInput[]) => normalizeSniperCandidateList({ sourceLabel: "src", candidates: cands });
const cand = (over: Partial<SniperCandidateInput> & { candidateId: string; mint: string }): SniperCandidateInput => over;
const cleanInspection = (mint: string) => ({ mint, decimals: 6, supplyRaw: "1", uiSupply: 1, mintAuthorityPresent: false, freezeAuthorityPresent: false, isInitialized: true, programLabel: "spl-token" });
const riskPass = (mint: string) => ({ mint, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [], summary: [] });
const riskHigh = (mint: string, id: string) => ({ mint, score: 40, decision: "PASS_FOR_PAPER_EVALUATION", flags: [{ id, severity: "high", title: id }], summary: [] });

const preflightFor = (list: ReturnType<typeof listOf>, data: SniperPreflightCandidateData[]) =>
  buildSniperTokenPreflightReport({ candidateList: list, candidateData: data });

describe("normalizeSniperPolicyConfig — conservative defaults", () => {
  it("fills conservative defaults for an empty policy", () => {
    const p = normalizeSniperPolicyConfig({});
    expect(p.schemaVersion).toBe(SNIPER_POLICY_CONFIG_SCHEMA_VERSION);
    expect(p.requirePreflightPass).toBe(true);
    expect(p.allowPaperEnter).toBe(true);
    expect(p.failClosedOnUnknownPreflight).toBe(true);
    expect(p.failClosedOnMissingRisk).toBe(true);
    expect(p.duplicateMintPolicy).toBe("warn");
    expect(p.maxRiskScore).toBeNull();
    expect(p.denyMints).toEqual([]);
    expect(p.paperSizing).toEqual({ budgetLabel: null, maxPaperPositionUnits: null, maxCandidatesToPaperEnter: null });
    expect(() => validateSniperPolicyConfig(p)).not.toThrow();
  });

  it("reads operator-supplied fields and dedupes/sorts list fields", () => {
    const p = normalizeSniperPolicyConfig({
      policyLabel: "strict-v1",
      operatorLabels: ["b", "a", "a"],
      maxRiskScore: 60,
      minObservedLiquidityUsd: 1000,
      denyMints: [WSOL, WSOL],
      allowPaperEnter: false,
      disallowedRiskFlags: ["z-flag", "a-flag"],
      maxCandidatesPerRun: 50,
      duplicateMintPolicy: "reject",
      paperSizing: { budgetLabel: "small-test", maxPaperPositionUnits: 100, maxCandidatesToPaperEnter: 3 },
    });
    expect(p.policyLabel).toBe("strict-v1");
    expect(p.operatorLabels).toEqual(["a", "b"]);
    expect(p.denyMints).toEqual([WSOL]);
    expect(p.disallowedRiskFlags).toEqual(["a-flag", "z-flag"]);
    expect(p.allowPaperEnter).toBe(false);
    expect(p.duplicateMintPolicy).toBe("reject");
    expect(p.paperSizing.maxCandidatesToPaperEnter).toBe(3);
    expect(p.warnings.some((w) => /paper-enter is disabled/.test(w))).toBe(true);
  });

  it("is idempotent and non-mutating", () => {
    const input = { maxRiskScore: 60, denyMints: [WSOL] };
    const before = JSON.stringify(input);
    const a = normalizeSniperPolicyConfig(input);
    const b = normalizeSniperPolicyConfig(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(input)).toBe(before);
  });

  it("rejects malformed fields", () => {
    expect(() => normalizeSniperPolicyConfig({ maxRiskScore: -1 })).toThrow(/non-negative/);
    expect(() => normalizeSniperPolicyConfig({ duplicateMintPolicy: "nuke" as never })).toThrow(/duplicateMintPolicy/);
    expect(() => normalizeSniperPolicyConfig({ allowPaperEnter: "yes" as never })).toThrow(/must be a boolean/);
    expect(() => normalizeSniperPolicyConfig({ maxCandidatesPerRun: 1.5 })).toThrow(/integer/);
    expect(() => normalizeSniperPolicyConfig({ denyMints: [5 as never] })).toThrow(/array of strings/);
  });
});

describe("deriveSniperDecisionRules", () => {
  it("projects the base-rule fields onto SniperDecisionRules", () => {
    const p = normalizeSniperPolicyConfig({ maxRiskScore: 60, minObservedLiquidityUsd: 500, denyMints: [WSOL], requirePreflightPass: false });
    expect(deriveSniperDecisionRules(p)).toEqual({ requirePreflightPass: false, maxRiskScore: 60, minObservedLiquidityUsd: 500, denyMints: [WSOL] });
  });
});

describe("enforceSniperPolicy — policy affects decisions (tighten-only)", () => {
  /** A clean-pass candidate that the base builder paper-enters. */
  function enterReport(extra: SniperCandidateInput[] = [], data: SniperPreflightCandidateData[] = []) {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }), ...extra);
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) }, ...data]);
    const report = buildPaperSniperDecisionReport({ candidateList: list, preflight: pf });
    return { report, pf };
  }

  it("downgrades paper-enter to watch when allowPaperEnter is false", () => {
    const { report, pf } = enterReport();
    expect(report.decisions[0]!.decision).toBe("paper-enter");
    const policy = normalizeSniperPolicyConfig({ allowPaperEnter: false });
    const out = enforceSniperPolicy(report, policy, { preflight: pf });
    expect(out.decisions[0]!.decision).toBe("watch");
    expect(out.paperEnterCount).toBe(0);
    expect(out.hasPaperEnter).toBe(false);
    expect(out.decisions[0]!.reasons.some((r) => /paper-enter disabled by policy/.test(r))).toBe(true);
    expect(() => validatePaperSniperDecisionReport(out)).not.toThrow();
  });

  it("caps paper-enters at maxCandidatesToPaperEnter (excess watched)", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }), cand({ candidateId: "c2", mint: WSOL }));
    const pf = preflightFor(list, [
      { candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
      { candidateId: "c2", inspection: cleanInspection(WSOL), risk: riskPass(WSOL) },
    ]);
    const report = buildPaperSniperDecisionReport({ candidateList: list, preflight: pf });
    expect(report.paperEnterCount).toBe(2);
    const out = enforceSniperPolicy(report, normalizeSniperPolicyConfig({ paperSizing: { maxCandidatesToPaperEnter: 1 } }), { preflight: pf });
    expect(out.paperEnterCount).toBe(1);
    expect(out.decisions.find((d) => d.candidateId === "c1")!.decision).toBe("paper-enter"); // first kept
    expect(out.decisions.find((d) => d.candidateId === "c2")!.decision).toBe("watch"); // excess watched
  });

  it("fail-closed on unknown preflight rejects a watch driven by no data", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, []); // unknown
    const report = buildPaperSniperDecisionReport({ candidateList: list, preflight: pf });
    expect(report.decisions[0]!.decision).toBe("watch");
    const out = enforceSniperPolicy(report, normalizeSniperPolicyConfig({ failClosedOnUnknownPreflight: true }), { preflight: pf });
    expect(out.decisions[0]!.decision).toBe("paper-reject");
    expect(out.decisions[0]!.reasons.some((r) => /fail-closed/.test(r))).toBe(true);
  });

  it("fail-closed on missing risk downgrades a no-risk paper-enter to watch", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC) }]); // inspection only, no risk → pass
    const report = buildPaperSniperDecisionReport({ candidateList: list, preflight: pf });
    expect(report.decisions[0]!.decision).toBe("paper-enter");
    const out = enforceSniperPolicy(report, normalizeSniperPolicyConfig({ failClosedOnMissingRisk: true }), { preflight: pf });
    expect(out.decisions[0]!.decision).toBe("watch");
    // with the switch off, the paper-enter stands
    const off = enforceSniperPolicy(report, normalizeSniperPolicyConfig({ failClosedOnMissingRisk: false }), { preflight: pf });
    expect(off.decisions[0]!.decision).toBe("paper-enter");
  });

  it("rejects a candidate carrying a disallowed risk flag", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pf = preflightFor(list, [{ candidateId: "c1", inspection: cleanInspection(USDC), risk: riskHigh(USDC, "lp-unlocked") }]);
    const report = buildPaperSniperDecisionReport({ candidateList: list, preflight: pf });
    // a high flag is a preflight WARN → base decision watch
    expect(report.decisions[0]!.decision).toBe("watch");
    const out = enforceSniperPolicy(report, normalizeSniperPolicyConfig({ disallowedRiskFlags: ["lp-unlocked"] }), { preflight: pf });
    expect(out.decisions[0]!.decision).toBe("paper-reject");
    expect(out.decisions[0]!.blockingRiskFlags.map((f) => f.id)).toContain("lp-unlocked");
    expect(out.hasRiskReject).toBe(true);
  });

  it("skips duplicate mints when duplicateMintPolicy is reject; warns otherwise", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }), cand({ candidateId: "c2", mint: USDC }));
    const pf = preflightFor(list, [
      { candidateId: "c1", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
      { candidateId: "c2", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
    ]);
    const report = buildPaperSniperDecisionReport({ candidateList: list, preflight: pf });
    const rejected = enforceSniperPolicy(report, normalizeSniperPolicyConfig({ duplicateMintPolicy: "reject" }), { preflight: pf });
    expect(rejected.decisions.every((d) => d.decision === "skip")).toBe(true);
    const warned = enforceSniperPolicy(report, normalizeSniperPolicyConfig({ duplicateMintPolicy: "warn" }), { preflight: pf });
    expect(warned.warnings.some((w) => /duplicate mint/.test(w))).toBe(true);
    expect(warned.decisions.every((d) => d.decision !== "skip")).toBe(true);
  });

  it("warns when the run exceeds maxCandidatesPerRun (never truncates)", () => {
    const { report, pf } = enterReport([cand({ candidateId: "c2", mint: WSOL })], [{ candidateId: "c2", inspection: cleanInspection(WSOL), risk: riskPass(WSOL) }]);
    const out = enforceSniperPolicy(report, normalizeSniperPolicyConfig({ maxCandidatesPerRun: 1 }), { preflight: pf });
    expect(out.decisions).toHaveLength(2); // not truncated
    expect(out.warnings.some((w) => /maxCandidatesPerRun/.test(w))).toBe(true);
  });

  it("is a no-op (still valid) for a default policy on a non-enter report", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const report = buildPaperSniperDecisionReport({ candidateList: list }); // no preflight → watch
    const out = enforceSniperPolicy(report, normalizeSniperPolicyConfig({}));
    // default failClosedOnUnknownPreflight rejects an unknown-driven watch
    expect(out.decisions[0]!.decision).toBe("paper-reject");
  });

  it("does not mutate its inputs and refuses bad inputs", () => {
    const { report, pf } = enterReport();
    const policy = normalizeSniperPolicyConfig({ allowPaperEnter: false });
    const before = JSON.stringify({ report, policy });
    enforceSniperPolicy(report, policy, { preflight: pf });
    expect(JSON.stringify({ report, policy })).toBe(before);
    expect(() => enforceSniperPolicy({ schemaVersion: "x" }, policy)).toThrow(/decision report is invalid/);
    expect(() => enforceSniperPolicy(report, { schemaVersion: "x" })).toThrow(SniperPolicyConfigError);
    expect(() => enforceSniperPolicy(report, policy, { preflight: { schemaVersion: "x" } })).toThrow(/preflight report is invalid/);
  });
});

describe("validateSniperPolicyConfig", () => {
  const sample = (): SniperPolicyConfig => normalizeSniperPolicyConfig({ policyLabel: "p", maxRiskScore: 50, paperSizing: { maxPaperPositionUnits: 10 } });

  it("accepts a freshly-normalized config (round-trips through JSON)", () => {
    expect(() => validateSniperPolicyConfig(JSON.parse(JSON.stringify(sample())))).not.toThrow();
  });

  it("rejects a wrong schemaVersion, a non-object, and a bad enum", () => {
    expect(() => validateSniperPolicyConfig(null)).toThrow(SniperPolicyConfigError);
    const c = JSON.parse(JSON.stringify(sample())) as { schemaVersion: string };
    c.schemaVersion = "sniper.policy.config.v2";
    expect(() => validateSniperPolicyConfig(c)).toThrow(/schemaVersion/);
    const c2 = JSON.parse(JSON.stringify(sample())) as SniperPolicyConfig;
    (c2 as unknown as { duplicateMintPolicy: string }).duplicateMintPolicy = "nope";
    expect(() => validateSniperPolicyConfig(c2)).toThrow(/duplicateMintPolicy/);
  });

  it("rejects a malformed paperSizing", () => {
    const c = JSON.parse(JSON.stringify(sample())) as SniperPolicyConfig;
    (c.paperSizing as unknown as { maxPaperPositionUnits: number }).maxPaperPositionUnits = -1;
    expect(() => validateSniperPolicyConfig(c)).toThrow(/maxPaperPositionUnits/);
  });
});

describe("formatSniperPolicyConfig", () => {
  it("renders a stable, sectioned PAPER-ONLY policy with no profit/currency claim", () => {
    const text = formatSniperPolicyConfig(normalizeSniperPolicyConfig({ policyLabel: "strict", maxRiskScore: 60 }));
    expect(text).toBe(formatSniperPolicyConfig(normalizeSniperPolicyConfig({ policyLabel: "strict", maxRiskScore: 60 })));
    expect(text).toContain(SNIPER_POLICY_CONFIG_BANNER);
    expect(text).toContain("PAPER ONLY");
    expect(text).toContain("Enforcement (tighten-only):");
    expect(text.toLowerCase()).toContain("not a profitability claim");
    expect(text).toContain("NOT currency or profit");
  });

  it("routes the whole output through the shared redactor", () => {
    const secretish = "a".repeat(64);
    const text = formatSniperPolicyConfig(normalizeSniperPolicyConfig({ policyLabel: secretish }));
    expect(text).toContain(REDACTED);
    expect(text).not.toContain(secretish);
  });
});
