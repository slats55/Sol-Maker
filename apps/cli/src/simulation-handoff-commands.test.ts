/**
 * Sprint 75 — the `paper:simulation:handoff` CLI surface (`phase6.simulation.handoff.pack.v1`).
 *
 * Exercised through the real command function over FICTIONAL chain artifacts written to a temp
 * dir (built by the PRODUCTION builders via @soulmaker/simulation — they can never drift from the
 * code). Covers: complete-chain handoff, missing/invalid artifacts classified, fail flags
 * (--fail-on-incomplete / --fail-on-blocking / --fail-on-not-ready), unreadable input refused,
 * --out / overwrite refusal / --force, no-write-by-default, validator round-trips, and the
 * literal-lock surface of the emitted JSON.
 */

import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFictionalReadyChain,
  buildSimulationIntentPlanV2,
  buildSimulationResultV1,
  buildPhase6AuditReportV1,
  buildPhase6SimulationReadinessReportV1,
  validatePhase6SimulationHandoffPackV1,
} from "@soulmaker/simulation";
import { paperSimulationHandoffReport } from "./commands.js";

interface HandoffDir {
  tmp: string;
}

/** Write the full FICTIONAL 11-artifact chain into a temp dir. */
function withHandoffDir<T>(fn: (d: HandoffDir) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "simulation-handoff-cli-"));
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
      "diff-chain-tests": "packages/simulation/src/intent-plan-diff.test.ts",
      "handoff-pack-tests": "packages/simulation/src/handoff-pack.test.ts",
      "output-quality-tests": "packages/simulation/src/operator-output-quality.test.ts",
      "tally-validation-tests": "packages/sniper/src/decision-tally-hardening.test.ts",
      "dry-run-boundary-doc": "docs/PHASE6_DRY_RUN_BOUNDARY.md",
      "route-resolution-tests": "packages/simulation/src/route-resolution.test.ts",
    },
    operatorLabel: "fictional-operator",
  });
  const files: ReadonlyArray<readonly [string, unknown]> = [
    ["dec2.json", chain.decision],
    ["run2.json", chain.runReport],
    ["gates2.json", chain.gates],
    ["prereqs2.json", chain.prereqs],
    ["ks.json", chain.killSwitchSpec],
    ["sp.json", chain.secretsPolicy],
    ["bi.json", chain.burnerIsolationSpec],
    ["plan.json", plan],
    ["result.json", result],
    ["audit.json", audit],
    ["readiness.json", readiness],
  ];
  for (const [name, value] of files) writeFileSync(join(tmp, name), JSON.stringify(value, null, 2));
  try {
    return fn({ tmp });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const ALL_PATHS = {
  decisionsPath: "dec2.json",
  runReportPath: "run2.json",
  gatesPath: "gates2.json",
  prereqsPath: "prereqs2.json",
  killSwitchPath: "ks.json",
  secretsPolicyPath: "sp.json",
  burnerIsolationPath: "bi.json",
  intentPlanPath: "plan.json",
  simulationResultPath: "result.json",
  auditPath: "audit.json",
  readinessPath: "readiness.json",
} as const;

describe("paper:simulation:handoff", () => {
  it("complete chain → complete pack, green verbatim readiness, exit 0, validator round-trip", () => {
    withHandoffDir(({ tmp }) => {
      const r = paperSimulationHandoffReport({ cwd: tmp }, { ...ALL_PATHS, packLabel: "fictional-handoff", json: true });
      expect(r.exitCode).toBe(0);
      const pack = validatePhase6SimulationHandoffPackV1(JSON.parse(r.text));
      expect(pack.complete).toBe(true);
      expect(pack.validCount).toBe(11);
      expect(pack.simulationReadyPerReadiness).toBe(true);
      expect(pack.phase7LiveTradingReady).toBe(false);
      expect(pack.neverSigns).toBe(true);
      expect(pack.neverSends).toBe(true);
    });
  });

  it("formatted output carries the handoff-only framing", () => {
    withHandoffDir(({ tmp }) => {
      const r = paperSimulationHandoffReport({ cwd: tmp }, { ...ALL_PATHS });
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain("SESSION HANDOFF ONLY");
      expect(r.text).toContain("does not authorize live trading");
      expect(r.text).toContain("Next safe action:");
    });
  });

  it("missing artifacts are classified (exit 0); --fail-on-incomplete gates them", () => {
    withHandoffDir(({ tmp }) => {
      const { simulationResultPath: _omit, ...rest } = ALL_PATHS;
      const r = paperSimulationHandoffReport({ cwd: tmp }, { ...rest, json: true });
      expect(r.exitCode).toBe(0);
      const pack = validatePhase6SimulationHandoffPackV1(JSON.parse(r.text));
      expect(pack.complete).toBe(false);
      expect(pack.missingRoles).toEqual(["simulation-result"]);
      const gated = paperSimulationHandoffReport({ cwd: tmp }, { ...rest, failOnIncomplete: true });
      expect(gated.exitCode).toBe(1);
      // The complete chain passes the same gate.
      expect(paperSimulationHandoffReport({ cwd: tmp }, { ...ALL_PATHS, failOnIncomplete: true }).exitCode).toBe(0);
    });
  });

  it("--fail-on-blocking trips on the chain's verbatim conditions; --fail-on-not-ready on a missing readiness", () => {
    withHandoffDir(({ tmp }) => {
      // The fictional chain carries prereq conditions (paper-enters await review) — verbatim.
      expect(paperSimulationHandoffReport({ cwd: tmp }, { ...ALL_PATHS, failOnBlocking: true }).exitCode).toBe(1);
      const { readinessPath: _omit, ...rest } = ALL_PATHS;
      expect(paperSimulationHandoffReport({ cwd: tmp }, { ...rest, failOnNotReady: true }).exitCode).toBe(1);
      expect(paperSimulationHandoffReport({ cwd: tmp }, { ...ALL_PATHS, failOnNotReady: true }).exitCode).toBe(0);
    });
  });

  it("an invalid artifact is classified with its error; a tampered lock is invalid", () => {
    withHandoffDir(({ tmp }) => {
      const plan = JSON.parse(readFileSync(join(tmp, "plan.json"), "utf8")) as Record<string, unknown>;
      plan.neverSigns = false;
      writeFileSync(join(tmp, "tampered-plan.json"), JSON.stringify(plan, null, 2));
      const r = paperSimulationHandoffReport(
        { cwd: tmp },
        { ...ALL_PATHS, intentPlanPath: "tampered-plan.json", json: true },
      );
      expect(r.exitCode).toBe(0);
      const pack = validatePhase6SimulationHandoffPackV1(JSON.parse(r.text));
      expect(pack.invalidRoles).toEqual(["intent-plan"]);
      const state = pack.artifacts.find((a) => a.role === "intent-plan")!;
      expect(state.valid).toBe(false);
      expect(state.error).toBeTruthy();
    });
  });

  it("a named-but-unreadable file refuses outright (exit 1)", () => {
    withHandoffDir(({ tmp }) => {
      const missing = paperSimulationHandoffReport({ cwd: tmp }, { ...ALL_PATHS, auditPath: "nope.json" });
      expect(missing.exitCode).toBe(1);
      expect(missing.text).toContain("Refusing:");
      writeFileSync(join(tmp, "garbage.json"), "{not json");
      expect(paperSimulationHandoffReport({ cwd: tmp }, { ...ALL_PATHS, gatesPath: "garbage.json" }).exitCode).toBe(1);
    });
  });

  it("writes nothing by default; --out writes ONLY the pack; overwrite refused without --force", () => {
    withHandoffDir(({ tmp }) => {
      const before = readdirSync(tmp).length;
      paperSimulationHandoffReport({ cwd: tmp }, { ...ALL_PATHS });
      expect(readdirSync(tmp).length).toBe(before);

      const out = paperSimulationHandoffReport({ cwd: tmp }, { ...ALL_PATHS, outPath: "handoff.json" });
      expect(out.exitCode).toBe(0);
      expect(existsSync(join(tmp, "handoff.json"))).toBe(true);
      validatePhase6SimulationHandoffPackV1(JSON.parse(readFileSync(join(tmp, "handoff.json"), "utf8")));

      const refused = paperSimulationHandoffReport({ cwd: tmp }, { ...ALL_PATHS, outPath: "handoff.json" });
      expect(refused.exitCode).toBe(1);
      expect(refused.text).toContain("already exists");

      const forced = paperSimulationHandoffReport({ cwd: tmp }, { ...ALL_PATHS, outPath: "handoff.json", force: true });
      expect(forced.exitCode).toBe(0);
    });
  });

  it("the emitted JSON is byte-deterministic for the same inputs", () => {
    withHandoffDir(({ tmp }) => {
      const r1 = paperSimulationHandoffReport({ cwd: tmp }, { ...ALL_PATHS, json: true });
      const r2 = paperSimulationHandoffReport({ cwd: tmp }, { ...ALL_PATHS, json: true });
      expect(r1.text).toBe(r2.text);
    });
  });
});
