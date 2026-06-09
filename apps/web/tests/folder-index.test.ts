import { describe, expect, it } from "vitest";

import {
  buildFolderIndex,
  extractVerdict,
  toFolderSummaryJson,
  type FolderInputEntry,
} from "../src/lib/folder-index.js";
import { hasTypedView } from "../src/components/artifact-views.js";
import { renderDocument } from "../src/lib/html.js";
import { navItem } from "../src/lib/nav.js";
import { DashboardShell } from "../src/components/layout.js";
import { renderFolderIndex } from "../src/pages/folder.js";

const OPTS = { hasTypedView } as const;

/** A `.json` folder entry from a JS value. */
function json(name: string, value: unknown): FolderInputEntry {
  return { name, type: "json", text: JSON.stringify(value) };
}

/* ------------------------------------------------------------------ *
 * extractVerdict — schema-aware, conservative, never fake.
 * ------------------------------------------------------------------ */

describe("extractVerdict — recognized diff schemas", () => {
  it("reflects hasRegression: true on a schema that carries it", () => {
    const v = extractVerdict("backtest.research.bundle.diff.v1", {
      schemaVersion: "backtest.research.bundle.diff.v1",
      hasRegression: true,
      hasChange: true,
    });
    expect(v.hasRegression).toBe("yes");
    expect(v.hasChange).toBe("yes");
  });

  it("reflects hasRegression: false as 'no'", () => {
    const v = extractVerdict("backtest.research.bundle.diff.v1", {
      hasRegression: false,
      hasChange: false,
    });
    expect(v.hasRegression).toBe("no");
    expect(v.hasChange).toBe("no");
  });

  it("reports a missing carried field as 'missing', NOT 'no'", () => {
    const v = extractVerdict("backtest.research.bundle.diff.v1", { hasChange: true });
    expect(v.hasRegression).toBe("missing");
    expect(v.hasChange).toBe("yes");
    expect(v.notes.join(" ")).toContain("missing");
  });

  it("reports a wrong-typed flag as 'missing', not a truthy 'yes'", () => {
    const v = extractVerdict("backtest.research.bundle.diff.v1", {
      hasRegression: "true",
      hasChange: 1,
    });
    expect(v.hasRegression).toBe("missing");
    expect(v.hasChange).toBe("missing");
  });

  it("marks a field the schema does not carry as 'not-applicable'", () => {
    // The manifest diff carries hasChange only — no hasRegression concept.
    const v = extractVerdict("backtest.research.manifest.diff.v1", { hasChange: true });
    expect(v.hasChange).toBe("yes");
    expect(v.hasRegression).toBe("not-applicable");
  });

  it("treats the sensitivity diff as regression-only (change not-applicable)", () => {
    const v = extractVerdict("backtest.sensitivity.diff.v1", { hasRegression: false });
    expect(v.hasRegression).toBe("no");
    expect(v.hasChange).toBe("not-applicable");
  });
});

describe("extractVerdict — non-diff, unknown, and absent schemas", () => {
  it("returns not-applicable for a recognized non-diff schema", () => {
    const v = extractVerdict("backtest.report.v1", { schemaVersion: "backtest.report.v1" });
    expect(v.hasRegression).toBe("not-applicable");
    expect(v.hasChange).toBe("not-applicable");
    expect(v.notes.join(" ")).toContain("non-diff");
  });

  it("does NOT fake a verdict for an unknown schema, even if the object carries the booleans", () => {
    const v = extractVerdict("totally.made.up.v9", {
      hasRegression: true,
      hasChange: true,
    });
    expect(v.hasRegression).toBe("not-applicable");
    expect(v.hasChange).toBe("not-applicable");
    expect(v.notes.join(" ")).toContain("Unrecognized");
  });

  it("returns not-applicable for an absent schema (null)", () => {
    const v = extractVerdict(null, { hasRegression: true });
    expect(v.hasRegression).toBe("not-applicable");
    expect(v.hasChange).toBe("not-applicable");
  });

  it("reports missing (not no) for a diff schema whose value is not an object", () => {
    const v = extractVerdict("backtest.research.bundle.diff.v1", "not-an-object");
    expect(v.hasRegression).toBe("missing");
    expect(v.hasChange).toBe("missing");
  });
});

/* ------------------------------------------------------------------ *
 * buildFolderIndex — defensive, deterministic aggregation.
 * ------------------------------------------------------------------ */

/** A representative, deliberately-unsorted folder. */
function sampleEntries(): FolderInputEntry[] {
  return [
    json("z-report.json", { schemaVersion: "backtest.report.v1", scenarioName: "s" }),
    json("a-bundle-diff.json", {
      schemaVersion: "backtest.research.bundle.diff.v1",
      hasRegression: true,
      hasChange: true,
    }),
    json("m-manifest-diff.json", {
      schemaVersion: "backtest.research.manifest.diff.v1",
      hasChange: true,
    }),
    json("u-unknown.json", { schemaVersion: "made.up.v1", hasRegression: true }),
    json("n-no-schema.json", { value: 1 }),
    { name: "broken.json", type: "json", text: "{ not valid,," },
    { name: "notes.txt", type: "skipped", reason: "not a .json file" },
    { name: "nested", type: "skipped", reason: "subdirectory (not scanned — no recursion)" },
  ];
}

describe("buildFolderIndex — counts", () => {
  const index = buildFolderIndex(sampleEntries(), OPTS);

  it("produces honest top-level counts", () => {
    expect(index.counts.filesScanned).toBe(8);
    expect(index.counts.jsonFiles).toBe(6);
    expect(index.counts.validArtifacts).toBe(5);
    expect(index.counts.malformedFiles).toBe(1);
    expect(index.counts.skippedFiles).toBe(2);
    expect(index.counts.unknownSchemas).toBe(1);
    expect(index.counts.absentSchemas).toBe(1);
    expect(index.counts.withRegression).toBe(1);
    expect(index.counts.withChange).toBe(2);
  });

  it("does not crash on malformed JSON and lists it as malformed", () => {
    const broken = index.artifacts.find((a) => a.name === "broken.json");
    expect(broken?.status).toBe("malformed");
    expect(broken?.parseError).toBeTruthy();
    expect(broken?.view).toBeNull();
    expect(broken?.verdict.hasRegression).toBe("not-applicable");
  });

  it("skips non-JSON files and subdirectories with a reason, never as artifacts", () => {
    expect(index.skipped.map((s) => s.name).sort()).toEqual(["nested", "notes.txt"]);
    expect(index.artifacts.map((a) => a.name)).not.toContain("notes.txt");
    expect(index.artifacts.map((a) => a.name)).not.toContain("nested");
  });

  it("labels an unknown schema as unknown (not stable), with no typed view", () => {
    const unknown = index.artifacts.find((a) => a.name === "u-unknown.json");
    expect(unknown?.schemaStatus).toBe("unknown");
    expect(unknown?.hasTypedView).toBe(false);
    expect(unknown?.verdict.hasRegression).toBe("not-applicable");
  });

  it("surfaces registry kind/title + a typed view for a recognized schema", () => {
    const bundle = index.artifacts.find((a) => a.name === "a-bundle-diff.json");
    expect(bundle?.schemaStatus).toBe("stable");
    expect(bundle?.schemaTitle).toBe("Research bundle diff");
    expect(bundle?.hasTypedView).toBe(true);
  });
});

describe("buildFolderIndex — determinism + structure", () => {
  it("sorts artifacts and skipped entries by name regardless of input order", () => {
    const a = buildFolderIndex(sampleEntries(), OPTS);
    const shuffled = [...sampleEntries()].reverse();
    const b = buildFolderIndex(shuffled, OPTS);
    expect(a.artifacts.map((x) => x.name)).toEqual(b.artifacts.map((x) => x.name));
    expect(a.artifacts.map((x) => x.name)).toEqual([
      "a-bundle-diff.json",
      "broken.json",
      "m-manifest-diff.json",
      "n-no-schema.json",
      "u-unknown.json",
      "z-report.json",
    ]);
    // Stable anchors too.
    expect(a.artifacts.map((x) => x.anchor)).toEqual(b.artifacts.map((x) => x.anchor));
  });

  it("gives every artifact a unique, sanitized anchor", () => {
    const index = buildFolderIndex(sampleEntries(), OPTS);
    const anchors = index.artifacts.map((a) => a.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
    for (const anchor of anchors) {
      expect(anchor).toMatch(/^sm-artifact-\d+-[a-z0-9-]+$/);
    }
  });

  it("groups schemaCounts by id, sorted by count desc then key asc", () => {
    const entries = [
      json("r1.json", { schemaVersion: "backtest.report.v1" }),
      json("r2.json", { schemaVersion: "backtest.report.v1" }),
      json("s1.json", { schemaVersion: "backtest.suite.v1" }),
    ];
    const index = buildFolderIndex(entries, OPTS);
    expect(index.schemaCounts).toEqual([
      { key: "backtest.report.v1", status: "stable", count: 2 },
      { key: "backtest.suite.v1", status: "stable", count: 1 },
    ]);
  });

  it("returns a safe empty index for no entries", () => {
    const index = buildFolderIndex([], OPTS);
    expect(index.counts.filesScanned).toBe(0);
    expect(index.artifacts).toHaveLength(0);
    expect(index.notes.join(" ")).toContain("no entries");
  });
});

describe("toFolderSummaryJson", () => {
  it("derives a light, serializable summary without view/raw", () => {
    const index = buildFolderIndex(sampleEntries(), OPTS);
    const summary = toFolderSummaryJson(index);
    expect(summary.counts).toEqual(index.counts);
    expect(summary.artifacts.every((a) => !("view" in a) && !("raw" in a))).toBe(true);
    const bundle = summary.artifacts.find((a) => a.name === "a-bundle-diff.json");
    expect(bundle?.hasRegression).toBe("yes");
    expect(bundle?.hasChange).toBe("yes");
  });

  it("is deterministic across two builds (stable JSON)", () => {
    const a = JSON.stringify(toFolderSummaryJson(buildFolderIndex(sampleEntries(), OPTS)));
    const b = JSON.stringify(toFolderSummaryJson(buildFolderIndex([...sampleEntries()].reverse(), OPTS)));
    expect(a).toBe(b);
  });
});

/* ------------------------------------------------------------------ *
 * renderFolderIndex — loaded page is safe + escaped + deterministic.
 * ------------------------------------------------------------------ */

/** Render the loaded folder page exactly as the inspect command does. */
function renderLoaded(index: ReturnType<typeof buildFolderIndex>, name: string): string {
  const nav = navItem("folder");
  return renderDocument(
    DashboardShell({
      activeId: nav.id,
      title: nav.label,
      description: nav.description,
      body: renderFolderIndex(index, { name }),
    }),
  );
}

describe("renderFolderIndex — loaded page", () => {
  const FORBIDDEN: readonly RegExp[] = [
    /<script/i,
    /\son(?:click|load|error|mouseover|focus|submit|change|input)\s*=/i,
    /\bfetch\s*\(/,
    /\baxios\b/i,
    /\bWebSocket\b/,
    /@import/,
    /url\(/,
    /https?:\/\//,
    /\[object Object\]/,
    /\bundefined\b/,
    /\bNaN\b/,
    /\$\{/,
  ];

  it("renders a complete, safe document with verdict + safety chrome", () => {
    const out = renderLoaded(buildFolderIndex(sampleEntries(), OPTS), "folder-sample");
    expect(out.startsWith("<!doctype html>")).toBe(true);
    expect(out).toContain("PAPER ONLY");
    expect(out).toContain("sm-folderindex");
    expect(out).toContain("sm-verdict--regression");
    expect(out).toContain("Scan summary");
    expect(out).toContain("Verdict legend");
    for (const re of FORBIDDEN) {
      expect(out, `should not match ${re}`).not.toMatch(re);
    }
  });

  it("links each artifact to a per-artifact section anchor", () => {
    const index = buildFolderIndex(sampleEntries(), OPTS);
    const out = renderLoaded(index, "folder-sample");
    for (const artifact of index.artifacts) {
      expect(out, `missing link for ${artifact.name}`).toContain(`href="#${artifact.anchor}"`);
      expect(out, `missing section for ${artifact.name}`).toContain(`id="${artifact.anchor}"`);
    }
  });

  it("escapes a hostile filename and hostile artifact content instead of injecting it", () => {
    const entries: FolderInputEntry[] = [
      json("<img src=x onerror=alert(1)>.json", {
        schemaVersion: "backtest.report.v1",
        scenarioName: "<script>alert('xss')</script>",
      }),
    ];
    const out = renderLoaded(buildFolderIndex(entries, OPTS), "<b>folder</b>");
    expect(out).not.toContain("<img src=x");
    expect(out).not.toContain("<script>alert");
    expect(out).toContain("&lt;img src=x");
    expect(out).toContain("&lt;script&gt;");
  });

  it("is deterministic across renders", () => {
    const index = buildFolderIndex(sampleEntries(), OPTS);
    expect(renderLoaded(index, "folder-sample")).toBe(renderLoaded(index, "folder-sample"));
  });
});
