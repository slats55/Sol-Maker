/**
 * Sprints 63/64 — `simulation.intent.plan.v2`: fail-closed builder, strict validator, formatter.
 *
 * The fixture chains are FICTIONAL and built entirely through the PRODUCTION `@soulmaker/sniper`
 * builders (see fixtures.ts), so these tests exercise the real validators end to end.
 */

import { describe, it, expect } from "vitest";
import {
  buildSimulationIntentPlanV2,
  validateSimulationIntentPlanV2,
  formatSimulationIntentPlanV2,
  SimulationIntentPlanV2Error,
  SimulationSafetyError,
  type BuildSimulationIntentPlanV2Input,
  type SimulationIntentPlanV2,
} from "./index.js";
import { buildFictionalReadyChain, buildFictionalWatchOnlyChain } from "./fixtures.js";

/** The full happy-path input: the ready chain + the explicit operator acknowledgment. */
function readyInput(): BuildSimulationIntentPlanV2Input {
  const chain = buildFictionalReadyChain();
  return {
    decision: chain.decision,
    safetyGates: chain.gates,
    prereqs: chain.prereqs,
    killSwitchSpec: chain.killSwitchSpec,
    secretsPolicy: chain.secretsPolicy,
    burnerIsolationSpec: chain.burnerIsolationSpec,
    operatorAcknowledgedPaperEnterReview: true,
    operatorLabel: "fictional-operator",
    planLabel: "fictional-plan",
  };
}

describe("simulation intent plan v2 — fixture chain sanity", () => {
  it("the ready chain has paper-enters, READY gates, and exactly NO_OPERATOR_BLOCKING unmet", () => {
    const chain = buildFictionalReadyChain();
    expect(chain.decision.paperEnterCount).toBe(2);
    expect(chain.gates.ready).toBe(true);
    expect(chain.prereqs.phase6ImplementationReady).toBe(false);
    expect(chain.prereqs.notMet).toEqual(["NO_OPERATOR_BLOCKING"]);
    expect(chain.auditLog.hasFailure).toBe(false);
  });

  it("the watch-only chain has no paper-enter and FULLY met prereqs", () => {
    const chain = buildFictionalWatchOnlyChain();
    expect(chain.decision.paperEnterCount).toBe(0);
    expect(chain.gates.ready).toBe(true);
    expect(chain.prereqs.phase6ImplementationReady).toBe(true);
    expect(chain.runReport.operatorBlockingReasons).toEqual([]);
  });
});

describe("simulation intent plan v2 — happy paths", () => {
  it("builds an unblocked plan with one preview entry per paper-enter (acknowledgment applied)", () => {
    const plan = buildSimulationIntentPlanV2(readyInput());
    expect(plan.blocked).toBe(false);
    expect(plan.blockingReasonCodes).toEqual([]);
    expect(plan.entryCount).toBe(2);
    expect(plan.paperEnterReviewAcknowledgmentApplied).toBe(true);
    expect(plan.warningReasonCodes).toContain("simulation-operator-acknowledged-paper-enter-review");
    expect(plan.outcomeReasonCodes).toEqual(["simulation-plan-ready"]);
    expect(plan.decisionSummary?.paperEnterCount).toBe(2);
    expect(plan.readinessSummary.gatesReady).toBe(true);
    expect(plan.specAdoptionSummary.killSwitchAdopted).toBe(true);
    expect(() => validateSimulationIntentPlanV2(plan)).not.toThrow();
  });

  it("NEVER invents a destination, amount, or fee — previews stay unresolved with null labels", () => {
    const plan = buildSimulationIntentPlanV2(readyInput());
    for (const e of plan.entries) {
      expect(e.previewStatus).toBe("unresolved");
      expect(e.destinationPreview).toEqual({ status: "unresolved", label: null });
      expect(e.amountPreview).toEqual({ status: "unresolved", label: null });
      expect(e.feePreview).toEqual({ status: "unresolved", label: null });
      expect(e.unresolvedFields).toEqual(["destination", "amount", "fee"]);
      expect(e.reasonCodes).toContain("simulation-preview-unresolved-destination");
      expect(e.reasonCodes).toContain("simulation-preview-unresolved-amount");
      expect(e.reasonCodes).toContain("simulation-preview-unresolved-fee");
    }
    expect(plan.unresolvedEntryCount).toBe(2);
  });

  it("resolves the amount ONLY as the operator's paper-unit label (never currency)", () => {
    const plan = buildSimulationIntentPlanV2({ ...readyInput(), paperAmountLabel: "10-paper-units" });
    for (const e of plan.entries) {
      expect(e.amountPreview).toEqual({ status: "resolved-as-label", label: "10-paper-units" });
      expect(e.unresolvedFields).toEqual(["destination", "fee"]);
    }
    expect(() => validateSimulationIntentPlanV2(plan)).not.toThrow();
  });

  it("builds an unblocked ZERO-entry plan from the fully-met watch-only chain (no acknowledgment needed)", () => {
    const chain = buildFictionalWatchOnlyChain();
    const plan = buildSimulationIntentPlanV2({
      decision: chain.decision,
      safetyGates: chain.gates,
      prereqs: chain.prereqs,
      killSwitchSpec: chain.killSwitchSpec,
      secretsPolicy: chain.secretsPolicy,
      burnerIsolationSpec: chain.burnerIsolationSpec,
    });
    expect(plan.blocked).toBe(false);
    expect(plan.entryCount).toBe(0);
    expect(plan.paperEnterReviewAcknowledgmentApplied).toBe(false);
    expect(plan.warningReasonCodes).toEqual([]);
    expect(() => validateSimulationIntentPlanV2(plan)).not.toThrow();
  });

  it("is deterministic: two builds are deep-equal and JSON-identical", () => {
    const a = buildSimulationIntentPlanV2(readyInput());
    const b = buildSimulationIntentPlanV2(readyInput());
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe("simulation intent plan v2 — fail-closed refusal matrix", () => {
  const block = (mutate: (i: BuildSimulationIntentPlanV2Input) => void): SimulationIntentPlanV2 => {
    const input = readyInput();
    mutate(input);
    const plan = buildSimulationIntentPlanV2(input);
    expect(plan.blocked).toBe(true);
    expect(plan.entries).toEqual([]);
    expect(plan.entryCount).toBe(0);
    expect(() => validateSimulationIntentPlanV2(plan)).not.toThrow();
    return plan;
  };

  it("missing decision blocks", () => {
    const plan = block((i) => delete i.decision);
    expect(plan.blockingReasonCodes).toContain("simulation-blocked-missing-decision-v2");
  });

  it("a v1 decision blocks with the v1-artifact code", () => {
    const plan = block((i) => {
      i.decision = { ...(i.decision as Record<string, unknown>), schemaVersion: "sniper.paper.decision.report.v1" };
    });
    expect(plan.blockingReasonCodes).toContain("simulation-blocked-v1-artifact");
  });

  it("an invalid v2 decision blocks", () => {
    const plan = block((i) => {
      i.decision = { ...(i.decision as Record<string, unknown>), decisions: "corrupted" };
    });
    expect(plan.blockingReasonCodes).toContain("simulation-blocked-invalid-decision-v2");
  });

  it("missing safety gates block", () => {
    const plan = block((i) => delete i.safetyGates);
    expect(plan.blockingReasonCodes).toContain("simulation-blocked-missing-safety-gates-v2");
  });

  it("NOT-ready safety gates block", () => {
    const plan = block((i) => {
      const chain = buildFictionalReadyChain();
      // Rebuild the gates with the decision withheld — a required gate fails, ready=false.
      i.safetyGates = rebuildGatesWithoutDecision(chain);
    });
    expect(plan.blockingReasonCodes).toContain("simulation-blocked-gates-not-ready");
  });

  it("missing prereqs block", () => {
    const plan = block((i) => delete i.prereqs);
    expect(plan.blockingReasonCodes).toContain("simulation-blocked-missing-prereqs-v2");
  });

  it("not-ready prereqs WITHOUT the acknowledgment block", () => {
    const plan = block((i) => {
      i.operatorAcknowledgedPaperEnterReview = false;
    });
    expect(plan.blockingReasonCodes).toContain("simulation-blocked-prereqs-not-ready");
  });

  it("the acknowledgment is REFUSED when more than NO_OPERATOR_BLOCKING is unmet", () => {
    const plan = block((i) => {
      // Prereqs rebuilt WITHOUT the audit log: AUDIT bucket unmet too — the ack must not apply.
      const chain = buildFictionalReadyChain();
      i.prereqs = rebuildPrereqsWithoutAudit(chain);
      i.operatorAcknowledgedPaperEnterReview = true;
    });
    expect(plan.blockingReasonCodes).toContain("simulation-blocked-prereqs-not-ready");
    expect(plan.paperEnterReviewAcknowledgmentApplied).toBe(false);
  });

  it("missing kill-switch spec blocks; a DRAFT spec blocks as not-adopted", () => {
    expect(block((i) => delete i.killSwitchSpec).blockingReasonCodes).toContain("simulation-blocked-missing-kill-switch-spec");
    const plan = block((i) => {
      i.killSwitchSpec = draftKillSwitchSpec();
    });
    expect(plan.blockingReasonCodes).toContain("simulation-blocked-kill-switch-not-adopted");
  });

  it("missing secrets policy blocks; a DRAFT policy blocks as not-adopted", () => {
    expect(block((i) => delete i.secretsPolicy).blockingReasonCodes).toContain("simulation-blocked-missing-secrets-policy");
    const plan = block((i) => {
      i.secretsPolicy = draftSecretsPolicy();
    });
    expect(plan.blockingReasonCodes).toContain("simulation-blocked-secrets-policy-not-adopted");
  });

  it("missing burner isolation blocks; a DRAFT spec blocks as not-adopted", () => {
    expect(block((i) => delete i.burnerIsolationSpec).blockingReasonCodes).toContain("simulation-blocked-missing-burner-isolation");
    const plan = block((i) => {
      i.burnerIsolationSpec = draftBurnerIsolationSpec();
    });
    expect(plan.blockingReasonCodes).toContain("simulation-blocked-burner-isolation-not-adopted");
  });

  it("an invalid (corrupted) spec blocks with the invalid code", () => {
    const plan = block((i) => {
      i.killSwitchSpec = { ...(i.killSwitchSpec as Record<string, unknown>), performsNoProcessControl: false };
    });
    expect(plan.blockingReasonCodes).toContain("simulation-blocked-invalid-kill-switch-spec");
  });

  it("a declared stop-simulation kill switch blocks EVERYTHING", () => {
    const plan = block((i) => {
      i.stopSimulationTripped = true;
    });
    expect(plan.blockingReasonCodes).toContain("simulation-blocked-kill-switch-stop");
    expect(plan.specAdoptionSummary.stopSimulationDeclaredTripped).toBe(true);
  });

  it("with NOTHING supplied, every missing code appears (full fail-closed sweep)", () => {
    const plan = buildSimulationIntentPlanV2({});
    expect(plan.blocked).toBe(true);
    for (const code of [
      "simulation-blocked-missing-decision-v2",
      "simulation-blocked-missing-safety-gates-v2",
      "simulation-blocked-missing-prereqs-v2",
      "simulation-blocked-missing-kill-switch-spec",
      "simulation-blocked-missing-secrets-policy",
      "simulation-blocked-missing-burner-isolation",
    ]) {
      expect(plan.blockingReasonCodes).toContain(code);
    }
  });

  it("throws ONLY on a malformed input shape", () => {
    expect(() => buildSimulationIntentPlanV2({ operatorLabel: 42 as never })).toThrow(SimulationIntentPlanV2Error);
    expect(() => buildSimulationIntentPlanV2({ stopSimulationTripped: "yes" as never })).toThrow(SimulationIntentPlanV2Error);
    expect(() => buildSimulationIntentPlanV2(null as never)).toThrow(SimulationIntentPlanV2Error);
  });
});

describe("simulation intent plan v2 — validator backstop", () => {
  const validPlan = (): SimulationIntentPlanV2 =>
    JSON.parse(JSON.stringify(buildSimulationIntentPlanV2(readyInput()))) as SimulationIntentPlanV2;

  it("round-trips a JSON-serialized plan", () => {
    expect(() => validateSimulationIntentPlanV2(validPlan())).not.toThrow();
  });

  it.each([["neverAuthorizesLiveTrading"], ["neverSigns"], ["neverSends"], ["dryRunOnly"]])(
    "refuses a plan whose %s literal lock is flipped",
    (key) => {
      const plan = { ...validPlan(), [key]: false };
      expect(() => validateSimulationIntentPlanV2(plan)).toThrow(SimulationSafetyError);
    },
  );

  it("refuses a blocked plan that smuggles entries", () => {
    const plan = validPlan();
    (plan as { blocked: boolean }).blocked = true;
    (plan.blockingReasonCodes as string[]).push("simulation-blocked-kill-switch-stop");
    expect(() => validateSimulationIntentPlanV2(plan)).toThrow(/ZERO entries/);
  });

  it("refuses blocked/blocking inconsistency", () => {
    const plan = validPlan();
    (plan as { blocked: boolean }).blocked = true; // blocked without any blocking code
    expect(() => validateSimulationIntentPlanV2(plan)).toThrow(/blocking codes/);
  });

  it("refuses a non-blocking code in blockingReasonCodes (and vice versa)", () => {
    const a = validPlan();
    (a.blockingReasonCodes as string[]).push("simulation-preview-unresolved-fee");
    (a as { blocked: boolean }).blocked = true;
    expect(() => validateSimulationIntentPlanV2(a)).toThrow(/non-blocking/);
    const b = validPlan();
    (b.warningReasonCodes as string[]).push("simulation-blocked-kill-switch-stop");
    expect(() => validateSimulationIntentPlanV2(b)).toThrow(/non-warning/);
  });

  it("refuses an acknowledgment field that disagrees with its warning code", () => {
    const plan = validPlan();
    (plan as { paperEnterReviewAcknowledgmentApplied: boolean }).paperEnterReviewAcknowledgmentApplied = false;
    expect(() => validateSimulationIntentPlanV2(plan)).toThrow(/move together/);
  });

  it("refuses a tampered unresolved-fields list or count", () => {
    const plan = validPlan();
    plan.entries[0]!.unresolvedFields = ["destination"]; // amount+fee really unresolved
    expect(() => validateSimulationIntentPlanV2(plan)).toThrow(/unresolvedFields/);
    const plan2 = validPlan();
    (plan2 as { unresolvedEntryCount: number }).unresolvedEntryCount = 0;
    expect(() => validateSimulationIntentPlanV2(plan2)).toThrow(/recomputed tally/);
  });

  it("refuses an invented preview value on an unresolved field", () => {
    const plan = validPlan();
    plan.entries[0]!.destinationPreview = { status: "unresolved", label: "fake-pool-address" } as never;
    expect(() => validateSimulationIntentPlanV2(plan)).toThrow(/label must be null when unresolved/);
  });

  it("refuses the wrong schemaVersion and a missing source role", () => {
    expect(() => validateSimulationIntentPlanV2({ ...validPlan(), schemaVersion: "simulation.intent.plan.v1" })).toThrow(
      /schemaVersion/,
    );
    const plan = validPlan();
    plan.sourceArtifactRefs.pop();
    expect(() => validateSimulationIntentPlanV2(plan)).toThrow(/source roles/);
  });
});

describe("simulation intent plan v2 — formatter", () => {
  it("an unblocked plan's output is preview-only, safety-locked, and hype-free", () => {
    const text = formatSimulationIntentPlanV2(buildSimulationIntentPlanV2(readyInput()));
    expect(text).toContain("SIMULATION PREVIEW ONLY");
    expect(text).toContain("never signs");
    expect(text).toContain("never sends");
    expect(text).toContain("never authorizes live trading");
    expect(text).toContain("UNRESOLVED (never invented)");
    expect(text).toContain("Next safe action:");
    expect(text).toContain("OPERATOR ACKNOWLEDGMENT APPLIED");
    // "profit" may appear ONLY inside the standing "Not a profitability claim." disclaimer.
    const lower = text.toLowerCase().replaceAll("not a profitability claim.", "");
    expect(lower).not.toContain("profit");
    expect(lower).not.toContain("ready for live");
    expect(lower).not.toContain("moon");
    expect(lower).not.toContain("executed");
  });

  it("a blocked plan's output leads with BLOCKED and lists every blocking reason", () => {
    const plan = buildSimulationIntentPlanV2({ stopSimulationTripped: true });
    const text = formatSimulationIntentPlanV2(plan, { label: "blocked-case" });
    expect(text).toContain("status:   BLOCKED");
    expect(text).toContain("BLOCKING reasons");
    expect(text).toContain("simulation-blocked-kill-switch-stop");
    expect(text).toContain("label:    blocked-case");
  });
});

// --- test helpers (fictional rebuilds for specific not-ready states) -----------

import {
  buildSniperSafetyGatesReportV2,
  buildPhase6PrerequisiteReportV2,
  buildSniperKillSwitchSpec,
  buildSniperSecretsPolicy,
  buildSniperBurnerIsolationSpec,
} from "@soulmaker/sniper";
import type { FictionalSimulationChain } from "./fixtures.js";

function rebuildGatesWithoutDecision(chain: FictionalSimulationChain): unknown {
  return buildSniperSafetyGatesReportV2({
    candidateList: chain.candidateList,
    preflight: chain.preflight,
    policy: chain.policy,
    runReport: chain.runReport,
    sessionPack: chain.sessionPack,
    auditLog: chain.auditLog,
  });
}

function rebuildPrereqsWithoutAudit(chain: FictionalSimulationChain): unknown {
  return buildPhase6PrerequisiteReportV2({
    sessionPack: chain.sessionPack,
    policy: chain.policy,
    safetyGates: chain.gates,
    decision: chain.decision,
    runReport: chain.runReport,
    killSwitchSpec: chain.killSwitchSpec,
    secretsPolicy: chain.secretsPolicy,
    burnerIsolationSpec: chain.burnerIsolationSpec,
    operatorLabel: "fictional-operator",
  });
}

function draftKillSwitchSpec(): unknown {
  return buildSniperKillSwitchSpec({
    operatorLabel: "fictional-operator",
    requiredOperatorConfirmations: ["fictional: confirm the session label"],
    readinessStatus: "draft",
  });
}

function draftSecretsPolicy(): unknown {
  return buildSniperSecretsPolicy({ operatorLabel: "fictional-operator", readinessStatus: "draft" });
}

function draftBurnerIsolationSpec(): unknown {
  return buildSniperBurnerIsolationSpec({
    operatorLabel: "fictional-operator",
    killSwitchSpecRef: "fictional-operator",
    readinessStatus: "draft",
  });
}
