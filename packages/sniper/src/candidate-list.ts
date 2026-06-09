/**
 * Deterministic, offline, **PAPER-only** SNIPER CANDIDATE LIST (Phase 5+ intake layer).
 *
 * Before a sniper bot can score, paper-simulate, or (much later, behind heavy safety work) act on a
 * token, it needs a safe, validated INTAKE layer: a list of candidate mints an operator is watching,
 * each with optional operator-supplied context. This module is that layer. It is **pure** and does NO
 * filesystem / network / RPC / wallet work of its own — the CLI reads a local JSON file and hands the
 * parsed value here. Every mint is validated as a real 32-byte Solana **public** key via the pure
 * {@link parseMintAddress}, which REFUSES secret-length / private-key-like input, so a private key or
 * seed phrase can never be pasted into a candidate list and silently accepted.
 *
 * `normalizeSniperCandidateList(input)` accepts operator-friendly raw input (a `{candidates: [...]}`
 * object, with or without a schemaVersion) and produces a canonical, byte-stable
 * `sniper.candidate.list.v1` artifact: validated mints, unique candidate ids, duplicate mints
 * surfaced as warnings (allowed — the same mint may be observed from two sources), and a stable
 * field shape. It carries NO wall-clock time (any "observed at" / "created" value is an
 * operator-supplied STRING, never system time), follows no social links, and fetches nothing.
 *
 * This is bookkeeping over injected, operator-supplied data — NOT live data, NOT verified on-chain
 * facts (a later read-only preflight does that), NOT a trade signal, NOT advice, and NOT a
 * profitability claim. Nothing here holds a key, or builds/signs/simulates/sends a transaction.
 */

import { redactString } from "@soulmaker/security";
import { parseMintAddress, isValidMintAddress } from "./mint-address.js";

/** Stable schema identifier for the candidate list. Bump only on a breaking change. */
export const SNIPER_CANDIDATE_LIST_SCHEMA_VERSION = "sniper.candidate.list.v1";

/** The banner that prefixes every candidate list (required label). */
export const SNIPER_CANDIDATE_LIST_BANNER = "SIMULATED PAPER-ONLY SNIPER CANDIDATE LIST";

/** Required disclaimer statements carried by every candidate list (stable order). */
export const SNIPER_CANDIDATE_LIST_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SNIPER CANDIDATE LIST — a deterministic intake list of operator-supplied candidate mints.",
  "Operator-supplied data only: any liquidity / market-cap / volume / social / observed-at value is supplied by the operator and is NOT verified on-chain here (a later read-only preflight does that).",
  "Every mint is validated as a 32-byte Solana public key; secret-length / private-key-like input is refused.",
  "It follows no social links, fetches nothing, and carries no wall-clock time.",
  "Not live data.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this list.",
];

/** Thrown when candidate-list INPUT or a produced list is structurally invalid. */
export class SniperCandidateListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperCandidateListError";
  }
}

// --- input -------------------------------------------------------------------

/**
 * One operator-supplied candidate (raw input shape). All fields beyond id+mint are optional. Optional
 * fields accept `null` as well as `undefined` so {@link normalizeSniperCandidateList} is idempotent —
 * it can re-accept its own (null-filled) canonical output.
 */
export interface SniperCandidateInput {
  /** Stable, unique id for this candidate. Required, non-empty. */
  candidateId: string;
  /** The token mint public key (validated as a 32-byte Solana public key). Required. */
  mint: string;
  symbol?: string | null;
  name?: string | null;
  /** Where this candidate came from (e.g. "manual", "watchlist"). Operator-supplied label only. */
  sourceTag?: string | null;
  /** A free-form operator note about why this candidate is here. */
  sourceNote?: string | null;
  /** Operator-OBSERVED liquidity in USD (NOT verified on-chain here). */
  observedLiquidityUsd?: number | null;
  /** Operator-OBSERVED market cap in USD (NOT verified on-chain here). */
  observedMarketCapUsd?: number | null;
  /** Operator-OBSERVED 24h volume in USD (NOT verified on-chain here). */
  observedVolumeUsd?: number | null;
  /** Social / source references as plain strings — NEVER fetched. */
  socialRefs?: string[];
  /** Operator-supplied "observed at" LABEL (a string, never system time). */
  observedAtLabel?: string | null;
  /** Operator-supplied "created" LABEL (a string, never system time). */
  createdLabel?: string | null;
  tags?: string[];
  operatorNotes?: string[];
}

/** Everything {@link normalizeSniperCandidateList} needs. */
export interface NormalizeSniperCandidateListInput {
  /** Optional source path / label echoed into the list. */
  sourceLabel?: string;
  /** The candidates. At least one unless {@link allowEmpty} is set; candidate ids must be unique. */
  candidates: SniperCandidateInput[];
  /** Allow an empty candidate list (default false). */
  allowEmpty?: boolean;
}

// --- list model --------------------------------------------------------------

/** One candidate's normalized, canonical entry (optional fields are explicit null when absent). */
export interface SniperCandidate {
  candidateId: string;
  mint: string;
  symbol: string | null;
  name: string | null;
  sourceTag: string | null;
  sourceNote: string | null;
  observedLiquidityUsd: number | null;
  observedMarketCapUsd: number | null;
  observedVolumeUsd: number | null;
  socialRefs: string[];
  observedAtLabel: string | null;
  createdLabel: string | null;
  tags: string[];
  operatorNotes: string[];
}

/** The full, deterministic, JSON-serializable candidate list. */
export interface SniperCandidateList {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  sourceLabel: string | null;
  candidateCount: number;
  /** Candidates in INPUT order (operator priority is data; order is preserved, not re-sorted). */
  candidates: SniperCandidate[];
  /** Distinct mints present, sorted ascending. */
  distinctMints: string[];
  /** Mints that appear more than once (sorted) — allowed, but surfaced. */
  duplicateMints: string[];
  warnings: string[];
  notes: string[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Read an optional non-empty string field; null when absent. Throws on a present-but-wrong type. */
function optString(obj: Record<string, unknown>, name: string, where: string): string | null {
  const v = obj[name];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") {
    throw new SniperCandidateListError(`${where}.${name} must be a string when present`);
  }
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Read an optional finite, non-negative number field; null when absent. */
function optNonNegNumber(obj: Record<string, unknown>, name: string, where: string): number | null {
  const v = obj[name];
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new SniperCandidateListError(`${where}.${name} must be a finite number when present`);
  }
  if (v < 0) {
    throw new SniperCandidateListError(`${where}.${name} must not be negative`);
  }
  return v;
}

/** Read an optional string[] field (each item non-empty after trim); [] when absent. */
function optStringArray(obj: Record<string, unknown>, name: string, where: string): string[] {
  const v = obj[name];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    throw new SniperCandidateListError(`${where}.${name} must be an array of strings when present`);
  }
  const out: string[] = [];
  v.forEach((item, i) => {
    if (typeof item !== "string") {
      throw new SniperCandidateListError(`${where}.${name}[${i}] must be a string`);
    }
    const trimmed = item.trim();
    if (trimmed.length > 0) out.push(trimmed);
  });
  return out;
}

/** Strictly read one raw candidate input into a canonical {@link SniperCandidate}. */
function readCandidate(input: unknown, position: number, seenIds: Set<string>): SniperCandidate {
  const where = `candidates[${position}]`;
  if (!isObject(input)) {
    throw new SniperCandidateListError(`${where} must be an object`);
  }
  if (!nonEmptyString(input.candidateId)) {
    throw new SniperCandidateListError(`${where}.candidateId must be a non-empty string`);
  }
  const candidateId = input.candidateId.trim();
  if (candidateId.length === 0) {
    throw new SniperCandidateListError(`${where}.candidateId must be a non-empty string`);
  }
  if (seenIds.has(candidateId)) {
    throw new SniperCandidateListError(`duplicate candidateId "${candidateId}"`);
  }
  seenIds.add(candidateId);

  if (typeof input.mint !== "string") {
    throw new SniperCandidateListError(`${where} (${candidateId}).mint must be a string`);
  }
  let mint: string;
  try {
    mint = parseMintAddress(input.mint);
  } catch (err) {
    throw new SniperCandidateListError(`${where} (${candidateId}): ${(err as Error).message}`);
  }

  return {
    candidateId,
    mint,
    symbol: optString(input, "symbol", `${where} (${candidateId})`),
    name: optString(input, "name", `${where} (${candidateId})`),
    sourceTag: optString(input, "sourceTag", `${where} (${candidateId})`),
    sourceNote: optString(input, "sourceNote", `${where} (${candidateId})`),
    observedLiquidityUsd: optNonNegNumber(input, "observedLiquidityUsd", `${where} (${candidateId})`),
    observedMarketCapUsd: optNonNegNumber(input, "observedMarketCapUsd", `${where} (${candidateId})`),
    observedVolumeUsd: optNonNegNumber(input, "observedVolumeUsd", `${where} (${candidateId})`),
    socialRefs: optStringArray(input, "socialRefs", `${where} (${candidateId})`),
    observedAtLabel: optString(input, "observedAtLabel", `${where} (${candidateId})`),
    createdLabel: optString(input, "createdLabel", `${where} (${candidateId})`),
    tags: optStringArray(input, "tags", `${where} (${candidateId})`),
    operatorNotes: optStringArray(input, "operatorNotes", `${where} (${candidateId})`),
  };
}

// --- normalize (build a canonical list from raw operator input) --------------

/**
 * Normalize operator-friendly raw input into a canonical {@link SniperCandidateList}. Pure and
 * non-mutating; idempotent (normalizing an already-canonical list yields the same list). Reads
 * `candidates` + optional `sourceLabel` regardless of any `schemaVersion` on the input. Every mint is
 * validated via {@link parseMintAddress} (secret-length / private-key-like input is refused);
 * candidate ids must be unique; duplicate MINTS are allowed but surfaced as a warning. Candidate
 * INPUT order is preserved (operator priority is data). Throws {@link SniperCandidateListError} on
 * structurally invalid input, an empty list (unless `allowEmpty`), a duplicate id, or an invalid mint.
 */
export function normalizeSniperCandidateList(
  input: NormalizeSniperCandidateListInput,
): SniperCandidateList {
  if (!isObject(input)) {
    throw new SniperCandidateListError("candidate list input must be an object");
  }
  if (input.sourceLabel !== undefined && typeof input.sourceLabel !== "string") {
    throw new SniperCandidateListError("candidate list input.sourceLabel must be a string when present");
  }
  if (!Array.isArray(input.candidates)) {
    throw new SniperCandidateListError("candidate list input.candidates must be an array");
  }
  const allowEmpty = input.allowEmpty === true;
  if (input.candidates.length === 0 && !allowEmpty) {
    throw new SniperCandidateListError("candidate list input.candidates must contain at least one candidate");
  }

  const seenIds = new Set<string>();
  const candidates = input.candidates.map((c, i) => readCandidate(c, i, seenIds));

  // Duplicate-mint detection (allowed, but surfaced).
  const mintCounts = new Map<string, number>();
  for (const c of candidates) mintCounts.set(c.mint, (mintCounts.get(c.mint) ?? 0) + 1);
  const distinctMints = [...mintCounts.keys()].sort(compareString);
  const duplicateMints = distinctMints.filter((m) => (mintCounts.get(m) ?? 0) > 1);

  const warnings: string[] = [];
  if (duplicateMints.length > 0) {
    warnings.push(`${duplicateMints.length} mint(s) appear on more than one candidate: ${duplicateMints.join(", ")}`);
  }
  if (candidates.length === 0) {
    warnings.push("candidate list is empty.");
  }

  const sourceLabel = nonEmptyString(input.sourceLabel) ? input.sourceLabel : null;
  const notes = [
    `${candidates.length} candidate(s); ${distinctMints.length} distinct mint(s).`,
    "Operator-supplied intake only — mints are validated as public keys but their liquidity / market / social context is NOT verified on-chain here.",
  ];

  return {
    schemaVersion: SNIPER_CANDIDATE_LIST_SCHEMA_VERSION,
    banner: SNIPER_CANDIDATE_LIST_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...SNIPER_CANDIDATE_LIST_DISCLAIMERS],
    sourceLabel,
    candidateCount: candidates.length,
    candidates,
    distinctMints,
    duplicateMints,
    warnings,
    notes,
  };
}

// --- validation (backstop for a list read from disk) -------------------------

function validateCandidate(value: unknown, where: string): void {
  if (!isObject(value)) throw new SniperCandidateListError(`${where} must be an object`);
  if (!nonEmptyString(value.candidateId)) {
    throw new SniperCandidateListError(`${where}.candidateId must be a non-empty string`);
  }
  if (!nonEmptyString(value.mint) || !isValidMintAddress(value.mint)) {
    throw new SniperCandidateListError(`${where}.mint must be a valid Solana mint public key`);
  }
  for (const f of ["symbol", "name", "sourceTag", "sourceNote", "observedAtLabel", "createdLabel"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new SniperCandidateListError(`${where}.${f} must be a string or null`);
    }
  }
  for (const f of ["observedLiquidityUsd", "observedMarketCapUsd", "observedVolumeUsd"] as const) {
    const v = value[f];
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
      throw new SniperCandidateListError(`${where}.${f} must be a non-negative number or null`);
    }
  }
  for (const f of ["socialRefs", "tags", "operatorNotes"] as const) {
    if (!Array.isArray(value[f]) || (value[f] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperCandidateListError(`${where}.${f} must be an array of strings`);
    }
  }
}

/**
 * Strictly validate a value as a canonical {@link SniperCandidateList} and return it narrowed. A
 * backstop mirroring the package's sibling validators: checks the schema version + banner, the
 * PAPER-ONLY labelling, the disclaimers, every candidate entry, the candidate count, and the derived
 * mint lists. Throws {@link SniperCandidateListError} on the first problem. Pure.
 */
export function validateSniperCandidateList(value: unknown): SniperCandidateList {
  if (!isObject(value)) throw new SniperCandidateListError("candidate list must be a JSON object");
  if (value.schemaVersion !== SNIPER_CANDIDATE_LIST_SCHEMA_VERSION) {
    throw new SniperCandidateListError(
      `candidate list.schemaVersion must be "${SNIPER_CANDIDATE_LIST_SCHEMA_VERSION}"`,
    );
  }
  if (value.banner !== SNIPER_CANDIDATE_LIST_BANNER) {
    throw new SniperCandidateListError(`candidate list.banner must be "${SNIPER_CANDIDATE_LIST_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new SniperCandidateListError(`candidate list.${flag} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperCandidateListError("candidate list.disclaimers must be a non-empty array");
  }
  if (value.sourceLabel !== null && typeof value.sourceLabel !== "string") {
    throw new SniperCandidateListError("candidate list.sourceLabel must be a string or null");
  }
  if (typeof value.candidateCount !== "number" || !Number.isInteger(value.candidateCount) || value.candidateCount < 0) {
    throw new SniperCandidateListError("candidate list.candidateCount must be a non-negative integer");
  }
  for (const key of ["distinctMints", "duplicateMints", "warnings", "notes"] as const) {
    if (!Array.isArray(value[key]) || (value[key] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperCandidateListError(`candidate list.${key} must be an array of strings`);
    }
  }
  if (!Array.isArray(value.candidates)) throw new SniperCandidateListError("candidate list.candidates must be an array");
  if ((value.candidates as unknown[]).length !== value.candidateCount) {
    throw new SniperCandidateListError("candidate list.candidates length must equal candidateCount");
  }
  const seenIds = new Set<string>();
  (value.candidates as unknown[]).forEach((c, i) => {
    validateCandidate(c, `candidate list.candidates[${i}]`);
    const id = (c as Record<string, unknown>).candidateId as string;
    if (seenIds.has(id)) throw new SniperCandidateListError(`candidate list has a duplicate candidateId "${id}"`);
    seenIds.add(id);
  });
  return value as unknown as SniperCandidateList;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperCandidateList}. */
export interface FormatSniperCandidateListOptions {
  /** Optional label echoed into the header. */
  label?: string;
  /** Cap on the number of candidate rows printed (default 100; the rest are summarized). */
  maxRows?: number;
}

function usd(value: number | null): string {
  return value === null ? "—" : `$${value}`;
}

/**
 * Render a redacted, stable, human-readable candidate list. Deterministic and path-stable (no
 * timestamps). Leads with the PAPER-ONLY banner and the candidate count, lists each candidate
 * (id, mint, optional symbol/source/observed context), summarizes the distinct/duplicate mints, and
 * closes with any warnings and the not-live / not-advice disclaimers. The whole output is passed
 * through the shared redactor.
 */
export function formatSniperCandidateList(
  list: SniperCandidateList,
  opts: FormatSniperCandidateListOptions = {},
): string {
  const maxRows = opts.maxRows ?? 100;
  const header = `${list.banner} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];

  if (opts.label) lines.push(`label:      ${opts.label}`);
  lines.push(`source:     ${list.sourceLabel ?? "(none)"}`);
  lines.push(`candidates: ${list.candidateCount} (${list.distinctMints.length} distinct mint(s))`);

  lines.push("");
  lines.push("Candidates:");
  if (list.candidates.length === 0) {
    lines.push("- (none)");
  } else {
    for (const c of list.candidates.slice(0, maxRows)) {
      const bits: string[] = [];
      if (c.symbol) bits.push(c.symbol);
      if (c.sourceTag) bits.push(`src=${c.sourceTag}`);
      if (c.observedLiquidityUsd !== null) bits.push(`liq=${usd(c.observedLiquidityUsd)}`);
      if (c.observedVolumeUsd !== null) bits.push(`vol=${usd(c.observedVolumeUsd)}`);
      lines.push(`- ${c.candidateId}  ${c.mint}${bits.length > 0 ? `  [${bits.join("; ")}]` : ""}`);
      if (c.sourceNote) lines.push(`    note: ${c.sourceNote}`);
    }
    const hidden = list.candidates.length - Math.min(list.candidates.length, maxRows);
    if (hidden > 0) lines.push(`- … and ${hidden} more (summarized; see the list JSON for the full set)`);
  }

  if (list.duplicateMints.length > 0) {
    lines.push("");
    lines.push(`Duplicate mints: ${list.duplicateMints.join(", ")}`);
  }

  if (list.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of list.warnings) lines.push(`- ${w}`);
  }

  lines.push("");
  lines.push("Notes:");
  for (const note of list.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of list.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
