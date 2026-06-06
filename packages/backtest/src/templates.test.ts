import { describe, it, expect } from "vitest";
import {
  buildExampleBacktestScenario,
  listBacktestScenarioTemplates,
  type BacktestScenarioTemplate,
} from "./templates.js";
import { lintBacktestScenario } from "./lint.js";
import { runBacktest } from "./backtest.js";

const ALL_TEMPLATES: BacktestScenarioTemplate[] = [
  "buy-hold",
  "buy-full-exit",
  "partial-exit",
  "seed-journal-continuation",
];

// Forbidden / wallet-looking material that must never appear in an injected fixture.
const FORBIDDEN = /keypair|secretkey|fromsecretkey|mnemonic|seed phrase|private key|signtransaction|sendtransaction/i;

describe("listBacktestScenarioTemplates", () => {
  it("lists exactly the four built-in templates with their expected warnings", () => {
    const infos = listBacktestScenarioTemplates();
    expect(infos.map((i) => i.template)).toEqual(ALL_TEMPLATES);
    const byName = new Map(infos.map((i) => [i.template, i]));
    expect(byName.get("buy-hold")?.expectedWarnings).toEqual([]);
    expect(byName.get("seed-journal-continuation")?.expectedWarnings).toEqual([
      "initial-journal-open-positions",
    ]);
  });
});

describe("buildExampleBacktestScenario — every template validates, lints, and runs", () => {
  for (const template of ALL_TEMPLATES) {
    it(`${template} lints valid with exactly its declared expected warnings`, () => {
      const info = listBacktestScenarioTemplates().find((i) => i.template === template)!;
      const lint = lintBacktestScenario(buildExampleBacktestScenario(template));
      expect(lint.valid).toBe(true);
      expect(lint.errors).toEqual([]);
      expect(lint.warnings.map((w) => w.code)).toEqual(info.expectedWarnings);
    });

    it(`${template} runs through runBacktest deterministically`, () => {
      const a = runBacktest(buildExampleBacktestScenario(template));
      const b = runBacktest(buildExampleBacktestScenario(template));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a.banner).toBe("SIMULATED PAPER-ONLY REPORT");
      expect(a.schemaVersion).toBe("backtest.report.v1");
      expect(a.equityCurve).toHaveLength(a.stepCount);
    });

    it(`${template} contains only fake, injected, key-free material`, () => {
      const json = JSON.stringify(buildExampleBacktestScenario(template));
      expect(json).not.toMatch(FORBIDDEN);
      // Every candidate mint is a clearly-fake identifier.
      for (const step of buildExampleBacktestScenario(template).steps) {
        for (const c of step.candidates) expect(c.mint.startsWith("Fake")).toBe(true);
      }
    });
  }
});

describe("buildExampleBacktestScenario — deterministic outcomes (mirror the shipped examples)", () => {
  it("buy-hold buys and holds with deterministic unrealized PnL", () => {
    const r = runBacktest(buildExampleBacktestScenario("buy-hold"));
    expect(r.fillCounts).toEqual({ buyCount: 1, sellCount: 0 });
    expect(r.positionCounts).toEqual({ open: 1, closed: 0 });
    expect(r.pnl.realizedUsd).toBe(0);
    expect(r.pnl.unrealizedUsd).toBe(50); // (3 - 2) * 50
  });

  it("buy-full-exit realizes +50 and closes the position", () => {
    const r = runBacktest(buildExampleBacktestScenario("buy-full-exit"));
    expect(r.fillCounts).toEqual({ buyCount: 1, sellCount: 1 });
    expect(r.positionCounts).toEqual({ open: 0, closed: 1 });
    expect(r.pnl.realizedUsd).toBe(50);
  });

  it("partial-exit buys A + B, rejects C, scales out A", () => {
    const r = runBacktest(buildExampleBacktestScenario("partial-exit"));
    expect(r.fillCounts.buyCount).toBe(2);
    expect(r.fillCounts.sellCount).toBe(1);
    expect(r.positionCounts.open).toBe(2);
    expect(r.planCounts.rejectedCount).toBeGreaterThanOrEqual(1);
    expect(r.perMint).toHaveLength(2); // only the two filled mints
  });

  it("seed-journal-continuation exits the seeded position for +50", () => {
    const r = runBacktest(buildExampleBacktestScenario("seed-journal-continuation"));
    expect(r.fillCounts.sellCount).toBe(1);
    expect(r.pnl.realizedUsd).toBe(50);
  });
});

describe("buildExampleBacktestScenario — options + purity", () => {
  it("applies a custom name override", () => {
    const s = buildExampleBacktestScenario("buy-hold", { name: "my custom fixture" });
    expect(s.name).toBe("my custom fixture");
    // Still valid + runnable with the override.
    expect(lintBacktestScenario(s).valid).toBe(true);
  });

  it("refuses an empty name override", () => {
    expect(() => buildExampleBacktestScenario("buy-hold", { name: "" })).toThrow(/non-empty/);
  });

  it("refuses an unknown template", () => {
    expect(() =>
      buildExampleBacktestScenario("not-a-template" as unknown as BacktestScenarioTemplate),
    ).toThrow(/unknown backtest scenario template/);
  });

  it("returns a fresh, independent object each call (no shared mutable state)", () => {
    const a = buildExampleBacktestScenario("buy-hold");
    const b = buildExampleBacktestScenario("buy-hold");
    expect(a).not.toBe(b);
    expect(a.caps).not.toBe(b.caps);
    a.caps.maxTradeSizeUsd = 999; // mutating one must not affect the other
    expect(b.caps.maxTradeSizeUsd).toBe(1000);
  });
});
