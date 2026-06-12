/**
 * @soulmaker/execution — the GATED execution boundary (Sprint 92).
 *
 * Execution-mode resolution, the fourteen-condition mainnet live gate (default BLOCKED, no
 * override), enforced operator safety controls, the signer boundary (devnet-first; mainnet only
 * behind the armed gate; secrets never logged or serialized), and the refusal-first send path.
 * Live trading is DISABLED BY DEFAULT and impossible to trigger accidentally — proven by tests.
 */

export {
  LIVE_TRADING_ENV_FLAG,
  LIVE_TRADING_ENV_VALUE,
  evaluateMainnetLiveGate,
} from "./live-gate.js";
export type {
  MainnetLiveGateInput,
  MainnetLiveGateCheck,
  MainnetLiveGateResult,
} from "./live-gate.js";

export {
  EXECUTION_MODES,
  DEVNET_EXECUTION_ENV_FLAG,
  DEVNET_EXECUTION_ENV_VALUE,
  resolveExecutionMode,
} from "./modes.js";
export type { ExecutionMode, ResolveExecutionModeInput, ResolvedExecutionMode } from "./modes.js";

export { SAFETY_VIOLATION_CODES, evaluateSafetyControls } from "./safety-controls.js";
export type {
  SafetyViolationCode,
  SafetyViolation,
  OperatorSafetyControls,
  TradeContext,
  SessionState,
  SafetyEvaluation,
} from "./safety-controls.js";

export {
  loadLocalSignerBoundary,
  createThrowawayDevnetSigner,
  SignerBoundaryError,
  SIGNER_REDACTION_MARKER,
} from "./signer.js";
export type {
  TransactionSigningBoundary,
  LoadLocalSignerInput,
  CreateThrowawayDevnetSignerInput,
  ThrowawayDevnetSigner,
} from "./signer.js";

export {
  EXECUTION_ATTEMPT_REPORT_SCHEMA_VERSION,
  EXECUTION_REFUSAL_CODES,
  attemptExecution,
  createSendRpc,
} from "./send.js";
export type {
  ExecutionRefusalCode,
  SendRpcLike,
  SendRpc,
  ExecutionAttemptInput,
  ExecutionAttemptReport,
} from "./send.js";

export {
  DEVNET_REHEARSAL_REPORT_SCHEMA_VERSION,
  DEVNET_REHEARSAL_BANNER,
  DEVNET_REHEARSAL_DEFAULT_AIRDROP_LAMPORTS,
  DEVNET_REHEARSAL_MIN_BALANCE_LAMPORTS,
  DEVNET_REHEARSAL_OUTCOMES,
  createRehearsalRpc,
  runDevnetRehearsal,
} from "./rehearsal.js";
export type {
  DevnetRehearsalOutcome,
  RehearsalStepId,
  RehearsalStepStatus,
  RehearsalStep,
  RehearsalFaucetRpcLike,
  RehearsalRpc,
  DevnetRehearsalReport,
  RunDevnetRehearsalInput,
} from "./rehearsal.js";
