import { describe, expect, it } from "vitest";

import {
  ARTIFACT_LIMITS,
  normalizeArtifact,
  parseArtifactJson,
  toSummaryJson,
} from "../src/lib/local-artifact.js";

describe("parseArtifactJson", () => {
  it("parses valid JSON", () => {
    const result = parseArtifactJson('{"a":1}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: 1 });
  });

  it("reports an error for malformed JSON without throwing", () => {
    const result = parseArtifactJson("{ not json,,");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it("accepts non-object top-level JSON (array, primitive)", () => {
    expect(parseArtifactJson("[1,2,3]").ok).toBe(true);
    expect(parseArtifactJson("42").ok).toBe(true);
    expect(parseArtifactJson('"hi"').ok).toBe(true);
    expect(parseArtifactJson("null").ok).toBe(true);
  });
});

describe("normalizeArtifact — schema recognition", () => {
  it("recognizes a known stable schema", () => {
    const view = normalizeArtifact({ schemaVersion: "backtest.report.v1" });
    expect(view.schemaVersion).toBe("backtest.report.v1");
    expect(view.schemaStatus).toBe("stable");
    expect(view.schemaInfo?.title).toBe("Backtest report");
    expect(view.kind).toBe("Backtest report");
  });

  it("flags an emerging schema honestly", () => {
    const view = normalizeArtifact({ schemaVersion: "backtest.research.manifest.v1" });
    expect(view.schemaStatus).toBe("emerging");
    expect(view.schemaInfo?.family).toBe("research");
  });

  it("flags an unknown schema instead of faking it", () => {
    const view = normalizeArtifact({ schemaVersion: "totally.made.up.v9" });
    expect(view.schemaStatus).toBe("unknown");
    expect(view.schemaInfo).toBeNull();
    expect(view.kind).toBe("Unrecognized artifact");
  });

  it("handles a missing schemaVersion safely", () => {
    const view = normalizeArtifact({ steps: 3 });
    expect(view.schemaVersion).toBeNull();
    expect(view.schemaStatus).toBe("absent");
    expect(view.kind).toBe("Unlabelled JSON object");
  });

  it("treats a non-string schemaVersion as absent and notes it", () => {
    const view = normalizeArtifact({ schemaVersion: 123 });
    expect(view.schemaVersion).toBeNull();
    expect(view.schemaStatus).toBe("absent");
    expect(view.notes.join(" ")).toContain("schemaVersion");
  });
});

describe("normalizeArtifact — field extraction", () => {
  it("pulls identity and digest fields from common keys", () => {
    const view = normalizeArtifact({
      schemaVersion: "backtest.report.v1",
      title: "Buy & hold",
      id: "run-1",
      mode: "PAPER",
      scenarioDigest: "abc123",
    });
    const identityKeys = view.identity.map((i) => i.key);
    expect(identityKeys).toContain("title");
    expect(identityKeys).toContain("id");
    expect(identityKeys).toContain("mode");
    expect(view.digest).toEqual({ key: "scenarioDigest", value: "abc123" });
  });

  it("splits top-level scalars from nested structures", () => {
    const view = normalizeArtifact({
      schemaVersion: "backtest.report.v1",
      steps: 6,
      ok: true,
      label: "x",
      positions: [1, 2, 3],
      config: { a: 1, b: 2 },
    });
    // schemaVersion is shown in the badge, not the scalar table.
    const scalarKeys = view.scalars.map((s) => s.key);
    expect(scalarKeys).not.toContain("schemaVersion");
    expect(scalarKeys).toEqual(expect.arrayContaining(["steps", "ok", "label"]));
    const nested = Object.fromEntries(view.nested.map((n) => [n.key, n.summary]));
    expect(nested.positions).toBe("array · 3 items");
    expect(nested.config).toBe("object · 2 keys");
  });

  it("collects warnings from warning/disclaimer/error fields", () => {
    const view = normalizeArtifact({
      warnings: ["w1", "w2"],
      disclaimer: "not advice",
      errors: [{ message: "boom" }],
    });
    expect(view.warnings).toContain("w1");
    expect(view.warnings).toContain("not advice");
    expect(view.warnings).toContain("boom");
  });
});

describe("normalizeArtifact — caps and redaction", () => {
  it("caps the number of scalar fields and notes the overflow", () => {
    const huge: Record<string, unknown> = { schemaVersion: "backtest.report.v1" };
    for (let i = 0; i < 200; i += 1) huge[`f${i}`] = i;
    const view = normalizeArtifact(huge);
    expect(view.scalars.length).toBe(ARTIFACT_LIMITS.maxScalarFields);
    expect(view.notes.join(" ")).toContain("additional scalar field");
  });

  it("truncates an over-long scalar string", () => {
    const view = normalizeArtifact({ note: "x".repeat(1000) });
    const field = view.scalars.find((s) => s.key === "note");
    expect(field?.truncated).toBe(true);
    expect(field?.value.length).toBe(ARTIFACT_LIMITS.maxStringValue);
  });

  it("caps the raw preview and records the original length", () => {
    const data: string[] = [];
    for (let i = 0; i < 2000; i += 1) data.push("chunk");
    const view = normalizeArtifact({ data });
    expect(view.preview.truncated).toBe(true);
    expect(view.preview.text.length).toBeLessThanOrEqual(ARTIFACT_LIMITS.maxPreviewChars);
    expect(view.preview.totalChars).toBeGreaterThan(ARTIFACT_LIMITS.maxPreviewChars);
  });

  it("caps the number of warnings", () => {
    const many: string[] = [];
    for (let i = 0; i < 50; i += 1) many.push(`warn-${i}`);
    const view = normalizeArtifact({ warnings: many });
    expect(view.warnings.length).toBe(ARTIFACT_LIMITS.maxWarnings);
    expect(view.notes.join(" ")).toContain("additional warning");
  });
});

describe("normalizeArtifact — non-object roots", () => {
  it("describes a top-level array", () => {
    const view = normalizeArtifact([1, 2, 3]);
    expect(view.rootShape).toBe("array");
    expect(view.kind).toBe("JSON array");
    expect(view.nested[0]?.summary).toBe("array · 3 items");
    expect(view.notes.join(" ")).toContain("array");
  });

  it("describes a top-level primitive", () => {
    const view = normalizeArtifact("just a string");
    expect(view.rootShape).toBe("string");
    expect(view.scalars).toHaveLength(0);
    expect(view.notes.join(" ")).toContain("not an object");
  });

  it("keeps plain (un-escaped) values — escaping is the renderer's job", () => {
    const view = normalizeArtifact({ name: "<script>" });
    const field = view.scalars.find((s) => s.key === "name");
    expect(field?.value).toBe("<script>");
  });
});

describe("toSummaryJson", () => {
  it("derives bounded counts from the normalized view", () => {
    const view = normalizeArtifact({
      schemaVersion: "backtest.report.v1",
      steps: 6,
      positions: [1, 2],
      warnings: ["w"],
    });
    const summary = toSummaryJson(view);
    expect(summary.schemaStatus).toBe("stable");
    expect(summary.rootShape).toBe("object");
    expect(summary.scalarFieldCount).toBe(view.scalars.length);
    expect(summary.nestedFieldCount).toBe(view.nested.length);
    expect(summary.warningCount).toBe(1);
  });
});
