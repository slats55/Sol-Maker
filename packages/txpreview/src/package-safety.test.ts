import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Capability tokens that must never appear in this package's PRODUCTION source. This package's
 * single capability is `simulateTransaction` over UNSIGNED transactions (sigVerify disabled) —
 * which is exactly why nothing signer-, key-, or send-shaped may exist here. `Keypair` appears
 * only in the test file (to fabricate a signed transaction the production code must refuse);
 * production source is scanned strictly.
 */
const FORBIDDEN_CAPABILITY_TOKENS: readonly RegExp[] = [
  /\bprivateKey\b/i,
  /\bsecretKey\b/i,
  /\bmnemonic\b/i,
  /\bseedPhrase\b/i,
  /\bseed phrase\b/i,
  /\bKeypair\b/,
  /\bsignTransaction\b/i,
  /\bsendTransaction\b/i,
  /\bsendRawTransaction\b/i,
  /\bsendAndConfirm/i,
  /\brequestAirdrop\b/i,
  /\bpartialSign\b/i,
  /\bsign\s*\(/,
  /\bfetch\s*\(/i,
  /\baxios\b/i,
  /\bWebSocket\b/i,
  /\bJito\b/i,
  /phase7LiveTradingReady:\s*true/,
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out.sort();
}

/** Strip comments so documentation mentioning a forbidden concept never trips the code scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

describe("@soulmaker/txpreview — package safety regression", () => {
  const files = sourceFiles(SRC_DIR);

  it("scans a non-empty source set including the package entrypoint", () => {
    const names = files.map((f) => f.slice(SRC_DIR.length + 1));
    expect(names).toContain("index.ts");
    expect(names).toContain("envelope.ts");
    expect(names).toContain("simulate.ts");
  });

  it("adds no signer/key/send/network-fetch capability token in production code", () => {
    const violations: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const token of FORBIDDEN_CAPABILITY_TOKENS) {
        if (token.test(code)) {
          violations.push(`${file.slice(SRC_DIR.length + 1)} contains forbidden token ${String(token)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("the RPC seam exposes EXACTLY simulateTransaction (no send method to misuse)", () => {
    const simulate = readFileSync(join(SRC_DIR, "simulate.ts"), "utf8");
    const match = /interface TxSimulateRpcLike \{([\s\S]*?)\n\}/.exec(simulate);
    expect(match).not.toBeNull();
    const body = match?.[1] ?? "";
    const methods = [...body.matchAll(/^\s*([a-zA-Z0-9_]+)\s*\(/gm)].map((m) => m[1]);
    expect(methods).toEqual(["simulateTransaction"]);
  });

  it("contains no NUL/forbidden control char, no UTF-8 BOM, and no conflict marker", () => {
    for (const file of files) {
      const name = file.slice(SRC_DIR.length + 1);
      const raw = readFileSync(file, "utf8");
      expect(raw.charCodeAt(0), `${name} starts with a UTF-8 BOM`).not.toBe(0xfeff);
      for (let i = 0; i < raw.length; i += 1) {
        const code = raw.charCodeAt(i);
        const isAllowed = code === 0x09 || code === 0x0a || code >= 0x20;
        expect(isAllowed, `${name} has a forbidden control char (0x${code.toString(16)}) at ${i}`).toBe(true);
      }
      expect(raw.includes("\r"), `${name} must use LF line endings`).toBe(false);
      expect(/^(<{7}|={7}|>{7})/m.test(raw), `${name} has a conflict marker`).toBe(false);
    }
  });

  it("never defines an executable/live-ready outcome in code", () => {
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(/"executable"|"ready-to-trade"|"live-ready"|"sent"|"signed"/i.test(code), `${file.slice(SRC_DIR.length + 1)} defines a live-shaped outcome`).toBe(false);
    }
  });
});
