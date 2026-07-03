import { describe, expect, it } from "vitest";

import {
  LIVE_OPERATOR_CONFIG_SCHEMA_VERSION,
  OPERATOR_MODE_RANK,
  OPERATOR_RUN_MODES,
  LiveOperatorConfigError,
  assertNoSecretMaterial,
  buildOperatorConfig,
  evaluateOperatorConfig,
  validateOperatorConfig,
} from "./operator-config.js";
import { LIVE_ESCALATION_HARD_CEILINGS } from "./escalation.js";

const WALLET = "CgGszXon2aemnsCYRSuguJqkFdSAwCPc31mFcHLDwbpV".slice(0, 44);
const GOOD = {
  operatorLabel: "prod-operator-1",
  rpcEndpointHttps: "https://api.mainnet-beta.solana.com",
} as const;

/** A complete, valid document as the validator expects it on disk. */
function completeDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: LIVE_OPERATOR_CONFIG_SCHEMA_VERSION,
    operatorLabel: "prod-operator-1",
    mode: "armed_canary",
    walletPublicKey: WALLET,
    rpcEndpointHttps: "https://api.mainnet-beta.solana.com",
    maxCanarySol: 0.005,
    maxCanariesPerSession: 1,
    maxCanariesPerDay: 1,
    maxDailyLossSol: 0.01,
    quoteTtlMs: 8000,
    maxSlippageBps: 100,
    cooldownMs: 300000,
    maxFailedAttempts: 1,
    killSwitchEngaged: false,
    emergencyStopEngaged: false,
    phantomApprovalRequired: true,
    largeTradesEnabled: false,
    backendCustodiesNoKeys: true,
    backendNeverSends: true,
    ...overrides,
  };
}

describe("buildOperatorConfig — conservative defaults", () => {
  it("defaults to mode off with the tiny escalation caps and pinned literals", () => {
    const c = buildOperatorConfig({ ...GOOD });
    expect(c.mode).toBe("off");
    expect(c.maxCanarySol).toBe(0.005);
    expect(c.maxCanariesPerSession).toBe(1);
    expect(c.killSwitchEngaged).toBe(false);
    expect(c.phantomApprovalRequired).toBe(true);
    expect(c.largeTradesEnabled).toBe(false);
    expect(c.backendCustodiesNoKeys).toBe(true);
    expect(c.backendNeverSends).toBe(true);
  });

  it("armed_canary REQUIRES a wallet public key", () => {
    expect(() => buildOperatorConfig({ ...GOOD, mode: "armed_canary" })).toThrow(/walletPublicKey/);
    const c = buildOperatorConfig({ ...GOOD, mode: "armed_canary", walletPublicKey: WALLET });
    expect(c.walletPublicKey).toBe(WALLET);
  });

  it("refuses a wallet key that is not a plausible base58 PUBLIC key", () => {
    expect(() => buildOperatorConfig({ ...GOOD, walletPublicKey: "notbase58!!!" })).toThrow(LiveOperatorConfigError);
    expect(() => buildOperatorConfig({ ...GOOD, walletPublicKey: "abc" })).toThrow(/base58 PUBLIC key/);
  });

  it("caps only tighten — over-ceiling values are refused, never clamped", () => {
    expect(() => buildOperatorConfig({ ...GOOD, maxCanarySol: LIVE_ESCALATION_HARD_CEILINGS.maxCanarySol + 0.001 })).toThrow(/hard ceiling/);
    expect(() => buildOperatorConfig({ ...GOOD, maxCanariesPerSession: 99 })).toThrow(/hard ceiling/);
    expect(() => buildOperatorConfig({ ...GOOD, maxDailyLossSol: 1 })).toThrow(/hard ceiling/);
    expect(() => buildOperatorConfig({ ...GOOD, maxSlippageBps: 10_000 })).toThrow(/hard ceiling/);
    expect(() => buildOperatorConfig({ ...GOOD, maxFailedAttempts: 50 })).toThrow(/hard ceiling/);
  });

  it("bounds the cooldown and the quote TTL on both sides", () => {
    expect(() => buildOperatorConfig({ ...GOOD, cooldownMs: 1000 })).toThrow(/cooldownMs/);
    expect(() => buildOperatorConfig({ ...GOOD, cooldownMs: 86_400_001 })).toThrow(/cooldownMs/);
    expect(() => buildOperatorConfig({ ...GOOD, quoteTtlMs: 100 })).toThrow(/quoteTtlMs/);
    expect(() => buildOperatorConfig({ ...GOOD, quoteTtlMs: 120_000 })).toThrow(/quoteTtlMs/);
  });
});

describe("RPC endpoint hardening", () => {
  it("requires https and refuses other schemes", () => {
    expect(() => buildOperatorConfig({ operatorLabel: "x", rpcEndpointHttps: "http://api.mainnet-beta.solana.com" })).toThrow(/https/);
    expect(() => buildOperatorConfig({ operatorLabel: "x", rpcEndpointHttps: "ws://api.mainnet-beta.solana.com" })).toThrow(/https/);
    expect(() => buildOperatorConfig({ operatorLabel: "x", rpcEndpointHttps: "not a url" })).toThrow(/parseable/);
  });

  it("refuses query strings (URL-embedded API keys), userinfo and fragments", () => {
    // A keyed query (?api-key=…) is refused even earlier, by the secret-shape scan.
    expect(() => buildOperatorConfig({ operatorLabel: "x", rpcEndpointHttps: "https://rpc.example.com/?api-key=abc123" })).toThrow(/secret-shaped/);
    expect(() => buildOperatorConfig({ operatorLabel: "x", rpcEndpointHttps: "https://rpc.example.com/?cluster=mainnet" })).toThrow(/query string/);
    expect(() => buildOperatorConfig({ operatorLabel: "x", rpcEndpointHttps: "https://user:pw@rpc.example.com/" })).toThrow(/userinfo/);
    expect(() => buildOperatorConfig({ operatorLabel: "x", rpcEndpointHttps: "https://rpc.example.com/#frag" })).toThrow(/fragment/);
  });
});

describe("secret material is refused ANYWHERE in the document (negative tests)", () => {
  const SECRET_FIELD_DOCS: Array<[string, Record<string, unknown>]> = [
    ["secretKey", completeDoc({ secretKey: "abc" })],
    ["privateKey", completeDoc({ privateKey: "abc" })],
    ["seedPhrase", completeDoc({ seedPhrase: "cat dog fish" })],
    ["mnemonic", completeDoc({ mnemonic: "cat dog fish" })],
    ["walletSeed", completeDoc({ walletSeed: "x" })],
    ["apiKey", completeDoc({ apiKey: "x" })],
    ["rpcKey", completeDoc({ rpcKey: "x" })],
    ["password", completeDoc({ password: "x" })],
    ["keypairPath", completeDoc({ keypairPath: "/tmp/k.json" })],
    ["nested.secretKey", completeDoc({ notes: { secretKey: "x" } }) as Record<string, unknown>],
  ];

  for (const [name, doc] of SECRET_FIELD_DOCS) {
    it(`refuses a config carrying "${name}"`, () => {
      expect(() => validateOperatorConfig(doc)).toThrow(LiveOperatorConfigError);
    });
  }

  it("refuses a secret-SHAPED string value (an ~88-char base58 blob) even under an innocent key", () => {
    const blob = "5".repeat(88); // long base58-alphabet run — redactString flags 80+
    expect(() => assertNoSecretMaterial({ note: blob })).toThrow(/secret-shaped/);
    expect(() => validateOperatorConfig(completeDoc({ operatorLabel: blob }))).toThrow(LiveOperatorConfigError);
  });

  it("refuses a long hex blob (raw private-key shaped)", () => {
    const hex = "a1b2c3d4".repeat(16); // 128 hex chars
    expect(() => assertNoSecretMaterial({ note: hex })).toThrow(/secret-shaped/);
  });

  it("refuses control characters / NUL / BOM in any string", () => {
    const nul = "abc" + String.fromCharCode(0) + "def";
    const bom = String.fromCharCode(0xfeff) + "abc";
    expect(() => assertNoSecretMaterial({ note: nul })).toThrow(/control character/);
    expect(() => assertNoSecretMaterial({ note: bom })).toThrow(/control character/);
    expect(() => validateOperatorConfig(completeDoc({ operatorLabel: nul }))).toThrow(LiveOperatorConfigError);
  });
});

describe("validateOperatorConfig — closed, complete, pinned", () => {
  it("accepts a complete valid document round-trip", () => {
    const c = validateOperatorConfig(completeDoc());
    expect(c.mode).toBe("armed_canary");
    expect(c.walletPublicKey).toBe(WALLET);
  });

  it("refuses unknown fields (closed schema)", () => {
    expect(() => validateOperatorConfig(completeDoc({ autoTrade: true }))).toThrow(/unknown field/);
  });

  it("refuses a missing required field — every control must be explicit", () => {
    const doc = completeDoc();
    delete doc.killSwitchEngaged;
    expect(() => validateOperatorConfig(doc)).toThrow(/missing required field/);
  });

  it("refuses tampered pinned literals", () => {
    expect(() => validateOperatorConfig(completeDoc({ phantomApprovalRequired: false }))).toThrow(/phantomApprovalRequired/);
    expect(() => validateOperatorConfig(completeDoc({ largeTradesEnabled: true }))).toThrow(/largeTradesEnabled/);
    expect(() => validateOperatorConfig(completeDoc({ backendNeverSends: false }))).toThrow(/backendNeverSends/);
    expect(() => validateOperatorConfig(completeDoc({ backendCustodiesNoKeys: "yes" }))).toThrow(/backendCustodiesNoKeys/);
  });

  it("refuses an unknown mode and non-boolean switches", () => {
    expect(() => validateOperatorConfig(completeDoc({ mode: "yolo" }))).toThrow(/mode must be one of/);
    expect(() => validateOperatorConfig(completeDoc({ killSwitchEngaged: "no" }))).toThrow(/killSwitchEngaged/);
  });
});

describe("evaluateOperatorConfig — report, never an authorization", () => {
  it("a green armed_canary config is permitted with no blockers (and still pins the literals)", () => {
    const v = evaluateOperatorConfig(validateOperatorConfig(completeDoc()));
    expect(v.armedCanaryPermitted).toBe(true);
    expect(v.blockingReasons).toEqual([]);
    expect(v.phantomApprovalRequired).toBe(true);
    expect(v.largeTradesEnabled).toBe(false);
    expect(v.notProfitabilityClaim).toBe(true);
  });

  it("kill switch and emergency stop each block armed_canary", () => {
    const kill = evaluateOperatorConfig(validateOperatorConfig(completeDoc({ killSwitchEngaged: true })));
    expect(kill.armedCanaryPermitted).toBe(false);
    expect(kill.blockingReasons).toContain("kill-switch-engaged");
    const stop = evaluateOperatorConfig(validateOperatorConfig(completeDoc({ emergencyStopEngaged: true })));
    expect(stop.armedCanaryPermitted).toBe(false);
    expect(stop.blockingReasons).toContain("emergency-stop-engaged");
  });

  it("a non-armed mode reports mode-not-armed-canary", () => {
    const v = evaluateOperatorConfig(validateOperatorConfig(completeDoc({ mode: "paper_shadow" })));
    expect(v.armedCanaryPermitted).toBe(false);
    expect(v.blockingReasons).toContain("mode-not-armed-canary");
  });

  it("echoes the endpoint HOST only, never the full URL", () => {
    const v = evaluateOperatorConfig(validateOperatorConfig(completeDoc({ rpcEndpointHttps: "https://rpc.example.com/some/path" })));
    expect(v.rpcEndpointHost).toBe("https://rpc.example.com");
    expect(JSON.stringify(v)).not.toContain("/some/path");
  });
});

describe("mode rank", () => {
  it("orders the four run modes off < observe_only < paper_shadow < armed_canary", () => {
    expect(OPERATOR_RUN_MODES).toEqual(["off", "observe_only", "paper_shadow", "armed_canary"]);
    expect(OPERATOR_MODE_RANK.off).toBeLessThan(OPERATOR_MODE_RANK.observe_only);
    expect(OPERATOR_MODE_RANK.observe_only).toBeLessThan(OPERATOR_MODE_RANK.paper_shadow);
    expect(OPERATOR_MODE_RANK.paper_shadow).toBeLessThan(OPERATOR_MODE_RANK.armed_canary);
  });
});
