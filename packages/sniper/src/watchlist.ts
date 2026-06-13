/**
 * Deterministic, offline, **PAPER-only** SNIPER WATCHLIST (Sprint 104-C operator layer).
 *
 * An operator who is hunting Solana memecoin candidates needs a durable place to keep the mints they
 * are monitoring, each with a status and some context, BEFORE (and entirely separate from) any
 * scoring, risk check, quote, or dry-run. This module is that layer: a closed-schema
 * `sniper.watchlist.v1` artifact. It is **pure** and does NO filesystem / network / RPC / wallet work
 * of its own — the CLI reads a local JSON file and hands the parsed value here.
 *
 * Every mint is validated as a real 32-byte Solana **public** key via the pure {@link parseMintAddress},
 * which REFUSES secret-length / private-key-like input, so a private key or seed phrase can never be
 * pasted into a watchlist and silently accepted. Every operator label is passed through the shared
 * redactor and REFUSED if it is secret-shaped, and carries no control characters / NUL / BOM.
 *
 * A watchlist `status` (`watch` | `review` | `blocked` | `archived`) is bookkeeping ONLY. It is NOT a
 * trade signal and NEVER implies trade readiness or live-execution meaning — `statusIsNotTradeReadiness`
 * is pinned true and the artifact carries no readiness / execution field whatsoever. Nothing here holds
 * a key, or builds / signs / simulates / sends a transaction.
 */

import { redactString } from "@soulmaker/security";
import { parseMintAddress, isValidMintAddress } from "./mint-address.js";

/** Stable schema identifier for the watchlist. Bump only on a breaking change. */
export const SNIPER_WATCHLIST_SCHEMA_VERSION = "sniper.watchlist.v1";

/** The banner that prefixes every watchlist (required label). */
export const SNIPER_WATCHLIST_BANNER = "SIMULATED PAPER-ONLY SNIPER WATCHLIST";

/** Closed status set for a watchlist entry. Bookkeeping only — never trade readiness. */
export const SNIPER_WATCHLIST_STATUSES = ["watch", "review", "blocked", "archived"] as const;
export type SniperWatchlistStatus = (typeof SNIPER_WATCHLIST_STATUSES)[number];

/** Closed network set a watchlist can be scoped to (default mainnet-beta). */
export const SNIPER_WATCHLIST_NETWORKS = ["mainnet-beta", "devnet", "testnet"] as const;
export type SniperWatchlistNetwork = (typeof SNIPER_WATCHLIST_NETWORKS)[number];

/** Required disclaimer statements carried by every watchlist (stable order). */
export const SNIPER_WATCHLIST_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SNIPER WATCHLIST — a deterministic list of operator-supplied candidate mints to monitor.",
  "A status (watch / review / blocked / archived) is bookkeeping only; it is NOT a trade signal and NEVER means a candidate is ready or safe to trade.",
  "Every mint is validated as a 32-byte Solana public key; secret-length / private-key-like input is refused.",
  "Operator-supplied data only: any label / provider / note is supplied by the operator and is NOT verified on-chain here.",
  "It follows no links, fetches nothing, and carries no wall-clock time.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this watchlist.",
  "Not live data.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
];

const MAX_ENTRIES = 1000;
const MAX_LABEL_LEN = 200;
const MAX_LINE_LEN = 400;
const MAX_LIST = 64;

/** Thrown when a watchlist INPUT or produced watchlist is structurally invalid. */
export class SniperWatchlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperWatchlistError";
  }
}

// --- input -------------------------------------------------------------------

/**
 * One operator-supplied watchlist entry (raw input shape). Optional fields accept `null` as well as
 * `undefined` so {@link normalizeSniperWatchlist} is idempotent — it can re-accept its own canonical
 * (null-filled) output.
 */
export interface SniperWatchlistEntryInput {
  /** Stable, unique id for this entry. Optional on input — derived from the mint when absent. */
  entryId?: string | null;
  /** The token mint public key (validated as a 32-byte Solana public key). Required. */
  mint: string;
  /** Operator label (e.g. a ticker or nickname). */
  label?: string | null;
  /** Where this candidate was spotted (e.g. "manual", "realtime-feed"). Operator label only. */
  provider?: string | null;
  /** Bookkeeping status; defaults to "watch". Never trade readiness. */
  status?: SniperWatchlistStatus | null;
  tags?: string[];
  /** Free-form operator notes / caveats. */
  notes?: string[];
  /** Operator-supplied "added at" LABEL (a string, never system time). */
  addedAtLabel?: string | null;
  /** Operator-supplied "last reviewed at" LABEL (a string, never system time). */
  lastReviewedAtLabel?: string | null;
}

/** Everything {@link normalizeSniperWatchlist} needs. */
export interface NormalizeSniperWatchlistInput {
  watchlistId?: string | null;
  /** Operator-supplied "created at" LABEL (a string, never system time). */
  createdAtLabel?: string | null;
  /** Optional source path / label echoed into the watchlist. */
  sourceLabel?: string | null;
  /** Network the watchlist is scoped to (default mainnet-beta). */
  network?: string | null;
  /** The entries. Unique entry ids; duplicate MINTS are surfaced as a warning, not refused. */
  entries: SniperWatchlistEntryInput[];
  /** Allow an empty watchlist (default false). */
  allowEmpty?: boolean;
}

// --- watchlist model ---------------------------------------------------------

/** One entry's normalized, canonical shape (optional fields are explicit null when absent). */
export interface SniperWatchlistEntry {
  entryId: string;
  mint: string;
  label: string | null;
  provider: string | null;
  status: SniperWatchlistStatus;
  tags: string[];
  notes: string[];
  addedAtLabel: string | null;
  lastReviewedAtLabel: string | null;
}

/** Per-status entry tally (re-derived; never a trade-readiness signal). */
export interface SniperWatchlistStatusCounts {
  watch: number;
  review: number;
  blocked: number;
  archived: number;
}

/** The full, deterministic, JSON-serializable watchlist. */
export interface SniperWatchlist {
  schemaVersion: string;
  banner: string;
  disclaimers: string[];
  watchlistId: string;
  createdAtLabel: string | null;
  sourceLabel: string | null;
  network: SniperWatchlistNetwork;
  entryCount: number;
  /** Entries in INPUT order (operator priority is data; order is preserved, not re-sorted). */
  entries: SniperWatchlistEntry[];
  /** Distinct mints present, sorted ascending. */
  distinctMints: string[];
  /** Mints that appear on more than one entry (sorted) — allowed, but surfaced. */
  duplicateMints: string[];
  statusCounts: SniperWatchlistStatusCounts;
  warnings: string[];
  notes: string[];
  caveats: string[];
  paperOnly: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  statusIsNotTradeReadiness: true;
  neverSends: true;
  redactionApplied: true;
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function rejectControlChars(value: string, name: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    const isBomOrSeparator = code === 0xfeff || code === 0x2028 || code === 0x2029;
    if (isControl || isBomOrSeparator) {
      throw new SniperWatchlistError(`${name} contains a control character, NUL, or BOM and is refused`);
    }
  }
}

/** Read an optional non-empty, length-bounded, redaction-safe string field; null when absent. */
function optLabel(value: unknown, name: string, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new SniperWatchlistError(`${name} must be a string when present`);
  rejectControlChars(value, name);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) throw new SniperWatchlistError(`${name} exceeds ${max} characters`);
  if (redactString(trimmed) !== trimmed) throw new SniperWatchlistError(`${name} is secret-shaped and is refused`);
  return trimmed;
}

/** Read an optional string[] field (each item non-empty, bounded, redaction-safe); [] when absent. */
function optStringArray(value: unknown, name: string, maxCount: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SniperWatchlistError(`${name} must be an array of strings when present`);
  if (value.length > maxCount) throw new SniperWatchlistError(`${name} exceeds ${maxCount} entries`);
  const out: string[] = [];
  value.forEach((item, i) => {
    if (typeof item !== "string") throw new SniperWatchlistError(`${name}[${i}] must be a string`);
    rejectControlChars(item, `${name}[${i}]`);
    const trimmed = item.trim();
    if (trimmed.length === 0) return;
    if (trimmed.length > MAX_LINE_LEN) throw new SniperWatchlistError(`${name}[${i}] exceeds ${MAX_LINE_LEN} characters`);
    if (redactString(trimmed) !== trimmed) throw new SniperWatchlistError(`${name}[${i}] is secret-shaped and is refused`);
    out.push(trimmed);
  });
  return out;
}

function readStatus(value: unknown, name: string): SniperWatchlistStatus {
  if (value === undefined || value === null) return "watch";
  if (typeof value !== "string" || !(SNIPER_WATCHLIST_STATUSES as readonly string[]).includes(value)) {
    throw new SniperWatchlistError(`${name} must be one of: ${SNIPER_WATCHLIST_STATUSES.join(", ")}`);
  }
  return value as SniperWatchlistStatus;
}

function readNetwork(value: unknown): SniperWatchlistNetwork {
  if (value === undefined || value === null) return "mainnet-beta";
  if (typeof value !== "string" || !(SNIPER_WATCHLIST_NETWORKS as readonly string[]).includes(value)) {
    throw new SniperWatchlistError(`network must be one of: ${SNIPER_WATCHLIST_NETWORKS.join(", ")}`);
  }
  return value as SniperWatchlistNetwork;
}

/** Strictly read one raw entry into a canonical {@link SniperWatchlistEntry}. */
function readEntry(input: unknown, position: number, seenIds: Set<string>): SniperWatchlistEntry {
  const where = `entries[${position}]`;
  if (!isObject(input)) throw new SniperWatchlistError(`${where} must be an object`);

  if (typeof input.mint !== "string") {
    throw new SniperWatchlistError(`${where}.mint must be a string`);
  }
  let mint: string;
  try {
    mint = parseMintAddress(input.mint);
  } catch (err) {
    throw new SniperWatchlistError(`${where}: ${(err as Error).message}`);
  }

  // entryId defaults to the mint when absent; uniqueness is enforced.
  let entryId: string;
  if (input.entryId === undefined || input.entryId === null) {
    entryId = mint;
  } else {
    const provided = optLabel(input.entryId, `${where}.entryId`, 128);
    entryId = provided ?? mint;
  }
  if (seenIds.has(entryId)) {
    throw new SniperWatchlistError(`duplicate entryId "${entryId}"`);
  }
  seenIds.add(entryId);

  return {
    entryId,
    mint,
    label: optLabel(input.label, `${where}.label`, MAX_LABEL_LEN),
    provider: optLabel(input.provider, `${where}.provider`, MAX_LABEL_LEN),
    status: readStatus(input.status, `${where}.status`),
    tags: optStringArray(input.tags, `${where}.tags`, MAX_LIST),
    notes: optStringArray(input.notes, `${where}.notes`, MAX_LIST),
    addedAtLabel: optLabel(input.addedAtLabel, `${where}.addedAtLabel`, 40),
    lastReviewedAtLabel: optLabel(input.lastReviewedAtLabel, `${where}.lastReviewedAtLabel`, 40),
  };
}

function deriveStatusCounts(entries: readonly SniperWatchlistEntry[]): SniperWatchlistStatusCounts {
  return {
    watch: entries.filter((e) => e.status === "watch").length,
    review: entries.filter((e) => e.status === "review").length,
    blocked: entries.filter((e) => e.status === "blocked").length,
    archived: entries.filter((e) => e.status === "archived").length,
  };
}

const DEFAULT_CAVEATS: readonly string[] = [
  "A watchlist is a monitoring list, not a queue of trades — every entry still needs an independent risk check, a fresh quote, and a dry-run before it means anything.",
  "A 'watch' or 'review' status is the operator's bookkeeping; it is never a buy signal and never implies the candidate is safe.",
  "Live trading is disabled; this artifact has no execution meaning and there is no mainnet-send command anywhere in Sol Maker.",
];

// --- normalize (build a canonical watchlist from raw operator input) ----------

/**
 * Normalize operator-friendly raw input into a canonical {@link SniperWatchlist}. Pure and
 * non-mutating; idempotent (normalizing an already-canonical watchlist yields the same watchlist).
 * Every mint is validated via {@link parseMintAddress} (secret-length / private-key-like input is
 * refused); entry ids must be unique (an absent id defaults to the mint); duplicate MINTS are allowed
 * but surfaced as a warning. Entry INPUT order is preserved (operator priority is data). Throws
 * {@link SniperWatchlistError} on structurally invalid input, an empty list (unless `allowEmpty`), a
 * duplicate id, or an invalid mint.
 */
export function normalizeSniperWatchlist(input: NormalizeSniperWatchlistInput): SniperWatchlist {
  if (!isObject(input)) throw new SniperWatchlistError("watchlist input must be an object");
  if (!Array.isArray(input.entries)) throw new SniperWatchlistError("watchlist input.entries must be an array");
  const allowEmpty = input.allowEmpty === true;
  if (input.entries.length === 0 && !allowEmpty) {
    throw new SniperWatchlistError("watchlist input.entries must contain at least one entry");
  }
  if (input.entries.length > MAX_ENTRIES) {
    throw new SniperWatchlistError(`watchlist input.entries exceeds ${MAX_ENTRIES} entries`);
  }

  const watchlistId = optLabel(input.watchlistId, "watchlistId", 128) ?? "sniper-watchlist";
  const createdAtLabel = optLabel(input.createdAtLabel, "createdAtLabel", 40);
  const sourceLabel = optLabel(input.sourceLabel, "sourceLabel", MAX_LABEL_LEN);
  const network = readNetwork(input.network);

  const seenIds = new Set<string>();
  const entries = input.entries.map((e, i) => readEntry(e, i, seenIds));

  const mintCounts = new Map<string, number>();
  for (const e of entries) mintCounts.set(e.mint, (mintCounts.get(e.mint) ?? 0) + 1);
  const distinctMints = [...mintCounts.keys()].sort(compareString);
  const duplicateMints = distinctMints.filter((m) => (mintCounts.get(m) ?? 0) > 1);

  const warnings: string[] = [];
  if (duplicateMints.length > 0) {
    warnings.push(`${duplicateMints.length} mint(s) appear on more than one entry: ${duplicateMints.join(", ")}`);
  }
  if (entries.length === 0) warnings.push("watchlist is empty.");

  const statusCounts = deriveStatusCounts(entries);
  const notes = [
    `${entries.length} entry(ies); ${distinctMints.length} distinct mint(s) on ${network}.`,
    `status tally — watch ${statusCounts.watch}, review ${statusCounts.review}, blocked ${statusCounts.blocked}, archived ${statusCounts.archived}.`,
    "Operator-supplied monitoring list — mints are validated as public keys but their context is NOT verified on-chain here; a status is never trade readiness.",
  ];

  return {
    schemaVersion: SNIPER_WATCHLIST_SCHEMA_VERSION,
    banner: SNIPER_WATCHLIST_BANNER,
    disclaimers: [...SNIPER_WATCHLIST_DISCLAIMERS],
    watchlistId,
    createdAtLabel,
    sourceLabel,
    network,
    entryCount: entries.length,
    entries,
    distinctMints,
    duplicateMints,
    statusCounts,
    warnings,
    notes,
    caveats: [...DEFAULT_CAVEATS],
    paperOnly: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    statusIsNotTradeReadiness: true,
    neverSends: true,
    redactionApplied: true,
  };
}

// --- validation (backstop + parity wall) -------------------------------------

const EXPECTED_KEYS = [
  "schemaVersion",
  "banner",
  "disclaimers",
  "watchlistId",
  "createdAtLabel",
  "sourceLabel",
  "network",
  "entryCount",
  "entries",
  "distinctMints",
  "duplicateMints",
  "statusCounts",
  "warnings",
  "notes",
  "caveats",
  "paperOnly",
  "notLiveResult",
  "notFinancialAdvice",
  "notProfitabilityClaim",
  "statusIsNotTradeReadiness",
  "neverSends",
  "redactionApplied",
] as const;

const EXPECTED_ENTRY_KEYS = [
  "entryId",
  "mint",
  "label",
  "provider",
  "status",
  "tags",
  "notes",
  "addedAtLabel",
  "lastReviewedAtLabel",
] as const;

function validateEntry(value: unknown, where: string): SniperWatchlistEntry {
  if (!isObject(value)) throw new SniperWatchlistError(`${where} must be an object`);
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_ENTRY_KEYS as readonly string[]).includes(key)) {
      throw new SniperWatchlistError(`${where} has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  if (typeof value.entryId !== "string" || value.entryId.trim().length === 0) {
    throw new SniperWatchlistError(`${where}.entryId must be a non-empty string`);
  }
  if (typeof value.mint !== "string" || !isValidMintAddress(value.mint)) {
    throw new SniperWatchlistError(`${where}.mint must be a valid Solana mint public key`);
  }
  for (const f of ["label", "provider", "addedAtLabel", "lastReviewedAtLabel"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new SniperWatchlistError(`${where}.${f} must be a string or null`);
    }
  }
  readStatus(value.status, `${where}.status`);
  for (const f of ["tags", "notes"] as const) {
    if (!Array.isArray(value[f]) || (value[f] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperWatchlistError(`${where}.${f} must be an array of strings`);
    }
  }
  return value as unknown as SniperWatchlistEntry;
}

/**
 * Strictly validate a value as a canonical {@link SniperWatchlist} and return it narrowed. A backstop
 * AND a parity wall: the key set is CLOSED; the schema version / banner are pinned; every entry is
 * re-validated; the entry count, distinct/duplicate mints, and status counts are INDEPENDENTLY
 * re-derived and must match; the safety literals are pinned. Throws {@link SniperWatchlistError} on the
 * first problem. Pure.
 */
export function validateSniperWatchlist(value: unknown): SniperWatchlist {
  if (!isObject(value)) throw new SniperWatchlistError("watchlist must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) {
      throw new SniperWatchlistError(`watchlist has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  for (const key of EXPECTED_KEYS) {
    if (!(key in value)) throw new SniperWatchlistError(`watchlist is missing field "${key}"`);
  }

  if (value.schemaVersion !== SNIPER_WATCHLIST_SCHEMA_VERSION) {
    throw new SniperWatchlistError(`watchlist.schemaVersion must be "${SNIPER_WATCHLIST_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_WATCHLIST_BANNER) {
    throw new SniperWatchlistError(`watchlist.banner must be "${SNIPER_WATCHLIST_BANNER}"`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperWatchlistError("watchlist.disclaimers must be a non-empty array");
  }
  if (typeof value.watchlistId !== "string" || value.watchlistId.trim().length === 0) {
    throw new SniperWatchlistError("watchlist.watchlistId must be a non-empty string");
  }
  for (const f of ["createdAtLabel", "sourceLabel"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new SniperWatchlistError(`watchlist.${f} must be a string or null`);
    }
  }
  readNetwork(value.network);
  for (const key of ["distinctMints", "duplicateMints", "warnings", "notes", "caveats"] as const) {
    if (!Array.isArray(value[key]) || (value[key] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperWatchlistError(`watchlist.${key} must be an array of strings`);
    }
  }

  if (!Array.isArray(value.entries)) throw new SniperWatchlistError("watchlist.entries must be an array");
  const seenIds = new Set<string>();
  const entries = (value.entries as unknown[]).map((e, i) => {
    const entry = validateEntry(e, `watchlist.entries[${i}]`);
    if (seenIds.has(entry.entryId)) throw new SniperWatchlistError(`watchlist has a duplicate entryId "${entry.entryId}"`);
    seenIds.add(entry.entryId);
    return entry;
  });
  if (typeof value.entryCount !== "number" || value.entryCount !== entries.length) {
    throw new SniperWatchlistError("watchlist.entryCount must equal entries.length");
  }

  // Re-derive the mint lists + status counts; they must match (no fabricated tallies).
  const mintCounts = new Map<string, number>();
  for (const e of entries) mintCounts.set(e.mint, (mintCounts.get(e.mint) ?? 0) + 1);
  const distinctMints = [...mintCounts.keys()].sort(compareString);
  const duplicateMints = distinctMints.filter((m) => (mintCounts.get(m) ?? 0) > 1);
  if (JSON.stringify(value.distinctMints) !== JSON.stringify(distinctMints)) {
    throw new SniperWatchlistError("watchlist.distinctMints must be re-derived (sorted) from the entries");
  }
  if (JSON.stringify(value.duplicateMints) !== JSON.stringify(duplicateMints)) {
    throw new SniperWatchlistError("watchlist.duplicateMints must be re-derived (sorted) from the entries");
  }

  const statusCounts = deriveStatusCounts(entries);
  if (!isObject(value.statusCounts) || JSON.stringify(value.statusCounts) !== JSON.stringify(statusCounts)) {
    throw new SniperWatchlistError("watchlist.statusCounts must be re-derived from the entries");
  }

  for (const [field, expected] of [
    ["paperOnly", true],
    ["notLiveResult", true],
    ["notFinancialAdvice", true],
    ["notProfitabilityClaim", true],
    ["statusIsNotTradeReadiness", true],
    ["neverSends", true],
    ["redactionApplied", true],
  ] as const) {
    if (value[field] !== expected) throw new SniperWatchlistError(`watchlist.${field} must literally be ${String(expected)}`);
  }

  return value as unknown as SniperWatchlist;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperWatchlist}. */
export interface FormatSniperWatchlistOptions {
  /** Optional label echoed into the header. */
  label?: string;
  /** Cap on the number of entry rows printed (default 100; the rest are summarized). */
  maxRows?: number;
}

/**
 * Render a redacted, stable, human-readable watchlist. Deterministic and path-stable (no timestamps).
 * Leads with the PAPER-ONLY banner and the entry count, lists each entry (id, mint, status, optional
 * label/provider/tags), summarizes the status tally and duplicate mints, and closes with the caveats,
 * warnings, and disclaimers. The whole output is passed through the shared redactor.
 */
export function formatSniperWatchlist(
  watchlist: SniperWatchlist,
  opts: FormatSniperWatchlistOptions = {},
): string {
  const maxRows = opts.maxRows ?? 100;
  const header = `${watchlist.banner} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];

  if (opts.label) lines.push(`label:    ${opts.label}`);
  lines.push(`id:       ${watchlist.watchlistId}`);
  lines.push(`network:  ${watchlist.network}`);
  lines.push(`source:   ${watchlist.sourceLabel ?? "(none)"}`);
  lines.push(`entries:  ${watchlist.entryCount} (${watchlist.distinctMints.length} distinct mint(s))`);
  lines.push(
    `status:   watch ${watchlist.statusCounts.watch} · review ${watchlist.statusCounts.review} · blocked ${watchlist.statusCounts.blocked} · archived ${watchlist.statusCounts.archived}`,
  );

  lines.push("");
  lines.push("Entries:");
  if (watchlist.entries.length === 0) {
    lines.push("- (none)");
  } else {
    for (const e of watchlist.entries.slice(0, maxRows)) {
      const bits: string[] = [`status=${e.status}`];
      if (e.label) bits.push(e.label);
      if (e.provider) bits.push(`via=${e.provider}`);
      if (e.tags.length > 0) bits.push(`tags=${e.tags.join(",")}`);
      lines.push(`- ${e.entryId}  ${e.mint}  [${bits.join("; ")}]`);
      for (const note of e.notes) lines.push(`    note: ${note}`);
    }
    const hidden = watchlist.entries.length - Math.min(watchlist.entries.length, maxRows);
    if (hidden > 0) lines.push(`- … and ${hidden} more (summarized; see the watchlist JSON for the full set)`);
  }

  if (watchlist.duplicateMints.length > 0) {
    lines.push("");
    lines.push(`Duplicate mints: ${watchlist.duplicateMints.join(", ")}`);
  }

  if (watchlist.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of watchlist.warnings) lines.push(`- ${w}`);
  }

  lines.push("");
  lines.push("Caveats:");
  for (const c of watchlist.caveats) lines.push(`- ${c}`);
  lines.push("");
  for (const d of watchlist.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
