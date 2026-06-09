/**
 * Tests for the Sprint 23 RESEARCH ARTIFACT PACK. Everything here is INJECTED test data — fake
 * campaign ids, fake run ids, made-up digests — exercised purely offline. Each artifact is built
 * through the real production builders (campaign index → history → portfolio → portfolio diff, plus a
 * real manifest) and then collected into a pack. Nothing here is real market data, a live result, or
 * a profitability claim.
 */

import { describe, it, expect } from "vitest";
import { REDACTED } from "@soulmaker/security";
import {
  buildBacktestResearchArtifactPack,
  validateBacktestResearchArtifactPack,
  formatBacktestResearchArtifactPack,
  BacktestResearchArtifactPackError,
  BACKTEST_RESEARCH_ARTIFACT_PACK_SCHEMA_VERSION,
  BACKTEST_RESEARCH_ARTIFACT_PACK_BANNER,
  BACKTEST_RESEARCH_ARTIFACT_PACK_RECOMMENDED_LAYERS,
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

// Real artifacts of each kind we want to cover.
const manifestArtifact = () => buildBacktestResearchManifest({ artifacts: [desc()] });
const campaignIndexClean = () => idx([okRun("a")]);
const campaignIndexAttention = () => idx([okRun("a"), badRun("b")]); // an invalid run -> runsNeedingAttention
const historyClean = () => hist([[okRun("a")], [okRun("a")]]);
const historyRegressed = () => hist([[okRun("a", "1")], [okRun("a", "2")]]); // digest change -> regression
const historyNewAttention = () => hist([[okRun("a")], [okRun("a"), badRun("b")]]); // new invalid run -> attention + new-attention
const portfolioClean = () => portfolio([pc("alpha", historyClean())]);
const portfolioRegressed = () => portfolio([pc("alpha", historyRegressed())]);
const portfolioDiffRegression = () => diffBacktestResearchPortfolioReports(portfolioClean(), portfolioRegressed());
const portfolioDiffRecovery = () => diffBacktestResearchPortfolioReports(portfolioRegressed(), portfolioClean());

const art = (label: string, value: unknown, sourceLabel?: string): BacktestResearchArtifactPackInput => ({ label, value, sourceLabel });
const pack = (artifacts: BacktestResearchArtifactPackInput[], name?: string) =>
  buildBacktestResearchArtifactPack(name === undefined ? { artifacts } : { packName: name, artifacts });

describe("buildBacktestResearchArtifactPack — basics + coverage tiers", () => {
  it("builds a minimal pack from one artifact and carries the PAPER-ONLY labelling", () => {
    const p = pack([art("m", manifestArtifact())]);
    expect(p.schemaVersion).toBe(BACKTEST_RESEARCH_ARTIFACT_PACK_SCHEMA_VERSION);
    expect(p.banner).toBe(BACKTEST_RESEARCH_ARTIFACT_PACK_BANNER);
    expect(p.paperOnly).toBe(true);
    expect(p.notLiveResult).toBe(true);
    expect(p.artifactCount).toBe(1);
    expect(p.recognizedCount).toBe(1);
    expect(p.unsupportedCount).toBe(0);
    expect(p.presentKinds).toEqual(["manifest"]);
    expect(p.isMinimal).toBe(true);
    expect(p.isCampaignLevel).toBe(false);
    expect(p.isPortfolioLevel).toBe(false);
    expect(p.isDiffReady).toBe(false);
    expect(() => validateBacktestResearchArtifactPack(p)).not.toThrow();
  });

  it("recognizes campaign-level artifacts", () => {
    const p = pack([art("ci", campaignIndexClean()), art("hist", historyClean())]);
    expect(p.presentKinds).toEqual(["campaign-history", "campaign-index"]);
    expect(p.isCampaignLevel).toBe(true);
    expect(p.isPortfolioLevel).toBe(false);
    expect(p.isDiffReady).toBe(false);
  });

  it("recognizes portfolio-level artifacts", () => {
    const p = pack([art("pf", portfolioClean())]);
    expect(p.presentKinds).toEqual(["portfolio-report"]);
    expect(p.isPortfolioLevel).toBe(true);
  });

  it("recognizes a portfolio diff with a regression and is diff-ready", () => {
    const p = pack([art("pd", portfolioDiffRegression())]);
    const entry = p.artifacts.find((e) => e.label === "pd")!;
    expect(entry.kind).toBe("portfolio-diff");
    expect(entry.recognized).toBe(true);
    expect(entry.status).toBe("regression");
    expect(entry.flags.hasRegression).toBe(true);
    expect(entry.flags.hasChange).toBe(true);
    expect(p.hasRegression).toBe(true);
    expect(p.hasChange).toBe(true);
    expect(p.artifactsWithRegression).toBe(1);
    expect(p.isDiffReady).toBe(true);
    expect(p.wouldFailOnRegression).toBe(true);
  });
});

describe("buildBacktestResearchArtifactPack — flag detection", () => {
  it("detects change / regression / attention / new-attention across a mixed pack", () => {
    const p = pack([
      art("ci", campaignIndexAttention()), // attention (an invalid run)
      art("hist", historyNewAttention()), // attention + new-attention-since-baseline (+regression)
      art("pd", portfolioDiffRegression()), // change + regression
    ]);
    expect(p.hasChange).toBe(true);
    expect(p.hasRegression).toBe(true);
    expect(p.hasAttention).toBe(true);
    expect(p.hasNewAttention).toBe(true);
    expect(p.wouldFailOnChange).toBe(true);
    expect(p.wouldFailOnAttention).toBe(true);
    expect(p.wouldFailOnNewAttention).toBe(true);
  });

  it("detects a recovery flag from a portfolio diff", () => {
    const p = pack([art("pd", portfolioDiffRecovery())]);
    const entry = p.artifacts[0]!;
    expect(entry.flags.hasRecovery).toBe(true);
    expect(p.hasRecovery).toBe(true);
    expect(p.artifactsWithRecovery).toBe(1);
  });

  it("counts clean artifacts (no integrity concern) honestly", () => {
    const p = pack([art("ci", campaignIndexClean()), art("hist", historyClean()), art("pf", portfolioClean())]);
    expect(p.hasRegression).toBe(false);
    expect(p.hasAttention).toBe(false);
    expect(p.cleanArtifactCount).toBe(3);
  });
});

describe("buildBacktestResearchArtifactPack — chain coverage", () => {
  it("flags missing recommended layers for a thin pack", () => {
    const p = pack([art("m", manifestArtifact())]);
    expect(p.hasMissingRecommendedLayer).toBe(true);
    expect(p.missingRecommendedLayers).toEqual([...BACKTEST_RESEARCH_ARTIFACT_PACK_RECOMMENDED_LAYERS]);
    expect(p.presentRecommendedLayers).toEqual([]);
  });

  it("reports no missing recommended layers when all four are present", () => {
    const p = pack([
      art("ci", campaignIndexClean()),
      art("hist", historyClean()),
      art("pf", portfolioClean()),
      art("pd", portfolioDiffRegression()),
    ]);
    expect(p.missingRecommendedLayers).toEqual([]);
    expect(p.hasMissingRecommendedLayer).toBe(false);
    expect(p.presentRecommendedLayers).toEqual([...BACKTEST_RESEARCH_ARTIFACT_PACK_RECOMMENDED_LAYERS]);
    expect(p.isMinimal && p.isCampaignLevel && p.isPortfolioLevel && p.isDiffReady).toBe(true);
  });
});

describe("buildBacktestResearchArtifactPack — unsupported + rejection", () => {
  it("reports an unknown schema as an unsupported entry (does not refuse)", () => {
    const p = pack([art("pf", portfolioClean()), art("weird", { schemaVersion: "backtest.unknown.v9", foo: 1 })]);
    const u = p.artifacts.find((e) => e.label === "weird")!;
    expect(u.kind).toBe("unsupported");
    expect(u.recognized).toBe(false);
    expect(u.status).toBe("unsupported");
    expect(p.recognizedCount).toBe(1);
    expect(p.unsupportedCount).toBe(1);
    expect(p.hasUnsupportedArtifact).toBe(true);
    expect(p.wouldFailOnUnsupported).toBe(true);
  });

  it("rejects an empty artifact list", () => {
    expect(() => pack([])).toThrow(/at least one artifact/);
  });

  it("rejects a duplicate label", () => {
    expect(() => pack([art("x", manifestArtifact()), art("x", campaignIndexClean())])).toThrow(/duplicate artifact label "x"/);
  });

  it("rejects an artifact with no schemaVersion", () => {
    expect(() => pack([art("bad", { notASchema: true })])).toThrow(/no schemaVersion/);
  });

  it("rejects an artifact whose value is not an object", () => {
    expect(() => pack([art("bad", "not-an-object")])).toThrow(/must be a JSON object/);
  });

  it("rejects a corrupt artifact that claims a known schema but fails validation", () => {
    const corrupt = JSON.parse(JSON.stringify(portfolioClean())) as { campaignCount: unknown };
    corrupt.campaignCount = "oops"; // break a validated field while keeping the schemaVersion
    expect(() => pack([art("pf", corrupt)])).toThrow(/claims schema .* but is invalid/);
  });
});

describe("buildBacktestResearchArtifactPack — determinism + no mutation", () => {
  it("is byte-stable and independent of the supplied artifact order", () => {
    const a = art("ci", campaignIndexClean());
    const b = art("pd", portfolioDiffRegression());
    const c = art("hist", historyNewAttention());
    const forward = JSON.stringify(pack([a, b, c]));
    const shuffled = JSON.stringify(pack([c, a, b]));
    expect(forward).toBe(shuffled);
    expect(forward).not.toMatch(/"generatedAt"|"createdAt"|"timestamp"|"ranAt"/);
  });

  it("sorts the inventory and navigation by label", () => {
    const p = pack([art("zeta", manifestArtifact()), art("alpha", portfolioClean()), art("mid", campaignIndexClean())]);
    expect(p.artifacts.map((e) => e.label)).toEqual(["alpha", "mid", "zeta"]);
    expect(p.navigation.map((n) => n.label)).toEqual(["alpha", "mid", "zeta"]);
    expect(p.artifactLabels).toEqual(["alpha", "mid", "zeta"]);
  });

  it("does not mutate its input artifacts", () => {
    const value = portfolioDiffRegression();
    const before = JSON.stringify(value);
    buildBacktestResearchArtifactPack({ artifacts: [{ label: "pd", value }] });
    expect(JSON.stringify(value)).toBe(before);
  });
});

describe("validateBacktestResearchArtifactPack", () => {
  const sample = () =>
    pack([art("pf", portfolioClean()), art("pd", portfolioDiffRegression()), art("u", { schemaVersion: "x.y.v1" })]);

  it("accepts a freshly-built pack (round-trips through JSON)", () => {
    const p = sample();
    expect(() => validateBacktestResearchArtifactPack(p)).not.toThrow();
    expect(() => validateBacktestResearchArtifactPack(JSON.parse(JSON.stringify(p)))).not.toThrow();
  });

  it("rejects a non-object and a wrong schemaVersion", () => {
    expect(() => validateBacktestResearchArtifactPack(null)).toThrow(BacktestResearchArtifactPackError);
    const p = JSON.parse(JSON.stringify(sample())) as { schemaVersion: string };
    p.schemaVersion = "backtest.research.artifact.pack.v2";
    expect(() => validateBacktestResearchArtifactPack(p)).toThrow(/schemaVersion/);
  });

  it("rejects a CI gate that does not mirror its flag", () => {
    const p = JSON.parse(JSON.stringify(sample())) as BacktestResearchArtifactPack;
    p.wouldFailOnUnsupported = !p.hasUnsupportedArtifact;
    expect(() => validateBacktestResearchArtifactPack(p)).toThrow(/must mirror/);
  });

  it("rejects an entry whose flags are not boolean|null", () => {
    const p = JSON.parse(JSON.stringify(sample())) as BacktestResearchArtifactPack;
    (p.artifacts[0]!.flags as unknown as Record<string, unknown>).hasChange = "yes";
    expect(() => validateBacktestResearchArtifactPack(p)).toThrow(/must be a boolean or null/);
  });

  it("rejects an artifactCount that disagrees with the inventory length", () => {
    const p = JSON.parse(JSON.stringify(sample())) as { artifactCount: number };
    p.artifactCount = 99;
    expect(() => validateBacktestResearchArtifactPack(p)).toThrow(/length must equal artifactCount/);
  });
});

describe("formatBacktestResearchArtifactPack", () => {
  it("renders a stable, sectioned PAPER-ONLY human report", () => {
    const p = pack([art("pf", portfolioClean()), art("pd", portfolioDiffRegression()), art("u", { schemaVersion: "x.y.v1" })]);
    const text = formatBacktestResearchArtifactPack(p);
    expect(text).toBe(formatBacktestResearchArtifactPack(p)); // deterministic
    expect(text).toContain(BACKTEST_RESEARCH_ARTIFACT_PACK_BANNER);
    expect(text).toContain("PAPER ONLY");
    expect(text).toContain("Artifacts:");
    expect(text).toContain("Regression across pack: YES");
    expect(text).toContain("Unsupported artifact:   YES");
    expect(text.toLowerCase()).toContain("not a live result");
  });

  it("produces a JSON-safe report shape (validates after a stringify round-trip)", () => {
    const p = pack([art("pf", portfolioClean())]);
    expect(() => validateBacktestResearchArtifactPack(JSON.parse(JSON.stringify(p)))).not.toThrow();
  });

  it("routes the whole output through the shared redactor (no raw unsafe strings leak)", () => {
    const secretish = "a".repeat(64); // a 64-char hex-looking token the redactor must mask
    const text = formatBacktestResearchArtifactPack(pack([art("pf", portfolioClean())], secretish));
    expect(text).toContain(REDACTED);
    expect(text).not.toContain(secretish);
  });
});
