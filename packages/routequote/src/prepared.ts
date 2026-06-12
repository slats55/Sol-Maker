/**
 * Read-only **ROUTE QUOTE PREPARED INPUT** artifact (`routequote.prepared.v1`, Sprint 91).
 *
 * The bridge between operator-supplied quote observation files
 * (`routequote.observation.input.v1`) and the existing S85 route-resolution contract: it pairs
 * each observation to a candidate **BY MINT** against a strictly-validated candidate list, carries
 * the observation VERBATIM, derives the deterministic label-only route fact a future
 * route-resolution build may consume, and refuses everything else:
 *
 *   - an observation whose mint matches NO candidate is REFUSED (unknown mint = contradiction);
 *   - two observations for the same mint are REFUSED (duplicates are never merged);
 *   - a candidate without an observation stays honestly `unavailable` (warned, never invented);
 *   - every observed entry carries the MANDATORY caveat set ({@link ROUTE_QUOTE_CAVEATS}) — a
 *     quote is an observation, never an executable, never a transaction, never an order.
 *
 * `phase7LiveTradingReady` is a literal false; the artifact carries `readOnly`/`notExecutable`/
 * `neverSigns`/`neverSends` literals and the validator refuses anything else. Destination facts
 * are ALWAYS null in v1: a quote observation does not validate a destination, so none is invented.
 *
 * Pure module: no filesystem, no network, no RPC, no wallet, no wall-clock.
 */

import { redactString, isSensitiveKey } from "@soulmaker/security";
import { parseMintAddress, validateSniperCandidateList, type SniperCandidateList } from "@soulmaker/sniper";
import {
  RouteQuoteError,
  validateRouteQuoteObservationInput,
  type RouteQuoteObservationInput,
  type RouteQuoteStatus,
} from "./observation.js";

/** Stable schema identifier for the v1 prepared routequote artifact. Bump only on a breaking change. */
export const ROUTE_QUOTE_PREPARED_SCHEMA_VERSION = "routequote.prepared.v1";

/** The banner that prefixes every prepared routequote artifact (required label). */
export const ROUTE_QUOTE_PREPARED_BANNER =
  "READ-ONLY ROUTE QUOTE PREPARED INPUT (OBSERVATION ONLY — NOT EXECUTABLE, NOT A TRANSACTION, NOT AN ORDER, NOT LIVE TRADING; NEVER SIGNS, NEVER SENDS)";

/** The fixed resolver id quote-derived route facts enter the route-resolution contract under.
 * Kebab-case, never sensitive-named, never a capability — it names a PROVENANCE, not an engine. */
export const ROUTE_QUOTE_RESOLVER_ID = "routequote-operator-supplied";

/** The MANDATORY caveat set every observed quote carries (stable order; validator-enforced). */
export const ROUTE_QUOTE_CAVEATS: readonly string[] = [
  "Read-only quote observation only — NOT executable, NOT a transaction, NOT an order.",
  "No wallet, no keys, no signing, no sending — nothing here can execute a route.",
  "A quote may expire at any moment; slippage is NOT guaranteed; the route was NOT simulated.",
  "Live chain state may have changed since observation — the live-state caveat always applies downstream.",
  "Never a buy recommendation, never a profitability claim, never live-trading readiness.",
];

/** Required disclaimer statements carried by every prepared routequote artifact (stable order). */
export const ROUTE_QUOTE_PREPARED_DISCLAIMERS: readonly string[] = [
  "READ-ONLY ROUTE QUOTE PREPARED INPUT — operator-supplied quote observations paired to candidates BY MINT, carried verbatim with deterministic label-only route facts.",
  "An observed quote is an OBSERVATION: it proves a route/quote was visible at some point, never that one is executable now — and nothing here can execute anything.",
  "A candidate without an observation stays honestly unavailable; a quote for an unknown mint or a duplicate mint is refused outright, never merged.",
  "Destination facts are ALWAYS null in v1: a quote observation validates no destination, so none is invented.",
  "Not a live result. Not a trade signal. Not financial advice. Not a profitability claim.",
  "No wallet, key, signing, sending, swap execution, or transaction construction is involved anywhere in this artifact.",
];

/** One candidate's prepared quote state. */
export interface RouteQuotePreparedEntry {
  candidateId: string;
  /** The canonical validated candidate mint. */
  mint: string;
  quoteStatus: RouteQuoteStatus;
  /** Whether an observation file was supplied for this candidate at all. */
  observationSupplied: boolean;
  /** The validated observation carried VERBATIM (null when none was supplied). */
  observation: RouteQuoteObservationInput | null;
  /** Deterministic label-only route fact (non-null iff `quote-observed`; recomputed by the validator). */
  routeLabel: string | null;
  /** The observation's fee label verbatim (only when `quote-observed`). */
  feeLabel: string | null;
  /** ALWAYS null in v1 — a quote observation validates no destination, so none is invented. */
  destinationLabel: string | null;
  /** The observation's status reason verbatim (null when observed or when none was supplied). */
  statusReason: string | null;
  /** The mandatory caveat set when observed; empty otherwise (validator-enforced). */
  caveats: string[];
  warnings: string[];
}

/** The full, deterministic, JSON-serializable prepared routequote artifact. */
export interface RouteQuotePrepared {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  readOnly: true;
  notExecutable: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  neverSigns: true;
  neverSends: true;
  /** ALWAYS false — a quote observation can never claim live-trading readiness (validated literal). */
  phase7LiveTradingReady: false;
  disclaimers: string[];
  sourceLabel: string | null;
  candidateListRef: string | null;
  /** The fixed provenance id ({@link ROUTE_QUOTE_RESOLVER_ID}). */
  resolverId: string;
  /** The mandatory caveat set ({@link ROUTE_QUOTE_CAVEATS}), verbatim. */
  caveats: string[];
  entryCount: number;
  entries: RouteQuotePreparedEntry[];
  observedCount: number;
  unavailableCount: number;
  blockedCount: number;
  errorCount: number;
  unsupportedCount: number;
  hasWarnings: boolean;
  validationStatus: "valid" | "valid-with-warnings";
  warnings: string[];
  notes: string[];
}

/** Everything {@link normalizeRouteQuotePrepared} accepts. */
export interface NormalizeRouteQuotePreparedInput {
  /** The candidate list (`sniper.candidate.list.v1`) to pair against. Required; strictly validated. */
  candidateList?: unknown;
  /** Raw quote observation values (each strictly validated; paired to candidates by mint). */
  observations?: unknown[];
  /** Optional operator label for the whole prepared bundle. */
  sourceLabel?: string | null;
  /** Optional label/path of the candidate list this input pairs with (a string label only). */
  candidateListRef?: string | null;
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optLabel(value: unknown, name: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new RouteQuoteError(`${name} must be a string when present`);
  const trimmed = value.trim();
  if (trimmed.length > 0 && redactString(trimmed) !== trimmed) {
    throw new RouteQuoteError(`${name} carries a secret-shaped value — refused (and never echoed)`);
  }
  return trimmed.length > 0 ? trimmed : null;
}

/** The v1 schema is CLOSED: refuse sensitive-named keys pointedly, and any unknown key. */
function assertClosedKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, where: string): void {
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) {
      throw new RouteQuoteError(
        `${where} carries sensitive-named field "${key}" — key material can never ride along on a routequote artifact`,
      );
    }
    if (!allowed.has(key)) {
      throw new RouteQuoteError(
        `${where} carries unknown field "${key}" — the v1 prepared routequote schema is CLOSED; transaction-, signing-, sending-, or any other foreign field is refused`,
      );
    }
  }
}

/**
 * The deterministic label-only route fact for one observed quote. Pure — the validator recomputes
 * this from the verbatim observation and refuses a mismatching stored label.
 */
export function deriveRouteQuoteLabel(obs: RouteQuoteObservationInput): string {
  const venue = obs.venueLabel !== null ? ` via ${obs.venueLabel}` : "";
  const amounts =
    obs.amountInLabel !== null || obs.amountOutLabel !== null
      ? ` [${obs.amountInLabel ?? "?"} -> ${obs.amountOutLabel ?? "?"}]`
      : "";
  const observedAt = obs.observedAtLabel !== null ? ` @ ${obs.observedAtLabel}` : "";
  return `read-only quote (${obs.source}): ${obs.inputMint ?? "?"} -> ${obs.outputMint ?? "?"}${venue}${amounts}${observedAt} — NOT executable`;
}

/** Recompute the artifact tallies from its entries (shared by normalize + validate). */
function tally(entries: readonly RouteQuotePreparedEntry[]): {
  observedCount: number;
  unavailableCount: number;
  blockedCount: number;
  errorCount: number;
  unsupportedCount: number;
} {
  return {
    observedCount: entries.filter((e) => e.quoteStatus === "quote-observed").length,
    unavailableCount: entries.filter((e) => e.quoteStatus === "unavailable").length,
    blockedCount: entries.filter((e) => e.quoteStatus === "blocked").length,
    errorCount: entries.filter((e) => e.quoteStatus === "error").length,
    unsupportedCount: entries.filter((e) => e.quoteStatus === "unsupported").length,
  };
}

// --- normalize ----------------------------------------------------------------

/**
 * Pair raw quote observation values to a strictly-validated candidate list **BY MINT** and build
 * the canonical {@link RouteQuotePrepared}. Pure and non-mutating. Each observation is strictly
 * validated; an observation whose mint matches no candidate is REFUSED; two observations for the
 * same mint are REFUSED; a candidate without an observation stays honestly `unavailable` and is
 * warned. Throws {@link RouteQuoteError} on any structural problem.
 */
export function normalizeRouteQuotePrepared(input: NormalizeRouteQuotePreparedInput = {}): RouteQuotePrepared {
  if (!isObject(input)) throw new RouteQuoteError("routequote prepare input must be an object");
  if (input.candidateList === undefined || input.candidateList === null) {
    throw new RouteQuoteError("routequote prepare input.candidateList is required (a sniper.candidate.list.v1)");
  }
  let list: SniperCandidateList;
  try {
    list = validateSniperCandidateList(input.candidateList);
  } catch (err) {
    throw new RouteQuoteError(`candidate list is invalid: ${(err as Error).message}`);
  }
  if (input.observations !== undefined && !Array.isArray(input.observations)) {
    throw new RouteQuoteError("routequote prepare input.observations must be an array when present");
  }

  const observations = ((input.observations as unknown[] | undefined) ?? []).map((raw, i) => {
    try {
      return validateRouteQuoteObservationInput(raw);
    } catch (err) {
      throw new RouteQuoteError(`observations[${i}]: ${(err as Error).message}`);
    }
  });

  const candidateByMint = new Map(list.candidates.map((c) => [c.mint, c]));
  const observationByMint = new Map<string, RouteQuoteObservationInput>();
  observations.forEach((obs, i) => {
    if (!candidateByMint.has(obs.candidateMint)) {
      throw new RouteQuoteError(
        `observations[${i}] is for mint ${obs.candidateMint}, which matches NO candidate in the list — an unknown-mint quote is refused`,
      );
    }
    if (observationByMint.has(obs.candidateMint)) {
      throw new RouteQuoteError(
        `observations[${i}] duplicates mint ${obs.candidateMint} — two observations for the same candidate are refused, never merged`,
      );
    }
    observationByMint.set(obs.candidateMint, obs);
  });

  const entries: RouteQuotePreparedEntry[] = list.candidates.map((c) => {
    const obs = observationByMint.get(c.mint) ?? null;
    if (obs === null) {
      return {
        candidateId: c.candidateId,
        mint: c.mint,
        quoteStatus: "unavailable",
        observationSupplied: false,
        observation: null,
        routeLabel: null,
        feeLabel: null,
        destinationLabel: null,
        statusReason: null,
        caveats: [],
        warnings: ["no quote observation was supplied for this candidate — honestly unavailable (never invented)"],
      };
    }
    const observed = obs.quoteStatus === "quote-observed";
    return {
      candidateId: c.candidateId,
      mint: c.mint,
      quoteStatus: obs.quoteStatus,
      observationSupplied: true,
      observation: obs,
      routeLabel: observed ? deriveRouteQuoteLabel(obs) : null,
      feeLabel: observed ? obs.feeLabel : null,
      destinationLabel: null,
      statusReason: obs.statusReason,
      caveats: observed ? [...ROUTE_QUOTE_CAVEATS] : [],
      warnings: observed
        ? []
        : [`quote observation reported "${obs.quoteStatus}"${obs.statusReason !== null ? `: ${obs.statusReason}` : ""}`],
    };
  });

  const counts = tally(entries);
  const reportWarnings: string[] = [];
  const uncovered = entries.filter((e) => !e.observationSupplied);
  if (uncovered.length > 0) {
    reportWarnings.push(
      `${uncovered.length} candidate(s) have no quote observation: ${uncovered.map((e) => e.candidateId).join(", ")}.`,
    );
  }
  const notObserved = entries.filter((e) => e.observationSupplied && e.quoteStatus !== "quote-observed");
  if (notObserved.length > 0) {
    reportWarnings.push(
      `${notObserved.length} supplied observation(s) did not observe a quote (${notObserved.map((e) => `${e.candidateId}: ${e.quoteStatus}`).join(", ")}).`,
    );
  }
  const hasWarnings = reportWarnings.length > 0 || entries.some((e) => e.warnings.length > 0);

  return {
    schemaVersion: ROUTE_QUOTE_PREPARED_SCHEMA_VERSION,
    banner: ROUTE_QUOTE_PREPARED_BANNER,
    paperOnly: true,
    readOnly: true,
    notExecutable: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    neverSigns: true,
    neverSends: true,
    phase7LiveTradingReady: false,
    disclaimers: [...ROUTE_QUOTE_PREPARED_DISCLAIMERS],
    sourceLabel: optLabel(input.sourceLabel, "routequote prepare input.sourceLabel"),
    candidateListRef: optLabel(input.candidateListRef, "routequote prepare input.candidateListRef"),
    resolverId: ROUTE_QUOTE_RESOLVER_ID,
    caveats: [...ROUTE_QUOTE_CAVEATS],
    entryCount: entries.length,
    entries,
    ...counts,
    hasWarnings,
    validationStatus: hasWarnings ? "valid-with-warnings" : "valid",
    warnings: reportWarnings,
    notes: [
      "Quote observations are paired to candidates BY MINT against the strictly-validated candidate list — an unknown-mint or duplicate observation is refused at build time.",
      "Observed quotes carry the mandatory caveat set verbatim; a candidate without an observation stays honestly unavailable.",
      "Read-only provenance only: nothing here can execute, sign, send, or construct a transaction.",
    ],
  };
}

// --- validation (backstop) ---------------------------------------------------

const ARTIFACT_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "banner",
  "paperOnly",
  "readOnly",
  "notExecutable",
  "notLiveResult",
  "notFinancialAdvice",
  "notProfitabilityClaim",
  "neverSigns",
  "neverSends",
  "phase7LiveTradingReady",
  "disclaimers",
  "sourceLabel",
  "candidateListRef",
  "resolverId",
  "caveats",
  "entryCount",
  "entries",
  "observedCount",
  "unavailableCount",
  "blockedCount",
  "errorCount",
  "unsupportedCount",
  "hasWarnings",
  "validationStatus",
  "warnings",
  "notes",
]);

const ENTRY_KEYS: ReadonlySet<string> = new Set([
  "candidateId",
  "mint",
  "quoteStatus",
  "observationSupplied",
  "observation",
  "routeLabel",
  "feeLabel",
  "destinationLabel",
  "statusReason",
  "caveats",
  "warnings",
]);

function validateEntry(value: unknown, where: string): RouteQuotePreparedEntry {
  if (!isObject(value)) throw new RouteQuoteError(`${where} must be an object`);
  assertClosedKeys(value, ENTRY_KEYS, where);
  if (typeof value.candidateId !== "string" || value.candidateId.length === 0) {
    throw new RouteQuoteError(`${where}.candidateId must be a non-empty string`);
  }
  let mint: string;
  try {
    mint = parseMintAddress(value.mint);
  } catch (err) {
    throw new RouteQuoteError(`${where}: ${(err as Error).message}`);
  }
  if (mint !== value.mint) throw new RouteQuoteError(`${where}.mint must be the canonical trimmed form`);
  if (typeof value.observationSupplied !== "boolean") {
    throw new RouteQuoteError(`${where}.observationSupplied must be a boolean`);
  }

  if (value.observationSupplied) {
    let obs: RouteQuoteObservationInput;
    try {
      obs = validateRouteQuoteObservationInput(value.observation);
    } catch (err) {
      throw new RouteQuoteError(`${where}.observation: ${(err as Error).message}`);
    }
    if (obs.candidateMint !== mint) {
      throw new RouteQuoteError(`${where}.observation is for a different mint than this entry — refused`);
    }
    if (value.quoteStatus !== obs.quoteStatus) {
      throw new RouteQuoteError(`${where}.quoteStatus must equal the verbatim observation's quoteStatus`);
    }
    const observed = obs.quoteStatus === "quote-observed";
    const expectedRouteLabel = observed ? deriveRouteQuoteLabel(obs) : null;
    if (value.routeLabel !== expectedRouteLabel) {
      throw new RouteQuoteError(`${where}.routeLabel must equal the recomputed deterministic label (or null when not observed)`);
    }
    if (value.feeLabel !== (observed ? obs.feeLabel : null)) {
      throw new RouteQuoteError(`${where}.feeLabel must equal the verbatim observation's feeLabel (or null when not observed)`);
    }
    if (value.statusReason !== obs.statusReason) {
      throw new RouteQuoteError(`${where}.statusReason must equal the verbatim observation's statusReason`);
    }
    const expectedCaveats = observed ? ROUTE_QUOTE_CAVEATS : [];
    if (!Array.isArray(value.caveats) || JSON.stringify(value.caveats) !== JSON.stringify(expectedCaveats)) {
      throw new RouteQuoteError(
        observed
          ? `${where}.caveats must equal the mandatory caveat set verbatim — an observed quote can never drop a caveat`
          : `${where}.caveats must be empty when no quote was observed`,
      );
    }
  } else {
    if (value.observation !== null) {
      throw new RouteQuoteError(`${where}.observation must be null when observationSupplied is false`);
    }
    if (value.quoteStatus !== "unavailable") {
      throw new RouteQuoteError(`${where}.quoteStatus must be "unavailable" when no observation was supplied — never invented`);
    }
    for (const f of ["routeLabel", "feeLabel", "statusReason"] as const) {
      if (value[f] !== null) throw new RouteQuoteError(`${where}.${f} must be null when no observation was supplied`);
    }
    if (!Array.isArray(value.caveats) || value.caveats.length !== 0) {
      throw new RouteQuoteError(`${where}.caveats must be empty when no observation was supplied`);
    }
  }
  if (value.destinationLabel !== null) {
    throw new RouteQuoteError(
      `${where}.destinationLabel must be null — a v1 quote observation validates no destination, so none may be invented`,
    );
  }
  if (!Array.isArray(value.warnings) || (value.warnings as unknown[]).some((x) => typeof x !== "string")) {
    throw new RouteQuoteError(`${where}.warnings must be an array of strings`);
  }
  return value as unknown as RouteQuotePreparedEntry;
}

/**
 * Strictly validate a value as a {@link RouteQuotePrepared} and return it narrowed. Enforces the
 * literal safety locks (including the always-false `phase7LiveTradingReady`), the CLOSED v1 key
 * sets, the fixed resolver id, the mandatory caveat set verbatim, every entry (observations
 * re-validated; route labels recomputed; duplicates refused), and the recomputed tallies. Throws
 * {@link RouteQuoteError} on the first problem. Pure.
 */
export function validateRouteQuotePrepared(value: unknown): RouteQuotePrepared {
  if (!isObject(value)) throw new RouteQuoteError("prepared routequote must be a JSON object");
  assertClosedKeys(value, ARTIFACT_KEYS, "prepared routequote");
  if (value.schemaVersion !== ROUTE_QUOTE_PREPARED_SCHEMA_VERSION) {
    throw new RouteQuoteError(`prepared routequote.schemaVersion must be "${ROUTE_QUOTE_PREPARED_SCHEMA_VERSION}"`);
  }
  if (value.banner !== ROUTE_QUOTE_PREPARED_BANNER) {
    throw new RouteQuoteError(`prepared routequote.banner must be "${ROUTE_QUOTE_PREPARED_BANNER}"`);
  }
  for (const flag of [
    "paperOnly",
    "readOnly",
    "notExecutable",
    "notLiveResult",
    "notFinancialAdvice",
    "notProfitabilityClaim",
    "neverSigns",
    "neverSends",
  ] as const) {
    if (value[flag] !== true) throw new RouteQuoteError(`prepared routequote.${flag} must be true`);
  }
  if (value.phase7LiveTradingReady !== false) {
    throw new RouteQuoteError(
      "prepared routequote.phase7LiveTradingReady must be literally false — a quote observation can never claim live-trading readiness",
    );
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0 || (value.disclaimers as unknown[]).some((d) => typeof d !== "string")) {
    throw new RouteQuoteError("prepared routequote.disclaimers must be a non-empty array of strings");
  }
  for (const f of ["sourceLabel", "candidateListRef"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new RouteQuoteError(`prepared routequote.${f} must be a string or null`);
    }
  }
  if (value.resolverId !== ROUTE_QUOTE_RESOLVER_ID) {
    throw new RouteQuoteError(`prepared routequote.resolverId must be "${ROUTE_QUOTE_RESOLVER_ID}"`);
  }
  if (!Array.isArray(value.caveats) || JSON.stringify(value.caveats) !== JSON.stringify(ROUTE_QUOTE_CAVEATS)) {
    throw new RouteQuoteError("prepared routequote.caveats must equal the mandatory caveat set verbatim");
  }

  if (!Array.isArray(value.entries)) throw new RouteQuoteError("prepared routequote.entries must be an array");
  const entries = (value.entries as unknown[]).map((e, i) => validateEntry(e, `prepared routequote.entries[${i}]`));
  if (value.entryCount !== entries.length) {
    throw new RouteQuoteError("prepared routequote.entryCount must equal entries length");
  }
  const seenIds = new Set<string>();
  const seenMints = new Set<string>();
  for (const e of entries) {
    if (seenIds.has(e.candidateId)) throw new RouteQuoteError(`prepared routequote duplicates candidateId "${e.candidateId}"`);
    if (seenMints.has(e.mint)) throw new RouteQuoteError(`prepared routequote duplicates mint ${e.mint}`);
    seenIds.add(e.candidateId);
    seenMints.add(e.mint);
  }
  const expected = tally(entries);
  for (const f of ["observedCount", "unavailableCount", "blockedCount", "errorCount", "unsupportedCount"] as const) {
    if (value[f] !== expected[f]) {
      throw new RouteQuoteError(`prepared routequote.${f} must equal the recomputed tally (${expected[f]})`);
    }
  }
  for (const key of ["warnings", "notes"] as const) {
    if (!Array.isArray(value[key]) || (value[key] as unknown[]).some((x) => typeof x !== "string")) {
      throw new RouteQuoteError(`prepared routequote.${key} must be an array of strings`);
    }
  }
  if (typeof value.hasWarnings !== "boolean") throw new RouteQuoteError("prepared routequote.hasWarnings must be a boolean");
  const anyWarning = (value.warnings as string[]).length > 0 || entries.some((e) => e.warnings.length > 0);
  if (value.hasWarnings !== anyWarning) {
    throw new RouteQuoteError("prepared routequote.hasWarnings must mirror the presence of warnings");
  }
  if (value.validationStatus !== "valid" && value.validationStatus !== "valid-with-warnings") {
    throw new RouteQuoteError('prepared routequote.validationStatus must be "valid" | "valid-with-warnings"');
  }
  if ((value.validationStatus === "valid") === (value.hasWarnings as boolean)) {
    throw new RouteQuoteError("prepared routequote.validationStatus must mirror hasWarnings");
  }
  return value as unknown as RouteQuotePrepared;
}

// --- conversion to the route-resolution facts contract -------------------------

/** One label-only route fact (structurally matches the simulation builder's facts contract). */
export interface RouteQuoteFactEntry {
  candidateId: string;
  mint: string;
  routeLabel: string | null;
  destinationLabel: string | null;
  feeLabel: string | null;
}

/** Quote-derived route facts ready for the S85 route-resolution builder's `routeFacts` input. */
export interface RouteQuoteFacts {
  resolverId: string;
  facts: RouteQuoteFactEntry[];
}

/**
 * Convert a validated {@link RouteQuotePrepared} into the label-only route facts the S85
 * route-resolution builder accepts: ONLY `quote-observed` entries produce facts (an unavailable,
 * blocked, error, or unsupported entry contributes nothing — never defaulted), and destination
 * facts stay null. Pure.
 */
export function toRouteQuoteFacts(prepared: RouteQuotePrepared): RouteQuoteFacts {
  return {
    resolverId: prepared.resolverId,
    facts: prepared.entries
      .filter((e) => e.quoteStatus === "quote-observed")
      .map((e) => ({
        candidateId: e.candidateId,
        mint: e.mint,
        routeLabel: e.routeLabel,
        destinationLabel: null,
        feeLabel: e.feeLabel,
      })),
  };
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatRouteQuotePrepared}. */
export interface FormatRouteQuotePreparedOptions {
  label?: string;
  /** Cap on the number of entry rows printed (default 100; the rest are summarized). */
  maxRows?: number;
}

/**
 * Render a redacted, stable, human-readable prepared routequote summary. Deterministic and
 * path-stable. Leads with the OBSERVATION-ONLY banner, the per-status tallies, each entry's quote
 * state with its derived route label and warnings, and closes with the mandatory caveats and
 * disclaimers. The whole output is passed through the shared redactor.
 */
export function formatRouteQuotePrepared(
  artifact: RouteQuotePrepared,
  opts: FormatRouteQuotePreparedOptions = {},
): string {
  const maxRows = opts.maxRows ?? 100;
  const header = "READ-ONLY ROUTE QUOTE PREPARED INPUT — OBSERVATION ONLY (not executable; not a transaction; not an order; never signs; never sends; never authorizes live trading)";
  const lines: string[] = [header, "=".repeat(header.length)];
  if (opts.label) lines.push(`label:      ${opts.label}`);
  lines.push(`source:     ${artifact.sourceLabel ?? "(none)"}`);
  lines.push(`candidates: ${artifact.candidateListRef ?? "(no list reference)"}`);
  lines.push(`resolver:   ${artifact.resolverId} (provenance id — names a source, never an engine)`);
  lines.push(`entries:    ${artifact.entryCount}`);
  lines.push(`status:     ${artifact.validationStatus}`);

  lines.push("");
  lines.push("Quote outcomes (closed set — nothing here can mean executable):");
  lines.push(`- quote-observed: ${artifact.observedCount}`);
  lines.push(`- unavailable:    ${artifact.unavailableCount}`);
  lines.push(`- blocked:        ${artifact.blockedCount}`);
  lines.push(`- error:          ${artifact.errorCount}`);
  lines.push(`- unsupported:    ${artifact.unsupportedCount}`);

  lines.push("");
  lines.push("Entries:");
  if (artifact.entries.length === 0) {
    lines.push("- (none)");
  } else {
    for (const e of artifact.entries.slice(0, maxRows)) {
      lines.push(`- ${e.candidateId}  ${e.mint}  [${e.quoteStatus}]`);
      if (e.routeLabel !== null) lines.push(`    route: ${e.routeLabel}`);
      if (e.feeLabel !== null) lines.push(`    fee:   ${e.feeLabel} (label only; not guaranteed)`);
      if (e.statusReason !== null) lines.push(`    reason: ${e.statusReason}`);
      for (const w of e.warnings) lines.push(`    · ${w}`);
    }
    const hidden = artifact.entries.length - Math.min(artifact.entries.length, maxRows);
    if (hidden > 0) lines.push(`- … and ${hidden} more (summarized; see the artifact JSON for the full set)`);
  }

  if (artifact.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of artifact.warnings) lines.push(`- ${w}`);
  }

  lines.push("");
  lines.push("Mandatory caveats (carried verbatim by every observed quote):");
  for (const c of artifact.caveats) lines.push(`- ${c}`);

  lines.push("");
  lines.push("Notes:");
  for (const note of artifact.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of artifact.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
