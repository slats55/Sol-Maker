/**
 * LIVE CANARY ESCALATION POLICY (`live.escalation.policy.v1`, Sprint 108, Part 2).
 *
 * The conservative gate that decides whether ONE more tiny canary may be PREPARED this session. It
 * sits above the per-trade live policy: even when the live policy would permit a Phantom-confirmed
 * canary, escalation can still refuse it (cooldown, per-session / per-day caps, prior failures, a
 * daily-loss ceiling, an auto-pause, or a required manual re-arm). It NEVER authorizes a trade and
 * NEVER enables a larger size.
 *
 * Hard invariants (all tested):
 *   - Caps only TIGHTEN — every limit is clamped to an absolute ceiling; an over-ceiling config is
 *     refused, never silently raised.
 *   - `largeTradesEnabled` is a pinned `false`. Part 2 designs escalation-to-larger-size but does NOT
 *     enable it; any size above the canary ceiling is refused here.
 *   - One canary at a time: a cooldown must elapse between canaries, and an auto-pause after a
 *     failure / rejection / confirm-timeout halts further canaries until a human manually re-arms.
 */

export const LIVE_ESCALATION_POLICY_SCHEMA_VERSION = "live.escalation.policy.v1";

/** Absolute ceilings. Intentionally tiny — this is a canary RC, not a production sniper. */
export const LIVE_ESCALATION_HARD_CEILINGS = {
  /** Per-canary spend ceiling in SOL (matches the live-policy trade ceiling). */
  maxCanarySol: 0.05,
  /** Canaries permitted in one operator session. */
  maxCanariesPerSession: 3,
  /** Canaries permitted per UTC day. */
  maxCanariesPerDay: 5,
  /** Cumulative daily realized-loss ceiling in SOL. */
  maxDailyLossSol: 0.05,
  /** Consecutive failed/rejected attempts before escalation refuses outright. */
  maxFailedAttempts: 3,
} as const;

/** A floor on the cooldown so canaries can never fire back-to-back. */
export const LIVE_ESCALATION_MIN_COOLDOWN_MS = 30_000;

export const LIVE_ESCALATION_DEFAULTS = {
  maxCanarySol: 0.005,
  maxCanariesPerSession: 1,
  maxCanariesPerDay: 1,
  cooldownMs: 300_000,
  maxFailedAttempts: 1,
  maxDailyLossSol: 0.01,
} as const;

export interface LiveEscalationPolicy {
  schemaVersion: typeof LIVE_ESCALATION_POLICY_SCHEMA_VERSION;
  maxCanarySol: number;
  maxCanariesPerSession: number;
  maxCanariesPerDay: number;
  cooldownMs: number;
  maxFailedAttempts: number;
  maxDailyLossSol: number;
  autoPauseAfterFailure: boolean;
  autoPauseAfterRejection: boolean;
  autoPauseAfterConfirmTimeout: boolean;
  /** When true, a paused/used loop must be MANUALLY re-armed before another canary. */
  manualRearmRequired: boolean;
  /** Pinned literal — Part 2 never enables larger-than-canary trades. */
  largeTradesEnabled: false;
}

export const LIVE_ESCALATION_BLOCK_CODES = [
  "escalation-paused",
  "not-armed",
  "session-canary-cap-reached",
  "daily-canary-cap-reached",
  "cooldown-active",
  "failed-attempts-cap-reached",
  "daily-loss-cap-reached",
  "spend-over-canary-ceiling",
  "large-trades-not-enabled",
] as const;
export type LiveEscalationBlockCode = (typeof LIVE_ESCALATION_BLOCK_CODES)[number];

export class LiveEscalationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveEscalationError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clampPositive(value: number, ceiling: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new LiveEscalationError(`${name} must be a positive finite number`);
  if (value > ceiling) throw new LiveEscalationError(`${name} (${value}) exceeds the hard ceiling (${ceiling}) — caps only tighten`);
  return value;
}

function clampPositiveInt(value: number, ceiling: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new LiveEscalationError(`${name} must be a positive integer`);
  if (value > ceiling) throw new LiveEscalationError(`${name} (${value}) exceeds the hard ceiling (${ceiling}) — caps only tighten`);
  return value;
}

export interface BuildEscalationPolicyInput {
  maxCanarySol?: number;
  maxCanariesPerSession?: number;
  maxCanariesPerDay?: number;
  cooldownMs?: number;
  maxFailedAttempts?: number;
  maxDailyLossSol?: number;
  autoPauseAfterFailure?: boolean;
  autoPauseAfterRejection?: boolean;
  autoPauseAfterConfirmTimeout?: boolean;
  manualRearmRequired?: boolean;
}

/** Normalize a partial config into a complete, hard-capped escalation policy (or throw). */
export function buildEscalationPolicy(input: BuildEscalationPolicyInput = {}): LiveEscalationPolicy {
  const cooldownMs = input.cooldownMs ?? LIVE_ESCALATION_DEFAULTS.cooldownMs;
  if (!Number.isInteger(cooldownMs) || cooldownMs < LIVE_ESCALATION_MIN_COOLDOWN_MS) {
    throw new LiveEscalationError(`cooldownMs must be an integer ≥ ${LIVE_ESCALATION_MIN_COOLDOWN_MS} (canaries can never fire back-to-back)`);
  }
  return {
    schemaVersion: LIVE_ESCALATION_POLICY_SCHEMA_VERSION,
    maxCanarySol: clampPositive(input.maxCanarySol ?? LIVE_ESCALATION_DEFAULTS.maxCanarySol, LIVE_ESCALATION_HARD_CEILINGS.maxCanarySol, "maxCanarySol"),
    maxCanariesPerSession: clampPositiveInt(
      input.maxCanariesPerSession ?? LIVE_ESCALATION_DEFAULTS.maxCanariesPerSession,
      LIVE_ESCALATION_HARD_CEILINGS.maxCanariesPerSession,
      "maxCanariesPerSession",
    ),
    maxCanariesPerDay: clampPositiveInt(
      input.maxCanariesPerDay ?? LIVE_ESCALATION_DEFAULTS.maxCanariesPerDay,
      LIVE_ESCALATION_HARD_CEILINGS.maxCanariesPerDay,
      "maxCanariesPerDay",
    ),
    cooldownMs,
    maxFailedAttempts: clampPositiveInt(
      input.maxFailedAttempts ?? LIVE_ESCALATION_DEFAULTS.maxFailedAttempts,
      LIVE_ESCALATION_HARD_CEILINGS.maxFailedAttempts,
      "maxFailedAttempts",
    ),
    maxDailyLossSol: clampPositive(input.maxDailyLossSol ?? LIVE_ESCALATION_DEFAULTS.maxDailyLossSol, LIVE_ESCALATION_HARD_CEILINGS.maxDailyLossSol, "maxDailyLossSol"),
    autoPauseAfterFailure: input.autoPauseAfterFailure ?? true,
    autoPauseAfterRejection: input.autoPauseAfterRejection ?? true,
    autoPauseAfterConfirmTimeout: input.autoPauseAfterConfirmTimeout ?? true,
    manualRearmRequired: input.manualRearmRequired ?? true,
    largeTradesEnabled: false,
  };
}

const ESCALATION_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "maxCanarySol",
  "maxCanariesPerSession",
  "maxCanariesPerDay",
  "cooldownMs",
  "maxFailedAttempts",
  "maxDailyLossSol",
  "autoPauseAfterFailure",
  "autoPauseAfterRejection",
  "autoPauseAfterConfirmTimeout",
  "manualRearmRequired",
  "largeTradesEnabled",
]);

/** Strictly validate a value as a {@link LiveEscalationPolicy} (closed schema; caps re-checked). */
export function validateEscalationPolicy(value: unknown): LiveEscalationPolicy {
  if (!isObject(value)) throw new LiveEscalationError("escalation policy must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!ESCALATION_KEYS.has(key)) throw new LiveEscalationError(`escalation policy carries unknown field "${key}" — the v1 schema is CLOSED`);
  }
  if (value.schemaVersion !== LIVE_ESCALATION_POLICY_SCHEMA_VERSION) {
    throw new LiveEscalationError(`escalation policy.schemaVersion must be "${LIVE_ESCALATION_POLICY_SCHEMA_VERSION}"`);
  }
  if (value.largeTradesEnabled !== false) throw new LiveEscalationError("escalation policy.largeTradesEnabled must be the literal false (Part 2 never enables larger trades)");
  return buildEscalationPolicy({
    maxCanarySol: value.maxCanarySol as number,
    maxCanariesPerSession: value.maxCanariesPerSession as number,
    maxCanariesPerDay: value.maxCanariesPerDay as number,
    cooldownMs: value.cooldownMs as number,
    maxFailedAttempts: value.maxFailedAttempts as number,
    maxDailyLossSol: value.maxDailyLossSol as number,
    autoPauseAfterFailure: value.autoPauseAfterFailure as boolean,
    autoPauseAfterRejection: value.autoPauseAfterRejection as boolean,
    autoPauseAfterConfirmTimeout: value.autoPauseAfterConfirmTimeout as boolean,
    manualRearmRequired: value.manualRearmRequired as boolean,
  });
}

/** Mutable per-session counters the loop tracks. All optional; absent = zero / never. */
export interface EscalationSessionState {
  canariesThisSession?: number;
  canariesToday?: number;
  failedAttempts?: number;
  lastCanaryAtMs?: number | null;
  dailyLossSol?: number;
  /** Set by an auto-pause; cleared only by a manual re-arm. */
  paused?: boolean;
  /** True once a human has armed the loop for the next canary. */
  armed?: boolean;
}

export interface EscalationEvaluation {
  schemaVersion: "live.escalation.evaluation.v1";
  canaryAllowed: boolean;
  blockingReasons: LiveEscalationBlockCode[];
  cooldownRemainingMs: number;
  remainingThisSession: number;
  remainingToday: number;
  notProfitabilityClaim: true;
}

export interface EvaluateEscalationInput {
  policy: LiveEscalationPolicy;
  session: EscalationSessionState;
  nowMs: number;
  /** The spend the loop wants to prepare, in SOL, if known. */
  plannedSpendSol?: number | null;
}

/**
 * Decide whether one more canary may be prepared. Defaults to refused; every refusal is a code. This
 * authorizes nothing — it reports whether escalation would permit the NEXT canary to be PREPARED
 * (the human still signs in Phantom).
 */
export function evaluateEscalation(input: EvaluateEscalationInput): EscalationEvaluation {
  const { policy, session, nowMs } = input;
  const blockingReasons: LiveEscalationBlockCode[] = [];
  const block = (code: LiveEscalationBlockCode): void => {
    if (!blockingReasons.includes(code)) blockingReasons.push(code);
  };

  const canariesThisSession = session.canariesThisSession ?? 0;
  const canariesToday = session.canariesToday ?? 0;
  const failedAttempts = session.failedAttempts ?? 0;
  const lastCanaryAtMs = session.lastCanaryAtMs ?? null;
  const dailyLossSol = session.dailyLossSol ?? 0;

  if (session.paused === true) block("escalation-paused");
  if (policy.manualRearmRequired && session.armed !== true) block("not-armed");
  if (canariesThisSession >= policy.maxCanariesPerSession) block("session-canary-cap-reached");
  if (canariesToday >= policy.maxCanariesPerDay) block("daily-canary-cap-reached");
  if (failedAttempts >= policy.maxFailedAttempts) block("failed-attempts-cap-reached");
  if (dailyLossSol >= policy.maxDailyLossSol) block("daily-loss-cap-reached");

  let cooldownRemainingMs = 0;
  if (lastCanaryAtMs !== null && Number.isFinite(lastCanaryAtMs)) {
    const elapsed = nowMs - lastCanaryAtMs;
    if (elapsed < policy.cooldownMs) {
      cooldownRemainingMs = policy.cooldownMs - elapsed;
      block("cooldown-active");
    }
  }

  const plannedSpendSol = input.plannedSpendSol ?? null;
  if (plannedSpendSol !== null && Number.isFinite(plannedSpendSol) && plannedSpendSol > policy.maxCanarySol) {
    block("spend-over-canary-ceiling");
    if (!policy.largeTradesEnabled) block("large-trades-not-enabled");
  }

  return {
    schemaVersion: "live.escalation.evaluation.v1",
    canaryAllowed: blockingReasons.length === 0,
    blockingReasons,
    cooldownRemainingMs,
    remainingThisSession: Math.max(0, policy.maxCanariesPerSession - canariesThisSession),
    remainingToday: Math.max(0, policy.maxCanariesPerDay - canariesToday),
    notProfitabilityClaim: true,
  };
}
