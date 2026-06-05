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
  deriveStateFromJournalText,
  initialState,
  markFinalUnrealized,
  reduceJournal,
  summarize,
  type PaperJournalEvent,
  type PaperPosition,
  type PaperRiskCaps,
  type PaperState,
  runPaperSession,
} from "@soulmaker/paper";
import { planStrategyBatch, type StrategyConfig } from "@soulmaker/strategy";
import { BACKTEST_BANNER, BACKTEST_DISCLAIMERS } from "./report.js";
import type {
  BacktestReport,
  BacktestScenario,
  BacktestStep,
  BacktestStepResult,
} from "./types.js";

/** A clear, non-secret error for a malformed/refused scenario. */
export class BacktestScenarioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestScenarioError";
  }
}

function fail(message: string): never {
  throw new BacktestScenarioError(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Validate the embedded strategy config (the required numeric thresholds). */
function validateStrategyConfig(value: unknown): StrategyConfig {
  if (!isObject(value)) fail("scenario.strategyConfig must be an object");
  for (const key of ["minScoreForPaperBuy", "minScoreForWatch", "maxRiskScore"] as const) {
    if (!isFiniteNumber(value[key])) {
      fail(`scenario.strategyConfig.${key} must be a finite number`);
    }
  }
  return value as unknown as StrategyConfig;
}

/** Validate the embedded simulated caps (the required numeric + kill-switch fields). */
function validateCaps(value: unknown): PaperRiskCaps {
  if (!isObject(value)) fail("scenario.caps must be an object");
  for (const key of ["maxTradeSizeUsd", "maxDailyLossUsd"] as const) {
    const v = value[key];
    if (!isFiniteNumber(v) || v < 0) fail(`scenario.caps.${key} must be a non-negative number`);
  }
  const maxOpen = value.maxOpenPositions;
  if (!isFiniteNumber(maxOpen) || maxOpen < 0 || !Number.isInteger(maxOpen)) {
    fail("scenario.caps.maxOpenPositions must be a non-negative integer");
  }
  if (value.killSwitch !== undefined && typeof value.killSwitch !== "boolean") {
    fail("scenario.caps.killSwitch must be a boolean when present");
  }
  if (
    value.maxPositionSizeUsd !== undefined &&
    (!isFiniteNumber(value.maxPositionSizeUsd) || value.maxPositionSizeUsd < 0)
  ) {
    fail("scenario.caps.maxPositionSizeUsd must be a non-negative number when present");
  }
  return value as unknown as PaperRiskCaps;
}

/** Validate one replay step's envelope (deep candidate/price *shape*, not policy). */
function validateStep(value: unknown, index: number): BacktestStep {
  if (!isObject(value)) fail(`scenario.steps[${index}] must be an object`);
  if (!nonEmptyString(value.id)) fail(`scenario.steps[${index}].id must be a non-empty string`);
  if (!nonEmptyString(value.at)) fail(`scenario.steps[${index}].at must be a non-empty string`);
  if (!Array.isArray(value.candidates)) {
    fail(`scenario.steps[${index}].candidates must be an array`);
  }
  if (!Array.isArray(value.prices)) {
    fail(`scenario.steps[${index}].prices must be an array`);
  }
  value.candidates.forEach((c, ci) => {
    if (!isObject(c) || !nonEmptyString(c.mint)) {
      fail(`scenario.steps[${index}].candidates[${ci}].mint must be a non-empty string`);
    }
  });
  value.prices.forEach((p, pi) => {
    if (!isObject(p) || !nonEmptyString(p.mint)) {
      fail(`scenario.steps[${index}].prices[${pi}].mint must be a non-empty string`);
    }
    if (!isFiniteNumber(p.priceUsd)) {
      fail(`scenario.steps[${index}].prices[${pi}].priceUsd must be a finite number`);
    }
    if (!nonEmptyString(p.observedAt)) {
      fail(`scenario.steps[${index}].prices[${pi}].observedAt must be a non-empty string`);
    }
  });
  for (const key of ["takeProfitPct", "stopLossPct"] as const) {
    if (value[key] !== undefined && !isFiniteNumber(value[key])) {
      fail(`scenario.steps[${index}].${key} must be a finite number when present`);
    }
  }
  return value as unknown as BacktestStep;
}

/**
 * Strictly validate raw input and narrow it to a {@link BacktestScenario}. Throws
 * {@link BacktestScenarioError} with a clear, non-secret message on any problem.
 * An empty `steps` array is refused deliberately: a replay with no steps is almost
 * always a mistake, and silently "succeeding" would misrepresent an empty result.
 */
export function validateScenario(input: unknown): BacktestScenario {
  if (!isObject(input)) fail("scenario must be a JSON object");
  if (!nonEmptyString(input.name)) fail("scenario.name must be a non-empty string");
  const strategyConfig = validateStrategyConfig(input.strategyConfig);
  const caps = validateCaps(input.caps);
  if (!Array.isArray(input.steps)) fail("scenario.steps must be an array");
  if (input.steps.length === 0) fail("scenario.steps must not be empty");
  const steps = input.steps.map((s, i) => validateStep(s, i));
  if (input.initialJournal !== undefined && typeof input.initialJournal !== "string") {
    fail("scenario.initialJournal must be a string (JSONL) when present");
  }
  if (
    input.defaultPaperSizeUsd !== undefined &&
    (!isFiniteNumber(input.defaultPaperSizeUsd) || input.defaultPaperSizeUsd < 0)
  ) {
    fail("scenario.defaultPaperSizeUsd must be a non-negative number when present");
  }

  const scenario: BacktestScenario = { name: input.name, strategyConfig, caps, steps };
  if (typeof input.initialJournal === "string") scenario.initialJournal = input.initialJournal;
  if (isFiniteNumber(input.defaultPaperSizeUsd)) {
    scenario.defaultPaperSizeUsd = input.defaultPaperSizeUsd;
  }
  return scenario;
}

/** Strictly derive the seed state + its events from an optional initial journal. */
function seedFromJournal(
  initialJournal: string | undefined,
): { state: PaperState; events: PaperJournalEvent[] } {
  if (initialJournal === undefined) return { state: initialState(), events: [] };
  const { state, events, parseErrors, fillErrors } =
    deriveStateFromJournalText(initialJournal);
  if (parseErrors.length > 0) {
    const first = parseErrors[0];
    fail(
      `scenario.initialJournal is malformed: ${parseErrors.length} bad line(s); ` +
        `first at line ${first?.line}: ${first?.reason}`,
    );
  }
  if (fillErrors.length > 0) {
    const first = fillErrors[0];
    fail(
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
 * Replay an injected scenario deterministically and produce a simulated,
 * PAPER-ONLY report. Pure and byte-stable; the scenario is never mutated.
 */
export function runBacktest(input: unknown): BacktestReport {
  const scenario = validateScenario(input);
  const seed = seedFromJournal(scenario.initialJournal);

  let runningState = seed.state;
  const stepEvents: PaperJournalEvent[] = [];
  const stepResults: BacktestStepResult[] = [];

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
    banner: BACKTEST_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...BACKTEST_DISCLAIMERS],
    scenarioName: scenario.name,
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
    openPositions: openPositionsOf(finalState),
    steps: stepResults,
  };
}
