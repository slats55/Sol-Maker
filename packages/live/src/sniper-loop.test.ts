import { describe, expect, it } from "vitest";

import { normalizeManualMint } from "./discovery.js";
import type { SniperCandidate, SniperCandidateRisk } from "./discovery.js";
import { buildEscalationPolicy } from "./escalation.js";
import type { EscalationSessionState } from "./escalation.js";
import { buildLivePolicy } from "./policy.js";
import type { LiveModePolicy } from "./policy.js";
import type { StrategyQuoteFacts } from "./strategy.js";
import {
  SNIPER_LOOP_DEFAULT_MODE,
  SNIPER_LOOP_MODES,
  evaluateCandidatePipeline,
  loopModeCanPrepareCanary,
  loopModeCanTrade,
  loopModeProcesses,
  sniperLoopModeTransition,
} from "./sniper-loop.js";
import type { CandidatePipelineContext, SniperLoopMode } from "./sniper-loop.js";

const MINT = "So11111111111111111111111111111111111111112";
const AT = "2026-06-18T00:00:00.000Z";
const NOW = 2_000_000;

const cleanRisk: SniperCandidateRisk = { score: 5, decision: "ACCEPT", criticalFlagCount: 0, freezeAuthorityPresent: false, mintAuthorityPresent: false };
const freshQuote: StrategyQuoteFacts = { priceImpactPct: 0.5, ageMs: 1_000, slippageBps: 50, routeConfidence: 0.9, provider: "jupiter" };

function candidate(over: Partial<SniperCandidate> = {}): SniperCandidate {
  const base = normalizeManualMint({ mint: MINT, symbol: "WSOL" }, { discoveredAt: AT });
  return { ...base, risk: cleanRisk, liquidityUsd: 50_000, volumeUsd: 100_000, poolAgeSeconds: 600, ...over };
}

/** A live policy fully green for a canary (the only configuration that can ever reach canary-prep). */
function greenPolicy(over: Partial<Parameters<typeof buildLivePolicy>[0]> = {}): LiveModePolicy {
  return buildLivePolicy({ mode: "live_canary", liveEnabled: true, walletProvider: "phantom", ...over });
}

function ctx(mode: SniperLoopMode, over: Partial<CandidatePipelineContext> = {}): CandidatePipelineContext {
  return {
    mode,
    policy: greenPolicy(),
    escalationPolicy: buildEscalationPolicy(),
    escalationSession: { armed: true, lastCanaryAtMs: null } as EscalationSessionState,
    nowMs: NOW,
    timestamp: AT,
    ...over,
  };
}

function pipe(mode: SniperLoopMode, over: Partial<CandidatePipelineContext> = {}) {
  return evaluateCandidatePipeline({ candidate: candidate(), quote: freshQuote, quoteFresh: true, plannedSpendSol: 0.005 }, ctx(mode, over));
}

describe("sniper loop — default + capability invariants", () => {
  it("the default mode is off", () => {
    expect(SNIPER_LOOP_DEFAULT_MODE).toBe("off");
  });

  it("NO mode can trade — loopModeCanTrade is false for every mode", () => {
    for (const m of SNIPER_LOOP_MODES) expect(loopModeCanTrade(m)).toBe(false);
  });

  it("only armed_canary can prepare a canary", () => {
    for (const m of SNIPER_LOOP_MODES) expect(loopModeCanPrepareCanary(m)).toBe(m === "armed_canary");
  });

  it("off and killed process nothing", () => {
    expect(loopModeProcesses("off")).toBe(false);
    expect(loopModeProcesses("killed")).toBe(false);
  });
});

describe("sniper loop — mode state machine", () => {
  it("arming requires the full explicit path off→observe_only→paper_shadow→armed_canary", () => {
    expect(sniperLoopModeTransition("off", "START").mode).toBe("observe_only");
    expect(sniperLoopModeTransition("observe_only", "ENABLE_PAPER_SHADOW").mode).toBe("paper_shadow");
    expect(sniperLoopModeTransition("paper_shadow", "ARM_CANARY").mode).toBe("armed_canary");
  });

  it("there is no shortcut from observe_only straight to armed_canary", () => {
    expect(sniperLoopModeTransition("observe_only", "ARM_CANARY").ok).toBe(false);
    expect(sniperLoopModeTransition("off", "ARM_CANARY").ok).toBe(false);
  });

  it("KILL is reachable from every non-killed mode and only RESET leaves it", () => {
    for (const m of SNIPER_LOOP_MODES) {
      if (m === "killed") continue;
      expect(sniperLoopModeTransition(m, "KILL").mode).toBe("killed");
    }
    expect(sniperLoopModeTransition("killed", "RESUME").ok).toBe(false);
    expect(sniperLoopModeTransition("killed", "RESET").mode).toBe("off");
  });

  it("resume from paused returns to the SAFE observe_only (re-arming requires the hops again)", () => {
    expect(sniperLoopModeTransition("paused", "RESUME").mode).toBe("observe_only");
  });
});

describe("sniper loop — pipeline cannot trade in non-armed modes", () => {
  it("off → blocked, no stages run", () => {
    const r = pipe("off");
    expect(r.action).toBe("blocked");
    expect(r.stagesRun).toHaveLength(0);
    expect(r.blockingReasons).toContain("loop-off");
  });

  it("killed → blocked, no stages run (kill blocks all action)", () => {
    const r = pipe("killed");
    expect(r.action).toBe("blocked");
    expect(r.stagesRun).toHaveLength(0);
    expect(r.blockingReasons).toContain("loop-killed");
  });

  it("observe_only can score+watchlist but NEVER prepares a canary", () => {
    const r = pipe("observe_only");
    expect(r.action).not.toBe("prepare_canary_request");
    expect(r.canaryPreparable).toBe(false);
    expect(r.action).toBe("watch");
  });

  it("paper_shadow runs the shadow but NEVER prepares a canary", () => {
    const r = pipe("paper_shadow");
    expect(r.action).toBe("paper_shadow");
    expect(r.canaryPreparable).toBe(false);
    expect(r.stagesRun).toContain("paper_shadow");
  });

  it("paused never prepares a canary", () => {
    const r = pipe("paused");
    expect(r.action).not.toBe("prepare_canary_request");
    expect(r.canaryPreparable).toBe(false);
  });
});

describe("sniper loop — armed_canary prepares (recommends) but never sends", () => {
  it("a fully-green candidate in armed_canary reaches prepare_canary_request", () => {
    const r = pipe("armed_canary");
    expect(r.action).toBe("prepare_canary_request");
    expect(r.canaryEligible).toBe(true);
    expect(r.canaryPreparable).toBe(true);
    expect(r.loopNeverSends).toBe(true);
    expect(r.stagesRun).toContain("prepare_canary_request");
    expect(r.events.some((e) => e.event === "candidate-canary-eligible")).toBe(true);
  });
});

describe("sniper loop — every gate blocks the canary in armed mode", () => {
  it("a stale quote blocks the canary", () => {
    const r = evaluateCandidatePipeline({ candidate: candidate(), quote: freshQuote, quoteFresh: false, plannedSpendSol: 0.005 }, ctx("armed_canary"));
    expect(r.canaryPreparable).toBe(false);
    expect(r.blockingReasons).toContain("quote-stale");
  });

  it("a missing quote blocks the canary (fail-closed)", () => {
    const r = evaluateCandidatePipeline({ candidate: candidate(), quote: null, quoteFresh: null, plannedSpendSol: 0.005 }, ctx("armed_canary"));
    expect(r.canaryPreparable).toBe(false);
    expect(r.blockingReasons).toContain("quote-missing");
  });

  it("a risk REJECT blocks the canary and the live decision", () => {
    const r = evaluateCandidatePipeline(
      { candidate: candidate({ risk: { ...cleanRisk, decision: "REJECT" } }), quote: freshQuote, quoteFresh: true, plannedSpendSol: 0.005 },
      ctx("armed_canary"),
    );
    expect(r.canaryPreparable).toBe(false);
    expect(r.strategy?.decision).not.toBe("live_canary_candidate");
  });

  it("a non-canary live policy (paper mode) blocks prep via policy:* reasons", () => {
    const r = evaluateCandidatePipeline(
      { candidate: candidate(), quote: freshQuote, quoteFresh: true, plannedSpendSol: 0.005 },
      ctx("armed_canary", { policy: buildLivePolicy({ mode: "paper" }) }),
    );
    expect(r.canaryPreparable).toBe(false);
    expect(r.blockingReasons.some((c) => c.startsWith("policy:"))).toBe(true);
  });

  it("the live kill switch blocks prep even when armed", () => {
    const r = evaluateCandidatePipeline(
      { candidate: candidate(), quote: freshQuote, quoteFresh: true, plannedSpendSol: 0.005 },
      ctx("armed_canary", { policy: greenPolicy({ killSwitch: true }) }),
    );
    expect(r.canaryPreparable).toBe(false);
    expect(r.blockingReasons).toContain("policy:kill-switch-active");
  });

  it("escalation cooldown blocks prep (escalation:cooldown-active)", () => {
    const r = evaluateCandidatePipeline(
      { candidate: candidate(), quote: freshQuote, quoteFresh: true, plannedSpendSol: 0.005 },
      ctx("armed_canary", { escalationPolicy: buildEscalationPolicy({ cooldownMs: 300_000 }), escalationSession: { armed: true, lastCanaryAtMs: NOW - 1_000 } }),
    );
    expect(r.canaryPreparable).toBe(false);
    expect(r.blockingReasons).toContain("escalation:cooldown-active");
  });

  it("escalation not-armed blocks prep", () => {
    const r = evaluateCandidatePipeline(
      { candidate: candidate(), quote: freshQuote, quoteFresh: true, plannedSpendSol: 0.005 },
      ctx("armed_canary", { escalationSession: { armed: false } }),
    );
    expect(r.canaryPreparable).toBe(false);
    expect(r.blockingReasons).toContain("escalation:not-armed");
  });

  it("a denylisted mint blocks prep", () => {
    const r = evaluateCandidatePipeline(
      { candidate: candidate(), quote: freshQuote, quoteFresh: true, plannedSpendSol: 0.005 },
      ctx("armed_canary", { denylist: [MINT] }),
    );
    expect(r.canaryPreparable).toBe(false);
    expect(r.strategy?.decision).toBe("ignore");
  });

  it("a planned spend over the canary ceiling blocks prep", () => {
    const r = evaluateCandidatePipeline(
      { candidate: candidate(), quote: freshQuote, quoteFresh: true, plannedSpendSol: 0.5 },
      ctx("armed_canary"),
    );
    expect(r.canaryPreparable).toBe(false);
    expect(r.blockingReasons).toContain("escalation:spend-over-canary-ceiling");
  });
});
