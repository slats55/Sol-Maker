/**
 * PAPER-SHADOW MODE (`live.paper_shadow.session.v1`, Sprint 108, Part 2).
 *
 * Runs BESIDE live candidate discovery. For every candidate that reaches watch / paper-shadow, it
 * records what the strategy WOULD have done — would-enter or would-skip, why, the quote at decision
 * time, and the score — WITHOUT touching the chain, a wallet, or any key. This is how the operator
 * sanity-checks the strategy before risking a single real lamport: a long run of honest "would-have"
 * decisions, never a fabricated profit.
 *
 * Honesty contract:
 *   - A shadow decision is a SIMULATION. It can never become a trade and never holds a position.
 *   - Outcome (did it go up?) is UNKNOWN unless the caller later supplies a comparison quote; this
 *     module never invents a price or a PnL. `outcomeKnown` is pinned to whether a comparison exists.
 *   - `notProfitabilityClaim` rides on every decision and on the session report.
 *
 * Pure: the caller supplies timestamps; no clock, no network, no randomness.
 */

import type { SniperCandidate } from "./discovery.js";
import type { StrategyQuoteFacts, StrategyScoreResult } from "./strategy.js";

export const LIVE_PAPER_SHADOW_DECISION_SCHEMA_VERSION = "live.paper_shadow.decision.v1";
export const LIVE_PAPER_SHADOW_SESSION_SCHEMA_VERSION = "live.paper_shadow.session.v1";

export const PAPER_SHADOW_DECISIONS = ["would_enter", "would_skip"] as const;
export type PaperShadowDecision = (typeof PAPER_SHADOW_DECISIONS)[number];

export interface PaperShadowQuoteSnapshot {
  provider: string | null;
  priceImpactPct: number | null;
  slippageBps: number | null;
  ageMs: number | null;
  /** Output amount (raw integer string) at decision time, if known. */
  outAmountRaw: string | null;
}

export interface PaperShadowDecisionRecord {
  schemaVersion: typeof LIVE_PAPER_SHADOW_DECISION_SCHEMA_VERSION;
  mint: string;
  symbol: string | null;
  decision: PaperShadowDecision;
  score: number;
  confidence: number;
  reasons: string[];
  /** The why-not for a would_skip (hard blocks + soft warnings); empty for would_enter. */
  blockingReasons: string[];
  quoteAtDecision: PaperShadowQuoteSnapshot | null;
  decidedAt: string;
  /** Outcome is only ever known if a later comparison quote was supplied. */
  outcomeKnown: boolean;
  /** Output delta vs decision-time quote, when a comparison was supplied; else null. */
  comparisonOutAmountRaw: string | null;
  notProfitabilityClaim: true;
}

export interface ShadowDecideInput {
  candidate: SniperCandidate;
  strategy: StrategyScoreResult;
  quote?: StrategyQuoteFacts | null;
  decidedAt: string;
  /** A later quote for the same candidate, if the operator captured one (for would-have tracking). */
  comparisonOutAmountRaw?: string | null;
}

function quoteSnapshot(quote: StrategyQuoteFacts | null, outAmountRaw: string | null): PaperShadowQuoteSnapshot | null {
  if (quote === null) return null;
  return {
    provider: quote.provider,
    priceImpactPct: quote.priceImpactPct,
    slippageBps: quote.slippageBps,
    ageMs: quote.ageMs,
    outAmountRaw,
  };
}

/**
 * Decide what the strategy WOULD have done with this candidate, as a paper shadow. would_enter only
 * when the strategy reached paper_shadow or live_canary_candidate with no hard block; otherwise
 * would_skip with the full why-not. Records the quote at decision time; never simulates a profit.
 */
export function shadowDecide(input: ShadowDecideInput, opts?: { outAmountRaw?: string | null }): PaperShadowDecisionRecord {
  const s = input.strategy;
  const wouldEnter = (s.decision === "paper_shadow" || s.decision === "live_canary_candidate") && s.hardBlocks.length === 0;
  const blockingReasons = wouldEnter ? [] : dedupe([...s.hardBlocks, ...s.softWarnings]);
  const comparison = input.comparisonOutAmountRaw ?? null;
  return {
    schemaVersion: LIVE_PAPER_SHADOW_DECISION_SCHEMA_VERSION,
    mint: input.candidate.mint,
    symbol: input.candidate.symbol,
    decision: wouldEnter ? "would_enter" : "would_skip",
    score: s.score,
    confidence: s.confidence,
    reasons: s.reasons,
    blockingReasons,
    quoteAtDecision: quoteSnapshot(input.quote ?? null, opts?.outAmountRaw ?? null),
    decidedAt: input.decidedAt,
    outcomeKnown: comparison !== null,
    comparisonOutAmountRaw: comparison,
    notProfitabilityClaim: true,
  };
}

export interface PaperShadowSessionReport {
  schemaVersion: typeof LIVE_PAPER_SHADOW_SESSION_SCHEMA_VERSION;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  totals: {
    decisions: number;
    wouldEnter: number;
    wouldSkip: number;
    outcomesKnown: number;
  };
  decisions: PaperShadowDecisionRecord[];
  /** Honest notes about what this session does and does not prove. */
  caveats: string[];
  notProfitabilityClaim: true;
}

export const PAPER_SHADOW_SESSION_CAVEATS: readonly string[] = [
  "Paper-shadow decisions are SIMULATIONS — no order, no position, no chain, no key, no send.",
  "A would_enter is not a profit: outcome is unknown unless a later comparison quote was captured.",
  "This session evaluates the STRATEGY's would-have decisions; it makes no profitability claim.",
];

/** Aggregate shadow decisions into a session report. Pure; the caller supplies start/end labels. */
export function buildPaperShadowSession(decisions: readonly PaperShadowDecisionRecord[], meta: { sessionId: string; startedAt: string; endedAt: string }): PaperShadowSessionReport {
  let wouldEnter = 0;
  let outcomesKnown = 0;
  for (const d of decisions) {
    if (d.decision === "would_enter") wouldEnter += 1;
    if (d.outcomeKnown) outcomesKnown += 1;
  }
  return {
    schemaVersion: LIVE_PAPER_SHADOW_SESSION_SCHEMA_VERSION,
    sessionId: meta.sessionId,
    startedAt: meta.startedAt,
    endedAt: meta.endedAt,
    totals: {
      decisions: decisions.length,
      wouldEnter,
      wouldSkip: decisions.length - wouldEnter,
      outcomesKnown,
    },
    decisions: [...decisions],
    caveats: [...PAPER_SHADOW_SESSION_CAVEATS],
    notProfitabilityClaim: true,
  };
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
