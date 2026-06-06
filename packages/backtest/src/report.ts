/**
 * Backtest report constants + human rendering.
 *
 * The rendered block carries the non-negotiable product language and is passed
 * through the security redaction backstop. The required exact labels are:
 * "SIMULATED PAPER-ONLY REPORT", "Uses injected historical data only",
 * "Not a live result", "Not financial advice", "Not a profitability claim".
 *
 * The human report is sectioned (Scenario / Warnings / Summary / Equity curve /
 * Per-mint summary / Open positions / Steps / Notes) and is deterministic for a
 * given report object (no clock, no randomness). It is simulated bookkeeping from
 * injected prices — never a live result, never a profitability claim, never advice.
 */

import { redactString } from "@soulmaker/security";
import type {
  BacktestEquityPoint,
  BacktestLintIssue,
  BacktestPerMintAggregate,
  BacktestReport,
  BacktestStepResult,
} from "./types.js";

/** The banner that prefixes every backtest report (required label). */
export const BACKTEST_BANNER = "SIMULATED PAPER-ONLY REPORT";

/** Stable schema identifier for the report shape. Bump only on a breaking change. */
export const BACKTEST_REPORT_SCHEMA_VERSION = "backtest.report.v1";

/** Required disclaimer statements (each contains a required label as a substring). */
export const BACKTEST_DISCLAIMERS: readonly string[] = [
  "Uses injected historical data only.",
  "Not a live result.",
  "Not financial advice.",
  "Not a profitability claim.",
  "Simulated PnL is computed from injected prices, not real market performance.",
  "Per-mint and equity-curve figures are bookkeeping from injected prices, not market truth.",
  "No transaction was built, signed, simulated, or sent.",
];

function usd(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function trimNum(n: number): string {
  // Compact but stable: up to 6 significant decimals, no trailing zeros.
  return Number.parseFloat(n.toFixed(6)).toString();
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

function equityLine(e: BacktestEquityPoint): string {
  return (
    `- ${e.stepId} @ ${e.at}: total ${usd(e.totalPnlUsd)} ` +
    `(realized ${usd(e.realizedPnlUsd)}, unrealized ${usd(e.unrealizedPnlUsd)}); ` +
    `open ${e.openPositionCount}; closed ${e.closedTradeCount}; ` +
    `sim. notional ${usd(e.simulatedNotionalUsd)}`
  );
}

function perMintLine(m: BacktestPerMintAggregate): string {
  return (
    `- ${m.mint}: fills ${m.buyFillCount}b/${m.sellFillCount}s; ` +
    `open qty ${trimNum(m.openQuantity)}; realized ${usd(m.realizedPnlUsd)}; ` +
    `unrealized ${usd(m.unrealizedPnlUsd)}; total ${usd(m.totalPnlUsd)}; ` +
    `sim. notional ${usd(m.simulatedNotionalUsd)}`
  );
}

function warningLine(w: BacktestLintIssue): string {
  return w.path ? `- [${w.code}] ${w.message} (at ${w.path})` : `- [${w.code}] ${w.message}`;
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

  // Scenario.
  lines.push("Scenario:");
  lines.push(`- name:    ${report.scenarioName}`);
  lines.push(`- schema:  ${report.schemaVersion}`);
  lines.push(`- digest:  ${report.scenarioDigest}`);
  lines.push(`- steps:   ${report.stepCount}`);
  lines.push(`- candidates (injected): ${report.totalCandidateCount}`);
  lines.push("");

  // Warnings.
  lines.push(`Warnings (${report.warnings.length}):`);
  if (report.warnings.length === 0) {
    lines.push("- (none)");
  } else {
    for (const w of report.warnings) lines.push(warningLine(w));
    lines.push("Scenario is runnable, but the warnings above flag suspicious design.");
  }
  lines.push("");

  // Summary.
  lines.push("Summary:");
  lines.push(
    `- plan candidates:   ${report.planCounts.paperBuyCandidateCount} buy / ` +
      `${report.planCounts.paperSellCandidateCount} sell ` +
      `(watch ${report.planCounts.watchCount}, skipped ${report.planCounts.skippedCount}, ` +
      `rejected ${report.planCounts.rejectedCount})`,
  );
  lines.push(
    `- simulated fills:   ${report.fillCounts.buyCount} buy / ${report.fillCounts.sellCount} sell`,
  );
  lines.push(
    `- rejected (paper):  ${report.rejectedCounts.total} ` +
      `(risk ${report.rejectedCounts.byRisk}, caps ${report.rejectedCounts.byCaps}, ` +
      `price ${report.rejectedCounts.byPrice})`,
  );
  lines.push(
    `- positions:         ${report.positionCounts.open} open / ${report.positionCounts.closed} closed`,
  );
  lines.push(`- realized PnL:      ${usd(report.pnl.realizedUsd)}`);
  lines.push(`- unrealized PnL:    ${usd(report.pnl.unrealizedUsd)}`);
  lines.push(`- total PnL:         ${usd(report.pnl.totalUsd)}`);
  lines.push(`- sim. notional:     ${usd(report.simulatedNotionalUsd)}`);
  lines.push("");

  // Equity curve.
  lines.push("Equity curve (simulated, per step):");
  if (report.equityCurve.length === 0) {
    lines.push("- (none)");
  } else {
    for (const e of report.equityCurve) lines.push(equityLine(e));
  }
  lines.push("");

  // Per-mint summary.
  lines.push("Per-mint summary (simulated):");
  if (report.perMint.length === 0) {
    lines.push("- (none)");
  } else {
    for (const m of report.perMint) lines.push(perMintLine(m));
  }
  lines.push("");

  // Open positions.
  lines.push("Open positions (final):");
  if (report.openPositions.length === 0) {
    lines.push("- (none)");
  } else {
    for (const p of report.openPositions) {
      lines.push(
        `- ${p.mint}  qty ${trimNum(p.quantity)}  avg ${usd(p.averageEntryPriceUsd)}  ` +
          `unrealized ${usd(p.unrealizedPnlUsd)}`,
      );
    }
  }
  lines.push("");

  // Steps.
  lines.push("Steps:");
  for (const s of report.steps) lines.push(stepLine(s));
  lines.push("");

  // Notes (required disclaimers).
  lines.push("Notes:");
  for (const note of report.disclaimers) lines.push(`- ${note}`);

  return redactString(lines.join("\n"));
}
