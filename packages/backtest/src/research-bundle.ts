/**
 * Deterministic, offline, **simulated-only** RESEARCH RUN BUNDLE (Sprint 17).
 *
 * Sprint 16 gave us a RESEARCH MANIFEST that indexes the LOCAL JSON artifacts a PAPER-only
 * research run produced and a VERIFY pass that re-checks that index later. Sprint 17 sits one
 * level above: it packages a run into a single, self-describing BUNDLE summary with a stable,
 * top-level "run digest" so two runs can be compared (or a run re-identified) at a glance.
 *
 * This is **NOT** an archive: it embeds no artifact CONTENTS. It is a deterministic JSON
 * summary/index — manifest summary, artifact + kind counts, the recognized schema-version set,
 * unknown/malformed counts, the sorted per-artifact digest references, and one top-level
 * {@link buildBacktestResearchRunDigest run digest} computed deterministically from the sorted
 * artifact metadata. Identical artifact sets ⇒ a byte-identical bundle and an identical run
 * digest; a single changed artifact digest changes the top-level run digest.
 *
 * It is **pure** and does NO filesystem/network IO of its own: like the manifest builder it
 * accepts already-loaded artifact DESCRIPTORS (the CLI reads the directory, classifies each
 * file via {@link classifyBacktestArtifact}, computes its digest, and assembles the
 * descriptors). It builds the manifest internally (reusing {@link buildBacktestResearchManifest})
 * so the bundle and the manifest never drift apart. The bundle carries NO wall-clock timestamp,
 * so it stays byte-stable.
 *
 * The digest is the existing NON-CRYPTOGRAPHIC, reproducibility-only FNV-1a content fingerprint
 * (see {@link import("./digest.js").digestContent}) — it detects "same content" and traces a
 * run, NOT for security, integrity, or anti-tamper purposes. The bundle labels it as such.
 *
 * This is bookkeeping over injected, simulated local artifacts — NOT a live result, NOT real
 * market data, NOT advice, and NOT a profitability claim. Nothing here holds a key, or
 * builds/signs/simulates/sends a transaction.
 */

import { digestContent } from "./digest.js";
import {
  buildBacktestResearchManifest,
  BACKTEST_ARTIFACT_KINDS,
  type BacktestArtifactDescriptor,
  type BacktestArtifactKindCount,
  type BacktestArtifactSchemaCount,
} from "./research-manifest.js";

/** Stable schema identifier for the research bundle. Bump only on a breaking change. */
export const BACKTEST_RESEARCH_BUNDLE_SCHEMA_VERSION = "backtest.research.bundle.v1";

/** The banner that prefixes every research bundle (required label). */
export const BACKTEST_RESEARCH_BUNDLE_BANNER = "SIMULATED PAPER-ONLY RESEARCH BUNDLE";

/**
 * The stable DOMAIN string the run digest is computed over. Kept independent of the bundle
 * schema version so the run digest reflects only the artifact set, not the bundle's own shape:
 * the same artifacts always yield the same run digest, even across a future bundle-schema bump.
 */
export const BACKTEST_RESEARCH_RUN_DIGEST_DOMAIN = "backtest.research.run-digest.v1";

/**
 * An honest label for the digest: it is NOT cryptographic and exists only for
 * reproducibility/"same content" comparison, never for security or anti-tamper use.
 */
export const BACKTEST_RESEARCH_BUNDLE_DIGEST_ALGORITHM =
  "fnv1a-64-canonical (non-cryptographic; reproducibility-only, not a security/anti-tamper hash)";

/** Required disclaimer statements carried by every research bundle (stable order). */
export const BACKTEST_RESEARCH_BUNDLE_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY RESEARCH BUNDLE — a self-describing summary of the LOCAL artifacts a paper research run produced.",
  "Summarizes local artifacts only — it embeds no artifact contents, is not live data, and fetched nothing.",
  "The run digest is a non-cryptographic, reproducibility-only fingerprint of the artifact set, NOT a security or anti-tamper guarantee.",
  "Not a live result.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this bundle.",
];

/** Thrown only when bundle INPUT or a produced bundle is structurally invalid. */
export class BacktestResearchBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestResearchBundleError";
  }
}

// --- input -------------------------------------------------------------------

/** Everything {@link buildBacktestResearchBundle} needs (already-loaded descriptors). */
export interface BuildBacktestResearchBundleInput {
  /** Optional run label (e.g. the artifact directory name). */
  runName?: string;
  /** The already-loaded artifact descriptors (≥0). */
  artifacts: BacktestArtifactDescriptor[];
  /**
   * The relative paths of artifacts that were UNPARSEABLE JSON (malformed), a subset of the
   * `unknown-json` artifacts. The pure layer cannot tell a malformed file from a parseable
   * unrecognized one, so the CLI passes this list explicitly. Each must be a known artifact
   * path that classified as `unknown-json`. Optional (defaults to none).
   */
  malformedPaths?: string[];
}

// --- bundle model ------------------------------------------------------------

/** A compact reference to the manifest the bundle was built from (a summary, not a copy). */
export interface BacktestResearchBundleManifestSummary {
  /** The manifest's own schema version. */
  schemaVersion: string;
  runName: string | null;
  artifactCount: number;
  totalSizeBytes: number;
  /** A non-cryptographic digest of the FULL manifest object (reproducibility reference). */
  manifestDigest: string;
}

/** One artifact's stable (path → content-digest) reference. */
export interface BacktestResearchBundleDigestEntry {
  path: string;
  digest: string;
}

/**
 * The full, deterministic, byte-stable research bundle. JSON-serializable as-is. Carries the
 * required PAPER-ONLY / local-artifacts-only / not-a-live-result / not-advice language and the
 * honest non-cryptographic-digest label so they survive serialization.
 */
export interface BacktestResearchBundle {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  /** Honest label of what the digest is (and is not). */
  digestAlgorithm: string;
  runName: string | null;
  /** Top-level, non-cryptographic digest over the sorted artifact metadata (reproducibility). */
  runDigest: string;
  artifactCount: number;
  totalSizeBytes: number;
  /** Count per kind, sorted by kind ascending (only kinds present). */
  kindCounts: BacktestArtifactKindCount[];
  /** Count per detected schema version ("(none)" for none), sorted ascending. */
  schemaCounts: BacktestArtifactSchemaCount[];
  /** The recognized schema-version set (sorted; excludes unknown-json and unversioned kinds). */
  recognizedSchemaVersions: string[];
  /** Number of artifacts whose schema/shape was not recognized (kind "unknown-json"). */
  unknownArtifactCount: number;
  /** Number of artifacts that were unparseable JSON (a subset of the unknown count). */
  malformedArtifactCount: number;
  /** Stable (path → digest) references for every indexed artifact, sorted by path. */
  digestEntries: BacktestResearchBundleDigestEntry[];
  /** A summary/reference of the manifest this bundle was built from. */
  manifest: BacktestResearchBundleManifestSummary;
  /** Reproducibility-only warnings (unknown, malformed, duplicate-content, empty run, …). */
  warnings: string[];
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

// --- run digest --------------------------------------------------------------

/**
 * Compute the deterministic, non-cryptographic RUN DIGEST over a set of artifact descriptors.
 * The digest is taken over a canonical, path-sorted list of each artifact's comparable fields
 * (path, kind, schemaVersion, digest, sizeBytes) under a stable domain tag, so:
 *
 *  - it is independent of input order (sorted first);
 *  - identical artifact sets produce an identical run digest;
 *  - changing ANY artifact's content digest (or schema/kind/size) changes the run digest.
 *
 * Pure and non-mutating. This is a reproducibility fingerprint of the whole run, NOT a
 * security/anti-tamper hash.
 */
export function buildBacktestResearchRunDigest(artifacts: BacktestArtifactDescriptor[]): string {
  if (!Array.isArray(artifacts)) {
    throw new BacktestResearchBundleError("run-digest input must be an array of descriptors");
  }
  const sorted = artifacts
    .map((a, i) => {
      if (!isObject(a)) throw new BacktestResearchBundleError(`artifacts[${i}] must be an object`);
      return {
        path: a.path,
        kind: a.kind,
        schemaVersion: a.schemaVersion ?? null,
        digest: a.digest,
        sizeBytes: a.sizeBytes,
      };
    })
    .sort((x, y) => comparePath(String(x.path), String(y.path)));
  return digestContent({ domain: BACKTEST_RESEARCH_RUN_DIGEST_DOMAIN, artifacts: sorted });
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic, byte-stable {@link BacktestResearchBundle} from already-loaded artifact
 * descriptors. Pure and non-mutating. Reuses {@link buildBacktestResearchManifest} internally
 * (so a duplicate path or malformed descriptor is refused exactly as the manifest would refuse
 * it), then computes the manifest digest, the top-level run digest, the recognized schema set,
 * the unknown/malformed counts, and the sorted digest references. Throws
 * {@link BacktestResearchBundleError} on invalid input (including a `malformedPaths` entry that
 * is not a known `unknown-json` artifact).
 */
export function buildBacktestResearchBundle(
  input: BuildBacktestResearchBundleInput,
): BacktestResearchBundle {
  if (!isObject(input)) {
    throw new BacktestResearchBundleError("bundle input must be an object");
  }
  if (input.runName !== undefined && typeof input.runName !== "string") {
    throw new BacktestResearchBundleError("bundle input.runName must be a string when present");
  }
  if (!Array.isArray(input.artifacts)) {
    throw new BacktestResearchBundleError("bundle input.artifacts must be an array");
  }
  if (input.malformedPaths !== undefined && !Array.isArray(input.malformedPaths)) {
    throw new BacktestResearchBundleError("bundle input.malformedPaths must be an array when present");
  }

  // Reuse the manifest builder: it validates every descriptor and refuses duplicate paths.
  let manifest;
  try {
    manifest = buildBacktestResearchManifest({ runName: input.runName, artifacts: input.artifacts });
  } catch (err) {
    // Re-wrap so callers can catch a single bundle error type, preserving the message.
    throw new BacktestResearchBundleError((err as Error).message);
  }

  const artifacts = manifest.artifacts; // already validated + sorted by path

  // Validate the malformed-paths subset strictly: each must name a known unknown-json artifact.
  const byPath = new Map(artifacts.map((a) => [a.path, a]));
  const malformedSeen = new Set<string>();
  const malformedPaths: string[] = [];
  for (const [i, p] of (input.malformedPaths ?? []).entries()) {
    if (!nonEmptyString(p)) {
      throw new BacktestResearchBundleError(`malformedPaths[${i}] must be a non-empty string`);
    }
    const artifact = byPath.get(p);
    if (!artifact) {
      throw new BacktestResearchBundleError(`malformedPaths[${i}] "${p}" is not an indexed artifact`);
    }
    if (artifact.kind !== "unknown-json") {
      throw new BacktestResearchBundleError(
        `malformedPaths[${i}] "${p}" must classify as unknown-json (was "${artifact.kind}")`,
      );
    }
    if (!malformedSeen.has(p)) {
      malformedSeen.add(p);
      malformedPaths.push(p);
    }
  }
  malformedPaths.sort(comparePath);

  // Recognized schema-version set: versioned, recognized kinds only (sorted, unique).
  const recognized = new Set<string>();
  for (const a of artifacts) {
    if (a.kind !== "unknown-json" && a.schemaVersion !== null) recognized.add(a.schemaVersion);
  }
  const recognizedSchemaVersions = [...recognized].sort(comparePath);

  const unknownArtifactCount = artifacts.filter((a) => a.kind === "unknown-json").length;
  const malformedArtifactCount = malformedPaths.length;

  const digestEntries: BacktestResearchBundleDigestEntry[] = artifacts.map((a) => ({
    path: a.path,
    digest: a.digest,
  }));

  const runDigest = buildBacktestResearchRunDigest(artifacts);
  const manifestDigest = digestContent(manifest);

  // Warnings: keep the manifest's reproducibility warnings, then add bundle-specific ones.
  const warnings = [...manifest.warnings];
  if (malformedArtifactCount > 0) {
    warnings.push(
      `${malformedArtifactCount} artifact(s) were unparseable JSON (malformed) and indexed as unknown-json.`,
    );
  }
  if (artifacts.length === 0) {
    warnings.push("the bundle indexes no artifacts — the research directory looks empty.");
  }

  const notes = [
    `${artifacts.length} artifact(s), ${manifest.totalSizeBytes} byte(s) total across ${manifest.kindCounts.length} kind(s).`,
    `Run digest ${runDigest} fingerprints the whole artifact set; compare two runs by their run digest.`,
    "The run digest is a non-cryptographic, reproducibility-only fingerprint — re-runnable, not anti-tamper.",
    "This bundle embeds no artifact contents; pair it with the research manifest verify command to re-check the set.",
  ];

  return {
    schemaVersion: BACKTEST_RESEARCH_BUNDLE_SCHEMA_VERSION,
    banner: BACKTEST_RESEARCH_BUNDLE_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...BACKTEST_RESEARCH_BUNDLE_DISCLAIMERS],
    digestAlgorithm: BACKTEST_RESEARCH_BUNDLE_DIGEST_ALGORITHM,
    runName: manifest.runName,
    runDigest,
    artifactCount: manifest.artifactCount,
    totalSizeBytes: manifest.totalSizeBytes,
    kindCounts: manifest.kindCounts.map((k) => ({ ...k })),
    schemaCounts: manifest.schemaCounts.map((s) => ({ ...s })),
    recognizedSchemaVersions,
    unknownArtifactCount,
    malformedArtifactCount,
    digestEntries,
    manifest: {
      schemaVersion: manifest.schemaVersion,
      runName: manifest.runName,
      artifactCount: manifest.artifactCount,
      totalSizeBytes: manifest.totalSizeBytes,
      manifestDigest,
    },
    warnings,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

/**
 * Strictly validate a value as a {@link BacktestResearchBundle} and return it narrowed. A
 * backstop mirroring the other validators: checks the schema version, the required PAPER-ONLY
 * labelling, the disclaimers, the run digest + algorithm label, the counts, and the
 * digest-entry shapes. Throws {@link BacktestResearchBundleError} on the first problem. Pure.
 */
export function validateBacktestResearchBundle(value: unknown): BacktestResearchBundle {
  if (!isObject(value)) {
    throw new BacktestResearchBundleError("bundle must be a JSON object");
  }
  if (value.schemaVersion !== BACKTEST_RESEARCH_BUNDLE_SCHEMA_VERSION) {
    throw new BacktestResearchBundleError(
      `bundle.schemaVersion must be "${BACKTEST_RESEARCH_BUNDLE_SCHEMA_VERSION}"`,
    );
  }
  if (value.banner !== BACKTEST_RESEARCH_BUNDLE_BANNER) {
    throw new BacktestResearchBundleError(`bundle.banner must be "${BACKTEST_RESEARCH_BUNDLE_BANNER}"`);
  }
  for (const flag of [
    "paperOnly",
    "simulated",
    "notLiveResult",
    "notFinancialAdvice",
    "notProfitabilityClaim",
  ] as const) {
    if (value[flag] !== true) {
      throw new BacktestResearchBundleError(`bundle.${flag} must be true`);
    }
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new BacktestResearchBundleError("bundle.disclaimers must be a non-empty array");
  }
  if (!nonEmptyString(value.digestAlgorithm)) {
    throw new BacktestResearchBundleError("bundle.digestAlgorithm must be a non-empty string");
  }
  if (!nonEmptyString(value.runDigest)) {
    throw new BacktestResearchBundleError("bundle.runDigest must be a non-empty string");
  }
  if (value.runName !== null && typeof value.runName !== "string") {
    throw new BacktestResearchBundleError("bundle.runName must be a string or null");
  }
  for (const f of ["artifactCount", "totalSizeBytes", "unknownArtifactCount", "malformedArtifactCount"] as const) {
    if (!isFiniteNumber(value[f]) || !Number.isInteger(value[f]) || (value[f] as number) < 0) {
      throw new BacktestResearchBundleError(`bundle.${f} must be a non-negative integer`);
    }
  }
  if ((value.malformedArtifactCount as number) > (value.unknownArtifactCount as number)) {
    throw new BacktestResearchBundleError("bundle.malformedArtifactCount must not exceed unknownArtifactCount");
  }
  for (const key of ["kindCounts", "schemaCounts", "warnings", "notes", "recognizedSchemaVersions"] as const) {
    if (!Array.isArray(value[key])) {
      throw new BacktestResearchBundleError(`bundle.${key} must be an array`);
    }
  }
  (value.kindCounts as unknown[]).forEach((k, i) => {
    if (!isObject(k) || typeof k.kind !== "string" || !ARTIFACT_KIND_SET.has(k.kind) || !isFiniteNumber(k.count)) {
      throw new BacktestResearchBundleError(`bundle.kindCounts[${i}] must be a {kind,count} entry`);
    }
  });
  (value.schemaCounts as unknown[]).forEach((s, i) => {
    if (!isObject(s) || !nonEmptyString(s.schemaVersion) || !isFiniteNumber(s.count)) {
      throw new BacktestResearchBundleError(`bundle.schemaCounts[${i}] must be a {schemaVersion,count} entry`);
    }
  });
  (value.recognizedSchemaVersions as unknown[]).forEach((s, i) => {
    if (!nonEmptyString(s)) {
      throw new BacktestResearchBundleError(`bundle.recognizedSchemaVersions[${i}] must be a non-empty string`);
    }
  });
  if (!Array.isArray(value.digestEntries)) {
    throw new BacktestResearchBundleError("bundle.digestEntries must be an array");
  }
  (value.digestEntries as unknown[]).forEach((e, i) => {
    if (!isObject(e) || !nonEmptyString(e.path) || !nonEmptyString(e.digest)) {
      throw new BacktestResearchBundleError(`bundle.digestEntries[${i}] must be a {path,digest} entry`);
    }
  });
  if (!isObject(value.manifest)) {
    throw new BacktestResearchBundleError("bundle.manifest must be an object");
  }
  const m = value.manifest;
  if (!nonEmptyString(m.schemaVersion)) {
    throw new BacktestResearchBundleError("bundle.manifest.schemaVersion must be a non-empty string");
  }
  if (m.runName !== null && typeof m.runName !== "string") {
    throw new BacktestResearchBundleError("bundle.manifest.runName must be a string or null");
  }
  if (!nonEmptyString(m.manifestDigest)) {
    throw new BacktestResearchBundleError("bundle.manifest.manifestDigest must be a non-empty string");
  }
  if (!isFiniteNumber(m.artifactCount) || !isFiniteNumber(m.totalSizeBytes)) {
    throw new BacktestResearchBundleError("bundle.manifest.artifactCount and totalSizeBytes must be finite numbers");
  }
  return value as unknown as BacktestResearchBundle;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatBacktestResearchBundle}. */
export interface FormatBacktestResearchBundleOptions {
  /** Optional label (e.g. the artifact directory) echoed into the header. */
  label?: string;
  /** Cap on the number of per-artifact digest rows printed (default 50; the rest are summarized). */
  maxDigestRows?: number;
}

/**
 * Render a stable, human-readable research bundle. Deterministic and path-stable (no
 * timestamps). Leads with the PAPER-ONLY banner and the top-level run digest, and closes with
 * the not-live / not-advice / not-a-profitability-claim disclaimers and the honest
 * non-cryptographic-digest note. Long digest lists are summarized (never an unsafe raw dump).
 */
export function formatBacktestResearchBundle(
  bundle: BacktestResearchBundle,
  opts: FormatBacktestResearchBundleOptions = {},
): string {
  const maxRows = opts.maxDigestRows ?? 50;
  const title = bundle.runName ?? "research run";
  const header = `${bundle.banner} — ${title} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];

  if (opts.label) lines.push(`dir:       ${opts.label}`);
  lines.push(`run:       ${bundle.runName ?? "(unnamed)"}`);
  lines.push(`runDigest: ${bundle.runDigest}`);
  lines.push(`artifacts: ${bundle.artifactCount} (${bundle.totalSizeBytes} bytes total)`);
  lines.push(`unknown:   ${bundle.unknownArtifactCount} (malformed: ${bundle.malformedArtifactCount})`);
  lines.push(`digest:    ${bundle.digestAlgorithm}`);

  lines.push("");
  lines.push(`manifest:  ${bundle.manifest.schemaVersion} (digest ${bundle.manifest.manifestDigest})`);

  lines.push("");
  lines.push("By kind:");
  if (bundle.kindCounts.length === 0) lines.push("- (none)");
  else for (const k of bundle.kindCounts) lines.push(`- ${k.kind}: ${k.count}`);

  lines.push("");
  lines.push("Recognized schemas:");
  if (bundle.recognizedSchemaVersions.length === 0) lines.push("- (none)");
  else for (const s of bundle.recognizedSchemaVersions) lines.push(`- ${s}`);

  lines.push("");
  lines.push("Artifact digests:");
  if (bundle.digestEntries.length === 0) {
    lines.push("- (none)");
  } else {
    const shown = bundle.digestEntries.slice(0, maxRows);
    for (const e of shown) lines.push(`- ${e.path}  ${e.digest}`);
    const hidden = bundle.digestEntries.length - shown.length;
    if (hidden > 0) lines.push(`- … and ${hidden} more (summarized; see the bundle JSON for the full list)`);
  }

  if (bundle.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of bundle.warnings) lines.push(`- ${w}`);
  }

  lines.push("");
  lines.push("Notes:");
  for (const note of bundle.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of bundle.disclaimers) lines.push(d);
  return lines.join("\n");
}
