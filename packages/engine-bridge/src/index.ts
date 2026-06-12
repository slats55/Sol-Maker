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
