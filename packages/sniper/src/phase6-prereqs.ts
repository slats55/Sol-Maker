/**
 * Deterministic, offline, **PAPER-only** PHASE 6 PREREQUISITE TRACKER (Phase 5+ readiness checklist).
 *
 * `docs/PHASE_6_SIMULATION_BOUNDARY.md` lists the exact prerequisites that must be in place before ANY
 * Phase 6 (transaction planning / simulation) implementation may begin. This module turns that checklist
 * into a deterministic, machine-readable artifact: for each prerequisite it reports a status derived
 * either from a supplied session pack (the artifact-backed prerequisites) or from the boundary spec (the
 * design prerequisites, which the spec documents).
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work — the CLI loads the session pack
 * and hands the parsed value here. **It implements NO transaction planning** and carries no chain
 * capability. Critically, it can NEVER authorize Phase 6: `phase6ImplementationStarted` is always
 * `false` and `requiresExplicitHumanApproval` is always `true` — even when every prerequisite is
 * addressed, beginning Phase 6 requires an explicit human decision, never a machine verdict. It carries
 * no wall-clock time, so the same session pack yields a byte-identical report.
 */

import { redactString } from "@soulmaker/security";
import { validateSniperSessionPack, type SniperSessionPack } from "./session-pack.js";

/** Stable schema identifier for the Phase 6 prerequisite report. Bump only on a breaking change. */
export const PHASE6_PREREQUISITE_REPORT_SCHEMA_VERSION = "phase6.prerequisite.report.v1";

/** The banner that prefixes every Phase 6 prerequisite report (required label). */
export const PHASE6_PREREQUISITE_REPORT_BANNER = "PHASE 6 PREREQUISITE TRACKER (PAPER-ONLY, NOT AUTHORIZATION)";

/** Required disclaimer statements carried by every report (stable order). */
export const PHASE6_PREREQUISITE_REPORT_DISCLAIMERS: readonly string[] = [
  "PHASE 6 PREREQUISITE TRACKER — a deterministic, machine-readable checklist of the prerequisites in docs/PHASE_6_SIMULATION_BOUNDARY.md.",
  "It is NOT authorization to start Phase 6: even when every prerequisite is addressed, beginning Phase 6 requires an explicit human decision, never this report.",
  "Phase 6 (transaction planning/simulation) and Phase 7 (burner/live trading) are NOT started; this tracker implements NO transaction planning and carries no chain capability.",
  "A `documented` design prerequisite means its DESIGN exists in the spec/repo — NOT that Phase 6 has implemented it.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this report.",
];

/** Thrown when prerequisite-tracker INPUT or a produced report is structurally invalid. */
export class Phase6PrerequisiteReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Phase6PrerequisiteReportError";
  }
}

// --- model -------------------------------------------------------------------

/** A prerequisite's kind: `artifact` (derived from the session pack) or `design` (from the spec). */
export type Phase6PrereqKind = "artifact" | "design";

/** A prerequisite's status. `met`/`not-met` apply to artifact prereqs; `documented` to design prereqs. */
export type Phase6PrereqStatus = "met" | "not-met" | "documented";

/** One Phase 6 prerequisite. */
export interface Phase6Prerequisite {
  /** Stable id (UPPER_SNAKE). */
  id: string;
  /** Human title. */
  title: string;
  kind: Phase6PrereqKind;
  status: Phase6PrereqStatus;
  /** Where the status came from (an artifact kind, or the boundary spec). */
  source: string;
  reason: string;
}

/** Everything {@link buildPhase6PrerequisiteReport} needs. */
export interface BuildPhase6PrerequisiteReportInput {
  /** A canonical `sniper.session.pack.v1` (strictly validated) — supplies the artifact prerequisites. */
  sessionPack: unknown;
  /** Optional operator label echoed into the report. */
  operatorLabel?: string | null;
}

/** The full, deterministic, JSON-serializable Phase 6 prerequisite report. */
export interface Phase6PrerequisiteReport {
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
  prerequisites: Phase6Prerequisite[];
  artifactCount: number;
  artifactMetCount: number;
  designCount: number;
  designDocumentedCount: number;
  /** Ids of artifact prerequisites that are NOT met. */
  notMet: string[];
  /** True iff every artifact prerequisite is met. */
  artifactPrerequisitesMet: boolean;
  /** True iff every artifact prereq is met AND every design prereq is documented. */
  allPrerequisitesAddressed: boolean;
  // --- HARD invariants (these can never be anything else) ---
  /** ALWAYS false — Phase 6 implementation is not started. */
  phase6ImplementationStarted: false;
  /** ALWAYS true — beginning Phase 6 requires an explicit human decision, never this report. */
  requiresExplicitHumanApproval: true;
  recommendation: string;
  notes: string[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** An artifact-backed prerequisite: met iff the session pack carries the artifact kind. */
function artifactPrereq(id: string, title: string, present: boolean, source: string): Phase6Prerequisite {
  return {
    id,
    title,
    kind: "artifact",
    status: present ? "met" : "not-met",
    source: `${source} (session pack)`,
    reason: present ? `${source} is present in the session pack` : `${source} is absent from the session pack`,
  };
}

/** A design prerequisite: `documented` — its design exists in the spec/repo (NOT implemented in Phase 6). */
function designPrereq(id: string, title: string, source: string, reason: string): Phase6Prerequisite {
  return { id, title, kind: "design", status: "documented", source, reason };
}

const BOUNDARY_SPEC = "docs/PHASE_6_SIMULATION_BOUNDARY.md";

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link Phase6PrerequisiteReport} from a session pack. Pure and non-mutating. The
 * five ARTIFACT prerequisites (candidate intake / preflight / paper decisions / operator config / audit
 * logging) are derived from the session pack's presence flags; the six DESIGN prerequisites (operator
 * workflow, risk limits, test coverage, kill-switch, secrets policy, burner isolation) are reported as
 * `documented` (their design exists in the boundary spec). It can NEVER authorize Phase 6:
 * `phase6ImplementationStarted` is always false and `requiresExplicitHumanApproval` always true. Carries
 * no wall-clock time. Throws {@link Phase6PrerequisiteReportError} on invalid input.
 */
export function buildPhase6PrerequisiteReport(input: BuildPhase6PrerequisiteReportInput): Phase6PrerequisiteReport {
  if (!isObject(input)) throw new Phase6PrerequisiteReportError("phase 6 prerequisite input must be an object");
  let pack: SniperSessionPack;
  try {
    pack = validateSniperSessionPack(input.sessionPack);
  } catch (err) {
    throw new Phase6PrerequisiteReportError(`session pack is invalid: ${(err as Error).message}`);
  }
  if (input.operatorLabel !== undefined && input.operatorLabel !== null && typeof input.operatorLabel !== "string") {
    throw new Phase6PrerequisiteReportError("phase 6 prerequisite input.operatorLabel must be a string or null when present");
  }

  const c = pack.coverage;
  const prerequisites: Phase6Prerequisite[] = [
    // Artifact-backed (derived from the session pack).
    artifactPrereq("CANDIDATE_INTAKE", "Candidate intake stable", c.hasCandidateList, "sniper.candidate.list.v1"),
    artifactPrereq("TOKEN_PREFLIGHT", "Token preflight stable", c.hasPreflight, "sniper.token.preflight.report.v1"),
    artifactPrereq("PAPER_DECISIONS", "Paper decisions stable", c.hasDecision, "sniper.paper.decision.report.v1"),
    artifactPrereq("OPERATOR_CONFIG", "Operator config (versioned policy)", c.hasPolicy, "sniper.policy.config.v1"),
    artifactPrereq("AUDIT_LOGGING", "Logs / audit stable", c.hasAuditLog, "sniper.audit.log.v1"),
    // Design (documented in the boundary spec / repo).
    designPrereq("OPERATOR_WORKFLOW", "Operator workflow + runbook stable", "docs/SNIPER_RUNBOOK.md", "the operator workflow helper + runbook are documented and shipped"),
    designPrereq("RISK_LIMITS", "Risk limits stable + versioned", "@soulmaker/risk + @soulmaker/core", "the advisory risk engine, core caps, and the fail-closed live gate are versioned and tested"),
    designPrereq("TEST_COVERAGE", "Test coverage + boundary-test plan", BOUNDARY_SPEC, "the PAPER path has comprehensive deterministic tests; the Phase 6 boundary-test plan is documented (boundary tests are added WHEN Phase 6 begins, not before)"),
    designPrereq("KILL_SWITCH_DESIGN", "Kill-switch design", BOUNDARY_SPEC, "a documented, testable halt switch is specified (the core kill switch already exists, default-safe)"),
    designPrereq("SECRETS_POLICY", "Secrets policy", "SECURITY.md + " + BOUNDARY_SPEC, "a written secrets policy (no keys/seed in the planner, kept out of logs/plans) is documented"),
    designPrereq("BURNER_ISOLATION_DESIGN", "Burner-wallet isolation design", BOUNDARY_SPEC, "a burner-isolation DESIGN (not implementation) is documented; the config refuses main-wallet-shaped input"),
  ];

  const artifactPrereqs = prerequisites.filter((p) => p.kind === "artifact");
  const designPrereqs = prerequisites.filter((p) => p.kind === "design");
  const artifactCount = artifactPrereqs.length;
  const artifactMetCount = artifactPrereqs.filter((p) => p.status === "met").length;
  const designCount = designPrereqs.length;
  const designDocumentedCount = designPrereqs.filter((p) => p.status === "documented").length;
  const notMet = artifactPrereqs.filter((p) => p.status === "not-met").map((p) => p.id);

  const artifactPrerequisitesMet = artifactMetCount === artifactCount;
  const allPrerequisitesAddressed = artifactPrerequisitesMet && designDocumentedCount === designCount;

  const recommendation = artifactPrerequisitesMet
    ? "Every artifact prerequisite is met and every design prerequisite is documented. This is NOT authorization to start Phase 6 — beginning Phase 6 requires an explicit human decision. The first Phase 6 step is inert plan-data TYPES + boundary tests, with no signer/sending."
    : `Not all artifact prerequisites are met: ${notMet.join(", ")}. Address them (and keep the design prerequisites current) before Phase 6 can even be considered. Phase 6 still requires an explicit human decision.`;

  const notes = [
    `${artifactMetCount}/${artifactCount} artifact prerequisite(s) met; ${designDocumentedCount}/${designCount} design prerequisite(s) documented.`,
    "Phase 6 implementation is NOT started and is NEVER auto-authorized by this report — a `documented` design prerequisite is not an implemented one.",
  ];

  return {
    schemaVersion: PHASE6_PREREQUISITE_REPORT_SCHEMA_VERSION,
    banner: PHASE6_PREREQUISITE_REPORT_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...PHASE6_PREREQUISITE_REPORT_DISCLAIMERS],
    operatorLabel: nonEmptyString(input.operatorLabel) ? input.operatorLabel : null,
    sessionLabel: pack.sessionLabel,
    prerequisites,
    artifactCount,
    artifactMetCount,
    designCount,
    designDocumentedCount,
    notMet,
    artifactPrerequisitesMet,
    allPrerequisitesAddressed,
    phase6ImplementationStarted: false,
    requiresExplicitHumanApproval: true,
    recommendation,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

const PREREQ_KINDS: ReadonlySet<string> = new Set(["artifact", "design"]);
const PREREQ_STATUSES: ReadonlySet<string> = new Set(["met", "not-met", "documented"]);

function validatePrereq(value: unknown, where: string): void {
  if (!isObject(value)) throw new Phase6PrerequisiteReportError(`${where} must be an object`);
  if (!nonEmptyString(value.id)) throw new Phase6PrerequisiteReportError(`${where}.id must be a non-empty string`);
  if (!nonEmptyString(value.title)) throw new Phase6PrerequisiteReportError(`${where}.title must be a non-empty string`);
  if (typeof value.kind !== "string" || !PREREQ_KINDS.has(value.kind)) {
    throw new Phase6PrerequisiteReportError(`${where}.kind must be artifact|design`);
  }
  if (typeof value.status !== "string" || !PREREQ_STATUSES.has(value.status)) {
    throw new Phase6PrerequisiteReportError(`${where}.status must be met|not-met|documented`);
  }
  if (!nonEmptyString(value.source) || !nonEmptyString(value.reason)) {
    throw new Phase6PrerequisiteReportError(`${where}.source and .reason must be non-empty strings`);
  }
}

/**
 * Strictly validate a value as a {@link Phase6PrerequisiteReport} and return it narrowed. A backstop
 * mirroring the package's sibling validators; enforces the HARD invariants
 * (`phase6ImplementationStarted === false`, `requiresExplicitHumanApproval === true`). Throws
 * {@link Phase6PrerequisiteReportError} on the first problem. Pure.
 */
export function validatePhase6PrerequisiteReport(value: unknown): Phase6PrerequisiteReport {
  if (!isObject(value)) throw new Phase6PrerequisiteReportError("phase 6 prerequisite report must be a JSON object");
  if (value.schemaVersion !== PHASE6_PREREQUISITE_REPORT_SCHEMA_VERSION) {
    throw new Phase6PrerequisiteReportError(`phase 6 prerequisite report.schemaVersion must be "${PHASE6_PREREQUISITE_REPORT_SCHEMA_VERSION}"`);
  }
  if (value.banner !== PHASE6_PREREQUISITE_REPORT_BANNER) {
    throw new Phase6PrerequisiteReportError(`phase 6 prerequisite report.banner must be "${PHASE6_PREREQUISITE_REPORT_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new Phase6PrerequisiteReportError(`phase 6 prerequisite report.${flag} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new Phase6PrerequisiteReportError("phase 6 prerequisite report.disclaimers must be a non-empty array");
  }
  for (const f of ["operatorLabel", "sessionLabel"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new Phase6PrerequisiteReportError(`phase 6 prerequisite report.${f} must be a string or null`);
    }
  }
  for (const f of ["artifactCount", "artifactMetCount", "designCount", "designDocumentedCount"] as const) {
    if (typeof value[f] !== "number" || !Number.isInteger(value[f]) || (value[f] as number) < 0) {
      throw new Phase6PrerequisiteReportError(`phase 6 prerequisite report.${f} must be a non-negative integer`);
    }
  }
  for (const f of ["artifactPrerequisitesMet", "allPrerequisitesAddressed"] as const) {
    if (typeof value[f] !== "boolean") throw new Phase6PrerequisiteReportError(`phase 6 prerequisite report.${f} must be a boolean`);
  }
  // HARD invariants — these can never be anything else.
  if (value.phase6ImplementationStarted !== false) {
    throw new Phase6PrerequisiteReportError("phase 6 prerequisite report.phase6ImplementationStarted must be false");
  }
  if (value.requiresExplicitHumanApproval !== true) {
    throw new Phase6PrerequisiteReportError("phase 6 prerequisite report.requiresExplicitHumanApproval must be true");
  }
  if (!nonEmptyString(value.recommendation)) throw new Phase6PrerequisiteReportError("phase 6 prerequisite report.recommendation must be a non-empty string");
  for (const f of ["notMet", "notes"] as const) {
    if (!Array.isArray(value[f]) || (value[f] as unknown[]).some((x) => typeof x !== "string")) {
      throw new Phase6PrerequisiteReportError(`phase 6 prerequisite report.${f} must be an array of strings`);
    }
  }
  if (!Array.isArray(value.prerequisites) || value.prerequisites.length === 0) {
    throw new Phase6PrerequisiteReportError("phase 6 prerequisite report.prerequisites must be a non-empty array");
  }
  (value.prerequisites as unknown[]).forEach((p, i) => validatePrereq(p, `phase 6 prerequisite report.prerequisites[${i}]`));
  return value as unknown as Phase6PrerequisiteReport;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatPhase6PrerequisiteReport}. */
export interface FormatPhase6PrerequisiteReportOptions {
  label?: string;
}

const STATUS_MARK: Record<Phase6PrereqStatus, string> = { met: "✓", "not-met": "✗", documented: "•" };

/**
 * Render a redacted, stable, human-readable Phase 6 prerequisite report. Deterministic and path-stable
 * (no timestamps). Leads with the NOT-AUTHORIZATION banner, lists each prerequisite with its status mark,
 * and closes with the never-authorizes recommendation and the not-a-go-signal disclaimers. The whole
 * output is passed through the shared redactor.
 */
export function formatPhase6PrerequisiteReport(report: Phase6PrerequisiteReport, opts: FormatPhase6PrerequisiteReportOptions = {}): string {
  const header = report.banner;
  const lines: string[] = [header, "=".repeat(header.length)];
  if (opts.label) lines.push(`label:   ${opts.label}`);
  lines.push(`session: ${report.sessionLabel ?? "(unlabeled)"}`);
  lines.push(`artifact prerequisites: ${report.artifactMetCount}/${report.artifactCount} met`);
  lines.push(`design prerequisites:   ${report.designDocumentedCount}/${report.designCount} documented`);
  lines.push(`Phase 6 implementation started: NO (never auto-authorized — requires explicit human approval)`);

  lines.push("");
  lines.push("Prerequisites:");
  for (const p of report.prerequisites) {
    lines.push(`${STATUS_MARK[p.status]} [${p.status}] ${p.id} (${p.kind})`);
    lines.push(`    ${p.reason}`);
  }

  if (report.notMet.length > 0) {
    lines.push("");
    lines.push(`Not met: ${report.notMet.join(", ")}`);
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
