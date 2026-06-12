/**
 * Token mint inspection report — read-only mint facts that feed the Phase 3 risk
 * engine (mint/freeze authority presence, decimals, supply, init state). This is
 * NOT a risk score and NOT a buy recommendation.
 */

import { redactString } from "@soulmaker/security";
import { parsePublicKey } from "./public-key.js";
import type {
  PublicKeyInput,
  ReadOnlySolanaClient,
  TokenInspectReport,
} from "./types.js";

export interface TokenInspectOptions {
  now?: () => string;
}

const isoNow = (): string => new Date().toISOString();

const INSPECTION_NOTE =
  "Inspection only — NOT a risk score (Phase 3) and NOT a buy recommendation.";

export async function buildTokenInspectReport(
  client: ReadOnlySolanaClient,
  mint: PublicKeyInput,
  options: TokenInspectOptions = {},
): Promise<TokenInspectReport> {
  // Validate up front so an invalid mint fails clearly regardless of client.
  const mintKey = typeof mint === "string" ? parsePublicKey(mint) : mint;
  const info = await client.getTokenMintInfo(mintKey);
  return {
    ...info,
    endpointHost: client.endpointHost,
    timestamp: (options.now ?? isoNow)(),
    note: INSPECTION_NOTE,
  };
}

/** Human-readable, redacted rendering of a token inspection report. */
export function formatTokenInspectReport(report: TokenInspectReport): string {
  const lines: string[] = [];
  lines.push("Token mint inspection (READ-ONLY)");
  lines.push("=================================");
  lines.push(`mint:              ${report.mint}`);
  lines.push(`program:           ${report.programLabel}`);
  lines.push(`decimals:          ${report.decimals}`);
  lines.push(`supply (raw):      ${report.supplyRaw}`);
  lines.push(`supply (approx):   ${report.uiSupply}`);
  lines.push(
    `mint authority:    ${report.mintAuthorityPresent ? "PRESENT (can mint more — dilution/rug risk)" : "renounced"}`,
  );
  lines.push(
    `freeze authority:  ${report.freezeAuthorityPresent ? "PRESENT (can freeze — you may not be able to sell)" : "renounced"}`,
  );
  lines.push(`initialized:       ${report.isInitialized ? "yes" : "no"}`);
  const t22 = report.token2022Extensions;
  if (t22 !== undefined && t22.status !== "not-applicable") {
    if (t22.status === "unavailable") {
      lines.push("token-2022 ext:    UNREADABLE — extension data could not be parsed (a caution, never assumed absent)");
    } else {
      lines.push(`token-2022 ext:    ${t22.extensionNames.length > 0 ? t22.extensionNames.join(", ") : "none"}`);
      const warnings: string[] = [];
      if (t22.transferHookPresent === true) warnings.push("TRANSFER HOOK (external program controls every transfer)");
      if (t22.permanentDelegatePresent === true) warnings.push("PERMANENT DELEGATE (can seize/burn any holder's tokens)");
      if (t22.nonTransferable === true) warnings.push("NON-TRANSFERABLE (cannot be sold)");
      if (t22.defaultAccountStateFrozen === true) warnings.push("DEFAULT FROZEN (new accounts start frozen)");
      if (t22.pausable === true) warnings.push("PAUSABLE (all transfers can be paused)");
      if (typeof t22.transferFeeBps === "number" && t22.transferFeeBps > 0) warnings.push(`TRANSFER FEE ${t22.transferFeeBps} bps on every transfer`);
      if (t22.mintCloseAuthorityPresent === true) warnings.push("MINT CLOSE AUTHORITY (address can be reused for a different token)");
      for (const warning of warnings) lines.push(`  !! ${warning}`);
    }
  }
  lines.push(`source:            ${report.source}`);
  lines.push(`rpc host:          ${report.endpointHost}`);
  lines.push(`time:              ${report.timestamp}`);
  lines.push("");
  lines.push(`Note: ${report.note}`);

  return redactString(lines.join("\n"));
}
