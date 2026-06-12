/**
 * Replay candidate adapter (read-only, DETERMINISTIC, clearly labeled).
 *
 * Replays an operator-supplied events value (parsed from a local file by the CLI) as candidate
 * observations. Replay exists for deterministic tests and rehearsals; every observation carries
 * `sourceKind: "replay"` and a replay caveat so it can NEVER be presented as live market data.
 */

import { parseMintAddress } from "@soulmaker/sniper";
import { redactString } from "@soulmaker/security";
import { candidateIdForMint } from "./jupiter-recent.js";
import {
  CANDIDATE_OBSERVATION_CAVEATS,
  type CandidateObservation,
  type CandidateSourceAdapter,
  type CandidateSourceResult,
} from "./types.js";

export const REPLAY_PROVIDER_ID = "replay-file";

/** The extra caveat every replay observation carries, verbatim. */
export const REPLAY_CAVEAT =
  "REPLAY data: these observations were replayed from a local file and are NOT live market data.";

interface ReplayEvent {
  mint?: unknown;
  symbol?: unknown;
  name?: unknown;
  observedAtLabel?: unknown;
  launchpadLabel?: unknown;
  liquidityUsdHint?: unknown;
  marketCapUsdHint?: unknown;
  holderCountHint?: unknown;
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

/**
 * Build a replay adapter over a parsed events value: `{ events: [{ mint, ... }] }`.
 * Malformed events are REFUSED up front (a replay file is operator input, not a feed —
 * a bad file is a mistake to surface, not a provider outage to tolerate).
 */
export function createReplayCandidateAdapter(eventsValue: unknown): CandidateSourceAdapter {
  if (eventsValue === null || typeof eventsValue !== "object" || Array.isArray(eventsValue)) {
    throw new Error("replay file must be a JSON object with an events array");
  }
  const events = (eventsValue as { events?: unknown }).events;
  if (!Array.isArray(events)) {
    throw new Error("replay file must carry an events array");
  }
  if (events.length > 500) {
    throw new Error("replay file carries more than 500 events — bound it");
  }

  const observations: CandidateObservation[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of events.entries()) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`replay events[${index}] must be an object`);
    }
    const event = raw as ReplayEvent;
    let mint: string;
    try {
      mint = parseMintAddress(event.mint);
    } catch (err) {
      throw new Error(`replay events[${index}].mint: ${(err as Error).message}`);
    }
    if (seen.has(mint)) continue;
    seen.add(mint);
    observations.push({
      candidateId: candidateIdForMint(mint),
      mint,
      symbol: boundedLabel(event.symbol, 16),
      name: boundedLabel(event.name, 64),
      sourceProviderId: REPLAY_PROVIDER_ID,
      sourceKind: "replay",
      observedAtLabel: boundedLabel(event.observedAtLabel, 64) ?? "replay-event",
      launchpadLabel: boundedLabel(event.launchpadLabel, 32),
      liquidityUsdHint: finiteNumber(event.liquidityUsdHint),
      marketCapUsdHint: finiteNumber(event.marketCapUsdHint),
      holderCountHint: finiteNumber(event.holderCountHint),
      caveats: [...CANDIDATE_OBSERVATION_CAVEATS, REPLAY_CAVEAT],
    });
  }

  async function fetchOnce(): Promise<CandidateSourceResult> {
    return {
      status: "observed",
      observations,
      metadata: {
        providerId: REPLAY_PROVIDER_ID,
        endpointHost: "local-replay-file",
        fetchedAt: "replay",
        httpStatus: null,
        responseSha256_128: null,
        statusDetail: null,
      },
    };
  }

  return Object.freeze({
    providerId: REPLAY_PROVIDER_ID,
    sourceKind: "replay" as const,
    endpointHost: "local-replay-file",
    fetchOnce,
  });
}
