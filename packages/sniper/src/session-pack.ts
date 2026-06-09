/**
 * Deterministic, offline, **PAPER-only** SNIPER SESSION PACK (Phase 5+ session bundle).
 *
 * A complete local operator session produces several sniper artifacts — a candidate list, a preflight,
 * a decision report, a run report (and its diff), a policy config, and an audit log. This module bundles
 * an already-loaded set of them into ONE navigable session pack: each artifact is classified by its
 * `schemaVersion` against a registry of the KNOWN sniper schemas, a known artifact is STRICTLY validated
 * and its high-level flags are read VERBATIM, and an UNKNOWN schema is surfaced honestly as
 * `unsupported` (never silently trusted). It is the sniper analogue of the research artifact pack.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work — the CLI loads each artifact from
 * a local file and hands the parsed value here. The package carries no chain capability. Chain-coverage
 * tiers describe PRESENCE only (which artifact kinds are in the pack) — never completeness, correctness,
 * or trading readiness. It carries no wall-clock time, so the same inputs yield a byte-identical pack.
 *
 * A `paper-enter` flag carried through is a SIMULATED classification — never a buy/sell order, a
 * transaction, or live readiness. Nothing here holds a key or builds/signs/sends a transaction.
 */

import { redactString } from "@soulmaker/security";
import { validateSniperCandidateList, SNIPER_CANDIDATE_LIST_SCHEMA_VERSION } from "./candidate-list.js";
import { validateSniperTokenPreflightReport, SNIPER_TOKEN_PREFLIGHT_REPORT_SCHEMA_VERSION } from "./token-preflight.js";
import { validatePaperSniperDecisionReport, SNIPER_PAPER_DECISION_REPORT_SCHEMA_VERSION } from "./paper-decision.js";
import { validateSniperWorkflowPlan, SNIPER_WORKFLOW_PLAN_SCHEMA_VERSION } from "./workflow.js";
import { validateSniperRunReport, SNIPER_RUN_REPORT_SCHEMA_VERSION } from "./run-report.js";
import { validateSniperRunReportDiff, SNIPER_RUN_REPORT_DIFF_SCHEMA_VERSION } from "./run-report-diff.js";
import { validateSniperPolicyConfig, SNIPER_POLICY_CONFIG_SCHEMA_VERSION } from "./policy-config.js";
import { validateSniperAuditLog, SNIPER_AUDIT_LOG_SCHEMA_VERSION } from "./audit-log.js";

/** Stable schema identifier for the session pack. Bump only on a breaking change. */
export const SNIPER_SESSION_PACK_SCHEMA_VERSION = "sniper.session.pack.v1";

/** The banner that prefixes every session pack (required label). */
export const SNIPER_SESSION_PACK_BANNER = "SIMULATED PAPER-ONLY SNIPER SESSION PACK";

/** Required disclaimer statements carried by every session pack (stable order). */
export const SNIPER_SESSION_PACK_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SNIPER SESSION PACK — a deterministic bundle of an operator's local sniper artifacts.",
  "Each artifact is classified by its schemaVersion; a KNOWN sniper schema is strictly validated and its flags read VERBATIM, while an UNKNOWN schema is surfaced honestly as `unsupported`.",
  "Chain-coverage tiers describe PRESENCE only (which artifact kinds are in the pack) — never completeness, correctness, or trading readiness.",
  "A `paper-enter` flag carried through is a SIMULATED classification — NOT a buy/sell order, NOT a transaction, and NOT live-trading readiness.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this pack.",
];

/** Thrown when session-pack INPUT or a produced pack is structurally invalid. */
export class SniperSessionPackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperSessionPackError";
  }
}

// --- model -------------------------------------------------------------------

/** The classified kind of one packed artifact (or `unsupported` for an unknown schema). */
export type SniperArtifactKind =
  | "candidate-list"
  | "token-preflight"
  | "paper-decision"
  | "workflow-plan"
  | "run-report"
  | "run-report-diff"
  | "policy-config"
  | "audit-log"
  | "unsupported";

/** The high-level flags extracted from one artifact (each `null` when not applicable to that kind). */
interface SniperArtifactFlags {
  candidateCount: number | null;
  hasPaperEnter: boolean | null;
  hasRiskBlock: boolean | null;
  hasUnknown: boolean | null;
  hasFailure: boolean | null;
}

/** One packed artifact's entry. */
export interface SniperSessionPackEntry {
  /** Operator-supplied label (the pack key; must be unique). */
  label: string;
  /** The artifact's own source label / path (null when none). */
  sourceLabel: string | null;
  /** The artifact's declared schemaVersion (null when absent / non-string). */
  schemaVersion: string | null;
  /** The classified kind, or `unsupported` for an unknown schema. */
  kind: SniperArtifactKind;
  /** True iff the schema was known AND the artifact validated. */
  recognized: boolean;
  candidateCount: number | null;
  hasPaperEnter: boolean | null;
  hasRiskBlock: boolean | null;
  hasUnknown: boolean | null;
  hasFailure: boolean | null;
  notes: string[];
}

/** Chain-coverage flags — PRESENCE only, never a completeness / correctness claim. */
export interface SniperSessionCoverage {
  hasCandidateList: boolean;
  hasPreflight: boolean;
  hasDecision: boolean;
  hasRunReport: boolean;
  hasAuditLog: boolean;
  hasPolicy: boolean;
  /** At least a candidate list is present. */
  isMinimal: boolean;
  /** Candidate list + preflight + decision are all present (PRESENCE only). */
  isDecisionReady: boolean;
  /** Decision-ready PLUS a run report and an audit log are present (PRESENCE only). */
  isAudited: boolean;
}

/** The full, deterministic, JSON-serializable session pack. */
export interface SniperSessionPack {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  sessionLabel: string | null;
  artifactCount: number;
  artifacts: SniperSessionPackEntry[];
  recognizedCount: number;
  unsupportedCount: number;
  /** The classified kinds present (sorted; excludes `unsupported`). */
  kindsPresent: string[];
  coverage: SniperSessionCoverage;
  // --- aggregate flags ---
  hasPaperEnter: boolean;
  hasRiskBlock: boolean;
  hasUnknown: boolean;
  hasFailure: boolean;
  hasUnsupported: boolean;
  ciFailReasons: string[];
  warnings: string[];
  notes: string[];
}

/** One artifact handed to {@link buildSniperSessionPack} (already loaded by the CLI). */
export interface SniperSessionPackArtifactInput {
  /** Operator-supplied label (the pack key; must be unique). */
  label: string;
  /** The artifact's source label / path (optional). */
  sourceLabel?: string | null;
  /** The parsed artifact value. */
  value: unknown;
}

/** Everything {@link buildSniperSessionPack} needs. */
export interface BuildSniperSessionPackInput {
  sessionLabel?: string | null;
  artifacts: SniperSessionPackArtifactInput[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

const NO_FLAGS: SniperArtifactFlags = { candidateCount: null, hasPaperEnter: null, hasRiskBlock: null, hasUnknown: null, hasFailure: null };

/** One registry entry: a known schema, its strict validator, and its flag extractor. */
interface Classifier {
  kind: SniperArtifactKind;
  validate: (v: unknown) => void;
  extract: (v: Record<string, unknown>) => SniperArtifactFlags;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/** The registry of KNOWN sniper schemas (schemaVersion → classifier). */
const REGISTRY: ReadonlyMap<string, Classifier> = new Map<string, Classifier>([
  [SNIPER_CANDIDATE_LIST_SCHEMA_VERSION, {
    kind: "candidate-list",
    validate: (v) => void validateSniperCandidateList(v),
    extract: (v) => ({ ...NO_FLAGS, candidateCount: num(v.candidateCount) }),
  }],
  [SNIPER_TOKEN_PREFLIGHT_REPORT_SCHEMA_VERSION, {
    kind: "token-preflight",
    validate: (v) => void validateSniperTokenPreflightReport(v),
    extract: (v) => ({ ...NO_FLAGS, candidateCount: num(v.candidateCount), hasUnknown: bool(v.hasUnknown), hasFailure: bool(v.hasFail) }),
  }],
  [SNIPER_PAPER_DECISION_REPORT_SCHEMA_VERSION, {
    kind: "paper-decision",
    validate: (v) => void validatePaperSniperDecisionReport(v),
    extract: (v) => ({ candidateCount: num(v.candidateCount), hasPaperEnter: bool(v.hasPaperEnter), hasRiskBlock: bool(v.hasRiskReject), hasUnknown: typeof v.unknownCount === "number" ? v.unknownCount > 0 : null, hasFailure: null }),
  }],
  [SNIPER_WORKFLOW_PLAN_SCHEMA_VERSION, {
    kind: "workflow-plan",
    validate: (v) => void validateSniperWorkflowPlan(v),
    extract: (v) => ({ ...NO_FLAGS, hasFailure: bool(v.hasInvalidArtifact) }),
  }],
  [SNIPER_RUN_REPORT_SCHEMA_VERSION, {
    kind: "run-report",
    validate: (v) => void validateSniperRunReport(v),
    extract: (v) => ({ candidateCount: num(v.candidateCount), hasPaperEnter: bool(v.hasPaperEnter), hasRiskBlock: bool(v.hasRiskBlock), hasUnknown: bool(v.hasUnknown), hasFailure: (v.hasInvalidCandidate === true || v.hasPreflightFailure === true) }),
  }],
  [SNIPER_RUN_REPORT_DIFF_SCHEMA_VERSION, {
    kind: "run-report-diff",
    validate: (v) => void validateSniperRunReportDiff(v),
    extract: (v) => ({ candidateCount: null, hasPaperEnter: bool(v.hasNewPaperEnter), hasRiskBlock: bool(v.hasNewRiskBlock), hasUnknown: bool(v.hasNewUnknown), hasFailure: (v.hasNewInvalid === true || v.hasNewPreflightFailure === true) }),
  }],
  [SNIPER_POLICY_CONFIG_SCHEMA_VERSION, {
    kind: "policy-config",
    validate: (v) => void validateSniperPolicyConfig(v),
    extract: () => ({ ...NO_FLAGS }),
  }],
  [SNIPER_AUDIT_LOG_SCHEMA_VERSION, {
    kind: "audit-log",
    validate: (v) => void validateSniperAuditLog(v),
    extract: (v) => ({ candidateCount: num(v.candidateCount), hasPaperEnter: bool(v.hasPaperEnter), hasRiskBlock: bool(v.hasRiskBlock), hasUnknown: bool(v.hasUnknown), hasFailure: bool(v.hasFailure) }),
  }],
]);

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link SniperSessionPack} from an already-loaded set of sniper artifacts. Pure
 * and non-mutating. Each artifact's `schemaVersion` is classified against the KNOWN-schema registry: a
 * known schema is STRICTLY validated (an artifact that CLAIMS a known schema but fails validation is
 * REFUSED) and its high-level flags read VERBATIM; an unknown / absent schema becomes an `unsupported`
 * entry (surfaced, never refused). Duplicate labels and a missing label are refused. Coverage tiers
 * describe PRESENCE only. Carries no wall-clock time. Throws {@link SniperSessionPackError} on invalid
 * structure or a corrupt known artifact.
 */
export function buildSniperSessionPack(input: BuildSniperSessionPackInput): SniperSessionPack {
  if (!isObject(input)) throw new SniperSessionPackError("session pack input must be an object");
  if (!Array.isArray(input.artifacts)) throw new SniperSessionPackError("session pack input.artifacts must be an array");
  if (input.artifacts.length === 0) throw new SniperSessionPackError("session pack input.artifacts must contain at least one artifact");
  if (input.sessionLabel !== undefined && input.sessionLabel !== null && typeof input.sessionLabel !== "string") {
    throw new SniperSessionPackError("session pack input.sessionLabel must be a string or null when present");
  }

  const seenLabels = new Set<string>();
  const artifacts: SniperSessionPackEntry[] = input.artifacts.map((a, i) => {
    if (!isObject(a) || !nonEmptyString(a.label)) {
      throw new SniperSessionPackError(`session pack artifact[${i}].label must be a non-empty string`);
    }
    const label = a.label.trim();
    if (seenLabels.has(label)) throw new SniperSessionPackError(`duplicate artifact label "${label}"`);
    seenLabels.add(label);
    if (a.sourceLabel !== undefined && a.sourceLabel !== null && typeof a.sourceLabel !== "string") {
      throw new SniperSessionPackError(`session pack artifact "${label}".sourceLabel must be a string or null`);
    }

    const value = a.value;
    const schemaVersion = isObject(value) && typeof value.schemaVersion === "string" ? value.schemaVersion : null;
    const classifier = schemaVersion !== null ? REGISTRY.get(schemaVersion) : undefined;

    if (classifier) {
      try {
        classifier.validate(value);
      } catch (err) {
        throw new SniperSessionPackError(`artifact "${label}" claims ${schemaVersion} but is invalid: ${(err as Error).message}`);
      }
      const flags = classifier.extract(value as Record<string, unknown>);
      return {
        label,
        sourceLabel: nonEmptyString(a.sourceLabel) ? a.sourceLabel : null,
        schemaVersion,
        kind: classifier.kind,
        recognized: true,
        ...flags,
        notes: [],
      };
    }

    return {
      label,
      sourceLabel: nonEmptyString(a.sourceLabel) ? a.sourceLabel : null,
      schemaVersion,
      kind: "unsupported",
      recognized: false,
      ...NO_FLAGS,
      notes: [schemaVersion === null ? "no schemaVersion — cannot classify" : `unknown schemaVersion "${schemaVersion}"`],
    };
  });

  const recognizedCount = artifacts.filter((a) => a.recognized).length;
  const unsupportedCount = artifacts.length - recognizedCount;
  const kindsPresent = [...new Set(artifacts.filter((a) => a.recognized).map((a) => a.kind))].sort();

  const has = (kind: SniperArtifactKind): boolean => artifacts.some((a) => a.kind === kind);
  const coverage: SniperSessionCoverage = {
    hasCandidateList: has("candidate-list"),
    hasPreflight: has("token-preflight"),
    hasDecision: has("paper-decision"),
    hasRunReport: has("run-report"),
    hasAuditLog: has("audit-log"),
    hasPolicy: has("policy-config"),
    isMinimal: has("candidate-list"),
    isDecisionReady: has("candidate-list") && has("token-preflight") && has("paper-decision"),
    isAudited: has("candidate-list") && has("token-preflight") && has("paper-decision") && has("run-report") && has("audit-log"),
  };

  const hasPaperEnter = artifacts.some((a) => a.hasPaperEnter === true);
  const hasRiskBlock = artifacts.some((a) => a.hasRiskBlock === true);
  const hasUnknown = artifacts.some((a) => a.hasUnknown === true);
  const hasFailure = artifacts.some((a) => a.hasFailure === true);
  const hasUnsupported = unsupportedCount > 0;

  const ciFailReasons: string[] = [];
  if (hasPaperEnter) ciFailReasons.push("at least one artifact carries a SIMULATED paper-enter.");
  if (hasRiskBlock) ciFailReasons.push("at least one artifact carries a risk block.");
  if (hasUnknown) ciFailReasons.push("at least one artifact carries an unknown classification.");
  if (hasFailure) ciFailReasons.push("at least one artifact carries a failure.");
  if (hasUnsupported) ciFailReasons.push(`${unsupportedCount} artifact(s) have an unsupported schema.`);

  const warnings: string[] = [];
  if (!coverage.hasCandidateList) warnings.push("no candidate list in the pack — the session has no intake spine.");
  if (hasUnsupported) warnings.push(`${unsupportedCount} unsupported artifact(s) were surfaced (not silently trusted).`);

  const notes = [
    `${artifacts.length} artifact(s): ${recognizedCount} recognized, ${unsupportedCount} unsupported.`,
    "Coverage tiers describe PRESENCE only — never completeness, correctness, or trading readiness.",
  ];

  return {
    schemaVersion: SNIPER_SESSION_PACK_SCHEMA_VERSION,
    banner: SNIPER_SESSION_PACK_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...SNIPER_SESSION_PACK_DISCLAIMERS],
    sessionLabel: nonEmptyString(input.sessionLabel) ? input.sessionLabel : null,
    artifactCount: artifacts.length,
    artifacts,
    recognizedCount,
    unsupportedCount,
    kindsPresent,
    coverage,
    hasPaperEnter,
    hasRiskBlock,
    hasUnknown,
    hasFailure,
    hasUnsupported,
    ciFailReasons,
    warnings,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

const KINDS: ReadonlySet<string> = new Set([
  "candidate-list", "token-preflight", "paper-decision", "workflow-plan",
  "run-report", "run-report-diff", "policy-config", "audit-log", "unsupported",
]);

function validateEntry(value: unknown, where: string): void {
  if (!isObject(value)) throw new SniperSessionPackError(`${where} must be an object`);
  if (!nonEmptyString(value.label)) throw new SniperSessionPackError(`${where}.label must be a non-empty string`);
  if (value.sourceLabel !== null && typeof value.sourceLabel !== "string") {
    throw new SniperSessionPackError(`${where}.sourceLabel must be a string or null`);
  }
  if (value.schemaVersion !== null && typeof value.schemaVersion !== "string") {
    throw new SniperSessionPackError(`${where}.schemaVersion must be a string or null`);
  }
  if (typeof value.kind !== "string" || !KINDS.has(value.kind)) {
    throw new SniperSessionPackError(`${where}.kind must be a known artifact kind`);
  }
  if (typeof value.recognized !== "boolean") throw new SniperSessionPackError(`${where}.recognized must be a boolean`);
  if (value.candidateCount !== null && (typeof value.candidateCount !== "number" || !Number.isInteger(value.candidateCount) || value.candidateCount < 0)) {
    throw new SniperSessionPackError(`${where}.candidateCount must be a non-negative integer or null`);
  }
  for (const f of ["hasPaperEnter", "hasRiskBlock", "hasUnknown", "hasFailure"] as const) {
    if (value[f] !== null && typeof value[f] !== "boolean") {
      throw new SniperSessionPackError(`${where}.${f} must be a boolean or null`);
    }
  }
  if (!Array.isArray(value.notes) || (value.notes as unknown[]).some((x) => typeof x !== "string")) {
    throw new SniperSessionPackError(`${where}.notes must be an array of strings`);
  }
}

/**
 * Strictly validate a value as a {@link SniperSessionPack} and return it narrowed. A backstop mirroring
 * the package's sibling validators. Throws {@link SniperSessionPackError} on the first problem. Pure.
 */
export function validateSniperSessionPack(value: unknown): SniperSessionPack {
  if (!isObject(value)) throw new SniperSessionPackError("session pack must be a JSON object");
  if (value.schemaVersion !== SNIPER_SESSION_PACK_SCHEMA_VERSION) {
    throw new SniperSessionPackError(`session pack.schemaVersion must be "${SNIPER_SESSION_PACK_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_SESSION_PACK_BANNER) {
    throw new SniperSessionPackError(`session pack.banner must be "${SNIPER_SESSION_PACK_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new SniperSessionPackError(`session pack.${flag} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperSessionPackError("session pack.disclaimers must be a non-empty array");
  }
  if (value.sessionLabel !== null && typeof value.sessionLabel !== "string") {
    throw new SniperSessionPackError("session pack.sessionLabel must be a string or null");
  }
  for (const f of ["artifactCount", "recognizedCount", "unsupportedCount"] as const) {
    if (typeof value[f] !== "number" || !Number.isInteger(value[f]) || (value[f] as number) < 0) {
      throw new SniperSessionPackError(`session pack.${f} must be a non-negative integer`);
    }
  }
  for (const f of ["hasPaperEnter", "hasRiskBlock", "hasUnknown", "hasFailure", "hasUnsupported"] as const) {
    if (typeof value[f] !== "boolean") throw new SniperSessionPackError(`session pack.${f} must be a boolean`);
  }
  for (const key of ["kindsPresent", "ciFailReasons", "warnings", "notes"] as const) {
    if (!Array.isArray(value[key]) || (value[key] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperSessionPackError(`session pack.${key} must be an array of strings`);
    }
  }
  if (!isObject(value.coverage)) throw new SniperSessionPackError("session pack.coverage must be an object");
  for (const f of ["hasCandidateList", "hasPreflight", "hasDecision", "hasRunReport", "hasAuditLog", "hasPolicy", "isMinimal", "isDecisionReady", "isAudited"] as const) {
    if (typeof (value.coverage as Record<string, unknown>)[f] !== "boolean") {
      throw new SniperSessionPackError(`session pack.coverage.${f} must be a boolean`);
    }
  }
  if (!Array.isArray(value.artifacts)) throw new SniperSessionPackError("session pack.artifacts must be an array");
  if ((value.artifacts as unknown[]).length !== value.artifactCount) {
    throw new SniperSessionPackError("session pack.artifacts length must equal artifactCount");
  }
  (value.artifacts as unknown[]).forEach((a, i) => validateEntry(a, `session pack.artifacts[${i}]`));
  return value as unknown as SniperSessionPack;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperSessionPack}. */
export interface FormatSniperSessionPackOptions {
  label?: string;
}

function flag(value: boolean | null): string {
  return value === null ? "—" : value ? "YES" : "no";
}

/**
 * Render a redacted, stable, human-readable session pack. Deterministic and path-stable (no timestamps).
 * Leads with the PAPER-ONLY banner and the artifact inventory, lists each artifact's kind / recognized
 * status / flags, summarizes the presence-only coverage tiers, and closes with the CI verdict and the
 * not-a-trade-signal disclaimers. The whole output is passed through the shared redactor.
 */
export function formatSniperSessionPack(pack: SniperSessionPack, opts: FormatSniperSessionPackOptions = {}): string {
  const header = `${pack.banner} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];
  if (opts.label) lines.push(`label:    ${opts.label}`);
  lines.push(`session:  ${pack.sessionLabel ?? "(unlabeled)"}`);
  lines.push(`artifacts: ${pack.artifactCount} (${pack.recognizedCount} recognized / ${pack.unsupportedCount} unsupported)`);
  lines.push(`kinds:    ${pack.kindsPresent.length > 0 ? pack.kindsPresent.join(", ") : "(none recognized)"}`);

  lines.push("");
  lines.push("Artifacts:");
  for (const a of pack.artifacts) {
    lines.push(`- ${a.label}  [${a.kind}${a.recognized ? "" : " · UNSUPPORTED"}]${a.sourceLabel ? `  (${a.sourceLabel})` : ""}`);
    const bits = [`paper-enter=${flag(a.hasPaperEnter)}`, `risk=${flag(a.hasRiskBlock)}`, `unknown=${flag(a.hasUnknown)}`, `failure=${flag(a.hasFailure)}`];
    lines.push(`    ${bits.join("  ")}${a.candidateCount !== null ? `  candidates=${a.candidateCount}` : ""}`);
    for (const n of a.notes) lines.push(`    · ${n}`);
  }

  lines.push("");
  lines.push("Coverage (PRESENCE only — not completeness or readiness):");
  lines.push(`- candidate list: ${flag(pack.coverage.hasCandidateList)}   preflight: ${flag(pack.coverage.hasPreflight)}   decision: ${flag(pack.coverage.hasDecision)}`);
  lines.push(`- run report: ${flag(pack.coverage.hasRunReport)}   audit log: ${flag(pack.coverage.hasAuditLog)}   policy: ${flag(pack.coverage.hasPolicy)}`);
  lines.push(`- tiers: minimal=${flag(pack.coverage.isMinimal)}  decision-ready=${flag(pack.coverage.isDecisionReady)}  audited=${flag(pack.coverage.isAudited)}`);

  lines.push("");
  lines.push(`Any paper-enter (SIMULATED): ${pack.hasPaperEnter ? "YES" : "no"}`);
  lines.push(`Any risk block:              ${pack.hasRiskBlock ? "YES" : "no"}`);
  lines.push(`Any unknown:                 ${pack.hasUnknown ? "YES" : "no"}`);
  lines.push(`Any failure:                 ${pack.hasFailure ? "YES" : "no"}`);
  lines.push(`Any unsupported:             ${pack.hasUnsupported ? "YES" : "no"}`);
  if (pack.ciFailReasons.length > 0) {
    lines.push("CI gate reasons:");
    for (const r of pack.ciFailReasons) lines.push(`- ${r}`);
  }

  if (pack.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of pack.warnings) lines.push(`- ${w}`);
  }

  lines.push("");
  lines.push("Notes:");
  for (const note of pack.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of pack.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
