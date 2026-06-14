/**
 * Sprint 107 SAFETY REGRESSION for the SNIPER ALPHA HISTORY TREND layer.
 *
 * The trend (`alpha-history-trend.ts`) is a pure, offline, no-send series across ordered alpha-history
 * snapshots. This test asserts — by scanning the module's own source — that it adds NO live-trading /
 * wallet / signing / sending / network / Rust capability, imports only pure modules, carries no NUL /
 * CR / forbidden control char / BOM / conflict marker, and produces a structurally no-send artifact
 * that authorizes nothing.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSniperDryRunCampaign } from "./dryrun-campaign.js";
import { buildSniperAlphaHistory } from "./alpha-history.js";
import { buildSniperAlphaHistoryTrend, validateSniperAlphaHistoryTrend } from "./alpha-history-trend.js";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const FILES = ["alpha-history-trend.ts"];

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

describe("@soulmaker/sniper — Sprint 107 alpha history trend safety regression", () => {
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

  it("a produced trend is structurally no-send and authorizes nothing", () => {
    const mkHistory = (id: string, reject: boolean) =>
      buildSniperAlphaHistory({
        historyId: id,
        runs: [
          {
            runRef: "runs/a",
            campaign: buildSniperDryRunCampaign({
              candidates: [{ candidateId: "w", mint: WSOL, riskDecision: reject ? "REJECT" : "PASS_FOR_PAPER_EVALUATION", preflightVerdict: reject ? undefined : "pass" }],
              mode: "mainnet-dry-run",
            }),
            report: null,
          },
        ],
      });
    const trend = buildSniperAlphaHistoryTrend({ snapshots: [{ label: "mon", history: mkHistory("mon", true) }, { label: "tue", history: mkHistory("tue", false) }] });
    expect(trend.liveTradingStatus).toBe("disabled");
    expect(trend.authorizesLiveTrading).toBe(false);
    expect(trend.anyInputAuthorizesLiveTrading).toBe(false);
    expect(trend.neverSends).toBe(true);
    expect(trend.phase7LiveTradingReady).toBe(false);
    const keys = Object.keys(trend);
    for (const forbidden of ["signature", "txid", "sendResult", "armed", "liveExecutionAuthorized"]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
    expect(() => validateSniperAlphaHistoryTrend(trend)).not.toThrow();
  });
});
