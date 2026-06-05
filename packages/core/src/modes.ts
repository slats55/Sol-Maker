/**
 * Trading modes, ordered from safest to most dangerous.
 *
 *  PAPER                 — fully simulated. No RPC writes, no key custody. Default.
 *  WATCH_ONLY            — read-only chain monitoring. Public keys only, no sends.
 *  SIMULATION            — builds real transactions and simulates them on the
 *                          RPC (simulateTransaction) but NEVER signs or sends.
 *  DANGEROUS_BURNER_LIVE — the only mode that can sign and send. Burner wallet
 *                          only, tiny caps, behind multiple explicit gates.
 */
export const TRADING_MODES = [
  "PAPER",
  "WATCH_ONLY",
  "SIMULATION",
  "DANGEROUS_BURNER_LIVE",
] as const;

export type TradingMode = (typeof TRADING_MODES)[number];

export interface ModeCapabilities {
  /** Reads chain state (balances, pools, token metadata). */
  readonly canReadChain: boolean;
  /** Builds real transactions (unsigned). */
  readonly canBuildTransactions: boolean;
  /** Runs RPC simulateTransaction. */
  readonly canSimulate: boolean;
  /** Signs and broadcasts transactions. Only ever true for burner-live. */
  readonly canSend: boolean;
  /** True for any mode that could move real funds. */
  readonly isLive: boolean;
}

const CAPABILITIES: Record<TradingMode, ModeCapabilities> = {
  PAPER: {
    canReadChain: false,
    canBuildTransactions: false,
    canSimulate: false,
    canSend: false,
    isLive: false,
  },
  WATCH_ONLY: {
    canReadChain: true,
    canBuildTransactions: false,
    canSimulate: false,
    canSend: false,
    isLive: false,
  },
  SIMULATION: {
    canReadChain: true,
    canBuildTransactions: true,
    canSimulate: true,
    canSend: false,
    isLive: false,
  },
  DANGEROUS_BURNER_LIVE: {
    canReadChain: true,
    canBuildTransactions: true,
    canSimulate: true,
    canSend: true,
    isLive: true,
  },
};

export function capabilitiesFor(mode: TradingMode): ModeCapabilities {
  return CAPABILITIES[mode];
}

export function isLiveMode(mode: TradingMode): boolean {
  return CAPABILITIES[mode].isLive;
}

export function describeMode(mode: TradingMode): string {
  const c = CAPABILITIES[mode];
  const caps = [
    c.canReadChain ? "read-chain" : null,
    c.canBuildTransactions ? "build-tx" : null,
    c.canSimulate ? "simulate" : null,
    c.canSend ? "SEND" : null,
  ]
    .filter(Boolean)
    .join(", ");
  return `${mode} [${caps || "no on-chain actions"}]`;
}
