/**
 * Generate the committed examples/live/s109/* artifacts with the REAL production builders (never
 * hand-written JSON). Deterministic: fixed timestamps, fictional-but-valid public mints. Run:
 *
 *   pnpm tsx scripts/gen-s109-examples.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  STRATEGY_PROFILES,
  buildLivePolicy,
  buildLiveSellRequest,
  buildOperatorApproval,
  buildRankingFacts,
  clampRanking,
  evaluateOperatorApproval,
  normalizeManualMint,
  openPosition,
  reconcilePosition,
  scoreStrategyV2,
} from "../packages/live/src/index.js";

const OUT = join(process.cwd(), "examples", "live", "s109");
mkdirSync(OUT, { recursive: true });

// Well-known PUBLIC mints as fixture identifiers (public chain data, not secrets).
const MINT_CLEAN = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MINT_BLOCKED = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const SOL = "So11111111111111111111111111111111111111112";
const AT = "2026-07-02T12:00:00.000Z";
const AT_MS = Date.parse(AT);

function write(name: string, value: unknown): void {
  writeFileSync(join(OUT, name), JSON.stringify(value, null, 2) + "\n");
  console.log(`wrote examples/live/s109/${name}`);
}

// 1) The conservative strategy profile, verbatim from the production built-ins.
write("strategy-profile.conservative.example.json", STRATEGY_PROFILES.conservative);
write("strategy-profile.aggressive-paper-only.example.json", STRATEGY_PROFILES["aggressive-paper-only"]);

// 2) A deterministic-fallback AI ranking: one clean candidate, one hard-blocked (risk missing has
//    hard block risk-missing; a REJECT decision blocks too). The blocked one stays excluded.
const clean = normalizeManualMint({ mint: MINT_CLEAN, symbol: "CLEAN" }, { discoveredAt: AT });
const cleanWithRisk = { ...clean, risk: { score: 5, decision: "ACCEPT", criticalFlagCount: 0, freezeAuthorityPresent: false, mintAuthorityPresent: false } };
const blocked = normalizeManualMint({ mint: MINT_BLOCKED, symbol: "RUG" }, { discoveredAt: AT });
const blockedWithRisk = { ...blocked, risk: { score: 100, decision: "REJECT", criticalFlagCount: 1, freezeAuthorityPresent: true, mintAuthorityPresent: null } };
const rankable = [
  { mint: MINT_CLEAN, strategy: scoreStrategyV2({ candidate: cleanWithRisk, quote: null, timestamp: AT }) },
  { mint: MINT_BLOCKED, strategy: scoreStrategyV2({ candidate: blockedWithRisk, quote: null, timestamp: AT }) },
];
const facts = buildRankingFacts(rankable);
write(
  "ai-ranking.fallback.example.json",
  clampRanking({ facts, ai: null, engine: "deterministic-fallback", model: null, generatedAt: AT, caveats: ["example artifact — deterministic fallback; no AI call was made"] }),
);

// 3) A BLOCKED sell request: stale quote + no approval. Shows the refusal trail verbatim.
const position = openPosition({ kind: "live_canary", mint: MINT_CLEAN, openedAt: "2026-07-02T11:00:00.000Z", entrySpendLamports: 5_000_000, tokenAmountRaw: "123456789" });
write(
  "sell-request.blocked-stale-quote.example.json",
  buildLiveSellRequest({
    position,
    quote: {
      provider: "jupiter-lite-api",
      inputMint: MINT_CLEAN,
      outputMint: SOL,
      inAmountRaw: "123456789",
      outAmountRaw: "6000000",
      slippageBps: 100,
      priceImpactPct: 0.3,
      quotedAt: "2026-07-02T11:30:00.000Z",
      ageMs: 1_800_000,
      routeLabels: ["ExampleDEX"],
    },
    policy: buildLivePolicy({ mode: "live_canary", liveEnabled: true, walletProvider: "phantom" }),
    approvalEvaluation: null,
    createdAt: AT,
    nowMs: AT_MS,
  }),
);

// 4) A green (review_ready) sell request with an ACTIVE approval and fresh quote.
const approval = buildOperatorApproval({ operatorLabel: "example-operator", confirmPhrase: "I-APPROVE-ONE-CANARY-RECOMMENDATION", approvedAt: AT });
write(
  "sell-request.review-ready.example.json",
  buildLiveSellRequest({
    position,
    quote: {
      provider: "jupiter-lite-api",
      inputMint: MINT_CLEAN,
      outputMint: SOL,
      inAmountRaw: "123456789",
      outAmountRaw: "6000000",
      slippageBps: 100,
      priceImpactPct: 0.3,
      quotedAt: AT,
      ageMs: 1000,
      routeLabels: ["ExampleDEX"],
    },
    policy: buildLivePolicy({ mode: "live_canary", liveEnabled: true, walletProvider: "phantom" }),
    approvalEvaluation: evaluateOperatorApproval(approval, AT_MS + 1000),
    createdAt: AT,
    nowMs: AT_MS,
  }),
);

// 5) Position reconciliations: an honest unknown and a mismatch.
write("position-reconciliation.unknown.example.json", reconcilePosition({ position, observedTokenAmountRaw: null, observationSource: null, reconciledAt: AT }));
write("position-reconciliation.mismatch.example.json", reconcilePosition({ position, observedTokenAmountRaw: "1", observationSource: "phantom-ui", reconciledAt: AT }));

console.log("done");
