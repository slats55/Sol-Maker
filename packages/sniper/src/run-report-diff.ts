/**
 * Deterministic, offline, **PAPER-only** SNIPER RUN REPORT DIFF (Phase 5+ comparison layer).
 *
 * Two sniper run reports (`sniper.run.report.v1`) describe a watchlist at two points — e.g. a CI run
 * yesterday vs today, or before vs after gathering more preflight data. This module compares them so an
 * operator (or CI) can see exactly what moved: candidates added / removed / present in both, per-candidate
 * decision and preflight-status transitions, and the conservative "got worse" / "recovered" signals.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work — the CLI loads the two reports
 * from local files and hands the parsed values here. Both are STRICTLY validated as run reports. The
 * package carries no chain capability.
 *
 * Nothing here is a trade signal: a `paper-enter` transition is a change between two **simulated,
 * paper-only** classifications — never a buy/sell order, a transaction, or live readiness. It carries no
 * wall-clock time, so the same pair yields a byte-identical diff.
 */

import { redactString } from "@soulmaker/security";
import {
  validateSniperRunReport,
  type SniperRunReport,
  type SniperRunCandidateEntry,
} from "./run-report.js";

/** Stable schema identifier for the run report diff. Bump only on a breaking change. */
export const SNIPER_RUN_REPORT_DIFF_SCHEMA_VERSION = "sniper.run.report.diff.v1";

/** The banner that prefixes every run report diff (required label). */
export const SNIPER_RUN_REPORT_DIFF_BANNER = "SIMULATED PAPER-ONLY SNIPER RUN REPORT DIFF";

/** Required disclaimer statements carried by every run report diff (stable order). */
export const SNIPER_RUN_REPORT_DIFF_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SNIPER RUN REPORT DIFF — a deterministic comparison of two sniper run reports (base vs next).",
  "It compares ALREADY-BUILT local artifacts and re-derives nothing: every transition is computed from the two reports' VERBATIM statuses and decisions.",
  "A `paper-enter` transition is a change between two SIMULATED, paper-only classifications — NOT a buy/sell order, NOT a transaction, and NOT live-trading readiness.",
  "`hasChange` flags ANY difference; the directional flags (newInvalid / newPreflightFailure / newRiskBlock / newPaperEnter / newUnknown / recovery) are conservative and honest.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this diff.",
];

/** Thrown when run-report-diff INPUT or a produced diff is structurally invalid. */
export class SniperRunReportDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperRunReportDiffError";
  }
}

// --- diff model --------------------------------------------------------------

/** A per-candidate decision transition over the common set. `from`/`to` are decision values or null. */
export interface SniperRunDecisionChange {
  candidateId: string;
  from: string | null;
  to: string | null;
}

/** A per-candidate preflight-status transition over the common set. `from`/`to` are statuses or null. */
export interface SniperRunPreflightStatusChange {
  candidateId: string;
  from: string | null;
  to: string | null;
}

/** Aggregate count deltas (next − base) over the derived group sizes. */
export interface SniperRunReportDiffDeltas {
  candidateCount: number;
  paperEnter: number;
  paperReject: number;
  skip: number;
  watch: number;
  riskBlocked: number;
  preflightFailed: number;
  unknown: number;
}

/** Metadata echoed for each side of the diff. */
export interface SniperRunReportDiffSide {
  operatorLabel: string | null;
  sourceLabel: string | null;
  candidateCount: number;
}

/** The full, deterministic, JSON-serializable run report diff. */
export interface SniperRunReportDiff {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  base: SniperRunReportDiffSide;
  next: SniperRunReportDiffSide;
  // --- membership ---
  candidatesAdded: string[];
  candidatesRemoved: string[];
  commonCount: number;
  // --- per-candidate transitions (over the common set) ---
  decisionChanges: SniperRunDecisionChange[];
  preflightStatusChanges: SniperRunPreflightStatusChange[];
  newlyInvalidIds: string[];
  newlyPreflightFailedIds: string[];
  newlyRiskBlockedIds: string[];
  newlyPaperEnterIds: string[];
  noLongerPaperEnterIds: string[];
  newlyUnknownIds: string[];
  noLongerUnknownIds: string[];
  recoveryIds: string[];
  // --- aggregate deltas ---
  deltas: SniperRunReportDiffDeltas;
  // --- CI flags ---
  hasChange: boolean;
  hasNewInvalid: boolean;
  hasNewPreflightFailure: boolean;
  hasNewRiskBlock: boolean;
  hasNewPaperEnter: boolean;
  hasNewUnknown: boolean;
  hasRecovery: boolean;
  notes: string[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** A candidate is "unknown" when its decision OR its preflight status is unknown. */
function isUnknown(entry: SniperRunCandidateEntry): boolean {
  return entry.decision === "unknown" || entry.preflightStatus === "unknown";
}

/** A candidate "has a concern" when it is invalid, failed preflight, is risk-blocked, or is unknown. */
function hasConcern(entry: SniperRunCandidateEntry): boolean {
  return !entry.mintValid || entry.preflightStatus === "fail" || entry.riskBlocked || isUnknown(entry);
}

/** The "unknown" group size for a report (union of decision-unknown + preflight-unknown). */
function unknownCount(report: SniperRunReport): number {
  return new Set([...report.decisionUnknownIds, ...report.preflightUnknownIds]).size;
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link SniperRunReportDiff} from two run reports. Pure and non-mutating. Both
 * inputs are STRICTLY validated as `sniper.run.report.v1`. Candidates are paired by `candidateId`:
 * membership changes (added / removed / common) and per-candidate transitions over the common set are
 * computed VERBATIM from each report's statuses and decisions (nothing is re-derived). The directional
 * flags are conservative — `recovery` fires only when a candidate that had a concern (invalid / preflight
 * fail / risk-blocked / unknown) in `base` has NONE in `next`. Carries no wall-clock time.
 */
export function diffSniperRunReports(baseInput: unknown, nextInput: unknown): SniperRunReportDiff {
  let base: SniperRunReport;
  let next: SniperRunReport;
  try {
    base = validateSniperRunReport(baseInput);
  } catch (err) {
    throw new SniperRunReportDiffError(`base run report is invalid: ${(err as Error).message}`);
  }
  try {
    next = validateSniperRunReport(nextInput);
  } catch (err) {
    throw new SniperRunReportDiffError(`next run report is invalid: ${(err as Error).message}`);
  }

  const baseById = new Map(base.candidates.map((e) => [e.candidateId, e]));
  const nextById = new Map(next.candidates.map((e) => [e.candidateId, e]));

  // Membership (candidate-list order preserved from each side).
  const candidatesAdded = next.candidates.filter((e) => !baseById.has(e.candidateId)).map((e) => e.candidateId);
  const candidatesRemoved = base.candidates.filter((e) => !nextById.has(e.candidateId)).map((e) => e.candidateId);
  // Common ids in NEXT order (next is the report being assessed).
  const common = next.candidates.filter((e) => baseById.has(e.candidateId));
  const commonCount = common.length;

  const decisionChanges: SniperRunDecisionChange[] = [];
  const preflightStatusChanges: SniperRunPreflightStatusChange[] = [];
  const newlyInvalidIds: string[] = [];
  const newlyPreflightFailedIds: string[] = [];
  const newlyRiskBlockedIds: string[] = [];
  const newlyPaperEnterIds: string[] = [];
  const noLongerPaperEnterIds: string[] = [];
  const newlyUnknownIds: string[] = [];
  const noLongerUnknownIds: string[] = [];
  const recoveryIds: string[] = [];

  for (const nextEntry of common) {
    const baseEntry = baseById.get(nextEntry.candidateId)!;
    if (baseEntry.decision !== nextEntry.decision) {
      decisionChanges.push({ candidateId: nextEntry.candidateId, from: baseEntry.decision, to: nextEntry.decision });
    }
    if (baseEntry.preflightStatus !== nextEntry.preflightStatus) {
      preflightStatusChanges.push({ candidateId: nextEntry.candidateId, from: baseEntry.preflightStatus, to: nextEntry.preflightStatus });
    }
    if (baseEntry.mintValid && !nextEntry.mintValid) newlyInvalidIds.push(nextEntry.candidateId);
    if (baseEntry.preflightStatus !== "fail" && nextEntry.preflightStatus === "fail") newlyPreflightFailedIds.push(nextEntry.candidateId);
    if (!baseEntry.riskBlocked && nextEntry.riskBlocked) newlyRiskBlockedIds.push(nextEntry.candidateId);
    if (baseEntry.decision !== "paper-enter" && nextEntry.decision === "paper-enter") newlyPaperEnterIds.push(nextEntry.candidateId);
    if (baseEntry.decision === "paper-enter" && nextEntry.decision !== "paper-enter") noLongerPaperEnterIds.push(nextEntry.candidateId);
    if (!isUnknown(baseEntry) && isUnknown(nextEntry)) newlyUnknownIds.push(nextEntry.candidateId);
    if (isUnknown(baseEntry) && !isUnknown(nextEntry)) noLongerUnknownIds.push(nextEntry.candidateId);
    if (hasConcern(baseEntry) && !hasConcern(nextEntry)) recoveryIds.push(nextEntry.candidateId);
  }

  const deltas: SniperRunReportDiffDeltas = {
    candidateCount: next.candidateCount - base.candidateCount,
    paperEnter: next.paperEnterIds.length - base.paperEnterIds.length,
    paperReject: next.paperRejectIds.length - base.paperRejectIds.length,
    skip: next.skipIds.length - base.skipIds.length,
    watch: next.watchIds.length - base.watchIds.length,
    riskBlocked: next.riskBlockedIds.length - base.riskBlockedIds.length,
    preflightFailed: next.preflightFailedIds.length - base.preflightFailedIds.length,
    unknown: unknownCount(next) - unknownCount(base),
  };

  const hasNewInvalid = newlyInvalidIds.length > 0;
  const hasNewPreflightFailure = newlyPreflightFailedIds.length > 0;
  const hasNewRiskBlock = newlyRiskBlockedIds.length > 0;
  const hasNewPaperEnter = newlyPaperEnterIds.length > 0;
  const hasNewUnknown = newlyUnknownIds.length > 0;
  const hasRecovery = recoveryIds.length > 0;

  const hasChange =
    candidatesAdded.length > 0 ||
    candidatesRemoved.length > 0 ||
    decisionChanges.length > 0 ||
    preflightStatusChanges.length > 0 ||
    newlyInvalidIds.length > 0 ||
    noLongerPaperEnterIds.length > 0 ||
    noLongerUnknownIds.length > 0;

  const notes = [
    `${candidatesAdded.length} added, ${candidatesRemoved.length} removed, ${commonCount} in both; ${decisionChanges.length} decision change(s), ${preflightStatusChanges.length} preflight-status change(s).`,
    "Every transition is computed VERBATIM from the two run reports — this diff re-derives nothing and is not a trade signal.",
  ];

  return {
    schemaVersion: SNIPER_RUN_REPORT_DIFF_SCHEMA_VERSION,
    banner: SNIPER_RUN_REPORT_DIFF_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...SNIPER_RUN_REPORT_DIFF_DISCLAIMERS],
    base: { operatorLabel: base.operatorLabel, sourceLabel: base.sourceLabel, candidateCount: base.candidateCount },
    next: { operatorLabel: next.operatorLabel, sourceLabel: next.sourceLabel, candidateCount: next.candidateCount },
    candidatesAdded,
    candidatesRemoved,
    commonCount,
    decisionChanges,
    preflightStatusChanges,
    newlyInvalidIds,
    newlyPreflightFailedIds,
    newlyRiskBlockedIds,
    newlyPaperEnterIds,
    noLongerPaperEnterIds,
    newlyUnknownIds,
    noLongerUnknownIds,
    recoveryIds,
    deltas,
    hasChange,
    hasNewInvalid,
    hasNewPreflightFailure,
    hasNewRiskBlock,
    hasNewPaperEnter,
    hasNewUnknown,
    hasRecovery,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

function validateSide(value: unknown, where: string): void {
  if (!isObject(value)) throw new SniperRunReportDiffError(`${where} must be an object`);
  for (const f of ["operatorLabel", "sourceLabel"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new SniperRunReportDiffError(`${where}.${f} must be a string or null`);
    }
  }
  if (typeof value.candidateCount !== "number" || !Number.isInteger(value.candidateCount) || value.candidateCount < 0) {
    throw new SniperRunReportDiffError(`${where}.candidateCount must be a non-negative integer`);
  }
}

function validateChangeList(value: unknown, where: string): void {
  if (!Array.isArray(value)) throw new SniperRunReportDiffError(`${where} must be an array`);
  value.forEach((c, i) => {
    if (!isObject(c) || !nonEmptyString(c.candidateId)) {
      throw new SniperRunReportDiffError(`${where}[${i}].candidateId must be a non-empty string`);
    }
    for (const f of ["from", "to"] as const) {
      if (c[f] !== null && typeof c[f] !== "string") {
        throw new SniperRunReportDiffError(`${where}[${i}].${f} must be a string or null`);
      }
    }
  });
}

/**
 * Strictly validate a value as a {@link SniperRunReportDiff} and return it narrowed. A backstop mirroring
 * the package's sibling validators. Throws {@link SniperRunReportDiffError} on the first problem. Pure.
 */
export function validateSniperRunReportDiff(value: unknown): SniperRunReportDiff {
  if (!isObject(value)) throw new SniperRunReportDiffError("run report diff must be a JSON object");
  if (value.schemaVersion !== SNIPER_RUN_REPORT_DIFF_SCHEMA_VERSION) {
    throw new SniperRunReportDiffError(`run report diff.schemaVersion must be "${SNIPER_RUN_REPORT_DIFF_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_RUN_REPORT_DIFF_BANNER) {
    throw new SniperRunReportDiffError(`run report diff.banner must be "${SNIPER_RUN_REPORT_DIFF_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new SniperRunReportDiffError(`run report diff.${flag} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperRunReportDiffError("run report diff.disclaimers must be a non-empty array");
  }
  validateSide(value.base, "run report diff.base");
  validateSide(value.next, "run report diff.next");
  if (typeof value.commonCount !== "number" || !Number.isInteger(value.commonCount) || value.commonCount < 0) {
    throw new SniperRunReportDiffError("run report diff.commonCount must be a non-negative integer");
  }
  for (const key of [
    "candidatesAdded",
    "candidatesRemoved",
    "newlyInvalidIds",
    "newlyPreflightFailedIds",
    "newlyRiskBlockedIds",
    "newlyPaperEnterIds",
    "noLongerPaperEnterIds",
    "newlyUnknownIds",
    "noLongerUnknownIds",
    "recoveryIds",
    "notes",
  ] as const) {
    if (!Array.isArray(value[key]) || (value[key] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperRunReportDiffError(`run report diff.${key} must be an array of strings`);
    }
  }
  validateChangeList(value.decisionChanges, "run report diff.decisionChanges");
  validateChangeList(value.preflightStatusChanges, "run report diff.preflightStatusChanges");
  if (!isObject(value.deltas)) throw new SniperRunReportDiffError("run report diff.deltas must be an object");
  for (const f of ["candidateCount", "paperEnter", "paperReject", "skip", "watch", "riskBlocked", "preflightFailed", "unknown"] as const) {
    if (typeof (value.deltas as Record<string, unknown>)[f] !== "number" || !Number.isInteger((value.deltas as Record<string, number>)[f])) {
      throw new SniperRunReportDiffError(`run report diff.deltas.${f} must be an integer`);
    }
  }
  for (const f of [
    "hasChange",
    "hasNewInvalid",
    "hasNewPreflightFailure",
    "hasNewRiskBlock",
    "hasNewPaperEnter",
    "hasNewUnknown",
    "hasRecovery",
  ] as const) {
    if (typeof value[f] !== "boolean") throw new SniperRunReportDiffError(`run report diff.${f} must be a boolean`);
  }
  return value as unknown as SniperRunReportDiff;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperRunReportDiff}. */
export interface FormatSniperRunReportDiffOptions {
  label?: string;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

/**
 * Render a redacted, stable, human-readable run report diff. Deterministic and path-stable (no
 * timestamps). Leads with the PAPER-ONLY banner and the membership summary, lists the per-candidate
 * decision / preflight transitions and the directional id lists, and closes with the aggregate deltas
 * and the CI verdict. The whole output is passed through the shared redactor.
 */
export function formatSniperRunReportDiff(
  diff: SniperRunReportDiff,
  opts: FormatSniperRunReportDiffOptions = {},
): string {
  const header = `${diff.banner} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];
  if (opts.label) lines.push(`label: ${opts.label}`);
  lines.push(`base:  ${diff.base.sourceLabel ?? "(none)"} (${diff.base.candidateCount} candidate(s))`);
  lines.push(`next:  ${diff.next.sourceLabel ?? "(none)"} (${diff.next.candidateCount} candidate(s))`);
  lines.push(`membership: +${diff.candidatesAdded.length} added / -${diff.candidatesRemoved.length} removed / ${diff.commonCount} in both`);

  if (diff.candidatesAdded.length > 0) lines.push(`  added:   ${diff.candidatesAdded.join(", ")}`);
  if (diff.candidatesRemoved.length > 0) lines.push(`  removed: ${diff.candidatesRemoved.join(", ")}`);

  if (diff.decisionChanges.length > 0) {
    lines.push("");
    lines.push("Decision changes:");
    for (const c of diff.decisionChanges) lines.push(`- ${c.candidateId}: ${c.from ?? "—"} → ${c.to ?? "—"}`);
  }
  if (diff.preflightStatusChanges.length > 0) {
    lines.push("");
    lines.push("Preflight status changes:");
    for (const c of diff.preflightStatusChanges) lines.push(`- ${c.candidateId}: ${c.from ?? "—"} → ${c.to ?? "—"}`);
  }

  const idLine = (label: string, ids: string[]): void => {
    if (ids.length > 0) lines.push(`- ${label}: ${ids.join(", ")}`);
  };
  lines.push("");
  lines.push("Transitions:");
  idLine("newly invalid", diff.newlyInvalidIds);
  idLine("newly preflight-failed", diff.newlyPreflightFailedIds);
  idLine("newly risk-blocked", diff.newlyRiskBlockedIds);
  idLine("newly paper-enter (SIMULATED)", diff.newlyPaperEnterIds);
  idLine("no longer paper-enter", diff.noLongerPaperEnterIds);
  idLine("newly unknown", diff.newlyUnknownIds);
  idLine("no longer unknown", diff.noLongerUnknownIds);
  idLine("recovered", diff.recoveryIds);

  lines.push("");
  lines.push("Aggregate deltas (next − base):");
  lines.push(`  candidates: ${signed(diff.deltas.candidateCount)}  paper-enter: ${signed(diff.deltas.paperEnter)}  paper-reject: ${signed(diff.deltas.paperReject)}`);
  lines.push(`  skip: ${signed(diff.deltas.skip)}  watch: ${signed(diff.deltas.watch)}  risk-blocked: ${signed(diff.deltas.riskBlocked)}  preflight-failed: ${signed(diff.deltas.preflightFailed)}  unknown: ${signed(diff.deltas.unknown)}`);

  lines.push("");
  lines.push(`Any change:              ${diff.hasChange ? "YES" : "no"}`);
  lines.push(`Any new invalid:         ${diff.hasNewInvalid ? "YES" : "no"}`);
  lines.push(`Any new preflight fail:  ${diff.hasNewPreflightFailure ? "YES" : "no"}`);
  lines.push(`Any new risk block:      ${diff.hasNewRiskBlock ? "YES" : "no"}`);
  lines.push(`Any new paper-enter:     ${diff.hasNewPaperEnter ? "YES" : "no"}`);
  lines.push(`Any new unknown:         ${diff.hasNewUnknown ? "YES" : "no"}`);
  lines.push(`Any recovery:            ${diff.hasRecovery ? "YES" : "no"}`);

  lines.push("");
  lines.push("Notes:");
  for (const note of diff.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of diff.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
