/**
 * The LIVE-CANDIDATE DECISION (`live.candidate.decision.v1`, Sprint 107, Part 1).
 *
 * A transparent, deterministic decision layer that ranks a memecoin opportunity from real signals
 * already available in the system (risk, liquidity, volume, pool age, price impact, quote
 * freshness, holder concentration, route confidence, allow/deny lists). It is NOT a profit
 * predictor and NOT a trade authorization — it sorts candidates into four buckets and explains
 * why. A `live_canary_candidate` STILL must pass the full policy → risk → preflight → Phantom
 * confirmation path before any real transaction happens.
 *
 * Pure: the caller supplies the timestamp; no clock, no network, no randomness.
 */

export const LIVE_CANDIDATE_DECISION_SCHEMA_VERSION = "live.candidate.decision.v1";

export const LIVE_CANDIDATE_DECISIONS = ["ignore", "watch", "paper_trade", "live_canary_candidate"] as const;
export type LiveCandidateDecision = (typeof LIVE_CANDIDATE_DECISIONS)[number];

export interface LiveCandidateRiskSignals {
  score: number;
  decision: string;
  criticalFlagCount: number;
  freezeAuthorityPresent: boolean | null;
  mintAuthorityPresent: boolean | null;
}

export interface LiveCandidateSignals {
  mint: string;
  risk: LiveCandidateRiskSignals | null;
  liquidityUsd: number | null;
  volumeUsd: number | null;
  poolAgeSeconds: number | null;
  priceImpactPct: number | null;
  quoteAgeMs: number | null;
  holderTop1Pct: number | null;
  routeConfidence: number | null;
  denylisted: boolean;
  allowlisted: boolean;
}

export interface LiveCandidateThresholds {
  minLiquidityUsd: number;
  paperMinLiquidityUsd: number;
  maxPriceImpactPct: number;
  maxQuoteAgeMs: number;
  riskScoreCap: number;
  liveScoreThreshold: number;
  paperScoreThreshold: number;
  watchScoreThreshold: number;
}

export const LIVE_CANDIDATE_DEFAULT_THRESHOLDS: LiveCandidateThresholds = {
  minLiquidityUsd: 5_000,
  paperMinLiquidityUsd: 1_000,
  maxPriceImpactPct: 3,
  maxQuoteAgeMs: 8_000,
  riskScoreCap: 30,
  liveScoreThreshold: 70,
  paperScoreThreshold: 45,
  watchScoreThreshold: 25,
};

export interface LiveCandidateDecisionResult {
  schemaVersion: typeof LIVE_CANDIDATE_DECISION_SCHEMA_VERSION;
  mint: string;
  decision: LiveCandidateDecision;
  score: number;
  reasons: string[];
  /** Why this is not a `live_canary_candidate` (always populated for transparency). */
  blockingReasons: string[];
  missingData: string[];
  timestamp: string;
  provenance: { providers: string[] };
  /** Pinned honesty literals. */
  notProfitabilityClaim: true;
  liveCandidateStillRequiresPhantom: true;
}

export interface ScoreLiveCandidateInput {
  signals: LiveCandidateSignals;
  thresholds?: Partial<LiveCandidateThresholds>;
  timestamp: string;
  providers?: string[];
}

const SCORE_BASE = 50;
const SCORE_MIN = 0;
const SCORE_MAX = 100;

function clampScore(n: number): number {
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, Math.round(n)));
}

/** Score and bucket a single candidate. Deterministic; explains every decision. */
export function scoreLiveCandidate(input: ScoreLiveCandidateInput): LiveCandidateDecisionResult {
  const s = input.signals;
  const t: LiveCandidateThresholds = { ...LIVE_CANDIDATE_DEFAULT_THRESHOLDS, ...(input.thresholds ?? {}) };
  const reasons: string[] = [];
  const blockingReasons: string[] = [];
  const missingData: string[] = [];

  // --- Score (transparent additive model) ---
  let score = SCORE_BASE;
  if (s.risk === null) {
    missingData.push("risk");
    blockingReasons.push("risk-missing");
    score -= 20;
  } else {
    score -= Math.min(40, s.risk.score * 0.6);
    if (s.risk.score <= t.riskScoreCap) reasons.push(`risk score ${s.risk.score} within cap ${t.riskScoreCap}`);
  }
  if (s.liquidityUsd === null) {
    missingData.push("liquidityUsd");
  } else if (s.liquidityUsd >= t.minLiquidityUsd) {
    score += 15;
    reasons.push(`liquidity $${Math.round(s.liquidityUsd)} ≥ live floor $${t.minLiquidityUsd}`);
  } else {
    score -= 10;
  }
  if (s.volumeUsd === null) missingData.push("volumeUsd");
  else if (s.volumeUsd > 0) score += Math.min(10, Math.log10(s.volumeUsd + 1) * 2);
  if (s.routeConfidence !== null) score += Math.max(-10, Math.min(10, (s.routeConfidence - 0.5) * 20));
  else missingData.push("routeConfidence");
  if (s.poolAgeSeconds === null) missingData.push("poolAgeSeconds");
  else if (s.poolAgeSeconds >= 60) score += 5;
  if (s.priceImpactPct !== null && s.priceImpactPct > t.maxPriceImpactPct) score -= 10;
  if (s.holderTop1Pct !== null && s.holderTop1Pct > 50) score -= 15;
  if (s.allowlisted) {
    score += 5;
    reasons.push("operator allowlisted");
  }
  score = clampScore(score);

  // --- Hard disqualifiers → ignore ---
  let decision: LiveCandidateDecision;
  if (s.denylisted) {
    blockingReasons.push("operator-denylisted");
    decision = "ignore";
  } else if (s.risk !== null && s.risk.decision === "REJECT") {
    blockingReasons.push("risk-rejected");
    decision = "ignore";
  } else if (s.risk !== null && s.risk.criticalFlagCount > 0) {
    blockingReasons.push("risk-critical-flag");
    decision = "ignore";
  } else {
    // --- Soft-but-live-blocking conditions ---
    if (s.risk === null) blockingReasons.push("risk-missing");
    else if (s.risk.score > t.riskScoreCap) blockingReasons.push("risk-score-over-cap");
    if (s.risk !== null && s.risk.freezeAuthorityPresent === true) blockingReasons.push("freeze-authority-present");
    if (s.risk !== null && s.risk.mintAuthorityPresent === true) blockingReasons.push("mint-authority-present");
    if (s.liquidityUsd === null) blockingReasons.push("liquidity-missing");
    else if (s.liquidityUsd < t.minLiquidityUsd) blockingReasons.push("liquidity-below-live-floor");
    if (s.priceImpactPct === null) blockingReasons.push("price-impact-missing");
    else if (s.priceImpactPct > t.maxPriceImpactPct) blockingReasons.push("price-impact-over-cap");
    if (s.quoteAgeMs === null) blockingReasons.push("quote-age-missing");
    else if (s.quoteAgeMs > t.maxQuoteAgeMs) blockingReasons.push("quote-stale");
    if (score < t.liveScoreThreshold) blockingReasons.push("score-below-live-threshold");

    const liveEligible = blockingReasons.length === 0 && s.risk !== null && s.risk.decision !== "REJECT";
    if (liveEligible) {
      decision = "live_canary_candidate";
      reasons.push(`score ${score} ≥ live threshold ${t.liveScoreThreshold}; all live preconditions met`);
    } else if (
      score >= t.paperScoreThreshold &&
      s.liquidityUsd !== null &&
      s.liquidityUsd >= t.paperMinLiquidityUsd &&
      (s.risk === null || s.risk.decision !== "REJECT")
    ) {
      decision = "paper_trade";
      reasons.push(`score ${score} ≥ paper threshold ${t.paperScoreThreshold}; suitable for paper evaluation only`);
    } else if (score >= t.watchScoreThreshold) {
      decision = "watch";
      reasons.push(`score ${score} ≥ watch threshold ${t.watchScoreThreshold}; gather more data`);
    } else {
      decision = "ignore";
      reasons.push(`score ${score} below watch threshold ${t.watchScoreThreshold}`);
    }
  }

  return {
    schemaVersion: LIVE_CANDIDATE_DECISION_SCHEMA_VERSION,
    mint: s.mint,
    decision,
    score,
    reasons,
    blockingReasons: dedupe(blockingReasons),
    missingData: dedupe(missingData),
    timestamp: input.timestamp,
    provenance: { providers: input.providers ?? [] },
    notProfitabilityClaim: true,
    liveCandidateStillRequiresPhantom: true,
  };
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
