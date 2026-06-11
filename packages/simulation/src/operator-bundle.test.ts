/**
 * Sprint 88 — PHASE 6 OPERATOR BUNDLE (`phase6.operator.bundle.v1`) tests.
 *
 * The bundle collects the THIRTEEN-role PAPER dry-run chain (the twelve handoff roles plus the
 * handoff pack itself) into one archiveable, re-verifiable operator artifact. These tests pin:
 *
 *   - the happy paths over the FICTIONAL chains (the ready chain is honestly blocked on the
 *     verbatim prereqs-review condition; the watch-only chain is the condition-free state whose
 *     verdict is `reviewable-paper-only` — never anything better);
 *   - honest classification of missing / invalid / wrong-schema / pre-S87 artifacts;
 *   - the recomputed blocking trail, its handoff-consistency verdict, and the tamper cases
 *     (stripped trail, stale pack, flipped lock, forged tallies/verdicts/file refs);
 *   - byte determinism;
 *   - that no input can ever produce a live-readiness claim.
 *
 * Everything here is invented; nothing is live data, a trade signal, or a profitability claim.
 */

import { describe, it, expect } from "vitest";
import {
  buildPhase6OperatorBundleV1,
  validatePhase6OperatorBundleV1,
  formatPhase6OperatorBundleV1,
  Phase6OperatorBundleV1Error,
  PHASE6_OPERATOR_BUNDLE_ROLES,
  PHASE6_OPERATOR_BUNDLE_V1_SCHEMA_VERSION,
  type Phase6OperatorBundleV1,
} from "./operator-bundle.js";
import { buildFictionalReadyChain, buildFictionalWatchOnlyChain, type FictionalSimulationChain } from "./fixtures.js";
import { buildSimulationIntentPlanV2, type SimulationIntentPlanV2 } from "./intent-plan.js";
import { buildSimulationResultV1, type SimulationResultV1 } from "./result.js";
import { buildSimulationRouteResolutionV1, type SimulationRouteResolutionV1 } from "./route-resolution.js";
import { buildPhase6AuditReportV1, type Phase6AuditReportV1 } from "./chain-audit.js";
import {
  buildPhase6SimulationReadinessReportV1,
  PHASE6_READINESS_EVIDENCE_AREAS,
  type Phase6SimulationReadinessReportV1,
} from "./readiness.js";
import { buildPhase6SimulationHandoffPackV1, type Phase6SimulationHandoffPackV1 } from "./handoff-pack.js";
import { SimulationSafetyError } from "./safety.js";

const EVIDENCE = Object.fromEntries(PHASE6_READINESS_EVIDENCE_AREAS.map((a) => [a, `fictional-evidence/${a}`])) as Record<
  (typeof PHASE6_READINESS_EVIDENCE_AREAS)[number],
  string
>;

interface FullChain {
  chain: FictionalSimulationChain;
  plan: SimulationIntentPlanV2;
  result: SimulationResultV1;
  route: SimulationRouteResolutionV1;
  audit: Phase6AuditReportV1;
  readiness: Phase6SimulationReadinessReportV1;
  handoff: Phase6SimulationHandoffPackV1;
}

function buildFullChain(opts: { stopSimulationTripped?: boolean; variant?: "ready" | "watch-only" } = {}): FullChain {
  // The READY chain carries paper-enters, so its prereqs honestly keep NO_OPERATOR_BLOCKING unmet
  // (the audit surfaces `simulation-blocked-prereqs-not-ready` verbatim even after the plan-level
  // acknowledgment). The WATCH-ONLY chain has every prereq fully met — the truly condition-free state.
  const watchOnly = opts.variant === "watch-only";
  const chain = watchOnly ? buildFictionalWatchOnlyChain() : buildFictionalReadyChain();
  const plan = buildSimulationIntentPlanV2({
    decision: chain.decision,
    safetyGates: chain.gates,
    prereqs: chain.prereqs,
    killSwitchSpec: chain.killSwitchSpec,
    secretsPolicy: chain.secretsPolicy,
    burnerIsolationSpec: chain.burnerIsolationSpec,
    operatorAcknowledgedPaperEnterReview: !watchOnly,
    operatorLabel: "fictional-operator",
    planLabel: "fictional-bundle-plan",
    stopSimulationTripped: opts.stopSimulationTripped ?? false,
  });
  const result = buildSimulationResultV1({ plan });
  const route = buildSimulationRouteResolutionV1({ intentPlan: plan, resolutionLabel: "fictional-bundle-route" });
  const audit = buildPhase6AuditReportV1({
    decision: chain.decision,
    runReport: chain.runReport,
    safetyGates: chain.gates,
    prereqs: chain.prereqs,
    killSwitchSpec: chain.killSwitchSpec,
    secretsPolicy: chain.secretsPolicy,
    burnerIsolationSpec: chain.burnerIsolationSpec,
    intentPlan: plan,
    simulationResult: result,
    routeResolution: route,
    operatorLabel: "fictional-operator",
  });
  const readiness = buildPhase6SimulationReadinessReportV1({
    auditReport: audit,
    intentPlan: plan,
    simulationResult: result,
    evidence: EVIDENCE,
    operatorLabel: "fictional-operator",
  });
  const handoff = buildPhase6SimulationHandoffPackV1({
    decision: chain.decision,
    runReport: chain.runReport,
    safetyGates: chain.gates,
    prereqs: chain.prereqs,
    killSwitchSpec: chain.killSwitchSpec,
    secretsPolicy: chain.secretsPolicy,
    burnerIsolationSpec: chain.burnerIsolationSpec,
    intentPlan: plan,
    simulationResult: result,
    routeResolution: route,
    auditReport: audit,
    readinessReport: readiness,
    packLabel: "fictional-bundle-handoff",
  });
  return { chain, plan, result, route, audit, readiness, handoff };
}

function bundleInputOf(full: FullChain): Parameters<typeof buildPhase6OperatorBundleV1>[0] {
  return {
    decision: full.chain.decision,
    runReport: full.chain.runReport,
    safetyGates: full.chain.gates,
    prereqs: full.chain.prereqs,
    killSwitchSpec: full.chain.killSwitchSpec,
    secretsPolicy: full.chain.secretsPolicy,
    burnerIsolationSpec: full.chain.burnerIsolationSpec,
    intentPlan: full.plan,
    simulationResult: full.result,
    routeResolution: full.route,
    auditReport: full.audit,
    readinessReport: full.readiness,
    handoffPack: full.handoff,
    operatorLabel: "fictional-operator",
    bundleLabel: "fictional-bundle",
  };
}

const FAKE_DIGEST = `sha256-128:${"a".repeat(32)}`;

describe("phase6 operator bundle — happy paths over the fictional chains", () => {
  const full = buildFullChain();
  const bundle = buildPhase6OperatorBundleV1(bundleInputOf(full));

  it("ready chain: complete and trail-consistent, but HONESTLY blocked on the verbatim prereqs-review condition", () => {
    expect(bundle.schemaVersion).toBe(PHASE6_OPERATOR_BUNDLE_V1_SCHEMA_VERSION);
    expect(bundle.complete).toBe(true);
    expect(bundle.validCount).toBe(13);
    expect(bundle.missingCount).toBe(0);
    expect(bundle.invalidCount).toBe(0);
    // Paper-enters always demand operator review by design, so even the canonical "ready" chain
    // carries this one verbatim condition through audit/handoff — the bundle never waives it.
    expect(bundle.chainBlockingCodes).toEqual(["simulation-blocked-prereqs-not-ready"]);
    expect(bundle.hasBlockingConditions).toBe(true);
    expect(bundle.handoffChainBlockingCodes).toEqual(["simulation-blocked-prereqs-not-ready"]);
    expect(bundle.blockingTrailConsistent).toBe(true);
    expect(bundle.simulationReadyPerReadiness).toBe(true);
    expect(bundle.operatorVerdict).toBe("blocked");
    expect(bundle.whyBlocked.some((l) => l.includes("simulation-blocked-prereqs-not-ready"))).toBe(true);
  });

  it("watch-only chain (every prereq fully met): verdict reviewable-paper-only — and never better", () => {
    const clean = buildPhase6OperatorBundleV1(bundleInputOf(buildFullChain({ variant: "watch-only" })));
    expect(clean.complete).toBe(true);
    expect(clean.chainBlockingCodes).toEqual([]);
    expect(clean.hasBlockingConditions).toBe(false);
    expect(clean.handoffChainBlockingCodes).toEqual([]);
    expect(clean.blockingTrailConsistent).toBe(true);
    expect(clean.simulationReadyPerReadiness).toBe(true);
    expect(clean.routeLiveStateCaveat).toBe(false);
    expect(clean.operatorVerdict).toBe("reviewable-paper-only");
    expect(clean.whyBlocked).toEqual([]);
  });

  it("mirrors the route artifact verbatim (honest all-UNAVAILABLE boundary)", () => {
    expect(bundle.routeResolutionStatus).toBe("unavailable");
    expect(bundle.routeResolverAttempted).toBe(false);
    expect(bundle.routeLiveStateCaveat).toBe(false);
    expect(bundle.whatToInspectNext.some((l) => l.includes("honestly UNAVAILABLE"))).toBe(true);
  });

  it("carries the four safety locks and the always-false phase7 literal", () => {
    expect(bundle.neverAuthorizesLiveTrading).toBe(true);
    expect(bundle.neverSigns).toBe(true);
    expect(bundle.neverSends).toBe(true);
    expect(bundle.dryRunOnly).toBe(true);
    expect(bundle.phase7LiveTradingReady).toBe(false);
  });

  it("round-trips through the strict validator and is byte-deterministic", () => {
    expect(() => validatePhase6OperatorBundleV1(JSON.parse(JSON.stringify(bundle)))).not.toThrow();
    const again = buildPhase6OperatorBundleV1(bundleInputOf(buildFullChain()));
    expect(JSON.stringify(again, null, 2)).toBe(JSON.stringify(bundle, null, 2));
  });

  it("accepts and carries caller-supplied file references verbatim", () => {
    const withFiles = buildPhase6OperatorBundleV1({
      ...bundleInputOf(full),
      files: { decision: { fileName: "decision.json", digest: FAKE_DIGEST } },
    });
    const ref = withFiles.files.find((f) => f.role === "decision")!;
    expect(ref.fileName).toBe("decision.json");
    expect(ref.digest).toBe(FAKE_DIGEST);
    expect(withFiles.files.find((f) => f.role === "run-report")!.fileName).toBeNull();
  });
});

describe("phase6 operator bundle — missing artifacts are classified, never invented", () => {
  it("an empty input bundles thirteen missing roles with verdict incomplete", () => {
    const bundle = buildPhase6OperatorBundleV1({});
    expect(bundle.missingRoles).toEqual([...PHASE6_OPERATOR_BUNDLE_ROLES]);
    expect(bundle.complete).toBe(false);
    expect(bundle.chainBlockingCodes).toEqual([]);
    expect(bundle.handoffChainBlockingCodes).toBeNull();
    expect(bundle.blockingTrailConsistent).toBeNull();
    expect(bundle.routeResolutionStatus).toBeNull();
    expect(bundle.simulationReadyPerReadiness).toBeNull();
    expect(bundle.operatorVerdict).toBe("incomplete");
  });

  it("a complete-but-not-green chain blocks on the readiness condition (carried verbatim)", () => {
    const full = buildFullChain();
    const notGreenReadiness = buildPhase6SimulationReadinessReportV1({
      auditReport: full.audit,
      intentPlan: full.plan,
      simulationResult: full.result,
      // one evidence area missing → readiness is honestly NOT green (blocking code present)…
      evidence: Object.fromEntries(Object.entries(EVIDENCE).slice(1)),
    });
    expect(notGreenReadiness.phase6SimulationReady).toBe(false);
    const handoff = buildPhase6SimulationHandoffPackV1({
      decision: full.chain.decision,
      runReport: full.chain.runReport,
      safetyGates: full.chain.gates,
      prereqs: full.chain.prereqs,
      killSwitchSpec: full.chain.killSwitchSpec,
      secretsPolicy: full.chain.secretsPolicy,
      burnerIsolationSpec: full.chain.burnerIsolationSpec,
      intentPlan: full.plan,
      simulationResult: full.result,
      routeResolution: full.route,
      auditReport: full.audit,
      readinessReport: notGreenReadiness,
    });
    const bundle = buildPhase6OperatorBundleV1({
      ...bundleInputOf(full),
      readinessReport: notGreenReadiness,
      handoffPack: handoff,
    });
    // …so the recomputed trail carries the readiness blocking code: verdict blocked, not attention.
    expect(bundle.operatorVerdict).toBe("blocked");
    expect(bundle.chainBlockingCodes).toContain("simulation-readiness-evidence-missing");
    expect(bundle.blockingTrailConsistent).toBe(true);
  });
});

describe("phase6 operator bundle — invalid / wrong-schema / tampered inputs fail closed", () => {
  const full = buildFullChain();

  it("a flipped literal lock on the plan is CLASSIFIED invalid and blocks the bundle", () => {
    const bundle = buildPhase6OperatorBundleV1({
      ...bundleInputOf(full),
      intentPlan: { ...full.plan, neverSends: false },
    });
    expect(bundle.invalidRoles).toContain("intent-plan");
    expect(bundle.operatorVerdict).toBe("blocked");
    expect(bundle.blockingTrailConsistent).toBeNull(); // not fully recomputable any more
    expect(bundle.whyBlocked.some((l) => l.startsWith("intent-plan:"))).toBe(true);
  });

  it("a wrong-schema artifact (result supplied as plan) is CLASSIFIED invalid", () => {
    const bundle = buildPhase6OperatorBundleV1({ ...bundleInputOf(full), intentPlan: full.result });
    const state = bundle.artifacts.find((a) => a.role === "intent-plan")!;
    expect(state.valid).toBe(false);
    expect(state.suppliedSchemaVersion).toBe("simulation.result.v1");
    expect(bundle.operatorVerdict).toBe("blocked");
  });

  it("a pre-S87 (route-less, 11-role) handoff pack is CLASSIFIED invalid", () => {
    const preS87 = {
      ...full.handoff,
      artifacts: full.handoff.artifacts.filter((a) => a.role !== "route-resolution"),
    };
    const bundle = buildPhase6OperatorBundleV1({ ...bundleInputOf(full), handoffPack: preS87 });
    expect(bundle.invalidRoles).toContain("handoff-pack");
    expect(bundle.handoffChainBlockingCodes).toBeNull();
    expect(bundle.operatorVerdict).toBe("blocked");
  });

  it("a STALE handoff pack (built over a different chain) is INCONSISTENT and blocks", () => {
    // The chain regresses (stop tripped) but the operator reuses the old, clean handoff pack.
    const stopped = buildFullChain({ stopSimulationTripped: true });
    const bundle = buildPhase6OperatorBundleV1({
      ...bundleInputOf(full),
      intentPlan: stopped.plan,
      simulationResult: stopped.result,
      routeResolution: stopped.route,
      auditReport: stopped.audit,
      readinessReport: stopped.readiness,
      handoffPack: full.handoff, // stale: does NOT carry the kill-switch stop
    });
    expect(bundle.chainBlockingCodes).toContain("simulation-blocked-kill-switch-stop");
    expect(bundle.handoffChainBlockingCodes).not.toContain("simulation-blocked-kill-switch-stop");
    expect(bundle.blockingTrailConsistent).toBe(false);
    expect(bundle.operatorVerdict).toBe("blocked");
    expect(bundle.whyBlocked.some((l) => l.includes("stale or tampered"))).toBe(true);
  });

  it("a blocked chain bundles honestly: codes verbatim, verdict blocked, trail consistent", () => {
    const stopped = buildFullChain({ stopSimulationTripped: true });
    const bundle = buildPhase6OperatorBundleV1(bundleInputOf(stopped));
    expect(bundle.chainBlockingCodes).toContain("simulation-blocked-kill-switch-stop");
    expect(bundle.blockingTrailConsistent).toBe(true);
    expect(bundle.operatorVerdict).toBe("blocked");
    expect(bundle.whyBlocked.some((l) => l.includes("simulation-blocked-kill-switch-stop"))).toBe(true);
  });

  it("refuses a file reference for a role whose artifact was not supplied", () => {
    expect(() =>
      buildPhase6OperatorBundleV1({ files: { decision: { fileName: "decision.json", digest: FAKE_DIGEST } } }),
    ).toThrow(Phase6OperatorBundleV1Error);
  });

  it("refuses a malformed file reference (bad digest, empty name, unknown role)", () => {
    const base = bundleInputOf(full);
    expect(() =>
      buildPhase6OperatorBundleV1({ ...base, files: { decision: { fileName: "decision.json", digest: "sha256-128:nope" } } }),
    ).toThrow(Phase6OperatorBundleV1Error);
    expect(() =>
      buildPhase6OperatorBundleV1({ ...base, files: { decision: { fileName: "", digest: FAKE_DIGEST } } }),
    ).toThrow(Phase6OperatorBundleV1Error);
    expect(() =>
      buildPhase6OperatorBundleV1({
        ...base,
        files: { wallet: { fileName: "x.json", digest: FAKE_DIGEST } } as never,
      }),
    ).toThrow(Phase6OperatorBundleV1Error);
  });
});

describe("phase6 operator bundle — the strict validator refuses every forgery", () => {
  // The watch-only chain is the condition-free state: verdict reviewable-paper-only, empty trail.
  const full = buildFullChain({ variant: "watch-only" });
  const bundle = buildPhase6OperatorBundleV1(bundleInputOf(full));
  const clone = (): Phase6OperatorBundleV1 => JSON.parse(JSON.stringify(bundle)) as Phase6OperatorBundleV1;

  it("refuses a flipped safety lock and a true phase7LiveTradingReady", () => {
    expect(() => validatePhase6OperatorBundleV1({ ...clone(), neverSigns: false })).toThrow(SimulationSafetyError);
    expect(() => validatePhase6OperatorBundleV1({ ...clone(), phase7LiveTradingReady: true })).toThrow(
      Phase6OperatorBundleV1Error,
    );
  });

  it("refuses a forged verdict (a bundle can never claim anything beyond its recomputed state)", () => {
    const forged = clone();
    (forged as unknown as Record<string, unknown>).operatorVerdict = "blocked"; // even DOWNGRADING is refused: deterministic, not operator-chosen
    expect(() => validatePhase6OperatorBundleV1(forged)).toThrow(/operatorVerdict/);
  });

  it("refuses forged tallies, role lists, and completeness", () => {
    expect(() => validatePhase6OperatorBundleV1({ ...clone(), validCount: 12 })).toThrow(/validCount/);
    expect(() => validatePhase6OperatorBundleV1({ ...clone(), missingRoles: ["decision"] })).toThrow(/missingRoles/);
    expect(() => validatePhase6OperatorBundleV1({ ...clone(), complete: false })).toThrow(/complete/);
  });

  it("refuses a stripped blocking trail over a blocked chain (lower bound)", () => {
    const stopped = buildPhase6OperatorBundleV1(bundleInputOf(buildFullChain({ stopSimulationTripped: true })));
    const forged = JSON.parse(JSON.stringify(stopped)) as Record<string, unknown>;
    forged.chainBlockingCodes = [];
    forged.hasBlockingConditions = false;
    expect(() => validatePhase6OperatorBundleV1(forged)).toThrow(/cannot be empty/);
  });

  it("refuses an injected blocking trail over a clean chain (upper bound)", () => {
    const forged = clone();
    (forged as unknown as Record<string, unknown>).chainBlockingCodes = ["simulation-blocked-kill-switch-stop"];
    (forged as unknown as Record<string, unknown>).hasBlockingConditions = true;
    expect(() => validatePhase6OperatorBundleV1(forged)).toThrow(/must be empty/);
  });

  it("refuses a forged trail-consistency verdict and forged handoff codes", () => {
    expect(() => validatePhase6OperatorBundleV1({ ...clone(), blockingTrailConsistent: null })).toThrow(
      /blockingTrailConsistent/,
    );
    const forged = clone();
    (forged as unknown as Record<string, unknown>).handoffChainBlockingCodes = ["simulation-blocked-kill-switch-stop"];
    expect(() => validatePhase6OperatorBundleV1(forged)).toThrow(/chainBlockingCount|blockingTrailConsistent/);
  });

  it("refuses forged route/readiness mirrors", () => {
    expect(() => validatePhase6OperatorBundleV1({ ...clone(), routeResolutionStatus: "resolved" })).toThrow(
      /routeResolutionStatus/,
    );
    expect(() => validatePhase6OperatorBundleV1({ ...clone(), simulationReadyPerReadiness: null })).toThrow(
      /simulationReadyPerReadiness/,
    );
  });

  it("refuses forged operator text (what-happened / why-blocked / inspect-next are recomputed)", () => {
    expect(() => validatePhase6OperatorBundleV1({ ...clone(), whatHappened: "all good" })).toThrow(/whatHappened/);
    expect(() => validatePhase6OperatorBundleV1({ ...clone(), whyBlocked: ["nothing"] })).toThrow(/whyBlocked/);
    expect(() => validatePhase6OperatorBundleV1({ ...clone(), whatToInspectNext: [] })).toThrow(/whatToInspectNext/);
  });

  it("refuses a tampered file reference (digest format, dangling ref, broken pairing)", () => {
    const withFiles = buildPhase6OperatorBundleV1({
      ...bundleInputOf(full),
      files: { decision: { fileName: "decision.json", digest: FAKE_DIGEST } },
    });
    const forged = JSON.parse(JSON.stringify(withFiles)) as { files: Array<Record<string, unknown>> };
    forged.files[0]!.digest = "UPPERCASE-NOT-HEX";
    expect(() => validatePhase6OperatorBundleV1(forged)).toThrow(/digest/);
    const broken = JSON.parse(JSON.stringify(withFiles)) as { files: Array<Record<string, unknown>> };
    broken.files[0]!.digest = null;
    expect(() => validatePhase6OperatorBundleV1(broken)).toThrow(/together/);
  });

  it("refuses a wrong schemaVersion and a missing role row", () => {
    expect(() => validatePhase6OperatorBundleV1({ ...clone(), schemaVersion: "phase6.operator.bundle.v2" })).toThrow(
      /schemaVersion/,
    );
    const forged = clone();
    (forged as unknown as Record<string, unknown>).artifacts = (forged.artifacts as unknown[]).slice(0, 12);
    expect(() => validatePhase6OperatorBundleV1(forged)).toThrow(/13/);
  });
});

describe("phase6 operator bundle — formatter quality", () => {
  it("a complete bundle renders the verdict, the trail verdict, and the honest route boundary", () => {
    const text = formatPhase6OperatorBundleV1(
      buildPhase6OperatorBundleV1(bundleInputOf(buildFullChain({ variant: "watch-only" }))),
    );
    expect(text).toContain("verdict:  reviewable-paper-only");
    expect(text).toContain("CONSISTENT with the handoff pack's verbatim codes");
    expect(text).toContain("unavailable");
    expect(text).toContain("Next safe action:");
    expect(text).not.toMatch(/ready for live|live-ready/i);
  });

  it("a blocked bundle leads with BLOCKED state and verbatim operator messages", () => {
    const text = formatPhase6OperatorBundleV1(
      buildPhase6OperatorBundleV1(bundleInputOf(buildFullChain({ stopSimulationTripped: true }))),
    );
    expect(text).toContain("verdict:  blocked");
    expect(text).toContain("simulation-blocked-kill-switch-stop");
    expect(text).toContain("Why blocked");
  });
});
