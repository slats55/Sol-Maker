/**
 * Tests for the Sprint 16 RESEARCH RUN MANIFEST. Everything here is INJECTED test data —
 * fake paths, made-up digests — exercised purely offline. The pure package does no file IO;
 * these tests feed it already-loaded artifact descriptors. Nothing here is real market data,
 * a live result, or a profitability claim.
 */

import { describe, it, expect } from "vitest";
import {
  classifyBacktestArtifact,
  buildBacktestResearchManifest,
  validateBacktestResearchManifest,
  formatBacktestResearchManifest,
  verifyBacktestResearchManifest,
  formatBacktestResearchVerification,
  BacktestResearchManifestError,
  BACKTEST_RESEARCH_MANIFEST_SCHEMA_VERSION,
  BACKTEST_RESEARCH_MANIFEST_BANNER,
} from "./research-manifest.js";
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

describe("classifyBacktestArtifact", () => {
  it("maps every known schemaVersion to its kind", () => {
    const cases: [string, string][] = [
      ["backtest.report.v1", "backtest-report"],
      ["backtest.diff.v1", "diff-report"],
      ["backtest.suite.v1", "suite-index"],
      ["backtest.suite.diff.v1", "diff-report"],
      ["backtest.sensitivity.v1", "sensitivity-report"],
      ["backtest.sensitivity.diff.v1", "diff-report"],
      ["backtest.sensitivity.matrix.v1", "sensitivity-matrix-report"],
      ["backtest.sensitivity.matrix.diff.v1", "diff-report"],
      ["backtest.coverage.v1", "coverage-report"],
      ["backtest.variant-plan.explain.v1", "variant-plan-explain"],
    ];
    for (const [sv, kind] of cases) {
      expect(classifyBacktestArtifact({ schemaVersion: sv })).toEqual({ kind, schemaVersion: sv });
    }
  });

  it("treats an unrecognized schemaVersion as unknown-json (but keeps the version)", () => {
    expect(classifyBacktestArtifact({ schemaVersion: "backtest.report.v999" })).toEqual({
      kind: "unknown-json",
      schemaVersion: "backtest.report.v999",
    });
  });

  it("sniffs a scenario and a variant plan structurally (no schemaVersion)", () => {
    expect(classifyBacktestArtifact({ name: "x", steps: [] })).toEqual({ kind: "scenario", schemaVersion: null });
    expect(classifyBacktestArtifact({ variants: [{ suffix: "a" }] })).toEqual({
      kind: "variant-plan",
      schemaVersion: null,
    });
  });

  it("classifies non-objects and unrecognized shapes as unknown-json", () => {
    expect(classifyBacktestArtifact(42)).toEqual({ kind: "unknown-json", schemaVersion: null });
    expect(classifyBacktestArtifact({ foo: 1 })).toEqual({ kind: "unknown-json", schemaVersion: null });
  });
});

describe("buildBacktestResearchManifest — happy path", () => {
  it("produces a paper-only, labelled manifest with honest digest labelling", () => {
    const manifest = buildBacktestResearchManifest({
      runName: "run-1",
      artifacts: [desc(), desc({ path: "scenario.json", kind: "scenario", schemaVersion: null, digest: "bbbbbbbbbbbbbbbb", sizeBytes: 50 })],
    });
    expect(manifest.schemaVersion).toBe(BACKTEST_RESEARCH_MANIFEST_SCHEMA_VERSION);
    expect(manifest.banner).toBe(BACKTEST_RESEARCH_MANIFEST_BANNER);
    expect(manifest.paperOnly).toBe(true);
    expect(manifest.notProfitabilityClaim).toBe(true);
    expect(manifest.runName).toBe("run-1");
    expect(manifest.artifactCount).toBe(2);
    expect(manifest.totalSizeBytes).toBe(150);
    expect(manifest.digestAlgorithm).toMatch(/non-cryptographic/);
    expect(manifest.disclaimers.some((d) => /non-cryptographic/.test(d))).toBe(true);
  });

  it("sorts artifacts by path and counts kinds + schemas deterministically", () => {
    const manifest = buildBacktestResearchManifest({
      artifacts: [
        desc({ path: "z.report.json" }),
        desc({ path: "a.suite.json", kind: "suite-index", schemaVersion: "backtest.suite.v1", digest: "c1" }),
        desc({ path: "m.report.json", digest: "c2" }),
      ],
    });
    expect(manifest.artifacts.map((a) => a.path)).toEqual(["a.suite.json", "m.report.json", "z.report.json"]);
    expect(manifest.kindCounts).toEqual([
      { kind: "backtest-report", count: 2 },
      { kind: "suite-index", count: 1 },
    ]);
    expect(manifest.schemaCounts).toEqual([
      { schemaVersion: "backtest.report.v1", count: 2 },
      { schemaVersion: "backtest.suite.v1", count: 1 },
    ]);
  });

  it("is byte-stable and independent of artifact input order", () => {
    const a = buildBacktestResearchManifest({ runName: "r", artifacts: [desc({ path: "b.json", digest: "1" }), desc({ path: "a.json", digest: "2" })] });
    const b = buildBacktestResearchManifest({ runName: "r", artifacts: [desc({ path: "a.json", digest: "2" }), desc({ path: "b.json", digest: "1" })] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("does not mutate its input", () => {
    const input = { runName: "r", artifacts: [desc({ path: "b.json" }), desc({ path: "a.json", digest: "z" })] };
    const snap = JSON.stringify(input);
    buildBacktestResearchManifest(input);
    expect(JSON.stringify(input)).toBe(snap);
  });

  it("carries no timestamp-like fields", () => {
    const json = JSON.stringify(buildBacktestResearchManifest({ artifacts: [desc()] }));
    expect(json).not.toMatch(/"generatedAt"|"createdAt"|"timestamp"/);
  });

  it("warns about unknown-json artifacts and identical-content (duplicate digest) groups", () => {
    const manifest = buildBacktestResearchManifest({
      artifacts: [
        desc({ path: "a.json", kind: "unknown-json", schemaVersion: null, digest: "dup" }),
        desc({ path: "b.json", kind: "scenario", schemaVersion: null, digest: "dup" }),
      ],
    });
    expect(manifest.warnings.some((w) => /unrecognized schema/.test(w))).toBe(true);
    expect(manifest.warnings.some((w) => /identical content/.test(w) && /a\.json/.test(w) && /b\.json/.test(w))).toBe(true);
  });

  it("warns when a versioned-kind artifact carries no schemaVersion", () => {
    const manifest = buildBacktestResearchManifest({
      artifacts: [desc({ path: "x.json", kind: "suite-index", schemaVersion: null })],
    });
    expect(manifest.warnings.some((w) => /carries no schemaVersion/.test(w))).toBe(true);
  });
});

describe("buildBacktestResearchManifest — refusals", () => {
  it("refuses a duplicate artifact path", () => {
    expect(() =>
      buildBacktestResearchManifest({ artifacts: [desc({ path: "dup.json" }), desc({ path: "dup.json", digest: "z" })] }),
    ).toThrow(/duplicate artifact path "dup.json"/);
  });

  it("refuses an invalid kind", () => {
    expect(() =>
      buildBacktestResearchManifest({ artifacts: [desc({ kind: "nonsense" as never })] }),
    ).toThrow(/not a known artifact kind/);
  });

  it("refuses a missing/empty digest", () => {
    expect(() => buildBacktestResearchManifest({ artifacts: [desc({ digest: "" })] })).toThrow(/digest must be a non-empty string/);
  });

  it("refuses a non-integer or negative sizeBytes", () => {
    expect(() => buildBacktestResearchManifest({ artifacts: [desc({ sizeBytes: 1.5 })] })).toThrow(/non-negative integer/);
    expect(() => buildBacktestResearchManifest({ artifacts: [desc({ sizeBytes: -1 })] })).toThrow(/non-negative integer/);
  });

  it("refuses a non-array artifacts / non-object input", () => {
    expect(() => buildBacktestResearchManifest({ artifacts: "nope" as never })).toThrow(/artifacts must be an array/);
    expect(() => buildBacktestResearchManifest(null as never)).toThrow(/must be an object/);
  });
});

describe("validateBacktestResearchManifest", () => {
  it("accepts a produced manifest round-tripped through JSON", () => {
    const manifest = buildBacktestResearchManifest({ runName: "r", artifacts: [desc()] });
    const round = JSON.parse(JSON.stringify(manifest));
    expect(validateBacktestResearchManifest(round)).toEqual(manifest);
  });

  it("rejects a wrong schema version and a missing flag", () => {
    const manifest = buildBacktestResearchManifest({ artifacts: [desc()] });
    expect(() => validateBacktestResearchManifest({ ...manifest, schemaVersion: "x" })).toThrow(/schemaVersion/);
    expect(() => validateBacktestResearchManifest({ ...manifest, paperOnly: false })).toThrow(/paperOnly must be true/);
  });

  it("rejects a malformed artifact descriptor", () => {
    const manifest = buildBacktestResearchManifest({ artifacts: [desc()] });
    const bad = JSON.parse(JSON.stringify(manifest));
    bad.artifacts[0].digest = "";
    expect(() => validateBacktestResearchManifest(bad)).toThrow(/digest must be a non-empty string/);
  });
});

describe("formatBacktestResearchManifest", () => {
  it("leads with the banner and carries the PAPER-ONLY disclaimers + digest honesty", () => {
    const manifest = buildBacktestResearchManifest({ runName: "r", artifacts: [desc()] });
    const text = formatBacktestResearchManifest(manifest, { label: "out/" });
    expect(text.startsWith(BACKTEST_RESEARCH_MANIFEST_BANNER)).toBe(true);
    expect(text).toContain("dir:       out/");
    expect(text.toLowerCase()).toContain("not a live result");
    expect(text.toLowerCase()).toContain("not a profitability claim");
    expect(text).toContain("non-cryptographic");
    expect(text).toContain("reports/a.report.json");
  });
});

describe("verifyBacktestResearchManifest", () => {
  function manifestOf(artifacts: BacktestArtifactDescriptor[]) {
    return buildBacktestResearchManifest({ runName: "r", artifacts });
  }

  it("verifies a clean directory as VALID", () => {
    const artifacts = [desc({ path: "a.json", digest: "1" }), desc({ path: "b.json", digest: "2" })];
    const v = verifyBacktestResearchManifest(manifestOf(artifacts), artifacts.map((a) => ({ ...a })));
    expect(v.valid).toBe(true);
    expect(v.okCount).toBe(2);
    expect(v.changedCount + v.missingCount + v.extraCount).toBe(0);
    expect(v.schemaVersion).toBe("backtest.research.verify.v1");
  });

  it("detects a changed digest", () => {
    const artifacts = [desc({ path: "a.json", digest: "1" })];
    const v = verifyBacktestResearchManifest(manifestOf(artifacts), [desc({ path: "a.json", digest: "CHANGED" })]);
    expect(v.valid).toBe(false);
    expect(v.changedCount).toBe(1);
    expect(v.artifacts[0]!.status).toBe("digest-changed");
  });

  it("detects a missing file", () => {
    const v = verifyBacktestResearchManifest(manifestOf([desc({ path: "a.json" }), desc({ path: "b.json", digest: "2" })]), [desc({ path: "a.json" })]);
    expect(v.missingCount).toBe(1);
    expect(v.artifacts.find((a) => a.path === "b.json")!.status).toBe("missing");
    expect(v.valid).toBe(false);
  });

  it("detects an extra file", () => {
    const v = verifyBacktestResearchManifest(manifestOf([desc({ path: "a.json" })]), [desc({ path: "a.json" }), desc({ path: "extra.json", digest: "9" })]);
    expect(v.extraCount).toBe(1);
    expect(v.artifacts.find((a) => a.path === "extra.json")!.status).toBe("extra");
    expect(v.valid).toBe(false);
  });

  it("detects a schema mismatch (same digest, different schemaVersion)", () => {
    const v = verifyBacktestResearchManifest(
      manifestOf([desc({ path: "a.json", schemaVersion: "backtest.report.v1" })]),
      [desc({ path: "a.json", schemaVersion: "backtest.report.v2" })],
    );
    expect(v.artifacts[0]!.status).toBe("schema-changed");
    expect(v.valid).toBe(false);
  });

  it("detects a size change with identical digest", () => {
    const v = verifyBacktestResearchManifest(
      manifestOf([desc({ path: "a.json", sizeBytes: 100 })]),
      [desc({ path: "a.json", sizeBytes: 200 })],
    );
    expect(v.artifacts[0]!.status).toBe("size-changed");
    expect(v.valid).toBe(false);
  });

  it("refuses a malformed manifest and is deterministic", () => {
    expect(() => verifyBacktestResearchManifest({ not: "a manifest" }, [])).toThrow(BacktestResearchManifestError);
    const m = manifestOf([desc({ path: "a.json" })]);
    const a = verifyBacktestResearchManifest(m, [desc({ path: "a.json" })]);
    const b = verifyBacktestResearchManifest(m, [desc({ path: "a.json" })]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("formats a VALID and an INVALID verification with disclaimers", () => {
    const m = manifestOf([desc({ path: "a.json" })]);
    const ok = formatBacktestResearchVerification(verifyBacktestResearchManifest(m, [desc({ path: "a.json" })]));
    expect(ok).toContain("(VALID)");
    expect(ok.toLowerCase()).toContain("not a live result");
    const bad = formatBacktestResearchVerification(verifyBacktestResearchManifest(m, [desc({ path: "a.json", digest: "X" })]));
    expect(bad).toContain("(INVALID)");
    expect(bad).toContain("digest-changed");
  });
});
