import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * @soulmaker/execution is the ONLY package allowed to hold signing and sending capability — and
 * even here it is fenced: signing exists ONLY in signer.ts, sending ONLY in send.ts, and the
 * forbidden concepts below may appear NOWHERE (no seed phrases, no logging of key material, no
 * network fetch, no readiness literals).
 */
const FORBIDDEN_EVERYWHERE: readonly RegExp[] = [
  /\bmnemonic\b/i,
  /\bseedPhrase\b/i,
  /\bseed phrase\b/i,
  /\bbip39\b/i,
  /\bderivationPath\b/i,
  /\bconsole\.(log|error|warn|info|debug)\b/, // this package must never print — key material could ride along
  /\bfetch\s*\(/i,
  /\baxios\b/i,
  /\bWebSocket\b/i,
  /\bJito\b/i,
  /phase7LiveTradingReady:\s*true/,
];

/** Signing/key capability tokens allowed ONLY in signer.ts. */
const SIGNING_TOKENS: readonly RegExp[] = [/\bKeypair\b/, /\bfromSecretKey\b/, /\.sign\s*\(/];

/** Sending capability tokens allowed ONLY in send.ts (as the seam contract). */
const SENDING_TOKENS: readonly RegExp[] = [/\bsendRawTransaction\b/, /\bsendTransaction\b/i, /\bsendAndConfirm/i];

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

describe("@soulmaker/execution — capability fencing", () => {
  const files = sourceFiles(SRC_DIR);

  it("scans the expected source set", () => {
    const names = files.map((f) => f.slice(SRC_DIR.length + 1));
    for (const expected of ["index.ts", "modes.ts", "live-gate.ts", "safety-controls.ts", "signer.ts", "send.ts"]) {
      expect(names).toContain(expected);
    }
  });

  it("forbidden-everywhere tokens appear nowhere (no seed phrases, no printing, no fetch)", () => {
    const violations: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const token of FORBIDDEN_EVERYWHERE) {
        if (token.test(code)) violations.push(`${file.slice(SRC_DIR.length + 1)} contains ${String(token)}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("signing capability exists ONLY in signer.ts", () => {
    for (const file of files) {
      const name = file.slice(SRC_DIR.length + 1);
      if (name === "signer.ts") continue;
      const code = stripComments(readFileSync(file, "utf8"));
      for (const token of SIGNING_TOKENS) {
        expect(token.test(code), `${name} carries signing token ${String(token)}`).toBe(false);
      }
    }
  });

  it("sending capability exists ONLY in send.ts", () => {
    for (const file of files) {
      const name = file.slice(SRC_DIR.length + 1);
      if (name === "send.ts") continue;
      const code = stripComments(readFileSync(file, "utf8"));
      for (const token of SENDING_TOKENS) {
        expect(token.test(code), `${name} carries sending token ${String(token)}`).toBe(false);
      }
    }
  });

  it("the live gate defines no override/bypass/force escape hatch", () => {
    const gate = stripComments(readFileSync(join(SRC_DIR, "live-gate.ts"), "utf8"));
    expect(/\boverride\b|\bbypass\b|\bskipGate\b|\bforceArm\b|\bunsafe\b/i.test(gate)).toBe(false);
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
