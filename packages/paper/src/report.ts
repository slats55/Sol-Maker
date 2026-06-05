/**
 * Summary computation and human-readable rendering.
 *
 * Every rendered block is passed through the security redaction backstop and
 * carries the PAPER-ONLY / not-real-performance / nothing-was-sent language.
 */

import { redactString } from "@soulmaker/security";
import { openPositionCount } from "./caps.js";
import type {
  PaperJournalEvent,
  PaperPosition,
  PaperRunSummary,
  PaperState,
} from "./types.js";

export const PAPER_ONLY_BANNER = "PAPER ONLY — SIMULATED";

export const PAPER_NOTES: readonly string[] = [
  "PAPER ONLY: this is a simulated paper-trading report.",
  "Paper PnL is based on injected prices, not real market performance.",
  "A risk PASS means eligible for paper evaluation, not safe to buy or live-trade.",
  "No transaction was built, signed, simulated, or sent.",
];

function count(events: readonly PaperJournalEvent[], type: string): number {
  let n = 0;
  for (const e of events) if (e.type === type) n += 1;
  return n;
}

/** Derive a run/journal summary from final state + the event list. */
export function summarize(
  state: PaperState,
  events: readonly PaperJournalEvent[],
): PaperRunSummary {
  const rejectedByRisk = count(events, "CANDIDATE_REJECTED_BY_RISK");
  const rejectedByCaps = count(events, "CANDIDATE_REJECTED_BY_CAPS");
  const rejectedByPrice = count(events, "CANDIDATE_REJECTED_BY_PRICE");
  const realizedPnlUsd = state.realizedPnlUsd;
  const unrealizedPnlUsd = state.unrealizedPnlUsd;
  return {
    realizedPnlUsd,
    unrealizedPnlUsd,
    totalPnlUsd: realizedPnlUsd + unrealizedPnlUsd,
    openPositionCount: openPositionCount(state),
    closedTradeCount: state.closedTradeCount,
    buyCount: count(events, "PAPER_BUY_FILLED"),
    sellCount: count(events, "PAPER_SELL_FILLED"),
    rejectedCandidateCount: rejectedByRisk + rejectedByCaps + rejectedByPrice,
    rejectedByRisk,
    rejectedByCaps,
    rejectedByPrice,
    simulatedNotionalUsd: state.simulatedNotionalUsd,
  };
}

function usd(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function trimNum(n: number): string {
  // Compact but stable: up to 6 significant decimals, no trailing zeros.
  return Number.parseFloat(n.toFixed(6)).toString();
}

function openPositions(state: PaperState): PaperPosition[] {
  return Object.keys(state.positions)
    .sort()
    .map((k) => state.positions[k])
    .filter((p): p is PaperPosition => !!p && p.quantity > 0);
}

export const PAPER_DISCLAIMER =
  "PAPER ONLY — simulated. No transaction was built, signed, simulated, or sent. " +
  "Paper PnL is based on injected prices, not real market performance. " +
  "A risk PASS means eligible for paper evaluation, not safe to buy or live-trade.";

export interface PaperReportEnvelope {
  banner: string;
  paperOnly: true;
  disclaimer: string;
  notes: string[];
  summary: PaperRunSummary;
  openPositions: PaperPosition[];
  events?: PaperJournalEvent[];
}

/**
 * A stable, JSON-serializable envelope for `--json` output. It always carries
 * the PAPER-ONLY banner and the "no transaction was built, signed, simulated, or
 * sent" disclaimer so the required product language survives serialization.
 */
export function buildReportEnvelope(
  state: PaperState,
  summary: PaperRunSummary,
  events?: PaperJournalEvent[],
): PaperReportEnvelope {
  return {
    banner: PAPER_ONLY_BANNER,
    paperOnly: true,
    disclaimer: PAPER_DISCLAIMER,
    notes: [...PAPER_NOTES],
    summary,
    openPositions: openPositions(state),
    ...(events ? { events } : {}),
  };
}

export interface FormatReportOptions {
  title?: string;
  /** Number of trailing events to show. Default 8. 0 hides the section. */
  recentEvents?: PaperJournalEvent[];
  recentLimit?: number;
}

function eventLine(e: PaperJournalEvent): string {
  switch (e.type) {
    case "PAPER_BUY_FILLED":
      return `BUY  ${e.fill.mint} qty ${trimNum(e.fill.quantity)} @ ${usd(e.fill.priceUsd)} (${usd(e.fill.notionalUsd)}) at ${e.at}`;
    case "PAPER_SELL_FILLED":
      return `SELL ${e.fill.mint} qty ${trimNum(e.fill.quantity)} @ ${usd(e.fill.priceUsd)} realized ${usd(e.realizedPnlUsd)} at ${e.at}`;
    case "TAKE_PROFIT_TRIGGERED":
      return `TAKE_PROFIT ${e.mint} @ ${usd(e.priceUsd)} at ${e.at}`;
    case "STOP_LOSS_TRIGGERED":
      return `STOP_LOSS ${e.mint} @ ${usd(e.priceUsd)} at ${e.at}`;
    case "CANDIDATE_REJECTED_BY_RISK":
      return `REJECT(risk) ${e.mint} decision=${e.decision} at ${e.at}`;
    case "CANDIDATE_REJECTED_BY_CAPS":
      return `REJECT(caps) ${e.mint} cap=${e.cap} at ${e.at}`;
    case "CANDIDATE_REJECTED_BY_PRICE":
      return `REJECT(price) ${e.mint} at ${e.at}`;
    case "KILL_SWITCH_ACTIVE":
      return `KILL_SWITCH_ACTIVE at ${e.at}`;
    case "RUN_STARTED":
      return `RUN_STARTED at ${e.at}`;
    case "RUN_COMPLETED":
      return `RUN_COMPLETED at ${e.at}`;
  }
}

/** Render a redacted, human-readable PAPER-ONLY report from state + summary. */
export function formatPaperReport(
  state: PaperState,
  summary: PaperRunSummary,
  options: FormatReportOptions = {},
): string {
  const title = options.title ?? "Paper trading report";
  const lines: string[] = [];
  lines.push(`${title} (${PAPER_ONLY_BANNER})`);
  lines.push("=".repeat(`${title} (${PAPER_ONLY_BANNER})`.length));
  lines.push(`realized PnL:     ${usd(summary.realizedPnlUsd)}`);
  lines.push(`unrealized PnL:   ${usd(summary.unrealizedPnlUsd)}`);
  lines.push(`total PnL:        ${usd(summary.totalPnlUsd)}`);
  lines.push(`open positions:   ${summary.openPositionCount}`);
  lines.push(`closed trades:    ${summary.closedTradeCount}`);
  lines.push(`buys / sells:     ${summary.buyCount} / ${summary.sellCount}`);
  lines.push(
    `rejected:         ${summary.rejectedCandidateCount} ` +
      `(risk ${summary.rejectedByRisk}, caps ${summary.rejectedByCaps}, price ${summary.rejectedByPrice})`,
  );
  lines.push(`sim. notional:    ${usd(summary.simulatedNotionalUsd)}`);

  const positions = openPositions(state);
  lines.push("");
  lines.push("Open positions:");
  if (positions.length === 0) {
    lines.push("- (none)");
  } else {
    for (const p of positions) {
      lines.push(
        `- ${p.mint}  qty ${trimNum(p.quantity)}  avg ${usd(p.averageEntryPriceUsd)}  ` +
          `unrealized ${usd(p.unrealizedPnlUsd)}`,
      );
    }
  }

  const limit = options.recentLimit ?? 8;
  if (options.recentEvents && limit > 0) {
    const tail = options.recentEvents.slice(-limit);
    lines.push("");
    lines.push(`Recent events (${tail.length} of ${options.recentEvents.length}):`);
    for (const e of tail) lines.push(`- ${eventLine(e)}`);
  }

  lines.push("");
  lines.push("Notes:");
  for (const note of PAPER_NOTES) lines.push(`- ${note}`);

  return redactString(lines.join("\n"));
}
