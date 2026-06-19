/**
 * Live-pipeline latency benchmark (Sprint 107, Part 1).
 *
 * Measures REAL per-stage latency of the live path on THIS machine with `performance.now()` and
 * emits a `perf.live.latency.report.v1`. It measures both the TypeScript decision stages and the
 * Rust engine sidecar's per-call spawn cost (the fixed overhead of using the hot path). When the
 * Rust binary is absent it records the stage as honestly unavailable rather than inventing a number.
 *
 * Usage (from the repo root):
 *   pnpm bench:live                       # human summary + JSON to stdout
 *   pnpm bench:live -- --iterations 500   # more TS iterations
 *   pnpm bench:live -- --out runs/live-latency.json
 *
 * This script performs NO network, wallet, or chain activity. It builds only an unsigned probe
 * transaction and runs pure decision functions; the Rust calls are `engine status` (no input data).
 */

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Relative source imports: scripts/ is not a workspace package, so @soulmaker/* does not resolve
// here. These are the same production modules the apps import.
import {
  buildLiveCanaryRequest,
  buildLivePolicy,
  buildLiveLatencyReport,
  evaluateLivePolicy,
  scoreLiveCandidate,
  type LatencyStageSamples,
} from "../packages/live/src/index.js";
import { buildUnsignedSelfTransferProbe } from "../packages/txpreview/src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = dirname(HERE);

function flag(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const ITER = Number(flag("--iterations", "300"));
const RUST_ITER = Number(flag("--rust-iterations", "25"));
const OUT = flag("--out");

const FIXTURE_PUBKEY = "So11111111111111111111111111111111111111112";
const CANDIDATE = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NOW_ISO = new Date().toISOString();
const NOW_MS = Date.now();

function timeIt(fn: () => void, iterations: number): number[] {
  // Warm up so JIT/allocation costs don't skew the first samples.
  for (let i = 0; i < Math.min(20, iterations); i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return samples;
}

// --- TypeScript decision stages ---

const livePolicy = buildLivePolicy({ mode: "live_canary", liveEnabled: true, walletProvider: "phantom" });
const envelope = buildUnsignedSelfTransferProbe({ feePayerPublicKey: FIXTURE_PUBKEY, network: "mainnet-beta" });

const candidateSamples = timeIt(() => {
  scoreLiveCandidate({
    signals: {
      mint: CANDIDATE,
      risk: { score: 10, decision: "PASS_FOR_PAPER_EVALUATION", criticalFlagCount: 0, freezeAuthorityPresent: false, mintAuthorityPresent: false },
      liquidityUsd: 50_000,
      volumeUsd: 25_000,
      poolAgeSeconds: 3600,
      priceImpactPct: 0.3,
      quoteAgeMs: 1200,
      holderTop1Pct: 12,
      routeConfidence: 0.9,
      denylisted: false,
      allowlisted: false,
    },
    timestamp: NOW_ISO,
  });
}, ITER);

const policySamples = timeIt(() => {
  evaluateLivePolicy(buildLivePolicy({ mode: "live_canary", liveEnabled: true, walletProvider: "phantom" }));
}, ITER);

const canarySamples = timeIt(() => {
  buildLiveCanaryRequest({
    policy: livePolicy,
    createdAt: NOW_ISO,
    nowMs: NOW_MS,
    candidate: { mint: CANDIDATE, symbol: "USDC" },
    quote: {
      provider: "jupiter-lite-api",
      inputMint: FIXTURE_PUBKEY,
      outputMint: CANDIDATE,
      inAmountRaw: "1000000",
      outAmountRaw: "999000",
      slippageBps: 50,
      priceImpactPct: 0.2,
      quotedAt: NOW_ISO,
      ageMs: 1000,
      routeLabels: ["jupiter"],
    },
    risk: { score: 10, decision: "PASS_FOR_PAPER_EVALUATION", criticalFlagCount: 0, flagIds: [] },
    preflight: { simulationOutcome: "simulated-ok", simulationClassification: "none" },
    spendLamports: "1000000",
    envelope,
    auditLogPathProvided: true,
  });
}, ITER);

// --- Rust engine sidecar per-call spawn cost (engine status; no input data) ---

function findEngineBinary(): string | null {
  const candidates = [
    join(REPO_ROOT, "target", "release", "solmaker-engine.exe"),
    join(REPO_ROOT, "target", "release", "solmaker-engine"),
    join(REPO_ROOT, "target", "debug", "solmaker-engine.exe"),
    join(REPO_ROOT, "target", "debug", "solmaker-engine"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

const enginePath = findEngineBinary();
const rustSamples: number[] = [];
let rustNote: string | undefined;
if (enginePath) {
  // Warm up once (first spawn pays OS file-cache cost).
  spawnSync(enginePath, ["status", "--json", "--created-at", NOW_ISO], { encoding: "utf8" });
  for (let i = 0; i < RUST_ITER; i++) {
    const t0 = performance.now();
    const res = spawnSync(enginePath, ["status", "--json", "--created-at", NOW_ISO], { encoding: "utf8" });
    const dt = performance.now() - t0;
    if (res.status === 0) rustSamples.push(dt);
  }
  if (rustSamples.length === 0) rustNote = "engine spawned but returned non-zero";
} else {
  rustNote = "engine binary not found (run `pnpm rust:build`) — Rust hot path reported as unavailable";
}

const stages: LatencyStageSamples[] = [
  { stage: "candidate-score", engine: "typescript", samplesMs: candidateSamples },
  { stage: "policy-build-eval", engine: "typescript", samplesMs: policySamples },
  { stage: "canary-request-build", engine: "typescript", samplesMs: canarySamples },
  { stage: "rust-engine-status-spawn", engine: "rust", samplesMs: rustSamples, note: rustNote },
];

const report = buildLiveLatencyReport({ generatedAt: NOW_ISO, iterations: ITER, stages });

// Human summary.
const lines: string[] = [];
lines.push("LIVE PIPELINE LATENCY (measured on this machine; not a throughput or profit claim)");
lines.push("=================================================================================");
lines.push(`iterations: ${ITER} (TS) / ${RUST_ITER} (Rust spawns)`);
for (const s of report.stages) {
  if (s.availability === "unavailable") {
    lines.push(`${s.stage.padEnd(26)} [${s.engine}]  UNAVAILABLE${s.note ? ` — ${s.note}` : ""}`);
  } else {
    lines.push(`${s.stage.padEnd(26)} [${s.engine}]  min ${s.minMs}ms · median ${s.medianMs}ms · p95 ${s.p95Ms}ms · max ${s.maxMs}ms`);
  }
}
console.log(lines.join("\n"));
console.log("");
console.log(JSON.stringify(report, null, 2));

if (OUT) {
  const outPath = join(REPO_ROOT, OUT);
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`\nwrote ${outPath}`);
}
