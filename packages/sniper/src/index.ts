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
  SniperTokenPreflightReportError,
  SNIPER_TOKEN_PREFLIGHT_REPORT_SCHEMA_VERSION,
  SNIPER_TOKEN_PREFLIGHT_REPORT_BANNER,
  SNIPER_TOKEN_PREFLIGHT_REPORT_DISCLAIMERS,
} from "./token-preflight.js";

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
