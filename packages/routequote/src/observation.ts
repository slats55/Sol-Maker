/**
 * Read-only **ROUTE QUOTE OBSERVATION** input (`routequote.observation.input.v1`, Sprint 91 —
 * the operator-supplied quote file the S89 design stub authorizes as the FIRST quote source).
 *
 * A quote observation is a LABEL-ONLY record that an operator (or a future, separately-reviewed
 * read-only fetcher) observed — or failed to observe — a possible route/quote for one candidate
 * mint. It is never a transaction, never an instruction, never executable, and it carries NO
 * system time (an `observedAtLabel` is an operator-authored LABEL, nothing else):
 *
 *   - The outcome set is CLOSED ({@link ROUTE_QUOTE_STATUSES}): `quote-observed`, `unavailable`,
 *     `blocked`, `error`, `unsupported`. There is no "executable", no "ready-to-trade", no
 *     "live-ready" — and there never will be in this schema.
 *   - `quote-observed` REQUIRES validated input/output mints (the output mint must equal the
 *     candidate mint — a quote for a different token is a contradiction, refused). Every other
 *     status must carry NULL quote facts: a fact without an observation is refused, never
 *     defaulted.
 *   - The v1 schema is CLOSED: unknown keys and sensitive-named keys are refused outright, and
 *     every label value must survive the shared redactor UNCHANGED — a key-shaped value can never
 *     ride along on an observation (and is never echoed back).
 *
 * Pure module: no filesystem, no network, no RPC, no wallet, no wall-clock.
 */

import { redactString, isSensitiveKey } from "@soulmaker/security";
import { parseMintAddress } from "@soulmaker/sniper";

/** Stable schema identifier for the v1 quote observation input. Bump only on a breaking change. */
export const ROUTE_QUOTE_OBSERVATION_INPUT_SCHEMA_VERSION = "routequote.observation.input.v1";

/** The CLOSED per-observation outcome set. Nothing here can ever mean "executable". */
export const ROUTE_QUOTE_STATUSES = [
  "quote-observed",
  "unavailable",
  "blocked",
  "error",
  "unsupported",
] as const;

/** One of the closed quote observation outcomes. */
export type RouteQuoteStatus = (typeof ROUTE_QUOTE_STATUSES)[number];

const ROUTE_QUOTE_STATUS_SET: ReadonlySet<string> = new Set(ROUTE_QUOTE_STATUSES);

/** Thrown when a quote observation (or downstream routequote input) is structurally invalid. */
export class RouteQuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteQuoteError";
  }
}

/** A validated v1 quote observation (one file = one candidate's observation). */
export interface RouteQuoteObservationInput {
  schemaVersion: string;
  /** Where the observation came from (kebab-case label, e.g. "operator-supplied"). */
  source: string;
  /** The candidate mint this observation is FOR (validated; secret-length input refused). */
  candidateMint: string;
  quoteStatus: RouteQuoteStatus;
  /** Validated mint labels — required for `quote-observed`, null for every other status. */
  inputMint: string | null;
  outputMint: string | null;
  /** Optional LABEL-only facts (never parsed as money; only allowed when `quote-observed`). */
  amountInLabel: string | null;
  amountOutLabel: string | null;
  venueLabel: string | null;
  feeLabel: string | null;
  /** An operator-authored LABEL of when the quote was observed — never system time. */
  observedAtLabel: string | null;
  /** Why the status is not `quote-observed` (required for blocked/error/unsupported). */
  statusReason: string | null;
  notes: string[];
}

const OBSERVATION_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "source",
  "candidateMint",
  "quoteStatus",
  "inputMint",
  "outputMint",
  "amountInLabel",
  "amountOutLabel",
  "venueLabel",
  "feeLabel",
  "observedAtLabel",
  "statusReason",
  "notes",
]);

/** The five optional label fields a `quote-observed` observation may carry (stable order). */
const OBSERVED_LABEL_FIELDS = ["amountInLabel", "amountOutLabel", "venueLabel", "feeLabel", "observedAtLabel"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The v1 schema is CLOSED: refuse sensitive-named keys pointedly, and any unknown key. */
function assertClosedKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, where: string): void {
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) {
      throw new RouteQuoteError(
        `${where} carries sensitive-named field "${key}" — key material can never ride along on a quote observation`,
      );
    }
    if (!allowed.has(key)) {
      throw new RouteQuoteError(
        `${where} carries unknown field "${key}" — the v1 quote observation schema is CLOSED; transaction-, signing-, sending-, or any other foreign field is refused`,
      );
    }
  }
}

/** Maximum length of any single label value (a quote label is a short human string, never a blob). */
export const ROUTE_QUOTE_MAX_LABEL_LENGTH = 200;

/**
 * Validate one optional label value: null/absent stays null; a string must be non-empty after
 * trimming, bounded, and must survive the shared redactor UNCHANGED — a secret-shaped value is
 * refused and NEVER echoed back.
 */
export function safeQuoteLabel(value: unknown, name: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new RouteQuoteError(`${name} must be a string or null`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new RouteQuoteError(`${name} must be a non-empty string or null`);
  if (trimmed.length > ROUTE_QUOTE_MAX_LABEL_LENGTH) {
    throw new RouteQuoteError(`${name} must be at most ${ROUTE_QUOTE_MAX_LABEL_LENGTH} characters`);
  }
  if (redactString(trimmed) !== trimmed) {
    throw new RouteQuoteError(`${name} carries a secret-shaped value — refused (and never echoed)`);
  }
  return trimmed;
}

/**
 * Strictly validate a value as a {@link RouteQuoteObservationInput} and return it in canonical
 * form (labels trimmed). Enforces the CLOSED key set, the closed status set, the
 * quote-observed/null-facts contract (facts require an observation; the output mint must equal
 * the candidate mint), validated mints (secret-length input refused, never echoed), and
 * redaction-stable labels. Throws {@link RouteQuoteError} on the first problem. Pure.
 */
export function validateRouteQuoteObservationInput(value: unknown): RouteQuoteObservationInput {
  if (!isObject(value)) throw new RouteQuoteError("quote observation must be a JSON object");
  assertClosedKeys(value, OBSERVATION_KEYS, "quote observation");
  if (value.schemaVersion !== ROUTE_QUOTE_OBSERVATION_INPUT_SCHEMA_VERSION) {
    throw new RouteQuoteError(
      `quote observation.schemaVersion must be "${ROUTE_QUOTE_OBSERVATION_INPUT_SCHEMA_VERSION}"`,
    );
  }
  if (typeof value.source !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value.source)) {
    throw new RouteQuoteError('quote observation.source must be a kebab-case label (e.g. "operator-supplied")');
  }
  if (isSensitiveKey(value.source)) {
    throw new RouteQuoteError("quote observation.source is sensitive-shaped — a source label can never look like key material");
  }
  let candidateMint: string;
  try {
    candidateMint = parseMintAddress(value.candidateMint);
  } catch (err) {
    // parseMintAddress never echoes secret-length input; safe to relay its message.
    throw new RouteQuoteError(`quote observation.candidateMint: ${(err as Error).message}`);
  }
  if (typeof value.quoteStatus !== "string" || !ROUTE_QUOTE_STATUS_SET.has(value.quoteStatus)) {
    throw new RouteQuoteError(`quote observation.quoteStatus must be one of ${ROUTE_QUOTE_STATUSES.join("|")}`);
  }
  const quoteStatus = value.quoteStatus as RouteQuoteStatus;

  const labels: Record<(typeof OBSERVED_LABEL_FIELDS)[number], string | null> = {
    amountInLabel: safeQuoteLabel(value.amountInLabel, "quote observation.amountInLabel"),
    amountOutLabel: safeQuoteLabel(value.amountOutLabel, "quote observation.amountOutLabel"),
    venueLabel: safeQuoteLabel(value.venueLabel, "quote observation.venueLabel"),
    feeLabel: safeQuoteLabel(value.feeLabel, "quote observation.feeLabel"),
    observedAtLabel: safeQuoteLabel(value.observedAtLabel, "quote observation.observedAtLabel"),
  };
  const statusReason = safeQuoteLabel(value.statusReason, "quote observation.statusReason");

  let inputMint: string | null = null;
  let outputMint: string | null = null;
  if (quoteStatus === "quote-observed") {
    for (const f of ["inputMint", "outputMint"] as const) {
      if (value[f] === undefined || value[f] === null) {
        throw new RouteQuoteError(`quote observation.${f} is required when quoteStatus is "quote-observed"`);
      }
      try {
        const parsed = parseMintAddress(value[f]);
        if (f === "inputMint") inputMint = parsed;
        else outputMint = parsed;
      } catch (err) {
        throw new RouteQuoteError(`quote observation.${f}: ${(err as Error).message}`);
      }
    }
    if (outputMint !== candidateMint) {
      throw new RouteQuoteError(
        "quote observation.outputMint must equal candidateMint — a quote for a different token is a contradiction, refused",
      );
    }
    if (statusReason !== null) {
      throw new RouteQuoteError('quote observation.statusReason must be null when quoteStatus is "quote-observed"');
    }
  } else {
    for (const f of ["inputMint", "outputMint"] as const) {
      if (value[f] !== undefined && value[f] !== null) {
        throw new RouteQuoteError(
          `quote observation.${f} must be null unless quoteStatus is "quote-observed" — a quote fact without an observation is refused`,
        );
      }
    }
    for (const f of OBSERVED_LABEL_FIELDS) {
      if (labels[f] !== null) {
        throw new RouteQuoteError(
          `quote observation.${f} must be null unless quoteStatus is "quote-observed" — a quote fact without an observation is refused`,
        );
      }
    }
    if ((quoteStatus === "blocked" || quoteStatus === "error" || quoteStatus === "unsupported") && statusReason === null) {
      throw new RouteQuoteError(`quote observation.statusReason is required when quoteStatus is "${quoteStatus}"`);
    }
  }

  if (value.notes !== undefined && !Array.isArray(value.notes)) {
    throw new RouteQuoteError("quote observation.notes must be an array of strings when present");
  }
  const notes = ((value.notes as unknown[] | undefined) ?? []).map((n, i) => {
    const note = safeQuoteLabel(n, `quote observation.notes[${i}]`);
    if (note === null) throw new RouteQuoteError(`quote observation.notes[${i}] must be a non-empty string`);
    return note;
  });
  if (notes.length > 20) throw new RouteQuoteError("quote observation.notes must carry at most 20 entries");

  return {
    schemaVersion: ROUTE_QUOTE_OBSERVATION_INPUT_SCHEMA_VERSION,
    source: value.source,
    candidateMint,
    quoteStatus,
    inputMint,
    outputMint,
    ...labels,
    statusReason,
    notes,
  };
}
