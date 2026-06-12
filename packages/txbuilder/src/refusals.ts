/**
 * The CLOSED build-refusal reason set (Sprint 92) and the pure refusal evaluator.
 *
 * Every reason a swap build can be refused has a stable kebab-case code, and the evaluator runs
 * BEFORE any network call: a request that fails any check never reaches a provider. Refusals
 * accumulate (an operator sees everything wrong at once, not one error at a time).
 */

import { PublicKey } from "@solana/web3.js";

export const BUILD_REFUSAL_CODES = [
  "build-refused-kill-switch-active",
  "build-refused-mode-cannot-build",
  "build-refused-network-unsupported",
  "build-refused-network-mismatch",
  "build-refused-wallet-missing",
  "build-refused-wallet-invalid",
  "build-refused-mint-missing",
  "build-refused-mint-invalid",
  "build-refused-risk-missing",
  "build-refused-risk-rejected",
  "build-refused-risk-over-threshold",
  "build-refused-risk-cap-missing",
  "build-refused-spend-cap-missing",
  "build-refused-spend-over-cap",
  "build-refused-slippage-missing",
  "build-refused-slippage-over-cap",
  "build-refused-slippage-cap-missing",
  "build-refused-amount-missing",
  "build-refused-quote-unavailable",
  "build-refused-quote-blocked",
  "build-refused-quote-error",
  "build-refused-quote-unsupported",
  "build-refused-quote-mint-mismatch",
  "build-refused-quote-stale",
  "build-refused-provider-response-unsupported",
] as const;

export type BuildRefusalCode = (typeof BUILD_REFUSAL_CODES)[number];

export interface BuildRefusal {
  code: BuildRefusalCode;
  detail: string;
}

/** Execution modes in which BUILDING an unsigned transaction is permitted at all. */
export const BUILD_PERMITTED_MODES = ["devnet-execution", "mainnet-dry-run", "mainnet-live-armed"] as const;

export interface BuildSwapRequest {
  /** The candidate mint to swap INTO (the snipe target). */
  candidateMint?: string | null;
  /** The swap input mint (e.g. wrapped SOL). */
  inputMint?: string | null;
  /** Input amount in raw base units (integer string). */
  amountRaw?: string | null;
  /** Requested slippage in basis points. */
  slippageBps?: number | null;
  /** The wallet PUBLIC key the unsigned transaction is built FOR. */
  walletPublicKey?: string | null;
  /** Target network. The Jupiter builder supports mainnet-beta only (refused otherwise). */
  network?: string | null;
  /** The resolved execution mode (from @soulmaker/execution). Build needs an execution-shaped mode. */
  executionMode?: string | null;
  killSwitchActive?: boolean;
  /** Advisory risk facts for the candidate (from token:risk). */
  risk?: { score?: number | null; decision?: string | null } | null;
  /** Operator caps (from safety controls / config). */
  controls?: {
    maxSpendLamports?: string | null;
    slippageCapBps?: number | null;
    riskScoreCap?: number | null;
    /**
     * Sprint 93: explicit quote-age cap in ms. OPTIONAL at build time because the builder
     * fetches its quote fresh in-process — when supplied, a slow provider round-trip that ages
     * the quote past this cap refuses the build (`build-refused-quote-stale`). The envelope
     * always carries `quotedAt` so every LATER consumer enforces freshness with its own
     * explicit cap; absence here never loosens those gates.
     */
    maxQuoteAgeMs?: number | null;
  } | null;
}

const RAW_AMOUNT_RE = /^[0-9]{1,30}$/;

function validBase58Key(value: string): boolean {
  if (value.length > 44) return false;
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Evaluate every PRE-NETWORK refusal reason for a build request. Pure; returns ALL violations.
 * (Quote-outcome refusals — unavailable/blocked/error/mint-mismatch — are added by the builder
 * after its fresh quote fetch, from the same closed code set.)
 */
export function evaluateBuildRefusals(request: BuildSwapRequest): BuildRefusal[] {
  const refusals: BuildRefusal[] = [];

  if (request.killSwitchActive === true) {
    refusals.push({ code: "build-refused-kill-switch-active", detail: "the kill switch is active — nothing may be built" });
  }
  const mode = request.executionMode ?? "paper";
  if (!(BUILD_PERMITTED_MODES as readonly string[]).includes(mode)) {
    refusals.push({
      code: "build-refused-mode-cannot-build",
      detail: `execution mode "${mode}" cannot build transactions (permitted: ${BUILD_PERMITTED_MODES.join(", ")})`,
    });
  }
  if (request.network !== "mainnet-beta" && request.network !== "devnet") {
    refusals.push({ code: "build-refused-network-unsupported", detail: "network must be devnet or mainnet-beta" });
  }
  if (mode === "devnet-execution" && request.network === "mainnet-beta") {
    refusals.push({ code: "build-refused-network-mismatch", detail: "devnet-execution mode cannot build a mainnet-beta transaction" });
  }
  if ((mode === "mainnet-dry-run" || mode === "mainnet-live-armed") && request.network === "devnet") {
    refusals.push({ code: "build-refused-network-mismatch", detail: `${mode} mode cannot build a devnet transaction` });
  }

  if (typeof request.walletPublicKey !== "string" || request.walletPublicKey.trim().length === 0) {
    refusals.push({ code: "build-refused-wallet-missing", detail: "a destination wallet PUBLIC key is required" });
  } else if (!validBase58Key(request.walletPublicKey.trim())) {
    refusals.push({ code: "build-refused-wallet-invalid", detail: "the wallet public key is not a valid base58 public key (never paste secret key material)" });
  }

  for (const [field, code] of [
    ["candidateMint", "build-refused-mint-missing"],
    ["inputMint", "build-refused-mint-missing"],
  ] as const) {
    const value = request[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      refusals.push({ code, detail: `${field} is required` });
    } else if (!validBase58Key(value.trim())) {
      refusals.push({ code: "build-refused-mint-invalid", detail: `${field} is not a valid base58 mint` });
    }
  }

  if (typeof request.amountRaw !== "string" || !RAW_AMOUNT_RE.test(request.amountRaw) || /^0+$/.test(request.amountRaw)) {
    refusals.push({ code: "build-refused-amount-missing", detail: "amountRaw must be a positive integer string of raw base units" });
  }

  // Risk: missing risk facts are a refusal — building blind is never allowed.
  const riskScore = request.risk?.score;
  const riskDecision = request.risk?.decision;
  if (request.risk === undefined || request.risk === null || typeof riskScore !== "number" || !Number.isFinite(riskScore)) {
    refusals.push({ code: "build-refused-risk-missing", detail: "an advisory risk score for the candidate is required (run token:risk first)" });
  } else {
    if (riskDecision === "REJECT") {
      refusals.push({ code: "build-refused-risk-rejected", detail: "the advisory risk decision is REJECT — never built" });
    }
    const cap = request.controls?.riskScoreCap;
    if (typeof cap !== "number" || !Number.isFinite(cap)) {
      refusals.push({ code: "build-refused-risk-cap-missing", detail: "an explicit risk score cap is required" });
    } else if (riskScore > cap) {
      refusals.push({ code: "build-refused-risk-over-threshold", detail: `risk score ${riskScore} exceeds the cap ${cap}` });
    }
  }

  // Spend cap: required, and the input amount must fit under it.
  const maxSpend = request.controls?.maxSpendLamports;
  if (typeof maxSpend !== "string" || !RAW_AMOUNT_RE.test(maxSpend)) {
    refusals.push({ code: "build-refused-spend-cap-missing", detail: "an explicit maxSpendLamports cap is required" });
  } else if (typeof request.amountRaw === "string" && RAW_AMOUNT_RE.test(request.amountRaw) && BigInt(request.amountRaw) > BigInt(maxSpend)) {
    refusals.push({ code: "build-refused-spend-over-cap", detail: `amountRaw ${request.amountRaw} exceeds maxSpendLamports ${maxSpend}` });
  }

  // Slippage: explicit, and under an explicit cap.
  if (!Number.isInteger(request.slippageBps) || (request.slippageBps as number) < 0 || (request.slippageBps as number) > 10000) {
    refusals.push({ code: "build-refused-slippage-missing", detail: "slippageBps must be an explicit integer between 0 and 10000" });
  }
  const slippageCap = request.controls?.slippageCapBps;
  if (!Number.isInteger(slippageCap) || (slippageCap as number) < 0) {
    refusals.push({ code: "build-refused-slippage-cap-missing", detail: "an explicit slippageCapBps cap is required" });
  } else if (Number.isInteger(request.slippageBps) && (request.slippageBps as number) > (slippageCap as number)) {
    refusals.push({ code: "build-refused-slippage-over-cap", detail: `slippageBps ${request.slippageBps} exceeds the cap ${slippageCap}` });
  }

  return refusals;
}
