/**
 * Deterministic, offline, **PAPER-only** SNIPER RUN REPORT (Phase 5+ operator summary).
 *
 * The sniper path produces several local artifacts — a candidate list, a token preflight, a paper
 * decision report, and (optionally) a workflow plan. This module folds them into ONE navigable,
 * operator-readable run report: a per-candidate **reason trail** that joins each candidate to its
 * preflight status and its simulated decision, plus the grouped id lists (paper-enter / paper-reject /
 * skip / watch / risk-blocked / missing-info / unknown / invalid) and a CI decision section an operator
 * or pipeline can gate on. It is the sniper analogue of the research artifact pack.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work. It consumes ALREADY-BUILT
 * artifacts (the CLI loads them from local files); the candidate list is the spine (it defines the
 * candidate set + order), and the preflight / decision / workflow are STRICTLY validated when present.
 * The package carries no chain capability.
 *
 * Nothing here is a trade signal: a `paper-enter` carried through from the decision report is a
 * **simulated, paper-only** classification — never a buy/sell order, a transaction, or live readiness.
 * Nothing builds, signs, simulates, or sends a transaction or holds a key. It carries no wall-clock
 * time, so the same inputs yield a byte-identical report.
 */

import { redactString } from "@soulmaker/security";
import { validateSniperCandidateList, type SniperCandidateList } from "./candidate-list.js";
import {
  validateSniperTokenPreflightReport,
  type SniperTokenPreflightReport,
  type SniperPreflightEntry,
  type SniperPreflightStatus,
} from "./token-preflight.js";
import {
  validatePaperSniperDecisionReport,
  type SniperPaperDecisionReport,
  type SniperDecisionEntry,
  type SniperDecision,
} from "./paper-decision.js";
import { validateSniperWorkflowPlan, type SniperWorkflowPlan } from "./workflow.js";

/** Stable schema identifier for the run report. Bump only on a breaking change. */
export const SNIPER_RUN_REPORT_SCHEMA_VERSION = "sniper.run.report.v1";

/** The banner that prefixes every run report (required label). */
export const SNIPER_RUN_REPORT_BANNER = "SIMULATED PAPER-ONLY SNIPER RUN REPORT";

/** Required disclaimer statements carried by every run report (stable order). */
export const SNIPER_RUN_REPORT_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SNIPER RUN REPORT — a deterministic operator summary that joins a candidate list, an optional preflight, an optional paper decision report, and an optional workflow plan into one navigable view.",
  "It bundles ALREADY-BUILT local artifacts and re-derives nothing: every preflight status and decision is carried VERBATIM from the supplied artifacts.",
  "A `paper-enter` carried through here is a SIMULATED, paper-only classification — NOT a buy/sell order, NOT a transaction, and NOT live-trading readiness.",
  "A missing preflight or decision artifact is surfaced (hasMissingRecommendedArtifact), not invented; the report never fabricates a status it was not given.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this report.",
];

/** Thrown when run-report INPUT or a produced report is structurally invalid. */
export class SniperRunReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperRunReportError";
  }
}

// --- input -------------------------------------------------------------------

/** Everything {@link buildSniperRunReport} needs. The candidate list is required; the rest is optional. */
export interface BuildSniperRunReportInput {
  /** The candidate list (a canonical `sniper.candidate.list.v1`; strictly validated). The spine. */
  candidateList: unknown;
  /** Optional token preflight report (`sniper.token.preflight.report.v1`; strictly validated). */
  preflight?: unknown;
  /** Optional paper decision report (`sniper.paper.decision.report.v1`; strictly validated). */
  decision?: unknown;
  /** Optional workflow plan (`sniper.workflow.plan.v1`; strictly validated). */
  workflow?: unknown;
  /** Optional operator label echoed into the report (a string only — never system time). */
  operatorLabel?: string | null;
  /** Optional source label override (defaults to the candidate list's sourceLabel). */
  sourceLabel?: string | null;
}

// --- report model ------------------------------------------------------------

/** One candidate's joined run entry: its preflight status, its decision, and a merged reason trail. */
export interface SniperRunCandidateEntry {
  candidateId: string;
  mint: string;
  /** Whether the mint validated. Always true for a list candidate (the list refuses invalid mints); a
   * supplied preflight entry can still report `false` (e.g. a hand-edited preflight) — read verbatim. */
  mintValid: boolean;
  /** The preflight status for this candidate, or null when no preflight covered it. */
  preflightStatus: SniperPreflightStatus | null;
  /** The simulated decision for this candidate, or null when no decision report covered it. */
  decision: SniperDecision | null;
  /** True iff a risk-driven block fired (preflight risk fail, or a decision paper-reject on risk). */
  riskBlocked: boolean;
  /** True iff the candidate could not be assessed for lack of preflight data (and was not rejected/skipped). */
  watchedMissingInfo: boolean;
  /** A provenance-prefixed reason trail merged from the preflight + decision (stable order). */
  reasons: string[];
  /** Risk flags (id/severity/title) that contributed to a risk block (empty otherwise). */
  blockingRiskFlags: { id: string; severity: string; title: string }[];
}

/** A projected preflight summary (null when no preflight was supplied). */
export interface SniperRunPreflightSummary {
  candidateCount: number;
  passCount: number;
  warnCount: number;
  failCount: number;
  unknownCount: number;
}

/** A projected decision summary (null when no decision report was supplied). */
export interface SniperRunDecisionSummary {
  candidateCount: number;
  skipCount: number;
  watchCount: number;
  paperEnterCount: number;
  paperRejectCount: number;
  unknownCount: number;
}

/** A projected workflow summary (null when no workflow plan was supplied). */
export interface SniperRunWorkflowSummary {
  stageCount: number;
  doneCount: number;
  complete: boolean;
  nextStage: string | null;
  hasInvalidArtifact: boolean;
}

/** Which artifacts were supplied to the run report. */
export interface SniperRunArtifactsPresent {
  candidates: true;
  preflight: boolean;
  decision: boolean;
  workflow: boolean;
}

/** One navigation group: a labelled, non-empty set of candidate ids the operator can jump to. */
export interface SniperRunNavigationEntry {
  label: string;
  candidateIds: string[];
}

/** The full, deterministic, JSON-serializable run report. */
export interface SniperRunReport {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  operatorLabel: string | null;
  sourceLabel: string | null;
  candidateCount: number;
  artifactsPresent: SniperRunArtifactsPresent;
  preflightSummary: SniperRunPreflightSummary | null;
  decisionSummary: SniperRunDecisionSummary | null;
  workflowSummary: SniperRunWorkflowSummary | null;
  /** Per-candidate joined entries, in candidate-list order. */
  candidates: SniperRunCandidateEntry[];
  // --- grouped id lists (each derived from a precise predicate; stable, candidate-list order) ---
  paperEnterIds: string[];
  paperRejectIds: string[];
  skipIds: string[];
  watchIds: string[];
  decisionUnknownIds: string[];
  preflightFailedIds: string[];
  preflightUnknownIds: string[];
  riskBlockedIds: string[];
  watchedMissingInfoIds: string[];
  invalidCandidateIds: string[];
  // --- CI flags ---
  hasInvalidCandidate: boolean;
  hasPreflightFailure: boolean;
  hasRiskBlock: boolean;
  hasPaperEnter: boolean;
  hasUnknown: boolean;
  hasMissingRecommendedArtifact: boolean;
  /** Human descriptions of every concern currently present (what a `--fail-on-*` flag would trip on). */
  failReasons: string[];
  /** A compact navigation index: only non-empty groups, in a stable order. */
  navigation: SniperRunNavigationEntry[];
  warnings: string[];
  notes: string[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** True iff a preflight entry's `fail` was risk-driven (advisory REJECT or a critical risk flag). */
function preflightRiskFail(entry: SniperPreflightEntry): boolean {
  if (entry.status !== "fail" || !entry.risk) return false;
  return entry.risk.decision === "REJECT" || entry.risk.criticalFlagCount > 0;
}

/** Build one candidate's joined entry from its (optional) preflight + decision entries. */
function buildEntry(
  candidateId: string,
  mint: string,
  preflight: SniperPreflightEntry | undefined,
  decision: SniperDecisionEntry | undefined,
): SniperRunCandidateEntry {
  // mintValid: a list candidate is always valid, but a supplied preflight is read verbatim.
  const mintValid = preflight ? preflight.mintValid : true;
  const preflightStatus = preflight ? preflight.status : null;
  const decisionValue = decision ? decision.decision : null;

  const reasons: string[] = [];
  if (preflight) {
    for (const d of preflight.disqualifiers) reasons.push(`preflight ✗ ${d}`);
    for (const w of preflight.warnings) reasons.push(`preflight ! ${w}`);
  }
  if (decision) {
    for (const r of decision.reasons) reasons.push(`decision · ${r}`);
  }

  const riskBlocked =
    (preflight !== undefined && preflightRiskFail(preflight)) ||
    (decisionValue === "paper-reject" && (decision?.blockingRiskFlags.length ?? 0) > 0);

  // "missing info": no preflight signal (no preflight artifact for this candidate, or it was `unknown`),
  // and the candidate was not otherwise resolved into a reject/skip/enter — i.e. it can only be watched.
  const missingPreflightSignal = preflightStatus === null || preflightStatus === "unknown";
  const watchedMissingInfo =
    missingPreflightSignal && (decisionValue === null || decisionValue === "watch");

  const blockingRiskFlags = decision ? decision.blockingRiskFlags : [];

  return {
    candidateId,
    mint,
    mintValid,
    preflightStatus,
    decision: decisionValue,
    riskBlocked,
    watchedMissingInfo,
    reasons,
    blockingRiskFlags,
  };
}

/** Validate an optional sub-artifact with the given validator; null when absent, throws when malformed. */
function optionalArtifact<T>(
  value: unknown,
  validate: (v: unknown) => T,
  label: string,
): T | null {
  if (value === undefined || value === null) return null;
  try {
    return validate(value);
  } catch (err) {
    throw new SniperRunReportError(`${label} is invalid: ${(err as Error).message}`);
  }
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link SniperRunReport} from a validated candidate list and the optional
 * preflight / decision / workflow artifacts. Pure and non-mutating. The candidate list is STRICTLY
 * validated and is the spine (it defines the candidate set + order). Each supplied sub-artifact is
 * STRICTLY validated; a preflight / decision entry that references a candidateId NOT in the list is
 * refused (the operator paired the wrong artifacts). A candidate the list carries but a sub-artifact
 * does not cover is fine — its preflightStatus / decision is null. Every status and decision is carried
 * VERBATIM (nothing is re-derived). Carries no wall-clock time.
 */
export function buildSniperRunReport(input: BuildSniperRunReportInput): SniperRunReport {
  if (!isObject(input)) {
    throw new SniperRunReportError("run report input must be an object");
  }
  let list: SniperCandidateList;
  try {
    list = validateSniperCandidateList(input.candidateList);
  } catch (err) {
    throw new SniperRunReportError(`candidate list is invalid: ${(err as Error).message}`);
  }
  if (input.operatorLabel !== undefined && input.operatorLabel !== null && typeof input.operatorLabel !== "string") {
    throw new SniperRunReportError("run report input.operatorLabel must be a string or null when present");
  }
  if (input.sourceLabel !== undefined && input.sourceLabel !== null && typeof input.sourceLabel !== "string") {
    throw new SniperRunReportError("run report input.sourceLabel must be a string or null when present");
  }

  const preflight = optionalArtifact<SniperTokenPreflightReport>(
    input.preflight,
    validateSniperTokenPreflightReport,
    "preflight report",
  );
  const decision = optionalArtifact<SniperPaperDecisionReport>(
    input.decision,
    validatePaperSniperDecisionReport,
    "decision report",
  );
  const workflow = optionalArtifact<SniperWorkflowPlan>(
    input.workflow,
    validateSniperWorkflowPlan,
    "workflow plan",
  );

  const listIds = new Set(list.candidates.map((c) => c.candidateId));

  // Index the sub-artifact entries by candidateId; an entry referencing an unknown id is a hard error.
  const preflightById = new Map<string, SniperPreflightEntry>();
  for (const e of preflight?.candidates ?? []) {
    if (!listIds.has(e.candidateId)) {
      throw new SniperRunReportError(`preflight references unknown candidateId "${e.candidateId}"`);
    }
    preflightById.set(e.candidateId, e);
  }
  const decisionById = new Map<string, SniperDecisionEntry>();
  for (const e of decision?.decisions ?? []) {
    if (!listIds.has(e.candidateId)) {
      throw new SniperRunReportError(`decision report references unknown candidateId "${e.candidateId}"`);
    }
    decisionById.set(e.candidateId, e);
  }

  const candidates = list.candidates.map((c) =>
    buildEntry(c.candidateId, c.mint, preflightById.get(c.candidateId), decisionById.get(c.candidateId)),
  );

  // Grouped id lists (each a precise predicate over the joined entries, in candidate-list order).
  const idsWhere = (pred: (e: SniperRunCandidateEntry) => boolean): string[] =>
    candidates.filter(pred).map((e) => e.candidateId);

  const paperEnterIds = idsWhere((e) => e.decision === "paper-enter");
  const paperRejectIds = idsWhere((e) => e.decision === "paper-reject");
  const skipIds = idsWhere((e) => e.decision === "skip");
  const watchIds = idsWhere((e) => e.decision === "watch");
  const decisionUnknownIds = idsWhere((e) => e.decision === "unknown");
  const preflightFailedIds = idsWhere((e) => e.preflightStatus === "fail");
  const preflightUnknownIds = idsWhere((e) => e.preflightStatus === "unknown");
  const riskBlockedIds = idsWhere((e) => e.riskBlocked);
  const watchedMissingInfoIds = idsWhere((e) => e.watchedMissingInfo);
  const invalidCandidateIds = idsWhere((e) => !e.mintValid);

  const hasInvalidCandidate = invalidCandidateIds.length > 0;
  const hasPreflightFailure = preflightFailedIds.length > 0;
  const hasRiskBlock = riskBlockedIds.length > 0;
  const hasPaperEnter = paperEnterIds.length > 0;
  const hasUnknown = decisionUnknownIds.length > 0 || preflightUnknownIds.length > 0;
  const hasMissingRecommendedArtifact = preflight === null || decision === null;

  const preflightSummary: SniperRunPreflightSummary | null = preflight
    ? {
        candidateCount: preflight.candidateCount,
        passCount: preflight.passCount,
        warnCount: preflight.warnCount,
        failCount: preflight.failCount,
        unknownCount: preflight.unknownCount,
      }
    : null;
  const decisionSummary: SniperRunDecisionSummary | null = decision
    ? {
        candidateCount: decision.candidateCount,
        skipCount: decision.skipCount,
        watchCount: decision.watchCount,
        paperEnterCount: decision.paperEnterCount,
        paperRejectCount: decision.paperRejectCount,
        unknownCount: decision.unknownCount,
      }
    : null;
  const workflowSummary: SniperRunWorkflowSummary | null = workflow
    ? {
        stageCount: workflow.stages.length,
        doneCount: workflow.doneCount,
        complete: workflow.complete,
        nextStage: workflow.nextStage,
        hasInvalidArtifact: workflow.hasInvalidArtifact,
      }
    : null;

  const failReasons: string[] = [];
  if (hasInvalidCandidate) failReasons.push(`${invalidCandidateIds.length} candidate(s) reported an invalid mint: ${invalidCandidateIds.join(", ")}`);
  if (hasPreflightFailure) failReasons.push(`${preflightFailedIds.length} candidate(s) failed preflight: ${preflightFailedIds.join(", ")}`);
  if (hasRiskBlock) failReasons.push(`${riskBlockedIds.length} candidate(s) blocked on risk: ${riskBlockedIds.join(", ")}`);
  if (hasPaperEnter) failReasons.push(`${paperEnterIds.length} candidate(s) would paper-enter (SIMULATED only): ${paperEnterIds.join(", ")}`);
  if (hasUnknown) {
    const unknownIds = [...new Set([...decisionUnknownIds, ...preflightUnknownIds])];
    failReasons.push(`${unknownIds.length} candidate(s) could not be classified (unknown): ${unknownIds.join(", ")}`);
  }
  if (hasMissingRecommendedArtifact) {
    const missing: string[] = [];
    if (preflight === null) missing.push("preflight");
    if (decision === null) missing.push("decision");
    failReasons.push(`missing recommended artifact(s): ${missing.join(", ")}`);
  }

  // Navigation: only non-empty groups, in a stable, operator-meaningful order.
  const navCandidates: SniperRunNavigationEntry[] = [
    { label: "paper-enter (SIMULATED)", candidateIds: paperEnterIds },
    { label: "paper-reject", candidateIds: paperRejectIds },
    { label: "risk-blocked", candidateIds: riskBlockedIds },
    { label: "preflight-failed", candidateIds: preflightFailedIds },
    { label: "skip", candidateIds: skipIds },
    { label: "watch", candidateIds: watchIds },
    { label: "watched-missing-info", candidateIds: watchedMissingInfoIds },
    { label: "unknown", candidateIds: [...new Set([...decisionUnknownIds, ...preflightUnknownIds])] },
    { label: "invalid-mint", candidateIds: invalidCandidateIds },
  ];
  const navigation = navCandidates.filter((g) => g.candidateIds.length > 0);

  const warnings: string[] = [];
  if (hasMissingRecommendedArtifact) {
    const missing: string[] = [];
    if (preflight === null) missing.push("preflight (run paper:sniper:preflight)");
    if (decision === null) missing.push("decision (run paper:sniper:decide)");
    warnings.push(`recommended artifact(s) not supplied: ${missing.join("; ")}`);
  }
  if (hasPaperEnter) {
    warnings.push(`${paperEnterIds.length} candidate(s) carried a SIMULATED paper-enter — this is not a buy order.`);
  }

  const notes = [
    `${candidates.length} candidate(s); preflight ${preflight ? "supplied" : "absent"}, decision ${decision ? "supplied" : "absent"}, workflow ${workflow ? "supplied" : "absent"}.`,
    "Every status and decision is carried VERBATIM from the supplied artifacts — this report re-derives nothing and is not a trade signal.",
  ];

  return {
    schemaVersion: SNIPER_RUN_REPORT_SCHEMA_VERSION,
    banner: SNIPER_RUN_REPORT_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...SNIPER_RUN_REPORT_DISCLAIMERS],
    operatorLabel: nonEmptyString(input.operatorLabel) ? input.operatorLabel : null,
    sourceLabel: nonEmptyString(input.sourceLabel) ? input.sourceLabel : list.sourceLabel,
    candidateCount: candidates.length,
    artifactsPresent: {
      candidates: true,
      preflight: preflight !== null,
      decision: decision !== null,
      workflow: workflow !== null,
    },
    preflightSummary,
    decisionSummary,
    workflowSummary,
    candidates,
    paperEnterIds,
    paperRejectIds,
    skipIds,
    watchIds,
    decisionUnknownIds,
    preflightFailedIds,
    preflightUnknownIds,
    riskBlockedIds,
    watchedMissingInfoIds,
    invalidCandidateIds,
    hasInvalidCandidate,
    hasPreflightFailure,
    hasRiskBlock,
    hasPaperEnter,
    hasUnknown,
    hasMissingRecommendedArtifact,
    failReasons,
    navigation,
    warnings,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

const PREFLIGHT_STATUSES: ReadonlySet<string> = new Set(["pass", "warn", "fail", "unknown"]);
const DECISIONS: ReadonlySet<string> = new Set(["skip", "watch", "paper-enter", "paper-reject", "unknown"]);

function validateEntry(value: unknown, where: string): void {
  if (!isObject(value)) throw new SniperRunReportError(`${where} must be an object`);
  if (!nonEmptyString(value.candidateId)) throw new SniperRunReportError(`${where}.candidateId must be a non-empty string`);
  if (!nonEmptyString(value.mint)) throw new SniperRunReportError(`${where}.mint must be a non-empty string`);
  if (typeof value.mintValid !== "boolean") throw new SniperRunReportError(`${where}.mintValid must be a boolean`);
  if (value.preflightStatus !== null && (typeof value.preflightStatus !== "string" || !PREFLIGHT_STATUSES.has(value.preflightStatus))) {
    throw new SniperRunReportError(`${where}.preflightStatus must be pass|warn|fail|unknown or null`);
  }
  if (value.decision !== null && (typeof value.decision !== "string" || !DECISIONS.has(value.decision))) {
    throw new SniperRunReportError(`${where}.decision must be skip|watch|paper-enter|paper-reject|unknown or null`);
  }
  for (const f of ["riskBlocked", "watchedMissingInfo"] as const) {
    if (typeof value[f] !== "boolean") throw new SniperRunReportError(`${where}.${f} must be a boolean`);
  }
  if (!Array.isArray(value.reasons) || (value.reasons as unknown[]).some((x) => typeof x !== "string")) {
    throw new SniperRunReportError(`${where}.reasons must be an array of strings`);
  }
  if (!Array.isArray(value.blockingRiskFlags)) throw new SniperRunReportError(`${where}.blockingRiskFlags must be an array`);
}

/**
 * Strictly validate a value as a {@link SniperRunReport} and return it narrowed. A backstop mirroring
 * the package's sibling validators: checks the schema version + banner, the PAPER-ONLY labelling, the
 * disclaimers, the artifacts-present block, every entry, the grouped id lists, the CI flags, and the
 * navigation. Throws {@link SniperRunReportError} on the first problem. Pure.
 */
export function validateSniperRunReport(value: unknown): SniperRunReport {
  if (!isObject(value)) throw new SniperRunReportError("run report must be a JSON object");
  if (value.schemaVersion !== SNIPER_RUN_REPORT_SCHEMA_VERSION) {
    throw new SniperRunReportError(`run report.schemaVersion must be "${SNIPER_RUN_REPORT_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_RUN_REPORT_BANNER) {
    throw new SniperRunReportError(`run report.banner must be "${SNIPER_RUN_REPORT_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new SniperRunReportError(`run report.${flag} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperRunReportError("run report.disclaimers must be a non-empty array");
  }
  for (const f of ["operatorLabel", "sourceLabel"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new SniperRunReportError(`run report.${f} must be a string or null`);
    }
  }
  if (typeof value.candidateCount !== "number" || !Number.isInteger(value.candidateCount) || value.candidateCount < 0) {
    throw new SniperRunReportError("run report.candidateCount must be a non-negative integer");
  }
  if (!isObject(value.artifactsPresent) || value.artifactsPresent.candidates !== true) {
    throw new SniperRunReportError("run report.artifactsPresent must be an object with candidates: true");
  }
  for (const f of ["preflight", "decision", "workflow"] as const) {
    if (typeof (value.artifactsPresent as Record<string, unknown>)[f] !== "boolean") {
      throw new SniperRunReportError(`run report.artifactsPresent.${f} must be a boolean`);
    }
  }
  for (const f of [
    "hasInvalidCandidate",
    "hasPreflightFailure",
    "hasRiskBlock",
    "hasPaperEnter",
    "hasUnknown",
    "hasMissingRecommendedArtifact",
  ] as const) {
    if (typeof value[f] !== "boolean") throw new SniperRunReportError(`run report.${f} must be a boolean`);
  }
  for (const key of [
    "paperEnterIds",
    "paperRejectIds",
    "skipIds",
    "watchIds",
    "decisionUnknownIds",
    "preflightFailedIds",
    "preflightUnknownIds",
    "riskBlockedIds",
    "watchedMissingInfoIds",
    "invalidCandidateIds",
    "failReasons",
    "warnings",
    "notes",
  ] as const) {
    if (!Array.isArray(value[key]) || (value[key] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperRunReportError(`run report.${key} must be an array of strings`);
    }
  }
  if (!Array.isArray(value.navigation)) throw new SniperRunReportError("run report.navigation must be an array");
  (value.navigation as unknown[]).forEach((g, i) => {
    if (!isObject(g) || !nonEmptyString(g.label)) {
      throw new SniperRunReportError(`run report.navigation[${i}].label must be a non-empty string`);
    }
    if (!Array.isArray(g.candidateIds) || (g.candidateIds as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperRunReportError(`run report.navigation[${i}].candidateIds must be an array of strings`);
    }
  });
  if (!Array.isArray(value.candidates)) throw new SniperRunReportError("run report.candidates must be an array");
  if ((value.candidates as unknown[]).length !== value.candidateCount) {
    throw new SniperRunReportError("run report.candidates length must equal candidateCount");
  }
  (value.candidates as unknown[]).forEach((e, i) => validateEntry(e, `run report.candidates[${i}]`));
  return value as unknown as SniperRunReport;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperRunReport}. */
export interface FormatSniperRunReportOptions {
  label?: string;
  /** Cap on the number of candidate rows printed (default 100; the rest are summarized). */
  maxRows?: number;
}

function yesNo(value: boolean): string {
  return value ? "YES" : "no";
}

/**
 * Render a redacted, stable, human-readable run report. Deterministic and path-stable (no timestamps).
 * Leads with the PAPER-ONLY banner, the artifact inventory, and the preflight / decision tallies; lists
 * each candidate's joined preflight status + decision + reason trail; and closes with the navigation
 * index, the CI verdict, and the not-a-trade-signal disclaimers. The whole output is passed through the
 * shared redactor.
 */
export function formatSniperRunReport(
  report: SniperRunReport,
  opts: FormatSniperRunReportOptions = {},
): string {
  const maxRows = opts.maxRows ?? 100;
  const header = `${report.banner} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];

  if (opts.label) lines.push(`label:      ${opts.label}`);
  if (report.operatorLabel) lines.push(`operator:   ${report.operatorLabel}`);
  lines.push(`source:     ${report.sourceLabel ?? "(none)"}`);
  lines.push(`candidates: ${report.candidateCount}`);
  lines.push(
    `artifacts:  candidates ✓ / preflight ${report.artifactsPresent.preflight ? "✓" : "—"} / decision ${report.artifactsPresent.decision ? "✓" : "—"} / workflow ${report.artifactsPresent.workflow ? "✓" : "—"}`,
  );

  if (report.preflightSummary) {
    const p = report.preflightSummary;
    lines.push(`preflight:  ${p.passCount} pass / ${p.warnCount} warn / ${p.failCount} fail / ${p.unknownCount} unknown`);
  }
  if (report.decisionSummary) {
    const d = report.decisionSummary;
    lines.push(
      `decisions:  ${d.paperEnterCount} paper-enter / ${d.watchCount} watch / ${d.skipCount} skip / ${d.paperRejectCount} paper-reject / ${d.unknownCount} unknown`,
    );
  }
  if (report.workflowSummary) {
    const w = report.workflowSummary;
    lines.push(`workflow:   ${w.doneCount}/${w.stageCount} stage(s) done${w.complete ? " (complete)" : w.nextStage ? `; next: ${w.nextStage}` : ""}`);
  }

  lines.push("");
  lines.push("Candidates:");
  if (report.candidates.length === 0) {
    lines.push("- (none)");
  } else {
    for (const e of report.candidates.slice(0, maxRows)) {
      const pf = e.preflightStatus ? e.preflightStatus.toUpperCase() : "—";
      const dec = e.decision ? e.decision.toUpperCase() : "—";
      lines.push(`- ${e.candidateId}  ${e.mint}  [preflight=${pf} decision=${dec}]`);
      for (const r of e.reasons) lines.push(`    ${r}`);
    }
    const hidden = report.candidates.length - Math.min(report.candidates.length, maxRows);
    if (hidden > 0) lines.push(`- … and ${hidden} more (summarized; see the report JSON for the full set)`);
  }

  if (report.navigation.length > 0) {
    lines.push("");
    lines.push("Navigation:");
    for (const g of report.navigation) lines.push(`- ${g.label}: ${g.candidateIds.join(", ")}`);
  }

  lines.push("");
  lines.push(`Any invalid candidate:        ${yesNo(report.hasInvalidCandidate)}`);
  lines.push(`Any preflight failure:        ${yesNo(report.hasPreflightFailure)}`);
  lines.push(`Any risk block:               ${yesNo(report.hasRiskBlock)}`);
  lines.push(`Any paper-enter (SIMULATED):  ${yesNo(report.hasPaperEnter)}`);
  lines.push(`Any unknown:                  ${yesNo(report.hasUnknown)}`);
  lines.push(`Missing recommended artifact: ${yesNo(report.hasMissingRecommendedArtifact)}`);
  if (report.failReasons.length > 0) {
    lines.push("Fail reasons:");
    for (const r of report.failReasons) lines.push(`- ${r}`);
  }

  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of report.warnings) lines.push(`- ${w}`);
  }

  lines.push("");
  lines.push("Notes:");
  for (const note of report.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of report.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
