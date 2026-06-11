/**
 * Sprint 66 — the Phase 6 simulation CLI surface:
 * `paper:simulation:intent:plan` / `paper:simulation:result` / `paper:simulation:validate`.
 *
 * Exercised through the real command functions over FICTIONAL chain artifacts written to a temp
 * dir (the chains are built by the PRODUCTION sniper builders via @soulmaker/simulation's fixture
 * helpers — they can never drift from the code). Covers: happy path, missing/invalid/v1 inputs,
 * blocked plans, fail flags, --out / overwrite refusal / --force, no-write-by-default, and
 * validator round-trips including literal-lock corruption.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFictionalReadyChain,
  validateSimulationIntentPlanV2,
  validateSimulationResultV1,
  type FictionalSimulationChain,
} from "@soulmaker/simulation";
import {
  paperSimulationIntentPlanReport,
  paperSimulationResultReport,
  paperSimulationValidateReport,
  paperSimulationAuditReport,
  paperSimulationReadinessReport,
} from "./commands.js";

function withChainDir<T>(fn: (tmp: string, chain: FictionalSimulationChain) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "simulation-cli-"));
  const chain = buildFictionalReadyChain();
  writeFileSync(join(tmp, "dec2.json"), JSON.stringify(chain.decision, null, 2));
  writeFileSync(join(tmp, "gates2.json"), JSON.stringify(chain.gates, null, 2));
  writeFileSync(join(tmp, "prereqs2.json"), JSON.stringify(chain.prereqs, null, 2));
  writeFileSync(join(tmp, "ks.json"), JSON.stringify(chain.killSwitchSpec, null, 2));
  writeFileSync(join(tmp, "sp.json"), JSON.stringify(chain.secretsPolicy, null, 2));
  writeFileSync(join(tmp, "bi.json"), JSON.stringify(chain.burnerIsolationSpec, null, 2));
  try {
    return fn(tmp, chain);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const ALL_PATHS = {
  decisionsPath: "dec2.json",
  gatesPath: "gates2.json",
  prereqsPath: "prereqs2.json",
  killSwitchPath: "ks.json",
  secretsPolicyPath: "sp.json",
  burnerIsolationPath: "bi.json",
} as const;

describe("paper:simulation:intent:plan", () => {
  it("happy path: full chain + acknowledgment → unblocked plan, exit 0, validator round-trip", () => {
    withChainDir((tmp) => {
      const r = paperSimulationIntentPlanReport(
        { cwd: tmp },
        { ...ALL_PATHS, acknowledgePaperEnterReview: true, operatorLabel: "fictional-operator", json: true },
      );
      expect(r.exitCode).toBe(0);
      const plan = validateSimulationIntentPlanV2(JSON.parse(r.text));
      expect(plan.blocked).toBe(false);
      expect(plan.entryCount).toBe(2);
    });
  });

  it("formatted output carries the preview-only framing", () => {
    withChainDir((tmp) => {
      const r = paperSimulationIntentPlanReport({ cwd: tmp }, { ...ALL_PATHS, acknowledgePaperEnterReview: true });
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain("SIMULATION PREVIEW ONLY");
      expect(r.text).toContain("never signs");
    });
  });

  it("a named-but-missing file refuses (exit 1); invalid JSON refuses", () => {
    withChainDir((tmp) => {
      const missing = paperSimulationIntentPlanReport({ cwd: tmp }, { ...ALL_PATHS, decisionsPath: "nope.json" });
      expect(missing.exitCode).toBe(1);
      expect(missing.text).toContain("Refusing:");
      writeFileSync(join(tmp, "garbage.json"), "{not json");
      const invalid = paperSimulationIntentPlanReport({ cwd: tmp }, { ...ALL_PATHS, gatesPath: "garbage.json" });
      expect(invalid.exitCode).toBe(1);
      expect(invalid.text).toContain("Refusing:");
    });
  });

  it("omitted artifacts produce an honestly BLOCKED plan (exit 0); --fail-on-blocking gates it", () => {
    withChainDir((tmp) => {
      const blocked = paperSimulationIntentPlanReport({ cwd: tmp }, { json: true });
      expect(blocked.exitCode).toBe(0);
      const plan = validateSimulationIntentPlanV2(JSON.parse(blocked.text));
      expect(plan.blocked).toBe(true);
      const gated = paperSimulationIntentPlanReport({ cwd: tmp }, { failOnBlocking: true });
      expect(gated.exitCode).toBe(1);
    });
  });

  it("a v1 decision artifact blocks with the v1-artifact code", () => {
    withChainDir((tmp, chain) => {
      writeFileSync(
        join(tmp, "dec1-shaped.json"),
        JSON.stringify({ ...chain.decision, schemaVersion: "sniper.paper.decision.report.v1" }),
      );
      const r = paperSimulationIntentPlanReport(
        { cwd: tmp },
        { ...ALL_PATHS, decisionsPath: "dec1-shaped.json", json: true },
      );
      expect(r.exitCode).toBe(0);
      const plan = validateSimulationIntentPlanV2(JSON.parse(r.text));
      expect(plan.blockingReasonCodes).toContain("simulation-blocked-v1-artifact");
    });
  });

  it("--fail-on-unresolved exits 1 while previews carry unresolved fields", () => {
    withChainDir((tmp) => {
      const r = paperSimulationIntentPlanReport(
        { cwd: tmp },
        { ...ALL_PATHS, acknowledgePaperEnterReview: true, failOnUnresolved: true },
      );
      expect(r.exitCode).toBe(1);
    });
  });

  it("writes nothing by default; --out writes; overwrite refused without --force", () => {
    withChainDir((tmp) => {
      const before = readdirSync(tmp).length;
      paperSimulationIntentPlanReport({ cwd: tmp }, { ...ALL_PATHS, acknowledgePaperEnterReview: true, json: true });
      expect(readdirSync(tmp).length).toBe(before);

      const out = paperSimulationIntentPlanReport(
        { cwd: tmp },
        { ...ALL_PATHS, acknowledgePaperEnterReview: true, outPath: "plan.json" },
      );
      expect(out.exitCode).toBe(0);
      validateSimulationIntentPlanV2(JSON.parse(readFileSync(join(tmp, "plan.json"), "utf8")));

      const refused = paperSimulationIntentPlanReport(
        { cwd: tmp },
        { ...ALL_PATHS, acknowledgePaperEnterReview: true, outPath: "plan.json" },
      );
      expect(refused.exitCode).toBe(1);
      expect(refused.text).toContain("--force");

      const forced = paperSimulationIntentPlanReport(
        { cwd: tmp },
        { ...ALL_PATHS, acknowledgePaperEnterReview: true, outPath: "plan.json", force: true },
      );
      expect(forced.exitCode).toBe(0);
    });
  });
});

describe("paper:simulation:result", () => {
  function writePlan(tmp: string, opts: Record<string, unknown> = {}): void {
    const r = paperSimulationIntentPlanReport(
      { cwd: tmp },
      { ...ALL_PATHS, acknowledgePaperEnterReview: true, outPath: "plan.json", ...opts },
    );
    expect(r.exitCode).toBe(0);
  }

  it("builds a skipped_unresolved result from the plan (exit 0); fail flags gate it", () => {
    withChainDir((tmp) => {
      writePlan(tmp);
      const r = paperSimulationResultReport({ cwd: tmp }, { planPath: "plan.json", json: true });
      expect(r.exitCode).toBe(0);
      const result = validateSimulationResultV1(JSON.parse(r.text));
      expect(result.resultStatus).toBe("skipped_unresolved");
      expect(result.dryRunAttempted).toBe(false);
      const gated = paperSimulationResultReport({ cwd: tmp }, { planPath: "plan.json", failOnUnresolved: true });
      expect(gated.exitCode).toBe(1);
    });
  });

  it("a blocked plan produces a blocked result; --fail-on-blocked exits 1", () => {
    withChainDir((tmp) => {
      const blockedPlan = paperSimulationIntentPlanReport({ cwd: tmp }, { outPath: "blocked-plan.json" });
      expect(blockedPlan.exitCode).toBe(0);
      const r = paperSimulationResultReport({ cwd: tmp }, { planPath: "blocked-plan.json", json: true });
      expect(r.exitCode).toBe(0);
      expect(validateSimulationResultV1(JSON.parse(r.text)).resultStatus).toBe("blocked");
      const gated = paperSimulationResultReport({ cwd: tmp }, { planPath: "blocked-plan.json", failOnBlocked: true });
      expect(gated.exitCode).toBe(1);
    });
  });

  it("--stop-simulation-tripped blocks at result time", () => {
    withChainDir((tmp) => {
      writePlan(tmp);
      const r = paperSimulationResultReport(
        { cwd: tmp },
        { planPath: "plan.json", stopSimulationTripped: true, json: true },
      );
      const result = validateSimulationResultV1(JSON.parse(r.text));
      expect(result.resultStatus).toBe("blocked");
      expect(result.blockedReasonCodes).toContain("simulation-blocked-kill-switch-stop");
    });
  });

  it("refuses a missing --plan, a missing file, and an invalid/tampered plan", () => {
    withChainDir((tmp) => {
      expect(paperSimulationResultReport({ cwd: tmp }, {}).exitCode).toBe(1);
      expect(paperSimulationResultReport({ cwd: tmp }, { planPath: "nope.json" }).exitCode).toBe(1);
      writePlan(tmp);
      const tampered = JSON.parse(readFileSync(join(tmp, "plan.json"), "utf8")) as Record<string, unknown>;
      tampered.neverSends = false;
      writeFileSync(join(tmp, "tampered.json"), JSON.stringify(tampered));
      const r = paperSimulationResultReport({ cwd: tmp }, { planPath: "tampered.json" });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("Refusing:");
    });
  });

  it("writes nothing by default; --out / overwrite refusal / --force behave", () => {
    withChainDir((tmp) => {
      writePlan(tmp);
      const before = readdirSync(tmp).length;
      paperSimulationResultReport({ cwd: tmp }, { planPath: "plan.json", json: true });
      expect(readdirSync(tmp).length).toBe(before);
      expect(paperSimulationResultReport({ cwd: tmp }, { planPath: "plan.json", outPath: "result.json" }).exitCode).toBe(0);
      expect(paperSimulationResultReport({ cwd: tmp }, { planPath: "plan.json", outPath: "result.json" }).exitCode).toBe(1);
      expect(
        paperSimulationResultReport({ cwd: tmp }, { planPath: "plan.json", outPath: "result.json", force: true }).exitCode,
      ).toBe(0);
    });
  });
});

describe("paper:simulation:validate", () => {
  it("validates a real plan and result (exit 0) and reports them in --json", () => {
    withChainDir((tmp) => {
      paperSimulationIntentPlanReport({ cwd: tmp }, { ...ALL_PATHS, acknowledgePaperEnterReview: true, outPath: "plan.json" });
      paperSimulationResultReport({ cwd: tmp }, { planPath: "plan.json", outPath: "result.json" });
      const r = paperSimulationValidateReport({ cwd: tmp }, { planPath: "plan.json", resultPath: "result.json", json: true });
      expect(r.exitCode).toBe(0);
      const parsed = JSON.parse(r.text) as { allValid: boolean; outcomes: { valid: boolean }[] };
      expect(parsed.allValid).toBe(true);
      expect(parsed.outcomes).toHaveLength(2);
    });
  });

  it("a corrupted literal lock is INVALID (exit 1)", () => {
    withChainDir((tmp) => {
      paperSimulationIntentPlanReport({ cwd: tmp }, { ...ALL_PATHS, acknowledgePaperEnterReview: true, outPath: "plan.json" });
      const plan = JSON.parse(readFileSync(join(tmp, "plan.json"), "utf8")) as Record<string, unknown>;
      plan.dryRunOnly = false;
      writeFileSync(join(tmp, "corrupt.json"), JSON.stringify(plan));
      const r = paperSimulationValidateReport({ cwd: tmp }, { planPath: "corrupt.json" });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("INVALID");
    });
  });

  it("a wrong schema version is INVALID; no args refuses; missing file is INVALID", () => {
    withChainDir((tmp) => {
      writeFileSync(join(tmp, "wrong.json"), JSON.stringify({ schemaVersion: "simulation.intent.plan.v1" }));
      expect(paperSimulationValidateReport({ cwd: tmp }, { planPath: "wrong.json" }).exitCode).toBe(1);
      expect(paperSimulationValidateReport({ cwd: tmp }, {}).exitCode).toBe(1);
      expect(paperSimulationValidateReport({ cwd: tmp }, { resultPath: "nope.json" }).exitCode).toBe(1);
    });
  });
});

describe("paper:simulation:audit", () => {
  const AUDIT_PATHS = {
    decisionsPath: "dec2.json",
    gatesPath: "gates2.json",
    prereqsPath: "prereqs2.json",
    killSwitchPath: "ks.json",
    secretsPolicyPath: "sp.json",
    burnerIsolationPath: "bi.json",
  } as const;

  function writePlanAndResult(tmp: string): void {
    expect(
      paperSimulationIntentPlanReport(
        { cwd: tmp },
        { ...ALL_PATHS, acknowledgePaperEnterReview: true, operatorLabel: "fictional-operator", planLabel: "fictional-plan", outPath: "plan.json" },
      ).exitCode,
    ).toBe(0);
    expect(paperSimulationResultReport({ cwd: tmp }, { planPath: "plan.json", outPath: "result.json" }).exitCode).toBe(0);
  }

  it("audits the full chain from files (exit 0); missing run-report is a warning, not a failure", () => {
    withChainDir((tmp, chain) => {
      writeFileSync(join(tmp, "run2.json"), JSON.stringify(chain.runReport));
      writePlanAndResult(tmp);
      const r = paperSimulationAuditReport(
        { cwd: tmp },
        { ...AUDIT_PATHS, runReportPath: "run2.json", intentPlanPath: "plan.json", simulationResultPath: "result.json", json: true },
      );
      expect(r.exitCode).toBe(0);
      const report = JSON.parse(r.text) as { auditPassed: boolean; chainComplete: boolean };
      expect(report.auditPassed).toBe(true);
      expect(report.chainComplete).toBe(true);

      const partial = paperSimulationAuditReport({ cwd: tmp }, { ...AUDIT_PATHS, intentPlanPath: "plan.json", json: true });
      expect(partial.exitCode).toBe(0);
      const partialReport = JSON.parse(partial.text) as { auditPassed: boolean; chainComplete: boolean };
      expect(partialReport.auditPassed).toBe(true);
      expect(partialReport.chainComplete).toBe(false);
    });
  });

  it("--fail-on-incomplete and --fail-on-findings gate the exit code", () => {
    withChainDir((tmp, chain) => {
      writeFileSync(join(tmp, "run2.json"), JSON.stringify(chain.runReport));
      expect(paperSimulationAuditReport({ cwd: tmp }, { ...AUDIT_PATHS, failOnIncomplete: true }).exitCode).toBe(1);
      // A v1 decision stand-in is a blocking finding.
      writeFileSync(join(tmp, "dec1-shaped.json"), JSON.stringify({ ...chain.decision, schemaVersion: "sniper.paper.decision.report.v1" }));
      const failed = paperSimulationAuditReport(
        { cwd: tmp },
        { ...AUDIT_PATHS, decisionsPath: "dec1-shaped.json", failOnFindings: true },
      );
      expect(failed.exitCode).toBe(1);
      expect(failed.text).toContain("audit-v1-artifact");
    });
  });

  it("refuses an unreadable named file; --out / overwrite refusal / --force behave", () => {
    withChainDir((tmp) => {
      expect(paperSimulationAuditReport({ cwd: tmp }, { decisionsPath: "nope.json" }).exitCode).toBe(1);
      expect(paperSimulationAuditReport({ cwd: tmp }, { ...AUDIT_PATHS, outPath: "audit.json" }).exitCode).toBe(0);
      expect(paperSimulationAuditReport({ cwd: tmp }, { ...AUDIT_PATHS, outPath: "audit.json" }).exitCode).toBe(1);
      expect(paperSimulationAuditReport({ cwd: tmp }, { ...AUDIT_PATHS, outPath: "audit.json", force: true }).exitCode).toBe(0);
    });
  });
});

describe("paper:simulation:readiness", () => {
  const EVIDENCE_FLAGS = [
    "package-boundary-tests=packages/simulation/src/no-forbidden-imports.test.ts",
    "cli-commands=apps/cli/src/simulation-commands.test.ts",
    "e2e-fixtures=apps/cli/src/simulation-e2e.test.ts",
    "source-scans=packages/simulation/src/package-boundary.test.ts",
    "docs=docs/SNIPER_RUNBOOK.md",
    "diff-chain-tests=packages/simulation/src/intent-plan-diff.test.ts",
    "handoff-pack-tests=packages/simulation/src/handoff-pack.test.ts",
    "output-quality-tests=packages/simulation/src/operator-output-quality.test.ts",
    "tally-validation-tests=packages/sniper/src/decision-tally-hardening.test.ts",
    "dry-run-boundary-doc=docs/PHASE6_DRY_RUN_BOUNDARY.md",
    "route-resolution-tests=packages/simulation/src/route-resolution.test.ts",
  ];

  function buildChainFiles(tmp: string, chain: FictionalSimulationChain): void {
    writeFileSync(join(tmp, "run2.json"), JSON.stringify(chain.runReport));
    expect(
      paperSimulationIntentPlanReport(
        { cwd: tmp },
        { ...ALL_PATHS, acknowledgePaperEnterReview: true, operatorLabel: "fictional-operator", planLabel: "fictional-plan", outPath: "plan.json" },
      ).exitCode,
    ).toBe(0);
    expect(paperSimulationResultReport({ cwd: tmp }, { planPath: "plan.json", outPath: "result.json" }).exitCode).toBe(0);
    expect(
      paperSimulationAuditReport(
        { cwd: tmp },
        {
          decisionsPath: "dec2.json", runReportPath: "run2.json", gatesPath: "gates2.json", prereqsPath: "prereqs2.json",
          killSwitchPath: "ks.json", secretsPolicyPath: "sp.json", burnerIsolationPath: "bi.json",
          intentPlanPath: "plan.json", simulationResultPath: "result.json", outPath: "audit.json",
        },
      ).exitCode,
    ).toBe(0);
  }

  it("is GREEN with the full chain + all evidence; --fail-on-not-ready gates a partial one", () => {
    withChainDir((tmp, chain) => {
      buildChainFiles(tmp, chain);
      const r = paperSimulationReadinessReport(
        { cwd: tmp },
        { auditPath: "audit.json", planPath: "plan.json", resultPath: "result.json", evidence: EVIDENCE_FLAGS, json: true },
      );
      expect(r.exitCode).toBe(0);
      const report = JSON.parse(r.text) as { phase6SimulationReady: boolean; phase7LiveTradingReady: boolean };
      expect(report.phase6SimulationReady).toBe(true);
      expect(report.phase7LiveTradingReady).toBe(false);

      const partial = paperSimulationReadinessReport(
        { cwd: tmp },
        { auditPath: "audit.json", planPath: "plan.json", resultPath: "result.json", evidence: [], failOnNotReady: true },
      );
      expect(partial.exitCode).toBe(1);
    });
  });

  it("refuses an unknown evidence area and a malformed evidence flag", () => {
    withChainDir((tmp) => {
      expect(paperSimulationReadinessReport({ cwd: tmp }, { evidence: ["made-up=x"] }).exitCode).toBe(1);
      expect(paperSimulationReadinessReport({ cwd: tmp }, { evidence: ["no-equals"] }).exitCode).toBe(1);
    });
  });

  it("--out / overwrite refusal / --force behave", () => {
    withChainDir((tmp, chain) => {
      buildChainFiles(tmp, chain);
      const opts = { auditPath: "audit.json", planPath: "plan.json", resultPath: "result.json", evidence: EVIDENCE_FLAGS } as const;
      expect(paperSimulationReadinessReport({ cwd: tmp }, { ...opts, outPath: "ready.json" }).exitCode).toBe(0);
      expect(paperSimulationReadinessReport({ cwd: tmp }, { ...opts, outPath: "ready.json" }).exitCode).toBe(1);
      expect(paperSimulationReadinessReport({ cwd: tmp }, { ...opts, outPath: "ready.json", force: true }).exitCode).toBe(0);
    });
  });
});
