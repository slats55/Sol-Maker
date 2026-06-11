/**
 * Deterministic, offline **PHASE 6 SIMULATION HANDOFF PACK** (`phase6.simulation.handoff.pack.v1`,
 * Sprint 75 — the simulation-aware session/handoff bundle).
 *
 * The sniper session pack v2 honestly classifies simulation artifacts as `unsupported` — it
 * predates them. This pack is the simulation-aware handoff: TWELVE chain artifacts (the ten
 * audited roles — Sprint 87 added the route-resolution artifact — plus the chain audit and the
 * readiness report) are each strictly validated in place and summarized from STRUCTURED FIELDS
 * ONLY, so an operator (or the next session) can pick up exactly where this one left off:
 *
 *   - per-artifact presence / validity / supplied schema / label / flat structured summary
 *     (a missing artifact is CLASSIFIED as missing — state is never invented for it)
 *   - the chain's own blocking conditions, carried VERBATIM from the plan / result / audit /
 *     readiness vocabularies (never waived, never re-judged)
 *   - the run report's operator-blocking reasons, carried VERBATIM as opaque strings
 *   - the readiness verdict carried VERBATIM (`null` when no readiness report was supplied —
 *     never guessed)
 *   - one deterministic NEXT SAFE ACTION derived from the pack's own structured state
 *
 * The hard line, validated as literals: the four safety locks always hold and
 * `phase7LiveTradingReady` is ALWAYS false — a handoff pack can never claim or authorize live
 * trading. Pure: no I/O, no network, no wallet, no wall-clock.
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
  type SimulationRouteResolutionV1,
} from "./route-resolution.js";

/** Stable schema identifier for the Phase 6 handoff pack. Bump only on a breaking change. */
export const PHASE6_SIMULATION_HANDOFF_PACK_V1_SCHEMA_VERSION = "phase6.simulation.handoff.pack.v1";

/** The banner that prefixes every handoff pack (required label). */
export const PHASE6_SIMULATION_HANDOFF_PACK_V1_BANNER =
  "PHASE 6 SIMULATION HANDOFF PACK (SESSION HANDOFF ONLY — SIMULATION ONLY, NEVER SIGNS, NEVER SENDS, NEVER AUTHORIZES LIVE TRADING)";

/** The fixed `generatedBy` marker (deterministic provenance; never an operator value). */
export const PHASE6_SIMULATION_HANDOFF_PACK_V1_GENERATED_BY = "@soulmaker/simulation";

/** Required disclaimer statements carried by every handoff pack (stable order). */
export const PHASE6_SIMULATION_HANDOFF_PACK_V1_DISCLAIMERS: readonly string[] = [
  "PHASE 6 SIMULATION HANDOFF PACK — twelve chain artifacts strictly validated in place and summarized from STRUCTURED FIELDS ONLY; a missing artifact is classified as missing, never invented.",
  "The chain's blocking conditions and the readiness verdict are carried VERBATIM — this pack reports them; it never waives, re-judges, or authorizes anything.",
  "phase7LiveTradingReady is ALWAYS false: a handoff pack is structurally incapable of claiming live-trading readiness, and the validator refuses anything else.",
  ...SIMULATION_PACKAGE_DISCLAIMERS,
];

/** Thrown when handoff-pack INPUT or a produced pack is structurally invalid. */
export class Phase6SimulationHandoffPackV1Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Phase6SimulationHandoffPackV1Error";
  }
}

// --- model -------------------------------------------------------------------

/** The handoff roles (stable order — the chain's build order, then audit, then readiness; Sprint
 * 87 added `route-resolution`, a CONSCIOUS fail-closed bump: an eleven-role pre-S87 handoff pack
 * no longer validates and must be rebuilt over the current chain). */
export const PHASE6_HANDOFF_ROLES = [
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
] as const;

/** One of the handoff roles. */
export type Phase6HandoffRole = (typeof PHASE6_HANDOFF_ROLES)[number];

/** A flat structured summary (scalars only — no prose is ever parsed to build it). */
export type Phase6HandoffSummary = Record<string, string | number | boolean | null>;

/** One handoff artifact's state + summary. */
export interface Phase6HandoffArtifact {
  role: Phase6HandoffRole;
  expectedSchemaVersion: string;
  present: boolean;
  /** null when absent; otherwise whether the strict validator accepted it. */
  valid: boolean | null;
  /** The sniffed schemaVersion of what was supplied (null when absent/unsniffable). */
  suppliedSchemaVersion: string | null;
  /** The artifact's own label (sourceLabel/operatorLabel/planLabel), when valid. */
  label: string | null;
  /** The redacted validation error when present-but-invalid; null otherwise. */
  error: string | null;
  /** Flat structured summary of the VALID artifact's verbatim fields; null otherwise. */
  summary: Phase6HandoffSummary | null;
}

/** The full, deterministic, JSON-serializable Phase 6 handoff pack. */
export interface Phase6SimulationHandoffPackV1 {
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
  /** ALWAYS false — a handoff pack can never claim live-trading readiness (validated literal). */
  phase7LiveTradingReady: false;
  disclaimers: string[];
  operatorLabel: string | null;
  packLabel: string | null;
  artifacts: Phase6HandoffArtifact[];
  /** Roles that were not supplied (stable role order). */
  missingRoles: Phase6HandoffRole[];
  /** Roles that were supplied but failed strict validation (stable role order). */
  invalidRoles: Phase6HandoffRole[];
  /** True iff every handoff artifact is present AND strictly valid. */
  complete: boolean;
  /** The chain's own blocking conditions, VERBATIM from plan/result/audit/readiness (deduped). */
  chainBlockingCodes: SimulationReasonCode[];
  hasBlockingConditions: boolean;
  /** The run report's operator-blocking reasons, VERBATIM opaque strings (never parsed). */
  operatorBlockingReasons: string[];
  /** The readiness verdict VERBATIM (null when no valid readiness report was supplied). */
  simulationReadyPerReadiness: boolean | null;
  /** One deterministic next safe action, derived from this pack's own structured state. */
  nextSafeAction: string;
  presentCount: number;
  validCount: number;
  missingCount: number;
  invalidCount: number;
  notes: string[];
}

/** Everything {@link buildPhase6SimulationHandoffPackV1} needs. Every artifact is optional — a
 * missing one is CLASSIFIED as missing (never invented, never a throw). */
export interface BuildPhase6SimulationHandoffPackV1Input {
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
  /** Optional operator label echoed into the pack. */
  operatorLabel?: string | null;
  /** Optional pack label echoed into the pack. */
  packLabel?: string | null;
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
  state: Phase6HandoffArtifact;
}

function check<T>(
  role: Phase6HandoffRole,
  expected: string,
  value: unknown,
  validate: (v: unknown) => T,
  labelOf: (a: T) => string | null,
  summarize: (a: T) => Phase6HandoffSummary,
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

/** The deterministic next safe action (a pure function of the pack's structured verdicts). */
function nextSafeActionOf(
  complete: boolean,
  hasBlockingConditions: boolean,
  simulationReadyPerReadiness: boolean | null,
): string {
  if (!complete) {
    return "Supply or rebuild the missing/invalid artifacts above, then rebuild this handoff pack — an incomplete chain is handed off honestly, never papered over.";
  }
  if (hasBlockingConditions) {
    return "Resolve the chain's blocking conditions (carried verbatim above), rebuild the affected artifacts, then rebuild this handoff pack — nothing downstream may proceed over a blocked chain.";
  }
  if (simulationReadyPerReadiness !== true) {
    return "Build or repair the readiness report (paper:simulation:readiness) until it is strictly valid and green, then rebuild this handoff pack.";
  }
  return "Review the pack with the next operator/session. The Phase 6 SIMULATION chain is assembled and green — still simulation only: nothing here signs, sends, or authorizes live trading, and Phase 7 remains unauthorized.";
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link Phase6SimulationHandoffPackV1}. Pure and non-mutating. Every
 * supplied artifact is strictly validated in place and summarized from verbatim structured
 * fields; a missing artifact is CLASSIFIED as missing and an invalid one carries its redacted
 * error — state is never invented. The chain's blocking conditions, the run report's
 * operator-blocking reasons, and the readiness verdict are carried VERBATIM. The produced pack is
 * self-validated before returning. Throws {@link Phase6SimulationHandoffPackV1Error} only on a
 * malformed input SHAPE.
 */
export function buildPhase6SimulationHandoffPackV1(
  input: BuildPhase6SimulationHandoffPackV1Input = {},
): Phase6SimulationHandoffPackV1 {
  if (!isObject(input)) throw new Phase6SimulationHandoffPackV1Error("phase6 handoff input must be an object");
  for (const f of ["operatorLabel", "packLabel"] as const) {
    if (input[f] !== undefined && input[f] !== null && typeof input[f] !== "string") {
      throw new Phase6SimulationHandoffPackV1Error(`phase6 handoff input.${f} must be a string or null when present`);
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

  const all = [decision, runReport, gates, prereqs, killSwitch, secretsPolicy, burnerIsolation, intentPlan, simulationResult, routeResolution, auditReport, readinessReport];
  const artifacts = all.map((a) => a.state);

  // 2) Verdicts — every one derived from structured state; nothing invented.
  const missingRoles = artifacts.filter((a) => !a.present).map((a) => a.role);
  const invalidRoles = artifacts.filter((a) => a.valid === false).map((a) => a.role);
  const presentCount = artifacts.filter((a) => a.present).length;
  const validCount = artifacts.filter((a) => a.valid === true).length;
  const complete = validCount === PHASE6_HANDOFF_ROLES.length;

  const chainBlockingCodes = dedupeSimulationReasonCodes([
    ...(intentPlan.artifact?.blockingReasonCodes ?? []),
    ...(simulationResult.artifact?.blockedReasonCodes ?? []),
    ...(routeResolution.artifact?.blockingReasonCodes ?? []),
    ...(auditReport.artifact?.chainConditionCodes ?? []),
    ...(readinessReport.artifact?.blockingReasonCodes ?? []),
  ]);
  const hasBlockingConditions = chainBlockingCodes.length > 0;
  const operatorBlockingReasons = [...(runReport.artifact?.operatorBlockingReasons ?? [])];
  const simulationReadyPerReadiness = readinessReport.artifact?.phase6SimulationReady ?? null;
  const nextSafeAction = nextSafeActionOf(complete, hasBlockingConditions, simulationReadyPerReadiness);

  const notes = [
    `${validCount}/${PHASE6_HANDOFF_ROLES.length} handoff artifacts strictly valid (${missingRoles.length} missing, ${invalidRoles.length} invalid); ${chainBlockingCodes.length} chain blocking condition(s) carried verbatim.`,
    "Every summary is verbatim structured fields from a strictly-validated artifact — a missing artifact is classified as missing, never invented.",
    "This pack hands off SIMULATION state only: it never signs, never sends, never authorizes live trading, and phase7LiveTradingReady is literally false.",
  ];

  const pack: Phase6SimulationHandoffPackV1 = {
    schemaVersion: PHASE6_SIMULATION_HANDOFF_PACK_V1_SCHEMA_VERSION,
    banner: PHASE6_SIMULATION_HANDOFF_PACK_V1_BANNER,
    generatedBy: PHASE6_SIMULATION_HANDOFF_PACK_V1_GENERATED_BY,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    ...SIMULATION_SAFETY_LITERALS,
    phase7LiveTradingReady: false,
    disclaimers: [...PHASE6_SIMULATION_HANDOFF_PACK_V1_DISCLAIMERS],
    operatorLabel: nonEmptyString(input.operatorLabel) ? input.operatorLabel : null,
    packLabel: nonEmptyString(input.packLabel) ? input.packLabel : null,
    artifacts,
    missingRoles,
    invalidRoles,
    complete,
    chainBlockingCodes,
    hasBlockingConditions,
    operatorBlockingReasons,
    simulationReadyPerReadiness,
    nextSafeAction,
    presentCount,
    validCount,
    missingCount: missingRoles.length,
    invalidCount: invalidRoles.length,
    notes,
  };
  // Self-check: the builder's own output must pass the strict validator (defense in depth).
  return validatePhase6SimulationHandoffPackV1(pack);
}

// --- validation (backstop) ---------------------------------------------------

function validateSummary(value: unknown, where: string): Phase6HandoffSummary | null {
  if (value === null) return null;
  if (!isObject(value)) throw new Phase6SimulationHandoffPackV1Error(`${where} must be an object or null`);
  for (const [k, v] of Object.entries(value)) {
    if (v !== null && typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
      throw new Phase6SimulationHandoffPackV1Error(`${where}.${k} must be a scalar (string|number|boolean|null)`);
    }
  }
  return value as Phase6HandoffSummary;
}

function validateArtifactState(value: unknown, where: string): Phase6HandoffArtifact {
  if (!isObject(value)) throw new Phase6SimulationHandoffPackV1Error(`${where} must be an object`);
  if (typeof value.role !== "string" || !(PHASE6_HANDOFF_ROLES as readonly string[]).includes(value.role)) {
    throw new Phase6SimulationHandoffPackV1Error(`${where}.role must be one of the known handoff roles`);
  }
  if (!nonEmptyString(value.expectedSchemaVersion)) {
    throw new Phase6SimulationHandoffPackV1Error(`${where}.expectedSchemaVersion must be a non-empty string`);
  }
  if (typeof value.present !== "boolean") throw new Phase6SimulationHandoffPackV1Error(`${where}.present must be a boolean`);
  if (value.valid !== null && typeof value.valid !== "boolean") {
    throw new Phase6SimulationHandoffPackV1Error(`${where}.valid must be a boolean or null`);
  }
  if (value.present === false && value.valid !== null) {
    throw new Phase6SimulationHandoffPackV1Error(`${where}.valid must be null when absent`);
  }
  for (const f of ["suppliedSchemaVersion", "label", "error"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new Phase6SimulationHandoffPackV1Error(`${where}.${f} must be a string or null`);
    }
  }
  const summary = validateSummary(value.summary, `${where}.summary`);
  if ((value.valid === true) !== (summary !== null)) {
    throw new Phase6SimulationHandoffPackV1Error(`${where}.summary must be present exactly when the artifact is valid`);
  }
  if (value.valid === false && value.error === null) {
    throw new Phase6SimulationHandoffPackV1Error(`${where}.error must carry the validation error when invalid`);
  }
  return value as unknown as Phase6HandoffArtifact;
}

/**
 * Strictly validate a value as a {@link Phase6SimulationHandoffPackV1} and return it narrowed.
 * Enforces the literal safety locks (including the always-false `phase7LiveTradingReady`), the
 * full stable role list, per-artifact state consistency (summary ⇔ valid), the recomputed
 * role lists / counts / completeness, known-code blocking conditions (including the recomputable
 * lower bound: zero blocking codes are refused while an embedded valid summary carries blocking
 * state), the verbatim-readiness consistency, and the recomputed deterministic next safe action. Throws
 * {@link Phase6SimulationHandoffPackV1Error} (or a SimulationSafetyError for a flipped lock) on
 * the first problem. Pure.
 */
export function validatePhase6SimulationHandoffPackV1(value: unknown): Phase6SimulationHandoffPackV1 {
  if (!isObject(value)) throw new Phase6SimulationHandoffPackV1Error("phase6 handoff pack must be a JSON object");
  if (value.schemaVersion !== PHASE6_SIMULATION_HANDOFF_PACK_V1_SCHEMA_VERSION) {
    throw new Phase6SimulationHandoffPackV1Error(`phase6 handoff pack.schemaVersion must be "${PHASE6_SIMULATION_HANDOFF_PACK_V1_SCHEMA_VERSION}"`);
  }
  if (value.banner !== PHASE6_SIMULATION_HANDOFF_PACK_V1_BANNER) {
    throw new Phase6SimulationHandoffPackV1Error(`phase6 handoff pack.banner must be "${PHASE6_SIMULATION_HANDOFF_PACK_V1_BANNER}"`);
  }
  if (value.generatedBy !== PHASE6_SIMULATION_HANDOFF_PACK_V1_GENERATED_BY) {
    throw new Phase6SimulationHandoffPackV1Error(`phase6 handoff pack.generatedBy must be "${PHASE6_SIMULATION_HANDOFF_PACK_V1_GENERATED_BY}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new Phase6SimulationHandoffPackV1Error(`phase6 handoff pack.${flag} must be true`);
  }
  assertSimulationSafetyLiterals(value, "phase6 handoff pack");
  if (value.phase7LiveTradingReady !== false) {
    throw new Phase6SimulationHandoffPackV1Error(
      "phase6 handoff pack.phase7LiveTradingReady must be literally false — a handoff pack can never claim live-trading readiness",
    );
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new Phase6SimulationHandoffPackV1Error("phase6 handoff pack.disclaimers must be a non-empty array");
  }
  for (const f of ["operatorLabel", "packLabel"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new Phase6SimulationHandoffPackV1Error(`phase6 handoff pack.${f} must be a string or null`);
    }
  }
  if (!Array.isArray(value.artifacts) || value.artifacts.length !== PHASE6_HANDOFF_ROLES.length) {
    throw new Phase6SimulationHandoffPackV1Error(`phase6 handoff pack.artifacts must list all ${PHASE6_HANDOFF_ROLES.length} handoff roles`);
  }
  const artifacts = (value.artifacts as unknown[]).map((a, i) => validateArtifactState(a, `phase6 handoff pack.artifacts[${i}]`));
  if (artifacts.map((a) => a.role).join("|") !== PHASE6_HANDOFF_ROLES.join("|")) {
    throw new Phase6SimulationHandoffPackV1Error("phase6 handoff pack.artifacts must keep the stable role order");
  }

  const expectedMissing = artifacts.filter((a) => !a.present).map((a) => a.role);
  const expectedInvalid = artifacts.filter((a) => a.valid === false).map((a) => a.role);
  if (JSON.stringify(value.missingRoles) !== JSON.stringify(expectedMissing)) {
    throw new Phase6SimulationHandoffPackV1Error("phase6 handoff pack.missingRoles must equal the recomputed list");
  }
  if (JSON.stringify(value.invalidRoles) !== JSON.stringify(expectedInvalid)) {
    throw new Phase6SimulationHandoffPackV1Error("phase6 handoff pack.invalidRoles must equal the recomputed list");
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
      throw new Phase6SimulationHandoffPackV1Error(`phase6 handoff pack.${field} must equal the recomputed tally (${expected})`);
    }
  }
  if (typeof value.complete !== "boolean" || value.complete !== (expectedValid === PHASE6_HANDOFF_ROLES.length)) {
    throw new Phase6SimulationHandoffPackV1Error("phase6 handoff pack.complete must be true exactly when every artifact is valid");
  }

  if (!Array.isArray(value.chainBlockingCodes) || (value.chainBlockingCodes as unknown[]).some((c) => !isSimulationReasonCode(c))) {
    throw new Phase6SimulationHandoffPackV1Error("phase6 handoff pack.chainBlockingCodes must be an array of known simulation reason codes");
  }
  if (value.hasBlockingConditions !== ((value.chainBlockingCodes as unknown[]).length > 0)) {
    throw new Phase6SimulationHandoffPackV1Error("phase6 handoff pack.hasBlockingConditions must mirror chainBlockingCodes");
  }
  // The exact code set is not recomputable from flat summaries, but a LOWER BOUND is: every
  // valid source artifact enforces its own blocked ⇔ codes-present consistency, so a pack whose
  // embedded summaries carry blocking state can never honestly carry zero blocking codes.
  const summaryOf = (role: Phase6HandoffRole): Phase6HandoffSummary | null => {
    const s = artifacts[PHASE6_HANDOFF_ROLES.indexOf(role)]!;
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
  if (summarySignalsBlocking && (value.chainBlockingCodes as unknown[]).length === 0) {
    throw new Phase6SimulationHandoffPackV1Error(
      "phase6 handoff pack.chainBlockingCodes cannot be empty while an embedded valid artifact summary carries blocking state",
    );
  }
  if (!Array.isArray(value.operatorBlockingReasons) || (value.operatorBlockingReasons as unknown[]).some((x) => typeof x !== "string")) {
    throw new Phase6SimulationHandoffPackV1Error("phase6 handoff pack.operatorBlockingReasons must be an array of strings");
  }
  if (value.simulationReadyPerReadiness !== null && typeof value.simulationReadyPerReadiness !== "boolean") {
    throw new Phase6SimulationHandoffPackV1Error("phase6 handoff pack.simulationReadyPerReadiness must be a boolean or null");
  }
  // The verbatim readiness verdict must agree with the embedded readiness summary (when valid).
  const readinessState = artifacts[PHASE6_HANDOFF_ROLES.indexOf("readiness-report")]!;
  const expectedReadiness =
    readinessState.valid === true ? (readinessState.summary!.phase6SimulationReady as boolean) : null;
  if (value.simulationReadyPerReadiness !== expectedReadiness) {
    throw new Phase6SimulationHandoffPackV1Error(
      "phase6 handoff pack.simulationReadyPerReadiness must mirror the embedded readiness summary (null when missing/invalid)",
    );
  }
  const expectedAction = nextSafeActionOf(
    value.complete as boolean,
    value.hasBlockingConditions as boolean,
    value.simulationReadyPerReadiness as boolean | null,
  );
  if (value.nextSafeAction !== expectedAction) {
    throw new Phase6SimulationHandoffPackV1Error("phase6 handoff pack.nextSafeAction must equal the recomputed deterministic action");
  }
  if (!Array.isArray(value.notes) || (value.notes as unknown[]).some((x) => typeof x !== "string")) {
    throw new Phase6SimulationHandoffPackV1Error("phase6 handoff pack.notes must be an array of strings");
  }
  return value as unknown as Phase6SimulationHandoffPackV1;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatPhase6SimulationHandoffPackV1}. */
export interface FormatPhase6SimulationHandoffPackV1Options {
  label?: string;
}

/**
 * Render a redacted, stable, human-readable handoff pack. Deterministic and path-stable. Leads
 * with the handoff-only framing and the completeness verdict, lists every artifact's state and
 * summary, the verbatim blocking conditions and operator-blocking reasons, the verbatim readiness
 * verdict, and the single deterministic next safe action. Never phrases anything as an execution,
 * a trade, or live readiness. Passed through the shared redactor.
 */
export function formatPhase6SimulationHandoffPackV1(
  pack: Phase6SimulationHandoffPackV1,
  opts: FormatPhase6SimulationHandoffPackV1Options = {},
): string {
  const header =
    "PHASE 6 SIMULATION HANDOFF PACK — SESSION HANDOFF ONLY (simulation only; does not sign; does not send; does not authorize live trading)";
  const lines: string[] = [header, "=".repeat(header.length)];
  lines.push(SIMULATION_OPERATOR_SAFETY_LINE);
  lines.push(`artifact: ${pack.schemaVersion}`);
  if (opts.label) lines.push(`label:    ${opts.label}`);
  if (pack.operatorLabel) lines.push(`operator: ${pack.operatorLabel}`);
  lines.push(`pack:     ${pack.packLabel ?? "(unlabeled)"}`);
  lines.push(`chain:    ${pack.validCount}/${PHASE6_HANDOFF_ROLES.length} artifacts strictly valid${pack.complete ? " — COMPLETE" : ` (${pack.missingCount} missing, ${pack.invalidCount} invalid)`}`);
  lines.push(`blocking: ${pack.hasBlockingConditions ? `${pack.chainBlockingCodes.length} chain blocking condition(s) — carried verbatim below` : "none carried by the chain"}`);
  lines.push(`readiness verdict (verbatim): ${pack.simulationReadyPerReadiness === null ? "unknown — no valid readiness report supplied" : pack.simulationReadyPerReadiness ? "phase6 SIMULATION ready (never live readiness)" : "NOT ready"}`);

  lines.push("");
  lines.push("Artifacts:");
  for (const a of pack.artifacts) {
    const state = a.present
      ? a.valid
        ? "present, valid"
        : `present, INVALID (supplied ${a.suppliedSchemaVersion ?? "unknown"})`
      : "MISSING (classified, not invented)";
    lines.push(`- ${a.role}: ${state}${a.label ? `  [${a.label}]` : ""}`);
    if (a.summary) {
      const parts = Object.entries(a.summary).map(([k, v]) => `${k}=${v === null ? "null" : String(v)}`);
      lines.push(`    ${parts.join("  ")}`);
    }
    if (a.error) lines.push(`    error: ${a.error}`);
  }

  if (pack.chainBlockingCodes.length > 0) {
    lines.push("");
    lines.push("Chain blocking conditions (verbatim; never waived or re-judged):");
    for (const c of pack.chainBlockingCodes) {
      lines.push(`✗ ${c}`);
      lines.push(`    ${SIMULATION_REASON_CODE_DEFINITIONS[c].operatorMessage}`);
    }
  }

  if (pack.operatorBlockingReasons.length > 0) {
    lines.push("");
    lines.push("Operator-blocking reasons (verbatim from the run report):");
    for (const r of pack.operatorBlockingReasons) lines.push(`- ${r}`);
  }

  lines.push("");
  lines.push(`Next safe action: ${pack.nextSafeAction}`);

  lines.push("");
  lines.push("Notes:");
  for (const note of pack.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of pack.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
