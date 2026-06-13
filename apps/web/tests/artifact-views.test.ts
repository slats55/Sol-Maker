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
      { schemaVersion: "backtest.research.bundle.diff.v1", added: "no", changed: 5, kindCountChanges: {} },
      { schemaVersion: "backtest.research.campaign.diff.v1", changedRuns: 7, addedRuns: "x", aggregateKindCountChanges: 1 },
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
      expect: "Base × variant grid",
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
    {
      schema: "backtest.research.bundle.diff.v1",
      raw: {
        schemaVersion: "backtest.research.bundle.diff.v1",
        hasChange: false,
        hasRegression: false,
        added: [],
        removed: [],
        changed: [],
      },
      expect: "Compared bundles",
    },
    {
      schema: "backtest.research.campaign.diff.v1",
      raw: {
        schemaVersion: "backtest.research.campaign.diff.v1",
        hasChange: false,
        hasRegression: false,
        addedRuns: [],
        removedRuns: [],
        changedRuns: [],
      },
      expect: "Compared campaigns",
    },
    {
      schema: "sniper.mainnet_dryrun.release_candidate.v1",
      raw: {
        schemaVersion: "sniper.mainnet_dryrun.release_candidate.v1",
        verdict: "dryrun-blocked-risk",
        liveSendStatus: "disabled",
        network: "mainnet-beta",
        mode: "mainnet-dry-run",
        phase7LiveTradingReady: false,
        neverSends: true,
        neverSigns: true,
        candidateSource: { kind: "file", label: "candidates.json" },
        scoring: { available: true, engineSource: "rust", candidateCount: 1, bestCandidateId: "c1", rankedCandidates: [{ candidateId: "c1", mint: "So11111111111111111111111111111111111111112", rank: 1, score: 50, verdict: "reject", reasonCodes: ["risk-rejected"] }] },
        risk: { assessed: true, source: "automatic", worstDecision: "REJECT", rejected: true, criticalFlagCount: 1, highFlagCount: 0, token2022Blocker: false, token2022BlockerMints: [] },
        quote: { attempted: true, observed: true, freshness: "fresh", scoreAvailable: true, score: 90 },
        build: { attempted: false, refused: false, succeeded: false, refusalCodes: [] },
        txInspection: { available: false, versionSupported: null, blockhashPresent: null, instructionCount: null, unresolvableProgramIdCount: null },
        simulation: { attempted: false, outcome: null, classification: null, failed: false },
        readiness: { available: true, verdict: "blocked", satisfiedCount: 8, totalChecks: 14 },
        whyLiveBlocked: ["live disabled by policy"],
        nextSafeActions: ["drop the rejected candidate"],
        caveats: ["intelligence only"],
        artifactRefs: ["candidate-scores.json"],
      },
      expect: "LIVE SENDING DISABLED",
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

describe("matrix base × variant grid drill-down", () => {
  const matrixRaw = {
    schemaVersion: "backtest.sensitivity.matrix.v1",
    baseCount: 2,
    variantCount: 2,
    bases: [
      {
        index: 0,
        baseScenarioName: "alpha",
        baselineStatus: "passed",
        cells: [
          { suffix: "+10pct", status: "passed", deltas: { totalPnlUsd: { base: 1, next: 3, delta: 2 } } },
          { suffix: "-10pct", status: "failed", deltas: null },
        ],
      },
      {
        index: 1,
        baseScenarioName: "beta",
        baselineStatus: "passed",
        cells: [{ suffix: "+10pct", status: "passed", deltas: { totalPnlUsd: { base: 1, next: 0.5, delta: -0.5 } } }],
      },
    ],
    variantAggregates: [],
  };
  const out = typed(matrixRaw) ?? "";

  it("renders a grid with variant columns and signed PnL-delta cells", () => {
    expect(out).toContain("Base × variant grid");
    expect(out).toContain("Base scenario");
    expect(out).toContain("+10pct");
    expect(out).toContain("-10pct");
    expect(out).toContain("alpha");
    expect(out).toContain("+2");
  });

  it("shows '·' for an absent cell and a status word for a non-diffable cell", () => {
    expect(out).toContain("·");
    expect(out).toContain("failed");
  });

  it("caps columns and notes hidden variants", () => {
    const manyCols = {
      schemaVersion: "backtest.sensitivity.matrix.v1",
      bases: [
        {
          baseScenarioName: "b0",
          cells: Array.from({ length: 30 }, (_v, i) => ({
            suffix: `v${i}`,
            status: "passed",
            deltas: { totalPnlUsd: { base: 0, next: i, delta: i } },
          })),
        },
      ],
    };
    const o = typed(manyCols) ?? "";
    expect(o).toContain("more variants not shown");
    expect(o).not.toContain("v20");
  });

  it("caps grid rows and notes hidden bases", () => {
    // 50 bases exceeds both the grid row cap (24) and the per-base table cap (40),
    // so a base past index 40 must not appear anywhere in the rendered view.
    const manyRows = {
      schemaVersion: "backtest.sensitivity.matrix.v1",
      bases: Array.from({ length: 50 }, (_v, i) => ({
        baseScenarioName: `base-${i}`,
        cells: [{ suffix: "+10pct", status: "passed", deltas: { totalPnlUsd: { base: 0, next: 1, delta: 1 } } }],
      })),
    };
    const o = typed(manyRows) ?? "";
    expect(o).toContain("more bases not shown");
    expect(o).not.toContain("base-45");
  });

  it("escapes a hostile variant suffix in the grid header", () => {
    const hostile = {
      schemaVersion: "backtest.sensitivity.matrix.v1",
      bases: [
        {
          baseScenarioName: "b",
          cells: [
            { suffix: "<script>x</script>", status: "passed", deltas: { totalPnlUsd: { base: 0, next: 1, delta: 1 } } },
          ],
        },
      ],
    };
    const o = typed(hostile) ?? "";
    expect(o).not.toContain("<script>x");
    expect(o).toContain("&lt;script&gt;");
  });

  it("does not throw on malformed bases/cells", () => {
    expect(() => typed({ schemaVersion: "backtest.sensitivity.matrix.v1", bases: "nope" })).not.toThrow();
    expect(() => typed({ schemaVersion: "backtest.sensitivity.matrix.v1", bases: [1, "x", { cells: 5 }] })).not.toThrow();
  });
});

describe("matrix diff — changed cells", () => {
  it("flattens per-base changed cells into a capped table", () => {
    const raw = {
      schemaVersion: "backtest.sensitivity.matrix.diff.v1",
      hasRegression: true,
      regressionReasons: ["alpha +10pct regressed"],
      changedBases: [
        {
          baseScenarioName: "alpha",
          cellsChanged: [{ suffix: "+10pct", baseStatus: "passed", nextStatus: "failed", isRegression: true }],
        },
      ],
    };
    const out = typed(raw) ?? "";
    expect(out).toContain("Changed cells");
    expect(out).toContain("+10pct");
    expect(out).toContain("passed → failed");
  });
});

describe("research bundle diff — typed view (Sprint 19)", () => {
  const base = {
    schemaVersion: "backtest.research.bundle.diff.v1",
    hasChange: true,
    hasRegression: true,
    regressionReasons: ["1 artifact(s) removed", "1 artifact(s) changed content digest"],
    changeReasons: ["run digest changed", "1 artifact(s) added"],
    added: [{ path: "reports/new.json", digest: "add-digest-aaaa" }],
    removed: [{ path: "reports/gone.json", digest: "rm-digest-bbbb" }],
    changed: [{ path: "reports/buy-hold.report.json", baseDigest: "base-cccc", nextDigest: "next-dddd" }],
    kindCountChanges: [{ key: "sensitivity-report", base: 0, next: 1, delta: 1 }],
    schemaCountChanges: [{ key: "backtest.sensitivity.v1", base: 0, next: 1, delta: 1 }],
    recognizedSchemasAdded: ["backtest.sensitivity.v1"],
    recognizedSchemasRemoved: ["backtest.suite.v1"],
  };
  const out = typed(base) ?? "";

  it("leads with a conservative integrity regression notice and reasons", () => {
    expect(out).toContain("Integrity regression flagged by this bundle diff");
    expect(out).toContain("1 artifact(s) removed");
  });

  it("renders a combined add/remove/change artifact table", () => {
    expect(out).toContain("Artifact changes");
    expect(out).toContain("reports/new.json");
    expect(out).toContain("reports/gone.json");
    expect(out).toContain("reports/buy-hold.report.json");
    expect(out).toContain("added");
    expect(out).toContain("removed");
    expect(out).toContain("changed");
  });

  it("renders kind + schema count changes with a scope column", () => {
    expect(out).toContain("Count changes");
    expect(out).toContain("sensitivity-report");
    expect(out).toContain("backtest.sensitivity.v1");
  });

  it("caps the combined artifact table and reports the hidden count", () => {
    const many = {
      schemaVersion: "backtest.research.bundle.diff.v1",
      hasChange: true,
      hasRegression: false,
      added: Array.from({ length: 100 }, (_v, i) => ({ path: `reports/a${i}.json`, digest: `d${i}` })),
      removed: [],
      changed: [],
    };
    const o = typed(many) ?? "";
    expect(o).toContain("Showing 40 of 100 artifacts — 60 more not shown.");
    expect(o).not.toContain("reports/a41.json");
  });

  it("shows a partial-view notice when the verdict flags are absent", () => {
    const o = typed({ schemaVersion: "backtest.research.bundle.diff.v1", added: [], removed: [], changed: [] }) ?? "";
    expect(o).toContain("Partial view");
    expect(o).toContain("hasChange");
    expect(o).toContain("hasRegression");
  });

  it("escapes a hostile artifact path", () => {
    const o =
      typed({
        schemaVersion: "backtest.research.bundle.diff.v1",
        hasChange: true,
        hasRegression: false,
        added: [{ path: "<script>x</script>", digest: "d" }],
        removed: [],
        changed: [],
      }) ?? "";
    expect(o).not.toContain("<script>x");
    expect(o).toContain("&lt;script&gt;");
  });
});

describe("research campaign diff — typed view (Sprint 19)", () => {
  const base = {
    schemaVersion: "backtest.research.campaign.diff.v1",
    hasChange: true,
    hasRegression: true,
    regressionReasons: ['run "run-b" became invalid'],
    changeReasons: ["campaign digest changed"],
    addedRuns: [{ runId: "run-d", runDigest: "d", valid: false }],
    removedRuns: [{ runId: "run-a", runDigest: "a", valid: true }],
    changedRuns: [
      {
        runId: "run-b",
        runDigestChanged: true,
        baseValid: true,
        nextValid: false,
        becameInvalid: true,
        artifactCount: { base: 6, next: 7, delta: 1 },
      },
    ],
    newlyNeedsAttention: ["run-b", "run-d"],
    noLongerNeedsAttention: [],
    aggregateKindCountChanges: [{ key: "sensitivity-report", base: 2, next: 3, delta: 1 }],
    aggregateSchemasAdded: ["backtest.sensitivity.matrix.v1"],
    aggregateSchemasRemoved: [],
  };
  const out = typed(base) ?? "";

  it("leads with a conservative integrity regression notice and reasons", () => {
    expect(out).toContain("Integrity regression flagged by this campaign diff");
    expect(out).toContain("became invalid");
  });

  it("renders changed runs with validity transition and artifact delta", () => {
    expect(out).toContain("Changed runs");
    expect(out).toContain("run-b");
    expect(out).toContain("yes → no");
    expect(out).toContain("6 → 7 (+1)");
  });

  it("surfaces the newly-needs-attention run ids", () => {
    expect(out).toContain("newlyNeedsAttention");
    expect(out).toContain("run-b, run-d");
  });

  it("caps the changed-runs table and reports the hidden count", () => {
    const many = {
      schemaVersion: "backtest.research.campaign.diff.v1",
      hasChange: true,
      hasRegression: false,
      addedRuns: [],
      removedRuns: [],
      changedRuns: Array.from({ length: 100 }, (_v, i) => ({
        runId: `run-${i}`,
        runDigestChanged: true,
        baseValid: true,
        nextValid: true,
        becameInvalid: false,
        artifactCount: { base: 1, next: 2, delta: 1 },
      })),
    };
    const o = typed(many) ?? "";
    expect(o).toContain("Showing 40 of 100 runs — 60 more not shown.");
    expect(o).not.toContain("run-41");
  });

  it("shows a partial-view notice when the verdict flags are absent", () => {
    const o =
      typed({ schemaVersion: "backtest.research.campaign.diff.v1", addedRuns: [], removedRuns: [], changedRuns: [] }) ??
      "";
    expect(o).toContain("Partial view");
    expect(o).toContain("hasChange");
  });

  it("escapes a hostile runId", () => {
    const o =
      typed({
        schemaVersion: "backtest.research.campaign.diff.v1",
        hasChange: true,
        hasRegression: false,
        addedRuns: [],
        removedRuns: [],
        changedRuns: [
          {
            runId: "<script>x</script>",
            runDigestChanged: true,
            baseValid: true,
            nextValid: false,
            becameInvalid: true,
            artifactCount: { base: 0, next: 0, delta: 0 },
          },
        ],
      }) ?? "";
    expect(o).not.toContain("<script>x");
    expect(o).toContain("&lt;script&gt;");
  });
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
