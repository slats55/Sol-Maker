import { describe, it, expect } from "vitest";

import { buildOperatorApproval, evaluateOperatorApproval } from "./operator-approval.js";
import { buildLivePolicy } from "./policy.js";
import { openPosition } from "./position.js";
import type { LivePosition } from "./position.js";
import type { LiveCanaryQuoteFacts } from "./canary-request.js";
import { buildLiveSellRequest, reconcilePosition, validateLiveSellRequest } from "./sell-request.js";

const MINT_A = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";
const T0 = "2026-07-02T04:00:00.000Z";
const NOW_MS = Date.parse(T0);

function livePosition(overrides: Partial<Parameters<typeof openPosition>[0]> = {}): LivePosition {
  return openPosition({
    kind: "live_canary",
    mint: MINT_A,
    openedAt: "2026-07-02T03:50:00.000Z",
    entrySpendLamports: 5_000_000,
    tokenAmountRaw: "123456789",
    ...overrides,
  });
}

function freshQuote(overrides: Partial<LiveCanaryQuoteFacts> = {}): LiveCanaryQuoteFacts {
  return {
    provider: "jupiter-lite-api",
    inputMint: MINT_A,
    outputMint: SOL,
    inAmountRaw: "123456789",
    outAmountRaw: "6000000",
    slippageBps: 100,
    priceImpactPct: 0.2,
    quotedAt: T0,
    ageMs: 1000,
    routeLabels: ["Meteora"],
    ...overrides,
  };
}

function greenPolicy() {
  return buildLivePolicy({ mode: "live_canary", liveEnabled: true, walletProvider: "phantom" });
}

function activeApproval() {
  const approval = buildOperatorApproval({
    operatorLabel: "myles",
    confirmPhrase: "I-APPROVE-ONE-CANARY-RECOMMENDATION",
    approvedAt: T0,
  });
  return evaluateOperatorApproval(approval, NOW_MS + 1000);
}

function expiredApproval() {
  const approval = buildOperatorApproval({
    operatorLabel: "myles",
    confirmPhrase: "I-APPROVE-ONE-CANARY-RECOMMENDATION",
    ttlMinutes: 1,
    approvedAt: "2026-07-02T02:00:00.000Z",
  });
  return evaluateOperatorApproval(approval, NOW_MS);
}

describe("sell request — the green path is review_ready, never a send", () => {
  it("open live position + verified balance + fresh quote + active approval + green policy → review_ready", () => {
    const req = buildLiveSellRequest({
      position: livePosition(),
      quote: freshQuote(),
      policy: greenPolicy(),
      approvalEvaluation: activeApproval(),
      createdAt: T0,
      nowMs: NOW_MS,
    });
    expect(req.state).toBe("review_ready");
    expect(req.blockingReasons).toEqual([]);
    expect(req.expectedSolOutLamports).toBe("6000000");
    expect(req.estimatedPnlLamports).toBe(1_000_000);
    expect(req.estimatedPnlPct).toBe(20);
    expect(req.signed).toBe(false);
    expect(req.submitted).toBe(false);
    expect(req.backendCustodiesNoKeys).toBe(true);
    expect(validateLiveSellRequest(JSON.parse(JSON.stringify(req))).state).toBe("review_ready");
  });
});

describe("sell request — refusals", () => {
  const green = () => ({
    position: livePosition(),
    quote: freshQuote(),
    policy: greenPolicy(),
    approvalEvaluation: activeApproval(),
    createdAt: T0,
    nowMs: NOW_MS,
  });

  it("refuses a stale quote", () => {
    const req = buildLiveSellRequest({ ...green(), quote: freshQuote({ ageMs: 60_000 }) });
    expect(req.state).toBe("blocked");
    expect(req.blockingReasons).toContain("sell-quote-stale");
  });

  it("refuses a quote whose age is unknown", () => {
    const req = buildLiveSellRequest({ ...green(), quote: freshQuote({ ageMs: null }) });
    expect(req.blockingReasons).toContain("sell-quote-age-unknown");
  });

  it("refuses a missing quote and a wrong-mint quote", () => {
    expect(buildLiveSellRequest({ ...green(), quote: null }).blockingReasons).toContain("sell-quote-missing");
    const wrong = buildLiveSellRequest({ ...green(), quote: freshQuote({ inputMint: SOL }) });
    expect(wrong.blockingReasons).toContain("sell-quote-mint-mismatch");
  });

  it("refuses an unverified token balance instead of inventing one", () => {
    const req = buildLiveSellRequest({ ...green(), position: livePosition({ tokenAmountRaw: null }) });
    expect(req.state).toBe("blocked");
    expect(req.blockingReasons).toContain("token-balance-unverified");
  });

  it("refuses a missing approval and an expired approval identically to none", () => {
    expect(buildLiveSellRequest({ ...green(), approvalEvaluation: null }).blockingReasons).toContain("approval-missing");
    const expired = buildLiveSellRequest({ ...green(), approvalEvaluation: expiredApproval() });
    expect(expired.blockingReasons).toContain("approval-inactive");
    expect(expired.state).toBe("blocked");
  });

  it("refuses when the live policy is not green (default policy blocks)", () => {
    const req = buildLiveSellRequest({ ...green(), policy: buildLivePolicy() });
    expect(req.blockingReasons).toContain("policy-not-green");
  });

  it("emergency review mode is ALWAYS blocked (review-only) and says what to do in Phantom", () => {
    const req = buildLiveSellRequest({ ...green(), emergencyReview: true });
    expect(req.state).toBe("blocked");
    expect(req.blockingReasons).toContain("emergency-review-only");
    expect(req.warnings.join(" ")).toMatch(/Phantom/);
    expect(req.envelope).toBeNull();
  });

  it("a blocked request never carries an envelope", () => {
    const req = buildLiveSellRequest({
      ...green(),
      quote: freshQuote({ ageMs: 60_000 }),
      envelope: { fake: true } as never,
    });
    expect(req.envelope).toBeNull();
  });

  it("the closed schema refuses send-shaped fields", () => {
    const req = buildLiveSellRequest(green());
    const tampered = { ...JSON.parse(JSON.stringify(req)), signature: "abc" };
    expect(() => validateLiveSellRequest(tampered)).toThrow(/CLOSED/);
    const claimed = { ...JSON.parse(JSON.stringify(req)), submitted: true };
    expect(() => validateLiveSellRequest(claimed)).toThrow(/submitted/);
  });
});

describe("position reconciliation — unknown stays unknown", () => {
  it("no observation → verdict unknown, never an invented balance", () => {
    const rec = reconcilePosition({
      position: livePosition(),
      observedTokenAmountRaw: null,
      observationSource: null,
      reconciledAt: T0,
    });
    expect(rec.verdict).toBe("unknown");
    expect(rec.observedTokenAmountRaw).toBeNull();
    expect(rec.balancesNeverInvented).toBe(true);
  });

  it("matching / mismatching live balances are called out", () => {
    const match = reconcilePosition({ position: livePosition(), observedTokenAmountRaw: "123456789", observationSource: "rpc", reconciledAt: T0 });
    expect(match.verdict).toBe("matches");
    const mismatch = reconcilePosition({ position: livePosition(), observedTokenAmountRaw: "1", observationSource: "rpc", reconciledAt: T0 });
    expect(mismatch.verdict).toBe("mismatch");
    expect(mismatch.notes.join(" ")).toMatch(/do NOT trust/);
  });

  it("a live position with no recorded amount reconciles as unknown even with an observation", () => {
    const rec = reconcilePosition({
      position: livePosition({ tokenAmountRaw: null }),
      observedTokenAmountRaw: "5",
      observationSource: "rpc",
      reconciledAt: T0,
    });
    expect(rec.verdict).toBe("unknown");
  });

  it("a paper position expects zero on-chain; zero matches, a real balance is a mismatch", () => {
    const paper = openPosition({ kind: "paper", mint: MINT_A, openedAt: T0, entrySpendLamports: 1_000_000 });
    expect(reconcilePosition({ position: paper, observedTokenAmountRaw: "0", observationSource: "rpc", reconciledAt: T0 }).verdict).toBe("matches");
    expect(reconcilePosition({ position: paper, observedTokenAmountRaw: "10", observationSource: "rpc", reconciledAt: T0 }).verdict).toBe("mismatch");
  });
});
