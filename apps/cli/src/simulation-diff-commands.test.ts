/**
 * Sprint 73 — the Phase 6 diff-chain CLI surface:
 * `paper:simulation:diff:plan` / `paper:simulation:diff:result`.
 *
 * Exercised through the real command functions over FICTIONAL chain artifacts written to a temp
 * dir (built by the PRODUCTION builders via @soulmaker/simulation — they can never drift from the
 * code). Covers: identical pair (exit 0), changed pair (exit 0), --fail-on-diff (exit 1 on
 * change, 0 on identical), missing/required inputs, invalid/tampered artifacts (literal-lock flip
 * refused), wrong-schema artifacts, --out / overwrite refusal / --force, no-write-by-default, and
 * validator round-trips of the emitted JSON.
 */

import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildFictionalReadyChain,
  buildSimulationIntentPlanV2,
  buildSimulationResultV1,
  validateSimulationIntentPlanDiffV2,
  validateSimulationResultDiffV1,
  type SimulationIntentPlanV2,
  type SimulationResultV1,
} from "@soulmaker/simulation";
import { paperSimulationDiffPlanReport, paperSimulationDiffResultReport } from "./commands.js";

function buildPlan(extra: Record<string, unknown> = {}): SimulationIntentPlanV2 {
  const chain = buildFictionalReadyChain();
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

interface DiffFixtureDir {
  tmp: string;
  planA: SimulationIntentPlanV2;
  planB: SimulationIntentPlanV2;
  resultA: SimulationResultV1;
  resultB: SimulationResultV1;
}

/** Writes: plan-a/plan-b (b differs: amount label), result-a/result-b (b differs: blocked). */
function withDiffDir<T>(fn: (d: DiffFixtureDir) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "simulation-diff-cli-"));
  const planA = buildPlan();
  const planB = buildPlan({ paperAmountLabel: "10-paper-units" });
  const resultA = buildSimulationResultV1({ plan: planA });
  const resultB = buildSimulationResultV1({ plan: planA, stopSimulationTripped: true });
  writeFileSync(join(tmp, "plan-a.json"), JSON.stringify(planA, null, 2));
  writeFileSync(join(tmp, "plan-a2.json"), JSON.stringify(planA, null, 2));
  writeFileSync(join(tmp, "plan-b.json"), JSON.stringify(planB, null, 2));
  writeFileSync(join(tmp, "result-a.json"), JSON.stringify(resultA, null, 2));
  writeFileSync(join(tmp, "result-a2.json"), JSON.stringify(resultA, null, 2));
  writeFileSync(join(tmp, "result-b.json"), JSON.stringify(resultB, null, 2));
  try {
    return fn({ tmp, planA, planB, resultA, resultB });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe("paper:simulation:diff:plan", () => {
  it("identical pair → identical finding, exit 0, validator round-trip", () => {
    withDiffDir(({ tmp }) => {
      const r = paperSimulationDiffPlanReport({ cwd: tmp }, { basePath: "plan-a.json", nextPath: "plan-a2.json", json: true });
      expect(r.exitCode).toBe(0);
      const diff = validateSimulationIntentPlanDiffV2(JSON.parse(r.text));
      expect(diff.hasChange).toBe(false);
      expect(diff.diffReasonCodes).toEqual(["simulation-diff-plan-identical"]);
    });
  });

  it("changed pair → exit 0 by default; --fail-on-diff gates it to exit 1", () => {
    withDiffDir(({ tmp }) => {
      const plain = paperSimulationDiffPlanReport({ cwd: tmp }, { basePath: "plan-a.json", nextPath: "plan-b.json", json: true });
      expect(plain.exitCode).toBe(0);
      const diff = validateSimulationIntentPlanDiffV2(JSON.parse(plain.text));
      expect(diff.hasChange).toBe(true);
      expect(diff.diffReasonCodes).toContain("simulation-diff-plan-entries-changed");

      const gated = paperSimulationDiffPlanReport(
        { cwd: tmp },
        { basePath: "plan-a.json", nextPath: "plan-b.json", failOnDiff: true },
      );
      expect(gated.exitCode).toBe(1);

      const gatedIdentical = paperSimulationDiffPlanReport(
        { cwd: tmp },
        { basePath: "plan-a.json", nextPath: "plan-a2.json", failOnDiff: true },
      );
      expect(gatedIdentical.exitCode).toBe(0);
    });
  });

  it("formatted output keeps the comparison-only framing", () => {
    withDiffDir(({ tmp }) => {
      const r = paperSimulationDiffPlanReport({ cwd: tmp }, { basePath: "plan-a.json", nextPath: "plan-b.json" });
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain("PREVIEW COMPARISON ONLY");
      expect(r.text).toContain("does not sign");
      expect(r.text).toContain("does not authorize live trading");
    });
  });

  it("missing --base/--next refuses; a named-but-missing file refuses; bad JSON refuses", () => {
    withDiffDir(({ tmp }) => {
      expect(paperSimulationDiffPlanReport({ cwd: tmp }, {}).exitCode).toBe(1);
      expect(paperSimulationDiffPlanReport({ cwd: tmp }, { basePath: "plan-a.json" }).exitCode).toBe(1);
      const missing = paperSimulationDiffPlanReport({ cwd: tmp }, { basePath: "plan-a.json", nextPath: "nope.json" });
      expect(missing.exitCode).toBe(1);
      expect(missing.text).toContain("Refusing:");
      writeFileSync(join(tmp, "garbage.json"), "{not json");
      expect(paperSimulationDiffPlanReport({ cwd: tmp }, { basePath: "garbage.json", nextPath: "plan-a.json" }).exitCode).toBe(1);
    });
  });

  it("a tampered literal lock refuses; a wrong-schema artifact refuses", () => {
    withDiffDir(({ tmp, planA }) => {
      const tampered = JSON.parse(JSON.stringify(planA)) as Record<string, unknown>;
      tampered.neverSigns = false;
      writeFileSync(join(tmp, "tampered.json"), JSON.stringify(tampered, null, 2));
      const r = paperSimulationDiffPlanReport({ cwd: tmp }, { basePath: "tampered.json", nextPath: "plan-a.json" });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("Refusing:");
      // A result artifact is not an intent plan.
      const wrong = paperSimulationDiffPlanReport({ cwd: tmp }, { basePath: "plan-a.json", nextPath: "result-a.json" });
      expect(wrong.exitCode).toBe(1);
      expect(wrong.text).toContain("Refusing:");
    });
  });

  it("writes nothing by default; --out writes ONLY the diff; overwrite refused without --force", () => {
    withDiffDir(({ tmp }) => {
      const before = readdirSync(tmp).length;
      paperSimulationDiffPlanReport({ cwd: tmp }, { basePath: "plan-a.json", nextPath: "plan-b.json" });
      expect(readdirSync(tmp).length).toBe(before);

      const out = paperSimulationDiffPlanReport(
        { cwd: tmp },
        { basePath: "plan-a.json", nextPath: "plan-b.json", outPath: "diff.json" },
      );
      expect(out.exitCode).toBe(0);
      expect(existsSync(join(tmp, "diff.json"))).toBe(true);
      const onDisk = validateSimulationIntentPlanDiffV2(JSON.parse(readFileSync(join(tmp, "diff.json"), "utf8")));
      expect(onDisk.hasChange).toBe(true);

      const refused = paperSimulationDiffPlanReport(
        { cwd: tmp },
        { basePath: "plan-a.json", nextPath: "plan-b.json", outPath: "diff.json" },
      );
      expect(refused.exitCode).toBe(1);
      expect(refused.text).toContain("already exists");

      const forced = paperSimulationDiffPlanReport(
        { cwd: tmp },
        { basePath: "plan-a.json", nextPath: "plan-a2.json", outPath: "diff.json", force: true },
      );
      expect(forced.exitCode).toBe(0);
      const rewritten = validateSimulationIntentPlanDiffV2(JSON.parse(readFileSync(join(tmp, "diff.json"), "utf8")));
      expect(rewritten.hasChange).toBe(false);
    });
  });
});

describe("paper:simulation:diff:result", () => {
  it("identical pair → identical finding, exit 0, validator round-trip", () => {
    withDiffDir(({ tmp }) => {
      const r = paperSimulationDiffResultReport(
        { cwd: tmp },
        { basePath: "result-a.json", nextPath: "result-a2.json", json: true },
      );
      expect(r.exitCode).toBe(0);
      const diff = validateSimulationResultDiffV1(JSON.parse(r.text));
      expect(diff.hasChange).toBe(false);
      expect(diff.diffReasonCodes).toEqual(["simulation-diff-result-identical"]);
    });
  });

  it("changed pair (skipped → blocked) → findings surfaced; --fail-on-diff exits 1", () => {
    withDiffDir(({ tmp }) => {
      const plain = paperSimulationDiffResultReport(
        { cwd: tmp },
        { basePath: "result-a.json", nextPath: "result-b.json", json: true },
      );
      expect(plain.exitCode).toBe(0);
      const diff = validateSimulationResultDiffV1(JSON.parse(plain.text));
      expect(diff.hasChange).toBe(true);
      expect(diff.newlyBlocked).toBe(true);
      expect(diff.diffReasonCodes).toContain("simulation-diff-result-newly-blocked");

      const gated = paperSimulationDiffResultReport(
        { cwd: tmp },
        { basePath: "result-a.json", nextPath: "result-b.json", failOnDiff: true },
      );
      expect(gated.exitCode).toBe(1);
    });
  });

  it("formatted output keeps the dry-run-record framing", () => {
    withDiffDir(({ tmp }) => {
      const r = paperSimulationDiffResultReport({ cwd: tmp }, { basePath: "result-a.json", nextPath: "result-b.json" });
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain("DRY-RUN RECORD COMPARISON ONLY");
      expect(r.text).toContain("not an execution");
      expect(r.text).toContain("does not send");
    });
  });

  it("missing inputs, invalid artifacts, and wrong-schema artifacts refuse", () => {
    withDiffDir(({ tmp, resultA }) => {
      expect(paperSimulationDiffResultReport({ cwd: tmp }, {}).exitCode).toBe(1);
      expect(paperSimulationDiffResultReport({ cwd: tmp }, { basePath: "result-a.json", nextPath: "nope.json" }).exitCode).toBe(1);
      const tampered = JSON.parse(JSON.stringify(resultA)) as Record<string, unknown>;
      tampered.dryRunOnly = false;
      writeFileSync(join(tmp, "tampered-result.json"), JSON.stringify(tampered, null, 2));
      expect(
        paperSimulationDiffResultReport({ cwd: tmp }, { basePath: "tampered-result.json", nextPath: "result-a.json" }).exitCode,
      ).toBe(1);
      // An intent plan is not a result.
      expect(
        paperSimulationDiffResultReport({ cwd: tmp }, { basePath: "result-a.json", nextPath: "plan-a.json" }).exitCode,
      ).toBe(1);
    });
  });

  it("writes nothing by default; --out / overwrite refusal / --force behave", () => {
    withDiffDir(({ tmp }) => {
      const before = readdirSync(tmp).length;
      paperSimulationDiffResultReport({ cwd: tmp }, { basePath: "result-a.json", nextPath: "result-b.json" });
      expect(readdirSync(tmp).length).toBe(before);

      const out = paperSimulationDiffResultReport(
        { cwd: tmp },
        { basePath: "result-a.json", nextPath: "result-b.json", outPath: "rdiff.json" },
      );
      expect(out.exitCode).toBe(0);
      validateSimulationResultDiffV1(JSON.parse(readFileSync(join(tmp, "rdiff.json"), "utf8")));

      const refused = paperSimulationDiffResultReport(
        { cwd: tmp },
        { basePath: "result-a.json", nextPath: "result-b.json", outPath: "rdiff.json" },
      );
      expect(refused.exitCode).toBe(1);

      const forced = paperSimulationDiffResultReport(
        { cwd: tmp },
        { basePath: "result-a.json", nextPath: "result-b.json", outPath: "rdiff.json", force: true },
      );
      expect(forced.exitCode).toBe(0);
    });
  });

  it("the emitted JSON is byte-deterministic for the same pair", () => {
    withDiffDir(({ tmp }) => {
      const r1 = paperSimulationDiffResultReport(
        { cwd: tmp },
        { basePath: "result-a.json", nextPath: "result-b.json", json: true },
      );
      const r2 = paperSimulationDiffResultReport(
        { cwd: tmp },
        { basePath: "result-a.json", nextPath: "result-b.json", json: true },
      );
      expect(r1.text).toBe(r2.text);
    });
  });
});
