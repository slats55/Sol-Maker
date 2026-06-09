/**
 * Tests for the shipped `examples/backtest/` fixtures. They prove every example
 * is a valid, deterministic, INJECTED scenario: it lints clean (with its exact,
 * documented warnings), runs through the real `runBacktest`, and works through the
 * CLI. These are fixtures, not historical market truth.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBacktest, lintBacktestScenario, generateScenarioVariants } from "@soulmaker/backtest";
import {
  paperBacktestReport,
  paperBacktestLintReport,
  paperBacktestSensitivityMatrixReport,
  paperBacktestResearchManifestReport,
  paperBacktestResearchVerifyReport,
  paperSniperCandidatesValidateReport,
  paperSniperReportReport,
} from "./commands.js";

const EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../examples/backtest");
const SNIPER_EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../examples/sniper");

function readExample(name: string): unknown {
  return JSON.parse(readFileSync(join(EXAMPLES_DIR, name), "utf8"));
}

/** Each example with its EXACT expected warning codes (a snapshot of intent). */
const EXAMPLES: { file: string; warnings: string[] }[] = [
  { file: "single-mint-buy-hold.scenario.json", warnings: [] },
  { file: "single-mint-buy-full-exit.scenario.json", warnings: [] },
  { file: "multi-mint-partial-exit.scenario.json", warnings: [] },
  { file: "seed-journal-continuation.scenario.json", warnings: ["initial-journal-open-positions"] },
];

describe("examples/backtest — fixtures validate, lint, and run", () => {
  for (const { file, warnings } of EXAMPLES) {
    it(`${file} lints as valid with exactly the expected warnings`, () => {
      const lint = lintBacktestScenario(readExample(file));
      expect(lint.valid).toBe(true);
      expect(lint.errors).toEqual([]);
      expect(lint.warnings.map((w) => w.code)).toEqual(warnings);
    });

    it(`${file} runs through runBacktest deterministically`, () => {
      const a = runBacktest(readExample(file));
      const b = runBacktest(readExample(file));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a.banner).toBe("SIMULATED PAPER-ONLY REPORT");
      expect(a.schemaVersion).toBe("backtest.report.v1");
      expect(a.equityCurve).toHaveLength(a.stepCount);
    });
  }

  it("buy-hold holds an open position with deterministic unrealized PnL", () => {
    const r = runBacktest(readExample("single-mint-buy-hold.scenario.json"));
    expect(r.fillCounts).toEqual({ buyCount: 1, sellCount: 0 });
    expect(r.positionCounts).toEqual({ open: 1, closed: 0 });
    expect(r.pnl.realizedUsd).toBe(0);
    expect(r.pnl.unrealizedUsd).toBe(50); // (3 - 2) * 50
  });

  it("full-exit realizes a deterministic +50 and closes the position", () => {
    const r = runBacktest(readExample("single-mint-buy-full-exit.scenario.json"));
    expect(r.fillCounts).toEqual({ buyCount: 1, sellCount: 1 });
    expect(r.positionCounts).toEqual({ open: 0, closed: 1 });
    expect(r.pnl.realizedUsd).toBe(50);
  });

  it("multi-mint partial-exits one mint, holds another, rejects a third", () => {
    const r = runBacktest(readExample("multi-mint-partial-exit.scenario.json"));
    expect(r.fillCounts.buyCount).toBe(2); // A + B bought (C blocked by the risk gate)
    expect(r.fillCounts.sellCount).toBe(1); // A scaled out (partial)
    expect(r.positionCounts.open).toBe(2); // A (reduced) + B (held)
    expect(r.planCounts.rejectedCount).toBeGreaterThanOrEqual(1); // C disqualified at plan time
    // Per-mint covers exactly the two filled mints (C never filled).
    expect(r.perMint.map((m) => m.mint)).toHaveLength(2);
    const a = r.perMint.find((m) => m.mint.startsWith("FakeAAA"))!;
    expect(a.openQuantity).toBeGreaterThan(0);
    expect(a.openQuantity).toBeLessThan(50);
  });

  it("seed-journal continuation exits the seeded position for +50", () => {
    const r = runBacktest(readExample("seed-journal-continuation.scenario.json"));
    expect(r.fillCounts.sellCount).toBe(1); // seeded A fully exited
    expect(r.pnl.realizedUsd).toBe(50);
  });

  it("price-sensitivity variant plan generates valid, runnable variants from the buy-hold base", () => {
    const base = readExample("single-mint-buy-hold.scenario.json");
    const plan = readExample("price-sensitivity.variant-plan.json");
    const result = generateScenarioVariants(base, plan);
    expect(result.variants.map((v) => v.suffix)).toEqual([
      "price-up-10pct",
      "price-down-10pct",
      "price-plus-1usd",
    ]);
    for (const v of result.variants) {
      // Each variant changed both injected MINT_A price points.
      expect(v.changeCount).toBe(2);
      // Names retain the base's INJECTED labelling; nothing claims a live result.
      expect(v.scenario.name).toContain("INJECTED FIXTURE");
      expect(lintBacktestScenario(v.scenario).valid).toBe(true);
      expect(() => runBacktest(v.scenario)).not.toThrow();
    }
    // A uniform price multiplier is PnL-invariant (fixed-USD sizing buys inversely
    // more units at a lower entry), but a +$1 additive shift raises the entry and
    // lowers simulated unrealized PnL. Both are bookkeeping from injected prices —
    // never a live result.
    const up = runBacktest(result.variants[0]!.scenario); // ×1.1
    const plus = runBacktest(result.variants[2]!.scenario); // +$1
    expect(up.pnl.unrealizedUsd).toBeCloseTo(50);
    expect(plus.pnl.unrealizedUsd).toBeLessThan(up.pnl.unrealizedUsd);
  });
});

describe("examples/backtest — CLI smoke", () => {
  it("paper:backtest:lint reports an example as VALID", () => {
    const out = paperBacktestLintReport(
      { cwd: EXAMPLES_DIR, env: {} },
      { scenarioPath: "single-mint-buy-full-exit.scenario.json" },
    );
    expect(out).not.toMatch(/^Refusing/);
    expect(out).toContain("(VALID)");
  });

  it("paper:backtest human output carries the required labels", () => {
    const out = paperBacktestReport(
      { cwd: EXAMPLES_DIR, env: {} },
      { scenarioPath: "single-mint-buy-full-exit.scenario.json" },
    );
    expect(out).toContain("SIMULATED PAPER-ONLY REPORT");
    expect(out).toContain("simulated fills:   1 buy / 1 sell");
  });

  it("paper:backtest:sensitivity:matrix sweeps ALL shipped scenarios through the shipped plan", () => {
    // The four shipped *.scenario.json files are all compatible with the shipped price
    // plan, so the examples directory IS a ready-made 4-base × 3-variant matrix. This
    // locks that coherence: a future incompatible example would fail here loudly.
    const r = paperBacktestSensitivityMatrixReport(
      { cwd: join(EXAMPLES_DIR, "../.."), env: {} },
      {
        dir: "examples/backtest",
        planPath: "examples/backtest/price-sensitivity.variant-plan.json",
        json: true,
      },
    );
    expect(r.exitCode).toBe(0);
    const report = JSON.parse(r.text) as {
      schemaVersion: string;
      baseCount: number;
      variantCount: number;
      passedBaseCount: number;
      bases: { id: string }[];
    };
    expect(report.schemaVersion).toBe("backtest.sensitivity.matrix.v1");
    expect(report.baseCount).toBe(4);
    expect(report.variantCount).toBe(3);
    expect(report.passedBaseCount).toBe(4);
    expect(report.bases.map((b) => b.id)).toEqual([
      "multi-mint-partial-exit",
      "seed-journal-continuation",
      "single-mint-buy-full-exit",
      "single-mint-buy-hold",
    ]);
    // Deterministic: a second sweep is byte-identical.
    const r2 = paperBacktestSensitivityMatrixReport(
      { cwd: join(EXAMPLES_DIR, "../.."), env: {} },
      {
        dir: "examples/backtest",
        planPath: "examples/backtest/price-sensitivity.variant-plan.json",
        json: true,
      },
    );
    expect(r2.text).toBe(r.text);
  });

  it("paper:backtest --json --out writes ONLY a report JSON (no journal) to a temp dir", () => {
    const tmp = mkdtempSync(join(tmpdir(), "soulmaker-examples-"));
    try {
      const out = paperBacktestReport(
        { cwd: tmp, env: {} },
        {
          scenarioPath: join(EXAMPLES_DIR, "single-mint-buy-hold.scenario.json"),
          outPath: "report.json",
          json: true,
        },
      );
      JSON.parse(out); // --json stdout is parseable
      const written = readFileSync(join(tmp, "report.json"), "utf8");
      const parsed = JSON.parse(written) as { schemaVersion: string };
      expect(parsed.schemaVersion).toBe("backtest.report.v1");
      expect(written).not.toContain("PAPER_BUY_FILLED"); // a report is not a journal
      expect(readdirSync(tmp).some((f) => f.endsWith(".jsonl"))).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("packages a real matrix run into a manifest and verifies it (Sprint 16 round-trip)", () => {
    const repoRoot = join(EXAMPLES_DIR, "../..");
    const tmp = mkdtempSync(join(tmpdir(), "soulmaker-manifest-"));
    try {
      // 1) Produce a real research run (the cross-scenario matrix over the shipped examples).
      const matrix = paperBacktestSensitivityMatrixReport(
        { cwd: repoRoot, env: {} },
        {
          dir: "examples/backtest",
          planPath: "examples/backtest/price-sensitivity.variant-plan.json",
          outDir: tmp,
        },
      );
      expect(matrix.exitCode).toBe(0);

      // 2) Index it into a manifest written INTO the run dir.
      const manifestPath = join(tmp, "research-manifest.json");
      const built = paperBacktestResearchManifestReport({ cwd: tmp, env: {} }, { dir: ".", outPath: manifestPath, json: true });
      expect(built.exitCode).toBe(0);
      const manifest = JSON.parse(built.text) as { schemaVersion: string; artifactCount: number; artifacts: { path: string }[] };
      expect(manifest.schemaVersion).toBe("backtest.research.manifest.v1");
      // 1 matrix report + 4 per-base sensitivity reports; the manifest itself is excluded.
      expect(manifest.artifactCount).toBe(5);
      expect(manifest.artifacts.some((a) => a.path === "research-manifest.json")).toBe(false);

      // 3) Verify the exact set: VALID, exit 0.
      const ok = paperBacktestResearchVerifyReport({ cwd: tmp, env: {} }, { manifestPath, dir: "." });
      expect(ok.exitCode).toBe(0);
      expect(ok.text).toContain("(VALID)");

      // 4) Mutate one artifact ⇒ verify is INVALID, exit 1.
      writeFileSync(join(tmp, "sensitivity-matrix-report.json"), "{}");
      const bad = paperBacktestResearchVerifyReport({ cwd: tmp, env: {} }, { manifestPath, dir: "." });
      expect(bad.exitCode).toBe(1);
      expect(bad.text).toContain("(INVALID)");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("examples/sniper — fixtures validate", () => {
  it("the shipped candidate list validates and normalizes (PAPER ONLY, no warnings)", () => {
    const r = paperSniperCandidatesValidateReport(
      { cwd: SNIPER_EXAMPLES_DIR, env: {} },
      { inputPath: "candidates.example.json", json: true },
    );
    expect(r.exitCode).toBe(0);
    const list = JSON.parse(r.text) as { schemaVersion: string; candidateCount: number; warnings: string[]; candidates: { candidateId: string }[] };
    expect(list.schemaVersion).toBe("sniper.candidate.list.v1");
    expect(list.candidateCount).toBe(2);
    expect(list.warnings).toEqual([]);
    expect(list.candidates.map((c) => c.candidateId)).toEqual(["example-usdc", "example-wsol"]);
    // --fail-on-warning still passes (no duplicate mints in the fixture).
    expect(
      paperSniperCandidatesValidateReport(
        { cwd: SNIPER_EXAMPLES_DIR, env: {} },
        { inputPath: "candidates.example.json", failOnWarning: true },
      ).exitCode,
    ).toBe(0);
  });

  it("the shipped candidate list bundles into a run report (PAPER ONLY; candidates-only run)", () => {
    const r = paperSniperReportReport(
      { cwd: SNIPER_EXAMPLES_DIR, env: {} },
      { candidatesPath: "candidates.example.json", json: true },
    );
    expect(r.exitCode).toBe(0);
    const report = JSON.parse(r.text) as {
      schemaVersion: string;
      candidateCount: number;
      hasMissingRecommendedArtifact: boolean;
      hasPaperEnter: boolean;
      watchedMissingInfoIds: string[];
    };
    expect(report.schemaVersion).toBe("sniper.run.report.v1");
    expect(report.candidateCount).toBe(2);
    // A candidates-only run has no preflight/decision (recommended artifacts), so nothing paper-enters.
    expect(report.hasMissingRecommendedArtifact).toBe(true);
    expect(report.hasPaperEnter).toBe(false);
    expect(report.watchedMissingInfoIds).toEqual(["example-usdc", "example-wsol"]);
  });
});
