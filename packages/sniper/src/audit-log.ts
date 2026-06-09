/**
 * Deterministic, offline, **PAPER-only** SNIPER AUDIT LOG (Phase 5+ provenance record).
 *
 * Before any Phase 6 simulation can be contemplated, a paper sniper run must leave a deterministic,
 * inspectable **audit trail**: which steps ran, what each consumed and produced, and what it concluded.
 * This module builds that trail from a single, already-built run report (`sniper.run.report.v1`): one
 * audit entry per pipeline step (candidate intake → token preflight → paper decision → run report), each
 * with input/output artifact LABELS, a one-line decision summary, the step's warnings + failures, and
 * redactable notes.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work — the CLI loads the run report and
 * hands the parsed value here. Crucially it carries **NO wall-clock time**: every "when" is an
 * operator-supplied LABEL (a string), never `Date.now()`; the same run report + label yield a
 * byte-identical log. The package carries no chain capability.
 *
 * An audit log is bookkeeping over a SIMULATED, paper-only run — never a live result, an order, or a
 * profitability claim. Nothing here holds a key or builds/signs/sends a transaction.
 */

import { redactString } from "@soulmaker/security";
import { validateSniperRunReport, type SniperRunReport } from "./run-report.js";

/** Stable schema identifier for the audit log. Bump only on a breaking change. */
export const SNIPER_AUDIT_LOG_SCHEMA_VERSION = "sniper.audit.log.v1";

/** The banner that prefixes every audit log (required label). */
export const SNIPER_AUDIT_LOG_BANNER = "SIMULATED PAPER-ONLY SNIPER AUDIT LOG";

/** Required disclaimer statements carried by every audit log (stable order). */
export const SNIPER_AUDIT_LOG_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SNIPER AUDIT LOG — a deterministic, step-by-step provenance record of a paper sniper run, derived from its run report.",
  "It carries NO wall-clock time: every run/step label is operator-supplied (a string), never system time, so the same run report yields a byte-identical log.",
  "It bundles ALREADY-BUILT local data and re-derives nothing — each step's summary is read VERBATIM from the run report.",
  "A `paper-enter` recorded here is a SIMULATED classification — NOT a buy/sell order, NOT a transaction, and NOT live-trading readiness.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this log.",
];

/** Thrown when audit-log INPUT or a produced log is structurally invalid. */
export class SniperAuditLogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperAuditLogError";
  }
}

// --- model -------------------------------------------------------------------

/** The pipeline step kinds, in run order. */
export type SniperAuditStepKind =
  | "candidate-intake"
  | "token-preflight"
  | "paper-decision"
  | "run-report";

/** One audit entry: a single pipeline step's inputs, outputs, summary, and outcome. */
export interface SniperAuditEntry {
  /** Stable id for this step (operator-meaningful, e.g. "intake"). */
  stepId: string;
  /** The step's category. */
  stepKind: SniperAuditStepKind;
  /** Whether the step actually ran in this run (a recommended-but-absent step is recorded as not-run). */
  ran: boolean;
  /** Labels of the artifacts this step consumed (stable order). */
  inputArtifactLabels: string[];
  /** Labels of the artifacts this step produced (stable order). */
  outputArtifactLabels: string[];
  /** A one-line, deterministic summary of what the step concluded (null when it did not run). */
  decisionSummary: string | null;
  /** The step's warnings (soft concerns). */
  warnings: string[];
  /** The step's failures (hard concerns — invalid candidate, preflight fail, risk block, …). */
  failures: string[];
  /** Redactable notes for this step. */
  notes: string[];
}

/** The full, deterministic, JSON-serializable audit log. */
export interface SniperAuditLog {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  /** Operator-supplied run label (a string, never system time). */
  runLabel: string | null;
  /** The run report's source label, echoed. */
  sourceLabel: string | null;
  candidateCount: number;
  stepCount: number;
  steps: SniperAuditEntry[];
  // --- aggregate signals (read verbatim from the run report) ---
  hasFailure: boolean;
  hasWarning: boolean;
  hasPaperEnter: boolean;
  hasRiskBlock: boolean;
  hasUnknown: boolean;
  hasMissingRecommendedArtifact: boolean;
  warnings: string[];
  notes: string[];
}

/** Everything {@link buildSniperAuditLog} needs. */
export interface BuildSniperAuditLogInput {
  /** A canonical `sniper.run.report.v1` (strictly validated). */
  runReport: unknown;
  /** Operator-supplied run label (a string only — never system time). */
  runLabel?: string | null;
  /** Operator-supplied notes appended to the log. */
  notes?: string[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function optStringArray(value: unknown, name: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((x) => typeof x !== "string")) {
    throw new SniperAuditLogError(`audit log input.${name} must be an array of strings when present`);
  }
  return (value as string[]).map((s) => s.trim()).filter((s) => s.length > 0);
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link SniperAuditLog} from a run report. Pure and non-mutating. The run report
 * is STRICTLY validated. One entry is emitted per pipeline step; a recommended-but-absent step
 * (preflight / decision) is recorded with `ran: false` rather than omitted, so the trail is complete.
 * Every summary / warning / failure is read VERBATIM from the run report. Carries NO wall-clock time —
 * `runLabel` is an operator-supplied string. Throws {@link SniperAuditLogError} on invalid input.
 */
export function buildSniperAuditLog(input: BuildSniperAuditLogInput): SniperAuditLog {
  if (!isObject(input)) throw new SniperAuditLogError("audit log input must be an object");
  let report: SniperRunReport;
  try {
    report = validateSniperRunReport(input.runReport);
  } catch (err) {
    throw new SniperAuditLogError(`run report is invalid: ${(err as Error).message}`);
  }
  if (input.runLabel !== undefined && input.runLabel !== null && typeof input.runLabel !== "string") {
    throw new SniperAuditLogError("audit log input.runLabel must be a string or null when present");
  }
  const operatorNotes = optStringArray(input.notes, "notes");

  const steps: SniperAuditEntry[] = [];

  // 1) candidate intake — always ran (the run report has a candidate list spine).
  steps.push({
    stepId: "intake",
    stepKind: "candidate-intake",
    ran: true,
    inputArtifactLabels: [],
    outputArtifactLabels: ["candidate-list"],
    decisionSummary: `${report.candidateCount} candidate(s)`,
    warnings: [],
    failures: report.invalidCandidateIds.length > 0 ? [`${report.invalidCandidateIds.length} invalid candidate(s): ${report.invalidCandidateIds.join(", ")}`] : [],
    notes: [],
  });

  // 2) token preflight — ran iff the run report carried a preflight.
  const pfRan = report.artifactsPresent.preflight && report.preflightSummary !== null;
  steps.push({
    stepId: "preflight",
    stepKind: "token-preflight",
    ran: pfRan,
    inputArtifactLabels: ["candidate-list"],
    outputArtifactLabels: pfRan ? ["preflight-report"] : [],
    decisionSummary: pfRan && report.preflightSummary
      ? `${report.preflightSummary.passCount} pass / ${report.preflightSummary.warnCount} warn / ${report.preflightSummary.failCount} fail / ${report.preflightSummary.unknownCount} unknown`
      : null,
    warnings: pfRan ? [] : ["preflight not run — recommended artifact absent"],
    failures: report.preflightFailedIds.length > 0 ? [`${report.preflightFailedIds.length} candidate(s) failed preflight: ${report.preflightFailedIds.join(", ")}`] : [],
    notes: [],
  });

  // 3) paper decision — ran iff the run report carried a decision report.
  const decRan = report.artifactsPresent.decision && report.decisionSummary !== null;
  const riskFailures: string[] = [];
  if (report.riskBlockedIds.length > 0) riskFailures.push(`${report.riskBlockedIds.length} candidate(s) blocked on risk: ${report.riskBlockedIds.join(", ")}`);
  steps.push({
    stepId: "decide",
    stepKind: "paper-decision",
    ran: decRan,
    inputArtifactLabels: pfRan ? ["candidate-list", "preflight-report"] : ["candidate-list"],
    outputArtifactLabels: decRan ? ["decision-report"] : [],
    decisionSummary: decRan && report.decisionSummary
      ? `${report.decisionSummary.paperEnterCount} paper-enter / ${report.decisionSummary.watchCount} watch / ${report.decisionSummary.skipCount} skip / ${report.decisionSummary.paperRejectCount} paper-reject / ${report.decisionSummary.unknownCount} unknown`
      : null,
    warnings: decRan ? [] : ["paper decision not run — recommended artifact absent"],
    failures: riskFailures,
    notes: decRan && report.hasPaperEnter ? [`${report.paperEnterIds.length} SIMULATED paper-enter(s) — not an order: ${report.paperEnterIds.join(", ")}`] : [],
  });

  // 4) run report — the bundling/summary step (always ran; it is the input here). Its genuine failures
  //    already live in the intake/preflight/decide steps, so it carries the run report's own warnings
  //    (e.g. a missing recommended artifact) rather than re-dumping failReasons — no double-counting, and
  //    an incomplete run reads as a WARNING, not a failure.
  steps.push({
    stepId: "report",
    stepKind: "run-report",
    ran: true,
    inputArtifactLabels: [
      "candidate-list",
      ...(pfRan ? ["preflight-report"] : []),
      ...(decRan ? ["decision-report"] : []),
      ...(report.artifactsPresent.workflow ? ["workflow-plan"] : []),
    ],
    outputArtifactLabels: ["run-report"],
    decisionSummary: `paper-enter ${report.hasPaperEnter ? "YES" : "no"}, risk-block ${report.hasRiskBlock ? "YES" : "no"}, unknown ${report.hasUnknown ? "YES" : "no"}`,
    warnings: [...report.warnings],
    failures: [],
    notes: [],
  });

  const hasFailure = steps.some((s) => s.failures.length > 0);
  const hasWarning = steps.some((s) => s.warnings.length > 0);

  const logWarnings: string[] = [];
  if (report.hasMissingRecommendedArtifact) {
    logWarnings.push("run is missing a recommended artifact (preflight and/or decision) — the audit trail is incomplete.");
  }

  const notes = [
    `${steps.filter((s) => s.ran).length}/${steps.length} step(s) ran for ${report.candidateCount} candidate(s).`,
    "Deterministic provenance over a SIMULATED paper run — no wall-clock time, no live result, no order.",
    ...operatorNotes,
  ];

  return {
    schemaVersion: SNIPER_AUDIT_LOG_SCHEMA_VERSION,
    banner: SNIPER_AUDIT_LOG_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...SNIPER_AUDIT_LOG_DISCLAIMERS],
    runLabel: nonEmptyString(input.runLabel) ? input.runLabel : null,
    sourceLabel: report.sourceLabel,
    candidateCount: report.candidateCount,
    stepCount: steps.length,
    steps,
    hasFailure,
    hasWarning,
    hasPaperEnter: report.hasPaperEnter,
    hasRiskBlock: report.hasRiskBlock,
    hasUnknown: report.hasUnknown,
    hasMissingRecommendedArtifact: report.hasMissingRecommendedArtifact,
    warnings: logWarnings,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

const STEP_KINDS: ReadonlySet<string> = new Set(["candidate-intake", "token-preflight", "paper-decision", "run-report"]);

function validateEntry(value: unknown, where: string): void {
  if (!isObject(value)) throw new SniperAuditLogError(`${where} must be an object`);
  if (!nonEmptyString(value.stepId)) throw new SniperAuditLogError(`${where}.stepId must be a non-empty string`);
  if (typeof value.stepKind !== "string" || !STEP_KINDS.has(value.stepKind)) {
    throw new SniperAuditLogError(`${where}.stepKind must be candidate-intake|token-preflight|paper-decision|run-report`);
  }
  if (typeof value.ran !== "boolean") throw new SniperAuditLogError(`${where}.ran must be a boolean`);
  if (value.decisionSummary !== null && typeof value.decisionSummary !== "string") {
    throw new SniperAuditLogError(`${where}.decisionSummary must be a string or null`);
  }
  for (const f of ["inputArtifactLabels", "outputArtifactLabels", "warnings", "failures", "notes"] as const) {
    if (!Array.isArray(value[f]) || (value[f] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperAuditLogError(`${where}.${f} must be an array of strings`);
    }
  }
}

/**
 * Strictly validate a value as a {@link SniperAuditLog} and return it narrowed. A backstop mirroring the
 * package's sibling validators. Throws {@link SniperAuditLogError} on the first problem. Pure.
 */
export function validateSniperAuditLog(value: unknown): SniperAuditLog {
  if (!isObject(value)) throw new SniperAuditLogError("audit log must be a JSON object");
  if (value.schemaVersion !== SNIPER_AUDIT_LOG_SCHEMA_VERSION) {
    throw new SniperAuditLogError(`audit log.schemaVersion must be "${SNIPER_AUDIT_LOG_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_AUDIT_LOG_BANNER) {
    throw new SniperAuditLogError(`audit log.banner must be "${SNIPER_AUDIT_LOG_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new SniperAuditLogError(`audit log.${flag} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperAuditLogError("audit log.disclaimers must be a non-empty array");
  }
  for (const f of ["runLabel", "sourceLabel"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new SniperAuditLogError(`audit log.${f} must be a string or null`);
    }
  }
  for (const f of ["candidateCount", "stepCount"] as const) {
    if (typeof value[f] !== "number" || !Number.isInteger(value[f]) || (value[f] as number) < 0) {
      throw new SniperAuditLogError(`audit log.${f} must be a non-negative integer`);
    }
  }
  for (const f of ["hasFailure", "hasWarning", "hasPaperEnter", "hasRiskBlock", "hasUnknown", "hasMissingRecommendedArtifact"] as const) {
    if (typeof value[f] !== "boolean") throw new SniperAuditLogError(`audit log.${f} must be a boolean`);
  }
  for (const f of ["warnings", "notes"] as const) {
    if (!Array.isArray(value[f]) || (value[f] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperAuditLogError(`audit log.${f} must be an array of strings`);
    }
  }
  if (!Array.isArray(value.steps)) throw new SniperAuditLogError("audit log.steps must be an array");
  if ((value.steps as unknown[]).length !== value.stepCount) {
    throw new SniperAuditLogError("audit log.steps length must equal stepCount");
  }
  (value.steps as unknown[]).forEach((s, i) => validateEntry(s, `audit log.steps[${i}]`));
  return value as unknown as SniperAuditLog;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperAuditLog}. */
export interface FormatSniperAuditLogOptions {
  label?: string;
}

/**
 * Render a redacted, stable, human-readable audit log. Deterministic and path-stable (NO timestamps).
 * Leads with the PAPER-ONLY banner and the run label, lists each step's inputs / outputs / summary /
 * warnings / failures, and closes with the aggregate signals and the not-a-live-result disclaimers. The
 * whole output is passed through the shared redactor.
 */
export function formatSniperAuditLog(log: SniperAuditLog, opts: FormatSniperAuditLogOptions = {}): string {
  const header = `${log.banner} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];
  if (opts.label) lines.push(`label:      ${opts.label}`);
  lines.push(`run:        ${log.runLabel ?? "(unlabeled)"}`);
  lines.push(`source:     ${log.sourceLabel ?? "(none)"}`);
  lines.push(`candidates: ${log.candidateCount}`);
  lines.push(`steps:      ${log.steps.filter((s) => s.ran).length}/${log.stepCount} ran`);

  lines.push("");
  lines.push("Steps:");
  for (const s of log.steps) {
    lines.push(`- [${s.ran ? "ran" : "skipped"}] ${s.stepId} (${s.stepKind})`);
    lines.push(`    in:  ${s.inputArtifactLabels.length > 0 ? s.inputArtifactLabels.join(", ") : "(none)"}`);
    lines.push(`    out: ${s.outputArtifactLabels.length > 0 ? s.outputArtifactLabels.join(", ") : "(none)"}`);
    if (s.decisionSummary) lines.push(`    summary: ${s.decisionSummary}`);
    for (const f of s.failures) lines.push(`    ✗ ${f}`);
    for (const w of s.warnings) lines.push(`    ! ${w}`);
    for (const n of s.notes) lines.push(`    · ${n}`);
  }

  lines.push("");
  lines.push(`Any failure:      ${log.hasFailure ? "YES" : "no"}`);
  lines.push(`Any warning:      ${log.hasWarning ? "YES" : "no"}`);
  lines.push(`Any paper-enter:  ${log.hasPaperEnter ? "YES" : "no"}`);
  lines.push(`Any risk block:   ${log.hasRiskBlock ? "YES" : "no"}`);
  lines.push(`Any unknown:      ${log.hasUnknown ? "YES" : "no"}`);

  if (log.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of log.warnings) lines.push(`- ${w}`);
  }

  lines.push("");
  lines.push("Notes:");
  for (const note of log.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of log.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
