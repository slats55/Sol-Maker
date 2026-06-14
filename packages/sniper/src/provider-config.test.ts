import { describe, it, expect } from "vitest";
import {
  resolveReadonlyProviderConfig,
  ReadonlyProviderConfigError,
  READONLY_PROVIDER_ENV_VARS,
  DEFAULT_MAINNET_RPC_URL,
  DEFAULT_DEVNET_RPC_URL,
  DEFAULT_JUPITER_QUOTE_URL,
  PROVIDER_TIMEOUT_MS_MIN,
  PROVIDER_TIMEOUT_MS_MAX,
  PROVIDER_TIMEOUT_MS_DEFAULT,
  PROVIDER_RETRY_LIMIT_MAX,
  PROVIDER_RETRY_LIMIT_DEFAULT,
} from "./provider-config.js";

describe("resolveReadonlyProviderConfig — defaults", () => {
  it("falls back to safe public, keyless defaults when nothing is supplied", () => {
    const cfg = resolveReadonlyProviderConfig();
    expect(cfg.mode).toBe("paper");
    expect(cfg.network).toBe("mainnet-beta");
    expect(cfg.rpc.url).toBe(DEFAULT_MAINNET_RPC_URL);
    expect(cfg.rpc.source).toBe("default");
    expect(cfg.rpc.valid).toBe(true);
    expect(cfg.rpc.containsSecret).toBe(false);
    expect(cfg.jupiterQuote.url).toBe(DEFAULT_JUPITER_QUOTE_URL);
    expect(cfg.timeoutMs).toBe(PROVIDER_TIMEOUT_MS_DEFAULT);
    expect(cfg.retryLimit).toBe(PROVIDER_RETRY_LIMIT_DEFAULT);
    expect(cfg.providerProfile).toBe("public-default");
  });

  it("derives the devnet RPC default in devnet-review mode", () => {
    const cfg = resolveReadonlyProviderConfig({ flags: { mode: "devnet-review" } });
    expect(cfg.network).toBe("devnet");
    expect(cfg.rpc.url).toBe(DEFAULT_DEVNET_RPC_URL);
  });
});

describe("resolveReadonlyProviderConfig — display + redaction", () => {
  it("shows a safe public endpoint scheme://host with no redaction", () => {
    const cfg = resolveReadonlyProviderConfig({ flags: { rpcUrl: "https://api.mainnet-beta.solana.com" } });
    expect(cfg.rpc.redacted.display).toBe("https://api.mainnet-beta.solana.com");
    expect(cfg.rpc.redacted.redactionApplied).toBe(false);
    expect(cfg.rpc.containsSecret).toBe(false);
  });

  it("redacts an endpoint that carries an ?api-key= query token", () => {
    const cfg = resolveReadonlyProviderConfig({ flags: { rpcUrl: "https://mainnet.helius-rpc.com/?api-key=supersecret123" } });
    expect(cfg.rpc.redacted.display).toBe("https://mainnet.helius-rpc.com");
    expect(cfg.rpc.redacted.display).not.toContain("supersecret123");
    expect(cfg.rpc.containsSecret).toBe(true);
    expect(cfg.notes.join(" ")).toMatch(/embeds credentials/);
  });

  it("redacts an endpoint with username:password userinfo", () => {
    const cfg = resolveReadonlyProviderConfig({ flags: { rpcUrl: "https://user:hunter2@rpc.example.com/path" } });
    expect(cfg.rpc.redacted.display).toBe("https://rpc.example.com");
    expect(cfg.rpc.redacted.display).not.toContain("hunter2");
    expect(cfg.rpc.containsSecret).toBe(true);
  });

  it("never carries a secret-shaped raw URL into the display", () => {
    const cfg = resolveReadonlyProviderConfig({ flags: { jupiterUrl: "https://quote.example.com/v1/aVeryLongOpaqueTokenSegment1234567890" } });
    expect(cfg.jupiterQuote.redacted.display).toBe("https://quote.example.com");
  });
});

describe("resolveReadonlyProviderConfig — invalid endpoints", () => {
  it("marks an unparseable URL invalid without throwing", () => {
    const cfg = resolveReadonlyProviderConfig({ flags: { rpcUrl: "not a url" } });
    expect(cfg.rpc.valid).toBe(false);
    expect(cfg.rpc.redacted.display).toBe("[invalid-endpoint]");
    expect(cfg.notes.join(" ")).toMatch(/misconfigured/);
  });

  it("marks a non-http(s) scheme invalid", () => {
    const cfg = resolveReadonlyProviderConfig({ flags: { rpcUrl: "ws://rpc.example.com" } });
    expect(cfg.rpc.valid).toBe(false);
    expect(cfg.rpc.redacted.display).toBe("[unsupported-scheme]");
  });
});

describe("resolveReadonlyProviderConfig — precedence", () => {
  it("prefers a flag over env over default", () => {
    const env = {
      [READONLY_PROVIDER_ENV_VARS.rpcUrl]: "https://env-rpc.example.com",
    };
    const flagWins = resolveReadonlyProviderConfig({ flags: { rpcUrl: "https://flag-rpc.example.com" }, env });
    expect(flagWins.rpc.url).toBe("https://flag-rpc.example.com");
    expect(flagWins.rpc.source).toBe("flag");

    const envWins = resolveReadonlyProviderConfig({ env });
    expect(envWins.rpc.url).toBe("https://env-rpc.example.com");
    expect(envWins.rpc.source).toBe("env");
    expect(envWins.providerProfile).toBe("custom");
  });

  it("uses the existing SOULMAKER_RPC_URL as a fallback when the read-only var is unset", () => {
    const cfg = resolveReadonlyProviderConfig({ env: { [READONLY_PROVIDER_ENV_VARS.rpcUrlFallback]: "https://legacy-rpc.example.com" } });
    expect(cfg.rpc.url).toBe("https://legacy-rpc.example.com");
    expect(cfg.rpc.source).toBe("env");
  });
});

describe("resolveReadonlyProviderConfig — bounds", () => {
  it("clamps a too-large timeout to the ceiling and notes it", () => {
    const cfg = resolveReadonlyProviderConfig({ flags: { timeoutMs: "9999999" } });
    expect(cfg.timeoutMs).toBe(PROVIDER_TIMEOUT_MS_MAX);
    expect(cfg.notes.join(" ")).toMatch(/timeout/);
  });

  it("clamps a too-small timeout to the floor", () => {
    const cfg = resolveReadonlyProviderConfig({ flags: { timeoutMs: "1" } });
    expect(cfg.timeoutMs).toBe(PROVIDER_TIMEOUT_MS_MIN);
  });

  it("clamps a too-large retry limit to the ceiling", () => {
    const cfg = resolveReadonlyProviderConfig({ flags: { retryLimit: "1000" } });
    expect(cfg.retryLimit).toBe(PROVIDER_RETRY_LIMIT_MAX);
  });

  it("reads bounds from env when no flag is given", () => {
    const cfg = resolveReadonlyProviderConfig({
      env: { [READONLY_PROVIDER_ENV_VARS.timeoutMs]: "5000", [READONLY_PROVIDER_ENV_VARS.retryLimit]: "3" },
    });
    expect(cfg.timeoutMs).toBe(5000);
    expect(cfg.retryLimit).toBe(3);
  });

  it("ignores a non-numeric bound and keeps the default", () => {
    const cfg = resolveReadonlyProviderConfig({ flags: { timeoutMs: "abc" } });
    expect(cfg.timeoutMs).toBe(PROVIDER_TIMEOUT_MS_DEFAULT);
  });
});

describe("resolveReadonlyProviderConfig — mode validation + read-only invariant", () => {
  it("throws on an unknown mode", () => {
    expect(() => resolveReadonlyProviderConfig({ flags: { mode: "mainnet-live" } })).toThrow(ReadonlyProviderConfigError);
  });

  it("config can never enable send / sign / live (the literals are pinned and there is no such field)", () => {
    const cfg = resolveReadonlyProviderConfig();
    expect(cfg.readOnly).toBe(true);
    expect(cfg.noSend).toBe(true);
    expect(cfg.noSigner).toBe(true);
    const keys = Object.keys(cfg);
    for (const forbidden of ["send", "sign", "signer", "live", "wallet", "keypair", "armed", "broadcast"]) {
      expect(keys.some((k) => k.toLowerCase().includes(forbidden) && !["noSend", "noSigner"].includes(k))).toBe(false);
    }
  });
});
