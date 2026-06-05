/**
 * The live-mode gate.
 *
 * This is the single function the rest of the system must call before any code
 * path that could sign or send a real transaction. It fails CLOSED: every
 * condition must independently pass, and any failure collects a human-readable
 * reason. It reads, but never logs, the burner key env var (presence only).
 */

import { isLiveMode } from "./modes.js";
import { HARD_LIMITS, type Config } from "./config/schema.js";

/** Out-of-band acknowledgement that must be set in the environment. */
export const BURNER_RISK_ENV_FLAG = "SOULMAKER_I_UNDERSTAND_BURNER_RISK";

export interface LiveGateResult {
  allowed: boolean;
  /** Empty when allowed; otherwise one entry per failed gate. */
  reasons: string[];
}

export class LiveModeRefusedError extends Error {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super(`Live mode refused:\n  - ${reasons.join("\n  - ")}`);
    this.name = "LiveModeRefusedError";
    this.reasons = reasons;
  }
}

export function evaluateLiveGate(
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
): LiveGateResult {
  const reasons: string[] = [];

  if (!isLiveMode(config.mode)) {
    reasons.push(
      `mode is "${config.mode}", not "DANGEROUS_BURNER_LIVE" (live sending requires the explicit dangerous mode)`,
    );
  }

  if (config.killSwitch) {
    reasons.push("kill switch is engaged (killSwitch=true)");
  }

  if (!config.live.acknowledgeBurnerRisk) {
    reasons.push("live.acknowledgeBurnerRisk is not true");
  }

  if (!config.live.confirmFreshBurner) {
    reasons.push("live.confirmFreshBurner is not true (must use a fresh burner)");
  }

  if (!config.live.burnerKeyEnvVar) {
    reasons.push("live.burnerKeyEnvVar is not set");
  } else if (!env[config.live.burnerKeyEnvVar]) {
    reasons.push(
      `burner key env var "${config.live.burnerKeyEnvVar}" is not present in the environment`,
    );
  }

  if (env[BURNER_RISK_ENV_FLAG] !== "true") {
    reasons.push(`${BURNER_RISK_ENV_FLAG} env flag is not exactly "true"`);
  }

  // Defense in depth — the schema already enforces these ceilings, but we
  // re-check here so the gate is safe even if handed a config built elsewhere.
  if (config.caps.maxTradeSizeSol > HARD_LIMITS.maxTradeSizeSol) {
    reasons.push("caps.maxTradeSizeSol exceeds the hard limit");
  }
  if (config.caps.maxDailyLossSol > HARD_LIMITS.maxDailyLossSol) {
    reasons.push("caps.maxDailyLossSol exceeds the hard limit");
  }
  if (config.caps.maxOpenPositions > HARD_LIMITS.maxOpenPositions) {
    reasons.push("caps.maxOpenPositions exceeds the hard limit");
  }

  return { allowed: reasons.length === 0, reasons };
}

/** Throws {@link LiveModeRefusedError} unless every live gate passes. */
export function assertLiveModeAllowed(
  config: Config,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const result = evaluateLiveGate(config, env);
  if (!result.allowed) {
    throw new LiveModeRefusedError(result.reasons);
  }
}
