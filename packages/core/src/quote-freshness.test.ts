import { describe, it, expect } from "vitest";
import { evaluateQuoteFreshness, QUOTE_FRESHNESS_VERDICTS } from "./quote-freshness.js";

const NOW_MS = Date.parse("2026-06-12T12:00:00.000Z");

describe("evaluateQuoteFreshness — fail-closed on every uncertain input", () => {
  it("fresh ONLY when the timestamp parses, is in the past, and is within the explicit cap", () => {
    const r = evaluateQuoteFreshness({ fetchedAt: "2026-06-12T11:59:30.000Z", nowMs: NOW_MS, maxAgeMs: 60_000 });
    expect(r).toEqual({ fresh: true, verdict: "fresh", ageMs: 30_000, detail: expect.stringContaining("within the explicit 60000ms cap") });
  });

  it("stale when over the cap (boundary: exactly the cap is still fresh)", () => {
    const atCap = evaluateQuoteFreshness({ fetchedAt: "2026-06-12T11:59:00.000Z", nowMs: NOW_MS, maxAgeMs: 60_000 });
    expect(atCap.verdict).toBe("fresh");
    const over = evaluateQuoteFreshness({ fetchedAt: "2026-06-12T11:58:59.999Z", nowMs: NOW_MS, maxAgeMs: 60_000 });
    expect(over).toMatchObject({ fresh: false, verdict: "stale", ageMs: 60_001 });
  });

  it("a missing timestamp is NOT fresh — no quote can make anything executable", () => {
    for (const fetchedAt of [null, undefined, "", "   "]) {
      const r = evaluateQuoteFreshness({ fetchedAt, nowMs: NOW_MS, maxAgeMs: 60_000 });
      expect(r).toMatchObject({ fresh: false, verdict: "missing-timestamp", ageMs: null });
    }
  });

  it("a malformed timestamp is NOT fresh (refused, never guessed)", () => {
    for (const fetchedAt of ["not-a-time", "2026-06-12", "12:00:00", "2026-06-12T12:00:00", "June 12 2026", "1786600000000"]) {
      const r = evaluateQuoteFreshness({ fetchedAt, nowMs: NOW_MS, maxAgeMs: 60_000 });
      expect(r, fetchedAt).toMatchObject({ fresh: false, verdict: "malformed-timestamp", ageMs: null });
    }
  });

  it("a FUTURE timestamp is NOT fresh — clock disagreement blocks", () => {
    const r = evaluateQuoteFreshness({ fetchedAt: "2026-06-12T12:00:01.000Z", nowMs: NOW_MS, maxAgeMs: 60_000 });
    expect(r).toMatchObject({ fresh: false, verdict: "future-timestamp", ageMs: -1000 });
  });

  it("a missing or invalid cap is NOT fresh — there is no hidden default cap", () => {
    for (const maxAgeMs of [null, undefined, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = evaluateQuoteFreshness({ fetchedAt: "2026-06-12T11:59:59.000Z", nowMs: NOW_MS, maxAgeMs });
      expect(r, String(maxAgeMs)).toMatchObject({ fresh: false, verdict: "cap-missing", ageMs: null });
    }
  });

  it("the verdict set is closed and fresh=true maps to exactly one verdict", () => {
    expect(QUOTE_FRESHNESS_VERDICTS).toEqual([
      "fresh",
      "stale",
      "missing-timestamp",
      "malformed-timestamp",
      "future-timestamp",
      "cap-missing",
    ]);
  });

  it("accepts explicit timezone offsets and millisecond precision", () => {
    const r = evaluateQuoteFreshness({ fetchedAt: "2026-06-12T13:59:30+02:00", nowMs: NOW_MS, maxAgeMs: 60_000 });
    expect(r).toMatchObject({ fresh: true, verdict: "fresh", ageMs: 30_000 });
  });
});
