/**
 * Sprint 65 — the dry-run adapter contract and `simulation.result.v1`.
 *
 * Proves: the adapter boundary cannot be widened (locks validated, sensitive-keyed adapters
 * refused, every outcome normalized — no sent/signed/live claim exists), unresolved previews are
 * never simulated, blocked plans produce blocked results, the kill switch blocks at result time,
 * and the result artifact is deterministic, strictly validated, and honest about unavailability.
 */

import { describe, it, expect } from "vitest";
import {
  buildSimulationIntentPlanV2,
  validateSimulationIntentPlanV2,
  buildSimulationResultV1,
  validateSimulationResultV1,
  formatSimulationResultV1,
  validateSimulationDryRunAdapter,
  normalizeSimulationDryRunOutcome,
  UNAVAILABLE_DRY_RUN_ADAPTER,
  SimulationResultV1Error,
  SimulationSafetyError,
  type SimulationDryRunAdapter,
  type SimulationIntentPlanV2,
  type SimulationResultV1,
} from "./index.js";
import { buildFictionalReadyChain, buildFictionalWatchOnlyChain } from "./fixtures.js";

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

/** A fully label-resolved plan (hand-resolved labels — schema-legal, builder never invents them)
 * so the adapter paths can be exercised. */
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
  // It must still satisfy the strict plan validator (labels are schema-legal).
  return validateSimulationIntentPlanV2(plan);
}

const completingAdapter: SimulationDryRunAdapter = {
  adapterId: "fictional-completing",
  capabilityStatement: "fictional test adapter that completes every dry-run safely (signs nothing, sends nothing)",
  neverSigns: true,
  neverSends: true,
  attemptDryRun: () => ({ kind: "completed-safely", detail: "fictional dry-run completed within the safe boundary" }),
};

const failingAdapter: SimulationDryRunAdapter = {
  ...completingAdapter,
  adapterId: "fictional-failing",
  attemptDryRun: () => ({ kind: "failed-safely", detail: "fictional dry-run failure captured safely" }),
};

describe("dry-run adapter contract", () => {
  it("the canonical UNAVAILABLE adapter validates, is frozen, and reports unavailable", () => {
    expect(() => validateSimulationDryRunAdapter(UNAVAILABLE_DRY_RUN_ADAPTER)).not.toThrow();
    expect(Object.isFrozen(UNAVAILABLE_DRY_RUN_ADAPTER)).toBe(true);
    const outcome = UNAVAILABLE_DRY_RUN_ADAPTER.attemptDryRun({
      candidateId: "x",
      mint: "y",
      intendedActionPreview: "simulated-entry-preview",
      destinationLabel: null,
      amountLabel: null,
      feeLabel: null,
    });
    expect(outcome.kind).toBe("unavailable");
  });

  it("refuses an adapter with a flipped or missing lock", () => {
    expect(() => validateSimulationDryRunAdapter({ ...completingAdapter, neverSigns: false })).toThrow(SimulationSafetyError);
    expect(() => validateSimulationDryRunAdapter({ ...completingAdapter, neverSends: undefined })).toThrow(SimulationSafetyError);
  });

  it("refuses an adapter carrying a sensitive-named property (no key material rides along)", () => {
    expect(() => validateSimulationDryRunAdapter({ ...completingAdapter, apiKey: "anything" })).toThrow(/sensitive-named/);
    expect(() => validateSimulationDryRunAdapter({ ...completingAdapter, walletSecret: "x" })).toThrow(SimulationSafetyError);
  });

  it("refuses malformed ids, statements, and non-function attempts", () => {
    expect(() => validateSimulationDryRunAdapter({ ...completingAdapter, adapterId: "Not Kebab!" })).toThrow(/kebab/);
    expect(() => validateSimulationDryRunAdapter({ ...completingAdapter, capabilityStatement: "short" })).toThrow(/meaningful/);
    expect(() => validateSimulationDryRunAdapter({ ...completingAdapter, attemptDryRun: "nope" })).toThrow(/function/);
    expect(() => validateSimulationDryRunAdapter(null)).toThrow(SimulationSafetyError);
  });

  it("normalizes unknown/malformed outcomes to a safe failure — no sent/signed/live claim can exist", () => {
    expect(normalizeSimulationDryRunOutcome({ kind: "sent-live", detail: "executed the trade!" }).kind).toBe("failed-safely");
    expect(normalizeSimulationDryRunOutcome({ kind: "completed-safely" }).kind).toBe("failed-safely"); // no detail
    expect(normalizeSimulationDryRunOutcome("nonsense").kind).toBe("failed-safely");
    expect(normalizeSimulationDryRunOutcome({ kind: "completed-safely", detail: "x".repeat(3000) }).kind).toBe("failed-safely");
    expect(normalizeSimulationDryRunOutcome({ kind: "unavailable", detail: "honest reason" })).toEqual({
      kind: "unavailable",
      detail: "honest reason",
    });
  });
});

describe("simulation result v1 — honest statuses", () => {
  it("unresolved previews are SKIPPED (never simulated); the default result is skipped_unresolved", () => {
    const result = buildSimulationResultV1({ plan: readyPlan() });
    expect(result.resultStatus).toBe("skipped_unresolved");
    expect(result.dryRunAttempted).toBe(false);
    expect(result.skippedCount).toBe(2);
    expect(result.entries.every((e) => e.entryStatus === "skipped_unresolved")).toBe(true);
    expect(result.entries.every((e) => e.reasonCodes.includes("simulation-dry-run-skipped-unresolved-preview"))).toBe(true);
    expect(() => validateSimulationResultV1(result)).not.toThrow();
  });

  it("a blocked plan produces a blocked result with ZERO entries", () => {
    const blockedPlan = buildSimulationIntentPlanV2({ stopSimulationTripped: true });
    const result = buildSimulationResultV1({ plan: blockedPlan });
    expect(result.resultStatus).toBe("blocked");
    expect(result.entries).toEqual([]);
    expect(result.blockedReasonCodes).toContain("simulation-dry-run-skipped-blocked-plan");
    expect(result.blockedReasonCodes).toContain("simulation-blocked-kill-switch-stop");
  });

  it("a stop-simulation switch declared AT RESULT TIME blocks even an unblocked plan", () => {
    const result = buildSimulationResultV1({ plan: readyPlan(), stopSimulationTripped: true });
    expect(result.resultStatus).toBe("blocked");
    expect(result.blockedReasonCodes).toEqual(["simulation-blocked-kill-switch-stop"]);
    expect(result.entries).toEqual([]);
  });

  it("a zero-entry plan produces no_entries", () => {
    const chain = buildFictionalWatchOnlyChain();
    const plan = buildSimulationIntentPlanV2({
      decision: chain.decision,
      safetyGates: chain.gates,
      prereqs: chain.prereqs,
      killSwitchSpec: chain.killSwitchSpec,
      secretsPolicy: chain.secretsPolicy,
      burnerIsolationSpec: chain.burnerIsolationSpec,
    });
    const result = buildSimulationResultV1({ plan });
    expect(result.resultStatus).toBe("no_entries");
    expect(result.dryRunAttempted).toBe(false);
  });

  it("the default adapter reports honest UNAVAILABILITY for resolved entries", () => {
    const result = buildSimulationResultV1({ plan: resolvedPlan() });
    expect(result.resultStatus).toBe("dry_run_unavailable");
    expect(result.dryRunAttempted).toBe(false);
    expect(result.unavailableCount).toBe(2);
    expect(result.dryRunUnavailableReason).toContain("unavailable, not faked");
    expect(result.adapterSummary.adapterId).toBe("unavailable-safe-boundary");
  });

  it("a completing adapter yields dry_run_completed_safely — and it is still not an execution", () => {
    const result = buildSimulationResultV1({ plan: resolvedPlan(), adapter: completingAdapter });
    expect(result.resultStatus).toBe("dry_run_completed_safely");
    expect(result.dryRunAttempted).toBe(true);
    expect(result.completedCount).toBe(2);
    expect(result.outcomeReasonCodes).toContain("simulation-dry-run-completed-safely");
    expect(result.notes.join(" ")).toContain("never chain inclusion");
  });

  it("a failing adapter yields dry_run_failed_safely (conservative precedence over completions)", () => {
    const result = buildSimulationResultV1({ plan: resolvedPlan(), adapter: failingAdapter });
    expect(result.resultStatus).toBe("dry_run_failed_safely");
    expect(result.failedCount).toBe(2);
  });

  it("a THROWING adapter is captured as a safe failure (never propagates)", () => {
    const throwing: SimulationDryRunAdapter = {
      ...completingAdapter,
      adapterId: "fictional-throwing",
      attemptDryRun: () => {
        throw new Error("fictional adapter explosion");
      },
    };
    const result = buildSimulationResultV1({ plan: resolvedPlan(), adapter: throwing });
    expect(result.resultStatus).toBe("dry_run_failed_safely");
    expect(result.entries[0]!.detail).toContain("captured as a safe failure");
  });

  it("a MALICIOUS adapter claiming a live send is normalized to a safe failure", () => {
    const malicious = {
      ...completingAdapter,
      adapterId: "fictional-malicious",
      attemptDryRun: () => ({ kind: "sent-live", detail: "trade executed on-chain!" }),
    } as unknown as SimulationDryRunAdapter;
    const result = buildSimulationResultV1({ plan: resolvedPlan(), adapter: malicious });
    expect(result.resultStatus).toBe("dry_run_failed_safely");
    expect(result.entries[0]!.detail).toContain("normalized to a safe failure");
    expect(JSON.stringify(result)).not.toContain("trade executed");
  });

  it("an UNSAFE adapter (flipped lock / sensitive key) is refused outright", () => {
    expect(() =>
      buildSimulationResultV1({ plan: resolvedPlan(), adapter: { ...completingAdapter, neverSends: false } as never }),
    ).toThrow(SimulationSafetyError);
    expect(() =>
      buildSimulationResultV1({ plan: resolvedPlan(), adapter: { ...completingAdapter, privateKeyPath: "x" } as never }),
    ).toThrow(SimulationSafetyError);
  });

  it("an invalid plan is refused — there is no honest result without a valid plan", () => {
    expect(() => buildSimulationResultV1({ plan: { schemaVersion: "simulation.intent.plan.v2" } })).toThrow(SimulationResultV1Error);
    expect(() => buildSimulationResultV1({ plan: undefined })).toThrow(SimulationResultV1Error);
    const tampered = { ...readyPlan(), neverSends: false };
    expect(() => buildSimulationResultV1({ plan: tampered })).toThrow(SimulationResultV1Error);
  });

  it("is deterministic: two builds are JSON-identical", () => {
    const a = buildSimulationResultV1({ plan: readyPlan() });
    const b = buildSimulationResultV1({ plan: readyPlan() });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe("simulation result v1 — validator backstop", () => {
  const valid = (): SimulationResultV1 =>
    JSON.parse(JSON.stringify(buildSimulationResultV1({ plan: readyPlan() }))) as SimulationResultV1;

  it.each([["neverAuthorizesLiveTrading"], ["neverSigns"], ["neverSends"], ["dryRunOnly"]])(
    "refuses a result whose %s literal lock is flipped",
    (key) => {
      expect(() => validateSimulationResultV1({ ...valid(), [key]: false })).toThrow(SimulationSafetyError);
    },
  );

  it("refuses adapterSummary lock tampering", () => {
    const r = valid();
    (r.adapterSummary as { neverSends: boolean }).neverSends = false;
    expect(() => validateSimulationResultV1(r)).toThrow(/adapterSummary locks/);
  });

  it("refuses a blocked result smuggling entries, and tampered tallies", () => {
    const r = valid();
    (r as { resultStatus: string }).resultStatus = "blocked";
    (r.blockedReasonCodes as string[]).push("simulation-blocked-kill-switch-stop");
    expect(() => validateSimulationResultV1(r)).toThrow(/ZERO entries/);
    const r2 = valid();
    (r2 as { skippedCount: number }).skippedCount = 0;
    expect(() => validateSimulationResultV1(r2)).toThrow(/recomputed tally/);
  });

  it("refuses an entry that 'simulated' despite unresolved fields", () => {
    const r = valid();
    r.entries[0]!.entryStatus = "dry_run_completed_safely";
    expect(() => validateSimulationResultV1(r)).toThrow(/unresolved previews|precedence/);
  });

  it("refuses a result-status that breaks the conservative precedence", () => {
    const r = valid();
    (r as { resultStatus: string }).resultStatus = "dry_run_completed_safely";
    expect(() => validateSimulationResultV1(r)).toThrow(/precedence/);
  });

  it("refuses an unknown status and a wrong schema version", () => {
    expect(() => validateSimulationResultV1({ ...valid(), resultStatus: "executed" })).toThrow(/resultStatus/);
    expect(() => validateSimulationResultV1({ ...valid(), schemaVersion: "simulation.result.v2" })).toThrow(/schemaVersion/);
  });
});

describe("simulation result v1 — formatter", () => {
  it("never phrases an outcome as an execution; carries the safety framing", () => {
    const text = formatSimulationResultV1(buildSimulationResultV1({ plan: resolvedPlan(), adapter: completingAdapter }));
    expect(text).toContain("DRY-RUN-ONLY");
    expect(text).toContain("not an execution");
    expect(text).toContain("never signs");
    expect(text).toContain("never sends");
    expect(text).toContain("changes nothing about live readiness");
    const stripped = text.toLowerCase().replaceAll("not an execution", "").replaceAll("never claims chain inclusion, execution, trade success", "");
    expect(stripped).not.toContain("executed");
    expect(stripped).not.toContain("ready for live");
  });

  it("a blocked result leads with BLOCKED and its reasons", () => {
    const text = formatSimulationResultV1(buildSimulationResultV1({ plan: readyPlan(), stopSimulationTripped: true }), {
      label: "blocked-case",
    });
    expect(text).toContain("status:   BLOCKED");
    expect(text).toContain("simulation-blocked-kill-switch-stop");
  });
});
