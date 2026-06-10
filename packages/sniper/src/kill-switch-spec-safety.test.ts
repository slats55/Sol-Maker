/**
 * Sprint 53 SAFETY REGRESSION for the SNIPER KILL-SWITCH SPEC layer.
 *
 * The spec artifact (`kill-switch-spec.ts`) is a LOCAL design document — NOT a kill switch. This
 * test scans the module's own source: no process-control capability (no process./kill/exit/signal
 * calls), no wallet/sign/send/network capability, pure imports only, no wall-clock, clean encoding.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const SPRINT53_FILES = ["kill-switch-spec.ts"];

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
  // a kill-switch SPEC must not contain actual process control:
  /\bprocess\.(kill|exit|abort)\b/,
  /\bchild_process\b/,
  /\bSIG(INT|TERM|KILL)\b/,
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

describe("@soulmaker/sniper — Sprint 53 kill-switch spec safety regression", () => {
  it("contains no process-control / wallet / network / Rust capability token in code", () => {
    const violations: string[] = [];
    for (const name of SPRINT53_FILES) {
      const code = stripComments(readFileSync(join(SRC_DIR, name), "utf8"));
      for (const token of FORBIDDEN_CAPABILITY_TOKENS) {
        if (token.test(code)) violations.push(`${name} contains forbidden token ${token}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("imports only pure, local, paper-safe modules", () => {
    const forbidden = [
      "node:fs", "node:path", "node:url", "node:http", "node:https", "node:net", "node:child_process",
      "fs", "path", "http", "https", "ws", "axios", "@solana/web3.js", "@solana/spl-token", "@soulmaker/solana",
    ];
    const violations: string[] = [];
    for (const name of SPRINT53_FILES) {
      const source = readFileSync(join(SRC_DIR, name), "utf8");
      const specifiers = [...source.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of specifiers) {
        if (forbidden.includes(spec as string) || (spec as string).startsWith("@solana/")) {
          violations.push(`${name} imports "${spec}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("uses no Date.now / Math.random (deterministic, no wall-clock)", () => {
    for (const name of SPRINT53_FILES) {
      const code = stripComments(readFileSync(join(SRC_DIR, name), "utf8"));
      expect(/\bDate\.now\b/.test(code), `${name} must not use Date.now`).toBe(false);
      expect(/\bMath\.random\b/.test(code), `${name} must not use Math.random`).toBe(false);
    }
  });

  it("contains no NUL/forbidden control char, no UTF-8 BOM, and no conflict marker", () => {
    for (const name of SPRINT53_FILES) {
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
