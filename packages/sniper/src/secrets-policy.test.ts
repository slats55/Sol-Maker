/**
 * Tests for the Sprint 54 SNIPER SECRETS POLICY (`sniper.secrets.policy.v1`). The artifact stores NO
 * secret and grants NOTHING. The "secrets" used here are FAKE, deterministically-generated
 * key-SHAPED strings — never real key material.
 */

import { describe, it, expect } from "vitest";
import {
  buildSniperSecretsPolicy,
  validateSniperSecretsPolicy,
  formatSniperSecretsPolicy,
  SniperSecretsPolicyError,
  SNIPER_SECRETS_POLICY_SCHEMA_VERSION,
  SECRETS_POLICY_CORE_RULES,
} from "./secrets-policy.js";

// FAKE, deterministic key-SHAPED strings (not real secrets).
const FAKE_BASE58_SECRET = "2".repeat(88);
const FAKE_HEX_SECRET = "ab".repeat(32);
const FAKE_MNEMONIC = "abandon ability able about above absent absorb abstract absurd abuse access account";

describe("buildSniperSecretsPolicy — safe policies", () => {
  it("builds a conservative draft policy with the six core rules permanently true", () => {
    const p = buildSniperSecretsPolicy({ operatorLabel: "op" });
    expect(p.schemaVersion).toBe(SNIPER_SECRETS_POLICY_SCHEMA_VERSION);
    expect(p.storesNoSecretMaterial).toBe(true);
    for (const rule of SECRETS_POLICY_CORE_RULES) {
      expect(p[rule], rule).toBe(true);
    }
    expect(p.readinessStatus).toBe("draft");
    expect(p.adopted).toBe(false);
    expect(p.handlingRules.length).toBeGreaterThan(0);
    expect(() => validateSniperSecretsPolicy(p)).not.toThrow();
  });

  it("merges operator additions and honors adopted; deterministic", () => {
    const input = { operatorLabel: "op", additionalRules: ["rotate burner labels per session"], readinessStatus: "adopted" as const };
    const p = buildSniperSecretsPolicy(input);
    expect(p.adopted).toBe(true);
    expect(p.handlingRules).toContain("rotate burner labels per session");
    expect(JSON.stringify(buildSniperSecretsPolicy(input))).toBe(JSON.stringify(p));
  });
});

describe("buildSniperSecretsPolicy — REFUSES secret-shaped input (never echoing it)", () => {
  it("refuses secret-bearing keys without reading their values", () => {
    for (const key of ["privateKey", "secretKey", "mnemonic", "seedPhrase", "keypair", "myCredential"]) {
      try {
        buildSniperSecretsPolicy({ [key]: "anything" } as never);
        expect.unreachable(`key ${key} should have been refused`);
      } catch (err) {
        expect(err).toBeInstanceOf(SniperSecretsPolicyError);
        expect((err as Error).message).toContain("secret-bearing");
        expect((err as Error).message).not.toContain("anything");
      }
    }
  });

  it("refuses key-SHAPED string values anywhere in the input — and never echoes them", () => {
    for (const fake of [FAKE_BASE58_SECRET, FAKE_HEX_SECRET, `0x${FAKE_HEX_SECRET}`, FAKE_MNEMONIC]) {
      try {
        buildSniperSecretsPolicy({ additionalRules: ["note: x", fake] });
        expect.unreachable("should have been refused");
      } catch (err) {
        expect(err).toBeInstanceOf(SniperSecretsPolicyError);
        expect((err as Error).message).toContain("not echoed");
        expect((err as Error).message).not.toContain(fake);
      }
    }
  });

  it("refuses nested secret-shaped content too", () => {
    expect(() => buildSniperSecretsPolicy({ redactionNotes: [FAKE_BASE58_SECRET] })).toThrow(/REFUSED/);
  });

  it("accepts ordinary prose (no false refusal on normal sentences)", () => {
    expect(() =>
      buildSniperSecretsPolicy({
        additionalRules: ["operators must never paste wallet exports into any prompt, file, or chat"],
        redactionNotes: ["redact operator notes that mention balances"],
      }),
    ).not.toThrow();
  });
});

describe("validateSniperSecretsPolicy — a weakened policy is refused", () => {
  it("refuses any core rule flipped to false", () => {
    const p = buildSniperSecretsPolicy({});
    for (const rule of SECRETS_POLICY_CORE_RULES) {
      const tampered = JSON.parse(JSON.stringify(p));
      tampered[rule] = false;
      expect(() => validateSniperSecretsPolicy(tampered), rule).toThrow(/weakened secrets policy is REFUSED/);
    }
    const noStore = JSON.parse(JSON.stringify(p));
    noStore.storesNoSecretMaterial = false;
    expect(() => validateSniperSecretsPolicy(noStore)).toThrow(/storesNoSecretMaterial/);
  });

  it("refuses an artifact whose values were hand-edited to carry secret-shaped content", () => {
    const p = buildSniperSecretsPolicy({});
    const tampered = JSON.parse(JSON.stringify(p));
    tampered.notes.push(FAKE_BASE58_SECRET);
    expect(() => validateSniperSecretsPolicy(tampered)).toThrow(/key-shaped value/);
  });

  it("refuses a broken adopted mirror and empty handling rules", () => {
    const p = buildSniperSecretsPolicy({});
    const a = JSON.parse(JSON.stringify(p));
    a.adopted = true;
    expect(() => validateSniperSecretsPolicy(a)).toThrow(/mirror readinessStatus/);

    const b = JSON.parse(JSON.stringify(p));
    b.handlingRules = [];
    expect(() => validateSniperSecretsPolicy(b)).toThrow(/handlingRules/);
  });
});

describe("formatSniperSecretsPolicy — never logs a secret", () => {
  it("renders the STORES-NO-SECRET banner and the six core rules", () => {
    const p = buildSniperSecretsPolicy({ operatorLabel: "op", readinessStatus: "adopted" });
    const text = formatSniperSecretsPolicy(p, { label: "t" });
    expect(text).toContain("STORES NO SECRET");
    expect(text).toContain("- forbid main wallet use: true");
    expect(text).toContain("- forbid seed phrase storage: true");
    expect(text).toContain("require an explicit dangerous opt-in");
    expect(formatSniperSecretsPolicy(p, { label: "t" })).toBe(text);
  });

  it("the formatter output carries no key-shaped span (redactor-wrapped)", () => {
    const p = buildSniperSecretsPolicy({});
    const text = formatSniperSecretsPolicy(p);
    expect(text).not.toMatch(/[1-9A-HJ-NP-Za-km-z]{64,}/);
  });
});
