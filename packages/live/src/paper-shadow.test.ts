import { describe, expect, it } from "vitest";

import { normalizeManualMint } from "./discovery.js";
import { buildPaperShadowSession, shadowDecide } from "./paper-shadow.js";
import { scoreStrategyV2 } from "./strategy.js";
import type { StrategyQuoteFacts } from "./strategy.js";

const MINT = "So11111111111111111111111111111111111111112";
const AT = "2026-06-18T00:00:00.000Z";
const freshQuote: StrategyQuoteFacts = { priceImpactPct: 0.5, ageMs: 1_000, slippageBps: 50, routeConfidence: 0.9, provider: "jupiter" };

function candidate(risk: unknown) {
  const base = normalizeManualMint({ mint: MINT, symbol: "WSOL" }, { discoveredAt: AT });
  return { ...base, risk: risk as never, liquidityUsd: 50_000, volumeUsd: 100_000, poolAgeSeconds: 600 };
}

describe("paper shadow — decisions are simulations, never trades", () => {
  it("a clean live candidate is would_enter and records the quote at decision time", () => {
    const c = candidate({ score: 5, decision: "ACCEPT", criticalFlagCount: 0, freezeAuthorityPresent: false, mintAuthorityPresent: false });
    const strategy = scoreStrategyV2({ candidate: c, quote: freshQuote, timestamp: AT });
    const d = shadowDecide({ candidate: c, strategy, quote: freshQuote, decidedAt: AT }, { outAmountRaw: "123456" });
    expect(d.decision).toBe("would_enter");
    expect(d.quoteAtDecision?.outAmountRaw).toBe("123456");
    expect(d.outcomeKnown).toBe(false);
    expect(d.notProfitabilityClaim).toBe(true);
  });

  it("a risk-rejected candidate is would_skip and records why", () => {
    const c = candidate({ score: 90, decision: "REJECT", criticalFlagCount: 1, freezeAuthorityPresent: false, mintAuthorityPresent: false });
    const strategy = scoreStrategyV2({ candidate: c, quote: freshQuote, timestamp: AT });
    const d = shadowDecide({ candidate: c, strategy, quote: freshQuote, decidedAt: AT });
    expect(d.decision).toBe("would_skip");
    expect(d.blockingReasons.length).toBeGreaterThan(0);
  });

  it("outcomeKnown only when a comparison quote was supplied (never invents a PnL)", () => {
    const c = candidate({ score: 5, decision: "ACCEPT", criticalFlagCount: 0, freezeAuthorityPresent: false, mintAuthorityPresent: false });
    const strategy = scoreStrategyV2({ candidate: c, quote: freshQuote, timestamp: AT });
    const d = shadowDecide({ candidate: c, strategy, quote: freshQuote, decidedAt: AT, comparisonOutAmountRaw: "200000" });
    expect(d.outcomeKnown).toBe(true);
    expect(d.comparisonOutAmountRaw).toBe("200000");
  });
});

describe("paper shadow — session report", () => {
  it("aggregates would-enter / would-skip and carries the honesty caveats", () => {
    const enter = candidate({ score: 5, decision: "ACCEPT", criticalFlagCount: 0, freezeAuthorityPresent: false, mintAuthorityPresent: false });
    const skip = candidate({ score: 5, decision: "REJECT", criticalFlagCount: 0, freezeAuthorityPresent: false, mintAuthorityPresent: false });
    const dEnter = shadowDecide({ candidate: enter, strategy: scoreStrategyV2({ candidate: enter, quote: freshQuote, timestamp: AT }), quote: freshQuote, decidedAt: AT });
    const dSkip = shadowDecide({ candidate: skip, strategy: scoreStrategyV2({ candidate: skip, quote: freshQuote, timestamp: AT }), quote: freshQuote, decidedAt: AT });
    const report = buildPaperShadowSession([dEnter, dSkip], { sessionId: "s1", startedAt: AT, endedAt: AT });
    expect(report.totals.decisions).toBe(2);
    expect(report.totals.wouldEnter).toBe(1);
    expect(report.totals.wouldSkip).toBe(1);
    expect(report.caveats.length).toBeGreaterThan(0);
    expect(report.notProfitabilityClaim).toBe(true);
  });
});
