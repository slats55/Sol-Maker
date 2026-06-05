import { describe, it, expect } from "vitest";
import { ConfigSchema, type Config } from "./config/schema.js";
import {
  evaluateLiveGate,
  assertLiveModeAllowed,
  LiveModeRefusedError,
  BURNER_RISK_ENV_FLAG,
} from "./live-gate.js";

/** A config + env that together satisfy EVERY live gate. */
function fullyArmed(): { config: Config; env: NodeJS.ProcessEnv } {
  const config = ConfigSchema.parse({
    mode: "DANGEROUS_BURNER_LIVE",
    killSwitch: false,
    caps: { maxTradeSizeSol: 0.05, maxDailyLossSol: 0.25, maxOpenPositions: 3 },
    live: {
      acknowledgeBurnerRisk: true,
      confirmFreshBurner: true,
      burnerKeyEnvVar: "SOULMAKER_BURNER_SECRET",
    },
  });
  const env: NodeJS.ProcessEnv = {
    [BURNER_RISK_ENV_FLAG]: "true",
    SOULMAKER_BURNER_SECRET: "fake-burner-key-for-test",
  };
  return { config, env };
}

describe("evaluateLiveGate", () => {
  it("refuses live mode for the default (PAPER) config", () => {
    const cfg = ConfigSchema.parse({});
    const result = evaluateLiveGate(cfg, {});
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/DANGEROUS_BURNER_LIVE/);
  });

  it("allows live mode only when every gate passes", () => {
    const { config, env } = fullyArmed();
    const result = evaluateLiveGate(config, env);
    expect(result).toEqual({ allowed: true, reasons: [] });
  });

  it("refuses if the kill switch is engaged", () => {
    const { config, env } = fullyArmed();
    const result = evaluateLiveGate({ ...config, killSwitch: true }, env);
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/kill switch/i);
  });

  it("refuses if the burner risk env flag is missing", () => {
    const { config, env } = fullyArmed();
    const { [BURNER_RISK_ENV_FLAG]: _omit, ...envWithout } = env;
    const result = evaluateLiveGate(config, envWithout);
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toContain(BURNER_RISK_ENV_FLAG);
  });

  it("refuses if the burner key env var is not present", () => {
    const { config, env } = fullyArmed();
    const { SOULMAKER_BURNER_SECRET: _omit, ...envWithout } = env;
    const result = evaluateLiveGate(config, envWithout);
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/burner key env var/i);
  });

  it("refuses if the fresh-burner confirmation is missing", () => {
    const { config, env } = fullyArmed();
    const weakened: Config = {
      ...config,
      live: { ...config.live, confirmFreshBurner: false },
    };
    const result = evaluateLiveGate(weakened, env);
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/fresh burner/i);
  });
});

describe("assertLiveModeAllowed", () => {
  it("throws LiveModeRefusedError for unsafe config", () => {
    const cfg = ConfigSchema.parse({});
    expect(() => assertLiveModeAllowed(cfg, {})).toThrow(LiveModeRefusedError);
  });

  it("does not throw when fully armed", () => {
    const { config, env } = fullyArmed();
    expect(() => assertLiveModeAllowed(config, env)).not.toThrow();
  });
});
