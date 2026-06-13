import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { TX_ENVELOPE_SCHEMA_VERSION, validateUnsignedTxEnvelope } from "@soulmaker/txpreview";
import { inspectUnsignedTransactionShape } from "@soulmaker/txbuilder";
import { validateEngineTxInspectReportV1 } from "./validate-tx-inspect.js";
import { inspectTxThroughEngine } from "./tx-inspect.js";
import { createEngineProcessRunner, type EngineProcessRunner, type EngineProcessOptions, type EngineProcessResult } from "./runner.js";

const PAYER = Keypair.generate();
const BLOCKHASH = new PublicKey(Buffer.alloc(32, 7)).toBase58();

/** Build a real UNSIGNED v0 self-transfer envelope (every signature slot zero). */
function realEnvelope(network: "devnet" | "mainnet-beta" = "mainnet-beta"): Record<string, unknown> {
  const message = new TransactionMessage({
    payerKey: PAYER.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [SystemProgram.transfer({ fromPubkey: PAYER.publicKey, toPubkey: PAYER.publicKey, lamports: 1 })],
  }).compileToV0Message();
  return {
    schemaVersion: TX_ENVELOPE_SCHEMA_VERSION,
    network,
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

/** Build the engine artifact the real binary would emit for an envelope (shape via the REAL inspector). */
function engineArtifactFor(envelopeValue: Record<string, unknown>, createdAt: string | null): Record<string, unknown> {
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
    createdAt,
    caveats: ["Shape facts only — test fixture caveat."],
    notExecutable: true,
    neverSigns: true,
    neverSends: true,
    phase7LiveTradingReady: false,
  };
}

function fakeRunner(
  result: Partial<EngineProcessResult>,
  capture?: { args?: readonly string[]; opts?: EngineProcessOptions },
): EngineProcessRunner {
  return {
    run(_command, args, opts) {
      if (capture) {
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

describe("validateEngineTxInspectReportV1", () => {
  const envelope = realEnvelope();
  const artifact = engineArtifactFor(envelope, "2026-06-12T00:00:00.000Z");

  it("accepts a well-formed artifact and passes the parity wall against the real decoder", () => {
    const result = validateEngineTxInspectReportV1(JSON.parse(JSON.stringify(artifact)), envelope);
    expect(result.ok, JSON.stringify(!result.ok && result.problems)).toBe(true);
  });

  it("refuses unknown fields on the report AND the shape — both schemas are CLOSED", () => {
    const doc1 = JSON.parse(JSON.stringify(artifact)) as Record<string, unknown>;
    doc1.executable = true;
    expect(validateEngineTxInspectReportV1(doc1).ok).toBe(false);
    const doc2 = JSON.parse(JSON.stringify(artifact)) as Record<string, unknown>;
    (doc2.shape as Record<string, unknown>).feeLamports = 5000;
    expect(validateEngineTxInspectReportV1(doc2).ok).toBe(false);
  });

  it("PARITY WALL: a tampered instruction count is refused against the real decoder", () => {
    const doc = JSON.parse(JSON.stringify(artifact)) as Record<string, unknown>;
    (doc.shape as Record<string, unknown>).instructionCount = 99;
    const result = validateEngineTxInspectReportV1(doc, envelope);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toContain("disagree with the real TypeScript transaction decoder");
  });

  it("PARITY WALL: a tampered program id list is refused", () => {
    const doc = JSON.parse(JSON.stringify(artifact)) as Record<string, unknown>;
    (doc.shape as Record<string, unknown>).staticProgramIds = ["So11111111111111111111111111111111111111112"];
    const result = validateEngineTxInspectReportV1(doc, envelope);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toContain("staticProgramIds");
  });

  it("refuses when the envelope itself fails the TypeScript decoder (cannot trust the report)", () => {
    const result = validateEngineTxInspectReportV1(JSON.parse(JSON.stringify(artifact)), { schemaVersion: "wrong" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toContain("failed the TypeScript decoder");
  });

  it("refuses missing safety literals and unsorted program ids", () => {
    const literalDoc = JSON.parse(JSON.stringify(artifact)) as Record<string, unknown>;
    literalDoc.neverSigns = false;
    expect(validateEngineTxInspectReportV1(literalDoc).ok).toBe(false);
    const sortDoc = JSON.parse(JSON.stringify(artifact)) as Record<string, unknown>;
    (sortDoc.shape as Record<string, unknown>).staticProgramIds = ["zzzz", "aaaa"];
    expect(validateEngineTxInspectReportV1(sortDoc).ok).toBe(false);
  });
});

describe("inspectTxThroughEngine — IPC bridge", () => {
  const base = { cwd: "/repo", exists: () => false, env: { PATH: "/usr/bin" } };
  const envelope = realEnvelope();
  const envelopeJson = JSON.stringify(envelope);
  const okStdout = JSON.stringify(engineArtifactFor(envelope, "2026-06-12T00:00:00.000Z"), null, 2) + "\n";

  it("passes the envelope over stdin (never an argument) and validates with the parity wall", async () => {
    const capture: { args?: readonly string[]; opts?: EngineProcessOptions } = {};
    const result = await inspectTxThroughEngine({
      ...base,
      envelopeJson,
      createdAt: "2026-06-12T00:00:00.000Z",
      runner: fakeRunner({ stdout: okStdout }, capture),
    });
    expect(result.kind, JSON.stringify(result)).toBe("ok");
    if (result.kind === "ok") {
      expect(result.report.shape.versionSupported).toBe(true);
      expect(result.report.unsigned).toBe(true);
    }
    expect(capture.args).toEqual(["run", "--quiet", "-p", "solmaker-engine", "--", "tx-inspect", "--json", "--created-at", "2026-06-12T00:00:00.000Z"]);
    expect(capture.opts?.stdinData).toBe(envelopeJson);
    expect(capture.opts?.env).toEqual({ PATH: "/usr/bin" });
  });

  it("refuses oversized input, missing engine, exit 2, bad JSON, and a parity mismatch", async () => {
    const oversized = await inspectTxThroughEngine({ ...base, envelopeJson: "x".repeat(64), maxInputBytes: 32, runner: fakeRunner({}) });
    expect(oversized.kind === "refused" && oversized.reason === "input-too-large").toBe(true);

    const missing = await inspectTxThroughEngine({ ...base, envelopeJson, runner: fakeRunner({ started: false, startError: "ENOENT", exitCode: null }) });
    expect(missing.kind).toBe("unavailable");

    const refusedByEngine = await inspectTxThroughEngine({ ...base, envelopeJson, runner: fakeRunner({ exitCode: 2, stderr: "refused: envelope transaction carries a signature" }) });
    expect(refusedByEngine.kind === "refused" && refusedByEngine.reason === "engine-error").toBe(true);

    const badJson = await inspectTxThroughEngine({ ...base, envelopeJson, runner: fakeRunner({ stdout: "not json{" }) });
    expect(badJson.kind === "refused" && badJson.reason === "invalid-json").toBe(true);

    const tampered = engineArtifactFor(envelope, "2026-06-12T00:00:00.000Z");
    (tampered.shape as Record<string, unknown>).instructionCount = 42;
    const mismatch = await inspectTxThroughEngine({ ...base, envelopeJson, runner: fakeRunner({ stdout: JSON.stringify(tampered) }) });
    expect(mismatch.kind === "refused" && mismatch.reason === "schema-mismatch").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// REAL parity proof: the actual Rust binary decodes a real @solana/web3.js
// transaction and its shape facts pass the parity wall against the real
// TypeScript decoder. Skipped honestly without a prebuilt binary.
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BINARY_NAME = process.platform === "win32" ? "solmaker-engine.exe" : "solmaker-engine";
const PREBUILT_EXISTS =
  existsSync(join(REPO_ROOT, "target", "release", BINARY_NAME)) ||
  existsSync(join(REPO_ROOT, "target", "debug", BINARY_NAME));

describe("REAL Rust engine tx inspection ↔ @solana/web3.js parity", () => {
  it.skipIf(!PREBUILT_EXISTS)("the real engine's shape facts pass the parity wall against the real decoder", async () => {
    const envelope = realEnvelope("devnet");
    const result = await inspectTxThroughEngine({
      cwd: REPO_ROOT,
      envelopeJson: JSON.stringify(envelope),
      createdAt: "2026-06-12T00:00:00.000Z",
      runner: createEngineProcessRunner(),
    });
    expect(result.kind, JSON.stringify(result)).toBe("ok");
    if (result.kind !== "ok") return;
    const expected = inspectUnsignedTransactionShape(validateUnsignedTxEnvelope(envelope));
    expect(result.report.shape.version).toEqual(expected.version);
    expect(result.report.shape.instructionCount).toBe(expected.instructionCount);
    expect(result.report.shape.staticProgramIds).toEqual(expected.staticProgramIds);
    expect(result.report.shape.blockhashPresent).toBe(expected.blockhashPresent);
  });

  it.skipIf(!PREBUILT_EXISTS)("the real engine REFUSES a signed transaction with exit 2", async () => {
    const envelope = realEnvelope();
    // Flip a signature byte to non-zero by re-serializing a signed tx.
    const message = new TransactionMessage({
      payerKey: PAYER.publicKey,
      recentBlockhash: BLOCKHASH,
      instructions: [SystemProgram.transfer({ fromPubkey: PAYER.publicKey, toPubkey: PAYER.publicKey, lamports: 1 })],
    }).compileToV0Message();
    const tx = new VersionedTransaction(message);
    tx.sign([PAYER]);
    envelope.txBase64 = Buffer.from(tx.serialize()).toString("base64");
    const result = await inspectTxThroughEngine({
      cwd: REPO_ROOT,
      envelopeJson: JSON.stringify(envelope),
      runner: createEngineProcessRunner(),
    });
    expect(result.kind).toBe("refused");
    if (result.kind === "refused") {
      expect(result.reason).toBe("engine-error");
      expect(result.detail).toContain("signature");
    }
  });
});
