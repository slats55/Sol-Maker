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
  loadThrowawayDevnetSigner,
  SignerBoundaryError,
  SIGNER_REDACTION_MARKER,
} from "./signer.js";
export type {
  TransactionSigningBoundary,
  LoadLocalSignerInput,
  CreateThrowawayDevnetSignerInput,
  LoadThrowawayDevnetSignerInput,
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
  EXECUTION_RECONCILIATION_REPORT_SCHEMA_VERSION,
  RECONCILIATION_BANNER,
  RECONCILIATION_VERDICTS,
  RECONCILIATION_CONTINUATION_SAFE_VERDICTS,
  RECONCILIATION_DEFAULT_MAX_FEE_LAMPORTS,
  CONFIRMATION_OUTCOMES,
  CONFIRMATION_GUIDANCE,
  CONFIRMATION_DEFAULT_MAX_POLLS,
  CONFIRMATION_HARD_MAX_POLLS,
  EXPECTED_EFFECT_KINDS,
  createReconciliationRpc,
  readBalanceSnapshot,
  computeBalanceDelta,
  trackConfirmation,
  buildReconciliationReport,
} from "./reconciliation.js";
export type {
  ReconciliationVerdict,
  ReconciliationRpcLike,
  ReconciliationRpc,
  BalanceFactStatus,
  TokenBalanceFactStatus,
  SolBalanceFact,
  TokenBalanceFact,
  BalanceSnapshot,
  ReadBalanceSnapshotInput,
  BalanceDelta,
  ConfirmationOutcome,
  ConfirmationTrackResult,
  TrackConfirmationInput,
  ExpectedEffectKind,
  ExpectedEffect,
  ReconciliationFeeFacts,
  ReconciliationReport,
  BuildReconciliationReportInput,
} from "./reconciliation.js";

export {
  SESSION_LEDGER_ENTRY_SCHEMA_VERSION,
  SESSION_LEDGER_FILE_NAME,
  SESSION_LEDGER_ENTRY_KINDS,
  SESSION_CONTINUATION_STATUSES,
  SESSION_CONTINUATION_ALLOWED_STATUSES,
  createSessionLedgerEntry,
  deriveSessionId,
  parseSessionLedger,
  evaluateSessionContinuation,
} from "./session.js";
export type {
  SessionLedgerEntryKind,
  SessionLedgerEntry,
  CreateSessionLedgerEntryInput,
  ParsedSessionLedger,
  SessionContinuationStatus,
  SessionContinuationDecision,
  EvaluateSessionContinuationInput,
} from "./session.js";

export {
  PHASE7_AUTHORIZATION_AUDIT_SCHEMA_VERSION,
  PHASE7_AUTHORIZATION_AUDIT_BANNER,
  PHASE7_AUTHORIZATION_AUDIT_MODE,
  PHASE7_AUTHORIZATION_AUDIT_DISCLAIMERS,
  PHASE7_AUTHORIZATION_AUDIT_VERDICTS,
  PHASE7_AUDIT_CHECK_STATUSES,
  PHASE7_AUDIT_SURFACE_STATUSES,
  Phase7AuthorizationAuditError,
  buildPhase7AuthorizationAudit,
  validatePhase7AuthorizationAudit,
  derivePhase7AuthorizationVerdict,
  canonicalLiveGateIds,
} from "./phase7-authorization-audit.js";
export type {
  Phase7AuthorizationAuditVerdict,
  Phase7AuditCheckStatus,
  Phase7AuditSurfaceStatus,
  Phase7AuditGate,
  Phase7AuditInvariant,
  Phase7AuditCommandSurface,
  Phase7AuditPrerequisite,
  Phase7VerdictEvidence,
  BuildPhase7AuthorizationAuditInput,
  Phase7AuthorizationAudit,
} from "./phase7-authorization-audit.js";

export {
  DEVNET_REHEARSAL_REPORT_SCHEMA_VERSION,
  DEVNET_REHEARSAL_BANNER,
  DEVNET_REHEARSAL_DEFAULT_AIRDROP_LAMPORTS,
  DEVNET_REHEARSAL_MIN_BALANCE_LAMPORTS,
  DEVNET_REHEARSAL_OUTCOMES,
  DEVNET_REHEARSAL_MAX_AIRDROP_ATTEMPTS,
  DEVNET_REHEARSAL_DEFAULT_AIRDROP_ATTEMPTS,
  createRehearsalRpc,
  runDevnetRehearsal,
} from "./rehearsal.js";
export type {
  DevnetRehearsalOutcome,
  RehearsalSignerSource,
  RehearsalStepId,
  RehearsalStepStatus,
  RehearsalStep,
  RehearsalFaucetRpcLike,
  RehearsalRpc,
  DevnetRehearsalReport,
  RunDevnetRehearsalInput,
} from "./rehearsal.js";

export {
  DEVNET_FUNDING_STATUS_SCHEMA_VERSION,
  DEVNET_FUNDING_STATUS_BANNER,
  LAMPORTS_PER_SOL,
  DEVNET_FUNDING_DEFAULT_MIN_LAMPORTS,
  DEVNET_FUNDING_SOURCE_STATUSES,
  DEVNET_BALANCE_READ_STATUSES,
  DEVNET_FAUCET_ATTEMPT_OUTCOMES,
  DevnetFundingStatusError,
  buildDevnetFundingStatus,
  validateDevnetFundingStatus,
  deriveDevnetFundingSourceStatus,
} from "./devnet-funding-status.js";
export type {
  DevnetFundingSourceStatus,
  DevnetBalanceReadStatus,
  DevnetFaucetAttemptOutcome,
  DevnetFaucetAttemptSummary,
  DevnetBalanceObservation,
  BuildDevnetFundingStatusInput,
  DevnetFundingStatusReport,
} from "./devnet-funding-status.js";

export {
  PHASE7_HUMAN_SIGNOFF_SCHEMA_VERSION,
  PHASE7_HUMAN_SIGNOFF_BANNER,
  PHASE7_HUMAN_SIGNOFF_DISCLAIMERS,
  PHASE7_MICROTRADE_MAX_SPEND_LAMPORTS,
  PHASE7_SIGNOFF_STATUSES,
  PHASE7_SIGNOFF_SCOPES,
  PHASE7_SIGNOFF_TARGET_SCOPES,
  Phase7HumanSignoffError,
  buildPhase7HumanSignoff,
  validatePhase7HumanSignoff,
  derivePhase7SignoffStatus,
  grantedScopeFor,
  requiredAcknowledgementsFor,
} from "./phase7-human-signoff.js";
export type {
  Phase7SignoffStatus,
  Phase7SignoffScope,
  Phase7SignoffTargetScope,
  Phase7SignoffAcknowledgement,
  Phase7SignoffEvidence,
  BuildPhase7HumanSignoffInput,
  Phase7HumanSignoffRecord,
} from "./phase7-human-signoff.js";

export {
  PHASE7_MICROTRADE_PREFLIGHT_SCHEMA_VERSION,
  PHASE7_MICROTRADE_PREFLIGHT_BANNER,
  PHASE7_MICROTRADE_PREFLIGHT_MODE,
  PHASE7_MICROTRADE_PREFLIGHT_NETWORK,
  PHASE7_MICROTRADE_PREFLIGHT_MAX_SPEND_LAMPORTS,
  PHASE7_MICROTRADE_PREFLIGHT_DISCLAIMERS,
  PHASE7_MICROTRADE_PREFLIGHT_VERDICTS,
  PHASE7_PREFLIGHT_AUDIT_STATUSES,
  PHASE7_PREFLIGHT_SIGNOFF_STATUSES,
  PHASE7_PREFLIGHT_DEVNET_STATUSES,
  PHASE7_PREFLIGHT_RC_STATUSES,
  PHASE7_PREFLIGHT_BURNER_STATUSES,
  PHASE7_PREFLIGHT_MANUAL_CONFIRMATION_STATUSES,
  PHASE7_PREFLIGHT_QUOTE_STATUSES,
  PHASE7_PREFLIGHT_RISK_STATUSES,
  PHASE7_PREFLIGHT_TOKEN2022_STATUSES,
  PHASE7_PREFLIGHT_SIMULATION_STATUSES,
  PHASE7_PREFLIGHT_KILL_SWITCH_REQUIREMENT,
  PHASE7_PREFLIGHT_RECONCILIATION_REQUIREMENT,
  Phase7MicrotradePreflightError,
  buildPhase7MicrotradePreflight,
  validatePhase7MicrotradePreflight,
  derivePhase7MicrotradePreflightVerdict,
  parseBurnerPublicKey,
} from "./phase7-microtrade-preflight.js";
export type {
  Phase7MicrotradePreflightVerdict,
  Phase7PreflightAuditStatus,
  Phase7PreflightSignoffStatus,
  Phase7PreflightDevnetStatus,
  Phase7PreflightRcStatus,
  Phase7PreflightBurnerStatus,
  Phase7PreflightManualConfirmationStatus,
  Phase7PreflightQuoteStatus,
  Phase7PreflightRiskStatus,
  Phase7PreflightToken2022Status,
  Phase7PreflightSimulationStatus,
  Phase7PreflightVerdictEvidence,
  BuildPhase7MicrotradePreflightInput,
  Phase7MicrotradePreflight,
} from "./phase7-microtrade-preflight.js";
