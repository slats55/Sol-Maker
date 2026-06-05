import { describe, it, expect } from "vitest";
import {
  initialState,
  applyBuyFill,
  applySellFill,
  markUnrealized,
} from "./engine.js";
import type { PaperFill } from "./types.js";

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const AT = "2026-06-05T12:00:00.000Z";

function buy(quantity: number, priceUsd: number, feeUsd = 0): PaperFill {
  return {
    id: "fill-buy",
    orderId: "order-buy",
    mint: MINT,
    side: "BUY",
    priceUsd,
    quantity,
    notionalUsd: quantity * priceUsd,
    feeUsd,
    filledAt: AT,
  };
}

function sell(quantity: number, priceUsd: number, feeUsd = 0): PaperFill {
  return {
    id: "fill-sell",
    orderId: "order-sell",
    mint: MINT,
    side: "SELL",
    priceUsd,
    quantity,
    notionalUsd: quantity * priceUsd,
    feeUsd,
    filledAt: AT,
  };
}

describe("applyBuyFill", () => {
  it("opens a position with the right quantity, cost basis and average entry", () => {
    const s = applyBuyFill(initialState(), buy(50, 2)); // $100 notional
    const pos = s.positions[MINT];
    expect(pos?.quantity).toBe(50);
    expect(pos?.costBasisUsd).toBe(100);
    expect(pos?.averageEntryPriceUsd).toBe(2);
    expect(s.simulatedNotionalUsd).toBe(100);
  });

  it("adds to a position with a weighted-average entry", () => {
    let s = applyBuyFill(initialState(), buy(50, 2)); // 50 @ 2
    s = applyBuyFill(s, buy(50, 4)); // +50 @ 4
    const pos = s.positions[MINT];
    expect(pos?.quantity).toBe(100);
    expect(pos?.costBasisUsd).toBe(300);
    expect(pos?.averageEntryPriceUsd).toBe(3); // (100 + 200) / 100
  });

  it("includes simulated fees in the cost basis", () => {
    const s = applyBuyFill(initialState(), buy(50, 2, 10));
    expect(s.positions[MINT]?.costBasisUsd).toBe(110);
  });

  it("does not mutate the input state", () => {
    const before = initialState();
    applyBuyFill(before, buy(50, 2));
    expect(before.positions[MINT]).toBeUndefined();
    expect(before.fills.length).toBe(0);
  });
});

describe("applySellFill", () => {
  it("realizes PnL and closes the position on a full sell", () => {
    const opened = applyBuyFill(initialState(), buy(50, 2));
    const { state, realizedPnlUsd } = applySellFill(opened, sell(50, 3));
    expect(realizedPnlUsd).toBe(50); // (3 - 2) * 50
    expect(state.realizedPnlUsd).toBe(50);
    expect(state.positions[MINT]).toBeUndefined(); // closed
    expect(state.closedTradeCount).toBe(1);
  });

  it("realizes a loss correctly", () => {
    const opened = applyBuyFill(initialState(), buy(50, 2));
    const { realizedPnlUsd } = applySellFill(opened, sell(50, 1));
    expect(realizedPnlUsd).toBe(-50); // (1 - 2) * 50
  });

  it("supports a partial sell: keeps the remainder with reduced cost basis", () => {
    const opened = applyBuyFill(initialState(), buy(50, 2)); // cost 100
    const { state, realizedPnlUsd } = applySellFill(opened, sell(20, 3));
    expect(realizedPnlUsd).toBe(20); // (3 - 2) * 20
    const pos = state.positions[MINT];
    expect(pos?.quantity).toBe(30);
    expect(pos?.costBasisUsd).toBe(60); // 100 - 2*20
    expect(state.closedTradeCount).toBe(0);
  });

  it("clamps an oversized sell to the held quantity", () => {
    const opened = applyBuyFill(initialState(), buy(50, 2));
    const { state, realizedPnlUsd } = applySellFill(opened, sell(999, 3));
    expect(realizedPnlUsd).toBe(50); // only 50 held
    expect(state.positions[MINT]).toBeUndefined();
  });
});

describe("markUnrealized", () => {
  it("computes unrealized PnL from the latest price", () => {
    const s = markUnrealized(applyBuyFill(initialState(), buy(50, 2)), { [MINT]: 3 });
    expect(s.positions[MINT]?.unrealizedPnlUsd).toBe(50); // (3 - 2) * 50
    expect(s.unrealizedPnlUsd).toBe(50);
  });

  it("leaves unrealized at 0 for a missing/invalid price (not assumed profit)", () => {
    const s = markUnrealized(applyBuyFill(initialState(), buy(50, 2)), {});
    expect(s.positions[MINT]?.unrealizedPnlUsd).toBe(0);
    expect(s.unrealizedPnlUsd).toBe(0);
  });
});
