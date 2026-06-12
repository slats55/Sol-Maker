/**
 * @soulmaker/routequote — read-only route-quote OBSERVATION layer (Sprint 91).
 *
 * Validates operator-supplied quote observation files and prepares label-only route provenance
 * for the PAPER dry-run chain via the S85 route-resolution contract. Structurally incapable of
 * executing anything: no wallet, no keys, no signing, no sending, no transaction construction,
 * no swap execution, no network — pure data validation over LOCAL values only.
 */

export {
  ROUTE_QUOTE_OBSERVATION_INPUT_SCHEMA_VERSION,
  ROUTE_QUOTE_STATUSES,
  ROUTE_QUOTE_MAX_LABEL_LENGTH,
  RouteQuoteError,
  safeQuoteLabel,
  validateRouteQuoteObservationInput,
} from "./observation.js";
export type { RouteQuoteObservationInput, RouteQuoteStatus } from "./observation.js";

export {
  ROUTE_QUOTE_PREPARED_SCHEMA_VERSION,
  ROUTE_QUOTE_PREPARED_BANNER,
  ROUTE_QUOTE_RESOLVER_ID,
  ROUTE_QUOTE_CAVEATS,
  ROUTE_QUOTE_PREPARED_DISCLAIMERS,
  deriveRouteQuoteLabel,
  normalizeRouteQuotePrepared,
  validateRouteQuotePrepared,
  toRouteQuoteFacts,
  formatRouteQuotePrepared,
} from "./prepared.js";
export type {
  RouteQuotePrepared,
  RouteQuotePreparedEntry,
  NormalizeRouteQuotePreparedInput,
  RouteQuoteFactEntry,
  RouteQuoteFacts,
  FormatRouteQuotePreparedOptions,
} from "./prepared.js";
