import { describe, expect, it } from "vitest";

import {
  LIVE_HARD_CEILINGS,
  LIVE_POLICY_DEFAULTS,
  LIVE_SOLANA_MAINNET_CHAIN_ID,
  buildLivePolicy,
  evaluateLivePolicy,
  validateLivePolicy,
  LivePolicyError,
  type BuildLivePolicyInput,
} from "./policy.js";

/** A policy that is fully configured for live canary trading (the happy path). */
function liveCanaryInput(overrides: BuildLivePolicyInput = {}): BuildLivePolicyInput {
  return {
    mode: "live_canary",
    liveEnabled: true,
    walletProvider: "phantom",
    chainAllowlist: [LIVE_SOLANA_MAINNET_CHAIN_ID],
    ...overrides,
  };
}

describe("buildLivePolicy — conservative defaults", () => {
  it("an empty policy is paper + live-disabled and permits nothing live", () => {
    const policy = buildLivePolicy();
    expect(policy.mode).toBe("paper");
    expect(policy.liveEnabled).toBe(false);
    expect(policy.walletProvider).toBeNull();
    expect(policy.caps.maxTradeSol).toBe(LIVE_POLICY_DEFAULTS.maxTradeSol);
    expect(policy.backendCustodiesNoKeys).toBe(true);
    expect(policy.phantomSignsInBrowser).toBe(true);

    const evaluation = evaluateLivePolicy(policy);
    expect(evaluation.prepareAllowed).toBe(false);
    expect(evaluation.canaryArmAllowed).toBe(false);
    expect(evaluation.blockingReasons).toContain("live-disabled");
    expect(evaluation.blockingReasons).toContain("mode-not-live");
    expect(evaluation.blockingReasons).toContain("wallet-provider-not-phantom");
  });

  it("defaults are all at or below the hard ceilings", () => {
    expect(LIVE_POLICY_DEFAULTS.maxTradeSol).toBeLessThanOrEqual(LIVE_HARD_CEILINGS.maxTradeSol);
    expect(LIVE_POLICY_DEFAULTS.maxSlippageBps).toBeLessThanOrEqual(LIVE_HARD_CEILINGS.maxSlippageBps);
    expect(LIVE_POLICY_DEFAULTS.maxDailyTrades).toBeLessThanOrEqual(LIVE_HARD_CEILINGS.maxDailyTrades);
    expect(LIVE_POLICY_DEFAULTS.riskScoreCap).toBeLessThanOrEqual(LIVE_HARD_CEILINGS.riskScoreCap);
  });
});

describe("buildLivePolicy — caps only tighten", () => {
  it("refuses a per-trade cap above the hard ceiling", () => {
    expect(() => buildLivePolicy({ caps: { maxTradeSol: LIVE_HARD_CEILINGS.maxTradeSol + 0.01 } })).toThrow(LivePolicyError);
  });

  it("refuses a slippage cap above the hard ceiling", () => {
    expect(() => buildLivePolicy({ caps: { maxSlippageBps: LIVE_HARD_CEILINGS.maxSlippageBps + 1 } })).toThrow(/exceeds the absolute hard ceiling/);
  });

  it("refuses a risk-score cap above the hard ceiling", () => {
    expect(() => buildLivePolicy({ caps: { riskScoreCap: LIVE_HARD_CEILINGS.riskScoreCap + 1 } })).toThrow(LivePolicyError);
  });

  it("allows a SMALLER cap (tightening is always fine)", () => {
    const policy = buildLivePolicy({ caps: { maxTradeSol: 0.001 } });
    expect(policy.caps.maxTradeSol).toBe(0.001);
  });

  it("refuses a non-positive trade cap", () => {
    expect(() => buildLivePolicy({ caps: { maxTradeSol: 0 } })).toThrow(LivePolicyError);
    expect(() => buildLivePolicy({ caps: { maxTradeSol: -1 } })).toThrow(LivePolicyError);
  });
});

describe("evaluateLivePolicy — the gate", () => {
  it("a fully-configured live_canary policy is prepare + arm allowed", () => {
    const evaluation = evaluateLivePolicy(buildLivePolicy(liveCanaryInput()));
    expect(evaluation.blockingReasons).toEqual([]);
    expect(evaluation.prepareAllowed).toBe(true);
    expect(evaluation.canaryArmAllowed).toBe(true);
  });

  it("live_prepare can prepare but NOT arm a canary send", () => {
    const evaluation = evaluateLivePolicy(buildLivePolicy(liveCanaryInput({ mode: "live_prepare" })));
    expect(evaluation.prepareAllowed).toBe(true);
    expect(evaluation.canaryArmAllowed).toBe(false);
  });

  it("the kill switch blocks everything live", () => {
    const evaluation = evaluateLivePolicy(buildLivePolicy(liveCanaryInput({ killSwitch: true })));
    expect(evaluation.prepareAllowed).toBe(false);
    expect(evaluation.canaryArmAllowed).toBe(false);
    expect(evaluation.blockingReasons).toContain("kill-switch-active");
  });

  it("an emergency stop blocks everything live", () => {
    const evaluation = evaluateLivePolicy(buildLivePolicy(liveCanaryInput({ emergencyStopFilePresent: true })));
    expect(evaluation.prepareAllowed).toBe(false);
    expect(evaluation.blockingReasons).toContain("emergency-stop-present");
  });

  it("a non-phantom wallet provider blocks live", () => {
    // walletProvider null is the only other allowed value; it must block.
    const evaluation = evaluateLivePolicy(buildLivePolicy(liveCanaryInput({ walletProvider: null })));
    expect(evaluation.blockingReasons).toContain("wallet-provider-not-phantom");
    expect(evaluation.prepareAllowed).toBe(false);
  });

  it("missing solana-mainnet on the allowlist blocks live", () => {
    const evaluation = evaluateLivePolicy(buildLivePolicy(liveCanaryInput({ chainAllowlist: ["base-mainnet"] })));
    expect(evaluation.blockingReasons).toContain("solana-mainnet-not-allowlisted");
  });

  it("disabling required preflight/manual-confirmation/audit blocks live", () => {
    const evaluation = evaluateLivePolicy(
      buildLivePolicy(liveCanaryInput({ requirePreflightSimulation: false, requireManualConfirmation: false, requireAuditLog: false })),
    );
    expect(evaluation.blockingReasons).toContain("preflight-simulation-not-required");
    expect(evaluation.blockingReasons).toContain("manual-confirmation-not-required");
    expect(evaluation.blockingReasons).toContain("audit-log-not-required");
  });

  it("warns (but does not block) when an unimplemented chain is allowlisted alongside solana", () => {
    const evaluation = evaluateLivePolicy(
      buildLivePolicy(liveCanaryInput({ chainAllowlist: [LIVE_SOLANA_MAINNET_CHAIN_ID, "ethereum-mainnet"] })),
    );
    expect(evaluation.prepareAllowed).toBe(true);
    expect(evaluation.warnings.some((w) => w.includes("ethereum-mainnet"))).toBe(true);
  });
});

describe("validateLivePolicy — closed schema", () => {
  it("round-trips a built policy", () => {
    const policy = buildLivePolicy(liveCanaryInput());
    expect(validateLivePolicy(policy)).toEqual(policy);
  });

  it("refuses an unknown field", () => {
    const policy = { ...buildLivePolicy(), surpriseField: true };
    expect(() => validateLivePolicy(policy)).toThrow(/CLOSED/);
  });

  it("refuses a sensitive-named field", () => {
    const policy = { ...buildLivePolicy(), privateKey: "x" };
    expect(() => validateLivePolicy(policy)).toThrow(/sensitive-named/);
  });

  it("refuses a flipped honesty literal", () => {
    const policy = { ...buildLivePolicy(), backendCustodiesNoKeys: false };
    expect(() => validateLivePolicy(policy)).toThrow(/backendCustodiesNoKeys/);
  });

  it("re-applies hard caps on validate (cannot smuggle an over-ceiling cap)", () => {
    const policy = buildLivePolicy(liveCanaryInput());
    const tampered = { ...policy, caps: { ...policy.caps, maxTradeSol: 999 } };
    expect(() => validateLivePolicy(tampered)).toThrow(/hard ceiling/);
  });
});
