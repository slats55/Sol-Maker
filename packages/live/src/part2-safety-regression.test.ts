/**
 * PART 2 SAFETY REGRESSION (Sprint 108).
 *
 * Proves that the new armed sniper loop does NOT weaken any Part 1 gate. The strongest thing the
 * loop can do is RECOMMEND `prepare_canary_request`; this suite drives that recommendation all the
 * way through Part 1's `buildLiveCanaryRequest` and asserts the resulting artifact is still
 * unsigned, Phantom-required, and never sent — and that a non-armed loop can never get there.
 */

import { describe, expect, it } from "vitest";

import { buildUnsignedSelfTransferProbe } from "@soulmaker/txpreview";
import { isSensitiveKey } from "@soulmaker/security";

import { buildLiveCanaryRequest, redactCanaryRequestForOutput } from "./canary-request.js";
import { normalizeManualMint } from "./discovery.js";
import type { SniperCandidate, SniperCandidateRisk } from "./discovery.js";
import { buildEscalationPolicy } from "./escalation.js";
import { buildLivePolicy } from "./policy.js";
import type { StrategyQuoteFacts } from "./strategy.js";
import { evaluateCandidatePipeline, loopModeCanTrade, SNIPER_LOOP_MODES } from "./sniper-loop.js";
import type { CandidatePipelineContext, SniperLoopMode } from "./sniper-loop.js";

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC mint — public fixture, never a wallet
const FEE_PAYER = "So11111111111111111111111111111111111111112";
const AT = "2026-06-18T00:00:00.000Z";
const NOW = 1_750_000_000_000;

const cleanRisk: SniperCandidateRisk = { score: 5, decision: "ACCEPT", criticalFlagCount: 0, freezeAuthorityPresent: false, mintAuthorityPresent: false };
const freshQuote: StrategyQuoteFacts = { priceImpactPct: 0.5, ageMs: 1_000, slippageBps: 50, routeConfidence: 0.9, provider: "jupiter" };

function candidate(over: Partial<SniperCandidate> = {}): SniperCandidate {
  const base = normalizeManualMint({ mint: MINT, symbol: "USDC" }, { discoveredAt: AT });
  return { ...base, risk: cleanRisk, liquidityUsd: 50_000, volumeUsd: 100_000, poolAgeSeconds: 600, ...over };
}

function ctx(mode: SniperLoopMode): CandidatePipelineContext {
  return {
    mode,
    policy: buildLivePolicy({ mode: "live_canary", liveEnabled: true, walletProvider: "phantom" }),
    escalationPolicy: buildEscalationPolicy(),
    escalationSession: { armed: true, lastCanaryAtMs: null },
    nowMs: NOW,
    timestamp: AT,
  };
}

describe("part2 regression — the loop never sends, never trades", () => {
  it("every loop result pins loopNeverSends and no mode can trade", () => {
    for (const m of SNIPER_LOOP_MODES) {
      expect(loopModeCanTrade(m)).toBe(false);
      const r = evaluateCandidatePipeline({ candidate: candidate(), quote: freshQuote, quoteFresh: true, plannedSpendSol: 0.005 }, ctx(m));
      expect(r.loopNeverSends).toBe(true);
    }
  });

  it("an armed recommendation, built into a real canary request, is STILL unsigned + Phantom-required + never sent", () => {
    const armed = evaluateCandidatePipeline({ candidate: candidate(), quote: freshQuote, quoteFresh: true, plannedSpendSol: 0.005 }, ctx("armed_canary"));
    expect(armed.action).toBe("prepare_canary_request");

    // Now actually assemble the Part 1 artifact (this is the out-of-band human step).
    const request = buildLiveCanaryRequest({
      policy: buildLivePolicy({ mode: "live_canary", liveEnabled: true, walletProvider: "phantom" }),
      createdAt: AT,
      nowMs: NOW,
      candidate: { mint: MINT, symbol: "USDC" },
      quote: {
        provider: "jupiter",
        inputMint: FEE_PAYER,
        outputMint: MINT,
        inAmountRaw: "1000000",
        outAmountRaw: "999000",
        slippageBps: 50,
        priceImpactPct: 0.5,
        quotedAt: AT,
        ageMs: 1_000,
        routeLabels: ["jupiter"],
      },
      risk: { score: 5, decision: "ACCEPT", criticalFlagCount: 0, flagIds: [] },
      preflight: { simulationOutcome: "simulated-ok", simulationClassification: "none" },
      spendLamports: "1000000",
      envelope: buildUnsignedSelfTransferProbe({ feePayerPublicKey: FEE_PAYER, network: "mainnet-beta" }),
      auditLogPathProvided: true,
    });

    expect(request.state).toBe("preflight_ready");
    expect(request.prepared).toBe(true);
    expect(request.signed).toBe(false);
    expect(request.submitted).toBe(false);
    expect(request.confirmed).toBe(false);
    expect(request.backendCustodiesNoKeys).toBe(true);
    expect(request.requiresPhantomHumanConfirmation).toBe(true);
    expect(request.phase7LiveTradingReady).toBe(false);
  });

  it("the redacted artifact carries no sensitive-named field", () => {
    const request = buildLiveCanaryRequest({
      policy: buildLivePolicy({ mode: "live_canary", liveEnabled: true, walletProvider: "phantom" }),
      createdAt: AT,
      nowMs: NOW,
      candidate: { mint: MINT, symbol: "USDC" },
      quote: {
        provider: "jupiter",
        inputMint: FEE_PAYER,
        outputMint: MINT,
        inAmountRaw: "1000000",
        outAmountRaw: "999000",
        slippageBps: 50,
        priceImpactPct: 0.5,
        quotedAt: AT,
        ageMs: 1_000,
        routeLabels: ["jupiter"],
      },
      risk: { score: 5, decision: "ACCEPT", criticalFlagCount: 0, flagIds: [] },
      preflight: { simulationOutcome: "simulated-ok", simulationClassification: "none" },
      spendLamports: "1000000",
      envelope: buildUnsignedSelfTransferProbe({ feePayerPublicKey: FEE_PAYER, network: "mainnet-beta" }),
      auditLogPathProvided: true,
    });
    const redacted = redactCanaryRequestForOutput(request) as Record<string, unknown>;
    for (const key of Object.keys(redacted)) expect(isSensitiveKey(key)).toBe(false);
  });

  it("a non-armed loop mode can never reach a canary recommendation, even with a perfect candidate", () => {
    for (const m of ["off", "observe_only", "paper_shadow", "paused", "killed"] as SniperLoopMode[]) {
      const r = evaluateCandidatePipeline({ candidate: candidate(), quote: freshQuote, quoteFresh: true, plannedSpendSol: 0.005 }, ctx(m));
      expect(r.action).not.toBe("prepare_canary_request");
      expect(r.canaryPreparable).toBe(false);
    }
  });
});
