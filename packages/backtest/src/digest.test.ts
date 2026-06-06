import { describe, it, expect } from "vitest";
import { canonicalize, digestContent } from "./digest.js";

describe("canonicalize", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ z: { y: 1, x: 2 }, a: 3 })).toBe('{"a":3,"z":{"x":2,"y":1}}');
  });

  it("preserves array order (order is meaningful for steps/prices)", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("drops undefined object values (matching JSON.stringify)", () => {
    expect(canonicalize({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it("encodes primitives stably", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize("hi")).toBe('"hi"');
    expect(canonicalize(1.5)).toBe("1.5");
  });
});

describe("digestContent", () => {
  it("is a 16-hex-character string", () => {
    expect(digestContent({ a: 1 })).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic for the same content", () => {
    expect(digestContent({ a: 1, b: [1, 2, 3] })).toBe(digestContent({ a: 1, b: [1, 2, 3] }));
  });

  it("is stable across object key order (canonical)", () => {
    expect(digestContent({ a: 1, b: 2 })).toBe(digestContent({ b: 2, a: 1 }));
  });

  it("differs for different content", () => {
    expect(digestContent({ a: 1 })).not.toBe(digestContent({ a: 2 }));
  });

  it("is sensitive to array order (order matters)", () => {
    expect(digestContent([1, 2, 3])).not.toBe(digestContent([3, 2, 1]));
  });
});
