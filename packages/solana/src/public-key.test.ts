import { describe, it, expect } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  parsePublicKey,
  isValidPublicKey,
  publicKeyToBase58,
  InvalidPublicKeyError,
} from "./public-key.js";

// Well-known valid mainnet public keys (NOT secrets).
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

describe("parsePublicKey", () => {
  it("accepts a valid public key and round-trips it", () => {
    const key = parsePublicKey(WSOL_MINT);
    expect(key).toBeInstanceOf(PublicKey);
    expect(publicKeyToBase58(key)).toBe(WSOL_MINT);
  });

  it("accepts the system program (32-char all-ones base58)", () => {
    expect(parsePublicKey(SYSTEM_PROGRAM).toBase58()).toBe(SYSTEM_PROGRAM);
  });

  it("trims surrounding whitespace", () => {
    expect(parsePublicKey(`  ${WSOL_MINT}  `).toBase58()).toBe(WSOL_MINT);
  });

  it("rejects an empty string", () => {
    expect(() => parsePublicKey("")).toThrow(InvalidPublicKeyError);
    expect(() => parsePublicKey("   ")).toThrow(/empty/);
  });

  it("rejects an obviously invalid string", () => {
    expect(() => parsePublicKey("not-a-key!!!")).toThrow(InvalidPublicKeyError);
  });

  it("rejects a too-short string", () => {
    expect(() => parsePublicKey("abc")).toThrow(/too short/);
  });

  it("refuses secret-key-length input with a pointed message", () => {
    // An 88-char base58 blob is the length of a 64-byte SECRET key. Never accept.
    const secretLength = "5".repeat(88);
    expect(() => parsePublicKey(secretLength)).toThrow(
      /never paste a private key/i,
    );
  });
});

describe("isValidPublicKey", () => {
  it("returns true for valid keys", () => {
    expect(isValidPublicKey(WSOL_MINT)).toBe(true);
    expect(isValidPublicKey(SYSTEM_PROGRAM)).toBe(true);
  });

  it("returns false for invalid / empty / secret-length input", () => {
    expect(isValidPublicKey("")).toBe(false);
    expect(isValidPublicKey("nope")).toBe(false);
    expect(isValidPublicKey("5".repeat(88))).toBe(false);
  });
});
