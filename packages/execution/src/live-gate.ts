/**
 * The MAINNET LIVE gate (Sprint 92) — fourteen independent conditions, ALL of which must pass
 * for live mainnet execution to be ARMED. The default state of every condition is FAILED, so
 * the default state of the gate is BLOCKED. Nothing in this module can be configured to skip a
 * condition; there is no override, no force flag, and no partial credit.
 *
 * This gate complements (does not replace) the long-standing core live gate
 * (`@soulmaker/core` evaluateLiveGate / DANGEROUS_BURNER_LIVE): the CLI requires BOTH.
 */

export const LIVE_TRADING_ENV_FLAG = "SOLMAKER_ENABLE_LIVE_TRADING";
export const LIVE_TRADING_ENV_VALUE = "I_UNDERSTAND_REAL_FUNDS_ARE_AT_RISK";

export interface MainnetLiveGateInput {
  /** Process environment (the env flag must be EXACTLY the acknowledgment sentence). */
  env?: Record<string, string | undefined>;
  /** `phase7LiveTradingReady: true` from the operator's config file. */
  configPhase7LiveTradingReady?: boolean;
  /** The explicit CLI acknowledgment flag (--i-understand-this-can-lose-real-money). */
  cliAcknowledged?: boolean;
  /** The target network — must be exactly "mainnet-beta". */
  network?: string | null;
  /** Explicit per-trade spend cap in lamports (integer string). */
  maxSpendLamports?: string | null;
  /** Explicit session/daily loss cap in SOL. */
  sessionLossCapSol?: number | null;
  /** Explicit slippage cap in basis points. */
  slippageCapBps?: number | null;
  /** Kill switch state (config OR emergency stop file OR env). */
  killSwitchActive?: boolean;
  /** Quote freshness verdict from the caller (age under the explicit cap). */
  quoteFresh?: boolean | null;
  /** The latest txpreview simulation outcome for the EXACT envelope to be sent. */
  simulationOutcome?: string | null;
  /** Advisory risk score + the explicit cap it must be under. */
  riskScore?: number | null;
  riskScoreCap?: number | null;
  /** The validated destination wallet public key (base58). */
  walletPublicKeyValid?: boolean;
  /** The signer was loaded through the approved boundary (never a raw key). */
  signerBoundaryKind?: string | null;
  /** An audit artifact path was provided for the attempt. */
  auditLogPathProvided?: boolean;
  /** Count of unresolved redaction findings over the attempt's artifacts. */
  redactionFindings?: number | null;
}

export interface MainnetLiveGateCheck {
  gate: string;
  satisfied: boolean;
  detail: string;
}

export interface MainnetLiveGateResult {
  /** True ONLY when every check below is satisfied. */
  armed: boolean;
  checks: MainnetLiveGateCheck[];
}

const RAW_AMOUNT_RE = /^[0-9]{1,20}$/;

/** Evaluate all fourteen mainnet live-gate conditions. Pure; default input → BLOCKED. */
export function evaluateMainnetLiveGate(input: MainnetLiveGateInput = {}): MainnetLiveGateResult {
  const env = input.env ?? {};
  const checks: MainnetLiveGateCheck[] = [];
  const add = (gate: string, satisfied: boolean, okDetail: string, failDetail: string): void => {
    checks.push({ gate, satisfied, detail: satisfied ? okDetail : failDetail });
  };

  add(
    "env-acknowledgment",
    env[LIVE_TRADING_ENV_FLAG] === LIVE_TRADING_ENV_VALUE,
    `${LIVE_TRADING_ENV_FLAG} carries the exact acknowledgment sentence`,
    `${LIVE_TRADING_ENV_FLAG} must be EXACTLY "${LIVE_TRADING_ENV_VALUE}"`,
  );
  add(
    "config-phase7-ready",
    input.configPhase7LiveTradingReady === true,
    "config sets the phase7LiveTradingReady field to true",
    "config field phase7LiveTradingReady is not true",
  );
  add(
    "cli-acknowledgment",
    input.cliAcknowledged === true,
    "the explicit CLI acknowledgment flag was passed",
    "the CLI flag --i-understand-this-can-lose-real-money was not passed",
  );
  add(
    "network-mainnet-beta",
    input.network === "mainnet-beta",
    'network is exactly "mainnet-beta"',
    'network is not exactly "mainnet-beta"',
  );
  add(
    "max-spend-cap",
    typeof input.maxSpendLamports === "string" && RAW_AMOUNT_RE.test(input.maxSpendLamports) && !/^0+$/.test(input.maxSpendLamports),
    "an explicit per-trade spend cap is set",
    "an explicit per-trade maxSpendLamports cap is required",
  );
  add(
    "session-loss-cap",
    typeof input.sessionLossCapSol === "number" && Number.isFinite(input.sessionLossCapSol) && input.sessionLossCapSol > 0,
    "an explicit session loss cap is set",
    "an explicit sessionLossCapSol cap is required",
  );
  add(
    "slippage-cap",
    Number.isInteger(input.slippageCapBps) && (input.slippageCapBps as number) > 0 && (input.slippageCapBps as number) <= 10000,
    "an explicit slippage cap is set",
    "an explicit slippageCapBps cap is required",
  );
  add(
    "kill-switch-clear",
    input.killSwitchActive === false,
    "the kill switch is explicitly clear",
    "the kill switch is active or its state is unknown — unknown is BLOCKED",
  );
  add(
    "quote-fresh",
    input.quoteFresh === true,
    "the quote freshness check passed",
    "the quote freshness check did not pass (stale, missing, or unchecked)",
  );
  add(
    "simulation-ok",
    input.simulationOutcome === "simulated-ok",
    "the exact envelope simulated ok",
    'the latest simulation outcome is not "simulated-ok"',
  );
  add(
    "risk-under-threshold",
    typeof input.riskScore === "number" &&
      Number.isFinite(input.riskScore) &&
      typeof input.riskScoreCap === "number" &&
      Number.isFinite(input.riskScoreCap) &&
      input.riskScore <= input.riskScoreCap,
    "the advisory risk score is under the explicit cap",
    "the advisory risk score is missing, the cap is missing, or the score exceeds the cap",
  );
  add(
    "wallet-validated",
    input.walletPublicKeyValid === true,
    "the destination wallet public key validated",
    "the destination wallet public key did not validate",
  );
  add(
    "signer-boundary",
    typeof input.signerBoundaryKind === "string" && input.signerBoundaryKind.length > 0,
    "the signer was loaded through the approved boundary",
    "no signer boundary is loaded (raw keys are never accepted)",
  );
  add(
    "audit-and-redaction",
    input.auditLogPathProvided === true && input.redactionFindings === 0,
    "an audit artifact path is set and zero redaction findings remain",
    "an audit artifact path is required and redaction findings must be exactly zero",
  );

  return { armed: checks.every((c) => c.satisfied), checks };
}
