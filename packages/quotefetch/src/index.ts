/**
 * @soulmaker/quotefetch — the read-only route-quote FETCHER (Sprint 92).
 *
 * The separately-reviewed adapter layer that S89/S91 reserved: real provider quotes over public
 * HTTP, normalized into the EXISTING `routequote.observation.input.v1` contract plus an honest
 * freshness/provenance fetch report (`routequote.fetch.report.v1`).
 *
 * Structurally incapable of executing anything: no wallet, no keys, no signing, no sending, no
 * transaction construction. A fetched quote is an observation, never an order, and can never
 * unblock a blocked chain downstream.
 */

export type {
  QuoteFetchRequest,
  QuoteFetchMetadata,
  QuoteFetchResult,
  QuoteProviderAdapter,
  FetchLike,
} from "./types.js";

export {
  JUPITER_LITE_PROVIDER_ID,
  JUPITER_LITE_BASE_URL,
  createJupiterQuoteAdapter,
  validateQuoteFetchRequest,
} from "./jupiter.js";
export type { JupiterQuoteAdapterOptions } from "./jupiter.js";

export {
  ROUTE_QUOTE_FETCH_REPORT_SCHEMA_VERSION,
  ROUTE_QUOTE_FETCH_REPORT_BANNER,
  ROUTE_QUOTE_FETCH_CAVEATS,
  fetchQuotesForCandidates,
  formatRouteQuoteFetchReport,
} from "./fetch-report.js";
export type {
  RouteQuoteFetchEntry,
  RouteQuoteFetchReport,
  FetchQuotesForCandidatesOptions,
} from "./fetch-report.js";
