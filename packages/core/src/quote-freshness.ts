/**
 * QUOTE FRESHNESS (Sprint 93) — one pure evaluator, shared by the transaction builder, the
 * execution layer, and the CLI, so that "is this quote fresh?" has exactly ONE answer everywhere.
 *
 * Honesty rules, all fail-closed:
 *   - there is NO default age cap: a missing/invalid cap is `cap-missing` and NOT fresh
 *     (a hidden default would falsely imply safety);
 *   - a missing timestamp is NOT fresh (`missing-timestamp`) — the absence of a quote can never
 *     make anything executable;
 *   - a malformed timestamp is NOT fresh (`malformed-timestamp`);
 *   - a FUTURE timestamp is NOT fresh (`future-timestamp`) — a clock that disagrees with the
 *     provenance is a reason to stop, not to round in the operator's favor;
 *   - only a parseable, past timestamp whose age is within the explicit cap is `fresh`.
 */

export const QUOTE_FRESHNESS_VERDICTS = [
  "fresh",
  "stale",
  "missing-timestamp",
  "malformed-timestamp",
  "future-timestamp",
  "cap-missing",
] as const;
export type QuoteFreshnessVerdict = (typeof QUOTE_FRESHNESS_VERDICTS)[number];

export interface QuoteFreshnessInput {
  /** The quote's fetched/observed ISO-8601 timestamp (provenance). */
  fetchedAt: string | null | undefined;
  /** The evaluation wall-clock in epoch milliseconds. */
  nowMs: number;
  /** The EXPLICIT operator age cap in milliseconds. No default exists by design. */
  maxAgeMs: number | null | undefined;
}

export interface QuoteFreshnessResult {
  /** True ONLY for the `fresh` verdict. */
  fresh: boolean;
  verdict: QuoteFreshnessVerdict;
  /** The computed age in ms (negative for future timestamps); null when not computable. */
  ageMs: number | null;
  /** Operator-readable explanation. */
  detail: string;
}

/** A plausible ISO-8601 timestamp shape (Date.parse alone accepts far too much). */
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

/** Evaluate one quote's freshness. Pure; fail-closed on every uncertain input. */
export function evaluateQuoteFreshness(input: QuoteFreshnessInput): QuoteFreshnessResult {
  const capValid =
    typeof input.maxAgeMs === "number" && Number.isInteger(input.maxAgeMs) && input.maxAgeMs > 0;
  if (!capValid) {
    return {
      fresh: false,
      verdict: "cap-missing",
      ageMs: null,
      detail: "an explicit positive max quote age (ms) is required — there is no default cap by design",
    };
  }
  if (typeof input.fetchedAt !== "string" || input.fetchedAt.trim().length === 0) {
    return {
      fresh: false,
      verdict: "missing-timestamp",
      ageMs: null,
      detail: "the quote carries no fetchedAt timestamp — no quote can make anything executable",
    };
  }
  const trimmed = input.fetchedAt.trim();
  const parsed = Date.parse(trimmed);
  if (!ISO_TIMESTAMP_RE.test(trimmed) || Number.isNaN(parsed)) {
    return {
      fresh: false,
      verdict: "malformed-timestamp",
      ageMs: null,
      detail: "the quote's fetchedAt timestamp is not a parseable ISO-8601 instant — refused, not guessed",
    };
  }
  const ageMs = input.nowMs - parsed;
  if (ageMs < 0) {
    return {
      fresh: false,
      verdict: "future-timestamp",
      ageMs,
      detail: `the quote's fetchedAt is ${-ageMs}ms in the FUTURE — clock disagreement blocks, it never rounds in the operator's favor`,
    };
  }
  if (ageMs > (input.maxAgeMs as number)) {
    return {
      fresh: false,
      verdict: "stale",
      ageMs,
      detail: `the quote is ${ageMs}ms old — over the explicit ${input.maxAgeMs}ms cap`,
    };
  }
  return {
    fresh: true,
    verdict: "fresh",
    ageMs,
    detail: `the quote is ${ageMs}ms old — within the explicit ${input.maxAgeMs}ms cap`,
  };
}
