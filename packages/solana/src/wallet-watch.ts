/**
 * Wallet watch report — a read-only snapshot of a public key's SOL balance and
 * SPL token accounts. No secrets, no sends. The owner is always a *public* key.
 */

import { redactString } from "@soulmaker/security";
import { parsePublicKey } from "./public-key.js";
import type {
  PublicKeyInput,
  ReadOnlySolanaClient,
  WalletWatchReport,
} from "./types.js";

export interface WalletWatchOptions {
  /** Injectable clock (ISO string) for deterministic tests. */
  now?: () => string;
  /** A short note describing the current mode/capability context. */
  capabilityNote?: string;
}

const isoNow = (): string => new Date().toISOString();

export async function buildWalletWatchReport(
  client: ReadOnlySolanaClient,
  owner: PublicKeyInput,
  options: WalletWatchOptions = {},
): Promise<WalletWatchReport> {
  // Validate up front so an invalid key fails clearly before any RPC call.
  const ownerKey =
    typeof owner === "string" ? parsePublicKey(owner) : owner;

  const [solBalance, tokenAccounts] = await Promise.all([
    client.getSolBalance(ownerKey),
    client.getTokenAccounts(ownerKey),
  ]);

  return {
    owner: ownerKey.toBase58(),
    solBalance,
    tokenAccountCount: tokenAccounts.length,
    tokenAccounts,
    endpointHost: client.endpointHost,
    timestamp: (options.now ?? isoNow)(),
    capabilityNote: options.capabilityNote ?? "read-only chain access",
  };
}

/** Max token accounts to print before summarizing the remainder. */
const MAX_TOKEN_ROWS = 50;

/** Human-readable, redacted rendering of a wallet watch report. */
export function formatWalletWatchReport(report: WalletWatchReport): string {
  const lines: string[] = [];
  lines.push("Wallet watch (READ-ONLY)");
  lines.push("========================");
  lines.push(`owner:           ${report.owner}`);
  lines.push(
    `SOL balance:     ${report.solBalance.sol} SOL ` +
      `(${report.solBalance.lamports} lamports)`,
  );
  lines.push(`token accounts:  ${report.tokenAccountCount}`);

  const shown = report.tokenAccounts.slice(0, MAX_TOKEN_ROWS);
  for (const acct of shown) {
    lines.push(
      `  - ${acct.mint}  ${acct.uiAmount}  ` +
        `(acct ${acct.tokenAccount}, ${acct.programLabel})`,
    );
  }
  if (report.tokenAccounts.length > MAX_TOKEN_ROWS) {
    lines.push(
      `  ... and ${report.tokenAccounts.length - MAX_TOKEN_ROWS} more ` +
        "(truncated for display)",
    );
  }

  lines.push(`rpc host:        ${report.endpointHost}`);
  lines.push(`mode:            ${report.capabilityNote}`);
  lines.push(`time:            ${report.timestamp}`);
  lines.push("");
  lines.push("READ-ONLY: no transaction was built, signed, or sent.");

  // Defense in depth: scrub the final string in case any field ever carries a
  // secret-looking value (e.g. an RPC host with an embedded api-key).
  return redactString(lines.join("\n"));
}
