import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * The builder constructs UNSIGNED transactions via a provider's HTTP API. It must therefore
 * never contain signing, key, or sending capability — those live (gated) in
 * @soulmaker/execution only.
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
  /\.sign\s*\(/,
  /\bsimulateTransaction\b/i,
  /\bnew\s+Connection\b/,
  /\bWebSocket\b/i,
  /\baxios\b/i,
  /\bJito\b/i,
  /phase7LiveTradingReady:\s*true/,
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out.sort();
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

describe("@soulmaker/txbuilder — package safety regression", () => {
  const files = sourceFiles(SRC_DIR);

  it("scans a non-empty source set", () => {
    const names = files.map((f) => f.slice(SRC_DIR.length + 1));
    expect(names).toContain("index.ts");
    expect(names).toContain("refusals.ts");
    expect(names).toContain("jupiter-swap.ts");
  });

  it("adds no signing/key/sending/simulation capability token in production code", () => {
    const violations: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const token of FORBIDDEN_CAPABILITY_TOKENS) {
        if (token.test(code)) violations.push(`${file.slice(SRC_DIR.length + 1)} contains forbidden token ${String(token)}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("network stays inside the jupiter adapter (single auditable chokepoint)", () => {
    for (const file of files) {
      const name = file.slice(SRC_DIR.length + 1);
      if (name === "jupiter-swap.ts") continue;
      expect(/\bfetch\s*\(/.test(stripComments(readFileSync(file, "utf8"))), `${name} must not fetch`).toBe(false);
    }
  });

  it("contains no NUL/control chars, BOM, CR, or conflict markers", () => {
    for (const file of files) {
      const name = file.slice(SRC_DIR.length + 1);
      const raw = readFileSync(file, "utf8");
      expect(raw.charCodeAt(0)).not.toBe(0xfeff);
      for (let i = 0; i < raw.length; i += 1) {
        const code = raw.charCodeAt(i);
        expect(code === 0x09 || code === 0x0a || code >= 0x20, `${name} control char at ${i}`).toBe(true);
      }
      expect(raw.includes("\r"), `${name} must use LF`).toBe(false);
      expect(/^(<{7}|={7}|>{7})/m.test(raw)).toBe(false);
    }
  });
});
