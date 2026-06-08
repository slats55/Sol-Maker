/**
 * Tests for the Sprint 20 RESEARCH CAMPAIGN HISTORY REPORT. Everything here is INJECTED test data —
 * fake run ids, fake paths, made-up digests — exercised purely offline. Campaign index snapshots are
 * built with the real Sprint 18 builder, then folded into a history report. Nothing here is real
 * market data, a live result, or a profitability claim.
 */

import { describe, it, expect } from "vitest";
import {
  buildBacktestResearchCampaignHistoryReport,
  validateBacktestResearchCampaignHistoryReport,
  formatBacktestResearchCampaignHistoryReport,
  BacktestResearchCampaignHistoryReportError,
  BACKTEST_RESEARCH_CAMPAIGN_HISTORY_REPORT_SCHEMA_VERSION,
  type BacktestResearchCampaignHistorySnapshotInput,
} from "./research-campaign-history.js";
import {
  buildBacktestResearchCampaignIndex,
  type BacktestResearchCampaignRunInput,
} from "./research-campaign-index.js";
import { buildBacktestResearchBundle } from "./research-bundle.js";
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

/** A run with a specific artifact digest (so its run digest differs across snapshots). */
function runDigest(runId: string, digest: string): BacktestResearchCampaignRunInput {
  return { runId, artifacts: [desc({ digest })] };
}

/** A run that needs attention (one unknown artifact). */
function unknownRun(runId: string): BacktestResearchCampaignRunInput {
  return { runId, artifacts: [desc({ path: "u.json", kind: "unknown-json", schemaVersion: null, digest: "u" })] };
}

function campaign(name: string, runs: BacktestResearchCampaignRunInput[]) {
  return buildBacktestResearchCampaignIndex({ campaignName: name, runs });
}

function snap(snapshotId: string, runs: BacktestResearchCampaignRunInput[]): BacktestResearchCampaignHistorySnapshotInput {
  return { snapshotId, index: campaign("c", runs) };
}

function history(snapshots: BacktestResearchCampaignHistorySnapshotInput[], baseline?: "first" | "previous" | { snapshotId: string }) {
  return buildBacktestResearchCampaignHistoryReport({ campaignName: "c", snapshots, baseline });
}

describe("buildBacktestResearchCampaignHistoryReport — basics", () => {
  it("reports no change/regression for an identical pair of snapshots", () => {
    const r = history([snap("s0", [run("a"), run("b")]), snap("s1", [run("a"), run("b")])]);
    expect(r.schemaVersion).toBe(BACKTEST_RESEARCH_CAMPAIGN_HISTORY_REPORT_SCHEMA_VERSION);
    expect(r.snapshotCount).toBe(2);
    expect(r.snapshotIds).toEqual(["s0", "s1"]);
    expect(r.baselineSnapshotId).toBe("s0");
    expect(r.latestSnapshotId).toBe("s1");
    expect(r.previousSnapshotId).toBe("s0");
    expect(r.hasChange).toBe(false);
    expect(r.hasRegression).toBe(false);
    expect(r.hasAttention).toBe(false);
    expect(r.hasNewAttentionSinceBaseline).toBe(false);
    expect(r.totalRunsObserved).toBe(2);
    expect(r.runsCurrentlyValid).toBe(2);
    expect(r.paperOnly).toBe(true);
  });

  it("handles a single snapshot with a no-history warning and empty deltas", () => {
    const r = history([snap("only", [run("a"), unknownRun("bad")])]);
    expect(r.snapshotCount).toBe(1);
    expect(r.previousSnapshotId).toBeNull();
    expect(r.baselineSnapshotId).toBe("only");
    expect(r.latestSnapshotId).toBe("only");
    expect(r.hasChange).toBe(false);
    expect(r.hasRegression).toBe(false);
    expect(r.hasAttention).toBe(true); // "bad" needs attention now
    expect(r.runsNeedingAttentionNow).toEqual(["bad"]);
    expect(r.warnings.some((w) => /only one snapshot/.test(w))).toBe(true);
  });

  it("defaults the snapshot id to a positional snapshot-<i> when omitted", () => {
    const r = buildBacktestResearchCampaignHistoryReport({
      snapshots: [{ index: campaign("c", [run("a")]) }, { index: campaign("c", [run("a")]) }],
    });
    expect(r.snapshotIds).toEqual(["snapshot-0", "snapshot-1"]);
  });

  it("is byte-stable and carries no timestamp-like fields", () => {
    const snaps = () => [snap("s0", [runDigest("a", "1")]), snap("s1", [runDigest("a", "2")])];
    const json = JSON.stringify(history(snaps()));
    expect(json).toBe(JSON.stringify(history(snaps())));
    expect(json).not.toMatch(/"generatedAt"|"createdAt"|"timestamp"|"ranAt"/);
  });
});

describe("buildBacktestResearchCampaignHistoryReport — added / removed / changed / attention", () => {
  it("detects an added valid run as a change but not a regression", () => {
    const r = history([snap("s0", [run("a")]), snap("s1", [run("a"), run("b")])]);
    expect(r.runsAddedSinceBaseline).toBe(1);
    expect(r.hasChange).toBe(true);
    expect(r.hasRegression).toBe(false);
    const b = r.runs.find((x) => x.runId === "b")!;
    expect(b.firstSeenSnapshot).toBe("s1");
    expect(b.changedSinceBaseline).toBe(true);
    expect(b.conservativeRegression).toBe(false);
  });

  it("detects a removed previously-valid run as a regression", () => {
    const r = history([snap("s0", [run("a"), run("b")]), snap("s1", [run("a")])]);
    expect(r.runsRemovedSinceBaseline).toBe(1);
    expect(r.hasRegression).toBe(true);
    expect(r.runsWithConservativeRegression).toEqual(["b"]);
    const b = r.runs.find((x) => x.runId === "b")!;
    expect(b.currentlyPresent).toBe(false);
    expect(b.currentlyValid).toBeNull();
    expect(b.currentlyNeedsAttention).toBeNull();
    expect(b.lastSeenSnapshot).toBe("s0");
    expect(b.conservativeRegression).toBe(true);
  });

  it("treats removing an INVALID run as a change but not a regression", () => {
    const r = history([snap("s0", [run("a"), unknownRun("bad")]), snap("s1", [run("a")])]);
    expect(r.hasChange).toBe(true);
    expect(r.hasRegression).toBe(false);
    expect(r.runsWithConservativeRegression).toEqual([]);
  });

  it("detects a run-digest change as a change, a regression, and a digest-change count", () => {
    const r = history([snap("s0", [runDigest("a", "1")]), snap("s1", [runDigest("a", "2")])]);
    expect(r.hasChange).toBe(true);
    expect(r.hasRegression).toBe(true);
    expect(r.changedRunCountSinceBaseline).toBe(1);
    const a = r.runs.find((x) => x.runId === "a")!;
    expect(a.digestChangeCount).toBe(1);
    expect(a.changedSinceBaseline).toBe(true);
    expect(a.conservativeRegression).toBe(true);
  });

  it("detects a run going valid -> invalid (newly needs attention + regression)", () => {
    const r = history([snap("s0", [run("a")]), snap("s1", [unknownRun("a")])]);
    expect(r.hasNewAttentionSinceBaseline).toBe(true);
    expect(r.runsNewlyNeedingAttentionSinceBaseline).toBe(1);
    expect(r.hasRegression).toBe(true);
    const a = r.runs.find((x) => x.runId === "a")!;
    expect(a.newlyNeedsAttentionSinceBaseline).toBe(true);
    expect(a.currentlyNeedsAttention).toBe(true);
    expect(a.everNeedsAttention).toBe(true);
    expect(a.attentionStreak).toBe(1);
    expect(a.validStreak).toBe(0);
    expect(a.conservativeRegression).toBe(true);
  });

  it("detects a recovered run (needed attention at baseline, valid in latest)", () => {
    const r = history([snap("s0", [unknownRun("a")]), snap("s1", [run("a")])]);
    expect(r.runsRecoveredSinceBaseline).toBe(1);
    const a = r.runs.find((x) => x.runId === "a")!;
    expect(a.recoveredSinceBaseline).toBe(true);
    expect(a.currentlyNeedsAttention).toBe(false);
    expect(a.everNeedsAttention).toBe(true);
    expect(a.validStreak).toBe(1);
  });
});

describe("buildBacktestResearchCampaignHistoryReport — multi-snapshot trend", () => {
  // s0: a(valid,d1) c(valid)
  // s1: a(valid,d1) b(valid) c(valid)             -> b added
  // s2: a(valid,d2) b(valid) c(invalid)           -> a digest changed, c became invalid
  const snaps = [
    snap("s0", [runDigest("a", "1"), run("c")]),
    snap("s1", [runDigest("a", "1"), run("b"), run("c")]),
    snap("s2", [runDigest("a", "2"), run("b"), unknownRun("c")]),
  ];

  it("computes streaks, digest-change counts, and first/last seen across three snapshots", () => {
    const r = history(snaps);
    expect(r.snapshotCount).toBe(3);
    expect(r.totalRunsObserved).toBe(3);

    const a = r.runs.find((x) => x.runId === "a")!;
    expect(a.firstSeenSnapshot).toBe("s0");
    expect(a.lastSeenSnapshot).toBe("s2");
    expect(a.validStreak).toBe(3);
    expect(a.digestChangeCount).toBe(1); // d1->d1 (no) then d1->d2 (yes)
    expect(a.conservativeRegression).toBe(true);

    const b = r.runs.find((x) => x.runId === "b")!;
    expect(b.firstSeenSnapshot).toBe("s1");
    expect(b.validStreak).toBe(2); // present+valid in s1,s2; absent in s0 breaks
    expect(b.conservativeRegression).toBe(false);

    const c = r.runs.find((x) => x.runId === "c")!;
    expect(c.validStreak).toBe(0);
    expect(c.attentionStreak).toBe(1); // invalid in s2 only
    expect(c.newlyNeedsAttentionSinceBaseline).toBe(true);
    expect(c.conservativeRegression).toBe(true);
  });

  it("rolls up aggregate counts, streak leaders, and CI flags (baseline = first)", () => {
    const r = history(snaps);
    expect(r.runsCurrentlyPresent).toBe(3);
    expect(r.runsCurrentlyValid).toBe(2);
    expect(r.runsCurrentlyNeedingAttention).toBe(1);
    expect(r.runsEverNeedingAttention).toBe(1);
    expect(r.runsAddedSinceBaseline).toBe(1);
    expect(r.runsRemovedSinceBaseline).toBe(0);
    expect(r.changedRunCountSinceBaseline).toBe(2); // a (digest) + c (invalid)
    expect(r.changedRunCountSincePrevious).toBe(2); // s1->s2: a + c
    expect(r.longestValidStreak).toBe(3);
    expect(r.runsWithLongestValidStreak).toEqual(["a"]);
    expect(r.longestAttentionStreak).toBe(1);
    expect(r.runsWithLongestAttentionStreak).toEqual(["c"]);
    expect(r.runsNeedingAttentionNow).toEqual(["c"]);
    expect(r.runsWithConservativeRegression).toEqual(["a", "c"]);
    expect(r.hasChange).toBe(true);
    expect(r.hasRegression).toBe(true);
    expect(r.hasAttention).toBe(true);
    expect(r.hasNewAttentionSinceBaseline).toBe(true);
  });

  it("supports baseline = previous (since-previous semantics)", () => {
    // baseline = s1 (previous), latest = s2. a digest s1->s2 changed; c valid->invalid.
    const r = history(snaps, "previous");
    expect(r.baselineSnapshotId).toBe("s1");
    expect(r.baselineSelector).toBe("previous");
    expect(r.runsAddedSinceBaseline).toBe(0); // b already present in s1
    expect(r.changedRunCountSinceBaseline).toBe(2);
    expect(r.hasRegression).toBe(true);
  });

  it("supports an explicit baseline snapshot id", () => {
    const r = history(snaps, { snapshotId: "s1" });
    expect(r.baselineSnapshotId).toBe("s1");
    expect(r.baselineSelector).toBe("explicit");
    expect(r.runsAddedSinceBaseline).toBe(0);
  });
});

describe("buildBacktestResearchCampaignHistoryReport — input validation", () => {
  it("refuses a non-object input and an empty snapshot list", () => {
    expect(() => buildBacktestResearchCampaignHistoryReport(null as never)).toThrow(
      BacktestResearchCampaignHistoryReportError,
    );
    expect(() => buildBacktestResearchCampaignHistoryReport({ snapshots: [] })).toThrow(/at least one snapshot/);
  });

  it("refuses a snapshot whose index is not a campaign index (wrong schema)", () => {
    expect(() =>
      buildBacktestResearchCampaignHistoryReport({ snapshots: [{ index: { schemaVersion: "x" } }] }),
    ).toThrow(/is not a valid campaign index/);
  });

  it("refuses a snapshot that is a different research artifact type (a bundle)", () => {
    const bundle = buildBacktestResearchBundle({ runName: "r", artifacts: [desc()] });
    expect(() => buildBacktestResearchCampaignHistoryReport({ snapshots: [{ index: bundle }] })).toThrow(
      /is not a valid campaign index/,
    );
  });

  it("refuses a duplicate snapshot id", () => {
    expect(() => history([snap("dup", [run("a")]), snap("dup", [run("a")])])).toThrow(/duplicate snapshotId/);
  });

  it("refuses an explicit baseline id that is not among the snapshots", () => {
    expect(() => history([snap("s0", [run("a")])], { snapshotId: "nope" })).toThrow(
      /baseline snapshotId "nope" is not among/,
    );
  });
});

describe("validateBacktestResearchCampaignHistoryReport", () => {
  it("accepts a produced report round-tripped through JSON", () => {
    const r = history([snap("s0", [runDigest("a", "1"), run("c")]), snap("s1", [runDigest("a", "2"), run("b"), unknownRun("c")])]);
    const round = JSON.parse(JSON.stringify(r));
    expect(validateBacktestResearchCampaignHistoryReport(round)).toEqual(r);
  });

  it("rejects a wrong schema version and a missing safety flag", () => {
    const r = history([snap("s0", [run("a")]), snap("s1", [run("a")])]);
    expect(() => validateBacktestResearchCampaignHistoryReport({ ...r, schemaVersion: "x" })).toThrow(/schemaVersion/);
    expect(() => validateBacktestResearchCampaignHistoryReport({ ...r, simulated: false })).toThrow(/simulated must be true/);
  });

  it("rejects an inconsistent present/valid/attention count", () => {
    const r = history([snap("s0", [run("a")]), snap("s1", [run("a")])]);
    expect(() =>
      validateBacktestResearchCampaignHistoryReport({ ...r, runsCurrentlyValid: 99 }),
    ).toThrow(/runsCurrentlyValid \+ runsCurrentlyNeedingAttention must equal runsCurrentlyPresent/);
  });

  it("rejects a malformed run summary (absent run with a non-null current state)", () => {
    const r = history([snap("s0", [run("a"), run("b")]), snap("s1", [run("a")])]);
    const bad = JSON.parse(JSON.stringify(r));
    const b = bad.runs.find((x: { runId: string }) => x.runId === "b");
    b.currentlyValid = true; // absent run must keep null
    expect(() => validateBacktestResearchCampaignHistoryReport(bad)).toThrow(/an absent run must have null/);
  });
});

describe("formatBacktestResearchCampaignHistoryReport", () => {
  it("renders a PAPER-ONLY header, the verdicts, and disclaimers", () => {
    const r = history([snap("s0", [run("a")]), snap("s1", [unknownRun("a")])]);
    const text = formatBacktestResearchCampaignHistoryReport(r, { label: "campaign/" });
    expect(text).toContain("SIMULATED PAPER-ONLY RESEARCH CAMPAIGN HISTORY REPORT");
    expect(text).toContain("Regression since baseline: YES");
    expect(text).toContain("Attention now: YES");
    expect(text).toContain("New attention since baseline: YES");
    expect(text.toLowerCase()).toContain("not a live result");
  });

  it("is deterministic for a given report", () => {
    const r = history([snap("s0", [runDigest("a", "1")]), snap("s1", [runDigest("a", "2")])]);
    expect(formatBacktestResearchCampaignHistoryReport(r)).toBe(formatBacktestResearchCampaignHistoryReport(r));
  });

  it("redacts a secret-looking run id and caps long run lists", () => {
    const secret = "S".repeat(90);
    const many = Array.from({ length: 60 }, (_, i) => run(`add-${String(i).padStart(3, "0")}`));
    const r = history([snap("s0", [run("keep")]), snap("s1", [run("keep"), run(secret), ...many])]);
    const text = formatBacktestResearchCampaignHistoryReport(r, { maxRunRows: 10 });
    expect(text).not.toContain(secret);
    expect(text).toContain("[REDACTED]");
    expect(text).toContain("more (summarized");
  });
});
