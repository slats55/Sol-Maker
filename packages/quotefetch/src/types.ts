/**
 * Shared types for the read-only quote FETCHER boundary (Sprint 92).
 *
 * This package implements the adapter layer that S89/S91 deliberately deferred: a real,
 * network-reading quote fetcher. The contract is deliberately narrow:
 *
 *   - Every fetch outcome — success or failure — normalizes into the EXISTING
 *     `routequote.observation.input.v1` schema (validated through @soulmaker/routequote before it
 *     ever leaves this package), so the S91 prepare/dry-run chain consumes fetched quotes with
 *     ZERO schema changes.
 *   - Freshness/provenance metadata (real fetch timestamp, HTTP status, context slot, price
 *     impact, response digest) lives in a SEPARATE fetch report — never smuggled into the
 *     observation as fake operator labels beyond the honest `observedAtLabel` timestamp.
 *   - The outcome set is CLOSED and identical to the observation statuses: `quote-observed`,
 *     `unavailable`, `blocked`, `error`, `unsupported`. Nothing here can mean "executable".
 *
 * There are no types for signers, secret keys, transactions, or sending — by design.
 */

import type { RouteQuoteObservationInput, RouteQuoteStatus } from "@soulmaker/routequote";

/** What a provider adapter is asked to quote: ONE candidate mint as the swap OUTPUT. */
export interface QuoteFetchRequest {
  /** The candidate mint being evaluated (the swap OUTPUT mint). Validated base58. */
  candidateMint: string;
  /** The swap INPUT mint (e.g. wrapped SOL). Validated base58. */
  inputMint: string;
  /** Input amount in RAW base units (integer string; never a float, never parsed as money). */
  amountRaw: string;
  /** Requested slippage tolerance in basis points (integer, 0..10000). */
  slippageBps: number;
}

/**
 * Freshness + provenance facts about ONE fetch attempt. These are REAL metadata (wall-clock
 * timestamp, HTTP status), so they live beside — never inside — the deterministic artifacts.
 */
export interface QuoteFetchMetadata {
  /** Which adapter produced this (kebab-case, e.g. "jupiter-lite-api"). */
  providerId: string;
  /** Display-safe host of the provider endpoint (never a full URL / api key). */
  endpointHost: string;
  /** REAL ISO-8601 timestamp of the fetch attempt (injected clock; honest provenance). */
  fetchedAt: string;
  /** HTTP status of the provider response, or null when the request never completed. */
  httpStatus: number | null;
  /** Provider-reported chain context slot for the quote, when present. */
  contextSlot: number | null;
  /** Provider-reported price impact percent VERBATIM (bounded string; a liquidity-depth signal). */
  priceImpactPct: string | null;
  /** Bounded venue labels from the provider's route plan (display only). */
  routeLabels: string[];
  /** sha256 digest of the raw response body, TRUNCATED to 128 bits (32 hex chars). */
  responseSha256_128: string | null;
  /** Redacted, bounded detail for non-observed outcomes (why it failed). */
  statusDetail: string | null;
}

/** The result of one fetch attempt: a validated observation + honest metadata. */
export interface QuoteFetchResult {
  status: RouteQuoteStatus;
  /**
   * A VALIDATED `routequote.observation.input.v1` value — the exact shape
   * `paper:routequote:prepare` accepts. Present for every outcome (failures carry the honest
   * non-observed status + reason).
   */
  observation: RouteQuoteObservationInput;
  metadata: QuoteFetchMetadata;
}

/** A read-only quote provider adapter. Fetches quotes; structurally cannot execute them. */
export interface QuoteProviderAdapter {
  /** Stable kebab-case provider id (e.g. "jupiter-lite-api"). */
  readonly providerId: string;
  /** Display-safe endpoint host. */
  readonly endpointHost: string;
  /** Fetch one quote. NEVER throws on provider problems — failures map to closed statuses. */
  fetchQuote(request: QuoteFetchRequest): Promise<QuoteFetchResult>;
}

/**
 * The narrow slice of `fetch` this package depends on. Production passes the global fetch;
 * tests inject a fake so unit tests never touch the network.
 */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
