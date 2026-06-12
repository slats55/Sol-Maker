/**
 * The self-transfer PROBE envelope (Sprint 92).
 *
 * Builds the smallest meaningful unsigned transaction — a 1-lamport System transfer from a
 * PUBLIC fee-payer address back to itself — purely to exercise the simulation boundary
 * ("would this account be able to pay a trivial transaction on this cluster right now?").
 *
 * This is NOT the swap builder (that is a separate, separately-reviewed capability); it cannot
 * move value anywhere (sender == recipient), it is never signed, and the produced envelope goes
 * through the same strict validator as every other envelope.
 */

import { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { validateUnsignedTxEnvelope, TX_ENVELOPE_SCHEMA_VERSION, TxPreviewError } from "./envelope.js";
import type { TxEnvelopeNetwork, UnsignedTxEnvelope } from "./envelope.js";

export interface SelfTransferProbeInput {
  /** The fee payer PUBLIC key (must exist and be funded on the target cluster to simulate ok). */
  feePayerPublicKey: string;
  network: TxEnvelopeNetwork;
}

/** Build a validated, UNSIGNED 1-lamport self-transfer probe envelope. */
export function buildUnsignedSelfTransferProbe(input: SelfTransferProbeInput): UnsignedTxEnvelope {
  let feePayer: PublicKey;
  try {
    feePayer = new PublicKey(input.feePayerPublicKey);
  } catch {
    throw new TxPreviewError("probe feePayerPublicKey is not a valid base58 public key");
  }
  // Any 32-byte value works as a placeholder blockhash: the preview simulates with
  // replaceRecentBlockhash:true, so the real blockhash is substituted by the RPC.
  const placeholderBlockhash = new PublicKey(Buffer.alloc(32, 1)).toBase58();
  const message = new TransactionMessage({
    payerKey: feePayer,
    recentBlockhash: placeholderBlockhash,
    instructions: [SystemProgram.transfer({ fromPubkey: feePayer, toPubkey: feePayer, lamports: 1 })],
  }).compileToV0Message();

  return validateUnsignedTxEnvelope({
    schemaVersion: TX_ENVELOPE_SCHEMA_VERSION,
    network: input.network,
    feePayerPublicKey: feePayer.toBase58(),
    txBase64: Buffer.from(new VersionedTransaction(message).serialize()).toString("base64"),
    builderId: "self-transfer-probe",
    candidateMint: null,
    routeCaveats: ["self-transfer probe — exists only to exercise the unsigned simulation boundary; moves nothing (sender == recipient)"],
    constraints: { maxSpendLamports: "1", slippageBps: null },
    unsigned: true,
    neverSigned: true,
    phase7LiveTradingReady: false,
  });
}
