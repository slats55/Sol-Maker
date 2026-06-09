/**
 * Tests for the Sprint 22 RESEARCH PORTFOLIO DIFF. Everything here is INJECTED test data — fake
 * campaign ids, fake run ids, made-up digests — exercised purely offline. Each portfolio report is
 * built through the real production chain (Sprint 18 campaign index → Sprint 20 history report →
 * Sprint 21 portfolio report) and then diffed. Nothing here is real market data, a live result, or a
 * profitability claim.
 */

import { describe, it, expect } from "vitest";
import { REDACTED } from "@soulmaker/security";
import {
  diffBacktestResearchPortfolioReports,
  validateBacktestResearchPortfolioDiff,
  formatBacktestResearchPortfolioDiff,
  BacktestResearchPortfolioDiffError,
  BACKTEST_RESEARCH_PORTFOLIO_DIFF_SCHEMA_VERSION,
  BACKTEST_RESEARCH_PORTFOLIO_DIFF_BANNER,
  type BacktestResearchPortfolioDiff,
} from "./research-portfolio-diff.js";
import {
  buildBacktestResearchPortfolioReport,
  type BacktestResearchPortfolioCampaignInput,
} from "./research-portfolio.js";
import {
  buildBacktestResearchCampaignHistoryReport,
} from "./research-campaign-history.js";
import {
  buildBacktestResearchCampaignIndex,
  type BacktestResearchCampaignRunInput,
} from "./research-campaign-index.js";
import type { BacktestArtifactDescriptor } from "./research-manifest.js";

// --- fixtures (all injected, offline) ----------------------------------------

function desc(over: Partial<BacktestArtifactDescriptor> = {}): BacktestArtifactDescriptor {
  return { path: "a.report.json", kind: "backtest-report", schemaVersion: "backtest.report.v1", digest: "d1", sizeBytes: 100, ...over };
}
const okRun = (runId: string, digest = "d1"): BacktestResearchCampaignRunInput => ({ runId, artifacts: [desc({ digest })] });
const badRun = (runId: string): BacktestResearchCampaignRunInput => ({ runId, artifacts: [desc({ path: "u.json", kind: "unknown-json", schemaVersion: null, digest: "u" })] });
const idx = (runs: BacktestResearchCampaignRunInput[]) => buildBacktestResearchCampaignIndex({ campaignName: "c", runs });
const hist = (snaps: BacktestResearchCampaignRunInput[][]) =>
  buildBacktestResearchCampaignHistoryReport({ snapshots: snaps.map((runs, i) => ({ snapshotId: `s${i}`, index: idx(runs) })) });
const pc = (campaignId: string, report: unknown): BacktestResearchPortfolioCampaignInput => ({ campaignId, report });
const portfolio = (campaigns: BacktestResearchPortfolioCampaignInput[], portfolioName?: string) =>
  buildBacktestResearchPortfolioReport(portfolioName === undefined ? { campaigns } : { portfolioName, campaigns });

// History-report archetypes (each a real Sprint 20 report).
const cleanHist = () => hist([[okRun("a")], [okRun("a")]]); // clean + stable (no change)
const changedHist = () => hist([[okRun("a")], [okRun("a"), okRun("b")]]); // additive valid -> changed, clean
const regressedHist = () => hist([[okRun("a", "1")], [okRun("a", "2")]]); // digest change -> regression, still valid
const newAttentionHist = () => hist([[okRun("a")], [okRun("a"), badRun("b")]]); // new invalid run -> attention + new-attention
const recoveredHist = () => hist([[badRun("a")], [okRun("a")]]); // invalid -> valid (recovered, changed)

describe("diffBacktestResearchPortfolioReports — campaign set + basics", () => {
  it("reports no change for two identical portfolios", () => {
    const base = portfolio([pc("alpha", cleanHist()), pc("bravo", cleanHist())]);
    const next = portfolio([pc("alpha", cleanHist()), pc("bravo", cleanHist())]);
    const d = diffBacktestResearchPortfolioReports(base, next);
    expect(d.schemaVersion).toBe(BACKTEST_RESEARCH_PORTFOLIO_DIFF_SCHEMA_VERSION);
    expect(d.banner).toBe(BACKTEST_RESEARCH_PORTFOLIO_DIFF_BANNER);
    expect(d.paperOnly).toBe(true);
    expect(d.hasChange).toBe(false);
    expect(d.hasCampaignSetChange).toBe(false);
    expect(d.hasRegression).toBe(false);
    expect(d.hasAttention).toBe(false);
    expect(d.hasNewAttention).toBe(false);
    expect(d.hasRecovery).toBe(false);
    expect(d.addedCampaigns).toEqual([]);
    expect(d.removedCampaigns).toEqual([]);
    expect(d.changedCampaigns).toEqual([]);
    expect(d.commonCampaignIds).toEqual(["alpha", "bravo"]);
    expect(d.changeReasons).toEqual([]);
    expect(d.wouldFailOnChange).toBe(false);
  });

  it("carries the PAPER-ONLY labelling and the disclaimers", () => {
    const d = diffBacktestResearchPortfolioReports(portfolio([pc("a", cleanHist())]), portfolio([pc("a", cleanHist())]));
    expect(d.simulated).toBe(true);
    expect(d.notLiveResult).toBe(true);
    expect(d.notFinancialAdvice).toBe(true);
    expect(d.notProfitabilityClaim).toBe(true);
    expect(d.disclaimers.length).toBeGreaterThan(0);
    expect(d.disclaimers.some((x) => /PAPER-ONLY/.test(x))).toBe(true);
  });

  it("echoes optional base/next labels and portfolio names", () => {
    const base = portfolio([pc("a", cleanHist())], "base-suite");
    const next = portfolio([pc("a", cleanHist())], "next-suite");
    const d = diffBacktestResearchPortfolioReports(base, next, { baseLabel: "./base.json", nextLabel: "./next.json" });
    expect(d.baseLabel).toBe("./base.json");
    expect(d.nextLabel).toBe("./next.json");
    expect(d.basePortfolioName).toBe("base-suite");
    expect(d.nextPortfolioName).toBe("next-suite");
    expect(d.baseLabel === null || typeof d.baseLabel === "string").toBe(true);
  });

  it("detects an added campaign (clean) as a change but not a regression", () => {
    const base = portfolio([pc("alpha", cleanHist())]);
    const next = portfolio([pc("alpha", cleanHist()), pc("charlie", cleanHist())]);
    const d = diffBacktestResearchPortfolioReports(base, next);
    expect(d.addedCampaigns.map((c) => c.campaignId)).toEqual(["charlie"]);
    expect(d.removedCampaigns).toEqual([]);
    expect(d.commonCampaignIds).toEqual(["alpha"]);
    expect(d.hasCampaignSetChange).toBe(true);
    expect(d.hasChange).toBe(true);
    expect(d.hasRegression).toBe(false);
    expect(d.campaignCount).toEqual({ base: 1, next: 2, delta: 1 });
  });

  it("detects a removed campaign as a change / scope change, not a regression", () => {
    const base = portfolio([pc("alpha", cleanHist()), pc("bravo", cleanHist())]);
    const next = portfolio([pc("alpha", cleanHist())]);
    const d = diffBacktestResearchPortfolioReports(base, next);
    expect(d.removedCampaigns.map((c) => c.campaignId)).toEqual(["bravo"]);
    expect(d.addedCampaigns).toEqual([]);
    expect(d.hasCampaignSetChange).toBe(true);
    expect(d.hasChange).toBe(true);
    expect(d.hasRegression).toBe(false); // a disappearing campaign is NOT a regression
    expect(d.campaignCount).toEqual({ base: 2, next: 1, delta: -1 });
  });

  it("does NOT set hasRegression when an ADDED campaign arrives already carrying a regression", () => {
    const base = portfolio([pc("alpha", cleanHist())]);
    const next = portfolio([pc("alpha", cleanHist()), pc("zulu", regressedHist())]);
    const d = diffBacktestResearchPortfolioReports(base, next);
    expect(d.addedCampaigns.map((c) => c.campaignId)).toEqual(["zulu"]);
    expect(d.addedCampaigns[0]!.hasRegression).toBe(true); // the ref preserves the campaign's own flag
    expect(d.newlyRegressedCampaigns).toEqual([]); // but it is NOT a transition
    expect(d.hasRegression).toBe(false);
    expect(d.hasChange).toBe(true);
    // ...and the arrival is surfaced (non-silent) in the change reasons
    expect(d.changeReasons.some((r) => /added campaign\(s\) arrive carrying a conservative regression/.test(r))).toBe(true);
  });
});

describe("diffBacktestResearchPortfolioReports — common-set transitions", () => {
  it("flags a common campaign that newly regressed", () => {
    const d = diffBacktestResearchPortfolioReports(portfolio([pc("alpha", cleanHist())]), portfolio([pc("alpha", regressedHist())]));
    expect(d.newlyRegressedCampaigns).toEqual(["alpha"]);
    expect(d.hasRegression).toBe(true);
    expect(d.hasChange).toBe(true);
    expect(d.changedCampaigns.map((c) => c.campaignId)).toEqual(["alpha"]);
    expect(d.changedCampaigns[0]!.hasRegression).toEqual({ base: false, next: true, changed: true });
    expect(d.noLongerCleanCampaigns).toEqual(["alpha"]); // clean -> flagged
    expect(d.regressionReasons.length).toBeGreaterThan(0);
    expect(d.wouldFailOnRegression).toBe(true);
  });

  it("flags a common campaign that recovered from regression", () => {
    const d = diffBacktestResearchPortfolioReports(portfolio([pc("alpha", regressedHist())]), portfolio([pc("alpha", cleanHist())]));
    expect(d.recoveredFromRegressionCampaigns).toEqual(["alpha"]);
    expect(d.newlyCleanCampaigns).toEqual(["alpha"]); // flagged -> clean
    expect(d.hasRecovery).toBe(true);
    expect(d.hasRegression).toBe(false);
  });

  it("flags a common campaign newly needing attention (current and since-baseline)", () => {
    const d = diffBacktestResearchPortfolioReports(portfolio([pc("alpha", cleanHist())]), portfolio([pc("alpha", newAttentionHist())]));
    expect(d.newlyNeedingAttentionCampaigns).toEqual(["alpha"]);
    expect(d.newlyNeedingAttentionSinceBaselineCampaigns).toEqual(["alpha"]);
    expect(d.hasAttention).toBe(true);
    expect(d.hasNewAttention).toBe(true);
    expect(d.wouldFailOnAttention).toBe(true);
    expect(d.wouldFailOnNewAttention).toBe(true);
  });

  it("flags a common campaign that no longer needs attention", () => {
    const d = diffBacktestResearchPortfolioReports(portfolio([pc("alpha", newAttentionHist())]), portfolio([pc("alpha", cleanHist())]));
    expect(d.noLongerNeedingAttentionCampaigns).toEqual(["alpha"]);
    expect(d.noLongerNeedingAttentionSinceBaselineCampaigns).toEqual(["alpha"]);
    expect(d.hasRecovery).toBe(true);
    expect(d.hasAttention).toBe(false);
  });

  it("tracks newly-stable and no-longer-stable transitions", () => {
    // changed -> stable
    const toStable = diffBacktestResearchPortfolioReports(portfolio([pc("alpha", changedHist())]), portfolio([pc("alpha", cleanHist())]));
    expect(toStable.newlyStableCampaigns).toEqual(["alpha"]);
    expect(toStable.noLongerStableCampaigns).toEqual([]);
    // stable -> changed
    const fromStable = diffBacktestResearchPortfolioReports(portfolio([pc("alpha", cleanHist())]), portfolio([pc("alpha", changedHist())]));
    expect(fromStable.noLongerStableCampaigns).toEqual(["alpha"]);
    expect(fromStable.newlyStableCampaigns).toEqual([]);
  });

  it("records a per-campaign change with base→next status and reasons", () => {
    const d = diffBacktestResearchPortfolioReports(portfolio([pc("alpha", cleanHist())]), portfolio([pc("alpha", changedHist())]));
    const change = d.changedCampaigns.find((c) => c.campaignId === "alpha")!;
    expect(change.baseStatus).toBe("clean");
    expect(change.nextStatus).toBe("changed"); // additive valid run -> changed, still clean
    expect(change.statusChanged).toBe(true);
    expect(change.hasChange).toEqual({ base: false, next: true, changed: true });
    expect(change.reasons.length).toBeGreaterThan(0);
  });

  it("treats an invalid→valid run whose digest changed as a conservative regression (honest, not overclaimed-as-clean)", () => {
    // recoveredHist: run 'a' goes invalid→valid, but its run digest also changes — the established
    // campaign-diff semantics flag a same-run digest change as a conservative regression, so the
    // campaign's status is "regression", not "clean". The diff carries that verbatim.
    const d = diffBacktestResearchPortfolioReports(portfolio([pc("alpha", cleanHist())]), portfolio([pc("alpha", recoveredHist())]));
    expect(d.newlyRegressedCampaigns).toEqual(["alpha"]);
    expect(d.hasRegression).toBe(true);
    expect(d.changedCampaigns.find((c) => c.campaignId === "alpha")!.nextStatus).toBe("regression");
  });
});

describe("diffBacktestResearchPortfolioReports — aggregate deltas + determinism", () => {
  it("computes aggregate count deltas off the validated reports", () => {
    const base = portfolio([pc("alpha", cleanHist())]);
    // alpha → regression (digest change); bravo → adds an invalid (unknown-json) run, which both needs
    // attention AND increases the unknown-artifact count, so its history report is regression+attention.
    const next = portfolio([pc("alpha", regressedHist()), pc("bravo", newAttentionHist())]);
    const d = diffBacktestResearchPortfolioReports(base, next);
    expect(d.campaignCount).toEqual({ base: 1, next: 2, delta: 1 });
    expect(d.campaignsWithRegressionCount).toEqual({ base: 0, next: 2, delta: 2 }); // alpha + bravo
    expect(d.campaignsWithAttentionCount).toEqual({ base: 0, next: 1, delta: 1 }); // bravo
    expect(d.cleanCampaignCount).toEqual({ base: 1, next: 0, delta: -1 }); // alpha was clean; both now flagged
    // every aggregate field is a {base,next,delta} with delta === next - base
    for (const k of [
      "stableCampaignCount",
      "campaignsWithChangeCount",
      "campaignsWithNewAttentionCount",
      "totalRunsObserved",
      "totalRunsCurrentlyNeedingAttention",
      "totalRunsRecovered",
      "totalChangedRunsSinceBaseline",
      "totalChangedRunsSincePrevious",
    ] as const) {
      expect(d[k].delta).toBe(d[k].next - d[k].base);
    }
  });

  it("is byte-stable and emits no wall-clock timestamp", () => {
    const base = portfolio([pc("alpha", cleanHist()), pc("bravo", regressedHist())]);
    const next = portfolio([pc("alpha", regressedHist()), pc("charlie", newAttentionHist())]);
    const a = JSON.stringify(diffBacktestResearchPortfolioReports(base, next));
    const b = JSON.stringify(diffBacktestResearchPortfolioReports(base, next));
    expect(a).toBe(b);
    expect(a).not.toMatch(/"generatedAt"|"createdAt"|"timestamp"|"ranAt"/);
  });

  it("sorts every campaign list deterministically by campaignId", () => {
    const base = portfolio([pc("alpha", cleanHist())]);
    const next = portfolio([pc("alpha", cleanHist()), pc("zulu", cleanHist()), pc("bravo", cleanHist()), pc("mike", cleanHist())]);
    const d = diffBacktestResearchPortfolioReports(base, next);
    expect(d.addedCampaigns.map((c) => c.campaignId)).toEqual(["bravo", "mike", "zulu"]);
    expect(d.nextCampaignIds).toEqual(["alpha", "bravo", "mike", "zulu"]);
  });
});

describe("validateBacktestResearchPortfolioDiff", () => {
  const sample = () => diffBacktestResearchPortfolioReports(portfolio([pc("alpha", cleanHist())]), portfolio([pc("alpha", regressedHist()), pc("bravo", newAttentionHist())]));

  it("accepts a freshly-built diff (round-trips through JSON)", () => {
    const d = sample();
    expect(() => validateBacktestResearchPortfolioDiff(d)).not.toThrow();
    expect(() => validateBacktestResearchPortfolioDiff(JSON.parse(JSON.stringify(d)))).not.toThrow();
  });

  it("rejects a non-object", () => {
    expect(() => validateBacktestResearchPortfolioDiff(null)).toThrow(BacktestResearchPortfolioDiffError);
    expect(() => validateBacktestResearchPortfolioDiff("nope")).toThrow(BacktestResearchPortfolioDiffError);
  });

  it("rejects a wrong schemaVersion", () => {
    const d = JSON.parse(JSON.stringify(sample())) as BacktestResearchPortfolioDiff;
    (d as { schemaVersion: string }).schemaVersion = "backtest.research.portfolio.diff.v2";
    expect(() => validateBacktestResearchPortfolioDiff(d)).toThrow(/schemaVersion/);
  });

  it("rejects a CI gate that does not mirror its flag", () => {
    const d = JSON.parse(JSON.stringify(sample())) as BacktestResearchPortfolioDiff;
    d.wouldFailOnRegression = !d.hasRegression;
    expect(() => validateBacktestResearchPortfolioDiff(d)).toThrow(/must mirror/);
  });

  it("rejects a malformed number delta", () => {
    const d = JSON.parse(JSON.stringify(sample())) as unknown as Record<string, unknown>;
    d.campaignCount = { base: 1, next: 2 }; // missing delta
    expect(() => validateBacktestResearchPortfolioDiff(d)).toThrow(/number delta/);
  });

  it("rejects a missing required array", () => {
    const d = JSON.parse(JSON.stringify(sample())) as unknown as Record<string, unknown>;
    delete d.newlyRegressedCampaigns;
    expect(() => validateBacktestResearchPortfolioDiff(d)).toThrow(/newlyRegressedCampaigns/);
  });
});

describe("diffBacktestResearchPortfolioReports — input refusal", () => {
  it("refuses a non-portfolio base", () => {
    expect(() => diffBacktestResearchPortfolioReports(null, portfolio([pc("a", cleanHist())]))).toThrow(/base portfolio report is invalid/);
  });

  it("refuses a wrong-schema next (a history report is not a portfolio report)", () => {
    expect(() => diffBacktestResearchPortfolioReports(portfolio([pc("a", cleanHist())]), cleanHist())).toThrow(/next portfolio report is invalid/);
  });

  it("refuses a portfolio report carrying duplicate campaign ids", () => {
    const good = portfolio([pc("x", cleanHist()), pc("y", regressedHist())]);
    const dup = JSON.parse(JSON.stringify(good)) as { campaignIds: string[]; campaigns: { campaignId: string }[] };
    // Forge a duplicate id while keeping campaignCount/lengths internally consistent so the strict
    // portfolio validator passes and our diff-level duplicate guard is what fires. (The builder emits
    // campaigns in triage order, so rewrite BOTH summaries' ids rather than assuming a position.)
    dup.campaigns[0]!.campaignId = "x";
    dup.campaigns[1]!.campaignId = "x";
    dup.campaignIds = ["x", "x"];
    expect(() => diffBacktestResearchPortfolioReports(dup, good)).toThrow(/duplicate campaign ids/);
  });
});

describe("formatBacktestResearchPortfolioDiff", () => {
  it("renders a stable, sectioned PAPER-ONLY human report", () => {
    const d = diffBacktestResearchPortfolioReports(portfolio([pc("alpha", cleanHist())]), portfolio([pc("alpha", regressedHist()), pc("bravo", newAttentionHist())]));
    const text = formatBacktestResearchPortfolioDiff(d);
    expect(text).toBe(formatBacktestResearchPortfolioDiff(d)); // deterministic
    expect(text).toContain(BACKTEST_RESEARCH_PORTFOLIO_DIFF_BANNER);
    expect(text).toContain("PAPER ONLY");
    expect(text).toContain("Added campaigns (1)");
    expect(text).toContain("Regression: YES");
    expect(text.toLowerCase()).toContain("not a live result");
  });

  it("produces a JSON-safe report shape (validates after a stringify round-trip)", () => {
    const d = diffBacktestResearchPortfolioReports(portfolio([pc("alpha", cleanHist())]), portfolio([pc("alpha", cleanHist())]));
    const round = JSON.parse(JSON.stringify(d));
    expect(() => validateBacktestResearchPortfolioDiff(round)).not.toThrow();
  });

  it("routes the whole output through the shared redactor (no raw unsafe strings leak)", () => {
    const secretish = "a".repeat(64); // a 64-char hex-looking token the redactor must mask
    const base = portfolio([pc("alpha", cleanHist())], secretish);
    const next = portfolio([pc("alpha", regressedHist())], secretish);
    const text = formatBacktestResearchPortfolioDiff(diffBacktestResearchPortfolioReports(base, next));
    expect(text).toContain(REDACTED);
    expect(text).not.toContain(secretish);
  });
});
