import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { renderToString } from "../src/lib/html.js";
import { normalizeArtifact, parseArtifactJson } from "../src/lib/local-artifact.js";
import { knownSchema } from "../src/lib/report-types.js";
import { hasTypedView, renderTypedArtifactView } from "../src/components/artifact-views.js";

/** Render a typed view for a raw value, or null when there is no typed view. */
function typed(raw: unknown): string | null {
  const view = renderTypedArtifactView(normalizeArtifact(raw), raw);
  return view === null ? null : renderToString(view);
}

/** Patterns that must never appear in any typed view render. */
const FORBIDDEN: readonly RegExp[] = [
  /<script/i,
  /\son(?:click|load|error|mouseover|focus|submit|change|input)\s*=/i,
  /\bfetch\s*\(/,
  /\baxios\b/i,
  /\bWebSocket\b/,
  /\bsignTransaction\b/,
  /\bsendTransaction\b/,
  /\bKeypair\b/,
  /\bprivateKey\b/,
  /\bsecretKey\b/,
  /\bmnemonic\b/i,
  /https?:\/\//,
  /@import/,
  /\[object Object\]/,
  /\bundefined\b/,
  /\bNaN\b/,
];

describe("renderTypedArtifactView — dispatch", () => {
  it("selects a typed view for a known schema", () => {
    const out = typed({ schemaVersion: "backtest.report.v1", scenarioName: "x" });
    expect(out).not.toBeNull();
    expect(out).toContain("sm-typedview");
    expect(out).toContain("Schema-aware view — Backtest report");
  });

  it("falls back (null) for an unknown schema", () => {
    expect(typed({ schemaVersion: "totally.made.up.v9", a: 1 })).toBeNull();
  });

  it("falls back (null) when schemaVersion is absent", () => {
    expect(typed({ scenarioName: "x" })).toBeNull();
  });

  it("falls back (null) when a known schema's value is not an object", () => {
    const arr: unknown = ["backtest.report.v1"];
    expect(renderTypedArtifactView(normalizeArtifact({ schemaVersion: "backtest.report.v1" }), arr)).toBeNull();
  });

  it("never throws on malformed / type-mismatched shapes", () => {
    const hostileShapes: unknown[] = [
      { schemaVersion: "backtest.report.v1", planCounts: "nope", pnl: 42, perMint: "x" },
      { schemaVersion: "backtest.suite.v1", summary: 1, entries: "no" },
      { schemaVersion: "backtest.sensitivity.v1", rankings: 5, variants: {} },
      { schemaVersion: "backtest.research.manifest.v1", artifacts: 3, kindCounts: null },
      { schemaVersion: "backtest.research.status.v1", manifest: [] },
    ];
    for (const shape of hostileShapes) {
      expect(() => typed(shape)).not.toThrow();
      expect(typed(shape)).not.toBeNull();
    }
  });

  it("escapes hostile string values instead of injecting them", () => {
    const out = typed({
      schemaVersion: "backtest.report.v1",
      scenarioName: "<script>alert(1)</script>",
      scenarioDigest: '"><img src=x onerror=alert(1)>',
    });
    expect(out).not.toContain("<script>alert");
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;script&gt;");
  });

  it("shows an honest partial-view notice when expected fields are missing", () => {
    const out = typed({ schemaVersion: "backtest.report.v1" });
    expect(out).toContain("Partial view");
    expect(out).toContain("scenarioName");
  });

  it("enforces table row caps and reports the hidden count", () => {
    const entries = Array.from({ length: 100 }, (_v, i) => ({
      index: i,
      id: `s${i}`,
      scenarioName: `scenario-${i}`,
      status: "passed",
      runStatus: "passed",
      lintStatus: "valid",
    }));
    const out = typed({ schemaVersion: "backtest.suite.v1", summary: {}, entries });
    expect(out).toContain("Showing 40 of 100 scenarios — 60 more not shown.");
    // The 41st scenario must not be rendered.
    expect(out).not.toContain("scenario-41");
  });

  it("is deterministic for the same input", () => {
    const raw = { schemaVersion: "backtest.report.v1", scenarioName: "x", stepCount: 6 };
    expect(typed(raw)).toBe(typed(raw));
  });
});

describe("hasTypedView", () => {
  it("is true for shipped typed schemas and false otherwise", () => {
    expect(hasTypedView("backtest.report.v1")).toBe(true);
    expect(hasTypedView("backtest.research.status.v1")).toBe(true);
    expect(hasTypedView("totally.unknown.v9")).toBe(false);
    expect(hasTypedView(null)).toBe(false);
  });
});

describe("typed views — per schema (inline minimal shapes)", () => {
  const cases: readonly { schema: string; raw: Record<string, unknown>; expect: string }[] = [
    {
      schema: "backtest.report.v1",
      raw: { schemaVersion: "backtest.report.v1", scenarioName: "s", pnl: { totalUsd: 1 } },
      expect: "Simulated PnL (not real, not advice)",
    },
    {
      schema: "backtest.suite.v1",
      raw: { schemaVersion: "backtest.suite.v1", name: "s", summary: {}, entries: [] },
      expect: "Simulated totals (not real, not advice)",
    },
    {
      schema: "backtest.suite.diff.v1",
      raw: { schemaVersion: "backtest.suite.diff.v1", hasRegression: false, changed: [] },
      expect: "Changed scenarios",
    },
    {
      schema: "backtest.sensitivity.v1",
      raw: { schemaVersion: "backtest.sensitivity.v1", baseScenarioName: "s", variantCount: 0, variants: [] },
      expect: "Top movers — total simulated PnL Δ",
    },
    {
      schema: "backtest.sensitivity.diff.v1",
      raw: { schemaVersion: "backtest.sensitivity.diff.v1", hasRegression: true, regressionReasons: ["r"], changed: [] },
      expect: "Regression flagged by this sensitivity diff",
    },
    {
      schema: "backtest.coverage.v1",
      raw: {
        schemaVersion: "backtest.coverage.v1",
        counts: { scenarioCount: 1 },
        pathBehaviours: { tracked: ["a"], covered: ["a"], coveredCount: 1, trackedCount: 1 },
      },
      expect: "Tracked behaviours",
    },
    {
      schema: "backtest.variant-plan.explain.v1",
      raw: { schemaVersion: "backtest.variant-plan.explain.v1", valid: true, variants: [] },
      expect: "Variant plan is valid (dry-run)",
    },
    {
      schema: "backtest.sensitivity.matrix.v1",
      raw: { schemaVersion: "backtest.sensitivity.matrix.v1", baseCount: 0, variantCount: 0, bases: [], variantAggregates: [] },
      expect: "Per-variant aggregates",
    },
    {
      schema: "backtest.sensitivity.matrix.diff.v1",
      raw: { schemaVersion: "backtest.sensitivity.matrix.diff.v1", hasRegression: false, changedBases: [] },
      expect: "Changed bases",
    },
    {
      schema: "backtest.research.manifest.v1",
      raw: { schemaVersion: "backtest.research.manifest.v1", artifactCount: 0, artifacts: [], kindCounts: [], schemaCounts: [] },
      expect: "Run manifest",
    },
    {
      schema: "backtest.research.verify.v1",
      raw: { schemaVersion: "backtest.research.verify.v1", valid: false, artifacts: [] },
      expect: "Verification failed — manifest is out of sync",
    },
    {
      schema: "backtest.research.manifest.diff.v1",
      raw: { schemaVersion: "backtest.research.manifest.diff.v1", hasChange: false, changed: [] },
      expect: "Changed artifacts",
    },
    {
      schema: "backtest.research.bundle.v1",
      raw: { schemaVersion: "backtest.research.bundle.v1", runDigest: "d", artifactCount: 0, kindCounts: [], schemaCounts: [] },
      expect: "Manifest summary",
    },
    {
      schema: "backtest.research.status.v1",
      raw: { schemaVersion: "backtest.research.status.v1", complete: true, manifest: {} },
      expect: "Manifest check",
    },
    {
      schema: "backtest.research.campaign.index.v1",
      raw: { schemaVersion: "backtest.research.campaign.index.v1", campaignDigest: "d", runCount: 0, runs: [], aggregateKindCounts: [] },
      expect: "Aggregate kinds",
    },
  ];

  for (const c of cases) {
    describe(c.schema, () => {
      const out = typed(c.raw) ?? "";

      it("renders its schema-specific heading", () => {
        expect(out).toContain("sm-typedview");
        expect(out).toContain(c.expect);
      });

      it("contains no script / handler / network / wallet / leak patterns", () => {
        for (const re of FORBIDDEN) {
          expect(out, `should not match ${re}`).not.toMatch(re);
        }
      });
    });
  }
});

describe("typed views — committed fixtures", () => {
  const fixturesDir = fileURLToPath(new URL("../fixtures/", import.meta.url));
  const files = readdirSync(fixturesDir).filter((name) => name.endsWith(".json"));

  it("has at least the representative fixtures", () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  for (const file of files) {
    describe(file, () => {
      const parsed = parseArtifactJson(readFileSync(fileURLToPath(new URL(`../fixtures/${file}`, import.meta.url)), "utf8"));
      const raw = parsed.ok ? parsed.value : undefined;
      const view = normalizeArtifact(raw);
      const out = typed(raw) ?? "";

      it("parses and renders a typed view with the registry title", () => {
        expect(parsed.ok).toBe(true);
        expect(view.schemaVersion).not.toBeNull();
        const info = view.schemaVersion ? knownSchema(view.schemaVersion) : undefined;
        expect(info, `fixture ${file} should declare a known schema`).toBeTruthy();
        expect(out).toContain("sm-typedview");
        if (info) expect(out).toContain(`Schema-aware view — ${info.title}`);
      });

      it("echoes self-declared paper-only posture when the schema carries it", () => {
        // Most report schemas embed a paperOnly envelope; the conservative diff
        // schemas carry only `disclaimers`. The view must echo the flag iff present.
        const rec = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
        if (rec["paperOnly"] === true) {
          expect(out).toContain("self-declared — paperOnly: yes");
        } else {
          expect(out).not.toContain("self-declared — paperOnly");
        }
      });

      it("contains no script / handler / network / wallet / leak patterns", () => {
        for (const re of FORBIDDEN) {
          expect(out, `${file} should not match ${re}`).not.toMatch(re);
        }
      });
    });
  }
});
