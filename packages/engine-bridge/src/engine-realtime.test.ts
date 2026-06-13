import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createReplayCandidateAdapter, CANDIDATE_OBSERVATION_CAVEATS, REPLAY_CAVEAT } from "@soulmaker/realtime";
import { validateEngineRealtimeObservationsReportV1 } from "./validate-realtime.js";
import { normalizeReplayThroughEngine } from "./realtime.js";
import { createEngineProcessRunner, type EngineProcessRunner, type EngineProcessOptions, type EngineProcessResult } from "./runner.js";

// Public, well-known mints — public chain data, never secrets.
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const REPLAY_DOC = JSON.stringify({
  events: [
    { mint: WSOL, symbol: "  SOL  ", name: "Wrapped SOL", observedAtLabel: "t0", launchpadLabel: "pump.fun", liquidityUsdHint: 1250.5, marketCapUsdHint: 100, holderCountHint: 42 },
    { mint: WSOL, symbol: "DUPE" },
    { mint: USDC, symbol: "USDC", name: "a1".repeat(32) }, // 64-hex name must be dropped by BOTH normalizers
  ],
});

/** What the Rust engine emits for REPLAY_DOC — mirrored field by field. */
function engineArtifact(createdAt: string | null): Record<string, unknown> {
  const caveats = [...CANDIDATE_OBSERVATION_CAVEATS, REPLAY_CAVEAT];
  return {
    schemaVersion: "engine.realtime.observations.report.v1",
    banner: "RUST ENGINE REALTIME REPLAY — test fixture banner.",
    engineName: "solmaker-engine",
    engineVersion: "0.1.0",
    ipcVersion: "engine.ipc.v1",
    providerId: "replay-file",
    sourceKind: "replay",
    endpointHost: "local-replay-file",
    fetchedAt: "replay",
    status: "observed",
    statusDetail: null,
    eventCount: 3,
    observationCount: 2,
    duplicateMintCount: 1,
    observations: [
      {
        candidateId: "rt-so111111",
        mint: WSOL,
        symbol: "SOL",
        name: "Wrapped SOL",
        sourceProviderId: "replay-file",
        sourceKind: "replay",
        observedAtLabel: "t0",
        launchpadLabel: "pump.fun",
        liquidityUsdHint: 1250.5,
        marketCapUsdHint: 100,
        holderCountHint: 42,
        caveats,
      },
      {
        candidateId: "rt-epjfwdd5",
        mint: USDC,
        symbol: "USDC",
        name: null,
        sourceProviderId: "replay-file",
        sourceKind: "replay",
        observedAtLabel: "replay-event",
        launchpadLabel: null,
        liquidityUsdHint: null,
        marketCapUsdHint: null,
        holderCountHint: null,
        caveats,
      },
    ],
    createdAt,
    caveats: ["Replay normalization only — test fixture caveat."],
    neverSends: true,
    phase7LiveTradingReady: false,
  };
}

function fixture(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(engineArtifact("2026-06-12T00:00:00.000Z"))) as Record<string, unknown>;
}

function fakeRunner(
  result: Partial<EngineProcessResult>,
  capture?: { command?: string; args?: readonly string[]; opts?: EngineProcessOptions },
): EngineProcessRunner {
  return {
    run(command, args, opts) {
      if (capture) {
        capture.command = command;
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

describe("validateEngineRealtimeObservationsReportV1", () => {
  it("accepts a well-formed artifact", () => {
    const result = validateEngineRealtimeObservationsReportV1(fixture());
    expect(result.ok, JSON.stringify(!result.ok && result.problems)).toBe(true);
    if (result.ok) {
      expect(result.report.observations).toHaveLength(2);
      expect(result.report.observations[0]?.mint).toBe(WSOL);
    }
  });

  it("refuses unknown fields on the report AND on an observation — both schemas are CLOSED", () => {
    const doc1 = fixture();
    doc1.newField = 1;
    expect(validateEngineRealtimeObservationsReportV1(doc1).ok).toBe(false);
    const doc2 = fixture();
    ((doc2.observations as Record<string, unknown>[])[0] as Record<string, unknown>).executable = true;
    expect(validateEngineRealtimeObservationsReportV1(doc2).ok).toBe(false);
  });

  it("refuses every missing report field", () => {
    for (const key of Object.keys(fixture())) {
      const doc = fixture();
      delete doc[key];
      expect(validateEngineRealtimeObservationsReportV1(doc).ok, `missing ${key} must refuse`).toBe(false);
    }
  });

  it("re-parses every mint and refuses a tampered candidateId", () => {
    const doc = fixture();
    const obs = (doc.observations as Record<string, unknown>[])[0] as Record<string, unknown>;
    obs.mint = "not-a-mint";
    expect(validateEngineRealtimeObservationsReportV1(doc).ok).toBe(false);

    const doc2 = fixture();
    const obs2 = (doc2.observations as Record<string, unknown>[])[0] as Record<string, unknown>;
    obs2.candidateId = "rt-mismatch";
    const result = validateEngineRealtimeObservationsReportV1(doc2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toContain("candidateId");
  });

  it("refuses a secret-shaped label the engine should have dropped — refused, never repaired", () => {
    const doc = fixture();
    const obs = (doc.observations as Record<string, unknown>[])[0] as Record<string, unknown>;
    obs.name = "a1".repeat(32); // 64 hex chars
    const result = validateEngineRealtimeObservationsReportV1(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toContain("secret-shaped");
  });

  it("refuses duplicate mints, count mismatches, and out-of-range hints", () => {
    const dupDoc = fixture();
    const observations = dupDoc.observations as Record<string, unknown>[];
    observations[1] = { ...(observations[0] as Record<string, unknown>) };
    expect(validateEngineRealtimeObservationsReportV1(dupDoc).ok).toBe(false);

    const countDoc = fixture();
    countDoc.observationCount = 7;
    expect(validateEngineRealtimeObservationsReportV1(countDoc).ok).toBe(false);

    const tallyDoc = fixture();
    tallyDoc.duplicateMintCount = 5;
    expect(validateEngineRealtimeObservationsReportV1(tallyDoc).ok).toBe(false);

    const hintDoc = fixture();
    ((hintDoc.observations as Record<string, unknown>[])[0] as Record<string, unknown>).liquidityUsdHint = -3;
    expect(validateEngineRealtimeObservationsReportV1(hintDoc).ok).toBe(false);
  });

  it("refuses tampered caveats, sourceKind, and status literals", () => {
    const caveatDoc = fixture();
    ((caveatDoc.observations as Record<string, unknown>[])[0] as Record<string, unknown>).caveats = ["all clear"];
    expect(validateEngineRealtimeObservationsReportV1(caveatDoc).ok).toBe(false);

    const kindDoc = fixture();
    ((kindDoc.observations as Record<string, unknown>[])[0] as Record<string, unknown>).sourceKind = "live";
    expect(validateEngineRealtimeObservationsReportV1(kindDoc).ok).toBe(false);

    const statusDoc = fixture();
    statusDoc.status = "error";
    expect(validateEngineRealtimeObservationsReportV1(statusDoc).ok).toBe(false);
  });
});

describe("normalizeReplayThroughEngine — IPC bridge", () => {
  const base = { cwd: "/repo", exists: () => false, env: { PATH: "/usr/bin" } };
  const okStdout = JSON.stringify(engineArtifact("2026-06-12T00:00:00.000Z"), null, 2) + "\n";

  it("passes the document over stdin (never an argument) and returns the validated artifact", async () => {
    const capture: { command?: string; args?: readonly string[]; opts?: EngineProcessOptions } = {};
    const result = await normalizeReplayThroughEngine({
      ...base,
      replayEventsJson: REPLAY_DOC,
      createdAt: "2026-06-12T00:00:00.000Z",
      runner: fakeRunner({ stdout: okStdout }, capture),
    });
    expect(result.kind, JSON.stringify(result)).toBe("ok");
    if (result.kind === "ok") {
      expect(result.report.observationCount).toBe(2);
      expect(result.timing.spawnMs).toBeGreaterThanOrEqual(0);
    }
    expect(capture.args).toEqual([
      "run", "--quiet", "-p", "solmaker-engine", "--",
      "realtime-normalize", "--json", "--created-at", "2026-06-12T00:00:00.000Z",
    ]);
    expect(capture.opts?.stdinData).toBe(REPLAY_DOC);
    expect(capture.opts?.env).toEqual({ PATH: "/usr/bin" });
  });

  it("refuses oversized input BEFORE any process could run", async () => {
    const result = await normalizeReplayThroughEngine({
      ...base,
      replayEventsJson: "x".repeat(64),
      maxInputBytes: 32,
      runner: fakeRunner({}),
    });
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") expect(result.reason).toBe("input-too-large");
  });

  it("maps missing engine, timeout, oversized output, exit 2, and bad JSON to the closed union", async () => {
    const missing = await normalizeReplayThroughEngine({
      ...base,
      replayEventsJson: REPLAY_DOC,
      runner: fakeRunner({ started: false, startError: "ENOENT", exitCode: null }),
    });
    expect(missing.kind).toBe("unavailable");

    const timedOut = await normalizeReplayThroughEngine({
      ...base,
      replayEventsJson: REPLAY_DOC,
      runner: fakeRunner({ timedOut: true, exitCode: null }),
    });
    expect(timedOut.kind === "refused" && timedOut.reason === "engine-timeout").toBe(true);

    const oversized = await normalizeReplayThroughEngine({
      ...base,
      replayEventsJson: REPLAY_DOC,
      runner: fakeRunner({ stdoutTruncated: true }),
    });
    expect(oversized.kind === "refused" && oversized.reason === "output-too-large").toBe(true);

    const refusedByEngine = await normalizeReplayThroughEngine({
      ...base,
      replayEventsJson: REPLAY_DOC,
      runner: fakeRunner({ exitCode: 2, stderr: "refused: replay events[0].mint: mint address is empty" }),
    });
    expect(refusedByEngine.kind === "refused" && refusedByEngine.reason === "engine-error").toBe(true);

    const badJson = await normalizeReplayThroughEngine({
      ...base,
      replayEventsJson: REPLAY_DOC,
      runner: fakeRunner({ stdout: "not json{" }),
    });
    expect(badJson.kind === "refused" && badJson.reason === "invalid-json").toBe(true);
  });

  it("refuses a schema mismatch (engine claiming a live sourceKind)", async () => {
    const doc = fixture();
    doc.sourceKind = "live";
    const result = await normalizeReplayThroughEngine({
      ...base,
      replayEventsJson: REPLAY_DOC,
      runner: fakeRunner({ stdout: JSON.stringify(doc) }),
    });
    expect(result.kind === "refused" && result.reason === "schema-mismatch").toBe(true);
  });

  it("refuses a malformed createdAt before any process could run", async () => {
    const result = await normalizeReplayThroughEngine({
      ...base,
      replayEventsJson: REPLAY_DOC,
      createdAt: "yesterday lunchtime",
      runner: fakeRunner({}),
    });
    expect(result.kind === "refused" && result.reason === "unsafe-args").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// REAL parity proof: spawn the actual Rust engine (when a prebuilt binary
// exists) and require its observations to deep-equal what the TypeScript
// replay adapter produces for the SAME document. Skipped honestly on machines
// without the binary — never faked.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BINARY_NAME = process.platform === "win32" ? "solmaker-engine.exe" : "solmaker-engine";
const PREBUILT_EXISTS =
  existsSync(join(REPO_ROOT, "target", "release", BINARY_NAME)) ||
  existsSync(join(REPO_ROOT, "target", "debug", BINARY_NAME));

describe("REAL Rust engine ↔ TypeScript replay parity", () => {
  it.skipIf(!PREBUILT_EXISTS)("the real engine's observations deep-equal the TypeScript replay adapter's", async () => {
    const result = await normalizeReplayThroughEngine({
      cwd: REPO_ROOT,
      replayEventsJson: REPLAY_DOC,
      createdAt: "2026-06-12T00:00:00.000Z",
      runner: createEngineProcessRunner(),
    });
    expect(result.kind, JSON.stringify(result)).toBe("ok");
    if (result.kind !== "ok") return;

    const adapter = createReplayCandidateAdapter(JSON.parse(REPLAY_DOC));
    const tsResult = await adapter.fetchOnce();
    expect(result.report.observations).toEqual(tsResult.observations);
    expect(result.report.observationCount).toBe(tsResult.observations.length);
    expect(result.report.providerId).toBe(tsResult.metadata.providerId);
    expect(result.report.endpointHost).toBe(tsResult.metadata.endpointHost);
    expect(result.report.fetchedAt).toBe(tsResult.metadata.fetchedAt);
  });

  it.skipIf(!PREBUILT_EXISTS)("the real engine refuses a malformed document with exit 2", async () => {
    const result = await normalizeReplayThroughEngine({
      cwd: REPO_ROOT,
      replayEventsJson: JSON.stringify({ events: [{ mint: "tooshort" }] }),
      runner: createEngineProcessRunner(),
    });
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.reason).toBe("engine-error");
      expect(result.detail).toContain("events[0].mint");
    }
  });
});
