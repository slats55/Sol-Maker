/**
 * Sprint 54 SAFETY REGRESSION for the SNIPER SECRETS POLICY layer.
 *
 * The policy artifact (`secrets-policy.ts`) stores NO secret and grants NOTHING. This test scans the
 * module's own source. One NARROW exception mirrors the package boundary test: the single
 * SECRET_BEARING_KEY declaration line carries the DETECTOR regex whose literal necessarily names the
 * things it refuses — only that line is excluded, and the test fails if it disappears.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const FILE = "secrets-policy.ts";

const FORBIDDEN_CAPABILITY_TOKENS: readonly RegExp[] = [
  /\bprivateKey\b/i,
  /\bsecretKey\b/i,
  /\bmnemonic\b/i,
  /\bseedPhrase\b/i,
  /\bKeypair\b/,
  /\bsignTransaction\b/i,
  /\bsendTransaction\b/i,
  /\bsimulateTransaction\b/i,
  /\bbuildTransaction\b/i,
  /\bVersionedTransaction\b/,
  /\bTransactionInstruction\b/,
  /\bfetch\s*\(/i,
  /\baxios\b/i,
  /\bWebSocket\b/i,
  /\bnew\s+Connection\b/,
  /\.rs["'`]/,
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

function stripDetectorLine(code: string): string {
  const lines = code.split("\n");
  expect(lines.some((l) => l.includes("SECRET_BEARING_KEY")), "the detector declaration must exist").toBe(true);
  return lines.filter((l) => !l.includes("SECRET_BEARING_KEY")).join("\n");
}

describe("@soulmaker/sniper — Sprint 54 secrets policy safety regression", () => {
  it("outside the single detector line, contains no capability token", () => {
    const code = stripDetectorLine(stripComments(readFileSync(join(SRC_DIR, FILE), "utf8")));
    const violations: string[] = [];
    for (const token of FORBIDDEN_CAPABILITY_TOKENS) {
      if (token.test(code)) violations.push(`${FILE} contains forbidden token ${token}`);
    }
    expect(violations).toEqual([]);
  });

  it("imports only pure, local, paper-safe modules", () => {
    const forbidden = [
      "node:fs", "node:path", "node:url", "node:http", "node:https", "node:net", "node:child_process",
      "fs", "path", "http", "https", "ws", "axios", "@solana/web3.js", "@solana/spl-token", "@soulmaker/solana",
    ];
    const source = readFileSync(join(SRC_DIR, FILE), "utf8");
    const specifiers = [...source.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]);
    const violations = specifiers.filter((s) => forbidden.includes(s as string) || (s as string).startsWith("@solana/"));
    expect(violations).toEqual([]);
  });

  it("uses no Date.now / Math.random (deterministic, no wall-clock)", () => {
    const code = stripComments(readFileSync(join(SRC_DIR, FILE), "utf8"));
    expect(/\bDate\.now\b/.test(code)).toBe(false);
    expect(/\bMath\.random\b/.test(code)).toBe(false);
  });

  it("contains no NUL/forbidden control char, no UTF-8 BOM, and no conflict marker", () => {
    const raw = readFileSync(join(SRC_DIR, FILE), "utf8");
    expect(raw.charCodeAt(0)).not.toBe(0xfeff);
    for (let i = 0; i < raw.length; i += 1) {
      const code = raw.charCodeAt(i);
      const isAllowed = code === 0x09 || code === 0x0a || code >= 0x20;
      expect(isAllowed, `${FILE} has a forbidden control char (0x${code.toString(16)}) at ${i}`).toBe(true);
    }
    expect(raw.includes("\r")).toBe(false);
    expect(/^(<{7}|={7}|>{7})/m.test(raw)).toBe(false);
  });

  it("the six core rules and storesNoSecretMaterial are literals in source (never computed)", () => {
    const source = stripComments(readFileSync(join(SRC_DIR, FILE), "utf8"));
    for (const field of [
      "storesNoSecretMaterial",
      "forbidMainWalletUse",
      "forbidRecoveryWordsStorage",
      "forbidKeyMaterialLogging",
      "requireBurnerIsolationForLive",
      "requireRedaction",
      "requireExplicitDangerousOptInForLive",
    ]) {
      const assignments = [...source.matchAll(new RegExp(`${field}\\s*:\\s*([a-zA-Z]+)`, "g"))].map((m) => m[1] as string);
      expect(assignments.length, `${field} must appear in source`).toBeGreaterThan(0);
      for (const a of assignments) expect(a, `${field} must only ever be the literal true`).toBe("true");
    }
  });
});
