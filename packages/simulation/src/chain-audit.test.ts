/**
 * Sprint 67 — `phase6.audit.report.v1`: the chain audit over the nine v2/simulation artifacts.
 *
 * Proves: a complete chain audits clean; missing artifacts are WARNINGS (incomplete, not failed);
 * invalid artifacts, v1 stand-ins, and structured cross-reference mismatches are BLOCKING; the
 * chain's own conditions (not-ready, not-adopted, blocked plan/result) are surfaced verbatim and
 * never waived; the report is deterministic, lock-validated, and authorizes nothing.
 */

import { describe, it, expect } from "vitest";
import {
  buildSimulationIntentPlanV2,
  buildSimulationResultV1,
  buildPhase6AuditReportV1,
  validatePhase6AuditReportV1,
  formatPhase6AuditReportV1,
  Phase6AuditReportV1Error,
  SimulationSafetyError,
  type BuildPhase6AuditReportV1Input,
  type Phase6AuditReportV1,
  type SimulationIntentPlanV2,
  type SimulationResultV1,
} from "./index.js";
import { buildFictionalReadyChain, buildFictionalWatchOnlyChain, type FictionalSimulationChain } from "./fixtures.js";
import { buildSniperKillSwitchSpec } from "@soulmaker/sniper";

interface FullChain {
  chain: FictionalSimulationChain;
  plan: SimulationIntentPlanV2;
  result: SimulationResultV1;
}

function readyFull(): FullChain {
  const chain = buildFictionalReadyChain();
  const plan = buildSimulationIntentPlanV2({
    decision: chain.decision,
    safetyGates: chain.gates,
    prereqs: chain.prereqs,
    killSwitchSpec: chain.killSwitchSpec,
    secretsPolicy: chain.secretsPolicy,
    burnerIsolationSpec: chain.burnerIsolationSpec,
    operatorAcknowledgedPaperEnterReview: true,
    operatorLabel: "fictional-operator",
    planLabel: "fictional-plan",
  });
  const result = buildSimulationResultV1({ plan });
  return { chain, plan, result };
}

function watchOnlyFull(): FullChain {
  const chain = buildFictionalWatchOnlyChain();
  const plan = buildSimulationIntentPlanV2({
    decision: chain.decision,
    safetyGates: chain.gates,
    prereqs: chain.prereqs,
    killSwitchSpec: chain.killSwitchSpec,
    secretsPolicy: chain.secretsPolicy,
    burnerIsolationSpec: chain.burnerIsolationSpec,
    operatorLabel: "fictional-operator",
    planLabel: "fictional-plan",
  });
  const result = buildSimulationResultV1({ plan });
  return { chain, plan, result };
}

function auditInput(full: FullChain): BuildPhase6AuditReportV1Input {
  return {
    decision: full.chain.decision,
    runReport: full.chain.runReport,
    safetyGates: full.chain.gates,
    prereqs: full.chain.prereqs,
    killSwitchSpec: full.chain.killSwitchSpec,
    secretsPolicy: full.chain.secretsPolicy,
    burnerIsolationSpec: full.chain.burnerIsolationSpec,
    intentPlan: full.plan,
    simulationResult: full.result,
    operatorLabel: "fictional-operator",
  };
}

describe("phase6 chain audit — complete chains", () => {
  it("the watch-only chain audits clean with ZERO chain conditions", () => {
    const report = buildPhase6AuditReportV1(auditInput(watchOnlyFull()));
    expect(report.auditPassed).toBe(true);
    expect(report.chainComplete).toBe(true);
    expect(report.validCount).toBe(9);
    expect(report.findings.map((f) => f.code)).toEqual(["audit-chain-complete"]);
    expect(report.chainConditionCodes).toEqual([]);
    expect(() => validatePhase6AuditReportV1(report)).not.toThrow();
  });

  it("the ready chain audits clean but SURFACES its own prereq condition (never waived)", () => {
    const report = buildPhase6AuditReportV1(auditInput(readyFull()));
    expect(report.auditPassed).toBe(true);
    expect(report.chainComplete).toBe(true);
    // The run report marks paper-enters as needing review → prereqs not fully met — the audit
    // reports that verbatim even though the plan itself was unblocked via the acknowledgment.
    expect(report.chainConditionCodes).toContain("simulation-blocked-prereqs-not-ready");
  });

  it("is deterministic: two audits are JSON-identical", () => {
    const a = buildPhase6AuditReportV1(auditInput(watchOnlyFull()));
    const b = buildPhase6AuditReportV1(auditInput(watchOnlyFull()));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe("phase6 chain audit — findings", () => {
  it("a missing artifact is a WARNING (incomplete chain, audit still passes)", () => {
    const input = auditInput(watchOnlyFull());
    delete input.simulationResult;
    const report = buildPhase6AuditReportV1(input);
    expect(report.auditPassed).toBe(true);
    expect(report.chainComplete).toBe(false);
    expect(report.missingCount).toBe(1);
    expect(report.findings.some((f) => f.code === "audit-artifact-missing" && f.roles.includes("simulation-result"))).toBe(true);
  });

  it("an EMPTY audit reports all nine artifacts missing and still passes (honest incompleteness)", () => {
    const report = buildPhase6AuditReportV1({});
    expect(report.missingCount).toBe(9);
    expect(report.auditPassed).toBe(true);
    expect(report.chainComplete).toBe(false);
    expect(() => validatePhase6AuditReportV1(report)).not.toThrow();
  });

  it("an invalid artifact is BLOCKING (audit fails)", () => {
    const input = auditInput(watchOnlyFull());
    input.killSwitchSpec = { ...(input.killSwitchSpec as Record<string, unknown>), performsNoProcessControl: false };
    const report = buildPhase6AuditReportV1(input);
    expect(report.auditPassed).toBe(false);
    expect(report.invalidCount).toBe(1);
    expect(report.findings.some((f) => f.code === "audit-artifact-invalid" && f.roles.includes("kill-switch-spec"))).toBe(true);
  });

  it("a v1 decision stand-in is BLOCKING with the v1 code", () => {
    const input = auditInput(watchOnlyFull());
    input.decision = { ...(input.decision as Record<string, unknown>), schemaVersion: "sniper.paper.decision.report.v1" };
    const report = buildPhase6AuditReportV1(input);
    expect(report.auditPassed).toBe(false);
    expect(report.findings.some((f) => f.code === "audit-v1-artifact" && f.roles.includes("decision"))).toBe(true);
  });

  it("a plan built from a DIFFERENT decision is a BLOCKING source-ref mismatch", () => {
    const ready = readyFull();
    const watch = watchOnlyFull();
    // The plan came from the ready chain (2 paper-enters); the audited decision is the
    // watch-only chain's (0 paper-enters) — structurally different chains.
    const report = buildPhase6AuditReportV1({ ...auditInput(ready), decision: watch.chain.decision });
    expect(report.auditPassed).toBe(false);
    expect(report.findings.some((f) => f.code === "audit-source-ref-mismatch" && f.roles.includes("intent-plan"))).toBe(true);
  });

  it("a result whose plan-ref disagrees with the supplied plan is a BLOCKING mismatch", () => {
    const full = watchOnlyFull();
    const tamperedResult = JSON.parse(JSON.stringify(full.result)) as SimulationResultV1;
    (tamperedResult.sourcePlanRef as { planLabel: string | null }).planLabel = "a-different-plan";
    const report = buildPhase6AuditReportV1({ ...auditInput(full), simulationResult: tamperedResult });
    expect(report.auditPassed).toBe(false);
    expect(
      report.findings.some((f) => f.code === "audit-source-ref-mismatch" && f.roles.includes("simulation-result")),
    ).toBe(true);
  });
});

describe("phase6 chain audit — surfaced chain conditions", () => {
  it("a non-adopted spec is surfaced as a chain condition (audit itself still passes)", () => {
    const input = auditInput(watchOnlyFull());
    input.killSwitchSpec = buildSniperKillSwitchSpec({
      operatorLabel: "fictional-operator",
      requiredOperatorConfirmations: ["fictional: confirm the session label"],
      readinessStatus: "draft",
    });
    const report = buildPhase6AuditReportV1(input);
    expect(report.auditPassed).toBe(true);
    expect(report.chainConditionCodes).toContain("simulation-blocked-kill-switch-not-adopted");
  });

  it("a BLOCKED plan and its blocked result are surfaced verbatim", () => {
    const blockedPlan = buildSimulationIntentPlanV2({ stopSimulationTripped: true });
    const blockedResult = buildSimulationResultV1({ plan: blockedPlan });
    const report = buildPhase6AuditReportV1({ intentPlan: blockedPlan, simulationResult: blockedResult });
    expect(report.chainConditionCodes).toContain("simulation-blocked-kill-switch-stop");
    expect(report.chainConditionCodes).toContain("simulation-dry-run-skipped-blocked-plan");
  });

  it("throws ONLY on a malformed input shape", () => {
    expect(() => buildPhase6AuditReportV1({ operatorLabel: 42 as never })).toThrow(Phase6AuditReportV1Error);
    expect(() => buildPhase6AuditReportV1(null as never)).toThrow(Phase6AuditReportV1Error);
  });
});

describe("phase6 chain audit — validator backstop", () => {
  const valid = (): Phase6AuditReportV1 =>
    JSON.parse(JSON.stringify(buildPhase6AuditReportV1(auditInput(watchOnlyFull())))) as Phase6AuditReportV1;

  it.each([["neverAuthorizesLiveTrading"], ["neverSigns"], ["neverSends"], ["dryRunOnly"]])(
    "refuses a report whose %s literal lock is flipped",
    (key) => {
      expect(() => validatePhase6AuditReportV1({ ...valid(), [key]: false })).toThrow(SimulationSafetyError);
    },
  );

  it("refuses a tampered verdict, tally, or role order", () => {
    const a = valid();
    (a as { auditPassed: boolean }).auditPassed = false;
    expect(() => validatePhase6AuditReportV1(a)).toThrow(/auditPassed/);
    const b = valid();
    (b as { validCount: number }).validCount = 3;
    expect(() => validatePhase6AuditReportV1(b)).toThrow(/recomputed tally/);
    const c = valid();
    c.artifacts.reverse();
    expect(() => validatePhase6AuditReportV1(c)).toThrow(/role order/);
  });

  it("refuses a chainComplete claim that the artifact states contradict", () => {
    const r = valid();
    r.artifacts[0] = { ...r.artifacts[0]!, present: false, valid: null, suppliedSchemaVersion: null, label: null };
    expect(() => validatePhase6AuditReportV1(r)).toThrow(/chainComplete|recomputed/);
  });
});

describe("phase6 chain audit — formatter", () => {
  it("never authorizes; shows verdict, artifacts, findings, conditions, next safe action", () => {
    const text = formatPhase6AuditReportV1(buildPhase6AuditReportV1(auditInput(readyFull())), { label: "audit-case" });
    expect(text).toContain("PHASE 6 CHAIN AUDIT");
    expect(text).toContain("never authorizes anything");
    expect(text).toContain("audit:    PASSED");
    expect(text).toContain("chain: COMPLETE");
    expect(text).toContain("Chain conditions");
    expect(text).toContain("Next safe action:");
    const lower = text.toLowerCase();
    expect(lower).not.toContain("ready for live");
    expect(lower).not.toContain("live trading ready");
  });

  it("a failed audit leads with FAILED and the blocking finding", () => {
    const input = auditInput(watchOnlyFull());
    input.decision = { ...(input.decision as Record<string, unknown>), schemaVersion: "sniper.paper.decision.report.v1" };
    const text = formatPhase6AuditReportV1(buildPhase6AuditReportV1(input));
    expect(text).toContain("audit:    FAILED");
    expect(text).toContain("audit-v1-artifact");
  });
});
