/**
 * Sprint 95 — post-build shape inspection, the refusal-guidance taxonomy, the Token-2022
 * blocker gate, and the txbuild.report.v1 artifact.
 */

import { describe, it, expect } from "vitest";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { validateUnsignedTxEnvelope } from "@soulmaker/txpreview";
import type { UnsignedTxEnvelope } from "@soulmaker/txpreview";
import {
  BUILD_REFUSAL_CODES,
  BUILD_REFUSAL_GUIDANCE,
  TOKEN2022_BUILD_BLOCKER_FLAG_IDS,
  evaluateBuildRefusals,
  type BuildSwapRequest,
} from "./refusals.js";
import { evaluateTxShapeRefusals, inspectUnsignedTransactionShape, type TxShapeFacts } from "./inspect.js";
import { composeTxBuildReport, TXBUILD_REPORT_SCHEMA_VERSION } from "./report.js";

const WALLET = Keypair.generate();
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const BLOCKHASH = new PublicKey(Buffer.alloc(32, 3)).toBase58();

function cleanRequest(overrides: Partial<BuildSwapRequest> = {}): BuildSwapRequest {
  return {
    candidateMint: USDC,
    inputMint: WSOL,
    amountRaw: "10000000",
    slippageBps: 50,
    walletPublicKey: WALLET.publicKey.toBase58(),
    network: "mainnet-beta",
    executionMode: "mainnet-dry-run",
    killSwitchActive: false,
    risk: { score: 10, decision: "PASS_FOR_PAPER_EVALUATION" },
    controls: { maxSpendLamports: "100000000", slippageCapBps: 100, riskScoreCap: 30 },
    ...overrides,
  };
}

function selfTransferEnvelope(): UnsignedTxEnvelope {
  const message = new TransactionMessage({
    payerKey: WALLET.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [SystemProgram.transfer({ fromPubkey: WALLET.publicKey, toPubkey: WALLET.publicKey, lamports: 1 })],
  }).compileToV0Message();
  return validateUnsignedTxEnvelope({
    schemaVersion: "txpreview.envelope.v1",
    network: "mainnet-beta",
    feePayerPublicKey: WALLET.publicKey.toBase58(),
    txBase64: Buffer.from(new VersionedTransaction(message).serialize()).toString("base64"),
    builderId: "jupiter-swap-api",
    candidateMint: USDC,
    routeCaveats: ["test"],
    constraints: { maxSpendLamports: "100000000", slippageBps: 50 },
    unsigned: true,
    neverSigned: true,
    phase7LiveTradingReady: false,
  });
}

describe("BUILD_REFUSAL_GUIDANCE — the taxonomy is complete and operator-facing", () => {
  it("EVERY refusal code has guidance with a non-empty message and next safe action", () => {
    for (const code of BUILD_REFUSAL_CODES) {
      const guidance = BUILD_REFUSAL_GUIDANCE[code];
      expect(guidance, `missing guidance for ${code}`).toBeDefined();
      expect(guidance.message.length).toBeGreaterThan(20);
      expect(guidance.nextAction.length).toBeGreaterThan(20);
    }
  });

  it("guidance never tells an operator to bypass, force, or override a gate", () => {
    for (const code of BUILD_REFUSAL_CODES) {
      const text = `${BUILD_REFUSAL_GUIDANCE[code].message} ${BUILD_REFUSAL_GUIDANCE[code].nextAction}`.toLowerCase();
      expect(text).not.toMatch(/bypass|--force-live|disable the gate|skip the check/);
    }
  });

  it("the closed code set includes the S95 additions", () => {
    expect(BUILD_REFUSAL_CODES).toContain("build-refused-token2022-blocker");
    expect(BUILD_REFUSAL_CODES).toContain("build-refused-quote-future");
    expect(BUILD_REFUSAL_CODES).toContain("build-refused-unsupported-transaction");
    expect(BUILD_REFUSAL_CODES).toContain("build-refused-unsupported-instruction");
  });
});

describe("Token-2022 blocker gate (pre-network)", () => {
  const codes = (request: BuildSwapRequest): string[] => evaluateBuildRefusals(request).map((r) => r.code);

  for (const blockerId of TOKEN2022_BUILD_BLOCKER_FLAG_IDS) {
    it(`risk flag ${blockerId} -> build-refused-token2022-blocker`, () => {
      const all = codes(cleanRequest({ risk: { score: 10, decision: "CAUTION", flags: [{ id: blockerId, severity: "critical" }] } }));
      expect(all).toContain("build-refused-token2022-blocker");
    });
  }

  it("non-blocker flags (e.g. metadata-pointer-present) do NOT trip the gate", () => {
    const all = codes(
      cleanRequest({ risk: { score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [{ id: "metadata-pointer-present", severity: "low" }, { id: "token-2022-program", severity: "medium" }] } }),
    );
    expect(all).not.toContain("build-refused-token2022-blocker");
  });

  it("absent flags never trip the gate (score/decision gates still apply)", () => {
    expect(codes(cleanRequest())).toEqual([]);
  });

  it("the blocker refusal names the exact flags", () => {
    const refusals = evaluateBuildRefusals(
      cleanRequest({ risk: { score: 10, decision: "CAUTION", flags: [{ id: "transfer-hook-present", severity: "critical" }, { id: "permanent-delegate-present", severity: "critical" }] } }),
    );
    const blocker = refusals.find((r) => r.code === "build-refused-token2022-blocker");
    expect(blocker?.detail).toContain("transfer-hook-present");
    expect(blocker?.detail).toContain("permanent-delegate-present");
  });
});

describe("program allowlist validation (pre-network)", () => {
  const codes = (request: BuildSwapRequest): string[] => evaluateBuildRefusals(request).map((r) => r.code);
  const controls = { maxSpendLamports: "100000000", slippageCapBps: 100, riskScoreCap: 30 };

  it("null / absent allowlist gates nothing", () => {
    expect(codes(cleanRequest({ controls: { ...controls, allowedPrograms: null } }))).toEqual([]);
  });

  it("an EMPTY allowlist refuses (it would allow nothing — operator error)", () => {
    expect(codes(cleanRequest({ controls: { ...controls, allowedPrograms: [] } }))).toContain("build-refused-unsupported-instruction");
  });

  it("a malformed allowlist entry refuses (a broken allowlist gates nothing)", () => {
    expect(codes(cleanRequest({ controls: { ...controls, allowedPrograms: ["not-base58!!"] } }))).toContain("build-refused-unsupported-instruction");
  });

  it("a valid allowlist passes the pre-network checks", () => {
    expect(codes(cleanRequest({ controls: { ...controls, allowedPrograms: [SYSTEM_PROGRAM] } }))).toEqual([]);
  });
});

describe("inspectUnsignedTransactionShape — decoded SHAPE facts", () => {
  it("reads version, blockhash presence, instruction count, and static program ids", () => {
    const facts = inspectUnsignedTransactionShape(selfTransferEnvelope());
    expect(facts.version).toBe(0);
    expect(facts.versionSupported).toBe(true);
    expect(facts.blockhashPresent).toBe(true);
    expect(facts.instructionCount).toBe(1);
    expect(facts.staticProgramIds).toEqual([SYSTEM_PROGRAM]);
    expect(facts.addressTableLookupCount).toBe(0);
    expect(facts.unresolvableProgramIdCount).toBe(0);
  });

  it("a ZERO blockhash is reported as absent", () => {
    const message = new TransactionMessage({
      payerKey: WALLET.publicKey,
      recentBlockhash: SYSTEM_PROGRAM, // base58 of 32 zero bytes — the placeholder
      instructions: [SystemProgram.transfer({ fromPubkey: WALLET.publicKey, toPubkey: WALLET.publicKey, lamports: 1 })],
    }).compileToV0Message();
    const envelope = validateUnsignedTxEnvelope({
      ...selfTransferEnvelope(),
      txBase64: Buffer.from(new VersionedTransaction(message).serialize()).toString("base64"),
    });
    expect(inspectUnsignedTransactionShape(envelope).blockhashPresent).toBe(false);
  });
});

describe("evaluateTxShapeRefusals — the post-build gate", () => {
  const goodFacts = (): TxShapeFacts => inspectUnsignedTransactionShape(selfTransferEnvelope());

  it("good facts with no allowlist: zero refusals", () => {
    expect(evaluateTxShapeRefusals(goodFacts(), null)).toEqual([]);
    expect(evaluateTxShapeRefusals(goodFacts(), undefined)).toEqual([]);
  });

  it("missing blockhash -> build-refused-unsupported-transaction", () => {
    const refusals = evaluateTxShapeRefusals({ ...goodFacts(), blockhashPresent: false });
    expect(refusals.map((r) => r.code)).toContain("build-refused-unsupported-transaction");
  });

  it("unsupported version -> build-refused-unsupported-transaction", () => {
    const refusals = evaluateTxShapeRefusals({ ...goodFacts(), version: 7, versionSupported: false });
    expect(refusals.map((r) => r.code)).toContain("build-refused-unsupported-transaction");
  });

  it("allowlisted program passes; off-list program refuses and is NAMED", () => {
    expect(evaluateTxShapeRefusals(goodFacts(), [SYSTEM_PROGRAM])).toEqual([]);
    const refusals = evaluateTxShapeRefusals(goodFacts(), [USDC]);
    expect(refusals.map((r) => r.code)).toContain("build-refused-unsupported-instruction");
    expect(refusals[0]?.detail).toContain(SYSTEM_PROGRAM);
  });

  it("ALT-loaded (unresolvable) program ids refuse HONESTLY while an allowlist is in force", () => {
    const refusals = evaluateTxShapeRefusals({ ...goodFacts(), unresolvableProgramIdCount: 2 }, [SYSTEM_PROGRAM]);
    expect(refusals.map((r) => r.code)).toContain("build-refused-unsupported-instruction");
    expect(refusals[0]?.detail).toContain("address-lookup table");
  });

  it("without an allowlist, ALT-loaded program ids do NOT refuse (the default, unchanged)", () => {
    expect(evaluateTxShapeRefusals({ ...goodFacts(), unresolvableProgramIdCount: 2 }, null)).toEqual([]);
  });
});

describe("composeTxBuildReport — txbuild.report.v1", () => {
  const NOW = "2026-06-12T00:00:00.000Z";

  it("a refused attempt: outcome refused, every refusal joined to guidance", () => {
    const request = cleanRequest({ risk: { score: 10, decision: "REJECT" } });
    const refusals = evaluateBuildRefusals(request);
    const report = composeTxBuildReport({ request, builderId: "jupiter-swap-api", endpointHost: "lite-api.jup.ag", attemptedAt: NOW, refusals });
    expect(report.schemaVersion).toBe(TXBUILD_REPORT_SCHEMA_VERSION);
    expect(report.outcome).toBe("refused");
    expect(report.refusals.length).toBeGreaterThan(0);
    for (const r of report.refusals) {
      expect(r.message.length).toBeGreaterThan(20);
      expect(r.nextAction.length).toBeGreaterThan(20);
    }
    expect(report.quoteFacts).toBeNull();
    expect(report.txFacts).toBeNull();
    expect(report.envelopeRef).toBeNull();
    expect(report.neverSigns).toBe(true);
    expect(report.neverSends).toBe(true);
    expect(report.phase7LiveTradingReady).toBe(false);
  });

  it("a built attempt: outcome built, quote + shape facts and the envelope ref carried", () => {
    const request = cleanRequest();
    const report = composeTxBuildReport({
      request,
      builderId: "jupiter-swap-api",
      endpointHost: "lite-api.jup.ag",
      attemptedAt: NOW,
      refusals: [],
      quoteFacts: { inAmountRaw: "10000000", outAmountRaw: "42", priceImpactPct: "0.1", contextSlot: 1, quotedAt: NOW },
      txFacts: inspectUnsignedTransactionShape(selfTransferEnvelope()),
      envelopeRef: "envelope.json",
    });
    expect(report.outcome).toBe("built");
    expect(report.refusals).toEqual([]);
    expect(report.quoteFacts?.inAmountRaw).toBe("10000000");
    expect(report.txFacts?.blockhashPresent).toBe(true);
    expect(report.envelopeRef).toBe("envelope.json");
    expect(report.requestSummary.candidateMint).toBe(USDC);
    expect(report.requestSummary.programAllowlistActive).toBe(false);
  });

  it("deterministic: the same input composes byte-identical reports", () => {
    const request = cleanRequest({ risk: { score: 99, decision: "CAUTION" } });
    const a = composeTxBuildReport({ request, builderId: "b", endpointHost: "h", attemptedAt: NOW, refusals: evaluateBuildRefusals(request) });
    const b = composeTxBuildReport({ request, builderId: "b", endpointHost: "h", attemptedAt: NOW, refusals: evaluateBuildRefusals(request) });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("the report never carries a transaction body or key-shaped fields", () => {
    const report = composeTxBuildReport({ request: cleanRequest(), builderId: "b", endpointHost: "h", attemptedAt: NOW, refusals: [] });
    const text = JSON.stringify(report);
    expect(text).not.toContain("txBase64");
    expect(text.toLowerCase()).not.toMatch(/"(secret|seed|private|mnemonic|keypair)/);
  });
});
