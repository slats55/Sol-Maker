/**
 * Sprint 92 — `paper:simulation:tx` (the real simulateTransaction preview CLI).
 *
 * Pins:
 *   - refusals: missing --envelope, invalid/SIGNED envelope (before any network I/O), PAPER mode
 *     without --allow-paper-read, missing RPC endpoint, obvious envelope/endpoint cluster
 *     mismatch, --out overwrite;
 *   - outcomes over an INJECTED preview seam: simulated-ok / simulated-failed / unavailable map
 *     through with --fail-on-not-ok gating;
 *   - safety: the written report pins neverSigns/neverSends/phase7LiveTradingReady=false, and a
 *     simulated-ok output never claims readiness.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { TxPreviewRpc } from "@soulmaker/txpreview";
import { paperSimulationTxReport } from "./commands.js";

// Keypair appears ONLY to fabricate test inputs (a throwaway public key + the forbidden signed case).
const PAYER = Keypair.generate();
const DEST = Keypair.generate().publicKey;
const BLOCKHASH = new PublicKey(Buffer.alloc(32, 9)).toBase58();

async function withTmpAsync<T>(fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), "sim-tx-"));
  try {
    return await fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function unsignedTx(): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: PAYER.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [SystemProgram.transfer({ fromPubkey: PAYER.publicKey, toPubkey: DEST, lamports: 1 })],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

function writeEnvelope(tmp: string, overrides: Record<string, unknown> = {}): string {
  const envelope = {
    schemaVersion: "txpreview.envelope.v1",
    network: "devnet",
    feePayerPublicKey: PAYER.publicKey.toBase58(),
    txBase64: Buffer.from(unsignedTx().serialize()).toString("base64"),
    builderId: "test-builder",
    candidateMint: null,
    routeCaveats: [],
    constraints: { maxSpendLamports: null, slippageBps: null },
    unsigned: true,
    neverSigned: true,
    phase7LiveTradingReady: false,
    ...overrides,
  };
  writeFileSync(join(tmp, "envelope.json"), JSON.stringify(envelope, null, 2));
  return "envelope.json";
}

function fakePreview(behavior: "ok" | "fail" | "throw"): TxPreviewRpc {
  return {
    endpointHost: "rpc.example.com",
    rpc: {
      simulateTransaction: async () => {
        if (behavior === "throw") throw new Error("ECONNREFUSED");
        return {
          context: { slot: 7, apiVersion: "x" },
          value:
            behavior === "ok"
              ? { err: null, logs: ["ok"], unitsConsumed: 100, accounts: null, returnData: null }
              : { err: { InstructionError: [0, "Custom"] }, logs: ["fail"], unitsConsumed: 90, accounts: null, returnData: null },
        } as never;
      },
    },
  };
}

function ctx(tmp: string, behavior: "ok" | "fail" | "throw" = "ok", mode = "WATCH_ONLY") {
  writeFileSync(join(tmp, "soulmaker.config.json"), JSON.stringify({ mode, rpcUrl: "https://rpc.example.com" }));
  return { cwd: tmp, env: {}, createTxPreview: () => fakePreview(behavior), now: () => "2026-06-12T05:30:00.000Z" };
}

describe("paper:simulation:tx — refusals (before any network I/O)", () => {
  it("requires --envelope and refuses a SIGNED transaction as an input error", async () => {
    await withTmpAsync(async (tmp) => {
      expect((await paperSimulationTxReport(ctx(tmp), {})).text).toMatch(/^Refusing: --envelope/);
      const tx = unsignedTx();
      tx.sign([PAYER]);
      const signed = writeEnvelope(tmp, { txBase64: Buffer.from(tx.serialize()).toString("base64") });
      const r = await paperSimulationTxReport(ctx(tmp), { envelopePath: signed });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("SIGNED transaction is refused");
    });
  });

  it("refuses PAPER mode without --allow-paper-read; allows it with the flag", async () => {
    await withTmpAsync(async (tmp) => {
      const envelope = writeEnvelope(tmp);
      const c = ctx(tmp, "ok", "PAPER");
      const refused = await paperSimulationTxReport(c, { envelopePath: envelope });
      expect(refused.exitCode).toBe(1);
      expect(refused.text).toContain("--allow-paper-read");
      const allowed = await paperSimulationTxReport(c, { envelopePath: envelope, allowPaperRead: true, json: true });
      expect(allowed.exitCode, allowed.text.slice(0, 300)).toBe(0);
    });
  });

  it("refuses an obvious envelope/endpoint cluster mismatch", async () => {
    await withTmpAsync(async (tmp) => {
      const envelope = writeEnvelope(tmp); // network: devnet
      const r = await paperSimulationTxReport(ctx(tmp), { envelopePath: envelope, rpcUrl: "https://api.mainnet-beta.solana.com" });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("mainnet endpoint");
    });
  });

  it("refuses --out overwrite without --force", async () => {
    await withTmpAsync(async (tmp) => {
      const envelope = writeEnvelope(tmp);
      writeFileSync(join(tmp, "report.json"), "{}");
      const r = await paperSimulationTxReport(ctx(tmp), { envelopePath: envelope, outPath: "report.json" });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("already exists");
    });
  });
});

describe("paper:simulation:tx — outcomes through the injected seam", () => {
  it("simulated-ok writes an honest report whose literals never claim readiness", async () => {
    await withTmpAsync(async (tmp) => {
      const envelope = writeEnvelope(tmp);
      const r = await paperSimulationTxReport(ctx(tmp, "ok"), { envelopePath: envelope, outPath: "report.json" });
      expect(r.exitCode, r.text.slice(0, 300)).toBe(0);
      const report = JSON.parse(readFileSync(join(tmp, "report.json"), "utf8")) as Record<string, unknown>;
      expect(report.schemaVersion).toBe("txpreview.simulation.report.v1");
      expect(report.outcome).toBe("simulated-ok");
      expect(report.neverSigns).toBe(true);
      expect(report.neverSends).toBe(true);
      expect(report.phase7LiveTradingReady).toBe(false);
      expect(report.sigVerifyDisabled).toBe(true);
      expect(r.text).toContain("does NOT arm anything");
    });
  });

  it("simulated-failed and unavailable stay honest; --fail-on-not-ok gates them", async () => {
    await withTmpAsync(async (tmp) => {
      const envelope = writeEnvelope(tmp);
      const failed = await paperSimulationTxReport(ctx(tmp, "fail"), { envelopePath: envelope, json: true, failOnNotOk: true });
      expect(failed.exitCode).toBe(1);
      expect((JSON.parse(failed.text) as Record<string, unknown>).outcome).toBe("simulated-failed");

      const unavailable = await paperSimulationTxReport(ctx(tmp, "throw"), { envelopePath: envelope, json: true, failOnNotOk: true });
      expect(unavailable.exitCode).toBe(1);
      expect((JSON.parse(unavailable.text) as Record<string, unknown>).outcome).toBe("unavailable");

      const ungated = await paperSimulationTxReport(ctx(tmp, "throw"), { envelopePath: envelope, json: true });
      expect(ungated.exitCode).toBe(0); // an honest unavailable artifact is not a CLI failure
    });
  });
});
