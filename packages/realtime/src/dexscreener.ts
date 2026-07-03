/**
 * DexScreener token-profiles adapter (read-only LIVE candidate source, Sprint 109).
 *
 * Polls the public, keyless `GET /token-profiles/latest/v1` endpoint of DexScreener — a feed of
 * tokens whose teams recently published a profile. It is a REAL second discovery signal that is
 * independent of Jupiter's indexer; it skews toward tokens paying for attention, which is exactly
 * the memecoin surface the sniper watches. Honest limits, stated up front:
 *
 *   - The profile feed carries NO liquidity / market-cap / holder figures — those hints stay null
 *     (reported as missing downstream), never guessed.
 *   - Only `chainId === "solana"` entries are considered; other chains are skipped.
 *   - The same closed status set as every adapter: provider problems NEVER throw
 *     (unreachable → `unavailable`; 401/403/429 → `blocked`; other non-2xx → `error`;
 *     unusable body → `unsupported`). An item that cannot be normalized safely is DROPPED.
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

export const DEXSCREENER_PROVIDER_ID = "dexscreener-token-profiles";
export const DEXSCREENER_BASE_URL = "https://api.dexscreener.com";

/** Hard ceiling on observations per poll (the endpoint returns a few dozen). */
export const DEXSCREENER_MAX_OBSERVATIONS_PER_POLL = 50;

export interface DexscreenerAdapterOptions {
  baseUrl?: string;
  fetchLike?: FetchLike;
  clock?: () => string;
  timeoutMs?: number;
}

interface TokenProfileItem {
  chainId?: unknown;
  tokenAddress?: unknown;
  description?: unknown;
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

function defaultFetch(): FetchLike {
  const f = (globalThis as { fetch?: unknown }).fetch;
  if (typeof f !== "function") {
    throw new Error("global fetch is unavailable; inject fetchLike explicitly");
  }
  return f as FetchLike;
}

/** Deterministic candidate id from a mint (distinct namespace from the jupiter adapter). */
export function dexscreenerCandidateIdForMint(mint: string): string {
  return `ds-${mint.slice(0, 8).toLowerCase()}`;
}

/** Normalize one profile item; null when it is not a safe Solana token entry (dropped, never guessed). */
export function normalizeTokenProfileItem(item: unknown, observedAtLabel: string): CandidateObservation | null {
  if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
  const t = item as TokenProfileItem;
  if (t.chainId !== "solana") return null;
  let mint: string;
  try {
    mint = parseMintAddress(t.tokenAddress);
  } catch {
    return null;
  }
  return {
    candidateId: dexscreenerCandidateIdForMint(mint),
    mint,
    // The profiles feed does not carry a symbol/name; the description is a team-authored blurb,
    // bounded and used as the display NAME hint only (never a market fact).
    symbol: null,
    name: boundedLabel(t.description, 64),
    sourceProviderId: DEXSCREENER_PROVIDER_ID,
    sourceKind: "live",
    observedAtLabel,
    launchpadLabel: null,
    liquidityUsdHint: null,
    marketCapUsdHint: null,
    holderCountHint: null,
    caveats: [...CANDIDATE_OBSERVATION_CAVEATS],
  };
}

/** Build the read-only DexScreener token-profiles adapter. */
export function createDexscreenerAdapter(options: DexscreenerAdapterOptions = {}): CandidateSourceAdapter {
  const baseUrl = (options.baseUrl ?? DEXSCREENER_BASE_URL).replace(/\/+$/, "");
  const fetchLike = options.fetchLike ?? defaultFetch();
  const clock = options.clock ?? ((): string => new Date().toISOString());
  const timeoutMs = options.timeoutMs ?? 10_000;
  const endpointHost = endpointHostOf(baseUrl);

  async function fetchOnce(): Promise<CandidateSourceResult> {
    const fetchedAt = clock();
    const metadata: CandidateSourceMetadata = {
      providerId: DEXSCREENER_PROVIDER_ID,
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
      const response = await fetchLike(`${baseUrl}/token-profiles/latest/v1`, { signal: AbortSignal.timeout(timeoutMs) });
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
      if (observations.length >= DEXSCREENER_MAX_OBSERVATIONS_PER_POLL) break;
      const obs = normalizeTokenProfileItem(item, fetchedAt);
      if (obs === null || seen.has(obs.mint)) continue;
      seen.add(obs.mint);
      observations.push(obs);
    }
    return { status: "observed", observations, metadata };
  }

  return Object.freeze({
    providerId: DEXSCREENER_PROVIDER_ID,
    sourceKind: "live" as const,
    endpointHost,
    fetchOnce,
  });
}
