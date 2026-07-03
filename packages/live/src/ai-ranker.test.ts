import { describe, expect, it } from "vitest";

import {
  AI_RANKER_PROMPT_VERSION,
  AiRankerError,
  buildRankerPrompt,
  buildRankingFacts,
  canonicalJson,
  clampRanking,
  computeInputsHash,
  rankDeterministic,
  validateAiProviderRanking,
  validateAiRanking,
} from "./ai-ranker.js";
import type { RankableCandidate } from "./ai-ranker.js";
import type { StrategyScoreResult } from "./strategy.js";

const M1 = "So11111111111111111111111111111111111111112";
const M2 = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const M3 = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const AT = "2026-06-18T12:00:00.000Z";

function strategy(over: Partial<StrategyScoreResult> = {}): StrategyScoreResult {
  return {
    schemaVersion: "live.strategy.score.v2",
    mint: M1,
    decision: "watch",
    score: 50,
    confidence: 0.7,
    hardBlocks: [],
    softWarnings: [],
    reasons: [],
    missingData: [],
    provenance: { providers: ["jupiter"], sourceKind: "live_feed" },
    riskAppetite: "standard",
    timestamp: AT,
    notProfitabilityClaim: true,
    liveCandidateStillRequiresPhantom: true,
    ...over,
  };
}

function candidate(mint: string, over: Partial<StrategyScoreResult> = {}): RankableCandidate {
  return { mint, strategy: strategy({ mint, ...over }) };
}

describe("ai-ranker — deterministic facts and fallback", () => {
  it("splits eligible from hard-blocked before any AI involvement", () => {
    const facts = buildRankingFacts([candidate(M1), candidate(M2, { hardBlocks: ["risk-rejected"], decision: "watch" }), candidate(M3, { decision: "ignore" })]);
    expect(facts.eligible.map((c) => c.mint)).toEqual([M1]);
    expect(facts.blocked.map((c) => c.mint).sort()).toEqual([M2, M3].sort());
  });

  it("fallback ranks by score desc with stable tiebreaks", () => {
    const ranked = rankDeterministic([candidate(M1, { score: 50 }), candidate(M2, { score: 80 }), candidate(M3, { score: 50, confidence: 0.9 })]);
    expect(ranked.map((c) => c.mint)).toEqual([M2, M3, M1]);
  });

  it("the inputs hash is canonical (stable across key order) and truncated to 32 hex", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
    const h = computeInputsHash({ b: 1, a: 2 });
    expect(h).toBe(computeInputsHash({ a: 2, b: 1 }));
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("ai-ranker — the clamp (AI can reorder, never unblock)", () => {
  const facts = () =>
    buildRankingFacts([
      candidate(M1, { score: 80 }),
      candidate(M2, { score: 60 }),
      candidate(M3, { hardBlocks: ["risk-critical-flag"], score: 100 }),
    ]);

  it("pure fallback: deterministic order, no AI fields", () => {
    const r = clampRanking({ facts: facts(), ai: null, engine: "deterministic-fallback", model: null, generatedAt: AT });
    expect(r.engine).toBe("deterministic-fallback");
    expect(r.model).toBeNull();
    expect(r.rankings.map((x) => x.mint)).toEqual([M1, M2]);
    expect(r.excluded).toEqual([{ mint: M3, reason: "hard-blocked" }]);
    expect(r.advisoryOnly).toBe(true);
    expect(r.cannotOverrideSafety).toBe(true);
  });

  it("AI may reorder the eligible set", () => {
    const ai = validateAiProviderRanking({ rankings: [{ mint: M2, rank: 1, rationale: "stronger flow" }, { mint: M1, rank: 2, rationale: "ok" }] });
    const r = clampRanking({ facts: facts(), ai, engine: "anthropic", model: "claude-opus-4-8", generatedAt: AT });
    expect(r.rankings.map((x) => x.mint)).toEqual([M2, M1]);
    expect(r.rankings[0]?.aiRationale).toBe("stronger flow");
    expect(r.promptVersion).toBe(AI_RANKER_PROMPT_VERSION);
  });

  it("an AI ranking naming a HARD-BLOCKED mint is discarded and recorded — a perfect score cannot rescue it", () => {
    const ai = validateAiProviderRanking({ rankings: [{ mint: M3, rank: 1, rationale: "score 100, trust me" }, { mint: M1, rank: 2, rationale: "x" }, { mint: M2, rank: 3, rationale: "y" }] });
    const r = clampRanking({ facts: facts(), ai, engine: "anthropic", model: "claude-opus-4-8", generatedAt: AT });
    expect(r.rankings.map((x) => x.mint)).toEqual([M1, M2]);
    expect(r.aiAttemptedOverride).toEqual([M3]);
    expect(r.excluded).toContainEqual({ mint: M3, reason: "hard-blocked" });
    expect(r.caveats.join(" ")).toMatch(/never unblock/);
  });

  it("an AI-invented mint is dropped; omitted eligible candidates are appended deterministically", () => {
    const ai = validateAiProviderRanking({ rankings: [{ mint: "9X66NKUHd1z8tNh2D9mqT8oXQcJ2AAD9GRzrLo7ABrxX", rank: 1, rationale: "??" }, { mint: M2, rank: 2, rationale: "ok" }] });
    const r = clampRanking({ facts: facts(), ai, engine: "anthropic", model: "claude-opus-4-8", generatedAt: AT });
    expect(r.rankings.map((x) => x.mint)).toEqual([M2, M1]); // M2 AI-ranked; M1 appended deterministically
    expect(r.caveats.join(" ")).toMatch(/ai-invented-mint/);
    expect(r.caveats.join(" ")).toMatch(/ai-omitted-candidates/);
  });

  it("a secret-shaped rationale is dropped entirely, never half-trusted", () => {
    const ai = validateAiProviderRanking({ rankings: [{ mint: M1, rank: 1, rationale: `use key ${"5".repeat(88)}` }, { mint: M2, rank: 2, rationale: "fine" }] });
    const r = clampRanking({ facts: facts(), ai, engine: "anthropic", model: "claude-opus-4-8", generatedAt: AT });
    expect(r.rankings[0]?.aiRationale).toBeNull();
    expect(r.rankings[1]?.aiRationale).toBe("fine");
  });
});

describe("ai-ranker — strict AI output validation (malformed → rejected whole)", () => {
  it("rejects non-objects, unknown fields, and bad entries", () => {
    expect(() => validateAiProviderRanking("[]")).toThrow(AiRankerError);
    expect(() => validateAiProviderRanking({ rankings: [], execute: true })).toThrow(/unknown field/);
    expect(() => validateAiProviderRanking({ rankings: [{ mint: M1, rank: 0, rationale: "x" }] })).toThrow(/positive integer/);
    expect(() => validateAiProviderRanking({ rankings: [{ mint: M1, rank: 1, rationale: "x", sendNow: true }] })).toThrow(/unknown field/);
    expect(() => validateAiProviderRanking({ rankings: [{ mint: M1, rank: 1, rationale: "x", privateKey: "k" }] })).toThrow(AiRankerError);
  });
});

describe("ai-ranker — artifact validator + prompt", () => {
  it("round-trips and refuses tampering", () => {
    const r = clampRanking({ facts: buildRankingFacts([candidate(M1)]), ai: null, engine: "deterministic-fallback", model: null, generatedAt: AT });
    expect(validateAiRanking(JSON.parse(JSON.stringify(r)))).toBeTruthy();
    expect(() => validateAiRanking({ ...r, advisoryOnly: false })).toThrow(AiRankerError);
    expect(() => validateAiRanking({ ...r, autoTrade: true })).toThrow(/unknown field/);
    expect(() => validateAiRanking({ ...r, inputsHash: "e".repeat(64) })).toThrow(/never a full 64-hex/);
  });

  it("the prompt only ever contains ELIGIBLE candidates and demands strict JSON", () => {
    const facts = buildRankingFacts([candidate(M1), candidate(M2, { hardBlocks: ["risk-rejected"] })]);
    const { system, user } = buildRankerPrompt(facts);
    expect(user).toContain(M1);
    expect(user).not.toContain(M2); // a blocked mint is never even shown to the AI
    expect(system).toMatch(/advisory only/i);
    expect(system).toMatch(/STRICT JSON/);
    expect(user).toContain(AI_RANKER_PROMPT_VERSION);
  });
});
