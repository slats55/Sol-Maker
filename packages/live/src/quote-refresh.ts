/**
 * CONTINUOUS QUOTE REFRESH + PROVIDER REDUNDANCY (`live.quote_refresh.state.v1`, Sprint 108, Part 2).
 *
 * A pure reducer over one refresh cycle's quote observations for a single candidate. The caller
 * drives the cadence (a configurable interval) and supplies REAL observations from one or more quote
 * providers (e.g. the existing `@soulmaker/quotefetch` Jupiter adapter as primary, a second as
 * fallback). This module:
 *   - enforces a quote TTL (a stale quote is never `isFresh`),
 *   - selects the best USABLE quote (primary preferred) within the slippage / price-impact caps,
 *   - FAILS CLOSED when every provider is unavailable or every quote is over a cap (no usable quote
 *     → downstream must block the canary; a stale or missing quote can never reach a live action),
 *   - records route changes and per-provider latency.
 *
 * It invents nothing: a missing provider becomes an honest `unavailable`, never a fabricated price.
 * Pure: the caller supplies `nowMs`; no clock, no network, no randomness.
 */

export const LIVE_QUOTE_REFRESH_SCHEMA_VERSION = "live.quote_refresh.state.v1";

export const QUOTE_PROVIDER_ROLES = ["primary", "fallback"] as const;
export type QuoteProviderRole = (typeof QUOTE_PROVIDER_ROLES)[number];

export const QUOTE_OBSERVATION_OUTCOMES = ["observed", "unavailable", "error"] as const;
export type QuoteObservationOutcome = (typeof QUOTE_OBSERVATION_OUTCOMES)[number];

export interface QuoteProviderObservation {
  provider: string;
  role: QuoteProviderRole;
  outcome: QuoteObservationOutcome;
  /** Output amount (raw integer string) — only meaningful when observed. */
  outAmountRaw: string | null;
  priceImpactPct: number | null;
  slippageBps: number | null;
  routeLabels: string[];
  /** When the provider produced the quote (ms epoch). */
  observedAtMs: number;
  /** Round-trip latency of the provider call (ms), if measured. */
  latencyMs: number | null;
}

export const QUOTE_REFRESH_BLOCK_CODES = [
  "all-providers-unavailable",
  "no-usable-quote",
  "price-impact-over-cap",
  "slippage-over-cap",
  "quote-stale",
] as const;
export type QuoteRefreshBlockCode = (typeof QUOTE_REFRESH_BLOCK_CODES)[number];

export interface SelectedQuote {
  provider: string;
  role: QuoteProviderRole;
  outAmountRaw: string | null;
  priceImpactPct: number | null;
  slippageBps: number | null;
  routeLabels: string[];
  observedAtMs: number;
  ageMs: number;
}

export interface QuoteRefreshResult {
  schemaVersion: typeof LIVE_QUOTE_REFRESH_SCHEMA_VERSION;
  mint: string;
  refreshedAtMs: number;
  ttlMs: number;
  selected: SelectedQuote | null;
  isFresh: boolean;
  isUsable: boolean;
  /** True when there is no usable, fresh, in-cap quote — downstream MUST block a live action. */
  failClosed: boolean;
  blockingReasons: QuoteRefreshBlockCode[];
  providerStatuses: { provider: string; role: QuoteProviderRole; outcome: QuoteObservationOutcome; latencyMs: number | null }[];
  routeChanged: boolean;
  /** Latency of the selected provider, when measured. */
  latencyMs: number | null;
  notProfitabilityClaim: true;
}

export interface RefreshQuotesInput {
  mint: string;
  observations: QuoteProviderObservation[];
  /** Route labels from the previous cycle, to detect a route change. */
  prevRouteLabels?: string[] | null;
  nowMs: number;
  ttlMs: number;
  maxSlippageBps: number;
  maxPriceImpactPct: number;
}

/** Standalone TTL check: is a quote captured at `observedAtMs` still fresh at `nowMs`? */
export function quoteAgeFresh(observedAtMs: number, nowMs: number, ttlMs: number): boolean {
  if (!Number.isFinite(observedAtMs) || !Number.isFinite(nowMs) || !Number.isFinite(ttlMs)) return false;
  const age = nowMs - observedAtMs;
  return age >= 0 && age <= ttlMs;
}

function sameRoute(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Run one refresh cycle. Selects the best usable quote (primary preferred) within the caps and TTL,
 * or fails closed with the reason. The result's `failClosed` is the single signal downstream uses to
 * refuse a canary on a missing/stale/over-cap quote.
 */
export function refreshQuotes(input: RefreshQuotesInput): QuoteRefreshResult {
  const blockingReasons: QuoteRefreshBlockCode[] = [];
  const block = (c: QuoteRefreshBlockCode): void => {
    if (!blockingReasons.includes(c)) blockingReasons.push(c);
  };
  const providerStatuses = input.observations.map((o) => ({ provider: o.provider, role: o.role, outcome: o.outcome, latencyMs: o.latencyMs }));

  const observed = input.observations.filter((o) => o.outcome === "observed");
  if (observed.length === 0) {
    block("all-providers-unavailable");
    return {
      schemaVersion: LIVE_QUOTE_REFRESH_SCHEMA_VERSION,
      mint: input.mint,
      refreshedAtMs: input.nowMs,
      ttlMs: input.ttlMs,
      selected: null,
      isFresh: false,
      isUsable: false,
      failClosed: true,
      blockingReasons,
      providerStatuses,
      routeChanged: false,
      latencyMs: null,
      notProfitabilityClaim: true,
    };
  }

  // Prefer primary, then fallback; within a role, prefer the most recent observation.
  const ranked = [...observed].sort((a, b) => {
    if (a.role !== b.role) return a.role === "primary" ? -1 : 1;
    return b.observedAtMs - a.observedAtMs;
  });

  // Find the first ranked quote that is within the caps.
  let chosen: QuoteProviderObservation | null = null;
  let sawOverImpact = false;
  let sawOverSlippage = false;
  for (const o of ranked) {
    const overImpact = o.priceImpactPct !== null && o.priceImpactPct > input.maxPriceImpactPct;
    const overSlippage = o.slippageBps !== null && o.slippageBps > input.maxSlippageBps;
    if (overImpact) sawOverImpact = true;
    if (overSlippage) sawOverSlippage = true;
    if (!overImpact && !overSlippage) {
      chosen = o;
      break;
    }
  }

  if (chosen === null) {
    if (sawOverImpact) block("price-impact-over-cap");
    if (sawOverSlippage) block("slippage-over-cap");
    block("no-usable-quote");
    const top = ranked[0];
    return {
      schemaVersion: LIVE_QUOTE_REFRESH_SCHEMA_VERSION,
      mint: input.mint,
      refreshedAtMs: input.nowMs,
      ttlMs: input.ttlMs,
      selected: null,
      isFresh: false,
      isUsable: false,
      failClosed: true,
      blockingReasons,
      providerStatuses,
      routeChanged: top !== undefined && input.prevRouteLabels != null && !sameRoute(top.routeLabels, input.prevRouteLabels),
      latencyMs: null,
      notProfitabilityClaim: true,
    };
  }

  const ageMs = input.nowMs - chosen.observedAtMs;
  const isFresh = quoteAgeFresh(chosen.observedAtMs, input.nowMs, input.ttlMs);
  if (!isFresh) block("quote-stale");
  const routeChanged = input.prevRouteLabels != null && !sameRoute(chosen.routeLabels, input.prevRouteLabels);
  const isUsable = isFresh;

  return {
    schemaVersion: LIVE_QUOTE_REFRESH_SCHEMA_VERSION,
    mint: input.mint,
    refreshedAtMs: input.nowMs,
    ttlMs: input.ttlMs,
    selected: {
      provider: chosen.provider,
      role: chosen.role,
      outAmountRaw: chosen.outAmountRaw,
      priceImpactPct: chosen.priceImpactPct,
      slippageBps: chosen.slippageBps,
      routeLabels: chosen.routeLabels,
      observedAtMs: chosen.observedAtMs,
      ageMs,
    },
    isFresh,
    isUsable,
    failClosed: !isUsable,
    blockingReasons,
    providerStatuses,
    routeChanged,
    latencyMs: chosen.latencyMs,
    notProfitabilityClaim: true,
  };
}
