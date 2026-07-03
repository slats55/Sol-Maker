import { describe, expect, it } from "vitest";

import { CanaryReconciliationError, buildCanaryReconciliation, validateCanaryReconciliation } from "./canary-reconcile.js";
import type { CanaryReconciliationFacts } from "./canary-reconcile.js";

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SIG = "FixtureSig1111example"; // short fixture (a real 88-char base58 sig is never committed)

function facts(over: Partial<CanaryReconciliationFacts> = {}): CanaryReconciliationFacts {
  return {
    signature: SIG,
    submittedAt: "2026-06-18T00:00:00.000Z",
    lastStatusAt: "2026-06-18T00:00:05.000Z",
    status: "finalized",
    slot: 123456,
    err: null,
    inputAmountRaw: "5000000",
    outputAmountRaw: "347306",
    solSpentLamports: "5000000",
    feesLamports: "5000",
    priorityFeeLamports: "1000",
    balanceBeforeLamports: null,
    balanceAfterLamports: null,
    ...over,
  };
}

describe("canary reconciliation — honest accounting", () => {
  it("a finalized canary reconciles, but PnL is unknown without balances", () => {
    const r = buildCanaryReconciliation({ candidateMint: MINT, facts: facts() });
    expect(r.verdict).toBe("reconciled");
    expect(r.pnlKnown).toBe(false);
    expect(r.pnlNote).toMatch(/unknown/);
    expect(r.netLamports).toBeNull();
    expect(r.notProfitabilityClaim).toBe(true);
  });

  it("computes a net delta only when both balances are supplied (never fabricated)", () => {
    const r = buildCanaryReconciliation({ candidateMint: MINT, facts: facts({ balanceBeforeLamports: "1000000000", balanceAfterLamports: "994995000" }) });
    expect(r.pnlKnown).toBe(true);
    expect(r.netLamports).toBe("-5005000");
  });

  it("a failed status reconciles as reconciled-failed", () => {
    const r = buildCanaryReconciliation({ candidateMint: MINT, facts: facts({ status: "failed", err: "InstructionError" }) });
    expect(r.verdict).toBe("reconciled-failed");
  });

  it("a timed-out / unknown status needs manual review", () => {
    expect(buildCanaryReconciliation({ candidateMint: MINT, facts: facts({ status: "timed_out", signature: null }) }).verdict).toBe("needs-manual-review");
    expect(buildCanaryReconciliation({ candidateMint: MINT, facts: facts({ status: "unknown", signature: null }) }).verdict).toBe("needs-manual-review");
  });

  it("REFUSES to claim confirmed/finalized without a signature", () => {
    expect(() => buildCanaryReconciliation({ candidateMint: MINT, facts: facts({ status: "finalized", signature: null }) })).toThrow(CanaryReconciliationError);
    expect(() => buildCanaryReconciliation({ candidateMint: MINT, facts: facts({ status: "confirmed", signature: null }) })).toThrow(/requires a signature/);
  });

  it("validate enforces the closed schema + honesty literals", () => {
    const r = buildCanaryReconciliation({ candidateMint: MINT, facts: facts() });
    expect(validateCanaryReconciliation(r)).toEqual(r);
    expect(() => validateCanaryReconciliation({ ...r, secretKey: "x" })).toThrow(/sensitive/);
    expect(() => validateCanaryReconciliation({ ...r, surprise: 1 })).toThrow(/CLOSED/);
    expect(() => validateCanaryReconciliation({ ...r, notProfitabilityClaim: false })).toThrow();
  });
});
