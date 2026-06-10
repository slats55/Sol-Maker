/**
 * Tests for the Sprint 57 SNIPER SESSION PACK V2 (`sniper.session.pack.v2`). All artifacts are built
 * with the REAL builders over INJECTED, offline test data. Coverage tiers are PRESENCE only — these
 * tests never treat a tier as readiness or a trading claim.
 */

import { describe, it, expect } from "vitest";
import {
  buildSniperSessionPackV2,
  validateSniperSessionPackV2,
  formatSniperSessionPackV2,
  SniperSessionPackV2Error,
  SNIPER_SESSION_PACK_V2_SCHEMA_VERSION,
  SNIPER_SESSION_PACK_V2_BANNER,
} from "./session-pack-v2.js";
import { buildSniperSessionPack, validateSniperSessionPack } from "./session-pack.js";
import { buildPaperSniperDecisionReportV2 } from "./paper-decision-v2.js";
import { buildSniperRunReportV2 } from "./run-report-v2.js";
import { buildSniperSafetyGatesReportV2 } from "./safety-gates-v2.js";
import { buildPhase6PrerequisiteReportV2 } from "./phase6-prereqs-v2.js";
import { buildPaperSniperDecisionReport } from "./paper-decision.js";
import { buildSniperRunReport } from "./run-report.js";
import { buildSniperAuditLog } from "./audit-log.js";
import { buildSniperKillSwitchSpec } from "./kill-switch-spec.js";
import { buildSniperSecretsPolicy } from "./secrets-policy.js";
import { buildSniperBurnerIsolationSpec } from "./burner-isolation-spec.js";
import { normalizeSniperPolicyConfigV2 } from "./policy-config-v2.js";
import { normalizeSniperPreflightInput } from "./preflight-input.js";
import { normalizeSniperCandidateList, type SniperCandidateInput } from "./candidate-list.js";
import { buildSniperTokenPreflightReport, type SniperPreflightCandidateData } from "./token-preflight.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const listOf = (...cands: SniperCandidateInput[]) =>
  normalizeSniperCandidateList({ sourceLabel: "test", candidates: cands });
const cand = (over: Partial<SniperCandidateInput> & { candidateId: string; mint: string }): SniperCandidateInput => over;
const cleanInspection = (mint: string) => ({ mint, decimals: 6, supplyRaw: "1", uiSupply: 1, mintAuthorityPresent: false, freezeAuthorityPresent: false, isInitialized: true, programLabel: "spl-token" });
const riskPass = (mint: string) => ({ mint, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [], summary: [] });
const preflightFor = (list: ReturnType<typeof listOf>, data: SniperPreflightCandidateData[]) =>
  buildSniperTokenPreflightReport({ candidateList: list, candidateData: data });

/** Build the FULL v2 artifact set (a clean denylist-skip session, like the prereq tracker tests). */
function fullArtifacts() {
  const list = listOf(cand({ candidateId: "skipme", mint: USDC }));
  const pf = preflightFor(list, [{ candidateId: "skipme", inspection: cleanInspection(USDC), risk: riskPass(USDC) }]);
  const preflightInput = normalizeSniperPreflightInput({
    entries: [{ candidateId: "skipme", mint: USDC, inspection: cleanInspection(USDC), risk: riskPass(USDC) }],
    candidateList: list,
  });
  const policy = normalizeSniperPolicyConfigV2({ policyLabel: "gov", policyMode: "research-only", denyMints: [USDC] });
  const decision = buildPaperSniperDecisionReportV2({ candidateList: list, preflight: pf, policy });
  const runReport = buildSniperRunReportV2({ candidateList: list, preflight: pf, decision, policy, preflightInput });
  const decisionV1 = buildPaperSniperDecisionReport({ candidateList: list, preflight: pf, rules: { denyMints: [USDC] } });
  const runV1 = buildSniperRunReport({ candidateList: list, preflight: pf, decision: decisionV1 });
  const auditLog = buildSniperAuditLog({ runReport: runV1, runLabel: "run" });
  const killSwitchSpec = buildSniperKillSwitchSpec({ operatorLabel: "op", readinessStatus: "adopted" });
  const secretsPolicy = buildSniperSecretsPolicy({ operatorLabel: "op", readinessStatus: "adopted" });
  const burnerIsolationSpec = buildSniperBurnerIsolationSpec({ operatorLabel: "op", readinessStatus: "adopted", killSwitchSpecRef: "ks-op" });
  const sessionPackV1 = buildSniperSessionPack({
    sessionLabel: "s",
    artifacts: [
      { label: "candidates", value: list },
      { label: "decision", value: decisionV1 },
      { label: "audit", value: auditLog },
    ],
  });
  const safetyGates = buildSniperSafetyGatesReportV2({
    candidateList: list, preflight: pf, preflightInput, policy, decision, runReport,
    sessionPack: sessionPackV1, auditLog,
  });
  const phase6Prereq = buildPhase6PrerequisiteReportV2({
    sessionPack: sessionPackV1, policy, safetyGates, decision, runReport, auditLog,
    killSwitchSpec, secretsPolicy, burnerIsolationSpec, operatorLabel: "op",
  });
  return { list, pf, preflightInput, policy, decision, runReport, auditLog, killSwitchSpec, secretsPolicy, burnerIsolationSpec, safetyGates, phase6Prereq };
}

describe("buildSniperSessionPackV2 — the full v2 surface", () => {
  it("classifies all 12 v2-era artifacts, reads spec adoption + readiness verbatim, and hits every coverage tier", () => {
    const a = fullArtifacts();
    const pack = buildSniperSessionPackV2({
      sessionLabel: "full",
      artifacts: [
        { label: "candidates", value: a.list },
        { label: "preflight", value: a.pf },
        { label: "preflight-input", value: a.preflightInput },
        { label: "policy", value: a.policy },
        { label: "decision", value: a.decision },
        { label: "run", value: a.runReport },
        { label: "gates", value: a.safetyGates },
        { label: "prereqs", value: a.phase6Prereq },
        { label: "kill-switch", value: a.killSwitchSpec },
        { label: "secrets", value: a.secretsPolicy },
        { label: "burner", value: a.burnerIsolationSpec },
        { label: "audit", value: a.auditLog },
      ],
    });
    expect(pack.schemaVersion).toBe(SNIPER_SESSION_PACK_V2_SCHEMA_VERSION);
    expect(pack.banner).toBe(SNIPER_SESSION_PACK_V2_BANNER);
    expect(pack.recognizedCount).toBe(12);
    expect(pack.unsupportedCount).toBe(0);
    expect(pack.coverage.isMinimal).toBe(true);
    expect(pack.coverage.isV2DecisionReady).toBe(true);
    expect(pack.coverage.isSpecComplete).toBe(true);
    expect(pack.coverage.isV2Audited).toBe(true);
    expect(pack.coverage.hasPolicyV2).toBe(true);
    expect(pack.coverage.hasSafetyGatesV2).toBe(true);
    expect(pack.coverage.hasPhase6PrereqV2).toBe(true);
    // verbatim flags
    expect(pack.artifacts.find((x) => x.label === "kill-switch")!.adopted).toBe(true);
    expect(pack.artifacts.find((x) => x.label === "gates")!.ready).toBe(true);
    expect(pack.artifacts.find((x) => x.label === "prereqs")!.ready).toBe(true);
    expect(pack.hasNotAdoptedSpec).toBe(false);
    expect(pack.hasPaperEnter).toBe(false);
    expect(() => validateSniperSessionPackV2(pack)).not.toThrow();
  });

  it("surfaces a NOT-adopted spec and an unknown schema honestly; deterministic", () => {
    const a = fullArtifacts();
    const input = {
      artifacts: [
        { label: "candidates", value: a.list },
        { label: "draft-spec", value: buildSniperKillSwitchSpec({}) },
        { label: "mystery", value: { schemaVersion: "totally.unknown.v9" } },
      ],
    };
    const pack = buildSniperSessionPackV2(input);
    expect(pack.artifacts.find((x) => x.label === "draft-spec")!.adopted).toBe(false);
    expect(pack.hasNotAdoptedSpec).toBe(true);
    expect(pack.ciFailReasons.some((r) => /NOT adopted/.test(r))).toBe(true);
    expect(pack.artifacts.find((x) => x.label === "mystery")!.kind).toBe("unsupported");
    expect(pack.hasUnsupported).toBe(true);
    expect(JSON.stringify(buildSniperSessionPackV2(input))).toBe(JSON.stringify(pack));
    expect(() => validateSniperSessionPackV2(pack)).not.toThrow();
  });

  it("REFUSES a corrupt artifact that claims a known v2 schema (never silently trusted)", () => {
    const a = fullArtifacts();
    const corrupt = JSON.parse(JSON.stringify(a.secretsPolicy));
    corrupt.forbidMainWalletUse = false; // weakened — its validator refuses it
    expect(() =>
      buildSniperSessionPackV2({ artifacts: [{ label: "bad", value: corrupt }] }),
    ).toThrow(/claims sniper\.secrets\.policy\.v1 but is invalid/);
  });

  it("refuses duplicate labels and an empty artifact list", () => {
    const a = fullArtifacts();
    expect(() =>
      buildSniperSessionPackV2({ artifacts: [{ label: "x", value: a.list }, { label: "x", value: a.pf }] }),
    ).toThrow(/duplicate artifact label/);
    expect(() => buildSniperSessionPackV2({ artifacts: [] })).toThrow(SniperSessionPackV2Error);
  });
});

describe("v1 compatibility — the v1 session pack is unchanged", () => {
  it("v1 build + validate still work; a v2-only artifact stays unsupported in a v1 pack (honest)", () => {
    const a = fullArtifacts();
    const v1 = buildSniperSessionPack({
      artifacts: [
        { label: "candidates", value: a.list },
        { label: "kill-switch", value: a.killSwitchSpec },
      ],
    });
    expect(() => validateSniperSessionPack(v1)).not.toThrow();
    expect(v1.artifacts.find((x) => x.label === "kill-switch")!.kind).toBe("unsupported");
    expect("hasNotAdoptedSpec" in v1).toBe(false);
  });
});

describe("validateSniperSessionPackV2 — strict backstop", () => {
  const valid = () => {
    const a = fullArtifacts();
    return buildSniperSessionPackV2({ artifacts: [{ label: "specs", value: a.killSwitchSpec }] });
  };

  it("rejects wrong schema/banner, an unknown kind, and a forged hasNotAdoptedSpec", () => {
    const a = JSON.parse(JSON.stringify(valid()));
    a.schemaVersion = "sniper.session.pack.v1";
    expect(() => validateSniperSessionPackV2(a)).toThrow(/schemaVersion/);

    const b = JSON.parse(JSON.stringify(valid()));
    b.artifacts[0].kind = "wallet";
    expect(() => validateSniperSessionPackV2(b)).toThrow(/known artifact kind/);

    const c = JSON.parse(JSON.stringify(valid()));
    c.hasNotAdoptedSpec = true; // but the packed spec is adopted
    expect(() => validateSniperSessionPackV2(c)).toThrow(/mirror the entries/);
  });
});

describe("formatSniperSessionPackV2 — deterministic operator output", () => {
  it("shows the inventory with adoption/readiness flags and the presence-only coverage tiers", () => {
    const a = fullArtifacts();
    const pack = buildSniperSessionPackV2({
      sessionLabel: "fmt",
      artifacts: [
        { label: "candidates", value: a.list },
        { label: "gates", value: a.safetyGates },
        { label: "kill-switch", value: a.killSwitchSpec },
      ],
    });
    const text = formatSniperSessionPackV2(pack, { label: "t" });
    expect(text).toContain(SNIPER_SESSION_PACK_V2_BANNER);
    expect(text).toContain("- kill-switch  [kill-switch-spec]");
    expect(text).toContain("adopted=YES");
    expect(text).toContain("ready=YES");
    expect(text).toContain("Coverage (PRESENCE only — never completeness or readiness):");
    expect(text).toContain("- spec-complete (3 specs present): no");
    expect(formatSniperSessionPackV2(pack, { label: "t" })).toBe(text);
  });
});
