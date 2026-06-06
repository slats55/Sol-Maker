/**
 * Deterministic scenario VARIANT generation: produce several injected scenario
 * variants from one base scenario plus a small, declarative plan of BOUNDED
 * numeric perturbations applied to its injected prices and candidate metrics.
 *
 * This is the relative-perturbation complement to {@link expandScenarioMatrix}
 * (`matrix.ts`). Where the matrix SETS config-only fields (strategyConfig / caps
 * / defaultPaperSizeUsd) to absolute values, this MULTIPLIES or ADDS a bounded
 * delta to the *data a scenario replays* — the injected per-step price points
 * (`steps[].prices[].priceUsd`) and the injected per-candidate market metrics
 * (`steps[].candidates[].metrics.*`). The canonical use is a price-sensitivity
 * sweep ("all prices ×1.1", "all prices ×0.9") whose variants are then run as a
 * suite and compared with a suite diff.
 *
 * The plan is intentionally tiny and SAFE. A perturbation is plain arithmetic
 * over an ALLOWLIST of numeric targets: never arbitrary deep merging, never code
 * or `eval`/expression evaluation, never a free-form dotted path into arbitrary
 * structure, and never a structural or labelling field. It can only touch numbers
 * that ALREADY EXIST (an absent field is never created, and a perturbation that
 * matches nothing is refused, not silently ignored). `name`, the `steps`
 * structure, `initialJournal`, and config are never edited, so the base's
 * "INJECTED FIXTURE" labelling always survives — each variant's name is derived
 * from the base name plus the variant suffix and can never be edited into
 * something misleading.
 *
 * Pure (no network, no RPC, no filesystem, no `Date.now`, no `Math.random`, NO
 * RNG of any kind) and non-mutating: the base scenario is never modified and each
 * variant is a fully independent deep copy. Output is byte-stable for identical
 * inputs and variants are emitted in plan order. Every produced variant is
 * validated through the SAME {@link validateBacktestScenario} path used by the
 * engine; an invalid base, an invalid plan, a disallowed/out-of-bounds/empty
 * perturbation, or a variant that fails validation all throw
 * {@link ScenarioVariantError}.
 */

import { validateBacktestScenario } from "./backtest.js";
import type { BacktestScenario } from "./types.js";

/** Thrown for an invalid base, plan, perturbation, or produced variant. */
export class ScenarioVariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioVariantError";
  }
}

/** The two allowed arithmetic operations. `multiply` = factor; `add` = delta. */
const PERTURBATION_OPS = ["multiply", "add"] as const;
export type PerturbationOp = (typeof PERTURBATION_OPS)[number];

/**
 * The allowlist of injected candidate-metric fields a perturbation may target
 * (all numeric in {@link StrategyMetrics}). Targeted as `"metric.<field>"`.
 */
const METRIC_FIELDS = [
  "priceUsd",
  "liquidityUsd",
  "volumeUsd",
  "ageSeconds",
  "holderCount",
  "priceChangePct",
  "peakPriceChangePct",
  "drawdownFromPeakPct",
  "positionSizeUsd",
] as const;
type MetricField = (typeof METRIC_FIELDS)[number];

/** The only keys a perturbation object may carry (typos / smuggling are refused). */
const PERTURBATION_KEYS = ["target", "op", "value", "min", "max", "mint"] as const;
type PerturbationKey = (typeof PERTURBATION_KEYS)[number];

/**
 * One declared perturbation. `target` is `"price"` (every injected price point's
 * `priceUsd`) or `"metric.<field>"` (every candidate's `metrics.<field>`). `op`
 * with `value` is `oldValue * value` (multiply) or `oldValue + value` (add). The
 * result is clamped to the explicit `[min, max]` bounds when present. An optional
 * `mint` restricts the perturbation to values for that one mint.
 */
export interface ScenarioPerturbation {
  target: string;
  op: PerturbationOp;
  value: number;
  /** Optional lower clamp bound (inclusive). */
  min?: number;
  /** Optional upper clamp bound (inclusive). */
  max?: number;
  /** Optional mint filter: only perturb price/metric values for this mint. */
  mint?: string;
}

/** One variant: a filesystem-safe suffix + an ordered list of perturbations. */
export interface ScenarioVariantSpec {
  suffix: string;
  perturbations: ScenarioPerturbation[];
}

/** A small, declarative plan of variants to generate from a base scenario. */
export interface ScenarioVariantPlan {
  name?: string;
  variants: ScenarioVariantSpec[];
}

/** One generated, validated variant scenario plus how many values it changed. */
export interface GeneratedScenarioVariant {
  suffix: string;
  scenario: BacktestScenario;
  /** Total number of individual numeric values this variant's perturbations changed. */
  changeCount: number;
}

/** The deterministic result of generating variants from a plan. */
export interface ScenarioVariantsResult {
  name: string | null;
  variants: GeneratedScenarioVariant[];
}

// --- guards ------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A suffix must be a short, filesystem-safe token used to name the variant and
 * its output file: letters, digits, dot, dash, or underscore only, and never the
 * path-traversal sequence "..". The allowlist regex rejects path separators,
 * spaces, and control characters in one check.
 */
const SAFE_SUFFIX = /^[A-Za-z0-9._-]+$/;
function isSafeSuffix(value: unknown): value is string {
  return nonEmptyString(value) && SAFE_SUFFIX.test(value) && !value.includes("..");
}

// --- normalized (validated) perturbation -------------------------------------

type NormalizedTarget = { kind: "price" } | { kind: "metric"; field: MetricField };

interface NormalizedPerturbation {
  target: NormalizedTarget;
  op: PerturbationOp;
  value: number;
  /** Defaults to -Infinity (no lower clamp). */
  min: number;
  /** Defaults to +Infinity (no upper clamp). */
  max: number;
  mint?: string;
}

const METRIC_PREFIX = "metric.";

function parseTarget(target: unknown, where: string): NormalizedTarget {
  if (!nonEmptyString(target)) {
    throw new ScenarioVariantError(`${where}.target must be a non-empty string`);
  }
  if (target === "price") return { kind: "price" };
  if (target.startsWith(METRIC_PREFIX)) {
    const field = target.slice(METRIC_PREFIX.length);
    if ((METRIC_FIELDS as readonly string[]).includes(field)) {
      return { kind: "metric", field: field as MetricField };
    }
    throw new ScenarioVariantError(
      `${where}.target "${target}" is not allowed — metric field must be one of ${METRIC_FIELDS.join(", ")}`,
    );
  }
  throw new ScenarioVariantError(
    `${where}.target "${target}" is not allowed — use "price" or "metric.<field>"`,
  );
}

function normalizePerturbation(raw: unknown, where: string): NormalizedPerturbation {
  if (!isObject(raw)) {
    throw new ScenarioVariantError(`${where} must be an object`);
  }
  for (const key of Object.keys(raw)) {
    if (!PERTURBATION_KEYS.includes(key as PerturbationKey)) {
      throw new ScenarioVariantError(
        `${where} may only set ${PERTURBATION_KEYS.join(", ")} — "${key}" is not allowed`,
      );
    }
  }

  const target = parseTarget(raw.target, where);

  if (!nonEmptyString(raw.op) || !(PERTURBATION_OPS as readonly string[]).includes(raw.op)) {
    throw new ScenarioVariantError(`${where}.op must be one of ${PERTURBATION_OPS.join(", ")}`);
  }
  const op = raw.op as PerturbationOp;

  if (!isFiniteNumber(raw.value)) {
    throw new ScenarioVariantError(`${where}.value must be a finite number`);
  }

  let min = -Infinity;
  let max = Infinity;
  if (raw.min !== undefined) {
    if (!isFiniteNumber(raw.min)) {
      throw new ScenarioVariantError(`${where}.min must be a finite number when present`);
    }
    min = raw.min;
  }
  if (raw.max !== undefined) {
    if (!isFiniteNumber(raw.max)) {
      throw new ScenarioVariantError(`${where}.max must be a finite number when present`);
    }
    max = raw.max;
  }
  if (min > max) {
    throw new ScenarioVariantError(`${where}.min (${min}) must be <= max (${max})`);
  }

  const result: NormalizedPerturbation = { target, op, value: raw.value, min, max };
  if (raw.mint !== undefined) {
    if (!nonEmptyString(raw.mint)) {
      throw new ScenarioVariantError(`${where}.mint must be a non-empty string when present`);
    }
    result.mint = raw.mint;
  }
  return result;
}

// --- application -------------------------------------------------------------

/** Deep-clone a scenario via JSON round-trip (scenarios are pure JSON). */
function cloneScenario(scenario: BacktestScenario): BacktestScenario {
  return JSON.parse(JSON.stringify(scenario)) as BacktestScenario;
}

/** Apply the op then clamp to the explicit bounds. Pure; no RNG, no clock. */
function perturbNumber(old: number, p: NormalizedPerturbation): number {
  const raw = p.op === "multiply" ? old * p.value : old + p.value;
  return Math.min(Math.max(raw, p.min), p.max);
}

/**
 * Apply one perturbation to the (already cloned) working scenario IN PLACE and
 * return how many numeric values it changed. Only finite values that already
 * exist are touched; an absent field is never created. Throws if the arithmetic
 * (even after clamping) would produce a non-finite number.
 */
function applyPerturbation(
  scenario: BacktestScenario,
  p: NormalizedPerturbation,
  where: string,
): number {
  let count = 0;
  for (const step of scenario.steps) {
    if (p.target.kind === "price") {
      for (const price of step.prices) {
        if (p.mint !== undefined && price.mint !== p.mint) continue;
        if (!isFiniteNumber(price.priceUsd)) continue;
        const next = perturbNumber(price.priceUsd, p);
        if (!Number.isFinite(next)) {
          throw new ScenarioVariantError(
            `${where} produced a non-finite price for mint ${price.mint} — add an explicit max bound`,
          );
        }
        price.priceUsd = next;
        count += 1;
      }
    } else {
      const field = p.target.field;
      for (const candidate of step.candidates) {
        if (p.mint !== undefined && candidate.mint !== p.mint) continue;
        const metrics = candidate.metrics;
        if (!metrics) continue;
        const cur = metrics[field];
        if (!isFiniteNumber(cur)) continue;
        const next = perturbNumber(cur, p);
        if (!Number.isFinite(next)) {
          throw new ScenarioVariantError(
            `${where} produced a non-finite metric.${field} for mint ${candidate.mint} — add an explicit max bound`,
          );
        }
        metrics[field] = next;
        count += 1;
      }
    }
  }
  return count;
}

/**
 * Generate validated scenario variants from a base scenario and a perturbation
 * plan. Deterministic, pure, and non-mutating. Throws {@link ScenarioVariantError}
 * on an invalid base, an invalid plan, a duplicate/unsafe suffix, a disallowed or
 * out-of-bounds perturbation, a perturbation that matches no values, or a variant
 * that fails scenario validation.
 */
export function generateScenarioVariants(base: unknown, plan: unknown): ScenarioVariantsResult {
  // The base must itself be a valid scenario.
  let baseScenario: BacktestScenario;
  try {
    baseScenario = validateBacktestScenario(base);
  } catch (err) {
    throw new ScenarioVariantError(`base scenario is invalid: ${(err as Error).message}`);
  }

  if (!isObject(plan)) {
    throw new ScenarioVariantError("plan must be a JSON object");
  }
  if (plan.name !== undefined && typeof plan.name !== "string") {
    throw new ScenarioVariantError("plan.name must be a string when present");
  }
  if (!Array.isArray(plan.variants) || plan.variants.length === 0) {
    throw new ScenarioVariantError("plan.variants must be a non-empty array");
  }

  const seenSuffixes = new Set<string>();
  const variants: GeneratedScenarioVariant[] = [];

  plan.variants.forEach((rawVariant, i) => {
    const where = `plan.variants[${i}]`;
    if (!isObject(rawVariant)) {
      throw new ScenarioVariantError(`${where} must be an object`);
    }
    if (!isSafeSuffix(rawVariant.suffix)) {
      throw new ScenarioVariantError(
        `${where}.suffix must be a non-empty token of [A-Za-z0-9._-] with no path separators or ".."`,
      );
    }
    if (seenSuffixes.has(rawVariant.suffix)) {
      throw new ScenarioVariantError(`${where}.suffix "${rawVariant.suffix}" is duplicated`);
    }
    seenSuffixes.add(rawVariant.suffix);

    if (!Array.isArray(rawVariant.perturbations) || rawVariant.perturbations.length === 0) {
      throw new ScenarioVariantError(`${where}.perturbations must be a non-empty array`);
    }

    // Derive the variant name from the base name so the INJECTED labelling survives.
    const scenario = cloneScenario(baseScenario);
    scenario.name = `${baseScenario.name} [${rawVariant.suffix}]`;

    let changeCount = 0;
    rawVariant.perturbations.forEach((rawP, j) => {
      const pWhere = `${where}.perturbations[${j}]`;
      const perturbation = normalizePerturbation(rawP, pWhere);
      const changed = applyPerturbation(scenario, perturbation, pWhere);
      if (changed === 0) {
        throw new ScenarioVariantError(
          `${pWhere} matched no values to perturb (check its target and mint filter)`,
        );
      }
      changeCount += changed;
    });

    // Every produced variant must itself be a valid scenario.
    try {
      validateBacktestScenario(scenario);
    } catch (err) {
      throw new ScenarioVariantError(
        `${where} produced an invalid scenario: ${(err as Error).message}`,
      );
    }

    variants.push({ suffix: rawVariant.suffix, scenario, changeCount });
  });

  return { name: plan.name ?? null, variants };
}
