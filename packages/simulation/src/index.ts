/**
 * `@soulmaker/simulation` — the Phase 6 SAFE SIMULATION foundation (read-only, dry-run-only).
 *
 * Consumes the validated `@soulmaker/sniper` v2 artifact chain (decision report v2, safety gates
 * v2, Phase-6 prerequisite report v2) plus the adopted governance specs (kill-switch, secrets
 * policy, burner isolation) and produces deterministic simulation artifacts. Boundary, enforced by
 * tests: it can never authorize live trading, never signs, never sends, holds no wallet or key
 * material, and reaches no network. Phase 7 (live/burner trading) is NOT started and cannot be
 * authorized from here.
 */

export {
  SIMULATION_PACKAGE_CAPABILITY_STATEMENT,
  SIMULATION_SAFETY_LITERALS,
  SIMULATION_SAFETY_LITERAL_KEYS,
  SIMULATION_PACKAGE_DISCLAIMERS,
  SimulationSafetyError,
  assertSimulationSafetyLiterals,
  type SimulationSafetyLiterals,
} from "./safety.js";

export {
  SIMULATION_INTENT_PLAN_V2_SCHEMA_VERSION,
  SIMULATION_INTENT_PLAN_V2_BANNER,
  SIMULATION_INTENT_PLAN_V2_GENERATED_BY,
  SIMULATION_INTENT_PLAN_V2_DISCLAIMERS,
  SIMULATION_PLAN_SOURCE_ROLES,
  SimulationIntentPlanV2Error,
  buildSimulationIntentPlanV2,
  validateSimulationIntentPlanV2,
  formatSimulationIntentPlanV2,
  type SimulationPlanSourceRole,
  type SimulationSourceArtifactRef,
  type SimulationPreviewFieldStatus,
  type SimulationPreviewField,
  type SimulationIntentPlanEntryV2,
  type SimulationPlanDecisionSummary,
  type SimulationPlanReadinessSummary,
  type SimulationPlanSpecAdoptionSummary,
  type SimulationIntentPlanV2,
  type BuildSimulationIntentPlanV2Input,
  type FormatSimulationIntentPlanV2Options,
} from "./intent-plan.js";

export {
  // FICTIONAL deterministic chain fixtures (built via PRODUCTION sniper builders; test/e2e only —
  // nothing here is live data, a trade signal, or a recommendation).
  FICTIONAL_MINT_A,
  FICTIONAL_MINT_B,
  buildFictionalReadyChain,
  buildFictionalWatchOnlyChain,
  type FictionalSimulationChain,
} from "./fixtures.js";

export {
  UNAVAILABLE_DRY_RUN_ADAPTER,
  SIMULATION_DRY_RUN_OUTCOME_KINDS,
  validateSimulationDryRunAdapter,
  normalizeSimulationDryRunOutcome,
  type SimulationDryRunRequest,
  type SimulationDryRunOutcome,
  type SimulationDryRunAdapter,
} from "./adapter.js";

export {
  SIMULATION_RESULT_V1_SCHEMA_VERSION,
  SIMULATION_RESULT_V1_BANNER,
  SIMULATION_RESULT_V1_GENERATED_BY,
  SIMULATION_RESULT_V1_MODE,
  SIMULATION_RESULT_V1_DISCLAIMERS,
  SIMULATION_RESULT_ENTRY_STATUSES,
  SIMULATION_RESULT_STATUSES,
  SimulationResultV1Error,
  buildSimulationResultV1,
  validateSimulationResultV1,
  formatSimulationResultV1,
  type SimulationResultEntryStatus,
  type SimulationResultStatus,
  type SimulationResultEntryV1,
  type SimulationResultPlanRef,
  type SimulationResultAdapterSummary,
  type SimulationResultV1,
  type BuildSimulationResultV1Input,
  type FormatSimulationResultV1Options,
} from "./result.js";

export {
  SIMULATION_INTENT_PLAN_DIFF_V2_SCHEMA_VERSION,
  SIMULATION_INTENT_PLAN_DIFF_V2_BANNER,
  SIMULATION_INTENT_PLAN_DIFF_V2_GENERATED_BY,
  SIMULATION_INTENT_PLAN_DIFF_V2_DISCLAIMERS,
  SIMULATION_PLAN_SOURCE_REF_FIELDS,
  SIMULATION_PLAN_ENTRY_PREVIEW_FIELDS,
  SimulationIntentPlanDiffV2Error,
  diffSimulationIntentPlansV2,
  validateSimulationIntentPlanDiffV2,
  formatSimulationIntentPlanDiffV2,
  type SimulationPlanDiffSide,
  type SimulationPlanSourceRefChange,
  type SimulationPlanEntryFieldChange,
  type SimulationPlanEntryChange,
  type SimulationIntentPlanDiffDeltas,
  type SimulationIntentPlanDiffV2,
  type FormatSimulationIntentPlanDiffV2Options,
} from "./intent-plan-diff.js";

export {
  SIMULATION_RESULT_DIFF_V1_SCHEMA_VERSION,
  SIMULATION_RESULT_DIFF_V1_BANNER,
  SIMULATION_RESULT_DIFF_V1_GENERATED_BY,
  SIMULATION_RESULT_DIFF_V1_DISCLAIMERS,
  SIMULATION_RESULT_PLAN_REF_FIELDS,
  SimulationResultDiffV1Error,
  diffSimulationResultsV1,
  validateSimulationResultDiffV1,
  formatSimulationResultDiffV1,
  type SimulationResultDiffSide,
  type SimulationResultEntryChange,
  type SimulationResultDiffDeltas,
  type SimulationResultDiffV1,
  type FormatSimulationResultDiffV1Options,
} from "./result-diff.js";

export {
  PHASE6_AUDIT_REPORT_V1_SCHEMA_VERSION,
  PHASE6_AUDIT_REPORT_V1_BANNER,
  PHASE6_AUDIT_REPORT_V1_GENERATED_BY,
  PHASE6_AUDIT_REPORT_V1_DISCLAIMERS,
  PHASE6_AUDIT_ROLES,
  Phase6AuditReportV1Error,
  buildPhase6AuditReportV1,
  validatePhase6AuditReportV1,
  formatPhase6AuditReportV1,
  type Phase6AuditRole,
  type Phase6AuditedArtifact,
  type Phase6AuditFinding,
  type Phase6AuditReportV1,
  type BuildPhase6AuditReportV1Input,
  type FormatPhase6AuditReportV1Options,
} from "./chain-audit.js";

export {
  PHASE6_SIMULATION_READINESS_REPORT_V1_SCHEMA_VERSION,
  PHASE6_SIMULATION_READINESS_REPORT_V1_BANNER,
  PHASE6_SIMULATION_READINESS_REPORT_V1_GENERATED_BY,
  PHASE6_SIMULATION_READINESS_REPORT_V1_DISCLAIMERS,
  PHASE6_READINESS_EVIDENCE_AREAS,
  Phase6SimulationReadinessReportV1Error,
  buildPhase6SimulationReadinessReportV1,
  validatePhase6SimulationReadinessReportV1,
  formatPhase6SimulationReadinessReportV1,
  type Phase6ReadinessEvidenceArea,
  type Phase6ReadinessEvidence,
  type Phase6ReadinessArtifactCheck,
  type Phase6SimulationReadinessReportV1,
  type BuildPhase6SimulationReadinessReportV1Input,
  type FormatPhase6SimulationReadinessReportV1Options,
} from "./readiness.js";

export {
  PHASE6_SIMULATION_HANDOFF_PACK_V1_SCHEMA_VERSION,
  PHASE6_SIMULATION_HANDOFF_PACK_V1_BANNER,
  PHASE6_SIMULATION_HANDOFF_PACK_V1_GENERATED_BY,
  PHASE6_SIMULATION_HANDOFF_PACK_V1_DISCLAIMERS,
  PHASE6_HANDOFF_ROLES,
  Phase6SimulationHandoffPackV1Error,
  buildPhase6SimulationHandoffPackV1,
  validatePhase6SimulationHandoffPackV1,
  formatPhase6SimulationHandoffPackV1,
  type Phase6HandoffRole,
  type Phase6HandoffSummary,
  type Phase6HandoffArtifact,
  type Phase6SimulationHandoffPackV1,
  type BuildPhase6SimulationHandoffPackV1Input,
  type FormatPhase6SimulationHandoffPackV1Options,
} from "./handoff-pack.js";

export {
  SIMULATION_REASON_CATEGORIES,
  SIMULATION_REASON_SEVERITIES,
  SIMULATION_REASON_CODES,
  SIMULATION_REASON_CODE_DEFINITIONS,
  isSimulationReasonCode,
  simulationReasonCodeDefinition,
  isBlockingSimulationReasonCode,
  dedupeSimulationReasonCodes,
  type SimulationReasonCategory,
  type SimulationReasonSeverity,
  type SimulationReasonCode,
  type SimulationReasonCodeDefinition,
} from "./reason-codes.js";
