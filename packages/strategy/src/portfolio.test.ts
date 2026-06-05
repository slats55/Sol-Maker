import { describe, it, expect } from "vitest";
import { portfolioFromPaperState } from "./portfolio.js";
import type { PaperPosition, PaperState } from "@soulmaker/paper";

function position(mint: string, costBasisUsd: number, quantity = 1): PaperPosition {
  return {
    mint,
    quantity,
    averageEntryPriceUsd: costBasisUsd / quantity,
    costBasisUsd,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    openedAt: "2026-06-05T12:00:00.000Z",
    updatedAt: "2026-06-05T12:00:00.000Z",
  };
}

function state(positions: PaperPosition[]): PaperState {
  const byMint: Record<string, PaperPosition> = {};
  for (const p of positions) byMint[p.mint] = p;
  return {
    positions: byMint,
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    fills: [],
    closedTradeCount: 0,
    simulatedNotionalUsd: 0,
  };
}

describe("portfolioFromPaperState", () => {
  it("reports an empty portfolio for empty state", () => {
    const portfolio = portfolioFromPaperState(state([]));
    expect(portfolio.openPositionCount).toBe(0);
    expect(portfolio.heldMints).toEqual([]);
    expect(portfolio.topPositionConcentrationPct).toBeUndefined();
  });

  it("counts open positions and lists held mints (sorted, deterministic)", () => {
    const portfolio = portfolioFromPaperState(
      state([position("BBB", 100), position("AAA", 100)]),
    );
    expect(portfolio.openPositionCount).toBe(2);
    expect(portfolio.heldMints).toEqual(["AAA", "BBB"]);
  });

  it("computes the top position's concentration as a percent of total cost basis", () => {
    const portfolio = portfolioFromPaperState(
      state([position("AAA", 300), position("BBB", 100)]),
    );
    // 300 / 400 = 75%
    expect(portfolio.topPositionConcentrationPct).toBe(75);
  });

  it("ignores flat (zero-quantity) positions", () => {
    const portfolio = portfolioFromPaperState(
      state([position("AAA", 100, 1), position("ZZZ", 0, 0)]),
    );
    expect(portfolio.openPositionCount).toBe(1);
    expect(portfolio.heldMints).toEqual(["AAA"]);
  });

  it("maps per-mint cost basis for position-aware partial-exit sizing", () => {
    const portfolio = portfolioFromPaperState(
      state([position("AAA", 300), position("BBB", 100)]),
    );
    expect(portfolio.positionSizeUsdByMint).toEqual({ AAA: 300, BBB: 100 });
  });

  it("omits the per-mint size map entirely when there are no positive bases", () => {
    const portfolio = portfolioFromPaperState(state([]));
    expect(portfolio.positionSizeUsdByMint).toBeUndefined();
  });

  it("does not mutate the input state", () => {
    const s = state([position("AAA", 100)]);
    const snapshot = JSON.stringify(s);
    portfolioFromPaperState(s);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
