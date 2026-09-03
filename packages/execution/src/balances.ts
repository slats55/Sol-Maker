/**
 * BALANCE READS (Sprint 111) — the facts a confirmed buy/sell is verified against.
 *
 * Read-only. Sums every token account the owner holds for the mint (SPL Token and Token-2022
 * both answer a mint-filtered `getTokenAccountsByOwner`). Raw integer strings only — no decimals
 * math, no invented values: an unreadable balance is an error, never zero.
 */

import { Connection, PublicKey } from "@solana/web3.js";

/** The ONLY RPC capabilities the balance path accepts. */
export interface BalanceRpcLike {
  getBalanceLamports(ownerBase58: string): Promise<number>;
  /** Sum of raw token amounts across the owner's accounts for the mint (integer string). */
  getTokenBalanceRaw(ownerBase58: string, mintBase58: string): Promise<string>;
}

export interface BalanceRpc {
  readonly endpointHost: string;
  readonly rpc: BalanceRpcLike;
}

interface ParsedTokenAccountLike {
  account: { data: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } };
}

/** Production factory over a `Connection`, exposing only the two read methods. */
export function createBalanceRpc(rpcUrl: string): BalanceRpc {
  if (!rpcUrl || rpcUrl.trim().length === 0) throw new Error("createBalanceRpc requires a non-empty rpcUrl");
  const connection = new Connection(rpcUrl, "confirmed");
  let endpointHost: string;
  try {
    endpointHost = new URL(rpcUrl).host;
  } catch {
    endpointHost = "invalid-url";
  }
  return Object.freeze({
    endpointHost,
    rpc: Object.freeze({
      getBalanceLamports: async (owner: string): Promise<number> => connection.getBalance(new PublicKey(owner), "confirmed"),
      getTokenBalanceRaw: async (owner: string, mint: string): Promise<string> => {
        const res = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner), { mint: new PublicKey(mint) }, "confirmed");
        return sumRawAmounts(res.value as unknown as ParsedTokenAccountLike[]);
      },
    }),
  });
}

/** Sum parsed token-account amounts as BigInt; returns a decimal integer string. */
export function sumRawAmounts(accounts: readonly ParsedTokenAccountLike[]): string {
  let total = 0n;
  for (const a of accounts) {
    const amt = a?.account?.data?.parsed?.info?.tokenAmount?.amount;
    if (typeof amt === "string" && /^[0-9]{1,38}$/.test(amt)) total += BigInt(amt);
  }
  return total.toString();
}

export interface TokenDelta {
  beforeRaw: string;
  afterRaw: string;
  /** after - before as a decimal integer string (may be negative). */
  deltaRaw: string;
}

export function tokenDelta(beforeRaw: string, afterRaw: string): TokenDelta {
  const b = BigInt(beforeRaw);
  const a = BigInt(afterRaw);
  return { beforeRaw, afterRaw, deltaRaw: (a - b).toString() };
}
