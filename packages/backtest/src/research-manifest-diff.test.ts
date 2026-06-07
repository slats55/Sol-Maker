/**
 * Tests for the Sprint 16 research MANIFEST diff. INJECTED test data only — fake paths and
 * digests, exercised offline. Nothing here is real market data, a live result, or a
 * profitability claim.
 */

import { describe, it, expect } from "vitest";
import {
  diffBacktestResearchManifests,
  validateBacktestResearchManifestDiff,
  formatBacktestResearchManifestDiff,
  BacktestResearchManifestDiffError,
  BACKTEST_RESEARCH_MANIFEST_DIFF_SCHEMA_VERSION,
} from "./research-manifest-diff.js";
import { buildBacktestResearchManifest, type BacktestArtifactDescriptor } from "./research-manifest.js";

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

function manifest(artifacts: BacktestArtifactDescriptor[], runName = "r") {
  return buildBacktestResearchManifest({ runName, artifacts });
}

describe("diffBacktestResearchManifests", () => {
  it("reports no change for two identical manifests", () => {
    const m = manifest([desc({ path: "a.json", digest: "1" }), desc({ path: "b.json", digest: "2" })]);
    const diff = diffBacktestResearchManifests(m, JSON.parse(JSON.stringify(m)));
    expect(diff.schemaVersion).toBe(BACKTEST_RESEARCH_MANIFEST_DIFF_SCHEMA_VERSION);
    expect(diff.hasChange).toBe(false);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.artifactCount.delta).toBe(0);
  });

  it("detects an added artifact", () => {
    const base = manifest([desc({ path: "a.json", digest: "1" })]);
    const next = manifest([desc({ path: "a.json", digest: "1" }), desc({ path: "b.json", digest: "2" })]);
    const diff = diffBacktestResearchManifests(base, next);
    expect(diff.added.map((a) => a.path)).toEqual(["b.json"]);
    expect(diff.removed).toEqual([]);
    expect(diff.artifactCount.delta).toBe(1);
    expect(diff.hasChange).toBe(true);
  });

  it("detects a removed artifact", () => {
    const base = manifest([desc({ path: "a.json", digest: "1" }), desc({ path: "b.json", digest: "2" })]);
    const next = manifest([desc({ path: "a.json", digest: "1" })]);
    const diff = diffBacktestResearchManifests(base, next);
    expect(diff.removed.map((a) => a.path)).toEqual(["b.json"]);
    expect(diff.added).toEqual([]);
    expect(diff.hasChange).toBe(true);
  });

  it("detects a changed digest and reports the change tags", () => {
    const base = manifest([desc({ path: "a.json", digest: "1", sizeBytes: 100 })]);
    const next = manifest([desc({ path: "a.json", digest: "2", sizeBytes: 120 })]);
    const diff = diffBacktestResearchManifests(base, next);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0]!.digestChanged).toBe(true);
    expect(diff.changed[0]!.sizeBytes.delta).toBe(20);
    expect(diff.changeReasons.join("\n")).toMatch(/artifact "a\.json" changed \(digest, size\)/);
  });

  it("detects a schema change and reflects it in schema count changes", () => {
    const base = manifest([desc({ path: "a.json", schemaVersion: "backtest.report.v1" })]);
    const next = manifest([desc({ path: "a.json", schemaVersion: "backtest.report.v2", kind: "unknown-json" })]);
    const diff = diffBacktestResearchManifests(base, next);
    expect(diff.changed[0]!.schemaChanged).toBe(true);
    expect(diff.changed[0]!.kindChanged).toBe(true);
    expect(diff.schemaCountChanges.some((s) => s.key === "backtest.report.v1" && s.delta === -1)).toBe(true);
    expect(diff.schemaCountChanges.some((s) => s.key === "backtest.report.v2" && s.delta === 1)).toBe(true);
  });

  it("surfaces a manifest schema-version mismatch as a change", () => {
    const base = manifest([desc({ path: "a.json" })]);
    const next = JSON.parse(JSON.stringify(manifest([desc({ path: "a.json" })])));
    next.schemaVersion = "backtest.research.manifest.v2";
    const diff = diffBacktestResearchManifests(base, next);
    expect(diff.manifestSchemaMatch).toBe(false);
    expect(diff.hasChange).toBe(true);
    expect(diff.changeReasons.join("\n")).toMatch(/manifest schemaVersion differs/);
  });

  it("is byte-stable and non-mutating for a given pair", () => {
    const base = manifest([desc({ path: "a.json", digest: "1" })]);
    const next = manifest([desc({ path: "a.json", digest: "1" }), desc({ path: "b.json", digest: "2" })]);
    const snapB = JSON.stringify(base);
    const snapN = JSON.stringify(next);
    const a = diffBacktestResearchManifests(base, next);
    const b = diffBacktestResearchManifests(base, next);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(base)).toBe(snapB);
    expect(JSON.stringify(next)).toBe(snapN);
  });

  it("refuses a non-manifest input", () => {
    expect(() => diffBacktestResearchManifests({}, manifest([desc()]))).toThrow(BacktestResearchManifestDiffError);
    expect(() => diffBacktestResearchManifests(manifest([desc()]), { artifacts: "no" })).toThrow(
      BacktestResearchManifestDiffError,
    );
  });

  it("refuses a manifest whose artifact has a fractional/negative sizeBytes (untrusted diff input)", () => {
    const base = manifest([desc()]);
    const bad = JSON.parse(JSON.stringify(manifest([desc()])));
    bad.artifacts[0].sizeBytes = 1.5;
    expect(() => diffBacktestResearchManifests(bad, base)).toThrow(/sizeBytes must be a non-negative integer/);
    bad.artifacts[0].sizeBytes = -3;
    expect(() => diffBacktestResearchManifests(bad, base)).toThrow(/sizeBytes must be a non-negative integer/);
  });
});

describe("validateBacktestResearchManifestDiff", () => {
  it("accepts a produced diff and rejects a wrong schema / non-object", () => {
    const diff = diffBacktestResearchManifests(manifest([desc()]), manifest([desc()]));
    expect(validateBacktestResearchManifestDiff(JSON.parse(JSON.stringify(diff)))).toEqual(diff);
    expect(() => validateBacktestResearchManifestDiff({ ...diff, schemaVersion: "x" })).toThrow(/schemaVersion/);
    expect(() => validateBacktestResearchManifestDiff(7)).toThrow(/must be a JSON object/);
  });

  it("rejects a missing PAPER-ONLY flag", () => {
    const diff = diffBacktestResearchManifests(manifest([desc()]), manifest([desc()]));
    expect(() => validateBacktestResearchManifestDiff({ ...diff, paperOnly: false })).toThrow(/paperOnly must be true/);
  });

  it("rejects a malformed changed element and a malformed count change", () => {
    const base = manifest([desc({ path: "a.json", digest: "1" })]);
    const next = manifest([desc({ path: "a.json", digest: "2" })]);
    const diff = diffBacktestResearchManifests(base, next);
    const badChanged = JSON.parse(JSON.stringify(diff));
    badChanged.changed[0].digestChanged = "yes"; // not a boolean
    expect(() => validateBacktestResearchManifestDiff(badChanged)).toThrow(/digestChanged must be a boolean/);

    const badCount = JSON.parse(JSON.stringify(diff));
    badCount.kindCountChanges = [{ key: "backtest-report" }]; // missing base/next/delta
    expect(() => validateBacktestResearchManifestDiff(badCount)).toThrow(/count change/);
  });

  it("rejects a non-{base,next,delta} artifactCount", () => {
    const diff = diffBacktestResearchManifests(manifest([desc()]), manifest([desc()]));
    expect(() => validateBacktestResearchManifestDiff({ ...diff, artifactCount: 3 })).toThrow(/number delta/);
  });
});

describe("formatBacktestResearchManifestDiff", () => {
  it("renders a sectioned, disclaimered, deterministic report", () => {
    const base = manifest([desc({ path: "a.json", digest: "1" })]);
    const next = manifest([desc({ path: "a.json", digest: "1" }), desc({ path: "b.json", digest: "2" })]);
    const diff = diffBacktestResearchManifests(base, next);
    const text = formatBacktestResearchManifestDiff(diff, { baseLabel: "base/", nextLabel: "next/" });
    expect(text).toContain("Research manifest diff (SIMULATED PAPER-ONLY)");
    expect(text).toContain("Added artifacts (1):");
    expect(text).toContain("Changed: YES");
    expect(text.toLowerCase()).toContain("not a live result");
    expect(formatBacktestResearchManifestDiff(diff)).toBe(formatBacktestResearchManifestDiff(diff));
  });
});
