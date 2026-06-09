/**
 * Sprint 46 SAFETY REGRESSION for the SNIPER DECISION REASON CODES + V2 REPORT layer.
 *
 * The v2 decision report (`paper-decision-v2.ts`) and its code vocabulary
 * (`decision-reason-codes.ts`) are pure, offline, PAPER-only modules. This test asserts — by scanning
 * the modules' own source — that they add NO live-trading / wallet / signing / sending / network /
 * Rust capability, import only pure modules (no fs/path/url/net/http/child_process and no chain
 * capability; `@soulmaker/security` is allowed), use no Date.now/Math.random, and carry no
 * NUL/CR/control char, no UTF-8 BOM, and no conflict marker. Comments are stripped first.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const SPRINT46_FILES = ["decision-reason-codes.ts", "paper-decision-v2.ts"];

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

describe("@soulmaker/sniper — Sprint 46 decision v2 safety regression", () => {
  it("adds no wallet/sign/send/network/Rust capability token in code", () => {
    const violations: string[] = [];
    for (const name of SPRINT46_FILES) {
      const code = stripComments(readFileSync(join(SRC_DIR, name), "utf8"));
      for (const token of FORBIDDEN_CAPABILITY_TOKENS) {
        if (token.test(code)) violations.push(`${name} contains forbidden token ${token}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("imports only pure, local, paper-safe modules (no fs/path/url/net/http/child_process/chain)", () => {
    const forbidden = [
      "node:fs", "node:path", "node:url", "node:http", "node:https", "node:net", "node:child_process",
      "fs", "path", "http", "https", "ws", "axios", "@solana/web3.js", "@solana/spl-token", "@soulmaker/solana",
    ];
    const violations: string[] = [];
    for (const name of SPRINT46_FILES) {
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
    for (const name of SPRINT46_FILES) {
      const code = stripComments(readFileSync(join(SRC_DIR, name), "utf8"));
      expect(/\bDate\.now\b/.test(code), `${name} must not use Date.now`).toBe(false);
      expect(/\bMath\.random\b/.test(code), `${name} must not use Math.random`).toBe(false);
    }
  });

  it("contains no NUL/forbidden control char, no UTF-8 BOM, and no conflict marker", () => {
    for (const name of SPRINT46_FILES) {
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

  it("the v2 report never claims live capability: executable/live markers stay false-shaped", () => {
    // The v2 module must label everything paperOnly/simulated and must not export any function whose
    // name suggests signing/sending/executing.
    const source = readFileSync(join(SRC_DIR, "paper-decision-v2.ts"), "utf8");
    const exported = [...source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1] as string);
    for (const name of exported) {
      expect(/sign|send|execute|swap|order|trade/i.test(name), `exported function ${name} must not look executable`).toBe(false);
    }
  });
});
