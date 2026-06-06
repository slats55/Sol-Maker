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
import { digestContent } from "./digest.js";
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

// --- variant plan EXPLAIN (dry-run inspection) -------------------------------

/** Stable schema id for a variant-plan explanation. Bump only on a breaking change. */
export const BACKTEST_VARIANT_PLAN_EXPLAIN_SCHEMA_VERSION = "backtest.variant-plan.explain.v1";

/** The banner that prefixes every variant-plan explanation (required label). */
export const BACKTEST_VARIANT_PLAN_EXPLAIN_BANNER = "SIMULATED PAPER-ONLY VARIANT PLAN (DRY RUN)";

/** Required disclaimers carried by every variant-plan explanation (stable order). */
export const BACKTEST_VARIANT_PLAN_EXPLAIN_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY VARIANT PLAN (DRY RUN) — explains a plan without generating or running anything.",
  "Reads injected, simulated local scenario data only.",
  "Writes nothing, generates no variant files, and runs no backtest.",
  "Not a live result.",
  "Not financial advice.",
  "Not a profitability claim.",
  "A matched-value count is how many injected numbers a perturbation WOULD change, not a result.",
];

/**
 * One perturbation, explained: its normalized target/op/value/bounds/mint filter and
 * how many injected values it WOULD change against the base (a dry-run count). Bounds
 * are `number | null` (null = no clamp) so the JSON stays finite and stable.
 */
export interface PerturbationExplanation {
  /** Position within the variant's `perturbations` array. */
  index: number;
  /** Normalized target string: `"price"` or `"metric.<field>"`. */
  target: string;
  /** Normalized target kind. */
  targetKind: NormalizedTarget["kind"];
  op: PerturbationOp;
  value: number;
  /** Explicit lower clamp, or null when unbounded. */
  min: number | null;
  /** Explicit upper clamp, or null when unbounded. */
  max: number | null;
  /** Mint filter, or null when the perturbation applies to every matching value. */
  mint: string | null;
  /** How many injected values this perturbation would change against the base (dry run). */
  matchedValueCount: number;
  /** True when `matchedValueCount === 0` — generation would REFUSE this perturbation. */
  matchesNothing: boolean;
}

/** One variant, explained: its derived name, its perturbations, and its dry-run validity. */
export interface VariantExplanation {
  /** Plan order (0-based). */
  index: number;
  suffix: string;
  /** Variant name derived from the base name + suffix (never user-editable). */
  variantName: string;
  perturbations: PerturbationExplanation[];
  /** Sum of `matchedValueCount` across this variant's perturbations. */
  totalMatchedValueCount: number;
  /** False when any perturbation matches nothing (generation would refuse it). */
  valid: boolean;
  /** Human, redaction-safe refusal reasons for this variant (stable order). */
  refusals: string[];
}

/**
 * The full, deterministic, byte-stable explanation of a variant plan applied to a
 * base scenario — a DRY RUN that writes nothing and runs no backtest. It carries the
 * required PAPER-ONLY / not-a-live-result / not-advice / not-a-profit language. It is
 * a description of what generation WOULD do, never a result.
 */
export interface ScenarioVariantPlanExplanation {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  dryRun: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  planName: string | null;
  /** The validated base scenario name (always present for a valid base). */
  baseScenarioName: string;
  /** Content digest of the validated base scenario (matches what a real run reports). */
  baseScenarioDigest: string;
  variantCount: number;
  totalPerturbationCount: number;
  /** Total injected values all perturbations would change across every variant. */
  totalMatchedValueCount: number;
  variants: VariantExplanation[];
  /** Overall validity: true iff every perturbation matches at least one value. */
  valid: boolean;
  /** Aggregate refusal reasons (prefixed by variant suffix), stable order. */
  refusals: string[];
  notes: string[];
}

/** Stable string form of a normalized target for the explanation. */
function describeTarget(target: NormalizedTarget): string {
  if (target.kind === "price") return "price";
  return `${METRIC_PREFIX}${target.field}`;
}

/**
 * Explain a variant plan applied to a base scenario WITHOUT generating files or
 * running a backtest. Validates the base and the plan with the SAME rules as
 * {@link generateScenarioVariants} (an invalid base, plan, suffix, key, target, op,
 * value, bounds, mint, or a non-finite result all throw {@link ScenarioVariantError}),
 * but instead of refusing a perturbation that matches no values, it REPORTS it
 * (`matchesNothing: true`, `valid: false` for that variant and overall) so the whole
 * plan can be inspected at once. Pure, deterministic, and non-mutating — the dry-run
 * counts are computed against a throwaway deep copy; `base`/`plan` are never touched.
 */
export function explainScenarioVariantPlan(
  base: unknown,
  plan: unknown,
): ScenarioVariantPlanExplanation {
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
  const variants: VariantExplanation[] = [];
  const refusals: string[] = [];
  let totalPerturbationCount = 0;
  let totalMatchedValueCount = 0;

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

    // A throwaway working copy: perturbations are applied IN SEQUENCE to it exactly as
    // generation would, so each matched count reflects the prior perturbations' effects.
    // It is never returned, validated, or written — `base`/`plan` are never mutated.
    const working = cloneScenario(baseScenario);
    const perturbations: PerturbationExplanation[] = [];
    const variantRefusals: string[] = [];
    let variantMatched = 0;

    rawVariant.perturbations.forEach((rawP, j) => {
      const pWhere = `${where}.perturbations[${j}]`;
      const norm = normalizePerturbation(rawP, pWhere);
      const matched = applyPerturbation(working, norm, pWhere);
      const matchesNothing = matched === 0;
      if (matchesNothing) {
        variantRefusals.push(
          `perturbations[${j}] matched no values to perturb (check its target and mint filter)`,
        );
      }
      perturbations.push({
        index: j,
        target: describeTarget(norm.target),
        targetKind: norm.target.kind,
        op: norm.op,
        value: norm.value,
        min: norm.min === -Infinity ? null : norm.min,
        max: norm.max === Infinity ? null : norm.max,
        mint: norm.mint ?? null,
        matchedValueCount: matched,
        matchesNothing,
      });
      variantMatched += matched;
    });

    totalPerturbationCount += perturbations.length;
    totalMatchedValueCount += variantMatched;
    for (const r of variantRefusals) refusals.push(`[${rawVariant.suffix}] ${r}`);

    variants.push({
      index: i,
      suffix: rawVariant.suffix,
      variantName: `${baseScenario.name} [${rawVariant.suffix}]`,
      perturbations,
      totalMatchedValueCount: variantMatched,
      valid: variantRefusals.length === 0,
      refusals: variantRefusals,
    });
  });

  const valid = refusals.length === 0;
  const notes = [
    `${variants.length} variant(s), ${totalPerturbationCount} perturbation(s); ` +
      `${totalMatchedValueCount} injected value(s) would change.`,
    "DRY RUN — no variant files were generated, no backtest was run, and nothing was written.",
    valid
      ? "Every perturbation matches at least one injected value; paper:backtest:scenario:variants would generate these."
      : "At least one perturbation matches no values — generation would REFUSE it (fix the target or mint filter).",
  ];

  return {
    schemaVersion: BACKTEST_VARIANT_PLAN_EXPLAIN_SCHEMA_VERSION,
    banner: BACKTEST_VARIANT_PLAN_EXPLAIN_BANNER,
    paperOnly: true,
    simulated: true,
    dryRun: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...BACKTEST_VARIANT_PLAN_EXPLAIN_DISCLAIMERS],
    planName: plan.name ?? null,
    baseScenarioName: baseScenario.name,
    baseScenarioDigest: digestContent(baseScenario),
    variantCount: variants.length,
    totalPerturbationCount,
    totalMatchedValueCount,
    variants,
    valid,
    refusals,
    notes,
  };
}

// --- explanation validation (backstop) ---------------------------------------

function isPerturbationExplanation(value: unknown): value is PerturbationExplanation {
  return (
    isObject(value) &&
    nonEmptyString(value.target) &&
    (value.targetKind === "price" || value.targetKind === "metric" || value.targetKind === "config") &&
    typeof value.op === "string" &&
    typeof value.value === "number" &&
    (value.min === null || typeof value.min === "number") &&
    (value.max === null || typeof value.max === "number") &&
    (value.mint === null || typeof value.mint === "string") &&
    typeof value.matchedValueCount === "number" &&
    typeof value.matchesNothing === "boolean"
  );
}

/**
 * Strictly validate a value as a {@link ScenarioVariantPlanExplanation} and return it
 * narrowed. Mirrors the other backtest validators: checks the schema version, the
 * required PAPER-ONLY / dry-run labelling, the disclaimers, and the variant +
 * perturbation shapes. Throws {@link ScenarioVariantError} on the first problem. Pure.
 */
export function validateScenarioVariantPlanExplanation(
  value: unknown,
): ScenarioVariantPlanExplanation {
  if (!isObject(value)) {
    throw new ScenarioVariantError("explanation must be a JSON object");
  }
  if (value.schemaVersion !== BACKTEST_VARIANT_PLAN_EXPLAIN_SCHEMA_VERSION) {
    throw new ScenarioVariantError(
      `explanation.schemaVersion must be "${BACKTEST_VARIANT_PLAN_EXPLAIN_SCHEMA_VERSION}"`,
    );
  }
  if (value.banner !== BACKTEST_VARIANT_PLAN_EXPLAIN_BANNER) {
    throw new ScenarioVariantError(`explanation.banner must be "${BACKTEST_VARIANT_PLAN_EXPLAIN_BANNER}"`);
  }
  for (const flag of [
    "paperOnly",
    "simulated",
    "dryRun",
    "notLiveResult",
    "notFinancialAdvice",
    "notProfitabilityClaim",
  ] as const) {
    if (value[flag] !== true) {
      throw new ScenarioVariantError(`explanation.${flag} must be true`);
    }
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new ScenarioVariantError("explanation.disclaimers must be a non-empty array");
  }
  if (typeof value.valid !== "boolean") {
    throw new ScenarioVariantError("explanation.valid must be a boolean");
  }
  if (!Array.isArray(value.variants)) {
    throw new ScenarioVariantError("explanation.variants must be an array");
  }
  value.variants.forEach((v, i) => {
    if (!isObject(v)) {
      throw new ScenarioVariantError(`explanation.variants[${i}] must be an object`);
    }
    if (!nonEmptyString(v.suffix)) {
      throw new ScenarioVariantError(`explanation.variants[${i}].suffix must be a non-empty string`);
    }
    if (typeof v.valid !== "boolean") {
      throw new ScenarioVariantError(`explanation.variants[${i}].valid must be a boolean`);
    }
    if (!Array.isArray(v.perturbations)) {
      throw new ScenarioVariantError(`explanation.variants[${i}].perturbations must be an array`);
    }
    v.perturbations.forEach((p, j) => {
      if (!isPerturbationExplanation(p)) {
        throw new ScenarioVariantError(`explanation.variants[${i}].perturbations[${j}] is malformed`);
      }
    });
  });
  return value as unknown as ScenarioVariantPlanExplanation;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatScenarioVariantPlanExplanation}. */
export interface FormatScenarioVariantPlanExplanationOptions {
  /** Optional label (e.g. the base file path) echoed into the header. */
  baseLabel?: string;
  /** Optional label (e.g. the plan file path) echoed into the header. */
  planLabel?: string;
}

/** Render one bound for the human output ("none" when unbounded). */
function boundStr(value: number | null): string {
  return value === null ? "none" : String(value);
}

/**
 * Render a stable, human-readable variant-plan explanation. Deterministic and
 * path-stable (no timestamps). Leads with the PAPER-ONLY / DRY RUN banner and closes
 * with the not-live / not-advice / not-a-profitability-claim disclaimers so it can
 * never be mistaken for a live result or a generated artifact.
 */
export function formatScenarioVariantPlanExplanation(
  explanation: ScenarioVariantPlanExplanation,
  opts: FormatScenarioVariantPlanExplanationOptions = {},
): string {
  const title = explanation.planName ?? "variant plan";
  const header = `${explanation.banner} — ${title} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];

  if (opts.baseLabel) lines.push(`base:        ${opts.baseLabel}`);
  if (opts.planLabel) lines.push(`plan file:   ${opts.planLabel}`);
  lines.push(`base name:   ${explanation.baseScenarioName}`);
  lines.push(`base digest: ${explanation.baseScenarioDigest}`);
  lines.push(`plan:        ${explanation.planName ?? "(unnamed)"}`);
  lines.push(
    `variants:    ${explanation.variantCount} ` +
      `(${explanation.totalPerturbationCount} perturbation(s), ` +
      `${explanation.totalMatchedValueCount} injected value(s) would change)`,
  );
  lines.push(`valid:       ${explanation.valid ? "yes" : "NO — see refusals below"}`);

  for (const v of explanation.variants) {
    lines.push("");
    lines.push(
      `- ${v.suffix} → "${v.variantName}" ` +
        `[${v.valid ? "VALID" : "REFUSED"}, ${v.totalMatchedValueCount} value(s) would change]`,
    );
    v.perturbations.forEach((p) => {
      const mint = p.mint ? `, mint ${p.mint}` : "";
      const matched = p.matchesNothing ? "MATCHES NOTHING" : `${p.matchedValueCount} value(s)`;
      lines.push(
        `    • [${p.index}] ${p.target} ${p.op} ${p.value} ` +
          `(min ${boundStr(p.min)}, max ${boundStr(p.max)}${mint}) → ${matched}`,
      );
    });
  }

  if (!explanation.valid) {
    lines.push("");
    lines.push("Refusals:");
    for (const r of explanation.refusals) lines.push(`- ${r}`);
  }

  lines.push("");
  lines.push("Notes:");
  for (const note of explanation.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of explanation.disclaimers) lines.push(d);
  return lines.join("\n");
}
