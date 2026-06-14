/**
 * @soulmaker/sniper — PAPER-only, offline sniper decision support (Phase 5+).
 *
 * This package builds the safe, deterministic layers a Solana sniper bot needs BEFORE any live
 * capability exists: candidate intake (this sprint), and later a read-only token preflight summary
 * and paper-only sniper decisions. It is **pure and offline**:
 *
 *  - It NEVER builds, signs, simulates, or sends a transaction.
 *  - It holds no secret key, signer, or keypair — there is no such type here.
 *  - It makes no network / RPC call and reads no files (the CLI owns all I/O).
 *  - A candidate "decision" is a PAPER/simulated decision only — never a live trade or order.
 */

export const SNIPER_PACKAGE_PHASE = 5 as const;

export {
  parseMintAddress,
  isValidMintAddress,
  InvalidMintAddressError,
  MAX_MINT_BASE58_LEN,
  MIN_MINT_BASE58_LEN,
} from "./mint-address.js";

export {
  normalizeSniperCandidateList,
  validateSniperCandidateList,
  formatSniperCandidateList,
  SniperCandidateListError,
  SNIPER_CANDIDATE_LIST_SCHEMA_VERSION,
  SNIPER_CANDIDATE_LIST_BANNER,
  SNIPER_CANDIDATE_LIST_DISCLAIMERS,
} from "./candidate-list.js";

export type {
  SniperCandidateInput,
  NormalizeSniperCandidateListInput,
  SniperCandidate,
  SniperCandidateList,
  FormatSniperCandidateListOptions,
} from "./candidate-list.js";

export {
  buildSniperTokenPreflightReport,
  validateSniperTokenPreflightReport,
  formatSniperTokenPreflightReport,
  projectSniperPreflightRisk,
  projectSniperPreflightInspection,
  SniperTokenPreflightReportError,
  SNIPER_TOKEN_PREFLIGHT_REPORT_SCHEMA_VERSION,
  SNIPER_TOKEN_PREFLIGHT_REPORT_BANNER,
  SNIPER_TOKEN_PREFLIGHT_REPORT_DISCLAIMERS,
} from "./token-preflight.js";

export {
  normalizeSniperScoreInput,
  validateSniperScoreInput,
  SniperScoreInputError,
  SNIPER_SCORE_INPUT_SCHEMA_VERSION,
  SNIPER_SCORE_INPUT_BANNER,
  SNIPER_SCORE_INPUT_DISCLAIMERS,
  SNIPER_SCORE_INPUT_MAX_CANDIDATES,
  SNIPER_SCORE_MODES,
  SNIPER_SCORE_FACT_KEYS,
} from "./sniper-score-input.js";

export type {
  SniperScoreMode,
  SniperScoreLiquidityHint,
  SniperScoreQuoteFreshness,
  SniperScoreSimulationOutcome,
  SniperScoreSimulationClassification,
  SniperScoreFacts,
  SniperScoreInputEntryInput,
  NormalizeSniperScoreInputInput,
  SniperScoreInputEntry,
  SniperScoreInput,
} from "./sniper-score-input.js";

export type {
  SniperPreflightCandidateData,
  BuildSniperTokenPreflightReportInput,
  SniperPreflightStatus,
  SniperPreflightInspection,
  SniperPreflightRisk,
  SniperPreflightEntry,
  SniperTokenPreflightReport,
  FormatSniperTokenPreflightReportOptions,
} from "./token-preflight.js";

export {
  normalizeSniperPreflightInput,
  validateSniperPreflightInput,
  formatSniperPreflightInput,
  SniperPreflightInputError,
  SNIPER_PREFLIGHT_INPUT_SCHEMA_VERSION,
  SNIPER_PREFLIGHT_INPUT_BANNER,
  SNIPER_PREFLIGHT_INPUT_DISCLAIMERS,
} from "./preflight-input.js";

export type {
  SniperPreflightInputEntryInput,
  NormalizeSniperPreflightInputInput,
  SniperPreflightInputEntry,
  SniperPreflightInput,
  FormatSniperPreflightInputOptions,
} from "./preflight-input.js";

export {
  buildPaperSniperDecisionReport,
  validatePaperSniperDecisionReport,
  formatPaperSniperDecisionReport,
  PaperSniperDecisionReportError,
  SNIPER_PAPER_DECISION_REPORT_SCHEMA_VERSION,
  SNIPER_PAPER_DECISION_REPORT_BANNER,
  SNIPER_PAPER_DECISION_REPORT_DISCLAIMERS,
} from "./paper-decision.js";

export type {
  SniperDecisionRules,
  ResolvedSniperDecisionRules,
  BuildPaperSniperDecisionReportInput,
  SniperDecision,
  SniperDecisionEntry,
  SniperPaperDecisionReport,
  FormatPaperSniperDecisionReportOptions,
} from "./paper-decision.js";

export {
  SNIPER_DECISION_REASON_CODES,
  SNIPER_DECISION_REASON_CATEGORIES,
  SNIPER_DECISION_REASON_CODE_DEFINITIONS,
  isSniperDecisionReasonCode,
  sniperDecisionReasonCodeDefinition,
  dedupeSniperDecisionReasonCodes,
} from "./decision-reason-codes.js";

export type {
  SniperDecisionReasonCode,
  SniperDecisionReasonCategory,
  SniperDecisionReasonCodeDefinition,
} from "./decision-reason-codes.js";

export {
  buildPaperSniperDecisionReportV2,
  validatePaperSniperDecisionReportV2,
  formatPaperSniperDecisionReportV2,
  upgradePaperSniperDecisionReportV1ToV2,
  PaperSniperDecisionReportV2Error,
  SNIPER_PAPER_DECISION_REPORT_V2_SCHEMA_VERSION,
  SNIPER_PAPER_DECISION_REPORT_V2_BANNER,
  SNIPER_PAPER_DECISION_REPORT_V2_DISCLAIMERS,
} from "./paper-decision-v2.js";

export type {
  SniperDecisionEntryV2,
  SniperPaperDecisionReportV2,
  BuildPaperSniperDecisionReportV2Input,
  FormatPaperSniperDecisionReportV2Options,
} from "./paper-decision-v2.js";

export {
  buildSniperWorkflowPlan,
  validateSniperWorkflowPlan,
  formatSniperWorkflowPlan,
  SniperWorkflowPlanError,
  SNIPER_WORKFLOW_PLAN_SCHEMA_VERSION,
  SNIPER_WORKFLOW_PLAN_BANNER,
  SNIPER_WORKFLOW_PLAN_DISCLAIMERS,
} from "./workflow.js";

export type {
  SniperWorkflowStageName,
  SniperWorkflowStageState,
  BuildSniperWorkflowPlanInput,
  SniperWorkflowStageStatus,
  SniperWorkflowStage,
  SniperWorkflowPlan,
  FormatSniperWorkflowPlanOptions,
} from "./workflow.js";

export {
  buildSniperRunReport,
  validateSniperRunReport,
  formatSniperRunReport,
  SniperRunReportError,
  SNIPER_RUN_REPORT_SCHEMA_VERSION,
  SNIPER_RUN_REPORT_BANNER,
  SNIPER_RUN_REPORT_DISCLAIMERS,
} from "./run-report.js";

export type {
  BuildSniperRunReportInput,
  SniperRunCandidateEntry,
  SniperRunPreflightSummary,
  SniperRunDecisionSummary,
  SniperRunWorkflowSummary,
  SniperRunArtifactsPresent,
  SniperRunNavigationEntry,
  SniperRunReport,
  FormatSniperRunReportOptions,
} from "./run-report.js";

export {
  diffSniperRunReports,
  validateSniperRunReportDiff,
  formatSniperRunReportDiff,
  SniperRunReportDiffError,
  SNIPER_RUN_REPORT_DIFF_SCHEMA_VERSION,
  SNIPER_RUN_REPORT_DIFF_BANNER,
  SNIPER_RUN_REPORT_DIFF_DISCLAIMERS,
} from "./run-report-diff.js";

export type {
  SniperRunDecisionChange,
  SniperRunPreflightStatusChange,
  SniperRunReportDiffDeltas,
  SniperRunReportDiffSide,
  SniperRunReportDiff,
  FormatSniperRunReportDiffOptions,
} from "./run-report-diff.js";

export {
  buildSniperRunReportV2,
  validateSniperRunReportV2,
  formatSniperRunReportV2,
  upgradeSniperRunReportV1ToV2,
  SniperRunReportV2Error,
  SNIPER_RUN_REPORT_V2_SCHEMA_VERSION,
  SNIPER_RUN_REPORT_V2_BANNER,
  SNIPER_RUN_REPORT_V2_DISCLAIMERS,
} from "./run-report-v2.js";

export type {
  SniperRunCandidateEntryV2,
  SniperRunReasonCodeRollup,
  SniperRunPolicySummary,
  SniperRunPreflightInputCoverage,
  SniperRunReportV2,
  BuildSniperRunReportV2Input,
  FormatSniperRunReportV2Options,
} from "./run-report-v2.js";

export {
  diffSniperRunReportsV2,
  validateSniperRunReportDiffV2,
  formatSniperRunReportDiffV2,
  SniperRunReportDiffV2Error,
  SNIPER_RUN_REPORT_DIFF_V2_SCHEMA_VERSION,
  SNIPER_RUN_REPORT_DIFF_V2_BANNER,
  SNIPER_RUN_REPORT_DIFF_V2_DISCLAIMERS,
  SNIPER_RUN_POLICY_SUMMARY_FIELDS,
  SNIPER_RUN_PREFLIGHT_COVERAGE_FIELDS,
} from "./run-report-v2-diff.js";

export type {
  SniperRunReportDiffV2Side,
  SniperRunCandidateCodeChange,
  SniperRunReportDiffV2,
  FormatSniperRunReportDiffV2Options,
} from "./run-report-v2-diff.js";

export {
  normalizeSniperPolicyConfig,
  validateSniperPolicyConfig,
  formatSniperPolicyConfig,
  deriveSniperDecisionRules,
  enforceSniperPolicy,
  SniperPolicyConfigError,
  SNIPER_POLICY_CONFIG_SCHEMA_VERSION,
  SNIPER_POLICY_CONFIG_BANNER,
  SNIPER_POLICY_CONFIG_DISCLAIMERS,
} from "./policy-config.js";

export type {
  SniperPolicyConfig,
  NormalizeSniperPolicyConfigInput,
  SniperPaperSizing,
  SniperDuplicateMintPolicy,
  EnforceSniperPolicyOptions,
  FormatSniperPolicyConfigOptions,
} from "./policy-config.js";

export {
  normalizeSniperPolicyConfigV2,
  validateSniperPolicyConfigV2,
  formatSniperPolicyConfigV2,
  upgradeSniperPolicyConfigV1ToV2,
  projectSniperPolicyConfigV2ToV1,
  deriveSniperDecisionRulesFromV2,
  enforceSniperPolicyV2,
  enforceSniperPolicyV2WithReasonCodes,
  SniperPolicyConfigV2Error,
  SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION,
  SNIPER_POLICY_CONFIG_V2_BANNER,
  SNIPER_POLICY_CONFIG_V2_DISCLAIMERS,
  SNIPER_POLICY_MODES,
} from "./policy-config-v2.js";

export type {
  SniperPolicyMode,
  SniperPolicyV2RiskLimits,
  SniperPolicyConfigV2,
  NormalizeSniperPolicyConfigV2Input,
  EnforceSniperPolicyV2Options,
  FormatSniperPolicyConfigV2Options,
} from "./policy-config-v2.js";

export {
  buildSniperAuditLog,
  validateSniperAuditLog,
  formatSniperAuditLog,
  SniperAuditLogError,
  SNIPER_AUDIT_LOG_SCHEMA_VERSION,
  SNIPER_AUDIT_LOG_BANNER,
  SNIPER_AUDIT_LOG_DISCLAIMERS,
} from "./audit-log.js";

export type {
  SniperAuditStepKind,
  SniperAuditEntry,
  SniperAuditLog,
  BuildSniperAuditLogInput,
  FormatSniperAuditLogOptions,
} from "./audit-log.js";

export {
  buildSniperSessionPack,
  validateSniperSessionPack,
  formatSniperSessionPack,
  SniperSessionPackError,
  SNIPER_SESSION_PACK_SCHEMA_VERSION,
  SNIPER_SESSION_PACK_BANNER,
  SNIPER_SESSION_PACK_DISCLAIMERS,
} from "./session-pack.js";

export type {
  SniperArtifactKind,
  SniperSessionPackEntry,
  SniperSessionCoverage,
  SniperSessionPack,
  SniperSessionPackArtifactInput,
  BuildSniperSessionPackInput,
  FormatSniperSessionPackOptions,
} from "./session-pack.js";

export {
  buildSniperSessionPackV2,
  validateSniperSessionPackV2,
  formatSniperSessionPackV2,
  SniperSessionPackV2Error,
  SNIPER_SESSION_PACK_V2_SCHEMA_VERSION,
  SNIPER_SESSION_PACK_V2_BANNER,
  SNIPER_SESSION_PACK_V2_DISCLAIMERS,
} from "./session-pack-v2.js";

export type {
  SniperArtifactKindV2,
  SniperSessionPackEntryV2,
  SniperSessionCoverageV2,
  SniperSessionPackV2,
  BuildSniperSessionPackV2Input,
  FormatSniperSessionPackV2Options,
} from "./session-pack-v2.js";

export {
  buildSniperSafetyGatesReport,
  validateSniperSafetyGatesReport,
  formatSniperSafetyGatesReport,
  SniperSafetyGatesReportError,
  SNIPER_SAFETY_GATES_REPORT_SCHEMA_VERSION,
  SNIPER_SAFETY_GATES_REPORT_BANNER,
  SNIPER_SAFETY_GATES_REPORT_DISCLAIMERS,
} from "./safety-gates.js";

export type {
  SniperGateStatus,
  SniperSafetyGate,
  SniperSafetyGateAllowances,
  BuildSniperSafetyGatesReportInput,
  SniperSafetyGatesReport,
  FormatSniperSafetyGatesReportOptions,
} from "./safety-gates.js";

export {
  buildSniperSafetyGatesReportV2,
  validateSniperSafetyGatesReportV2,
  formatSniperSafetyGatesReportV2,
  SniperSafetyGatesReportV2Error,
  SNIPER_SAFETY_GATES_REPORT_V2_SCHEMA_VERSION,
  SNIPER_SAFETY_GATES_REPORT_V2_BANNER,
  SNIPER_SAFETY_GATES_REPORT_V2_DISCLAIMERS,
} from "./safety-gates-v2.js";

export type {
  SniperGateArtifactState,
  SniperGateArtifactsChecked,
  SniperPolicyDerivedAllowances,
  BuildSniperSafetyGatesReportV2Input,
  SniperSafetyGatesReportV2,
  FormatSniperSafetyGatesReportV2Options,
} from "./safety-gates-v2.js";

export {
  buildPhase6PrerequisiteReport,
  validatePhase6PrerequisiteReport,
  formatPhase6PrerequisiteReport,
  Phase6PrerequisiteReportError,
  PHASE6_PREREQUISITE_REPORT_SCHEMA_VERSION,
  PHASE6_PREREQUISITE_REPORT_BANNER,
  PHASE6_PREREQUISITE_REPORT_DISCLAIMERS,
} from "./phase6-prereqs.js";

export type {
  Phase6PrereqKind,
  Phase6PrereqStatus,
  Phase6Prerequisite,
  BuildPhase6PrerequisiteReportInput,
  Phase6PrerequisiteReport,
  FormatPhase6PrerequisiteReportOptions,
} from "./phase6-prereqs.js";

export {
  buildPhase6PrerequisiteReportV2,
  validatePhase6PrerequisiteReportV2,
  formatPhase6PrerequisiteReportV2,
  Phase6PrerequisiteReportV2Error,
  PHASE6_PREREQUISITE_REPORT_V2_SCHEMA_VERSION,
  PHASE6_PREREQUISITE_REPORT_V2_BANNER,
  PHASE6_PREREQUISITE_REPORT_V2_DISCLAIMERS,
  PHASE6_READINESS_BUCKETS,
} from "./phase6-prereqs-v2.js";

export type {
  Phase6ReadinessBucket,
  Phase6PrerequisiteV2,
  Phase6BucketSummary,
  BuildPhase6PrerequisiteReportV2Input,
  Phase6PrerequisiteReportV2,
  FormatPhase6PrerequisiteReportV2Options,
} from "./phase6-prereqs-v2.js";

export {
  buildSniperKillSwitchSpec,
  validateSniperKillSwitchSpec,
  formatSniperKillSwitchSpec,
  SniperKillSwitchSpecError,
  SNIPER_KILL_SWITCH_SPEC_SCHEMA_VERSION,
  SNIPER_KILL_SWITCH_SPEC_BANNER,
  SNIPER_KILL_SWITCH_SPEC_DISCLAIMERS,
  SNIPER_KILL_SWITCH_MODES,
  KILL_SWITCH_BASELINE_CONFIRMATIONS,
  KILL_SWITCH_BASELINE_DISABLED_ACTIONS,
  KILL_SWITCH_BASELINE_AUDIT_REQUIREMENTS,
  KILL_SWITCH_BASELINE_TEST_REQUIREMENTS,
} from "./kill-switch-spec.js";

export type {
  SniperKillSwitchMode,
  SniperKillSwitchModeStatus,
  SniperKillSwitchModeSpec,
  SniperKillSwitchReadiness,
  BuildSniperKillSwitchSpecInput,
  SniperKillSwitchSpec,
  FormatSniperKillSwitchSpecOptions,
} from "./kill-switch-spec.js";

export {
  buildSniperSecretsPolicy,
  validateSniperSecretsPolicy,
  formatSniperSecretsPolicy,
  SniperSecretsPolicyError,
  SNIPER_SECRETS_POLICY_SCHEMA_VERSION,
  SNIPER_SECRETS_POLICY_BANNER,
  SNIPER_SECRETS_POLICY_DISCLAIMERS,
  SECRETS_POLICY_BASELINE_RULES,
  SECRETS_POLICY_CORE_RULES,
} from "./secrets-policy.js";

export type {
  SniperSecretsPolicyReadiness,
  BuildSniperSecretsPolicyInput,
  SniperSecretsPolicy,
  FormatSniperSecretsPolicyOptions,
} from "./secrets-policy.js";

export {
  buildSniperBurnerIsolationSpec,
  validateSniperBurnerIsolationSpec,
  formatSniperBurnerIsolationSpec,
  SniperBurnerIsolationSpecError,
  SNIPER_BURNER_ISOLATION_SPEC_SCHEMA_VERSION,
  SNIPER_BURNER_ISOLATION_SPEC_BANNER,
  SNIPER_BURNER_ISOLATION_SPEC_DISCLAIMERS,
  BURNER_ISOLATION_CORE_PRINCIPLES,
  BURNER_ISOLATION_BASELINE_CAP_REQUIREMENTS,
  BURNER_ISOLATION_BASELINE_APPROVALS,
} from "./burner-isolation-spec.js";

export type {
  SniperBurnerIsolationReadiness,
  BuildSniperBurnerIsolationSpecInput,
  SniperBurnerIsolationSpec,
  FormatSniperBurnerIsolationSpecOptions,
} from "./burner-isolation-spec.js";

export {
  buildSimulationIntentPlan,
  validateSimulationIntentPlan,
  formatSimulationIntentPlan,
  SimulationIntentPlanError,
  SIMULATION_INTENT_PLAN_SCHEMA_VERSION,
  SIMULATION_INTENT_PLAN_BANNER,
  SIMULATION_INTENT_PLAN_DISCLAIMERS,
} from "./simulation-intent.js";

export type {
  SimulationIntentSide,
  SimulationApproval,
  SimulationIntentEntry,
  SimulationIntentPlan,
  BuildSimulationIntentPlanInput,
  FormatSimulationIntentPlanOptions,
} from "./simulation-intent.js";

export {
  diffSimulationIntentPlans,
  validateSimulationIntentPlanDiff,
  formatSimulationIntentPlanDiff,
  SimulationIntentPlanDiffError,
  SIMULATION_INTENT_PLAN_DIFF_SCHEMA_VERSION,
  SIMULATION_INTENT_PLAN_DIFF_BANNER,
  SIMULATION_INTENT_PLAN_DIFF_DISCLAIMERS,
} from "./simulation-intent-diff.js";

export type {
  SimulationIntentAmountChange,
  SimulationIntentPlanDiffSide,
  SimulationIntentPlanDiff,
  FormatSimulationIntentPlanDiffOptions,
} from "./simulation-intent-diff.js";

export {
  buildMainnetDryRunReleaseCandidate,
  validateMainnetDryRunReleaseCandidate,
  deriveReleaseCandidateVerdict,
  SniperReleaseCandidateError,
  SNIPER_RELEASE_CANDIDATE_SCHEMA_VERSION,
  SNIPER_RELEASE_CANDIDATE_BANNER,
  SNIPER_RELEASE_CANDIDATE_DISCLAIMERS,
  SNIPER_RELEASE_CANDIDATE_NETWORK,
  SNIPER_RELEASE_CANDIDATE_MODE,
  SNIPER_RELEASE_CANDIDATE_LIVE_SEND_STATUS,
  SNIPER_RELEASE_CANDIDATE_VERDICTS,
} from "./mainnet-dryrun-release-candidate.js";

export type {
  SniperReleaseCandidateVerdict,
  ReleaseCandidateSource,
  ReleaseCandidateRankedEntry,
  ReleaseCandidateScoringEvidence,
  ReleaseCandidateRiskEvidence,
  ReleaseCandidateQuoteEvidence,
  ReleaseCandidateBuildEvidence,
  ReleaseCandidateTxInspectionEvidence,
  ReleaseCandidateSimulationEvidence,
  ReleaseCandidateReadinessEvidence,
  ReleaseCandidateStageError,
  BuildMainnetDryRunReleaseCandidateInput,
  SniperMainnetDryRunReleaseCandidate,
} from "./mainnet-dryrun-release-candidate.js";

export {
  SNIPER_OPERATOR_DEMO_MANIFEST_SCHEMA_VERSION,
  SNIPER_OPERATOR_DEMO_BANNER,
  SNIPER_OPERATOR_DEMO_DISCLAIMERS,
  SNIPER_OPERATOR_DEMO_WHY_LIVE_DISABLED,
  OPERATOR_DEMO_EVIDENCE_CLASSES,
  SniperOperatorDemoManifestError,
  buildSniperOperatorDemoManifest,
  validateSniperOperatorDemoManifest,
} from "./operator-demo-manifest.js";
export type {
  OperatorDemoEvidenceClass,
  OperatorDemoArtifactRef,
  OperatorDemoStage,
  BuildSniperOperatorDemoManifestInput,
  SniperOperatorDemoManifest,
} from "./operator-demo-manifest.js";

export {
  normalizeSniperWatchlist,
  validateSniperWatchlist,
  formatSniperWatchlist,
  SniperWatchlistError,
  SNIPER_WATCHLIST_SCHEMA_VERSION,
  SNIPER_WATCHLIST_BANNER,
  SNIPER_WATCHLIST_DISCLAIMERS,
  SNIPER_WATCHLIST_STATUSES,
  SNIPER_WATCHLIST_NETWORKS,
} from "./watchlist.js";

export type {
  SniperWatchlistStatus,
  SniperWatchlistNetwork,
  SniperWatchlistEntryInput,
  NormalizeSniperWatchlistInput,
  SniperWatchlistEntry,
  SniperWatchlistStatusCounts,
  SniperWatchlist,
  FormatSniperWatchlistOptions,
} from "./watchlist.js";

export {
  buildSniperDryRunCampaign,
  validateSniperDryRunCampaign,
  formatSniperDryRunCampaign,
  deriveSniperCampaignCandidateVerdict,
  isBlockingReleaseCandidateVerdict,
  SniperDryRunCampaignError,
  SNIPER_DRYRUN_CAMPAIGN_SCHEMA_VERSION,
  SNIPER_DRYRUN_CAMPAIGN_BANNER,
  SNIPER_DRYRUN_CAMPAIGN_DISCLAIMERS,
  SNIPER_DRYRUN_CAMPAIGN_MODES,
  SNIPER_DRYRUN_CAMPAIGN_NETWORKS,
  SNIPER_DRYRUN_CAMPAIGN_LIVE_SEND_STATUS,
  SNIPER_CAMPAIGN_CANDIDATE_VERDICTS,
  SNIPER_CAMPAIGN_QUOTE_STATUSES,
  SNIPER_CAMPAIGN_BUILD_STATUSES,
  SNIPER_CAMPAIGN_SIMULATION_STATUSES,
  SNIPER_CAMPAIGN_RISK_DECISIONS,
  SNIPER_CAMPAIGN_PREFLIGHT_VERDICTS,
} from "./dryrun-campaign.js";

export type {
  SniperDryRunCampaignMode,
  SniperDryRunCampaignNetwork,
  SniperCampaignCandidateVerdict,
  SniperCampaignQuoteStatus,
  SniperCampaignBuildStatus,
  SniperCampaignSimulationStatus,
  SniperDryRunCampaignCandidateInput,
  BuildSniperDryRunCampaignInput,
  SniperDryRunCampaignCandidate,
  SniperCampaignVerdictCounts,
  SniperCampaignStage,
  SniperDryRunCampaign,
  FormatSniperDryRunCampaignOptions,
} from "./dryrun-campaign.js";

export {
  buildSniperReadonlyCampaignPlan,
  validateSniperReadonlyCampaignPlan,
  formatSniperReadonlyCampaignPlan,
  SniperReadonlyCampaignPlanError,
  SNIPER_READONLY_CAMPAIGN_PLAN_SCHEMA_VERSION,
  SNIPER_READONLY_CAMPAIGN_PLAN_BANNER,
  SNIPER_READONLY_CAMPAIGN_PLAN_DISCLAIMERS,
  SNIPER_READONLY_CAMPAIGN_PLAN_MODES,
  SNIPER_READONLY_CAMPAIGN_PLAN_NETWORKS,
  SNIPER_READONLY_CAMPAIGN_PLAN_LIVE_SEND_STATUS,
  SNIPER_READONLY_CAMPAIGN_STAGES,
  SNIPER_READONLY_CAMPAIGN_NETWORK_STAGES,
  SNIPER_READONLY_CAMPAIGN_PROVIDER_POLICIES,
  SNIPER_READONLY_CAMPAIGN_MAX_CANDIDATE_LIMIT,
} from "./readonly-campaign-plan.js";

export type {
  SniperReadonlyCampaignPlanMode,
  SniperReadonlyCampaignPlanNetwork,
  SniperReadonlyCampaignStage,
  SniperReadonlyCampaignProviderPolicy,
  BuildSniperReadonlyCampaignPlanInput,
  SniperReadonlyCampaignPlan,
  FormatSniperReadonlyCampaignPlanOptions,
} from "./readonly-campaign-plan.js";

export {
  buildSniperAlphaRunReport,
  validateSniperAlphaRunReport,
  formatSniperAlphaRunReport,
  SniperAlphaRunReportError,
  SNIPER_ALPHA_RUN_REPORT_SCHEMA_VERSION,
  SNIPER_ALPHA_RUN_REPORT_BANNER,
  SNIPER_ALPHA_RUN_REPORT_DISCLAIMERS,
  SNIPER_ALPHA_RUN_REPORT_MODES,
  SNIPER_ALPHA_RUN_REPORT_NETWORKS,
  SNIPER_ALPHA_RUN_EVIDENCE_PROVENANCE,
  SNIPER_ALPHA_RUN_RUST_ENGINE_STATUSES,
  SNIPER_ALPHA_RUN_PROVIDER_STATUSES,
  SNIPER_ALPHA_RUN_LIVE_TRADING_STATUS,
} from "./alpha-run-report.js";

export type {
  SniperAlphaRunReportMode,
  SniperAlphaRunReportNetwork,
  SniperAlphaRunEvidenceProvenance,
  SniperAlphaRunRustEngineStatus,
  SniperAlphaRunProviderStatus,
  SniperAlphaRunProviderHealthInput,
  BuildSniperAlphaRunReportInput,
  SniperAlphaTopCandidate,
  SniperAlphaBlockedCandidate,
  SniperAlphaInsufficientCandidate,
  SniperAlphaStageCoverage,
  SniperAlphaProviderHealthSummary,
  SniperAlphaRunReport,
  FormatSniperAlphaRunReportOptions,
} from "./alpha-run-report.js";

export {
  diffSniperDryRunCampaigns,
  validateSniperDryRunCampaignDiff,
  formatSniperDryRunCampaignDiff,
  SniperDryRunCampaignDiffError,
  SNIPER_DRYRUN_CAMPAIGN_DIFF_SCHEMA_VERSION,
  SNIPER_DRYRUN_CAMPAIGN_DIFF_BANNER,
  SNIPER_DRYRUN_CAMPAIGN_DIFF_DISCLAIMERS,
  SNIPER_CAMPAIGN_DIFF_STATUSES,
  SNIPER_DRYRUN_CAMPAIGN_DIFF_LIVE_SEND_STATUS,
} from "./dryrun-campaign-diff.js";

export type {
  SniperCampaignDiffStatus,
  DiffSniperDryRunCampaignsInput,
  SniperCampaignCandidateChange,
  SniperCampaignDiffSummary,
  SniperDryRunCampaignDiff,
  FormatSniperDryRunCampaignDiffOptions,
} from "./dryrun-campaign-diff.js";

export {
  buildSniperAlphaHistory,
  validateSniperAlphaHistory,
  formatSniperAlphaHistory,
  SniperAlphaHistoryError,
  SNIPER_ALPHA_HISTORY_SCHEMA_VERSION,
  SNIPER_ALPHA_HISTORY_BANNER,
  SNIPER_ALPHA_HISTORY_DISCLAIMERS,
  SNIPER_ALPHA_HISTORY_LIVE_TRADING_STATUS,
} from "./alpha-history.js";

export type {
  SniperAlphaHistoryRunInput,
  SniperAlphaHistoryInvalidArtifactInput,
  BuildSniperAlphaHistoryInput,
  SniperAlphaHistoryVerdictCounts,
  SniperAlphaHistoryProviderRollup,
  SniperAlphaHistoryProvenanceRollup,
  SniperAlphaHistoryRun,
  SniperAlphaHistoryInvalidArtifact,
  SniperAlphaHistoryBlockerFrequency,
  SniperAlphaHistorySensitiveScan,
  SniperAlphaHistory,
  FormatSniperAlphaHistoryOptions,
} from "./alpha-history.js";

export {
  diffSniperAlphaHistories,
  validateSniperAlphaHistoryDiff,
  formatSniperAlphaHistoryDiff,
  SniperAlphaHistoryDiffError,
  SNIPER_ALPHA_HISTORY_DIFF_SCHEMA_VERSION,
  SNIPER_ALPHA_HISTORY_DIFF_BANNER,
  SNIPER_ALPHA_HISTORY_DIFF_DISCLAIMERS,
  SNIPER_ALPHA_HISTORY_DIFF_RUN_STATUSES,
  SNIPER_ALPHA_HISTORY_DIFF_LIVE_TRADING_STATUS,
} from "./alpha-history-diff.js";

export type {
  SniperAlphaHistoryDiffRunStatus,
  DiffSniperAlphaHistoriesInput,
  SniperAlphaHistoryMovementTriple,
  SniperAlphaHistoryProviderRollupMovement,
  SniperAlphaHistoryVerdictMovement,
  SniperAlphaHistoryRunChange,
  SniperAlphaHistoryBlockerReasonMovement,
  SniperAlphaHistoryPhase7PostureMovement,
  SniperAlphaHistoryDiffRunIdentity,
  SniperAlphaHistoryDiffSummary,
  SniperAlphaHistoryDiffSensitiveScan,
  SniperAlphaHistoryDiff,
  FormatSniperAlphaHistoryDiffOptions,
} from "./alpha-history-diff.js";

export {
  buildSniperAlphaHistoryTrend,
  validateSniperAlphaHistoryTrend,
  formatSniperAlphaHistoryTrend,
  SniperAlphaHistoryTrendError,
  SNIPER_ALPHA_HISTORY_TREND_SCHEMA_VERSION,
  SNIPER_ALPHA_HISTORY_TREND_BANNER,
  SNIPER_ALPHA_HISTORY_TREND_DISCLAIMERS,
  SNIPER_ALPHA_HISTORY_TREND_LIVE_TRADING_STATUS,
  SNIPER_ALPHA_HISTORY_TREND_CONSISTENCY,
} from "./alpha-history-trend.js";

export type {
  SniperAlphaHistoryTrendConsistency,
  SniperAlphaHistoryTrendSnapshotInput,
  BuildSniperAlphaHistoryTrendInput,
  SniperAlphaHistoryTrendProviderOk,
  SniperAlphaHistoryTrendProvenanceCounts,
  SniperAlphaHistoryTrendSnapshot,
  SniperAlphaHistoryTrendStep,
  SniperAlphaHistoryTrendVerdictSeries,
  SniperAlphaHistoryTrendBlockerTotal,
  SniperAlphaHistoryTrendProviderConsistency,
  SniperAlphaHistoryTrendSensitiveScan,
  SniperAlphaHistoryTrend,
  FormatSniperAlphaHistoryTrendOptions,
} from "./alpha-history-trend.js";

export {
  buildSniperStrategyIntelligence,
  validateSniperStrategyIntelligence,
  formatSniperStrategyIntelligence,
  SniperStrategyIntelligenceError,
  SNIPER_STRATEGY_INTELLIGENCE_SCHEMA_VERSION,
  SNIPER_STRATEGY_INTELLIGENCE_BANNER,
  SNIPER_STRATEGY_INTELLIGENCE_DISCLAIMERS,
  SNIPER_STRATEGY_INTELLIGENCE_LIVE_TRADING_STATUS,
  SNIPER_STRATEGY_MINT_CLASSES,
  SNIPER_STRATEGY_CONFIDENCE_LEVELS,
  SNIPER_STRATEGY_REASON_CODES,
} from "./strategy-intelligence.js";

export type {
  SniperStrategyMintClass,
  SniperStrategyConfidence,
  SniperStrategyReasonCode,
  SniperStrategyRiskInput,
  BuildSniperStrategyIntelligenceInput,
  SniperStrategyNotableFlag,
  SniperStrategyCandidateIntel,
  SniperStrategyVerdictCounts,
  SniperStrategyConfidenceCounts,
  SniperStrategyMintClassCounts,
  SniperStrategyConcern,
  SniperStrategyIntelligence,
  FormatSniperStrategyIntelligenceOptions,
} from "./strategy-intelligence.js";

export {
  resolveReadonlyProviderConfig,
  ReadonlyProviderConfigError,
  READONLY_PROVIDER_MODES,
  READONLY_PROVIDER_NETWORKS,
  READONLY_PROVIDER_ENV_VARS,
  DEFAULT_MAINNET_RPC_URL,
  DEFAULT_DEVNET_RPC_URL,
  DEFAULT_JUPITER_QUOTE_URL,
  PROVIDER_TIMEOUT_MS_MIN,
  PROVIDER_TIMEOUT_MS_MAX,
  PROVIDER_TIMEOUT_MS_DEFAULT,
  PROVIDER_RETRY_LIMIT_MIN,
  PROVIDER_RETRY_LIMIT_MAX,
  PROVIDER_RETRY_LIMIT_DEFAULT,
} from "./provider-config.js";

export type {
  ReadonlyProviderMode,
  ReadonlyProviderNetwork,
  ReadonlyProviderSource,
  ResolvedProviderEndpoint,
  ResolvedReadonlyProviderConfig,
  ResolveReadonlyProviderConfigInput,
} from "./provider-config.js";

export {
  buildSniperProviderHealthReport,
  validateSniperProviderHealthReport,
  formatSniperProviderHealthReport,
  summarizeProviderHealthForAlpha,
  deriveCanRunLiveReadonlyCampaign,
  SniperProviderHealthReportError,
  SNIPER_PROVIDER_HEALTH_REPORT_SCHEMA_VERSION,
  SNIPER_PROVIDER_HEALTH_REPORT_BANNER,
  SNIPER_PROVIDER_HEALTH_REPORT_DISCLAIMERS,
  SNIPER_PROVIDER_HEALTH_MODES,
  SNIPER_PROVIDER_HEALTH_NETWORKS,
  SNIPER_PROVIDER_HEALTH_PROVIDERS,
  SNIPER_PROVIDER_HEALTH_STATUSES,
  SNIPER_PROVIDER_HEALTH_LIVE_REQUIRED_PROVIDERS,
  SNIPER_PROVIDER_HEALTH_LIVE_SEND_STATUS,
} from "./provider-health-report.js";

export type {
  SniperProviderHealthMode,
  SniperProviderHealthNetwork,
  SniperProviderHealthProvider,
  SniperProviderHealthStatus,
  SniperProviderHealthCheckInput,
  BuildSniperProviderHealthReportInput,
  SniperProviderHealthCheck,
  SniperProviderHealthSummary,
  SniperProviderHealthReport,
  SniperAlphaProviderStatusLabel,
  FormatSniperProviderHealthReportOptions,
} from "./provider-health-report.js";
