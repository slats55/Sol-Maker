/**
 * Sprint 102 — `paper:sniper:rehearse --mode mainnet-dry-run` RELEASE CANDIDATE.
 *
 * Pins the new no-send release-candidate deliverable end to end:
 *   - the happy COMPLETE path runs the REAL Rust engine (scoring + quote-score + tx-inspect) over the
 *     bundle the rehearsal itself assembles, and produces a validatable
 *     sniper.mainnet_dryrun.release_candidate.v1 whose verdict is dryrun-complete-blocked-live with
 *     liveSendStatus "disabled";
 *   - a REJECT risk maps to dryrun-blocked-risk even though the candidate is scored (a score can
 *     never override a blocked verdict);
 *   - a refused build maps to dryrun-blocked-build, a failed simulation to dryrun-blocked-simulation,
 *     an unavailable quote to dryrun-blocked-quote;
 *   - with NO Rust engine, candidate scoring is honestly unavailable and the RC is still produced
 *     (dryrun-insufficient-evidence) — the paper pipeline never depends on Rust;
 *   - the send seams are NEVER touched, in any path, and the artifact pins neverSends/neverSigns.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createJupiterQuoteAdapter, type FetchLike } from "@soulmaker/quotefetch";
import { createJupiterSwapBuilder, type FetchLike as BuilderFetchLike } from "@soulmaker/txbuilder";
import type { EngineProcessRunner } from "@soulmaker/engine-bridge";
import { validateMainnetDryRunReleaseCandidate } from "@soulmaker/sniper";
import { paperSniperRehearseReport } from "./commands.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";
const WALLET = Keypair.generate();
const BLOCKHASH = new PublicKey(Buffer.alloc(32, 4)).toBase58();
const FIXED_CLOCK = (): string => "2026-06-12T08:00:00.000Z";

const ENGINE_BINARY = join(process.cwd(), "target", "release", process.platform === "win32" ? "solmaker-engine.exe" : "solmaker-engine");

/** A runner that spawns the REAL prebuilt engine binary (build it with `cargo build --release`). */
function realEngineRunner(): EngineProcessRunner {
  return {
    run: (_command, args, opts) => {
      const res = spawnSync(ENGINE_BINARY, [...args], { input: opts.stdinData ?? "", encoding: "utf8", maxBuffer: opts.maxOutputBytes });
      if (res.error) {
        return Promise.resolve({ started: false, startError: res.error.message, exitCode: null, timedOut: false, stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false });
      }
      return Promise.resolve({ started: true, startError: null, exitCode: res.status ?? 0, timedOut: false, stdout: res.stdout ?? "", stderr: res.stderr ?? "", stdoutTruncated: false, stderrTruncated: false });
    },
  };
}

const engineAvailable = existsSync(ENGINE_BINARY);

async function withTmpAsync<T>(fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), "rehearse-rc-"));
  try {
    return await fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function writeConfig(tmp: string): void {
  writeFileSync(join(tmp, "soulmaker.config.json"), JSON.stringify({ mode: "WATCH_ONLY", rpcUrl: "https://rpc.example.com" }));
}
function writeCandidates(tmp: string): string {
  writeFileSync(join(tmp, "candidates.json"), JSON.stringify({ sourceLabel: "rc-test", candidates: [{ candidateId: "c-1", mint: USDC, symbol: "USDC" }] }));
  return "candidates.json";
}
function writeRisk(tmp: string, decision: string, score: number): string {
  writeFileSync(join(tmp, "risk.json"), JSON.stringify({ mint: USDC, score, decision, flags: [], summary: [], generatedAt: "t", disclaimer: "x" }));
  return "risk.json";
}

function quoteBody(): string {
  return JSON.stringify({
    inputMint: WSOL,
    inAmount: "10000000",
    outAmount: "424242",
    outputMint: USDC,
    otherAmountThreshold: "420000",
    priceImpactPct: "0.42",
    routePlan: [{ swapInfo: { label: "TestVenue" } }],
    contextSlot: 123456,
  });
}
function unsignedSwapTxBase64(): string {
  const message = new TransactionMessage({
    payerKey: WALLET.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [SystemProgram.transfer({ fromPubkey: WALLET.publicKey, toPubkey: WALLET.publicKey, lamports: 1 })],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
}
function happyProviderFetch(): BuilderFetchLike {
  return async (url: string, init?: { method?: string }) => {
    if (init?.method === "POST" || String(url).endsWith("/swap")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ swapTransaction: unsignedSwapTxBase64() }) };
    }
    return { ok: true, status: 200, text: async () => quoteBody() };
  };
}

interface RcCtxOpts {
  quoteStatus?: number;
  simOutcome?: "ok" | "failed";
  withEngine?: boolean;
}
function rcCtx(tmp: string, o: RcCtxOpts = {}) {
  let sendSeamTouched = 0;
  const providerFetch: BuilderFetchLike =
    o.quoteStatus !== undefined ? async () => ({ ok: false, status: o.quoteStatus as number, text: async () => "rate limited" }) : happyProviderFetch();
  const ctx = {
    cwd: tmp,
    env: {} as NodeJS.ProcessEnv,
    now: FIXED_CLOCK,
    createQuoteAdapter: () => createJupiterQuoteAdapter({ fetchLike: providerFetch as unknown as FetchLike, clock: FIXED_CLOCK }),
    createSwapBuilder: () => createJupiterSwapBuilder({ fetchLike: providerFetch, clock: FIXED_CLOCK }),
    createTxPreview: () => ({
      endpointHost: "rpc.example.com",
      rpc: {
        simulateTransaction: async () => ({
          context: { slot: 1, apiVersion: "1.18" },
          value: o.simOutcome === "failed" ? { err: { InstructionError: [0, "Custom"] }, logs: [], unitsConsumed: 0 } : { err: null, logs: ["ok"], unitsConsumed: 100 },
        }),
      },
    }),
    createSendRpc: () => {
      sendSeamTouched += 1;
      throw new Error("never");
    },
    createRehearsalRpc: () => {
      sendSeamTouched += 1;
      throw new Error("never");
    },
    ...(o.withEngine === true ? { engineBinaryExists: () => true, createEngineRunner: () => realEngineRunner() } : {}),
  };
  return { ctx, sendSeamTouched: () => sendSeamTouched };
}

const BUILD_FLAGS = { amountSol: "0.01", slippageBps: "50", maxSpendSol: "0.02", slippageCapBps: "100", riskScoreCap: "30" } as const;

interface RehearseJson {
  stages: Array<{ stage: string; status: string; detail: string }>;
}
function stageMap(report: RehearseJson): Record<string, { status: string; detail: string }> {
  return Object.fromEntries(report.stages.map((s) => [s.stage, s]));
}
function readRc(tmp: string, outDir = "out"): Record<string, unknown> {
  return JSON.parse(readFileSync(join(tmp, outDir, "release-candidate.json"), "utf8")) as Record<string, unknown>;
}

describe("paper:sniper:rehearse RC — happy COMPLETE path (REAL Rust engine)", () => {
  it.skipIf(!engineAvailable)(
    "produces a validatable release candidate: dryrun-complete-blocked-live, live DISABLED, scored, no send",
    async () => {
      await withTmpAsync(async (tmp) => {
        writeConfig(tmp);
        const { ctx, sendSeamTouched } = rcCtx(tmp, { withEngine: true });
        const r = await paperSniperRehearseReport(ctx, {
          mode: "mainnet-dry-run",
          candidatesPath: writeCandidates(tmp),
          outDir: "out",
          wallet: WALLET.publicKey.toBase58(),
          riskPath: writeRisk(tmp, "PASS_FOR_PAPER_EVALUATION", 5),
          maxQuoteAgeMs: "60000",
          ...BUILD_FLAGS,
          json: true,
        });
        expect(r.exitCode, r.text.slice(0, 1000)).toBe(0);
        const stages = stageMap(JSON.parse(r.text) as RehearseJson);
        expect(stages["candidate-score"]?.status).toBe("executed");
        expect(stages["quote-score"]?.status).toBe("executed");
        expect(stages["tx-inspect"]?.status).toBe("executed");
        expect(stages["release-candidate"]?.status).toBe("executed");
        expect(existsSync(join(tmp, "out", "release-candidate.json"))).toBe(true);
        expect(existsSync(join(tmp, "out", "candidate-scores.json"))).toBe(true);

        const rc = readRc(tmp);
        expect(() => validateMainnetDryRunReleaseCandidate(rc)).not.toThrow();
        expect(rc.verdict).toBe("dryrun-complete-blocked-live");
        expect(rc.liveSendStatus).toBe("disabled");
        expect(rc.network).toBe("mainnet-beta");
        expect(rc.phase7LiveTradingReady).toBe(false);
        expect(rc.neverSends).toBe(true);
        expect(rc.neverSigns).toBe(true);
        expect((rc.scoring as { available: boolean }).available).toBe(true);
        expect((rc.scoring as { rankedCandidates: unknown[] }).rankedCandidates.length).toBe(1);
        expect(sendSeamTouched()).toBe(0);
      });
    },
  );
});

describe("paper:sniper:rehearse RC — a candidate score can NEVER override a blocked verdict", () => {
  it.skipIf(!engineAvailable)("a REJECT risk maps to dryrun-blocked-risk even with the candidate scored", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const { ctx, sendSeamTouched } = rcCtx(tmp, { withEngine: true });
      const r = await paperSniperRehearseReport(ctx, {
        mode: "mainnet-dry-run",
        candidatesPath: writeCandidates(tmp),
        outDir: "out",
        wallet: WALLET.publicKey.toBase58(),
        riskPath: writeRisk(tmp, "REJECT", 100),
        maxQuoteAgeMs: "60000",
        ...BUILD_FLAGS,
        json: true,
      });
      expect(r.exitCode).toBe(0);
      const rc = readRc(tmp);
      expect(() => validateMainnetDryRunReleaseCandidate(rc)).not.toThrow();
      expect(rc.verdict).toBe("dryrun-blocked-risk");
      expect(rc.liveSendStatus).toBe("disabled");
      expect((rc.risk as { rejected: boolean }).rejected).toBe(true);
      expect(sendSeamTouched()).toBe(0);
    });
  });
});

describe("paper:sniper:rehearse RC — blocked-verdict mappings (no engine needed)", () => {
  it("a refused build (risk-score over cap) maps to dryrun-blocked-build", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const { ctx } = rcCtx(tmp);
      const r = await paperSniperRehearseReport(ctx, {
        mode: "mainnet-dry-run",
        candidatesPath: writeCandidates(tmp),
        outDir: "out",
        wallet: WALLET.publicKey.toBase58(),
        riskPath: writeRisk(tmp, "PASS_FOR_PAPER_EVALUATION", 25),
        maxQuoteAgeMs: "60000",
        amountSol: "0.01",
        slippageBps: "50",
        maxSpendSol: "0.02",
        slippageCapBps: "100",
        riskScoreCap: "10", // risk score 25 > cap 10 -> build refused (NOT a risk REJECT)
        json: true,
      });
      expect(r.exitCode).toBe(0);
      const rc = readRc(tmp);
      expect(() => validateMainnetDryRunReleaseCandidate(rc)).not.toThrow();
      expect(rc.verdict).toBe("dryrun-blocked-build");
      expect((rc.build as { refused: boolean }).refused).toBe(true);
    });
  });

  it("a failed simulation maps to dryrun-blocked-simulation", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const { ctx } = rcCtx(tmp, { simOutcome: "failed" });
      const r = await paperSniperRehearseReport(ctx, {
        mode: "mainnet-dry-run",
        candidatesPath: writeCandidates(tmp),
        outDir: "out",
        wallet: WALLET.publicKey.toBase58(),
        riskPath: writeRisk(tmp, "PASS_FOR_PAPER_EVALUATION", 5),
        maxQuoteAgeMs: "60000",
        ...BUILD_FLAGS,
        json: true,
      });
      expect(r.exitCode).toBe(0);
      const rc = readRc(tmp);
      expect(() => validateMainnetDryRunReleaseCandidate(rc)).not.toThrow();
      expect(rc.verdict).toBe("dryrun-blocked-simulation");
      expect((rc.simulation as { failed: boolean }).failed).toBe(true);
    });
  });

  it("an unavailable quote (provider 429) maps to dryrun-blocked-quote", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const { ctx } = rcCtx(tmp, { quoteStatus: 429 });
      const r = await paperSniperRehearseReport(ctx, {
        mode: "mainnet-dry-run",
        candidatesPath: writeCandidates(tmp),
        outDir: "out",
        wallet: WALLET.publicKey.toBase58(),
        riskPath: writeRisk(tmp, "PASS_FOR_PAPER_EVALUATION", 5),
        maxQuoteAgeMs: "60000",
        ...BUILD_FLAGS,
        json: true,
      });
      expect(r.exitCode).toBe(0);
      const rc = readRc(tmp);
      expect(() => validateMainnetDryRunReleaseCandidate(rc)).not.toThrow();
      expect(rc.verdict).toBe("dryrun-blocked-quote");
      expect((rc.quote as { attempted: boolean; observed: boolean }).attempted).toBe(true);
      expect((rc.quote as { observed: boolean }).observed).toBe(false);
    });
  });
});

describe("paper:sniper:rehearse RC — Rust unavailable falls back honestly", () => {
  it("with NO engine, candidate scoring is unavailable and the RC is still produced (insufficient-evidence)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      // No engine hooks AND force the binary 'missing' so the runner can never start.
      const { ctx, sendSeamTouched } = rcCtx(tmp);
      const r = await paperSniperRehearseReport(
        { ...ctx, engineBinaryExists: () => false },
        {
          mode: "mainnet-dry-run",
          candidatesPath: writeCandidates(tmp),
          outDir: "out",
          wallet: WALLET.publicKey.toBase58(),
          riskPath: writeRisk(tmp, "PASS_FOR_PAPER_EVALUATION", 5),
          maxQuoteAgeMs: "60000",
          ...BUILD_FLAGS,
          json: true,
        },
      );
      expect(r.exitCode).toBe(0);
      const stages = stageMap(JSON.parse(r.text) as RehearseJson);
      expect(stages["candidate-score"]?.status).toBe("unavailable");
      const rc = readRc(tmp);
      expect(() => validateMainnetDryRunReleaseCandidate(rc)).not.toThrow();
      expect((rc.scoring as { available: boolean }).available).toBe(false);
      expect(rc.verdict).toBe("dryrun-insufficient-evidence");
      expect(rc.liveSendStatus).toBe("disabled");
      // The sniper-score-input bundle is still written (and used to derive risk evidence).
      expect(existsSync(join(tmp, "out", "sniper-score-input.json"))).toBe(true);
      expect(sendSeamTouched()).toBe(0);
    });
  });
});

describe("paper:sniper:rehearse RC — non-mainnet modes produce no release candidate", () => {
  it("paper mode skips the release-candidate stage and writes no artifact", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const { ctx } = rcCtx(tmp);
      const r = await paperSniperRehearseReport(ctx, { candidatesPath: writeCandidates(tmp), outDir: "out", json: true });
      const stages = stageMap(JSON.parse(r.text) as RehearseJson);
      expect(stages["release-candidate"]?.status).toBe("skipped");
      expect(existsSync(join(tmp, "out", "release-candidate.json"))).toBe(false);
    });
  });
});


