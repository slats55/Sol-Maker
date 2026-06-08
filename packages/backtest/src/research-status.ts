/**
 * Deterministic, offline, **simulated-only** RESEARCH RUN STATUS / INTEGRITY summary (Sprint 17).
 *
 * Sits beside the Sprint 17 {@link import("./research-bundle.js").buildBacktestResearchBundle bundle}
 * and answers a single at-a-glance question about a LOCAL PAPER-only research directory:
 *
 *   "Does this research run look COMPLETE (has artifacts), RECOGNIZED (every file classified),
 *    STABLE (no unparseable files), and IN SYNC (matches its recorded manifest, if any)?"
 *
 * It is **pure** and does NO filesystem/network IO of its own: the CLI walks the directory,
 * classifies + digests each file, and (optionally) loads a previously-written manifest, then
 * hands the already-loaded descriptors and manifest here. The status reuses the Sprint 16/17
 * building blocks — it builds a {@link buildBacktestResearchBundle bundle candidate} to derive
 * the counts/digests and runs {@link verifyBacktestResearchManifest} to detect drift — so it
 * never re-implements classification or verification.
 *
 * The `recommendedAction` is NEUTRAL, operational text about the artifact directory (e.g.
 * "re-record the manifest"); it is NEVER trading advice. The status carries NO wall-clock
 * timestamp, so it stays byte-stable for a given directory + manifest.
 *
 * This is bookkeeping over injected, simulated local artifacts — NOT a live result, NOT real
 * market data, NOT advice, and NOT a profitability claim. Nothing here holds a key, or
 * builds/signs/simulates/sends a transaction.
 */

import {
  buildBacktestResearchBundle,
  buildBacktestResearchRunDigest,
} from "./research-bundle.js";
import {
  buildBacktestResearchManifest,
  verifyBacktestResearchManifest,
  BACKTEST_ARTIFACT_KINDS,
  type BacktestArtifactDescriptor,
  type BacktestArtifactKind,
} from "./research-manifest.js";

/** Stable schema identifier for the research status report. Bump only on a breaking change. */
export const BACKTEST_RESEARCH_STATUS_SCHEMA_VERSION = "backtest.research.status.v1";

/** The banner that prefixes every research status report (required label). */
export const BACKTEST_RESEARCH_STATUS_BANNER = "SIMULATED PAPER-ONLY RESEARCH STATUS";

/** Required disclaimer statements carried by every status report (stable order). */
export const BACKTEST_RESEARCH_STATUS_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY RESEARCH STATUS — an at-a-glance health check of a LOCAL research directory.",
  "Reads local artifacts only — it is not live data and fetched nothing.",
  "The recommended action is operational guidance about the artifact directory, NOT trading advice.",
  "Any digest mentioned is a non-cryptographic, reproducibility-only fingerprint, NOT a security guarantee.",
  "Not a live result.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this status.",
];

/** Thrown only when status INPUT or a produced status is structurally invalid. */
export class BacktestResearchStatusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestResearchStatusError";
  }
}

// --- input -------------------------------------------------------------------

/** Everything {@link buildBacktestResearchStatus} needs (already-loaded descriptors + optional manifest). */
export interface BuildBacktestResearchStatusInput {
  /** Optional run label (e.g. the artifact directory name). */
  runName?: string;
  /** The already-loaded CURRENT artifact descriptors (≥0). */
  artifacts: BacktestArtifactDescriptor[];
  /**
   * Relative paths of CURRENT artifacts that were unparseable JSON (a subset of unknown-json).
   * The CLI passes this; the pure layer cannot tell malformed from parseable-unrecognized.
   */
  malformedPaths?: string[];
  /**
   * An optional already-loaded manifest object to check the current directory against. When
   * present, drift (missing / extra / digest-/schema-/size-changed) is reported. A structurally
   * invalid manifest is refused (throws {@link BacktestResearchStatusError}).
   */
  manifest?: unknown;
}

// --- status model ------------------------------------------------------------

/** The manifest-drift portion of a status (zeroed when no manifest was provided). */
export interface BacktestResearchStatusManifestCheck {
  /** Whether a manifest was provided to check against. */
  present: boolean;
  /** True iff a manifest was provided AND the directory matches it exactly. */
  inSync: boolean;
  okCount: number;
  missingCount: number;
  extraCount: number;
  digestChangedCount: number;
  schemaChangedCount: number;
  sizeChangedCount: number;
}

/**
 * The full, deterministic, byte-stable research status report. JSON-serializable as-is. Carries
 * the required PAPER-ONLY / not-a-live-result / not-advice language so it survives serialization.
 */
export interface BacktestResearchStatus {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  runName: string | null;
  /** The non-cryptographic run digest of the CURRENT directory (reproducibility fingerprint). */
  runDigest: string;
  artifactCount: number;
  totalSizeBytes: number;
  /** Kinds present in the directory, sorted ascending. */
  kindsPresent: BacktestArtifactKind[];
  /** Recognized schema versions present, sorted ascending. */
  schemasPresent: string[];
  /** Artifacts whose schema/shape was not recognized (kind "unknown-json"). */
  unknownArtifactCount: number;
  /** Artifacts that were unparseable JSON (a subset of the unknown count). */
  malformedArtifactCount: number;
  /** COMPLETE: the directory has at least one artifact. */
  complete: boolean;
  /** RECOGNIZED: every artifact classified to a known kind (no unknown-json). */
  recognized: boolean;
  /** STABLE: no artifact was unparseable JSON. */
  stable: boolean;
  /** Whether a valid {@link buildBacktestResearchBundle bundle} could be built from the directory. */
  bundleCandidateValid: boolean;
  /** The reason a bundle candidate is invalid, else null. */
  bundleCandidateError: string | null;
  /** Manifest drift summary (zeroed when no manifest was provided). */
  manifest: BacktestResearchStatusManifestCheck;
  /** Reproducibility-only warnings (unknown, malformed, drift, empty, …). */
  warnings: string[];
  /** A single, neutral, operational next step about the directory (never trading advice). */
  recommendedAction: string;
  /** Bookkeeping-only notes. */
  notes: string[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function comparePath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const ARTIFACT_KIND_SET = new Set<string>(BACKTEST_ARTIFACT_KINDS);

const EMPTY_MANIFEST_CHECK: BacktestResearchStatusManifestCheck = {
  present: false,
  inSync: false,
  okCount: 0,
  missingCount: 0,
  extraCount: 0,
  digestChangedCount: 0,
  schemaChangedCount: 0,
  sizeChangedCount: 0,
};

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic, byte-stable {@link BacktestResearchStatus} for a CURRENT research
 * directory's descriptors, optionally checked against a recorded manifest. Pure and
 * non-mutating. Reuses {@link buildBacktestResearchManifest} (to validate + summarize the
 * descriptors), {@link buildBacktestResearchBundle} (to probe bundle-candidate validity and the
 * malformed count), and {@link verifyBacktestResearchManifest} (for drift). Throws
 * {@link BacktestResearchStatusError} on structurally invalid descriptors or a malformed manifest.
 */
export function buildBacktestResearchStatus(
  input: BuildBacktestResearchStatusInput,
): BacktestResearchStatus {
  if (!isObject(input)) {
    throw new BacktestResearchStatusError("status input must be an object");
  }
  if (input.runName !== undefined && typeof input.runName !== "string") {
    throw new BacktestResearchStatusError("status input.runName must be a string when present");
  }
  if (!Array.isArray(input.artifacts)) {
    throw new BacktestResearchStatusError("status input.artifacts must be an array");
  }
  if (input.malformedPaths !== undefined && !Array.isArray(input.malformedPaths)) {
    throw new BacktestResearchStatusError("status input.malformedPaths must be an array when present");
  }

  // Canonical, validated view of the directory (refuses structurally bad descriptors).
  let manifest;
  try {
    manifest = buildBacktestResearchManifest({ runName: input.runName, artifacts: input.artifacts });
  } catch (err) {
    throw new BacktestResearchStatusError((err as Error).message);
  }
  const artifacts = manifest.artifacts; // validated + path-sorted

  // Probe the full bundle candidate (validates the malformedPaths subset too).
  let bundleCandidateValid = true;
  let bundleCandidateError: string | null = null;
  let malformedArtifactCount = 0;
  let warnings: string[];
  try {
    const bundle = buildBacktestResearchBundle({
      runName: input.runName,
      artifacts: input.artifacts,
      malformedPaths: input.malformedPaths,
    });
    malformedArtifactCount = bundle.malformedArtifactCount;
    warnings = [...bundle.warnings];
  } catch (err) {
    bundleCandidateValid = false;
    bundleCandidateError = (err as Error).message;
    // Fall back to the manifest's warnings; the malformed list was untrustworthy → count 0.
    warnings = [...manifest.warnings];
    warnings.push(`bundle candidate is invalid: ${bundleCandidateError}`);
  }

  const runDigest = buildBacktestResearchRunDigest(artifacts);

  const kindsPresent = manifest.kindCounts.map((k) => k.kind).sort(comparePath) as BacktestArtifactKind[];
  const schemasPresent = [
    ...new Set(
      artifacts
        .filter((a) => a.kind !== "unknown-json" && a.schemaVersion !== null)
        .map((a) => a.schemaVersion as string),
    ),
  ].sort(comparePath);
  const unknownArtifactCount = artifacts.filter((a) => a.kind === "unknown-json").length;

  // Manifest drift (only when a manifest was provided).
  let manifestCheck: BacktestResearchStatusManifestCheck = { ...EMPTY_MANIFEST_CHECK };
  if (input.manifest !== undefined && input.manifest !== null) {
    let verification;
    try {
      verification = verifyBacktestResearchManifest(input.manifest, input.artifacts);
    } catch (err) {
      throw new BacktestResearchStatusError(`manifest check failed: ${(err as Error).message}`);
    }
    let digestChangedCount = 0;
    let schemaChangedCount = 0;
    let sizeChangedCount = 0;
    for (const a of verification.artifacts) {
      if (a.status === "digest-changed") digestChangedCount += 1;
      else if (a.status === "schema-changed") schemaChangedCount += 1;
      else if (a.status === "size-changed") sizeChangedCount += 1;
    }
    manifestCheck = {
      present: true,
      inSync: verification.valid,
      okCount: verification.okCount,
      missingCount: verification.missingCount,
      extraCount: verification.extraCount,
      digestChangedCount,
      schemaChangedCount,
      sizeChangedCount,
    };
    if (!verification.valid) {
      warnings.push(
        `manifest drift: ${verification.missingCount} missing, ${verification.extraCount} extra, ` +
          `${digestChangedCount + schemaChangedCount + sizeChangedCount} changed.`,
      );
    }
  }

  const complete = artifacts.length > 0;
  const recognized = unknownArtifactCount === 0;
  const stable = malformedArtifactCount === 0;

  const recommendedAction = recommendAction({
    bundleCandidateValid,
    bundleCandidateError,
    malformedArtifactCount,
    artifactCount: artifacts.length,
    manifest: manifestCheck,
    unknownArtifactCount,
  });

  const notes = [
    `${artifacts.length} artifact(s), ${manifest.totalSizeBytes} byte(s); ` +
      `complete=${complete}, recognized=${recognized}, stable=${stable}, ` +
      `inSync=${manifestCheck.present ? manifestCheck.inSync : "n/a"}.`,
    `Run digest ${runDigest} fingerprints the current artifact set.`,
    "This status reads local artifacts only and writes nothing; it is not a live result or advice.",
  ];

  return {
    schemaVersion: BACKTEST_RESEARCH_STATUS_SCHEMA_VERSION,
    banner: BACKTEST_RESEARCH_STATUS_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...BACKTEST_RESEARCH_STATUS_DISCLAIMERS],
    runName: manifest.runName,
    runDigest,
    artifactCount: manifest.artifactCount,
    totalSizeBytes: manifest.totalSizeBytes,
    kindsPresent,
    schemasPresent,
    unknownArtifactCount,
    malformedArtifactCount,
    complete,
    recognized,
    stable,
    bundleCandidateValid,
    bundleCandidateError,
    manifest: manifestCheck,
    warnings,
    recommendedAction,
    notes,
  };
}

/** Choose the single, neutral recommended action from the directory's state (priority order). */
function recommendAction(state: {
  bundleCandidateValid: boolean;
  bundleCandidateError: string | null;
  malformedArtifactCount: number;
  artifactCount: number;
  manifest: BacktestResearchStatusManifestCheck;
  unknownArtifactCount: number;
}): string {
  if (!state.bundleCandidateValid) {
    return `The artifact set is inconsistent (${state.bundleCandidateError ?? "unknown reason"}); inspect the directory before relying on it.`;
  }
  if (state.malformedArtifactCount > 0) {
    return `${state.malformedArtifactCount} file(s) are unparseable JSON; inspect or remove them, then re-index the directory.`;
  }
  if (state.artifactCount === 0) {
    return "No artifacts found; this directory does not look like a completed research run.";
  }
  if (state.manifest.present && !state.manifest.inSync) {
    return "The recorded manifest does not match the directory; review missing/extra/changed artifacts or re-record the manifest.";
  }
  if (!state.manifest.present) {
    return "No manifest recorded; run the research manifest command to capture this run for later verification.";
  }
  if (state.unknownArtifactCount > 0) {
    return "All files parsed, but some have an unrecognized schema; confirm they belong to this run.";
  }
  return "The research directory looks complete, recognized, stable, and in sync; no action needed.";
}

// --- validation (backstop) ---------------------------------------------------

/**
 * Strictly validate a value as a {@link BacktestResearchStatus} and return it narrowed. A
 * backstop mirroring the other validators: checks the schema version, the required PAPER-ONLY
 * labelling, the disclaimers, the counts, the boolean flags, the manifest-check shape, and the
 * recommended action. Throws {@link BacktestResearchStatusError} on the first problem. Pure.
 */
export function validateBacktestResearchStatus(value: unknown): BacktestResearchStatus {
  if (!isObject(value)) {
    throw new BacktestResearchStatusError("status must be a JSON object");
  }
  if (value.schemaVersion !== BACKTEST_RESEARCH_STATUS_SCHEMA_VERSION) {
    throw new BacktestResearchStatusError(
      `status.schemaVersion must be "${BACKTEST_RESEARCH_STATUS_SCHEMA_VERSION}"`,
    );
  }
  if (value.banner !== BACKTEST_RESEARCH_STATUS_BANNER) {
    throw new BacktestResearchStatusError(`status.banner must be "${BACKTEST_RESEARCH_STATUS_BANNER}"`);
  }
  for (const flag of [
    "paperOnly",
    "simulated",
    "notLiveResult",
    "notFinancialAdvice",
    "notProfitabilityClaim",
  ] as const) {
    if (value[flag] !== true) {
      throw new BacktestResearchStatusError(`status.${flag} must be true`);
    }
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new BacktestResearchStatusError("status.disclaimers must be a non-empty array");
  }
  if (!nonEmptyString(value.runDigest)) {
    throw new BacktestResearchStatusError("status.runDigest must be a non-empty string");
  }
  if (value.runName !== null && typeof value.runName !== "string") {
    throw new BacktestResearchStatusError("status.runName must be a string or null");
  }
  for (const f of ["artifactCount", "totalSizeBytes", "unknownArtifactCount", "malformedArtifactCount"] as const) {
    if (!isFiniteNumber(value[f]) || !Number.isInteger(value[f]) || (value[f] as number) < 0) {
      throw new BacktestResearchStatusError(`status.${f} must be a non-negative integer`);
    }
  }
  for (const f of ["complete", "recognized", "stable", "bundleCandidateValid"] as const) {
    if (typeof value[f] !== "boolean") {
      throw new BacktestResearchStatusError(`status.${f} must be a boolean`);
    }
  }
  if (value.bundleCandidateError !== null && typeof value.bundleCandidateError !== "string") {
    throw new BacktestResearchStatusError("status.bundleCandidateError must be a string or null");
  }
  if (!nonEmptyString(value.recommendedAction)) {
    throw new BacktestResearchStatusError("status.recommendedAction must be a non-empty string");
  }
  for (const key of ["kindsPresent", "schemasPresent", "warnings", "notes"] as const) {
    if (!Array.isArray(value[key])) {
      throw new BacktestResearchStatusError(`status.${key} must be an array`);
    }
  }
  (value.kindsPresent as unknown[]).forEach((k, i) => {
    if (typeof k !== "string" || !ARTIFACT_KIND_SET.has(k)) {
      throw new BacktestResearchStatusError(`status.kindsPresent[${i}] "${String(k)}" is not a known artifact kind`);
    }
  });
  if (!isObject(value.manifest)) {
    throw new BacktestResearchStatusError("status.manifest must be an object");
  }
  const m = value.manifest;
  for (const f of ["present", "inSync"] as const) {
    if (typeof m[f] !== "boolean") {
      throw new BacktestResearchStatusError(`status.manifest.${f} must be a boolean`);
    }
  }
  for (const f of [
    "okCount",
    "missingCount",
    "extraCount",
    "digestChangedCount",
    "schemaChangedCount",
    "sizeChangedCount",
  ] as const) {
    if (!isFiniteNumber(m[f]) || !Number.isInteger(m[f]) || (m[f] as number) < 0) {
      throw new BacktestResearchStatusError(`status.manifest.${f} must be a non-negative integer`);
    }
  }
  return value as unknown as BacktestResearchStatus;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatBacktestResearchStatus}. */
export interface FormatBacktestResearchStatusOptions {
  /** Optional label (e.g. the artifact directory) echoed into the header. */
  label?: string;
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

/**
 * Render a stable, human-readable research status. Deterministic and path-stable (no
 * timestamps). Leads with the PAPER-ONLY banner and the COMPLETE/RECOGNIZED/STABLE/IN-SYNC
 * verdicts, surfaces the manifest drift summary, states the single neutral recommended action,
 * and closes with the not-live / not-advice disclaimers. Summarizes safely (no raw dumps).
 */
export function formatBacktestResearchStatus(
  status: BacktestResearchStatus,
  opts: FormatBacktestResearchStatusOptions = {},
): string {
  const title = status.runName ?? "research run";
  const header = `${status.banner} — ${title} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];

  if (opts.label) lines.push(`dir:        ${opts.label}`);
  lines.push(`run:        ${status.runName ?? "(unnamed)"}`);
  lines.push(`runDigest:  ${status.runDigest}`);
  lines.push(`artifacts:  ${status.artifactCount} (${status.totalSizeBytes} bytes total)`);

  lines.push("");
  lines.push("Health:");
  lines.push(`- complete:   ${yesNo(status.complete)}`);
  lines.push(`- recognized: ${yesNo(status.recognized)} (unknown: ${status.unknownArtifactCount})`);
  lines.push(`- stable:     ${yesNo(status.stable)} (malformed: ${status.malformedArtifactCount})`);
  lines.push(`- bundle ok:  ${yesNo(status.bundleCandidateValid)}`);

  lines.push("");
  lines.push("Kinds present:");
  if (status.kindsPresent.length === 0) lines.push("- (none)");
  else for (const k of status.kindsPresent) lines.push(`- ${k}`);

  lines.push("");
  lines.push("Schemas present:");
  if (status.schemasPresent.length === 0) lines.push("- (none)");
  else for (const s of status.schemasPresent) lines.push(`- ${s}`);

  lines.push("");
  lines.push("Manifest:");
  if (!status.manifest.present) {
    lines.push("- present: no (no manifest provided)");
  } else {
    lines.push(`- present: yes`);
    lines.push(`- in sync: ${yesNo(status.manifest.inSync)}`);
    lines.push(
      `- ${status.manifest.okCount} ok, ${status.manifest.missingCount} missing, ` +
        `${status.manifest.extraCount} extra, ` +
        `${status.manifest.digestChangedCount} digest-changed, ` +
        `${status.manifest.schemaChangedCount} schema-changed, ` +
        `${status.manifest.sizeChangedCount} size-changed`,
    );
  }

  if (status.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of status.warnings) lines.push(`- ${w}`);
  }

  lines.push("");
  lines.push(`Recommended: ${status.recommendedAction}`);

  lines.push("");
  lines.push("Notes:");
  for (const note of status.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of status.disclaimers) lines.push(d);
  return lines.join("\n");
}
