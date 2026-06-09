/**
 * @soulmaker/backtest — deterministic, offline, **simulated-only** paper backtest
 * (the Sprint 8 bridge between journal-continuing paper runs and replay).
 *
 * It replays injected historical steps through the SAME production code paths as
 * the manual loop — `planStrategyBatch` (decide) then `runPaperSession` started
 * from the carried-forward simulated state — and reports a deterministic summary.
 * It sits ABOVE both `@soulmaker/strategy` and `@soulmaker/paper` (it depends on
 * each); neither depends on it, so there is no cycle and each keeps its contract
 * (strategy still never runs a paper session on its own).
 *
 * Hard rules (enforced by code + tests): injected local data only — no network,
 * no RPC, no wallet, no filesystem, no `Date.now`, no `Math.random`. Nothing here
 * holds a key, or builds/signs/simulates/sends a transaction. Every number is
 * simulated bookkeeping from injected prices — NOT a live result, NOT real market
 * performance, NOT a profitability claim, and NOT financial advice.
 */

export const BACKTEST_PACKAGE_PHASE = 5 as const;

export {
  runBacktest,
  validateBacktestScenario,
  validateScenario,
  BacktestScenarioError,
} from "./backtest.js";

export {
  lintBacktestScenario,
  collectScenarioIssues,
  computeScenarioWarnings,
} from "./lint.js";

export { canonicalize, digestContent } from "./digest.js";

export {
  formatBacktestReport,
  BACKTEST_BANNER,
  BACKTEST_DISCLAIMERS,
  BACKTEST_REPORT_SCHEMA_VERSION,
} from "./report.js";

export {
  validateBacktestReport,
  collectReportIssues,
  isBacktestReport,
  BacktestReportError,
} from "./report-validate.js";

export {
  diffBacktestReports,
  formatBacktestReportDiff,
  BACKTEST_DIFF_SCHEMA_VERSION,
  BACKTEST_DIFF_DISCLAIMERS,
} from "./diff.js";

export {
  buildExampleBacktestScenario,
  listBacktestScenarioTemplates,
} from "./templates.js";

export { expandScenarioMatrix, ScenarioMatrixError } from "./matrix.js";

export {
  generateScenarioVariants,
  explainScenarioVariantPlan,
  validateScenarioVariantPlanExplanation,
  formatScenarioVariantPlanExplanation,
  ScenarioVariantError,
  BACKTEST_VARIANT_PLAN_EXPLAIN_SCHEMA_VERSION,
  BACKTEST_VARIANT_PLAN_EXPLAIN_BANNER,
  BACKTEST_VARIANT_PLAN_EXPLAIN_DISCLAIMERS,
} from "./scenario-variants.js";

export {
  runBacktestSuite,
  buildBacktestSuiteIndex,
  validateBacktestSuiteInput,
  BacktestSuiteInputError,
  BACKTEST_SUITE_SCHEMA_VERSION,
  BACKTEST_SUITE_BANNER,
  BACKTEST_SUITE_DISCLAIMERS,
} from "./suite.js";

export { formatBacktestSuiteIndex } from "./suite-report.js";

export {
  validateBacktestSuiteIndex,
  collectSuiteIndexIssues,
  isBacktestSuiteIndex,
  BacktestSuiteIndexError,
} from "./suite-validate.js";

export {
  diffBacktestSuites,
  formatBacktestSuiteDiff,
  BACKTEST_SUITE_DIFF_SCHEMA_VERSION,
  BACKTEST_SUITE_DIFF_DISCLAIMERS,
} from "./suite-diff.js";

export {
  runScenarioVariantSensitivity,
  buildScenarioVariantSensitivityReport,
  validateScenarioVariantSensitivityReport,
  formatScenarioVariantSensitivityReport,
  ScenarioVariantSensitivityError,
  BACKTEST_SENSITIVITY_SCHEMA_VERSION,
  BACKTEST_SENSITIVITY_BANNER,
  BACKTEST_SENSITIVITY_DISCLAIMERS,
  SENSITIVITY_BASELINE_ID,
} from "./sensitivity.js";

export type {
  BacktestScenario,
  BacktestStep,
  BacktestStepResult,
  BacktestReport,
  BacktestLintIssue,
  BacktestScenarioLintResult,
  BacktestScenarioLintSummary,
  BacktestEquityPoint,
  BacktestPerMintAggregate,
} from "./types.js";

export type {
  BacktestReportDiff,
  BacktestNumberDelta,
  BacktestDiffStringField,
  BacktestDiffCompatibility,
  BacktestDiffCompatibilityStatus,
  BacktestSummaryDiff,
  BacktestWarningsDiff,
  BacktestEquityStepDiff,
  BacktestEquityCurveDiff,
  BacktestPerMintDelta,
  BacktestPerMintDiff,
  FormatBacktestReportDiffOptions,
} from "./diff.js";

export type {
  BacktestScenarioTemplate,
  BacktestScenarioTemplateInfo,
  BuildBacktestScenarioOptions,
} from "./templates.js";

export type {
  ScenarioMatrix,
  ScenarioMatrixVariant,
  ScenarioPatch,
  ExpandedScenarioVariant,
  ScenarioMatrixResult,
} from "./matrix.js";

export type {
  PerturbationOp,
  ScenarioPerturbation,
  ScenarioVariantSpec,
  ScenarioVariantPlan,
  GeneratedScenarioVariant,
  ScenarioVariantsResult,
  PerturbationExplanation,
  VariantExplanation,
  ScenarioVariantPlanExplanation,
  FormatScenarioVariantPlanExplanationOptions,
} from "./scenario-variants.js";

export type {
  BacktestSuiteScenario,
  BacktestSuiteInput,
  BacktestSuiteResult,
  BacktestSuiteRunEntry,
  BacktestSuiteIndex,
  BacktestSuiteEntry,
  BacktestSuiteSummary,
  BacktestSuiteEntrySummary,
  BacktestSuiteError,
  BacktestSuiteWarning,
  BacktestSuiteLintStatus,
  BacktestSuiteRunStatus,
  BacktestSuiteEntryStatus,
} from "./suite.js";

export type { FormatBacktestSuiteIndexOptions } from "./suite-report.js";

export type {
  BacktestSuiteDiff,
  BacktestSuiteDiffCompatibility,
  BacktestSuiteDiffCompatibilityStatus,
  BacktestSuitePairingMode,
  BacktestSuiteSummaryDiff,
  BacktestSuiteEntrySummaryDiff,
  BacktestSuiteEntryRef,
  BacktestSuiteEntryChange,
  BacktestSuiteWarningsDiff,
  FormatBacktestSuiteDiffOptions,
} from "./suite-diff.js";

export {
  diffScenarioVariantSensitivityReports,
  validateScenarioVariantSensitivityDiff,
  formatScenarioVariantSensitivityDiff,
  ScenarioVariantSensitivityDiffError,
  BACKTEST_SENSITIVITY_DIFF_SCHEMA_VERSION,
  BACKTEST_SENSITIVITY_DIFF_DISCLAIMERS,
} from "./sensitivity-diff.js";

export {
  summarizeBacktestSuiteCoverage,
  validateBacktestSuiteCoverage,
  formatBacktestSuiteCoverage,
  BacktestCoverageError,
  BACKTEST_COVERAGE_SCHEMA_VERSION,
  BACKTEST_COVERAGE_BANNER,
  BACKTEST_COVERAGE_DISCLAIMERS,
} from "./coverage.js";

export type {
  BacktestSuiteCoverageReport,
  BacktestCoverageCounts,
  BacktestCoverageFlags,
  BacktestCoverageScenarioLists,
  BacktestPathBehaviourCoverage,
  FormatBacktestSuiteCoverageOptions,
} from "./coverage.js";

export type {
  ScenarioVariantSensitivityDiff,
  SensitivityDiffCompatibility,
  SensitivityDiffCompatibilityStatus,
  SensitivityDiffStringField,
  SensitivitySummaryFieldDiff,
  SensitivityBaselineDiff,
  SensitivityVariantRef,
  SensitivityVariantChange,
  SensitivityRankingMovement,
  FormatScenarioVariantSensitivityDiffOptions,
} from "./sensitivity-diff.js";

export type {
  ScenarioVariantSensitivityInput,
  ScenarioVariantSensitivityRun,
  ScenarioVariantSensitivityReport,
  ScenarioVariantSensitivityBaseline,
  ScenarioVariantSensitivityEntry,
  SensitivitySummaryDeltas,
  SensitivityNumberDelta,
  SensitivityRankings,
  SensitivityRankingEntry,
  FormatScenarioVariantSensitivityOptions,
} from "./sensitivity.js";

export {
  runScenarioVariantSensitivityMatrix,
  buildScenarioVariantSensitivityMatrixReport,
  validateScenarioVariantSensitivityMatrixReport,
  formatScenarioVariantSensitivityMatrixReport,
  ScenarioVariantSensitivityMatrixError,
  BACKTEST_SENSITIVITY_MATRIX_SCHEMA_VERSION,
  BACKTEST_SENSITIVITY_MATRIX_BANNER,
  BACKTEST_SENSITIVITY_MATRIX_DISCLAIMERS,
} from "./sensitivity-matrix.js";

export type {
  ScenarioVariantSensitivityMatrixBase,
  ScenarioVariantSensitivityMatrixInput,
  ScenarioVariantSensitivityMatrixCell,
  ScenarioVariantSensitivityMatrixBaseEntry,
  ScenarioVariantSensitivityMatrixDeltaStat,
  ScenarioVariantSensitivityMatrixVariantAggregate,
  ScenarioVariantSensitivityMatrixRankingEntry,
  ScenarioVariantSensitivityMatrixRankings,
  ScenarioVariantSensitivityMatrixReport,
  ScenarioVariantSensitivityMatrixRun,
  BuildScenarioVariantSensitivityMatrixOptions,
  FormatScenarioVariantSensitivityMatrixOptions,
} from "./sensitivity-matrix.js";

export {
  diffScenarioVariantSensitivityMatrixReports,
  validateScenarioVariantSensitivityMatrixDiff,
  formatScenarioVariantSensitivityMatrixDiff,
  ScenarioVariantSensitivityMatrixDiffError,
  BACKTEST_SENSITIVITY_MATRIX_DIFF_SCHEMA_VERSION,
  BACKTEST_SENSITIVITY_MATRIX_DIFF_DISCLAIMERS,
} from "./sensitivity-matrix-diff.js";

export type {
  ScenarioVariantSensitivityMatrixDiff,
  MatrixDiffCompatibility,
  MatrixDiffCompatibilityStatus,
  MatrixDiffStringField,
  MatrixBaseRef,
  MatrixCellChange,
  MatrixBaseChange,
  MatrixVariantAggregateChange,
  MatrixRankingMovement,
  FormatScenarioVariantSensitivityMatrixDiffOptions,
} from "./sensitivity-matrix-diff.js";

export {
  classifyBacktestArtifact,
  buildBacktestResearchManifest,
  validateBacktestResearchManifest,
  formatBacktestResearchManifest,
  verifyBacktestResearchManifest,
  formatBacktestResearchVerification,
  BacktestResearchManifestError,
  BACKTEST_ARTIFACT_KINDS,
  BACKTEST_RESEARCH_MANIFEST_SCHEMA_VERSION,
  BACKTEST_RESEARCH_VERIFY_SCHEMA_VERSION,
  BACKTEST_RESEARCH_MANIFEST_BANNER,
  BACKTEST_RESEARCH_VERIFY_BANNER,
  BACKTEST_RESEARCH_DIGEST_ALGORITHM,
  BACKTEST_RESEARCH_MANIFEST_DISCLAIMERS,
} from "./research-manifest.js";

export type {
  BacktestArtifactKind,
  BacktestArtifactDescriptor,
  BuildBacktestResearchManifestInput,
  BacktestArtifactKindCount,
  BacktestArtifactSchemaCount,
  BacktestResearchManifest,
  ResearchArtifactVerifyStatus,
  ResearchArtifactSnapshot,
  BacktestResearchArtifactVerification,
  BacktestResearchVerification,
  FormatBacktestResearchManifestOptions,
} from "./research-manifest.js";

export {
  diffBacktestResearchManifests,
  validateBacktestResearchManifestDiff,
  formatBacktestResearchManifestDiff,
  BacktestResearchManifestDiffError,
  BACKTEST_RESEARCH_MANIFEST_DIFF_SCHEMA_VERSION,
  BACKTEST_RESEARCH_MANIFEST_DIFF_DISCLAIMERS,
} from "./research-manifest-diff.js";

export type {
  ResearchManifestNumberDelta,
  ResearchManifestArtifactChange,
  ResearchManifestCountChange,
  BacktestResearchManifestDiff,
  FormatBacktestResearchManifestDiffOptions,
} from "./research-manifest-diff.js";

export {
  buildBacktestResearchBundle,
  buildBacktestResearchRunDigest,
  validateBacktestResearchBundle,
  formatBacktestResearchBundle,
  BacktestResearchBundleError,
  BACKTEST_RESEARCH_BUNDLE_SCHEMA_VERSION,
  BACKTEST_RESEARCH_BUNDLE_BANNER,
  BACKTEST_RESEARCH_RUN_DIGEST_DOMAIN,
  BACKTEST_RESEARCH_BUNDLE_DIGEST_ALGORITHM,
  BACKTEST_RESEARCH_BUNDLE_DISCLAIMERS,
} from "./research-bundle.js";

export type {
  BuildBacktestResearchBundleInput,
  BacktestResearchBundle,
  BacktestResearchBundleManifestSummary,
  BacktestResearchBundleDigestEntry,
  FormatBacktestResearchBundleOptions,
} from "./research-bundle.js";

export {
  buildBacktestResearchStatus,
  validateBacktestResearchStatus,
  formatBacktestResearchStatus,
  BacktestResearchStatusError,
  BACKTEST_RESEARCH_STATUS_SCHEMA_VERSION,
  BACKTEST_RESEARCH_STATUS_BANNER,
  BACKTEST_RESEARCH_STATUS_DISCLAIMERS,
} from "./research-status.js";

export type {
  BuildBacktestResearchStatusInput,
  BacktestResearchStatus,
  BacktestResearchStatusManifestCheck,
  FormatBacktestResearchStatusOptions,
} from "./research-status.js";

export {
  buildBacktestResearchCampaignIndex,
  buildBacktestResearchCampaignDigest,
  validateBacktestResearchCampaignIndex,
  formatBacktestResearchCampaignIndex,
  BacktestResearchCampaignIndexError,
  BACKTEST_RESEARCH_CAMPAIGN_INDEX_SCHEMA_VERSION,
  BACKTEST_RESEARCH_CAMPAIGN_INDEX_BANNER,
  BACKTEST_RESEARCH_CAMPAIGN_DIGEST_DOMAIN,
  BACKTEST_RESEARCH_CAMPAIGN_DIGEST_ALGORITHM,
  BACKTEST_RESEARCH_CAMPAIGN_INDEX_DISCLAIMERS,
} from "./research-campaign-index.js";

export type {
  BacktestResearchCampaignRunInput,
  BuildBacktestResearchCampaignIndexInput,
  BacktestResearchCampaignRunSummary,
  BacktestResearchCampaignIndex,
  FormatBacktestResearchCampaignIndexOptions,
} from "./research-campaign-index.js";

export {
  diffBacktestResearchBundles,
  validateBacktestResearchBundleDiff,
  formatBacktestResearchBundleDiff,
  BacktestResearchBundleDiffError,
  BACKTEST_RESEARCH_BUNDLE_DIFF_SCHEMA_VERSION,
  BACKTEST_RESEARCH_BUNDLE_DIFF_DISCLAIMERS,
} from "./research-bundle-diff.js";

export type {
  ResearchBundleNumberDelta,
  ResearchBundleDigestRef,
  ResearchBundleArtifactChange,
  ResearchBundleCountChange,
  BacktestResearchBundleDiff,
  FormatBacktestResearchBundleDiffOptions,
} from "./research-bundle-diff.js";

export {
  diffBacktestResearchCampaignIndexes,
  validateBacktestResearchCampaignIndexDiff,
  formatBacktestResearchCampaignIndexDiff,
  BacktestResearchCampaignIndexDiffError,
  BACKTEST_RESEARCH_CAMPAIGN_DIFF_SCHEMA_VERSION,
  BACKTEST_RESEARCH_CAMPAIGN_DIFF_DISCLAIMERS,
} from "./research-campaign-index-diff.js";

export type {
  ResearchCampaignNumberDelta,
  ResearchCampaignRunRef,
  ResearchCampaignRunChange,
  ResearchCampaignCountChange,
  BacktestResearchCampaignIndexDiff,
  FormatBacktestResearchCampaignIndexDiffOptions,
} from "./research-campaign-index-diff.js";

export {
  buildBacktestResearchCampaignHistoryReport,
  validateBacktestResearchCampaignHistoryReport,
  formatBacktestResearchCampaignHistoryReport,
  BacktestResearchCampaignHistoryReportError,
  BACKTEST_RESEARCH_CAMPAIGN_HISTORY_REPORT_SCHEMA_VERSION,
  BACKTEST_RESEARCH_CAMPAIGN_HISTORY_REPORT_BANNER,
  BACKTEST_RESEARCH_CAMPAIGN_HISTORY_REPORT_DISCLAIMERS,
} from "./research-campaign-history.js";

export type {
  BacktestResearchCampaignHistoryBaselineSelector,
  BacktestResearchCampaignHistorySnapshotInput,
  BuildBacktestResearchCampaignHistoryReportInput,
  BacktestResearchCampaignHistoryBaselineKind,
  BacktestResearchCampaignHistoryRunSummary,
  BacktestResearchCampaignHistoryReport,
  FormatBacktestResearchCampaignHistoryReportOptions,
} from "./research-campaign-history.js";

export {
  buildBacktestResearchPortfolioReport,
  validateBacktestResearchPortfolioReport,
  formatBacktestResearchPortfolioReport,
  BacktestResearchPortfolioReportError,
  BACKTEST_RESEARCH_PORTFOLIO_REPORT_SCHEMA_VERSION,
  BACKTEST_RESEARCH_PORTFOLIO_REPORT_BANNER,
  BACKTEST_RESEARCH_PORTFOLIO_REPORT_DISCLAIMERS,
} from "./research-portfolio.js";

export type {
  BacktestResearchPortfolioCampaignInput,
  BuildBacktestResearchPortfolioReportInput,
  BacktestResearchPortfolioCampaignStatus,
  BacktestResearchPortfolioCampaignSummary,
  BacktestResearchPortfolioReport,
  FormatBacktestResearchPortfolioReportOptions,
} from "./research-portfolio.js";

export {
  diffBacktestResearchPortfolioReports,
  validateBacktestResearchPortfolioDiff,
  formatBacktestResearchPortfolioDiff,
  BacktestResearchPortfolioDiffError,
  BACKTEST_RESEARCH_PORTFOLIO_DIFF_SCHEMA_VERSION,
  BACKTEST_RESEARCH_PORTFOLIO_DIFF_BANNER,
  BACKTEST_RESEARCH_PORTFOLIO_DIFF_DISCLAIMERS,
} from "./research-portfolio-diff.js";

export type {
  ResearchPortfolioNumberDelta,
  ResearchPortfolioFlagTransition,
  ResearchPortfolioCampaignRef,
  ResearchPortfolioCampaignChange,
  BacktestResearchPortfolioDiff,
  DiffBacktestResearchPortfolioReportsOptions,
  FormatBacktestResearchPortfolioDiffOptions,
} from "./research-portfolio-diff.js";
