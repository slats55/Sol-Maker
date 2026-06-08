/**
 * Sprint 20 SAFETY REGRESSION for the research campaign HISTORY report layer.
 *
 * The history report (`research-campaign-history.ts`) is a pure, offline, PAPER-only TREND summary
 * of an ordered set of LOCAL campaign index snapshots. This test asserts — by scanning the module's
 * own source — that it adds NO live-trading / wallet / signing / sending / network / Rust / Phase-6 /
 * Phase-7 capability, that it imports only pure modules (no fs/path/url/net/http/child_process;
 * redaction via `@soulmaker/security` is allowed), and that the file carries no NUL/CR/other
 * forbidden control character, no UTF-8 BOM, and no merge-conflict marker. It inspects raw source
 * text, so doc comments that legitimately NAME a forbidden concept (to say it is absent) are scanned
 * against CODE only (comments stripped first). Deterministic and path-stable.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** The Sprint 20 source module under test. */
const SPRINT20_FILES = ["research-campaign-history.ts"];

/**
 * Capability tokens that must never appear as an ADDED capability. Each is matched
 * case-insensitively against the source with the comment lines removed first, so prose that
 * explains "no wallet/sign/send is involved" does not trip it.
 */
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
  /\bfetch\s*\(/i,
  /\baxios\b/i,
  /\bWebSocket\b/i,
  /\bnew\s+Connection\b/,
  /\.rs["'`]/, // a Rust source reference
];

/** Strip line comments and block comments so the capability scan sees CODE, not prose. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 "); // line comments (avoid eating "https://")
}

describe("@soulmaker/backtest — Sprint 20 research campaign history safety regression", () => {
  it("adds no wallet/sign/send/network/Rust capability token in code", () => {
    const violations: string[] = [];
    for (const name of SPRINT20_FILES) {
      const code = stripComments(readFileSync(join(SRC_DIR, name), "utf8"));
      for (const token of FORBIDDEN_CAPABILITY_TOKENS) {
        if (token.test(code)) violations.push(`${name} contains forbidden token ${token}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("imports only pure, local, paper-safe modules (no fs/path/url/net/http/child_process)", () => {
    const forbidden = [
      "node:fs",
      "node:path",
      "node:url",
      "node:http",
      "node:https",
      "node:net",
      "node:child_process",
      "fs",
      "path",
      "http",
      "https",
      "ws",
      "axios",
      "@solana/web3.js",
    ];
    const violations: string[] = [];
    for (const name of SPRINT20_FILES) {
      const source = readFileSync(join(SRC_DIR, name), "utf8");
      const specifiers = [...source.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of specifiers) {
        if (forbidden.includes(spec as string)) violations.push(`${name} imports "${spec}"`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("uses no Date.now / Math.random (deterministic report generation)", () => {
    for (const name of SPRINT20_FILES) {
      const code = stripComments(readFileSync(join(SRC_DIR, name), "utf8"));
      expect(/\bDate\.now\b/.test(code), `${name} must not use Date.now`).toBe(false);
      expect(/\bMath\.random\b/.test(code), `${name} must not use Math.random`).toBe(false);
    }
  });

  it("contains no NUL/forbidden control char, no UTF-8 BOM, and no conflict marker", () => {
    for (const name of SPRINT20_FILES) {
      const raw = readFileSync(join(SRC_DIR, name), "utf8");
      expect(raw.charCodeAt(0)).not.toBe(0xfeff);
      for (let i = 0; i < raw.length; i += 1) {
        const code = raw.charCodeAt(i);
        const isAllowed = code === 0x09 || code === 0x0a || code >= 0x20;
        expect(isAllowed, `${name} has a forbidden control char (0x${code.toString(16)}) at ${i}`).toBe(true);
      }
      expect(raw.includes("\r"), `${name} must use LF line endings`).toBe(false);
      expect(/^(<{7}|={7}|>{7})/m.test(raw), `${name} has a conflict marker`).toBe(false);
    }
  });
});
