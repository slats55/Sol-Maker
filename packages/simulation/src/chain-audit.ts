/**
 * Deterministic, offline **PHASE 6 CHAIN AUDIT** (`phase6.audit.report.v1`, Sprint 67).
 *
 * Closes the known v1-only audit gap: the v1 `sniper.audit.log.v1` walks one run's step trail,
 * but nothing audited the **v2 chain as a chain** — and nothing could audit the simulation
 * artifacts at all. This report does both: each of the TEN chain artifacts (decision v2, run
 * report v2, safety gates v2, prereqs v2, the three governance specs, the simulation intent plan
 * v2, the simulation result v1, and — Sprint 87 — the route-resolution artifact v1) is strictly
 * validated in place, and the chain's STRUCTURED cross-references are checked (plan summary vs.
 * decision, result plan-ref vs. plan, route plan-ref vs. plan — labels, counts, blocked states;
 * never prose). It lives in `@soulmaker/simulation` because the sniper
 * package can never depend on simulation artifacts (the dependency points the other way), and is
 * named in the `phase6.*` family for the same reason. There is no wall-clock here, so
 * "staleness" is exactly what the cross-reference checks can prove: artifacts that disagree were
 * not built from the same chain.
 *
 * Honest split of verdicts:
 *   - `auditPassed`     — NO blocking finding (invalid artifact, v1 stand-in, ref mismatch).
 *     Missing artifacts are warnings: an incomplete chain is reported, not failed.
 *   - `chainComplete`   — every artifact present AND strictly valid.
 *   - `chainConditionCodes` — the chain's own blocking conditions surfaced VERBATIM through the
 *     existing vocabulary (gates not ready, prereqs not ready, spec not adopted, plan/result
 *     blocked). The audit reports them; it never waives or re-judges them.
 *
 * The audit can never authorize live trading (literal locks, validated). Pure: no I/O, no
 * network, no wallet, no wall-clock.
 */

import { redactString } from "@soulmaker/security";
import {
  validatePaperSniperDecisionReportV2,
  SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION,
  SNIPER_PAPER_DECISION_REPORT_SCHEMA_VERSION,
  validateSniperRunReportV2,
  SNIPER_RUN_REPORT_V2_SCHEMA_VERSION,
  SNIPER_RUN_REPORT_SCHEMA_VERSION,
  validateSniperSafetyGatesReportV2,
  SNIPER_SAFETY_GATES_REPORT_V2_SCHEMA_VERSION,
  SNIPER_SAFETY_GATES_REPORT_SCHEMA_VERSION,
  validatePhase6PrerequisiteReportV2,
  PHASE6_PREREQUISITE_REPORT_V2_SCHEMA_VERSION,
  PHASE6_PREREQUISITE_REPORT_SCHEMA_VERSION,
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
  validateSimulationRouteResolutionV1,
  SIMULATION_ROUTE_RESOLUTION_V1_SCHEMA_VERSION,
  type SimulationRouteResolutionV1,
} from "./route-resolution.js";

/** Stable schema identifier for the Phase 6 chain audit. Bump only on a breaking change. */
export const PHASE6_AUDIT_REPORT_V1_SCHEMA_VERSION = "phase6.audit.report.v1";

/** The banner that prefixes every Phase 6 chain audit (required label). */
export const PHASE6_AUDIT_REPORT_V1_BANNER =
  "PHASE 6 CHAIN AUDIT V1 (REPORTS THE CHAIN — NEVER AUTHORIZES ANYTHING)";

/** The fixed `generatedBy` marker (deterministic provenance; never an operator value). */
export const PHASE6_AUDIT_REPORT_V1_GENERATED_BY = "@soulmaker/simulation";

/** Required disclaimer statements carried by every Phase 6 chain audit (stable order). */
export const PHASE6_AUDIT_REPORT_V1_DISCLAIMERS: readonly string[] = [
  "PHASE 6 CHAIN AUDIT — each chain artifact is strictly validated in place and the chain's STRUCTURED cross-references are checked; the audit reports, it never waives, re-judges, or authorizes.",
  ...SIMULATION_PACKAGE_DISCLAIMERS,
];

/** Thrown when chain-audit INPUT or a produced report is structurally invalid. */
export class Phase6AuditReportV1Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Phase6AuditReportV1Error";
  }
}

// --- model -------------------------------------------------------------------

/** The audited chain roles (stable order — the chain's build order; Sprint 87 added
 * `route-resolution`, a CONSCIOUS fail-closed bump: a nine-role pre-S87 audit artifact no longer
 * validates and must be rebuilt over the current chain). */
export const PHASE6_AUDIT_ROLES = [
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
] as const;

/** One of the audited chain roles. */
export type Phase6AuditRole = (typeof PHASE6_AUDIT_ROLES)[number];

/** One audited artifact's state. */
export interface Phase6AuditedArtifact {
  role: Phase6AuditRole;
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
}

/** One audit finding (a stable code + the roles involved + a redacted detail). */
export interface Phase6AuditFinding {
  code: SimulationReasonCode;
  roles: Phase6AuditRole[];
  detail: string;
}

/** The full, deterministic, JSON-serializable Phase 6 chain audit. */
export interface Phase6AuditReportV1 {
  schemaVersion: string;
  banner: string;
  generatedBy: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  // --- the four literal safety locks (validated; can never be anything else) ---
  neverAuthorizesLiveTrading: true;
  neverSigns: true;
  neverSends: true;
  dryRunOnly: true;
  disclaimers: string[];
  operatorLabel: string | null;
  artifacts: Phase6AuditedArtifact[];
  findings: Phase6AuditFinding[];
  /** True iff NO blocking finding exists (missing artifacts are warnings, not failures). */
  auditPassed: boolean;
  /** True iff every audited artifact is present AND strictly valid. */
  chainComplete: boolean;
  /** The chain's own blocking conditions, surfaced VERBATIM (never waived or re-judged). */
  chainConditionCodes: SimulationReasonCode[];
  presentCount: number;
  validCount: number;
  missingCount: number;
  invalidCount: number;
  blockingFindingCount: number;
  notes: string[];
}

/** Everything {@link buildPhase6AuditReportV1} needs. Every artifact is optional — a missing one
 * becomes a warning finding (the audit reports an incomplete chain, it never throws over one). */
export interface BuildPhase6AuditReportV1Input {
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
  /** Optional operator label echoed into the report. */
  operatorLabel?: string | null;
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

interface Audited<T> {
  artifact: T | null;
  state: Phase6AuditedArtifact;
}

function audit<T>(
  role: Phase6AuditRole,
  expected: string,
  value: unknown,
  validate: (v: unknown) => T,
  labelOf: (a: T) => string | null,
): Audited<T> {
  if (value === undefined || value === null) {
    return {
      artifact: null,
      state: { role, expectedSchemaVersion: expected, present: false, valid: null, suppliedSchemaVersion: null, label: null, error: null },
    };
  }
  const supplied = sniff(value);
  try {
    const artifact = validate(value);
    return {
      artifact,
      state: { role, expectedSchemaVersion: expected, present: true, valid: true, suppliedSchemaVersion: supplied, label: labelOf(artifact), error: null },
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
      },
    };
  }
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link Phase6AuditReportV1}. Pure and non-mutating. Every supplied
 * artifact is strictly validated in place; missing artifacts become WARNING findings (the audit
 * reports an incomplete chain rather than failing it); invalid artifacts, v1 stand-ins, and
 * structured cross-reference mismatches become BLOCKING findings (`auditPassed: false`). The
 * chain's own blocking conditions are surfaced verbatim in `chainConditionCodes` through the
 * existing vocabulary — the audit never waives or re-judges them. Throws
 * {@link Phase6AuditReportV1Error} only on a malformed input SHAPE.
 */
export function buildPhase6AuditReportV1(input: BuildPhase6AuditReportV1Input = {}): Phase6AuditReportV1 {
  if (!isObject(input)) throw new Phase6AuditReportV1Error("phase6 audit input must be an object");
  if (input.operatorLabel !== undefined && input.operatorLabel !== null && typeof input.operatorLabel !== "string") {
    throw new Phase6AuditReportV1Error("phase6 audit input.operatorLabel must be a string or null when present");
  }

  // 1) Validate every artifact in place.
  const decision = audit<SniperPaperDecisionReportV2>("decision", SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION,
    input.decision, validatePaperSniperDecisionReportV2, (a) => a.sourceLabel);
  const runReport = audit<SniperRunReportV2>("run-report", SNIPER_RUN_REPORT_V2_SCHEMA_VERSION,
    input.runReport, (v) => {
      const supplied = sniff(v);
      if (supplied !== null && supplied !== SNIPER_RUN_REPORT_V2_SCHEMA_VERSION) {
        throw new Error(`run report must be ${SNIPER_RUN_REPORT_V2_SCHEMA_VERSION} (got "${supplied}")`);
      }
      return validateSniperRunReportV2(v);
    }, (a) => a.operatorLabel);
  const gates = audit<SniperSafetyGatesReportV2>("safety-gates", SNIPER_SAFETY_GATES_REPORT_V2_SCHEMA_VERSION,
    input.safetyGates, validateSniperSafetyGatesReportV2, (a) => a.operatorLabel);
  const prereqs = audit<Phase6PrerequisiteReportV2>("prereqs", PHASE6_PREREQUISITE_REPORT_V2_SCHEMA_VERSION,
    input.prereqs, validatePhase6PrerequisiteReportV2, (a) => a.operatorLabel);
  const killSwitch = audit<SniperKillSwitchSpec>("kill-switch-spec", SNIPER_KILL_SWITCH_SPEC_SCHEMA_VERSION,
    input.killSwitchSpec, validateSniperKillSwitchSpec, (a) => a.operatorLabel);
  const secretsPolicy = audit<SniperSecretsPolicy>("secrets-policy", SNIPER_SECRETS_POLICY_SCHEMA_VERSION,
    input.secretsPolicy, validateSniperSecretsPolicy, (a) => a.operatorLabel);
  const burnerIsolation = audit<SniperBurnerIsolationSpec>("burner-isolation-spec", SNIPER_BURNER_ISOLATION_SPEC_SCHEMA_VERSION,
    input.burnerIsolationSpec, validateSniperBurnerIsolationSpec, (a) => a.operatorLabel);
  const intentPlan = audit<SimulationIntentPlanV2>("intent-plan", SIMULATION_INTENT_PLAN_V2_SCHEMA_VERSION,
    input.intentPlan, validateSimulationIntentPlanV2, (a) => a.planLabel);
  const simulationResult = audit<SimulationResultV1>("simulation-result", SIMULATION_RESULT_V1_SCHEMA_VERSION,
    input.simulationResult, validateSimulationResultV1, (a) => a.sourcePlanRef.planLabel);
  const routeResolution = audit<SimulationRouteResolutionV1>("route-resolution", SIMULATION_ROUTE_RESOLUTION_V1_SCHEMA_VERSION,
    input.routeResolution, validateSimulationRouteResolutionV1, (a) => a.resolutionLabel);

  const all = [decision, runReport, gates, prereqs, killSwitch, secretsPolicy, burnerIsolation, intentPlan, simulationResult, routeResolution];
  const artifacts = all.map((a) => a.state);

  // 2) Findings — missing (warning), invalid / v1 stand-in (blocking).
  const V1_STAND_INS: Partial<Record<Phase6AuditRole, string>> = {
    decision: SNIPER_PAPER_DECISION_REPORT_SCHEMA_VERSION,
    "run-report": SNIPER_RUN_REPORT_SCHEMA_VERSION,
    "safety-gates": SNIPER_SAFETY_GATES_REPORT_SCHEMA_VERSION,
    prereqs: PHASE6_PREREQUISITE_REPORT_SCHEMA_VERSION,
    "intent-plan": "simulation.intent.plan.v1",
  };
  const findings: Phase6AuditFinding[] = [];
  for (const { state } of all) {
    if (!state.present) {
      findings.push({
        code: "audit-artifact-missing",
        roles: [state.role],
        detail: `${state.role} (${state.expectedSchemaVersion}) was not supplied — the chain is incomplete`,
      });
    } else if (state.valid === false) {
      const v1 = V1_STAND_INS[state.role];
      if (v1 !== undefined && state.suppliedSchemaVersion === v1) {
        findings.push({
          code: "audit-v1-artifact",
          roles: [state.role],
          detail: `${state.role} is the v1 artifact "${v1}" — the audited chain requires ${state.expectedSchemaVersion}`,
        });
      } else {
        findings.push({
          code: "audit-artifact-invalid",
          roles: [state.role],
          detail: `${state.role} failed strict validation: ${state.error ?? "unknown error"}`,
        });
      }
    }
  }

  // 3) Structured cross-reference checks (labels/counts/blocked states — never prose).
  if (decision.artifact && intentPlan.artifact) {
    const planDecisionRef = intentPlan.artifact.sourceArtifactRefs.find((r) => r.role === "decision");
    if (intentPlan.artifact.decisionSummary !== null) {
      if (intentPlan.artifact.decisionSummary.paperEnterCount !== decision.artifact.paperEnterCount) {
        findings.push({
          code: "audit-source-ref-mismatch",
          roles: ["decision", "intent-plan"],
          detail: `the intent plan's decision summary says ${intentPlan.artifact.decisionSummary.paperEnterCount} paper-enter(s) but the supplied decision says ${decision.artifact.paperEnterCount} — different chains`,
        });
      }
      if (intentPlan.artifact.decisionSummary.sourceLabel !== decision.artifact.sourceLabel) {
        findings.push({
          code: "audit-source-ref-mismatch",
          roles: ["decision", "intent-plan"],
          detail: "the intent plan's decision source label disagrees with the supplied decision's sourceLabel — different chains",
        });
      }
    }
    if (planDecisionRef && planDecisionRef.valid === true && decision.state.valid === true && planDecisionRef.label !== decision.artifact.sourceLabel) {
      findings.push({
        code: "audit-source-ref-mismatch",
        roles: ["decision", "intent-plan"],
        detail: "the intent plan's decision artifact ref label disagrees with the supplied decision — different chains",
      });
    }
  }
  if (intentPlan.artifact && simulationResult.artifact) {
    const ref = simulationResult.artifact.sourcePlanRef;
    const mismatches: string[] = [];
    if (ref.planLabel !== intentPlan.artifact.planLabel) mismatches.push("planLabel");
    if (ref.operatorLabel !== intentPlan.artifact.operatorLabel) mismatches.push("operatorLabel");
    if (ref.entryCount !== intentPlan.artifact.entryCount) mismatches.push("entryCount");
    if (ref.blocked !== intentPlan.artifact.blocked) mismatches.push("blocked");
    if (mismatches.length > 0) {
      findings.push({
        code: "audit-source-ref-mismatch",
        roles: ["intent-plan", "simulation-result"],
        detail: `the simulation result's plan ref disagrees with the supplied plan on: ${mismatches.join(", ")} — it was built from a different plan`,
      });
    }
  }
  // Sprint 87: the route resolution's plan ref must agree with the audited plan. The route
  // validator already enforces every internal mirror (blocked ⇔ blocking codes recomputed from
  // the ref, entries ⇔ plan entryCount, "resolved" refused without facts), so the audit's job is
  // only the CROSS-artifact question: was this route built from THIS chain's plan?
  if (intentPlan.artifact && routeResolution.artifact) {
    const ref = routeResolution.artifact.sourcePlanRef;
    if (ref.valid === true) {
      const mismatches: string[] = [];
      if (ref.planLabel !== intentPlan.artifact.planLabel) mismatches.push("planLabel");
      if (ref.operatorLabel !== intentPlan.artifact.operatorLabel) mismatches.push("operatorLabel");
      if (ref.entryCount !== intentPlan.artifact.entryCount) mismatches.push("entryCount");
      if (ref.blocked !== intentPlan.artifact.blocked) mismatches.push("blocked");
      if (mismatches.length > 0) {
        findings.push({
          code: "audit-source-ref-mismatch",
          roles: ["intent-plan", "route-resolution"],
          detail: `the route resolution's plan ref disagrees with the supplied plan on: ${mismatches.join(", ")} — it was built from a different plan`,
        });
      }
    } else {
      findings.push({
        code: "audit-source-ref-mismatch",
        roles: ["intent-plan", "route-resolution"],
        detail: "the route resolution records its source plan as missing/invalid while the audited chain supplies a strictly-valid plan — it was not built from this chain's plan",
      });
    }
  }

  const presentCount = artifacts.filter((a) => a.present).length;
  const validCount = artifacts.filter((a) => a.valid === true).length;
  const missingCount = artifacts.filter((a) => !a.present).length;
  const invalidCount = artifacts.filter((a) => a.valid === false).length;
  const chainComplete = validCount === PHASE6_AUDIT_ROLES.length;
  if (chainComplete) {
    findings.push({ code: "audit-chain-complete", roles: [...PHASE6_AUDIT_ROLES], detail: "every audited chain artifact is present and strictly valid" });
  }
  const blockingFindingCount = findings.filter((f) => SIMULATION_REASON_CODE_DEFINITIONS[f.code].blocking).length;
  const auditPassed = blockingFindingCount === 0;

  // 4) The chain's own blocking conditions, surfaced verbatim through the existing vocabulary.
  const conditions: SimulationReasonCode[] = [];
  if (gates.artifact && !gates.artifact.ready) conditions.push("simulation-blocked-gates-not-ready");
  if (prereqs.artifact && !prereqs.artifact.phase6ImplementationReady) conditions.push("simulation-blocked-prereqs-not-ready");
  if (killSwitch.artifact && !killSwitch.artifact.adopted) conditions.push("simulation-blocked-kill-switch-not-adopted");
  if (secretsPolicy.artifact && !secretsPolicy.artifact.adopted) conditions.push("simulation-blocked-secrets-policy-not-adopted");
  if (burnerIsolation.artifact && !burnerIsolation.artifact.adopted) conditions.push("simulation-blocked-burner-isolation-not-adopted");
  if (intentPlan.artifact) conditions.push(...intentPlan.artifact.blockingReasonCodes);
  if (simulationResult.artifact) conditions.push(...simulationResult.artifact.blockedReasonCodes);
  if (routeResolution.artifact) conditions.push(...routeResolution.artifact.blockingReasonCodes);
  const chainConditionCodes = dedupeSimulationReasonCodes(conditions);

  const notes = [
    `${validCount}/${PHASE6_AUDIT_ROLES.length} artifacts present and valid; ${missingCount} missing; ${invalidCount} invalid; ${blockingFindingCount} blocking finding(s); auditPassed=${auditPassed}.`,
    chainConditionCodes.length === 0
      ? "the chain carries no blocking condition of its own"
      : `the chain carries ${chainConditionCodes.length} blocking condition(s) of its own — surfaced verbatim, never waived or re-judged here`,
    "This audit REPORTS the chain. Passing it is never authorization for anything — Phase 7 remains not started and unauthorized.",
  ];

  return {
    schemaVersion: PHASE6_AUDIT_REPORT_V1_SCHEMA_VERSION,
    banner: PHASE6_AUDIT_REPORT_V1_BANNER,
    generatedBy: PHASE6_AUDIT_REPORT_V1_GENERATED_BY,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    ...SIMULATION_SAFETY_LITERALS,
    disclaimers: [...PHASE6_AUDIT_REPORT_V1_DISCLAIMERS],
    operatorLabel: nonEmptyString(input.operatorLabel) ? input.operatorLabel : null,
    artifacts,
    findings,
    auditPassed,
    chainComplete,
    chainConditionCodes,
    presentCount,
    validCount,
    missingCount,
    invalidCount,
    blockingFindingCount,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

function validateAuditedArtifact(value: unknown, where: string): Phase6AuditedArtifact {
  if (!isObject(value)) throw new Phase6AuditReportV1Error(`${where} must be an object`);
  if (typeof value.role !== "string" || !(PHASE6_AUDIT_ROLES as readonly string[]).includes(value.role)) {
    throw new Phase6AuditReportV1Error(`${where}.role must be one of the audited chain roles`);
  }
  if (!nonEmptyString(value.expectedSchemaVersion)) throw new Phase6AuditReportV1Error(`${where}.expectedSchemaVersion must be a non-empty string`);
  if (typeof value.present !== "boolean") throw new Phase6AuditReportV1Error(`${where}.present must be a boolean`);
  if (value.valid !== null && typeof value.valid !== "boolean") throw new Phase6AuditReportV1Error(`${where}.valid must be a boolean or null`);
  if (value.present === false && value.valid !== null) throw new Phase6AuditReportV1Error(`${where}.valid must be null when absent`);
  for (const f of ["suppliedSchemaVersion", "label", "error"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") throw new Phase6AuditReportV1Error(`${where}.${f} must be a string or null`);
  }
  return value as unknown as Phase6AuditedArtifact;
}

/**
 * Strictly validate a value as a {@link Phase6AuditReportV1} and return it narrowed. Enforces the
 * four literal safety locks, the fixed role order, recomputed counts, that `auditPassed` mirrors
 * the blocking findings, and that `chainComplete` mirrors the artifact states. Throws
 * {@link Phase6AuditReportV1Error} (or a SimulationSafetyError for a flipped lock) on the first
 * problem. Pure.
 */
export function validatePhase6AuditReportV1(value: unknown): Phase6AuditReportV1 {
  if (!isObject(value)) throw new Phase6AuditReportV1Error("phase6 audit report must be a JSON object");
  if (value.schemaVersion !== PHASE6_AUDIT_REPORT_V1_SCHEMA_VERSION) {
    throw new Phase6AuditReportV1Error(`phase6 audit report.schemaVersion must be "${PHASE6_AUDIT_REPORT_V1_SCHEMA_VERSION}"`);
  }
  if (value.banner !== PHASE6_AUDIT_REPORT_V1_BANNER) {
    throw new Phase6AuditReportV1Error(`phase6 audit report.banner must be "${PHASE6_AUDIT_REPORT_V1_BANNER}"`);
  }
  if (value.generatedBy !== PHASE6_AUDIT_REPORT_V1_GENERATED_BY) {
    throw new Phase6AuditReportV1Error(`phase6 audit report.generatedBy must be "${PHASE6_AUDIT_REPORT_V1_GENERATED_BY}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new Phase6AuditReportV1Error(`phase6 audit report.${flag} must be true`);
  }
  assertSimulationSafetyLiterals(value, "phase6 audit report");
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new Phase6AuditReportV1Error("phase6 audit report.disclaimers must be a non-empty array");
  }
  if (value.operatorLabel !== null && typeof value.operatorLabel !== "string") {
    throw new Phase6AuditReportV1Error("phase6 audit report.operatorLabel must be a string or null");
  }
  if (!Array.isArray(value.artifacts) || value.artifacts.length !== PHASE6_AUDIT_ROLES.length) {
    throw new Phase6AuditReportV1Error(`phase6 audit report.artifacts must list all ${PHASE6_AUDIT_ROLES.length} chain roles`);
  }
  const artifacts = (value.artifacts as unknown[]).map((a, i) => validateAuditedArtifact(a, `phase6 audit report.artifacts[${i}]`));
  if (artifacts.map((a) => a.role).join("|") !== PHASE6_AUDIT_ROLES.join("|")) {
    throw new Phase6AuditReportV1Error("phase6 audit report.artifacts must keep the stable role order");
  }
  if (!Array.isArray(value.findings)) throw new Phase6AuditReportV1Error("phase6 audit report.findings must be an array");
  const findings = (value.findings as unknown[]).map((f, i) => {
    if (!isObject(f)) throw new Phase6AuditReportV1Error(`phase6 audit report.findings[${i}] must be an object`);
    if (!isSimulationReasonCode(f.code)) throw new Phase6AuditReportV1Error(`phase6 audit report.findings[${i}].code must be a known reason code`);
    if (!Array.isArray(f.roles) || f.roles.length === 0 || (f.roles as unknown[]).some((r) => !(PHASE6_AUDIT_ROLES as readonly string[]).includes(r as string))) {
      throw new Phase6AuditReportV1Error(`phase6 audit report.findings[${i}].roles must be a non-empty array of chain roles`);
    }
    if (!nonEmptyString(f.detail)) throw new Phase6AuditReportV1Error(`phase6 audit report.findings[${i}].detail must be a non-empty string`);
    return f as unknown as Phase6AuditFinding;
  });
  for (const [field, expected] of [
    ["presentCount", artifacts.filter((a) => a.present).length],
    ["validCount", artifacts.filter((a) => a.valid === true).length],
    ["missingCount", artifacts.filter((a) => !a.present).length],
    ["invalidCount", artifacts.filter((a) => a.valid === false).length],
    ["blockingFindingCount", findings.filter((f) => SIMULATION_REASON_CODE_DEFINITIONS[f.code].blocking).length],
  ] as const) {
    if (value[field] !== expected) throw new Phase6AuditReportV1Error(`phase6 audit report.${field} must equal the recomputed tally (${expected})`);
  }
  const expectedComplete = artifacts.every((a) => a.valid === true);
  if (value.chainComplete !== expectedComplete) {
    throw new Phase6AuditReportV1Error("phase6 audit report.chainComplete must mirror the artifact states");
  }
  const expectedPassed = findings.every((f) => !SIMULATION_REASON_CODE_DEFINITIONS[f.code].blocking);
  if (value.auditPassed !== expectedPassed) {
    throw new Phase6AuditReportV1Error("phase6 audit report.auditPassed must mirror the blocking findings");
  }
  if (!Array.isArray(value.chainConditionCodes) || (value.chainConditionCodes as unknown[]).some((c) => !isSimulationReasonCode(c))) {
    throw new Phase6AuditReportV1Error("phase6 audit report.chainConditionCodes must be an array of known reason codes");
  }
  if (!Array.isArray(value.notes) || (value.notes as unknown[]).some((x) => typeof x !== "string")) {
    throw new Phase6AuditReportV1Error("phase6 audit report.notes must be an array of strings");
  }
  return value as unknown as Phase6AuditReportV1;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatPhase6AuditReportV1}. */
export interface FormatPhase6AuditReportV1Options {
  label?: string;
}

/**
 * Render a redacted, stable, human-readable Phase 6 chain audit. Deterministic and path-stable.
 * Leads with the audit verdict and chain completeness, lists each artifact's state, the findings
 * (blocking vs. warning), the chain's own surfaced conditions, and the next safe operator action.
 * Passed through the shared redactor.
 */
export function formatPhase6AuditReportV1(report: Phase6AuditReportV1, opts: FormatPhase6AuditReportV1Options = {}): string {
  const header = "PHASE 6 CHAIN AUDIT (reports the chain — never authorizes anything)";
  const lines: string[] = [header, "=".repeat(header.length)];
  lines.push(SIMULATION_OPERATOR_SAFETY_LINE);
  lines.push(`artifact: ${report.schemaVersion}`);
  if (opts.label) lines.push(`label:    ${opts.label}`);
  if (report.operatorLabel) lines.push(`operator: ${report.operatorLabel}`);
  lines.push(`audit:    ${report.auditPassed ? "PASSED (no blocking finding)" : "FAILED"}  |  chain: ${report.chainComplete ? "COMPLETE" : `incomplete (${report.validCount}/${PHASE6_AUDIT_ROLES.length} valid)`}`);

  lines.push("");
  lines.push("Artifacts:");
  for (const a of report.artifacts) {
    const state = a.present ? (a.valid ? "present, valid" : `present, INVALID (supplied ${a.suppliedSchemaVersion ?? "unknown"})`) : "ABSENT";
    lines.push(`- ${a.role}: ${state}${a.label ? `  [${a.label}]` : ""}`);
    if (a.error) lines.push(`    ${a.error}`);
  }

  lines.push("");
  lines.push(`Findings (${report.findings.length}; ${report.blockingFindingCount} blocking):`);
  if (report.findings.length === 0) lines.push("- (none)");
  for (const f of report.findings) {
    const blocking = SIMULATION_REASON_CODE_DEFINITIONS[f.code].blocking;
    lines.push(`${blocking ? "✗" : SIMULATION_REASON_CODE_DEFINITIONS[f.code].severity === "info" ? "·" : "!"} ${f.code}  [${f.roles.join(", ")}]`);
    lines.push(`    ${f.detail}`);
  }

  if (report.chainConditionCodes.length > 0) {
    lines.push("");
    lines.push("Chain conditions (surfaced verbatim — never waived or re-judged here):");
    for (const c of report.chainConditionCodes) {
      lines.push(`! ${c}`);
      lines.push(`    ${SIMULATION_REASON_CODE_DEFINITIONS[c].operatorMessage}`);
    }
  }

  lines.push("");
  lines.push(`Next safe action: ${report.auditPassed
    ? report.chainComplete
      ? "the chain audits clean; resolve any surfaced chain conditions before further simulation work — passing this audit authorizes nothing."
      : "supply the missing artifacts and re-audit; an incomplete chain is reported, never assumed."
    : "fix or rebuild the artifacts behind the blocking findings, then re-audit."}`);

  lines.push("");
  lines.push("Notes:");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of report.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
