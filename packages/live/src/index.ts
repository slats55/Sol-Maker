/**
 * @soulmaker/live — the Phantom-signing LIVE bridge (Sprint 107 Part 1 + Sprint 108 Part 2 of 3).
 *
 * The single place where the system crosses from "paper / read-only / dry-run" toward a real,
 * human-confirmed Solana mainnet trade — and it does so WITHOUT ever holding a key. The backend
 * prepares a real UNSIGNED transaction and the human signs and sends it in their own Phantom
 * wallet. Live is disabled by default, micro-capped, manual-arm, and audited. This package
 * authorizes nothing on its own and makes no profitability claim.
 *
 * Part 1 (the Phantom bridge):
 *   policy.ts          — the default-BLOCKED live-mode policy + hard caps + gate verdict
 *   chain-adapter.ts   — the typed chain boundary (Solana mainnet live; others disabled stubs)
 *   canary-request.ts  — the Phantom-signable `live.canary.request.v1` (wraps a real unsigned tx)
 *   canary-state.ts    — the closed canary lifecycle state machine
 *   candidate-score.ts — the deterministic live-candidate decision
 *
 * Part 2 (the armed sniper loop — recommends, never sends):
 *   discovery.ts       — real-time candidate normalization (`live.sniper.candidate.v1`)
 *   strategy.ts        — memecoin strategy scoring v2 (`live.strategy.score.v2`)
 *   escalation.ts      — the conservative canary escalation policy (caps/cooldown/auto-pause)
 *   sniper-loop.ts     — the operator-controlled loop mode machine + pure per-candidate pipeline
 *   paper-shadow.ts    — paper-shadow "would-have" simulation + session report
 *   quote-refresh.ts   — continuous quote refresh + provider redundancy (fail-closed on stale/missing)
 */

export {
  LIVE_POLICY_SCHEMA_VERSION,
  LIVE_POLICY_EVALUATION_SCHEMA_VERSION,
  LIVE_MODES,
  LIVE_SOLANA_MAINNET_CHAIN_ID,
  LIVE_WALLET_PROVIDERS,
  LIVE_HARD_CEILINGS,
  LIVE_POLICY_DEFAULTS,
  LIVE_POLICY_BLOCK_CODES,
  LivePolicyError,
  buildLivePolicy,
  validateLivePolicy,
  evaluateLivePolicy,
} from "./policy.js";
export type {
  LiveMode,
  LiveWalletProvider,
  LivePolicyCaps,
  LivePolicyLiquidity,
  LivePolicyFreshness,
  LiveModePolicy,
  LivePolicyBlockCode,
  LivePolicyEvaluation,
  BuildLivePolicyInput,
} from "./policy.js";

export {
  CHAIN_LIVE_STATUSES,
  SOLANA_MAINNET_ADAPTER,
  PLANNED_CHAIN_ADAPTERS,
  ALL_CHAIN_ADAPTERS,
  chainAdapterFor,
  isLiveCapableChain,
} from "./chain-adapter.js";
export type { ChainLiveStatus, ChainAdapterCapabilities, ChainAdapter } from "./chain-adapter.js";

export {
  CANARY_STATES,
  CANARY_TERMINAL_STATES,
  CANARY_EVENTS,
  isCanaryState,
  isCanaryTerminal,
  canaryTransition,
  canaryReplay,
} from "./canary-state.js";
export type { CanaryState, CanaryEvent, CanaryTransitionResult } from "./canary-state.js";

export {
  LIVE_CANARY_REQUEST_SCHEMA_VERSION,
  LIVE_CANARY_REQUEST_NETWORK,
  LIVE_CANARY_REQUEST_CHAIN,
  LIVE_CANARY_REQUEST_WALLET_PROVIDER,
  LIVE_CANARY_REQUEST_BANNER,
  LIVE_CANARY_REQUEST_STATES,
  LiveCanaryRequestError,
  policyToSafetyControls,
  buildLiveCanaryRequest,
  validateLiveCanaryRequest,
  redactCanaryRequestForOutput,
} from "./canary-request.js";
export type {
  LiveCanaryRequestState,
  LiveCanaryQuoteFacts,
  LiveCanaryRiskFacts,
  LiveCanaryPreflightFacts,
  LiveCanaryPolicySummary,
  LiveCanaryRequest,
  BuildLiveCanaryRequestInput,
} from "./canary-request.js";

export {
  LIVE_CANDIDATE_DECISION_SCHEMA_VERSION,
  LIVE_CANDIDATE_DECISIONS,
  LIVE_CANDIDATE_DEFAULT_THRESHOLDS,
  scoreLiveCandidate,
} from "./candidate-score.js";

export {
  LIVE_LATENCY_REPORT_SCHEMA_VERSION,
  LATENCY_ENGINES,
  summarizeStage,
  buildLiveLatencyReport,
} from "./perf.js";
export type {
  LatencyEngine,
  LatencyStageSamples,
  LatencyStageSummary,
  LiveLatencyReport,
  BuildLiveLatencyReportInput,
} from "./perf.js";
export type {
  LiveCandidateDecision,
  LiveCandidateRiskSignals,
  LiveCandidateSignals,
  LiveCandidateThresholds,
  LiveCandidateDecisionResult,
  ScoreLiveCandidateInput,
} from "./candidate-score.js";

// --- Part 2: the armed sniper loop -----------------------------------------------------------

export {
  LIVE_SNIPER_CANDIDATE_SCHEMA_VERSION,
  LIVE_SNIPER_CANDIDATE_CHAIN,
  DISCOVERY_SOURCE_KINDS,
  DISCOVERY_EVENTS,
  DiscoveryError,
  isValidMint,
  computeConfidence,
  normalizeObservation,
  normalizeManualMint,
  dedupeCandidates,
  discoverCandidates,
  validateSniperCandidate,
} from "./discovery.js";
export type {
  DiscoverySourceKind,
  DiscoveryEvent,
  SniperCandidateRisk,
  SniperCandidateProvenance,
  SniperCandidate,
  DiscoveryRejection,
  ObservationInput,
  ManualMintInput,
  DedupeResult,
  DiscoverInput,
  DiscoveryResult,
} from "./discovery.js";

export {
  LIVE_STRATEGY_SCORE_SCHEMA_VERSION,
  STRATEGY_DECISIONS,
  STRATEGY_RISK_APPETITES,
  STRATEGY_HARD_BLOCK_CODES,
  scoreStrategyV2,
} from "./strategy.js";
export type { StrategyDecision, StrategyRiskAppetite, StrategyQuoteFacts, StrategyScoreResult, ScoreStrategyInput } from "./strategy.js";

export {
  LIVE_ESCALATION_POLICY_SCHEMA_VERSION,
  LIVE_ESCALATION_HARD_CEILINGS,
  LIVE_ESCALATION_MIN_COOLDOWN_MS,
  LIVE_ESCALATION_DEFAULTS,
  LIVE_ESCALATION_BLOCK_CODES,
  LiveEscalationError,
  buildEscalationPolicy,
  validateEscalationPolicy,
  evaluateEscalation,
} from "./escalation.js";
export type {
  LiveEscalationPolicy,
  LiveEscalationBlockCode,
  BuildEscalationPolicyInput,
  EscalationSessionState,
  EscalationEvaluation,
  EvaluateEscalationInput,
} from "./escalation.js";

export {
  LIVE_SNIPER_LOOP_SCHEMA_VERSION,
  SNIPER_LOOP_MODES,
  SNIPER_LOOP_DEFAULT_MODE,
  SNIPER_LOOP_STAGES,
  SNIPER_LOOP_EVENTS,
  PIPELINE_ACTIONS,
  isSniperLoopMode,
  sniperLoopModeTransition,
  loopModeCanTrade,
  loopModeCanPrepareCanary,
  loopModeRunsPaperShadow,
  loopModeProcesses,
  evaluateCandidatePipeline,
} from "./sniper-loop.js";
export type {
  SniperLoopMode,
  SniperLoopStage,
  SniperLoopEvent,
  SniperLoopModeTransition,
  PipelineAction,
  CandidatePipelineResult,
  CandidatePipelineContext,
  CandidatePipelineInput,
} from "./sniper-loop.js";

export {
  LIVE_PAPER_SHADOW_DECISION_SCHEMA_VERSION,
  LIVE_PAPER_SHADOW_SESSION_SCHEMA_VERSION,
  PAPER_SHADOW_DECISIONS,
  PAPER_SHADOW_SESSION_CAVEATS,
  shadowDecide,
  buildPaperShadowSession,
} from "./paper-shadow.js";
export type {
  PaperShadowDecision,
  PaperShadowQuoteSnapshot,
  PaperShadowDecisionRecord,
  ShadowDecideInput,
  PaperShadowSessionReport,
} from "./paper-shadow.js";

export {
  LIVE_QUOTE_REFRESH_SCHEMA_VERSION,
  QUOTE_PROVIDER_ROLES,
  QUOTE_OBSERVATION_OUTCOMES,
  QUOTE_REFRESH_BLOCK_CODES,
  quoteAgeFresh,
  refreshQuotes,
} from "./quote-refresh.js";
export type {
  QuoteProviderRole,
  QuoteObservationOutcome,
  QuoteProviderObservation,
  QuoteRefreshBlockCode,
  SelectedQuote,
  QuoteRefreshResult,
  RefreshQuotesInput,
} from "./quote-refresh.js";

export {
  LIVE_CANARY_RECONCILIATION_SCHEMA_VERSION,
  CANARY_RECONCILIATION_STATUSES,
  CANARY_RECONCILIATION_VERDICTS,
  CanaryReconciliationError,
  buildCanaryReconciliation,
  validateCanaryReconciliation,
} from "./canary-reconcile.js";
export type {
  CanaryReconciliationStatus,
  CanaryReconciliationVerdict,
  CanaryReconciliationFacts,
  CanaryReconciliationRecord,
  BuildCanaryReconciliationInput,
} from "./canary-reconcile.js";

// --- Part 3: the production canary + supervised operator release ----------------------------
//   operator-config.ts   — strict fail-closed production/canary operator config validator
//   session-recorder.ts  — append-only JSONL operator session journal (durable pause/re-arm)
//   operator-reconcile.ts— post-canary accounting: balances, slippage evidence, honest PnL
//   operator-loop.ts     — the supervised recommend-only run unit for live:operator:run
//   alerts.ts            — local alert hooks (console/file), disabled by default
//   human-readiness.ts   — the truthful ready-for-human-canary report

export {
  LIVE_OPERATOR_CONFIG_SCHEMA_VERSION,
  LIVE_OPERATOR_CONFIG_VALIDATION_SCHEMA_VERSION,
  OPERATOR_RUN_MODES,
  OPERATOR_MODE_RANK,
  OPERATOR_QUOTE_TTL_BOUNDS,
  OPERATOR_MAX_COOLDOWN_MS,
  OPERATOR_CONFIG_BLOCK_CODES,
  LiveOperatorConfigError,
  assertNoSecretMaterial,
  buildOperatorConfig,
  validateOperatorConfig,
  evaluateOperatorConfig,
} from "./operator-config.js";
export type {
  OperatorRunMode,
  LiveOperatorConfig,
  OperatorConfigBlockCode,
  OperatorConfigValidation,
  BuildOperatorConfigInput,
} from "./operator-config.js";

export {
  LIVE_OPERATOR_SESSION_EVENT_SCHEMA_VERSION,
  LIVE_OPERATOR_SESSION_SUMMARY_SCHEMA_VERSION,
  LIVE_OPERATOR_SESSION_EXPORT_SCHEMA_VERSION,
  OPERATOR_SESSION_EVENT_KINDS,
  OPERATOR_PAUSE_TRIGGER_KINDS,
  OperatorSessionError,
  buildSessionEvent,
  validateSessionEvent,
  parseSessionLog,
  prepareSessionAppend,
  summarizeSessionLog,
  exportSessionLog,
  deriveEscalationSession,
  signatureRef,
} from "./session-recorder.js";
export type {
  OperatorSessionEventKind,
  OperatorSessionEvent,
  BuildSessionEventInput,
  SessionLogLine,
  PreparedAppend,
  OperatorSessionSummary,
  OperatorSessionExport,
  DerivedEscalationSession,
  SignatureRef,
} from "./session-recorder.js";

export {
  LIVE_OPERATOR_RECONCILIATION_SCHEMA_VERSION,
  RECONCILIATION_CONFIDENCE_LEVELS,
  PNL_STATUSES,
  OperatorReconcileError,
  buildOperatorReconciliation,
  validateOperatorReconciliation,
} from "./operator-reconcile.js";
export type {
  ReconciliationConfidence,
  PnlStatus,
  OperatorBalanceSnapshot,
  OperatorReconcileInput,
  OperatorReconciliationRecord,
} from "./operator-reconcile.js";

export {
  LIVE_OPERATOR_RUN_REPORT_SCHEMA_VERSION,
  OperatorLoopError,
  runSupervisedOperatorLoop,
  validateOperatorRunReport,
} from "./operator-loop.js";
export type {
  OperatorLoopCandidate,
  OperatorLoopSessionEvent,
  OperatorLoopLimits,
  OperatorLoopInput,
  OperatorRunReport,
} from "./operator-loop.js";

export {
  LIVE_OPERATOR_ALERT_SCHEMA_VERSION,
  OPERATOR_ALERT_KINDS,
  OPERATOR_ALERT_SINKS_DEFAULT,
  OperatorAlertError,
  buildOperatorAlert,
  formatConsoleAlert,
  formatWebhookFileLine,
  validateOperatorAlert,
} from "./alerts.js";
export type { OperatorAlertKind, OperatorAlert, OperatorAlertSinks, BuildAlertInput } from "./alerts.js";

export {
  LIVE_HUMAN_CANARY_READINESS_SCHEMA_VERSION,
  HUMAN_CANARY_READINESS_VERDICTS,
  HumanReadinessError,
  buildHumanCanaryReadiness,
  validateHumanCanaryReadiness,
} from "./human-readiness.js";
export type {
  HumanCanaryReadinessVerdict,
  HumanCanaryWorkflowChecks,
  HumanCanaryReadinessReport,
  BuildHumanReadinessInput,
} from "./human-readiness.js";
