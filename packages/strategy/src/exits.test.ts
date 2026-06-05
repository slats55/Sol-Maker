import { describe, it, expect } from "vitest";
import { decideSimulatedExit, DEFAULT_PARTIAL_EXIT_FRACTION } from "./exits.js";
import { REASON_IDS } from "./reasons.js";
import type { StrategyConfig } from "./types.js";

/** Base config: required thresholds only; exit rules added per test. */
const base: StrategyConfig = {
  minScoreForPaperBuy: 55,
  minScoreForWatch: 30,
  maxRiskScore: 60,
};

function ids(reasons: { id: string }[]): string[] {
  return reasons.map((r) => r.id);
}

describe("decideSimulatedExit — stop loss & take profit (parity with Sprint 6)", () => {
  it("stop loss ⇒ FULL exit", () => {
    const { plan, reasons } = decideSimulatedExit({
      priceChangePct: -40,
      config: { ...base, stopLossPct: 30 },
    });
    expect(plan.action).toBe("FULL_EXIT");
    expect(plan.trigger).toBe("STOP_LOSS");
    expect(plan.fraction).toBe(1);
    expect(plan.sizeUsd).toBeUndefined();
    expect(ids(reasons)).toContain(REASON_IDS.SELL_STOP_LOSS);
  });

  it("take profit ⇒ FULL exit", () => {
    const { plan, reasons } = decideSimulatedExit({
      priceChangePct: 80,
      config: { ...base, takeProfitPct: 50 },
    });
    expect(plan.action).toBe("FULL_EXIT");
    expect(plan.trigger).toBe("TAKE_PROFIT");
    expect(ids(reasons)).toContain(REASON_IDS.SELL_TAKE_PROFIT);
  });

  it("no exit signal ⇒ HOLD", () => {
    const { plan, reasons } = decideSimulatedExit({
      priceChangePct: 10,
      config: { ...base, takeProfitPct: 50, stopLossPct: 30 },
    });
    expect(plan.action).toBe("HOLD");
    expect(plan.fraction).toBe(0);
    expect(ids(reasons)).toContain(REASON_IDS.HOLDING_NO_EXIT_SIGNAL);
  });

  it("non-positive thresholds are treated as disabled (no exit at 0% change)", () => {
    const { plan } = decideSimulatedExit({
      priceChangePct: 0,
      config: { ...base, takeProfitPct: 0, stopLossPct: 0 },
    });
    expect(plan.action).toBe("HOLD");
  });
});

describe("decideSimulatedExit — trailing stop", () => {
  it("drawdown from a positive peak ≥ trailingStopPct ⇒ FULL exit", () => {
    // peak +100, now +70 ⇒ derived drawdown 30 ≥ 20.
    const { plan, reasons } = decideSimulatedExit({
      priceChangePct: 70,
      peakPriceChangePct: 100,
      config: { ...base, trailingStopPct: 20 },
    });
    expect(plan.action).toBe("FULL_EXIT");
    expect(plan.trigger).toBe("TRAILING_STOP");
    expect(ids(reasons)).toContain(REASON_IDS.SELL_TRAILING_STOP);
  });

  it("an explicit drawdownFromPeakPct overrides the derived value", () => {
    // Derived would be 100 - 90 = 10 (< 20), but the explicit 25 ≥ 20 fires.
    const { plan } = decideSimulatedExit({
      priceChangePct: 90,
      peakPriceChangePct: 100,
      drawdownFromPeakPct: 25,
      config: { ...base, trailingStopPct: 20 },
    });
    expect(plan.action).toBe("FULL_EXIT");
    expect(plan.trigger).toBe("TRAILING_STOP");
  });

  it("does not arm without a positive peak (downside is the stop-loss's job)", () => {
    // peak never went positive ⇒ trailing stop is not armed ⇒ HOLD here.
    const { plan } = decideSimulatedExit({
      priceChangePct: -10,
      peakPriceChangePct: -2,
      config: { ...base, trailingStopPct: 5 },
    });
    expect(plan.action).toBe("HOLD");
  });

  it("does not arm without any peak metric", () => {
    const { plan } = decideSimulatedExit({
      priceChangePct: 5,
      config: { ...base, trailingStopPct: 5 },
    });
    expect(plan.action).toBe("HOLD");
  });

  it("stop loss takes priority over a trailing stop (risk-first order)", () => {
    const { plan, reasons } = decideSimulatedExit({
      priceChangePct: -40,
      peakPriceChangePct: 50,
      config: { ...base, stopLossPct: 30, trailingStopPct: 20 },
    });
    expect(plan.trigger).toBe("STOP_LOSS");
    expect(ids(reasons)).toContain(REASON_IDS.SELL_STOP_LOSS);
    expect(ids(reasons)).not.toContain(REASON_IDS.SELL_TRAILING_STOP);
  });
});

describe("decideSimulatedExit — partial / scaled exits", () => {
  it("partial take-profit with an injected size ⇒ PARTIAL exit of the default half", () => {
    const { plan, reasons } = decideSimulatedExit({
      priceChangePct: 30,
      positionSizeUsd: 200,
      config: { ...base, takeProfitPartialPct: 25, takeProfitPct: 50 },
    });
    expect(plan.action).toBe("PARTIAL_EXIT");
    expect(plan.trigger).toBe("PARTIAL_TAKE_PROFIT");
    expect(plan.fraction).toBe(DEFAULT_PARTIAL_EXIT_FRACTION);
    expect(plan.sizeUsd).toBe(100); // 0.5 * 200
    expect(ids(reasons)).toContain(REASON_IDS.SELL_PARTIAL_TAKE_PROFIT);
  });

  it("honors a configured partialExitFraction and rounds the size to cents", () => {
    const { plan } = decideSimulatedExit({
      priceChangePct: 30,
      positionSizeUsd: 150.5,
      config: { ...base, takeProfitPartialPct: 25, partialExitFraction: 0.25 },
    });
    expect(plan.action).toBe("PARTIAL_EXIT");
    expect(plan.fraction).toBe(0.25);
    expect(plan.sizeUsd).toBe(37.63); // round2(0.25 * 150.5 = 37.625)
  });

  it("a full take-profit beats a partial one when both thresholds are crossed", () => {
    const { plan } = decideSimulatedExit({
      priceChangePct: 60,
      positionSizeUsd: 200,
      config: { ...base, takeProfitPct: 50, takeProfitPartialPct: 25 },
    });
    expect(plan.action).toBe("FULL_EXIT");
    expect(plan.trigger).toBe("TAKE_PROFIT");
  });

  it("partial threshold met but NO injected size ⇒ HOLD (fail-safe, never an unsized exit)", () => {
    const { plan, reasons } = decideSimulatedExit({
      priceChangePct: 30,
      config: { ...base, takeProfitPartialPct: 25 },
    });
    expect(plan.action).toBe("HOLD");
    expect(plan.sizeUsd).toBeUndefined();
    expect(ids(reasons)).toContain(REASON_IDS.PARTIAL_EXIT_UNSIZED);
  });

  it("a non-positive injected size cannot size a partial ⇒ HOLD", () => {
    const { plan } = decideSimulatedExit({
      priceChangePct: 30,
      positionSizeUsd: 0,
      config: { ...base, takeProfitPartialPct: 25 },
    });
    expect(plan.action).toBe("HOLD");
  });
});

describe("decideSimulatedExit — labelling, determinism, purity", () => {
  it("every plan is labelled paper-only and simulated", () => {
    const { plan } = decideSimulatedExit({
      priceChangePct: 80,
      config: { ...base, takeProfitPct: 50 },
    });
    expect(plan.paperOnly).toBe(true);
    expect(plan.simulated).toBe(true);
  });

  it("is deterministic for identical inputs", () => {
    const input = {
      priceChangePct: 30,
      positionSizeUsd: 200,
      config: { ...base, takeProfitPartialPct: 25 },
    };
    expect(JSON.stringify(decideSimulatedExit(input))).toBe(
      JSON.stringify(decideSimulatedExit(input)),
    );
  });

  it("does not mutate its inputs", () => {
    const config: StrategyConfig = { ...base, takeProfitPartialPct: 25, trailingStopPct: 20 };
    const input = { priceChangePct: 30, peakPriceChangePct: 40, positionSizeUsd: 200, config };
    deepFreeze(input);
    expect(() => decideSimulatedExit(input)).not.toThrow();
  });
});

/** Deep-freeze so any attempted mutation throws in strict mode. */
function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === "object") {
    for (const value of Object.values(obj)) deepFreeze(value);
    Object.freeze(obj);
  }
  return obj;
}
