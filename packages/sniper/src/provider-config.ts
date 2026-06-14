/**
 * Read-only PROVIDER CONFIGURATION resolution (Sprint 105-B alpha layer).
 *
 * Resolves which read-only endpoints a no-send alpha campaign / provider doctor should probe, from
 * three sources in precedence order — explicit flags > environment variables > safe public defaults.
 * It is **pure** (no fs / network / RPC / clock) and is structurally read-only:
 *
 *   - It NEVER requires a secret. The default endpoints are public, keyless tiers.
 *   - It NEVER carries a send / sign / live field; a config can only describe WHERE to READ.
 *   - A resolved endpoint keeps the raw URL ONLY so the orchestrator can make the read-only call;
 *     the artifact layer must serialize ONLY {@link ResolvedProviderEndpoint.redacted}.display — an
 *     endpoint with userinfo / a query token / a secret-shaped span is flagged `containsSecret` and
 *     its display is reduced to `scheme://host` so a key can never be printed.
 *   - timeout / retry are clamped to safe bounds; a slow or flaky provider can never be told to
 *     hammer or hang.
 *
 * This module reads `env` only as a plain object handed in by the caller (the CLI owns
 * `process.env`); it never touches the real environment itself.
 */

import { redactString, redactEndpoint, type RedactedEndpoint } from "@soulmaker/security";

/** Closed mode set a read-only provider config can be scoped to (mirrors the campaign / alpha report). */
export const READONLY_PROVIDER_MODES = ["paper", "mainnet-dry-run", "devnet-review"] as const;
export type ReadonlyProviderMode = (typeof READONLY_PROVIDER_MODES)[number];

/** Closed network set, derived from the mode. */
export const READONLY_PROVIDER_NETWORKS = ["mainnet-beta", "devnet"] as const;
export type ReadonlyProviderNetwork = (typeof READONLY_PROVIDER_NETWORKS)[number];

/** Where a resolved endpoint value came from. */
export type ReadonlyProviderSource = "flag" | "env" | "default" | "none";

/** Safe, public, keyless defaults. The Jupiter base matches `@soulmaker/quotefetch`'s lite tier. */
export const DEFAULT_MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";
export const DEFAULT_DEVNET_RPC_URL = "https://api.devnet.solana.com";
export const DEFAULT_JUPITER_QUOTE_URL = "https://lite-api.jup.ag/swap/v1";

/** Timeout / retry bounds — a config can never tell a probe to hang forever or hammer a provider. */
export const PROVIDER_TIMEOUT_MS_MIN = 1_000;
export const PROVIDER_TIMEOUT_MS_MAX = 60_000;
export const PROVIDER_TIMEOUT_MS_DEFAULT = 10_000;
export const PROVIDER_RETRY_LIMIT_MIN = 0;
export const PROVIDER_RETRY_LIMIT_MAX = 5;
export const PROVIDER_RETRY_LIMIT_DEFAULT = 1;

const MAX_PROFILE_LABEL_LEN = 64;

/** The environment variable names this resolver reads (all optional; never a secret). */
export const READONLY_PROVIDER_ENV_VARS = {
  rpcUrl: "SOULMAKER_READONLY_RPC_URL",
  /** Falls back to the existing core convention if the read-only-specific one is unset. */
  rpcUrlFallback: "SOULMAKER_RPC_URL",
  jupiterUrl: "SOULMAKER_JUPITER_QUOTE_URL",
  providerProfile: "SOULMAKER_READONLY_PROVIDER_PROFILE",
  timeoutMs: "SOULMAKER_PROVIDER_TIMEOUT_MS",
  retryLimit: "SOULMAKER_PROVIDER_RETRY_LIMIT",
} as const;

/** Thrown only for a programming-level misuse (e.g. an unknown mode); endpoint problems never throw. */
export class ReadonlyProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadonlyProviderConfigError";
  }
}

/** A single resolved read-only endpoint. */
export interface ResolvedProviderEndpoint {
  /**
   * The raw URL the orchestrator should call, or `null` when none resolved. NEVER serialize this
   * into an artifact — use {@link redacted}.display instead.
   */
  readonly url: string | null;
  /** Which source supplied the value. */
  readonly source: ReadonlyProviderSource;
  /** Safe display form (`scheme://host`) + honesty flags from {@link redactEndpoint}. */
  readonly redacted: RedactedEndpoint;
  /** True when the raw URL embeds a secret (userinfo / query token / secret-shaped span) — never print raw. */
  readonly containsSecret: boolean;
  /** True when the URL parsed as a valid absolute http(s) URL. */
  readonly valid: boolean;
}

/** The fully resolved read-only provider configuration. */
export interface ResolvedReadonlyProviderConfig {
  readonly mode: ReadonlyProviderMode;
  readonly network: ReadonlyProviderNetwork;
  /** A short, bounded, redaction-safe label describing the endpoint set. */
  readonly providerProfile: string;
  readonly rpc: ResolvedProviderEndpoint;
  readonly jupiterQuote: ResolvedProviderEndpoint;
  readonly timeoutMs: number;
  readonly retryLimit: number;
  /** Honest notes about how values were resolved / clamped (redaction-safe). */
  readonly notes: string[];
  /** This config can only describe WHERE to READ — pinned, structural proof it grants no live path. */
  readonly readOnly: true;
  readonly noSend: true;
  readonly noSigner: true;
}

/** What {@link resolveReadonlyProviderConfig} accepts. */
export interface ResolveReadonlyProviderConfigInput {
  /** Explicit CLI flags (highest precedence). */
  readonly flags?: {
    readonly mode?: string | null;
    readonly rpcUrl?: string | null;
    readonly jupiterUrl?: string | null;
    readonly providerProfile?: string | null;
    readonly timeoutMs?: string | number | null;
    readonly retryLimit?: string | number | null;
  };
  /** A plain env map handed in by the caller (never the real process.env from inside this module). */
  readonly env?: Record<string, string | undefined>;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Does the raw URL embed a secret (userinfo / query token / secret-shaped span)? Path alone does NOT. */
function endpointContainsSecret(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.username.length > 0 || u.password.length > 0 || u.search.length > 0) return true;
  } catch {
    // Unparseable; the redactor still gets the final say below.
  }
  return redactString(url) !== url;
}

function resolveEndpoint(
  flagValue: string | null | undefined,
  envValue: string | undefined,
  defaultValue: string,
): ResolvedProviderEndpoint {
  let url: string;
  let source: ReadonlyProviderSource;
  if (isNonEmptyString(flagValue)) {
    url = flagValue.trim();
    source = "flag";
  } else if (isNonEmptyString(envValue)) {
    url = envValue.trim();
    source = "env";
  } else {
    url = defaultValue;
    source = "default";
  }
  const redacted = redactEndpoint(url);
  return {
    url,
    source,
    redacted,
    containsSecret: endpointContainsSecret(url),
    valid: redacted.valid,
  };
}

/** Clamp a flag/env numeric string to [min, max], falling back to a default; records a note on clamp. */
function clampNumeric(
  flagValue: string | number | null | undefined,
  envValue: string | undefined,
  def: number,
  min: number,
  max: number,
  label: string,
  notes: string[],
): number {
  let raw: number | null = null;
  let from: ReadonlyProviderSource = "default";
  if (flagValue !== undefined && flagValue !== null && `${flagValue}`.trim().length > 0) {
    raw = Number.parseInt(`${flagValue}`.trim(), 10);
    from = "flag";
  } else if (isNonEmptyString(envValue)) {
    raw = Number.parseInt(envValue.trim(), 10);
    from = "env";
  }
  if (raw === null || !Number.isFinite(raw)) return def;
  if (raw < min) {
    notes.push(`${label} ${raw} (${from}) is below the floor ${min}; clamped to ${min}.`);
    return min;
  }
  if (raw > max) {
    notes.push(`${label} ${raw} (${from}) exceeds the ceiling ${max}; clamped to ${max}.`);
    return max;
  }
  return raw;
}

function normalizeMode(value: string | null | undefined): ReadonlyProviderMode {
  if (value === undefined || value === null || value.trim().length === 0) return "paper";
  const mode = value.trim();
  if (!(READONLY_PROVIDER_MODES as readonly string[]).includes(mode)) {
    throw new ReadonlyProviderConfigError(`mode must be one of: ${READONLY_PROVIDER_MODES.join(", ")}`);
  }
  return mode as ReadonlyProviderMode;
}

function networkForMode(mode: ReadonlyProviderMode): ReadonlyProviderNetwork {
  return mode === "devnet-review" ? "devnet" : "mainnet-beta";
}

/** Build a short, bounded, redaction-safe profile label. */
function resolveProfile(
  flagProfile: string | null | undefined,
  envProfile: string | undefined,
  rpc: ResolvedProviderEndpoint,
  jupiter: ResolvedProviderEndpoint,
): string {
  const explicit = isNonEmptyString(flagProfile) ? flagProfile.trim() : isNonEmptyString(envProfile) ? envProfile.trim() : null;
  if (explicit !== null) {
    const bounded = redactString(explicit).slice(0, MAX_PROFILE_LABEL_LEN).trim();
    return bounded.length > 0 ? bounded : "custom";
  }
  const bothDefault = rpc.source === "default" && jupiter.source === "default";
  if (bothDefault) return "public-default";
  return "custom";
}

/**
 * Resolve the read-only provider configuration from flags + env + safe public defaults. Pure and
 * deterministic. Throws {@link ReadonlyProviderConfigError} ONLY for an invalid mode; an unreachable
 * / secret-shaped endpoint is reported via flags on the resolved endpoint, never thrown.
 */
export function resolveReadonlyProviderConfig(input: ResolveReadonlyProviderConfigInput = {}): ResolvedReadonlyProviderConfig {
  const flags = input.flags ?? {};
  const env = input.env ?? {};
  const notes: string[] = [];

  const mode = normalizeMode(flags.mode);
  const network = networkForMode(mode);

  const defaultRpc = network === "devnet" ? DEFAULT_DEVNET_RPC_URL : DEFAULT_MAINNET_RPC_URL;
  const envRpc = env[READONLY_PROVIDER_ENV_VARS.rpcUrl] ?? env[READONLY_PROVIDER_ENV_VARS.rpcUrlFallback];
  const rpc = resolveEndpoint(flags.rpcUrl, envRpc, defaultRpc);
  const jupiterQuote = resolveEndpoint(flags.jupiterUrl, env[READONLY_PROVIDER_ENV_VARS.jupiterUrl], DEFAULT_JUPITER_QUOTE_URL);

  if (rpc.containsSecret) notes.push("The RPC endpoint embeds credentials; only its host is shown and it is never printed raw.");
  if (jupiterQuote.containsSecret) notes.push("The Jupiter quote endpoint embeds credentials; only its host is shown and it is never printed raw.");
  if (!rpc.valid) notes.push("The RPC endpoint is not a valid http(s) URL; it will be treated as misconfigured.");
  if (!jupiterQuote.valid) notes.push("The Jupiter quote endpoint is not a valid http(s) URL; it will be treated as misconfigured.");

  const timeoutMs = clampNumeric(
    flags.timeoutMs,
    env[READONLY_PROVIDER_ENV_VARS.timeoutMs],
    PROVIDER_TIMEOUT_MS_DEFAULT,
    PROVIDER_TIMEOUT_MS_MIN,
    PROVIDER_TIMEOUT_MS_MAX,
    "provider timeout",
    notes,
  );
  const retryLimit = clampNumeric(
    flags.retryLimit,
    env[READONLY_PROVIDER_ENV_VARS.retryLimit],
    PROVIDER_RETRY_LIMIT_DEFAULT,
    PROVIDER_RETRY_LIMIT_MIN,
    PROVIDER_RETRY_LIMIT_MAX,
    "provider retry limit",
    notes,
  );

  const providerProfile = resolveProfile(flags.providerProfile, env[READONLY_PROVIDER_ENV_VARS.providerProfile], rpc, jupiterQuote);

  return {
    mode,
    network,
    providerProfile,
    rpc,
    jupiterQuote,
    timeoutMs,
    retryLimit,
    notes,
    readOnly: true,
    noSend: true,
    noSigner: true,
  };
}
