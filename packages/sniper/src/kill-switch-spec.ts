/**
 * Deterministic, offline **SNIPER KILL-SWITCH SPEC** artifact (Sprint 53 — a Phase-6 prerequisite).
 *
 * This is **NOT a kill switch**. It is a machine-readable LOCAL design/checklist artifact
 * (`sniper.kill_switch.spec.v1`) that writes down — before any real simulation work may begin —
 * exactly what a future kill switch must do: its modes, the operator confirmations it requires, the
 * actions a tripped switch must forbid, and the audit + test requirements it must meet. The Phase-6
 * prerequisite tracker (Sprint 56) consumes this artifact; until it exists and is `adopted`, the
 * kill-switch readiness bucket stays not-met.
 *
 * Hard boundaries:
 *   - It performs NO process control: nothing here stops, starts, signals, or monitors anything.
 *   - It exposes NO live controls: the `stop-live-disabled-placeholder` mode is PERMANENTLY
 *     `placeholder-disabled` in v1 — the validator refuses any other status for it.
 *   - The three modes are FIXED by this module; an operator cannot remove one or add a live one.
 *   - A spec with no required operator confirmation is REFUSED (an unconfirmable switch is unsafe).
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work, and carries no wall-clock
 * time. Spec only — never an order, never a trade control.
 */

import { redactString } from "@soulmaker/security";

/** Stable schema identifier for the kill-switch spec. Bump only on a breaking change. */
export const SNIPER_KILL_SWITCH_SPEC_SCHEMA_VERSION = "sniper.kill_switch.spec.v1";

/** The banner that prefixes every kill-switch spec (required label). */
export const SNIPER_KILL_SWITCH_SPEC_BANNER = "SNIPER KILL-SWITCH SPEC (LOCAL DESIGN ARTIFACT — NOT A LIVE CONTROL)";

/** Required disclaimer statements carried by every kill-switch spec (stable order). */
export const SNIPER_KILL_SWITCH_SPEC_DISCLAIMERS: readonly string[] = [
  "SNIPER KILL-SWITCH SPEC — a machine-readable LOCAL design/checklist artifact describing what a future kill switch must do. It is NOT a kill switch.",
  "It performs NO process control: nothing here stops, starts, signals, or monitors any process, and it exposes no live controls.",
  "The stop-live-disabled-placeholder mode is PERMANENTLY disabled in v1 — Phase 7 (live/burner trading) is not started and cannot be controlled from here.",
  "The Phase-6 prerequisite tracker consumes this artifact; an adopted spec is a PREREQUISITE for future simulation work, never authorization for it.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this artifact.",
];

/** Thrown when kill-switch-spec INPUT or a produced spec is structurally invalid or unsafe. */
export class SniperKillSwitchSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperKillSwitchSpecError";
  }
}

// --- model -------------------------------------------------------------------

/** The fixed kill-switch modes (stable order; an operator cannot remove or extend them in v1). */
export const SNIPER_KILL_SWITCH_MODES = [
  "stop-paper-decisions",
  "stop-simulation",
  "stop-live-disabled-placeholder",
] as const;

/** One of the fixed kill-switch modes. */
export type SniperKillSwitchMode = (typeof SNIPER_KILL_SWITCH_MODES)[number];

/** A mode's spec status: `specified` (designed in this spec) or `placeholder-disabled` (live; permanently off). */
export type SniperKillSwitchModeStatus = "specified" | "placeholder-disabled";

/** One specified kill-switch mode. */
export interface SniperKillSwitchModeSpec {
  mode: SniperKillSwitchMode;
  /** What tripping this mode must halt (descriptive; this artifact halts nothing itself). */
  description: string;
  /** The scope the mode applies to. */
  scope: "paper" | "phase6-simulation-future" | "phase7-live-disabled";
  status: SniperKillSwitchModeStatus;
}

/** The operator-declared adoption status of the spec. */
export type SniperKillSwitchReadiness = "draft" | "reviewed" | "adopted";

/** Everything {@link buildSniperKillSwitchSpec} accepts (operator-friendly raw input; all optional). */
export interface BuildSniperKillSwitchSpecInput {
  /** Operator label (who owns this spec). */
  operatorLabel?: string | null;
  /** Confirmations a future switch must demand before arming/tripping. Empty input is REFUSED. */
  requiredOperatorConfirmations?: string[];
  /** Actions a TRIPPED switch must forbid (merged with the canonical baseline, deduped, sorted). */
  disabledActions?: string[];
  /** Escalation notes (who to alert / what to review when the switch trips). */
  escalationNotes?: string[];
  /** Audit requirements (merged with the canonical baseline). */
  auditRequirements?: string[];
  /** Test requirements (merged with the canonical baseline). */
  testRequirements?: string[];
  /** Operator-declared adoption status (default "draft"). */
  readinessStatus?: SniperKillSwitchReadiness;
}

/** The full, deterministic, JSON-serializable kill-switch spec. */
export interface SniperKillSwitchSpec {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  /** Literal true, validated: this artifact is a SPEC and performs no process control. */
  specOnly: true;
  /** Literal true, validated: nothing here stops/starts/signals/monitors any process. */
  performsNoProcessControl: true;
  disclaimers: string[];
  operatorLabel: string | null;
  modes: SniperKillSwitchModeSpec[];
  requiredOperatorConfirmations: string[];
  disabledActions: string[];
  escalationNotes: string[];
  auditRequirements: string[];
  testRequirements: string[];
  readinessStatus: SniperKillSwitchReadiness;
  /** True iff the operator declared the spec `adopted` — a Phase-6 PREREQUISITE signal, never authorization. */
  adopted: boolean;
  warnings: string[];
  notes: string[];
}

// --- canonical baselines -------------------------------------------------------

/** The canonical confirmations every spec carries (operator additions are merged in). */
export const KILL_SWITCH_BASELINE_CONFIRMATIONS: readonly string[] = [
  "the operator explicitly confirms the session label being halted",
  "the operator explicitly confirms which mode is being tripped",
];

/** The canonical actions a tripped switch must forbid (operator additions are merged in). */
export const KILL_SWITCH_BASELINE_DISABLED_ACTIONS: readonly string[] = [
  "building any new paper decision report",
  "building or diffing any simulation intent plan",
  "any future Phase 6 simulation run",
  "any future live/burner action (already disabled by design)",
];

/** The canonical audit requirements (operator additions are merged in). */
export const KILL_SWITCH_BASELINE_AUDIT_REQUIREMENTS: readonly string[] = [
  "every trip and reset must be recorded in a local audit artifact with the operator label",
  "the tripped mode and the reason must be recorded verbatim",
];

/** The canonical test requirements (operator additions are merged in). */
export const KILL_SWITCH_BASELINE_TEST_REQUIREMENTS: readonly string[] = [
  "a test must prove a tripped switch refuses every disabled action",
  "a test must prove the live placeholder mode cannot be armed",
];

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function mergeList(baseline: readonly string[], extra: unknown, name: string): string[] {
  if (extra === undefined || extra === null) return [...baseline];
  if (!Array.isArray(extra) || extra.some((x) => typeof x !== "string")) {
    throw new SniperKillSwitchSpecError(`kill-switch spec input.${name} must be an array of strings when present`);
  }
  return [...new Set([...baseline, ...(extra as string[]).map((s) => s.trim()).filter((s) => s.length > 0)])].sort();
}

/** The fixed v1 modes (built fresh per spec; descriptions are canonical). */
function fixedModes(): SniperKillSwitchModeSpec[] {
  return [
    {
      mode: "stop-paper-decisions",
      description: "halt all NEW paper decision builds for the session (existing artifacts stay readable)",
      scope: "paper",
      status: "specified",
    },
    {
      mode: "stop-simulation",
      description: "halt any future Phase 6 simulation run before it starts (Phase 6 is not implemented yet — this mode is specified ahead of it)",
      scope: "phase6-simulation-future",
      status: "specified",
    },
    {
      mode: "stop-live-disabled-placeholder",
      description: "PERMANENTLY DISABLED placeholder for a future live halt — Phase 7 is not started and cannot be controlled from here",
      scope: "phase7-live-disabled",
      status: "placeholder-disabled",
    },
  ];
}

const READINESS: ReadonlySet<string> = new Set(["draft", "reviewed", "adopted"]);

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link SniperKillSwitchSpec}. Pure and non-mutating. The three modes are
 * FIXED (the live mode is permanently `placeholder-disabled`); the operator's confirmations /
 * disabled actions / escalation notes / audit + test requirements are merged with the canonical
 * baselines (deduped, sorted). An explicitly-empty confirmations list is REFUSED — a switch nobody
 * must confirm is unsafe. Carries no wall-clock time. Throws {@link SniperKillSwitchSpecError} on
 * invalid input.
 */
export function buildSniperKillSwitchSpec(input: BuildSniperKillSwitchSpecInput = {}): SniperKillSwitchSpec {
  if (!isObject(input)) throw new SniperKillSwitchSpecError("kill-switch spec input must be an object");
  if (input.operatorLabel !== undefined && input.operatorLabel !== null && typeof input.operatorLabel !== "string") {
    throw new SniperKillSwitchSpecError("kill-switch spec input.operatorLabel must be a string or null when present");
  }
  if (input.requiredOperatorConfirmations !== undefined) {
    if (!Array.isArray(input.requiredOperatorConfirmations) || input.requiredOperatorConfirmations.some((x) => typeof x !== "string")) {
      throw new SniperKillSwitchSpecError("kill-switch spec input.requiredOperatorConfirmations must be an array of strings when present");
    }
    if (input.requiredOperatorConfirmations.map((s) => s.trim()).filter((s) => s.length > 0).length === 0) {
      throw new SniperKillSwitchSpecError("a kill switch with NO required operator confirmation is unsafe — refused");
    }
  }
  const readinessRaw: unknown = input.readinessStatus ?? "draft";
  if (typeof readinessRaw !== "string" || !READINESS.has(readinessRaw)) {
    throw new SniperKillSwitchSpecError('kill-switch spec input.readinessStatus must be "draft" | "reviewed" | "adopted"');
  }
  const readinessStatus = readinessRaw as SniperKillSwitchReadiness;

  const requiredOperatorConfirmations = mergeList(
    KILL_SWITCH_BASELINE_CONFIRMATIONS,
    input.requiredOperatorConfirmations,
    "requiredOperatorConfirmations",
  );
  const disabledActions = mergeList(KILL_SWITCH_BASELINE_DISABLED_ACTIONS, input.disabledActions, "disabledActions");
  const escalationNotes = mergeList([], input.escalationNotes, "escalationNotes");
  const auditRequirements = mergeList(KILL_SWITCH_BASELINE_AUDIT_REQUIREMENTS, input.auditRequirements, "auditRequirements");
  const testRequirements = mergeList(KILL_SWITCH_BASELINE_TEST_REQUIREMENTS, input.testRequirements, "testRequirements");

  const warnings: string[] = [];
  if (readinessStatus !== "adopted") {
    warnings.push(`the spec is "${readinessStatus}" — the Phase-6 kill-switch readiness bucket needs an ADOPTED spec.`);
  }
  if (escalationNotes.length === 0) {
    warnings.push("no escalation notes — consider writing down who to alert when the switch trips.");
  }

  return {
    schemaVersion: SNIPER_KILL_SWITCH_SPEC_SCHEMA_VERSION,
    banner: SNIPER_KILL_SWITCH_SPEC_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    specOnly: true,
    performsNoProcessControl: true,
    disclaimers: [...SNIPER_KILL_SWITCH_SPEC_DISCLAIMERS],
    operatorLabel: nonEmptyString(input.operatorLabel) ? input.operatorLabel : null,
    modes: fixedModes(),
    requiredOperatorConfirmations,
    disabledActions,
    escalationNotes,
    auditRequirements,
    testRequirements,
    readinessStatus,
    adopted: readinessStatus === "adopted",
    warnings,
    notes: [
      "This artifact is a SPEC: it controls nothing, halts nothing, and exposes no live behaviour.",
      "The three modes are fixed in v1; the live mode is a permanently-disabled placeholder.",
    ],
  };
}

// --- validation (backstop) ---------------------------------------------------

/**
 * Strictly validate a value as a {@link SniperKillSwitchSpec} and return it narrowed. A backstop
 * mirroring the package's sibling validators — including the literal `specOnly` /
 * `performsNoProcessControl` flags, the EXACT fixed mode set (the live mode must be
 * `placeholder-disabled`; anything else is refused), the non-empty confirmations, and the `adopted`
 * mirror. Throws {@link SniperKillSwitchSpecError} on the first problem. Pure.
 */
export function validateSniperKillSwitchSpec(value: unknown): SniperKillSwitchSpec {
  if (!isObject(value)) throw new SniperKillSwitchSpecError("kill-switch spec must be a JSON object");
  if (value.schemaVersion !== SNIPER_KILL_SWITCH_SPEC_SCHEMA_VERSION) {
    throw new SniperKillSwitchSpecError(`kill-switch spec.schemaVersion must be "${SNIPER_KILL_SWITCH_SPEC_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_KILL_SWITCH_SPEC_BANNER) {
    throw new SniperKillSwitchSpecError(`kill-switch spec.banner must be "${SNIPER_KILL_SWITCH_SPEC_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim", "specOnly", "performsNoProcessControl"] as const) {
    if (value[flag] !== true) throw new SniperKillSwitchSpecError(`kill-switch spec.${flag} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperKillSwitchSpecError("kill-switch spec.disclaimers must be a non-empty array");
  }
  if (value.operatorLabel !== null && typeof value.operatorLabel !== "string") {
    throw new SniperKillSwitchSpecError("kill-switch spec.operatorLabel must be a string or null");
  }
  if (!Array.isArray(value.modes) || value.modes.length !== SNIPER_KILL_SWITCH_MODES.length) {
    throw new SniperKillSwitchSpecError(`kill-switch spec.modes must carry exactly the ${SNIPER_KILL_SWITCH_MODES.length} fixed modes`);
  }
  for (const [i, m] of (value.modes as unknown[]).entries()) {
    const where = `kill-switch spec.modes[${i}]`;
    if (!isObject(m)) throw new SniperKillSwitchSpecError(`${where} must be an object`);
    if (m.mode !== SNIPER_KILL_SWITCH_MODES[i]) {
      throw new SniperKillSwitchSpecError(`${where}.mode must be "${SNIPER_KILL_SWITCH_MODES[i]}" (fixed order)`);
    }
    if (!nonEmptyString(m.description)) throw new SniperKillSwitchSpecError(`${where}.description must be a non-empty string`);
    if (m.mode === "stop-live-disabled-placeholder") {
      if (m.status !== "placeholder-disabled") {
        throw new SniperKillSwitchSpecError(`${where}.status must be "placeholder-disabled" — the live mode is PERMANENTLY disabled in v1`);
      }
      if (m.scope !== "phase7-live-disabled") {
        throw new SniperKillSwitchSpecError(`${where}.scope must be "phase7-live-disabled"`);
      }
    } else if (m.status !== "specified") {
      throw new SniperKillSwitchSpecError(`${where}.status must be "specified"`);
    }
  }
  for (const key of ["requiredOperatorConfirmations", "disabledActions", "escalationNotes", "auditRequirements", "testRequirements", "warnings", "notes"] as const) {
    if (!Array.isArray(value[key]) || (value[key] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperKillSwitchSpecError(`kill-switch spec.${key} must be an array of strings`);
    }
  }
  if ((value.requiredOperatorConfirmations as string[]).length === 0) {
    throw new SniperKillSwitchSpecError("kill-switch spec.requiredOperatorConfirmations must not be empty — an unconfirmable switch is unsafe");
  }
  if ((value.disabledActions as string[]).length === 0) {
    throw new SniperKillSwitchSpecError("kill-switch spec.disabledActions must not be empty");
  }
  for (const key of ["auditRequirements", "testRequirements"] as const) {
    if ((value[key] as string[]).length === 0) {
      throw new SniperKillSwitchSpecError(`kill-switch spec.${key} must not be empty`);
    }
  }
  if (typeof value.readinessStatus !== "string" || !READINESS.has(value.readinessStatus)) {
    throw new SniperKillSwitchSpecError('kill-switch spec.readinessStatus must be "draft" | "reviewed" | "adopted"');
  }
  if (value.adopted !== (value.readinessStatus === "adopted")) {
    throw new SniperKillSwitchSpecError("kill-switch spec.adopted must mirror readinessStatus");
  }
  return value as unknown as SniperKillSwitchSpec;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperKillSwitchSpec}. */
export interface FormatSniperKillSwitchSpecOptions {
  label?: string;
}

/**
 * Render a redacted, stable, human-readable kill-switch spec. Deterministic and path-stable. Leads
 * with the NOT-A-LIVE-CONTROL banner, lists the fixed modes (the live placeholder clearly disabled),
 * the confirmations / disabled actions / audit + test requirements, and closes with the spec-only
 * disclaimers. Passed through the shared redactor.
 */
export function formatSniperKillSwitchSpec(
  spec: SniperKillSwitchSpec,
  opts: FormatSniperKillSwitchSpecOptions = {},
): string {
  const header = `${spec.banner} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];
  if (opts.label) lines.push(`label:    ${opts.label}`);
  lines.push(`operator: ${spec.operatorLabel ?? "(unlabeled)"}`);
  lines.push(`status:   ${spec.readinessStatus}${spec.adopted ? " (adopted — Phase-6 prerequisite signal, NOT authorization)" : ""}`);

  lines.push("");
  lines.push("Modes (fixed; the live mode is permanently disabled):");
  for (const m of spec.modes) {
    lines.push(`- ${m.mode} [${m.status}] (${m.scope})`);
    lines.push(`    ${m.description}`);
  }

  lines.push("");
  lines.push("Required operator confirmations:");
  for (const c of spec.requiredOperatorConfirmations) lines.push(`- ${c}`);

  lines.push("");
  lines.push("Actions a tripped switch must forbid:");
  for (const a of spec.disabledActions) lines.push(`- ${a}`);

  if (spec.escalationNotes.length > 0) {
    lines.push("");
    lines.push("Escalation notes:");
    for (const e of spec.escalationNotes) lines.push(`- ${e}`);
  }

  lines.push("");
  lines.push("Audit requirements:");
  for (const a of spec.auditRequirements) lines.push(`- ${a}`);

  lines.push("");
  lines.push("Test requirements:");
  for (const t of spec.testRequirements) lines.push(`- ${t}`);

  if (spec.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of spec.warnings) lines.push(`- ${w}`);
  }

  lines.push("");
  lines.push("Notes:");
  for (const note of spec.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of spec.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
