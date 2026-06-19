/**
 * The LIVE-MODE POLICY (Sprint 107, Part 1).
 *
 * One typed, closed-schema policy that gates EVERY real-money action. The policy is the single
 * source of truth for "is a live action permitted, and within what micro-caps". Conventions,
 * all enforced in code (not just docs):
 *
 *   - Live is DISABLED BY DEFAULT. `mode` defaults to "paper" and `liveEnabled` to false; the
 *     default policy permits nothing live.
 *   - Caps only TIGHTEN. Every cap is clamped to an absolute HARD CEILING; a config that asks for
 *     more than the ceiling is refused (never silently raised). There is no path that loosens a
 *     control.
 *   - The backend NEVER custodies a key. The policy describes a Phantom-signed flow: the only
 *     wallet provider permitted for live is "phantom", and the human confirms every transaction in
 *     their own wallet. `backendCustodiesNoKeys` and `phantomSignsInBrowser` are pinned literals.
 *   - Solana mainnet is the ONLY live chain in Part 1. Any other chain on the allowlist is ignored
 *     for live and reported as not-implemented.
 *
 * Two functions matter:
 *   - {@link buildLivePolicy} normalizes a partial operator config into a complete, hard-capped
 *     policy (or throws on a value that cannot be made safe).
 *   - {@link evaluateLivePolicy} derives the gate verdict: may we PREPARE a real transaction, and
 *     may the browser ARM the Phantom canary send. Both default to false; every block is a code.
 */

import { isSensitiveKey } from "@soulmaker/security";

export const LIVE_POLICY_SCHEMA_VERSION = "live.policy.v1";
export const LIVE_POLICY_EVALUATION_SCHEMA_VERSION = "live.policy.evaluation.v1";

/** The live-mode axis (distinct from core TRADING_MODES; see docs/LIVE_EXECUTION_PHANTOM.md). */
export const LIVE_MODES = ["paper", "readonly", "live_prepare", "live_canary"] as const;
export type LiveMode = (typeof LIVE_MODES)[number];

/** The only chain with a live implementation in Part 1. */
export const LIVE_SOLANA_MAINNET_CHAIN_ID = "solana-mainnet";

/** The only wallet provider permitted for a live action: a browser Phantom signature. */
export const LIVE_WALLET_PROVIDERS = ["phantom"] as const;
export type LiveWalletProvider = (typeof LIVE_WALLET_PROVIDERS)[number];

/**
 * Absolute HARD CEILINGS. No policy may exceed these, regardless of config or environment. They
 * are intentionally tiny: Part 1 is a canary release candidate, not a production sniper. Lowering
 * a default below a ceiling is always allowed; raising a value above a ceiling is refused.
 */
export const LIVE_HARD_CEILINGS = {
  /** Per-trade spend ceiling in SOL. */
  maxTradeSol: 0.05,
  /** Per-position ceiling in SOL. */
  maxPositionSol: 0.05,
  /** Trades permitted per UTC day. */
  maxDailyTrades: 5,
  /** Cumulative daily realized-loss ceiling in SOL. */
  maxDailyLossSol: 0.05,
  /** Slippage ceiling in basis points (3%). */
  maxSlippageBps: 300,
  /** Priority-fee ceiling in lamports. */
  priorityFeeCapLamports: 5_000_000,
  /** Highest advisory risk score a live trade may carry (lower is safer). */
  riskScoreCap: 50,
} as const;

/** Conservative DEFAULTS — every one at or below its hard ceiling. */
export const LIVE_POLICY_DEFAULTS = {
  maxTradeSol: 0.005,
  maxPositionSol: 0.005,
  maxDailyTrades: 1,
  maxDailyLossSol: 0.01,
  maxSlippageBps: 100,
  priorityFeeCapLamports: 1_000_000,
  riskScoreCap: 30,
  minLiquidityUsd: 5_000,
  minPoolAgeSeconds: 60,
  maxPoolAgeSeconds: null as number | null,
  quoteTtlMs: 8_000,
  routeTtlMs: 8_000,
  cooldownMs: 30_000,
} as const;

export interface LivePolicyCaps {
  /** Per-trade spend ceiling in SOL. */
  maxTradeSol: number;
  /** Per-position ceiling in SOL. */
  maxPositionSol: number;
  /** Trades permitted per UTC day. */
  maxDailyTrades: number;
  /** Cumulative daily realized-loss ceiling in SOL. */
  maxDailyLossSol: number;
  /** Slippage ceiling in basis points. */
  maxSlippageBps: number;
  /** Priority-fee ceiling in lamports. */
  priorityFeeCapLamports: number;
  /** Highest advisory risk score a live trade may carry. */
  riskScoreCap: number;
}

export interface LivePolicyLiquidity {
  /** Minimum routable liquidity in USD before a live action is considered. */
  minLiquidityUsd: number;
  /** Minimum pool age in seconds (null = no minimum). */
  minPoolAgeSeconds: number | null;
  /** Maximum pool age in seconds (null = no maximum). */
  maxPoolAgeSeconds: number | null;
}

export interface LivePolicyFreshness {
  /** Quote time-to-live in milliseconds. */
  quoteTtlMs: number;
  /** Route time-to-live in milliseconds. */
  routeTtlMs: number;
}

export interface LiveModePolicy {
  schemaVersion: typeof LIVE_POLICY_SCHEMA_VERSION;
  mode: LiveMode;
  /** Master switch. Live actions are impossible unless this is explicitly true. */
  liveEnabled: boolean;
  /** Chains the operator allows. Only {@link LIVE_SOLANA_MAINNET_CHAIN_ID} is live in Part 1. */
  chainAllowlist: string[];
  /** The wallet provider for live actions. Live requires "phantom"; null forbids live. */
  walletProvider: LiveWalletProvider | null;
  caps: LivePolicyCaps;
  liquidity: LivePolicyLiquidity;
  freshness: LivePolicyFreshness;
  /** A live transaction must be simulated/preflighted before it can be armed. Must be true for live. */
  requirePreflightSimulation: boolean;
  /** A human must confirm every transaction in Phantom. Must be true for live. */
  requireManualConfirmation: boolean;
  /** Every live_prepare / live_canary attempt must be journaled to an audit log. Must be true for live. */
  requireAuditLog: boolean;
  /** Panic stop. When true, no live action is permitted. */
  killSwitch: boolean;
  /** Emergency-stop sentinel (file/env) observed by the caller. When true, no live action. */
  emergencyStopFilePresent: boolean;
  /** When non-null, ONLY these mints may trade live. */
  tokenAllowlist: string[] | null;
  /** These mints may never trade live. */
  tokenDenylist: string[];
  /** Minimum milliseconds between live trades. */
  cooldownMs: number;
  /** Pinned honesty literals. */
  backendCustodiesNoKeys: true;
  phantomSignsInBrowser: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
}

export const LIVE_POLICY_BLOCK_CODES = [
  "live-disabled",
  "mode-not-live",
  "kill-switch-active",
  "emergency-stop-present",
  "solana-mainnet-not-allowlisted",
  "wallet-provider-not-phantom",
  "trade-cap-over-ceiling",
  "position-cap-over-ceiling",
  "daily-trades-over-ceiling",
  "daily-loss-cap-over-ceiling",
  "slippage-cap-over-ceiling",
  "priority-fee-over-ceiling",
  "risk-cap-over-ceiling",
  "preflight-simulation-not-required",
  "manual-confirmation-not-required",
  "audit-log-not-required",
  "liquidity-floor-missing",
  "cooldown-invalid",
] as const;
export type LivePolicyBlockCode = (typeof LIVE_POLICY_BLOCK_CODES)[number];

export interface LivePolicyEvaluation {
  schemaVersion: typeof LIVE_POLICY_EVALUATION_SCHEMA_VERSION;
  mode: LiveMode;
  /** May we build a real unsigned transaction (live_prepare or live_canary, fully gated)? */
  prepareAllowed: boolean;
  /** May the browser ARM the Phantom canary send (live_canary only, fully gated)? */
  canaryArmAllowed: boolean;
  blockingReasons: LivePolicyBlockCode[];
  warnings: string[];
  /** The hard ceilings that were applied (echoed for the operator). */
  ceilings: typeof LIVE_HARD_CEILINGS;
  /** Pinned honesty literals. */
  backendCustodiesNoKeys: true;
  phantomSignsInBrowser: true;
  notProfitabilityClaim: true;
}

export class LivePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LivePolicyError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clampPositive(value: number, ceiling: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new LivePolicyError(`${name} must be a positive finite number`);
  }
  if (value > ceiling) {
    throw new LivePolicyError(`${name} (${value}) exceeds the absolute hard ceiling (${ceiling}) — caps only tighten`);
  }
  return value;
}

function clampNonNegativeInt(value: number, ceiling: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new LivePolicyError(`${name} must be a non-negative integer`);
  }
  if (value > ceiling) {
    throw new LivePolicyError(`${name} (${value}) exceeds the absolute hard ceiling (${ceiling}) — caps only tighten`);
  }
  return value;
}

function normalizeMintList(value: unknown, name: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new LivePolicyError(`${name} must be an array of mint strings`);
  return value.map((m, i) => {
    if (typeof m !== "string" || m.trim().length === 0 || m.length > 44) {
      throw new LivePolicyError(`${name}[${i}] must be a non-empty base58 mint string (never paste secret key material)`);
    }
    return m.trim();
  });
}

export interface BuildLivePolicyInput {
  mode?: LiveMode;
  liveEnabled?: boolean;
  chainAllowlist?: string[];
  walletProvider?: LiveWalletProvider | null;
  caps?: Partial<LivePolicyCaps>;
  liquidity?: Partial<LivePolicyLiquidity>;
  freshness?: Partial<LivePolicyFreshness>;
  requirePreflightSimulation?: boolean;
  requireManualConfirmation?: boolean;
  requireAuditLog?: boolean;
  killSwitch?: boolean;
  emergencyStopFilePresent?: boolean;
  tokenAllowlist?: string[] | null;
  tokenDenylist?: string[];
  cooldownMs?: number;
}

/**
 * Normalize a partial operator config into a complete, hard-capped {@link LiveModePolicy}. Throws
 * on any value that cannot be made safe (e.g. a cap above its ceiling). Missing fields fall back to
 * the conservative {@link LIVE_POLICY_DEFAULTS}; an absent policy is therefore paper + live-disabled.
 */
export function buildLivePolicy(input: BuildLivePolicyInput = {}): LiveModePolicy {
  const mode = input.mode ?? "paper";
  if (!(LIVE_MODES as readonly string[]).includes(mode)) {
    throw new LivePolicyError(`mode must be one of ${LIVE_MODES.join("|")}`);
  }
  const walletProvider = input.walletProvider ?? null;
  if (walletProvider !== null && !(LIVE_WALLET_PROVIDERS as readonly string[]).includes(walletProvider)) {
    throw new LivePolicyError(`walletProvider must be one of ${LIVE_WALLET_PROVIDERS.join("|")} or null`);
  }

  const capsIn = input.caps ?? {};
  const caps: LivePolicyCaps = {
    maxTradeSol: clampPositive(capsIn.maxTradeSol ?? LIVE_POLICY_DEFAULTS.maxTradeSol, LIVE_HARD_CEILINGS.maxTradeSol, "caps.maxTradeSol"),
    maxPositionSol: clampPositive(capsIn.maxPositionSol ?? LIVE_POLICY_DEFAULTS.maxPositionSol, LIVE_HARD_CEILINGS.maxPositionSol, "caps.maxPositionSol"),
    maxDailyTrades: clampNonNegativeInt(capsIn.maxDailyTrades ?? LIVE_POLICY_DEFAULTS.maxDailyTrades, LIVE_HARD_CEILINGS.maxDailyTrades, "caps.maxDailyTrades"),
    maxDailyLossSol: clampPositive(capsIn.maxDailyLossSol ?? LIVE_POLICY_DEFAULTS.maxDailyLossSol, LIVE_HARD_CEILINGS.maxDailyLossSol, "caps.maxDailyLossSol"),
    maxSlippageBps: clampNonNegativeInt(capsIn.maxSlippageBps ?? LIVE_POLICY_DEFAULTS.maxSlippageBps, LIVE_HARD_CEILINGS.maxSlippageBps, "caps.maxSlippageBps"),
    priorityFeeCapLamports: clampNonNegativeInt(capsIn.priorityFeeCapLamports ?? LIVE_POLICY_DEFAULTS.priorityFeeCapLamports, LIVE_HARD_CEILINGS.priorityFeeCapLamports, "caps.priorityFeeCapLamports"),
    riskScoreCap: clampNonNegativeInt(capsIn.riskScoreCap ?? LIVE_POLICY_DEFAULTS.riskScoreCap, LIVE_HARD_CEILINGS.riskScoreCap, "caps.riskScoreCap"),
  };

  const liquidityIn = input.liquidity ?? {};
  const minLiquidityUsd = liquidityIn.minLiquidityUsd ?? LIVE_POLICY_DEFAULTS.minLiquidityUsd;
  if (!Number.isFinite(minLiquidityUsd) || minLiquidityUsd < 0) {
    throw new LivePolicyError("liquidity.minLiquidityUsd must be a non-negative number");
  }
  const minPoolAgeSeconds = liquidityIn.minPoolAgeSeconds ?? LIVE_POLICY_DEFAULTS.minPoolAgeSeconds;
  if (minPoolAgeSeconds !== null && (!Number.isFinite(minPoolAgeSeconds) || minPoolAgeSeconds < 0)) {
    throw new LivePolicyError("liquidity.minPoolAgeSeconds must be a non-negative number or null");
  }
  const maxPoolAgeSeconds = liquidityIn.maxPoolAgeSeconds ?? LIVE_POLICY_DEFAULTS.maxPoolAgeSeconds;
  if (maxPoolAgeSeconds !== null && (!Number.isFinite(maxPoolAgeSeconds) || maxPoolAgeSeconds < 0)) {
    throw new LivePolicyError("liquidity.maxPoolAgeSeconds must be a non-negative number or null");
  }

  const freshnessIn = input.freshness ?? {};
  const quoteTtlMs = freshnessIn.quoteTtlMs ?? LIVE_POLICY_DEFAULTS.quoteTtlMs;
  const routeTtlMs = freshnessIn.routeTtlMs ?? LIVE_POLICY_DEFAULTS.routeTtlMs;
  for (const [n, v] of [["freshness.quoteTtlMs", quoteTtlMs], ["freshness.routeTtlMs", routeTtlMs]] as const) {
    if (!Number.isInteger(v) || v <= 0) throw new LivePolicyError(`${n} must be a positive integer`);
  }

  const cooldownMs = input.cooldownMs ?? LIVE_POLICY_DEFAULTS.cooldownMs;
  if (!Number.isInteger(cooldownMs) || cooldownMs < 0) {
    throw new LivePolicyError("cooldownMs must be a non-negative integer");
  }

  return {
    schemaVersion: LIVE_POLICY_SCHEMA_VERSION,
    mode,
    liveEnabled: input.liveEnabled ?? false,
    chainAllowlist: input.chainAllowlist ?? [LIVE_SOLANA_MAINNET_CHAIN_ID],
    walletProvider,
    caps,
    liquidity: { minLiquidityUsd, minPoolAgeSeconds, maxPoolAgeSeconds },
    freshness: { quoteTtlMs, routeTtlMs },
    requirePreflightSimulation: input.requirePreflightSimulation ?? true,
    requireManualConfirmation: input.requireManualConfirmation ?? true,
    requireAuditLog: input.requireAuditLog ?? true,
    killSwitch: input.killSwitch ?? false,
    emergencyStopFilePresent: input.emergencyStopFilePresent ?? false,
    tokenAllowlist: input.tokenAllowlist === undefined ? null : input.tokenAllowlist === null ? null : normalizeMintList(input.tokenAllowlist, "tokenAllowlist"),
    tokenDenylist: normalizeMintList(input.tokenDenylist, "tokenDenylist"),
    cooldownMs,
    backendCustodiesNoKeys: true,
    phantomSignsInBrowser: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
  };
}

const POLICY_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "mode",
  "liveEnabled",
  "chainAllowlist",
  "walletProvider",
  "caps",
  "liquidity",
  "freshness",
  "requirePreflightSimulation",
  "requireManualConfirmation",
  "requireAuditLog",
  "killSwitch",
  "emergencyStopFilePresent",
  "tokenAllowlist",
  "tokenDenylist",
  "cooldownMs",
  "backendCustodiesNoKeys",
  "phantomSignsInBrowser",
  "notFinancialAdvice",
  "notProfitabilityClaim",
]);

/** Strictly validate a value as a {@link LiveModePolicy} (closed schema, hard caps re-checked). */
export function validateLivePolicy(value: unknown): LiveModePolicy {
  if (!isObject(value)) throw new LivePolicyError("policy must be a JSON object");
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) throw new LivePolicyError(`policy carries sensitive-named field "${key}" — key material can never ride along`);
    if (!POLICY_KEYS.has(key)) throw new LivePolicyError(`policy carries unknown field "${key}" — the v1 schema is CLOSED`);
  }
  if (value.schemaVersion !== LIVE_POLICY_SCHEMA_VERSION) {
    throw new LivePolicyError(`policy.schemaVersion must be "${LIVE_POLICY_SCHEMA_VERSION}"`);
  }
  for (const [literal, expected] of [
    ["backendCustodiesNoKeys", true],
    ["phantomSignsInBrowser", true],
    ["notFinancialAdvice", true],
    ["notProfitabilityClaim", true],
  ] as const) {
    if (value[literal] !== expected) throw new LivePolicyError(`policy.${literal} must be the literal ${String(expected)}`);
  }
  // Re-normalize through the builder so every hard cap and shape rule is re-applied.
  const caps = isObject(value.caps) ? value.caps : {};
  const liquidity = isObject(value.liquidity) ? value.liquidity : {};
  const freshness = isObject(value.freshness) ? value.freshness : {};
  return buildLivePolicy({
    mode: value.mode as LiveMode,
    liveEnabled: value.liveEnabled as boolean,
    chainAllowlist: value.chainAllowlist as string[],
    walletProvider: value.walletProvider as LiveWalletProvider | null,
    caps: caps as Partial<LivePolicyCaps>,
    liquidity: liquidity as Partial<LivePolicyLiquidity>,
    freshness: freshness as Partial<LivePolicyFreshness>,
    requirePreflightSimulation: value.requirePreflightSimulation as boolean,
    requireManualConfirmation: value.requireManualConfirmation as boolean,
    requireAuditLog: value.requireAuditLog as boolean,
    killSwitch: value.killSwitch as boolean,
    emergencyStopFilePresent: value.emergencyStopFilePresent as boolean,
    tokenAllowlist: value.tokenAllowlist as string[] | null,
    tokenDenylist: value.tokenDenylist as string[],
    cooldownMs: value.cooldownMs as number,
  });
}

/**
 * Derive the gate verdict. Both `prepareAllowed` and `canaryArmAllowed` default to false and are
 * granted only when EVERY condition passes. This function authorizes nothing on its own — it
 * reports whether the operator's configuration would permit a Phantom-confirmed action.
 */
export function evaluateLivePolicy(policy: LiveModePolicy): LivePolicyEvaluation {
  const blockingReasons: LivePolicyBlockCode[] = [];
  const warnings: string[] = [];
  const block = (code: LivePolicyBlockCode): void => {
    if (!blockingReasons.includes(code)) blockingReasons.push(code);
  };

  if (!policy.liveEnabled) block("live-disabled");
  if (policy.mode !== "live_prepare" && policy.mode !== "live_canary") block("mode-not-live");
  if (policy.killSwitch) block("kill-switch-active");
  if (policy.emergencyStopFilePresent) block("emergency-stop-present");
  if (!policy.chainAllowlist.includes(LIVE_SOLANA_MAINNET_CHAIN_ID)) block("solana-mainnet-not-allowlisted");
  if (policy.walletProvider !== "phantom") block("wallet-provider-not-phantom");

  if (policy.caps.maxTradeSol > LIVE_HARD_CEILINGS.maxTradeSol) block("trade-cap-over-ceiling");
  if (policy.caps.maxPositionSol > LIVE_HARD_CEILINGS.maxPositionSol) block("position-cap-over-ceiling");
  if (policy.caps.maxDailyTrades > LIVE_HARD_CEILINGS.maxDailyTrades) block("daily-trades-over-ceiling");
  if (policy.caps.maxDailyLossSol > LIVE_HARD_CEILINGS.maxDailyLossSol) block("daily-loss-cap-over-ceiling");
  if (policy.caps.maxSlippageBps > LIVE_HARD_CEILINGS.maxSlippageBps) block("slippage-cap-over-ceiling");
  if (policy.caps.priorityFeeCapLamports > LIVE_HARD_CEILINGS.priorityFeeCapLamports) block("priority-fee-over-ceiling");
  if (policy.caps.riskScoreCap > LIVE_HARD_CEILINGS.riskScoreCap) block("risk-cap-over-ceiling");

  if (!policy.requirePreflightSimulation) block("preflight-simulation-not-required");
  if (!policy.requireManualConfirmation) block("manual-confirmation-not-required");
  if (!policy.requireAuditLog) block("audit-log-not-required");
  if (!(policy.liquidity.minLiquidityUsd > 0)) block("liquidity-floor-missing");
  if (!Number.isInteger(policy.cooldownMs) || policy.cooldownMs < 0) block("cooldown-invalid");

  // Non-blocking observations.
  for (const chain of policy.chainAllowlist) {
    if (chain !== LIVE_SOLANA_MAINNET_CHAIN_ID) {
      warnings.push(`chain "${chain}" is allowlisted but has no live implementation in Part 1 — only ${LIVE_SOLANA_MAINNET_CHAIN_ID} is live`);
    }
  }

  const prepareAllowed = blockingReasons.length === 0 && (policy.mode === "live_prepare" || policy.mode === "live_canary");
  const canaryArmAllowed = prepareAllowed && policy.mode === "live_canary";

  return {
    schemaVersion: LIVE_POLICY_EVALUATION_SCHEMA_VERSION,
    mode: policy.mode,
    prepareAllowed,
    canaryArmAllowed,
    blockingReasons,
    warnings,
    ceilings: LIVE_HARD_CEILINGS,
    backendCustodiesNoKeys: true,
    phantomSignsInBrowser: true,
    notProfitabilityClaim: true,
  };
}
