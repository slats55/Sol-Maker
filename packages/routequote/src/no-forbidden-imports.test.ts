import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Modules this package must never import (capability/IO/wallet/chain/network surfaces).
 * @soulmaker/routequote validates LOCAL quote observation values only — it must stay structurally
 * incapable of fetching a quote, reaching a chain, or touching a key. A future read-only fetcher
 * is a SEPARATE, separately-reviewed adapter, never this package.
 */
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
  "dns",
  "node:dns",
  "tls",
  "node:tls",
  "child_process",
  "node:child_process",
  "worker_threads",
  "node:worker_threads",
  "ws",
  "axios",
  "undici",
  "@soulmaker/solana",
  "@soulmaker/adapters",
  "@soulmaker/simulation",
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

describe("@soulmaker/routequote — forbidden-import regression", () => {
  const files = sourceFiles(SRC_DIR);

  it("scans a non-empty source set including the package entrypoint", () => {
    const names = files.map((f) => f.slice(SRC_DIR.length + 1));
    expect(names).toContain("index.ts");
    expect(names).toContain("observation.ts");
    expect(names).toContain("prepared.ts");
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

  it("imports only the allowed workspace packages (security + sniper)", () => {
    const allowedWorkspace = new Set(["@soulmaker/security", "@soulmaker/sniper"]);
    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const specifier of importSpecifiers(source)) {
        if (specifier.startsWith("@soulmaker/") && !allowedWorkspace.has(specifier)) {
          violations.push(`${file.slice(SRC_DIR.length + 1)} imports "${specifier}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
