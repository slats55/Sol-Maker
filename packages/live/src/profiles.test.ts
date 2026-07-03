import { describe, it, expect } from "vitest";

import {
  BUILTIN_PROFILE_NAMES,
  STRATEGY_PROFILES,
  getBuiltinProfile,
  profileExitPolicy,
  requireLiveEligibleProfile,
  validateStrategyProfile,
} from "./profiles.js";
import { LIVE_HARD_CEILINGS } from "./policy.js";

describe("strategy profiles — built-ins", () => {
  it("all three built-ins pass their own validator", () => {
    for (const name of BUILTIN_PROFILE_NAMES) {
      const p = validateStrategyProfile(JSON.parse(JSON.stringify(STRATEGY_PROFILES[name])));
      expect(p.name).toBe(name);
    }
  });

  it("every built-in stays within the live hard ceilings (paper parity)", () => {
    for (const name of BUILTIN_PROFILE_NAMES) {
      const p = STRATEGY_PROFILES[name];
      expect(p.maxSpendSol).toBeLessThanOrEqual(LIVE_HARD_CEILINGS.maxTradeSol);
      expect(p.maxSlippageBps).toBeLessThanOrEqual(LIVE_HARD_CEILINGS.maxSlippageBps);
      expect(p.maxRiskScore).toBeLessThanOrEqual(LIVE_HARD_CEILINGS.riskScoreCap);
    }
  });

  it("aggressive-paper-only is live-INELIGIBLE and the live gate refuses it", () => {
    const aggressive = STRATEGY_PROFILES["aggressive-paper-only"];
    expect(aggressive.liveEligible).toBe(false);
    expect(() => requireLiveEligibleProfile(aggressive)).toThrow(/PAPER-ONLY/);
  });

  it("conservative is the live-eligible default shape", () => {
    const c = getBuiltinProfile("conservative");
    expect(requireLiveEligibleProfile(c)).toBe(c);
    expect(c.riskAppetite).toBe("conservative");
  });

  it("unknown built-in names are refused with the valid list", () => {
    expect(() => getBuiltinProfile("yolo")).toThrow(/conservative \| balanced \| aggressive-paper-only/);
  });
});

describe("strategy profiles — validation refuses invalid configs", () => {
  const base = (): Record<string, unknown> => JSON.parse(JSON.stringify(STRATEGY_PROFILES.balanced));

  it("an aggressive profile claiming live eligibility is REFUSED (no override)", () => {
    const p = base();
    p.riskAppetite = "aggressive";
    p.liveEligible = true;
    expect(() => validateStrategyProfile(p)).toThrow(/NEVER be live-eligible/);
    const named = base();
    named.name = "aggressive-paper-only";
    named.liveEligible = true;
    expect(() => validateStrategyProfile(named)).toThrow(/NEVER be live-eligible/);
  });

  it("spend over the live trade ceiling is refused", () => {
    const p = base();
    p.maxSpendSol = LIVE_HARD_CEILINGS.maxTradeSol + 0.01;
    expect(() => validateStrategyProfile(p)).toThrow(/maxSpendSol/);
  });

  it("slippage / risk score over ceiling are refused", () => {
    const slip = base();
    slip.maxSlippageBps = LIVE_HARD_CEILINGS.maxSlippageBps + 1;
    expect(() => validateStrategyProfile(slip)).toThrow(/maxSlippageBps/);
    const risk = base();
    risk.maxRiskScore = LIVE_HARD_CEILINGS.riskScoreCap + 1;
    expect(() => validateStrategyProfile(risk)).toThrow(/maxRiskScore/);
  });

  it("exit fields go through the SAME exit-policy bounds (stop that can never fire refused)", () => {
    const p = base();
    p.stopLossPct = 95;
    expect(() => validateStrategyProfile(p)).toThrow(/stopLossPct/);
    const hold = base();
    hold.maxHoldMs = 999_999_999;
    expect(() => validateStrategyProfile(hold)).toThrow(/maxHoldMs/);
  });

  it("quote TTL of 0 (unsatisfiable) and unknown fields are refused", () => {
    const p = base();
    p.quoteFreshnessTtlMs = 0;
    expect(() => validateStrategyProfile(p)).toThrow(/quoteFreshnessTtlMs/);
    const extra = base();
    extra.bonusField = 1;
    expect(() => validateStrategyProfile(extra)).toThrow(/CLOSED/);
  });

  it("sensitive-named fields are refused", () => {
    const p = base();
    p.privateKey = "x";
    expect(() => validateStrategyProfile(p)).toThrow(/sensitive/);
  });

  it("the derived exit policy round-trips through the ledger's builder", () => {
    const exit = profileExitPolicy(STRATEGY_PROFILES.conservative);
    expect(exit.stopLossPct).toBe(15);
    expect(exit.trailingStopPct).toBe(10);
  });
});
