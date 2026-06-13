/**
 * Deterministic, **read-only** SNIPER OPERATOR DEMO manifest (Sprint 103-B).
 *
 * `sniper.operator_demo.manifest.v1` ties together a SAFE, showable demo folder: a curated set of
 * Sol Maker's paper / dry-run pipeline artifacts, each labelled with its provenance so a viewer can
 * never mistake a fixture or a fictional example for live evidence. It is a "look what Sol Maker can
 * do" exhibit — never a live trading bot.
 *
 * It is **pure** and does NO filesystem / network work: the orchestrator gathers the artifact refs
 * (after building / copying / validating each file) and hands them here. The manifest is structurally
 * incapable of claiming live readiness:
 *
 *   - `liveExecutionDisabled` is pinned true and `whyLiveDisabled` records the honest reason;
 *   - `neverSends` is pinned true, `phase7LiveTradingReady` pinned false;
 *   - every artifact carries a CLOSED `evidenceClass` (real-readonly | fixture | fictional-example),
 *     and the counts are RE-DERIVED;
 *   - every pipeline stage's `evidencedBy` must reference an artifact role actually present.
 */

import { redactString } from "@soulmaker/security";

/** Stable schema identifier. Bump only on a breaking change. */
export const SNIPER_OPERATOR_DEMO_MANIFEST_SCHEMA_VERSION = "sniper.operator_demo.manifest.v1";

/** The banner that prefixes every demo manifest (required label). */
export const SNIPER_OPERATOR_DEMO_BANNER =
  "SNIPER OPERATOR DEMO — a SAFE, read-only showcase of Sol Maker's paper / dry-run pipeline. Nothing here sends, signs, or trades; live execution is DISABLED and every artifact is labelled by provenance.";

/** Required disclaimer statements carried by every demo manifest (stable order). */
export const SNIPER_OPERATOR_DEMO_DISCLAIMERS: readonly string[] = [
  "This is a demonstration exhibit, not a live trading bot. It never signs, sends, or authorizes a trade.",
  "Each artifact is labelled real-readonly (observed read-only evidence), fixture (an honest stand-in), or fictional-example (invented mints) — never live trade evidence.",
  "Live trading stays DISABLED: the fourteen-condition mainnet live gate defaults blocked, there is no mainnet-send command, and Phase 7 authorization is not granted.",
];

/** The honest, fixed reason live execution is disabled in this repo. */
export const SNIPER_OPERATOR_DEMO_WHY_LIVE_DISABLED =
  "Live trading is disabled by default and structurally unreachable: the fourteen-condition mainnet live gate defaults to blocked, no CLI command can send on mainnet, the signer boundary refuses a mainnet load without an armed gate, and Phase 7 authorization stays design-only until a confirmed devnet broadcast and a written human sign-off exist.";

/** Closed provenance set for a demo artifact. */
export const OPERATOR_DEMO_EVIDENCE_CLASSES = ["real-readonly", "fixture", "fictional-example"] as const;
export type OperatorDemoEvidenceClass = (typeof OPERATOR_DEMO_EVIDENCE_CLASSES)[number];

const MAX_LABEL_LEN = 200;
const MAX_LINE_LEN = 400;
const MAX_LIST = 64;

/** Thrown when a demo-manifest INPUT or produced artifact is structurally invalid. */
export class SniperOperatorDemoManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SniperOperatorDemoManifestError";
  }
}

/** One artifact in the demo folder, with its provenance and integrity. */
export interface OperatorDemoArtifactRef {
  role: string;
  fileName: string;
  schemaVersion: string | null;
  evidenceClass: OperatorDemoEvidenceClass;
  present: boolean;
  valid: boolean;
  summary: string;
}

/** One pipeline stage the demo showcases, pointing at the artifact that evidences it. */
export interface OperatorDemoStage {
  stage: string;
  description: string;
  evidencedBy: string;
}

/** Everything {@link buildSniperOperatorDemoManifest} accepts. */
export interface BuildSniperOperatorDemoManifestInput {
  demoId?: string;
  generatedAt?: string | null;
  artifacts: OperatorDemoArtifactRef[];
  stages: OperatorDemoStage[];
  caveats?: string[];
}

/** The full, deterministic, JSON-serializable operator demo manifest. */
export interface SniperOperatorDemoManifest {
  schemaVersion: string;
  banner: string;
  disclaimers: string[];
  demoId: string;
  generatedAt: string | null;
  liveExecutionDisabled: true;
  whyLiveDisabled: string;
  pipelineStages: OperatorDemoStage[];
  stageCount: number;
  artifacts: OperatorDemoArtifactRef[];
  artifactCount: number;
  realReadonlyCount: number;
  fixtureCount: number;
  fictionalExampleCount: number;
  allArtifactsValid: boolean;
  nextSafeAction: string;
  caveats: string[];
  neverSends: true;
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
      throw new SniperOperatorDemoManifestError(`${name} contains a control character, NUL, or BOM and is refused`);
    }
  }
}

function safeLabel(value: unknown, name: string, max: number, nullable: boolean): string | null {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw new SniperOperatorDemoManifestError(`${name} is required`);
  }
  if (typeof value !== "string") throw new SniperOperatorDemoManifestError(`${name} must be a string`);
  rejectControlChars(value, name);
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (nullable) return null;
    throw new SniperOperatorDemoManifestError(`${name} must be a non-empty string`);
  }
  if (trimmed.length > max) throw new SniperOperatorDemoManifestError(`${name} exceeds ${max} characters`);
  if (redactString(trimmed) !== trimmed) throw new SniperOperatorDemoManifestError(`${name} is secret-shaped and is refused`);
  return trimmed;
}

function safeProse(value: unknown, name: string, max: number): string {
  if (typeof value !== "string") throw new SniperOperatorDemoManifestError(`${name} must be a string`);
  rejectControlChars(value, name);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new SniperOperatorDemoManifestError(`${name} must be a non-empty string`);
  if (trimmed.length > max) throw new SniperOperatorDemoManifestError(`${name} exceeds ${max} characters`);
  return redactString(trimmed);
}

function reqBool(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new SniperOperatorDemoManifestError(`${name} must be a boolean`);
  return value;
}

function normalizeStringList(value: unknown, name: string, maxCount: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SniperOperatorDemoManifestError(`${name} must be an array of strings`);
  if (value.length > maxCount) throw new SniperOperatorDemoManifestError(`${name} exceeds ${maxCount} entries`);
  return value.map((s, i) => safeProse(s, `${name}[${i}]`, MAX_LINE_LEN));
}

function normalizeArtifact(raw: unknown, index: number): OperatorDemoArtifactRef {
  if (!isObject(raw)) throw new SniperOperatorDemoManifestError(`artifacts[${index}] must be an object`);
  if (typeof raw.evidenceClass !== "string" || !(OPERATOR_DEMO_EVIDENCE_CLASSES as readonly string[]).includes(raw.evidenceClass)) {
    throw new SniperOperatorDemoManifestError(`artifacts[${index}].evidenceClass must be one of: ${OPERATOR_DEMO_EVIDENCE_CLASSES.join(", ")}`);
  }
  return {
    role: safeLabel(raw.role, `artifacts[${index}].role`, 64, false) as string,
    fileName: safeLabel(raw.fileName, `artifacts[${index}].fileName`, MAX_LABEL_LEN, false) as string,
    schemaVersion: safeLabel(raw.schemaVersion, `artifacts[${index}].schemaVersion`, MAX_LABEL_LEN, true),
    evidenceClass: raw.evidenceClass as OperatorDemoEvidenceClass,
    present: reqBool(raw.present, `artifacts[${index}].present`),
    valid: reqBool(raw.valid, `artifacts[${index}].valid`),
    summary: safeProse(raw.summary, `artifacts[${index}].summary`, MAX_LINE_LEN),
  };
}

function normalizeStage(raw: unknown, index: number, roles: ReadonlySet<string>): OperatorDemoStage {
  if (!isObject(raw)) throw new SniperOperatorDemoManifestError(`stages[${index}] must be an object`);
  const evidencedBy = safeLabel(raw.evidencedBy, `stages[${index}].evidencedBy`, 64, false) as string;
  if (!roles.has(evidencedBy)) {
    throw new SniperOperatorDemoManifestError(`stages[${index}].evidencedBy "${evidencedBy}" is not a present artifact role`);
  }
  return {
    stage: safeLabel(raw.stage, `stages[${index}].stage`, 64, false) as string,
    description: safeProse(raw.description, `stages[${index}].description`, MAX_LINE_LEN),
    evidencedBy,
  };
}

function deriveNextSafeAction(allValid: boolean): string {
  return allValid
    ? "Inspect this demo folder with `pnpm web:inspect --dir <folder>` or open /sniper. Everything here is paper / dry-run; live trading stays disabled until a confirmed devnet broadcast and a written Phase 7 sign-off exist."
    : "One or more demo artifacts are missing or invalid — regenerate the demo with `paper:sniper:operator-demo --force`. Nothing here trades; live execution stays disabled.";
}

const DEFAULT_CAVEATS: readonly string[] = [
  "Every 'fictional-example' artifact uses invented mints and is NOT real market data.",
  "A 'fixture' artifact is an honest stand-in (e.g. a funding-status snapshot) — not a live read.",
  "Even the real read-only artifacts (the Phase 7 audit, the sign-off template) authorize nothing and execute nothing.",
];

// --- build -------------------------------------------------------------------

/**
 * Build a canonical {@link SniperOperatorDemoManifest}. Pure, non-mutating, deterministic. The counts
 * and `allArtifactsValid` are RE-DERIVED; every stage must be evidenced by a present artifact role.
 * Throws {@link SniperOperatorDemoManifestError} on any structural problem.
 */
export function buildSniperOperatorDemoManifest(input: BuildSniperOperatorDemoManifestInput): SniperOperatorDemoManifest {
  if (!isObject(input)) throw new SniperOperatorDemoManifestError("demo manifest input must be an object");

  const demoId = (safeLabel(input.demoId, "demoId", 128, true) as string | null) ?? "sniper-operator-demo";
  const generatedAt = safeLabel(input.generatedAt, "generatedAt", 40, true);

  if (!Array.isArray(input.artifacts) || input.artifacts.length === 0) {
    throw new SniperOperatorDemoManifestError("artifacts must be a non-empty array");
  }
  if (input.artifacts.length > MAX_LIST) throw new SniperOperatorDemoManifestError(`artifacts exceeds ${MAX_LIST} entries`);
  const artifacts = input.artifacts.map((a, i) => normalizeArtifact(a, i));
  const roles = new Set(artifacts.map((a) => a.role));
  if (roles.size !== artifacts.length) throw new SniperOperatorDemoManifestError("artifact roles must be unique");

  if (!Array.isArray(input.stages) || input.stages.length === 0) {
    throw new SniperOperatorDemoManifestError("stages must be a non-empty array");
  }
  if (input.stages.length > MAX_LIST) throw new SniperOperatorDemoManifestError(`stages exceeds ${MAX_LIST} entries`);
  const stages = input.stages.map((s, i) => normalizeStage(s, i, roles));

  const realReadonlyCount = artifacts.filter((a) => a.evidenceClass === "real-readonly").length;
  const fixtureCount = artifacts.filter((a) => a.evidenceClass === "fixture").length;
  const fictionalExampleCount = artifacts.filter((a) => a.evidenceClass === "fictional-example").length;
  const allArtifactsValid = artifacts.every((a) => a.present && a.valid);

  const caveats = normalizeStringList(input.caveats ?? [...DEFAULT_CAVEATS], "caveats", MAX_LIST);

  return {
    schemaVersion: SNIPER_OPERATOR_DEMO_MANIFEST_SCHEMA_VERSION,
    banner: SNIPER_OPERATOR_DEMO_BANNER,
    disclaimers: [...SNIPER_OPERATOR_DEMO_DISCLAIMERS],
    demoId,
    generatedAt,
    liveExecutionDisabled: true,
    whyLiveDisabled: SNIPER_OPERATOR_DEMO_WHY_LIVE_DISABLED,
    pipelineStages: stages,
    stageCount: stages.length,
    artifacts,
    artifactCount: artifacts.length,
    realReadonlyCount,
    fixtureCount,
    fictionalExampleCount,
    allArtifactsValid,
    nextSafeAction: deriveNextSafeAction(allArtifactsValid),
    caveats,
    neverSends: true,
    phase7LiveTradingReady: false,
  };
}

// --- validation (backstop + parity wall) -------------------------------------

const EXPECTED_KEYS = [
  "schemaVersion",
  "banner",
  "disclaimers",
  "demoId",
  "generatedAt",
  "liveExecutionDisabled",
  "whyLiveDisabled",
  "pipelineStages",
  "stageCount",
  "artifacts",
  "artifactCount",
  "realReadonlyCount",
  "fixtureCount",
  "fictionalExampleCount",
  "allArtifactsValid",
  "nextSafeAction",
  "caveats",
  "neverSends",
  "phase7LiveTradingReady",
] as const;

/**
 * Strictly validate a value as a canonical {@link SniperOperatorDemoManifest}. A backstop AND a
 * parity wall: the key set is CLOSED; the safety literals are pinned; the counts, `allArtifactsValid`,
 * and the stage→artifact references are INDEPENDENTLY re-derived and must match. Throws
 * {@link SniperOperatorDemoManifestError}. Pure.
 */
export function validateSniperOperatorDemoManifest(value: unknown): SniperOperatorDemoManifest {
  if (!isObject(value)) throw new SniperOperatorDemoManifestError("demo manifest must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) {
      throw new SniperOperatorDemoManifestError(`demo manifest has unknown field "${key}" (the schema is CLOSED)`);
    }
  }
  for (const key of EXPECTED_KEYS) {
    if (!(key in value)) throw new SniperOperatorDemoManifestError(`demo manifest is missing field "${key}"`);
  }

  if (value.schemaVersion !== SNIPER_OPERATOR_DEMO_MANIFEST_SCHEMA_VERSION) {
    throw new SniperOperatorDemoManifestError(`schemaVersion must be "${SNIPER_OPERATOR_DEMO_MANIFEST_SCHEMA_VERSION}"`);
  }
  if (value.banner !== SNIPER_OPERATOR_DEMO_BANNER) throw new SniperOperatorDemoManifestError("banner must be the canonical banner");
  if (value.whyLiveDisabled !== SNIPER_OPERATOR_DEMO_WHY_LIVE_DISABLED) {
    throw new SniperOperatorDemoManifestError("whyLiveDisabled must be the canonical reason");
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new SniperOperatorDemoManifestError("disclaimers must be a non-empty array");
  }
  safeLabel(value.demoId, "demoId", 128, false);
  safeLabel(value.generatedAt, "generatedAt", 40, true);

  if (!Array.isArray(value.artifacts) || value.artifacts.length === 0) throw new SniperOperatorDemoManifestError("artifacts must be a non-empty array");
  const artifacts = (value.artifacts as unknown[]).map((a, i) => normalizeArtifact(a, i));
  const roles = new Set(artifacts.map((a) => a.role));
  if (roles.size !== artifacts.length) throw new SniperOperatorDemoManifestError("artifact roles must be unique");
  if (value.artifactCount !== artifacts.length) throw new SniperOperatorDemoManifestError("artifactCount must equal artifacts.length");

  if (!Array.isArray(value.pipelineStages) || value.pipelineStages.length === 0) throw new SniperOperatorDemoManifestError("pipelineStages must be a non-empty array");
  const stages = (value.pipelineStages as unknown[]).map((s, i) => normalizeStage(s, i, roles));
  if (value.stageCount !== stages.length) throw new SniperOperatorDemoManifestError("stageCount must equal pipelineStages.length");

  const realReadonlyCount = artifacts.filter((a) => a.evidenceClass === "real-readonly").length;
  const fixtureCount = artifacts.filter((a) => a.evidenceClass === "fixture").length;
  const fictionalExampleCount = artifacts.filter((a) => a.evidenceClass === "fictional-example").length;
  if (value.realReadonlyCount !== realReadonlyCount) throw new SniperOperatorDemoManifestError("realReadonlyCount must be re-derived from the artifacts");
  if (value.fixtureCount !== fixtureCount) throw new SniperOperatorDemoManifestError("fixtureCount must be re-derived from the artifacts");
  if (value.fictionalExampleCount !== fictionalExampleCount) throw new SniperOperatorDemoManifestError("fictionalExampleCount must be re-derived from the artifacts");

  const allArtifactsValid = artifacts.every((a) => a.present && a.valid);
  if (value.allArtifactsValid !== allArtifactsValid) throw new SniperOperatorDemoManifestError("allArtifactsValid must be re-derived from the artifacts");

  if (typeof value.nextSafeAction !== "string" || value.nextSafeAction.trim().length === 0) {
    throw new SniperOperatorDemoManifestError("nextSafeAction must be a non-empty string");
  }
  if (!Array.isArray(value.caveats) || value.caveats.length === 0) throw new SniperOperatorDemoManifestError("caveats must be a non-empty array");

  if (value.liveExecutionDisabled !== true) throw new SniperOperatorDemoManifestError("liveExecutionDisabled must literally be true");
  if (value.neverSends !== true) throw new SniperOperatorDemoManifestError("neverSends must literally be true");
  if (value.phase7LiveTradingReady !== false) throw new SniperOperatorDemoManifestError("phase7LiveTradingReady must literally be false");

  return value as unknown as SniperOperatorDemoManifest;
}
