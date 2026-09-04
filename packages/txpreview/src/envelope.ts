/**
 * The UNSIGNED transaction envelope (`txpreview.envelope.v1`, Sprint 92).
 *
 * The contract between a transaction BUILDER (which constructs but never signs) and the
 * simulation PREVIEW (which simulates but never sends). Hard rules, all enforced here:
 *
 *   - The serialized transaction must deserialize as a `VersionedTransaction` whose signature
 *     slots are ALL zero — an envelope carrying any real signature is refused outright.
 *   - The schema is CLOSED: unknown keys and sensitive-named keys are refused; there is no
 *     field for a key, a signer, or a send instruction, and there never will be.
 *   - The fee payer is a PUBLIC key and must be the transaction's actual fee payer.
 *   - `network` is a closed set; constraints are bounded display/refusal facts.
 */

import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { isSensitiveKey, redactString } from "@soulmaker/security";

export const TX_ENVELOPE_SCHEMA_VERSION = "txpreview.envelope.v1";

export const TX_ENVELOPE_NETWORKS = ["devnet", "mainnet-beta"] as const;
export type TxEnvelopeNetwork = (typeof TX_ENVELOPE_NETWORKS)[number];

/** Serialized-transaction ceiling (bytes of base64 text). A Solana tx is ≤ 1232 raw bytes. */
export const TX_ENVELOPE_MAX_BASE64_LENGTH = 4096;

export class TxPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TxPreviewError";
  }
}

export interface UnsignedTxEnvelope {
  schemaVersion: string;
  /** Which cluster this transaction was built FOR. Closed set. */
  network: TxEnvelopeNetwork;
  /** The fee payer PUBLIC key (base58). Never a secret. */
  feePayerPublicKey: string;
  /** Base64 of the serialized UNSIGNED VersionedTransaction (all signature slots zero). */
  txBase64: string;
  /** Which builder produced this (kebab-case, e.g. "jupiter-swap-api"). */
  builderId: string;
  /** The candidate (OUTPUT) mint this envelope is about, when applicable. */
  candidateMint: string | null;
  /** S111: the swap INPUT mint (SOL for a buy; the held token for a sell). Absent in pre-S111 envelopes => null. */
  inputMint: string | null;
  /** Route caveats carried from the quote/builder (display only). */
  routeCaveats: string[];
  /** Bounded constraint facts recorded at build time (refusal evidence, not enforcement). */
  constraints: {
    maxSpendLamports: string | null;
    slippageBps: number | null;
  };
  /**
   * ISO timestamp of the quote backing this envelope (Sprint 93 freshness provenance). null for
   * quoteless envelopes (e.g. the self-transfer probe) and for pre-S93 envelopes — downstream
   * freshness checks treat null as "no quote", which can never satisfy a freshness gate.
   */
  quotedAt: string | null;
  /** Pinned honesty literals. */
  unsigned: true;
  neverSigned: true;
  phase7LiveTradingReady: false;
}

const ENVELOPE_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "network",
  "feePayerPublicKey",
  "txBase64",
  "builderId",
  "candidateMint",
  "inputMint",
  "routeCaveats",
  "constraints",
  "quotedAt",
  "unsigned",
  "neverSigned",
  "phase7LiveTradingReady",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertClosedKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, where: string): void {
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) {
      throw new TxPreviewError(`${where} carries sensitive-named field "${key}" — key material can never ride along on an envelope`);
    }
    if (!allowed.has(key)) {
      throw new TxPreviewError(`${where} carries unknown field "${key}" — the v1 envelope schema is CLOSED`);
    }
  }
}

function parsePublicKeyStrict(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TxPreviewError(`${name} must be a non-empty base58 string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > 44) {
    throw new TxPreviewError(`${name} is too long to be a public key — refusing (never paste secret key material)`);
  }
  try {
    return new PublicKey(trimmed).toBase58();
  } catch {
    throw new TxPreviewError(`${name} is not a valid base58 public key`);
  }
}

/**
 * Deserialize the envelope's transaction and prove it is UNSIGNED: every signature slot must be
 * exactly 64 zero bytes. Returns the deserialized transaction for the simulator.
 */
export function deserializeUnsignedTransaction(envelope: UnsignedTxEnvelope): VersionedTransaction {
  let raw: Buffer;
  try {
    raw = Buffer.from(envelope.txBase64, "base64");
  } catch {
    throw new TxPreviewError("envelope.txBase64 is not valid base64");
  }
  if (raw.length === 0 || raw.length > 1500) {
    throw new TxPreviewError("envelope transaction size is out of bounds for a Solana transaction");
  }
  let tx: VersionedTransaction;
  try {
    tx = VersionedTransaction.deserialize(raw);
  } catch {
    throw new TxPreviewError("envelope.txBase64 does not deserialize as a VersionedTransaction");
  }
  for (const signature of tx.signatures) {
    if (signature.length !== 64 || signature.some((b) => b !== 0)) {
      throw new TxPreviewError("envelope transaction carries a signature — a SIGNED transaction is refused at this boundary");
    }
  }
  const feePayer = tx.message.staticAccountKeys[0];
  if (feePayer === undefined || feePayer.toBase58() !== envelope.feePayerPublicKey) {
    throw new TxPreviewError("envelope.feePayerPublicKey does not match the transaction's fee payer");
  }
  return tx;
}

/** Strictly validate a value as an {@link UnsignedTxEnvelope} (including the unsigned proof). */
export function validateUnsignedTxEnvelope(value: unknown): UnsignedTxEnvelope {
  if (!isObject(value)) throw new TxPreviewError("envelope must be a JSON object");
  assertClosedKeys(value, ENVELOPE_KEYS, "envelope");
  if (value.schemaVersion !== TX_ENVELOPE_SCHEMA_VERSION) {
    throw new TxPreviewError(`envelope.schemaVersion must be "${TX_ENVELOPE_SCHEMA_VERSION}"`);
  }
  if (typeof value.network !== "string" || !(TX_ENVELOPE_NETWORKS as readonly string[]).includes(value.network)) {
    throw new TxPreviewError(`envelope.network must be one of ${TX_ENVELOPE_NETWORKS.join("|")}`);
  }
  const feePayerPublicKey = parsePublicKeyStrict(value.feePayerPublicKey, "envelope.feePayerPublicKey");
  if (typeof value.txBase64 !== "string" || value.txBase64.length === 0 || value.txBase64.length > TX_ENVELOPE_MAX_BASE64_LENGTH) {
    throw new TxPreviewError(`envelope.txBase64 must be a base64 string of at most ${TX_ENVELOPE_MAX_BASE64_LENGTH} chars`);
  }
  if (typeof value.builderId !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value.builderId)) {
    throw new TxPreviewError("envelope.builderId must be a kebab-case label");
  }
  let candidateMint: string | null = null;
  if (value.candidateMint !== undefined && value.candidateMint !== null) {
    candidateMint = parsePublicKeyStrict(value.candidateMint, "envelope.candidateMint");
  }
  let inputMint: string | null = null;
  if (value.inputMint !== undefined && value.inputMint !== null) {
    inputMint = parsePublicKeyStrict(value.inputMint, "envelope.inputMint");
  }
  if (!Array.isArray(value.routeCaveats) || value.routeCaveats.length > 20) {
    throw new TxPreviewError("envelope.routeCaveats must be an array of at most 20 strings");
  }
  const routeCaveats = value.routeCaveats.map((c, i) => {
    if (typeof c !== "string" || c.trim().length === 0 || c.length > 300) {
      throw new TxPreviewError(`envelope.routeCaveats[${i}] must be a non-empty string of at most 300 chars`);
    }
    if (redactString(c) !== c) {
      throw new TxPreviewError(`envelope.routeCaveats[${i}] carries a secret-shaped value — refused (and never echoed)`);
    }
    return c.trim();
  });
  if (!isObject(value.constraints)) throw new TxPreviewError("envelope.constraints must be an object");
  assertClosedKeys(value.constraints, new Set(["maxSpendLamports", "slippageBps"]), "envelope.constraints");
  let maxSpendLamports: string | null = null;
  if (value.constraints.maxSpendLamports !== undefined && value.constraints.maxSpendLamports !== null) {
    if (typeof value.constraints.maxSpendLamports !== "string" || !/^[0-9]{1,20}$/.test(value.constraints.maxSpendLamports)) {
      throw new TxPreviewError("envelope.constraints.maxSpendLamports must be an integer string when present");
    }
    maxSpendLamports = value.constraints.maxSpendLamports;
  }
  let slippageBps: number | null = null;
  if (value.constraints.slippageBps !== undefined && value.constraints.slippageBps !== null) {
    if (!Number.isInteger(value.constraints.slippageBps) || (value.constraints.slippageBps as number) < 0 || (value.constraints.slippageBps as number) > 10000) {
      throw new TxPreviewError("envelope.constraints.slippageBps must be an integer between 0 and 10000 when present");
    }
    slippageBps = value.constraints.slippageBps as number;
  }
  // Sprint 93 freshness provenance: optional on input (pre-S93 envelopes stay valid), always
  // present on output. A bounded, redaction-stable ISO-shaped string or null — never enforced
  // here (freshness gates live with the consumers that hold explicit operator caps).
  let quotedAt: string | null = null;
  if (value.quotedAt !== undefined && value.quotedAt !== null) {
    if (
      typeof value.quotedAt !== "string" ||
      value.quotedAt.length === 0 ||
      value.quotedAt.length > 40 ||
      redactString(value.quotedAt) !== value.quotedAt
    ) {
      throw new TxPreviewError("envelope.quotedAt must be a bounded ISO timestamp string or null when present");
    }
    quotedAt = value.quotedAt;
  }
  for (const [literal, expected] of [
    ["unsigned", true],
    ["neverSigned", true],
    ["phase7LiveTradingReady", false],
  ] as const) {
    if (value[literal] !== expected) {
      throw new TxPreviewError(`envelope.${literal} must be the literal ${String(expected)}`);
    }
  }

  const envelope: UnsignedTxEnvelope = {
    schemaVersion: TX_ENVELOPE_SCHEMA_VERSION,
    network: value.network as TxEnvelopeNetwork,
    feePayerPublicKey,
    txBase64: value.txBase64,
    builderId: value.builderId,
    candidateMint,
    inputMint,
    routeCaveats,
    constraints: { maxSpendLamports, slippageBps },
    quotedAt,
    unsigned: true,
    neverSigned: true,
    phase7LiveTradingReady: false,
  };
  // The unsigned PROOF: deserializing throws when any signature slot is non-zero.
  deserializeUnsignedTransaction(envelope);
  return envelope;
}
