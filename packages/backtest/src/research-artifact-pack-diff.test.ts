/**
 * Tests for the Sprint 24 RESEARCH ARTIFACT PACK DIFF. Everything here is INJECTED test data — fake
 * campaign ids, fake run ids, made-up digests — exercised purely offline. Each artifact pack is built
 * through the real production builders (campaign index → history → portfolio → portfolio diff, plus a
 * real manifest) collected via the real pack builder, then two packs are diffed. Nothing here is real
 * market data, a live result, or a profitability claim.
 */

import { describe, it, expect } from "vitest";
import { REDACTED } from "@soulmaker/security";
import {
  diffBacktestResearchArtifactPacks,
  validateBacktestResearchArtifactPackDiff,
  formatBacktestResearchArtifactPackDiff,
  BacktestResearchArtifactPackDiffError,
  BACKTEST_RESEARCH_ARTIFACT_PACK_DIFF_SCHEMA_VERSION,
  BACKTEST_RESEARCH_ARTIFACT_PACK_DIFF_BANNER,
  type BacktestResearchArtifactPackDiff,
} from "./research-artifact-pack-diff.js";
import {
  buildBacktestResearchArtifactPack,
  type BacktestResearchArtifactPack,
  type BacktestResearchArtifactPackInput,
} from "./research-artifact-pack.js";
import { buildBacktestResearchPortfolioReport } from "./research-portfolio.js";
import { diffBacktestResearchPortfolioReports } from "./research-portfolio-diff.js";
import { buildBacktestResearchCampaignHistoryReport } from "./research-campaign-history.js";
import {
  buildBacktestResearchCampaignIndex,
  type BacktestResearchCampaignRunInput,
} from "./research-campaign-index.js";
import { buildBacktestResearchManifest } from "./research-manifest.js";
import type { BacktestArtifactDescriptor } from "./research-manifest.js";

// --- fixtures (all injected, offline; real production builders) ---------------

function desc(over: Partial<BacktestArtifactDescriptor> = {}): BacktestArtifactDescriptor {
  return { path: "a.report.json", kind: "backtest-report", schemaVersion: "backtest.report.v1", digest: "d1", sizeBytes: 100, ...over };
}
const okRun = (runId: string, digest = "d1"): BacktestResearchCampaignRunInput => ({ runId, artifacts: [desc({ digest })] });
const badRun = (runId: string): BacktestResearchCampaignRunInput => ({ runId, artifacts: [desc({ path: "u.json", kind: "unknown-json", schemaVersion: null, digest: "u" })] });
const idx = (runs: BacktestResearchCampaignRunInput[]) => buildBacktestResearchCampaignIndex({ campaignName: "c", runs });
const hist = (snaps: BacktestResearchCampaignRunInput[][]) =>
  buildBacktestResearchCampaignHistoryReport({ snapshots: snaps.map((runs, i) => ({ snapshotId: `s${i}`, index: idx(runs) })) });
const pc = (campaignId: string, report: unknown) => ({ campaignId, report });
const portfolio = (campaigns: { campaignId: string; report: unknown }[], name?: string) =>
  buildBacktestResearchPortfolioReport(name === undefined ? { campaigns } : { portfolioName: name, campaigns });

const manifestArtifact = () => buildBacktestResearchManifest({ artifacts: [desc()] });
const campaignIndexClean = () => idx([okRun("a")]);
const campaignIndexAttention = () => idx([okRun("a"), badRun("b")]); // an invalid run -> runsNeedingAttention
const historyClean = () => hist([[okRun("a")], [okRun("a")]]);
const historyRegressed = () => hist([[okRun("a", "1")], [okRun("a", "2")]]); // digest change -> regression
const historyNewAttention = () => hist([[okRun("a")], [okRun("a"), badRun("b")]]); // new invalid run -> attention + new-attention
const portfolioClean = () => portfolio([pc("alpha", historyClean())]);
const portfolioRegressed = () => portfolio([pc("alpha", historyRegressed())]);
const portfolioDiffNoChange = () => diffBacktestResearchPortfolioReports(portfolioClean(), portfolioClean());
const portfolioDiffRegression = () => diffBacktestResearchPortfolioReports(portfolioClean(), portfolioRegressed());
const portfolioDiffRecovery = () => diffBacktestResearchPortfolioReports(portfolioRegressed(), portfolioClean());
const unsupported = (v = "backtest.unknown.v9") => ({ schemaVersion: v, foo: 1 });

const art = (label: string, value: unknown, sourceLabel?: string): BacktestResearchArtifactPackInput => ({ label, value, sourceLabel });
const pack = (artifacts: BacktestResearchArtifactPackInput[], name?: string): BacktestResearchArtifactPack =>
  buildBacktestResearchArtifactPack(name === undefined ? { artifacts } : { packName: name, artifacts });
const diff = (b: BacktestResearchArtifactPack, n: BacktestResearchArtifactPack) =>
  diffBacktestResearchArtifactPacks(b, n);

describe("diffBacktestResearchArtifactPacks — unchanged", () => {
  it("reports no change for two identical packs and carries PAPER-ONLY labelling", () => {
    const d = diff(pack([art("pf", portfolioClean())]), pack([art("pf", portfolioClean())]));
    expect(d.schemaVersion).toBe(BACKTEST_RESEARCH_ARTIFACT_PACK_DIFF_SCHEMA_VERSION);
    expect(d.banner).toBe(BACKTEST_RESEARCH_ARTIFACT_PACK_DIFF_BANNER);
    expect(d.paperOnly).toBe(true);
    expect(d.notLiveResult).toBe(true);
    expect(d.hasChange).toBe(false);
    expect(d.hasArtifactSetChange).toBe(false);
    expect(d.hasRegression).toBe(false);
    expect(d.hasAttention).toBe(false);
    expect(d.hasUnsupported).toBe(false);
    expect(d.hasRecovery).toBe(false);
    expect(d.addedArtifacts).toEqual([]);
    expect(d.removedArtifacts).toEqual([]);
    expect(d.changedArtifacts).toEqual([]);
    expect(d.commonArtifactLabels).toEqual(["pf"]);
    expect(d.ciFailReasons).toEqual([]);
    expect(() => validateBacktestResearchArtifactPackDiff(d)).not.toThrow();
  });
});

describe("diffBacktestResearchArtifactPacks — artifact-set membership", () => {
  it("detects an added artifact as a change (not a regression even if it arrives regressed)", () => {
    const b = pack([art("pf", portfolioClean())]);
    const n = pack([art("pf", portfolioClean()), art("pd", portfolioDiffRegression())]);
    const d = diff(b, n);
    expect(d.addedArtifacts.map((r) => r.label)).toEqual(["pd"]);
    expect(d.removedArtifacts).toEqual([]);
    expect(d.hasArtifactSetChange).toBe(true);
    expect(d.hasChange).toBe(true);
    // The added pd arrives carrying a regression, but there is no base state to regress FROM.
    expect(d.hasRegression).toBe(false);
    expect(d.newlyRegressedArtifacts).toEqual([]);
    expect(d.addedArtifacts[0]!.hasRegression).toBe(true);
    expect(d.changeReasons.some((r) => /arrive carrying a conservative regression/.test(r))).toBe(true);
    expect(d.wouldFailOnChange).toBe(true);
    expect(d.wouldFailOnRegression).toBe(false);
  });

  it("detects a removed artifact as a change (not a regression)", () => {
    const b = pack([art("pf", portfolioClean()), art("pd", portfolioDiffRegression())]);
    const n = pack([art("pf", portfolioClean())]);
    const d = diff(b, n);
    expect(d.removedArtifacts.map((r) => r.label)).toEqual(["pd"]);
    expect(d.hasArtifactSetChange).toBe(true);
    expect(d.hasChange).toBe(true);
    expect(d.hasRegression).toBe(false);
  });

  it("carries the kind/status/flags of added and removed refs", () => {
    const b = pack([art("m", manifestArtifact())]);
    const n = pack([art("m", manifestArtifact()), art("pd", portfolioDiffRecovery())]);
    const d = diff(b, n);
    const ref = d.addedArtifacts.find((r) => r.label === "pd")!;
    expect(ref.kind).toBe("portfolio-diff");
    expect(ref.recognized).toBe(true);
    expect(ref.hasRecovery).toBe(true);
  });
});

describe("diffBacktestResearchArtifactPacks — common-set transitions", () => {
  it("detects a newly-regressed common artifact", () => {
    const d = diff(pack([art("hist", historyClean())]), pack([art("hist", historyRegressed())]));
    expect(d.newlyRegressedArtifacts).toEqual(["hist"]);
    expect(d.hasRegression).toBe(true);
    expect(d.hasChange).toBe(true);
    expect(d.statusChangedArtifacts).toEqual(["hist"]);
    expect(d.changedArtifacts.map((c) => c.label)).toEqual(["hist"]);
    expect(d.regressionReasons.length).toBeGreaterThan(0);
    expect(d.wouldFailOnRegression).toBe(true);
  });

  it("detects recovery from regression on a common artifact", () => {
    const d = diff(pack([art("hist", historyRegressed())]), pack([art("hist", historyClean())]));
    expect(d.recoveredFromRegressionArtifacts).toEqual(["hist"]);
    expect(d.newlyRegressedArtifacts).toEqual([]);
    expect(d.hasRegression).toBe(false);
    expect(d.hasRecovery).toBe(true);
    expect(d.hasChange).toBe(true);
  });

  it("detects newly-needed attention on a common artifact", () => {
    const d = diff(pack([art("ci", campaignIndexClean())]), pack([art("ci", campaignIndexAttention())]));
    expect(d.newlyNeedingAttentionArtifacts).toEqual(["ci"]);
    expect(d.hasAttention).toBe(true);
    expect(d.wouldFailOnAttention).toBe(true);
  });

  it("detects attention clearing as a recovery (no longer needs attention)", () => {
    const d = diff(pack([art("ci", campaignIndexAttention())]), pack([art("ci", campaignIndexClean())]));
    expect(d.noLongerNeedingAttentionArtifacts).toEqual(["ci"]);
    expect(d.hasAttention).toBe(false);
    expect(d.hasRecovery).toBe(true);
  });

  it("detects newly-needed new-attention (folding both new-attention flags)", () => {
    const d = diff(pack([art("hist", historyClean())]), pack([art("hist", historyNewAttention())]));
    expect(d.newlyNeedingNewAttentionArtifacts).toEqual(["hist"]);
    expect(d.hasNewAttention).toBe(true);
    expect(d.wouldFailOnNewAttention).toBe(true);
  });

  it("detects a newly-changed common artifact without a regression", () => {
    const d = diff(pack([art("pd", portfolioDiffNoChange())]), pack([art("pd", portfolioDiffRecovery())]));
    expect(d.newlyChangedArtifacts).toEqual(["pd"]);
    expect(d.newlyRegressedArtifacts).toEqual([]);
    expect(d.hasChange).toBe(true);
    expect(d.hasRegression).toBe(false);
  });

  it("detects a status change on a common artifact", () => {
    const d = diff(pack([art("ci", campaignIndexClean())]), pack([art("ci", campaignIndexAttention())]));
    const change = d.changedArtifacts.find((c) => c.label === "ci")!;
    expect(change.statusChanged).toBe(true);
    expect(change.baseStatus).toBe("ok");
    expect(change.nextStatus).toBe("attention");
  });
});

describe("diffBacktestResearchArtifactPacks — unsupported transitions", () => {
  it("detects a common artifact that became unsupported (recognized -> unsupported)", () => {
    const b = pack([art("pf", portfolioClean()), art("x", portfolioClean())]);
    const n = pack([art("pf", portfolioClean()), art("x", unsupported())]);
    const d = diff(b, n);
    expect(d.newlyUnsupportedArtifacts).toEqual(["x"]);
    expect(d.hasUnsupported).toBe(true);
    expect(d.wouldFailOnUnsupported).toBe(true);
    expect(d.ciFailReasons.some((r) => /unsupported artifact/.test(r))).toBe(true);
  });

  it("detects a common artifact that regained recognition (unsupported -> recognized) as recovery", () => {
    const b = pack([art("pf", portfolioClean()), art("x", unsupported())]);
    const n = pack([art("pf", portfolioClean()), art("x", portfolioClean())]);
    const d = diff(b, n);
    expect(d.noLongerUnsupportedArtifacts).toEqual(["x"]);
    expect(d.hasUnsupported).toBe(false);
    expect(d.hasRecovery).toBe(true);
  });

  it("treats an added unsupported artifact as newly present unsupported (fail-on-unsupported)", () => {
    const b = pack([art("pf", portfolioClean())]);
    const n = pack([art("pf", portfolioClean()), art("weird", unsupported("vendor.x.v3"))]);
    const d = diff(b, n);
    expect(d.addedUnsupportedArtifacts).toEqual(["weird"]);
    expect(d.hasUnsupported).toBe(true);
    expect(d.wouldFailOnUnsupported).toBe(true);
    // ...and it is also an artifact-set change.
    expect(d.hasArtifactSetChange).toBe(true);
    expect(d.hasChange).toBe(true);
  });

  it("does NOT treat a removed unsupported artifact as newly unsupported", () => {
    const b = pack([art("pf", portfolioClean()), art("weird", unsupported())]);
    const n = pack([art("pf", portfolioClean())]);
    const d = diff(b, n);
    expect(d.hasUnsupported).toBe(false);
    expect(d.newlyUnsupportedArtifacts).toEqual([]);
    expect(d.addedUnsupportedArtifacts).toEqual([]);
    expect(d.removedArtifacts.map((r) => r.label)).toEqual(["weird"]);
  });
});

describe("diffBacktestResearchArtifactPacks — aggregate deltas + chain coverage", () => {
  it("reports aggregate count deltas read straight off the packs", () => {
    const b = pack([art("ci", campaignIndexClean())]);
    const n = pack([art("ci", campaignIndexClean()), art("hist", historyClean()), art("pf", portfolioClean()), art("pd", portfolioDiffRegression())]);
    const d = diff(b, n);
    expect(d.artifactCount).toEqual({ base: 1, next: 4, delta: 3 });
    expect(d.recognizedCount.delta).toBe(3);
    expect(d.artifactsWithRegression.delta).toBe(1);
  });

  it("reports chain-coverage tier transitions and newly-present recommended layers", () => {
    const b = pack([art("ci", campaignIndexClean())]); // campaign-level only
    const n = pack([
      art("ci", campaignIndexClean()),
      art("hist", historyClean()),
      art("pf", portfolioClean()),
      art("pd", portfolioDiffRegression()),
    ]);
    const d = diff(b, n);
    expect(d.isPortfolioLevel).toEqual({ base: false, next: true, changed: true });
    expect(d.isDiffReady.changed).toBe(true);
    expect(d.kindsAdded).toContain("portfolio-report");
    expect(d.recommendedLayersNewlyPresent).toContain("portfolio-report");
    expect(d.recommendedLayersNewlyMissing).toEqual([]);
  });

  it("reports recommended layers newly missing when coverage shrinks", () => {
    const full = () => [
      art("ci", campaignIndexClean()),
      art("hist", historyClean()),
      art("pf", portfolioClean()),
      art("pd", portfolioDiffRegression()),
    ];
    const b = pack(full());
    const n = pack([art("ci", campaignIndexClean())]);
    const d = diff(b, n);
    expect(d.recommendedLayersNewlyMissing).toContain("portfolio-report");
    expect(d.recommendedLayersNewlyMissing).toContain("portfolio-diff");
  });
});

describe("diffBacktestResearchArtifactPacks — determinism + no mutation", () => {
  it("is byte-stable for a given pair and carries no timestamp", () => {
    const b = pack([art("hist", historyClean()), art("ci", campaignIndexClean())]);
    const n = pack([art("hist", historyRegressed()), art("ci", campaignIndexAttention())]);
    const first = JSON.stringify(diff(b, n));
    const second = JSON.stringify(diff(b, n));
    expect(first).toBe(second);
    expect(first).not.toMatch(/"generatedAt"|"createdAt"|"timestamp"|"ranAt"/);
  });

  it("sorts every emitted list by label ascending", () => {
    const b = pack([art("a", portfolioClean())]);
    const n = pack([art("a", portfolioClean()), art("zeta", manifestArtifact()), art("mid", campaignIndexClean())]);
    const d = diff(b, n);
    expect(d.addedArtifacts.map((r) => r.label)).toEqual(["mid", "zeta"]);
    expect(d.nextArtifactLabels).toEqual(["a", "mid", "zeta"]);
  });

  it("does not mutate its input packs", () => {
    const b = pack([art("hist", historyClean())]);
    const n = pack([art("hist", historyRegressed())]);
    const beforeB = JSON.stringify(b);
    const beforeN = JSON.stringify(n);
    diff(b, n);
    expect(JSON.stringify(b)).toBe(beforeB);
    expect(JSON.stringify(n)).toBe(beforeN);
  });
});

describe("diffBacktestResearchArtifactPacks — input rejection", () => {
  it("refuses a base that is not an artifact pack (wrong schema)", () => {
    expect(() => diffBacktestResearchArtifactPacks(portfolioClean(), pack([art("pf", portfolioClean())]))).toThrow(
      /base artifact pack is invalid/,
    );
  });

  it("refuses a next that is not an artifact pack (wrong schema)", () => {
    expect(() => diffBacktestResearchArtifactPacks(pack([art("pf", portfolioClean())]), { schemaVersion: "x.y.v1" })).toThrow(
      BacktestResearchArtifactPackDiffError,
    );
  });

  it("refuses a non-object input", () => {
    expect(() => diffBacktestResearchArtifactPacks(null, pack([art("pf", portfolioClean())]))).toThrow(
      BacktestResearchArtifactPackDiffError,
    );
  });

  it("refuses a pack with duplicate artifact labels", () => {
    const p = JSON.parse(JSON.stringify(pack([art("pf", portfolioClean()), art("ci", campaignIndexClean())]))) as BacktestResearchArtifactPack;
    // The builder sorts by label (ci, pf); force a duplicate by relabelling the first entry.
    p.artifacts[0]!.label = "pf";
    expect(() => diffBacktestResearchArtifactPacks(p, pack([art("pf", portfolioClean())]))).toThrow(/duplicate artifact labels/);
  });
});

describe("validateBacktestResearchArtifactPackDiff", () => {
  const sample = () =>
    diff(
      pack([art("pf", portfolioClean()), art("x", portfolioClean())]),
      pack([art("pf", portfolioClean()), art("x", unsupported()), art("pd", portfolioDiffRegression())]),
    );

  it("accepts a freshly-built diff (round-trips through JSON)", () => {
    const d = sample();
    expect(() => validateBacktestResearchArtifactPackDiff(d)).not.toThrow();
    expect(() => validateBacktestResearchArtifactPackDiff(JSON.parse(JSON.stringify(d)))).not.toThrow();
  });

  it("rejects a non-object and a wrong schemaVersion", () => {
    expect(() => validateBacktestResearchArtifactPackDiff(null)).toThrow(BacktestResearchArtifactPackDiffError);
    const d = JSON.parse(JSON.stringify(sample())) as { schemaVersion: string };
    d.schemaVersion = "backtest.research.artifact.pack.diff.v2";
    expect(() => validateBacktestResearchArtifactPackDiff(d)).toThrow(/schemaVersion/);
  });

  it("rejects a CI gate that does not mirror its flag", () => {
    const d = JSON.parse(JSON.stringify(sample())) as BacktestResearchArtifactPackDiff;
    d.wouldFailOnUnsupported = !d.hasUnsupported;
    expect(() => validateBacktestResearchArtifactPackDiff(d)).toThrow(/must mirror/);
  });

  it("rejects a number delta that is not {base,next,delta}", () => {
    const d = JSON.parse(JSON.stringify(sample())) as Record<string, unknown>;
    d.artifactCount = { base: 1, next: 2 }; // missing delta
    expect(() => validateBacktestResearchArtifactPackDiff(d)).toThrow(/number delta/);
  });

  it("rejects a coverage tier that is not a {base,next,changed} transition", () => {
    const d = JSON.parse(JSON.stringify(sample())) as Record<string, unknown>;
    d.isDiffReady = { base: true, next: false }; // missing changed
    expect(() => validateBacktestResearchArtifactPackDiff(d)).toThrow(/transition/);
  });
});

describe("formatBacktestResearchArtifactPackDiff", () => {
  it("renders a stable, sectioned PAPER-ONLY human report", () => {
    const d = diff(
      pack([art("hist", historyClean()), art("ci", campaignIndexClean())]),
      pack([art("hist", historyRegressed()), art("ci", campaignIndexAttention())]),
    );
    const text = formatBacktestResearchArtifactPackDiff(d);
    expect(text).toBe(formatBacktestResearchArtifactPackDiff(d)); // deterministic
    expect(text).toContain(BACKTEST_RESEARCH_ARTIFACT_PACK_DIFF_BANNER);
    expect(text).toContain("PAPER ONLY");
    expect(text).toContain("Regression: YES");
    expect(text).toContain("Transitions (common artifacts):");
    expect(text.toLowerCase()).toContain("not a live result");
  });

  it("routes the whole output through the shared redactor (no raw unsafe strings leak)", () => {
    const secretish = "a".repeat(64); // a 64-char hex-looking token the redactor must mask
    const b = pack([art("pf", portfolioClean())], secretish);
    const n = pack([art("pf", portfolioClean())], secretish);
    const text = formatBacktestResearchArtifactPackDiff(diff(b, n));
    expect(text).toContain(REDACTED);
    expect(text).not.toContain(secretish);
  });
});
