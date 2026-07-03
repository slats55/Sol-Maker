/**
 * STRATEGY PROFILES (`live.strategy.profile.v1`, Sprint 109).
 *
 * A profile is ONE named, validated bundle of every tunable the sniper daemon and the live-gated
 * canary paths consume: liquidity floor, risk ceiling, spend, exits, freshness, slippage, position
 * count, source preferences, and — critically — whether the profile may EVER be used on a
 * live-gated path. Three built-ins ship (`conservative`, `balanced`, `aggressive-paper-only`);
 * an operator may load a custom profile file, but it passes the SAME closed-schema validation.
 *
 * Safety invariants, all enforced in code:
 *   - `aggressive-paper-only` (and ANY profile with riskAppetite "aggressive") is structurally
 *     live-INELIGIBLE: `liveEligible: true` on such a profile is REFUSED by the validator.
 *   - Every cap is bounded by the SAME hard ceilings the live policy enforces (`LIVE_HARD_CEILINGS`)
 *     and the exit-policy bounds — a profile can only tighten, never widen, what live could do.
 *   - Live-gated commands DEFAULT to `conservative`; a live-ineligible profile on a live-gated
 *     path is a refusal, not a warning.
 *   - A profile is configuration, not authorization: it pins `notProfitabilityClaim` and grants
 *     nothing by itself.
 *
 * Pure: no clock, no network, no randomness, no I/O.
 */

import { isSensitiveKey, redactString } from "@soulmaker/security";

import { LIVE_HARD_CEILINGS } from "./policy.js";
import { buildExitPolicy } from "./position.js";
import type { LiveExitPolicy } from "./position.js";
import { STRATEGY_RISK_APPETITES } from "./strategy.js";
import type { StrategyRiskAppetite } from "./strategy.js";

export const LIVE_STRATEGY_PROFILE_SCHEMA_VERSION = "live.strategy.profile.v1";

/** The built-in profile names. Custom profiles may use other (bounded) names. */
export const BUILTIN_PROFILE_NAMES = ["conservative", "balanced", "aggressive-paper-only"] as const;
export type BuiltinProfileName = (typeof BUILTIN_PROFILE_NAMES)[number];

/** Ceiling on open paper positions any profile may hold at once. */
export const PROFILE_MAX_OPEN_POSITIONS_CEILING = 10;

/** Quote-freshness TTL bounds (ms): a TTL of 0 can never be satisfied; over 5 min is not "fresh". */
export const PROFILE_QUOTE_TTL_BOUNDS = { min: 1_000, max: 300_000 } as const;

export interface StrategyProfile {
  schemaVersion: typeof LIVE_STRATEGY_PROFILE_SCHEMA_VERSION;
  name: string;
  /** Minimum provider-reported liquidity in USD before a candidate is considered. */
  minLiquidityUsd: number;
  /** Highest advisory risk score the profile accepts (lower is safer; ≤ live ceiling). */
  maxRiskScore: number;
  /** Per-position spend in SOL (paper AND the most live could ever do; ≤ live trade ceiling). */
  maxSpendSol: number;
  stopLossPct: number;
  takeProfitPct: number;
  /** null = trailing stop disabled. */
  trailingStopPct: number | null;
  maxHoldMs: number;
  quoteFreshnessTtlMs: number;
  maxSlippageBps: number;
  maxOpenPositions: number;
  /** Preferred discovery source provider ids, in order. Unknown sources are still allowed. */
  sourcePreferences: string[];
  /** Maps onto the strategy scorer's appetite (score thresholds only, never safety blocks). */
  riskAppetite: StrategyRiskAppetite;
  /** May this profile EVER be used on a live-gated path? Aggressive profiles can never be. */
  liveEligible: boolean;
  notProfitabilityClaim: true;
}

export class StrategyProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrategyProfileError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The three built-in profiles. Frozen; the validator re-checks them like any operator file. */
export const STRATEGY_PROFILES: Readonly<Record<BuiltinProfileName, StrategyProfile>> = Object.freeze({
  conservative: Object.freeze({
    schemaVersion: LIVE_STRATEGY_PROFILE_SCHEMA_VERSION,
    name: "conservative",
    minLiquidityUsd: 25_000,
    maxRiskScore: 20,
    maxSpendSol: 0.005,
    stopLossPct: 15,
    takeProfitPct: 30,
    trailingStopPct: 10,
    maxHoldMs: 900_000,
    quoteFreshnessTtlMs: 8_000,
    maxSlippageBps: 100,
    maxOpenPositions: 1,
    sourcePreferences: ["jupiter-recent-tokens"],
    riskAppetite: "conservative",
    liveEligible: true,
    notProfitabilityClaim: true,
  }),
  balanced: Object.freeze({
    schemaVersion: LIVE_STRATEGY_PROFILE_SCHEMA_VERSION,
    name: "balanced",
    minLiquidityUsd: 10_000,
    maxRiskScore: 30,
    maxSpendSol: 0.005,
    stopLossPct: 20,
    takeProfitPct: 50,
    trailingStopPct: 15,
    maxHoldMs: 1_800_000,
    quoteFreshnessTtlMs: 10_000,
    maxSlippageBps: 150,
    maxOpenPositions: 3,
    sourcePreferences: ["jupiter-recent-tokens", "dexscreener-token-profiles"],
    riskAppetite: "standard",
    liveEligible: true,
    notProfitabilityClaim: true,
  }),
  "aggressive-paper-only": Object.freeze({
    schemaVersion: LIVE_STRATEGY_PROFILE_SCHEMA_VERSION,
    name: "aggressive-paper-only",
    minLiquidityUsd: 5_000,
    maxRiskScore: 45,
    maxSpendSol: 0.01,
    stopLossPct: 25,
    takeProfitPct: 100,
    trailingStopPct: 20,
    maxHoldMs: 3_600_000,
    quoteFreshnessTtlMs: 15_000,
    maxSlippageBps: 250,
    maxOpenPositions: 5,
    sourcePreferences: ["jupiter-recent-tokens", "dexscreener-token-profiles"],
    riskAppetite: "aggressive",
    liveEligible: false,
    notProfitabilityClaim: true,
  }),
});

const PROFILE_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "name",
  "minLiquidityUsd",
  "maxRiskScore",
  "maxSpendSol",
  "stopLossPct",
  "takeProfitPct",
  "trailingStopPct",
  "maxHoldMs",
  "quoteFreshnessTtlMs",
  "maxSlippageBps",
  "maxOpenPositions",
  "sourcePreferences",
  "riskAppetite",
  "liveEligible",
  "notProfitabilityClaim",
]);

function requireFiniteNonNegative(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new StrategyProfileError(`${name} must be a non-negative finite number`);
  }
  return value;
}

function requireBoundedInt(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new StrategyProfileError(`${name} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

/**
 * Strictly validate a value as a {@link StrategyProfile} (closed schema; every cap re-bounded).
 * An aggressive profile claiming live eligibility is REFUSED — there is no override.
 */
export function validateStrategyProfile(value: unknown): StrategyProfile {
  if (!isObject(value)) throw new StrategyProfileError("profile must be a JSON object");
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) throw new StrategyProfileError(`profile carries sensitive-named field "${key}" — key material can never ride along`);
    if (!PROFILE_KEYS.has(key)) throw new StrategyProfileError(`profile carries unknown field "${key}" — the v1 schema is CLOSED`);
  }
  if (value.schemaVersion !== LIVE_STRATEGY_PROFILE_SCHEMA_VERSION) {
    throw new StrategyProfileError(`profile.schemaVersion must be "${LIVE_STRATEGY_PROFILE_SCHEMA_VERSION}"`);
  }
  if (value.notProfitabilityClaim !== true) {
    throw new StrategyProfileError("profile.notProfitabilityClaim must be the literal true");
  }
  if (typeof value.name !== "string" || value.name.trim().length === 0 || value.name.length > 60) {
    throw new StrategyProfileError("profile.name must be a non-empty string of at most 60 characters");
  }
  const name = value.name.trim();
  if (redactString(name) !== name) {
    throw new StrategyProfileError("profile.name looks secret-shaped — refused");
  }
  if (!(STRATEGY_RISK_APPETITES as readonly string[]).includes(value.riskAppetite as string)) {
    throw new StrategyProfileError(`profile.riskAppetite must be one of ${STRATEGY_RISK_APPETITES.join("|")}`);
  }
  const riskAppetite = value.riskAppetite as StrategyRiskAppetite;
  if (typeof value.liveEligible !== "boolean") {
    throw new StrategyProfileError("profile.liveEligible must be a boolean");
  }
  // THE structural rule: an aggressive profile can never be live-eligible, whatever the file says.
  if (value.liveEligible === true && (riskAppetite === "aggressive" || name === "aggressive-paper-only")) {
    throw new StrategyProfileError(
      "an aggressive profile can NEVER be live-eligible — liveEligible must be false for riskAppetite \"aggressive\" (paper only)",
    );
  }

  const minLiquidityUsd = requireFiniteNonNegative(value.minLiquidityUsd, "profile.minLiquidityUsd");
  const maxRiskScore = requireBoundedInt(value.maxRiskScore, "profile.maxRiskScore", 0, LIVE_HARD_CEILINGS.riskScoreCap);
  const maxSpendSol = value.maxSpendSol;
  if (typeof maxSpendSol !== "number" || !Number.isFinite(maxSpendSol) || maxSpendSol <= 0 || maxSpendSol > LIVE_HARD_CEILINGS.maxTradeSol) {
    throw new StrategyProfileError(
      `profile.maxSpendSol must be in (0, ${LIVE_HARD_CEILINGS.maxTradeSol}] — the live trade ceiling applies to paper too (parity, not fantasy)`,
    );
  }
  const maxSlippageBps = requireBoundedInt(value.maxSlippageBps, "profile.maxSlippageBps", 0, LIVE_HARD_CEILINGS.maxSlippageBps);
  const quoteFreshnessTtlMs = requireBoundedInt(
    value.quoteFreshnessTtlMs,
    "profile.quoteFreshnessTtlMs",
    PROFILE_QUOTE_TTL_BOUNDS.min,
    PROFILE_QUOTE_TTL_BOUNDS.max,
  );
  const maxOpenPositions = requireBoundedInt(value.maxOpenPositions, "profile.maxOpenPositions", 1, PROFILE_MAX_OPEN_POSITIONS_CEILING);

  // Exit fields are validated by the SAME exit-policy builder the ledger uses (bounds refused, not clamped).
  const exitPolicy = buildExitPolicy({
    stopLossPct: value.stopLossPct as number,
    takeProfitPct: value.takeProfitPct as number,
    trailingStopPct: value.trailingStopPct as number | null,
    maxHoldMs: value.maxHoldMs as number,
  });

  if (!Array.isArray(value.sourcePreferences)) {
    throw new StrategyProfileError("profile.sourcePreferences must be an array of provider ids");
  }
  const sourcePreferences = value.sourcePreferences.map((s, i) => {
    if (typeof s !== "string" || s.trim().length === 0 || s.length > 60) {
      throw new StrategyProfileError(`profile.sourcePreferences[${i}] must be a short provider id string`);
    }
    return s.trim();
  });

  return {
    schemaVersion: LIVE_STRATEGY_PROFILE_SCHEMA_VERSION,
    name,
    minLiquidityUsd,
    maxRiskScore,
    maxSpendSol,
    stopLossPct: exitPolicy.stopLossPct,
    takeProfitPct: exitPolicy.takeProfitPct,
    trailingStopPct: exitPolicy.trailingStopPct,
    maxHoldMs: exitPolicy.maxHoldMs,
    quoteFreshnessTtlMs,
    maxSlippageBps,
    maxOpenPositions,
    sourcePreferences,
    riskAppetite,
    liveEligible: value.liveEligible,
    notProfitabilityClaim: true,
  };
}

/** Resolve a built-in profile by name, or throw with the valid names. */
export function getBuiltinProfile(name: string): StrategyProfile {
  if ((BUILTIN_PROFILE_NAMES as readonly string[]).includes(name)) {
    return STRATEGY_PROFILES[name as BuiltinProfileName];
  }
  throw new StrategyProfileError(`unknown built-in profile "${redactString(name).slice(0, 60)}" — built-ins: ${BUILTIN_PROFILE_NAMES.join(" | ")}`);
}

/** Derive the exit policy a profile implies (same builder, same bounds). */
export function profileExitPolicy(profile: StrategyProfile): LiveExitPolicy {
  return buildExitPolicy({
    stopLossPct: profile.stopLossPct,
    takeProfitPct: profile.takeProfitPct,
    trailingStopPct: profile.trailingStopPct,
    maxHoldMs: profile.maxHoldMs,
  });
}

/**
 * Gate a profile for a LIVE-GATED path. Refuses (never warns) when the profile is not
 * live-eligible. Live-gated commands must call this and must default to `conservative`.
 */
export function requireLiveEligibleProfile(profile: StrategyProfile): StrategyProfile {
  if (!profile.liveEligible) {
    throw new StrategyProfileError(
      `profile "${profile.name}" is PAPER-ONLY (liveEligible: false) — a live-gated path refuses it; use "conservative" (the live default)`,
    );
  }
  return profile;
}
