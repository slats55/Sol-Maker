/**
 * Sprint 43 — CONSOLIDATED SECURITY BOUNDARY backstop for the WHOLE `@soulmaker/sniper` package.
 *
 * Each module ships its own `*-safety.test.ts`, and `no-forbidden-imports.test.ts` scans every file's
 * IMPORTS. This test is the package-wide belt-and-suspenders: it scans the source of EVERY non-test
 * module (auto-discovered, so a NEW module that forgets its own safety test is still covered) and asserts
 * the whole package remains a pure, offline, PAPER-only, key-free layer with no chain / signing / sending
 * / network capability — the standing invariant behind the live boundary.
 *
 * It is the test that should fail loudly the day someone tries to bolt a signer, a key, a transaction, or
 * a network call onto the sniper package.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** Capability tokens that must NEVER appear in any sniper source module (code, comments stripped). */
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
  /\bchild_process\b/,
  /\.rs["'`]/,
];

/** Recursively collect this package's source files, excluding test files. */
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

describe("@soulmaker/sniper — package-wide security boundary", () => {
  const files = sourceFiles(SRC_DIR);
  const rel = (f: string): string => f.slice(SRC_DIR.length + 1);

  it("discovers a meaningful set of source modules (guards against an empty scan)", () => {
    expect(files.length).toBeGreaterThanOrEqual(12);
    const names = files.map(rel);
    // A few anchors so a broken glob can't silently pass.
    expect(names).toContain("index.ts");
    expect(names).toContain("paper-decision.ts");
    expect(names).toContain("simulation-intent.ts");
  });

  it("no source module contains a wallet / key / signing / sending / chain / network capability token", () => {
    const violations: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const token of FORBIDDEN_CAPABILITY_TOKENS) {
        if (token.test(code)) violations.push(`${rel(file)} contains forbidden token ${token}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("no source module imports a chain / IO / network capability specifier", () => {
    const violations: string[] = [];
    for (const file of files) {
      const specifiers = [...readFileSync(file, "utf8").matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1] as string);
      for (const spec of specifiers) {
        const banned =
          spec.startsWith("@solana/") ||
          spec === "@soulmaker/solana" ||
          /^(node:)?(fs|path|http|https|net|child_process|url|dns|tls)$/.test(spec) ||
          spec === "ws" ||
          spec === "axios";
        if (banned) violations.push(`${rel(file)} imports "${spec}"`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("the package depends only on the pure @soulmaker/{risk,security} packages (no chain dep)", () => {
    const pkg = JSON.parse(readFileSync(join(SRC_DIR, "../package.json"), "utf8")) as { dependencies?: Record<string, string> };
    const deps = Object.keys(pkg.dependencies ?? {}).sort();
    expect(deps).toEqual(["@soulmaker/risk", "@soulmaker/security"]);
  });
});
