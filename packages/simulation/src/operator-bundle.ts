/**
 * Deterministic, offline **PHASE 6 OPERATOR BUNDLE** (`phase6.operator.bundle.v1`, Sprint 88 —
 * the archiveable, re-verifiable operator view of one full PAPER dry-run chain).
 *
 * The handoff pack (Sprint 75) is the session-to-session handoff over the TWELVE chain roles.
 * This bundle is the OPERATOR-facing collection over THIRTEEN roles — the same twelve plus the
 * handoff pack itself — built so one artifact answers, from strictly-validated structured fields
 * only: what happened, why the run is blocked (if it is), and what to inspect next.
 *
 *   - per-role presence / validity / supplied schema / label / flat structured summary
 *     (a missing artifact is CLASSIFIED as missing — state is never invented for it)
 *   - optional per-role FILE REFERENCES (file name + truncated sha256 digest) supplied by the
 *     caller that read the artifacts from disk — the bundle holds the integrity refs verbatim;
 *     this package computes no digest itself (it does no I/O by construction). The digest is
 *     TRUNCATED to 128 bits (`sha256-128:<32 hex>`) ON PURPOSE: the shared redactor treats any
 *     64-hex blob as key-shaped and would redact a full digest
 *   - the chain's blocking conditions RECOMPUTED here from the bundled plan / result / route /
 *     audit / readiness artifacts (the same verbatim-union recipe the handoff pack uses), PLUS
 *     the handoff pack's own carried codes, PLUS an explicit consistency verdict between the
 *     two — a pack whose blocking trail disagrees with the artifacts it claims to cover is
 *     surfaced as a blocked, possibly-tampered bundle, never papered over
 *   - one closed-set operator verdict (`blocked` / `incomplete` / `attention` /
 *     `reviewable-paper-only`) with deterministic what-happened / why-blocked /
 *     what-to-inspect-next operator text, all recomputed by the validator
 *
 * The hard line, validated as literals: the four safety locks always hold and
 * `phase7LiveTradingReady` is ALWAYS false — an operator bundle can never claim or authorize
 * live trading, and `reviewable-paper-only` is its best possible verdict by construction.
 * Pure: no I/O, no network, no wallet, no wall-clock.
 */

import { redactString } from "@soulmaker/security";
import {
  validatePaperSniperDecisionReportV2,
  SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION,
  validateSniperRunReportV2,
  SNIPER_RUN_REPORT_V2_SCHEMA_VERSION,
  validateSniperSafetyGatesReportV2,
  SNIPER_SAFETY_GATES_REPORT_V2_SCHEMA_VERSION,
  validatePhase6PrerequisiteReportV2,
  PHASE6_PREREQUISITE_REPORT_V2_SCHEMA_VERSION,
  validateSniperKillSwitchSpec,
  SNIPER_KILL_SWITCH_SPEC_SCHEMA_VERSION,
  validateSniperSecretsPolicy,
  SNIPER_SECRETS_POLICY_SCHEMA_VERSION,
  validateSniperBurnerIsolationSpec,
  SNIPER_BURNER_ISOLATION_SPEC_SCHEMA_VERSION,
  type SniperPaperDecisionReportV2,
  type SniperRunReportV2,
  type SniperSafetyGatesReportV2,
  type Phase6PrerequisiteReportV2,
  type SniperKillSwitchSpec,
  type SniperSecretsPolicy,
  type SniperBurnerIsolationSpec,
} from "@soulmaker/sniper";
import {
  SIMULATION_PACKAGE_DISCLAIMERS,
  SIMULATION_OPERATOR_SAFETY_LINE,
  SIMULATION_SAFETY_LITERALS,
  assertSimulationSafetyLiterals,
} from "./safety.js";
import {
  SIMULATION_REASON_CODE_DEFINITIONS,
  dedupeSimulationReasonCodes,
  isSimulationReasonCode,
  type SimulationReasonCode,
} from "./reason-codes.js";
import {
  validateSimulationIntentPlanV2,
  SIMULATION_INTENT_PLAN_V2_SCHEMA_VERSION,
  type SimulationIntentPlanV2,
} from "./intent-plan.js";
import {
  validateSimulationResultV1,
  SIMULATION_RESULT_V1_SCHEMA_VERSION,
  type SimulationResultV1,
} from "./result.js";
import {
  validatePhase6AuditReportV1,
  PHASE6_AUDIT_REPORT_V1_SCHEMA_VERSION,
  type Phase6AuditReportV1,
} from "./chain-audit.js";
import {
  validatePhase6SimulationReadinessReportV1,
  PHASE6_SIMULATION_READINESS_REPORT_V1_SCHEMA_VERSION,
  type Phase6SimulationReadinessReportV1,
} from "./readiness.js";
import {
  validateSimulationRouteResolutionV1,
  SIMULATION_ROUTE_RESOLUTION_V1_SCHEMA_VERSION,
  SIMULATION_ROUTE_RESOLUTION_STATUSES,
  type SimulationRouteResolutionV1,
} from "./route-resolution.js";
import {
  validatePhase6SimulationHandoffPackV1,
  PHASE6_SIMULATION_HANDOFF_PACK_V1_SCHEMA_VERSION,
  type Phase6SimulationHandoffPackV1,
} from "./handoff-pack.js";

/** Stable schema identifier for the Phase 6 operator bundle. Bump only on a breaking change. */
export const PHASE6_OPERATOR_BUNDLE_V1_SCHEMA_VERSION = "phase6.operator.bundle.v1";

/** The banner that prefixes every operator bundle (required label). */
export const PHASE6_OPERATOR_BUNDLE_V1_BANNER =
  "PHASE 6 OPERATOR BUNDLE (ARCHIVE/REVIEW ONLY — SIMULATION ONLY, NEVER SIGNS, NEVER SENDS, NEVER AUTHORIZES LIVE TRADING)";

/** The fixed `generatedBy` marker (deterministic provenance; never an operator value). */
export const PHASE6_OPERATOR_BUNDLE_V1_GENERATED_BY = "@soulmaker/simulation";

/** Required disclaimer statements carried by every operator bundle (stable order). */
export const PHASE6_OPERATOR_BUNDLE_V1_DISCLAIMERS: readonly string[] = [
  "PHASE 6 OPERATOR BUNDLE — thirteen chain artifacts strictly validated in place and summarized from STRUCTURED FIELDS ONLY; a missing artifact is classified as missing, never invented.",
  "The chain's blocking conditions are RECOMPUTED from the bundled artifacts and cross-checked against the handoff pack's verbatim trail — a disagreement is surfaced as a blocked bundle, never waived.",
  "The best possible operator verdict is reviewable-paper-only: an operator bundle is structurally incapable of claiming live-trading readiness, and the validator refuses anything else.",
  "phase7LiveTradingReady is ALWAYS false: Phase 7 (live/burner trading) remains unauthorized and cannot be authorized from here.",
  ...SIMULATION_PACKAGE_DISCLAIMERS,
];

/** Thrown when operator-bundle INPUT or a produced bundle is structurally invalid. */
export class Phase6OperatorBundleV1Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Phase6OperatorBundleV1Error";
  }
}

// --- model -------------------------------------------------------------------

/** The bundle roles (stable order — the chain's build order, then audit, readiness, handoff). */
export const PHASE6_OPERATOR_BUNDLE_ROLES = [
  "decision",
  "run-report",
  "safety-gates",
  "prereqs",
  "kill-switch-spec",
  "secrets-policy",
  "burner-isolation-spec",
  "intent-plan",
  "simulation-result",
  "route-resolution",
  "audit-report",
  "readiness-report",
  "handoff-pack",
] as const;

/** One of the bundle roles. */
export type Phase6OperatorBundleRole = (typeof PHASE6_OPERATOR_BUNDLE_ROLES)[number];

/** The closed operator-verdict set (conservative precedence; `reviewable-paper-only` is the BEST
 * possible verdict — there is deliberately no "ready" and no live wording). */
export const PHASE6_OPERATOR_BUNDLE_VERDICTS = [
  "blocked",
  "incomplete",
  "attention",
  "reviewable-paper-only",
] as const;

/** One of the closed operator verdicts. */
export type Phase6OperatorBundleVerdict = (typeof PHASE6_OPERATOR_BUNDLE_VERDICTS)[number];

/** A flat structured summary (scalars only — no prose is ever parsed to build it). */
export type Phase6OperatorBundleSummary = Record<string, string | number | boolean | null>;

/** One bundled artifact's state + summary (the handoff pack's per-role shape, reused). */
export interface Phase6OperatorBundleArtifact {
  role: Phase6OperatorBundleRole;
  expectedSchemaVersion: string;
  present: boolean;
  /** null when absent; otherwise whether the strict validator accepted it. */
  valid: boolean | null;
  /** The sniffed schemaVersion of what was supplied (null when absent/unsniffable). */
  suppliedSchemaVersion: string | null;
  /** The artifact's own label (sourceLabel/operatorLabel/planLabel/packLabel), when valid. */
  label: string | null;
  /** The redacted validation error when present-but-invalid; null otherwise. */
  error: string | null;
  /** Flat structured summary of the VALID artifact's verbatim fields; null otherwise. */
  summary: Phase6OperatorBundleSummary | null;
}

/** The required digest format: a sha256 truncated to 128 bits, self-describing. (Truncated ON
 * PURPOSE — the shared redactor treats any 64-hex blob as key-shaped and would redact it.) */
export const PHASE6_OPERATOR_BUNDLE_DIGEST_PATTERN = /^sha256-128:[0-9a-f]{32}$/;

/** One optional per-role file reference (integrity refs the CALLER computed; carried verbatim). */
export interface Phase6OperatorBundleFileRef {
  role: Phase6OperatorBundleRole;
  /** The file name/path label the caller read the artifact from; null when not file-backed. */
  fileName: string | null;
  /** Truncated digest of the file bytes (`sha256-128:<32 hex>`); null when not file-backed. */
  digest: string | null;
}

/** The full, deterministic, JSON-serializable Phase 6 operator bundle. */
export interface Phase6OperatorBundleV1 {
  schemaVersion: string;
  banner: string;
  generatedBy: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  // --- the literal safety locks (validated; can never be anything else) ---
  neverAuthorizesLiveTrading: true;
  neverSigns: true;
  neverSends: true;
  dryRunOnly: true;
  /** ALWAYS false — an operator bundle can never claim live-trading readiness (validated literal). */
  phase7LiveTradingReady: false;
  disclaimers: string[];
  operatorLabel: string | null;
  bundleLabel: string | null;
  artifacts: Phase6OperatorBundleArtifact[];
  /** Per-role file references (stable role order; null refs for non-file-backed roles). */
  files: Phase6OperatorBundleFileRef[];
  /** Roles that were not supplied (stable role order). */
  missingRoles: Phase6OperatorBundleRole[];
  /** Roles that were supplied but failed strict validation (stable role order). */
  invalidRoles: Phase6OperatorBundleRole[];
  /** True iff every bundled artifact is present AND strictly valid. */
  complete: boolean;
  /** Blocking conditions RECOMPUTED from the bundled plan/result/route/audit/readiness (deduped,
   * verbatim union — the same recipe the handoff pack uses over its inputs). */
  chainBlockingCodes: SimulationReasonCode[];
  hasBlockingConditions: boolean;
  /** The handoff pack's own carried blocking codes, VERBATIM (null when no valid pack). */
  handoffChainBlockingCodes: SimulationReasonCode[] | null;
  /** Whether the pack's trail equals the recomputed one; null when not fully recomputable
   * (pack or any of the five simulation-side sources missing/invalid). */
  blockingTrailConsistent: boolean | null;
  /** The run report's operator-blocking reasons, VERBATIM opaque strings (never parsed). */
  operatorBlockingReasons: string[];
  /** The route artifact's resolution status, VERBATIM (null when no valid route artifact). */
  routeResolutionStatus: string | null;
  /** Whether a route resolver was actually attempted, VERBATIM (null when no valid route artifact). */
  routeResolverAttempted: boolean | null;
  /** The route artifact's live-state caveat, VERBATIM (null when no valid route artifact). */
  routeLiveStateCaveat: boolean | null;
  /** The readiness verdict VERBATIM (null when no valid readiness report was supplied). */
  simulationReadyPerReadiness: boolean | null;
  /** The closed-set operator verdict (recomputed by the validator; never better than
   * `reviewable-paper-only`). */
  operatorVerdict: Phase6OperatorBundleVerdict;
  /** One deterministic operator sentence: what this bundle covers and where it stands. */
  whatHappened: string;
  /** Deterministic operator lines explaining every blocking condition (empty when none). */
  whyBlocked: string[];
  /** Deterministic operator pointers for the next inspection step. */
  whatToInspectNext: string[];
  presentCount: number;
  validCount: number;
  missingCount: number;
  invalidCount: number;
  notes: string[];
}

/** Everything {@link buildPhase6OperatorBundleV1} needs. Every artifact is optional — a missing
 * one is CLASSIFIED as missing (never invented, never a throw). */
export interface BuildPhase6OperatorBundleV1Input {
  /** `sniper.paper.decision.report.v2`. */
  decision?: unknown;
  /** `sniper.run.report.v2`. */
  runReport?: unknown;
  /** `sniper.safety.gates.report.v2`. */
  safetyGates?: unknown;
  /** `phase6.prerequisite.report.v2`. */
  prereqs?: unknown;
  /** `sniper.kill_switch.spec.v1`. */
  killSwitchSpec?: unknown;
  /** `sniper.secrets.policy.v1`. */
  secretsPolicy?: unknown;
  /** `sniper.burner.isolation.spec.v1`. */
  burnerIsolationSpec?: unknown;
  /** `simulation.intent.plan.v2`. */
  intentPlan?: unknown;
  /** `simulation.result.v1`. */
  simulationResult?: unknown;
  /** `simulation.route.resolution.v1`. */
  routeResolution?: unknown;
  /** `phase6.audit.report.v1`. */
  auditReport?: unknown;
  /** `phase6.simulation.readiness.report.v1`. */
  readinessReport?: unknown;
  /** `phase6.simulation.handoff.pack.v1`. */
  handoffPack?: unknown;
  /** Optional per-role file references (fileName + truncated digest the CALLER computed from disk). */
  files?: Partial<Record<Phase6OperatorBundleRole, { fileName: string; digest: string }>>;
  /** Optional operator label echoed into the bundle. */
  operatorLabel?: string | null;
  /** Optional bundle label echoed into the bundle. */
  bundleLabel?: string | null;
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function sniff(value: unknown): string | null {
  return isObject(value) && typeof value.schemaVersion === "string" ? value.schemaVersion : null;
}

interface Checked<T> {
  artifact: T | null;
  state: Phase6OperatorBundleArtifact;
}

function check<T>(
  role: Phase6OperatorBundleRole,
  expected: string,
  value: unknown,
  validate: (v: unknown) => T,
  labelOf: (a: T) => string | null,
  summarize: (a: T) => Phase6OperatorBundleSummary,
): Checked<T> {
  if (value === undefined || value === null) {
    return {
      artifact: null,
      state: { role, expectedSchemaVersion: expected, present: false, valid: null, suppliedSchemaVersion: null, label: null, error: null, summary: null },
    };
  }
  const supplied = sniff(value);
  try {
    const artifact = validate(value);
    return {
      artifact,
      state: { role, expectedSchemaVersion: expected, present: true, valid: true, suppliedSchemaVersion: supplied, label: labelOf(artifact), error: null, summary: summarize(artifact) },
    };
  } catch (err) {
    return {
      artifact: null,
      state: {
        role,
        expectedSchemaVersion: expected,
        present: true,
        valid: false,
        suppliedSchemaVersion: supplied,
        label: null,
        error: redactString((err as Error).message),
        summary: null,
      },
    };
  }
}

/** The five simulation-side roles whose codes feed the recomputed blocking trail. */
const TRAIL_SOURCE_ROLES: readonly Phase6OperatorBundleRole[] = [
  "intent-plan",
  "simulation-result",
  "route-resolution",
  "audit-report",
  "readiness-report",
];

/** The deterministic closed-set verdict (a pure function of the bundle's structured state). */
function verdictOf(
  invalidCount: number,
  hasBlockingConditions: boolean,
  blockingTrailConsistent: boolean | null,
  missingCount: number,
  simulationReadyPerReadiness: boolean | null,
  routeLiveStateCaveat: boolean | null,
): Phase6OperatorBundleVerdict {
  if (invalidCount > 0 || hasBlockingConditions || blockingTrailConsistent === false) return "blocked";
  if (missingCount > 0) return "incomplete";
  if (simulationReadyPerReadiness !== true || routeLiveStateCaveat === true) return "attention";
  return "reviewable-paper-only";
}

/** The deterministic one-line what-happened summary (pure function of structured state). */
function whatHappenedOf(bundle: {
  validCount: number;
  missingCount: number;
  invalidCount: number;
  chainBlockingCodes: readonly string[];
  routeResolutionStatus: string | null;
  simulationReadyPerReadiness: boolean | null;
  operatorVerdict: Phase6OperatorBundleVerdict;
}): string {
  const readiness =
    bundle.simulationReadyPerReadiness === null
      ? "unknown (no valid readiness report)"
      : bundle.simulationReadyPerReadiness
        ? "phase6 SIMULATION ready (never live readiness)"
        : "NOT ready";
  return (
    `One PAPER dry-run chain collected: ${bundle.validCount}/${PHASE6_OPERATOR_BUNDLE_ROLES.length} artifacts strictly valid` +
    ` (${bundle.missingCount} missing, ${bundle.invalidCount} invalid);` +
    ` ${bundle.chainBlockingCodes.length} chain blocking condition(s);` +
    ` route resolution: ${bundle.routeResolutionStatus ?? "unknown (no valid route artifact)"};` +
    ` readiness verdict (verbatim): ${readiness};` +
    ` operator verdict: ${bundle.operatorVerdict}.`
  );
}

/** The deterministic why-blocked operator lines (pure function of structured state). */
function whyBlockedOf(
  invalidRoles: readonly Phase6OperatorBundleRole[],
  blockingTrailConsistent: boolean | null,
  chainBlockingCodes: readonly SimulationReasonCode[],
): string[] {
  const lines: string[] = [];
  for (const role of invalidRoles) {
    lines.push(`${role}: the supplied artifact failed strict validation — fix or rebuild it (its redacted error is carried in artifacts[].error).`);
  }
  if (blockingTrailConsistent === false) {
    lines.push(
      "handoff-pack: its chainBlockingCodes disagree with the codes recomputed from the bundled artifacts — the pack was not built from THIS artifact set (stale or tampered); rebuild it over these artifacts.",
    );
  }
  for (const code of chainBlockingCodes) {
    lines.push(`${code}: ${SIMULATION_REASON_CODE_DEFINITIONS[code].operatorMessage}`);
  }
  return lines;
}

/** The deterministic what-to-inspect-next operator pointers (pure function of structured state). */
function whatToInspectNextOf(
  verdict: Phase6OperatorBundleVerdict,
  invalidCount: number,
  blockingTrailConsistent: boolean | null,
  hasBlockingConditions: boolean,
  routeResolutionStatus: string | null,
  simulationReadyPerReadiness: boolean | null,
  routeLiveStateCaveat: boolean | null,
): string[] {
  const lines: string[] = [];
  if (verdict === "blocked") {
    if (invalidCount > 0) {
      lines.push("Re-validate the invalid artifacts (paper:simulation:validate for simulation artifacts; their own commands otherwise) and rebuild them.");
    }
    if (blockingTrailConsistent === false) {
      lines.push("Rebuild the handoff pack from THIS artifact set with paper:simulation:handoff, then rebuild this bundle.");
    }
    if (hasBlockingConditions) {
      lines.push("Resolve the chain blocking conditions listed verbatim above, rebuild the affected artifacts, then re-run paper:simulation:audit.");
    }
  } else if (verdict === "incomplete") {
    lines.push("Supply or rebuild the missing artifacts (roles listed in missingRoles), then rebuild this bundle — an incomplete chain is reported honestly, never papered over.");
  } else if (verdict === "attention") {
    if (simulationReadyPerReadiness !== true) {
      lines.push("Build or repair the readiness report (paper:simulation:readiness) until it is strictly valid and green, then rebuild this bundle.");
    }
    if (routeLiveStateCaveat === true) {
      lines.push("At least one route fact is label-resolved from LIVE chain state — review the route artifact's caveat before trusting cross-run comparisons.");
    }
  } else {
    lines.push("Review the bundle and archive or hand it off — still SIMULATION ONLY: nothing here signs, sends, or authorizes live trading, and Phase 7 remains unauthorized.");
  }
  if (routeResolutionStatus === "unavailable") {
    lines.push("Route resolution is honestly UNAVAILABLE (no route-resolver capability exists inside this boundary) — that is the expected Phase 6 state, not an error.");
  }
  return lines;
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link Phase6OperatorBundleV1}. Pure and non-mutating. Every supplied
 * artifact is strictly validated in place and summarized from verbatim structured fields; a
 * missing artifact is CLASSIFIED as missing and an invalid one carries its redacted error — state
 * is never invented. The chain's blocking conditions are recomputed from the bundled artifacts and
 * cross-checked against the handoff pack's verbatim trail. The produced bundle is self-validated
 * before returning. Throws {@link Phase6OperatorBundleV1Error} only on a malformed input SHAPE.
 */
export function buildPhase6OperatorBundleV1(
  input: BuildPhase6OperatorBundleV1Input = {},
): Phase6OperatorBundleV1 {
  if (!isObject(input)) throw new Phase6OperatorBundleV1Error("operator bundle input must be an object");
  for (const f of ["operatorLabel", "bundleLabel"] as const) {
    if (input[f] !== undefined && input[f] !== null && typeof input[f] !== "string") {
      throw new Phase6OperatorBundleV1Error(`operator bundle input.${f} must be a string or null when present`);
    }
  }
  if (input.files !== undefined && !isObject(input.files)) {
    throw new Phase6OperatorBundleV1Error("operator bundle input.files must be an object when present");
  }
  for (const [role, ref] of Object.entries(input.files ?? {})) {
    if (!(PHASE6_OPERATOR_BUNDLE_ROLES as readonly string[]).includes(role)) {
      throw new Phase6OperatorBundleV1Error(`operator bundle input.files carries an unknown role "${role}"`);
    }
    if (!isObject(ref) || !nonEmptyString(ref.fileName) || typeof ref.digest !== "string" || !PHASE6_OPERATOR_BUNDLE_DIGEST_PATTERN.test(ref.digest)) {
      throw new Phase6OperatorBundleV1Error(
        `operator bundle input.files["${role}"] must carry a non-empty fileName and a "sha256-128:<32 hex>" digest`,
      );
    }
  }

  // 1) Validate + summarize every artifact in place (verbatim structured fields only).
  const decision = check<SniperPaperDecisionReportV2>("decision", SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION,
    input.decision, validatePaperSniperDecisionReportV2, (a) => a.sourceLabel,
    (a) => ({ decisionCount: a.decisions.length, paperEnterCount: a.paperEnterCount, hasPaperEnter: a.hasPaperEnter, unknownCount: a.unknownCount }));
  const runReport = check<SniperRunReportV2>("run-report", SNIPER_RUN_REPORT_V2_SCHEMA_VERSION,
    input.runReport, (v) => {
      const supplied = sniff(v);
      if (supplied !== null && supplied !== SNIPER_RUN_REPORT_V2_SCHEMA_VERSION) {
        throw new Error(`run report must be ${SNIPER_RUN_REPORT_V2_SCHEMA_VERSION} (got "${supplied}")`);
      }
      return validateSniperRunReportV2(v);
    }, (a) => a.operatorLabel,
    (a) => ({ candidateCount: a.candidateCount, operatorBlockingReasonCount: a.operatorBlockingReasons.length, unresolvedUnknownCount: a.unresolvedUnknownIds.length, upgradedFromV1: a.upgradedFromV1 }));
  const gates = check<SniperSafetyGatesReportV2>("safety-gates", SNIPER_SAFETY_GATES_REPORT_V2_SCHEMA_VERSION,
    input.safetyGates, validateSniperSafetyGatesReportV2, (a) => a.operatorLabel,
    (a) => ({ ready: a.ready, failCount: a.failCount }));
  const prereqs = check<Phase6PrerequisiteReportV2>("prereqs", PHASE6_PREREQUISITE_REPORT_V2_SCHEMA_VERSION,
    input.prereqs, validatePhase6PrerequisiteReportV2, (a) => a.operatorLabel,
    (a) => ({ phase6ImplementationReady: a.phase6ImplementationReady, notMetCount: a.notMet.length }));
  const killSwitch = check<SniperKillSwitchSpec>("kill-switch-spec", SNIPER_KILL_SWITCH_SPEC_SCHEMA_VERSION,
    input.killSwitchSpec, validateSniperKillSwitchSpec, (a) => a.operatorLabel,
    (a) => ({ adopted: a.adopted, readinessStatus: a.readinessStatus }));
  const secretsPolicy = check<SniperSecretsPolicy>("secrets-policy", SNIPER_SECRETS_POLICY_SCHEMA_VERSION,
    input.secretsPolicy, validateSniperSecretsPolicy, (a) => a.operatorLabel,
    (a) => ({ adopted: a.adopted, readinessStatus: a.readinessStatus }));
  const burnerIsolation = check<SniperBurnerIsolationSpec>("burner-isolation-spec", SNIPER_BURNER_ISOLATION_SPEC_SCHEMA_VERSION,
    input.burnerIsolationSpec, validateSniperBurnerIsolationSpec, (a) => a.operatorLabel,
    (a) => ({ adopted: a.adopted, readinessStatus: a.readinessStatus }));
  const intentPlan = check<SimulationIntentPlanV2>("intent-plan", SIMULATION_INTENT_PLAN_V2_SCHEMA_VERSION,
    input.intentPlan, validateSimulationIntentPlanV2, (a) => a.planLabel,
    (a) => ({ blocked: a.blocked, entryCount: a.entryCount, unresolvedEntryCount: a.unresolvedEntryCount, acknowledgmentApplied: a.paperEnterReviewAcknowledgmentApplied }));
  const simulationResult = check<SimulationResultV1>("simulation-result", SIMULATION_RESULT_V1_SCHEMA_VERSION,
    input.simulationResult, validateSimulationResultV1, (a) => a.sourcePlanRef.planLabel,
    (a) => ({ resultStatus: a.resultStatus, entryCount: a.entryCount, dryRunAttempted: a.dryRunAttempted, adapterId: a.adapterSummary.adapterId }));
  const routeResolution = check<SimulationRouteResolutionV1>("route-resolution", SIMULATION_ROUTE_RESOLUTION_V1_SCHEMA_VERSION,
    input.routeResolution, validateSimulationRouteResolutionV1, (a) => a.resolutionLabel,
    (a) => ({ resolutionStatus: a.resolutionStatus, blocked: a.blocked, entryCount: a.entryCount, unavailableEntryCount: a.unavailableEntryCount, liveStateCaveat: a.liveStateCaveat, routeResolverAttempted: a.routeResolverAttempted }));
  const auditReport = check<Phase6AuditReportV1>("audit-report", PHASE6_AUDIT_REPORT_V1_SCHEMA_VERSION,
    input.auditReport, validatePhase6AuditReportV1, (a) => a.operatorLabel,
    (a) => ({ auditPassed: a.auditPassed, chainComplete: a.chainComplete, blockingFindingCount: a.blockingFindingCount, chainConditionCount: a.chainConditionCodes.length }));
  const readinessReport = check<Phase6SimulationReadinessReportV1>("readiness-report", PHASE6_SIMULATION_READINESS_REPORT_V1_SCHEMA_VERSION,
    input.readinessReport, validatePhase6SimulationReadinessReportV1, (a) => a.operatorLabel,
    (a) => ({ phase6SimulationReady: a.phase6SimulationReady, blockingCount: a.blockingReasonCodes.length, declaredEvidenceCount: a.evidence.filter((e) => e.declared).length }));
  const handoffPack = check<Phase6SimulationHandoffPackV1>("handoff-pack", PHASE6_SIMULATION_HANDOFF_PACK_V1_SCHEMA_VERSION,
    input.handoffPack, validatePhase6SimulationHandoffPackV1, (a) => a.packLabel,
    (a) => ({ complete: a.complete, validCount: a.validCount, chainBlockingCount: a.chainBlockingCodes.length, hasBlockingConditions: a.hasBlockingConditions, simulationReadyPerReadiness: a.simulationReadyPerReadiness, operatorBlockingReasonCount: a.operatorBlockingReasons.length }));

  const all = [decision, runReport, gates, prereqs, killSwitch, secretsPolicy, burnerIsolation, intentPlan, simulationResult, routeResolution, auditReport, readinessReport, handoffPack];
  const artifacts = all.map((a) => a.state);

  // 2) File references (verbatim caller-supplied integrity refs; never computed here).
  const fileRefs: Partial<Record<Phase6OperatorBundleRole, { fileName: string; digest: string }>> = input.files ?? {};
  const files: Phase6OperatorBundleFileRef[] = PHASE6_OPERATOR_BUNDLE_ROLES.map((role) => {
    const ref = fileRefs[role];
    const state = artifacts[PHASE6_OPERATOR_BUNDLE_ROLES.indexOf(role)]!;
    if (ref && !state.present) {
      throw new Phase6OperatorBundleV1Error(
        `operator bundle input.files["${role}"] references a file for a role whose artifact was not supplied`,
      );
    }
    return { role, fileName: ref?.fileName ?? null, digest: ref?.digest ?? null };
  });

  // 3) Verdicts — every one derived from structured state; nothing invented.
  const missingRoles = artifacts.filter((a) => !a.present).map((a) => a.role);
  const invalidRoles = artifacts.filter((a) => a.valid === false).map((a) => a.role);
  const presentCount = artifacts.filter((a) => a.present).length;
  const validCount = artifacts.filter((a) => a.valid === true).length;
  const complete = validCount === PHASE6_OPERATOR_BUNDLE_ROLES.length;

  const chainBlockingCodes = dedupeSimulationReasonCodes([
    ...(intentPlan.artifact?.blockingReasonCodes ?? []),
    ...(simulationResult.artifact?.blockedReasonCodes ?? []),
    ...(routeResolution.artifact?.blockingReasonCodes ?? []),
    ...(auditReport.artifact?.chainConditionCodes ?? []),
    ...(readinessReport.artifact?.blockingReasonCodes ?? []),
  ]);
  const hasBlockingConditions = chainBlockingCodes.length > 0;
  const handoffChainBlockingCodes = handoffPack.artifact ? [...handoffPack.artifact.chainBlockingCodes] : null;
  const trailRecomputable =
    handoffPack.artifact !== null &&
    TRAIL_SOURCE_ROLES.every((role) => artifacts[PHASE6_OPERATOR_BUNDLE_ROLES.indexOf(role)]!.valid === true);
  const blockingTrailConsistent = trailRecomputable
    ? JSON.stringify(handoffChainBlockingCodes) === JSON.stringify(chainBlockingCodes)
    : null;
  const operatorBlockingReasons = [...(runReport.artifact?.operatorBlockingReasons ?? [])];
  const routeResolutionStatus = routeResolution.artifact?.resolutionStatus ?? null;
  const routeResolverAttempted = routeResolution.artifact?.routeResolverAttempted ?? null;
  const routeLiveStateCaveat = routeResolution.artifact?.liveStateCaveat ?? null;
  const simulationReadyPerReadiness = readinessReport.artifact?.phase6SimulationReady ?? null;

  const operatorVerdict = verdictOf(invalidRoles.length, hasBlockingConditions, blockingTrailConsistent, missingRoles.length, simulationReadyPerReadiness, routeLiveStateCaveat);
  const whyBlocked = whyBlockedOf(invalidRoles, blockingTrailConsistent, chainBlockingCodes);
  const whatToInspectNext = whatToInspectNextOf(operatorVerdict, invalidRoles.length, blockingTrailConsistent, hasBlockingConditions, routeResolutionStatus, simulationReadyPerReadiness, routeLiveStateCaveat);

  const notes = [
    `${validCount}/${PHASE6_OPERATOR_BUNDLE_ROLES.length} bundled artifacts strictly valid (${missingRoles.length} missing, ${invalidRoles.length} invalid); ${chainBlockingCodes.length} chain blocking condition(s) recomputed from the bundled artifacts.`,
    "Every summary is verbatim structured fields from a strictly-validated artifact — a missing artifact is classified as missing, never invented.",
    "File references (fileName + truncated sha256-128 digest) are caller-supplied integrity refs carried verbatim — this package computes no digest and does no I/O.",
    "This bundle archives SIMULATION state only: it never signs, never sends, never authorizes live trading, and phase7LiveTradingReady is literally false.",
  ];

  const bundle: Phase6OperatorBundleV1 = {
    schemaVersion: PHASE6_OPERATOR_BUNDLE_V1_SCHEMA_VERSION,
    banner: PHASE6_OPERATOR_BUNDLE_V1_BANNER,
    generatedBy: PHASE6_OPERATOR_BUNDLE_V1_GENERATED_BY,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    ...SIMULATION_SAFETY_LITERALS,
    phase7LiveTradingReady: false,
    disclaimers: [...PHASE6_OPERATOR_BUNDLE_V1_DISCLAIMERS],
    operatorLabel: nonEmptyString(input.operatorLabel) ? input.operatorLabel : null,
    bundleLabel: nonEmptyString(input.bundleLabel) ? input.bundleLabel : null,
    artifacts,
    files,
    missingRoles,
    invalidRoles,
    complete,
    chainBlockingCodes,
    hasBlockingConditions,
    handoffChainBlockingCodes,
    blockingTrailConsistent,
    operatorBlockingReasons,
    routeResolutionStatus,
    routeResolverAttempted,
    routeLiveStateCaveat,
    simulationReadyPerReadiness,
    operatorVerdict,
    whatHappened: whatHappenedOf({
      validCount,
      missingCount: missingRoles.length,
      invalidCount: invalidRoles.length,
      chainBlockingCodes,
      routeResolutionStatus,
      simulationReadyPerReadiness,
      operatorVerdict,
    }),
    whyBlocked,
    whatToInspectNext,
    presentCount,
    validCount,
    missingCount: missingRoles.length,
    invalidCount: invalidRoles.length,
    notes,
  };
  // Self-check: the builder's own output must pass the strict validator (defense in depth).
  return validatePhase6OperatorBundleV1(bundle);
}

// --- validation (backstop) ---------------------------------------------------

function validateSummary(value: unknown, where: string): Phase6OperatorBundleSummary | null {
  if (value === null) return null;
  if (!isObject(value)) throw new Phase6OperatorBundleV1Error(`${where} must be an object or null`);
  for (const [k, v] of Object.entries(value)) {
    if (v !== null && typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
      throw new Phase6OperatorBundleV1Error(`${where}.${k} must be a scalar (string|number|boolean|null)`);
    }
  }
  return value as Phase6OperatorBundleSummary;
}

function validateArtifactState(value: unknown, where: string): Phase6OperatorBundleArtifact {
  if (!isObject(value)) throw new Phase6OperatorBundleV1Error(`${where} must be an object`);
  if (typeof value.role !== "string" || !(PHASE6_OPERATOR_BUNDLE_ROLES as readonly string[]).includes(value.role)) {
    throw new Phase6OperatorBundleV1Error(`${where}.role must be one of the known bundle roles`);
  }
  if (!nonEmptyString(value.expectedSchemaVersion)) {
    throw new Phase6OperatorBundleV1Error(`${where}.expectedSchemaVersion must be a non-empty string`);
  }
  if (typeof value.present !== "boolean") throw new Phase6OperatorBundleV1Error(`${where}.present must be a boolean`);
  if (value.valid !== null && typeof value.valid !== "boolean") {
    throw new Phase6OperatorBundleV1Error(`${where}.valid must be a boolean or null`);
  }
  if (value.present === false && value.valid !== null) {
    throw new Phase6OperatorBundleV1Error(`${where}.valid must be null when absent`);
  }
  for (const f of ["suppliedSchemaVersion", "label", "error"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new Phase6OperatorBundleV1Error(`${where}.${f} must be a string or null`);
    }
  }
  const summary = validateSummary(value.summary, `${where}.summary`);
  if ((value.valid === true) !== (summary !== null)) {
    throw new Phase6OperatorBundleV1Error(`${where}.summary must be present exactly when the artifact is valid`);
  }
  if (value.valid === false && value.error === null) {
    throw new Phase6OperatorBundleV1Error(`${where}.error must carry the validation error when invalid`);
  }
  return value as unknown as Phase6OperatorBundleArtifact;
}

function validateFileRef(value: unknown, where: string, state: Phase6OperatorBundleArtifact): Phase6OperatorBundleFileRef {
  if (!isObject(value)) throw new Phase6OperatorBundleV1Error(`${where} must be an object`);
  if (value.role !== state.role) {
    throw new Phase6OperatorBundleV1Error(`${where}.role must keep the stable role order ("${state.role}")`);
  }
  const hasName = value.fileName !== null;
  const hasDigest = value.digest !== null;
  if (hasName !== hasDigest) {
    throw new Phase6OperatorBundleV1Error(`${where} must carry fileName and digest together or both null`);
  }
  if (hasName && !nonEmptyString(value.fileName)) {
    throw new Phase6OperatorBundleV1Error(`${where}.fileName must be a non-empty string or null`);
  }
  if (hasDigest && (typeof value.digest !== "string" || !PHASE6_OPERATOR_BUNDLE_DIGEST_PATTERN.test(value.digest))) {
    throw new Phase6OperatorBundleV1Error(`${where}.digest must be a "sha256-128:<32 hex>" digest or null`);
  }
  if (hasName && !state.present) {
    throw new Phase6OperatorBundleV1Error(`${where} references a file for a role whose artifact is absent`);
  }
  return value as unknown as Phase6OperatorBundleFileRef;
}

/**
 * Strictly validate a value as a {@link Phase6OperatorBundleV1} and return it narrowed. Enforces
 * the literal safety locks (including the always-false `phase7LiveTradingReady`), the full stable
 * role list, per-artifact state consistency (summary ⇔ valid), the per-role file-reference shape,
 * the recomputed role lists / counts / completeness, known-code blocking trails (including the
 * recomputable lower AND upper bounds against the embedded valid summaries), the recomputed
 * trail-consistency verdict, the verbatim route/readiness mirrors, the recomputed closed-set
 * operator verdict, and the recomputed deterministic operator text. Throws
 * {@link Phase6OperatorBundleV1Error} (or a SimulationSafetyError for a flipped lock) on the
 * first problem. Pure.
 */
export function validatePhase6OperatorBundleV1(value: unknown): Phase6OperatorBundleV1 {
  if (!isObject(value)) throw new Phase6OperatorBundleV1Error("operator bundle must be a JSON object");
  if (value.schemaVersion !== PHASE6_OPERATOR_BUNDLE_V1_SCHEMA_VERSION) {
    throw new Phase6OperatorBundleV1Error(`operator bundle.schemaVersion must be "${PHASE6_OPERATOR_BUNDLE_V1_SCHEMA_VERSION}"`);
  }
  if (value.banner !== PHASE6_OPERATOR_BUNDLE_V1_BANNER) {
    throw new Phase6OperatorBundleV1Error(`operator bundle.banner must be "${PHASE6_OPERATOR_BUNDLE_V1_BANNER}"`);
  }
  if (value.generatedBy !== PHASE6_OPERATOR_BUNDLE_V1_GENERATED_BY) {
    throw new Phase6OperatorBundleV1Error(`operator bundle.generatedBy must be "${PHASE6_OPERATOR_BUNDLE_V1_GENERATED_BY}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new Phase6OperatorBundleV1Error(`operator bundle.${flag} must be true`);
  }
  assertSimulationSafetyLiterals(value, "operator bundle");
  if (value.phase7LiveTradingReady !== false) {
    throw new Phase6OperatorBundleV1Error(
      "operator bundle.phase7LiveTradingReady must be literally false — an operator bundle can never claim live-trading readiness",
    );
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new Phase6OperatorBundleV1Error("operator bundle.disclaimers must be a non-empty array");
  }
  for (const f of ["operatorLabel", "bundleLabel"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new Phase6OperatorBundleV1Error(`operator bundle.${f} must be a string or null`);
    }
  }
  if (!Array.isArray(value.artifacts) || value.artifacts.length !== PHASE6_OPERATOR_BUNDLE_ROLES.length) {
    throw new Phase6OperatorBundleV1Error(`operator bundle.artifacts must list all ${PHASE6_OPERATOR_BUNDLE_ROLES.length} bundle roles`);
  }
  const artifacts = (value.artifacts as unknown[]).map((a, i) => validateArtifactState(a, `operator bundle.artifacts[${i}]`));
  if (artifacts.map((a) => a.role).join("|") !== PHASE6_OPERATOR_BUNDLE_ROLES.join("|")) {
    throw new Phase6OperatorBundleV1Error("operator bundle.artifacts must keep the stable role order");
  }
  if (!Array.isArray(value.files) || value.files.length !== PHASE6_OPERATOR_BUNDLE_ROLES.length) {
    throw new Phase6OperatorBundleV1Error(`operator bundle.files must list all ${PHASE6_OPERATOR_BUNDLE_ROLES.length} bundle roles`);
  }
  (value.files as unknown[]).forEach((f, i) => validateFileRef(f, `operator bundle.files[${i}]`, artifacts[i]!));

  const expectedMissing = artifacts.filter((a) => !a.present).map((a) => a.role);
  const expectedInvalid = artifacts.filter((a) => a.valid === false).map((a) => a.role);
  if (JSON.stringify(value.missingRoles) !== JSON.stringify(expectedMissing)) {
    throw new Phase6OperatorBundleV1Error("operator bundle.missingRoles must equal the recomputed list");
  }
  if (JSON.stringify(value.invalidRoles) !== JSON.stringify(expectedInvalid)) {
    throw new Phase6OperatorBundleV1Error("operator bundle.invalidRoles must equal the recomputed list");
  }
  const expectedValid = artifacts.filter((a) => a.valid === true).length;
  const tallies: ReadonlyArray<readonly [string, number]> = [
    ["presentCount", artifacts.filter((a) => a.present).length],
    ["validCount", expectedValid],
    ["missingCount", expectedMissing.length],
    ["invalidCount", expectedInvalid.length],
  ];
  for (const [field, expected] of tallies) {
    if (value[field] !== expected) {
      throw new Phase6OperatorBundleV1Error(`operator bundle.${field} must equal the recomputed tally (${expected})`);
    }
  }
  if (typeof value.complete !== "boolean" || value.complete !== (expectedValid === PHASE6_OPERATOR_BUNDLE_ROLES.length)) {
    throw new Phase6OperatorBundleV1Error("operator bundle.complete must be true exactly when every artifact is valid");
  }

  if (!Array.isArray(value.chainBlockingCodes) || (value.chainBlockingCodes as unknown[]).some((c) => !isSimulationReasonCode(c))) {
    throw new Phase6OperatorBundleV1Error("operator bundle.chainBlockingCodes must be an array of known simulation reason codes");
  }
  const chainBlockingCodes = value.chainBlockingCodes as SimulationReasonCode[];
  if (value.hasBlockingConditions !== (chainBlockingCodes.length > 0)) {
    throw new Phase6OperatorBundleV1Error("operator bundle.hasBlockingConditions must mirror chainBlockingCodes");
  }
  // The exact code set is not recomputable from flat summaries, but BOTH bounds are: every valid
  // source artifact enforces its own blocked ⇔ codes-present consistency, so (a) a bundle whose
  // embedded summaries carry blocking state can never honestly carry zero codes, and (b) a bundle
  // whose five trail sources are ALL valid and ALL clean can never honestly carry any.
  const summaryOf = (role: Phase6OperatorBundleRole): Phase6OperatorBundleSummary | null => {
    const s = artifacts[PHASE6_OPERATOR_BUNDLE_ROLES.indexOf(role)]!;
    return s.valid === true ? s.summary : null;
  };
  const planSummary = summaryOf("intent-plan");
  const resultSummary = summaryOf("simulation-result");
  const routeSummary = summaryOf("route-resolution");
  const auditSummary = summaryOf("audit-report");
  const readinessSummary = summaryOf("readiness-report");
  const summarySignalsBlocking =
    planSummary?.blocked === true ||
    resultSummary?.resultStatus === "blocked" ||
    routeSummary?.blocked === true ||
    (typeof auditSummary?.chainConditionCount === "number" && auditSummary.chainConditionCount > 0) ||
    (typeof readinessSummary?.blockingCount === "number" && readinessSummary.blockingCount > 0);
  if (summarySignalsBlocking && chainBlockingCodes.length === 0) {
    throw new Phase6OperatorBundleV1Error(
      "operator bundle.chainBlockingCodes cannot be empty while an embedded valid artifact summary carries blocking state",
    );
  }
  const allTrailSourcesValid = TRAIL_SOURCE_ROLES.every(
    (role) => artifacts[PHASE6_OPERATOR_BUNDLE_ROLES.indexOf(role)]!.valid === true,
  );
  if (allTrailSourcesValid && !summarySignalsBlocking && chainBlockingCodes.length > 0) {
    throw new Phase6OperatorBundleV1Error(
      "operator bundle.chainBlockingCodes must be empty while every valid trail-source summary is clean",
    );
  }

  const handoffState = artifacts[PHASE6_OPERATOR_BUNDLE_ROLES.indexOf("handoff-pack")]!;
  if (handoffState.valid === true) {
    if (
      !Array.isArray(value.handoffChainBlockingCodes) ||
      (value.handoffChainBlockingCodes as unknown[]).some((c) => !isSimulationReasonCode(c))
    ) {
      throw new Phase6OperatorBundleV1Error(
        "operator bundle.handoffChainBlockingCodes must be an array of known simulation reason codes when the handoff pack is valid",
      );
    }
    const expectedCount = handoffState.summary!.chainBlockingCount;
    if ((value.handoffChainBlockingCodes as unknown[]).length !== expectedCount) {
      throw new Phase6OperatorBundleV1Error(
        "operator bundle.handoffChainBlockingCodes must match the embedded handoff summary's chainBlockingCount",
      );
    }
  } else if (value.handoffChainBlockingCodes !== null) {
    throw new Phase6OperatorBundleV1Error(
      "operator bundle.handoffChainBlockingCodes must be null when no valid handoff pack is bundled",
    );
  }
  const expectedTrailConsistent =
    handoffState.valid === true && allTrailSourcesValid
      ? JSON.stringify(value.handoffChainBlockingCodes) === JSON.stringify(chainBlockingCodes)
      : null;
  if (value.blockingTrailConsistent !== expectedTrailConsistent) {
    throw new Phase6OperatorBundleV1Error(
      "operator bundle.blockingTrailConsistent must equal the recomputed consistency verdict (null when not fully recomputable)",
    );
  }

  if (!Array.isArray(value.operatorBlockingReasons) || (value.operatorBlockingReasons as unknown[]).some((x) => typeof x !== "string")) {
    throw new Phase6OperatorBundleV1Error("operator bundle.operatorBlockingReasons must be an array of strings");
  }

  // The verbatim route mirrors must agree with the embedded route summary (null when missing/invalid).
  const expectedRouteStatus = routeSummary !== null ? (routeSummary.resolutionStatus as string) : null;
  if (value.routeResolutionStatus !== expectedRouteStatus) {
    throw new Phase6OperatorBundleV1Error("operator bundle.routeResolutionStatus must mirror the embedded route summary (null when missing/invalid)");
  }
  if (expectedRouteStatus !== null && !(SIMULATION_ROUTE_RESOLUTION_STATUSES as readonly string[]).includes(expectedRouteStatus)) {
    throw new Phase6OperatorBundleV1Error("operator bundle.routeResolutionStatus must be one of the known route-resolution statuses");
  }
  const expectedRouteAttempted = routeSummary !== null ? (routeSummary.routeResolverAttempted as boolean) : null;
  if (value.routeResolverAttempted !== expectedRouteAttempted) {
    throw new Phase6OperatorBundleV1Error("operator bundle.routeResolverAttempted must mirror the embedded route summary (null when missing/invalid)");
  }
  const expectedRouteCaveat = routeSummary !== null ? (routeSummary.liveStateCaveat as boolean) : null;
  if (value.routeLiveStateCaveat !== expectedRouteCaveat) {
    throw new Phase6OperatorBundleV1Error("operator bundle.routeLiveStateCaveat must mirror the embedded route summary (null when missing/invalid)");
  }

  const readinessState = artifacts[PHASE6_OPERATOR_BUNDLE_ROLES.indexOf("readiness-report")]!;
  const expectedReadiness =
    readinessState.valid === true ? (readinessState.summary!.phase6SimulationReady as boolean) : null;
  if (value.simulationReadyPerReadiness !== expectedReadiness) {
    throw new Phase6OperatorBundleV1Error(
      "operator bundle.simulationReadyPerReadiness must mirror the embedded readiness summary (null when missing/invalid)",
    );
  }

  const expectedVerdict = verdictOf(
    expectedInvalid.length,
    value.hasBlockingConditions as boolean,
    value.blockingTrailConsistent as boolean | null,
    expectedMissing.length,
    value.simulationReadyPerReadiness as boolean | null,
    value.routeLiveStateCaveat as boolean | null,
  );
  if (value.operatorVerdict !== expectedVerdict) {
    throw new Phase6OperatorBundleV1Error(`operator bundle.operatorVerdict must equal the recomputed verdict ("${expectedVerdict}")`);
  }
  const expectedWhatHappened = whatHappenedOf({
    validCount: expectedValid,
    missingCount: expectedMissing.length,
    invalidCount: expectedInvalid.length,
    chainBlockingCodes,
    routeResolutionStatus: value.routeResolutionStatus as string | null,
    simulationReadyPerReadiness: value.simulationReadyPerReadiness as boolean | null,
    operatorVerdict: expectedVerdict,
  });
  if (value.whatHappened !== expectedWhatHappened) {
    throw new Phase6OperatorBundleV1Error("operator bundle.whatHappened must equal the recomputed deterministic summary");
  }
  const expectedWhyBlocked = whyBlockedOf(expectedInvalid, value.blockingTrailConsistent as boolean | null, chainBlockingCodes);
  if (JSON.stringify(value.whyBlocked) !== JSON.stringify(expectedWhyBlocked)) {
    throw new Phase6OperatorBundleV1Error("operator bundle.whyBlocked must equal the recomputed deterministic lines");
  }
  const expectedInspectNext = whatToInspectNextOf(
    expectedVerdict,
    expectedInvalid.length,
    value.blockingTrailConsistent as boolean | null,
    value.hasBlockingConditions as boolean,
    value.routeResolutionStatus as string | null,
    value.simulationReadyPerReadiness as boolean | null,
    value.routeLiveStateCaveat as boolean | null,
  );
  if (JSON.stringify(value.whatToInspectNext) !== JSON.stringify(expectedInspectNext)) {
    throw new Phase6OperatorBundleV1Error("operator bundle.whatToInspectNext must equal the recomputed deterministic pointers");
  }
  if (!Array.isArray(value.notes) || (value.notes as unknown[]).some((x) => typeof x !== "string")) {
    throw new Phase6OperatorBundleV1Error("operator bundle.notes must be an array of strings");
  }
  return value as unknown as Phase6OperatorBundleV1;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatPhase6OperatorBundleV1}. */
export interface FormatPhase6OperatorBundleV1Options {
  label?: string;
}

/**
 * Render a redacted, stable, human-readable operator bundle. Deterministic and path-stable. Leads
 * with the archive/review framing and the closed-set operator verdict, then the deterministic
 * what-happened line, every artifact's state + file reference, the recomputed blocking trail with
 * its handoff consistency verdict, the why-blocked lines, and the what-to-inspect-next pointers.
 * Never phrases anything as an execution, a trade, or live readiness. Passed through the shared
 * redactor.
 */
export function formatPhase6OperatorBundleV1(
  bundle: Phase6OperatorBundleV1,
  opts: FormatPhase6OperatorBundleV1Options = {},
): string {
  const header =
    "PHASE 6 OPERATOR BUNDLE — ARCHIVE/REVIEW ONLY (simulation only; does not sign; does not send; does not authorize live trading)";
  const lines: string[] = [header, "=".repeat(header.length)];
  lines.push(SIMULATION_OPERATOR_SAFETY_LINE);
  lines.push(`artifact: ${bundle.schemaVersion}`);
  if (opts.label) lines.push(`label:    ${opts.label}`);
  if (bundle.operatorLabel) lines.push(`operator: ${bundle.operatorLabel}`);
  lines.push(`bundle:   ${bundle.bundleLabel ?? "(unlabeled)"}`);
  lines.push(`verdict:  ${bundle.operatorVerdict}`);
  lines.push("");
  lines.push(`What happened: ${bundle.whatHappened}`);
  lines.push(`chain:    ${bundle.validCount}/${PHASE6_OPERATOR_BUNDLE_ROLES.length} artifacts strictly valid${bundle.complete ? " — COMPLETE" : ` (${bundle.missingCount} missing, ${bundle.invalidCount} invalid)`}`);
  lines.push(`blocking: ${bundle.hasBlockingConditions ? `${bundle.chainBlockingCodes.length} chain blocking condition(s) — recomputed from the bundled artifacts; carried below` : "none recomputed from the bundled artifacts"}`);
  lines.push(
    `handoff trail: ${
      bundle.blockingTrailConsistent === null
        ? "not fully recomputable (handoff pack or a trail source missing/invalid)"
        : bundle.blockingTrailConsistent
          ? "CONSISTENT with the handoff pack's verbatim codes"
          : "INCONSISTENT with the handoff pack's verbatim codes — stale or tampered pack"
    }`,
  );
  lines.push(`route:    ${bundle.routeResolutionStatus ?? "unknown — no valid route artifact"}${bundle.routeResolverAttempted === false ? " (no resolver attempted — honest boundary)" : ""}`);
  lines.push(`readiness verdict (verbatim): ${bundle.simulationReadyPerReadiness === null ? "unknown — no valid readiness report supplied" : bundle.simulationReadyPerReadiness ? "phase6 SIMULATION ready (never live readiness)" : "NOT ready"}`);

  lines.push("");
  lines.push("Artifacts:");
  for (let i = 0; i < bundle.artifacts.length; i++) {
    const a = bundle.artifacts[i]!;
    const f = bundle.files[i]!;
    const state = a.present
      ? a.valid
        ? "present, valid"
        : `present, INVALID (supplied ${a.suppliedSchemaVersion ?? "unknown"})`
      : "MISSING (classified, not invented)";
    lines.push(`- ${a.role}: ${state}${a.label ? `  [${a.label}]` : ""}`);
    if (f.fileName) lines.push(`    file: ${f.fileName}  digest: ${f.digest}`);
    if (a.summary) {
      const parts = Object.entries(a.summary).map(([k, v]) => `${k}=${v === null ? "null" : String(v)}`);
      lines.push(`    ${parts.join("  ")}`);
    }
    if (a.error) lines.push(`    error: ${a.error}`);
  }

  if (bundle.whyBlocked.length > 0) {
    lines.push("");
    lines.push("Why blocked (deterministic; codes verbatim, never re-judged):");
    for (const reason of bundle.whyBlocked) lines.push(`✗ ${reason}`);
  }

  if (bundle.operatorBlockingReasons.length > 0) {
    lines.push("");
    lines.push("Operator-blocking reasons (verbatim from the run report):");
    for (const r of bundle.operatorBlockingReasons) lines.push(`- ${r}`);
  }

  lines.push("");
  lines.push(`Next safe action: ${bundle.whatToInspectNext[0] ?? "Rebuild this bundle from a strictly-validated chain."}`);
  for (const step of bundle.whatToInspectNext.slice(1)) lines.push(`- ${step}`);

  lines.push("");
  lines.push("Notes:");
  for (const note of bundle.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of bundle.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
