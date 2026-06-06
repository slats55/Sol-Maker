/**
 * Deterministic scenario MATRIX expansion: produce several injected scenario
 * variants from one base scenario plus a small, declarative matrix of patches.
 *
 * The patch system is intentionally tiny and SAFE. It is plain JSON object
 * patching over an allowlist of config-only keys — never arbitrary deep merging,
 * never code/expressions, and never the structural or labelling fields. A patch
 * may only set `strategyConfig`, `caps`, and/or `defaultPaperSizeUsd`; it may NOT
 * touch `steps`, `initialJournal`, or `name` (each variant's name is derived from
 * the base name plus the variant suffix, so the base's "INJECTED FIXTURE" labelling
 * is always preserved and can never be edited into something misleading).
 *
 * Pure (no network, no RPC, no filesystem, no `Date.now`, no `Math.random`) and
 * non-mutating: the base scenario is never modified and each variant is a fully
 * independent deep copy. Every produced variant is validated; an invalid base,
 * an invalid matrix, a disallowed patch, or a variant that fails validation all
 * throw {@link ScenarioMatrixError}.
 */

import { validateBacktestScenario } from "./backtest.js";
import type { BacktestScenario } from "./types.js";

/** Thrown for an invalid base, matrix, patch, or produced variant. */
export class ScenarioMatrixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioMatrixError";
  }
}

/** The only top-level scenario keys a matrix patch may set. */
const PATCHABLE_KEYS = ["strategyConfig", "caps", "defaultPaperSizeUsd"] as const;
type PatchableKey = (typeof PATCHABLE_KEYS)[number];

/** A single, limited patch: a shallow override of config-only fields. */
export interface ScenarioPatch {
  strategyConfig?: Record<string, number | boolean>;
  caps?: Record<string, number | boolean>;
  defaultPaperSizeUsd?: number;
}

/** One matrix variant: a filesystem-safe suffix + its patch. */
export interface ScenarioMatrixVariant {
  suffix: string;
  patch: ScenarioPatch;
}

/** A small, declarative matrix of variants to expand from a base scenario. */
export interface ScenarioMatrix {
  name?: string;
  variants: ScenarioMatrixVariant[];
}

/** One expanded, validated variant scenario. */
export interface ExpandedScenarioVariant {
  suffix: string;
  scenario: BacktestScenario;
}

/** The deterministic result of expanding a matrix. */
export interface ScenarioMatrixResult {
  name: string | null;
  variants: ExpandedScenarioVariant[];
}

// --- guards ------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * A suffix must be a short, filesystem-safe token used to name the variant and its
 * output file: letters, digits, dot, dash, or underscore only, and never the
 * path-traversal sequence "..". The allowlist regex rejects path separators,
 * spaces, and control characters in one check.
 */
const SAFE_SUFFIX = /^[A-Za-z0-9._-]+$/;
function isSafeSuffix(value: unknown): value is string {
  return nonEmptyString(value) && SAFE_SUFFIX.test(value) && !value.includes("..");
}

function isScalarPatchValue(value: unknown): value is number | boolean {
  return (typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean";
}

// --- patch validation --------------------------------------------------------

function validatePatch(patch: unknown, where: string): ScenarioPatch {
  if (!isObject(patch)) {
    throw new ScenarioMatrixError(`${where}.patch must be an object`);
  }
  for (const key of Object.keys(patch)) {
    if (!PATCHABLE_KEYS.includes(key as PatchableKey)) {
      throw new ScenarioMatrixError(
        `${where}.patch may only set ${PATCHABLE_KEYS.join(", ")} — "${key}" is not allowed ` +
          "(steps, name, and initialJournal are protected)",
      );
    }
  }
  const result: ScenarioPatch = {};
  for (const objKey of ["strategyConfig", "caps"] as const) {
    if (patch[objKey] !== undefined) {
      const sub = patch[objKey];
      if (!isObject(sub)) {
        throw new ScenarioMatrixError(`${where}.patch.${objKey} must be an object`);
      }
      for (const [k, v] of Object.entries(sub)) {
        if (!isScalarPatchValue(v)) {
          throw new ScenarioMatrixError(
            `${where}.patch.${objKey}.${k} must be a finite number or boolean`,
          );
        }
      }
      result[objKey] = sub as Record<string, number | boolean>;
    }
  }
  if (patch.defaultPaperSizeUsd !== undefined) {
    if (typeof patch.defaultPaperSizeUsd !== "number" || !Number.isFinite(patch.defaultPaperSizeUsd)) {
      throw new ScenarioMatrixError(`${where}.patch.defaultPaperSizeUsd must be a finite number`);
    }
    result.defaultPaperSizeUsd = patch.defaultPaperSizeUsd;
  }
  return result;
}

// --- expansion ---------------------------------------------------------------

/** Deep-clone a scenario via JSON round-trip (scenarios are pure JSON). */
function cloneScenario(scenario: BacktestScenario): BacktestScenario {
  return JSON.parse(JSON.stringify(scenario)) as BacktestScenario;
}

function applyPatch(base: BacktestScenario, suffix: string, patch: ScenarioPatch): BacktestScenario {
  const next = cloneScenario(base);
  // Derive the variant name from the base name so the INJECTED labelling survives.
  next.name = `${base.name} [${suffix}]`;
  if (patch.strategyConfig) {
    next.strategyConfig = { ...next.strategyConfig, ...patch.strategyConfig };
  }
  if (patch.caps) {
    next.caps = { ...next.caps, ...patch.caps };
  }
  if (patch.defaultPaperSizeUsd !== undefined) {
    next.defaultPaperSizeUsd = patch.defaultPaperSizeUsd;
  }
  return next;
}

/**
 * Expand a base scenario by a matrix of patches into validated variant scenarios.
 * Deterministic, pure, and non-mutating. Throws {@link ScenarioMatrixError} on an
 * invalid base, matrix, patch, duplicate/unsafe suffix, or a variant that fails
 * scenario validation.
 */
export function expandScenarioMatrix(base: unknown, matrix: unknown): ScenarioMatrixResult {
  // The base must itself be a valid scenario.
  let baseScenario: BacktestScenario;
  try {
    baseScenario = validateBacktestScenario(base);
  } catch (err) {
    throw new ScenarioMatrixError(`base scenario is invalid: ${(err as Error).message}`);
  }

  if (!isObject(matrix)) {
    throw new ScenarioMatrixError("matrix must be a JSON object");
  }
  if (matrix.name !== undefined && typeof matrix.name !== "string") {
    throw new ScenarioMatrixError("matrix.name must be a string when present");
  }
  if (!Array.isArray(matrix.variants) || matrix.variants.length === 0) {
    throw new ScenarioMatrixError("matrix.variants must be a non-empty array");
  }

  const seenSuffixes = new Set<string>();
  const variants: ExpandedScenarioVariant[] = [];

  matrix.variants.forEach((raw, i) => {
    const where = `matrix.variants[${i}]`;
    if (!isObject(raw)) throw new ScenarioMatrixError(`${where} must be an object`);
    if (!isSafeSuffix(raw.suffix)) {
      throw new ScenarioMatrixError(
        `${where}.suffix must be a non-empty token of [A-Za-z0-9._-] with no path separators or ".."`,
      );
    }
    if (seenSuffixes.has(raw.suffix)) {
      throw new ScenarioMatrixError(`${where}.suffix "${raw.suffix}" is duplicated`);
    }
    seenSuffixes.add(raw.suffix);

    const patch = validatePatch(raw.patch, where);
    const scenario = applyPatch(baseScenario, raw.suffix, patch);

    // Every produced variant must itself be a valid scenario.
    try {
      validateBacktestScenario(scenario);
    } catch (err) {
      throw new ScenarioMatrixError(
        `${where} produced an invalid scenario: ${(err as Error).message}`,
      );
    }
    variants.push({ suffix: raw.suffix, scenario });
  });

  return { name: matrix.name ?? null, variants };
}
