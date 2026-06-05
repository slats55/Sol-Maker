/**
 * Types for the deterministic, **paper-only** strategy rules engine
 * (Phase 5 / Sprint 5).
 *
 * The strategy engine turns an advisory `@soulmaker/risk` report plus a set of
 * *injected, read-only* market metrics into a single decision about whether a
 * token candidate should be skipped, watched, or submitted to the paper-trading
 * engine as a simulated buy/sell candidate. It is the layer that feeds
 * `@soulmaker/paper` — and **only** `@soulmaker/paper`.
 *
 * Hard rules (enforced by code + tests): nothing here builds, signs, simulates,
 * or sends a transaction. There is intentionally **no** type for a signer,
 * secret key, keypair, mnemonic, transaction, instruction, route, or swap, and
 * no dependency on a wallet, an RPC, the filesystem, the network, `Date.now`, or
 * `Math.random`. A `PAPER_BUY_CANDIDATE` means "candidate for *simulated* paper
 * evaluation", never "safe to buy", "approved for live trading", "profitable",
 * or "a buy recommendation".
 */

import type { RiskDecision, TokenRiskReport } from "@soulmaker/risk";

/**
 * The strategy's decision for a single candidate.
 *
 *  - `SKIP`                  — do nothing with this candidate.
 *  - `WATCH`                 — keep observing; take no simulated action yet.
 *  - `PAPER_BUY_CANDIDATE`   — eligible to be submitted to the *paper* engine as
 *                              a simulated buy candidate. NOT a real buy.
 *  - `PAPER_SELL_CANDIDATE`  — eligible to be submitted to the *paper* engine as
 *                              a simulated sell candidate (held position only).
 */
export type StrategyDecision =
  | "SKIP"
  | "WATCH"
  | "PAPER_BUY_CANDIDATE"
  | "PAPER_SELL_CANDIDATE";

/**
 * Optional, **injected** read-only market metrics for a candidate. Every field
 * is optional so the engine degrades gracefully; a metric that a configured gate
 * *requires* but that is missing is treated as a disqualifier (never assumed to
 * pass). These are supplied by the caller — the engine never fetches them.
 */
export interface StrategyMetrics {
  /** Injected (not live) price, USD. */
  priceUsd?: number;
  /** Injected pool/quote liquidity, USD. */
  liquidityUsd?: number;
  /** Injected recent traded volume, USD. */
  volumeUsd?: number;
  /** Token age in seconds (older is treated as marginally less risky). */
  ageSeconds?: number;
  /** Injected holder count. */
  holderCount?: number;
  /**
   * Injected price change, percent. For an *entry* (not held) it is the recent
   * move used to avoid chasing pumps; for a *held* position the caller injects
   * the change since entry, which the exit rules read.
   */
  priceChangePct?: number;
}

/**
 * Optional, read-only metadata about prior *simulated* paper activity for this
 * mint. Used by the cooldown and position-awareness rules. All timestamps are
 * ISO-8601 strings; PnL is simulated USD bookkeeping, never real performance.
 */
export interface PreviousPaperTradeMeta {
  /** True when a simulated position in this mint is currently open. */
  holdingPosition?: boolean;
  /** ISO timestamp of the most recent simulated trade in this mint. */
  lastTradeAt?: string;
  /** ISO timestamp of the most recent simulated *losing* trade in this mint. */
  lastLossAt?: string;
  /** Simulated realized PnL of the last closed trade in this mint (USD). */
  lastRealizedPnlUsd?: number;
  /** Simulated unrealized PnL of the currently-held position (USD). */
  unrealizedPnlUsd?: number;
}

/**
 * A token candidate to evaluate. Carries the advisory risk report from
 * `@soulmaker/risk`; a missing/undefined report is treated as a disqualifier
 * (fail-safe, like `@soulmaker/paper`). Everything here is read-only input — the
 * engine never mutates it.
 */
export interface StrategyCandidate {
  /** Token mint public key (base58). Required. */
  mint: string;
  symbol?: string;
  /** Advisory risk report. A missing report disqualifies the candidate. */
  riskReport?: TokenRiskReport;
  /** Optional injected, read-only market metrics. */
  metrics?: StrategyMetrics;
  /** Optional read-only metadata about prior simulated paper activity. */
  previousPaperTrade?: PreviousPaperTradeMeta;
  /** Provenance label, explicitly injected/read-only (e.g. "snipe-list"). */
  source?: string;
  /**
   * Optional simulated notional (USD) to attach if this candidate is converted
   * into a `PaperCandidate` by the strategy → paper *plan* pipeline. It is NOT
   * read by `evaluateStrategy` (the single-candidate decision ignores size); it
   * only sources `PaperCandidate.proposedSizeUsd` during batch planning. Never a
   * real order size — `paper:run` is simulation only.
   */
  proposedSizeUsd?: number;
}

/**
 * A lightweight, simulation-scoped view of the operator's current *paper*
 * portfolio, used by the position-awareness rules. It is decoupled from
 * `@soulmaker/paper`'s `PaperState` on purpose (so the engine is trivially
 * testable); `portfolioFromPaperState` adapts a real `PaperState` into it.
 */
export interface StrategyPortfolio {
  /** Number of currently open simulated positions. */
  openPositionCount: number;
  /** Mints currently held (simulated) — used for holding detection. */
  heldMints?: string[];
  /**
   * The most-concentrated open position's share of total simulated cost basis,
   * as a percent in `[0, 100]`. Used by the concentration guard.
   */
  topPositionConcentrationPct?: number;
}

/**
 * Strategy configuration. Thresholds operate on the engine's own deterministic
 * 0–100 score (see `score.ts`), except `maxRiskScore`, which is compared against
 * the advisory **risk** score from `@soulmaker/risk`.
 */
export interface StrategyConfig {
  /** Minimum strategy score to emit a `PAPER_BUY_CANDIDATE`. */
  minScoreForPaperBuy: number;
  /** Minimum strategy score to emit a `WATCH` (below this ⇒ `SKIP`). */
  minScoreForWatch: number;
  /** Maximum advisory **risk** score allowed; above it ⇒ `SKIP`. */
  maxRiskScore: number;
  /** Allow a `CAUTION` risk report to continue past the risk gate. Default false. */
  allowCaution?: boolean;

  /** If set, candidate liquidity must be present and ≥ this (USD), else `SKIP`. */
  minLiquidityUsd?: number;
  /** If set, candidate volume must be present and ≥ this (USD), else `SKIP`. */
  minVolumeUsd?: number;
  /** If set, |priceChangePct| above this disqualifies an entry, else `SKIP`. */
  maxPriceChangePct?: number;

  /** Cooldown (minutes) after a simulated loss in this mint; within it ⇒ `SKIP`. */
  cooldownAfterLossMinutes?: number;
  /** Cooldown (minutes) after any simulated trade; within it caps to `WATCH`. */
  cooldownAfterTradeMinutes?: number;

  /** Max open simulated positions; at the limit, no new `PAPER_BUY_CANDIDATE`. */
  maxOpenPositions?: number;
  /** Max single-position concentration (% of cost basis); above it caps to `WATCH`. */
  maxPositionConcentrationPct?: number;

  /**
   * Exit rule (held positions only): emit `PAPER_SELL_CANDIDATE` when the injected
   * price change since entry is ≥ this percent (take profit). Optional.
   */
  takeProfitPct?: number;
  /**
   * Exit rule (held positions only): emit `PAPER_SELL_CANDIDATE` when the injected
   * price change since entry is ≤ −this percent (stop loss). Optional.
   */
  stopLossPct?: number;
}

/** A single, stable, explained reason or disqualifier. Deterministic. */
export interface StrategyReason {
  /** Stable kebab-case identifier so tests can assert exact behavior. */
  id: string;
  /** One-sentence human explanation. */
  message: string;
  /** Machine-readable supporting facts (never secrets — injected data only). */
  evidence?: Record<string, unknown>;
}

/**
 * The full strategy report for one candidate. JSON-serializable as-is and
 * deterministic given an injected clock + id generator.
 */
export interface StrategyReport {
  /** Optional stable id from the injected id generator. */
  id: string;
  mint: string;
  symbol?: string;
  decision: StrategyDecision;
  /** Deterministic strategy score, always clamped to `[0, 100]`. */
  score: number;
  /** Positive / neutral reasons that shaped the decision. */
  reasons: StrategyReason[];
  /** Hard disqualifiers. Any disqualifier forces `SKIP`, overriding the score. */
  disqualifiers: StrategyReason[];
  /** The advisory risk decision that gated this evaluation. */
  riskDecision: RiskDecision | "MISSING";
  /** The advisory risk score (0–100), or `null` when no report was provided. */
  riskScore: number | null;
  /** Provenance label echoed from the candidate (read-only). */
  source?: string;
  /** ISO-8601 timestamp from the injected clock (deterministic in tests). */
  createdAt: string;
  /** Paper-only / not-advice disclaimer (single line). */
  disclaimer: string;
  /** Always true: this engine only ever feeds paper simulation. */
  paperOnly: true;
  /** Always true: strategy output is never financial advice. */
  notFinancialAdvice: true;
  /** The full set of required paper-only / not-advice statements. */
  notes: string[];
}
