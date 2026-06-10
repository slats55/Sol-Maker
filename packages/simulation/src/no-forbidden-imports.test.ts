/**
 * Security regression: `@soulmaker/simulation` must remain a pure, offline, read-only, dry-run-only
 * package — an even NARROWER boundary than `@soulmaker/sniper`'s. Three layers, all over the
 * package's own production source (every `*.ts` except `*.test.ts`):
 *
 *   1. **Import allowlist** — a production module may import ONLY relative siblings,
 *      `@soulmaker/sniper`, or `@soulmaker/security`. Everything else (node builtins, network,
 *      filesystem, `@solana/*`, any other workspace package, any third-party module) is refused.
 *      Stricter than a denylist: a brand-new capability module is refused by default.
 *   2. **Forbidden-token scan** — with comments stripped, no production source may contain a
 *      signing/sending/key/secret surface token. These tokens appear ONLY in this test file
 *      (refusal context), never in production code.
 *   3. **Determinism scan** — no wall-clock, no randomness.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** The ONLY non-relative modules a production file may import. */
const ALLOWED_BARE_IMPORTS = new Set(["@soulmaker/sniper", "@soulmaker/security"]);

/** Recursively collect this package's production source files (tests excluded). */
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

/** Extract every module specifier from import / export-from / require / import(). */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1] !== undefined) specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/** Strip block and line comments so doc prose never trips the token scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/**
 * Signing / sending / key / secret surface tokens that must NEVER appear in production source.
 * They are spelled out here, in refusal-test context, ON PURPOSE — this is the only place in the
 * package allowed to contain them.
 */
const FORBIDDEN_TOKENS: ReadonlyArray<readonly [string, RegExp]> = [
  ["Keypair", /\bKeypair\b/],
  ["Signer", /\bSigner\b/],
  ["secretKey", /\bsecretKey\b/],
  ["privateKey", /\bprivateKey\b/],
  ["mnemonic", /\bmnemonic\b/i],
  ["seed phrase", /\bseed\s*phrase\b/i],
  ["sendTransaction", /\bsendTransaction\b/],
  ["sendRawTransaction", /\bsendRawTransaction\b/],
  ["signTransaction", /\bsignTransaction\b/],
  ["signAllTransactions", /\bsignAllTransactions\b/],
  ["partialSign", /\bpartialSign\b/],
  ["DANGEROUS_BURNER_LIVE", /DANGEROUS_BURNER_LIVE/],
  ["process.env", /\bprocess\s*\.\s*env\b/],
];

/** Wall-clock / randomness tokens that must never appear in production source (determinism). */
const NONDETERMINISM_TOKENS: ReadonlyArray<readonly [string, RegExp]> = [
  ["Date.now", /\bDate\.now\b/],
  ["new Date", /\bnew\s+Date\b/],
  ["Math.random", /\bMath\.random\b/],
  ["randomUUID", /\brandomUUID\b/],
  ["randomBytes", /\brandomBytes\b/],
];

describe("@soulmaker/simulation — package boundary scan", () => {
  const files = sourceFiles(SRC_DIR);

  it("scans the known source modules (guards against an empty scan)", () => {
    const names = files.map((f) => f.slice(SRC_DIR.length + 1));
    expect(names).toContain("index.ts");
    expect(names).toContain("safety.ts");
  });

  it("imports ONLY relative siblings, @soulmaker/sniper, or @soulmaker/security", () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const specifier of importSpecifiers(source)) {
        const relative = specifier.startsWith("./") || specifier.startsWith("../");
        if (!relative && !ALLOWED_BARE_IMPORTS.has(specifier)) {
          violations.push(`${file.slice(SRC_DIR.length + 1)} imports "${specifier}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("contains no signing/sending/key/secret surface token in any production source", () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = stripComments(readFileSync(file, "utf8"));
      const name = file.slice(SRC_DIR.length + 1);
      for (const [label, re] of FORBIDDEN_TOKENS) {
        if (re.test(source)) violations.push(`${name} contains forbidden token "${label}"`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("contains no wall-clock or randomness token in any production source (determinism)", () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = stripComments(readFileSync(file, "utf8"));
      const name = file.slice(SRC_DIR.length + 1);
      for (const [label, re] of NONDETERMINISM_TOKENS) {
        if (re.test(source)) violations.push(`${name} contains nondeterministic token "${label}"`);
      }
    }
    expect(violations).toEqual([]);
  });
});
