/**
 * Deterministic, offline, **simulated-only** RESEARCH ARTIFACT PACK / LOCAL REPORT PACK (Sprint 23).
 *
 * The research stack now has a full symmetry of layers — manifest, bundle, status, campaign index,
 * campaign diff, campaign history, portfolio report, portfolio diff. Each is its own JSON artifact.
 * A real research run produces several of them, and a human (or CI, or the future UI inspector) has
 * to open many files to understand the overall state. The artifact pack is the NAVIGATION + INTEGRITY
 * SUMMARY layer: it collects an already-loaded set of those local artifacts, validates each against
 * its REAL schema/validator, extracts the high-level flags each artifact ALREADY carries (never
 * re-deriving or inventing), and rolls them into one navigable report answering at a glance:
 *
 *   - Which artifacts are present, what kind/schema is each, and is each recognized + valid?
 *   - What high-level status + change/regression/attention flags does each carry?
 *   - How many artifacts changed / regressed / need attention / recovered across the pack?
 *   - Which research-chain layers are present, and which recommended layers are missing?
 *   - Is the pack minimal / campaign-level / portfolio-level / diff-ready?
 *   - Should CI fail on change / regression / attention / new attention / an unsupported artifact?
 *
 * It is **pure** and does NO filesystem/network IO of its own: like every sibling builder it accepts
 * ALREADY-PARSED values (the CLI reads each artifact JSON and hands the parsed value here). Each
 * artifact is classified by its top-level `schemaVersion` and STRICTLY validated via that schema's
 * real validator, so a corrupt artifact that CLAIMS a known schema is REFUSED, never silently
 * mis-read. An artifact whose `schemaVersion` is a well-formed but UNKNOWN string is reported as an
 * `unsupported` entry (recognized=false) rather than refused, so a pack can survey whatever it is
 * pointed at; the `--fail-on-unsupported` gate covers that case. Every per-artifact flag is read
 * VERBATIM from the validated artifact (a couple are derived from a literal first-class list — e.g.
 * a campaign index's `runsNeedingAttention` — and that derivation is documented), so the pack can
 * never disagree with the artifacts it summarizes. The pack carries NO wall-clock timestamp, so an
 * identical set of artifacts yields a byte-identical pack regardless of supply order.
 *
 * This is bookkeeping over injected, simulated local summaries — NOT a live result, NOT real market
 * data, NOT advice, and NOT a profitability claim. Nothing here holds a key, or builds/signs/
 * simulates/sends a transaction. The conservative change/regression/attention flags are integrity/
 * reproducibility signals only, never a trading recommendation. It does not follow file paths, read
 * nested files, or make any network call.
 */

import { redactString } from "@soulmaker/security";
import {
  BACKTEST_RESEARCH_MANIFEST_SCHEMA_VERSION,
  validateBacktestResearchManifest,
} from "./research-manifest.js";
import {
  BACKTEST_RESEARCH_MANIFEST_DIFF_SCHEMA_VERSION,
  validateBacktestResearchManifestDiff,
} from "./research-manifest-diff.js";
import {
  BACKTEST_RESEARCH_BUNDLE_SCHEMA_VERSION,
  validateBacktestResearchBundle,
} from "./research-bundle.js";
import {
  BACKTEST_RESEARCH_BUNDLE_DIFF_SCHEMA_VERSION,
  validateBacktestResearchBundleDiff,
} from "./research-bundle-diff.js";
import {
  BACKTEST_RESEARCH_STATUS_SCHEMA_VERSION,
  validateBacktestResearchStatus,
} from "./research-status.js";
import {
  BACKTEST_RESEARCH_CAMPAIGN_INDEX_SCHEMA_VERSION,
  validateBacktestResearchCampaignIndex,
} from "./research-campaign-index.js";
import {
  BACKTEST_RESEARCH_CAMPAIGN_DIFF_SCHEMA_VERSION,
  validateBacktestResearchCampaignIndexDiff,
} from "./research-campaign-index-diff.js";
import {
  BACKTEST_RESEARCH_CAMPAIGN_HISTORY_REPORT_SCHEMA_VERSION,
  validateBacktestResearchCampaignHistoryReport,
} from "./research-campaign-history.js";
import {
  BACKTEST_RESEARCH_PORTFOLIO_REPORT_SCHEMA_VERSION,
  validateBacktestResearchPortfolioReport,
} from "./research-portfolio.js";
import {
  BACKTEST_RESEARCH_PORTFOLIO_DIFF_SCHEMA_VERSION,
  validateBacktestResearchPortfolioDiff,
} from "./research-portfolio-diff.js";

/** Stable schema identifier for the artifact pack. Bump only on a breaking change. */
export const BACKTEST_RESEARCH_ARTIFACT_PACK_SCHEMA_VERSION = "backtest.research.artifact.pack.v1";

/** The banner that prefixes every artifact pack (required label). */
export const BACKTEST_RESEARCH_ARTIFACT_PACK_BANNER =
  "SIMULATED PAPER-ONLY RESEARCH ARTIFACT PACK";

/** Required disclaimer statements carried by every artifact pack (stable order). */
export const BACKTEST_RESEARCH_ARTIFACT_PACK_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY RESEARCH ARTIFACT PACK — a deterministic integrity + navigation summary across LOCAL research artifacts.",
  "Collects an already-loaded set of local research artifacts only — it embeds no artifact CONTENTS beyond their own high-level flags, is not live data, and fetched nothing.",
  "Each artifact is strictly validated against its real schema; a corrupt known artifact is refused, and an unknown schema is reported as unsupported (never silently treated as valid).",
  "Per-artifact change/regression/attention/recovery flags are read VERBATIM from each artifact (the conservative regression flag is integrity-only and is NOT financial advice).",
  "Chain-coverage tiers (minimal / campaign-level / portfolio-level / diff-ready) describe which layers are PRESENT — they are not a completeness or correctness guarantee.",
  "Reproducibility digests behind these artifacts are non-cryptographic content fingerprints, NOT a security or anti-tamper guarantee.",
  "It does not follow file paths, read nested files, or make any network call.",
  "Not a live result.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this report.",
];

/** Thrown only when pack INPUT or a produced pack is structurally invalid (NOT for an unknown schema). */
export class BacktestResearchArtifactPackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestResearchArtifactPackError";
  }
}

// --- input -------------------------------------------------------------------

/** One already-loaded research artifact plus its stable label. */
export interface BacktestResearchArtifactPackInput {
  /** Stable, unique label for this artifact (e.g. "portfolio"). Required, non-empty. */
  label: string;
  /** An already-parsed value expected to be a known research artifact (classified by schemaVersion). */
  value: unknown;
  /** Optional source path / label echoed into the pack (e.g. the file it was read from). */
  sourceLabel?: string;
}

/** Everything {@link buildBacktestResearchArtifactPack} needs (the artifact inputs). */
export interface BuildBacktestResearchArtifactPackInput {
  /** Optional pack label. */
  packName?: string;
  /** The artifacts to summarize. At least one; labels must be unique. */
  artifacts: BacktestResearchArtifactPackInput[];
}

// --- pack model --------------------------------------------------------------

/** The seven high-level flags a research artifact may carry; null = not applicable to that kind. */
export interface BacktestResearchArtifactPackFlags {
  hasChange: boolean | null;
  hasRegression: boolean | null;
  hasAttention: boolean | null;
  hasNewAttention: boolean | null;
  hasNewAttentionSinceBaseline: boolean | null;
  hasRecovery: boolean | null;
  hasCampaignSetChange: boolean | null;
}

/** One artifact's deterministic inventory entry. */
export interface BacktestResearchArtifactPackEntry {
  label: string;
  /** The source path/label supplied for this artifact, or null. */
  sourceLabel: string | null;
  /** The raw `schemaVersion` string read off the artifact. */
  schemaVersion: string;
  /** A friendly kind label ("portfolio-diff", …) or "unsupported" for an unknown schema. */
  kind: string;
  /** True iff the schema is known AND the artifact validated against it. */
  recognized: boolean;
  /** A single short status label derived from the artifact's own flags/health. */
  status: string;
  /** The high-level flags carried by this artifact (null where a flag is not applicable). */
  flags: BacktestResearchArtifactPackFlags;
  /** Concise, deterministic reasons carried verbatim from the artifact (capped). */
  reasons: string[];
}

/** One compact navigation row (a table-of-contents entry into the inventory). */
export interface BacktestResearchArtifactPackNavEntry {
  label: string;
  sourceLabel: string | null;
  kind: string;
  recognized: boolean;
  status: string;
}

/**
 * The full, deterministic, byte-stable research artifact pack. JSON-serializable as-is. Carries the
 * required PAPER-ONLY / local-artifacts-only / not-a-live-result / not-advice language so it survives
 * serialization.
 */
export interface BacktestResearchArtifactPack {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  packName: string | null;
  // --- input summary ---
  artifactCount: number;
  /** Every artifact label, sorted ascending. */
  artifactLabels: string[];
  // --- inventory (sorted by label) ---
  artifacts: BacktestResearchArtifactPackEntry[];
  // --- aggregate summary ---
  recognizedCount: number;
  unsupportedCount: number;
  artifactsWithChange: number;
  artifactsWithRegression: number;
  artifactsWithAttention: number;
  artifactsWithNewAttention: number;
  artifactsWithRecovery: number;
  /** Recognized artifacts carrying no integrity concern (no regression/attention/new-attention). */
  cleanArtifactCount: number;
  /** Recognized kinds present, sorted ascending. */
  presentKinds: string[];
  // --- chain coverage (which layers are present; NOT a completeness guarantee) ---
  recommendedLayers: string[];
  presentRecommendedLayers: string[];
  missingRecommendedLayers: string[];
  isMinimal: boolean;
  isCampaignLevel: boolean;
  isPortfolioLevel: boolean;
  isDiffReady: boolean;
  // --- conservative flags (OR across the inventory; a null per-artifact flag never trips them) ---
  hasChange: boolean;
  hasRegression: boolean;
  hasAttention: boolean;
  hasNewAttention: boolean;
  hasRecovery: boolean;
  hasUnsupportedArtifact: boolean;
  hasMissingRecommendedLayer: boolean;
  // --- CI decision section ---
  wouldFailOnChange: boolean;
  wouldFailOnRegression: boolean;
  wouldFailOnAttention: boolean;
  wouldFailOnNewAttention: boolean;
  wouldFailOnUnsupported: boolean;
  ciFailReasons: string[];
  // --- navigation (a compact table of contents into the inventory) ---
  navigation: BacktestResearchArtifactPackNavEntry[];
  // --- reproducibility-only / bookkeeping ---
  warnings: string[];
  notes: string[];
}

// --- pure helpers ------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Read a top-level boolean field as true|false|null (null when absent / not a boolean). */
function boolOf(obj: Record<string, unknown>, name: string): boolean | null {
  const v = obj[name];
  return v === true ? true : v === false ? false : null;
}

/** Read the length of a top-level array field (0 when absent / not an array). */
function arrLen(obj: Record<string, unknown>, name: string): number {
  const v = obj[name];
  return Array.isArray(v) ? v.length : 0;
}

/** Read a top-level non-negative-ish number field (0 when absent / not a number). */
function numOf(obj: Record<string, unknown>, name: string): number {
  const v = obj[name];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Read a top-level string[] field (filters non-strings; [] when absent). */
function strArr(obj: Record<string, unknown>, name: string): string[] {
  const v = obj[name];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** All flags not-applicable (the default for inventory/health artifacts). */
function noFlags(): BacktestResearchArtifactPackFlags {
  return {
    hasChange: null,
    hasRegression: null,
    hasAttention: null,
    hasNewAttention: null,
    hasNewAttentionSinceBaseline: null,
    hasRecovery: null,
    hasCampaignSetChange: null,
  };
}

/** Cap on reasons carried per artifact entry (concise; the artifact JSON holds the full list). */
const MAX_ENTRY_REASONS = 6;

function capReasons(reasons: string[]): string[] {
  if (reasons.length <= MAX_ENTRY_REASONS) return [...reasons];
  return [...reasons.slice(0, MAX_ENTRY_REASONS), `…and ${reasons.length - MAX_ENTRY_REASONS} more (see the artifact JSON)`];
}

/** Severity ladder shared by the report/diff kinds: regression > attention > changed > {noConcern}. */
function statusLadder(flags: BacktestResearchArtifactPackFlags, noConcernLabel: string): string {
  if (flags.hasRegression === true) return "regression";
  if (flags.hasAttention === true || flags.hasNewAttention === true || flags.hasNewAttentionSinceBaseline === true) {
    return "attention";
  }
  if (flags.hasChange === true || flags.hasCampaignSetChange === true) return "changed";
  return noConcernLabel;
}

// --- per-kind summarizers (read ONLY real, verified fields) ------------------

interface ArtifactSummary {
  status: string;
  flags: BacktestResearchArtifactPackFlags;
  reasons: string[];
}

function summarizeManifest(): ArtifactSummary {
  return { status: "inventory", flags: noFlags(), reasons: [] };
}

function summarizeBundle(obj: Record<string, unknown>): ArtifactSummary {
  const malformed = numOf(obj, "malformedArtifactCount");
  const unknown = numOf(obj, "unknownArtifactCount");
  const reasons: string[] = [];
  if (malformed > 0) reasons.push(`${malformed} malformed artifact(s)`);
  if (unknown > 0) reasons.push(`${unknown} unknown artifact(s)`);
  const status = malformed > 0 ? "malformed" : unknown > 0 ? "unknown-artifacts" : "ok";
  return { status, flags: noFlags(), reasons };
}

function summarizeStatus(obj: Record<string, unknown>): ArtifactSummary {
  const healthy =
    boolOf(obj, "complete") === true &&
    boolOf(obj, "recognized") === true &&
    boolOf(obj, "stable") === true &&
    boolOf(obj, "bundleCandidateValid") === true;
  const action = obj["recommendedAction"];
  const reasons = nonEmptyString(action) ? [action] : [];
  return { status: healthy ? "ok" : "attention", flags: noFlags(), reasons };
}

function summarizeCampaignIndex(obj: Record<string, unknown>): ArtifactSummary {
  // attention is a FIRST-CLASS concept here: the campaign index carries `runsNeedingAttention`
  // (invalid runs) verbatim — we surface it as hasAttention rather than inventing a new signal.
  const invalid = numOf(obj, "invalidRunCount");
  const needsAttention = arrLen(obj, "runsNeedingAttention") > 0 || invalid > 0;
  const flags = { ...noFlags(), hasAttention: needsAttention };
  const reasons = needsAttention ? [`${invalid} run(s) need attention`] : [];
  return { status: needsAttention ? "attention" : "ok", flags, reasons };
}

function summarizeManifestDiff(obj: Record<string, unknown>): ArtifactSummary {
  const flags = { ...noFlags(), hasChange: boolOf(obj, "hasChange") };
  return { status: statusLadder(flags, "unchanged"), flags, reasons: capReasons(strArr(obj, "changeReasons")) };
}

function summarizeBundleDiff(obj: Record<string, unknown>): ArtifactSummary {
  const flags = { ...noFlags(), hasChange: boolOf(obj, "hasChange"), hasRegression: boolOf(obj, "hasRegression") };
  const reasons = flags.hasRegression === true ? strArr(obj, "regressionReasons") : strArr(obj, "changeReasons");
  return { status: statusLadder(flags, "unchanged"), flags, reasons: capReasons(reasons) };
}

function summarizeCampaignDiff(obj: Record<string, unknown>): ArtifactSummary {
  // `newlyNeedsAttention` is the campaign diff's literal "newly needs attention" transition list.
  const flags = {
    ...noFlags(),
    hasChange: boolOf(obj, "hasChange"),
    hasRegression: boolOf(obj, "hasRegression"),
    hasNewAttention: arrLen(obj, "newlyNeedsAttention") > 0,
  };
  const reasons = flags.hasRegression === true ? strArr(obj, "regressionReasons") : strArr(obj, "changeReasons");
  return { status: statusLadder(flags, "unchanged"), flags, reasons: capReasons(reasons) };
}

function summarizeCampaignHistory(obj: Record<string, unknown>): ArtifactSummary {
  const flags = {
    ...noFlags(),
    hasChange: boolOf(obj, "hasChange"),
    hasRegression: boolOf(obj, "hasRegression"),
    hasAttention: boolOf(obj, "hasAttention"),
    hasNewAttentionSinceBaseline: boolOf(obj, "hasNewAttentionSinceBaseline"),
  };
  const reasons = flags.hasRegression === true ? strArr(obj, "regressionReasons") : strArr(obj, "changeReasons");
  return { status: statusLadder(flags, "clean"), flags, reasons: capReasons(reasons) };
}

function summarizePortfolioReport(obj: Record<string, unknown>): ArtifactSummary {
  const flags = {
    ...noFlags(),
    hasChange: boolOf(obj, "hasChange"),
    hasRegression: boolOf(obj, "hasRegression"),
    hasAttention: boolOf(obj, "hasAttention"),
    hasNewAttentionSinceBaseline: boolOf(obj, "hasNewAttentionSinceBaseline"),
  };
  return { status: statusLadder(flags, "clean"), flags, reasons: capReasons(strArr(obj, "ciFailReasons")) };
}

function summarizePortfolioDiff(obj: Record<string, unknown>): ArtifactSummary {
  const flags = {
    hasChange: boolOf(obj, "hasChange"),
    hasRegression: boolOf(obj, "hasRegression"),
    hasAttention: boolOf(obj, "hasAttention"),
    hasNewAttention: boolOf(obj, "hasNewAttention"),
    hasNewAttentionSinceBaseline: null,
    hasRecovery: boolOf(obj, "hasRecovery"),
    hasCampaignSetChange: boolOf(obj, "hasCampaignSetChange"),
  };
  const reasons = strArr(obj, "ciFailReasons");
  return { status: statusLadder(flags, "unchanged"), flags, reasons: capReasons(reasons) };
}

// --- the supported-artifact registry (REAL schemas + validators only) --------

interface KindSpec {
  kind: string;
  validate: (value: unknown) => unknown;
  summarize: (obj: Record<string, unknown>) => ArtifactSummary;
  /** Which chain-coverage family this kind belongs to (for tiers). */
  isCampaign?: boolean;
  isPortfolio?: boolean;
  isDiff?: boolean;
}

const REGISTRY: ReadonlyMap<string, KindSpec> = new Map<string, KindSpec>([
  [BACKTEST_RESEARCH_MANIFEST_SCHEMA_VERSION, { kind: "manifest", validate: validateBacktestResearchManifest, summarize: summarizeManifest }],
  [BACKTEST_RESEARCH_MANIFEST_DIFF_SCHEMA_VERSION, { kind: "manifest-diff", validate: validateBacktestResearchManifestDiff, summarize: summarizeManifestDiff, isDiff: true }],
  [BACKTEST_RESEARCH_BUNDLE_SCHEMA_VERSION, { kind: "bundle", validate: validateBacktestResearchBundle, summarize: summarizeBundle }],
  [BACKTEST_RESEARCH_BUNDLE_DIFF_SCHEMA_VERSION, { kind: "bundle-diff", validate: validateBacktestResearchBundleDiff, summarize: summarizeBundleDiff, isDiff: true }],
  [BACKTEST_RESEARCH_STATUS_SCHEMA_VERSION, { kind: "status", validate: validateBacktestResearchStatus, summarize: summarizeStatus }],
  [BACKTEST_RESEARCH_CAMPAIGN_INDEX_SCHEMA_VERSION, { kind: "campaign-index", validate: validateBacktestResearchCampaignIndex, summarize: summarizeCampaignIndex, isCampaign: true }],
  [BACKTEST_RESEARCH_CAMPAIGN_DIFF_SCHEMA_VERSION, { kind: "campaign-diff", validate: validateBacktestResearchCampaignIndexDiff, summarize: summarizeCampaignDiff, isDiff: true }],
  [BACKTEST_RESEARCH_CAMPAIGN_HISTORY_REPORT_SCHEMA_VERSION, { kind: "campaign-history", validate: validateBacktestResearchCampaignHistoryReport, summarize: summarizeCampaignHistory, isCampaign: true }],
  [BACKTEST_RESEARCH_PORTFOLIO_REPORT_SCHEMA_VERSION, { kind: "portfolio-report", validate: validateBacktestResearchPortfolioReport, summarize: summarizePortfolioReport, isPortfolio: true }],
  [BACKTEST_RESEARCH_PORTFOLIO_DIFF_SCHEMA_VERSION, { kind: "portfolio-diff", validate: validateBacktestResearchPortfolioDiff, summarize: summarizePortfolioDiff, isDiff: true }],
]);

/**
 * The recommended research-chain layers a useful portfolio-level pack contains. Missing any of these
 * sets `hasMissingRecommendedLayer` (a soft CI signal) — it is a recommendation, NOT a claim that a
 * pack with all four is "complete" or correct.
 */
export const BACKTEST_RESEARCH_ARTIFACT_PACK_RECOMMENDED_LAYERS: readonly string[] = [
  "campaign-index",
  "campaign-history",
  "portfolio-report",
  "portfolio-diff",
];

// --- builder -----------------------------------------------------------------

interface ReadArtifact {
  label: string;
  sourceLabel: string | null;
  entry: BacktestResearchArtifactPackEntry;
  spec: KindSpec | null;
}

/** Strictly read + classify one artifact input into an inventory entry. */
function readArtifact(input: unknown, position: number, seenLabels: Set<string>): ReadArtifact {
  if (!isObject(input)) {
    throw new BacktestResearchArtifactPackError(`artifacts[${position}] must be an object`);
  }
  if (!nonEmptyString(input.label)) {
    throw new BacktestResearchArtifactPackError(`artifacts[${position}].label must be a non-empty string`);
  }
  const label = input.label;
  if (seenLabels.has(label)) {
    throw new BacktestResearchArtifactPackError(`duplicate artifact label "${label}"`);
  }
  seenLabels.add(label);

  if (input.sourceLabel !== undefined && !nonEmptyString(input.sourceLabel)) {
    throw new BacktestResearchArtifactPackError(
      `artifacts[${position}] (${label}).sourceLabel must be a non-empty string when present`,
    );
  }
  const sourceLabel = nonEmptyString(input.sourceLabel) ? input.sourceLabel : null;

  const value = input.value;
  if (!isObject(value)) {
    throw new BacktestResearchArtifactPackError(`artifacts[${position}] (${label}).value must be a JSON object`);
  }
  if (!nonEmptyString(value.schemaVersion)) {
    throw new BacktestResearchArtifactPackError(
      `artifacts[${position}] (${label}) has no schemaVersion string (not a recognizable research artifact)`,
    );
  }
  const schemaVersion = value.schemaVersion;
  const spec = REGISTRY.get(schemaVersion) ?? null;

  if (!spec) {
    // A well-formed but UNKNOWN schema: reported, never refused (gated by --fail-on-unsupported).
    const entry: BacktestResearchArtifactPackEntry = {
      label,
      sourceLabel,
      schemaVersion,
      kind: "unsupported",
      recognized: false,
      status: "unsupported",
      flags: noFlags(),
      reasons: [`unsupported schemaVersion "${schemaVersion}"`],
    };
    return { label, sourceLabel, entry, spec: null };
  }

  // A KNOWN schema: strictly validate. A corrupt artifact claiming this schema is REFUSED.
  let validated: Record<string, unknown>;
  try {
    validated = spec.validate(value) as Record<string, unknown>;
  } catch (err) {
    throw new BacktestResearchArtifactPackError(
      `artifacts[${position}] (${label}) claims schema "${schemaVersion}" but is invalid: ${(err as Error).message}`,
    );
  }
  const summary = spec.summarize(validated);
  const entry: BacktestResearchArtifactPackEntry = {
    label,
    sourceLabel,
    schemaVersion,
    kind: spec.kind,
    recognized: true,
    status: summary.status,
    flags: summary.flags,
    reasons: summary.reasons,
  };
  return { label, sourceLabel, entry, spec };
}

/**
 * Build a deterministic, byte-stable {@link BacktestResearchArtifactPack} from a set of already-loaded
 * research artifacts. Pure and non-mutating. Each artifact is classified by `schemaVersion`: a known
 * schema is strictly validated (a corrupt artifact throws {@link BacktestResearchArtifactPackError});
 * an unknown schema is reported as an `unsupported` entry. Every per-artifact flag is read verbatim
 * from the validated artifact. The inventory + every list is sorted by label/kind, so the output is
 * independent of the order the artifacts were supplied in. Throws on structurally invalid input, an
 * empty artifact list, a duplicate label, an artifact without a `schemaVersion`, or a corrupt
 * known-schema artifact.
 */
export function buildBacktestResearchArtifactPack(
  input: BuildBacktestResearchArtifactPackInput,
): BacktestResearchArtifactPack {
  if (!isObject(input)) {
    throw new BacktestResearchArtifactPackError("artifact pack input must be an object");
  }
  if (input.packName !== undefined && typeof input.packName !== "string") {
    throw new BacktestResearchArtifactPackError("artifact pack input.packName must be a string when present");
  }
  if (!Array.isArray(input.artifacts)) {
    throw new BacktestResearchArtifactPackError("artifact pack input.artifacts must be an array");
  }
  if (input.artifacts.length === 0) {
    throw new BacktestResearchArtifactPackError("artifact pack input.artifacts must contain at least one artifact");
  }

  const seenLabels = new Set<string>();
  const read = input.artifacts.map((a, i) => readArtifact(a, i, seenLabels));

  // Inventory sorted by label (deterministic, supply-order-independent).
  const sorted = [...read].sort((a, b) => compareString(a.label, b.label));
  const artifacts = sorted.map((r) => r.entry);
  const artifactLabels = sorted.map((r) => r.label);

  const recognized = sorted.filter((r) => r.entry.recognized);
  const recognizedCount = recognized.length;
  const unsupportedCount = artifacts.length - recognizedCount;

  // Aggregate flag counts (only a literal `true` counts; a `null` flag never does).
  const countTrue = (pick: (f: BacktestResearchArtifactPackFlags) => boolean | null): number =>
    artifacts.filter((e) => pick(e.flags) === true).length;
  const artifactsWithChange = countTrue((f) => f.hasChange);
  const artifactsWithRegression = countTrue((f) => f.hasRegression);
  const artifactsWithAttention = countTrue((f) => f.hasAttention);
  const artifactsWithNewAttention = artifacts.filter(
    (e) => e.flags.hasNewAttention === true || e.flags.hasNewAttentionSinceBaseline === true,
  ).length;
  const artifactsWithRecovery = countTrue((f) => f.hasRecovery);
  // "clean" = recognized AND no integrity concern flag is true (a benign change alone stays clean).
  const cleanArtifactCount = recognized.filter(
    (r) =>
      r.entry.flags.hasRegression !== true &&
      r.entry.flags.hasAttention !== true &&
      r.entry.flags.hasNewAttention !== true &&
      r.entry.flags.hasNewAttentionSinceBaseline !== true,
  ).length;

  const presentKinds = [...new Set(recognized.map((r) => r.entry.kind))].sort(compareString);

  // Chain coverage (presence only — never a completeness claim).
  const presentRecommendedLayers = BACKTEST_RESEARCH_ARTIFACT_PACK_RECOMMENDED_LAYERS.filter((layer) =>
    presentKinds.includes(layer),
  );
  const missingRecommendedLayers = BACKTEST_RESEARCH_ARTIFACT_PACK_RECOMMENDED_LAYERS.filter(
    (layer) => !presentKinds.includes(layer),
  );
  const isMinimal = recognizedCount >= 1;
  const isCampaignLevel = recognized.some((r) => r.spec?.isCampaign === true);
  const isPortfolioLevel = recognized.some((r) => r.spec?.isPortfolio === true);
  const isDiffReady = recognized.some((r) => r.spec?.isDiff === true);

  // Conservative pack flags (OR across the inventory; a null per-artifact flag never trips them).
  const hasChange = artifactsWithChange > 0;
  const hasRegression = artifactsWithRegression > 0;
  const hasAttention = artifactsWithAttention > 0;
  const hasNewAttention = artifactsWithNewAttention > 0;
  const hasRecovery = artifactsWithRecovery > 0;
  const hasUnsupportedArtifact = unsupportedCount > 0;
  const hasMissingRecommendedLayer = missingRecommendedLayers.length > 0;

  // CI decision (gates mirror the flags; reasons explain each that holds, severity order).
  const ciFailReasons: string[] = [];
  if (hasRegression) {
    ciFailReasons.push(`${artifactsWithRegression} artifact(s) report a conservative regression`);
  }
  if (hasNewAttention) {
    ciFailReasons.push(`${artifactsWithNewAttention} artifact(s) report newly-needed attention`);
  }
  if (hasAttention) {
    ciFailReasons.push(`${artifactsWithAttention} artifact(s) report current attention`);
  }
  if (hasChange) {
    ciFailReasons.push(`${artifactsWithChange} artifact(s) report a change`);
  }
  if (hasUnsupportedArtifact) {
    ciFailReasons.push(`${unsupportedCount} unsupported artifact(s): ${artifacts.filter((e) => !e.recognized).map((e) => e.label).join(", ")}`);
  }

  // Navigation: a compact table of contents into the inventory, sorted by label.
  const navigation: BacktestResearchArtifactPackNavEntry[] = artifacts.map((e) => ({
    label: e.label,
    sourceLabel: e.sourceLabel,
    kind: e.kind,
    recognized: e.recognized,
    status: e.status,
  }));

  const warnings: string[] = [];
  if (recognizedCount === 0) {
    warnings.push("no recognized research artifacts in the pack — every artifact had an unsupported schema.");
  }
  if (hasUnsupportedArtifact) {
    warnings.push(`${unsupportedCount} unsupported artifact(s) were reported but not summarized.`);
  }
  if (hasMissingRecommendedLayer) {
    warnings.push(`${missingRecommendedLayers.length} recommended layer(s) missing: ${missingRecommendedLayers.join(", ")}.`);
  }
  if (hasRegression) {
    warnings.push(`${artifactsWithRegression} artifact(s) report a conservative regression.`);
  }

  const notes = [
    `${artifacts.length} artifact(s): ${recognizedCount} recognized, ${unsupportedCount} unsupported.`,
    `coverage: ${isMinimal ? "minimal" : "(none)"}${isCampaignLevel ? ", campaign-level" : ""}${isPortfolioLevel ? ", portfolio-level" : ""}${isDiffReady ? ", diff-ready" : ""}.`,
    "Per-artifact change/attention/regression flags are read verbatim from each artifact; this pack summarizes local artifacts only and is not a live result, advice, or a profitability claim.",
  ];

  return {
    schemaVersion: BACKTEST_RESEARCH_ARTIFACT_PACK_SCHEMA_VERSION,
    banner: BACKTEST_RESEARCH_ARTIFACT_PACK_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...BACKTEST_RESEARCH_ARTIFACT_PACK_DISCLAIMERS],
    packName: input.packName ?? null,
    artifactCount: artifacts.length,
    artifactLabels,
    artifacts,
    recognizedCount,
    unsupportedCount,
    artifactsWithChange,
    artifactsWithRegression,
    artifactsWithAttention,
    artifactsWithNewAttention,
    artifactsWithRecovery,
    cleanArtifactCount,
    presentKinds,
    recommendedLayers: [...BACKTEST_RESEARCH_ARTIFACT_PACK_RECOMMENDED_LAYERS],
    presentRecommendedLayers,
    missingRecommendedLayers,
    isMinimal,
    isCampaignLevel,
    isPortfolioLevel,
    isDiffReady,
    hasChange,
    hasRegression,
    hasAttention,
    hasNewAttention,
    hasRecovery,
    hasUnsupportedArtifact,
    hasMissingRecommendedLayer,
    wouldFailOnChange: hasChange,
    wouldFailOnRegression: hasRegression,
    wouldFailOnAttention: hasAttention,
    wouldFailOnNewAttention: hasNewAttention,
    wouldFailOnUnsupported: hasUnsupportedArtifact,
    ciFailReasons,
    navigation,
    warnings,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

const PACK_FLAG_NAMES = [
  "hasChange",
  "hasRegression",
  "hasAttention",
  "hasNewAttention",
  "hasNewAttentionSinceBaseline",
  "hasRecovery",
  "hasCampaignSetChange",
] as const;

function validateFlags(value: unknown, where: string): void {
  if (!isObject(value)) throw new BacktestResearchArtifactPackError(`${where} must be an object`);
  for (const name of PACK_FLAG_NAMES) {
    const v = value[name];
    if (v !== true && v !== false && v !== null) {
      throw new BacktestResearchArtifactPackError(`${where}.${name} must be a boolean or null`);
    }
  }
}

function validateEntry(value: unknown, where: string): void {
  if (!isObject(value)) throw new BacktestResearchArtifactPackError(`${where} must be an object`);
  if (!nonEmptyString(value.label)) throw new BacktestResearchArtifactPackError(`${where}.label must be a non-empty string`);
  if (value.sourceLabel !== null && !nonEmptyString(value.sourceLabel)) {
    throw new BacktestResearchArtifactPackError(`${where}.sourceLabel must be a non-empty string or null`);
  }
  for (const f of ["schemaVersion", "kind", "status"] as const) {
    if (!nonEmptyString(value[f])) throw new BacktestResearchArtifactPackError(`${where}.${f} must be a non-empty string`);
  }
  if (typeof value.recognized !== "boolean") {
    throw new BacktestResearchArtifactPackError(`${where}.recognized must be a boolean`);
  }
  validateFlags(value.flags, `${where}.flags`);
  if (!Array.isArray(value.reasons) || (value.reasons as unknown[]).some((x) => typeof x !== "string")) {
    throw new BacktestResearchArtifactPackError(`${where}.reasons must be an array of strings`);
  }
  // Internal consistency: an unrecognized entry must have kind "unsupported" and all-null flags.
  if (value.recognized === false && value.kind !== "unsupported") {
    throw new BacktestResearchArtifactPackError(`${where}: an unrecognized entry must have kind "unsupported"`);
  }
}

/**
 * Strictly validate a value as a {@link BacktestResearchArtifactPack} and return it narrowed. A
 * backstop mirroring the other validators: checks the schema version + banner, the PAPER-ONLY
 * labelling, the disclaimers, the input summary, every inventory entry, the aggregate counts, the
 * chain-coverage tiers, the conservative flags, the CI mirror, and the navigation. Throws
 * {@link BacktestResearchArtifactPackError} on the first problem. Pure.
 */
export function validateBacktestResearchArtifactPack(value: unknown): BacktestResearchArtifactPack {
  if (!isObject(value)) throw new BacktestResearchArtifactPackError("artifact pack must be a JSON object");
  if (value.schemaVersion !== BACKTEST_RESEARCH_ARTIFACT_PACK_SCHEMA_VERSION) {
    throw new BacktestResearchArtifactPackError(
      `artifact pack.schemaVersion must be "${BACKTEST_RESEARCH_ARTIFACT_PACK_SCHEMA_VERSION}"`,
    );
  }
  if (value.banner !== BACKTEST_RESEARCH_ARTIFACT_PACK_BANNER) {
    throw new BacktestResearchArtifactPackError(`artifact pack.banner must be "${BACKTEST_RESEARCH_ARTIFACT_PACK_BANNER}"`);
  }
  for (const flag of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[flag] !== true) throw new BacktestResearchArtifactPackError(`artifact pack.${flag} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new BacktestResearchArtifactPackError("artifact pack.disclaimers must be a non-empty array");
  }
  if (value.packName !== null && typeof value.packName !== "string") {
    throw new BacktestResearchArtifactPackError("artifact pack.packName must be a string or null");
  }
  for (const f of [
    "artifactCount",
    "recognizedCount",
    "unsupportedCount",
    "artifactsWithChange",
    "artifactsWithRegression",
    "artifactsWithAttention",
    "artifactsWithNewAttention",
    "artifactsWithRecovery",
    "cleanArtifactCount",
  ] as const) {
    if (typeof value[f] !== "number" || !Number.isInteger(value[f]) || (value[f] as number) < 0) {
      throw new BacktestResearchArtifactPackError(`artifact pack.${f} must be a non-negative integer`);
    }
  }
  for (const flag of [
    "isMinimal",
    "isCampaignLevel",
    "isPortfolioLevel",
    "isDiffReady",
    "hasChange",
    "hasRegression",
    "hasAttention",
    "hasNewAttention",
    "hasRecovery",
    "hasUnsupportedArtifact",
    "hasMissingRecommendedLayer",
    "wouldFailOnChange",
    "wouldFailOnRegression",
    "wouldFailOnAttention",
    "wouldFailOnNewAttention",
    "wouldFailOnUnsupported",
  ] as const) {
    if (typeof value[flag] !== "boolean") throw new BacktestResearchArtifactPackError(`artifact pack.${flag} must be a boolean`);
  }
  // The CI gates mirror the conservative flags exactly.
  const ciMirror: [string, string][] = [
    ["wouldFailOnChange", "hasChange"],
    ["wouldFailOnRegression", "hasRegression"],
    ["wouldFailOnAttention", "hasAttention"],
    ["wouldFailOnNewAttention", "hasNewAttention"],
    ["wouldFailOnUnsupported", "hasUnsupportedArtifact"],
  ];
  for (const [gate, flag] of ciMirror) {
    if (value[gate] !== value[flag]) throw new BacktestResearchArtifactPackError(`artifact pack.${gate} must mirror ${flag}`);
  }
  for (const key of [
    "artifactLabels",
    "presentKinds",
    "recommendedLayers",
    "presentRecommendedLayers",
    "missingRecommendedLayers",
    "ciFailReasons",
    "warnings",
    "notes",
  ] as const) {
    if (!Array.isArray(value[key]) || (value[key] as unknown[]).some((x) => typeof x !== "string")) {
      throw new BacktestResearchArtifactPackError(`artifact pack.${key} must be an array of strings`);
    }
  }
  if (!Array.isArray(value.artifacts)) throw new BacktestResearchArtifactPackError("artifact pack.artifacts must be an array");
  if ((value.artifacts as unknown[]).length !== (value.artifactCount as number)) {
    throw new BacktestResearchArtifactPackError("artifact pack.artifacts length must equal artifactCount");
  }
  (value.artifacts as unknown[]).forEach((e, i) => validateEntry(e, `artifact pack.artifacts[${i}]`));
  if (!Array.isArray(value.navigation)) throw new BacktestResearchArtifactPackError("artifact pack.navigation must be an array");
  if ((value.navigation as unknown[]).length !== (value.artifactCount as number)) {
    throw new BacktestResearchArtifactPackError("artifact pack.navigation length must equal artifactCount");
  }
  (value.navigation as unknown[]).forEach((n, i) => {
    const where = `artifact pack.navigation[${i}]`;
    if (!isObject(n) || !nonEmptyString(n.label) || !nonEmptyString(n.kind) || !nonEmptyString(n.status)) {
      throw new BacktestResearchArtifactPackError(`${where} must be a {label,kind,status,…} nav entry`);
    }
    if (typeof n.recognized !== "boolean") throw new BacktestResearchArtifactPackError(`${where}.recognized must be a boolean`);
    if (n.sourceLabel !== null && !nonEmptyString(n.sourceLabel)) {
      throw new BacktestResearchArtifactPackError(`${where}.sourceLabel must be a non-empty string or null`);
    }
  });
  return value as unknown as BacktestResearchArtifactPack;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatBacktestResearchArtifactPack}. */
export interface FormatBacktestResearchArtifactPackOptions {
  /** Optional label echoed into the header. */
  label?: string;
  /** Cap on the number of inventory rows printed (default 100; the rest are summarized). */
  maxRows?: number;
}

/**
 * Render a redacted, stable, human-readable artifact pack. Deterministic and path-stable (no
 * timestamps). Leads with the PAPER-ONLY banner and the artifact count, lists each artifact's
 * inventory line (kind, recognized, status, flag tags), summarizes the aggregate counts + chain
 * coverage, and closes with the CI verdict and the not-live / not-advice disclaimers. Long lists are
 * summarized (never an unsafe raw dump); the whole output is passed through the shared redactor.
 */
export function formatBacktestResearchArtifactPack(
  pack: BacktestResearchArtifactPack,
  opts: FormatBacktestResearchArtifactPackOptions = {},
): string {
  const maxRows = opts.maxRows ?? 100;
  const title = pack.packName ?? "research artifact pack";
  const header = `${pack.banner} — ${title} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];

  if (opts.label) lines.push(`label:        ${opts.label}`);
  lines.push(`pack:         ${pack.packName ?? "(unnamed)"}`);
  lines.push(`artifacts:    ${pack.artifactCount} (${pack.recognizedCount} recognized, ${pack.unsupportedCount} unsupported)`);

  lines.push("");
  lines.push("Artifacts:");
  if (pack.artifacts.length === 0) {
    lines.push("- (none)");
  } else {
    for (const e of pack.artifacts.slice(0, maxRows)) {
      const tags: string[] = [];
      if (e.flags.hasRegression === true) tags.push("regression");
      if (e.flags.hasCampaignSetChange === true) tags.push("set-change");
      if (e.flags.hasAttention === true) tags.push("attention");
      if (e.flags.hasNewAttention === true || e.flags.hasNewAttentionSinceBaseline === true) tags.push("new-attention");
      if (e.flags.hasRecovery === true) tags.push("recovery");
      if (e.flags.hasChange === true) tags.push("changed");
      lines.push(
        `- ${e.label} [${e.kind}; ${e.recognized ? "recognized" : "UNSUPPORTED"}; ${e.status}]` +
          (tags.length > 0 ? `  (${tags.join(", ")})` : ""),
      );
      if (e.sourceLabel) lines.push(`    source: ${e.sourceLabel}`);
      for (const reason of e.reasons) lines.push(`    · ${reason}`);
    }
    const hidden = pack.artifacts.length - Math.min(pack.artifacts.length, maxRows);
    if (hidden > 0) lines.push(`- … and ${hidden} more (summarized; see the pack JSON for the full list)`);
  }

  lines.push("");
  lines.push("Aggregate:");
  lines.push(`- with change:      ${pack.artifactsWithChange}`);
  lines.push(`- with regression:  ${pack.artifactsWithRegression}`);
  lines.push(`- with attention:   ${pack.artifactsWithAttention}`);
  lines.push(`- with new attention:${pack.artifactsWithNewAttention}`);
  lines.push(`- with recovery:    ${pack.artifactsWithRecovery}`);
  lines.push(`- clean (no concern):${pack.cleanArtifactCount}`);

  lines.push("");
  lines.push("Chain coverage (present layers only — not a completeness guarantee):");
  lines.push(`- present kinds:    ${pack.presentKinds.length > 0 ? pack.presentKinds.join(", ") : "(none)"}`);
  lines.push(`- recommended:      ${pack.presentRecommendedLayers.length}/${pack.recommendedLayers.length} present`);
  if (pack.missingRecommendedLayers.length > 0) {
    lines.push(`- missing:          ${pack.missingRecommendedLayers.join(", ")}`);
  }
  const tiers = [
    pack.isMinimal ? "minimal" : null,
    pack.isCampaignLevel ? "campaign-level" : null,
    pack.isPortfolioLevel ? "portfolio-level" : null,
    pack.isDiffReady ? "diff-ready" : null,
  ].filter((x): x is string => x !== null);
  lines.push(`- tiers:            ${tiers.length > 0 ? tiers.join(", ") : "(none)"}`);

  lines.push("");
  lines.push(`Change across pack:     ${pack.hasChange ? "YES" : "no"}`);
  lines.push(`Regression across pack: ${pack.hasRegression ? "YES" : "no"}`);
  lines.push(`Attention across pack:  ${pack.hasAttention ? "YES" : "no"}`);
  lines.push(`New attention:          ${pack.hasNewAttention ? "YES" : "no"}`);
  lines.push(`Recovery:               ${pack.hasRecovery ? "YES" : "no"}`);
  lines.push(`Unsupported artifact:   ${pack.hasUnsupportedArtifact ? "YES" : "no"}`);
  lines.push(`Missing recommended:    ${pack.hasMissingRecommendedLayer ? "YES" : "no"}`);
  if (pack.ciFailReasons.length > 0) {
    lines.push("CI gate reasons:");
    for (const reason of pack.ciFailReasons) lines.push(`- ${reason}`);
  }

  if (pack.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of pack.warnings) lines.push(`- ${w}`);
  }

  lines.push("");
  lines.push("Notes:");
  for (const note of pack.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of pack.disclaimers) lines.push(d);
  return redactString(lines.join("\n"));
}
