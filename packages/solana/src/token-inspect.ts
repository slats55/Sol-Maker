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
  lines.push(`source:            ${report.source}`);
  lines.push(`rpc host:          ${report.endpointHost}`);
  lines.push(`time:              ${report.timestamp}`);
  lines.push("");
  lines.push(`Note: ${report.note}`);

  return redactString(lines.join("\n"));
}
