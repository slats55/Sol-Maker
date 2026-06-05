/**
 * Backtest report constants + human rendering.
 *
 * The rendered block carries the non-negotiable product language and is passed
 * through the security redaction backstop. The required exact labels are:
 * "SIMULATED PAPER-ONLY REPORT", "Uses injected historical data only",
 * "Not a live result", "Not financial advice", "Not a profitability claim".
 */

import { redactString } from "@soulmaker/security";
import type { BacktestReport, BacktestStepResult } from "./types.js";

/** The banner that prefixes every backtest report (required label). */
export const BACKTEST_BANNER = "SIMULATED PAPER-ONLY REPORT";

/** Required disclaimer statements (each contains a required label as a substring). */
export const BACKTEST_DISCLAIMERS: readonly string[] = [
  "Uses injected historical data only.",
  "Not a live result.",
  "Not financial advice.",
  "Not a profitability claim.",
  "Simulated PnL is computed from injected prices, not real market performance.",
  "No transaction was built, signed, simulated, or sent.",
];

function usd(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function stepLine(s: BacktestStepResult): string {
  return (
    `- ${s.id} @ ${s.at}: candidates ${s.candidateCount} ` +
    `(buy-cand ${s.paperBuyCandidateCount}, sell-cand ${s.paperSellCandidateCount}); ` +
    `fills ${s.buyCount}b/${s.sellCount}s; rejected ${s.rejectedCount}; ` +
    `open ${s.openPositionCount}; realized ${usd(s.realizedPnlUsd)}; ` +
    `unrealized ${usd(s.unrealizedPnlUsd)}`
  );
}

/**
 * Render a redacted, human-readable, PAPER-ONLY backtest report. Stable for a
 * given report object (no clock/randomness). Carries every required label.
 */
export function formatBacktestReport(report: BacktestReport): string {
  const header = `Backtest — ${report.scenarioName} (${BACKTEST_BANNER})`;
  const lines: string[] = [];
  lines.push(header);
  lines.push("=".repeat(header.length));
  lines.push(`scenario:          ${report.scenarioName}`);
  lines.push(`steps:             ${report.stepCount}`);
  lines.push(`total candidates:  ${report.totalCandidateCount}`);
  lines.push(
    `plan candidates:   ${report.planCounts.paperBuyCandidateCount} buy / ` +
      `${report.planCounts.paperSellCandidateCount} sell ` +
      `(watch ${report.planCounts.watchCount}, skipped ${report.planCounts.skippedCount}, ` +
      `rejected ${report.planCounts.rejectedCount})`,
  );
  lines.push(
    `simulated fills:   ${report.fillCounts.buyCount} buy / ${report.fillCounts.sellCount} sell`,
  );
  lines.push(
    `rejected (paper):  ${report.rejectedCounts.total} ` +
      `(risk ${report.rejectedCounts.byRisk}, caps ${report.rejectedCounts.byCaps}, ` +
      `price ${report.rejectedCounts.byPrice})`,
  );
  lines.push(
    `positions:         ${report.positionCounts.open} open / ${report.positionCounts.closed} closed`,
  );
  lines.push(`realized PnL:      ${usd(report.pnl.realizedUsd)}`);
  lines.push(`unrealized PnL:    ${usd(report.pnl.unrealizedUsd)}`);
  lines.push(`total PnL:         ${usd(report.pnl.totalUsd)}`);
  lines.push(`sim. notional:     ${usd(report.simulatedNotionalUsd)}`);
  lines.push("");

  lines.push("Open positions (final):");
  if (report.openPositions.length === 0) {
    lines.push("- (none)");
  } else {
    for (const p of report.openPositions) {
      lines.push(
        `- ${p.mint}  qty ${p.quantity}  avg ${usd(p.averageEntryPriceUsd)}  ` +
          `unrealized ${usd(p.unrealizedPnlUsd)}`,
      );
    }
  }
  lines.push("");

  lines.push("Steps:");
  for (const s of report.steps) lines.push(stepLine(s));
  lines.push("");

  lines.push("Notes:");
  for (const note of report.disclaimers) lines.push(`- ${note}`);

  return redactString(lines.join("\n"));
}
