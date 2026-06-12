/**
 * Types for the read-only, advisory token risk engine (Phase 3 / Sprint 3).
 *
 * This layer turns the *facts* gathered by `@soulmaker/solana`'s read-only mint
 * inspection into structured, explained, advisory **risk flags** and a numeric
 * **advisory score**. It is NOT a buy/sell recommendation engine and it never
 * builds, signs, simulates, or sends a transaction. There is intentionally no
 * type here for a signer, secret key, keypair, or transaction.
 */

/** How serious a single flag is, from purely informational to deal-breaking. */
export type RiskSeverity = "info" | "low" | "medium" | "high" | "critical";

/**
 * The advisory disposition of a mint.
 *
 *  - `REJECT`                     — a critical flag fired, or the score is high
 *                                   enough that the mint should not proceed.
 *  - `CAUTION`                    — notable risk; proceed only with care.
 *  - `PASS_FOR_PAPER_EVALUATION`  — may proceed to *paper-trading* evaluation
 *                                   LATER. This does NOT mean "safe to live
 *                                   trade" and never authorizes a real send.
 */
export type RiskDecision = "REJECT" | "CAUTION" | "PASS_FOR_PAPER_EVALUATION";

/** A single, explained risk observation. Deterministic for a given input. */
export interface RiskFlag {
  /** Stable kebab-case identifier, e.g. "freeze-authority-present". */
  id: string;
  severity: RiskSeverity;
  /** Short human title, e.g. "Freeze authority present". */
  title: string;
  /** One-sentence explanation of why this matters / what was observed. */
  detail: string;
  /** Machine-readable supporting facts (never secrets — public data only). */
  evidence?: Record<string, unknown>;
}

/**
 * Read-only inputs to the risk engine. Everything except `mint` is optional so
 * the engine degrades gracefully on partial data — an undetermined fact is
 * treated as *unknown* (a soft caution), never silently assumed safe.
 *
 * These fields mirror `@soulmaker/solana`'s `TokenMintInfo` plus operator lists.
 * None of them is secret: a mint is a public key, authorities are booleans.
 */
export interface TokenRiskInput {
  /** The token mint public key (base58). Required. */
  mint: string;
  decimals?: number;
  /** Raw supply as a base-10 string (authoritative; no precision loss). */
  supplyRaw?: string;
  /** Approximate UI supply (display only). */
  uiSupply?: number;
  /** True when a mint authority is set (can mint more — dilution/rug risk). */
  mintAuthorityPresent?: boolean;
  /** True when a freeze authority is set (can freeze — you may not be able to sell). */
  freezeAuthorityPresent?: boolean;
  isInitialized?: boolean;
  /** Owning token program label, e.g. "spl-token" / "spl-token-2022" / "unknown". */
  programLabel?: string;
  /** Operator allowlist of trusted mints (base58). */
  allowlist?: string[];
  /** Operator denylist of known-bad mints (base58). Hard reject. */
  denylist?: string[];
  /** Mints the operator has previously traded (local state concept). */
  previouslyTradedMints?: string[];

  // --- Sprint 92 DEEP checks (all optional). HONESTY CONTRACT: when a field is
  // ABSENT the deep check was not run and NO flag fires (existing reports stay
  // byte-identical); when it is SUPPLIED — including the explicit *Available:
  // false failure forms — the corresponding flags always fire. Absence is "not
  // checked", never "passed".

  /** False when a holder scan was ATTEMPTED but the data could not be read. */
  holderDataAvailable?: boolean;
  /** Percent of supply held by the largest token account (0–100). */
  topHolderPct?: number;
  /** Percent of supply held by the five largest token accounts (0–100). */
  top5HolderPct?: number;
  /** False when a metadata read was ATTEMPTED but no account was found / read failed. */
  metadataAvailable?: boolean;
  /** True when the Metaplex metadata is still mutable (name/symbol/URI can change). */
  metadataMutable?: boolean;
  /** Provider-reported price impact percent of a small quote probe (liquidity depth). */
  quotePriceImpactPct?: number;

  /**
   * Sprint 93 Token-2022 extension facts (from `@soulmaker/solana`'s jsonParsed read). Same
   * honesty contract as the S92 deep checks: ABSENT means the inspection was not run and NO
   * extension flag fires (existing reports stay byte-identical); SUPPLIED means the
   * corresponding flags always fire — including the explicit `status: "unavailable"` form,
   * which is a caution, never "no extensions, all clear".
   */
  token2022?: {
    status: "not-applicable" | "parsed" | "unavailable";
    extensionNames?: string[];
    unexaminedNames?: string[];
    transferFeeBps?: number | null;
    transferHookPresent?: boolean | null;
    transferHookProgramId?: string | null;
    permanentDelegatePresent?: boolean | null;
    permanentDelegate?: string | null;
    defaultAccountStateFrozen?: boolean | null;
    confidentialTransfersEnabled?: boolean | null;
    metadataPointerPresent?: boolean | null;
    mintCloseAuthorityPresent?: boolean | null;
    nonTransferable?: boolean | null;
    interestBearing?: boolean | null;
    pausable?: boolean | null;
    scaledUiAmount?: boolean | null;
  };
}

/** The full advisory risk report for one mint. */
export interface TokenRiskReport {
  mint: string;
  /** 0 = safest advisory score, 100 = riskiest. Always clamped to [0, 100]. */
  score: number;
  decision: RiskDecision;
  flags: RiskFlag[];
  /** Plain-English advisory statements (always read-only, never a buy signal). */
  summary: string[];
  /** ISO-8601 timestamp from an injectable clock (deterministic in tests). */
  generatedAt: string;
  /** Fixed advisory disclaimer. */
  disclaimer: string;
}
