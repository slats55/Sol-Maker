/**
 * Deterministic paper-run orchestration.
 *
 * Given simulated caps, candidates (each carrying an advisory risk report) and
 * injected price points, produce an ordered list of journal events plus the
 * final portfolio state and summary. Pure: no network, no RPC, no wallet, no
 * clock beyond an injectable `now` (defaulted to a fixed value so the package
 * never reads wall-clock time itself).
 *
 * Nothing here builds, signs, simulates, or sends a transaction. "Fill" means a
 * bookkeeping entry against an injected price — not an on-chain event.
 */

import { checkBuyCaps, openPositionCount } from "./caps.js";
import {
  applyBuyFill,
  applySellFill,
  cloneState,
  initialState,
  markUnrealized,
} from "./engine.js";
import { makeIdGen } from "./ids.js";
import { summarize } from "./report.js";
import type {
  PaperCandidate,
  PaperFill,
  PaperJournalEvent,
  PaperOrder,
  PaperPricePoint,
  PaperRiskCaps,
  PaperRunResult,
  PaperState,
} from "./types.js";

export interface PaperRunInput {
  caps: PaperRiskCaps;
  candidates: PaperCandidate[];
  prices: PaperPricePoint[];
  /** Take-profit threshold in percent (e.g. 50 = +50%). Optional. */
  takeProfitPct?: number;
  /** Stop-loss threshold in percent (e.g. 20 = -20%). Optional. */
  stopLossPct?: number;
  /** Flat simulated fee per fill, in USD. Default 0. */
  feeUsd?: number;
  /**
   * Optional existing simulated portfolio to start this run from (e.g. derived
   * from an append-only journal via `deriveStateFromJournalText`). When omitted,
   * the run starts from the empty {@link initialState} (unchanged default). The
   * provided state is cloned and never mutated; caps, sells, and PnL all see the
   * carried-forward positions, so a run can sell or add to a pre-existing
   * position and the daily-loss / open-position / per-position caps account for it.
   */
  startingState?: PaperState;
  /** Injectable clock for run-level events. Default fixed (pure). */
  now?: () => string;
}

/** Pure default clock — the package never reads real wall-clock time. */
const DEFAULT_NOW = () => "1970-01-01T00:00:00.000Z";

function firstPriceFor(
  prices: PaperPricePoint[],
  mint: string,
): PaperPricePoint | undefined {
  return prices.find((p) => p.mint === mint);
}

function lastPriceFor(
  prices: PaperPricePoint[],
  mint: string,
): PaperPricePoint | undefined {
  let found: PaperPricePoint | undefined;
  for (const p of prices) if (p.mint === mint) found = p;
  return found;
}

function seriesFor(prices: PaperPricePoint[], mint: string): PaperPricePoint[] {
  return prices.filter((p) => p.mint === mint);
}

function latestPriceByMint(prices: PaperPricePoint[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of prices) {
    if (Number.isFinite(p.priceUsd) && p.priceUsd > 0) out[p.mint] = p.priceUsd;
  }
  return out;
}

function isPositivePrice(priceUsd: number): boolean {
  return Number.isFinite(priceUsd) && priceUsd > 0;
}

/** Run a deterministic simulated paper session. */
export function runPaperSession(input: PaperRunInput): PaperRunResult {
  const { caps, candidates, prices } = input;
  const now = input.now ?? DEFAULT_NOW;
  const feeUsd = input.feeUsd ?? 0;
  const nextOrderId = makeIdGen("order");
  const nextFillId = makeIdGen("fill");

  // Non-positive TP/SL thresholds are treated as "disabled": a 0% (or negative)
  // band would otherwise fire on the entry tick itself, where pctChange === 0.
  const takeProfitPct =
    input.takeProfitPct !== undefined && input.takeProfitPct > 0
      ? input.takeProfitPct
      : undefined;
  const stopLossPct =
    input.stopLossPct !== undefined && input.stopLossPct > 0
      ? input.stopLossPct
      : undefined;

  // Start from the injected state (cloned, so the caller's object is never
  // mutated) or the empty initial state. Either way every reducer below returns
  // fresh state, so `input.startingState` is left untouched.
  let state = input.startingState ? cloneState(input.startingState) : initialState();
  const events: PaperJournalEvent[] = [];

  events.push({
    type: "RUN_STARTED",
    at: now(),
    caps,
    note: "Simulated paper run — no transaction was built, signed, simulated, or sent.",
  });

  // Global kill switch: refuse all simulated trades, finalize, and return.
  if (caps.killSwitch) {
    events.push({
      type: "KILL_SWITCH_ACTIVE",
      at: now(),
      reason: "kill switch engaged; no simulated trades performed",
    });
    state = markUnrealized(state, latestPriceByMint(prices));
    const summary = summarize(state, events);
    events.push({ type: "RUN_COMPLETED", at: now(), summary });
    return { events, state, summary };
  }

  const buildFill = (
    order: PaperOrder,
    price: PaperPricePoint,
    quantity: number,
  ): PaperFill => ({
    id: nextFillId(),
    orderId: order.id,
    mint: order.mint,
    side: order.side,
    priceUsd: price.priceUsd,
    quantity,
    notionalUsd: quantity * price.priceUsd,
    feeUsd,
    filledAt: price.observedAt,
  });

  for (const candidate of candidates) {
    const side = candidate.proposedSide ?? "BUY";
    if (side === "BUY") {
      processBuy(candidate);
    } else {
      processSell(candidate);
    }
  }

  // Take-profit / stop-loss sweep over open positions (deterministic mint order).
  if (takeProfitPct !== undefined || stopLossPct !== undefined) {
    for (const mint of Object.keys(state.positions).sort()) {
      evaluateExits(mint);
    }
  }

  state = markUnrealized(state, latestPriceByMint(prices));
  const summary = summarize(state, events);
  events.push({ type: "RUN_COMPLETED", at: now(), summary });
  return { events, state, summary };

  // --- helpers (close over state/events) ----------------------------------

  function processBuy(candidate: PaperCandidate): void {
    const mint = candidate.mint;
    const decision = candidate.riskReport?.decision ?? "UNKNOWN";
    const allowCaution = caps.allowCautionRiskReports === true;
    const eligible =
      decision === "PASS_FOR_PAPER_EVALUATION" ||
      (decision === "CAUTION" && allowCaution);
    if (!eligible) {
      events.push({
        type: "CANDIDATE_REJECTED_BY_RISK",
        at: candidate.riskReport?.generatedAt ?? now(),
        mint,
        decision,
        reason:
          decision === "CAUTION"
            ? "risk decision CAUTION not eligible for paper buy (allowCautionRiskReports=false)"
            : `risk decision ${decision} is not PASS_FOR_PAPER_EVALUATION`,
      });
      return;
    }

    const price = firstPriceFor(prices, mint);
    if (!price) {
      events.push({
        type: "CANDIDATE_REJECTED_BY_PRICE",
        at: now(),
        mint,
        reason: "no injected price point for mint",
      });
      return;
    }
    if (!isPositivePrice(price.priceUsd)) {
      events.push({
        type: "CANDIDATE_REJECTED_BY_PRICE",
        at: now(),
        mint,
        reason: `injected price is non-positive/invalid (${price.priceUsd})`,
      });
      return;
    }

    const cap = checkBuyCaps(caps, state, mint, candidate.proposedSizeUsd);
    if (!cap.ok) {
      events.push({
        type: "CANDIDATE_REJECTED_BY_CAPS",
        at: price.observedAt,
        mint,
        cap: cap.cap,
        reason: cap.reason,
      });
      return;
    }

    const quantity = candidate.proposedSizeUsd / price.priceUsd;
    const order: PaperOrder = {
      id: nextOrderId(),
      mint,
      side: "BUY",
      requestedSizeUsd: candidate.proposedSizeUsd,
      requestedQuantity: quantity,
      createdAt: price.observedAt,
      status: "FILLED",
    };
    const fill = buildFill(order, price, quantity);
    state = applyBuyFill(state, fill);
    events.push({ type: "PAPER_BUY_FILLED", at: fill.filledAt, fill });
  }

  function processSell(candidate: PaperCandidate): void {
    const mint = candidate.mint;
    const pos = state.positions[mint];
    if (!pos || pos.quantity <= 0) {
      events.push({
        type: "CANDIDATE_REJECTED_BY_CAPS",
        at: now(),
        mint,
        cap: "noOpenPosition",
        reason: "cannot sell — no open simulated position for mint",
      });
      return;
    }
    // An explicit sell happens "now" — price at the latest injected observation.
    const price = lastPriceFor(prices, mint);
    if (!price) {
      events.push({
        type: "CANDIDATE_REJECTED_BY_PRICE",
        at: now(),
        mint,
        reason: "no injected price point for mint",
      });
      return;
    }
    if (!isPositivePrice(price.priceUsd)) {
      events.push({
        type: "CANDIDATE_REJECTED_BY_PRICE",
        at: now(),
        mint,
        reason: `injected price is non-positive/invalid (${price.priceUsd})`,
      });
      return;
    }
    const wantQty =
      candidate.proposedSizeUsd > 0
        ? candidate.proposedSizeUsd / price.priceUsd
        : pos.quantity;
    const quantity = Math.min(wantQty, pos.quantity);
    sellPosition(mint, price, quantity);
  }

  function evaluateExits(mint: string): void {
    const pos = state.positions[mint];
    if (!pos || pos.quantity <= 0) return;
    const avg = pos.averageEntryPriceUsd;
    if (!(avg > 0)) return;
    for (const p of seriesFor(prices, mint)) {
      if (!isPositivePrice(p.priceUsd)) continue;
      const pctChange = ((p.priceUsd - avg) / avg) * 100;
      if (takeProfitPct !== undefined && pctChange >= takeProfitPct) {
        events.push({
          type: "TAKE_PROFIT_TRIGGERED",
          at: p.observedAt,
          mint,
          priceUsd: p.priceUsd,
          reason: `price +${pctChange.toFixed(2)}% reached take-profit ${takeProfitPct}%`,
        });
        sellPosition(mint, p, pos.quantity);
        return;
      }
      if (stopLossPct !== undefined && pctChange <= -stopLossPct) {
        events.push({
          type: "STOP_LOSS_TRIGGERED",
          at: p.observedAt,
          mint,
          priceUsd: p.priceUsd,
          reason: `price ${pctChange.toFixed(2)}% reached stop-loss ${stopLossPct}%`,
        });
        sellPosition(mint, p, pos.quantity);
        return;
      }
    }
  }

  function sellPosition(
    mint: string,
    price: PaperPricePoint,
    quantity: number,
  ): void {
    const order: PaperOrder = {
      id: nextOrderId(),
      mint,
      side: "SELL",
      requestedSizeUsd: quantity * price.priceUsd,
      requestedQuantity: quantity,
      createdAt: price.observedAt,
      status: "FILLED",
    };
    const fill = buildFill(order, price, quantity);
    const result = applySellFill(state, fill);
    state = result.state;
    events.push({
      type: "PAPER_SELL_FILLED",
      at: fill.filledAt,
      fill,
      realizedPnlUsd: result.realizedPnlUsd,
    });
  }
}

/** Re-exported for callers that want the open-position count of a state. */
export { openPositionCount };

/** Build a stable map of latest injected price per mint (exported for the CLI). */
export function latestPrices(prices: PaperPricePoint[]): Record<string, number> {
  return latestPriceByMint(prices);
}

export function markFinalUnrealized(
  state: PaperState,
  prices: PaperPricePoint[],
): PaperState {
  return markUnrealized(state, latestPriceByMint(prices));
}
