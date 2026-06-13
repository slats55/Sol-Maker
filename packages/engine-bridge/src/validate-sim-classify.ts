/**
 * Strict validator for `engine.sim.classification.report.v1` — the simulation
 * classification artifact the Rust sidecar emits (Sprint 100). TypeScript is
 * the validation AUTHORITY: the key set is CLOSED, the classification must be
 * in the S95 closed set, the guidance strings must match
 * `TX_SIMULATION_CLASSIFICATION_GUIDANCE` VERBATIM, and — the PARITY WALL —
 * when the original `{ errLabel, logs }` is supplied, the classification must
 * equal what the real `classifySimulationFailure` returns, or the artifact is
 * refused.
 */

import {
  classifySimulationFailure,
  TX_SIMULATION_CLASSIFICATION_GUIDANCE,
  type TxSimulationClassification,
} from "@soulmaker/txpreview";
import { ENGINE_IPC_VERSION } from "./validate.js";

export const ENGINE_SIM_CLASSIFICATION_SCHEMA_VERSION = "engine.sim.classification.report.v1";

/** The classifications the engine can emit (the S95 failure set, minus `none`/transport states). */
const ENGINE_CLASSIFICATIONS: readonly TxSimulationClassification[] = [
  "slippage-or-route-error",
  "compute-exceeded",
  "blockhash-error",
  "account-error",
  "program-error",
  "unclassified-error",
];

export interface EngineSimClassificationReportV1 {
  readonly schemaVersion: typeof ENGINE_SIM_CLASSIFICATION_SCHEMA_VERSION;
  readonly banner: string;
  readonly engineName: "solmaker-engine";
  readonly engineVersion: string;
  readonly ipcVersion: typeof ENGINE_IPC_VERSION;
  readonly classification: TxSimulationClassification;
  readonly classificationMessage: string;
  readonly classificationNextAction: string;
  readonly errLabelPresent: boolean;
  readonly logLineCount: number;
  readonly createdAt: string | null;
  readonly caveats: readonly string[];
  readonly notExecutable: true;
  readonly neverSigns: true;
  readonly neverSends: true;
  readonly phase7LiveTradingReady: false;
}

export interface EngineSimResultInput {
  readonly errLabel: string | null;
  readonly logs: readonly string[];
}

const EXPECTED_KEYS = [
  "schemaVersion",
  "banner",
  "engineName",
  "engineVersion",
  "ipcVersion",
  "classification",
  "classificationMessage",
  "classificationNextAction",
  "errLabelPresent",
  "logLineCount",
  "createdAt",
  "caveats",
  "notExecutable",
  "neverSigns",
  "neverSends",
  "phase7LiveTradingReady",
] as const;

const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/;
const VERSION_SHAPE = /^\d+\.\d+\.\d+$/;

export type EngineSimClassificationValidation =
  | { readonly ok: true; readonly report: EngineSimClassificationReportV1 }
  | { readonly ok: false; readonly problems: readonly string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a parsed `engine.sim.classification.report.v1` strictly. When
 * `input` is supplied, the PARITY WALL runs: the classification must equal what
 * the real `classifySimulationFailure` returns for that input.
 */
export function validateEngineSimClassificationReportV1(
  value: unknown,
  input?: EngineSimResultInput,
): EngineSimClassificationValidation {
  const problems: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, problems: ["artifact is not a JSON object"] };
  }
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) {
      problems.push(`unknown field ${JSON.stringify(key)} (the schema is CLOSED)`);
    }
  }
  for (const key of EXPECTED_KEYS) {
    if (!(key in value)) problems.push(`missing field ${JSON.stringify(key)}`);
  }

  if (value.schemaVersion !== ENGINE_SIM_CLASSIFICATION_SCHEMA_VERSION) {
    problems.push(`schemaVersion must be ${JSON.stringify(ENGINE_SIM_CLASSIFICATION_SCHEMA_VERSION)}`);
  }
  if (typeof value.banner !== "string" || value.banner.length === 0 || value.banner.length > 500) {
    problems.push("banner must be a non-empty string (max 500 chars)");
  }
  if (value.engineName !== "solmaker-engine") problems.push('engineName must be "solmaker-engine"');
  if (typeof value.engineVersion !== "string" || !VERSION_SHAPE.test(value.engineVersion)) {
    problems.push("engineVersion must be a semver-shaped string");
  }
  if (value.ipcVersion !== ENGINE_IPC_VERSION) problems.push(`ipcVersion must be ${JSON.stringify(ENGINE_IPC_VERSION)}`);

  const classification = value.classification;
  const classificationKnown = typeof classification === "string" && (ENGINE_CLASSIFICATIONS as readonly string[]).includes(classification);
  if (!classificationKnown) {
    problems.push(`classification must be one of ${ENGINE_CLASSIFICATIONS.join("|")}`);
  } else {
    // Guidance must match the real S95 table VERBATIM.
    const guidance = TX_SIMULATION_CLASSIFICATION_GUIDANCE[classification as TxSimulationClassification];
    if (value.classificationMessage !== guidance.message) {
      problems.push("classificationMessage must match TX_SIMULATION_CLASSIFICATION_GUIDANCE verbatim");
    }
    if (value.classificationNextAction !== guidance.nextAction) {
      problems.push("classificationNextAction must match TX_SIMULATION_CLASSIFICATION_GUIDANCE verbatim");
    }
  }

  if (typeof value.errLabelPresent !== "boolean") problems.push("errLabelPresent must be a boolean");
  if (typeof value.logLineCount !== "number" || !Number.isInteger(value.logLineCount) || value.logLineCount < 0) {
    problems.push("logLineCount must be a non-negative integer");
  }
  if (value.createdAt !== null && (typeof value.createdAt !== "string" || value.createdAt.length > 40 || !ISO_SHAPE.test(value.createdAt))) {
    problems.push("createdAt must be null or an ISO-8601-shaped UTC string");
  }
  if (!Array.isArray(value.caveats) || value.caveats.length === 0 || value.caveats.some((c) => typeof c !== "string" || c.length === 0 || c.length > 500)) {
    problems.push("caveats must be a non-empty array of non-empty strings (max 500 chars each)");
  }
  for (const [field, expected] of [
    ["notExecutable", true],
    ["neverSigns", true],
    ["neverSends", true],
    ["phase7LiveTradingReady", false],
  ] as const) {
    if (value[field] !== expected) problems.push(`${field} must literally be ${String(expected)}`);
  }

  // The PARITY WALL: re-run the real classifier on the same input.
  if (input !== undefined && classificationKnown) {
    const real = classifySimulationFailure(input.errLabel, input.logs);
    if (real !== classification) {
      problems.push(`classification disagrees with classifySimulationFailure (engine ${JSON.stringify(classification)} vs TypeScript ${JSON.stringify(real)}) — the artifact is refused, never repaired`);
    }
    if (value.errLabelPresent !== (input.errLabel !== null)) {
      problems.push("errLabelPresent disagrees with the supplied input");
    }
    if (value.logLineCount !== input.logs.length) {
      problems.push("logLineCount disagrees with the supplied input");
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, report: value as unknown as EngineSimClassificationReportV1 };
}
