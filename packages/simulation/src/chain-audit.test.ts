/**
 * Sprint 67 (+87) — `phase6.audit.report.v1`: the chain audit over the ten v2/simulation
 * artifacts (Sprint 87 added the route-resolution artifact as an audited role).
 *
 * Proves: a complete chain audits clean; missing artifacts are WARNINGS (incomplete, not failed);
 * invalid artifacts, v1 stand-ins, and structured cross-reference mismatches are BLOCKING (a
 * route built from a different plan is a mismatch); the chain's own conditions (not-ready,
 * not-adopted, blocked plan/result/route) are surfaced verbatim and never waived; the report is
 * deterministic, lock-validated, and authorizes nothing.
 */

import { describe, it, expect } from "vitest";
import {
  buildSimulationIntentPlanV2,
  buildSimulationResultV1,
  buildSimulationRouteResolutionV1,
  buildPhase6AuditReportV1,
  validatePhase6AuditReportV1,
  formatPhase6AuditReportV1,
  Phase6AuditReportV1Error,
  SimulationSafetyError,
  type BuildPhase6AuditReportV1Input,
  type Phase6AuditReportV1,
  type SimulationIntentPlanV2,
  type SimulationResultV1,
  type SimulationRouteResolutionV1,
} from "./index.js";
import { buildFictionalReadyChain, buildFictionalWatchOnlyChain, type FictionalSimulationChain } from "./fixtures.js";
import { buildSniperKillSwitchSpec } from "@soulmaker/sniper";

interface FullChain {
  chain: FictionalSimulationChain;
  plan: SimulationIntentPlanV2;
  result: SimulationResultV1;
  route: SimulationRouteResolutionV1;
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
  const route = buildSimulationRouteResolutionV1({ intentPlan: plan });
  return { chain, plan, result, route };
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
  const route = buildSimulationRouteResolutionV1({ intentPlan: plan });
  return { chain, plan, result, route };
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
    routeResolution: full.route,
    operatorLabel: "fictional-operator",
  };
}

describe("phase6 chain audit — complete chains", () => {
  it("the watch-only chain audits clean with ZERO chain conditions", () => {
    const report = buildPhase6AuditReportV1(auditInput(watchOnlyFull()));
    expect(report.auditPassed).toBe(true);
    expect(report.chainComplete).toBe(true);
    expect(report.validCount).toBe(10);
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

describe("phase6 chain audit — Sprint 77 tally-corruption detection", () => {
  it("a decision with a corrupted paperEnterCount FAILS the audit as invalid (hardened validator)", () => {
    const input = auditInput(readyFull());
    const tampered = JSON.parse(JSON.stringify(input.decision)) as Record<string, unknown>;
    tampered.paperEnterCount = 0; // hide the paper-enters from the chain
    input.decision = tampered;
    const report = buildPhase6AuditReportV1(input);
    expect(report.auditPassed).toBe(false);
    expect(report.findings.map((f) => f.code)).toContain("audit-artifact-invalid");
    const state = report.artifacts.find((a) => a.role === "decision")!;
    expect(state.valid).toBe(false);
    expect(state.error).toMatch(/paperEnterCount must equal the recomputed tally/);
  });

  it("the intent plan builder BLOCKS over the same corruption (invalid decision v2)", () => {
    const full = readyFull();
    const tampered = JSON.parse(JSON.stringify(full.chain.decision)) as Record<string, unknown>;
    tampered.paperEnterCount = 0;
    const plan = buildSimulationIntentPlanV2({
      decision: tampered,
      safetyGates: full.chain.gates,
      prereqs: full.chain.prereqs,
      killSwitchSpec: full.chain.killSwitchSpec,
      secretsPolicy: full.chain.secretsPolicy,
      burnerIsolationSpec: full.chain.burnerIsolationSpec,
    });
    expect(plan.blocked).toBe(true);
    expect(plan.blockingReasonCodes).toContain("simulation-blocked-invalid-decision-v2");
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

  it("an EMPTY audit reports all ten artifacts missing and still passes (honest incompleteness)", () => {
    const report = buildPhase6AuditReportV1({});
    expect(report.missingCount).toBe(10);
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

describe("phase6 chain audit — Sprint 87 route-resolution role", () => {
  it("a route built from THIS chain's plan audits clean (10/10, role present and valid)", () => {
    const report = buildPhase6AuditReportV1(auditInput(readyFull()));
    expect(report.auditPassed).toBe(true);
    expect(report.chainComplete).toBe(true);
    expect(report.validCount).toBe(10);
    const state = report.artifacts.find((a) => a.role === "route-resolution")!;
    expect(state.present).toBe(true);
    expect(state.valid).toBe(true);
    expect(state.expectedSchemaVersion).toBe("simulation.route.resolution.v1");
    expect(() => validatePhase6AuditReportV1(report)).not.toThrow();
  });

  it("a missing route is a WARNING (incomplete chain, audit still passes)", () => {
    const input = auditInput(readyFull());
    delete input.routeResolution;
    const report = buildPhase6AuditReportV1(input);
    expect(report.auditPassed).toBe(true);
    expect(report.chainComplete).toBe(false);
    expect(report.findings.some((f) => f.code === "audit-artifact-missing" && f.roles.includes("route-resolution"))).toBe(true);
  });

  it("a route with a flipped literal lock is BLOCKING (classified invalid via the S85 validator)", () => {
    const input = auditInput(readyFull());
    input.routeResolution = { ...(input.routeResolution as Record<string, unknown>), neverSends: false };
    const report = buildPhase6AuditReportV1(input);
    expect(report.auditPassed).toBe(false);
    expect(report.findings.some((f) => f.code === "audit-artifact-invalid" && f.roles.includes("route-resolution"))).toBe(true);
  });

  it("a route with a flipped phase7LiveTradingReady is BLOCKING (classified invalid)", () => {
    const input = auditInput(readyFull());
    input.routeResolution = { ...(input.routeResolution as Record<string, unknown>), phase7LiveTradingReady: true };
    const report = buildPhase6AuditReportV1(input);
    expect(report.auditPassed).toBe(false);
    const state = report.artifacts.find((a) => a.role === "route-resolution")!;
    expect(state.valid).toBe(false);
    expect(state.error).toMatch(/phase7LiveTradingReady/);
  });

  it("a route under a wrong schemaVersion is BLOCKING (classified invalid)", () => {
    const input = auditInput(readyFull());
    input.routeResolution = { ...(input.routeResolution as Record<string, unknown>), schemaVersion: "simulation.route.resolution.v2" };
    const report = buildPhase6AuditReportV1(input);
    expect(report.auditPassed).toBe(false);
    const state = report.artifacts.find((a) => a.role === "route-resolution")!;
    expect(state.valid).toBe(false);
    expect(state.suppliedSchemaVersion).toBe("simulation.route.resolution.v2");
  });

  it("a route claiming 'resolved' without facts is BLOCKING (the S85 validator refuses the claim)", () => {
    const full = readyFull();
    const tampered = JSON.parse(JSON.stringify(full.route)) as SimulationRouteResolutionV1;
    (tampered.entries[0] as { routeResolutionStatus: string }).routeResolutionStatus = "resolved";
    const report = buildPhase6AuditReportV1({ ...auditInput(full), routeResolution: tampered });
    expect(report.auditPassed).toBe(false);
    const state = report.artifacts.find((a) => a.role === "route-resolution")!;
    expect(state.valid).toBe(false);
  });

  it("a route built from a DIFFERENT plan is a BLOCKING source-ref mismatch (entryCount disagrees)", () => {
    const ready = readyFull();
    const watch = watchOnlyFull();
    // The ready plan carries 2 preview entries; the watch-only route was built from a 0-entry plan.
    const report = buildPhase6AuditReportV1({ ...auditInput(ready), routeResolution: watch.route });
    expect(report.auditPassed).toBe(false);
    expect(
      report.findings.some(
        (f) =>
          f.code === "audit-source-ref-mismatch" &&
          f.roles.includes("route-resolution") &&
          f.detail.includes("entryCount"),
      ),
    ).toBe(true);
  });

  it("a route whose plan-ref label disagrees with the supplied plan is a BLOCKING mismatch", () => {
    const full = readyFull();
    const otherPlan = buildSimulationIntentPlanV2({
      decision: full.chain.decision,
      safetyGates: full.chain.gates,
      prereqs: full.chain.prereqs,
      killSwitchSpec: full.chain.killSwitchSpec,
      secretsPolicy: full.chain.secretsPolicy,
      burnerIsolationSpec: full.chain.burnerIsolationSpec,
      operatorAcknowledgedPaperEnterReview: true,
      operatorLabel: "fictional-operator",
      planLabel: "a-different-plan",
    });
    const report = buildPhase6AuditReportV1({ ...auditInput(full), routeResolution: buildSimulationRouteResolutionV1({ intentPlan: otherPlan }) });
    expect(report.auditPassed).toBe(false);
    expect(
      report.findings.some(
        (f) => f.code === "audit-source-ref-mismatch" && f.roles.includes("route-resolution") && f.detail.includes("planLabel"),
      ),
    ).toBe(true);
  });

  it("a BLOCKED route built with NO plan, audited beside a valid plan, is a BLOCKING mismatch", () => {
    const full = readyFull();
    const blockedRoute = buildSimulationRouteResolutionV1({});
    expect(blockedRoute.blocked).toBe(true);
    const report = buildPhase6AuditReportV1({ ...auditInput(full), routeResolution: blockedRoute });
    expect(report.auditPassed).toBe(false);
    expect(
      report.findings.some((f) => f.code === "audit-source-ref-mismatch" && f.roles.includes("route-resolution")),
    ).toBe(true);
  });

  it("a blocked route's blocking codes are surfaced VERBATIM as chain conditions", () => {
    const blockedRoute = buildSimulationRouteResolutionV1({});
    const report = buildPhase6AuditReportV1({ routeResolution: blockedRoute });
    expect(report.chainConditionCodes).toContain("simulation-route-resolution-missing-plan");
  });

  it("the honest all-UNAVAILABLE route adds NO chain condition (unavailable is not blocking)", () => {
    const report = buildPhase6AuditReportV1(auditInput(watchOnlyFull()));
    expect(report.chainConditionCodes).toEqual([]);
  });

  it("a stale pre-S87 nine-role audit artifact re-validates as INVALID (intended fail-closed bump)", () => {
    const report = JSON.parse(JSON.stringify(buildPhase6AuditReportV1(auditInput(readyFull())))) as Phase6AuditReportV1;
    const stale = {
      ...report,
      artifacts: report.artifacts.filter((a) => a.role !== "route-resolution"),
    };
    expect(stale.artifacts).toHaveLength(9); // exactly the pre-S87 shape
    expect(() => validatePhase6AuditReportV1(stale)).toThrow(/must list all 10 chain roles/);
  });

  it("the formatter shows the route role's state (present and valid on a full chain)", () => {
    const text = formatPhase6AuditReportV1(buildPhase6AuditReportV1(auditInput(readyFull())));
    expect(text).toContain("- route-resolution: present, valid");
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
