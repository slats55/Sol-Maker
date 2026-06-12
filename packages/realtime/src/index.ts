/**
 * @soulmaker/realtime — real-time candidate INGESTION (Sprint 92).
 *
 * Watches public new-token feeds (Jupiter recent-tokens first) and replay files, and normalizes
 * observations into the EXISTING sniper candidate-list contract. Watching is read-only
 * observation: structurally incapable of placing an order, signing, or sending anything.
 */

export type {
  CandidateObservation,
  CandidateSourceAdapter,
  CandidateSourceMetadata,
  CandidateSourceResult,
  CandidateSourceStatus,
  FetchLike,
} from "./types.js";
export { CANDIDATE_OBSERVATION_CAVEATS } from "./types.js";

export {
  JUPITER_RECENT_PROVIDER_ID,
  JUPITER_RECENT_BASE_URL,
  MAX_OBSERVATIONS_PER_POLL,
  candidateIdForMint,
  normalizeRecentTokenItem,
  createJupiterRecentAdapter,
} from "./jupiter-recent.js";
export type { JupiterRecentAdapterOptions } from "./jupiter-recent.js";

export { REPLAY_PROVIDER_ID, REPLAY_CAVEAT, createReplayCandidateAdapter } from "./replay.js";

export {
  REALTIME_SNAPSHOT_SCHEMA_VERSION,
  REALTIME_SNAPSHOT_BANNER,
  REALTIME_SNAPSHOT_CAVEATS,
  observationsToCandidateList,
  buildRealtimeCandidatesSnapshot,
  formatRealtimeCandidatesSnapshot,
} from "./snapshot.js";
export type {
  RealtimeCandidatesSnapshot,
  RealtimeSnapshotFilterOptions,
} from "./snapshot.js";
