/**
 * Sprint 103-B — the devnet funding-status builder/validator.
 *
 * `execution.devnet.funding_status.v1` retains one honest devnet balance observation. These tests pin:
 *   - funded / unfunded / faucet-429 / faucet-unavailable / rpc-unavailable / malformed-RPC paths;
 *   - `funded` and `canBroadcastDevnetProbe` are RE-DERIVED — an unobserved balance is never funded;
 *   - the public key must be a real base58 Solana key; a secret-shaped string is refused;
 *   - the network literal is pinned `devnet` (no mainnet) and the safety locks cannot be flipped;
 *   - the validator is a closed-schema parity wall: a tampered funded/status/unknown-field is refused.
 */

import { describe, it, expect } from "vitest";
import {
  buildDevnetFundingStatus,
  validateDevnetFundingStatus,
  deriveDevnetFundingSourceStatus,
  DevnetFundingStatusError,
  DEVNET_FUNDING_STATUS_SCHEMA_VERSION,
  DEVNET_FUNDING_DEFAULT_MIN_LAMPORTS,
  type DevnetFaucetAttemptSummary,
} from "./devnet-funding-status.js";

// A real base58 Solana public key (the historical S103 throwaway rehearsal key — public data).
const PUBKEY = "8FenZasyRe3HeUEm4X8iTAufaamnryU2JB8cRzWyHgwm";

function rateLimited(): DevnetFaucetAttemptSummary {
  return { attempted: true, attempts: 5, maxAttempts: 5, outcome: "rate-limited", detail: "airdrop request returned 429" };
}

describe("devnet funding-status — builder paths", () => {
  it("funded: observed balance at/above the minimum derives funded + can-broadcast", () => {
    const r = buildDevnetFundingStatus({ publicKey: PUBKEY, balance: { status: "observed", lamports: 1_000_000_000 } });
    expect(r.schemaVersion).toBe(DEVNET_FUNDING_STATUS_SCHEMA_VERSION);
    expect(r.network).toBe("devnet");
    expect(r.lamports).toBe(1_000_000_000);
    expect(r.solBalance).toBe(1);
    expect(r.minimumRequiredLamports).toBe(DEVNET_FUNDING_DEFAULT_MIN_LAMPORTS);
    expect(r.funded).toBe(true);
    expect(r.canBroadcastDevnetProbe).toBe(true);
    expect(r.fundingSourceStatus).toBe("funded");
    expect(r.faucetAttemptSummary).toBeNull();
    expect(r.neverMainnet).toBe(true);
    expect(r.phase7LiveTradingReady).toBe(false);
    expect(() => validateDevnetFundingStatus(r)).not.toThrow();
  });

  it("unfunded: observed but below the minimum is unfunded and cannot broadcast", () => {
    const r = buildDevnetFundingStatus({ publicKey: PUBKEY, balance: { status: "observed", lamports: 0 } });
    expect(r.funded).toBe(false);
    expect(r.canBroadcastDevnetProbe).toBe(false);
    expect(r.fundingSourceStatus).toBe("unfunded");
    expect(r.solBalance).toBe(0);
    expect(r.nextSafeAction).toContain("faucet.solana.com");
    expect(() => validateDevnetFundingStatus(r)).not.toThrow();
  });

  it("faucet 429: a short balance plus a rate-limited airdrop derives faucet-rate-limited", () => {
    const r = buildDevnetFundingStatus({ publicKey: PUBKEY, balance: { status: "observed", lamports: 10 }, faucetAttempt: rateLimited() });
    expect(r.funded).toBe(false);
    expect(r.fundingSourceStatus).toBe("faucet-rate-limited");
    expect(r.faucetAttemptSummary?.outcome).toBe("rate-limited");
    expect(r.nextSafeAction).toContain("429");
    expect(() => validateDevnetFundingStatus(r)).not.toThrow();
  });

  it("faucet-unavailable: a short balance plus an unavailable airdrop derives faucet-unavailable", () => {
    const r = buildDevnetFundingStatus({
      publicKey: PUBKEY,
      balance: { status: "observed", lamports: 10 },
      faucetAttempt: { attempted: true, attempts: 1, maxAttempts: 3, outcome: "unavailable", detail: "faucet outage" },
    });
    expect(r.fundingSourceStatus).toBe("faucet-unavailable");
    expect(() => validateDevnetFundingStatus(r)).not.toThrow();
  });

  it("a funded balance ignores a faucet attempt and still reads funded", () => {
    const r = buildDevnetFundingStatus({
      publicKey: PUBKEY,
      balance: { status: "observed", lamports: 2_000_000_000 },
      faucetAttempt: { attempted: true, attempts: 1, maxAttempts: 3, outcome: "submitted", detail: "airdrop submitted" },
    });
    expect(r.fundingSourceStatus).toBe("funded");
    expect(r.funded).toBe(true);
  });

  it("rpc-unavailable: a failed balance read has no lamports and cannot be funded", () => {
    const r = buildDevnetFundingStatus({ publicKey: PUBKEY, balance: { status: "rpc-unavailable", detail: "connect ETIMEDOUT" } });
    expect(r.lamports).toBeNull();
    expect(r.solBalance).toBeNull();
    expect(r.funded).toBe(false);
    expect(r.canBroadcastDevnetProbe).toBe(false);
    expect(r.fundingSourceStatus).toBe("rpc-unavailable");
    expect(r.balanceReadDetail).toBe("connect ETIMEDOUT");
    expect(() => validateDevnetFundingStatus(r)).not.toThrow();
  });

  it("unknown: a malformed RPC response is honestly unknown, never funded", () => {
    const r = buildDevnetFundingStatus({ publicKey: PUBKEY, balance: { status: "unknown", detail: "RPC returned a non-numeric balance" } });
    expect(r.lamports).toBeNull();
    expect(r.funded).toBe(false);
    expect(r.fundingSourceStatus).toBe("unknown");
    expect(() => validateDevnetFundingStatus(r)).not.toThrow();
  });

  it("honors a custom minimum when re-deriving funded", () => {
    const r = buildDevnetFundingStatus({ publicKey: PUBKEY, minimumRequiredLamports: 5_000_000, balance: { status: "observed", lamports: 1_000_000 } });
    expect(r.minimumRequiredLamports).toBe(5_000_000);
    expect(r.funded).toBe(false);
    expect(r.fundingSourceStatus).toBe("unfunded");
  });
});

describe("devnet funding-status — public key + secret safety", () => {
  it("rejects a non-base58 / wrong-length public key", () => {
    expect(() => buildDevnetFundingStatus({ publicKey: "not-a-key", balance: { status: "observed", lamports: 1 } })).toThrow(DevnetFundingStatusError);
    expect(() => buildDevnetFundingStatus({ publicKey: "0OIl-invalid", balance: { status: "observed", lamports: 1 } })).toThrow(DevnetFundingStatusError);
  });

  it("refuses a secret-shaped balance detail rather than serializing it", () => {
    expect(() =>
      buildDevnetFundingStatus({ publicKey: PUBKEY, balance: { status: "rpc-unavailable", detail: `Bearer ${"a".repeat(40)}` } }),
    ).not.toThrow();
    const r = buildDevnetFundingStatus({ publicKey: PUBKEY, balance: { status: "rpc-unavailable", detail: `Bearer ${"a".repeat(40)}` } });
    // The redactor scrubs the secret-shaped token and flags that redaction was applied.
    expect(r.balanceReadDetail).not.toContain("aaaa");
    expect(r.redactionApplied).toBe(true);
  });

  it("never carries a private/secret key field anywhere in the artifact JSON", () => {
    const r = buildDevnetFundingStatus({ publicKey: PUBKEY, balance: { status: "observed", lamports: 1_000_000_000 } });
    const json = JSON.stringify(r).toLowerCase();
    for (const forbidden of ["secretkey", "privatekey", "seed", "mnemonic", "keypair"]) {
      expect(json.includes(forbidden)).toBe(false);
    }
  });
});

describe("devnet funding-status — validator parity wall", () => {
  function funded(): Record<string, unknown> {
    return buildDevnetFundingStatus({ publicKey: PUBKEY, balance: { status: "observed", lamports: 1_000_000_000 } }) as unknown as Record<string, unknown>;
  }

  it("rejects an unknown field (closed schema)", () => {
    const v = funded();
    v["extra"] = "x";
    expect(() => validateDevnetFundingStatus(v)).toThrow(/CLOSED/);
  });

  it("rejects a mainnet network", () => {
    const v = funded();
    v["network"] = "mainnet-beta";
    expect(() => validateDevnetFundingStatus(v)).toThrow(/devnet/);
  });

  it("refuses a tampered funded that outruns the observed lamports", () => {
    const v = buildDevnetFundingStatus({ publicKey: PUBKEY, balance: { status: "observed", lamports: 0 } }) as unknown as Record<string, unknown>;
    v["funded"] = true;
    v["canBroadcastDevnetProbe"] = true;
    v["fundingSourceStatus"] = "funded";
    expect(() => validateDevnetFundingStatus(v)).toThrow(/re-derived/);
  });

  it("refuses a funded read with no observed balance (rpc-unavailable can never be funded)", () => {
    const v = funded();
    v["balanceReadStatus"] = "rpc-unavailable";
    v["lamports"] = null;
    v["balanceReadDetail"] = "rpc down";
    // funded/canBroadcast/status still say funded -> parity wall refuses.
    expect(() => validateDevnetFundingStatus(v)).toThrow(DevnetFundingStatusError);
  });

  it("refuses a flipped neverMainnet / phase7LiveTradingReady lock", () => {
    for (const [field, bad] of [
      ["neverMainnet", false],
      ["phase7LiveTradingReady", true],
    ] as const) {
      const v = funded();
      v[field] = bad;
      expect(() => validateDevnetFundingStatus(v), field).toThrow(DevnetFundingStatusError);
    }
  });

  it("the derivation helper is total over the closed status set", () => {
    expect(deriveDevnetFundingSourceStatus("observed", true, null)).toBe("funded");
    expect(deriveDevnetFundingSourceStatus("observed", false, null)).toBe("unfunded");
    expect(deriveDevnetFundingSourceStatus("observed", false, "rate-limited")).toBe("faucet-rate-limited");
    expect(deriveDevnetFundingSourceStatus("observed", false, "unavailable")).toBe("faucet-unavailable");
    expect(deriveDevnetFundingSourceStatus("rpc-unavailable", false, null)).toBe("rpc-unavailable");
    expect(deriveDevnetFundingSourceStatus("unknown", false, null)).toBe("unknown");
  });
});
