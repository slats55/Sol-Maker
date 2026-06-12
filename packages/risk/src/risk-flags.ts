/**
 * Deterministic risk-flag evaluation.
 *
 * Given read-only mint facts ({@link TokenRiskInput}), produce a stable, ordered
 * list of explained {@link RiskFlag}s. Pure and side-effect-free: the same input
 * always yields byte-identical flags (no clock, no randomness, no I/O).
 *
 * Guiding principle (see docs/RISK_MODEL.md): a fact that cannot be determined
 * reliably is reported as *unknown* — a soft caution — never assumed safe.
 */

import { listIncludes, normalizeMint } from "./lists.js";
import type { RiskFlag, TokenRiskInput } from "./types.js";

/**
 * Decimals above this are treated as clearly abnormal. SPL mints in practice use
 * 0–9; 18 is already the EVM ceiling and beyond anything legitimate on Solana.
 */
export const SUSPICIOUS_DECIMALS_THRESHOLD = 18;

/**
 * Sprint 92 deep-check thresholds. Holder figures count token ACCOUNTS (which include AMM
 * pools/vaults — the flags say so); price impact is from a small quote probe, so even a few
 * percent on a small size means a very thin pool.
 */
export const HOLDER_TOP1_EXTREME_PCT = 50;
export const HOLDER_TOP1_ELEVATED_PCT = 25;
export const HOLDER_TOP5_ELEVATED_PCT = 70;
export const QUOTE_IMPACT_VERY_THIN_PCT = 10;
export const QUOTE_IMPACT_THIN_PCT = 3;

/**
 * Sprint 93 Token-2022 thresholds: a transfer fee at or above this (10%) is treated as a
 * deal-breaker — at that level every round trip loses a fifth of the position to the fee
 * authority, which is honeypot economics, not a fee.
 */
export const TRANSFER_FEE_EXTREME_BPS = 1000;

/** Token program labels we recognize as standard. Anything else is "unknown". */
const STANDARD_PROGRAM = "spl-token";
const TOKEN_2022_PROGRAM = "spl-token-2022";

/** A non-negative, plain base-10 integer string (the only valid raw supply). */
const BASE10_INTEGER = /^[0-9]+$/;

/** Classify a raw supply string (or a UI fallback) as known/zero/unparsable. */
function parseSupply(
  supplyRaw: string | undefined,
  uiSupply: number | undefined,
): { known: boolean; zero: boolean; unparsable: boolean } {
  if (supplyRaw !== undefined) {
    // A real on-chain supply is always a plain base-10 integer string. Reject
    // empty/blank and anything non-decimal up front — `BigInt` would otherwise
    // silently accept `""` (→ 0n), `"0x10"`, `"+5"`, etc. and we would misreport
    // a missing/malformed value as a known (or zero) supply.
    const s = supplyRaw.trim();
    if (!BASE10_INTEGER.test(s)) {
      return { known: false, zero: false, unparsable: true };
    }
    const n = BigInt(s);
    return { known: true, zero: n === 0n, unparsable: false };
  }
  if (typeof uiSupply === "number" && Number.isFinite(uiSupply)) {
    // Mirror the raw-path guard: a negative supply is nonsensical, not "safe".
    if (uiSupply < 0) return { known: false, zero: false, unparsable: true };
    return { known: true, zero: uiSupply === 0, unparsable: false };
  }
  // Neither form supplied — unknown supply is a (medium) caution, not "safe".
  return { known: false, zero: false, unparsable: true };
}

/**
 * Evaluate all risk flags for a mint, in a fixed, deterministic order:
 * lists → initialization → freeze authority → mint authority → token program →
 * supply → decimals.
 */
export function evaluateRiskFlags(input: TokenRiskInput): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const mint = normalizeMint(input.mint);

  // --- Operator lists -------------------------------------------------------
  // Denylist is a hard, critical reject regardless of anything else.
  if (listIncludes(input.denylist, mint)) {
    flags.push({
      id: "denylisted-mint",
      severity: "critical",
      title: "Mint is on the denylist",
      detail:
        "This mint appears on the operator denylist and is rejected outright.",
      evidence: { denylisted: true },
    });
  }
  // Allowlist is an explicit operator trust signal (informational; small credit
  // applied in scoring). It never bypasses a critical flag or the live gate.
  if (listIncludes(input.allowlist, mint)) {
    flags.push({
      id: "allowlisted-mint",
      severity: "info",
      title: "Mint is on the allowlist",
      detail:
        "This mint is on the operator allowlist (explicit trust signal). " +
        "This does not bypass critical flags or any account-level safety gate.",
      evidence: { allowlisted: true },
    });
  }
  if (listIncludes(input.previouslyTradedMints, mint)) {
    flags.push({
      id: "previously-traded-mint",
      severity: "medium",
      title: "Previously traded mint",
      detail:
        "This mint has been traded before. Re-entry can mean double exposure " +
        "or chasing a position — flagged for awareness.",
      evidence: { previouslyTraded: true },
    });
  }

  // --- Initialization -------------------------------------------------------
  if (input.isInitialized === false) {
    flags.push({
      id: "mint-not-initialized",
      severity: "critical",
      title: "Mint account is not initialized",
      detail:
        "The mint account is not initialized — it is not a usable, live SPL " +
        "mint. Rejected outright.",
      evidence: { isInitialized: false },
    });
  } else if (input.isInitialized === undefined) {
    flags.push({
      id: "initialization-unknown",
      severity: "low",
      title: "Initialization state unknown",
      detail:
        "Could not determine whether the mint is initialized; treated as a " +
        "caution, not assumed safe.",
      evidence: { isInitialized: null },
    });
  }

  // --- Freeze authority (critical when present) -----------------------------
  if (input.freezeAuthorityPresent === true) {
    flags.push({
      id: "freeze-authority-present",
      severity: "critical",
      title: "Freeze authority present",
      detail:
        "A freeze authority can freeze your token account so you cannot sell. " +
        "This is a classic honeypot vector — rejected outright.",
      evidence: { freezeAuthorityPresent: true },
    });
  } else if (input.freezeAuthorityPresent === false) {
    flags.push({
      id: "freeze-authority-renounced",
      severity: "info",
      title: "Freeze authority renounced",
      detail: "No freeze authority is set — the mint cannot freeze your tokens.",
      evidence: { freezeAuthorityPresent: false },
    });
  } else {
    flags.push({
      id: "freeze-authority-unknown",
      severity: "low",
      title: "Freeze authority unknown",
      detail:
        "Could not determine the freeze authority; treated as a caution, not " +
        "assumed renounced.",
      evidence: { freezeAuthorityPresent: null },
    });
  }

  // --- Mint authority (high when present) -----------------------------------
  if (input.mintAuthorityPresent === true) {
    flags.push({
      id: "mint-authority-present",
      severity: "high",
      title: "Mint authority present",
      detail:
        "A mint authority can mint unlimited additional supply, diluting or " +
        "rugging holders.",
      evidence: { mintAuthorityPresent: true },
    });
  } else if (input.mintAuthorityPresent === false) {
    flags.push({
      id: "mint-authority-renounced",
      severity: "info",
      title: "Mint authority renounced",
      detail: "No mint authority is set — supply cannot be inflated.",
      evidence: { mintAuthorityPresent: false },
    });
  } else {
    flags.push({
      id: "mint-authority-unknown",
      severity: "low",
      title: "Mint authority unknown",
      detail:
        "Could not determine the mint authority; treated as a caution, not " +
        "assumed renounced.",
      evidence: { mintAuthorityPresent: null },
    });
  }

  // --- Token program --------------------------------------------------------
  if (input.programLabel === STANDARD_PROGRAM) {
    flags.push({
      id: "standard-spl-token-program",
      severity: "info",
      title: "Standard SPL token program",
      detail: "Owned by the standard SPL token program.",
      evidence: { programLabel: input.programLabel },
    });
  } else if (input.programLabel === TOKEN_2022_PROGRAM) {
    flags.push({
      id: "token-2022-program",
      severity: "info",
      title: "Token-2022 program detected",
      detail:
        "Owned by the Token-2022 program. This is a legitimate program but " +
        "supports transfer hooks/fees — informational caution.",
      evidence: { programLabel: input.programLabel },
    });
  } else {
    flags.push({
      id: "unknown-token-program",
      severity: "high",
      title: "Unknown / unsupported token program",
      detail:
        "The owning token program is not a recognized SPL token program. " +
        "Behavior is unverified — treat with high caution.",
      evidence: { programLabel: input.programLabel ?? null },
    });
  }

  // --- Supply ---------------------------------------------------------------
  const supply = parseSupply(input.supplyRaw, input.uiSupply);
  if (supply.unparsable) {
    flags.push({
      id: "supply-unparsable",
      severity: "medium",
      title: "Supply missing or unparsable",
      detail:
        "Token supply is missing or could not be parsed as a non-negative " +
        "integer; treated as a caution.",
      evidence: { supplyRaw: input.supplyRaw ?? null, uiSupply: input.uiSupply ?? null },
    });
  } else if (supply.zero) {
    flags.push({
      id: "zero-supply",
      severity: "medium",
      title: "Zero supply",
      detail:
        "Token supply is zero. This is abnormal for a tradable token and is " +
        "flagged for caution.",
      evidence: { supplyRaw: input.supplyRaw ?? null, uiSupply: input.uiSupply ?? null },
    });
  }

  // --- Decimals -------------------------------------------------------------
  if (
    typeof input.decimals === "number" &&
    (!Number.isInteger(input.decimals) ||
      input.decimals < 0 ||
      input.decimals > SUSPICIOUS_DECIMALS_THRESHOLD)
  ) {
    flags.push({
      id: "suspicious-decimals",
      severity: "high",
      title: "Suspicious decimals",
      detail:
        `Decimals (${input.decimals}) are outside the normal range ` +
        `[0, ${SUSPICIOUS_DECIMALS_THRESHOLD}] — clearly abnormal for an SPL mint.`,
      evidence: { decimals: input.decimals },
    });
  }

  // --- Sprint 92 deep checks --------------------------------------------------
  // Each block fires ONLY when its input was supplied (absence = "not checked",
  // never "passed"); an explicit *Available:false is an honest unknown caution.

  // Holder concentration (token accounts — includes pools/vaults; flags say so).
  const holderSupplied =
    input.holderDataAvailable !== undefined ||
    input.topHolderPct !== undefined ||
    input.top5HolderPct !== undefined;
  if (holderSupplied) {
    const top1 = typeof input.topHolderPct === "number" && Number.isFinite(input.topHolderPct) ? input.topHolderPct : null;
    const top5 = typeof input.top5HolderPct === "number" && Number.isFinite(input.top5HolderPct) ? input.top5HolderPct : null;
    if (input.holderDataAvailable === false || (top1 === null && top5 === null)) {
      flags.push({
        id: "holder-concentration-unknown",
        severity: "low",
        title: "Holder concentration unknown",
        detail:
          "A holder scan was attempted but the data could not be read; treated " +
          "as a caution, not assumed dispersed.",
        evidence: { holderDataAvailable: false },
      });
    } else if (top1 !== null && top1 >= HOLDER_TOP1_EXTREME_PCT) {
      flags.push({
        id: "holder-concentration-extreme",
        severity: "high",
        title: "Extreme holder concentration",
        detail:
          `The single largest token account holds ${top1}% of supply ` +
          `(≥ ${HOLDER_TOP1_EXTREME_PCT}%). Largest accounts can be pools/vaults — ` +
          "verify before treating this as one wallet, but a dump/rug from one account is possible.",
        evidence: { topHolderPct: top1, top5HolderPct: top5 },
      });
    } else if ((top1 !== null && top1 >= HOLDER_TOP1_ELEVATED_PCT) || (top5 !== null && top5 >= HOLDER_TOP5_ELEVATED_PCT)) {
      flags.push({
        id: "holder-concentration-elevated",
        severity: "medium",
        title: "Elevated holder concentration",
        detail:
          `Top token accounts hold a large share of supply (top1 ${top1 ?? "?"}%, ` +
          `top5 ${top5 ?? "?"}%). Largest accounts can be pools/vaults — flagged for review.`,
        evidence: { topHolderPct: top1, top5HolderPct: top5 },
      });
    } else {
      flags.push({
        id: "holder-concentration-modest",
        severity: "info",
        title: "Holder concentration below thresholds",
        detail:
          `Top token accounts are below the concentration thresholds (top1 ${top1 ?? "?"}%, ` +
          `top5 ${top5 ?? "?"}%). Informational — accounts include pools/vaults.`,
        evidence: { topHolderPct: top1, top5HolderPct: top5 },
      });
    }
  }

  // Metadata mutability (Metaplex token-metadata).
  const metadataSupplied = input.metadataAvailable !== undefined || input.metadataMutable !== undefined;
  if (metadataSupplied) {
    if (input.metadataAvailable === false || input.metadataMutable === undefined) {
      flags.push({
        id: "metadata-unavailable",
        severity: "low",
        title: "Token metadata unavailable",
        detail:
          "A metadata read was attempted but no readable Metaplex metadata was " +
          "found; treated as a caution, not assumed immutable.",
        evidence: { metadataAvailable: false },
      });
    } else if (input.metadataMutable === true) {
      flags.push({
        id: "metadata-mutable",
        severity: "medium",
        title: "Token metadata is mutable",
        detail:
          "The update authority can still change the token's name/symbol/URI — " +
          "a common impersonation/bait-and-switch vector.",
        evidence: { metadataMutable: true },
      });
    } else {
      flags.push({
        id: "metadata-immutable",
        severity: "info",
        title: "Token metadata is immutable",
        detail: "The Metaplex metadata can no longer be changed.",
        evidence: { metadataMutable: false },
      });
    }
  }

  // --- Sprint 93 Token-2022 extension checks ---------------------------------
  // Fire ONLY when the token2022 block was supplied (absence = "not checked").
  if (input.token2022 !== undefined) {
    const t22 = input.token2022;
    if (t22.status === "unavailable") {
      flags.push({
        id: "token-2022-extensions-unknown",
        severity: "medium",
        title: "Token-2022 extension data unreadable",
        detail:
          "This is a Token-2022 mint but its extension data could not be read or parsed. " +
          "Extensions can include transfer hooks, fees, and permanent delegates — treated as a caution, never assumed absent.",
        evidence: { token2022Status: "unavailable" },
      });
    } else if (t22.status === "parsed") {
      let riskyExtensionFlagged = false;

      if (t22.transferHookPresent === true) {
        riskyExtensionFlagged = true;
        flags.push({
          id: "transfer-hook-present",
          severity: "critical",
          title: "Transfer hook extension present",
          detail:
            "Every transfer of this token invokes an external program that can reject, redirect, or condition transfers " +
            "at will — the canonical programmable-honeypot vector. Rejected outright.",
          evidence: { transferHookProgramId: t22.transferHookProgramId ?? null },
        });
      }
      if (t22.permanentDelegatePresent === true) {
        riskyExtensionFlagged = true;
        flags.push({
          id: "permanent-delegate-present",
          severity: "critical",
          title: "Permanent delegate extension present",
          detail:
            "A permanent delegate can transfer or burn ANY holder's tokens without consent, forever. " +
            "Legitimate for some regulated assets — fatal for a sniped token. Rejected outright.",
          evidence: { permanentDelegate: t22.permanentDelegate ?? null },
        });
      }
      if (t22.nonTransferable === true) {
        riskyExtensionFlagged = true;
        flags.push({
          id: "non-transferable-token",
          severity: "critical",
          title: "Non-transferable token",
          detail: "The non-transferable extension is set — the token cannot be moved or sold at all. Rejected outright.",
          evidence: { nonTransferable: true },
        });
      }
      if (t22.defaultAccountStateFrozen === true) {
        riskyExtensionFlagged = true;
        flags.push({
          id: "default-account-state-frozen",
          severity: "critical",
          title: "New token accounts start FROZEN",
          detail:
            "The defaultAccountState extension freezes every new token account until an authority thaws it — " +
            "buyers receive tokens they cannot move. A classic honeypot construction. Rejected outright.",
          evidence: { defaultAccountStateFrozen: true },
        });
      }
      if (t22.pausable === true) {
        riskyExtensionFlagged = true;
        flags.push({
          id: "pausable-token",
          severity: "critical",
          title: "Pausable extension present",
          detail:
            "An authority can pause ALL transfers of this token at any moment — you may be unable to sell exactly " +
            "when it matters. Rejected outright.",
          evidence: { pausable: true },
        });
      }
      if (typeof t22.transferFeeBps === "number" && t22.transferFeeBps > 0) {
        riskyExtensionFlagged = true;
        const extreme = t22.transferFeeBps >= TRANSFER_FEE_EXTREME_BPS;
        flags.push({
          id: extreme ? "transfer-fee-extreme" : "transfer-fee-present",
          severity: extreme ? "critical" : "high",
          title: extreme ? "Extreme transfer fee" : "Transfer fee extension present",
          detail: extreme
            ? `Every transfer loses ${t22.transferFeeBps} bps (≥ ${TRANSFER_FEE_EXTREME_BPS}) to the fee authority — ` +
              "honeypot economics, not a fee. Rejected outright."
            : `Every transfer loses ${t22.transferFeeBps} bps to the fee authority — entry and exit both pay it, ` +
              "and the authority can raise it (up to its configured maximum) for future epochs.",
          evidence: { transferFeeBps: t22.transferFeeBps },
        });
      }
      if (t22.mintCloseAuthorityPresent === true) {
        riskyExtensionFlagged = true;
        flags.push({
          id: "mint-close-authority-present",
          severity: "high",
          title: "Mint close authority present",
          detail:
            "An authority can close the mint account once supply hits zero — and a closed mint address can be " +
            "reinitialized as a DIFFERENT token, a known impersonation vector.",
          evidence: { mintCloseAuthorityPresent: true },
        });
      }
      if (t22.confidentialTransfersEnabled === true) {
        flags.push({
          id: "confidential-transfers-enabled",
          severity: "medium",
          title: "Confidential transfers enabled",
          detail:
            "Balances/amounts can move confidentially, which blinds holder-concentration and flow analysis for this " +
            "token — a transparency caution, not a verdict.",
          evidence: { confidentialTransfersEnabled: true },
        });
      }
      if (t22.scaledUiAmount === true) {
        flags.push({
          id: "scaled-ui-amount-present",
          severity: "medium",
          title: "Scaled UI amount extension present",
          detail:
            "Displayed balances are multiplied by an authority-controlled factor — what wallets show can be changed " +
            "without any real transfer. Display figures for this token are untrustworthy.",
          evidence: { scaledUiAmount: true },
        });
      }
      if (t22.interestBearing === true) {
        flags.push({
          id: "interest-bearing-token",
          severity: "low",
          title: "Interest-bearing extension present",
          detail: "Displayed balances accrue a configured interest rate — display-only accounting, flagged for awareness.",
          evidence: { interestBearing: true },
        });
      }
      if (t22.metadataPointerPresent === true) {
        flags.push({
          id: "metadata-pointer-present",
          severity: "info",
          title: "Metadata pointer extension present",
          detail: "Token metadata lives at the account this pointer names (often the mint itself) rather than Metaplex.",
          evidence: { metadataPointerPresent: true },
        });
      }
      const unexamined = (t22.unexaminedNames ?? []).filter((n) => typeof n === "string" && n.length > 0);
      if (unexamined.length > 0) {
        flags.push({
          id: "token-2022-unexamined-extension",
          severity: "medium",
          title: "Unexamined Token-2022 extension present",
          detail:
            `This mint carries extension(s) this inspector does not examine (${unexamined.slice(0, 5).join(", ")}) — ` +
            "their behavior is unverified, which is a caution, not a pass.",
          evidence: { unexaminedNames: unexamined.slice(0, 10) },
        });
      }
      if (input.programLabel === TOKEN_2022_PROGRAM && !riskyExtensionFlagged && unexamined.length === 0) {
        flags.push({
          id: "token-2022-no-risky-extensions",
          severity: "info",
          title: "No high-risk Token-2022 extensions detected",
          detail:
            "The parsed extension set contains none of the high-risk extensions (hook, permanent delegate, " +
            "non-transferable, default-frozen, pausable, transfer fee, mint close authority). Informational — " +
            "this clears the EXTENSION checks only, nothing else.",
          evidence: { extensionNames: (t22.extensionNames ?? []).slice(0, 16) },
        });
      }
    }
  }

  // Liquidity depth from a small quote probe's price impact.
  if (input.quotePriceImpactPct !== undefined) {
    const impact = input.quotePriceImpactPct;
    if (!Number.isFinite(impact) || impact < 0) {
      flags.push({
        id: "liquidity-impact-unknown",
        severity: "low",
        title: "Quote price impact unparsable",
        detail:
          "A quote probe was supplied but its price impact could not be read; " +
          "treated as a caution, not assumed deep.",
        evidence: { quotePriceImpactPct: null },
      });
    } else if (impact >= QUOTE_IMPACT_VERY_THIN_PCT) {
      flags.push({
        id: "liquidity-very-thin",
        severity: "high",
        title: "Very thin liquidity",
        detail:
          `A small quote probe moved the price ${impact}% ` +
          `(≥ ${QUOTE_IMPACT_VERY_THIN_PCT}%). Exiting a position could be much worse.`,
        evidence: { quotePriceImpactPct: impact },
      });
    } else if (impact >= QUOTE_IMPACT_THIN_PCT) {
      flags.push({
        id: "liquidity-thin",
        severity: "medium",
        title: "Thin liquidity",
        detail:
          `A small quote probe moved the price ${impact}% ` +
          `(≥ ${QUOTE_IMPACT_THIN_PCT}%). Slippage on exit may be significant.`,
        evidence: { quotePriceImpactPct: impact },
      });
    } else {
      flags.push({
        id: "liquidity-impact-modest",
        severity: "info",
        title: "Quote probe impact below thresholds",
        detail:
          `A small quote probe moved the price ${impact}% — below the thin-liquidity ` +
          "thresholds. Informational; depth at LARGER sizes was not probed.",
        evidence: { quotePriceImpactPct: impact },
      });
    }
  }

  return flags;
}
