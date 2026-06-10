/**
 * Deterministic, offline, **PAPER-only** SNIPER RUN REPORT DIFF **V2** (Sprint 74 — closes the
 * known gap where only v1 run reports could be diffed).
 *
 * Two `sniper.run.report.v2` artifacts describe a watchlist run at two points. The v1 diff
 * (`sniper.run.report.diff.v1`) compares the v1 surface; this module REUSES that core VERBATIM
 * (both v2 reports are projected onto their exact v1 views and run through the unchanged v1
 * differ) and then compares the v2-only layers from STRUCTURED FIELDS ONLY — never by parsing
 * prose:
 *
 *   - the decision artifact's schemaVersion and the upgraded-from-v1 marker
 *   - policy visibility (the six structured policy-summary facts, risk limits compared verbatim)
 *     and the STRUCTURED policy/decision schemaVersion mismatch condition
 *   - preflight-input coverage (presence + the seven coverage counts/statuses)
 *   - the policy-required-but-missing preflight input condition
 *   - unresolved unknowns (id-level appeared/resolved movements)
 *   - operator-blocking reasons (VERBATIM string set movements — carried, never parsed)
 *   - reason-code rollups (per-code and blocking-code count deltas; presence transitions)
 *   - per-candidate reason-code trails (codes added/removed over the common set)
 *
 * Both inputs are STRICTLY validated as v2 run reports first — a v1 artifact or any other
 * wrong-schema/corrupt input REFUSES with a classified error (upgrade a v1 report through
 * `upgradeSniperRunReportV1ToV2` first if that comparison is really wanted). V1 diff behavior is
 * untouched.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work. Nothing here is a trade
 * signal: every transition is between two SIMULATED, paper-only classifications. Carries no
 * wall-clock time — the same pair yields a byte-identical diff.
 */

import { redactString } from "@soulmaker/security";
import {
  diffSniperRunReports,
  validateSniperRunReportDiff,
  formatSniperRunReportDiff,
  SNIPER_RUN_REPORT_DIFF_SCHEMA_VERSION,
  SNIPER_RUN_REPORT_DIFF_BANNER,
  type SniperRunReportDiff,
  type SniperRunReportDiffSide,
} from "./run-report-diff.js";
import {
  validateSniperRunReportV2,
  type SniperRunReportV2,
  type SniperRunPolicySummary,
  type SniperRunPreflightInputCoverage,
} from "./run-report-v2.js";
import { SNIPER_RUN_REPORT_SCHEMA_VERSION, SNIPER_RUN_REPORT_BANNER } from "./run-report.js";
import { isSniperDecisionReasonCode, type SniperDecisionReasonCode } from "./decision-reason-codes.js";

/** Stable schema identifier for the v2 run report diff. Bump only on a breaking change. */
export const SNIPER_RUN_REPORT_DIFF_V2_SCHEMA_VERSION = "sniper.run.report.diff.v2";

/** The banner that prefixes every v2 run report diff (required label). */
export const SNIPER_RUN_REPORT_DIFF_V2_BANNER = "SIMULATED PAPER-ONLY SNIPER RUN REPORT DIFF V2";

/** Required disclaimer statements carried by every v2 run report diff (stable order). */
export const SNIPER_RUN_REPORT_DIFF_V2_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SNIPER RUN REPORT DIFF V2 — the v1 diff core (computed VERBATIM by the unchanged v1 differ) plus structured comparisons of the v2 layers: policy visibility, preflight-input coverage, unresolved unknowns, operator-blocking reasons, and reason-code rollups.",
  "It compares ALREADY-BUILT local artifacts and re-derives nothing: every transition is computed from the two reports' VERBATIM structured fields (operator-blocking reasons are compared as verbatim strings, never parsed).",
  "A `paper-enter` transition is a change between two SIMULATED, paper-only classifications — NOT a buy/sell order, NOT a transaction, and NOT live-trading readiness.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this diff.",
];

/** Thrown when v2 run-report-diff INPUT or a produced diff is structurally invalid. */
export class SniperRunReportDiffV2Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperRunReportDiffV2Error";
  }
}

// --- model -------------------------------------------------------------------

/** One side's metadata: the v1 side plus the v2 structured layers the diff is verified against. */
export interface SniperRunReportDiffV2Side extends SniperRunReportDiffSide {
  decisionSchemaVersion: string | null;
  upgradedFromV1: boolean;
  /** The policy-summary block, VERBATIM. */
  policySummary: SniperRunPolicySummary;
  /** The preflight-input coverage block, VERBATIM (null when none was supplied to that run). */
  preflightInputCoverage: SniperRunPreflightInputCoverage | null;
  missingRequiredPreflightInput: boolean;
  /** Unresolved-unknown candidate ids, VERBATIM. */
  unresolvedUnknownIds: string[];
  /** Operator-blocking reasons, VERBATIM strings (compared as opaque values, never parsed). */
  operatorBlockingReasons: string[];
  /** Per-code rollup counts, VERBATIM (null when the report carries no rollup). */
  reasonCodeCounts: Record<string, number> | null;
  /** Blocking-code rollup counts, VERBATIM (null when the report carries no rollup). */
  blockingReasonCodeCounts: Record<string, number> | null;
}

/** The structured policy-summary facts the diff compares, in stable order. */
export const SNIPER_RUN_POLICY_SUMMARY_FIELDS = [
  "appliedPerDecision",
  "policyLabel",
  "policySchemaVersion",
  "suppliedPolicySchemaVersion",
  "policyMode",
  "riskLimits",
] as const;

/** The preflight-input coverage fields the diff compares (when both sides carry coverage). */
export const SNIPER_RUN_PREFLIGHT_COVERAGE_FIELDS = [
  "entryCount",
  "missingInspectionCount",
  "missingRiskCount",
  "unsupportedShapeCount",
  "mintMismatchCount",
  "uncoveredCandidateCount",
  "validationStatus",
] as const;

/** One common candidate whose reason-code trail differs (only changed candidates are listed). */
export interface SniperRunCandidateCodeChange {
  candidateId: string;
  codesAdded: SniperDecisionReasonCode[];
  codesRemoved: SniperDecisionReasonCode[];
}

/** The full, deterministic, JSON-serializable v2 run report diff. */
export interface SniperRunReportDiffV2 extends Omit<SniperRunReportDiff, "schemaVersion" | "banner" | "base" | "next"> {
  schemaVersion: string;
  banner: string;
  base: SniperRunReportDiffV2Side;
  next: SniperRunReportDiffV2Side;
  // --- v2 layers (every comparison structured-field-only) ---
  decisionSchemaVersionChanged: boolean;
  upgradedFromV1Changed: boolean;
  /** The differing policy-summary facts, stable order (riskLimits compared verbatim as a block). */
  policySummaryChangedFields: string[];
  /** The STRUCTURED policy/decision schemaVersion mismatch condition appeared in next. */
  newlyPolicyMismatch: boolean;
  /** The structured mismatch condition was present in base and is gone in next. */
  noLongerPolicyMismatch: boolean;
  /** Coverage flipped between absent and present. */
  preflightCoveragePresenceChanged: boolean;
  /** The differing coverage fields, stable order (only when BOTH sides carry coverage). */
  preflightCoverageChangedFields: string[];
  newlyMissingRequiredPreflightInput: boolean;
  noLongerMissingRequiredPreflightInput: boolean;
  /** Ids unresolved in next but not in base (next order). */
  newlyUnresolvedUnknownIds: string[];
  /** Ids unresolved in base but not in next (base order). */
  noLongerUnresolvedUnknownIds: string[];
  /** Operator-blocking reasons present in next but not base, VERBATIM (next order). */
  operatorBlockingReasonsAdded: string[];
  /** Operator-blocking reasons present in base but not next, VERBATIM (base order). */
  operatorBlockingReasonsRemoved: string[];
  /** Non-zero per-code count deltas (next − base; absent rollup counts as zero), sorted keys. */
  reasonCodeCountDeltas: Record<string, number>;
  /** Non-zero blocking-code count deltas (next − base), sorted keys. */
  blockingCodeCountDeltas: Record<string, number>;
  /** The rollup flipped between absent (v1/absent decision) and present (v2 decision). */
  rollupPresenceChanged: boolean;
  /** Per-candidate reason-code trail movements over the common set (changed candidates only). */
  candidateCodeChanges: SniperRunCandidateCodeChange[];
  /** True iff any v2-layer comparison found a difference. */
  hasV2LayerChange: boolean;
  /** True iff the v1 core found a change OR any v2 layer did. */
  hasAnyChange: boolean;
  /** True iff an operator-blocking reason was added or a required preflight input went missing. */
  hasNewOperatorBlocking: boolean;
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
  return next.filter((x) => !baseSet.has(x));
}

/** The STRUCTURED policy/decision mismatch condition (never derived from warning prose). */
function policyMismatch(s: SniperRunPolicySummary): boolean {
  return (
    s.appliedPerDecision === true &&
    s.suppliedPolicySchemaVersion !== null &&
    s.policySchemaVersion !== s.suppliedPolicySchemaVersion
  );
}

function policyFieldValue(s: SniperRunPolicySummary, field: string): string {
  // Stable scalar projection for comparison; riskLimits compares verbatim as a JSON block.
  if (field === "riskLimits") return JSON.stringify(s.riskLimits);
  return JSON.stringify(s[field as keyof SniperRunPolicySummary] ?? null);
}

function sideOf(report: SniperRunReportV2): SniperRunReportDiffV2Side {
  return {
    operatorLabel: report.operatorLabel,
    sourceLabel: report.sourceLabel,
    candidateCount: report.candidateCount,
    decisionSchemaVersion: report.decisionSchemaVersion,
    upgradedFromV1: report.upgradedFromV1,
    policySummary: {
      ...report.policySummary,
      riskLimits: report.policySummary.riskLimits
        ? {
            ...report.policySummary.riskLimits,
            disallowedReasonCodes: [...report.policySummary.riskLimits.disallowedReasonCodes],
            disallowedPreflightStatuses: [...report.policySummary.riskLimits.disallowedPreflightStatuses],
          }
        : null,
    },
    preflightInputCoverage: report.preflightInputCoverage ? { ...report.preflightInputCoverage } : null,
    missingRequiredPreflightInput: report.missingRequiredPreflightInput,
    unresolvedUnknownIds: [...report.unresolvedUnknownIds],
    operatorBlockingReasons: [...report.operatorBlockingReasons],
    reasonCodeCounts: report.reasonCodeRollup ? { ...report.reasonCodeRollup.reasonCodeCounts } : null,
    blockingReasonCodeCounts: report.reasonCodeRollup ? { ...report.reasonCodeRollup.blockingReasonCodeCounts } : null,
  };
}

/** Non-zero count deltas (next − base) over the union of keys; absent maps count as empty. */
function countDeltas(base: Record<string, number> | null, next: Record<string, number> | null): Record<string, number> {
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(next ?? {})]);
  const out: Record<string, number> = {};
  for (const key of [...keys].sort()) {
    const delta = (next?.[key] ?? 0) - (base?.[key] ?? 0);
    if (delta !== 0) out[key] = delta;
  }
  return out;
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link SniperRunReportDiffV2} from two v2 run reports. Pure and
 * non-mutating. Both inputs are STRICTLY validated as `sniper.run.report.v2` — a v1 report or any
 * other wrong-schema/corrupt input REFUSES with a classified error naming the side (v1 diff
 * behavior is untouched; lift a v1 report with `upgradeSniperRunReportV1ToV2` first if that
 * comparison is wanted). The v1 core diff is computed VERBATIM by the unchanged v1 differ over
 * each report's exact v1 view; the v2 layers are then compared structured-field-only. The produced
 * diff is self-validated before returning. Throws {@link SniperRunReportDiffV2Error} on bad input.
 */
export function diffSniperRunReportsV2(baseInput: unknown, nextInput: unknown): SniperRunReportDiffV2 {
  let base: SniperRunReportV2;
  let next: SniperRunReportV2;
  try {
    base = validateSniperRunReportV2(baseInput);
  } catch (err) {
    throw new SniperRunReportDiffV2Error(`base run report v2 is invalid: ${(err as Error).message}`);
  }
  try {
    next = validateSniperRunReportV2(nextInput);
  } catch (err) {
    throw new SniperRunReportDiffV2Error(`next run report v2 is invalid: ${(err as Error).message}`);
  }

  // 1) The unchanged v1 core, over each report's exact v1 view (same projection the v2
  //    validator itself uses — v1 semantics cannot drift).
  const v1ViewOf = (r: SniperRunReportV2): unknown => ({
    ...r,
    schemaVersion: SNIPER_RUN_REPORT_SCHEMA_VERSION,
    banner: SNIPER_RUN_REPORT_BANNER,
  });
  let core: SniperRunReportDiff;
  try {
    core = diffSniperRunReports(v1ViewOf(base), v1ViewOf(next));
  } catch (err) {
    throw new SniperRunReportDiffV2Error((err as Error).message);
  }

  // 2) The v2 layers — structured fields only.
  const baseSide = sideOf(base);
  const nextSide = sideOf(next);

  const decisionSchemaVersionChanged = base.decisionSchemaVersion !== next.decisionSchemaVersion;
  const upgradedFromV1Changed = base.upgradedFromV1 !== next.upgradedFromV1;
  const policySummaryChangedFields = SNIPER_RUN_POLICY_SUMMARY_FIELDS.filter(
    (f) => policyFieldValue(base.policySummary, f) !== policyFieldValue(next.policySummary, f),
  );
  const baseMismatch = policyMismatch(base.policySummary);
  const nextMismatch = policyMismatch(next.policySummary);
  const newlyPolicyMismatch = !baseMismatch && nextMismatch;
  const noLongerPolicyMismatch = baseMismatch && !nextMismatch;

  const basePresent = base.preflightInputCoverage !== null;
  const nextPresent = next.preflightInputCoverage !== null;
  const preflightCoveragePresenceChanged = basePresent !== nextPresent;
  const preflightCoverageChangedFields =
    basePresent && nextPresent
      ? SNIPER_RUN_PREFLIGHT_COVERAGE_FIELDS.filter(
          (f) => base.preflightInputCoverage![f] !== next.preflightInputCoverage![f],
        )
      : [];
  const newlyMissingRequiredPreflightInput = !base.missingRequiredPreflightInput && next.missingRequiredPreflightInput;
  const noLongerMissingRequiredPreflightInput = base.missingRequiredPreflightInput && !next.missingRequiredPreflightInput;

  const newlyUnresolvedUnknownIds = addedOf(base.unresolvedUnknownIds, next.unresolvedUnknownIds);
  const noLongerUnresolvedUnknownIds = addedOf(next.unresolvedUnknownIds, base.unresolvedUnknownIds);
  const operatorBlockingReasonsAdded = addedOf(base.operatorBlockingReasons, next.operatorBlockingReasons);
  const operatorBlockingReasonsRemoved = addedOf(next.operatorBlockingReasons, base.operatorBlockingReasons);

  const reasonCodeCountDeltas = countDeltas(baseSide.reasonCodeCounts, nextSide.reasonCodeCounts);
  const blockingCodeCountDeltas = countDeltas(baseSide.blockingReasonCodeCounts, nextSide.blockingReasonCodeCounts);
  const rollupPresenceChanged = (base.reasonCodeRollup === null) !== (next.reasonCodeRollup === null);

  const baseCodesById = new Map(base.candidates.map((c) => [c.candidateId, c.reasonCodes]));
  const candidateCodeChanges: SniperRunCandidateCodeChange[] = [];
  for (const nc of next.candidates) {
    const bcodes = baseCodesById.get(nc.candidateId);
    if (bcodes === undefined) continue;
    const codesAdded = addedOf(bcodes, nc.reasonCodes);
    const codesRemoved = addedOf(nc.reasonCodes, bcodes);
    if (codesAdded.length > 0 || codesRemoved.length > 0) {
      candidateCodeChanges.push({ candidateId: nc.candidateId, codesAdded, codesRemoved });
    }
  }

  const hasV2LayerChange =
    decisionSchemaVersionChanged ||
    upgradedFromV1Changed ||
    policySummaryChangedFields.length > 0 ||
    newlyPolicyMismatch ||
    noLongerPolicyMismatch ||
    preflightCoveragePresenceChanged ||
    preflightCoverageChangedFields.length > 0 ||
    newlyMissingRequiredPreflightInput ||
    noLongerMissingRequiredPreflightInput ||
    newlyUnresolvedUnknownIds.length > 0 ||
    noLongerUnresolvedUnknownIds.length > 0 ||
    operatorBlockingReasonsAdded.length > 0 ||
    operatorBlockingReasonsRemoved.length > 0 ||
    Object.keys(reasonCodeCountDeltas).length > 0 ||
    Object.keys(blockingCodeCountDeltas).length > 0 ||
    rollupPresenceChanged ||
    candidateCodeChanges.length > 0;
  const hasAnyChange = core.hasChange || hasV2LayerChange;
  const hasNewOperatorBlocking = operatorBlockingReasonsAdded.length > 0 || newlyMissingRequiredPreflightInput;

  const diff: SniperRunReportDiffV2 = {
    ...core,
    schemaVersion: SNIPER_RUN_REPORT_DIFF_V2_SCHEMA_VERSION,
    banner: SNIPER_RUN_REPORT_DIFF_V2_BANNER,
    disclaimers: [...SNIPER_RUN_REPORT_DIFF_V2_DISCLAIMERS],
    base: baseSide,
    next: nextSide,
    decisionSchemaVersionChanged,
    upgradedFromV1Changed,
    policySummaryChangedFields,
    newlyPolicyMismatch,
    noLongerPolicyMismatch,
    preflightCoveragePresenceChanged,
    preflightCoverageChangedFields,
    newlyMissingRequiredPreflightInput,
    noLongerMissingRequiredPreflightInput,
    newlyUnresolvedUnknownIds,
    noLongerUnresolvedUnknownIds,
    operatorBlockingReasonsAdded,
    operatorBlockingReasonsRemoved,
    reasonCodeCountDeltas,
    blockingCodeCountDeltas,
    rollupPresenceChanged,
    candidateCodeChanges,
    hasV2LayerChange,
    hasAnyChange,
    hasNewOperatorBlocking,
    notes: [
      ...core.notes,
      `V2 layers: ${hasV2LayerChange ? "CHANGED" : "no change"} (policy ${policySummaryChangedFields.length} field(s), coverage ${preflightCoverageChangedFields.length} field(s), ${operatorBlockingReasonsAdded.length} blocking reason(s) added, ${candidateCodeChanges.length} candidate code trail(s) moved).`,
    ],
  };
  // Self-check: the builder's own output must pass the strict validator (defense in depth).
  return validateSniperRunReportDiffV2(diff);
}

// --- validation (backstop) ---------------------------------------------------

function validateStringArray(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some((x) => typeof x !== "string")) {
    throw new SniperRunReportDiffV2Error(`${where} must be an array of strings`);
  }
  return value as string[];
}

function validateCountMap(value: unknown, where: string, allowNull: boolean): Record<string, number> | null {
  if (value === null) {
    if (!allowNull) throw new SniperRunReportDiffV2Error(`${where} must be an object`);
    return null;
  }
  if (!isObject(value)) throw new SniperRunReportDiffV2Error(`${where} must be an object${allowNull ? " or null" : ""}`);
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "number" || !Number.isInteger(v)) {
      throw new SniperRunReportDiffV2Error(`${where}.${k} must be an integer`);
    }
  }
  return value as Record<string, number>;
}

function validateV2Side(value: unknown, where: string): SniperRunReportDiffV2Side {
  if (!isObject(value)) throw new SniperRunReportDiffV2Error(`${where} must be an object`);
  if (value.decisionSchemaVersion !== null && typeof value.decisionSchemaVersion !== "string") {
    throw new SniperRunReportDiffV2Error(`${where}.decisionSchemaVersion must be a string or null`);
  }
  if (typeof value.upgradedFromV1 !== "boolean") throw new SniperRunReportDiffV2Error(`${where}.upgradedFromV1 must be a boolean`);
  if (!isObject(value.policySummary)) throw new SniperRunReportDiffV2Error(`${where}.policySummary must be an object`);
  if (value.preflightInputCoverage !== null && !isObject(value.preflightInputCoverage)) {
    throw new SniperRunReportDiffV2Error(`${where}.preflightInputCoverage must be an object or null`);
  }
  if (typeof value.missingRequiredPreflightInput !== "boolean") {
    throw new SniperRunReportDiffV2Error(`${where}.missingRequiredPreflightInput must be a boolean`);
  }
  validateStringArray(value.unresolvedUnknownIds, `${where}.unresolvedUnknownIds`);
  validateStringArray(value.operatorBlockingReasons, `${where}.operatorBlockingReasons`);
  validateCountMap(value.reasonCodeCounts, `${where}.reasonCodeCounts`, true);
  validateCountMap(value.blockingReasonCodeCounts, `${where}.blockingReasonCodeCounts`, true);
  if ((value.reasonCodeCounts === null) !== (value.blockingReasonCodeCounts === null)) {
    throw new SniperRunReportDiffV2Error(`${where} rollup count maps must be both present or both null`);
  }
  return value as unknown as SniperRunReportDiffV2Side;
}

/**
 * Strictly validate a value as a {@link SniperRunReportDiffV2} and return it narrowed. The v1
 * surface is validated by the REAL v1 diff validator (on an exact v1 view); the v2 layers are
 * recomputed from the embedded verbatim sides and compared — a tampered transition flag, changed-
 * field list, count delta, or verdict refuses. Throws {@link SniperRunReportDiffV2Error} on the
 * first problem. Pure.
 */
export function validateSniperRunReportDiffV2(value: unknown): SniperRunReportDiffV2 {
  if (!isObject(value)) throw new SniperRunReportDiffV2Error("run report diff v2 must be a JSON object");
  if (value.schemaVersion !== SNIPER_RUN_REPORT_DIFF_V2_SCHEMA_VERSION) {
    throw new SniperRunReportDiffV2Error(`run report diff v2.schemaVersion must be "${SNIPER_RUN_REPORT_DIFF_V2_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_RUN_REPORT_DIFF_V2_BANNER) {
    throw new SniperRunReportDiffV2Error(`run report diff v2.banner must be "${SNIPER_RUN_REPORT_DIFF_V2_BANNER}"`);
  }
  try {
    validateSniperRunReportDiff({
      ...value,
      schemaVersion: SNIPER_RUN_REPORT_DIFF_SCHEMA_VERSION,
      banner: SNIPER_RUN_REPORT_DIFF_BANNER,
    });
  } catch (err) {
    throw new SniperRunReportDiffV2Error((err as Error).message);
  }

  const base = validateV2Side(value.base, "run report diff v2.base");
  const next = validateV2Side(value.next, "run report diff v2.next");

  for (const f of [
    "decisionSchemaVersionChanged",
    "upgradedFromV1Changed",
    "newlyPolicyMismatch",
    "noLongerPolicyMismatch",
    "preflightCoveragePresenceChanged",
    "newlyMissingRequiredPreflightInput",
    "noLongerMissingRequiredPreflightInput",
    "rollupPresenceChanged",
    "hasV2LayerChange",
    "hasAnyChange",
    "hasNewOperatorBlocking",
  ] as const) {
    if (typeof value[f] !== "boolean") throw new SniperRunReportDiffV2Error(`run report diff v2.${f} must be a boolean`);
  }

  // Recompute every v2 transition from the embedded verbatim sides.
  const checks: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ["decisionSchemaVersionChanged", value.decisionSchemaVersionChanged, base.decisionSchemaVersion !== next.decisionSchemaVersion],
    ["upgradedFromV1Changed", value.upgradedFromV1Changed, base.upgradedFromV1 !== next.upgradedFromV1],
    ["newlyPolicyMismatch", value.newlyPolicyMismatch, !policyMismatch(base.policySummary) && policyMismatch(next.policySummary)],
    ["noLongerPolicyMismatch", value.noLongerPolicyMismatch, policyMismatch(base.policySummary) && !policyMismatch(next.policySummary)],
    [
      "preflightCoveragePresenceChanged",
      value.preflightCoveragePresenceChanged,
      (base.preflightInputCoverage === null) !== (next.preflightInputCoverage === null),
    ],
    [
      "newlyMissingRequiredPreflightInput",
      value.newlyMissingRequiredPreflightInput,
      !base.missingRequiredPreflightInput && next.missingRequiredPreflightInput,
    ],
    [
      "noLongerMissingRequiredPreflightInput",
      value.noLongerMissingRequiredPreflightInput,
      base.missingRequiredPreflightInput && !next.missingRequiredPreflightInput,
    ],
    ["rollupPresenceChanged", value.rollupPresenceChanged, (base.reasonCodeCounts === null) !== (next.reasonCodeCounts === null)],
  ];
  for (const [name, actual, expected] of checks) {
    if (actual !== expected) {
      throw new SniperRunReportDiffV2Error(`run report diff v2.${name} must mirror the embedded sides`);
    }
  }

  const expectedPolicyFields = SNIPER_RUN_POLICY_SUMMARY_FIELDS.filter(
    (f) => policyFieldValue(base.policySummary, f) !== policyFieldValue(next.policySummary, f),
  );
  if (validateStringArray(value.policySummaryChangedFields, "run report diff v2.policySummaryChangedFields").join("|") !== expectedPolicyFields.join("|")) {
    throw new SniperRunReportDiffV2Error(
      `run report diff v2.policySummaryChangedFields must be exactly the recomputed set (${expectedPolicyFields.join(", ") || "none"})`,
    );
  }
  const expectedCoverageFields =
    base.preflightInputCoverage !== null && next.preflightInputCoverage !== null
      ? SNIPER_RUN_PREFLIGHT_COVERAGE_FIELDS.filter(
          (f) => base.preflightInputCoverage![f] !== next.preflightInputCoverage![f],
        )
      : [];
  if (validateStringArray(value.preflightCoverageChangedFields, "run report diff v2.preflightCoverageChangedFields").join("|") !== expectedCoverageFields.join("|")) {
    throw new SniperRunReportDiffV2Error("run report diff v2.preflightCoverageChangedFields must be exactly the recomputed set");
  }

  const pairs: ReadonlyArray<readonly [string, readonly string[], readonly string[]]> = [
    ["newlyUnresolvedUnknownIds", base.unresolvedUnknownIds, next.unresolvedUnknownIds],
    ["noLongerUnresolvedUnknownIds", next.unresolvedUnknownIds, base.unresolvedUnknownIds],
    ["operatorBlockingReasonsAdded", base.operatorBlockingReasons, next.operatorBlockingReasons],
    ["operatorBlockingReasonsRemoved", next.operatorBlockingReasons, base.operatorBlockingReasons],
  ];
  for (const [field, from, to] of pairs) {
    const actual = validateStringArray(value[field], `run report diff v2.${field}`);
    const expected = addedOf(from, to);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new SniperRunReportDiffV2Error(`run report diff v2.${field} must equal the recomputed movement set`);
    }
  }

  const expectedCodeDeltas = countDeltas(base.reasonCodeCounts, next.reasonCodeCounts);
  if (JSON.stringify(validateCountMap(value.reasonCodeCountDeltas, "run report diff v2.reasonCodeCountDeltas", false)) !== JSON.stringify(expectedCodeDeltas)) {
    throw new SniperRunReportDiffV2Error("run report diff v2.reasonCodeCountDeltas must equal the recomputed deltas");
  }
  const expectedBlockingDeltas = countDeltas(base.blockingReasonCodeCounts, next.blockingReasonCodeCounts);
  if (JSON.stringify(validateCountMap(value.blockingCodeCountDeltas, "run report diff v2.blockingCodeCountDeltas", false)) !== JSON.stringify(expectedBlockingDeltas)) {
    throw new SniperRunReportDiffV2Error("run report diff v2.blockingCodeCountDeltas must equal the recomputed deltas");
  }

  if (!Array.isArray(value.candidateCodeChanges)) {
    throw new SniperRunReportDiffV2Error("run report diff v2.candidateCodeChanges must be an array");
  }
  (value.candidateCodeChanges as unknown[]).forEach((c, i) => {
    const where = `run report diff v2.candidateCodeChanges[${i}]`;
    if (!isObject(c) || !nonEmptyString(c.candidateId)) {
      throw new SniperRunReportDiffV2Error(`${where}.candidateId must be a non-empty string`);
    }
    for (const f of ["codesAdded", "codesRemoved"] as const) {
      if (!Array.isArray(c[f]) || (c[f] as unknown[]).some((x) => !isSniperDecisionReasonCode(x))) {
        throw new SniperRunReportDiffV2Error(`${where}.${f} must be an array of known decision reason codes`);
      }
    }
    if ((c.codesAdded as unknown[]).length === 0 && (c.codesRemoved as unknown[]).length === 0) {
      throw new SniperRunReportDiffV2Error(`${where} must carry at least one code movement (unchanged trails are never listed)`);
    }
  });

  const expectedV2Change =
    (value.decisionSchemaVersionChanged as boolean) ||
    (value.upgradedFromV1Changed as boolean) ||
    expectedPolicyFields.length > 0 ||
    (value.newlyPolicyMismatch as boolean) ||
    (value.noLongerPolicyMismatch as boolean) ||
    (value.preflightCoveragePresenceChanged as boolean) ||
    expectedCoverageFields.length > 0 ||
    (value.newlyMissingRequiredPreflightInput as boolean) ||
    (value.noLongerMissingRequiredPreflightInput as boolean) ||
    (value.newlyUnresolvedUnknownIds as string[]).length > 0 ||
    (value.noLongerUnresolvedUnknownIds as string[]).length > 0 ||
    (value.operatorBlockingReasonsAdded as string[]).length > 0 ||
    (value.operatorBlockingReasonsRemoved as string[]).length > 0 ||
    Object.keys(expectedCodeDeltas).length > 0 ||
    Object.keys(expectedBlockingDeltas).length > 0 ||
    (value.rollupPresenceChanged as boolean) ||
    (value.candidateCodeChanges as unknown[]).length > 0;
  if (value.hasV2LayerChange !== expectedV2Change) {
    throw new SniperRunReportDiffV2Error("run report diff v2.hasV2LayerChange must mirror the recomputed verdict");
  }
  if (value.hasAnyChange !== ((value.hasChange as boolean) || expectedV2Change)) {
    throw new SniperRunReportDiffV2Error("run report diff v2.hasAnyChange must mirror hasChange OR hasV2LayerChange");
  }
  if (
    value.hasNewOperatorBlocking !==
    ((value.operatorBlockingReasonsAdded as string[]).length > 0 || (value.newlyMissingRequiredPreflightInput as boolean))
  ) {
    throw new SniperRunReportDiffV2Error("run report diff v2.hasNewOperatorBlocking must mirror the recomputed verdict");
  }
  return value as unknown as SniperRunReportDiffV2;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperRunReportDiffV2}. */
export interface FormatSniperRunReportDiffV2Options {
  label?: string;
}

function signedEntries(map: Record<string, number>): string {
  const keys = Object.keys(map);
  if (keys.length === 0) return "(none)";
  return keys.map((k) => `${k} ${map[k]! > 0 ? "+" : ""}${map[k]}`).join(", ");
}

/**
 * Render a redacted, stable, human-readable v2 run report diff. The v1 diff sections render first
 * (via the UNCHANGED v1 formatter on an exact v1 view), then the v2 layers: decision/policy
 * visibility movements, preflight-input coverage, unresolved-unknown movements, operator-blocking
 * reason movements, rollup deltas, and per-candidate code-trail changes. Deterministic and
 * path-stable; passed through the shared redactor.
 */
export function formatSniperRunReportDiffV2(
  diff: SniperRunReportDiffV2,
  opts: FormatSniperRunReportDiffV2Options = {},
): string {
  // The v1 body renders first (exact v1 view; its banner lines are replaced by the v2 banner and
  // its disclaimers are suppressed so the v2 disclaimers can close the whole output).
  const v1View: SniperRunReportDiff = {
    ...diff,
    schemaVersion: SNIPER_RUN_REPORT_DIFF_SCHEMA_VERSION,
    banner: SNIPER_RUN_REPORT_DIFF_BANNER,
    disclaimers: [],
  };
  const header = `${diff.banner} (PAPER ONLY)`;
  const v1Body = formatSniperRunReportDiff(v1View, opts).split("\n").slice(2);
  while (v1Body.length > 0 && v1Body[v1Body.length - 1] === "") v1Body.pop();
  const lines: string[] = [header, "=".repeat(header.length), ...v1Body];

  lines.push("");
  lines.push("Decision / policy (v2):");
  lines.push(`- decision artifact: ${diff.base.decisionSchemaVersion ?? "(none)"} → ${diff.next.decisionSchemaVersion ?? "(none)"}${diff.decisionSchemaVersionChanged ? "  [CHANGED]" : ""}`);
  if (diff.upgradedFromV1Changed) lines.push("- upgraded-from-v1 marker changed between the two reports.");
  lines.push(`- policy summary changed fields: ${diff.policySummaryChangedFields.length > 0 ? diff.policySummaryChangedFields.join(", ") : "(none)"}`);
  if (diff.newlyPolicyMismatch) lines.push("- NEW policy/decision schemaVersion mismatch in next — verify the right policy artifact is paired with the run.");
  if (diff.noLongerPolicyMismatch) lines.push("- the base report's policy/decision mismatch is resolved in next.");

  lines.push("");
  lines.push("Preflight-input coverage (v2):");
  if (diff.preflightCoveragePresenceChanged) {
    lines.push(`- coverage presence changed: ${diff.base.preflightInputCoverage ? "present" : "absent"} → ${diff.next.preflightInputCoverage ? "present" : "absent"}`);
  }
  lines.push(`- changed fields: ${diff.preflightCoverageChangedFields.length > 0 ? diff.preflightCoverageChangedFields.join(", ") : "(none)"}`);
  if (diff.newlyMissingRequiredPreflightInput) lines.push("- the policy-required preflight input is NEWLY missing (operator-blocking).");
  if (diff.noLongerMissingRequiredPreflightInput) lines.push("- the previously-missing required preflight input is now supplied.");

  lines.push("");
  lines.push("Unresolved unknowns (v2):");
  lines.push(`- newly unresolved: ${diff.newlyUnresolvedUnknownIds.length > 0 ? diff.newlyUnresolvedUnknownIds.join(", ") : "(none)"}`);
  lines.push(`- resolved:         ${diff.noLongerUnresolvedUnknownIds.length > 0 ? diff.noLongerUnresolvedUnknownIds.join(", ") : "(none)"}`);

  lines.push("");
  lines.push("Operator-blocking reasons (v2; verbatim):");
  if (diff.operatorBlockingReasonsAdded.length === 0 && diff.operatorBlockingReasonsRemoved.length === 0) {
    lines.push("- (no movement)");
  }
  for (const r of diff.operatorBlockingReasonsAdded) lines.push(`+ ${r}`);
  for (const r of diff.operatorBlockingReasonsRemoved) lines.push(`- ${r}`);

  lines.push("");
  lines.push("Reason-code rollup (v2):");
  if (diff.rollupPresenceChanged) {
    lines.push(`- rollup presence changed: ${diff.base.reasonCodeCounts ? "present" : "absent"} → ${diff.next.reasonCodeCounts ? "present" : "absent"}`);
  }
  lines.push(`- code count deltas:     ${signedEntries(diff.reasonCodeCountDeltas)}`);
  lines.push(`- blocking count deltas: ${signedEntries(diff.blockingCodeCountDeltas)}`);
  if (diff.candidateCodeChanges.length > 0) {
    lines.push("- candidate code trails:");
    for (const c of diff.candidateCodeChanges) {
      lines.push(`    ${c.candidateId}: ${[...c.codesAdded.map((x) => `+${x}`), ...c.codesRemoved.map((x) => `-${x}`)].join(", ")}`);
    }
  }

  lines.push("");
  lines.push(`Any v1-core change:       ${diff.hasChange ? "YES" : "no"}`);
  lines.push(`Any v2-layer change:      ${diff.hasV2LayerChange ? "YES" : "no"}`);
  lines.push(`Any change overall:       ${diff.hasAnyChange ? "YES" : "no"}`);
  lines.push(`Any new operator block:   ${diff.hasNewOperatorBlocking ? "YES" : "no"}`);

  lines.push("");
  for (const d of diff.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
