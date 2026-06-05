/**
 * Secret redaction.
 *
 * This module is the single chokepoint that prevents secrets from leaking into
 * logs, error messages, or any serialized output. It redacts two ways:
 *
 *  1. By KEY NAME — any object key that looks sensitive (privateKey, seed,
 *     mnemonic, apiKey, cookie, authorization, ...) has its value replaced
 *     wholesale, regardless of the value's shape.
 *  2. By VALUE PATTERN — strings that look like secrets (bearer tokens, long
 *     base58 secret-key blobs, long hex blobs, BIP39-style mnemonics, api-key
 *     query params) are scrubbed even when they appear under an innocent key
 *     or inside free-form text.
 *
 * Redaction deliberately OVER-redacts. For a wallet-safety-first bot it is far
 * better to redact a harmless value than to leak a single secret.
 */

export const REDACTED = "[REDACTED]";

/**
 * Key-name patterns matched against a normalized key (lowercased, with all
 * non-alphanumeric characters stripped — so "API-Key", "api_key" and "apiKey"
 * all normalize to "apikey").
 */
const SENSITIVE_KEY_PATTERNS: readonly RegExp[] = [
  /privatekey/,
  /secretkey/,
  /^secret$/,
  /secrets?$/,
  /seed/,
  /mnemonic/,
  /recoveryphrase/,
  /passphrase/,
  /password/,
  /apikey/,
  /rpckey/,
  /accesstoken/,
  /refreshtoken/,
  /sessiontoken/,
  /^token$/,
  /bearer/,
  /authorization/,
  /^auth$/,
  /cookie/,
  /walletsecret/,
  /keypair/,
  /signingkey/,
];

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(normalized));
}

/**
 * Value patterns. Ordered so that more specific replacements run first.
 * Each entry replaces only the secret-looking span, preserving surrounding text.
 */
const STRING_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // "Bearer <token>"
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`],
  // api-key / token / access-token query params in URLs
  [
    /([?&](?:api[-_]?key|apikey|access[-_]?token|token|key|secret)=)[^&\s#"']+/gi,
    `$1${REDACTED}`,
  ],
  // Long base58 blobs — a 64-byte Solana secret key encodes to ~88 chars.
  // Public keys / signatures are <= ~44 chars, so the 80+ floor avoids them.
  [/\b[1-9A-HJ-NP-Za-km-z]{80,}\b/g, REDACTED],
  // Long hex blobs — raw private keys are 64 (32-byte) or 128 (64-byte) hex.
  [/\b(?:0x)?[0-9a-fA-F]{64,}\b/g, REDACTED],
  // BIP39-style mnemonics: 12–24 lowercase words (each 3–8 letters).
  [/\b(?:[a-z]{3,8}\s){11,23}[a-z]{3,8}\b/g, REDACTED],
];

/** Scrub secret-looking spans from a free-form string. */
export function redactString(input: string): string {
  let out = input;
  for (const [pattern, replacement] of STRING_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Recursively redact any value. Returns a structurally-cloned, redacted copy;
 * the input is never mutated. Safe against circular references.
 */
export function redactValue(value: unknown): unknown {
  return redactInner(value, undefined, new WeakSet<object>());
}

function redactInner(
  value: unknown,
  keyHint: string | undefined,
  seen: WeakSet<object>,
): unknown {
  if (keyHint !== undefined && isSensitiveKey(keyHint)) {
    return REDACTED;
  }

  if (typeof value === "string") return redactString(value);
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;

  if (value instanceof Uint8Array) {
    // Could be raw key bytes — never serialize the contents.
    return `[bytes(${value.length})]`;
  }

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactInner(item, undefined, seen));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : undefined,
    };
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = redactInner(v, k, seen);
  }
  return out;
}
