/**
 * Deterministic, **no-send** READ-ONLY AUTO-CAMPAIGN PLAN artifact (Sprint 105-A alpha layer).
 *
 * A plan defines, BEFORE a campaign runs, exactly what a read-only auto-campaign is ALLOWED to do.
 * It is the constitution the `paper:sniper:campaign:auto-run` runner binds itself to: which pipeline
 * stages may run (`allowedStages`), which are explicitly off (`disabledStages`), the candidate cap,
 * the quote-age cap, and the provider policy. It can NEVER imply readiness to trade — there is no
 * readiness/execution field anywhere — and it is structurally incapable of opening a send path:
 *
 *   - the allowed-stage set is CLOSED; only read-only intelligence / inspection stages exist in it,
 *     so a `send` / `sign` / `arm` / `mainnet-live` stage is rejected as unknown, never planned;
 *   - `noSend` / `noSigner` / `noLiveTrading` are pinned `true` and cannot be flipped by any input;
 *   - `liveSendStatus` is the literal `"disabled"`, always; the schema is CLOSED and refuses any
 *     `signature` / `txid` / `sendResult` / `readiness` field.
 *
 * The plan is **pure** and does NO filesystem / network / RPC / wallet work. `disabledStages` is
 * RE-DERIVED as the complement of `allowedStages` over the closed stage set, and the validator
 * recomputes it independently — so a tampered plan that quietly "enables" a disabled stage is caught.
 */

import { redactString } from "@soulmaker/security";

/** Stable schema identifier for the read-only auto-campaign plan artifact. Bump only on a breaking change. */
export const SNIPER_READONLY_CAMPAIGN_PLAN_SCHEMA_VERSION = "sniper.readonly_campaign.plan.v1";

/** The banner that prefixes every plan artifact (required label). */
export const SNIPER_READONLY_CAMPAIGN_PLAN_BANNER =
  "READ-ONLY AUTO-CAMPAIGN PLAN — what a no-send live-read-only campaign is ALLOWED to do. NOTHING here sends, signs, or trades. LIVE TRADING IS DISABLED.";

/** Closed mode set a plan can run in. None of them can send. */
export const SNIPER_READONLY_CAMPAIGN_PLAN_MODES = ["paper", "mainnet-dry-run", "devnet-review"] as const;
export type SniperReadonlyCampaignPlanMode = (typeof SNIPER_READONLY_CAMPAIGN_PLAN_MODES)[number];

/** Closed network set a plan can be scoped to. */
export const SNIPER_READONLY_CAMPAIGN_PLAN_NETWORKS = ["mainnet-beta", "devnet", "testnet"] as const;
export type SniperReadonlyCampaignPlanNetwork = (typeof SNIPER_READONLY_CAMPAIGN_PLAN_NETWORKS)[number];

/**
 * The CLOSED set of pipeline stages a read-only auto-campaign may run. Every entry is read-only
 * intelligence / inspection — there is deliberately NO send / sign / arm / broadcast stage, so any
 * such string is rejected as an unknown stage and can never be planned.
 */
export const SNIPER_READONLY_CAMPAIGN_STAGES = [
  "candidate-score",
  "deep-risk",
  "quote-fetch",
  "quote-score",
  "routequote-prepare",
  "tx-build-dryrun",
  "tx-inspect",
  "simulate",
  "readiness",
  "microtrade-preflight",
] as const;
export type SniperReadonlyCampaignStage = (typeof SNIPER_READONLY_CAMPAIGN_STAGES)[number];

/**
 * Stages that touch a read-only network (RPC / quote provider). They may only be ALLOWED when the
 * provider policy permits live read-only access; under `operator-supplied-only` they must be disabled.
 */
export const SNIPER_READONLY_CAMPAIGN_NETWORK_STAGES: readonly SniperReadonlyCampaignStage[] = [
  "deep-risk",
  "quote-fetch",
  "quote-score",
  "simulate",
];

/** Closed provider-policy set: whether the run may reach a read-only network at all. */
export const SNIPER_READONLY_CAMPAIGN_PROVIDER_POLICIES = ["operator-supplied-only", "live-readonly-when-allowed"] as const;
export type SniperReadonlyCampaignProviderPolicy = (typeof SNIPER_READONLY_CAMPAIGN_PROVIDER_POLICIES)[number];

/** The fixed live-send status. There is no input that can change it. */
export const SNIPER_READONLY_CAMPAIGN_PLAN_LIVE_SEND_STATUS = "disabled";

/** Required disclaimer statements carried by every plan artifact (stable order). */
export const SNIPER_READONLY_CAMPAIGN_PLAN_DISCLAIMERS: readonly string[] = [
  "READ-ONLY AUTO-CAMPAIGN PLAN — it declares which read-only stages a no-send campaign may run; it executes nothing itself.",
  "Every allowed stage is read-only intelligence / inspection. There is NO send, sign, arm, or broadcast stage — such a stage is rejected as unknown, never planned.",
  "noSend / noSigner / noLiveTrading are pinned true and cannot be flipped by any input. liveSendStatus is always 'disabled'.",
  "A plan can NEVER imply readiness to trade — it carries no readiness or execution field, and a completed campaign authorizes nothing.",
  "No wallet, key, signing, sending, or live execution is involved anywhere in producing or honoring this plan.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a profitability claim.",
];

const DEFAULT_CAVEATS: readonly string[] = [
  "A plan bounds a campaign; it never trades, never sends, and never authorizes a live path.",
  "Network stages (deep-risk / quote-fetch / quote-score / simulate) run ONLY when the provider policy is live-readonly-when-allowed; otherwise they are disabled and evidence is operator-supplied or absent.",
  "The candidate limit is a hard cap; a campaign can compare no more candidates than the plan allows.",
  "Live trading is disabled by policy; there is no mainnet-send command anywhere in Sol Maker.",
];

const MAX_LABEL_LEN = 200;
const MAX_LINE_LEN = 400;
const MAX_LIST = 64;

/** The hard cap on how many candidates a single read-only campaign may compare. */
export const SNIPER_READONLY_CAMPAIGN_MAX_CANDIDATE_LIMIT = 1000;

/** Thrown when a plan INPUT or produced artifact is structurally invalid. */
export class SniperReadonlyCampaignPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperReadonlyCampaignPlanError";
  }
}

// --- input / artifact model --------------------------------------------------

/** Everything {@link buildSniperReadonlyCampaignPlan} accepts. */
export interface BuildSniperReadonlyCampaignPlanInput {
  planId?: string | null;
  campaignId?: string | null;
  createdAt?: string | null;
  mode?: string | null;
  network?: string | null;
  inputWatchlistRef?: string | null;
  inputCandidatesRef?: string | null;
  candidateLimit?: number | null;
  /** The stages this campaign is ALLOWED to run (subset of the closed stage set). */
  allowedStages?: string[];
  maxQuoteAgeMs?: number | null;
  providerPolicy?: string | null;
  caveats?: string[];
}

/** The full, deterministic, JSON-serializable read-only auto-campaign plan artifact. */
export interface SniperReadonlyCampaignPlan {
  schemaVersion: string;
  banner: string;
  disclaimers: string[];
  planId: string;
  campaignId: string;
  createdAt: string | null;
  mode: SniperReadonlyCampaignPlanMode;
  network: SniperReadonlyCampaignPlanNetwork;
  inputWatchlistRef: string | null;
  inputCandidatesRef: string | null;
  candidateLimit: number;
  allowedStages: SniperReadonlyCampaignStage[];
  disabledStages: SniperReadonlyCampaignStage[];
  maxQuoteAgeMs: number | null;
  providerPolicy: SniperReadonlyCampaignProviderPolicy;
  noSend: true;
  noSigner: true;
  noLiveTrading: true;
  liveSendStatus: "disabled";
  caveats: string[];
  redactionApplied: true;
  notExecutable: true;
  phase7LiveTradingReady: false;
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectControlChars(value: string, name: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const isControl = code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    const isBomOrSeparator = code === 0xfeff || code === 0x2028 || code === 0x2029;
    if (isControl || isBomOrSeparator) {
      throw new SniperReadonlyCampaignPlanError(`${name} contains a control character, NUL, or BOM and is refused`);
    }
  }
}

function safeLabel(value: unknown, name: string, max: number, nullable: boolean): string | null {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw new SniperReadonlyCampaignPlanError(`${name} is required`);
  }
  if (typeof value !== "string") throw new SniperReadonlyCampaignPlanError(`${name} must be a string`);
  rejectControlChars(value, name);
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (nullable) return null;
    throw new SniperReadonlyCampaignPlanError(`${name} must be a non-empty string`);
  }
  if (trimmed.length > max) throw new SniperReadonlyCampaignPlanError(`${name} exceeds ${max} characters`);
  if (redactString(trimmed) !== trimmed) throw new SniperReadonlyCampaignPlanError(`${name} is secret-shaped and is refused`);
  return trimmed;
}

function optEnum(value: unknown, name: string, allowed: readonly string[]): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new SniperReadonlyCampaignPlanError(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function normalizeStringList(value: unknown, name: string, maxCount: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SniperReadonlyCampaignPlanError(`${name} must be an array of strings`);
  if (value.length > maxCount) throw new SniperReadonlyCampaignPlanError(`${name} exceeds ${maxCount} entries`);
  return value.map((s, i) => {
    if (typeof s !== "string") throw new SniperReadonlyCampaignPlanError(`${name}[${i}] must be a string`);
    rejectControlChars(s, `${name}[${i}]`);
    const trimmed = s.trim();
    if (trimmed.length === 0) throw new SniperReadonlyCampaignPlanError(`${name}[${i}] must be a non-empty string`);
    if (trimmed.length > MAX_LINE_LEN) throw new SniperReadonlyCampaignPlanError(`${name}[${i}] exceeds ${MAX_LINE_LEN} characters`);
    if (redactString(trimmed) !== trimmed) throw new SniperReadonlyCampaignPlanError(`${name}[${i}] is secret-shaped and is refused`);
    return trimmed;
  });
}

function normalizeCandidateLimit(value: unknown): number {
  if (value === undefined || value === null) return SNIPER_READONLY_CAMPAIGN_MAX_CANDIDATE_LIMIT;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new SniperReadonlyCampaignPlanError("candidateLimit must be a positive integer");
  }
  if (value > SNIPER_READONLY_CAMPAIGN_MAX_CANDIDATE_LIMIT) {
    throw new SniperReadonlyCampaignPlanError(`candidateLimit exceeds the hard cap of ${SNIPER_READONLY_CAMPAIGN_MAX_CANDIDATE_LIMIT}`);
  }
  return value;
}

function normalizeMaxQuoteAgeMs(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new SniperReadonlyCampaignPlanError("maxQuoteAgeMs must be a positive integer or null");
  }
  if (value > 24 * 60 * 60 * 1000) {
    throw new SniperReadonlyCampaignPlanError("maxQuoteAgeMs exceeds 24h (likely a mistake)");
  }
  return value;
}

/**
 * Normalize a list of ALLOWED stages: each must be a known stage, no duplicates, returned in the
 * canonical stage order. Any unknown stage (e.g. a `send` / `sign` / `arm` stage that does not
 * exist in the closed set) is refused — a plan can never invent an executable stage.
 */
function normalizeAllowedStages(value: unknown): SniperReadonlyCampaignStage[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SniperReadonlyCampaignPlanError("allowedStages must be an array of stage names");
  const seen = new Set<string>();
  for (const s of value) {
    if (typeof s !== "string") throw new SniperReadonlyCampaignPlanError("allowedStages[] entries must be strings");
    if (!(SNIPER_READONLY_CAMPAIGN_STAGES as readonly string[]).includes(s)) {
      throw new SniperReadonlyCampaignPlanError(
        `allowedStages contains the unknown / forbidden stage "${s}" — the stage set is CLOSED and read-only (no send / sign / arm stage exists)`,
      );
    }
    seen.add(s);
  }
  // Canonical order, deduped.
  return SNIPER_READONLY_CAMPAIGN_STAGES.filter((s) => seen.has(s));
}

/** The complement of the allowed stages over the closed stage set, in canonical order. */
function deriveDisabledStages(allowed: readonly SniperReadonlyCampaignStage[]): SniperReadonlyCampaignStage[] {
  const allowedSet = new Set<string>(allowed);
  return SNIPER_READONLY_CAMPAIGN_STAGES.filter((s) => !allowedSet.has(s));
}

function enforceProviderPolicyStageInvariant(
  policy: SniperReadonlyCampaignProviderPolicy,
  allowed: readonly SniperReadonlyCampaignStage[],
): void {
  if (policy === "operator-supplied-only") {
    const offending = SNIPER_READONLY_CAMPAIGN_NETWORK_STAGES.filter((s) => allowed.includes(s));
    if (offending.length > 0) {
      throw new SniperReadonlyCampaignPlanError(
        `providerPolicy "operator-supplied-only" forbids the read-only-network stage(s) ${offending.join(", ")} in allowedStages — enable live read-only access or disable those stages`,
      );
    }
  }
}

// --- build -------------------------------------------------------------------

/**
 * Build a canonical {@link SniperReadonlyCampaignPlan}. Pure, non-mutating, deterministic.
 * `disabledStages` is RE-DERIVED as the complement of `allowedStages` over the closed stage set;
 * the safety literals (`noSend` / `noSigner` / `noLiveTrading` / `liveSendStatus` / …) are pinned and
 * cannot be flipped by any input. Throws {@link SniperReadonlyCampaignPlanError} on any structural
 * problem.
 */
export function buildSniperReadonlyCampaignPlan(input: BuildSniperReadonlyCampaignPlanInput): SniperReadonlyCampaignPlan {
  if (!isObject(input)) throw new SniperReadonlyCampaignPlanError("plan input must be an object");

  const planId = (safeLabel(input.planId, "planId", 128, true) as string | null) ?? "sniper-readonly-campaign-plan";
  const campaignId = (safeLabel(input.campaignId, "campaignId", 128, true) as string | null) ?? "sniper-readonly-campaign";
  const createdAt = safeLabel(input.createdAt, "createdAt", 40, true);
  const mode = (optEnum(input.mode, "mode", SNIPER_READONLY_CAMPAIGN_PLAN_MODES) as SniperReadonlyCampaignPlanMode | null) ?? "paper";
  const network =
    (optEnum(input.network, "network", SNIPER_READONLY_CAMPAIGN_PLAN_NETWORKS) as SniperReadonlyCampaignPlanNetwork | null) ?? "mainnet-beta";
  const inputWatchlistRef = safeLabel(input.inputWatchlistRef, "inputWatchlistRef", MAX_LABEL_LEN, true);
  const inputCandidatesRef = safeLabel(input.inputCandidatesRef, "inputCandidatesRef", MAX_LABEL_LEN, true);
  const candidateLimit = normalizeCandidateLimit(input.candidateLimit);
  const allowedStages = normalizeAllowedStages(input.allowedStages);
  const disabledStages = deriveDisabledStages(allowedStages);
  const maxQuoteAgeMs = normalizeMaxQuoteAgeMs(input.maxQuoteAgeMs);
  const providerPolicy =
    (optEnum(input.providerPolicy, "providerPolicy", SNIPER_READONLY_CAMPAIGN_PROVIDER_POLICIES) as SniperReadonlyCampaignProviderPolicy | null) ??
    "operator-supplied-only";

  enforceProviderPolicyStageInvariant(providerPolicy, allowedStages);

  const extraCaveats = normalizeStringList(input.caveats, "caveats", MAX_LIST);

  return {
    schemaVersion: SNIPER_READONLY_CAMPAIGN_PLAN_SCHEMA_VERSION,
    banner: SNIPER_READONLY_CAMPAIGN_PLAN_BANNER,
    disclaimers: [...SNIPER_READONLY_CAMPAIGN_PLAN_DISCLAIMERS],
    planId,
    campaignId,
    createdAt,
    mode,
    network,
    inputWatchlistRef,
    inputCandidatesRef,
    candidateLimit,
    allowedStages,
    disabledStages,
    maxQuoteAgeMs,
    providerPolicy,
    noSend: true,
    noSigner: true,
    noLiveTrading: true,
    liveSendStatus: SNIPER_READONLY_CAMPAIGN_PLAN_LIVE_SEND_STATUS,
    caveats: [...DEFAULT_CAVEATS, ...extraCaveats],
    redactionApplied: true,
    notExecutable: true,
    phase7LiveTradingReady: false,
  };
}

// --- validation (backstop + parity wall) -------------------------------------

const EXPECTED_KEYS = [
  "schemaVersion",
  "banner",
  "disclaimers",
  "planId",
  "campaignId",
  "createdAt",
  "mode",
  "network",
  "inputWatchlistRef",
  "inputCandidatesRef",
  "candidateLimit",
  "allowedStages",
  "disabledStages",
  "maxQuoteAgeMs",
  "providerPolicy",
  "noSend",
  "noSigner",
  "noLiveTrading",
  "liveSendStatus",
  "caveats",
  "redactionApplied",
  "notExecutable",
  "phase7LiveTradingReady",
] as const;

/**
 * Strictly validate a value as a canonical {@link SniperReadonlyCampaignPlan}. A backstop AND a
 * parity wall: the key set is CLOSED (no `signature` / `txid` / `sendResult` / `readiness` field can
 * ever appear); the banner / mode / network / live-send / safety literals are pinned; `allowedStages`
 * is re-validated against the closed stage set; `disabledStages` is INDEPENDENTLY re-derived as the
 * complement and must match (a tampered plan that quietly enables a disabled stage is caught). Throws
 * {@link SniperReadonlyCampaignPlanError} on the first problem. Pure.
 */
export function validateSniperReadonlyCampaignPlan(value: unknown): SniperReadonlyCampaignPlan {
  if (!isObject(value)) throw new SniperReadonlyCampaignPlanError("plan must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) {
      throw new SniperReadonlyCampaignPlanError(`plan has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  for (const key of EXPECTED_KEYS) {
    if (!(key in value)) throw new SniperReadonlyCampaignPlanError(`plan is missing field "${key}"`);
  }

  if (value.schemaVersion !== SNIPER_READONLY_CAMPAIGN_PLAN_SCHEMA_VERSION) {
    throw new SniperReadonlyCampaignPlanError(`schemaVersion must be "${SNIPER_READONLY_CAMPAIGN_PLAN_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_READONLY_CAMPAIGN_PLAN_BANNER) throw new SniperReadonlyCampaignPlanError("banner must be the canonical banner");
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperReadonlyCampaignPlanError("disclaimers must be a non-empty array");
  }
  safeLabel(value.planId, "planId", 128, false);
  safeLabel(value.campaignId, "campaignId", 128, false);
  safeLabel(value.createdAt, "createdAt", 40, true);
  if (!(SNIPER_READONLY_CAMPAIGN_PLAN_MODES as readonly string[]).includes(value.mode as string)) {
    throw new SniperReadonlyCampaignPlanError(`mode must be one of: ${SNIPER_READONLY_CAMPAIGN_PLAN_MODES.join(", ")}`);
  }
  if (!(SNIPER_READONLY_CAMPAIGN_PLAN_NETWORKS as readonly string[]).includes(value.network as string)) {
    throw new SniperReadonlyCampaignPlanError(`network must be one of: ${SNIPER_READONLY_CAMPAIGN_PLAN_NETWORKS.join(", ")}`);
  }
  safeLabel(value.inputWatchlistRef, "inputWatchlistRef", MAX_LABEL_LEN, true);
  safeLabel(value.inputCandidatesRef, "inputCandidatesRef", MAX_LABEL_LEN, true);
  normalizeCandidateLimit(value.candidateLimit);
  normalizeMaxQuoteAgeMs(value.maxQuoteAgeMs);

  const providerPolicy = optEnum(value.providerPolicy, "providerPolicy", SNIPER_READONLY_CAMPAIGN_PROVIDER_POLICIES);
  if (providerPolicy === null) {
    throw new SniperReadonlyCampaignPlanError(`providerPolicy must be one of: ${SNIPER_READONLY_CAMPAIGN_PROVIDER_POLICIES.join(", ")}`);
  }

  const allowedStages = normalizeAllowedStages(value.allowedStages);
  // The echoed allowedStages must already be canonical + deduped (no extra / reordered entries).
  if (!Array.isArray(value.allowedStages) || JSON.stringify(value.allowedStages) !== JSON.stringify(allowedStages)) {
    throw new SniperReadonlyCampaignPlanError("allowedStages must be the canonical, deduped subset of the closed stage set");
  }
  // The PARITY WALL: disabledStages must be the independently re-derived complement.
  const disabledStages = deriveDisabledStages(allowedStages);
  if (JSON.stringify(value.disabledStages) !== JSON.stringify(disabledStages)) {
    throw new SniperReadonlyCampaignPlanError("disabledStages must be the re-derived complement of allowedStages over the closed stage set");
  }
  enforceProviderPolicyStageInvariant(providerPolicy as SniperReadonlyCampaignProviderPolicy, allowedStages);

  if (!Array.isArray(value.caveats) || (value.caveats as unknown[]).length === 0) {
    throw new SniperReadonlyCampaignPlanError("caveats must be a non-empty array");
  }

  for (const [field, expected] of [
    ["noSend", true],
    ["noSigner", true],
    ["noLiveTrading", true],
    ["redactionApplied", true],
    ["notExecutable", true],
    ["phase7LiveTradingReady", false],
  ] as const) {
    if (value[field] !== expected) throw new SniperReadonlyCampaignPlanError(`${field} must literally be ${String(expected)}`);
  }
  if (value.liveSendStatus !== SNIPER_READONLY_CAMPAIGN_PLAN_LIVE_SEND_STATUS) {
    throw new SniperReadonlyCampaignPlanError(
      `liveSendStatus must literally be "${SNIPER_READONLY_CAMPAIGN_PLAN_LIVE_SEND_STATUS}" — a plan can never report live enabled`,
    );
  }

  return value as unknown as SniperReadonlyCampaignPlan;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperReadonlyCampaignPlan}. */
export interface FormatSniperReadonlyCampaignPlanOptions {
  label?: string;
}

/**
 * Render a redacted, stable, human-readable plan summary. Deterministic and path-stable (no
 * timestamps). The whole output passes through the redactor.
 */
export function formatSniperReadonlyCampaignPlan(
  plan: SniperReadonlyCampaignPlan,
  opts: FormatSniperReadonlyCampaignPlanOptions = {},
): string {
  const header = `${plan.banner}`;
  const lines: string[] = [header, "=".repeat(Math.min(header.length, 80))];
  if (opts.label) lines.push(`label:     ${opts.label}`);
  lines.push(`plan id:   ${plan.planId}`);
  lines.push(`campaign:  ${plan.campaignId}`);
  lines.push(`mode:      ${plan.mode} (${plan.network})`);
  lines.push(`live:      ${plan.liveSendStatus.toUpperCase()} (no send / no signer / no live trading)`);
  lines.push(`policy:    ${plan.providerPolicy}`);
  lines.push(`limit:     ${plan.candidateLimit} candidate(s)`);
  if (plan.maxQuoteAgeMs !== null) lines.push(`quote age: max ${plan.maxQuoteAgeMs}ms`);

  lines.push("");
  lines.push(`Allowed stages (${plan.allowedStages.length}): ${plan.allowedStages.length > 0 ? plan.allowedStages.join(", ") : "(none)"}`);
  lines.push(`Disabled stages (${plan.disabledStages.length}): ${plan.disabledStages.length > 0 ? plan.disabledStages.join(", ") : "(none)"}`);

  lines.push("");
  lines.push("Caveats:");
  for (const c of plan.caveats) lines.push(`- ${c}`);
  lines.push("");
  for (const d of plan.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
