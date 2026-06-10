/**
 * Deterministic, offline **SNIPER BURNER ISOLATION SPEC** artifact (Sprint 55 — a Phase-6/7
 * prerequisite).
 *
 * This is **NOT a wallet**. It creates no wallet, imports no wallet, holds no key, and never will —
 * it is a machine-readable LOCAL design/checklist artifact (`sniper.burner.isolation.spec.v1`) that
 * writes down, before any future live/burner design may even be drafted, the isolation rules that
 * design must obey. The Phase-6 prerequisite tracker (Sprint 56) consumes this artifact; until it
 * exists and is `adopted`, the burner-isolation readiness bucket stays not-met.
 *
 * Core principles, as LITERALS that must be true (the validator refuses a weakened spec):
 *   - `burnerOnlyPrinciple`            — any future live work uses an ISOLATED burner, nothing else.
 *   - `mainWalletExcluded`             — the operator's main wallet is permanently out of scope.
 *   - `requireSimulationBeforeAnySend` — any FUTURE send must be preceded by a successful simulation.
 *   - `requireRedactedLogging`         — every log path around a burner is redacted.
 *   - `requireExplicitOptIn`           — any future live capability needs an explicit dangerous opt-in.
 *   - `requireOperatorApproval`        — a human approves every escalation; never a machine.
 *   - `createsNoWallet`                — THIS artifact creates/imports no wallet and holds no key.
 *
 * Loss bounds are **LABELS only** (`maxLossLabel`, e.g. "tiny-test-budget") — never a currency
 * amount, a balance, or a profitability claim. The kill-switch spec is referenced by LABEL
 * (`killSwitchSpecRef`) so the two specs can be paired by the prerequisite tracker.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work, and carries no wall-clock
 * time. Spec only — it grants nothing and enables nothing.
 */

import { redactString } from "@soulmaker/security";

/** Stable schema identifier for the burner isolation spec. Bump only on a breaking change. */
export const SNIPER_BURNER_ISOLATION_SPEC_SCHEMA_VERSION = "sniper.burner.isolation.spec.v1";

/** The banner that prefixes every burner isolation spec (required label). */
export const SNIPER_BURNER_ISOLATION_SPEC_BANNER =
  "SNIPER BURNER ISOLATION SPEC (LOCAL DESIGN ARTIFACT — NOT A WALLET, CREATES NO WALLET)";

/** Required disclaimer statements carried by every burner isolation spec (stable order). */
export const SNIPER_BURNER_ISOLATION_SPEC_DISCLAIMERS: readonly string[] = [
  "SNIPER BURNER ISOLATION SPEC — a machine-readable LOCAL design/checklist artifact for FUTURE burner isolation. It is NOT a wallet: it creates no wallet, imports no wallet, and holds no key.",
  "The core principles are literals that must be true; a spec where any was weakened is REFUSED by the validator.",
  "Loss bounds are LABELS only — never a currency amount, a balance, or a profitability claim.",
  "An adopted spec is a Phase-6/7 PREREQUISITE — it is never authorization for live or burner work, which remain not started.",
  "Phase 7 (live/burner trading) is NOT started and cannot be enabled from here.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this artifact.",
];

/** Thrown when burner-isolation-spec INPUT or a produced spec is structurally invalid or unsafe. */
export class SniperBurnerIsolationSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperBurnerIsolationSpecError";
  }
}

// --- model -------------------------------------------------------------------

/** The operator-declared adoption status of the spec. */
export type SniperBurnerIsolationReadiness = "draft" | "reviewed" | "adopted";

/** Everything {@link buildSniperBurnerIsolationSpec} accepts (operator-friendly raw input; all
 * optional). The core principles are NOT inputs — they are constants that cannot be configured off. */
export interface BuildSniperBurnerIsolationSpecInput {
  /** Operator label (who owns this spec). */
  operatorLabel?: string | null;
  /** A loss-bound LABEL (e.g. "tiny-test-budget"). NEVER a currency amount — digits are refused. */
  maxLossLabel?: string | null;
  /** Future cap requirements a burner design must satisfy (merged with the canonical baseline). */
  futureCapRequirements?: string[];
  /** Operator approval requirements (merged with the canonical baseline). */
  operatorApprovalRequirements?: string[];
  /** The LABEL of the paired kill-switch spec (e.g. its operator label or file label). */
  killSwitchSpecRef?: string | null;
  /** Operator-declared adoption status (default "draft"). */
  readinessStatus?: SniperBurnerIsolationReadiness;
}

/** The full, deterministic, JSON-serializable burner isolation spec. */
export interface SniperBurnerIsolationSpec {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  // --- core principles: literals that must be true (validated) ---
  burnerOnlyPrinciple: true;
  mainWalletExcluded: true;
  requireSimulationBeforeAnySend: true;
  requireRedactedLogging: true;
  requireExplicitOptIn: true;
  requireOperatorApproval: true;
  /** Literal true, validated: THIS artifact creates/imports no wallet and holds no key. */
  createsNoWallet: true;
  disclaimers: string[];
  operatorLabel: string | null;
  /** A loss-bound LABEL only (never a currency amount; digits refused at build time). */
  maxLossLabel: string | null;
  /** The canonical baseline cap requirements plus the operator's additions (deduped, sorted). */
  futureCapRequirements: string[];
  /** The canonical baseline approval requirements plus the operator's additions (deduped, sorted). */
  operatorApprovalRequirements: string[];
  /** The LABEL of the paired kill-switch spec (null until one is paired). */
  killSwitchSpecRef: string | null;
  readinessStatus: SniperBurnerIsolationReadiness;
  /** True iff the operator declared the spec `adopted` — a prerequisite signal, never authorization. */
  adopted: boolean;
  warnings: string[];
  notes: string[];
}

// --- canonical baselines -------------------------------------------------------

/** The canonical cap requirements every spec carries (operator additions are merged in). */
export const BURNER_ISOLATION_BASELINE_CAP_REQUIREMENTS: readonly string[] = [
  "any future burner must carry an explicit, operator-set loss bound BEFORE it is funded",
  "any future burner cap must be enforced by reviewed code, never by operator discipline alone",
  "a future burner that reaches its loss bound must stop — no automatic refill, no cap raise mid-session",
];

/** The canonical operator approval requirements (operator additions are merged in). */
export const BURNER_ISOLATION_BASELINE_APPROVALS: readonly string[] = [
  "a human operator explicitly approves creating any future burner (never a machine)",
  "a human operator explicitly approves every escalation of a future burner's scope",
  "the explicit dangerous opt-in for any live capability must be re-confirmed per session, never persisted as a default",
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
    throw new SniperBurnerIsolationSpecError(`burner isolation spec input.${name} must be an array of strings when present`);
  }
  return [...new Set([...baseline, ...(extra as string[]).map((s) => s.trim()).filter((s) => s.length > 0)])].sort();
}

/** A loss-bound label must be a LABEL: digits and currency markers are refused (no amount claims). */
function checkLossLabel(value: string, where: string): void {
  if (/[0-9]/.test(value) || /[$€£¥]|\bsol\b|\busd\b|\busdc\b|\blamports?\b/i.test(value)) {
    throw new SniperBurnerIsolationSpecError(
      `${where} must be a pure LABEL (e.g. "tiny-test-budget") — digits/currency markers are refused so the spec can never carry an amount claim`,
    );
  }
}

const READINESS: ReadonlySet<string> = new Set(["draft", "reviewed", "adopted"]);

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link SniperBurnerIsolationSpec}. Pure and non-mutating. The core
 * principles are constants — they are not inputs and cannot be configured off. `maxLossLabel` is
 * validated as a pure LABEL (digits/currency markers refused, so the spec can never carry an amount
 * claim). The operator's cap/approval requirements are merged with the canonical baselines (deduped,
 * sorted). Carries no wall-clock time. Throws {@link SniperBurnerIsolationSpecError} on invalid input.
 */
export function buildSniperBurnerIsolationSpec(
  input: BuildSniperBurnerIsolationSpecInput = {},
): SniperBurnerIsolationSpec {
  if (!isObject(input)) throw new SniperBurnerIsolationSpecError("burner isolation spec input must be an object");
  for (const f of ["operatorLabel", "maxLossLabel", "killSwitchSpecRef"] as const) {
    if (input[f] !== undefined && input[f] !== null && typeof input[f] !== "string") {
      throw new SniperBurnerIsolationSpecError(`burner isolation spec input.${f} must be a string or null when present`);
    }
  }
  const maxLossLabel = nonEmptyString(input.maxLossLabel) ? input.maxLossLabel.trim() : null;
  if (maxLossLabel !== null) checkLossLabel(maxLossLabel, "burner isolation spec input.maxLossLabel");

  const readinessRaw: unknown = input.readinessStatus ?? "draft";
  if (typeof readinessRaw !== "string" || !READINESS.has(readinessRaw)) {
    throw new SniperBurnerIsolationSpecError('burner isolation spec input.readinessStatus must be "draft" | "reviewed" | "adopted"');
  }
  const readinessStatus = readinessRaw as SniperBurnerIsolationReadiness;

  const futureCapRequirements = mergeList(BURNER_ISOLATION_BASELINE_CAP_REQUIREMENTS, input.futureCapRequirements, "futureCapRequirements");
  const operatorApprovalRequirements = mergeList(BURNER_ISOLATION_BASELINE_APPROVALS, input.operatorApprovalRequirements, "operatorApprovalRequirements");

  const killSwitchSpecRef = nonEmptyString(input.killSwitchSpecRef) ? input.killSwitchSpecRef.trim() : null;

  const warnings: string[] = [];
  if (readinessStatus !== "adopted") {
    warnings.push(`the spec is "${readinessStatus}" — the Phase-6 burner-isolation readiness bucket needs an ADOPTED spec.`);
  }
  if (killSwitchSpecRef === null) {
    warnings.push("no kill-switch spec reference — pair this spec with an adopted sniper.kill_switch.spec.v1 (killSwitchSpecRef).");
  }
  if (maxLossLabel === null) {
    warnings.push("no maxLossLabel — name the loss bound (a LABEL, never an amount) a future burner design must respect.");
  }

  return {
    schemaVersion: SNIPER_BURNER_ISOLATION_SPEC_SCHEMA_VERSION,
    banner: SNIPER_BURNER_ISOLATION_SPEC_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    burnerOnlyPrinciple: true,
    mainWalletExcluded: true,
    requireSimulationBeforeAnySend: true,
    requireRedactedLogging: true,
    requireExplicitOptIn: true,
    requireOperatorApproval: true,
    createsNoWallet: true,
    disclaimers: [...SNIPER_BURNER_ISOLATION_SPEC_DISCLAIMERS],
    operatorLabel: nonEmptyString(input.operatorLabel) ? input.operatorLabel : null,
    maxLossLabel,
    futureCapRequirements,
    operatorApprovalRequirements,
    killSwitchSpecRef,
    readinessStatus,
    adopted: readinessStatus === "adopted",
    warnings,
    notes: [
      "The core principles are constants of this artifact — they are not inputs and cannot be configured off.",
      "This artifact is NOT a wallet: it creates no wallet, imports no wallet, and holds no key.",
      "Loss bounds are labels only — a future burner design enforces real caps in reviewed code.",
    ],
  };
}

// --- validation (backstop) ---------------------------------------------------

/** The core principles every valid spec must carry as literal true. */
export const BURNER_ISOLATION_CORE_PRINCIPLES = [
  "burnerOnlyPrinciple",
  "mainWalletExcluded",
  "requireSimulationBeforeAnySend",
  "requireRedactedLogging",
  "requireExplicitOptIn",
  "requireOperatorApproval",
  "createsNoWallet",
] as const;

/**
 * Strictly validate a value as a {@link SniperBurnerIsolationSpec} and return it narrowed. A
 * backstop mirroring the package's sibling validators — the seven core principles must be the
 * literal true (a weakened spec is refused), `maxLossLabel` must remain a pure label (digits /
 * currency markers refused), the requirement lists must be non-empty, and the `adopted` mirror is
 * enforced. Throws {@link SniperBurnerIsolationSpecError} on the first problem. Pure.
 */
export function validateSniperBurnerIsolationSpec(value: unknown): SniperBurnerIsolationSpec {
  if (!isObject(value)) throw new SniperBurnerIsolationSpecError("burner isolation spec must be a JSON object");
  if (value.schemaVersion !== SNIPER_BURNER_ISOLATION_SPEC_SCHEMA_VERSION) {
    throw new SniperBurnerIsolationSpecError(`burner isolation spec.schemaVersion must be "${SNIPER_BURNER_ISOLATION_SPEC_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_BURNER_ISOLATION_SPEC_BANNER) {
    throw new SniperBurnerIsolationSpecError(`burner isolation spec.banner must be "${SNIPER_BURNER_ISOLATION_SPEC_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new SniperBurnerIsolationSpecError(`burner isolation spec.${flag} must be true`);
  }
  for (const principle of BURNER_ISOLATION_CORE_PRINCIPLES) {
    if (value[principle] !== true) {
      throw new SniperBurnerIsolationSpecError(`burner isolation spec.${principle} must be true — a weakened isolation spec is REFUSED`);
    }
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperBurnerIsolationSpecError("burner isolation spec.disclaimers must be a non-empty array");
  }
  for (const f of ["operatorLabel", "maxLossLabel", "killSwitchSpecRef"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new SniperBurnerIsolationSpecError(`burner isolation spec.${f} must be a string or null`);
    }
  }
  if (typeof value.maxLossLabel === "string") {
    checkLossLabel(value.maxLossLabel, "burner isolation spec.maxLossLabel");
  }
  for (const key of ["futureCapRequirements", "operatorApprovalRequirements", "warnings", "notes"] as const) {
    if (!Array.isArray(value[key]) || (value[key] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperBurnerIsolationSpecError(`burner isolation spec.${key} must be an array of strings`);
    }
  }
  for (const key of ["futureCapRequirements", "operatorApprovalRequirements"] as const) {
    if ((value[key] as string[]).length === 0) {
      throw new SniperBurnerIsolationSpecError(`burner isolation spec.${key} must not be empty`);
    }
  }
  if (typeof value.readinessStatus !== "string" || !READINESS.has(value.readinessStatus)) {
    throw new SniperBurnerIsolationSpecError('burner isolation spec.readinessStatus must be "draft" | "reviewed" | "adopted"');
  }
  if (value.adopted !== (value.readinessStatus === "adopted")) {
    throw new SniperBurnerIsolationSpecError("burner isolation spec.adopted must mirror readinessStatus");
  }
  return value as unknown as SniperBurnerIsolationSpec;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperBurnerIsolationSpec}. */
export interface FormatSniperBurnerIsolationSpecOptions {
  label?: string;
}

/**
 * Render a redacted, stable, human-readable burner isolation spec. Deterministic and path-stable.
 * Leads with the NOT-A-WALLET banner, lists the seven core principles (all permanently true), the
 * loss-bound label, the cap/approval requirements, the kill-switch pairing, and closes with the
 * prerequisite-not-authorization disclaimers. Passed through the shared redactor.
 */
export function formatSniperBurnerIsolationSpec(
  spec: SniperBurnerIsolationSpec,
  opts: FormatSniperBurnerIsolationSpecOptions = {},
): string {
  const header = `${spec.banner} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];
  if (opts.label) lines.push(`label:    ${opts.label}`);
  lines.push(`operator: ${spec.operatorLabel ?? "(unlabeled)"}`);
  lines.push(`status:   ${spec.readinessStatus}${spec.adopted ? " (adopted — prerequisite signal, NOT authorization)" : ""}`);
  lines.push(`kill-switch ref: ${spec.killSwitchSpecRef ?? "(none — pair with an adopted kill-switch spec)"}`);
  lines.push(`loss bound LABEL: ${spec.maxLossLabel ?? "(none)"} (a label, never an amount)`);

  lines.push("");
  lines.push("Core principles (constants — cannot be configured off):");
  lines.push("- burner-only: any future live work uses an isolated burner, nothing else");
  lines.push("- main wallet permanently excluded");
  lines.push("- simulation required before any FUTURE send");
  lines.push("- redacted logging required around any burner");
  lines.push("- explicit dangerous opt-in required for any FUTURE live capability");
  lines.push("- human operator approval required for every escalation");
  lines.push("- this artifact creates/imports NO wallet and holds NO key");

  lines.push("");
  lines.push("Future cap requirements:");
  for (const r of spec.futureCapRequirements) lines.push(`- ${r}`);

  lines.push("");
  lines.push("Operator approval requirements:");
  for (const r of spec.operatorApprovalRequirements) lines.push(`- ${r}`);

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
