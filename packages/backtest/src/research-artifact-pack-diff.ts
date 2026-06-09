/**
 * Deterministic diff of two Sprint 23 RESEARCH ARTIFACT PACKS (Sprint 24, the pack analogue of the
 * campaign / portfolio / manifest / bundle diffs). Answers "what changed between two PAPER-only
 * artifact-pack snapshots, and did the change break integrity?" without re-reading any artifact or
 * re-walking any directory — it compares two already-built artifact packs.
 *
 * `diffBacktestResearchArtifactPacks(base, next)` STRICTLY validates each input as a Sprint 23
 * `backtest.research.artifact.pack.v1` via {@link validateBacktestResearchArtifactPack} (so a
 * non-pack / wrong-schema input is REFUSED, never silently mis-read), then produces a
 * {@link BacktestResearchArtifactPackDiff} across two clearly-separated axes:
 *
 *   1. **Artifact-set membership** — artifacts added (in next, not base), removed (in base, not
 *      next), and common (in both). Pairing is by the pack's stable, unique `label`. Added/removed
 *      artifacts carry their own kind/status/flags so no information is lost.
 *   2. **Per-artifact transitions over the COMMON set only** — a "transition" needs a before AND an
 *      after, so the newly-changed / newly-regressed / recovered / newly-attention / newly-unsupported
 *      lists are computed strictly over artifacts present in BOTH packs. Appearances and
 *      disappearances are described entirely by axis 1; an appearance is never relabelled a
 *      "transition".
 *
 * Conservative, honest, NON-overclaiming flag semantics:
 *   - `hasArtifactSetChange` — any artifact added or removed.
 *   - `hasChange` — an artifact-set change OR a common artifact whose tracked fields differ.
 *   - `hasRegression` — at least one COMMON artifact transitioned INTO a conservative regression
 *     (no-regression in base → regression in next). An artifact that DISAPPEARS is a change / scope
 *     change, NOT a regression. An artifact that is ADDED already carrying a regression is reported
 *     in `addedArtifacts` (with its flags) and in `changeReasons`, gated by `--fail-on-change` — but
 *     it does NOT set `hasRegression`, because there is no base state for it to have regressed FROM.
 *   - `hasAttention` / `hasNewAttention` — symmetric with regression: current / newly-needed
 *     attention that APPEARED on a common artifact (not-true → true). An added artifact arriving with
 *     attention is an artifact-set change, not an attention transition.
 *   - `hasUnsupported` — a COMMON artifact that went recognized → unsupported, OR an ADDED artifact
 *     that arrives unsupported. Both represent an unsupported artifact newly present in the pack, so
 *     both are gated by `--fail-on-unsupported`. A REMOVED unsupported artifact is NOT newly
 *     unsupported (it is an artifact-set change / a recovery).
 *   - `hasRecovery` — a common artifact that recovered from a regression, no longer needs current
 *     attention, or regained recognition (unsupported → recognized). A removed artifact is NOT a
 *     "recovery".
 *
 * Per-artifact flags are tri-state (true / false / null = not-applicable-to-that-kind). A transition
 * "into" a state requires the next value to be a literal `true` and the base value to be NOT `true`
 * (so a null→null or false→null move is never an appearance), exactly mirroring how the pack itself
 * counts a flag (`=== true`). The pack's two new-attention flags (`hasNewAttention`,
 * `hasNewAttentionSinceBaseline`) are folded into one derived "new-attention" signal, matching the
 * pack's own `artifactsWithNewAttention` aggregation.
 *
 * It is **pure**: no network, no RPC, no wallet, no filesystem, no `Date.now`, no `Math.random`, and
 * it never mutates its inputs (every value placed in the diff is a fresh copy with stable key order,
 * so the JSON is byte-stable for a given pair). This is a reproducibility/audit comparison over two
 * LOCAL pack summaries — never a live result, never advice, never a profitability claim. Nothing here
 * holds a key, or builds/signs/simulates/sends a transaction.
 */

import { redactString } from "@soulmaker/security";
import {
  validateBacktestResearchArtifactPack,
  type BacktestResearchArtifactPack,
  type BacktestResearchArtifactPackEntry,
  type BacktestResearchArtifactPackFlags,
} from "./research-artifact-pack.js";

/** Stable schema identifier for the pack-diff shape. Bump only on a breaking change. */
export const BACKTEST_RESEARCH_ARTIFACT_PACK_DIFF_SCHEMA_VERSION =
  "backtest.research.artifact.pack.diff.v1";

/** The banner that prefixes every pack diff (required label). */
export const BACKTEST_RESEARCH_ARTIFACT_PACK_DIFF_BANNER =
  "SIMULATED PAPER-ONLY RESEARCH ARTIFACT PACK DIFF";

/** Required disclaimer statements carried by every pack diff (stable order). */
export const BACKTEST_RESEARCH_ARTIFACT_PACK_DIFF_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY RESEARCH ARTIFACT PACK DIFF — compares two LOCAL artifact packs for integrity drift.",
  "Every value is a change between two local reproducibility summaries, not a live result, and nothing was fetched or traded.",
  "Per-artifact transitions (newly-changed / newly-regressed / recovered / newly-attention / newly-unsupported) are computed over artifacts present in BOTH packs (paired by label); appeared/disappeared artifacts are reported separately as an artifact-set change.",
  "A disappearing artifact is treated as a change / scope change, NOT a regression; an artifact that arrives already carrying a regression sets hasChange (gated by --fail-on-change), not hasRegression.",
  "A newly-unsupported artifact (a common artifact that lost recognition, or an added artifact that arrives unsupported) sets hasUnsupported and is gated by --fail-on-unsupported.",
  "The conservative regression flag is an integrity/reproducibility signal only; it is NOT financial advice and NOT a profitability claim.",
  "Reproducibility digests behind these summaries are non-cryptographic content fingerprints, NOT a security or anti-tamper guarantee.",
  "It does not follow file paths, read nested files, or make any network call.",
  "Not a live result.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this diff.",
];

/** Thrown only when a pack-diff INPUT or a produced pack diff is structurally invalid. */
export class BacktestResearchArtifactPackDiffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestResearchArtifactPackDiffError";
  }
}

// --- diff data model ---------------------------------------------------------

/** A simple base→next numeric comparison. */
export interface ResearchArtifactPackNumberDelta {
  base: number;
  next: number;
  delta: number;
}

/** A tri-state (true|false|null) base→next flag comparison. */
export interface ResearchArtifactPackFlagTransition {
  base: boolean | null;
  next: boolean | null;
  changed: boolean;
}

/** A compact reference to an artifact that was added or removed (carries its kind/status + flags). */
export interface ResearchArtifactPackEntryRef {
  label: string;
  sourceLabel: string | null;
  schemaVersion: string;
  kind: string;
  recognized: boolean;
  status: string;
  hasChange: boolean | null;
  hasRegression: boolean | null;
  hasAttention: boolean | null;
  /** Derived: hasNewAttention === true OR hasNewAttentionSinceBaseline === true. */
  hasNewAttention: boolean;
  hasRecovery: boolean | null;
}

/** A common artifact (present in BOTH packs, paired by label) whose tracked fields changed. */
export interface ResearchArtifactPackEntryChange {
  label: string;
  baseKind: string;
  nextKind: string;
  kindChanged: boolean;
  baseRecognized: boolean;
  nextRecognized: boolean;
  recognizedChanged: boolean;
  baseStatus: string;
  nextStatus: string;
  statusChanged: boolean;
  baseSourceLabel: string | null;
  nextSourceLabel: string | null;
  sourceLabelChanged: boolean;
  baseSchemaVersion: string;
  nextSchemaVersion: string;
  schemaVersionChanged: boolean;
  hasChange: ResearchArtifactPackFlagTransition;
  hasRegression: ResearchArtifactPackFlagTransition;
  hasAttention: ResearchArtifactPackFlagTransition;
  /** Derived new-attention transition (folds hasNewAttention + hasNewAttentionSinceBaseline). */
  hasNewAttention: ResearchArtifactPackFlagTransition;
  hasRecovery: ResearchArtifactPackFlagTransition;
  /** True iff any of the artifact's reasons strings differ (set or order). */
  reasonsChanged: boolean;
  /** Concise, deterministic reasons this artifact is reported as changed. */
  reasons: string[];
}

/** The full, deterministic, JSON-serializable diff of two artifact packs. */
export interface BacktestResearchArtifactPackDiff {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  simulated: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  disclaimers: string[];
  // --- input summary ---
  baseLabel: string | null;
  nextLabel: string | null;
  basePackName: string | null;
  nextPackName: string | null;
  baseSchemaVersion: string;
  nextSchemaVersion: string;
  baseArtifactCount: number;
  nextArtifactCount: number;
  /** Every base artifact label, sorted ascending. */
  baseArtifactLabels: string[];
  /** Every next artifact label, sorted ascending. */
  nextArtifactLabels: string[];
  // --- artifact-set changes ---
  /** Artifacts present in next but not base, sorted by label. */
  addedArtifacts: ResearchArtifactPackEntryRef[];
  /** Artifacts present in base but not next, sorted by label. */
  removedArtifacts: ResearchArtifactPackEntryRef[];
  /** Labels present in BOTH packs, sorted ascending. */
  commonArtifactLabels: string[];
  // --- per-artifact transitions (common set only) ---
  /** Common artifacts whose tracked fields differ, sorted by label. */
  changedArtifacts: ResearchArtifactPackEntryChange[];
  /** Common labels whose kind (recognized type) changed, sorted. */
  kindChangedArtifacts: string[];
  /** Common labels whose source label/path changed, sorted. */
  sourceChangedArtifacts: string[];
  /** Common labels whose status string changed, sorted. */
  statusChangedArtifacts: string[];
  /** Common labels not changed in base but changed in next (hasChange not-true → true), sorted. */
  newlyChangedArtifacts: string[];
  /** Common labels without a regression in base and with one in next, sorted. */
  newlyRegressedArtifacts: string[];
  /** Common labels with a regression in base and none in next, sorted. */
  recoveredFromRegressionArtifacts: string[];
  /** Common labels not needing current attention in base but needing it in next, sorted. */
  newlyNeedingAttentionArtifacts: string[];
  /** Common labels needing current attention in base but not in next, sorted. */
  noLongerNeedingAttentionArtifacts: string[];
  /** Common labels without new-attention in base but with it in next, sorted. */
  newlyNeedingNewAttentionArtifacts: string[];
  /** Common labels with new-attention in base but not in next, sorted. */
  noLongerNeedingNewAttentionArtifacts: string[];
  /** Common labels recognized in base but unsupported in next, sorted. */
  newlyUnsupportedArtifacts: string[];
  /** Common labels unsupported in base but recognized in next, sorted. */
  noLongerUnsupportedArtifacts: string[];
  /** Added labels that ARRIVE unsupported (an added unsupported artifact), sorted. */
  addedUnsupportedArtifacts: string[];
  // --- aggregate count deltas ---
  artifactCount: ResearchArtifactPackNumberDelta;
  recognizedCount: ResearchArtifactPackNumberDelta;
  unsupportedCount: ResearchArtifactPackNumberDelta;
  artifactsWithChange: ResearchArtifactPackNumberDelta;
  artifactsWithRegression: ResearchArtifactPackNumberDelta;
  artifactsWithAttention: ResearchArtifactPackNumberDelta;
  artifactsWithNewAttention: ResearchArtifactPackNumberDelta;
  artifactsWithRecovery: ResearchArtifactPackNumberDelta;
  cleanArtifactCount: ResearchArtifactPackNumberDelta;
  presentRecommendedLayerCount: ResearchArtifactPackNumberDelta;
  missingRecommendedLayerCount: ResearchArtifactPackNumberDelta;
  // --- chain coverage changes ---
  /** Kinds present in next but not base, sorted. */
  kindsAdded: string[];
  /** Kinds present in base but not next, sorted. */
  kindsRemoved: string[];
  /** Recommended layers missing in base but present in next, sorted. */
  recommendedLayersNewlyPresent: string[];
  /** Recommended layers present in base but missing in next, sorted. */
  recommendedLayersNewlyMissing: string[];
  isMinimal: ResearchArtifactPackFlagTransition;
  isCampaignLevel: ResearchArtifactPackFlagTransition;
  isPortfolioLevel: ResearchArtifactPackFlagTransition;
  isDiffReady: ResearchArtifactPackFlagTransition;
  // --- conservative flags ---
  hasChange: boolean;
  hasArtifactSetChange: boolean;
  hasRegression: boolean;
  hasAttention: boolean;
  hasNewAttention: boolean;
  hasUnsupported: boolean;
  hasRecovery: boolean;
  changeReasons: string[];
  regressionReasons: string[];
  // --- CI decision section ---
  wouldFailOnChange: boolean;
  wouldFailOnRegression: boolean;
  wouldFailOnAttention: boolean;
  wouldFailOnNewAttention: boolean;
  wouldFailOnUnsupported: boolean;
  ciFailReasons: string[];
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

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function delta(base: number, next: number): ResearchArtifactPackNumberDelta {
  return { base, next, delta: next - base };
}

/** A tri-state flag transition (changed iff the two values differ). */
function flag(base: boolean | null, next: boolean | null): ResearchArtifactPackFlagTransition {
  return { base, next, changed: base !== next };
}

/** A boolean flag transition (for the always-boolean coverage tiers). */
function boolFlag(base: boolean, next: boolean): ResearchArtifactPackFlagTransition {
  return { base, next, changed: base !== next };
}

/** Derived "new-attention" signal: the pack counts an artifact when EITHER new-attention flag is true. */
function newAttentionOf(flags: BacktestResearchArtifactPackFlags): boolean {
  return flags.hasNewAttention === true || flags.hasNewAttentionSinceBaseline === true;
}

/** A compact ref for an added/removed artifact. */
function toRef(e: BacktestResearchArtifactPackEntry): ResearchArtifactPackEntryRef {
  return {
    label: e.label,
    sourceLabel: e.sourceLabel,
    schemaVersion: e.schemaVersion,
    kind: e.kind,
    recognized: e.recognized,
    status: e.status,
    hasChange: e.flags.hasChange,
    hasRegression: e.flags.hasRegression,
    hasAttention: e.flags.hasAttention,
    hasNewAttention: newAttentionOf(e.flags),
    hasRecovery: e.flags.hasRecovery,
  };
}

const PACK_FLAG_NAMES = [
  "hasChange",
  "hasRegression",
  "hasAttention",
  "hasNewAttention",
  "hasNewAttentionSinceBaseline",
  "hasRecovery",
  "hasCampaignSetChange",
] as const;

/** True iff any of the seven verbatim per-artifact flags differ between two entries. */
function flagsDiffer(a: BacktestResearchArtifactPackFlags, b: BacktestResearchArtifactPackFlags): boolean {
  return PACK_FLAG_NAMES.some((name) => a[name] !== b[name]);
}

/** True iff two reason lists differ in length, order, or content. */
function reasonsDiffer(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}

/** Read + validate one artifact pack input for diffing (strict; wrong schema is refused). */
function readPack(value: unknown, side: string): BacktestResearchArtifactPack {
  let pack: BacktestResearchArtifactPack;
  try {
    pack = validateBacktestResearchArtifactPack(value);
  } catch (err) {
    throw new BacktestResearchArtifactPackDiffError(
      `${side} artifact pack is invalid: ${(err as Error).message}`,
    );
  }
  // The diff pairs artifacts by label; a corrupted pack with duplicate labels would silently mis-pair,
  // so refuse it rather than risk a wrong comparison. A builder-produced pack never has duplicates.
  const labels = pack.artifacts.map((a) => a.label);
  if (new Set(labels).size !== labels.length) {
    throw new BacktestResearchArtifactPackDiffError(`${side} artifact pack has duplicate artifact labels`);
  }
  return pack;
}

// --- public API --------------------------------------------------------------

/** Options for {@link diffBacktestResearchArtifactPacks}. */
export interface DiffBacktestResearchArtifactPacksOptions {
  /** Optional source path / label for the BASE pack, echoed into the diff. */
  baseLabel?: string;
  /** Optional source path / label for the NEXT pack, echoed into the diff. */
  nextLabel?: string;
}

/**
 * Compute the deterministic diff of two artifact packs. Both inputs are STRICTLY validated as a
 * Sprint 23 artifact pack (a non-pack / wrong-schema input throws
 * {@link BacktestResearchArtifactPackDiffError}); neither is mutated. Artifacts are paired by `label`
 * (added / removed / common). Per-artifact transitions are computed over the common set only; the
 * artifact-set axis (added/removed) is reported separately. Pure and byte-stable for a given pair.
 *
 * `hasRegression` is CONSERVATIVE and HONEST — true only when a COMMON artifact transitions INTO a
 * conservative regression (not-true → true). A disappearing artifact is a change / scope change (not
 * a regression); an added artifact that already carries a regression sets `hasChange` (gated by
 * `--fail-on-change`), not `hasRegression`, because it has no base state to regress from. A newly
 * unsupported artifact (common recognized→unsupported, or an added unsupported artifact) sets
 * `hasUnsupported`.
 */
export function diffBacktestResearchArtifactPacks(
  base: unknown,
  next: unknown,
  opts: DiffBacktestResearchArtifactPacksOptions = {},
): BacktestResearchArtifactPackDiff {
  const b = readPack(base, "base");
  const n = readPack(next, "next");

  const baseByLabel = new Map(b.artifacts.map((a) => [a.label, a]));
  const nextByLabel = new Map(n.artifacts.map((a) => [a.label, a]));

  // --- axis 1: artifact-set membership ---
  const addedArtifacts = n.artifacts
    .filter((a) => !baseByLabel.has(a.label))
    .map(toRef)
    .sort((x, y) => compareString(x.label, y.label));
  const removedArtifacts = b.artifacts
    .filter((a) => !nextByLabel.has(a.label))
    .map(toRef)
    .sort((x, y) => compareString(x.label, y.label));
  const commonArtifactLabels = b.artifacts
    .filter((a) => nextByLabel.has(a.label))
    .map((a) => a.label)
    .sort(compareString);

  // --- axis 2: per-artifact transitions + changed artifacts (common set only) ---
  const changedArtifacts: ResearchArtifactPackEntryChange[] = [];
  const kindChangedArtifacts: string[] = [];
  const sourceChangedArtifacts: string[] = [];
  const statusChangedArtifacts: string[] = [];
  const newlyChangedArtifacts: string[] = [];
  const newlyRegressedArtifacts: string[] = [];
  const recoveredFromRegressionArtifacts: string[] = [];
  const newlyNeedingAttentionArtifacts: string[] = [];
  const noLongerNeedingAttentionArtifacts: string[] = [];
  const newlyNeedingNewAttentionArtifacts: string[] = [];
  const noLongerNeedingNewAttentionArtifacts: string[] = [];
  const newlyUnsupportedArtifacts: string[] = [];
  const noLongerUnsupportedArtifacts: string[] = [];

  for (const label of commonArtifactLabels) {
    const be = baseByLabel.get(label)!;
    const ne = nextByLabel.get(label)!;

    if (be.kind !== ne.kind) kindChangedArtifacts.push(label);
    if (be.sourceLabel !== ne.sourceLabel) sourceChangedArtifacts.push(label);
    if (be.status !== ne.status) statusChangedArtifacts.push(label);

    if (be.flags.hasChange !== true && ne.flags.hasChange === true) newlyChangedArtifacts.push(label);
    if (be.flags.hasRegression !== true && ne.flags.hasRegression === true) newlyRegressedArtifacts.push(label);
    if (be.flags.hasRegression === true && ne.flags.hasRegression !== true) recoveredFromRegressionArtifacts.push(label);
    if (be.flags.hasAttention !== true && ne.flags.hasAttention === true) newlyNeedingAttentionArtifacts.push(label);
    if (be.flags.hasAttention === true && ne.flags.hasAttention !== true) noLongerNeedingAttentionArtifacts.push(label);
    const baseNewAttention = newAttentionOf(be.flags);
    const nextNewAttention = newAttentionOf(ne.flags);
    if (!baseNewAttention && nextNewAttention) newlyNeedingNewAttentionArtifacts.push(label);
    if (baseNewAttention && !nextNewAttention) noLongerNeedingNewAttentionArtifacts.push(label);
    if (be.recognized && !ne.recognized) newlyUnsupportedArtifacts.push(label);
    if (!be.recognized && ne.recognized) noLongerUnsupportedArtifacts.push(label);

    const change = buildEntryChange(label, be, ne);
    if (change) changedArtifacts.push(change);
  }

  // --- axis 1 detail: added artifacts that arrive unsupported ---
  const addedUnsupportedArtifacts = addedArtifacts
    .filter((r) => !r.recognized)
    .map((r) => r.label)
    .sort(compareString);

  // --- aggregate count deltas (read straight off the validated packs) ---
  const artifactCount = delta(b.artifactCount, n.artifactCount);
  const recognizedCount = delta(b.recognizedCount, n.recognizedCount);
  const unsupportedCount = delta(b.unsupportedCount, n.unsupportedCount);
  const artifactsWithChange = delta(b.artifactsWithChange, n.artifactsWithChange);
  const artifactsWithRegression = delta(b.artifactsWithRegression, n.artifactsWithRegression);
  const artifactsWithAttention = delta(b.artifactsWithAttention, n.artifactsWithAttention);
  const artifactsWithNewAttention = delta(b.artifactsWithNewAttention, n.artifactsWithNewAttention);
  const artifactsWithRecovery = delta(b.artifactsWithRecovery, n.artifactsWithRecovery);
  const cleanArtifactCount = delta(b.cleanArtifactCount, n.cleanArtifactCount);
  const presentRecommendedLayerCount = delta(
    b.presentRecommendedLayers.length,
    n.presentRecommendedLayers.length,
  );
  const missingRecommendedLayerCount = delta(
    b.missingRecommendedLayers.length,
    n.missingRecommendedLayers.length,
  );

  // --- chain coverage changes ---
  const baseKinds = new Set(b.presentKinds);
  const nextKinds = new Set(n.presentKinds);
  const kindsAdded = n.presentKinds.filter((k) => !baseKinds.has(k)).sort(compareString);
  const kindsRemoved = b.presentKinds.filter((k) => !nextKinds.has(k)).sort(compareString);
  const baseMissing = new Set(b.missingRecommendedLayers);
  const nextMissing = new Set(n.missingRecommendedLayers);
  // A layer "newly present" was missing in base and is no longer missing in next (and vice versa).
  const recommendedLayersNewlyPresent = b.missingRecommendedLayers
    .filter((layer) => !nextMissing.has(layer))
    .sort(compareString);
  const recommendedLayersNewlyMissing = n.missingRecommendedLayers
    .filter((layer) => !baseMissing.has(layer))
    .sort(compareString);
  const isMinimal = boolFlag(b.isMinimal, n.isMinimal);
  const isCampaignLevel = boolFlag(b.isCampaignLevel, n.isCampaignLevel);
  const isPortfolioLevel = boolFlag(b.isPortfolioLevel, n.isPortfolioLevel);
  const isDiffReady = boolFlag(b.isDiffReady, n.isDiffReady);

  // --- conservative flags ---
  const hasArtifactSetChange = addedArtifacts.length > 0 || removedArtifacts.length > 0;
  const hasChange = hasArtifactSetChange || changedArtifacts.length > 0;
  const hasRegression = newlyRegressedArtifacts.length > 0;
  const hasAttention = newlyNeedingAttentionArtifacts.length > 0;
  const hasNewAttention = newlyNeedingNewAttentionArtifacts.length > 0;
  const hasUnsupported = newlyUnsupportedArtifacts.length > 0 || addedUnsupportedArtifacts.length > 0;
  const hasRecovery =
    recoveredFromRegressionArtifacts.length > 0 ||
    noLongerNeedingAttentionArtifacts.length > 0 ||
    noLongerUnsupportedArtifacts.length > 0;

  // Added artifacts that ARRIVE already flagged — surfaced (non-silent) but NOT a transition.
  const addedRegressed = addedArtifacts.filter((r) => r.hasRegression === true).map((r) => r.label);
  const addedAttention = addedArtifacts.filter((r) => r.hasAttention === true).map((r) => r.label);

  // --- change reasons (any difference) ---
  const changeReasons: string[] = [];
  if (addedArtifacts.length > 0) {
    changeReasons.push(`${addedArtifacts.length} artifact(s) added (${addedArtifacts.map((r) => r.label).join(", ")})`);
  }
  if (removedArtifacts.length > 0) {
    changeReasons.push(`${removedArtifacts.length} artifact(s) removed (${removedArtifacts.map((r) => r.label).join(", ")})`);
  }
  if (changedArtifacts.length > 0) {
    changeReasons.push(`${changedArtifacts.length} common artifact(s) changed (${changedArtifacts.map((c) => c.label).join(", ")})`);
  }
  if (kindChangedArtifacts.length > 0) {
    changeReasons.push(`${kindChangedArtifacts.length} artifact(s) changed kind (${kindChangedArtifacts.join(", ")})`);
  }
  if (newlyRegressedArtifacts.length > 0) {
    changeReasons.push(`${newlyRegressedArtifacts.length} artifact(s) newly regressed (${newlyRegressedArtifacts.join(", ")})`);
  }
  if (recoveredFromRegressionArtifacts.length > 0) {
    changeReasons.push(`${recoveredFromRegressionArtifacts.length} artifact(s) recovered from regression (${recoveredFromRegressionArtifacts.join(", ")})`);
  }
  if (newlyNeedingAttentionArtifacts.length > 0) {
    changeReasons.push(`${newlyNeedingAttentionArtifacts.length} artifact(s) newly need attention (${newlyNeedingAttentionArtifacts.join(", ")})`);
  }
  if (noLongerNeedingAttentionArtifacts.length > 0) {
    changeReasons.push(`${noLongerNeedingAttentionArtifacts.length} artifact(s) no longer need attention (${noLongerNeedingAttentionArtifacts.join(", ")})`);
  }
  if (newlyNeedingNewAttentionArtifacts.length > 0) {
    changeReasons.push(`${newlyNeedingNewAttentionArtifacts.length} artifact(s) newly need new-attention (${newlyNeedingNewAttentionArtifacts.join(", ")})`);
  }
  if (newlyUnsupportedArtifacts.length > 0) {
    changeReasons.push(`${newlyUnsupportedArtifacts.length} artifact(s) newly unsupported (${newlyUnsupportedArtifacts.join(", ")})`);
  }
  if (noLongerUnsupportedArtifacts.length > 0) {
    changeReasons.push(`${noLongerUnsupportedArtifacts.length} artifact(s) no longer unsupported (${noLongerUnsupportedArtifacts.join(", ")})`);
  }
  if (addedUnsupportedArtifacts.length > 0) {
    changeReasons.push(`${addedUnsupportedArtifacts.length} added artifact(s) arrive unsupported (gated by --fail-on-unsupported): ${addedUnsupportedArtifacts.join(", ")}`);
  }
  if (addedRegressed.length > 0) {
    changeReasons.push(`${addedRegressed.length} added artifact(s) arrive carrying a conservative regression (gated by --fail-on-change, not --fail-on-regression): ${addedRegressed.join(", ")}`);
  }
  if (addedAttention.length > 0) {
    changeReasons.push(`${addedAttention.length} added artifact(s) arrive needing attention (gated by --fail-on-change): ${addedAttention.join(", ")}`);
  }
  if (recommendedLayersNewlyMissing.length > 0) {
    changeReasons.push(`recommended layer(s) newly missing: ${recommendedLayersNewlyMissing.join(", ")}`);
  }
  if (recommendedLayersNewlyPresent.length > 0) {
    changeReasons.push(`recommended layer(s) newly present: ${recommendedLayersNewlyPresent.join(", ")}`);
  }
  if (artifactCount.delta !== 0) changeReasons.push(`artifact count ${artifactCount.base} → ${artifactCount.next}`);
  if (unsupportedCount.delta !== 0) changeReasons.push(`unsupported artifacts ${unsupportedCount.base} → ${unsupportedCount.next}`);
  if (artifactsWithRegression.delta !== 0) changeReasons.push(`artifacts with regression ${artifactsWithRegression.base} → ${artifactsWithRegression.next}`);
  if (artifactsWithAttention.delta !== 0) changeReasons.push(`artifacts with attention ${artifactsWithAttention.base} → ${artifactsWithAttention.next}`);

  // --- regression reasons (conservative: integrity transition only) ---
  const regressionReasons: string[] = [];
  if (newlyRegressedArtifacts.length > 0) {
    regressionReasons.push(`${newlyRegressedArtifacts.length} artifact(s) newly carry a conservative regression vs base: ${newlyRegressedArtifacts.join(", ")}`);
  }

  // --- CI decision (gates mirror the conservative flags; reasons explain each, severity order) ---
  const ciFailReasons: string[] = [];
  if (hasRegression) {
    ciFailReasons.push(`conservative regression newly appeared in ${newlyRegressedArtifacts.length} artifact(s): ${newlyRegressedArtifacts.join(", ")}`);
  }
  if (hasNewAttention) {
    ciFailReasons.push(`new-attention newly appeared in ${newlyNeedingNewAttentionArtifacts.length} artifact(s): ${newlyNeedingNewAttentionArtifacts.join(", ")}`);
  }
  if (hasAttention) {
    ciFailReasons.push(`current attention newly appeared in ${newlyNeedingAttentionArtifacts.length} artifact(s): ${newlyNeedingAttentionArtifacts.join(", ")}`);
  }
  if (hasUnsupported) {
    const unsup = [...newlyUnsupportedArtifacts, ...addedUnsupportedArtifacts].sort(compareString);
    ciFailReasons.push(`unsupported artifact(s) newly present: ${unsup.join(", ")}`);
  }
  if (hasChange) {
    ciFailReasons.push(`change detected (${changeReasons.length} reason(s); see changeReasons)`);
  }

  return {
    schemaVersion: BACKTEST_RESEARCH_ARTIFACT_PACK_DIFF_SCHEMA_VERSION,
    banner: BACKTEST_RESEARCH_ARTIFACT_PACK_DIFF_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...BACKTEST_RESEARCH_ARTIFACT_PACK_DIFF_DISCLAIMERS],
    baseLabel: nonEmptyString(opts.baseLabel) ? opts.baseLabel : null,
    nextLabel: nonEmptyString(opts.nextLabel) ? opts.nextLabel : null,
    basePackName: b.packName,
    nextPackName: n.packName,
    baseSchemaVersion: b.schemaVersion,
    nextSchemaVersion: n.schemaVersion,
    baseArtifactCount: b.artifactCount,
    nextArtifactCount: n.artifactCount,
    baseArtifactLabels: [...b.artifactLabels].sort(compareString),
    nextArtifactLabels: [...n.artifactLabels].sort(compareString),
    addedArtifacts,
    removedArtifacts,
    commonArtifactLabels,
    changedArtifacts,
    kindChangedArtifacts,
    sourceChangedArtifacts,
    statusChangedArtifacts,
    newlyChangedArtifacts,
    newlyRegressedArtifacts,
    recoveredFromRegressionArtifacts,
    newlyNeedingAttentionArtifacts,
    noLongerNeedingAttentionArtifacts,
    newlyNeedingNewAttentionArtifacts,
    noLongerNeedingNewAttentionArtifacts,
    newlyUnsupportedArtifacts,
    noLongerUnsupportedArtifacts,
    addedUnsupportedArtifacts,
    artifactCount,
    recognizedCount,
    unsupportedCount,
    artifactsWithChange,
    artifactsWithRegression,
    artifactsWithAttention,
    artifactsWithNewAttention,
    artifactsWithRecovery,
    cleanArtifactCount,
    presentRecommendedLayerCount,
    missingRecommendedLayerCount,
    kindsAdded,
    kindsRemoved,
    recommendedLayersNewlyPresent,
    recommendedLayersNewlyMissing,
    isMinimal,
    isCampaignLevel,
    isPortfolioLevel,
    isDiffReady,
    hasChange,
    hasArtifactSetChange,
    hasRegression,
    hasAttention,
    hasNewAttention,
    hasUnsupported,
    hasRecovery,
    changeReasons,
    regressionReasons,
    wouldFailOnChange: hasChange,
    wouldFailOnRegression: hasRegression,
    wouldFailOnAttention: hasAttention,
    wouldFailOnNewAttention: hasNewAttention,
    wouldFailOnUnsupported: hasUnsupported,
    ciFailReasons,
  };
}

/** Build a {@link ResearchArtifactPackEntryChange} for one common artifact, or null if unchanged. */
function buildEntryChange(
  label: string,
  be: BacktestResearchArtifactPackEntry,
  ne: BacktestResearchArtifactPackEntry,
): ResearchArtifactPackEntryChange | null {
  const kindChanged = be.kind !== ne.kind;
  const recognizedChanged = be.recognized !== ne.recognized;
  const statusChanged = be.status !== ne.status;
  const sourceLabelChanged = be.sourceLabel !== ne.sourceLabel;
  const schemaVersionChanged = be.schemaVersion !== ne.schemaVersion;
  const hasChangeT = flag(be.flags.hasChange, ne.flags.hasChange);
  const hasRegressionT = flag(be.flags.hasRegression, ne.flags.hasRegression);
  const hasAttentionT = flag(be.flags.hasAttention, ne.flags.hasAttention);
  const hasNewAttentionT = boolFlag(newAttentionOf(be.flags), newAttentionOf(ne.flags));
  const hasRecoveryT = flag(be.flags.hasRecovery, ne.flags.hasRecovery);
  const reasonsChanged = reasonsDiffer(be.reasons, ne.reasons);
  const anyFlagChanged = flagsDiffer(be.flags, ne.flags);

  const changed =
    kindChanged ||
    recognizedChanged ||
    statusChanged ||
    sourceLabelChanged ||
    schemaVersionChanged ||
    anyFlagChanged ||
    reasonsChanged;
  if (!changed) return null;

  const reasons: string[] = [];
  if (kindChanged) reasons.push(`kind ${be.kind} → ${ne.kind}`);
  if (recognizedChanged) reasons.push(`recognized ${be.recognized} → ${ne.recognized}`);
  if (statusChanged) reasons.push(`status ${be.status} → ${ne.status}`);
  if (schemaVersionChanged) reasons.push(`schema ${be.schemaVersion} → ${ne.schemaVersion}`);
  if (sourceLabelChanged) reasons.push(`source ${be.sourceLabel ?? "(none)"} → ${ne.sourceLabel ?? "(none)"}`);
  if (hasRegressionT.changed) reasons.push(`regression ${String(be.flags.hasRegression)} → ${String(ne.flags.hasRegression)}`);
  if (hasAttentionT.changed) reasons.push(`current attention ${String(be.flags.hasAttention)} → ${String(ne.flags.hasAttention)}`);
  if (hasNewAttentionT.changed) reasons.push(`new-attention ${hasNewAttentionT.base} → ${hasNewAttentionT.next}`);
  if (hasChangeT.changed) reasons.push(`has-change ${String(be.flags.hasChange)} → ${String(ne.flags.hasChange)}`);
  if (hasRecoveryT.changed) reasons.push(`recovery ${String(be.flags.hasRecovery)} → ${String(ne.flags.hasRecovery)}`);
  if (reasonsChanged && reasons.length === 0) reasons.push("artifact reasons changed");

  return {
    label,
    baseKind: be.kind,
    nextKind: ne.kind,
    kindChanged,
    baseRecognized: be.recognized,
    nextRecognized: ne.recognized,
    recognizedChanged,
    baseStatus: be.status,
    nextStatus: ne.status,
    statusChanged,
    baseSourceLabel: be.sourceLabel,
    nextSourceLabel: ne.sourceLabel,
    sourceLabelChanged,
    baseSchemaVersion: be.schemaVersion,
    nextSchemaVersion: ne.schemaVersion,
    schemaVersionChanged,
    hasChange: hasChangeT,
    hasRegression: hasRegressionT,
    hasAttention: hasAttentionT,
    hasNewAttention: hasNewAttentionT,
    hasRecovery: hasRecoveryT,
    reasonsChanged,
    reasons,
  };
}

// --- validation (backstop) ---------------------------------------------------

function isNumberDelta(value: unknown): boolean {
  return isObject(value) && isFiniteNumber(value.base) && isFiniteNumber(value.next) && isFiniteNumber(value.delta);
}

function isTriStateFlag(value: unknown): boolean {
  return value === true || value === false || value === null;
}

function isFlagTransition(value: unknown): boolean {
  return (
    isObject(value) &&
    isTriStateFlag(value.base) &&
    isTriStateFlag(value.next) &&
    typeof value.changed === "boolean"
  );
}

function validateStringArray(value: unknown, where: string): void {
  if (!Array.isArray(value)) throw new BacktestResearchArtifactPackDiffError(`${where} must be an array`);
  value.forEach((s, i) => {
    if (typeof s !== "string") throw new BacktestResearchArtifactPackDiffError(`${where}[${i}] must be a string`);
  });
}

function validateEntryRef(value: unknown, where: string): void {
  if (!isObject(value)) throw new BacktestResearchArtifactPackDiffError(`${where} must be an object`);
  for (const f of ["label", "schemaVersion", "kind", "status"] as const) {
    if (!nonEmptyString(value[f])) throw new BacktestResearchArtifactPackDiffError(`${where}.${f} must be a non-empty string`);
  }
  if (value.sourceLabel !== null && !nonEmptyString(value.sourceLabel)) {
    throw new BacktestResearchArtifactPackDiffError(`${where}.sourceLabel must be a non-empty string or null`);
  }
  if (typeof value.recognized !== "boolean") {
    throw new BacktestResearchArtifactPackDiffError(`${where}.recognized must be a boolean`);
  }
  if (typeof value.hasNewAttention !== "boolean") {
    throw new BacktestResearchArtifactPackDiffError(`${where}.hasNewAttention must be a boolean`);
  }
  for (const f of ["hasChange", "hasRegression", "hasAttention", "hasRecovery"] as const) {
    if (!isTriStateFlag(value[f])) throw new BacktestResearchArtifactPackDiffError(`${where}.${f} must be a boolean or null`);
  }
}

/**
 * Strictly validate a value as a {@link BacktestResearchArtifactPackDiff} and return it narrowed. A
 * backstop mirroring the other diff validators: checks the schema version + banner, the PAPER-ONLY
 * labelling, the disclaimers, the input summary, the added/removed refs, the transition lists, every
 * number delta, the coverage flag transitions, the changed-artifact shapes, the conservative flags,
 * and the CI mirror. Throws {@link BacktestResearchArtifactPackDiffError} on the first problem. Pure.
 */
export function validateBacktestResearchArtifactPackDiff(value: unknown): BacktestResearchArtifactPackDiff {
  if (!isObject(value)) throw new BacktestResearchArtifactPackDiffError("pack diff must be a JSON object");
  if (value.schemaVersion !== BACKTEST_RESEARCH_ARTIFACT_PACK_DIFF_SCHEMA_VERSION) {
    throw new BacktestResearchArtifactPackDiffError(
      `pack diff.schemaVersion must be "${BACKTEST_RESEARCH_ARTIFACT_PACK_DIFF_SCHEMA_VERSION}"`,
    );
  }
  if (value.banner !== BACKTEST_RESEARCH_ARTIFACT_PACK_DIFF_BANNER) {
    throw new BacktestResearchArtifactPackDiffError(`pack diff.banner must be "${BACKTEST_RESEARCH_ARTIFACT_PACK_DIFF_BANNER}"`);
  }
  for (const f of ["paperOnly", "simulated", "notLiveResult", "notFinancialAdvice", "notProfitabilityClaim"] as const) {
    if (value[f] !== true) throw new BacktestResearchArtifactPackDiffError(`pack diff.${f} must be true`);
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new BacktestResearchArtifactPackDiffError("pack diff.disclaimers must be a non-empty array");
  }
  for (const f of ["baseLabel", "nextLabel", "basePackName", "nextPackName"] as const) {
    if (value[f] !== null && typeof value[f] !== "string") {
      throw new BacktestResearchArtifactPackDiffError(`pack diff.${f} must be a string or null`);
    }
  }
  for (const f of ["baseSchemaVersion", "nextSchemaVersion"] as const) {
    if (!nonEmptyString(value[f])) throw new BacktestResearchArtifactPackDiffError(`pack diff.${f} must be a non-empty string`);
  }
  for (const f of ["baseArtifactCount", "nextArtifactCount"] as const) {
    if (!isFiniteNumber(value[f])) throw new BacktestResearchArtifactPackDiffError(`pack diff.${f} must be a number`);
  }
  for (const f of [
    "hasChange",
    "hasArtifactSetChange",
    "hasRegression",
    "hasAttention",
    "hasNewAttention",
    "hasUnsupported",
    "hasRecovery",
    "wouldFailOnChange",
    "wouldFailOnRegression",
    "wouldFailOnAttention",
    "wouldFailOnNewAttention",
    "wouldFailOnUnsupported",
  ] as const) {
    if (typeof value[f] !== "boolean") throw new BacktestResearchArtifactPackDiffError(`pack diff.${f} must be a boolean`);
  }
  // The CI gates mirror the conservative flags exactly.
  const ciMirror: [string, string][] = [
    ["wouldFailOnChange", "hasChange"],
    ["wouldFailOnRegression", "hasRegression"],
    ["wouldFailOnAttention", "hasAttention"],
    ["wouldFailOnNewAttention", "hasNewAttention"],
    ["wouldFailOnUnsupported", "hasUnsupported"],
  ];
  for (const [gate, src] of ciMirror) {
    if (value[gate] !== value[src]) throw new BacktestResearchArtifactPackDiffError(`pack diff.${gate} must mirror ${src}`);
  }
  for (const f of [
    "baseArtifactLabels",
    "nextArtifactLabels",
    "commonArtifactLabels",
    "kindChangedArtifacts",
    "sourceChangedArtifacts",
    "statusChangedArtifacts",
    "newlyChangedArtifacts",
    "newlyRegressedArtifacts",
    "recoveredFromRegressionArtifacts",
    "newlyNeedingAttentionArtifacts",
    "noLongerNeedingAttentionArtifacts",
    "newlyNeedingNewAttentionArtifacts",
    "noLongerNeedingNewAttentionArtifacts",
    "newlyUnsupportedArtifacts",
    "noLongerUnsupportedArtifacts",
    "addedUnsupportedArtifacts",
    "kindsAdded",
    "kindsRemoved",
    "recommendedLayersNewlyPresent",
    "recommendedLayersNewlyMissing",
    "changeReasons",
    "regressionReasons",
    "ciFailReasons",
  ] as const) {
    validateStringArray(value[f], `pack diff.${f}`);
  }
  for (const key of ["addedArtifacts", "removedArtifacts"] as const) {
    if (!Array.isArray(value[key])) throw new BacktestResearchArtifactPackDiffError(`pack diff.${key} must be an array`);
    (value[key] as unknown[]).forEach((r, i) => validateEntryRef(r, `pack diff.${key}[${i}]`));
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
    "presentRecommendedLayerCount",
    "missingRecommendedLayerCount",
  ] as const) {
    if (!isNumberDelta(value[f])) throw new BacktestResearchArtifactPackDiffError(`pack diff.${f} must be a {base,next,delta} number delta`);
  }
  for (const f of ["isMinimal", "isCampaignLevel", "isPortfolioLevel", "isDiffReady"] as const) {
    if (!isFlagTransition(value[f])) throw new BacktestResearchArtifactPackDiffError(`pack diff.${f} must be a {base,next,changed} transition`);
  }
  if (!Array.isArray(value.changedArtifacts)) throw new BacktestResearchArtifactPackDiffError("pack diff.changedArtifacts must be an array");
  (value.changedArtifacts as unknown[]).forEach((c, i) => {
    const where = `pack diff.changedArtifacts[${i}]`;
    if (!isObject(c) || !nonEmptyString(c.label)) {
      throw new BacktestResearchArtifactPackDiffError(`${where} must have a non-empty label`);
    }
    for (const sf of ["baseKind", "nextKind", "baseStatus", "nextStatus", "baseSchemaVersion", "nextSchemaVersion"] as const) {
      if (!nonEmptyString(c[sf])) throw new BacktestResearchArtifactPackDiffError(`${where}.${sf} must be a non-empty string`);
    }
    for (const nf of ["baseSourceLabel", "nextSourceLabel"] as const) {
      if (c[nf] !== null && !nonEmptyString(c[nf])) {
        throw new BacktestResearchArtifactPackDiffError(`${where}.${nf} must be a non-empty string or null`);
      }
    }
    for (const bf of [
      "kindChanged",
      "recognizedChanged",
      "statusChanged",
      "sourceLabelChanged",
      "schemaVersionChanged",
      "baseRecognized",
      "nextRecognized",
      "reasonsChanged",
    ] as const) {
      if (typeof c[bf] !== "boolean") throw new BacktestResearchArtifactPackDiffError(`${where}.${bf} must be a boolean`);
    }
    for (const tf of ["hasChange", "hasRegression", "hasAttention", "hasNewAttention", "hasRecovery"] as const) {
      if (!isFlagTransition(c[tf])) throw new BacktestResearchArtifactPackDiffError(`${where}.${tf} must be a {base,next,changed} transition`);
    }
    validateStringArray(c.reasons, `${where}.reasons`);
  });
  return value as unknown as BacktestResearchArtifactPackDiff;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatBacktestResearchArtifactPackDiff}. */
export interface FormatBacktestResearchArtifactPackDiffOptions {
  baseLabel?: string;
  nextLabel?: string;
  /** Cap on the number of per-artifact rows printed per section (default 50; the rest are summarized). */
  maxRows?: number;
}

function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n}`;
}

/**
 * Render a redacted, human-readable, PAPER-ONLY pack diff. Sectioned and stable for a given diff
 * object; long artifact lists are summarized (never an unsafe raw dump). Leads with the PAPER-ONLY
 * banner and the artifact-set change, walks the per-artifact transitions, chain-coverage changes, and
 * aggregate count deltas, and closes with the CHANGE / REGRESSION / ATTENTION / UNSUPPORTED verdicts
 * + the not-live / not-advice framing. The whole output is passed through the shared redactor.
 */
export function formatBacktestResearchArtifactPackDiff(
  diff: BacktestResearchArtifactPackDiff,
  opts: FormatBacktestResearchArtifactPackDiffOptions = {},
): string {
  const baseLabel = opts.baseLabel ?? diff.baseLabel ?? diff.basePackName ?? "base";
  const nextLabel = opts.nextLabel ?? diff.nextLabel ?? diff.nextPackName ?? "next";
  const maxRows = opts.maxRows ?? 50;
  const lines: string[] = [];

  const header = `${diff.banner} (PAPER ONLY)`;
  lines.push(header);
  lines.push("=".repeat(header.length));

  lines.push("Pack pair:");
  lines.push(`- base (${baseLabel}): ${diff.basePackName ?? "(unnamed)"}  (${diff.baseArtifactCount} artifact(s))`);
  lines.push(`- next (${nextLabel}): ${diff.nextPackName ?? "(unnamed)"}  (${diff.nextArtifactCount} artifact(s))`);
  lines.push(`- common artifacts: ${diff.commonArtifactLabels.length}`);
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

  section(
    "Added artifacts",
    diff.addedArtifacts.map((r) => `${r.label} [${r.kind}; ${r.recognized ? "recognized" : "UNSUPPORTED"}; ${r.status}]`),
  );
  section(
    "Removed artifacts",
    diff.removedArtifacts.map((r) => `${r.label} [${r.kind}; ${r.recognized ? "recognized" : "UNSUPPORTED"}; ${r.status}]`),
  );
  section(
    "Changed artifacts",
    diff.changedArtifacts.map((c) => `${c.label} [${c.baseKind} → ${c.nextKind}]${c.reasons.length > 0 ? `  (${c.reasons.join("; ")})` : ""}`),
  );
  lines.push("");

  lines.push("Transitions (common artifacts):");
  const transition = (label: string, ids: string[]): void => {
    if (ids.length > 0) lines.push(`- ${label}: ${ids.join(", ")}`);
  };
  transition("newly changed", diff.newlyChangedArtifacts);
  transition("newly regressed", diff.newlyRegressedArtifacts);
  transition("recovered from regression", diff.recoveredFromRegressionArtifacts);
  transition("newly need attention", diff.newlyNeedingAttentionArtifacts);
  transition("no longer need attention", diff.noLongerNeedingAttentionArtifacts);
  transition("newly need new-attention", diff.newlyNeedingNewAttentionArtifacts);
  transition("no longer need new-attention", diff.noLongerNeedingNewAttentionArtifacts);
  transition("newly unsupported", diff.newlyUnsupportedArtifacts);
  transition("no longer unsupported", diff.noLongerUnsupportedArtifacts);
  transition("kind changed", diff.kindChangedArtifacts);
  transition("source changed", diff.sourceChangedArtifacts);
  if (
    diff.newlyChangedArtifacts.length === 0 &&
    diff.newlyRegressedArtifacts.length === 0 &&
    diff.recoveredFromRegressionArtifacts.length === 0 &&
    diff.newlyNeedingAttentionArtifacts.length === 0 &&
    diff.noLongerNeedingAttentionArtifacts.length === 0 &&
    diff.newlyNeedingNewAttentionArtifacts.length === 0 &&
    diff.noLongerNeedingNewAttentionArtifacts.length === 0 &&
    diff.newlyUnsupportedArtifacts.length === 0 &&
    diff.noLongerUnsupportedArtifacts.length === 0 &&
    diff.kindChangedArtifacts.length === 0 &&
    diff.sourceChangedArtifacts.length === 0
  ) {
    lines.push("- (none)");
  }
  lines.push("");

  lines.push("Chain coverage changes:");
  if (diff.kindsAdded.length > 0) lines.push(`- kinds added: ${diff.kindsAdded.join(", ")}`);
  if (diff.kindsRemoved.length > 0) lines.push(`- kinds removed: ${diff.kindsRemoved.join(", ")}`);
  if (diff.recommendedLayersNewlyPresent.length > 0) lines.push(`- recommended layers newly present: ${diff.recommendedLayersNewlyPresent.join(", ")}`);
  if (diff.recommendedLayersNewlyMissing.length > 0) lines.push(`- recommended layers newly missing: ${diff.recommendedLayersNewlyMissing.join(", ")}`);
  const tier = (name: string, t: ResearchArtifactPackFlagTransition): void => {
    if (t.changed) lines.push(`- ${name}: ${t.base} → ${t.next}`);
  };
  tier("minimal", diff.isMinimal);
  tier("campaign-level", diff.isCampaignLevel);
  tier("portfolio-level", diff.isPortfolioLevel);
  tier("diff-ready", diff.isDiffReady);
  if (
    diff.kindsAdded.length === 0 &&
    diff.kindsRemoved.length === 0 &&
    diff.recommendedLayersNewlyPresent.length === 0 &&
    diff.recommendedLayersNewlyMissing.length === 0 &&
    !diff.isMinimal.changed &&
    !diff.isCampaignLevel.changed &&
    !diff.isPortfolioLevel.changed &&
    !diff.isDiffReady.changed
  ) {
    lines.push("- (none)");
  }
  lines.push("");

  lines.push("Aggregate counts (base → next, Δ):");
  const countLine = (label: string, d: ResearchArtifactPackNumberDelta): void => {
    lines.push(`- ${label}: ${d.base} → ${d.next} (Δ ${signed(d.delta)})`);
  };
  countLine("artifacts", diff.artifactCount);
  countLine("recognized", diff.recognizedCount);
  countLine("unsupported", diff.unsupportedCount);
  countLine("with change", diff.artifactsWithChange);
  countLine("with regression", diff.artifactsWithRegression);
  countLine("with attention", diff.artifactsWithAttention);
  countLine("with new attention", diff.artifactsWithNewAttention);
  countLine("with recovery", diff.artifactsWithRecovery);
  countLine("clean", diff.cleanArtifactCount);
  countLine("recommended present", diff.presentRecommendedLayerCount);
  lines.push("");

  lines.push(`Changed: ${diff.hasChange ? "YES" : "no"}`);
  if (diff.hasChange) for (const r of diff.changeReasons) lines.push(`- ${r}`);
  lines.push(`Artifact-set change: ${diff.hasArtifactSetChange ? "YES" : "no"}`);
  lines.push(`Regression: ${diff.hasRegression ? "YES" : "no"}`);
  if (diff.hasRegression) for (const r of diff.regressionReasons) lines.push(`- ${r}`);
  lines.push(`Attention newly appeared: ${diff.hasAttention ? "YES" : "no"}`);
  lines.push(`New-attention newly appeared: ${diff.hasNewAttention ? "YES" : "no"}`);
  lines.push(`Unsupported newly present: ${diff.hasUnsupported ? "YES" : "no"}`);
  lines.push(`Recovery: ${diff.hasRecovery ? "YES" : "no"}`);
  if (diff.ciFailReasons.length > 0) {
    lines.push("CI gate reasons:");
    for (const r of diff.ciFailReasons) lines.push(`- ${r}`);
  }
  lines.push("");

  lines.push("Notes:");
  for (const d of diff.disclaimers) lines.push(`- ${d}`);

  return redactString(lines.join("\n"));
}
