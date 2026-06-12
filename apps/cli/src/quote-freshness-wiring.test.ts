/**
 * Sprint 93 — quote freshness wired END-TO-END at the CLI layer.
 *
 * Pins:
 *   - execution:status --quote-report + --max-quote-age-ms feeds live-gate condition 9: a FRESH
 *     live fetch report satisfies quote-fresh (and ONLY that condition); stale / missing
 *     fetchedAt / future / malformed timestamps all leave it failed;
 *   - the cap is explicit: --quote-report without --max-quote-age-ms is cap-missing (NOT fresh),
 *     and --max-quote-age-ms without --quote-report refuses outright;
 *   - an operator-supplied artifact (routequote.prepared.v1) is REFUSED as a freshness source —
 *     hand-typed quotes can never satisfy live freshness;
 *   - execution:devnet:send computes the REAL quote age from the envelope's quotedAt: a stale
 *     quote refuses at the safety wall (safety-quote-stale), a missing quotedAt on a non-probe
 *     envelope refuses (safety-quote-age-missing), a future quotedAt refuses, and the quoteless
 *     self-transfer probe remains the only exception;
 *   - no quote can mean executable by itself: a fresh quote alone still leaves 13 conditions
 *     failed.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import type { SendRpc } from "@soulmaker/execution";
import { executionStatusReport, executionDevnetSendReport } from "./commands.js";

const SIGNER = Keypair.generate();
const BLOCKHASH = new PublicKey(Buffer.alloc(32, 4)).toBase58();
const NOW_ISO = "2026-06-12T12:00:00.000Z";

async function withTmpAsync<T>(fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), "quote-fresh-"));
  try {
    return await fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function writeConfig(tmp: string, extra: Record<string, unknown> = {}): void {
  writeFileSync(join(tmp, "soulmaker.config.json"), JSON.stringify({ mode: "WATCH_ONLY", ...extra }));
}

function writeFetchReport(tmp: string, fetchedAt: unknown, schemaVersion = "routequote.fetch.report.v1"): string {
  writeFileSync(join(tmp, "quote-report.json"), JSON.stringify({ schemaVersion, fetchedAt, entries: [] }));
  return "quote-report.json";
}

interface StatusJson {
  mainnetLiveGate: { armed: boolean; satisfiedCount: number; checks: Array<{ gate: string; satisfied: boolean }> };
  quoteFreshness: { verdict: string; ageMs: number | null; capMs: number | null } | null;
}

function condition9(status: StatusJson): boolean {
  const check = status.mainnetLiveGate.checks.find((c) => c.gate === "quote-fresh");
  expect(check).toBeDefined();
  return (check as { satisfied: boolean }).satisfied;
}

describe("execution:status — live-gate condition 9 from a real quote fetch report", () => {
  function statusWith(tmp: string, opts: Record<string, unknown>): { exitCode: number; status: StatusJson | null; text: string } {
    const r = executionStatusReport(
      { cwd: tmp, env: {}, now: () => NOW_ISO },
      { request: "mainnet-live", json: true, ...opts },
    );
    return { exitCode: r.exitCode, status: r.exitCode === 0 ? (JSON.parse(r.text) as StatusJson) : null, text: r.text };
  }

  it("a FRESH live fetch report satisfies condition 9 — and ONLY condition 9 (no quote means executable by itself)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const report = writeFetchReport(tmp, "2026-06-12T11:59:45.000Z");
      const { status } = statusWith(tmp, { quoteReportPath: report, maxQuoteAgeMs: "30000" });
      expect(status).not.toBeNull();
      expect(condition9(status as StatusJson)).toBe(true);
      expect((status as StatusJson).quoteFreshness).toMatchObject({ verdict: "fresh", ageMs: 15000, capMs: 30000 });
      // The gate stays BLOCKED — freshness alone arms nothing.
      expect((status as StatusJson).mainnetLiveGate.armed).toBe(false);
      expect((status as StatusJson).mainnetLiveGate.satisfiedCount).toBeLessThan(14);
    });
  });

  it("stale, missing-fetchedAt, FUTURE, and malformed timestamps all leave condition 9 failed", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const cases: Array<[unknown, string]> = [
        ["2026-06-12T11:58:00.000Z", "stale"],
        [undefined, "missing-timestamp"],
        ["2026-06-12T12:00:30.000Z", "future-timestamp"],
        ["yesterday-ish", "malformed-timestamp"],
      ];
      for (const [fetchedAt, verdict] of cases) {
        const report = writeFetchReport(tmp, fetchedAt);
        const { status } = statusWith(tmp, { quoteReportPath: report, maxQuoteAgeMs: "30000" });
        expect(status, String(verdict)).not.toBeNull();
        expect(condition9(status as StatusJson), String(verdict)).toBe(false);
        expect((status as StatusJson).quoteFreshness?.verdict).toBe(verdict);
      }
    });
  });

  it("the cap is explicit: a report without --max-quote-age-ms is cap-missing (NOT fresh)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const report = writeFetchReport(tmp, "2026-06-12T11:59:59.000Z");
      const { status } = statusWith(tmp, { quoteReportPath: report });
      expect(condition9(status as StatusJson)).toBe(false);
      expect((status as StatusJson).quoteFreshness?.verdict).toBe("cap-missing");
    });
  });

  it("--max-quote-age-ms without --quote-report refuses outright", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const { exitCode, text } = statusWith(tmp, { maxQuoteAgeMs: "30000" });
      expect(exitCode).toBe(1);
      expect(text).toContain("requires --quote-report");
    });
  });

  it("an operator-supplied routequote.prepared.v1 is REFUSED as a live-freshness source", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const report = writeFetchReport(tmp, NOW_ISO, "routequote.prepared.v1");
      const { exitCode, text } = statusWith(tmp, { quoteReportPath: report, maxQuoteAgeMs: "30000" });
      expect(exitCode).toBe(1);
      expect(text).toContain("hand-typed quotes can never satisfy live freshness");
    });
  });

  it("without any quote report, condition 9 stays honestly unsatisfied and quoteFreshness is null", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const { status } = statusWith(tmp, {});
      expect(condition9(status as StatusJson)).toBe(false);
      expect((status as StatusJson).quoteFreshness).toBeNull();
    });
  });
});

describe("execution:devnet:send — the REAL quote age from the envelope's quotedAt", () => {
  function devnetEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
      ...overrides,
    };
  }

  function sendCtx(tmp: string) {
    const keyPath = join(tmp, "devnet-signer.json");
    writeFileSync(keyPath, JSON.stringify(Array.from(SIGNER.secretKey)));
    const sendRpc: SendRpc = {
      endpointHost: "devnet.example.com",
      rpc: {
        getLatestBlockhash: async () => ({ blockhash: new PublicKey(Buffer.alloc(32, 6)).toBase58() }),
        sendRawTransaction: async () => "FakeDevnetSignature1111111111111111111111111",
      },
    };
    return {
      ctx: {
        cwd: tmp,
        env: { SOLMAKER_ENABLE_DEVNET_EXECUTION: "devnet-only", TEST_DEVNET_SIGNER: keyPath },
        createSendRpc: () => sendRpc,
        now: () => NOW_ISO,
      },
    };
  }

  async function send(tmp: string, envelope: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    writeFileSync(join(tmp, "envelope.json"), JSON.stringify(envelope));
    const { ctx } = sendCtx(tmp);
    return executionDevnetSendReport(ctx, {
      envelopePath: "envelope.json",
      signerEnvVar: "TEST_DEVNET_SIGNER",
      acknowledgeDevnetExecution: true,
      auditLog: "audit.jsonl",
      riskScore: "0",
      json: true,
      ...extra,
    });
  }

  it("a FRESH quotedAt within the cap submits (the journaled attempt shows it)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await send(tmp, devnetEnvelope({ builderId: "test-swap-builder", quotedAt: "2026-06-12T11:59:50.000Z" }));
      expect(r.exitCode, r.text.slice(0, 500)).toBe(0);
      expect((JSON.parse(r.text) as { outcome: string }).outcome).toBe("submitted");
    });
  });

  it("a STALE quotedAt refuses at the safety wall (safety-quote-stale)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await send(tmp, devnetEnvelope({ builderId: "test-swap-builder", quotedAt: "2026-06-12T11:50:00.000Z" }));
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("safety-quote-stale");
      // The refusal is journaled like every other attempt.
      const journal = readFileSync(join(tmp, "audit.jsonl"), "utf8").trim();
      expect(journal).toContain("safety-quote-stale");
    });
  });

  it("a missing quotedAt on a NON-probe envelope refuses (no quote can mean executable)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await send(tmp, devnetEnvelope({ builderId: "test-swap-builder" }));
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("safety-quote-age-missing");
    });
  });

  it("a FUTURE quotedAt refuses (clock disagreement blocks)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await send(tmp, devnetEnvelope({ builderId: "test-swap-builder", quotedAt: "2026-06-12T12:00:30.000Z" }));
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("safety-quote-age-missing");
    });
  });

  it("the quoteless self-transfer probe remains the ONLY exception", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await send(tmp, devnetEnvelope());
      expect(r.exitCode, r.text.slice(0, 500)).toBe(0);
    });
  });

  it("--max-quote-age-ms only TIGHTENS below the 60s ceiling, and an over-ceiling value refuses", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      // 5s-old quote, cap tightened to 1s -> stale.
      const stale = await send(tmp, devnetEnvelope({ builderId: "test-swap-builder", quotedAt: "2026-06-12T11:59:55.000Z" }), { maxQuoteAgeMs: "1000" });
      expect(stale.exitCode).toBe(1);
      expect(stale.text).toContain("safety-quote-stale");
      // A cap above the ceiling refuses outright (caps only tighten).
      const loose = await send(tmp, devnetEnvelope(), { maxQuoteAgeMs: "120000" });
      expect(loose.exitCode).toBe(1);
      expect(loose.text).toContain("caps only tighten");
    });
  });
});
