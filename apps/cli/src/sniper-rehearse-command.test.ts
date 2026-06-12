/**
 * Sprint 93 — `paper:sniper:rehearse` (the unified sniper rehearsal workflow).
 *
 * Pins:
 *   - the mode set is CLOSED (paper | devnet | mainnet-dry-run); mainnet-live is refused
 *     outright and --devnet-send outside devnet mode is refused;
 *   - default PAPER path: fully offline, network stages skipped WITH their exact next commands,
 *     the dry-run chain runs for real and ends honestly blocked (the S88 semantic), readiness
 *     always writes;
 *   - realtime replay path: candidates come from a replay snapshot, labeled replay;
 *   - mainnet-dry-run: live quote fetch (injected adapter) + prepare + build + simulate; a
 *     quote-unavailable provider stays honest; a REJECT risk file blocks the build; a stale
 *     quote (real builder, ticking clock, explicit cap) blocks the build; a failed simulation
 *     blocks; and NOTHING in this mode can send (the send seams are never touched);
 *   - devnet path: the broadcast rehearsal runs ONLY behind --devnet-send + the double opt-in.
 */

import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createJupiterQuoteAdapter, type FetchLike } from "@soulmaker/quotefetch";
import { createJupiterSwapBuilder, type FetchLike as BuilderFetchLike } from "@soulmaker/txbuilder";
import type { RehearsalRpc, SendRpcLike } from "@soulmaker/execution";
import type { ReadOnlySolanaClient } from "@soulmaker/solana";
import { paperSniperRehearseReport } from "./commands.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";
const WALLET = Keypair.generate();
const BLOCKHASH = new PublicKey(Buffer.alloc(32, 4)).toBase58();
const FIXED_CLOCK = (): string => "2026-06-12T08:00:00.000Z";

async function withTmpAsync<T>(fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), "rehearse-cmd-"));
  try {
    return await fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function writeConfig(tmp: string, extra: Record<string, unknown> = {}): void {
  writeFileSync(join(tmp, "soulmaker.config.json"), JSON.stringify({ mode: "WATCH_ONLY", rpcUrl: "https://rpc.example.com", ...extra }));
}

function writeCandidates(tmp: string): string {
  writeFileSync(
    join(tmp, "candidates.json"),
    JSON.stringify({ sourceLabel: "rehearse-test", candidates: [{ candidateId: "c-1", mint: USDC, symbol: "USDC" }] }),
  );
  return "candidates.json";
}

function writeRisk(tmp: string, decision: string, score: number): string {
  writeFileSync(join(tmp, "risk.json"), JSON.stringify({ mint: USDC, score, decision, flags: [], summary: [], generatedAt: "t", disclaimer: "x" }));
  return "risk.json";
}

/** Fake read-only chain client for the S94 auto-risk path (deep token:risk per candidate). */
function fakeRiskChainClient(opts: { freeze?: boolean; token2022Hook?: boolean; throwOnRead?: boolean } = {}): ReadOnlySolanaClient {
  return {
    endpointHost: "rpc.example.com",
    getRpcHealth: async () => ({ ok: true, endpointHost: "rpc.example.com" }),
    getVersion: async () => ({ solanaCore: "test" }),
    getSolBalance: async () => ({ ownerBase58: USDC, lamports: 0, sol: 0 }),
    getTokenAccounts: async () => [],
    getTokenMintInfo: async (mint) => {
      if (opts.throwOnRead === true) throw new Error("rpc unreachable");
      return {
        mint: typeof mint === "string" ? mint : mint.toBase58(),
        decimals: 6,
        supplyRaw: "1000000000",
        uiSupply: 1000,
        mintAuthorityPresent: false,
        freezeAuthorityPresent: opts.freeze === true,
        isInitialized: true,
        programLabel: opts.token2022Hook === true ? "spl-token-2022" : "spl-token",
        source: "test",
        ...(opts.token2022Hook === true
          ? { token2022Extensions: { status: "parsed", extensionNames: ["transferHook"], transferHookPresent: true } }
          : {}),
      } as Awaited<ReturnType<ReadOnlySolanaClient["getTokenMintInfo"]>>;
    },
  };
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

/** A provider that serves quote GETs and swap POSTs for the REAL builder + REAL quote adapter. */
function happyProviderFetch(): BuilderFetchLike {
  return async (url: string, init?: { method?: string }) => {
    if (init?.method === "POST" || String(url).endsWith("/swap")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ swapTransaction: unsignedSwapTxBase64() }) };
    }
    return { ok: true, status: 200, text: async () => quoteBody() };
  };
}

interface RehearseJson {
  mode: string;
  outcome: string;
  stages: Array<{ stage: string; status: string; detail: string; nextCommand: string | null }>;
  neverSendsOnMainnet: boolean;
  phase7LiveTradingReady: boolean;
}

function stageMap(report: RehearseJson): Record<string, { status: string; detail: string; nextCommand: string | null }> {
  return Object.fromEntries(report.stages.map((s) => [s.stage, s]));
}

describe("paper:sniper:rehearse — closed mode set + refusals", () => {
  it("REFUSES mainnet-live outright — there is no live rehearsal mode", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await paperSniperRehearseReport({ cwd: tmp, env: {} }, { mode: "mainnet-live", candidatesPath: writeCandidates(tmp), outDir: "out" });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("NO mainnet-live rehearsal mode");
    });
  });

  it("REFUSES --devnet-send outside devnet mode (no other mode can send)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await paperSniperRehearseReport(
        { cwd: tmp, env: {} },
        { mode: "mainnet-dry-run", devnetSend: true, candidatesPath: writeCandidates(tmp), outDir: "out" },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("only meaningful with --mode devnet");
    });
  });

  it("requires --out and exactly one of --candidates / --replay-file", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      expect((await paperSniperRehearseReport({ cwd: tmp, env: {} }, { candidatesPath: "x" })).text).toContain("--out");
      expect((await paperSniperRehearseReport({ cwd: tmp, env: {} }, { outDir: "out" })).text).toContain("exactly one of");
      expect((await paperSniperRehearseReport({ cwd: tmp, env: {} }, { outDir: "out", candidatesPath: "x", replayFile: "y" })).text).toContain("exactly one of");
    });
  });
});

describe("paper:sniper:rehearse — default PAPER path (fully offline)", () => {
  it("runs candidates + dry-run + readiness; every network stage is skipped WITH its next command; nothing can send", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp, { mode: "PAPER" }); // paper mode: proves no network gate is even consulted
      const candidates = writeCandidates(tmp);
      let sendSeamTouched = 0;
      const r = await paperSniperRehearseReport(
        {
          cwd: tmp,
          env: {},
          now: FIXED_CLOCK,
          createSendRpc: () => {
            sendSeamTouched += 1;
            throw new Error("never");
          },
          createRehearsalRpc: () => {
            sendSeamTouched += 1;
            throw new Error("never");
          },
        },
        { candidatesPath: candidates, outDir: "out", json: true },
      );
      expect(r.exitCode, r.text.slice(0, 600)).toBe(0);
      const report = JSON.parse(r.text) as RehearseJson;
      expect(report.mode).toBe("paper");
      const stages = stageMap(report);
      expect(stages.candidates?.status).toBe("executed");
      expect(stages.risk?.status).toBe("skipped");
      expect(stages.risk?.nextCommand).toContain("token:risk");
      expect(stages["quote-fetch"]?.status).toBe("skipped");
      expect(stages["quote-fetch"]?.nextCommand).toContain("paper:routequote:fetch");
      expect(stages["tx-build"]?.status).toBe("skipped");
      expect(stages["devnet-rehearse"]?.status).toBe("skipped");
      // The dry-run REALLY ran and ends honestly blocked (DRAFT specs + paper-enter review — the S88 semantic).
      expect(stages["dry-run"]?.status).toBe("blocked");
      expect(existsSync(join(tmp, "out", "dry-run", "operator-bundle.json"))).toBe(true);
      expect(existsSync(join(tmp, "out", "dry-run", "RUN_SUMMARY.md"))).toBe(true);
      // Readiness always writes.
      expect(stages.readiness?.status).toBe("executed");
      expect(existsSync(join(tmp, "out", "readiness.json"))).toBe(true);
      // The honest overall outcome is blocked — and that exits 0 without --fail-on-blocked.
      expect(report.outcome).toBe("blocked");
      expect(report.neverSendsOnMainnet).toBe(true);
      expect(report.phase7LiveTradingReady).toBe(false);
      expect(sendSeamTouched).toBe(0);
      expect(existsSync(join(tmp, "out", "rehearsal-report.json"))).toBe(true);
    });
  });

  it("--fail-on-blocked gates the honest blocked outcome", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await paperSniperRehearseReport(
        { cwd: tmp, env: {}, now: FIXED_CLOCK },
        { candidatesPath: writeCandidates(tmp), outDir: "out", failOnBlocked: true },
      );
      expect(r.exitCode).toBe(1);
    });
  });
});

describe("paper:sniper:rehearse — realtime replay path", () => {
  it("candidates come from a replay snapshot and feed the chain end-to-end", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      writeFileSync(join(tmp, "replay.json"), JSON.stringify({ events: [{ mint: USDC, symbol: "USDC" }] }));
      const r = await paperSniperRehearseReport(
        { cwd: tmp, env: {}, now: FIXED_CLOCK },
        { replayFile: "replay.json", outDir: "out", json: true },
      );
      expect(r.exitCode, r.text.slice(0, 600)).toBe(0);
      const report = JSON.parse(r.text) as RehearseJson;
      const stages = stageMap(report);
      expect(stages.candidates?.status).toBe("executed");
      expect(stages.candidates?.detail).toContain("REPLAY");
      expect(existsSync(join(tmp, "out", "realtime", "snapshot.json"))).toBe(true);
      expect(existsSync(join(tmp, "out", "realtime", "candidates.json"))).toBe(true);
      expect(stages["dry-run"]?.status).toBe("blocked"); // the honest S88 end state
    });
  });
});

describe("paper:sniper:rehearse — mainnet-dry-run (build + simulate; can NEVER send)", () => {
  function dryRunCtx(tmp: string, opts: { quoteStatus?: number; simOutcome?: "ok" | "failed"; slowBuildClock?: boolean } = {}) {
    let sendSeamTouched = 0;
    const ticks = ["2026-06-12T08:00:00.000Z", "2026-06-12T08:00:05.000Z"];
    const buildClock = opts.slowBuildClock === true ? (): string => (ticks.length > 1 ? (ticks.shift() as string) : (ticks[0] as string)) : FIXED_CLOCK;
    const providerFetch: BuilderFetchLike =
      opts.quoteStatus !== undefined
        ? async () => ({ ok: false, status: opts.quoteStatus as number, text: async () => "rate limited" })
        : happyProviderFetch();
    return {
      ctx: {
        cwd: tmp,
        env: {},
        now: FIXED_CLOCK,
        // S94: auto-risk needs a chain client when no --risk/--preflight-input is supplied.
        createClient: () => fakeRiskChainClient(),
        createQuoteAdapter: () => createJupiterQuoteAdapter({ fetchLike: providerFetch as unknown as FetchLike, clock: FIXED_CLOCK }),
        createSwapBuilder: () => createJupiterSwapBuilder({ fetchLike: providerFetch, clock: buildClock }),
        createTxPreview: () => ({
          endpointHost: "rpc.example.com",
          rpc: {
            simulateTransaction: async () => ({
              context: { slot: 1, apiVersion: "1.18" },
              value:
                opts.simOutcome === "failed"
                  ? { err: { InstructionError: [0, "Custom"] }, logs: [], unitsConsumed: 0 }
                  : { err: null, logs: ["ok"], unitsConsumed: 100 },
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
      },
      sendSeamTouched: () => sendSeamTouched,
    };
  }

  const BUILD_FLAGS = {
    amountSol: "0.01",
    slippageBps: "50",
    maxSpendSol: "0.02",
    slippageCapBps: "100",
    riskScoreCap: "30",
  } as const;

  it("happy path: fetch -> prepare -> dry-run -> build -> simulate all execute; the send seams are NEVER touched", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const candidates = writeCandidates(tmp);
      const risk = writeRisk(tmp, "PASS_FOR_PAPER_EVALUATION", 5);
      const { ctx, sendSeamTouched } = dryRunCtx(tmp);
      const r = await paperSniperRehearseReport(ctx, {
        mode: "mainnet-dry-run",
        candidatesPath: candidates,
        outDir: "out",
        wallet: WALLET.publicKey.toBase58(),
        riskPath: risk,
        ...BUILD_FLAGS,
        json: true,
      });
      expect(r.exitCode, r.text.slice(0, 800)).toBe(0);
      const report = JSON.parse(r.text) as RehearseJson;
      const stages = stageMap(report);
      expect(stages["quote-fetch"]?.status).toBe("executed");
      expect(stages["quote-prepare"]?.status).toBe("executed");
      expect(stages["tx-build"]?.status).toBe("executed");
      expect(stages["tx-simulate"]?.status).toBe("executed");
      expect(stages["devnet-rehearse"]?.status).toBe("skipped");
      expect(stages["devnet-rehearse"]?.detail).toContain("can never send");
      expect(existsSync(join(tmp, "out", "envelope.json"))).toBe(true);
      expect(existsSync(join(tmp, "out", "tx-simulation.json"))).toBe(true);
      expect(existsSync(join(tmp, "out", "routequote-prepared.json"))).toBe(true);
      expect(sendSeamTouched()).toBe(0);
    });
  });

  it("quote unavailable (provider 429): honest non-executed quote stages, the chain continues, readiness stays unfresh", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const { ctx } = dryRunCtx(tmp, { quoteStatus: 429 });
      const r = await paperSniperRehearseReport(ctx, {
        mode: "mainnet-dry-run",
        candidatesPath: writeCandidates(tmp),
        outDir: "out",
        json: true,
      });
      expect(r.exitCode, r.text.slice(0, 800)).toBe(0);
      const report = JSON.parse(r.text) as RehearseJson;
      const stages = stageMap(report);
      // The fetch stage ran but nothing was observed; whatever observation files exist carry
      // honest non-observed statuses. The dry-run still completes (blocked, honest).
      expect(["executed", "unavailable"]).toContain(stages["quote-fetch"]?.status);
      expect(stages["dry-run"]?.status).toBe("blocked");
      const readiness = JSON.parse(readFileSync(join(tmp, "out", "readiness.json"), "utf8")) as {
        conditions: Array<{ gate: string; satisfied: boolean }>;
      };
      expect(readiness.conditions.find((c) => c.gate === "quote-fresh")?.satisfied).toBe(false);
      expect(report.outcome).toBe("blocked");
    });
  });

  it("high-risk REJECT blocks the build (build-refused-risk-rejected) and the overall outcome", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const { ctx, sendSeamTouched } = dryRunCtx(tmp);
      const r = await paperSniperRehearseReport(ctx, {
        mode: "mainnet-dry-run",
        candidatesPath: writeCandidates(tmp),
        outDir: "out",
        wallet: WALLET.publicKey.toBase58(),
        riskPath: writeRisk(tmp, "REJECT", 100),
        ...BUILD_FLAGS,
        json: true,
      });
      expect(r.exitCode).toBe(0);
      const report = JSON.parse(r.text) as RehearseJson;
      const stages = stageMap(report);
      expect(stages["tx-build"]?.status).toBe("blocked");
      expect(stages["tx-build"]?.detail).toContain("build-refused-risk-rejected");
      expect(existsSync(join(tmp, "out", "envelope.json"))).toBe(false);
      expect(report.outcome).toBe("blocked");
      expect(sendSeamTouched()).toBe(0);
    });
  });

  it("a stale quote (REAL builder, ticking clock, explicit --max-quote-age-ms) blocks the build", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const { ctx } = dryRunCtx(tmp, { slowBuildClock: true });
      const r = await paperSniperRehearseReport(ctx, {
        mode: "mainnet-dry-run",
        candidatesPath: writeCandidates(tmp),
        outDir: "out",
        wallet: WALLET.publicKey.toBase58(),
        riskPath: writeRisk(tmp, "PASS_FOR_PAPER_EVALUATION", 5),
        maxQuoteAgeMs: "1000",
        ...BUILD_FLAGS,
        json: true,
      });
      expect(r.exitCode).toBe(0);
      const report = JSON.parse(r.text) as RehearseJson;
      const stages = stageMap(report);
      expect(stages["tx-build"]?.status).toBe("blocked");
      expect(stages["tx-build"]?.detail).toContain("build-refused-quote-stale");
      expect(report.outcome).toBe("blocked");
    });
  });

  it("a failed simulation marks the stage failed and the outcome blocked", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const { ctx } = dryRunCtx(tmp, { simOutcome: "failed" });
      const r = await paperSniperRehearseReport(ctx, {
        mode: "mainnet-dry-run",
        candidatesPath: writeCandidates(tmp),
        outDir: "out",
        wallet: WALLET.publicKey.toBase58(),
        riskPath: writeRisk(tmp, "PASS_FOR_PAPER_EVALUATION", 5),
        ...BUILD_FLAGS,
        json: true,
      });
      const report = JSON.parse(r.text) as RehearseJson;
      const stages = stageMap(report);
      expect(stages["tx-build"]?.status).toBe("executed");
      expect(stages["tx-simulate"]?.status).toBe("failed");
      expect(stages["tx-simulate"]?.detail).toContain("simulated-failed");
      expect(report.outcome).toBe("blocked");
    });
  });

  it("without the explicit build flags, build + simulate are SKIPPED naming every required flag", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const { ctx } = dryRunCtx(tmp);
      const r = await paperSniperRehearseReport(ctx, {
        mode: "mainnet-dry-run",
        candidatesPath: writeCandidates(tmp),
        outDir: "out",
        json: true,
      });
      const stages = stageMap(JSON.parse(r.text) as RehearseJson);
      expect(stages["tx-build"]?.status).toBe("skipped");
      expect(stages["tx-build"]?.detail).toContain("--risk-score-cap");
    });
  });
});

describe("paper:sniper:rehearse — S94 AUTO-RISK in mainnet-dry-run (operator no longer hand-feeds risk)", () => {
  const riskClient = fakeRiskChainClient;

  function autoRiskCtx(tmp: string, client: ReadOnlySolanaClient) {
    let sendSeamTouched = 0;
    return {
      ctx: {
        cwd: tmp,
        env: {},
        now: FIXED_CLOCK,
        createClient: () => client,
        createQuoteAdapter: () => createJupiterQuoteAdapter({ fetchLike: happyProviderFetch() as unknown as FetchLike, clock: FIXED_CLOCK }),
        createSwapBuilder: () => createJupiterSwapBuilder({ fetchLike: happyProviderFetch(), clock: FIXED_CLOCK }),
        createTxPreview: () => ({
          endpointHost: "rpc.example.com",
          rpc: {
            simulateTransaction: async () => ({ context: { slot: 1, apiVersion: "1.18" }, value: { err: null, logs: ["ok"], unitsConsumed: 100 } }),
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
      },
      sendSeamTouched: () => sendSeamTouched,
    };
  }

  const BUILD_FLAGS = { amountSol: "0.01", slippageBps: "50", maxSpendSol: "0.02", slippageCapBps: "100", riskScoreCap: "30" } as const;

  it("DEFAULT: fetches a deep risk report per candidate, bridges the preflight input, and feeds the build — no --risk needed; send seams never touched", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const { ctx, sendSeamTouched } = autoRiskCtx(tmp, riskClient());
      const r = await paperSniperRehearseReport(ctx, {
        mode: "mainnet-dry-run",
        candidatesPath: writeCandidates(tmp),
        outDir: "out",
        wallet: WALLET.publicKey.toBase58(),
        ...BUILD_FLAGS,
        json: true,
      });
      expect(r.exitCode, r.text.slice(0, 800)).toBe(0);
      const report = JSON.parse(r.text) as RehearseJson & { riskSource: string };
      expect(report.riskSource).toBe("automatic");
      const stages = stageMap(report);
      expect(stages.risk?.status).toBe("executed");
      expect(stages.risk?.detail).toContain("AUTO risk");
      expect(stages.risk?.detail).toContain("Token-2022");
      // The artifacts an operator would have produced by hand exist on disk.
      expect(existsSync(join(tmp, "out", "risk", `risk.${USDC}.json`))).toBe(true);
      expect(existsSync(join(tmp, "out", "preflight-input.json"))).toBe(true);
      const riskReport = JSON.parse(readFileSync(join(tmp, "out", "risk", `risk.${USDC}.json`), "utf8")) as { mint: string; score: number };
      expect(riskReport.mint).toBe(USDC);
      // The build consumed the AUTO risk file (no --risk was passed).
      expect(stages["tx-build"]?.status).toBe("executed");
      expect(stages["tx-simulate"]?.status).toBe("executed");
      expect(sendSeamTouched()).toBe(0);
    });
  });

  it("a high-risk token (freeze authority) auto-REJECTS: the build blocks on the auto-fetched evidence", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const { ctx, sendSeamTouched } = autoRiskCtx(tmp, riskClient({ freeze: true }));
      const r = await paperSniperRehearseReport(ctx, {
        mode: "mainnet-dry-run",
        candidatesPath: writeCandidates(tmp),
        outDir: "out",
        wallet: WALLET.publicKey.toBase58(),
        ...BUILD_FLAGS,
        json: true,
      });
      const report = JSON.parse(r.text) as RehearseJson & { riskSource: string };
      expect(report.riskSource).toBe("automatic");
      const stages = stageMap(report);
      expect(stages.risk?.status).toBe("executed");
      expect(stages["tx-build"]?.status).toBe("blocked");
      expect(stages["tx-build"]?.detail).toContain("build-refused-risk-rejected");
      expect(report.outcome).toBe("blocked");
      expect(sendSeamTouched()).toBe(0);
    });
  });

  it("a Token-2022 transfer-hook mint auto-REJECTS through the deep extension checks", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const { ctx } = autoRiskCtx(tmp, riskClient({ token2022Hook: true }));
      const r = await paperSniperRehearseReport(ctx, {
        mode: "mainnet-dry-run",
        candidatesPath: writeCandidates(tmp),
        outDir: "out",
        wallet: WALLET.publicKey.toBase58(),
        ...BUILD_FLAGS,
        json: true,
      });
      const report = JSON.parse(r.text) as RehearseJson & { riskSource: string };
      const stages = stageMap(report);
      expect(stages.risk?.status).toBe("executed");
      const riskReport = JSON.parse(readFileSync(join(tmp, "out", "risk", `risk.${USDC}.json`), "utf8")) as {
        decision: string;
        flags: Array<{ id: string }>;
      };
      expect(riskReport.flags.some((f) => f.id === "transfer-hook-present")).toBe(true);
      expect(riskReport.decision).toBe("REJECT");
      expect(stages["tx-build"]?.status).toBe("blocked");
      expect(report.outcome).toBe("blocked");
    });
  });

  it("chain read unavailable => the risk stage is honestly UNAVAILABLE (never assumed safe) and the run blocks", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const { ctx } = autoRiskCtx(tmp, riskClient({ throwOnRead: true }));
      const r = await paperSniperRehearseReport(ctx, {
        mode: "mainnet-dry-run",
        candidatesPath: writeCandidates(tmp),
        outDir: "out",
        json: true,
      });
      expect(r.exitCode).toBe(0);
      const report = JSON.parse(r.text) as RehearseJson & { riskSource: string };
      expect(report.riskSource).toBe("none");
      const stages = stageMap(report);
      expect(stages.risk?.status).toBe("unavailable");
      expect(stages.risk?.detail).toContain("auto-risk could not fetch");
      expect(report.outcome).toBe("blocked");
    });
  });

  it("--skip-auto-risk opts out; operator-supplied --risk still wins over auto-risk", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      let clientCalls = 0;
      const countingClient = riskClient();
      const counted: ReadOnlySolanaClient = {
        ...countingClient,
        getTokenMintInfo: async (mint) => {
          clientCalls += 1;
          return countingClient.getTokenMintInfo(mint);
        },
      };
      const { ctx } = autoRiskCtx(tmp, counted);
      const skipped = await paperSniperRehearseReport(ctx, {
        mode: "mainnet-dry-run",
        candidatesPath: writeCandidates(tmp),
        outDir: "out-skip",
        skipAutoRisk: true,
        json: true,
      });
      const skippedReport = JSON.parse(skipped.text) as RehearseJson & { riskSource: string };
      expect(stageMap(skippedReport).risk?.status).toBe("skipped");
      expect(skippedReport.riskSource).toBe("none");

      const operator = await paperSniperRehearseReport(ctx, {
        mode: "mainnet-dry-run",
        candidatesPath: writeCandidates(tmp),
        outDir: "out-op",
        riskPath: writeRisk(tmp, "PASS_FOR_PAPER_EVALUATION", 5),
        json: true,
      });
      const operatorReport = JSON.parse(operator.text) as RehearseJson & { riskSource: string };
      expect(stageMap(operatorReport).risk?.status).toBe("executed");
      expect(operatorReport.riskSource).toBe("operator");
      // Neither run auto-fetched anything from the chain.
      expect(clientCalls).toBe(0);
    });
  });
});

describe("paper:sniper:rehearse — devnet path (explicit, double opt-in)", () => {
  function devnetRpc(): RehearsalRpc {
    let funded = false;
    const send: SendRpcLike = {
      getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58() }),
      sendRawTransaction: async () => "RehearseDevnetSignature1111111111111111111111",
    };
    return Object.freeze({
      endpointHost: "fake.devnet.example.com",
      faucet: {
        getBalanceLamports: async () => (funded ? 1_000_000_000 : 0),
        requestAirdrop: async () => {
          funded = true;
          return "AirdropSig111111111111111111111111111111111111";
        },
        getSignatureStatus: async () => ({ confirmed: true, slot: 777, errLabel: null }),
      },
      send,
    });
  }

  it("devnet mode WITHOUT --devnet-send skips the broadcast (explicit flag required)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await paperSniperRehearseReport(
        { cwd: tmp, env: { SOLMAKER_ENABLE_DEVNET_EXECUTION: "devnet-only" }, now: FIXED_CLOCK },
        { mode: "devnet", candidatesPath: writeCandidates(tmp), outDir: "out", acknowledgeDevnetExecution: true, json: true },
      );
      const stages = stageMap(JSON.parse(r.text) as RehearseJson);
      expect(stages["devnet-rehearse"]?.status).toBe("skipped");
      expect(stages["devnet-rehearse"]?.detail).toContain("--devnet-send");
    });
  });

  it("devnet mode + --devnet-send + double opt-in runs the broadcast rehearsal and reports the signature", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await paperSniperRehearseReport(
        {
          cwd: tmp,
          env: { SOLMAKER_ENABLE_DEVNET_EXECUTION: "devnet-only" },
          now: FIXED_CLOCK,
          sleep: async () => {},
          createRehearsalRpc: () => devnetRpc(),
          createTxPreview: () => ({
            endpointHost: "fake.devnet.example.com",
            rpc: {
              simulateTransaction: async () => ({ context: { slot: 1, apiVersion: "1.18" }, value: { err: null, logs: [], unitsConsumed: 1 } }),
            },
          }),
        },
        {
          mode: "devnet",
          candidatesPath: writeCandidates(tmp),
          outDir: join("runs", "rehearse-devnet"),
          devnetSend: true,
          acknowledgeDevnetExecution: true,
          json: true,
        },
      );
      expect(r.exitCode, r.text.slice(0, 800)).toBe(0);
      const stages = stageMap(JSON.parse(r.text) as RehearseJson);
      expect(stages["devnet-rehearse"]?.status).toBe("executed");
      expect(stages["devnet-rehearse"]?.detail).toContain("RehearseDevnetSignature");
      expect(existsSync(join(tmp, "runs", "rehearse-devnet", "devnet", "devnet-rehearsal-report.json"))).toBe(true);
    });
  });

  it("devnet mode + --devnet-send WITHOUT the env flag fails the stage honestly (the wall holds)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await paperSniperRehearseReport(
        { cwd: tmp, env: {}, now: FIXED_CLOCK, createRehearsalRpc: () => devnetRpc() },
        { mode: "devnet", candidatesPath: writeCandidates(tmp), outDir: join("runs", "r2"), devnetSend: true, acknowledgeDevnetExecution: true, json: true },
      );
      const stages = stageMap(JSON.parse(r.text) as RehearseJson);
      expect(stages["devnet-rehearse"]?.status).toBe("failed");
      expect(stages["devnet-rehearse"]?.detail).toContain("NOT enabled");
    });
  });
});
