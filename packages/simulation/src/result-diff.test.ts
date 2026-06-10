/**
 * Sprint 73 — `simulation.result.diff.v1` (the second half of the Phase 6 diff chain).
 *
 * Proves: an identical pair diffs as identical (no-op), every structured movement (status/blocked
 * transitions, blocking codes, adapter identity, plan ref, entry membership / status / unresolved
 * fields) is surfaced with its stable `simulation-diff-result-*` code, invalid/tampered/
 * wrong-schema inputs REFUSE (literal-lock tampering included), the strict validator catches
 * corrupted diffs, and the output is byte-deterministic.
 */

import { describe, it, expect } from "vitest";
import {
  buildSimulationIntentPlanV2,
  validateSimulationIntentPlanV2,
  buildSimulationResultV1,
  diffSimulationResultsV1,
  validateSimulationResultDiffV1,
  formatSimulationResultDiffV1,
  SimulationResultDiffV1Error,
  type SimulationDryRunAdapter,
  type SimulationIntentPlanV2,
  type SimulationResultV1,
  type SimulationResultDiffV1,
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

/** A fully label-resolved plan (hand-resolved labels — schema-legal, builder never invents them). */
function resolvedPlan(): SimulationIntentPlanV2 {
  const plan = JSON.parse(JSON.stringify(readyPlan({ paperAmountLabel: "10-paper-units" }))) as SimulationIntentPlanV2;
  for (const e of plan.entries) {
    e.previewStatus = "resolved";
    e.destinationPreview = { status: "resolved-as-label", label: "fictional-destination-label" };
    e.feePreview = { status: "resolved-as-label", label: "fictional-fee-label" };
    e.unresolvedFields = [];
    e.reasonCodes = [];
  }
  (plan as { unresolvedEntryCount: number }).unresolvedEntryCount = 0;
  plan.warningReasonCodes = ["simulation-operator-acknowledged-paper-enter-review"];
  return validateSimulationIntentPlanV2(plan);
}

const completingAdapter: SimulationDryRunAdapter = {
  adapterId: "fictional-completing",
  capabilityStatement: "fictional test adapter that completes every dry-run safely (signs nothing, sends nothing)",
  neverSigns: true,
  neverSends: true,
  attemptDryRun: () => ({ kind: "completed-safely", detail: "fictional safe completion inside the test boundary" }),
};

function skippedResult(): SimulationResultV1 {
  return buildSimulationResultV1({ plan: readyPlan() });
}

function blockedResult(): SimulationResultV1 {
  return buildSimulationResultV1({ plan: readyPlan(), stopSimulationTripped: true });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("diffSimulationResultsV1 — identical pair", () => {
  it("produces a no-op diff with the identical finding and zero deltas", () => {
    const diff = diffSimulationResultsV1(skippedResult(), skippedResult());
    expect(diff.hasChange).toBe(false);
    expect(diff.hasNewBlocking).toBe(false);
    expect(diff.diffReasonCodes).toEqual(["simulation-diff-result-identical"]);
    expect(diff.entriesAdded).toEqual([]);
    expect(diff.entriesRemoved).toEqual([]);
    expect(diff.entryChanges).toEqual([]);
    expect(diff.deltas).toEqual({ entryCount: 0, skippedCount: 0, unavailableCount: 0, failedCount: 0, completedCount: 0 });
  });

  it("carries the literal locks and never claims execution", () => {
    const diff = diffSimulationResultsV1(skippedResult(), skippedResult());
    expect(diff.neverAuthorizesLiveTrading).toBe(true);
    expect(diff.neverSigns).toBe(true);
    expect(diff.neverSends).toBe(true);
    expect(diff.dryRunOnly).toBe(true);
  });
});

describe("diffSimulationResultsV1 — movements", () => {
  it("skipped → blocked: newly-blocked + status + blocking-codes + entries surfaced", () => {
    const diff = diffSimulationResultsV1(skippedResult(), blockedResult());
    expect(diff.newlyBlocked).toBe(true);
    expect(diff.resultStatusChanged).toBe(true);
    expect(diff.hasNewBlocking).toBe(true);
    expect(diff.diffReasonCodes).toContain("simulation-diff-result-newly-blocked");
    expect(diff.diffReasonCodes).toContain("simulation-diff-result-status-changed");
    expect(diff.diffReasonCodes).toContain("simulation-diff-result-blocking-codes-changed");
    expect(diff.blockedCodesAdded).toContain("simulation-blocked-kill-switch-stop");
    // A blocked result carries zero entries → both removed.
    expect(diff.entriesRemoved.sort()).toEqual(["fic-sim-a", "fic-sim-b"]);
    expect(diff.deltas.entryCount).toBe(-2);
  });

  it("blocked → skipped: no-longer-blocked is an info finding", () => {
    const diff = diffSimulationResultsV1(blockedResult(), skippedResult());
    expect(diff.noLongerBlocked).toBe(true);
    expect(diff.hasNewBlocking).toBe(false);
    expect(diff.diffReasonCodes).toContain("simulation-diff-result-no-longer-blocked");
    expect(diff.blockedCodesRemoved).toContain("simulation-blocked-kill-switch-stop");
  });

  it("adapter outcome change: skipped_unresolved → dry_run_completed_safely via a different adapter", () => {
    const base = skippedResult();
    const next = buildSimulationResultV1({ plan: resolvedPlan(), adapter: completingAdapter });
    const diff = diffSimulationResultsV1(base, next);
    expect(diff.resultStatusChanged).toBe(true);
    expect(diff.adapterChanged).toBe(true);
    expect(diff.dryRunAttemptedChanged).toBe(true);
    expect(diff.diffReasonCodes).toContain("simulation-diff-result-adapter-changed");
    expect(diff.diffReasonCodes).toContain("simulation-diff-result-entries-changed");
    // Per-entry status transitions are listed with their code movements.
    expect(diff.entryChanges.length).toBe(2);
    for (const c of diff.entryChanges) {
      expect(c.statusChanged).toBe(true);
      expect(c.fromStatus).toBe("skipped_unresolved");
      expect(c.toStatus).toBe("dry_run_completed_safely");
      expect(c.reasonCodesAdded).toContain("simulation-dry-run-completed-safely");
      expect(c.reasonCodesRemoved).toContain("simulation-dry-run-skipped-unresolved-preview");
      expect(c.unresolvedFieldsRemoved.length).toBeGreaterThan(0);
    }
    expect(diff.deltas.completedCount).toBe(2);
    expect(diff.deltas.skippedCount).toBe(-2);
  });

  it("plan ref differences are surfaced as plan-ref-changed", () => {
    const base = buildSimulationResultV1({ plan: readyPlan() });
    const next = buildSimulationResultV1({ plan: readyPlan({ planLabel: "fictional-other-plan" }) });
    const diff = diffSimulationResultsV1(base, next);
    expect(diff.planRefChangedFields).toEqual(["planLabel"]);
    expect(diff.diffReasonCodes).toContain("simulation-diff-result-plan-ref-changed");
    expect(diff.hasChange).toBe(true);
  });
});

describe("diffSimulationResultsV1 — refusals", () => {
  it("refuses an invalid base and an invalid next with classified messages", () => {
    const r = skippedResult();
    expect(() => diffSimulationResultsV1({ junk: true }, r)).toThrow(SimulationResultDiffV1Error);
    expect(() => diffSimulationResultsV1({ junk: true }, r)).toThrow(/base simulation result is invalid/);
    expect(() => diffSimulationResultsV1(r, null)).toThrow(/next simulation result is invalid/);
  });

  it("refuses a wrong-schema artifact (an intent plan is not a result)", () => {
    expect(() => diffSimulationResultsV1(skippedResult(), readyPlan())).toThrow(/schemaVersion/);
  });

  it("refuses literal-lock tampering on either side", () => {
    const r = skippedResult();
    const tampered = clone(r) as unknown as Record<string, unknown>;
    tampered.neverSends = false;
    expect(() => diffSimulationResultsV1(tampered, r)).toThrow(/base simulation result is invalid/);
    expect(() => diffSimulationResultsV1(r, tampered)).toThrow(/next simulation result is invalid/);
  });
});

describe("validateSimulationResultDiffV1 — backstop", () => {
  function validDiff(): SimulationResultDiffV1 {
    return diffSimulationResultsV1(skippedResult(), blockedResult());
  }

  it("round-trips a built diff (including via JSON)", () => {
    const diff = validDiff();
    expect(validateSimulationResultDiffV1(clone(diff))).toEqual(diff);
  });

  it("refuses a flipped literal lock on the diff itself", () => {
    const diff = clone(validDiff()) as unknown as Record<string, unknown>;
    diff.dryRunOnly = false;
    expect(() => validateSimulationResultDiffV1(diff)).toThrow(/dryRunOnly/);
  });

  it("refuses tampered verdicts, deltas, and findings", () => {
    const d1 = clone(validDiff());
    (d1 as { hasChange: boolean }).hasChange = false;
    expect(() => validateSimulationResultDiffV1(d1)).toThrow(/hasChange/);

    const d2 = clone(validDiff());
    d2.deltas.completedCount = 42;
    expect(() => validateSimulationResultDiffV1(d2)).toThrow(/deltas\.completedCount/);

    const d3 = clone(validDiff());
    d3.diffReasonCodes = [];
    expect(() => validateSimulationResultDiffV1(d3)).toThrow(/diffReasonCodes/);

    const d4 = clone(validDiff());
    (d4 as { newlyBlocked: boolean }).newlyBlocked = false;
    expect(() => validateSimulationResultDiffV1(d4)).toThrow(/newlyBlocked/);
  });

  it("refuses a planRefChangedFields list that contradicts the embedded sides", () => {
    const diff = clone(validDiff());
    diff.planRefChangedFields = ["planLabel"];
    expect(() => validateSimulationResultDiffV1(diff)).toThrow(/planRefChangedFields/);
  });
});

describe("result diff — determinism and formatting", () => {
  it("the same pair yields a byte-identical diff and formatted text", () => {
    const a1 = diffSimulationResultsV1(skippedResult(), blockedResult());
    const a2 = diffSimulationResultsV1(skippedResult(), blockedResult());
    expect(JSON.stringify(a1)).toBe(JSON.stringify(a2));
    expect(formatSimulationResultDiffV1(a1)).toBe(formatSimulationResultDiffV1(a2));
  });

  it("formatted output keeps the dry-run framing and never claims execution", () => {
    const text = formatSimulationResultDiffV1(diffSimulationResultsV1(skippedResult(), blockedResult()), {
      label: "fictional-result-diff",
    });
    expect(text).toContain("DRY-RUN RECORD COMPARISON ONLY");
    expect(text).toContain("simulation only");
    expect(text).toContain("does not sign");
    expect(text).toContain("does not send");
    expect(text).toContain("does not authorize live trading");
    expect(text).toContain("label: fictional-result-diff");
    const lower = text.toLowerCase();
    expect(lower).not.toContain("trade executed");
    expect(lower).not.toContain("profitable");
    expect(lower).not.toContain("guaranteed");
    expect(lower).not.toContain("ready for live");
  });

  it("the identical diff formats with the identical verdict", () => {
    const text = formatSimulationResultDiffV1(diffSimulationResultsV1(skippedResult(), skippedResult()));
    expect(text).toContain("identical (no structured-field change)");
    expect(text).toContain("simulation-diff-result-identical");
  });
});
