/**
 * Frontend-only normalizer for a LOCAL PAPER research/backtest report artifact.
 *
 * This module turns an arbitrary, untrusted JSON value (already read from a
 * local file by a Node-only command — see ../inspect.ts) into a small, bounded,
 * UI-friendly summary. It is intentionally:
 *
 *   - defensive   — accepts any JSON shape (object, array, primitive, null) and
 *                   never throws on hostile or malformed-but-parsed input;
 *   - honest      — labels schemas as known / emerging / unknown / absent rather
 *                   than pretending to understand them;
 *   - bounded     — caps field counts, string lengths, and the raw preview so a
 *                   huge or deeply-nested artifact can never be dumped wholesale
 *                   into the page;
 *   - escaping-agnostic — values returned here are PLAIN strings. HTML escaping
 *                   happens at render time (see ../components/artifact.ts). This
 *                   module must therefore never emit pre-escaped or raw HTML.
 *
 * It imports NO backend package and performs NO file, network, chain, or wallet
 * activity. `parseArtifactJson` is the only place JSON is decoded.
 */

import {
  knownSchema,
  recognizeSchema,
  type ReportSchemaInfo,
  type SchemaRecognition,
} from "./report-types.js";

/** Bounds applied to every normalized artifact (never dump unbounded data). */
export const ARTIFACT_LIMITS = {
  /** Max top-level scalar fields surfaced in the field table. */
  maxScalarFields: 60,
  /** Max characters kept for any single scalar string value. */
  maxStringValue: 240,
  /** Max top-level nested (object/array) entries summarized. */
  maxNestedFields: 60,
  /** Max warning/disclaimer entries surfaced. */
  maxWarnings: 30,
  /** Max characters kept for any single warning string. */
  maxWarningLength: 400,
  /** Max characters of pretty-printed JSON kept for the raw preview. */
  maxPreviewChars: 4000,
  /** Max characters kept for an identity/digest value. */
  maxIdentityValue: 240,
} as const;

export type ParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string };

/** Decode JSON text safely. The ONLY JSON.parse in the inspector path. */
export function parseArtifactJson(text: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type ScalarKind = "string" | "number" | "boolean" | "null";

/** The broad shape of the artifact's top-level JSON value. */
export type RootShape = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface ArtifactScalarField {
  readonly key: string;
  /** Plain (un-escaped) display value, already length-capped. */
  readonly value: string;
  readonly kind: ScalarKind;
  readonly truncated: boolean;
}

export interface ArtifactNestedField {
  readonly key: string;
  /** Human summary, e.g. "array · 12 items" or "object · 5 keys". */
  readonly summary: string;
}

export interface ArtifactKeyValue {
  readonly key: string;
  /** Plain (un-escaped) display value, already length-capped. */
  readonly value: string;
}

export interface ArtifactPreview {
  /** Pretty-printed JSON, length-capped. Plain text — escaped at render time. */
  readonly text: string;
  readonly truncated: boolean;
  readonly totalChars: number;
}

export interface NormalizedArtifact {
  readonly schemaVersion: string | null;
  readonly schemaStatus: SchemaRecognition;
  readonly schemaInfo: ReportSchemaInfo | null;
  readonly rootShape: RootShape;
  /** Human label for the artifact kind (never fabricated). */
  readonly kind: string;
  /** Convenience identity fields pulled from common keys (title/name/id/mode). */
  readonly identity: readonly ArtifactKeyValue[];
  /** A digest-like field if one is present (scenarioDigest, digest, hash …). */
  readonly digest: ArtifactKeyValue | null;
  /** Bounded list of top-level scalar fields. */
  readonly scalars: readonly ArtifactScalarField[];
  /** Bounded summaries of top-level object/array fields (never dumped). */
  readonly nested: readonly ArtifactNestedField[];
  /** Bounded list of warning / disclaimer / error strings found in the artifact. */
  readonly warnings: readonly string[];
  /** Capped pretty-printed preview of the whole artifact. */
  readonly preview: ArtifactPreview;
  /** Diagnostic notes about what was capped, redacted, or unusual. */
  readonly notes: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampString(value: string, max: number): { text: string; truncated: boolean } {
  if (value.length <= max) {
    return { text: value, truncated: false };
  }
  return { text: value.slice(0, max), truncated: true };
}

function scalarKind(value: unknown): ScalarKind | null {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return null;
}

function scalarToDisplay(value: string | number | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "(non-finite number)";
  }
  return value;
}

function rootShapeOf(value: unknown): RootShape {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "object") return "object";
  if (t === "string" || t === "number" || t === "boolean") return t;
  // Functions / undefined / symbol / bigint cannot come from JSON.parse, but be safe.
  return "null";
}

/** First key in `keys` whose value is a non-empty string; length-capped. */
function pickStringField(
  record: Record<string, unknown>,
  keys: readonly string[],
): ArtifactKeyValue | null {
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === "string" && raw.length > 0) {
      const { text } = clampString(raw, ARTIFACT_LIMITS.maxIdentityValue);
      return { key, value: text };
    }
  }
  return null;
}

const IDENTITY_KEY_SETS: readonly (readonly string[])[] = [
  ["title", "name", "label"],
  ["id", "runId", "scenarioId", "suiteId"],
  ["mode"],
];

const DIGEST_KEYS: readonly string[] = [
  "scenarioDigest",
  "digest",
  "bundleDigest",
  "manifestDigest",
  "reportDigest",
  "sha256",
  "hash",
];

const WARNING_KEYS: readonly string[] = [
  "warnings",
  "warning",
  "disclaimers",
  "disclaimer",
  "errors",
  "error",
];

/** Pull one warning string from a possibly-nested entry, defensively. */
function warningFromEntry(entry: unknown): string | null {
  if (typeof entry === "string") {
    return entry.length > 0 ? entry : null;
  }
  if (typeof entry === "number" || typeof entry === "boolean") {
    return String(entry);
  }
  if (isRecord(entry)) {
    for (const key of ["message", "text", "detail", "reason", "code"]) {
      const v = entry[key];
      if (typeof v === "string" && v.length > 0) {
        return v;
      }
    }
    return "(structured warning)";
  }
  return null;
}

function collectWarnings(record: Record<string, unknown>, notes: string[]): string[] {
  const out: string[] = [];
  let dropped = 0;
  for (const key of WARNING_KEYS) {
    if (!(key in record)) continue;
    const value = record[key];
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      const text = warningFromEntry(entry);
      if (text === null) continue;
      if (out.length >= ARTIFACT_LIMITS.maxWarnings) {
        dropped += 1;
        continue;
      }
      out.push(clampString(text, ARTIFACT_LIMITS.maxWarningLength).text);
    }
  }
  if (dropped > 0) {
    notes.push(`${dropped} additional warning(s) not shown (cap ${ARTIFACT_LIMITS.maxWarnings}).`);
  }
  return out;
}

function buildPreview(value: unknown, notes: string[]): ArtifactPreview {
  let serialized: string;
  try {
    serialized = JSON.stringify(value, null, 2) ?? "(no preview)";
  } catch {
    notes.push("Preview unavailable: value could not be serialized to JSON.");
    return { text: "(preview unavailable)", truncated: false, totalChars: 0 };
  }
  const totalChars = serialized.length;
  const { text, truncated } = clampString(serialized, ARTIFACT_LIMITS.maxPreviewChars);
  if (truncated) {
    notes.push(
      `Preview truncated to ${ARTIFACT_LIMITS.maxPreviewChars} of ${totalChars} characters.`,
    );
  }
  return { text, truncated, totalChars };
}

function describeNested(value: unknown): string {
  if (Array.isArray(value)) {
    return `array · ${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  if (isRecord(value)) {
    const n = Object.keys(value).length;
    return `object · ${n} key${n === 1 ? "" : "s"}`;
  }
  return "value";
}

function inferKind(
  schemaInfo: ReportSchemaInfo | null,
  status: SchemaRecognition,
  rootShape: RootShape,
): string {
  if (schemaInfo) return schemaInfo.title;
  if (status === "unknown") return "Unrecognized artifact";
  switch (rootShape) {
    case "object":
      return "Unlabelled JSON object";
    case "array":
      return "JSON array";
    case "string":
      return "JSON string";
    case "number":
      return "JSON number";
    case "boolean":
      return "JSON boolean";
    case "null":
      return "JSON null";
  }
}

/**
 * Normalize an arbitrary parsed JSON value into a bounded UI summary. Pure and
 * total: never throws, never reaches outside the value it is given.
 */
export function normalizeArtifact(value: unknown): NormalizedArtifact {
  const notes: string[] = [];
  const rootShape = rootShapeOf(value);

  const record = isRecord(value) ? value : null;

  const rawSchema = record?.["schemaVersion"];
  const schemaVersion = typeof rawSchema === "string" && rawSchema.length > 0 ? rawSchema : null;
  if (record && rawSchema !== undefined && schemaVersion === null) {
    notes.push("`schemaVersion` is present but is not a non-empty string; treated as absent.");
  }
  const schemaStatus = recognizeSchema(schemaVersion);
  const schemaInfo = schemaVersion ? (knownSchema(schemaVersion) ?? null) : null;
  const kind = inferKind(schemaInfo, schemaStatus, rootShape);

  if (!record) {
    if (rootShape === "array") {
      notes.push("Top-level value is a JSON array, not an object.");
    } else {
      notes.push(`Top-level value is a JSON ${rootShape}, not an object.`);
    }
    const nested: ArtifactNestedField[] =
      rootShape === "array" ? [{ key: "(root)", summary: describeNested(value) }] : [];
    return {
      schemaVersion,
      schemaStatus,
      schemaInfo,
      rootShape,
      kind,
      identity: [],
      digest: null,
      scalars: [],
      nested,
      warnings: [],
      preview: buildPreview(value, notes),
      notes,
    };
  }

  // Identity + digest convenience extractions.
  const identity: ArtifactKeyValue[] = [];
  for (const keySet of IDENTITY_KEY_SETS) {
    const found = pickStringField(record, keySet);
    if (found) identity.push(found);
  }
  const digest = pickStringField(record, DIGEST_KEYS);
  const warnings = collectWarnings(record, notes);

  // Top-level scalar + nested fields (schemaVersion shown in the badge, omitted here).
  const scalars: ArtifactScalarField[] = [];
  const nested: ArtifactNestedField[] = [];
  let droppedScalars = 0;
  let droppedNested = 0;

  for (const [key, raw] of Object.entries(record)) {
    if (key === "schemaVersion") continue;
    const kindOf = scalarKind(raw);
    if (kindOf !== null) {
      if (scalars.length >= ARTIFACT_LIMITS.maxScalarFields) {
        droppedScalars += 1;
        continue;
      }
      const { text, truncated } = clampString(
        scalarToDisplay(raw as string | number | boolean | null),
        ARTIFACT_LIMITS.maxStringValue,
      );
      scalars.push({ key, value: text, kind: kindOf, truncated });
    } else {
      if (nested.length >= ARTIFACT_LIMITS.maxNestedFields) {
        droppedNested += 1;
        continue;
      }
      nested.push({ key, summary: describeNested(raw) });
    }
  }

  if (droppedScalars > 0) {
    notes.push(
      `${droppedScalars} additional scalar field(s) not shown (cap ${ARTIFACT_LIMITS.maxScalarFields}).`,
    );
  }
  if (droppedNested > 0) {
    notes.push(
      `${droppedNested} additional nested field(s) not shown (cap ${ARTIFACT_LIMITS.maxNestedFields}).`,
    );
  }

  return {
    schemaVersion,
    schemaStatus,
    schemaInfo,
    rootShape,
    kind,
    identity,
    digest,
    scalars,
    nested,
    warnings,
    preview: buildPreview(value, notes),
    notes,
  };
}

/**
 * A compact, machine-readable summary (for the `--json` CLI flag). Contains only
 * bounded, already-normalized data — safe to print and to diff.
 */
export interface ArtifactSummaryJson {
  readonly schemaVersion: string | null;
  readonly schemaStatus: SchemaRecognition;
  readonly kind: string;
  readonly rootShape: RootShape;
  readonly digest: ArtifactKeyValue | null;
  readonly scalarFieldCount: number;
  readonly nestedFieldCount: number;
  readonly warningCount: number;
  readonly previewTruncated: boolean;
  readonly notes: readonly string[];
}

/** Derive the machine-readable summary from a normalized artifact. */
export function toSummaryJson(view: NormalizedArtifact): ArtifactSummaryJson {
  return {
    schemaVersion: view.schemaVersion,
    schemaStatus: view.schemaStatus,
    kind: view.kind,
    rootShape: view.rootShape,
    digest: view.digest,
    scalarFieldCount: view.scalars.length,
    nestedFieldCount: view.nested.length,
    warningCount: view.warnings.length,
    previewTruncated: view.preview.truncated,
    notes: view.notes,
  };
}
