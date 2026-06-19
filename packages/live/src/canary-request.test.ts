import { describe, expect, it } from "vitest";

import { buildUnsignedSelfTransferProbe } from "@soulmaker/txpreview";
import type { UnsignedTxEnvelope } from "@soulmaker/txpreview";

import {
  buildLiveCanaryRequest,
  redactCanaryRequestForOutput,
  validateLiveCanaryRequest,
  LiveCanaryRequestError,
  type BuildLiveCanaryRequestInput,
} from "./canary-request.js";
import { buildLivePolicy, LIVE_SOLANA_MAINNET_CHAIN_ID, type BuildLivePolicyInput } from "./policy.js";

// A real, valid, UNSIGNED mainnet-beta envelope (no network needed). The fee payer is a well-known
// PUBLIC address used only as a test fixture — never a wallet, never used live.
const FIXTURE_PUBKEY = "So11111111111111111111111111111111111111112";
const CANDIDATE_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC mint (public, fixture)

function mainnetEnvelope(): UnsignedTxEnvelope {
  return buildUnsignedSelfTransferProbe({ feePayerPublicKey: FIXTURE_PUBKEY, network: "mainnet-beta" });
}

function livePolicy(overrides: BuildLivePolicyInput = {}) {
  return buildLivePolicy({
    mode: "live_canary",
    liveEnabled: true,
    walletProvider: "phantom",
    chainAllowlist: [LIVE_SOLANA_MAINNET_CHAIN_ID],
    ...overrides,
  });
}

function baseInput(overrides: Partial<BuildLiveCanaryRequestInput> = {}): BuildLiveCanaryRequestInput {
  return {
    policy: livePolicy(),
    createdAt: "2026-06-18T00:00:00.000Z",
    nowMs: 1_750_000_000_000,
    candidate: { mint: CANDIDATE_MINT, symbol: "USDC" },
    quote: {
      provider: "jupiter-lite-api",
      inputMint: FIXTURE_PUBKEY,
      outputMint: CANDIDATE_MINT,
      inAmountRaw: "1000000",
      outAmountRaw: "999000",
      slippageBps: 50,
      priceImpactPct: 0.2,
      quotedAt: "2026-06-18T00:00:00.000Z",
      ageMs: 1000,
      routeLabels: ["jupiter"],
    },
    risk: { score: 10, decision: "PASS_FOR_PAPER_EVALUATION", criticalFlagCount: 0, flagIds: [] },
    preflight: { simulationOutcome: "simulated-ok", simulationClassification: "none" },
    spendLamports: "1000000",
    envelope: mainnetEnvelope(),
    auditLogPathProvided: true,
    ...overrides,
  };
}

describe("buildLiveCanaryRequest — happy path", () => {
  it("a fully green request reaches preflight_ready and embeds the real unsigned envelope", () => {
    const req = buildLiveCanaryRequest(baseInput());
    expect(req.state).toBe("preflight_ready");
    expect(req.blockingReasons).toEqual([]);
    expect(req.envelope).not.toBeNull();
    expect(req.envelope?.network).toBe("mainnet-beta");
    // Honesty literals: a request is always pre-signature.
    expect(req.prepared).toBe(true);
    expect(req.signed).toBe(false);
    expect(req.submitted).toBe(false);
    expect(req.confirmed).toBe(false);
    expect(req.backendCustodiesNoKeys).toBe(true);
    expect(req.requiresPhantomHumanConfirmation).toBe(true);
    expect(req.phase7LiveTradingReady).toBe(false);
    expect(req.banner).toMatch(/REAL-MONEY/);
  });

  it("without a green simulation it stays quote_ready (cannot be armed)", () => {
    const req = buildLiveCanaryRequest(baseInput({ preflight: { simulationOutcome: "unavailable", simulationClassification: null } }));
    expect(req.state).toBe("quote_ready");
  });

  it("FAILS CLOSED on a null quote: caps cannot be verified, so it can never reach preflight_ready", () => {
    // Even with a valid envelope, a green simulation, and a green policy, a null quote means
    // slippage/freshness can't be checked — the request must NOT be armable.
    const req = buildLiveCanaryRequest(baseInput({ quote: null }));
    expect(req.state).not.toBe("preflight_ready");
    expect(req.state).toBe("blocked_by_policy");
    expect(req.blockingReasons).toContain("safety-slippage-missing");
    expect(req.blockingReasons).toContain("safety-quote-age-missing");
  });
});

describe("buildLiveCanaryRequest — policy blocks", () => {
  it("a paper / live-disabled policy blocks by policy", () => {
    const req = buildLiveCanaryRequest(baseInput({ policy: buildLivePolicy() }));
    expect(req.state).toBe("blocked_by_policy");
    expect(req.blockingReasons).toContain("live-disabled");
  });

  it("the kill switch blocks by policy", () => {
    const req = buildLiveCanaryRequest(baseInput({ policy: livePolicy({ killSwitch: true }) }));
    expect(req.state).toBe("blocked_by_policy");
    expect(req.blockingReasons).toContain("kill-switch-active");
  });

  it("a spend over the per-trade cap blocks by policy", () => {
    // cap default 0.005 SOL = 5_000_000 lamports; ask for 10_000_000.
    const req = buildLiveCanaryRequest(baseInput({ spendLamports: "10000000" }));
    expect(req.state).toBe("blocked_by_policy");
    expect(req.blockingReasons).toContain("safety-spend-over-cap");
  });

  it("a slippage over the cap blocks by policy", () => {
    const input = baseInput();
    input.quote!.slippageBps = 500; // cap is 100
    const req = buildLiveCanaryRequest(input);
    expect(req.state).toBe("blocked_by_policy");
    expect(req.blockingReasons).toContain("safety-slippage-over-cap");
  });

  it("a stale quote blocks by policy", () => {
    const input = baseInput();
    input.quote!.ageMs = 60_000; // ttl is 8_000
    const req = buildLiveCanaryRequest(input);
    expect(req.state).toBe("blocked_by_policy");
    expect(req.blockingReasons).toContain("safety-quote-stale");
  });

  it("a denylisted mint blocks by policy", () => {
    const req = buildLiveCanaryRequest(baseInput({ policy: livePolicy({ tokenDenylist: [CANDIDATE_MINT] }) }));
    expect(req.state).toBe("blocked_by_policy");
    expect(req.blockingReasons).toContain("safety-mint-blocked");
  });

  it("a failed simulation blocks by policy", () => {
    const req = buildLiveCanaryRequest(baseInput({ preflight: { simulationOutcome: "simulated-failed", simulationClassification: "account-error" } }));
    expect(req.state).toBe("blocked_by_policy");
    expect(req.blockingReasons).toContain("preflight-simulation-failed");
  });
});

describe("buildLiveCanaryRequest — risk blocks", () => {
  it("a REJECT risk decision blocks by risk", () => {
    const req = buildLiveCanaryRequest(baseInput({ risk: { score: 80, decision: "REJECT", criticalFlagCount: 1, flagIds: ["freeze-authority"] } }));
    expect(req.state).toBe("blocked_by_risk");
  });

  it("a risk score over the policy cap blocks by risk", () => {
    const req = buildLiveCanaryRequest(baseInput({ risk: { score: 40, decision: "CAUTION", criticalFlagCount: 0, flagIds: [] } }));
    expect(req.state).toBe("blocked_by_risk");
    expect(req.blockingReasons).toContain("safety-risk-over-cap");
  });

  it("policy block precedence: live-disabled wins even with a risk rejection", () => {
    const req = buildLiveCanaryRequest(
      baseInput({ policy: buildLivePolicy(), risk: { score: 90, decision: "REJECT", criticalFlagCount: 2, flagIds: [] } }),
    );
    expect(req.state).toBe("blocked_by_policy");
  });
});

describe("buildLiveCanaryRequest — envelope safety", () => {
  it("refuses a non-mainnet envelope", () => {
    const devnet = buildUnsignedSelfTransferProbe({ feePayerPublicKey: FIXTURE_PUBKEY, network: "devnet" });
    expect(() => buildLiveCanaryRequest(baseInput({ envelope: devnet }))).toThrow(LiveCanaryRequestError);
  });
});

describe("redactCanaryRequestForOutput — preserves the unsigned envelope", () => {
  it("keeps txBase64 intact (redaction must not corrupt the public unsigned tx) and re-validates", () => {
    const req = buildLiveCanaryRequest(baseInput());
    const redacted = redactCanaryRequestForOutput(req) as { envelope: { txBase64: string } };
    expect(redacted.envelope.txBase64).toBe(req.envelope?.txBase64);
    // The redacted form must still pass the strict validator (which deserializes txBase64).
    expect(() => validateLiveCanaryRequest(redacted)).not.toThrow();
  });
});

describe("validateLiveCanaryRequest — closed schema", () => {
  it("round-trips a built request", () => {
    const req = buildLiveCanaryRequest(baseInput());
    expect(validateLiveCanaryRequest(req)).toEqual(req);
  });

  it("refuses a request claiming it was already signed", () => {
    const req = { ...buildLiveCanaryRequest(baseInput()), signed: true };
    expect(() => validateLiveCanaryRequest(req)).toThrow(/signed/);
  });

  it("refuses a request carrying a post-signature state", () => {
    const req = { ...buildLiveCanaryRequest(baseInput()), state: "submitted" };
    expect(() => validateLiveCanaryRequest(req)).toThrow(/state must be/);
  });

  it("refuses a sensitive-named field", () => {
    const req = { ...buildLiveCanaryRequest(baseInput()), secretKey: "x" };
    expect(() => validateLiveCanaryRequest(req)).toThrow(/sensitive-named/);
  });
});
