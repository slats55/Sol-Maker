/**
 * Strict, pure validation of a {@link BacktestSuiteIndex} parsed from JSON.
 *
 * The suite **diff** tool consumes two `suite-index.json` files produced by a prior
 * `paper:backtest:suite --out-dir` run. Before diffing them we must be sure each is
 * actually a suite index (not arbitrary JSON), so the diff reads only well-typed
 * fields and never coerces garbage into a "0". This validator refuses anything that
 * is not structurally a suite index; it does NOT relax or normalize values.
 *
 * Pure and deterministic: no network, no RPC, no wallet, no filesystem, no
 * `Date.now`, no `Math.random`. It does not mutate its input. It is tolerant of
 * EXTRA fields (forward-compatibility) but strict about the fields the diff reads.
 * `schemaVersion` must be a non-empty string but is NOT required to equal the
 * current version here — the diff compares the two strings itself so it can surface
 * a mismatch rather than refuse.
 */

import type {
  BacktestSuiteEntry,
  BacktestSuiteEntrySummary,
  BacktestSuiteIndex,
  BacktestSuiteSummary,
} from "./suite.js";

/** Thrown when an `unknown` value is not a structurally valid {@link BacktestSuiteIndex}. */
export class BacktestSuiteIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestSuiteIndexError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

type Errors = string[];

function requireFiniteFields(
  obj: Record<string, unknown>,
  parent: string,
  keys: readonly string[],
  errors: Errors,
): void {
  for (const key of keys) {
    if (!isFiniteNumber(obj[key])) errors.push(`${parent}.${key} must be a finite number`);
  }
}

const SUMMARY_NUMBER_FIELDS = [
  "scenarioCount",
  "passedCount",
  "failedCount",
  "warningCount",
  "totalStepCount",
  "totalCandidateCount",
  "totalBuyFills",
  "totalSellFills",
  "totalFills",
  "totalRejects",
  "totalRealizedPnlUsd",
  "totalUnrealizedPnlUsd",
  "totalSimulatedPnlUsd",
  "totalSimulatedNotionalUsd",
  "totalOpenPositions",
  "totalClosedTrades",
] as const;

const ENTRY_SUMMARY_NUMBER_FIELDS = [
  "stepCount",
  "candidateCount",
  "buyFills",
  "sellFills",
  "rejects",
  "realizedPnlUsd",
  "unrealizedPnlUsd",
  "totalPnlUsd",
  "openPositions",
  "closedTrades",
  "simulatedNotionalUsd",
] as const;

const VALID_STATUS = new Set(["passed", "failed"]);

function collectSummary(value: unknown, errors: Errors): void {
  if (!isObject(value)) {
    errors.push("summary must be an object");
    return;
  }
  requireFiniteFields(value, "summary", SUMMARY_NUMBER_FIELDS, errors);
}

function collectEntrySummary(value: unknown, where: string, errors: Errors): void {
  if (value === null) return; // a failed entry legitimately has a null summary
  if (!isObject(value)) {
    errors.push(`${where}.summary must be an object or null`);
    return;
  }
  requireFiniteFields(value, `${where}.summary`, ENTRY_SUMMARY_NUMBER_FIELDS, errors);
}

function collectEntries(value: unknown, errors: Errors): void {
  if (!Array.isArray(value)) {
    errors.push("entries must be an array");
    return;
  }
  value.forEach((e, i) => {
    const where = `entries[${i}]`;
    if (!isObject(e)) {
      errors.push(`${where} must be an object`);
      return;
    }
    if (!nonEmptyString(e.id)) errors.push(`${where}.id must be a non-empty string`);
    if (typeof e.status !== "string" || !VALID_STATUS.has(e.status)) {
      errors.push(`${where}.status must be "passed" or "failed"`);
    }
    if (e.scenarioDigest !== null && typeof e.scenarioDigest !== "string") {
      errors.push(`${where}.scenarioDigest must be a string or null`);
    }
    if (!Array.isArray(e.warningCodes)) {
      errors.push(`${where}.warningCodes must be an array`);
    }
    collectEntrySummary(e.summary, where, errors);
  });
}

/**
 * Collect EVERY structural problem with a candidate suite index (never throws).
 * When there are none, the input is a structurally valid {@link BacktestSuiteIndex}.
 */
export function collectSuiteIndexIssues(
  input: unknown,
): { ok: true; index: BacktestSuiteIndex } | { ok: false; errors: string[] } {
  const errors: Errors = [];

  if (!isObject(input)) {
    return { ok: false, errors: ["suite index must be a JSON object"] };
  }
  if (!nonEmptyString(input.schemaVersion)) errors.push("schemaVersion must be a non-empty string");
  if (input.name !== null && typeof input.name !== "string") {
    errors.push("name must be a string or null");
  }
  collectSummary(input.summary, errors);
  collectEntries(input.entries, errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, index: input as unknown as BacktestSuiteIndex };
}

/**
 * Validate that `input` is a structurally valid {@link BacktestSuiteIndex},
 * returning the narrowed index or throwing {@link BacktestSuiteIndexError} with the
 * first problem. Thin throwing wrapper over {@link collectSuiteIndexIssues}.
 */
export function validateBacktestSuiteIndex(input: unknown): BacktestSuiteIndex {
  const result = collectSuiteIndexIssues(input);
  if (!result.ok) {
    throw new BacktestSuiteIndexError(`invalid backtest suite index: ${result.errors[0]}`);
  }
  return result.index;
}

/** Narrow, never-throwing predicate form for callers that only need a boolean. */
export function isBacktestSuiteIndex(input: unknown): input is BacktestSuiteIndex {
  return collectSuiteIndexIssues(input).ok;
}

// Re-exported element types so suite-diff consumers can import from one place.
export type { BacktestSuiteEntry, BacktestSuiteEntrySummary, BacktestSuiteSummary };
