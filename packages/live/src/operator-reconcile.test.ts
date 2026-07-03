import { describe, expect, it } from "vitest";

import type { CanaryReconciliationFacts } from "./canary-reconcile.js";
import { buildOperatorReconciliation, validateOperatorReconciliation } from "./operator-reconcile.js";
import type { OperatorReconcileInput } from "./operator-reconcile.js";

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SIG = "3xJ9wPqRsTuVwXyZa1bCdEfGhJkMnPqRsTuVwXyZa1bC"; // short fixture, never 80+ chars

function facts(overrides: Partial<CanaryReconciliationFacts> = {}): CanaryReconciliationFacts {
  return {
    signature: SIG,
    submittedAt: "2026-07-03T10:00:00.000Z",
    lastStatusAt: "2026-07-03T10:00:30.000Z",
    status: "finalized",
    slot: 351000000,
    err: null,
    inputAmountRaw: "5000000",
    outputAmountRaw: "347306",
    solSpentLamports: "5005000",
    feesLamports: "5000",
    priorityFeeLamports: null,
    balanceBeforeLamports: "100000000",
    balanceAfterLamports: "94995000",
    ...overrides,
  };
}

function fullInput(overrides: Partial<OperatorReconcileInput> = {}): OperatorReconcileInput {
  return {
    candidateMint: MINT,
    canary: facts(),
    pre: { solLamports: "100000000", tokenRaw: "0", capturedAt: "2026-07-03T09:59:00.000Z" },
    post: { solLamports: "94995000", tokenRaw: "347000", capturedAt: "2026-07-03T10:01:00.000Z" },
    tokenDecimals: 6,
    quotedOutRaw: "347306",
    tokenPriceUsd: null,
    priceEvidence: null,
    ...overrides,
  };
}

describe("buildOperatorReconciliation — full-evidence case", () => {
  const r = buildOperatorReconciliation(fullInput());

  it("computes gross token received, SOL spent, and realized slippage", () => {
    expect(r.grossTokenReceivedRaw).toBe("347000");
    expect(r.solSpentLamports).toBe("5005000");
    // (347000 − 347306) * 10000 / 347306 = −8.8 → −8 bps via BigInt truncation
    expect(r.slippageRealizedBps).toBe(-8);
  });

  it("with tokens received but no price evidence: unrealized-unpriced, no estimate invented", () => {
    expect(r.pnlStatus).toBe("unrealized-unpriced");
    expect(r.unrealizedValueUsd).toBeNull();
    expect(r.pnlNote).toMatch(/UNKNOWN/);
  });

  it("re-derives HIGH confidence from signature + finalized + both snapshot sides", () => {
    expect(r.confidence).toBe("high");
    expect(r.confidenceReasons).toContain("signature-recorded");
    expect(r.confidenceReasons).toContain("status-finalized");
  });

  it("pins the honesty literals and embeds a valid Part 2 canary record", () => {
    expect(r.notProfitabilityClaim).toBe(true);
    expect(r.backendNeverSends).toBe(true);
    expect(r.canary.schemaVersion).toBe("live.canary.reconciliation.v1");
    expect(r.canary.verdict).toBe("reconciled");
  });
});

describe("price evidence", () => {
  it("prices the position ONLY when price + evidence are supplied together", () => {
    const priced = buildOperatorReconciliation(fullInput({ tokenPriceUsd: 1.0, priceEvidence: "operator-supplied: jupiter price page 2026-07-03" }));
    expect(priced.pnlStatus).toBe("unrealized-priced");
    expect(priced.unrealizedValueUsd).toBeCloseTo(0.347, 6);
    expect(priced.pnlNote).toMatch(/estimate/);
    expect(priced.pnlNote).toMatch(/not a profit claim/);
  });

  it("refuses a price without evidence (and vice versa)", () => {
    expect(() => buildOperatorReconciliation(fullInput({ tokenPriceUsd: 1.0 }))).toThrow(/together/);
    expect(() => buildOperatorReconciliation(fullInput({ priceEvidence: "trust me" }))).toThrow(/together/);
    expect(() => buildOperatorReconciliation(fullInput({ tokenPriceUsd: -3, priceEvidence: "x" }))).toThrow(/positive/);
  });
});

describe("honest unknowns", () => {
  it("missing balance snapshots yield nulls + notes, never invented numbers", () => {
    const r = buildOperatorReconciliation(
      fullInput({
        pre: { solLamports: null, tokenRaw: null, capturedAt: null },
        post: { solLamports: null, tokenRaw: null, capturedAt: null },
      }),
    );
    expect(r.grossTokenReceivedRaw).toBeNull();
    expect(r.solSpentLamports).toBeNull();
    expect(r.slippageRealizedBps).toBeNull();
    expect(r.notes.join(" ")).toMatch(/token balances not captured/);
    expect(r.notes.join(" ")).toMatch(/SOL balances not captured/);
  });

  it("a failed canary with known outflow and no tokens is realized-loss-known", () => {
    const r = buildOperatorReconciliation(
      fullInput({
        canary: facts({ status: "failed", err: "slippage exceeded", outputAmountRaw: null }),
        post: { solLamports: "99995000", tokenRaw: "0", capturedAt: "2026-07-03T10:01:00.000Z" },
        quotedOutRaw: null,
      }),
    );
    expect(r.pnlStatus).toBe("realized-loss-known");
    expect(r.solSpentLamports).toBe("5000");
    expect(r.canary.verdict).toBe("reconciled-failed");
  });

  it("no facts at all ⇒ pnl unknown, confidence none", () => {
    const r = buildOperatorReconciliation({
      candidateMint: MINT,
      canary: facts({ signature: null, status: "unknown", slot: null, inputAmountRaw: null, outputAmountRaw: null, solSpentLamports: null, feesLamports: null, balanceBeforeLamports: null, balanceAfterLamports: null }),
      pre: { solLamports: null, tokenRaw: null, capturedAt: null },
      post: { solLamports: null, tokenRaw: null, capturedAt: null },
      tokenDecimals: null,
      quotedOutRaw: null,
      tokenPriceUsd: null,
      priceEvidence: null,
    });
    expect(r.pnlStatus).toBe("unknown");
    expect(r.confidence).toBe("none");
    expect(r.canary.verdict).toBe("needs-manual-review");
  });

  it("positive slippage (better than quoted) is reported as positive bps", () => {
    const r = buildOperatorReconciliation(fullInput({ post: { solLamports: "94995000", tokenRaw: "350000", capturedAt: null }, quotedOutRaw: "347306" }));
    expect(r.slippageRealizedBps).toBe(77);
  });
});

describe("validateOperatorReconciliation — closed schema + tamper evidence", () => {
  it("round-trips a built record", () => {
    const r = buildOperatorReconciliation(fullInput());
    const parsed = JSON.parse(JSON.stringify(r)) as Record<string, unknown>;
    expect(validateOperatorReconciliation(parsed).confidence).toBe("high");
  });

  it("refuses unknown fields and tampered derived claims", () => {
    const r = JSON.parse(JSON.stringify(buildOperatorReconciliation(fullInput()))) as Record<string, unknown>;
    expect(() => validateOperatorReconciliation({ ...r, profitGuaranteed: true })).toThrow(/unknown field/);
    expect(() => validateOperatorReconciliation({ ...r, confidence: "none" })).toThrow(/confidence mismatch/);
    expect(() => validateOperatorReconciliation({ ...r, grossTokenReceivedRaw: "999999999" })).toThrow(/mismatch/);
    expect(() => validateOperatorReconciliation({ ...r, pnlStatus: "unrealized-priced" })).toThrow(/pnlStatus mismatch/);
  });

  it("refuses tampered pinned literals", () => {
    const r = JSON.parse(JSON.stringify(buildOperatorReconciliation(fullInput()))) as Record<string, unknown>;
    expect(() => validateOperatorReconciliation({ ...r, notProfitabilityClaim: false })).toThrow(/pinned/);
  });

  it("refuses secret material in the input (outside the public signature field)", () => {
    expect(() => buildOperatorReconciliation(fullInput({ priceEvidence: "5".repeat(88) }))).toThrow(/secret-shaped/);
  });
});
