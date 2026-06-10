/**
 * Stable, machine-readable **SIMULATION REASON CODES** (Sprint 62 — the Phase 6 vocabulary).
 *
 * Every simulation artifact explains itself with codes from this closed union — never with prose
 * that downstream tooling would have to parse. The vocabulary is defined BEFORE the artifacts that
 * emit it so the artifacts can never invent ad-hoc strings. Same rules as the sniper decision
 * vocabulary:
 *
 *  - Codes are stable identifiers. NEVER rename or reuse one; add a new code instead.
 *  - Every code maps 1:1 to a branch the simulation pipeline actually takes. Codes are emitted by
 *    the SAME branches that produce the behavior — never re-derived from text.
 *  - `severity: "blocking"` — the condition stops simulation work (the plan/result is blocked).
 *  - `severity: "warning"`  — the condition degrades a preview/result but does not block the run.
 *  - `severity: "info"`     — an honest outcome marker.
 *
 * Codes are integrity/readiness explanations for a SIMULATION-only pipeline — never trading
 * advice, never a buy/sell signal, never a profitability claim. Pure data + pure lookups: no I/O,
 * no network, no wallet, no wall-clock.
 */

/** The categories a simulation reason code can belong to (stable, sorted). */
export const SIMULATION_REASON_CATEGORIES = [
  "audit",
  "dry-run",
  "input-artifact",
  "kill-switch",
  "outcome",
  "preview",
  "readiness",
  "spec",
] as const;

/** One of the stable simulation reason-code categories. */
export type SimulationReasonCategory = (typeof SIMULATION_REASON_CATEGORIES)[number];

/** A code's severity: blocking stops simulation work; warning degrades it; info marks an outcome. */
export const SIMULATION_REASON_SEVERITIES = ["blocking", "warning", "info"] as const;

/** One of the stable severities. */
export type SimulationReasonSeverity = (typeof SIMULATION_REASON_SEVERITIES)[number];

/** Every stable simulation reason code (closed union; append-only — never rename or reuse). */
export const SIMULATION_REASON_CODES = [
  // --- input-artifact (the v2 chain inputs themselves) ---
  "simulation-blocked-missing-decision-v2",
  "simulation-blocked-invalid-decision-v2",
  "simulation-blocked-missing-safety-gates-v2",
  "simulation-blocked-invalid-safety-gates-v2",
  "simulation-blocked-missing-prereqs-v2",
  "simulation-blocked-invalid-prereqs-v2",
  "simulation-blocked-v1-artifact",
  // --- readiness (validated inputs that say "not ready") ---
  "simulation-blocked-gates-not-ready",
  "simulation-blocked-prereqs-not-ready",
  "simulation-operator-acknowledged-paper-enter-review",
  // --- spec (governance specs: present? valid? adopted?) ---
  "simulation-blocked-missing-kill-switch-spec",
  "simulation-blocked-invalid-kill-switch-spec",
  "simulation-blocked-kill-switch-not-adopted",
  "simulation-blocked-missing-secrets-policy",
  "simulation-blocked-invalid-secrets-policy",
  "simulation-blocked-secrets-policy-not-adopted",
  "simulation-blocked-missing-burner-isolation",
  "simulation-blocked-invalid-burner-isolation",
  "simulation-blocked-burner-isolation-not-adopted",
  // --- kill-switch (an armed stop blocks simulation work) ---
  "simulation-blocked-kill-switch-stop",
  // --- preview (per-entry unknowns; honest, never invented) ---
  "simulation-preview-unresolved-destination",
  "simulation-preview-unresolved-amount",
  "simulation-preview-unresolved-fee",
  // --- dry-run (the safe adapter boundary) ---
  "simulation-dry-run-unavailable-safe-boundary",
  "simulation-dry-run-skipped-unresolved-preview",
  "simulation-dry-run-skipped-blocked-plan",
  "simulation-dry-run-failed-safely",
  "simulation-dry-run-completed-safely",
  // --- outcome (honest artifact-level markers) ---
  "simulation-plan-ready",
  "simulation-result-validated",
  // --- audit (Sprint 67: chain-audit findings; append-only) ---
  "audit-artifact-missing",
  "audit-artifact-invalid",
  "audit-v1-artifact",
  "audit-source-ref-mismatch",
  "audit-chain-complete",
  // --- readiness report (Sprint 69: phase6 simulation readiness; append-only) ---
  "simulation-readiness-missing-audit",
  "simulation-readiness-audit-failed",
  "simulation-readiness-chain-incomplete",
  "simulation-readiness-missing-plan",
  "simulation-readiness-missing-result",
  "simulation-readiness-evidence-missing",
  "simulation-readiness-chain-conditions-present",
  "simulation-readiness-green",
] as const;

/** One of the stable simulation reason codes. */
export type SimulationReasonCode = (typeof SIMULATION_REASON_CODES)[number];

/** The machine-readable definition of one simulation reason code. */
export interface SimulationReasonCodeDefinition {
  readonly code: SimulationReasonCode;
  readonly category: SimulationReasonCategory;
  readonly severity: SimulationReasonSeverity;
  /** True iff the condition stops simulation work (severity === "blocking"). */
  readonly blocking: boolean;
  /** True iff the condition degrades a preview/result without blocking (severity === "warning"). */
  readonly warning: boolean;
  /** One-line operator message (documentation only — never parsed by tooling). */
  readonly operatorMessage: string;
}

const def = (
  code: SimulationReasonCode,
  category: SimulationReasonCategory,
  severity: SimulationReasonSeverity,
  operatorMessage: string,
): SimulationReasonCodeDefinition => ({
  code,
  category,
  severity,
  blocking: severity === "blocking",
  warning: severity === "warning",
  operatorMessage,
});

/** The full, stable definition table (code → category/severity/operator message). */
export const SIMULATION_REASON_CODE_DEFINITIONS: Readonly<
  Record<SimulationReasonCode, SimulationReasonCodeDefinition>
> = {
  "simulation-blocked-missing-decision-v2": def("simulation-blocked-missing-decision-v2", "input-artifact", "blocking",
    "No v2 paper decision report was supplied — simulation has no decisions to preview. Build one with paper:sniper:decide --schema-version v2."),
  "simulation-blocked-invalid-decision-v2": def("simulation-blocked-invalid-decision-v2", "input-artifact", "blocking",
    "The supplied v2 paper decision report failed strict validation — fix or rebuild it before simulating."),
  "simulation-blocked-missing-safety-gates-v2": def("simulation-blocked-missing-safety-gates-v2", "input-artifact", "blocking",
    "No v2 safety gates report was supplied — simulation requires a READY gates report. Build one with paper:sniper:gates --schema-version v2."),
  "simulation-blocked-invalid-safety-gates-v2": def("simulation-blocked-invalid-safety-gates-v2", "input-artifact", "blocking",
    "The supplied v2 safety gates report failed strict validation — fix or rebuild it before simulating."),
  "simulation-blocked-missing-prereqs-v2": def("simulation-blocked-missing-prereqs-v2", "input-artifact", "blocking",
    "No v2 Phase-6 prerequisite report was supplied — simulation requires the prerequisite tracker. Build one with paper:sniper:phase6:prereqs --schema-version v2."),
  "simulation-blocked-invalid-prereqs-v2": def("simulation-blocked-invalid-prereqs-v2", "input-artifact", "blocking",
    "The supplied v2 Phase-6 prerequisite report failed strict validation — fix or rebuild it before simulating."),
  "simulation-blocked-v1-artifact": def("simulation-blocked-v1-artifact", "input-artifact", "blocking",
    "A v1 artifact was supplied where the simulation pipeline requires v2 — rebuild the artifact with --schema-version v2."),
  "simulation-blocked-gates-not-ready": def("simulation-blocked-gates-not-ready", "readiness", "blocking",
    "The v2 safety gates report is valid but NOT ready (a required gate failed) — resolve the failures before simulating."),
  "simulation-blocked-prereqs-not-ready": def("simulation-blocked-prereqs-not-ready", "readiness", "blocking",
    "The v2 Phase-6 prerequisite report is valid but not every readiness bucket is met — resolve the not-met items before simulating. (When the ONLY unmet item is NO_OPERATOR_BLOCKING caused by paper-enters awaiting review, an explicit operator acknowledgment may stand in for that one review item.)"),
  "simulation-operator-acknowledged-paper-enter-review": def("simulation-operator-acknowledged-paper-enter-review", "readiness", "warning",
    "The operator EXPLICITLY acknowledged reviewing the paper-enters that kept NO_OPERATOR_BLOCKING unmet — this narrow, surfaced override covers ONLY that single review item and never any other readiness gap."),
  "simulation-blocked-missing-kill-switch-spec": def("simulation-blocked-missing-kill-switch-spec", "spec", "blocking",
    "No kill-switch spec was supplied — simulation requires the adopted spec. Build one with paper:sniper:kill-switch:spec."),
  "simulation-blocked-invalid-kill-switch-spec": def("simulation-blocked-invalid-kill-switch-spec", "spec", "blocking",
    "The supplied kill-switch spec failed strict validation — fix or rebuild it before simulating."),
  "simulation-blocked-kill-switch-not-adopted": def("simulation-blocked-kill-switch-not-adopted", "spec", "blocking",
    "The kill-switch spec is valid but not ADOPTED — adopt it (readinessStatus: adopted) before simulating."),
  "simulation-blocked-missing-secrets-policy": def("simulation-blocked-missing-secrets-policy", "spec", "blocking",
    "No secrets policy was supplied — simulation requires the adopted policy. Build one with paper:sniper:secrets:policy."),
  "simulation-blocked-invalid-secrets-policy": def("simulation-blocked-invalid-secrets-policy", "spec", "blocking",
    "The supplied secrets policy failed strict validation — fix or rebuild it before simulating."),
  "simulation-blocked-secrets-policy-not-adopted": def("simulation-blocked-secrets-policy-not-adopted", "spec", "blocking",
    "The secrets policy is valid but not ADOPTED — adopt it (readinessStatus: adopted) before simulating."),
  "simulation-blocked-missing-burner-isolation": def("simulation-blocked-missing-burner-isolation", "spec", "blocking",
    "No burner isolation spec was supplied — simulation requires the adopted spec. Build one with paper:sniper:burner:isolation:spec."),
  "simulation-blocked-invalid-burner-isolation": def("simulation-blocked-invalid-burner-isolation", "spec", "blocking",
    "The supplied burner isolation spec failed strict validation — fix or rebuild it before simulating."),
  "simulation-blocked-burner-isolation-not-adopted": def("simulation-blocked-burner-isolation-not-adopted", "spec", "blocking",
    "The burner isolation spec is valid but not ADOPTED — adopt it (readinessStatus: adopted) before simulating."),
  "simulation-blocked-kill-switch-stop": def("simulation-blocked-kill-switch-stop", "kill-switch", "blocking",
    "The operator declared the stop-simulation kill-switch mode tripped — no simulation work may proceed until it is explicitly reset."),
  "simulation-preview-unresolved-destination": def("simulation-preview-unresolved-destination", "preview", "warning",
    "This entry's destination preview is UNRESOLVED — no validated route/pool data exists and the pipeline never invents one."),
  "simulation-preview-unresolved-amount": def("simulation-preview-unresolved-amount", "preview", "warning",
    "This entry's amount preview is UNRESOLVED — paper amounts are labels/unit counts, never currency, and the pipeline never invents a real amount."),
  "simulation-preview-unresolved-fee": def("simulation-preview-unresolved-fee", "preview", "warning",
    "This entry's fee preview is UNRESOLVED — no validated fee data exists and the pipeline never invents one."),
  "simulation-dry-run-unavailable-safe-boundary": def("simulation-dry-run-unavailable-safe-boundary", "dry-run", "warning",
    "A real on-chain dry-run needs transaction material this package is structurally forbidden from building — the dry-run is honestly UNAVAILABLE, not faked."),
  "simulation-dry-run-skipped-unresolved-preview": def("simulation-dry-run-skipped-unresolved-preview", "dry-run", "warning",
    "The dry-run was skipped for this entry because its preview has unresolved fields — nothing is simulated from invented values."),
  "simulation-dry-run-skipped-blocked-plan": def("simulation-dry-run-skipped-blocked-plan", "dry-run", "blocking",
    "The dry-run was skipped because the source intent plan is BLOCKED — resolve the plan's blocking reasons first."),
  "simulation-dry-run-failed-safely": def("simulation-dry-run-failed-safely", "dry-run", "warning",
    "The dry-run adapter reported a failure; it was captured as a safe, redacted result — nothing was signed or sent."),
  "simulation-dry-run-completed-safely": def("simulation-dry-run-completed-safely", "dry-run", "info",
    "The dry-run adapter completed within the safe boundary — nothing was signed or sent."),
  "simulation-plan-ready": def("simulation-plan-ready", "outcome", "info",
    "The intent plan carries no blocking reason — it is ready for SIMULATION ONLY (never live work)."),
  "simulation-result-validated": def("simulation-result-validated", "outcome", "info",
    "The simulation result artifact passed strict validation, including its literal safety locks."),
  "audit-artifact-missing": def("audit-artifact-missing", "audit", "warning",
    "A chain artifact was not supplied to the audit — the chain is incomplete until every artifact is present and valid."),
  "audit-artifact-invalid": def("audit-artifact-invalid", "audit", "blocking",
    "A supplied chain artifact failed its strict production validator — fix or rebuild it; an invalid artifact fails the audit."),
  "audit-v1-artifact": def("audit-v1-artifact", "audit", "blocking",
    "A v1 artifact was supplied where the audited chain requires v2 — rebuild it with --schema-version v2; a v1 stand-in fails the audit."),
  "audit-source-ref-mismatch": def("audit-source-ref-mismatch", "audit", "blocking",
    "Two chain artifacts disagree on a structured source reference (label/count/blocked state) — they were not built from the same chain; the audit fails."),
  "audit-chain-complete": def("audit-chain-complete", "audit", "info",
    "Every audited chain artifact is present and strictly valid."),
  "simulation-readiness-missing-audit": def("simulation-readiness-missing-audit", "readiness", "blocking",
    "No valid phase6 chain audit was supplied — Phase 6 simulation readiness cannot be claimed without an audited chain. Build one with paper:simulation:audit."),
  "simulation-readiness-audit-failed": def("simulation-readiness-audit-failed", "readiness", "blocking",
    "The supplied chain audit FAILED (blocking findings) — fix the chain and re-audit before claiming readiness."),
  "simulation-readiness-chain-incomplete": def("simulation-readiness-chain-incomplete", "readiness", "blocking",
    "The audited chain is incomplete (artifacts missing or invalid) — a partial chain cannot evidence readiness."),
  "simulation-readiness-missing-plan": def("simulation-readiness-missing-plan", "readiness", "blocking",
    "No valid simulation intent plan was supplied — the readiness report needs the plan it claims readiness over."),
  "simulation-readiness-missing-result": def("simulation-readiness-missing-result", "readiness", "blocking",
    "No valid simulation result was supplied — the readiness report needs the result it claims readiness over."),
  "simulation-readiness-evidence-missing": def("simulation-readiness-evidence-missing", "readiness", "blocking",
    "A required evidence area has no declared reference — declare where the evidence lives (test file / doc path) or readiness cannot be claimed."),
  "simulation-readiness-chain-conditions-present": def("simulation-readiness-chain-conditions-present", "readiness", "warning",
    "The audited chain carries blocking conditions of its own (surfaced verbatim) — the simulation STACK works, but this session's chain is not condition-free."),
  "simulation-readiness-green": def("simulation-readiness-green", "readiness", "info",
    "Every artifact check passed and every required evidence area is declared — Phase 6 SIMULATION is structurally ready. This is never live-trading readiness; Phase 7 remains unauthorized."),
};

const CODE_SET: ReadonlySet<string> = new Set(SIMULATION_REASON_CODES);

/** True iff `value` is one of the stable simulation reason codes. Pure. */
export function isSimulationReasonCode(value: unknown): value is SimulationReasonCode {
  return typeof value === "string" && CODE_SET.has(value);
}

/** Look up a code's definition. Pure. */
export function simulationReasonCodeDefinition(code: SimulationReasonCode): SimulationReasonCodeDefinition {
  return SIMULATION_REASON_CODE_DEFINITIONS[code];
}

/** True iff the code blocks simulation work. Pure. */
export function isBlockingSimulationReasonCode(code: SimulationReasonCode): boolean {
  return SIMULATION_REASON_CODE_DEFINITIONS[code].blocking;
}

/** Dedupe a code trail preserving FIRST occurrence (emission/trail order). Pure, non-mutating. */
export function dedupeSimulationReasonCodes(codes: readonly SimulationReasonCode[]): SimulationReasonCode[] {
  const seen = new Set<SimulationReasonCode>();
  const out: SimulationReasonCode[] = [];
  for (const code of codes) {
    if (!seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}
