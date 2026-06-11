/**
 * Frontend-only, pure layer for a LOCAL artifact FOLDER index.
 *
 * Given a list of already-read directory entries (the Node-only `--dir` mode of
 * ../inspect.ts does the filesystem reads), this module:
 *
 *   - parses each `.json` entry defensively (never throws on malformed input);
 *   - normalizes valid artifacts via ./local-artifact.ts;
 *   - extracts a conservative, schema-aware DIFF VERDICT per artifact
 *     ({@link extractVerdict}) — `hasRegression` / `hasChange` reported only when
 *     the recognized schema actually carries that field, never inferred;
 *   - aggregates honest counts (scanned / valid / malformed / skipped / unknown /
 *     with-regression / with-change) and a by-schema breakdown.
 *
 * It imports NO backend package and performs NO file, network, chain, or wallet
 * activity. The only knowledge it borrows from the renderer layer is "does a
 * typed view exist for this schema?", which is INJECTED as a predicate so this
 * module stays in the `lib` layer (lib never imports components).
 */

import {
  isKnownSchema,
  knownSchema,
  type SchemaRecognition,
} from "./report-types.js";
import {
  normalizeArtifact,
  parseArtifactJson,
  type NormalizedArtifact,
} from "./local-artifact.js";
import { asRecord, readBoolean } from "./json-access.js";

/* ------------------------------------------------------------------ *
 * Diff verdict extraction.
 * ------------------------------------------------------------------ */

/** Tri-/quad-state of a single verdict field. `missing` is never `no`. */
export type VerdictState = "yes" | "no" | "missing" | "not-applicable";

export interface ArtifactVerdict {
  readonly hasRegression: VerdictState;
  readonly hasChange: VerdictState;
  /** Why a field is missing / not-applicable / could not be read. */
  readonly notes: readonly string[];
}

interface VerdictCapability {
  readonly regression: boolean;
  readonly change: boolean;
  /** The exact boolean field read for the regression verdict (default `hasRegression`).
   * Set ONLY when the backend schema names its own regression-grade flag differently. */
  readonly regressionKey?: string;
  /** The exact boolean field read for the change verdict (default `hasChange`). */
  readonly changeKey?: string;
}

/**
 * Which recognized schemas actually carry a regression / change verdict
 * boolean, and under which exact field name. This mirrors the backend diff
 * interfaces verified on `master`:
 *   - backtest diffs (packages/backtest/src/*-diff.ts): the sensitivity /
 *     suite / matrix diffs carry only `hasRegression`; the research-manifest
 *     diff carries only `hasChange`; bundle and campaign diffs carry BOTH.
 *   - simulation diffs (packages/simulation/src/*-diff.ts): both carry
 *     `hasChange`, and their own regression-grade verdict is `hasNewBlocking`
 *     (a previously-unblocked plan/result became blocked).
 *   - the sniper run-report diff v2 (packages/sniper/src/run-report-v2-diff.ts)
 *     carries `hasAnyChange` (v1 core OR v2 layer change) and its
 *     regression-grade verdict is `hasNewOperatorBlocking`.
 * Any schema NOT listed here carries neither field, so its verdicts are
 * `not-applicable` — never inferred.
 */
const VERDICT_CAPABILITIES: Readonly<Record<string, VerdictCapability>> = {
  "backtest.suite.diff.v1": { regression: true, change: false },
  "backtest.sensitivity.diff.v1": { regression: true, change: false },
  "backtest.sensitivity.matrix.diff.v1": { regression: true, change: false },
  "backtest.research.manifest.diff.v1": { regression: false, change: true },
  "backtest.research.bundle.diff.v1": { regression: true, change: true },
  "backtest.research.campaign.diff.v1": { regression: true, change: true },
  "simulation.intent.plan.diff.v2": { regression: true, change: true, regressionKey: "hasNewBlocking" },
  "simulation.result.diff.v1": { regression: true, change: true, regressionKey: "hasNewBlocking" },
  "sniper.run.report.diff.v2": { regression: true, change: true, regressionKey: "hasNewOperatorBlocking", changeKey: "hasAnyChange" },
};

/** Read a boolean verdict flag the schema is KNOWN to carry. */
function readFlagState(record: Record<string, unknown>, key: string): VerdictState {
  const value = readBoolean(record, key);
  if (value === true) return "yes";
  if (value === false) return "no";
  // Absent or wrong type — honestly `missing`, never silently `no`.
  return "missing";
}

/**
 * Extract a conservative diff verdict for one artifact.
 *
 * Rules (defensive, no fake precision):
 *   - A recognized diff schema's real `hasRegression` / `hasChange` boolean is
 *     reflected (`true` → "yes", `false` → "no").
 *   - A recognized schema that carries a verdict field but is missing it (absent
 *     or not a boolean) → "missing" (never "no").
 *   - A recognized NON-diff schema → "not-applicable" (it has no such concept).
 *   - An unrecognized / absent schema → "not-applicable", with a note; verdict
 *     fields are NOT read from unknown shapes, so no invented verdicts.
 */
export function extractVerdict(schemaVersion: string | null, raw: unknown): ArtifactVerdict {
  const notes: string[] = [];

  if (schemaVersion === null) {
    notes.push(
      "No schemaVersion present — regression/change verdicts are not interpreted for unlabelled artifacts.",
    );
    return { hasRegression: "not-applicable", hasChange: "not-applicable", notes };
  }

  const capability = VERDICT_CAPABILITIES[schemaVersion];
  if (capability === undefined) {
    if (isKnownSchema(schemaVersion)) {
      notes.push(
        `${schemaVersion} is a recognized non-diff artifact — it carries no regression/change verdict.`,
      );
    } else {
      notes.push(
        `Unrecognized schema "${schemaVersion}" — verdict fields are not interpreted, to avoid fake precision.`,
      );
    }
    return { hasRegression: "not-applicable", hasChange: "not-applicable", notes };
  }

  const record = asRecord(raw);
  if (record === null) {
    notes.push("Artifact declares a diff schema but is not a JSON object — verdict fields could not be read.");
    return {
      hasRegression: capability.regression ? "missing" : "not-applicable",
      hasChange: capability.change ? "missing" : "not-applicable",
      notes,
    };
  }

  const regressionKey = capability.regressionKey ?? "hasRegression";
  const changeKey = capability.changeKey ?? "hasChange";
  const hasRegression = capability.regression ? readFlagState(record, regressionKey) : "not-applicable";
  const hasChange = capability.change ? readFlagState(record, changeKey) : "not-applicable";
  if (capability.regression && regressionKey !== "hasRegression") {
    notes.push(`Regression verdict read from this schema's own \`${regressionKey}\` flag.`);
  }
  if (capability.change && changeKey !== "hasChange") {
    notes.push(`Change verdict read from this schema's own \`${changeKey}\` flag.`);
  }
  if (hasRegression === "missing") {
    notes.push(`Expected \`${regressionKey}\` boolean was absent or not a boolean — reported as missing, not false.`);
  }
  if (hasChange === "missing") {
    notes.push(`Expected \`${changeKey}\` boolean was absent or not a boolean — reported as missing, not false.`);
  }
  return { hasRegression, hasChange, notes };
}

/* ------------------------------------------------------------------ *
 * Folder index.
 * ------------------------------------------------------------------ */

/**
 * One directory entry, pre-classified by the Node-only caller. `json` entries
 * carry their file text (parsed here); `skipped` entries carry a reason (a
 * non-`.json` file, a subdirectory, or an unreadable file) and an honest count.
 */
export type FolderInputEntry =
  | { readonly name: string; readonly type: "json"; readonly text: string }
  | { readonly name: string; readonly type: "skipped"; readonly reason: string };

export interface BuildFolderIndexOptions {
  /**
   * Does the inspector ship a typed view for this schema? Injected (rather than
   * imported from the component layer) so this module stays dependency-free.
   */
  readonly hasTypedView: (schemaVersion: string | null) => boolean;
}

export interface FolderArtifactEntry {
  /** Basename only — never a full path. */
  readonly name: string;
  /** Stable, sanitized same-page anchor id for this artifact's section. */
  readonly anchor: string;
  readonly status: "valid" | "malformed";
  /** Parse error message for malformed entries; `null` otherwise. */
  readonly parseError: string | null;
  readonly schemaVersion: string | null;
  readonly schemaStatus: SchemaRecognition;
  /** Registry title for a recognized schema; `null` otherwise. */
  readonly schemaTitle: string | null;
  readonly kind: string;
  readonly hasTypedView: boolean;
  readonly verdict: ArtifactVerdict;
  /** Normalized view for rendering a per-artifact section; `null` for malformed. */
  readonly view: NormalizedArtifact | null;
  /** Raw parsed JSON for the typed view; `null` for malformed/unparsed entries. */
  readonly raw: unknown;
}

export interface FolderSkippedEntry {
  readonly name: string;
  readonly reason: string;
}

export interface FolderSchemaCount {
  /** A schemaVersion id, or the synthetic label "(no schemaVersion)". */
  readonly key: string;
  readonly status: SchemaRecognition;
  readonly count: number;
}

export interface FolderIndexCounts {
  /** Total directory entries considered (json + skipped). */
  readonly filesScanned: number;
  /** `.json` files attempted (valid + malformed). */
  readonly jsonFiles: number;
  readonly validArtifacts: number;
  readonly malformedFiles: number;
  /** Non-`.json` files, subdirectories, and unreadable files. */
  readonly skippedFiles: number;
  /** Valid artifacts whose schema id is present but unrecognized. */
  readonly unknownSchemas: number;
  /** Valid artifacts with no usable `schemaVersion` field. */
  readonly absentSchemas: number;
  /** Valid artifacts whose verdict reports `hasRegression: "yes"`. */
  readonly withRegression: number;
  /** Valid artifacts whose verdict reports `hasChange: "yes"`. */
  readonly withChange: number;
}

export interface FolderIndex {
  readonly counts: FolderIndexCounts;
  /** Valid + malformed artifacts, sorted by filename. */
  readonly artifacts: readonly FolderArtifactEntry[];
  /** Skipped (non-json / subdir / unreadable) entries, sorted by filename. */
  readonly skipped: readonly FolderSkippedEntry[];
  /** Count of valid artifacts by schema id, sorted by count desc then key. */
  readonly schemaCounts: readonly FolderSchemaCount[];
  /** Index-level diagnostic notes (honest summary of edge cases). */
  readonly notes: readonly string[];
}

/** Deterministic by-name comparison (Unicode code units; locale-independent). */
function byName(a: { name: string }, b: { name: string }): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** Max characters of filename slug kept in an anchor id (the index prefix keeps it unique). */
const MAX_ANCHOR_SLUG = 48;

/** A sanitized, unique, same-page anchor id (index keeps it unique + ordered). */
function anchorFor(name: string, index: number): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ANCHOR_SLUG)
    // A slice can land on a separator; trim a trailing dash so the id stays tidy.
    .replace(/-+$/g, "");
  return `sm-artifact-${index}-${slug.length > 0 ? slug : "file"}`;
}

/**
 * Build a bounded, deterministic folder index from pre-read directory entries.
 * Pure and total: never throws, never touches the filesystem. The same entry
 * list always produces byte-identical output (entries are sorted by name first).
 */
export function buildFolderIndex(
  entries: readonly FolderInputEntry[],
  options: BuildFolderIndexOptions,
): FolderIndex {
  const sorted = [...entries].sort(byName);

  const artifacts: FolderArtifactEntry[] = [];
  const skipped: FolderSkippedEntry[] = [];
  let artifactIndex = 0;

  for (const entry of sorted) {
    if (entry.type === "skipped") {
      skipped.push({ name: entry.name, reason: entry.reason });
      continue;
    }

    const anchor = anchorFor(entry.name, artifactIndex);
    artifactIndex += 1;

    const parsed = parseArtifactJson(entry.text);
    if (!parsed.ok) {
      artifacts.push({
        name: entry.name,
        anchor,
        status: "malformed",
        parseError: parsed.error,
        schemaVersion: null,
        schemaStatus: "absent",
        schemaTitle: null,
        kind: "Malformed JSON",
        hasTypedView: false,
        verdict: {
          hasRegression: "not-applicable",
          hasChange: "not-applicable",
          notes: ["File is not valid JSON; nothing was interpreted."],
        },
        view: null,
        raw: null,
      });
      continue;
    }

    const view = normalizeArtifact(parsed.value);
    const info = view.schemaVersion ? (knownSchema(view.schemaVersion) ?? null) : null;
    artifacts.push({
      name: entry.name,
      anchor,
      status: "valid",
      parseError: null,
      schemaVersion: view.schemaVersion,
      schemaStatus: view.schemaStatus,
      schemaTitle: info?.title ?? null,
      kind: view.kind,
      hasTypedView: options.hasTypedView(view.schemaVersion),
      verdict: extractVerdict(view.schemaVersion, parsed.value),
      view,
      raw: parsed.value,
    });
  }

  const valid = artifacts.filter((a) => a.status === "valid");
  const malformed = artifacts.filter((a) => a.status === "malformed");

  const counts: FolderIndexCounts = {
    filesScanned: sorted.length,
    jsonFiles: sorted.filter((e) => e.type === "json").length,
    validArtifacts: valid.length,
    malformedFiles: malformed.length,
    skippedFiles: skipped.length,
    unknownSchemas: valid.filter((a) => a.schemaStatus === "unknown").length,
    absentSchemas: valid.filter((a) => a.schemaStatus === "absent").length,
    withRegression: valid.filter((a) => a.verdict.hasRegression === "yes").length,
    withChange: valid.filter((a) => a.verdict.hasChange === "yes").length,
  };

  // By-schema counts over VALID artifacts only (malformed are tracked separately).
  const groups = new Map<string, { status: SchemaRecognition; count: number }>();
  for (const a of valid) {
    const key = a.schemaVersion ?? "(no schemaVersion)";
    const existing = groups.get(key);
    if (existing) {
      groups.set(key, { status: existing.status, count: existing.count + 1 });
    } else {
      groups.set(key, { status: a.schemaStatus, count: 1 });
    }
  }
  const schemaCounts: FolderSchemaCount[] = [...groups.entries()]
    .map(([key, value]) => ({ key, status: value.status, count: value.count }))
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const notes: string[] = [];
  if (sorted.length === 0) {
    notes.push("The folder contained no entries to scan.");
  }
  if (counts.jsonFiles === 0 && counts.skippedFiles > 0) {
    notes.push("No .json files were found; every entry was skipped.");
  }
  if (counts.malformedFiles > 0) {
    notes.push(`${counts.malformedFiles} file(s) were not valid JSON and are listed as malformed (not interpreted).`);
  }
  if (counts.unknownSchemas > 0) {
    notes.push(`${counts.unknownSchemas} artifact(s) declared an unrecognized schema; their verdicts are not interpreted.`);
  }
  if (counts.absentSchemas > 0) {
    notes.push(`${counts.absentSchemas} artifact(s) had no schemaVersion; they render as unlabelled JSON.`);
  }

  return { counts, artifacts, skipped, schemaCounts, notes };
}

/* ------------------------------------------------------------------ *
 * Static filter sections (pre-rendered, script-free groupings).
 * ------------------------------------------------------------------ */

export type FolderFilterCategory = "all" | "regression" | "changed" | "unknown" | "clean";

/** A confirmed regression: the artifact's OWN `hasRegression` flag is true. */
export function isRegressionArtifact(entry: FolderArtifactEntry): boolean {
  return entry.status === "valid" && entry.verdict.hasRegression === "yes";
}

/**
 * A confirmed change: the artifact's OWN `hasChange` flag is true. Independent of
 * regression — a changed artifact need not be a regression (and vice versa).
 */
export function isChangedArtifact(entry: FolderArtifactEntry): boolean {
  return entry.status === "valid" && entry.verdict.hasChange === "yes";
}

/**
 * Unknown schema, absent schema, or malformed JSON. These never carry a trusted
 * verdict (see {@link extractVerdict}), so a boolean-looking field inside an
 * unknown artifact can never push it into the regression or changed groups.
 */
export function isUnknownOrMalformedArtifact(entry: FolderArtifactEntry): boolean {
  return (
    entry.status === "malformed" ||
    entry.schemaStatus === "unknown" ||
    entry.schemaStatus === "absent"
  );
}

/**
 * Clean / no-change: a valid artifact with a RECOGNIZED schema for which neither
 * a regression nor a change was flagged. A recognized non-diff artifact (which
 * carries no verdict at all) is clean; a recognized diff whose own flags are
 * `no`/`missing` is clean. Unknown / absent / malformed artifacts are NEVER
 * clean — they belong to the unknown-or-malformed group instead.
 */
export function isCleanArtifact(entry: FolderArtifactEntry): boolean {
  return (
    !isUnknownOrMalformedArtifact(entry) &&
    !isRegressionArtifact(entry) &&
    !isChangedArtifact(entry)
  );
}

export interface FolderFilterSection {
  readonly category: FolderFilterCategory;
  readonly title: string;
  /** Deterministic, unique same-page anchor (distinct from per-artifact anchors). */
  readonly anchor: string;
  /** One-line description of the membership rule (rendered above the table). */
  readonly description: string;
  /** Matching artifacts, preserving the index's stable by-name order. */
  readonly artifacts: readonly FolderArtifactEntry[];
}

/** Fixed anchor ids for the filter sections. `all` reuses the existing list id. */
const FILTER_ANCHORS: Readonly<Record<FolderFilterCategory, string>> = {
  all: "sm-folder-artifacts",
  regression: "sm-filter-regression",
  changed: "sm-filter-changed",
  unknown: "sm-filter-unknown",
  clean: "sm-filter-clean",
};

/**
 * Group the (already name-sorted) artifacts into the five static filter sections
 * rendered on the loaded folder page. Pure and deterministic: membership is a
 * total function of each artifact's status / schema / verdict — no JavaScript, no
 * query params, no browser behaviour. An artifact may appear in BOTH `regression`
 * and `changed` when its own flags say so; `unknown` and `clean` are mutually
 * exclusive with each other and with regression/changed. Every artifact appears
 * in `all` and in exactly one of {a regression/changed pair, unknown, clean}.
 */
export function buildFolderFilterSections(index: FolderIndex): readonly FolderFilterSection[] {
  const all = index.artifacts;
  return [
    {
      category: "all",
      title: "All artifacts",
      anchor: FILTER_ANCHORS.all,
      description: "Every JSON file found in the folder, valid or malformed.",
      artifacts: all,
    },
    {
      category: "regression",
      title: "Regression artifacts",
      anchor: FILTER_ANCHORS.regression,
      description: "Recognized diff artifacts whose own hasRegression flag is true.",
      artifacts: all.filter(isRegressionArtifact),
    },
    {
      category: "changed",
      title: "Changed artifacts",
      anchor: FILTER_ANCHORS.changed,
      description:
        "Recognized diff artifacts whose own hasChange flag is true (a regression is not required).",
      artifacts: all.filter(isChangedArtifact),
    },
    {
      category: "unknown",
      title: "Unknown or malformed artifacts",
      anchor: FILTER_ANCHORS.unknown,
      description:
        "Unrecognized schemas, artifacts with no schemaVersion, and malformed JSON. No verdict is interpreted for these.",
      artifacts: all.filter(isUnknownOrMalformedArtifact),
    },
    {
      category: "clean",
      title: "Clean / no-change artifacts",
      anchor: FILTER_ANCHORS.clean,
      description: "Recognized artifacts with no regression or change flagged.",
      artifacts: all.filter(isCleanArtifact),
    },
  ];
}

export interface FolderFilterCounts {
  readonly all: number;
  readonly regression: number;
  readonly changed: number;
  readonly unknown: number;
  readonly clean: number;
}

/** Per-category counts for the filter sections (mirrors {@link buildFolderFilterSections}). */
export function toFolderFilterCounts(index: FolderIndex): FolderFilterCounts {
  const sections = buildFolderFilterSections(index);
  const count = (category: FolderFilterCategory): number =>
    sections.find((section) => section.category === category)?.artifacts.length ?? 0;
  return {
    all: count("all"),
    regression: count("regression"),
    changed: count("changed"),
    unknown: count("unknown"),
    clean: count("clean"),
  };
}

/* ------------------------------------------------------------------ *
 * Machine-readable summary (for the `--json` CLI flag).
 * ------------------------------------------------------------------ */

export interface FolderArtifactSummaryJson {
  readonly name: string;
  readonly status: "valid" | "malformed";
  readonly schemaVersion: string | null;
  readonly schemaStatus: SchemaRecognition;
  readonly kind: string;
  readonly hasTypedView: boolean;
  readonly hasRegression: VerdictState;
  readonly hasChange: VerdictState;
}

export interface FolderIndexSummaryJson {
  readonly counts: FolderIndexCounts;
  /** Per-category counts for the static filter sections. */
  readonly filters: FolderFilterCounts;
  readonly schemaCounts: readonly FolderSchemaCount[];
  readonly artifacts: readonly FolderArtifactSummaryJson[];
  readonly skipped: readonly FolderSkippedEntry[];
  readonly notes: readonly string[];
}

/** Derive a compact, serializable summary — safe to print and to diff. */
export function toFolderSummaryJson(index: FolderIndex): FolderIndexSummaryJson {
  return {
    counts: index.counts,
    filters: toFolderFilterCounts(index),
    schemaCounts: index.schemaCounts,
    artifacts: index.artifacts.map((a) => ({
      name: a.name,
      status: a.status,
      schemaVersion: a.schemaVersion,
      schemaStatus: a.schemaStatus,
      kind: a.kind,
      hasTypedView: a.hasTypedView,
      hasRegression: a.verdict.hasRegression,
      hasChange: a.verdict.hasChange,
    })),
    skipped: index.skipped,
    notes: index.notes,
  };
}
