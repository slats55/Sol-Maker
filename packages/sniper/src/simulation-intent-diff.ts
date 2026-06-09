/**
 * Deterministic, offline, **PAPER-only, INERT** SIMULATION INTENT PLAN DIFF (Phase 6 boundary — DATA).
 *
 * Two inert simulation intent plans (`simulation.intent.plan.v1`) describe the hypothetical intent at two
 * points. This module compares them so an operator can see how the inert plan changed: which hypothetical
 * entries were added / removed / present in both, and which amount labels / unit counts changed.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work; the CLI loads the two plans and
 * hands the parsed values here. Both are STRICTLY validated as inert intent plans (which themselves
 * enforce `executable: false` and unsatisfied approvals). The diff is itself **inert** — comparing two
 * non-executable DATA objects executes, builds, signs, simulates, and sends NOTHING, and carries no chain
 * capability. It carries no wall-clock time, so the same pair yields a byte-identical diff.
 */

import { redactString } from "@soulmaker/security";
import { validateSimulationIntentPlan, type SimulationIntentPlan, type SimulationIntentEntry } from "./simulation-intent.js";

/** Stable schema identifier for the simulation intent plan diff. Bump only on a breaking change. */
export const SIMULATION_INTENT_PLAN_DIFF_SCHEMA_VERSION = "simulation.intent.plan.diff.v1";

/** The banner that prefixes every simulation intent plan diff (required label). */
export const SIMULATION_INTENT_PLAN_DIFF_BANNER = "INERT SIMULATION INTENT PLAN DIFF (PAPER-ONLY, NOT EXECUTABLE)";

/** Required disclaimer statements carried by every simulation intent plan diff (stable order). */
export const SIMULATION_INTENT_PLAN_DIFF_DISCLAIMERS: readonly string[] = [
  "INERT SIMULATION INTENT PLAN DIFF — a deterministic comparison of two inert, NOT-EXECUTABLE simulation intent plans (base vs next).",
  "Comparing two non-executable DATA objects executes, builds, signs, simulates, and sends NOTHING; this diff carries no chain capability.",
  "An added hypothetical entry is a change in inert DATA — NOT an order, NOT a transaction, and NOT Phase 6 authorization; beginning Phase 6 still requires an explicit human decision.",
  "Phase 6 (planning/simulation) and Phase 7 (burner/live) are NOT started.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
];

/** Thrown when intent-plan-diff INPUT or a produced diff is structurally invalid. */
export class SimulationIntentPlanDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationIntentPlanDiffError";
  }
}

// --- model -------------------------------------------------------------------

/** A per-entry amount change over the common set. `from`/`to` are amount labels (+ optional units). */
export interface SimulationIntentAmountChange {
  candidateId: string;
  fromLabel: string;
  toLabel: string;
  fromUnits: number | null;
  toUnits: number | null;
}

/** Metadata echoed for each side of the diff. */
export interface SimulationIntentPlanDiffSide {
  planLabel: string | null;
  sourceLabel: string | null;
  entryCount: number;
}

/** The full, deterministic, JSON-serializable, INERT simulation intent plan diff. */
export interface SimulationIntentPlanDiff {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  /** ALWAYS false — comparing two inert plans is itself inert and non-executable. */
  executable: false;
  base: SimulationIntentPlanDiffSide;
  next: SimulationIntentPlanDiffSide;
  /** Candidate ids of hypothetical entries added in `next`. */
  entriesAdded: string[];
  /** Candidate ids of hypothetical entries removed from `base`. */
  entriesRemoved: string[];
  /** Count of entries present in both. */
  commonCount: number;
  /** Per-common-entry amount label / unit changes. */
  amountChanges: SimulationIntentAmountChange[];
  /** Entry-count delta (next − base). */
  entryCountDelta: number;
  // --- CI flags ---
  hasChange: boolean;
  hasNewEntry: boolean;
  hasRemovedEntry: boolean;
  hasAmountChange: boolean;
  notes: string[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic, INERT {@link SimulationIntentPlanDiff} from two intent plans. Pure and
 * non-mutating. Both inputs are STRICTLY validated as `simulation.intent.plan.v1`. Hypothetical entries
 * are paired by `candidateId`: membership (added / removed / common) and per-common-entry amount label /
 * unit changes are computed VERBATIM. The diff's `executable` flag is always false. Carries no wall-clock
 * time. Throws {@link SimulationIntentPlanDiffError} on a non-plan input.
 */
export function diffSimulationIntentPlans(baseInput: unknown, nextInput: unknown): SimulationIntentPlanDiff {
  let base: SimulationIntentPlan;
  let next: SimulationIntentPlan;
  try {
    base = validateSimulationIntentPlan(baseInput);
  } catch (err) {
    throw new SimulationIntentPlanDiffError(`base intent plan is invalid: ${(err as Error).message}`);
  }
  try {
    next = validateSimulationIntentPlan(nextInput);
  } catch (err) {
    throw new SimulationIntentPlanDiffError(`next intent plan is invalid: ${(err as Error).message}`);
  }

  const baseById = new Map(base.entries.map((e) => [e.candidateId, e]));
  const nextById = new Map(next.entries.map((e) => [e.candidateId, e]));

  const entriesAdded = next.entries.filter((e) => !baseById.has(e.candidateId)).map((e) => e.candidateId);
  const entriesRemoved = base.entries.filter((e) => !nextById.has(e.candidateId)).map((e) => e.candidateId);
  const common = next.entries.filter((e) => baseById.has(e.candidateId));
  const commonCount = common.length;

  const amountChanges: SimulationIntentAmountChange[] = [];
  for (const nextEntry of common) {
    const baseEntry = baseById.get(nextEntry.candidateId) as SimulationIntentEntry;
    if (baseEntry.amountLabel !== nextEntry.amountLabel || baseEntry.amountUnits !== nextEntry.amountUnits) {
      amountChanges.push({
        candidateId: nextEntry.candidateId,
        fromLabel: baseEntry.amountLabel,
        toLabel: nextEntry.amountLabel,
        fromUnits: baseEntry.amountUnits,
        toUnits: nextEntry.amountUnits,
      });
    }
  }

  const hasNewEntry = entriesAdded.length > 0;
  const hasRemovedEntry = entriesRemoved.length > 0;
  const hasAmountChange = amountChanges.length > 0;
  const hasChange = hasNewEntry || hasRemovedEntry || hasAmountChange;

  const notes = [
    `${entriesAdded.length} added, ${entriesRemoved.length} removed, ${commonCount} in both; ${amountChanges.length} amount change(s).`,
    "Comparing two INERT, non-executable plans — this diff executes nothing and is not Phase 6 authorization.",
  ];

  return {
    schemaVersion: SIMULATION_INTENT_PLAN_DIFF_SCHEMA_VERSION,
    banner: SIMULATION_INTENT_PLAN_DIFF_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...SIMULATION_INTENT_PLAN_DIFF_DISCLAIMERS],
    executable: false,
    base: { planLabel: base.planLabel, sourceLabel: base.sourceLabel, entryCount: base.entryCount },
    next: { planLabel: next.planLabel, sourceLabel: next.sourceLabel, entryCount: next.entryCount },
    entriesAdded,
    entriesRemoved,
    commonCount,
    amountChanges,
    entryCountDelta: next.entryCount - base.entryCount,
    hasChange,
    hasNewEntry,
    hasRemovedEntry,
    hasAmountChange,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

function validateSide(value: unknown, where: string): void {
  if (!isObject(value)) throw new SimulationIntentPlanDiffError(`${where} must be an object`);
  for (const f of ["planLabel", "sourceLabel"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new SimulationIntentPlanDiffError(`${where}.${f} must be a string or null`);
    }
  }
  if (typeof value.entryCount !== "number" || !Number.isInteger(value.entryCount) || value.entryCount < 0) {
    throw new SimulationIntentPlanDiffError(`${where}.entryCount must be a non-negative integer`);
  }
}

/**
 * Strictly validate a value as a {@link SimulationIntentPlanDiff} and return it narrowed. A backstop
 * mirroring the package's sibling validators; enforces the HARD invariant `executable === false`. Throws
 * {@link SimulationIntentPlanDiffError} on the first problem. Pure.
 */
export function validateSimulationIntentPlanDiff(value: unknown): SimulationIntentPlanDiff {
  if (!isObject(value)) throw new SimulationIntentPlanDiffError("simulation intent plan diff must be a JSON object");
  if (value.schemaVersion !== SIMULATION_INTENT_PLAN_DIFF_SCHEMA_VERSION) {
    throw new SimulationIntentPlanDiffError(`simulation intent plan diff.schemaVersion must be "${SIMULATION_INTENT_PLAN_DIFF_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SIMULATION_INTENT_PLAN_DIFF_BANNER) {
    throw new SimulationIntentPlanDiffError(`simulation intent plan diff.banner must be "${SIMULATION_INTENT_PLAN_DIFF_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new SimulationIntentPlanDiffError(`simulation intent plan diff.${flag} must be true`);
  }
  if (value.executable !== false) throw new SimulationIntentPlanDiffError("simulation intent plan diff.executable must be false");
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SimulationIntentPlanDiffError("simulation intent plan diff.disclaimers must be a non-empty array");
  }
  validateSide(value.base, "simulation intent plan diff.base");
  validateSide(value.next, "simulation intent plan diff.next");
  for (const key of ["entriesAdded", "entriesRemoved", "notes"] as const) {
    if (!Array.isArray(value[key]) || (value[key] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SimulationIntentPlanDiffError(`simulation intent plan diff.${key} must be an array of strings`);
    }
  }
  if (typeof value.commonCount !== "number" || !Number.isInteger(value.commonCount) || value.commonCount < 0) {
    throw new SimulationIntentPlanDiffError("simulation intent plan diff.commonCount must be a non-negative integer");
  }
  if (typeof value.entryCountDelta !== "number" || !Number.isInteger(value.entryCountDelta)) {
    throw new SimulationIntentPlanDiffError("simulation intent plan diff.entryCountDelta must be an integer");
  }
  for (const f of ["hasChange", "hasNewEntry", "hasRemovedEntry", "hasAmountChange"] as const) {
    if (typeof value[f] !== "boolean") throw new SimulationIntentPlanDiffError(`simulation intent plan diff.${f} must be a boolean`);
  }
  if (!Array.isArray(value.amountChanges)) throw new SimulationIntentPlanDiffError("simulation intent plan diff.amountChanges must be an array");
  (value.amountChanges as unknown[]).forEach((c, i) => {
    const where = `simulation intent plan diff.amountChanges[${i}]`;
    if (!isObject(c) || !nonEmptyString(c.candidateId)) throw new SimulationIntentPlanDiffError(`${where}.candidateId must be a non-empty string`);
    if (!nonEmptyString(c.fromLabel) || !nonEmptyString(c.toLabel)) throw new SimulationIntentPlanDiffError(`${where}.fromLabel/toLabel must be non-empty strings`);
    for (const f of ["fromUnits", "toUnits"] as const) {
      if (c[f] !== null && (typeof c[f] !== "number" || !Number.isFinite(c[f]))) {
        throw new SimulationIntentPlanDiffError(`${where}.${f} must be a finite number or null`);
      }
    }
  });
  return value as unknown as SimulationIntentPlanDiff;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSimulationIntentPlanDiff}. */
export interface FormatSimulationIntentPlanDiffOptions {
  label?: string;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

/**
 * Render a redacted, stable, human-readable simulation intent plan diff. Deterministic and path-stable
 * (no timestamps). Leads with the NOT-EXECUTABLE banner and the membership summary, lists the added /
 * removed entries and the per-entry amount changes, and closes with the CI verdict and the never-executable
 * disclaimers. The whole output is passed through the shared redactor.
 */
export function formatSimulationIntentPlanDiff(diff: SimulationIntentPlanDiff, opts: FormatSimulationIntentPlanDiffOptions = {}): string {
  const header = diff.banner;
  const lines: string[] = [header, "=".repeat(header.length)];
  if (opts.label) lines.push(`label: ${opts.label}`);
  lines.push(`base:  ${diff.base.sourceLabel ?? "(none)"} (${diff.base.entryCount} entr${diff.base.entryCount === 1 ? "y" : "ies"})`);
  lines.push(`next:  ${diff.next.sourceLabel ?? "(none)"} (${diff.next.entryCount} entr${diff.next.entryCount === 1 ? "y" : "ies"})`);
  lines.push(`membership: +${diff.entriesAdded.length} added / -${diff.entriesRemoved.length} removed / ${diff.commonCount} in both`);

  if (diff.entriesAdded.length > 0) lines.push(`  added:   ${diff.entriesAdded.join(", ")}`);
  if (diff.entriesRemoved.length > 0) lines.push(`  removed: ${diff.entriesRemoved.join(", ")}`);

  if (diff.amountChanges.length > 0) {
    lines.push("");
    lines.push("Amount changes:");
    for (const c of diff.amountChanges) {
      const from = `${c.fromLabel}${c.fromUnits !== null ? ` (${c.fromUnits})` : ""}`;
      const to = `${c.toLabel}${c.toUnits !== null ? ` (${c.toUnits})` : ""}`;
      lines.push(`- ${c.candidateId}: ${from} → ${to}`);
    }
  }

  lines.push("");
  lines.push(`entry count delta: ${signed(diff.entryCountDelta)}`);
  lines.push(`Any change:        ${diff.hasChange ? "YES" : "no"}`);
  lines.push(`Any new entry:     ${diff.hasNewEntry ? "YES" : "no"}`);
  lines.push(`Any removed entry: ${diff.hasRemovedEntry ? "YES" : "no"}`);
  lines.push(`Any amount change: ${diff.hasAmountChange ? "YES" : "no"}`);
  lines.push(`executable:        NO (inert data)`);

  lines.push("");
  lines.push("Notes:");
  for (const note of diff.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of diff.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
