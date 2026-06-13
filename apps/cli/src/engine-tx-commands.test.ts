/**
 * Sprint 100 — engine:tx:inspect + engine:sim:classify (Rust transaction
 * inspection + simulation classification, read-only).
 *
 * Pins:
 *   - refusals: missing --envelope / unreadable file; missing classify input;
 *   - a missing Rust engine is honest (exit 0; exit 1 with --fail-on-unavailable);
 *   - the validated artifacts render and --json prints them verbatim;
 *   - a tampered engine artifact is REFUSED via the parity wall;
 *   - REAL e2e (when a prebuilt engine exists): a real @solana/web3.js envelope
 *     is inspected and a real S95 error is classified, both through the binary.
 */

import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { inspectUnsignedTransactionShape } from "@soulmaker/txbuilder";
import { validateUnsignedTxEnvelope } from "@soulmaker/txpreview";
import type { EngineProcessRunner } from "@soulmaker/engine-bridge";
import { engineTxInspectReport, engineSimClassifyReport } from "./commands.js";

const PAYER = Keypair.generate();
const BLOCKHASH = new PublicKey(Buffer.alloc(32, 7)).toBase58();
const FIXED_NOW = "2026-06-12T00:00:00.000Z";

function realEnvelope(): Record<string, unknown> {
  const message = new TransactionMessage({
    payerKey: PAYER.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [SystemProgram.transfer({ fromPubkey: PAYER.publicKey, toPubkey: PAYER.publicKey, lamports: 1 })],
  }).compileToV0Message();
  return {
    schemaVersion: "txpreview.envelope.v1",
    network: "devnet",
    feePayerPublicKey: PAYER.publicKey.toBase58(),
    txBase64: Buffer.from(new VersionedTransaction(message).serialize()).toString("base64"),
    builderId: "test-builder",
    candidateMint: null,
    routeCaveats: [],
    constraints: { maxSpendLamports: "1", slippageBps: 50 },
    unsigned: true,
    neverSigned: true,
    phase7LiveTradingReady: false,
  };
}

function txEngineArtifact(envelopeValue: Record<string, unknown>): Record<string, unknown> {
  const envelope = validateUnsignedTxEnvelope(envelopeValue);
  const facts = inspectUnsignedTransactionShape(envelope);
  const tx = new VersionedTransaction(
    new TransactionMessage({ payerKey: PAYER.publicKey, recentBlockhash: BLOCKHASH, instructions: [SystemProgram.transfer({ fromPubkey: PAYER.publicKey, toPubkey: PAYER.publicKey, lamports: 1 })] }).compileToV0Message(),
  );
  return {
    schemaVersion: "engine.tx.inspect.report.v1",
    banner: "RUST ENGINE TX INSPECT — test fixture banner.",
    engineName: "solmaker-engine",
    engineVersion: "0.1.0",
    ipcVersion: "engine.ipc.v1",
    network: envelope.network,
    feePayerPublicKey: envelope.feePayerPublicKey,
    builderId: envelope.builderId,
    candidateMint: envelope.candidateMint,
    shape: {
      version: facts.version,
      versionSupported: facts.versionSupported,
      blockhashPresent: facts.blockhashPresent,
      instructionCount: facts.instructionCount,
      accountKeyCount: tx.message.staticAccountKeys.length,
      staticProgramIds: facts.staticProgramIds,
      addressTableLookupCount: facts.addressTableLookupCount,
      unresolvableProgramIdCount: facts.unresolvableProgramIdCount,
    },
    unsigned: true,
    createdAt: FIXED_NOW,
    caveats: ["Shape facts only — test fixture caveat."],
    notExecutable: true,
    neverSigns: true,
    neverSends: true,
    phase7LiveTradingReady: false,
  };
}

function okRunner(stdoutDoc: Record<string, unknown>): EngineProcessRunner {
  return {
    run: () => Promise.resolve({ started: true, startError: null, exitCode: 0, timedOut: false, stdout: JSON.stringify(stdoutDoc, null, 2) + "\n", stderr: "", stdoutTruncated: false, stderrTruncated: false }),
  };
}

function missingRunner(): EngineProcessRunner {
  return {
    run: () => Promise.resolve({ started: false, startError: "ENOENT", exitCode: null, timedOut: false, stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false }),
  };
}

async function withTmpAsync<T>(fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), "engine-tx-"));
  try {
    return await fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function baseCtx(tmp: string) {
  return { cwd: tmp, env: { PATH: "/usr/bin" } as NodeJS.ProcessEnv, now: () => FIXED_NOW, engineBinaryExists: () => false };
}

describe("engine:tx:inspect", () => {
  it("requires --envelope and a readable file", async () => {
    await withTmpAsync(async (tmp) => {
      const ctx = { ...baseCtx(tmp), createEngineRunner: () => okRunner(txEngineArtifact(realEnvelope())) };
      expect((await engineTxInspectReport(ctx, {})).text).toContain("--envelope");
      const unreadable = await engineTxInspectReport(ctx, { envelopePath: "missing.json" });
      expect(unreadable.exitCode).toBe(1);
      expect(unreadable.text).toContain("cannot read");
    });
  });

  it("a missing engine is honest (exit 0; exit 1 with --fail-on-unavailable)", async () => {
    await withTmpAsync(async (tmp) => {
      writeFileSync(join(tmp, "env.json"), JSON.stringify(realEnvelope()));
      const ctx = { ...baseCtx(tmp), createEngineRunner: () => missingRunner() };
      const soft = await engineTxInspectReport(ctx, { envelopePath: "env.json" });
      expect(soft.exitCode).toBe(0);
      expect(soft.text).toContain("UNAVAILABLE");
      const hard = await engineTxInspectReport(ctx, { envelopePath: "env.json", failOnUnavailable: true });
      expect(hard.exitCode).toBe(1);
    });
  });

  it("renders shape facts and --json prints the validated artifact verbatim", async () => {
    await withTmpAsync(async (tmp) => {
      const envelope = realEnvelope();
      writeFileSync(join(tmp, "env.json"), JSON.stringify(envelope));
      const ctx = { ...baseCtx(tmp), createEngineRunner: () => okRunner(txEngineArtifact(envelope)) };
      const text = await engineTxInspectReport(ctx, { envelopePath: "env.json" });
      expect(text.exitCode, text.text.slice(0, 400)).toBe(0);
      expect(text.text).toContain("RUST ENGINE TX INSPECT");
      expect(text.text).toContain("fee payer:");
      expect(text.text).toContain("never a trading-latency claim");
      const json = await engineTxInspectReport(ctx, { envelopePath: "env.json", json: true });
      const parsed = JSON.parse(json.text) as Record<string, unknown>;
      expect(parsed.schemaVersion).toBe("engine.tx.inspect.report.v1");
      expect(parsed.unsigned).toBe(true);
    });
  });

  it("a tampered engine artifact is REFUSED via the parity wall (exit 1)", async () => {
    await withTmpAsync(async (tmp) => {
      const envelope = realEnvelope();
      writeFileSync(join(tmp, "env.json"), JSON.stringify(envelope));
      const tampered = txEngineArtifact(envelope);
      (tampered.shape as Record<string, unknown>).instructionCount = 99;
      const ctx = { ...baseCtx(tmp), createEngineRunner: () => okRunner(tampered) };
      const r = await engineTxInspectReport(ctx, { envelopePath: "env.json" });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("REFUSED");
      expect(r.text).toContain("schema-mismatch");
    });
  });
});

describe("engine:sim:classify", () => {
  function simArtifact(): Record<string, unknown> {
    return {
      schemaVersion: "engine.sim.classification.report.v1",
      banner: "RUST ENGINE SIM CLASSIFY — test fixture banner.",
      engineName: "solmaker-engine",
      engineVersion: "0.1.0",
      ipcVersion: "engine.ipc.v1",
      classification: "account-error",
      classificationMessage: "An account the transaction needs is missing, invalid, or underfunded (e.g. the fee payer has no balance at simulation state).",
      classificationNextAction: "Check the wallet's balance and the token accounts involved, then rebuild. An account error at simulation time would also fail at execution time.",
      errLabelPresent: true,
      logLineCount: 0,
      createdAt: FIXED_NOW,
      caveats: ["Classification is derived ONLY from the error label and logs — test fixture caveat."],
      notExecutable: true,
      neverSigns: true,
      neverSends: true,
      phase7LiveTradingReady: false,
    };
  }

  it("requires an input source", async () => {
    await withTmpAsync(async (tmp) => {
      const ctx = { ...baseCtx(tmp), createEngineRunner: () => okRunner(simArtifact()) };
      const r = await engineSimClassifyReport(ctx, {});
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("--err-label");
    });
  });

  it("classifies a literal --err-label and renders the guidance", async () => {
    await withTmpAsync(async (tmp) => {
      const ctx = { ...baseCtx(tmp), createEngineRunner: () => okRunner(simArtifact()) };
      const text = await engineSimClassifyReport(ctx, { errLabel: '"AccountNotFound"' });
      expect(text.exitCode, text.text.slice(0, 400)).toBe(0);
      expect(text.text).toContain("classification: account-error");
      expect(text.text).toContain("next:");
      const json = await engineSimClassifyReport(ctx, { errLabel: '"AccountNotFound"', json: true });
      const parsed = JSON.parse(json.text) as Record<string, unknown>;
      expect(parsed.classification).toBe("account-error");
    });
  });

  it("reads errLabel + logs from a --report file", async () => {
    await withTmpAsync(async (tmp) => {
      writeFileSync(join(tmp, "sim.json"), JSON.stringify({ errLabel: '"AccountNotFound"', logs: [] }));
      const ctx = { ...baseCtx(tmp), createEngineRunner: () => okRunner(simArtifact()) };
      const r = await engineSimClassifyReport(ctx, { reportPath: "sim.json" });
      expect(r.exitCode, r.text.slice(0, 300)).toBe(0);
      expect(r.text).toContain("account-error");
    });
  });

  it("a parity mismatch (engine lies) is REFUSED with exit 1", async () => {
    await withTmpAsync(async (tmp) => {
      // Engine claims account-error, but the input is a slippage error.
      const ctx = { ...baseCtx(tmp), createEngineRunner: () => okRunner(simArtifact()) };
      const r = await engineSimClassifyReport(ctx, { errLabel: "Slippage tolerance exceeded" });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("schema-mismatch");
    });
  });
});

// ---------------------------------------------------------------------------
// REAL e2e: the actual binary inspects a real envelope and classifies a real
// S95 error. Skipped honestly when no prebuilt engine exists.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ENGINE_BINARY = process.platform === "win32" ? "solmaker-engine.exe" : "solmaker-engine";
const PREBUILT_ENGINE_EXISTS =
  existsSync(join(REPO_ROOT, "target", "release", ENGINE_BINARY)) ||
  existsSync(join(REPO_ROOT, "target", "debug", ENGINE_BINARY));

describe("engine:tx:inspect + engine:sim:classify — REAL engine e2e", () => {
  it.skipIf(!PREBUILT_ENGINE_EXISTS)("inspects a real envelope through the actual binary", async () => {
    await withTmpAsync(async (tmp) => {
      const envelope = realEnvelope();
      const envelopePath = join(tmp, "env.json");
      writeFileSync(envelopePath, JSON.stringify(envelope));
      const ctx = { cwd: REPO_ROOT, env: process.env, now: () => FIXED_NOW };
      const r = await engineTxInspectReport(ctx, { envelopePath, json: true });
      expect(r.exitCode, r.text.slice(0, 400)).toBe(0);
      const parsed = JSON.parse(r.text) as Record<string, unknown>;
      expect(parsed.schemaVersion).toBe("engine.tx.inspect.report.v1");
      expect(parsed.unsigned).toBe(true);
    });
  });

  it.skipIf(!PREBUILT_ENGINE_EXISTS)("classifies a real S95 error through the actual binary", async () => {
    const ctx = { cwd: REPO_ROOT, env: process.env, now: () => FIXED_NOW };
    const r = await engineSimClassifyReport(ctx, { errLabel: '{"InstructionError":[1,"ComputeBudgetExceeded"]}', json: true });
    expect(r.exitCode, r.text.slice(0, 400)).toBe(0);
    const parsed = JSON.parse(r.text) as Record<string, unknown>;
    expect(parsed.classification).toBe("compute-exceeded");
  });
});
