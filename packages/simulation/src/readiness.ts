/**
 * **PHASE 6 SIMULATION READINESS REPORT** (`phase6.simulation.readiness.report.v1`, Sprint 69).
 *
 * The structural answer to "is the Phase 6 simulation stack green?" — built from real artifacts,
 * not vibes, and split honestly into two kinds of checks:
 *
 *   1. **Artifact checks (machine-verified here):** a strictly-valid chain audit that PASSED with
 *      a COMPLETE chain, plus a strictly-valid intent plan and simulation result. These the
 *      builder validates itself, in place.
 *   2. **Evidence declarations (operator-supplied references):** where the package-boundary
 *      tests, CLI commands, e2e fixtures, source scans, and docs live. The report lists these
 *      VERBATIM as declarations — it cannot run tests, so it never claims it verified them.
 *
 * `phase6SimulationReady` is true only when every artifact check passes AND every required
 * evidence area is declared. Chain conditions surfaced by the audit (e.g. prereqs awaiting the
 * paper-enter review) are a WARNING, not a blocker — they prove the stack reports honestly; they
 * are session state, not stack state.
 *
 * The hard line, validated as literals: `phase7LiveTradingReady` is ALWAYS false (the validator
 * refuses anything else — this artifact is structurally incapable of claiming live readiness),
 * and the four safety locks always hold. Pure: no I/O, no network, no wallet, no wall-clock.
 */

import { redactString } from "@soulmaker/security";
import {
  SIMULATION_PACKAGE_DISCLAIMERS,
  SIMULATION_SAFETY_LITERALS,
  assertSimulationSafetyLiterals,
} from "./safety.js";
import {
  SIMULATION_REASON_CODE_DEFINITIONS,
  dedupeSimulationReasonCodes,
  isSimulationReasonCode,
  type SimulationReasonCode,
} from "./reason-codes.js";
import { validateSimulationIntentPlanV2, type SimulationIntentPlanV2 } from "./intent-plan.js";
import { validateSimulationResultV1, type SimulationResultV1 } from "./result.js";
import { validatePhase6AuditReportV1, type Phase6AuditReportV1 } from "./chain-audit.js";

/** Stable schema identifier for the readiness report. Bump only on a breaking change. */
export const PHASE6_SIMULATION_READINESS_REPORT_V1_SCHEMA_VERSION = "phase6.simulation.readiness.report.v1";

/** The banner that prefixes every readiness report (required label). */
export const PHASE6_SIMULATION_READINESS_REPORT_V1_BANNER =
  "PHASE 6 SIMULATION READINESS REPORT (SIMULATION READINESS ONLY — NEVER LIVE-TRADING READINESS)";

/** The fixed `generatedBy` marker. */
export const PHASE6_SIMULATION_READINESS_REPORT_V1_GENERATED_BY = "@soulmaker/simulation";

/** Required disclaimer statements (stable order). */
export const PHASE6_SIMULATION_READINESS_REPORT_V1_DISCLAIMERS: readonly string[] = [
  "PHASE 6 SIMULATION READINESS — artifact checks are machine-verified here; evidence declarations are operator-supplied references listed verbatim (this report cannot run tests and never claims it did).",
  "phase7LiveTradingReady is ALWAYS false: this artifact is structurally incapable of claiming live-trading readiness, and the validator refuses anything else.",
  ...SIMULATION_PACKAGE_DISCLAIMERS,
];

/** Thrown when readiness INPUT or a produced report is structurally invalid. */
export class Phase6SimulationReadinessReportV1Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Phase6SimulationReadinessReportV1Error";
  }
}

// --- model -------------------------------------------------------------------

/** The required evidence areas (stable order). Each must carry a declared reference. */
export const PHASE6_READINESS_EVIDENCE_AREAS = [
  "package-boundary-tests",
  "cli-commands",
  "e2e-fixtures",
  "source-scans",
  "docs",
] as const;

/** One of the evidence areas. */
export type Phase6ReadinessEvidenceArea = (typeof PHASE6_READINESS_EVIDENCE_AREAS)[number];

/** One declared evidence reference (verbatim; never verified here). */
export interface Phase6ReadinessEvidence {
  area: Phase6ReadinessEvidenceArea;
  /** Where the evidence lives (a repo-relative test/doc path or label). Declared, not verified. */
  ref: string | null;
  declared: boolean;
}

/** One machine-verified artifact check. */
export interface Phase6ReadinessArtifactCheck {
  id: string;
  title: string;
  passed: boolean;
  detail: string;
}

/** The full, deterministic, JSON-serializable readiness report. */
export interface Phase6SimulationReadinessReportV1 {
  schemaVersion: string;
  banner: string;
  generatedBy: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  // --- the four literal safety locks ---
  neverAuthorizesLiveTrading: true;
  neverSigns: true;
  neverSends: true;
  dryRunOnly: true;
  /** ALWAYS false — this artifact can never claim live-trading readiness (validated literal). */
  phase7LiveTradingReady: false;
  disclaimers: string[];
  operatorLabel: string | null;
  artifactChecks: Phase6ReadinessArtifactCheck[];
  evidence: Phase6ReadinessEvidence[];
  /** True iff every artifact check passed AND every evidence area is declared. */
  phase6SimulationReady: boolean;
  blockingReasonCodes: SimulationReasonCode[];
  warningReasonCodes: SimulationReasonCode[];
  outcomeReasonCodes: SimulationReasonCode[];
  notes: string[];
}

/** Everything {@link buildPhase6SimulationReadinessReportV1} needs. */
export interface BuildPhase6SimulationReadinessReportV1Input {
  /** `phase6.audit.report.v1` (must be valid, PASSED, and chain-complete for readiness). */
  auditReport?: unknown;
  /** `simulation.intent.plan.v2` (must be strictly valid for readiness). */
  intentPlan?: unknown;
  /** `simulation.result.v1` (must be strictly valid for readiness). */
  simulationResult?: unknown;
  /** Declared evidence references by area (verbatim; never verified here). */
  evidence?: Partial<Record<Phase6ReadinessEvidenceArea, string>>;
  /** Optional operator label echoed into the report. */
  operatorLabel?: string | null;
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function tryValidate<T>(value: unknown, validate: (v: unknown) => T): { artifact: T | null; error: string | null } {
  if (value === undefined || value === null) return { artifact: null, error: null };
  try {
    return { artifact: validate(value), error: null };
  } catch (err) {
    return { artifact: null, error: redactString((err as Error).message) };
  }
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link Phase6SimulationReadinessReportV1}. Pure and non-mutating. The
 * audit/plan/result are strictly validated in place (a missing or invalid one fails its artifact
 * check — never a throw); evidence references are recorded verbatim as DECLARATIONS. Readiness is
 * fail-closed: `phase6SimulationReady` is true only when every artifact check passes and every
 * evidence area is declared. `phase7LiveTradingReady` is a literal false, always. Throws
 * {@link Phase6SimulationReadinessReportV1Error} only on a malformed input SHAPE.
 */
export function buildPhase6SimulationReadinessReportV1(
  input: BuildPhase6SimulationReadinessReportV1Input = {},
): Phase6SimulationReadinessReportV1 {
  if (!isObject(input)) throw new Phase6SimulationReadinessReportV1Error("phase6 readiness input must be an object");
  if (input.operatorLabel !== undefined && input.operatorLabel !== null && typeof input.operatorLabel !== "string") {
    throw new Phase6SimulationReadinessReportV1Error("phase6 readiness input.operatorLabel must be a string or null when present");
  }
  if (input.evidence !== undefined && !isObject(input.evidence)) {
    throw new Phase6SimulationReadinessReportV1Error("phase6 readiness input.evidence must be an object when present");
  }
  const declaredEvidence = (input.evidence ?? {}) as Record<string, unknown>;
  for (const [area, ref] of Object.entries(declaredEvidence)) {
    if (!(PHASE6_READINESS_EVIDENCE_AREAS as readonly string[]).includes(area)) {
      throw new Phase6SimulationReadinessReportV1Error(`phase6 readiness input.evidence has unknown area "${area}"`);
    }
    if (typeof ref !== "string" || ref.length === 0) {
      throw new Phase6SimulationReadinessReportV1Error(`phase6 readiness input.evidence.${area} must be a non-empty string`);
    }
  }

  const audit = tryValidate<Phase6AuditReportV1>(input.auditReport, validatePhase6AuditReportV1);
  const plan = tryValidate<SimulationIntentPlanV2>(input.intentPlan, validateSimulationIntentPlanV2);
  const result = tryValidate<SimulationResultV1>(input.simulationResult, validateSimulationResultV1);

  const blocking: SimulationReasonCode[] = [];
  const warnings: SimulationReasonCode[] = [];
  const artifactChecks: Phase6ReadinessArtifactCheck[] = [];

  if (audit.artifact === null) {
    blocking.push("simulation-readiness-missing-audit");
    artifactChecks.push({
      id: "AUDIT_VALID",
      title: "Chain audit valid",
      passed: false,
      detail: audit.error ? `the chain audit is present but INVALID: ${audit.error}` : "no chain audit supplied",
    });
  } else {
    artifactChecks.push({ id: "AUDIT_VALID", title: "Chain audit valid", passed: true, detail: "the chain audit is strictly valid" });
    if (!audit.artifact.auditPassed) {
      blocking.push("simulation-readiness-audit-failed");
      artifactChecks.push({ id: "AUDIT_PASSED", title: "Chain audit passed", passed: false, detail: `${audit.artifact.blockingFindingCount} blocking finding(s)` });
    } else {
      artifactChecks.push({ id: "AUDIT_PASSED", title: "Chain audit passed", passed: true, detail: "no blocking finding" });
    }
    if (!audit.artifact.chainComplete) {
      blocking.push("simulation-readiness-chain-incomplete");
      artifactChecks.push({ id: "CHAIN_COMPLETE", title: "Chain complete", passed: false, detail: `${audit.artifact.validCount}/9 artifacts valid` });
    } else {
      artifactChecks.push({ id: "CHAIN_COMPLETE", title: "Chain complete", passed: true, detail: "all 9 chain artifacts present and valid" });
    }
    if (audit.artifact.chainConditionCodes.length > 0) {
      warnings.push("simulation-readiness-chain-conditions-present");
    }
  }
  if (plan.artifact === null) {
    blocking.push("simulation-readiness-missing-plan");
    artifactChecks.push({
      id: "PLAN_VALID",
      title: "Intent plan valid",
      passed: false,
      detail: plan.error ? `the intent plan is present but INVALID: ${plan.error}` : "no intent plan supplied",
    });
  } else {
    artifactChecks.push({ id: "PLAN_VALID", title: "Intent plan valid", passed: true, detail: `strictly valid; ${plan.artifact.blocked ? "BLOCKED (honest)" : `${plan.artifact.entryCount} preview entr${plan.artifact.entryCount === 1 ? "y" : "ies"}`}` });
  }
  if (result.artifact === null) {
    blocking.push("simulation-readiness-missing-result");
    artifactChecks.push({
      id: "RESULT_VALID",
      title: "Simulation result valid",
      passed: false,
      detail: result.error ? `the simulation result is present but INVALID: ${result.error}` : "no simulation result supplied",
    });
  } else {
    artifactChecks.push({ id: "RESULT_VALID", title: "Simulation result valid", passed: true, detail: `strictly valid; status ${result.artifact.resultStatus}` });
  }

  const evidence: Phase6ReadinessEvidence[] = PHASE6_READINESS_EVIDENCE_AREAS.map((area) => {
    const ref = declaredEvidence[area];
    const declared = typeof ref === "string" && ref.length > 0;
    if (!declared) blocking.push("simulation-readiness-evidence-missing");
    return { area, ref: declared ? (ref as string) : null, declared };
  });

  const blockingReasonCodes = dedupeSimulationReasonCodes(blocking);
  const warningReasonCodes = dedupeSimulationReasonCodes(warnings);
  const phase6SimulationReady = blockingReasonCodes.length === 0 && artifactChecks.every((c) => c.passed);
  const outcomeReasonCodes: SimulationReasonCode[] = phase6SimulationReady ? ["simulation-readiness-green"] : [];

  const notes = [
    `${artifactChecks.filter((c) => c.passed).length}/${artifactChecks.length} artifact checks passed; ${evidence.filter((e) => e.declared).length}/${evidence.length} evidence areas declared; phase6SimulationReady=${phase6SimulationReady}.`,
    "Evidence references are DECLARATIONS recorded verbatim — this report cannot run tests and never claims it did.",
    "phase6SimulationReady speaks ONLY to the simulation stack. It is never live-trading readiness: phase7LiveTradingReady is literally false, always.",
  ];

  return {
    schemaVersion: PHASE6_SIMULATION_READINESS_REPORT_V1_SCHEMA_VERSION,
    banner: PHASE6_SIMULATION_READINESS_REPORT_V1_BANNER,
    generatedBy: PHASE6_SIMULATION_READINESS_REPORT_V1_GENERATED_BY,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    ...SIMULATION_SAFETY_LITERALS,
    phase7LiveTradingReady: false,
    disclaimers: [...PHASE6_SIMULATION_READINESS_REPORT_V1_DISCLAIMERS],
    operatorLabel: nonEmptyString(input.operatorLabel) ? input.operatorLabel : null,
    artifactChecks,
    evidence,
    phase6SimulationReady,
    blockingReasonCodes,
    warningReasonCodes,
    outcomeReasonCodes,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

/**
 * Strictly validate a value as a {@link Phase6SimulationReadinessReportV1} and return it narrowed.
 * Enforces the four literal safety locks, that `phase7LiveTradingReady` is LITERALLY false (the
 * flag cannot be true, ever), the fixed evidence-area order, blocking/ready consistency, and the
 * code-severity buckets. Throws {@link Phase6SimulationReadinessReportV1Error} (or a
 * SimulationSafetyError for a flipped lock) on the first problem. Pure.
 */
export function validatePhase6SimulationReadinessReportV1(value: unknown): Phase6SimulationReadinessReportV1 {
  if (!isObject(value)) throw new Phase6SimulationReadinessReportV1Error("phase6 readiness report must be a JSON object");
  if (value.schemaVersion !== PHASE6_SIMULATION_READINESS_REPORT_V1_SCHEMA_VERSION) {
    throw new Phase6SimulationReadinessReportV1Error(`phase6 readiness report.schemaVersion must be "${PHASE6_SIMULATION_READINESS_REPORT_V1_SCHEMA_VERSION}"`);
  }
  if (value.banner !== PHASE6_SIMULATION_READINESS_REPORT_V1_BANNER) {
    throw new Phase6SimulationReadinessReportV1Error(`phase6 readiness report.banner must be "${PHASE6_SIMULATION_READINESS_REPORT_V1_BANNER}"`);
  }
  if (value.generatedBy !== PHASE6_SIMULATION_READINESS_REPORT_V1_GENERATED_BY) {
    throw new Phase6SimulationReadinessReportV1Error(`phase6 readiness report.generatedBy must be "${PHASE6_SIMULATION_READINESS_REPORT_V1_GENERATED_BY}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new Phase6SimulationReadinessReportV1Error(`phase6 readiness report.${flag} must be true`);
  }
  assertSimulationSafetyLiterals(value, "phase6 readiness report");
  // The hard line: this flag is a literal false. It can NEVER be true.
  if (value.phase7LiveTradingReady !== false) {
    throw new Phase6SimulationReadinessReportV1Error("phase6 readiness report.phase7LiveTradingReady must be literally false — this artifact can never claim live-trading readiness");
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new Phase6SimulationReadinessReportV1Error("phase6 readiness report.disclaimers must be a non-empty array");
  }
  if (value.operatorLabel !== null && typeof value.operatorLabel !== "string") {
    throw new Phase6SimulationReadinessReportV1Error("phase6 readiness report.operatorLabel must be a string or null");
  }
  if (!Array.isArray(value.artifactChecks) || value.artifactChecks.length === 0) {
    throw new Phase6SimulationReadinessReportV1Error("phase6 readiness report.artifactChecks must be a non-empty array");
  }
  const checks = (value.artifactChecks as unknown[]).map((c, i) => {
    if (!isObject(c) || !nonEmptyString(c.id) || !nonEmptyString(c.title) || typeof c.passed !== "boolean" || !nonEmptyString(c.detail)) {
      throw new Phase6SimulationReadinessReportV1Error(`phase6 readiness report.artifactChecks[${i}] must have id/title/passed/detail`);
    }
    return c as unknown as Phase6ReadinessArtifactCheck;
  });
  if (!Array.isArray(value.evidence) || value.evidence.length !== PHASE6_READINESS_EVIDENCE_AREAS.length) {
    throw new Phase6SimulationReadinessReportV1Error(`phase6 readiness report.evidence must list all ${PHASE6_READINESS_EVIDENCE_AREAS.length} areas`);
  }
  const evidence = (value.evidence as unknown[]).map((e, i) => {
    if (!isObject(e)) throw new Phase6SimulationReadinessReportV1Error(`phase6 readiness report.evidence[${i}] must be an object`);
    if (typeof e.declared !== "boolean") throw new Phase6SimulationReadinessReportV1Error(`phase6 readiness report.evidence[${i}].declared must be a boolean`);
    if (e.declared ? !nonEmptyString(e.ref) : e.ref !== null) {
      throw new Phase6SimulationReadinessReportV1Error(`phase6 readiness report.evidence[${i}].ref must be a non-empty string when declared and null otherwise`);
    }
    return e as unknown as Phase6ReadinessEvidence;
  });
  if (evidence.map((e) => e.area).join("|") !== PHASE6_READINESS_EVIDENCE_AREAS.join("|")) {
    throw new Phase6SimulationReadinessReportV1Error("phase6 readiness report.evidence must keep the stable area order");
  }
  for (const f of ["blockingReasonCodes", "warningReasonCodes", "outcomeReasonCodes"] as const) {
    if (!Array.isArray(value[f]) || (value[f] as unknown[]).some((x) => !isSimulationReasonCode(x))) {
      throw new Phase6SimulationReadinessReportV1Error(`phase6 readiness report.${f} must be an array of known simulation reason codes`);
    }
  }
  const blockingCodes = value.blockingReasonCodes as SimulationReasonCode[];
  for (const c of blockingCodes) {
    if (!SIMULATION_REASON_CODE_DEFINITIONS[c].blocking) {
      throw new Phase6SimulationReadinessReportV1Error(`phase6 readiness report.blockingReasonCodes contains non-blocking code "${c}"`);
    }
  }
  if (typeof value.phase6SimulationReady !== "boolean") {
    throw new Phase6SimulationReadinessReportV1Error("phase6 readiness report.phase6SimulationReady must be a boolean");
  }
  const expectedReady = blockingCodes.length === 0 && checks.every((c) => c.passed) && evidence.every((e) => e.declared);
  if (value.phase6SimulationReady !== expectedReady) {
    throw new Phase6SimulationReadinessReportV1Error("phase6 readiness report.phase6SimulationReady must mirror the checks, codes, and declared evidence (fail-closed)");
  }
  if (!Array.isArray(value.notes) || (value.notes as unknown[]).some((x) => typeof x !== "string")) {
    throw new Phase6SimulationReadinessReportV1Error("phase6 readiness report.notes must be an array of strings");
  }
  return value as unknown as Phase6SimulationReadinessReportV1;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatPhase6SimulationReadinessReportV1}. */
export interface FormatPhase6SimulationReadinessReportV1Options {
  label?: string;
}

/**
 * Render a redacted, stable, human-readable readiness report. Deterministic and path-stable.
 * Leads with the SIMULATION-ONLY verdict (and the permanent Phase 7 line), lists the artifact
 * checks, the declared evidence, the blocking/warning reasons, and the next safe operator action.
 * Passed through the shared redactor.
 */
export function formatPhase6SimulationReadinessReportV1(
  report: Phase6SimulationReadinessReportV1,
  opts: FormatPhase6SimulationReadinessReportV1Options = {},
): string {
  const header = "PHASE 6 SIMULATION READINESS (simulation readiness only — never live-trading readiness)";
  const lines: string[] = [header, "=".repeat(header.length)];
  if (opts.label) lines.push(`label:    ${opts.label}`);
  if (report.operatorLabel) lines.push(`operator: ${report.operatorLabel}`);
  lines.push(`phase 6 simulation ready: ${report.phase6SimulationReady ? "YES (simulation stack only)" : "NO"}`);
  lines.push("phase 7 live trading ready: NO — permanently false here; Phase 7 remains not started and unauthorized");

  lines.push("");
  lines.push("Artifact checks (machine-verified):");
  for (const c of report.artifactChecks) {
    lines.push(`${c.passed ? "✓" : "✗"} ${c.id}: ${c.detail}`);
  }

  lines.push("");
  lines.push("Declared evidence (verbatim; never verified here):");
  for (const e of report.evidence) {
    lines.push(`${e.declared ? "✓" : "✗"} ${e.area}: ${e.ref ?? "NOT DECLARED"}`);
  }

  if (report.blockingReasonCodes.length > 0) {
    lines.push("");
    lines.push("Blocking:");
    for (const c of report.blockingReasonCodes) {
      lines.push(`✗ ${c}`);
      lines.push(`    ${SIMULATION_REASON_CODE_DEFINITIONS[c].operatorMessage}`);
    }
  }
  if (report.warningReasonCodes.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const c of report.warningReasonCodes) {
      lines.push(`! ${c}`);
      lines.push(`    ${SIMULATION_REASON_CODE_DEFINITIONS[c].operatorMessage}`);
    }
  }

  lines.push("");
  lines.push(`Next safe action: ${report.phase6SimulationReady
    ? "the simulation stack is structurally ready; continue SIMULATION work only — nothing here changes the Phase 7 boundary."
    : "resolve the blocking reasons (build/fix the artifacts; declare the evidence references), then rebuild this report."}`);

  lines.push("");
  lines.push("Notes:");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of report.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
