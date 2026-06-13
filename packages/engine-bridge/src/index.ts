/**
 * @soulmaker/engine-bridge — the TypeScript ↔ Rust sidecar IPC boundary
 * (Sprint 97 foundation). TypeScript is the orchestrator and the validation
 * authority; the Rust engine describes itself and nothing more. See
 * crates/solmaker-engine/SAFETY.md for the safety boundary this package
 * co-enforces.
 */

export {
  ENGINE_STATUS_SCHEMA_VERSION,
  ENGINE_IPC_VERSION,
  ENGINE_SUPPORTED_CAPABILITY_ALLOWLIST,
  ENGINE_REQUIRED_DISABLED_CAPABILITIES,
  validateEngineStatusReportV1,
  type EngineStatusReportV1,
  type EngineStatusValidation,
} from "./validate.js";
export { checkEngineArgs, buildChildEnv } from "./guard.js";
export { locateEngineInvocation, type EngineInvocation, type EngineInvocationVia } from "./locate.js";
export {
  createEngineProcessRunner,
  type EngineProcessRunner,
  type EngineProcessResult,
  type EngineProcessOptions,
} from "./runner.js";
export {
  fetchEngineStatus,
  type FetchEngineStatusOptions,
  type EngineStatusBridgeResult,
  type EngineIpcTiming,
  type EngineUnavailableReason,
  type EngineRefusedReason,
} from "./status.js";
export {
  ENGINE_REALTIME_OBSERVATIONS_SCHEMA_VERSION,
  ENGINE_REALTIME_MAX_EVENTS,
  validateEngineRealtimeObservationsReportV1,
  type EngineRealtimeObservationsReportV1,
  type EngineRealtimeValidation,
} from "./validate-realtime.js";
export {
  normalizeReplayThroughEngine,
  type NormalizeReplayThroughEngineOptions,
  type EngineRealtimeBridgeResult,
  type EngineRealtimeRefusedReason,
} from "./realtime.js";
export {
  ENGINE_QUOTE_SCORE_SCHEMA_VERSION,
  ENGINE_QUOTE_SCORE_MAX_ENTRIES,
  ENGINE_QUOTE_SCORE_REASON_CODES,
  validateEngineQuoteScoreReportV1,
  type EngineQuoteScoreReportV1,
  type EngineQuoteScoreEntry,
  type EngineQuoteScoreValidation,
} from "./validate-quote-score.js";
export {
  scoreQuotesThroughEngine,
  type ScoreQuotesThroughEngineOptions,
  type EngineQuoteScoreBridgeResult,
} from "./quote-score.js";
