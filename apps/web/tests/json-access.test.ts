import { describe, expect, it } from "vitest";

import {
  TYPED_VIEW_LIMITS,
  asArray,
  asRecord,
  capRows,
  formatBytes,
  formatNumber,
  formatSigned,
  readArray,
  readBoolean,
  readDelta,
  readNumber,
  readRecord,
  readString,
  readStringArray,
  shortDigest,
  truncateText,
} from "../src/lib/json-access.js";

describe("asRecord / asArray", () => {
  it("narrows plain objects only", () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord([1, 2])).toBeNull();
    expect(asRecord(null)).toBeNull();
    expect(asRecord("x")).toBeNull();
    expect(asRecord(3)).toBeNull();
  });

  it("narrows arrays only", () => {
    expect(asArray([1, 2])).toEqual([1, 2]);
    expect(asArray({ a: 1 })).toBeNull();
    expect(asArray(null)).toBeNull();
  });
});

describe("readString", () => {
  it("reads a non-empty string", () => {
    expect(readString({ k: "hi" }, "k")).toBe("hi");
  });
  it("returns null for empty / missing / non-string", () => {
    expect(readString({ k: "" }, "k")).toBeNull();
    expect(readString({}, "k")).toBeNull();
    expect(readString({ k: 3 }, "k")).toBeNull();
    expect(readString({ k: null }, "k")).toBeNull();
  });
  it("caps very long strings", () => {
    const long = "x".repeat(5000);
    const out = readString({ k: long }, "k", 10);
    expect(out).toBe(`${"x".repeat(10)}…`);
  });
});

describe("readNumber", () => {
  it("reads finite numbers, rejects NaN/Infinity/non-number", () => {
    expect(readNumber({ k: 5 }, "k")).toBe(5);
    expect(readNumber({ k: -2.5 }, "k")).toBe(-2.5);
    expect(readNumber({ k: Number.NaN }, "k")).toBeNull();
    expect(readNumber({ k: Number.POSITIVE_INFINITY }, "k")).toBeNull();
    expect(readNumber({ k: "5" }, "k")).toBeNull();
    expect(readNumber({}, "k")).toBeNull();
  });
});

describe("readBoolean / readArray / readRecord", () => {
  it("reads booleans only", () => {
    expect(readBoolean({ k: true }, "k")).toBe(true);
    expect(readBoolean({ k: false }, "k")).toBe(false);
    expect(readBoolean({ k: "true" }, "k")).toBeNull();
  });
  it("reads arrays / records only", () => {
    expect(readArray({ k: [1] }, "k")).toEqual([1]);
    expect(readArray({ k: {} }, "k")).toBeNull();
    expect(readRecord({ k: { a: 1 } }, "k")).toEqual({ a: 1 });
    expect(readRecord({ k: [] }, "k")).toBeNull();
  });
});

describe("readStringArray", () => {
  it("keeps strings, skips non-strings, reports total", () => {
    const out = readStringArray({ k: ["a", 1, "b", null, "c"] }, "k");
    expect(out.items).toEqual(["a", "b", "c"]);
    expect(out.total).toBe(3);
    expect(out.hidden).toBe(0);
  });
  it("caps and reports hidden", () => {
    const many = Array.from({ length: 50 }, (_v, i) => `s${i}`);
    const out = readStringArray({ k: many }, "k", 10);
    expect(out.items).toHaveLength(10);
    expect(out.total).toBe(50);
    expect(out.hidden).toBe(40);
  });
  it("returns empty for missing / non-array", () => {
    expect(readStringArray({}, "k").items).toEqual([]);
    expect(readStringArray({ k: "x" }, "k").total).toBe(0);
  });
});

describe("readDelta", () => {
  it("reads a base/next/delta object", () => {
    expect(readDelta({ d: { base: 1, next: 3, delta: 2 } }, "d")).toEqual({
      base: 1,
      next: 3,
      delta: 2,
    });
  });
  it("returns null when absent or not an object, members null when mistyped", () => {
    expect(readDelta({}, "d")).toBeNull();
    expect(readDelta({ d: [1] }, "d")).toBeNull();
    expect(readDelta({ d: { base: "x" } }, "d")).toEqual({ base: null, next: null, delta: null });
  });
});

describe("formatNumber / formatSigned / formatBytes", () => {
  it("formats integers and rounds decimals to 6dp", () => {
    expect(formatNumber(5)).toBe("5");
    expect(formatNumber(-3)).toBe("-3");
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(Number.NaN)).toBe("—");
  });
  it("adds an explicit sign for positive deltas only", () => {
    expect(formatSigned(2.5)).toBe("+2.5");
    expect(formatSigned(-3)).toBe("-3");
    expect(formatSigned(0)).toBe("0");
  });
  it("formats bytes compactly and rejects negatives", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(-1)).toBe("—");
  });
});

describe("capRows / truncateText / shortDigest", () => {
  it("caps rows and reports hidden", () => {
    const cap = capRows([1, 2, 3, 4, 5], 2);
    expect(cap.shown).toEqual([1, 2]);
    expect(cap.total).toBe(5);
    expect(cap.hidden).toBe(3);
  });
  it("truncates only when over the limit", () => {
    expect(truncateText("short", 10)).toBe("short");
    expect(truncateText("toolong", 4)).toBe("tool…");
  });
  it("elides long digests at the configured width", () => {
    const long = "0123456789abcdef0123456789";
    expect(shortDigest("short")).toBe("short");
    expect(shortDigest(long)).toBe(`${long.slice(0, TYPED_VIEW_LIMITS.maxDigestChars)}…`);
  });
});
