/**
 * Tests for the Sprint 28 SNIPER WORKFLOW PLAN operator helper. All inputs are INJECTED per-stage
 * states (present? valid?). The plan only describes the recommended sequence — it executes nothing.
 */

import { describe, it, expect } from "vitest";
import { REDACTED } from "@soulmaker/security";
import {
  buildSniperWorkflowPlan,
  validateSniperWorkflowPlan,
  formatSniperWorkflowPlan,
  SniperWorkflowPlanError,
  SNIPER_WORKFLOW_PLAN_SCHEMA_VERSION,
  SNIPER_WORKFLOW_PLAN_BANNER,
  type SniperWorkflowPlan,
} from "./workflow.js";

const present = (path: string, valid: boolean | null, detail?: string) => ({ path, present: true, valid, detail });
const missing = (path: string | null = null) => ({ path, present: false, valid: null });

describe("buildSniperWorkflowPlan — stage status", () => {
  it("marks candidates READY and preflight/decide BLOCKED when nothing exists", () => {
    const plan = buildSniperWorkflowPlan({});
    expect(plan.stages.map((s) => s.status)).toEqual(["ready", "blocked", "blocked"]);
    expect(plan.nextStage).toBe("candidates");
    expect(plan.nextCommand).toMatch(/paper:sniper:candidates:validate/);
    expect(plan.complete).toBe(false);
    expect(() => validateSniperWorkflowPlan(plan)).not.toThrow();
  });

  it("unblocks preflight + decide once candidates are done", () => {
    const plan = buildSniperWorkflowPlan({ candidates: present("c.json", true, "2 candidates") });
    expect(plan.stages[0]!.status).toBe("done");
    expect(plan.stages[1]!.status).toBe("ready"); // preflight
    expect(plan.stages[2]!.status).toBe("ready"); // decide (preflight recommended, not required)
    expect(plan.nextStage).toBe("preflight");
  });

  it("advances next to decide when candidates + preflight are done", () => {
    const plan = buildSniperWorkflowPlan({
      candidates: present("c.json", true),
      preflight: present("p.json", true),
    });
    expect(plan.stages.map((s) => s.status)).toEqual(["done", "done", "ready"]);
    expect(plan.nextStage).toBe("decide");
    expect(plan.nextCommand).toMatch(/paper:sniper:decide/);
  });

  it("is complete when all three are done", () => {
    const plan = buildSniperWorkflowPlan({
      candidates: present("c.json", true),
      preflight: present("p.json", true),
      decide: present("d.json", true),
    });
    expect(plan.complete).toBe(true);
    expect(plan.doneCount).toBe(3);
    expect(plan.nextStage).toBeNull();
    expect(plan.nextCommand).toBeNull();
  });

  it("BLOCKS on an invalid present artifact and flags hasInvalidArtifact", () => {
    const plan = buildSniperWorkflowPlan({ candidates: present("c.json", false, "wrong schema") });
    expect(plan.stages[0]!.status).toBe("blocked");
    expect(plan.hasInvalidArtifact).toBe(true);
    expect(plan.nextStage).toBe("candidates");
    expect(plan.stages[0]!.reasons.some((r) => /invalid/.test(r))).toBe(true);
  });

  it("blocks preflight when candidates are present-but-unvalidated (not done)", () => {
    const plan = buildSniperWorkflowPlan({ candidates: { path: "c.json", present: true, valid: null } });
    expect(plan.stages[0]!.status).toBe("ready"); // present but not validated -> still actionable
    expect(plan.stages[1]!.status).toBe("blocked");
  });

  it("echoes the operator's chosen paths into the commands", () => {
    const plan = buildSniperWorkflowPlan({
      candidates: present("my-cands.json", true),
      preflight: missing("my-pf.json"),
      decide: missing("my-dec.json"),
    });
    expect(plan.stages[1]!.command).toContain("my-cands.json");
    expect(plan.stages[1]!.command).toContain("my-pf.json");
    expect(plan.stages[2]!.command).toContain("my-dec.json");
  });
});

describe("buildSniperWorkflowPlan — determinism + rejection", () => {
  it("is byte-stable and carries no timestamp", () => {
    const input = { candidates: present("c.json", true), preflight: missing() };
    const first = JSON.stringify(buildSniperWorkflowPlan(input));
    const second = JSON.stringify(buildSniperWorkflowPlan(input));
    expect(first).toBe(second);
    expect(first).not.toMatch(/"generatedAt"|"createdAt"|"timestamp"|"ranAt"/);
  });

  it("does not mutate its input", () => {
    const input = { candidates: present("c.json", true) };
    const before = JSON.stringify(input);
    buildSniperWorkflowPlan(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("rejects a malformed stage state", () => {
    expect(() => buildSniperWorkflowPlan({ candidates: { path: 5 as unknown as string, present: true, valid: null } })).toThrow(
      SniperWorkflowPlanError,
    );
    expect(() => buildSniperWorkflowPlan({ candidates: { path: "c.json", present: "yes" as unknown as boolean, valid: null } })).toThrow(
      /present must be a boolean/,
    );
  });
});

describe("validateSniperWorkflowPlan", () => {
  const sample = () => buildSniperWorkflowPlan({ candidates: present("c.json", true), preflight: present("p.json", true) });

  it("accepts a freshly-built plan (round-trips through JSON)", () => {
    expect(() => validateSniperWorkflowPlan(JSON.parse(JSON.stringify(sample())))).not.toThrow();
  });

  it("rejects a wrong schemaVersion and a non-object", () => {
    expect(() => validateSniperWorkflowPlan(null)).toThrow(SniperWorkflowPlanError);
    const p = JSON.parse(JSON.stringify(sample())) as { schemaVersion: string };
    p.schemaVersion = "sniper.workflow.plan.v2";
    expect(() => validateSniperWorkflowPlan(p)).toThrow(/schemaVersion/);
  });

  it("rejects a stage with an invalid status", () => {
    const p = JSON.parse(JSON.stringify(sample())) as SniperWorkflowPlan;
    (p.stages[0] as unknown as { status: string }).status = "running";
    expect(() => validateSniperWorkflowPlan(p)).toThrow(/status must be/);
  });
});

describe("formatSniperWorkflowPlan", () => {
  it("renders a stable, sectioned PAPER-ONLY human plan with a NEXT command", () => {
    const plan = buildSniperWorkflowPlan({ candidates: present("c.json", true) });
    const text = formatSniperWorkflowPlan(plan);
    expect(text).toBe(formatSniperWorkflowPlan(plan)); // deterministic
    expect(text).toContain(SNIPER_WORKFLOW_PLAN_BANNER);
    expect(text).toContain("PAPER ONLY");
    expect(text).toContain("Stages:");
    expect(text).toContain("Next: soulmaker paper:sniper:preflight");
    expect(text.toLowerCase()).toContain("executes no stage");
    expect(plan.schemaVersion).toBe(SNIPER_WORKFLOW_PLAN_SCHEMA_VERSION);
  });

  it("says 'workflow complete' when every stage is done", () => {
    const plan = buildSniperWorkflowPlan({
      candidates: present("c.json", true),
      preflight: present("p.json", true),
      decide: present("d.json", true),
    });
    expect(formatSniperWorkflowPlan(plan)).toContain("workflow complete");
  });

  it("routes the whole output through the shared redactor", () => {
    const secretish = "a".repeat(64);
    const plan = buildSniperWorkflowPlan({ candidates: present(secretish, true) });
    const text = formatSniperWorkflowPlan(plan, { label: secretish });
    expect(text).toContain(REDACTED);
    expect(text).not.toContain(secretish);
  });
});
