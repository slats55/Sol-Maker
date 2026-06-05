import { describe, it, expect } from "vitest";
import { checkBuyCaps, openPositionCount } from "./caps.js";
import { applyBuyFill, initialState } from "./engine.js";
import type { PaperFill, PaperRiskCaps, PaperState } from "./types.js";

const A = "So11111111111111111111111111111111111111112";
const B = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const CAPS: PaperRiskCaps = {
  maxTradeSizeUsd: 100,
  maxDailyLossUsd: 50,
  maxOpenPositions: 2,
  killSwitch: false,
};

function withPosition(mint: string, quantity: number, priceUsd: number): PaperState {
  const fill: PaperFill = {
    id: "f",
    orderId: "o",
    mint,
    side: "BUY",
    priceUsd,
    quantity,
    notionalUsd: quantity * priceUsd,
    feeUsd: 0,
    filledAt: "2026-06-05T12:00:00.000Z",
  };
  return applyBuyFill(initialState(), fill);
}

describe("checkBuyCaps", () => {
  it("allows a normal buy under all caps", () => {
    expect(checkBuyCaps(CAPS, initialState(), A, 50).ok).toBe(true);
  });

  it("blocks when the kill switch is engaged", () => {
    const d = checkBuyCaps({ ...CAPS, killSwitch: true }, initialState(), A, 50);
    expect(d.ok).toBe(false);
    expect(d.cap).toBe("killSwitch");
  });

  it("blocks a non-positive or invalid size", () => {
    expect(checkBuyCaps(CAPS, initialState(), A, 0).cap).toBe("proposedSizeUsd");
    expect(checkBuyCaps(CAPS, initialState(), A, -5).cap).toBe("proposedSizeUsd");
    expect(checkBuyCaps(CAPS, initialState(), A, Number.NaN).cap).toBe("proposedSizeUsd");
  });

  it("blocks an oversized trade", () => {
    const d = checkBuyCaps(CAPS, initialState(), A, 101);
    expect(d.ok).toBe(false);
    expect(d.cap).toBe("maxTradeSizeUsd");
  });

  it("blocks further buys once the daily loss cap is reached", () => {
    const losing: PaperState = { ...initialState(), realizedPnlUsd: -50 };
    const d = checkBuyCaps(CAPS, losing, A, 10);
    expect(d.ok).toBe(false);
    expect(d.cap).toBe("maxDailyLossUsd");
  });

  it("blocks a new position once max open positions is reached", () => {
    const oneOpen = withPosition(A, 10, 1); // 1 open position, cap is 2... raise state
    const twoOpen = applyBuyFill(oneOpen, {
      id: "f2",
      orderId: "o2",
      mint: B,
      side: "BUY",
      priceUsd: 1,
      quantity: 10,
      notionalUsd: 10,
      feeUsd: 0,
      filledAt: "2026-06-05T12:00:00.000Z",
    });
    expect(openPositionCount(twoOpen)).toBe(2);
    const d = checkBuyCaps(CAPS, twoOpen, "NewMint11111111111111111111111111111111111", 10);
    expect(d.ok).toBe(false);
    expect(d.cap).toBe("maxOpenPositions");
  });

  it("allows adding to an EXISTING position even at the open-position cap", () => {
    const oneOpen = withPosition(A, 10, 1);
    const capsOne = { ...CAPS, maxOpenPositions: 1 };
    expect(openPositionCount(oneOpen)).toBe(1);
    expect(checkBuyCaps(capsOne, oneOpen, A, 10).ok).toBe(true); // same mint
  });

  it("enforces an optional per-position size ceiling on cost basis", () => {
    const capsPos = { ...CAPS, maxPositionSizeUsd: 100 };
    const open = withPosition(A, 10, 9); // cost basis 90
    const d = checkBuyCaps(capsPos, open, A, 20); // 90 + 20 > 100
    expect(d.ok).toBe(false);
    expect(d.cap).toBe("maxPositionSizeUsd");
  });
});
