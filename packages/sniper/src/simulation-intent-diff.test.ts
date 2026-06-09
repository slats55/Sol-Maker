/**
 * Tests for the Sprint 42 INERT SIMULATION INTENT PLAN DIFF. All inputs are INJECTED inert plans. The
 * diff is itself inert (executable always false) — comparing two non-executable plans executes nothing.
 */

import { describe, it, expect } from "vitest";
import { REDACTED } from "@soulmaker/security";
import {
  diffSimulationIntentPlans,
  validateSimulationIntentPlanDiff,
  formatSimulationIntentPlanDiff,
  SimulationIntentPlanDiffError,
  SIMULATION_INTENT_PLAN_DIFF_SCHEMA_VERSION,
  SIMULATION_INTENT_PLAN_DIFF_BANNER,
  type SimulationIntentPlanDiff,
} from "./simulation-intent-diff.js";
import { buildSimulationIntentPlan } from "./simulation-intent.js";
import { normalizeSniperCandidateList, type SniperCandidateInput } from "./candidate-list.js";
import { buildSniperTokenPreflightReport, type SniperPreflightCandidateData } from "./token-preflight.js";
import { buildPaperSniperDecisionReport } from "./paper-decision.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

const listOf = (...cands: SniperCandidateInput[]) => normalizeSniperCandidateList({ sourceLabel: "src", candidates: cands });
const cand = (over: Partial<SniperCandidateInput> & { candidateId: string; mint: string }): SniperCandidateInput => over;
const cleanInspection = (mint: string) => ({ mint, decimals: 6, supplyRaw: "1", uiSupply: 1, mintAuthorityPresent: false, freezeAuthorityPresent: false, isInitialized: true, programLabel: "spl-token" });
const riskPass = (mint: string) => ({ mint, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [], summary: [] });

/** A decision report where the given candidate ids all paper-enter (clean pass each). */
function enterDecision(...ids: { id: string; mint: string }[]) {
  const list = listOf(...ids.map((x) => cand({ candidateId: x.id, mint: x.mint })));
  const pf = buildSniperTokenPreflightReport({
    candidateList: list,
    candidateData: ids.map((x) => ({ candidateId: x.id, inspection: cleanInspection(x.mint), risk: riskPass(x.mint) })) as SniperPreflightCandidateData[],
  });
  return buildPaperSniperDecisionReport({ candidateList: list, preflight: pf });
}

const plan = (decision: ReturnType<typeof enterDecision>, opts: { amountLabel?: string; amountUnits?: number } = {}) =>
  buildSimulationIntentPlan({ decisionReport: decision, amountLabel: opts.amountLabel ?? null, amountUnits: opts.amountUnits ?? null });

describe("diffSimulationIntentPlans — membership + amount", () => {
  it("reports added/removed hypothetical entries", () => {
    const base = plan(enterDecision({ id: "a", mint: USDC }));
    const next = plan(enterDecision({ id: "a", mint: USDC }, { id: "b", mint: WSOL }));
    const diff = diffSimulationIntentPlans(base, next);
    expect(diff.schemaVersion).toBe(SIMULATION_INTENT_PLAN_DIFF_SCHEMA_VERSION);
    expect(diff.entriesAdded).toEqual(["b"]);
    expect(diff.entriesRemoved).toEqual([]);
    expect(diff.commonCount).toBe(1);
    expect(diff.hasNewEntry).toBe(true);
    expect(diff.hasChange).toBe(true);
    expect(diff.entryCountDelta).toBe(1);
    expect(diff.executable).toBe(false);
    expect(() => validateSimulationIntentPlanDiff(diff)).not.toThrow();
  });

  it("reports an unchanged pair as no change", () => {
    const d = enterDecision({ id: "a", mint: USDC });
    const diff = diffSimulationIntentPlans(plan(d, { amountLabel: "x", amountUnits: 5 }), plan(d, { amountLabel: "x", amountUnits: 5 }));
    expect(diff.hasChange).toBe(false);
    expect(diff.amountChanges).toEqual([]);
    expect(diff.entryCountDelta).toBe(0);
  });

  it("detects an amount label / unit change over the common set", () => {
    const d = enterDecision({ id: "a", mint: USDC });
    const base = plan(d, { amountLabel: "small", amountUnits: 10 });
    const next = plan(d, { amountLabel: "large", amountUnits: 100 });
    const diff = diffSimulationIntentPlans(base, next);
    expect(diff.hasAmountChange).toBe(true);
    expect(diff.amountChanges[0]).toEqual({ candidateId: "a", fromLabel: "small", toLabel: "large", fromUnits: 10, toUnits: 100 });
  });
});

describe("diffSimulationIntentPlans — determinism + rejection", () => {
  it("is byte-stable and non-mutating", () => {
    const base = plan(enterDecision({ id: "a", mint: USDC }));
    const next = plan(enterDecision({ id: "b", mint: WSOL }));
    const before = JSON.stringify({ base, next });
    const a = JSON.stringify(diffSimulationIntentPlans(base, next));
    const b = JSON.stringify(diffSimulationIntentPlans(base, next));
    expect(a).toBe(b);
    expect(JSON.stringify({ base, next })).toBe(before);
  });

  it("refuses a non-plan input on either side", () => {
    const ok = plan(enterDecision({ id: "a", mint: USDC }));
    expect(() => diffSimulationIntentPlans({ schemaVersion: "x" }, ok)).toThrow(/base intent plan is invalid/);
    expect(() => diffSimulationIntentPlans(ok, { schemaVersion: "x" })).toThrow(/next intent plan is invalid/);
    expect(() => diffSimulationIntentPlans(null, ok)).toThrow(SimulationIntentPlanDiffError);
  });
});

describe("validateSimulationIntentPlanDiff", () => {
  const sample = (): SimulationIntentPlanDiff =>
    diffSimulationIntentPlans(plan(enterDecision({ id: "a", mint: USDC })), plan(enterDecision({ id: "a", mint: USDC }, { id: "b", mint: WSOL })));

  it("accepts a freshly-built diff (round-trips through JSON)", () => {
    expect(() => validateSimulationIntentPlanDiff(JSON.parse(JSON.stringify(sample())))).not.toThrow();
  });

  it("enforces the HARD invariant executable=false and a wrong schemaVersion", () => {
    expect(() => validateSimulationIntentPlanDiff(null)).toThrow(SimulationIntentPlanDiffError);
    const d = JSON.parse(JSON.stringify(sample())) as SimulationIntentPlanDiff;
    (d as unknown as { executable: boolean }).executable = true;
    expect(() => validateSimulationIntentPlanDiff(d)).toThrow(/executable must be false/);
    const d2 = JSON.parse(JSON.stringify(sample())) as { schemaVersion: string };
    d2.schemaVersion = "simulation.intent.plan.diff.v2";
    expect(() => validateSimulationIntentPlanDiff(d2)).toThrow(/schemaVersion/);
  });
});

describe("formatSimulationIntentPlanDiff", () => {
  it("renders a stable, NOT-EXECUTABLE human diff", () => {
    const base = plan(enterDecision({ id: "a", mint: USDC }));
    const next = plan(enterDecision({ id: "a", mint: USDC }, { id: "b", mint: WSOL }));
    const diff = diffSimulationIntentPlans(base, next);
    const text = formatSimulationIntentPlanDiff(diff);
    expect(text).toBe(formatSimulationIntentPlanDiff(diff)); // deterministic
    expect(text).toContain(SIMULATION_INTENT_PLAN_DIFF_BANNER);
    expect(text).toContain("NOT EXECUTABLE");
    expect(text).toContain("Any new entry:     YES");
    expect(text).toContain("executable:        NO");
  });

  it("routes the whole output through the shared redactor", () => {
    const secretish = "a".repeat(64); // 64 hex chars → scrubbed by the redactor's hex-blob pattern
    // The diff formatter prints each side's sourceLabel, which flows from the candidate list's sourceLabel.
    const list = normalizeSniperCandidateList({ sourceLabel: secretish, candidates: [{ candidateId: "a", mint: USDC }] });
    const pf = buildSniperTokenPreflightReport({ candidateList: list, candidateData: [{ candidateId: "a", inspection: cleanInspection(USDC), risk: riskPass(USDC) }] as SniperPreflightCandidateData[] });
    const p = buildSimulationIntentPlan({ decisionReport: buildPaperSniperDecisionReport({ candidateList: list, preflight: pf }) });
    const text = formatSimulationIntentPlanDiff(diffSimulationIntentPlans(p, p));
    expect(text).toContain(REDACTED);
    expect(text).not.toContain(secretish);
  });
});
