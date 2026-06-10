/**
 * Sprint 76 — OPERATOR OUTPUT QUALITY (the dedicated pass over every simulation formatter).
 *
 * Every operator-facing simulation formatter (intent plan, result, chain audit, readiness, the
 * two diffs, the handoff pack) is rendered over FICTIONAL good AND degraded states, and each
 * output is held to one shared bar:
 *
 *   - REQUIRED language present: "simulation only", "does not sign", "does not send",
 *     "does not authorize live trading" (the shared SIMULATION_OPERATOR_SAFETY_LINE), plus the
 *     artifact identity line and a "Next safe action" line.
 *   - FORBIDDEN language absent: execution/profit/live-readiness/hype claims.
 *   - Degraded states stay READABLE: blocked outputs say BLOCKED with operator messages;
 *     unresolved previews say UNRESOLVED (never invented); missing artifacts are classified.
 *   - Ready-for-simulation NEVER reads as ready-for-live.
 *   - No secret echo: secret-shaped content in operator-controlled labels is redacted.
 */

import { describe, it, expect } from "vitest";
import {
  buildSimulationIntentPlanV2,
  formatSimulationIntentPlanV2,
  buildSimulationResultV1,
  formatSimulationResultV1,
  buildPhase6AuditReportV1,
  formatPhase6AuditReportV1,
  buildPhase6SimulationReadinessReportV1,
  formatPhase6SimulationReadinessReportV1,
  diffSimulationIntentPlansV2,
  formatSimulationIntentPlanDiffV2,
  diffSimulationResultsV1,
  formatSimulationResultDiffV1,
  buildPhase6SimulationHandoffPackV1,
  formatPhase6SimulationHandoffPackV1,
  SIMULATION_OPERATOR_SAFETY_LINE,
  type SimulationIntentPlanV2,
} from "./index.js";
import { buildFictionalReadyChain, type FictionalSimulationChain } from "./fixtures.js";

// --- fictional states ----------------------------------------------------------

function readyPlan(chain: FictionalSimulationChain, extra: Record<string, unknown> = {}): SimulationIntentPlanV2 {
  return buildSimulationIntentPlanV2({
    decision: chain.decision,
    safetyGates: chain.gates,
    prereqs: chain.prereqs,
    killSwitchSpec: chain.killSwitchSpec,
    secretsPolicy: chain.secretsPolicy,
    burnerIsolationSpec: chain.burnerIsolationSpec,
    operatorAcknowledgedPaperEnterReview: true,
    operatorLabel: "fictional-operator",
    planLabel: "fictional-plan",
    ...extra,
  });
}

/** Every formatter output, over a good state and a degraded state (label → text). */
function allOutputs(): Record<string, string> {
  const chain = buildFictionalReadyChain();
  const plan = readyPlan(chain);
  const blockedPlan = buildSimulationIntentPlanV2({});
  const result = buildSimulationResultV1({ plan });
  const blockedResult = buildSimulationResultV1({ plan, stopSimulationTripped: true });
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
  });
  const incompleteAudit = buildPhase6AuditReportV1({ decision: chain.decision });
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
      "diff-chain-tests": "packages/simulation/src/intent-plan-diff.test.ts",
      "handoff-pack-tests": "packages/simulation/src/handoff-pack.test.ts",
      "output-quality-tests": "packages/simulation/src/operator-output-quality.test.ts",
      "tally-validation-tests": "packages/sniper/src/decision-tally-hardening.test.ts",
      "dry-run-boundary-doc": "docs/PHASE6_DRY_RUN_BOUNDARY.md",
    },
  });
  const notReadyReadiness = buildPhase6SimulationReadinessReportV1({});
  const handoff = buildPhase6SimulationHandoffPackV1({
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
  });
  const emptyHandoff = buildPhase6SimulationHandoffPackV1({});

  return {
    "plan (ready)": formatSimulationIntentPlanV2(plan),
    "plan (blocked)": formatSimulationIntentPlanV2(blockedPlan),
    "result (skipped)": formatSimulationResultV1(result),
    "result (blocked)": formatSimulationResultV1(blockedResult),
    "audit (complete)": formatPhase6AuditReportV1(audit),
    "audit (incomplete)": formatPhase6AuditReportV1(incompleteAudit),
    "readiness (green)": formatPhase6SimulationReadinessReportV1(readiness),
    "readiness (not ready)": formatPhase6SimulationReadinessReportV1(notReadyReadiness),
    "plan diff (identical)": formatSimulationIntentPlanDiffV2(diffSimulationIntentPlansV2(plan, plan)),
    "plan diff (changed)": formatSimulationIntentPlanDiffV2(diffSimulationIntentPlansV2(plan, blockedPlan)),
    "result diff (identical)": formatSimulationResultDiffV1(diffSimulationResultsV1(result, result)),
    "result diff (changed)": formatSimulationResultDiffV1(diffSimulationResultsV1(result, blockedResult)),
    "handoff (complete)": formatPhase6SimulationHandoffPackV1(handoff),
    "handoff (empty)": formatPhase6SimulationHandoffPackV1(emptyHandoff),
  };
}

/** Affirmative claims no simulation output may ever make (checked case-insensitively). */
const FORBIDDEN_PHRASES = [
  "trade executed",
  "trade placed",
  "transaction sent",
  "transaction signed",
  "order filled",
  "position opened",
  "ready for live",
  "live-ready",
  "live trading ready: yes",
  "live trading is ready",
  "safe with real funds",
  "guaranteed",
  "profitable",
  "profits",
  "moon",
  "can't lose",
];

describe("operator output quality — every formatter, good and degraded states", () => {
  const outputs = allOutputs();

  it("renders a meaningful set of outputs (guards against an empty sweep)", () => {
    expect(Object.keys(outputs).length).toBeGreaterThanOrEqual(14);
    for (const text of Object.values(outputs)) expect(text.length).toBeGreaterThan(200);
  });

  for (const [label, text] of Object.entries(allOutputs())) {
    it(`${label}: carries the required safety language, identity, and next safe action`, () => {
      expect(text).toContain(SIMULATION_OPERATOR_SAFETY_LINE);
      expect(text).toContain("simulation only");
      expect(text).toContain("does not sign");
      expect(text).toContain("does not send");
      expect(text).toContain("does not authorize live trading");
      expect(text).toContain("artifact: ");
      expect(text).toContain("Next safe action:");
    });

    it(`${label}: never makes a forbidden execution/profit/live-readiness claim`, () => {
      const lower = text.toLowerCase();
      for (const phrase of FORBIDDEN_PHRASES) {
        expect(lower, `"${phrase}" must never appear in ${label}`).not.toContain(phrase);
      }
    });
  }
});

describe("operator output quality — degraded states stay readable", () => {
  it("a blocked plan reads as BLOCKED with per-code operator messages", () => {
    const text = formatSimulationIntentPlanV2(buildSimulationIntentPlanV2({}));
    expect(text).toContain("status:   BLOCKED");
    expect(text).toContain("BLOCKING reasons (resolve every one; a blocked plan builds no previews):");
    expect(text).toContain("simulation-blocked-missing-decision-v2");
    // Each code is followed by its operator message, not left bare.
    expect(text).toContain("Build one with paper:sniper:decide --schema-version v2");
  });

  it("unresolved previews read as UNRESOLVED and never invented", () => {
    const chain = buildFictionalReadyChain();
    const text = formatSimulationIntentPlanV2(readyPlan(chain));
    expect(text).toContain("UNRESOLVED (never invented)");
    expect(text).toContain("unresolved fields");
  });

  it("a skipped result explains WHY each entry was skipped", () => {
    const chain = buildFictionalReadyChain();
    const text = formatSimulationResultV1(buildSimulationResultV1({ plan: readyPlan(chain) }));
    expect(text).toContain("skipped_unresolved");
    expect(text).toContain("nothing is simulated from invented values");
  });

  it("an empty handoff classifies all eleven artifacts as missing, honestly", () => {
    const text = formatPhase6SimulationHandoffPackV1(buildPhase6SimulationHandoffPackV1({}));
    expect(text).toContain("0/11 artifacts strictly valid");
    expect(text).toContain("MISSING (classified, not invented)");
  });
});

describe("operator output quality — simulation readiness never implies live readiness", () => {
  it("a GREEN readiness report still pins Phase 7 to unauthorized in plain language", () => {
    const chain = buildFictionalReadyChain();
    const plan = readyPlan(chain);
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
    });
    const readiness = buildPhase6SimulationReadinessReportV1({
      auditReport: audit,
      intentPlan: plan,
      simulationResult: result,
      evidence: {
        "package-boundary-tests": "a",
        "cli-commands": "b",
        "e2e-fixtures": "c",
        "source-scans": "d",
        docs: "e",
        "diff-chain-tests": "f",
        "handoff-pack-tests": "g",
        "output-quality-tests": "h",
        "tally-validation-tests": "i",
        "dry-run-boundary-doc": "j",
      },
    });
    expect(readiness.phase6SimulationReady).toBe(true);
    const text = formatPhase6SimulationReadinessReportV1(readiness);
    expect(text).toContain("phase 6 simulation ready: YES (simulation stack only)");
    expect(text).toContain("phase 7 live trading ready: NO");
    expect(text).toContain("never live-trading readiness");
  });
});

describe("operator output quality — no secret echo through operator-controlled labels", () => {
  it("a bearer token in a plan label is redacted from the formatted output", () => {
    const chain = buildFictionalReadyChain();
    const plan = readyPlan(chain, { planLabel: "session Authorization: Bearer abc123.def456-ghi end" });
    const text = formatSimulationIntentPlanV2(plan);
    expect(text).not.toContain("abc123.def456-ghi");
    expect(text).toContain("[REDACTED]");
  });

  it("an api-key url in an operator label is redacted from the handoff output", () => {
    const chain = buildFictionalReadyChain();
    const pack = buildPhase6SimulationHandoffPackV1({
      decision: chain.decision,
      operatorLabel: "ops https://rpc.example.com/?api-key=supersecret123&x=1",
    });
    const text = formatPhase6SimulationHandoffPackV1(pack);
    expect(text).not.toContain("supersecret123");
  });

  it("a secret-shaped formatter label option is redacted too", () => {
    const chain = buildFictionalReadyChain();
    const text = formatSimulationResultV1(buildSimulationResultV1({ plan: readyPlan(chain) }), {
      label: "run with Authorization: Bearer tok-AAAA.bbbb-cccc",
    });
    expect(text).not.toContain("tok-AAAA.bbbb-cccc");
  });
});
