/**
 * Strict validator for `engine.routequote.score.report.v1` — the route-quote
 * scoring artifact the Rust sidecar emits (Sprint 99). TypeScript is the
 * validation AUTHORITY and never repairs Rust output:
 *
 *   - the key sets are CLOSED (report, every entry, components, facts);
 *   - every mint is re-parsed with the real `parseMintAddress`;
 *   - every score is RECOMPUTED from its components (max(0, 100 - sum));
 *   - every entry's freshness verdict and age are RE-EVALUATED with the real
 *     `evaluateQuoteFreshness` — a disagreement refuses the whole artifact;
 *   - the ranking order, best candidate, and every count are recomputed.
 *
 * A route score is intelligence about quote quality — the validator pins the
 * literals that say so (notExecutable, notProfitabilityClaim, neverSends).
 */

import { evaluateQuoteFreshness } from "@soulmaker/core";
import { redactString } from "@soulmaker/security";
import { parseMintAddress } from "@soulmaker/sniper";
import { ENGINE_IPC_VERSION } from "./validate.js";

export const ENGINE_QUOTE_SCORE_SCHEMA_VERSION = "engine.routequote.score.report.v1";

/** Mirrors MAX_ENTRIES in the Rust crate. */
export const ENGINE_QUOTE_SCORE_MAX_ENTRIES = 500;

/** Closed per-entry reason codes — verbatim mirror of the Rust REASON_CODES. */
export const ENGINE_QUOTE_SCORE_REASON_CODES = [
  "future-timestamp",
  "hop-count-high",
  "hop-count-unknown",
  "impact-unavailable",
  "malformed-timestamp",
  "missing-timestamp",
  "not-observed",
  "price-impact-high",
  "stale",
] as const;

const QUOTE_STATUSES = ["quote-observed", "unavailable", "blocked", "error", "unsupported"] as const;
const FRESHNESS_VERDICTS = ["fresh", "stale", "missing-timestamp", "malformed-timestamp", "future-timestamp"] as const;

export interface EngineQuoteScoreComponents {
  readonly impactPenalty: number;
  readonly hopPenalty: number;
  readonly agePenalty: number;
}

export interface EngineQuoteScoreFacts {
  readonly priceImpactPct: string | null;
  readonly hopCount: number;
  readonly routeLabels: readonly string[];
  readonly fetchedAt: string | null;
  readonly ageMs: number | null;
  readonly freshnessVerdict: (typeof FRESHNESS_VERDICTS)[number];
  readonly contextSlot: number | null;
}

export interface EngineQuoteScoreEntry {
  readonly candidateId: string;
  readonly mint: string;
  readonly status: (typeof QUOTE_STATUSES)[number];
  readonly included: boolean;
  readonly score: number | null;
  readonly components: EngineQuoteScoreComponents | null;
  readonly facts: EngineQuoteScoreFacts;
  readonly reasons: readonly string[];
}

export interface EngineQuoteScoreReportV1 {
  readonly schemaVersion: typeof ENGINE_QUOTE_SCORE_SCHEMA_VERSION;
  readonly banner: string;
  readonly engineName: "solmaker-engine";
  readonly engineVersion: string;
  readonly ipcVersion: typeof ENGINE_IPC_VERSION;
  readonly scoredAt: string;
  readonly maxQuoteAgeMs: number;
  readonly providerId: string;
  readonly endpointHost: string;
  readonly reportFetchedAt: string;
  readonly requestedInputMint: string;
  readonly requestedAmountRaw: string;
  readonly requestedSlippageBps: number;
  readonly entryCount: number;
  readonly includedCount: number;
  readonly excludedCount: number;
  readonly entries: readonly EngineQuoteScoreEntry[];
  readonly ranking: readonly string[];
  readonly bestCandidateId: string | null;
  readonly caveats: readonly string[];
  readonly notExecutable: true;
  readonly notProfitabilityClaim: true;
  readonly neverSigns: true;
  readonly neverSends: true;
  readonly phase7LiveTradingReady: false;
}

const EXPECTED_KEYS = [
  "schemaVersion",
  "banner",
  "engineName",
  "engineVersion",
  "ipcVersion",
  "scoredAt",
  "maxQuoteAgeMs",
  "providerId",
  "endpointHost",
  "reportFetchedAt",
  "requestedInputMint",
  "requestedAmountRaw",
  "requestedSlippageBps",
  "entryCount",
  "includedCount",
  "excludedCount",
  "entries",
  "ranking",
  "bestCandidateId",
  "caveats",
  "notExecutable",
  "notProfitabilityClaim",
  "neverSigns",
  "neverSends",
  "phase7LiveTradingReady",
] as const;

const EXPECTED_ENTRY_KEYS = ["candidateId", "mint", "status", "included", "score", "components", "facts", "reasons"] as const;
const EXPECTED_COMPONENT_KEYS = ["impactPenalty", "hopPenalty", "agePenalty"] as const;
const EXPECTED_FACT_KEYS = ["priceImpactPct", "hopCount", "routeLabels", "fetchedAt", "ageMs", "freshnessVerdict", "contextSlot"] as const;

const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/;
const VERSION_SHAPE = /^\d+\.\d+\.\d+$/;
const RAW_AMOUNT_SHAPE = /^[0-9]{1,30}$/;

export type EngineQuoteScoreValidation =
  | { readonly ok: true; readonly report: EngineQuoteScoreReportV1 }
  | { readonly ok: false; readonly problems: readonly string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkClosedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
  problems: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) problems.push(`${where} has unknown field ${JSON.stringify(key)} (the schema is CLOSED)`);
  }
  for (const key of allowed) {
    if (!(key in value)) problems.push(`${where} is missing field ${JSON.stringify(key)}`);
  }
}

function checkBoundedString(value: unknown, field: string, max: number, problems: string[], nullable = false): void {
  if (value === null && nullable) return;
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    problems.push(`${field} must be ${nullable ? "null or " : ""}a non-empty string (max ${max} chars)`);
    return;
  }
  if (redactString(value) !== value) {
    problems.push(`${field} carries a secret-shaped span — the artifact is refused, never repaired`);
  }
}

function checkNonNegativeInt(value: unknown, field: string, problems: string[]): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    problems.push(`${field} must be a non-negative integer`);
    return null;
  }
  return value;
}

function validateEntry(
  value: unknown,
  index: number,
  scoredAtMs: number,
  maxQuoteAgeMs: number,
  problems: string[],
): void {
  const at = `entries[${index}]`;
  if (!isRecord(value)) {
    problems.push(`${at} is not a JSON object`);
    return;
  }
  checkClosedKeys(value, EXPECTED_ENTRY_KEYS, at, problems);

  try {
    const mint = parseMintAddress(value.mint);
    if (value.mint !== mint) problems.push(`${at}.mint must be the trimmed base58 mint, verbatim`);
  } catch (err) {
    problems.push(`${at}.mint: ${(err as Error).message}`);
  }
  checkBoundedString(value.candidateId, `${at}.candidateId`, 64, problems);
  if (!(QUOTE_STATUSES as readonly string[]).includes(value.status as string)) {
    problems.push(`${at}.status must be one of the closed quote statuses`);
  }
  if (typeof value.included !== "boolean") problems.push(`${at}.included must be a boolean`);

  if (!Array.isArray(value.reasons) || value.reasons.some((r) => !(ENGINE_QUOTE_SCORE_REASON_CODES as readonly string[]).includes(r as string))) {
    problems.push(`${at}.reasons must be an array drawn from the closed reason-code set`);
  }

  const facts = value.facts;
  if (!isRecord(facts)) {
    problems.push(`${at}.facts must be an object`);
    return;
  }
  checkClosedKeys(facts, EXPECTED_FACT_KEYS, `${at}.facts`, problems);
  checkBoundedString(facts.priceImpactPct, `${at}.facts.priceImpactPct`, 32, problems, true);
  const hopCount = checkNonNegativeInt(facts.hopCount, `${at}.facts.hopCount`, problems);
  if (!Array.isArray(facts.routeLabels) || facts.routeLabels.length > 8) {
    problems.push(`${at}.facts.routeLabels must be an array of at most 8 labels`);
  } else {
    facts.routeLabels.forEach((label, i) => checkBoundedString(label, `${at}.facts.routeLabels[${i}]`, 32, problems));
    if (hopCount !== null && facts.routeLabels.length !== hopCount) {
      problems.push(`${at}.facts.hopCount must equal routeLabels.length`);
    }
  }
  checkBoundedString(facts.fetchedAt, `${at}.facts.fetchedAt`, 64, problems, true);
  if (facts.ageMs !== null && (typeof facts.ageMs !== "number" || !Number.isInteger(facts.ageMs))) {
    problems.push(`${at}.facts.ageMs must be null or an integer`);
  }
  if (facts.contextSlot !== null && (typeof facts.contextSlot !== "number" || !Number.isInteger(facts.contextSlot) || facts.contextSlot < 0)) {
    problems.push(`${at}.facts.contextSlot must be null or a non-negative integer`);
  }
  if (!(FRESHNESS_VERDICTS as readonly string[]).includes(facts.freshnessVerdict as string)) {
    problems.push(`${at}.facts.freshnessVerdict must be one of the closed freshness verdicts`);
  } else {
    // PARITY WALL: re-run the REAL freshness evaluator. The Rust engine must
    // agree with TypeScript exactly or the whole artifact is refused.
    const real = evaluateQuoteFreshness({
      fetchedAt: typeof facts.fetchedAt === "string" ? facts.fetchedAt : null,
      nowMs: scoredAtMs,
      maxAgeMs: maxQuoteAgeMs,
    });
    if (real.verdict !== facts.freshnessVerdict) {
      problems.push(`${at}.facts.freshnessVerdict disagrees with evaluateQuoteFreshness (engine said ${JSON.stringify(facts.freshnessVerdict)}, TypeScript says ${JSON.stringify(real.verdict)})`);
    }
    if (real.ageMs !== facts.ageMs) {
      problems.push(`${at}.facts.ageMs disagrees with evaluateQuoteFreshness (engine said ${String(facts.ageMs)}, TypeScript says ${String(real.ageMs)})`);
    }
  }

  if (value.included === true) {
    if (value.status !== "quote-observed") problems.push(`${at} is included but its status is not quote-observed`);
    if (facts.freshnessVerdict !== "fresh") problems.push(`${at} is included but its quote is not fresh`);
    if (!isRecord(value.components)) {
      problems.push(`${at}.components must be an object for an included entry`);
    } else {
      checkClosedKeys(value.components, EXPECTED_COMPONENT_KEYS, `${at}.components`, problems);
      const impact = checkNonNegativeInt(value.components.impactPenalty, `${at}.components.impactPenalty`, problems);
      const hop = checkNonNegativeInt(value.components.hopPenalty, `${at}.components.hopPenalty`, problems);
      const age = checkNonNegativeInt(value.components.agePenalty, `${at}.components.agePenalty`, problems);
      if (impact !== null && hop !== null && age !== null) {
        const expected = Math.max(0, 100 - impact - hop - age);
        if (value.score !== expected) {
          problems.push(`${at}.score must be recomputable from its components (expected ${expected}, got ${String(value.score)})`);
        }
      }
    }
  } else {
    if (value.score !== null) problems.push(`${at}.score must be null for an excluded entry`);
    if (value.components !== null) problems.push(`${at}.components must be null for an excluded entry`);
    if (Array.isArray(value.reasons) && value.reasons.length === 0) {
      problems.push(`${at} is excluded but carries no reason — exclusions are always explained`);
    }
  }
}

/** Validate an unknown parsed value as `engine.routequote.score.report.v1`, strictly. */
export function validateEngineQuoteScoreReportV1(value: unknown): EngineQuoteScoreValidation {
  const problems: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, problems: ["artifact is not a JSON object"] };
  }
  checkClosedKeys(value, EXPECTED_KEYS, "artifact", problems);

  if (value.schemaVersion !== ENGINE_QUOTE_SCORE_SCHEMA_VERSION) {
    problems.push(`schemaVersion must be ${JSON.stringify(ENGINE_QUOTE_SCORE_SCHEMA_VERSION)}`);
  }
  checkBoundedString(value.banner, "banner", 500, problems);
  if (value.engineName !== "solmaker-engine") problems.push('engineName must be "solmaker-engine"');
  if (typeof value.engineVersion !== "string" || !VERSION_SHAPE.test(value.engineVersion)) {
    problems.push("engineVersion must be a semver-shaped string");
  }
  if (value.ipcVersion !== ENGINE_IPC_VERSION) problems.push(`ipcVersion must be ${JSON.stringify(ENGINE_IPC_VERSION)}`);

  let scoredAtMs = Number.NaN;
  if (typeof value.scoredAt !== "string" || value.scoredAt.length > 40 || !ISO_SHAPE.test(value.scoredAt)) {
    problems.push("scoredAt must be an ISO-8601-shaped UTC string");
  } else {
    scoredAtMs = Date.parse(value.scoredAt);
    if (Number.isNaN(scoredAtMs)) problems.push("scoredAt must parse as an instant");
  }
  const maxQuoteAgeMs = value.maxQuoteAgeMs;
  if (typeof maxQuoteAgeMs !== "number" || !Number.isInteger(maxQuoteAgeMs) || maxQuoteAgeMs <= 0) {
    problems.push("maxQuoteAgeMs must be a positive integer (no default cap exists by design)");
  }

  checkBoundedString(value.providerId, "providerId", 64, problems);
  checkBoundedString(value.endpointHost, "endpointHost", 128, problems);
  checkBoundedString(value.reportFetchedAt, "reportFetchedAt", 64, problems);
  try {
    parseMintAddress(value.requestedInputMint);
  } catch (err) {
    problems.push(`requestedInputMint: ${(err as Error).message}`);
  }
  if (typeof value.requestedAmountRaw !== "string" || !RAW_AMOUNT_SHAPE.test(value.requestedAmountRaw)) {
    problems.push("requestedAmountRaw must be a raw integer amount string");
  }
  if (typeof value.requestedSlippageBps !== "number" || !Number.isInteger(value.requestedSlippageBps) || value.requestedSlippageBps < 0 || value.requestedSlippageBps > 10_000) {
    problems.push("requestedSlippageBps must be an integer between 0 and 10000");
  }

  if (!Array.isArray(value.entries)) {
    problems.push("entries must be an array");
  } else {
    if (value.entries.length > ENGINE_QUOTE_SCORE_MAX_ENTRIES) {
      problems.push(`entries exceeds the ${ENGINE_QUOTE_SCORE_MAX_ENTRIES}-entry ceiling`);
    }
    if (!Number.isNaN(scoredAtMs) && typeof maxQuoteAgeMs === "number" && Number.isInteger(maxQuoteAgeMs) && maxQuoteAgeMs > 0) {
      value.entries.forEach((entry, index) => validateEntry(entry, index, scoredAtMs, maxQuoteAgeMs, problems));
    }

    if (value.entryCount !== value.entries.length) problems.push("entryCount must equal entries.length");
    const included = value.entries.filter((e) => isRecord(e) && e.included === true) as Record<string, unknown>[];
    if (value.includedCount !== included.length) problems.push("includedCount must equal the number of included entries");
    if (value.excludedCount !== value.entries.length - included.length) {
      problems.push("excludedCount must equal entryCount - includedCount");
    }

    // Recompute the deterministic ranking: score desc, age asc, candidateId asc.
    const expectedRanking = included
      .slice()
      .sort((a, b) => {
        const scoreDiff = (b.score as number) - (a.score as number);
        if (scoreDiff !== 0) return scoreDiff;
        const ageA = ((a.facts as Record<string, unknown>)?.ageMs as number | null) ?? Number.MAX_SAFE_INTEGER;
        const ageB = ((b.facts as Record<string, unknown>)?.ageMs as number | null) ?? Number.MAX_SAFE_INTEGER;
        if (ageA !== ageB) return ageA - ageB;
        return (a.candidateId as string) < (b.candidateId as string) ? -1 : 1;
      })
      .map((e) => e.candidateId as string);
    if (!Array.isArray(value.ranking) || value.ranking.length !== expectedRanking.length || value.ranking.some((id, i) => id !== expectedRanking[i])) {
      problems.push("ranking must be exactly the recomputed deterministic order (score desc, age asc, candidateId asc)");
    }
    const expectedBest = expectedRanking.length > 0 ? expectedRanking[0] : null;
    if (value.bestCandidateId !== expectedBest) {
      problems.push(`bestCandidateId must be ${JSON.stringify(expectedBest)} (the recomputed ranking head)`);
    }
  }

  if (!Array.isArray(value.caveats) || value.caveats.length === 0 || value.caveats.some((c) => typeof c !== "string" || c.length === 0 || c.length > 500)) {
    problems.push("caveats must be a non-empty array of non-empty strings (max 500 chars each)");
  }
  for (const [field, expected] of [
    ["notExecutable", true],
    ["notProfitabilityClaim", true],
    ["neverSigns", true],
    ["neverSends", true],
    ["phase7LiveTradingReady", false],
  ] as const) {
    if (value[field] !== expected) problems.push(`${field} must literally be ${String(expected)}`);
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, report: value as unknown as EngineQuoteScoreReportV1 };
}
