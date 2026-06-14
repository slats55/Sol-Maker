/**
 * Deterministic, **no-send** PROVIDER HEALTH REPORT artifact (Sprint 105-B alpha layer).
 *
 * Machine-readable evidence of whether Sol Maker can reach the READ-ONLY dependencies an alpha
 * campaign needs — the RPC, the Jupiter quote API, the Rust engine, the route-quote / build-dry-run /
 * simulation stages. It answers exactly one question per dependency: "can a no-send read-only campaign
 * use this right now?" and nothing more. It is structurally incapable of authorizing a live path:
 *
 *   - the per-check status set is CLOSED and carries NO `blocked` / `ready-to-trade` status — provider
 *     "unavailable" is a reachability fact, never a risk verdict;
 *   - `noSend` / `noSigner` are pinned `true`, `liveSendStatus` is the literal `"disabled"`, and
 *     `authorizesLiveTrading` is pinned `false`; the schema is CLOSED and refuses any `signature` /
 *     `txid` / `sendResult` / `signer` field;
 *   - it carries NO endpoint secret: every `redactedEndpoint` is host-only and re-scrubbed here.
 *
 * It is **pure** and does NO filesystem / network / RPC / wallet work — the CLI doctor performs the
 * bounded read-only probes and hands the per-check facts here. The summary counts and the
 * `canRunLiveReadonlyCampaign` / `canRunFixtureCampaign` flags are RE-DERIVED from the checks, and the
 * validator recomputes them independently as a parity wall.
 */

import { redactString } from "@soulmaker/security";

/** Stable schema identifier for the provider health report. Bump only on a breaking change. */
export const SNIPER_PROVIDER_HEALTH_REPORT_SCHEMA_VERSION = "sniper.provider_health.report.v1";

/** The banner that prefixes every provider health report (required label). */
export const SNIPER_PROVIDER_HEALTH_REPORT_BANNER =
  "SNIPER PROVIDER HEALTH REPORT — can a no-send read-only alpha campaign reach its providers? Reachability only, NOT a risk verdict and NOT live readiness. LIVE TRADING IS DISABLED.";

/** Closed mode set (mirrors the campaign / alpha report / provider config). */
export const SNIPER_PROVIDER_HEALTH_MODES = ["paper", "mainnet-dry-run", "devnet-review"] as const;
export type SniperProviderHealthMode = (typeof SNIPER_PROVIDER_HEALTH_MODES)[number];

/** Closed network set, derived from the mode. */
export const SNIPER_PROVIDER_HEALTH_NETWORKS = ["mainnet-beta", "devnet"] as const;
export type SniperProviderHealthNetwork = (typeof SNIPER_PROVIDER_HEALTH_NETWORKS)[number];

/** The CLOSED set of read-only dependencies a provider health report can describe. */
export const SNIPER_PROVIDER_HEALTH_PROVIDERS = [
  "rpc",
  "jupiter-quote",
  "rust-engine",
  "routequote",
  "txbuild-dryrun",
  "simulation",
] as const;
export type SniperProviderHealthProvider = (typeof SNIPER_PROVIDER_HEALTH_PROVIDERS)[number];

/**
 * The CLOSED per-check status set. NOTHING here is a risk / trade verdict — there is deliberately no
 * `blocked` / `ready` status, so "provider unavailable" can never be confused with "candidate blocked".
 */
export const SNIPER_PROVIDER_HEALTH_STATUSES = [
  "available",
  "unavailable",
  "skipped",
  "misconfigured",
  "timeout",
  "rate-limited",
  "error",
] as const;
export type SniperProviderHealthStatus = (typeof SNIPER_PROVIDER_HEALTH_STATUSES)[number];

/** The providers a LIVE read-only campaign genuinely needs reachable (RPC reads + quotes). */
export const SNIPER_PROVIDER_HEALTH_LIVE_REQUIRED_PROVIDERS: readonly SniperProviderHealthProvider[] = ["rpc", "jupiter-quote"];

/** The fixed live-send status. There is no input that can change it. */
export const SNIPER_PROVIDER_HEALTH_LIVE_SEND_STATUS = "disabled";

/** Required disclaimer statements carried by every provider health report (stable order). */
export const SNIPER_PROVIDER_HEALTH_REPORT_DISCLAIMERS: readonly string[] = [
  "SNIPER PROVIDER HEALTH REPORT — it reports whether the READ-ONLY provider dependencies of an alpha campaign are reachable; it executes no campaign and trades nothing.",
  "A provider status is REACHABILITY only (available / unavailable / timeout / rate-limited / misconfigured / error / skipped). It is NOT a candidate risk verdict — 'provider unavailable' is never 'candidate blocked'.",
  "noSend / noSigner are pinned true and liveSendStatus is always 'disabled'. The report carries no endpoint secret — every endpoint is reduced to its host.",
  "canRunLiveReadonlyCampaign means only that the read-only network dependencies are reachable; it NEVER means a trade is authorized or that live trading is enabled.",
  "No wallet, key, signing, sending, or live execution is involved anywhere in producing this report.",
  "Not a live result.",
  "Not a trade signal.",
  "Not financial advice.",
  "Not a live-readiness claim.",
];

const DEFAULT_CAVEATS: readonly string[] = [
  "A provider health report describes reachability of read-only dependencies; it never trades, never sends, and never authorizes a live path.",
  "An unavailable / timeout / rate-limited provider is reported HONESTLY — the campaign skips that stage and records it as evidence, never fakes a result.",
  "canRunFixtureCampaign is always true: a fixture / fictional-example campaign needs no live provider.",
  "Live trading is disabled by policy; there is no mainnet-send command anywhere in Sol Maker.",
];

const MAX_LABEL_LEN = 200;
const MAX_LINE_LEN = 400;
const MAX_LIST = 64;
const MAX_CHECKS = 64;
const MAX_LATENCY_MS = 24 * 60 * 60 * 1000; // 24h ceiling — a latency past this is a mistake.

/** Thrown when a provider health report INPUT or produced artifact is structurally invalid. */
export class SniperProviderHealthReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperProviderHealthReportError";
  }
}

// --- input / artifact model --------------------------------------------------

/** One read-only dependency probe result handed in by the CLI doctor. */
export interface SniperProviderHealthCheckInput {
  checkId?: string | null;
  provider: string;
  status: string;
  latencyMs?: number | null;
  /** ALREADY redacted (host-only) by the caller; re-scrubbed here and refused if secret-shaped. */
  redactedEndpoint?: string | null;
  message?: string | null;
  nextSafeAction?: string | null;
}

/** Everything {@link buildSniperProviderHealthReport} accepts. */
export interface BuildSniperProviderHealthReportInput {
  reportId?: string | null;
  checkedAt?: string | null;
  mode?: string | null;
  network?: string | null;
  providerProfile?: string | null;
  checks: SniperProviderHealthCheckInput[];
  caveats?: string[];
}

/** One canonical, validated check entry. */
export interface SniperProviderHealthCheck {
  checkId: string;
  provider: SniperProviderHealthProvider;
  status: SniperProviderHealthStatus;
  latencyMs: number | null;
  redactedEndpoint: string | null;
  message: string;
  nextSafeAction: string;
}

/** Re-derived count of each status across the checks. */
export interface SniperProviderHealthSummary {
  availableCount: number;
  unavailableCount: number;
  skippedCount: number;
  misconfiguredCount: number;
  timeoutCount: number;
  rateLimitedCount: number;
  errorCount: number;
}

/** The full, deterministic, JSON-serializable provider health report artifact. */
export interface SniperProviderHealthReport {
  schemaVersion: string;
  banner: string;
  disclaimers: string[];
  reportId: string;
  checkedAt: string | null;
  mode: SniperProviderHealthMode;
  network: SniperProviderHealthNetwork;
  providerProfile: string;
  checks: SniperProviderHealthCheck[];
  summary: SniperProviderHealthSummary;
  canRunLiveReadonlyCampaign: boolean;
  canRunFixtureCampaign: true;
  noSend: true;
  noSigner: true;
  liveSendStatus: "disabled";
  authorizesLiveTrading: false;
  caveats: string[];
  redactionApplied: true;
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
      throw new SniperProviderHealthReportError(`${name} contains a control character, NUL, or BOM and is refused`);
    }
  }
}

function safeLabel(value: unknown, name: string, max: number, nullable: boolean): string | null {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw new SniperProviderHealthReportError(`${name} is required`);
  }
  if (typeof value !== "string") throw new SniperProviderHealthReportError(`${name} must be a string`);
  rejectControlChars(value, name);
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (nullable) return null;
    throw new SniperProviderHealthReportError(`${name} must be a non-empty string`);
  }
  if (trimmed.length > max) throw new SniperProviderHealthReportError(`${name} exceeds ${max} characters`);
  if (redactString(trimmed) !== trimmed) throw new SniperProviderHealthReportError(`${name} is secret-shaped and is refused`);
  return trimmed;
}

function normalizeStringList(value: unknown, name: string, maxCount: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SniperProviderHealthReportError(`${name} must be an array of strings`);
  if (value.length > maxCount) throw new SniperProviderHealthReportError(`${name} exceeds ${maxCount} entries`);
  return value.map((s, i) => {
    if (typeof s !== "string") throw new SniperProviderHealthReportError(`${name}[${i}] must be a string`);
    rejectControlChars(s, `${name}[${i}]`);
    const trimmed = s.trim();
    if (trimmed.length === 0) throw new SniperProviderHealthReportError(`${name}[${i}] must be a non-empty string`);
    if (trimmed.length > MAX_LINE_LEN) throw new SniperProviderHealthReportError(`${name}[${i}] exceeds ${MAX_LINE_LEN} characters`);
    if (redactString(trimmed) !== trimmed) throw new SniperProviderHealthReportError(`${name}[${i}] is secret-shaped and is refused`);
    return trimmed;
  });
}

function normalizeMode(value: unknown): SniperProviderHealthMode {
  if (value === undefined || value === null || (typeof value === "string" && value.trim().length === 0)) return "paper";
  if (typeof value !== "string" || !(SNIPER_PROVIDER_HEALTH_MODES as readonly string[]).includes(value)) {
    throw new SniperProviderHealthReportError(`mode must be one of: ${SNIPER_PROVIDER_HEALTH_MODES.join(", ")}`);
  }
  return value as SniperProviderHealthMode;
}

function networkForMode(mode: SniperProviderHealthMode): SniperProviderHealthNetwork {
  return mode === "devnet-review" ? "devnet" : "mainnet-beta";
}

function normalizeNetwork(value: unknown, mode: SniperProviderHealthMode): SniperProviderHealthNetwork {
  if (value === undefined || value === null || (typeof value === "string" && value.trim().length === 0)) return networkForMode(mode);
  if (typeof value !== "string" || !(SNIPER_PROVIDER_HEALTH_NETWORKS as readonly string[]).includes(value)) {
    throw new SniperProviderHealthReportError(`network must be one of: ${SNIPER_PROVIDER_HEALTH_NETWORKS.join(", ")}`);
  }
  return value as SniperProviderHealthNetwork;
}

function normalizeLatency(value: unknown, name: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new SniperProviderHealthReportError(`${name} must be a non-negative number or null`);
  }
  if (value > MAX_LATENCY_MS) throw new SniperProviderHealthReportError(`${name} exceeds 24h (likely a mistake)`);
  return Math.round(value * 100) / 100;
}

function normalizeRedactedEndpoint(value: unknown, name: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new SniperProviderHealthReportError(`${name} must be a string or null`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_LABEL_LEN) throw new SniperProviderHealthReportError(`${name} exceeds ${MAX_LABEL_LEN} characters`);
  rejectControlChars(trimmed, name);
  // The caller must pre-redact to host-only. A secret-shaped endpoint here is a real leak — refuse it.
  if (redactString(trimmed) !== trimmed) {
    throw new SniperProviderHealthReportError(`${name} is secret-shaped and is refused — pass a host-only redacted endpoint`);
  }
  return trimmed;
}

/** Default human message per status when the caller supplies none. */
function defaultMessage(provider: SniperProviderHealthProvider, status: SniperProviderHealthStatus): string {
  switch (status) {
    case "available":
      return `${provider} is reachable for read-only use`;
    case "unavailable":
      return `${provider} is unreachable (read-only)`;
    case "skipped":
      return `${provider} was not checked`;
    case "misconfigured":
      return `${provider} endpoint is misconfigured (invalid / unsupported URL)`;
    case "timeout":
      return `${provider} did not respond within the timeout`;
    case "rate-limited":
      return `${provider} rate-limited the read-only probe`;
    case "error":
      return `${provider} returned an error to the read-only probe`;
  }
}

/** Default next safe action per status (always honest, never a trade prompt). */
function defaultNextSafeAction(provider: SniperProviderHealthProvider, status: SniperProviderHealthStatus): string {
  switch (status) {
    case "available":
      return `${provider} is ready for read-only reads — nothing to send, nothing to sign.`;
    case "skipped":
      return `Run the doctor for ${provider} when you want this stage covered; the campaign records it skipped meanwhile.`;
    case "misconfigured":
      return `Fix the ${provider} endpoint (use a valid public http(s) URL or set the env var); never embed a key in a printed URL.`;
    case "timeout":
    case "rate-limited":
    case "unavailable":
    case "error":
      return `Retry ${provider} later or supply a healthier read-only endpoint; the campaign skips this stage honestly until it is reachable. Nothing here trades.`;
  }
}

function normalizeCheck(value: unknown, i: number): SniperProviderHealthCheck {
  if (!isObject(value)) throw new SniperProviderHealthReportError(`checks[${i}] must be an object`);
  const provider = value.provider;
  if (typeof provider !== "string" || !(SNIPER_PROVIDER_HEALTH_PROVIDERS as readonly string[]).includes(provider)) {
    throw new SniperProviderHealthReportError(`checks[${i}].provider must be one of: ${SNIPER_PROVIDER_HEALTH_PROVIDERS.join(", ")}`);
  }
  const status = value.status;
  if (typeof status !== "string" || !(SNIPER_PROVIDER_HEALTH_STATUSES as readonly string[]).includes(status)) {
    throw new SniperProviderHealthReportError(`checks[${i}].status must be one of: ${SNIPER_PROVIDER_HEALTH_STATUSES.join(", ")}`);
  }
  const checkId = (safeLabel(value.checkId, `checks[${i}].checkId`, 128, true) as string | null) ?? (provider as string);
  const latencyMs = normalizeLatency(value.latencyMs, `checks[${i}].latencyMs`);
  const redactedEndpoint = normalizeRedactedEndpoint(value.redactedEndpoint, `checks[${i}].redactedEndpoint`);
  const message =
    (safeLabel(value.message, `checks[${i}].message`, MAX_LINE_LEN, true) as string | null) ??
    defaultMessage(provider as SniperProviderHealthProvider, status as SniperProviderHealthStatus);
  const nextSafeAction =
    (safeLabel(value.nextSafeAction, `checks[${i}].nextSafeAction`, MAX_LINE_LEN, true) as string | null) ??
    defaultNextSafeAction(provider as SniperProviderHealthProvider, status as SniperProviderHealthStatus);
  return {
    checkId,
    provider: provider as SniperProviderHealthProvider,
    status: status as SniperProviderHealthStatus,
    latencyMs,
    redactedEndpoint,
    message,
    nextSafeAction,
  };
}

/** Re-derive the status counts across the checks. */
function deriveSummary(checks: readonly SniperProviderHealthCheck[]): SniperProviderHealthSummary {
  const summary: SniperProviderHealthSummary = {
    availableCount: 0,
    unavailableCount: 0,
    skippedCount: 0,
    misconfiguredCount: 0,
    timeoutCount: 0,
    rateLimitedCount: 0,
    errorCount: 0,
  };
  for (const c of checks) {
    switch (c.status) {
      case "available":
        summary.availableCount++;
        break;
      case "unavailable":
        summary.unavailableCount++;
        break;
      case "skipped":
        summary.skippedCount++;
        break;
      case "misconfigured":
        summary.misconfiguredCount++;
        break;
      case "timeout":
        summary.timeoutCount++;
        break;
      case "rate-limited":
        summary.rateLimitedCount++;
        break;
      case "error":
        summary.errorCount++;
        break;
    }
  }
  return summary;
}

/** A provider is "ready" only if it has at least one check and EVERY check for it is available. */
function providerReady(checks: readonly SniperProviderHealthCheck[], provider: SniperProviderHealthProvider): boolean {
  const own = checks.filter((c) => c.provider === provider);
  return own.length > 0 && own.every((c) => c.status === "available");
}

/** RE-DERIVE whether the read-only network dependencies a live campaign needs are all reachable. */
export function deriveCanRunLiveReadonlyCampaign(checks: readonly SniperProviderHealthCheck[]): boolean {
  return SNIPER_PROVIDER_HEALTH_LIVE_REQUIRED_PROVIDERS.every((p) => providerReady(checks, p));
}

// --- build -------------------------------------------------------------------

/**
 * Build a canonical {@link SniperProviderHealthReport} from the doctor's per-check facts. Pure,
 * non-mutating, deterministic. The summary counts and `canRunLiveReadonlyCampaign` are RE-DERIVED
 * from the checks; the safety literals are pinned. Throws {@link SniperProviderHealthReportError} on
 * any structural problem.
 */
export function buildSniperProviderHealthReport(input: BuildSniperProviderHealthReportInput): SniperProviderHealthReport {
  if (!isObject(input)) throw new SniperProviderHealthReportError("provider health report input must be an object");
  if (!Array.isArray(input.checks)) throw new SniperProviderHealthReportError("input.checks must be an array");
  if (input.checks.length > MAX_CHECKS) throw new SniperProviderHealthReportError(`input.checks exceeds ${MAX_CHECKS} entries`);

  const reportId = (safeLabel(input.reportId, "reportId", 128, true) as string | null) ?? "sniper-provider-health";
  const checkedAt = safeLabel(input.checkedAt, "checkedAt", 40, true);
  const mode = normalizeMode(input.mode);
  const network = normalizeNetwork(input.network, mode);
  const providerProfile = (safeLabel(input.providerProfile, "providerProfile", 64, true) as string | null) ?? "public-default";

  const checks = input.checks.map((c, i) => normalizeCheck(c, i));
  const summary = deriveSummary(checks);
  const canRunLiveReadonlyCampaign = deriveCanRunLiveReadonlyCampaign(checks);
  const extraCaveats = normalizeStringList(input.caveats, "caveats", MAX_LIST);

  return {
    schemaVersion: SNIPER_PROVIDER_HEALTH_REPORT_SCHEMA_VERSION,
    banner: SNIPER_PROVIDER_HEALTH_REPORT_BANNER,
    disclaimers: [...SNIPER_PROVIDER_HEALTH_REPORT_DISCLAIMERS],
    reportId,
    checkedAt,
    mode,
    network,
    providerProfile,
    checks,
    summary,
    canRunLiveReadonlyCampaign,
    canRunFixtureCampaign: true,
    noSend: true,
    noSigner: true,
    liveSendStatus: SNIPER_PROVIDER_HEALTH_LIVE_SEND_STATUS,
    authorizesLiveTrading: false,
    caveats: [...DEFAULT_CAVEATS, ...extraCaveats],
    redactionApplied: true,
  };
}

// --- validation (backstop + parity wall) -------------------------------------

const EXPECTED_KEYS = [
  "schemaVersion",
  "banner",
  "disclaimers",
  "reportId",
  "checkedAt",
  "mode",
  "network",
  "providerProfile",
  "checks",
  "summary",
  "canRunLiveReadonlyCampaign",
  "canRunFixtureCampaign",
  "noSend",
  "noSigner",
  "liveSendStatus",
  "authorizesLiveTrading",
  "caveats",
  "redactionApplied",
] as const;

const SUMMARY_KEYS = [
  "availableCount",
  "unavailableCount",
  "skippedCount",
  "misconfiguredCount",
  "timeoutCount",
  "rateLimitedCount",
  "errorCount",
] as const;

/**
 * Strictly validate a value as a canonical {@link SniperProviderHealthReport}. A backstop AND a parity
 * wall: the key set is CLOSED (no `signature` / `txid` / `sendResult` / `signer` field can appear); the
 * banner / mode / network / live-send / safety literals are pinned; every check is re-validated against
 * the closed provider + status sets; the summary counts are INDEPENDENTLY re-derived and must match;
 * `canRunLiveReadonlyCampaign` is re-derived and must match; `canRunFixtureCampaign` must be true.
 * Throws {@link SniperProviderHealthReportError} on the first problem. Pure.
 */
export function validateSniperProviderHealthReport(value: unknown): SniperProviderHealthReport {
  if (!isObject(value)) throw new SniperProviderHealthReportError("provider health report must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) {
      throw new SniperProviderHealthReportError(`provider health report has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  for (const key of EXPECTED_KEYS) {
    if (!(key in value)) throw new SniperProviderHealthReportError(`provider health report is missing field "${key}"`);
  }

  if (value.schemaVersion !== SNIPER_PROVIDER_HEALTH_REPORT_SCHEMA_VERSION) {
    throw new SniperProviderHealthReportError(`schemaVersion must be "${SNIPER_PROVIDER_HEALTH_REPORT_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_PROVIDER_HEALTH_REPORT_BANNER) throw new SniperProviderHealthReportError("banner must be the canonical banner");
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperProviderHealthReportError("disclaimers must be a non-empty array");
  }
  safeLabel(value.reportId, "reportId", 128, false);
  safeLabel(value.checkedAt, "checkedAt", 40, true);
  const mode = normalizeMode(value.mode);
  if (!(SNIPER_PROVIDER_HEALTH_NETWORKS as readonly string[]).includes(value.network as string)) {
    throw new SniperProviderHealthReportError(`network must be one of: ${SNIPER_PROVIDER_HEALTH_NETWORKS.join(", ")}`);
  }
  safeLabel(value.providerProfile, "providerProfile", 64, false);

  if (!Array.isArray(value.checks)) throw new SniperProviderHealthReportError("checks must be an array");
  if ((value.checks as unknown[]).length > MAX_CHECKS) throw new SniperProviderHealthReportError(`checks exceeds ${MAX_CHECKS} entries`);
  const checks = (value.checks as unknown[]).map((c, i) => normalizeCheck(c, i));
  // The echoed checks must already be canonical (the re-normalized form must round-trip).
  if (JSON.stringify(value.checks) !== JSON.stringify(checks)) {
    throw new SniperProviderHealthReportError("checks are not in canonical form (re-normalization differs)");
  }

  // PARITY WALL: the summary must be the independently re-derived counts.
  if (!isObject(value.summary)) throw new SniperProviderHealthReportError("summary must be an object");
  for (const k of Object.keys(value.summary)) {
    if (!(SUMMARY_KEYS as readonly string[]).includes(k)) throw new SniperProviderHealthReportError(`summary has unknown field "${k}"`);
  }
  const summary = deriveSummary(checks);
  for (const k of SUMMARY_KEYS) {
    if ((value.summary as Record<string, unknown>)[k] !== summary[k]) {
      throw new SniperProviderHealthReportError(`summary.${k} must be the re-derived count ${summary[k]}`);
    }
  }

  // PARITY WALL: canRunLiveReadonlyCampaign must be the re-derived value.
  const canRun = deriveCanRunLiveReadonlyCampaign(checks);
  if (value.canRunLiveReadonlyCampaign !== canRun) {
    throw new SniperProviderHealthReportError(`canRunLiveReadonlyCampaign must be the re-derived value ${String(canRun)}`);
  }
  if (value.canRunFixtureCampaign !== true) {
    throw new SniperProviderHealthReportError("canRunFixtureCampaign must literally be true (a fixture campaign needs no live provider)");
  }

  if (!Array.isArray(value.caveats) || (value.caveats as unknown[]).length === 0) {
    throw new SniperProviderHealthReportError("caveats must be a non-empty array");
  }

  for (const [field, expected] of [
    ["noSend", true],
    ["noSigner", true],
    ["authorizesLiveTrading", false],
    ["redactionApplied", true],
  ] as const) {
    if (value[field] !== expected) throw new SniperProviderHealthReportError(`${field} must literally be ${String(expected)}`);
  }
  if (value.liveSendStatus !== SNIPER_PROVIDER_HEALTH_LIVE_SEND_STATUS) {
    throw new SniperProviderHealthReportError(
      `liveSendStatus must literally be "${SNIPER_PROVIDER_HEALTH_LIVE_SEND_STATUS}" — a provider health report can never report live enabled`,
    );
  }
  // Belt-and-braces: the network must be the one the mode derives (devnet-review→devnet, else mainnet-beta).
  if (value.network !== networkForMode(mode)) {
    throw new SniperProviderHealthReportError(`network ${String(value.network)} contradicts mode ${mode} (expected ${networkForMode(mode)})`);
  }

  return value as unknown as SniperProviderHealthReport;
}

// --- alpha projection --------------------------------------------------------

/** The alpha report's per-provider status vocabulary. */
export type SniperAlphaProviderStatusLabel = "ok" | "degraded" | "unavailable" | "not-attempted";

function alphaStatusForProvider(checks: readonly SniperProviderHealthCheck[], provider: SniperProviderHealthProvider): SniperAlphaProviderStatusLabel {
  const own = checks.filter((c) => c.provider === provider);
  if (own.length === 0) return "not-attempted";
  if (own.every((c) => c.status === "available")) return "ok";
  if (own.every((c) => c.status === "skipped")) return "not-attempted";
  if (own.some((c) => c.status === "available")) return "degraded";
  return "unavailable";
}

/**
 * Project a provider health report onto the alpha run report's `providerHealth` shape
 * (`risk` ← rpc, `quote` ← jupiter-quote, `simulation` ← simulation). A convenience for the CLI so the
 * alpha report's provider summary stays consistent with the health report. Pure.
 */
export function summarizeProviderHealthForAlpha(report: SniperProviderHealthReport): {
  risk: SniperAlphaProviderStatusLabel;
  quote: SniperAlphaProviderStatusLabel;
  simulation: SniperAlphaProviderStatusLabel;
} {
  const checks = report.checks;
  const simulation = report.checks.some((c) => c.provider === "simulation")
    ? alphaStatusForProvider(checks, "simulation")
    : "not-attempted";
  return {
    risk: alphaStatusForProvider(checks, "rpc"),
    quote: alphaStatusForProvider(checks, "jupiter-quote"),
    simulation,
  };
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatSniperProviderHealthReport}. */
export interface FormatSniperProviderHealthReportOptions {
  label?: string;
}

/**
 * Render a redacted, stable, human-readable provider health summary. Deterministic and path-stable.
 * The whole output passes through the redactor.
 */
export function formatSniperProviderHealthReport(
  report: SniperProviderHealthReport,
  opts: FormatSniperProviderHealthReportOptions = {},
): string {
  const header = `${report.banner}`;
  const lines: string[] = [header, "=".repeat(Math.min(header.length, 80))];
  if (opts.label) lines.push(`label:      ${opts.label}`);
  lines.push(`report id:  ${report.reportId}`);
  lines.push(`mode:       ${report.mode} (${report.network})`);
  lines.push(`profile:    ${report.providerProfile}`);
  lines.push(`live:       ${report.liveSendStatus.toUpperCase()} (no send / no signer / authorizes live trading: ${String(report.authorizesLiveTrading)})`);
  lines.push(
    `can run:    live-readonly=${String(report.canRunLiveReadonlyCampaign)} · fixture=${String(report.canRunFixtureCampaign)}`,
  );
  lines.push(
    `summary:    ${report.summary.availableCount} available · ${report.summary.unavailableCount} unavailable · ${report.summary.timeoutCount} timeout · ${report.summary.rateLimitedCount} rate-limited · ${report.summary.misconfiguredCount} misconfigured · ${report.summary.errorCount} error · ${report.summary.skippedCount} skipped`,
  );

  lines.push("");
  lines.push("Checks:");
  for (const c of report.checks) {
    const bits: string[] = [];
    if (c.redactedEndpoint !== null) bits.push(c.redactedEndpoint);
    if (c.latencyMs !== null) bits.push(`${c.latencyMs}ms`);
    lines.push(`[${c.status}] ${c.provider}${bits.length > 0 ? `  (${bits.join("; ")})` : ""}  — ${c.message}`);
  }
  if (report.checks.length === 0) lines.push("(no checks)");

  lines.push("");
  lines.push("Next safe actions:");
  for (const c of report.checks) lines.push(`- ${c.provider}: ${c.nextSafeAction}`);

  lines.push("");
  lines.push("Caveats:");
  for (const c of report.caveats) lines.push(`- ${c}`);
  lines.push("");
  for (const d of report.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
