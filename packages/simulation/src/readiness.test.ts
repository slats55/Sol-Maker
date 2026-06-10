/**
 * Sprint 69 — `phase6.simulation.readiness.report.v1`.
 *
 * Proves: the green path needs every machine-verified artifact check AND every declared evidence
 * area; each missing piece blocks fail-closed; chain conditions are a warning (session state, not
 * stack state); and `phase7LiveTradingReady` can never be anything but false.
 */

import { describe, it, expect } from "vitest";
import {
  buildSimulationIntentPlanV2,
  buildSimulationResultV1,
  buildPhase6AuditReportV1,
  buildPhase6SimulationReadinessReportV1,
  validatePhase6SimulationReadinessReportV1,
  formatPhase6SimulationReadinessReportV1,
  Phase6SimulationReadinessReportV1Error,
  SimulationSafetyError,
  PHASE6_READINESS_EVIDENCE_AREAS,
  type BuildPhase6SimulationReadinessReportV1Input,
  type Phase6SimulationReadinessReportV1,
} from "./index.js";
import { buildFictionalWatchOnlyChain } from "./fixtures.js";

const EVIDENCE: Record<(typeof PHASE6_READINESS_EVIDENCE_AREAS)[number], string> = {
  "package-boundary-tests": "packages/simulation/src/no-forbidden-imports.test.ts",
  "cli-commands": "apps/cli/src/simulation-commands.test.ts",
  "e2e-fixtures": "apps/cli/src/simulation-e2e.test.ts",
  "source-scans": "packages/simulation/src/package-boundary.test.ts",
  docs: "docs/SNIPER_RUNBOOK.md",
};

function greenInput(): BuildPhase6SimulationReadinessReportV1Input {
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
  return { auditReport: audit, intentPlan: plan, simulationResult: result, evidence: EVIDENCE, operatorLabel: "fictional-operator" };
}

describe("phase6 simulation readiness — green path", () => {
  it("is GREEN with a passed+complete audit, valid plan/result, and full evidence", () => {
    const report = buildPhase6SimulationReadinessReportV1(greenInput());
    expect(report.phase6SimulationReady).toBe(true);
    expect(report.blockingReasonCodes).toEqual([]);
    expect(report.outcomeReasonCodes).toEqual(["simulation-readiness-green"]);
    expect(report.phase7LiveTradingReady).toBe(false);
    expect(report.warningReasonCodes).toEqual([]); // the watch-only chain has zero conditions
    expect(() => validatePhase6SimulationReadinessReportV1(report)).not.toThrow();
  });

  it("is deterministic: two builds are JSON-identical", () => {
    const a = buildPhase6SimulationReadinessReportV1(greenInput());
    const b = buildPhase6SimulationReadinessReportV1(greenInput());
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe("phase6 simulation readiness — fail-closed blockers", () => {
  it("missing audit blocks", () => {
    const input = greenInput();
    delete input.auditReport;
    const r = buildPhase6SimulationReadinessReportV1(input);
    expect(r.phase6SimulationReady).toBe(false);
    expect(r.blockingReasonCodes).toContain("simulation-readiness-missing-audit");
  });

  it("a FAILED audit blocks (v1 stand-in in the audited chain)", () => {
    const input = greenInput();
    const chain = buildFictionalWatchOnlyChain();
    input.auditReport = buildPhase6AuditReportV1({
      decision: { ...chain.decision, schemaVersion: "sniper.paper.decision.report.v1" },
    });
    const r = buildPhase6SimulationReadinessReportV1(input);
    expect(r.phase6SimulationReady).toBe(false);
    expect(r.blockingReasonCodes).toContain("simulation-readiness-audit-failed");
    expect(r.blockingReasonCodes).toContain("simulation-readiness-chain-incomplete");
  });

  it("an INCOMPLETE chain blocks even when the audit passed", () => {
    const input = greenInput();
    input.auditReport = buildPhase6AuditReportV1({}); // all nine missing: passes, incomplete
    const r = buildPhase6SimulationReadinessReportV1(input);
    expect(r.phase6SimulationReady).toBe(false);
    expect(r.blockingReasonCodes).toContain("simulation-readiness-chain-incomplete");
    expect(r.blockingReasonCodes).not.toContain("simulation-readiness-audit-failed");
  });

  it("missing plan / result block; invalid ones block with the error surfaced", () => {
    const a = greenInput();
    delete a.intentPlan;
    expect(buildPhase6SimulationReadinessReportV1(a).blockingReasonCodes).toContain("simulation-readiness-missing-plan");
    const b = greenInput();
    b.simulationResult = { ...(b.simulationResult as Record<string, unknown>), neverSends: false };
    const r = buildPhase6SimulationReadinessReportV1(b);
    expect(r.blockingReasonCodes).toContain("simulation-readiness-missing-result");
    expect(r.artifactChecks.find((c) => c.id === "RESULT_VALID")?.detail).toContain("INVALID");
  });

  it("each missing evidence area blocks", () => {
    for (const area of PHASE6_READINESS_EVIDENCE_AREAS) {
      const input = greenInput();
      const evidence = { ...EVIDENCE } as Record<string, string>;
      delete evidence[area];
      input.evidence = evidence;
      const r = buildPhase6SimulationReadinessReportV1(input);
      expect(r.phase6SimulationReady, area).toBe(false);
      expect(r.blockingReasonCodes).toContain("simulation-readiness-evidence-missing");
      expect(r.evidence.find((e) => e.area === area)?.declared).toBe(false);
    }
  });

  it("chain conditions are a WARNING, not a blocker (stack works; session has conditions)", () => {
    // Build a chain whose audit surfaces a condition: a draft (non-adopted) kill-switch spec.
    const chain = buildFictionalWatchOnlyChain();
    const draftish = { ...chain.killSwitchSpec, readinessStatus: "draft", adopted: false };
    const plan = buildSimulationIntentPlanV2({
      decision: chain.decision,
      safetyGates: chain.gates,
      prereqs: chain.prereqs,
      killSwitchSpec: chain.killSwitchSpec,
      secretsPolicy: chain.secretsPolicy,
      burnerIsolationSpec: chain.burnerIsolationSpec,
    });
    const result = buildSimulationResultV1({ plan });
    const audit = buildPhase6AuditReportV1({
      decision: chain.decision,
      runReport: chain.runReport,
      safetyGates: chain.gates,
      prereqs: chain.prereqs,
      killSwitchSpec: draftish,
      secretsPolicy: chain.secretsPolicy,
      burnerIsolationSpec: chain.burnerIsolationSpec,
      intentPlan: plan,
      simulationResult: result,
    });
    const r = buildPhase6SimulationReadinessReportV1({
      auditReport: audit,
      intentPlan: plan,
      simulationResult: result,
      evidence: EVIDENCE,
    });
    expect(r.warningReasonCodes).toContain("simulation-readiness-chain-conditions-present");
    expect(r.phase6SimulationReady).toBe(true); // warning only — the stack reported honestly
  });

  it("throws ONLY on a malformed input shape (unknown evidence area, bad types)", () => {
    expect(() => buildPhase6SimulationReadinessReportV1({ evidence: { "made-up-area": "x" } as never })).toThrow(
      Phase6SimulationReadinessReportV1Error,
    );
    expect(() => buildPhase6SimulationReadinessReportV1({ operatorLabel: 42 as never })).toThrow(
      Phase6SimulationReadinessReportV1Error,
    );
  });
});

describe("phase6 simulation readiness — validator backstop", () => {
  const valid = (): Phase6SimulationReadinessReportV1 =>
    JSON.parse(JSON.stringify(buildPhase6SimulationReadinessReportV1(greenInput()))) as Phase6SimulationReadinessReportV1;

  it("phase7LiveTradingReady can NEVER be true (or anything but false)", () => {
    expect(() => validatePhase6SimulationReadinessReportV1({ ...valid(), phase7LiveTradingReady: true })).toThrow(
      /never claim live-trading readiness/,
    );
    expect(() => validatePhase6SimulationReadinessReportV1({ ...valid(), phase7LiveTradingReady: "false" })).toThrow(
      Phase6SimulationReadinessReportV1Error,
    );
  });

  it.each([["neverAuthorizesLiveTrading"], ["neverSigns"], ["neverSends"], ["dryRunOnly"]])(
    "refuses a report whose %s literal lock is flipped",
    (key) => {
      expect(() => validatePhase6SimulationReadinessReportV1({ ...valid(), [key]: false })).toThrow(SimulationSafetyError);
    },
  );

  it("refuses a ready claim the checks/evidence contradict (fail-closed)", () => {
    const r = valid();
    r.evidence[0] = { ...r.evidence[0]!, declared: false, ref: null };
    expect(() => validatePhase6SimulationReadinessReportV1(r)).toThrow(/fail-closed/);
  });
});

describe("phase6 simulation readiness — formatter", () => {
  it("a green report still says NO to Phase 7, permanently", () => {
    const text = formatPhase6SimulationReadinessReportV1(buildPhase6SimulationReadinessReportV1(greenInput()), {
      label: "readiness-case",
    });
    expect(text).toContain("phase 6 simulation ready: YES (simulation stack only)");
    expect(text).toContain("phase 7 live trading ready: NO — permanently false here");
    expect(text).toContain("Declared evidence (verbatim; never verified here):");
    const lower = text.toLowerCase();
    expect(lower).not.toContain("ready for live");
    expect(lower).not.toContain("live trading ready: yes");
  });

  it("a blocked report lists every blocking reason", () => {
    const text = formatPhase6SimulationReadinessReportV1(buildPhase6SimulationReadinessReportV1({}));
    expect(text).toContain("phase 6 simulation ready: NO");
    expect(text).toContain("simulation-readiness-missing-audit");
    expect(text).toContain("simulation-readiness-evidence-missing");
  });
});
