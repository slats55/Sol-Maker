/**
 * The realtime candidate SNAPSHOT (`realtime.candidates.snapshot.v1`, Sprint 92).
 *
 * Folds one poll of a candidate source into an artifact that (a) records provenance honestly and
 * (b) embeds a candidates block the EXISTING sniper pipeline accepts verbatim — so a watched feed
 * flows into intake → preflight → risk → paper decision with zero new schemas downstream.
 *
 * A snapshot can never claim execution capability: literals are pinned, the status set is
 * closed, and the embedded candidates are observations with caveats.
 */

import { redactString } from "@soulmaker/security";
import { normalizeSniperCandidateList, type SniperCandidateList } from "@soulmaker/sniper";
import type { CandidateObservation, CandidateSourceResult, CandidateSourceStatus } from "./types.js";

export const REALTIME_SNAPSHOT_SCHEMA_VERSION = "realtime.candidates.snapshot.v1";

export const REALTIME_SNAPSHOT_BANNER =
  "REAL-TIME CANDIDATE SNAPSHOT — read-only observations from a public feed or replay file; never an order, never a trade, never live-trading readiness.";

export const REALTIME_SNAPSHOT_CAVEATS: readonly string[] = [
  "A watched candidate is an OBSERVATION that feeds the PAPER pipeline — nothing here executes.",
  "Market figures are provider-reported HINTS (unverified); run token:inspect/token:risk before any paper decision.",
  "Watching can never trigger an order: no wallet, no keys, no signing, no sending exist in this layer.",
  "A snapshot is a point-in-time record; the feed has already moved on.",
];

export interface RealtimeSnapshotFilterOptions {
  /** Keep at most this many observations (after filtering; default 25). */
  limit?: number;
  /** Drop observations whose liquidity hint is missing or below this (USD). */
  minLiquidityUsdHint?: number;
}

export interface RealtimeCandidatesSnapshot {
  schemaVersion: string;
  banner: string;
  paperOnly: true;
  readOnly: true;
  watchOnly: true;
  notExecutable: true;
  notLiveResult: true;
  notFinancialAdvice: true;
  notProfitabilityClaim: true;
  neverSigns: true;
  neverSends: true;
  neverTrades: true;
  phase7LiveTradingReady: false;
  providerId: string;
  sourceKind: "live" | "replay";
  endpointHost: string;
  fetchedAt: string;
  status: CandidateSourceStatus;
  statusDetail: string | null;
  observedCount: number;
  keptCount: number;
  droppedByFilterCount: number;
  observations: CandidateObservation[];
  /** A canonical sniper.candidate.list.v1 built from the kept observations (may be empty). */
  candidateList: SniperCandidateList | null;
  caveats: string[];
  warnings: string[];
}

/** Convert kept observations into the canonical sniper candidate list (the intake contract). */
export function observationsToCandidateList(
  observations: CandidateObservation[],
  sourceLabel: string,
): SniperCandidateList {
  return normalizeSniperCandidateList({
    sourceLabel,
    allowEmpty: true,
    candidates: observations.map((obs) => ({
      candidateId: obs.candidateId,
      mint: obs.mint,
      symbol: obs.symbol ?? undefined,
      name: obs.name ?? undefined,
      sourceTag: obs.sourceProviderId,
      sourceNote:
        obs.sourceKind === "replay"
          ? "replayed observation — NOT live market data"
          : `observed live at ${obs.observedAtLabel}`,
      observedLiquidityUsd: obs.liquidityUsdHint ?? undefined,
      observedMarketCapUsd: obs.marketCapUsdHint ?? undefined,
      observedAtLabel: obs.observedAtLabel,
      tags: obs.launchpadLabel !== null ? [obs.launchpadLabel] : [],
    })),
  });
}

/** Fold one poll result into the snapshot artifact (pure given the result). */
export function buildRealtimeCandidatesSnapshot(
  result: CandidateSourceResult,
  sourceKind: "live" | "replay",
  options: RealtimeSnapshotFilterOptions = {},
): RealtimeCandidatesSnapshot {
  const limit = options.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error("snapshot limit must be an integer between 1 and 50");
  }
  const minLiquidity = options.minLiquidityUsdHint;
  if (minLiquidity !== undefined && (!Number.isFinite(minLiquidity) || minLiquidity < 0)) {
    throw new Error("minLiquidityUsdHint must be a non-negative number");
  }

  const filtered =
    minLiquidity === undefined
      ? result.observations
      : result.observations.filter((o) => o.liquidityUsdHint !== null && o.liquidityUsdHint >= minLiquidity);
  const kept = filtered.slice(0, limit);

  const warnings: string[] = [];
  if (result.status !== "observed") {
    warnings.push(`poll status ${result.status}: ${result.metadata.statusDetail ?? "no detail"}`);
  }
  if (result.observations.length > kept.length) {
    warnings.push(
      `filters kept ${kept.length} of ${result.observations.length} observations ` +
        `(liquidity floor + limit) — dropped candidates are counted, never hidden`,
    );
  }

  const candidateList =
    kept.length > 0
      ? observationsToCandidateList(
          kept,
          `realtime snapshot from ${result.metadata.providerId} (${sourceKind}) at ${result.metadata.fetchedAt}`,
        )
      : null;

  return {
    schemaVersion: REALTIME_SNAPSHOT_SCHEMA_VERSION,
    banner: REALTIME_SNAPSHOT_BANNER,
    paperOnly: true,
    readOnly: true,
    watchOnly: true,
    notExecutable: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    neverSigns: true,
    neverSends: true,
    neverTrades: true,
    phase7LiveTradingReady: false,
    providerId: result.metadata.providerId,
    sourceKind,
    endpointHost: result.metadata.endpointHost,
    fetchedAt: result.metadata.fetchedAt,
    status: result.status,
    statusDetail: result.metadata.statusDetail,
    observedCount: result.observations.length,
    keptCount: kept.length,
    droppedByFilterCount: result.observations.length - kept.length,
    observations: kept,
    candidateList,
    caveats: [...REALTIME_SNAPSHOT_CAVEATS],
    warnings: warnings.map((w) => redactString(w).slice(0, 300)),
  };
}

/** Human-readable, redacted text summary of a snapshot. */
export function formatRealtimeCandidatesSnapshot(snapshot: RealtimeCandidatesSnapshot): string {
  const lines: string[] = [];
  lines.push(snapshot.banner);
  lines.push("");
  lines.push(`provider:   ${snapshot.providerId} (${snapshot.sourceKind}; ${snapshot.endpointHost})`);
  lines.push(`fetched at: ${snapshot.fetchedAt}`);
  lines.push(`status:     ${snapshot.status}${snapshot.statusDetail !== null ? ` — ${snapshot.statusDetail}` : ""}`);
  lines.push(`kept:       ${snapshot.keptCount} of ${snapshot.observedCount} observed`);
  lines.push("");
  for (const obs of snapshot.observations) {
    const liq = obs.liquidityUsdHint !== null ? ` liq~$${obs.liquidityUsdHint.toFixed(0)}` : "";
    const pad = obs.launchpadLabel !== null ? ` [${obs.launchpadLabel}]` : "";
    lines.push(`  - ${obs.candidateId} ${obs.symbol ?? "?"}${pad}${liq} (${obs.mint})`);
  }
  if (snapshot.warnings.length > 0) {
    lines.push("");
    lines.push("warnings:");
    for (const w of snapshot.warnings) lines.push(`  - ${w}`);
  }
  lines.push("");
  for (const caveat of snapshot.caveats) lines.push(`CAVEAT: ${caveat}`);
  return redactString(lines.join("\n"));
}
