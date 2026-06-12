/**
 * Read-only Solana RPC client.
 *
 * Wraps `@solana/web3.js` `Connection` but exposes ONLY read methods. There is
 * deliberately no `sendTransaction`, `signTransaction`, `requestAirdrop`, or any
 * signer on the returned object — a test asserts this. Production code builds a
 * real `Connection`; tests inject a `SolanaRpcLike` fake so unit tests never
 * touch the network.
 */

import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { redactString } from "@soulmaker/security";
import { parsePublicKey } from "./public-key.js";
import { buildTokenHolderConcentration, buildTokenMetadataInfo } from "./deep-inspect.js";
import { summarizeToken2022Extensions } from "./token2022.js";
import type {
  ReadOnlyClientConfig,
  ReadOnlySolanaClient,
  RpcHealth,
  RpcVersion,
  SolBalance,
  SolanaRpcLike,
  PublicKeyInput,
  TokenAccountSummary,
  TokenMintInfo,
  TokenProgramLabel,
} from "./types.js";

interface ParsedMintInfo {
  decimals: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  supply: string;
  isInitialized: boolean;
  /** Token-2022 extension entries (jsonParsed); absent on classic mints / extensionless mints. */
  extensions?: unknown;
}

interface ParsedTokenAmount {
  amount: string;
  decimals: number;
  uiAmount: number | null;
}

interface ParsedTokenAccountInfo {
  mint: string;
  tokenAmount: ParsedTokenAmount;
}

const TOKEN_PROGRAMS: ReadonlyArray<{ id: PublicKey; label: TokenProgramLabel }> =
  [
    { id: TOKEN_PROGRAM_ID, label: "spl-token" },
    { id: TOKEN_2022_PROGRAM_ID, label: "spl-token-2022" },
  ];

function coercePublicKey(input: PublicKeyInput): PublicKey {
  return typeof input === "string" ? parsePublicKey(input) : input;
}

/** Host only — strips path and any `?api-key=` query so it is safe to display. */
export function endpointHostOf(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).host;
  } catch {
    // Not a parseable URL; never echo it raw — redact instead.
    return redactString(rpcUrl);
  }
}

function labelForProgram(owner: PublicKey): TokenProgramLabel | "unknown" {
  const match = TOKEN_PROGRAMS.find((p) => p.id.equals(owner));
  return match ? match.label : "unknown";
}

/** Adapt a real `Connection` into the narrow read-only seam. */
function adaptConnection(conn: Connection): SolanaRpcLike {
  return {
    getVersion: () => conn.getVersion(),
    getSlot: (c) => conn.getSlot(c),
    getBalance: (pk, c) => conn.getBalance(pk, c),
    getParsedAccountInfo: (pk, c) => conn.getParsedAccountInfo(pk, c),
    getParsedTokenAccountsByOwner: (o, f, c) =>
      conn.getParsedTokenAccountsByOwner(o, f, c),
    // Sprint 92 deep reads (still reads only — no send/sign/airdrop on this seam).
    getTokenLargestAccounts: (pk, c) => conn.getTokenLargestAccounts(pk, c),
    getAccountInfo: (pk, c) => conn.getAccountInfo(pk, c),
  };
}

export interface ClientFromRpcOptions {
  endpointHost: string;
}

/** Build a read-only client over any `SolanaRpcLike` (real or fake). */
export function createClientFromRpc(
  rpc: SolanaRpcLike,
  options: ClientFromRpcOptions,
): ReadOnlySolanaClient {
  const endpointHost = options.endpointHost;

  async function getVersion(): Promise<RpcVersion> {
    const v = await rpc.getVersion();
    return { solanaCore: v["solana-core"], featureSet: v["feature-set"] };
  }

  async function getRpcHealth(): Promise<RpcHealth> {
    try {
      const [version, slot] = await Promise.all([rpc.getVersion(), rpc.getSlot()]);
      return {
        ok: true,
        endpointHost,
        solanaCore: version["solana-core"],
        featureSet: version["feature-set"],
        slot,
      };
    } catch (err) {
      return {
        ok: false,
        endpointHost,
        error: redactString((err as Error).message ?? String(err)),
      };
    }
  }

  async function getSolBalance(owner: PublicKeyInput): Promise<SolBalance> {
    const pk = coercePublicKey(owner);
    const lamports = await rpc.getBalance(pk);
    return {
      ownerBase58: pk.toBase58(),
      lamports,
      sol: lamports / LAMPORTS_PER_SOL,
    };
  }

  async function getTokenAccounts(
    owner: PublicKeyInput,
  ): Promise<TokenAccountSummary[]> {
    const pk = coercePublicKey(owner);
    const summaries: TokenAccountSummary[] = [];

    for (const program of TOKEN_PROGRAMS) {
      const resp = await rpc.getParsedTokenAccountsByOwner(pk, {
        programId: program.id,
      });
      for (const entry of resp.value) {
        const data = entry.account.data;
        const parsed = (data.parsed ?? {}) as { info?: ParsedTokenAccountInfo };
        const info = parsed.info;
        if (!info?.tokenAmount) continue;
        summaries.push({
          tokenAccount: entry.pubkey.toBase58(),
          mint: info.mint,
          programLabel: program.label,
          amountRaw: info.tokenAmount.amount,
          decimals: info.tokenAmount.decimals,
          uiAmount: info.tokenAmount.uiAmount ?? 0,
        });
      }
    }
    return summaries;
  }

  async function getTokenMintInfo(mint: PublicKeyInput): Promise<TokenMintInfo> {
    const pk = coercePublicKey(mint);
    const resp = await rpc.getParsedAccountInfo(pk);
    const value = resp.value;
    if (!value) {
      throw new Error(`mint account ${pk.toBase58()} not found`);
    }
    const data = value.data;
    if (Buffer.isBuffer(data) || !("parsed" in data)) {
      throw new Error(
        `account ${pk.toBase58()} is not a parsed SPL mint (raw/binary account)`,
      );
    }
    const parsed = data.parsed as { type?: string; info?: ParsedMintInfo };
    if (parsed.type !== "mint" || !parsed.info) {
      throw new Error(
        `account ${pk.toBase58()} is not a mint (type=${parsed.type ?? "unknown"})`,
      );
    }
    const info = parsed.info;
    const programLabel = labelForProgram(value.owner);
    return {
      mint: pk.toBase58(),
      decimals: info.decimals,
      supplyRaw: info.supply,
      uiSupply: Number(info.supply) / 10 ** info.decimals,
      mintAuthorityPresent: info.mintAuthority != null,
      freezeAuthorityPresent: info.freezeAuthority != null,
      isInitialized: info.isInitialized,
      programLabel,
      // S93: extension facts ride on the SAME jsonParsed read — no extra network call.
      token2022Extensions: summarizeToken2022Extensions(programLabel, info.extensions),
      source: "getParsedAccountInfo(jsonParsed)",
    };
  }

  // Sprint 92 deep reads — exposed only when the seam supports them; an absent
  // method is the honest "check unavailable" signal for callers.
  async function getTokenHolderConcentration(mint: PublicKeyInput) {
    const info = await getTokenMintInfo(mint);
    return buildTokenHolderConcentration(rpc, info);
  }
  async function getTokenMetadataInfo(mint: PublicKeyInput) {
    return buildTokenMetadataInfo(rpc, mint);
  }

  // Note: the returned object is a FROZEN literal of read-only methods. There is
  // no signer, no secret, and no send/sign/airdrop method to find.
  return Object.freeze({
    endpointHost,
    getRpcHealth,
    getVersion,
    getSolBalance,
    getTokenAccounts,
    getTokenMintInfo,
    ...(typeof rpc.getTokenLargestAccounts === "function" ? { getTokenHolderConcentration } : {}),
    ...(typeof rpc.getAccountInfo === "function" ? { getTokenMetadataInfo } : {}),
  });
}

/** Production entry point: build a read-only client from config (rpcUrl required). */
export function createReadOnlySolanaClient(
  config: ReadOnlyClientConfig,
): ReadOnlySolanaClient {
  if (!config.rpcUrl || config.rpcUrl.trim().length === 0) {
    throw new Error("createReadOnlySolanaClient requires a non-empty rpcUrl");
  }
  const connection = new Connection(
    config.rpcUrl,
    config.commitment ?? "confirmed",
  );
  return createClientFromRpc(adaptConnection(connection), {
    endpointHost: endpointHostOf(config.rpcUrl),
  });
}
