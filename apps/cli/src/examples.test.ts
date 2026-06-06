/**
 * Tests for the shipped `examples/backtest/` fixtures. They prove every example
 * is a valid, deterministic, INJECTED scenario: it lints clean (with its exact,
 * documented warnings), runs through the real `runBacktest`, and works through the
 * CLI. These are fixtures, not historical market truth.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBacktest, lintBacktestScenario } from "@soulmaker/backtest";
import { paperBacktestReport, paperBacktestLintReport } from "./commands.js";

const EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../examples/backtest");

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
});
