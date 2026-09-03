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
 *   operator-approval.ts — the time-boxed, confirm-phrase human approval (`live.operator.approval.v1`)
 *   position.ts        — paper position ledger + exit rules (stop-loss/take-profit/trailing/time/emergency)
 *   ai-ranker.ts       — advisory AI ranking with a deterministic clamp (AI can reorder, never unblock)
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
  LIVE_OPERATOR_APPROVAL_SCHEMA_VERSION,
  LIVE_OPERATOR_APPROVAL_EVALUATION_SCHEMA_VERSION,
  OPERATOR_APPROVAL_CONFIRM_PHRASE,
  OPERATOR_APPROVAL_MAX_TTL_MINUTES,
  OPERATOR_APPROVAL_DEFAULT_TTL_MINUTES,
  OPERATOR_APPROVAL_MAX_FUTURE_SKEW_MS,
  OPERATOR_APPROVAL_SCOPE,
  OPERATOR_APPROVAL_EVALUATION_REASONS,
  LiveOperatorApprovalError,
  buildOperatorApproval,
  validateOperatorApproval,
  evaluateOperatorApproval,
} from "./operator-approval.js";
export type {
  LiveOperatorApproval,
  OperatorApprovalEvaluation,
  OperatorApprovalEvaluationReason,
  BuildOperatorApprovalInput,
} from "./operator-approval.js";

export {
  LIVE_POSITION_SCHEMA_VERSION,
  LIVE_POSITION_LEDGER_SCHEMA_VERSION,
  LIVE_EXIT_POLICY_SCHEMA_VERSION,
  LIVE_EXIT_DECISION_SCHEMA_VERSION,
  LAMPORTS_PER_SOL,
  POSITION_KINDS,
  POSITION_STATUSES,
  EXIT_REASONS,
  CLOSE_KINDS,
  EXIT_POLICY_BOUNDS,
  EXIT_POLICY_DEFAULTS,
  POSITION_SPEND_CEILING_LAMPORTS,
  LivePositionError,
  buildExitPolicy,
  validateExitPolicy,
  openPosition,
  applyMark,
  evaluateExitRules,
  closePosition,
  buildLedger,
  ledgerOpen,
  ledgerReplace,
  validateLedger,
} from "./position.js";
export type {
  PositionKind,
  PositionStatus,
  ExitReason,
  CloseKind,
  LiveExitPolicy,
  PositionMark,
  PositionClose,
  LivePosition,
  ExitDecision,
  OpenPositionInput,
  EvaluateExitInput,
  ClosePositionInput,
  PositionLedger,
  BuildExitPolicyInput,
} from "./position.js";

export {
  LIVE_AI_RANKING_SCHEMA_VERSION,
  AI_RANKER_PROMPT_VERSION,
  AI_RANKING_ENGINES,
  AiRankerError,
  canonicalJson,
  computeInputsHash,
  buildRankingFacts,
  rankDeterministic,
  validateAiProviderRanking,
  clampRanking,
  validateAiRanking,
  buildRankerPrompt,
} from "./ai-ranker.js";
export type {
  AiRankingEngine,
  AiRankingEntry,
  AiRankingExclusion,
  LiveAiRanking,
  RankableCandidate,
  RankingFacts,
  AiProviderRanking,
  ClampInput,
} from "./ai-ranker.js";

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

// --- Sprint 109: continuous paper daemon + performance + profiles + sell side -----------------

export {
  LIVE_STRATEGY_PROFILE_SCHEMA_VERSION,
  BUILTIN_PROFILE_NAMES,
  PROFILE_MAX_OPEN_POSITIONS_CEILING,
  PROFILE_QUOTE_TTL_BOUNDS,
  STRATEGY_PROFILES,
  StrategyProfileError,
  validateStrategyProfile,
  getBuiltinProfile,
  profileExitPolicy,
  requireLiveEligibleProfile,
} from "./profiles.js";
export type { BuiltinProfileName, StrategyProfile } from "./profiles.js";

export {
  LIVE_SNIPER_DAEMON_STATE_SCHEMA_VERSION,
  LIVE_SNIPER_DAEMON_SUMMARY_SCHEMA_VERSION,
  DAEMON_MODES,
  DAEMON_RISK_CACHE_TTL_MS,
  DAEMON_BACKOFF_BASE_MS,
  DAEMON_BACKOFF_MAX_MS,
  DAEMON_SUMMARY_CAVEATS,
  DaemonStateError,
  emptyDaemonTotals,
  createDaemonState,
  dedupeAcrossLoops,
  riskCacheGet,
  riskCachePut,
  recordProviderOutcome,
  providerAllowed,
  recordNoTradeReasons,
  bumpTotals,
  completeLoop,
  validateDaemonState,
  buildDaemonSummary,
} from "./daemon.js";
export type {
  DaemonMode,
  DaemonRiskCacheEntry,
  DaemonProviderHealth,
  DaemonTotals,
  DaemonState,
  DaemonSummary,
  DedupeAcrossLoopsResult,
  ProviderOutcomeStatus,
} from "./daemon.js";

export {
  LIVE_PAPER_PERFORMANCE_SCHEMA_VERSION,
  EDGE_MIN_SAMPLE,
  EDGE_VERDICTS,
  buildPaperPerformanceReport,
  formatPaperPerformanceMarkdown,
} from "./performance.js";
export type { EdgeVerdict, TradeStat, PaperPerformanceReport, BuildPerformanceInput } from "./performance.js";

export {
  LIVE_SELL_REQUEST_SCHEMA_VERSION,
  LIVE_POSITION_RECONCILIATION_SCHEMA_VERSION,
  LIVE_SELL_REQUEST_BANNER,
  LIVE_SELL_REQUEST_STATES,
  SELL_REQUEST_BLOCK_CODES,
  POSITION_RECONCILIATION_VERDICTS,
  LiveSellRequestError,
  buildLiveSellRequest,
  validateLiveSellRequest,
  reconcilePosition,
} from "./sell-request.js";
export type {
  LiveSellRequestState,
  SellRequestBlockCode,
  LiveSellRequest,
  BuildLiveSellRequestInput,
  PositionReconciliationVerdict,
  PositionReconciliationRecord,
  ReconcilePositionInput,
} from "./sell-request.js";

export { MAINNET_EXECUTION_OUTCOMES, MAINNET_EXECUTION_REPORT_SCHEMA_VERSION, MAX_SIMULATION_AGE_MS, executeMainnetBuy, executeMainnetSell } from "./mainnet-execute.js";
export type { BalanceSnapshot, MainnetBuyInput, MainnetCaps, MainnetExecutionOutcome, MainnetExecutionReport, MainnetRpcSeams, MainnetSellInput } from "./mainnet-execute.js";
