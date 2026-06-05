/**
 * Security regression: `@soulmaker/strategy` must remain a pure, offline,
 * paper-only decision package. It may NOT import any capability module that
 * could read the chain, hit the network, touch the filesystem, or hold a key.
 *
 * This scans the package's own source (every `*.ts` except `*.test.ts`) and
 * asserts that no import/require/dynamic-import specifier resolves to a forbidden
 * module. It inspects *import specifiers only* (not comments/prose), so the doc
 * comments that explain what is forbidden do not trip it. Deterministic and
 * path-stable: the source directory is resolved from this file's own URL and the
 * file list is sorted.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** Modules this package must never import (capability/IO/wallet surfaces). */
const FORBIDDEN_EXACT = new Set([
  "fs",
  "node:fs",
  "fs/promises",
  "node:fs/promises",
  "http",
  "node:http",
  "https",
  "node:https",
  "ws",
]);

function isForbidden(specifier: string): boolean {
  if (FORBIDDEN_EXACT.has(specifier)) return true;
  // Any @solana/web3 entrypoint (e.g. "@solana/web3.js") brings chain capability.
  if (specifier === "@solana/web3.js" || specifier.startsWith("@solana/web3")) return true;
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
    /\bfrom\s*["']([^"']+)["']/g, // import ... from "x" / export ... from "x"
    /\bimport\s*["']([^"']+)["']/g, // bare import "x"
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // dynamic import("x")
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, // require("x")
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1] !== undefined) specifiers.push(match[1]);
    }
  }
  return specifiers;
}

describe("@soulmaker/strategy — forbidden-import regression", () => {
  const files = sourceFiles(SRC_DIR);

  it("scans at least the known source modules (guards against an empty scan)", () => {
    const names = files.map((f) => f.slice(SRC_DIR.length + 1));
    expect(names).toContain("plan.ts");
    expect(names).toContain("evaluate.ts");
    expect(names).toContain("index.ts");
  });

  it("imports no chain/network/filesystem/socket capability module", () => {
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
});
