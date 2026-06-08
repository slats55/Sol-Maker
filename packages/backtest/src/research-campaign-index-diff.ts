/**
 * Deterministic diff of two Sprint 18 RESEARCH CAMPAIGN INDEXES (Sprint 19, the campaign analogue
 * of the manifest/bundle diffs). Answers "what changed between two PAPER-only research campaigns,
 * and did the change break integrity?" without re-walking either campaign directory.
 *
 * `diffBacktestResearchCampaignIndexes(base, next)` structurally reads both indexes (refusing a
 * non-index), then produces a {@link BacktestResearchCampaignIndexDiff}: the top-level **campaign
 * digest** change, runs added/removed (paired by `runId`), per-run run-digest / valid-status /
 * unknown-malformed changes, the runs that newly need attention (or no longer do), aggregate
 * kind-count and schema-set changes, run/artifact count deltas, and BOTH a `hasChange` flag and a
 * CONSERVATIVE `hasRegression` flag (integrity breakage only), each with stable reasons.
 *
 * A run "needs attention" exactly when it is not `valid`, so a per-run valid → invalid transition
 * IS an attention change; the campaign-level `newlyNeedsAttention` / `noLongerNeedsAttention`
 * lists roll that up across paired AND added/removed runs.
 *
 * It is **pure**: no network, no RPC, no wallet, no filesystem, no `Date.now`, no `Math.random`,
 * and it never mutates its inputs (every value placed in the diff is a fresh copy with stable key
 * order, so the JSON is byte-stable for a given pair). This is a reproducibility/audit comparison
 * over LOCAL campaign summaries — never a live result, never advice, never a profitability claim.
 */

import { redactString } from "@soulmaker/security";

/** Stable schema identifier for the research-campaign-diff shape. Bump only on a breaking change. */
export const BACKTEST_RESEARCH_CAMPAIGN_DIFF_SCHEMA_VERSION = "backtest.research.campaign.diff.v1";

/** Required disclaimers carried by every campaign diff (stable order). */
export const BACKTEST_RESEARCH_CAMPAIGN_DIFF_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY research campaign diff — compares two LOCAL campaign indexes.",
  "Every value is a change between two local reproducibility summaries, not a live result.",
  "A changed campaign/run digest is a non-cryptographic content-fingerprint difference, not a security or anti-tamper signal.",
  "Uses injected campaign data only — no live data was fetched and nothing was traded.",
  "Not a live result. Not financial advice. Not a profitability claim.",
];

/** Thrown when an `unknown` value is not a structurally valid campaign index/diff. */
export class BacktestResearchCampaignIndexDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestResearchCampaignIndexDiffError";
  }
}

// --- diff data model ---------------------------------------------------------

/** A simple base→next numeric comparison. */
export interface ResearchCampaignNumberDelta {
  base: number;
  next: number;
  delta: number;
}

/** A compact reference to a run that was added or removed. */
export interface ResearchCampaignRunRef {
  runId: string;
  runDigest: string | null;
  valid: boolean;
}

/** A paired run (same runId in BOTH campaigns) whose recorded fields changed. */
export interface ResearchCampaignRunChange {
  runId: string;
  baseRunDigest: string | null;
  nextRunDigest: string | null;
  runDigestChanged: boolean;
  baseValid: boolean;
  nextValid: boolean;
  validChanged: boolean;
  /** base valid AND next invalid (a regression). */
  becameInvalid: boolean;
  /** base invalid AND next valid (an improvement). */
  becameValid: boolean;
  artifactCount: ResearchCampaignNumberDelta;
  unknownArtifactCount: ResearchCampaignNumberDelta;
  malformedArtifactCount: ResearchCampaignNumberDelta;
}

/** A per-key count change (aggregate kind counts). */
export interface ResearchCampaignCountChange {
  key: string;
  base: number;
  next: number;
  delta: number;
}

/** The full, deterministic, JSON-serializable diff of two campaign indexes. */
export interface BacktestResearchCampaignIndexDiff {
  schemaVersion: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  baseCampaignName: string | null;
  nextCampaignName: string | null;
  /** Whether the two campaign schema versions matched (a mismatch is an incompatible comparison). */
  campaignSchemaMatch: boolean;
  baseCampaignDigest: string;
  nextCampaignDigest: string;
  campaignDigestChanged: boolean;
  runCount: ResearchCampaignNumberDelta;
  validRunCount: ResearchCampaignNumberDelta;
  invalidRunCount: ResearchCampaignNumberDelta;
  totalArtifactCount: ResearchCampaignNumberDelta;
  totalKnownArtifactCount: ResearchCampaignNumberDelta;
  totalUnknownArtifactCount: ResearchCampaignNumberDelta;
  totalMalformedArtifactCount: ResearchCampaignNumberDelta;
  /** Runs present in next but not base, sorted by runId. */
  addedRuns: ResearchCampaignRunRef[];
  /** Runs present in base but not next, sorted by runId. */
  removedRuns: ResearchCampaignRunRef[];
  /** Runs present in both whose digest/validity/counts changed, sorted by runId. */
  changedRuns: ResearchCampaignRunChange[];
  /** Run ids that need attention in next but did NOT in base (paired or newly added), sorted. */
  newlyNeedsAttention: string[];
  /** Run ids that needed attention in base but do NOT in next (paired or removed), sorted. */
  noLongerNeedsAttention: string[];
  aggregateKindCountChanges: ResearchCampaignCountChange[];
  /** Aggregate recognized schema versions present in next but not base, sorted. */
  aggregateSchemasAdded: string[];
  /** Aggregate recognized schema versions present in base but not next, sorted. */
  aggregateSchemasRemoved: string[];
  hasChange: boolean;
  changeReasons: string[];
  /** Conservative: true only for integrity breakage (see {@link diffBacktestResearchCampaignIndexes}). */
  hasRegression: boolean;
  regressionReasons: string[];
  disclaimers: string[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function delta(base: number, next: number): ResearchCampaignNumberDelta {
  return { base, next, delta: next - base };
}

const ARTIFACT_KIND_SET = new Set<string>([
  "scenario",
  "variant-plan",
  "variant-plan-explain",
  "backtest-report",
  "suite-index",
  "sensitivity-report",
  "sensitivity-matrix-report",
  "coverage-report",
  "diff-report",
  "unknown-json",
]);

/** A lightweight read of one run summary for diffing (strict on the fields the diff reads). */
interface ReadRun {
  runId: string;
  runDigest: string | null;
  valid: boolean;
  artifactCount: number;
  unknownArtifactCount: number;
  malformedArtifactCount: number;
}

/** A lightweight, schemaVersion-lenient read of a campaign index for diffing. */
interface ReadCampaign {
  schemaVersion: string;
  campaignName: string | null;
  campaignDigest: string;
  runCount: number;
  validRunCount: number;
  invalidRunCount: number;
  totalArtifactCount: number;
  totalKnownArtifactCount: number;
  totalUnknownArtifactCount: number;
  totalMalformedArtifactCount: number;
  runs: ReadRun[];
  kindCounts: Map<string, number>;
  aggregateSchemaVersions: string[];
}

function readRun(value: unknown, where: string): ReadRun {
  if (!isObject(value)) throw new BacktestResearchCampaignIndexDiffError(`${where} must be an object`);
  if (!nonEmptyString(value.runId)) throw new BacktestResearchCampaignIndexDiffError(`${where}.runId must be a non-empty string`);
  if (value.runDigest !== null && !nonEmptyString(value.runDigest)) {
    throw new BacktestResearchCampaignIndexDiffError(`${where}.runDigest must be a non-empty string or null`);
  }
  if (typeof value.valid !== "boolean") throw new BacktestResearchCampaignIndexDiffError(`${where}.valid must be a boolean`);
  for (const f of ["artifactCount", "unknownArtifactCount", "malformedArtifactCount"] as const) {
    if (!isNonNegativeInteger(value[f])) {
      throw new BacktestResearchCampaignIndexDiffError(`${where}.${f} must be a non-negative integer`);
    }
  }
  return {
    runId: value.runId,
    runDigest: (value.runDigest as string | null) ?? null,
    valid: value.valid,
    artifactCount: value.artifactCount as number,
    unknownArtifactCount: value.unknownArtifactCount as number,
    malformedArtifactCount: value.malformedArtifactCount as number,
  };
}

/**
 * Structurally read one INPUT campaign index for diffing. Lenient on `schemaVersion` (any non-empty
 * string) so a version mismatch is surfaced rather than refused, but strict about every field the
 * diff reads. Does NOT mutate. Throws {@link BacktestResearchCampaignIndexDiffError}.
 */
function readCampaignForDiff(value: unknown, side: string): ReadCampaign {
  if (!isObject(value)) throw new BacktestResearchCampaignIndexDiffError(`${side} campaign index must be a JSON object`);
  if (!nonEmptyString(value.schemaVersion)) {
    throw new BacktestResearchCampaignIndexDiffError(`${side} campaign index.schemaVersion must be a non-empty string`);
  }
  if (value.campaignName !== null && typeof value.campaignName !== "string") {
    throw new BacktestResearchCampaignIndexDiffError(`${side} campaign index.campaignName must be a string or null`);
  }
  if (!nonEmptyString(value.campaignDigest)) {
    throw new BacktestResearchCampaignIndexDiffError(`${side} campaign index.campaignDigest must be a non-empty string`);
  }
  for (const f of [
    "runCount",
    "validRunCount",
    "invalidRunCount",
    "totalArtifactCount",
    "totalKnownArtifactCount",
    "totalUnknownArtifactCount",
    "totalMalformedArtifactCount",
  ] as const) {
    if (!isNonNegativeInteger(value[f])) {
      throw new BacktestResearchCampaignIndexDiffError(`${side} campaign index.${f} must be a non-negative integer`);
    }
  }
  if (!Array.isArray(value.runs)) {
    throw new BacktestResearchCampaignIndexDiffError(`${side} campaign index.runs must be an array`);
  }
  const runs = value.runs.map((r, i) => readRun(r, `${side} campaign index.runs[${i}]`));
  if (!Array.isArray(value.aggregateKindCounts)) {
    throw new BacktestResearchCampaignIndexDiffError(`${side} campaign index.aggregateKindCounts must be an array`);
  }
  const kindCounts = new Map<string, number>();
  value.aggregateKindCounts.forEach((entry, i) => {
    if (!isObject(entry) || typeof entry.kind !== "string" || !ARTIFACT_KIND_SET.has(entry.kind) || !isNonNegativeInteger(entry.count)) {
      throw new BacktestResearchCampaignIndexDiffError(`${side} campaign index.aggregateKindCounts[${i}] must be a {kind,count} entry`);
    }
    kindCounts.set(entry.kind, entry.count);
  });
  if (!Array.isArray(value.aggregateSchemaVersions)) {
    throw new BacktestResearchCampaignIndexDiffError(`${side} campaign index.aggregateSchemaVersions must be an array`);
  }
  value.aggregateSchemaVersions.forEach((s, i) => {
    if (!nonEmptyString(s)) {
      throw new BacktestResearchCampaignIndexDiffError(`${side} campaign index.aggregateSchemaVersions[${i}] must be a non-empty string`);
    }
  });
  return {
    schemaVersion: value.schemaVersion,
    campaignName: (value.campaignName as string | null) ?? null,
    campaignDigest: value.campaignDigest,
    runCount: value.runCount as number,
    validRunCount: value.validRunCount as number,
    invalidRunCount: value.invalidRunCount as number,
    totalArtifactCount: value.totalArtifactCount as number,
    totalKnownArtifactCount: value.totalKnownArtifactCount as number,
    totalUnknownArtifactCount: value.totalUnknownArtifactCount as number,
    totalMalformedArtifactCount: value.totalMalformedArtifactCount as number,
    runs,
    kindCounts,
    aggregateSchemaVersions: [...(value.aggregateSchemaVersions as string[])].sort(compareString),
  };
}

/** Build the per-key count changes (only keys whose count actually changed), sorted by key. */
function countChanges(base: Map<string, number>, next: Map<string, number>): ResearchCampaignCountChange[] {
  const keys = [...new Set([...base.keys(), ...next.keys()])].sort(compareString);
  const out: ResearchCampaignCountChange[] = [];
  for (const key of keys) {
    const b = base.get(key) ?? 0;
    const n = next.get(key) ?? 0;
    if (b !== n) out.push({ key, base: b, next: n, delta: n - b });
  }
  return out;
}

// --- public API --------------------------------------------------------------

/**
 * Compute the deterministic diff of two campaign indexes. Both inputs are structurally read (a
 * non-index throws {@link BacktestResearchCampaignIndexDiffError}); neither is mutated. Runs are
 * paired by `runId` (added / removed / changed). Pure and byte-stable for a given pair.
 *
 * `hasRegression` is CONSERVATIVE — true only for integrity/reproducibility breakage:
 *  - the campaign schema versions are incompatible (mismatch);
 *  - a previously-VALID run was removed;
 *  - a paired run went valid → invalid;
 *  - a paired run's run digest changed (unexpected content change for the same run);
 *  - the total unknown or malformed artifact count increased.
 * A purely additive change (e.g. a NEW valid run) is a CHANGE but not a regression.
 */
export function diffBacktestResearchCampaignIndexes(
  base: unknown,
  next: unknown,
): BacktestResearchCampaignIndexDiff {
  const b = readCampaignForDiff(base, "base");
  const n = readCampaignForDiff(next, "next");

  const baseById = new Map(b.runs.map((r) => [r.runId, r]));
  const nextById = new Map(n.runs.map((r) => [r.runId, r]));

  const addedRuns = n.runs
    .filter((r) => !baseById.has(r.runId))
    .map((r) => ({ runId: r.runId, runDigest: r.runDigest, valid: r.valid }))
    .sort((x, y) => compareString(x.runId, y.runId));
  const removedRuns = b.runs
    .filter((r) => !nextById.has(r.runId))
    .map((r) => ({ runId: r.runId, runDigest: r.runDigest, valid: r.valid }))
    .sort((x, y) => compareString(x.runId, y.runId));

  const changedRuns: ResearchCampaignRunChange[] = [];
  for (const nr of n.runs) {
    const br = baseById.get(nr.runId);
    if (!br) continue;
    const runDigestChanged = br.runDigest !== nr.runDigest;
    const validChanged = br.valid !== nr.valid;
    const artifactCount = delta(br.artifactCount, nr.artifactCount);
    const unknownArtifactCount = delta(br.unknownArtifactCount, nr.unknownArtifactCount);
    const malformedArtifactCount = delta(br.malformedArtifactCount, nr.malformedArtifactCount);
    if (
      !runDigestChanged &&
      !validChanged &&
      artifactCount.delta === 0 &&
      unknownArtifactCount.delta === 0 &&
      malformedArtifactCount.delta === 0
    ) {
      continue;
    }
    changedRuns.push({
      runId: nr.runId,
      baseRunDigest: br.runDigest,
      nextRunDigest: nr.runDigest,
      runDigestChanged,
      baseValid: br.valid,
      nextValid: nr.valid,
      validChanged,
      becameInvalid: br.valid && !nr.valid,
      becameValid: !br.valid && nr.valid,
      artifactCount,
      unknownArtifactCount,
      malformedArtifactCount,
    });
  }
  changedRuns.sort((x, y) => compareString(x.runId, y.runId));

  // Campaign-level attention rollup (attention === !valid), across paired AND added/removed runs.
  const baseAttention = new Set(b.runs.filter((r) => !r.valid).map((r) => r.runId));
  const nextAttention = new Set(n.runs.filter((r) => !r.valid).map((r) => r.runId));
  const newlyNeedsAttention = [...nextAttention].filter((id) => !baseAttention.has(id)).sort(compareString);
  const noLongerNeedsAttention = [...baseAttention].filter((id) => !nextAttention.has(id)).sort(compareString);

  const aggregateKindCountChanges = countChanges(b.kindCounts, n.kindCounts);
  const baseSchemas = new Set(b.aggregateSchemaVersions);
  const nextSchemas = new Set(n.aggregateSchemaVersions);
  const aggregateSchemasAdded = n.aggregateSchemaVersions.filter((s) => !baseSchemas.has(s));
  const aggregateSchemasRemoved = b.aggregateSchemaVersions.filter((s) => !nextSchemas.has(s));

  const campaignSchemaMatch = b.schemaVersion === n.schemaVersion;
  const campaignDigestChanged = b.campaignDigest !== n.campaignDigest;

  const runCount = delta(b.runCount, n.runCount);
  const validRunCount = delta(b.validRunCount, n.validRunCount);
  const invalidRunCount = delta(b.invalidRunCount, n.invalidRunCount);
  const totalArtifactCount = delta(b.totalArtifactCount, n.totalArtifactCount);
  const totalKnownArtifactCount = delta(b.totalKnownArtifactCount, n.totalKnownArtifactCount);
  const totalUnknownArtifactCount = delta(b.totalUnknownArtifactCount, n.totalUnknownArtifactCount);
  const totalMalformedArtifactCount = delta(b.totalMalformedArtifactCount, n.totalMalformedArtifactCount);

  // --- change reasons (any difference) ---
  const changeReasons: string[] = [];
  if (!campaignSchemaMatch) changeReasons.push(`campaign schemaVersion differs ("${b.schemaVersion}" → "${n.schemaVersion}")`);
  if (campaignDigestChanged) changeReasons.push(`campaign digest changed (${b.campaignDigest} → ${n.campaignDigest})`);
  if (addedRuns.length > 0) changeReasons.push(`${addedRuns.length} run(s) added`);
  if (removedRuns.length > 0) changeReasons.push(`${removedRuns.length} run(s) removed`);
  if (changedRuns.length > 0) changeReasons.push(`${changedRuns.length} run(s) changed`);
  if (newlyNeedsAttention.length > 0) changeReasons.push(`${newlyNeedsAttention.length} run(s) newly need attention`);
  if (noLongerNeedsAttention.length > 0) changeReasons.push(`${noLongerNeedsAttention.length} run(s) no longer need attention`);
  if (validRunCount.delta !== 0) changeReasons.push(`valid run count ${validRunCount.base} → ${validRunCount.next}`);
  if (invalidRunCount.delta !== 0) changeReasons.push(`invalid run count ${invalidRunCount.base} → ${invalidRunCount.next}`);
  if (totalUnknownArtifactCount.delta !== 0) changeReasons.push(`total unknown artifacts ${totalUnknownArtifactCount.base} → ${totalUnknownArtifactCount.next}`);
  if (totalMalformedArtifactCount.delta !== 0) changeReasons.push(`total malformed artifacts ${totalMalformedArtifactCount.base} → ${totalMalformedArtifactCount.next}`);
  if (totalArtifactCount.delta !== 0) changeReasons.push(`total artifacts ${totalArtifactCount.base} → ${totalArtifactCount.next}`);
  for (const k of aggregateKindCountChanges) changeReasons.push(`kind "${k.key}" count ${k.base} → ${k.next}`);
  if (aggregateSchemasAdded.length > 0) changeReasons.push(`${aggregateSchemasAdded.length} schema(s) added to the campaign set`);
  if (aggregateSchemasRemoved.length > 0) changeReasons.push(`${aggregateSchemasRemoved.length} schema(s) removed from the campaign set`);

  // --- regression reasons (conservative: integrity breakage only) ---
  const regressionReasons: string[] = [];
  if (!campaignSchemaMatch) regressionReasons.push(`incompatible campaign schemaVersion ("${b.schemaVersion}" → "${n.schemaVersion}")`);
  const removedValid = removedRuns.filter((r) => r.valid);
  if (removedValid.length > 0) regressionReasons.push(`${removedValid.length} previously-valid run(s) removed (${removedValid.map((r) => r.runId).join(", ")})`);
  const becameInvalid = changedRuns.filter((c) => c.becameInvalid);
  if (becameInvalid.length > 0) regressionReasons.push(`${becameInvalid.length} run(s) became invalid (${becameInvalid.map((c) => c.runId).join(", ")})`);
  const digestChangedRuns = changedRuns.filter((c) => c.runDigestChanged);
  if (digestChangedRuns.length > 0) regressionReasons.push(`${digestChangedRuns.length} run(s) changed run digest (${digestChangedRuns.map((c) => c.runId).join(", ")})`);
  if (totalUnknownArtifactCount.delta > 0) regressionReasons.push(`total unknown artifact count increased by ${totalUnknownArtifactCount.delta}`);
  if (totalMalformedArtifactCount.delta > 0) regressionReasons.push(`total malformed artifact count increased by ${totalMalformedArtifactCount.delta}`);

  return {
    schemaVersion: BACKTEST_RESEARCH_CAMPAIGN_DIFF_SCHEMA_VERSION,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    baseCampaignName: b.campaignName,
    nextCampaignName: n.campaignName,
    campaignSchemaMatch,
    baseCampaignDigest: b.campaignDigest,
    nextCampaignDigest: n.campaignDigest,
    campaignDigestChanged,
    runCount,
    validRunCount,
    invalidRunCount,
    totalArtifactCount,
    totalKnownArtifactCount,
    totalUnknownArtifactCount,
    totalMalformedArtifactCount,
    addedRuns,
    removedRuns,
    changedRuns,
    newlyNeedsAttention,
    noLongerNeedsAttention,
    aggregateKindCountChanges,
    aggregateSchemasAdded,
    aggregateSchemasRemoved,
    hasChange: changeReasons.length > 0,
    changeReasons,
    hasRegression: regressionReasons.length > 0,
    regressionReasons,
    disclaimers: [...BACKTEST_RESEARCH_CAMPAIGN_DIFF_DISCLAIMERS],
  };
}

// --- validation (backstop) ---------------------------------------------------

function isNumberDelta(value: unknown): boolean {
  return isObject(value) && isFiniteNumber(value.base) && isFiniteNumber(value.next) && isFiniteNumber(value.delta);
}

function validateStringArray(value: unknown, where: string): void {
  if (!Array.isArray(value)) throw new BacktestResearchCampaignIndexDiffError(`${where} must be an array`);
  value.forEach((s, i) => {
    if (!nonEmptyString(s)) throw new BacktestResearchCampaignIndexDiffError(`${where}[${i}] must be a non-empty string`);
  });
}

/**
 * Strictly validate a value as a {@link BacktestResearchCampaignIndexDiff} and return it narrowed.
 * Checks the schema version, the PAPER-ONLY labelling, the change/regression flags + reasons, the
 * number deltas, and the added/removed/changed run + count-change shapes. Throws
 * {@link BacktestResearchCampaignIndexDiffError}. Pure.
 */
export function validateBacktestResearchCampaignIndexDiff(value: unknown): BacktestResearchCampaignIndexDiff {
  if (!isObject(value)) throw new BacktestResearchCampaignIndexDiffError("campaign diff must be a JSON object");
  if (value.schemaVersion !== BACKTEST_RESEARCH_CAMPAIGN_DIFF_SCHEMA_VERSION) {
    throw new BacktestResearchCampaignIndexDiffError(
      `campaign diff.schemaVersion must be "${BACKTEST_RESEARCH_CAMPAIGN_DIFF_SCHEMA_VERSION}"`,
    );
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new BacktestResearchCampaignIndexDiffError(`campaign diff.${flag} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new BacktestResearchCampaignIndexDiffError("campaign diff.disclaimers must be a non-empty array");
  }
  for (const f of ["campaignSchemaMatch", "campaignDigestChanged", "hasChange", "hasRegression"] as const) {
    if (typeof value[f] !== "boolean") throw new BacktestResearchCampaignIndexDiffError(`campaign diff.${f} must be a boolean`);
  }
  for (const f of ["baseCampaignDigest", "nextCampaignDigest"] as const) {
    if (!nonEmptyString(value[f])) throw new BacktestResearchCampaignIndexDiffError(`campaign diff.${f} must be a non-empty string`);
  }
  for (const f of ["changeReasons", "regressionReasons"] as const) {
    if (!Array.isArray(value[f])) throw new BacktestResearchCampaignIndexDiffError(`campaign diff.${f} must be an array`);
  }
  for (const f of [
    "runCount",
    "validRunCount",
    "invalidRunCount",
    "totalArtifactCount",
    "totalKnownArtifactCount",
    "totalUnknownArtifactCount",
    "totalMalformedArtifactCount",
  ] as const) {
    if (!isNumberDelta(value[f])) throw new BacktestResearchCampaignIndexDiffError(`campaign diff.${f} must be a {base,next,delta} number delta`);
  }
  for (const key of ["addedRuns", "removedRuns"] as const) {
    if (!Array.isArray(value[key])) throw new BacktestResearchCampaignIndexDiffError(`campaign diff.${key} must be an array`);
    (value[key] as unknown[]).forEach((r, i) => {
      const where = `campaign diff.${key}[${i}]`;
      if (!isObject(r) || !nonEmptyString(r.runId) || typeof r.valid !== "boolean") {
        throw new BacktestResearchCampaignIndexDiffError(`${where} must be a {runId,runDigest,valid} ref`);
      }
      if (r.runDigest !== null && !nonEmptyString(r.runDigest)) {
        throw new BacktestResearchCampaignIndexDiffError(`${where}.runDigest must be a non-empty string or null`);
      }
    });
  }
  if (!Array.isArray(value.changedRuns)) throw new BacktestResearchCampaignIndexDiffError("campaign diff.changedRuns must be an array");
  (value.changedRuns as unknown[]).forEach((c, i) => {
    const where = `campaign diff.changedRuns[${i}]`;
    if (!isObject(c) || !nonEmptyString(c.runId)) {
      throw new BacktestResearchCampaignIndexDiffError(`${where} must have a non-empty runId`);
    }
    for (const bflag of ["runDigestChanged", "baseValid", "nextValid", "validChanged", "becameInvalid", "becameValid"] as const) {
      if (typeof c[bflag] !== "boolean") throw new BacktestResearchCampaignIndexDiffError(`${where}.${bflag} must be a boolean`);
    }
    for (const nf of ["artifactCount", "unknownArtifactCount", "malformedArtifactCount"] as const) {
      if (!isNumberDelta(c[nf])) throw new BacktestResearchCampaignIndexDiffError(`${where}.${nf} must be a {base,next,delta} number delta`);
    }
  });
  validateStringArray(value.newlyNeedsAttention, "campaign diff.newlyNeedsAttention");
  validateStringArray(value.noLongerNeedsAttention, "campaign diff.noLongerNeedsAttention");
  validateStringArray(value.aggregateSchemasAdded, "campaign diff.aggregateSchemasAdded");
  validateStringArray(value.aggregateSchemasRemoved, "campaign diff.aggregateSchemasRemoved");
  if (!Array.isArray(value.aggregateKindCountChanges)) {
    throw new BacktestResearchCampaignIndexDiffError("campaign diff.aggregateKindCountChanges must be an array");
  }
  (value.aggregateKindCountChanges as unknown[]).forEach((c, i) => {
    const where = `campaign diff.aggregateKindCountChanges[${i}]`;
    if (!isObject(c) || !nonEmptyString(c.key) || !isFiniteNumber(c.base) || !isFiniteNumber(c.next) || !isFiniteNumber(c.delta)) {
      throw new BacktestResearchCampaignIndexDiffError(`${where} must be a {key,base,next,delta} count change`);
    }
  });
  return value as unknown as BacktestResearchCampaignIndexDiff;
}

// --- human formatter ---------------------------------------------------------

export interface FormatBacktestResearchCampaignIndexDiffOptions {
  baseLabel?: string;
  nextLabel?: string;
  /** Cap on the number of per-run rows printed per section (default 50; the rest are summarized). */
  maxRunRows?: number;
}

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n}`;
}

/**
 * Render a redacted, human-readable, PAPER-ONLY campaign diff. Sectioned and stable for a given
 * diff object; long run lists are summarized (never an unsafe raw dump). Leads with the campaign-
 * digest change and closes with the CHANGE / REGRESSION verdicts + the not-live / not-advice framing.
 */
export function formatBacktestResearchCampaignIndexDiff(
  diff: BacktestResearchCampaignIndexDiff,
  opts: FormatBacktestResearchCampaignIndexDiffOptions = {},
): string {
  const baseLabel = opts.baseLabel ?? diff.baseCampaignName ?? "base";
  const nextLabel = opts.nextLabel ?? diff.nextCampaignName ?? "next";
  const maxRows = opts.maxRunRows ?? 50;
  const lines: string[] = [];

  const header = "Research campaign diff (SIMULATED PAPER-ONLY)";
  lines.push(header);
  lines.push("=".repeat(header.length));

  lines.push("Campaign pair:");
  lines.push(`- base (${baseLabel}): ${diff.baseCampaignName ?? "(unnamed)"}  digest ${diff.baseCampaignDigest}  (${diff.runCount.base} run(s))`);
  lines.push(`- next (${nextLabel}): ${diff.nextCampaignName ?? "(unnamed)"}  digest ${diff.nextCampaignDigest}  (${diff.runCount.next} run(s))`);
  if (!diff.campaignSchemaMatch) lines.push("- note: campaign schema versions differ (incompatible)");
  lines.push(`- campaign digest changed: ${diff.campaignDigestChanged ? "YES" : "no"}`);
  lines.push("");

  lines.push("Counts:");
  lines.push(`- runs: ${diff.runCount.base} → ${diff.runCount.next} (Δ ${signed(diff.runCount.delta)})`);
  lines.push(`- valid: ${diff.validRunCount.base} → ${diff.validRunCount.next} (Δ ${signed(diff.validRunCount.delta)})`);
  lines.push(`- invalid: ${diff.invalidRunCount.base} → ${diff.invalidRunCount.next} (Δ ${signed(diff.invalidRunCount.delta)})`);
  lines.push(`- artifacts: ${diff.totalArtifactCount.base} → ${diff.totalArtifactCount.next} (Δ ${signed(diff.totalArtifactCount.delta)})`);
  lines.push(`- unknown: ${diff.totalUnknownArtifactCount.base} → ${diff.totalUnknownArtifactCount.next} (Δ ${signed(diff.totalUnknownArtifactCount.delta)})`);
  lines.push(`- malformed: ${diff.totalMalformedArtifactCount.base} → ${diff.totalMalformedArtifactCount.next} (Δ ${signed(diff.totalMalformedArtifactCount.delta)})`);
  lines.push("");

  const section = (title: string, rows: string[]): void => {
    lines.push(`${title} (${rows.length}):`);
    if (rows.length === 0) {
      lines.push("  - (none)");
      return;
    }
    for (const r of rows.slice(0, maxRows)) lines.push(`  - ${r}`);
    const hidden = rows.length - Math.min(rows.length, maxRows);
    if (hidden > 0) lines.push(`  - … and ${hidden} more (summarized; see the diff JSON for the full list)`);
  };
  section("Added runs", diff.addedRuns.map((r) => `${r.runId} [${r.valid ? "valid" : "attention"}]  ${r.runDigest ?? "(none)"}`));
  section("Removed runs", diff.removedRuns.map((r) => `${r.runId} [${r.valid ? "valid" : "attention"}]  ${r.runDigest ?? "(none)"}`));
  section(
    "Changed runs",
    diff.changedRuns.map((c) => {
      const tags: string[] = [];
      if (c.runDigestChanged) tags.push("digest");
      if (c.becameInvalid) tags.push("valid→invalid");
      else if (c.becameValid) tags.push("invalid→valid");
      if (c.unknownArtifactCount.delta !== 0) tags.push(`unknown ${signed(c.unknownArtifactCount.delta)}`);
      if (c.malformedArtifactCount.delta !== 0) tags.push(`malformed ${signed(c.malformedArtifactCount.delta)}`);
      if (c.artifactCount.delta !== 0) tags.push(`artifacts ${signed(c.artifactCount.delta)}`);
      return `${c.runId} [${tags.join(", ")}]`;
    }),
  );
  lines.push("");

  if (diff.newlyNeedsAttention.length > 0 || diff.noLongerNeedsAttention.length > 0) {
    lines.push("Attention:");
    for (const id of diff.newlyNeedsAttention) lines.push(`  + ${id} (now needs attention)`);
    for (const id of diff.noLongerNeedsAttention) lines.push(`  - ${id} (no longer needs attention)`);
    lines.push("");
  }
  if (diff.aggregateSchemasAdded.length > 0 || diff.aggregateSchemasRemoved.length > 0) {
    lines.push("Aggregate schema set:");
    for (const s of diff.aggregateSchemasAdded) lines.push(`  + ${s}`);
    for (const s of diff.aggregateSchemasRemoved) lines.push(`  - ${s}`);
    lines.push("");
  }
  if (diff.aggregateKindCountChanges.length > 0) {
    lines.push("Aggregate kind count changes:");
    for (const k of diff.aggregateKindCountChanges) lines.push(`  - ${k.key}: ${k.base} → ${k.next} (Δ ${signed(k.delta)})`);
    lines.push("");
  }

  lines.push(`Changed: ${diff.hasChange ? "YES" : "no"}`);
  if (diff.hasChange) for (const r of diff.changeReasons) lines.push(`- ${r}`);
  lines.push(`Regression: ${diff.hasRegression ? "YES" : "no"}`);
  if (diff.hasRegression) for (const r of diff.regressionReasons) lines.push(`- ${r}`);
  lines.push("");

  lines.push("Notes:");
  for (const d of diff.disclaimers) lines.push(`- ${d}`);

  return redactString(lines.join("\n"));
}
