/**
 * Generate committed EXAMPLE artifacts for the @soulmaker/live Part 2 sniper loop (Sprint 108).
 *
 * Deterministic (fixed timestamp, fixture candidates) so re-running produces byte-identical output.
 * No network, wallet, or chain activity. These are EXAMPLES that show the SHAPE of each artifact and
 * the green/blocked paths — they are not live data and make no profitability claim. Real-data
 * evidence (real mainnet risk + real Jupiter quotes) is recorded in docs/FINAL_PART_2_STATUS.md.
 *
 * Run: `pnpm tsx scripts/gen-part2-examples.ts`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCanaryReconciliation,
  buildEscalationPolicy,
  buildLivePolicy,
  buildPaperShadowSession,
  discoverCandidates,
  evaluateCandidatePipeline,
  normalizeManualMint,
  scoreStrategyV2,
  shadowDecide,
  SNIPER_LOOP_MODES,
  SNIPER_LOOP_STAGES,
  type SniperCandidate,
  type SniperCandidateRisk,
  type StrategyQuoteFacts,
} from "../packages/live/src/index.js";
import { redactValue } from "../packages/security/src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(dirname(HERE), "examples", "live", "part2");
mkdirSync(OUT_DIR, { recursive: true });

const AT = "2026-06-18T00:00:00.000Z";
const NOW_MS = Date.parse(AT);
const CLEAN_MINT = "So11111111111111111111111111111111111111112"; // WSOL — public fixture
const REJECT_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC — public fixture

function write(name: string, value: unknown): void {
  const path = join(OUT_DIR, name);
  writeFileSync(path, JSON.stringify(redactValue(value), null, 2) + "\n");
  console.log(`wrote ${path}`);
}

const cleanRisk: SniperCandidateRisk = { score: 5, decision: "ACCEPT", criticalFlagCount: 0, freezeAuthorityPresent: false, mintAuthorityPresent: false };
const rejectRisk: SniperCandidateRisk = { score: 100, decision: "REJECT", criticalFlagCount: 1, freezeAuthorityPresent: true, mintAuthorityPresent: false };
const freshQuote: StrategyQuoteFacts = { priceImpactPct: 0.5, ageMs: 1_000, slippageBps: 50, routeConfidence: 0.9, provider: "jupiter-lite-api" };

function candidate(mint: string, risk: SniperCandidateRisk | null, over: Partial<SniperCandidate> = {}): SniperCandidate {
  const base = normalizeManualMint({ mint, symbol: mint === CLEAN_MINT ? "WSOL" : "USDC" }, { discoveredAt: AT });
  return { ...base, risk, liquidityUsd: 50_000, volumeUsd: 100_000, poolAgeSeconds: 600, ...over };
}

// 1) Escalation policy + loop model
write("escalation-policy.example.json", buildEscalationPolicy({ maxCanariesPerSession: 1, cooldownMs: 300_000 }));
write("loop-model.example.json", { schemaVersion: "live.sniper.policy.report.v1", modes: SNIPER_LOOP_MODES, defaultMode: "off", stages: SNIPER_LOOP_STAGES, loopNeverSends: true });

// 2) Discovery (one clean + one bad mint → fail-closed rejection)
write("discovery.example.json", discoverCandidates({ manualMints: [{ mint: CLEAN_MINT, symbol: "WSOL" }, { mint: "not-a-valid-mint" }] }, { discoveredAt: AT }));

// 3) Run report — armed_canary GREEN path → prepare_canary_request (fixture clean candidate + fresh quote)
const greenPolicy = buildLivePolicy({ mode: "live_canary", liveEnabled: true, walletProvider: "phantom" });
const escalation = buildEscalationPolicy();
const greenResult = evaluateCandidatePipeline(
  { candidate: candidate(CLEAN_MINT, cleanRisk), quote: freshQuote, quoteFresh: true, plannedSpendSol: 0.005 },
  { mode: "armed_canary", policy: greenPolicy, escalationPolicy: escalation, escalationSession: { armed: true, lastCanaryAtMs: null }, nowMs: NOW_MS, timestamp: AT },
);
write("run-report.armed-green.example.json", {
  schemaVersion: "live.sniper.run.report.v1",
  mode: "armed_canary",
  ranAt: AT,
  totals: { candidates: 1, rejected: 0, canaryRecommended: greenResult.action === "prepare_canary_request" ? 1 : 0, paperShadow: 0, watch: 0 },
  results: [greenResult],
  rejections: [],
  loopNeverSends: true,
  notProfitabilityClaim: true,
});

// 4) Run report — armed_canary BLOCKED by a real-shaped risk REJECT (freeze authority)
const rejectResult = evaluateCandidatePipeline(
  { candidate: candidate(REJECT_MINT, rejectRisk), quote: freshQuote, quoteFresh: true, plannedSpendSol: 0.005 },
  { mode: "armed_canary", policy: greenPolicy, escalationPolicy: escalation, escalationSession: { armed: true, lastCanaryAtMs: null }, nowMs: NOW_MS, timestamp: AT },
);
write("run-report.armed-risk-reject.example.json", {
  schemaVersion: "live.sniper.run.report.v1",
  mode: "armed_canary",
  ranAt: AT,
  totals: { candidates: 1, rejected: 0, canaryRecommended: 0, paperShadow: 0, watch: 0 },
  results: [rejectResult],
  rejections: [],
  loopNeverSends: true,
  notProfitabilityClaim: true,
});

// 5) Paper-shadow session (one would_enter, one would_skip)
const enterStrat = scoreStrategyV2({ candidate: candidate(CLEAN_MINT, cleanRisk), quote: freshQuote, timestamp: AT });
const skipStrat = scoreStrategyV2({ candidate: candidate(REJECT_MINT, rejectRisk), quote: freshQuote, timestamp: AT });
const decisions = [
  shadowDecide({ candidate: candidate(CLEAN_MINT, cleanRisk), strategy: enterStrat, quote: freshQuote, decidedAt: AT }, { outAmountRaw: "347306" }),
  shadowDecide({ candidate: candidate(REJECT_MINT, rejectRisk), strategy: skipStrat, quote: freshQuote, decidedAt: AT }),
];
write("paper-shadow-session.example.json", buildPaperShadowSession(decisions, { sessionId: "example-shadow", startedAt: AT, endedAt: AT }));

// 6) Reconciliation — a finalized canary with honest unknown PnL (short fixture signature, never a real one)
write(
  "reconciliation.finalized.example.json",
  buildCanaryReconciliation({
    candidateMint: CLEAN_MINT,
    facts: {
      signature: "FixtureSig1example",
      submittedAt: AT,
      lastStatusAt: AT,
      status: "finalized",
      slot: 469219488,
      err: null,
      inputAmountRaw: "5000000",
      outputAmountRaw: "347306",
      solSpentLamports: "5005000",
      feesLamports: "5000",
      priorityFeeLamports: "1000",
      balanceBeforeLamports: null,
      balanceAfterLamports: null,
    },
  }),
);

console.log("Part 2 examples generated.");
