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

export interface TokenHolding {
  mint: string;
  amountRaw: string;
  /** "spl-token" | "token-2022" */
  program: string;
}

/** S111 reconcile: list every non-zero token holding of an owner across BOTH token programs. */
export interface HoldingsRpcLike {
  listTokenHoldings(ownerBase58: string): Promise<TokenHolding[]>;
}

export interface BalanceRpc {
  readonly endpointHost: string;
  readonly rpc: BalanceRpcLike & HoldingsRpcLike;
}

const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

interface ParsedTokenAccountLike {
  account: { data: { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string } } } } };
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
      listTokenHoldings: async (owner: string): Promise<TokenHolding[]> => {
        const out: TokenHolding[] = [];
        for (const [programId, label] of [[SPL_TOKEN_PROGRAM, "spl-token"], [TOKEN_2022_PROGRAM, "token-2022"]] as const) {
          const res = await connection.getParsedTokenAccountsByOwner(new PublicKey(owner), { programId: new PublicKey(programId) }, "confirmed");
          out.push(...groupHoldings(res.value as unknown as ParsedTokenAccountLike[], label));
        }
        return out;
      },
    }),
  });
}

/** Group parsed accounts by mint, summing amounts; zero balances are dropped. */
export function groupHoldings(accounts: readonly ParsedTokenAccountLike[], program: string): TokenHolding[] {
  const byMint = new Map<string, bigint>();
  for (const a of accounts) {
    const info = a?.account?.data?.parsed?.info;
    const mint = info?.mint;
    const amt = info?.tokenAmount?.amount;
    if (typeof mint !== "string" || typeof amt !== "string" || !/^[0-9]{1,38}$/.test(amt)) continue;
    byMint.set(mint, (byMint.get(mint) ?? 0n) + BigInt(amt));
  }
  return [...byMint.entries()].filter(([, v]) => v > 0n).map(([mint, v]) => ({ mint, amountRaw: v.toString(), program }));
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
