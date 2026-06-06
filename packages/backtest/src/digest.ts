/**
 * Deterministic, dependency-free content digest for backtest reproducibility.
 *
 * This is **NOT** a cryptographic hash — it exists only so two reports can be
 * compared for "same scenario content" and so a report can be traced back to the
 * scenario that produced it. It is intentionally:
 *
 *  - pure: no `node:crypto`, no Node built-ins, no `Date.now`, no `Math.random`,
 *    so the package stays offline/pure (see the forbidden-import regression);
 *  - canonical: object keys are sorted recursively before hashing, so two
 *    scenarios that differ only in key order produce the SAME digest;
 *  - stable: the same canonical content always yields the same 16-hex-char digest.
 *
 * Do not use it for security, integrity, or anti-tamper purposes.
 */

/**
 * Produce a canonical JSON string with object keys sorted recursively. Arrays
 * keep their order (order is meaningful for steps/prices); objects are emitted
 * with their keys in ascending Unicode order. `undefined` object values are
 * dropped (matching `JSON.stringify`). Pure and deterministic.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalize(v === undefined ? null : v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    const body = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",");
    return `{${body}}`;
  }
  // undefined / function / symbol — not representable; treat as null for stability.
  return "null";
}

/** One FNV-1a 32-bit pass over a string's UTF-16 code units (deterministic). */
function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // hash *= 0x01000193 (FNV prime), modulo 2^32, via Math.imul.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function hex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, "0");
}

/**
 * A 16-hex-character (64-bit) non-cryptographic content digest of any
 * JSON-serializable value. Computed as two FNV-1a passes (different seeds) over
 * the canonicalized content and concatenated. Deterministic and pure.
 */
export function digestContent(value: unknown): string {
  const canonical = canonicalize(value);
  // Two independently-seeded passes widen the digest to 64 bits to keep
  // incidental collisions vanishingly unlikely for realistic scenario counts.
  return hex8(fnv1a32(canonical, 0x811c9dc5)) + hex8(fnv1a32(canonical, 0x7f4a7c15));
}
