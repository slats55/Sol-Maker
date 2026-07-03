import { describe, expect, it } from "vitest";

import { buildOperatorConfig } from "./operator-config.js";
import { buildOperatorReconciliation } from "./operator-reconcile.js";
import type { OperatorReconciliationRecord } from "./operator-reconcile.js";
import {
  HumanReadinessError,
  buildHumanCanaryReadiness,
  validateHumanCanaryReadiness,
} from "./human-readiness.js";
import type { HumanCanaryWorkflowChecks } from "./human-readiness.js";

const AT = "2026-07-03T12:00:00.000Z";
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const config = buildOperatorConfig({
  operatorLabel: "part3-operator",
  rpcEndpointHttps: "https://api.mainnet-beta.solana.com",
  mode: "armed_canary",
  walletPublicKey: "CgGszXon2aemnsCYRSuguJqkFdSAwCPc31mFcHLDwbpV",
});

const allChecks: HumanCanaryWorkflowChecks = {
  configValidated: true,
  sessionJournalWorks: true,
  observeRunProven: true,
  paperShadowRunProven: true,
  armedRecommendationProven: true,
  reconciliationPathProven: true,
  dashboardBuilt: true,
  alertsAvailable: true,
};

function settledReconciliation(): OperatorReconciliationRecord {
  return buildOperatorReconciliation({
    candidateMint: MINT,
    canary: {
      signature: "3xJ9wPqRsTuVwXyZa1bCdEfGhJkMnPqRsTuVwXyZa1bC",
      submittedAt: AT,
      lastStatusAt: AT,
      status: "finalized",
      slot: 351000000,
      err: null,
      inputAmountRaw: null,
      outputAmountRaw: null,
      solSpentLamports: null,
      feesLamports: null,
      priorityFeeLamports: null,
      balanceBeforeLamports: null,
      balanceAfterLamports: null,
    },
    pre: { solLamports: null, tokenRaw: null, capturedAt: null },
    post: { solLamports: null, tokenRaw: null, capturedAt: null },
    tokenDecimals: null,
    quotedOutRaw: null,
    tokenPriceUsd: null,
    priceEvidence: null,
  });
}

describe("buildHumanCanaryReadiness — the truthful Phase-8 artifact", () => {
  it("all checks + NO reconciliation ⇒ ready-for-human-canary, realCanaryExecuted false, honest note", () => {
    const r = buildHumanCanaryReadiness({ generatedAt: AT, config, checks: allChecks, reconciliation: null });
    expect(r.verdict).toBe("ready-for-human-canary");
    expect(r.realCanaryExecuted).toBe(false);
    expect(r.realCanaryStatusNote).toMatch(/NO real canary has been executed/);
    expect(r.missing).toEqual([]);
    expect(r.humanPrerequisites.join(" ")).toMatch(/BURNER/);
    expect(r.requiresHumanPhantomApproval).toBe(true);
    expect(r.largeTradesEnabled).toBe(false);
  });

  it("a missing check ⇒ not-ready and the gap is listed", () => {
    const r = buildHumanCanaryReadiness({ generatedAt: AT, config, checks: { ...allChecks, dashboardBuilt: false }, reconciliation: null });
    expect(r.verdict).toBe("not-ready");
    expect(r.missing.join(" ")).toMatch(/dashboard/);
  });

  it("realCanaryExecuted derives ONLY from settled + signed reconciliation evidence", () => {
    const settled = buildHumanCanaryReadiness({ generatedAt: AT, config, checks: allChecks, reconciliation: settledReconciliation() });
    expect(settled.realCanaryExecuted).toBe(true);
    expect(settled.verdict).toBe("canary-executed-and-reconciled");
    expect(settled.realCanaryStatusNote).toMatch(/slot 351000000/);

    const pending = settledReconciliation();
    const unsettled: OperatorReconciliationRecord = { ...pending, canary: { ...pending.canary, status: "submitted", slot: null } };
    const r = buildHumanCanaryReadiness({ generatedAt: AT, config, checks: allChecks, reconciliation: unsettled });
    expect(r.realCanaryExecuted).toBe(false);
    expect(r.verdict).toBe("ready-for-human-canary");
    expect(r.realCanaryStatusNote).toMatch(/NOT a settled canary/);
  });
});

describe("validateHumanCanaryReadiness — consistency wall", () => {
  const good = JSON.parse(JSON.stringify(buildHumanCanaryReadiness({ generatedAt: AT, config, checks: allChecks, reconciliation: null }))) as Record<string, unknown>;

  it("round-trips", () => {
    expect(validateHumanCanaryReadiness(good).verdict).toBe("ready-for-human-canary");
  });

  it("refuses a verdict that fakes an executed canary", () => {
    expect(() => validateHumanCanaryReadiness({ ...good, verdict: "canary-executed-and-reconciled" })).toThrow(/disagree/);
    expect(() => validateHumanCanaryReadiness({ ...good, realCanaryExecuted: true })).toThrow(/disagree/);
  });

  it("refuses ready-with-missing, unknown fields and tampered pins", () => {
    expect(() => validateHumanCanaryReadiness({ ...good, missing: ["something"] })).toThrow(/missing prerequisites/);
    expect(() => validateHumanCanaryReadiness({ ...good, autoTradeReady: true })).toThrow(/unknown field/);
    expect(() => validateHumanCanaryReadiness({ ...good, largeTradesEnabled: true })).toThrow(HumanReadinessError);
    expect(() => validateHumanCanaryReadiness({ ...good, backendNeverSends: false })).toThrow(/literal true/);
  });
});
