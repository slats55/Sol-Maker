/**
 * Deterministic, offline, **PAPER-only** SNIPER WORKFLOW PLAN (Phase 5+ operator helper).
 *
 * The sniper path has three local, offline stages: candidate intake → token preflight → paper
 * decisions. This module is the operator's "where am I / what do I run next" helper. Given which
 * artifacts the operator already has (present? valid?), it produces a deterministic, ordered plan:
 * each stage's status (`done` / `ready` / `blocked` / `todo`), the exact command to run, and the
 * single recommended NEXT command.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work — the CLI checks file existence
 * and light validity, then hands those booleans here. It NEVER executes a stage, runs a live action,
 * signs/sends/builds a transaction, or holds a key; it only describes the recommended sequence. It
 * carries no wall-clock time.
 */

import { redactString } from "@soulmaker/security";

/** Stable schema identifier for the workflow plan. Bump only on a breaking change. */
export const SNIPER_WORKFLOW_PLAN_SCHEMA_VERSION = "sniper.workflow.plan.v1";

/** The banner that prefixes every workflow plan (required label). */
export const SNIPER_WORKFLOW_PLAN_BANNER = "SIMULATED PAPER-ONLY SNIPER WORKFLOW PLAN";

/** Required disclaimer statements carried by every workflow plan (stable order). */
export const SNIPER_WORKFLOW_PLAN_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY SNIPER WORKFLOW PLAN — a deterministic operator guide for the local, offline sniper path (intake → preflight → decide).",
  "It only DESCRIBES the recommended command sequence — it executes no stage, runs no live action, and reaches no network.",
  "Every stage is PAPER-only and offline; a paper-enter decision (a later stage) is a simulated decision, never a live trade.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this plan.",
];

/** Thrown when workflow-plan INPUT or a produced plan is structurally invalid. */
export class SniperWorkflowPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperWorkflowPlanError";
  }
}

// --- input -------------------------------------------------------------------

/** The three stages of the local sniper path, in order. */
export type SniperWorkflowStageName = "candidates" | "preflight" | "decide";

/** The operator's current state for one stage's artifact (checked by the CLI). */
export interface SniperWorkflowStageState {
  /** The path the operator pointed at, or null if none was supplied. */
  path: string | null;
  /** Whether that file exists on disk (false when path is null). */
  present: boolean;
  /** Whether the present file validated as the expected artifact (null when not present / not checked). */
  valid: boolean | null;
  /** Optional short detail (e.g. "12 candidates", "wrong schema"). */
  detail?: string;
}

/** Everything {@link buildSniperWorkflowPlan} needs (per-stage states). */
export interface BuildSniperWorkflowPlanInput {
  candidates?: SniperWorkflowStageState;
  preflight?: SniperWorkflowStageState;
  decide?: SniperWorkflowStageState;
}

// --- plan model --------------------------------------------------------------

/**
 * A stage's status:
 *  - `done`    — the artifact is present and valid.
 *  - `blocked` — a prerequisite stage is not done, OR the artifact is present but invalid.
 *  - `ready`   — the prerequisite is satisfied and this stage can be run now.
 *  - `todo`    — a later, not-yet-actionable stage (prerequisite not done, nothing present).
 */
export type SniperWorkflowStageStatus = "done" | "ready" | "blocked" | "todo";

/** One stage in the plan. */
export interface SniperWorkflowStage {
  stage: SniperWorkflowStageName;
  title: string;
  status: SniperWorkflowStageStatus;
  path: string | null;
  present: boolean;
  valid: boolean | null;
  /** The exact command to run for this stage. */
  command: string;
  /** Concise, deterministic reasons for the status. */
  reasons: string[];
}

/** The full, deterministic, JSON-serializable workflow plan. */
export interface SniperWorkflowPlan {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  stages: SniperWorkflowStage[];
  doneCount: number;
  /** The next stage to act on (first non-done stage), or null when every stage is done. */
  nextStage: SniperWorkflowStageName | null;
  /** The command for {@link nextStage}, or null when complete. */
  nextCommand: string | null;
  /** True iff every stage is done. */
  complete: boolean;
  /** True iff any present artifact is invalid (a blocking integrity problem). */
  hasInvalidArtifact: boolean;
  notes: string[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

const STAGE_TITLES: Record<SniperWorkflowStageName, string> = {
  candidates: "Candidate intake",
  preflight: "Token preflight",
  decide: "Paper decisions",
};

/** The exact command for a stage, echoing the operator's chosen paths where known. */
function commandFor(
  stage: SniperWorkflowStageName,
  states: Record<SniperWorkflowStageName, SniperWorkflowStageState>,
): string {
  const c = states.candidates.path ?? "<candidates.json>";
  const p = states.preflight.path ?? "<preflight.json>";
  const d = states.decide.path ?? "<decision.json>";
  switch (stage) {
    case "candidates":
      return `paper:sniper:candidates:validate --input ${c}`;
    case "preflight":
      return `paper:sniper:preflight --candidates ${c} --inspection <id=inspect.json> --risk <id=risk.json> --out ${p}`;
    case "decide":
      return `paper:sniper:decide --candidates ${c} --preflight ${p} --out ${d}`;
  }
}

function normalizeState(value: unknown, where: string): SniperWorkflowStageState {
  if (value === undefined || value === null) return { path: null, present: false, valid: null };
  if (!isObject(value)) throw new SniperWorkflowPlanError(`${where} must be an object`);
  const path = value.path;
  if (path !== null && !nonEmptyString(path)) {
    throw new SniperWorkflowPlanError(`${where}.path must be a non-empty string or null`);
  }
  const present = value.present;
  if (typeof present !== "boolean") throw new SniperWorkflowPlanError(`${where}.present must be a boolean`);
  const valid = value.valid;
  if (valid !== null && typeof valid !== "boolean") {
    throw new SniperWorkflowPlanError(`${where}.valid must be a boolean or null`);
  }
  const detail = value.detail;
  if (detail !== undefined && typeof detail !== "string") {
    throw new SniperWorkflowPlanError(`${where}.detail must be a string when present`);
  }
  return { path, present, valid, detail };
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link SniperWorkflowPlan} from the operator's per-stage artifact states. Pure
 * and non-mutating. Each stage is `done` (present + valid), `blocked` (a prerequisite is not done, or
 * the present artifact is invalid), `ready` (prerequisite satisfied, runnable now), or `todo` (a later
 * stage not yet actionable). `preflight` and `decide` both require `candidates` to be done first;
 * `decide` treats `preflight` as recommended-but-optional (without it, decisions are conservatively
 * `watch`ed — the plan still marks decide `ready` once candidates are done). Carries no wall-clock
 * time. It describes the sequence only — it never executes a stage.
 */
export function buildSniperWorkflowPlan(input: BuildSniperWorkflowPlanInput): SniperWorkflowPlan {
  if (!isObject(input)) throw new SniperWorkflowPlanError("workflow plan input must be an object");
  const states: Record<SniperWorkflowStageName, SniperWorkflowStageState> = {
    candidates: normalizeState(input.candidates, "candidates"),
    preflight: normalizeState(input.preflight, "preflight"),
    decide: normalizeState(input.decide, "decide"),
  };

  const candidatesDone = states.candidates.present && states.candidates.valid === true;

  const stageStatus = (name: SniperWorkflowStageName): { status: SniperWorkflowStageStatus; reasons: string[] } => {
    const s = states[name];
    const reasons: string[] = [];
    // An invalid present artifact always blocks (fix it before moving on).
    if (s.present && s.valid === false) {
      reasons.push("the present artifact is invalid — fix or regenerate it");
      return { status: "blocked", reasons };
    }
    if (name === "candidates") {
      if (candidatesDone) {
        reasons.push(s.detail ?? "candidate list present and valid");
        return { status: "done", reasons };
      }
      reasons.push(s.present ? "candidate list present but not validated" : "no candidate list yet — author one and validate it");
      return { status: "ready", reasons };
    }
    // preflight / decide both require candidates done first.
    if (!candidatesDone) {
      reasons.push("candidate intake must be done first");
      return { status: "blocked", reasons };
    }
    if (s.present && s.valid === true) {
      reasons.push(s.detail ?? "artifact present and valid");
      return { status: "done", reasons };
    }
    reasons.push(name === "preflight" ? "run the preflight over the validated candidates" : "run the paper decision over the candidates (preflight recommended)");
    return { status: "ready", reasons };
  };

  const order: SniperWorkflowStageName[] = ["candidates", "preflight", "decide"];
  const stages: SniperWorkflowStage[] = order.map((name) => {
    const { status, reasons } = stageStatus(name);
    const s = states[name];
    return {
      stage: name,
      title: STAGE_TITLES[name],
      status,
      path: s.path,
      present: s.present,
      valid: s.valid,
      command: commandFor(name, states),
      reasons,
    };
  });

  const doneCount = stages.filter((s) => s.status === "done").length;
  const complete = doneCount === stages.length;
  const hasInvalidArtifact = order.some((n) => states[n].present && states[n].valid === false);
  // Next = first non-done stage (a blocked stage is still surfaced so the operator knows what to fix).
  const next = stages.find((s) => s.status !== "done") ?? null;
  const nextStage = next ? next.stage : null;
  const nextCommand = next ? next.command : null;

  const notes = [
    `${doneCount}/${stages.length} stage(s) done${complete ? " — workflow complete" : nextStage ? `; next: ${STAGE_TITLES[nextStage]}` : ""}.`,
    "This plan only describes the recommended LOCAL, PAPER-only command sequence — it executes no stage and runs no live action.",
  ];

  return {
    schemaVersion: SNIPER_WORKFLOW_PLAN_SCHEMA_VERSION,
    banner: SNIPER_WORKFLOW_PLAN_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...SNIPER_WORKFLOW_PLAN_DISCLAIMERS],
    stages,
    doneCount,
    nextStage,
    nextCommand,
    complete,
    hasInvalidArtifact,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

const STAGE_NAMES: ReadonlySet<string> = new Set(["candidates", "preflight", "decide"]);
const STAGE_STATUSES: ReadonlySet<string> = new Set(["done", "ready", "blocked", "todo"]);

function validateStage(value: unknown, where: string): void {
  if (!isObject(value)) throw new SniperWorkflowPlanError(`${where} must be an object`);
  if (typeof value.stage !== "string" || !STAGE_NAMES.has(value.stage)) {
    throw new SniperWorkflowPlanError(`${where}.stage must be candidates|preflight|decide`);
  }
  if (typeof value.status !== "string" || !STAGE_STATUSES.has(value.status)) {
    throw new SniperWorkflowPlanError(`${where}.status must be done|ready|blocked|todo`);
  }
  if (!nonEmptyString(value.title) || !nonEmptyString(value.command)) {
    throw new SniperWorkflowPlanError(`${where}.title and .command must be non-empty strings`);
  }
  if (value.path !== null && !nonEmptyString(value.path)) {
    throw new SniperWorkflowPlanError(`${where}.path must be a non-empty string or null`);
  }
  if (typeof value.present !== "boolean") throw new SniperWorkflowPlanError(`${where}.present must be a boolean`);
  if (value.valid !== null && typeof value.valid !== "boolean") {
    throw new SniperWorkflowPlanError(`${where}.valid must be a boolean or null`);
  }
  if (!Array.isArray(value.reasons) || (value.reasons as unknown[]).some((x) => typeof x !== "string")) {
    throw new SniperWorkflowPlanError(`${where}.reasons must be an array of strings`);
  }
}

/**
 * Strictly validate a value as a {@link SniperWorkflowPlan} and return it narrowed. Throws
 * {@link SniperWorkflowPlanError} on the first problem. Pure.
 */
export function validateSniperWorkflowPlan(value: unknown): SniperWorkflowPlan {
  if (!isObject(value)) throw new SniperWorkflowPlanError("workflow plan must be a JSON object");
  if (value.schemaVersion !== SNIPER_WORKFLOW_PLAN_SCHEMA_VERSION) {
    throw new SniperWorkflowPlanError(`workflow plan.schemaVersion must be "${SNIPER_WORKFLOW_PLAN_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_WORKFLOW_PLAN_BANNER) {
    throw new SniperWorkflowPlanError(`workflow plan.banner must be "${SNIPER_WORKFLOW_PLAN_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new SniperWorkflowPlanError(`workflow plan.${flag} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperWorkflowPlanError("workflow plan.disclaimers must be a non-empty array");
  }
  if (typeof value.doneCount !== "number" || !Number.isInteger(value.doneCount) || value.doneCount < 0) {
    throw new SniperWorkflowPlanError("workflow plan.doneCount must be a non-negative integer");
  }
  for (const f of ["complete", "hasInvalidArtifact"] as const) {
    if (typeof value[f] !== "boolean") throw new SniperWorkflowPlanError(`workflow plan.${f} must be a boolean`);
  }
  if (value.nextStage !== null && (typeof value.nextStage !== "string" || !STAGE_NAMES.has(value.nextStage))) {
    throw new SniperWorkflowPlanError("workflow plan.nextStage must be a stage name or null");
  }
  if (value.nextCommand !== null && !nonEmptyString(value.nextCommand)) {
    throw new SniperWorkflowPlanError("workflow plan.nextCommand must be a non-empty string or null");
  }
  if (!Array.isArray(value.notes) || (value.notes as unknown[]).some((x) => typeof x !== "string")) {
    throw new SniperWorkflowPlanError("workflow plan.notes must be an array of strings");
  }
  if (!Array.isArray(value.stages)) throw new SniperWorkflowPlanError("workflow plan.stages must be an array");
  (value.stages as unknown[]).forEach((s, i) => validateStage(s, `workflow plan.stages[${i}]`));
  return value as unknown as SniperWorkflowPlan;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperWorkflowPlan}. */
export interface FormatSniperWorkflowPlanOptions {
  label?: string;
}

const STATUS_MARK: Record<SniperWorkflowStageStatus, string> = {
  done: "✓",
  ready: "▶",
  blocked: "✗",
  todo: "·",
};

/**
 * Render a redacted, stable, human-readable workflow plan. Deterministic and path-stable (no
 * timestamps). Leads with the PAPER-ONLY banner, lists each stage with its status mark + command, and
 * closes with the recommended NEXT command and the not-a-live-action disclaimers. The whole output is
 * passed through the shared redactor.
 */
export function formatSniperWorkflowPlan(plan: SniperWorkflowPlan, opts: FormatSniperWorkflowPlanOptions = {}): string {
  const header = `${plan.banner} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];
  if (opts.label) lines.push(`label: ${opts.label}`);
  lines.push(`progress: ${plan.doneCount}/${plan.stages.length} stage(s) done`);
  lines.push("");
  lines.push("Stages:");
  for (const s of plan.stages) {
    lines.push(`${STATUS_MARK[s.status]} [${s.status}] ${s.title}${s.path ? ` (${s.path})` : ""}`);
    for (const reason of s.reasons) lines.push(`    · ${reason}`);
    lines.push(`    $ soulmaker ${s.command}`);
  }
  lines.push("");
  if (plan.complete) {
    lines.push("Next: workflow complete — every stage is done.");
  } else if (plan.nextCommand) {
    lines.push(`Next: soulmaker ${plan.nextCommand}`);
  }
  lines.push("");
  lines.push("Notes:");
  for (const note of plan.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of plan.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
