/**
 * Tests for the Sprint 19 RESEARCH BUNDLE DIFF. Everything here is INJECTED test data — fake
 * paths, made-up digests — exercised purely offline. Bundles are built with the real Sprint 17
 * builder and then diffed. Nothing here is real market data, a live result, or a profitability claim.
 */

import { describe, it, expect } from "vitest";
import {
  diffBacktestResearchBundles,
  validateBacktestResearchBundleDiff,
  formatBacktestResearchBundleDiff,
  BacktestResearchBundleDiffError,
  BACKTEST_RESEARCH_BUNDLE_DIFF_SCHEMA_VERSION,
} from "./research-bundle-diff.js";
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

function bundle(artifacts: BacktestArtifactDescriptor[], malformedPaths?: string[]) {
  return buildBacktestResearchBundle({ runName: "run", artifacts, malformedPaths });
}

describe("diffBacktestResearchBundles — identical", () => {
  it("reports no change and no regression for identical bundles", () => {
    const b = bundle([desc()]);
    const diff = diffBacktestResearchBundles(b, b);
    expect(diff.schemaVersion).toBe(BACKTEST_RESEARCH_BUNDLE_DIFF_SCHEMA_VERSION);
    expect(diff.hasChange).toBe(false);
    expect(diff.hasRegression).toBe(false);
    expect(diff.runDigestChanged).toBe(false);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.paperOnly).toBe(true);
    expect(diff.notProfitabilityClaim).toBe(true);
  });

  it("is byte-stable for a given pair", () => {
    const base = bundle([desc({ path: "a.json", digest: "1" })]);
    const next = bundle([desc({ path: "a.json", digest: "2" })]);
    expect(JSON.stringify(diffBacktestResearchBundles(base, next))).toBe(
      JSON.stringify(diffBacktestResearchBundles(base, next)),
    );
  });

  it("carries no timestamp-like fields (no Date.now dependence)", () => {
    const json = JSON.stringify(diffBacktestResearchBundles(bundle([desc()]), bundle([desc()])));
    expect(json).not.toMatch(/"generatedAt"|"createdAt"|"timestamp"|"ranAt"/);
  });
});

describe("diffBacktestResearchBundles — detected changes", () => {
  it("detects an artifact whose content digest changed (regression)", () => {
    const base = bundle([desc({ path: "a.json", digest: "1" })]);
    const next = bundle([desc({ path: "a.json", digest: "2" })]);
    const diff = diffBacktestResearchBundles(base, next);
    expect(diff.changed.map((c) => c.path)).toEqual(["a.json"]);
    expect(diff.changed[0]).toMatchObject({ baseDigest: "1", nextDigest: "2" });
    expect(diff.runDigestChanged).toBe(true);
    expect(diff.hasChange).toBe(true);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.some((r) => /changed content digest/.test(r))).toBe(true);
  });

  it("detects an added artifact as a change but NOT a regression (additive)", () => {
    const base = bundle([desc({ path: "a.json", digest: "1" })]);
    const next = bundle([
      desc({ path: "a.json", digest: "1" }),
      desc({ path: "b.suite.json", kind: "suite-index", schemaVersion: "backtest.suite.v1", digest: "2" }),
    ]);
    const diff = diffBacktestResearchBundles(base, next);
    expect(diff.added.map((a) => a.path)).toEqual(["b.suite.json"]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.artifactCount.delta).toBe(1);
    expect(diff.hasChange).toBe(true);
    expect(diff.hasRegression).toBe(false); // purely additive
  });

  it("detects a removed artifact (regression)", () => {
    const base = bundle([desc({ path: "a.json", digest: "1" }), desc({ path: "b.json", digest: "2" })]);
    const next = bundle([desc({ path: "a.json", digest: "1" })]);
    const diff = diffBacktestResearchBundles(base, next);
    expect(diff.removed.map((a) => a.path)).toEqual(["b.json"]);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.some((r) => /removed/.test(r))).toBe(true);
  });

  it("detects a same-content kind/schema/size change via the run digest (regression)", () => {
    // Same path + same CONTENT digest, but a different recorded size → digestEntries unchanged,
    // run digest moved → sameSetMetadataDrift regression.
    const base = bundle([desc({ path: "a.json", digest: "d", sizeBytes: 100 })]);
    const next = bundle([desc({ path: "a.json", digest: "d", sizeBytes: 200 })]);
    const diff = diffBacktestResearchBundles(base, next);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.changed).toEqual([]);
    expect(diff.runDigestChanged).toBe(true);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.some((r) => /kind\/schema\/size changed/.test(r))).toBe(true);
  });

  it("detects an unknown-count increase (regression) and a recognized-schema removal (regression)", () => {
    const base = bundle([desc({ path: "a.json", kind: "backtest-report", schemaVersion: "backtest.report.v1", digest: "1" })]);
    const next = bundle([desc({ path: "a.json", kind: "unknown-json", schemaVersion: null, digest: "1" })]);
    const diff = diffBacktestResearchBundles(base, next);
    expect(diff.unknownArtifactCount.delta).toBe(1);
    expect(diff.recognizedSchemasRemoved).toEqual(["backtest.report.v1"]);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.some((r) => /unknown artifact count increased/.test(r))).toBe(true);
    expect(diff.regressionReasons.some((r) => /recognized schema\(s\) removed/.test(r))).toBe(true);
  });

  it("detects a malformed-count increase with an otherwise-identical artifact set (regression)", () => {
    const u = desc({ path: "u.json", kind: "unknown-json", schemaVersion: null, digest: "u" });
    const base = bundle([u]);
    const next = bundle([u], ["u.json"]);
    const diff = diffBacktestResearchBundles(base, next);
    expect(diff.malformedArtifactCount.delta).toBe(1);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.some((r) => /malformed artifact count increased/.test(r))).toBe(true);
  });

  it("reports kind/schema count changes in changeReasons", () => {
    const base = bundle([desc({ path: "a.json", kind: "backtest-report", schemaVersion: "backtest.report.v1", digest: "d" })]);
    const next = bundle([desc({ path: "a.json", kind: "suite-index", schemaVersion: "backtest.suite.v1", digest: "d" })]);
    const diff = diffBacktestResearchBundles(base, next);
    expect(diff.kindCountChanges.length).toBeGreaterThan(0);
    expect(diff.schemaCountChanges.length).toBeGreaterThan(0);
    expect(diff.changeReasons.some((r) => /kind "/.test(r))).toBe(true);
  });

  it("flags an incompatible bundle schema version as a change and a regression", () => {
    const base = bundle([desc()]);
    const next = JSON.parse(JSON.stringify(bundle([desc()])));
    next.schemaVersion = "backtest.research.bundle.v2";
    const diff = diffBacktestResearchBundles(base, next);
    expect(diff.bundleSchemaMatch).toBe(false);
    expect(diff.hasChange).toBe(true);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.some((r) => /incompatible bundle schemaVersion/.test(r))).toBe(true);
  });
});

describe("diffBacktestResearchBundles — input validation", () => {
  it("refuses a non-object base/next", () => {
    expect(() => diffBacktestResearchBundles(null, bundle([desc()]))).toThrow(BacktestResearchBundleDiffError);
    expect(() => diffBacktestResearchBundles(bundle([desc()]), 7)).toThrow(/next bundle must be a JSON object/);
  });

  it("refuses a structurally invalid bundle (bad digest entry)", () => {
    const bad = JSON.parse(JSON.stringify(bundle([desc()])));
    bad.digestEntries[0].digest = "";
    expect(() => diffBacktestResearchBundles(bad, bundle([desc()]))).toThrow(/digestEntries\[0\]\.digest/);
  });

  it("refuses a bundle missing its run digest", () => {
    const bad = JSON.parse(JSON.stringify(bundle([desc()])));
    delete bad.runDigest;
    expect(() => diffBacktestResearchBundles(bundle([desc()]), bad)).toThrow(/runDigest must be a non-empty string/);
  });
});

describe("validateBacktestResearchBundleDiff", () => {
  it("accepts a produced diff round-tripped through JSON", () => {
    const diff = diffBacktestResearchBundles(bundle([desc({ digest: "1" })]), bundle([desc({ digest: "2" })]));
    const round = JSON.parse(JSON.stringify(diff));
    expect(validateBacktestResearchBundleDiff(round)).toEqual(diff);
  });

  it("rejects a wrong schema version and a missing safety flag", () => {
    const diff = diffBacktestResearchBundles(bundle([desc()]), bundle([desc()]));
    expect(() => validateBacktestResearchBundleDiff({ ...diff, schemaVersion: "x" })).toThrow(/schemaVersion/);
    expect(() => validateBacktestResearchBundleDiff({ ...diff, paperOnly: false })).toThrow(/paperOnly must be true/);
  });

  it("rejects a bad number delta and a malformed changed entry", () => {
    const diff = diffBacktestResearchBundles(bundle([desc({ digest: "1" })]), bundle([desc({ digest: "2" })]));
    expect(() => validateBacktestResearchBundleDiff({ ...diff, artifactCount: { base: 1 } })).toThrow(/number delta/);
    const bad = JSON.parse(JSON.stringify(diff));
    bad.changed[0].nextDigest = "";
    expect(() => validateBacktestResearchBundleDiff(bad)).toThrow(/changed\[0\]/);
  });
});

describe("formatBacktestResearchBundleDiff", () => {
  it("renders a PAPER-ONLY header, the change/regression verdicts, and disclaimers", () => {
    const diff = diffBacktestResearchBundles(bundle([desc({ digest: "1" })]), bundle([desc({ digest: "2" })]));
    const text = formatBacktestResearchBundleDiff(diff, { baseLabel: "a.json", nextLabel: "b.json" });
    expect(text).toContain("Research bundle diff (SIMULATED PAPER-ONLY)");
    expect(text).toContain("Changed: YES");
    expect(text).toContain("Regression: YES");
    expect(text.toLowerCase()).toContain("not a live result");
  });

  it("redacts a secret-looking artifact path and caps long lists", () => {
    const secret = "S".repeat(90);
    const base = bundle([desc({ path: "keep.json", digest: "k" })]);
    const manyAdded = Array.from({ length: 60 }, (_, i) => desc({ path: `add/${String(i).padStart(3, "0")}.json`, digest: `d${i}` }));
    const next = bundle([desc({ path: "keep.json", digest: "k" }), desc({ path: `${secret}.json`, digest: "x" }), ...manyAdded]);
    const text = formatBacktestResearchBundleDiff(diffBacktestResearchBundles(base, next), { maxArtifactRows: 10 });
    expect(text).not.toContain(secret);
    expect(text).toContain("[REDACTED]");
    expect(text).toContain("and ");
    expect(text).toContain("more (summarized");
  });
});
