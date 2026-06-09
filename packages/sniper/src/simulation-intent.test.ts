/**
 * Tests for the Sprint 41 INERT SIMULATION INTENT PLAN. All inputs are INJECTED decision reports. The
 * plan is DATA ONLY and NOT EXECUTABLE: `executable` is always false, every required approval is
 * unsatisfied, and `requiresExplicitHumanApproval` is always true. Nothing here is an order or a trade
 * signal.
 */

import { describe, it, expect } from "vitest";
import { REDACTED } from "@soulmaker/security";
import {
  buildSimulationIntentPlan,
  validateSimulationIntentPlan,
  formatSimulationIntentPlan,
  SimulationIntentPlanError,
  SIMULATION_INTENT_PLAN_SCHEMA_VERSION,
  SIMULATION_INTENT_PLAN_BANNER,
  type SimulationIntentPlan,
} from "./simulation-intent.js";
import { normalizeSniperCandidateList, type SniperCandidateInput } from "./candidate-list.js";
import { buildSniperTokenPreflightReport, type SniperPreflightCandidateData } from "./token-preflight.js";
import { buildPaperSniperDecisionReport } from "./paper-decision.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

const listOf = (...cands: SniperCandidateInput[]) => normalizeSniperCandidateList({ sourceLabel: "src", candidates: cands });
const cand = (over: Partial<SniperCandidateInput> & { candidateId: string; mint: string }): SniperCandidateInput => over;
const cleanInspection = (mint: string) => ({ mint, decimals: 6, supplyRaw: "1", uiSupply: 1, mintAuthorityPresent: false, freezeAuthorityPresent: false, isInitialized: true, programLabel: "spl-token" });
const riskPass = (mint: string) => ({ mint, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [], summary: [] });
const riskReject = (mint: string) => ({ mint, score: 95, decision: "REJECT", flags: [{ id: "rug", severity: "critical", title: "Rug" }], summary: [] });

/** A decision report with one paper-enter (good) + one paper-reject (bad). */
function decisionWithEnter() {
  const list = listOf(cand({ candidateId: "good", mint: USDC }), cand({ candidateId: "bad", mint: WSOL }));
  const pf = buildSniperTokenPreflightReport({
    candidateList: list,
    candidateData: [
      { candidateId: "good", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
      { candidateId: "bad", risk: riskReject(WSOL) },
    ] as SniperPreflightCandidateData[],
  });
  return buildPaperSniperDecisionReport({ candidateList: list, preflight: pf });
}

describe("buildSimulationIntentPlan — inert entries", () => {
  it("produces one inert entry per paper-enter and is NOT executable", () => {
    const plan = buildSimulationIntentPlan({ decisionReport: decisionWithEnter(), planLabel: "p1" });
    expect(plan.schemaVersion).toBe(SIMULATION_INTENT_PLAN_SCHEMA_VERSION);
    expect(plan.entryCount).toBe(1);
    const e = plan.entries[0]!;
    expect(e.candidateId).toBe("good"); // only the paper-enter
    expect(e.side).toBe("hypothetical-entry");
    expect(e.amountLabel).toBe("unspecified-paper-units");
    expect(e.reasonCodes).toContain("PAPER_ENTER");
    // HARD invariants
    expect(plan.executable).toBe(false);
    expect(plan.requiresExplicitHumanApproval).toBe(true);
    expect(plan.allApprovalsUnsatisfied).toBe(true);
    expect(e.requiredApprovals.every((a) => a.satisfied === false)).toBe(true);
    expect(e.requiredApprovals.length).toBeGreaterThan(0);
    expect(() => validateSimulationIntentPlan(plan)).not.toThrow();
  });

  it("carries an amount LABEL + simulated units, never a currency amount", () => {
    const plan = buildSimulationIntentPlan({ decisionReport: decisionWithEnter(), amountLabel: "small-test", amountUnits: 100 });
    expect(plan.entries[0]!.amountLabel).toBe("small-test");
    expect(plan.entries[0]!.amountUnits).toBe(100);
    // no field implying real funds / currency
    expect(JSON.stringify(plan)).not.toMatch(/"usd"|"sol"|"lamports"|"currency"|"price"/i);
  });

  it("is empty when the decision report has no paper-enter", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const report = buildPaperSniperDecisionReport({ candidateList: list }); // no preflight → watch
    const plan = buildSimulationIntentPlan({ decisionReport: report });
    expect(plan.entryCount).toBe(0);
    expect(plan.executable).toBe(false);
  });
});

describe("buildSimulationIntentPlan — determinism + rejection", () => {
  it("is byte-stable, non-mutating, and carries no timestamp", () => {
    const report = decisionWithEnter();
    const before = JSON.stringify(report);
    const a = JSON.stringify(buildSimulationIntentPlan({ decisionReport: report }));
    const b = JSON.stringify(buildSimulationIntentPlan({ decisionReport: report }));
    expect(a).toBe(b);
    expect(JSON.stringify(report)).toBe(before);
    expect(a).not.toMatch(/"generatedAt"|"createdAt"|"timestamp"|"ranAt"/);
  });

  it("refuses a non-decision-report input and bad amount", () => {
    expect(() => buildSimulationIntentPlan({ decisionReport: { schemaVersion: "x" } })).toThrow(/decision report is invalid/);
    expect(() => buildSimulationIntentPlan({ decisionReport: decisionWithEnter(), amountUnits: -1 })).toThrow(SimulationIntentPlanError);
  });
});

describe("validateSimulationIntentPlan", () => {
  const sample = (): SimulationIntentPlan => buildSimulationIntentPlan({ decisionReport: decisionWithEnter() });

  it("accepts a freshly-built plan (round-trips through JSON)", () => {
    expect(() => validateSimulationIntentPlan(JSON.parse(JSON.stringify(sample())))).not.toThrow();
  });

  it("enforces the HARD invariants (a tampered executable / satisfied approval is refused)", () => {
    const p = JSON.parse(JSON.stringify(sample())) as SimulationIntentPlan;
    (p as unknown as { executable: boolean }).executable = true;
    expect(() => validateSimulationIntentPlan(p)).toThrow(/executable must be false/);
    const p2 = JSON.parse(JSON.stringify(sample())) as SimulationIntentPlan;
    (p2.entries[0]!.requiredApprovals[0] as unknown as { satisfied: boolean }).satisfied = true;
    expect(() => validateSimulationIntentPlan(p2)).toThrow(/satisfied must be false/);
    const p3 = JSON.parse(JSON.stringify(sample())) as SimulationIntentPlan;
    (p3 as unknown as { allApprovalsUnsatisfied: boolean }).allApprovalsUnsatisfied = false;
    expect(() => validateSimulationIntentPlan(p3)).toThrow(/allApprovalsUnsatisfied must be true/);
  });

  it("rejects a wrong schemaVersion and a bad side", () => {
    expect(() => validateSimulationIntentPlan(null)).toThrow(SimulationIntentPlanError);
    const p = JSON.parse(JSON.stringify(sample())) as SimulationIntentPlan;
    (p.entries[0] as unknown as { side: string }).side = "buy";
    expect(() => validateSimulationIntentPlan(p)).toThrow(/side must be/);
  });
});

describe("formatSimulationIntentPlan", () => {
  it("renders a stable, NOT-EXECUTABLE human plan", () => {
    const plan = buildSimulationIntentPlan({ decisionReport: decisionWithEnter() });
    const text = formatSimulationIntentPlan(plan);
    expect(text).toBe(formatSimulationIntentPlan(plan)); // deterministic
    expect(text).toContain(SIMULATION_INTENT_PLAN_BANNER);
    expect(text).toContain("NOT EXECUTABLE");
    expect(text).toContain("executable:                    NO");
    expect(text.toLowerCase()).toContain("all approvals unsatisfied:     yes");
  });

  it("routes the whole output through the shared redactor", () => {
    const secretish = "a".repeat(64);
    const list = normalizeSniperCandidateList({ sourceLabel: secretish, candidates: [{ candidateId: "c1", mint: USDC }] });
    const report = buildPaperSniperDecisionReport({ candidateList: list });
    const text = formatSimulationIntentPlan(buildSimulationIntentPlan({ decisionReport: report, planLabel: secretish }));
    expect(text).toContain(REDACTED);
    expect(text).not.toContain(secretish);
  });
});
