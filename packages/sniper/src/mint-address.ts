/**
 * Pure, offline validation of a Solana **mint / token public key** address.
 *
 * This deliberately mirrors the safety semantics of `@soulmaker/solana`'s `parsePublicKey` — it only
 * ever accepts a *public* key and REFUSES anything that looks like secret material — but it does so
 * WITHOUT importing `@solana/web3.js`, so the sniper package stays pure and offline (no chain
 * capability, no network, no key handling). A valid 32-byte public key base58-encodes to 32–44 chars;
 * a 64-byte secret key base58-encodes to ~88 chars and is refused before it is ever decoded, so a user
 * can never paste a private key or seed phrase here and have it silently accepted.
 *
 * The base58 decode is a standard, deterministic big-endian byte accumulation (no `BigInt`, no
 * `Date.now`, no `Math.random`); a string is accepted only if it decodes to EXACTLY 32 bytes.
 */

/** Bitcoin/Solana base58 alphabet (no 0, O, I, l). */
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Max length of a base58-encoded 32-byte public key. */
export const MAX_MINT_BASE58_LEN = 44;
/** Min plausible length of a base58-encoded 32-byte key. */
export const MIN_MINT_BASE58_LEN = 32;
/** A Solana mint public key is exactly 32 bytes. */
const MINT_BYTE_LENGTH = 32;

/** Thrown when a mint address is structurally invalid or looks like secret material. */
export class InvalidMintAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMintAddressError";
  }
}

/** Build a reverse lookup once (char -> value), -1 for non-alphabet characters. */
const BASE58_VALUES: ReadonlyMap<string, number> = new Map(
  [...BASE58_ALPHABET].map((ch, i) => [ch, i]),
);

/**
 * Decode a base58 string to its raw bytes, or return null if it contains a non-base58 character.
 * Standard algorithm: accumulate big-endian, then prepend one zero byte per leading '1'.
 */
function base58Decode(input: string): Uint8Array | null {
  if (input.length === 0) return new Uint8Array(0);
  const bytes: number[] = [];
  for (const ch of input) {
    const value = BASE58_VALUES.get(ch);
    if (value === undefined) return null;
    let carry = value;
    for (let j = 0; j < bytes.length; j += 1) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Each leading '1' represents a leading zero byte.
  let leadingZeros = 0;
  for (let k = 0; k < input.length && input[k] === "1"; k += 1) leadingZeros += 1;
  const out = new Uint8Array(leadingZeros + bytes.length);
  // `bytes` is little-endian; reverse into the tail of `out` after the leading zeros.
  for (let i = 0; i < bytes.length; i += 1) {
    out[leadingZeros + i] = bytes[bytes.length - 1 - i]!;
  }
  return out;
}

/**
 * Validate a string as a Solana mint public key and return the trimmed canonical form, or throw
 * {@link InvalidMintAddressError} with a clear, non-secret-leaking message. The too-long branch never
 * echoes the input (it may be secret material).
 */
export function parseMintAddress(input: unknown): string {
  if (typeof input !== "string") {
    throw new InvalidMintAddressError("mint address must be a string");
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new InvalidMintAddressError("mint address is empty");
  }
  // Refuse anything too long to be a 32-byte public key. A 64-byte secret key base58-encodes to ~88
  // chars and would land here — we never accept it, and we never echo it back.
  if (trimmed.length > MAX_MINT_BASE58_LEN) {
    throw new InvalidMintAddressError(
      `mint address is ${trimmed.length} chars — too long to be a public key. ` +
        "Refusing (never paste a private key or seed phrase).",
    );
  }
  if (trimmed.length < MIN_MINT_BASE58_LEN) {
    throw new InvalidMintAddressError(
      `mint address is ${trimmed.length} chars — too short to be a public key`,
    );
  }
  const decoded = base58Decode(trimmed);
  if (decoded === null) {
    throw new InvalidMintAddressError(`"${trimmed}" is not valid base58`);
  }
  if (decoded.length !== MINT_BYTE_LENGTH) {
    throw new InvalidMintAddressError(
      `"${trimmed}" does not decode to a 32-byte public key (got ${decoded.length} bytes)`,
    );
  }
  return trimmed;
}

/** Non-throwing validity check. */
export function isValidMintAddress(input: unknown): boolean {
  try {
    parseMintAddress(input);
    return true;
  } catch {
    return false;
  }
}
