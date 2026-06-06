/**
 * Data models for the deterministic, offline, **simulated-only** paper backtest
 * (the Sprint 8 bridge between journal-continuing paper runs and replay).
 *
 * A backtest replays an ordered list of injected **steps** through the real
 * production code paths — `planStrategyBatch` (decide) → `runPaperSession`
 * (simulate) — carrying the simulated portfolio forward between steps. Every
 * number here is simulated USD computed from *injected* prices: never live data,
 * never a real fill, never real performance. There are intentionally NO types for
 * a signer, secret key, keypair, transaction, route, or swap.
 *
 * A scenario is a single, self-contained, reproducible artifact: it embeds its
 * own strategy config and simulated caps so a replay is fully described by one
 * JSON file (no hidden defaults, no external state). Determinism comes from the
 * injected per-step clock (`at`) — the engine reads no wall-clock and no RNG.
 */

import type {
  PaperPosition,
  PaperPricePoint,
  PaperRiskCaps,
  PaperRunSummary,
} from "@soulmaker/paper";
import type { StrategyCandidate, StrategyConfig } from "@soulmaker/strategy";

/** One ordered replay step: the injected candidates + prices observed "at" a time. */
export interface BacktestStep {
  /** Stable, human id for the step (e.g. "step-1"). Required, non-empty. */
  id: string;
  /** ISO-8601 timestamp injected as the clock for this step. Required, non-empty. */
  at: string;
  /** Injected strategy candidates evaluated this step (each carries a risk report). */
  candidates: StrategyCandidate[];
  /** Injected (simulated) price observations available this step. */
  prices: PaperPricePoint[];
  /** Optional simulated take-profit threshold (percent) for this step's paper run. */
  takeProfitPct?: number;
  /** Optional simulated stop-loss threshold (percent) for this step's paper run. */
  stopLossPct?: number;
}

/**
 * A complete, self-contained backtest scenario. Strategy config and caps are
 * embedded (not split across files) so a scenario fully and reproducibly
 * describes one replay. Injected local data only — nothing here is fetched.
 */
export interface BacktestScenario {
  /** Human label for the scenario (echoed into the report). Required, non-empty. */
  name: string;
  /** Strategy thresholds + gates applied to every step (shared with the rules engine). */
  strategyConfig: StrategyConfig;
  /** Simulated risk caps + kill switch enforced before every simulated action. */
  caps: PaperRiskCaps;
  /** Ordered replay steps. Required and non-empty (an empty replay is refused). */
  steps: BacktestStep[];
  /**
   * Optional append-only paper journal (JSONL text) seeding the STARTING simulated
   * state (positions + realized PnL carried into step 1). Read strictly: a malformed
   * line or invalid fill refuses the scenario. The journal is never written.
   */
  initialJournal?: string;
  /**
   * Optional fallback simulated notional (USD) for converted *buy* candidates that
   * do not carry their own `proposedSizeUsd`. Without a positive size a buy is
   * rejected by the caps (non-positive size), so a sizeless scenario opens nothing.
   */
  defaultPaperSizeUsd?: number;
}

/** A single lint finding. `code` is stable (assertable); `message` is human + redaction-safe. */
export interface BacktestLintIssue {
  /** Stable kebab-case identifier (e.g. "duplicate-step-id"). */
  code: string;
  /** One-sentence human explanation. Never contains a secret (injected data only). */
  message: string;
  /** Optional dotted/bracketed path into the scenario (e.g. "steps[2].id"). */
  path?: string;
}

/** A compact, deterministic overview of the scenario the linter inspected. */
export interface BacktestScenarioLintSummary {
  /** Scenario name if it is a non-empty string, else null. */
  name: string | null;
  /** Number of steps (0 when `steps` is missing/not an array). */
  stepCount: number;
  /** Total injected candidates across all steps. */
  candidateCount: number;
  /** Total injected price points across all steps. */
  priceCount: number;
  /** Whether an embedded `initialJournal` string is present. */
  hasInitialJournal: boolean;
  errorCount: number;
  warningCount: number;
}

/** The structured result of linting one scenario. Deterministic + JSON-serializable. */
export interface BacktestScenarioLintResult {
  /** True iff there are zero errors (a run is possible; warnings may still exist). */
  valid: boolean;
  /** Blocking problems: structural validation failures + a malformed embedded journal. */
  errors: BacktestLintIssue[];
  /** Suspicious-but-allowed designs. A warning never blocks a run. */
  warnings: BacktestLintIssue[];
  summary: BacktestScenarioLintSummary;
}

/**
 * One deterministic equity-curve sample, taken after a replay step from the
 * carried-forward simulated state. Every value is simulated bookkeeping marked at
 * that step's injected prices — never a live result. There is exactly one entry
 * per step, in replay order.
 */
export interface BacktestEquityPoint {
  /** The step id this sample was taken after. */
  stepId: string;
  /** The step's injected timestamp. */
  at: string;
  /** Cumulative realized simulated PnL after this step (USD). */
  realizedPnlUsd: number;
  /** Unrealized simulated PnL marked at this step's injected prices (USD). */
  unrealizedPnlUsd: number;
  /** realized + unrealized (USD). */
  totalPnlUsd: number;
  /** Gross simulated turnover so far (USD). */
  simulatedNotionalUsd: number;
  /** Open simulated positions after this step. */
  openPositionCount: number;
  /** Closed simulated trades so far. */
  closedTradeCount: number;
}

/**
 * Deterministic per-mint aggregate over the final reconstructed simulated state.
 * Every field is EXACT bookkeeping derived from the injected fills (realized PnL
 * is recomputed by replaying that mint's own fills through the same weighted-average
 * engine; it is never estimated). Sorted by mint in the report.
 */
export interface BacktestPerMintAggregate {
  mint: string;
  /** Simulated BUY fills for this mint. */
  buyFillCount: number;
  /** Simulated SELL fills for this mint. */
  sellFillCount: number;
  /** Remaining open simulated quantity (0 when flat/closed). */
  openQuantity: number;
  /** Exact realized simulated PnL for this mint (USD). */
  realizedPnlUsd: number;
  /** Unrealized simulated PnL at the final step's injected price (USD; 0 when flat). */
  unrealizedPnlUsd: number;
  /** realized + unrealized (USD). */
  totalPnlUsd: number;
  /** Gross simulated turnover for this mint (USD). */
  simulatedNotionalUsd: number;
}

/** Deterministic, JSON-serializable per-step breakdown. Counts are this step only. */
export interface BacktestStepResult {
  id: string;
  at: string;
  /** Number of injected candidates evaluated this step. */
  candidateCount: number;
  paperBuyCandidateCount: number;
  paperSellCandidateCount: number;
  /** Simulated buy/sell fills this step. */
  buyCount: number;
  sellCount: number;
  /** Candidates rejected (risk + caps + price) by the paper engine this step. */
  rejectedCount: number;
  /** Cumulative realized simulated PnL after this step (USD). */
  realizedPnlUsd: number;
  /** Unrealized simulated PnL marked at this step's injected prices (USD). */
  unrealizedPnlUsd: number;
  /** Open simulated positions after this step. */
  openPositionCount: number;
}

/**
 * The full, deterministic backtest report. JSON-serializable as-is and byte-stable
 * for a given scenario (no clock/RNG beyond the injected per-step `at`). It carries
 * the required PAPER-ONLY / not-a-live-result / not-advice / not-a-profit-claim
 * language so that survives serialization. It is simulated bookkeeping — never a
 * live result, never a profitability claim, never advice.
 */
export interface BacktestReport {
  /** Stable report schema identifier (e.g. "backtest.report.v1"). */
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  /** The required disclaimer statements (stable order). */
  disclaimers: string[];
  /**
   * Scenario linter warnings (suspicious-but-allowed design), surfaced so a
   * questionable scenario is visible rather than hidden. Never blocks the run.
   */
  warnings: BacktestLintIssue[];
  scenarioName: string;
  /**
   * Deterministic, non-cryptographic 16-hex-char content digest of the
   * canonicalized scenario. For reproducibility/traceability only — NOT security.
   * Two scenarios that differ only in key order share a digest.
   */
  scenarioDigest: string;
  stepCount: number;
  /** Sum of `step.candidates.length` across all steps. */
  totalCandidateCount: number;
  /** Aggregated strategy-plan decision counts across all steps. */
  planCounts: {
    paperBuyCandidateCount: number;
    paperSellCandidateCount: number;
    watchCount: number;
    skippedCount: number;
    rejectedCount: number;
  };
  /** Simulated fills across all steps. */
  fillCounts: { buyCount: number; sellCount: number };
  /** Paper-engine rejections across all steps. */
  rejectedCounts: { byRisk: number; byCaps: number; byPrice: number; total: number };
  /** Final simulated position counts (includes any seeded state). */
  positionCounts: { open: number; closed: number };
  /** Final simulated PnL (includes any seeded realized PnL). */
  pnl: { realizedUsd: number; unrealizedUsd: number; totalUsd: number };
  /** Gross simulated turnover across the final reconstructed state (USD). */
  simulatedNotionalUsd: number;
  /** The production paper-run summary of the final reconstructed state. */
  finalSummary: PaperRunSummary;
  /** One deterministic equity sample per step, in replay order (length === stepCount). */
  equityCurve: BacktestEquityPoint[];
  /** Exact per-mint aggregates, sorted by mint. */
  perMint: BacktestPerMintAggregate[];
  /** Final open simulated positions (deterministic mint order). */
  openPositions: PaperPosition[];
  /** Per-step deterministic breakdown, in replay order. */
  steps: BacktestStepResult[];
}
