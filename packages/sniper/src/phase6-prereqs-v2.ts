/**
 * Deterministic, offline, **PAPER-only** PHASE 6 PREREQUISITE TRACKER **V2** (Sprint 52).
 *
 * V2 makes Phase-6 readiness CONCRETE without implementing any of Phase 6: instead of v1's session
 * pack coverage flags, it consumes the actual v2 artifacts (policy v1/v2, safety gates v2, decision
 * v2, run report v2, audit log, session pack) and groups every prerequisite into explicit
 * **readiness buckets**: artifact, policy, safety, audit, operator, kill-switch, secrets-policy,
 * burner-isolation, and test readiness.
 *
 * The kill-switch / secrets-policy / burner-isolation buckets (Sprint 56) are driven by the actual
 * spec artifacts (`sniper.kill_switch.spec.v1` / `sniper.secrets.policy.v1` /
 * `sniper.burner.isolation.spec.v1`): a MISSING spec keeps its bucket not-met, an INVALID or
 * weakened spec keeps it not-met (the spec validators refuse weakened safety literals), and a spec
 * that is not ADOPTED keeps it not-met. Readiness is fail-closed, never invented — and the burner
 * spec must additionally be PAIRED with a kill-switch spec (`killSwitchSpecRef`).
 *
 * HARD invariants (validated, never anything else):
 *   - `phase6ImplementationStarted: false` — Phase 6 is not started.
 *   - `requiresExplicitHumanApproval: true` — beginning Phase 6 is a human decision, never a machine verdict.
 *   - `phase7LiveTradingReady: false` — Phase 7 (live/burner trading) can NEVER be ready here.
 *   - `neverAuthorizesLiveTrading: true` — this report can never authorize any live behaviour.
 *
 * `phase6ImplementationReady` may become true ONLY in the sense "every prerequisite for beginning a
 * PURE SIMULATION implementation is addressed" — it is still not authorization (a human decides),
 * and it can never speak for live execution. It is **pure**, does NO filesystem / network / RPC /
 * wallet work, and carries no wall-clock time.
 */

import { redactString } from "@soulmaker/security";
import { validateSniperSessionPack } from "./session-pack.js";
import { validateSniperAuditLog, type SniperAuditLog } from "./audit-log.js";
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
import {
  validateSniperSafetyGatesReportV2,
  SNIPER_SAFETY_GATES_REPORT_V2_SCHEMA_VERSION,
  type SniperSafetyGatesReportV2,
} from "./safety-gates-v2.js";
import { validateSniperKillSwitchSpec, type SniperKillSwitchSpec } from "./kill-switch-spec.js";
import { validateSniperSecretsPolicy, type SniperSecretsPolicy } from "./secrets-policy.js";
import { validateSniperBurnerIsolationSpec, type SniperBurnerIsolationSpec } from "./burner-isolation-spec.js";
import type { Phase6PrereqStatus } from "./phase6-prereqs.js";

/** Stable schema identifier for the v2 Phase 6 prerequisite report. Bump only on a breaking change. */
export const PHASE6_PREREQUISITE_REPORT_V2_SCHEMA_VERSION = "phase6.prerequisite.report.v2";

/** The banner that prefixes every v2 report (required label). */
export const PHASE6_PREREQUISITE_REPORT_V2_BANNER = "PHASE 6 PREREQUISITE TRACKER V2 (PAPER-ONLY, NOT AUTHORIZATION)";

/** Required disclaimer statements carried by every v2 report (stable order). */
export const PHASE6_PREREQUISITE_REPORT_V2_DISCLAIMERS: readonly string[] = [
  "PHASE 6 PREREQUISITE TRACKER V2 — explicit readiness buckets over the actual v2 artifacts (policy / safety gates v2 / decision v2 / run report v2 / audit log / session pack / kill-switch spec / secrets policy / burner isolation spec).",
  "It is NOT authorization to start Phase 6: even when every bucket is ready, beginning Phase 6 requires an explicit human decision, never this report.",
  "phase6ImplementationReady may become true ONLY for a PURE SIMULATION implementation prerequisite check — never for live execution; phase7LiveTradingReady is ALWAYS false.",
  "A missing, invalid, weakened, or non-ADOPTED spec artifact keeps its readiness bucket not-met — readiness is fail-closed, never invented.",
  "Phase 6 (transaction planning/simulation) and Phase 7 (burner/live trading) are NOT started; this tracker implements NO transaction planning and carries no chain capability.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this report.",
];

/** Thrown when v2 prerequisite-tracker INPUT or a produced report is structurally invalid. */
export class Phase6PrerequisiteReportV2Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Phase6PrerequisiteReportV2Error";
  }
}

// --- model -------------------------------------------------------------------

/** The explicit readiness buckets (stable order). */
export const PHASE6_READINESS_BUCKETS = [
  "artifact",
  "policy",
  "safety",
  "audit",
  "operator",
  "kill-switch",
  "secrets-policy",
  "burner-isolation",
  "test",
] as const;

/** One of the explicit readiness buckets. */
export type Phase6ReadinessBucket = (typeof PHASE6_READINESS_BUCKETS)[number];

/** One v2 prerequisite item (bucketed). */
export interface Phase6PrerequisiteV2 {
  /** Stable id (UPPER_SNAKE). */
  id: string;
  title: string;
  bucket: Phase6ReadinessBucket;
  /** `met` / `not-met` for checkable items; `documented` for design-only items. */
  status: Phase6PrereqStatus;
  /** Where the status came from (an artifact schema, the spec, or "not supplied"). */
  source: string;
  reason: string;
}

/** One bucket's rollup. */
export interface Phase6BucketSummary {
  bucket: Phase6ReadinessBucket;
  title: string;
  itemCount: number;
  metCount: number;
  /** Ready iff every item in the bucket is `met` or `documented`. */
  ready: boolean;
}

/** Everything {@link buildPhase6PrerequisiteReportV2} needs. Every artifact is optional — a missing
 * one keeps its items `not-met` (fail-closed readiness). */
export interface BuildPhase6PrerequisiteReportV2Input {
  /** `sniper.session.pack.v1`. */
  sessionPack?: unknown;
  /** `sniper.policy.config.v1` or `.v2` (sniffed by schemaVersion). */
  policy?: unknown;
  /** `sniper.safety.gates.report.v2`. */
  safetyGates?: unknown;
  /** `sniper.paper.decision.report.v2`. */
  decision?: unknown;
  /** `sniper.run.report.v2`. */
  runReport?: unknown;
  /** `sniper.audit.log.v1`. */
  auditLog?: unknown;
  /** `sniper.kill_switch.spec.v1` (Sprint 56). */
  killSwitchSpec?: unknown;
  /** `sniper.secrets.policy.v1` (Sprint 56). */
  secretsPolicy?: unknown;
  /** `sniper.burner.isolation.spec.v1` (Sprint 56). */
  burnerIsolationSpec?: unknown;
  /** Optional operator label echoed into the report (also drives the operator-labeled item). */
  operatorLabel?: string | null;
}

/** The full, deterministic, JSON-serializable v2 Phase 6 prerequisite report. */
export interface Phase6PrerequisiteReportV2 {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  operatorLabel: string | null;
  prerequisites: Phase6PrerequisiteV2[];
  buckets: Phase6BucketSummary[];
  /** Ids of items that are `not-met`. */
  notMet: string[];
  /** True iff EVERY bucket is ready — and even then ONLY for a pure simulation implementation. */
  phase6ImplementationReady: boolean;
  // --- HARD invariants (validated; can never be anything else) ---
  /** ALWAYS false — Phase 6 implementation is not started. */
  phase6ImplementationStarted: false;
  /** ALWAYS true — beginning Phase 6 requires an explicit human decision, never this report. */
  requiresExplicitHumanApproval: true;
  /** ALWAYS false — Phase 7 (live/burner trading) can never be ready here. */
  phase7LiveTradingReady: false;
  /** ALWAYS true — this report can never authorize any live behaviour. */
  neverAuthorizesLiveTrading: true;
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

/** Validate an optional artifact silently: null when absent OR invalid (the item explains). */
function tryValidate<T>(value: unknown, validate: (v: unknown) => T): { artifact: T | null; error: string | null; present: boolean } {
  if (value === undefined || value === null) return { artifact: null, error: null, present: false };
  try {
    return { artifact: validate(value), error: null, present: true };
  } catch (err) {
    return { artifact: null, error: (err as Error).message, present: true };
  }
}

function item(
  id: string,
  title: string,
  bucket: Phase6ReadinessBucket,
  met: boolean,
  source: string,
  metReason: string,
  notMetReason: string,
): Phase6PrerequisiteV2 {
  return { id, title, bucket, status: met ? "met" : "not-met", source, reason: met ? metReason : notMetReason };
}

const BUCKET_TITLES: Record<Phase6ReadinessBucket, string> = {
  artifact: "Artifact readiness",
  policy: "Policy readiness",
  safety: "Safety readiness",
  audit: "Audit readiness",
  operator: "Operator readiness",
  "kill-switch": "Kill-switch readiness",
  "secrets-policy": "Secrets-policy readiness",
  "burner-isolation": "Burner-isolation readiness",
  test: "Test readiness",
};

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link Phase6PrerequisiteReportV2}. Pure and non-mutating. Each supplied
 * artifact is strictly validated (an invalid or absent one keeps its items `not-met` with the error
 * surfaced — fail-closed, never a throw). The kill-switch / secrets-policy / burner-isolation
 * buckets are met only by ADOPTED, strictly-valid spec artifacts, and the burner spec must be
 * paired with a kill-switch spec. The HARD invariants are constants:
 * `phase6ImplementationStarted=false`, `requiresExplicitHumanApproval=true`,
 * `phase7LiveTradingReady=false`, `neverAuthorizesLiveTrading=true`. Carries no wall-clock time.
 * Throws {@link Phase6PrerequisiteReportV2Error} only on a malformed input SHAPE.
 */
export function buildPhase6PrerequisiteReportV2(
  input: BuildPhase6PrerequisiteReportV2Input = {},
): Phase6PrerequisiteReportV2 {
  if (!isObject(input)) throw new Phase6PrerequisiteReportV2Error("phase 6 prerequisite v2 input must be an object");
  if (input.operatorLabel !== undefined && input.operatorLabel !== null && typeof input.operatorLabel !== "string") {
    throw new Phase6PrerequisiteReportV2Error("phase 6 prerequisite v2 input.operatorLabel must be a string or null when present");
  }

  const sessionPack = tryValidate(input.sessionPack, validateSniperSessionPack);
  const auditLog = tryValidate<SniperAuditLog>(input.auditLog, validateSniperAuditLog);
  const killSwitchSpec = tryValidate<SniperKillSwitchSpec>(input.killSwitchSpec, validateSniperKillSwitchSpec);
  const secretsPolicy = tryValidate<SniperSecretsPolicy>(input.secretsPolicy, validateSniperSecretsPolicy);
  const burnerIsolationSpec = tryValidate<SniperBurnerIsolationSpec>(input.burnerIsolationSpec, validateSniperBurnerIsolationSpec);
  const decision = tryValidate<SniperPaperDecisionReportV2>(
    input.decision,
    (v) => {
      if (isObject(v) && v.schemaVersion !== SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION) {
        throw new Error(`decision must be ${SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION} (got "${String(v.schemaVersion)}")`);
      }
      return validatePaperSniperDecisionReportV2(v);
    },
  );
  const runReport = tryValidate<SniperRunReportV2>(
    input.runReport,
    (v) => {
      if (isObject(v) && v.schemaVersion !== SNIPER_RUN_REPORT_V2_SCHEMA_VERSION) {
        throw new Error(`run report must be ${SNIPER_RUN_REPORT_V2_SCHEMA_VERSION} (got "${String(v.schemaVersion)}")`);
      }
      return validateSniperRunReportV2(v);
    },
  );
  const safetyGates = tryValidate<SniperSafetyGatesReportV2>(
    input.safetyGates,
    (v) => {
      if (isObject(v) && v.schemaVersion !== SNIPER_SAFETY_GATES_REPORT_V2_SCHEMA_VERSION) {
        throw new Error(`safety gates must be ${SNIPER_SAFETY_GATES_REPORT_V2_SCHEMA_VERSION} (got "${String(v.schemaVersion)}")`);
      }
      return validateSniperSafetyGatesReportV2(v);
    },
  );

  let policyV1: SniperPolicyConfig | null = null;
  let policyV2: SniperPolicyConfigV2 | null = null;
  let policyPresent = false;
  let policyError: string | null = null;
  if (input.policy !== undefined && input.policy !== null) {
    policyPresent = true;
    const sniffed = isObject(input.policy) ? input.policy.schemaVersion : undefined;
    if (sniffed === SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION) {
      const r = tryValidate(input.policy, validateSniperPolicyConfigV2);
      policyV2 = r.artifact;
      policyError = r.error;
    } else if (sniffed === SNIPER_POLICY_CONFIG_SCHEMA_VERSION) {
      const r = tryValidate(input.policy, validateSniperPolicyConfig);
      policyV1 = r.artifact;
      policyError = r.error;
    } else {
      policyError = `unknown policy schemaVersion "${String(sniffed)}"`;
    }
  }
  const policy = policyV2 ?? policyV1;

  const absent = (label: string, error: string | null, present: boolean): string =>
    present ? `${label} is present but INVALID: ${error}` : `${label} was not supplied`;

  const prerequisites: Phase6PrerequisiteV2[] = [
    // --- artifact readiness ---
    item("SESSION_PACK", "Session pack collected", "artifact", sessionPack.artifact !== null, "sniper.session.pack.v1",
      "the session pack is present and strictly valid", absent("the session pack", sessionPack.error, sessionPack.present)),
    item("DECISION_V2", "Decision report v2 (reason codes)", "artifact", decision.artifact !== null, SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION,
      "the v2 decision report is present and strictly valid", absent("the v2 decision report", decision.error, decision.present)),
    item("RUN_REPORT_V2", "Run report v2 (rollups + blocking reasons)", "artifact", runReport.artifact !== null, SNIPER_RUN_REPORT_V2_SCHEMA_VERSION,
      "the v2 run report is present and strictly valid", absent("the v2 run report", runReport.error, runReport.present)),
    // --- policy readiness ---
    item("POLICY_PRESENT", "Versioned operator policy", "policy", policy !== null, "sniper.policy.config.v1|v2",
      `a ${policy?.schemaVersion ?? ""} policy governs the run`.trim(), absent("the policy config", policyError, policyPresent)),
    item("POLICY_V2_RISK_LIMITS", "Policy v2 risk limits + explicit mode", "policy", policyV2 !== null, SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION,
      `the policy is v2 (mode: ${policyV2?.policyMode ?? ""})`.trim(),
      policyV1 !== null ? "the policy is v1 — upgrade to v2 for explicit mode + reason-code-aware risk limits" : "no v2 policy supplied"),
    // --- safety readiness ---
    item("SAFETY_GATES_V2", "Safety gates v2 evaluated", "safety", safetyGates.artifact !== null, SNIPER_SAFETY_GATES_REPORT_V2_SCHEMA_VERSION,
      "the v2 safety gates report is present and strictly valid", absent("the v2 safety gates report", safetyGates.error, safetyGates.present)),
    item("SAFETY_GATES_READY", "Safety gates READY", "safety", safetyGates.artifact?.ready === true, SNIPER_SAFETY_GATES_REPORT_V2_SCHEMA_VERSION,
      "every required safety gate passes", safetyGates.artifact ? `${safetyGates.artifact.failCount} safety gate(s) failed` : "no v2 safety gates report to read"),
    // --- audit readiness ---
    item("AUDIT_LOG", "Audit log present", "audit", auditLog.artifact !== null, "sniper.audit.log.v1",
      "the audit log is present and strictly valid", absent("the audit log", auditLog.error, auditLog.present)),
    item("AUDIT_CLEAN", "Audit log clean (no step failures)", "audit", auditLog.artifact !== null && auditLog.artifact.hasFailure === false, "sniper.audit.log.v1",
      "no audit step recorded a failure", auditLog.artifact ? "the audit log records step failure(s)" : "no audit log to read"),
    // --- operator readiness ---
    item("OPERATOR_LABELED", "Operator identified (label)", "operator", nonEmptyString(input.operatorLabel), "operator input",
      "an operator label was supplied", "no operator label was supplied — runs must be attributable"),
    item("NO_OPERATOR_BLOCKING", "No operator-blocking reasons", "operator", runReport.artifact !== null && runReport.artifact.operatorBlockingReasons.length === 0, SNIPER_RUN_REPORT_V2_SCHEMA_VERSION,
      "the run report lists no operator-blocking reason",
      runReport.artifact ? `${runReport.artifact.operatorBlockingReasons.length} operator-blocking reason(s) remain` : "no v2 run report to read"),
    // --- kill-switch / secrets-policy / burner-isolation readiness (Sprint 56: spec-artifact driven) ---
    // Each spec item is met ONLY when the artifact is present, strictly valid (the spec validators
    // refuse weakened safety literals), AND operator-ADOPTED. Fail-closed in every other state.
    item("KILL_SWITCH_SPEC_ARTIFACT", "Machine-readable kill-switch spec (adopted)", "kill-switch",
      killSwitchSpec.artifact !== null && killSwitchSpec.artifact.adopted, "sniper.kill_switch.spec.v1",
      "an ADOPTED kill-switch spec is supplied and strictly valid",
      killSwitchSpec.artifact !== null
        ? `the kill-switch spec is "${killSwitchSpec.artifact.readinessStatus}" — supply an ADOPTED spec`
        : absent("the kill-switch spec", killSwitchSpec.error, killSwitchSpec.present)),
    item("SECRETS_POLICY_ARTIFACT", "Machine-readable secrets policy (adopted)", "secrets-policy",
      secretsPolicy.artifact !== null && secretsPolicy.artifact.adopted, "sniper.secrets.policy.v1",
      "an ADOPTED secrets policy is supplied and strictly valid (core rules intact)",
      secretsPolicy.artifact !== null
        ? `the secrets policy is "${secretsPolicy.artifact.readinessStatus}" — supply an ADOPTED policy`
        : absent("the secrets policy", secretsPolicy.error, secretsPolicy.present)),
    item("BURNER_ISOLATION_SPEC_ARTIFACT", "Machine-readable burner isolation spec (adopted)", "burner-isolation",
      burnerIsolationSpec.artifact !== null && burnerIsolationSpec.artifact.adopted, "sniper.burner.isolation.spec.v1",
      "an ADOPTED burner isolation spec is supplied and strictly valid (core principles intact)",
      burnerIsolationSpec.artifact !== null
        ? `the burner isolation spec is "${burnerIsolationSpec.artifact.readinessStatus}" — supply an ADOPTED spec`
        : absent("the burner isolation spec", burnerIsolationSpec.error, burnerIsolationSpec.present)),
    item("BURNER_KILL_SWITCH_PAIRED", "Burner spec paired with a kill-switch spec", "burner-isolation",
      burnerIsolationSpec.artifact !== null && burnerIsolationSpec.artifact.killSwitchSpecRef !== null,
      "sniper.burner.isolation.spec.v1#killSwitchSpecRef",
      `the burner spec references kill-switch spec "${burnerIsolationSpec.artifact?.killSwitchSpecRef ?? ""}"`.trim(),
      burnerIsolationSpec.artifact !== null
        ? "the burner spec has no killSwitchSpecRef — pair it with an adopted kill-switch spec"
        : "no valid burner isolation spec to read the pairing from"),
    // --- test readiness (design-documented: the per-module safety regression suites ship in-repo) ---
    {
      id: "SAFETY_REGRESSION_SUITE",
      title: "Per-module safety regression suite",
      bucket: "test",
      status: "documented",
      source: "packages/sniper/src/*-safety.test.ts",
      reason: "every sniper module ships a source-scanning safety regression test (no wallet/sign/send/network capability) — this tracker cannot run them, only point at them",
    },
  ];

  const buckets: Phase6BucketSummary[] = PHASE6_READINESS_BUCKETS.map((bucket) => {
    const items = prerequisites.filter((p) => p.bucket === bucket);
    const metCount = items.filter((p) => p.status === "met" || p.status === "documented").length;
    return {
      bucket,
      title: BUCKET_TITLES[bucket],
      itemCount: items.length,
      metCount,
      ready: items.length > 0 && metCount === items.length,
    };
  });

  const notMet = prerequisites.filter((p) => p.status === "not-met").map((p) => p.id);
  const phase6ImplementationReady = buckets.every((b) => b.ready);

  const recommendation = phase6ImplementationReady
    ? "Every readiness bucket is addressed for a PURE SIMULATION implementation. This is still NOT authorization — beginning Phase 6 requires an explicit human decision, and Phase 7 live trading can never be readied by this report."
    : `Not ready: ${notMet.length} prerequisite(s) unmet across ${buckets.filter((b) => !b.ready).length} bucket(s). Phase 6 work must not begin.`;

  const notes = [
    `${prerequisites.length} prerequisite(s) across ${buckets.length} bucket(s); ${notMet.length} not met; phase6ImplementationReady=${phase6ImplementationReady}.`,
    "phase6ImplementationReady speaks ONLY to a pure simulation implementation prerequisite check — never live execution, and never authorization.",
    "The kill-switch / secrets-policy / burner-isolation buckets are met only by ADOPTED, strictly-valid spec artifacts — a missing, invalid, weakened, or draft spec keeps them not-met.",
  ];

  return {
    schemaVersion: PHASE6_PREREQUISITE_REPORT_V2_SCHEMA_VERSION,
    banner: PHASE6_PREREQUISITE_REPORT_V2_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...PHASE6_PREREQUISITE_REPORT_V2_DISCLAIMERS],
    operatorLabel: nonEmptyString(input.operatorLabel) ? input.operatorLabel : null,
    prerequisites,
    buckets,
    notMet,
    phase6ImplementationReady,
    phase6ImplementationStarted: false,
    requiresExplicitHumanApproval: true,
    phase7LiveTradingReady: false,
    neverAuthorizesLiveTrading: true,
    recommendation,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

const STATUSES: ReadonlySet<string> = new Set(["met", "not-met", "documented"]);
const BUCKET_SET: ReadonlySet<string> = new Set(PHASE6_READINESS_BUCKETS);

/**
 * Strictly validate a value as a {@link Phase6PrerequisiteReportV2} and return it narrowed. A
 * backstop mirroring the package's sibling validators — including the HARD invariants
 * (`phase6ImplementationStarted=false`, `requiresExplicitHumanApproval=true`,
 * `phase7LiveTradingReady=false`, `neverAuthorizesLiveTrading=true`), the recomputed bucket
 * rollups, and that `phase6ImplementationReady` mirrors them. Throws
 * {@link Phase6PrerequisiteReportV2Error} on the first problem. Pure.
 */
export function validatePhase6PrerequisiteReportV2(value: unknown): Phase6PrerequisiteReportV2 {
  if (!isObject(value)) throw new Phase6PrerequisiteReportV2Error("phase 6 prerequisite v2 report must be a JSON object");
  if (value.schemaVersion !== PHASE6_PREREQUISITE_REPORT_V2_SCHEMA_VERSION) {
    throw new Phase6PrerequisiteReportV2Error(`report.schemaVersion must be "${PHASE6_PREREQUISITE_REPORT_V2_SCHEMA_VERSION}"`);
  }
  if (value.banner !== PHASE6_PREREQUISITE_REPORT_V2_BANNER) {
    throw new Phase6PrerequisiteReportV2Error(`report.banner must be "${PHASE6_PREREQUISITE_REPORT_V2_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new Phase6PrerequisiteReportV2Error(`report.${flag} must be true`);
  }
  // HARD invariants — these can never be anything else.
  if (value.phase6ImplementationStarted !== false) {
    throw new Phase6PrerequisiteReportV2Error("report.phase6ImplementationStarted must be false — ALWAYS");
  }
  if (value.requiresExplicitHumanApproval !== true) {
    throw new Phase6PrerequisiteReportV2Error("report.requiresExplicitHumanApproval must be true — ALWAYS");
  }
  if (value.phase7LiveTradingReady !== false) {
    throw new Phase6PrerequisiteReportV2Error("report.phase7LiveTradingReady must be false — ALWAYS");
  }
  if (value.neverAuthorizesLiveTrading !== true) {
    throw new Phase6PrerequisiteReportV2Error("report.neverAuthorizesLiveTrading must be true — ALWAYS");
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new Phase6PrerequisiteReportV2Error("report.disclaimers must be a non-empty array");
  }
  if (value.operatorLabel !== null && typeof value.operatorLabel !== "string") {
    throw new Phase6PrerequisiteReportV2Error("report.operatorLabel must be a string or null");
  }
  if (!Array.isArray(value.prerequisites) || value.prerequisites.length === 0) {
    throw new Phase6PrerequisiteReportV2Error("report.prerequisites must be a non-empty array");
  }
  const items = (value.prerequisites as unknown[]).map((p, i) => {
    const where = `report.prerequisites[${i}]`;
    if (!isObject(p)) throw new Phase6PrerequisiteReportV2Error(`${where} must be an object`);
    if (!nonEmptyString(p.id)) throw new Phase6PrerequisiteReportV2Error(`${where}.id must be a non-empty string`);
    if (!nonEmptyString(p.title)) throw new Phase6PrerequisiteReportV2Error(`${where}.title must be a non-empty string`);
    if (typeof p.bucket !== "string" || !BUCKET_SET.has(p.bucket)) {
      throw new Phase6PrerequisiteReportV2Error(`${where}.bucket must be one of the readiness buckets`);
    }
    if (typeof p.status !== "string" || !STATUSES.has(p.status)) {
      throw new Phase6PrerequisiteReportV2Error(`${where}.status must be met|not-met|documented`);
    }
    if (!nonEmptyString(p.source)) throw new Phase6PrerequisiteReportV2Error(`${where}.source must be a non-empty string`);
    if (!nonEmptyString(p.reason)) throw new Phase6PrerequisiteReportV2Error(`${where}.reason must be a non-empty string`);
    return p as unknown as Phase6PrerequisiteV2;
  });
  if (!Array.isArray(value.buckets)) throw new Phase6PrerequisiteReportV2Error("report.buckets must be an array");
  for (const [i, b] of (value.buckets as unknown[]).entries()) {
    const where = `report.buckets[${i}]`;
    if (!isObject(b) || typeof b.bucket !== "string" || !BUCKET_SET.has(b.bucket)) {
      throw new Phase6PrerequisiteReportV2Error(`${where}.bucket must be one of the readiness buckets`);
    }
    const bucketItems = items.filter((p) => p.bucket === b.bucket);
    const expectedMet = bucketItems.filter((p) => p.status === "met" || p.status === "documented").length;
    if (b.itemCount !== bucketItems.length || b.metCount !== expectedMet) {
      throw new Phase6PrerequisiteReportV2Error(`${where} counts must equal the recomputed rollup`);
    }
    const expectedReady = bucketItems.length > 0 && expectedMet === bucketItems.length;
    if (b.ready !== expectedReady) throw new Phase6PrerequisiteReportV2Error(`${where}.ready must equal the recomputed rollup`);
  }
  const expectedNotMet = items.filter((p) => p.status === "not-met").map((p) => p.id);
  if (JSON.stringify(value.notMet) !== JSON.stringify(expectedNotMet)) {
    throw new Phase6PrerequisiteReportV2Error("report.notMet must equal the recomputed not-met ids");
  }
  const expectedReady = (value.buckets as { ready: boolean }[]).every((b) => b.ready);
  if (value.phase6ImplementationReady !== expectedReady) {
    throw new Phase6PrerequisiteReportV2Error("report.phase6ImplementationReady must mirror the bucket rollups");
  }
  if (!nonEmptyString(value.recommendation)) throw new Phase6PrerequisiteReportV2Error("report.recommendation must be a non-empty string");
  for (const f of ["notes"] as const) {
    if (!Array.isArray(value[f]) || (value[f] as unknown[]).some((x) => typeof x !== "string")) {
      throw new Phase6PrerequisiteReportV2Error(`report.${f} must be an array of strings`);
    }
  }
  return value as unknown as Phase6PrerequisiteReportV2;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatPhase6PrerequisiteReportV2}. */
export interface FormatPhase6PrerequisiteReportV2Options {
  label?: string;
}

/**
 * Render a redacted, stable, human-readable v2 prerequisite report. Deterministic and path-stable.
 * Leads with the NOT-AUTHORIZATION banner, the per-bucket rollup, every item with its status, and
 * closes with the recommendation + the never-live disclaimers. Passed through the redactor.
 */
export function formatPhase6PrerequisiteReportV2(
  report: Phase6PrerequisiteReportV2,
  opts: FormatPhase6PrerequisiteReportV2Options = {},
): string {
  const header = `${report.banner} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];
  if (opts.label) lines.push(`label:    ${opts.label}`);
  if (report.operatorLabel) lines.push(`operator: ${report.operatorLabel}`);
  lines.push(`phase6ImplementationReady: ${report.phase6ImplementationReady ? "YES (pure simulation prerequisites only — still NOT authorization)" : "NO"}`);
  lines.push("phase6ImplementationStarted: false  |  phase7LiveTradingReady: false  |  requiresExplicitHumanApproval: true");

  lines.push("");
  lines.push("Buckets:");
  for (const b of report.buckets) {
    lines.push(`${b.ready ? "✓" : "✗"} ${b.title}: ${b.metCount}/${b.itemCount}`);
  }

  lines.push("");
  lines.push("Prerequisites:");
  for (const p of report.prerequisites) {
    const mark = p.status === "met" ? "✓" : p.status === "documented" ? "·" : "✗";
    lines.push(`${mark} [${p.status.toUpperCase()}] ${p.id} (${p.bucket})`);
    lines.push(`    ${p.reason}`);
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
