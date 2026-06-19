/**
 * The CHAIN ADAPTER boundary (Sprint 107, Part 1).
 *
 * A typed seam so the rest of the system never hard-codes "Solana". In Part 1, Solana mainnet is
 * the ONLY chain with a live implementation; every other chain is an honest disabled stub that
 * declares itself not-implemented. The UI reads these to show chain readiness without ever
 * pretending an unbuilt chain can trade.
 *
 * This module holds NO network, signer, or wallet code — it is a capability descriptor only.
 */

import { LIVE_SOLANA_MAINNET_CHAIN_ID } from "./policy.js";

export const CHAIN_LIVE_STATUSES = ["live_capable", "planned", "not_implemented"] as const;
export type ChainLiveStatus = (typeof CHAIN_LIVE_STATUSES)[number];

export interface ChainAdapterCapabilities {
  /** Can fetch a real quote/route for this chain. */
  quote: boolean;
  /** Can run a read-only risk assessment for this chain. */
  risk: boolean;
  /** Can build an unsigned, simulatable transaction for this chain. */
  preflight: boolean;
  /** Can hand an unsigned transaction to a browser wallet for the human to sign. */
  walletSign: boolean;
}

export interface ChainAdapter {
  chainId: string;
  displayName: string;
  /** The cluster/network identifier (e.g. "mainnet-beta"). */
  network: string;
  liveStatus: ChainLiveStatus;
  /** The browser wallet used for signing when live, or null when not implemented. */
  walletProvider: "phantom" | null;
  capabilities: ChainAdapterCapabilities;
  /** Operator-facing note, especially for not-implemented chains. */
  note: string;
}

const NOT_IMPLEMENTED_CAPS: ChainAdapterCapabilities = { quote: false, risk: false, preflight: false, walletSign: false };

/** Solana mainnet — the only chain with a live implementation in Part 1. */
export const SOLANA_MAINNET_ADAPTER: ChainAdapter = {
  chainId: LIVE_SOLANA_MAINNET_CHAIN_ID,
  displayName: "Solana (mainnet-beta)",
  network: "mainnet-beta",
  liveStatus: "live_capable",
  walletProvider: "phantom",
  capabilities: { quote: true, risk: true, preflight: true, walletSign: true },
  note: "Live implementation: real Jupiter quote/route, read-only risk, unsigned-tx preflight, Phantom browser signing. Disabled by default; micro-capped; human confirms every transaction.",
};

/** Future chains. Disabled stubs — present so the UI can show readiness, never tradeable in Part 1. */
export const PLANNED_CHAIN_ADAPTERS: readonly ChainAdapter[] = [
  {
    chainId: "ethereum-mainnet",
    displayName: "Ethereum (mainnet)",
    network: "mainnet",
    liveStatus: "not_implemented",
    walletProvider: null,
    capabilities: NOT_IMPLEMENTED_CAPS,
    note: "Planned for a later part. No EVM adapter is implemented — this chain cannot quote, risk-check, preflight, or sign.",
  },
  {
    chainId: "base-mainnet",
    displayName: "Base (mainnet)",
    network: "mainnet",
    liveStatus: "not_implemented",
    walletProvider: null,
    capabilities: NOT_IMPLEMENTED_CAPS,
    note: "Planned for a later part. No EVM adapter is implemented — this chain cannot quote, risk-check, preflight, or sign.",
  },
  {
    chainId: "bsc-mainnet",
    displayName: "BNB Smart Chain (mainnet)",
    network: "mainnet",
    liveStatus: "not_implemented",
    walletProvider: null,
    capabilities: NOT_IMPLEMENTED_CAPS,
    note: "Planned for a later part. No EVM adapter is implemented — this chain cannot quote, risk-check, preflight, or sign.",
  },
];

export const ALL_CHAIN_ADAPTERS: readonly ChainAdapter[] = [SOLANA_MAINNET_ADAPTER, ...PLANNED_CHAIN_ADAPTERS];

/** Look up an adapter by chain id. Returns null for an unknown chain. */
export function chainAdapterFor(chainId: string): ChainAdapter | null {
  return ALL_CHAIN_ADAPTERS.find((a) => a.chainId === chainId) ?? null;
}

/** True only for a chain whose live implementation actually exists. */
export function isLiveCapableChain(chainId: string): boolean {
  return chainAdapterFor(chainId)?.liveStatus === "live_capable";
}
