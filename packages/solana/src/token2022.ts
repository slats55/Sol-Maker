/**
 * Token-2022 extension inspection (Sprint 93) — READ-ONLY parsing of the `extensions` array the
 * RPC's jsonParsed mint encoding already returns. No extra network call, no signer, no send.
 *
 * Honesty contract:
 *   - a classic spl-token mint is `not-applicable` (extensions cannot exist there);
 *   - a Token-2022 mint whose extension data parses is `parsed`, with each high-signal fact
 *     extracted defensively (an odd shape becomes a null fact, never a guess);
 *   - a Token-2022 mint whose extension data is missing or malformed is `unavailable` — an
 *     unknown is a caution downstream, NEVER "no extensions, all clear".
 */

export type Token2022ExtensionsStatus = "not-applicable" | "parsed" | "unavailable";

/** Extension names this inspector examines for high-signal facts. */
export const TOKEN_2022_EXAMINED_EXTENSIONS = [
  "transferFeeConfig",
  "transferFeeAmount",
  "transferHook",
  "transferHookAccount",
  "permanentDelegate",
  "defaultAccountState",
  "confidentialTransferMint",
  "confidentialTransferFeeConfig",
  "metadataPointer",
  "tokenMetadata",
  "mintCloseAuthority",
  "nonTransferable",
  "nonTransferableAccount",
  "interestBearingConfig",
  "pausableConfig",
  "scaledUiAmountConfig",
  "groupPointer",
  "tokenGroup",
  "groupMemberPointer",
  "tokenGroupMember",
  "immutableOwner",
  "memoTransfer",
  "cpiGuard",
] as const;

export interface Token2022ExtensionsSummary {
  status: Token2022ExtensionsStatus;
  /** Raw extension labels observed on the mint (bounded; unknown names are kept verbatim). */
  extensionNames: string[];
  /** Extension labels NOT in the examined set — behavior unverified. */
  unexaminedNames: string[];
  /** Current transfer fee in basis points (newer config); null when absent/unreadable. */
  transferFeeBps: number | null;
  transferHookPresent: boolean | null;
  /** The transfer hook program id when one is actually set. */
  transferHookProgramId: string | null;
  permanentDelegatePresent: boolean | null;
  permanentDelegate: string | null;
  /** True when defaultAccountState is "frozen" (new token accounts start frozen). */
  defaultAccountStateFrozen: boolean | null;
  confidentialTransfersEnabled: boolean | null;
  metadataPointerPresent: boolean | null;
  mintCloseAuthorityPresent: boolean | null;
  nonTransferable: boolean | null;
  interestBearing: boolean | null;
  pausable: boolean | null;
  scaledUiAmount: boolean | null;
}

const MAX_EXTENSIONS = 64;
const MAX_NAME_LENGTH = 64;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

function boundedKey(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 44 ? value : null;
}

/** The all-null summary for a classic mint or an unreadable Token-2022 mint. */
function emptySummary(status: Token2022ExtensionsStatus): Token2022ExtensionsSummary {
  return {
    status,
    extensionNames: [],
    unexaminedNames: [],
    transferFeeBps: null,
    transferHookPresent: null,
    transferHookProgramId: null,
    permanentDelegatePresent: null,
    permanentDelegate: null,
    defaultAccountStateFrozen: null,
    confidentialTransfersEnabled: null,
    metadataPointerPresent: null,
    mintCloseAuthorityPresent: null,
    nonTransferable: null,
    interestBearing: null,
    pausable: null,
    scaledUiAmount: null,
  };
}

/**
 * Summarize a Token-2022 mint's parsed `extensions` array.
 *
 * @param programLabel the owning token program label ("spl-token" | "spl-token-2022" | other)
 * @param extensionsValue the raw `info.extensions` value from the jsonParsed mint (may be
 *   undefined — a Token-2022 mint with no extensions legitimately omits it)
 */
export function summarizeToken2022Extensions(
  programLabel: string,
  extensionsValue: unknown,
): Token2022ExtensionsSummary {
  if (programLabel !== "spl-token-2022") {
    return emptySummary("not-applicable");
  }
  // A Token-2022 mint with NO extensions: the parsed encoding omits the array entirely.
  if (extensionsValue === undefined || extensionsValue === null) {
    const summary = emptySummary("parsed");
    summary.transferHookPresent = false;
    summary.permanentDelegatePresent = false;
    summary.defaultAccountStateFrozen = false;
    summary.confidentialTransfersEnabled = false;
    summary.metadataPointerPresent = false;
    summary.mintCloseAuthorityPresent = false;
    summary.nonTransferable = false;
    summary.interestBearing = false;
    summary.pausable = false;
    summary.scaledUiAmount = false;
    return summary;
  }
  if (!Array.isArray(extensionsValue) || extensionsValue.length > MAX_EXTENSIONS) {
    return emptySummary("unavailable");
  }

  const summary = summarizeToken2022Extensions("spl-token-2022", undefined); // start from the explicit all-false base
  const names: string[] = [];
  const unexamined: string[] = [];

  for (const entry of extensionsValue) {
    if (!isObject(entry)) return emptySummary("unavailable");
    const name = boundedName(entry.extension);
    if (name === null) return emptySummary("unavailable");
    names.push(name);
    const state = isObject(entry.state) ? entry.state : {};

    switch (name) {
      case "transferFeeConfig": {
        const newer = isObject(state.newerTransferFee) ? state.newerTransferFee : {};
        const bps = newer.transferFeeBasisPoints;
        summary.transferFeeBps = typeof bps === "number" && Number.isInteger(bps) && bps >= 0 ? bps : null;
        break;
      }
      case "transferHook": {
        const programId = boundedKey(state.programId);
        // A transferHook extension with a NULL programId is configured-but-unset; the
        // extension's presence still means a hook CAN be set by its authority — flag presence.
        summary.transferHookPresent = true;
        summary.transferHookProgramId = programId;
        break;
      }
      case "permanentDelegate": {
        summary.permanentDelegatePresent = true;
        summary.permanentDelegate = boundedKey(state.delegate);
        break;
      }
      case "defaultAccountState": {
        summary.defaultAccountStateFrozen = state.accountState === "frozen";
        break;
      }
      case "confidentialTransferMint": {
        summary.confidentialTransfersEnabled = true;
        break;
      }
      case "metadataPointer": {
        summary.metadataPointerPresent = true;
        break;
      }
      case "mintCloseAuthority": {
        summary.mintCloseAuthorityPresent = boundedKey(state.closeAuthority) !== null;
        break;
      }
      case "nonTransferable": {
        summary.nonTransferable = true;
        break;
      }
      case "interestBearingConfig": {
        summary.interestBearing = true;
        break;
      }
      case "pausableConfig": {
        summary.pausable = true;
        break;
      }
      case "scaledUiAmountConfig": {
        summary.scaledUiAmount = true;
        break;
      }
      default: {
        if (!(TOKEN_2022_EXAMINED_EXTENSIONS as readonly string[]).includes(name)) {
          unexamined.push(name);
        }
        break;
      }
    }
  }

  summary.extensionNames = names;
  summary.unexaminedNames = unexamined;
  return summary;
}
