import { describe, expect, it } from "vitest";

import {
  LIVE_OPERATOR_APPROVAL_SCHEMA_VERSION,
  LiveOperatorApprovalError,
  OPERATOR_APPROVAL_CONFIRM_PHRASE,
  OPERATOR_APPROVAL_DEFAULT_TTL_MINUTES,
  OPERATOR_APPROVAL_MAX_TTL_MINUTES,
  buildOperatorApproval,
  evaluateOperatorApproval,
  validateOperatorApproval,
} from "./operator-approval.js";

const AT = "2026-06-18T00:00:00.000Z";
const AT_MS = Date.parse(AT);

function build(over: Partial<Parameters<typeof buildOperatorApproval>[0]> = {}) {
  return buildOperatorApproval({ operatorLabel: "operator-one", confirmPhrase: OPERATOR_APPROVAL_CONFIRM_PHRASE, approvedAt: AT, ...over });
}

describe("operator approval — build", () => {
  it("builds a complete, pinned approval with a derived expiry", () => {
    const a = build();
    expect(a.schemaVersion).toBe(LIVE_OPERATOR_APPROVAL_SCHEMA_VERSION);
    expect(a.ttlMinutes).toBe(OPERATOR_APPROVAL_DEFAULT_TTL_MINUTES);
    expect(Date.parse(a.expiresAt) - Date.parse(a.approvedAt)).toBe(OPERATOR_APPROVAL_DEFAULT_TTL_MINUTES * 60_000);
    expect(a.scope).toBe("canary-recommendation-only");
    expect(a.approvesRecommendationOnly).toBe(true);
    expect(a.cannotSign).toBe(true);
    expect(a.cannotSend).toBe(true);
    expect(a.notProfitabilityClaim).toBe(true);
  });

  it("refuses a wrong / missing confirm phrase and names the required one", () => {
    expect(() => build({ confirmPhrase: "yes" })).toThrow(OPERATOR_APPROVAL_CONFIRM_PHRASE);
    expect(() => build({ confirmPhrase: "" })).toThrow(LiveOperatorApprovalError);
    expect(() => build({ confirmPhrase: OPERATOR_APPROVAL_CONFIRM_PHRASE.toLowerCase() })).toThrow(LiveOperatorApprovalError);
  });

  it("refuses a TTL over the absolute ceiling (never clamps) and non-positive / fractional TTLs", () => {
    expect(() => build({ ttlMinutes: OPERATOR_APPROVAL_MAX_TTL_MINUTES + 1 })).toThrow(/ceiling/);
    expect(() => build({ ttlMinutes: 0 })).toThrow(LiveOperatorApprovalError);
    expect(() => build({ ttlMinutes: 1.5 })).toThrow(LiveOperatorApprovalError);
    expect(build({ ttlMinutes: OPERATOR_APPROVAL_MAX_TTL_MINUTES }).ttlMinutes).toBe(OPERATOR_APPROVAL_MAX_TTL_MINUTES);
  });

  it("the TTL ceiling itself is pinned tiny (15 minutes)", () => {
    expect(OPERATOR_APPROVAL_MAX_TTL_MINUTES).toBe(15);
  });

  it("refuses an empty, over-long, or secret-shaped operator label", () => {
    expect(() => build({ operatorLabel: "  " })).toThrow(/names the human/);
    expect(() => build({ operatorLabel: "x".repeat(61) })).toThrow(/60/);
    // A 64-byte-key-shaped base58 blob must never become a label.
    expect(() => build({ operatorLabel: "5".repeat(88) })).toThrow(LiveOperatorApprovalError);
  });

  it("refuses an unparseable approvedAt", () => {
    expect(() => build({ approvedAt: "not-a-time" })).toThrow(/parseable/);
  });
});

describe("operator approval — validate (closed schema)", () => {
  it("round-trips a built approval", () => {
    const a = build();
    expect(validateOperatorApproval(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });

  it("refuses an unknown field (closed schema)", () => {
    const a = { ...build(), grantsLiveTrading: true } as unknown;
    expect(() => validateOperatorApproval(a)).toThrow(/unknown field/);
  });

  it("refuses a sensitive-named field", () => {
    const a = { ...build(), privateKey: "x" } as unknown;
    expect(() => validateOperatorApproval(a)).toThrow(/sensitive/);
  });

  it("refuses a hand-widened expiry window", () => {
    const a = build() as unknown as Record<string, unknown>;
    a.expiresAt = new Date(AT_MS + 24 * 3_600_000).toISOString();
    expect(() => validateOperatorApproval(a)).toThrow(/hand-widened|inconsistent/);
  });

  it("refuses tampered honesty literals and a widened scope", () => {
    for (const field of ["approvesRecommendationOnly", "cannotSign", "cannotSend", "notProfitabilityClaim"]) {
      const a = build() as unknown as Record<string, unknown>;
      a[field] = false;
      expect(() => validateOperatorApproval(a), field).toThrow(LiveOperatorApprovalError);
    }
    const widened = build() as unknown as Record<string, unknown>;
    widened.scope = "live-trading";
    expect(() => validateOperatorApproval(widened)).toThrow(/never widens/);
  });

  it("refuses a ttl over the ceiling even when expiry is made consistent", () => {
    const a = build() as unknown as Record<string, unknown>;
    a.ttlMinutes = 120;
    a.expiresAt = new Date(AT_MS + 120 * 60_000).toISOString();
    expect(() => validateOperatorApproval(a)).toThrow(/\[1, 15\]/);
  });
});

describe("operator approval — evaluate (expiry is enforced, not advisory)", () => {
  it("is active inside the window with a sane remainingMs", () => {
    const a = build({ ttlMinutes: 10 });
    const e = evaluateOperatorApproval(a, AT_MS + 60_000);
    expect(e.active).toBe(true);
    expect(e.expired).toBe(false);
    expect(e.remainingMs).toBe(9 * 60_000);
    expect(e.reasons).toEqual([]);
  });

  it("an expired approval is inactive — exactly as powerless as none", () => {
    const a = build({ ttlMinutes: 10 });
    const e = evaluateOperatorApproval(a, AT_MS + 10 * 60_000);
    expect(e.active).toBe(false);
    expect(e.expired).toBe(true);
    expect(e.remainingMs).toBe(0);
    expect(e.reasons).toContain("approval-expired");
  });

  it("a future-dated approval (beyond the skew tolerance) is inactive", () => {
    const a = build({ approvedAt: new Date(AT_MS + 10 * 60_000).toISOString() });
    const e = evaluateOperatorApproval(a, AT_MS);
    expect(e.active).toBe(false);
    expect(e.reasons).toContain("approval-not-yet-valid");
  });

  it("a corrupted window is inactive", () => {
    const a = { ...build(), expiresAt: a_before_approved() } as ReturnType<typeof build>;
    const e = evaluateOperatorApproval(a, AT_MS);
    expect(e.active).toBe(false);
    expect(e.reasons).toContain("approval-window-invalid");
  });
});

function a_before_approved(): string {
  return new Date(AT_MS - 60_000).toISOString();
}
