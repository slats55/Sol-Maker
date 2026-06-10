/**
 * Deterministic, offline **SIMULATION INTENT PLAN V2** (Sprints 63/64 — the first REAL Phase 6
 * artifact: `simulation.intent.plan.v2`).
 *
 * The v1 plan (`simulation.intent.plan.v1`, built in `@soulmaker/sniper`) is deliberately INERT
 * type-contract data. This v2 plan is the authorized Phase 6 step beyond it: a fail-closed PREVIEW
 * built from the strictly-validated v2 chain — the v2 paper decision report, a READY v2 safety
 * gates report, a fully-met v2 Phase-6 prerequisite report, and the three ADOPTED governance specs
 * (kill-switch, secrets policy, burner isolation). The version is v2 because the v1 schema id is
 * permanently taken by the inert artifact — schema ids are never reused.
 *
 * What a preview IS here: per paper-enter candidate, an honest statement of what a simulation
 * WOULD examine — with every value the paper chain cannot supply marked UNRESOLVED. The pipeline
 * NEVER invents a destination, amount, fee, pool address, or route. Amounts can only ever be
 * paper-unit LABELS, never currency.
 *
 * Fail-closed: a missing/invalid/v1 input, a not-ready gates report, an unmet prerequisite, a
 * non-adopted spec, or an operator-declared stop-simulation kill switch BLOCKS the plan (stable
 * reason codes; zero entries). Blocking never throws — the blocked plan is the artifact; only a
 * malformed input SHAPE throws. The plan carries the four literal safety locks
 * (`neverAuthorizesLiveTrading` / `neverSigns` / `neverSends` / `dryRunOnly`) — the validator
 * refuses a flipped lock. Pure: no I/O, no network, no wallet, no wall-clock.
 *
 * One deliberate, narrow design point (documented; fail-closed by default): the run report v2
 * marks every paper-enter "needs operator review", which keeps the prereq tracker's
 * NO_OPERATOR_BLOCKING item unmet — so a chain with paper-enters could NEVER reach an unblocked
 * plan. The architecture's answer is an explicit human decision: the operator may pass
 * `operatorAcknowledgedPaperEnterReview: true`, and it stands in for THAT ONE review item ONLY
 * when (a) the single unmet prereq id is NO_OPERATOR_BLOCKING (a structured id, never prose),
 * (b) the decision actually has paper-enters, and (c) the decision carries zero unresolved
 * unknowns (structured reason-code check). Any other readiness gap still blocks, and an applied
 * acknowledgment is loudly surfaced as a warning code in the plan.
 */

import { redactString } from "@soulmaker/security";
import {
  validatePaperSniperDecisionReportV2,
  SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION,
  SNIPER_PAPER_DECISION_REPORT_SCHEMA_VERSION,
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

/** Stable schema identifier for the v2 simulation intent plan. Bump only on a breaking change. */
export const SIMULATION_INTENT_PLAN_V2_SCHEMA_VERSION = "simulation.intent.plan.v2";

/** The banner that prefixes every v2 simulation intent plan (required label). */
export const SIMULATION_INTENT_PLAN_V2_BANNER =
  "SIMULATION INTENT PLAN V2 (SIMULATION PREVIEW ONLY — DRY-RUN-ONLY, NEVER SIGNS, NEVER SENDS)";

/** The fixed `generatedBy` marker (deterministic provenance; never an operator value). */
export const SIMULATION_INTENT_PLAN_V2_GENERATED_BY = "@soulmaker/simulation";

/** Required disclaimer statements carried by every v2 simulation intent plan (stable order). */
export const SIMULATION_INTENT_PLAN_V2_DISCLAIMERS: readonly string[] = [
  "SIMULATION INTENT PLAN V2 — a fail-closed PREVIEW over the strictly-validated v2 chain; every value the paper chain cannot supply is marked UNRESOLVED, never invented.",
  ...SIMULATION_PACKAGE_DISCLAIMERS,
];

/** Thrown when intent-plan-v2 INPUT or a produced plan is structurally invalid. */
export class SimulationIntentPlanV2Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationIntentPlanV2Error";
  }
}

// --- model -------------------------------------------------------------------

/** The roles of the six required source artifacts (stable order). */
export const SIMULATION_PLAN_SOURCE_ROLES = [
  "decision",
  "safety-gates",
  "prereqs",
  "kill-switch-spec",
  "secrets-policy",
  "burner-isolation-spec",
] as const;

/** One of the source-artifact roles. */
export type SimulationPlanSourceRole = (typeof SIMULATION_PLAN_SOURCE_ROLES)[number];

/** One source artifact's reference/state in the plan (what was supplied and how it validated). */
export interface SimulationSourceArtifactRef {
  role: SimulationPlanSourceRole;
  /** The schemaVersion the pipeline requires for this role. */
  expectedSchemaVersion: string;
  present: boolean;
  /** null when absent; otherwise whether the strict validator accepted it. */
  valid: boolean | null;
  /** The sniffed schemaVersion of what was supplied (null when absent or unsniffable). */
  suppliedSchemaVersion: string | null;
  /** The artifact's own label (sourceLabel / operatorLabel), when valid. */
  label: string | null;
}

/** A preview field's resolution state: a real value never exists in the paper chain for
 * destination/fee, and amounts resolve only as paper-unit LABELS. */
export type SimulationPreviewFieldStatus = "resolved-as-label" | "unresolved";

/** One previewed field (label-only when resolved; never a real chain value). */
export interface SimulationPreviewField {
  status: SimulationPreviewFieldStatus;
  /** The LABEL when resolved-as-label (e.g. a paper-unit amount label); null when unresolved. */
  label: string | null;
}

/** One candidate's preview entry. */
export interface SimulationIntentPlanEntryV2 {
  candidateId: string;
  mint: string;
  /** Always this literal — the only action a Phase 6 preview can describe. */
  intendedActionPreview: "simulated-entry-preview";
  /** `resolved` iff no field is unresolved (impossible while the paper chain has no route data). */
  previewStatus: "resolved" | "unresolved";
  destinationPreview: SimulationPreviewField;
  amountPreview: SimulationPreviewField;
  feePreview: SimulationPreviewField;
  /** The names of the unresolved fields, stable order (destination, amount, fee). */
  unresolvedFields: string[];
  reasonCodes: SimulationReasonCode[];
  operatorText: string;
}

/** Summary of the source decision (verbatim structured fields — never re-derived). */
export interface SimulationPlanDecisionSummary {
  sourceLabel: string | null;
  decisionCount: number;
  paperEnterCount: number;
  hasPaperEnter: boolean;
}

/** Summary of the readiness inputs (null when the artifact was missing/invalid). */
export interface SimulationPlanReadinessSummary {
  gatesReady: boolean | null;
  gatesFailCount: number | null;
  prereqsReady: boolean | null;
  prereqsNotMetCount: number | null;
}

/** Summary of governance-spec adoption (null when the spec was missing/invalid). */
export interface SimulationPlanSpecAdoptionSummary {
  killSwitchAdopted: boolean | null;
  secretsPolicyAdopted: boolean | null;
  burnerIsolationAdopted: boolean | null;
  /** The operator-declared stop-simulation switch state this plan was built under. */
  stopSimulationDeclaredTripped: boolean;
}

/** The full, deterministic, JSON-serializable v2 simulation intent plan. */
export interface SimulationIntentPlanV2 {
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
  planLabel: string | null;
  sourceArtifactRefs: SimulationSourceArtifactRef[];
  decisionSummary: SimulationPlanDecisionSummary | null;
  readinessSummary: SimulationPlanReadinessSummary;
  specAdoptionSummary: SimulationPlanSpecAdoptionSummary;
  /** True iff the narrow paper-enter-review acknowledgment was APPLIED (loudly surfaced). */
  paperEnterReviewAcknowledgmentApplied: boolean;
  /** True iff blockingReasonCodes is non-empty (a blocked plan carries zero entries). */
  blocked: boolean;
  blockingReasonCodes: SimulationReasonCode[];
  warningReasonCodes: SimulationReasonCode[];
  /** Honest outcome markers (e.g. `simulation-plan-ready` on an unblocked plan). */
  outcomeReasonCodes: SimulationReasonCode[];
  entries: SimulationIntentPlanEntryV2[];
  entryCount: number;
  /** How many entries carry at least one unresolved field. */
  unresolvedEntryCount: number;
  notes: string[];
}

/** Everything {@link buildSimulationIntentPlanV2} needs. Artifact problems BLOCK (never throw). */
export interface BuildSimulationIntentPlanV2Input {
  /** `sniper.paper.decision.report.v2` (required; v1 or missing blocks). */
  decision?: unknown;
  /** `sniper.safety.gates.report.v2` (required; must be ready). */
  safetyGates?: unknown;
  /** `phase6.prerequisite.report.v2` (required; every bucket must be met). */
  prereqs?: unknown;
  /** `sniper.kill_switch.spec.v1` (required; must be adopted). */
  killSwitchSpec?: unknown;
  /** `sniper.secrets.policy.v1` (required; must be adopted). */
  secretsPolicy?: unknown;
  /** `sniper.burner.isolation.spec.v1` (required; must be adopted). */
  burnerIsolationSpec?: unknown;
  /** Operator-declared stop-simulation kill-switch state (default false; true BLOCKS the plan). */
  stopSimulationTripped?: boolean;
  /** EXPLICIT operator acknowledgment that the paper-enters were reviewed (default false). Applies
   * ONLY when the single unmet prereq is NO_OPERATOR_BLOCKING, the decision has paper-enters, and
   * zero unresolved unknowns exist — every other gap still blocks. Surfaced as a warning code. */
  operatorAcknowledgedPaperEnterReview?: boolean;
  /** Optional operator label echoed into the plan. */
  operatorLabel?: string | null;
  /** Optional plan label echoed into the plan. */
  planLabel?: string | null;
  /** Optional paper-unit amount LABEL applied to every entry (digits allowed only as unit counts —
   * this is a label, never currency; null leaves the amount preview unresolved). */
  paperAmountLabel?: string | null;
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function sniffSchemaVersion(value: unknown): string | null {
  return isObject(value) && typeof value.schemaVersion === "string" ? value.schemaVersion : null;
}

interface CheckedSource<T> {
  artifact: T | null;
  ref: SimulationSourceArtifactRef;
}

/** Strictly validate one source in place; problems become the ref's state (never a throw). */
function checkSource<T>(
  role: SimulationPlanSourceRole,
  expectedSchemaVersion: string,
  value: unknown,
  validate: (v: unknown) => T,
  labelOf: (artifact: T) => string | null,
): CheckedSource<T> {
  if (value === undefined || value === null) {
    return {
      artifact: null,
      ref: { role, expectedSchemaVersion, present: false, valid: null, suppliedSchemaVersion: null, label: null },
    };
  }
  const supplied = sniffSchemaVersion(value);
  try {
    const artifact = validate(value);
    return {
      artifact,
      ref: { role, expectedSchemaVersion, present: true, valid: true, suppliedSchemaVersion: supplied, label: labelOf(artifact) },
    };
  } catch {
    return {
      artifact: null,
      ref: { role, expectedSchemaVersion, present: true, valid: false, suppliedSchemaVersion: supplied, label: null },
    };
  }
}

/** Resolve the missing/invalid/v1 blocking code for one required source. */
function blockingCodeFor(
  ref: SimulationSourceArtifactRef,
  v1SchemaVersion: string | null,
  missingCode: SimulationReasonCode,
  invalidCode: SimulationReasonCode,
): SimulationReasonCode | null {
  if (!ref.present) return missingCode;
  if (ref.valid === true) return null;
  if (v1SchemaVersion !== null && ref.suppliedSchemaVersion === v1SchemaVersion) return "simulation-blocked-v1-artifact";
  return invalidCode;
}

// --- builder (Sprint 64) -------------------------------------------------------

/**
 * Build a deterministic {@link SimulationIntentPlanV2}. Pure and non-mutating. Every source is
 * STRICTLY validated in place through the production validators; any missing/invalid/v1 source, a
 * not-ready gates report, unmet prerequisites, a non-adopted spec, or a declared stop-simulation
 * switch BLOCKS the plan with stable reason codes and zero entries — fail-closed, never a silent
 * downgrade, never a throw. Entries (one per paper-enter) preview only what the chain can honestly
 * say: destination/fee are ALWAYS unresolved (no validated route data exists in the paper chain),
 * and the amount resolves only as the operator's paper-unit LABEL. Throws
 * {@link SimulationIntentPlanV2Error} only on a malformed input SHAPE.
 */
export function buildSimulationIntentPlanV2(input: BuildSimulationIntentPlanV2Input): SimulationIntentPlanV2 {
  if (!isObject(input)) throw new SimulationIntentPlanV2Error("simulation intent plan v2 input must be an object");
  for (const f of ["operatorLabel", "planLabel", "paperAmountLabel"] as const) {
    if (input[f] !== undefined && input[f] !== null && typeof input[f] !== "string") {
      throw new SimulationIntentPlanV2Error(`simulation intent plan v2 input.${f} must be a string or null when present`);
    }
  }
  for (const f of ["stopSimulationTripped", "operatorAcknowledgedPaperEnterReview"] as const) {
    if (input[f] !== undefined && typeof input[f] !== "boolean") {
      throw new SimulationIntentPlanV2Error(`simulation intent plan v2 input.${f} must be a boolean when present`);
    }
  }

  // 1) Check every source in place (fail-closed: problems become blocking codes, never throws).
  const decision = checkSource<SniperPaperDecisionReportV2>(
    "decision", SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION, input.decision,
    validatePaperSniperDecisionReportV2, (a) => a.sourceLabel);
  const gates = checkSource<SniperSafetyGatesReportV2>(
    "safety-gates", SNIPER_SAFETY_GATES_REPORT_V2_SCHEMA_VERSION, input.safetyGates,
    validateSniperSafetyGatesReportV2, (a) => a.operatorLabel);
  const prereqs = checkSource<Phase6PrerequisiteReportV2>(
    "prereqs", PHASE6_PREREQUISITE_REPORT_V2_SCHEMA_VERSION, input.prereqs,
    validatePhase6PrerequisiteReportV2, (a) => a.operatorLabel);
  const killSwitch = checkSource<SniperKillSwitchSpec>(
    "kill-switch-spec", SNIPER_KILL_SWITCH_SPEC_SCHEMA_VERSION, input.killSwitchSpec,
    validateSniperKillSwitchSpec, (a) => a.operatorLabel);
  const secretsPolicy = checkSource<SniperSecretsPolicy>(
    "secrets-policy", SNIPER_SECRETS_POLICY_SCHEMA_VERSION, input.secretsPolicy,
    validateSniperSecretsPolicy, (a) => a.operatorLabel);
  const burnerIsolation = checkSource<SniperBurnerIsolationSpec>(
    "burner-isolation-spec", SNIPER_BURNER_ISOLATION_SPEC_SCHEMA_VERSION, input.burnerIsolationSpec,
    validateSniperBurnerIsolationSpec, (a) => a.operatorLabel);

  const sourceArtifactRefs = [decision.ref, gates.ref, prereqs.ref, killSwitch.ref, secretsPolicy.ref, burnerIsolation.ref];

  // 2) Collect blocking codes in stable order: inputs → readiness → specs → kill switch.
  const blocking: SimulationReasonCode[] = [];
  const push = (code: SimulationReasonCode | null) => {
    if (code !== null) blocking.push(code);
  };
  push(blockingCodeFor(decision.ref, SNIPER_PAPER_DECISION_REPORT_SCHEMA_VERSION,
    "simulation-blocked-missing-decision-v2", "simulation-blocked-invalid-decision-v2"));
  push(blockingCodeFor(gates.ref, SNIPER_SAFETY_GATES_REPORT_SCHEMA_VERSION,
    "simulation-blocked-missing-safety-gates-v2", "simulation-blocked-invalid-safety-gates-v2"));
  push(blockingCodeFor(prereqs.ref, PHASE6_PREREQUISITE_REPORT_SCHEMA_VERSION,
    "simulation-blocked-missing-prereqs-v2", "simulation-blocked-invalid-prereqs-v2"));
  if (gates.artifact !== null && !gates.artifact.ready) blocking.push("simulation-blocked-gates-not-ready");

  // Prereqs: not-ready blocks — EXCEPT the one narrow, explicit, structured acknowledgment path
  // (see the module doc). Unresolved unknowns are checked from the decision's own reason codes
  // (the same unknown-information codes the v2 gates use), never from prose.
  const UNKNOWN_INFO_CODES: ReadonlySet<string> = new Set(["preflight-unknown", "missing-preflight", "preflight-status-unrecognized"]);
  const unresolvedUnknownCount = decision.artifact === null
    ? 0
    : decision.artifact.decisions.filter(
        (d) => (d.decision === "watch" || d.decision === "unknown") && d.reasonCodes.some((c) => UNKNOWN_INFO_CODES.has(c)),
      ).length;
  let paperEnterReviewAcknowledgmentApplied = false;
  if (prereqs.artifact !== null && !prereqs.artifact.phase6ImplementationReady) {
    const ackDeclared = input.operatorAcknowledgedPaperEnterReview === true;
    const onlyOperatorReviewUnmet =
      prereqs.artifact.notMet.length === 1 && prereqs.artifact.notMet[0] === "NO_OPERATOR_BLOCKING";
    const ackApplies =
      ackDeclared && onlyOperatorReviewUnmet && decision.artifact?.hasPaperEnter === true && unresolvedUnknownCount === 0;
    if (ackApplies) {
      paperEnterReviewAcknowledgmentApplied = true;
    } else {
      blocking.push("simulation-blocked-prereqs-not-ready");
    }
  }
  push(blockingCodeFor(killSwitch.ref, null,
    "simulation-blocked-missing-kill-switch-spec", "simulation-blocked-invalid-kill-switch-spec"));
  if (killSwitch.artifact !== null && !killSwitch.artifact.adopted) blocking.push("simulation-blocked-kill-switch-not-adopted");
  push(blockingCodeFor(secretsPolicy.ref, null,
    "simulation-blocked-missing-secrets-policy", "simulation-blocked-invalid-secrets-policy"));
  if (secretsPolicy.artifact !== null && !secretsPolicy.artifact.adopted) blocking.push("simulation-blocked-secrets-policy-not-adopted");
  push(blockingCodeFor(burnerIsolation.ref, null,
    "simulation-blocked-missing-burner-isolation", "simulation-blocked-invalid-burner-isolation"));
  if (burnerIsolation.artifact !== null && !burnerIsolation.artifact.adopted) blocking.push("simulation-blocked-burner-isolation-not-adopted");
  const stopTripped = input.stopSimulationTripped === true;
  if (stopTripped) blocking.push("simulation-blocked-kill-switch-stop");

  const blockingReasonCodes = dedupeSimulationReasonCodes(blocking);
  const blocked = blockingReasonCodes.length > 0;

  // 3) Summaries (verbatim structured fields; null where the artifact didn't validate).
  const decisionSummary: SimulationPlanDecisionSummary | null = decision.artifact === null
    ? null
    : {
        sourceLabel: decision.artifact.sourceLabel,
        decisionCount: decision.artifact.decisions.length,
        paperEnterCount: decision.artifact.paperEnterCount,
        hasPaperEnter: decision.artifact.hasPaperEnter,
      };
  const readinessSummary: SimulationPlanReadinessSummary = {
    gatesReady: gates.artifact === null ? null : gates.artifact.ready,
    gatesFailCount: gates.artifact === null ? null : gates.artifact.failCount,
    prereqsReady: prereqs.artifact === null ? null : prereqs.artifact.phase6ImplementationReady,
    prereqsNotMetCount: prereqs.artifact === null ? null : prereqs.artifact.notMet.length,
  };
  const specAdoptionSummary: SimulationPlanSpecAdoptionSummary = {
    killSwitchAdopted: killSwitch.artifact === null ? null : killSwitch.artifact.adopted,
    secretsPolicyAdopted: secretsPolicy.artifact === null ? null : secretsPolicy.artifact.adopted,
    burnerIsolationAdopted: burnerIsolation.artifact === null ? null : burnerIsolation.artifact.adopted,
    stopSimulationDeclaredTripped: stopTripped,
  };

  // 4) Entries — only on an unblocked plan, one per paper-enter, honest unresolved previews.
  const paperAmountLabel = nonEmptyString(input.paperAmountLabel) ? input.paperAmountLabel : null;
  const entries: SimulationIntentPlanEntryV2[] = [];
  if (!blocked && decision.artifact !== null) {
    for (const d of decision.artifact.decisions) {
      if (d.decision !== "paper-enter") continue;
      const amountResolved = paperAmountLabel !== null;
      const unresolvedFields = ["destination", ...(amountResolved ? [] : ["amount"]), "fee"];
      const codes: SimulationReasonCode[] = [
        "simulation-preview-unresolved-destination",
        ...(amountResolved ? [] : (["simulation-preview-unresolved-amount"] as SimulationReasonCode[])),
        "simulation-preview-unresolved-fee",
      ];
      entries.push({
        candidateId: d.candidateId,
        mint: d.mint,
        intendedActionPreview: "simulated-entry-preview",
        previewStatus: "unresolved",
        destinationPreview: { status: "unresolved", label: null },
        amountPreview: amountResolved
          ? { status: "resolved-as-label", label: paperAmountLabel }
          : { status: "unresolved", label: null },
        feePreview: { status: "unresolved", label: null },
        unresolvedFields,
        reasonCodes: codes,
        operatorText: `Preview of a SIMULATED entry for ${d.candidateId}: ${unresolvedFields.length} field(s) unresolved (${unresolvedFields.join(", ")}). Nothing is invented; nothing is executed.`,
      });
    }
  }
  const unresolvedEntryCount = entries.filter((e) => e.unresolvedFields.length > 0).length;

  // 5) Plan-level warnings = the deduped union of entry warnings (emission order), plus the
  // loudly-surfaced acknowledgment when it was applied.
  const warningReasonCodes = dedupeSimulationReasonCodes([
    ...(paperEnterReviewAcknowledgmentApplied
      ? (["simulation-operator-acknowledged-paper-enter-review"] as SimulationReasonCode[])
      : []),
    ...entries.flatMap((e) => e.reasonCodes),
  ]).filter((c) => SIMULATION_REASON_CODE_DEFINITIONS[c].warning);
  const outcomeReasonCodes: SimulationReasonCode[] = blocked ? [] : ["simulation-plan-ready"];

  const notes = blocked
    ? [
        `BLOCKED: ${blockingReasonCodes.length} blocking reason(s) — no preview entries are built from a blocked chain.`,
        "Resolve every blocking reason and rebuild; the plan never downgrades a blocker to a warning.",
      ]
    : [
        `${entries.length} preview entr${entries.length === 1 ? "y" : "ies"} (one per SIMULATED paper-enter); ${unresolvedEntryCount} carry unresolved fields.`,
        "Unresolved fields stay unresolved — the pipeline never invents a destination, amount, fee, pool, or route.",
        "Ready for SIMULATION ONLY: this plan never authorizes live trading, never signs, never sends.",
      ];

  return {
    schemaVersion: SIMULATION_INTENT_PLAN_V2_SCHEMA_VERSION,
    banner: SIMULATION_INTENT_PLAN_V2_BANNER,
    generatedBy: SIMULATION_INTENT_PLAN_V2_GENERATED_BY,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    ...SIMULATION_SAFETY_LITERALS,
    disclaimers: [...SIMULATION_INTENT_PLAN_V2_DISCLAIMERS],
    operatorLabel: nonEmptyString(input.operatorLabel) ? input.operatorLabel : null,
    planLabel: nonEmptyString(input.planLabel) ? input.planLabel : null,
    sourceArtifactRefs,
    decisionSummary,
    readinessSummary,
    specAdoptionSummary,
    paperEnterReviewAcknowledgmentApplied,
    blocked,
    blockingReasonCodes,
    warningReasonCodes,
    outcomeReasonCodes,
    entries,
    entryCount: entries.length,
    unresolvedEntryCount,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

const PREVIEW_FIELD_STATUSES: ReadonlySet<string> = new Set(["resolved-as-label", "unresolved"]);

function validatePreviewField(value: unknown, where: string): SimulationPreviewField {
  if (!isObject(value)) throw new SimulationIntentPlanV2Error(`${where} must be an object`);
  if (typeof value.status !== "string" || !PREVIEW_FIELD_STATUSES.has(value.status)) {
    throw new SimulationIntentPlanV2Error(`${where}.status must be resolved-as-label|unresolved`);
  }
  if (value.status === "unresolved" && value.label !== null) {
    throw new SimulationIntentPlanV2Error(`${where}.label must be null when unresolved`);
  }
  if (value.status === "resolved-as-label" && !nonEmptyString(value.label)) {
    throw new SimulationIntentPlanV2Error(`${where}.label must be a non-empty string when resolved-as-label`);
  }
  return value as unknown as SimulationPreviewField;
}

function validateEntry(value: unknown, where: string): SimulationIntentPlanEntryV2 {
  if (!isObject(value)) throw new SimulationIntentPlanV2Error(`${where} must be an object`);
  if (!nonEmptyString(value.candidateId)) throw new SimulationIntentPlanV2Error(`${where}.candidateId must be a non-empty string`);
  if (!nonEmptyString(value.mint)) throw new SimulationIntentPlanV2Error(`${where}.mint must be a non-empty string`);
  if (value.intendedActionPreview !== "simulated-entry-preview") {
    throw new SimulationIntentPlanV2Error(`${where}.intendedActionPreview must be "simulated-entry-preview"`);
  }
  if (value.previewStatus !== "resolved" && value.previewStatus !== "unresolved") {
    throw new SimulationIntentPlanV2Error(`${where}.previewStatus must be resolved|unresolved`);
  }
  const destination = validatePreviewField(value.destinationPreview, `${where}.destinationPreview`);
  const amount = validatePreviewField(value.amountPreview, `${where}.amountPreview`);
  const fee = validatePreviewField(value.feePreview, `${where}.feePreview`);
  if (!Array.isArray(value.unresolvedFields) || (value.unresolvedFields as unknown[]).some((x) => typeof x !== "string")) {
    throw new SimulationIntentPlanV2Error(`${where}.unresolvedFields must be an array of strings`);
  }
  const expectedUnresolved = [
    ...(destination.status === "unresolved" ? ["destination"] : []),
    ...(amount.status === "unresolved" ? ["amount"] : []),
    ...(fee.status === "unresolved" ? ["fee"] : []),
  ];
  if ((value.unresolvedFields as string[]).join("|") !== expectedUnresolved.join("|")) {
    throw new SimulationIntentPlanV2Error(`${where}.unresolvedFields must mirror the unresolved preview fields (${expectedUnresolved.join(", ") || "none"})`);
  }
  const expectedStatus = expectedUnresolved.length === 0 ? "resolved" : "unresolved";
  if (value.previewStatus !== expectedStatus) {
    throw new SimulationIntentPlanV2Error(`${where}.previewStatus must be "${expectedStatus}" given its preview fields`);
  }
  if (!Array.isArray(value.reasonCodes) || (value.reasonCodes as unknown[]).some((x) => !isSimulationReasonCode(x))) {
    throw new SimulationIntentPlanV2Error(`${where}.reasonCodes must be an array of known simulation reason codes`);
  }
  if (!nonEmptyString(value.operatorText)) throw new SimulationIntentPlanV2Error(`${where}.operatorText must be a non-empty string`);
  return value as unknown as SimulationIntentPlanEntryV2;
}

function validateSourceRef(value: unknown, where: string): SimulationSourceArtifactRef {
  if (!isObject(value)) throw new SimulationIntentPlanV2Error(`${where} must be an object`);
  if (typeof value.role !== "string" || !(SIMULATION_PLAN_SOURCE_ROLES as readonly string[]).includes(value.role)) {
    throw new SimulationIntentPlanV2Error(`${where}.role must be one of the known source roles`);
  }
  if (!nonEmptyString(value.expectedSchemaVersion)) {
    throw new SimulationIntentPlanV2Error(`${where}.expectedSchemaVersion must be a non-empty string`);
  }
  if (typeof value.present !== "boolean") throw new SimulationIntentPlanV2Error(`${where}.present must be a boolean`);
  if (value.valid !== null && typeof value.valid !== "boolean") {
    throw new SimulationIntentPlanV2Error(`${where}.valid must be a boolean or null`);
  }
  if (value.present === false && value.valid !== null) {
    throw new SimulationIntentPlanV2Error(`${where}.valid must be null when absent`);
  }
  for (const f of ["suppliedSchemaVersion", "label"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new SimulationIntentPlanV2Error(`${where}.${f} must be a string or null`);
    }
  }
  return value as unknown as SimulationSourceArtifactRef;
}

/**
 * Strictly validate a value as a {@link SimulationIntentPlanV2} and return it narrowed. Enforces
 * the four literal safety locks, the blocked/blocking consistency (`blocked` ⇔ blocking codes
 * present; a blocked plan carries ZERO entries), code-severity buckets (blocking codes must be
 * blocking, warning codes warning), per-entry unresolved-field consistency, and the recomputed
 * counts. Throws {@link SimulationIntentPlanV2Error} (or {@link SimulationSafetyError} for a
 * flipped lock) on the first problem. Pure.
 */
export function validateSimulationIntentPlanV2(value: unknown): SimulationIntentPlanV2 {
  if (!isObject(value)) throw new SimulationIntentPlanV2Error("simulation intent plan v2 must be a JSON object");
  if (value.schemaVersion !== SIMULATION_INTENT_PLAN_V2_SCHEMA_VERSION) {
    throw new SimulationIntentPlanV2Error(`simulation intent plan v2.schemaVersion must be "${SIMULATION_INTENT_PLAN_V2_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SIMULATION_INTENT_PLAN_V2_BANNER) {
    throw new SimulationIntentPlanV2Error(`simulation intent plan v2.banner must be "${SIMULATION_INTENT_PLAN_V2_BANNER}"`);
  }
  if (value.generatedBy !== SIMULATION_INTENT_PLAN_V2_GENERATED_BY) {
    throw new SimulationIntentPlanV2Error(`simulation intent plan v2.generatedBy must be "${SIMULATION_INTENT_PLAN_V2_GENERATED_BY}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new SimulationIntentPlanV2Error(`simulation intent plan v2.${flag} must be true`);
  }
  assertSimulationSafetyLiterals(value, "simulation intent plan v2");
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SimulationIntentPlanV2Error("simulation intent plan v2.disclaimers must be a non-empty array");
  }
  for (const f of ["operatorLabel", "planLabel"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new SimulationIntentPlanV2Error(`simulation intent plan v2.${f} must be a string or null`);
    }
  }
  if (!Array.isArray(value.sourceArtifactRefs) || value.sourceArtifactRefs.length !== SIMULATION_PLAN_SOURCE_ROLES.length) {
    throw new SimulationIntentPlanV2Error(`simulation intent plan v2.sourceArtifactRefs must list all ${SIMULATION_PLAN_SOURCE_ROLES.length} source roles`);
  }
  const refs = (value.sourceArtifactRefs as unknown[]).map((r, i) => validateSourceRef(r, `simulation intent plan v2.sourceArtifactRefs[${i}]`));
  if (refs.map((r) => r.role).join("|") !== SIMULATION_PLAN_SOURCE_ROLES.join("|")) {
    throw new SimulationIntentPlanV2Error("simulation intent plan v2.sourceArtifactRefs must keep the stable role order");
  }
  if (value.decisionSummary !== null) {
    const ds = value.decisionSummary;
    if (!isObject(ds) || (ds.sourceLabel !== null && typeof ds.sourceLabel !== "string")
      || typeof ds.decisionCount !== "number" || typeof ds.paperEnterCount !== "number" || typeof ds.hasPaperEnter !== "boolean") {
      throw new SimulationIntentPlanV2Error("simulation intent plan v2.decisionSummary must be null or a well-formed summary");
    }
  }
  if (!isObject(value.readinessSummary)) throw new SimulationIntentPlanV2Error("simulation intent plan v2.readinessSummary must be an object");
  for (const f of ["gatesReady", "prereqsReady"] as const) {
    const v = (value.readinessSummary as Record<string, unknown>)[f];
    if (v !== null && typeof v !== "boolean") throw new SimulationIntentPlanV2Error(`simulation intent plan v2.readinessSummary.${f} must be a boolean or null`);
  }
  for (const f of ["gatesFailCount", "prereqsNotMetCount"] as const) {
    const v = (value.readinessSummary as Record<string, unknown>)[f];
    if (v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 0)) {
      throw new SimulationIntentPlanV2Error(`simulation intent plan v2.readinessSummary.${f} must be a non-negative integer or null`);
    }
  }
  if (!isObject(value.specAdoptionSummary)) throw new SimulationIntentPlanV2Error("simulation intent plan v2.specAdoptionSummary must be an object");
  for (const f of ["killSwitchAdopted", "secretsPolicyAdopted", "burnerIsolationAdopted"] as const) {
    const v = (value.specAdoptionSummary as Record<string, unknown>)[f];
    if (v !== null && typeof v !== "boolean") throw new SimulationIntentPlanV2Error(`simulation intent plan v2.specAdoptionSummary.${f} must be a boolean or null`);
  }
  if (typeof (value.specAdoptionSummary as Record<string, unknown>).stopSimulationDeclaredTripped !== "boolean") {
    throw new SimulationIntentPlanV2Error("simulation intent plan v2.specAdoptionSummary.stopSimulationDeclaredTripped must be a boolean");
  }
  if (typeof value.paperEnterReviewAcknowledgmentApplied !== "boolean") {
    throw new SimulationIntentPlanV2Error("simulation intent plan v2.paperEnterReviewAcknowledgmentApplied must be a boolean");
  }
  for (const f of ["blockingReasonCodes", "warningReasonCodes", "outcomeReasonCodes"] as const) {
    if (!Array.isArray(value[f]) || (value[f] as unknown[]).some((x) => !isSimulationReasonCode(x))) {
      throw new SimulationIntentPlanV2Error(`simulation intent plan v2.${f} must be an array of known simulation reason codes`);
    }
  }
  const blockingCodes = value.blockingReasonCodes as SimulationReasonCode[];
  const warningCodes = value.warningReasonCodes as SimulationReasonCode[];
  for (const c of blockingCodes) {
    if (!SIMULATION_REASON_CODE_DEFINITIONS[c].blocking) {
      throw new SimulationIntentPlanV2Error(`simulation intent plan v2.blockingReasonCodes contains non-blocking code "${c}"`);
    }
  }
  for (const c of warningCodes) {
    if (!SIMULATION_REASON_CODE_DEFINITIONS[c].warning) {
      throw new SimulationIntentPlanV2Error(`simulation intent plan v2.warningReasonCodes contains non-warning code "${c}"`);
    }
  }
  if (typeof value.blocked !== "boolean") throw new SimulationIntentPlanV2Error("simulation intent plan v2.blocked must be a boolean");
  if (value.blocked !== (blockingCodes.length > 0)) {
    throw new SimulationIntentPlanV2Error("simulation intent plan v2.blocked must be true exactly when blocking codes are present");
  }
  // An applied acknowledgment must be loudly surfaced — and the warning code can never appear
  // without the field saying so (they move together).
  const ackCodePresent = warningCodes.includes("simulation-operator-acknowledged-paper-enter-review");
  if (ackCodePresent !== value.paperEnterReviewAcknowledgmentApplied) {
    throw new SimulationIntentPlanV2Error(
      "simulation intent plan v2.paperEnterReviewAcknowledgmentApplied must move together with its warning code (an applied acknowledgment is always surfaced)",
    );
  }
  if (!Array.isArray(value.entries)) throw new SimulationIntentPlanV2Error("simulation intent plan v2.entries must be an array");
  const entries = (value.entries as unknown[]).map((e, i) => validateEntry(e, `simulation intent plan v2.entries[${i}]`));
  if (value.blocked === true && entries.length !== 0) {
    throw new SimulationIntentPlanV2Error("simulation intent plan v2 must carry ZERO entries when blocked");
  }
  if (value.entryCount !== entries.length) {
    throw new SimulationIntentPlanV2Error("simulation intent plan v2.entryCount must equal entries length");
  }
  const expectedUnresolved = entries.filter((e) => e.unresolvedFields.length > 0).length;
  if (value.unresolvedEntryCount !== expectedUnresolved) {
    throw new SimulationIntentPlanV2Error(`simulation intent plan v2.unresolvedEntryCount must equal the recomputed tally (${expectedUnresolved})`);
  }
  if (!Array.isArray(value.notes) || (value.notes as unknown[]).some((x) => typeof x !== "string")) {
    throw new SimulationIntentPlanV2Error("simulation intent plan v2.notes must be an array of strings");
  }
  return value as unknown as SimulationIntentPlanV2;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSimulationIntentPlanV2}. */
export interface FormatSimulationIntentPlanV2Options {
  label?: string;
}

/**
 * Render a redacted, stable, human-readable v2 simulation intent plan. Deterministic and
 * path-stable. Leads with SIMULATION PREVIEW ONLY and the BLOCKED/ready verdict, shows the source
 * artifacts, readiness, spec adoption, each preview entry with its unresolved fields, the blocking
 * and warning reasons with operator messages, and the next safe operator action. No hype, no
 * profit language, no execution claims. Passed through the shared redactor.
 */
export function formatSimulationIntentPlanV2(
  plan: SimulationIntentPlanV2,
  opts: FormatSimulationIntentPlanV2Options = {},
): string {
  const header = "SIMULATION PREVIEW ONLY — INTENT PLAN V2 (dry-run-only; never signs; never sends; never authorizes live trading)";
  const lines: string[] = [header, "=".repeat(header.length)];
  lines.push(SIMULATION_OPERATOR_SAFETY_LINE);
  lines.push(`artifact: ${plan.schemaVersion}`);
  if (opts.label) lines.push(`label:    ${opts.label}`);
  if (plan.operatorLabel) lines.push(`operator: ${plan.operatorLabel}`);
  lines.push(`plan:     ${plan.planLabel ?? "(unlabeled)"}`);
  lines.push(`status:   ${plan.blocked ? "BLOCKED" : "ready for SIMULATION ONLY"}`);

  lines.push("");
  lines.push("Source artifacts:");
  for (const r of plan.sourceArtifactRefs) {
    const state = r.present ? (r.valid ? "present, valid" : `present, INVALID (supplied ${r.suppliedSchemaVersion ?? "unknown"})`) : "ABSENT";
    lines.push(`- ${r.role}: ${state}${r.label ? `  [${r.label}]` : ""}`);
  }

  lines.push("");
  lines.push("Readiness:");
  lines.push(`- safety gates v2 ready: ${plan.readinessSummary.gatesReady === null ? "unknown (artifact missing/invalid)" : plan.readinessSummary.gatesReady ? "YES" : `NO (${plan.readinessSummary.gatesFailCount} failed gate(s))`}`);
  lines.push(`- phase6 prereqs v2 met: ${plan.readinessSummary.prereqsReady === null ? "unknown (artifact missing/invalid)" : plan.readinessSummary.prereqsReady ? "YES" : `NO (${plan.readinessSummary.prereqsNotMetCount} not met)`}`);
  lines.push("Spec adoption:");
  const adoption = plan.specAdoptionSummary;
  const show = (v: boolean | null) => (v === null ? "unknown (missing/invalid)" : v ? "ADOPTED" : "NOT adopted");
  lines.push(`- kill-switch spec:      ${show(adoption.killSwitchAdopted)}`);
  lines.push(`- secrets policy:        ${show(adoption.secretsPolicyAdopted)}`);
  lines.push(`- burner isolation spec: ${show(adoption.burnerIsolationAdopted)}`);
  lines.push(`- stop-simulation switch declared tripped: ${adoption.stopSimulationDeclaredTripped ? "YES (blocks all simulation work)" : "no"}`);
  if (plan.paperEnterReviewAcknowledgmentApplied) {
    lines.push("- OPERATOR ACKNOWLEDGMENT APPLIED: the operator explicitly declared the paper-enters reviewed (covers ONLY the NO_OPERATOR_BLOCKING review item).");
  }

  if (plan.decisionSummary) {
    lines.push("");
    lines.push(`Decision source: ${plan.decisionSummary.sourceLabel ?? "(none)"} — ${plan.decisionSummary.decisionCount} decision(s), ${plan.decisionSummary.paperEnterCount} SIMULATED paper-enter(s)`);
  }

  lines.push("");
  if (plan.blocked) {
    lines.push("BLOCKING reasons (resolve every one; a blocked plan builds no previews):");
    for (const c of plan.blockingReasonCodes) {
      lines.push(`✗ ${c}`);
      lines.push(`    ${SIMULATION_REASON_CODE_DEFINITIONS[c].operatorMessage}`);
    }
  } else {
    lines.push(`Preview entries (${plan.entryCount}; ${plan.unresolvedEntryCount} with unresolved fields):`);
    if (plan.entries.length === 0) {
      lines.push("- (none — the decision report contains no SIMULATED paper-enter)");
    }
    for (const e of plan.entries) {
      lines.push(`- ${e.candidateId}  ${e.mint}  [${e.intendedActionPreview}; ${e.previewStatus}]`);
      lines.push(`    destination: ${e.destinationPreview.status === "unresolved" ? "UNRESOLVED (never invented)" : e.destinationPreview.label}`);
      lines.push(`    amount:      ${e.amountPreview.status === "unresolved" ? "UNRESOLVED (never invented)" : `${e.amountPreview.label} (paper-unit LABEL, never currency)`}`);
      lines.push(`    fee:         ${e.feePreview.status === "unresolved" ? "UNRESOLVED (never invented)" : e.feePreview.label}`);
    }
    if (plan.warningReasonCodes.length > 0) {
      lines.push("");
      lines.push("Warnings:");
      for (const c of plan.warningReasonCodes) {
        lines.push(`! ${c}`);
        lines.push(`    ${SIMULATION_REASON_CODE_DEFINITIONS[c].operatorMessage}`);
      }
    }
  }

  lines.push("");
  lines.push(`Next safe action: ${plan.blocked
    ? "resolve the blocking reasons above, rebuild the chain artifacts, then rebuild this plan."
    : "review each preview and its unresolved fields; a simulation RESULT may be built from this plan — still never a live action."}`);

  lines.push("");
  lines.push("Notes:");
  for (const note of plan.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of plan.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
