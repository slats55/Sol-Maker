/**
 * Strict validator for `engine.status.report.v1` — the artifact the Rust
 * sidecar emits. TypeScript is the validation AUTHORITY: Rust output is never
 * trusted unvalidated, the key set is CLOSED (an unknown field refuses the
 * artifact), and every execution-shaped marker must literally be "disabled".
 */

export const ENGINE_STATUS_SCHEMA_VERSION = "engine.status.report.v1";

/** The stdout JSON contract version the bridge speaks. */
export const ENGINE_IPC_VERSION = "engine.ipc.v1";

/** The engine capabilities this bridge recognizes. CLOSED set — a capability
 * lands here only after a reviewed safety decision (S98 replay normalization,
 * S99 route-quote scoring, S100 simulation classification + unsigned-tx shape
 * inspection, S101 sniper candidate scoring — all over bounded stdin, all
 * READ-only; still no network/sign/send capability). */
export const ENGINE_SUPPORTED_CAPABILITY_ALLOWLIST = [
  "json-ipc",
  "realtime-replay-normalize",
  "routequote-score",
  "schema-parity",
  "sim-classification",
  "sniper-candidate-score",
  "status",
  "tx-inspection",
] as const;

/** Capabilities the engine must explicitly declare disabled. */
export const ENGINE_REQUIRED_DISABLED_CAPABILITIES = [
  "mainnet-live",
  "seed-phrase-handling",
  "sending",
  "signing",
  "wallet-loading",
] as const;

export interface EngineStatusReportV1 {
  readonly schemaVersion: typeof ENGINE_STATUS_SCHEMA_VERSION;
  readonly banner: string;
  readonly engineName: "solmaker-engine";
  readonly engineVersion: string;
  readonly buildProfile: "debug" | "release";
  readonly rustcVersion: string | null;
  readonly ipcVersion: typeof ENGINE_IPC_VERSION;
  readonly safetyMode: "sidecar-read-only";
  readonly signerSupport: "disabled";
  readonly sendSupport: "disabled";
  readonly mainnetSendSupport: "disabled";
  readonly supportedCapabilities: readonly string[];
  readonly disabledCapabilities: readonly string[];
  readonly createdAt: string | null;
  readonly caveats: readonly string[];
  readonly neverSends: true;
  readonly phase7LiveTradingReady: false;
}

const EXPECTED_KEYS = [
  "schemaVersion",
  "banner",
  "engineName",
  "engineVersion",
  "buildProfile",
  "rustcVersion",
  "ipcVersion",
  "safetyMode",
  "signerSupport",
  "sendSupport",
  "mainnetSendSupport",
  "supportedCapabilities",
  "disabledCapabilities",
  "createdAt",
  "caveats",
  "neverSends",
  "phase7LiveTradingReady",
] as const;

const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/;
const VERSION_SHAPE = /^\d+\.\d+\.\d+$/;

export type EngineStatusValidation =
  | { readonly ok: true; readonly report: EngineStatusReportV1 }
  | { readonly ok: false; readonly problems: readonly string[] };

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Validate an unknown parsed value as `engine.status.report.v1`, strictly. */
export function validateEngineStatusReportV1(value: unknown): EngineStatusValidation {
  const problems: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, problems: ["artifact is not a JSON object"] };
  }
  const obj = value as Record<string, unknown>;

  const keys = Object.keys(obj);
  for (const key of keys) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) {
      problems.push(`unknown field ${JSON.stringify(key)} (the schema is CLOSED — update both sides together)`);
    }
  }
  for (const key of EXPECTED_KEYS) {
    if (!(key in obj)) problems.push(`missing field ${JSON.stringify(key)}`);
  }

  if (obj.schemaVersion !== ENGINE_STATUS_SCHEMA_VERSION) {
    problems.push(`schemaVersion must be ${JSON.stringify(ENGINE_STATUS_SCHEMA_VERSION)}`);
  }
  if (typeof obj.banner !== "string" || obj.banner.length === 0 || obj.banner.length > 500) {
    problems.push("banner must be a non-empty string (max 500 chars)");
  }
  if (obj.engineName !== "solmaker-engine") {
    problems.push('engineName must be "solmaker-engine"');
  }
  if (typeof obj.engineVersion !== "string" || !VERSION_SHAPE.test(obj.engineVersion)) {
    problems.push("engineVersion must be a semver-shaped string");
  }
  if (obj.buildProfile !== "debug" && obj.buildProfile !== "release") {
    problems.push('buildProfile must be "debug" or "release"');
  }
  if (obj.rustcVersion !== null && (typeof obj.rustcVersion !== "string" || obj.rustcVersion.length === 0 || obj.rustcVersion.length > 120)) {
    problems.push("rustcVersion must be null or a non-empty string (max 120 chars)");
  }
  if (obj.ipcVersion !== ENGINE_IPC_VERSION) {
    problems.push(`ipcVersion must be ${JSON.stringify(ENGINE_IPC_VERSION)}`);
  }
  if (obj.safetyMode !== "sidecar-read-only") {
    problems.push('safetyMode must be "sidecar-read-only"');
  }
  for (const marker of ["signerSupport", "sendSupport", "mainnetSendSupport"] as const) {
    if (obj[marker] !== "disabled") {
      problems.push(`${marker} must literally be "disabled" — anything else refuses the artifact`);
    }
  }
  if (!isStringArray(obj.supportedCapabilities) || obj.supportedCapabilities.length === 0) {
    problems.push("supportedCapabilities must be a non-empty string array");
  } else {
    const allow = ENGINE_SUPPORTED_CAPABILITY_ALLOWLIST as readonly string[];
    for (const cap of obj.supportedCapabilities) {
      if (!allow.includes(cap)) {
        problems.push(`supported capability ${JSON.stringify(cap)} is not on the reviewed allowlist`);
      }
    }
    if (new Set(obj.supportedCapabilities).size !== obj.supportedCapabilities.length) {
      problems.push("supportedCapabilities must not contain duplicates");
    }
  }
  if (!isStringArray(obj.disabledCapabilities)) {
    problems.push("disabledCapabilities must be a string array");
  } else {
    for (const required of ENGINE_REQUIRED_DISABLED_CAPABILITIES) {
      if (!obj.disabledCapabilities.includes(required)) {
        problems.push(`disabledCapabilities must explicitly include ${JSON.stringify(required)}`);
      }
    }
  }
  if (obj.createdAt !== null && (typeof obj.createdAt !== "string" || obj.createdAt.length > 40 || !ISO_SHAPE.test(obj.createdAt))) {
    problems.push("createdAt must be null or an ISO-8601-shaped UTC string");
  }
  if (!isStringArray(obj.caveats) || obj.caveats.length === 0 || obj.caveats.some((c) => c.length === 0 || c.length > 500)) {
    problems.push("caveats must be a non-empty array of non-empty strings (max 500 chars each)");
  }
  if (obj.neverSends !== true) {
    problems.push("neverSends must literally be true");
  }
  if (obj.phase7LiveTradingReady !== false) {
    problems.push("phase7LiveTradingReady must literally be false");
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, report: obj as unknown as EngineStatusReportV1 };
}
