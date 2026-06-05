/**
 * Simulated risk-cap and kill-switch checks — pure predicates evaluated BEFORE
 * every simulated action. Returning a structured result (rather than throwing)
 * lets the run loop record a precise rejection event for the journal.
 */

import type { PaperRiskCaps, PaperState } from "./types.js";

export interface CapDecision {
  ok: boolean;
  /** Which cap blocked the action (for the journal). Empty when ok. */
  cap: string;
  reason: string;
}

const OK: CapDecision = { ok: true, cap: "", reason: "" };

/** Count positions that currently hold a non-zero quantity. */
export function openPositionCount(state: PaperState): number {
  let count = 0;
  for (const key of Object.keys(state.positions)) {
    const pos = state.positions[key];
    if (pos && pos.quantity > 0) count += 1;
  }
  return count;
}

/**
 * Check whether a simulated BUY of `sizeUsd` for `mint` is allowed under the
 * caps and current state. Order is fixed and deterministic; the first failing
 * cap is reported.
 */
export function checkBuyCaps(
  caps: PaperRiskCaps,
  state: PaperState,
  mint: string,
  sizeUsd: number,
): CapDecision {
  if (caps.killSwitch) {
    return { ok: false, cap: "killSwitch", reason: "kill switch engaged" };
  }
  if (!Number.isFinite(sizeUsd) || sizeUsd <= 0) {
    return {
      ok: false,
      cap: "proposedSizeUsd",
      reason: `non-positive or invalid proposed size (${sizeUsd})`,
    };
  }
  if (sizeUsd > caps.maxTradeSizeUsd) {
    return {
      ok: false,
      cap: "maxTradeSizeUsd",
      reason: `size ${sizeUsd} exceeds maxTradeSizeUsd ${caps.maxTradeSizeUsd}`,
    };
  }
  // Daily loss cap: once realized losses reach the cap, block further buys.
  if (state.realizedPnlUsd <= -caps.maxDailyLossUsd) {
    return {
      ok: false,
      cap: "maxDailyLossUsd",
      reason: `realized loss ${state.realizedPnlUsd} reached maxDailyLossUsd ${caps.maxDailyLossUsd}`,
    };
  }
  // Max open positions: only blocks opening a NEW position (not adding to one).
  const existing = state.positions[mint];
  const isNewPosition = !existing || existing.quantity <= 0;
  if (isNewPosition && openPositionCount(state) >= caps.maxOpenPositions) {
    return {
      ok: false,
      cap: "maxOpenPositions",
      reason: `already at maxOpenPositions ${caps.maxOpenPositions}`,
    };
  }
  // Optional per-position size ceiling on total cost basis.
  if (caps.maxPositionSizeUsd !== undefined) {
    const existingCost = existing?.costBasisUsd ?? 0;
    if (existingCost + sizeUsd > caps.maxPositionSizeUsd) {
      return {
        ok: false,
        cap: "maxPositionSizeUsd",
        reason: `position cost ${existingCost + sizeUsd} would exceed maxPositionSizeUsd ${caps.maxPositionSizeUsd}`,
      };
    }
  }
  return OK;
}
