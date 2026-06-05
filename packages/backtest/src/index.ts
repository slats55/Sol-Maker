/**
 * @soulmaker/backtest — deterministic, offline, **simulated-only** paper backtest
 * (the Sprint 8 bridge between journal-continuing paper runs and replay).
 *
 * It replays injected historical steps through the SAME production code paths as
 * the manual loop — `planStrategyBatch` (decide) then `runPaperSession` started
 * from the carried-forward simulated state — and reports a deterministic summary.
 * It sits ABOVE both `@soulmaker/strategy` and `@soulmaker/paper` (it depends on
 * each); neither depends on it, so there is no cycle and each keeps its contract
 * (strategy still never runs a paper session on its own).
 *
 * Hard rules (enforced by code + tests): injected local data only — no network,
 * no RPC, no wallet, no filesystem, no `Date.now`, no `Math.random`. Nothing here
 * holds a key, or builds/signs/simulates/sends a transaction. Every number is
 * simulated bookkeeping from injected prices — NOT a live result, NOT real market
 * performance, NOT a profitability claim, and NOT financial advice.
 */

export const BACKTEST_PACKAGE_PHASE = 5 as const;

export { runBacktest, validateScenario, BacktestScenarioError } from "./backtest.js";

export {
  formatBacktestReport,
  BACKTEST_BANNER,
  BACKTEST_DISCLAIMERS,
} from "./report.js";

export type {
  BacktestScenario,
  BacktestStep,
  BacktestStepResult,
  BacktestReport,
} from "./types.js";
