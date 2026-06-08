/**
 * Tests for the Sprint 19 RESEARCH CAMPAIGN DIFF. Everything here is INJECTED test data — fake
 * run ids, fake paths, made-up digests — exercised purely offline. Campaign indexes are built with
 * the real Sprint 18 builder and then diffed. Nothing here is real market data, a live result, or a
 * profitability claim.
 */

import { describe, it, expect } from "vitest";
import {
  diffBacktestResearchCampaignIndexes,
  validateBacktestResearchCampaignIndexDiff,
  formatBacktestResearchCampaignIndexDiff,
  BacktestResearchCampaignIndexDiffError,
  BACKTEST_RESEARCH_CAMPAIGN_DIFF_SCHEMA_VERSION,
} from "./research-campaign-index-diff.js";
import {
  buildBacktestResearchCampaignIndex,
  type BacktestResearchCampaignRunInput,
} from "./research-campaign-index.js";
import type { BacktestArtifactDescriptor } from "./research-manifest.js";

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

function run(runId: string, over: Partial<BacktestResearchCampaignRunInput> = {}): BacktestResearchCampaignRunInput {
  return { runId, artifacts: [desc()], ...over };
}

/** A run that needs attention (one unknown artifact). */
function unknownRun(runId: string): BacktestResearchCampaignRunInput {
  return { runId, artifacts: [desc({ path: "u.json", kind: "unknown-json", schemaVersion: null, digest: "u" })] };
}

function campaign(name: string, runs: BacktestResearchCampaignRunInput[]) {
  return buildBacktestResearchCampaignIndex({ campaignName: name, runs });
}

describe("diffBacktestResearchCampaignIndexes — identical", () => {
  it("reports no change and no regression for identical campaigns", () => {
    const c = campaign("c", [run("a"), run("b")]);
    const diff = diffBacktestResearchCampaignIndexes(c, c);
    expect(diff.schemaVersion).toBe(BACKTEST_RESEARCH_CAMPAIGN_DIFF_SCHEMA_VERSION);
    expect(diff.hasChange).toBe(false);
    expect(diff.hasRegression).toBe(false);
    expect(diff.campaignDigestChanged).toBe(false);
    expect(diff.addedRuns).toEqual([]);
    expect(diff.removedRuns).toEqual([]);
    expect(diff.changedRuns).toEqual([]);
    expect(diff.paperOnly).toBe(true);
  });

  it("is byte-stable and carries no timestamp-like fields", () => {
    const base = campaign("c", [run("a", { artifacts: [desc({ digest: "1" })] })]);
    const next = campaign("c", [run("a", { artifacts: [desc({ digest: "2" })] })]);
    const json = JSON.stringify(diffBacktestResearchCampaignIndexes(base, next));
    expect(json).toBe(JSON.stringify(diffBacktestResearchCampaignIndexes(base, next)));
    expect(json).not.toMatch(/"generatedAt"|"createdAt"|"timestamp"|"ranAt"/);
  });
});

describe("diffBacktestResearchCampaignIndexes — detected changes", () => {
  it("detects a campaign digest change when a run's content changes (regression)", () => {
    const base = campaign("c", [run("a", { artifacts: [desc({ digest: "1" })] })]);
    const next = campaign("c", [run("a", { artifacts: [desc({ digest: "2" })] })]);
    const diff = diffBacktestResearchCampaignIndexes(base, next);
    expect(diff.campaignDigestChanged).toBe(true);
    expect(diff.changedRuns.map((c) => c.runId)).toEqual(["a"]);
    expect(diff.changedRuns[0]!.runDigestChanged).toBe(true);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.some((r) => /changed run digest/.test(r))).toBe(true);
  });

  it("detects an added valid run as a change but NOT a regression (additive)", () => {
    const base = campaign("c", [run("a")]);
    const next = campaign("c", [run("a"), run("b")]);
    const diff = diffBacktestResearchCampaignIndexes(base, next);
    expect(diff.addedRuns.map((r) => r.runId)).toEqual(["b"]);
    expect(diff.runCount.delta).toBe(1);
    expect(diff.hasChange).toBe(true);
    expect(diff.hasRegression).toBe(false);
  });

  it("detects a removed previously-valid run (regression)", () => {
    const base = campaign("c", [run("a"), run("b")]);
    const next = campaign("c", [run("a")]);
    const diff = diffBacktestResearchCampaignIndexes(base, next);
    expect(diff.removedRuns.map((r) => r.runId)).toEqual(["b"]);
    expect(diff.removedRuns[0]!.valid).toBe(true);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.some((r) => /previously-valid run\(s\) removed/.test(r))).toBe(true);
  });

  it("treats removing an INVALID run as a change but not a regression", () => {
    const base = campaign("c", [run("a"), unknownRun("bad")]);
    const next = campaign("c", [run("a")]);
    const diff = diffBacktestResearchCampaignIndexes(base, next);
    expect(diff.removedRuns.map((r) => r.runId)).toEqual(["bad"]);
    expect(diff.removedRuns[0]!.valid).toBe(false);
    expect(diff.hasChange).toBe(true);
    expect(diff.hasRegression).toBe(false);
    expect(diff.noLongerNeedsAttention).toContain("bad");
  });

  it("detects a run going valid → invalid (regression + newly needs attention)", () => {
    const base = campaign("c", [run("a")]);
    const next = campaign("c", [unknownRun("a")]);
    const diff = diffBacktestResearchCampaignIndexes(base, next);
    const change = diff.changedRuns.find((c) => c.runId === "a")!;
    expect(change.becameInvalid).toBe(true);
    expect(change.validChanged).toBe(true);
    expect(diff.newlyNeedsAttention).toContain("a");
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.some((r) => /became invalid/.test(r))).toBe(true);
  });

  it("detects a total unknown-count increase from a newly added invalid run (regression)", () => {
    const base = campaign("c", [run("a")]);
    const next = campaign("c", [run("a"), unknownRun("b")]);
    const diff = diffBacktestResearchCampaignIndexes(base, next);
    expect(diff.totalUnknownArtifactCount.delta).toBe(1);
    expect(diff.addedRuns.map((r) => r.runId)).toEqual(["b"]);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.some((r) => /unknown artifact count increased/.test(r))).toBe(true);
  });

  it("detects aggregate kind-count and schema-set changes", () => {
    const base = campaign("c", [run("a")]); // backtest-report / backtest.report.v1
    const next = campaign("c", [
      run("a"),
      run("b", { artifacts: [desc({ path: "s.json", kind: "suite-index", schemaVersion: "backtest.suite.v1", digest: "s" })] }),
    ]);
    const diff = diffBacktestResearchCampaignIndexes(base, next);
    expect(diff.aggregateKindCountChanges.some((k) => k.key === "suite-index" && k.delta === 1)).toBe(true);
    expect(diff.aggregateSchemasAdded).toContain("backtest.suite.v1");
  });

  it("flags an incompatible campaign schema version as a change and a regression", () => {
    const base = campaign("c", [run("a")]);
    const next = JSON.parse(JSON.stringify(campaign("c", [run("a")])));
    next.schemaVersion = "backtest.research.campaign.index.v2";
    const diff = diffBacktestResearchCampaignIndexes(base, next);
    expect(diff.campaignSchemaMatch).toBe(false);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.some((r) => /incompatible campaign schemaVersion/.test(r))).toBe(true);
  });
});

describe("diffBacktestResearchCampaignIndexes — input validation", () => {
  it("refuses a non-object base/next", () => {
    expect(() => diffBacktestResearchCampaignIndexes(null, campaign("c", [run("a")]))).toThrow(
      BacktestResearchCampaignIndexDiffError,
    );
    expect(() => diffBacktestResearchCampaignIndexes(campaign("c", [run("a")]), 7)).toThrow(/next campaign index must be a JSON object/);
  });

  it("refuses a campaign index missing its campaign digest", () => {
    const bad = JSON.parse(JSON.stringify(campaign("c", [run("a")])));
    delete bad.campaignDigest;
    expect(() => diffBacktestResearchCampaignIndexes(bad, campaign("c", [run("a")]))).toThrow(/campaignDigest must be a non-empty string/);
  });

  it("refuses a campaign with a malformed run summary", () => {
    const bad = JSON.parse(JSON.stringify(campaign("c", [run("a")])));
    bad.runs[0].valid = "nope";
    expect(() => diffBacktestResearchCampaignIndexes(campaign("c", [run("a")]), bad)).toThrow(/runs\[0\]\.valid must be a boolean/);
  });
});

describe("validateBacktestResearchCampaignIndexDiff", () => {
  it("accepts a produced diff round-tripped through JSON", () => {
    const diff = diffBacktestResearchCampaignIndexes(
      campaign("c", [run("a", { artifacts: [desc({ digest: "1" })] })]),
      campaign("c", [run("a", { artifacts: [desc({ digest: "2" })] }), run("b")]),
    );
    const round = JSON.parse(JSON.stringify(diff));
    expect(validateBacktestResearchCampaignIndexDiff(round)).toEqual(diff);
  });

  it("rejects a wrong schema version and a missing safety flag", () => {
    const diff = diffBacktestResearchCampaignIndexes(campaign("c", [run("a")]), campaign("c", [run("a")]));
    expect(() => validateBacktestResearchCampaignIndexDiff({ ...diff, schemaVersion: "x" })).toThrow(/schemaVersion/);
    expect(() => validateBacktestResearchCampaignIndexDiff({ ...diff, simulated: false })).toThrow(/simulated must be true/);
  });

  it("rejects a bad number delta and a malformed changed-run entry", () => {
    const diff = diffBacktestResearchCampaignIndexes(
      campaign("c", [run("a", { artifacts: [desc({ digest: "1" })] })]),
      campaign("c", [run("a", { artifacts: [desc({ digest: "2" })] })]),
    );
    expect(() => validateBacktestResearchCampaignIndexDiff({ ...diff, runCount: { base: 1 } })).toThrow(/number delta/);
    const bad = JSON.parse(JSON.stringify(diff));
    bad.changedRuns[0].becameInvalid = "no";
    expect(() => validateBacktestResearchCampaignIndexDiff(bad)).toThrow(/changedRuns\[0\]\.becameInvalid/);
  });
});

describe("formatBacktestResearchCampaignIndexDiff", () => {
  it("renders a PAPER-ONLY header, the change/regression verdicts, and disclaimers", () => {
    const diff = diffBacktestResearchCampaignIndexes(campaign("c", [run("a")]), campaign("c", [unknownRun("a")]));
    const text = formatBacktestResearchCampaignIndexDiff(diff, { baseLabel: "base/", nextLabel: "next/" });
    expect(text).toContain("Research campaign diff (SIMULATED PAPER-ONLY)");
    expect(text).toContain("Changed: YES");
    expect(text).toContain("Regression: YES");
    expect(text.toLowerCase()).toContain("not a live result");
    expect(text).toContain("now needs attention");
  });

  it("redacts a secret-looking run id and caps long lists", () => {
    const secret = "S".repeat(90);
    const base = campaign("c", [run("keep")]);
    const manyRuns = Array.from({ length: 60 }, (_, i) => run(`add-${String(i).padStart(3, "0")}`));
    const next = campaign("c", [run("keep"), run(secret), ...manyRuns]);
    const text = formatBacktestResearchCampaignIndexDiff(diffBacktestResearchCampaignIndexes(base, next), { maxRunRows: 10 });
    expect(text).not.toContain(secret);
    expect(text).toContain("[REDACTED]");
    expect(text).toContain("more (summarized");
  });
});
