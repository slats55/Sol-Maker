/**
 * Sprint 91 — quote-derived label facts entering the S85 route-resolution contract.
 *
 * The v1 artifact schema is UNCHANGED: these tests prove the builder's new optional `routeFacts`
 * input produces artifacts the EXISTING strict validator accepts, that supplying facts never
 * unblocks a blocked chain, that contradictions fail closed (throw), and that any label-resolved
 * fact forces the mandatory live-state caveat.
 */

import { describe, it, expect } from "vitest";
import {
  buildSimulationIntentPlanV2,
  buildSimulationRouteResolutionV1,
  validateSimulationRouteResolutionV1,
  formatSimulationRouteResolutionV1,
  SimulationRouteResolutionV1Error,
  SIMULATION_ROUTE_RESOLUTION_V1_NO_RESOLVER_ID,
  type SimulationIntentPlanV2,
  type SimulationRouteFactsInput,
} from "./index.js";
import { buildFictionalReadyChain } from "./fixtures.js";

const RESOLVER_ID = "routequote-operator-supplied";

function readyPlan(): SimulationIntentPlanV2 {
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
  });
}

function factsFor(plan: SimulationIntentPlanV2, overrides: Partial<SimulationRouteFactsInput> = {}): SimulationRouteFactsInput {
  return {
    resolverId: RESOLVER_ID,
    facts: plan.entries.map((e) => ({
      candidateId: e.candidateId,
      mint: e.mint,
      routeLabel: `read-only quote (operator-supplied): WSOL -> ${e.mint} — NOT executable`,
      destinationLabel: null,
      feeLabel: "0.3% pool fee (label only)",
    })),
    ...overrides,
  };
}

describe("buildSimulationRouteResolutionV1 — quote-derived facts (Sprint 91)", () => {
  it("records partial label facts as honest UNRESOLVED entries with the live-state caveat", () => {
    const plan = readyPlan();
    const artifact = buildSimulationRouteResolutionV1({ intentPlan: plan, routeFacts: factsFor(plan) });
    expect(artifact.routeResolverId).toBe(RESOLVER_ID);
    expect(artifact.routeResolverAttempted).toBe(true);
    expect(artifact.resolutionStatus).toBe("unresolved");
    expect(artifact.liveStateCaveat).toBe(true);
    expect(artifact.warningReasonCodes).toContain("simulation-route-resolution-live-state-caveat");
    expect(artifact.entryCount).toBe(plan.entryCount);
    for (const e of artifact.entries) {
      expect(e.routeResolutionStatus).toBe("unresolved");
      expect(e.routePreview.status).toBe("resolved-as-label");
      expect(e.feePreview.status).toBe("resolved-as-label");
      expect(e.destinationPreview).toEqual({ status: "unresolved", label: null });
      expect(e.unresolvedFields).toEqual(["destination"]);
      expect(e.operatorText).toContain("read-only quote observation");
      expect(e.operatorText).toContain("live-state caveat");
    }
    // The UNCHANGED strict validator accepts it (round-tripped through JSON).
    expect(() => validateSimulationRouteResolutionV1(JSON.parse(JSON.stringify(artifact)))).not.toThrow();
  });

  it("records fully-labeled facts as RESOLVED entries (still simulation-only)", () => {
    const plan = readyPlan();
    const facts = factsFor(plan);
    for (const f of facts.facts) f.destinationLabel = "fictional-destination-label (operator-supplied; never acted on)";
    const artifact = buildSimulationRouteResolutionV1({ intentPlan: plan, routeFacts: facts });
    expect(artifact.resolutionStatus).toBe("resolved");
    expect(artifact.resolvedEntryCount).toBe(plan.entryCount);
    expect(artifact.liveStateCaveat).toBe(true);
    expect(artifact.phase7LiveTradingReady).toBe(false);
    expect(() => validateSimulationRouteResolutionV1(JSON.parse(JSON.stringify(artifact)))).not.toThrow();
  });

  it("an entry the quote layer did not cover stays unresolved on all three facts", () => {
    const plan = readyPlan();
    const artifact = buildSimulationRouteResolutionV1({
      intentPlan: plan,
      routeFacts: { resolverId: RESOLVER_ID, facts: [] },
    });
    expect(artifact.routeResolverAttempted).toBe(true);
    expect(artifact.resolutionStatus).toBe("unresolved");
    for (const e of artifact.entries) {
      expect(e.unresolvedFields).toEqual(["route", "destination", "fee"]);
      expect(e.operatorText).toContain("observed no quote");
    }
  });

  it("without routeFacts, behavior is byte-identical to the canonical all-UNAVAILABLE builder", () => {
    const plan = readyPlan();
    const before = JSON.stringify(buildSimulationRouteResolutionV1({ intentPlan: plan }));
    const explicitNull = JSON.stringify(buildSimulationRouteResolutionV1({ intentPlan: plan, routeFacts: null }));
    expect(explicitNull).toBe(before);
    const parsed = JSON.parse(before) as { routeResolverId: string; routeResolverAttempted: boolean; resolutionStatus: string };
    expect(parsed.routeResolverId).toBe(SIMULATION_ROUTE_RESOLUTION_V1_NO_RESOLVER_ID);
    expect(parsed.routeResolverAttempted).toBe(false);
    expect(parsed.resolutionStatus).toBe("unavailable");
  });

  it("supplying facts NEVER unblocks a blocked chain (missing plan / tripped stop switch)", () => {
    const plan = readyPlan();
    const missingPlan = buildSimulationRouteResolutionV1({ routeFacts: factsFor(plan) });
    expect(missingPlan.blocked).toBe(true);
    expect(missingPlan.entries).toEqual([]);
    expect(missingPlan.routeResolverAttempted).toBe(false);
    const stopped = buildSimulationRouteResolutionV1({
      intentPlan: plan,
      stopSimulationTripped: true,
      routeFacts: factsFor(plan),
    });
    expect(stopped.blocked).toBe(true);
    expect(stopped.routeResolverAttempted).toBe(false);
    expect(() => validateSimulationRouteResolutionV1(JSON.parse(JSON.stringify(stopped)))).not.toThrow();
  });

  it("FAILS CLOSED on a fact for a candidate not in the plan", () => {
    const plan = readyPlan();
    const facts = factsFor(plan);
    facts.facts.push({ candidateId: "stranger", mint: plan.entries[0]!.mint, routeLabel: "x", destinationLabel: null, feeLabel: null });
    expect(() => buildSimulationRouteResolutionV1({ intentPlan: plan, routeFacts: facts })).toThrow(
      /not in the plan/,
    );
  });

  it("FAILS CLOSED on a mint contradiction and on duplicate facts", () => {
    const plan = readyPlan();
    const contradiction = factsFor(plan);
    contradiction.facts[0]!.mint = "So11111111111111111111111111111111111111112";
    expect(() => buildSimulationRouteResolutionV1({ intentPlan: plan, routeFacts: contradiction })).toThrow(
      /contradicts the plan's mint/,
    );
    const duplicated = factsFor(plan);
    duplicated.facts.push({ ...duplicated.facts[0]! });
    expect(() => buildSimulationRouteResolutionV1({ intentPlan: plan, routeFacts: duplicated })).toThrow(/duplicates/);
  });

  it("FAILS CLOSED on a malformed facts shape, foreign fields, and the no-resolver id", () => {
    const plan = readyPlan();
    expect(() =>
      buildSimulationRouteResolutionV1({ intentPlan: plan, routeFacts: { resolverId: "Bad Id", facts: [] } }),
    ).toThrow(/kebab-case/);
    expect(() =>
      buildSimulationRouteResolutionV1({
        intentPlan: plan,
        routeFacts: { resolverId: SIMULATION_ROUTE_RESOLUTION_V1_NO_RESOLVER_ID, facts: [] },
      }),
    ).toThrow(/no-resolver id can never supply facts/);
    expect(() =>
      buildSimulationRouteResolutionV1({
        intentPlan: plan,
        routeFacts: { resolverId: RESOLVER_ID, facts: [{ candidateId: "a", mint: "b", swapData: "x" }] } as never,
      }),
    ).toThrow(SimulationRouteResolutionV1Error);
  });

  it("REFUSES a secret-shaped label value without echoing it", () => {
    const plan = readyPlan();
    const facts = factsFor(plan);
    const keyShaped = "a".repeat(64);
    facts.facts[0]!.routeLabel = `pool ${keyShaped}`;
    try {
      buildSimulationRouteResolutionV1({ intentPlan: plan, routeFacts: facts });
      expect.unreachable("must throw");
    } catch (err) {
      expect((err as Error).message).toMatch(/secret-shaped/);
      expect((err as Error).message).not.toContain(keyShaped);
    }
  });

  it("the formatter shows label facts with the caveat framing, deterministically", () => {
    const plan = readyPlan();
    const artifact = buildSimulationRouteResolutionV1({ intentPlan: plan, routeFacts: factsFor(plan) });
    const text = formatSimulationRouteResolutionV1(artifact, { label: "test" });
    expect(text).toContain("label-only fact; live-state caveat applies");
    expect(text).toContain(`resolver: ${RESOLVER_ID} (inert metadata; attempted: yes)`);
    expect(text).toContain("UNRESOLVED (never invented)");
    expect(formatSimulationRouteResolutionV1(artifact, { label: "test" })).toBe(text);
  });

  it("is deterministic: same plan + same facts → byte-identical artifacts", () => {
    const plan = readyPlan();
    const a = JSON.stringify(buildSimulationRouteResolutionV1({ intentPlan: plan, routeFacts: factsFor(plan) }));
    const b = JSON.stringify(buildSimulationRouteResolutionV1({ intentPlan: plan, routeFacts: factsFor(plan) }));
    expect(a).toBe(b);
  });
});
