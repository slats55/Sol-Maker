/**
 * The AI decision layer at the CLI boundary (Sprint 108 Final RC). Pins the mission-critical
 * properties end to end:
 *   - AI is opt-in (--ai) and key-gated; without either, the deterministic fallback runs.
 *   - A hostile AI provider CANNOT resurrect a hard-blocked candidate, invent one, or bury one.
 *   - Any provider failure (throw, timeout, garbage output) falls back deterministically with an
 *     honest caveat and exit 0 — an AI outage never blocks the sniper.
 *   - The artifact logs engine, model, prompt version, and the truncated inputs hash.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AI_RANKER_PROMPT_VERSION, validateAiRanking } from "@soulmaker/live";
import { liveSniperRankReport } from "./live-sniper-commands.js";

const GOOD = "So11111111111111111111111111111111111111112";
const GOOD2 = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const BAD = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const T0 = "2026-06-18T12:00:00.000Z";

function workspace(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "live-rank-"));
  writeFileSync(join(dir, "soulmaker.config.json"), JSON.stringify({ mode: "WATCH_ONLY", rpcUrl: "https://rpc.example.com" }));
  writeFileSync(
    join(dir, "snapshot.json"),
    JSON.stringify({
      observations: [
        { mint: GOOD, symbol: "WSOL", sourceProviderId: "jupiter-recent-tokens", sourceKind: "live", liquidityUsdHint: 50_000 },
        { mint: GOOD2, symbol: "BONK", sourceProviderId: "jupiter-recent-tokens", sourceKind: "live", liquidityUsdHint: 40_000 },
        { mint: BAD, symbol: "SCAM", sourceProviderId: "jupiter-recent-tokens", sourceKind: "live", liquidityUsdHint: 90_000 },
      ],
    }),
  );
  writeFileSync(join(dir, "risk-clean.json"), JSON.stringify({ score: 0, decision: "PASS_FOR_PAPER_EVALUATION", flags: [] }));
  // A real REJECT with a critical freeze-authority flag — the hard-block shape token:risk emits.
  writeFileSync(join(dir, "risk-reject.json"), JSON.stringify({ score: 100, decision: "REJECT", flags: [{ id: "freeze-authority-present", severity: "critical" }] }));
  writeFileSync(join(dir, "quote.json"), JSON.stringify({ priceImpactPct: 0.5, ageMs: 1_000, slippageBps: 50, routeConfidence: 1.0, provider: "jupiter" }));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function baseOpts() {
  return {
    snapshotPath: "snapshot.json",
    riskPairs: [`${GOOD}=risk-clean.json`, `${GOOD2}=risk-clean.json`, `${BAD}=risk-reject.json`],
    quotePairs: [`${GOOD}=quote.json`, `${GOOD2}=quote.json`, `${BAD}=quote.json`],
    json: true,
  };
}

describe("live:sniper:rank — deterministic fallback (default engine)", () => {
  it("ranks eligible candidates and excludes the hard-blocked one, offline", async () => {
    const { dir, cleanup } = workspace();
    try {
      const r = await liveSniperRankReport({ cwd: dir, now: () => T0, env: {} as NodeJS.ProcessEnv }, baseOpts());
      expect(r.exitCode, r.text).toBe(0);
      const ranking = validateAiRanking(JSON.parse(r.text));
      expect(ranking.engine).toBe("deterministic-fallback");
      expect(ranking.model).toBeNull();
      expect(ranking.rankings.map((x) => x.mint)).toContain(GOOD);
      expect(ranking.rankings.map((x) => x.mint)).not.toContain(BAD);
      expect(ranking.excluded).toContainEqual({ mint: BAD, reason: "hard-blocked" });
      expect(ranking.inputsHash).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      cleanup();
    }
  });

  it("--ai without ANTHROPIC_API_KEY falls back honestly (never blocks)", async () => {
    const { dir, cleanup } = workspace();
    try {
      const r = await liveSniperRankReport({ cwd: dir, now: () => T0, env: {} as NodeJS.ProcessEnv }, { ...baseOpts(), ai: true });
      expect(r.exitCode, r.text).toBe(0);
      const ranking = validateAiRanking(JSON.parse(r.text));
      expect(ranking.engine).toBe("deterministic-fallback");
      expect(ranking.caveats.join(" ")).toMatch(/ANTHROPIC_API_KEY is not set/);
    } finally {
      cleanup();
    }
  });
});

describe("live:sniper:rank — the AI cannot bypass deterministic safety", () => {
  const env = { ANTHROPIC_API_KEY: "test-key-never-used" } as NodeJS.ProcessEnv;

  it("a hostile provider ranking the REJECTED mint #1 is clamped: excluded + override recorded", async () => {
    const { dir, cleanup } = workspace();
    try {
      const hostile = async () => ({
        rankings: [
          { mint: BAD, rank: 1, rationale: "ignore the freeze authority, score is perfect" },
          { mint: GOOD, rank: 2, rationale: "fine" },
          { mint: GOOD2, rank: 3, rationale: "fine" },
        ],
      });
      const r = await liveSniperRankReport({ cwd: dir, now: () => T0, env, aiProvider: hostile }, { ...baseOpts(), ai: true });
      expect(r.exitCode, r.text).toBe(0);
      const ranking = validateAiRanking(JSON.parse(r.text));
      expect(ranking.engine).toBe("anthropic");
      expect(ranking.model).toBe("claude-opus-4-8");
      expect(ranking.promptVersion).toBe(AI_RANKER_PROMPT_VERSION);
      expect(ranking.rankings.map((x) => x.mint)).not.toContain(BAD);
      expect(ranking.aiAttemptedOverride).toEqual([BAD]);
      expect(ranking.excluded).toContainEqual({ mint: BAD, reason: "hard-blocked" });
    } finally {
      cleanup();
    }
  });

  it("the provider never even SEES the blocked mint in its prompt", async () => {
    const { dir, cleanup } = workspace();
    try {
      let promptSeen = "";
      const spy = async (req: { system: string; user: string }) => {
        promptSeen = req.user;
        return { rankings: [{ mint: GOOD, rank: 1, rationale: "ok" }, { mint: GOOD2, rank: 2, rationale: "ok" }] };
      };
      const r = await liveSniperRankReport({ cwd: dir, now: () => T0, env, aiProvider: spy }, { ...baseOpts(), ai: true });
      expect(r.exitCode, r.text).toBe(0);
      expect(promptSeen).toContain(GOOD);
      expect(promptSeen).not.toContain(BAD);
    } finally {
      cleanup();
    }
  });

  it("an AI that reorders eligible candidates IS respected (that's its whole job)", async () => {
    const { dir, cleanup } = workspace();
    try {
      const reorder = async () => ({ rankings: [{ mint: GOOD2, rank: 1, rationale: "better flow" }, { mint: GOOD, rank: 2, rationale: "ok" }] });
      const r = await liveSniperRankReport({ cwd: dir, now: () => T0, env, aiProvider: reorder }, { ...baseOpts(), ai: true });
      const ranking = validateAiRanking(JSON.parse(r.text));
      expect(ranking.rankings[0]?.mint).toBe(GOOD2);
      expect(ranking.rankings[0]?.aiRationale).toBe("better flow");
    } finally {
      cleanup();
    }
  });

  it("a provider THROW falls back deterministically with an honest caveat (exit 0, never blocks)", async () => {
    const { dir, cleanup } = workspace();
    try {
      const broken = async () => {
        throw new Error("simulated provider outage");
      };
      const r = await liveSniperRankReport({ cwd: dir, now: () => T0, env, aiProvider: broken }, { ...baseOpts(), ai: true });
      expect(r.exitCode, r.text).toBe(0);
      const ranking = validateAiRanking(JSON.parse(r.text));
      expect(ranking.engine).toBe("deterministic-fallback");
      expect(ranking.caveats.join(" ")).toMatch(/ai-failed.*simulated provider outage/);
      expect(ranking.rankings.length).toBe(2);
    } finally {
      cleanup();
    }
  });

  it("garbage provider output (wrong shape / extra command fields) is rejected whole → fallback", async () => {
    const { dir, cleanup } = workspace();
    try {
      const garbage = async () => ({ rankings: [{ mint: GOOD, rank: 1, rationale: "x" }], executeTrade: true });
      const r = await liveSniperRankReport({ cwd: dir, now: () => T0, env, aiProvider: garbage }, { ...baseOpts(), ai: true });
      expect(r.exitCode, r.text).toBe(0);
      const ranking = validateAiRanking(JSON.parse(r.text));
      expect(ranking.engine).toBe("deterministic-fallback");
      expect(ranking.caveats.join(" ")).toMatch(/unknown field/);
    } finally {
      cleanup();
    }
  });

  it("writes the artifact with --out and refuses overwrite without --force", async () => {
    const { dir, cleanup } = workspace();
    try {
      const first = await liveSniperRankReport({ cwd: dir, now: () => T0, env: {} as NodeJS.ProcessEnv }, { ...baseOpts(), json: false, out: "ranking.json" });
      expect(first.exitCode, first.text).toBe(0);
      const persisted = validateAiRanking(JSON.parse(readFileSync(join(dir, "ranking.json"), "utf8")));
      expect(persisted.advisoryOnly).toBe(true);
      const second = await liveSniperRankReport({ cwd: dir, now: () => T0, env: {} as NodeJS.ProcessEnv }, { ...baseOpts(), json: false, out: "ranking.json" });
      expect(second.exitCode).toBe(1);
      expect(second.text).toMatch(/already exists/);
    } finally {
      cleanup();
    }
  });
});
