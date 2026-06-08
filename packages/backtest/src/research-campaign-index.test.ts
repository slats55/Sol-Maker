/**
 * Tests for the Sprint 18 RESEARCH CAMPAIGN INDEX. Everything here is INJECTED test data — fake
 * run ids, fake paths, made-up digests — exercised purely offline. The pure package does no file
 * IO; these tests feed it already-loaded per-run descriptors. Nothing here is real market data, a
 * live result, or a profitability claim.
 */

import { describe, it, expect } from "vitest";
import {
  buildBacktestResearchCampaignIndex,
  buildBacktestResearchCampaignDigest,
  validateBacktestResearchCampaignIndex,
  formatBacktestResearchCampaignIndex,
  BacktestResearchCampaignIndexError,
  BACKTEST_RESEARCH_CAMPAIGN_INDEX_SCHEMA_VERSION,
  BACKTEST_RESEARCH_CAMPAIGN_INDEX_BANNER,
  type BacktestResearchCampaignRunInput,
} from "./research-campaign-index.js";
import { buildBacktestResearchManifest, type BacktestArtifactDescriptor } from "./research-manifest.js";

/** A recognized backtest-report descriptor by default; override any field. */
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

/** A run input with one recognized artifact by default. */
function run(
  runId: string,
  over: Partial<BacktestResearchCampaignRunInput> = {},
): BacktestResearchCampaignRunInput {
  return { runId, artifacts: [desc()], ...over };
}

describe("buildBacktestResearchCampaignIndex — happy path + labelling", () => {
  it("produces a paper-only, labelled index with an honest digest label + campaign digest", () => {
    const index = buildBacktestResearchCampaignIndex({
      campaignName: "campaign-1",
      runs: [run("run-a")],
    });
    expect(index.schemaVersion).toBe(BACKTEST_RESEARCH_CAMPAIGN_INDEX_SCHEMA_VERSION);
    expect(index.banner).toBe(BACKTEST_RESEARCH_CAMPAIGN_INDEX_BANNER);
    expect(index.paperOnly).toBe(true);
    expect(index.simulated).toBe(true);
    expect(index.notLiveResult).toBe(true);
    expect(index.notFinancialAdvice).toBe(true);
    expect(index.notProfitabilityClaim).toBe(true);
    expect(index.campaignName).toBe("campaign-1");
    expect(index.campaignDigest).toMatch(/^[0-9a-f]+$/);
    expect(index.digestAlgorithm).toMatch(/non-cryptographic/);
    expect(index.disclaimers.some((d) => /non-cryptographic/.test(d))).toBe(true);
    expect(index.disclaimers.some((d) => /No wallet, key, signing/.test(d))).toBe(true);
  });

  it("defaults campaignName to null and accepts zero runs", () => {
    const index = buildBacktestResearchCampaignIndex({ runs: [] });
    expect(index.campaignName).toBeNull();
    expect(index.runCount).toBe(0);
    expect(index.validRunCount).toBe(0);
    expect(index.invalidRunCount).toBe(0);
    expect(index.runs).toEqual([]);
    expect(index.warnings.some((w) => /indexes no runs/.test(w))).toBe(true);
  });

  it("summarizes a healthy run as valid with its run digest and counts", () => {
    const index = buildBacktestResearchCampaignIndex({ runs: [run("run-a")] });
    const summary = index.runs[0]!;
    expect(summary.runId).toBe("run-a");
    expect(summary.valid).toBe(true);
    expect(summary.complete).toBe(true);
    expect(summary.recognized).toBe(true);
    expect(summary.stable).toBe(true);
    expect(summary.bundleCandidateValid).toBe(true);
    expect(summary.manifestPresent).toBe(false);
    expect(summary.driftDetected).toBe(false);
    expect(summary.runDigest).toMatch(/^[0-9a-f]+$/);
    expect(summary.artifactCount).toBe(1);
    expect(summary.knownArtifactCount).toBe(1);
    expect(summary.unknownArtifactCount).toBe(0);
    expect(summary.buildError).toBeNull();
    expect(index.validRunCount).toBe(1);
    expect(index.invalidRunCount).toBe(0);
    expect(index.runsNeedingAttention).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = { campaignName: "c", runs: [run("b"), run("a")] };
    const snap = JSON.stringify(input);
    buildBacktestResearchCampaignIndex(input);
    expect(JSON.stringify(input)).toBe(snap);
  });

  it("carries no timestamp-like fields (no Date.now/Math.random dependence)", () => {
    const json = JSON.stringify(buildBacktestResearchCampaignIndex({ runs: [run("a")] }));
    expect(json).not.toMatch(/"generatedAt"|"createdAt"|"timestamp"|"ranAt"|"now"/);
  });

  it("does not embed artifact contents (only summaries + digests)", () => {
    const json = JSON.stringify(buildBacktestResearchCampaignIndex({ runs: [run("a")] }));
    expect(json).not.toContain('"content"');
  });
});

describe("buildBacktestResearchCampaignIndex — deterministic ordering + digest", () => {
  it("sorts runs by runId regardless of input order", () => {
    const index = buildBacktestResearchCampaignIndex({
      runs: [run("zeta"), run("alpha"), run("mike")],
    });
    expect(index.runs.map((r) => r.runId)).toEqual(["alpha", "mike", "zeta"]);
  });

  it("is byte-identical and digest-identical for the same runs in a different order", () => {
    const a = buildBacktestResearchCampaignIndex({
      campaignName: "c",
      runs: [run("b", { artifacts: [desc({ digest: "1" })] }), run("a", { artifacts: [desc({ digest: "2" })] })],
    });
    const b = buildBacktestResearchCampaignIndex({
      campaignName: "c",
      runs: [run("a", { artifacts: [desc({ digest: "2" })] }), run("b", { artifacts: [desc({ digest: "1" })] })],
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.campaignDigest).toBe(b.campaignDigest);
  });

  it("changes the campaign digest when ANY run's content digest changes", () => {
    const base = buildBacktestResearchCampaignIndex({ runs: [run("a", { artifacts: [desc({ digest: "1" })] })] });
    const next = buildBacktestResearchCampaignIndex({ runs: [run("a", { artifacts: [desc({ digest: "CHANGED" })] })] });
    expect(next.campaignDigest).not.toBe(base.campaignDigest);
  });

  it("changes the campaign digest when a run is ADDED", () => {
    const base = buildBacktestResearchCampaignIndex({ runs: [run("a")] });
    const next = buildBacktestResearchCampaignIndex({ runs: [run("a"), run("b")] });
    expect(next.campaignDigest).not.toBe(base.campaignDigest);
  });

  it("changes the campaign digest when a run is REMOVED", () => {
    const base = buildBacktestResearchCampaignIndex({ runs: [run("a"), run("b")] });
    const next = buildBacktestResearchCampaignIndex({ runs: [run("a")] });
    expect(next.campaignDigest).not.toBe(base.campaignDigest);
  });

  it("changes the campaign digest when a run's validity changes", () => {
    const valid = buildBacktestResearchCampaignIndex({ runs: [run("a")] });
    const invalid = buildBacktestResearchCampaignIndex({
      runs: [run("a", { artifacts: [desc({ kind: "unknown-json", schemaVersion: null, digest: "aaaaaaaaaaaaaaaa" })] })],
    });
    expect(invalid.campaignDigest).not.toBe(valid.campaignDigest);
  });
});

describe("buildBacktestResearchCampaignDigest — direct", () => {
  it("is order-independent and stable for the same run summaries", () => {
    const index = buildBacktestResearchCampaignIndex({ runs: [run("a"), run("b")] });
    const reversed = [...index.runs].reverse();
    expect(buildBacktestResearchCampaignDigest(reversed)).toBe(index.campaignDigest);
  });

  it("matches the index's own campaign digest", () => {
    const index = buildBacktestResearchCampaignIndex({ runs: [run("a"), run("b"), run("c")] });
    expect(buildBacktestResearchCampaignDigest(index.runs)).toBe(index.campaignDigest);
  });

  it("rejects a non-array input", () => {
    expect(() => buildBacktestResearchCampaignDigest("nope" as never)).toThrow(
      BacktestResearchCampaignIndexError,
    );
  });
});

describe("buildBacktestResearchCampaignIndex — valid/invalid accounting", () => {
  it("counts an unknown-artifact run as needing attention", () => {
    const index = buildBacktestResearchCampaignIndex({
      runs: [
        run("clean"),
        run("dirty", {
          artifacts: [desc({ path: "u.json", kind: "unknown-json", schemaVersion: null, digest: "u" })],
        }),
      ],
    });
    expect(index.validRunCount).toBe(1);
    expect(index.invalidRunCount).toBe(1);
    expect(index.runsNeedingAttention).toEqual(["dirty"]);
    const dirty = index.runs.find((r) => r.runId === "dirty")!;
    expect(dirty.recognized).toBe(false);
    expect(dirty.valid).toBe(false);
  });

  it("counts an empty (incomplete) run as needing attention", () => {
    const index = buildBacktestResearchCampaignIndex({ runs: [run("empty", { artifacts: [] })] });
    const empty = index.runs[0]!;
    expect(empty.complete).toBe(false);
    expect(empty.valid).toBe(false);
    expect(index.invalidRunCount).toBe(1);
  });

  it("aggregates unknown and malformed totals across runs", () => {
    const index = buildBacktestResearchCampaignIndex({
      runs: [
        run("a", { artifacts: [desc({ path: "u.json", kind: "unknown-json", schemaVersion: null, digest: "u" })] }),
        run("b", {
          artifacts: [desc({ path: "broken.json", kind: "unknown-json", schemaVersion: null, digest: "b" })],
          malformedPaths: ["broken.json"],
        }),
      ],
    });
    // run a: unknown=1, malformed=0 ; run b: unknown=1, malformed=1
    expect(index.totalUnknownArtifactCount).toBe(2);
    expect(index.totalMalformedArtifactCount).toBe(1);
    expect(index.totalArtifactCount).toBe(2);
    expect(index.totalKnownArtifactCount).toBe(0);
    expect(index.warnings.some((w) => /unparseable JSON \(malformed\)/.test(w))).toBe(true);
  });

  it("aggregates the kind counts and recognized schema set across runs", () => {
    const index = buildBacktestResearchCampaignIndex({
      runs: [
        run("a", {
          artifacts: [
            desc({ path: "r.report.json", kind: "backtest-report", schemaVersion: "backtest.report.v1", digest: "r" }),
            desc({ path: "s.scenario.json", kind: "scenario", schemaVersion: null, digest: "s" }),
          ],
        }),
        run("b", {
          artifacts: [desc({ path: "x.suite.json", kind: "suite-index", schemaVersion: "backtest.suite.v1", digest: "x" })],
        }),
      ],
    });
    expect(index.aggregateKindCounts).toEqual([
      { kind: "backtest-report", count: 1 },
      { kind: "scenario", count: 1 },
      { kind: "suite-index", count: 1 },
    ]);
    // scenario is recognized but unversioned → excluded from the recognized-schema set.
    expect(index.aggregateSchemaVersions).toEqual(["backtest.report.v1", "backtest.suite.v1"]);
  });

  it("detects manifest drift and marks the run as needing attention", () => {
    // Record a manifest over two artifacts, then present a directory missing one of them.
    const manifest = buildBacktestResearchManifest({
      runName: "drift",
      artifacts: [desc({ path: "a.json", digest: "1" }), desc({ path: "b.json", digest: "2" })],
    });
    const index = buildBacktestResearchCampaignIndex({
      runs: [run("drift", { artifacts: [desc({ path: "a.json", digest: "1" })], manifest })],
    });
    const summary = index.runs[0]!;
    expect(summary.manifestPresent).toBe(true);
    expect(summary.inSync).toBe(false);
    expect(summary.driftDetected).toBe(true);
    expect(summary.valid).toBe(false);
    expect(summary.warnings.some((w) => /manifest drift/.test(w))).toBe(true);
  });

  it("reports inSync (and stays valid) when the directory matches its manifest", () => {
    const artifacts = [desc({ path: "a.json", digest: "1" })];
    const manifest = buildBacktestResearchManifest({ runName: "ok", artifacts });
    const index = buildBacktestResearchCampaignIndex({
      runs: [run("ok", { artifacts, manifest })],
    });
    const summary = index.runs[0]!;
    expect(summary.manifestPresent).toBe(true);
    expect(summary.inSync).toBe(true);
    expect(summary.driftDetected).toBe(false);
    expect(summary.valid).toBe(true);
  });
});

describe("buildBacktestResearchCampaignIndex — errored run (captured, not crashed)", () => {
  it("captures a structurally bad descriptor as an invalid, errored run without crashing the campaign", () => {
    const index = buildBacktestResearchCampaignIndex({
      runs: [run("good"), run("bad", { artifacts: [desc({ path: "x.json", digest: "" })] })],
    });
    const bad = index.runs.find((r) => r.runId === "bad")!;
    expect(bad.buildError).toMatch(/digest must be a non-empty string/);
    expect(bad.valid).toBe(false);
    expect(bad.runDigest).toBeNull();
    expect(bad.artifactCount).toBe(0);
    expect(index.validRunCount).toBe(1);
    expect(index.invalidRunCount).toBe(1);
    expect(index.runsNeedingAttention).toContain("bad");
  });
});

describe("buildBacktestResearchCampaignIndex — strict input validation", () => {
  it("rejects a non-object input", () => {
    expect(() => buildBacktestResearchCampaignIndex(null as never)).toThrow(
      BacktestResearchCampaignIndexError,
    );
  });

  it("rejects a non-array runs", () => {
    expect(() => buildBacktestResearchCampaignIndex({ runs: "nope" } as never)).toThrow(
      /runs must be an array/,
    );
  });

  it("rejects a non-string campaignName", () => {
    expect(() =>
      buildBacktestResearchCampaignIndex({ campaignName: 7 as never, runs: [] }),
    ).toThrow(/campaignName must be a string/);
  });

  it("rejects a blank runId", () => {
    expect(() => buildBacktestResearchCampaignIndex({ runs: [run("")] })).toThrow(
      /runId must be a non-empty string/,
    );
  });

  it("rejects a duplicate runId", () => {
    expect(() => buildBacktestResearchCampaignIndex({ runs: [run("dup"), run("dup")] })).toThrow(
      /duplicate runId "dup"/,
    );
  });

  it("rejects a run with a non-array artifacts", () => {
    expect(() =>
      buildBacktestResearchCampaignIndex({ runs: [{ runId: "x", artifacts: "nope" } as never] }),
    ).toThrow(/artifacts must be an array/);
  });
});

describe("validateBacktestResearchCampaignIndex", () => {
  it("accepts a produced index round-tripped through JSON", () => {
    const index = buildBacktestResearchCampaignIndex({ campaignName: "c", runs: [run("a"), run("b")] });
    const round = JSON.parse(JSON.stringify(index));
    expect(validateBacktestResearchCampaignIndex(round)).toEqual(index);
  });

  it("rejects a wrong schema version and a missing safety flag", () => {
    const index = buildBacktestResearchCampaignIndex({ runs: [run("a")] });
    expect(() => validateBacktestResearchCampaignIndex({ ...index, schemaVersion: "x" })).toThrow(/schemaVersion/);
    expect(() => validateBacktestResearchCampaignIndex({ ...index, paperOnly: false })).toThrow(
      /paperOnly must be true/,
    );
  });

  it("rejects an empty campaign digest and a negative count", () => {
    const index = buildBacktestResearchCampaignIndex({ runs: [run("a")] });
    expect(() => validateBacktestResearchCampaignIndex({ ...index, campaignDigest: "" })).toThrow(/campaignDigest/);
    expect(() => validateBacktestResearchCampaignIndex({ ...index, runCount: -1 })).toThrow(
      /non-negative integer/,
    );
  });

  it("rejects inconsistent run counts and artifact totals", () => {
    const index = buildBacktestResearchCampaignIndex({ runs: [run("a")] });
    expect(() => validateBacktestResearchCampaignIndex({ ...index, validRunCount: 5 })).toThrow(
      /validRunCount \+ invalidRunCount must equal runCount/,
    );
    expect(() => validateBacktestResearchCampaignIndex({ ...index, totalKnownArtifactCount: 99 })).toThrow(
      /must equal totalArtifactCount/,
    );
  });

  it("rejects a runs array whose length disagrees with runCount", () => {
    const index = buildBacktestResearchCampaignIndex({ runs: [run("a")] });
    // Keep the count fields internally consistent (0+0=0) but disagree with the 1-element runs[].
    expect(() =>
      validateBacktestResearchCampaignIndex({
        ...index,
        runCount: 0,
        validRunCount: 0,
        invalidRunCount: 0,
      }),
    ).toThrow(/runs length must equal runCount/);
  });

  it("rejects a malformed run summary (bad kindCounts entry)", () => {
    const index = buildBacktestResearchCampaignIndex({ runs: [run("a")] });
    const bad = JSON.parse(JSON.stringify(index));
    bad.runs[0].kindCounts = [{ kind: "not-a-kind", count: 1 }];
    expect(() => validateBacktestResearchCampaignIndex(bad)).toThrow(/runs\[0\]\.kindCounts\[0\]/);
  });

  it("rejects a run summary whose known + unknown != artifactCount", () => {
    const index = buildBacktestResearchCampaignIndex({ runs: [run("a")] });
    const bad = JSON.parse(JSON.stringify(index));
    bad.runs[0].knownArtifactCount = 99;
    expect(() => validateBacktestResearchCampaignIndex(bad)).toThrow(/must equal artifactCount/);
  });

  it("rejects a non-string runsNeedingAttention entry", () => {
    const index = buildBacktestResearchCampaignIndex({ runs: [run("a")] });
    const bad = JSON.parse(JSON.stringify(index));
    bad.runsNeedingAttention = [7];
    expect(() => validateBacktestResearchCampaignIndex(bad)).toThrow(/runsNeedingAttention\[0\]/);
  });
});

describe("formatBacktestResearchCampaignIndex", () => {
  it("leads with the banner and carries the PAPER-ONLY disclaimers, campaign digest, and digest honesty", () => {
    const index = buildBacktestResearchCampaignIndex({ campaignName: "camp", runs: [run("run-a")] });
    const text = formatBacktestResearchCampaignIndex(index, { label: "campaign/" });
    expect(text.startsWith(BACKTEST_RESEARCH_CAMPAIGN_INDEX_BANNER)).toBe(true);
    expect(text).toContain("dir:            campaign/");
    expect(text).toContain(`campaignDigest: ${index.campaignDigest}`);
    expect(text.toLowerCase()).toContain("not a live result");
    expect(text.toLowerCase()).toContain("not a profitability claim");
    expect(text).toContain("non-cryptographic");
    expect(text).toContain("run-a");
  });

  it("lists runs needing attention and marks an errored run as ERROR", () => {
    const index = buildBacktestResearchCampaignIndex({
      runs: [run("ok"), run("bad", { artifacts: [desc({ path: "x.json", digest: "" })] })],
    });
    const text = formatBacktestResearchCampaignIndex(index);
    expect(text).toContain("Needs attention:");
    expect(text).toContain("- bad");
    expect(text).toContain("[ERROR]");
  });

  it("summarizes a long run list instead of dumping every row", () => {
    const runs = Array.from({ length: 120 }, (_, i) => run(`run-${String(i).padStart(3, "0")}`));
    const index = buildBacktestResearchCampaignIndex({ runs });
    const text = formatBacktestResearchCampaignIndex(index, { maxRunRows: 10 });
    expect(text).toContain("and 110 more");
  });
});
