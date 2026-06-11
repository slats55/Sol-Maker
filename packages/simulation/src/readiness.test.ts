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
  buildSimulationRouteResolutionV1,
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
  // Sprint 80 recalibration: the S73–S79 capabilities are part of the Phase 6 bar.
  "diff-chain-tests": "packages/simulation/src/intent-plan-diff.test.ts",
  "handoff-pack-tests": "packages/simulation/src/handoff-pack.test.ts",
  "output-quality-tests": "packages/simulation/src/operator-output-quality.test.ts",
  "tally-validation-tests": "packages/sniper/src/decision-tally-hardening.test.ts",
  "dry-run-boundary-doc": "docs/PHASE6_DRY_RUN_BOUNDARY.md",
  // Sprint 86: the S85 route-resolution artifact layer joined the bar.
  "route-resolution-tests": "packages/simulation/src/route-resolution.test.ts",
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
    routeResolution: buildSimulationRouteResolutionV1({ intentPlan: plan }),
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

describe("phase6 simulation readiness — Sprint 80 recalibration + Sprint 86 route-resolution bump", () => {
  it("the bar now includes the S73–S79 areas AND the S86 route-resolution area (eleven areas, stable order)", () => {
    expect(PHASE6_READINESS_EVIDENCE_AREAS).toEqual([
      "package-boundary-tests",
      "cli-commands",
      "e2e-fixtures",
      "source-scans",
      "docs",
      "diff-chain-tests",
      "handoff-pack-tests",
      "output-quality-tests",
      "tally-validation-tests",
      "dry-run-boundary-doc",
      "route-resolution-tests",
    ]);
  });

  it("readiness stays FALSE when any new area is undeclared (fail-closed)", () => {
    for (const area of ["diff-chain-tests", "handoff-pack-tests", "output-quality-tests", "tally-validation-tests", "dry-run-boundary-doc", "route-resolution-tests"] as const) {
      const input = greenInput();
      const evidence = { ...(input.evidence as Record<string, string>) };
      delete evidence[area];
      input.evidence = evidence;
      const r = buildPhase6SimulationReadinessReportV1(input);
      expect(r.phase6SimulationReady, area).toBe(false);
      expect(r.blockingReasonCodes).toContain("simulation-readiness-evidence-missing");
    }
  });

  it("an artifact built against the OLD five-area bar re-validates as INVALID (never silently trusted)", () => {
    const report = buildPhase6SimulationReadinessReportV1(greenInput());
    const stale = JSON.parse(JSON.stringify(report)) as Phase6SimulationReadinessReportV1;
    stale.evidence = stale.evidence.slice(0, 5);
    expect(() => validatePhase6SimulationReadinessReportV1(stale)).toThrow(/must list all 11 areas/);
  });

  it("S86: an artifact built against the TEN-area bar re-validates as INVALID (intended fail-closed bump)", () => {
    const report = buildPhase6SimulationReadinessReportV1(greenInput());
    const stale = JSON.parse(JSON.stringify(report)) as Phase6SimulationReadinessReportV1;
    stale.evidence = stale.evidence.slice(0, 10); // exactly the pre-S86 bar
    expect(stale.evidence.map((e) => e.area)).not.toContain("route-resolution-tests");
    expect(() => validatePhase6SimulationReadinessReportV1(stale)).toThrow(/must list all 11 areas/);
  });

  it("readiness improves to GREEN exactly when the full new bar is declared — and phase7 stays false", () => {
    const r = buildPhase6SimulationReadinessReportV1(greenInput());
    expect(r.phase6SimulationReady).toBe(true);
    expect(r.evidence.length).toBe(11);
    expect(r.evidence.every((e) => e.declared)).toBe(true);
    expect(r.phase7LiveTradingReady).toBe(false);
  });

  it("S86: declared route-resolution evidence never claims resolver capability — it is a verbatim declaration", () => {
    const r = buildPhase6SimulationReadinessReportV1(greenInput());
    const entry = r.evidence.find((e) => e.area === "route-resolution-tests");
    expect(entry?.declared).toBe(true);
    expect(entry?.ref).toBe("packages/simulation/src/route-resolution.test.ts");
    // The report's own honesty notes still say declarations are never verified or capability claims.
    expect(r.notes.join("\n")).toContain("DECLARATIONS recorded verbatim");
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
    input.auditReport = buildPhase6AuditReportV1({}); // all ten missing: passes, incomplete
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
      routeResolution: buildSimulationRouteResolutionV1({ intentPlan: plan }),
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
    // A flipped ready verdict over an all-green report trips the ready-mirror check.
    const r = valid();
    r.phase6SimulationReady = false;
    expect(() => validatePhase6SimulationReadinessReportV1(r)).toThrow(/fail-closed/);
    // An un-declared area now trips the S86 RECOMPUTED evidence-missing check first — the
    // contradiction is refused either way, just with the more precise message.
    const s = valid();
    s.evidence[0] = { ...s.evidence[0]!, declared: false, ref: null };
    expect(() => validatePhase6SimulationReadinessReportV1(s)).toThrow(
      /must carry simulation-readiness-evidence-missing/,
    );
  });

  it("S86: tampered route-resolution evidence with an unchanged blocking trail is refused (recomputed, never trusted)", () => {
    // Un-declare the route-resolution area AND set ready=false so the old ready-mirror check is
    // satisfied — the blocking trail still contradicts the evidence list, and that is refused.
    const r = valid();
    const idx = r.evidence.findIndex((e) => e.area === "route-resolution-tests");
    r.evidence[idx] = { ...r.evidence[idx]!, declared: false, ref: null };
    r.phase6SimulationReady = false;
    expect(r.blockingReasonCodes).toEqual([]); // the tampered artifact still claims a clean trail
    expect(() => validatePhase6SimulationReadinessReportV1(r)).toThrow(
      /must carry simulation-readiness-evidence-missing/,
    );
  });

  it("S86: an evidence-missing blocking code over fully-declared evidence is refused too (both directions recomputed)", () => {
    const r = valid();
    r.blockingReasonCodes = ["simulation-readiness-evidence-missing"];
    r.phase6SimulationReady = false;
    expect(() => validatePhase6SimulationReadinessReportV1(r)).toThrow(
      /while every evidence area is declared/,
    );
  });

  it("S86: a declared route-resolution area with a hollowed-out ref is refused", () => {
    const r = valid();
    const idx = r.evidence.findIndex((e) => e.area === "route-resolution-tests");
    r.evidence[idx] = { ...r.evidence[idx]!, declared: true, ref: null };
    expect(() => validatePhase6SimulationReadinessReportV1(r)).toThrow(
      /ref must be a non-empty string when declared/,
    );
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
