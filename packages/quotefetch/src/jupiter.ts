/**
 * Jupiter quote adapter (read-only).
 *
 * Wraps the public Jupiter quote HTTP API (free `lite-api.jup.ag` tier by default; verified live
 * against `GET /swap/v1/quote` during Sprint 92) behind the {@link QuoteProviderAdapter} seam.
 *
 * Honesty rules:
 *   - A provider problem NEVER throws — it maps onto the closed observation status set:
 *     network failure/timeout → `unavailable`; HTTP 401/403/429 → `blocked`; other non-2xx →
 *     `error`; a 2xx body that cannot be safely normalized → `unsupported`.
 *   - A successful quote becomes a `quote-observed` observation whose labels are bounded,
 *     redaction-stable strings. If ANY constructed label fails the shared observation validator,
 *     the whole result degrades to `unsupported` — never a half-trusted observation.
 *   - The provider's `outputMint` must equal the candidate mint; a contradiction is an `error`.
 *
 * This module fetches and reads. It cannot sign, send, or build anything.
 */

import { createHash } from "node:crypto";
import { redactString } from "@soulmaker/security";
import { parseMintAddress } from "@soulmaker/sniper";
import {
  validateRouteQuoteObservationInput,
  type RouteQuoteObservationInput,
} from "@soulmaker/routequote";
import type {
  FetchLike,
  QuoteFetchMetadata,
  QuoteFetchRequest,
  QuoteFetchResult,
  QuoteProviderAdapter,
} from "./types.js";

/** Stable provider id recorded as the observation `source`. */
export const JUPITER_LITE_PROVIDER_ID = "jupiter-lite-api";

/** The free, keyless Jupiter quote API base (paid tier is api.jup.ag with a key — NOT used here). */
export const JUPITER_LITE_BASE_URL = "https://lite-api.jup.ag/swap/v1";

export interface JupiterQuoteAdapterOptions {
  /** Override the base URL (e.g. a self-hosted or paid endpoint). Path must end at /swap/v1. */
  baseUrl?: string;
  /** Injected fetch implementation; defaults to the global fetch. */
  fetchLike?: FetchLike;
  /** Injected ISO clock for deterministic tests. */
  clock?: () => string;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
}

interface JupiterRoutePlanStep {
  swapInfo?: { label?: unknown };
}

interface JupiterQuoteResponse {
  inputMint?: unknown;
  inAmount?: unknown;
  outputMint?: unknown;
  outAmount?: unknown;
  otherAmountThreshold?: unknown;
  slippageBps?: unknown;
  priceImpactPct?: unknown;
  routePlan?: unknown;
  contextSlot?: unknown;
}

const RAW_AMOUNT_RE = /^[0-9]{1,30}$/;
const MAX_VENUE_HOPS = 4;
const MAX_HOP_LABEL = 32;

function endpointHostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return redactString(url);
  }
}

/** Bound + redact one provider-derived display string; null when unusable. */
function boundedLabel(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  if (trimmed.length === 0) return null;
  if (redactString(trimmed) !== trimmed) return null;
  return trimmed;
}

function venueLabelOf(routePlan: unknown): string | null {
  if (!Array.isArray(routePlan) || routePlan.length === 0) return null;
  const hops: string[] = [];
  for (const step of routePlan.slice(0, MAX_VENUE_HOPS)) {
    const label = boundedLabel((step as JupiterRoutePlanStep)?.swapInfo?.label, MAX_HOP_LABEL);
    hops.push(label ?? "unknown-venue");
  }
  const suffix = routePlan.length > MAX_VENUE_HOPS ? " > …" : "";
  return `${hops.join(" > ")}${suffix}`;
}

/** Validate the caller's request up front (programming errors DO throw; provider errors never do). */
export function validateQuoteFetchRequest(request: QuoteFetchRequest): QuoteFetchRequest {
  const candidateMint = parseMintAddress(request.candidateMint);
  const inputMint = parseMintAddress(request.inputMint);
  if (candidateMint === inputMint) {
    throw new Error("quote fetch request: inputMint must differ from candidateMint");
  }
  if (typeof request.amountRaw !== "string" || !RAW_AMOUNT_RE.test(request.amountRaw) || /^0+$/.test(request.amountRaw)) {
    throw new Error("quote fetch request: amountRaw must be a positive integer string of raw base units");
  }
  if (!Number.isInteger(request.slippageBps) || request.slippageBps < 0 || request.slippageBps > 10000) {
    throw new Error("quote fetch request: slippageBps must be an integer between 0 and 10000");
  }
  return { candidateMint, inputMint, amountRaw: request.amountRaw, slippageBps: request.slippageBps };
}

function defaultFetch(): FetchLike {
  const f = (globalThis as { fetch?: unknown }).fetch;
  if (typeof f !== "function") {
    throw new Error("global fetch is unavailable; inject fetchLike explicitly");
  }
  return f as FetchLike;
}

function nonObservedObservation(
  request: QuoteFetchRequest,
  status: "unavailable" | "blocked" | "error" | "unsupported",
  reason: string,
): RouteQuoteObservationInput {
  return validateRouteQuoteObservationInput({
    schemaVersion: "routequote.observation.input.v1",
    source: JUPITER_LITE_PROVIDER_ID,
    candidateMint: request.candidateMint,
    quoteStatus: status,
    statusReason: redactString(reason).slice(0, 200),
  });
}

/** Build the read-only Jupiter quote adapter. */
export function createJupiterQuoteAdapter(options: JupiterQuoteAdapterOptions = {}): QuoteProviderAdapter {
  const baseUrl = (options.baseUrl ?? JUPITER_LITE_BASE_URL).replace(/\/+$/, "");
  const fetchLike = options.fetchLike ?? defaultFetch();
  const clock = options.clock ?? ((): string => new Date().toISOString());
  const timeoutMs = options.timeoutMs ?? 10_000;
  const endpointHost = endpointHostOf(baseUrl);

  async function fetchQuote(rawRequest: QuoteFetchRequest): Promise<QuoteFetchResult> {
    const request = validateQuoteFetchRequest(rawRequest);
    const fetchedAt = clock();
    const metadata: QuoteFetchMetadata = {
      providerId: JUPITER_LITE_PROVIDER_ID,
      endpointHost,
      fetchedAt,
      httpStatus: null,
      contextSlot: null,
      priceImpactPct: null,
      routeLabels: [],
      responseSha256_128: null,
      statusDetail: null,
    };

    const url =
      `${baseUrl}/quote?inputMint=${request.inputMint}&outputMint=${request.candidateMint}` +
      `&amount=${request.amountRaw}&slippageBps=${request.slippageBps}&restrictIntermediateTokens=true`;

    let httpStatus: number;
    let ok: boolean;
    let body: string;
    try {
      const response = await fetchLike(url, { signal: AbortSignal.timeout(timeoutMs) });
      httpStatus = response.status;
      ok = response.ok;
      body = await response.text();
    } catch (err) {
      const detail = `quote source unreachable (network error or ${timeoutMs}ms timeout): ${redactString((err as Error).message ?? "unknown")}`.slice(0, 200);
      metadata.statusDetail = detail;
      return {
        status: "unavailable",
        observation: nonObservedObservation(request, "unavailable", detail),
        metadata,
      };
    }

    metadata.httpStatus = httpStatus;
    metadata.responseSha256_128 = createHash("sha256").update(body).digest("hex").slice(0, 32);

    if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) {
      const detail = `quote source refused access (HTTP ${httpStatus}) — rate limit or auth wall; reported honestly`;
      metadata.statusDetail = detail;
      return { status: "blocked", observation: nonObservedObservation(request, "blocked", detail), metadata };
    }
    if (!ok) {
      const detail = `quote source returned HTTP ${httpStatus}`;
      metadata.statusDetail = detail;
      return { status: "error", observation: nonObservedObservation(request, "error", detail), metadata };
    }

    let parsed: JupiterQuoteResponse;
    try {
      parsed = JSON.parse(body) as JupiterQuoteResponse;
    } catch {
      const detail = "quote source returned a non-JSON body — unsupported response format";
      metadata.statusDetail = detail;
      return { status: "unsupported", observation: nonObservedObservation(request, "unsupported", detail), metadata };
    }

    if (
      typeof parsed.inAmount !== "string" || !RAW_AMOUNT_RE.test(parsed.inAmount) ||
      typeof parsed.outAmount !== "string" || !RAW_AMOUNT_RE.test(parsed.outAmount) ||
      typeof parsed.inputMint !== "string" || typeof parsed.outputMint !== "string"
    ) {
      const detail = "quote response is missing required fields (inAmount/outAmount/inputMint/outputMint) — unsupported shape";
      metadata.statusDetail = detail;
      return { status: "unsupported", observation: nonObservedObservation(request, "unsupported", detail), metadata };
    }

    if (parsed.outputMint !== request.candidateMint || parsed.inputMint !== request.inputMint) {
      const detail = "quote response mints contradict the request — a quote for a different pair is refused";
      metadata.statusDetail = detail;
      return { status: "error", observation: nonObservedObservation(request, "error", detail), metadata };
    }

    if (typeof parsed.contextSlot === "number" && Number.isFinite(parsed.contextSlot)) {
      metadata.contextSlot = parsed.contextSlot;
    }
    metadata.priceImpactPct = boundedLabel(parsed.priceImpactPct, 32);
    const venue = venueLabelOf(parsed.routePlan);
    if (Array.isArray(parsed.routePlan)) {
      metadata.routeLabels = parsed.routePlan
        .slice(0, MAX_VENUE_HOPS)
        .map((s) => boundedLabel((s as JupiterRoutePlanStep)?.swapInfo?.label, MAX_HOP_LABEL) ?? "unknown-venue");
    }

    const threshold =
      typeof parsed.otherAmountThreshold === "string" && RAW_AMOUNT_RE.test(parsed.otherAmountThreshold)
        ? parsed.otherAmountThreshold
        : null;
    const notes = [
      `fetched by ${JUPITER_LITE_PROVIDER_ID} via ${endpointHost}`,
      "a quote is NOT execution and does NOT prove route readiness",
    ];
    if (metadata.priceImpactPct !== null) notes.push(`price impact ${metadata.priceImpactPct}% (provider-reported)`);
    if (metadata.contextSlot !== null) notes.push(`context slot ${metadata.contextSlot}`);

    try {
      const observation = validateRouteQuoteObservationInput({
        schemaVersion: "routequote.observation.input.v1",
        source: JUPITER_LITE_PROVIDER_ID,
        candidateMint: request.candidateMint,
        quoteStatus: "quote-observed",
        inputMint: request.inputMint,
        outputMint: request.candidateMint,
        amountInLabel: `${parsed.inAmount} raw in (ExactIn)`,
        amountOutLabel: threshold
          ? `${parsed.outAmount} raw out; min ${threshold} @ ${request.slippageBps} bps slippage`
          : `${parsed.outAmount} raw out @ ${request.slippageBps} bps slippage`,
        venueLabel: venue,
        feeLabel: null,
        observedAtLabel: fetchedAt,
        notes,
      });
      return { status: "quote-observed", observation, metadata };
    } catch (err) {
      // A provider value failed the shared validator (e.g. secret-shaped). Degrade, never trust.
      const detail = `quote response could not be normalized safely: ${redactString((err as Error).message)}`.slice(0, 200);
      metadata.statusDetail = detail;
      return { status: "unsupported", observation: nonObservedObservation(request, "unsupported", detail), metadata };
    }
  }

  return Object.freeze({ providerId: JUPITER_LITE_PROVIDER_ID, endpointHost, fetchQuote });
}
