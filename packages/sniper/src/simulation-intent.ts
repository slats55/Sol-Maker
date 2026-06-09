/**
 * Deterministic, offline, **PAPER-only, INERT** SIMULATION INTENT PLAN (Phase 6 boundary — DATA ONLY).
 *
 * This is the very first, deliberately *inert* step toward Phase 6, exactly as scoped in
 * `docs/PHASE_6_SIMULATION_BOUNDARY.md`: **type contracts only**. A simulation intent plan is a plain,
 * inert DATA object describing the *hypothetical intent* a future Phase 6 planner would consider for each
 * SIMULATED paper-enter candidate — never an order, never a transaction. It is **not executable**: it
 * holds no destination, no signer, no key, no amount-of-real-funds, and no executable field of any kind.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work, imports NO chain capability, and
 * builds, signs, simulates, and sends NOTHING. Every entry's required operator approvals are
 * **unsatisfied** by construction (`satisfied: false`) and the plan's `executable` flag is **always
 * false** — both are HARD invariants the validator enforces. The "amount" is a LABEL / simulated unit
 * count, never a currency amount. It carries no wall-clock time, so the same decision report yields a
 * byte-identical plan.
 *
 * This module exists so the Phase 6 boundary's data shapes can be reviewed and tested **before** any
 * planner that produces real transaction data is even contemplated — and that planner still requires an
 * explicit human decision, a signer that is structurally separate forever, dry-run-by-default, and the
 * full prerequisite set. Nothing here moves a single step toward sending.
 */

import { redactString } from "@soulmaker/security";
import { validatePaperSniperDecisionReport, type SniperPaperDecisionReport } from "./paper-decision.js";

/** Stable schema identifier for the simulation intent plan. Bump only on a breaking change. */
export const SIMULATION_INTENT_PLAN_SCHEMA_VERSION = "simulation.intent.plan.v1";

/** The banner that prefixes every simulation intent plan (required label). */
export const SIMULATION_INTENT_PLAN_BANNER = "INERT SIMULATION INTENT PLAN (PAPER-ONLY, NOT EXECUTABLE)";

/** Required disclaimer statements carried by every simulation intent plan (stable order). */
export const SIMULATION_INTENT_PLAN_DISCLAIMERS: readonly string[] = [
  "INERT SIMULATION INTENT PLAN — a plain, inert DATA object describing the hypothetical intent a future Phase 6 planner would consider; it is type-contract data only.",
  "NOT EXECUTABLE: it holds no destination, no signer, no key, no amount-of-real-funds, and no executable field; nothing here builds, signs, simulates, or sends anything.",
  "Every required operator approval is UNSATISFIED by construction; `executable` is always false; beginning Phase 6 still requires an explicit human decision and the full prerequisite set.",
  "An `amount` here is a LABEL / simulated unit count — never a currency amount, never real funds.",
  "Phase 6 (planning/simulation) and Phase 7 (burner/live) are NOT started; this module carries no chain capability.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
];

/** Thrown when intent-plan INPUT or a produced plan is structurally invalid. */
export class SimulationIntentPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationIntentPlanError";
  }
}

// --- model -------------------------------------------------------------------

/** The hypothetical side of one inert intent entry. Only a hypothetical entry — never a real order/side. */
export type SimulationIntentSide = "hypothetical-entry";

/** One required operator approval — UNSATISFIED by construction (this inert layer can satisfy none). */
export interface SimulationApproval {
  /** Stable approval id (UPPER_SNAKE). */
  id: string;
  description: string;
  /** ALWAYS false here — no approval is or can be satisfied by this inert data layer. */
  satisfied: false;
}

/** One candidate's inert intent entry. */
export interface SimulationIntentEntry {
  candidateId: string;
  mint: string;
  /** Always `hypothetical-entry` — never a real buy/sell side. */
  side: SimulationIntentSide;
  /** A LABEL for the (simulated) size — never a currency amount. */
  amountLabel: string;
  /** An optional SIMULATED unit count (not currency, not real funds); null when unspecified. */
  amountUnits: number | null;
  /** Why this candidate is in the plan (stable codes, e.g. PAPER_ENTER). */
  reasonCodes: string[];
  /** Constraints a future simulator MUST enforce before this could ever be acted on. */
  riskConstraints: string[];
  /** Required operator approvals — all `satisfied: false`. */
  requiredApprovals: SimulationApproval[];
  /** Future simulation checks a Phase 6 simulator MUST run (none performed here). */
  requiredSimulationChecks: string[];
}

/** The full, deterministic, JSON-serializable, INERT simulation intent plan. */
export interface SimulationIntentPlan {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  /** ALWAYS false — this plan is inert DATA and cannot be executed. */
  executable: false;
  /** ALWAYS true — beginning Phase 6 requires an explicit human decision, never this data. */
  requiresExplicitHumanApproval: true;
  planLabel: string | null;
  sourceLabel: string | null;
  entries: SimulationIntentEntry[];
  entryCount: number;
  /** ALWAYS true — no required approval is satisfied anywhere in the plan. */
  allApprovalsUnsatisfied: true;
  notes: string[];
}

/** Everything {@link buildSimulationIntentPlan} needs. */
export interface BuildSimulationIntentPlanInput {
  /** A canonical `sniper.paper.decision.report.v1` (strictly validated) — the source of paper-enters. */
  decisionReport: unknown;
  /** Optional plan label echoed into the plan. */
  planLabel?: string | null;
  /** Optional amount LABEL applied to every entry (default "unspecified-paper-units"). Never currency. */
  amountLabel?: string | null;
  /** Optional SIMULATED unit count applied to every entry (not currency); null when unspecified. */
  amountUnits?: number | null;
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** The required operator approvals every entry carries — all unsatisfied by construction. */
const REQUIRED_APPROVALS: ReadonlyArray<{ id: string; description: string }> = [
  { id: "OPERATOR_REVIEW", description: "a human operator has reviewed and explicitly approved this intent" },
  { id: "KILL_SWITCH_ARMED", description: "the kill switch is armed and honored by any future planner/signer" },
  { id: "BURNER_ISOLATION_CONFIRMED", description: "a fresh, isolated burner context is confirmed (no main wallet, ever)" },
  { id: "DRY_RUN_SIMULATION_PASSED", description: "a read-only dry-run simulation against a burner/test fixture has passed" },
  { id: "CAPS_VERIFIED", description: "per-trade and daily caps are verified before any action" },
  { id: "PLANNER_SIGNER_SEPARATION_VERIFIED", description: "the planner is structurally incapable of signing or sending" },
];

/** The future simulation checks a Phase 6 simulator must run (none are performed by this inert layer). */
const REQUIRED_SIMULATION_CHECKS: readonly string[] = [
  "read-only dry-run preview against a burner/test fixture (never a main wallet, never sending)",
  "slippage / price-impact bound check",
  "caps verified before any plan could be acted on",
  "planner-signer separation verified (the planner cannot sign or send)",
];

/** The constraints a future simulator must enforce for an entry (constant; enforced by NOTHING here). */
const RISK_CONSTRAINTS: readonly string[] = [
  "advisory risk decision must remain PASS_FOR_PAPER_EVALUATION",
  "no critical or high risk flag may be present",
  "no freeze or mint authority may be present",
  "observed liquidity must clear the operator floor",
];

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic, INERT {@link SimulationIntentPlan} from a paper decision report. Pure and
 * non-mutating. The decision report is STRICTLY validated; one inert entry is produced for each
 * `paper-enter` decision (the only SIMULATED "go" classification). Each entry is type-contract data only:
 * a hypothetical side, an amount LABEL (never currency), reason codes, the constraints a future simulator
 * must enforce, the required operator approvals (all `satisfied: false`), and the future simulation checks
 * a Phase 6 simulator must run. The plan's `executable` flag is always false and
 * `requiresExplicitHumanApproval` always true (HARD invariants). It builds, signs, simulates, and sends
 * NOTHING. Carries no wall-clock time. Throws {@link SimulationIntentPlanError} on invalid input.
 */
export function buildSimulationIntentPlan(input: BuildSimulationIntentPlanInput): SimulationIntentPlan {
  if (!isObject(input)) throw new SimulationIntentPlanError("simulation intent input must be an object");
  let report: SniperPaperDecisionReport;
  try {
    report = validatePaperSniperDecisionReport(input.decisionReport);
  } catch (err) {
    throw new SimulationIntentPlanError(`decision report is invalid: ${(err as Error).message}`);
  }
  for (const f of ["planLabel", "amountLabel"] as const) {
    if (input[f] !== undefined && input[f] !== null && typeof input[f] !== "string") {
      throw new SimulationIntentPlanError(`simulation intent input.${f} must be a string or null when present`);
    }
  }
  if (input.amountUnits !== undefined && input.amountUnits !== null) {
    if (typeof input.amountUnits !== "number" || !Number.isFinite(input.amountUnits) || input.amountUnits < 0) {
      throw new SimulationIntentPlanError("simulation intent input.amountUnits must be a non-negative finite number or null");
    }
  }
  const amountLabel = nonEmptyString(input.amountLabel) ? input.amountLabel : "unspecified-paper-units";
  const amountUnits = typeof input.amountUnits === "number" ? input.amountUnits : null;

  const entries: SimulationIntentEntry[] = report.decisions
    .filter((d) => d.decision === "paper-enter")
    .map((d) => ({
      candidateId: d.candidateId,
      mint: d.mint,
      side: "hypothetical-entry" as const,
      amountLabel,
      amountUnits,
      reasonCodes: ["PAPER_ENTER", "HYPOTHETICAL_ONLY"],
      riskConstraints: [...RISK_CONSTRAINTS],
      requiredApprovals: REQUIRED_APPROVALS.map((a) => ({ id: a.id, description: a.description, satisfied: false as const })),
      requiredSimulationChecks: [...REQUIRED_SIMULATION_CHECKS],
    }));

  const notes = [
    `${entries.length} inert intent entr${entries.length === 1 ? "y" : "ies"} (one per SIMULATED paper-enter); this plan is DATA ONLY and is not executable.`,
    "Every required operator approval is unsatisfied; beginning Phase 6 requires an explicit human decision and the full prerequisite set — this data does not advance it.",
  ];

  return {
    schemaVersion: SIMULATION_INTENT_PLAN_SCHEMA_VERSION,
    banner: SIMULATION_INTENT_PLAN_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...SIMULATION_INTENT_PLAN_DISCLAIMERS],
    executable: false,
    requiresExplicitHumanApproval: true,
    planLabel: nonEmptyString(input.planLabel) ? input.planLabel : null,
    sourceLabel: report.sourceLabel,
    entries,
    entryCount: entries.length,
    allApprovalsUnsatisfied: true,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

function validateEntry(value: unknown, where: string): void {
  if (!isObject(value)) throw new SimulationIntentPlanError(`${where} must be an object`);
  if (!nonEmptyString(value.candidateId)) throw new SimulationIntentPlanError(`${where}.candidateId must be a non-empty string`);
  if (!nonEmptyString(value.mint)) throw new SimulationIntentPlanError(`${where}.mint must be a non-empty string`);
  if (value.side !== "hypothetical-entry") throw new SimulationIntentPlanError(`${where}.side must be "hypothetical-entry"`);
  if (!nonEmptyString(value.amountLabel)) throw new SimulationIntentPlanError(`${where}.amountLabel must be a non-empty string`);
  if (value.amountUnits !== null && (typeof value.amountUnits !== "number" || !Number.isFinite(value.amountUnits) || value.amountUnits < 0)) {
    throw new SimulationIntentPlanError(`${where}.amountUnits must be a non-negative number or null`);
  }
  for (const f of ["reasonCodes", "riskConstraints", "requiredSimulationChecks"] as const) {
    if (!Array.isArray(value[f]) || (value[f] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SimulationIntentPlanError(`${where}.${f} must be an array of strings`);
    }
  }
  if (!Array.isArray(value.requiredApprovals)) throw new SimulationIntentPlanError(`${where}.requiredApprovals must be an array`);
  (value.requiredApprovals as unknown[]).forEach((ap, i) => {
    if (!isObject(ap) || !nonEmptyString(ap.id) || !nonEmptyString(ap.description)) {
      throw new SimulationIntentPlanError(`${where}.requiredApprovals[${i}] must have an id and description`);
    }
    if (ap.satisfied !== false) {
      throw new SimulationIntentPlanError(`${where}.requiredApprovals[${i}].satisfied must be false (inert plan)`);
    }
  });
}

/**
 * Strictly validate a value as a {@link SimulationIntentPlan} and return it narrowed. A backstop mirroring
 * the package's sibling validators; enforces the HARD invariants (`executable === false`,
 * `requiresExplicitHumanApproval === true`, `allApprovalsUnsatisfied === true`, every approval
 * `satisfied === false`). Throws {@link SimulationIntentPlanError} on the first problem. Pure.
 */
export function validateSimulationIntentPlan(value: unknown): SimulationIntentPlan {
  if (!isObject(value)) throw new SimulationIntentPlanError("simulation intent plan must be a JSON object");
  if (value.schemaVersion !== SIMULATION_INTENT_PLAN_SCHEMA_VERSION) {
    throw new SimulationIntentPlanError(`simulation intent plan.schemaVersion must be "${SIMULATION_INTENT_PLAN_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SIMULATION_INTENT_PLAN_BANNER) {
    throw new SimulationIntentPlanError(`simulation intent plan.banner must be "${SIMULATION_INTENT_PLAN_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new SimulationIntentPlanError(`simulation intent plan.${flag} must be true`);
  }
  // HARD invariants — these can never be anything else.
  if (value.executable !== false) throw new SimulationIntentPlanError("simulation intent plan.executable must be false");
  if (value.requiresExplicitHumanApproval !== true) throw new SimulationIntentPlanError("simulation intent plan.requiresExplicitHumanApproval must be true");
  if (value.allApprovalsUnsatisfied !== true) throw new SimulationIntentPlanError("simulation intent plan.allApprovalsUnsatisfied must be true");
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SimulationIntentPlanError("simulation intent plan.disclaimers must be a non-empty array");
  }
  for (const f of ["planLabel", "sourceLabel"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new SimulationIntentPlanError(`simulation intent plan.${f} must be a string or null`);
    }
  }
  if (typeof value.entryCount !== "number" || !Number.isInteger(value.entryCount) || value.entryCount < 0) {
    throw new SimulationIntentPlanError("simulation intent plan.entryCount must be a non-negative integer");
  }
  if (!Array.isArray(value.notes) || (value.notes as unknown[]).some((x) => typeof x !== "string")) {
    throw new SimulationIntentPlanError("simulation intent plan.notes must be an array of strings");
  }
  if (!Array.isArray(value.entries)) throw new SimulationIntentPlanError("simulation intent plan.entries must be an array");
  if ((value.entries as unknown[]).length !== value.entryCount) {
    throw new SimulationIntentPlanError("simulation intent plan.entries length must equal entryCount");
  }
  (value.entries as unknown[]).forEach((e, i) => validateEntry(e, `simulation intent plan.entries[${i}]`));
  return value as unknown as SimulationIntentPlan;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSimulationIntentPlan}. */
export interface FormatSimulationIntentPlanOptions {
  label?: string;
}

/**
 * Render a redacted, stable, human-readable simulation intent plan. Deterministic and path-stable (no
 * timestamps). Leads with the NOT-EXECUTABLE banner, lists each inert entry (hypothetical side, amount
 * label, reason codes, required-but-unsatisfied approvals, and the future simulation checks), and closes
 * with the never-executable disclaimers. The whole output is passed through the shared redactor.
 */
export function formatSimulationIntentPlan(plan: SimulationIntentPlan, opts: FormatSimulationIntentPlanOptions = {}): string {
  const header = plan.banner;
  const lines: string[] = [header, "=".repeat(header.length)];
  if (opts.label) lines.push(`label:   ${opts.label}`);
  lines.push(`plan:    ${plan.planLabel ?? "(unlabeled)"}`);
  lines.push(`source:  ${plan.sourceLabel ?? "(none)"}`);
  lines.push(`entries: ${plan.entryCount} (hypothetical, INERT — executable: NO)`);

  lines.push("");
  lines.push("Entries:");
  if (plan.entries.length === 0) {
    lines.push("- (none — no SIMULATED paper-enter in the source decision report)");
  } else {
    for (const e of plan.entries) {
      lines.push(`- ${e.candidateId}  ${e.mint}  [${e.side}; amount=${e.amountLabel}${e.amountUnits !== null ? ` (${e.amountUnits} sim units)` : ""}]`);
      lines.push(`    reasons: ${e.reasonCodes.join(", ")}`);
      lines.push(`    required approvals (ALL unsatisfied): ${e.requiredApprovals.map((a) => a.id).join(", ")}`);
      lines.push(`    required simulation checks: ${e.requiredSimulationChecks.length}`);
    }
  }

  lines.push("");
  lines.push(`executable:                    NO (inert data)`);
  lines.push(`all approvals unsatisfied:     YES`);
  lines.push(`requires explicit human approval: YES`);

  lines.push("");
  lines.push("Notes:");
  for (const note of plan.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of plan.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
