/**
 * Deterministic, offline **SIMULATION RESULT DIFF V1** (`simulation.result.diff.v1`, Sprint 73 —
 * the second half of the Phase 6 diff chain).
 *
 * Two `simulation.result.v1` artifacts record what two simulation passes honestly did. This module
 * compares them from STRUCTURED FIELDS ONLY — never by parsing prose: the result status, the
 * blocked transition, result-level blocking codes, the adapter identity, the source-plan
 * reference, and the per-candidate entries (membership, entry status, reason codes, unresolved
 * fields).
 *
 * Both inputs are STRICTLY validated through the production result validator first — a
 * wrong-schema artifact, a tampered literal lock, or any other corruption REFUSES the diff. Every
 * finding is surfaced as a stable machine-readable `simulation-diff-result-*` reason code. Side
 * labels are echoed as metadata but NOT compared. (Result-level warning codes derive entirely from
 * entries, so their movements are surfaced through the entries-changed finding; the added/removed
 * code lists are still carried verbatim.)
 *
 * A diff over dry-run records is still a dry-run record: nothing here claims chain inclusion,
 * execution, trade success, or profit/loss. The diff carries the four literal safety locks. Pure:
 * no I/O, no network, no wallet, no wall-clock — the same pair yields a byte-identical diff.
 */

import { redactString } from "@soulmaker/security";
import {
  SIMULATION_PACKAGE_DISCLAIMERS,
  SIMULATION_OPERATOR_SAFETY_LINE,
  SIMULATION_SAFETY_LITERALS,
  assertSimulationSafetyLiterals,
} from "./safety.js";
import {
  SIMULATION_REASON_CODE_DEFINITIONS,
  isSimulationReasonCode,
  type SimulationReasonCode,
} from "./reason-codes.js";
import {
  validateSimulationResultV1,
  SIMULATION_RESULT_STATUSES,
  SIMULATION_RESULT_ENTRY_STATUSES,
  type SimulationResultV1,
  type SimulationResultEntryV1,
  type SimulationResultPlanRef,
  type SimulationResultStatus,
  type SimulationResultEntryStatus,
} from "./result.js";

/** Stable schema identifier for the v1 simulation result diff. Bump only on a breaking change. */
export const SIMULATION_RESULT_DIFF_V1_SCHEMA_VERSION = "simulation.result.diff.v1";

/** The banner that prefixes every simulation result diff (required label). */
export const SIMULATION_RESULT_DIFF_V1_BANNER =
  "SIMULATION RESULT DIFF V1 (DRY-RUN RECORD COMPARISON ONLY — NOT AN EXECUTION, NEVER SIGNS, NEVER SENDS)";

/** The fixed `generatedBy` marker (deterministic provenance; never an operator value). */
export const SIMULATION_RESULT_DIFF_V1_GENERATED_BY = "@soulmaker/simulation";

/** Required disclaimer statements carried by every simulation result diff (stable order). */
export const SIMULATION_RESULT_DIFF_V1_DISCLAIMERS: readonly string[] = [
  "SIMULATION RESULT DIFF V1 — a deterministic comparison of two strictly-validated simulation results (base vs next), computed from STRUCTURED FIELDS ONLY (never from prose).",
  "A diff over dry-run records is still a dry-run record: it never claims chain inclusion, execution, trade success, or profit/loss, and it does not authorize live trading.",
  ...SIMULATION_PACKAGE_DISCLAIMERS,
];

/** Thrown when result-diff INPUT or a produced diff is structurally invalid. */
export class SimulationResultDiffV1Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationResultDiffV1Error";
  }
}

// --- model -------------------------------------------------------------------

/** One side's echoed metadata + the structured fields the diff is verified against. */
export interface SimulationResultDiffSide {
  /** The source-plan reference embedded VERBATIM (compared field-by-field). */
  planRef: SimulationResultPlanRef;
  resultStatus: SimulationResultStatus;
  adapterId: string;
  dryRunAttempted: boolean;
  entryCount: number;
  skippedCount: number;
  unavailableCount: number;
  failedCount: number;
  completedCount: number;
  blockedCodeCount: number;
  warningCodeCount: number;
}

/** The plan-ref fields the diff compares, in stable order (schemaVersion is validator-pinned equal). */
export const SIMULATION_RESULT_PLAN_REF_FIELDS = ["planLabel", "operatorLabel", "blocked", "entryCount"] as const;

/** One common candidate whose result entry differs (only changed entries are listed). */
export interface SimulationResultEntryChange {
  candidateId: string;
  statusChanged: boolean;
  fromStatus: SimulationResultEntryStatus;
  toStatus: SimulationResultEntryStatus;
  reasonCodesAdded: SimulationReasonCode[];
  reasonCodesRemoved: SimulationReasonCode[];
  unresolvedFieldsAdded: string[];
  unresolvedFieldsRemoved: string[];
}

/** Aggregate count deltas (next − base). */
export interface SimulationResultDiffDeltas {
  entryCount: number;
  skippedCount: number;
  unavailableCount: number;
  failedCount: number;
  completedCount: number;
}

/** The full, deterministic, JSON-serializable simulation result diff. */
export interface SimulationResultDiffV1 {
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
  base: SimulationResultDiffSide;
  next: SimulationResultDiffSide;
  // --- transitions ---
  resultStatusChanged: boolean;
  newlyBlocked: boolean;
  noLongerBlocked: boolean;
  adapterChanged: boolean;
  dryRunAttemptedChanged: boolean;
  /** The differing plan-ref fields, stable order (subset of {@link SIMULATION_RESULT_PLAN_REF_FIELDS}). */
  planRefChangedFields: string[];
  // --- result-level reason-code movements ---
  blockedCodesAdded: SimulationReasonCode[];
  blockedCodesRemoved: SimulationReasonCode[];
  warningCodesAdded: SimulationReasonCode[];
  warningCodesRemoved: SimulationReasonCode[];
  // --- entries (paired by candidateId) ---
  entriesAdded: string[];
  entriesRemoved: string[];
  commonEntryCount: number;
  entryChanges: SimulationResultEntryChange[];
  // --- aggregates / verdict ---
  deltas: SimulationResultDiffDeltas;
  /** Stable machine-readable findings (`simulation-diff-result-*`), fixed emission order. */
  diffReasonCodes: SimulationReasonCode[];
  hasChange: boolean;
  hasNewBlocking: boolean;
  notes: string[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function addedOf<T>(base: readonly T[], next: readonly T[]): T[] {
  const baseSet = new Set(base);
  return next.filter((c) => !baseSet.has(c));
}

function sideOf(result: SimulationResultV1): SimulationResultDiffSide {
  return {
    planRef: { ...result.sourcePlanRef },
    resultStatus: result.resultStatus,
    adapterId: result.adapterSummary.adapterId,
    dryRunAttempted: result.dryRunAttempted,
    entryCount: result.entryCount,
    skippedCount: result.skippedCount,
    unavailableCount: result.unavailableCount,
    failedCount: result.failedCount,
    completedCount: result.completedCount,
    blockedCodeCount: result.blockedReasonCodes.length,
    warningCodeCount: result.warningReasonCodes.length,
  };
}

function entryChangeOf(base: SimulationResultEntryV1, next: SimulationResultEntryV1): SimulationResultEntryChange | null {
  const reasonCodesAdded = addedOf(base.reasonCodes, next.reasonCodes);
  const reasonCodesRemoved = addedOf(next.reasonCodes, base.reasonCodes);
  const unresolvedFieldsAdded = addedOf(base.unresolvedFields, next.unresolvedFields);
  const unresolvedFieldsRemoved = addedOf(next.unresolvedFields, base.unresolvedFields);
  const statusChanged = base.entryStatus !== next.entryStatus;
  if (
    !statusChanged &&
    reasonCodesAdded.length === 0 &&
    reasonCodesRemoved.length === 0 &&
    unresolvedFieldsAdded.length === 0 &&
    unresolvedFieldsRemoved.length === 0
  ) {
    return null;
  }
  return {
    candidateId: next.candidateId,
    statusChanged,
    fromStatus: base.entryStatus,
    toStatus: next.entryStatus,
    reasonCodesAdded,
    reasonCodesRemoved,
    unresolvedFieldsAdded,
    unresolvedFieldsRemoved,
  };
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link SimulationResultDiffV1} from two results. Pure and non-mutating.
 * Both inputs are STRICTLY validated as `simulation.result.v1` through the production validator —
 * a wrong-schema artifact, a flipped literal lock, or any other corruption REFUSES with a
 * classified error naming the side. Every comparison is over verbatim structured fields; the
 * findings are stable `simulation-diff-result-*` reason codes in a fixed emission order, and the
 * produced diff is self-validated before returning. Throws {@link SimulationResultDiffV1Error}
 * on bad input.
 */
export function diffSimulationResultsV1(baseInput: unknown, nextInput: unknown): SimulationResultDiffV1 {
  let base: SimulationResultV1;
  let next: SimulationResultV1;
  try {
    base = validateSimulationResultV1(baseInput);
  } catch (err) {
    throw new SimulationResultDiffV1Error(`base simulation result is invalid — no diff can be built over it: ${(err as Error).message}`);
  }
  try {
    next = validateSimulationResultV1(nextInput);
  } catch (err) {
    throw new SimulationResultDiffV1Error(`next simulation result is invalid — no diff can be built over it: ${(err as Error).message}`);
  }

  const resultStatusChanged = base.resultStatus !== next.resultStatus;
  const newlyBlocked = base.resultStatus !== "blocked" && next.resultStatus === "blocked";
  const noLongerBlocked = base.resultStatus === "blocked" && next.resultStatus !== "blocked";
  const adapterChanged = base.adapterSummary.adapterId !== next.adapterSummary.adapterId;
  const dryRunAttemptedChanged = base.dryRunAttempted !== next.dryRunAttempted;
  const planRefChangedFields = SIMULATION_RESULT_PLAN_REF_FIELDS.filter(
    (f) => base.sourcePlanRef[f] !== next.sourcePlanRef[f],
  );

  const blockedCodesAdded = addedOf(base.blockedReasonCodes, next.blockedReasonCodes);
  const blockedCodesRemoved = addedOf(next.blockedReasonCodes, base.blockedReasonCodes);
  const warningCodesAdded = addedOf(base.warningReasonCodes, next.warningReasonCodes);
  const warningCodesRemoved = addedOf(next.warningReasonCodes, base.warningReasonCodes);

  const baseById = new Map(base.entries.map((e) => [e.candidateId, e]));
  const nextById = new Map(next.entries.map((e) => [e.candidateId, e]));
  const entriesAdded = next.entries.filter((e) => !baseById.has(e.candidateId)).map((e) => e.candidateId);
  const entriesRemoved = base.entries.filter((e) => !nextById.has(e.candidateId)).map((e) => e.candidateId);
  const common = next.entries.filter((e) => baseById.has(e.candidateId));
  const entryChanges = common
    .map((n) => entryChangeOf(baseById.get(n.candidateId)!, n))
    .filter((c): c is SimulationResultEntryChange => c !== null);

  const deltas: SimulationResultDiffDeltas = {
    entryCount: next.entryCount - base.entryCount,
    skippedCount: next.skippedCount - base.skippedCount,
    unavailableCount: next.unavailableCount - base.unavailableCount,
    failedCount: next.failedCount - base.failedCount,
    completedCount: next.completedCount - base.completedCount,
  };

  const entriesChanged = entriesAdded.length > 0 || entriesRemoved.length > 0 || entryChanges.length > 0;
  const warningCodesMoved = warningCodesAdded.length > 0 || warningCodesRemoved.length > 0;
  const hasChange =
    resultStatusChanged ||
    adapterChanged ||
    dryRunAttemptedChanged ||
    planRefChangedFields.length > 0 ||
    blockedCodesAdded.length > 0 ||
    blockedCodesRemoved.length > 0 ||
    warningCodesMoved ||
    entriesChanged;
  const hasNewBlocking = newlyBlocked || blockedCodesAdded.length > 0;

  // Findings in fixed emission order (the validator recomputes this exact sequence).
  const diffReasonCodes: SimulationReasonCode[] = [
    ...(newlyBlocked ? (["simulation-diff-result-newly-blocked"] as const) : []),
    ...(noLongerBlocked ? (["simulation-diff-result-no-longer-blocked"] as const) : []),
    ...(resultStatusChanged ? (["simulation-diff-result-status-changed"] as const) : []),
    ...(blockedCodesAdded.length > 0 || blockedCodesRemoved.length > 0
      ? (["simulation-diff-result-blocking-codes-changed"] as const)
      : []),
    ...(adapterChanged ? (["simulation-diff-result-adapter-changed"] as const) : []),
    ...(planRefChangedFields.length > 0 ? (["simulation-diff-result-plan-ref-changed"] as const) : []),
    ...(entriesChanged ? (["simulation-diff-result-entries-changed"] as const) : []),
    ...(!hasChange ? (["simulation-diff-result-identical"] as const) : []),
  ];

  const notes = hasChange
    ? [
        `${entriesAdded.length} entr${entriesAdded.length === 1 ? "y" : "ies"} added, ${entriesRemoved.length} removed, ${common.length} in both (${entryChanges.length} changed); ${diffReasonCodes.length} finding(s).`,
        "Every finding is computed from the two results' VERBATIM structured fields — this diff re-derives nothing, parses no prose, and never claims execution or a trade.",
      ]
    : [
        "The two simulation results are identical across every compared structured field (side labels are metadata and are not compared).",
        "Every finding is computed from the two results' VERBATIM structured fields — this diff re-derives nothing, parses no prose, and never claims execution or a trade.",
      ];

  const diff: SimulationResultDiffV1 = {
    schemaVersion: SIMULATION_RESULT_DIFF_V1_SCHEMA_VERSION,
    banner: SIMULATION_RESULT_DIFF_V1_BANNER,
    generatedBy: SIMULATION_RESULT_DIFF_V1_GENERATED_BY,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    ...SIMULATION_SAFETY_LITERALS,
    disclaimers: [...SIMULATION_RESULT_DIFF_V1_DISCLAIMERS],
    base: sideOf(base),
    next: sideOf(next),
    resultStatusChanged,
    newlyBlocked,
    noLongerBlocked,
    adapterChanged,
    dryRunAttemptedChanged,
    planRefChangedFields,
    blockedCodesAdded,
    blockedCodesRemoved,
    warningCodesAdded,
    warningCodesRemoved,
    entriesAdded,
    entriesRemoved,
    commonEntryCount: common.length,
    entryChanges,
    deltas,
    diffReasonCodes,
    hasChange,
    hasNewBlocking,
    notes,
  };
  // Self-check: the builder's own output must pass the strict validator (defense in depth).
  return validateSimulationResultDiffV1(diff);
}

// --- validation (backstop) ---------------------------------------------------

const RESULT_STATUS_SET: ReadonlySet<string> = new Set(SIMULATION_RESULT_STATUSES);
const ENTRY_STATUS_SET: ReadonlySet<string> = new Set(SIMULATION_RESULT_ENTRY_STATUSES);
const PLAN_REF_FIELD_SET: ReadonlySet<string> = new Set(SIMULATION_RESULT_PLAN_REF_FIELDS);

function validateCodeArray(value: unknown, where: string): SimulationReasonCode[] {
  if (!Array.isArray(value) || value.some((x) => !isSimulationReasonCode(x))) {
    throw new SimulationResultDiffV1Error(`${where} must be an array of known simulation reason codes`);
  }
  return value as SimulationReasonCode[];
}

function validateStringArray(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some((x) => typeof x !== "string")) {
    throw new SimulationResultDiffV1Error(`${where} must be an array of strings`);
  }
  return value as string[];
}

function validateSideShape(value: unknown, where: string): SimulationResultDiffSide {
  if (!isObject(value)) throw new SimulationResultDiffV1Error(`${where} must be an object`);
  if (!isObject(value.planRef)) throw new SimulationResultDiffV1Error(`${where}.planRef must be an object`);
  const ref = value.planRef as Record<string, unknown>;
  for (const f of ["planLabel", "operatorLabel"] as const) {
    if (ref[f] !== null && typeof ref[f] !== "string") {
      throw new SimulationResultDiffV1Error(`${where}.planRef.${f} must be a string or null`);
    }
  }
  if (typeof ref.blocked !== "boolean") throw new SimulationResultDiffV1Error(`${where}.planRef.blocked must be a boolean`);
  if (typeof ref.entryCount !== "number" || !Number.isInteger(ref.entryCount) || ref.entryCount < 0) {
    throw new SimulationResultDiffV1Error(`${where}.planRef.entryCount must be a non-negative integer`);
  }
  if (typeof value.resultStatus !== "string" || !RESULT_STATUS_SET.has(value.resultStatus)) {
    throw new SimulationResultDiffV1Error(`${where}.resultStatus must be one of ${SIMULATION_RESULT_STATUSES.join("|")}`);
  }
  if (!nonEmptyString(value.adapterId)) throw new SimulationResultDiffV1Error(`${where}.adapterId must be a non-empty string`);
  if (typeof value.dryRunAttempted !== "boolean") throw new SimulationResultDiffV1Error(`${where}.dryRunAttempted must be a boolean`);
  for (const f of [
    "entryCount",
    "skippedCount",
    "unavailableCount",
    "failedCount",
    "completedCount",
    "blockedCodeCount",
    "warningCodeCount",
  ] as const) {
    if (typeof value[f] !== "number" || !Number.isInteger(value[f]) || (value[f] as number) < 0) {
      throw new SimulationResultDiffV1Error(`${where}.${f} must be a non-negative integer`);
    }
  }
  return value as unknown as SimulationResultDiffSide;
}

function validateEntryChange(value: unknown, where: string): SimulationResultEntryChange {
  if (!isObject(value)) throw new SimulationResultDiffV1Error(`${where} must be an object`);
  if (!nonEmptyString(value.candidateId)) throw new SimulationResultDiffV1Error(`${where}.candidateId must be a non-empty string`);
  if (typeof value.statusChanged !== "boolean") throw new SimulationResultDiffV1Error(`${where}.statusChanged must be a boolean`);
  for (const f of ["fromStatus", "toStatus"] as const) {
    if (typeof value[f] !== "string" || !ENTRY_STATUS_SET.has(value[f] as string)) {
      throw new SimulationResultDiffV1Error(`${where}.${f} must be one of ${SIMULATION_RESULT_ENTRY_STATUSES.join("|")}`);
    }
  }
  if (value.statusChanged !== (value.fromStatus !== value.toStatus)) {
    throw new SimulationResultDiffV1Error(`${where}.statusChanged must mirror its from/to statuses`);
  }
  const reasonCodesAdded = validateCodeArray(value.reasonCodesAdded, `${where}.reasonCodesAdded`);
  const reasonCodesRemoved = validateCodeArray(value.reasonCodesRemoved, `${where}.reasonCodesRemoved`);
  const unresolvedFieldsAdded = validateStringArray(value.unresolvedFieldsAdded, `${where}.unresolvedFieldsAdded`);
  const unresolvedFieldsRemoved = validateStringArray(value.unresolvedFieldsRemoved, `${where}.unresolvedFieldsRemoved`);
  if (
    value.statusChanged === false &&
    reasonCodesAdded.length === 0 &&
    reasonCodesRemoved.length === 0 &&
    unresolvedFieldsAdded.length === 0 &&
    unresolvedFieldsRemoved.length === 0
  ) {
    throw new SimulationResultDiffV1Error(`${where} must carry at least one change (unchanged entries are never listed)`);
  }
  return value as unknown as SimulationResultEntryChange;
}

/**
 * Strictly validate a value as a {@link SimulationResultDiffV1} and return it narrowed. Enforces
 * the four literal safety locks, the transition consistency against the embedded sides, the
 * recomputed deltas, the exact recomputed `diffReasonCodes` emission order, and the recomputed
 * `hasChange` / `hasNewBlocking` verdicts. Throws {@link SimulationResultDiffV1Error} (or a
 * SimulationSafetyError for a flipped lock) on the first problem. Pure.
 */
export function validateSimulationResultDiffV1(value: unknown): SimulationResultDiffV1 {
  if (!isObject(value)) throw new SimulationResultDiffV1Error("simulation result diff must be a JSON object");
  if (value.schemaVersion !== SIMULATION_RESULT_DIFF_V1_SCHEMA_VERSION) {
    throw new SimulationResultDiffV1Error(`simulation result diff.schemaVersion must be "${SIMULATION_RESULT_DIFF_V1_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SIMULATION_RESULT_DIFF_V1_BANNER) {
    throw new SimulationResultDiffV1Error(`simulation result diff.banner must be "${SIMULATION_RESULT_DIFF_V1_BANNER}"`);
  }
  if (value.generatedBy !== SIMULATION_RESULT_DIFF_V1_GENERATED_BY) {
    throw new SimulationResultDiffV1Error(`simulation result diff.generatedBy must be "${SIMULATION_RESULT_DIFF_V1_GENERATED_BY}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new SimulationResultDiffV1Error(`simulation result diff.${flag} must be true`);
  }
  assertSimulationSafetyLiterals(value, "simulation result diff");
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SimulationResultDiffV1Error("simulation result diff.disclaimers must be a non-empty array");
  }
  const base = validateSideShape(value.base, "simulation result diff.base");
  const next = validateSideShape(value.next, "simulation result diff.next");

  for (const f of [
    "resultStatusChanged",
    "newlyBlocked",
    "noLongerBlocked",
    "adapterChanged",
    "dryRunAttemptedChanged",
    "hasChange",
    "hasNewBlocking",
  ] as const) {
    if (typeof value[f] !== "boolean") throw new SimulationResultDiffV1Error(`simulation result diff.${f} must be a boolean`);
  }
  if (value.resultStatusChanged !== (base.resultStatus !== next.resultStatus)) {
    throw new SimulationResultDiffV1Error("simulation result diff.resultStatusChanged must mirror the sides' statuses");
  }
  if (value.newlyBlocked !== (base.resultStatus !== "blocked" && next.resultStatus === "blocked")) {
    throw new SimulationResultDiffV1Error("simulation result diff.newlyBlocked must mirror the sides' statuses");
  }
  if (value.noLongerBlocked !== (base.resultStatus === "blocked" && next.resultStatus !== "blocked")) {
    throw new SimulationResultDiffV1Error("simulation result diff.noLongerBlocked must mirror the sides' statuses");
  }
  if (value.adapterChanged !== (base.adapterId !== next.adapterId)) {
    throw new SimulationResultDiffV1Error("simulation result diff.adapterChanged must mirror the sides' adapter ids");
  }
  if (value.dryRunAttemptedChanged !== (base.dryRunAttempted !== next.dryRunAttempted)) {
    throw new SimulationResultDiffV1Error("simulation result diff.dryRunAttemptedChanged must mirror the sides");
  }

  const planRefChangedFields = validateStringArray(value.planRefChangedFields, "simulation result diff.planRefChangedFields");
  const expectedPlanRefChanged = SIMULATION_RESULT_PLAN_REF_FIELDS.filter((f) => base.planRef[f] !== next.planRef[f]);
  if (planRefChangedFields.join("|") !== expectedPlanRefChanged.join("|")) {
    throw new SimulationResultDiffV1Error(
      `simulation result diff.planRefChangedFields must be exactly the recomputed set (${expectedPlanRefChanged.join(", ") || "none"})`,
    );
  }
  if (planRefChangedFields.some((f) => !PLAN_REF_FIELD_SET.has(f))) {
    throw new SimulationResultDiffV1Error("simulation result diff.planRefChangedFields must list only comparable plan-ref fields");
  }

  const blockedCodesAdded = validateCodeArray(value.blockedCodesAdded, "simulation result diff.blockedCodesAdded");
  const blockedCodesRemoved = validateCodeArray(value.blockedCodesRemoved, "simulation result diff.blockedCodesRemoved");
  const warningCodesAdded = validateCodeArray(value.warningCodesAdded, "simulation result diff.warningCodesAdded");
  const warningCodesRemoved = validateCodeArray(value.warningCodesRemoved, "simulation result diff.warningCodesRemoved");

  const entriesAdded = validateStringArray(value.entriesAdded, "simulation result diff.entriesAdded");
  const entriesRemoved = validateStringArray(value.entriesRemoved, "simulation result diff.entriesRemoved");
  for (const id of entriesAdded) {
    if (entriesRemoved.includes(id)) {
      throw new SimulationResultDiffV1Error(`simulation result diff: "${id}" cannot be both added and removed`);
    }
  }
  if (typeof value.commonEntryCount !== "number" || !Number.isInteger(value.commonEntryCount) || value.commonEntryCount < 0) {
    throw new SimulationResultDiffV1Error("simulation result diff.commonEntryCount must be a non-negative integer");
  }
  if (!Array.isArray(value.entryChanges)) throw new SimulationResultDiffV1Error("simulation result diff.entryChanges must be an array");
  const entryChanges = (value.entryChanges as unknown[]).map((c, i) =>
    validateEntryChange(c, `simulation result diff.entryChanges[${i}]`),
  );
  if (entryChanges.length > (value.commonEntryCount as number)) {
    throw new SimulationResultDiffV1Error("simulation result diff.entryChanges cannot exceed the common entry count");
  }

  if (!isObject(value.deltas)) throw new SimulationResultDiffV1Error("simulation result diff.deltas must be an object");
  const expectedDeltas: SimulationResultDiffDeltas = {
    entryCount: next.entryCount - base.entryCount,
    skippedCount: next.skippedCount - base.skippedCount,
    unavailableCount: next.unavailableCount - base.unavailableCount,
    failedCount: next.failedCount - base.failedCount,
    completedCount: next.completedCount - base.completedCount,
  };
  for (const f of ["entryCount", "skippedCount", "unavailableCount", "failedCount", "completedCount"] as const) {
    if ((value.deltas as Record<string, unknown>)[f] !== expectedDeltas[f]) {
      throw new SimulationResultDiffV1Error(`simulation result diff.deltas.${f} must equal the recomputed value (${expectedDeltas[f]})`);
    }
  }

  const entriesChanged = entriesAdded.length > 0 || entriesRemoved.length > 0 || entryChanges.length > 0;
  const expectedHasChange =
    (value.resultStatusChanged as boolean) ||
    (value.adapterChanged as boolean) ||
    (value.dryRunAttemptedChanged as boolean) ||
    planRefChangedFields.length > 0 ||
    blockedCodesAdded.length > 0 ||
    blockedCodesRemoved.length > 0 ||
    warningCodesAdded.length > 0 ||
    warningCodesRemoved.length > 0 ||
    entriesChanged;
  if (value.hasChange !== expectedHasChange) {
    throw new SimulationResultDiffV1Error("simulation result diff.hasChange must mirror the recomputed verdict");
  }
  if (value.hasNewBlocking !== ((value.newlyBlocked as boolean) || blockedCodesAdded.length > 0)) {
    throw new SimulationResultDiffV1Error("simulation result diff.hasNewBlocking must mirror the recomputed verdict");
  }

  const expectedCodes: SimulationReasonCode[] = [
    ...((value.newlyBlocked as boolean) ? (["simulation-diff-result-newly-blocked"] as const) : []),
    ...((value.noLongerBlocked as boolean) ? (["simulation-diff-result-no-longer-blocked"] as const) : []),
    ...((value.resultStatusChanged as boolean) ? (["simulation-diff-result-status-changed"] as const) : []),
    ...(blockedCodesAdded.length > 0 || blockedCodesRemoved.length > 0
      ? (["simulation-diff-result-blocking-codes-changed"] as const)
      : []),
    ...((value.adapterChanged as boolean) ? (["simulation-diff-result-adapter-changed"] as const) : []),
    ...(planRefChangedFields.length > 0 ? (["simulation-diff-result-plan-ref-changed"] as const) : []),
    ...(entriesChanged ? (["simulation-diff-result-entries-changed"] as const) : []),
    ...(!expectedHasChange ? (["simulation-diff-result-identical"] as const) : []),
  ];
  const actualCodes = validateCodeArray(value.diffReasonCodes, "simulation result diff.diffReasonCodes");
  if (actualCodes.join("|") !== expectedCodes.join("|")) {
    throw new SimulationResultDiffV1Error(
      `simulation result diff.diffReasonCodes must be exactly the recomputed findings (${expectedCodes.join(", ") || "none"})`,
    );
  }
  if (!Array.isArray(value.notes) || (value.notes as unknown[]).some((x) => typeof x !== "string")) {
    throw new SimulationResultDiffV1Error("simulation result diff.notes must be an array of strings");
  }
  return value as unknown as SimulationResultDiffV1;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSimulationResultDiffV1}. */
export interface FormatSimulationResultDiffV1Options {
  label?: string;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

/**
 * Render a redacted, stable, human-readable simulation result diff. Deterministic and
 * path-stable. Leads with the comparison-only framing and the change verdict, shows both sides,
 * every finding with its operator message, the per-entry changes, and the aggregate deltas — and
 * never phrases anything as an execution, a trade, or live readiness. Passed through the shared
 * redactor.
 */
export function formatSimulationResultDiffV1(
  diff: SimulationResultDiffV1,
  opts: FormatSimulationResultDiffV1Options = {},
): string {
  const header =
    "SIMULATION RESULT DIFF — DRY-RUN RECORD COMPARISON ONLY (simulation only; not an execution; does not sign; does not send; does not authorize live trading)";
  const lines: string[] = [header, "=".repeat(header.length)];
  lines.push(SIMULATION_OPERATOR_SAFETY_LINE);
  lines.push(`artifact: ${diff.schemaVersion}`);
  if (opts.label) lines.push(`label: ${opts.label}`);
  const side = (s: SimulationResultDiffSide): string =>
    `${s.planRef.planLabel ?? "(unlabeled plan)"} — ${s.resultStatus.toUpperCase()}; adapter ${s.adapterId}; ${s.entryCount} entr${s.entryCount === 1 ? "y" : "ies"} (${s.skippedCount} skipped / ${s.unavailableCount} unavailable / ${s.failedCount} failed safely / ${s.completedCount} completed safely)`;
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
  lines.push("Result-level code movements:");
  codeLine("blocking added", diff.blockedCodesAdded);
  codeLine("blocking removed", diff.blockedCodesRemoved);
  codeLine("warning added", diff.warningCodesAdded);
  codeLine("warning removed", diff.warningCodesRemoved);
  if (
    diff.blockedCodesAdded.length + diff.blockedCodesRemoved.length + diff.warningCodesAdded.length + diff.warningCodesRemoved.length === 0
  ) {
    lines.push("- (none)");
  }
  if (diff.planRefChangedFields.length > 0) lines.push(`Source plan ref changed: ${diff.planRefChangedFields.join(", ")}`);
  if (diff.adapterChanged) lines.push(`Adapter changed: ${diff.base.adapterId} → ${diff.next.adapterId}`);
  if (diff.dryRunAttemptedChanged) {
    lines.push(`Dry-run attempted changed: ${diff.base.dryRunAttempted ? "yes" : "no"} → ${diff.next.dryRunAttempted ? "yes" : "no"} (an attempt is still a SIMULATION outcome only)`);
  }

  lines.push("");
  lines.push(`Entries: +${diff.entriesAdded.length} added / -${diff.entriesRemoved.length} removed / ${diff.commonEntryCount} in both (${diff.entryChanges.length} changed)`);
  if (diff.entriesAdded.length > 0) lines.push(`  added:   ${diff.entriesAdded.join(", ")}`);
  if (diff.entriesRemoved.length > 0) lines.push(`  removed: ${diff.entriesRemoved.join(", ")}`);
  for (const c of diff.entryChanges) {
    lines.push(`- ${c.candidateId}${c.statusChanged ? `  [${c.fromStatus} → ${c.toStatus}]` : ""}`);
    if (c.reasonCodesAdded.length > 0) lines.push(`    codes added:   ${c.reasonCodesAdded.join(", ")}`);
    if (c.reasonCodesRemoved.length > 0) lines.push(`    codes removed: ${c.reasonCodesRemoved.join(", ")}`);
    if (c.unresolvedFieldsAdded.length > 0) lines.push(`    unresolved fields added:   ${c.unresolvedFieldsAdded.join(", ")}`);
    if (c.unresolvedFieldsRemoved.length > 0) lines.push(`    unresolved fields removed: ${c.unresolvedFieldsRemoved.join(", ")}`);
  }

  lines.push("");
  lines.push("Aggregate deltas (next − base):");
  lines.push(
    `  entries: ${signed(diff.deltas.entryCount)}  skipped: ${signed(diff.deltas.skippedCount)}  unavailable: ${signed(diff.deltas.unavailableCount)}  failed safely: ${signed(diff.deltas.failedCount)}  completed safely: ${signed(diff.deltas.completedCount)}`,
  );
  lines.push(`Any change:       ${diff.hasChange ? "YES" : "no"}`);
  lines.push(`Any new blocking: ${diff.hasNewBlocking ? "YES" : "no"}`);

  lines.push("");
  lines.push(`Next safe action: ${diff.hasChange
    ? "review every finding above against its two source results; a changed dry-run record is still SIMULATION ONLY and never a live action."
    : "no structured change to review; both results remain SIMULATION ONLY artifacts."}`);

  lines.push("");
  lines.push("Notes:");
  for (const note of diff.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of diff.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
