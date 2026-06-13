import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateQuoteFreshness } from "@soulmaker/core";
import { validateEngineQuoteScoreReportV1 } from "./validate-quote-score.js";
import { scoreQuotesThroughEngine } from "./quote-score.js";
import { createEngineProcessRunner, type EngineProcessRunner, type EngineProcessOptions, type EngineProcessResult } from "./runner.js";

// Public, well-known mints — public chain data, never secrets.
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const SCORED_AT = "2026-06-12T12:00:00.000Z";
const MAX_AGE_MS = 60_000;

/** A small but real-shaped routequote.fetch.report.v1 document. */
const FETCH_REPORT = JSON.stringify({
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
      candidateId: "cand-bonk",
      mint: BONK,
      status: "quote-observed",
      observation: {},
      metadata: {
        providerId: "jupiter-lite-api",
        endpointHost: "lite-api.jup.ag",
        fetchedAt: "2026-06-12T11:59:50.000Z",
        priceImpactPct: "0.01",
        routeLabels: ["Orca"],
        contextSlot: 426052464,
      },
    },
    {
      candidateId: "cand-blocked",
      mint: WSOL,
      status: "blocked",
      observation: {},
      metadata: { providerId: "jupiter-lite-api", endpointHost: "lite-api.jup.ag" },
    },
    {
      candidateId: "cand-stale",
      mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      status: "quote-observed",
      observation: {},
      metadata: {
        providerId: "jupiter-lite-api",
        endpointHost: "lite-api.jup.ag",
        fetchedAt: "2026-06-12T11:00:00.000Z",
        priceImpactPct: "0.1",
        routeLabels: ["Orca"],
      },
    },
  ],
});

/** What the Rust engine emits for FETCH_REPORT — mirrored field by field. */
function engineArtifact(): Record<string, unknown> {
  return {
    schemaVersion: "engine.routequote.score.report.v1",
    banner: "RUST ENGINE ROUTE QUOTE SCORES — test fixture banner.",
    engineName: "solmaker-engine",
    engineVersion: "0.1.0",
    ipcVersion: "engine.ipc.v1",
    scoredAt: SCORED_AT,
    maxQuoteAgeMs: MAX_AGE_MS,
    providerId: "jupiter-lite-api",
    endpointHost: "lite-api.jup.ag",
    reportFetchedAt: "2026-06-12T11:59:30.000Z",
    requestedInputMint: WSOL,
    requestedAmountRaw: "10000000",
    requestedSlippageBps: 50,
    entryCount: 4,
    includedCount: 2,
    excludedCount: 2,
    entries: [
      {
        candidateId: "cand-usdc",
        mint: USDC,
        status: "quote-observed",
        included: true,
        score: 85, // 100 - impact 5 - hop 0 - age 10
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
        candidateId: "cand-bonk",
        mint: BONK,
        status: "quote-observed",
        included: true,
        score: 96, // 100 - impact 1 - hop 0 - age 3 (10s of 60s cap)
        components: { impactPenalty: 1, hopPenalty: 0, agePenalty: 3 },
        facts: {
          priceImpactPct: "0.01",
          hopCount: 1,
          routeLabels: ["Orca"],
          fetchedAt: "2026-06-12T11:59:50.000Z",
          ageMs: 10_000,
          freshnessVerdict: "fresh",
          contextSlot: 426052464,
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
      {
        candidateId: "cand-stale",
        mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
        status: "quote-observed",
        included: false,
        score: null,
        components: null,
        facts: {
          priceImpactPct: "0.1",
          hopCount: 1,
          routeLabels: ["Orca"],
          fetchedAt: "2026-06-12T11:00:00.000Z",
          ageMs: 3_600_000,
          freshnessVerdict: "stale",
          contextSlot: null,
        },
        reasons: ["stale"],
      },
    ],
    ranking: ["cand-bonk", "cand-usdc"],
    bestCandidateId: "cand-bonk",
    caveats: ["A route score is INTELLIGENCE about quote quality — test fixture caveat."],
    notExecutable: true,
    notProfitabilityClaim: true,
    neverSigns: true,
    neverSends: true,
    phase7LiveTradingReady: false,
  };
}

function fixture(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(engineArtifact())) as Record<string, unknown>;
}

function entryAt(doc: Record<string, unknown>, index: number): Record<string, unknown> {
  return (doc.entries as Record<string, unknown>[])[index] as Record<string, unknown>;
}

function fakeRunner(
  result: Partial<EngineProcessResult>,
  capture?: { args?: readonly string[]; opts?: EngineProcessOptions },
): EngineProcessRunner {
  return {
    run(_command, args, opts) {
      if (capture) {
        capture.args = args;
        capture.opts = opts;
      }
      return Promise.resolve({
        started: true,
        startError: null,
        exitCode: 0,
        timedOut: false,
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        ...result,
      });
    },
  };
}

describe("validateEngineQuoteScoreReportV1", () => {
  it("accepts a well-formed artifact", () => {
    const result = validateEngineQuoteScoreReportV1(fixture());
    expect(result.ok, JSON.stringify(!result.ok && result.problems)).toBe(true);
    if (result.ok) {
      expect(result.report.bestCandidateId).toBe("cand-bonk");
      expect(result.report.includedCount).toBe(2);
    }
  });

  it("refuses unknown fields at every level — the schemas are CLOSED", () => {
    for (const mutate of [
      (doc: Record<string, unknown>) => (doc.profitEstimate = 12),
      (doc: Record<string, unknown>) => (entryAt(doc, 0).executable = true),
      (doc: Record<string, unknown>) => (((entryAt(doc, 0).facts as Record<string, unknown>).liveReady = true)),
      (doc: Record<string, unknown>) => (((entryAt(doc, 0).components as Record<string, unknown>).bonus = -50)),
    ]) {
      const doc = fixture();
      mutate(doc);
      expect(validateEngineQuoteScoreReportV1(doc).ok).toBe(false);
    }
  });

  it("RECOMPUTES every score from its components and refuses arithmetic drift", () => {
    const doc = fixture();
    entryAt(doc, 0).score = 99; // components say 85
    const result = validateEngineQuoteScoreReportV1(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toContain("recomputable");
  });

  it("RE-EVALUATES freshness with the real evaluator and refuses disagreement", () => {
    const doc = fixture();
    (entryAt(doc, 3).facts as Record<string, unknown>).freshnessVerdict = "fresh"; // engine lying about a stale quote
    const result = validateEngineQuoteScoreReportV1(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toContain("disagrees with evaluateQuoteFreshness");

    // Sanity: the TS evaluator itself says this quote is stale at the cap.
    const real = evaluateQuoteFreshness({ fetchedAt: "2026-06-12T11:00:00.000Z", nowMs: Date.parse(SCORED_AT), maxAgeMs: MAX_AGE_MS });
    expect(real.verdict).toBe("stale");
  });

  it("refuses a tampered ranking, best candidate, or count", () => {
    const rankDoc = fixture();
    rankDoc.ranking = ["cand-usdc", "cand-bonk"]; // wrong order
    expect(validateEngineQuoteScoreReportV1(rankDoc).ok).toBe(false);

    const bestDoc = fixture();
    bestDoc.bestCandidateId = "cand-usdc";
    expect(validateEngineQuoteScoreReportV1(bestDoc).ok).toBe(false);

    const countDoc = fixture();
    countDoc.includedCount = 3;
    expect(validateEngineQuoteScoreReportV1(countDoc).ok).toBe(false);
  });

  it("refuses an included-but-not-fresh entry, a scored excluded entry, and an unexplained exclusion", () => {
    const incDoc = fixture();
    entryAt(incDoc, 3).included = true;
    entryAt(incDoc, 3).score = 50;
    entryAt(incDoc, 3).components = { impactPenalty: 50, hopPenalty: 0, agePenalty: 0 };
    expect(validateEngineQuoteScoreReportV1(incDoc).ok).toBe(false);

    const exDoc = fixture();
    entryAt(exDoc, 2).score = 10;
    expect(validateEngineQuoteScoreReportV1(exDoc).ok).toBe(false);

    const reasonDoc = fixture();
    entryAt(reasonDoc, 2).reasons = [];
    expect(validateEngineQuoteScoreReportV1(reasonDoc).ok).toBe(false);
  });

  it("refuses reasons outside the closed set and a missing safety literal", () => {
    const reasonDoc = fixture();
    entryAt(reasonDoc, 0).reasons = ["definitely-profitable"];
    expect(validateEngineQuoteScoreReportV1(reasonDoc).ok).toBe(false);

    const literalDoc = fixture();
    literalDoc.notProfitabilityClaim = false;
    expect(validateEngineQuoteScoreReportV1(literalDoc).ok).toBe(false);
  });
});

describe("scoreQuotesThroughEngine — IPC bridge", () => {
  const base = { cwd: "/repo", exists: () => false, env: { PATH: "/usr/bin" } };
  const okStdout = JSON.stringify(engineArtifact(), null, 2) + "\n";

  it("passes the report over stdin with closed-vocabulary args and validates the artifact", async () => {
    const capture: { args?: readonly string[]; opts?: EngineProcessOptions } = {};
    const result = await scoreQuotesThroughEngine({
      ...base,
      fetchReportJson: FETCH_REPORT,
      scoredAt: SCORED_AT,
      maxQuoteAgeMs: MAX_AGE_MS,
      runner: fakeRunner({ stdout: okStdout }, capture),
    });
    expect(result.kind, JSON.stringify(result)).toBe("ok");
    if (result.kind === "ok") {
      expect(result.report.bestCandidateId).toBe("cand-bonk");
      expect(result.timing.spawnMs).toBeGreaterThanOrEqual(0);
    }
    expect(capture.args).toEqual([
      "run", "--quiet", "-p", "solmaker-engine", "--",
      "quote-score", "--json", "--scored-at", SCORED_AT, "--max-quote-age-ms", "60000",
    ]);
    expect(capture.opts?.stdinData).toBe(FETCH_REPORT);
    expect(capture.opts?.env).toEqual({ PATH: "/usr/bin" });
  });

  it("refuses a missing/invalid cap and oversized input BEFORE any process could run", async () => {
    const noCap = await scoreQuotesThroughEngine({
      ...base,
      fetchReportJson: FETCH_REPORT,
      scoredAt: SCORED_AT,
      maxQuoteAgeMs: 0,
      runner: fakeRunner({}),
    });
    expect(noCap.kind === "refused" && noCap.reason === "unsafe-args").toBe(true);

    const oversized = await scoreQuotesThroughEngine({
      ...base,
      fetchReportJson: "x".repeat(64),
      scoredAt: SCORED_AT,
      maxQuoteAgeMs: MAX_AGE_MS,
      maxInputBytes: 32,
      runner: fakeRunner({}),
    });
    expect(oversized.kind === "refused" && oversized.reason === "input-too-large").toBe(true);
  });

  it("maps missing engine, timeout, exit 2, bad JSON, and tampering to the closed union", async () => {
    const missing = await scoreQuotesThroughEngine({
      ...base,
      fetchReportJson: FETCH_REPORT,
      scoredAt: SCORED_AT,
      maxQuoteAgeMs: MAX_AGE_MS,
      runner: fakeRunner({ started: false, startError: "ENOENT", exitCode: null }),
    });
    expect(missing.kind).toBe("unavailable");

    const timedOut = await scoreQuotesThroughEngine({
      ...base,
      fetchReportJson: FETCH_REPORT,
      scoredAt: SCORED_AT,
      maxQuoteAgeMs: MAX_AGE_MS,
      runner: fakeRunner({ timedOut: true, exitCode: null }),
    });
    expect(timedOut.kind === "refused" && timedOut.reason === "engine-timeout").toBe(true);

    const refusedByEngine = await scoreQuotesThroughEngine({
      ...base,
      fetchReportJson: FETCH_REPORT,
      scoredAt: SCORED_AT,
      maxQuoteAgeMs: MAX_AGE_MS,
      runner: fakeRunner({ exitCode: 2, stderr: "refused: fetch report entries[0]: mint" }),
    });
    expect(refusedByEngine.kind === "refused" && refusedByEngine.reason === "engine-error").toBe(true);

    const badJson = await scoreQuotesThroughEngine({
      ...base,
      fetchReportJson: FETCH_REPORT,
      scoredAt: SCORED_AT,
      maxQuoteAgeMs: MAX_AGE_MS,
      runner: fakeRunner({ stdout: "not json{" }),
    });
    expect(badJson.kind === "refused" && badJson.reason === "invalid-json").toBe(true);

    const tamperedDoc = engineArtifact();
    tamperedDoc.notExecutable = false;
    const tampered = await scoreQuotesThroughEngine({
      ...base,
      fetchReportJson: FETCH_REPORT,
      scoredAt: SCORED_AT,
      maxQuoteAgeMs: MAX_AGE_MS,
      runner: fakeRunner({ stdout: JSON.stringify(tamperedDoc) }),
    });
    expect(tampered.kind === "refused" && tampered.reason === "schema-mismatch").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// REAL parity proof: spawn the actual Rust engine (when a prebuilt binary
// exists). The strict validator — including the freshness RE-EVALUATION
// against the real TypeScript evaluator and the full score/ranking recompute —
// must accept the real artifact. Skipped honestly without a binary.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BINARY_NAME = process.platform === "win32" ? "solmaker-engine.exe" : "solmaker-engine";
const PREBUILT_EXISTS =
  existsSync(join(REPO_ROOT, "target", "release", BINARY_NAME)) ||
  existsSync(join(REPO_ROOT, "target", "debug", BINARY_NAME));

describe("REAL Rust engine quote scoring ↔ TypeScript parity", () => {
  it.skipIf(!PREBUILT_EXISTS)("the real engine's scores pass the full recompute + freshness parity wall", async () => {
    const result = await scoreQuotesThroughEngine({
      cwd: REPO_ROOT,
      fetchReportJson: FETCH_REPORT,
      scoredAt: SCORED_AT,
      maxQuoteAgeMs: MAX_AGE_MS,
      runner: createEngineProcessRunner(),
    });
    expect(result.kind, JSON.stringify(result)).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.report.bestCandidateId).toBe("cand-bonk");
    expect(result.report.ranking).toEqual(["cand-bonk", "cand-usdc"]);
    expect(result.report.includedCount).toBe(2);
    expect(result.report.excludedCount).toBe(2);
    const stale = result.report.entries.find((e) => e.candidateId === "cand-stale");
    expect(stale?.facts.freshnessVerdict).toBe("stale");
    expect(stale?.reasons).toEqual(["stale"]);
  });

  it.skipIf(!PREBUILT_EXISTS)("the real engine refuses a wrong-schema document with exit 2", async () => {
    const result = await scoreQuotesThroughEngine({
      cwd: REPO_ROOT,
      fetchReportJson: JSON.stringify({ schemaVersion: "not.a.fetch.report.v1" }),
      scoredAt: SCORED_AT,
      maxQuoteAgeMs: MAX_AGE_MS,
      runner: createEngineProcessRunner(),
    });
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.reason).toBe("engine-error");
      expect(result.detail).toContain("schemaVersion");
    }
  });
});
