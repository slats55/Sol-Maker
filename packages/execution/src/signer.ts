/**
 * The SIGNER BOUNDARY (Sprint 92) — the only place in the entire repository where signing
 * capability exists, and it is built to be hard to misuse:
 *
 *   - There is no seed-phrase handling and never will be. The only local form accepted is the
 *     standard solana-keygen JSON byte-array file, whose PATH comes from an environment
 *     variable NAME — the path, file, and bytes are never logged, echoed, or serialized.
 *   - DEVNET-FIRST: loading a signer for mainnet-beta requires the caller to pass the ARMED
 *     mainnet live-gate result; anything else refuses.
 *   - The returned boundary object closes over the key material; `toJSON`/inspection yield a
 *     redaction marker, and the public key is the only readable identity.
 */

import { Keypair, VersionedTransaction } from "@solana/web3.js";
import type { MainnetLiveGateResult } from "./live-gate.js";

export class SignerBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignerBoundaryError";
  }
}

/** What the send path is allowed to see: an identity and one signing operation. */
export interface TransactionSigningBoundary {
  readonly kind: "local-file";
  readonly network: "devnet" | "mainnet-beta";
  readonly publicKeyBase58: string;
  /** Sign one deserialized transaction IN PLACE and return it. */
  signTransactionInPlace(transaction: VersionedTransaction): VersionedTransaction;
  /** Always the redaction marker — boundaries never serialize their secret. */
  toJSON(): string;
}

export interface LoadLocalSignerInput {
  /** The NAME of the env var that holds the keypair file PATH (never the key itself). */
  envVarName: string;
  env: Record<string, string | undefined>;
  /** Injected file reader (returns the file's utf8 text). Tests inject; the CLI passes readFileSync. */
  readFile: (path: string) => string;
  network: "devnet" | "mainnet-beta";
  /** REQUIRED for mainnet-beta: the ARMED live-gate result. Ignored for devnet. */
  mainnetLiveGate?: MainnetLiveGateResult | null;
}

const REDACTION_MARKER = "[signer-boundary: redacted]";

/**
 * Load a local keypair file through the boundary. Refusals (all SignerBoundaryError, none of
 * which ever echoes a path or byte): missing env var name/value, unreadable file, malformed
 * content, and — decisively — mainnet-beta without an ARMED fourteen-check live gate.
 */
export function loadLocalSignerBoundary(input: LoadLocalSignerInput): TransactionSigningBoundary {
  if (!/^[A-Z][A-Z0-9_]*$/.test(input.envVarName)) {
    throw new SignerBoundaryError("envVarName must be an UPPER_SNAKE_CASE environment variable NAME");
  }
  if (input.network === "mainnet-beta") {
    const gate = input.mainnetLiveGate;
    if (!gate || gate.armed !== true || gate.checks.length < 14 || gate.checks.some((c) => !c.satisfied)) {
      throw new SignerBoundaryError(
        "REFUSED: a mainnet-beta signer loads ONLY behind the ARMED fourteen-condition live gate (default state is blocked)",
      );
    }
  }
  const path = input.env[input.envVarName];
  if (typeof path !== "string" || path.trim().length === 0) {
    throw new SignerBoundaryError(`environment variable ${input.envVarName} is not set (it must hold the keypair file PATH)`);
  }
  let text: string;
  try {
    text = input.readFile(path);
  } catch {
    throw new SignerBoundaryError(`the keypair file named by ${input.envVarName} could not be read`);
  }
  let bytes: unknown;
  try {
    bytes = JSON.parse(text);
  } catch {
    throw new SignerBoundaryError("the keypair file is not valid JSON (expected the solana-keygen byte-array format)");
  }
  if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) {
    throw new SignerBoundaryError("the keypair file is not a 64-byte solana-keygen array");
  }
  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
  } catch {
    throw new SignerBoundaryError("the keypair file bytes do not form a valid keypair");
  }

  const boundary: TransactionSigningBoundary = {
    kind: "local-file",
    network: input.network,
    publicKeyBase58: keypair.publicKey.toBase58(),
    signTransactionInPlace(transaction: VersionedTransaction): VersionedTransaction {
      transaction.sign([keypair]);
      return transaction;
    },
    toJSON(): string {
      return REDACTION_MARKER;
    },
  };
  // Freeze so nothing can attach the keypair or replace the redacting serializer.
  return Object.freeze(boundary);
}

export { REDACTION_MARKER as SIGNER_REDACTION_MARKER };
