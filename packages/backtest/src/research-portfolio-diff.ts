/**
 * Deterministic diff of two Sprint 21 RESEARCH PORTFOLIO REPORTS (Sprint 22, the portfolio analogue
 * of the campaign/manifest/bundle diffs). Answers "what changed between two PAPER-only portfolio
 * snapshots, and did the change break integrity?" without re-running any backtest or re-walking any
 * campaign directory — it compares two already-built portfolio reports.
 *
 * `diffBacktestResearchPortfolioReports(base, next)` STRICTLY validates each input as a Sprint 21
 * `backtest.research.portfolio.report.v1` via {@link validateBacktestResearchPortfolioReport} (so a
 * non-portfolio / wrong-schema input is REFUSED, never silently mis-read), then produces a
 * {@link BacktestResearchPortfolioDiff} across two clearly-separated axes:
 *
 *   1. **Campaign-set membership** — campaigns added (in next, not base), removed (in base, not
 *      next), and common (in both). Added/removed campaigns carry their own status + flags so no
 *      information is lost.
 *   2. **Status transitions over the COMMON set only** — a "transition" needs a before AND an after,
 *      so the newly-regressed / recovered / newly-needing-attention / newly-clean / newly-stable
 *      lists are computed strictly over campaigns present in BOTH reports. Appearances and
 *      disappearances are described entirely by axis 1; we never relabel an appearance as a
 *      "transition".
 *
 * Conservative, honest, NON-overclaiming flag semantics:
 *   - `hasCampaignSetChange` — any campaign added or removed.
 *   - `hasChange` — a campaign-set change OR a common campaign whose tracked fields differ.
 *   - `hasRegression` — at least one COMMON campaign transitioned INTO a conservative regression
 *     (no-regression in base → regression in next). A campaign that DISAPPEARS is treated as a
 *     change / scope change, NOT a regression (the user chooses which campaigns to track, so losing
 *     a campaign from the tracked set is not, by itself, integrity breakage). A campaign that is
 *     ADDED already carrying a regression is reported in `addedCampaigns` (with `hasRegression`) and
 *     in `changeReasons`, and is gated by `--fail-on-change` — but it does NOT set `hasRegression`,
 *     because there is no base state for it to have regressed FROM.
 *   - `hasAttention` / `hasNewAttention` — symmetric with regression: current / newly-needed
 *     attention that APPEARED on a common campaign (false → true). An added campaign that arrives
 *     needing attention is a campaign-set change, not an attention transition.
 *   - `hasRecovery` — a common campaign that recovered from a regression or no longer needs current
 *     attention. A removed campaign is NOT a "recovery".
 *
 * It is **pure**: no network, no RPC, no wallet, no filesystem, no `Date.now`, no `Math.random`, and
 * it never mutates its inputs (every value placed in the diff is a fresh copy with stable key order,
 * so the JSON is byte-stable for a given pair). This is a reproducibility/audit comparison over two
 * LOCAL portfolio summaries — never a live result, never advice, never a profitability claim.
 * Nothing here holds a key, or builds/signs/simulates/sends a transaction.
 */

import { redactString } from "@soulmaker/security";
import {
  validateBacktestResearchPortfolioReport,
  type BacktestResearchPortfolioReport,
  type BacktestResearchPortfolioCampaignStatus,
  type BacktestResearchPortfolioCampaignSummary,
} from "./research-portfolio.js";

/** Stable schema identifier for the portfolio-diff shape. Bump only on a breaking change. */
export const BACKTEST_RESEARCH_PORTFOLIO_DIFF_SCHEMA_VERSION =
  "backtest.research.portfolio.diff.v1";

/** The banner that prefixes every portfolio diff (required label). */
export const BACKTEST_RESEARCH_PORTFOLIO_DIFF_BANNER =
  "SIMULATED PAPER-ONLY RESEARCH PORTFOLIO DIFF";

/** Required disclaimer statements carried by every portfolio diff (stable order). */
export const BACKTEST_RESEARCH_PORTFOLIO_DIFF_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY RESEARCH PORTFOLIO DIFF — compares two LOCAL portfolio reports for integrity drift.",
  "Every value is a change between two local reproducibility summaries, not a live result, and nothing was fetched or traded.",
  "Status transitions (newly-regressed / recovered / newly-attention / newly-clean / newly-stable) are computed over campaigns present in BOTH reports; appeared/disappeared campaigns are reported separately as a campaign-set change.",
  "A disappearing campaign is treated as a change / scope change, NOT a regression; a campaign that arrives already carrying a regression sets hasChange (gated by --fail-on-change), not hasRegression.",
  "The conservative regression flag is an integrity/reproducibility signal only; it is NOT financial advice and NOT a profitability claim.",
  "Reproducibility digests behind these summaries are non-cryptographic content fingerprints, NOT a security or anti-tamper guarantee.",
  "Not a live result.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this diff.",
];

/** Thrown only when a portfolio-diff INPUT or a produced portfolio diff is structurally invalid. */
export class BacktestResearchPortfolioDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestResearchPortfolioDiffError";
  }
}

// --- diff data model ---------------------------------------------------------

/** A simple base→next numeric comparison. */
export interface ResearchPortfolioNumberDelta {
  base: number;
  next: number;
  delta: number;
}

/** A simple base→next boolean comparison. */
export interface ResearchPortfolioFlagTransition {
  base: boolean;
  next: boolean;
  changed: boolean;
}

/** A compact reference to a campaign that was added or removed (carries its status + flags). */
export interface ResearchPortfolioCampaignRef {
  campaignId: string;
  status: BacktestResearchPortfolioCampaignStatus;
  flagged: boolean;
  hasChange: boolean;
  hasRegression: boolean;
  hasAttention: boolean;
  hasNewAttentionSinceBaseline: boolean;
  snapshotCount: number;
  runsCurrentlyPresent: number;
  runsCurrentlyNeedingAttention: number;
}

/** A common campaign (present in BOTH reports) whose tracked fields changed. */
export interface ResearchPortfolioCampaignChange {
  campaignId: string;
  baseStatus: BacktestResearchPortfolioCampaignStatus;
  nextStatus: BacktestResearchPortfolioCampaignStatus;
  statusChanged: boolean;
  hasChange: ResearchPortfolioFlagTransition;
  hasRegression: ResearchPortfolioFlagTransition;
  hasAttention: ResearchPortfolioFlagTransition;
  hasNewAttentionSinceBaseline: ResearchPortfolioFlagTransition;
  /** True iff the campaign's clean status (no integrity concern) flipped. */
  cleanChanged: boolean;
  baseClean: boolean;
  nextClean: boolean;
  /** True iff the campaign's stable status (no change at all since baseline) flipped. */
  stableChanged: boolean;
  baseStable: boolean;
  nextStable: boolean;
  /** True iff the underlying baseline/latest snapshot id moved (the snapshot window shifted). */
  baselineSnapshotChanged: boolean;
  latestSnapshotChanged: boolean;
  snapshotCount: ResearchPortfolioNumberDelta;
  totalRunsObserved: ResearchPortfolioNumberDelta;
  runsCurrentlyPresent: ResearchPortfolioNumberDelta;
  runsCurrentlyNeedingAttention: ResearchPortfolioNumberDelta;
  runsNewlyNeedingAttentionSinceBaseline: ResearchPortfolioNumberDelta;
  runsRecoveredSinceBaseline: ResearchPortfolioNumberDelta;
  changedRunCountSinceBaseline: ResearchPortfolioNumberDelta;
  changedRunCountSincePrevious: ResearchPortfolioNumberDelta;
  longestValidStreak: ResearchPortfolioNumberDelta;
  longestAttentionStreak: ResearchPortfolioNumberDelta;
  /** Concise, deterministic reasons this campaign is reported as changed. */
  reasons: string[];
}

/** The full, deterministic, JSON-serializable diff of two portfolio reports. */
export interface BacktestResearchPortfolioDiff {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  // --- input summary ---
  baseLabel: string | null;
  nextLabel: string | null;
  basePortfolioName: string | null;
  nextPortfolioName: string | null;
  baseSchemaVersion: string;
  nextSchemaVersion: string;
  baseCampaignCount: number;
  nextCampaignCount: number;
  /** Every base campaign id, sorted ascending. */
  baseCampaignIds: string[];
  /** Every next campaign id, sorted ascending. */
  nextCampaignIds: string[];
  // --- campaign-set changes ---
  /** Campaigns present in next but not base, sorted by campaignId. */
  addedCampaigns: ResearchPortfolioCampaignRef[];
  /** Campaigns present in base but not next, sorted by campaignId. */
  removedCampaigns: ResearchPortfolioCampaignRef[];
  /** Campaign ids present in BOTH reports, sorted ascending. */
  commonCampaignIds: string[];
  // --- status transitions (common set only) ---
  /** Common campaigns whose tracked fields differ, sorted by campaignId. */
  changedCampaigns: ResearchPortfolioCampaignChange[];
  /** Common campaign ids with no regression in base and a regression in next, sorted. */
  newlyRegressedCampaigns: string[];
  /** Common campaign ids with a regression in base and none in next, sorted. */
  recoveredFromRegressionCampaigns: string[];
  /** Common campaign ids not needing current attention in base but needing it in next, sorted. */
  newlyNeedingAttentionCampaigns: string[];
  /** Common campaign ids needing current attention in base but not in next, sorted. */
  noLongerNeedingAttentionCampaigns: string[];
  /** Common campaign ids without new-since-baseline attention in base but with it in next, sorted. */
  newlyNeedingAttentionSinceBaselineCampaigns: string[];
  /** Common campaign ids with new-since-baseline attention in base but not in next, sorted. */
  noLongerNeedingAttentionSinceBaselineCampaigns: string[];
  /** Common campaign ids flagged in base but clean (no integrity concern) in next, sorted. */
  newlyCleanCampaigns: string[];
  /** Common campaign ids clean in base but flagged in next, sorted. */
  noLongerCleanCampaigns: string[];
  /** Common campaign ids changed in base but stable (no change at all) in next, sorted. */
  newlyStableCampaigns: string[];
  /** Common campaign ids stable in base but changed in next, sorted. */
  noLongerStableCampaigns: string[];
  // --- aggregate count deltas ---
  campaignCount: ResearchPortfolioNumberDelta;
  cleanCampaignCount: ResearchPortfolioNumberDelta;
  stableCampaignCount: ResearchPortfolioNumberDelta;
  campaignsWithChangeCount: ResearchPortfolioNumberDelta;
  campaignsWithRegressionCount: ResearchPortfolioNumberDelta;
  campaignsWithAttentionCount: ResearchPortfolioNumberDelta;
  campaignsWithNewAttentionCount: ResearchPortfolioNumberDelta;
  totalRunsObserved: ResearchPortfolioNumberDelta;
  totalRunsCurrentlyPresent: ResearchPortfolioNumberDelta;
  totalRunsCurrentlyNeedingAttention: ResearchPortfolioNumberDelta;
  totalRunsNewlyNeedingAttention: ResearchPortfolioNumberDelta;
  totalRunsRecovered: ResearchPortfolioNumberDelta;
  totalChangedRunsSinceBaseline: ResearchPortfolioNumberDelta;
  totalChangedRunsSincePrevious: ResearchPortfolioNumberDelta;
  // --- conservative flags ---
  hasChange: boolean;
  hasCampaignSetChange: boolean;
  hasRegression: boolean;
  hasAttention: boolean;
  hasNewAttention: boolean;
  hasRecovery: boolean;
  changeReasons: string[];
  regressionReasons: string[];
  // --- CI decision section ---
  wouldFailOnChange: boolean;
  wouldFailOnRegression: boolean;
  wouldFailOnAttention: boolean;
  wouldFailOnNewAttention: boolean;
  ciFailReasons: string[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function delta(base: number, next: number): ResearchPortfolioNumberDelta {
  return { base, next, delta: next - base };
}

function flag(base: boolean, next: boolean): ResearchPortfolioFlagTransition {
  return { base, next, changed: base !== next };
}

/** A campaign is "clean" iff it carries no integrity concern (mirrors the report's cleanCampaigns). */
function isClean(s: BacktestResearchPortfolioCampaignSummary): boolean {
  return !s.flagged;
}

/** A campaign is "stable" iff it has no change at all since baseline (mirrors stableCampaigns). */
function isStable(s: BacktestResearchPortfolioCampaignSummary): boolean {
  return !s.hasChange;
}

/** A compact ref for an added/removed campaign. */
function toRef(s: BacktestResearchPortfolioCampaignSummary): ResearchPortfolioCampaignRef {
  return {
    campaignId: s.campaignId,
    status: s.status,
    flagged: s.flagged,
    hasChange: s.hasChange,
    hasRegression: s.hasRegression,
    hasAttention: s.hasAttention,
    hasNewAttentionSinceBaseline: s.hasNewAttentionSinceBaseline,
    snapshotCount: s.snapshotCount,
    runsCurrentlyPresent: s.runsCurrentlyPresent,
    runsCurrentlyNeedingAttention: s.runsCurrentlyNeedingAttention,
  };
}

/** Read + validate one portfolio report input for diffing (strict; wrong schema is refused). */
function readPortfolio(value: unknown, side: string): BacktestResearchPortfolioReport {
  let report: BacktestResearchPortfolioReport;
  try {
    report = validateBacktestResearchPortfolioReport(value);
  } catch (err) {
    throw new BacktestResearchPortfolioDiffError(
      `${side} portfolio report is invalid: ${(err as Error).message}`,
    );
  }
  // The diff pairs campaigns by id; a corrupted report with duplicate ids would silently mis-pair,
  // so refuse it rather than risk a wrong comparison. A builder-produced report never has duplicates.
  const ids = report.campaigns.map((c) => c.campaignId);
  if (new Set(ids).size !== ids.length) {
    throw new BacktestResearchPortfolioDiffError(`${side} portfolio report has duplicate campaign ids`);
  }
  return report;
}

// --- public API --------------------------------------------------------------

/** Options for {@link diffBacktestResearchPortfolioReports}. */
export interface DiffBacktestResearchPortfolioReportsOptions {
  /** Optional source path / label for the BASE report, echoed into the diff. */
  baseLabel?: string;
  /** Optional source path / label for the NEXT report, echoed into the diff. */
  nextLabel?: string;
}

/**
 * Compute the deterministic diff of two portfolio reports. Both inputs are STRICTLY validated as a
 * Sprint 21 portfolio report (a non-portfolio / wrong-schema input throws
 * {@link BacktestResearchPortfolioDiffError}); neither is mutated. Campaigns are paired by
 * `campaignId` (added / removed / common). Status transitions are computed over the common set only;
 * the campaign-set axis (added/removed) is reported separately. Pure and byte-stable for a given pair.
 *
 * `hasRegression` is CONSERVATIVE and HONEST — true only when a COMMON campaign transitions INTO a
 * conservative regression (no-regression → regression). A disappearing campaign is a change / scope
 * change (not a regression); an added campaign that already carries a regression sets `hasChange`
 * (gated by `--fail-on-change`), not `hasRegression`, because it has no base state to regress from.
 */
export function diffBacktestResearchPortfolioReports(
  base: unknown,
  next: unknown,
  opts: DiffBacktestResearchPortfolioReportsOptions = {},
): BacktestResearchPortfolioDiff {
  const b = readPortfolio(base, "base");
  const n = readPortfolio(next, "next");

  const baseById = new Map(b.campaigns.map((c) => [c.campaignId, c]));
  const nextById = new Map(n.campaigns.map((c) => [c.campaignId, c]));

  // --- axis 1: campaign-set membership ---
  const addedCampaigns = n.campaigns
    .filter((c) => !baseById.has(c.campaignId))
    .map(toRef)
    .sort((x, y) => compareString(x.campaignId, y.campaignId));
  const removedCampaigns = b.campaigns
    .filter((c) => !nextById.has(c.campaignId))
    .map(toRef)
    .sort((x, y) => compareString(x.campaignId, y.campaignId));
  const commonCampaignIds = b.campaigns
    .filter((c) => nextById.has(c.campaignId))
    .map((c) => c.campaignId)
    .sort(compareString);

  // --- axis 2: status transitions + changed campaigns (common set only) ---
  const changedCampaigns: ResearchPortfolioCampaignChange[] = [];
  const newlyRegressedCampaigns: string[] = [];
  const recoveredFromRegressionCampaigns: string[] = [];
  const newlyNeedingAttentionCampaigns: string[] = [];
  const noLongerNeedingAttentionCampaigns: string[] = [];
  const newlyNeedingAttentionSinceBaselineCampaigns: string[] = [];
  const noLongerNeedingAttentionSinceBaselineCampaigns: string[] = [];
  const newlyCleanCampaigns: string[] = [];
  const noLongerCleanCampaigns: string[] = [];
  const newlyStableCampaigns: string[] = [];
  const noLongerStableCampaigns: string[] = [];

  for (const campaignId of commonCampaignIds) {
    const bs = baseById.get(campaignId)!;
    const ns = nextById.get(campaignId)!;

    if (!bs.hasRegression && ns.hasRegression) newlyRegressedCampaigns.push(campaignId);
    if (bs.hasRegression && !ns.hasRegression) recoveredFromRegressionCampaigns.push(campaignId);
    if (!bs.hasAttention && ns.hasAttention) newlyNeedingAttentionCampaigns.push(campaignId);
    if (bs.hasAttention && !ns.hasAttention) noLongerNeedingAttentionCampaigns.push(campaignId);
    if (!bs.hasNewAttentionSinceBaseline && ns.hasNewAttentionSinceBaseline) {
      newlyNeedingAttentionSinceBaselineCampaigns.push(campaignId);
    }
    if (bs.hasNewAttentionSinceBaseline && !ns.hasNewAttentionSinceBaseline) {
      noLongerNeedingAttentionSinceBaselineCampaigns.push(campaignId);
    }
    const baseClean = isClean(bs);
    const nextClean = isClean(ns);
    if (!baseClean && nextClean) newlyCleanCampaigns.push(campaignId);
    if (baseClean && !nextClean) noLongerCleanCampaigns.push(campaignId);
    const baseStable = isStable(bs);
    const nextStable = isStable(ns);
    if (!baseStable && nextStable) newlyStableCampaigns.push(campaignId);
    if (baseStable && !nextStable) noLongerStableCampaigns.push(campaignId);

    const change = buildCampaignChange(campaignId, bs, ns, baseClean, nextClean, baseStable, nextStable);
    if (change) changedCampaigns.push(change);
  }

  // --- aggregate count deltas (read straight off the validated reports) ---
  const campaignCount = delta(b.campaignCount, n.campaignCount);
  const cleanCampaignCount = delta(b.cleanCampaigns.length, n.cleanCampaigns.length);
  const stableCampaignCount = delta(b.stableCampaigns.length, n.stableCampaigns.length);
  const campaignsWithChangeCount = delta(b.campaignsWithChange.length, n.campaignsWithChange.length);
  const campaignsWithRegressionCount = delta(b.campaignsWithRegression.length, n.campaignsWithRegression.length);
  const campaignsWithAttentionCount = delta(b.campaignsWithAttention.length, n.campaignsWithAttention.length);
  const campaignsWithNewAttentionCount = delta(
    b.campaignsWithNewAttentionSinceBaseline.length,
    n.campaignsWithNewAttentionSinceBaseline.length,
  );
  const totalRunsObserved = delta(b.totalRunsObserved, n.totalRunsObserved);
  const totalRunsCurrentlyPresent = delta(b.totalRunsCurrentlyPresent, n.totalRunsCurrentlyPresent);
  const totalRunsCurrentlyNeedingAttention = delta(
    b.totalRunsCurrentlyNeedingAttention,
    n.totalRunsCurrentlyNeedingAttention,
  );
  const totalRunsNewlyNeedingAttention = delta(b.totalRunsNewlyNeedingAttention, n.totalRunsNewlyNeedingAttention);
  const totalRunsRecovered = delta(b.totalRunsRecovered, n.totalRunsRecovered);
  const totalChangedRunsSinceBaseline = delta(b.totalChangedRunsSinceBaseline, n.totalChangedRunsSinceBaseline);
  const totalChangedRunsSincePrevious = delta(b.totalChangedRunsSincePrevious, n.totalChangedRunsSincePrevious);

  // --- conservative flags ---
  const hasCampaignSetChange = addedCampaigns.length > 0 || removedCampaigns.length > 0;
  const hasChange = hasCampaignSetChange || changedCampaigns.length > 0;
  const hasRegression = newlyRegressedCampaigns.length > 0;
  const hasAttention = newlyNeedingAttentionCampaigns.length > 0;
  const hasNewAttention = newlyNeedingAttentionSinceBaselineCampaigns.length > 0;
  const hasRecovery =
    recoveredFromRegressionCampaigns.length > 0 || noLongerNeedingAttentionCampaigns.length > 0;

  // Added campaigns that ARRIVE already flagged — surfaced (non-silent) but NOT a transition.
  const addedRegressed = addedCampaigns.filter((c) => c.hasRegression).map((c) => c.campaignId);
  const addedAttention = addedCampaigns.filter((c) => c.hasAttention).map((c) => c.campaignId);

  // --- change reasons (any difference) ---
  const changeReasons: string[] = [];
  if (addedCampaigns.length > 0) {
    changeReasons.push(`${addedCampaigns.length} campaign(s) added (${addedCampaigns.map((c) => c.campaignId).join(", ")})`);
  }
  if (removedCampaigns.length > 0) {
    changeReasons.push(`${removedCampaigns.length} campaign(s) removed (${removedCampaigns.map((c) => c.campaignId).join(", ")})`);
  }
  if (changedCampaigns.length > 0) {
    changeReasons.push(`${changedCampaigns.length} common campaign(s) changed (${changedCampaigns.map((c) => c.campaignId).join(", ")})`);
  }
  if (newlyRegressedCampaigns.length > 0) {
    changeReasons.push(`${newlyRegressedCampaigns.length} campaign(s) newly regressed (${newlyRegressedCampaigns.join(", ")})`);
  }
  if (recoveredFromRegressionCampaigns.length > 0) {
    changeReasons.push(`${recoveredFromRegressionCampaigns.length} campaign(s) recovered from regression (${recoveredFromRegressionCampaigns.join(", ")})`);
  }
  if (newlyNeedingAttentionCampaigns.length > 0) {
    changeReasons.push(`${newlyNeedingAttentionCampaigns.length} campaign(s) newly need attention (${newlyNeedingAttentionCampaigns.join(", ")})`);
  }
  if (noLongerNeedingAttentionCampaigns.length > 0) {
    changeReasons.push(`${noLongerNeedingAttentionCampaigns.length} campaign(s) no longer need attention (${noLongerNeedingAttentionCampaigns.join(", ")})`);
  }
  if (newlyNeedingAttentionSinceBaselineCampaigns.length > 0) {
    changeReasons.push(`${newlyNeedingAttentionSinceBaselineCampaigns.length} campaign(s) newly need attention since baseline (${newlyNeedingAttentionSinceBaselineCampaigns.join(", ")})`);
  }
  if (addedRegressed.length > 0) {
    changeReasons.push(`${addedRegressed.length} added campaign(s) arrive carrying a conservative regression (gated by --fail-on-change, not --fail-on-regression): ${addedRegressed.join(", ")}`);
  }
  if (addedAttention.length > 0) {
    changeReasons.push(`${addedAttention.length} added campaign(s) arrive needing attention (gated by --fail-on-change): ${addedAttention.join(", ")}`);
  }
  if (campaignCount.delta !== 0) changeReasons.push(`campaign count ${campaignCount.base} → ${campaignCount.next}`);
  if (campaignsWithRegressionCount.delta !== 0) changeReasons.push(`campaigns with regression ${campaignsWithRegressionCount.base} → ${campaignsWithRegressionCount.next}`);
  if (campaignsWithAttentionCount.delta !== 0) changeReasons.push(`campaigns with current attention ${campaignsWithAttentionCount.base} → ${campaignsWithAttentionCount.next}`);
  if (campaignsWithNewAttentionCount.delta !== 0) changeReasons.push(`campaigns with new attention ${campaignsWithNewAttentionCount.base} → ${campaignsWithNewAttentionCount.next}`);
  if (totalRunsCurrentlyNeedingAttention.delta !== 0) changeReasons.push(`total runs needing attention ${totalRunsCurrentlyNeedingAttention.base} → ${totalRunsCurrentlyNeedingAttention.next}`);
  if (totalRunsObserved.delta !== 0) changeReasons.push(`total runs observed ${totalRunsObserved.base} → ${totalRunsObserved.next}`);

  // --- regression reasons (conservative: integrity transition only) ---
  const regressionReasons: string[] = [];
  if (newlyRegressedCampaigns.length > 0) {
    regressionReasons.push(`${newlyRegressedCampaigns.length} campaign(s) newly carry a conservative regression vs base: ${newlyRegressedCampaigns.join(", ")}`);
  }

  // --- CI decision (gates mirror the conservative flags; reasons explain each, severity order) ---
  const wouldFailOnChange = hasChange;
  const wouldFailOnRegression = hasRegression;
  const wouldFailOnAttention = hasAttention;
  const wouldFailOnNewAttention = hasNewAttention;
  const ciFailReasons: string[] = [];
  if (hasRegression) {
    ciFailReasons.push(`conservative regression newly appeared in ${newlyRegressedCampaigns.length} campaign(s): ${newlyRegressedCampaigns.join(", ")}`);
  }
  if (hasNewAttention) {
    ciFailReasons.push(`newly-needed attention appeared in ${newlyNeedingAttentionSinceBaselineCampaigns.length} campaign(s): ${newlyNeedingAttentionSinceBaselineCampaigns.join(", ")}`);
  }
  if (hasAttention) {
    ciFailReasons.push(`current attention newly appeared in ${newlyNeedingAttentionCampaigns.length} campaign(s): ${newlyNeedingAttentionCampaigns.join(", ")}`);
  }
  if (hasChange) {
    ciFailReasons.push(`change detected (${changeReasons.length} reason(s); see changeReasons)`);
  }

  return {
    schemaVersion: BACKTEST_RESEARCH_PORTFOLIO_DIFF_SCHEMA_VERSION,
    banner: BACKTEST_RESEARCH_PORTFOLIO_DIFF_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...BACKTEST_RESEARCH_PORTFOLIO_DIFF_DISCLAIMERS],
    baseLabel: nonEmptyString(opts.baseLabel) ? opts.baseLabel : null,
    nextLabel: nonEmptyString(opts.nextLabel) ? opts.nextLabel : null,
    basePortfolioName: b.portfolioName,
    nextPortfolioName: n.portfolioName,
    baseSchemaVersion: b.schemaVersion,
    nextSchemaVersion: n.schemaVersion,
    baseCampaignCount: b.campaignCount,
    nextCampaignCount: n.campaignCount,
    baseCampaignIds: [...b.campaignIds].sort(compareString),
    nextCampaignIds: [...n.campaignIds].sort(compareString),
    addedCampaigns,
    removedCampaigns,
    commonCampaignIds,
    changedCampaigns,
    newlyRegressedCampaigns,
    recoveredFromRegressionCampaigns,
    newlyNeedingAttentionCampaigns,
    noLongerNeedingAttentionCampaigns,
    newlyNeedingAttentionSinceBaselineCampaigns,
    noLongerNeedingAttentionSinceBaselineCampaigns,
    newlyCleanCampaigns,
    noLongerCleanCampaigns,
    newlyStableCampaigns,
    noLongerStableCampaigns,
    campaignCount,
    cleanCampaignCount,
    stableCampaignCount,
    campaignsWithChangeCount,
    campaignsWithRegressionCount,
    campaignsWithAttentionCount,
    campaignsWithNewAttentionCount,
    totalRunsObserved,
    totalRunsCurrentlyPresent,
    totalRunsCurrentlyNeedingAttention,
    totalRunsNewlyNeedingAttention,
    totalRunsRecovered,
    totalChangedRunsSinceBaseline,
    totalChangedRunsSincePrevious,
    hasChange,
    hasCampaignSetChange,
    hasRegression,
    hasAttention,
    hasNewAttention,
    hasRecovery,
    changeReasons,
    regressionReasons,
    wouldFailOnChange,
    wouldFailOnRegression,
    wouldFailOnAttention,
    wouldFailOnNewAttention,
    ciFailReasons,
  };
}

/** Build a {@link ResearchPortfolioCampaignChange} for one common campaign, or null if unchanged. */
function buildCampaignChange(
  campaignId: string,
  bs: BacktestResearchPortfolioCampaignSummary,
  ns: BacktestResearchPortfolioCampaignSummary,
  baseClean: boolean,
  nextClean: boolean,
  baseStable: boolean,
  nextStable: boolean,
): ResearchPortfolioCampaignChange | null {
  const statusChanged = bs.status !== ns.status;
  const hasChangeT = flag(bs.hasChange, ns.hasChange);
  const hasRegressionT = flag(bs.hasRegression, ns.hasRegression);
  const hasAttentionT = flag(bs.hasAttention, ns.hasAttention);
  const hasNewAttentionT = flag(bs.hasNewAttentionSinceBaseline, ns.hasNewAttentionSinceBaseline);
  const baselineSnapshotChanged = bs.baselineSnapshotId !== ns.baselineSnapshotId;
  const latestSnapshotChanged = bs.latestSnapshotId !== ns.latestSnapshotId;

  const snapshotCount = delta(bs.snapshotCount, ns.snapshotCount);
  const totalRunsObserved = delta(bs.totalRunsObserved, ns.totalRunsObserved);
  const runsCurrentlyPresent = delta(bs.runsCurrentlyPresent, ns.runsCurrentlyPresent);
  const runsCurrentlyNeedingAttention = delta(bs.runsCurrentlyNeedingAttention, ns.runsCurrentlyNeedingAttention);
  const runsNewlyNeedingAttentionSinceBaseline = delta(
    bs.runsNewlyNeedingAttentionSinceBaseline,
    ns.runsNewlyNeedingAttentionSinceBaseline,
  );
  const runsRecoveredSinceBaseline = delta(bs.runsRecoveredSinceBaseline, ns.runsRecoveredSinceBaseline);
  const changedRunCountSinceBaseline = delta(bs.changedRunCountSinceBaseline, ns.changedRunCountSinceBaseline);
  const changedRunCountSincePrevious = delta(bs.changedRunCountSincePrevious, ns.changedRunCountSincePrevious);
  const longestValidStreak = delta(bs.longestValidStreak, ns.longestValidStreak);
  const longestAttentionStreak = delta(bs.longestAttentionStreak, ns.longestAttentionStreak);

  const numericChanged =
    snapshotCount.delta !== 0 ||
    totalRunsObserved.delta !== 0 ||
    runsCurrentlyPresent.delta !== 0 ||
    runsCurrentlyNeedingAttention.delta !== 0 ||
    runsNewlyNeedingAttentionSinceBaseline.delta !== 0 ||
    runsRecoveredSinceBaseline.delta !== 0 ||
    changedRunCountSinceBaseline.delta !== 0 ||
    changedRunCountSincePrevious.delta !== 0 ||
    longestValidStreak.delta !== 0 ||
    longestAttentionStreak.delta !== 0;

  const changed =
    statusChanged ||
    hasChangeT.changed ||
    hasRegressionT.changed ||
    hasAttentionT.changed ||
    hasNewAttentionT.changed ||
    baselineSnapshotChanged ||
    latestSnapshotChanged ||
    numericChanged;
  if (!changed) return null;

  const reasons: string[] = [];
  if (statusChanged) reasons.push(`status ${bs.status} → ${ns.status}`);
  if (hasRegressionT.changed) reasons.push(`regression ${bs.hasRegression} → ${ns.hasRegression}`);
  if (hasAttentionT.changed) reasons.push(`current attention ${bs.hasAttention} → ${ns.hasAttention}`);
  if (hasNewAttentionT.changed) reasons.push(`new-attention-since-baseline ${bs.hasNewAttentionSinceBaseline} → ${ns.hasNewAttentionSinceBaseline}`);
  if (hasChangeT.changed) reasons.push(`has-change ${bs.hasChange} → ${ns.hasChange}`);
  if (runsCurrentlyNeedingAttention.delta !== 0) reasons.push(`runs needing attention ${runsCurrentlyNeedingAttention.base} → ${runsCurrentlyNeedingAttention.next}`);
  if (totalRunsObserved.delta !== 0) reasons.push(`total runs observed ${totalRunsObserved.base} → ${totalRunsObserved.next}`);
  if (runsCurrentlyPresent.delta !== 0) reasons.push(`runs present ${runsCurrentlyPresent.base} → ${runsCurrentlyPresent.next}`);
  if (snapshotCount.delta !== 0) reasons.push(`snapshots folded ${snapshotCount.base} → ${snapshotCount.next}`);
  if (baselineSnapshotChanged) reasons.push(`baseline snapshot moved (${bs.baselineSnapshotId} → ${ns.baselineSnapshotId})`);
  if (latestSnapshotChanged) reasons.push(`latest snapshot moved (${bs.latestSnapshotId} → ${ns.latestSnapshotId})`);

  return {
    campaignId,
    baseStatus: bs.status,
    nextStatus: ns.status,
    statusChanged,
    hasChange: hasChangeT,
    hasRegression: hasRegressionT,
    hasAttention: hasAttentionT,
    hasNewAttentionSinceBaseline: hasNewAttentionT,
    cleanChanged: baseClean !== nextClean,
    baseClean,
    nextClean,
    stableChanged: baseStable !== nextStable,
    baseStable,
    nextStable,
    baselineSnapshotChanged,
    latestSnapshotChanged,
    snapshotCount,
    totalRunsObserved,
    runsCurrentlyPresent,
    runsCurrentlyNeedingAttention,
    runsNewlyNeedingAttentionSinceBaseline,
    runsRecoveredSinceBaseline,
    changedRunCountSinceBaseline,
    changedRunCountSincePrevious,
    longestValidStreak,
    longestAttentionStreak,
    reasons,
  };
}

// --- validation (backstop) ---------------------------------------------------

function isNumberDelta(value: unknown): boolean {
  return isObject(value) && isFiniteNumber(value.base) && isFiniteNumber(value.next) && isFiniteNumber(value.delta);
}

function isFlagTransition(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.base === "boolean" &&
    typeof value.next === "boolean" &&
    typeof value.changed === "boolean"
  );
}

function validateStringArray(value: unknown, where: string): void {
  if (!Array.isArray(value)) throw new BacktestResearchPortfolioDiffError(`${where} must be an array`);
  value.forEach((s, i) => {
    if (!nonEmptyString(s)) throw new BacktestResearchPortfolioDiffError(`${where}[${i}] must be a non-empty string`);
  });
}

const DIFF_STATUSES = new Set<string>(["regression", "attention", "changed", "clean"]);

function validateCampaignRef(value: unknown, where: string): void {
  if (!isObject(value)) throw new BacktestResearchPortfolioDiffError(`${where} must be an object`);
  if (!nonEmptyString(value.campaignId)) throw new BacktestResearchPortfolioDiffError(`${where}.campaignId must be a non-empty string`);
  if (typeof value.status !== "string" || !DIFF_STATUSES.has(value.status)) {
    throw new BacktestResearchPortfolioDiffError(`${where}.status must be a portfolio campaign status`);
  }
  for (const f of ["flagged", "hasChange", "hasRegression", "hasAttention", "hasNewAttentionSinceBaseline"] as const) {
    if (typeof value[f] !== "boolean") throw new BacktestResearchPortfolioDiffError(`${where}.${f} must be a boolean`);
  }
  for (const f of ["snapshotCount", "runsCurrentlyPresent", "runsCurrentlyNeedingAttention"] as const) {
    if (!isFiniteNumber(value[f])) throw new BacktestResearchPortfolioDiffError(`${where}.${f} must be a number`);
  }
}

/**
 * Strictly validate a value as a {@link BacktestResearchPortfolioDiff} and return it narrowed. A
 * backstop mirroring the other diff validators: checks the schema version + banner, the PAPER-ONLY
 * labelling, the disclaimers, the input summary, the added/removed refs, the transition lists, every
 * number delta, the changed-campaign shapes, the conservative flags, and the CI mirror. Throws
 * {@link BacktestResearchPortfolioDiffError} on the first problem. Pure.
 */
export function validateBacktestResearchPortfolioDiff(value: unknown): BacktestResearchPortfolioDiff {
  if (!isObject(value)) throw new BacktestResearchPortfolioDiffError("portfolio diff must be a JSON object");
  if (value.schemaVersion !== BACKTEST_RESEARCH_PORTFOLIO_DIFF_SCHEMA_VERSION) {
    throw new BacktestResearchPortfolioDiffError(
      `portfolio diff.schemaVersion must be "${BACKTEST_RESEARCH_PORTFOLIO_DIFF_SCHEMA_VERSION}"`,
    );
  }
  if (value.banner !== BACKTEST_RESEARCH_PORTFOLIO_DIFF_BANNER) {
    throw new BacktestResearchPortfolioDiffError(
      `portfolio diff.banner must be "${BACKTEST_RESEARCH_PORTFOLIO_DIFF_BANNER}"`,
    );
  }
  for (const f of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[f] !== true) throw new BacktestResearchPortfolioDiffError(`portfolio diff.${f} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new BacktestResearchPortfolioDiffError("portfolio diff.disclaimers must be a non-empty array");
  }
  for (const f of ["baseLabel", "nextLabel", "basePortfolioName", "nextPortfolioName"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new BacktestResearchPortfolioDiffError(`portfolio diff.${f} must be a string or null`);
    }
  }
  for (const f of ["baseSchemaVersion", "nextSchemaVersion"] as const) {
    if (!nonEmptyString(value[f])) throw new BacktestResearchPortfolioDiffError(`portfolio diff.${f} must be a non-empty string`);
  }
  for (const f of ["baseCampaignCount", "nextCampaignCount"] as const) {
    if (!isFiniteNumber(value[f])) throw new BacktestResearchPortfolioDiffError(`portfolio diff.${f} must be a number`);
  }
  for (const f of [
    "hasChange",
    "hasCampaignSetChange",
    "hasRegression",
    "hasAttention",
    "hasNewAttention",
    "hasRecovery",
    "wouldFailOnChange",
    "wouldFailOnRegression",
    "wouldFailOnAttention",
    "wouldFailOnNewAttention",
  ] as const) {
    if (typeof value[f] !== "boolean") throw new BacktestResearchPortfolioDiffError(`portfolio diff.${f} must be a boolean`);
  }
  // The CI gates mirror the conservative flags exactly.
  const ciMirror: [string, string][] = [
    ["wouldFailOnChange", "hasChange"],
    ["wouldFailOnRegression", "hasRegression"],
    ["wouldFailOnAttention", "hasAttention"],
    ["wouldFailOnNewAttention", "hasNewAttention"],
  ];
  for (const [gate, src] of ciMirror) {
    if (value[gate] !== value[src]) throw new BacktestResearchPortfolioDiffError(`portfolio diff.${gate} must mirror ${src}`);
  }
  for (const f of [
    "baseCampaignIds",
    "nextCampaignIds",
    "commonCampaignIds",
    "newlyRegressedCampaigns",
    "recoveredFromRegressionCampaigns",
    "newlyNeedingAttentionCampaigns",
    "noLongerNeedingAttentionCampaigns",
    "newlyNeedingAttentionSinceBaselineCampaigns",
    "noLongerNeedingAttentionSinceBaselineCampaigns",
    "newlyCleanCampaigns",
    "noLongerCleanCampaigns",
    "newlyStableCampaigns",
    "noLongerStableCampaigns",
    "changeReasons",
    "regressionReasons",
    "ciFailReasons",
  ] as const) {
    validateStringArray(value[f], `portfolio diff.${f}`);
  }
  for (const key of ["addedCampaigns", "removedCampaigns"] as const) {
    if (!Array.isArray(value[key])) throw new BacktestResearchPortfolioDiffError(`portfolio diff.${key} must be an array`);
    (value[key] as unknown[]).forEach((r, i) => validateCampaignRef(r, `portfolio diff.${key}[${i}]`));
  }
  for (const f of [
    "campaignCount",
    "cleanCampaignCount",
    "stableCampaignCount",
    "campaignsWithChangeCount",
    "campaignsWithRegressionCount",
    "campaignsWithAttentionCount",
    "campaignsWithNewAttentionCount",
    "totalRunsObserved",
    "totalRunsCurrentlyPresent",
    "totalRunsCurrentlyNeedingAttention",
    "totalRunsNewlyNeedingAttention",
    "totalRunsRecovered",
    "totalChangedRunsSinceBaseline",
    "totalChangedRunsSincePrevious",
  ] as const) {
    if (!isNumberDelta(value[f])) throw new BacktestResearchPortfolioDiffError(`portfolio diff.${f} must be a {base,next,delta} number delta`);
  }
  if (!Array.isArray(value.changedCampaigns)) throw new BacktestResearchPortfolioDiffError("portfolio diff.changedCampaigns must be an array");
  (value.changedCampaigns as unknown[]).forEach((c, i) => {
    const where = `portfolio diff.changedCampaigns[${i}]`;
    if (!isObject(c) || !nonEmptyString(c.campaignId)) {
      throw new BacktestResearchPortfolioDiffError(`${where} must have a non-empty campaignId`);
    }
    for (const sf of ["baseStatus", "nextStatus"] as const) {
      if (typeof c[sf] !== "string" || !DIFF_STATUSES.has(c[sf] as string)) {
        throw new BacktestResearchPortfolioDiffError(`${where}.${sf} must be a portfolio campaign status`);
      }
    }
    for (const bf of ["statusChanged", "cleanChanged", "baseClean", "nextClean", "stableChanged", "baseStable", "nextStable", "baselineSnapshotChanged", "latestSnapshotChanged"] as const) {
      if (typeof c[bf] !== "boolean") throw new BacktestResearchPortfolioDiffError(`${where}.${bf} must be a boolean`);
    }
    for (const tf of ["hasChange", "hasRegression", "hasAttention", "hasNewAttentionSinceBaseline"] as const) {
      if (!isFlagTransition(c[tf])) throw new BacktestResearchPortfolioDiffError(`${where}.${tf} must be a {base,next,changed} transition`);
    }
    for (const nf of [
      "snapshotCount",
      "totalRunsObserved",
      "runsCurrentlyPresent",
      "runsCurrentlyNeedingAttention",
      "runsNewlyNeedingAttentionSinceBaseline",
      "runsRecoveredSinceBaseline",
      "changedRunCountSinceBaseline",
      "changedRunCountSincePrevious",
      "longestValidStreak",
      "longestAttentionStreak",
    ] as const) {
      if (!isNumberDelta(c[nf])) throw new BacktestResearchPortfolioDiffError(`${where}.${nf} must be a {base,next,delta} number delta`);
    }
    validateStringArray(c.reasons, `${where}.reasons`);
  });
  return value as unknown as BacktestResearchPortfolioDiff;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatBacktestResearchPortfolioDiff}. */
export interface FormatBacktestResearchPortfolioDiffOptions {
  baseLabel?: string;
  nextLabel?: string;
  /** Cap on the number of per-campaign rows printed per section (default 50; the rest are summarized). */
  maxRows?: number;
}

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n}`;
}

/**
 * Render a redacted, human-readable, PAPER-ONLY portfolio diff. Sectioned and stable for a given diff
 * object; long campaign lists are summarized (never an unsafe raw dump). Leads with the PAPER-ONLY
 * banner and the campaign-set change, walks the status transitions and aggregate count deltas, and
 * closes with the CHANGE / REGRESSION / ATTENTION verdicts + the not-live / not-advice framing. The
 * whole output is passed through the shared redactor.
 */
export function formatBacktestResearchPortfolioDiff(
  diff: BacktestResearchPortfolioDiff,
  opts: FormatBacktestResearchPortfolioDiffOptions = {},
): string {
  const baseLabel = opts.baseLabel ?? diff.baseLabel ?? diff.basePortfolioName ?? "base";
  const nextLabel = opts.nextLabel ?? diff.nextLabel ?? diff.nextPortfolioName ?? "next";
  const maxRows = opts.maxRows ?? 50;
  const lines: string[] = [];

  const header = `${diff.banner} (PAPER ONLY)`;
  lines.push(header);
  lines.push("=".repeat(header.length));

  lines.push("Portfolio pair:");
  lines.push(`- base (${baseLabel}): ${diff.basePortfolioName ?? "(unnamed)"}  (${diff.baseCampaignCount} campaign(s))`);
  lines.push(`- next (${nextLabel}): ${diff.nextPortfolioName ?? "(unnamed)"}  (${diff.nextCampaignCount} campaign(s))`);
  lines.push(`- common campaigns: ${diff.commonCampaignIds.length}`);
  lines.push("");

  const section = (title: string, rows: string[]): void => {
    lines.push(`${title} (${rows.length}):`);
    if (rows.length === 0) {
      lines.push("  - (none)");
      return;
    }
    for (const r of rows.slice(0, maxRows)) lines.push(`  - ${r}`);
    const hidden = rows.length - Math.min(rows.length, maxRows);
    if (hidden > 0) lines.push(`  - … and ${hidden} more (summarized; see the diff JSON for the full list)`);
  };

  section(
    "Added campaigns",
    diff.addedCampaigns.map((c) => `${c.campaignId} [${c.status}${c.flagged ? "; flagged" : ""}; present=${c.runsCurrentlyPresent}; attention=${c.runsCurrentlyNeedingAttention}]`),
  );
  section(
    "Removed campaigns",
    diff.removedCampaigns.map((c) => `${c.campaignId} [${c.status}${c.flagged ? "; flagged" : ""}; present=${c.runsCurrentlyPresent}; attention=${c.runsCurrentlyNeedingAttention}]`),
  );
  section(
    "Changed campaigns",
    diff.changedCampaigns.map((c) => `${c.campaignId} [${c.baseStatus} → ${c.nextStatus}]${c.reasons.length > 0 ? `  (${c.reasons.join("; ")})` : ""}`),
  );
  lines.push("");

  lines.push("Status transitions (common campaigns):");
  const transition = (label: string, ids: string[]): void => {
    if (ids.length > 0) lines.push(`- ${label}: ${ids.join(", ")}`);
  };
  transition("newly regressed", diff.newlyRegressedCampaigns);
  transition("recovered from regression", diff.recoveredFromRegressionCampaigns);
  transition("newly need attention", diff.newlyNeedingAttentionCampaigns);
  transition("no longer need attention", diff.noLongerNeedingAttentionCampaigns);
  transition("newly need attention since baseline", diff.newlyNeedingAttentionSinceBaselineCampaigns);
  transition("no longer new-attention since baseline", diff.noLongerNeedingAttentionSinceBaselineCampaigns);
  transition("newly clean", diff.newlyCleanCampaigns);
  transition("no longer clean", diff.noLongerCleanCampaigns);
  transition("newly stable", diff.newlyStableCampaigns);
  transition("no longer stable", diff.noLongerStableCampaigns);
  if (
    diff.newlyRegressedCampaigns.length === 0 &&
    diff.recoveredFromRegressionCampaigns.length === 0 &&
    diff.newlyNeedingAttentionCampaigns.length === 0 &&
    diff.noLongerNeedingAttentionCampaigns.length === 0 &&
    diff.newlyNeedingAttentionSinceBaselineCampaigns.length === 0 &&
    diff.noLongerNeedingAttentionSinceBaselineCampaigns.length === 0 &&
    diff.newlyCleanCampaigns.length === 0 &&
    diff.noLongerCleanCampaigns.length === 0 &&
    diff.newlyStableCampaigns.length === 0 &&
    diff.noLongerStableCampaigns.length === 0
  ) {
    lines.push("- (none)");
  }
  lines.push("");

  lines.push("Aggregate counts (base → next, Δ):");
  const countLine = (label: string, d: ResearchPortfolioNumberDelta): void => {
    lines.push(`- ${label}: ${d.base} → ${d.next} (Δ ${signed(d.delta)})`);
  };
  countLine("campaigns", diff.campaignCount);
  countLine("clean campaigns", diff.cleanCampaignCount);
  countLine("stable campaigns", diff.stableCampaignCount);
  countLine("campaigns w/ change", diff.campaignsWithChangeCount);
  countLine("campaigns w/ regression", diff.campaignsWithRegressionCount);
  countLine("campaigns w/ attention", diff.campaignsWithAttentionCount);
  countLine("campaigns w/ new attention", diff.campaignsWithNewAttentionCount);
  countLine("runs observed", diff.totalRunsObserved);
  countLine("runs needing attention", diff.totalRunsCurrentlyNeedingAttention);
  countLine("runs recovered", diff.totalRunsRecovered);
  lines.push("");

  lines.push(`Changed: ${diff.hasChange ? "YES" : "no"}`);
  if (diff.hasChange) for (const r of diff.changeReasons) lines.push(`- ${r}`);
  lines.push(`Campaign-set change: ${diff.hasCampaignSetChange ? "YES" : "no"}`);
  lines.push(`Regression: ${diff.hasRegression ? "YES" : "no"}`);
  if (diff.hasRegression) for (const r of diff.regressionReasons) lines.push(`- ${r}`);
  lines.push(`Attention newly appeared: ${diff.hasAttention ? "YES" : "no"}`);
  lines.push(`New-attention newly appeared: ${diff.hasNewAttention ? "YES" : "no"}`);
  lines.push(`Recovery: ${diff.hasRecovery ? "YES" : "no"}`);
  if (diff.ciFailReasons.length > 0) {
    lines.push("CI gate reasons:");
    for (const r of diff.ciFailReasons) lines.push(`- ${r}`);
  }
  lines.push("");

  lines.push("Notes:");
  for (const d of diff.disclaimers) lines.push(`- ${d}`);

  return redactString(lines.join("\n"));
}
