/**
 * CONTINUOUS PAPER DAEMON STATE (`live.sniper.daemon.state.v1`, Sprint 109).
 *
 * The PURE state core of the continuous paper sniper daemon. The CLI owns the clock, the network
 * adapters, and the files; everything decidable lives here so it can be tested exactly:
 *
 *   - cross-loop candidate DEDUPLICATION (a mint is processed once per session, not once per poll),
 *   - a RISK CACHE with TTL (a real risk report is reused within its TTL, re-fetched after),
 *   - PROVIDER HEALTH with rate-limit backoff (a provider that returned blocked/unavailable is
 *     backed off exponentially and re-tried later; one bad provider never kills the run),
 *   - honest per-loop TOTALS that only ever count what really happened.
 *
 * Hard rules:
 *   - The daemon mode set is CLOSED to ["paper"]. There is no live daemon mode to misconfigure:
 *     a state claiming any other mode is refused. The daemon can therefore never trade.
 *   - State is round-trippable JSON: `validateDaemonState` re-derives every invariant on resume.
 *   - Nothing here fabricates data: a provider failure is a recorded status, never a retry-lie.
 *
 * Pure: the caller supplies every timestamp; no clock, no network, no randomness, no I/O.
 */

import { isSensitiveKey } from "@soulmaker/security";

import { isValidMint } from "./discovery.js";
import type { SniperCandidate, SniperCandidateRisk } from "./discovery.js";

export const LIVE_SNIPER_DAEMON_STATE_SCHEMA_VERSION = "live.sniper.daemon.state.v1";
export const LIVE_SNIPER_DAEMON_SUMMARY_SCHEMA_VERSION = "live.sniper.daemon.summary.v1";

/** The ONLY daemon mode. Closed by design: a daemon cannot be configured toward live. */
export const DAEMON_MODES = ["paper"] as const;
export type DaemonMode = (typeof DAEMON_MODES)[number];

/** Default TTL for a cached risk report (ms). Risk facts go stale; 10 minutes is generous. */
export const DAEMON_RISK_CACHE_TTL_MS = 600_000;

/** Backoff schedule for a failing provider: base doubles per consecutive failure, capped. */
export const DAEMON_BACKOFF_BASE_MS = 30_000;
export const DAEMON_BACKOFF_MAX_MS = 600_000;

export interface DaemonRiskCacheEntry {
  mint: string;
  fetchedAtMs: number;
  risk: SniperCandidateRisk;
}

export interface DaemonProviderHealth {
  provider: string;
  observed: number;
  unavailable: number;
  blocked: number;
  error: number;
  unsupported: number;
  lastStatus: string | null;
  lastDetail: string | null;
  consecutiveFailures: number;
  /** The provider is skipped until this ms timestamp (0 = not backed off). */
  backoffUntilMs: number;
}

export interface DaemonTotals {
  loops: number;
  candidatesSeen: number;
  newCandidates: number;
  duplicatesSkipped: number;
  riskChecked: number;
  riskCacheHits: number;
  riskRejected: number;
  quotesFetched: number;
  quotesStale: number;
  quotesUnavailable: number;
  liquidityRejected: number;
  positionsOpened: number;
  positionsClosed: number;
  providerFailures: number;
}

export interface DaemonState {
  schemaVersion: typeof LIVE_SNIPER_DAEMON_STATE_SCHEMA_VERSION;
  mode: DaemonMode;
  profileName: string;
  startedAt: string;
  /** Last completed loop's ISO timestamp (null before the first loop finishes). */
  lastLoopAt: string | null;
  /** Every mint processed this session (cross-loop dedupe; first-seen wins). */
  seenMints: string[];
  riskCache: DaemonRiskCacheEntry[];
  providerHealth: DaemonProviderHealth[];
  totals: DaemonTotals;
  /** Tally of no-trade reasons observed (reason → count). Honest, additive, never rewritten. */
  noTradeReasons: Record<string, number>;
  /** Pinned honesty literals: the daemon observes and paper-trades; it can never send. */
  daemonNeverSends: true;
  notProfitabilityClaim: true;
}

export class DaemonStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DaemonStateError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function emptyDaemonTotals(): DaemonTotals {
  return {
    loops: 0,
    candidatesSeen: 0,
    newCandidates: 0,
    duplicatesSkipped: 0,
    riskChecked: 0,
    riskCacheHits: 0,
    riskRejected: 0,
    quotesFetched: 0,
    quotesStale: 0,
    quotesUnavailable: 0,
    liquidityRejected: 0,
    positionsOpened: 0,
    positionsClosed: 0,
    providerFailures: 0,
  };
}

export function createDaemonState(input: { startedAt: string; profileName: string; mode?: string }): DaemonState {
  const mode = input.mode ?? "paper";
  if (!(DAEMON_MODES as readonly string[]).includes(mode)) {
    throw new DaemonStateError(`daemon mode must be "paper" — there is no live daemon mode, by design`);
  }
  if (typeof input.profileName !== "string" || input.profileName.trim().length === 0) {
    throw new DaemonStateError("profileName is required");
  }
  return {
    schemaVersion: LIVE_SNIPER_DAEMON_STATE_SCHEMA_VERSION,
    mode: mode as DaemonMode,
    profileName: input.profileName.trim(),
    startedAt: input.startedAt,
    lastLoopAt: null,
    seenMints: [],
    riskCache: [],
    providerHealth: [],
    totals: emptyDaemonTotals(),
    noTradeReasons: {},
    daemonNeverSends: true,
    notProfitabilityClaim: true,
  };
}

// ---------------------------------------------------------------------------
// Cross-loop dedupe
// ---------------------------------------------------------------------------

export interface DedupeAcrossLoopsResult {
  state: DaemonState;
  fresh: SniperCandidate[];
  duplicates: SniperCandidate[];
}

/** Split candidates into first-seen-this-session vs already-processed; record both honestly. */
export function dedupeAcrossLoops(state: DaemonState, candidates: readonly SniperCandidate[]): DedupeAcrossLoopsResult {
  const seen = new Set(state.seenMints);
  const fresh: SniperCandidate[] = [];
  const duplicates: SniperCandidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.mint)) {
      duplicates.push(c);
      continue;
    }
    seen.add(c.mint);
    fresh.push(c);
  }
  return {
    state: {
      ...state,
      seenMints: [...seen],
      totals: {
        ...state.totals,
        candidatesSeen: state.totals.candidatesSeen + candidates.length,
        newCandidates: state.totals.newCandidates + fresh.length,
        duplicatesSkipped: state.totals.duplicatesSkipped + duplicates.length,
      },
    },
    fresh,
    duplicates,
  };
}

// ---------------------------------------------------------------------------
// Risk cache (TTL)
// ---------------------------------------------------------------------------

/** A cached risk report, if present and within TTL; expired entries are misses, never trusted. */
export function riskCacheGet(state: DaemonState, mint: string, nowMs: number, ttlMs: number = DAEMON_RISK_CACHE_TTL_MS): SniperCandidateRisk | null {
  const entry = state.riskCache.find((e) => e.mint === mint);
  if (entry === undefined) return null;
  const age = nowMs - entry.fetchedAtMs;
  if (age < 0 || age > ttlMs) return null;
  return entry.risk;
}

/** Store a REAL risk report (replaces any prior entry for the mint). */
export function riskCachePut(state: DaemonState, mint: string, risk: SniperCandidateRisk, nowMs: number): DaemonState {
  const rest = state.riskCache.filter((e) => e.mint !== mint);
  return { ...state, riskCache: [...rest, { mint, fetchedAtMs: nowMs, risk }] };
}

// ---------------------------------------------------------------------------
// Provider health + backoff
// ---------------------------------------------------------------------------

function healthFor(state: DaemonState, provider: string): DaemonProviderHealth {
  return (
    state.providerHealth.find((h) => h.provider === provider) ?? {
      provider,
      observed: 0,
      unavailable: 0,
      blocked: 0,
      error: 0,
      unsupported: 0,
      lastStatus: null,
      lastDetail: null,
      consecutiveFailures: 0,
      backoffUntilMs: 0,
    }
  );
}

export type ProviderOutcomeStatus = "observed" | "unavailable" | "blocked" | "error" | "unsupported";

/**
 * Record one provider outcome. A non-observed outcome increments the failure streak and schedules
 * an exponential backoff (base 30s, doubling, capped at 10 min); an observed outcome clears both.
 */
export function recordProviderOutcome(
  state: DaemonState,
  provider: string,
  status: ProviderOutcomeStatus,
  nowMs: number,
  detail?: string | null,
): DaemonState {
  const prev = healthFor(state, provider);
  const failed = status !== "observed";
  const consecutiveFailures = failed ? prev.consecutiveFailures + 1 : 0;
  const backoffUntilMs = failed
    ? nowMs + Math.min(DAEMON_BACKOFF_MAX_MS, DAEMON_BACKOFF_BASE_MS * 2 ** Math.min(10, consecutiveFailures - 1))
    : 0;
  const next: DaemonProviderHealth = {
    ...prev,
    [status]: prev[status] + 1,
    lastStatus: status,
    lastDetail: detail === undefined || detail === null ? prev.lastDetail : detail.slice(0, 200),
    consecutiveFailures,
    backoffUntilMs,
  };
  const rest = state.providerHealth.filter((h) => h.provider !== provider);
  return {
    ...state,
    providerHealth: [...rest, next].sort((a, b) => (a.provider < b.provider ? -1 : 1)),
    totals: { ...state.totals, providerFailures: state.totals.providerFailures + (failed ? 1 : 0) },
  };
}

/** Whether a provider should be polled now (false while it is backed off). */
export function providerAllowed(state: DaemonState, provider: string, nowMs: number): boolean {
  const h = state.providerHealth.find((x) => x.provider === provider);
  return h === undefined || nowMs >= h.backoffUntilMs;
}

// ---------------------------------------------------------------------------
// No-trade reasons + loop bookkeeping
// ---------------------------------------------------------------------------

export function recordNoTradeReasons(state: DaemonState, reasons: readonly string[]): DaemonState {
  if (reasons.length === 0) return state;
  const tally = { ...state.noTradeReasons };
  for (const r of reasons) {
    const key = r.slice(0, 120);
    tally[key] = (tally[key] ?? 0) + 1;
  }
  return { ...state, noTradeReasons: tally };
}

export function bumpTotals(state: DaemonState, delta: Partial<DaemonTotals>): DaemonState {
  const totals = { ...state.totals };
  for (const [k, v] of Object.entries(delta)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      totals[k as keyof DaemonTotals] += v;
    }
  }
  return { ...state, totals };
}

export function completeLoop(state: DaemonState, loopAt: string): DaemonState {
  return { ...state, lastLoopAt: loopAt, totals: { ...state.totals, loops: state.totals.loops + 1 } };
}

// ---------------------------------------------------------------------------
// Validation (resume path)
// ---------------------------------------------------------------------------

const STATE_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "mode",
  "profileName",
  "startedAt",
  "lastLoopAt",
  "seenMints",
  "riskCache",
  "providerHealth",
  "totals",
  "noTradeReasons",
  "daemonNeverSends",
  "notProfitabilityClaim",
]);

/** Strictly validate a persisted daemon state (closed schema; mode re-pinned to paper). */
export function validateDaemonState(value: unknown): DaemonState {
  if (!isObject(value)) throw new DaemonStateError("daemon state must be a JSON object");
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) throw new DaemonStateError(`daemon state carries sensitive-named field "${key}"`);
    if (!STATE_KEYS.has(key)) throw new DaemonStateError(`daemon state carries unknown field "${key}" — the v1 schema is CLOSED`);
  }
  if (value.schemaVersion !== LIVE_SNIPER_DAEMON_STATE_SCHEMA_VERSION) {
    throw new DaemonStateError(`daemon state.schemaVersion must be "${LIVE_SNIPER_DAEMON_STATE_SCHEMA_VERSION}"`);
  }
  if (value.mode !== "paper") {
    throw new DaemonStateError('daemon state.mode must be "paper" — there is no live daemon mode');
  }
  if (value.daemonNeverSends !== true || value.notProfitabilityClaim !== true) {
    throw new DaemonStateError("daemon state honesty literals must be the literal true");
  }
  if (typeof value.profileName !== "string" || value.profileName.length === 0) {
    throw new DaemonStateError("daemon state.profileName must be a non-empty string");
  }
  if (typeof value.startedAt !== "string" || !Number.isFinite(Date.parse(value.startedAt))) {
    throw new DaemonStateError("daemon state.startedAt must be a parseable ISO timestamp");
  }
  if (!Array.isArray(value.seenMints) || value.seenMints.some((m) => !isValidMint(m))) {
    throw new DaemonStateError("daemon state.seenMints must be an array of valid mints");
  }
  if (!Array.isArray(value.riskCache) || !Array.isArray(value.providerHealth)) {
    throw new DaemonStateError("daemon state.riskCache and providerHealth must be arrays");
  }
  if (!isObject(value.totals) || !isObject(value.noTradeReasons)) {
    throw new DaemonStateError("daemon state.totals and noTradeReasons must be objects");
  }
  const totals = emptyDaemonTotals();
  for (const key of Object.keys(totals) as (keyof DaemonTotals)[]) {
    const v = (value.totals as Record<string, unknown>)[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw new DaemonStateError(`daemon state.totals.${key} must be a non-negative integer`);
    }
    totals[key] = v;
  }
  return {
    schemaVersion: LIVE_SNIPER_DAEMON_STATE_SCHEMA_VERSION,
    mode: "paper",
    profileName: value.profileName,
    startedAt: value.startedAt,
    lastLoopAt: typeof value.lastLoopAt === "string" ? value.lastLoopAt : null,
    seenMints: value.seenMints as string[],
    riskCache: value.riskCache as DaemonRiskCacheEntry[],
    providerHealth: value.providerHealth as DaemonProviderHealth[],
    totals,
    noTradeReasons: value.noTradeReasons as Record<string, number>,
    daemonNeverSends: true,
    notProfitabilityClaim: true,
  };
}

// ---------------------------------------------------------------------------
// Session summary
// ---------------------------------------------------------------------------

export interface DaemonSummary {
  schemaVersion: typeof LIVE_SNIPER_DAEMON_SUMMARY_SCHEMA_VERSION;
  mode: DaemonMode;
  profileName: string;
  startedAt: string;
  endedAt: string;
  endedBy: "duration-elapsed" | "operator-interrupt" | "max-loops-reached";
  totals: DaemonTotals;
  noTradeReasons: Record<string, number>;
  providerHealth: DaemonProviderHealth[];
  /** Positions snapshot totals (from the ledger, recomputed there — echoed here for the report). */
  positions: { open: number; closed: number; realizedPnlKnownLamports: number; closedPnlUnknown: number };
  caveats: string[];
  daemonNeverSends: true;
  notProfitabilityClaim: true;
}

export const DAEMON_SUMMARY_CAVEATS: readonly string[] = [
  "This was a PAPER session: no funds were held, moved, or risked; no order was placed.",
  "Every candidate came from a real public feed (or an operator mint); nothing was fabricated.",
  "Realized PnL sums KNOWN paper closes only; unknown-PnL closes are counted, never guessed.",
  "A paper result is NOT a live result: fills, fees, latency and MEV are not modeled here.",
];

export function buildDaemonSummary(
  state: DaemonState,
  input: {
    endedAt: string;
    endedBy: DaemonSummary["endedBy"];
    positions: { open: number; closed: number; realizedPnlKnownLamports: number; closedPnlUnknown: number };
  },
): DaemonSummary {
  return {
    schemaVersion: LIVE_SNIPER_DAEMON_SUMMARY_SCHEMA_VERSION,
    mode: state.mode,
    profileName: state.profileName,
    startedAt: state.startedAt,
    endedAt: input.endedAt,
    endedBy: input.endedBy,
    totals: { ...state.totals },
    noTradeReasons: { ...state.noTradeReasons },
    providerHealth: [...state.providerHealth],
    positions: { ...input.positions },
    caveats: [...DAEMON_SUMMARY_CAVEATS],
    daemonNeverSends: true,
    notProfitabilityClaim: true,
  };
}
