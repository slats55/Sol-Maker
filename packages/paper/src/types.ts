/**
 * Data models for the deterministic, offline, **simulated-only** paper trading
 * engine (Phase 4 / Sprint 4).
 *
 * Everything here is simulation. There are intentionally NO types for signers,
 * secret keys, keypairs, transactions, instructions, routes, or swaps. Prices
 * are *injected* (mocked) values, not live market data, and PnL computed from
 * them is simulated bookkeeping — never real market performance. A risk
 * `PASS_FOR_PAPER_EVALUATION` means "eligible for paper evaluation", never
 * "safe", "approved for live trading", "profitable", or "executable".
 */

import type { RiskDecision, TokenRiskReport } from "@soulmaker/risk";

/** All amounts are simulated USD computed from injected prices. */
export type PaperSide = "BUY" | "SELL";

/**
 * A candidate token to evaluate in simulation. Carries the advisory risk report
 * produced by `@soulmaker/risk`; only `PASS_FOR_PAPER_EVALUATION` is eligible
 * for a simulated buy (CAUTION only with an explicit, defaulted-off opt-in).
 */
export interface PaperCandidate {
  mint: string;
  symbol?: string;
  /** Advisory risk report. A missing/invalid report is treated as REJECT. */
  riskReport?: TokenRiskReport;
  /** Defaults to BUY. SELL requires an existing simulated position. */
  proposedSide?: PaperSide;
  /** Simulated notional to deploy, in USD. */
  proposedSizeUsd: number;
  /** Free-form provenance for auditability (e.g. "snipe-list", "manual"). */
  source?: string;
  reason?: string;
}

/**
 * An injected (simulated) price observation. `source` must make clear the price
 * is injected/simulated — these are never fetched from a live market here.
 */
export interface PaperPricePoint {
  mint: string;
  priceUsd: number;
  observedAt: string;
  /** Explicitly injected/simulated label, e.g. "injected-fixture". */
  source: string;
}

export type PaperOrderStatus = "CREATED" | "FILLED" | "REJECTED";

/** A simulated order. Never sent anywhere — it is local bookkeeping only. */
export interface PaperOrder {
  id: string;
  mint: string;
  side: PaperSide;
  requestedSizeUsd: number;
  requestedQuantity?: number;
  createdAt: string;
  status: PaperOrderStatus;
}

/** A simulated fill against an injected price. */
export interface PaperFill {
  id: string;
  orderId: string;
  mint: string;
  side: PaperSide;
  priceUsd: number;
  quantity: number;
  notionalUsd: number;
  /** Simulated fee, default 0 unless explicitly configured. */
  feeUsd: number;
  filledAt: string;
}

/** A simulated open (or just-closed) position. */
export interface PaperPosition {
  mint: string;
  quantity: number;
  averageEntryPriceUsd: number;
  costBasisUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  openedAt: string;
  updatedAt: string;
}

/**
 * Simulated risk caps enforced BEFORE every simulated action. These are a
 * separate, simulation-scoped concept (USD) from the on-chain SOL caps in
 * `@soulmaker/core` (which gate real sends — irrelevant here, nothing sends).
 */
export interface PaperRiskCaps {
  maxTradeSizeUsd: number;
  maxDailyLossUsd: number;
  maxOpenPositions: number;
  /** When true, no simulated trade is allowed (emergency stop). */
  killSwitch: boolean;
  /** Optional ceiling on a single position's total cost basis. */
  maxPositionSizeUsd?: number;
  /** Allow CAUTION risk reports into paper evaluation. Defaults to false. */
  allowCautionRiskReports?: boolean;
}

export type PaperJournalEventType =
  | "RUN_STARTED"
  | "CANDIDATE_REJECTED_BY_RISK"
  | "CANDIDATE_REJECTED_BY_CAPS"
  | "CANDIDATE_REJECTED_BY_PRICE"
  | "PAPER_BUY_FILLED"
  | "PAPER_SELL_FILLED"
  | "STOP_LOSS_TRIGGERED"
  | "TAKE_PROFIT_TRIGGERED"
  | "KILL_SWITCH_ACTIVE"
  | "RUN_COMPLETED";

/**
 * Append-only journal events. A discriminated union: every event has a `type`
 * and an ISO `at`. Fill events carry the full {@link PaperFill} so portfolio
 * state can be reconstructed from the journal alone.
 */
export type PaperJournalEvent =
  | { type: "RUN_STARTED"; at: string; caps: PaperRiskCaps; note: string }
  | {
      type: "CANDIDATE_REJECTED_BY_RISK";
      at: string;
      mint: string;
      decision: RiskDecision | "UNKNOWN";
      reason: string;
    }
  | {
      type: "CANDIDATE_REJECTED_BY_CAPS";
      at: string;
      mint: string;
      cap: string;
      reason: string;
    }
  | {
      type: "CANDIDATE_REJECTED_BY_PRICE";
      at: string;
      mint: string;
      reason: string;
    }
  | { type: "PAPER_BUY_FILLED"; at: string; fill: PaperFill }
  | {
      type: "PAPER_SELL_FILLED";
      at: string;
      fill: PaperFill;
      realizedPnlUsd: number;
    }
  | { type: "STOP_LOSS_TRIGGERED"; at: string; mint: string; priceUsd: number; reason: string }
  | { type: "TAKE_PROFIT_TRIGGERED"; at: string; mint: string; priceUsd: number; reason: string }
  | { type: "KILL_SWITCH_ACTIVE"; at: string; reason: string }
  | { type: "RUN_COMPLETED"; at: string; summary: PaperRunSummary };

/** Reconstructable portfolio state (positions + realized PnL + counters). */
export interface PaperState {
  /** Keyed by mint. A closed position is removed (quantity returns to flat). */
  positions: Record<string, PaperPosition>;
  realizedPnlUsd: number;
  /**
   * Aggregate unrealized PnL. Authoritative ONLY immediately after
   * `markUnrealized` — the fill reducers do not maintain it (they cannot, having
   * no price), so it may be stale between a fill and the next mark. Every run
   * path re-marks before summarizing; `reduceJournal` leaves it 0 by design.
   */
  unrealizedPnlUsd: number;
  fills: PaperFill[];
  closedTradeCount: number;
  /** Gross simulated turnover (buys + sells), not net deployed capital. */
  simulatedNotionalUsd: number;
}

/** Summary of a paper run (or a reconstructed journal). */
export interface PaperRunSummary {
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  openPositionCount: number;
  closedTradeCount: number;
  buyCount: number;
  sellCount: number;
  rejectedCandidateCount: number;
  rejectedByRisk: number;
  rejectedByCaps: number;
  rejectedByPrice: number;
  simulatedNotionalUsd: number;
}

/** The full result of a deterministic paper run. */
export interface PaperRunResult {
  events: PaperJournalEvent[];
  state: PaperState;
  summary: PaperRunSummary;
}
