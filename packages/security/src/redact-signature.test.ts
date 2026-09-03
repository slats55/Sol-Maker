import { describe, expect, it } from "vitest";
import { REDACTED, redactString, redactValue } from "./redact.js";

const SIG = "3".repeat(88); // shape-identical to a base58 64-byte secret key

describe("redactValue — S111 signature preservation", () => {
  it("preserves a well-formed signature under a signature-named key", () => {
    const out = redactValue({ signature: SIG, entrySignature: SIG, close: { signature: SIG } }) as Record<string, unknown>;
    expect(out.signature).toBe(SIG);
    expect(out.entrySignature).toBe(SIG);
    expect((out.close as Record<string, unknown>).signature).toBe(SIG);
  });

  it("still redacts the same blob under ANY other key, and in free text", () => {
    const out = redactValue({ note: SIG, blob: `sig ${SIG}`, secretKey: SIG }) as Record<string, unknown>;
    expect(out.note).toBe(REDACTED);
    expect(out.blob).toBe(`sig ${REDACTED}`);
    expect(out.secretKey).toBe(REDACTED);
    expect(redactString(SIG)).toBe(REDACTED);
  });

  it("does not preserve a malformed value under a signature key (wrong length, embedded text)", () => {
    const out = redactValue({ signature: `${SIG}${SIG}`, txSignature: `x ${SIG}` }) as Record<string, unknown>;
    expect(out.signature).toBe(REDACTED);
    expect(out.txSignature).toBe(`x ${REDACTED}`);
  });
});
