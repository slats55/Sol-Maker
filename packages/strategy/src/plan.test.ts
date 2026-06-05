import { describe, it, expect } from "vitest";
import {
  planStrategyBatch,
  buildPaperCandidateBatch,
  strategyReportToPaperCandidate,
  formatStrategyPlanReport,
  buildStrategyPlanEnvelope,
  DEFAULT_PAPER_SIZE_USD,
} from "./plan.js";
import { evaluateStrategy } from "./evaluate.js";
import { REASON_IDS } from "./reasons.js";
import type { RiskDecision, TokenRiskReport } from "@soulmaker/risk";
import type { StrategyCandidate, StrategyConfig } from "./types.js";

const NOW = "2026-06-05T12:00:00.000Z";
const at = () => NOW;

/** A controllable advisory risk report literal (decision + score independent). */
function risk(decision: RiskDecision, score: number): TokenRiskReport {
  return {
    mint: "RiskReportMint",
    score,
    decision,
    flags: [],
    summary: ["advisory only"],
    generatedAt: NOW,
    disclaimer: "advisory only",
  };
}

/** Base config: a clean PASS with risk score 0 and no metrics scores 60 ⇒ buy. */
const baseConfig: StrategyConfig = {
  minScoreForPaperBuy: 55,
  minScoreForWatch: 30,
  maxRiskScore: 60,
};

// Decision recipes (verified against score.ts: score = 60 - riskScore*0.6).
const buyCandidate = (mint: string, extra: Partial<StrategyCandidate> = {}): StrategyCandidate => ({
  mint,
  riskReport: risk("PASS_FOR_PAPER_EVALUATION", 0), // score 60 ⇒ PAPER_BUY_CANDIDATE
  ...extra,
});
const watchCandidate = (mint: string): StrategyCandidate => ({
  mint,
  riskReport: risk("PASS_FOR_PAPER_EVALUATION", 40), // score 36 ⇒ WATCH
});
const softSkipCandidate = (mint: string): StrategyCandidate => ({
  mint,
  riskReport: risk("PASS_FOR_PAPER_EVALUATION", 55), // score 27 ⇒ SKIP (no disqualifier)
});
const rejectCandidate = (mint: string): StrategyCandidate => ({
  mint,
  riskReport: risk("REJECT", 90), // disqualifier ⇒ SKIP
});
const sellCandidate = (mint: string, extra: Partial<StrategyCandidate> = {}): StrategyCandidate => ({
  mint,
  riskReport: risk("PASS_FOR_PAPER_EVALUATION", 0),
  previousPaperTrade: { holdingPosition: true },
  metrics: { priceChangePct: 60 },
  ...extra,
});
const sellConfig: StrategyConfig = { ...baseConfig, takeProfitPct: 50 };

describe("planStrategyBatch — basic shape & counts", () => {
  it("an empty candidate array produces an empty, well-formed result", () => {
    const result = planStrategyBatch({ candidates: [], config: baseConfig, now: at });
    expect(result.totalCandidates).toBe(0);
    expect(result.items).toEqual([]);
    expect(result.paperCandidates).toEqual([]);
    expect(result.paperBuyCandidateCount).toBe(0);
    expect(result.paperSellCandidateCount).toBe(0);
    expect(result.watchCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    expect(result.rejectedCount).toBe(0);
    expect(result.paperOnly).toBe(true);
    expect(result.createdAt).toBe(NOW);
  });

  it("counts every decision class over ALL candidates", () => {
    const result = planStrategyBatch({
      candidates: [
        buyCandidate("BuyMint"),
        watchCandidate("WatchMint"),
        softSkipCandidate("SkipMint"),
        rejectCandidate("RejectMint"),
        sellCandidate("SellMint"),
      ],
      config: sellConfig,
      now: at,
    });
    expect(result.totalCandidates).toBe(5);
    expect(result.paperBuyCandidateCount).toBe(1);
    expect(result.paperSellCandidateCount).toBe(1);
    expect(result.watchCount).toBe(1);
    expect(result.skippedCount).toBe(1); // soft skip (no disqualifier)
    expect(result.rejectedCount).toBe(1); // REJECT (disqualifier)
    // Only buy + sell reach paperCandidates.
    expect(result.paperCandidates.map((c) => c.mint)).toEqual(["BuyMint", "SellMint"]);
  });
});

describe("planStrategyBatch — omission rules", () => {
  it("SKIP candidates are omitted from paperCandidates (and items by default)", () => {
    const result = planStrategyBatch({
      candidates: [rejectCandidate("RejectMint"), softSkipCandidate("SkipMint")],
      config: baseConfig,
      now: at,
    });
    expect(result.paperCandidates).toEqual([]);
    expect(result.items).toEqual([]); // omitted by default
  });

  it("WATCH candidates are omitted from paperCandidates and items by default", () => {
    const result = planStrategyBatch({
      candidates: [watchCandidate("WatchMint")],
      config: baseConfig,
      now: at,
    });
    expect(result.watchCount).toBe(1);
    expect(result.paperCandidates).toEqual([]);
    expect(result.items).toEqual([]);
  });

  it("includeWatch keeps WATCH in items but NOT in paperCandidates", () => {
    const result = planStrategyBatch({
      candidates: [watchCandidate("WatchMint")],
      config: baseConfig,
      includeWatch: true,
      now: at,
    });
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item?.decision).toBe("WATCH");
    expect(item?.includedInPaperCandidates).toBe(false);
    expect(item?.omissionReason).toMatch(/WATCH/);
    expect(item?.paperCandidate).toBeUndefined();
    expect(result.paperCandidates).toEqual([]);
  });

  it("includeSkipped keeps SKIP in items but NOT in paperCandidates", () => {
    const result = planStrategyBatch({
      candidates: [softSkipCandidate("SkipMint"), rejectCandidate("RejectMint")],
      config: baseConfig,
      includeSkipped: true,
      now: at,
    });
    expect(result.items).toHaveLength(2);
    expect(result.items.every((i) => i.includedInPaperCandidates === false)).toBe(true);
    expect(result.paperCandidates).toEqual([]);
    // The hard reject's omission reason names its disqualifier.
    const reject = result.items.find((i) => i.mint === "RejectMint");
    expect(reject?.omissionReason).toContain(REASON_IDS.RISK_DECISION_REJECT);
  });
});

describe("planStrategyBatch — conversion to PaperCandidate", () => {
  it("PAPER_BUY_CANDIDATE converts to a BUY PaperCandidate carrying risk + provenance", () => {
    const candidate = buyCandidate("BuyMint", { symbol: "WIF", source: "snipe-list" });
    const result = planStrategyBatch({
      candidates: [candidate],
      config: baseConfig,
      defaultPaperSizeUsd: 50,
      now: at,
    });
    expect(result.paperCandidates).toHaveLength(1);
    const pc = result.paperCandidates[0];
    expect(pc?.mint).toBe("BuyMint");
    expect(pc?.symbol).toBe("WIF");
    expect(pc?.proposedSide).toBe("BUY");
    expect(pc?.proposedSizeUsd).toBe(50);
    expect(pc?.riskReport).toBe(candidate.riskReport); // advisory risk carried through
    expect(pc?.source).toBe("strategy-plan:snipe-list");
    expect(pc?.reason).toMatch(/PAPER ONLY/);
    expect(pc?.reason).toMatch(/no transaction was built, signed, simulated, or sent/i);
    // The item mirrors the conversion.
    expect(result.items[0]?.includedInPaperCandidates).toBe(true);
    expect(result.items[0]?.paperCandidate).toBe(pc);
  });

  it("PAPER_SELL_CANDIDATE converts to a SELL PaperCandidate (size 0 ⇒ exit-all default)", () => {
    const result = planStrategyBatch({
      candidates: [sellCandidate("SellMint", { symbol: "BONK" })],
      config: sellConfig,
      now: at,
    });
    expect(result.paperSellCandidateCount).toBe(1);
    const pc = result.paperCandidates[0];
    expect(pc?.proposedSide).toBe("SELL");
    expect(pc?.proposedSizeUsd).toBe(DEFAULT_PAPER_SIZE_USD); // 0 ⇒ paper:run exits whole position
    expect(pc?.symbol).toBe("BONK");
  });

  it("a per-candidate proposedSizeUsd overrides the configured default", () => {
    const result = planStrategyBatch({
      candidates: [buyCandidate("BuyMint", { proposedSizeUsd: 10 })],
      config: baseConfig,
      defaultPaperSizeUsd: 50,
      now: at,
    });
    expect(result.paperCandidates[0]?.proposedSizeUsd).toBe(10);
  });

  it("with no size provided or configured, a converted buy defaults to 0 (fail-safe)", () => {
    const result = planStrategyBatch({
      candidates: [buyCandidate("BuyMint")],
      config: baseConfig,
      now: at,
    });
    // 0 is rejected by paper:run buy caps, so a sizeless plan cannot open a position.
    expect(result.paperCandidates[0]?.proposedSizeUsd).toBe(0);
  });

  it("strategyReportToPaperCandidate returns undefined for non-eligible decisions", () => {
    const watchReport = evaluateStrategy({
      candidate: watchCandidate("WatchMint"),
      config: baseConfig,
      now: at,
    });
    expect(strategyReportToPaperCandidate(watchReport, watchCandidate("WatchMint"))).toBeUndefined();

    const buyReport = evaluateStrategy({
      candidate: buyCandidate("BuyMint"),
      config: baseConfig,
      now: at,
    });
    expect(strategyReportToPaperCandidate(buyReport, buyCandidate("BuyMint"))).toBeDefined();
  });
});

describe("planStrategyBatch — risk & disqualifier gating", () => {
  it("a risk REJECT candidate is omitted (counted as rejected)", () => {
    const result = planStrategyBatch({
      candidates: [rejectCandidate("RejectMint")],
      config: baseConfig,
      now: at,
    });
    expect(result.rejectedCount).toBe(1);
    expect(result.paperCandidates).toEqual([]);
  });

  it("a risk CAUTION candidate is omitted UNLESS the config allows caution", () => {
    const caution = (mint: string): StrategyCandidate => ({
      mint,
      riskReport: risk("CAUTION", 0),
    });

    const blocked = planStrategyBatch({
      candidates: [caution("CautionMint")],
      config: baseConfig,
      now: at,
    });
    expect(blocked.paperCandidates).toEqual([]);
    expect(blocked.rejectedCount).toBe(1);

    const allowed = planStrategyBatch({
      candidates: [caution("CautionMint")],
      config: { ...baseConfig, allowCaution: true },
      defaultPaperSizeUsd: 25,
      now: at,
    });
    expect(allowed.paperBuyCandidateCount).toBe(1);
    expect(allowed.paperCandidates[0]?.proposedSide).toBe("BUY");
  });

  it("a disqualifier overrides a high score and prevents conversion", () => {
    // Risk score 0 alone would score 60 ⇒ buy, but a configured-but-missing
    // liquidity metric is a hard disqualifier ⇒ SKIP, never converted.
    const result = planStrategyBatch({
      candidates: [buyCandidate("BuyMint")],
      config: { ...baseConfig, minLiquidityUsd: 1000 },
      includeSkipped: true,
      now: at,
    });
    const item = result.items[0];
    expect(item?.decision).toBe("SKIP");
    expect(item?.score).toBe(60); // the score is still high…
    expect(item?.includedInPaperCandidates).toBe(false); // …but it is not converted
    expect(item?.omissionReason).toContain(REASON_IDS.LIQUIDITY_METRIC_MISSING);
    expect(result.paperCandidates).toEqual([]);
  });

  it("a candidate with no risk report fails safe to SKIP (not converted)", () => {
    // The pure pipeline trusts typed input; an incomplete candidate (no advisory
    // risk report) is treated as REJECT ⇒ SKIP, never silently converted.
    const result = planStrategyBatch({
      candidates: [{ mint: "NoRiskMint" }],
      config: baseConfig,
      now: at,
    });
    expect(result.rejectedCount).toBe(1);
    expect(result.paperCandidates).toEqual([]);
  });
});

describe("planStrategyBatch — ordering, duplicates, determinism, purity", () => {
  it("preserves candidate order in items and paperCandidates", () => {
    const result = planStrategyBatch({
      candidates: [buyCandidate("MintA"), buyCandidate("MintB"), buyCandidate("MintC")],
      config: baseConfig,
      defaultPaperSizeUsd: 10,
      now: at,
    });
    expect(result.paperCandidates.map((c) => c.mint)).toEqual(["MintA", "MintB", "MintC"]);
    expect(result.items.map((i) => i.mint)).toEqual(["MintA", "MintB", "MintC"]);
  });

  it("PRESERVES duplicate mints, each with a stable, distinct item id", () => {
    const result = planStrategyBatch({
      candidates: [buyCandidate("DupMint"), buyCandidate("DupMint")],
      config: baseConfig,
      defaultPaperSizeUsd: 10,
      now: at,
    });
    expect(result.paperCandidates.map((c) => c.mint)).toEqual(["DupMint", "DupMint"]);
    const ids = result.items.map((i) => i.id);
    expect(ids).toEqual(["strategy-plan-1", "strategy-plan-2"]);
    expect(new Set(ids).size).toBe(2);
  });

  it("an injected clock makes the result fully deterministic", () => {
    const make = () =>
      planStrategyBatch({
        candidates: [buyCandidate("MintA"), watchCandidate("MintB")],
        config: baseConfig,
        includeWatch: true,
        defaultPaperSizeUsd: 10,
        now: at,
      });
    expect(make().createdAt).toBe(NOW);
    expect(make().items[0]?.report.createdAt).toBe(NOW);
    expect(JSON.stringify(make())).toBe(JSON.stringify(make()));
  });

  it("does not mutate the input candidates or config", () => {
    const candidates = [buyCandidate("MintA"), sellCandidate("MintB")];
    const config: StrategyConfig = { ...sellConfig };
    const candidatesSnapshot = JSON.stringify(candidates);
    const configSnapshot = JSON.stringify(config);
    planStrategyBatch({ candidates, config, defaultPaperSizeUsd: 10, now: at });
    expect(JSON.stringify(candidates)).toBe(candidatesSnapshot);
    expect(JSON.stringify(config)).toBe(configSnapshot);
  });

  it("buildPaperCandidateBatch returns just the paper candidate array", () => {
    const input = {
      candidates: [buyCandidate("MintA"), watchCandidate("MintB"), rejectCandidate("MintC")],
      config: baseConfig,
      defaultPaperSizeUsd: 10,
      now: at,
    };
    const batch = buildPaperCandidateBatch(input);
    expect(batch.map((c) => c.mint)).toEqual(["MintA"]);
  });
});

describe("planStrategyBatch — Sprint 7 simulated exits", () => {
  const partialConfig: StrategyConfig = { ...baseConfig, takeProfitPartialPct: 25 };

  it("a PARTIAL simulated exit produces a SELL PaperCandidate with a positive sized notional", () => {
    const candidate = sellCandidate("PartialMint", {
      metrics: { priceChangePct: 30, positionSizeUsd: 200 },
    });
    const result = planStrategyBatch({
      candidates: [candidate],
      config: partialConfig,
      now: at,
    });
    expect(result.paperSellCandidateCount).toBe(1);
    const pc = result.paperCandidates[0];
    expect(pc?.proposedSide).toBe("SELL");
    expect(pc?.proposedSizeUsd).toBe(100); // 0.5 * 200 ⇒ a real partial, not 0 (exit-all)
    expect(pc?.reason).toMatch(/simulated partial exit/i);
    // The item mirrors the structured exit plan.
    expect(result.items[0]?.report.exit?.action).toBe("PARTIAL_EXIT");
    expect(result.items[0]?.report.exit?.trigger).toBe("PARTIAL_TAKE_PROFIT");
  });

  it("derives the partial size per-mint from an injected paper state", () => {
    const candidate: StrategyCandidate = {
      mint: "HeldMint",
      riskReport: risk("PASS_FOR_PAPER_EVALUATION", 0),
      metrics: { priceChangePct: 30 }, // size comes from the paper state, not the candidate
    };
    const paperState = {
      positions: {
        HeldMint: {
          mint: "HeldMint",
          quantity: 4,
          averageEntryPriceUsd: 100,
          costBasisUsd: 400,
          realizedPnlUsd: 0,
          unrealizedPnlUsd: 0,
          openedAt: NOW,
          updatedAt: NOW,
        },
      },
      realizedPnlUsd: 0,
      unrealizedPnlUsd: 0,
      fills: [],
      closedTradeCount: 0,
      simulatedNotionalUsd: 0,
    };
    const result = planStrategyBatch({
      candidates: [candidate],
      config: partialConfig,
      paperState,
      now: at,
    });
    expect(result.paperCandidates[0]?.proposedSizeUsd).toBe(200); // 0.5 * 400 cost basis
  });

  it("a FULL simulated exit still defaults to size 0 (exit-all) — backward compatible", () => {
    const result = planStrategyBatch({
      candidates: [sellCandidate("SellMint")], // priceChangePct 60 ≥ takeProfit 50
      config: sellConfig,
      now: at,
    });
    expect(result.paperCandidates[0]?.proposedSizeUsd).toBe(DEFAULT_PAPER_SIZE_USD);
    expect(result.items[0]?.report.exit?.action).toBe("FULL_EXIT");
  });

  it("stays deterministic and does not mutate inputs with exit metrics present", () => {
    const candidates = [
      sellCandidate("PartialMint", { metrics: { priceChangePct: 30, positionSizeUsd: 200 } }),
    ];
    const config: StrategyConfig = { ...partialConfig };
    const candidatesSnapshot = JSON.stringify(candidates);
    const run = () => planStrategyBatch({ candidates, config, now: at });
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
    expect(JSON.stringify(candidates)).toBe(candidatesSnapshot);
  });
});

describe("formatStrategyPlanReport / envelope — required product language", () => {
  it("the human report carries PAPER ONLY and the non-negotiable disclaimers", () => {
    const result = planStrategyBatch({
      candidates: [buyCandidate("MintA"), watchCandidate("MintB")],
      config: baseConfig,
      defaultPaperSizeUsd: 10,
      now: at,
    });
    const out = formatStrategyPlanReport(result);
    expect(out).toContain("PAPER ONLY");
    expect(out).toMatch(/not financial advice/i);
    expect(out).toMatch(/not a buy recommendation/i);
    expect(out).toMatch(/no transaction was built, signed, simulated, or sent/i);
    expect(out).toMatch(/does not run paper trades automatically/i);
  });

  it("the JSON envelope carries the banner, paperOnly flag, and notes", () => {
    const result = planStrategyBatch({ candidates: [buyCandidate("MintA")], config: baseConfig, now: at });
    const envelope = buildStrategyPlanEnvelope(result);
    expect(envelope.paperOnly).toBe(true);
    expect(envelope.notFinancialAdvice).toBe(true);
    expect(envelope.banner).toContain("PAPER ONLY");
    expect(envelope.notes.join("\n")).toMatch(/no transaction was built, signed, simulated, or sent/i);
  });
});
