import { describe, expect, it } from "vitest";

import { normalizeManualMint } from "./discovery.js";
import type { SniperCandidate, SniperCandidateRisk } from "./discovery.js";
import { scoreStrategyV2 } from "./strategy.js";
import type { StrategyQuoteFacts } from "./strategy.js";

const MINT = "So11111111111111111111111111111111111111112";
const AT = "2026-06-18T00:00:00.000Z";

function candidate(over: Partial<SniperCandidate> = {}): SniperCandidate {
  const base = normalizeManualMint({ mint: MINT, symbol: "WSOL" }, { discoveredAt: AT });
  return { ...base, liquidityUsd: 50_000, volumeUsd: 100_000, poolAgeSeconds: 600, ...over };
}

const cleanRisk: SniperCandidateRisk = { score: 5, decision: "ACCEPT", criticalFlagCount: 0, freezeAuthorityPresent: false, mintAuthorityPresent: false };
const freshQuote: StrategyQuoteFacts = { priceImpactPct: 0.5, ageMs: 1_000, slippageBps: 50, routeConfidence: 0.9, provider: "jupiter" };

describe("strategy v2 — happy path", () => {
  it("a clean, liquid, fresh candidate can reach live_canary_candidate", () => {
    const r = scoreStrategyV2({ candidate: candidate({ risk: cleanRisk }), quote: freshQuote, riskAppetite: "aggressive", timestamp: AT });
    expect(r.decision).toBe("live_canary_candidate");
    expect(r.hardBlocks).toHaveLength(0);
    expect(r.score).toBeGreaterThanOrEqual(60);
    expect(r.liveCandidateStillRequiresPhantom).toBe(true);
  });

  it("score output is deterministic for identical input", () => {
    const input = { candidate: candidate({ risk: cleanRisk }), quote: freshQuote, timestamp: AT } as const;
    expect(scoreStrategyV2(input)).toEqual(scoreStrategyV2(input));
  });
});

describe("strategy v2 — risk block overrides score", () => {
  it("a REJECT decision forces away from live regardless of an otherwise high score", () => {
    const r = scoreStrategyV2({ candidate: candidate({ risk: { ...cleanRisk, decision: "REJECT" } }), quote: freshQuote, riskAppetite: "aggressive", timestamp: AT });
    expect(r.decision).not.toBe("live_canary_candidate");
    expect(r.hardBlocks).toContain("risk-rejected");
  });

  it("a critical risk flag is a hard block", () => {
    const r = scoreStrategyV2({ candidate: candidate({ risk: { ...cleanRisk, criticalFlagCount: 1 } }), quote: freshQuote, timestamp: AT });
    expect(r.decision).not.toBe("live_canary_candidate");
    expect(r.hardBlocks).toContain("risk-critical-flag");
  });

  it("a present freeze authority is a hard block even with a clean decision", () => {
    const r = scoreStrategyV2({ candidate: candidate({ risk: { ...cleanRisk, freezeAuthorityPresent: true } }), quote: freshQuote, timestamp: AT });
    expect(r.hardBlocks).toContain("freeze-authority-present");
    expect(r.decision).not.toBe("live_canary_candidate");
  });

  it("a denylisted mint is a hard block → ignore", () => {
    const r = scoreStrategyV2({ candidate: candidate({ risk: cleanRisk }), quote: freshQuote, denylisted: true, timestamp: AT });
    expect(r.decision).toBe("ignore");
    expect(r.hardBlocks).toContain("operator-denylisted");
  });
});

describe("strategy v2 — missing data + freshness lower confidence / block live", () => {
  it("missing risk blocks live and caps confidence low", () => {
    const r = scoreStrategyV2({ candidate: candidate({ risk: null }), quote: freshQuote, timestamp: AT });
    expect(r.decision).not.toBe("live_canary_candidate");
    expect(r.hardBlocks).toContain("risk-missing");
    expect(r.confidence).toBeLessThanOrEqual(0.3);
  });

  it("a stale quote blocks the live decision", () => {
    const stale: StrategyQuoteFacts = { ...freshQuote, ageMs: 999_999 };
    const r = scoreStrategyV2({ candidate: candidate({ risk: cleanRisk }), quote: stale, timestamp: AT });
    expect(r.decision).not.toBe("live_canary_candidate");
    expect([...r.hardBlocks, ...r.softWarnings]).toContain("quote-stale");
  });

  it("a missing quote blocks the live decision and caps confidence", () => {
    const r = scoreStrategyV2({ candidate: candidate({ risk: cleanRisk }), quote: null, timestamp: AT });
    expect(r.decision).not.toBe("live_canary_candidate");
    expect(r.confidence).toBeLessThanOrEqual(0.5);
  });

  it("a high price impact blocks the live decision", () => {
    const r = scoreStrategyV2({ candidate: candidate({ risk: cleanRisk }), quote: { ...freshQuote, priceImpactPct: 9 }, timestamp: AT });
    expect(r.decision).not.toBe("live_canary_candidate");
    expect([...r.hardBlocks, ...r.softWarnings]).toContain("price-impact-over-cap");
  });

  it("low liquidity keeps it below the live floor", () => {
    const r = scoreStrategyV2({ candidate: candidate({ risk: cleanRisk, liquidityUsd: 100 }), quote: freshQuote, timestamp: AT });
    expect(r.decision).not.toBe("live_canary_candidate");
    expect([...r.hardBlocks, ...r.softWarnings]).toContain("liquidity-below-live-floor");
  });
});

describe("strategy v2 — risk appetite tunes the bar but never the safety blocks", () => {
  it("conservative needs a higher score than aggressive for the same candidate", () => {
    const c = candidate({ risk: { ...cleanRisk, score: 20 }, liquidityUsd: 6_000, volumeUsd: 1_000 });
    const conservative = scoreStrategyV2({ candidate: c, quote: freshQuote, riskAppetite: "conservative", timestamp: AT });
    const aggressive = scoreStrategyV2({ candidate: c, quote: freshQuote, riskAppetite: "aggressive", timestamp: AT });
    // Same score, different thresholds: aggressive may pass where conservative does not.
    expect(conservative.score).toBe(aggressive.score);
    if (conservative.decision === "live_canary_candidate") {
      expect(aggressive.decision).toBe("live_canary_candidate");
    }
  });

  it("aggressive appetite still cannot override a hard risk block", () => {
    const r = scoreStrategyV2({ candidate: candidate({ risk: { ...cleanRisk, decision: "REJECT" } }), quote: freshQuote, riskAppetite: "aggressive", timestamp: AT });
    expect(r.decision).not.toBe("live_canary_candidate");
  });
});
