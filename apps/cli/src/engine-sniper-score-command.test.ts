/**
 * Sprint 101 — `engine:sniper:score` (Rust memecoin candidate scoring hot path).
 *
 * Pins:
 *   - refusals: missing --input, unreadable file;
 *   - a missing Rust engine is honest (exit 0; exit 1 with
 *     --fail-on-unavailable) and writes nothing;
 *   - the validated artifact renders the ranking + verdicts + caveats and
 *     --json prints it verbatim; --out refuses overwrite without --force;
 *   - a tampered engine artifact (a rejected risk shown as "watch") is REFUSED
 *     — the validator re-derives every verdict and enforces the hard gate;
 *   - REAL e2e (when a prebuilt engine exists): a real facts bundle is scored
 *     by the actual binary and survives the full re-derivation + cross-check.
 */

import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EngineProcessRunner } from "@soulmaker/engine-bridge";
import { normalizeSniperScoreInput } from "@soulmaker/sniper";
import { engineSniperScoreReport } from "./commands.js";

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const FIXED_NOW = "2026-06-13T12:00:00.000Z";

/** A real-shaped score input bundle built through the package normalizer. */
const SCORE_INPUT = normalizeSniperScoreInput({
  sourceLabel: "cli-test",
  mode: "mainnet-dry-run",
  network: "mainnet-beta-readonly",
  entries: [
    {
      candidateId: "clean",
      mint: WSOL,
      source: "jupiter-recent-tokens",
      riskDecision: "PASS_FOR_PAPER_EVALUATION",
      riskScore: 12,
      riskCriticalFlagCount: 0,
      riskHighFlagCount: 0,
      freezeAuthorityPresent: false,
      mintAuthorityPresent: false,
      token2022Blocker: false,
      holderConcentrationRisk: false,
      metadataMutable: false,
      liquidityHint: "adequate",
      quoteObserved: true,
      quoteScore: 90,
      quoteFreshness: "fresh",
      priceImpactHigh: false,
      simulationOutcome: "simulated-ok",
      txBuildRefused: false,
    },
    {
      candidateId: "rejected",
      mint: USDC,
      source: "operator",
      riskDecision: "REJECT",
      riskScore: 100,
      riskCriticalFlagCount: 1,
      freezeAuthorityPresent: true,
      quoteObserved: true,
      quoteScore: 100,
      quoteFreshness: "fresh",
      liquidityHint: "adequate",
      simulationOutcome: "simulated-ok",
      caveats: ["real freeze authority"],
    },
  ],
});

const FACT_KEYS = [
  "riskDecision", "riskScore", "riskCriticalFlagCount", "riskHighFlagCount",
  "freezeAuthorityPresent", "mintAuthorityPresent", "token2022Blocker", "holderConcentrationRisk",
  "metadataMutable", "liquidityHint", "quoteObserved", "quoteScore", "quoteFreshness",
  "priceImpactHigh", "simulationOutcome", "simulationClassification", "txBuildRefused",
];

/** Flatten a normalized candidate's facts onto the echoed candidate shape. */
function echo(candidateId: string, extra: Record<string, unknown>): Record<string, unknown> {
  const c = SCORE_INPUT.candidates.find((x) => x.candidateId === candidateId)!;
  const flat: Record<string, unknown> = { candidateId: c.candidateId, mint: c.mint, source: c.source, caveats: c.caveats };
  for (const k of FACT_KEYS) flat[k] = (c.facts as unknown as Record<string, unknown>)[k];
  return { ...flat, ...extra };
}

/** Exactly what the real engine emits for SCORE_INPUT at FIXED_NOW. */
function engineArtifact(): Record<string, unknown> {
  return {
    schemaVersion: "engine.sniper.score.report.v1",
    banner: "RUST ENGINE SNIPER CANDIDATE SCORES — test fixture banner.",
    engineName: "solmaker-engine",
    engineVersion: "0.1.0",
    ipcVersion: "engine.ipc.v1",
    createdAt: FIXED_NOW,
    scoringEngine: "solmaker-engine",
    engineSource: "rust",
    mode: "mainnet-dry-run",
    network: "mainnet-beta-readonly",
    candidateCount: 2,
    rankedCandidates: [
      echo("clean", {
        rank: 1, score: 97, verdict: "watch",
        reasonCodes: ["paper-only", "mainnet-live-disabled"],
        components: { riskSafety: 40, quoteQuality: 22, quoteFreshness: 10, liquidity: 10, tokenMechanics: 10, simulationEvidence: 5 },
        nextSafeAction: "watch-and-paper-dry-run",
      }),
      echo("rejected", {
        rank: 2, score: 55, verdict: "reject",
        reasonCodes: ["paper-only", "mainnet-live-disabled", "risk-rejected", "risk-over-threshold"],
        components: { riskSafety: 0, quoteQuality: 25, quoteFreshness: 10, liquidity: 10, tokenMechanics: 5, simulationEvidence: 5 },
        nextSafeAction: "do-not-proceed-risk-gate",
      }),
    ],
    ranking: ["clean", "rejected"],
    bestCandidateId: "clean",
    caveats: ["A candidate score is INTELLIGENCE about a candidate — test fixture caveat."],
    redactionApplied: true,
    notExecutable: true,
    notProfitabilityClaim: true,
    neverSigns: true,
    neverSends: true,
    phase7LiveTradingReady: false,
    scoreIsNotLiveReadiness: true,
    highScoreIsNotSafeToTrade: true,
  };
}

function okRunner(doc?: Record<string, unknown>): EngineProcessRunner {
  return {
    run: () =>
      Promise.resolve({
        started: true, startError: null, exitCode: 0, timedOut: false,
        stdout: JSON.stringify(doc ?? engineArtifact(), null, 2) + "\n",
        stderr: "", stdoutTruncated: false, stderrTruncated: false,
      }),
  };
}

function missingRunner(): EngineProcessRunner {
  return {
    run: () =>
      Promise.resolve({
        started: false, startError: "ENOENT", exitCode: null, timedOut: false,
        stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false,
      }),
  };
}

async function withTmpAsync<T>(fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), "engine-sniper-score-"));
  try {
    return await fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function baseCtx(tmp: string) {
  return {
    cwd: tmp,
    env: { PATH: "/usr/bin" } as NodeJS.ProcessEnv,
    now: () => FIXED_NOW,
    engineBinaryExists: () => false,
  };
}

describe("engine:sniper:score — refusals", () => {
  it("requires --input and a readable file", async () => {
    await withTmpAsync(async (tmp) => {
      const ctx = { ...baseCtx(tmp), createEngineRunner: () => okRunner() };
      expect((await engineSniperScoreReport(ctx, {})).text).toContain("--input");
      const unreadable = await engineSniperScoreReport(ctx, { inputPath: "missing.json" });
      expect(unreadable.exitCode).toBe(1);
      expect(unreadable.text).toContain("cannot read");
    });
  });

  it("a missing Rust engine is honest (exit 0; exit 1 with --fail-on-unavailable) and writes nothing", async () => {
    await withTmpAsync(async (tmp) => {
      writeFileSync(join(tmp, "bundle.json"), JSON.stringify(SCORE_INPUT));
      const ctx = { ...baseCtx(tmp), createEngineRunner: () => missingRunner() };
      const outPath = join(tmp, "scores.json");
      const soft = await engineSniperScoreReport(ctx, { inputPath: "bundle.json", outPath });
      expect(soft.exitCode).toBe(0);
      expect(soft.text).toContain("UNAVAILABLE");
      expect(existsSync(outPath)).toBe(false);

      const hard = await engineSniperScoreReport(ctx, { inputPath: "bundle.json", failOnUnavailable: true });
      expect(hard.exitCode).toBe(1);
    });
  });

  it("a tampered artifact (a REJECT shown as watch) is REFUSED with exit 1", async () => {
    await withTmpAsync(async (tmp) => {
      writeFileSync(join(tmp, "bundle.json"), JSON.stringify(SCORE_INPUT));
      const doc = engineArtifact();
      const rej = (doc.rankedCandidates as Record<string, unknown>[])[1] as Record<string, unknown>;
      rej.verdict = "watch";
      rej.nextSafeAction = "watch-and-paper-dry-run";
      rej.reasonCodes = ["paper-only", "mainnet-live-disabled"];
      const ctx = { ...baseCtx(tmp), createEngineRunner: () => okRunner(doc) };
      const r = await engineSniperScoreReport(ctx, { inputPath: "bundle.json" });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("REFUSED");
      expect(r.text).toContain("schema-mismatch");
    });
  });
});

describe("engine:sniper:score — validated artifact", () => {
  it("renders the ranking, verdicts, best line, and the not-readiness warning; --json prints verbatim; --out writes it", async () => {
    await withTmpAsync(async (tmp) => {
      writeFileSync(join(tmp, "bundle.json"), JSON.stringify(SCORE_INPUT));
      const ctx = { ...baseCtx(tmp), createEngineRunner: () => okRunner() };
      const text = await engineSniperScoreReport(ctx, { inputPath: "bundle.json" });
      expect(text.exitCode, text.text.slice(0, 400)).toBe(0);
      expect(text.text).toContain("RUST ENGINE SNIPER CANDIDATE SCORES");
      expect(text.text).toContain("watch");
      expect(text.text).toContain("reject");
      expect(text.text).toContain("best:      clean");
      expect(text.text).toContain("a rejected risk stays rejected");
      expect(text.text).toContain("CAVEAT:");

      const outPath = join(tmp, "scores.json");
      const json = await engineSniperScoreReport(ctx, { inputPath: "bundle.json", json: true, outPath });
      expect(json.exitCode).toBe(0);
      const parsed = JSON.parse(json.text.split("\nwrote ")[0] ?? "") as Record<string, unknown>;
      expect(parsed.schemaVersion).toBe("engine.sniper.score.report.v1");
      expect(parsed.bestCandidateId).toBe("clean");
      const written = JSON.parse(readFileSync(outPath, "utf8")) as Record<string, unknown>;
      expect(written.schemaVersion).toBe("engine.sniper.score.report.v1");

      const second = await engineSniperScoreReport(ctx, { inputPath: "bundle.json", outPath });
      expect(second.exitCode).toBe(1);
      expect(second.text).toContain("already exists");
    });
  });
});

// ---------------------------------------------------------------------------
// REAL e2e: the actual Rust binary scores a real facts bundle and the artifact
// survives the full re-derivation + input cross-check. Skipped honestly when
// no prebuilt engine exists.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ENGINE_BINARY = process.platform === "win32" ? "solmaker-engine.exe" : "solmaker-engine";
const PREBUILT_ENGINE_EXISTS =
  existsSync(join(REPO_ROOT, "target", "release", ENGINE_BINARY)) ||
  existsSync(join(REPO_ROOT, "target", "debug", ENGINE_BINARY));

describe("engine:sniper:score — REAL engine e2e", () => {
  it.skipIf(!PREBUILT_ENGINE_EXISTS)("scores a real bundle through the actual binary", async () => {
    await withTmpAsync(async (tmp) => {
      const inputPath = join(tmp, "bundle.json");
      writeFileSync(inputPath, JSON.stringify(SCORE_INPUT));
      const ctx = { cwd: REPO_ROOT, env: process.env, now: () => FIXED_NOW };
      const r = await engineSniperScoreReport(ctx, { inputPath, json: true });
      expect(r.exitCode, r.text.slice(0, 400)).toBe(0);
      const parsed = JSON.parse(r.text) as Record<string, unknown>;
      expect(parsed.schemaVersion).toBe("engine.sniper.score.report.v1");
      expect(parsed.bestCandidateId).toBe("clean");
      const ranked = parsed.rankedCandidates as Record<string, unknown>[];
      const rejected = ranked.find((c) => c.candidateId === "rejected")!;
      expect(rejected.verdict).toBe("reject");
    });
  });
});
