/**
 * Sprint 75 — `phase6.simulation.handoff.pack.v1` (the simulation-aware session handoff).
 *
 * Proves: a complete FICTIONAL chain hands off cleanly with verbatim summaries, a missing/invalid
 * artifact is CLASSIFIED (never invented), the chain's blocking conditions and the readiness
 * verdict are carried verbatim, the literal locks (including the always-false
 * `phase7LiveTradingReady`) cannot flip, the next safe action is deterministic and recomputed by
 * the validator, the formatter carries the required safety language and no live-authorization
 * phrasing, and the output is byte-deterministic.
 */

import { describe, it, expect } from "vitest";
import {
  buildSimulationIntentPlanV2,
  buildSimulationResultV1,
  buildPhase6AuditReportV1,
  buildPhase6SimulationReadinessReportV1,
  buildPhase6SimulationHandoffPackV1,
  validatePhase6SimulationHandoffPackV1,
  formatPhase6SimulationHandoffPackV1,
  Phase6SimulationHandoffPackV1Error,
  PHASE6_HANDOFF_ROLES,
  type BuildPhase6SimulationHandoffPackV1Input,
} from "./index.js";
import { buildFictionalReadyChain, type FictionalSimulationChain } from "./fixtures.js";

/** Build the full FICTIONAL 11-artifact input (chain + plan + result + audit + readiness). */
function fullInput(chain: FictionalSimulationChain = buildFictionalReadyChain()): BuildPhase6SimulationHandoffPackV1Input {
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
  const audit = buildPhase6AuditReportV1({
    decision: chain.decision,
    runReport: chain.runReport,
    safetyGates: chain.gates,
    prereqs: chain.prereqs,
    killSwitchSpec: chain.killSwitchSpec,
    secretsPolicy: chain.secretsPolicy,
    burnerIsolationSpec: chain.burnerIsolationSpec,
    intentPlan: plan,
    simulationResult: result,
    operatorLabel: "fictional-operator",
  });
  const readiness = buildPhase6SimulationReadinessReportV1({
    auditReport: audit,
    intentPlan: plan,
    simulationResult: result,
    evidence: {
      "package-boundary-tests": "packages/simulation/src/no-forbidden-imports.test.ts",
      "cli-commands": "apps/cli/src/simulation-commands.test.ts",
      "e2e-fixtures": "apps/cli/src/simulation-e2e.test.ts",
      "source-scans": "packages/simulation/src/package-boundary.test.ts",
      docs: "docs/SNIPER_RUNBOOK.md",
    },
    operatorLabel: "fictional-operator",
  });
  return {
    decision: chain.decision,
    runReport: chain.runReport,
    safetyGates: chain.gates,
    prereqs: chain.prereqs,
    killSwitchSpec: chain.killSwitchSpec,
    secretsPolicy: chain.secretsPolicy,
    burnerIsolationSpec: chain.burnerIsolationSpec,
    intentPlan: plan,
    simulationResult: result,
    auditReport: audit,
    readinessReport: readiness,
    operatorLabel: "fictional-operator",
    packLabel: "fictional-handoff",
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("buildPhase6SimulationHandoffPackV1 — complete chain", () => {
  it("hands off a complete chain with verbatim summaries and the green readiness verdict", () => {
    const pack = buildPhase6SimulationHandoffPackV1(fullInput());
    expect(pack.complete).toBe(true);
    expect(pack.validCount).toBe(11);
    expect(pack.missingRoles).toEqual([]);
    expect(pack.invalidRoles).toEqual([]);
    expect(pack.artifacts.map((a) => a.role)).toEqual([...PHASE6_HANDOFF_ROLES]);
    // Verbatim summaries from the fictional chain.
    const decision = pack.artifacts.find((a) => a.role === "decision")!;
    expect(decision.summary!.paperEnterCount).toBe(2);
    const planState = pack.artifacts.find((a) => a.role === "intent-plan")!;
    expect(planState.summary!.blocked).toBe(false);
    const readiness = pack.artifacts.find((a) => a.role === "readiness-report")!;
    expect(readiness.summary!.phase6SimulationReady).toBe(true);
    expect(pack.simulationReadyPerReadiness).toBe(true);
    // The fictional chain's own conditions (prereqs awaiting paper-enter review) carry verbatim.
    expect(pack.chainBlockingCodes.length).toBeGreaterThan(0);
    expect(pack.hasBlockingConditions).toBe(true);
    // Paper-enters always demand operator review — carried verbatim from the run report.
    expect(pack.operatorBlockingReasons.length).toBeGreaterThan(0);
    expect(pack.nextSafeAction).toContain("Resolve the chain's blocking conditions");
  });

  it("carries the literal locks and the always-false phase7LiveTradingReady", () => {
    const pack = buildPhase6SimulationHandoffPackV1(fullInput());
    expect(pack.neverAuthorizesLiveTrading).toBe(true);
    expect(pack.neverSigns).toBe(true);
    expect(pack.neverSends).toBe(true);
    expect(pack.dryRunOnly).toBe(true);
    expect(pack.phase7LiveTradingReady).toBe(false);
  });
});

describe("buildPhase6SimulationHandoffPackV1 — classification, never invention", () => {
  it("classifies a missing simulation result (and stays a valid, honest pack)", () => {
    const input = fullInput();
    delete (input as Record<string, unknown>).simulationResult;
    const pack = buildPhase6SimulationHandoffPackV1(input);
    expect(pack.complete).toBe(false);
    expect(pack.missingRoles).toEqual(["simulation-result"]);
    const state = pack.artifacts.find((a) => a.role === "simulation-result")!;
    expect(state.present).toBe(false);
    expect(state.valid).toBeNull();
    expect(state.summary).toBeNull();
    expect(pack.nextSafeAction).toContain("Supply or rebuild the missing/invalid artifacts");
  });

  it("classifies an invalid audit with its redacted error", () => {
    const input = fullInput();
    const tampered = clone(input.auditReport) as Record<string, unknown>;
    tampered.auditPassed = "yes"; // wrong type → strict validator refuses
    input.auditReport = tampered;
    const pack = buildPhase6SimulationHandoffPackV1(input);
    expect(pack.invalidRoles).toEqual(["audit-report"]);
    const state = pack.artifacts.find((a) => a.role === "audit-report")!;
    expect(state.valid).toBe(false);
    expect(state.error).toBeTruthy();
    expect(state.summary).toBeNull();
  });

  it("a blocked plan's blocking codes are carried verbatim", () => {
    const input = fullInput();
    const chain = buildFictionalReadyChain();
    const blockedPlan = buildSimulationIntentPlanV2({
      safetyGates: chain.gates,
      prereqs: chain.prereqs,
      killSwitchSpec: chain.killSwitchSpec,
      secretsPolicy: chain.secretsPolicy,
      burnerIsolationSpec: chain.burnerIsolationSpec,
    });
    input.intentPlan = blockedPlan;
    const pack = buildPhase6SimulationHandoffPackV1(input);
    expect(pack.chainBlockingCodes).toContain("simulation-blocked-missing-decision-v2");
    expect(pack.hasBlockingConditions).toBe(true);
  });

  it("a missing readiness report yields a NULL verdict (never guessed) and a not-ready action", () => {
    const input = fullInput();
    delete (input as Record<string, unknown>).readinessReport;
    const pack = buildPhase6SimulationHandoffPackV1(input);
    expect(pack.simulationReadyPerReadiness).toBeNull();
    expect(pack.missingRoles).toEqual(["readiness-report"]);
  });

  it("an empty input produces an all-missing, honest pack (no throw)", () => {
    const pack = buildPhase6SimulationHandoffPackV1({});
    expect(pack.complete).toBe(false);
    expect(pack.missingCount).toBe(11);
    expect(pack.chainBlockingCodes).toEqual([]);
    expect(pack.simulationReadyPerReadiness).toBeNull();
  });
});

describe("validatePhase6SimulationHandoffPackV1 — backstop", () => {
  it("round-trips a built pack (including via JSON)", () => {
    const pack = buildPhase6SimulationHandoffPackV1(fullInput());
    expect(validatePhase6SimulationHandoffPackV1(clone(pack))).toEqual(pack);
  });

  it("refuses a flipped safety lock and a flipped phase7LiveTradingReady", () => {
    const fresh = () => clone(buildPhase6SimulationHandoffPackV1(fullInput())) as unknown as Record<string, unknown>;
    const p1 = fresh();
    p1.neverSends = false;
    expect(() => validatePhase6SimulationHandoffPackV1(p1)).toThrow(/neverSends/);
    const p2 = fresh();
    p2.phase7LiveTradingReady = true;
    expect(() => validatePhase6SimulationHandoffPackV1(p2)).toThrow(/phase7LiveTradingReady/);
  });

  it("refuses tampered verdicts, role lists, readiness mirror, and next safe action", () => {
    const fresh = () => clone(buildPhase6SimulationHandoffPackV1(fullInput()));

    const p1 = fresh();
    (p1 as { complete: boolean }).complete = false;
    expect(() => validatePhase6SimulationHandoffPackV1(p1)).toThrow(/complete/);

    const p2 = fresh();
    (p2 as { missingRoles: string[] }).missingRoles = ["decision"];
    expect(() => validatePhase6SimulationHandoffPackV1(p2)).toThrow(/missingRoles/);

    const p3 = fresh();
    (p3 as { simulationReadyPerReadiness: boolean | null }).simulationReadyPerReadiness = false;
    expect(() => validatePhase6SimulationHandoffPackV1(p3)).toThrow(/simulationReadyPerReadiness/);

    const p4 = fresh();
    (p4 as { nextSafeAction: string }).nextSafeAction = "ship it live";
    expect(() => validatePhase6SimulationHandoffPackV1(p4)).toThrow(/nextSafeAction/);

    const p5 = fresh();
    (p5 as { hasBlockingConditions: boolean }).hasBlockingConditions = false;
    expect(() => validatePhase6SimulationHandoffPackV1(p5)).toThrow(/hasBlockingConditions/);
  });

  it("refuses a summary on an invalid/missing artifact (state is never invented)", () => {
    const pack = clone(buildPhase6SimulationHandoffPackV1(fullInput()));
    const input = fullInput();
    delete (input as Record<string, unknown>).simulationResult;
    const withMissing = clone(buildPhase6SimulationHandoffPackV1(input));
    const state = withMissing.artifacts.find((a) => a.role === "simulation-result")!;
    state.summary = pack.artifacts.find((a) => a.role === "simulation-result")!.summary;
    expect(() => validatePhase6SimulationHandoffPackV1(withMissing)).toThrow(/summary/);
  });
});

describe("handoff pack — determinism and formatting", () => {
  it("the same input yields a byte-identical pack and formatted text", () => {
    const a = buildPhase6SimulationHandoffPackV1(fullInput());
    const b = buildPhase6SimulationHandoffPackV1(fullInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(formatPhase6SimulationHandoffPackV1(a)).toBe(formatPhase6SimulationHandoffPackV1(b));
  });

  it("formatted output carries the required safety language and no live-authorization phrasing", () => {
    const text = formatPhase6SimulationHandoffPackV1(buildPhase6SimulationHandoffPackV1(fullInput()), {
      label: "fictional-handoff-format",
    });
    expect(text).toContain("SESSION HANDOFF ONLY");
    expect(text).toContain("simulation only");
    expect(text).toContain("does not sign");
    expect(text).toContain("does not send");
    expect(text).toContain("does not authorize live trading");
    const lower = text.toLowerCase();
    expect(lower).not.toContain("trade executed");
    expect(lower).not.toContain("ready for live");
    expect(lower).not.toContain("live-trading ready");
    expect(lower).not.toContain("safe with real funds");
    expect(lower).not.toContain("guaranteed");
  });

  it("an incomplete pack formats honestly (missing classified, not papered over)", () => {
    const input = fullInput();
    delete (input as Record<string, unknown>).runReport;
    const text = formatPhase6SimulationHandoffPackV1(buildPhase6SimulationHandoffPackV1(input));
    expect(text).toContain("MISSING (classified, not invented)");
    expect(text).toContain("10/11 artifacts strictly valid");
  });

  it("throws the module error on malformed input shape only", () => {
    expect(() => buildPhase6SimulationHandoffPackV1({ operatorLabel: 42 } as never)).toThrow(
      Phase6SimulationHandoffPackV1Error,
    );
  });
});
