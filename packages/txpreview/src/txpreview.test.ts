import { describe, it, expect } from "vitest";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  validateUnsignedTxEnvelope,
  deserializeUnsignedTransaction,
  TX_ENVELOPE_SCHEMA_VERSION,
} from "./envelope.js";
import { buildUnsignedSelfTransferProbe } from "./probe.js";
import { simulateUnsignedEnvelope, formatTxSimulationReport, type TxPreviewRpc } from "./simulate.js";

// NOTE ON THIS TEST FILE: `Keypair` appears HERE ONLY to fabricate a signed transaction that the
// production code must REFUSE, and to derive throwaway public keys. The production source is
// scanned by package-safety.test.ts and contains no Keypair/sign/send capability.

const PAYER = Keypair.generate();
const DEST = Keypair.generate().publicKey;
const BLOCKHASH = new PublicKey(Buffer.alloc(32, 7)).toBase58(); // any 32-byte base58 works for an unsigned message

function unsignedTransferTx(): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: PAYER.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [SystemProgram.transfer({ fromPubkey: PAYER.publicKey, toPubkey: DEST, lamports: 1 })],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

function envelopeValue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: TX_ENVELOPE_SCHEMA_VERSION,
    network: "devnet",
    feePayerPublicKey: PAYER.publicKey.toBase58(),
    txBase64: Buffer.from(unsignedTransferTx().serialize()).toString("base64"),
    builderId: "test-builder",
    candidateMint: null,
    routeCaveats: ["test caveat"],
    constraints: { maxSpendLamports: "1", slippageBps: 50 },
    unsigned: true,
    neverSigned: true,
    phase7LiveTradingReady: false,
    ...overrides,
  };
}

describe("txpreview.envelope.v1 — validation (fail-closed)", () => {
  it("accepts a well-formed unsigned envelope", () => {
    const envelope = validateUnsignedTxEnvelope(envelopeValue());
    expect(envelope.network).toBe("devnet");
    expect(envelope.unsigned).toBe(true);
    const tx = deserializeUnsignedTransaction(envelope);
    expect(tx.signatures.every((s) => s.every((b) => b === 0))).toBe(true);
  });

  it("REFUSES a transaction carrying any real signature", () => {
    const tx = unsignedTransferTx();
    tx.sign([PAYER]); // fabricate the forbidden case
    const signed = envelopeValue({ txBase64: Buffer.from(tx.serialize()).toString("base64") });
    expect(() => validateUnsignedTxEnvelope(signed)).toThrowError(/SIGNED transaction is refused/);
  });

  it("REFUSES sensitive-named keys, unknown keys, and forbidden literals", () => {
    expect(() => validateUnsignedTxEnvelope(envelopeValue({ privateKey: "x" }))).toThrowError(/sensitive-named/);
    expect(() => validateUnsignedTxEnvelope(envelopeValue({ sendNow: true }))).toThrowError(/CLOSED/);
    expect(() => validateUnsignedTxEnvelope(envelopeValue({ phase7LiveTradingReady: true }))).toThrowError(/literal false/);
    expect(() => validateUnsignedTxEnvelope(envelopeValue({ unsigned: false }))).toThrowError(/literal true/);
  });

  it("REFUSES network outside the closed set, mismatched fee payer, and secret-length keys", () => {
    expect(() => validateUnsignedTxEnvelope(envelopeValue({ network: "mainnet-live" }))).toThrowError(/network/);
    expect(() => validateUnsignedTxEnvelope(envelopeValue({ feePayerPublicKey: DEST.toBase58() }))).toThrowError(/fee payer/);
    expect(() => validateUnsignedTxEnvelope(envelopeValue({ feePayerPublicKey: "5".repeat(88) }))).toThrowError(/never paste/);
  });

  it("REFUSES oversized and undecodable transactions", () => {
    expect(() => validateUnsignedTxEnvelope(envelopeValue({ txBase64: "A".repeat(5000) }))).toThrowError(/at most/);
    expect(() => validateUnsignedTxEnvelope(envelopeValue({ txBase64: "not-base64!!" }))).toThrowError(/deserialize|base64/);
  });

  it("REFUSES a secret-shaped route caveat without echoing it", () => {
    const blob = "5".repeat(88);
    expect(() => validateUnsignedTxEnvelope(envelopeValue({ routeCaveats: [blob] }))).toThrowError(/secret-shaped/);
    try {
      validateUnsignedTxEnvelope(envelopeValue({ routeCaveats: [blob] }));
    } catch (err) {
      expect((err as Error).message).not.toContain(blob);
    }
  });
});

function fakePreview(
  behavior: "ok" | "program-error" | "throw",
): TxPreviewRpc {
  return {
    endpointHost: "rpc.example.com",
    rpc: {
      simulateTransaction: async (_tx, config) => {
        // The boundary contract itself: these flags are what make signerless simulation possible.
        expect(config.sigVerify).toBe(false);
        expect(config.replaceRecentBlockhash).toBe(true);
        if (behavior === "throw") throw new Error("ECONNREFUSED");
        if (behavior === "program-error") {
          return {
            context: { slot: 42, apiVersion: "x" },
            value: { err: { InstructionError: [0, "Custom"] }, logs: ["Program failed"], unitsConsumed: 200, accounts: null, returnData: null },
          } as never;
        }
        return {
          context: { slot: 42, apiVersion: "x" },
          value: { err: null, logs: ["Program 11111111111111111111111111111111 invoke [1]", "Program success"], unitsConsumed: 150, accounts: null, returnData: null },
        } as never;
      },
    },
  };
}

describe("buildUnsignedSelfTransferProbe", () => {
  it("builds a validated unsigned probe that moves nothing (sender == recipient)", () => {
    const probe = buildUnsignedSelfTransferProbe({ feePayerPublicKey: PAYER.publicKey.toBase58(), network: "devnet" });
    expect(probe.builderId).toBe("self-transfer-probe");
    expect(probe.constraints.maxSpendLamports).toBe("1");
    const tx = deserializeUnsignedTransaction(probe);
    expect(tx.signatures.every((s) => s.every((b) => b === 0))).toBe(true);
    expect(() => validateUnsignedTxEnvelope(probe)).not.toThrow();
  });

  it("refuses an invalid or secret-length fee payer", () => {
    expect(() => buildUnsignedSelfTransferProbe({ feePayerPublicKey: "nope", network: "devnet" })).toThrowError(/base58/);
    expect(() => buildUnsignedSelfTransferProbe({ feePayerPublicKey: "5".repeat(88), network: "devnet" })).toThrowError(/base58|never paste/);
  });
});

describe("simulateUnsignedEnvelope — closed outcomes", () => {
  it("simulated-ok: success carries logs/units/slot and the non-readiness caveats", async () => {
    const report = await simulateUnsignedEnvelope(fakePreview("ok"), envelopeValue(), { clock: () => "2026-06-12T05:00:00.000Z" });
    expect(report.outcome).toBe("simulated-ok");
    expect(report.unitsConsumed).toBe(150);
    expect(report.slot).toBe(42);
    expect(report.logs).toHaveLength(2);
    expect(report.errLabel).toBeNull();
    expect(report.simulatedAt).toBe("2026-06-12T05:00:00.000Z");
    // simulated-ok is NEVER live readiness — pinned literals + caveat text.
    expect(report.phase7LiveTradingReady).toBe(false);
    expect(report.neverSigns).toBe(true);
    expect(report.neverSends).toBe(true);
    expect(report.caveats.join("\n")).toContain("never live-trading readiness");
  });

  it("simulated-failed: a program error stays failed with the err label", async () => {
    const report = await simulateUnsignedEnvelope(fakePreview("program-error"), envelopeValue());
    expect(report.outcome).toBe("simulated-failed");
    expect(report.errLabel).toContain("InstructionError");
  });

  it("unavailable: a transport failure never throws", async () => {
    const report = await simulateUnsignedEnvelope(fakePreview("throw"), envelopeValue());
    expect(report.outcome).toBe("unavailable");
    expect(report.errLabel).toContain("unreachable");
  });

  it("refused: an invalid envelope (e.g. signed) maps to refused without reaching the RPC", async () => {
    const tx = unsignedTransferTx();
    tx.sign([PAYER]);
    const neverCallRpc: TxPreviewRpc = {
      endpointHost: "rpc.example.com",
      rpc: {
        simulateTransaction: async () => {
          throw new Error("MUST NOT BE CALLED");
        },
      },
    };
    const report = await simulateUnsignedEnvelope(neverCallRpc, envelopeValue({ txBase64: Buffer.from(tx.serialize()).toString("base64") }));
    expect(report.outcome).toBe("refused");
    expect(report.errLabel).toContain("SIGNED transaction is refused");
  });

  it("formats a redacted summary that never claims readiness", async () => {
    const report = await simulateUnsignedEnvelope(fakePreview("ok"), envelopeValue());
    const text = formatTxSimulationReport(report);
    expect(text).toContain("UNSIGNED TRANSACTION SIMULATION REPORT");
    expect(text).toContain("simulated-ok");
    expect(text).toContain("CAVEAT:");
    expect(text).not.toMatch(/live-ready|ready-to-trade|"executable"/i);
  });
});
