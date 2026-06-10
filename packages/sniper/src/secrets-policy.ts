/**
 * Deterministic, offline **SNIPER SECRETS POLICY** artifact (Sprint 54 — a Phase-6 prerequisite).
 *
 * A machine-readable LOCAL policy (`sniper.secrets.policy.v1`) that writes down — before any future
 * burner/live design may even be drafted — the non-negotiable secret-handling rules. The six core
 * rules are LITERALS that must be true; the validator refuses a policy where any was weakened:
 *
 *   - `forbidMainWalletUse`                  — the operator's main wallet may NEVER be used.
 *   - `forbidRecoveryWordsStorage`           — no seed phrase / recovery words may ever be stored.
 *   - `forbidKeyMaterialLogging`             — no private key material may ever be logged.
 *   - `requireBurnerIsolationForLive`        — any FUTURE live work requires an isolated burner.
 *   - `requireRedaction`                     — all operator-facing output goes through the redactor.
 *   - `requireExplicitDangerousOptInForLive` — any FUTURE live capability needs an explicit, dangerous, human opt-in.
 *
 * (The field names deliberately avoid the shared redactor's sensitive-key patterns — e.g. "seed" —
 * so the artifact's own flags survive `redactValue` intact.)
 *
 * **This artifact must never accept or store an actual secret.** The builder SCANS its own input:
 * a key that looks secret-bearing or a string value that looks like key material (64+ base58 chars,
 * 12/24-word phrases, 0x-hex blobs) is REFUSED — and the refusal message NEVER echoes the value.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work, and carries no wall-clock
 * time. Policy only — it grants nothing and enables nothing.
 */

import { redactString } from "@soulmaker/security";

/** Stable schema identifier for the secrets policy. Bump only on a breaking change. */
export const SNIPER_SECRETS_POLICY_SCHEMA_VERSION = "sniper.secrets.policy.v1";

/** The banner that prefixes every secrets policy (required label). */
export const SNIPER_SECRETS_POLICY_BANNER = "SNIPER SECRETS POLICY (LOCAL ARTIFACT — STORES NO SECRET, GRANTS NOTHING)";

/** Required disclaimer statements carried by every secrets policy (stable order). */
export const SNIPER_SECRETS_POLICY_DISCLAIMERS: readonly string[] = [
  "SNIPER SECRETS POLICY — a machine-readable LOCAL policy of non-negotiable secret-handling rules. It stores NO secret and grants NO capability.",
  "The six core rules are literals that must be true; a policy where any was weakened is REFUSED by the validator.",
  "The builder refuses input that looks like actual secret material (secret-bearing keys or key-shaped values) and never echoes it.",
  "An adopted policy is a Phase-6/7 PREREQUISITE — it is never authorization for live or burner work, which remain not started.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this artifact.",
];

/** Thrown when secrets-policy INPUT is unsafe/invalid or a produced policy is structurally invalid. */
export class SniperSecretsPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperSecretsPolicyError";
  }
}

// --- model -------------------------------------------------------------------

/** The operator-declared adoption status of the policy. */
export type SniperSecretsPolicyReadiness = "draft" | "reviewed" | "adopted";

/** Everything {@link buildSniperSecretsPolicy} accepts (operator-friendly raw input; all optional).
 * The six core rules are NOT inputs — they are constants that cannot be configured off. */
export interface BuildSniperSecretsPolicyInput {
  /** Operator label (who owns this policy). */
  operatorLabel?: string | null;
  /** Additional handling rules (merged with the canonical baseline, deduped, sorted). */
  additionalRules?: string[];
  /** Redaction notes (what the redactor must cover beyond the baseline). */
  redactionNotes?: string[];
  /** Operator-declared adoption status (default "draft"). */
  readinessStatus?: SniperSecretsPolicyReadiness;
}

/** The full, deterministic, JSON-serializable secrets policy. */
export interface SniperSecretsPolicy {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  /** Literal true, validated: this artifact stores no secret material. */
  storesNoSecretMaterial: true;
  // --- the six core rules: literals that must be true (validated) ---
  forbidMainWalletUse: true;
  forbidRecoveryWordsStorage: true;
  forbidKeyMaterialLogging: true;
  requireBurnerIsolationForLive: true;
  requireRedaction: true;
  requireExplicitDangerousOptInForLive: true;
  disclaimers: string[];
  operatorLabel: string | null;
  /** The canonical baseline rules plus the operator's additions (deduped, sorted). */
  handlingRules: string[];
  redactionNotes: string[];
  readinessStatus: SniperSecretsPolicyReadiness;
  /** True iff the operator declared the policy `adopted` — a prerequisite signal, never authorization. */
  adopted: boolean;
  warnings: string[];
  notes: string[];
}

// --- canonical baseline --------------------------------------------------------

/** The canonical handling rules every policy carries (operator additions are merged in). */
export const SECRETS_POLICY_BASELINE_RULES: readonly string[] = [
  "no secret material of any kind may appear in a repo file, an artifact, a log, or a test fixture",
  "any future key material must live outside this repository and outside every artifact this platform writes",
  "any future live capability must be impossible to enable by configuration alone — it requires new, reviewed code plus an explicit dangerous opt-in",
  "every operator-facing output path must pass through the shared redactor",
];

// --- secret-shaped input detection ---------------------------------------------

/** Input keys that suggest the operator is trying to store secret material (refused). */
const SECRET_BEARING_KEY = /private|secret|mnemonic|seed|keypair|passphrase|credential/i;

/** A string value that looks like key material: long base58 runs, 0x-hex blobs, or 12/24-word phrases. */
function looksLikeSecretValue(value: string): boolean {
  const trimmed = value.trim();
  if (/^[1-9A-HJ-NP-Za-km-z]{64,}$/.test(trimmed)) return true; // base58 longer than any public key
  if (/^(0x)?[0-9a-fA-F]{64,}$/.test(trimmed)) return true; // raw hex key material
  const words = trimmed.split(/\s+/);
  // BIP39-shaped: exactly 12/24 plain lowercase words in the wordlist's 3-8 char range.
  if ((words.length === 12 || words.length === 24) && words.every((w) => /^[a-z]{3,8}$/.test(w))) return true;
  return false;
}

/**
 * Recursively scan a value; throw (WITHOUT echoing the offending value) on anything secret-shaped.
 * `checkKeys` additionally refuses secret-BEARING key names — used on raw builder INPUT, where any
 * such key means the operator is trying to store a secret. The canonical artifact's own field names
 * legitimately describe the things they FORBID, so artifact re-scans check values only. Pure.
 */
function refuseSecretShapedInput(value: unknown, path: string, checkKeys: boolean): void {
  if (typeof value === "string") {
    if (looksLikeSecretValue(value)) {
      throw new SniperSecretsPolicyError(
        `input at ${path} looks like secret material (key-shaped value) — REFUSED; this artifact must never store a secret (the value was not echoed)`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => refuseSecretShapedInput(v, `${path}[${i}]`, checkKeys));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (checkKeys && SECRET_BEARING_KEY.test(k)) {
        throw new SniperSecretsPolicyError(
          `input key "${path}.${k}" looks secret-bearing — REFUSED; this artifact must never accept or store a secret (the value was not read)`,
        );
      }
      refuseSecretShapedInput(v, `${path}.${k}`, checkKeys);
    }
  }
}

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
    throw new SniperSecretsPolicyError(`secrets policy input.${name} must be an array of strings when present`);
  }
  return [...new Set([...baseline, ...(extra as string[]).map((s) => s.trim()).filter((s) => s.length > 0)])].sort();
}

const READINESS: ReadonlySet<string> = new Set(["draft", "reviewed", "adopted"]);

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic {@link SniperSecretsPolicy}. Pure and non-mutating. The ENTIRE raw input is
 * scanned first: a secret-bearing key or a key-shaped string value is REFUSED without ever echoing
 * it. The six core rules are constants — they are not inputs and cannot be configured off. The
 * operator's additional rules / redaction notes are merged with the canonical baseline (deduped,
 * sorted). Carries no wall-clock time. Throws {@link SniperSecretsPolicyError} on unsafe/invalid input.
 */
export function buildSniperSecretsPolicy(input: BuildSniperSecretsPolicyInput = {}): SniperSecretsPolicy {
  if (!isObject(input)) throw new SniperSecretsPolicyError("secrets policy input must be an object");
  // FIRST: refuse anything secret-shaped (keys AND values), before reading any field.
  refuseSecretShapedInput(input, "input", true);

  if (input.operatorLabel !== undefined && input.operatorLabel !== null && typeof input.operatorLabel !== "string") {
    throw new SniperSecretsPolicyError("secrets policy input.operatorLabel must be a string or null when present");
  }
  const readinessRaw: unknown = input.readinessStatus ?? "draft";
  if (typeof readinessRaw !== "string" || !READINESS.has(readinessRaw)) {
    throw new SniperSecretsPolicyError('secrets policy input.readinessStatus must be "draft" | "reviewed" | "adopted"');
  }
  const readinessStatus = readinessRaw as SniperSecretsPolicyReadiness;

  const handlingRules = mergeList(SECRETS_POLICY_BASELINE_RULES, input.additionalRules, "additionalRules");
  const redactionNotes = mergeList([], input.redactionNotes, "redactionNotes");

  const warnings: string[] = [];
  if (readinessStatus !== "adopted") {
    warnings.push(`the policy is "${readinessStatus}" — the Phase-6 secrets-policy readiness bucket needs an ADOPTED policy.`);
  }

  return {
    schemaVersion: SNIPER_SECRETS_POLICY_SCHEMA_VERSION,
    banner: SNIPER_SECRETS_POLICY_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    storesNoSecretMaterial: true,
    forbidMainWalletUse: true,
    forbidRecoveryWordsStorage: true,
    forbidKeyMaterialLogging: true,
    requireBurnerIsolationForLive: true,
    requireRedaction: true,
    requireExplicitDangerousOptInForLive: true,
    disclaimers: [...SNIPER_SECRETS_POLICY_DISCLAIMERS],
    operatorLabel: nonEmptyString(input.operatorLabel) ? input.operatorLabel : null,
    handlingRules,
    redactionNotes,
    readinessStatus,
    adopted: readinessStatus === "adopted",
    warnings,
    notes: [
      "The six core rules are constants of this artifact — they are not inputs and cannot be configured off.",
      "This artifact stores no secret; the builder refuses secret-shaped input without echoing it.",
    ],
  };
}

// --- validation (backstop) ---------------------------------------------------

/** The six core rules every valid policy must carry as literal true. */
export const SECRETS_POLICY_CORE_RULES = [
  "forbidMainWalletUse",
  "forbidRecoveryWordsStorage",
  "forbidKeyMaterialLogging",
  "requireBurnerIsolationForLive",
  "requireRedaction",
  "requireExplicitDangerousOptInForLive",
] as const;

/**
 * Strictly validate a value as a {@link SniperSecretsPolicy} and return it narrowed. A backstop
 * mirroring the package's sibling validators — the six core rules and `storesNoSecretMaterial` must
 * be the literal true (a weakened policy is refused), the artifact's VALUES are re-scanned for
 * secret-shaped content, and the `adopted` mirror is enforced. Throws
 * {@link SniperSecretsPolicyError} on the first problem. Pure.
 */
export function validateSniperSecretsPolicy(value: unknown): SniperSecretsPolicy {
  if (!isObject(value)) throw new SniperSecretsPolicyError("secrets policy must be a JSON object");
  if (value.schemaVersion !== SNIPER_SECRETS_POLICY_SCHEMA_VERSION) {
    throw new SniperSecretsPolicyError(`secrets policy.schemaVersion must be "${SNIPER_SECRETS_POLICY_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_SECRETS_POLICY_BANNER) {
    throw new SniperSecretsPolicyError(`secrets policy.banner must be "${SNIPER_SECRETS_POLICY_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim", "storesNoSecretMaterial"] as const) {
    if (value[flag] !== true) throw new SniperSecretsPolicyError(`secrets policy.${flag} must be true`);
  }
  for (const rule of SECRETS_POLICY_CORE_RULES) {
    if (value[rule] !== true) {
      throw new SniperSecretsPolicyError(`secrets policy.${rule} must be true — a weakened secrets policy is REFUSED`);
    }
  }
  // The artifact itself must never carry secret-shaped VALUES (e.g. a hand-edited "note"); its own
  // field names legitimately describe the things they forbid, so keys are not checked here.
  refuseSecretShapedInput(value, "secrets policy", false);
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperSecretsPolicyError("secrets policy.disclaimers must be a non-empty array");
  }
  if (value.operatorLabel !== null && typeof value.operatorLabel !== "string") {
    throw new SniperSecretsPolicyError("secrets policy.operatorLabel must be a string or null");
  }
  for (const key of ["handlingRules", "redactionNotes", "warnings", "notes"] as const) {
    if (!Array.isArray(value[key]) || (value[key] as unknown[]).some((x) => typeof x !== "string")) {
      throw new SniperSecretsPolicyError(`secrets policy.${key} must be an array of strings`);
    }
  }
  if ((value.handlingRules as string[]).length === 0) {
    throw new SniperSecretsPolicyError("secrets policy.handlingRules must not be empty");
  }
  if (typeof value.readinessStatus !== "string" || !READINESS.has(value.readinessStatus)) {
    throw new SniperSecretsPolicyError('secrets policy.readinessStatus must be "draft" | "reviewed" | "adopted"');
  }
  if (value.adopted !== (value.readinessStatus === "adopted")) {
    throw new SniperSecretsPolicyError("secrets policy.adopted must mirror readinessStatus");
  }
  return value as unknown as SniperSecretsPolicy;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperSecretsPolicy}. */
export interface FormatSniperSecretsPolicyOptions {
  label?: string;
}

/**
 * Render a redacted, stable, human-readable secrets policy. Deterministic and path-stable. Leads
 * with the STORES-NO-SECRET banner, lists the six core rules (all permanently true), the handling
 * rules and redaction notes, and closes with the prerequisite-not-authorization disclaimers. Passed
 * through the shared redactor.
 */
export function formatSniperSecretsPolicy(
  policy: SniperSecretsPolicy,
  opts: FormatSniperSecretsPolicyOptions = {},
): string {
  const header = `${policy.banner} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];
  if (opts.label) lines.push(`label:    ${opts.label}`);
  lines.push(`operator: ${policy.operatorLabel ?? "(unlabeled)"}`);
  lines.push(`status:   ${policy.readinessStatus}${policy.adopted ? " (adopted — prerequisite signal, NOT authorization)" : ""}`);

  lines.push("");
  lines.push("Core rules (constants — cannot be configured off):");
  lines.push("- forbid main wallet use: true");
  lines.push("- forbid seed phrase storage: true");
  lines.push("- forbid private key logging: true");
  lines.push("- require burner isolation for any FUTURE live work: true");
  lines.push("- require redaction on every operator-facing output: true");
  lines.push("- require an explicit dangerous opt-in for any FUTURE live capability: true");

  lines.push("");
  lines.push("Handling rules:");
  for (const r of policy.handlingRules) lines.push(`- ${r}`);

  if (policy.redactionNotes.length > 0) {
    lines.push("");
    lines.push("Redaction notes:");
    for (const r of policy.redactionNotes) lines.push(`- ${r}`);
  }

  if (policy.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of policy.warnings) lines.push(`- ${w}`);
  }

  lines.push("");
  lines.push("Notes:");
  for (const note of policy.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of policy.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
