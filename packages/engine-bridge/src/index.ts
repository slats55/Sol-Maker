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
export {
  ENGINE_TX_INSPECT_SCHEMA_VERSION,
  validateEngineTxInspectReportV1,
  type EngineTxInspectReportV1,
  type EngineTxInspectShape,
  type EngineTxInspectValidation,
} from "./validate-tx-inspect.js";
export {
  inspectTxThroughEngine,
  type InspectTxThroughEngineOptions,
  type EngineTxInspectBridgeResult,
} from "./tx-inspect.js";
export {
  ENGINE_SIM_CLASSIFICATION_SCHEMA_VERSION,
  validateEngineSimClassificationReportV1,
  type EngineSimClassificationReportV1,
  type EngineSimResultInput,
  type EngineSimClassificationValidation,
} from "./validate-sim-classify.js";
export {
  classifySimThroughEngine,
  type ClassifySimThroughEngineOptions,
  type EngineSimClassifyBridgeResult,
} from "./sim-classify.js";
export {
  ENGINE_SNIPER_SCORE_SCHEMA_VERSION,
  ENGINE_SNIPER_SCORE_INPUT_SCHEMA_VERSION,
  ENGINE_SNIPER_SCORE_MAX_CANDIDATES,
  ENGINE_SNIPER_SCORE_VERDICTS,
  ENGINE_SNIPER_SCORE_REASON_CODES,
  validateEngineSniperScoreReportV1,
  type EngineSniperScoreReportV1,
  type EngineSniperScoreCandidate,
  type EngineSniperScoreComponents,
  type EngineSniperScoreVerdict,
  type EngineSniperScoreValidation,
  type SniperScoreInputCrossCheck,
} from "./validate-sniper-score.js";
export {
  scoreCandidatesThroughEngine,
  type ScoreCandidatesThroughEngineOptions,
  type EngineSniperScoreBridgeResult,
} from "./sniper-score.js";
