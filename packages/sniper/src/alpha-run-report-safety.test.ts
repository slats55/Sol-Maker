/**
 * Sprint 105-A SAFETY REGRESSION for the ALPHA RUN REPORT layer.
 *
 * The report (`alpha-run-report.ts`) is a pure, offline, no-send projection of a validated campaign.
 * This test asserts — by scanning the module's own source — that it adds NO live-trading / wallet /
 * signing / sending / network / Rust capability, imports only pure modules, carries no NUL / CR /
 * forbidden control char / BOM / conflict marker, and produces a structurally no-send artifact that
 * can never claim live readiness or profitability.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSniperDryRunCampaign } from "./dryrun-campaign.js";
import { buildSniperAlphaRunReport, validateSniperAlphaRunReport, SNIPER_ALPHA_RUN_REPORT_DISCLAIMERS } from "./alpha-run-report.js";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const FILES = ["alpha-run-report.ts"];

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

const WSOL = "So11111111111111111111111111111111111111112";

describe("@soulmaker/sniper — Sprint 105-A alpha run report safety regression", () => {
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

  it("the disclaimers explicitly disclaim live readiness and profitability", () => {
    const joined = SNIPER_ALPHA_RUN_REPORT_DISCLAIMERS.join(" ").toLowerCase();
    expect(joined).toContain("not a profitability claim");
    expect(joined).toContain("not a live-readiness claim");
    expect(joined).toContain("disabled");
  });

  it("a produced report is structurally no-send with no readiness/send field", () => {
    const c = buildSniperDryRunCampaign({ candidates: [{ candidateId: "wsol", mint: WSOL, riskDecision: "PASS_FOR_PAPER_EVALUATION", preflightVerdict: "pass" }] });
    const report = buildSniperAlphaRunReport({ campaign: c, campaignRef: "campaign.json", campaignPlanRef: "plan.json" });
    expect(report.liveTradingStatus).toBe("disabled");
    expect(report.authorizesLiveTrading).toBe(false);
    expect(report.neverSends).toBe(true);
    const keys = Object.keys(report);
    for (const forbidden of ["signature", "txid", "sendResult", "armed", "readyToTrade", "liveExecutionAuthorized"]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
    expect(() => validateSniperAlphaRunReport(report)).not.toThrow();
  });
});
