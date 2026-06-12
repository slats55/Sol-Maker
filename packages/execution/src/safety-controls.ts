/**
 * Operator SAFETY CONTROLS (Sprint 92) — enforced in code, not just documented.
 *
 * One pure evaluator over a closed violation set. Conventions:
 *   - a REQUIRED control that is missing is a violation (fail-closed, never a default);
 *   - controls only ever TIGHTEN: there is no code path that loosens another check;
 *   - session state (trade counts, losses, cooldowns, traded mints) is supplied by the caller —
 *     this module holds no hidden state.
 */

export const SAFETY_VIOLATION_CODES = [
  "safety-kill-switch-active",
  "safety-emergency-stop-present",
  "safety-spend-cap-missing",
  "safety-spend-over-cap",
  "safety-spend-missing",
  "safety-max-trades-missing",
  "safety-max-trades-reached",
  "safety-session-loss-cap-missing",
  "safety-session-loss-cap-breached",
  "safety-slippage-missing",
  "safety-slippage-cap-missing",
  "safety-slippage-over-cap",
  "safety-risk-missing",
  "safety-risk-cap-missing",
  "safety-risk-over-cap",
  "safety-quote-age-missing",
  "safety-quote-age-cap-missing",
  "safety-quote-stale",
  "safety-mint-blocked",
  "safety-mint-not-allowlisted",
  "safety-provider-not-allowed",
  "safety-network-lock-missing",
  "safety-network-locked",
  "safety-audit-log-missing",
  "safety-cooldown-active",
  "safety-duplicate-mint",
] as const;
export type SafetyViolationCode = (typeof SAFETY_VIOLATION_CODES)[number];

export interface SafetyViolation {
  code: SafetyViolationCode;
  detail: string;
}

/** The operator's safety controls. Required-by-design fields refuse when absent. */
export interface OperatorSafetyControls {
  killSwitchActive: boolean;
  emergencyStopFilePresent: boolean;
  /** Per-trade spend ceiling in lamports (integer string). REQUIRED. */
  maxSpendPerTradeLamports: string | null;
  /** Trades allowed per session. REQUIRED. */
  maxTradesPerSession: number | null;
  /** Session/daily loss ceiling in SOL. REQUIRED. */
  sessionLossCapSol: number | null;
  /** Slippage ceiling in basis points. REQUIRED. */
  slippageCapBps: number | null;
  /** Advisory risk score ceiling. REQUIRED. */
  riskScoreCap: number | null;
  /** Quote age ceiling in milliseconds. REQUIRED. */
  quoteAgeCapMs: number | null;
  /** When non-null, ONLY these mints may trade. */
  allowedMints: string[] | null;
  /** These mints may never trade. */
  blockedMints: string[];
  /** When non-null, ONLY these providers may be used. */
  allowedProviders: string[] | null;
  /** The single network this session is locked to. REQUIRED. */
  networkLock: string | null;
  /** Whether an audit log path must accompany the attempt. */
  auditLogRequired: boolean;
  /** Minimum milliseconds between trades. REQUIRED. */
  cooldownMs: number | null;
  /** Refuse a mint that was already traded this session. */
  duplicateMintProtection: boolean;
}

export interface TradeContext {
  mint: string;
  provider: string;
  network: string;
  spendLamports: string | null;
  slippageBps: number | null;
  riskScore: number | null;
  /** Milliseconds since the quote backing this trade was fetched. */
  quoteAgeMs: number | null;
  auditLogPathProvided: boolean;
}

export interface SessionState {
  tradesCount: number;
  sessionLossSol: number;
  lastTradeAtMs: number | null;
  mintsTraded: string[];
}

const RAW_AMOUNT_RE = /^[0-9]{1,20}$/;

export interface SafetyEvaluation {
  allowed: boolean;
  violations: SafetyViolation[];
}

/** Evaluate every safety control against one prospective trade. Pure; collects ALL violations. */
export function evaluateSafetyControls(
  controls: OperatorSafetyControls,
  trade: TradeContext,
  session: SessionState,
  nowMs: number,
): SafetyEvaluation {
  const violations: SafetyViolation[] = [];
  const add = (code: SafetyViolationCode, detail: string): void => {
    violations.push({ code, detail });
  };

  if (controls.killSwitchActive) add("safety-kill-switch-active", "the kill switch is active");
  if (controls.emergencyStopFilePresent) add("safety-emergency-stop-present", "the emergency stop file/env is present");

  // Spend.
  if (controls.maxSpendPerTradeLamports === null || !RAW_AMOUNT_RE.test(controls.maxSpendPerTradeLamports)) {
    add("safety-spend-cap-missing", "maxSpendPerTradeLamports is required");
  } else if (trade.spendLamports === null || !RAW_AMOUNT_RE.test(trade.spendLamports)) {
    add("safety-spend-missing", "the trade's spend amount is missing or unparsable");
  } else if (BigInt(trade.spendLamports) > BigInt(controls.maxSpendPerTradeLamports)) {
    add("safety-spend-over-cap", `spend ${trade.spendLamports} exceeds the cap ${controls.maxSpendPerTradeLamports}`);
  }

  // Trades per session.
  if (controls.maxTradesPerSession === null || !Number.isInteger(controls.maxTradesPerSession) || controls.maxTradesPerSession < 1) {
    add("safety-max-trades-missing", "maxTradesPerSession is required");
  } else if (session.tradesCount >= controls.maxTradesPerSession) {
    add("safety-max-trades-reached", `session already made ${session.tradesCount} of ${controls.maxTradesPerSession} trades`);
  }

  // Session loss cap.
  if (controls.sessionLossCapSol === null || !Number.isFinite(controls.sessionLossCapSol) || controls.sessionLossCapSol <= 0) {
    add("safety-session-loss-cap-missing", "sessionLossCapSol is required");
  } else if (session.sessionLossSol >= controls.sessionLossCapSol) {
    add("safety-session-loss-cap-breached", `session loss ${session.sessionLossSol} SOL reached the cap ${controls.sessionLossCapSol} SOL`);
  }

  // Slippage.
  if (controls.slippageCapBps === null || !Number.isInteger(controls.slippageCapBps) || controls.slippageCapBps < 0) {
    add("safety-slippage-cap-missing", "slippageCapBps is required");
  } else if (trade.slippageBps === null || !Number.isInteger(trade.slippageBps)) {
    add("safety-slippage-missing", "the trade's slippageBps is missing");
  } else if (trade.slippageBps > controls.slippageCapBps) {
    add("safety-slippage-over-cap", `slippage ${trade.slippageBps} bps exceeds the cap ${controls.slippageCapBps} bps`);
  }

  // Risk.
  if (controls.riskScoreCap === null || !Number.isFinite(controls.riskScoreCap)) {
    add("safety-risk-cap-missing", "riskScoreCap is required");
  } else if (trade.riskScore === null || !Number.isFinite(trade.riskScore)) {
    add("safety-risk-missing", "the trade's advisory risk score is missing");
  } else if (trade.riskScore > controls.riskScoreCap) {
    add("safety-risk-over-cap", `risk score ${trade.riskScore} exceeds the cap ${controls.riskScoreCap}`);
  }

  // Quote age.
  if (controls.quoteAgeCapMs === null || !Number.isInteger(controls.quoteAgeCapMs) || controls.quoteAgeCapMs <= 0) {
    add("safety-quote-age-cap-missing", "quoteAgeCapMs is required");
  } else if (trade.quoteAgeMs === null || !Number.isFinite(trade.quoteAgeMs) || trade.quoteAgeMs < 0) {
    add("safety-quote-age-missing", "the quote's age is missing");
  } else if (trade.quoteAgeMs > controls.quoteAgeCapMs) {
    add("safety-quote-stale", `quote is ${trade.quoteAgeMs}ms old — over the ${controls.quoteAgeCapMs}ms cap`);
  }

  // Token lists.
  if (controls.blockedMints.includes(trade.mint)) {
    add("safety-mint-blocked", "the mint is on the blocked list");
  }
  if (controls.allowedMints !== null && !controls.allowedMints.includes(trade.mint)) {
    add("safety-mint-not-allowlisted", "an allowlist is set and the mint is not on it");
  }

  // Providers.
  if (controls.allowedProviders !== null && !controls.allowedProviders.includes(trade.provider)) {
    add("safety-provider-not-allowed", `provider "${trade.provider}" is not on the allowed list`);
  }

  // Network lock.
  if (controls.networkLock === null || controls.networkLock.length === 0) {
    add("safety-network-lock-missing", "a networkLock is required");
  } else if (trade.network !== controls.networkLock) {
    add("safety-network-locked", `the session is locked to ${controls.networkLock}; the trade targets ${trade.network}`);
  }

  // Audit log.
  if (controls.auditLogRequired && !trade.auditLogPathProvided) {
    add("safety-audit-log-missing", "an audit log path is required for this mode");
  }

  // Cooldown.
  if (controls.cooldownMs === null || !Number.isInteger(controls.cooldownMs) || controls.cooldownMs < 0) {
    add("safety-cooldown-active", "cooldownMs is required (set 0 explicitly to disable)");
  } else if (session.lastTradeAtMs !== null && nowMs - session.lastTradeAtMs < controls.cooldownMs) {
    add("safety-cooldown-active", `cooldown: last trade was ${nowMs - session.lastTradeAtMs}ms ago (< ${controls.cooldownMs}ms)`);
  }

  // Duplicate mint.
  if (controls.duplicateMintProtection && session.mintsTraded.includes(trade.mint)) {
    add("safety-duplicate-mint", "this mint was already traded this session");
  }

  return { allowed: violations.length === 0, violations };
}
