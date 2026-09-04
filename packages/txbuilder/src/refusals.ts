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
  "build-refused-token2022-blocker",
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
  "build-refused-quote-future",
  "build-refused-provider-response-unsupported",
  "build-refused-unsupported-transaction",
  "build-refused-unsupported-instruction",
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
  /**
   * Advisory risk facts for the candidate (from token:risk). `flags` (S95) carries the report's
   * risk-flag ids+severities so Token-2022 BLOCKER extensions refuse the build with their own
   * code — absence of flags never loosens anything (the score/decision gates still apply).
   */
  risk?: { score?: number | null; decision?: string | null; flags?: Array<{ id?: string | null; severity?: string | null }> | null } | null;
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
    /**
     * S95: OPTIONAL program allowlist for the BUILT transaction. null/absent = no allowlist
     * (current behavior). When supplied, every statically-resolvable invoked program id must be
     * listed, and a program id that rides an address-lookup table (unresolvable offline) refuses
     * honestly — the allowlist can only tighten, never loosen.
     */
    allowedPrograms?: string[] | null;
  } | null;
}

/**
 * Token-2022 risk-flag ids that BLOCK a swap build outright (S95). These are the extension facts
 * that can confiscate, freeze, or reroute tokens after the swap — matching the critical/high
 * extension severities of the S93 risk engine. The check fires only when the risk evidence
 * carries flags; a flagless report still faces the score/decision gates.
 */
export const TOKEN2022_BUILD_BLOCKER_FLAG_IDS = [
  "transfer-hook-present",
  "permanent-delegate-present",
  "non-transferable-token",
  "default-account-state-frozen",
  "pausable-token",
  "transfer-fee-extreme",
] as const;

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
    // S95: Token-2022 blocker extensions refuse with their own code. Flags are optional input —
    // a report without flags still faces the score/decision gates above.
    if (Array.isArray(request.risk?.flags)) {
      const blockers = request.risk.flags
        .map((f) => (typeof f?.id === "string" ? f.id : null))
        .filter((id): id is string => id !== null && (TOKEN2022_BUILD_BLOCKER_FLAG_IDS as readonly string[]).includes(id));
      if (blockers.length > 0) {
        refusals.push({
          code: "build-refused-token2022-blocker",
          detail: `the risk evidence carries Token-2022 BLOCKER extension flag(s): ${[...new Set(blockers)].join(", ")} — a token that can be hooked, frozen, paused, or confiscated after the swap is never built`,
        });
      }
    }
  }

  // Spend cap: required, and the input amount must fit under it. The cap is denominated in
  // LAMPORTS, so it is compared only when the swap INPUT is SOL (a buy). For a token→SOL swap
  // (a sell of something already held) the input is in token units and cannot be compared to a
  // lamport cap; the sell is bounded by the position itself and the cap is still REQUIRED.
  const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
  const maxSpend = request.controls?.maxSpendLamports;
  const inputIsSol = (request.inputMint ?? WRAPPED_SOL_MINT) === WRAPPED_SOL_MINT;
  if (typeof maxSpend !== "string" || !RAW_AMOUNT_RE.test(maxSpend)) {
    refusals.push({ code: "build-refused-spend-cap-missing", detail: "an explicit maxSpendLamports cap is required" });
  } else if (inputIsSol && typeof request.amountRaw === "string" && RAW_AMOUNT_RE.test(request.amountRaw) && BigInt(request.amountRaw) > BigInt(maxSpend)) {
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

  // S95: a SUPPLIED program allowlist must itself be valid before it can gate anything —
  // a malformed allowlist refuses the build rather than silently checking nothing.
  const allowedPrograms = request.controls?.allowedPrograms;
  if (allowedPrograms !== undefined && allowedPrograms !== null) {
    if (!Array.isArray(allowedPrograms) || allowedPrograms.length === 0) {
      refusals.push({ code: "build-refused-unsupported-instruction", detail: "controls.allowedPrograms must be a non-empty array of program ids when supplied (null/absent disables the allowlist)" });
    } else {
      for (const entry of allowedPrograms) {
        if (typeof entry !== "string" || !validBase58Key(entry.trim())) {
          refusals.push({ code: "build-refused-unsupported-instruction", detail: "controls.allowedPrograms carries an entry that is not a valid base58 program id — a broken allowlist gates nothing, so the build refuses" });
          break;
        }
      }
    }
  }

  return refusals;
}

/** Operator-facing guidance for ONE refusal code: what it means + the exact next safe action. */
export interface BuildRefusalGuidance {
  message: string;
  nextAction: string;
}

/**
 * The operator guidance table (S95): EVERY code in {@link BUILD_REFUSAL_CODES} has a plain
 * message and an exact next safe action. A test pins completeness, so adding a code without
 * guidance fails the suite.
 */
export const BUILD_REFUSAL_GUIDANCE: Readonly<Record<BuildRefusalCode, BuildRefusalGuidance>> = Object.freeze({
  "build-refused-kill-switch-active": {
    message: "The kill switch (config or emergency stop) is engaged — nothing may be built while it is active.",
    nextAction: "Investigate why the kill switch is on. Clear config killSwitch / remove the emergency-stop file only after the underlying problem is resolved.",
  },
  "build-refused-mode-cannot-build": {
    message: "The resolved execution mode cannot build transactions (paper/readonly/blocked modes never construct chain material).",
    nextAction: "Request an execution-shaped mode explicitly: --request mainnet-dry-run (build+simulate, never send) or the devnet path. Live mode stays blocked by policy.",
  },
  "build-refused-network-unsupported": {
    message: "The target network is not one the builder serves (the Jupiter lite swap API is mainnet-beta only).",
    nextAction: "Use --request mainnet-dry-run for a mainnet-beta dry-run build, or the devnet self-transfer probe for devnet rehearsals.",
  },
  "build-refused-network-mismatch": {
    message: "The requested execution mode and target network contradict each other.",
    nextAction: "Match them: devnet-execution builds devnet transactions; mainnet-dry-run builds mainnet-beta transactions.",
  },
  "build-refused-wallet-missing": {
    message: "No destination wallet public key was supplied.",
    nextAction: "Pass --wallet <publicKey> (a PUBLIC key — never paste secret key material).",
  },
  "build-refused-wallet-invalid": {
    message: "The supplied wallet value is not a valid base58 public key.",
    nextAction: "Check the key for typos. If the value is long, it may be secret material — never paste secrets; rotate the key if one was exposed.",
  },
  "build-refused-mint-missing": {
    message: "The candidate mint and/or input mint is missing.",
    nextAction: "Pass --candidate-mint <mint> (and --input-mint if not wrapped SOL).",
  },
  "build-refused-mint-invalid": {
    message: "A supplied mint is not a valid base58 address.",
    nextAction: "Re-copy the mint address from the candidate artifact (token:inspect verifies it on-chain).",
  },
  "build-refused-risk-missing": {
    message: "No advisory risk evidence was supplied for the candidate — building blind is never allowed.",
    nextAction: "Run: pnpm soulmaker token:risk <mint> --deep --json --out risk.json, then pass --risk risk.json.",
  },
  "build-refused-risk-rejected": {
    message: "The advisory risk decision for this candidate is REJECT.",
    nextAction: "Do not trade this token. Review the risk flags to understand why; a REJECT is never overridable at build time.",
  },
  "build-refused-risk-over-threshold": {
    message: "The candidate's risk score exceeds your explicit cap.",
    nextAction: "Skip the candidate, or revisit the cap deliberately (--risk-score-cap) — caps exist to be respected, not raised under pressure.",
  },
  "build-refused-risk-cap-missing": {
    message: "No explicit risk score cap was supplied — an uncapped build is never allowed.",
    nextAction: "Pass --risk-score-cap <n> (an explicit number you chose in advance).",
  },
  "build-refused-token2022-blocker": {
    message: "The risk evidence carries a Token-2022 BLOCKER extension (transfer hook, permanent delegate, non-transferable, frozen-by-default, pausable, or extreme transfer fee).",
    nextAction: "Do not trade this token. These extensions let the issuer reroute, freeze, or confiscate tokens AFTER the swap — no cap or flag overrides this.",
  },
  "build-refused-spend-cap-missing": {
    message: "No explicit per-trade spend cap was supplied.",
    nextAction: "Pass --max-spend-sol <sol> (it must also fit under the config hard cap caps.maxTradeSizeSol).",
  },
  "build-refused-spend-over-cap": {
    message: "The trade amount (or the fresh quote's input amount) exceeds the spend cap.",
    nextAction: "Lower --amount-sol/--amount-raw under the cap. Never raise a cap to fit a trade.",
  },
  "build-refused-slippage-missing": {
    message: "No explicit slippage tolerance was supplied (or it is out of the 0–10000 bps range).",
    nextAction: "Pass --slippage-bps <bps> explicitly — nothing is defaulted.",
  },
  "build-refused-slippage-over-cap": {
    message: "The requested slippage exceeds your explicit slippage cap.",
    nextAction: "Lower --slippage-bps under --slippage-cap-bps. High slippage on a thin token is how snipes get sandwiched.",
  },
  "build-refused-slippage-cap-missing": {
    message: "No explicit slippage cap was supplied.",
    nextAction: "Pass --slippage-cap-bps <bps> (an explicit ceiling you chose in advance).",
  },
  "build-refused-amount-missing": {
    message: "The trade amount is missing, zero, or not a positive integer of raw base units.",
    nextAction: "Pass exactly one of --amount-raw <units> or --amount-sol <sol>.",
  },
  "build-refused-quote-unavailable": {
    message: "The quote/swap provider could not be reached (network error or timeout). Nothing was built.",
    nextAction: "Check connectivity and retry. If it persists, the provider may be down — wait rather than route around the quote step.",
  },
  "build-refused-quote-blocked": {
    message: "The provider refused access (HTTP 401/403/429 — auth or rate limit). Nothing was built.",
    nextAction: "Back off and retry later. Never work around a rate limit by hammering the endpoint.",
  },
  "build-refused-quote-error": {
    message: "The provider returned an error response. Nothing was built.",
    nextAction: "Retry once. A persistent error usually means the pair has no route right now — that is information, not an obstacle.",
  },
  "build-refused-quote-unsupported": {
    message: "The provider's response did not match the documented shape (not JSON, or required fields missing).",
    nextAction: "Retry once; if it persists the provider API may have changed — verify the current Jupiter swap API docs before touching the adapter.",
  },
  "build-refused-quote-mint-mismatch": {
    message: "The fresh quote's input/output mints contradict the request — the provider quoted a different pair than asked.",
    nextAction: "Do not proceed. Re-run with the exact mints; if the mismatch repeats, treat the provider response as untrusted and stop.",
  },
  "build-refused-quote-stale": {
    message: "The quote aged past your explicit quote-age cap before the build completed.",
    nextAction: "Re-run the build — it fetches a fresh quote in-process. If staleness repeats, the provider round-trip is too slow for your cap.",
  },
  "build-refused-quote-future": {
    message: "The quote timestamp is in the FUTURE — a clock that disagrees with the evidence can never prove freshness.",
    nextAction: "Check the system clock (NTP sync). Never trade on evidence with impossible timestamps.",
  },
  "build-refused-provider-response-unsupported": {
    message: "The provider's swap response failed strict validation (no transaction, undecodable, or carrying a signature).",
    nextAction: "Do not proceed — a response that does not validate is never trusted. Verify the current Jupiter swap API behavior before adapting the code.",
  },
  "build-refused-unsupported-transaction": {
    message: "The built transaction's shape failed validation (missing/zero recent blockhash, or an unsupported version).",
    nextAction: "Retry once. A persistent shape problem means the provider changed its transaction format — verify against the official docs before adapting.",
  },
  "build-refused-unsupported-instruction": {
    message: "A program allowlist is in force and the transaction invokes a program that is not on it (or cannot be resolved offline).",
    nextAction: "Review the program ids in the build report. Extend the allowlist ONLY for programs you have verified; address-table-loaded programs cannot be verified offline.",
  },
});
