/**
 * Defensive, frontend-only accessors for reading fields out of an arbitrary,
 * untrusted parsed-JSON value.
 *
 * The schema-aware artifact renderers (see ../components/artifact-views.ts) read
 * known PAPER report shapes directly from raw JSON. That JSON is untrusted: a
 * field that "should" be a number might be a string, an object, or absent. These
 * helpers make every read total and type-safe:
 *
 *   - they NEVER throw — a missing or mismatched field returns `null`;
 *   - they return PLAIN values (strings/numbers/booleans) — HTML escaping happens
 *     later, at render time, so nothing here emits or trusts HTML;
 *   - they are BOUNDED — strings are length-capped and array reads are sliceable,
 *     so a hostile or huge artifact can never be dumped wholesale into a view.
 *
 * This module imports NO backend package and performs NO file/network/chain/
 * wallet activity. It only inspects a value already parsed elsewhere.
 */

/** Caps applied by the typed views (rows, list items, cell lengths). */
export const TYPED_VIEW_LIMITS = {
  /** Max rows rendered in any single typed table. */
  maxRows: 40,
  /** Max characters kept for any single rendered cell string. */
  maxCellChars: 160,
  /** Max items shown from a string list (e.g. recognized schemas). */
  maxListItems: 24,
  /** Max characters shown for a digest/hash before eliding. */
  maxDigestChars: 16,
  /** Max "missing field" labels listed in a partial-view notice. */
  maxMissingListed: 16,
  /** Max rows (base scenarios) in a base×variant grid. */
  maxGridRows: 24,
  /** Max columns (variants) in a base×variant grid. */
  maxGridCols: 12,
} as const;

/** Narrow an unknown to a plain object (not array, not null). */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Narrow an unknown to an array. */
export function asArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null;
}

/** Truncate a string to `max` chars, appending an ellipsis when cut. */
export function truncateText(value: string, max: number = TYPED_VIEW_LIMITS.maxCellChars): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

/**
 * Read a non-empty string field (covers `string` and `string | null` shapes).
 * Returns the length-capped string, or `null` if absent / empty / not a string.
 */
export function readString(
  record: Record<string, unknown>,
  key: string,
  max: number = TYPED_VIEW_LIMITS.maxCellChars,
): string | null {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) return null;
  return truncateText(value, max);
}

/** Read a finite number field. Returns `null` for non-numbers and NaN/±Infinity. */
export function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Read a boolean field. Returns `null` when absent or not a boolean. */
export function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

/** Read an array field, or `null` when absent / not an array. */
export function readArray(record: Record<string, unknown>, key: string): readonly unknown[] | null {
  return asArray(record[key]);
}

/** Read a nested object field, or `null` when absent / not a plain object. */
export function readRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  return asRecord(record[key]);
}

export interface StringListRead {
  /** Capped list of string entries (non-string entries are skipped). */
  readonly items: readonly string[];
  /** Total count of string entries before capping. */
  readonly total: number;
  /** How many string entries were hidden by the cap. */
  readonly hidden: number;
}

/** Read an array of strings, skipping non-strings, capped to `max`. */
export function readStringArray(
  record: Record<string, unknown>,
  key: string,
  max: number = TYPED_VIEW_LIMITS.maxListItems,
): StringListRead {
  const arr = asArray(record[key]);
  if (arr === null) return { items: [], total: 0, hidden: 0 };
  const strings = arr.filter((entry): entry is string => typeof entry === "string");
  const items = strings.slice(0, max).map((entry) => truncateText(entry));
  return { items, total: strings.length, hidden: Math.max(0, strings.length - items.length) };
}

export interface NumberDelta {
  readonly base: number | null;
  readonly next: number | null;
  readonly delta: number | null;
}

/**
 * Read a `{ base, next, delta }` delta object (the shape every diff schema uses).
 * Returns `null` only when the field is absent or not an object; individual
 * members are read defensively and may themselves be `null`.
 */
export function readDelta(record: Record<string, unknown>, key: string): NumberDelta | null {
  const sub = asRecord(record[key]);
  if (sub === null) return null;
  return {
    base: readNumber(sub, "base"),
    next: readNumber(sub, "next"),
    delta: readNumber(sub, "delta"),
  };
}

export interface CapInfo<T> {
  readonly shown: readonly T[];
  readonly total: number;
  readonly hidden: number;
}

/** Slice an array to `max` items, reporting how many were hidden. */
export function capRows<T>(items: readonly T[], max: number = TYPED_VIEW_LIMITS.maxRows): CapInfo<T> {
  const shown = items.slice(0, max);
  return { shown, total: items.length, hidden: Math.max(0, items.length - shown.length) };
}

/** Format a finite number for display: integers as-is, decimals rounded to 6dp. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(6)));
}

/** Format a finite number with an explicit sign (for deltas). Zero shows as "0". */
export function formatSigned(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

/** Format a non-negative byte count into a compact human-readable string. */
export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let scaled = value;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  const shown = unit === 0 ? String(scaled) : String(Number(scaled.toFixed(1)));
  return `${shown} ${units[unit]}`;
}

/** Elide a long digest/hash to its first {@link TYPED_VIEW_LIMITS.maxDigestChars} chars. */
export function shortDigest(value: string): string {
  return value.length <= TYPED_VIEW_LIMITS.maxDigestChars
    ? value
    : `${value.slice(0, TYPED_VIEW_LIMITS.maxDigestChars)}…`;
}
