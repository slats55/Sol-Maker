/**
 * The deterministic, offline, **simulated-only** paper backtest engine.
 *
 * `runBacktest` replays an injected {@link BacktestScenario} step by step through
 * the SAME production code paths the manual loop uses:
 *
 *   per step:  planStrategyBatch (decide)  →  runPaperSession (simulate, started
 *              from the carried-forward state)
 *   seed:      deriveStateFromJournalText (optional starting journal)
 *   final:     reduceJournal (canonical state from the full event log)  +
 *              markFinalUnrealized  +  summarize
 *
 * It is **pure**: no network, no RPC, no wallet, no filesystem, no `Date.now`,
 * no `Math.random`. The only clock is the per-step injected `at`. The scenario is
 * never mutated. The result is byte-stable for a given scenario. Everything it
 * reports is simulated bookkeeping from injected prices — never a live result,
 * never real performance, never a profitability claim, never advice. Nothing here
 * builds, signs, simulates, or sends a transaction.
 */

import {
  applyBuyFill,
  applySellFill,
  deriveStateFromJournalText,
  initialState,
  markFinalUnrealized,
  reduceJournal,
  summarize,
  type PaperJournalEvent,
  type PaperPosition,
  type PaperState,
  runPaperSession,
} from "@soulmaker/paper";
import { planStrategyBatch } from "@soulmaker/strategy";
import { digestContent } from "./digest.js";
import { collectScenarioIssues, computeScenarioWarnings } from "./lint.js";
import {
  BACKTEST_BANNER,
  BACKTEST_DISCLAIMERS,
  BACKTEST_REPORT_SCHEMA_VERSION,
} from "./report.js";
import type {
  BacktestEquityPoint,
  BacktestPerMintAggregate,
  BacktestReport,
  BacktestScenario,
  BacktestStepResult,
} from "./types.js";

/** A clear, non-secret error for a malformed/refused scenario. */
export class BacktestScenarioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestScenarioError";
  }
}

/**
 * Strictly validate raw input and narrow it to a {@link BacktestScenario}. Throws
 * {@link BacktestScenarioError} with a clear, non-secret message on the FIRST
 * problem. Delegates to the shared {@link collectScenarioIssues} core so the
 * throwing validator and the structured linter can never disagree about what is
 * structurally valid. An empty `steps` array is refused deliberately: a replay
 * with no steps is almost always a mistake, and silently "succeeding" would
 * misrepresent an empty result. Pure: it never mutates `input`.
 */
export function validateBacktestScenario(input: unknown): BacktestScenario {
  const { errors, scenario } = collectScenarioIssues(input);
  if (!scenario) {
    const first = errors[0];
    throw new BacktestScenarioError(first?.message ?? "scenario is invalid");
  }
  return scenario;
}

/** Back-compatible alias for {@link validateBacktestScenario}. */
export const validateScenario = validateBacktestScenario;

/** Strictly derive the seed state + its events from an optional initial journal. */
function seedFromJournal(
  initialJournal: string | undefined,
): { state: PaperState; events: PaperJournalEvent[] } {
  if (initialJournal === undefined) return { state: initialState(), events: [] };
  const { state, events, parseErrors, fillErrors } =
    deriveStateFromJournalText(initialJournal);
  if (parseErrors.length > 0) {
    const first = parseErrors[0];
    throw new BacktestScenarioError(
      `scenario.initialJournal is malformed: ${parseErrors.length} bad line(s); ` +
        `first at line ${first?.line}: ${first?.reason}`,
    );
  }
  if (fillErrors.length > 0) {
    const first = fillErrors[0];
    throw new BacktestScenarioError(
      `scenario.initialJournal has ${fillErrors.length} invalid fill event(s); ` +
        `first at event index ${first?.index}: ${first?.reason}`,
    );
  }
  return { state, events };
}

/** Final open positions in deterministic mint order (quantity > 0). */
function openPositionsOf(state: PaperState): PaperPosition[] {
  return Object.keys(state.positions)
    .sort()
    .map((k) => state.positions[k])
    .filter((p): p is PaperPosition => !!p && p.quantity > 0);
}

/**
 * Exact per-mint aggregates over the final reconstructed state. Realized PnL is
 * recomputed by replaying each mint's OWN fills through the same weighted-average
 * engine (cost basis is per-mint independent, so this is exact, not estimated).
 * Open quantity and unrealized PnL are read from the authoritative final state.
 * Sorted by mint.
 */
function aggregatePerMint(state: PaperState): BacktestPerMintAggregate[] {
  const mints = new Set<string>();
  for (const fill of state.fills) mints.add(fill.mint);

  const out: BacktestPerMintAggregate[] = [];
  for (const mint of [...mints].sort()) {
    let buyFillCount = 0;
    let sellFillCount = 0;
    let sub = initialState();
    for (const fill of state.fills) {
      if (fill.mint !== mint) continue;
      if (fill.side === "BUY") {
        buyFillCount += 1;
        sub = applyBuyFill(sub, fill);
      } else {
        sellFillCount += 1;
        sub = applySellFill(sub, fill).state;
      }
    }
    const pos = state.positions[mint];
    const realizedPnlUsd = sub.realizedPnlUsd;
    const unrealizedPnlUsd = pos?.unrealizedPnlUsd ?? 0;
    out.push({
      mint,
      buyFillCount,
      sellFillCount,
      openQuantity: pos?.quantity ?? 0,
      realizedPnlUsd,
      unrealizedPnlUsd,
      totalPnlUsd: realizedPnlUsd + unrealizedPnlUsd,
      simulatedNotionalUsd: sub.simulatedNotionalUsd,
    });
  }
  return out;
}

/**
 * Replay an injected scenario deterministically and produce a simulated,
 * PAPER-ONLY report. Pure and byte-stable; the scenario is never mutated.
 */
export function runBacktest(input: unknown): BacktestReport {
  const scenario = validateBacktestScenario(input);
  const seed = seedFromJournal(scenario.initialJournal);

  let runningState = seed.state;
  const stepEvents: PaperJournalEvent[] = [];
  const stepResults: BacktestStepResult[] = [];
  const equityCurve: BacktestEquityPoint[] = [];

  // Aggregated strategy-plan decision counts across all steps.
  let planBuy = 0;
  let planSell = 0;
  let planWatch = 0;
  let planSkipped = 0;
  let planRejected = 0;
  let totalCandidateCount = 0;

  for (const step of scenario.steps) {
    const at = (): string => step.at;
    // 1) Decide — same production planner, position-aware via the carried state.
    const plan = planStrategyBatch({
      candidates: step.candidates,
      config: scenario.strategyConfig,
      paperState: runningState,
      now: at,
      ...(scenario.defaultPaperSizeUsd !== undefined
        ? { defaultPaperSizeUsd: scenario.defaultPaperSizeUsd }
        : {}),
    });

    // 2) Simulate — same production paper engine, continued from the prior state.
    const run = runPaperSession({
      caps: scenario.caps,
      candidates: plan.paperCandidates,
      prices: step.prices,
      startingState: runningState,
      now: at,
      ...(step.takeProfitPct !== undefined ? { takeProfitPct: step.takeProfitPct } : {}),
      ...(step.stopLossPct !== undefined ? { stopLossPct: step.stopLossPct } : {}),
    });

    runningState = run.state;
    stepEvents.push(...run.events);

    totalCandidateCount += step.candidates.length;
    planBuy += plan.paperBuyCandidateCount;
    planSell += plan.paperSellCandidateCount;
    planWatch += plan.watchCount;
    planSkipped += plan.skippedCount;
    planRejected += plan.rejectedCount;

    stepResults.push({
      id: step.id,
      at: step.at,
      candidateCount: step.candidates.length,
      paperBuyCandidateCount: plan.paperBuyCandidateCount,
      paperSellCandidateCount: plan.paperSellCandidateCount,
      buyCount: run.summary.buyCount,
      sellCount: run.summary.sellCount,
      rejectedCount: run.summary.rejectedCandidateCount,
      realizedPnlUsd: run.summary.realizedPnlUsd,
      unrealizedPnlUsd: run.summary.unrealizedPnlUsd,
      openPositionCount: run.summary.openPositionCount,
    });

    // Equity sample from the carried-forward state after this step (cumulative
    // realized/notional/closed; unrealized marked at this step's prices).
    equityCurve.push({
      stepId: step.id,
      at: step.at,
      realizedPnlUsd: run.summary.realizedPnlUsd,
      unrealizedPnlUsd: run.summary.unrealizedPnlUsd,
      totalPnlUsd: run.summary.totalPnlUsd,
      simulatedNotionalUsd: run.summary.simulatedNotionalUsd,
      openPositionCount: run.summary.openPositionCount,
      closedTradeCount: run.summary.closedTradeCount,
    });
  }

  // 3) Reconstruct the final state canonically from the full append-only event
  //    log (seed + every step), then mark unrealized at the LAST step's prices.
  const allEvents = [...seed.events, ...stepEvents];
  const reconstructed = reduceJournal(allEvents);
  const lastStep = scenario.steps[scenario.steps.length - 1];
  const finalState = markFinalUnrealized(reconstructed, lastStep?.prices ?? []);
  // Counts reflect the REPLAY steps; PnL/positions reflect the final state.
  const finalSummary = summarize(finalState, stepEvents);

  return {
    schemaVersion: BACKTEST_REPORT_SCHEMA_VERSION,
    banner: BACKTEST_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...BACKTEST_DISCLAIMERS],
    warnings: computeScenarioWarnings(scenario),
    scenarioName: scenario.name,
    scenarioDigest: digestContent(scenario),
    stepCount: scenario.steps.length,
    totalCandidateCount,
    planCounts: {
      paperBuyCandidateCount: planBuy,
      paperSellCandidateCount: planSell,
      watchCount: planWatch,
      skippedCount: planSkipped,
      rejectedCount: planRejected,
    },
    fillCounts: { buyCount: finalSummary.buyCount, sellCount: finalSummary.sellCount },
    rejectedCounts: {
      byRisk: finalSummary.rejectedByRisk,
      byCaps: finalSummary.rejectedByCaps,
      byPrice: finalSummary.rejectedByPrice,
      total: finalSummary.rejectedCandidateCount,
    },
    positionCounts: {
      open: finalSummary.openPositionCount,
      closed: finalSummary.closedTradeCount,
    },
    pnl: {
      realizedUsd: finalSummary.realizedPnlUsd,
      unrealizedUsd: finalSummary.unrealizedPnlUsd,
      totalUsd: finalSummary.totalPnlUsd,
    },
    simulatedNotionalUsd: finalSummary.simulatedNotionalUsd,
    finalSummary,
    equityCurve,
    perMint: aggregatePerMint(finalState),
    openPositions: openPositionsOf(finalState),
    steps: stepResults,
  };
}
