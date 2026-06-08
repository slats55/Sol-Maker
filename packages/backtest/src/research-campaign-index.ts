/**
 * Deterministic, offline, **simulated-only** RESEARCH CAMPAIGN INDEX (Sprint 18).
 *
 * Sprint 16 indexed the LOCAL JSON artifacts inside ONE research run (the manifest). Sprint 17
 * packaged ONE run into a self-describing bundle and an at-a-glance integrity status. Sprint 18
 * sits one level higher: it indexes MANY research runs that live side-by-side under a CAMPAIGN
 * directory and summarizes them in a single, stable, comparable campaign-level report.
 *
 * It answers campaign-scope questions at a glance:
 *
 *   - What runs exist in this campaign, and how many?
 *   - Which runs are VALID and which need attention (unknown / malformed / drift / incomplete)?
 *   - What is each run's reproducibility run digest, and did any of them change?
 *   - Which runs were added or removed (via the top-level campaign digest)?
 *   - What artifact KINDS and SCHEMA versions appear across the whole campaign?
 *
 * It is **pure** and does NO filesystem/network IO of its own: like the manifest/bundle/status
 * builders it accepts ALREADY-LOADED per-run inputs (the CLI walks the campaign directory, and
 * for each immediate run subdirectory reads + classifies + digests its `*.json` artifacts and
 * optionally discovers a recorded manifest, then hands the descriptors here). It reuses the
 * Sprint 16/17 pure builders — {@link buildBacktestResearchBundle} for each run's counts, kind
 * counts, recognized-schema set, and reproducibility run digest, and
 * {@link buildBacktestResearchStatus} for each run's complete/recognized/stable/in-sync health —
 * so it never re-implements classification, verification, or digesting. The index carries NO
 * wall-clock timestamp, so an identical set of runs produces a byte-identical campaign index.
 *
 * The top-level campaign digest is the existing NON-CRYPTOGRAPHIC, reproducibility-only FNV-1a
 * content fingerprint (see {@link import("./digest.js").digestContent}), taken over the
 * path-sorted run digests plus stable per-run metadata. It detects "same campaign content" and
 * traces a campaign, NOT security, integrity, or anti-tamper. The index labels it as such.
 *
 * This is bookkeeping over injected, simulated local artifacts — NOT a live result, NOT real
 * market data, NOT advice, and NOT a profitability claim. Nothing here holds a key, or
 * builds/signs/simulates/sends a transaction.
 */

import { digestContent } from "./digest.js";
import {
  buildBacktestResearchBundle,
  type BuildBacktestResearchBundleInput,
} from "./research-bundle.js";
import { buildBacktestResearchStatus } from "./research-status.js";
import {
  BACKTEST_ARTIFACT_KINDS,
  type BacktestArtifactDescriptor,
  type BacktestArtifactKind,
  type BacktestArtifactKindCount,
} from "./research-manifest.js";

/** Stable schema identifier for the research campaign index. Bump only on a breaking change. */
export const BACKTEST_RESEARCH_CAMPAIGN_INDEX_SCHEMA_VERSION = "backtest.research.campaign.index.v1";

/** The banner that prefixes every campaign index (required label). */
export const BACKTEST_RESEARCH_CAMPAIGN_INDEX_BANNER = "SIMULATED PAPER-ONLY RESEARCH CAMPAIGN INDEX";

/**
 * The stable DOMAIN string the campaign digest is computed over. Kept independent of the index
 * schema version so the campaign digest reflects only the set of runs, not the index's own shape:
 * the same runs always yield the same campaign digest, even across a future index-schema bump.
 */
export const BACKTEST_RESEARCH_CAMPAIGN_DIGEST_DOMAIN = "backtest.research.campaign-digest.v1";

/**
 * An honest label for the digest: it is NOT cryptographic and exists only for
 * reproducibility/"same content" comparison, never for security or anti-tamper use.
 */
export const BACKTEST_RESEARCH_CAMPAIGN_DIGEST_ALGORITHM =
  "fnv1a-64-canonical (non-cryptographic; reproducibility-only, not a security/anti-tamper hash)";

/** Required disclaimer statements carried by every campaign index (stable order). */
export const BACKTEST_RESEARCH_CAMPAIGN_INDEX_DISCLAIMERS: readonly string[] = [
  "SIMULATED PAPER-ONLY RESEARCH CAMPAIGN INDEX — a summary of the LOCAL research runs under a campaign directory.",
  "Summarizes local run directories only — it embeds no artifact contents, is not live data, and fetched nothing.",
  "The campaign digest is a non-cryptographic, reproducibility-only fingerprint of the run set, NOT a security or anti-tamper guarantee.",
  "Not a live result.",
  "Not financial advice.",
  "Not a profitability claim.",
  "No wallet, key, signing, sending, or transaction planning is involved anywhere in this index.",
];

/** Thrown only when campaign INPUT or a produced campaign index is structurally invalid. */
export class BacktestResearchCampaignIndexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BacktestResearchCampaignIndexError";
  }
}

// --- input -------------------------------------------------------------------

/** One already-loaded research run's input (the CLI assembles this per run subdirectory). */
export interface BacktestResearchCampaignRunInput {
  /** Stable run identifier — typically the run directory's basename. Non-empty, unique per campaign. */
  runId: string;
  /** The already-loaded artifact descriptors for this run (≥0). */
  artifacts: BacktestArtifactDescriptor[];
  /**
   * Relative paths of this run's artifacts that were unparseable JSON (a subset of `unknown-json`).
   * The CLI passes this; the pure layer cannot tell malformed from parseable-unrecognized.
   */
  malformedPaths?: string[];
  /**
   * An optional already-loaded manifest object to check this run against. When present, manifest
   * drift (missing / extra / digest-/schema-/size-changed) marks the run as needing attention.
   */
  manifest?: unknown;
}

/** Everything {@link buildBacktestResearchCampaignIndex} needs (already-loaded per-run inputs). */
export interface BuildBacktestResearchCampaignIndexInput {
  /** Optional campaign label (e.g. the campaign directory name). */
  campaignName?: string;
  /** The per-run inputs (≥0). */
  runs: BacktestResearchCampaignRunInput[];
}

// --- index model -------------------------------------------------------------

/** One run's deterministic summary within the campaign index. */
export interface BacktestResearchCampaignRunSummary {
  runId: string;
  /** The run's non-cryptographic run digest, or null when the run could not be summarized. */
  runDigest: string | null;
  /** True iff the run is complete, recognized, stable, bundle-valid, and (if a manifest is present) in sync. */
  valid: boolean;
  artifactCount: number;
  /** Recognized artifacts (artifactCount − unknownArtifactCount). */
  knownArtifactCount: number;
  unknownArtifactCount: number;
  malformedArtifactCount: number;
  /** COMPLETE: the run directory has at least one artifact. */
  complete: boolean;
  /** RECOGNIZED: every artifact classified to a known kind (no unknown-json). */
  recognized: boolean;
  /** STABLE: no artifact was unparseable JSON. */
  stable: boolean;
  /** Whether a valid bundle could be built from the run. */
  bundleCandidateValid: boolean;
  /** Whether a recorded manifest was provided/discovered for this run. */
  manifestPresent: boolean;
  /** True iff a manifest was present AND the run matches it exactly. */
  inSync: boolean;
  /** True iff a manifest was present AND the run does NOT match it (drift). */
  driftDetected: boolean;
  /** Per-kind artifact counts present in the run, sorted by kind ascending. */
  kindCounts: BacktestArtifactKindCount[];
  /** Recognized schema versions present in the run, sorted ascending. */
  schemaVersions: string[];
  /** Reproducibility-only warnings for the run (unknown, malformed, drift, empty, …). */
  warnings: string[];
  /** A single neutral, operational next step for the run (never trading advice). */
  recommendedAction: string;
  /** The error captured when the run could not be summarized (structurally bad input), else null. */
  buildError: string | null;
}

/**
 * The full, deterministic, byte-stable research campaign index. JSON-serializable as-is. Carries
 * the required PAPER-ONLY / local-runs-only / not-a-live-result / not-advice language and the
 * honest non-cryptographic-digest label so they survive serialization.
 */
export interface BacktestResearchCampaignIndex {
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
  campaignName: string | null;
  /** Top-level, non-cryptographic digest over the sorted run digests + stable metadata. */
  campaignDigest: string;
  runCount: number;
  validRunCount: number;
  invalidRunCount: number;
  totalArtifactCount: number;
  totalKnownArtifactCount: number;
  totalUnknownArtifactCount: number;
  totalMalformedArtifactCount: number;
  /** Run ids that need attention (invalid), sorted ascending. */
  runsNeedingAttention: string[];
  /** Aggregate per-kind artifact counts across all runs, sorted by kind ascending. */
  aggregateKindCounts: BacktestArtifactKindCount[];
  /** Aggregate recognized schema-version set across the campaign, sorted ascending. */
  aggregateSchemaVersions: string[];
  /** Per-run summaries, sorted by runId ascending. */
  runs: BacktestResearchCampaignRunSummary[];
  /** Reproducibility-only warnings (runs needing attention, empty campaign, malformed totals, …). */
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

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const ARTIFACT_KIND_SET = new Set<string>(BACKTEST_ARTIFACT_KINDS);

// --- per-run summarization ---------------------------------------------------

/** Build the deterministic summary for one run, capturing a build error as an invalid run. */
function summarizeRun(
  run: unknown,
  index: number,
  seenRunIds: Set<string>,
): BacktestResearchCampaignRunSummary {
  if (!isObject(run)) {
    throw new BacktestResearchCampaignIndexError(`runs[${index}] must be an object`);
  }
  if (!nonEmptyString(run.runId)) {
    throw new BacktestResearchCampaignIndexError(`runs[${index}].runId must be a non-empty string`);
  }
  const runId = run.runId;
  if (seenRunIds.has(runId)) {
    throw new BacktestResearchCampaignIndexError(`duplicate runId "${runId}"`);
  }
  seenRunIds.add(runId);
  if (!Array.isArray(run.artifacts)) {
    throw new BacktestResearchCampaignIndexError(`runs[${index}].artifacts must be an array`);
  }
  if (run.malformedPaths !== undefined && !Array.isArray(run.malformedPaths)) {
    throw new BacktestResearchCampaignIndexError(
      `runs[${index}].malformedPaths must be an array when present`,
    );
  }

  // Reuse the Sprint 17 pure builders. A merely UNHEALTHY run (unknown/malformed/drift/empty) is
  // summarized fine and counted as needing attention; only a structurally bad descriptor or a
  // structurally bad recorded manifest throws here, which we capture as an invalid, errored run
  // (deterministic and surfaced — never silently dropped, never a campaign-wide crash).
  const bundleInput: BuildBacktestResearchBundleInput = {
    runName: runId,
    artifacts: run.artifacts as BacktestArtifactDescriptor[],
    malformedPaths: run.malformedPaths as string[] | undefined,
  };
  try {
    const bundle = buildBacktestResearchBundle(bundleInput);
    const status = buildBacktestResearchStatus({
      runName: runId,
      artifacts: run.artifacts as BacktestArtifactDescriptor[],
      malformedPaths: run.malformedPaths as string[] | undefined,
      manifest: run.manifest,
    });

    const manifestPresent = status.manifest.present;
    const inSync = manifestPresent && status.manifest.inSync;
    const driftDetected = manifestPresent && !status.manifest.inSync;
    const valid =
      status.complete &&
      status.recognized &&
      status.stable &&
      status.bundleCandidateValid &&
      !driftDetected;
    const knownArtifactCount = bundle.artifactCount - bundle.unknownArtifactCount;

    return {
      runId,
      runDigest: bundle.runDigest,
      valid,
      artifactCount: bundle.artifactCount,
      knownArtifactCount,
      unknownArtifactCount: bundle.unknownArtifactCount,
      malformedArtifactCount: bundle.malformedArtifactCount,
      complete: status.complete,
      recognized: status.recognized,
      stable: status.stable,
      bundleCandidateValid: status.bundleCandidateValid,
      manifestPresent,
      inSync,
      driftDetected,
      kindCounts: bundle.kindCounts.map((k) => ({ ...k })),
      schemaVersions: [...bundle.recognizedSchemaVersions],
      warnings: [...status.warnings],
      recommendedAction: status.recommendedAction,
      buildError: null,
    };
  } catch (err) {
    const message = (err as Error).message;
    return {
      runId,
      runDigest: null,
      valid: false,
      artifactCount: 0,
      knownArtifactCount: 0,
      unknownArtifactCount: 0,
      malformedArtifactCount: 0,
      complete: false,
      recognized: false,
      stable: false,
      bundleCandidateValid: false,
      manifestPresent: false,
      inSync: false,
      driftDetected: false,
      kindCounts: [],
      schemaVersions: [],
      warnings: [`run "${runId}" could not be summarized: ${message}`],
      recommendedAction: `The run "${runId}" could not be summarized (${message}); inspect the directory before relying on it.`,
      buildError: message,
    };
  }
}

// --- campaign digest ---------------------------------------------------------

/**
 * Compute the deterministic, non-cryptographic CAMPAIGN DIGEST over a set of run summaries. The
 * digest is taken over a canonical, runId-sorted projection of each run's comparable fields (the
 * run digest, validity, counts, kind counts, and recognized-schema set) under a stable domain
 * tag, so:
 *
 *  - it is independent of run input order (sorted first);
 *  - identical run sets produce an identical campaign digest;
 *  - changing ANY run's run digest (or its validity/counts/kinds/schemas) changes it;
 *  - adding or removing a run changes it.
 *
 * Pure and non-mutating. This is a reproducibility fingerprint of the whole campaign, NOT a
 * security/anti-tamper hash.
 */
export function buildBacktestResearchCampaignDigest(
  runs: BacktestResearchCampaignRunSummary[],
): string {
  if (!Array.isArray(runs)) {
    throw new BacktestResearchCampaignIndexError(
      "campaign-digest input must be an array of run summaries",
    );
  }
  const projection = runs
    .map((r, i) => {
      if (!isObject(r)) {
        throw new BacktestResearchCampaignIndexError(`runs[${i}] must be an object`);
      }
      return {
        runId: r.runId,
        runDigest: r.runDigest ?? null,
        valid: r.valid === true,
        artifactCount: r.artifactCount,
        knownArtifactCount: r.knownArtifactCount,
        unknownArtifactCount: r.unknownArtifactCount,
        malformedArtifactCount: r.malformedArtifactCount,
        kindCounts: Array.isArray(r.kindCounts)
          ? r.kindCounts.map((k) => ({ kind: k.kind, count: k.count }))
          : [],
        schemaVersions: Array.isArray(r.schemaVersions) ? [...r.schemaVersions] : [],
        buildError: r.buildError ?? null,
      };
    })
    .sort((a, b) => compareString(String(a.runId), String(b.runId)));
  return digestContent({ domain: BACKTEST_RESEARCH_CAMPAIGN_DIGEST_DOMAIN, runs: projection });
}

// --- builder -----------------------------------------------------------------

/**
 * Build a deterministic, byte-stable {@link BacktestResearchCampaignIndex} from already-loaded
 * per-run inputs. Pure and non-mutating. Reuses the Sprint 17 {@link buildBacktestResearchBundle}
 * and {@link buildBacktestResearchStatus} builders per run, sorts runs by id, aggregates the
 * kind/schema sets and counts across the campaign, lists the runs needing attention, and computes
 * the top-level {@link buildBacktestResearchCampaignDigest campaign digest}. Throws
 * {@link BacktestResearchCampaignIndexError} on structurally invalid top-level input or a
 * duplicate/blank runId.
 */
export function buildBacktestResearchCampaignIndex(
  input: BuildBacktestResearchCampaignIndexInput,
): BacktestResearchCampaignIndex {
  if (!isObject(input)) {
    throw new BacktestResearchCampaignIndexError("campaign input must be an object");
  }
  if (input.campaignName !== undefined && typeof input.campaignName !== "string") {
    throw new BacktestResearchCampaignIndexError(
      "campaign input.campaignName must be a string when present",
    );
  }
  if (!Array.isArray(input.runs)) {
    throw new BacktestResearchCampaignIndexError("campaign input.runs must be an array");
  }

  const seenRunIds = new Set<string>();
  const runs = input.runs
    .map((run, i) => summarizeRun(run, i, seenRunIds))
    .sort((a, b) => compareString(a.runId, b.runId));

  // Aggregate across the campaign.
  let totalArtifactCount = 0;
  let totalKnownArtifactCount = 0;
  let totalUnknownArtifactCount = 0;
  let totalMalformedArtifactCount = 0;
  let validRunCount = 0;
  const runsNeedingAttention: string[] = [];
  const kindMap = new Map<string, number>();
  const schemaSet = new Set<string>();
  for (const run of runs) {
    totalArtifactCount += run.artifactCount;
    totalKnownArtifactCount += run.knownArtifactCount;
    totalUnknownArtifactCount += run.unknownArtifactCount;
    totalMalformedArtifactCount += run.malformedArtifactCount;
    if (run.valid) validRunCount += 1;
    else runsNeedingAttention.push(run.runId);
    for (const k of run.kindCounts) kindMap.set(k.kind, (kindMap.get(k.kind) ?? 0) + k.count);
    for (const sv of run.schemaVersions) schemaSet.add(sv);
  }
  const invalidRunCount = runs.length - validRunCount;
  runsNeedingAttention.sort(compareString);
  const aggregateKindCounts: BacktestArtifactKindCount[] = [...kindMap.entries()]
    .map(([kind, count]) => ({ kind: kind as BacktestArtifactKind, count }))
    .sort((a, b) => compareString(a.kind, b.kind));
  const aggregateSchemaVersions = [...schemaSet].sort(compareString);

  const campaignDigest = buildBacktestResearchCampaignDigest(runs);

  const warnings: string[] = [];
  if (runs.length === 0) {
    warnings.push(
      "the campaign indexes no runs — the campaign directory has no run subdirectories.",
    );
  }
  if (invalidRunCount > 0) {
    warnings.push(
      `${invalidRunCount} of ${runs.length} run(s) need attention (unknown, malformed, drift, incomplete, or unsummarizable).`,
    );
  }
  if (totalMalformedArtifactCount > 0) {
    warnings.push(
      `${totalMalformedArtifactCount} artifact(s) across the campaign were unparseable JSON (malformed).`,
    );
  }

  const notes = [
    `${runs.length} run(s): ${validRunCount} valid, ${invalidRunCount} need attention.`,
    `${totalArtifactCount} artifact(s) across the campaign (${totalKnownArtifactCount} recognized, ${totalUnknownArtifactCount} unknown, ${totalMalformedArtifactCount} malformed).`,
    `Campaign digest ${campaignDigest} fingerprints the sorted run digests + stable metadata; compare two campaigns by it.`,
    "The campaign digest is a non-cryptographic, reproducibility-only fingerprint — re-runnable, not anti-tamper.",
    "This index summarizes local run directories only; it embeds no artifact contents and is not a live result or advice.",
  ];

  return {
    schemaVersion: BACKTEST_RESEARCH_CAMPAIGN_INDEX_SCHEMA_VERSION,
    banner: BACKTEST_RESEARCH_CAMPAIGN_INDEX_BANNER,
    paperOnly: true,
    simulated: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    disclaimers: [...BACKTEST_RESEARCH_CAMPAIGN_INDEX_DISCLAIMERS],
    digestAlgorithm: BACKTEST_RESEARCH_CAMPAIGN_DIGEST_ALGORITHM,
    campaignName: input.campaignName ?? null,
    campaignDigest,
    runCount: runs.length,
    validRunCount,
    invalidRunCount,
    totalArtifactCount,
    totalKnownArtifactCount,
    totalUnknownArtifactCount,
    totalMalformedArtifactCount,
    runsNeedingAttention,
    aggregateKindCounts,
    aggregateSchemaVersions,
    runs,
    warnings,
    notes,
  };
}

// --- validation (backstop) ---------------------------------------------------

/** Strictly validate one run summary in-place (shared by the index validator). */
function validateRunSummary(value: unknown, where: string): void {
  if (!isObject(value)) {
    throw new BacktestResearchCampaignIndexError(`${where} must be an object`);
  }
  if (!nonEmptyString(value.runId)) {
    throw new BacktestResearchCampaignIndexError(`${where}.runId must be a non-empty string`);
  }
  if (value.runDigest !== null && !nonEmptyString(value.runDigest)) {
    throw new BacktestResearchCampaignIndexError(`${where}.runDigest must be a non-empty string or null`);
  }
  for (const f of [
    "valid",
    "complete",
    "recognized",
    "stable",
    "bundleCandidateValid",
    "manifestPresent",
    "inSync",
    "driftDetected",
  ] as const) {
    if (typeof value[f] !== "boolean") {
      throw new BacktestResearchCampaignIndexError(`${where}.${f} must be a boolean`);
    }
  }
  for (const f of [
    "artifactCount",
    "knownArtifactCount",
    "unknownArtifactCount",
    "malformedArtifactCount",
  ] as const) {
    if (!isNonNegativeInteger(value[f])) {
      throw new BacktestResearchCampaignIndexError(`${where}.${f} must be a non-negative integer`);
    }
  }
  if ((value.malformedArtifactCount as number) > (value.unknownArtifactCount as number)) {
    throw new BacktestResearchCampaignIndexError(
      `${where}.malformedArtifactCount must not exceed unknownArtifactCount`,
    );
  }
  if (
    (value.knownArtifactCount as number) + (value.unknownArtifactCount as number) !==
    (value.artifactCount as number)
  ) {
    throw new BacktestResearchCampaignIndexError(
      `${where}.knownArtifactCount + unknownArtifactCount must equal artifactCount`,
    );
  }
  if (!nonEmptyString(value.recommendedAction)) {
    throw new BacktestResearchCampaignIndexError(`${where}.recommendedAction must be a non-empty string`);
  }
  if (value.buildError !== null && typeof value.buildError !== "string") {
    throw new BacktestResearchCampaignIndexError(`${where}.buildError must be a string or null`);
  }
  if (!Array.isArray(value.kindCounts)) {
    throw new BacktestResearchCampaignIndexError(`${where}.kindCounts must be an array`);
  }
  (value.kindCounts as unknown[]).forEach((k, i) => {
    if (
      !isObject(k) ||
      typeof k.kind !== "string" ||
      !ARTIFACT_KIND_SET.has(k.kind) ||
      !isNonNegativeInteger(k.count)
    ) {
      throw new BacktestResearchCampaignIndexError(`${where}.kindCounts[${i}] must be a {kind,count} entry`);
    }
  });
  for (const key of ["schemaVersions", "warnings"] as const) {
    if (!Array.isArray(value[key])) {
      throw new BacktestResearchCampaignIndexError(`${where}.${key} must be an array`);
    }
    (value[key] as unknown[]).forEach((s, i) => {
      if (typeof s !== "string") {
        throw new BacktestResearchCampaignIndexError(`${where}.${key}[${i}] must be a string`);
      }
    });
  }
}

/**
 * Strictly validate a value as a {@link BacktestResearchCampaignIndex} and return it narrowed. A
 * backstop mirroring the other validators: checks the schema version, the required PAPER-ONLY
 * labelling, the disclaimers, the campaign digest + algorithm label, the counts (and their
 * internal consistency), the aggregate kind/schema shapes, and every run summary. Throws
 * {@link BacktestResearchCampaignIndexError} on the first problem. Pure.
 */
export function validateBacktestResearchCampaignIndex(value: unknown): BacktestResearchCampaignIndex {
  if (!isObject(value)) {
    throw new BacktestResearchCampaignIndexError("campaign index must be a JSON object");
  }
  if (value.schemaVersion !== BACKTEST_RESEARCH_CAMPAIGN_INDEX_SCHEMA_VERSION) {
    throw new BacktestResearchCampaignIndexError(
      `campaign index.schemaVersion must be "${BACKTEST_RESEARCH_CAMPAIGN_INDEX_SCHEMA_VERSION}"`,
    );
  }
  if (value.banner !== BACKTEST_RESEARCH_CAMPAIGN_INDEX_BANNER) {
    throw new BacktestResearchCampaignIndexError(
      `campaign index.banner must be "${BACKTEST_RESEARCH_CAMPAIGN_INDEX_BANNER}"`,
    );
  }
  for (const flag of [
    "paperOnly",
    "simulated",
    "notLiveResult",
    "notFinancialAdvice",
    "notProfitabilityClaim",
  ] as const) {
    if (value[flag] !== true) {
      throw new BacktestResearchCampaignIndexError(`campaign index.${flag} must be true`);
    }
  }
  if (!Array.isArray(value.disclaimers) || value.disclaimers.length === 0) {
    throw new BacktestResearchCampaignIndexError("campaign index.disclaimers must be a non-empty array");
  }
  if (!nonEmptyString(value.digestAlgorithm)) {
    throw new BacktestResearchCampaignIndexError("campaign index.digestAlgorithm must be a non-empty string");
  }
  if (!nonEmptyString(value.campaignDigest)) {
    throw new BacktestResearchCampaignIndexError("campaign index.campaignDigest must be a non-empty string");
  }
  if (value.campaignName !== null && typeof value.campaignName !== "string") {
    throw new BacktestResearchCampaignIndexError("campaign index.campaignName must be a string or null");
  }
  for (const f of [
    "runCount",
    "validRunCount",
    "invalidRunCount",
    "totalArtifactCount",
    "totalKnownArtifactCount",
    "totalUnknownArtifactCount",
    "totalMalformedArtifactCount",
  ] as const) {
    if (!isNonNegativeInteger(value[f])) {
      throw new BacktestResearchCampaignIndexError(`campaign index.${f} must be a non-negative integer`);
    }
  }
  if ((value.validRunCount as number) + (value.invalidRunCount as number) !== (value.runCount as number)) {
    throw new BacktestResearchCampaignIndexError(
      "campaign index.validRunCount + invalidRunCount must equal runCount",
    );
  }
  if (
    (value.totalKnownArtifactCount as number) + (value.totalUnknownArtifactCount as number) !==
    (value.totalArtifactCount as number)
  ) {
    throw new BacktestResearchCampaignIndexError(
      "campaign index.totalKnownArtifactCount + totalUnknownArtifactCount must equal totalArtifactCount",
    );
  }
  for (const key of ["runsNeedingAttention", "aggregateSchemaVersions", "warnings", "notes"] as const) {
    if (!Array.isArray(value[key])) {
      throw new BacktestResearchCampaignIndexError(`campaign index.${key} must be an array`);
    }
  }
  (value.runsNeedingAttention as unknown[]).forEach((r, i) => {
    if (!nonEmptyString(r)) {
      throw new BacktestResearchCampaignIndexError(`campaign index.runsNeedingAttention[${i}] must be a non-empty string`);
    }
  });
  (value.aggregateSchemaVersions as unknown[]).forEach((s, i) => {
    if (!nonEmptyString(s)) {
      throw new BacktestResearchCampaignIndexError(`campaign index.aggregateSchemaVersions[${i}] must be a non-empty string`);
    }
  });
  if (!Array.isArray(value.aggregateKindCounts)) {
    throw new BacktestResearchCampaignIndexError("campaign index.aggregateKindCounts must be an array");
  }
  (value.aggregateKindCounts as unknown[]).forEach((k, i) => {
    if (
      !isObject(k) ||
      typeof k.kind !== "string" ||
      !ARTIFACT_KIND_SET.has(k.kind) ||
      !isNonNegativeInteger(k.count)
    ) {
      throw new BacktestResearchCampaignIndexError(`campaign index.aggregateKindCounts[${i}] must be a {kind,count} entry`);
    }
  });
  if (!Array.isArray(value.runs)) {
    throw new BacktestResearchCampaignIndexError("campaign index.runs must be an array");
  }
  if ((value.runs as unknown[]).length !== (value.runCount as number)) {
    throw new BacktestResearchCampaignIndexError("campaign index.runs length must equal runCount");
  }
  (value.runs as unknown[]).forEach((r, i) => validateRunSummary(r, `campaign index.runs[${i}]`));
  return value as unknown as BacktestResearchCampaignIndex;
}

// --- human formatter ---------------------------------------------------------

/** Options for {@link formatBacktestResearchCampaignIndex}. */
export interface FormatBacktestResearchCampaignIndexOptions {
  /** Optional label (e.g. the campaign directory) echoed into the header. */
  label?: string;
  /** Cap on the number of per-run rows printed (default 100; the rest are summarized). */
  maxRunRows?: number;
}

function runVerdict(run: BacktestResearchCampaignRunSummary): string {
  if (run.buildError !== null) return "ERROR";
  return run.valid ? "valid" : "attention";
}

/**
 * Render a stable, human-readable campaign index. Deterministic and path-stable (no timestamps).
 * Leads with the PAPER-ONLY banner and the top-level campaign digest, lists each run's verdict +
 * run digest + counts, surfaces the runs needing attention and the aggregate kind/schema sets,
 * and closes with the not-live / not-advice / not-a-profitability-claim disclaimers and the honest
 * non-cryptographic-digest note. Long run lists are summarized (never an unsafe raw dump).
 */
export function formatBacktestResearchCampaignIndex(
  index: BacktestResearchCampaignIndex,
  opts: FormatBacktestResearchCampaignIndexOptions = {},
): string {
  const maxRows = opts.maxRunRows ?? 100;
  const title = index.campaignName ?? "research campaign";
  const header = `${index.banner} — ${title} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];

  if (opts.label) lines.push(`dir:            ${opts.label}`);
  lines.push(`campaign:       ${index.campaignName ?? "(unnamed)"}`);
  lines.push(`campaignDigest: ${index.campaignDigest}`);
  lines.push(`runs:           ${index.runCount} (${index.validRunCount} valid, ${index.invalidRunCount} need attention)`);
  lines.push(
    `artifacts:      ${index.totalArtifactCount} (${index.totalKnownArtifactCount} known, ` +
      `${index.totalUnknownArtifactCount} unknown, ${index.totalMalformedArtifactCount} malformed)`,
  );
  lines.push(`digest:         ${index.digestAlgorithm}`);

  lines.push("");
  lines.push("Runs:");
  if (index.runs.length === 0) {
    lines.push("- (none)");
  } else {
    const shown = index.runs.slice(0, maxRows);
    for (const run of shown) {
      const digest = run.runDigest ?? "(none)";
      lines.push(
        `- ${run.runId} [${runVerdict(run)}]  ${digest}  ` +
          `${run.artifactCount} artifact(s) (${run.unknownArtifactCount} unknown, ${run.malformedArtifactCount} malformed)`,
      );
    }
    const hidden = index.runs.length - shown.length;
    if (hidden > 0) lines.push(`- … and ${hidden} more (summarized; see the index JSON for the full list)`);
  }

  lines.push("");
  lines.push("Needs attention:");
  if (index.runsNeedingAttention.length === 0) lines.push("- (none)");
  else for (const r of index.runsNeedingAttention) lines.push(`- ${r}`);

  lines.push("");
  lines.push("Aggregate kinds:");
  if (index.aggregateKindCounts.length === 0) lines.push("- (none)");
  else for (const k of index.aggregateKindCounts) lines.push(`- ${k.kind}: ${k.count}`);

  lines.push("");
  lines.push("Aggregate schemas:");
  if (index.aggregateSchemaVersions.length === 0) lines.push("- (none)");
  else for (const s of index.aggregateSchemaVersions) lines.push(`- ${s}`);

  if (index.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of index.warnings) lines.push(`- ${w}`);
  }

  lines.push("");
  lines.push("Notes:");
  for (const note of index.notes) lines.push(`- ${note}`);
  lines.push("");
  for (const d of index.disclaimers) lines.push(d);
  return lines.join("\n");
}
