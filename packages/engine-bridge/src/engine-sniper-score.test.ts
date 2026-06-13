import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateEngineSniperScoreReportV1 } from "./validate-sniper-score.js";
import { scoreCandidatesThroughEngine } from "./sniper-score.js";
import { createEngineProcessRunner, type EngineProcessRunner, type EngineProcessOptions, type EngineProcessResult } from "./runner.js";

// Public, well-known mints — public chain data, never secrets.
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const CREATED_AT = "2026-06-13T12:00:00.000Z";

const FACT_KEYS = [
  "riskDecision", "riskScore", "riskCriticalFlagCount", "riskHighFlagCount",
  "freezeAuthorityPresent", "mintAuthorityPresent", "token2022Blocker", "holderConcentrationRisk",
  "metadataMutable", "liquidityHint", "quoteObserved", "quoteScore", "quoteFreshness",
  "priceImpactHigh", "simulationOutcome", "simulationClassification", "txBuildRefused",
] as const;

/** Build a full, all-keys-present facts object (absent → null). */
function facts(overrides: Record<string, unknown>): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  for (const key of FACT_KEYS) f[key] = key in overrides ? overrides[key] : null;
  return f;
}

const CLEAN = facts({
  riskDecision: "PASS_FOR_PAPER_EVALUATION", riskScore: 12, riskCriticalFlagCount: 0, riskHighFlagCount: 0,
  freezeAuthorityPresent: false, mintAuthorityPresent: false, token2022Blocker: false, holderConcentrationRisk: false,
  metadataMutable: false, liquidityHint: "adequate", quoteObserved: true, quoteScore: 90, quoteFreshness: "fresh",
  priceImpactHigh: false, simulationOutcome: "simulated-ok", txBuildRefused: false,
});
const REJECTED = facts({
  riskDecision: "REJECT", riskScore: 100, riskCriticalFlagCount: 1, riskHighFlagCount: 0,
  freezeAuthorityPresent: true, mintAuthorityPresent: false, token2022Blocker: false, holderConcentrationRisk: false,
  metadataMutable: false, liquidityHint: "adequate", quoteObserved: true, quoteScore: 100, quoteFreshness: "fresh",
  priceImpactHigh: false, simulationOutcome: "simulated-ok", txBuildRefused: false,
});
const INCOMPLETE = facts({});

const SCORE_INPUT = JSON.stringify({
  schemaVersion: "sniper.score.input.v1",
  banner: "SIMULATED PAPER-ONLY SNIPER SCORE INPUT",
  paperOnly: true, simulated: true, notLiveResult: true, notFinancialAdvice: true, notProfitabilityClaim: true,
  disclaimers: ["test"],
  sourceLabel: "test",
  mode: "mainnet-dry-run",
  network: "mainnet-beta-readonly",
  candidateCount: 3,
  candidates: [
    { candidateId: "clean", mint: WSOL, source: "jupiter-recent-tokens", facts: CLEAN, caveats: [] },
    { candidateId: "rejected", mint: USDC, source: "operator", facts: REJECTED, caveats: ["real freeze authority"] },
    { candidateId: "incomplete", mint: BONK, source: null, facts: INCOMPLETE, caveats: [] },
  ],
});

/** A scored candidate that echoes its facts verbatim (flat fields). */
function candidate(id: string, mint: string, source: string | null, f: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
  return { candidateId: id, mint, source, caveats: [], ...f, ...extra };
}

/** What the Rust engine emits for SCORE_INPUT — mirrored field by field. */
function engineArtifact(): Record<string, unknown> {
  return {
    schemaVersion: "engine.sniper.score.report.v1",
    banner: "RUST ENGINE SNIPER CANDIDATE SCORES — test fixture banner.",
    engineName: "solmaker-engine",
    engineVersion: "0.1.0",
    ipcVersion: "engine.ipc.v1",
    createdAt: CREATED_AT,
    scoringEngine: "solmaker-engine",
    engineSource: "rust",
    mode: "mainnet-dry-run",
    network: "mainnet-beta-readonly",
    candidateCount: 3,
    rankedCandidates: [
      candidate("clean", WSOL, "jupiter-recent-tokens", CLEAN, {
        rank: 1, score: 97, verdict: "watch",
        reasonCodes: ["paper-only", "mainnet-live-disabled"],
        components: { riskSafety: 40, quoteQuality: 22, quoteFreshness: 10, liquidity: 10, tokenMechanics: 10, simulationEvidence: 5 },
        nextSafeAction: "watch-and-paper-dry-run",
      }),
      candidate("incomplete", BONK, null, INCOMPLETE, {
        rank: 2, score: 10, verdict: "insufficient-evidence",
        reasonCodes: ["paper-only", "mainnet-live-disabled", "quote-missing", "simulation-unavailable", "insufficient-evidence"],
        components: { riskSafety: 0, quoteQuality: 0, quoteFreshness: 0, liquidity: 4, tokenMechanics: 4, simulationEvidence: 2 },
        nextSafeAction: "gather-risk-and-quote-evidence",
      }),
      candidate("rejected", USDC, "operator", REJECTED, {
        rank: 3, score: 55, verdict: "reject",
        reasonCodes: ["paper-only", "mainnet-live-disabled", "risk-rejected", "risk-over-threshold"],
        components: { riskSafety: 0, quoteQuality: 25, quoteFreshness: 10, liquidity: 10, tokenMechanics: 5, simulationEvidence: 5 },
        nextSafeAction: "do-not-proceed-risk-gate",
        caveats: ["real freeze authority"],
      }),
    ],
    ranking: ["clean", "incomplete", "rejected"],
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

function fixture(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(engineArtifact())) as Record<string, unknown>;
}

function candAt(doc: Record<string, unknown>, index: number): Record<string, unknown> {
  return (doc.rankedCandidates as Record<string, unknown>[])[index] as Record<string, unknown>;
}

function fakeRunner(result: Partial<EngineProcessResult>, capture?: { args?: readonly string[]; opts?: EngineProcessOptions }): EngineProcessRunner {
  return {
    run(_command, args, opts) {
      if (capture) {
        capture.args = args;
        capture.opts = opts;
      }
      return Promise.resolve({
        started: true, startError: null, exitCode: 0, timedOut: false,
        stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false,
        ...result,
      });
    },
  };
}

describe("validateEngineSniperScoreReportV1", () => {
  it("accepts a well-formed artifact and re-derives every score/verdict", () => {
    const result = validateEngineSniperScoreReportV1(fixture());
    expect(result.ok, JSON.stringify(!result.ok && result.problems)).toBe(true);
    if (result.ok) {
      expect(result.report.bestCandidateId).toBe("clean");
      expect(result.report.rankedCandidates[0]!.verdict).toBe("watch");
      expect(result.report.rankedCandidates[2]!.verdict).toBe("reject");
    }
  });

  it("refuses unknown fields at every level — the schemas are CLOSED", () => {
    for (const mutate of [
      (doc: Record<string, unknown>) => (doc.profitEstimate = 12),
      (doc: Record<string, unknown>) => (candAt(doc, 0).buySignal = true),
      (doc: Record<string, unknown>) => ((candAt(doc, 0).components as Record<string, unknown>).bonus = 5),
    ]) {
      const doc = fixture();
      mutate(doc);
      expect(validateEngineSniperScoreReportV1(doc).ok).toBe(false);
    }
  });

  it("RE-DERIVES each component + score and refuses arithmetic drift", () => {
    const doc = fixture();
    candAt(doc, 0).score = 99; // components sum to 97
    const r1 = validateEngineSniperScoreReportV1(doc);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.problems.join(" ")).toContain("clamped component sum");

    const doc2 = fixture();
    (candAt(doc2, 0).components as Record<string, unknown>).riskSafety = 5; // facts say 40
    expect(validateEngineSniperScoreReportV1(doc2).ok).toBe(false);
  });

  it("HARD INVARIANT: a REJECT risk decision can never be watch", () => {
    const doc = fixture();
    // Force the rejected candidate's verdict to "watch" while keeping facts REJECT.
    const rej = candAt(doc, 2);
    rej.verdict = "watch";
    rej.nextSafeAction = "watch-and-paper-dry-run";
    rej.reasonCodes = ["paper-only", "mainnet-live-disabled"];
    const result = validateEngineSniperScoreReportV1(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toMatch(/rejected risk can never be watch|re-derived from facts/);
  });

  it("HARD INVARIANT: a stale quote and a Token-2022 blocker can never be watch", () => {
    const staleDoc = fixture();
    const c = candAt(staleDoc, 0);
    c.quoteFreshness = "stale"; // facts now say stale → must be caution, not watch
    expect(validateEngineSniperScoreReportV1(staleDoc).ok).toBe(false);

    const t22Doc = fixture();
    const c2 = candAt(t22Doc, 0);
    c2.token2022Blocker = true; // → must be reject
    expect(validateEngineSniperScoreReportV1(t22Doc).ok).toBe(false);
  });

  it("refuses a tampered ranking, best candidate, verdict, or reason set", () => {
    const rankDoc = fixture();
    rankDoc.ranking = ["incomplete", "clean", "rejected"];
    expect(validateEngineSniperScoreReportV1(rankDoc).ok).toBe(false);

    const bestDoc = fixture();
    bestDoc.bestCandidateId = "rejected";
    expect(validateEngineSniperScoreReportV1(bestDoc).ok).toBe(false);

    const reasonDoc = fixture();
    candAt(reasonDoc, 0).reasonCodes = ["paper-only", "mainnet-live-disabled", "definitely-profitable"];
    expect(validateEngineSniperScoreReportV1(reasonDoc).ok).toBe(false);
  });

  it("refuses a missing safety literal", () => {
    for (const field of ["notExecutable", "scoreIsNotLiveReadiness", "highScoreIsNotSafeToTrade", "redactionApplied"] as const) {
      const doc = fixture();
      doc[field] = false;
      expect(validateEngineSniperScoreReportV1(doc).ok, field).toBe(false);
    }
  });

  it("cross-checks echoed facts against the input bundle and refuses a fabricated fact", () => {
    const cross = {
      mode: "mainnet-dry-run",
      network: "mainnet-beta-readonly",
      candidates: [
        { candidateId: "clean", mint: WSOL, facts: CLEAN },
        { candidateId: "incomplete", mint: BONK, facts: INCOMPLETE },
        { candidateId: "rejected", mint: USDC, facts: REJECTED },
      ],
    };
    expect(validateEngineSniperScoreReportV1(fixture(), cross).ok).toBe(true);

    // Engine echoes a risk decision the bundle never carried.
    const lying = fixture();
    candAt(lying, 1).riskDecision = "PASS_FOR_PAPER_EVALUATION";
    const result = validateEngineSniperScoreReportV1(lying, cross);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toMatch(/disagrees with the input bundle/);
  });
});

describe("scoreCandidatesThroughEngine — IPC bridge", () => {
  const base = { cwd: "/repo", exists: () => false, env: { PATH: "/usr/bin" } };
  const okStdout = JSON.stringify(engineArtifact(), null, 2) + "\n";

  it("passes the bundle over stdin with closed-vocabulary args and validates the artifact", async () => {
    const capture: { args?: readonly string[]; opts?: EngineProcessOptions } = {};
    const result = await scoreCandidatesThroughEngine({
      ...base,
      scoreInputJson: SCORE_INPUT,
      createdAt: CREATED_AT,
      runner: fakeRunner({ stdout: okStdout }, capture),
    });
    expect(result.kind, JSON.stringify(result)).toBe("ok");
    if (result.kind === "ok") {
      expect(result.report.bestCandidateId).toBe("clean");
      expect(result.timing.spawnMs).toBeGreaterThanOrEqual(0);
    }
    expect(capture.args).toEqual([
      "run", "--quiet", "-p", "solmaker-engine", "--",
      "sniper-score", "--json", "--created-at", CREATED_AT,
    ]);
    expect(capture.opts?.stdinData).toBe(SCORE_INPUT);
    expect(capture.opts?.env).toEqual({ PATH: "/usr/bin" });
  });

  it("refuses oversized input BEFORE any process could run", async () => {
    const oversized = await scoreCandidatesThroughEngine({
      ...base,
      scoreInputJson: "x".repeat(64),
      createdAt: CREATED_AT,
      maxInputBytes: 32,
      runner: fakeRunner({}),
    });
    expect(oversized.kind === "refused" && oversized.reason === "input-too-large").toBe(true);
  });

  it("maps missing engine, timeout, exit 2, bad JSON, and tampering to the closed union", async () => {
    const missing = await scoreCandidatesThroughEngine({ ...base, scoreInputJson: SCORE_INPUT, createdAt: CREATED_AT, runner: fakeRunner({ started: false, startError: "ENOENT", exitCode: null }) });
    expect(missing.kind).toBe("unavailable");

    const timedOut = await scoreCandidatesThroughEngine({ ...base, scoreInputJson: SCORE_INPUT, createdAt: CREATED_AT, runner: fakeRunner({ timedOut: true, exitCode: null }) });
    expect(timedOut.kind === "refused" && timedOut.reason === "engine-timeout").toBe(true);

    const refusedByEngine = await scoreCandidatesThroughEngine({ ...base, scoreInputJson: SCORE_INPUT, createdAt: CREATED_AT, runner: fakeRunner({ exitCode: 2, stderr: "refused: score input candidates[0]: mint" }) });
    expect(refusedByEngine.kind === "refused" && refusedByEngine.reason === "engine-error").toBe(true);

    const badJson = await scoreCandidatesThroughEngine({ ...base, scoreInputJson: SCORE_INPUT, createdAt: CREATED_AT, runner: fakeRunner({ stdout: "not json{" }) });
    expect(badJson.kind === "refused" && badJson.reason === "invalid-json").toBe(true);

    const tamperedDoc = engineArtifact();
    tamperedDoc.notExecutable = false;
    const tampered = await scoreCandidatesThroughEngine({ ...base, scoreInputJson: SCORE_INPUT, createdAt: CREATED_AT, runner: fakeRunner({ stdout: JSON.stringify(tamperedDoc) }) });
    expect(tampered.kind === "refused" && tampered.reason === "schema-mismatch").toBe(true);
  });

  it("does not forward any secret-shaped environment to the child", async () => {
    const capture: { args?: readonly string[]; opts?: EngineProcessOptions } = {};
    await scoreCandidatesThroughEngine({
      cwd: "/repo",
      exists: () => false,
      env: { PATH: "/usr/bin", SOLANA_PRIVATE_KEY: "deadbeef", WALLET_SEED: "secret" } as NodeJS.ProcessEnv,
      scoreInputJson: SCORE_INPUT,
      createdAt: CREATED_AT,
      runner: fakeRunner({ stdout: okStdout }, capture),
    });
    expect(capture.opts?.env).toEqual({ PATH: "/usr/bin" });
    expect(JSON.stringify(capture.opts?.env)).not.toContain("deadbeef");
    expect(JSON.stringify(capture.opts?.env)).not.toContain("secret");
  });
});

// ---------------------------------------------------------------------------
// REAL parity proof: spawn the actual Rust engine (when a prebuilt binary
// exists). The strict validator — the full component/score/verdict/ranking
// re-derivation AND the input cross-check — must accept the real artifact.
// Skipped honestly without a binary.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BINARY_NAME = process.platform === "win32" ? "solmaker-engine.exe" : "solmaker-engine";
const PREBUILT_EXISTS =
  existsSync(join(REPO_ROOT, "target", "release", BINARY_NAME)) || existsSync(join(REPO_ROOT, "target", "debug", BINARY_NAME));

describe("REAL Rust engine sniper scoring ↔ TypeScript parity", () => {
  it.skipIf(!PREBUILT_EXISTS)("the real engine's scores pass the full re-derivation + input cross-check", async () => {
    const result = await scoreCandidatesThroughEngine({
      cwd: REPO_ROOT,
      scoreInputJson: SCORE_INPUT,
      createdAt: CREATED_AT,
      runner: createEngineProcessRunner(),
    });
    expect(result.kind, JSON.stringify(result)).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.report.bestCandidateId).toBe("clean");
    expect(result.report.ranking).toEqual(["clean", "incomplete", "rejected"]);
    const byId = Object.fromEntries(result.report.rankedCandidates.map((c) => [c.candidateId, c]));
    expect(byId.clean!.verdict).toBe("watch");
    expect(byId.clean!.score).toBe(97);
    expect(byId.rejected!.verdict).toBe("reject");
    expect(byId.rejected!.reasonCodes).toContain("risk-rejected");
    expect(byId.incomplete!.verdict).toBe("insufficient-evidence");
  });

  it.skipIf(!PREBUILT_EXISTS)("the real engine refuses a wrong-schema document with exit 2", async () => {
    const result = await scoreCandidatesThroughEngine({
      cwd: REPO_ROOT,
      scoreInputJson: JSON.stringify({ schemaVersion: "not.a.score.input.v1" }),
      createdAt: CREATED_AT,
      runner: createEngineProcessRunner(),
    });
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.reason).toBe("engine-error");
      expect(result.detail).toContain("schemaVersion");
    }
  });
});
