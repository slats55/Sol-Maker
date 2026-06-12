/**
 * Sprint 92 — `execution:status` / `execution:build` / `execution:devnet:send`.
 *
 * Pins, at the CLI layer:
 *   - status: default state is paper + BLOCKED gate (0/14); near-arm configurations still show
 *     BLOCKED; the checklist names every failing condition; status can never arm anything;
 *   - build: refusal-first (full refusal list, exit 1, nothing fetched), happy path over an
 *     injected builder writes a valid UNSIGNED envelope, tighten-only caps against config;
 *   - devnet send: refused without the env flag + CLI flag; refused for a mainnet endpoint;
 *     full happy path over injected seams appends the audit JSONL and reports the signature;
 *   - there is NO mainnet send surface: the registered command list carries no such command.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { validateUnsignedTxEnvelope } from "@soulmaker/txpreview";
import { evaluateBuildRefusals, type SwapTransactionBuilder } from "@soulmaker/txbuilder";
import type { SendRpc } from "@soulmaker/execution";
import { executionStatusReport, executionBuildReport, executionDevnetSendReport } from "./commands.js";

const SIGNER = Keypair.generate();
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BLOCKHASH = new PublicKey(Buffer.alloc(32, 4)).toBase58();

async function withTmpAsync<T>(fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), "exec-cmd-"));
  try {
    return await fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function writeConfig(tmp: string, extra: Record<string, unknown> = {}): void {
  writeFileSync(join(tmp, "soulmaker.config.json"), JSON.stringify({ mode: "WATCH_ONLY", ...extra }));
}

function unsignedDevnetEnvelope(): Record<string, unknown> {
  const message = new TransactionMessage({
    payerKey: SIGNER.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [SystemProgram.transfer({ fromPubkey: SIGNER.publicKey, toPubkey: SIGNER.publicKey, lamports: 1 })],
  }).compileToV0Message();
  return {
    schemaVersion: "txpreview.envelope.v1",
    network: "devnet",
    feePayerPublicKey: SIGNER.publicKey.toBase58(),
    txBase64: Buffer.from(new VersionedTransaction(message).serialize()).toString("base64"),
    builderId: "self-transfer-probe",
    candidateMint: null,
    routeCaveats: [],
    constraints: { maxSpendLamports: "1", slippageBps: 0 },
    unsigned: true,
    neverSigned: true,
    phase7LiveTradingReady: false,
  };
}

describe("execution:status — the default state is paper + a fully BLOCKED gate", () => {
  it("default: mode paper, 0/14 gate conditions, core gate closed", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = executionStatusReport({ cwd: tmp, env: {} }, { json: true });
      expect(r.exitCode).toBe(0);
      const status = JSON.parse(r.text) as Record<string, never> & {
        mode: string;
        mainnetLiveGate: { armed: boolean; satisfiedCount: number; totalChecks: number };
        coreLiveGate: { open: boolean };
      };
      expect(status.mode).toBe("paper");
      expect(status.mainnetLiveGate.armed).toBe(false);
      expect(status.mainnetLiveGate.totalChecks).toBe(14);
      expect(status.coreLiveGate.open).toBe(false);
    });
  });

  it("a NEAR-ARM configuration (env flag + config + CLI flag) still shows BLOCKED with named failures", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp, { phase7LiveTradingReady: true });
      const r = executionStatusReport(
        { cwd: tmp, env: { SOLMAKER_ENABLE_LIVE_TRADING: "I_UNDERSTAND_REAL_FUNDS_ARE_AT_RISK" } },
        { request: "mainnet-live", iUnderstandThisCanLoseRealMoney: true },
      );
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain("mainnet-live-blocked");
      expect(r.text).toContain("BLOCKED");
      expect(r.text).toContain("quote-fresh");
      expect(r.text).toContain("simulation-ok");
      expect(r.text).toContain("signer-boundary");
      expect(r.text).not.toContain("ARMED (!!)");
    });
  });

  it("devnet request without BOTH explicit opt-ins resolves to paper", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = executionStatusReport({ cwd: tmp, env: {} }, { request: "devnet", json: true });
      expect((JSON.parse(r.text) as { mode: string }).mode).toBe("paper");
      const enabled = executionStatusReport(
        { cwd: tmp, env: { SOLMAKER_ENABLE_DEVNET_EXECUTION: "devnet-only" } },
        { request: "devnet", acknowledgeDevnetExecution: true, json: true },
      );
      expect((JSON.parse(enabled.text) as { mode: string }).mode).toBe("devnet-execution");
    });
  });
});

function fakeBuilder(): SwapTransactionBuilder {
  return {
    builderId: "jupiter-swap-api",
    endpointHost: "fake.example.com",
    build: async (request) => {
      // The injected fake honors the production contract: refusal-first, no exceptions.
      const refusals = evaluateBuildRefusals(request);
      if (refusals.length > 0) return { built: false, refusals };
      const payer = new PublicKey(request.walletPublicKey as string);
      const message = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: BLOCKHASH,
        instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 1 })],
      }).compileToV0Message();
      return {
        built: true,
        envelope: validateUnsignedTxEnvelope({
          schemaVersion: "txpreview.envelope.v1",
          network: "mainnet-beta",
          feePayerPublicKey: payer.toBase58(),
          txBase64: Buffer.from(new VersionedTransaction(message).serialize()).toString("base64"),
          builderId: "jupiter-swap-api",
          candidateMint: request.candidateMint,
          routeCaveats: ["test"],
          constraints: { maxSpendLamports: request.controls?.maxSpendLamports ?? null, slippageBps: request.slippageBps ?? null },
          unsigned: true,
          neverSigned: true,
          phase7LiveTradingReady: false,
        }),
        quoteFacts: { inAmountRaw: "10000000", outAmountRaw: "42", priceImpactPct: "0.1", contextSlot: 1, quotedAt: "t" },
      };
    },
  };
}

function writeRisk(tmp: string, mint: string, score: number, decision: string): string {
  writeFileSync(join(tmp, "risk.json"), JSON.stringify({ mint, score, decision, flags: [], summary: [], generatedAt: "t", disclaimer: "x" }));
  return "risk.json";
}

describe("execution:build — refusal-first at the CLI layer", () => {
  it("a paper request lists EVERY refusal and exits 1 without an envelope", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const risk = writeRisk(tmp, USDC, 10, "PASS_FOR_PAPER_EVALUATION");
      const r = await executionBuildReport(
        { cwd: tmp, env: {}, createSwapBuilder: () => fakeBuilder() },
        {
          candidateMint: USDC,
          amountSol: "0.01",
          slippageBps: "50",
          wallet: SIGNER.publicKey.toBase58(),
          riskPath: risk,
          maxSpendSol: "0.02",
          slippageCapBps: "100",
          riskScoreCap: "30",
          // no --request -> paper -> build-refused-mode-cannot-build
        },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("BUILD REFUSED");
      expect(r.text).toContain("build-refused-mode-cannot-build");
    });
  });

  it("tighten-only: --max-spend-sol above the config cap refuses before anything else", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp); // default caps.maxTradeSizeSol = 0.05
      const risk = writeRisk(tmp, USDC, 10, "PASS_FOR_PAPER_EVALUATION");
      const r = await executionBuildReport(
        { cwd: tmp, env: {}, createSwapBuilder: () => fakeBuilder() },
        { candidateMint: USDC, amountSol: "0.01", slippageBps: "50", wallet: SIGNER.publicKey.toBase58(), riskPath: risk, maxSpendSol: "0.5", request: "mainnet-dry-run" },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("caps only tighten");
    });
  });

  it("a risk report for a different mint refuses (cross-check)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const risk = writeRisk(tmp, WSOL, 10, "PASS_FOR_PAPER_EVALUATION");
      const r = await executionBuildReport(
        { cwd: tmp, env: {}, createSwapBuilder: () => fakeBuilder() },
        { candidateMint: USDC, amountSol: "0.01", slippageBps: "50", wallet: SIGNER.publicKey.toBase58(), riskPath: risk, maxSpendSol: "0.02", request: "mainnet-dry-run" },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("DIFFERENT mint");
    });
  });

  it("happy path (mainnet-dry-run over the injected builder) writes a valid UNSIGNED envelope", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const risk = writeRisk(tmp, USDC, 10, "PASS_FOR_PAPER_EVALUATION");
      const r = await executionBuildReport(
        { cwd: tmp, env: {}, createSwapBuilder: () => fakeBuilder() },
        {
          candidateMint: USDC,
          amountSol: "0.01",
          slippageBps: "50",
          wallet: SIGNER.publicKey.toBase58(),
          riskPath: risk,
          maxSpendSol: "0.02",
          slippageCapBps: "100",
          riskScoreCap: "30",
          request: "mainnet-dry-run",
          outPath: "envelope.json",
        },
      );
      expect(r.exitCode, r.text.slice(0, 500)).toBe(0);
      expect(r.text).toContain("nothing signed, nothing sent");
      expect(r.text).toContain("paper:simulation:tx");
      const envelope = validateUnsignedTxEnvelope(JSON.parse(readFileSync(join(tmp, "envelope.json"), "utf8")));
      expect(envelope.phase7LiveTradingReady).toBe(false);
    });
  });
});

describe("execution:devnet:send — devnet-only, double opt-in, journaled", () => {
  function sendCtx(tmp: string, env: Record<string, string>) {
    const sent: Uint8Array[] = [];
    const sendRpc: SendRpc = {
      endpointHost: "devnet.example.com",
      rpc: {
        getLatestBlockhash: async () => ({ blockhash: new PublicKey(Buffer.alloc(32, 6)).toBase58() }),
        sendRawTransaction: async (bytes) => {
          sent.push(bytes);
          return "FakeDevnetSignature1111111111111111111111111";
        },
      },
    };
    return { ctx: { cwd: tmp, env, createSendRpc: () => sendRpc, now: () => "2026-06-12T06:15:00.000Z" }, sent };
  }

  function fullEnv(tmp: string): Record<string, string> {
    const keyPath = join(tmp, "devnet-signer.json");
    writeFileSync(keyPath, JSON.stringify(Array.from(SIGNER.secretKey)));
    return { SOLMAKER_ENABLE_DEVNET_EXECUTION: "devnet-only", TEST_DEVNET_SIGNER: keyPath };
  }

  it("REFUSES without the env flag, and without the CLI acknowledgment", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      writeFileSync(join(tmp, "envelope.json"), JSON.stringify(unsignedDevnetEnvelope()));
      const { ctx } = sendCtx(tmp, { TEST_DEVNET_SIGNER: "x" });
      const noEnv = await executionDevnetSendReport(ctx, {
        envelopePath: "envelope.json",
        signerEnvVar: "TEST_DEVNET_SIGNER",
        auditLog: "audit.jsonl",
        riskScore: "0",
        acknowledgeDevnetExecution: true,
      });
      expect(noEnv.exitCode).toBe(1);
      expect(noEnv.text).toContain("NOT enabled");

      const { ctx: ctx2 } = sendCtx(tmp, fullEnv(tmp));
      const noFlag = await executionDevnetSendReport(ctx2, {
        envelopePath: "envelope.json",
        signerEnvVar: "TEST_DEVNET_SIGNER",
        auditLog: "audit.jsonl",
        riskScore: "0",
      });
      expect(noFlag.exitCode).toBe(1);
      expect(noFlag.text).toContain("NOT enabled");
    });
  });

  it("REFUSES a mainnet-looking endpoint outright", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      writeFileSync(join(tmp, "envelope.json"), JSON.stringify(unsignedDevnetEnvelope()));
      const { ctx } = sendCtx(tmp, fullEnv(tmp));
      const r = await executionDevnetSendReport(ctx, {
        envelopePath: "envelope.json",
        signerEnvVar: "TEST_DEVNET_SIGNER",
        rpcUrl: "https://api.mainnet-beta.solana.com",
        acknowledgeDevnetExecution: true,
        auditLog: "audit.jsonl",
        riskScore: "0",
      });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("never talks to a mainnet endpoint");
    });
  });

  it("happy path: signs through the boundary, submits once, journals the attempt; no secret leaks", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      writeFileSync(join(tmp, "envelope.json"), JSON.stringify(unsignedDevnetEnvelope()));
      const { ctx, sent } = sendCtx(tmp, fullEnv(tmp));
      const r = await executionDevnetSendReport(ctx, {
        envelopePath: "envelope.json",
        signerEnvVar: "TEST_DEVNET_SIGNER",
        acknowledgeDevnetExecution: true,
        auditLog: "audit.jsonl",
        riskScore: "0",
        json: true,
      });
      expect(r.exitCode, r.text.slice(0, 500)).toBe(0);
      const report = JSON.parse(r.text) as Record<string, unknown>;
      expect(report.outcome).toBe("submitted");
      expect(report.signature).toBe("FakeDevnetSignature1111111111111111111111111");
      expect(report.phase7LiveTradingReady).toBe(false);
      expect(sent).toHaveLength(1);

      const journal = readFileSync(join(tmp, "audit.jsonl"), "utf8").trim().split("\n");
      expect(journal).toHaveLength(1);
      expect((JSON.parse(journal[0] as string) as Record<string, unknown>).outcome).toBe("submitted");

      // No secret-shaped value in the CLI output or the journal.
      for (const text of [r.text, journal[0] as string]) {
        expect(text).not.toMatch(/[1-9A-HJ-NP-Za-km-z]{80,}/);
        expect(text).not.toMatch(/"secretKey"|"privateKey"/i);
      }
    });
  });

  it("a kill-switched config refuses at the safety wall and the refusal is journaled", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp, { killSwitch: true });
      writeFileSync(join(tmp, "envelope.json"), JSON.stringify(unsignedDevnetEnvelope()));
      const { ctx } = sendCtx(tmp, fullEnv(tmp));
      const r = await executionDevnetSendReport(ctx, {
        envelopePath: "envelope.json",
        signerEnvVar: "TEST_DEVNET_SIGNER",
        acknowledgeDevnetExecution: true,
        auditLog: "audit.jsonl",
        riskScore: "0",
      });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("safety-kill-switch-active");
      const journal = readFileSync(join(tmp, "audit.jsonl"), "utf8").trim().split("\n");
      expect((JSON.parse(journal[0] as string) as Record<string, unknown>).outcome).toBe("refused");
    });
  });
});

describe("there is NO mainnet send surface", () => {
  it("the registered command list carries no mainnet send command", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");
    const commands = [...source.matchAll(/\.command\("([^"]+)"\)/g)].map((m) => m[1] as string);
    expect(commands).toContain("execution:devnet:send");
    for (const command of commands) {
      expect(command).not.toMatch(/mainnet.*send|send.*mainnet|live.*send|send.*live/i);
    }
  });
});
