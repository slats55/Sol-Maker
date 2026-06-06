/**
 * Strict, pure validation of a {@link BacktestReport} value parsed from JSON.
 *
 * The report **diff** tool consumes two report JSON files that were produced by a
 * prior `paper:backtest` run. Before diffing them we must be sure each is actually
 * a backtest report (not arbitrary JSON), so the diff reads only well-typed fields
 * and never silently coerces garbage into a "0". This validator refuses anything
 * that is not structurally a report; it does NOT relax or normalize values.
 *
 * Pure and deterministic: no network, no RPC, no wallet, no filesystem, no
 * `Date.now`, no `Math.random`. It does not mutate its input. It is intentionally
 * tolerant of EXTRA fields (forward-compatibility) but strict about the fields the
 * diff reads. The `schemaVersion` string is required to be present and non-empty
 * but is NOT required to equal the current version here — the diff compares the two
 * `schemaVersion` strings itself so it can surface a mismatch rather than refuse.
 */

import type {
  BacktestLintIssue,
  BacktestEquityPoint,
  BacktestPerMintAggregate,
  BacktestReport,
} from "./types.js";

/** Thrown when an `unknown` value is not a structurally valid {@link BacktestReport}. */
export class BacktestReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestReportError";
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
    if (!isFiniteNumber(obj[key])) {
      errors.push(`${parent}.${key} must be a finite number`);
    }
  }
}

function requireObjectField(
  report: Record<string, unknown>,
  key: string,
  errors: Errors,
): Record<string, unknown> | null {
  const value = report[key];
  if (!isObject(value)) {
    errors.push(`${key} must be an object`);
    return null;
  }
  return value;
}

function collectWarnings(value: unknown, errors: Errors): void {
  if (!Array.isArray(value)) {
    errors.push("warnings must be an array");
    return;
  }
  value.forEach((w, i) => {
    if (!isObject(w) || !nonEmptyString(w.code) || typeof w.message !== "string") {
      errors.push(`warnings[${i}] must have a non-empty string code and a string message`);
    } else if (w.path !== undefined && typeof w.path !== "string") {
      errors.push(`warnings[${i}].path must be a string when present`);
    }
  });
}

const EQUITY_NUMBER_FIELDS = [
  "realizedPnlUsd",
  "unrealizedPnlUsd",
  "totalPnlUsd",
  "simulatedNotionalUsd",
  "openPositionCount",
  "closedTradeCount",
] as const;

function collectEquityCurve(value: unknown, errors: Errors): void {
  if (!Array.isArray(value)) {
    errors.push("equityCurve must be an array");
    return;
  }
  value.forEach((e, i) => {
    if (!isObject(e)) {
      errors.push(`equityCurve[${i}] must be an object`);
      return;
    }
    if (!nonEmptyString(e.stepId)) errors.push(`equityCurve[${i}].stepId must be a non-empty string`);
    if (typeof e.at !== "string") errors.push(`equityCurve[${i}].at must be a string`);
    requireFiniteFields(e, `equityCurve[${i}]`, EQUITY_NUMBER_FIELDS, errors);
  });
}

const PER_MINT_NUMBER_FIELDS = [
  "buyFillCount",
  "sellFillCount",
  "openQuantity",
  "realizedPnlUsd",
  "unrealizedPnlUsd",
  "totalPnlUsd",
  "simulatedNotionalUsd",
] as const;

function collectPerMint(value: unknown, errors: Errors): void {
  if (!Array.isArray(value)) {
    errors.push("perMint must be an array");
    return;
  }
  value.forEach((m, i) => {
    if (!isObject(m)) {
      errors.push(`perMint[${i}] must be an object`);
      return;
    }
    if (!nonEmptyString(m.mint)) errors.push(`perMint[${i}].mint must be a non-empty string`);
    requireFiniteFields(m, `perMint[${i}]`, PER_MINT_NUMBER_FIELDS, errors);
  });
}

/**
 * Collect EVERY structural problem with a candidate report (never throws). When
 * there are none, the input is a structurally valid {@link BacktestReport}.
 * Returns the narrowed report so callers do not have to re-cast.
 */
export function collectReportIssues(
  input: unknown,
): { ok: true; report: BacktestReport } | { ok: false; errors: string[] } {
  const errors: Errors = [];

  if (!isObject(input)) {
    return { ok: false, errors: ["report must be a JSON object"] };
  }

  if (!nonEmptyString(input.schemaVersion)) errors.push("schemaVersion must be a non-empty string");
  if (typeof input.scenarioName !== "string") errors.push("scenarioName must be a string");
  if (!nonEmptyString(input.scenarioDigest)) errors.push("scenarioDigest must be a non-empty string");
  requireFiniteFields(input, "report", ["stepCount", "totalCandidateCount", "simulatedNotionalUsd"], errors);

  const fillCounts = requireObjectField(input, "fillCounts", errors);
  if (fillCounts) requireFiniteFields(fillCounts, "fillCounts", ["buyCount", "sellCount"], errors);

  const rejectedCounts = requireObjectField(input, "rejectedCounts", errors);
  if (rejectedCounts) requireFiniteFields(rejectedCounts, "rejectedCounts", ["total"], errors);

  const positionCounts = requireObjectField(input, "positionCounts", errors);
  if (positionCounts) requireFiniteFields(positionCounts, "positionCounts", ["open", "closed"], errors);

  const pnl = requireObjectField(input, "pnl", errors);
  if (pnl) requireFiniteFields(pnl, "pnl", ["realizedUsd", "unrealizedUsd", "totalUsd"], errors);

  collectWarnings(input.warnings, errors);
  collectEquityCurve(input.equityCurve, errors);
  collectPerMint(input.perMint, errors);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, report: input as unknown as BacktestReport };
}

/**
 * Validate that `input` is a structurally valid {@link BacktestReport}, returning
 * the narrowed report or throwing {@link BacktestReportError} with the first
 * problem. Thin throwing wrapper over {@link collectReportIssues} so the throwing
 * and non-throwing paths can never disagree.
 */
export function validateBacktestReport(input: unknown): BacktestReport {
  const result = collectReportIssues(input);
  if (!result.ok) {
    throw new BacktestReportError(`invalid backtest report: ${result.errors[0]}`);
  }
  return result.report;
}

/** Narrow, never-throwing predicate form for callers that only need a boolean. */
export function isBacktestReport(input: unknown): input is BacktestReport {
  return collectReportIssues(input).ok;
}

// Re-exported element types so diff consumers can import everything from one place.
export type { BacktestLintIssue, BacktestEquityPoint, BacktestPerMintAggregate };
