/**
 * Deterministic, offline, **PAPER-only** SNIPER SESSION PACK **V2** (Sprint 57).
 *
 * V2 = the v1 session pack's classify-and-bundle model with a registry that understands the WHOLE
 * v2 surface: the preflight input artifact, policy v2, decision v2, run report v2, safety gates
 * (v1 + v2), the Phase-6 prerequisite trackers (v1 + v2), and the three spec artifacts
 * (kill-switch / secrets policy / burner isolation) — alongside every v1 schema the v1 pack knows.
 *
 * Each artifact is classified by its `schemaVersion`: a KNOWN schema is STRICTLY validated (an
 * artifact that claims a known schema but fails validation is REFUSED) and its high-level flags are
 * read VERBATIM — including `adopted` for the spec artifacts and `ready` for gates/prerequisite
 * reports; an UNKNOWN schema is surfaced honestly as `unsupported`. Coverage tiers (including the
 * new `isV2DecisionReady` / `isSpecComplete` / `isV2Audited`) describe PRESENCE only — never
 * completeness, correctness, or trading readiness.
 *
 * V1 is fully preserved: `sniper.session.pack.v1` keeps building/validating unchanged. It is
 * **pure**, does NO filesystem / network / RPC / wallet work, and carries no wall-clock time. A
 * `paper-enter` flag carried through is a SIMULATED classification — never a buy/sell order.
 */

import { redactString } from "@soulmaker/security";
import { validateSniperCandidateList, SNIPER_CANDIDATE_LIST_SCHEMA_VERSION } from "./candidate-list.js";
import { validateSniperTokenPreflightReport, SNIPER_TOKEN_PREFLIGHT_REPORT_SCHEMA_VERSION } from "./token-preflight.js";
import { validateSniperPreflightInput, SNIPER_PREFLIGHT_INPUT_SCHEMA_VERSION } from "./preflight-input.js";
import { validatePaperSniperDecisionReport, SNIPER_PAPER_DECISION_REPORT_SCHEMA_VERSION } from "./paper-decision.js";
import { validatePaperSniperDecisionReportV2, SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION } from "./paper-decision-v2.js";
import { validateSniperWorkflowPlan, SNIPER_WORKFLOW_PLAN_SCHEMA_VERSION } from "./workflow.js";
import { validateSniperRunReport, SNIPER_RUN_REPORT_SCHEMA_VERSION } from "./run-report.js";
import { validateSniperRunReportV2, SNIPER_RUN_REPORT_V2_SCHEMA_VERSION } from "./run-report-v2.js";
import { validateSniperRunReportDiff, SNIPER_RUN_REPORT_DIFF_SCHEMA_VERSION } from "./run-report-diff.js";
import { validateSniperPolicyConfig, SNIPER_POLICY_CONFIG_SCHEMA_VERSION } from "./policy-config.js";
import { validateSniperPolicyConfigV2, SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION } from "./policy-config-v2.js";
import { validateSniperAuditLog, SNIPER_AUDIT_LOG_SCHEMA_VERSION } from "./audit-log.js";
import { validateSniperSafetyGatesReport, SNIPER_SAFETY_GATES_REPORT_SCHEMA_VERSION } from "./safety-gates.js";
import { validateSniperSafetyGatesReportV2, SNIPER_SAFETY_GATES_REPORT_V2_SCHEMA_VERSION } from "./safety-gates-v2.js";
import { validatePhase6PrerequisiteReport, PHASE6_PREREQUISITE_REPORT_SCHEMA_VERSION } from "./phase6-prereqs.js";
import { validatePhase6PrerequisiteReportV2, PHASE6_PREREQUISITE_REPORT_V2_SCHEMA_VERSION } from "./phase6-prereqs-v2.js";
import { validateSniperKillSwitchSpec, SNIPER_KILL_SWITCH_SPEC_SCHEMA_VERSION } from "./kill-switch-spec.js";
import { validateSniperSecretsPolicy, SNIPER_SECRETS_POLICY_SCHEMA_VERSION } from "./secrets-policy.js";
import { validateSniperBurnerIsolationSpec, SNIPER_BURNER_ISOLATION_SPEC_SCHEMA_VERSION } from "./burner-isolation-spec.js";
import type { SniperSessionPackArtifactInput } from "./session-pack.js";

/** Stable schema identifier for the v2 session pack. Bump only on a breaking change. */
export const SNIPER_SESSION_PACK_V2_SCHEMA_VERSION = "sniper.session.pack.v2";

/** The banner that prefixes every v2 session pack (required label). */
export const SNIPER_SESSION_PACK_V2_BANNER = "SIMULATED PAPER-ONLY SNIPER SESSION PACK V2";

/** Required disclaimer statements carried by every v2 session pack (stable order). */
export const SNIPER_SESSION_PACK_V2_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SNIPER SESSION PACK V2 — a deterministic bundle of an operator's local sniper artifacts, understanding the whole v2 surface plus the spec artifacts.",
  "Each artifact is classified by its schemaVersion; a KNOWN schema is strictly validated and its flags read VERBATIM (including spec adoption and gates/prereq readiness), while an UNKNOWN schema is surfaced honestly as `unsupported`.",
  "Coverage tiers describe PRESENCE only (which artifact kinds are in the pack) — never completeness, correctness, or trading readiness.",
  "A `paper-enter` flag carried through is a SIMULATED classification — NOT a buy/sell order, NOT a transaction, and NOT live-trading readiness.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this pack.",
];

/** Thrown when v2 session-pack INPUT or a produced pack is structurally invalid. */
export class SniperSessionPackV2Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperSessionPackV2Error";
  }
}

// --- model -------------------------------------------------------------------

/** The classified kind of one packed artifact (or `unsupported` for an unknown schema). */
export type SniperArtifactKindV2 =
  | "candidate-list"
  | "token-preflight"
  | "preflight-input"
  | "paper-decision"
  | "paper-decision-v2"
  | "workflow-plan"
  | "run-report"
  | "run-report-v2"
  | "run-report-diff"
  | "policy-config"
  | "policy-config-v2"
  | "audit-log"
  | "safety-gates"
  | "safety-gates-v2"
  | "phase6-prereq"
  | "phase6-prereq-v2"
  | "kill-switch-spec"
  | "secrets-policy"
  | "burner-isolation-spec"
  | "unsupported";

/** The high-level flags extracted from one artifact (each `null` when not applicable to that kind). */
interface SniperArtifactFlagsV2 {
  candidateCount: number | null;
  hasPaperEnter: boolean | null;
  hasRiskBlock: boolean | null;
  hasUnknown: boolean | null;
  hasFailure: boolean | null;
  /** Spec artifacts only: whether the operator ADOPTED the spec (verbatim). */
  adopted: boolean | null;
  /** Gates: `ready`; prereq v2: `phase6ImplementationReady`; prereq v1: `allPrerequisitesAddressed` (verbatim). */
  ready: boolean | null;
}

/** One packed artifact's v2 entry. */
export interface SniperSessionPackEntryV2 extends SniperArtifactFlagsV2 {
  /** Operator-supplied label (the pack key; must be unique). */
  label: string;
  /** The artifact's own source label / path (null when none). */
  sourceLabel: string | null;
  /** The artifact's declared schemaVersion (null when absent / non-string). */
  schemaVersion: string | null;
  /** The classified kind, or `unsupported` for an unknown schema. */
  kind: SniperArtifactKindV2;
  /** True iff the schema was known AND the artifact validated. */
  recognized: boolean;
  notes: string[];
}

/** Chain-coverage flags — PRESENCE only, never a completeness / correctness claim. */
export interface SniperSessionCoverageV2 {
  hasCandidateList: boolean;
  hasPreflight: boolean;
  hasPreflightInput: boolean;
  /** A decision report of EITHER version is present. */
  hasDecision: boolean;
  hasDecisionV2: boolean;
  /** A run report of EITHER version is present. */
  hasRunReport: boolean;
  hasRunReportV2: boolean;
  hasAuditLog: boolean;
  /** A policy config of EITHER version is present. */
  hasPolicy: boolean;
  hasPolicyV2: boolean;
  hasSafetyGatesV2: boolean;
  hasPhase6PrereqV2: boolean;
  hasKillSwitchSpec: boolean;
  hasSecretsPolicy: boolean;
  hasBurnerIsolationSpec: boolean;
  /** At least a candidate list is present. */
  isMinimal: boolean;
  /** Candidate list + preflight + a decision (either version) are present (PRESENCE only). */
  isDecisionReady: boolean;
  /** Candidate list + preflight + a V2 decision are present (PRESENCE only). */
  isV2DecisionReady: boolean;
  /** All three spec artifacts are present (PRESENCE only — adoption is per-entry). */
  isSpecComplete: boolean;
  /** V2-decision-ready PLUS a v2 run report and an audit log are present (PRESENCE only). */
  isV2Audited: boolean;
}

/** The full, deterministic, JSON-serializable v2 session pack. */
export interface SniperSessionPackV2 {
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
  artifacts: SniperSessionPackEntryV2[];
  recognizedCount: number;
  unsupportedCount: number;
  /** The classified kinds present (sorted; excludes `unsupported`). */
  kindsPresent: string[];
  coverage: SniperSessionCoverageV2;
  // --- aggregate flags ---
  hasPaperEnter: boolean;
  hasRiskBlock: boolean;
  hasUnknown: boolean;
  hasFailure: boolean;
  hasUnsupported: boolean;
  /** Any spec artifact in the pack is NOT adopted (adoption read verbatim). */
  hasNotAdoptedSpec: boolean;
  ciFailReasons: string[];
  warnings: string[];
  notes: string[];
}

/** Everything {@link buildSniperSessionPackV2} needs (same input shape as v1). */
export interface BuildSniperSessionPackV2Input {
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

const NO_FLAGS: SniperArtifactFlagsV2 = {
  candidateCount: null, hasPaperEnter: null, hasRiskBlock: null, hasUnknown: null, hasFailure: null, adopted: null, ready: null,
};

interface ClassifierV2 {
  kind: SniperArtifactKindV2;
  validate: (v: unknown) => void;
  extract: (v: Record<string, unknown>) => SniperArtifactFlagsV2;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

const decisionFlags = (v: Record<string, unknown>): SniperArtifactFlagsV2 => ({
  ...NO_FLAGS,
  candidateCount: num(v.candidateCount),
  hasPaperEnter: bool(v.hasPaperEnter),
  hasRiskBlock: bool(v.hasRiskReject),
  hasUnknown: typeof v.unknownCount === "number" ? v.unknownCount > 0 : null,
});

const runReportFlags = (v: Record<string, unknown>): SniperArtifactFlagsV2 => ({
  ...NO_FLAGS,
  candidateCount: num(v.candidateCount),
  hasPaperEnter: bool(v.hasPaperEnter),
  hasRiskBlock: bool(v.hasRiskBlock),
  hasUnknown: bool(v.hasUnknown),
  hasFailure: v.hasInvalidCandidate === true || v.hasPreflightFailure === true,
});

/** The v2 registry of KNOWN schemas (schemaVersion → classifier). */
const REGISTRY_V2: ReadonlyMap<string, ClassifierV2> = new Map<string, ClassifierV2>([
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
  [SNIPER_PREFLIGHT_INPUT_SCHEMA_VERSION, {
    kind: "preflight-input",
    validate: (v) => void validateSniperPreflightInput(v),
    extract: (v) => ({ ...NO_FLAGS, hasUnknown: typeof v.missingInspectionCount === "number" && typeof v.missingRiskCount === "number" ? (v.missingInspectionCount as number) > 0 || (v.missingRiskCount as number) > 0 : null }),
  }],
  [SNIPER_PAPER_DECISION_REPORT_SCHEMA_VERSION, {
    kind: "paper-decision",
    validate: (v) => void validatePaperSniperDecisionReport(v),
    extract: decisionFlags,
  }],
  [SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION, {
    kind: "paper-decision-v2",
    validate: (v) => void validatePaperSniperDecisionReportV2(v),
    extract: decisionFlags,
  }],
  [SNIPER_WORKFLOW_PLAN_SCHEMA_VERSION, {
    kind: "workflow-plan",
    validate: (v) => void validateSniperWorkflowPlan(v),
    extract: (v) => ({ ...NO_FLAGS, hasFailure: bool(v.hasInvalidArtifact) }),
  }],
  [SNIPER_RUN_REPORT_SCHEMA_VERSION, {
    kind: "run-report",
    validate: (v) => void validateSniperRunReport(v),
    extract: runReportFlags,
  }],
  [SNIPER_RUN_REPORT_V2_SCHEMA_VERSION, {
    kind: "run-report-v2",
    validate: (v) => void validateSniperRunReportV2(v),
    extract: runReportFlags,
  }],
  [SNIPER_RUN_REPORT_DIFF_SCHEMA_VERSION, {
    kind: "run-report-diff",
    validate: (v) => void validateSniperRunReportDiff(v),
    extract: (v) => ({ ...NO_FLAGS, hasPaperEnter: bool(v.hasNewPaperEnter), hasRiskBlock: bool(v.hasNewRiskBlock), hasUnknown: bool(v.hasNewUnknown), hasFailure: v.hasNewInvalid === true || v.hasNewPreflightFailure === true }),
  }],
  [SNIPER_POLICY_CONFIG_SCHEMA_VERSION, {
    kind: "policy-config",
    validate: (v) => void validateSniperPolicyConfig(v),
    extract: () => ({ ...NO_FLAGS }),
  }],
  [SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION, {
    kind: "policy-config-v2",
    validate: (v) => void validateSniperPolicyConfigV2(v),
    extract: () => ({ ...NO_FLAGS }),
  }],
  [SNIPER_AUDIT_LOG_SCHEMA_VERSION, {
    kind: "audit-log",
    validate: (v) => void validateSniperAuditLog(v),
    extract: (v) => ({ ...NO_FLAGS, candidateCount: num(v.candidateCount), hasPaperEnter: bool(v.hasPaperEnter), hasRiskBlock: bool(v.hasRiskBlock), hasUnknown: bool(v.hasUnknown), hasFailure: bool(v.hasFailure) }),
  }],
  [SNIPER_SAFETY_GATES_REPORT_SCHEMA_VERSION, {
    kind: "safety-gates",
    validate: (v) => void validateSniperSafetyGatesReport(v),
    extract: (v) => ({ ...NO_FLAGS, hasFailure: bool(v.hasFailure), ready: bool(v.ready) }),
  }],
  [SNIPER_SAFETY_GATES_REPORT_V2_SCHEMA_VERSION, {
    kind: "safety-gates-v2",
    validate: (v) => void validateSniperSafetyGatesReportV2(v),
    extract: (v) => ({ ...NO_FLAGS, hasFailure: bool(v.hasFailure), ready: bool(v.ready) }),
  }],
  [PHASE6_PREREQUISITE_REPORT_SCHEMA_VERSION, {
    kind: "phase6-prereq",
    validate: (v) => void validatePhase6PrerequisiteReport(v),
    extract: (v) => ({ ...NO_FLAGS, ready: bool(v.allPrerequisitesAddressed) }),
  }],
  [PHASE6_PREREQUISITE_REPORT_V2_SCHEMA_VERSION, {
    kind: "phase6-prereq-v2",
    validate: (v) => void validatePhase6PrerequisiteReportV2(v),
    extract: (v) => ({ ...NO_FLAGS, ready: bool(v.phase6ImplementationReady) }),
  }],
  [SNIPER_KILL_SWITCH_SPEC_SCHEMA_VERSION, {
    kind: "kill-switch-spec",
    validate: (v) => void validateSniperKillSwitchSpec(v),
    extract: (v) => ({ ...NO_FLAGS, adopted: bool(v.adopted) }),
  }],
  [SNIPER_SECRETS_POLICY_SCHEMA_VERSION, {
    kind: "secrets-policy",
    validate: (v) => void validateSniperSecretsPolicy(v),
    extract: (v) => ({ ...NO_FLAGS, adopted: bool(v.adopted) }),
  }],
  [SNIPER_BURNER_ISOLATION_SPEC_SCHEMA_VERSION, {
    kind: "burner-isolation-spec",
    validate: (v) => void validateSniperBurnerIsolationSpec(v),
    extract: (v) => ({ ...NO_FLAGS, adopted: bool(v.adopted) }),
  }],
]);

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link SniperSessionPackV2} from an already-loaded set of sniper artifacts.
 * Pure and non-mutating. Classification mirrors v1 (known schema ⇒ strictly validated, flags read
 * VERBATIM; unknown schema ⇒ `unsupported`, surfaced, never refused) over the FULL v2 registry —
 * 19 known schemas including the spec artifacts. Duplicate labels and a missing label are refused.
 * Coverage tiers describe PRESENCE only. Carries no wall-clock time. Throws
 * {@link SniperSessionPackV2Error} on invalid structure or a corrupt known artifact.
 */
export function buildSniperSessionPackV2(input: BuildSniperSessionPackV2Input): SniperSessionPackV2 {
  if (!isObject(input)) throw new SniperSessionPackV2Error("session pack v2 input must be an object");
  if (!Array.isArray(input.artifacts)) throw new SniperSessionPackV2Error("session pack v2 input.artifacts must be an array");
  if (input.artifacts.length === 0) throw new SniperSessionPackV2Error("session pack v2 input.artifacts must contain at least one artifact");
  if (input.sessionLabel !== undefined && input.sessionLabel !== null && typeof input.sessionLabel !== "string") {
    throw new SniperSessionPackV2Error("session pack v2 input.sessionLabel must be a string or null when present");
  }

  const seenLabels = new Set<string>();
  const artifacts: SniperSessionPackEntryV2[] = input.artifacts.map((a, i) => {
    if (!isObject(a) || !nonEmptyString(a.label)) {
      throw new SniperSessionPackV2Error(`session pack artifact[${i}].label must be a non-empty string`);
    }
    const label = a.label.trim();
    if (seenLabels.has(label)) throw new SniperSessionPackV2Error(`duplicate artifact label "${label}"`);
    seenLabels.add(label);
    if (a.sourceLabel !== undefined && a.sourceLabel !== null && typeof a.sourceLabel !== "string") {
      throw new SniperSessionPackV2Error(`session pack artifact "${label}".sourceLabel must be a string or null`);
    }

    const value = a.value;
    const schemaVersion = isObject(value) && typeof value.schemaVersion === "string" ? value.schemaVersion : null;
    const classifier = schemaVersion !== null ? REGISTRY_V2.get(schemaVersion) : undefined;

    if (classifier) {
      try {
        classifier.validate(value);
      } catch (err) {
        throw new SniperSessionPackV2Error(`artifact "${label}" claims ${schemaVersion} but is invalid: ${(err as Error).message}`);
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
      kind: "unsupported" as const,
      recognized: false,
      ...NO_FLAGS,
      notes: [schemaVersion === null ? "no schemaVersion — cannot classify" : `unknown schemaVersion "${schemaVersion}"`],
    };
  });

  const recognizedCount = artifacts.filter((a) => a.recognized).length;
  const unsupportedCount = artifacts.length - recognizedCount;
  const kindsPresent = [...new Set(artifacts.filter((a) => a.recognized).map((a) => a.kind))].sort();

  const has = (kind: SniperArtifactKindV2): boolean => artifacts.some((a) => a.kind === kind);
  const coverage: SniperSessionCoverageV2 = {
    hasCandidateList: has("candidate-list"),
    hasPreflight: has("token-preflight"),
    hasPreflightInput: has("preflight-input"),
    hasDecision: has("paper-decision") || has("paper-decision-v2"),
    hasDecisionV2: has("paper-decision-v2"),
    hasRunReport: has("run-report") || has("run-report-v2"),
    hasRunReportV2: has("run-report-v2"),
    hasAuditLog: has("audit-log"),
    hasPolicy: has("policy-config") || has("policy-config-v2"),
    hasPolicyV2: has("policy-config-v2"),
    hasSafetyGatesV2: has("safety-gates-v2"),
    hasPhase6PrereqV2: has("phase6-prereq-v2"),
    hasKillSwitchSpec: has("kill-switch-spec"),
    hasSecretsPolicy: has("secrets-policy"),
    hasBurnerIsolationSpec: has("burner-isolation-spec"),
    isMinimal: has("candidate-list"),
    isDecisionReady: has("candidate-list") && has("token-preflight") && (has("paper-decision") || has("paper-decision-v2")),
    isV2DecisionReady: has("candidate-list") && has("token-preflight") && has("paper-decision-v2"),
    isSpecComplete: has("kill-switch-spec") && has("secrets-policy") && has("burner-isolation-spec"),
    isV2Audited:
      has("candidate-list") && has("token-preflight") && has("paper-decision-v2") && has("run-report-v2") && has("audit-log"),
  };

  const hasPaperEnter = artifacts.some((a) => a.hasPaperEnter === true);
  const hasRiskBlock = artifacts.some((a) => a.hasRiskBlock === true);
  const hasUnknown = artifacts.some((a) => a.hasUnknown === true);
  const hasFailure = artifacts.some((a) => a.hasFailure === true);
  const hasUnsupported = unsupportedCount > 0;
  const hasNotAdoptedSpec = artifacts.some((a) => a.adopted === false);

  const ciFailReasons: string[] = [];
  if (hasPaperEnter) ciFailReasons.push("at least one artifact carries a SIMULATED paper-enter.");
  if (hasRiskBlock) ciFailReasons.push("at least one artifact carries a risk block.");
  if (hasUnknown) ciFailReasons.push("at least one artifact carries an unknown classification.");
  if (hasFailure) ciFailReasons.push("at least one artifact carries a failure.");
  if (hasUnsupported) ciFailReasons.push(`${unsupportedCount} artifact(s) have an unsupported schema.`);
  if (hasNotAdoptedSpec) ciFailReasons.push("at least one spec artifact is NOT adopted.");

  const warnings: string[] = [];
  if (!coverage.hasCandidateList) warnings.push("no candidate list in the pack — the session has no intake spine.");
  if (hasUnsupported) warnings.push(`${unsupportedCount} unsupported artifact(s) were surfaced (not silently trusted).`);
  if (hasNotAdoptedSpec) warnings.push("a spec artifact in the pack is not adopted — the Phase-6 spec buckets need ADOPTED specs.");

  const notes = [
    `${artifacts.length} artifact(s): ${recognizedCount} recognized, ${unsupportedCount} unsupported.`,
    "Coverage tiers describe PRESENCE only — never completeness, correctness, or trading readiness.",
  ];

  return {
    schemaVersion: SNIPER_SESSION_PACK_V2_SCHEMA_VERSION,
    banner: SNIPER_SESSION_PACK_V2_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...SNIPER_SESSION_PACK_V2_DISCLAIMERS],
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
    hasNotAdoptedSpec,
    ciFailReasons,
    warnings,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

const KINDS_V2: ReadonlySet<string> = new Set([
  "candidate-list", "token-preflight", "preflight-input", "paper-decision", "paper-decision-v2",
  "workflow-plan", "run-report", "run-report-v2", "run-report-diff", "policy-config", "policy-config-v2",
  "audit-log", "safety-gates", "safety-gates-v2", "phase6-prereq", "phase6-prereq-v2",
  "kill-switch-spec", "secrets-policy", "burner-isolation-spec", "unsupported",
]);

const COVERAGE_FIELDS = [
  "hasCandidateList", "hasPreflight", "hasPreflightInput", "hasDecision", "hasDecisionV2",
  "hasRunReport", "hasRunReportV2", "hasAuditLog", "hasPolicy", "hasPolicyV2",
  "hasSafetyGatesV2", "hasPhase6PrereqV2", "hasKillSwitchSpec", "hasSecretsPolicy", "hasBurnerIsolationSpec",
  "isMinimal", "isDecisionReady", "isV2DecisionReady", "isSpecComplete", "isV2Audited",
] as const;

function validateEntryV2(value: unknown, where: string): void {
  if (!isObject(value)) throw new SniperSessionPackV2Error(`${where} must be an object`);
  if (!nonEmptyString(value.label)) throw new SniperSessionPackV2Error(`${where}.label must be a non-empty string`);
  if (value.sourceLabel !== null && typeof value.sourceLabel !== "string") {
    throw new SniperSessionPackV2Error(`${where}.sourceLabel must be a string or null`);
  }
  if (value.schemaVersion !== null && typeof value.schemaVersion !== "string") {
    throw new SniperSessionPackV2Error(`${where}.schemaVersion must be a string or null`);
  }
  if (typeof value.kind !== "string" || !KINDS_V2.has(value.kind)) {
    throw new SniperSessionPackV2Error(`${where}.kind must be a known artifact kind`);
  }
  if (typeof value.recognized !== "boolean") throw new SniperSessionPackV2Error(`${where}.recognized must be a boolean`);
  if (value.candidateCount !== null && (typeof value.candidateCount !== "number" || !Number.isInteger(value.candidateCount) || value.candidateCount < 0)) {
    throw new SniperSessionPackV2Error(`${where}.candidateCount must be a non-negative integer or null`);
  }
  for (const f of ["hasPaperEnter", "hasRiskBlock", "hasUnknown", "hasFailure", "adopted", "ready"] as const) {
    if (value[f] !== null && typeof value[f] !== "boolean") {
      throw new SniperSessionPackV2Error(`${where}.${f} must be a boolean or null`);
    }
  }
  if (!Array.isArray(value.notes) || (value.notes as unknown[]).some((x) => typeof x !== "string")) {
    throw new SniperSessionPackV2Error(`${where}.notes must be an array of strings`);
  }
}

/**
 * Strictly validate a value as a {@link SniperSessionPackV2} and return it narrowed. A backstop
 * mirroring the package's sibling validators (the aggregate `hasNotAdoptedSpec` is recomputed from
 * the entries and compared). Throws {@link SniperSessionPackV2Error} on the first problem. Pure.
 */
export function validateSniperSessionPackV2(value: unknown): SniperSessionPackV2 {
  if (!isObject(value)) throw new SniperSessionPackV2Error("session pack v2 must be a JSON object");
  if (value.schemaVersion !== SNIPER_SESSION_PACK_V2_SCHEMA_VERSION) {
    throw new SniperSessionPackV2Error(`session pack v2.schemaVersion must be "${SNIPER_SESSION_PACK_V2_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_SESSION_PACK_V2_BANNER) {
    throw new SniperSessionPackV2Error(`session pack v2.banner must be "${SNIPER_SESSION_PACK_V2_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new SniperSessionPackV2Error(`session pack v2.${flag} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperSessionPackV2Error("session pack v2.disclaimers must be a non-empty array");
  }
  if (value.sessionLabel !== null && typeof value.sessionLabel !== "string") {
    throw new SniperSessionPackV2Error("session pack v2.sessionLabel must be a string or null");
  }
  for (const f of ["artifactCount", "recognizedCount", "unsupportedCount"] as const) {
    if (typeof value[f] !== "number" || !Number.isInteger(value[f]) || (value[f] as number) < 0) {
      throw new SniperSessionPackV2Error(`session pack v2.${f} must be a non-negative integer`);
    }
  }
  for (const f of ["hasPaperEnter", "hasRiskBlock", "hasUnknown", "hasFailure", "hasUnsupported", "hasNotAdoptedSpec"] as const) {
    if (typeof value[f] !== "boolean") throw new SniperSessionPackV2Error(`session pack v2.${f} must be a boolean`);
  }
  for (const key of ["kindsPresent", "ciFailReasons", "warnings", "notes"] as const) {
    if (!Array.isArray(value[key]) || (value[key] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperSessionPackV2Error(`session pack v2.${key} must be an array of strings`);
    }
  }
  if (!isObject(value.coverage)) throw new SniperSessionPackV2Error("session pack v2.coverage must be an object");
  for (const f of COVERAGE_FIELDS) {
    if (typeof (value.coverage as Record<string, unknown>)[f] !== "boolean") {
      throw new SniperSessionPackV2Error(`session pack v2.coverage.${f} must be a boolean`);
    }
  }
  if (!Array.isArray(value.artifacts)) throw new SniperSessionPackV2Error("session pack v2.artifacts must be an array");
  if ((value.artifacts as unknown[]).length !== value.artifactCount) {
    throw new SniperSessionPackV2Error("session pack v2.artifacts length must equal artifactCount");
  }
  (value.artifacts as unknown[]).forEach((a, i) => validateEntryV2(a, `session pack v2.artifacts[${i}]`));
  const expectedNotAdopted = (value.artifacts as { adopted: boolean | null }[]).some((a) => a.adopted === false);
  if (value.hasNotAdoptedSpec !== expectedNotAdopted) {
    throw new SniperSessionPackV2Error("session pack v2.hasNotAdoptedSpec must mirror the entries");
  }
  return value as unknown as SniperSessionPackV2;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperSessionPackV2}. */
export interface FormatSniperSessionPackV2Options {
  label?: string;
}

function flag(value: boolean | null): string {
  return value === null ? "—" : value ? "YES" : "no";
}

/**
 * Render a redacted, stable, human-readable v2 session pack. Deterministic and path-stable. Leads
 * with the PAPER-ONLY banner and the artifact inventory, lists each artifact's kind / flags
 * (including spec adoption and gates/prereq readiness), summarizes the presence-only coverage
 * tiers, and closes with the CI verdict and the disclaimers. Passed through the shared redactor.
 */
export function formatSniperSessionPackV2(pack: SniperSessionPackV2, opts: FormatSniperSessionPackV2Options = {}): string {
  const header = `${pack.banner} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];
  if (opts.label) lines.push(`label:    ${opts.label}`);
  lines.push(`session:  ${pack.sessionLabel ?? "(unlabeled)"}`);
  lines.push(`artifacts: ${pack.artifactCount} (${pack.recognizedCount} recognized / ${pack.unsupportedCount} unsupported)`);
  lines.push(`kinds:    ${pack.kindsPresent.length > 0 ? pack.kindsPresent.join(", ") : "(none)"}`);

  lines.push("");
  lines.push("Artifacts:");
  for (const a of pack.artifacts) {
    lines.push(`- ${a.label}  [${a.kind}]${a.recognized ? "" : " (UNSUPPORTED)"}`);
    const facts: string[] = [];
    if (a.candidateCount !== null) facts.push(`candidates=${a.candidateCount}`);
    if (a.hasPaperEnter !== null) facts.push(`paper-enter=${flag(a.hasPaperEnter)}`);
    if (a.hasRiskBlock !== null) facts.push(`risk-block=${flag(a.hasRiskBlock)}`);
    if (a.hasUnknown !== null) facts.push(`unknown=${flag(a.hasUnknown)}`);
    if (a.hasFailure !== null) facts.push(`failure=${flag(a.hasFailure)}`);
    if (a.adopted !== null) facts.push(`adopted=${flag(a.adopted)}`);
    if (a.ready !== null) facts.push(`ready=${flag(a.ready)}`);
    if (facts.length > 0) lines.push(`    ${facts.join("  ")}`);
    for (const n of a.notes) lines.push(`    · ${n}`);
  }

  lines.push("");
  lines.push("Coverage (PRESENCE only — never completeness or readiness):");
  lines.push(`- minimal (candidates):            ${flag(pack.coverage.isMinimal)}`);
  lines.push(`- decision-ready (either version): ${flag(pack.coverage.isDecisionReady)}`);
  lines.push(`- v2 decision-ready:               ${flag(pack.coverage.isV2DecisionReady)}`);
  lines.push(`- spec-complete (3 specs present): ${flag(pack.coverage.isSpecComplete)}`);
  lines.push(`- v2 audited:                      ${flag(pack.coverage.isV2Audited)}`);
  lines.push(`- preflight input present:         ${flag(pack.coverage.hasPreflightInput)}`);
  lines.push(`- safety gates v2 present:         ${flag(pack.coverage.hasSafetyGatesV2)}`);
  lines.push(`- phase6 prereq v2 present:        ${flag(pack.coverage.hasPhase6PrereqV2)}`);

  lines.push("");
  lines.push(`Any paper-enter:      ${flag(pack.hasPaperEnter)}`);
  lines.push(`Any risk block:       ${flag(pack.hasRiskBlock)}`);
  lines.push(`Any unknown:          ${flag(pack.hasUnknown)}`);
  lines.push(`Any failure:          ${flag(pack.hasFailure)}`);
  lines.push(`Any unsupported:      ${flag(pack.hasUnsupported)}`);
  lines.push(`Any NOT-adopted spec: ${flag(pack.hasNotAdoptedSpec)}`);
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
