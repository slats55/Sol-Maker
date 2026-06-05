/**
 * Human-readable rendering + JSON envelope for strategy reports, plus the fixed
 * paper-only / not-advice product language.
 *
 * Every rendered block is passed through the security redaction backstop and
 * carries the required statements: PAPER ONLY, not financial advice, not a buy
 * recommendation, not live-trading authorization, and "no transaction was built,
 * signed, simulated, or sent". The report object is JSON-serializable as-is.
 */

import { redactString } from "@soulmaker/security";
import type { StrategyReason, StrategyReport } from "./types.js";

export const STRATEGY_ONLY_BANNER = "PAPER ONLY — STRATEGY (SIMULATED)";

/**
 * The required product-language statements. Order is stable. These are echoed
 * into every {@link StrategyReport} so the language survives serialization.
 */
export const STRATEGY_NOTES: readonly string[] = [
  "PAPER ONLY: this strategy report only feeds simulated paper evaluation.",
  "This is not financial advice.",
  "This is not a buy recommendation.",
  "This is not live-trading authorization, and makes no profitability claim.",
  "A PAPER_BUY_CANDIDATE means a candidate for simulated paper evaluation, not a real buy.",
  "No transaction was built, signed, simulated, or sent.",
];

export const STRATEGY_DISCLAIMER =
  "PAPER ONLY — strategy output only feeds simulated paper evaluation. " +
  "Not financial advice. Not a buy recommendation. Not live-trading authorization. " +
  "A PAPER_BUY_CANDIDATE is a candidate for simulated paper evaluation, not a real buy. " +
  "No transaction was built, signed, simulated, or sent.";

function renderEvidence(evidence: Record<string, unknown> | undefined): string {
  if (!evidence) return "";
  const parts = Object.entries(evidence).map(([k, v]) => `${k}=${formatValue(v)}`);
  return parts.join(", ");
}

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "unknown";
  if (typeof value === "string") return value;
  return String(value);
}

function renderReason(r: StrategyReason): string[] {
  const lines = [`- ${r.id}: ${r.message}`];
  const evidence = renderEvidence(r.evidence);
  if (evidence) lines.push(`  Evidence: ${evidence}`);
  return lines;
}

/**
 * Render a redacted, human-readable PAPER-ONLY strategy report. Stable for a
 * given report (no clock/randomness beyond the report's own `createdAt`).
 */
export function formatStrategyReport(report: StrategyReport): string {
  const lines: string[] = [];
  lines.push(`Strategy evaluation (${STRATEGY_ONLY_BANNER})`);
  lines.push("-".repeat(`Strategy evaluation (${STRATEGY_ONLY_BANNER})`.length));
  lines.push(`mint:        ${report.mint}`);
  if (report.symbol !== undefined) lines.push(`symbol:      ${report.symbol}`);
  lines.push(`decision:    ${report.decision}`);
  lines.push(`score:       ${report.score}/100`);
  lines.push(
    `risk:        ${report.riskDecision} ` +
      `(risk score ${report.riskScore === null ? "n/a" : report.riskScore}/100)`,
  );
  if (report.source !== undefined) lines.push(`source:      ${report.source}`);
  lines.push(`created:     ${report.createdAt}`);
  lines.push("");

  lines.push("Reasons:");
  if (report.reasons.length === 0) {
    lines.push("- (none)");
  } else {
    for (const r of report.reasons) lines.push(...renderReason(r));
  }
  lines.push("");

  lines.push("Disqualifiers:");
  if (report.disqualifiers.length === 0) {
    lines.push("- (none)");
  } else {
    for (const r of report.disqualifiers) lines.push(...renderReason(r));
  }
  lines.push("");

  lines.push("Notes:");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  lines.push(report.disclaimer);

  return redactString(lines.join("\n"));
}

export interface StrategyReportEnvelope {
  banner: string;
  paperOnly: true;
  notFinancialAdvice: true;
  disclaimer: string;
  notes: string[];
  report: StrategyReport;
}

/**
 * A stable, JSON-serializable envelope for `--json` output. It always carries the
 * banner + disclaimer + notes so the required product language survives
 * serialization even if a consumer only reads the envelope's top level.
 */
export function buildStrategyEnvelope(report: StrategyReport): StrategyReportEnvelope {
  return {
    banner: STRATEGY_ONLY_BANNER,
    paperOnly: true,
    notFinancialAdvice: true,
    disclaimer: STRATEGY_DISCLAIMER,
    notes: [...STRATEGY_NOTES],
    report,
  };
}
