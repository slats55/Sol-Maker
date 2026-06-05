/**
 * Assemble and render the advisory token risk report.
 *
 * `buildTokenRiskReport` is deterministic given an injectable clock; the
 * formatters render a stable human-readable block and the report object is
 * JSON-serializable as-is. All rendered output is passed through the security
 * redaction backstop — the report carries only public data, but redaction is a
 * cheap, defense-in-depth guarantee that no api-key/secret can ever slip out.
 *
 * Product language is deliberate: this is an ADVISORY, READ-ONLY risk report,
 * NOT a buy recommendation. `PASS_FOR_PAPER_EVALUATION` only means a mint may be
 * considered for *paper-trading* evaluation later — never that it is safe to
 * live trade.
 */

import { redactString } from "@soulmaker/security";
import { evaluateRiskFlags } from "./risk-flags.js";
import { scoreRiskFlags } from "./risk-score.js";
import type {
  RiskDecision,
  RiskFlag,
  TokenRiskInput,
  TokenRiskReport,
} from "./types.js";

export interface BuildRiskReportOptions {
  /** Injectable clock (ISO string) for deterministic output/tests. */
  now?: () => string;
}

const isoNow = (): string => new Date().toISOString();

export const RISK_DISCLAIMER =
  "Advisory READ-ONLY risk report. This is not a buy recommendation. " +
  "PASS_FOR_PAPER_EVALUATION does not mean safe to live-trade. " +
  "No transaction was built, signed, simulated, or sent.";

/** One-line, decision-specific guidance (advisory only). */
function decisionLine(decision: RiskDecision): string {
  switch (decision) {
    case "REJECT":
      return "Decision REJECT: do not proceed; one or more serious risks were found.";
    case "CAUTION":
      return "Decision CAUTION: notable risk — proceed only with care.";
    case "PASS_FOR_PAPER_EVALUATION":
      return (
        "Decision PASS_FOR_PAPER_EVALUATION: may proceed to paper-trading " +
        "evaluation later only. This is NOT a live-trading safety judgment."
      );
  }
}

/** Build the advisory risk report for a single mint. Deterministic with `now`. */
export function buildTokenRiskReport(
  input: TokenRiskInput,
  options: BuildRiskReportOptions = {},
): TokenRiskReport {
  const flags = evaluateRiskFlags(input);
  const { score, decision } = scoreRiskFlags(flags);

  const summary = [
    "This is an advisory READ-ONLY risk report — not a buy recommendation.",
    decisionLine(decision),
    "No transaction was built, signed, simulated, or sent.",
  ];

  return {
    mint: input.mint,
    score,
    decision,
    flags,
    summary,
    generatedAt: (options.now ?? isoNow)(),
    disclaimer: RISK_DISCLAIMER,
  };
}

function severityTag(flag: RiskFlag): string {
  return flag.severity.toUpperCase();
}

function renderEvidence(evidence: Record<string, unknown> | undefined): string {
  if (!evidence) return "";
  const parts = Object.entries(evidence).map(([k, v]) => `${k}=${formatValue(v)}`);
  return parts.join(", ");
}

function formatValue(value: unknown): string {
  if (value === null) return "unknown";
  if (typeof value === "string") return value;
  return String(value);
}

/**
 * Human-readable rendering of a risk report. Redacted as a backstop. Stable for
 * a given report (no clock/randomness beyond the report's own `generatedAt`).
 */
export function formatTokenRiskReport(report: TokenRiskReport): string {
  const lines: string[] = [];
  lines.push("Token risk report (READ-ONLY)");
  lines.push("-----------------------------");
  lines.push(`mint:        ${report.mint}`);
  lines.push(`decision:    ${report.decision}`);
  lines.push(`score:       ${report.score}/100`);
  lines.push(`generated:   ${report.generatedAt}`);
  lines.push("");

  lines.push("Flags:");
  if (report.flags.length === 0) {
    lines.push("- (none)");
  } else {
    for (const flag of report.flags) {
      lines.push(`- ${severityTag(flag)}: ${flag.title}`);
      lines.push(`  ${flag.detail}`);
      const evidence = renderEvidence(flag.evidence);
      if (evidence) lines.push(`  Evidence: ${evidence}`);
    }
  }
  lines.push("");

  lines.push("Summary:");
  for (const line of report.summary) lines.push(`- ${line}`);
  lines.push("");
  lines.push(report.disclaimer);

  return redactString(lines.join("\n"));
}
