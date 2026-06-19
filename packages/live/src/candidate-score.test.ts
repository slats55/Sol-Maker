import { describe, expect, it } from "vitest";

import { scoreLiveCandidate, type LiveCandidateSignals } from "./candidate-score.js";

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function signals(overrides: Partial<LiveCandidateSignals> = {}): LiveCandidateSignals {
  return {
    mint: MINT,
    risk: { score: 8, decision: "PASS_FOR_PAPER_EVALUATION", criticalFlagCount: 0, freezeAuthorityPresent: false, mintAuthorityPresent: false },
    liquidityUsd: 50_000,
    volumeUsd: 25_000,
    poolAgeSeconds: 3600,
    priceImpactPct: 0.4,
    quoteAgeMs: 1500,
    holderTop1Pct: 12,
    routeConfidence: 0.9,
    denylisted: false,
    allowlisted: false,
    ...overrides,
  };
}

describe("scoreLiveCandidate — decisions", () => {
  it("a strong, clean candidate is a live_canary_candidate", () => {
    const r = scoreLiveCandidate({ signals: signals(), timestamp: "2026-06-18T00:00:00Z", providers: ["jupiter-lite-api"] });
    expect(r.decision).toBe("live_canary_candidate");
    expect(r.blockingReasons).toEqual([]);
    expect(r.score).toBeGreaterThanOrEqual(70);
    // Even a live candidate still requires the full Phantom path downstream.
    expect(r.liveCandidateStillRequiresPhantom).toBe(true);
    expect(r.notProfitabilityClaim).toBe(true);
  });

  it("a REJECT risk decision is ignored", () => {
    const r = scoreLiveCandidate({
      signals: signals({ risk: { score: 85, decision: "REJECT", criticalFlagCount: 1, freezeAuthorityPresent: true, mintAuthorityPresent: false } }),
      timestamp: "2026-06-18T00:00:00Z",
    });
    expect(r.decision).toBe("ignore");
    expect(r.blockingReasons).toContain("risk-rejected");
  });

  it("a denylisted mint is ignored", () => {
    const r = scoreLiveCandidate({ signals: signals({ denylisted: true }), timestamp: "2026-06-18T00:00:00Z" });
    expect(r.decision).toBe("ignore");
    expect(r.blockingReasons).toContain("operator-denylisted");
  });

  it("a freeze authority blocks a live candidate (drops to paper/watch)", () => {
    const r = scoreLiveCandidate({
      signals: signals({ risk: { score: 8, decision: "PASS_FOR_PAPER_EVALUATION", criticalFlagCount: 0, freezeAuthorityPresent: true, mintAuthorityPresent: false } }),
      timestamp: "2026-06-18T00:00:00Z",
    });
    expect(r.decision).not.toBe("live_canary_candidate");
    expect(r.blockingReasons).toContain("freeze-authority-present");
  });

  it("thin liquidity below the live floor blocks a live candidate", () => {
    const r = scoreLiveCandidate({ signals: signals({ liquidityUsd: 2_000 }), timestamp: "2026-06-18T00:00:00Z" });
    expect(r.decision).not.toBe("live_canary_candidate");
    expect(r.blockingReasons).toContain("liquidity-below-live-floor");
  });

  it("a stale quote blocks a live candidate", () => {
    const r = scoreLiveCandidate({ signals: signals({ quoteAgeMs: 60_000 }), timestamp: "2026-06-18T00:00:00Z" });
    expect(r.blockingReasons).toContain("quote-stale");
    expect(r.decision).not.toBe("live_canary_candidate");
  });

  it("missing risk data is surfaced and never a live candidate", () => {
    const r = scoreLiveCandidate({ signals: signals({ risk: null }), timestamp: "2026-06-18T00:00:00Z" });
    expect(r.missingData).toContain("risk");
    expect(r.blockingReasons).toContain("risk-missing");
    expect(r.decision).not.toBe("live_canary_candidate");
  });

  it("is deterministic for identical input", () => {
    const a = scoreLiveCandidate({ signals: signals(), timestamp: "2026-06-18T00:00:00Z" });
    const b = scoreLiveCandidate({ signals: signals(), timestamp: "2026-06-18T00:00:00Z" });
    expect(a).toEqual(b);
  });
});
