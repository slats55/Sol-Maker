/**
 * ADVISORY AI RANKING WITH A DETERMINISTIC CLAMP (`live.ai.ranking.v1`, Sprint 108 Final RC).
 *
 * An AI model may EXPLAIN and RE-ORDER candidates. It may never unblock one. The contract, all
 * enforced in code and pinned by tests:
 *
 *   - The eligible set is computed DETERMINISTICALLY before the AI sees anything: a candidate with
 *     a hard block (risk reject, critical flag, denylist, freeze/mint authority, missing risk) is
 *     excluded and NO AI output can bring it back. An AI ranking that names a blocked mint is
 *     recorded in `aiAttemptedOverride` — an honest audit trail — and discarded.
 *   - An AI ranking that names a mint we never scored is discarded (`aiInventedMint` caveat).
 *   - Eligible candidates the AI omitted are appended in deterministic order, never lost.
 *   - Malformed AI output (wrong shape, unknown fields) is REJECTED whole — the caller falls back
 *     to the deterministic ranking. The system NEVER blocks on an AI failure; the fallback is the
 *     default engine and works offline.
 *   - Every artifact carries the prompt version, model, engine, and a truncated sha256-128
 *     `inputsHash` of the exact facts the ranking saw (truncated so a hash can never be mistaken
 *     for key material by the redactor).
 *   - Rationales are redacted and length-clamped; a secret-shaped rationale is dropped.
 *
 * Pure: the caller supplies the timestamp and any AI output; no clock, no network here. The
 * network adapter lives at the CLI seam (`apps/cli/src/ai-provider.ts`) and is injectable.
 */

import { createHash } from "node:crypto";

import { isSensitiveKey, redactString } from "@soulmaker/security";

import { isValidMint } from "./discovery.js";
import type { StrategyScoreResult } from "./strategy.js";

export const LIVE_AI_RANKING_SCHEMA_VERSION = "live.ai.ranking.v1";
export const AI_RANKER_PROMPT_VERSION = "sniper-rank-prompt-v1";

/** The engines a ranking can come from. The fallback is always available and is the default. */
export const AI_RANKING_ENGINES = ["deterministic-fallback", "anthropic"] as const;
export type AiRankingEngine = (typeof AI_RANKING_ENGINES)[number];

export interface AiRankingEntry {
  mint: string;
  /** 1-based final rank after the clamp. */
  rank: number;
  /** Deterministic strategy score (the fallback ordering key). */
  score: number;
  /** Strategy decision at ranking time (advisory context, never re-derived here). */
  decision: string;
  /** AI-provided rationale (redacted, clamped) or null for deterministic entries. */
  aiRationale: string | null;
}

export interface AiRankingExclusion {
  mint: string;
  reason: "hard-blocked" | "not-scored";
}

export interface LiveAiRanking {
  schemaVersion: typeof LIVE_AI_RANKING_SCHEMA_VERSION;
  generatedAt: string;
  engine: AiRankingEngine;
  /** Model id when the AI engine produced the ordering; null for the fallback. */
  model: string | null;
  /** Prompt version when the AI engine was attempted; null when it never ran. */
  promptVersion: string | null;
  /** sha256 truncated to 128 bits over the canonical facts the ranking saw. */
  inputsHash: string;
  rankings: AiRankingEntry[];
  /** Hard-blocked candidates — excluded BEFORE the AI saw anything; nothing can rank them. */
  excluded: AiRankingExclusion[];
  /** Mints a hostile/confused AI tried to rank despite a hard block. Discarded, recorded. */
  aiAttemptedOverride: string[];
  caveats: string[];
  /** Pinned honesty literals. */
  advisoryOnly: true;
  cannotOverrideSafety: true;
  notProfitabilityClaim: true;
}

export class AiRankerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiRankerError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Canonical JSON (sorted keys, no whitespace) so the inputs hash is stable across key order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/** sha256 truncated to 128 bits (32 hex chars) — full 64-hex is redactor-key-shaped, never emit it. */
export function computeInputsHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------------------
// Deterministic facts + eligibility (the AI never touches this part)
// ---------------------------------------------------------------------------

export interface RankableCandidate {
  mint: string;
  strategy: StrategyScoreResult;
}

export interface RankingFacts {
  /** Candidates with no hard block — the ONLY set the AI may reorder. */
  eligible: RankableCandidate[];
  /** Hard-blocked candidates — excluded up front. */
  blocked: RankableCandidate[];
  inputsHash: string;
}

/** Split candidates into the eligible ordering pool and the untouchable blocked set. */
export function buildRankingFacts(candidates: readonly RankableCandidate[]): RankingFacts {
  const eligible: RankableCandidate[] = [];
  const blocked: RankableCandidate[] = [];
  for (const c of candidates) {
    if (c.strategy.hardBlocks.length > 0 || c.strategy.decision === "ignore") blocked.push(c);
    else eligible.push(c);
  }
  const hashSource = candidates.map((c) => ({
    mint: c.mint,
    decision: c.strategy.decision,
    score: c.strategy.score,
    hardBlocks: c.strategy.hardBlocks,
    softWarnings: c.strategy.softWarnings,
    confidence: c.strategy.confidence,
  }));
  return { eligible, blocked, inputsHash: computeInputsHash(hashSource) };
}

/** The always-available ordering: score desc, then decision confidence, then mint asc (stable). */
export function rankDeterministic(eligible: readonly RankableCandidate[]): RankableCandidate[] {
  return [...eligible].sort((a, b) => {
    if (b.strategy.score !== a.strategy.score) return b.strategy.score - a.strategy.score;
    if (b.strategy.confidence !== a.strategy.confidence) return b.strategy.confidence - a.strategy.confidence;
    return a.mint < b.mint ? -1 : a.mint > b.mint ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// AI output validation + clamp
// ---------------------------------------------------------------------------

/** The exact JSON shape the AI must return. Anything else is rejected whole. */
export interface AiProviderRanking {
  rankings: { mint: string; rank: number; rationale: string }[];
}

const AI_OUTPUT_KEYS: ReadonlySet<string> = new Set(["rankings"]);
const AI_ENTRY_KEYS: ReadonlySet<string> = new Set(["mint", "rank", "rationale"]);

/** Strictly validate raw AI output. A malformed response throws — the caller falls back. */
export function validateAiProviderRanking(value: unknown): AiProviderRanking {
  if (!isObject(value)) throw new AiRankerError("AI output must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!AI_OUTPUT_KEYS.has(key)) throw new AiRankerError(`AI output carries unknown field "${key}" — rejected whole`);
  }
  if (!Array.isArray(value.rankings)) throw new AiRankerError("AI output.rankings must be an array");
  const rankings = value.rankings.map((raw, i) => {
    if (!isObject(raw)) throw new AiRankerError(`AI output.rankings[${i}] must be an object`);
    for (const key of Object.keys(raw)) {
      if (isSensitiveKey(key)) throw new AiRankerError(`AI output.rankings[${i}] carries sensitive-named field "${key}"`);
      if (!AI_ENTRY_KEYS.has(key)) throw new AiRankerError(`AI output.rankings[${i}] carries unknown field "${key}" — rejected whole`);
    }
    if (typeof raw.mint !== "string") throw new AiRankerError(`AI output.rankings[${i}].mint must be a string`);
    if (typeof raw.rank !== "number" || !Number.isInteger(raw.rank) || raw.rank < 1) {
      throw new AiRankerError(`AI output.rankings[${i}].rank must be a positive integer`);
    }
    if (typeof raw.rationale !== "string") throw new AiRankerError(`AI output.rankings[${i}].rationale must be a string`);
    return { mint: raw.mint, rank: raw.rank, rationale: raw.rationale };
  });
  return { rankings };
}

function cleanRationale(rationale: string): string | null {
  const clipped = rationale.trim().slice(0, 200);
  if (clipped.length === 0) return null;
  const redacted = redactString(clipped);
  // A rationale the redactor had to touch is dropped entirely — never half-trust it.
  return redacted === clipped ? clipped : null;
}

export interface ClampInput {
  facts: RankingFacts;
  /** Validated AI output (or null → pure deterministic fallback). */
  ai: AiProviderRanking | null;
  engine: AiRankingEngine;
  model: string | null;
  generatedAt: string;
  caveats?: string[];
}

/**
 * THE SAFETY CLAMP. Produce the final ranking artifact from deterministic facts plus (optionally)
 * AI output. The AI can only permute the eligible set: blocked mints stay excluded (attempts are
 * recorded), invented mints are dropped, omitted eligibles are appended deterministically.
 */
export function clampRanking(input: ClampInput): LiveAiRanking {
  const { facts } = input;
  const caveats = [...(input.caveats ?? [])];
  const aiAttemptedOverride: string[] = [];

  const eligibleByMint = new Map(facts.eligible.map((c) => [c.mint, c]));
  const blockedMints = new Set(facts.blocked.map((c) => c.mint));

  const ordered: { candidate: RankableCandidate; rationale: string | null }[] = [];
  if (input.ai !== null) {
    const seen = new Set<string>();
    const sorted = [...input.ai.rankings].sort((a, b) => a.rank - b.rank);
    for (const entry of sorted) {
      if (seen.has(entry.mint)) continue;
      seen.add(entry.mint);
      if (blockedMints.has(entry.mint)) {
        aiAttemptedOverride.push(entry.mint);
        continue;
      }
      const candidate = eligibleByMint.get(entry.mint);
      if (candidate === undefined) {
        caveats.push(`ai-invented-mint: ${isValidMint(entry.mint) ? entry.mint : "(malformed mint)"} was never a scored candidate — dropped`);
        continue;
      }
      ordered.push({ candidate, rationale: cleanRationale(entry.rationale) });
      eligibleByMint.delete(entry.mint);
    }
    if (aiAttemptedOverride.length > 0) {
      caveats.push(`ai-attempted-override: the AI ranked ${aiAttemptedOverride.length} hard-blocked candidate(s) — discarded; a ranking can never unblock`);
    }
    if (eligibleByMint.size > 0) {
      caveats.push(`ai-omitted-candidates: ${eligibleByMint.size} eligible candidate(s) were appended in deterministic order`);
    }
  }
  // Anything not ordered by the AI (or everything, for the fallback) in deterministic order.
  for (const candidate of rankDeterministic([...eligibleByMint.values()])) {
    ordered.push({ candidate, rationale: null });
  }

  return {
    schemaVersion: LIVE_AI_RANKING_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    engine: input.engine,
    model: input.model,
    promptVersion: input.engine === "anthropic" ? AI_RANKER_PROMPT_VERSION : input.model !== null ? AI_RANKER_PROMPT_VERSION : null,
    inputsHash: facts.inputsHash,
    rankings: ordered.map((o, i) => ({
      mint: o.candidate.mint,
      rank: i + 1,
      score: o.candidate.strategy.score,
      decision: o.candidate.strategy.decision,
      aiRationale: o.rationale,
    })),
    excluded: facts.blocked.map((c) => ({ mint: c.mint, reason: "hard-blocked" as const })),
    aiAttemptedOverride,
    caveats,
    advisoryOnly: true,
    cannotOverrideSafety: true,
    notProfitabilityClaim: true,
  };
}

const RANKING_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "generatedAt",
  "engine",
  "model",
  "promptVersion",
  "inputsHash",
  "rankings",
  "excluded",
  "aiAttemptedOverride",
  "caveats",
  "advisoryOnly",
  "cannotOverrideSafety",
  "notProfitabilityClaim",
]);

/** Strictly validate a persisted ranking artifact (closed schema; literals pinned). */
export function validateAiRanking(value: unknown): LiveAiRanking {
  if (!isObject(value)) throw new AiRankerError("ranking must be a JSON object");
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) throw new AiRankerError(`ranking carries sensitive-named field "${key}"`);
    if (!RANKING_KEYS.has(key)) throw new AiRankerError(`ranking carries unknown field "${key}" — the v1 schema is CLOSED`);
  }
  if (value.schemaVersion !== LIVE_AI_RANKING_SCHEMA_VERSION) {
    throw new AiRankerError(`ranking.schemaVersion must be "${LIVE_AI_RANKING_SCHEMA_VERSION}"`);
  }
  if (!(AI_RANKING_ENGINES as readonly string[]).includes(value.engine as string)) {
    throw new AiRankerError(`ranking.engine must be one of ${AI_RANKING_ENGINES.join("|")}`);
  }
  for (const [literal, expected] of [
    ["advisoryOnly", true],
    ["cannotOverrideSafety", true],
    ["notProfitabilityClaim", true],
  ] as const) {
    if (value[literal] !== expected) throw new AiRankerError(`ranking.${literal} must be the literal ${String(expected)}`);
  }
  if (typeof value.inputsHash !== "string" || !/^[0-9a-f]{32}$/.test(value.inputsHash)) {
    throw new AiRankerError("ranking.inputsHash must be a 32-hex truncated sha256 (never a full 64-hex blob)");
  }
  if (!Array.isArray(value.rankings)) throw new AiRankerError("ranking.rankings must be an array");
  return value as unknown as LiveAiRanking;
}

// ---------------------------------------------------------------------------
// The prompt (versioned; the network call lives at the CLI seam)
// ---------------------------------------------------------------------------

/**
 * Build the versioned prompt for the AI provider. Only ELIGIBLE candidates are included — the AI
 * never even sees a hard-blocked mint, so the clamp's override trail catches only a model that
 * hallucinates one. The prompt demands strict JSON matching {@link AiProviderRanking}.
 */
export function buildRankerPrompt(facts: RankingFacts): { system: string; user: string } {
  const system = [
    "You are an ADVISORY ranking assistant for a Solana memecoin paper-trading research tool.",
    "You rank candidates that already passed deterministic safety checks. You cannot approve, unblock, or trade anything; your output is advisory only and is clamped by deterministic safety code.",
    "Never claim profitability. Never invent candidates. Never include secrets.",
    'Respond with STRICT JSON only, exactly: {"rankings":[{"mint":"<mint>","rank":1,"rationale":"<max 200 chars>"}, ...]}',
    "Include every candidate exactly once. Rank 1 = most promising DATA quality and momentum, judged only from the facts given.",
  ].join("\n");
  const user = JSON.stringify(
    {
      promptVersion: AI_RANKER_PROMPT_VERSION,
      candidates: facts.eligible.map((c) => ({
        mint: c.mint,
        score: c.strategy.score,
        decision: c.strategy.decision,
        confidence: c.strategy.confidence,
        softWarnings: c.strategy.softWarnings,
        missingData: c.strategy.missingData,
      })),
    },
    null,
    1,
  );
  return { system, user };
}
