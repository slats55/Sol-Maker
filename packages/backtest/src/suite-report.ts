/**
 * Human rendering for the deterministic backtest SUITE index (Sprint 11).
 *
 * Sectioned and stable for a given index object (no clock/randomness), passed
 * through the security redaction backstop. It uses neutral "simulated bookkeeping"
 * wording and carries every required PAPER-ONLY label. It is simulated bookkeeping
 * over injected scenarios — never a live result, never a profitability claim,
 * never advice.
 */

import { redactString } from "@soulmaker/security";
import { BACKTEST_SUITE_BANNER } from "./suite.js";
import type {
  BacktestSuiteEntry,
  BacktestSuiteIndex,
} from "./suite.js";

function usd(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

/** A compact one-line status flag for an entry. */
function entryStatusLabel(e: BacktestSuiteEntry): string {
  if (e.status === "passed") {
    return e.warningCodes.length > 0 ? `PASS (+${e.warningCodes.length}w)` : "PASS";
  }
  return e.runStatus === "skipped" ? "FAIL (lint)" : "FAIL (run)";
}

function entryLine(e: BacktestSuiteEntry): string {
  const head = `- [${entryStatusLabel(e)}] ${e.id}`;
  const name = e.scenarioName ? `  ${e.scenarioName}` : "";
  if (e.summary) {
    const digest = e.scenarioDigest ? ` [${e.scenarioDigest}]` : "";
    return (
      `${head}${name}${digest}\n` +
      `    steps ${e.summary.stepCount}; fills ${e.summary.buyFills}b/${e.summary.sellFills}s; ` +
      `rejects ${e.summary.rejects}; open ${e.summary.openPositions}; closed ${e.summary.closedTrades}; ` +
      `total ${usd(e.summary.totalPnlUsd)} (realized ${usd(e.summary.realizedPnlUsd)}, ` +
      `unrealized ${usd(e.summary.unrealizedPnlUsd)})` +
      (e.reportFile ? `\n    report: ${e.reportFile}` : "")
    );
  }
  // Failed entry: surface the first error so the line is actionable.
  const first = e.errors[0];
  const why = first ? `${first.message}${first.path ? ` (at ${first.path})` : ""}` : "unknown error";
  return `${head}${name}\n    error [${first?.code ?? "error"}]: ${why}`;
}

export interface FormatBacktestSuiteIndexOptions {
  /** Override the label shown for the suite (e.g. the source directory). */
  label?: string;
}

/**
 * Render a redacted, human-readable, PAPER-ONLY suite index. Deterministic for a
 * given index object. Carries every required label.
 */
export function formatBacktestSuiteIndex(
  index: BacktestSuiteIndex,
  opts: FormatBacktestSuiteIndexOptions = {},
): string {
  const label = opts.label ?? index.name ?? "(unnamed suite)";
  const s = index.summary;
  const lines: string[] = [];

  const header = `Backtest suite — ${label} (${BACKTEST_SUITE_BANNER})`;
  lines.push(header);
  lines.push("=".repeat(header.length));

  // Suite.
  lines.push("Suite:");
  lines.push(`- name:    ${index.name ?? "(unnamed)"}`);
  lines.push(`- schema:  ${index.schemaVersion}`);
  lines.push(`- scenarios: ${s.scenarioCount} (${s.passedCount} passed, ${s.failedCount} failed)`);
  lines.push(`- warnings:  ${s.warningCount}`);
  lines.push("");

  // Aggregate summary.
  lines.push("Aggregate (simulated, passed scenarios only):");
  lines.push(`- steps:           ${s.totalStepCount}`);
  lines.push(`- candidates:      ${s.totalCandidateCount}`);
  lines.push(`- simulated fills: ${s.totalBuyFills} buy / ${s.totalSellFills} sell (${s.totalFills} total)`);
  lines.push(`- rejects (paper): ${s.totalRejects}`);
  lines.push(`- open / closed:   ${s.totalOpenPositions} open / ${s.totalClosedTrades} closed`);
  lines.push(`- realized PnL:    ${usd(s.totalRealizedPnlUsd)}`);
  lines.push(`- unrealized PnL:  ${usd(s.totalUnrealizedPnlUsd)}`);
  lines.push(`- total PnL:       ${usd(s.totalSimulatedPnlUsd)}`);
  lines.push(`- sim. notional:   ${usd(s.totalSimulatedNotionalUsd)}`);
  lines.push("");

  // Entries (input order).
  lines.push(`Entries (${index.entries.length}):`);
  if (index.entries.length === 0) lines.push("- (none)");
  else for (const e of index.entries) lines.push(entryLine(e));
  lines.push("");

  // Notes (required disclaimers).
  lines.push("Notes:");
  for (const note of index.notes) lines.push(`- ${note}`);
  for (const note of index.disclaimers) lines.push(`- ${note}`);

  return redactString(lines.join("\n"));
}
