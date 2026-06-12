/**
 * Jupiter swap builder (read-only network; builds UNSIGNED transactions only).
 *
 * The real provider flow (verified live for the quote leg in Sprint 92): a FRESH quote
 * (`GET /quote`) immediately followed by the official swap build (`POST /swap`) for the
 * operator's PUBLIC wallet key. Fetching fresh at build time removes the stale-quote window by
 * construction; the response's serialized transaction is accepted ONLY if it validates as a
 * strictly UNSIGNED `txpreview.envelope.v1` (any embedded signature refuses).
 *
 * Refusal-first: `evaluateBuildRefusals` runs BEFORE any network call — a request that is
 * over-cap, over-slippage, risk-rejected, kill-switched, or mode-blocked never reaches the
 * provider, and tests prove the fetch seam is never called for such requests.
 *
 * This module cannot sign and cannot send. Its only output is material for simulation
 * (`paper:simulation:tx`) and gated review.
 */

import { evaluateQuoteFreshness } from "@soulmaker/core";
import { redactString } from "@soulmaker/security";
import { validateUnsignedTxEnvelope, TX_ENVELOPE_SCHEMA_VERSION } from "@soulmaker/txpreview";
import type { UnsignedTxEnvelope } from "@soulmaker/txpreview";
import { evaluateBuildRefusals, type BuildRefusal, type BuildSwapRequest } from "./refusals.js";

export const JUPITER_SWAP_BUILDER_ID = "jupiter-swap-api";
export const JUPITER_SWAP_BASE_URL = "https://lite-api.jup.ag/swap/v1";

/** The narrow fetch seam (production: global fetch; tests: a fake). */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface JupiterSwapBuilderOptions {
  baseUrl?: string;
  fetchLike?: FetchLike;
  clock?: () => string;
  timeoutMs?: number;
}

export type BuildSwapResult =
  | { built: true; envelope: UnsignedTxEnvelope; quoteFacts: BuiltQuoteFacts }
  | { built: false; refusals: BuildRefusal[] };

export interface BuiltQuoteFacts {
  inAmountRaw: string;
  outAmountRaw: string;
  priceImpactPct: string | null;
  contextSlot: number | null;
  quotedAt: string;
}

export interface SwapTransactionBuilder {
  readonly builderId: string;
  readonly endpointHost: string;
  /** Build one unsigned swap envelope, or return the full refusal list. NEVER throws on provider problems. */
  build(request: BuildSwapRequest): Promise<BuildSwapResult>;
}

const RAW_AMOUNT_RE = /^[0-9]{1,30}$/;

function defaultFetch(): FetchLike {
  const f = (globalThis as { fetch?: unknown }).fetch;
  if (typeof f !== "function") {
    throw new Error("global fetch is unavailable; inject fetchLike explicitly");
  }
  return f as FetchLike;
}

function endpointHostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return redactString(url);
  }
}

function refusal(code: BuildRefusal["code"], detail: string): BuildRefusal {
  return { code, detail: redactString(detail).slice(0, 300) };
}

/** Build the Jupiter swap transaction builder (mainnet-beta only — the lite API has no devnet). */
export function createJupiterSwapBuilder(options: JupiterSwapBuilderOptions = {}): SwapTransactionBuilder {
  const baseUrl = (options.baseUrl ?? JUPITER_SWAP_BASE_URL).replace(/\/+$/, "");
  const fetchLike = options.fetchLike ?? defaultFetch();
  const clock = options.clock ?? ((): string => new Date().toISOString());
  const timeoutMs = options.timeoutMs ?? 15_000;
  const endpointHost = endpointHostOf(baseUrl);

  async function build(request: BuildSwapRequest): Promise<BuildSwapResult> {
    // 1) Refusal-first — NOTHING leaves this process unless the request is fully clean.
    const refusals = evaluateBuildRefusals(request);
    if (request.network === "devnet") {
      refusals.push(refusal("build-refused-network-unsupported", "the Jupiter lite swap API serves mainnet-beta only — no devnet swap build exists"));
    }
    if (refusals.length > 0) return { built: false, refusals };

    const quotedAt = clock();

    // 2) FRESH quote. Failure modes mirror the quote fetcher's closed mapping.
    const quoteUrl =
      `${baseUrl}/quote?inputMint=${request.inputMint}&outputMint=${request.candidateMint}` +
      `&amount=${request.amountRaw}&slippageBps=${request.slippageBps}&restrictIntermediateTokens=true`;
    let quoteBody: string;
    let quoteStatus: number;
    let quoteOk: boolean;
    try {
      const response = await fetchLike(quoteUrl, { signal: AbortSignal.timeout(timeoutMs) });
      quoteStatus = response.status;
      quoteOk = response.ok;
      quoteBody = await response.text();
    } catch (err) {
      return { built: false, refusals: [refusal("build-refused-quote-unavailable", `quote fetch failed: ${(err as Error).message ?? "network error"}`)] };
    }
    if (quoteStatus === 401 || quoteStatus === 403 || quoteStatus === 429) {
      return { built: false, refusals: [refusal("build-refused-quote-blocked", `quote endpoint refused access (HTTP ${quoteStatus})`)] };
    }
    if (!quoteOk) {
      return { built: false, refusals: [refusal("build-refused-quote-error", `quote endpoint returned HTTP ${quoteStatus}`)] };
    }
    let quote: Record<string, unknown>;
    try {
      quote = JSON.parse(quoteBody) as Record<string, unknown>;
    } catch {
      return { built: false, refusals: [refusal("build-refused-quote-unsupported", "quote response is not JSON")] };
    }
    if (
      typeof quote.inAmount !== "string" || !RAW_AMOUNT_RE.test(quote.inAmount) ||
      typeof quote.outAmount !== "string" || !RAW_AMOUNT_RE.test(quote.outAmount)
    ) {
      return { built: false, refusals: [refusal("build-refused-quote-unsupported", "quote response is missing required amount fields")] };
    }
    if (quote.outputMint !== request.candidateMint || quote.inputMint !== request.inputMint) {
      return { built: false, refusals: [refusal("build-refused-quote-mint-mismatch", "the fresh quote's mints contradict the request — refused")] };
    }
    // Defense in depth: the FRESH quote's input amount must still fit the spend cap.
    const maxSpend = request.controls?.maxSpendLamports as string;
    if (BigInt(quote.inAmount) > BigInt(maxSpend)) {
      return { built: false, refusals: [refusal("build-refused-spend-over-cap", "the fresh quote's inAmount exceeds maxSpendLamports")] };
    }

    // 3) Official swap build for the operator's PUBLIC key. The response transaction must
    //    validate as strictly UNSIGNED or the whole build is refused.
    let swapBody: string;
    let swapStatus: number;
    let swapOk: boolean;
    try {
      const response = await fetchLike(`${baseUrl}/swap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: (request.walletPublicKey as string).trim(),
          wrapAndUnwrapSol: true,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      swapStatus = response.status;
      swapOk = response.ok;
      swapBody = await response.text();
    } catch (err) {
      return { built: false, refusals: [refusal("build-refused-quote-unavailable", `swap build failed: ${(err as Error).message ?? "network error"}`)] };
    }
    if (swapStatus === 401 || swapStatus === 403 || swapStatus === 429) {
      return { built: false, refusals: [refusal("build-refused-quote-blocked", `swap endpoint refused access (HTTP ${swapStatus})`)] };
    }
    if (!swapOk) {
      return { built: false, refusals: [refusal("build-refused-quote-error", `swap endpoint returned HTTP ${swapStatus}`)] };
    }
    let swap: Record<string, unknown>;
    try {
      swap = JSON.parse(swapBody) as Record<string, unknown>;
    } catch {
      return { built: false, refusals: [refusal("build-refused-provider-response-unsupported", "swap response is not JSON")] };
    }
    if (typeof swap.swapTransaction !== "string" || swap.swapTransaction.length === 0) {
      return { built: false, refusals: [refusal("build-refused-provider-response-unsupported", "swap response carries no transaction")] };
    }

    const priceImpactPct =
      typeof quote.priceImpactPct === "string" && redactString(quote.priceImpactPct) === quote.priceImpactPct
        ? quote.priceImpactPct.slice(0, 32)
        : null;
    const contextSlot = typeof quote.contextSlot === "number" && Number.isFinite(quote.contextSlot) ? quote.contextSlot : null;

    // Sprint 93: when the operator supplied an explicit quote-age cap, a slow provider
    // round-trip that aged the fresh quote past it refuses the build — never silently shipped.
    const maxQuoteAgeMs = request.controls?.maxQuoteAgeMs;
    if (maxQuoteAgeMs !== undefined && maxQuoteAgeMs !== null) {
      const freshness = evaluateQuoteFreshness({ fetchedAt: quotedAt, nowMs: Date.parse(clock()), maxAgeMs: maxQuoteAgeMs });
      if (!freshness.fresh) {
        return { built: false, refusals: [refusal("build-refused-quote-stale", `the fresh quote aged out before the build completed: ${freshness.detail}`)] };
      }
    }

    let envelope: UnsignedTxEnvelope;
    try {
      envelope = validateUnsignedTxEnvelope({
        schemaVersion: TX_ENVELOPE_SCHEMA_VERSION,
        network: "mainnet-beta",
        feePayerPublicKey: (request.walletPublicKey as string).trim(),
        txBase64: swap.swapTransaction,
        builderId: JUPITER_SWAP_BUILDER_ID,
        candidateMint: request.candidateMint as string,
        routeCaveats: [
          `built from a FRESH quote at ${quotedAt}; quotes expire within seconds`,
          priceImpactPct !== null ? `provider-reported price impact ${priceImpactPct}%` : "price impact not reported",
          "an unsigned envelope is simulation material — never an order, never live-trading readiness",
        ],
        constraints: {
          maxSpendLamports: maxSpend,
          slippageBps: request.slippageBps as number,
        },
        quotedAt,
        unsigned: true,
        neverSigned: true,
        phase7LiveTradingReady: false,
      });
    } catch (err) {
      // Including the case where the provider returned a SIGNED or malformed transaction.
      return { built: false, refusals: [refusal("build-refused-provider-response-unsupported", `swap transaction failed strict validation: ${(err as Error).message}`)] };
    }

    return {
      built: true,
      envelope,
      quoteFacts: {
        inAmountRaw: quote.inAmount,
        outAmountRaw: quote.outAmount,
        priceImpactPct,
        contextSlot,
        quotedAt,
      },
    };
  }

  return Object.freeze({ builderId: JUPITER_SWAP_BUILDER_ID, endpointHost, build });
}
