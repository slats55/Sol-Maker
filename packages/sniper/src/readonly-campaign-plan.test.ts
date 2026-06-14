import { describe, it, expect } from "vitest";
import {
  buildSniperReadonlyCampaignPlan,
  validateSniperReadonlyCampaignPlan,
  formatSniperReadonlyCampaignPlan,
  SniperReadonlyCampaignPlanError,
  SNIPER_READONLY_CAMPAIGN_PLAN_SCHEMA_VERSION,
  SNIPER_READONLY_CAMPAIGN_PLAN_BANNER,
  SNIPER_READONLY_CAMPAIGN_STAGES,
  SNIPER_READONLY_CAMPAIGN_MAX_CANDIDATE_LIMIT,
  type SniperReadonlyCampaignPlan,
} from "./readonly-campaign-plan.js";

const ALL_OFFLINE_STAGES = ["candidate-score", "tx-build-dryrun", "tx-inspect", "routequote-prepare", "readiness", "microtrade-preflight"];

describe("buildSniperReadonlyCampaignPlan — valid", () => {
  it("builds a default plan and round-trips through the validator", () => {
    const plan = buildSniperReadonlyCampaignPlan({ allowedStages: ALL_OFFLINE_STAGES });
    expect(plan.schemaVersion).toBe(SNIPER_READONLY_CAMPAIGN_PLAN_SCHEMA_VERSION);
    expect(plan.banner).toBe(SNIPER_READONLY_CAMPAIGN_PLAN_BANNER);
    expect(plan.mode).toBe("paper");
    expect(plan.network).toBe("mainnet-beta");
    expect(plan.providerPolicy).toBe("operator-supplied-only");
    expect(plan.candidateLimit).toBe(SNIPER_READONLY_CAMPAIGN_MAX_CANDIDATE_LIMIT);
    expect(plan.liveSendStatus).toBe("disabled");
    expect(plan.noSend).toBe(true);
    expect(plan.noSigner).toBe(true);
    expect(plan.noLiveTrading).toBe(true);
    expect(() => validateSniperReadonlyCampaignPlan(plan)).not.toThrow();
  });

  it("re-derives disabledStages as the exact complement of allowedStages", () => {
    const plan = buildSniperReadonlyCampaignPlan({ allowedStages: ["candidate-score", "tx-inspect"] });
    expect(plan.allowedStages).toEqual(["candidate-score", "tx-inspect"]);
    const union = new Set([...plan.allowedStages, ...plan.disabledStages]);
    expect(union.size).toBe(SNIPER_READONLY_CAMPAIGN_STAGES.length);
    for (const s of plan.allowedStages) expect(plan.disabledStages).not.toContain(s);
  });

  it("canonicalizes + dedupes allowedStages into stage order", () => {
    const plan = buildSniperReadonlyCampaignPlan({ allowedStages: ["tx-inspect", "candidate-score", "candidate-score"] });
    expect(plan.allowedStages).toEqual(["candidate-score", "tx-inspect"]);
  });

  it("allows network stages when the policy permits live read-only access", () => {
    const plan = buildSniperReadonlyCampaignPlan({
      mode: "mainnet-dry-run",
      providerPolicy: "live-readonly-when-allowed",
      allowedStages: ["deep-risk", "quote-fetch", "quote-score", "simulate", "candidate-score"],
      maxQuoteAgeMs: 60000,
    });
    expect(plan.allowedStages).toContain("quote-fetch");
    expect(plan.maxQuoteAgeMs).toBe(60000);
    expect(() => validateSniperReadonlyCampaignPlan(plan)).not.toThrow();
  });

  it("records the input refs and an explicit candidate limit", () => {
    const plan = buildSniperReadonlyCampaignPlan({
      campaignId: "alpha-run-1",
      inputWatchlistRef: "watchlist.json",
      candidateLimit: 5,
      allowedStages: ["candidate-score"],
    });
    expect(plan.campaignId).toBe("alpha-run-1");
    expect(plan.inputWatchlistRef).toBe("watchlist.json");
    expect(plan.inputCandidatesRef).toBeNull();
    expect(plan.candidateLimit).toBe(5);
  });
});

describe("buildSniperReadonlyCampaignPlan — refusals", () => {
  it("refuses an unknown / send / sign / arm stage (the stage set is CLOSED)", () => {
    for (const bad of ["tx-send", "send", "sign", "arm", "mainnet-live", "broadcast", "go-live"]) {
      expect(() => buildSniperReadonlyCampaignPlan({ allowedStages: [bad] }), bad).toThrow(/unknown \/ forbidden stage/);
    }
  });

  it("refuses a candidate limit over the hard cap", () => {
    expect(() => buildSniperReadonlyCampaignPlan({ candidateLimit: SNIPER_READONLY_CAMPAIGN_MAX_CANDIDATE_LIMIT + 1 })).toThrow(/hard cap/);
  });

  it("refuses a non-positive or non-integer candidate limit", () => {
    expect(() => buildSniperReadonlyCampaignPlan({ candidateLimit: 0 })).toThrow(SniperReadonlyCampaignPlanError);
    expect(() => buildSniperReadonlyCampaignPlan({ candidateLimit: 2.5 })).toThrow(SniperReadonlyCampaignPlanError);
  });

  it("refuses an invalid mode / network", () => {
    expect(() => buildSniperReadonlyCampaignPlan({ mode: "mainnet-live" })).toThrow(/mode must be one of/);
    expect(() => buildSniperReadonlyCampaignPlan({ network: "solana" })).toThrow(/network must be one of/);
  });

  it("refuses a network stage under the operator-supplied-only policy", () => {
    expect(() =>
      buildSniperReadonlyCampaignPlan({ providerPolicy: "operator-supplied-only", allowedStages: ["quote-fetch"] }),
    ).toThrow(/forbids the read-only-network stage/);
  });

  it("refuses a secret-shaped label", () => {
    const secret = "k".repeat(96);
    expect(() => buildSniperReadonlyCampaignPlan({ campaignId: secret })).toThrow(/secret-shaped|exceeds/);
  });

  it("refuses a control character / NUL in a label", () => {
    expect(() => buildSniperReadonlyCampaignPlan({ planId: "a\u0000b" })).toThrow(/control character, NUL, or BOM/);
  });

  it("refuses a maxQuoteAgeMs that is not a positive integer", () => {
    expect(() => buildSniperReadonlyCampaignPlan({ maxQuoteAgeMs: -1 })).toThrow(SniperReadonlyCampaignPlanError);
  });
});

describe("validateSniperReadonlyCampaignPlan — closed schema + parity wall", () => {
  const base = (): SniperReadonlyCampaignPlan => buildSniperReadonlyCampaignPlan({ allowedStages: ["candidate-score", "tx-inspect"] });

  it("refuses an unknown field (closed schema)", () => {
    const plan = { ...base(), sendResult: "ok" } as unknown;
    expect(() => validateSniperReadonlyCampaignPlan(plan)).toThrow(/unknown field "sendResult" \(the schema is CLOSED\)/);
  });

  it("refuses a signature / txid field (closed schema)", () => {
    for (const field of ["signature", "txid"]) {
      const plan = { ...base(), [field]: "x" } as unknown;
      expect(() => validateSniperReadonlyCampaignPlan(plan), field).toThrow(/the schema is CLOSED/);
    }
  });

  it("refuses a missing field", () => {
    const { planId: _drop, ...rest } = base();
    void _drop;
    expect(() => validateSniperReadonlyCampaignPlan(rest)).toThrow(/missing field "planId"/);
  });

  it("refuses noSend / noSigner / noLiveTrading set to false", () => {
    for (const field of ["noSend", "noSigner", "noLiveTrading"] as const) {
      const plan = { ...base(), [field]: false } as unknown;
      expect(() => validateSniperReadonlyCampaignPlan(plan), field).toThrow(new RegExp(`${field} must literally be true`));
    }
  });

  it("refuses liveSendStatus set to anything but disabled", () => {
    const plan = { ...base(), liveSendStatus: "enabled" } as unknown;
    expect(() => validateSniperReadonlyCampaignPlan(plan)).toThrow(/liveSendStatus must literally be "disabled"/);
  });

  it("refuses phase7LiveTradingReady set to true", () => {
    const plan = { ...base(), phase7LiveTradingReady: true } as unknown;
    expect(() => validateSniperReadonlyCampaignPlan(plan)).toThrow(/phase7LiveTradingReady must literally be false/);
  });

  it("catches a tampered disabledStages (re-derived complement must match)", () => {
    const plan = base();
    // Quietly "enable" a stage by dropping it from disabledStages without adding it to allowed.
    const tampered = { ...plan, disabledStages: plan.disabledStages.filter((s) => s !== "deep-risk") } as unknown;
    expect(() => validateSniperReadonlyCampaignPlan(tampered)).toThrow(/disabledStages must be the re-derived complement/);
  });

  it("catches a non-canonical allowedStages ordering", () => {
    const plan = base();
    const tampered = { ...plan, allowedStages: ["tx-inspect", "candidate-score"] } as unknown;
    expect(() => validateSniperReadonlyCampaignPlan(tampered)).toThrow(/canonical, deduped subset/);
  });

  it("refuses an empty caveats array", () => {
    const plan = { ...base(), caveats: [] } as unknown;
    expect(() => validateSniperReadonlyCampaignPlan(plan)).toThrow(/caveats must be a non-empty array/);
  });
});

describe("formatSniperReadonlyCampaignPlan", () => {
  it("renders a deterministic, banner-led summary with allowed + disabled stages", () => {
    const plan = buildSniperReadonlyCampaignPlan({ allowedStages: ["candidate-score"], campaignId: "alpha" });
    const text = formatSniperReadonlyCampaignPlan(plan, { label: "demo" });
    expect(text).toContain(SNIPER_READONLY_CAMPAIGN_PLAN_BANNER);
    expect(text).toContain("Allowed stages (1): candidate-score");
    expect(text).toContain("Disabled stages");
    expect(text).toContain("DISABLED");
    // Deterministic.
    expect(formatSniperReadonlyCampaignPlan(plan, { label: "demo" })).toBe(text);
  });
});
