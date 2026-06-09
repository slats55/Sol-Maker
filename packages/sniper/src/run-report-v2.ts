/**
 * Deterministic, offline, **PAPER-only** SNIPER RUN REPORT **V2** (Sprint 50).
 *
 * V2 = the v1 run report plus the machine-readable layers the v2 pipeline produces:
 *
 *   - **Reason-code rollups** — when the decision artifact is a `sniper.paper.decision.report.v2`,
 *     its per-code / per-category counts are carried VERBATIM, a blocking-code rollup is derived,
 *     and every run entry carries its candidate's code trail.
 *   - **Policy visibility** — the decision's `policyApplied` / `policyLabel` / `policySchemaVersion`
 *     are echoed, and an optionally-supplied policy artifact (v1 or v2) contributes its `policyMode`
 *     and a verbatim risk-limit summary. A mismatch between the supplied policy and the one the
 *     decision was built with is SURFACED as a warning, never papered over.
 *   - **Preflight input coverage** — an optionally-supplied `sniper.preflight.input.v1` contributes
 *     its coverage counts (missing inspection/risk, unsupported shapes, mint mismatches, uncovered
 *     candidates). When a v2 policy declares `requirePreflightInputArtifact` and none was supplied,
 *     that is an OPERATOR-BLOCKING condition.
 *   - **Unresolved unknowns** — candidates that nothing resolved (missing/unknown preflight signal
 *     that ended in watch/no-decision, or a decision `unknown`).
 *   - **Operator-blocking reasons** — one deterministic list of everything an operator must resolve
 *     before this run can be considered complete.
 *
 * V1 is fully preserved: the v1 report keeps building/validating unchanged, the v2 builder REUSES
 * the v1 builder on an exact v1 view of its inputs, and {@link upgradeSniperRunReportV1ToV2} lifts
 * an existing v1 artifact from STRUCTURED fields only (no rollups are invented — a v1 artifact has
 * none to give).
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work; everything is carried
 * VERBATIM from already-built artifacts. A `paper-enter` here remains a SIMULATED, paper-only
 * classification — never a buy/sell order or live readiness. Carries no wall-clock time.
 */

import { redactString } from "@soulmaker/security";
import {
  buildSniperRunReport,
  validateSniperRunReport,
  formatSniperRunReport,
  SNIPER_RUN_REPORT_SCHEMA_VERSION,
  SNIPER_RUN_REPORT_BANNER,
  type BuildSniperRunReportInput,
  type SniperRunReport,
  type SniperRunCandidateEntry,
} from "./run-report.js";
import {
  validatePaperSniperDecisionReport,
  SNIPER_PAPER_DECISION_REPORT_SCHEMA_VERSION,
  SNIPER_PAPER_DECISION_REPORT_BANNER,
  SNIPER_PAPER_DECISION_REPORT_DISCLAIMERS,
  type SniperPaperDecisionReport,
  type SniperDecisionEntry,
} from "./paper-decision.js";
import {
  validatePaperSniperDecisionReportV2,
  SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION,
  type SniperPaperDecisionReportV2,
} from "./paper-decision-v2.js";
import {
  validateSniperPolicyConfig,
  SNIPER_POLICY_CONFIG_SCHEMA_VERSION,
  type SniperPolicyConfig,
} from "./policy-config.js";
import {
  validateSniperPolicyConfigV2,
  SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION,
  type SniperPolicyConfigV2,
  type SniperPolicyV2RiskLimits,
} from "./policy-config-v2.js";
import { validateSniperPreflightInput, type SniperPreflightInput } from "./preflight-input.js";
import {
  SNIPER_DECISION_REASON_CODE_DEFINITIONS,
  isSniperDecisionReasonCode,
  type SniperDecisionReasonCode,
} from "./decision-reason-codes.js";

/** Stable schema identifier for the v2 run report. Bump only on a breaking change. */
export const SNIPER_RUN_REPORT_V2_SCHEMA_VERSION = "sniper.run.report.v2";

/** The banner that prefixes every v2 run report (required label). */
export const SNIPER_RUN_REPORT_V2_BANNER = "SIMULATED PAPER-ONLY SNIPER RUN REPORT V2";

/** Required disclaimer statements carried by every v2 run report (stable order). */
export const SNIPER_RUN_REPORT_V2_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SNIPER RUN REPORT V2 — the v1 operator run summary plus reason-code rollups, policy visibility, preflight-input coverage, unresolved unknowns, and operator-blocking reasons.",
  "It bundles ALREADY-BUILT local artifacts and re-derives nothing: statuses, decisions, reason codes, and policy facts are carried VERBATIM.",
  "A `paper-enter` carried through here is a SIMULATED, paper-only classification — NOT a buy/sell order, NOT a transaction, and NOT live-trading readiness.",
  "A missing artifact or an unresolved unknown is surfaced (operator-blocking reasons), never invented or papered over.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this report.",
];

/** Thrown when v2 run-report INPUT or a produced report is structurally invalid. */
export class SniperRunReportV2Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperRunReportV2Error";
  }
}

// --- model -------------------------------------------------------------------

/** One candidate's v2 run entry: the v1 join plus its decision reason-code trail (empty for v1). */
export interface SniperRunCandidateEntryV2 extends SniperRunCandidateEntry {
  /** The candidate's decision reason-code trail, VERBATIM from a v2 decision (empty otherwise). */
  reasonCodes: SniperDecisionReasonCode[];
}

/** The reason-code rollup carried from a v2 decision artifact (null when the decision was v1/absent). */
export interface SniperRunReasonCodeRollup {
  /** Per-code occurrences, VERBATIM from the decision v2 report (sorted keys). */
  reasonCodeCounts: Record<string, number>;
  /** Per-category occurrences, VERBATIM from the decision v2 report (sorted keys). */
  categoryCounts: Record<string, number>;
  /** Occurrences of BLOCKING codes only, derived from the entries (sorted keys). */
  blockingReasonCodeCounts: Record<string, number>;
  /** Run-level codes, VERBATIM from the decision v2 report. */
  reportReasonCodes: SniperDecisionReasonCode[];
}

/** The policy visibility block (what governed the run, as far as the artifacts can prove). */
export interface SniperRunPolicySummary {
  /** From the decision artifact: whether a policy governed the build (null = v1 decision, unknown). */
  appliedPerDecision: boolean | null;
  /** From the decision artifact: the applied policy's label (null when none/unknown). */
  policyLabel: string | null;
  /** From the decision artifact: the applied policy's schemaVersion (null when none/unknown). */
  policySchemaVersion: string | null;
  /** From a SUPPLIED policy artifact: its schemaVersion (null when none supplied). */
  suppliedPolicySchemaVersion: string | null;
  /** From a SUPPLIED v2 policy artifact: its mode (null otherwise). */
  policyMode: string | null;
  /** From a SUPPLIED v2 policy artifact: its risk limits, VERBATIM (null otherwise). */
  riskLimits: SniperPolicyV2RiskLimits | null;
}

/** The preflight-input coverage block (null when no input artifact was supplied). */
export interface SniperRunPreflightInputCoverage {
  entryCount: number;
  missingInspectionCount: number;
  missingRiskCount: number;
  unsupportedShapeCount: number;
  mintMismatchCount: number;
  uncoveredCandidateCount: number | null;
  validationStatus: string;
}

/** The full, deterministic, JSON-serializable v2 run report. */
export interface SniperRunReportV2 extends Omit<SniperRunReport, "schemaVersion" | "banner" | "candidates"> {
  schemaVersion: string;
  banner: string;
  candidates: SniperRunCandidateEntryV2[];
  /** The decision artifact's schemaVersion (null when no decision was supplied). */
  decisionSchemaVersion: string | null;
  /** The reason-code rollup (null when the decision was v1 or absent — never invented). */
  reasonCodeRollup: SniperRunReasonCodeRollup | null;
  /** Policy visibility (decision-echoed facts + the optionally-supplied policy artifact). */
  policySummary: SniperRunPolicySummary;
  /** Preflight-input coverage (null when no input artifact was supplied). */
  preflightInputCoverage: SniperRunPreflightInputCoverage | null;
  /** A v2 policy required a preflight input artifact and none was supplied (operator-blocking). */
  missingRequiredPreflightInput: boolean;
  /** Candidates nothing resolved: missing/unknown preflight signal ending in watch/no-decision, or decision unknown. */
  unresolvedUnknownIds: string[];
  /** Everything an operator must resolve before this run can be considered complete (deterministic order). */
  operatorBlockingReasons: string[];
  /** True when this report was lifted from a v1 artifact (no rollups; codes empty). */
  upgradedFromV1: boolean;
}

/** Everything {@link buildSniperRunReportV2} needs. */
export interface BuildSniperRunReportV2Input {
  /** The candidate list (a canonical `sniper.candidate.list.v1`; strictly validated). The spine. */
  candidateList: unknown;
  /** Optional token preflight report (`sniper.token.preflight.report.v1`; strictly validated). */
  preflight?: unknown;
  /** Optional preflight input artifact (`sniper.preflight.input.v1`; strictly validated). */
  preflightInput?: unknown;
  /** Optional decision report — `sniper.paper.decision.report.v1` OR `.v2` (sniffed, strictly validated). */
  decision?: unknown;
  /** Optional policy config — `sniper.policy.config.v1` OR `.v2` (sniffed, strictly validated). */
  policy?: unknown;
  /** Optional workflow plan (`sniper.workflow.plan.v1`; strictly validated). */
  workflow?: unknown;
  /** Optional operator label echoed into the report (a string only — never system time). */
  operatorLabel?: string | null;
  /** Optional source label override (defaults to the candidate list's sourceLabel). */
  sourceLabel?: string | null;
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Project a v2 decision report onto its exact v1 surface (for the unchanged v1 run builder). */
function projectDecisionV2ToV1(v2: SniperPaperDecisionReportV2): SniperPaperDecisionReport {
  const entries: SniperDecisionEntry[] = v2.decisions.map((d) => ({
    candidateId: d.candidateId,
    mint: d.mint,
    decision: d.decision,
    preflightStatus: d.preflightStatus,
    reasons: [...d.reasons],
    blockingRiskFlags: d.blockingRiskFlags.map((f) => ({ ...f })),
    appliedRules: [...d.appliedRules],
    assumptions: [...d.assumptions],
  }));
  return validatePaperSniperDecisionReport({
    schemaVersion: SNIPER_PAPER_DECISION_REPORT_SCHEMA_VERSION,
    banner: SNIPER_PAPER_DECISION_REPORT_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...SNIPER_PAPER_DECISION_REPORT_DISCLAIMERS],
    sourceLabel: v2.sourceLabel,
    hasPreflight: v2.hasPreflight,
    rules: { ...v2.rules, denyMints: [...v2.rules.denyMints] },
    candidateCount: v2.candidateCount,
    decisions: entries,
    skipCount: v2.skipCount,
    watchCount: v2.watchCount,
    paperEnterCount: v2.paperEnterCount,
    paperRejectCount: v2.paperRejectCount,
    unknownCount: v2.unknownCount,
    hasPaperEnter: v2.hasPaperEnter,
    hasPaperReject: v2.hasPaperReject,
    hasRiskReject: v2.hasRiskReject,
    wouldFailOnPaperEnter: v2.wouldFailOnPaperEnter,
    wouldFailOnRisk: v2.wouldFailOnRisk,
    ciFailReasons: [...v2.ciFailReasons],
    warnings: [...v2.warnings],
    notes: [...v2.notes],
  });
}

/** Sorted-key occurrence counts of BLOCKING codes across all entries. */
function blockingCounts(decisions: readonly { blockingReasonCodes: SniperDecisionReasonCode[] }[]): Record<string, number> {
  const byCode = new Map<string, number>();
  for (const d of decisions) {
    for (const code of d.blockingReasonCodes) byCode.set(code, (byCode.get(code) ?? 0) + 1);
  }
  const out: Record<string, number> = {};
  for (const code of [...byCode.keys()].sort()) out[code] = byCode.get(code) as number;
  return out;
}

/** Derive the unresolved-unknown ids from a (v1-shaped) run report's structured fields. */
function unresolvedUnknowns(base: SniperRunReport): string[] {
  const seen = new Set<string>([...base.watchedMissingInfoIds, ...base.decisionUnknownIds]);
  return base.candidates.map((c) => c.candidateId).filter((id) => seen.has(id));
}

/** The deterministic operator-blocking reasons for a (v1-shaped) run + the v2-only conditions. */
function blockingReasons(
  base: SniperRunReport,
  unresolvedIds: string[],
  missingRequiredPreflightInput: boolean,
): string[] {
  const reasons: string[] = [];
  if (base.hasMissingRecommendedArtifact) {
    const missing: string[] = [];
    if (!base.artifactsPresent.preflight) missing.push("preflight");
    if (!base.artifactsPresent.decision) missing.push("decision");
    reasons.push(`recommended artifact(s) missing: ${missing.join(", ")} — build them before relying on this run.`);
  }
  if (missingRequiredPreflightInput) {
    reasons.push("the policy requires a validated preflight input artifact and none was supplied.");
  }
  if (base.hasInvalidCandidate) {
    reasons.push(`${base.invalidCandidateIds.length} candidate(s) reported an invalid mint: ${base.invalidCandidateIds.join(", ")}.`);
  }
  if (unresolvedIds.length > 0) {
    reasons.push(`${unresolvedIds.length} candidate(s) remain unresolved (missing/unknown information): ${unresolvedIds.join(", ")}.`);
  }
  if (base.hasRiskBlock) {
    reasons.push(`${base.riskBlockedIds.length} candidate(s) are risk-blocked and need operator review: ${base.riskBlockedIds.join(", ")}.`);
  }
  if (base.hasPaperEnter) {
    reasons.push(`${base.paperEnterIds.length} SIMULATED paper-enter(s) need operator review before any further step: ${base.paperEnterIds.join(", ")}.`);
  }
  return reasons;
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link SniperRunReportV2}. Pure and non-mutating. The v1 run builder does the
 * core join (on an exact v1 view of a v2 decision, so the v1 semantics are untouched); the v2 layers
 * are then carried VERBATIM from the supplied artifacts: reason-code rollups + per-candidate trails
 * (v2 decision only — never invented for a v1 decision), policy visibility (decision-echoed facts +
 * the optionally-supplied policy artifact, with a mismatch surfaced as a warning), preflight-input
 * coverage, unresolved unknowns, and the operator-blocking reasons. Throws
 * {@link SniperRunReportV2Error} on any invalid input.
 */
export function buildSniperRunReportV2(input: BuildSniperRunReportV2Input): SniperRunReportV2 {
  if (!isObject(input)) {
    throw new SniperRunReportV2Error("run report v2 input must be an object");
  }

  // 1) Sniff + validate the decision artifact (v1 or v2).
  let decisionV1: SniperPaperDecisionReport | null = null;
  let decisionV2: SniperPaperDecisionReportV2 | null = null;
  if (input.decision !== undefined && input.decision !== null) {
    const sniffed = isObject(input.decision) ? input.decision.schemaVersion : undefined;
    try {
      if (sniffed === SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION) {
        decisionV2 = validatePaperSniperDecisionReportV2(input.decision);
      } else {
        decisionV1 = validatePaperSniperDecisionReport(input.decision);
      }
    } catch (err) {
      throw new SniperRunReportV2Error(`decision report is invalid: ${(err as Error).message}`);
    }
  }

  // 2) Optional preflight input artifact + policy artifact (sniffed v1/v2).
  let preflightInput: SniperPreflightInput | null = null;
  if (input.preflightInput !== undefined && input.preflightInput !== null) {
    try {
      preflightInput = validateSniperPreflightInput(input.preflightInput);
    } catch (err) {
      throw new SniperRunReportV2Error(`preflight input is invalid: ${(err as Error).message}`);
    }
  }
  let policyV1: SniperPolicyConfig | null = null;
  let policyV2: SniperPolicyConfigV2 | null = null;
  if (input.policy !== undefined && input.policy !== null) {
    const sniffed = isObject(input.policy) ? input.policy.schemaVersion : undefined;
    try {
      if (sniffed === SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION) {
        policyV2 = validateSniperPolicyConfigV2(input.policy);
      } else if (sniffed === SNIPER_POLICY_CONFIG_SCHEMA_VERSION) {
        policyV1 = validateSniperPolicyConfig(input.policy);
      } else {
        throw new SniperRunReportV2Error(
          `policy schemaVersion must be "${SNIPER_POLICY_CONFIG_SCHEMA_VERSION}" or "${SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION}"`,
        );
      }
    } catch (err) {
      throw new SniperRunReportV2Error(`policy config is invalid: ${(err as Error).message}`);
    }
  }

  // 3) The unchanged v1 core join (on the exact v1 view of a v2 decision).
  const v1Input: BuildSniperRunReportInput = {
    candidateList: input.candidateList,
    preflight: input.preflight,
    decision: decisionV2 ? projectDecisionV2ToV1(decisionV2) : decisionV1 ?? undefined,
    workflow: input.workflow,
    operatorLabel: input.operatorLabel,
    sourceLabel: input.sourceLabel,
  };
  let base: SniperRunReport;
  try {
    base = buildSniperRunReport(v1Input);
  } catch (err) {
    throw new SniperRunReportV2Error((err as Error).message);
  }

  // 4) The v2 layers — carried verbatim, never invented.
  const codesById = new Map<string, SniperDecisionReasonCode[]>(
    decisionV2 ? decisionV2.decisions.map((d) => [d.candidateId, [...d.reasonCodes]]) : [],
  );
  const candidates: SniperRunCandidateEntryV2[] = base.candidates.map((c) => ({
    ...c,
    reasonCodes: codesById.get(c.candidateId) ?? [],
  }));

  const reasonCodeRollup: SniperRunReasonCodeRollup | null = decisionV2
    ? {
        reasonCodeCounts: { ...decisionV2.reasonCodeCounts },
        categoryCounts: { ...decisionV2.categoryCounts },
        blockingReasonCodeCounts: blockingCounts(decisionV2.decisions),
        reportReasonCodes: [...decisionV2.reportReasonCodes],
      }
    : null;

  const suppliedPolicy = policyV2 ?? policyV1;
  const policySummary: SniperRunPolicySummary = {
    appliedPerDecision: decisionV2 ? decisionV2.policyApplied : null,
    policyLabel: decisionV2?.policyLabel ?? null,
    policySchemaVersion: decisionV2?.policySchemaVersion ?? null,
    suppliedPolicySchemaVersion: suppliedPolicy?.schemaVersion ?? null,
    policyMode: policyV2?.policyMode ?? null,
    riskLimits: policyV2
      ? {
          ...policyV2.riskLimits,
          disallowedReasonCodes: [...policyV2.riskLimits.disallowedReasonCodes],
          disallowedPreflightStatuses: [...policyV2.riskLimits.disallowedPreflightStatuses],
        }
      : null,
  };

  const preflightInputCoverage: SniperRunPreflightInputCoverage | null = preflightInput
    ? {
        entryCount: preflightInput.entryCount,
        missingInspectionCount: preflightInput.missingInspectionCount,
        missingRiskCount: preflightInput.missingRiskCount,
        unsupportedShapeCount: preflightInput.unsupportedShapeCount,
        mintMismatchCount: preflightInput.mintMismatchCount,
        uncoveredCandidateCount: preflightInput.uncoveredCandidateCount,
        validationStatus: preflightInput.validationStatus,
      }
    : null;

  const missingRequiredPreflightInput =
    policyV2 !== null && policyV2.riskLimits.requirePreflightInputArtifact && preflightInput === null;

  const unresolvedUnknownIds = unresolvedUnknowns(base);
  const operatorBlockingReasons = blockingReasons(base, unresolvedUnknownIds, missingRequiredPreflightInput);

  const warnings = [...base.warnings];
  if (
    decisionV2 &&
    suppliedPolicy &&
    decisionV2.policyApplied === true &&
    decisionV2.policySchemaVersion !== suppliedPolicy.schemaVersion
  ) {
    warnings.push(
      `the supplied policy is ${suppliedPolicy.schemaVersion} but the decision was built with ${decisionV2.policySchemaVersion} — make sure the right policy artifact is paired with this run.`,
    );
  }
  if (decisionV2?.upgradedFromV1) {
    warnings.push("the decision artifact was upgraded from v1 — its reason codes are a conservative subset.");
  }

  return {
    ...base,
    schemaVersion: SNIPER_RUN_REPORT_V2_SCHEMA_VERSION,
    banner: SNIPER_RUN_REPORT_V2_BANNER,
    disclaimers: [...SNIPER_RUN_REPORT_V2_DISCLAIMERS],
    candidates,
    decisionSchemaVersion: decisionV2 ? decisionV2.schemaVersion : decisionV1 ? decisionV1.schemaVersion : null,
    reasonCodeRollup,
    policySummary,
    preflightInputCoverage,
    missingRequiredPreflightInput,
    unresolvedUnknownIds,
    operatorBlockingReasons,
    upgradedFromV1: false,
    warnings,
  };
}

// --- v1 → v2 adapter ----------------------------------------------------------

/**
 * Lift an existing canonical `sniper.run.report.v1` into a v2 report. Pure, structured-fields-only:
 * NO rollup or policy fact is invented (a v1 artifact has none to give) — `reasonCodeRollup` is null,
 * every entry's `reasonCodes` is empty, and the policy summary is all-null. The unresolved-unknown
 * ids and operator-blocking reasons ARE derivable from v1's structured fields and are populated.
 * Throws {@link SniperRunReportV2Error} when the input is not a valid v1 run report.
 */
export function upgradeSniperRunReportV1ToV2(value: unknown): SniperRunReportV2 {
  let v1: SniperRunReport;
  try {
    v1 = validateSniperRunReport(value);
  } catch (err) {
    throw new SniperRunReportV2Error(`v1 run report is invalid: ${(err as Error).message}`);
  }
  const unresolvedUnknownIds = unresolvedUnknowns(v1);
  return {
    ...v1,
    schemaVersion: SNIPER_RUN_REPORT_V2_SCHEMA_VERSION,
    banner: SNIPER_RUN_REPORT_V2_BANNER,
    disclaimers: [...SNIPER_RUN_REPORT_V2_DISCLAIMERS],
    candidates: v1.candidates.map((c) => ({ ...c, reasonCodes: [] })),
    decisionSchemaVersion: v1.artifactsPresent.decision ? SNIPER_PAPER_DECISION_REPORT_SCHEMA_VERSION : null,
    reasonCodeRollup: null,
    policySummary: {
      appliedPerDecision: null,
      policyLabel: null,
      policySchemaVersion: null,
      suppliedPolicySchemaVersion: null,
      policyMode: null,
      riskLimits: null,
    },
    preflightInputCoverage: null,
    missingRequiredPreflightInput: false,
    unresolvedUnknownIds,
    operatorBlockingReasons: blockingReasons(v1, unresolvedUnknownIds, false),
    upgradedFromV1: true,
    notes: [
      ...v1.notes,
      "Upgraded from v1: no reason-code rollup or policy fact was invented — a v1 run report carries none.",
    ],
  };
}

// --- validation (backstop) ---------------------------------------------------

/**
 * Strictly validate a value as a {@link SniperRunReportV2} and return it narrowed. The v1 surface is
 * validated by the REAL v1 validator (on an exact v1 view); the v2 additions are validated here —
 * every entry code is in the closed vocabulary and candidate-scoped, the rollup's blocking counts are
 * recomputed and compared, and the unresolved-unknown ids are recomputed from the structured fields.
 * Throws {@link SniperRunReportV2Error} on the first problem. Pure.
 */
export function validateSniperRunReportV2(value: unknown): SniperRunReportV2 {
  if (!isObject(value)) throw new SniperRunReportV2Error("run report v2 must be a JSON object");
  if (value.schemaVersion !== SNIPER_RUN_REPORT_V2_SCHEMA_VERSION) {
    throw new SniperRunReportV2Error(`run report v2.schemaVersion must be "${SNIPER_RUN_REPORT_V2_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_RUN_REPORT_V2_BANNER) {
    throw new SniperRunReportV2Error(`run report v2.banner must be "${SNIPER_RUN_REPORT_V2_BANNER}"`);
  }
  try {
    validateSniperRunReport({
      ...value,
      schemaVersion: SNIPER_RUN_REPORT_SCHEMA_VERSION,
      banner: SNIPER_RUN_REPORT_BANNER,
    });
  } catch (err) {
    throw new SniperRunReportV2Error((err as Error).message);
  }

  if (value.decisionSchemaVersion !== null && typeof value.decisionSchemaVersion !== "string") {
    throw new SniperRunReportV2Error("run report v2.decisionSchemaVersion must be a string or null");
  }
  if (typeof value.missingRequiredPreflightInput !== "boolean") {
    throw new SniperRunReportV2Error("run report v2.missingRequiredPreflightInput must be a boolean");
  }
  if (typeof value.upgradedFromV1 !== "boolean") {
    throw new SniperRunReportV2Error("run report v2.upgradedFromV1 must be a boolean");
  }
  for (const key of ["unresolvedUnknownIds", "operatorBlockingReasons"] as const) {
    if (!Array.isArray(value[key]) || (value[key] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperRunReportV2Error(`run report v2.${key} must be an array of strings`);
    }
  }

  // Entry codes: closed vocabulary, candidate scope.
  for (const [i, entry] of (value.candidates as Record<string, unknown>[]).entries()) {
    const codes = entry.reasonCodes;
    if (!Array.isArray(codes)) throw new SniperRunReportV2Error(`run report v2.candidates[${i}].reasonCodes must be an array`);
    for (const code of codes) {
      if (!isSniperDecisionReasonCode(code)) {
        throw new SniperRunReportV2Error(`run report v2.candidates[${i}].reasonCodes contains an unknown code "${String(code)}"`);
      }
      if (SNIPER_DECISION_REASON_CODE_DEFINITIONS[code].scope !== "candidate") {
        throw new SniperRunReportV2Error(`run report v2.candidates[${i}].reasonCodes contains report-scoped code "${code}"`);
      }
    }
  }

  // Rollup: shape + blocking counts recomputed from the entry trails.
  if (value.reasonCodeRollup !== null) {
    if (!isObject(value.reasonCodeRollup)) throw new SniperRunReportV2Error("run report v2.reasonCodeRollup must be an object or null");
    const rollup = value.reasonCodeRollup as Record<string, unknown>;
    for (const f of ["reasonCodeCounts", "categoryCounts", "blockingReasonCodeCounts"] as const) {
      if (!isObject(rollup[f])) throw new SniperRunReportV2Error(`run report v2.reasonCodeRollup.${f} must be an object`);
    }
    if (!Array.isArray(rollup.reportReasonCodes) || (rollup.reportReasonCodes as unknown[]).some((c) => !isSniperDecisionReasonCode(c))) {
      throw new SniperRunReportV2Error("run report v2.reasonCodeRollup.reportReasonCodes must be an array of known codes");
    }
    const expectedBlocking = blockingCounts(
      (value.candidates as { reasonCodes: SniperDecisionReasonCode[] }[]).map((c) => ({
        blockingReasonCodes: c.reasonCodes.filter((code) => SNIPER_DECISION_REASON_CODE_DEFINITIONS[code].blocking),
      })),
    );
    if (JSON.stringify(rollup.blockingReasonCodeCounts) !== JSON.stringify(expectedBlocking)) {
      throw new SniperRunReportV2Error("run report v2.reasonCodeRollup.blockingReasonCodeCounts must equal the recomputed blocking counts");
    }
  }

  if (!isObject(value.policySummary)) throw new SniperRunReportV2Error("run report v2.policySummary must be an object");
  const ps = value.policySummary as Record<string, unknown>;
  if (ps.appliedPerDecision !== null && typeof ps.appliedPerDecision !== "boolean") {
    throw new SniperRunReportV2Error("run report v2.policySummary.appliedPerDecision must be a boolean or null");
  }
  for (const f of ["policyLabel", "policySchemaVersion", "suppliedPolicySchemaVersion", "policyMode"] as const) {
    if (ps[f] !== null && typeof ps[f] !== "string") {
      throw new SniperRunReportV2Error(`run report v2.policySummary.${f} must be a string or null`);
    }
  }
  if (ps.riskLimits !== null && !isObject(ps.riskLimits)) {
    throw new SniperRunReportV2Error("run report v2.policySummary.riskLimits must be an object or null");
  }
  if (value.preflightInputCoverage !== null && !isObject(value.preflightInputCoverage)) {
    throw new SniperRunReportV2Error("run report v2.preflightInputCoverage must be an object or null");
  }

  // Unresolved unknowns are DERIVED — recompute from the structured fields and compare.
  const expectedUnresolved = unresolvedUnknowns(value as unknown as SniperRunReport);
  if (JSON.stringify(value.unresolvedUnknownIds) !== JSON.stringify(expectedUnresolved)) {
    throw new SniperRunReportV2Error("run report v2.unresolvedUnknownIds must equal the recomputed unresolved set");
  }
  return value as unknown as SniperRunReportV2;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperRunReportV2}. */
export interface FormatSniperRunReportV2Options {
  label?: string;
  /** Cap on the number of candidate rows printed (default 100; the rest are summarized). */
  maxRows?: number;
}

/**
 * Render a redacted, stable, human-readable v2 run report. The v1 sections render first (via the
 * UNCHANGED v1 formatter on an exact v1 view), then the v2 layers: policy visibility, the
 * reason-code rollup, preflight-input coverage, unresolved unknowns, and the operator-blocking
 * reasons. Deterministic and path-stable. The whole output is passed through the shared redactor.
 */
export function formatSniperRunReportV2(
  report: SniperRunReportV2,
  opts: FormatSniperRunReportV2Options = {},
): string {
  // The v1 body renders first (exact v1 view; its banner lines are replaced by the v2 banner and
  // its disclaimers are suppressed so the v2 disclaimers can close the whole output).
  const v1View: SniperRunReport = {
    ...report,
    schemaVersion: SNIPER_RUN_REPORT_SCHEMA_VERSION,
    banner: SNIPER_RUN_REPORT_BANNER,
    candidates: report.candidates.map(({ reasonCodes: _reasonCodes, ...rest }) => rest),
    disclaimers: [],
  };
  const header = `${report.banner} (PAPER ONLY)`;
  const v1Body = formatSniperRunReport(v1View, opts).split("\n").slice(2);
  while (v1Body.length > 0 && v1Body[v1Body.length - 1] === "") v1Body.pop();
  const lines: string[] = [header, "=".repeat(header.length), ...v1Body];

  lines.push("");
  lines.push("Policy (v2):");
  lines.push(`- applied per decision: ${report.policySummary.appliedPerDecision === null ? "(unknown)" : report.policySummary.appliedPerDecision ? "yes" : "no"}`);
  lines.push(`- policy: ${report.policySummary.policyLabel ?? "(none)"}${report.policySummary.policySchemaVersion ? ` (${report.policySummary.policySchemaVersion})` : ""}`);
  lines.push(`- supplied policy artifact: ${report.policySummary.suppliedPolicySchemaVersion ?? "(none)"}${report.policySummary.policyMode ? `; mode: ${report.policySummary.policyMode}` : ""}`);
  if (report.policySummary.riskLimits) {
    const rl = report.policySummary.riskLimits;
    lines.push(`- risk limits: disallowedCodes=${rl.disallowedReasonCodes.length}, disallowedStatuses=${rl.disallowedPreflightStatuses.length > 0 ? rl.disallowedPreflightStatuses.join("/") : "(none)"}, maxWarnings=${rl.maxWarningsPerCandidate ?? "(none)"}, requireRisk=${rl.requireRiskPresent}, requireInspection=${rl.requireInspectionPresent}, requirePreflightInput=${rl.requirePreflightInputArtifact}`);
  }

  lines.push("");
  lines.push("Reason-code rollup (v2):");
  if (!report.reasonCodeRollup) {
    lines.push(`- (none — the decision artifact ${report.decisionSchemaVersion === null ? "is absent" : "is v1 and carries no codes"})`);
  } else {
    const r = report.reasonCodeRollup;
    for (const code of Object.keys(r.reasonCodeCounts)) {
      lines.push(`- ${code}  ×${r.reasonCodeCounts[code]}`);
    }
    const blockingKeys = Object.keys(r.blockingReasonCodeCounts);
    lines.push(`- blocking: ${blockingKeys.length > 0 ? blockingKeys.map((c) => `${c} ×${r.blockingReasonCodeCounts[c]}`).join(", ") : "(none)"}`);
    if (r.reportReasonCodes.length > 0) lines.push(`- run-level: ${r.reportReasonCodes.join(", ")}`);
  }

  lines.push("");
  lines.push("Preflight-input coverage (v2):");
  if (!report.preflightInputCoverage) {
    lines.push(`- (no preflight input artifact supplied)${report.missingRequiredPreflightInput ? " — REQUIRED by the policy (operator-blocking)" : ""}`);
  } else {
    const c = report.preflightInputCoverage;
    lines.push(`- ${c.entryCount} entr${c.entryCount === 1 ? "y" : "ies"}; missing inspection ${c.missingInspectionCount}, missing risk ${c.missingRiskCount}, unsupported ${c.unsupportedShapeCount}, mint mismatches ${c.mintMismatchCount}, uncovered ${c.uncoveredCandidateCount ?? "(not cross-checked)"} (${c.validationStatus})`);
  }

  lines.push("");
  lines.push(`Unresolved unknowns: ${report.unresolvedUnknownIds.length > 0 ? report.unresolvedUnknownIds.join(", ") : "(none)"}`);

  lines.push("");
  lines.push("Operator-blocking reasons:");
  if (report.operatorBlockingReasons.length === 0) {
    lines.push("- (none — nothing blocks this PAPER run from being considered complete)");
  } else {
    for (const r of report.operatorBlockingReasons) lines.push(`- ${r}`);
  }

  lines.push("");
  for (const d of report.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
