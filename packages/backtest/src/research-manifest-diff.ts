/**
 * Deterministic diff of two Sprint 16 RESEARCH MANIFESTS, for comparing what two local
 * PAPER-only research runs produced (Sprint 16, the manifest analogue of the other diffs).
 *
 * `diffBacktestResearchManifests(base, next)` structurally reads both manifests (refusing a
 * non-manifest), then produces a {@link BacktestResearchManifestDiff}: artifact-count and
 * total-size deltas, per-artifact (paired by path) added/removed/changed lists (with
 * digest/schema/kind/size changes), kind-count and schema-count changes, and a `hasChange`
 * flag with reasons. It is **pure**: no network, no RPC, no wallet, no filesystem, no
 * `Date.now`, no `Math.random`, and it never mutates its inputs (every value placed in the
 * diff is a fresh copy with stable key order, so the JSON is byte-stable for a given pair).
 *
 * This is a reproducibility/audit comparison over LOCAL artifact indexes — never a live
 * result, never advice, never a profitability claim. The digest difference it reports is a
 * non-cryptographic content fingerprint change, not a security or anti-tamper signal.
 */

import { redactString } from "@soulmaker/security";
import type { BacktestArtifactDescriptor, BacktestArtifactKind } from "./research-manifest.js";

/** Stable schema identifier for the research-manifest-diff shape. Bump only on a breaking change. */
export const BACKTEST_RESEARCH_MANIFEST_DIFF_SCHEMA_VERSION = "backtest.research.manifest.diff.v1";

/** Required disclaimers carried by every manifest diff (stable order). */
export const BACKTEST_RESEARCH_MANIFEST_DIFF_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY research manifest diff — compares two LOCAL artifact indexes.",
  "Every value is a change between two local reproducibility indexes, not a live result.",
  "A changed digest is a non-cryptographic content-fingerprint difference, not a security or anti-tamper signal.",
  "Uses injected manifest data only — no live data was fetched and nothing was traded.",
  "Not a live result. Not financial advice. Not a profitability claim.",
];

/** Thrown when an `unknown` value is not a structurally valid manifest/diff. */
export class BacktestResearchManifestDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestResearchManifestDiffError";
  }
}

// --- diff data model ---------------------------------------------------------

/** A simple base→next numeric comparison. */
export interface ResearchManifestNumberDelta {
  base: number;
  next: number;
  delta: number;
}

/** A paired artifact (same path in BOTH manifests) whose recorded fields changed. */
export interface ResearchManifestArtifactChange {
  path: string;
  baseKind: BacktestArtifactKind;
  nextKind: BacktestArtifactKind;
  kindChanged: boolean;
  baseSchemaVersion: string | null;
  nextSchemaVersion: string | null;
  schemaChanged: boolean;
  baseDigest: string;
  nextDigest: string;
  digestChanged: boolean;
  sizeBytes: ResearchManifestNumberDelta;
}

/** A per-key count change (kind counts or schema counts). */
export interface ResearchManifestCountChange {
  key: string;
  base: number;
  next: number;
  delta: number;
}

/** The full, deterministic, JSON-serializable diff of two research manifests. */
export interface BacktestResearchManifestDiff {
  schemaVersion: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  baseRunName: string | null;
  nextRunName: string | null;
  /** Whether the two manifest schema versions matched (informational). */
  manifestSchemaMatch: boolean;
  artifactCount: ResearchManifestNumberDelta;
  totalSizeBytes: ResearchManifestNumberDelta;
  added: BacktestArtifactDescriptor[];
  removed: BacktestArtifactDescriptor[];
  changed: ResearchManifestArtifactChange[];
  kindCountChanges: ResearchManifestCountChange[];
  schemaCountChanges: ResearchManifestCountChange[];
  hasChange: boolean;
  changeReasons: string[];
  disclaimers: string[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function comparePath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function delta(base: number, next: number): ResearchManifestNumberDelta {
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

/** A lightweight, schemaVersion-lenient read of a manifest for diffing (strict on what it reads). */
interface ReadManifest {
  schemaVersion: string;
  runName: string | null;
  artifactCount: number;
  totalSizeBytes: number;
  artifacts: BacktestArtifactDescriptor[];
}

function readDescriptor(value: unknown, where: string): BacktestArtifactDescriptor {
  if (!isObject(value)) throw new BacktestResearchManifestDiffError(`${where} must be an object`);
  if (!nonEmptyString(value.path)) throw new BacktestResearchManifestDiffError(`${where}.path must be a non-empty string`);
  if (typeof value.kind !== "string" || !ARTIFACT_KIND_SET.has(value.kind)) {
    throw new BacktestResearchManifestDiffError(`${where}.kind "${String(value.kind)}" is not a known artifact kind`);
  }
  if (value.schemaVersion !== null && typeof value.schemaVersion !== "string") {
    throw new BacktestResearchManifestDiffError(`${where}.schemaVersion must be a string or null`);
  }
  if (!nonEmptyString(value.digest)) throw new BacktestResearchManifestDiffError(`${where}.digest must be a non-empty string`);
  if (!isFiniteNumber(value.sizeBytes) || !Number.isInteger(value.sizeBytes) || value.sizeBytes < 0) {
    throw new BacktestResearchManifestDiffError(`${where}.sizeBytes must be a non-negative integer`);
  }
  return {
    path: value.path,
    kind: value.kind as BacktestArtifactKind,
    schemaVersion: (value.schemaVersion as string | null) ?? null,
    digest: value.digest,
    sizeBytes: value.sizeBytes,
  };
}

/**
 * Structurally read one INPUT manifest for diffing. Lenient on `schemaVersion` (any
 * non-empty string) so a version mismatch is surfaced rather than refused, but strict about
 * every field the diff reads. Does NOT mutate. Throws {@link BacktestResearchManifestDiffError}.
 */
function readManifestForDiff(value: unknown, side: string): ReadManifest {
  if (!isObject(value)) throw new BacktestResearchManifestDiffError(`${side} manifest must be a JSON object`);
  if (!nonEmptyString(value.schemaVersion)) {
    throw new BacktestResearchManifestDiffError(`${side} manifest.schemaVersion must be a non-empty string`);
  }
  if (value.runName !== null && typeof value.runName !== "string") {
    throw new BacktestResearchManifestDiffError(`${side} manifest.runName must be a string or null`);
  }
  if (!Array.isArray(value.artifacts)) {
    throw new BacktestResearchManifestDiffError(`${side} manifest.artifacts must be an array`);
  }
  const artifacts = value.artifacts.map((a, i) => readDescriptor(a, `${side} manifest.artifacts[${i}]`));
  return {
    schemaVersion: value.schemaVersion,
    runName: (value.runName as string | null) ?? null,
    artifactCount: isFiniteNumber(value.artifactCount) ? value.artifactCount : artifacts.length,
    totalSizeBytes: isFiniteNumber(value.totalSizeBytes)
      ? value.totalSizeBytes
      : artifacts.reduce((s, a) => s + a.sizeBytes, 0),
    artifacts,
  };
}

/** Count artifacts by a derived key (kind or schema). Returned as a stable-sorted map. */
function countBy(artifacts: BacktestArtifactDescriptor[], key: (a: BacktestArtifactDescriptor) => string): Map<string, number> {
  const map = new Map<string, number>();
  for (const a of artifacts) {
    const k = key(a);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

/** Build the per-key count changes (only keys whose count actually changed), sorted by key. */
function countChanges(
  base: Map<string, number>,
  next: Map<string, number>,
): ResearchManifestCountChange[] {
  const keys = [...new Set([...base.keys(), ...next.keys()])].sort(comparePath);
  const out: ResearchManifestCountChange[] = [];
  for (const key of keys) {
    const b = base.get(key) ?? 0;
    const n = next.get(key) ?? 0;
    if (b !== n) out.push({ key, base: b, next: n, delta: n - b });
  }
  return out;
}

// --- public API --------------------------------------------------------------

/**
 * Compute the deterministic diff of two research manifests. Both inputs are structurally
 * read (a non-manifest throws {@link BacktestResearchManifestDiffError}); neither is mutated.
 * Artifacts are paired by `path`; an artifact present in both whose digest, schema, kind, or
 * size differs is "changed". Pure and byte-stable for a given input pair.
 */
export function diffBacktestResearchManifests(base: unknown, next: unknown): BacktestResearchManifestDiff {
  const b = readManifestForDiff(base, "base");
  const n = readManifestForDiff(next, "next");

  const baseByPath = new Map(b.artifacts.map((a) => [a.path, a]));
  const nextByPath = new Map(n.artifacts.map((a) => [a.path, a]));

  const added = n.artifacts.filter((a) => !baseByPath.has(a.path)).map((a) => ({ ...a }));
  const removed = b.artifacts.filter((a) => !nextByPath.has(a.path)).map((a) => ({ ...a }));
  added.sort((x, y) => comparePath(x.path, y.path));
  removed.sort((x, y) => comparePath(x.path, y.path));

  const changed: ResearchManifestArtifactChange[] = [];
  for (const na of n.artifacts) {
    const ba = baseByPath.get(na.path);
    if (!ba) continue;
    const kindChanged = ba.kind !== na.kind;
    const schemaChanged = ba.schemaVersion !== na.schemaVersion;
    const digestChanged = ba.digest !== na.digest;
    const sizeChanged = ba.sizeBytes !== na.sizeBytes;
    if (!kindChanged && !schemaChanged && !digestChanged && !sizeChanged) continue;
    changed.push({
      path: na.path,
      baseKind: ba.kind,
      nextKind: na.kind,
      kindChanged,
      baseSchemaVersion: ba.schemaVersion,
      nextSchemaVersion: na.schemaVersion,
      schemaChanged,
      baseDigest: ba.digest,
      nextDigest: na.digest,
      digestChanged,
      sizeBytes: delta(ba.sizeBytes, na.sizeBytes),
    });
  }
  changed.sort((x, y) => comparePath(x.path, y.path));

  const kindCountChanges = countChanges(
    countBy(b.artifacts, (a) => a.kind),
    countBy(n.artifacts, (a) => a.kind),
  );
  const schemaCountChanges = countChanges(
    countBy(b.artifacts, (a) => a.schemaVersion ?? "(none)"),
    countBy(n.artifacts, (a) => a.schemaVersion ?? "(none)"),
  );

  const manifestSchemaMatch = b.schemaVersion === n.schemaVersion;

  const changeReasons: string[] = [];
  if (!manifestSchemaMatch) {
    changeReasons.push(`manifest schemaVersion differs ("${b.schemaVersion}" → "${n.schemaVersion}")`);
  }
  if (added.length > 0) changeReasons.push(`${added.length} artifact(s) added`);
  if (removed.length > 0) changeReasons.push(`${removed.length} artifact(s) removed`);
  for (const c of changed) {
    const parts: string[] = [];
    if (c.digestChanged) parts.push("digest");
    if (c.schemaChanged) parts.push("schema");
    if (c.kindChanged) parts.push("kind");
    if (c.sizeBytes.delta !== 0) parts.push("size");
    changeReasons.push(`artifact "${c.path}" changed (${parts.join(", ")})`);
  }

  return {
    schemaVersion: BACKTEST_RESEARCH_MANIFEST_DIFF_SCHEMA_VERSION,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    baseRunName: b.runName,
    nextRunName: n.runName,
    manifestSchemaMatch,
    artifactCount: delta(b.artifactCount, n.artifactCount),
    totalSizeBytes: delta(b.totalSizeBytes, n.totalSizeBytes),
    added,
    removed,
    changed,
    kindCountChanges,
    schemaCountChanges,
    hasChange: changeReasons.length > 0,
    changeReasons,
    disclaimers: [...BACKTEST_RESEARCH_MANIFEST_DIFF_DISCLAIMERS],
  };
}

// --- validation (backstop) ---------------------------------------------------

/**
 * Strictly validate a value as a {@link BacktestResearchManifestDiff} and return it narrowed.
 * Checks the schema version, the disclaimers, the change flag/reasons, and the
 * added/removed/changed shapes. Throws {@link BacktestResearchManifestDiffError}. Pure.
 */
function isNumberDelta(value: unknown): boolean {
  return isObject(value) && isFiniteNumber(value.base) && isFiniteNumber(value.next) && isFiniteNumber(value.delta);
}

export function validateBacktestResearchManifestDiff(value: unknown): BacktestResearchManifestDiff {
  if (!isObject(value)) throw new BacktestResearchManifestDiffError("manifest diff must be a JSON object");
  if (value.schemaVersion !== BACKTEST_RESEARCH_MANIFEST_DIFF_SCHEMA_VERSION) {
    throw new BacktestResearchManifestDiffError(
      `manifest diff.schemaVersion must be "${BACKTEST_RESEARCH_MANIFEST_DIFF_SCHEMA_VERSION}"`,
    );
  }
  // The required PAPER-ONLY labelling must survive serialization (mirrors the other validators).
  for (const flag of [
    "paperOnly",
    "simulated",
    "notLiveResult",
    "notFinancialAdvice",
    "notProfitabilityClaim",
  ] as const) {
    if (value[flag] !== true) {
      throw new BacktestResearchManifestDiffError(`manifest diff.${flag} must be true`);
    }
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new BacktestResearchManifestDiffError("manifest diff.disclaimers must be a non-empty array");
  }
  if (typeof value.hasChange !== "boolean") {
    throw new BacktestResearchManifestDiffError("manifest diff.hasChange must be a boolean");
  }
  if (!Array.isArray(value.changeReasons)) {
    throw new BacktestResearchManifestDiffError("manifest diff.changeReasons must be an array");
  }
  for (const f of ["artifactCount", "totalSizeBytes"] as const) {
    if (!isNumberDelta(value[f])) {
      throw new BacktestResearchManifestDiffError(`manifest diff.${f} must be a {base,next,delta} number delta`);
    }
  }
  // Every list the formatter reads must be an array of WELL-FORMED elements (strict backstop).
  for (const key of ["added", "removed"] as const) {
    if (!Array.isArray(value[key])) {
      throw new BacktestResearchManifestDiffError(`manifest diff.${key} must be an array`);
    }
    (value[key] as unknown[]).forEach((d, i) => readDescriptor(d, `manifest diff.${key}[${i}]`));
  }
  if (!Array.isArray(value.changed)) {
    throw new BacktestResearchManifestDiffError("manifest diff.changed must be an array");
  }
  value.changed.forEach((c, i) => {
    const where = `manifest diff.changed[${i}]`;
    if (!isObject(c)) throw new BacktestResearchManifestDiffError(`${where} must be an object`);
    if (!nonEmptyString(c.path)) throw new BacktestResearchManifestDiffError(`${where}.path must be a non-empty string`);
    for (const b of ["kindChanged", "schemaChanged", "digestChanged"] as const) {
      if (typeof c[b] !== "boolean") throw new BacktestResearchManifestDiffError(`${where}.${b} must be a boolean`);
    }
    if (!isNumberDelta(c.sizeBytes)) {
      throw new BacktestResearchManifestDiffError(`${where}.sizeBytes must be a {base,next,delta} number delta`);
    }
  });
  for (const key of ["kindCountChanges", "schemaCountChanges"] as const) {
    if (!Array.isArray(value[key])) {
      throw new BacktestResearchManifestDiffError(`manifest diff.${key} must be an array`);
    }
    (value[key] as unknown[]).forEach((c, i) => {
      const where = `manifest diff.${key}[${i}]`;
      if (!isObject(c) || !nonEmptyString(c.key) || !isFiniteNumber(c.base) || !isFiniteNumber(c.next) || !isFiniteNumber(c.delta)) {
        throw new BacktestResearchManifestDiffError(`${where} must be a {key,base,next,delta} count change`);
      }
    });
  }
  return value as unknown as BacktestResearchManifestDiff;
}

// --- human formatter ---------------------------------------------------------

export interface FormatBacktestResearchManifestDiffOptions {
  baseLabel?: string;
  nextLabel?: string;
}

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n}`;
}

/**
 * Render a redacted, human-readable, PAPER-ONLY manifest diff. Sectioned and stable for a
 * given diff object. Notes the non-cryptographic / local-artifacts / not-live framing.
 */
export function formatBacktestResearchManifestDiff(
  diff: BacktestResearchManifestDiff,
  opts: FormatBacktestResearchManifestDiffOptions = {},
): string {
  const baseLabel = opts.baseLabel ?? diff.baseRunName ?? "base";
  const nextLabel = opts.nextLabel ?? diff.nextRunName ?? "next";
  const lines: string[] = [];

  const header = "Research manifest diff (SIMULATED PAPER-ONLY)";
  lines.push(header);
  lines.push("=".repeat(header.length));

  lines.push("Manifest pair:");
  lines.push(`- base (${baseLabel}): run ${diff.baseRunName ?? "(unnamed)"}  (${diff.artifactCount.base} artifact(s))`);
  lines.push(`- next (${nextLabel}): run ${diff.nextRunName ?? "(unnamed)"}  (${diff.artifactCount.next} artifact(s))`);
  if (!diff.manifestSchemaMatch) lines.push("- note: manifest schema versions differ");
  lines.push("");

  lines.push("Counts:");
  lines.push(`- artifacts: ${diff.artifactCount.base} → ${diff.artifactCount.next} (Δ ${signed(diff.artifactCount.delta)})`);
  lines.push(`- total bytes: ${diff.totalSizeBytes.base} → ${diff.totalSizeBytes.next} (Δ ${signed(diff.totalSizeBytes.delta)})`);
  lines.push("");

  lines.push(`Added artifacts (${diff.added.length}):`);
  if (diff.added.length === 0) lines.push("  - (none)");
  else for (const a of diff.added) lines.push(`  - ${a.path} [${a.kind} · ${a.schemaVersion ?? "(none)"}]`);
  lines.push(`Removed artifacts (${diff.removed.length}):`);
  if (diff.removed.length === 0) lines.push("  - (none)");
  else for (const a of diff.removed) lines.push(`  - ${a.path} [${a.kind} · ${a.schemaVersion ?? "(none)"}]`);
  lines.push(`Changed artifacts (${diff.changed.length}):`);
  if (diff.changed.length === 0) lines.push("  - (none)");
  else {
    for (const c of diff.changed) {
      const tags: string[] = [];
      if (c.digestChanged) tags.push("digest");
      if (c.schemaChanged) tags.push("schema");
      if (c.kindChanged) tags.push("kind");
      if (c.sizeBytes.delta !== 0) tags.push(`size ${signed(c.sizeBytes.delta)}B`);
      lines.push(`  - ${c.path} [${tags.join(", ")}]`);
    }
  }
  lines.push("");

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
  lines.push("");

  lines.push("Notes:");
  for (const d of diff.disclaimers) lines.push(`- ${d}`);

  return redactString(lines.join("\n"));
}
