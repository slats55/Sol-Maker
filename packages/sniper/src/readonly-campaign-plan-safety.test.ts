/**
 * Sprint 105-A SAFETY REGRESSION for the READ-ONLY AUTO-CAMPAIGN PLAN layer.
 *
 * The plan (`readonly-campaign-plan.ts`) is a pure, offline, no-send constitution for the auto-campaign
 * runner. This test asserts — by scanning the module's own source — that it adds NO live-trading /
 * wallet / signing / sending / network / Rust capability, that it imports only pure modules, and that
 * the file carries no NUL / CR / other forbidden control character, no UTF-8 BOM, and no merge-conflict
 * marker. It also asserts the structural no-send / no-readiness invariants of the produced artifact.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSniperReadonlyCampaignPlan,
  validateSniperReadonlyCampaignPlan,
  SNIPER_READONLY_CAMPAIGN_STAGES,
} from "./readonly-campaign-plan.js";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const FILES = ["readonly-campaign-plan.ts"];

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

describe("@soulmaker/sniper — Sprint 105-A read-only campaign plan safety regression", () => {
  it("adds no wallet/sign/send/network/Rust capability token in code", () => {
    const violations: string[] = [];
    for (const name of FILES) {
      const code = stripComments(readFileSync(join(SRC_DIR, name), "utf8"));
      for (const token of FORBIDDEN_CAPABILITY_TOKENS) {
        if (token.test(code)) violations.push(`${name} contains forbidden token ${token}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("imports only pure, local, paper-safe modules (no fs/path/url/net/http/child_process/chain)", () => {
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
      "@solana/spl-token",
      "@soulmaker/solana",
    ];
    const violations: string[] = [];
    for (const name of FILES) {
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
    for (const name of FILES) {
      const code = stripComments(readFileSync(join(SRC_DIR, name), "utf8"));
      expect(/\bDate\.now\b/.test(code), `${name} must not use Date.now`).toBe(false);
      expect(/\bMath\.random\b/.test(code), `${name} must not use Math.random`).toBe(false);
    }
  });

  it("contains no NUL/forbidden control char, no UTF-8 BOM, and no conflict marker", () => {
    for (const name of FILES) {
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

  it("the closed stage set carries no send / sign / arm / broadcast stage", () => {
    for (const stage of SNIPER_READONLY_CAMPAIGN_STAGES) {
      expect(stage).not.toMatch(/send|sign|arm|broadcast|mainnet-live|go-live|live-send/i);
    }
  });

  it("a produced plan is structurally no-send and carries no readiness/execution field", () => {
    const plan = buildSniperReadonlyCampaignPlan({ allowedStages: ["candidate-score"] });
    expect(plan.noSend).toBe(true);
    expect(plan.noSigner).toBe(true);
    expect(plan.noLiveTrading).toBe(true);
    expect(plan.liveSendStatus).toBe("disabled");
    expect(plan.phase7LiveTradingReady).toBe(false);
    const keys = Object.keys(plan);
    for (const forbidden of ["readiness", "readyToTrade", "signature", "txid", "sendResult", "armed"]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
    expect(() => validateSniperReadonlyCampaignPlan(plan)).not.toThrow();
  });
});
