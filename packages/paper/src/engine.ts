/**
 * Pure state reducers for the simulated portfolio.
 *
 * All functions are pure: they take state + a simulated fill and return new
 * state (the input is never mutated). No clock, no randomness, no I/O. Position
 * accounting uses a weighted-average cost basis.
 */

import type { PaperFill, PaperPosition, PaperState } from "./types.js";

/** Quantities below this are treated as flat (floating-point dust guard). */
const QTY_EPSILON = 1e-12;

export function initialState(): PaperState {
  return {
    positions: {},
    realizedPnlUsd: 0,
    unrealizedPnlUsd: 0,
    fills: [],
    closedTradeCount: 0,
    simulatedNotionalUsd: 0,
  };
}

function clonePositions(
  positions: Record<string, PaperPosition>,
): Record<string, PaperPosition> {
  const out: Record<string, PaperPosition> = {};
  for (const key of Object.keys(positions)) {
    const pos = positions[key];
    if (pos) out[key] = { ...pos };
  }
  return out;
}

/**
 * Clone a whole {@link PaperState} so a caller can hand it to a run (as a
 * starting state) without that state being mutated or aliased by the run.
 * Positions are copied field-by-field; the `fills` array is copied (its fill
 * objects are append-only bookkeeping, never mutated in place). Pure: the input
 * is never modified, and a run started from the clone stays decoupled from it.
 */
export function cloneState(state: PaperState): PaperState {
  return {
    ...state,
    positions: clonePositions(state.positions),
    fills: [...state.fills],
  };
}

/** Apply a simulated BUY fill: open or add to a position (weighted average). */
export function applyBuyFill(state: PaperState, fill: PaperFill): PaperState {
  const positions = clonePositions(state.positions);
  const prev = positions[fill.mint];

  const addedCost = fill.notionalUsd + fill.feeUsd;
  const prevQty = prev?.quantity ?? 0;
  const prevCost = prev?.costBasisUsd ?? 0;
  const newQty = prevQty + fill.quantity;
  const newCostBasis = prevCost + addedCost;
  const averageEntryPriceUsd = newQty > QTY_EPSILON ? newCostBasis / newQty : 0;

  positions[fill.mint] = {
    mint: fill.mint,
    quantity: newQty,
    averageEntryPriceUsd,
    costBasisUsd: newCostBasis,
    realizedPnlUsd: prev?.realizedPnlUsd ?? 0,
    unrealizedPnlUsd: 0,
    openedAt: prev?.openedAt ?? fill.filledAt,
    updatedAt: fill.filledAt,
  };

  return {
    ...state,
    positions,
    fills: [...state.fills, fill],
    simulatedNotionalUsd: state.simulatedNotionalUsd + fill.notionalUsd,
  };
}

export interface SellResult {
  state: PaperState;
  realizedPnlUsd: number;
}

/**
 * Apply a simulated SELL fill against an existing position. `fill.quantity` must
 * not exceed the held quantity (the caller clamps it). Realizes PnL against the
 * weighted-average entry and reduces (or closes) the position.
 */
export function applySellFill(state: PaperState, fill: PaperFill): SellResult {
  const positions = clonePositions(state.positions);
  const prev = positions[fill.mint];

  if (!prev || prev.quantity <= QTY_EPSILON) {
    // Nothing to sell — no-op apart from recording the (degenerate) fill.
    return {
      state: { ...state, positions, fills: [...state.fills, fill] },
      realizedPnlUsd: 0,
    };
  }

  const soldQty = Math.min(fill.quantity, prev.quantity);
  const realizedPnlUsd =
    (fill.priceUsd - prev.averageEntryPriceUsd) * soldQty - fill.feeUsd;
  const remainingQty = prev.quantity - soldQty;
  const soldCostBasis = prev.averageEntryPriceUsd * soldQty;

  let closedTradeCount = state.closedTradeCount;
  if (remainingQty <= QTY_EPSILON) {
    closedTradeCount += 1;
    delete positions[fill.mint];
  } else {
    positions[fill.mint] = {
      ...prev,
      quantity: remainingQty,
      costBasisUsd: prev.costBasisUsd - soldCostBasis,
      realizedPnlUsd: prev.realizedPnlUsd + realizedPnlUsd,
      updatedAt: fill.filledAt,
    };
  }

  return {
    state: {
      ...state,
      positions,
      fills: [...state.fills, fill],
      realizedPnlUsd: state.realizedPnlUsd + realizedPnlUsd,
      simulatedNotionalUsd: state.simulatedNotionalUsd + fill.notionalUsd,
      closedTradeCount,
    },
    realizedPnlUsd,
  };
}

/**
 * Recompute unrealized PnL for every open position from the latest injected
 * price per mint. A missing/invalid price leaves a position's unrealized at 0
 * (unknown, not assumed profitable).
 */
export function markUnrealized(
  state: PaperState,
  latestPriceByMint: Record<string, number>,
): PaperState {
  const positions = clonePositions(state.positions);
  let totalUnrealized = 0;
  for (const key of Object.keys(positions)) {
    const pos = positions[key];
    if (!pos) continue;
    const price = latestPriceByMint[key];
    const unrealized =
      typeof price === "number" && Number.isFinite(price) && price > 0
        ? (price - pos.averageEntryPriceUsd) * pos.quantity
        : 0;
    pos.unrealizedPnlUsd = unrealized;
    totalUnrealized += unrealized;
  }
  return { ...state, positions, unrealizedPnlUsd: totalUnrealized };
}
