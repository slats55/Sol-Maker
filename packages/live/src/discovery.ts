/**
 * REAL-TIME MEMECOIN CANDIDATE DISCOVERY (`live.sniper.candidate.v1`, Sprint 108, Part 2).
 *
 * The normalization seam between a REAL candidate feed and the Part 2 sniper loop. It does NOT
 * fetch anything itself — it consumes observations produced by the existing real sources
 * (`@soulmaker/realtime`: the live Jupiter recent-tokens feed, a replay file) or a manual operator
 * mint, and turns each into a typed {@link SniperCandidate} carrying explicit provenance, the set of
 * data that was missing, and a transparent confidence. There is no parallel fake feed here: a
 * candidate the loop never saw on a real source (or that the operator never typed) cannot exist.
 *
 * Honesty + fail-closed contract:
 *   - A candidate is an OBSERVATION, never an order. Every candidate pins `isObservationNotTrade`.
 *   - A malformed / secret-shaped mint is REFUSED (never normalized into a candidate).
 *   - Provenance is REQUIRED: a candidate with no source provider is refused.
 *   - Replay data is marked `replay` and can never be presented as a live feed.
 *   - Duplicate mints are de-duplicated (first-seen wins, later ones reported), never double-counted.
 *   - Missing market facts are recorded in `missingData` and LOWER confidence — they are never
 *     invented. Discovery makes no profitability claim and authorizes nothing.
 *
 * Pure: the caller supplies `discoveredAt`; no clock, no network, no randomness.
 */

import { isSensitiveKey, redactString } from "@soulmaker/security";

export const LIVE_SNIPER_CANDIDATE_SCHEMA_VERSION = "live.sniper.candidate.v1";

/** The only chain Part 2 discovers for (Solana mainnet; other chains are not implemented). */
export const LIVE_SNIPER_CANDIDATE_CHAIN = "solana";

/** How a candidate entered the system. `live_feed` and `replay` come from real source adapters. */
export const DISCOVERY_SOURCE_KINDS = ["live_feed", "replay", "manual"] as const;
export type DiscoverySourceKind = (typeof DISCOVERY_SOURCE_KINDS)[number];

/**
 * The closed set of discovery lifecycle events. The loop emits these as a candidate moves through
 * the pipeline; nothing here can mean a trade happened.
 */
export const DISCOVERY_EVENTS = [
  "candidate-discovered",
  "candidate-rejected",
  "candidate-watchlisted",
  "candidate-scored",
  "candidate-quote-ready",
  "candidate-risk-blocked",
  "candidate-canary-eligible",
] as const;
export type DiscoveryEvent = (typeof DISCOVERY_EVENTS)[number];

/** Optional, read-only risk hints carried from a real risk pass (never fabricated). */
export interface SniperCandidateRisk {
  score: number;
  decision: string;
  criticalFlagCount: number;
  freezeAuthorityPresent: boolean | null;
  mintAuthorityPresent: boolean | null;
}

export interface SniperCandidateProvenance {
  /** Distinct providers that contributed to this candidate (kebab-case ids). */
  providers: string[];
  sourceKind: DiscoverySourceKind;
  /** Honest note — e.g. that replay data is not live. */
  note: string;
}

export interface SniperCandidate {
  schemaVersion: typeof LIVE_SNIPER_CANDIDATE_SCHEMA_VERSION;
  chain: typeof LIVE_SNIPER_CANDIDATE_CHAIN;
  mint: string;
  symbol: string | null;
  name: string | null;
  /** Pool/market id when a provider reports one. */
  poolId: string | null;
  sourceProvider: string;
  sourceKind: DiscoverySourceKind;
  discoveredAt: string;
  /** On-chain slot if a provider reported one. */
  slot: number | null;
  /** Block time (ISO) if available. */
  blockTime: string | null;
  /** Provider-reported HINTS — unverified; null when not reported. */
  liquidityUsd: number | null;
  /** Whether a route/quote is known to be available (null = unknown, not yet checked). */
  quoteAvailable: boolean | null;
  routeProvider: string | null;
  poolAgeSeconds: number | null;
  volumeUsd: number | null;
  buys: number | null;
  sells: number | null;
  risk: SniperCandidateRisk | null;
  provenance: SniperCandidateProvenance;
  /** Names of facts that were not available (each one lowers confidence). */
  missingData: string[];
  /** Transparent 0..1 confidence in the candidate's DATA (not a profit/quality prediction). */
  confidence: number;
  /** Pinned honesty literals. */
  isObservationNotTrade: true;
  notProfitabilityClaim: true;
}

export interface DiscoveryRejection {
  mint: string | null;
  reason: string;
}

export class DiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryError";
  }
}

/**
 * The structural shape discovery consumes from a real source adapter. `@soulmaker/realtime`'s
 * `CandidateObservation` satisfies this verbatim — discovery is deliberately decoupled from that
 * package so it stays testable in isolation, but the CLI feeds REAL observations through it.
 */
export interface ObservationInput {
  mint: string;
  symbol?: string | null;
  name?: string | null;
  sourceProviderId: string;
  sourceKind: "live" | "replay";
  observedAtLabel?: string | null;
  launchpadLabel?: string | null;
  liquidityUsdHint?: number | null;
  marketCapUsdHint?: number | null;
  holderCountHint?: number | null;
  slot?: number | null;
}

export interface ManualMintInput {
  mint: string;
  symbol?: string | null;
  name?: string | null;
  /** Who typed it — defaults to "operator-manual". */
  sourceProvider?: string;
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * A valid Solana mint is base58, 32..44 chars. A 64-byte secret key base58-encodes to ~88 chars, so
 * anything longer than 44 is refused — key material can never be normalized into a candidate.
 */
export function isValidMint(value: unknown): value is string {
  return typeof value === "string" && value.length >= 32 && value.length <= 44 && BASE58_RE.test(value);
}

function shortText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const clipped = trimmed.length > max ? trimmed.slice(0, max) : trimmed;
  // Never let a secret-shaped string ride along on a display field.
  return redactString(clipped) === clipped ? clipped : null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function intOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Confidence is a transparent function of how much real data we actually have. It starts low and
 * rises only with corroborating facts; it is NOT a quality or profit prediction. A replay source is
 * penalized so stale data can never look as trustworthy as a live observation.
 */
export function computeConfidence(c: Omit<SniperCandidate, "confidence">): number {
  let conf = 0.2;
  if (c.risk !== null) conf += 0.2;
  if (c.liquidityUsd !== null) conf += 0.15;
  if (c.poolAgeSeconds !== null) conf += 0.1;
  if (c.volumeUsd !== null) conf += 0.1;
  if (c.quoteAvailable === true) conf += 0.15;
  if (c.symbol !== null) conf += 0.05;
  if (c.sourceKind === "replay") conf -= 0.15;
  if (c.sourceKind === "manual") conf -= 0.05;
  return Math.max(0, Math.min(1, Math.round(conf * 100) / 100));
}

const MISSING_FIELDS: ReadonlyArray<[keyof Omit<SniperCandidate, "confidence" | "missingData">, string]> = [
  ["risk", "risk"],
  ["liquidityUsd", "liquidityUsd"],
  ["poolAgeSeconds", "poolAgeSeconds"],
  ["volumeUsd", "volumeUsd"],
  ["routeProvider", "routeProvider"],
];

function finalize(base: Omit<SniperCandidate, "confidence" | "missingData">): SniperCandidate {
  const missingData: string[] = [];
  for (const [field, label] of MISSING_FIELDS) {
    if (base[field] === null) missingData.push(label);
  }
  if (base.quoteAvailable === null) missingData.push("quoteAvailable");
  const withMissing = { ...base, missingData } as Omit<SniperCandidate, "confidence">;
  return { ...withMissing, confidence: computeConfidence(withMissing) };
}

/** Normalize one real source observation into a {@link SniperCandidate}, or throw on a bad mint. */
export function normalizeObservation(obs: ObservationInput, opts: { discoveredAt: string }): SniperCandidate {
  if (!isValidMint(obs.mint)) {
    throw new DiscoveryError(`observation mint is not a valid base58 mint (32..44 chars): refused`);
  }
  if (typeof obs.sourceProviderId !== "string" || obs.sourceProviderId.trim().length === 0) {
    throw new DiscoveryError("observation has no sourceProviderId — provenance is required");
  }
  const sourceKind: DiscoverySourceKind = obs.sourceKind === "replay" ? "replay" : "live_feed";
  const provider = shortText(obs.sourceProviderId, 60) ?? "unknown-source";
  const base: Omit<SniperCandidate, "confidence" | "missingData"> = {
    schemaVersion: LIVE_SNIPER_CANDIDATE_SCHEMA_VERSION,
    chain: LIVE_SNIPER_CANDIDATE_CHAIN,
    mint: obs.mint,
    symbol: shortText(obs.symbol, 32),
    name: shortText(obs.name, 64),
    poolId: null,
    sourceProvider: provider,
    sourceKind,
    discoveredAt: opts.discoveredAt,
    slot: intOrNull(obs.slot),
    blockTime: null,
    liquidityUsd: finiteOrNull(obs.liquidityUsdHint),
    quoteAvailable: null,
    routeProvider: null,
    poolAgeSeconds: null,
    volumeUsd: null,
    buys: null,
    sells: null,
    risk: null,
    provenance: {
      providers: [provider],
      sourceKind,
      note:
        sourceKind === "replay"
          ? "REPLAY data — historical/recorded, not a live market feed. Never trade on replay as if live."
          : "Live source observation — provider-reported hints are unverified until risk/quote checked.",
    },
    isObservationNotTrade: true,
    notProfitabilityClaim: true,
  };
  return finalize(base);
}

/** Normalize a manual operator-typed mint into a {@link SniperCandidate}, or throw on a bad mint. */
export function normalizeManualMint(input: ManualMintInput, opts: { discoveredAt: string }): SniperCandidate {
  if (!isValidMint(input.mint)) {
    throw new DiscoveryError("manual mint is not a valid base58 mint (32..44 chars) — never paste secret key material");
  }
  const provider = shortText(input.sourceProvider, 60) ?? "operator-manual";
  const base: Omit<SniperCandidate, "confidence" | "missingData"> = {
    schemaVersion: LIVE_SNIPER_CANDIDATE_SCHEMA_VERSION,
    chain: LIVE_SNIPER_CANDIDATE_CHAIN,
    mint: input.mint,
    symbol: shortText(input.symbol, 32),
    name: shortText(input.name, 64),
    poolId: null,
    sourceProvider: provider,
    sourceKind: "manual",
    discoveredAt: opts.discoveredAt,
    slot: null,
    blockTime: null,
    liquidityUsd: null,
    quoteAvailable: null,
    routeProvider: null,
    poolAgeSeconds: null,
    volumeUsd: null,
    buys: null,
    sells: null,
    risk: null,
    provenance: {
      providers: [provider],
      sourceKind: "manual",
      note: "Manually entered by the operator — still requires real risk + quote + policy + Phantom confirmation.",
    },
    isObservationNotTrade: true,
    notProfitabilityClaim: true,
  };
  return finalize(base);
}

export interface DedupeResult {
  kept: SniperCandidate[];
  duplicates: DiscoveryRejection[];
}

/** De-duplicate by mint (first-seen wins). A later duplicate is reported, never silently dropped. */
export function dedupeCandidates(candidates: readonly SniperCandidate[]): DedupeResult {
  const seen = new Map<string, SniperCandidate>();
  const kept: SniperCandidate[] = [];
  const duplicates: DiscoveryRejection[] = [];
  for (const c of candidates) {
    if (seen.has(c.mint)) {
      duplicates.push({ mint: c.mint, reason: `duplicate mint (already discovered from ${seen.get(c.mint)!.sourceProvider})` });
      continue;
    }
    seen.set(c.mint, c);
    kept.push(c);
  }
  return { kept, duplicates };
}

export interface DiscoverInput {
  observations?: ObservationInput[];
  manualMints?: ManualMintInput[];
}

export interface DiscoveryResult {
  schemaVersion: "live.sniper.discovery.v1";
  discoveredAt: string;
  candidates: SniperCandidate[];
  rejections: DiscoveryRejection[];
  /** Per-candidate `candidate-discovered` / per-rejection `candidate-rejected` events. */
  events: { event: DiscoveryEvent; mint: string | null; detail: string }[];
  notProfitabilityClaim: true;
}

/**
 * Normalize a mixed batch of real observations + manual mints into a de-duplicated candidate list.
 * Fails CLOSED per item: a bad mint or missing provenance becomes a rejection, never a candidate,
 * and never throws the whole batch. An empty input yields an empty (honest) result.
 */
export function discoverCandidates(input: DiscoverInput, opts: { discoveredAt: string }): DiscoveryResult {
  const raw: SniperCandidate[] = [];
  const rejections: DiscoveryRejection[] = [];
  const events: DiscoveryResult["events"] = [];

  for (const obs of input.observations ?? []) {
    try {
      raw.push(normalizeObservation(obs, opts));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const mint = isValidMint(obs?.mint) ? obs.mint : null;
      rejections.push({ mint, reason });
      events.push({ event: "candidate-rejected", mint, detail: reason });
    }
  }
  for (const m of input.manualMints ?? []) {
    try {
      raw.push(normalizeManualMint(m, opts));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      rejections.push({ mint: null, reason });
      events.push({ event: "candidate-rejected", mint: null, detail: reason });
    }
  }

  const { kept, duplicates } = dedupeCandidates(raw);
  for (const c of kept) {
    events.push({ event: "candidate-discovered", mint: c.mint, detail: `${c.sourceKind} via ${c.sourceProvider}` });
  }
  for (const d of duplicates) {
    rejections.push(d);
    events.push({ event: "candidate-rejected", mint: d.mint, detail: d.reason });
  }

  return {
    schemaVersion: "live.sniper.discovery.v1",
    discoveredAt: opts.discoveredAt,
    candidates: kept,
    rejections,
    events,
    notProfitabilityClaim: true,
  };
}

const CANDIDATE_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "chain",
  "mint",
  "symbol",
  "name",
  "poolId",
  "sourceProvider",
  "sourceKind",
  "discoveredAt",
  "slot",
  "blockTime",
  "liquidityUsd",
  "quoteAvailable",
  "routeProvider",
  "poolAgeSeconds",
  "volumeUsd",
  "buys",
  "sells",
  "risk",
  "provenance",
  "missingData",
  "confidence",
  "isObservationNotTrade",
  "notProfitabilityClaim",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Strictly validate a value as a {@link SniperCandidate} (closed schema; provenance re-checked). */
export function validateSniperCandidate(value: unknown): SniperCandidate {
  if (!isObject(value)) throw new DiscoveryError("candidate must be a JSON object");
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) throw new DiscoveryError(`candidate carries sensitive-named field "${key}"`);
    if (!CANDIDATE_KEYS.has(key)) throw new DiscoveryError(`candidate carries unknown field "${key}" — the v1 schema is CLOSED`);
  }
  if (value.schemaVersion !== LIVE_SNIPER_CANDIDATE_SCHEMA_VERSION) {
    throw new DiscoveryError(`candidate.schemaVersion must be "${LIVE_SNIPER_CANDIDATE_SCHEMA_VERSION}"`);
  }
  if (value.chain !== LIVE_SNIPER_CANDIDATE_CHAIN) throw new DiscoveryError(`candidate.chain must be "${LIVE_SNIPER_CANDIDATE_CHAIN}"`);
  if (!isValidMint(value.mint)) throw new DiscoveryError("candidate.mint must be a valid base58 mint");
  if (!isObject(value.provenance) || !Array.isArray((value.provenance as Record<string, unknown>).providers)) {
    throw new DiscoveryError("candidate.provenance.providers is required");
  }
  if (value.isObservationNotTrade !== true) throw new DiscoveryError("candidate.isObservationNotTrade must be the literal true");
  if (value.notProfitabilityClaim !== true) throw new DiscoveryError("candidate.notProfitabilityClaim must be the literal true");
  return value as unknown as SniperCandidate;
}
