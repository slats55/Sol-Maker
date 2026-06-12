import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Capability tokens that must never appear in this package's production source. Unlike the pure
 * S91 observation validator, this package IS allowed to `fetch(` public quote endpoints — that is
 * its single capability. Everything wallet-, signing-, sending-, transaction-, or chain-shaped
 * stays forbidden: a quote fetcher that can build or move a transaction is a different (and
 * unauthorized) capability class.
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
  /\bpartialSign\b/i,
  /\bsimulateTransaction\b/i,
  /\bbuildTransaction\b/i,
  /\bVersionedTransaction\b/,
  /\bTransactionInstruction\b/,
  /\baxios\b/i,
  /\bWebSocket\b/i,
  /\bnew\s+Connection\b/,
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

describe("@soulmaker/quotefetch — package safety regression", () => {
  const files = sourceFiles(SRC_DIR);

  it("scans a non-empty source set including the package entrypoint", () => {
    const names = files.map((f) => f.slice(SRC_DIR.length + 1));
    expect(names).toContain("index.ts");
    expect(names).toContain("jupiter.ts");
    expect(names).toContain("fetch-report.ts");
  });

  it("adds no wallet/sign/send/transaction/chain capability token in code", () => {
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
      expect(/"executable"|"ready-to-trade"|"live-ready"/i.test(code), `${file.slice(SRC_DIR.length + 1)} defines a live-shaped outcome`).toBe(false);
    }
  });

  it("only the jupiter adapter performs network fetches (single, auditable network chokepoint)", () => {
    for (const file of files) {
      const name = file.slice(SRC_DIR.length + 1);
      if (name === "jupiter.ts") continue;
      const code = stripComments(readFileSync(file, "utf8"));
      expect(/\bfetch\s*\(/.test(code), `${name} must not fetch — network stays inside the adapter`).toBe(false);
    }
  });
});
