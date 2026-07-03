/**
 * PRODUCTION OPERATOR CONFIG (`live.operator.config.v1`, Sprint 109, Part 3).
 *
 * The single strict, fail-closed validator for a production/canary operator configuration. Part 3
 * turns the Part 2 RC into a supervised operator release; this module is the gate a config file
 * must pass BEFORE any operator command will use it. Conventions, all enforced in code:
 *
 *   - FAIL CLOSED. A missing field, an unknown field, an out-of-ceiling cap, an unsafe endpoint,
 *     or a secret-looking anything REFUSES the whole config. There is no "best effort" parse.
 *   - NO SECRETS, EVER. The config carries a wallet PUBLIC key at most. Any sensitive-named key
 *     (secretKey / privateKey / seed / mnemonic / apiKey / …) anywhere in the document is refused,
 *     and any secret-SHAPED string value (long base58 / long hex) is refused too. The backend
 *     custodies no keys; a config file must not become the place one leaks.
 *   - CAPS ONLY TIGHTEN. Every numeric cap is validated against the same absolute hard ceilings
 *     the live policy + escalation policy enforce. Asking for more is refused, never clamped up.
 *   - PINNED LITERALS. `phantomApprovalRequired`, `backendCustodiesNoKeys`, `backendNeverSends`
 *     must be literal `true` and `largeTradesEnabled` literal `false` in every valid config.
 *   - The RPC endpoint must be a plain `https://` URL with NO userinfo, NO query string and NO
 *     fragment — the places URL-embedded keys hide. Operators who use a keyed provider endpoint
 *     keep that key in the BROWSER live console (their own machine), never in this config.
 *
 * Pure: no clock, no network, no I/O. The caller supplies everything.
 */

import { isSensitiveKey, redactEndpoint, redactString } from "@soulmaker/security";

import { LIVE_ESCALATION_HARD_CEILINGS, LIVE_ESCALATION_MIN_COOLDOWN_MS } from "./escalation.js";
import { LIVE_HARD_CEILINGS } from "./policy.js";

export const LIVE_OPERATOR_CONFIG_SCHEMA_VERSION = "live.operator.config.v1";
export const LIVE_OPERATOR_CONFIG_VALIDATION_SCHEMA_VERSION = "live.operator.config.validation.v1";

/**
 * The four operator RUN modes (a strict subset of the loop's mode machine — `paused` and `killed`
 * are runtime states, not configured intents). Default is `off`.
 */
export const OPERATOR_RUN_MODES = ["off", "observe_only", "paper_shadow", "armed_canary"] as const;
export type OperatorRunMode = (typeof OPERATOR_RUN_MODES)[number];

/** Mode privilege order — a run may only ever REDUCE privilege relative to the config. */
export const OPERATOR_MODE_RANK: Readonly<Record<OperatorRunMode, number>> = {
  off: 0,
  observe_only: 1,
  paper_shadow: 2,
  armed_canary: 3,
};

/** Bounds for quote freshness (TTL) — a TTL of zero would block everything; over a minute is stale-by-design. */
export const OPERATOR_QUOTE_TTL_BOUNDS = { minMs: 1_000, maxMs: 60_000 } as const;

/** Ceiling on the cooldown so a typo cannot silently disable the loop for a year. */
export const OPERATOR_MAX_COOLDOWN_MS = 86_400_000; // 24h

export interface LiveOperatorConfig {
  schemaVersion: typeof LIVE_OPERATOR_CONFIG_SCHEMA_VERSION;
  /** Short human label for the operator (audit trail; never an account identifier). */
  operatorLabel: string;
  /** The configured ceiling mode — a run may request this mode or anything weaker, never stronger. */
  mode: OperatorRunMode;
  /** The operator's PUBLIC wallet key (base58). Required for armed_canary; never a secret. */
  walletPublicKey: string | null;
  /** Plain https endpoint (no userinfo / query / fragment — the places URL keys hide). */
  rpcEndpointHttps: string;
  /** Per-canary spend ceiling in SOL (≤ the escalation hard ceiling). */
  maxCanarySol: number;
  /** Canaries permitted in one operator session (≤ the escalation hard ceiling). */
  maxCanariesPerSession: number;
  /** Canaries permitted per UTC day (≤ the escalation hard ceiling). */
  maxCanariesPerDay: number;
  /** Cumulative daily realized-loss ceiling in SOL (≤ the escalation hard ceiling). */
  maxDailyLossSol: number;
  /** Quote time-to-live in milliseconds (bounded; stale quotes fail closed). */
  quoteTtlMs: number;
  /** Slippage ceiling in basis points (≤ the live-policy hard ceiling). */
  maxSlippageBps: number;
  /** Minimum milliseconds between canaries (≥ the escalation floor). */
  cooldownMs: number;
  /** Consecutive failed/rejected attempts before the loop refuses outright (≤ ceiling). */
  maxFailedAttempts: number;
  /** Panic stop. When true, EVERY operator action is blocked (even observe). */
  killSwitchEngaged: boolean;
  /** Emergency-stop sentinel state. When true, EVERY operator action is blocked. */
  emergencyStopEngaged: boolean;
  /** Pinned literal — a human must approve every real transaction in Phantom. */
  phantomApprovalRequired: true;
  /** Pinned literal — Part 3 never enables larger-than-canary trades. */
  largeTradesEnabled: false;
  /** Pinned literals — the backend holds no key and never sends. */
  backendCustodiesNoKeys: true;
  backendNeverSends: true;
}

export const OPERATOR_CONFIG_BLOCK_CODES = [
  "kill-switch-engaged",
  "emergency-stop-engaged",
  "mode-not-armed-canary",
  "wallet-public-key-missing",
] as const;
export type OperatorConfigBlockCode = (typeof OPERATOR_CONFIG_BLOCK_CODES)[number];

/** The validation artifact `live:operator:validate` emits. Echoes the endpoint HOST only. */
export interface OperatorConfigValidation {
  schemaVersion: typeof LIVE_OPERATOR_CONFIG_VALIDATION_SCHEMA_VERSION;
  verdict: "valid";
  mode: OperatorRunMode;
  operatorLabel: string;
  /** Host-only endpoint display (never the full URL). */
  rpcEndpointHost: string;
  walletPublicKeyPresent: boolean;
  caps: {
    maxCanarySol: number;
    maxCanariesPerSession: number;
    maxCanariesPerDay: number;
    maxDailyLossSol: number;
    quoteTtlMs: number;
    maxSlippageBps: number;
    cooldownMs: number;
    maxFailedAttempts: number;
  };
  ceilings: {
    maxCanarySol: number;
    maxCanariesPerSession: number;
    maxCanariesPerDay: number;
    maxDailyLossSol: number;
    maxSlippageBps: number;
  };
  /** Whether THIS config would permit an armed_canary run right now (never an authorization). */
  armedCanaryPermitted: boolean;
  blockingReasons: OperatorConfigBlockCode[];
  warnings: string[];
  /** Pinned honesty literals. */
  phantomApprovalRequired: true;
  largeTradesEnabled: false;
  backendCustodiesNoKeys: true;
  backendNeverSends: true;
  notProfitabilityClaim: true;
}

export class LiveOperatorConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveOperatorConfigError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Control characters (including NUL), BOM, and line/paragraph separators are refused in every string. */
function hasForbiddenChars(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f\ufeff\u2028\u2029]/.test(value);
}

/** A string value that redaction would alter is secret-shaped (long base58/hex, bearer, key=…). */
function isSecretShaped(value: string): boolean {
  return redactString(value) !== value;
}

/**
 * Deep-scan an arbitrary parsed JSON document for sensitive-NAMED keys, secret-SHAPED string
 * values and forbidden control characters. Throws on the first hit. Used on the RAW config
 * document before any field parsing, so a rejected config is never partially interpreted.
 */
export function assertNoSecretMaterial(value: unknown, where = "config"): void {
  if (typeof value === "string") {
    if (hasForbiddenChars(value)) throw new LiveOperatorConfigError(`${where} contains a control character / BOM and is refused`);
    if (isSecretShaped(value)) throw new LiveOperatorConfigError(`${where} carries a secret-shaped value and is refused — this validator never accepts key material`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoSecretMaterial(v, `${where}[${i}]`));
    return;
  }
  if (isObject(value)) {
    for (const [key, v] of Object.entries(value)) {
      if (hasForbiddenChars(key)) throw new LiveOperatorConfigError(`${where} carries a key with a control character / BOM and is refused`);
      if (isSensitiveKey(key)) {
        throw new LiveOperatorConfigError(
          `${where} carries sensitive-named field "${key}" — a seed phrase, private key, or API key must NEVER appear in an operator config. The backend custodies no keys.`,
        );
      }
      assertNoSecretMaterial(v, `${where}.${key}`);
    }
  }
}

const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function requireLabel(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new LiveOperatorConfigError(`${name} must be a non-empty string`);
  const trimmed = value.trim();
  if (trimmed.length > 80) throw new LiveOperatorConfigError(`${name} must be ≤ 80 characters`);
  if (hasForbiddenChars(trimmed)) throw new LiveOperatorConfigError(`${name} contains a control character and is refused`);
  if (isSecretShaped(trimmed)) throw new LiveOperatorConfigError(`${name} is secret-shaped and is refused`);
  return trimmed;
}

function requireBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new LiveOperatorConfigError(`${name} must be a boolean (missing fields fail closed — state it explicitly)`);
  return value;
}

function requirePositiveNumber(value: unknown, ceiling: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new LiveOperatorConfigError(`${name} must be a positive finite number`);
  if (value > ceiling) throw new LiveOperatorConfigError(`${name} (${value}) exceeds the hard ceiling (${ceiling}) — caps only tighten, never loosen`);
  return value;
}

function requirePositiveInt(value: unknown, ceiling: number, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new LiveOperatorConfigError(`${name} must be a positive integer`);
  if (value > ceiling) throw new LiveOperatorConfigError(`${name} (${value}) exceeds the hard ceiling (${ceiling}) — caps only tighten, never loosen`);
  return value;
}

/**
 * Validate the RPC endpoint: plain `https://` only, and structurally free of the places a key
 * hides (userinfo, query string, fragment). Path segments are allowed (some providers route by
 * path) but a secret-shaped path segment is refused by the document-wide scan above.
 */
function requireRpcEndpoint(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new LiveOperatorConfigError("rpcEndpointHttps must be a non-empty https URL string");
  const raw = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new LiveOperatorConfigError("rpcEndpointHttps is not a parseable URL");
  }
  if (parsed.protocol !== "https:") throw new LiveOperatorConfigError("rpcEndpointHttps must use https:// (plain http and every other scheme are refused)");
  if (parsed.username.length > 0 || parsed.password.length > 0) throw new LiveOperatorConfigError("rpcEndpointHttps must not embed userinfo (user:pass@) — that is where credentials leak");
  if (parsed.search.length > 0) {
    throw new LiveOperatorConfigError(
      "rpcEndpointHttps must not carry a query string — URL-embedded API keys are refused. Use a plain endpoint here; a keyed endpoint belongs only in the browser live console.",
    );
  }
  if (parsed.hash.length > 0) throw new LiveOperatorConfigError("rpcEndpointHttps must not carry a #fragment");
  return raw;
}

export interface BuildOperatorConfigInput {
  operatorLabel: string;
  rpcEndpointHttps: string;
  mode?: OperatorRunMode;
  walletPublicKey?: string | null;
  maxCanarySol?: number;
  maxCanariesPerSession?: number;
  maxCanariesPerDay?: number;
  maxDailyLossSol?: number;
  quoteTtlMs?: number;
  maxSlippageBps?: number;
  cooldownMs?: number;
  maxFailedAttempts?: number;
  killSwitchEngaged?: boolean;
  emergencyStopEngaged?: boolean;
}

/**
 * Build a complete operator config from a partial input with CONSERVATIVE defaults (mode `off`,
 * the tiny escalation defaults, kill switch not engaged). `operatorLabel` and `rpcEndpointHttps`
 * are always required. Throws on anything that cannot be made safe. The pinned literals are set
 * here and can never be configured to anything else.
 */
export function buildOperatorConfig(input: BuildOperatorConfigInput): LiveOperatorConfig {
  assertNoSecretMaterial(input, "config input");
  const mode = input.mode ?? "off";
  if (!(OPERATOR_RUN_MODES as readonly string[]).includes(mode)) {
    throw new LiveOperatorConfigError(`mode must be one of ${OPERATOR_RUN_MODES.join(" | ")}`);
  }
  let walletPublicKey: string | null = null;
  if (input.walletPublicKey !== undefined && input.walletPublicKey !== null) {
    if (typeof input.walletPublicKey !== "string" || !BASE58_PUBKEY.test(input.walletPublicKey)) {
      throw new LiveOperatorConfigError("walletPublicKey must be a base58 PUBLIC key (32–44 chars) — never any longer, never a secret");
    }
    walletPublicKey = input.walletPublicKey;
  }
  if (mode === "armed_canary" && walletPublicKey === null) {
    throw new LiveOperatorConfigError("mode armed_canary requires walletPublicKey — the operator must state which PUBLIC wallet the human will sign from");
  }
  const cooldownMs = input.cooldownMs ?? 300_000;
  if (!Number.isInteger(cooldownMs) || cooldownMs < LIVE_ESCALATION_MIN_COOLDOWN_MS || cooldownMs > OPERATOR_MAX_COOLDOWN_MS) {
    throw new LiveOperatorConfigError(`cooldownMs must be an integer between ${LIVE_ESCALATION_MIN_COOLDOWN_MS} and ${OPERATOR_MAX_COOLDOWN_MS}`);
  }
  const quoteTtlMs = input.quoteTtlMs ?? 8_000;
  if (!Number.isInteger(quoteTtlMs) || quoteTtlMs < OPERATOR_QUOTE_TTL_BOUNDS.minMs || quoteTtlMs > OPERATOR_QUOTE_TTL_BOUNDS.maxMs) {
    throw new LiveOperatorConfigError(`quoteTtlMs must be an integer between ${OPERATOR_QUOTE_TTL_BOUNDS.minMs} and ${OPERATOR_QUOTE_TTL_BOUNDS.maxMs} (stale quotes fail closed)`);
  }
  return {
    schemaVersion: LIVE_OPERATOR_CONFIG_SCHEMA_VERSION,
    operatorLabel: requireLabel(input.operatorLabel, "operatorLabel"),
    mode,
    walletPublicKey,
    rpcEndpointHttps: requireRpcEndpoint(input.rpcEndpointHttps),
    maxCanarySol: requirePositiveNumber(input.maxCanarySol ?? 0.005, LIVE_ESCALATION_HARD_CEILINGS.maxCanarySol, "maxCanarySol"),
    maxCanariesPerSession: requirePositiveInt(input.maxCanariesPerSession ?? 1, LIVE_ESCALATION_HARD_CEILINGS.maxCanariesPerSession, "maxCanariesPerSession"),
    maxCanariesPerDay: requirePositiveInt(input.maxCanariesPerDay ?? 1, LIVE_ESCALATION_HARD_CEILINGS.maxCanariesPerDay, "maxCanariesPerDay"),
    maxDailyLossSol: requirePositiveNumber(input.maxDailyLossSol ?? 0.01, LIVE_ESCALATION_HARD_CEILINGS.maxDailyLossSol, "maxDailyLossSol"),
    quoteTtlMs,
    maxSlippageBps: requirePositiveInt(input.maxSlippageBps ?? 100, LIVE_HARD_CEILINGS.maxSlippageBps, "maxSlippageBps"),
    cooldownMs,
    maxFailedAttempts: requirePositiveInt(input.maxFailedAttempts ?? 1, LIVE_ESCALATION_HARD_CEILINGS.maxFailedAttempts, "maxFailedAttempts"),
    killSwitchEngaged: input.killSwitchEngaged ?? false,
    emergencyStopEngaged: input.emergencyStopEngaged ?? false,
    phantomApprovalRequired: true,
    largeTradesEnabled: false,
    backendCustodiesNoKeys: true,
    backendNeverSends: true,
  };
}

const CONFIG_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "operatorLabel",
  "mode",
  "walletPublicKey",
  "rpcEndpointHttps",
  "maxCanarySol",
  "maxCanariesPerSession",
  "maxCanariesPerDay",
  "maxDailyLossSol",
  "quoteTtlMs",
  "maxSlippageBps",
  "cooldownMs",
  "maxFailedAttempts",
  "killSwitchEngaged",
  "emergencyStopEngaged",
  "phantomApprovalRequired",
  "largeTradesEnabled",
  "backendCustodiesNoKeys",
  "backendNeverSends",
]);

/**
 * Strictly validate a parsed JSON document as a {@link LiveOperatorConfig}. CLOSED schema: every
 * field above is REQUIRED, unknown fields are refused, sensitive-named/secret-shaped anything is
 * refused, pinned literals are re-checked, and every cap is re-validated against its ceiling.
 */
export function validateOperatorConfig(value: unknown): LiveOperatorConfig {
  if (!isObject(value)) throw new LiveOperatorConfigError("operator config must be a JSON object");
  // Secret scan FIRST — a rejected config is never partially interpreted.
  assertNoSecretMaterial(value, "config");
  for (const key of Object.keys(value)) {
    if (!CONFIG_KEYS.has(key)) throw new LiveOperatorConfigError(`operator config carries unknown field "${key}" — the v1 schema is CLOSED (fail closed, remove it)`);
  }
  for (const key of CONFIG_KEYS) {
    if (!(key in value)) throw new LiveOperatorConfigError(`operator config is missing required field "${key}" — a production config states every control explicitly`);
  }
  if (value.schemaVersion !== LIVE_OPERATOR_CONFIG_SCHEMA_VERSION) {
    throw new LiveOperatorConfigError(`operator config schemaVersion must be "${LIVE_OPERATOR_CONFIG_SCHEMA_VERSION}"`);
  }
  if (value.phantomApprovalRequired !== true) {
    throw new LiveOperatorConfigError("phantomApprovalRequired must be the literal true — a human Phantom approval is required for every real canary, without exception");
  }
  if (value.largeTradesEnabled !== false) {
    throw new LiveOperatorConfigError("largeTradesEnabled must be the literal false — larger-than-canary trading stays disabled unless separately authorized in writing");
  }
  if (value.backendCustodiesNoKeys !== true) throw new LiveOperatorConfigError("backendCustodiesNoKeys must be the literal true");
  if (value.backendNeverSends !== true) throw new LiveOperatorConfigError("backendNeverSends must be the literal true");
  if (typeof value.mode !== "string" || !(OPERATOR_RUN_MODES as readonly string[]).includes(value.mode)) {
    throw new LiveOperatorConfigError(`mode must be one of ${OPERATOR_RUN_MODES.join(" | ")}`);
  }
  if (value.walletPublicKey !== null && typeof value.walletPublicKey !== "string") {
    throw new LiveOperatorConfigError("walletPublicKey must be a base58 string or null");
  }
  return buildOperatorConfig({
    operatorLabel: value.operatorLabel as string,
    rpcEndpointHttps: value.rpcEndpointHttps as string,
    mode: value.mode as OperatorRunMode,
    walletPublicKey: value.walletPublicKey as string | null,
    maxCanarySol: value.maxCanarySol as number,
    maxCanariesPerSession: value.maxCanariesPerSession as number,
    maxCanariesPerDay: value.maxCanariesPerDay as number,
    maxDailyLossSol: value.maxDailyLossSol as number,
    quoteTtlMs: value.quoteTtlMs as number,
    maxSlippageBps: value.maxSlippageBps as number,
    cooldownMs: value.cooldownMs as number,
    maxFailedAttempts: value.maxFailedAttempts as number,
    killSwitchEngaged: requireBoolean(value.killSwitchEngaged, "killSwitchEngaged"),
    emergencyStopEngaged: requireBoolean(value.emergencyStopEngaged, "emergencyStopEngaged"),
  });
}

/**
 * Derive the validation artifact for an ALREADY-VALID config: would an armed_canary run be
 * permitted right now, and why not. This is a report, never an authorization — the human Phantom
 * signature remains the only thing that can move funds.
 */
export function evaluateOperatorConfig(config: LiveOperatorConfig): OperatorConfigValidation {
  const blockingReasons: OperatorConfigBlockCode[] = [];
  if (config.killSwitchEngaged) blockingReasons.push("kill-switch-engaged");
  if (config.emergencyStopEngaged) blockingReasons.push("emergency-stop-engaged");
  if (config.mode !== "armed_canary") blockingReasons.push("mode-not-armed-canary");
  if (config.walletPublicKey === null) blockingReasons.push("wallet-public-key-missing");

  const warnings: string[] = [];
  if (config.maxCanarySol >= LIVE_ESCALATION_HARD_CEILINGS.maxCanarySol) warnings.push("maxCanarySol is at the absolute ceiling — consider a smaller canary");
  if (config.maxCanariesPerSession > 1) warnings.push("maxCanariesPerSession > 1 — one canary per session is the recommended production posture");

  const endpoint = redactEndpoint(config.rpcEndpointHttps);
  return {
    schemaVersion: LIVE_OPERATOR_CONFIG_VALIDATION_SCHEMA_VERSION,
    verdict: "valid",
    mode: config.mode,
    operatorLabel: config.operatorLabel,
    rpcEndpointHost: endpoint.display,
    walletPublicKeyPresent: config.walletPublicKey !== null,
    caps: {
      maxCanarySol: config.maxCanarySol,
      maxCanariesPerSession: config.maxCanariesPerSession,
      maxCanariesPerDay: config.maxCanariesPerDay,
      maxDailyLossSol: config.maxDailyLossSol,
      quoteTtlMs: config.quoteTtlMs,
      maxSlippageBps: config.maxSlippageBps,
      cooldownMs: config.cooldownMs,
      maxFailedAttempts: config.maxFailedAttempts,
    },
    ceilings: {
      maxCanarySol: LIVE_ESCALATION_HARD_CEILINGS.maxCanarySol,
      maxCanariesPerSession: LIVE_ESCALATION_HARD_CEILINGS.maxCanariesPerSession,
      maxCanariesPerDay: LIVE_ESCALATION_HARD_CEILINGS.maxCanariesPerDay,
      maxDailyLossSol: LIVE_ESCALATION_HARD_CEILINGS.maxDailyLossSol,
      maxSlippageBps: LIVE_HARD_CEILINGS.maxSlippageBps,
    },
    armedCanaryPermitted: blockingReasons.length === 0,
    blockingReasons,
    warnings,
    phantomApprovalRequired: true,
    largeTradesEnabled: false,
    backendCustodiesNoKeys: true,
    backendNeverSends: true,
    notProfitabilityClaim: true,
  };
}
