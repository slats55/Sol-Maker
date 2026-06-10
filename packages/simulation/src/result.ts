/**
 * Deterministic, offline **SIMULATION RESULT V1** (`simulation.result.v1`, Sprint 65).
 *
 * The honest record of what one simulation pass over a validated `simulation.intent.plan.v2`
 * actually did — which, inside this safety boundary, is deliberately modest:
 *
 *   - A BLOCKED plan (or a stop-simulation switch declared at result time) produces a BLOCKED
 *     result. Nothing is attempted from a blocked chain.
 *   - An entry with ANY unresolved preview field is SKIPPED (`skipped_unresolved`) — nothing is
 *     simulated from invented values, ever.
 *   - Only a fully label-resolved entry is offered to the dry-run adapter, and the package default
 *     adapter honestly reports UNAVAILABLE (a real dry-run needs transaction material this package
 *     is structurally forbidden from building). Whatever an adapter returns or throws is
 *     NORMALIZED to the closed outcome set — there is no "sent"/"signed"/"live" outcome to claim.
 *
 * The result NEVER claims chain inclusion, execution, trade success, or profit/loss. It carries
 * the four literal safety locks; the builder revalidates the plan, validates the adapter contract,
 * and self-validates its own output before returning. Pure: no I/O, no network, no wallet, no
 * wall-clock.
 */

import { redactString } from "@soulmaker/security";
import {
  SIMULATION_PACKAGE_DISCLAIMERS,
  SIMULATION_SAFETY_LITERALS,
  assertSimulationSafetyLiterals,
} from "./safety.js";
import {
  SIMULATION_REASON_CODE_DEFINITIONS,
  dedupeSimulationReasonCodes,
  isSimulationReasonCode,
  type SimulationReasonCode,
} from "./reason-codes.js";
import {
  validateSimulationIntentPlanV2,
  SIMULATION_INTENT_PLAN_V2_SCHEMA_VERSION,
  type SimulationIntentPlanV2,
  type SimulationIntentPlanEntryV2,
} from "./intent-plan.js";
import {
  UNAVAILABLE_DRY_RUN_ADAPTER,
  validateSimulationDryRunAdapter,
  normalizeSimulationDryRunOutcome,
  type SimulationDryRunAdapter,
  type SimulationDryRunRequest,
} from "./adapter.js";

/** Stable schema identifier for the v1 simulation result. Bump only on a breaking change. */
export const SIMULATION_RESULT_V1_SCHEMA_VERSION = "simulation.result.v1";

/** The banner that prefixes every simulation result (required label). */
export const SIMULATION_RESULT_V1_BANNER =
  "SIMULATION RESULT V1 (DRY-RUN-ONLY — NOT AN EXECUTION, NOT A TRADE, NEVER A LIVE ACTION)";

/** The fixed `generatedBy` marker (deterministic provenance; never an operator value). */
export const SIMULATION_RESULT_V1_GENERATED_BY = "@soulmaker/simulation";

/** The fixed simulation mode (the only mode that exists inside this boundary). */
export const SIMULATION_RESULT_V1_MODE = "dry-run-preview";

/** Required disclaimer statements carried by every simulation result (stable order). */
export const SIMULATION_RESULT_V1_DISCLAIMERS: readonly string[] = [
  "SIMULATION RESULT V1 — the honest record of one simulation pass over a validated intent plan; it never claims chain inclusion, execution, trade success, or profit/loss.",
  ...SIMULATION_PACKAGE_DISCLAIMERS,
];

/** Thrown when result INPUT (plan/adapter) or a produced result is structurally invalid. */
export class SimulationResultV1Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationResultV1Error";
  }
}

// --- model -------------------------------------------------------------------

/** Per-entry final statuses (closed set; there is no executed/sent/signed status). */
export const SIMULATION_RESULT_ENTRY_STATUSES = [
  "skipped_unresolved",
  "dry_run_unavailable",
  "dry_run_failed_safely",
  "dry_run_completed_safely",
] as const;

/** One of the per-entry statuses. */
export type SimulationResultEntryStatus = (typeof SIMULATION_RESULT_ENTRY_STATUSES)[number];

/** Result-level statuses (closed set; conservative precedence — see the builder doc). */
export const SIMULATION_RESULT_STATUSES = [
  "blocked",
  "no_entries",
  "skipped_unresolved",
  "dry_run_unavailable",
  "dry_run_failed_safely",
  "dry_run_completed_safely",
] as const;

/** One of the result-level statuses. */
export type SimulationResultStatus = (typeof SIMULATION_RESULT_STATUSES)[number];

/** One entry's result. */
export interface SimulationResultEntryV1 {
  candidateId: string;
  mint: string;
  entryStatus: SimulationResultEntryStatus;
  reasonCodes: SimulationReasonCode[];
  /** Redacted, bounded explanation (skip reason or normalized adapter detail). */
  detail: string;
  /** The unresolved preview fields copied verbatim from the plan entry. */
  unresolvedFields: string[];
}

/** What this result knows about its source plan (verbatim structured fields). */
export interface SimulationResultPlanRef {
  schemaVersion: string;
  planLabel: string | null;
  operatorLabel: string | null;
  blocked: boolean;
  entryCount: number;
}

/** The adapter consulted (or that WOULD have been consulted), embedded verbatim. */
export interface SimulationResultAdapterSummary {
  adapterId: string;
  capabilityStatement: string;
  neverSigns: true;
  neverSends: true;
}

/** The full, deterministic, JSON-serializable simulation result. */
export interface SimulationResultV1 {
  schemaVersion: string;
  banner: string;
  generatedBy: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  // --- the four literal safety locks (validated; can never be anything else) ---
  neverAuthorizesLiveTrading: true;
  neverSigns: true;
  neverSends: true;
  dryRunOnly: true;
  disclaimers: string[];
  simulationMode: string;
  sourcePlanRef: SimulationResultPlanRef;
  adapterSummary: SimulationResultAdapterSummary;
  resultStatus: SimulationResultStatus;
  /** True iff at least one dry-run was actually ATTEMPTED (unavailable is not an attempt). */
  dryRunAttempted: boolean;
  /** The first unavailable detail when nothing could be attempted; null otherwise. */
  dryRunUnavailableReason: string | null;
  blockedReasonCodes: SimulationReasonCode[];
  warningReasonCodes: SimulationReasonCode[];
  outcomeReasonCodes: SimulationReasonCode[];
  entries: SimulationResultEntryV1[];
  entryCount: number;
  skippedCount: number;
  unavailableCount: number;
  failedCount: number;
  completedCount: number;
  notes: string[];
}

/** Everything {@link buildSimulationResultV1} needs. */
export interface BuildSimulationResultV1Input {
  /** A `simulation.intent.plan.v2` — STRICTLY revalidated (an invalid plan refuses; there is no
   * honest result without a valid plan). */
  plan: unknown;
  /** The dry-run adapter (default: the honest UNAVAILABLE adapter). Contract-validated. */
  adapter?: SimulationDryRunAdapter;
  /** Operator-declared stop-simulation kill-switch state AT RESULT TIME (true ⇒ blocked result). */
  stopSimulationTripped?: boolean;
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Map one fully-resolved plan entry through the adapter, normalizing everything. */
function runAdapter(
  adapter: SimulationDryRunAdapter,
  entry: SimulationIntentPlanEntryV2,
): { status: SimulationResultEntryStatus; code: SimulationReasonCode; detail: string } {
  const request: SimulationDryRunRequest = {
    candidateId: entry.candidateId,
    mint: entry.mint,
    intendedActionPreview: "simulated-entry-preview",
    destinationLabel: entry.destinationPreview.label,
    amountLabel: entry.amountPreview.label,
    feeLabel: entry.feePreview.label,
  };
  let outcome;
  try {
    outcome = normalizeSimulationDryRunOutcome(adapter.attemptDryRun(request));
  } catch (err) {
    outcome = {
      kind: "failed-safely" as const,
      detail: `the adapter threw — captured as a safe failure (nothing was signed or sent): ${(err as Error).message}`,
    };
  }
  switch (outcome.kind) {
    case "unavailable":
      return { status: "dry_run_unavailable", code: "simulation-dry-run-unavailable-safe-boundary", detail: outcome.detail };
    case "failed-safely":
      return { status: "dry_run_failed_safely", code: "simulation-dry-run-failed-safely", detail: outcome.detail };
    case "completed-safely":
      return { status: "dry_run_completed_safely", code: "simulation-dry-run-completed-safely", detail: outcome.detail };
  }
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link SimulationResultV1} from a validated plan and a contract-validated
 * adapter. Conservative status precedence: blocked → no_entries → all-skipped → any-failed →
 * any-unavailable → completed. The plan is STRICTLY revalidated and the adapter contract enforced
 * (both refuse with a throw — there is no honest result from an invalid plan or an unsafe
 * adapter); adapter outcomes are normalized so no execution/sent/signed claim can exist. The
 * builder self-validates its own output before returning. Pure.
 */
export function buildSimulationResultV1(input: BuildSimulationResultV1Input): SimulationResultV1 {
  if (!isObject(input)) throw new SimulationResultV1Error("simulation result input must be an object");
  if (input.stopSimulationTripped !== undefined && typeof input.stopSimulationTripped !== "boolean") {
    throw new SimulationResultV1Error("simulation result input.stopSimulationTripped must be a boolean when present");
  }
  let plan: SimulationIntentPlanV2;
  try {
    plan = validateSimulationIntentPlanV2(input.plan);
  } catch (err) {
    throw new SimulationResultV1Error(`the intent plan is invalid — no result can be built from it: ${(err as Error).message}`);
  }
  const adapter = validateSimulationDryRunAdapter(input.adapter ?? UNAVAILABLE_DRY_RUN_ADAPTER);

  const stopTripped = input.stopSimulationTripped === true;
  const blocked = plan.blocked || stopTripped;
  const blockedReasonCodes = dedupeSimulationReasonCodes([
    ...plan.blockingReasonCodes,
    ...(plan.blocked ? (["simulation-dry-run-skipped-blocked-plan"] as SimulationReasonCode[]) : []),
    ...(stopTripped ? (["simulation-blocked-kill-switch-stop"] as SimulationReasonCode[]) : []),
  ]);

  const entries: SimulationResultEntryV1[] = [];
  if (!blocked) {
    for (const e of plan.entries) {
      if (e.unresolvedFields.length > 0) {
        entries.push({
          candidateId: e.candidateId,
          mint: e.mint,
          entryStatus: "skipped_unresolved",
          reasonCodes: ["simulation-dry-run-skipped-unresolved-preview"],
          detail: redactString(
            `skipped: ${e.unresolvedFields.length} unresolved preview field(s) (${e.unresolvedFields.join(", ")}) — nothing is simulated from invented values`,
          ),
          unresolvedFields: [...e.unresolvedFields],
        });
        continue;
      }
      const r = runAdapter(adapter, e);
      entries.push({
        candidateId: e.candidateId,
        mint: e.mint,
        entryStatus: r.status,
        reasonCodes: [r.code],
        detail: redactString(r.detail),
        unresolvedFields: [],
      });
    }
  }

  const skippedCount = entries.filter((e) => e.entryStatus === "skipped_unresolved").length;
  const unavailableCount = entries.filter((e) => e.entryStatus === "dry_run_unavailable").length;
  const failedCount = entries.filter((e) => e.entryStatus === "dry_run_failed_safely").length;
  const completedCount = entries.filter((e) => e.entryStatus === "dry_run_completed_safely").length;
  const dryRunAttempted = failedCount + completedCount > 0;

  let resultStatus: SimulationResultStatus;
  if (blocked) resultStatus = "blocked";
  else if (entries.length === 0) resultStatus = "no_entries";
  else if (skippedCount === entries.length) resultStatus = "skipped_unresolved";
  else if (failedCount > 0) resultStatus = "dry_run_failed_safely";
  else if (unavailableCount > 0) resultStatus = "dry_run_unavailable";
  else resultStatus = "dry_run_completed_safely";

  const firstUnavailable = entries.find((e) => e.entryStatus === "dry_run_unavailable");
  const dryRunUnavailableReason = resultStatus === "dry_run_unavailable" && firstUnavailable ? firstUnavailable.detail : null;

  const warningReasonCodes = dedupeSimulationReasonCodes(entries.flatMap((e) => e.reasonCodes)).filter(
    (c) => SIMULATION_REASON_CODE_DEFINITIONS[c].warning,
  );
  const outcomeReasonCodes = dedupeSimulationReasonCodes([
    ...entries.flatMap((e) => e.reasonCodes).filter((c) => SIMULATION_REASON_CODE_DEFINITIONS[c].severity === "info"),
    "simulation-result-validated",
  ]);

  const notes = blocked
    ? [
        `BLOCKED: ${blockedReasonCodes.length} blocking reason(s) — nothing was attempted from a blocked chain.`,
        "Nothing was signed, nothing was sent, nothing executed — a blocked result is the honest artifact.",
      ]
    : [
        `${entries.length} entr${entries.length === 1 ? "y" : "ies"}: ${skippedCount} skipped (unresolved), ${unavailableCount} unavailable, ${failedCount} failed safely, ${completedCount} completed safely.`,
        "A dry-run completion is a SIMULATION outcome only — never chain inclusion, never execution, never a trade.",
        "Nothing was signed, nothing was sent — the adapter contract has no such outcome to report.",
      ];

  const result: SimulationResultV1 = {
    schemaVersion: SIMULATION_RESULT_V1_SCHEMA_VERSION,
    banner: SIMULATION_RESULT_V1_BANNER,
    generatedBy: SIMULATION_RESULT_V1_GENERATED_BY,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    ...SIMULATION_SAFETY_LITERALS,
    disclaimers: [...SIMULATION_RESULT_V1_DISCLAIMERS],
    simulationMode: SIMULATION_RESULT_V1_MODE,
    sourcePlanRef: {
      schemaVersion: SIMULATION_INTENT_PLAN_V2_SCHEMA_VERSION,
      planLabel: plan.planLabel,
      operatorLabel: plan.operatorLabel,
      blocked: plan.blocked,
      entryCount: plan.entryCount,
    },
    adapterSummary: {
      adapterId: adapter.adapterId,
      capabilityStatement: adapter.capabilityStatement,
      neverSigns: true,
      neverSends: true,
    },
    resultStatus,
    dryRunAttempted,
    dryRunUnavailableReason,
    blockedReasonCodes,
    warningReasonCodes,
    outcomeReasonCodes,
    entries,
    entryCount: entries.length,
    skippedCount,
    unavailableCount,
    failedCount,
    completedCount,
    notes,
  };
  // Self-check: the builder's own output must pass the strict validator (defense in depth).
  return validateSimulationResultV1(result);
}

// --- validation (backstop) ---------------------------------------------------

const ENTRY_STATUS_SET: ReadonlySet<string> = new Set(SIMULATION_RESULT_ENTRY_STATUSES);
const RESULT_STATUS_SET: ReadonlySet<string> = new Set(SIMULATION_RESULT_STATUSES);

function validateEntry(value: unknown, where: string): SimulationResultEntryV1 {
  if (!isObject(value)) throw new SimulationResultV1Error(`${where} must be an object`);
  if (!nonEmptyString(value.candidateId)) throw new SimulationResultV1Error(`${where}.candidateId must be a non-empty string`);
  if (!nonEmptyString(value.mint)) throw new SimulationResultV1Error(`${where}.mint must be a non-empty string`);
  if (typeof value.entryStatus !== "string" || !ENTRY_STATUS_SET.has(value.entryStatus)) {
    throw new SimulationResultV1Error(`${where}.entryStatus must be one of ${SIMULATION_RESULT_ENTRY_STATUSES.join("|")}`);
  }
  if (!Array.isArray(value.reasonCodes) || (value.reasonCodes as unknown[]).some((x) => !isSimulationReasonCode(x))) {
    throw new SimulationResultV1Error(`${where}.reasonCodes must be an array of known simulation reason codes`);
  }
  if (!nonEmptyString(value.detail)) throw new SimulationResultV1Error(`${where}.detail must be a non-empty string`);
  if (!Array.isArray(value.unresolvedFields) || (value.unresolvedFields as unknown[]).some((x) => typeof x !== "string")) {
    throw new SimulationResultV1Error(`${where}.unresolvedFields must be an array of strings`);
  }
  if (value.entryStatus === "skipped_unresolved" && (value.unresolvedFields as string[]).length === 0) {
    throw new SimulationResultV1Error(`${where} is skipped_unresolved but lists no unresolved field`);
  }
  if (value.entryStatus !== "skipped_unresolved" && (value.unresolvedFields as string[]).length > 0) {
    throw new SimulationResultV1Error(`${where} carries unresolved fields but was not skipped — nothing may be simulated from unresolved previews`);
  }
  return value as unknown as SimulationResultEntryV1;
}

/**
 * Strictly validate a value as a {@link SimulationResultV1} and return it narrowed. Enforces the
 * four literal safety locks, the closed status sets, blocked ⇒ zero entries, the recomputed
 * per-status tallies, the conservative result-status precedence, and that no entry simulates from
 * an unresolved preview. Throws {@link SimulationResultV1Error} (or a SimulationSafetyError for a
 * flipped lock) on the first problem. Pure.
 */
export function validateSimulationResultV1(value: unknown): SimulationResultV1 {
  if (!isObject(value)) throw new SimulationResultV1Error("simulation result must be a JSON object");
  if (value.schemaVersion !== SIMULATION_RESULT_V1_SCHEMA_VERSION) {
    throw new SimulationResultV1Error(`simulation result.schemaVersion must be "${SIMULATION_RESULT_V1_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SIMULATION_RESULT_V1_BANNER) {
    throw new SimulationResultV1Error(`simulation result.banner must be "${SIMULATION_RESULT_V1_BANNER}"`);
  }
  if (value.generatedBy !== SIMULATION_RESULT_V1_GENERATED_BY) {
    throw new SimulationResultV1Error(`simulation result.generatedBy must be "${SIMULATION_RESULT_V1_GENERATED_BY}"`);
  }
  if (value.simulationMode !== SIMULATION_RESULT_V1_MODE) {
    throw new SimulationResultV1Error(`simulation result.simulationMode must be "${SIMULATION_RESULT_V1_MODE}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new SimulationResultV1Error(`simulation result.${flag} must be true`);
  }
  assertSimulationSafetyLiterals(value, "simulation result");
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SimulationResultV1Error("simulation result.disclaimers must be a non-empty array");
  }
  if (!isObject(value.sourcePlanRef)) throw new SimulationResultV1Error("simulation result.sourcePlanRef must be an object");
  const ref = value.sourcePlanRef as Record<string, unknown>;
  if (ref.schemaVersion !== SIMULATION_INTENT_PLAN_V2_SCHEMA_VERSION) {
    throw new SimulationResultV1Error(`simulation result.sourcePlanRef.schemaVersion must be "${SIMULATION_INTENT_PLAN_V2_SCHEMA_VERSION}"`);
  }
  for (const f of ["planLabel", "operatorLabel"] as const) {
    if (ref[f] !== null && typeof ref[f] !== "string") {
      throw new SimulationResultV1Error(`simulation result.sourcePlanRef.${f} must be a string or null`);
    }
  }
  if (typeof ref.blocked !== "boolean") throw new SimulationResultV1Error("simulation result.sourcePlanRef.blocked must be a boolean");
  if (typeof ref.entryCount !== "number" || !Number.isInteger(ref.entryCount) || ref.entryCount < 0) {
    throw new SimulationResultV1Error("simulation result.sourcePlanRef.entryCount must be a non-negative integer");
  }
  if (!isObject(value.adapterSummary)) throw new SimulationResultV1Error("simulation result.adapterSummary must be an object");
  const ad = value.adapterSummary as Record<string, unknown>;
  if (!nonEmptyString(ad.adapterId)) throw new SimulationResultV1Error("simulation result.adapterSummary.adapterId must be a non-empty string");
  if (!nonEmptyString(ad.capabilityStatement)) throw new SimulationResultV1Error("simulation result.adapterSummary.capabilityStatement must be a non-empty string");
  if (ad.neverSigns !== true || ad.neverSends !== true) {
    throw new SimulationResultV1Error("simulation result.adapterSummary locks (neverSigns/neverSends) must be literally true");
  }
  if (typeof value.resultStatus !== "string" || !RESULT_STATUS_SET.has(value.resultStatus)) {
    throw new SimulationResultV1Error(`simulation result.resultStatus must be one of ${SIMULATION_RESULT_STATUSES.join("|")}`);
  }
  if (typeof value.dryRunAttempted !== "boolean") throw new SimulationResultV1Error("simulation result.dryRunAttempted must be a boolean");
  if (value.dryRunUnavailableReason !== null && typeof value.dryRunUnavailableReason !== "string") {
    throw new SimulationResultV1Error("simulation result.dryRunUnavailableReason must be a string or null");
  }
  for (const f of ["blockedReasonCodes", "warningReasonCodes", "outcomeReasonCodes"] as const) {
    if (!Array.isArray(value[f]) || (value[f] as unknown[]).some((x) => !isSimulationReasonCode(x))) {
      throw new SimulationResultV1Error(`simulation result.${f} must be an array of known simulation reason codes`);
    }
  }
  if (!Array.isArray(value.entries)) throw new SimulationResultV1Error("simulation result.entries must be an array");
  const entries = (value.entries as unknown[]).map((e, i) => validateEntry(e, `simulation result.entries[${i}]`));
  if (value.entryCount !== entries.length) throw new SimulationResultV1Error("simulation result.entryCount must equal entries length");
  const tallies: ReadonlyArray<readonly [string, SimulationResultEntryStatus]> = [
    ["skippedCount", "skipped_unresolved"],
    ["unavailableCount", "dry_run_unavailable"],
    ["failedCount", "dry_run_failed_safely"],
    ["completedCount", "dry_run_completed_safely"],
  ];
  for (const [field, status] of tallies) {
    const expected = entries.filter((e) => e.entryStatus === status).length;
    if (value[field] !== expected) {
      throw new SimulationResultV1Error(`simulation result.${field} must equal the recomputed tally (${expected})`);
    }
  }
  const blocked = value.resultStatus === "blocked";
  if (blocked) {
    if ((value.blockedReasonCodes as unknown[]).length === 0) {
      throw new SimulationResultV1Error("a blocked simulation result must carry blocking reason codes");
    }
    if (entries.length !== 0) throw new SimulationResultV1Error("a blocked simulation result must carry ZERO entries");
  } else {
    // Recompute the conservative precedence and require an exact match.
    const skipped = entries.filter((e) => e.entryStatus === "skipped_unresolved").length;
    const failed = entries.filter((e) => e.entryStatus === "dry_run_failed_safely").length;
    const unavailable = entries.filter((e) => e.entryStatus === "dry_run_unavailable").length;
    let expected: SimulationResultStatus;
    if (entries.length === 0) expected = "no_entries";
    else if (skipped === entries.length) expected = "skipped_unresolved";
    else if (failed > 0) expected = "dry_run_failed_safely";
    else if (unavailable > 0) expected = "dry_run_unavailable";
    else expected = "dry_run_completed_safely";
    if (value.resultStatus !== expected) {
      throw new SimulationResultV1Error(`simulation result.resultStatus must follow the conservative precedence ("${expected}")`);
    }
  }
  const expectedAttempted = entries.some(
    (e) => e.entryStatus === "dry_run_failed_safely" || e.entryStatus === "dry_run_completed_safely",
  );
  if (value.dryRunAttempted !== expectedAttempted) {
    throw new SimulationResultV1Error("simulation result.dryRunAttempted must mirror the attempted entries (unavailable is not an attempt)");
  }
  if (!Array.isArray(value.notes) || (value.notes as unknown[]).some((x) => typeof x !== "string")) {
    throw new SimulationResultV1Error("simulation result.notes must be an array of strings");
  }
  return value as unknown as SimulationResultV1;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSimulationResultV1}. */
export interface FormatSimulationResultV1Options {
  label?: string;
}

/**
 * Render a redacted, stable, human-readable simulation result. Deterministic and path-stable.
 * Leads with DRY-RUN-ONLY and the result status, shows the source plan and adapter, each entry's
 * outcome with its detail, the blocking/warning reasons, and the next safe operator action — and
 * never phrases anything as an execution or a trade. Passed through the shared redactor.
 */
export function formatSimulationResultV1(result: SimulationResultV1, opts: FormatSimulationResultV1Options = {}): string {
  const header = "SIMULATION RESULT — DRY-RUN-ONLY (not an execution; not a trade; never signs; never sends; never authorizes live trading)";
  const lines: string[] = [header, "=".repeat(header.length)];
  if (opts.label) lines.push(`label:    ${opts.label}`);
  lines.push(`plan:     ${result.sourcePlanRef.planLabel ?? "(unlabeled)"} (${result.sourcePlanRef.entryCount} plan entr${result.sourcePlanRef.entryCount === 1 ? "y" : "ies"})`);
  if (result.sourcePlanRef.operatorLabel) lines.push(`operator: ${result.sourcePlanRef.operatorLabel}`);
  lines.push(`status:   ${result.resultStatus.toUpperCase()}`);
  lines.push(`adapter:  ${result.adapterSummary.adapterId} (never signs; never sends)`);
  lines.push(`dry-run attempted: ${result.dryRunAttempted ? "yes — within the safe boundary only" : "NO"}`);
  if (result.dryRunUnavailableReason) {
    lines.push(`dry-run unavailable: ${result.dryRunUnavailableReason}`);
  }

  lines.push("");
  if (result.resultStatus === "blocked") {
    lines.push("BLOCKING reasons (nothing was attempted from a blocked chain):");
    for (const c of result.blockedReasonCodes) {
      lines.push(`✗ ${c}`);
      lines.push(`    ${SIMULATION_REASON_CODE_DEFINITIONS[c].operatorMessage}`);
    }
  } else {
    lines.push(`Entries (${result.entryCount}): ${result.skippedCount} skipped / ${result.unavailableCount} unavailable / ${result.failedCount} failed safely / ${result.completedCount} completed safely`);
    if (result.entries.length === 0) {
      lines.push("- (none — the plan carried no preview entries)");
    }
    for (const e of result.entries) {
      lines.push(`- ${e.candidateId}  ${e.mint}  [${e.entryStatus}]`);
      lines.push(`    ${e.detail}`);
    }
    if (result.warningReasonCodes.length > 0) {
      lines.push("");
      lines.push("Warnings:");
      for (const c of result.warningReasonCodes) {
        lines.push(`! ${c}`);
        lines.push(`    ${SIMULATION_REASON_CODE_DEFINITIONS[c].operatorMessage}`);
      }
    }
  }

  lines.push("");
  lines.push(`Next safe action: ${result.resultStatus === "blocked"
    ? "resolve the blocking reasons, rebuild the intent plan, then rebuild this result."
    : "review each entry outcome; a completed dry-run is a SIMULATION outcome only and changes nothing about live readiness (Phase 7 remains not started and unauthorized)."}`);

  lines.push("");
  lines.push("Notes:");
  for (const note of result.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of result.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
