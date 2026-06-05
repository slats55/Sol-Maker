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

  return flags;
}
