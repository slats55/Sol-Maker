import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Capability tokens that must never appear in this package's PRODUCTION
 * source. The bridge's single capability is spawning the engine binary with
 * a closed argument vocabulary — so nothing signer-, key-, send-, or
 * network-shaped may exist here. guard.ts is exempted from the WORD tokens
 * only (its DENY patterns must name the things they refuse); it is still
 * scanned for every functional token.
 */
const FORBIDDEN_FUNCTIONAL_TOKENS: readonly RegExp[] = [
  /\bKeypair\b/,
  /\bsignTransaction\b/i,
  /\bsendTransaction\b/i,
  /\bsendRawTransaction\b/i,
  /\bsendAndConfirm/i,
  /\brequestAirdrop\b/i,
  /\bpartialSign\b/i,
  /\bfetch\s*\(/i,
  /\baxios\b/i,
  /\bWebSocket\b/i,
  /@solana\/web3\.js/,
  /node:https?/,
  /node:net\b/,
  /\bexecSync\b/,
  /\bspawnSync\b/,
  /\bexecFile/,
  /\bexec\s*\(/,
  /shell:\s*true/,
  /phase7LiveTradingReady:\s*true/,
];

/** Secret WORD tokens — forbidden everywhere except guard.ts's deny patterns. */
const FORBIDDEN_WORD_TOKENS: readonly RegExp[] = [
  /\bprivateKey\b/i,
  /\bsecretKey\b/i,
  /\bmnemonic\b/i,
  /\bseedPhrase\b/i,
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

/** Strip comments so documentation naming a forbidden concept never trips the code scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

describe("@soulmaker/engine-bridge — package safety regression", () => {
  const files = sourceFiles(SRC_DIR);

  it("scans the full module set", () => {
    const names = files.map((f) => f.slice(SRC_DIR.length + 1));
    expect(names).toContain("index.ts");
    expect(names).toContain("guard.ts");
    expect(names).toContain("runner.ts");
    expect(names).toContain("locate.ts");
    expect(names).toContain("status.ts");
    expect(names).toContain("validate.ts");
  });

  it("adds no signer/key/send/network capability token in production code", () => {
    const violations: string[] = [];
    for (const file of files) {
      const name = file.slice(SRC_DIR.length + 1);
      const code = stripComments(readFileSync(file, "utf8"));
      for (const token of FORBIDDEN_FUNCTIONAL_TOKENS) {
        if (token.test(code)) violations.push(`${name} contains forbidden token ${String(token)}`);
      }
      if (name !== "guard.ts") {
        for (const token of FORBIDDEN_WORD_TOKENS) {
          if (token.test(code)) violations.push(`${name} contains forbidden token ${String(token)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("touches child_process ONLY in runner.ts, and only via spawn with shell:false", () => {
    for (const file of files) {
      const name = file.slice(SRC_DIR.length + 1);
      const code = readFileSync(file, "utf8");
      if (name === "runner.ts") {
        expect(code).toContain('from "node:child_process"');
        expect(code).toContain("shell: false");
      } else {
        expect(code.includes("child_process"), `${name} must not touch child_process`).toBe(false);
      }
    }
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
});
