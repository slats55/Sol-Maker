/**
 * Deterministic, offline, **simulated-only** RESEARCH RUN MANIFEST (Sprint 16).
 *
 * Soulmaker now has many deterministic, PAPER-only research commands that each write
 * local JSON artifacts (scenarios, variant plans, backtest reports, suite indexes,
 * sensitivity reports, the cross-scenario matrix, coverage reports, diffs, …). This
 * module answers a reproducibility/audit question over a directory of those artifacts:
 *
 *   "What exactly did this local PAPER-only research run produce, from what inputs,
 *    with what schemas, and can I verify the same artifact set later?"
 *
 * It is **pure** and does NO filesystem/network IO of its own: it accepts already-loaded
 * artifact DESCRIPTORS (path + detected kind/schema + a content digest + byte size) and
 * builds a stable, versioned manifest; the CLI layer is the only place that reads a
 * directory, parses each file, classifies it (via {@link classifyBacktestArtifact}),
 * computes its digest, and assembles the descriptors. The manifest carries NO timestamps,
 * so an identical artifact set produces a byte-identical manifest.
 *
 * The digest is a NON-CRYPTOGRAPHIC, reproducibility-only content fingerprint (the
 * existing {@link import("./digest.js").digestContent} FNV-1a pass) — it exists to detect
 * "same content" and to trace an artifact, NOT for security, integrity, or anti-tamper
 * purposes. The manifest labels it as such.
 *
 * This is bookkeeping over injected, simulated local artifacts — NOT a live result, NOT
 * real market data, NOT advice, and NOT a profitability claim. Nothing here holds a key,
 * or builds/signs/simulates/sends a transaction.
 */

/** Stable schema identifier for the research manifest. Bump only on a breaking change. */
export const BACKTEST_RESEARCH_MANIFEST_SCHEMA_VERSION = "backtest.research.manifest.v1";

/** Stable schema identifier for the manifest VERIFICATION report. */
export const BACKTEST_RESEARCH_VERIFY_SCHEMA_VERSION = "backtest.research.verify.v1";

/** The banner that prefixes every research manifest (required label). */
export const BACKTEST_RESEARCH_MANIFEST_BANNER = "SIMULATED PAPER-ONLY RESEARCH MANIFEST";

/** The banner that prefixes every verification report (required label). */
export const BACKTEST_RESEARCH_VERIFY_BANNER = "SIMULATED PAPER-ONLY RESEARCH VERIFY";

/**
 * A human label for the digest, stated honestly: it is NOT cryptographic and exists only
 * for reproducibility/"same content" comparison, never for security or anti-tamper use.
 */
export const BACKTEST_RESEARCH_DIGEST_ALGORITHM =
  "fnv1a-64-canonical (non-cryptographic; reproducibility-only, not a security/anti-tamper hash)";

/** Required disclaimer statements carried by every research manifest (stable order). */
export const BACKTEST_RESEARCH_MANIFEST_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY RESEARCH MANIFEST — an index of LOCAL artifacts a paper research run produced.",
  "Lists local artifacts only — it is not live data and fetched nothing.",
  "The digest is a non-cryptographic, reproducibility-only content fingerprint, NOT a security or anti-tamper guarantee.",
  "Not a live result.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this manifest.",
];

/** Thrown only when manifest INPUT / a produced manifest / a verification is structurally invalid. */
export class BacktestResearchManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestResearchManifestError";
  }
}

// --- artifact classification -------------------------------------------------

/**
 * The coarse kind of a recognized research artifact. `unknown-json` is a parseable JSON
 * value whose schema/shape was not recognized; the CLI also reports malformed (unparseable)
 * files separately as INVALID artifacts (never silently dropped).
 */
export type BacktestArtifactKind =
  | "scenario"
  | "variant-plan"
  | "variant-plan-explain"
  | "backtest-report"
  | "suite-index"
  | "sensitivity-report"
  | "sensitivity-matrix-report"
  | "coverage-report"
  | "diff-report"
  | "unknown-json";

/** The fixed, ordered set of artifact kinds (for validation + stable counting). */
export const BACKTEST_ARTIFACT_KINDS: readonly BacktestArtifactKind[] = [
  "scenario",
  "variant-plan",
  "variant-plan-explain",
  "backtest-report",
  "suite-index",
  "sensitivity-report",
  "sensitivity-matrix-report",
  "coverage-report",
  "diff-report",
  "unknown-json",
];

const ARTIFACT_KIND_SET = new Set<string>(BACKTEST_ARTIFACT_KINDS);

/** The kinds that, when recognized, MUST carry a non-null schemaVersion (a versioned report). */
const VERSIONED_KINDS = new Set<BacktestArtifactKind>([
  "variant-plan-explain",
  "backtest-report",
  "suite-index",
  "sensitivity-report",
  "sensitivity-matrix-report",
  "coverage-report",
  "diff-report",
]);

/** Map a recognized `schemaVersion` string to its artifact kind. */
const SCHEMA_TO_KIND: Readonly<Record<string, BacktestArtifactKind>> = {
  "backtest.report.v1": "backtest-report",
  "backtest.diff.v1": "diff-report",
  "backtest.suite.v1": "suite-index",
  "backtest.suite.diff.v1": "diff-report",
  "backtest.sensitivity.v1": "sensitivity-report",
  "backtest.sensitivity.diff.v1": "diff-report",
  "backtest.sensitivity.matrix.v1": "sensitivity-matrix-report",
  "backtest.sensitivity.matrix.diff.v1": "diff-report",
  "backtest.coverage.v1": "coverage-report",
  "backtest.variant-plan.explain.v1": "variant-plan-explain",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Classify an already-parsed JSON value as a Soulmaker research artifact. Pure and
 * deterministic. A recognized `schemaVersion` maps to its kind; an unrecognized
 * `schemaVersion` is `unknown-json` (its version is still surfaced). A value with NO
 * `schemaVersion` is structurally sniffed: a `{ name, steps[] }` is a `scenario`, a
 * `{ variants[] }` without `steps` is a `variant-plan`, otherwise `unknown-json`.
 */
export function classifyBacktestArtifact(value: unknown): {
  kind: BacktestArtifactKind;
  schemaVersion: string | null;
} {
  if (!isObject(value)) return { kind: "unknown-json", schemaVersion: null };
  const sv = value.schemaVersion;
  if (typeof sv === "string" && sv.length > 0) {
    return { kind: SCHEMA_TO_KIND[sv] ?? "unknown-json", schemaVersion: sv };
  }
  if (Array.isArray(value.steps) && typeof value.name === "string") {
    return { kind: "scenario", schemaVersion: null };
  }
  if (Array.isArray(value.variants) && !("steps" in value)) {
    return { kind: "variant-plan", schemaVersion: null };
  }
  return { kind: "unknown-json", schemaVersion: null };
}

// --- descriptor + input ------------------------------------------------------

/**
 * One already-loaded artifact descriptor. The CLI builds these by reading each local file,
 * classifying it, and computing its content digest + byte size. The pure package never
 * reads a file; it only validates and aggregates these.
 */
export interface BacktestArtifactDescriptor {
  /** The artifact's path, RELATIVE to the manifested directory (forward-slashed, stable). */
  path: string;
  kind: BacktestArtifactKind;
  /** The detected schema version when the artifact carried one, else null. */
  schemaVersion: string | null;
  /** A deterministic, non-cryptographic content digest (reproducibility-only). */
  digest: string;
  /** The artifact's size in bytes (a non-negative integer). */
  sizeBytes: number;
}

/** Everything {@link buildBacktestResearchManifest} needs (already-loaded descriptors). */
export interface BuildBacktestResearchManifestInput {
  /** Optional run label (e.g. the artifact directory name). */
  runName?: string;
  /** The already-loaded artifact descriptors (≥0). */
  artifacts: BacktestArtifactDescriptor[];
}

// --- manifest model ----------------------------------------------------------

export interface BacktestArtifactKindCount {
  kind: BacktestArtifactKind;
  count: number;
}

export interface BacktestArtifactSchemaCount {
  /** The detected schema version, or the literal "(none)" when an artifact had none. */
  schemaVersion: string;
  count: number;
}

/**
 * The full, deterministic, byte-stable research manifest. JSON-serializable as-is. Carries
 * the required PAPER-ONLY / local-artifacts-only / not-a-live-result / not-advice language
 * and the honest non-cryptographic-digest label so they survive serialization.
 */
export interface BacktestResearchManifest {
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
  artifactCount: number;
  totalSizeBytes: number;
  /** All artifacts, sorted by path ascending (stable). */
  artifacts: BacktestArtifactDescriptor[];
  /** Count per kind, sorted by kind ascending (only kinds present). */
  kindCounts: BacktestArtifactKindCount[];
  /** Count per detected schema version ("(none)" for none), sorted ascending. */
  schemaCounts: BacktestArtifactSchemaCount[];
  /** Reproducibility-only warnings (unknown schemas, duplicate digests, missing versions). */
  warnings: string[];
  /** Bookkeeping-only notes. */
  notes: string[];
}

// --- builder -----------------------------------------------------------------

function comparePath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Validate one descriptor strictly (a programmer/CLI error, surfaced clearly). */
function validateDescriptor(d: unknown, where: string): BacktestArtifactDescriptor {
  if (!isObject(d)) throw new BacktestResearchManifestError(`${where} must be an object`);
  if (!nonEmptyString(d.path)) {
    throw new BacktestResearchManifestError(`${where}.path must be a non-empty string`);
  }
  if (typeof d.kind !== "string" || !ARTIFACT_KIND_SET.has(d.kind)) {
    throw new BacktestResearchManifestError(`${where}.kind "${String(d.kind)}" is not a known artifact kind`);
  }
  if (d.schemaVersion !== null && typeof d.schemaVersion !== "string") {
    throw new BacktestResearchManifestError(`${where}.schemaVersion must be a string or null`);
  }
  if (!nonEmptyString(d.digest)) {
    throw new BacktestResearchManifestError(`${where}.digest must be a non-empty string`);
  }
  if (!isFiniteNumber(d.sizeBytes) || !Number.isInteger(d.sizeBytes) || d.sizeBytes < 0) {
    throw new BacktestResearchManifestError(`${where}.sizeBytes must be a non-negative integer`);
  }
  return {
    path: d.path,
    kind: d.kind as BacktestArtifactKind,
    schemaVersion: (d.schemaVersion as string | null) ?? null,
    digest: d.digest,
    sizeBytes: d.sizeBytes,
  };
}

/**
 * Build a deterministic, byte-stable {@link BacktestResearchManifest} from already-loaded
 * artifact descriptors. Pure and non-mutating. Refuses (throws
 * {@link BacktestResearchManifestError}) a malformed descriptor or a DUPLICATE path (a
 * manifest must index each path once). Artifacts and the kind/schema counts are sorted
 * deterministically; warnings flag unrecognized schemas, identical-content groups, and any
 * versioned artifact missing its schema version.
 */
export function buildBacktestResearchManifest(
  input: BuildBacktestResearchManifestInput,
): BacktestResearchManifest {
  if (!isObject(input)) {
    throw new BacktestResearchManifestError("manifest input must be an object");
  }
  if (input.runName !== undefined && typeof input.runName !== "string") {
    throw new BacktestResearchManifestError("manifest input.runName must be a string when present");
  }
  if (!Array.isArray(input.artifacts)) {
    throw new BacktestResearchManifestError("manifest input.artifacts must be an array");
  }

  const seenPaths = new Set<string>();
  const artifacts = input.artifacts.map((d, i) => {
    const desc = validateDescriptor(d, `artifacts[${i}]`);
    if (seenPaths.has(desc.path)) {
      throw new BacktestResearchManifestError(`duplicate artifact path "${desc.path}"`);
    }
    seenPaths.add(desc.path);
    return desc;
  });
  artifacts.sort((a, b) => comparePath(a.path, b.path));

  // Kind counts (sorted by kind).
  const kindMap = new Map<string, number>();
  for (const a of artifacts) kindMap.set(a.kind, (kindMap.get(a.kind) ?? 0) + 1);
  const kindCounts: BacktestArtifactKindCount[] = [...kindMap.entries()]
    .map(([kind, count]) => ({ kind: kind as BacktestArtifactKind, count }))
    .sort((a, b) => comparePath(a.kind, b.kind));

  // Schema counts (sorted by schemaVersion; null becomes "(none)").
  const schemaMap = new Map<string, number>();
  for (const a of artifacts) {
    const key = a.schemaVersion ?? "(none)";
    schemaMap.set(key, (schemaMap.get(key) ?? 0) + 1);
  }
  const schemaCounts: BacktestArtifactSchemaCount[] = [...schemaMap.entries()]
    .map(([schemaVersion, count]) => ({ schemaVersion, count }))
    .sort((a, b) => comparePath(a.schemaVersion, b.schemaVersion));

  const totalSizeBytes = artifacts.reduce((sum, a) => sum + a.sizeBytes, 0);

  // Warnings (reproducibility-only).
  const warnings: string[] = [];
  const unknownCount = artifacts.filter((a) => a.kind === "unknown-json").length;
  if (unknownCount > 0) {
    warnings.push(`${unknownCount} artifact(s) had an unrecognized schema or shape (kind "unknown-json").`);
  }
  const missingVersion = artifacts.filter((a) => VERSIONED_KINDS.has(a.kind) && a.schemaVersion === null);
  for (const a of missingVersion) {
    warnings.push(`artifact "${a.path}" is a ${a.kind} but carries no schemaVersion.`);
  }
  // Duplicate-digest groups (identical content under different paths).
  const digestMap = new Map<string, string[]>();
  for (const a of artifacts) {
    const list = digestMap.get(a.digest);
    if (list) list.push(a.path);
    else digestMap.set(a.digest, [a.path]);
  }
  const dupGroups = [...digestMap.values()].filter((paths) => paths.length > 1);
  for (const paths of dupGroups.sort((x, y) => comparePath(x[0] as string, y[0] as string))) {
    warnings.push(`identical content (same digest) shared by: ${[...paths].sort(comparePath).join(", ")}.`);
  }

  const notes = [
    `${artifacts.length} artifact(s), ${totalSizeBytes} byte(s) total across ${kindCounts.length} kind(s).`,
    "Each digest is a non-cryptographic, reproducibility-only content fingerprint — re-runnable, not anti-tamper.",
    "Re-verify this exact artifact set later with the manifest verify command; this is a reproducibility index, not a live result.",
  ];

  return {
    schemaVersion: BACKTEST_RESEARCH_MANIFEST_SCHEMA_VERSION,
    banner: BACKTEST_RESEARCH_MANIFEST_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...BACKTEST_RESEARCH_MANIFEST_DISCLAIMERS],
    digestAlgorithm: BACKTEST_RESEARCH_DIGEST_ALGORITHM,
    runName: input.runName ?? null,
    artifactCount: artifacts.length,
    totalSizeBytes,
    artifacts,
    kindCounts,
    schemaCounts,
    warnings,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

/**
 * Strictly validate a value as a {@link BacktestResearchManifest} and return it narrowed.
 * A backstop mirroring the other validators: checks the schema version, the required
 * PAPER-ONLY labelling, the disclaimers, and the artifact/count shapes. Throws
 * {@link BacktestResearchManifestError} on the first problem. Pure; never mutates.
 */
export function validateBacktestResearchManifest(value: unknown): BacktestResearchManifest {
  if (!isObject(value)) {
    throw new BacktestResearchManifestError("manifest must be a JSON object");
  }
  if (value.schemaVersion !== BACKTEST_RESEARCH_MANIFEST_SCHEMA_VERSION) {
    throw new BacktestResearchManifestError(
      `manifest.schemaVersion must be "${BACKTEST_RESEARCH_MANIFEST_SCHEMA_VERSION}"`,
    );
  }
  if (value.banner !== BACKTEST_RESEARCH_MANIFEST_BANNER) {
    throw new BacktestResearchManifestError(`manifest.banner must be "${BACKTEST_RESEARCH_MANIFEST_BANNER}"`);
  }
  for (const flag of [
    "paperOnly",
    "simulated",
    "notLiveResult",
    "notFinancialAdvice",
    "notProfitabilityClaim",
  ] as const) {
    if (value[flag] !== true) {
      throw new BacktestResearchManifestError(`manifest.${flag} must be true`);
    }
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new BacktestResearchManifestError("manifest.disclaimers must be a non-empty array");
  }
  if (!nonEmptyString(value.digestAlgorithm)) {
    throw new BacktestResearchManifestError("manifest.digestAlgorithm must be a non-empty string");
  }
  if (!isFiniteNumber(value.artifactCount) || !isFiniteNumber(value.totalSizeBytes)) {
    throw new BacktestResearchManifestError("manifest.artifactCount and totalSizeBytes must be finite numbers");
  }
  if (!Array.isArray(value.artifacts)) {
    throw new BacktestResearchManifestError("manifest.artifacts must be an array");
  }
  value.artifacts.forEach((a, i) => validateDescriptor(a, `manifest.artifacts[${i}]`));
  for (const key of ["kindCounts", "schemaCounts", "warnings"] as const) {
    if (!Array.isArray(value[key])) {
      throw new BacktestResearchManifestError(`manifest.${key} must be an array`);
    }
  }
  return value as unknown as BacktestResearchManifest;
}

// --- verification ------------------------------------------------------------

/** The per-artifact verification verdict (primary status). */
export type ResearchArtifactVerifyStatus =
  | "ok"
  | "missing"
  | "digest-changed"
  | "schema-changed"
  | "size-changed"
  | "extra";

/** A compact snapshot of the fields verification compares. */
export interface ResearchArtifactSnapshot {
  kind: BacktestArtifactKind;
  schemaVersion: string | null;
  digest: string;
  sizeBytes: number;
}

/** One artifact's verification: its manifest snapshot, its current snapshot, and the verdict. */
export interface BacktestResearchArtifactVerification {
  path: string;
  status: ResearchArtifactVerifyStatus;
  /** The manifest's recorded snapshot (null when the artifact is `extra`). */
  expected: ResearchArtifactSnapshot | null;
  /** The freshly-recomputed snapshot (null when the artifact is `missing`). */
  actual: ResearchArtifactSnapshot | null;
  /** Human, redaction-safe reasons for a non-ok status (stable order). */
  issues: string[];
}

/** The full, deterministic verification of a manifest against a current artifact set. */
export interface BacktestResearchVerification {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  runName: string | null;
  manifestArtifactCount: number;
  currentArtifactCount: number;
  okCount: number;
  changedCount: number;
  missingCount: number;
  extraCount: number;
  /** True iff nothing is missing, changed, or extra. */
  valid: boolean;
  artifacts: BacktestResearchArtifactVerification[];
  notes: string[];
}

function snapshotOf(d: BacktestArtifactDescriptor): ResearchArtifactSnapshot {
  return { kind: d.kind, schemaVersion: d.schemaVersion, digest: d.digest, sizeBytes: d.sizeBytes };
}

/**
 * Verify a manifest against a CURRENT set of recomputed artifact descriptors (the CLI layer
 * reads the directory and computes these; this comparison is pure). Pairs by path and reports
 * missing / digest-changed / schema-changed / size-changed / extra / ok per artifact, plus
 * roll-up counts and a `valid` flag (true iff nothing is missing, changed, or extra). Pure;
 * never mutates either input. The manifest is structurally validated first.
 */
export function verifyBacktestResearchManifest(
  manifest: unknown,
  current: BacktestArtifactDescriptor[],
): BacktestResearchVerification {
  const m = validateBacktestResearchManifest(manifest);
  if (!Array.isArray(current)) {
    throw new BacktestResearchManifestError("current artifact list must be an array");
  }
  const currentDescriptors = current.map((d, i) => validateDescriptor(d, `current[${i}]`));

  const byPathCurrent = new Map<string, BacktestArtifactDescriptor>();
  for (const d of currentDescriptors) {
    if (byPathCurrent.has(d.path)) {
      throw new BacktestResearchManifestError(`duplicate current artifact path "${d.path}"`);
    }
    byPathCurrent.set(d.path, d);
  }
  const manifestPaths = new Set(m.artifacts.map((a) => a.path));

  const results: BacktestResearchArtifactVerification[] = [];

  for (const expected of m.artifacts) {
    const actual = byPathCurrent.get(expected.path);
    if (!actual) {
      results.push({
        path: expected.path,
        status: "missing",
        expected: snapshotOf(expected),
        actual: null,
        issues: ["artifact is in the manifest but missing from the directory"],
      });
      continue;
    }
    const issues: string[] = [];
    let status: ResearchArtifactVerifyStatus = "ok";
    if (actual.digest !== expected.digest) {
      status = "digest-changed";
      issues.push(`content digest changed (${expected.digest} → ${actual.digest})`);
    } else if (actual.schemaVersion !== expected.schemaVersion) {
      status = "schema-changed";
      issues.push(`schema changed (${expected.schemaVersion ?? "(none)"} → ${actual.schemaVersion ?? "(none)"})`);
    } else if (actual.sizeBytes !== expected.sizeBytes) {
      status = "size-changed";
      issues.push(`byte size changed with identical content digest (${expected.sizeBytes} → ${actual.sizeBytes})`);
    }
    results.push({ path: expected.path, status, expected: snapshotOf(expected), actual: snapshotOf(actual), issues });
  }

  for (const actual of currentDescriptors) {
    if (manifestPaths.has(actual.path)) continue;
    results.push({
      path: actual.path,
      status: "extra",
      expected: null,
      actual: snapshotOf(actual),
      issues: ["artifact is in the directory but not in the manifest"],
    });
  }

  results.sort((a, b) => comparePath(a.path, b.path));

  let okCount = 0;
  let changedCount = 0;
  let missingCount = 0;
  let extraCount = 0;
  for (const r of results) {
    if (r.status === "ok") okCount += 1;
    else if (r.status === "missing") missingCount += 1;
    else if (r.status === "extra") extraCount += 1;
    else changedCount += 1;
  }
  const valid = changedCount === 0 && missingCount === 0 && extraCount === 0;

  const notes = [
    `${m.artifacts.length} manifest artifact(s) vs ${currentDescriptors.length} present: ` +
      `${okCount} ok, ${changedCount} changed, ${missingCount} missing, ${extraCount} extra.`,
    valid
      ? "The directory matches the manifest exactly (same paths, digests, schemas, and sizes)."
      : "The directory does NOT match the manifest — review the changed/missing/extra artifacts.",
    "Verification is a reproducibility check over local artifacts, not a live result or advice.",
  ];

  return {
    schemaVersion: BACKTEST_RESEARCH_VERIFY_SCHEMA_VERSION,
    banner: BACKTEST_RESEARCH_VERIFY_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...BACKTEST_RESEARCH_MANIFEST_DISCLAIMERS],
    runName: m.runName,
    manifestArtifactCount: m.artifacts.length,
    currentArtifactCount: currentDescriptors.length,
    okCount,
    changedCount,
    missingCount,
    extraCount,
    valid,
    artifacts: results,
    notes,
  };
}

// --- human formatters --------------------------------------------------------

/** Options for {@link formatBacktestResearchManifest}. */
export interface FormatBacktestResearchManifestOptions {
  /** Optional label (e.g. the artifact directory) echoed into the header. */
  label?: string;
}

/**
 * Render a stable, human-readable research manifest. Deterministic and path-stable (no
 * timestamps). Leads with the PAPER-ONLY banner and closes with the not-live / not-advice /
 * not-a-profitability-claim disclaimers and the honest non-cryptographic-digest note.
 */
export function formatBacktestResearchManifest(
  manifest: BacktestResearchManifest,
  opts: FormatBacktestResearchManifestOptions = {},
): string {
  const title = manifest.runName ?? "research run";
  const header = `${manifest.banner} — ${title} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];

  if (opts.label) lines.push(`dir:       ${opts.label}`);
  lines.push(`run:       ${manifest.runName ?? "(unnamed)"}`);
  lines.push(`artifacts: ${manifest.artifactCount} (${manifest.totalSizeBytes} bytes total)`);
  lines.push(`digest:    ${manifest.digestAlgorithm}`);

  lines.push("");
  lines.push("By kind:");
  if (manifest.kindCounts.length === 0) lines.push("- (none)");
  else for (const k of manifest.kindCounts) lines.push(`- ${k.kind}: ${k.count}`);

  lines.push("");
  lines.push("By schema:");
  if (manifest.schemaCounts.length === 0) lines.push("- (none)");
  else for (const s of manifest.schemaCounts) lines.push(`- ${s.schemaVersion}: ${s.count}`);

  lines.push("");
  lines.push("Artifacts:");
  for (const a of manifest.artifacts) {
    const schema = a.schemaVersion ?? "(none)";
    lines.push(`- ${a.path}  [${a.kind} · ${schema}]  ${a.sizeBytes}B  ${a.digest}`);
  }

  if (manifest.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of manifest.warnings) lines.push(`- ${w}`);
  }

  lines.push("");
  lines.push("Notes:");
  for (const note of manifest.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of manifest.disclaimers) lines.push(d);
  return lines.join("\n");
}

/**
 * Render a stable, human-readable verification report. Deterministic; leads with the
 * PAPER-ONLY banner and a clear VALID / INVALID verdict and lists every non-ok artifact.
 */
export function formatBacktestResearchVerification(verification: BacktestResearchVerification): string {
  const verdict = verification.valid ? "VALID" : "INVALID";
  const header = `${verification.banner} — ${verification.runName ?? "research run"} (${verdict})`;
  const lines: string[] = [header, "=".repeat(header.length)];

  lines.push(`manifest:  ${verification.manifestArtifactCount} artifact(s)`);
  lines.push(`present:   ${verification.currentArtifactCount} artifact(s)`);
  lines.push(
    `result:    ${verification.okCount} ok, ${verification.changedCount} changed, ` +
      `${verification.missingCount} missing, ${verification.extraCount} extra`,
  );
  lines.push(`verdict:   ${verdict}`);

  const problems = verification.artifacts.filter((a) => a.status !== "ok");
  lines.push("");
  if (problems.length === 0) {
    lines.push("All artifacts match the manifest (same path, digest, schema, and size).");
  } else {
    lines.push("Differences:");
    for (const a of problems) {
      lines.push(`- ${a.path} [${a.status}]`);
      for (const issue of a.issues) lines.push(`    ${issue}`);
    }
  }

  lines.push("");
  lines.push("Notes:");
  for (const note of verification.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of verification.disclaimers) lines.push(d);
  return lines.join("\n");
}
