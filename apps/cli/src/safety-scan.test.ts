/**
 * Sprint 103 — the repo-level secret / wallet / filesystem leak scan (`pnpm safety:scan`).
 *
 * Pins that the scan (1) finds NO leak over the real tracked tree, (2) catches the real leak shapes
 * a planted secret would have, and (3) does NOT false-positive on filler, public keys, lock-file
 * checksums, or placeholders.
 */

import { describe, it, expect } from "vitest";
import {
  scanContentForSecrets,
  checkGitignoreCoverage,
  isSecretFilename,
  runRepoSafetyScan,
  REQUIRED_GITIGNORE_RULES,
  UNSIGNED_TX_EXAMPLE_BASE58_EXEMPT,
} from "../../../scripts/safety-scan.js";

// Fixtures below are intentional fake-secret SHAPES for the scanner's own test. safety-scan-ignore
const PLANTED_BASE58 = "4wBqpZM9xaSheZzJSMawUHDgZ7miWfSsxmV1DxAVN1rJ8sPT3v9nQk7mRsV2yZ8bC4dE6fG1hJ3kL5mN7pQ9rS"; // safety-scan-ignore

describe("safety:scan — the real tracked tree is clean", () => {
  it("finds no tracked secret file, no key/seed leak, and full .gitignore coverage", () => {
    const result = runRepoSafetyScan();
    expect(result.filenameFindings).toEqual([]);
    expect(result.contentFindings).toEqual([]);
    expect(result.missingGitignoreRules).toEqual([]);
    expect(result.filesScanned).toBeGreaterThan(100);
  });
});

describe("safety:scan — the unsigned-tx-example base58 exemption is NARROW", () => {
  it("exempts EXACTLY the three reviewed live canary example files", () => {
    expect([...UNSIGNED_TX_EXAMPLE_BASE58_EXEMPT].sort()).toEqual([
      "examples/live/canary-request.blocked-by-policy.example.json",
      "examples/live/canary-request.blocked-by-risk.example.json",
      "examples/live/canary-request.preflight-ready.example.json",
    ]);
  });

  it("skips the base58-blob rule for an exempt file but STILL catches a planted keypair byte array", () => {
    const exempt = "examples/live/canary-request.preflight-ready.example.json";
    // A public unsigned-tx blob is not flagged here…
    expect(scanContentForSecrets(`"txBase64": "${PLANTED_BASE58}"`, exempt).map((f) => f.rule)).not.toContain("base58-secret-blob");
    // …but a real keypair byte array still is — the exemption is base58-rule-only.
    const bytes = Array.from({ length: 64 }, (_, i) => (i * 7 + 13) % 256).join(",");
    expect(scanContentForSecrets(`[${bytes}]`, exempt).map((f) => f.rule)).toContain("private-key-byte-array");
  });

  it("the SAME blob in any non-exempt file is still flagged (no broad weakening)", () => {
    expect(scanContentForSecrets(`"x": "${PLANTED_BASE58}"`, "examples/live/other.json").map((f) => f.rule)).toContain("base58-secret-blob");
  });
});

describe("safety:scan — catches the real leak shapes", () => {
  it("flags a high-entropy base58 secret blob", () => {
    const findings = scanContentForSecrets(`const k = "${PLANTED_BASE58}";`, "leak.ts");
    expect(findings.map((f) => f.rule)).toContain("base58-secret-blob");
    // The finding never echoes the secret bytes.
    expect(JSON.stringify(findings)).not.toContain(PLANTED_BASE58);
  });

  it("flags a solana-keygen private-key byte array", () => {
    const bytes = Array.from({ length: 64 }, (_, i) => (i * 7 + 13) % 256).join(",");
    const findings = scanContentForSecrets(`[${bytes}]`, "key.json");
    expect(findings.map((f) => f.rule)).toContain("private-key-byte-array");
  });

  it("flags an explicit secret assignment to a varied value", () => {
    // safety-scan-ignore: the next line is an intentional scanner fixture, not a real secret.
    const findings = scanContentForSecrets(`PRIVATE_KEY=ab12Cd34Ef56Gh78Ij90Kl12Mn34`, ".env.local");
    expect(findings.map((f) => f.rule)).toContain("secret-assignment");
  });
});

describe("safety:scan — does not false-positive on harmless content", () => {
  it("ignores a public key (<= 44 base58 chars)", () => {
    expect(scanContentForSecrets("So11111111111111111111111111111111111111112", "ex.json")).toEqual([]);
  });

  it("ignores low-entropy filler like a repeated character", () => {
    expect(scanContentForSecrets(`const f = "${"5".repeat(96)}";`, "t.test.ts")).toEqual([]);
  });

  it("ignores a 64-hex checksum inside a lock file", () => {
    const line = `checksum = "${"a1b2c3d4".repeat(8)}"`; // 64 hex chars
    expect(scanContentForSecrets(line, "Cargo.lock")).toEqual([]);
  });

  it("ignores an all-zero byte array (filler, not a key)", () => {
    const zeros = Array.from({ length: 64 }, () => 0).join(",");
    expect(scanContentForSecrets(`[${zeros}]`, "z.json")).toEqual([]);
  });

  it("ignores placeholder assignment values", () => {
    expect(scanContentForSecrets("PRIVATE_KEY=YOUR_PRIVATE_KEY_HERE_PLACEHOLDER", ".env.example")).toEqual([]);
  });

  it("respects an inline safety-scan-ignore marker", () => {
    const text = `const x = // safety-scan-ignore\n  "${PLANTED_BASE58}";`;
    expect(scanContentForSecrets(text, "t.ts")).toEqual([]);
  });
});

describe("safety:scan — filename + gitignore checks", () => {
  it("flags secret-bearing filenames but allows .env.example", () => {
    expect(isSecretFilename("runs/x.keypair")).toBe(true);
    expect(isSecretFilename("burner/wallet.json")).toBe(true);
    expect(isSecretFilename("secrets/prod.txt")).toBe(true);
    expect(isSecretFilename("config/foo.key")).toBe(true);
    expect(isSecretFilename(".env")).toBe(true);
    expect(isSecretFilename(".env.production")).toBe(true);
    expect(isSecretFilename(".env.example")).toBe(false);
    expect(isSecretFilename("packages/execution/src/signer.ts")).toBe(false);
  });

  it("reports a missing required .gitignore rule", () => {
    const partial = REQUIRED_GITIGNORE_RULES.slice(1).join("\n");
    expect(checkGitignoreCoverage(partial)).toContain(REQUIRED_GITIGNORE_RULES[0]);
  });
});
