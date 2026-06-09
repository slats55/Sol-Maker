/**
 * Security regression: `@soulmaker/sniper` must remain a pure, offline, paper-only package. It may
 * NOT import any capability module that could read the chain, hit the network, touch the filesystem,
 * or hold a key — in particular NOT `@solana/web3.js` (chain capability) or `@soulmaker/solana`
 * (which depends on it). Mint validation is done with a pure base58 decoder in this package instead.
 *
 * This scans the package's own source (every `*.ts` except `*.test.ts`) and asserts that no
 * import/require/dynamic-import specifier resolves to a forbidden module. It inspects *import
 * specifiers only* (not comments/prose), so the doc comments that explain what is forbidden do not
 * trip it. Deterministic and path-stable.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** Modules this package must never import (capability/IO/wallet/chain surfaces). */
const FORBIDDEN_EXACT = new Set([
  "fs",
  "node:fs",
  "fs/promises",
  "node:fs/promises",
  "path",
  "node:path",
  "http",
  "node:http",
  "https",
  "node:https",
  "net",
  "node:net",
  "child_process",
  "node:child_process",
  "ws",
  "axios",
  "@soulmaker/solana",
]);

function isForbidden(specifier: string): boolean {
  if (FORBIDDEN_EXACT.has(specifier)) return true;
  // Any @solana/* entrypoint brings chain capability.
  if (specifier === "@solana/web3.js" || specifier.startsWith("@solana/")) return true;
  return false;
}

/** Recursively collect this package's source files, excluding test files. */
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

describe("@soulmaker/sniper — forbidden-import regression", () => {
  const files = sourceFiles(SRC_DIR);

  it("scans the known source modules (guards against an empty scan)", () => {
    const names = files.map((f) => f.slice(SRC_DIR.length + 1));
    expect(names).toContain("index.ts");
    expect(names).toContain("mint-address.ts");
    expect(names).toContain("candidate-list.ts");
  });

  it("imports no chain/network/filesystem/socket/wallet capability module", () => {
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const specifier of importSpecifiers(source)) {
        if (isForbidden(specifier)) {
          violations.push(`${file.slice(SRC_DIR.length + 1)} imports "${specifier}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("uses no Date.now / Math.random in any source module (deterministic + no wall-clock)", () => {
    for (const file of files) {
      const source = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
      const name = file.slice(SRC_DIR.length + 1);
      expect(/\bDate\.now\b/.test(source), `${name} must not use Date.now`).toBe(false);
      expect(/\bMath\.random\b/.test(source), `${name} must not use Math.random`).toBe(false);
    }
  });
});
