/**
 * Sprint 68 — END-TO-END Phase 6 fixture chain through the REAL CLI command functions.
 *
 * The base chain is FICTIONAL and built by the PRODUCTION sniper builders (the simulation
 * package's fixture helpers), written into a temp dir, then driven through the actual commands:
 * intent plan → result → validate → chain audit. Proves, with production validators:
 *
 *   - the whole Phase 6 surface coheres end to end (plan unblocked, result honest, audit clean);
 *   - byte determinism (two full runs produce byte-identical artifacts);
 *   - no command writes anything by default;
 *   - no fixture or generated artifact carries a secret-shaped key or value;
 *   - the chain FAILS CLOSED: a kill-switch stop blocks plan AND result; a v1 decision blocks the
 *     plan and fails the audit; a draft spec blocks; a flipped literal lock is refused everywhere.
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
} from "@soulmaker/simulation";
import {
  paperSimulationIntentPlanReport,
  paperSimulationResultReport,
  paperSimulationValidateReport,
  paperSimulationAuditReport,
} from "./commands.js";

const CHAIN_FILES = ["dec2.json", "run2.json", "gates2.json", "prereqs2.json", "ks.json", "sp.json", "bi.json"] as const;
const GENERATED_FILES = ["plan.json", "result.json", "audit.json"] as const;

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

/** Run the full Phase 6 pipeline through the real commands; assert every exit code. */
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
