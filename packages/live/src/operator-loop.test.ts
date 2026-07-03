import { describe, expect, it } from "vitest";

import { buildEscalationPolicy } from "./escalation.js";
import { normalizeManualMint } from "./discovery.js";
import type { SniperCandidate, SniperCandidateRisk } from "./discovery.js";
import { buildOperatorConfig } from "./operator-config.js";
import type { LiveOperatorConfig, OperatorRunMode } from "./operator-config.js";
import { OperatorLoopError, runSupervisedOperatorLoop, validateOperatorRunReport } from "./operator-loop.js";
import type { OperatorLoopInput } from "./operator-loop.js";
import { buildLivePolicy } from "./policy.js";
import { loopModeCanTrade, SNIPER_LOOP_MODES } from "./sniper-loop.js";
import type { StrategyQuoteFacts } from "./strategy.js";

const AT = "2026-07-03T12:00:00.000Z";
const NOW_MS = Date.parse(AT);
const CLEAN_MINT = "So11111111111111111111111111111111111111112";
const REJECT_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WALLET = "CgGszXon2aemnsCYRSuguJqkFdSAwCPc31mFcHLDwbpV";

const cleanRisk: SniperCandidateRisk = { score: 5, decision: "ACCEPT", criticalFlagCount: 0, freezeAuthorityPresent: false, mintAuthorityPresent: false };
const rejectRisk: SniperCandidateRisk = { score: 100, decision: "REJECT", criticalFlagCount: 1, freezeAuthorityPresent: true, mintAuthorityPresent: false };
const freshQuote: StrategyQuoteFacts = { priceImpactPct: 0.5, ageMs: 1_000, slippageBps: 50, routeConfidence: 0.9, provider: "jupiter-lite-api" };

function candidate(mint: string, risk: SniperCandidateRisk | null): SniperCandidate {
  const base = normalizeManualMint({ mint }, { discoveredAt: AT });
  return { ...base, risk, liquidityUsd: 50_000, volumeUsd: 100_000, poolAgeSeconds: 600 };
}

function config(overrides: Partial<Parameters<typeof buildOperatorConfig>[0]> = {}): LiveOperatorConfig {
  return buildOperatorConfig({
    operatorLabel: "test-operator",
    rpcEndpointHttps: "https://api.mainnet-beta.solana.com",
    mode: "armed_canary",
    walletPublicKey: WALLET,
    ...overrides,
  });
}

function loopInput(overrides: Partial<OperatorLoopInput> = {}): OperatorLoopInput {
  return {
    config: config(),
    requestedMode: "armed_canary",
    candidates: [{ candidate: candidate(CLEAN_MINT, cleanRisk), quote: freshQuote, quoteFresh: true, plannedSpendSol: 0.005 }],
    policy: buildLivePolicy({ mode: "live_canary", liveEnabled: true, walletProvider: "phantom" }),
    escalationPolicy: buildEscalationPolicy(),
    escalationSession: { armed: true, lastCanaryAtMs: null },
    limits: { maxCandidates: null, maxRuntimeMs: null },
    sessionId: "s-1",
    startedAt: AT,
    nowMs: NOW_MS,
    ...overrides,
  };
}

describe("mode privilege — a run can only ever narrow", () => {
  it("refuses a requested mode above the config's mode", () => {
    expect(() => runSupervisedOperatorLoop(loopInput({ config: config({ mode: "paper_shadow" }) }))).toThrow(/exceeds the config/);
    expect(() => runSupervisedOperatorLoop(loopInput({ config: config({ mode: "observe_only" }), requestedMode: "paper_shadow" }))).toThrow(OperatorLoopError);
  });

  it("allows narrowing (armed config, observe run)", () => {
    const r = runSupervisedOperatorLoop(loopInput({ requestedMode: "observe_only" }));
    expect(r.effectiveMode).toBe("observe_only");
    expect(r.totals.canaryRecommended).toBe(0);
  });
});

describe("no mode trades — structural", () => {
  it("loopModeCanTrade stays false for every underlying loop mode", () => {
    for (const m of SNIPER_LOOP_MODES) expect(loopModeCanTrade(m)).toBe(false);
  });

  it("off processes nothing", () => {
    const r = runSupervisedOperatorLoop(loopInput({ requestedMode: "off" }));
    expect(r.totals.processed).toBe(0);
    expect(r.results).toHaveLength(0);
    expect(r.recommendation).toBeNull();
    expect(r.totals.canaryRecommended).toBe(0);
  });

  it("observe_only never recommends a canary even with a perfect green candidate", () => {
    const r = runSupervisedOperatorLoop(loopInput({ requestedMode: "observe_only" }));
    expect(r.totals.canaryRecommended).toBe(0);
    expect(r.recommendation).toBeNull();
    expect(r.results[0]!.action).not.toBe("prepare_canary_request");
  });

  it("paper_shadow never recommends a canary even with a perfect green candidate", () => {
    const r = runSupervisedOperatorLoop(loopInput({ requestedMode: "paper_shadow" }));
    expect(r.totals.canaryRecommended).toBe(0);
    expect(r.recommendation).toBeNull();
    expect(r.results[0]!.action).toBe("paper_shadow");
    expect(r.results[0]!.blockingReasons.join(",")).toMatch(/cannot-prepare-canary/);
  });

  it("every report pins loopNeverSends / backendNeverSends / backendCustodiesNoKeys", () => {
    for (const mode of ["off", "observe_only", "paper_shadow", "armed_canary"] as OperatorRunMode[]) {
      const r = runSupervisedOperatorLoop(loopInput({ requestedMode: mode }));
      expect(r.loopNeverSends).toBe(true);
      expect(r.backendNeverSends).toBe(true);
      expect(r.backendCustodiesNoKeys).toBe(true);
      expect(r.notProfitabilityClaim).toBe(true);
    }
  });
});

describe("armed_canary — recommends at most ONE, and only fully green", () => {
  it("a green candidate yields exactly one recommendation with Phantom handoff steps", () => {
    const r = runSupervisedOperatorLoop(loopInput());
    expect(r.totals.canaryRecommended).toBe(1);
    expect(r.recommendation).not.toBeNull();
    expect(r.recommendation!.mint).toBe(CLEAN_MINT);
    expect(r.recommendation!.nextSteps.join(" ")).toMatch(/Phantom/);
    expect(r.recommendation!.nextSteps.join(" ")).toMatch(/live:canary:prepare/);
    // The journal + alerts carry the Phantom-pending handoff.
    expect(r.sessionEvents.map((e) => e.kind)).toContain("canary_recommended");
    expect(r.sessionEvents.map((e) => e.kind)).toContain("phantom_approval_pending");
    expect(r.alerts.map((a) => a.kind)).toContain("canary_recommended");
    expect(r.alerts.map((a) => a.kind)).toContain("phantom_approval_pending");
  });

  it("TWO green candidates still yield only ONE recommendation (one-canary-per-run)", () => {
    const two = loopInput({
      candidates: [
        { candidate: candidate(CLEAN_MINT, cleanRisk), quote: freshQuote, quoteFresh: true, plannedSpendSol: 0.005 },
        { candidate: candidate("A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6", cleanRisk), quote: freshQuote, quoteFresh: true, plannedSpendSol: 0.005 },
      ],
    });
    const r = runSupervisedOperatorLoop(two);
    expect(r.totals.canaryRecommended).toBe(1);
    expect(r.totals.processed).toBe(2);
    const second = r.results[1]!;
    expect(second.action).not.toBe("prepare_canary_request");
  });

  it("a risk-rejected candidate is NEVER recommended, even armed with a fresh quote", () => {
    const r = runSupervisedOperatorLoop(loopInput({ candidates: [{ candidate: candidate(REJECT_MINT, rejectRisk), quote: freshQuote, quoteFresh: true, plannedSpendSol: 0.005 }] }));
    expect(r.totals.canaryRecommended).toBe(0);
    expect(r.alerts.map((a) => a.kind)).toContain("risk_rejected");
  });

  it("a stale or missing quote blocks the recommendation", () => {
    const stale = runSupervisedOperatorLoop(loopInput({ candidates: [{ candidate: candidate(CLEAN_MINT, cleanRisk), quote: freshQuote, quoteFresh: false, plannedSpendSol: 0.005 }] }));
    expect(stale.totals.canaryRecommended).toBe(0);
    const missing = runSupervisedOperatorLoop(loopInput({ candidates: [{ candidate: candidate(CLEAN_MINT, cleanRisk), quote: null, quoteFresh: null, plannedSpendSol: 0.005 }] }));
    expect(missing.totals.canaryRecommended).toBe(0);
  });

  it("not armed (no manual arm this invocation) blocks the recommendation", () => {
    const r = runSupervisedOperatorLoop(loopInput({ escalationSession: { armed: false, lastCanaryAtMs: null } }));
    expect(r.totals.canaryRecommended).toBe(0);
    expect(r.results[0]!.blockingReasons.join(",")).toMatch(/not-armed/);
  });
});

describe("kill switch / emergency stop block EVERYTHING", () => {
  for (const mode of ["observe_only", "paper_shadow", "armed_canary"] as OperatorRunMode[]) {
    it(`kill switch blocks ${mode} entirely (zero candidates processed)`, () => {
      const r = runSupervisedOperatorLoop(loopInput({ config: config({ killSwitchEngaged: true }), requestedMode: mode }));
      expect(r.totals.processed).toBe(0);
      expect(r.results).toHaveLength(0);
      expect(r.paused).toBe(true);
      expect(r.pauseReasons).toContain("kill-switch-engaged");
      expect(r.manualRearmRequiredToResume).toBe(true);
      expect(r.alerts.map((a) => a.kind)).toContain("kill_switch_engaged");
    });
  }

  it("emergency stop blocks everything too", () => {
    const r = runSupervisedOperatorLoop(loopInput({ config: config({ emergencyStopEngaged: true }) }));
    expect(r.totals.processed).toBe(0);
    expect(r.paused).toBe(true);
    expect(r.pauseReasons).toContain("emergency-stop-engaged");
    expect(r.alerts.map((a) => a.kind)).toContain("emergency_stop_engaged");
    expect(r.alerts.map((a) => a.kind)).toContain("session_paused");
  });
});

describe("pause / manual re-arm discipline", () => {
  it("a paused session (from the journal) cannot produce a recommendation and reports itself paused", () => {
    const r = runSupervisedOperatorLoop(loopInput({ escalationSession: { armed: false, paused: true, lastCanaryAtMs: null } }));
    expect(r.totals.canaryRecommended).toBe(0);
    expect(r.paused).toBe(true);
    expect(r.pauseReasons).toContain("pause-pending-manual-rearm");
    expect(r.manualRearmRequiredToResume).toBe(true);
    expect(r.results[0]!.blockingReasons.join(",")).toMatch(/escalation-paused/);
  });

  it("session caps + cooldown from the durable journal block further canaries", () => {
    const capped = runSupervisedOperatorLoop(loopInput({ escalationSession: { armed: true, canariesThisSession: 1, canariesToday: 1, lastCanaryAtMs: NOW_MS - 1000 } }));
    expect(capped.totals.canaryRecommended).toBe(0);
    expect(capped.results[0]!.blockingReasons.join(",")).toMatch(/session-canary-cap-reached/);
  });
});

describe("bounded run limits", () => {
  it("maxCandidates truncates the pass and reports the skipped tail honestly", () => {
    const many = Array.from({ length: 5 }, () => ({ candidate: candidate(CLEAN_MINT, cleanRisk), quote: freshQuote, quoteFresh: true as boolean | null, plannedSpendSol: 0.005 as number | null }));
    const r = runSupervisedOperatorLoop(loopInput({ candidates: many, limits: { maxCandidates: 2, maxRuntimeMs: null }, requestedMode: "observe_only" }));
    expect(r.totals.processed).toBe(2);
    expect(r.totals.skippedOverBudget).toBe(3);
  });

  it("maxRuntimeMs stops the pass when the injected clock exceeds the budget", () => {
    const many = Array.from({ length: 3 }, () => ({ candidate: candidate(CLEAN_MINT, cleanRisk), quote: freshQuote, quoteFresh: true as boolean | null, plannedSpendSol: 0.005 as number | null }));
    let calls = 0;
    const elapsed = (): number => {
      calls += 1;
      return calls > 1 ? 10_000 : 0; // first candidate fits; then the budget is blown
    };
    const r = runSupervisedOperatorLoop(loopInput({ candidates: many, limits: { maxCandidates: null, maxRuntimeMs: 5_000 }, elapsedMs: elapsed, requestedMode: "observe_only" }));
    expect(r.totals.processed).toBe(1);
    expect(r.totals.skippedOverBudget).toBe(2);
    expect(r.sessionEvents.map((e) => e.detail).join(" ")).toMatch(/runtime budget exhausted/);
  });
});

describe("validateOperatorRunReport — tally recomputation", () => {
  it("round-trips a real report", () => {
    const r = runSupervisedOperatorLoop(loopInput());
    expect(validateOperatorRunReport(JSON.parse(JSON.stringify(r))).totals.canaryRecommended).toBe(1);
  });

  it("refuses tampered tallies, double recommendations, and orphan recommendations", () => {
    const r = JSON.parse(JSON.stringify(runSupervisedOperatorLoop(loopInput()))) as Record<string, unknown> & { totals: Record<string, number> };
    expect(() => validateOperatorRunReport({ ...r, totals: { ...r.totals, canaryRecommended: 0 } })).toThrow(/re-derive/);
    expect(() => validateOperatorRunReport({ ...r, recommendation: null })).toThrow(/no recommendation block/);
    const observe = JSON.parse(JSON.stringify(runSupervisedOperatorLoop(loopInput({ requestedMode: "observe_only" })))) as Record<string, unknown>;
    expect(() => validateOperatorRunReport({ ...observe, recommendation: { mint: CLEAN_MINT, symbol: null, score: 1, nextSteps: [] }, totals: (observe.totals as Record<string, number>) })).toThrow(/no canary result backing/);
    expect(() => validateOperatorRunReport({ ...r, loopNeverSends: false })).toThrow(/literal true/);
    expect(() => validateOperatorRunReport({ ...r, sendResult: {} })).toThrow(/unknown field/);
  });
});
