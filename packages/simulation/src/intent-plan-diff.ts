/**
 * Deterministic, offline **SIMULATION INTENT PLAN DIFF V2** (`simulation.intent.plan.diff.v2`,
 * Sprint 73 — the first half of the Phase 6 diff chain).
 *
 * Two `simulation.intent.plan.v2` artifacts describe the simulation preview at two points — e.g.
 * before vs after more chain data arrived, or two CI runs. This module compares them so an
 * operator (or CI) can see exactly what moved, from STRUCTURED FIELDS ONLY — never by parsing
 * prose: the blocked verdict, plan-level blocking/warning reason codes, the six source-artifact
 * refs, the readiness and spec-adoption summaries, the applied operator acknowledgment, and the
 * per-candidate preview entries (membership, preview status, per-field resolution, reason codes).
 *
 * Both inputs are STRICTLY validated through the production plan validator first — a wrong-schema
 * artifact, a tampered literal lock, or any other corruption REFUSES the diff (there is no honest
 * comparison over an invalid artifact). Every finding is surfaced as a stable machine-readable
 * `simulation-diff-plan-*` reason code. Side labels (planLabel / operatorLabel) are echoed as
 * metadata but deliberately NOT compared — two differently-labeled but structurally identical
 * plans diff as identical.
 *
 * Nothing here is a trade signal; a diff over previews is still a preview. The diff carries the
 * four literal safety locks. Pure: no I/O, no network, no wallet, no wall-clock — the same pair
 * yields a byte-identical diff.
 */

import { redactString } from "@soulmaker/security";
import {
  SIMULATION_PACKAGE_DISCLAIMERS,
  SIMULATION_SAFETY_LITERALS,
  assertSimulationSafetyLiterals,
} from "./safety.js";
import {
  SIMULATION_REASON_CODE_DEFINITIONS,
  isSimulationReasonCode,
  type SimulationReasonCode,
} from "./reason-codes.js";
import {
  validateSimulationIntentPlanV2,
  SIMULATION_PLAN_SOURCE_ROLES,
  type SimulationIntentPlanV2,
  type SimulationIntentPlanEntryV2,
  type SimulationSourceArtifactRef,
  type SimulationPlanSourceRole,
  type SimulationPreviewFieldStatus,
} from "./intent-plan.js";

/** Stable schema identifier for the v2 intent plan diff. Bump only on a breaking change. */
export const SIMULATION_INTENT_PLAN_DIFF_V2_SCHEMA_VERSION = "simulation.intent.plan.diff.v2";

/** The banner that prefixes every v2 intent plan diff (required label). */
export const SIMULATION_INTENT_PLAN_DIFF_V2_BANNER =
  "SIMULATION INTENT PLAN DIFF V2 (PREVIEW COMPARISON ONLY — DRY-RUN-ONLY, NEVER SIGNS, NEVER SENDS)";

/** The fixed `generatedBy` marker (deterministic provenance; never an operator value). */
export const SIMULATION_INTENT_PLAN_DIFF_V2_GENERATED_BY = "@soulmaker/simulation";

/** Required disclaimer statements carried by every v2 intent plan diff (stable order). */
export const SIMULATION_INTENT_PLAN_DIFF_V2_DISCLAIMERS: readonly string[] = [
  "SIMULATION INTENT PLAN DIFF V2 — a deterministic comparison of two strictly-validated simulation intent plans (base vs next), computed from STRUCTURED FIELDS ONLY (never from prose).",
  "A diff over simulation previews is still a preview: it does not sign, does not send, and does not authorize live trading.",
  ...SIMULATION_PACKAGE_DISCLAIMERS,
];

/** Thrown when intent-plan-diff INPUT or a produced diff is structurally invalid. */
export class SimulationIntentPlanDiffV2Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationIntentPlanDiffV2Error";
  }
}

// --- model -------------------------------------------------------------------

/** One side's echoed metadata + the structured counts the deltas are verified against. */
export interface SimulationPlanDiffSide {
  /** Metadata only — NOT compared (two differently-labeled identical plans diff as identical). */
  planLabel: string | null;
  /** Metadata only — NOT compared. */
  operatorLabel: string | null;
  blocked: boolean;
  entryCount: number;
  unresolvedEntryCount: number;
  blockingCodeCount: number;
  warningCodeCount: number;
}

/** The source-ref fields the diff compares, in stable order. */
export const SIMULATION_PLAN_SOURCE_REF_FIELDS = [
  "present",
  "valid",
  "suppliedSchemaVersion",
  "label",
] as const;

/** One role whose source-artifact ref differs (both refs embedded VERBATIM). */
export interface SimulationPlanSourceRefChange {
  role: SimulationPlanSourceRole;
  /** The differing fields, stable order (subset of {@link SIMULATION_PLAN_SOURCE_REF_FIELDS}). */
  changedFields: string[];
  base: SimulationSourceArtifactRef;
  next: SimulationSourceArtifactRef;
}

/** The preview fields an entry can differ on. */
export const SIMULATION_PLAN_ENTRY_PREVIEW_FIELDS = ["destination", "amount", "fee"] as const;

/** One preview field's transition (status and/or label). */
export interface SimulationPlanEntryFieldChange {
  field: (typeof SIMULATION_PLAN_ENTRY_PREVIEW_FIELDS)[number];
  fromStatus: SimulationPreviewFieldStatus;
  toStatus: SimulationPreviewFieldStatus;
  fromLabel: string | null;
  toLabel: string | null;
}

/** One common candidate whose preview entry differs (only changed entries are listed). */
export interface SimulationPlanEntryChange {
  candidateId: string;
  previewStatusChanged: boolean;
  fromPreviewStatus: "resolved" | "unresolved";
  toPreviewStatus: "resolved" | "unresolved";
  /** Per-field transitions, stable field order; only fields that actually differ. */
  fieldChanges: SimulationPlanEntryFieldChange[];
  reasonCodesAdded: SimulationReasonCode[];
  reasonCodesRemoved: SimulationReasonCode[];
}

/** Aggregate count deltas (next − base). */
export interface SimulationIntentPlanDiffDeltas {
  entryCount: number;
  unresolvedEntryCount: number;
  blockingCodeCount: number;
  warningCodeCount: number;
}

/** The full, deterministic, JSON-serializable v2 intent plan diff. */
export interface SimulationIntentPlanDiffV2 {
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
  base: SimulationPlanDiffSide;
  next: SimulationPlanDiffSide;
  // --- blocked transition ---
  newlyBlocked: boolean;
  noLongerBlocked: boolean;
  // --- plan-level reason-code movements ---
  blockingCodesAdded: SimulationReasonCode[];
  blockingCodesRemoved: SimulationReasonCode[];
  warningCodesAdded: SimulationReasonCode[];
  warningCodesRemoved: SimulationReasonCode[];
  // --- source refs / summaries ---
  sourceRefChanges: SimulationPlanSourceRefChange[];
  /** The differing readiness-summary fields, stable order (gatesReady, gatesFailCount, prereqsReady, prereqsNotMetCount). */
  readinessChangedFields: string[];
  /** The differing spec-adoption fields, stable order (killSwitchAdopted, secretsPolicyAdopted, burnerIsolationAdopted, stopSimulationDeclaredTripped). */
  specAdoptionChangedFields: string[];
  acknowledgmentChanged: boolean;
  // --- entries (paired by candidateId) ---
  entriesAdded: string[];
  entriesRemoved: string[];
  commonEntryCount: number;
  entryChanges: SimulationPlanEntryChange[];
  // --- aggregates / verdict ---
  deltas: SimulationIntentPlanDiffDeltas;
  /** Stable machine-readable findings (`simulation-diff-plan-*`), fixed emission order. */
  diffReasonCodes: SimulationReasonCode[];
  hasChange: boolean;
  hasNewBlocking: boolean;
  hasNewUnresolved: boolean;
  notes: string[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function codesAdded(base: readonly SimulationReasonCode[], next: readonly SimulationReasonCode[]): SimulationReasonCode[] {
  const baseSet = new Set(base);
  return next.filter((c) => !baseSet.has(c));
}

function sideOf(plan: SimulationIntentPlanV2): SimulationPlanDiffSide {
  return {
    planLabel: plan.planLabel,
    operatorLabel: plan.operatorLabel,
    blocked: plan.blocked,
    entryCount: plan.entryCount,
    unresolvedEntryCount: plan.unresolvedEntryCount,
    blockingCodeCount: plan.blockingReasonCodes.length,
    warningCodeCount: plan.warningReasonCodes.length,
  };
}

function refFieldsDiffering(base: SimulationSourceArtifactRef, next: SimulationSourceArtifactRef): string[] {
  return SIMULATION_PLAN_SOURCE_REF_FIELDS.filter((f) => base[f] !== next[f]);
}

function entryChangeOf(
  base: SimulationIntentPlanEntryV2,
  next: SimulationIntentPlanEntryV2,
): SimulationPlanEntryChange | null {
  const fieldChanges: SimulationPlanEntryFieldChange[] = [];
  const previews = [
    ["destination", base.destinationPreview, next.destinationPreview],
    ["amount", base.amountPreview, next.amountPreview],
    ["fee", base.feePreview, next.feePreview],
  ] as const;
  for (const [field, b, n] of previews) {
    if (b.status !== n.status || b.label !== n.label) {
      fieldChanges.push({ field, fromStatus: b.status, toStatus: n.status, fromLabel: b.label, toLabel: n.label });
    }
  }
  const reasonCodesAdded = codesAdded(base.reasonCodes, next.reasonCodes);
  const reasonCodesRemoved = codesAdded(next.reasonCodes, base.reasonCodes);
  const previewStatusChanged = base.previewStatus !== next.previewStatus;
  if (!previewStatusChanged && fieldChanges.length === 0 && reasonCodesAdded.length === 0 && reasonCodesRemoved.length === 0) {
    return null;
  }
  return {
    candidateId: next.candidateId,
    previewStatusChanged,
    fromPreviewStatus: base.previewStatus,
    toPreviewStatus: next.previewStatus,
    fieldChanges,
    reasonCodesAdded,
    reasonCodesRemoved,
  };
}

const READINESS_FIELDS = ["gatesReady", "gatesFailCount", "prereqsReady", "prereqsNotMetCount"] as const;
const SPEC_ADOPTION_FIELDS = [
  "killSwitchAdopted",
  "secretsPolicyAdopted",
  "burnerIsolationAdopted",
  "stopSimulationDeclaredTripped",
] as const;

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link SimulationIntentPlanDiffV2} from two plans. Pure and non-mutating.
 * Both inputs are STRICTLY validated as `simulation.intent.plan.v2` through the production
 * validator — a wrong-schema artifact, a flipped literal lock, or any other corruption REFUSES
 * with a classified error naming the side. Every comparison is over verbatim structured fields;
 * nothing is re-derived from prose. Side labels are echoed but never compared. The findings are
 * stable `simulation-diff-plan-*` reason codes in a fixed emission order, and the produced diff is
 * self-validated before returning. Throws {@link SimulationIntentPlanDiffV2Error} on bad input.
 */
export function diffSimulationIntentPlansV2(baseInput: unknown, nextInput: unknown): SimulationIntentPlanDiffV2 {
  let base: SimulationIntentPlanV2;
  let next: SimulationIntentPlanV2;
  try {
    base = validateSimulationIntentPlanV2(baseInput);
  } catch (err) {
    throw new SimulationIntentPlanDiffV2Error(`base intent plan is invalid — no diff can be built over it: ${(err as Error).message}`);
  }
  try {
    next = validateSimulationIntentPlanV2(nextInput);
  } catch (err) {
    throw new SimulationIntentPlanDiffV2Error(`next intent plan is invalid — no diff can be built over it: ${(err as Error).message}`);
  }

  const newlyBlocked = !base.blocked && next.blocked;
  const noLongerBlocked = base.blocked && !next.blocked;

  const blockingCodesAdded = codesAdded(base.blockingReasonCodes, next.blockingReasonCodes);
  const blockingCodesRemoved = codesAdded(next.blockingReasonCodes, base.blockingReasonCodes);
  const warningCodesAdded = codesAdded(base.warningReasonCodes, next.warningReasonCodes);
  const warningCodesRemoved = codesAdded(next.warningReasonCodes, base.warningReasonCodes);

  // Source refs are positional (the validator pins the stable role order on both sides).
  const sourceRefChanges: SimulationPlanSourceRefChange[] = [];
  for (let i = 0; i < SIMULATION_PLAN_SOURCE_ROLES.length; i++) {
    const b = base.sourceArtifactRefs[i]!;
    const n = next.sourceArtifactRefs[i]!;
    const changedFields = refFieldsDiffering(b, n);
    if (changedFields.length > 0) sourceRefChanges.push({ role: n.role, changedFields, base: b, next: n });
  }

  const readinessChangedFields = READINESS_FIELDS.filter((f) => base.readinessSummary[f] !== next.readinessSummary[f]);
  const specAdoptionChangedFields = SPEC_ADOPTION_FIELDS.filter(
    (f) => base.specAdoptionSummary[f] !== next.specAdoptionSummary[f],
  );
  const acknowledgmentChanged = base.paperEnterReviewAcknowledgmentApplied !== next.paperEnterReviewAcknowledgmentApplied;

  // Entries paired by candidateId; membership order preserved from each side.
  const baseById = new Map(base.entries.map((e) => [e.candidateId, e]));
  const nextById = new Map(next.entries.map((e) => [e.candidateId, e]));
  const entriesAdded = next.entries.filter((e) => !baseById.has(e.candidateId)).map((e) => e.candidateId);
  const entriesRemoved = base.entries.filter((e) => !nextById.has(e.candidateId)).map((e) => e.candidateId);
  const common = next.entries.filter((e) => baseById.has(e.candidateId));
  const entryChanges = common
    .map((n) => entryChangeOf(baseById.get(n.candidateId)!, n))
    .filter((c): c is SimulationPlanEntryChange => c !== null);

  const deltas: SimulationIntentPlanDiffDeltas = {
    entryCount: next.entryCount - base.entryCount,
    unresolvedEntryCount: next.unresolvedEntryCount - base.unresolvedEntryCount,
    blockingCodeCount: next.blockingReasonCodes.length - base.blockingReasonCodes.length,
    warningCodeCount: next.warningReasonCodes.length - base.warningReasonCodes.length,
  };

  const entriesChanged = entriesAdded.length > 0 || entriesRemoved.length > 0 || entryChanges.length > 0;
  const hasChange =
    newlyBlocked ||
    noLongerBlocked ||
    blockingCodesAdded.length > 0 ||
    blockingCodesRemoved.length > 0 ||
    warningCodesAdded.length > 0 ||
    warningCodesRemoved.length > 0 ||
    sourceRefChanges.length > 0 ||
    readinessChangedFields.length > 0 ||
    specAdoptionChangedFields.length > 0 ||
    acknowledgmentChanged ||
    entriesChanged;
  const hasNewBlocking = newlyBlocked || blockingCodesAdded.length > 0;
  const hasNewUnresolved =
    deltas.unresolvedEntryCount > 0 ||
    entryChanges.some((c) => c.fieldChanges.some((f) => f.fromStatus === "resolved-as-label" && f.toStatus === "unresolved"));

  // Findings in fixed emission order (the validator recomputes this exact sequence).
  const diffReasonCodes: SimulationReasonCode[] = [
    ...(newlyBlocked ? (["simulation-diff-plan-newly-blocked"] as const) : []),
    ...(noLongerBlocked ? (["simulation-diff-plan-no-longer-blocked"] as const) : []),
    ...(blockingCodesAdded.length > 0 || blockingCodesRemoved.length > 0
      ? (["simulation-diff-plan-blocking-codes-changed"] as const)
      : []),
    ...(warningCodesAdded.length > 0 || warningCodesRemoved.length > 0
      ? (["simulation-diff-plan-warning-codes-changed"] as const)
      : []),
    ...(sourceRefChanges.length > 0 ? (["simulation-diff-plan-source-refs-changed"] as const) : []),
    ...(readinessChangedFields.length > 0 ? (["simulation-diff-plan-readiness-changed"] as const) : []),
    ...(specAdoptionChangedFields.length > 0 ? (["simulation-diff-plan-spec-adoption-changed"] as const) : []),
    ...(acknowledgmentChanged ? (["simulation-diff-plan-acknowledgment-changed"] as const) : []),
    ...(entriesChanged ? (["simulation-diff-plan-entries-changed"] as const) : []),
    ...(!hasChange ? (["simulation-diff-plan-identical"] as const) : []),
  ];

  const notes = hasChange
    ? [
        `${entriesAdded.length} entr${entriesAdded.length === 1 ? "y" : "ies"} added, ${entriesRemoved.length} removed, ${common.length} in both (${entryChanges.length} changed); ${diffReasonCodes.length} finding(s).`,
        "Every finding is computed from the two plans' VERBATIM structured fields — this diff re-derives nothing, parses no prose, and is not a trade signal.",
      ]
    : [
        "The two plans are identical across every compared structured field (side labels are metadata and are not compared).",
        "Every finding is computed from the two plans' VERBATIM structured fields — this diff re-derives nothing, parses no prose, and is not a trade signal.",
      ];

  const diff: SimulationIntentPlanDiffV2 = {
    schemaVersion: SIMULATION_INTENT_PLAN_DIFF_V2_SCHEMA_VERSION,
    banner: SIMULATION_INTENT_PLAN_DIFF_V2_BANNER,
    generatedBy: SIMULATION_INTENT_PLAN_DIFF_V2_GENERATED_BY,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    ...SIMULATION_SAFETY_LITERALS,
    disclaimers: [...SIMULATION_INTENT_PLAN_DIFF_V2_DISCLAIMERS],
    base: sideOf(base),
    next: sideOf(next),
    newlyBlocked,
    noLongerBlocked,
    blockingCodesAdded,
    blockingCodesRemoved,
    warningCodesAdded,
    warningCodesRemoved,
    sourceRefChanges,
    readinessChangedFields,
    specAdoptionChangedFields,
    acknowledgmentChanged,
    entriesAdded,
    entriesRemoved,
    commonEntryCount: common.length,
    entryChanges,
    deltas,
    diffReasonCodes,
    hasChange,
    hasNewBlocking,
    hasNewUnresolved,
    notes,
  };
  // Self-check: the builder's own output must pass the strict validator (defense in depth).
  return validateSimulationIntentPlanDiffV2(diff);
}

// --- validation (backstop) ---------------------------------------------------

function validateSideShape(value: unknown, where: string): SimulationPlanDiffSide {
  if (!isObject(value)) throw new SimulationIntentPlanDiffV2Error(`${where} must be an object`);
  for (const f of ["planLabel", "operatorLabel"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new SimulationIntentPlanDiffV2Error(`${where}.${f} must be a string or null`);
    }
  }
  if (typeof value.blocked !== "boolean") throw new SimulationIntentPlanDiffV2Error(`${where}.blocked must be a boolean`);
  for (const f of ["entryCount", "unresolvedEntryCount", "blockingCodeCount", "warningCodeCount"] as const) {
    if (typeof value[f] !== "number" || !Number.isInteger(value[f]) || (value[f] as number) < 0) {
      throw new SimulationIntentPlanDiffV2Error(`${where}.${f} must be a non-negative integer`);
    }
  }
  return value as unknown as SimulationPlanDiffSide;
}

function validateCodeArray(value: unknown, where: string): SimulationReasonCode[] {
  if (!Array.isArray(value) || value.some((x) => !isSimulationReasonCode(x))) {
    throw new SimulationIntentPlanDiffV2Error(`${where} must be an array of known simulation reason codes`);
  }
  return value as SimulationReasonCode[];
}

function validateStringArray(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some((x) => typeof x !== "string")) {
    throw new SimulationIntentPlanDiffV2Error(`${where} must be an array of strings`);
  }
  return value as string[];
}

const PREVIEW_FIELD_SET: ReadonlySet<string> = new Set(SIMULATION_PLAN_ENTRY_PREVIEW_FIELDS);
const PREVIEW_STATUS_SET: ReadonlySet<string> = new Set(["resolved-as-label", "unresolved"]);
const REF_FIELD_SET: ReadonlySet<string> = new Set(SIMULATION_PLAN_SOURCE_REF_FIELDS);

function validateEntryChange(value: unknown, where: string): SimulationPlanEntryChange {
  if (!isObject(value)) throw new SimulationIntentPlanDiffV2Error(`${where} must be an object`);
  if (!nonEmptyString(value.candidateId)) throw new SimulationIntentPlanDiffV2Error(`${where}.candidateId must be a non-empty string`);
  if (typeof value.previewStatusChanged !== "boolean") {
    throw new SimulationIntentPlanDiffV2Error(`${where}.previewStatusChanged must be a boolean`);
  }
  for (const f of ["fromPreviewStatus", "toPreviewStatus"] as const) {
    if (value[f] !== "resolved" && value[f] !== "unresolved") {
      throw new SimulationIntentPlanDiffV2Error(`${where}.${f} must be resolved|unresolved`);
    }
  }
  if (value.previewStatusChanged !== (value.fromPreviewStatus !== value.toPreviewStatus)) {
    throw new SimulationIntentPlanDiffV2Error(`${where}.previewStatusChanged must mirror its from/to statuses`);
  }
  if (!Array.isArray(value.fieldChanges)) throw new SimulationIntentPlanDiffV2Error(`${where}.fieldChanges must be an array`);
  (value.fieldChanges as unknown[]).forEach((fc, i) => {
    if (!isObject(fc)) throw new SimulationIntentPlanDiffV2Error(`${where}.fieldChanges[${i}] must be an object`);
    if (typeof fc.field !== "string" || !PREVIEW_FIELD_SET.has(fc.field)) {
      throw new SimulationIntentPlanDiffV2Error(`${where}.fieldChanges[${i}].field must be destination|amount|fee`);
    }
    for (const f of ["fromStatus", "toStatus"] as const) {
      if (typeof fc[f] !== "string" || !PREVIEW_STATUS_SET.has(fc[f] as string)) {
        throw new SimulationIntentPlanDiffV2Error(`${where}.fieldChanges[${i}].${f} must be resolved-as-label|unresolved`);
      }
    }
    for (const f of ["fromLabel", "toLabel"] as const) {
      if (fc[f] !== null && typeof fc[f] !== "string") {
        throw new SimulationIntentPlanDiffV2Error(`${where}.fieldChanges[${i}].${f} must be a string or null`);
      }
    }
    if (fc.fromStatus === fc.toStatus && fc.fromLabel === fc.toLabel) {
      throw new SimulationIntentPlanDiffV2Error(`${where}.fieldChanges[${i}] must describe an actual change`);
    }
  });
  const added = validateCodeArray(value.reasonCodesAdded, `${where}.reasonCodesAdded`);
  const removed = validateCodeArray(value.reasonCodesRemoved, `${where}.reasonCodesRemoved`);
  if (
    value.previewStatusChanged === false &&
    (value.fieldChanges as unknown[]).length === 0 &&
    added.length === 0 &&
    removed.length === 0
  ) {
    throw new SimulationIntentPlanDiffV2Error(`${where} must carry at least one change (unchanged entries are never listed)`);
  }
  return value as unknown as SimulationPlanEntryChange;
}

function validateSourceRefChange(value: unknown, where: string): SimulationPlanSourceRefChange {
  if (!isObject(value)) throw new SimulationIntentPlanDiffV2Error(`${where} must be an object`);
  if (typeof value.role !== "string" || !(SIMULATION_PLAN_SOURCE_ROLES as readonly string[]).includes(value.role)) {
    throw new SimulationIntentPlanDiffV2Error(`${where}.role must be one of the known source roles`);
  }
  const changed = validateStringArray(value.changedFields, `${where}.changedFields`);
  if (changed.length === 0 || changed.some((f) => !REF_FIELD_SET.has(f))) {
    throw new SimulationIntentPlanDiffV2Error(`${where}.changedFields must be a non-empty subset of the comparable ref fields`);
  }
  for (const sideKey of ["base", "next"] as const) {
    const ref = value[sideKey];
    if (!isObject(ref) || ref.role !== value.role) {
      throw new SimulationIntentPlanDiffV2Error(`${where}.${sideKey} must embed the verbatim ref for the same role`);
    }
  }
  for (const f of changed) {
    if ((value.base as Record<string, unknown>)[f] === (value.next as Record<string, unknown>)[f]) {
      throw new SimulationIntentPlanDiffV2Error(`${where}.changedFields lists "${f}" but base and next agree on it`);
    }
  }
  return value as unknown as SimulationPlanSourceRefChange;
}

/**
 * Strictly validate a value as a {@link SimulationIntentPlanDiffV2} and return it narrowed.
 * Enforces the four literal safety locks, the blocked-transition consistency, the recomputed
 * deltas (against the embedded side counts), the exact recomputed `diffReasonCodes` emission
 * order, and the recomputed `hasChange` / `hasNewBlocking` verdicts. Throws
 * {@link SimulationIntentPlanDiffV2Error} (or a SimulationSafetyError for a flipped lock) on the
 * first problem. Pure.
 */
export function validateSimulationIntentPlanDiffV2(value: unknown): SimulationIntentPlanDiffV2 {
  if (!isObject(value)) throw new SimulationIntentPlanDiffV2Error("intent plan diff must be a JSON object");
  if (value.schemaVersion !== SIMULATION_INTENT_PLAN_DIFF_V2_SCHEMA_VERSION) {
    throw new SimulationIntentPlanDiffV2Error(`intent plan diff.schemaVersion must be "${SIMULATION_INTENT_PLAN_DIFF_V2_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SIMULATION_INTENT_PLAN_DIFF_V2_BANNER) {
    throw new SimulationIntentPlanDiffV2Error(`intent plan diff.banner must be "${SIMULATION_INTENT_PLAN_DIFF_V2_BANNER}"`);
  }
  if (value.generatedBy !== SIMULATION_INTENT_PLAN_DIFF_V2_GENERATED_BY) {
    throw new SimulationIntentPlanDiffV2Error(`intent plan diff.generatedBy must be "${SIMULATION_INTENT_PLAN_DIFF_V2_GENERATED_BY}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new SimulationIntentPlanDiffV2Error(`intent plan diff.${flag} must be true`);
  }
  assertSimulationSafetyLiterals(value, "intent plan diff");
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SimulationIntentPlanDiffV2Error("intent plan diff.disclaimers must be a non-empty array");
  }
  const base = validateSideShape(value.base, "intent plan diff.base");
  const next = validateSideShape(value.next, "intent plan diff.next");

  for (const f of ["newlyBlocked", "noLongerBlocked", "acknowledgmentChanged", "hasChange", "hasNewBlocking", "hasNewUnresolved"] as const) {
    if (typeof value[f] !== "boolean") throw new SimulationIntentPlanDiffV2Error(`intent plan diff.${f} must be a boolean`);
  }
  if (value.newlyBlocked !== (!base.blocked && next.blocked)) {
    throw new SimulationIntentPlanDiffV2Error("intent plan diff.newlyBlocked must mirror the sides' blocked states");
  }
  if (value.noLongerBlocked !== (base.blocked && !next.blocked)) {
    throw new SimulationIntentPlanDiffV2Error("intent plan diff.noLongerBlocked must mirror the sides' blocked states");
  }

  const blockingCodesAdded = validateCodeArray(value.blockingCodesAdded, "intent plan diff.blockingCodesAdded");
  const blockingCodesRemoved = validateCodeArray(value.blockingCodesRemoved, "intent plan diff.blockingCodesRemoved");
  const warningCodesAdded = validateCodeArray(value.warningCodesAdded, "intent plan diff.warningCodesAdded");
  const warningCodesRemoved = validateCodeArray(value.warningCodesRemoved, "intent plan diff.warningCodesRemoved");

  if (!Array.isArray(value.sourceRefChanges)) throw new SimulationIntentPlanDiffV2Error("intent plan diff.sourceRefChanges must be an array");
  const sourceRefChanges = (value.sourceRefChanges as unknown[]).map((c, i) =>
    validateSourceRefChange(c, `intent plan diff.sourceRefChanges[${i}]`),
  );

  const readinessChangedFields = validateStringArray(value.readinessChangedFields, "intent plan diff.readinessChangedFields");
  if (readinessChangedFields.some((f) => !(READINESS_FIELDS as readonly string[]).includes(f))) {
    throw new SimulationIntentPlanDiffV2Error("intent plan diff.readinessChangedFields must list only known readiness fields");
  }
  const specAdoptionChangedFields = validateStringArray(value.specAdoptionChangedFields, "intent plan diff.specAdoptionChangedFields");
  if (specAdoptionChangedFields.some((f) => !(SPEC_ADOPTION_FIELDS as readonly string[]).includes(f))) {
    throw new SimulationIntentPlanDiffV2Error("intent plan diff.specAdoptionChangedFields must list only known spec-adoption fields");
  }

  const entriesAdded = validateStringArray(value.entriesAdded, "intent plan diff.entriesAdded");
  const entriesRemoved = validateStringArray(value.entriesRemoved, "intent plan diff.entriesRemoved");
  for (const id of entriesAdded) {
    if (entriesRemoved.includes(id)) {
      throw new SimulationIntentPlanDiffV2Error(`intent plan diff: "${id}" cannot be both added and removed`);
    }
  }
  if (typeof value.commonEntryCount !== "number" || !Number.isInteger(value.commonEntryCount) || value.commonEntryCount < 0) {
    throw new SimulationIntentPlanDiffV2Error("intent plan diff.commonEntryCount must be a non-negative integer");
  }
  if (!Array.isArray(value.entryChanges)) throw new SimulationIntentPlanDiffV2Error("intent plan diff.entryChanges must be an array");
  const entryChanges = (value.entryChanges as unknown[]).map((c, i) => validateEntryChange(c, `intent plan diff.entryChanges[${i}]`));
  if (entryChanges.length > (value.commonEntryCount as number)) {
    throw new SimulationIntentPlanDiffV2Error("intent plan diff.entryChanges cannot exceed the common entry count");
  }

  if (!isObject(value.deltas)) throw new SimulationIntentPlanDiffV2Error("intent plan diff.deltas must be an object");
  const expectedDeltas: SimulationIntentPlanDiffDeltas = {
    entryCount: next.entryCount - base.entryCount,
    unresolvedEntryCount: next.unresolvedEntryCount - base.unresolvedEntryCount,
    blockingCodeCount: next.blockingCodeCount - base.blockingCodeCount,
    warningCodeCount: next.warningCodeCount - base.warningCodeCount,
  };
  for (const f of ["entryCount", "unresolvedEntryCount", "blockingCodeCount", "warningCodeCount"] as const) {
    if ((value.deltas as Record<string, unknown>)[f] !== expectedDeltas[f]) {
      throw new SimulationIntentPlanDiffV2Error(`intent plan diff.deltas.${f} must equal the recomputed value (${expectedDeltas[f]})`);
    }
  }

  const entriesChanged = entriesAdded.length > 0 || entriesRemoved.length > 0 || entryChanges.length > 0;
  const expectedHasChange =
    (value.newlyBlocked as boolean) ||
    (value.noLongerBlocked as boolean) ||
    blockingCodesAdded.length > 0 ||
    blockingCodesRemoved.length > 0 ||
    warningCodesAdded.length > 0 ||
    warningCodesRemoved.length > 0 ||
    sourceRefChanges.length > 0 ||
    readinessChangedFields.length > 0 ||
    specAdoptionChangedFields.length > 0 ||
    (value.acknowledgmentChanged as boolean) ||
    entriesChanged;
  if (value.hasChange !== expectedHasChange) {
    throw new SimulationIntentPlanDiffV2Error("intent plan diff.hasChange must mirror the recomputed verdict");
  }
  if (value.hasNewBlocking !== ((value.newlyBlocked as boolean) || blockingCodesAdded.length > 0)) {
    throw new SimulationIntentPlanDiffV2Error("intent plan diff.hasNewBlocking must mirror the recomputed verdict");
  }
  const expectedHasNewUnresolved =
    expectedDeltas.unresolvedEntryCount > 0 ||
    entryChanges.some((c) => c.fieldChanges.some((f) => f.fromStatus === "resolved-as-label" && f.toStatus === "unresolved"));
  if (value.hasNewUnresolved !== expectedHasNewUnresolved) {
    throw new SimulationIntentPlanDiffV2Error("intent plan diff.hasNewUnresolved must mirror the recomputed verdict");
  }

  const expectedCodes: SimulationReasonCode[] = [
    ...((value.newlyBlocked as boolean) ? (["simulation-diff-plan-newly-blocked"] as const) : []),
    ...((value.noLongerBlocked as boolean) ? (["simulation-diff-plan-no-longer-blocked"] as const) : []),
    ...(blockingCodesAdded.length > 0 || blockingCodesRemoved.length > 0
      ? (["simulation-diff-plan-blocking-codes-changed"] as const)
      : []),
    ...(warningCodesAdded.length > 0 || warningCodesRemoved.length > 0
      ? (["simulation-diff-plan-warning-codes-changed"] as const)
      : []),
    ...(sourceRefChanges.length > 0 ? (["simulation-diff-plan-source-refs-changed"] as const) : []),
    ...(readinessChangedFields.length > 0 ? (["simulation-diff-plan-readiness-changed"] as const) : []),
    ...(specAdoptionChangedFields.length > 0 ? (["simulation-diff-plan-spec-adoption-changed"] as const) : []),
    ...((value.acknowledgmentChanged as boolean) ? (["simulation-diff-plan-acknowledgment-changed"] as const) : []),
    ...(entriesChanged ? (["simulation-diff-plan-entries-changed"] as const) : []),
    ...(!expectedHasChange ? (["simulation-diff-plan-identical"] as const) : []),
  ];
  const actualCodes = validateCodeArray(value.diffReasonCodes, "intent plan diff.diffReasonCodes");
  if (actualCodes.join("|") !== expectedCodes.join("|")) {
    throw new SimulationIntentPlanDiffV2Error(
      `intent plan diff.diffReasonCodes must be exactly the recomputed findings (${expectedCodes.join(", ") || "none"})`,
    );
  }
  if (!Array.isArray(value.notes) || (value.notes as unknown[]).some((x) => typeof x !== "string")) {
    throw new SimulationIntentPlanDiffV2Error("intent plan diff.notes must be an array of strings");
  }
  return value as unknown as SimulationIntentPlanDiffV2;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSimulationIntentPlanDiffV2}. */
export interface FormatSimulationIntentPlanDiffV2Options {
  label?: string;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

/**
 * Render a redacted, stable, human-readable intent plan diff. Deterministic and path-stable.
 * Leads with the comparison-only framing and the change verdict, shows both sides, every finding
 * with its operator message, the per-entry changes, and the aggregate deltas — and never phrases
 * anything as an execution, a trade, or live readiness. Passed through the shared redactor.
 */
export function formatSimulationIntentPlanDiffV2(
  diff: SimulationIntentPlanDiffV2,
  opts: FormatSimulationIntentPlanDiffV2Options = {},
): string {
  const header =
    "SIMULATION INTENT PLAN DIFF — PREVIEW COMPARISON ONLY (simulation only; does not sign; does not send; does not authorize live trading)";
  const lines: string[] = [header, "=".repeat(header.length)];
  if (opts.label) lines.push(`label: ${opts.label}`);
  const side = (s: SimulationPlanDiffSide): string =>
    `${s.planLabel ?? "(unlabeled)"} — ${s.blocked ? "BLOCKED" : "unblocked"}; ${s.entryCount} entr${s.entryCount === 1 ? "y" : "ies"} (${s.unresolvedEntryCount} unresolved); ${s.blockingCodeCount} blocking / ${s.warningCodeCount} warning code(s)`;
  lines.push(`base: ${side(diff.base)}`);
  lines.push(`next: ${side(diff.next)}`);
  lines.push(`verdict: ${diff.hasChange ? "CHANGED" : "identical (no structured-field change)"}`);

  lines.push("");
  lines.push("Findings:");
  if (diff.diffReasonCodes.length === 0) lines.push("- (none)");
  for (const c of diff.diffReasonCodes) {
    lines.push(`${SIMULATION_REASON_CODE_DEFINITIONS[c].warning ? "!" : "·"} ${c}`);
    lines.push(`    ${SIMULATION_REASON_CODE_DEFINITIONS[c].operatorMessage}`);
  }

  const codeLine = (label: string, codes: readonly SimulationReasonCode[]): void => {
    if (codes.length > 0) lines.push(`- ${label}: ${codes.join(", ")}`);
  };
  lines.push("");
  lines.push("Plan-level code movements:");
  codeLine("blocking added", diff.blockingCodesAdded);
  codeLine("blocking removed", diff.blockingCodesRemoved);
  codeLine("warning added", diff.warningCodesAdded);
  codeLine("warning removed", diff.warningCodesRemoved);
  if (
    diff.blockingCodesAdded.length + diff.blockingCodesRemoved.length + diff.warningCodesAdded.length + diff.warningCodesRemoved.length === 0
  ) {
    lines.push("- (none)");
  }

  if (diff.sourceRefChanges.length > 0) {
    lines.push("");
    lines.push("Source artifact ref changes:");
    for (const c of diff.sourceRefChanges) {
      lines.push(`- ${c.role}: ${c.changedFields.join(", ")} changed`);
    }
  }
  if (diff.readinessChangedFields.length > 0) lines.push(`Readiness summary changed: ${diff.readinessChangedFields.join(", ")}`);
  if (diff.specAdoptionChangedFields.length > 0) lines.push(`Spec adoption changed: ${diff.specAdoptionChangedFields.join(", ")}`);
  if (diff.acknowledgmentChanged) lines.push("Operator paper-enter-review acknowledgment changed between the two plans.");

  lines.push("");
  lines.push(`Entries: +${diff.entriesAdded.length} added / -${diff.entriesRemoved.length} removed / ${diff.commonEntryCount} in both (${diff.entryChanges.length} changed)`);
  if (diff.entriesAdded.length > 0) lines.push(`  added:   ${diff.entriesAdded.join(", ")}`);
  if (diff.entriesRemoved.length > 0) lines.push(`  removed: ${diff.entriesRemoved.join(", ")}`);
  for (const c of diff.entryChanges) {
    lines.push(`- ${c.candidateId}${c.previewStatusChanged ? `  [${c.fromPreviewStatus} → ${c.toPreviewStatus}]` : ""}`);
    for (const f of c.fieldChanges) {
      lines.push(`    ${f.field}: ${f.fromStatus}${f.fromLabel ? ` (${f.fromLabel})` : ""} → ${f.toStatus}${f.toLabel ? ` (${f.toLabel})` : ""}`);
    }
    if (c.reasonCodesAdded.length > 0) lines.push(`    codes added:   ${c.reasonCodesAdded.join(", ")}`);
    if (c.reasonCodesRemoved.length > 0) lines.push(`    codes removed: ${c.reasonCodesRemoved.join(", ")}`);
  }

  lines.push("");
  lines.push("Aggregate deltas (next − base):");
  lines.push(
    `  entries: ${signed(diff.deltas.entryCount)}  unresolved: ${signed(diff.deltas.unresolvedEntryCount)}  blocking codes: ${signed(diff.deltas.blockingCodeCount)}  warning codes: ${signed(diff.deltas.warningCodeCount)}`,
  );
  lines.push(`Any change:        ${diff.hasChange ? "YES" : "no"}`);
  lines.push(`Any new blocking:  ${diff.hasNewBlocking ? "YES" : "no"}`);
  lines.push(`Any new unresolved: ${diff.hasNewUnresolved ? "YES" : "no"}`);

  lines.push("");
  lines.push(`Next safe action: ${diff.hasChange
    ? "review every finding above against its two source plans; a changed preview is still SIMULATION ONLY and never a live action."
    : "no structured change to review; both plans remain SIMULATION ONLY artifacts."}`);

  lines.push("");
  lines.push("Notes:");
  for (const note of diff.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of diff.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
