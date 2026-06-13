/**
 * Argument and environment guards for the sidecar invocation. The bridge
 * constructs every argument itself, but these checks are the wall that keeps
 * a future caller from smuggling key material, paths, or shell metacharacters
 * into the engine: the argument vocabulary is a CLOSED allowlist, and the
 * child environment is rebuilt from a NAME allowlist (never forwarded
 * wholesale, never anything secret-shaped).
 */

import { isSensitiveKey } from "@soulmaker/security";

const ALLOWED_LITERAL_ARGS = new Set(["status", "realtime-normalize", "--json", "--created-at"]);

const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/;

/** Value shapes that look like key material; refused even though the closed allowlist already excludes them (defense in depth). */
const SECRET_SHAPES: readonly RegExp[] = [
  /[1-9A-HJ-NP-Za-km-z]{40,}/, // long base58 (secret keys encode to ~88 chars; pubkeys ~44 — refuse both, no argument needs one)
  /(?:0x)?[0-9a-fA-F]{64,}/, // raw hex keys
  /seed|mnemonic|keypair|secret|private|wallet/i,
];

/**
 * Check an argument vector against the closed vocabulary. Returns a problem
 * description, or null when the args are safe.
 */
export function checkEngineArgs(args: readonly string[]): string | null {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (typeof arg !== "string" || arg.length === 0) return `argument ${i} is empty`;
    if (arg.length > 64) return `argument ${i} exceeds 64 characters`;
    if (/[\s\0"'`$&|;<>]/.test(arg)) return `argument ${i} contains whitespace or shell metacharacters`;
    for (const shape of SECRET_SHAPES) {
      if (shape.test(arg)) return `argument ${i} is secret-shaped and is refused`;
    }
    const isCreatedAtValue = i > 0 && args[i - 1] === "--created-at";
    if (isCreatedAtValue) {
      if (!ISO_SHAPE.test(arg)) return `argument ${i} (--created-at value) must be ISO-8601-shaped`;
    } else if (!ALLOWED_LITERAL_ARGS.has(arg)) {
      return `argument ${i} (${JSON.stringify(arg)}) is not in the closed argument vocabulary`;
    }
  }
  return null;
}

/**
 * Environment variable NAMES the child process may receive. Everything else —
 * including every secret-shaped variable — is dropped. PATH/CARGO/RUSTUP are
 * needed so the `cargo run` fallback can find the toolchain; the rest keep
 * process startup working on Windows.
 */
const CHILD_ENV_ALLOWLIST = [
  "PATH",
  "Path",
  "SYSTEMROOT",
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "CARGO_HOME",
  "RUSTUP_HOME",
] as const;

/** Build the minimal child environment from a NAME allowlist. */
export function buildChildEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of CHILD_ENV_ALLOWLIST) {
    const value = source[name];
    // isSensitiveKey is structurally false for every allowlisted name; the
    // check stays as a tripwire should the allowlist ever drift.
    if (typeof value === "string" && value.length > 0 && !isSensitiveKey(name)) {
      env[name] = value;
    }
  }
  return env;
}
