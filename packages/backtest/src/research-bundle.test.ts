/**
 * Tests for the Sprint 17 RESEARCH RUN BUNDLE. Everything here is INJECTED test data — fake
 * paths, made-up digests — exercised purely offline. The pure package does no file IO; these
 * tests feed it already-loaded artifact descriptors. Nothing here is real market data, a live
 * result, or a profitability claim.
 */

import { describe, it, expect } from "vitest";
import {
  buildBacktestResearchBundle,
  buildBacktestResearchRunDigest,
  validateBacktestResearchBundle,
  formatBacktestResearchBundle,
  BacktestResearchBundleError,
  BACKTEST_RESEARCH_BUNDLE_SCHEMA_VERSION,
  BACKTEST_RESEARCH_BUNDLE_BANNER,
} from "./research-bundle.js";
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

describe("buildBacktestResearchRunDigest", () => {
  it("is independent of input order and stable", () => {
    const a = [desc({ path: "b.json", digest: "1" }), desc({ path: "a.json", digest: "2" })];
    const b = [desc({ path: "a.json", digest: "2" }), desc({ path: "b.json", digest: "1" })];
    expect(buildBacktestResearchRunDigest(a)).toBe(buildBacktestResearchRunDigest(b));
  });

  it("changes when ANY artifact's content digest changes", () => {
    const base = buildBacktestResearchRunDigest([desc({ path: "a.json", digest: "1" })]);
    const changed = buildBacktestResearchRunDigest([desc({ path: "a.json", digest: "CHANGED" })]);
    expect(changed).not.toBe(base);
  });

  it("changes when a schema, kind, or size changes (not just the digest)", () => {
    const base = buildBacktestResearchRunDigest([desc({ path: "a.json" })]);
    expect(buildBacktestResearchRunDigest([desc({ path: "a.json", sizeBytes: 999 })])).not.toBe(base);
    expect(buildBacktestResearchRunDigest([desc({ path: "a.json", schemaVersion: "x" })])).not.toBe(base);
  });

  it("is a non-empty hex-like string and rejects a non-array", () => {
    expect(buildBacktestResearchRunDigest([desc()])).toMatch(/^[0-9a-f]+$/);
    expect(() => buildBacktestResearchRunDigest("nope" as never)).toThrow(BacktestResearchBundleError);
  });
});

describe("buildBacktestResearchBundle — happy path", () => {
  it("produces a paper-only, labelled bundle with an honest digest label + top-level run digest", () => {
    const bundle = buildBacktestResearchBundle({
      runName: "run-1",
      artifacts: [
        desc(),
        desc({ path: "scenario.json", kind: "scenario", schemaVersion: null, digest: "bbbbbbbbbbbbbbbb", sizeBytes: 50 }),
      ],
    });
    expect(bundle.schemaVersion).toBe(BACKTEST_RESEARCH_BUNDLE_SCHEMA_VERSION);
    expect(bundle.banner).toBe(BACKTEST_RESEARCH_BUNDLE_BANNER);
    expect(bundle.paperOnly).toBe(true);
    expect(bundle.notProfitabilityClaim).toBe(true);
    expect(bundle.runName).toBe("run-1");
    expect(bundle.artifactCount).toBe(2);
    expect(bundle.totalSizeBytes).toBe(150);
    expect(bundle.runDigest).toMatch(/^[0-9a-f]+$/);
    expect(bundle.digestAlgorithm).toMatch(/non-cryptographic/);
    expect(bundle.disclaimers.some((d) => /non-cryptographic/.test(d))).toBe(true);
  });

  it("summarizes the manifest (schema, run, counts, manifest digest)", () => {
    const bundle = buildBacktestResearchBundle({ runName: "r", artifacts: [desc()] });
    expect(bundle.manifest.schemaVersion).toBe("backtest.research.manifest.v1");
    expect(bundle.manifest.runName).toBe("r");
    expect(bundle.manifest.artifactCount).toBe(1);
    expect(bundle.manifest.manifestDigest).toMatch(/^[0-9a-f]+$/);
  });

  it("reports kind counts, the recognized schema set, and sorted digest entries", () => {
    const bundle = buildBacktestResearchBundle({
      artifacts: [
        desc({ path: "z.report.json", digest: "z" }),
        desc({ path: "a.suite.json", kind: "suite-index", schemaVersion: "backtest.suite.v1", digest: "s" }),
        desc({ path: "m.scenario.json", kind: "scenario", schemaVersion: null, digest: "c" }),
      ],
    });
    expect(bundle.kindCounts).toEqual([
      { kind: "backtest-report", count: 1 },
      { kind: "scenario", count: 1 },
      { kind: "suite-index", count: 1 },
    ]);
    // recognized = versioned, recognized kinds only (scenario is recognized but unversioned → excluded).
    expect(bundle.recognizedSchemaVersions).toEqual(["backtest.report.v1", "backtest.suite.v1"]);
    expect(bundle.digestEntries.map((e) => e.path)).toEqual(["a.suite.json", "m.scenario.json", "z.report.json"]);
  });

  it("is byte-stable and independent of artifact input order (identical run digest)", () => {
    const a = buildBacktestResearchBundle({ runName: "r", artifacts: [desc({ path: "b.json", digest: "1" }), desc({ path: "a.json", digest: "2" })] });
    const b = buildBacktestResearchBundle({ runName: "r", artifacts: [desc({ path: "a.json", digest: "2" }), desc({ path: "b.json", digest: "1" })] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.runDigest).toBe(b.runDigest);
  });

  it("changes the top-level run digest when an artifact digest changes", () => {
    const base = buildBacktestResearchBundle({ artifacts: [desc({ path: "a.json", digest: "1" })] });
    const next = buildBacktestResearchBundle({ artifacts: [desc({ path: "a.json", digest: "2" })] });
    expect(next.runDigest).not.toBe(base.runDigest);
  });

  it("does not mutate its input", () => {
    const input = { runName: "r", artifacts: [desc({ path: "b.json" }), desc({ path: "a.json", digest: "z" })] };
    const snap = JSON.stringify(input);
    buildBacktestResearchBundle(input);
    expect(JSON.stringify(input)).toBe(snap);
  });

  it("carries no timestamp-like fields (no Date.now/Math.random dependence)", () => {
    const json = JSON.stringify(buildBacktestResearchBundle({ artifacts: [desc()] }));
    expect(json).not.toMatch(/"generatedAt"|"createdAt"|"timestamp"|"ranAt"/);
  });

  it("does not embed artifact contents (only path + digest references)", () => {
    const bundle = buildBacktestResearchBundle({ artifacts: [desc({ path: "a.json", digest: "d" })] });
    expect(bundle.digestEntries[0]).toEqual({ path: "a.json", digest: "d" });
    expect(JSON.stringify(bundle)).not.toContain('"content"');
  });
});

describe("buildBacktestResearchBundle — warnings + unknown/malformed", () => {
  it("counts unknown artifacts and warns about them", () => {
    const bundle = buildBacktestResearchBundle({
      artifacts: [desc({ path: "u.json", kind: "unknown-json", schemaVersion: null, digest: "u" })],
    });
    expect(bundle.unknownArtifactCount).toBe(1);
    expect(bundle.warnings.some((w) => /unrecognized schema/.test(w))).toBe(true);
  });

  it("counts malformed artifacts (subset of unknown) and warns about them", () => {
    const bundle = buildBacktestResearchBundle({
      artifacts: [desc({ path: "broken.json", kind: "unknown-json", schemaVersion: null, digest: "b" })],
      malformedPaths: ["broken.json"],
    });
    expect(bundle.malformedArtifactCount).toBe(1);
    expect(bundle.warnings.some((w) => /unparseable JSON \(malformed\)/.test(w))).toBe(true);
  });

  it("warns on an empty run", () => {
    const bundle = buildBacktestResearchBundle({ artifacts: [] });
    expect(bundle.artifactCount).toBe(0);
    expect(bundle.warnings.some((w) => /indexes no artifacts/.test(w))).toBe(true);
  });

  it("refuses a malformedPaths entry that is not an indexed artifact", () => {
    expect(() =>
      buildBacktestResearchBundle({ artifacts: [desc({ path: "a.json" })], malformedPaths: ["ghost.json"] }),
    ).toThrow(/not an indexed artifact/);
  });

  it("refuses a malformedPaths entry that did not classify as unknown-json", () => {
    expect(() =>
      buildBacktestResearchBundle({ artifacts: [desc({ path: "a.json", kind: "backtest-report" })], malformedPaths: ["a.json"] }),
    ).toThrow(/must classify as unknown-json/);
  });

  it("propagates manifest refusals (duplicate path) as a bundle error", () => {
    expect(() =>
      buildBacktestResearchBundle({ artifacts: [desc({ path: "dup.json" }), desc({ path: "dup.json", digest: "z" })] }),
    ).toThrow(BacktestResearchBundleError);
  });
});

describe("validateBacktestResearchBundle", () => {
  it("accepts a produced bundle round-tripped through JSON", () => {
    const bundle = buildBacktestResearchBundle({ runName: "r", artifacts: [desc()] });
    const round = JSON.parse(JSON.stringify(bundle));
    expect(validateBacktestResearchBundle(round)).toEqual(bundle);
  });

  it("rejects a wrong schema version and a missing safety flag", () => {
    const bundle = buildBacktestResearchBundle({ artifacts: [desc()] });
    expect(() => validateBacktestResearchBundle({ ...bundle, schemaVersion: "x" })).toThrow(/schemaVersion/);
    expect(() => validateBacktestResearchBundle({ ...bundle, paperOnly: false })).toThrow(/paperOnly must be true/);
  });

  it("rejects a bad run digest, a negative count, and malformed > unknown", () => {
    const bundle = buildBacktestResearchBundle({ artifacts: [desc()] });
    expect(() => validateBacktestResearchBundle({ ...bundle, runDigest: "" })).toThrow(/runDigest/);
    expect(() => validateBacktestResearchBundle({ ...bundle, artifactCount: -1 })).toThrow(/non-negative integer/);
    expect(() => validateBacktestResearchBundle({ ...bundle, unknownArtifactCount: 0, malformedArtifactCount: 1 })).toThrow(
      /malformedArtifactCount must not exceed/,
    );
  });

  it("rejects a malformed digest entry and a bad manifest summary", () => {
    const bundle = buildBacktestResearchBundle({ artifacts: [desc()] });
    const badEntry = JSON.parse(JSON.stringify(bundle));
    badEntry.digestEntries[0].digest = "";
    expect(() => validateBacktestResearchBundle(badEntry)).toThrow(/digestEntries\[0\]/);
    const badManifest = JSON.parse(JSON.stringify(bundle));
    badManifest.manifest.manifestDigest = "";
    expect(() => validateBacktestResearchBundle(badManifest)).toThrow(/manifest.manifestDigest/);
  });
});

describe("formatBacktestResearchBundle", () => {
  it("leads with the banner and carries the PAPER-ONLY disclaimers, run digest, and digest honesty", () => {
    const bundle = buildBacktestResearchBundle({ runName: "r", artifacts: [desc()] });
    const text = formatBacktestResearchBundle(bundle, { label: "out/" });
    expect(text.startsWith(BACKTEST_RESEARCH_BUNDLE_BANNER)).toBe(true);
    expect(text).toContain("dir:       out/");
    expect(text).toContain(`runDigest: ${bundle.runDigest}`);
    expect(text.toLowerCase()).toContain("not a live result");
    expect(text.toLowerCase()).toContain("not a profitability claim");
    expect(text).toContain("non-cryptographic");
    expect(text).toContain("reports/a.report.json");
  });

  it("summarizes a long digest list instead of dumping every row", () => {
    const artifacts = Array.from({ length: 60 }, (_, i) =>
      desc({ path: `r/${String(i).padStart(3, "0")}.report.json`, digest: `d${i}` }),
    );
    const bundle = buildBacktestResearchBundle({ artifacts });
    const text = formatBacktestResearchBundle(bundle, { maxDigestRows: 10 });
    expect(text).toContain("and 50 more");
  });
});
