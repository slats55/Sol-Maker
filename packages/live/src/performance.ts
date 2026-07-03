/**
 * PAPER PERFORMANCE EVIDENCE (`live.paper.performance.report.v1`, Sprint 109).
 *
 * Turns one daemon session (summary + position ledger) into a brutally honest performance report.
 * The rules that make it evidence instead of hype:
 *
 *   - Every number is COMPUTED from the ledger/summary, never copied from a claim.
 *   - PnL is split into KNOWN (real close values existed) and UNKNOWN (counted, never guessed).
 *   - The EDGE VERDICT is a closed set and is deliberately incapable of saying "edge proven":
 *     the strongest positive statement this report can make is `possible-edge-unproven`, and only
 *     with a minimum sample of closed, PnL-known trades. Small samples say `insufficient-sample`.
 *   - Losing sessions say `no-edge-in-sample`. Zero trades say `no-trades`.
 *
 * Pure: no clock, no network, no randomness, no I/O.
 */

import type { PositionLedger, LivePosition, ExitReason } from "./position.js";
import { LAMPORTS_PER_SOL } from "./position.js";
import type { DaemonSummary } from "./daemon.js";

export const LIVE_PAPER_PERFORMANCE_SCHEMA_VERSION = "live.paper.performance.report.v1";

/** Minimum closed, PnL-known paper trades before this report will even say "possible edge". */
export const EDGE_MIN_SAMPLE = 20;

/** The closed edge-verdict set. "edge-proven" is deliberately NOT a member. */
export const EDGE_VERDICTS = ["no-trades", "insufficient-sample", "no-edge-in-sample", "possible-edge-unproven"] as const;
export type EdgeVerdict = (typeof EDGE_VERDICTS)[number];

export interface TradeStat {
  positionId: string;
  mint: string;
  pnlLamports: number;
  heldMs: number | null;
  reason: ExitReason | null;
}

export interface PaperPerformanceReport {
  schemaVersion: typeof LIVE_PAPER_PERFORMANCE_SCHEMA_VERSION;
  generatedAt: string;
  sessionStartedAt: string;
  sessionEndedAt: string;
  profileName: string;
  candidates: {
    seen: number;
    new: number;
    duplicatesSkipped: number;
    riskChecked: number;
    riskRejected: number;
    liquidityRejected: number;
  };
  quotes: {
    fetched: number;
    stale: number;
    unavailable: number;
    /** stale / (fetched + stale); null when nothing was fetched. */
    staleRate: number | null;
  };
  providerFailures: number;
  noTradeReasons: Record<string, number>;
  positions: {
    opened: number;
    closed: number;
    stillOpen: number;
    closedPnlKnown: number;
    closedPnlUnknown: number;
  };
  pnl: {
    realizedKnownLamports: number;
    realizedKnownSol: number;
    /** Sum over open positions with a mark of (mark - entry); null when no open position has a mark. */
    unrealizedMarkedLamports: number | null;
    /** Open positions without any mark (unrealized PnL unknowable for them). */
    openUnmarked: number;
    /** Max peak-to-trough drawdown of the cumulative KNOWN realized PnL curve, in lamports. */
    maxDrawdownLamports: number;
    bestTrade: TradeStat | null;
    worstTrade: TradeStat | null;
    /** Mean hold time of closed positions with parseable timestamps; null when none. */
    avgHoldMs: number | null;
  };
  exits: Record<ExitReason, number>;
  edge: {
    verdict: EdgeVerdict;
    sampleSize: number;
    minSample: number;
    explanation: string;
  };
  caveats: string[];
  notProfitabilityClaim: true;
}

function heldMsOf(p: LivePosition): number | null {
  if (p.close === null) return null;
  const opened = Date.parse(p.openedAt);
  const closed = Date.parse(p.close.closedAt);
  if (!Number.isFinite(opened) || !Number.isFinite(closed) || closed < opened) return null;
  return closed - opened;
}

function round9(sol: number): number {
  return Math.round(sol * 1e9) / 1e9;
}

export interface BuildPerformanceInput {
  summary: DaemonSummary;
  ledger: PositionLedger;
  generatedAt: string;
}

/** Compute the performance report. Every figure derives from the ledger/summary — nothing invented. */
export function buildPaperPerformanceReport(input: BuildPerformanceInput): PaperPerformanceReport {
  const { summary, ledger } = input;
  const closed = ledger.positions.filter((p) => p.status === "closed");
  const open = ledger.positions.filter((p) => p.status === "open");
  const known = closed.filter((p) => typeof p.close?.pnlLamports === "number");

  // Exit counts.
  const exits: Record<ExitReason, number> = {
    emergency: 0,
    "kill-switch": 0,
    "stop-loss": 0,
    "trailing-stop": 0,
    "take-profit": 0,
    "time-exit": 0,
    "operator-manual": 0,
  };
  for (const p of closed) {
    if (p.close !== null) exits[p.close.reason] += 1;
  }

  // Trade stats over the KNOWN-PnL closes.
  const stats: TradeStat[] = known.map((p) => ({
    positionId: p.positionId,
    mint: p.mint,
    pnlLamports: p.close!.pnlLamports as number,
    heldMs: heldMsOf(p),
    reason: p.close?.reason ?? null,
  }));
  let best: TradeStat | null = null;
  let worst: TradeStat | null = null;
  for (const s of stats) {
    if (best === null || s.pnlLamports > best.pnlLamports) best = s;
    if (worst === null || s.pnlLamports < worst.pnlLamports) worst = s;
  }

  // Max drawdown over the cumulative known-PnL curve, in close order (ledger order = open order,
  // close order approximated by closedAt sort — honest note: paper resolution only).
  const chronological = [...known].sort((a, b) => Date.parse(a.close!.closedAt) - Date.parse(b.close!.closedAt));
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const p of chronological) {
    cumulative += p.close!.pnlLamports as number;
    if (cumulative > peak) peak = cumulative;
    const dd = peak - cumulative;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Unrealized: only for open positions with a REAL mark.
  const marked = open.filter((p) => p.lastMark !== null);
  const unrealized = marked.length === 0 ? null : marked.reduce((sum, p) => sum + (p.lastMark!.valueLamports - p.entrySpendLamports), 0);

  // Hold times.
  const holds = closed.map(heldMsOf).filter((h): h is number => h !== null);
  const avgHoldMs = holds.length === 0 ? null : Math.round(holds.reduce((a, b) => a + b, 0) / holds.length);

  const realizedKnown = ledger.totals.realizedPnlKnownLamports;
  const totalsQ = summary.totals;
  const quoteAttempts = totalsQ.quotesFetched + totalsQ.quotesStale;
  const staleRate = quoteAttempts === 0 ? null : Math.round((totalsQ.quotesStale / quoteAttempts) * 10_000) / 10_000;

  // The honest edge verdict.
  const sampleSize = known.length;
  let verdict: EdgeVerdict;
  let explanation: string;
  if (closed.length === 0 && open.length === 0) {
    verdict = "no-trades";
    explanation = "No paper positions were opened this session — there is nothing to evaluate. That is a result, not a failure.";
  } else if (sampleSize < EDGE_MIN_SAMPLE) {
    verdict = "insufficient-sample";
    explanation = `Only ${sampleSize} closed trade(s) with known PnL (minimum ${EDGE_MIN_SAMPLE} for any edge statement). INCONCLUSIVE — no edge claim can be made either way from this sample.`;
  } else if (realizedKnown <= 0) {
    verdict = "no-edge-in-sample";
    explanation = `Across ${sampleSize} closed trades the known realized PnL is ${realizedKnown} lamports (≤ 0). This sample shows NO edge. Paper results also exclude live frictions (fees, slippage-at-fill, MEV), which only make it worse.`;
  } else {
    verdict = "possible-edge-unproven";
    explanation = `Across ${sampleSize} closed trades the known realized PnL is ${realizedKnown} lamports (> 0). This is NOT proof of edge: paper fills are optimistic, the sample window is short, and live frictions are not modeled. The strongest honest statement is "possible, unproven".`;
  }

  return {
    schemaVersion: LIVE_PAPER_PERFORMANCE_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    sessionStartedAt: summary.startedAt,
    sessionEndedAt: summary.endedAt,
    profileName: summary.profileName,
    candidates: {
      seen: totalsQ.candidatesSeen,
      new: totalsQ.newCandidates,
      duplicatesSkipped: totalsQ.duplicatesSkipped,
      riskChecked: totalsQ.riskChecked,
      riskRejected: totalsQ.riskRejected,
      liquidityRejected: totalsQ.liquidityRejected,
    },
    quotes: {
      fetched: totalsQ.quotesFetched,
      stale: totalsQ.quotesStale,
      unavailable: totalsQ.quotesUnavailable,
      staleRate,
    },
    providerFailures: totalsQ.providerFailures,
    noTradeReasons: { ...summary.noTradeReasons },
    positions: {
      opened: totalsQ.positionsOpened,
      closed: closed.length,
      stillOpen: open.length,
      closedPnlKnown: known.length,
      closedPnlUnknown: closed.length - known.length,
    },
    pnl: {
      realizedKnownLamports: realizedKnown,
      realizedKnownSol: round9(realizedKnown / LAMPORTS_PER_SOL),
      unrealizedMarkedLamports: unrealized,
      openUnmarked: open.length - marked.length,
      maxDrawdownLamports: maxDrawdown,
      bestTrade: best,
      worstTrade: worst,
      avgHoldMs,
    },
    exits,
    edge: { verdict, sampleSize, minSample: EDGE_MIN_SAMPLE, explanation },
    caveats: [
      "PAPER evidence only: no funds were held, moved, or risked; fills are simulated at quoted values.",
      "Live frictions (fees, priority fees, slippage-at-fill, failed transactions, MEV) are NOT modeled.",
      "Unknown PnL stays unknown — it is counted, never estimated.",
      "This report makes no profitability claim and is not financial advice.",
    ],
    notProfitabilityClaim: true,
  };
}

function fmtSol(lamports: number): string {
  return `${lamports} lamports (${round9(lamports / LAMPORTS_PER_SOL)} SOL)`;
}

function fmtMs(ms: number | null): string {
  if (ms === null) return "unknown";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** Render the report as operator-readable Markdown. */
export function formatPaperPerformanceMarkdown(r: PaperPerformanceReport): string {
  const lines: string[] = [];
  lines.push(`# Paper performance report — profile "${r.profileName}"`);
  lines.push("");
  lines.push(`Session ${r.sessionStartedAt} → ${r.sessionEndedAt} (generated ${r.generatedAt}).`);
  lines.push("");
  lines.push(`## Edge verdict: \`${r.edge.verdict}\``);
  lines.push("");
  lines.push(r.edge.explanation);
  lines.push("");
  lines.push("## Funnel");
  lines.push("");
  lines.push("| Stage | Count |");
  lines.push("| --- | ---: |");
  lines.push(`| Candidates seen (all polls) | ${r.candidates.seen} |`);
  lines.push(`| New candidates (deduped) | ${r.candidates.new} |`);
  lines.push(`| Duplicates skipped | ${r.candidates.duplicatesSkipped} |`);
  lines.push(`| Risk-checked | ${r.candidates.riskChecked} |`);
  lines.push(`| Risk-rejected | ${r.candidates.riskRejected} |`);
  lines.push(`| Liquidity-rejected | ${r.candidates.liquidityRejected} |`);
  lines.push(`| Paper positions opened | ${r.positions.opened} |`);
  lines.push(`| Positions closed | ${r.positions.closed} (${r.positions.closedPnlKnown} with known PnL, ${r.positions.closedPnlUnknown} unknown) |`);
  lines.push(`| Still open | ${r.positions.stillOpen} |`);
  lines.push("");
  lines.push("## PnL (paper; known values only)");
  lines.push("");
  lines.push(`- Realized (known): **${fmtSol(r.pnl.realizedKnownLamports)}**`);
  lines.push(`- Unrealized (marked open positions): ${r.pnl.unrealizedMarkedLamports === null ? "unknown — no open position has a mark" : fmtSol(r.pnl.unrealizedMarkedLamports)}${r.pnl.openUnmarked > 0 ? ` (${r.pnl.openUnmarked} open position(s) unmarked — honestly unknown)` : ""}`);
  lines.push(`- Max drawdown (cumulative known realized): ${fmtSol(r.pnl.maxDrawdownLamports)}`);
  lines.push(`- Best trade: ${r.pnl.bestTrade ? `${r.pnl.bestTrade.mint} ${fmtSol(r.pnl.bestTrade.pnlLamports)} (${r.pnl.bestTrade.reason ?? "?"}, held ${fmtMs(r.pnl.bestTrade.heldMs)})` : "none"}`);
  lines.push(`- Worst trade: ${r.pnl.worstTrade ? `${r.pnl.worstTrade.mint} ${fmtSol(r.pnl.worstTrade.pnlLamports)} (${r.pnl.worstTrade.reason ?? "?"}, held ${fmtMs(r.pnl.worstTrade.heldMs)})` : "none"}`);
  lines.push(`- Average hold time: ${fmtMs(r.pnl.avgHoldMs)}`);
  lines.push("");
  lines.push("## Exits");
  lines.push("");
  for (const [reason, count] of Object.entries(r.exits)) {
    lines.push(`- ${reason}: ${count}`);
  }
  lines.push("");
  lines.push("## Quotes + providers");
  lines.push("");
  lines.push(`- Quotes fetched: ${r.quotes.fetched}, stale: ${r.quotes.stale}, unavailable: ${r.quotes.unavailable}`);
  lines.push(`- Quote stale rate: ${r.quotes.staleRate === null ? "n/a (none fetched)" : `${(r.quotes.staleRate * 100).toFixed(2)}%`}`);
  lines.push(`- Provider failures: ${r.providerFailures}`);
  lines.push("");
  lines.push("## No-trade reasons");
  lines.push("");
  const reasons = Object.entries(r.noTradeReasons).sort((a, b) => b[1] - a[1]);
  if (reasons.length === 0) lines.push("(none recorded)");
  for (const [reason, count] of reasons) lines.push(`- ${count}× ${reason}`);
  lines.push("");
  lines.push("## Caveats");
  lines.push("");
  for (const c of r.caveats) lines.push(`- ${c}`);
  lines.push("");
  return lines.join("\n");
}
