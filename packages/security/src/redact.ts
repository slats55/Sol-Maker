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

/** S111: keys under which a well-formed base58 transaction signature is preserved by redactValue. */
export const SIGNATURE_KEYS: ReadonlySet<string> = new Set(["signature", "entrySignature", "exitSignature", "txSignature", "buySignature", "sellSignature", "pendingSignature", "lastSignature", "closeSignature"]);
/** Exact shape of a 64-byte base58 transaction signature (87–88 chars; bounds allow slack). */
export const TX_SIGNATURE_SHAPE = /^[1-9A-HJ-NP-Za-km-z]{86,90}$/;

export function isSignatureKey(key: string): boolean {
  return SIGNATURE_KEYS.has(key);
}

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
 * The safe, displayable form of a provider endpoint URL plus honesty flags.
 *
 * An RPC / quote endpoint may embed a secret in its userinfo (`https://user:pass@host`),
 * query string (`?api-key=…`), or an opaque path segment (`…/v1/<APIKEY>`). It is therefore
 * NEVER safe to echo a raw provider URL. {@link redactEndpoint} reduces a URL to
 * `scheme://host[:port]` — dropping userinfo, path, query, and fragment — so the host can be
 * shown for diagnostics without leaking a key.
 */
export interface RedactedEndpoint {
  /** Safe-to-display form: `scheme://host[:port]`. Never the raw secret-bearing URL. */
  readonly display: string;
  /** True only when the input parsed as a valid absolute http(s) URL. */
  readonly valid: boolean;
  /**
   * True when redaction actually dropped something secret-bearing (userinfo, a non-root path,
   * a query string, or a fragment) or refused to echo an unparseable / unsupported URL.
   */
  readonly redactionApplied: boolean;
}

/**
 * Reduce a provider endpoint URL to a safe `scheme://host[:port]` display string.
 *
 * Only `http`/`https` are accepted (the read-only provider surface speaks HTTP). The userinfo,
 * path, query, and fragment are ALWAYS dropped — those are the places a key hides — and the host
 * is additionally passed through {@link redactString} as a belt-and-braces backstop. An empty,
 * non-string, unparseable, or non-http(s) input never echoes the raw value; it returns a fixed
 * placeholder and `valid: false`. Pure and deterministic.
 */
export function redactEndpoint(url: unknown): RedactedEndpoint {
  if (typeof url !== "string" || url.trim().length === 0) {
    return { display: "[no-endpoint]", valid: false, redactionApplied: false };
  }
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    // Never echo an unparseable URL — refusing to display IS a redaction.
    return { display: "[invalid-endpoint]", valid: false, redactionApplied: true };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { display: "[unsupported-scheme]", valid: false, redactionApplied: true };
  }
  const droppedSomething =
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    (parsed.pathname.length > 0 && parsed.pathname !== "/") ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0;
  // Host only (includes a non-default port). Belt-and-braces scrub in case a host is secret-shaped.
  const safeHost = redactString(parsed.host);
  const display = `${parsed.protocol}//${safeHost}`;
  return { display, valid: true, redactionApplied: droppedSomething || safeHost !== parsed.host };
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

  // S111: a transaction SIGNATURE is public chain data, but a 64-byte base58 signature is
  // shape-identical to a 64-byte base58 secret key. The only sound discriminator is the key it
  // lives under: the signer boundary never emits a secret under a signature-named key, so a
  // well-formed value under exactly one of these keys is preserved verbatim. Free-text
  // redaction (redactString) is unchanged and still scrubs any long base58 blob.
  if (keyHint !== undefined && typeof value === "string" && isSignatureKey(keyHint) && TX_SIGNATURE_SHAPE.test(value)) {
    return value;
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
