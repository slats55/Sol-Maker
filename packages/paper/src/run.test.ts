import { describe, it, expect } from "vitest";
import { buildTokenRiskReport } from "@soulmaker/risk";
import type { TokenRiskInput } from "@soulmaker/risk";
import { runPaperSession } from "./run.js";
import type { PaperCandidate, PaperPricePoint, PaperRiskCaps } from "./types.js";

const A = "So11111111111111111111111111111111111111112";
const B = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const FIXED = "2026-06-05T12:00:00.000Z";
const at = () => FIXED;

const CAPS: PaperRiskCaps = {
  maxTradeSizeUsd: 1000,
  maxDailyLossUsd: 1000,
  maxOpenPositions: 10,
  killSwitch: false,
};

function risk(mint: string, overrides: Partial<TokenRiskInput> = {}) {
  return buildTokenRiskReport(
    {
      mint,
      decimals: 6,
      supplyRaw: "1000000",
      uiSupply: 1,
      mintAuthorityPresent: false,
      freezeAuthorityPresent: false,
      isInitialized: true,
      programLabel: "spl-token",
      ...overrides,
    },
    { now: at },
  );
}

function price(
  mint: string,
  priceUsd: number,
  observedAt = FIXED,
): PaperPricePoint {
  return { mint, priceUsd, observedAt, source: "injected-fixture" };
}

function buyCandidate(
  mint: string,
  proposedSizeUsd: number,
  overrides: Partial<TokenRiskInput> = {},
): PaperCandidate {
  return { mint, riskReport: risk(mint, overrides), proposedSizeUsd };
}

const types = (r: ReturnType<typeof runPaperSession>) => r.events.map((e) => e.type);

describe("runPaperSession — basic buy", () => {
  it("a PASS candidate produces a simulated buy and an open position", () => {
    const r = runPaperSession({
      caps: CAPS,
      candidates: [buyCandidate(A, 100)],
      prices: [price(A, 2)],
      now: at,
    });
    expect(types(r)).toContain("PAPER_BUY_FILLED");
    expect(r.summary.buyCount).toBe(1);
    expect(r.summary.openPositionCount).toBe(1);
    expect(r.state.positions[A]?.quantity).toBe(50);
  });

  it("computes unrealized PnL from the latest injected price", () => {
    const r = runPaperSession({
      caps: CAPS,
      candidates: [buyCandidate(A, 100)],
      prices: [price(A, 2), price(A, 3)], // entry 2, latest 3
      now: at,
    });
    expect(r.summary.unrealizedPnlUsd).toBe(50);
    expect(r.summary.totalPnlUsd).toBe(50);
  });
});

describe("runPaperSession — risk integration", () => {
  it("a REJECT candidate is blocked by risk (no buy)", () => {
    const r = runPaperSession({
      caps: CAPS,
      candidates: [buyCandidate(A, 100, { freezeAuthorityPresent: true })],
      prices: [price(A, 2)],
      now: at,
    });
    expect(r.summary.buyCount).toBe(0);
    expect(r.summary.rejectedByRisk).toBe(1);
    expect(types(r)).toContain("CANDIDATE_REJECTED_BY_RISK");
  });

  it("a CAUTION candidate is blocked by default", () => {
    const r = runPaperSession({
      caps: CAPS,
      candidates: [buyCandidate(A, 100, { mintAuthorityPresent: true })], // score 30 → CAUTION
      prices: [price(A, 2)],
      now: at,
    });
    expect(r.summary.rejectedByRisk).toBe(1);
    expect(r.summary.buyCount).toBe(0);
  });

  it("a CAUTION candidate is allowed only with allowCautionRiskReports", () => {
    const r = runPaperSession({
      caps: { ...CAPS, allowCautionRiskReports: true },
      candidates: [buyCandidate(A, 100, { mintAuthorityPresent: true })],
      prices: [price(A, 2)],
      now: at,
    });
    expect(r.summary.buyCount).toBe(1);
  });

  it("a missing/invalid risk report is treated as REJECT", () => {
    const r = runPaperSession({
      caps: CAPS,
      candidates: [{ mint: A, proposedSizeUsd: 100 }], // no riskReport
      prices: [price(A, 2)],
      now: at,
    });
    expect(r.summary.buyCount).toBe(0);
    expect(r.summary.rejectedByRisk).toBe(1);
  });
});

describe("runPaperSession — price gating", () => {
  it("rejects a candidate with no injected price", () => {
    const r = runPaperSession({
      caps: CAPS,
      candidates: [buyCandidate(A, 100)],
      prices: [],
      now: at,
    });
    expect(r.summary.rejectedByPrice).toBe(1);
    expect(r.summary.buyCount).toBe(0);
  });

  it("rejects a candidate with a zero/negative price", () => {
    for (const bad of [0, -1]) {
      const r = runPaperSession({
        caps: CAPS,
        candidates: [buyCandidate(A, 100)],
        prices: [price(A, bad)],
        now: at,
      });
      expect(r.summary.rejectedByPrice).toBe(1);
    }
  });
});

describe("runPaperSession — caps", () => {
  it("the kill switch blocks all simulated trading", () => {
    const r = runPaperSession({
      caps: { ...CAPS, killSwitch: true },
      candidates: [buyCandidate(A, 100)],
      prices: [price(A, 2)],
      now: at,
    });
    expect(types(r)).toContain("KILL_SWITCH_ACTIVE");
    expect(r.summary.buyCount).toBe(0);
  });

  it("maxTradeSizeUsd blocks an oversized candidate", () => {
    const r = runPaperSession({
      caps: { ...CAPS, maxTradeSizeUsd: 50 },
      candidates: [buyCandidate(A, 100)],
      prices: [price(A, 2)],
      now: at,
    });
    expect(r.summary.rejectedByCaps).toBe(1);
    expect(r.summary.buyCount).toBe(0);
  });

  it("maxOpenPositions blocks a second, new mint", () => {
    const r = runPaperSession({
      caps: { ...CAPS, maxOpenPositions: 1 },
      candidates: [buyCandidate(A, 100), buyCandidate(B, 100)],
      prices: [price(A, 2), price(B, 2)],
      now: at,
    });
    expect(r.summary.buyCount).toBe(1);
    expect(r.summary.rejectedByCaps).toBe(1);
  });

  it("maxDailyLossUsd blocks further buys after a realized loss", () => {
    const r = runPaperSession({
      caps: { ...CAPS, maxDailyLossUsd: 40 },
      candidates: [
        buyCandidate(A, 100),
        { mint: A, proposedSide: "SELL", proposedSizeUsd: 0 }, // full exit at a loss
        buyCandidate(B, 100),
      ],
      prices: [price(A, 2), price(A, 1), price(B, 2)], // A entry 2, latest 1 → -50
      now: at,
    });
    expect(r.state.realizedPnlUsd).toBe(-50);
    // The B buy must be blocked by the daily-loss cap.
    const bReject = r.events.find(
      (e) => e.type === "CANDIDATE_REJECTED_BY_CAPS" && e.mint === B,
    );
    expect(bReject && bReject.type === "CANDIDATE_REJECTED_BY_CAPS" && bReject.cap).toBe(
      "maxDailyLossUsd",
    );
  });
});

describe("runPaperSession — take-profit / stop-loss", () => {
  it("take-profit triggers a simulated sell, TRIGGER event before the fill", () => {
    const r = runPaperSession({
      caps: CAPS,
      candidates: [buyCandidate(A, 100)],
      prices: [price(A, 2), price(A, 2.5), price(A, 3)],
      takeProfitPct: 40,
      now: at,
    });
    const seq = types(r);
    const tpIdx = seq.indexOf("TAKE_PROFIT_TRIGGERED");
    const sellIdx = seq.indexOf("PAPER_SELL_FILLED");
    expect(tpIdx).toBeGreaterThanOrEqual(0);
    expect(sellIdx).toBeGreaterThan(tpIdx); // trigger before fill
    expect(r.summary.realizedPnlUsd).toBe(50); // (3 - 2) * 50
    expect(r.summary.openPositionCount).toBe(0);
  });

  it("stop-loss triggers a simulated sell", () => {
    const r = runPaperSession({
      caps: CAPS,
      candidates: [buyCandidate(A, 100)],
      prices: [price(A, 2), price(A, 1.5)],
      stopLossPct: 20,
      now: at,
    });
    const seq = types(r);
    expect(seq.indexOf("STOP_LOSS_TRIGGERED")).toBeGreaterThanOrEqual(0);
    expect(seq.indexOf("PAPER_SELL_FILLED")).toBeGreaterThan(
      seq.indexOf("STOP_LOSS_TRIGGERED"),
    );
    expect(r.summary.realizedPnlUsd).toBe(-25); // (1.5 - 2) * 50
  });

  it("a 0% (or negative) TP/SL is treated as disabled — no exit on the entry tick", () => {
    const r = runPaperSession({
      caps: CAPS,
      candidates: [buyCandidate(A, 100)],
      prices: [price(A, 2)],
      takeProfitPct: 0,
      stopLossPct: 0,
      now: at,
    });
    expect(types(r)).not.toContain("TAKE_PROFIT_TRIGGERED");
    expect(types(r)).not.toContain("STOP_LOSS_TRIGGERED");
    expect(r.summary.openPositionCount).toBe(1); // position stays open
  });
});

describe("runPaperSession — determinism", () => {
  it("produces byte-identical events + summary for identical input", () => {
    const input = {
      caps: CAPS,
      candidates: [buyCandidate(A, 100), buyCandidate(B, 60)],
      prices: [price(A, 2), price(B, 3)],
      takeProfitPct: 100,
      now: at,
    };
    const a = runPaperSession(input);
    const b = runPaperSession(input);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(JSON.stringify(a.summary)).toBe(JSON.stringify(b.summary));
    // Deterministic ids from a seeded counter.
    expect(a.events.some((e) => e.type === "PAPER_BUY_FILLED" && e.fill.id === "fill-1")).toBe(
      true,
    );
  });

  it("always opens with RUN_STARTED and ends with RUN_COMPLETED", () => {
    const r = runPaperSession({ caps: CAPS, candidates: [], prices: [], now: at });
    expect(r.events[0]?.type).toBe("RUN_STARTED");
    expect(r.events[r.events.length - 1]?.type).toBe("RUN_COMPLETED");
  });
});
