/**
 * Sprint 73 — `simulation.intent.plan.diff.v2` (the first half of the Phase 6 diff chain).
 *
 * Proves: an identical pair diffs as identical (no-op), every structured movement (blocked
 * transition, blocking/warning codes, source refs, readiness/spec summaries, acknowledgment,
 * entry membership / preview-field changes) is surfaced with its stable `simulation-diff-plan-*`
 * code, invalid/tampered/wrong-schema inputs REFUSE (literal-lock tampering included), the strict
 * validator catches corrupted diffs, side labels are metadata (not compared), and the output is
 * byte-deterministic.
 */

import { describe, it, expect } from "vitest";
import {
  buildSimulationIntentPlanV2,
  diffSimulationIntentPlansV2,
  validateSimulationIntentPlanDiffV2,
  formatSimulationIntentPlanDiffV2,
  buildSimulationResultV1,
  SimulationIntentPlanDiffV2Error,
  type SimulationIntentPlanV2,
  type SimulationIntentPlanDiffV2,
} from "./index.js";
import { buildFictionalReadyChain } from "./fixtures.js";

function readyPlan(extra: Record<string, unknown> = {}): SimulationIntentPlanV2 {
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

function blockedPlan(extra: Record<string, unknown> = {}): SimulationIntentPlanV2 {
  const chain = buildFictionalReadyChain();
  // No decision supplied → honestly BLOCKED plan.
  return buildSimulationIntentPlanV2({
    safetyGates: chain.gates,
    prereqs: chain.prereqs,
    killSwitchSpec: chain.killSwitchSpec,
    secretsPolicy: chain.secretsPolicy,
    burnerIsolationSpec: chain.burnerIsolationSpec,
    planLabel: "fictional-blocked-plan",
    ...extra,
  });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("diffSimulationIntentPlansV2 — identical pair", () => {
  it("produces a no-op diff with the identical finding and zero deltas", () => {
    const a = readyPlan();
    const b = readyPlan();
    const diff = diffSimulationIntentPlansV2(a, b);
    expect(diff.hasChange).toBe(false);
    expect(diff.hasNewBlocking).toBe(false);
    expect(diff.hasNewUnresolved).toBe(false);
    expect(diff.diffReasonCodes).toEqual(["simulation-diff-plan-identical"]);
    expect(diff.entriesAdded).toEqual([]);
    expect(diff.entriesRemoved).toEqual([]);
    expect(diff.entryChanges).toEqual([]);
    expect(diff.sourceRefChanges).toEqual([]);
    expect(diff.deltas).toEqual({ entryCount: 0, unresolvedEntryCount: 0, blockingCodeCount: 0, warningCodeCount: 0 });
  });

  it("side labels are metadata only — differently-labeled identical plans diff as identical", () => {
    const a = readyPlan({ planLabel: "label-one", operatorLabel: "op-one" });
    const b = readyPlan({ planLabel: "label-two", operatorLabel: "op-two" });
    const diff = diffSimulationIntentPlansV2(a, b);
    expect(diff.hasChange).toBe(false);
    expect(diff.base.planLabel).toBe("label-one");
    expect(diff.next.planLabel).toBe("label-two");
  });

  it("carries the literal locks and the standard flags", () => {
    const diff = diffSimulationIntentPlansV2(readyPlan(), readyPlan());
    expect(diff.neverAuthorizesLiveTrading).toBe(true);
    expect(diff.neverSigns).toBe(true);
    expect(diff.neverSends).toBe(true);
    expect(diff.dryRunOnly).toBe(true);
    expect(diff.paperOnly).toBe(true);
    expect(diff.notLiveResult).toBe(true);
  });
});

describe("diffSimulationIntentPlansV2 — movements", () => {
  it("unblocked → blocked: newly-blocked + blocking-codes + source-refs + entries surfaced", () => {
    const diff = diffSimulationIntentPlansV2(readyPlan(), blockedPlan());
    expect(diff.newlyBlocked).toBe(true);
    expect(diff.hasNewBlocking).toBe(true);
    expect(diff.hasChange).toBe(true);
    expect(diff.diffReasonCodes).toContain("simulation-diff-plan-newly-blocked");
    expect(diff.diffReasonCodes).toContain("simulation-diff-plan-blocking-codes-changed");
    expect(diff.blockingCodesAdded).toContain("simulation-blocked-missing-decision-v2");
    // The decision ref flipped present→absent.
    expect(diff.diffReasonCodes).toContain("simulation-diff-plan-source-refs-changed");
    expect(diff.sourceRefChanges.map((c) => c.role)).toContain("decision");
    // The blocked plan carries zero entries → both fictional entries removed.
    expect(diff.entriesRemoved.sort()).toEqual(["fic-sim-a", "fic-sim-b"]);
    expect(diff.deltas.entryCount).toBe(-2);
  });

  it("blocked → unblocked: no-longer-blocked is an info finding", () => {
    const diff = diffSimulationIntentPlansV2(blockedPlan(), readyPlan());
    expect(diff.noLongerBlocked).toBe(true);
    expect(diff.hasNewBlocking).toBe(false);
    expect(diff.diffReasonCodes).toContain("simulation-diff-plan-no-longer-blocked");
    expect(diff.blockingCodesRemoved).toContain("simulation-blocked-missing-decision-v2");
  });

  it("amount label appearing resolves the amount preview: entry field changes + unresolved-warning movement", () => {
    const base = readyPlan();
    const next = readyPlan({ paperAmountLabel: "10-paper-units" });
    const diff = diffSimulationIntentPlansV2(base, next);
    expect(diff.hasChange).toBe(true);
    expect(diff.diffReasonCodes).toContain("simulation-diff-plan-entries-changed");
    expect(diff.entryChanges.length).toBe(2);
    for (const c of diff.entryChanges) {
      expect(c.fieldChanges).toEqual([
        { field: "amount", fromStatus: "unresolved", toStatus: "resolved-as-label", fromLabel: null, toLabel: "10-paper-units" },
      ]);
      expect(c.reasonCodesRemoved).toContain("simulation-preview-unresolved-amount");
    }
    expect(diff.warningCodesRemoved).toContain("simulation-preview-unresolved-amount");
    expect(diff.hasNewUnresolved).toBe(false);
  });

  it("amount label disappearing flags hasNewUnresolved (resolved → unresolved transition)", () => {
    const diff = diffSimulationIntentPlansV2(readyPlan({ paperAmountLabel: "10-paper-units" }), readyPlan());
    expect(diff.hasNewUnresolved).toBe(true);
    expect(diff.warningCodesAdded).toContain("simulation-preview-unresolved-amount");
  });

  it("unresolved entry count change is reflected in the deltas (membership change)", () => {
    const base = readyPlan();
    const next = clone(base);
    next.entries = [next.entries[0]!];
    (next as { entryCount: number }).entryCount = 1;
    (next as { unresolvedEntryCount: number }).unresolvedEntryCount = 1;
    const diff = diffSimulationIntentPlansV2(base, next);
    expect(diff.entriesRemoved).toEqual(["fic-sim-b"]);
    expect(diff.deltas.entryCount).toBe(-1);
    expect(diff.deltas.unresolvedEntryCount).toBe(-1);
    expect(diff.diffReasonCodes).toContain("simulation-diff-plan-entries-changed");
    expect(diff.hasNewUnresolved).toBe(false);
  });

  it("a hand-resolved entry's preview-status change is surfaced per entry", () => {
    const base = readyPlan({ paperAmountLabel: "10-paper-units" });
    const next = clone(base);
    for (const e of next.entries) {
      e.previewStatus = "resolved";
      e.destinationPreview = { status: "resolved-as-label", label: "fictional-destination-label" };
      e.feePreview = { status: "resolved-as-label", label: "fictional-fee-label" };
      e.unresolvedFields = [];
      e.reasonCodes = [];
    }
    (next as { unresolvedEntryCount: number }).unresolvedEntryCount = 0;
    next.warningReasonCodes = ["simulation-operator-acknowledged-paper-enter-review"];
    const diff = diffSimulationIntentPlansV2(base, next);
    expect(diff.entryChanges.length).toBe(2);
    for (const c of diff.entryChanges) {
      expect(c.previewStatusChanged).toBe(true);
      expect(c.fromPreviewStatus).toBe("unresolved");
      expect(c.toPreviewStatus).toBe("resolved");
      expect(c.fieldChanges.map((f) => f.field)).toEqual(["destination", "fee"]);
    }
    expect(diff.deltas.unresolvedEntryCount).toBe(-2);
  });

  it("acknowledgment difference is surfaced as its own finding plus the warning-code movement", () => {
    // Base: watch-only style — build the ready chain WITHOUT the acknowledgment → blocked
    // (prereqs not ready). Compare two unblocked plans differing only in ack is impossible via
    // the builder (the ready chain needs the ack), so compare ready vs hand-stripped clone.
    const base = readyPlan();
    expect(base.paperEnterReviewAcknowledgmentApplied).toBe(true);
    const next = clone(base);
    next.paperEnterReviewAcknowledgmentApplied = false;
    next.warningReasonCodes = next.warningReasonCodes.filter(
      (c) => c !== "simulation-operator-acknowledged-paper-enter-review",
    );
    const diff = diffSimulationIntentPlansV2(base, next);
    expect(diff.acknowledgmentChanged).toBe(true);
    expect(diff.diffReasonCodes).toContain("simulation-diff-plan-acknowledgment-changed");
    expect(diff.warningCodesRemoved).toContain("simulation-operator-acknowledged-paper-enter-review");
  });

  it("stop-switch state difference is a spec-adoption change", () => {
    const diff = diffSimulationIntentPlansV2(blockedPlan(), blockedPlan({ stopSimulationTripped: true }));
    expect(diff.specAdoptionChangedFields).toContain("stopSimulationDeclaredTripped");
    expect(diff.diffReasonCodes).toContain("simulation-diff-plan-spec-adoption-changed");
    expect(diff.blockingCodesAdded).toContain("simulation-blocked-kill-switch-stop");
  });
});

describe("diffSimulationIntentPlansV2 — refusals", () => {
  it("refuses an invalid base and an invalid next with classified messages", () => {
    const plan = readyPlan();
    expect(() => diffSimulationIntentPlansV2({ junk: true }, plan)).toThrow(SimulationIntentPlanDiffV2Error);
    expect(() => diffSimulationIntentPlansV2({ junk: true }, plan)).toThrow(/base intent plan is invalid/);
    expect(() => diffSimulationIntentPlansV2(plan, null)).toThrow(/next intent plan is invalid/);
  });

  it("refuses a wrong-schema artifact (a simulation result is not an intent plan)", () => {
    const plan = readyPlan();
    const result = buildSimulationResultV1({ plan });
    expect(() => diffSimulationIntentPlansV2(plan, result)).toThrow(/schemaVersion/);
  });

  it("refuses literal-lock tampering on either side", () => {
    const plan = readyPlan();
    const tampered = clone(plan) as unknown as Record<string, unknown>;
    tampered.neverSigns = false;
    expect(() => diffSimulationIntentPlansV2(tampered, plan)).toThrow(/base intent plan is invalid/);
    expect(() => diffSimulationIntentPlansV2(plan, tampered)).toThrow(/next intent plan is invalid/);
  });
});

describe("validateSimulationIntentPlanDiffV2 — backstop", () => {
  function validDiff(): SimulationIntentPlanDiffV2 {
    return diffSimulationIntentPlansV2(readyPlan(), blockedPlan());
  }

  it("round-trips a built diff (including via JSON)", () => {
    const diff = validDiff();
    expect(validateSimulationIntentPlanDiffV2(clone(diff))).toEqual(diff);
  });

  it("refuses a flipped literal lock on the diff itself", () => {
    const diff = clone(validDiff()) as unknown as Record<string, unknown>;
    diff.neverAuthorizesLiveTrading = false;
    expect(() => validateSimulationIntentPlanDiffV2(diff)).toThrow(/neverAuthorizesLiveTrading/);
  });

  it("refuses a tampered hasChange / hasNewBlocking / deltas / findings sequence", () => {
    const d1 = clone(validDiff());
    (d1 as { hasChange: boolean }).hasChange = false;
    expect(() => validateSimulationIntentPlanDiffV2(d1)).toThrow(/hasChange/);

    const d2 = clone(validDiff());
    (d2 as { hasNewBlocking: boolean }).hasNewBlocking = false;
    expect(() => validateSimulationIntentPlanDiffV2(d2)).toThrow(/hasNewBlocking/);

    const d3 = clone(validDiff());
    d3.deltas.entryCount = 99;
    expect(() => validateSimulationIntentPlanDiffV2(d3)).toThrow(/deltas\.entryCount/);

    const d4 = clone(validDiff());
    d4.diffReasonCodes = d4.diffReasonCodes.slice(1);
    expect(() => validateSimulationIntentPlanDiffV2(d4)).toThrow(/diffReasonCodes/);
  });

  it("refuses an entry change that describes no change", () => {
    const diff = clone(diffSimulationIntentPlansV2(readyPlan(), readyPlan({ paperAmountLabel: "10-paper-units" })));
    const change = diff.entryChanges[0]!;
    change.fieldChanges = [];
    change.reasonCodesAdded = [];
    change.reasonCodesRemoved = [];
    expect(() => validateSimulationIntentPlanDiffV2(diff)).toThrow(/at least one change/);
  });

  it("refuses a newlyBlocked flag that contradicts the embedded sides", () => {
    const diff = clone(validDiff());
    (diff as { newlyBlocked: boolean }).newlyBlocked = false;
    expect(() => validateSimulationIntentPlanDiffV2(diff)).toThrow(/newlyBlocked/);
  });
});

describe("intent plan diff — determinism and formatting", () => {
  it("the same pair yields a byte-identical diff and formatted text", () => {
    const a1 = diffSimulationIntentPlansV2(readyPlan(), blockedPlan());
    const a2 = diffSimulationIntentPlansV2(readyPlan(), blockedPlan());
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a2));
    expect(formatSimulationIntentPlanDiffV2(a1)).toBe(formatSimulationIntentPlanDiffV2(a2));
  });

  it("formatted output keeps the simulation-only framing and never claims execution", () => {
    const text = formatSimulationIntentPlanDiffV2(diffSimulationIntentPlansV2(readyPlan(), blockedPlan()), {
      label: "fictional-diff",
    });
    expect(text).toContain("PREVIEW COMPARISON ONLY");
    expect(text).toContain("simulation only");
    expect(text).toContain("does not sign");
    expect(text).toContain("does not send");
    expect(text).toContain("does not authorize live trading");
    expect(text).toContain("label: fictional-diff");
    const lower = text.toLowerCase();
    expect(lower).not.toContain("trade executed");
    expect(lower).not.toContain("profitable");
    expect(lower).not.toContain("guaranteed");
    expect(lower).not.toContain("ready for live");
  });

  it("the identical diff formats with the identical verdict", () => {
    const text = formatSimulationIntentPlanDiffV2(diffSimulationIntentPlansV2(readyPlan(), readyPlan()));
    expect(text).toContain("identical (no structured-field change)");
    expect(text).toContain("simulation-diff-plan-identical");
  });
});
