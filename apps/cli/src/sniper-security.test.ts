/**
 * Sprint 43 — SNIPER CLI + EXAMPLES security backstops (behavioral).
 *
 * The package-wide source scan lives in `packages/sniper/src/security-boundary.test.ts`. This test proves
 * the live-boundary behaviorally, at the CLI + shipped-examples layer:
 *
 *  1. No sniper command accepts a private key: a secret-length / private-key-shaped mint is REFUSED and
 *     never echoed back.
 *  2. No sniper command leaks a seed-phrase-looking value: a mnemonic-shaped operator note is redacted in
 *     the command's JSON output.
 *  3. Every shipped `examples/sniper/*.json` carries a fictional / disclaimer marker, and none contains a
 *     secret-length base58 blob.
 *
 * These run the real command functions over INJECTED inputs — no network, no wallet, no live data.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { REDACTED } from "@soulmaker/security";
import { paperSniperCandidatesValidateReport } from "./commands.js";

const SNIPER_EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../examples/sniper");
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "sniper-security-"));
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe("sniper CLI — no command accepts a private key", () => {
  it("REFUSES a secret-length / private-key-shaped mint and never echoes it back", () => {
    withTmp((tmp) => {
      // An 88-char base58 string is the length of a 64-byte secret key — far over a 32-byte pubkey.
      const secretShaped = "5".repeat(88);
      writeFileSync(join(tmp, "evil.json"), JSON.stringify({ candidates: [{ candidateId: "c1", mint: secretShaped }] }));
      const r = paperSniperCandidatesValidateReport({ cwd: tmp, env: {} }, { inputPath: "evil.json" });
      expect(r.exitCode).toBe(1);
      expect(r.text.startsWith("Refusing:")).toBe(true);
      // The refusal must NOT echo the secret-length input back.
      expect(r.text).not.toContain(secretShaped);
    });
  });

  it("drops an unknown `privateKey`-named field on a candidate (never carries it into the canonical list)", () => {
    withTmp((tmp) => {
      writeFileSync(
        join(tmp, "cands.json"),
        JSON.stringify({ candidates: [{ candidateId: "c1", mint: USDC, privateKey: "should-be-ignored", secretKey: "also-ignored" }] }),
      );
      const r = paperSniperCandidatesValidateReport({ cwd: tmp, env: {} }, { inputPath: "cands.json", json: true });
      expect(r.exitCode).toBe(0);
      // The canonical candidate shape has no key fields, so they are dropped, not carried through.
      expect(r.text).not.toContain("should-be-ignored");
      expect(r.text).not.toContain("also-ignored");
      expect(r.text).not.toMatch(/"privateKey"|"secretKey"/);
    });
  });
});

describe("sniper CLI — no command leaks a seed-phrase-looking value", () => {
  it("redacts a mnemonic-shaped operator note in the JSON output", () => {
    withTmp((tmp) => {
      const mnemonic = "abandon ability able about above absent absorb abstract absurd abuse access accident";
      writeFileSync(
        join(tmp, "cands.json"),
        JSON.stringify({ candidates: [{ candidateId: "c1", mint: USDC, sourceNote: mnemonic }] }),
      );
      const r = paperSniperCandidatesValidateReport({ cwd: tmp, env: {} }, { inputPath: "cands.json", json: true });
      expect(r.exitCode).toBe(0);
      expect(r.text).not.toContain(mnemonic);
      expect(r.text).toContain(REDACTED);
    });
  });
});

describe("examples/sniper — every fixture is labeled fictional and carries no secret", () => {
  const files = readdirSync(SNIPER_EXAMPLES_DIR).filter((f) => f.endsWith(".json")).sort();

  it("discovers the shipped example fixtures", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  for (const file of files) {
    it(`${file} carries a fictional / disclaimer marker and no secret-length base58 blob`, () => {
      const raw = readFileSync(join(SNIPER_EXAMPLES_DIR, file), "utf8");
      // A fixture must announce that it is a fixture / not live.
      expect(/_comment|fictional|FIXTURE|NOT live|deterministic/i.test(raw), `${file} must carry a fictional/disclaimer marker`).toBe(true);
      // No example may carry a secret-length base58 blob (a 64-byte key encodes to ~88 chars; pubkeys are <= 44).
      expect(/[1-9A-HJ-NP-Za-km-z]{80,}/.test(raw), `${file} must not contain a secret-length base58 blob`).toBe(false);
      // And no obvious key/seed fields.
      expect(/"privateKey"|"secretKey"|"mnemonic"|"seedPhrase"/i.test(raw), `${file} must not contain a key/seed field`).toBe(false);
    });
  }
});
