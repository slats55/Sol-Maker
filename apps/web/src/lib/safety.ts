/**
 * Single source of truth for Soulmaker's safety posture *as shown in the UI*.
 *
 * This file holds NO live data and drives NO chain/wallet behaviour. It only
 * describes — for display — the modes, disclaimers, and hard guarantees defined
 * authoritatively in:
 *   - ../../../../SECURITY.md
 *   - ../../../../docs/WALLET_SAFETY_MODEL.md
 *
 * If anything here ever conflicts with those documents, those documents win.
 */

export const APP = {
  name: "Soulmaker",
  tagline: "Security-first Solana research command center",
  /** Honest current posture of this dashboard foundation. */
  posture: "PAPER-only · local · offline · no wallet",
} as const;

/** Trading modes, safest → most dangerous (docs/WALLET_SAFETY_MODEL.md). */
export type Mode = "PAPER" | "WATCH_ONLY" | "SIMULATION" | "DANGEROUS_BURNER_LIVE";

export type SafetyTone = "safe" | "caution" | "danger";

/**
 * Where each mode stands relative to this UI foundation. Nothing here is wired
 * to a chain or a wallet — these are descriptive, not interactive, states.
 */
export type ModeStatus = "active" | "available" | "gated";

export interface ModeInfo {
  readonly id: Mode;
  readonly label: string;
  readonly tone: SafetyTone;
  readonly status: ModeStatus;
  readonly needsKey: boolean;
  readonly readsChain: boolean;
  readonly buildsTx: boolean;
  readonly simulates: boolean;
  readonly sends: boolean;
  readonly summary: string;
}

export const MODES: readonly ModeInfo[] = [
  {
    id: "PAPER",
    label: "PAPER",
    tone: "safe",
    status: "active",
    needsKey: false,
    readsChain: false,
    buildsTx: false,
    simulates: false,
    sends: false,
    summary:
      "Default. Fully simulated, offline, no key, no chain access — the only honest live posture this dashboard has today.",
  },
  {
    id: "WATCH_ONLY",
    label: "WATCH_ONLY",
    tone: "safe",
    status: "available",
    needsKey: false,
    readsChain: true,
    buildsTx: false,
    simulates: false,
    sends: false,
    summary:
      "Reads public chain state with public keys only. Refuses secret-length input. No build, simulate, or send.",
  },
  {
    id: "SIMULATION",
    label: "SIMULATION",
    tone: "caution",
    status: "available",
    needsKey: false,
    readsChain: true,
    buildsTx: true,
    simulates: true,
    sends: false,
    summary:
      "Builds and simulates transactions for human-readable preview only — never sends. Roadmap Phase 6, not started.",
  },
  {
    id: "DANGEROUS_BURNER_LIVE",
    label: "DANGEROUS_BURNER_LIVE",
    tone: "danger",
    status: "gated",
    needsKey: true,
    readsChain: true,
    buildsTx: true,
    simulates: true,
    sends: true,
    summary:
      "Burner-only live sending behind every fail-closed gate. Roadmap Phase 7 — not started and not reachable from this UI.",
  },
] as const;

/** The current, honest mode of this foundation. */
export const CURRENT_MODE: Mode = "PAPER";

/** Look up a mode descriptor; throws on an unknown id (display-time invariant). */
export function modeInfo(id: Mode): ModeInfo {
  const found = MODES.find((mode) => mode.id === id);
  if (!found) {
    throw new Error(`Unknown mode: ${id}`);
  }
  return found;
}

/** The required, always-visible safety statements for this dashboard. */
export const SAFETY_DISCLAIMERS: readonly string[] = [
  "PAPER ONLY",
  "No live trading",
  "No wallet connected",
  "No signing or sending",
  "Local simulated reports only",
  "Not financial advice",
  "Not a profitability claim",
];

/** Hard guarantees — things this dashboard (and Soulmaker) will never do. */
export const NEVER_DOES: readonly string[] = [
  "Connect a wallet or hold a private key",
  "Accept or derive from a seed / recovery phrase",
  "Use the operator's main wallet",
  "Sign, send, build, plan, or simulate a transaction",
  "Auto-approve anything or send to an unseen address",
  "Fetch live market data, scrape, or call a trading / data provider",
  "Show fake balances, fake PnL, or a fake 'connected' / 'running' state",
];

/** Strategy decisions emitted by `@soulmaker/strategy` (display only). */
export type StrategyDecision =
  | "SKIP"
  | "WATCH"
  | "PAPER_BUY_CANDIDATE"
  | "PAPER_SELL_CANDIDATE";

/** Advisory risk decisions emitted by `@soulmaker/risk` (display only). */
export type RiskDecision = "REJECT" | "CAUTION" | "PASS_FOR_PAPER_EVALUATION";
