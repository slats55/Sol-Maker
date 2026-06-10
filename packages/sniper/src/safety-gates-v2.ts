/**
 * Deterministic, offline, **PAPER-only** SNIPER SAFETY GATES **V2** (Sprint 51 — the pre-simulation
 * gate, upgraded to the v2 pipeline).
 *
 * The v1 gates check a session pack's coverage flags. V2 checks the ARTIFACTS THEMSELVES — each one
 * is strictly validated in place — and speaks the v2 vocabulary: decision **reason codes**, policy
 * v2 **risk limits**, and the run report v2's **operator-blocking reasons**. Two deliberate design
 * points:
 *
 *   1. **The policy is the single source of allowances.** V1 let an operator pass ad-hoc
 *      `--allow-*` flags; in v2 a concern is tolerated ONLY when the governing policy artifact says
 *      so (`allowPaperEnter`, `failClosedOnUnknownPreflight=false`). No policy ⇒ nothing is
 *      tolerated ⇒ fail-closed.
 *   2. **It can never authorize Phase 6.** The report carries a literal
 *      `neverAuthorizesPhase6: true` (validated), and the Phase-6 gate is permanently `skip` —
 *      passing every gate is LOCAL/PAPER readiness only.
 *
 * Fail-closed everywhere: a missing required artifact fails its gate; a present-but-invalid
 * artifact fails its gate (with the validation error); a v1 decision fails the decision gate (the
 * code-aware checks NEED v2 — silently accepting v1 would skip them, which is fail-open); blocking
 * codes with no governing policy fail. It is **pure**, does NO filesystem / network / RPC / wallet
 * work, and carries no wall-clock time.
 */

import { redactString } from "@soulmaker/security";
import { validateSniperCandidateList } from "./candidate-list.js";
import { validateSniperPreflightInput } from "./preflight-input.js";
import { validateSniperTokenPreflightReport } from "./token-preflight.js";
import {
  validateSniperPolicyConfig,
  SNIPER_POLICY_CONFIG_SCHEMA_VERSION,
  type SniperPolicyConfig,
} from "./policy-config.js";
import {
  validateSniperPolicyConfigV2,
  SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION,
  type SniperPolicyConfigV2,
} from "./policy-config-v2.js";
import {
  validatePaperSniperDecisionReportV2,
  SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION,
  type SniperPaperDecisionReportV2,
} from "./paper-decision-v2.js";
import {
  validateSniperRunReportV2,
  SNIPER_RUN_REPORT_V2_SCHEMA_VERSION,
  type SniperRunReportV2,
} from "./run-report-v2.js";
import { validateSniperSessionPack } from "./session-pack.js";
import { validateSniperAuditLog } from "./audit-log.js";
import type { SniperGateStatus, SniperSafetyGate } from "./safety-gates.js";

/** Stable schema identifier for the v2 safety gates report. Bump only on a breaking change. */
export const SNIPER_SAFETY_GATES_REPORT_V2_SCHEMA_VERSION = "sniper.safety.gates.report.v2";

/** The banner that prefixes every v2 safety gates report (required label). */
export const SNIPER_SAFETY_GATES_REPORT_V2_BANNER = "SIMULATED PAPER-ONLY SNIPER SAFETY GATES V2";

/** Required disclaimer statements carried by every v2 safety gates report (stable order). */
export const SNIPER_SAFETY_GATES_REPORT_V2_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SNIPER SAFETY GATES V2 — a deterministic, fail-closed check over the v2 artifacts themselves (each strictly validated in place).",
  "The POLICY is the single source of allowances: a concern is tolerated only when the governing policy artifact says so; with no policy nothing is tolerated.",
  "It is FAIL-CLOSED: a missing or invalid required artifact fails; blocking reason codes with no governing policy fail; a v1 decision fails the decision gate (the code-aware checks need v2).",
  "Passing every gate is LOCAL/PAPER readiness ONLY — it is NEVER authorization to start Phase 6, build/sign/send a transaction, or trade. neverAuthorizesPhase6 is literally true.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this report.",
];

/** Thrown when v2 safety-gates INPUT or a produced report is structurally invalid. */
export class SniperSafetyGatesReportV2Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperSafetyGatesReportV2Error";
  }
}

// --- model -------------------------------------------------------------------

/** One checked artifact's state (present? strictly valid?). */
export interface SniperGateArtifactState {
  present: boolean;
  /** null when absent; otherwise whether the strict validator accepted it. */
  valid: boolean | null;
}

/** The artifacts the v2 gates check, by stable key. */
export interface SniperGateArtifactsChecked {
  candidateList: SniperGateArtifactState;
  preflightInput: SniperGateArtifactState;
  preflight: SniperGateArtifactState;
  policy: SniperGateArtifactState;
  decision: SniperGateArtifactState;
  runReport: SniperGateArtifactState;
  sessionPack: SniperGateArtifactState;
  auditLog: SniperGateArtifactState;
}

/** What the governing policy tolerates (all false when no valid policy was supplied — fail-closed). */
export interface SniperPolicyDerivedAllowances {
  /** The policy allows SIMULATED paper-enters (policy.allowPaperEnter). */
  paperEnterAllowedByPolicy: boolean;
  /** The policy tolerates unknowns (policy.failClosedOnUnknownPreflight === false). */
  unknownsToleratedByPolicy: boolean;
}

/** Everything {@link buildSniperSafetyGatesReportV2} needs. Every artifact is optional — a missing
 * required one FAILS its gate (fail-closed) instead of throwing. */
export interface BuildSniperSafetyGatesReportV2Input {
  /** `sniper.candidate.list.v1`. */
  candidateList?: unknown;
  /** `sniper.preflight.input.v1`. */
  preflightInput?: unknown;
  /** `sniper.token.preflight.report.v1`. */
  preflight?: unknown;
  /** `sniper.policy.config.v1` or `.v2` (sniffed by schemaVersion). */
  policy?: unknown;
  /** `sniper.paper.decision.report.v2` (a v1 decision FAILS the gate — the code checks need v2). */
  decision?: unknown;
  /** `sniper.run.report.v2`. */
  runReport?: unknown;
  /** `sniper.session.pack.v1`. */
  sessionPack?: unknown;
  /** `sniper.audit.log.v1`. */
  auditLog?: unknown;
  /** Optional operator label echoed into the report. */
  operatorLabel?: string | null;
}

/** The full, deterministic, JSON-serializable v2 safety gates report. */
export interface SniperSafetyGatesReportV2 {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  /** Literal true, validated: this report can NEVER authorize Phase 6. */
  neverAuthorizesPhase6: true;
  disclaimers: string[];
  operatorLabel: string | null;
  artifactsChecked: SniperGateArtifactsChecked;
  policyDerivedAllowances: SniperPolicyDerivedAllowances;
  gates: SniperSafetyGate[];
  passCount: number;
  failCount: number;
  warnCount: number;
  skipCount: number;
  /** True iff NO required gate failed. */
  ready: boolean;
  hasFailure: boolean;
  hasWarning: boolean;
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

/** Strictly check one artifact in place; never throws — the outcome becomes a gate. */
function check<T>(value: unknown, validate: (v: unknown) => T): { state: SniperGateArtifactState; artifact: T | null; error: string | null } {
  if (value === undefined || value === null) {
    return { state: { present: false, valid: null }, artifact: null, error: null };
  }
  try {
    const artifact = validate(value);
    return { state: { present: true, valid: true }, artifact, error: null };
  } catch (err) {
    return { state: { present: true, valid: false }, artifact: null, error: (err as Error).message };
  }
}

/** An artifact gate: pass when valid; fail (required) / warn (recommended) when absent; fail when invalid. */
function artifactGate(
  id: string,
  title: string,
  result: { state: SniperGateArtifactState; error: string | null },
  required: boolean,
  missingReason: string,
): SniperSafetyGate {
  if (!result.state.present) {
    return { id, title, required, status: required ? "fail" : "warn", reason: missingReason };
  }
  if (result.state.valid === false) {
    return { id, title, required, status: "fail", reason: `${title.toLowerCase()} is present but INVALID: ${result.error}` };
  }
  return { id, title, required, status: "pass", reason: `${title.toLowerCase()} present and strictly valid` };
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link SniperSafetyGatesReportV2}. Pure and non-mutating. Each supplied
 * artifact is STRICTLY validated in place (an invalid one fails its gate — never a silent skip);
 * the policy is the single source of allowances; the code-aware gates (blocking codes / unknowns /
 * paper-enter / required risk + inspection sections) read the v2 decision's reason-code trails and
 * the run report v2's structured fields VERBATIM. `ready` is true iff no REQUIRED gate failed —
 * and ready is still NOT Phase-6 authorization (`neverAuthorizesPhase6` is literally true).
 * Carries no wall-clock time. Throws {@link SniperSafetyGatesReportV2Error} on a malformed INPUT
 * shape (not on artifact problems — those are gate outcomes).
 */
export function buildSniperSafetyGatesReportV2(input: BuildSniperSafetyGatesReportV2Input): SniperSafetyGatesReportV2 {
  if (!isObject(input)) throw new SniperSafetyGatesReportV2Error("safety gates v2 input must be an object");
  if (input.operatorLabel !== undefined && input.operatorLabel !== null && typeof input.operatorLabel !== "string") {
    throw new SniperSafetyGatesReportV2Error("safety gates v2 input.operatorLabel must be a string or null when present");
  }

  // 1) Check every artifact in place (fail-closed: problems become gates, not exceptions).
  const candidateList = check(input.candidateList, validateSniperCandidateList);
  const preflightInput = check(input.preflightInput, validateSniperPreflightInput);
  const preflight = check(input.preflight, validateSniperTokenPreflightReport);
  const sessionPack = check(input.sessionPack, validateSniperSessionPack);
  const auditLog = check(input.auditLog, validateSniperAuditLog);

  // Policy: sniffed v1/v2.
  let policyV1: SniperPolicyConfig | null = null;
  let policyV2: SniperPolicyConfigV2 | null = null;
  let policyState: SniperGateArtifactState = { present: false, valid: null };
  let policyError: string | null = null;
  if (input.policy !== undefined && input.policy !== null) {
    const sniffed = isObject(input.policy) ? input.policy.schemaVersion : undefined;
    if (sniffed === SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION) {
      const r = check(input.policy, validateSniperPolicyConfigV2);
      policyState = r.state;
      policyV2 = r.artifact;
      policyError = r.error;
    } else if (sniffed === SNIPER_POLICY_CONFIG_SCHEMA_VERSION) {
      const r = check(input.policy, validateSniperPolicyConfig);
      policyState = r.state;
      policyV1 = r.artifact;
      policyError = r.error;
    } else {
      policyState = { present: true, valid: false };
      policyError = `unknown policy schemaVersion "${String(sniffed)}"`;
    }
  }
  const policy: SniperPolicyConfig | SniperPolicyConfigV2 | null = policyV2 ?? policyV1;

  // Decision: MUST be v2 (a v1 decision fails the gate — the code-aware checks need the codes).
  let decisionV2: SniperPaperDecisionReportV2 | null = null;
  let decisionState: SniperGateArtifactState = { present: false, valid: null };
  let decisionError: string | null = null;
  if (input.decision !== undefined && input.decision !== null) {
    const sniffed = isObject(input.decision) ? input.decision.schemaVersion : undefined;
    if (sniffed === SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION) {
      const r = check(input.decision, validatePaperSniperDecisionReportV2);
      decisionState = r.state;
      decisionV2 = r.artifact;
      decisionError = r.error;
    } else {
      decisionState = { present: true, valid: false };
      decisionError = `the decision artifact is "${String(sniffed)}" — the code-aware gates need ${SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION} (rebuild with --schema-version v2)`;
    }
  }

  // Run report: MUST be v2.
  let runReportV2: SniperRunReportV2 | null = null;
  let runReportState: SniperGateArtifactState = { present: false, valid: null };
  let runReportError: string | null = null;
  if (input.runReport !== undefined && input.runReport !== null) {
    const sniffed = isObject(input.runReport) ? input.runReport.schemaVersion : undefined;
    if (sniffed === SNIPER_RUN_REPORT_V2_SCHEMA_VERSION) {
      const r = check(input.runReport, validateSniperRunReportV2);
      runReportState = r.state;
      runReportV2 = r.artifact;
      runReportError = r.error;
    } else {
      runReportState = { present: true, valid: false };
      runReportError = `the run report artifact is "${String(sniffed)}" — these gates need ${SNIPER_RUN_REPORT_V2_SCHEMA_VERSION} (rebuild with --schema-version v2)`;
    }
  }

  const artifactsChecked: SniperGateArtifactsChecked = {
    candidateList: candidateList.state,
    preflightInput: preflightInput.state,
    preflight: preflight.state,
    policy: policyState,
    decision: decisionState,
    runReport: runReportState,
    sessionPack: sessionPack.state,
    auditLog: auditLog.state,
  };

  // 2) The policy is the single source of allowances (no valid policy ⇒ nothing is tolerated).
  const policyDerivedAllowances: SniperPolicyDerivedAllowances = {
    paperEnterAllowedByPolicy: policy !== null && policy.allowPaperEnter,
    unknownsToleratedByPolicy: policy !== null && policy.failClosedOnUnknownPreflight === false,
  };

  // 3) The gates.
  const requireInput = policyV2 !== null && policyV2.riskLimits.requirePreflightInputArtifact;
  const gates: SniperSafetyGate[] = [
    artifactGate("CANDIDATE_LIST_VALID", "Candidate list", candidateList, true, "no candidate list supplied — there is no intake spine"),
    artifactGate(
      "PREFLIGHT_INPUT_VALID",
      "Preflight input",
      preflightInput,
      requireInput,
      requireInput
        ? "the policy requires a validated preflight input artifact and none was supplied"
        : "no preflight input artifact — the preflight inputs were not validated as a bundle",
    ),
    artifactGate("PREFLIGHT_REPORT_VALID", "Preflight report", preflight, false, "no preflight report — candidates were not safety-screened"),
    artifactGate("POLICY_VALID", "Policy config", { state: policyState, error: policyError }, false, "no policy config — the run was not governed by an explicit policy"),
    artifactGate("DECISION_V2_VALID", "Decision report (v2)", { state: decisionState, error: decisionError }, true, "no decision report supplied — there are no simulated decisions to gate"),
    artifactGate("RUN_REPORT_V2_VALID", "Run report (v2)", { state: runReportState, error: runReportError }, true, "no run report supplied — the session was not bundled into the v2 view"),
    artifactGate("SESSION_PACK_PRESENT", "Session pack", sessionPack, true, "no session pack — the session artifacts were not collected"),
    artifactGate("AUDIT_LOG_PRESENT", "Audit log", auditLog, true, "no audit log — provenance is required before any Phase 6 work"),
  ];

  // Code-aware gates (deterministic SKIP when the decision gate already failed — no double count).
  if (decisionV2 === null) {
    for (const [id, title] of [
      ["NO_UNGOVERNED_BLOCKING_CODES", "Blocking reason codes"],
      ["NO_UNKNOWNS", "Unknowns"],
      ["NO_PAPER_ENTER", "Paper-enter"],
    ] as const) {
      gates.push({ id, title, required: true, status: "skip", reason: "skipped — no valid v2 decision to read (the decision gate already failed)" });
    }
  } else {
    const blockingTotal = decisionV2.decisions.reduce((n, d) => n + d.blockingReasonCodes.length, 0);
    gates.push(
      blockingTotal === 0
        ? { id: "NO_UNGOVERNED_BLOCKING_CODES", title: "Blocking reason codes", required: true, status: "pass", reason: "no blocking reason codes in the decision" }
        : policy !== null
          ? { id: "NO_UNGOVERNED_BLOCKING_CODES", title: "Blocking reason codes", required: true, status: "warn", reason: `${blockingTotal} blocking code occurrence(s) — exclusions occurred under the governing policy; review them` }
          : { id: "NO_UNGOVERNED_BLOCKING_CODES", title: "Blocking reason codes", required: true, status: "fail", reason: `${blockingTotal} blocking code occurrence(s) with NO governing policy — supply the policy that governed this run` },
    );

    // Unknowns are CODE-AWARE: a candidate still watched (or unknown) whose trail carries an
    // unknown-information code remains unresolved — a fail-closed REJECT of an unknown resolves it.
    const unknownIds = new Set<string>(
      decisionV2.decisions
        .filter(
          (d) =>
            (d.decision === "watch" || d.decision === "unknown") &&
            d.reasonCodes.some((c) => c === "preflight-unknown" || c === "missing-preflight" || c === "preflight-status-unrecognized"),
        )
        .map((d) => d.candidateId),
    );
    for (const id of runReportV2?.unresolvedUnknownIds ?? []) unknownIds.add(id);
    gates.push(
      unknownIds.size === 0
        ? { id: "NO_UNKNOWNS", title: "Unknowns", required: true, status: "pass", reason: "no unknown classifications or unresolved unknowns" }
        : policyDerivedAllowances.unknownsToleratedByPolicy
          ? { id: "NO_UNKNOWNS", title: "Unknowns", required: true, status: "warn", reason: `${unknownIds.size} unresolved unknown(s) — tolerated by the policy (failClosedOnUnknownPreflight=false)` }
          : { id: "NO_UNKNOWNS", title: "Unknowns", required: true, status: "fail", reason: `${unknownIds.size} unresolved unknown(s) and the policy does not tolerate unknowns (fail-closed)` },
    );

    gates.push(
      !decisionV2.hasPaperEnter
        ? { id: "NO_PAPER_ENTER", title: "Paper-enter", required: true, status: "pass", reason: "no SIMULATED paper-enter in the decision" }
        : policyDerivedAllowances.paperEnterAllowedByPolicy
          ? { id: "NO_PAPER_ENTER", title: "Paper-enter", required: true, status: "warn", reason: `${decisionV2.paperEnterCount} SIMULATED paper-enter(s) — allowed by the policy (allowPaperEnter=true); review them` }
          : { id: "NO_PAPER_ENTER", title: "Paper-enter", required: true, status: "fail", reason: `${decisionV2.paperEnterCount} SIMULATED paper-enter(s) and no policy allows them (fail-closed)` },
    );
  }

  // Required-section gates (skip when not demanded by a v2 policy).
  const missingRiskCount = decisionV2
    ? decisionV2.decisions.filter((d) => d.reasonCodes.includes("risk-missing") || d.reasonCodes.includes("policy-missing-risk")).length
    : 0;
  const missingInspectionCount = decisionV2
    ? decisionV2.decisions.filter((d) => d.reasonCodes.includes("policy-missing-inspection")).length
    : 0;
  gates.push(
    policyV2 === null || !policyV2.riskLimits.requireRiskPresent || decisionV2 === null
      ? { id: "RISK_PRESENT_WHEN_REQUIRED", title: "Risk data required", required: false, status: "skip", reason: "not applicable — no v2 policy requires risk data (or no v2 decision to read)" }
      : missingRiskCount === 0
        ? { id: "RISK_PRESENT_WHEN_REQUIRED", title: "Risk data required", required: true, status: "pass", reason: "the policy requires risk data and no candidate lacks it" }
        : { id: "RISK_PRESENT_WHEN_REQUIRED", title: "Risk data required", required: true, status: "fail", reason: `the policy requires risk data and ${missingRiskCount} candidate(s) lack it` },
  );
  gates.push(
    policyV2 === null || !policyV2.riskLimits.requireInspectionPresent || decisionV2 === null
      ? { id: "INSPECTION_PRESENT_WHEN_REQUIRED", title: "Inspection required", required: false, status: "skip", reason: "not applicable — no v2 policy requires inspection data (or no v2 decision to read)" }
      : missingInspectionCount === 0
        ? { id: "INSPECTION_PRESENT_WHEN_REQUIRED", title: "Inspection required", required: true, status: "pass", reason: "the policy requires inspection data and no candidate lacks it" }
        : { id: "INSPECTION_PRESENT_WHEN_REQUIRED", title: "Inspection required", required: true, status: "fail", reason: `the policy requires inspection data and ${missingInspectionCount} candidate(s) lack it` },
  );

  // Operator-blocking reasons from the run report (informational — the hard cases have their own gates).
  gates.push(
    runReportV2 === null
      ? { id: "NO_OPERATOR_BLOCKING_REASONS", title: "Operator-blocking reasons", required: false, status: "skip", reason: "skipped — no valid v2 run report to read" }
      : runReportV2.operatorBlockingReasons.length === 0
        ? { id: "NO_OPERATOR_BLOCKING_REASONS", title: "Operator-blocking reasons", required: false, status: "pass", reason: "the run report lists no operator-blocking reason" }
        : { id: "NO_OPERATOR_BLOCKING_REASONS", title: "Operator-blocking reasons", required: false, status: "warn", reason: `${runReportV2.operatorBlockingReasons.length} operator-blocking reason(s) in the run report — resolve them` },
  );

  // The permanent Phase-6 boundary.
  gates.push({
    id: "PHASE6_NOT_AUTO_AUTHORIZED",
    title: "Phase 6 boundary",
    required: false,
    status: "skip",
    reason: "Phase 6 (transaction planning/simulation) is NOT started by design — these gates can NEVER authorize it; passing is local/paper readiness only",
  });

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
      ? "All required gates pass; review the warnings before relying on this session. This is local/paper readiness only — NEVER Phase 6 authorization."
      : "All required gates pass. This is local/paper readiness only — NEVER Phase 6 authorization; Phase 6 remains not started."
    : `Not ready: ${failCount} gate(s) failed. Resolve them before relying on this session.`;

  const notes = [
    `${passCount} pass / ${failCount} fail / ${warnCount} warn / ${skipCount} skip; ready=${ready}.`,
    "The policy is the single source of allowances — with no governing policy, nothing is tolerated (fail-closed).",
    "Fail-closed local/paper safety check — passing is NEVER authorization to start Phase 6, build/sign/send a transaction, or trade.",
  ];

  return {
    schemaVersion: SNIPER_SAFETY_GATES_REPORT_V2_SCHEMA_VERSION,
    banner: SNIPER_SAFETY_GATES_REPORT_V2_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    neverAuthorizesPhase6: true,
    disclaimers: [...SNIPER_SAFETY_GATES_REPORT_V2_DISCLAIMERS],
    operatorLabel: nonEmptyString(input.operatorLabel) ? input.operatorLabel : null,
    artifactsChecked,
    policyDerivedAllowances,
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

function validateGate(value: unknown, where: string): SniperSafetyGate {
  if (!isObject(value)) throw new SniperSafetyGatesReportV2Error(`${where} must be an object`);
  if (!nonEmptyString(value.id)) throw new SniperSafetyGatesReportV2Error(`${where}.id must be a non-empty string`);
  if (!nonEmptyString(value.title)) throw new SniperSafetyGatesReportV2Error(`${where}.title must be a non-empty string`);
  if (typeof value.required !== "boolean") throw new SniperSafetyGatesReportV2Error(`${where}.required must be a boolean`);
  if (typeof value.status !== "string" || !GATE_STATUSES.has(value.status)) {
    throw new SniperSafetyGatesReportV2Error(`${where}.status must be pass|fail|warn|skip`);
  }
  if (!nonEmptyString(value.reason)) throw new SniperSafetyGatesReportV2Error(`${where}.reason must be a non-empty string`);
  return value as unknown as SniperSafetyGate;
}

/**
 * Strictly validate a value as a {@link SniperSafetyGatesReportV2} and return it narrowed. A backstop
 * mirroring the package's sibling validators — including that `neverAuthorizesPhase6` is literally
 * true, that the counts equal the recomputed tallies, and that `ready` mirrors the required gates.
 * Throws {@link SniperSafetyGatesReportV2Error} on the first problem. Pure.
 */
export function validateSniperSafetyGatesReportV2(value: unknown): SniperSafetyGatesReportV2 {
  if (!isObject(value)) throw new SniperSafetyGatesReportV2Error("safety gates v2 report must be a JSON object");
  if (value.schemaVersion !== SNIPER_SAFETY_GATES_REPORT_V2_SCHEMA_VERSION) {
    throw new SniperSafetyGatesReportV2Error(`safety gates v2 report.schemaVersion must be "${SNIPER_SAFETY_GATES_REPORT_V2_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_SAFETY_GATES_REPORT_V2_BANNER) {
    throw new SniperSafetyGatesReportV2Error(`safety gates v2 report.banner must be "${SNIPER_SAFETY_GATES_REPORT_V2_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim", "neverAuthorizesPhase6"] as const) {
    if (value[flag] !== true) throw new SniperSafetyGatesReportV2Error(`safety gates v2 report.${flag} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperSafetyGatesReportV2Error("safety gates v2 report.disclaimers must be a non-empty array");
  }
  if (value.operatorLabel !== null && typeof value.operatorLabel !== "string") {
    throw new SniperSafetyGatesReportV2Error("safety gates v2 report.operatorLabel must be a string or null");
  }
  if (!isObject(value.artifactsChecked)) throw new SniperSafetyGatesReportV2Error("safety gates v2 report.artifactsChecked must be an object");
  for (const key of ["candidateList", "preflightInput", "preflight", "policy", "decision", "runReport", "sessionPack", "auditLog"] as const) {
    const s = (value.artifactsChecked as Record<string, unknown>)[key];
    if (!isObject(s) || typeof s.present !== "boolean" || (s.valid !== null && typeof s.valid !== "boolean")) {
      throw new SniperSafetyGatesReportV2Error(`safety gates v2 report.artifactsChecked.${key} must be { present: boolean, valid: boolean|null }`);
    }
    if (s.present === false && s.valid !== null) {
      throw new SniperSafetyGatesReportV2Error(`safety gates v2 report.artifactsChecked.${key}.valid must be null when absent`);
    }
  }
  if (!isObject(value.policyDerivedAllowances)) {
    throw new SniperSafetyGatesReportV2Error("safety gates v2 report.policyDerivedAllowances must be an object");
  }
  for (const f of ["paperEnterAllowedByPolicy", "unknownsToleratedByPolicy"] as const) {
    if (typeof (value.policyDerivedAllowances as Record<string, unknown>)[f] !== "boolean") {
      throw new SniperSafetyGatesReportV2Error(`safety gates v2 report.policyDerivedAllowances.${f} must be a boolean`);
    }
  }
  if (!Array.isArray(value.gates) || value.gates.length === 0) {
    throw new SniperSafetyGatesReportV2Error("safety gates v2 report.gates must be a non-empty array");
  }
  const gates = (value.gates as unknown[]).map((g, i) => validateGate(g, `safety gates v2 report.gates[${i}]`));
  for (const [f, expected] of [
    ["passCount", gates.filter((g) => g.status === "pass").length],
    ["failCount", gates.filter((g) => g.status === "fail").length],
    ["warnCount", gates.filter((g) => g.status === "warn").length],
    ["skipCount", gates.filter((g) => g.status === "skip").length],
  ] as const) {
    if (value[f] !== expected) throw new SniperSafetyGatesReportV2Error(`safety gates v2 report.${f} must equal the recomputed tally (${expected})`);
  }
  const expectedReady = !gates.some((g) => g.required && g.status === "fail");
  if (value.ready !== expectedReady) {
    throw new SniperSafetyGatesReportV2Error("safety gates v2 report.ready must mirror the required gates");
  }
  for (const f of ["hasFailure", "hasWarning"] as const) {
    if (typeof value[f] !== "boolean") throw new SniperSafetyGatesReportV2Error(`safety gates v2 report.${f} must be a boolean`);
  }
  if (!nonEmptyString(value.recommendation)) throw new SniperSafetyGatesReportV2Error("safety gates v2 report.recommendation must be a non-empty string");
  for (const f of ["failReasons", "notes"] as const) {
    if (!Array.isArray(value[f]) || (value[f] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperSafetyGatesReportV2Error(`safety gates v2 report.${f} must be an array of strings`);
    }
  }
  // The permanent boundary gate must be present and must be a skip (it can never pass into authorization).
  const boundary = gates.find((g) => g.id === "PHASE6_NOT_AUTO_AUTHORIZED");
  if (!boundary || boundary.status !== "skip") {
    throw new SniperSafetyGatesReportV2Error('safety gates v2 report must carry the PHASE6_NOT_AUTO_AUTHORIZED gate with status "skip"');
  }
  return value as unknown as SniperSafetyGatesReportV2;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperSafetyGatesReportV2}. */
export interface FormatSniperSafetyGatesReportV2Options {
  label?: string;
}

const STATUS_MARK: Record<SniperGateStatus, string> = { pass: "✓", fail: "✗", warn: "!", skip: "·" };

/**
 * Render a redacted, stable, human-readable v2 safety gates report. Deterministic and path-stable.
 * Leads with the PAPER-ONLY banner and the READY verdict, shows the artifact checklist and the
 * policy-derived allowances, lists each gate with its status mark + reason, and closes with the
 * recommendation and the never-Phase-6-authorization disclaimers. Passed through the redactor.
 */
export function formatSniperSafetyGatesReportV2(
  report: SniperSafetyGatesReportV2,
  opts: FormatSniperSafetyGatesReportV2Options = {},
): string {
  const header = `${report.banner} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];
  if (opts.label) lines.push(`label:    ${opts.label}`);
  if (report.operatorLabel) lines.push(`operator: ${report.operatorLabel}`);
  lines.push(`READY:    ${report.ready ? "YES" : "NO"}  (${report.passCount} pass / ${report.failCount} fail / ${report.warnCount} warn / ${report.skipCount} skip)`);
  lines.push(`policy allowances: paper-enter=${report.policyDerivedAllowances.paperEnterAllowedByPolicy}  unknowns=${report.policyDerivedAllowances.unknownsToleratedByPolicy}`);

  lines.push("");
  lines.push("Artifacts checked:");
  for (const [key, state] of Object.entries(report.artifactsChecked)) {
    const s = state as SniperGateArtifactState;
    lines.push(`- ${key}: ${s.present ? (s.valid ? "present, valid" : "present, INVALID") : "absent"}`);
  }

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
