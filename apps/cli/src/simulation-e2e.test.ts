/**
 * Sprint 68 (+78) — END-TO-END Phase 6 fixture chain through the REAL CLI command functions.
 *
 * The base chain is FICTIONAL and built by the PRODUCTION sniper builders (the simulation
 * package's fixture helpers), written into a temp dir, then driven through the actual commands:
 * intent plan → result → validate → chain audit → readiness → diffs → handoff (the FULL Phase 6
 * surface as of Sprint 78). Proves, with production validators:
 *
 *   - the whole Phase 6 surface coheres end to end (plan unblocked, result honest, audit clean,
 *     readiness green, diffs identical for a self-pair, handoff complete with the verbatim
 *     readiness verdict);
 *   - byte determinism (two full runs produce byte-identical artifacts across ALL ten files);
 *   - no command writes anything by default; --out refuses overwrite without --force;
 *   - no fixture or generated artifact carries a secret-shaped key or value;
 *   - the chain FAILS CLOSED: a kill-switch stop blocks plan AND result AND propagates into the
 *     handoff's blocking conditions; a v1 decision blocks the plan and fails the audit; a draft
 *     spec blocks; a flipped literal lock is refused everywhere it can be presented.
 *
 * Everything here is invented; nothing is live data, a trade signal, or a profitability claim.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFictionalReadyChain,
  validateSimulationIntentPlanV2,
  validateSimulationResultV1,
  validatePhase6AuditReportV1,
  validatePhase6SimulationReadinessReportV1,
  validateSimulationIntentPlanDiffV2,
  validateSimulationResultDiffV1,
  validatePhase6SimulationHandoffPackV1,
} from "@soulmaker/simulation";
import {
  paperSimulationIntentPlanReport,
  paperSimulationResultReport,
  paperSimulationValidateReport,
  paperSimulationAuditReport,
  paperSimulationReadinessReport,
  paperSimulationDiffPlanReport,
  paperSimulationDiffResultReport,
  paperSimulationHandoffReport,
} from "./commands.js";

const CHAIN_FILES = ["dec2.json", "run2.json", "gates2.json", "prereqs2.json", "ks.json", "sp.json", "bi.json"] as const;
const GENERATED_FILES = ["plan.json", "result.json", "audit.json"] as const;
const EXTENDED_FILES = ["readiness.json", "plan-diff.json", "result-diff.json", "handoff.json"] as const;

/** Write the FICTIONAL base chain into `dir` (production-builder output, serialized verbatim). */
function writeBaseChain(dir: string): void {
  const c = buildFictionalReadyChain();
  writeFileSync(join(dir, "dec2.json"), JSON.stringify(c.decision, null, 2));
  writeFileSync(join(dir, "run2.json"), JSON.stringify(c.runReport, null, 2));
  writeFileSync(join(dir, "gates2.json"), JSON.stringify(c.gates, null, 2));
  writeFileSync(join(dir, "prereqs2.json"), JSON.stringify(c.prereqs, null, 2));
  writeFileSync(join(dir, "ks.json"), JSON.stringify(c.killSwitchSpec, null, 2));
  writeFileSync(join(dir, "sp.json"), JSON.stringify(c.secretsPolicy, null, 2));
  writeFileSync(join(dir, "bi.json"), JSON.stringify(c.burnerIsolationSpec, null, 2));
}

const PLAN_OPTS = {
  decisionsPath: "dec2.json",
  gatesPath: "gates2.json",
  prereqsPath: "prereqs2.json",
  killSwitchPath: "ks.json",
  secretsPolicyPath: "sp.json",
  burnerIsolationPath: "bi.json",
  acknowledgePaperEnterReview: true,
  operatorLabel: "fictional-operator",
  planLabel: "fictional-e2e-plan",
} as const;

const AUDIT_OPTS = {
  decisionsPath: "dec2.json",
  runReportPath: "run2.json",
  gatesPath: "gates2.json",
  prereqsPath: "prereqs2.json",
  killSwitchPath: "ks.json",
  secretsPolicyPath: "sp.json",
  burnerIsolationPath: "bi.json",
  intentPlanPath: "plan.json",
  simulationResultPath: "result.json",
  operatorLabel: "fictional-operator",
} as const;

/** Run the core Phase 6 pipeline through the real commands; assert every exit code. */
function runPipeline(cwd: string): void {
  const ctx = { cwd, env: {} };
  const must = (label: string, r: { exitCode: number; text: string }): void => {
    expect(r.exitCode, `${label}: ${r.text.slice(0, 200)}`).toBe(0);
  };
  must("intent-plan", paperSimulationIntentPlanReport(ctx, { ...PLAN_OPTS, outPath: "plan.json" }));
  must("result", paperSimulationResultReport(ctx, { planPath: "plan.json", outPath: "result.json" }));
  must("validate", paperSimulationValidateReport(ctx, { planPath: "plan.json", resultPath: "result.json" }));
  must("audit", paperSimulationAuditReport(ctx, { ...AUDIT_OPTS, outPath: "audit.json", failOnFindings: true, failOnIncomplete: true }));
}

const EVIDENCE = [
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
] as const;

const HANDOFF_OPTS = {
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
  operatorLabel: "fictional-operator",
  packLabel: "fictional-e2e-handoff",
} as const;

/** Sprint 78: run the FULL chain — core pipeline + readiness + both diffs + handoff. */
function runFullPipeline(cwd: string): void {
  runPipeline(cwd);
  const ctx = { cwd, env: {} };
  const must = (label: string, r: { exitCode: number; text: string }): void => {
    expect(r.exitCode, `${label}: ${r.text.slice(0, 200)}`).toBe(0);
  };
  must("readiness", paperSimulationReadinessReport(ctx, {
    auditPath: "audit.json",
    planPath: "plan.json",
    resultPath: "result.json",
    evidence: [...EVIDENCE],
    operatorLabel: "fictional-operator",
    outPath: "readiness.json",
    failOnNotReady: true,
  }));
  // Self-pair diffs over the freshly-built artifacts: must be identical and must not gate.
  must("diff:plan", paperSimulationDiffPlanReport(ctx, { basePath: "plan.json", nextPath: "plan.json", outPath: "plan-diff.json", failOnDiff: true }));
  must("diff:result", paperSimulationDiffResultReport(ctx, { basePath: "result.json", nextPath: "result.json", outPath: "result-diff.json", failOnDiff: true }));
  must("handoff", paperSimulationHandoffReport(ctx, { ...HANDOFF_OPTS, outPath: "handoff.json", failOnIncomplete: true, failOnNotReady: true }));
}

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "phase6-e2e-"));
  writeBaseChain(tmp);
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const readJson = (dir: string, name: string): unknown => JSON.parse(readFileSync(join(dir, name), "utf8"));

describe("phase6 e2e — the full simulation chain through the real CLI commands", () => {
  it("runs end-to-end; every generated artifact validates with its PRODUCTION validator", () => {
    withTmp((tmp) => {
      runPipeline(tmp);
      const plan = validateSimulationIntentPlanV2(readJson(tmp, "plan.json"));
      expect(plan.blocked).toBe(false);
      expect(plan.entryCount).toBe(2);
      expect(plan.paperEnterReviewAcknowledgmentApplied).toBe(true);
      const result = validateSimulationResultV1(readJson(tmp, "result.json"));
      expect(result.resultStatus).toBe("skipped_unresolved"); // honest: previews unresolved, nothing simulated
      expect(result.dryRunAttempted).toBe(false);
      const audit = validatePhase6AuditReportV1(readJson(tmp, "audit.json"));
      expect(audit.auditPassed).toBe(true);
      expect(audit.chainComplete).toBe(true);
      expect(audit.neverAuthorizesLiveTrading).toBe(true);
    });
  });

  it("is deterministic: two full runs produce byte-identical artifacts", () => {
    withTmp((a) => {
      withTmp((b) => {
        runPipeline(a);
        runPipeline(b);
        for (const f of [...CHAIN_FILES, ...GENERATED_FILES]) {
          expect(readFileSync(join(b, f), "utf8"), f).toBe(readFileSync(join(a, f), "utf8"));
        }
      });
    });
  });

  it("no command writes anything by default (only --out writes, only the named file)", () => {
    withTmp((tmp) => {
      const ctx = { cwd: tmp, env: {} };
      const before = readdirSync(tmp).sort();
      paperSimulationIntentPlanReport(ctx, { ...PLAN_OPTS, json: true });
      paperSimulationAuditReport(ctx, { ...AUDIT_OPTS, intentPlanPath: undefined, simulationResultPath: undefined, json: true });
      paperSimulationValidateReport(ctx, { planPath: "dec2.json" }); // wrong schema — still no writes
      expect(readdirSync(tmp).sort()).toEqual(before);
      runPipeline(tmp);
      expect(readdirSync(tmp).sort()).toEqual([...before, ...GENERATED_FILES].sort());
    });
  });
});

describe("phase6 e2e — secret hygiene over every fixture and generated artifact", () => {
  function walk(value: unknown, keys: string[], strings: string[]): void {
    if (typeof value === "string") {
      strings.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) walk(v, keys, strings);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        keys.push(k);
        walk(v, keys, strings);
      }
    }
  }

  it("no chain file or generated artifact carries a secret-bearing key or key-shaped value", () => {
    withTmp((tmp) => {
      runPipeline(tmp);
      for (const f of [...CHAIN_FILES, ...GENERATED_FILES]) {
        const keys: string[] = [];
        const strings: string[] = [];
        walk(readJson(tmp, f), keys, strings);
        for (const k of keys) {
          expect(/^(privateKey|secretKey|mnemonic|seedPhrase|keypair|passphrase)$/i.test(k), `${f} carries secret-bearing key "${k}"`).toBe(false);
        }
        for (const s of strings) {
          expect(/^[1-9A-HJ-NP-Za-km-z]{64,}$/.test(s.trim()), `${f} carries a base58 key-shaped value`).toBe(false);
          expect(/^(0x)?[0-9a-fA-F]{64,}$/.test(s.trim()), `${f} carries a hex key-shaped value`).toBe(false);
          const words = s.trim().split(/\s+/);
          expect((words.length === 12 || words.length === 24) && words.every((w) => /^[a-z]{3,8}$/.test(w)), `${f} carries a phrase-shaped value`).toBe(false);
        }
      }
    });
  });
});

describe("phase6 e2e — negative fixtures (the chain fails closed)", () => {
  it("a kill-switch STOP blocks the plan AND a later result built under it", () => {
    withTmp((tmp) => {
      const ctx = { cwd: tmp, env: {} };
      const planR = paperSimulationIntentPlanReport(ctx, { ...PLAN_OPTS, stopSimulationTripped: true, outPath: "plan.json", failOnBlocking: true });
      expect(planR.exitCode).toBe(1); // blocked + gated
      const plan = validateSimulationIntentPlanV2(readJson(tmp, "plan.json"));
      expect(plan.blockingReasonCodes).toContain("simulation-blocked-kill-switch-stop");
      // Build a CLEAN plan, then trip the switch at result time.
      paperSimulationIntentPlanReport(ctx, { ...PLAN_OPTS, outPath: "plan.json", force: true });
      const resultR = paperSimulationResultReport(ctx, { planPath: "plan.json", stopSimulationTripped: true, outPath: "result.json", failOnBlocked: true });
      expect(resultR.exitCode).toBe(1);
      expect(validateSimulationResultV1(readJson(tmp, "result.json")).resultStatus).toBe("blocked");
    });
  });

  it("a v1 decision stand-in blocks the plan and FAILS the audit", () => {
    withTmp((tmp) => {
      const ctx = { cwd: tmp, env: {} };
      const v1ish = { ...(readJson(tmp, "dec2.json") as Record<string, unknown>), schemaVersion: "sniper.paper.decision.report.v1" };
      writeFileSync(join(tmp, "dec1.json"), JSON.stringify(v1ish, null, 2));
      const planR = paperSimulationIntentPlanReport(ctx, { ...PLAN_OPTS, decisionsPath: "dec1.json", json: true });
      const plan = validateSimulationIntentPlanV2(JSON.parse(planR.text));
      expect(plan.blockingReasonCodes).toContain("simulation-blocked-v1-artifact");
      const auditR = paperSimulationAuditReport(ctx, { ...AUDIT_OPTS, decisionsPath: "dec1.json", intentPlanPath: undefined, simulationResultPath: undefined, failOnFindings: true });
      expect(auditR.exitCode).toBe(1);
    });
  });

  it("a DRAFT (non-adopted) spec blocks the plan", () => {
    withTmp((tmp) => {
      const ctx = { cwd: tmp, env: {} };
      const ks = readJson(tmp, "ks.json") as Record<string, unknown>;
      writeFileSync(join(tmp, "ks-draft.json"), JSON.stringify({ ...ks, readinessStatus: "draft", adopted: false }, null, 2));
      const r = paperSimulationIntentPlanReport(ctx, { ...PLAN_OPTS, killSwitchPath: "ks-draft.json", json: true });
      const plan = validateSimulationIntentPlanV2(JSON.parse(r.text));
      expect(plan.blockingReasonCodes).toContain("simulation-blocked-kill-switch-not-adopted");
    });
  });

  it("a flipped literal lock is refused by validate, by the result builder, and by the audit", () => {
    withTmp((tmp) => {
      const ctx = { cwd: tmp, env: {} };
      runPipeline(tmp);
      const plan = readJson(tmp, "plan.json") as Record<string, unknown>;
      writeFileSync(join(tmp, "evil-plan.json"), JSON.stringify({ ...plan, neverSends: false }, null, 2));
      expect(paperSimulationValidateReport(ctx, { planPath: "evil-plan.json" }).exitCode).toBe(1);
      expect(paperSimulationResultReport(ctx, { planPath: "evil-plan.json" }).exitCode).toBe(1);
      const auditR = paperSimulationAuditReport(ctx, { ...AUDIT_OPTS, intentPlanPath: "evil-plan.json", failOnFindings: true, json: true });
      expect(auditR.exitCode).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Sprint 78 — the FULL chain (readiness + diffs + handoff included) end to end.
// ---------------------------------------------------------------------------

describe("phase6 e2e (S78) — the FULL chain through every simulation command", () => {
  it("runs the full chain; every artifact validates; readiness is green; the handoff is complete", () => {
    withTmp((tmp) => {
      runFullPipeline(tmp);
      const readiness = validatePhase6SimulationReadinessReportV1(readJson(tmp, "readiness.json"));
      expect(readiness.phase6SimulationReady).toBe(true);
      expect(readiness.phase7LiveTradingReady).toBe(false);
      const planDiff = validateSimulationIntentPlanDiffV2(readJson(tmp, "plan-diff.json"));
      expect(planDiff.hasChange).toBe(false);
      expect(planDiff.diffReasonCodes).toEqual(["simulation-diff-plan-identical"]);
      const resultDiff = validateSimulationResultDiffV1(readJson(tmp, "result-diff.json"));
      expect(resultDiff.hasChange).toBe(false);
      const handoff = validatePhase6SimulationHandoffPackV1(readJson(tmp, "handoff.json"));
      expect(handoff.complete).toBe(true);
      expect(handoff.validCount).toBe(11);
      // The handoff's verbatim readiness verdict mirrors the readiness artifact exactly.
      expect(handoff.simulationReadyPerReadiness).toBe(readiness.phase6SimulationReady);
      expect(handoff.phase7LiveTradingReady).toBe(false);
    });
  });

  it("two full runs are byte-identical across ALL ten generated/source files", () => {
    withTmp((a) => {
      withTmp((b) => {
        runFullPipeline(a);
        runFullPipeline(b);
        for (const f of [...CHAIN_FILES, ...GENERATED_FILES, ...EXTENDED_FILES]) {
          expect(readFileSync(join(b, f), "utf8"), f).toBe(readFileSync(join(a, f), "utf8"));
        }
      });
    });
  });

  it("the new commands write nothing by default and refuse overwrite without --force", () => {
    withTmp((tmp) => {
      const ctx = { cwd: tmp, env: {} };
      runFullPipeline(tmp);
      const before = readdirSync(tmp).sort();
      // No default writes.
      paperSimulationReadinessReport(ctx, { auditPath: "audit.json", planPath: "plan.json", resultPath: "result.json", evidence: [...EVIDENCE], json: true });
      paperSimulationDiffPlanReport(ctx, { basePath: "plan.json", nextPath: "plan.json", json: true });
      paperSimulationDiffResultReport(ctx, { basePath: "result.json", nextPath: "result.json", json: true });
      paperSimulationHandoffReport(ctx, { ...HANDOFF_OPTS, json: true });
      expect(readdirSync(tmp).sort()).toEqual(before);
      // Overwrite refusal on every extended output; --force succeeds.
      expect(paperSimulationReadinessReport(ctx, { auditPath: "audit.json", planPath: "plan.json", resultPath: "result.json", evidence: [...EVIDENCE], outPath: "readiness.json" }).exitCode).toBe(1);
      expect(paperSimulationDiffPlanReport(ctx, { basePath: "plan.json", nextPath: "plan.json", outPath: "plan-diff.json" }).exitCode).toBe(1);
      expect(paperSimulationDiffResultReport(ctx, { basePath: "result.json", nextPath: "result.json", outPath: "result-diff.json" }).exitCode).toBe(1);
      expect(paperSimulationHandoffReport(ctx, { ...HANDOFF_OPTS, outPath: "handoff.json" }).exitCode).toBe(1);
      expect(paperSimulationHandoffReport(ctx, { ...HANDOFF_OPTS, outPath: "handoff.json", force: true }).exitCode).toBe(0);
    });
  });

  it("a kill-switch STOP at plan time propagates into the diff and the handoff (fails closed)", () => {
    withTmp((tmp) => {
      const ctx = { cwd: tmp, env: {} };
      runFullPipeline(tmp);
      // Rebuild the plan under a declared STOP, then diff old vs stopped.
      paperSimulationIntentPlanReport(ctx, { ...PLAN_OPTS, stopSimulationTripped: true, outPath: "plan-stop.json" });
      const diffR = paperSimulationDiffPlanReport(ctx, { basePath: "plan.json", nextPath: "plan-stop.json", json: true, failOnDiff: true });
      expect(diffR.exitCode).toBe(1);
      const diff = validateSimulationIntentPlanDiffV2(JSON.parse(diffR.text));
      expect(diff.newlyBlocked).toBe(true);
      expect(diff.blockingCodesAdded).toContain("simulation-blocked-kill-switch-stop");
      // A handoff over the stopped plan carries the stop code verbatim and gates on blocking.
      const handoffR = paperSimulationHandoffReport(ctx, { ...HANDOFF_OPTS, intentPlanPath: "plan-stop.json", json: true, failOnBlocking: true });
      expect(handoffR.exitCode).toBe(1);
      const pack = validatePhase6SimulationHandoffPackV1(JSON.parse(handoffR.text));
      expect(pack.chainBlockingCodes).toContain("simulation-blocked-kill-switch-stop");
    });
  });

  it("v1/wrong-schema artifacts fail closed in the diff and handoff commands", () => {
    withTmp((tmp) => {
      const ctx = { cwd: tmp, env: {} };
      runFullPipeline(tmp);
      // A result is not a plan: the plan diff refuses outright.
      expect(paperSimulationDiffPlanReport(ctx, { basePath: "plan.json", nextPath: "result.json" }).exitCode).toBe(1);
      // A flipped lock on the handoff's readiness input is CLASSIFIED invalid (never accepted).
      const readiness = readJson(tmp, "readiness.json") as Record<string, unknown>;
      writeFileSync(join(tmp, "evil-readiness.json"), JSON.stringify({ ...readiness, phase7LiveTradingReady: true }, null, 2));
      const r = paperSimulationHandoffReport(ctx, { ...HANDOFF_OPTS, readinessPath: "evil-readiness.json", json: true });
      expect(r.exitCode).toBe(0);
      const pack = validatePhase6SimulationHandoffPackV1(JSON.parse(r.text));
      expect(pack.invalidRoles).toContain("readiness-report");
      expect(pack.simulationReadyPerReadiness).toBeNull(); // never trusted from an invalid artifact
    });
  });

  it("secret hygiene holds over the extended artifacts too", () => {
    withTmp((tmp) => {
      runFullPipeline(tmp);
      for (const f of EXTENDED_FILES) {
        const text = readFileSync(join(tmp, f), "utf8");
        expect(/"(privateKey|secretKey|mnemonic|seedPhrase|keypair|passphrase)"/i.test(text), `${f} carries a secret-bearing key`).toBe(false);
      }
    });
  });
});
