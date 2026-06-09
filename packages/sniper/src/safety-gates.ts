/**
 * Deterministic, offline, **PAPER-only** SNIPER SAFETY GATES (Phase 5+ pre-simulation gate).
 *
 * Before any future Phase 6 *simulation* can even be contemplated, an operator needs an explicit,
 * fail-closed CHECK that a session is in a safe, complete state. This module evaluates a set of safety
 * gates over a single session pack (`sniper.session.pack.v1`): is the candidate list present, is the
 * decision report present, is an audit log present, are there any unsupported artifacts, and — gated by
 * explicit operator allowances — are there unknown classifications, risk blocks, or SIMULATED
 * paper-enters. It is **fail-closed**: a concern is a FAIL unless the operator explicitly allowed it.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work — the CLI loads the session pack
 * and hands the parsed value here. The package carries no chain capability. This is still entirely
 * PAPER/local: passing every gate is **NOT** authorization to start Phase 6, build/sign/send a
 * transaction, or trade — Phase 6 and Phase 7 remain not started. It carries no wall-clock time.
 */

import { redactString } from "@soulmaker/security";
import { validateSniperSessionPack, type SniperSessionPack } from "./session-pack.js";

/** Stable schema identifier for the safety gates report. Bump only on a breaking change. */
export const SNIPER_SAFETY_GATES_REPORT_SCHEMA_VERSION = "sniper.safety.gates.report.v1";

/** The banner that prefixes every safety gates report (required label). */
export const SNIPER_SAFETY_GATES_REPORT_BANNER = "SIMULATED PAPER-ONLY SNIPER SAFETY GATES";

/** Required disclaimer statements carried by every safety gates report (stable order). */
export const SNIPER_SAFETY_GATES_REPORT_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SNIPER SAFETY GATES — a deterministic, fail-closed check that a paper session is in a safe, complete state.",
  "It is FAIL-CLOSED: an unknown / risk-block / paper-enter is a FAIL unless the operator explicitly allowed it; a missing required artifact is a FAIL.",
  "Passing every gate is LOCAL/PAPER readiness ONLY — it is NOT authorization to start Phase 6, build/sign/send a transaction, or trade. Phase 6 and Phase 7 remain NOT started.",
  "Every signal is read VERBATIM from the session pack; this layer re-derives nothing.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this report.",
];

/** Thrown when safety-gates INPUT or a produced report is structurally invalid. */
export class SniperSafetyGatesReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperSafetyGatesReportError";
  }
}

// --- model -------------------------------------------------------------------

/** A single gate's outcome. `skip` = not applicable. */
export type SniperGateStatus = "pass" | "fail" | "warn" | "skip";

/** One evaluated safety gate. */
export interface SniperSafetyGate {
  /** Stable gate id (UPPER_SNAKE). */
  id: string;
  /** Human title. */
  title: string;
  /** Whether a non-pass on this gate blocks readiness (a required gate's fail ⇒ not ready). */
  required: boolean;
  status: SniperGateStatus;
  /** Deterministic reason for the status. */
  reason: string;
}

/** Operator allowances (each defaults to false = fail-closed). */
export interface SniperSafetyGateAllowances {
  /** Allow unknown classifications (downgrades that gate's fail to a warn). */
  allowUnknown?: boolean;
  /** Allow risk blocks (downgrades that gate's fail to a warn). */
  allowRiskBlock?: boolean;
  /** Allow SIMULATED paper-enters (downgrades that gate's fail to a warn). */
  allowPaperEnter?: boolean;
}

/** Everything {@link buildSniperSafetyGatesReport} needs. */
export interface BuildSniperSafetyGatesReportInput {
  /** A canonical `sniper.session.pack.v1` (strictly validated). */
  sessionPack: unknown;
  /** Optional operator label echoed into the report. */
  operatorLabel?: string | null;
  /** Operator allowances (fail-closed by default). */
  allowances?: SniperSafetyGateAllowances;
}

/** The full, deterministic, JSON-serializable safety gates report. */
export interface SniperSafetyGatesReport {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  operatorLabel: string | null;
  sessionLabel: string | null;
  /** The resolved allowances actually applied (defaults made explicit). */
  allowances: Required<SniperSafetyGateAllowances>;
  gates: SniperSafetyGate[];
  passCount: number;
  failCount: number;
  warnCount: number;
  skipCount: number;
  /** True iff NO required gate failed. */
  ready: boolean;
  /** True iff any gate (required or not) failed. */
  hasFailure: boolean;
  /** True iff any gate warned. */
  hasWarning: boolean;
  /** A neutral, operational (never trading) summary of what to do next. */
  recommendation: string;
  failReasons: string[];
  notes: string[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** A presence gate: pass when present, else `fail` (required) or `warn` (recommended). */
function presenceGate(id: string, title: string, present: boolean, required: boolean, missingReason: string): SniperSafetyGate {
  if (present) return { id, title, required, status: "pass", reason: `${title.toLowerCase()} present` };
  return { id, title, required, status: required ? "fail" : "warn", reason: missingReason };
}

/** An allowance gate: pass when the condition is absent; else `fail` (disallowed) or `warn` (allowed). */
function allowanceGate(id: string, title: string, present: boolean, allowed: boolean, presentReason: string): SniperSafetyGate {
  if (!present) return { id, title, required: true, status: "pass", reason: `no ${title.toLowerCase()}` };
  return { id, title, required: true, status: allowed ? "warn" : "fail", reason: `${presentReason}${allowed ? " (allowed by operator)" : ""}` };
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link SniperSafetyGatesReport} from a session pack and the operator's
 * allowances. Pure and non-mutating. The session pack is STRICTLY validated. Each gate reads a session
 * signal VERBATIM. It is FAIL-CLOSED: an unknown / risk-block / paper-enter fails its gate unless the
 * operator allowed it; a missing required artifact (candidate list, decision report, audit log) fails;
 * an unsupported artifact fails. `ready` is true iff no REQUIRED gate failed. Carries no wall-clock
 * time. Throws {@link SniperSafetyGatesReportError} on invalid input.
 */
export function buildSniperSafetyGatesReport(input: BuildSniperSafetyGatesReportInput): SniperSafetyGatesReport {
  if (!isObject(input)) throw new SniperSafetyGatesReportError("safety gates input must be an object");
  let pack: SniperSessionPack;
  try {
    pack = validateSniperSessionPack(input.sessionPack);
  } catch (err) {
    throw new SniperSafetyGatesReportError(`session pack is invalid: ${(err as Error).message}`);
  }
  if (input.operatorLabel !== undefined && input.operatorLabel !== null && typeof input.operatorLabel !== "string") {
    throw new SniperSafetyGatesReportError("safety gates input.operatorLabel must be a string or null when present");
  }
  if (input.allowances !== undefined && !isObject(input.allowances)) {
    throw new SniperSafetyGatesReportError("safety gates input.allowances must be an object when present");
  }
  const a = input.allowances ?? {};
  for (const f of ["allowUnknown", "allowRiskBlock", "allowPaperEnter"] as const) {
    if (a[f] !== undefined && typeof a[f] !== "boolean") {
      throw new SniperSafetyGatesReportError(`safety gates allowances.${f} must be a boolean when present`);
    }
  }
  const allowances: Required<SniperSafetyGateAllowances> = {
    allowUnknown: a.allowUnknown === true,
    allowRiskBlock: a.allowRiskBlock === true,
    allowPaperEnter: a.allowPaperEnter === true,
  };

  const c = pack.coverage;
  const gates: SniperSafetyGate[] = [
    presenceGate("CANDIDATE_LIST_PRESENT", "Candidate list", c.hasCandidateList, true, "no candidate list in the session — there is no intake spine"),
    presenceGate("PREFLIGHT_PRESENT", "Preflight report", c.hasPreflight, false, "no preflight report — candidates were not safety-screened"),
    presenceGate("DECISION_PRESENT", "Decision report", c.hasDecision, true, "no decision report — there are no simulated decisions to gate"),
    presenceGate("RUN_REPORT_PRESENT", "Run report", c.hasRunReport, false, "no run report — the session was not bundled"),
    presenceGate("AUDIT_LOG_PRESENT", "Audit log", c.hasAuditLog, true, "no audit log — provenance is required before any Phase 6 work"),
    presenceGate("POLICY_PRESENT", "Policy config", c.hasPolicy, false, "no policy config — the run was not governed by an explicit policy"),
    {
      id: "NO_UNSUPPORTED_ARTIFACT",
      title: "No unsupported artifact",
      required: true,
      status: pack.hasUnsupported ? "fail" : "pass",
      reason: pack.hasUnsupported ? `${pack.unsupportedCount} unsupported artifact(s) in the session` : "every artifact has a known schema",
    },
    allowanceGate("NO_UNKNOWN", "Unknown classification", pack.hasUnknown, allowances.allowUnknown, "the session carries an unknown classification"),
    allowanceGate("NO_RISK_BLOCK", "Risk block", pack.hasRiskBlock, allowances.allowRiskBlock, "the session carries a risk block"),
    allowanceGate("NO_PAPER_ENTER", "Paper-enter", pack.hasPaperEnter, allowances.allowPaperEnter, "the session carries a SIMULATED paper-enter"),
    {
      id: "PHASE6_NOT_STARTED",
      title: "Phase 6 boundary",
      required: false,
      status: "skip",
      reason: "Phase 6 (transaction planning/simulation) is NOT started by design — passing these gates is local/paper readiness only, never Phase 6 authorization",
    },
  ];

  const passCount = gates.filter((g) => g.status === "pass").length;
  const failCount = gates.filter((g) => g.status === "fail").length;
  const warnCount = gates.filter((g) => g.status === "warn").length;
  const skipCount = gates.filter((g) => g.status === "skip").length;
  const ready = !gates.some((g) => g.required && g.status === "fail");
  const hasFailure = failCount > 0;
  const hasWarning = warnCount > 0;

  const failReasons = gates.filter((g) => g.status === "fail").map((g) => `${g.id}: ${g.reason}`);

  const recommendation = ready
    ? hasWarning
      ? "All required gates pass; review the warnings before relying on this session. This is local/paper readiness only — NOT Phase 6 authorization."
      : "All required gates pass. This is local/paper readiness only — NOT Phase 6 authorization; Phase 6 remains not started."
    : `Not ready: ${failCount} gate(s) failed. Resolve them before relying on this session.`;

  const notes = [
    `${passCount} pass / ${failCount} fail / ${warnCount} warn / ${skipCount} skip; ready=${ready}.`,
    "Fail-closed local/paper safety check — passing is NOT authorization to start Phase 6, build/sign/send a transaction, or trade.",
  ];

  return {
    schemaVersion: SNIPER_SAFETY_GATES_REPORT_SCHEMA_VERSION,
    banner: SNIPER_SAFETY_GATES_REPORT_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...SNIPER_SAFETY_GATES_REPORT_DISCLAIMERS],
    operatorLabel: nonEmptyString(input.operatorLabel) ? input.operatorLabel : null,
    sessionLabel: pack.sessionLabel,
    allowances,
    gates,
    passCount,
    failCount,
    warnCount,
    skipCount,
    ready,
    hasFailure,
    hasWarning,
    recommendation,
    failReasons,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

const GATE_STATUSES: ReadonlySet<string> = new Set(["pass", "fail", "warn", "skip"]);

function validateGate(value: unknown, where: string): void {
  if (!isObject(value)) throw new SniperSafetyGatesReportError(`${where} must be an object`);
  if (!nonEmptyString(value.id)) throw new SniperSafetyGatesReportError(`${where}.id must be a non-empty string`);
  if (!nonEmptyString(value.title)) throw new SniperSafetyGatesReportError(`${where}.title must be a non-empty string`);
  if (typeof value.required !== "boolean") throw new SniperSafetyGatesReportError(`${where}.required must be a boolean`);
  if (typeof value.status !== "string" || !GATE_STATUSES.has(value.status)) {
    throw new SniperSafetyGatesReportError(`${where}.status must be pass|fail|warn|skip`);
  }
  if (!nonEmptyString(value.reason)) throw new SniperSafetyGatesReportError(`${where}.reason must be a non-empty string`);
}

/**
 * Strictly validate a value as a {@link SniperSafetyGatesReport} and return it narrowed. A backstop
 * mirroring the package's sibling validators. Throws {@link SniperSafetyGatesReportError} on the first
 * problem. Pure.
 */
export function validateSniperSafetyGatesReport(value: unknown): SniperSafetyGatesReport {
  if (!isObject(value)) throw new SniperSafetyGatesReportError("safety gates report must be a JSON object");
  if (value.schemaVersion !== SNIPER_SAFETY_GATES_REPORT_SCHEMA_VERSION) {
    throw new SniperSafetyGatesReportError(`safety gates report.schemaVersion must be "${SNIPER_SAFETY_GATES_REPORT_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_SAFETY_GATES_REPORT_BANNER) {
    throw new SniperSafetyGatesReportError(`safety gates report.banner must be "${SNIPER_SAFETY_GATES_REPORT_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new SniperSafetyGatesReportError(`safety gates report.${flag} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperSafetyGatesReportError("safety gates report.disclaimers must be a non-empty array");
  }
  for (const f of ["operatorLabel", "sessionLabel"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new SniperSafetyGatesReportError(`safety gates report.${f} must be a string or null`);
    }
  }
  if (!isObject(value.allowances)) throw new SniperSafetyGatesReportError("safety gates report.allowances must be an object");
  for (const f of ["allowUnknown", "allowRiskBlock", "allowPaperEnter"] as const) {
    if (typeof (value.allowances as Record<string, unknown>)[f] !== "boolean") {
      throw new SniperSafetyGatesReportError(`safety gates report.allowances.${f} must be a boolean`);
    }
  }
  for (const f of ["passCount", "failCount", "warnCount", "skipCount"] as const) {
    if (typeof value[f] !== "number" || !Number.isInteger(value[f]) || (value[f] as number) < 0) {
      throw new SniperSafetyGatesReportError(`safety gates report.${f} must be a non-negative integer`);
    }
  }
  for (const f of ["ready", "hasFailure", "hasWarning"] as const) {
    if (typeof value[f] !== "boolean") throw new SniperSafetyGatesReportError(`safety gates report.${f} must be a boolean`);
  }
  if (!nonEmptyString(value.recommendation)) throw new SniperSafetyGatesReportError("safety gates report.recommendation must be a non-empty string");
  for (const f of ["failReasons", "notes"] as const) {
    if (!Array.isArray(value[f]) || (value[f] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperSafetyGatesReportError(`safety gates report.${f} must be an array of strings`);
    }
  }
  if (!Array.isArray(value.gates) || value.gates.length === 0) throw new SniperSafetyGatesReportError("safety gates report.gates must be a non-empty array");
  (value.gates as unknown[]).forEach((g, i) => validateGate(g, `safety gates report.gates[${i}]`));
  return value as unknown as SniperSafetyGatesReport;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperSafetyGatesReport}. */
export interface FormatSniperSafetyGatesReportOptions {
  label?: string;
}

const STATUS_MARK: Record<SniperGateStatus, string> = { pass: "✓", fail: "✗", warn: "!", skip: "·" };

/**
 * Render a redacted, stable, human-readable safety gates report. Deterministic and path-stable (no
 * timestamps). Leads with the PAPER-ONLY banner and the READY verdict, lists each gate with its status
 * mark + reason, and closes with the neutral recommendation and the not-Phase-6-authorization
 * disclaimers. The whole output is passed through the shared redactor.
 */
export function formatSniperSafetyGatesReport(report: SniperSafetyGatesReport, opts: FormatSniperSafetyGatesReportOptions = {}): string {
  const header = `${report.banner} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];
  if (opts.label) lines.push(`label:    ${opts.label}`);
  lines.push(`session:  ${report.sessionLabel ?? "(unlabeled)"}`);
  lines.push(`READY:    ${report.ready ? "YES" : "NO"}  (${report.passCount} pass / ${report.failCount} fail / ${report.warnCount} warn / ${report.skipCount} skip)`);
  lines.push(`allowances: unknown=${report.allowances.allowUnknown}  risk-block=${report.allowances.allowRiskBlock}  paper-enter=${report.allowances.allowPaperEnter}`);

  lines.push("");
  lines.push("Gates:");
  for (const g of report.gates) {
    lines.push(`${STATUS_MARK[g.status]} [${g.status.toUpperCase()}] ${g.id}${g.required ? "" : " (recommended)"}`);
    lines.push(`    ${g.reason}`);
  }

  if (report.failReasons.length > 0) {
    lines.push("");
    lines.push("Failures:");
    for (const r of report.failReasons) lines.push(`- ${r}`);
  }

  lines.push("");
  lines.push(`Recommendation: ${report.recommendation}`);

  lines.push("");
  lines.push("Notes:");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of report.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
