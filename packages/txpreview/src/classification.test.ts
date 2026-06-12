/**
 * Sprint 95 — deterministic simulation-failure classification + guidance.
 *
 * The classification is derived ONLY from the program error label and bounded logs, mapped onto
 * a CLOSED set, and every classification carries operator guidance (plain message + exact next
 * safe action). An unmatched failure stays `unclassified-error` — honest over clever.
 */

import { describe, it, expect } from "vitest";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { TX_ENVELOPE_SCHEMA_VERSION } from "./envelope.js";
import {
  classifySimulationFailure,
  simulateUnsignedEnvelope,
  TX_SIMULATION_CLASSIFICATIONS,
  TX_SIMULATION_CLASSIFICATION_GUIDANCE,
  type TxPreviewRpc,
} from "./simulate.js";

const PAYER = Keypair.generate();
const BLOCKHASH = new PublicKey(Buffer.alloc(32, 7)).toBase58();

function envelopeValue(): Record<string, unknown> {
  const message = new TransactionMessage({
    payerKey: PAYER.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [SystemProgram.transfer({ fromPubkey: PAYER.publicKey, toPubkey: PAYER.publicKey, lamports: 1 })],
  }).compileToV0Message();
  return {
    schemaVersion: TX_ENVELOPE_SCHEMA_VERSION,
    network: "mainnet-beta",
    feePayerPublicKey: PAYER.publicKey.toBase58(),
    txBase64: Buffer.from(new VersionedTransaction(message).serialize()).toString("base64"),
    builderId: "test-builder",
    candidateMint: null,
    routeCaveats: ["test caveat"],
    constraints: { maxSpendLamports: "1", slippageBps: 50 },
    unsigned: true,
    neverSigned: true,
    phase7LiveTradingReady: false,
  };
}

function fakeRpc(result: { err: unknown; logs?: string[]; unitsConsumed?: number } | "throw"): TxPreviewRpc {
  return {
    endpointHost: "fake.rpc.example",
    rpc: {
      simulateTransaction: async () => {
        if (result === "throw") throw new Error("connection refused");
        return {
          context: { slot: 333 },
          value: { err: result.err, logs: result.logs ?? [], unitsConsumed: result.unitsConsumed },
        } as never;
      },
    },
  };
}

describe("classifySimulationFailure — deterministic pattern mapping", () => {
  const cases: Array<[string, string | null, string[], string]> = [
    ["Jupiter slippage custom error", '{"InstructionError":[3,{"Custom":6001}]}', ["Program log: custom program error: 0x1771"], "slippage-or-route-error"],
    ["explicit slippage log", '{"InstructionError":[2,{"Custom":1}]}', ["Program log: Slippage tolerance exceeded"], "slippage-or-route-error"],
    ["compute budget exceeded", '{"InstructionError":[1,"ComputeBudgetExceeded"]}', [], "compute-exceeded"],
    ["CU meter log", '{"InstructionError":[1,"ProgramFailedToComplete"]}', ["Program X exceeded CUs meter at BPF instruction"], "compute-exceeded"],
    ["blockhash not found", '"BlockhashNotFound"', [], "blockhash-error"],
    ["account not found", '"AccountNotFound"', [], "account-error"],
    ["insufficient funds for fee", '"InsufficientFundsForFee"', [], "account-error"],
    ["insufficient funds log", '{"InstructionError":[0,{"Custom":1}]}', ["Transfer: insufficient funds"], "account-error"],
    ["generic instruction error", '{"InstructionError":[4,{"Custom":42}]}', ["Program log: something else"], "program-error"],
    ["unknown gibberish", "completely unrecognizable", [], "unclassified-error"],
    ["null err with no logs", null, [], "unclassified-error"],
  ];
  for (const [label, errLabel, logs, expected] of cases) {
    it(`${label} -> ${expected}`, () => {
      expect(classifySimulationFailure(errLabel, logs)).toBe(expected);
    });
  }

  it("classification is deterministic (same input, same output)", () => {
    const a = classifySimulationFailure('"AccountNotFound"', ["x"]);
    const b = classifySimulationFailure('"AccountNotFound"', ["x"]);
    expect(a).toBe(b);
  });
});

describe("guidance — every classification is operator-facing", () => {
  it("EVERY classification has a non-empty message and next safe action", () => {
    for (const classification of TX_SIMULATION_CLASSIFICATIONS) {
      const guidance = TX_SIMULATION_CLASSIFICATION_GUIDANCE[classification];
      expect(guidance, `missing guidance for ${classification}`).toBeDefined();
      expect(guidance.message.length).toBeGreaterThan(20);
      expect(guidance.nextAction.length).toBeGreaterThan(20);
    }
  });

  it("guidance never suggests bypassing or skipping a gate", () => {
    for (const classification of TX_SIMULATION_CLASSIFICATIONS) {
      const text = `${TX_SIMULATION_CLASSIFICATION_GUIDANCE[classification].message} ${TX_SIMULATION_CLASSIFICATION_GUIDANCE[classification].nextAction}`.toLowerCase();
      expect(text).not.toMatch(/bypass|force it|skip the simulation|--force-live/);
    }
  });
});

describe("simulateUnsignedEnvelope — classification rides on every report", () => {
  it("simulated-ok -> classification none", async () => {
    const report = await simulateUnsignedEnvelope(fakeRpc({ err: null, logs: ["Program ok"], unitsConsumed: 5000 }), envelopeValue());
    expect(report.outcome).toBe("simulated-ok");
    expect(report.classification).toBe("none");
    expect(report.classificationNextAction).toContain("never execution");
  });

  it("simulated-failed with slippage error -> slippage-or-route-error + guidance that refuses to raise tolerance", async () => {
    const report = await simulateUnsignedEnvelope(
      fakeRpc({ err: { InstructionError: [3, { Custom: 6001 }] }, logs: ["Program log: custom program error: 0x1771"] }),
      envelopeValue(),
    );
    expect(report.outcome).toBe("simulated-failed");
    expect(report.classification).toBe("slippage-or-route-error");
    expect(report.classificationNextAction).toContain("Never raise slippage");
  });

  it("RPC unreachable -> rpc-unavailable", async () => {
    const report = await simulateUnsignedEnvelope(fakeRpc("throw"), envelopeValue());
    expect(report.outcome).toBe("unavailable");
    expect(report.classification).toBe("rpc-unavailable");
  });

  it("malformed envelope -> envelope-refused (never simulated)", async () => {
    const report = await simulateUnsignedEnvelope(fakeRpc({ err: null }), { schemaVersion: "wrong" });
    expect(report.outcome).toBe("refused");
    expect(report.classification).toBe("envelope-refused");
  });

  it("compute exceeded -> compute-exceeded with slot + units still captured", async () => {
    const report = await simulateUnsignedEnvelope(
      fakeRpc({ err: { InstructionError: [1, "ProgramFailedToComplete"] }, logs: ["Program X exceeded CUs meter at BPF instruction"], unitsConsumed: 1400000 }),
      envelopeValue(),
    );
    expect(report.classification).toBe("compute-exceeded");
    expect(report.slot).toBe(333);
    expect(report.unitsConsumed).toBe(1400000);
  });
});
