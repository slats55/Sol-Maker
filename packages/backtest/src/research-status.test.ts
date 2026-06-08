/**
 * Tests for the Sprint 17 RESEARCH RUN STATUS / INTEGRITY summary. Everything here is INJECTED
 * test data — fake paths, made-up digests — exercised purely offline. The pure package does no
 * file IO; these tests feed it already-loaded artifact descriptors and an optional manifest.
 * Nothing here is real market data, a live result, or a profitability claim.
 */

import { describe, it, expect } from "vitest";
import {
  buildBacktestResearchStatus,
  validateBacktestResearchStatus,
  formatBacktestResearchStatus,
  BacktestResearchStatusError,
  BACKTEST_RESEARCH_STATUS_SCHEMA_VERSION,
  BACKTEST_RESEARCH_STATUS_BANNER,
} from "./research-status.js";
import { buildBacktestResearchManifest } from "./research-manifest.js";
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

const ARTIFACTS = [
  desc({ path: "a.report.json", digest: "1" }),
  desc({ path: "b.suite.json", kind: "suite-index", schemaVersion: "backtest.suite.v1", digest: "2" }),
];

function manifestFor(artifacts: BacktestArtifactDescriptor[]) {
  return buildBacktestResearchManifest({ runName: "r", artifacts });
}

describe("buildBacktestResearchStatus — no manifest", () => {
  it("summarizes a recognized, stable, complete directory with no manifest", () => {
    const status = buildBacktestResearchStatus({ runName: "r", artifacts: ARTIFACTS });
    expect(status.schemaVersion).toBe(BACKTEST_RESEARCH_STATUS_SCHEMA_VERSION);
    expect(status.banner).toBe(BACKTEST_RESEARCH_STATUS_BANNER);
    expect(status.paperOnly).toBe(true);
    expect(status.complete).toBe(true);
    expect(status.recognized).toBe(true);
    expect(status.stable).toBe(true);
    expect(status.bundleCandidateValid).toBe(true);
    expect(status.manifest.present).toBe(false);
    expect(status.kindsPresent).toEqual(["backtest-report", "suite-index"]);
    expect(status.schemasPresent).toEqual(["backtest.report.v1", "backtest.suite.v1"]);
    expect(status.runDigest).toMatch(/^[0-9a-f]+$/);
    expect(status.recommendedAction).toMatch(/No manifest recorded/);
  });

  it("is byte-stable and carries no timestamp-like fields", () => {
    const a = buildBacktestResearchStatus({ runName: "r", artifacts: ARTIFACTS });
    const b = buildBacktestResearchStatus({ runName: "r", artifacts: [...ARTIFACTS].reverse() });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toMatch(/"generatedAt"|"createdAt"|"timestamp"/);
  });

  it("flags an empty directory as not complete", () => {
    const status = buildBacktestResearchStatus({ runName: "empty", artifacts: [] });
    expect(status.complete).toBe(false);
    expect(status.recommendedAction).toMatch(/does not look like a completed research run/);
  });
});

describe("buildBacktestResearchStatus — with a manifest", () => {
  it("reports IN SYNC when the directory matches the manifest", () => {
    const status = buildBacktestResearchStatus({
      runName: "r",
      artifacts: ARTIFACTS,
      manifest: manifestFor(ARTIFACTS),
    });
    expect(status.manifest.present).toBe(true);
    expect(status.manifest.inSync).toBe(true);
    expect(status.manifest.okCount).toBe(2);
    expect(status.recommendedAction).toMatch(/complete, recognized, stable, and in sync/);
  });

  it("detects a digest change as drift", () => {
    const manifest = manifestFor(ARTIFACTS);
    const current = [desc({ path: "a.report.json", digest: "CHANGED" }), ARTIFACTS[1]!];
    const status = buildBacktestResearchStatus({ runName: "r", artifacts: current, manifest });
    expect(status.manifest.inSync).toBe(false);
    expect(status.manifest.digestChangedCount).toBe(1);
    expect(status.recommendedAction).toMatch(/does not match the directory/);
    expect(status.warnings.some((w) => /manifest drift/.test(w))).toBe(true);
  });

  it("detects a missing artifact", () => {
    const manifest = manifestFor(ARTIFACTS);
    const status = buildBacktestResearchStatus({ runName: "r", artifacts: [ARTIFACTS[0]!], manifest });
    expect(status.manifest.missingCount).toBe(1);
    expect(status.manifest.inSync).toBe(false);
  });

  it("detects an extra artifact", () => {
    const manifest = manifestFor([ARTIFACTS[0]!]);
    const status = buildBacktestResearchStatus({ runName: "r", artifacts: ARTIFACTS, manifest });
    expect(status.manifest.extraCount).toBe(1);
    expect(status.manifest.inSync).toBe(false);
  });

  it("refuses a structurally invalid manifest", () => {
    expect(() =>
      buildBacktestResearchStatus({ runName: "r", artifacts: ARTIFACTS, manifest: { not: "a manifest" } }),
    ).toThrow(BacktestResearchStatusError);
  });
});

describe("buildBacktestResearchStatus — unknown/malformed", () => {
  it("counts malformed JSON safely and recommends inspecting it", () => {
    const artifacts = [
      desc({ path: "a.report.json", digest: "1" }),
      desc({ path: "broken.json", kind: "unknown-json", schemaVersion: null, digest: "b" }),
    ];
    const status = buildBacktestResearchStatus({ runName: "r", artifacts, malformedPaths: ["broken.json"] });
    expect(status.unknownArtifactCount).toBe(1);
    expect(status.malformedArtifactCount).toBe(1);
    expect(status.recognized).toBe(false);
    expect(status.stable).toBe(false);
    expect(status.recommendedAction).toMatch(/unparseable JSON/);
  });

  it("recommends confirming unrecognized-schema files when they parse cleanly", () => {
    const artifacts = [
      desc({ path: "a.report.json", digest: "1" }),
      desc({ path: "weird.json", kind: "unknown-json", schemaVersion: null, digest: "w" }),
    ];
    const status = buildBacktestResearchStatus({
      runName: "r",
      artifacts,
      manifest: manifestFor(artifacts),
    });
    expect(status.malformedArtifactCount).toBe(0);
    expect(status.unknownArtifactCount).toBe(1);
    expect(status.recommendedAction).toMatch(/unrecognized schema/);
  });
});

describe("validateBacktestResearchStatus", () => {
  it("accepts a produced status round-tripped through JSON", () => {
    const status = buildBacktestResearchStatus({ runName: "r", artifacts: ARTIFACTS });
    const round = JSON.parse(JSON.stringify(status));
    expect(validateBacktestResearchStatus(round)).toEqual(status);
  });

  it("rejects a wrong schema version, a missing flag, and a non-boolean health flag", () => {
    const status = buildBacktestResearchStatus({ runName: "r", artifacts: ARTIFACTS });
    expect(() => validateBacktestResearchStatus({ ...status, schemaVersion: "x" })).toThrow(/schemaVersion/);
    expect(() => validateBacktestResearchStatus({ ...status, notLiveResult: false })).toThrow(/notLiveResult must be true/);
    expect(() => validateBacktestResearchStatus({ ...status, complete: "yes" })).toThrow(/complete must be a boolean/);
  });

  it("rejects an empty recommended action and a bad manifest-check count", () => {
    const status = buildBacktestResearchStatus({ runName: "r", artifacts: ARTIFACTS });
    expect(() => validateBacktestResearchStatus({ ...status, recommendedAction: "" })).toThrow(/recommendedAction/);
    const badManifest = JSON.parse(JSON.stringify(status));
    badManifest.manifest.missingCount = -1;
    expect(() => validateBacktestResearchStatus(badManifest)).toThrow(/manifest.missingCount/);
  });
});

describe("formatBacktestResearchStatus", () => {
  it("leads with the banner, shows the health verdicts, and a neutral recommendation", () => {
    const status = buildBacktestResearchStatus({
      runName: "r",
      artifacts: ARTIFACTS,
      manifest: manifestFor(ARTIFACTS),
    });
    const text = formatBacktestResearchStatus(status, { label: "run/" });
    expect(text.startsWith(BACKTEST_RESEARCH_STATUS_BANNER)).toBe(true);
    expect(text).toContain("dir:        run/");
    expect(text).toContain("- complete:   yes");
    expect(text).toContain("- in sync: yes");
    expect(text).toContain("Recommended:");
    expect(text.toLowerCase()).toContain("not a live result");
    expect(text.toLowerCase()).toContain("not trading advice");
  });
});
