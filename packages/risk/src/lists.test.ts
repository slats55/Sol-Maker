import { describe, it, expect } from "vitest";
import { normalizeMint, parseList, dedupeList, listIncludes } from "./lists.js";

const A = "So11111111111111111111111111111111111111112";
const B = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("normalizeMint", () => {
  it("trims surrounding whitespace but preserves case", () => {
    expect(normalizeMint(`  ${A}  `)).toBe(A);
    // base58 is case-sensitive — normalization must NOT lowercase.
    expect(normalizeMint("AbC")).toBe("AbC");
  });
});

describe("parseList", () => {
  it("ignores blank lines and # comments (whole-line and trailing)", () => {
    const content = [
      "# a header comment",
      "",
      `${A}`,
      "   ",
      `${B}   # this one we have traded`,
      "# trailing comment-only line",
    ].join("\n");
    const { entries } = parseList(content);
    expect(entries).toEqual([A, B]);
  });

  it("tolerates CRLF line endings", () => {
    const { entries } = parseList(`${A}\r\n${B}\r\n`);
    expect(entries).toEqual([A, B]);
  });

  it("detects and reports duplicate entries (normalized), keeping uniques once", () => {
    const content = [A, `  ${A}  `, B, A].join("\n");
    const { entries, duplicates } = parseList(content);
    expect(entries).toEqual([A, B]);
    expect(duplicates).toEqual([A]);
  });

  it("returns empty for comment/blank-only content", () => {
    const { entries, duplicates } = parseList("\n# only comments\n   \n");
    expect(entries).toEqual([]);
    expect(duplicates).toEqual([]);
  });
});

describe("dedupeList", () => {
  it("normalizes and de-duplicates an array, reporting duplicates", () => {
    const { entries, duplicates } = dedupeList([A, ` ${A} `, "", B]);
    expect(entries).toEqual([A, B]);
    expect(duplicates).toEqual([A]);
  });
});

describe("listIncludes", () => {
  it("matches after trimming, case-sensitively", () => {
    expect(listIncludes([` ${A} `], A)).toBe(true);
    expect(listIncludes([A], B)).toBe(false);
    expect(listIncludes(undefined, A)).toBe(false);
    expect(listIncludes([], A)).toBe(false);
  });
});
