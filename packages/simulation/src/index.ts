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
