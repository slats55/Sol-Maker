/**
 * Sprint 85 — SIMULATION ROUTE RESOLUTION V1 (`simulation.route.resolution.v1`).
 *
 * The provenance layer the dry-run boundary design names as its first prerequisite. Covered here:
 *
 *   - the canonical builder records HONEST UNAVAILABLE per entry (no route-resolution capability
 *     exists inside this boundary; nothing is invented; deterministic);
 *   - fail-closed blocking over a missing / invalid / blocked plan or a tripped stop switch;
 *   - the validator ACCEPTS a schema-legal, future-resolver-shaped resolved artifact — and then
 *     REQUIRES the live-state caveat — while REFUSING every tampered mirror: flipped literal
 *     locks, schema-version mismatch, "resolved" claims over missing facts, emptied blocking
 *     codes over a blocking source state, tally/status/next-safe-action tampering, sensitive- or
 *     execution-shaped injected fields (the v1 schema is CLOSED), and secret-shaped resolver ids;
 *   - the formatter's operator output: honest unresolved/unavailable language, the provenance-only
 *     safety framing, and secret redaction.
 *
 * Everything here is FICTIONAL fixture data built through production builders.
 */

import { describe, it, expect } from "vitest";
import {
  buildSimulationIntentPlanV2,
  buildSimulationRouteResolutionV1,
  validateSimulationRouteResolutionV1,
  formatSimulationRouteResolutionV1,
  SimulationRouteResolutionV1Error,
  SimulationSafetyError,
  SIMULATION_ROUTE_RESOLUTION_V1_SCHEMA_VERSION,
  SIMULATION_ROUTE_RESOLUTION_V1_NO_RESOLVER_ID,
  SIMULATION_SAFETY_LITERAL_KEYS,
  SIMULATION_OPERATOR_SAFETY_LINE,
  type SimulationIntentPlanV2,
  type SimulationRouteResolutionV1,
  type SimulationRouteResolutionEntryV1,
} from "./index.js";
import { buildFictionalReadyChain, buildFictionalWatchOnlyChain, type FictionalSimulationChain } from "./fixtures.js";

// --- fictional inputs ----------------------------------------------------------

function readyPlan(chain: FictionalSimulationChain = buildFictionalReadyChain()): SimulationIntentPlanV2 {
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
  });
}

function watchOnlyPlan(): SimulationIntentPlanV2 {
  const chain = buildFictionalWatchOnlyChain();
  return buildSimulationIntentPlanV2({
    decision: chain.decision,
    safetyGates: chain.gates,
    prereqs: chain.prereqs,
    killSwitchSpec: chain.killSwitchSpec,
    secretsPolicy: chain.secretsPolicy,
    burnerIsolationSpec: chain.burnerIsolationSpec,
    planLabel: "fictional-watch-only-plan",
  });
}

/** The exact deterministic next-safe-action line for a fully-resolved artifact (pinned). */
const RESOLVED_NEXT_SAFE_ACTION =
  "Every entry is fully label-resolved (live-state caveat applies). Review each fact's provenance with the operator — still SIMULATION ONLY: this artifact never signs, never sends, never authorizes live trading, and never approves a transaction.";

/** A schema-legal artifact shaped like what a FUTURE, separately-authorized resolver would emit:
 * every fact label-resolved (FICTIONAL labels), the live-state caveat carried, locks intact. */
function fictionalResolvedArtifact(): SimulationRouteResolutionV1 {
  const base = buildSimulationRouteResolutionV1({ intentPlan: readyPlan() });
  expect(base.entries.length).toBeGreaterThan(0);
  const entries: SimulationRouteResolutionEntryV1[] = base.entries.map((e, i) => ({
    candidateId: e.candidateId,
    mint: e.mint,
    routeResolutionStatus: "resolved",
    routePreview: { status: "resolved-as-label", label: `fictional-route-label-${i}` },
    destinationPreview: { status: "resolved-as-label", label: `fictional-destination-label-${i}` },
    feePreview: { status: "resolved-as-label", label: `fictional-fee-label-${i}` },
    unresolvedFields: [],
    reasonCodes: ["simulation-route-resolution-entry-resolved"],
    operatorText: `Fictional resolved entry ${i} (test-only label facts; never real chain data).`,
  }));
  return {
    ...base,
    routeResolverId: "fictional-test-resolver",
    routeResolverAttempted: true,
    resolutionStatus: "resolved",
    liveStateCaveat: true,
    warningReasonCodes: ["simulation-route-resolution-live-state-caveat"],
    outcomeReasonCodes: ["simulation-route-resolution-entry-resolved", "simulation-route-resolution-validated"],
    entries,
    entryCount: entries.length,
    resolvedEntryCount: entries.length,
    unresolvedEntryCount: 0,
    unavailableEntryCount: 0,
    nextSafeAction: RESOLVED_NEXT_SAFE_ACTION,
  };
}

// --- builder: the canonical honest UNAVAILABLE ----------------------------------

describe("buildSimulationRouteResolutionV1 — canonical honest UNAVAILABLE", () => {
  const plan = readyPlan();
  const artifact = buildSimulationRouteResolutionV1({
    intentPlan: plan,
    operatorLabel: "fictional-operator",
    resolutionLabel: "fictional-resolution",
  });

  it("records one UNAVAILABLE entry per plan entry under the canonical no-resolver id", () => {
    expect(artifact.schemaVersion).toBe(SIMULATION_ROUTE_RESOLUTION_V1_SCHEMA_VERSION);
    expect(artifact.resolutionStatus).toBe("unavailable");
    expect(artifact.routeResolverId).toBe(SIMULATION_ROUTE_RESOLUTION_V1_NO_RESOLVER_ID);
    expect(artifact.routeResolverAttempted).toBe(false);
    expect(artifact.entryCount).toBe(plan.entryCount);
    expect(artifact.entryCount).toBeGreaterThan(0);
    for (const e of artifact.entries) {
      expect(e.routeResolutionStatus).toBe("unavailable");
      expect(e.routePreview).toEqual({ status: "unresolved", label: null });
      expect(e.destinationPreview).toEqual({ status: "unresolved", label: null });
      expect(e.feePreview).toEqual({ status: "unresolved", label: null });
      expect(e.unresolvedFields).toEqual(["route", "destination", "fee"]);
      expect(e.reasonCodes).toEqual(["simulation-route-resolution-unavailable-no-resolver"]);
    }
  });

  it("carries the literal locks, the always-false phase7 flag, and NO live-state caveat", () => {
    expect(artifact.neverAuthorizesLiveTrading).toBe(true);
    expect(artifact.neverSigns).toBe(true);
    expect(artifact.neverSends).toBe(true);
    expect(artifact.dryRunOnly).toBe(true);
    expect(artifact.phase7LiveTradingReady).toBe(false);
    expect(artifact.liveStateCaveat).toBe(false);
    expect(artifact.blocked).toBe(false);
    expect(artifact.blockingReasonCodes).toEqual([]);
    expect(artifact.warningReasonCodes).toContain("simulation-route-resolution-unavailable-no-resolver");
    expect(artifact.outcomeReasonCodes).toContain("simulation-route-resolution-validated");
  });

  it("references the plan verbatim and survives a validate round-trip", () => {
    expect(artifact.sourcePlanRef.present).toBe(true);
    expect(artifact.sourcePlanRef.valid).toBe(true);
    expect(artifact.sourcePlanRef.planLabel).toBe("fictional-plan");
    expect(artifact.sourcePlanRef.blocked).toBe(false);
    expect(artifact.sourcePlanRef.entryCount).toBe(plan.entryCount);
    expect(validateSimulationRouteResolutionV1(JSON.parse(JSON.stringify(artifact)))).toBeTruthy();
  });

  it("is deterministic (same input → identical artifact)", () => {
    const again = buildSimulationRouteResolutionV1({
      intentPlan: plan,
      operatorLabel: "fictional-operator",
      resolutionLabel: "fictional-resolution",
    });
    expect(again).toEqual(artifact);
    expect(JSON.stringify(again)).toBe(JSON.stringify(artifact));
  });

  it("a watch-only (zero-entry) plan yields the honest no_entries artifact", () => {
    const empty = buildSimulationRouteResolutionV1({ intentPlan: watchOnlyPlan() });
    expect(empty.resolutionStatus).toBe("no_entries");
    expect(empty.entryCount).toBe(0);
    expect(empty.blocked).toBe(false);
    expect(empty.outcomeReasonCodes).toContain("simulation-route-resolution-no-entries");
  });
});

// --- builder: fail-closed blocking ----------------------------------------------

describe("buildSimulationRouteResolutionV1 — fail-closed blocking (never a silent downgrade)", () => {
  it("a MISSING plan blocks with the missing-plan code and zero entries", () => {
    const artifact = buildSimulationRouteResolutionV1({});
    expect(artifact.resolutionStatus).toBe("blocked");
    expect(artifact.blocked).toBe(true);
    expect(artifact.blockingReasonCodes).toEqual(["simulation-route-resolution-missing-plan"]);
    expect(artifact.entries).toEqual([]);
    expect(artifact.sourcePlanRef.present).toBe(false);
    expect(artifact.sourcePlanRef.planLabel).toBeNull();
  });

  it("an INVALID plan blocks with the invalid-plan code (never a throw, never trusted)", () => {
    const artifact = buildSimulationRouteResolutionV1({
      intentPlan: { schemaVersion: "simulation.intent.plan.v2", tampered: true },
    });
    expect(artifact.resolutionStatus).toBe("blocked");
    expect(artifact.blockingReasonCodes).toEqual(["simulation-route-resolution-invalid-plan"]);
    expect(artifact.sourcePlanRef.valid).toBe(false);
    expect(artifact.sourcePlanRef.suppliedSchemaVersion).toBe("simulation.intent.plan.v2");
  });

  it("a BLOCKED (but valid) plan blocks with the blocked-plan code", () => {
    const blockedPlan = buildSimulationIntentPlanV2({});
    expect(blockedPlan.blocked).toBe(true);
    const artifact = buildSimulationRouteResolutionV1({ intentPlan: blockedPlan });
    expect(artifact.resolutionStatus).toBe("blocked");
    expect(artifact.blockingReasonCodes).toEqual(["simulation-route-resolution-blocked-plan"]);
    expect(artifact.sourcePlanRef.valid).toBe(true);
    expect(artifact.sourcePlanRef.blocked).toBe(true);
  });

  it("a declared stop-simulation switch blocks even over a good plan", () => {
    const artifact = buildSimulationRouteResolutionV1({ intentPlan: readyPlan(), stopSimulationTripped: true });
    expect(artifact.resolutionStatus).toBe("blocked");
    expect(artifact.blockingReasonCodes).toEqual(["simulation-blocked-kill-switch-stop"]);
    expect(artifact.stopSimulationDeclaredTripped).toBe(true);
    expect(artifact.entries).toEqual([]);
  });

  it("refuses malformed input SHAPES (the only thing that throws)", () => {
    expect(() => buildSimulationRouteResolutionV1({ operatorLabel: 42 as unknown as string })).toThrow(SimulationRouteResolutionV1Error);
    expect(() => buildSimulationRouteResolutionV1({ stopSimulationTripped: "yes" as unknown as boolean })).toThrow(
      SimulationRouteResolutionV1Error,
    );
  });
});

// --- validator: the future-resolver shape ---------------------------------------

describe("validateSimulationRouteResolutionV1 — accepts the future-resolver shape, requires the caveat", () => {
  it("accepts a schema-legal fully-resolved artifact (fictional labels, caveat carried)", () => {
    const resolved = fictionalResolvedArtifact();
    expect(validateSimulationRouteResolutionV1(JSON.parse(JSON.stringify(resolved)))).toBeTruthy();
  });

  it("REFUSES a resolved artifact whose live-state caveat was dropped", () => {
    const tampered = { ...fictionalResolvedArtifact(), liveStateCaveat: false };
    expect(() => validateSimulationRouteResolutionV1(tampered)).toThrow(/liveStateCaveat must be true/);
  });

  it("REFUSES the caveat warning code being stripped while the caveat holds", () => {
    const tampered = { ...fictionalResolvedArtifact(), warningReasonCodes: [] };
    expect(() => validateSimulationRouteResolutionV1(tampered)).toThrow(/warningReasonCodes must equal the recomputed trail/);
  });

  it('REFUSES a "resolved" entry claim while a required fact is missing (fee unresolved)', () => {
    const resolved = fictionalResolvedArtifact();
    const entries = resolved.entries.map((e, i) =>
      i === 0 ? { ...e, feePreview: { status: "unresolved" as const, label: null } } : e,
    );
    const tampered = { ...resolved, entries };
    expect(() => validateSimulationRouteResolutionV1(tampered)).toThrow(/"resolved" claim with missing route\/destination\/fee facts is refused/);
  });

  it("accepts the honest partially-resolved shape instead (status unresolved, fact named)", () => {
    const resolved = fictionalResolvedArtifact();
    const first: SimulationRouteResolutionEntryV1 = {
      ...resolved.entries[0]!,
      routeResolutionStatus: "unresolved",
      feePreview: { status: "unresolved", label: null },
      unresolvedFields: ["fee"],
      reasonCodes: ["simulation-route-resolution-unresolved-fee"],
    };
    const entries = [first, ...resolved.entries.slice(1)];
    const honest = {
      ...resolved,
      entries,
      resolutionStatus: "unresolved" as const,
      resolvedEntryCount: entries.length - 1,
      unresolvedEntryCount: 1,
      warningReasonCodes: [
        "simulation-route-resolution-live-state-caveat" as const,
        "simulation-route-resolution-unresolved-fee" as const,
      ],
      nextSafeAction:
        "Required route/destination/fee facts are still missing for at least one entry — they stay unresolved until a validated resolution layer supplies them; never type them in by hand.",
    };
    expect(validateSimulationRouteResolutionV1(JSON.parse(JSON.stringify(honest)))).toBeTruthy();
  });

  it("REFUSES resolved facts under an UNATTEMPTED resolver (nothing resolves without an attempt)", () => {
    const resolved = fictionalResolvedArtifact();
    const tampered = { ...resolved, routeResolverAttempted: false };
    expect(() => validateSimulationRouteResolutionV1(tampered)).toThrow(/an unattempted resolution can never carry resolved facts/);
  });

  it("REFUSES the canonical no-resolver id claiming an attempt", () => {
    const resolved = fictionalResolvedArtifact();
    const tampered = { ...resolved, routeResolverId: SIMULATION_ROUTE_RESOLUTION_V1_NO_RESOLVER_ID };
    expect(() => validateSimulationRouteResolutionV1(tampered)).toThrow(/can never claim an attempt/);
  });
});

// --- validator: tamper refusals --------------------------------------------------

describe("validateSimulationRouteResolutionV1 — tamper refusals (mirrors recomputed, never trusted)", () => {
  const good = () => JSON.parse(JSON.stringify(buildSimulationRouteResolutionV1({ intentPlan: readyPlan() }))) as Record<string, unknown>;

  it.each(SIMULATION_SAFETY_LITERAL_KEYS.map((k) => [k] as const))("refuses a flipped %s lock", (key) => {
    expect(() => validateSimulationRouteResolutionV1({ ...good(), [key]: false })).toThrow(SimulationSafetyError);
  });

  it("refuses phase7LiveTradingReady flipped to true", () => {
    expect(() => validateSimulationRouteResolutionV1({ ...good(), phase7LiveTradingReady: true })).toThrow(
      /phase7LiveTradingReady must be literally false/,
    );
  });

  it("refuses an unknown or wrong schema version", () => {
    expect(() => validateSimulationRouteResolutionV1({ ...good(), schemaVersion: "simulation.route.resolution.v2" })).toThrow(
      /schemaVersion must be/,
    );
    expect(() => validateSimulationRouteResolutionV1({ ...good(), schemaVersion: "made.up.v1" })).toThrow(/schemaVersion must be/);
  });

  it("refuses a tampered banner", () => {
    expect(() => validateSimulationRouteResolutionV1({ ...good(), banner: "ROUTE RESOLUTION (LIVE)" })).toThrow(/banner must be/);
  });

  it("refuses empty blocking codes while the source state signals blocking", () => {
    const blocked = JSON.parse(JSON.stringify(buildSimulationRouteResolutionV1({}))) as Record<string, unknown>;
    expect(() => validateSimulationRouteResolutionV1({ ...blocked, blockingReasonCodes: [] })).toThrow(
      /blockingReasonCodes must equal the recomputed trail/,
    );
  });

  it("refuses a blocked flag contradicting the recomputed blocking trail", () => {
    const blocked = JSON.parse(JSON.stringify(buildSimulationRouteResolutionV1({}))) as Record<string, unknown>;
    expect(() => validateSimulationRouteResolutionV1({ ...blocked, blocked: false })).toThrow(/blocked must be true exactly when/);
  });

  it("refuses a resolutionStatus that contradicts the recomputed precedence", () => {
    expect(() => validateSimulationRouteResolutionV1({ ...good(), resolutionStatus: "resolved" })).toThrow(
      /must follow the conservative precedence/,
    );
  });

  it("refuses tampered tallies and counts", () => {
    const a = good();
    expect(() => validateSimulationRouteResolutionV1({ ...a, resolvedEntryCount: (a.resolvedEntryCount as number) + 1 })).toThrow(
      /resolvedEntryCount must equal the recomputed tally/,
    );
    expect(() => validateSimulationRouteResolutionV1({ ...a, entryCount: (a.entryCount as number) + 1 })).toThrow(
      /entryCount must equal entries length/,
    );
  });

  it("refuses an entries/plan-ref entry-count contradiction", () => {
    const a = good();
    const ref = { ...(a.sourcePlanRef as Record<string, unknown>), entryCount: ((a.sourcePlanRef as Record<string, unknown>).entryCount as number) + 1 };
    expect(() => validateSimulationRouteResolutionV1({ ...a, sourcePlanRef: ref })).toThrow(/one record per plan entry/);
  });

  it("refuses a tampered next safe action", () => {
    expect(() => validateSimulationRouteResolutionV1({ ...good(), nextSafeAction: "proceed to live trading" })).toThrow(
      /nextSafeAction must equal the recomputed deterministic action/,
    );
  });

  it("refuses a sensitive-named injected field by name (key material can never ride along)", () => {
    expect(() => validateSimulationRouteResolutionV1({ ...good(), rpcApiKey: "x" })).toThrow(/sensitive-named field "rpcApiKey"/);
  });

  it("refuses an execution-shaped or any other unknown field (the v1 schema is CLOSED)", () => {
    expect(() => validateSimulationRouteResolutionV1({ ...good(), txBytes: "0011" })).toThrow(/unknown field "txBytes"/);
    expect(() => validateSimulationRouteResolutionV1({ ...good(), unsignedMessage: {} })).toThrow(/unknown field "unsignedMessage"/);
  });

  it("refuses an injected field on an ENTRY too (entries are closed objects)", () => {
    const a = good();
    const entries = (a.entries as Record<string, unknown>[]).map((e, i) => (i === 0 ? { ...e, rawBytes: "00" } : e));
    expect(() => validateSimulationRouteResolutionV1({ ...a, entries })).toThrow(/unknown field "rawBytes"/);
  });

  it("refuses a secret-shaped resolver id", () => {
    expect(() => validateSimulationRouteResolutionV1({ ...good(), routeResolverId: "secret-key-resolver" })).toThrow(
      /sensitive-shaped/,
    );
  });

  it("refuses an unknown reason code", () => {
    expect(() => validateSimulationRouteResolutionV1({ ...good(), warningReasonCodes: ["made-up-code"] })).toThrow(
      /known simulation reason codes/,
    );
  });

  it("refuses invented plan-ref state for a missing plan", () => {
    const blocked = JSON.parse(JSON.stringify(buildSimulationRouteResolutionV1({}))) as Record<string, unknown>;
    const ref = { ...(blocked.sourcePlanRef as Record<string, unknown>), planLabel: "invented" };
    expect(() => validateSimulationRouteResolutionV1({ ...blocked, sourcePlanRef: ref })).toThrow(/state is never invented/);
  });

  it("refuses a plan-ref validity contradiction (valid must be null exactly when absent)", () => {
    const blocked = JSON.parse(JSON.stringify(buildSimulationRouteResolutionV1({}))) as Record<string, unknown>;
    const ref = { ...(blocked.sourcePlanRef as Record<string, unknown>), valid: true };
    expect(() => validateSimulationRouteResolutionV1({ ...blocked, sourcePlanRef: ref })).toThrow(/valid must be null exactly when/);
  });
});

// --- formatter -------------------------------------------------------------------

describe("formatSimulationRouteResolutionV1 — honest operator output", () => {
  it("the canonical UNAVAILABLE artifact says so plainly, with the provenance-only framing", () => {
    const text = formatSimulationRouteResolutionV1(
      buildSimulationRouteResolutionV1({ intentPlan: readyPlan(), resolutionLabel: "fictional-resolution" }),
    );
    expect(text).toContain(SIMULATION_OPERATOR_SAFETY_LINE);
    expect(text).toContain(`artifact: ${SIMULATION_ROUTE_RESOLUTION_V1_SCHEMA_VERSION}`);
    expect(text).toContain("not live trading; not a buy recommendation; not a transaction approval");
    expect(text).toContain("status:   UNAVAILABLE");
    expect(text).toContain("UNRESOLVED (never invented)");
    expect(text).toContain("Next safe action:");
    expect(text).toContain("live-state caveat: no");
  });

  it("a blocked artifact reads as BLOCKED with per-code operator messages", () => {
    const text = formatSimulationRouteResolutionV1(buildSimulationRouteResolutionV1({}));
    expect(text).toContain("status:   BLOCKED");
    expect(text).toContain("BLOCKING reasons (nothing is resolved over a blocked chain):");
    expect(text).toContain("simulation-route-resolution-missing-plan");
    expect(text).toContain("Build one with paper:simulation:intent:plan");
  });

  it("a resolved artifact surfaces the live-state caveat loudly", () => {
    const text = formatSimulationRouteResolutionV1(fictionalResolvedArtifact());
    expect(text).toContain("live-state caveat: YES");
    expect(text).toContain("(label-only fact; live-state caveat applies)");
    expect(text).toContain("status:   RESOLVED");
    expect(text).toContain("never mistake this for a deterministic fixture");
  });

  it("redacts a secret-shaped resolution label", () => {
    const artifact = buildSimulationRouteResolutionV1({
      intentPlan: readyPlan(),
      resolutionLabel: "session Authorization: Bearer abc123.def456-ghi end",
    });
    const text = formatSimulationRouteResolutionV1(artifact);
    expect(text).not.toContain("abc123.def456-ghi");
    expect(text).toContain("[REDACTED]");
  });
});
