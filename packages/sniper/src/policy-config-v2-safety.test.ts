/**
 * Sprint 48 SAFETY REGRESSION for the SNIPER POLICY CONFIG V2 layer.
 *
 * The v2 policy config (`policy-config-v2.ts`) is a pure, offline, PAPER-only module whose every
 * limit is tighten-only. This test asserts — by scanning the module's own source — that it adds NO
 * live-trading / wallet / signing / sending / network / Rust capability, imports only pure modules,
 * uses no Date.now/Math.random, and carries no NUL/CR/control char, no UTF-8 BOM, and no conflict
 * marker. It also asserts the policy model exposes no live-trading-shaped field name.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSniperPolicyConfigV2 } from "./policy-config-v2.js";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const SPRINT48_FILES = ["policy-config-v2.ts"];

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

describe("@soulmaker/sniper — Sprint 48 policy config v2 safety regression", () => {
  it("adds no wallet/sign/send/network/Rust capability token in code", () => {
    const violations: string[] = [];
    for (const name of SPRINT48_FILES) {
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
    for (const name of SPRINT48_FILES) {
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
    for (const name of SPRINT48_FILES) {
      const code = stripComments(readFileSync(join(SRC_DIR, name), "utf8"));
      expect(/\bDate\.now\b/.test(code), `${name} must not use Date.now`).toBe(false);
      expect(/\bMath\.random\b/.test(code), `${name} must not use Math.random`).toBe(false);
    }
  });

  it("contains no NUL/forbidden control char, no UTF-8 BOM, and no conflict marker", () => {
    for (const name of SPRINT48_FILES) {
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

  it("a canonical v2 policy exposes no live-trading-shaped key anywhere in its JSON", () => {
    const policy = normalizeSniperPolicyConfigV2({ policyLabel: "safety" });
    const keys: string[] = [];
    const walk = (value: unknown): void => {
      if (value !== null && typeof value === "object") {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          keys.push(k);
          walk(v);
        }
      }
    };
    walk(policy);
    // `notLiveResult` is the safety LABEL asserting the opposite — it is the one allowed "live" key.
    const safetyLabels = new Set(["notLiveResult"]);
    for (const key of keys.filter((k) => !safetyLabels.has(k))) {
      expect(/live|wallet|sign|send|swap|order|execute|slippage|key|seed/i.test(key), `policy key "${key}" looks live-trading-shaped`).toBe(false);
    }
  });
});
