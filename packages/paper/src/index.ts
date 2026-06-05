/**
 * @soulmaker/paper — Phase 4 deterministic, offline, **simulated-only** paper
 * trading engine.
 *
 * Pure domain logic: simulated orders/fills, positions, realized + unrealized
 * PnL, risk-cap + kill-switch checks, append-only journal event types, state
 * reducers and report generation. It consumes `@soulmaker/risk` advisory reports
 * purely as a candidate filter.
 *
 * Hard rules (enforced by code + tests): nothing here holds a secret key,
 * builds, signs, simulates, or sends a transaction; there is no signer, no
 * Keypair, no RPC, no network, and no DEX/execution SDK. Prices are injected and
 * PnL is simulated bookkeeping — never real market performance. A risk
 * `PASS_FOR_PAPER_EVALUATION` means "eligible for paper evaluation", not "safe",
 * "approved for live trading", "profitable", or "executable".
 */

export const PAPER_PACKAGE_PHASE = 4 as const;

export {
  initialState,
  applyBuyFill,
  applySellFill,
  cloneState,
  markUnrealized,
} from "./engine.js";
export type { SellResult } from "./engine.js";

export { checkBuyCaps, openPositionCount } from "./caps.js";
export type { CapDecision } from "./caps.js";

export { makeIdGen } from "./ids.js";
export type { IdGen } from "./ids.js";

export { runPaperSession, latestPrices, markFinalUnrealized } from "./run.js";
export type { PaperRunInput } from "./run.js";

export {
  serializeEvent,
  serializeEvents,
  parseJournal,
  reduceJournal,
  deriveStateFromJournalText,
  lastRunSummary,
} from "./journal.js";
export type { ParseJournalResult, JournalDerivation } from "./journal.js";

export {
  summarize,
  formatPaperReport,
  buildReportEnvelope,
  PAPER_ONLY_BANNER,
  PAPER_NOTES,
  PAPER_DISCLAIMER,
} from "./report.js";
export type { FormatReportOptions, PaperReportEnvelope } from "./report.js";

export type {
  PaperSide,
  PaperCandidate,
  PaperPricePoint,
  PaperOrder,
  PaperOrderStatus,
  PaperFill,
  PaperPosition,
  PaperRiskCaps,
  PaperJournalEvent,
  PaperJournalEventType,
  PaperState,
  PaperRunSummary,
  PaperRunResult,
} from "./types.js";
