/**
 * Shared types for the real-time candidate INGESTION boundary (Sprint 92).
 *
 * A candidate source adapter watches ONE public feed of newly visible tokens and returns
 * normalized observations. The contract is deliberately narrow and honest:
 *
 *   - Watching is OBSERVATION: there is no order type, no trade type, no execution hook —
 *     an observation feeds the existing PAPER candidate pipeline and nothing else.
 *   - `sourceKind` distinguishes a LIVE feed from a REPLAY file; replay data must never be
 *     presented as live market data (the literal rides on every observation).
 *   - Every numeric market fact is a provider-reported HINT (unverified), named `*Hint`.
 *   - The outcome set is CLOSED: `observed`, `unavailable`, `blocked`, `error`, `unsupported`.
 */

/** One normalized candidate observation from a source adapter. */
export interface CandidateObservation {
  /** Deterministic id derived from the mint (stable across polls). */
  candidateId: string;
  /** Validated base58 mint (secret-length input refused upstream). */
  mint: string;
  symbol: string | null;
  name: string | null;
  /** Which adapter produced this (kebab-case). */
  sourceProviderId: string;
  /** LIVE feed vs REPLAY file — replay must never look like live data. */
  sourceKind: "live" | "replay";
  /** ISO timestamp for live observations; the file's own label for replay. */
  observedAtLabel: string;
  /** Launchpad/program label when the provider reports one (e.g. "pump.fun"). */
  launchpadLabel: string | null;
  /** Provider-reported HINTS — unverified, display/filter only. */
  liquidityUsdHint: number | null;
  marketCapUsdHint: number | null;
  holderCountHint: number | null;
  /** Honesty caveats carried on every observation. */
  caveats: string[];
}

/** Closed outcome set for one fetch/poll. Nothing here can mean a trade happened. */
export type CandidateSourceStatus = "observed" | "unavailable" | "blocked" | "error" | "unsupported";

export interface CandidateSourceMetadata {
  providerId: string;
  endpointHost: string;
  /** REAL ISO timestamp of the poll (injected clock). */
  fetchedAt: string;
  httpStatus: number | null;
  /** sha256 digest of the raw response body, TRUNCATED to 128 bits (32 hex chars). */
  responseSha256_128: string | null;
  /** Redacted, bounded detail for non-observed outcomes. */
  statusDetail: string | null;
}

export interface CandidateSourceResult {
  status: CandidateSourceStatus;
  /** Empty unless status is "observed". */
  observations: CandidateObservation[];
  metadata: CandidateSourceMetadata;
}

/** A read-only candidate source adapter. Observes; structurally cannot trade. */
export interface CandidateSourceAdapter {
  readonly providerId: string;
  readonly sourceKind: "live" | "replay";
  readonly endpointHost: string;
  /** One poll. NEVER throws on provider problems — failures map to closed statuses. */
  fetchOnce(): Promise<CandidateSourceResult>;
}

/** The narrow fetch seam (production: global fetch; tests: a fake). */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** The caveats every observation carries, verbatim. */
export const CANDIDATE_OBSERVATION_CAVEATS: readonly string[] = [
  "A watched candidate is an OBSERVATION — never an order, never a trade, never execution.",
  "Market figures are provider-reported HINTS and are unverified; inspect and risk-check before any paper decision.",
  "Watching a feed can never trigger an order: this layer has no wallet, no keys, no signing, no sending.",
];
