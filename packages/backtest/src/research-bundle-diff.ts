/**
 * Deterministic diff of two Sprint 17 RESEARCH RUN BUNDLES (Sprint 19, the bundle analogue of
 * the manifest diff). Answers "what changed between two PAPER-only research runs, and did the
 * change break reproducibility/integrity?" without re-reading either run's directory.
 *
 * `diffBacktestResearchBundles(base, next)` structurally reads both bundles (refusing a
 * non-bundle), then produces a {@link BacktestResearchBundleDiff}: the top-level **run digest**
 * change (the comprehensive integrity signal), artifact added/removed/digest-changed lists
 * (paired by path via the bundle's `digestEntries`), aggregate kind- and schema-count changes,
 * the recognized-schema set delta, unknown/malformed/warning/artifact/size count deltas, the
 * manifest-summary digest change, and BOTH a `hasChange` flag and a CONSERVATIVE `hasRegression`
 * flag (integrity breakage only), each with stable reasons.
 *
 * Granularity note: a bundle is a SUMMARY — it carries a per-artifact `{path, digest}` but NOT
 * per-artifact kind/schema/size (those are aggregated, and folded into the run digest). So this
 * diff reports per-artifact ADD / REMOVE / DIGEST-CHANGE by path, while a per-artifact kind /
 * schema / size change surfaces as a kind-count / schema-count change and a **run digest change**
 * (the run digest fingerprints every artifact's digest + kind + schema + size). For per-artifact
 * kind/schema/size attribution, diff the Sprint 16 MANIFESTS instead.
 *
 * It is **pure**: no network, no RPC, no wallet, no filesystem, no `Date.now`, no `Math.random`,
 * and it never mutates its inputs (every value placed in the diff is a fresh copy with stable key
 * order, so the JSON is byte-stable for a given pair). This is a reproducibility/audit comparison
 * over LOCAL run summaries — never a live result, never advice, never a profitability claim. A
 * changed digest is a non-cryptographic content-fingerprint difference, not a security signal.
 */

import { redactString } from "@soulmaker/security";

/** Stable schema identifier for the research-bundle-diff shape. Bump only on a breaking change. */
export const BACKTEST_RESEARCH_BUNDLE_DIFF_SCHEMA_VERSION = "backtest.research.bundle.diff.v1";

/** Required disclaimers carried by every bundle diff (stable order). */
export const BACKTEST_RESEARCH_BUNDLE_DIFF_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY research bundle diff — compares two LOCAL run bundles.",
  "Every value is a change between two local reproducibility summaries, not a live result.",
  "A changed run/artifact digest is a non-cryptographic content-fingerprint difference, not a security or anti-tamper signal.",
  "Uses injected bundle data only — no live data was fetched and nothing was traded.",
  "Not a live result. Not financial advice. Not a profitability claim.",
];

/** Thrown when an `unknown` value is not a structurally valid bundle/diff. */
export class BacktestResearchBundleDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestResearchBundleDiffError";
  }
}

// --- diff data model ---------------------------------------------------------

/** A simple base→next numeric comparison. */
export interface ResearchBundleNumberDelta {
  base: number;
  next: number;
  delta: number;
}

/** A `{path, digest}` reference (mirrors the bundle's digest entries). */
export interface ResearchBundleDigestRef {
  path: string;
  digest: string;
}

/** A paired artifact (same path in BOTH bundles) whose content digest changed. */
export interface ResearchBundleArtifactChange {
  path: string;
  baseDigest: string;
  nextDigest: string;
}

/** A per-key count change (kind counts or schema counts). */
export interface ResearchBundleCountChange {
  key: string;
  base: number;
  next: number;
  delta: number;
}

/** The full, deterministic, JSON-serializable diff of two research bundles. */
export interface BacktestResearchBundleDiff {
  schemaVersion: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  baseRunName: string | null;
  nextRunName: string | null;
  /** Whether the two bundle schema versions matched (a mismatch is an incompatible comparison). */
  bundleSchemaMatch: boolean;
  baseRunDigest: string;
  nextRunDigest: string;
  /** Whether the top-level run digest changed (the comprehensive integrity signal). */
  runDigestChanged: boolean;
  baseManifestDigest: string;
  nextManifestDigest: string;
  /** Whether the underlying manifest summary digest changed. */
  manifestDigestChanged: boolean;
  artifactCount: ResearchBundleNumberDelta;
  totalSizeBytes: ResearchBundleNumberDelta;
  unknownArtifactCount: ResearchBundleNumberDelta;
  malformedArtifactCount: ResearchBundleNumberDelta;
  warningCount: ResearchBundleNumberDelta;
  /** Artifacts (path+digest) present in next but not base, sorted by path. */
  added: ResearchBundleDigestRef[];
  /** Artifacts (path+digest) present in base but not next, sorted by path. */
  removed: ResearchBundleDigestRef[];
  /** Artifacts present in both whose content digest changed, sorted by path. */
  changed: ResearchBundleArtifactChange[];
  kindCountChanges: ResearchBundleCountChange[];
  schemaCountChanges: ResearchBundleCountChange[];
  /** Recognized schema versions present in next but not base, sorted. */
  recognizedSchemasAdded: string[];
  /** Recognized schema versions present in base but not next, sorted. */
  recognizedSchemasRemoved: string[];
  hasChange: boolean;
  changeReasons: string[];
  /** Conservative: true only for integrity breakage (see {@link diffBacktestResearchBundles}). */
  hasRegression: boolean;
  regressionReasons: string[];
  disclaimers: string[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function delta(base: number, next: number): ResearchBundleNumberDelta {
  return { base, next, delta: next - base };
}

const ARTIFACT_KIND_SET = new Set<string>([
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
]);

/** A lightweight, schemaVersion-lenient read of a bundle for diffing (strict on what it reads). */
interface ReadBundle {
  schemaVersion: string;
  runName: string | null;
  runDigest: string;
  manifestDigest: string;
  artifactCount: number;
  totalSizeBytes: number;
  unknownArtifactCount: number;
  malformedArtifactCount: number;
  warningCount: number;
  digestEntries: ResearchBundleDigestRef[];
  kindCounts: Map<string, number>;
  schemaCounts: Map<string, number>;
  recognizedSchemaVersions: string[];
}

function readDigestEntry(value: unknown, where: string): ResearchBundleDigestRef {
  if (!isObject(value)) throw new BacktestResearchBundleDiffError(`${where} must be an object`);
  if (!nonEmptyString(value.path)) throw new BacktestResearchBundleDiffError(`${where}.path must be a non-empty string`);
  if (!nonEmptyString(value.digest)) throw new BacktestResearchBundleDiffError(`${where}.digest must be a non-empty string`);
  return { path: value.path, digest: value.digest };
}

function readCountMap(
  value: unknown,
  where: string,
  keyField: "kind" | "schemaVersion",
  keyCheck: (k: unknown) => boolean,
): Map<string, number> {
  if (!Array.isArray(value)) throw new BacktestResearchBundleDiffError(`${where} must be an array`);
  const map = new Map<string, number>();
  value.forEach((entry, i) => {
    if (!isObject(entry) || !keyCheck(entry[keyField]) || !isNonNegativeInteger(entry.count)) {
      throw new BacktestResearchBundleDiffError(`${where}[${i}] must be a {${keyField},count} entry`);
    }
    map.set(entry[keyField] as string, entry.count as number);
  });
  return map;
}

/**
 * Structurally read one INPUT bundle for diffing. Lenient on `schemaVersion` (any non-empty
 * string) so a version mismatch is surfaced rather than refused, but strict about every field the
 * diff reads. Does NOT mutate. Throws {@link BacktestResearchBundleDiffError}.
 */
function readBundleForDiff(value: unknown, side: string): ReadBundle {
  if (!isObject(value)) throw new BacktestResearchBundleDiffError(`${side} bundle must be a JSON object`);
  if (!nonEmptyString(value.schemaVersion)) {
    throw new BacktestResearchBundleDiffError(`${side} bundle.schemaVersion must be a non-empty string`);
  }
  if (value.runName !== null && typeof value.runName !== "string") {
    throw new BacktestResearchBundleDiffError(`${side} bundle.runName must be a string or null`);
  }
  if (!nonEmptyString(value.runDigest)) {
    throw new BacktestResearchBundleDiffError(`${side} bundle.runDigest must be a non-empty string`);
  }
  for (const f of ["artifactCount", "totalSizeBytes", "unknownArtifactCount", "malformedArtifactCount"] as const) {
    if (!isNonNegativeInteger(value[f])) {
      throw new BacktestResearchBundleDiffError(`${side} bundle.${f} must be a non-negative integer`);
    }
  }
  if (!Array.isArray(value.digestEntries)) {
    throw new BacktestResearchBundleDiffError(`${side} bundle.digestEntries must be an array`);
  }
  const digestEntries = value.digestEntries.map((e, i) => readDigestEntry(e, `${side} bundle.digestEntries[${i}]`));
  if (!Array.isArray(value.warnings)) {
    throw new BacktestResearchBundleDiffError(`${side} bundle.warnings must be an array`);
  }
  if (!Array.isArray(value.recognizedSchemaVersions)) {
    throw new BacktestResearchBundleDiffError(`${side} bundle.recognizedSchemaVersions must be an array`);
  }
  value.recognizedSchemaVersions.forEach((s, i) => {
    if (!nonEmptyString(s)) {
      throw new BacktestResearchBundleDiffError(`${side} bundle.recognizedSchemaVersions[${i}] must be a non-empty string`);
    }
  });
  if (!isObject(value.manifest) || !nonEmptyString(value.manifest.manifestDigest)) {
    throw new BacktestResearchBundleDiffError(`${side} bundle.manifest.manifestDigest must be a non-empty string`);
  }
  const kindCounts = readCountMap(value.kindCounts, `${side} bundle.kindCounts`, "kind", (k) => typeof k === "string" && ARTIFACT_KIND_SET.has(k));
  const schemaCounts = readCountMap(value.schemaCounts, `${side} bundle.schemaCounts`, "schemaVersion", (k) => nonEmptyString(k));
  return {
    schemaVersion: value.schemaVersion,
    runName: (value.runName as string | null) ?? null,
    runDigest: value.runDigest,
    manifestDigest: value.manifest.manifestDigest,
    artifactCount: value.artifactCount as number,
    totalSizeBytes: value.totalSizeBytes as number,
    unknownArtifactCount: value.unknownArtifactCount as number,
    malformedArtifactCount: value.malformedArtifactCount as number,
    warningCount: value.warnings.length,
    digestEntries,
    kindCounts,
    schemaCounts,
    recognizedSchemaVersions: [...(value.recognizedSchemaVersions as string[])].sort(compareString),
  };
}

/** Build the per-key count changes (only keys whose count actually changed), sorted by key. */
function countChanges(base: Map<string, number>, next: Map<string, number>): ResearchBundleCountChange[] {
  const keys = [...new Set([...base.keys(), ...next.keys()])].sort(compareString);
  const out: ResearchBundleCountChange[] = [];
  for (const key of keys) {
    const b = base.get(key) ?? 0;
    const n = next.get(key) ?? 0;
    if (b !== n) out.push({ key, base: b, next: n, delta: n - b });
  }
  return out;
}

// --- public API --------------------------------------------------------------

/**
 * Compute the deterministic diff of two research bundles. Both inputs are structurally read (a
 * non-bundle throws {@link BacktestResearchBundleDiffError}); neither is mutated. Artifacts are
 * paired by `path` (added / removed / digest-changed). Pure and byte-stable for a given pair.
 *
 * `hasRegression` is CONSERVATIVE — true only for integrity/reproducibility breakage:
 *  - the bundle schema versions are incompatible (mismatch);
 *  - the top-level run digest changed (any artifact digest/schema/kind/size moved);
 *  - one or more artifacts were removed, or a paired artifact's digest changed;
 *  - the unknown or malformed artifact count increased;
 *  - a previously-recognized schema version is gone in next.
 * A purely additive change (e.g. a new artifact, a higher count) is a CHANGE but not a regression.
 */
export function diffBacktestResearchBundles(base: unknown, next: unknown): BacktestResearchBundleDiff {
  const b = readBundleForDiff(base, "base");
  const n = readBundleForDiff(next, "next");

  const baseByPath = new Map(b.digestEntries.map((e) => [e.path, e.digest]));
  const nextByPath = new Map(n.digestEntries.map((e) => [e.path, e.digest]));

  const added = n.digestEntries
    .filter((e) => !baseByPath.has(e.path))
    .map((e) => ({ path: e.path, digest: e.digest }))
    .sort((x, y) => compareString(x.path, y.path));
  const removed = b.digestEntries
    .filter((e) => !nextByPath.has(e.path))
    .map((e) => ({ path: e.path, digest: e.digest }))
    .sort((x, y) => compareString(x.path, y.path));

  const changed: ResearchBundleArtifactChange[] = [];
  for (const e of n.digestEntries) {
    const baseDigest = baseByPath.get(e.path);
    if (baseDigest === undefined || baseDigest === e.digest) continue;
    changed.push({ path: e.path, baseDigest, nextDigest: e.digest });
  }
  changed.sort((x, y) => compareString(x.path, y.path));

  const kindCountChanges = countChanges(b.kindCounts, n.kindCounts);
  const schemaCountChanges = countChanges(b.schemaCounts, n.schemaCounts);

  const baseSchemas = new Set(b.recognizedSchemaVersions);
  const nextSchemas = new Set(n.recognizedSchemaVersions);
  const recognizedSchemasAdded = n.recognizedSchemaVersions.filter((s) => !baseSchemas.has(s));
  const recognizedSchemasRemoved = b.recognizedSchemaVersions.filter((s) => !nextSchemas.has(s));

  const bundleSchemaMatch = b.schemaVersion === n.schemaVersion;
  const runDigestChanged = b.runDigest !== n.runDigest;
  const manifestDigestChanged = b.manifestDigest !== n.manifestDigest;

  const artifactCount = delta(b.artifactCount, n.artifactCount);
  const totalSizeBytes = delta(b.totalSizeBytes, n.totalSizeBytes);
  const unknownArtifactCount = delta(b.unknownArtifactCount, n.unknownArtifactCount);
  const malformedArtifactCount = delta(b.malformedArtifactCount, n.malformedArtifactCount);
  const warningCount = delta(b.warningCount, n.warningCount);

  // --- change reasons (any difference) ---
  const changeReasons: string[] = [];
  if (!bundleSchemaMatch) changeReasons.push(`bundle schemaVersion differs ("${b.schemaVersion}" → "${n.schemaVersion}")`);
  if (runDigestChanged) changeReasons.push(`run digest changed (${b.runDigest} → ${n.runDigest})`);
  if (added.length > 0) changeReasons.push(`${added.length} artifact(s) added`);
  if (removed.length > 0) changeReasons.push(`${removed.length} artifact(s) removed`);
  if (changed.length > 0) changeReasons.push(`${changed.length} artifact(s) changed digest`);
  if (recognizedSchemasAdded.length > 0) changeReasons.push(`${recognizedSchemasAdded.length} recognized schema(s) added`);
  if (recognizedSchemasRemoved.length > 0) changeReasons.push(`${recognizedSchemasRemoved.length} recognized schema(s) removed`);
  for (const k of kindCountChanges) changeReasons.push(`kind "${k.key}" count ${k.base} → ${k.next}`);
  for (const s of schemaCountChanges) changeReasons.push(`schema "${s.key}" count ${s.base} → ${s.next}`);
  if (unknownArtifactCount.delta !== 0) changeReasons.push(`unknown artifact count ${unknownArtifactCount.base} → ${unknownArtifactCount.next}`);
  if (malformedArtifactCount.delta !== 0) changeReasons.push(`malformed artifact count ${malformedArtifactCount.base} → ${malformedArtifactCount.next}`);
  if (warningCount.delta !== 0) changeReasons.push(`warning count ${warningCount.base} → ${warningCount.next}`);
  if (artifactCount.delta !== 0) changeReasons.push(`artifact count ${artifactCount.base} → ${artifactCount.next}`);
  if (totalSizeBytes.delta !== 0) changeReasons.push(`total bytes ${totalSizeBytes.base} → ${totalSizeBytes.next}`);
  if (manifestDigestChanged) changeReasons.push("manifest summary digest changed");

  // --- regression reasons (conservative: integrity breakage only) ---
  // Purely ADDING an artifact moves the run digest but is NOT a regression. So instead of a blanket
  // run-digest trigger we decompose it: removed / content-digest-changed are regressions, and a run
  // digest that moved while the path-set AND every content digest stayed the same can only mean an
  // existing artifact's kind/schema/size changed (those feed the run digest but not digestEntries) —
  // also an integrity regression. Additions (added.length > 0) are excluded by construction.
  const sameSetMetadataDrift =
    runDigestChanged && added.length === 0 && removed.length === 0 && changed.length === 0;
  const regressionReasons: string[] = [];
  if (!bundleSchemaMatch) regressionReasons.push(`incompatible bundle schemaVersion ("${b.schemaVersion}" → "${n.schemaVersion}")`);
  if (removed.length > 0) regressionReasons.push(`${removed.length} artifact(s) removed`);
  if (changed.length > 0) regressionReasons.push(`${changed.length} artifact(s) changed content digest`);
  if (sameSetMetadataDrift) regressionReasons.push("an existing artifact's kind/schema/size changed (run digest moved with an unchanged artifact set)");
  if (unknownArtifactCount.delta > 0) regressionReasons.push(`unknown artifact count increased by ${unknownArtifactCount.delta}`);
  if (malformedArtifactCount.delta > 0) regressionReasons.push(`malformed artifact count increased by ${malformedArtifactCount.delta}`);
  if (recognizedSchemasRemoved.length > 0) regressionReasons.push(`${recognizedSchemasRemoved.length} recognized schema(s) removed`);

  return {
    schemaVersion: BACKTEST_RESEARCH_BUNDLE_DIFF_SCHEMA_VERSION,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    baseRunName: b.runName,
    nextRunName: n.runName,
    bundleSchemaMatch,
    baseRunDigest: b.runDigest,
    nextRunDigest: n.runDigest,
    runDigestChanged,
    baseManifestDigest: b.manifestDigest,
    nextManifestDigest: n.manifestDigest,
    manifestDigestChanged,
    artifactCount,
    totalSizeBytes,
    unknownArtifactCount,
    malformedArtifactCount,
    warningCount,
    added,
    removed,
    changed,
    kindCountChanges,
    schemaCountChanges,
    recognizedSchemasAdded,
    recognizedSchemasRemoved,
    hasChange: changeReasons.length > 0,
    changeReasons,
    hasRegression: regressionReasons.length > 0,
    regressionReasons,
    disclaimers: [...BACKTEST_RESEARCH_BUNDLE_DIFF_DISCLAIMERS],
  };
}

// --- validation (backstop) ---------------------------------------------------

function isNumberDelta(value: unknown): boolean {
  return isObject(value) && isFiniteNumber(value.base) && isFiniteNumber(value.next) && isFiniteNumber(value.delta);
}

/**
 * Strictly validate a value as a {@link BacktestResearchBundleDiff} and return it narrowed. Checks
 * the schema version, the PAPER-ONLY labelling, the change/regression flags + reasons, the number
 * deltas, and the added/removed/changed/count-change shapes. Throws
 * {@link BacktestResearchBundleDiffError}. Pure.
 */
export function validateBacktestResearchBundleDiff(value: unknown): BacktestResearchBundleDiff {
  if (!isObject(value)) throw new BacktestResearchBundleDiffError("bundle diff must be a JSON object");
  if (value.schemaVersion !== BACKTEST_RESEARCH_BUNDLE_DIFF_SCHEMA_VERSION) {
    throw new BacktestResearchBundleDiffError(
      `bundle diff.schemaVersion must be "${BACKTEST_RESEARCH_BUNDLE_DIFF_SCHEMA_VERSION}"`,
    );
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new BacktestResearchBundleDiffError(`bundle diff.${flag} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new BacktestResearchBundleDiffError("bundle diff.disclaimers must be a non-empty array");
  }
  for (const f of ["bundleSchemaMatch", "runDigestChanged", "manifestDigestChanged", "hasChange", "hasRegression"] as const) {
    if (typeof value[f] !== "boolean") throw new BacktestResearchBundleDiffError(`bundle diff.${f} must be a boolean`);
  }
  for (const f of ["baseRunDigest", "nextRunDigest", "baseManifestDigest", "nextManifestDigest"] as const) {
    if (!nonEmptyString(value[f])) throw new BacktestResearchBundleDiffError(`bundle diff.${f} must be a non-empty string`);
  }
  for (const f of ["changeReasons", "regressionReasons"] as const) {
    if (!Array.isArray(value[f])) throw new BacktestResearchBundleDiffError(`bundle diff.${f} must be an array`);
  }
  for (const f of ["artifactCount", "totalSizeBytes", "unknownArtifactCount", "malformedArtifactCount", "warningCount"] as const) {
    if (!isNumberDelta(value[f])) throw new BacktestResearchBundleDiffError(`bundle diff.${f} must be a {base,next,delta} number delta`);
  }
  for (const key of ["added", "removed"] as const) {
    if (!Array.isArray(value[key])) throw new BacktestResearchBundleDiffError(`bundle diff.${key} must be an array`);
    (value[key] as unknown[]).forEach((d, i) => readDigestEntry(d, `bundle diff.${key}[${i}]`));
  }
  if (!Array.isArray(value.changed)) throw new BacktestResearchBundleDiffError("bundle diff.changed must be an array");
  (value.changed as unknown[]).forEach((c, i) => {
    const where = `bundle diff.changed[${i}]`;
    if (!isObject(c) || !nonEmptyString(c.path) || !nonEmptyString(c.baseDigest) || !nonEmptyString(c.nextDigest)) {
      throw new BacktestResearchBundleDiffError(`${where} must be a {path,baseDigest,nextDigest} change`);
    }
  });
  for (const key of ["kindCountChanges", "schemaCountChanges"] as const) {
    if (!Array.isArray(value[key])) throw new BacktestResearchBundleDiffError(`bundle diff.${key} must be an array`);
    (value[key] as unknown[]).forEach((c, i) => {
      const where = `bundle diff.${key}[${i}]`;
      if (!isObject(c) || !nonEmptyString(c.key) || !isFiniteNumber(c.base) || !isFiniteNumber(c.next) || !isFiniteNumber(c.delta)) {
        throw new BacktestResearchBundleDiffError(`${where} must be a {key,base,next,delta} count change`);
      }
    });
  }
  for (const key of ["recognizedSchemasAdded", "recognizedSchemasRemoved"] as const) {
    if (!Array.isArray(value[key])) throw new BacktestResearchBundleDiffError(`bundle diff.${key} must be an array`);
    (value[key] as unknown[]).forEach((s, i) => {
      if (!nonEmptyString(s)) throw new BacktestResearchBundleDiffError(`bundle diff.${key}[${i}] must be a non-empty string`);
    });
  }
  return value as unknown as BacktestResearchBundleDiff;
}

// --- human formatter ---------------------------------------------------------

export interface FormatBacktestResearchBundleDiffOptions {
  baseLabel?: string;
  nextLabel?: string;
  /** Cap on the number of per-artifact rows printed per section (default 50; the rest are summarized). */
  maxArtifactRows?: number;
}

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n}`;
}

/**
 * Render a redacted, human-readable, PAPER-ONLY bundle diff. Sectioned and stable for a given diff
 * object; long artifact lists are summarized (never an unsafe raw dump). Leads with the run-digest
 * change and closes with the CHANGE / REGRESSION verdicts + the not-live / not-advice framing.
 */
export function formatBacktestResearchBundleDiff(
  diff: BacktestResearchBundleDiff,
  opts: FormatBacktestResearchBundleDiffOptions = {},
): string {
  const baseLabel = opts.baseLabel ?? diff.baseRunName ?? "base";
  const nextLabel = opts.nextLabel ?? diff.nextRunName ?? "next";
  const maxRows = opts.maxArtifactRows ?? 50;
  const lines: string[] = [];

  const header = "Research bundle diff (SIMULATED PAPER-ONLY)";
  lines.push(header);
  lines.push("=".repeat(header.length));

  lines.push("Bundle pair:");
  lines.push(`- base (${baseLabel}): run ${diff.baseRunName ?? "(unnamed)"}  digest ${diff.baseRunDigest}`);
  lines.push(`- next (${nextLabel}): run ${diff.nextRunName ?? "(unnamed)"}  digest ${diff.nextRunDigest}`);
  if (!diff.bundleSchemaMatch) lines.push("- note: bundle schema versions differ (incompatible)");
  lines.push(`- run digest changed: ${diff.runDigestChanged ? "YES" : "no"}`);
  lines.push("");

  lines.push("Counts:");
  lines.push(`- artifacts: ${diff.artifactCount.base} → ${diff.artifactCount.next} (Δ ${signed(diff.artifactCount.delta)})`);
  lines.push(`- total bytes: ${diff.totalSizeBytes.base} → ${diff.totalSizeBytes.next} (Δ ${signed(diff.totalSizeBytes.delta)})`);
  lines.push(`- unknown: ${diff.unknownArtifactCount.base} → ${diff.unknownArtifactCount.next} (Δ ${signed(diff.unknownArtifactCount.delta)})`);
  lines.push(`- malformed: ${diff.malformedArtifactCount.base} → ${diff.malformedArtifactCount.next} (Δ ${signed(diff.malformedArtifactCount.delta)})`);
  lines.push(`- warnings: ${diff.warningCount.base} → ${diff.warningCount.next} (Δ ${signed(diff.warningCount.delta)})`);
  lines.push("");

  const section = (title: string, rows: string[]): void => {
    lines.push(`${title} (${rows.length}):`);
    if (rows.length === 0) {
      lines.push("  - (none)");
      return;
    }
    for (const r of rows.slice(0, maxRows)) lines.push(`  - ${r}`);
    const hidden = rows.length - Math.min(rows.length, maxRows);
    if (hidden > 0) lines.push(`  - … and ${hidden} more (summarized; see the diff JSON for the full list)`);
  };
  section("Added artifacts", diff.added.map((a) => `${a.path}  ${a.digest}`));
  section("Removed artifacts", diff.removed.map((a) => `${a.path}  ${a.digest}`));
  section("Changed artifacts", diff.changed.map((c) => `${c.path}  ${c.baseDigest} → ${c.nextDigest}`));
  lines.push("");

  if (diff.recognizedSchemasAdded.length > 0 || diff.recognizedSchemasRemoved.length > 0) {
    lines.push("Recognized schema set:");
    for (const s of diff.recognizedSchemasAdded) lines.push(`  + ${s}`);
    for (const s of diff.recognizedSchemasRemoved) lines.push(`  - ${s}`);
    lines.push("");
  }
  if (diff.kindCountChanges.length > 0) {
    lines.push("Kind count changes:");
    for (const k of diff.kindCountChanges) lines.push(`  - ${k.key}: ${k.base} → ${k.next} (Δ ${signed(k.delta)})`);
    lines.push("");
  }
  if (diff.schemaCountChanges.length > 0) {
    lines.push("Schema count changes:");
    for (const s of diff.schemaCountChanges) lines.push(`  - ${s.key}: ${s.base} → ${s.next} (Δ ${signed(s.delta)})`);
    lines.push("");
  }

  lines.push(`Changed: ${diff.hasChange ? "YES" : "no"}`);
  if (diff.hasChange) for (const r of diff.changeReasons) lines.push(`- ${r}`);
  lines.push(`Regression: ${diff.hasRegression ? "YES" : "no"}`);
  if (diff.hasRegression) for (const r of diff.regressionReasons) lines.push(`- ${r}`);
  lines.push("");

  lines.push("Notes:");
  for (const d of diff.disclaimers) lines.push(`- ${d}`);

  return redactString(lines.join("\n"));
}
