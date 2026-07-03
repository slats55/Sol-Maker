import { describe, it, expect } from "vitest";

import { buildDaemonSummary, createDaemonState, bumpTotals } from "./daemon.js";
import type { DaemonSummary } from "./daemon.js";
import { buildLedger, closePosition, openPosition, applyMark } from "./position.js";
import type { LivePosition } from "./position.js";
import { EDGE_MIN_SAMPLE, buildPaperPerformanceReport, formatPaperPerformanceMarkdown } from "./performance.js";

const MINT_A = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MINT_B = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const T0 = "2026-07-02T04:00:00.000Z";
const T1 = "2026-07-02T04:10:00.000Z";
const T2 = "2026-07-02T05:00:00.000Z";

function summaryWith(totalsDelta: Record<string, number> = {}): DaemonSummary {
  let state = createDaemonState({ startedAt: T0, profileName: "balanced" });
  state = bumpTotals(state, totalsDelta);
  return buildDaemonSummary(state, {
    endedAt: T2,
    endedBy: "duration-elapsed",
    positions: { open: 0, closed: 0, realizedPnlKnownLamports: 0, closedPnlUnknown: 0 },
  });
}

function closedPaper(mint: string, openedAt: string, closedAt: string, entry: number, value: number | null): LivePosition {
  const p = openPosition({ kind: "paper", mint, openedAt, entrySpendLamports: entry });
  return closePosition({ position: p, closedAt, reason: "time-exit", closeKind: "paper-auto", valueLamports: value });
}

describe("paper performance — honest edge verdicts", () => {
  it("no trades at all → no-trades", () => {
    const report = buildPaperPerformanceReport({ summary: summaryWith(), ledger: buildLedger([]), generatedAt: T2 });
    expect(report.edge.verdict).toBe("no-trades");
  });

  it("a small winning sample is INSUFFICIENT, never an edge claim", () => {
    const ledger = buildLedger([closedPaper(MINT_A, T0, T1, 1_000_000, 2_000_000)]);
    const report = buildPaperPerformanceReport({ summary: summaryWith(), ledger, generatedAt: T2 });
    expect(report.edge.verdict).toBe("insufficient-sample");
    expect(report.edge.explanation).toMatch(/INCONCLUSIVE/);
    expect(report.pnl.realizedKnownLamports).toBe(1_000_000);
  });

  it("a large losing sample says no-edge-in-sample", () => {
    const positions: LivePosition[] = [];
    for (let i = 0; i < EDGE_MIN_SAMPLE; i++) {
      const openedAt = new Date(Date.parse(T0) + i * 60_000).toISOString();
      const closedAt = new Date(Date.parse(T0) + i * 60_000 + 30_000).toISOString();
      positions.push(closedPaper(i % 2 === 0 ? MINT_A : MINT_B, openedAt, closedAt, 1_000_000, 900_000));
    }
    const report = buildPaperPerformanceReport({ summary: summaryWith(), ledger: buildLedger(positions), generatedAt: T2 });
    expect(report.edge.verdict).toBe("no-edge-in-sample");
    expect(report.pnl.realizedKnownLamports).toBe(-100_000 * EDGE_MIN_SAMPLE);
  });

  it("a large winning sample is at MOST possible-edge-unproven — edge-proven does not exist", () => {
    const positions: LivePosition[] = [];
    for (let i = 0; i < EDGE_MIN_SAMPLE; i++) {
      const openedAt = new Date(Date.parse(T0) + i * 60_000).toISOString();
      const closedAt = new Date(Date.parse(T0) + i * 60_000 + 30_000).toISOString();
      positions.push(closedPaper(i % 2 === 0 ? MINT_A : MINT_B, openedAt, closedAt, 1_000_000, 1_100_000));
    }
    const report = buildPaperPerformanceReport({ summary: summaryWith(), ledger: buildLedger(positions), generatedAt: T2 });
    expect(report.edge.verdict).toBe("possible-edge-unproven");
    expect(report.edge.explanation).toMatch(/NOT proof/);
  });
});

describe("paper performance — unknown prices stay unknown", () => {
  it("a close without a value is counted as unknown PnL, never estimated", () => {
    const ledger = buildLedger([closedPaper(MINT_A, T0, T1, 1_000_000, null)]);
    const report = buildPaperPerformanceReport({ summary: summaryWith(), ledger, generatedAt: T2 });
    expect(report.positions.closedPnlUnknown).toBe(1);
    expect(report.positions.closedPnlKnown).toBe(0);
    expect(report.pnl.realizedKnownLamports).toBe(0);
    expect(report.pnl.bestTrade).toBeNull();
  });

  it("open positions without a mark are honestly unmarked; marked ones contribute unrealized", () => {
    const unmarked = openPosition({ kind: "paper", mint: MINT_A, openedAt: T0, entrySpendLamports: 1_000_000 });
    let marked = openPosition({ kind: "paper", mint: MINT_B, openedAt: T0, entrySpendLamports: 1_000_000 });
    marked = applyMark(marked, { valueLamports: 1_500_000, atMs: Date.parse(T1), source: "test" });
    const report = buildPaperPerformanceReport({ summary: summaryWith(), ledger: buildLedger([unmarked, marked]), generatedAt: T2 });
    expect(report.pnl.unrealizedMarkedLamports).toBe(500_000);
    expect(report.pnl.openUnmarked).toBe(1);
  });
});

describe("paper performance — funnel, drawdown, exits, markdown", () => {
  it("computes drawdown over the known-PnL curve and counts exits by reason", () => {
    const win = closedPaper(MINT_A, T0, "2026-07-02T04:01:00.000Z", 1_000_000, 2_000_000); // +1M
    const lossPos = openPosition({ kind: "paper", mint: MINT_B, openedAt: "2026-07-02T04:02:00.000Z", entrySpendLamports: 1_000_000 });
    const loss = closePosition({ position: lossPos, closedAt: "2026-07-02T04:03:00.000Z", reason: "stop-loss", closeKind: "paper-auto", valueLamports: 400_000 }); // -600k
    const report = buildPaperPerformanceReport({ summary: summaryWith({ quotesFetched: 8, quotesStale: 2 }), ledger: buildLedger([win, loss]), generatedAt: T2 });
    expect(report.pnl.maxDrawdownLamports).toBe(600_000);
    expect(report.exits["stop-loss"]).toBe(1);
    expect(report.exits["time-exit"]).toBe(1);
    expect(report.pnl.bestTrade?.pnlLamports).toBe(1_000_000);
    expect(report.pnl.worstTrade?.pnlLamports).toBe(-600_000);
    expect(report.quotes.staleRate).toBe(0.2);
    const md = formatPaperPerformanceMarkdown(report);
    expect(md).toContain("Edge verdict");
    expect(md).toContain("insufficient-sample");
    expect(md).toContain("Max drawdown");
    expect(md).toContain("no profitability claim");
  });
});
