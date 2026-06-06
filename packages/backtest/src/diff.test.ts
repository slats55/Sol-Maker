import { describe, it, expect } from "vitest";
import {
  diffBacktestReports,
  formatBacktestReportDiff,
  BACKTEST_DIFF_SCHEMA_VERSION,
} from "./diff.js";
import { BacktestReportError, validateBacktestReport } from "./report-validate.js";
import { BACKTEST_REPORT_SCHEMA_VERSION } from "./report.js";
import { runBacktest } from "./backtest.js";
import type {
  BacktestEquityPoint,
  BacktestLintIssue,
  BacktestPerMintAggregate,
} from "./types.js";

// Clearly-fake, injected mint identifiers (never real tokens, keys, or wallets).
const A = "FakeAAA1111111111111111111111111111111111111";
const B = "FakeBBB2222222222222222222222222222222222222";
const C = "FakeCCC3333333333333333333333333333333333333";
const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";

// --- minimal report factory (only the fields the validator + diff read) -------

interface MakeReportOpts {
  schemaVersion?: string;
  scenarioName?: string;
  scenarioDigest?: string;
  stepCount?: number;
  totalCandidateCount?: number;
  simulatedNotionalUsd?: number;
  buyCount?: number;
  sellCount?: number;
  rejectsTotal?: number;
  open?: number;
  closed?: number;
  realizedUsd?: number;
  unrealizedUsd?: number;
  totalUsd?: number;
  warnings?: BacktestLintIssue[];
  equityCurve?: BacktestEquityPoint[];
  perMint?: BacktestPerMintAggregate[];
}

function makeReport(o: MakeReportOpts = {}): unknown {
  return {
    schemaVersion: o.schemaVersion ?? BACKTEST_REPORT_SCHEMA_VERSION,
    scenarioName: o.scenarioName ?? "scenario-x",
    scenarioDigest: o.scenarioDigest ?? "aaaa000000000000",
    stepCount: o.stepCount ?? 1,
    totalCandidateCount: o.totalCandidateCount ?? 1,
    simulatedNotionalUsd: o.simulatedNotionalUsd ?? 0,
    fillCounts: { buyCount: o.buyCount ?? 0, sellCount: o.sellCount ?? 0 },
    rejectedCounts: { total: o.rejectsTotal ?? 0, byRisk: 0, byCaps: 0, byPrice: 0 },
    positionCounts: { open: o.open ?? 0, closed: o.closed ?? 0 },
    pnl: {
      realizedUsd: o.realizedUsd ?? 0,
      unrealizedUsd: o.unrealizedUsd ?? 0,
      totalUsd: o.totalUsd ?? 0,
    },
    warnings: o.warnings ?? [],
    equityCurve: o.equityCurve ?? [],
    perMint: o.perMint ?? [],
  };
}

function warn(code: string, message = code, path?: string): BacktestLintIssue {
  return path === undefined ? { code, message } : { code, message, path };
}

function equity(stepId: string, totalPnlUsd = 0): BacktestEquityPoint {
  return {
    stepId,
    at: T1,
    realizedPnlUsd: totalPnlUsd,
    unrealizedPnlUsd: 0,
    totalPnlUsd,
    simulatedNotionalUsd: 0,
    openPositionCount: 0,
    closedTradeCount: 0,
  };
}

function perMint(mint: string, totalPnlUsd = 0): BacktestPerMintAggregate {
  return {
    mint,
    buyFillCount: 1,
    sellFillCount: 0,
    openQuantity: 0,
    realizedPnlUsd: totalPnlUsd,
    unrealizedPnlUsd: 0,
    totalPnlUsd,
    simulatedNotionalUsd: 0,
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

// --- tests -------------------------------------------------------------------

describe("diffBacktestReports — compatibility + identity", () => {
  it("identical reports produce an empty/zero diff with no regression", () => {
    const diff = diffBacktestReports(makeReport(), makeReport());
    expect(diff.schemaVersion).toBe(BACKTEST_DIFF_SCHEMA_VERSION);
    expect(diff.compatibility.status).toBe("same-scenario");
    expect(diff.compatibility.compatible).toBe(true);
    expect(diff.summary.totalPnlUsd.delta).toBe(0);
    expect(diff.summary.buyFills.delta).toBe(0);
    expect(diff.warnings.added).toHaveLength(0);
    expect(diff.warnings.removed).toHaveLength(0);
    expect(diff.perMint.addedMints).toHaveLength(0);
    expect(diff.hasRegression).toBe(false);
    expect(diff.regressionReasons).toHaveLength(0);
  });

  it("a different scenarioDigest is marked 'different-scenario' (still compatible)", () => {
    const diff = diffBacktestReports(
      makeReport({ scenarioDigest: "d1" }),
      makeReport({ scenarioDigest: "d2" }),
    );
    expect(diff.compatibility.status).toBe("different-scenario");
    expect(diff.compatibility.compatible).toBe(true);
    expect(diff.compatibility.scenarioDigest.match).toBe(false);
  });

  it("a different report schemaVersion is marked 'schema-mismatch' (incompatible)", () => {
    const diff = diffBacktestReports(
      makeReport({ schemaVersion: BACKTEST_REPORT_SCHEMA_VERSION }),
      makeReport({ schemaVersion: "backtest.report.v2" }),
    );
    expect(diff.compatibility.status).toBe("schema-mismatch");
    expect(diff.compatibility.compatible).toBe(false);
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.join(" ")).toMatch(/schemaVersion differs/);
  });
});

describe("diffBacktestReports — summary deltas", () => {
  it("computes a deterministic, byte-stable PnL delta (next - base)", () => {
    const base = makeReport({ scenarioDigest: "d1", totalUsd: 10, realizedUsd: 10 });
    const next = makeReport({ scenarioDigest: "d2", totalUsd: 25, realizedUsd: 25 });
    const d1 = diffBacktestReports(base, next);
    const d2 = diffBacktestReports(base, next);
    expect(d1.summary.totalPnlUsd).toEqual({ base: 10, next: 25, delta: 15 });
    // Byte-stable for the same input pair.
    expect(JSON.stringify(d1)).toBe(JSON.stringify(d2));
  });

  it("rounds float noise out of the delta (no 0.30000000000000004)", () => {
    const diff = diffBacktestReports(
      makeReport({ scenarioDigest: "d1", totalUsd: 0.1 }),
      makeReport({ scenarioDigest: "d2", totalUsd: 0.4 }),
    );
    expect(diff.summary.totalPnlUsd.delta).toBe(0.3);
  });
});

describe("diffBacktestReports — warnings set-diff", () => {
  it("detects an added warning", () => {
    const diff = diffBacktestReports(
      makeReport({ scenarioDigest: "d1", warnings: [] }),
      makeReport({ scenarioDigest: "d2", warnings: [warn("kill-switch-engaged")] }),
    );
    expect(diff.warnings.added.map((w) => w.code)).toEqual(["kill-switch-engaged"]);
    expect(diff.warnings.removed).toHaveLength(0);
    expect(diff.warnings.countDelta).toBe(1);
  });

  it("detects a removed warning", () => {
    const diff = diffBacktestReports(
      makeReport({ scenarioDigest: "d1", warnings: [warn("kill-switch-engaged")] }),
      makeReport({ scenarioDigest: "d2", warnings: [] }),
    );
    expect(diff.warnings.removed.map((w) => w.code)).toEqual(["kill-switch-engaged"]);
    expect(diff.warnings.added).toHaveLength(0);
  });

  it("sorts added/removed/unchanged warnings deterministically by code/message/path", () => {
    const diff = diffBacktestReports(
      makeReport({ scenarioDigest: "d1", warnings: [warn("shared")] }),
      makeReport({
        scenarioDigest: "d2",
        warnings: [warn("zeta"), warn("alpha"), warn("shared")],
      }),
    );
    expect(diff.warnings.added.map((w) => w.code)).toEqual(["alpha", "zeta"]);
    expect(diff.warnings.unchanged.map((w) => w.code)).toEqual(["shared"]);
  });
});

describe("diffBacktestReports — per-mint diff", () => {
  it("detects an added mint", () => {
    const diff = diffBacktestReports(
      makeReport({ scenarioDigest: "d1", perMint: [perMint(A)] }),
      makeReport({ scenarioDigest: "d2", perMint: [perMint(A), perMint(B)] }),
    );
    expect(diff.perMint.addedMints.map((m) => m.mint)).toEqual([B]);
    expect(diff.perMint.removedMints).toHaveLength(0);
  });

  it("detects a removed mint", () => {
    const diff = diffBacktestReports(
      makeReport({ scenarioDigest: "d1", perMint: [perMint(A), perMint(B)] }),
      makeReport({ scenarioDigest: "d2", perMint: [perMint(A)] }),
    );
    expect(diff.perMint.removedMints.map((m) => m.mint)).toEqual([B]);
  });

  it("sorts per-mint lists by mint", () => {
    const diff = diffBacktestReports(
      makeReport({ scenarioDigest: "d1", perMint: [perMint(A)] }),
      // Supplied out of order (C, A, B); common+added must come out sorted.
      makeReport({ scenarioDigest: "d2", perMint: [perMint(C), perMint(A), perMint(B)] }),
    );
    expect(diff.perMint.common.map((m) => m.mint)).toEqual([A]);
    expect(diff.perMint.addedMints.map((m) => m.mint)).toEqual([B, C]);
  });

  it("computes a per-mint PnL delta", () => {
    const diff = diffBacktestReports(
      makeReport({ scenarioDigest: "d1", perMint: [perMint(A, 10)] }),
      makeReport({ scenarioDigest: "d2", perMint: [perMint(A, 4)] }),
    );
    expect(diff.perMint.common[0]?.totalPnlUsd).toEqual({ base: 10, next: 4, delta: -6 });
  });
});

describe("diffBacktestReports — equity-curve diff", () => {
  it("keeps shared steps in BASE order and lists added steps from NEXT", () => {
    const diff = diffBacktestReports(
      makeReport({ scenarioDigest: "d1", equityCurve: [equity("step-1"), equity("step-2")] }),
      // Next reorders + adds step-3; common must still follow base order.
      makeReport({
        scenarioDigest: "d2",
        equityCurve: [equity("step-2"), equity("step-1"), equity("step-3")],
      }),
    );
    expect(diff.equityCurve.common.map((s) => s.stepId)).toEqual(["step-1", "step-2"]);
    expect(diff.equityCurve.addedSteps.map((s) => s.stepId)).toEqual(["step-3"]);
    expect(diff.equityCurve.removedSteps).toHaveLength(0);
  });

  it("detects a removed step and computes per-step PnL deltas", () => {
    const diff = diffBacktestReports(
      makeReport({ scenarioDigest: "d1", equityCurve: [equity("step-1", 10), equity("step-2", 20)] }),
      makeReport({ scenarioDigest: "d2", equityCurve: [equity("step-1", 14)] }),
    );
    expect(diff.equityCurve.removedSteps.map((s) => s.stepId)).toEqual(["step-2"]);
    expect(diff.equityCurve.common[0]?.totalPnlUsd.delta).toBe(4);
  });
});

describe("diffBacktestReports — conservative regression detection", () => {
  it("flags a regression when the SAME scenario yields lower total PnL", () => {
    const diff = diffBacktestReports(
      makeReport({ scenarioDigest: "same", totalUsd: 10, realizedUsd: 10 }),
      makeReport({ scenarioDigest: "same", totalUsd: 5, realizedUsd: 5 }),
    );
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.join(" ")).toMatch(/total simulated PnL decreased by \$5\.00/);
  });

  it("flags a regression when the SAME scenario shows more rejects", () => {
    const diff = diffBacktestReports(
      makeReport({ scenarioDigest: "same", rejectsTotal: 0 }),
      makeReport({ scenarioDigest: "same", rejectsTotal: 3 }),
    );
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.join(" ")).toMatch(/rejects increased by 3/);
  });

  it("does NOT flag a regression for negative deltas across DIFFERENT scenarios", () => {
    const diff = diffBacktestReports(
      makeReport({ scenarioDigest: "d1", totalUsd: 100, realizedUsd: 100 }),
      makeReport({ scenarioDigest: "d2", totalUsd: 1, realizedUsd: 1 }),
    );
    expect(diff.compatibility.status).toBe("different-scenario");
    expect(diff.hasRegression).toBe(false);
    expect(diff.regressionReasons).toHaveLength(0);
  });

  it("flags any difference for an identical scenarioDigest (determinism guard)", () => {
    const diff = diffBacktestReports(
      makeReport({ scenarioDigest: "same", buyCount: 1 }),
      makeReport({ scenarioDigest: "same", buyCount: 2 }),
    );
    expect(diff.hasRegression).toBe(true);
    expect(diff.regressionReasons.join(" ")).toMatch(/deterministic replay/);
  });
});

describe("diffBacktestReports — validation + purity", () => {
  it("refuses a non-report (throws BacktestReportError)", () => {
    expect(() => diffBacktestReports({}, makeReport())).toThrow(BacktestReportError);
    expect(() => diffBacktestReports(makeReport(), "not a report")).toThrow(BacktestReportError);
    expect(() => diffBacktestReports(makeReport(), 42)).toThrow(BacktestReportError);
  });

  it("refuses a report missing a required numeric field", () => {
    const broken = { ...(makeReport() as Record<string, unknown>), pnl: { realizedUsd: 1 } };
    expect(() => validateBacktestReport(broken)).toThrow(BacktestReportError);
  });

  it("does not mutate its (deeply frozen) inputs", () => {
    const base = deepFreeze(makeReport({ scenarioDigest: "d1", perMint: [perMint(A)] }));
    const next = deepFreeze(makeReport({ scenarioDigest: "d2", perMint: [perMint(B)] }));
    expect(() => diffBacktestReports(base, next)).not.toThrow();
    const diff = diffBacktestReports(base, next);
    // The copied output objects are independent (mutating them must not affect inputs).
    expect(Object.isFrozen(diff.perMint.addedMints[0])).toBe(false);
  });
});

describe("diffBacktestReports — real reports from runBacktest", () => {
  function buyScenario(name: string): unknown {
    return {
      name,
      strategyConfig: { minScoreForPaperBuy: 50, minScoreForWatch: 30, maxRiskScore: 60 },
      caps: { maxTradeSizeUsd: 1000, maxDailyLossUsd: 1000, maxOpenPositions: 5, killSwitch: false },
      defaultPaperSizeUsd: 100,
      steps: [
        {
          id: "step-1",
          at: T1,
          candidates: [
            {
              mint: A,
              symbol: "FAKEA",
              source: "injected-fixture",
              riskReport: {
                mint: A,
                decision: "PASS_FOR_PAPER_EVALUATION",
                score: 12,
                flags: [],
                summary: [],
                generatedAt: T1,
                disclaimer: "advisory only — injected fixture",
              },
            },
          ],
          prices: [
            { mint: A, priceUsd: 2, observedAt: T1, source: "injected-fixture" },
            { mint: A, priceUsd: 3, observedAt: T2, source: "injected-fixture" },
          ],
        },
      ],
    };
  }

  it("two runs of the SAME scenario diff to zero with no regression", () => {
    const r1 = runBacktest(buyScenario("s"));
    const r2 = runBacktest(buyScenario("s"));
    const diff = diffBacktestReports(r1, r2);
    expect(diff.compatibility.status).toBe("same-scenario");
    expect(diff.summary.totalPnlUsd.delta).toBe(0);
    expect(diff.summary.buyFills.delta).toBe(0);
    expect(diff.hasRegression).toBe(false);
  });

  it("formats a redacted, sectioned human diff carrying the required notes", () => {
    const r1 = runBacktest(buyScenario("s"));
    const r2 = runBacktest(buyScenario("s"));
    const text = formatBacktestReportDiff(diffBacktestReports(r1, r2));
    expect(text).toContain("Backtest report diff (SIMULATED PAPER-ONLY)");
    expect(text).toContain("Compatibility:");
    expect(text).toContain("Summary deltas (simulated):");
    expect(text).toContain("Not a live result. Not financial advice. Not a profitability claim.");
    expect(text).toContain("Regression: no");
  });
});
