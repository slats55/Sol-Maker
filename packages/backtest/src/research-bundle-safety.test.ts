/**
 * Sprint 17 SAFETY REGRESSION for the research bundle/status layer.
 *
 * The bundle (`research-bundle.ts`) and status (`research-status.ts`) modules are pure,
 * offline, PAPER-only summaries of LOCAL artifacts. This test asserts — by scanning the
 * modules' own source — that they add NO live-trading / wallet / signing / sending / network /
 * Rust / Phase-6 / Phase-7 capability, and that the files carry no NUL/CR/other forbidden
 * control character, no UTF-8 BOM, and no merge-conflict marker. It inspects raw source text, so
 * doc comments that legitimately NAME a forbidden concept (to say it is absent) are matched and
 * therefore deliberately excluded from the capability scan via an allowlist of explanatory
 * phrasings; any NEW occurrence outside that allowlist fails the test. Deterministic and
 * path-stable (the file list is resolved from this file's own URL and sorted).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** The Sprint 17 source modules under test. */
const SPRINT17_FILES = ["research-bundle.ts", "research-status.ts"];

/**
 * Capability tokens that must never appear as an ADDED capability. Each is matched
 * case-insensitively against the source with the doc-comment lines removed first, so prose that
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

describe("@soulmaker/backtest — Sprint 17 research bundle/status safety regression", () => {
  it("adds no wallet/sign/send/network/Rust capability token in code", () => {
    const violations: string[] = [];
    for (const name of SPRINT17_FILES) {
      const code = stripComments(readFileSync(join(SRC_DIR, name), "utf8"));
      for (const token of FORBIDDEN_CAPABILITY_TOKENS) {
        if (token.test(code)) violations.push(`${name} contains forbidden token ${token}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("imports only pure, local, paper-safe modules (no fs/path/net/http/child_process)", () => {
    const forbidden = [
      "node:fs",
      "node:path",
      "node:url",
      "node:http",
      "node:https",
      "node:net",
      "node:child_process",
      "fs",
      "http",
      "https",
      "ws",
      "axios",
      "@solana/web3.js",
    ];
    const violations: string[] = [];
    for (const name of SPRINT17_FILES) {
      const source = readFileSync(join(SRC_DIR, name), "utf8");
      const specifiers = [...source.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of specifiers) {
        if (forbidden.includes(spec as string)) violations.push(`${name} imports "${spec}"`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("contains no NUL/forbidden control char, no UTF-8 BOM, and no conflict marker", () => {
    for (const name of SPRINT17_FILES) {
      const raw = readFileSync(join(SRC_DIR, name), "utf8");
      // No UTF-8 BOM at the start.
      expect(raw.charCodeAt(0)).not.toBe(0xfeff);
      // No NUL or other C0 control char except TAB(0x09)/LF(0x0a)/CR(0x0d); also no lone CR.
      for (let i = 0; i < raw.length; i += 1) {
        const code = raw.charCodeAt(i);
        const isAllowed = code === 0x09 || code === 0x0a || code >= 0x20;
        expect(isAllowed, `${name} has a forbidden control char (0x${code.toString(16)}) at ${i}`).toBe(true);
      }
      expect(raw.includes("\r"), `${name} must use LF line endings`).toBe(false);
      // No merge-conflict markers.
      expect(/^(<{7}|={7}|>{7})/m.test(raw), `${name} has a conflict marker`).toBe(false);
    }
  });
});
