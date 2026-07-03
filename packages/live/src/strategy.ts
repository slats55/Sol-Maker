/**
 * MEMECOIN STRATEGY SCORING v2 (`live.strategy.score.v2`, Sprint 108, Part 2).
 *
 * A transparent decision layer over a discovered {@link SniperCandidate} plus its (optional) live
 * quote facts. It REUSES Part 1's proven `scoreLiveCandidate` for the additive score and bucketing
 * — there is no second, divergent scoring model — and adds what the sniper loop needs: an explicit
 * DATA confidence, a hard-block / soft-warning split, and a configurable risk appetite that may only
 * tighten or modestly relax the score thresholds (never the hard safety blocks).
 *
 * Invariants (all tested):
 *   - A high score can NEVER override a hard risk block. A REJECT, a critical flag, an operator
 *     denylist, or a present freeze/mint authority forces the decision away from `live_canary_candidate`.
 *   - Missing critical data (risk, quote, liquidity) blocks the live decision AND lowers confidence.
 *   - The strategy may recommend a `live_canary_candidate`; it authorizes NOTHING and never trades.
 *     Even a `live_canary_candidate` must still pass policy → escalation → preflight → Phantom.
 *
 * Pure: the caller supplies the timestamp; no clock, no network, no randomness.
 */

import { scoreLiveCandidate, LIVE_CANDIDATE_DEFAULT_THRESHOLDS } from "./candidate-score.js";
import type { LiveCandidateThresholds } from "./candidate-score.js";
import type { SniperCandidate } from "./discovery.js";

export const LIVE_STRATEGY_SCORE_SCHEMA_VERSION = "live.strategy.score.v2";

export const STRATEGY_DECISIONS = ["ignore", "watch", "paper_shadow", "live_canary_candidate"] as const;
export type StrategyDecision = (typeof STRATEGY_DECISIONS)[number];

/** Risk appetite tunes the SCORE thresholds only — never the hard safety blocks. */
export const STRATEGY_RISK_APPETITES = ["conservative", "standard", "aggressive"] as const;
export type StrategyRiskAppetite = (typeof STRATEGY_RISK_APPETITES)[number];

/** Per-appetite live-score threshold. Even "aggressive" keeps a meaningful bar and cannot disable a block. */
const APPETITE_LIVE_THRESHOLD: Record<StrategyRiskAppetite, number> = {
  conservative: 80,
  standard: 70,
  aggressive: 60,
};

/** The blocking codes that are HARD: a candidate carrying any of these can never be a live candidate. */
export const STRATEGY_HARD_BLOCK_CODES: ReadonlySet<string> = new Set([
  "operator-denylisted",
  "risk-rejected",
  "risk-critical-flag",
  "risk-missing",
  "freeze-authority-present",
  "mint-authority-present",
]);

export interface StrategyQuoteFacts {
  priceImpactPct: number | null;
  ageMs: number | null;
  slippageBps: number | null;
  routeConfidence: number | null;
  provider: string | null;
}

export interface StrategyScoreResult {
  schemaVersion: typeof LIVE_STRATEGY_SCORE_SCHEMA_VERSION;
  mint: string;
  decision: StrategyDecision;
  score: number;
  /** 0..1 confidence in the DATA behind the decision (not a profit prediction). */
  confidence: number;
  /** Disqualifiers that force the decision away from live regardless of score. */
  hardBlocks: string[];
  /** Conditions that lower the bucket / confidence but are not hard disqualifiers. */
  softWarnings: string[];
  reasons: string[];
  missingData: string[];
  provenance: { providers: string[]; sourceKind: string };
  riskAppetite: StrategyRiskAppetite;
  timestamp: string;
  /** Pinned honesty literals. */
  notProfitabilityClaim: true;
  liveCandidateStillRequiresPhantom: true;
}

export interface ScoreStrategyInput {
  candidate: SniperCandidate;
  quote?: StrategyQuoteFacts | null;
  thresholds?: Partial<LiveCandidateThresholds>;
  riskAppetite?: StrategyRiskAppetite;
  /** Operator denylist membership (policy, not candidate data) — a hard disqualifier. */
  denylisted?: boolean;
  /** Operator allowlist membership — a small positive signal, never a bypass of any block. */
  allowlisted?: boolean;
  timestamp: string;
}

/** v1 → v2 decision name mapping (`paper_trade` becomes the loop's `paper_shadow`). */
function mapDecision(v1: string): StrategyDecision {
  switch (v1) {
    case "live_canary_candidate":
      return "live_canary_candidate";
    case "paper_trade":
      return "paper_shadow";
    case "watch":
      return "watch";
    default:
      return "ignore";
  }
}

/**
 * Confidence blends the candidate's own DATA confidence with the presence of the facts a live
 * decision needs. Missing risk or quote hard-caps confidence low so an under-informed candidate can
 * never look trustworthy.
 */
function computeStrategyConfidence(candidate: SniperCandidate, quote: StrategyQuoteFacts | null): number {
  let conf = candidate.confidence;
  if (candidate.risk === null) conf = Math.min(conf, 0.3);
  if (quote === null || quote.ageMs === null) conf = Math.min(conf, 0.5);
  if (candidate.liquidityUsd === null) conf = Math.min(conf, 0.6);
  return Math.max(0, Math.min(1, Math.round(conf * 100) / 100));
}

/**
 * Score and bucket a discovered candidate. Reuses {@link scoreLiveCandidate} for the additive model,
 * then layers on confidence, the hard/soft split, and the risk-appetite threshold.
 */
export function scoreStrategyV2(input: ScoreStrategyInput): StrategyScoreResult {
  const c = input.candidate;
  const quote = input.quote ?? null;
  const appetite: StrategyRiskAppetite = input.riskAppetite ?? "standard";

  const thresholds: Partial<LiveCandidateThresholds> = {
    ...input.thresholds,
    liveScoreThreshold: input.thresholds?.liveScoreThreshold ?? APPETITE_LIVE_THRESHOLD[appetite],
  };

  const v1 = scoreLiveCandidate({
    signals: {
      mint: c.mint,
      risk: c.risk,
      liquidityUsd: c.liquidityUsd,
      volumeUsd: c.volumeUsd,
      poolAgeSeconds: c.poolAgeSeconds,
      priceImpactPct: quote?.priceImpactPct ?? null,
      quoteAgeMs: quote?.ageMs ?? null,
      holderTop1Pct: null,
      routeConfidence: quote?.routeConfidence ?? null,
      denylisted: input.denylisted ?? false,
      allowlisted: input.allowlisted ?? false,
    },
    thresholds,
    timestamp: input.timestamp,
    providers: c.provenance.providers,
  });

  const hardBlocks: string[] = [];
  const softWarnings: string[] = [];
  for (const code of v1.blockingReasons) {
    if (STRATEGY_HARD_BLOCK_CODES.has(code)) hardBlocks.push(code);
    else softWarnings.push(code);
  }

  // Defense in depth: never let the v1 bucket name a live candidate while a hard block is present.
  let decision = mapDecision(v1.decision);
  if (decision === "live_canary_candidate" && hardBlocks.length > 0) {
    decision = "watch";
  }

  return {
    schemaVersion: LIVE_STRATEGY_SCORE_SCHEMA_VERSION,
    mint: c.mint,
    decision,
    score: v1.score,
    confidence: computeStrategyConfidence(c, quote),
    hardBlocks: dedupe(hardBlocks),
    softWarnings: dedupe(softWarnings),
    reasons: v1.reasons,
    missingData: dedupe([...c.missingData, ...v1.missingData]),
    provenance: { providers: c.provenance.providers, sourceKind: c.provenance.sourceKind },
    riskAppetite: appetite,
    timestamp: input.timestamp,
    notProfitabilityClaim: true,
    liveCandidateStillRequiresPhantom: true,
  };
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

/** Re-export the v1 defaults so callers can introspect the baseline thresholds. */
export { LIVE_CANDIDATE_DEFAULT_THRESHOLDS };
