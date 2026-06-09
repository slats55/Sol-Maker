/**
 * Deterministic, offline, **simulated-only** RESEARCH PORTFOLIO REPORT (Sprint 21).
 *
 * Sprint 18 indexed MANY research runs under one campaign directory. Sprint 19 diffed TWO campaign
 * indexes. Sprint 20 folded an ORDERED SEQUENCE of campaign index snapshots into one per-campaign
 * HISTORY report. Sprint 21 sits one level higher in BREADTH: it rolls up MANY campaign history
 * reports — one per campaign — into a single portfolio-level integrity-triage view, answering at a
 * glance:
 *
 *   - Which campaigns currently need attention, and which newly need it since baseline?
 *   - Which campaigns have a conservative integrity regression?
 *   - Which campaigns changed since baseline / since their previous snapshot?
 *   - Which campaigns are clean (no integrity concern) or stable (no change at all)?
 *   - Which campaigns hold the longest valid / attention streaks?
 *   - What are the top portfolio-level integrity concerns?
 *   - Should CI fail on change / regression / current attention / newly-needed attention?
 *
 * It is **pure** and does NO filesystem/network IO of its own: like the index/diff/history builders
 * it accepts ALREADY-LOADED values (the CLI reads each campaign history report JSON and hands the
 * parsed value here). Each campaign report is strictly validated as a Sprint 20
 * `backtest.research.campaign.history.report.v1` via
 * {@link validateBacktestResearchCampaignHistoryReport} (so a non-history / wrong-schema input is
 * REFUSED, never silently mis-read). Every per-campaign signal (change / attention / regression /
 * streaks / counts) is carried VERBATIM from that history report — never re-derived or re-claimed —
 * so the portfolio view can never disagree with the campaign reports it summarizes. Campaign
 * ordering is integrity triage (most-concerning first), NOT a trading ranking. The report carries NO
 * wall-clock timestamp, so an identical set of campaign reports yields a byte-identical portfolio
 * report regardless of the order they were supplied in.
 *
 * This is bookkeeping over injected, simulated local summaries — NOT a live result, NOT real market
 * data, NOT advice, and NOT a profitability claim. Nothing here holds a key, or builds/signs/
 * simulates/sends a transaction. The conservative regression flag is an integrity/reproducibility
 * signal only, never a trading recommendation.
 */

import { redactString } from "@soulmaker/security";
import {
  validateBacktestResearchCampaignHistoryReport,
  type BacktestResearchCampaignHistoryReport,
} from "./research-campaign-history.js";

/** Stable schema identifier for the portfolio report. Bump only on a breaking change. */
export const BACKTEST_RESEARCH_PORTFOLIO_REPORT_SCHEMA_VERSION =
  "backtest.research.portfolio.report.v1";

/** The banner that prefixes every portfolio report (required label). */
export const BACKTEST_RESEARCH_PORTFOLIO_REPORT_BANNER =
  "SIMULATED PAPER-ONLY RESEARCH PORTFOLIO REPORT";

/** Required disclaimer statements carried by every portfolio report (stable order). */
export const BACKTEST_RESEARCH_PORTFOLIO_REPORT_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY RESEARCH PORTFOLIO REPORT — a deterministic integrity-triage rollup across LOCAL campaign history reports.",
  "Rolls up an ordered set of local campaign history reports only — it embeds no artifact contents, is not live data, and fetched nothing.",
  "Per-campaign change/attention/regression signals are carried VERBATIM from each campaign history report (which reuse the Sprint 19 campaign-diff semantics); the conservative regression flag is integrity-only and is NOT financial advice.",
  "Campaign ordering is integrity triage (most-concerning first), NOT a trading ranking or a best/worst-performer claim.",
  "Run counts are summed across campaigns; run ids are campaign-scoped, so no cross-campaign de-duplication is performed or implied.",
  "Reproducibility digests are non-cryptographic content fingerprints, NOT a security or anti-tamper guarantee.",
  "Not a live result.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this report.",
];

/** Thrown only when portfolio INPUT or a produced portfolio report is structurally invalid. */
export class BacktestResearchPortfolioReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestResearchPortfolioReportError";
  }
}

// --- input -------------------------------------------------------------------

/** One already-loaded campaign history report plus its stable campaign identifier. */
export interface BacktestResearchPortfolioCampaignInput {
  /** Stable, unique identifier for this campaign (e.g. "scalping"). Required, non-empty. */
  campaignId: string;
  /** An already-parsed value expected to be a Sprint 20 campaign history report (strictly validated). */
  report: unknown;
  /** Optional source path / label echoed into the report (e.g. the file it was read from). */
  sourceLabel?: string;
}

/** Everything {@link buildBacktestResearchPortfolioReport} needs (the campaign inputs). */
export interface BuildBacktestResearchPortfolioReportInput {
  /** Optional portfolio label. */
  portfolioName?: string;
  /** The campaign history reports to roll up. At least one; campaignIds must be unique. */
  campaigns: BacktestResearchPortfolioCampaignInput[];
}

// --- report model ------------------------------------------------------------

/** A single severity label derived from a campaign's carried-over flags. */
export type BacktestResearchPortfolioCampaignStatus =
  | "regression"
  | "attention"
  | "changed"
  | "clean";

/** One campaign's deterministic rollup line (every signal carried verbatim from its history report). */
export interface BacktestResearchPortfolioCampaignSummary {
  campaignId: string;
  /** The source path/label supplied for this campaign, or null. */
  sourceLabel: string | null;
  /** The campaign name carried from the history report, or null. */
  campaignName: string | null;
  /** How many ordered snapshots the underlying history report folded. */
  snapshotCount: number;
  latestSnapshotId: string;
  baselineSnapshotId: string;
  // --- carried-over flags ---
  hasChange: boolean;
  hasRegression: boolean;
  hasAttention: boolean;
  hasNewAttentionSinceBaseline: boolean;
  // --- carried-over counts ---
  runsCurrentlyPresent: number;
  totalRunsObserved: number;
  runsCurrentlyNeedingAttention: number;
  runsNewlyNeedingAttentionSinceBaseline: number;
  runsRecoveredSinceBaseline: number;
  changedRunCountSinceBaseline: number;
  changedRunCountSincePrevious: number;
  // --- carried-over streak leaders ---
  longestValidStreak: number;
  runsWithLongestValidStreak: string[];
  longestAttentionStreak: number;
  runsWithLongestAttentionStreak: string[];
  // --- derived triage ---
  /** A single severity label: regression > attention > changed > clean. */
  status: BacktestResearchPortfolioCampaignStatus;
  /** True iff this campaign has an integrity concern (regression, current, or newly-needed attention). */
  flagged: boolean;
  /** Concise, deterministic reasons this campaign is flagged (empty when clean/benign-change-only). */
  reasons: string[];
}

/**
 * The full, deterministic, byte-stable research portfolio report. JSON-serializable as-is. Carries
 * the required PAPER-ONLY / local-reports-only / not-a-live-result / not-advice language and the
 * honest non-cryptographic-digest + integrity-triage-ordering labels so they survive serialization.
 */
export interface BacktestResearchPortfolioReport {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  portfolioName: string | null;
  // --- input summary ---
  /** Number of campaigns rolled up (the portfolio's campaign total). */
  campaignCount: number;
  /** Every campaign id, sorted ascending (a stable canonical list, independent of triage order). */
  campaignIds: string[];
  // --- portfolio aggregate flags ---
  hasChange: boolean;
  hasRegression: boolean;
  hasAttention: boolean;
  hasNewAttentionSinceBaseline: boolean;
  /** Campaign ids (sorted asc) for each aggregate flag. */
  campaignsWithChange: string[];
  campaignsWithRegression: string[];
  campaignsWithAttention: string[];
  campaignsWithNewAttentionSinceBaseline: string[];
  /** Campaign ids (sorted asc) with NO integrity concern: no regression, no current/new attention. */
  cleanCampaigns: string[];
  /** Campaign ids (sorted asc) with NO change at all since baseline (hasChange === false). */
  stableCampaigns: string[];
  // --- portfolio aggregate counts (sums across campaigns; run ids are campaign-scoped) ---
  /** Sum of each campaign's totalRunsObserved (NOT a cross-campaign unique count). */
  totalRunsObserved: number;
  /** Sum of each campaign's runsCurrentlyPresent. */
  totalRunsCurrentlyPresent: number;
  /** Sum of each campaign's runsCurrentlyNeedingAttention. */
  totalRunsCurrentlyNeedingAttention: number;
  /** Sum of each campaign's runsNewlyNeedingAttentionSinceBaseline. */
  totalRunsNewlyNeedingAttention: number;
  /** Sum of each campaign's runsRecoveredSinceBaseline. */
  totalRunsRecovered: number;
  /** Sum of each campaign's changedRunCountSinceBaseline. */
  totalChangedRunsSinceBaseline: number;
  /** Sum of each campaign's changedRunCountSincePrevious. */
  totalChangedRunsSincePrevious: number;
  // --- per-campaign rollup (integrity-triage order: most-concerning first, then campaignId asc) ---
  campaigns: BacktestResearchPortfolioCampaignSummary[];
  // --- portfolio streak leaders (across campaigns) ---
  longestValidStreak: number;
  /** Campaign ids (sorted asc) holding the portfolio-wide longest valid streak. */
  campaignsWithLongestValidStreak: string[];
  longestAttentionStreak: number;
  /** Campaign ids (sorted asc) holding the portfolio-wide longest attention streak. */
  campaignsWithLongestAttentionStreak: string[];
  // --- top integrity concerns (deterministic, severity-ordered, complete in JSON) ---
  topConcerns: string[];
  // --- CI decision section ---
  /** A CI gate on change would fail (mirrors hasChange). */
  wouldFailOnChange: boolean;
  /** A CI gate on conservative regression would fail (mirrors hasRegression). */
  wouldFailOnRegression: boolean;
  /** A CI gate on current attention would fail (mirrors hasAttention). */
  wouldFailOnAttention: boolean;
  /** A CI gate on newly-needed attention would fail (mirrors hasNewAttentionSinceBaseline). */
  wouldFailOnNewAttention: boolean;
  /** Human reasons for each would-fail condition that currently holds (deterministic order). */
  ciFailReasons: string[];
  // --- reproducibility-only / bookkeeping ---
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

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Order booleans so `true` sorts before `false` (used to put concerning campaigns first). */
function compareBoolDesc(a: boolean, b: boolean): number {
  return a === b ? 0 : a ? -1 : 1;
}

const PORTFOLIO_STATUSES = new Set<string>(["regression", "attention", "changed", "clean"]);

/** One validated campaign input plus its assigned id and source label. */
interface ReadCampaign {
  campaignId: string;
  sourceLabel: string | null;
  report: BacktestResearchCampaignHistoryReport;
}

/** Strictly read + validate one campaign input into a {@link ReadCampaign}. */
function readCampaign(
  campaign: unknown,
  position: number,
  seenIds: Set<string>,
): ReadCampaign {
  if (!isObject(campaign)) {
    throw new BacktestResearchPortfolioReportError(`campaigns[${position}] must be an object`);
  }
  if (!nonEmptyString(campaign.campaignId)) {
    throw new BacktestResearchPortfolioReportError(
      `campaigns[${position}].campaignId must be a non-empty string`,
    );
  }
  const campaignId = campaign.campaignId;
  if (seenIds.has(campaignId)) {
    throw new BacktestResearchPortfolioReportError(`duplicate campaignId "${campaignId}"`);
  }
  seenIds.add(campaignId);

  if (campaign.sourceLabel !== undefined && !nonEmptyString(campaign.sourceLabel)) {
    throw new BacktestResearchPortfolioReportError(
      `campaigns[${position}] (${campaignId}).sourceLabel must be a non-empty string when present`,
    );
  }
  const sourceLabel = nonEmptyString(campaign.sourceLabel) ? campaign.sourceLabel : null;

  let report: BacktestResearchCampaignHistoryReport;
  try {
    report = validateBacktestResearchCampaignHistoryReport(campaign.report);
  } catch (err) {
    throw new BacktestResearchPortfolioReportError(
      `campaigns[${position}] (${campaignId}) is not a valid campaign history report: ${(err as Error).message}`,
    );
  }
  return { campaignId, sourceLabel, report };
}

/** Derive the single severity label from a campaign's carried-over flags. */
function deriveStatus(
  report: BacktestResearchCampaignHistoryReport,
): BacktestResearchPortfolioCampaignStatus {
  if (report.hasRegression) return "regression";
  if (report.hasAttention || report.hasNewAttentionSinceBaseline) return "attention";
  if (report.hasChange) return "changed";
  return "clean";
}

/** Build the concise, deterministic reason list for why a campaign is flagged. */
function deriveReasons(report: BacktestResearchCampaignHistoryReport): string[] {
  const reasons: string[] = [];
  if (report.hasRegression) {
    reasons.push(
      report.runsWithConservativeRegression.length > 0
        ? `conservative regression since baseline (${report.runsWithConservativeRegression.length} run(s): ${report.runsWithConservativeRegression.join(", ")})`
        : `conservative regression since baseline (${report.regressionReasons.length} aggregate reason(s))`,
    );
  }
  if (report.hasNewAttentionSinceBaseline) {
    reasons.push(`${report.runsNewlyNeedingAttentionSinceBaseline} run(s) newly need attention since baseline`);
  }
  if (report.hasAttention) {
    reasons.push(`${report.runsCurrentlyNeedingAttention} run(s) currently need attention`);
  }
  return reasons;
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic, byte-stable {@link BacktestResearchPortfolioReport} from a set of
 * already-loaded campaign history reports. Pure and non-mutating. Each campaign report is strictly
 * validated as a Sprint 20 history report (a non-history / wrong-schema input throws); every per-
 * campaign signal is carried VERBATIM from that report. The per-campaign rollup is emitted in
 * integrity-triage order (regression → new attention → current attention → change → campaignId), so
 * the output is independent of the order the campaigns were supplied in. Throws
 * {@link BacktestResearchPortfolioReportError} on structurally invalid input, an empty campaign
 * list, a duplicate campaignId, or an invalid campaign history report.
 */
export function buildBacktestResearchPortfolioReport(
  input: BuildBacktestResearchPortfolioReportInput,
): BacktestResearchPortfolioReport {
  if (!isObject(input)) {
    throw new BacktestResearchPortfolioReportError("portfolio input must be an object");
  }
  if (input.portfolioName !== undefined && typeof input.portfolioName !== "string") {
    throw new BacktestResearchPortfolioReportError(
      "portfolio input.portfolioName must be a string when present",
    );
  }
  if (!Array.isArray(input.campaigns)) {
    throw new BacktestResearchPortfolioReportError("portfolio input.campaigns must be an array");
  }
  if (input.campaigns.length === 0) {
    throw new BacktestResearchPortfolioReportError(
      "portfolio input.campaigns must contain at least one campaign",
    );
  }

  const seenIds = new Set<string>();
  const read = input.campaigns.map((c, i) => readCampaign(c, i, seenIds));

  // Build per-campaign summaries in campaignId order first, so every derived aggregate list is
  // deterministic regardless of the order the campaigns were supplied in.
  const byId = [...read].sort((a, b) => compareString(a.campaignId, b.campaignId));
  const summaries: BacktestResearchPortfolioCampaignSummary[] = byId.map((c) => {
    const r = c.report;
    const flagged = r.hasRegression || r.hasAttention || r.hasNewAttentionSinceBaseline;
    return {
      campaignId: c.campaignId,
      sourceLabel: c.sourceLabel,
      campaignName: r.campaignName,
      snapshotCount: r.snapshotCount,
      latestSnapshotId: r.latestSnapshotId,
      baselineSnapshotId: r.baselineSnapshotId,
      hasChange: r.hasChange,
      hasRegression: r.hasRegression,
      hasAttention: r.hasAttention,
      hasNewAttentionSinceBaseline: r.hasNewAttentionSinceBaseline,
      runsCurrentlyPresent: r.runsCurrentlyPresent,
      totalRunsObserved: r.totalRunsObserved,
      runsCurrentlyNeedingAttention: r.runsCurrentlyNeedingAttention,
      runsNewlyNeedingAttentionSinceBaseline: r.runsNewlyNeedingAttentionSinceBaseline,
      runsRecoveredSinceBaseline: r.runsRecoveredSinceBaseline,
      changedRunCountSinceBaseline: r.changedRunCountSinceBaseline,
      changedRunCountSincePrevious: r.changedRunCountSincePrevious,
      longestValidStreak: r.longestValidStreak,
      runsWithLongestValidStreak: [...r.runsWithLongestValidStreak],
      longestAttentionStreak: r.longestAttentionStreak,
      runsWithLongestAttentionStreak: [...r.runsWithLongestAttentionStreak],
      status: deriveStatus(r),
      flagged,
      reasons: deriveReasons(r),
    };
  });

  // Aggregate flags + the campaignId lists behind each (already campaignId-sorted via `byId`).
  const idsWhere = (pred: (s: BacktestResearchPortfolioCampaignSummary) => boolean): string[] =>
    summaries.filter(pred).map((s) => s.campaignId);

  const campaignsWithChange = idsWhere((s) => s.hasChange);
  const campaignsWithRegression = idsWhere((s) => s.hasRegression);
  const campaignsWithAttention = idsWhere((s) => s.hasAttention);
  const campaignsWithNewAttentionSinceBaseline = idsWhere((s) => s.hasNewAttentionSinceBaseline);
  const cleanCampaigns = idsWhere(
    (s) => !s.hasRegression && !s.hasAttention && !s.hasNewAttentionSinceBaseline,
  );
  const stableCampaigns = idsWhere((s) => !s.hasChange);

  const hasChange = campaignsWithChange.length > 0;
  const hasRegression = campaignsWithRegression.length > 0;
  const hasAttention = campaignsWithAttention.length > 0;
  const hasNewAttentionSinceBaseline = campaignsWithNewAttentionSinceBaseline.length > 0;

  // Aggregate counts: honest sums across campaigns (run ids are campaign-scoped — never deduped).
  const sum = (pick: (s: BacktestResearchPortfolioCampaignSummary) => number): number =>
    summaries.reduce((acc, s) => acc + pick(s), 0);

  const totalRunsObserved = sum((s) => s.totalRunsObserved);
  const totalRunsCurrentlyPresent = sum((s) => s.runsCurrentlyPresent);
  const totalRunsCurrentlyNeedingAttention = sum((s) => s.runsCurrentlyNeedingAttention);
  const totalRunsNewlyNeedingAttention = sum((s) => s.runsNewlyNeedingAttentionSinceBaseline);
  const totalRunsRecovered = sum((s) => s.runsRecoveredSinceBaseline);
  const totalChangedRunsSinceBaseline = sum((s) => s.changedRunCountSinceBaseline);
  const totalChangedRunsSincePrevious = sum((s) => s.changedRunCountSincePrevious);

  // Portfolio-wide streak leaders (which campaigns hold the longest streaks).
  const longestValidStreak = summaries.reduce((m, s) => Math.max(m, s.longestValidStreak), 0);
  const campaignsWithLongestValidStreak =
    longestValidStreak > 0 ? idsWhere((s) => s.longestValidStreak === longestValidStreak) : [];
  const longestAttentionStreak = summaries.reduce((m, s) => Math.max(m, s.longestAttentionStreak), 0);
  const campaignsWithLongestAttentionStreak =
    longestAttentionStreak > 0
      ? idsWhere((s) => s.longestAttentionStreak === longestAttentionStreak)
      : [];

  // Integrity-triage ordering of the per-campaign rollup: most-concerning first, deterministic.
  const campaigns = [...summaries].sort(
    (a, b) =>
      compareBoolDesc(a.hasRegression, b.hasRegression) ||
      compareBoolDesc(a.hasNewAttentionSinceBaseline, b.hasNewAttentionSinceBaseline) ||
      compareBoolDesc(a.hasAttention, b.hasAttention) ||
      compareBoolDesc(a.hasChange, b.hasChange) ||
      compareString(a.campaignId, b.campaignId),
  );

  // Top integrity concerns: severity-ordered (regression, then new attention, then current
  // attention), each in campaignId order. Complete in the JSON; the formatter caps the display.
  const topConcerns: string[] = [];
  for (const s of summaries) {
    if (s.hasRegression) topConcerns.push(`${s.campaignId}: ${s.reasons[0] ?? "conservative regression since baseline"}`);
  }
  for (const s of summaries) {
    if (s.hasNewAttentionSinceBaseline) {
      topConcerns.push(`${s.campaignId}: ${s.runsNewlyNeedingAttentionSinceBaseline} run(s) newly need attention since baseline`);
    }
  }
  for (const s of summaries) {
    if (s.hasAttention) {
      topConcerns.push(`${s.campaignId}: ${s.runsCurrentlyNeedingAttention} run(s) currently need attention`);
    }
  }

  // CI decision section: the four gates simply mirror the aggregate flags; reasons explain each.
  const ciFailReasons: string[] = [];
  if (hasRegression) {
    ciFailReasons.push(`conservative regression in ${campaignsWithRegression.length} campaign(s): ${campaignsWithRegression.join(", ")}`);
  }
  if (hasNewAttentionSinceBaseline) {
    ciFailReasons.push(`newly-needed attention in ${campaignsWithNewAttentionSinceBaseline.length} campaign(s): ${campaignsWithNewAttentionSinceBaseline.join(", ")}`);
  }
  if (hasAttention) {
    ciFailReasons.push(`current attention in ${campaignsWithAttention.length} campaign(s): ${campaignsWithAttention.join(", ")}`);
  }
  if (hasChange) {
    ciFailReasons.push(`change since baseline in ${campaignsWithChange.length} campaign(s): ${campaignsWithChange.join(", ")}`);
  }

  const warnings: string[] = [];
  if (read.length < 2) {
    warnings.push(
      "only one campaign supplied — this is a single-campaign rollup; the portfolio aggregates equal that campaign.",
    );
  }
  if (hasRegression) {
    warnings.push(`conservative regression detected in ${campaignsWithRegression.length} campaign(s).`);
  }
  if (hasNewAttentionSinceBaseline) {
    warnings.push(`${campaignsWithNewAttentionSinceBaseline.length} campaign(s) newly need attention since baseline.`);
  }
  if (hasAttention) {
    warnings.push(`${campaignsWithAttention.length} campaign(s) currently need attention.`);
  }

  const campaignIds = summaries.map((s) => s.campaignId);
  const notes = [
    `${campaignIds.length} campaign(s): ${cleanCampaigns.length} clean, ${campaignsWithAttention.length} with current attention, ${campaignsWithRegression.length} with a conservative regression.`,
    `${totalRunsObserved} run(s) observed across all campaigns (summed; run ids are campaign-scoped and never de-duplicated), ${totalRunsCurrentlyPresent} currently present, ${totalRunsCurrentlyNeedingAttention} need attention.`,
    "Per-campaign change and conservative-regression signals are carried verbatim from each campaign history report (which reuse the Sprint 19 campaign-diff semantics); the conservative regression flag is integrity-only.",
    "Campaign ordering is integrity triage (most-concerning first), not a trading ranking; this report summarizes local campaign history reports only and is not a live result, advice, or a profitability claim.",
  ];

  return {
    schemaVersion: BACKTEST_RESEARCH_PORTFOLIO_REPORT_SCHEMA_VERSION,
    banner: BACKTEST_RESEARCH_PORTFOLIO_REPORT_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...BACKTEST_RESEARCH_PORTFOLIO_REPORT_DISCLAIMERS],
    portfolioName: input.portfolioName ?? null,
    campaignCount: read.length,
    campaignIds,
    hasChange,
    hasRegression,
    hasAttention,
    hasNewAttentionSinceBaseline,
    campaignsWithChange,
    campaignsWithRegression,
    campaignsWithAttention,
    campaignsWithNewAttentionSinceBaseline,
    cleanCampaigns,
    stableCampaigns,
    totalRunsObserved,
    totalRunsCurrentlyPresent,
    totalRunsCurrentlyNeedingAttention,
    totalRunsNewlyNeedingAttention,
    totalRunsRecovered,
    totalChangedRunsSinceBaseline,
    totalChangedRunsSincePrevious,
    campaigns,
    longestValidStreak,
    campaignsWithLongestValidStreak,
    longestAttentionStreak,
    campaignsWithLongestAttentionStreak,
    topConcerns,
    wouldFailOnChange: hasChange,
    wouldFailOnRegression: hasRegression,
    wouldFailOnAttention: hasAttention,
    wouldFailOnNewAttention: hasNewAttentionSinceBaseline,
    ciFailReasons,
    warnings,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

/** Strictly validate one portfolio campaign summary in-place. */
function validateCampaignSummary(value: unknown, where: string): void {
  if (!isObject(value)) {
    throw new BacktestResearchPortfolioReportError(`${where} must be an object`);
  }
  if (!nonEmptyString(value.campaignId)) {
    throw new BacktestResearchPortfolioReportError(`${where}.campaignId must be a non-empty string`);
  }
  if (value.sourceLabel !== null && !nonEmptyString(value.sourceLabel)) {
    throw new BacktestResearchPortfolioReportError(`${where}.sourceLabel must be a non-empty string or null`);
  }
  if (value.campaignName !== null && typeof value.campaignName !== "string") {
    throw new BacktestResearchPortfolioReportError(`${where}.campaignName must be a string or null`);
  }
  for (const f of ["latestSnapshotId", "baselineSnapshotId"] as const) {
    if (!nonEmptyString(value[f])) {
      throw new BacktestResearchPortfolioReportError(`${where}.${f} must be a non-empty string`);
    }
  }
  for (const f of [
    "hasChange",
    "hasRegression",
    "hasAttention",
    "hasNewAttentionSinceBaseline",
    "flagged",
  ] as const) {
    if (typeof value[f] !== "boolean") {
      throw new BacktestResearchPortfolioReportError(`${where}.${f} must be a boolean`);
    }
  }
  for (const f of [
    "snapshotCount",
    "runsCurrentlyPresent",
    "totalRunsObserved",
    "runsCurrentlyNeedingAttention",
    "runsNewlyNeedingAttentionSinceBaseline",
    "runsRecoveredSinceBaseline",
    "changedRunCountSinceBaseline",
    "changedRunCountSincePrevious",
    "longestValidStreak",
    "longestAttentionStreak",
  ] as const) {
    if (!isNonNegativeInteger(value[f])) {
      throw new BacktestResearchPortfolioReportError(`${where}.${f} must be a non-negative integer`);
    }
  }
  for (const f of [
    "runsWithLongestValidStreak",
    "runsWithLongestAttentionStreak",
    "reasons",
  ] as const) {
    if (!Array.isArray(value[f]) || (value[f] as unknown[]).some((x) => typeof x !== "string")) {
      throw new BacktestResearchPortfolioReportError(`${where}.${f} must be an array of strings`);
    }
  }
  if (!nonEmptyString(value.status) || !PORTFOLIO_STATUSES.has(value.status)) {
    throw new BacktestResearchPortfolioReportError(
      `${where}.status must be "regression", "attention", "changed", or "clean"`,
    );
  }
  // Internal consistency: the carried-over flags determine flagged + status.
  const flagged =
    (value.hasRegression as boolean) ||
    (value.hasAttention as boolean) ||
    (value.hasNewAttentionSinceBaseline as boolean);
  if (value.flagged !== flagged) {
    throw new BacktestResearchPortfolioReportError(
      `${where}.flagged must equal hasRegression || hasAttention || hasNewAttentionSinceBaseline`,
    );
  }
  const expectedStatus = (value.hasRegression as boolean)
    ? "regression"
    : (value.hasAttention as boolean) || (value.hasNewAttentionSinceBaseline as boolean)
      ? "attention"
      : (value.hasChange as boolean)
        ? "changed"
        : "clean";
  if (value.status !== expectedStatus) {
    throw new BacktestResearchPortfolioReportError(
      `${where}.status "${String(value.status)}" is inconsistent with the carried-over flags (expected "${expectedStatus}")`,
    );
  }
  // A present run is either valid or needs attention — never more attention than present.
  if ((value.runsCurrentlyNeedingAttention as number) > (value.runsCurrentlyPresent as number)) {
    throw new BacktestResearchPortfolioReportError(
      `${where}.runsCurrentlyNeedingAttention must not exceed runsCurrentlyPresent`,
    );
  }
  if ((value.runsCurrentlyPresent as number) > (value.totalRunsObserved as number)) {
    throw new BacktestResearchPortfolioReportError(
      `${where}.runsCurrentlyPresent must not exceed totalRunsObserved`,
    );
  }
}

/**
 * Strictly validate a value as a {@link BacktestResearchPortfolioReport} and return it narrowed. A
 * backstop mirroring the other validators: checks the schema version, the required PAPER-ONLY
 * labelling, the disclaimers, the input summary, the aggregate flags + counts (and their internal
 * consistency), the streak leaders, the CI section, and every per-campaign summary. Throws
 * {@link BacktestResearchPortfolioReportError} on the first problem. Pure.
 */
export function validateBacktestResearchPortfolioReport(
  value: unknown,
): BacktestResearchPortfolioReport {
  if (!isObject(value)) {
    throw new BacktestResearchPortfolioReportError("portfolio report must be a JSON object");
  }
  if (value.schemaVersion !== BACKTEST_RESEARCH_PORTFOLIO_REPORT_SCHEMA_VERSION) {
    throw new BacktestResearchPortfolioReportError(
      `portfolio report.schemaVersion must be "${BACKTEST_RESEARCH_PORTFOLIO_REPORT_SCHEMA_VERSION}"`,
    );
  }
  if (value.banner !== BACKTEST_RESEARCH_PORTFOLIO_REPORT_BANNER) {
    throw new BacktestResearchPortfolioReportError(
      `portfolio report.banner must be "${BACKTEST_RESEARCH_PORTFOLIO_REPORT_BANNER}"`,
    );
  }
  for (const flag of [
    "paperOnly",
    "simulated",
    "notLiveResult",
    "notFinancialAdvice",
    "notProfitabilityClaim",
  ] as const) {
    if (value[flag] !== true) {
      throw new BacktestResearchPortfolioReportError(`portfolio report.${flag} must be true`);
    }
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new BacktestResearchPortfolioReportError("portfolio report.disclaimers must be a non-empty array");
  }
  if (value.portfolioName !== null && typeof value.portfolioName !== "string") {
    throw new BacktestResearchPortfolioReportError("portfolio report.portfolioName must be a string or null");
  }
  for (const f of [
    "campaignCount",
    "totalRunsObserved",
    "totalRunsCurrentlyPresent",
    "totalRunsCurrentlyNeedingAttention",
    "totalRunsNewlyNeedingAttention",
    "totalRunsRecovered",
    "totalChangedRunsSinceBaseline",
    "totalChangedRunsSincePrevious",
    "longestValidStreak",
    "longestAttentionStreak",
  ] as const) {
    if (!isNonNegativeInteger(value[f])) {
      throw new BacktestResearchPortfolioReportError(`portfolio report.${f} must be a non-negative integer`);
    }
  }
  if ((value.campaignCount as number) < 1) {
    throw new BacktestResearchPortfolioReportError("portfolio report.campaignCount must be at least 1");
  }
  if ((value.totalRunsCurrentlyNeedingAttention as number) > (value.totalRunsCurrentlyPresent as number)) {
    throw new BacktestResearchPortfolioReportError(
      "portfolio report.totalRunsCurrentlyNeedingAttention must not exceed totalRunsCurrentlyPresent",
    );
  }
  if ((value.totalRunsCurrentlyPresent as number) > (value.totalRunsObserved as number)) {
    throw new BacktestResearchPortfolioReportError(
      "portfolio report.totalRunsCurrentlyPresent must not exceed totalRunsObserved",
    );
  }
  for (const flag of [
    "hasChange",
    "hasRegression",
    "hasAttention",
    "hasNewAttentionSinceBaseline",
    "wouldFailOnChange",
    "wouldFailOnRegression",
    "wouldFailOnAttention",
    "wouldFailOnNewAttention",
  ] as const) {
    if (typeof value[flag] !== "boolean") {
      throw new BacktestResearchPortfolioReportError(`portfolio report.${flag} must be a boolean`);
    }
  }
  // The CI gates mirror the aggregate flags exactly.
  const ciMirror: [string, string][] = [
    ["wouldFailOnChange", "hasChange"],
    ["wouldFailOnRegression", "hasRegression"],
    ["wouldFailOnAttention", "hasAttention"],
    ["wouldFailOnNewAttention", "hasNewAttentionSinceBaseline"],
  ];
  for (const [gate, flag] of ciMirror) {
    if (value[gate] !== value[flag]) {
      throw new BacktestResearchPortfolioReportError(`portfolio report.${gate} must mirror ${flag}`);
    }
  }
  for (const key of [
    "campaignIds",
    "campaignsWithChange",
    "campaignsWithRegression",
    "campaignsWithAttention",
    "campaignsWithNewAttentionSinceBaseline",
    "cleanCampaigns",
    "stableCampaigns",
    "campaignsWithLongestValidStreak",
    "campaignsWithLongestAttentionStreak",
    "topConcerns",
    "ciFailReasons",
    "warnings",
    "notes",
  ] as const) {
    if (!Array.isArray(value[key])) {
      throw new BacktestResearchPortfolioReportError(`portfolio report.${key} must be an array`);
    }
    (value[key] as unknown[]).forEach((s, i) => {
      if (typeof s !== "string") {
        throw new BacktestResearchPortfolioReportError(`portfolio report.${key}[${i}] must be a string`);
      }
    });
  }
  if ((value.campaignIds as unknown[]).length !== (value.campaignCount as number)) {
    throw new BacktestResearchPortfolioReportError("portfolio report.campaignIds length must equal campaignCount");
  }
  if (!Array.isArray(value.campaigns)) {
    throw new BacktestResearchPortfolioReportError("portfolio report.campaigns must be an array");
  }
  if ((value.campaigns as unknown[]).length !== (value.campaignCount as number)) {
    throw new BacktestResearchPortfolioReportError("portfolio report.campaigns length must equal campaignCount");
  }
  (value.campaigns as unknown[]).forEach((c, i) => validateCampaignSummary(c, `portfolio report.campaigns[${i}]`));
  return value as unknown as BacktestResearchPortfolioReport;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatBacktestResearchPortfolioReport}. */
export interface FormatBacktestResearchPortfolioReportOptions {
  /** Optional label echoed into the header. */
  label?: string;
  /** Cap on the number of per-campaign rows printed (default 100; the rest are summarized). */
  maxCampaignRows?: number;
  /** Cap on the number of top-concern lines printed (default 50; the rest are summarized). */
  maxConcernRows?: number;
}

/**
 * Render a redacted, stable, human-readable portfolio report. Deterministic and path-stable (no
 * timestamps). Leads with the PAPER-ONLY banner and the campaign count, summarizes the portfolio
 * aggregate flags + counts and streak leaders, lists each campaign's rollup line (integrity-triage
 * order, with status + flag tags), surfaces the top integrity concerns and the clean/stable
 * campaigns, and closes with the CI verdict and the not-live / not-advice disclaimers. Long lists
 * are summarized (never an unsafe raw dump); the whole output is passed through the shared redactor.
 */
export function formatBacktestResearchPortfolioReport(
  report: BacktestResearchPortfolioReport,
  opts: FormatBacktestResearchPortfolioReportOptions = {},
): string {
  const maxRows = opts.maxCampaignRows ?? 100;
  const maxConcerns = opts.maxConcernRows ?? 50;
  const title = report.portfolioName ?? "research portfolio";
  const header = `${report.banner} — ${title} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];

  if (opts.label) lines.push(`label:          ${opts.label}`);
  lines.push(`portfolio:      ${report.portfolioName ?? "(unnamed)"}`);
  lines.push(`campaigns:      ${report.campaignCount}`);

  lines.push("");
  lines.push("Portfolio aggregate:");
  lines.push(`- with change:          ${report.campaignsWithChange.length}`);
  lines.push(`- with regression:      ${report.campaignsWithRegression.length}`);
  lines.push(`- with attention now:   ${report.campaignsWithAttention.length}`);
  lines.push(`- with new attention:   ${report.campaignsWithNewAttentionSinceBaseline.length}`);
  lines.push(`- clean (no concern):   ${report.cleanCampaigns.length}`);
  lines.push(`- stable (no change):   ${report.stableCampaigns.length}`);

  lines.push("");
  lines.push("Run totals (summed across campaigns; run ids are campaign-scoped):");
  lines.push(`- observed:             ${report.totalRunsObserved}`);
  lines.push(`- currently present:    ${report.totalRunsCurrentlyPresent}`);
  lines.push(`- need attention now:   ${report.totalRunsCurrentlyNeedingAttention}`);
  lines.push(`- newly need attention: ${report.totalRunsNewlyNeedingAttention}`);
  lines.push(`- recovered:            ${report.totalRunsRecovered}`);
  lines.push(`- changed (baseline):   ${report.totalChangedRunsSinceBaseline}`);
  lines.push(`- changed (previous):   ${report.totalChangedRunsSincePrevious}`);

  lines.push("");
  lines.push("Streak leaders:");
  lines.push(
    `- longest valid streak:     ${report.longestValidStreak}` +
      (report.campaignsWithLongestValidStreak.length > 0
        ? ` (${report.campaignsWithLongestValidStreak.join(", ")})`
        : ""),
  );
  lines.push(
    `- longest attention streak: ${report.longestAttentionStreak}` +
      (report.campaignsWithLongestAttentionStreak.length > 0
        ? ` (${report.campaignsWithLongestAttentionStreak.join(", ")})`
        : ""),
  );

  lines.push("");
  lines.push("Campaigns (integrity triage — most-concerning first):");
  if (report.campaigns.length === 0) {
    lines.push("- (none)");
  } else {
    const shown = report.campaigns.slice(0, maxRows);
    for (const c of shown) {
      const tags: string[] = [];
      if (c.hasRegression) tags.push("regression");
      if (c.hasNewAttentionSinceBaseline) tags.push("new-attention");
      if (c.hasAttention) tags.push("attention");
      if (c.hasChange) tags.push("changed");
      lines.push(
        `- ${c.campaignId} [${c.status}; snapshots=${c.snapshotCount}; ` +
          `present=${c.runsCurrentlyPresent}; attention=${c.runsCurrentlyNeedingAttention}; ` +
          `validStreak=${c.longestValidStreak}; attnStreak=${c.longestAttentionStreak}]` +
          (tags.length > 0 ? `  (${tags.join(", ")})` : ""),
      );
      for (const reason of c.reasons) lines.push(`    · ${reason}`);
    }
    const hidden = report.campaigns.length - shown.length;
    if (hidden > 0) lines.push(`- … and ${hidden} more (summarized; see the report JSON for the full list)`);
  }

  lines.push("");
  lines.push("Top integrity concerns:");
  if (report.topConcerns.length === 0) {
    lines.push("- (none)");
  } else {
    const shown = report.topConcerns.slice(0, maxConcerns);
    for (const concern of shown) lines.push(`- ${concern}`);
    const hidden = report.topConcerns.length - shown.length;
    if (hidden > 0) lines.push(`- … and ${hidden} more (summarized; see the report JSON)`);
  }

  lines.push("");
  lines.push("Clean (no integrity concern):");
  if (report.cleanCampaigns.length === 0) lines.push("- (none)");
  else for (const id of report.cleanCampaigns) lines.push(`- ${id}`);

  lines.push("");
  lines.push("Stable (no change since baseline):");
  if (report.stableCampaigns.length === 0) lines.push("- (none)");
  else for (const id of report.stableCampaigns) lines.push(`- ${id}`);

  lines.push("");
  lines.push(`Change across portfolio:      ${report.hasChange ? "YES" : "no"}`);
  lines.push(`Regression across portfolio:  ${report.hasRegression ? "YES" : "no"}`);
  lines.push(`Attention now across portfolio:${report.hasAttention ? " YES" : " no"}`);
  lines.push(`New attention since baseline: ${report.hasNewAttentionSinceBaseline ? "YES" : "no"}`);
  if (report.ciFailReasons.length > 0) {
    lines.push("CI gate reasons:");
    for (const reason of report.ciFailReasons) lines.push(`- ${reason}`);
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
