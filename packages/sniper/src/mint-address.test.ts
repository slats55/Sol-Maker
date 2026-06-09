/**
 * Tests for the pure mint-address validator. Uses real, well-known Solana mint public keys as
 * deterministic fixtures (no network) and asserts the secret-length / private-key-like REFUSAL.
 */

import { describe, it, expect } from "vitest";
import {
  parseMintAddress,
  isValidMintAddress,
  InvalidMintAddressError,
  MAX_MINT_BASE58_LEN,
} from "./mint-address.js";

// Real, well-known Solana mints / program ids (all decode to exactly 32 bytes).
const SYSTEM_PROGRAM = "11111111111111111111111111111111"; // 32 chars, 32 zero bytes
const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

describe("parseMintAddress — valid", () => {
  it("accepts well-known 32-byte mint public keys", () => {
    for (const m of [SYSTEM_PROGRAM, WRAPPED_SOL, USDC, TOKEN_PROGRAM]) {
      expect(parseMintAddress(m)).toBe(m);
      expect(isValidMintAddress(m)).toBe(true);
    }
  });

  it("trims surrounding whitespace and returns the canonical form", () => {
    expect(parseMintAddress(`  ${USDC}  `)).toBe(USDC);
  });
});

describe("parseMintAddress — refuses secret / invalid input", () => {
  it("refuses input too long to be a public key WITHOUT echoing it (possible secret)", () => {
    const secretLike = "z".repeat(88); // a 64-byte secret key base58-encodes to ~88 chars
    let message = "";
    try {
      parseMintAddress(secretLike);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/too long to be a public key/);
    expect(message).toMatch(/never paste a private key or seed phrase/i);
    expect(message).not.toContain(secretLike); // never echo the secret
    expect(isValidMintAddress(secretLike)).toBe(false);
  });

  it("refuses input too short to be a public key", () => {
    expect(() => parseMintAddress("abc")).toThrow(/too short/);
  });

  it("refuses a non-base58 character within an otherwise plausible length", () => {
    const withZero = `${"1".repeat(31)}O`; // 32 chars but contains 'O' (not in base58)
    expect(() => parseMintAddress(withZero)).toThrow(/not valid base58/);
  });

  it("refuses a base58 string that decodes to the wrong byte length", () => {
    const fortyFourOnes = "1".repeat(MAX_MINT_BASE58_LEN); // 44 zero bytes, not 32
    expect(() => parseMintAddress(fortyFourOnes)).toThrow(/does not decode to a 32-byte public key/);
  });

  it("refuses an empty string and a non-string", () => {
    expect(() => parseMintAddress("")).toThrow(/empty/);
    expect(() => parseMintAddress("   ")).toThrow(/empty/);
    expect(() => parseMintAddress(123 as unknown as string)).toThrow(InvalidMintAddressError);
    expect(isValidMintAddress(null)).toBe(false);
  });
});
