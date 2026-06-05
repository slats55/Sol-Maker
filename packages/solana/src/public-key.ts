/**
 * Public-key validation.
 *
 * This module only ever produces or validates *public* keys. It deliberately
 * REFUSES inputs that look like secret material (e.g. a 64-byte base58 secret
 * key is 87–88 chars; a valid Solana public key is 32–44 chars). A user must
 * never be able to paste a private key here and have it silently accepted.
 */

import { PublicKey } from "@solana/web3.js";

/** Max length of a base58-encoded 32-byte public key. */
const MAX_PUBKEY_BASE58_LEN = 44;
/** Min plausible length of a base58-encoded 32-byte key (all-zero key = 32 chars). */
const MIN_PUBKEY_BASE58_LEN = 32;

export class InvalidPublicKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPublicKeyError";
  }
}

/**
 * Parse a string into a `PublicKey`, or throw {@link InvalidPublicKeyError}
 * with a clear, non-secret-leaking message.
 */
export function parsePublicKey(input: string): PublicKey {
  if (typeof input !== "string") {
    throw new InvalidPublicKeyError("public key must be a string");
  }
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    throw new InvalidPublicKeyError("public key is empty");
  }

  // Refuse anything too long to be a 32-byte public key. A 64-byte secret key
  // base58-encodes to ~88 chars and would land here — we never accept it.
  if (trimmed.length > MAX_PUBKEY_BASE58_LEN) {
    throw new InvalidPublicKeyError(
      `input is ${trimmed.length} chars — too long to be a public key. ` +
        "Refusing (never paste a private key or seed phrase).",
    );
  }

  if (trimmed.length < MIN_PUBKEY_BASE58_LEN) {
    throw new InvalidPublicKeyError(
      `input is ${trimmed.length} chars — too short to be a public key`,
    );
  }

  let key: PublicKey;
  try {
    key = new PublicKey(trimmed);
  } catch {
    throw new InvalidPublicKeyError(
      `"${trimmed}" is not a valid base58 Solana public key`,
    );
  }

  // `new PublicKey` accepts byte arrays of other lengths via some inputs; for a
  // string it must decode to exactly 32 bytes. Double-check defensively.
  if (key.toBytes().length !== 32) {
    throw new InvalidPublicKeyError("decoded key is not 32 bytes");
  }

  return key;
}

/** Non-throwing validity check. */
export function isValidPublicKey(input: string): boolean {
  try {
    parsePublicKey(input);
    return true;
  } catch {
    return false;
  }
}

export function publicKeyToBase58(key: PublicKey): string {
  return key.toBase58();
}
