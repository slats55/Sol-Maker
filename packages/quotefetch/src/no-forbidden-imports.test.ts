import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Modules this package must never import. The fetcher's ONLY capability is reading public quote
 * endpoints through the injected/global `fetch` — it must stay structurally incapable of touching
 * a chain SDK, a filesystem, a socket library, or a wallet. `node:crypto` is allowed solely for
 * the truncated response digest.
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
  "@soulmaker/core",
]);

function isForbidden(specifier: string): boolean {
  if (FORBIDDEN_EXACT.has(specifier)) return true;
  // Any @solana/* entrypoint brings chain capability — a quote fetcher must not have it.
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

describe("@soulmaker/quotefetch — forbidden-import regression", () => {
  const files = sourceFiles(SRC_DIR);

  it("scans a non-empty source set including the package entrypoint", () => {
    const names = files.map((f) => f.slice(SRC_DIR.length + 1));
    expect(names).toContain("index.ts");
    expect(names).toContain("jupiter.ts");
  });

  it("imports no chain/filesystem/socket/wallet capability module", () => {
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

  it("imports only the allowed workspace packages (security + sniper + routequote)", () => {
    const allowedWorkspace = new Set(["@soulmaker/security", "@soulmaker/sniper", "@soulmaker/routequote"]);
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
