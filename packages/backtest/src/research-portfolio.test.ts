/**
 * Tests for the Sprint 21 RESEARCH PORTFOLIO REPORT. Everything here is INJECTED test data — fake
 * campaign ids, fake run ids, made-up digests — exercised purely offline. Campaign index snapshots
 * are built with the real Sprint 18 builder, folded into Sprint 20 history reports with the real
 * builder, then rolled up into a portfolio report. Nothing here is real market data, a live result,
 * or a profitability claim.
 */

import { describe, it, expect } from "vitest";
import { REDACTED } from "@soulmaker/security";
import {
  buildBacktestResearchPortfolioReport,
  validateBacktestResearchPortfolioReport,
  formatBacktestResearchPortfolioReport,
  BacktestResearchPortfolioReportError,
  BACKTEST_RESEARCH_PORTFOLIO_REPORT_SCHEMA_VERSION,
  type BacktestResearchPortfolioCampaignInput,
} from "./research-portfolio.js";
import {
  buildBacktestResearchCampaignHistoryReport,
  type BacktestResearchCampaignHistorySnapshotInput,
} from "./research-campaign-history.js";
import {
  buildBacktestResearchCampaignIndex,
  type BacktestResearchCampaignRunInput,
} from "./research-campaign-index.js";
import type { BacktestArtifactDescriptor } from "./research-manifest.js";

// --- fixtures (all injected, offline) ----------------------------------------

function desc(over: Partial<BacktestArtifactDescriptor> = {}): BacktestArtifactDescriptor {
  return {
    path: "reports/a.report.json",
    kind: "backtest-report",
    schemaVersion: "backtest.report.v1",
    digest: "aaaaaaaaaaaaaaaa",
    sizeBytes: 100,
    ...over,
  };
}

/** A valid run with a specific run digest (so its run digest differs across snapshots). */
function okRun(runId: string, digest = "d1"): BacktestResearchCampaignRunInput {
  return { runId, artifacts: [desc({ digest })] };
}

/** A run that needs attention (one unknown artifact => invalid). */
function badRun(runId: string): BacktestResearchCampaignRunInput {
  return { runId, artifacts: [desc({ path: "u.json", kind: "unknown-json", schemaVersion: null, digest: "u" })] };
}

function snap(snapshotId: string, runs: BacktestResearchCampaignRunInput[]): BacktestResearchCampaignHistorySnapshotInput {
  return { snapshotId, index: buildBacktestResearchCampaignIndex({ campaignName: "c", runs }) };
}

/** Build a real Sprint 20 history report from ordered (snapshotId, runs) pairs. */
function historyReport(
  campaignName: string,
  snapshots: [string, BacktestResearchCampaignRunInput[]][],
) {
  return buildBacktestResearchCampaignHistoryReport({
    campaignName,
    snapshots: snapshots.map(([id, runs]) => snap(id, runs)),
  });
}

/** A portfolio campaign input wrapping a real history report. */
function pc(
  campaignId: string,
  snapshots: [string, BacktestResearchCampaignRunInput[]][],
  sourceLabel?: string,
): BacktestResearchPortfolioCampaignInput {
  return { campaignId, report: historyReport(campaignId, snapshots), sourceLabel };
}

// Reusable campaign archetypes (each is a real, distinct history report).
const cleanStable = (id: string) => pc(id, [["s0", [okRun("a")]], ["s1", [okRun("a")]]]); // no change
const changedClean = (id: string) => pc(id, [["s0", [okRun("a")]], ["s1", [okRun("a"), okRun("b")]]]); // additive valid
const regressed = (id: string) => pc(id, [["s0", [okRun("a", "1")]], ["s1", [okRun("a", "2")]]]); // digest change
const attentionStable = (id: string) =>
  pc(id, [["s0", [okRun("a"), badRun("bad")]], ["s1", [okRun("a"), badRun("bad")]]]); // persistent invalid, no change
const newAttention = (id: string) => pc(id, [["s0", [okRun("a")]], ["s1", [okRun("a"), badRun("b")]]]); // new invalid run
const recovered = (id: string) => pc(id, [["s0", [badRun("a")]], ["s1", [okRun("a")]]]); // invalid -> valid

describe("buildBacktestResearchPortfolioReport — basics", () => {
  it("rolls up a single clean campaign and carries the PAPER-ONLY labelling", () => {
    const r = buildBacktestResearchPortfolioReport({ campaigns: [cleanStable("alpha")] });
    expect(r.schemaVersion).toBe(BACKTEST_RESEARCH_PORTFOLIO_REPORT_SCHEMA_VERSION);
    expect(r.paperOnly).toBe(true);
    expect(r.simulated).toBe(true);
    expect(r.notLiveResult).toBe(true);
    expect(r.campaignCount).toBe(1);
    expect(r.campaignIds).toEqual(["alpha"]);
    expect(r.hasChange).toBe(false);
    expect(r.hasRegression).toBe(false);
    expect(r.hasAttention).toBe(false);
    expect(r.cleanCampaigns).toEqual(["alpha"]);
    expect(r.stableCampaigns).toEqual(["alpha"]);
    expect(r.warnings.some((w) => /only one campaign/.test(w))).toBe(true);
  });

  it("validates as a portfolio report via the strict backstop", () => {
    const r = buildBacktestResearchPortfolioReport({ campaigns: [cleanStable("alpha"), regressed("bravo")] });
    expect(() => validateBacktestResearchPortfolioReport(r)).not.toThrow();
  });

  it("carries a portfolio name and source labels when supplied", () => {
    const r = buildBacktestResearchPortfolioReport({
      portfolioName: "research-suite",
      campaigns: [pc("alpha", [["s0", [okRun("a")]], ["s1", [okRun("a")]]], "./alpha-history.json")],
    });
    expect(r.portfolioName).toBe("research-suite");
    expect(r.campaigns[0]!.sourceLabel).toBe("./alpha-history.json");
    expect(r.campaigns[0]!.campaignName).toBe("alpha");
  });

  it("is byte-stable and independent of the supplied campaign order", () => {
    const a = cleanStable("alpha");
    const b = regressed("bravo");
    const c = attentionStable("charlie");
    const forward = JSON.stringify(buildBacktestResearchPortfolioReport({ campaigns: [a, b, c] }));
    const shuffled = JSON.stringify(buildBacktestResearchPortfolioReport({ campaigns: [c, a, b] }));
    expect(forward).toBe(shuffled);
    expect(forward).not.toMatch(/"generatedAt"|"createdAt"|"timestamp"|"ranAt"/);
  });
});

describe("buildBacktestResearchPortfolioReport — per-campaign status + flags", () => {
  it("labels a clean+stable campaign clean and a benign additive change changed-but-clean", () => {
    const r = buildBacktestResearchPortfolioReport({ campaigns: [cleanStable("alpha"), changedClean("bravo")] });
    const alpha = r.campaigns.find((c) => c.campaignId === "alpha")!;
    const bravo = r.campaigns.find((c) => c.campaignId === "bravo")!;
    expect(alpha.status).toBe("clean");
    expect(alpha.flagged).toBe(false);
    expect(bravo.status).toBe("changed");
    expect(bravo.flagged).toBe(false); // a benign valid addition is a change, not a concern
    expect(bravo.hasChange).toBe(true);
    expect(r.cleanCampaigns).toEqual(["alpha", "bravo"]); // both have no integrity concern
    expect(r.stableCampaigns).toEqual(["alpha"]); // only alpha is unchanged
  });

  it("labels a digest-change campaign a regression with a per-run reason", () => {
    const r = buildBacktestResearchPortfolioReport({ campaigns: [regressed("charlie")] });
    const charlie = r.campaigns[0]!;
    expect(charlie.status).toBe("regression");
    expect(charlie.flagged).toBe(true);
    expect(charlie.hasRegression).toBe(true);
    expect(charlie.reasons.some((x) => /conservative regression/.test(x) && /a/.test(x))).toBe(true);
  });

  it("labels a persistent-invalid campaign attention while it is still stable (no change)", () => {
    const r = buildBacktestResearchPortfolioReport({ campaigns: [attentionStable("delta")] });
    const delta = r.campaigns[0]!;
    expect(delta.status).toBe("attention");
    expect(delta.flagged).toBe(true);
    expect(delta.hasAttention).toBe(true);
    expect(delta.hasChange).toBe(false);
    expect(r.stableCampaigns).toEqual(["delta"]); // stable…
    expect(r.cleanCampaigns).toEqual([]); // …but NOT clean (it has current attention)
  });

  it("treats an added invalid run as new attention (aggregate-only regression)", () => {
    const r = buildBacktestResearchPortfolioReport({ campaigns: [newAttention("echo")] });
    const echo = r.campaigns[0]!;
    expect(echo.hasNewAttentionSinceBaseline).toBe(true);
    expect(echo.hasAttention).toBe(true);
    expect(echo.hasRegression).toBe(true); // total unknown-artifact count rose => aggregate regression
    expect(echo.status).toBe("regression"); // regression outranks attention in the severity ladder
    expect(echo.runsNewlyNeedingAttentionSinceBaseline).toBe(1);
  });

  it("counts recovered runs from an invalid->valid campaign", () => {
    const r = buildBacktestResearchPortfolioReport({ campaigns: [recovered("foxtrot")] });
    expect(r.totalRunsRecovered).toBe(1);
    expect(r.campaigns[0]!.runsRecoveredSinceBaseline).toBe(1);
  });
});

describe("buildBacktestResearchPortfolioReport — aggregation + triage ordering", () => {
  const mixed = () =>
    buildBacktestResearchPortfolioReport({
      portfolioName: "mixed",
      campaigns: [
        cleanStable("alpha"),
        changedClean("bravo"),
        regressed("charlie"),
        attentionStable("delta"),
        newAttention("echo"),
      ],
    });

  it("aggregates the four flags and their campaignId lists", () => {
    const r = mixed();
    expect(r.campaignCount).toBe(5);
    expect(r.campaignIds).toEqual(["alpha", "bravo", "charlie", "delta", "echo"]);
    expect(r.hasChange).toBe(true);
    expect(r.hasRegression).toBe(true);
    expect(r.hasAttention).toBe(true);
    expect(r.hasNewAttentionSinceBaseline).toBe(true);
    expect(r.campaignsWithChange).toEqual(["bravo", "charlie", "echo"]);
    expect(r.campaignsWithRegression).toEqual(["charlie", "echo"]);
    expect(r.campaignsWithAttention).toEqual(["delta", "echo"]);
    expect(r.campaignsWithNewAttentionSinceBaseline).toEqual(["echo"]);
    expect(r.cleanCampaigns).toEqual(["alpha", "bravo"]);
    expect(r.stableCampaigns).toEqual(["alpha", "delta"]);
  });

  it("orders the per-campaign rollup by integrity triage (most-concerning first)", () => {
    const r = mixed();
    expect(r.campaigns.map((c) => c.campaignId)).toEqual(["echo", "charlie", "delta", "bravo", "alpha"]);
  });

  it("sums run totals across campaigns without de-duplicating campaign-scoped run ids", () => {
    const r = mixed();
    // alpha 1 + bravo 2 + charlie 1 + delta 2 + echo 2 = 8
    expect(r.totalRunsObserved).toBe(8);
    expect(r.totalRunsCurrentlyPresent).toBe(8);
    expect(r.totalRunsCurrentlyNeedingAttention).toBe(2); // delta bad + echo b
    expect(r.totalRunsNewlyNeedingAttention).toBe(1); // echo b
  });

  it("surfaces severity-ordered top integrity concerns and CI fail reasons", () => {
    const r = mixed();
    // regression (charlie, echo), then new attention (echo), then current attention (delta, echo)
    expect(r.topConcerns[0]).toMatch(/^charlie: conservative regression/);
    expect(r.topConcerns[1]).toMatch(/^echo: conservative regression/);
    expect(r.topConcerns.some((x) => /^echo: 1 run\(s\) newly need attention/.test(x))).toBe(true);
    expect(r.topConcerns.some((x) => /^delta: 1 run\(s\) currently need attention/.test(x))).toBe(true);
    expect(r.wouldFailOnChange).toBe(true);
    expect(r.wouldFailOnRegression).toBe(true);
    expect(r.wouldFailOnAttention).toBe(true);
    expect(r.wouldFailOnNewAttention).toBe(true);
    expect(r.ciFailReasons.length).toBe(4);
  });

  it("reports echo's regression as aggregate-only (empty per-run list, aggregate reason text)", () => {
    const r = mixed();
    const echoConcern = r.topConcerns.find((x) => x.startsWith("echo: conservative regression"))!;
    expect(echoConcern).toMatch(/aggregate reason/);
  });
});

describe("buildBacktestResearchPortfolioReport — streak leaders", () => {
  it("finds the campaigns holding the longest valid / attention streaks", () => {
    // alpha: 2 valid snapshots in a row (validStreak 2). bravo single valid snapshot (streak 1).
    const alpha = pc("alpha", [["s0", [okRun("a")]], ["s1", [okRun("a")]]]);
    const bravo = pc("bravo", [["s0", [okRun("a")]]]);
    // gamma: 2 invalid snapshots in a row for "bad" (attentionStreak 2).
    const gamma = pc("gamma", [["s0", [badRun("bad")]], ["s1", [badRun("bad")]]]);
    const r = buildBacktestResearchPortfolioReport({ campaigns: [alpha, bravo, gamma] });
    expect(r.longestValidStreak).toBe(2);
    expect(r.campaignsWithLongestValidStreak).toEqual(["alpha"]);
    expect(r.longestAttentionStreak).toBe(2);
    expect(r.campaignsWithLongestAttentionStreak).toEqual(["gamma"]);
  });
});

describe("buildBacktestResearchPortfolioReport — rejections", () => {
  it("rejects a non-object input", () => {
    expect(() => buildBacktestResearchPortfolioReport(null as never)).toThrow(BacktestResearchPortfolioReportError);
  });

  it("rejects an empty campaign list", () => {
    expect(() => buildBacktestResearchPortfolioReport({ campaigns: [] })).toThrow(/at least one campaign/);
  });

  it("rejects a non-array campaigns field", () => {
    expect(() => buildBacktestResearchPortfolioReport({ campaigns: {} as never })).toThrow(/must be an array/);
  });

  it("rejects a missing/empty campaignId", () => {
    expect(() =>
      buildBacktestResearchPortfolioReport({ campaigns: [{ campaignId: "", report: historyReport("x", [["s0", [okRun("a")]]]) }] }),
    ).toThrow(/campaignId must be a non-empty string/);
  });

  it("rejects a duplicate campaignId", () => {
    expect(() =>
      buildBacktestResearchPortfolioReport({ campaigns: [cleanStable("dup"), regressed("dup")] }),
    ).toThrow(/duplicate campaignId "dup"/);
  });

  it("rejects a non-history-report value (wrong schema)", () => {
    const campaignIndex = buildBacktestResearchCampaignIndex({ campaignName: "c", runs: [okRun("a")] });
    expect(() =>
      buildBacktestResearchPortfolioReport({ campaigns: [{ campaignId: "x", report: campaignIndex }] }),
    ).toThrow(/is not a valid campaign history report/);
  });

  it("rejects a malformed report object", () => {
    expect(() =>
      buildBacktestResearchPortfolioReport({ campaigns: [{ campaignId: "x", report: { schemaVersion: "nope" } }] }),
    ).toThrow(/is not a valid campaign history report/);
  });

  it("rejects a non-string sourceLabel", () => {
    expect(() =>
      buildBacktestResearchPortfolioReport({
        campaigns: [{ campaignId: "x", report: historyReport("x", [["s0", [okRun("a")]]]), sourceLabel: 5 as never }],
      }),
    ).toThrow(/sourceLabel must be a non-empty string/);
  });
});

describe("validateBacktestResearchPortfolioReport — backstop", () => {
  it("accepts a freshly built report", () => {
    const r = buildBacktestResearchPortfolioReport({ campaigns: [cleanStable("alpha"), newAttention("echo")] });
    expect(validateBacktestResearchPortfolioReport(r)).toBe(r);
  });

  it("rejects a wrong schema version", () => {
    const r = buildBacktestResearchPortfolioReport({ campaigns: [cleanStable("alpha")] });
    expect(() => validateBacktestResearchPortfolioReport({ ...r, schemaVersion: "x" })).toThrow(/schemaVersion/);
  });

  it("rejects a tampered campaignCount/campaignIds mismatch", () => {
    const r = buildBacktestResearchPortfolioReport({ campaigns: [cleanStable("alpha")] });
    expect(() => validateBacktestResearchPortfolioReport({ ...r, campaignCount: 2 })).toThrow(/campaignIds length must equal campaignCount/);
  });

  it("rejects an inconsistent per-campaign status", () => {
    const r = buildBacktestResearchPortfolioReport({ campaigns: [cleanStable("alpha")] });
    const tampered = {
      ...r,
      campaigns: [{ ...r.campaigns[0]!, status: "regression" as const }],
    };
    expect(() => validateBacktestResearchPortfolioReport(tampered)).toThrow(/inconsistent with the carried-over flags/);
  });

  it("rejects a CI gate that does not mirror its aggregate flag", () => {
    const r = buildBacktestResearchPortfolioReport({ campaigns: [cleanStable("alpha")] });
    expect(() => validateBacktestResearchPortfolioReport({ ...r, wouldFailOnChange: true })).toThrow(/must mirror hasChange/);
  });
});

describe("formatBacktestResearchPortfolioReport — human output", () => {
  it("renders a stable, PAPER-ONLY report with triage ordering and disclaimers", () => {
    const r = buildBacktestResearchPortfolioReport({
      portfolioName: "mixed",
      campaigns: [cleanStable("alpha"), regressed("charlie"), attentionStable("delta")],
    });
    const text = formatBacktestResearchPortfolioReport(r);
    expect(text).toContain("SIMULATED PAPER-ONLY RESEARCH PORTFOLIO REPORT");
    expect(text).toContain("Campaigns (integrity triage");
    expect(text).toContain("Top integrity concerns:");
    expect(text.toLowerCase()).toContain("not a live result");
    // byte-stable across calls
    expect(formatBacktestResearchPortfolioReport(r)).toBe(text);
  });

  it("summarizes long campaign lists instead of dumping every row", () => {
    const campaigns = Array.from({ length: 5 }, (_, i) => cleanStable(`c${i}`));
    const r = buildBacktestResearchPortfolioReport({ campaigns });
    const text = formatBacktestResearchPortfolioReport(r, { maxCampaignRows: 2 });
    expect(text).toMatch(/… and 3 more \(summarized/);
  });

  it("redacts unsafe-looking strings carried in a source label", () => {
    const secretish = "a".repeat(64); // a 64-char hex-looking token the redactor must mask
    const r = buildBacktestResearchPortfolioReport({
      campaigns: [pc("alpha", [["s0", [okRun("a")]]], secretish)],
    });
    // sourceLabel is not printed by default, but the redactor is applied to the whole output;
    // assert directly that the formatter routes through redaction by checking a label echo.
    const text = formatBacktestResearchPortfolioReport(r, { label: secretish });
    expect(text).not.toContain(secretish);
    expect(text).toContain(REDACTED);
  });
});
