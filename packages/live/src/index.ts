/**
 * @soulmaker/live — the Phantom-signing LIVE bridge (Sprint 107, Part 1 of 3).
 *
 * The single place where the system crosses from "paper / read-only / dry-run" toward a real,
 * human-confirmed Solana mainnet trade — and it does so WITHOUT ever holding a key. The backend
 * prepares a real UNSIGNED transaction and the human signs and sends it in their own Phantom
 * wallet. Live is disabled by default, micro-capped, manual-arm, and audited. This package
 * authorizes nothing on its own and makes no profitability claim.
 *
 *   policy.ts          — the default-BLOCKED live-mode policy + hard caps + gate verdict
 *   chain-adapter.ts   — the typed chain boundary (Solana mainnet live; others disabled stubs)
 *   canary-request.ts  — the Phantom-signable `live.canary.request.v1` (wraps a real unsigned tx)
 *   canary-state.ts    — the closed canary lifecycle state machine
 *   candidate-score.ts — the deterministic live-candidate decision
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
