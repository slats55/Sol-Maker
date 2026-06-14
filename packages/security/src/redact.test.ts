import { describe, it, expect } from "vitest";
import {
  REDACTED,
  isSensitiveKey,
  redactString,
  redactValue,
  redactEndpoint,
} from "./redact.js";

// A realistic-looking but entirely fake 64-byte base58 secret key (~88 chars).
const FAKE_BASE58_SECRET = // safety-scan-ignore: intentional redactor test fixture, not a real key.
  "4wBqpZM9xaSheZzJSMawUHDgZ7miWfSsxmV1DxAVN1rJ8sPT3v9nQk7mRsV2yZ8bC4dE6fG1hJ3kL5mN7pQ9rS";
const FAKE_HEX_SECRET = "a".repeat(64);
const FAKE_MNEMONIC =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";

describe("isSensitiveKey", () => {
  it.each([
    "privateKey",
    "private_key",
    "PRIVATE-KEY",
    "secretKey",
    "seed",
    "seedPhrase",
    "mnemonic",
    "recoveryPhrase",
    "apiKey",
    "api_key",
    "rpcKey",
    "authorization",
    "auth",
    "cookie",
    "sessionToken",
    "bearer",
    "password",
    "walletSecret",
    "keypair",
  ])("flags %s as sensitive", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(["mode", "rpcUrl", "amount", "publicKey", "tokenMint", "msg"])(
    "does not flag %s",
    (key) => {
      expect(isSensitiveKey(key)).toBe(false);
    },
  );
});

describe("redactString", () => {
  it("redacts bearer tokens", () => {
    const out = redactString("Authorization: Bearer abc123.def456-ghi");
    expect(out).toContain(`Bearer ${REDACTED}`);
    expect(out).not.toContain("abc123");
  });

  it("redacts api-key query params but keeps the rest of the url", () => {
    const out = redactString("https://rpc.example.com/?api-key=supersecret123&x=1");
    expect(out).not.toContain("supersecret123");
    expect(out).toContain("rpc.example.com");
    expect(out).toContain("x=1");
  });

  it("redacts long base58 secret blobs", () => {
    expect(redactString(`key is ${FAKE_BASE58_SECRET} ok`)).not.toContain(
      FAKE_BASE58_SECRET,
    );
  });

  it("redacts long hex secret blobs", () => {
    expect(redactString(`0x${FAKE_HEX_SECRET}`)).toContain(REDACTED);
  });

  it("redacts BIP39-style mnemonics", () => {
    const out = redactString(FAKE_MNEMONIC);
    expect(out).toContain(REDACTED);
    expect(out).not.toContain("sausage");
  });

  it("leaves a normal public key untouched", () => {
    const pubkey = "So11111111111111111111111111111111111111112";
    expect(redactString(`mint ${pubkey}`)).toContain(pubkey);
  });
});

describe("redactValue", () => {
  it("redacts by sensitive key name regardless of value shape", () => {
    const out = redactValue({
      privateKey: FAKE_BASE58_SECRET,
      seedPhrase: FAKE_MNEMONIC,
      apiKey: "k_live_123",
      nested: { cookie: "session=abc", publicKey: "pubkey123" },
    }) as {
      privateKey: unknown;
      seedPhrase: unknown;
      apiKey: unknown;
      nested: { cookie: unknown; publicKey: unknown };
    };

    expect(out.privateKey).toBe(REDACTED);
    expect(out.seedPhrase).toBe(REDACTED);
    expect(out.apiKey).toBe(REDACTED);
    expect(out.nested.cookie).toBe(REDACTED);
    expect(out.nested.publicKey).toBe("pubkey123");
  });

  it("redacts secret-looking values even under innocent keys", () => {
    const out = redactValue({ note: `leaked ${FAKE_BASE58_SECRET}` }) as Record<
      string,
      string
    >;
    expect(out.note).not.toContain(FAKE_BASE58_SECRET);
  });

  it("never serializes raw byte arrays (possible key material)", () => {
    const out = redactValue({ bytes: new Uint8Array([1, 2, 3, 4]) }) as Record<
      string,
      string
    >;
    expect(out.bytes).toBe("[bytes(4)]");
  });

  it("handles circular references without throwing", () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    expect(() => redactValue(obj)).not.toThrow();
  });

  it("redacts secrets inside Error messages", () => {
    const out = redactValue(
      new Error(`failed with key ${FAKE_BASE58_SECRET}`),
    ) as Record<string, string>;
    expect(out.message).not.toContain(FAKE_BASE58_SECRET);
  });

  it("does not mutate the input", () => {
    const input = { privateKey: "secret" };
    redactValue(input);
    expect(input.privateKey).toBe("secret");
  });
});

describe("redactEndpoint", () => {
  it("shows scheme://host for a safe public endpoint, no redaction applied", () => {
    const out = redactEndpoint("https://api.mainnet-beta.solana.com");
    expect(out.display).toBe("https://api.mainnet-beta.solana.com");
    expect(out.valid).toBe(true);
    expect(out.redactionApplied).toBe(false);
  });

  it("keeps a non-default port but still drops everything after the host", () => {
    const out = redactEndpoint("http://localhost:8899/health");
    expect(out.display).toBe("http://localhost:8899");
    expect(out.valid).toBe(true);
    expect(out.redactionApplied).toBe(true);
  });

  it("drops an ?api-key= query token (never echoes the secret)", () => {
    const out = redactEndpoint("https://mainnet.helius-rpc.com/?api-key=supersecret123");
    expect(out.display).toBe("https://mainnet.helius-rpc.com");
    expect(out.display).not.toContain("supersecret123");
    expect(out.valid).toBe(true);
    expect(out.redactionApplied).toBe(true);
  });

  it("drops a key embedded in an opaque path segment", () => {
    const out = redactEndpoint("https://rpc.example.com/v1/abcDEF1234567890key");
    expect(out.display).toBe("https://rpc.example.com");
    expect(out.display).not.toContain("abcDEF1234567890key");
    expect(out.redactionApplied).toBe(true);
  });

  it("drops userinfo (user:password@host)", () => {
    const out = redactEndpoint("https://user:hunter2@rpc.example.com/path");
    expect(out.display).toBe("https://rpc.example.com");
    expect(out.display).not.toContain("hunter2");
    expect(out.display).not.toContain("user");
    expect(out.redactionApplied).toBe(true);
  });

  it("refuses an unparseable URL without echoing it", () => {
    const out = redactEndpoint("not a url at all");
    expect(out.display).toBe("[invalid-endpoint]");
    expect(out.valid).toBe(false);
    expect(out.redactionApplied).toBe(true);
  });

  it("refuses a non-http(s) scheme", () => {
    const out = redactEndpoint("ws://rpc.example.com");
    expect(out.display).toBe("[unsupported-scheme]");
    expect(out.valid).toBe(false);
  });

  it("returns a no-endpoint placeholder for empty / non-string input", () => {
    expect(redactEndpoint("").display).toBe("[no-endpoint]");
    expect(redactEndpoint("").valid).toBe(false);
    expect(redactEndpoint(undefined).display).toBe("[no-endpoint]");
    expect(redactEndpoint(null).valid).toBe(false);
    expect(redactEndpoint(42 as unknown).valid).toBe(false);
  });
});
