/**
 * Sprint 99 — `engine:quote:score` (Rust route-quote scoring hot path).
 *
 * Pins:
 *   - refusals: missing --report, missing/invalid --max-quote-age-ms (no
 *     default cap by design), unreadable file;
 *   - a missing Rust engine is honest (exit 0; exit 1 with
 *     --fail-on-unavailable) and writes nothing;
 *   - the validated artifact renders the ranking + exclusions + caveats and
 *     --json prints it verbatim;
 *   - a tampered engine artifact (wrong arithmetic) is REFUSED — the validator
 *     recomputes every score;
 *   - REAL e2e (when a prebuilt engine exists): a real fetch-report fixture is
 *     scored by the actual binary and survives the recompute + freshness
 *     parity wall.
 */

import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EngineProcessRunner } from "@soulmaker/engine-bridge";
import { engineQuoteScoreReport } from "./commands.js";

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const FIXED_NOW = "2026-06-12T12:00:00.000Z";

const FETCH_REPORT = {
  schemaVersion: "routequote.fetch.report.v1",
  providerId: "jupiter-lite-api",
  endpointHost: "lite-api.jup.ag",
  fetchedAt: "2026-06-12T11:59:30.000Z",
  requestedInputMint: WSOL,
  requestedAmountRaw: "10000000",
  requestedSlippageBps: 50,
  entries: [
    {
      candidateId: "cand-usdc",
      mint: USDC,
      status: "quote-observed",
      observation: {},
      metadata: {
        providerId: "jupiter-lite-api",
        endpointHost: "lite-api.jup.ag",
        fetchedAt: "2026-06-12T11:59:30.000Z",
        priceImpactPct: "0.5",
        routeLabels: ["Raydium"],
        contextSlot: 426052463,
      },
    },
    {
      candidateId: "cand-blocked",
      mint: WSOL,
      status: "blocked",
      observation: {},
      metadata: { providerId: "jupiter-lite-api", endpointHost: "lite-api.jup.ag" },
    },
  ],
};

/** Exactly what the real engine emits for FETCH_REPORT at FIXED_NOW / 60s cap. */
function engineArtifact(): Record<string, unknown> {
  return {
    schemaVersion: "engine.routequote.score.report.v1",
    banner: "RUST ENGINE ROUTE QUOTE SCORES — test fixture banner.",
    engineName: "solmaker-engine",
    engineVersion: "0.1.0",
    ipcVersion: "engine.ipc.v1",
    scoredAt: FIXED_NOW,
    maxQuoteAgeMs: 60_000,
    providerId: "jupiter-lite-api",
    endpointHost: "lite-api.jup.ag",
    reportFetchedAt: "2026-06-12T11:59:30.000Z",
    requestedInputMint: WSOL,
    requestedAmountRaw: "10000000",
    requestedSlippageBps: 50,
    entryCount: 2,
    includedCount: 1,
    excludedCount: 1,
    entries: [
      {
        candidateId: "cand-usdc",
        mint: USDC,
        status: "quote-observed",
        included: true,
        score: 85,
        components: { impactPenalty: 5, hopPenalty: 0, agePenalty: 10 },
        facts: {
          priceImpactPct: "0.5",
          hopCount: 1,
          routeLabels: ["Raydium"],
          fetchedAt: "2026-06-12T11:59:30.000Z",
          ageMs: 30_000,
          freshnessVerdict: "fresh",
          contextSlot: 426052463,
        },
        reasons: [],
      },
      {
        candidateId: "cand-blocked",
        mint: WSOL,
        status: "blocked",
        included: false,
        score: null,
        components: null,
        facts: {
          priceImpactPct: null,
          hopCount: 0,
          routeLabels: [],
          fetchedAt: null,
          ageMs: null,
          freshnessVerdict: "missing-timestamp",
          contextSlot: null,
        },
        reasons: ["not-observed"],
      },
    ],
    ranking: ["cand-usdc"],
    bestCandidateId: "cand-usdc",
    caveats: ["A route score is INTELLIGENCE about quote quality — test fixture caveat."],
    notExecutable: true,
    notProfitabilityClaim: true,
    neverSigns: true,
    neverSends: true,
    phase7LiveTradingReady: false,
  };
}

function okRunner(doc?: Record<string, unknown>): EngineProcessRunner {
  return {
    run: () =>
      Promise.resolve({
        started: true,
        startError: null,
        exitCode: 0,
        timedOut: false,
        stdout: JSON.stringify(doc ?? engineArtifact(), null, 2) + "\n",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      }),
  };
}

function missingRunner(): EngineProcessRunner {
  return {
    run: () =>
      Promise.resolve({
        started: false,
        startError: "ENOENT",
        exitCode: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      }),
  };
}

async function withTmpAsync<T>(fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), "engine-quote-score-"));
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

describe("engine:quote:score — refusals", () => {
  it("requires --report, an explicit positive --max-quote-age-ms, and a readable file", async () => {
    await withTmpAsync(async (tmp) => {
      const ctx = { ...baseCtx(tmp), createEngineRunner: () => okRunner() };
      expect((await engineQuoteScoreReport(ctx, { maxQuoteAgeMs: "60000" })).text).toContain("--report");
      expect((await engineQuoteScoreReport(ctx, { reportPath: "r.json" })).text).toContain("--max-quote-age-ms");
      expect((await engineQuoteScoreReport(ctx, { reportPath: "r.json", maxQuoteAgeMs: "0" })).text).toContain("--max-quote-age-ms");
      expect((await engineQuoteScoreReport(ctx, { reportPath: "r.json", maxQuoteAgeMs: "sixty" })).text).toContain("--max-quote-age-ms");
      const unreadable = await engineQuoteScoreReport(ctx, { reportPath: "missing.json", maxQuoteAgeMs: "60000" });
      expect(unreadable.exitCode).toBe(1);
      expect(unreadable.text).toContain("cannot read");
    });
  });

  it("a missing Rust engine is honest (exit 0; exit 1 with --fail-on-unavailable) and writes nothing", async () => {
    await withTmpAsync(async (tmp) => {
      writeFileSync(join(tmp, "report.json"), JSON.stringify(FETCH_REPORT));
      const ctx = { ...baseCtx(tmp), createEngineRunner: () => missingRunner() };
      const outPath = join(tmp, "scores.json");
      const soft = await engineQuoteScoreReport(ctx, { reportPath: "report.json", maxQuoteAgeMs: "60000", outPath });
      expect(soft.exitCode).toBe(0);
      expect(soft.text).toContain("UNAVAILABLE");
      expect(existsSync(outPath)).toBe(false);

      const hard = await engineQuoteScoreReport(ctx, { reportPath: "report.json", maxQuoteAgeMs: "60000", failOnUnavailable: true });
      expect(hard.exitCode).toBe(1);
    });
  });

  it("a tampered engine artifact (arithmetic drift) is REFUSED with exit 1", async () => {
    await withTmpAsync(async (tmp) => {
      writeFileSync(join(tmp, "report.json"), JSON.stringify(FETCH_REPORT));
      const doc = engineArtifact();
      ((doc.entries as Record<string, unknown>[])[0] as Record<string, unknown>).score = 99; // components say 85
      const ctx = { ...baseCtx(tmp), createEngineRunner: () => okRunner(doc) };
      const r = await engineQuoteScoreReport(ctx, { reportPath: "report.json", maxQuoteAgeMs: "60000" });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("REFUSED");
      expect(r.text).toContain("schema-mismatch");
    });
  });
});

describe("engine:quote:score — validated artifact", () => {
  it("renders the ranking, exclusions, best line, and caveats; --json prints verbatim; --out writes it", async () => {
    await withTmpAsync(async (tmp) => {
      writeFileSync(join(tmp, "report.json"), JSON.stringify(FETCH_REPORT));
      const ctx = { ...baseCtx(tmp), createEngineRunner: () => okRunner() };
      const text = await engineQuoteScoreReport(ctx, { reportPath: "report.json", maxQuoteAgeMs: "60000" });
      expect(text.exitCode, text.text.slice(0, 400)).toBe(0);
      expect(text.text).toContain("RUST ENGINE ROUTE QUOTE SCORES");
      expect(text.text).toContain("85  cand-usdc");
      expect(text.text).toContain("cand-blocked EXCLUDED [not-observed]");
      expect(text.text).toContain("best:      cand-usdc");
      expect(text.text).toContain("never a profitability claim");
      expect(text.text).toContain("CAVEAT:");

      const outPath = join(tmp, "scores.json");
      const json = await engineQuoteScoreReport(ctx, { reportPath: "report.json", maxQuoteAgeMs: "60000", json: true, outPath });
      expect(json.exitCode).toBe(0);
      const parsed = JSON.parse(json.text.split("\nwrote ")[0] ?? "") as Record<string, unknown>;
      expect(parsed.schemaVersion).toBe("engine.routequote.score.report.v1");
      expect(parsed.bestCandidateId).toBe("cand-usdc");
      const written = JSON.parse(readFileSync(outPath, "utf8")) as Record<string, unknown>;
      expect(written.schemaVersion).toBe("engine.routequote.score.report.v1");

      const second = await engineQuoteScoreReport(ctx, { reportPath: "report.json", maxQuoteAgeMs: "60000", outPath });
      expect(second.exitCode).toBe(1);
      expect(second.text).toContain("already exists");
    });
  });
});

// ---------------------------------------------------------------------------
// REAL e2e: the actual Rust binary scores a fixture fetch report and the
// artifact survives the recompute + freshness parity wall. Skipped honestly
// when no prebuilt engine exists.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ENGINE_BINARY = process.platform === "win32" ? "solmaker-engine.exe" : "solmaker-engine";
const PREBUILT_ENGINE_EXISTS =
  existsSync(join(REPO_ROOT, "target", "release", ENGINE_BINARY)) ||
  existsSync(join(REPO_ROOT, "target", "debug", ENGINE_BINARY));

describe("engine:quote:score — REAL engine e2e", () => {
  it.skipIf(!PREBUILT_ENGINE_EXISTS)("scores a real fixture through the actual binary", async () => {
    await withTmpAsync(async (tmp) => {
      const reportPath = join(tmp, "report.json");
      writeFileSync(reportPath, JSON.stringify(FETCH_REPORT));
      const ctx = { cwd: REPO_ROOT, env: process.env, now: () => FIXED_NOW };
      const r = await engineQuoteScoreReport(ctx, { reportPath, maxQuoteAgeMs: "60000", json: true });
      expect(r.exitCode, r.text.slice(0, 400)).toBe(0);
      const parsed = JSON.parse(r.text) as Record<string, unknown>;
      expect(parsed.schemaVersion).toBe("engine.routequote.score.report.v1");
      expect(parsed.bestCandidateId).toBe("cand-usdc");
      expect(parsed.includedCount).toBe(1);
      expect(parsed.excludedCount).toBe(1);
    });
  });
});
