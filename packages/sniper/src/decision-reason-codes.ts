/**
 * Stable, machine-readable **DECISION REASON CODES** for the PAPER-only sniper pipeline (Sprint 46).
 *
 * The v1 decision report explains every decision with free-text `reasons` strings. Those strings are
 * great for an operator but are NOT a machine surface — downstream tooling must never parse them. This
 * module is the versioned vocabulary that fixes that: a closed union of stable reason CODES, each with
 * a category and conservative classification flags, emitted by the SAME branches that produce the
 * decisions (never re-derived from text).
 *
 * Codes are integrity/risk explanations for a SIMULATED, paper-only decision — never trading advice,
 * never a buy/sell signal, never a profitability claim. This module is pure data + pure lookups: no
 * I/O, no network, no wallet, no wall-clock.
 *
 * Vocabulary rules:
 *  - Codes are stable identifiers. NEVER rename or reuse one; add a new code instead.
 *  - Every code maps 1:1 to a branch that actually exists in `paper-decision.ts` /
 *    `policy-config.ts` enforcement. Unreachable states get no code (e.g. an "invalid candidate"
 *    cannot reach a decision — the candidate-list validator refuses it first).
 *  - `blocking` = the code marks a cause/outcome that kept the candidate OUT (skip / paper-reject).
 *  - `warning`  = the code marks a soft hold / caution (watch, a downgrade, or missing data).
 *  - Neither flag = an informational/outcome marker.
 */

/** The categories a reason code can belong to (stable, sorted). */
export const SNIPER_DECISION_REASON_CATEGORIES = [
  "decision",
  "liquidity",
  "policy",
  "preflight",
  "risk",
  "structural",
] as const;

/** One of the stable reason-code categories. */
export type SniperDecisionReasonCategory = (typeof SNIPER_DECISION_REASON_CATEGORIES)[number];

/** Every stable reason code (closed union; append-only — never rename or reuse). */
export const SNIPER_DECISION_REASON_CODES = [
  // --- structural (candidate/list shape) ---
  "invalid-mint",
  "duplicate-mints-present",
  // --- preflight (status of the supplied preflight data) ---
  "missing-preflight",
  "missing-preflight-report",
  "preflight-fail",
  "preflight-warning",
  "preflight-unknown",
  "preflight-status-unrecognized",
  // --- risk (advisory risk data) ---
  "risk-blocked",
  "risk-score-exceeds-cap",
  "risk-missing",
  // --- liquidity (observed-liquidity entry rules) ---
  "liquidity-unknown",
  "liquidity-below-floor",
  // --- policy (operator rules + tighten-only policy enforcement) ---
  "operator-denylist-mint",
  "policy-duplicate-mint",
  "policy-disallowed-risk-flag",
  "policy-fail-closed-unknown-preflight",
  "policy-fail-closed-missing-risk",
  "policy-paper-enter-disabled",
  "policy-paper-enter-cap-exceeded",
  "policy-allowed-paper-enter",
  "policy-max-candidates-per-run-exceeded",
  // --- policy v2 risk limits (Sprint 48; append-only) ---
  "policy-disallowed-preflight-status",
  "policy-max-warnings-exceeded",
  "policy-missing-risk",
  "policy-missing-inspection",
  "policy-disallowed-reason-code",
  // --- decision (outcome markers; one per final decision) ---
  "skip-candidate",
  "watch-candidate",
  "paper-enter-candidate",
  "paper-reject-candidate",
  "unknown-candidate",
  "watched-incomplete-info",
] as const;

/** One of the stable reason codes. */
export type SniperDecisionReasonCode = (typeof SNIPER_DECISION_REASON_CODES)[number];

/** The machine-readable definition of one reason code. */
export interface SniperDecisionReasonCodeDefinition {
  readonly code: SniperDecisionReasonCode;
  readonly category: SniperDecisionReasonCategory;
  /** Whether the code is emitted per candidate or once per report. */
  readonly scope: "candidate" | "report";
  /** The code marks a cause/outcome that kept the candidate out (skip / paper-reject). */
  readonly blocking: boolean;
  /** The code marks a soft hold / caution (watch, a downgrade, or missing data). */
  readonly warning: boolean;
  /** The code was produced by an operator rule or tighten-only policy enforcement. */
  readonly policyDriven: boolean;
  /** The code is about advisory risk data (presence, score, or flags). */
  readonly riskRelated: boolean;
  /** One-line human description (documentation only — never parsed). */
  readonly description: string;
}

const def = (
  code: SniperDecisionReasonCode,
  category: SniperDecisionReasonCategory,
  scope: "candidate" | "report",
  flags: { blocking?: boolean; warning?: boolean; policyDriven?: boolean; riskRelated?: boolean },
  description: string,
): SniperDecisionReasonCodeDefinition => ({
  code,
  category,
  scope,
  blocking: flags.blocking ?? false,
  warning: flags.warning ?? false,
  policyDriven: flags.policyDriven ?? false,
  riskRelated: flags.riskRelated ?? false,
  description,
});

/** The full, stable definition table (code → category/scope/classification/description). */
export const SNIPER_DECISION_REASON_CODE_DEFINITIONS: Readonly<
  Record<SniperDecisionReasonCode, SniperDecisionReasonCodeDefinition>
> = {
  "invalid-mint": def("invalid-mint", "structural", "candidate", { blocking: true },
    "The preflight marked this candidate's mint as not a valid 32-byte Solana public key — skipped."),
  "duplicate-mints-present": def("duplicate-mints-present", "structural", "report", { warning: true },
    "The run contains duplicate mints (surfaced by the policy's duplicate-mint warn mode)."),
  "missing-preflight": def("missing-preflight", "preflight", "candidate", { warning: true },
    "No preflight data covered this candidate — conservatively watched."),
  "missing-preflight-report": def("missing-preflight-report", "preflight", "report", { warning: true },
    "No preflight report was supplied for the run — every candidate is conservatively watched."),
  "preflight-fail": def("preflight-fail", "preflight", "candidate", { blocking: true },
    "The preflight FAILED this candidate (a disqualifier was found) — paper-rejected."),
  "preflight-warning": def("preflight-warning", "preflight", "candidate", { warning: true },
    "The preflight WARNED on this candidate — watched."),
  "preflight-unknown": def("preflight-unknown", "preflight", "candidate", { warning: true },
    "The preflight could not assess this candidate (no inspection/risk data) — watched."),
  "preflight-status-unrecognized": def("preflight-status-unrecognized", "preflight", "candidate", { warning: true },
    "The preflight carried an unrecognized status — decision fell back to unknown."),
  "risk-blocked": def("risk-blocked", "risk", "candidate", { blocking: true, riskRelated: true },
    "The candidate was paper-rejected and risk flags contributed to the rejection."),
  "risk-score-exceeds-cap": def("risk-score-exceeds-cap", "risk", "candidate", { blocking: true, riskRelated: true },
    "The supplied risk score exceeds the operator's maxRiskScore cap — paper-rejected."),
  "risk-missing": def("risk-missing", "risk", "candidate", { warning: true, riskRelated: true },
    "No advisory risk data was supplied where a rule or entry evaluation wanted it."),
  "liquidity-unknown": def("liquidity-unknown", "liquidity", "candidate", { warning: true },
    "A minimum-liquidity rule is set but the candidate carries no observed liquidity — watched."),
  "liquidity-below-floor": def("liquidity-below-floor", "liquidity", "candidate", { warning: true },
    "Observed liquidity is below the operator's minObservedLiquidityUsd floor — watched."),
  "operator-denylist-mint": def("operator-denylist-mint", "policy", "candidate", { blocking: true, policyDriven: true },
    "The mint is on the operator denylist — skipped before evaluation."),
  "policy-duplicate-mint": def("policy-duplicate-mint", "policy", "candidate", { blocking: true, policyDriven: true },
    "The policy's duplicate-mint mode is reject and this mint appears more than once — skipped."),
  "policy-disallowed-risk-flag": def("policy-disallowed-risk-flag", "policy", "candidate", { blocking: true, policyDriven: true, riskRelated: true },
    "The candidate's preflight risk carries a flag the policy disallows — paper-rejected."),
  "policy-fail-closed-unknown-preflight": def("policy-fail-closed-unknown-preflight", "policy", "candidate", { blocking: true, policyDriven: true },
    "The policy fails closed on a candidate the preflight could not assess — paper-rejected."),
  "policy-fail-closed-missing-risk": def("policy-fail-closed-missing-risk", "policy", "candidate", { warning: true, policyDriven: true, riskRelated: true },
    "The policy fails closed on a paper-enter with no supplied risk data — downgraded to watch."),
  "policy-paper-enter-disabled": def("policy-paper-enter-disabled", "policy", "candidate", { warning: true, policyDriven: true },
    "The policy disables paper-enter — the simulated entry was downgraded to watch."),
  "policy-paper-enter-cap-exceeded": def("policy-paper-enter-cap-exceeded", "policy", "candidate", { warning: true, policyDriven: true },
    "The policy's paper-enter cap was already reached — the simulated entry was downgraded to watch."),
  "policy-allowed-paper-enter": def("policy-allowed-paper-enter", "policy", "candidate", { policyDriven: true },
    "A policy was applied and this SIMULATED paper-enter survived every tighten-only check."),
  "policy-max-candidates-per-run-exceeded": def("policy-max-candidates-per-run-exceeded", "policy", "report", { warning: true, policyDriven: true },
    "The run has more candidates than the policy's maxCandidatesPerRun (flagged, never truncated)."),
  "policy-disallowed-preflight-status": def("policy-disallowed-preflight-status", "policy", "candidate", { blocking: true, policyDriven: true },
    "The candidate's preflight status is on the policy v2 disallowed list — paper-rejected."),
  "policy-max-warnings-exceeded": def("policy-max-warnings-exceeded", "policy", "candidate", { warning: true, policyDriven: true },
    "The candidate's preflight warning count exceeds the policy v2 cap — a paper-enter was downgraded to watch."),
  "policy-missing-risk": def("policy-missing-risk", "policy", "candidate", { warning: true, policyDriven: true, riskRelated: true },
    "The policy v2 requires risk data and this candidate has none — surfaced (and any paper-enter downgraded)."),
  "policy-missing-inspection": def("policy-missing-inspection", "policy", "candidate", { warning: true, policyDriven: true },
    "The policy v2 requires inspection data and this candidate has none — surfaced (and any paper-enter downgraded)."),
  "policy-disallowed-reason-code": def("policy-disallowed-reason-code", "policy", "candidate", { blocking: true, policyDriven: true },
    "The candidate's reason-code trail contains a code the policy v2 disallows — paper-rejected."),
  "skip-candidate": def("skip-candidate", "decision", "candidate", {},
    "Outcome marker: the final decision is skip."),
  "watch-candidate": def("watch-candidate", "decision", "candidate", {},
    "Outcome marker: the final decision is watch."),
  "paper-enter-candidate": def("paper-enter-candidate", "decision", "candidate", {},
    "Outcome marker: the final decision is a SIMULATED, paper-only enter (never a buy order)."),
  "paper-reject-candidate": def("paper-reject-candidate", "decision", "candidate", {},
    "Outcome marker: the final decision is paper-reject (an integrity/risk decision, never a sell order)."),
  "unknown-candidate": def("unknown-candidate", "decision", "candidate", { warning: true },
    "Outcome marker: the decision fell back to unknown (defensive)."),
  "watched-incomplete-info": def("watched-incomplete-info", "decision", "candidate", { warning: true },
    "The candidate is watched because the available information was incomplete."),
};

const CODE_SET: ReadonlySet<string> = new Set(SNIPER_DECISION_REASON_CODES);

/** True iff `value` is one of the stable reason codes. Pure. */
export function isSniperDecisionReasonCode(value: unknown): value is SniperDecisionReasonCode {
  return typeof value === "string" && CODE_SET.has(value);
}

/** Look up a code's definition. Pure. */
export function sniperDecisionReasonCodeDefinition(
  code: SniperDecisionReasonCode,
): SniperDecisionReasonCodeDefinition {
  return SNIPER_DECISION_REASON_CODE_DEFINITIONS[code];
}

/** Dedupe a code trail preserving FIRST occurrence (emission/trail order). Pure, non-mutating. */
export function dedupeSniperDecisionReasonCodes(
  codes: readonly SniperDecisionReasonCode[],
): SniperDecisionReasonCode[] {
  const seen = new Set<SniperDecisionReasonCode>();
  const out: SniperDecisionReasonCode[] = [];
  for (const code of codes) {
    if (!seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}
