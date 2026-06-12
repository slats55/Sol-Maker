/**
 * Jupiter recent-tokens adapter (read-only LIVE candidate source).
 *
 * Polls the public `GET /tokens/v2/recent` endpoint of the free Jupiter lite tier (verified live
 * during Sprint 92) — a feed of tokens that recently became visible to Jupiter's indexer,
 * including launchpad tokens (e.g. pump.fun). Each poll returns a bounded, normalized batch.
 *
 * Honesty rules mirror the quote fetcher: provider problems map onto the closed status set and
 * never throw; an item that cannot be normalized safely (bad mint, secret-shaped label) is
 * DROPPED, never half-trusted; every market figure stays a provider-reported HINT.
 */

import { createHash } from "node:crypto";
import { redactString } from "@soulmaker/security";
import { parseMintAddress } from "@soulmaker/sniper";
import {
  CANDIDATE_OBSERVATION_CAVEATS,
  type CandidateObservation,
  type CandidateSourceAdapter,
  type CandidateSourceMetadata,
  type CandidateSourceResult,
  type FetchLike,
} from "./types.js";

export const JUPITER_RECENT_PROVIDER_ID = "jupiter-recent-tokens";
export const JUPITER_RECENT_BASE_URL = "https://lite-api.jup.ag/tokens/v2";

/** Hard ceiling on observations per poll (the feed itself returns ~30–100). */
export const MAX_OBSERVATIONS_PER_POLL = 50;

export interface JupiterRecentAdapterOptions {
  baseUrl?: string;
  fetchLike?: FetchLike;
  clock?: () => string;
  timeoutMs?: number;
}

interface RecentTokenItem {
  id?: unknown;
  name?: unknown;
  symbol?: unknown;
  launchpad?: unknown;
  liquidity?: unknown;
  mcap?: unknown;
  holderCount?: unknown;
}

function endpointHostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return redactString(url);
  }
}

function boundedLabel(value: unknown, max = 64): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  if (trimmed.length === 0) return null;
  if (redactString(trimmed) !== trimmed) return null;
  return trimmed;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Deterministic candidate id from a mint (stable across polls and sessions). */
export function candidateIdForMint(mint: string): string {
  return `rt-${mint.slice(0, 8).toLowerCase()}`;
}

function defaultFetch(): FetchLike {
  const f = (globalThis as { fetch?: unknown }).fetch;
  if (typeof f !== "function") {
    throw new Error("global fetch is unavailable; inject fetchLike explicitly");
  }
  return f as FetchLike;
}

/** Normalize one feed item; null when it cannot be trusted (dropped, never guessed). */
export function normalizeRecentTokenItem(
  item: unknown,
  observedAtLabel: string,
): CandidateObservation | null {
  if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
  const t = item as RecentTokenItem;
  let mint: string;
  try {
    mint = parseMintAddress(t.id);
  } catch {
    return null;
  }
  return {
    candidateId: candidateIdForMint(mint),
    mint,
    symbol: boundedLabel(t.symbol, 16),
    name: boundedLabel(t.name, 64),
    sourceProviderId: JUPITER_RECENT_PROVIDER_ID,
    sourceKind: "live",
    observedAtLabel,
    launchpadLabel: boundedLabel(t.launchpad, 32),
    liquidityUsdHint: finiteNumber(t.liquidity),
    marketCapUsdHint: finiteNumber(t.mcap),
    holderCountHint: finiteNumber(t.holderCount),
    caveats: [...CANDIDATE_OBSERVATION_CAVEATS],
  };
}

/** Build the read-only Jupiter recent-tokens adapter. */
export function createJupiterRecentAdapter(
  options: JupiterRecentAdapterOptions = {},
): CandidateSourceAdapter {
  const baseUrl = (options.baseUrl ?? JUPITER_RECENT_BASE_URL).replace(/\/+$/, "");
  const fetchLike = options.fetchLike ?? defaultFetch();
  const clock = options.clock ?? ((): string => new Date().toISOString());
  const timeoutMs = options.timeoutMs ?? 10_000;
  const endpointHost = endpointHostOf(baseUrl);

  async function fetchOnce(): Promise<CandidateSourceResult> {
    const fetchedAt = clock();
    const metadata: CandidateSourceMetadata = {
      providerId: JUPITER_RECENT_PROVIDER_ID,
      endpointHost,
      fetchedAt,
      httpStatus: null,
      responseSha256_128: null,
      statusDetail: null,
    };

    let httpStatus: number;
    let ok: boolean;
    let body: string;
    try {
      const response = await fetchLike(`${baseUrl}/recent`, { signal: AbortSignal.timeout(timeoutMs) });
      httpStatus = response.status;
      ok = response.ok;
      body = await response.text();
    } catch (err) {
      metadata.statusDetail = `feed unreachable (network error or ${timeoutMs}ms timeout): ${redactString((err as Error).message ?? "unknown")}`.slice(0, 200);
      return { status: "unavailable", observations: [], metadata };
    }

    metadata.httpStatus = httpStatus;
    metadata.responseSha256_128 = createHash("sha256").update(body).digest("hex").slice(0, 32);

    if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) {
      metadata.statusDetail = `feed refused access (HTTP ${httpStatus}) — rate limit or auth wall; reported honestly`;
      return { status: "blocked", observations: [], metadata };
    }
    if (!ok) {
      metadata.statusDetail = `feed returned HTTP ${httpStatus}`;
      return { status: "error", observations: [], metadata };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      metadata.statusDetail = "feed returned a non-JSON body — unsupported response format";
      return { status: "unsupported", observations: [], metadata };
    }
    if (!Array.isArray(parsed)) {
      metadata.statusDetail = "feed response is not an array — unsupported shape";
      return { status: "unsupported", observations: [], metadata };
    }

    const observations: CandidateObservation[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (observations.length >= MAX_OBSERVATIONS_PER_POLL) break;
      const obs = normalizeRecentTokenItem(item, fetchedAt);
      if (obs === null || seen.has(obs.mint)) continue;
      seen.add(obs.mint);
      observations.push(obs);
    }
    return { status: "observed", observations, metadata };
  }

  return Object.freeze({
    providerId: JUPITER_RECENT_PROVIDER_ID,
    sourceKind: "live" as const,
    endpointHost,
    fetchOnce,
  });
}
