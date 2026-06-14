/**
 * Tests for the Sprint 106 SNIPER STRATEGY INTELLIGENCE projection. Every input is INJECTED,
 * operator-shaped evidence — fake candidate ids, real (well-known) mint public keys as deterministic
 * fixtures, and token:risk-shaped reports. Nothing here is real market data or a profitability claim.
 */

import { describe, it, expect } from "vitest";
import {
  buildSniperDryRunCampaign,
  type SniperDryRunCampaign,
  type SniperDryRunCampaignCandidateInput,
} from "./dryrun-campaign.js";
import {
  buildSniperStrategyIntelligence,
  validateSniperStrategyIntelligence,
  formatSniperStrategyIntelligence,
  SniperStrategyIntelligenceError,
  SNIPER_STRATEGY_INTELLIGENCE_SCHEMA_VERSION,
} from "./strategy-intelligence.js";

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const cand = (over: Partial<SniperDryRunCampaignCandidateInput> & { candidateId: string; mint: string }): SniperDryRunCampaignCandidateInput => over;

const cleanCandidate = (id: string, mint: string, score = 90): SniperDryRunCampaignCandidateInput =>
  cand({ candidateId: id, mint, score, riskDecision: "PASS_FOR_PAPER_EVALUATION", quoteStatus: "observed", buildStatus: "succeeded", simulationStatus: "simulated-ok", preflightVerdict: "pass" });

function makeCampaign(candidates: SniperDryRunCampaignCandidateInput[]): SniperDryRunCampaign {
  return buildSniperDryRunCampaign({ candidates, mode: "mainnet-dry-run" });
}

const riskReport = (mint: string, decision: string, flags: Array<{ id: string; severity: string; title: string }> = [], score = 10) => ({
  mint,
  report: { mint, score, decision, flags, summary: [], generatedAt: "2026-06-14T00:00:00.000Z", disclaimer: "advisory only" },
});

describe("buildSniperStrategyIntelligence — valid projection", () => {
  it("builds intelligence with the no-send labelling + pinned literals", () => {
    const campaign = makeCampaign([cleanCandidate("c1", WSOL)]);
    const intel = buildSniperStrategyIntelligence({ intelligenceId: "demo", campaign });
    expect(intel.schemaVersion).toBe(SNIPER_STRATEGY_INTELLIGENCE_SCHEMA_VERSION);
    expect(intel.liveTradingStatus).toBe("disabled");
    expect(intel.authorizesLiveTrading).toBe(false);
    expect(intel.neverSends).toBe(true);
    expect(intel.notAProfitabilityClaim).toBe(true);
    expect(intel.candidateCount).toBe(1);
    expect(intel.candidates[0]!.mintClass).toBe("wrapped-sol");
    expect(() => validateSniperStrategyIntelligence(intel)).not.toThrow();
  });

  it("surfaces freeze / mint authority flags by name from the risk report", () => {
    const campaign = makeCampaign([cand({ candidateId: "c1", mint: USDC, riskDecision: "REJECT" })]);
    const intel = buildSniperStrategyIntelligence({
      campaign,
      riskReports: [
        riskReport(USDC, "REJECT", [
          { id: "freeze-authority-present", severity: "critical", title: "Freeze authority present" },
          { id: "mint-authority-present", severity: "high", title: "Mint authority present" },
        ]),
      ],
    });
    const c = intel.candidates[0]!;
    expect(c.verdict).toBe("blocked");
    expect(c.notableFlags.map((f) => f.id)).toContain("freeze-authority-present");
    expect(c.notableFlags.map((f) => f.id)).toContain("mint-authority-present");
    expect(c.reasonCodes).toContain("authority-freeze-present");
    expect(c.reasonCodes).toContain("authority-mint-present");
    expect(c.reasonCodes).toContain("verdict-blocked");
    expect(c.confidence).toBe("high"); // blocked + we know why
    expect(c.whyItMatters).toContain("BLOCKED");
  });

  it("classifies wrapped-SOL and stablecoins honestly", () => {
    const campaign = makeCampaign([cleanCandidate("wsol", WSOL), cleanCandidate("usdc", USDC), cleanCandidate("bonk", BONK)]);
    const intel = buildSniperStrategyIntelligence({ campaign });
    const byId = new Map(intel.candidates.map((c) => [c.candidateId, c]));
    expect(byId.get("wsol")!.mintClass).toBe("wrapped-sol");
    expect(byId.get("usdc")!.mintClass).toBe("stablecoin");
    expect(byId.get("bonk")!.mintClass).toBe("other");
    expect(intel.mintClassCounts).toEqual({ wrappedSol: 1, stablecoin: 1, other: 1 });
  });

  it("marks a candidate without a risk report as low confidence (evidence-incomplete)", () => {
    const campaign = makeCampaign([cand({ candidateId: "c1", mint: BONK, watchlistStatus: "watch" })]); // insufficient
    const intel = buildSniperStrategyIntelligence({ campaign });
    const c = intel.candidates[0]!;
    expect(c.hasRiskReport).toBe(false);
    expect(c.confidence).toBe("low");
    expect(c.reasonCodes).toContain("risk-missing");
    expect(c.whatToStudyNext).toContain("token:risk");
  });

  it("re-derives verdict / confidence / mint-class counts + top concerns", () => {
    const campaign = makeCampaign([
      cleanCandidate("c1", WSOL),
      cand({ candidateId: "c2", mint: USDC, riskDecision: "REJECT" }),
      cand({ candidateId: "c3", mint: BONK, watchlistStatus: "watch" }),
    ]);
    const intel = buildSniperStrategyIntelligence({
      campaign,
      riskReports: [
        riskReport(USDC, "REJECT", [{ id: "freeze-authority-present", severity: "critical", title: "Freeze authority present" }]),
      ],
    });
    expect(intel.verdictCounts).toEqual({ watch: 1, review: 0, blocked: 1, insufficientEvidence: 1 });
    expect(intel.topConcerns[0]!.flagId).toBe("freeze-authority-present");
    expect(intel.topConcerns[0]!.candidateCount).toBe(1);
    expect(intel.strategyNotes.length).toBeGreaterThan(0);
  });
});

describe("buildSniperStrategyIntelligence — determinism", () => {
  it("produces a byte-identical artifact for identical input", () => {
    const campaign = makeCampaign([cleanCandidate("c1", WSOL), cand({ candidateId: "c2", mint: USDC, riskDecision: "REJECT" })]);
    const make = () => buildSniperStrategyIntelligence({ intelligenceId: "demo", campaign, riskReports: [riskReport(USDC, "REJECT", [{ id: "freeze-authority-present", severity: "critical", title: "Freeze authority present" }])] });
    expect(JSON.stringify(make())).toBe(JSON.stringify(make()));
  });

  it("formats deterministically", () => {
    const campaign = makeCampaign([cleanCandidate("c1", WSOL)]);
    const intel = buildSniperStrategyIntelligence({ intelligenceId: "demo", campaign });
    expect(formatSniperStrategyIntelligence(intel, { label: "demo" })).toBe(formatSniperStrategyIntelligence(intel, { label: "demo" }));
  });
});

describe("buildSniperStrategyIntelligence — malformed / safety refusals", () => {
  it("refuses a non-live-disabled campaign", () => {
    const campaign = { ...makeCampaign([cleanCandidate("c1", WSOL)]), liveSendStatus: "enabled" } as unknown as SniperDryRunCampaign;
    expect(() => buildSniperStrategyIntelligence({ campaign })).toThrow(/not live-disabled/);
  });

  it("refuses a risk report with an invalid mint", () => {
    const campaign = makeCampaign([cleanCandidate("c1", WSOL)]);
    expect(() => buildSniperStrategyIntelligence({ campaign, riskReports: [{ mint: "not-a-mint", report: {} }] })).toThrow(SniperStrategyIntelligenceError);
  });

  it("tolerates a malformed risk report object (defensive projection, no throw)", () => {
    const campaign = makeCampaign([cleanCandidate("c1", WSOL)]);
    const intel = buildSniperStrategyIntelligence({ campaign, riskReports: [{ mint: WSOL, report: { flags: "nope", decision: 5 } }] });
    expect(intel.candidates[0]!.riskDecision).toBeNull();
    expect(intel.candidates[0]!.notableFlags).toEqual([]);
  });

  it("refuses a secret-shaped flag title (redactionApplied stays honest)", () => {
    const campaign = makeCampaign([cand({ candidateId: "c1", mint: USDC, riskDecision: "REJECT" })]);
    const secretTitle = "a".repeat(90); // long base58-shaped blob the redactor flags
    expect(() =>
      buildSniperStrategyIntelligence({
        campaign,
        riskReports: [riskReport(USDC, "REJECT", [{ id: "freeze-authority-present", severity: "critical", title: secretTitle }])],
      }),
    ).toThrow(/secret-shaped/);
  });

  it("refuses a control-char-bearing flag title (no artifact corruption)", () => {
    const campaign = makeCampaign([cand({ candidateId: "c1", mint: USDC, riskDecision: "REJECT" })]);
    expect(() =>
      buildSniperStrategyIntelligence({
        campaign,
        riskReports: [riskReport(USDC, "REJECT", [{ id: "freeze-authority-present", severity: "critical", title: "bad\u0007title" }])],
      }),
    ).toThrow(/control character/);
  });

  it("validation rejects a notable flag whose title was tampered to a secret-shaped value", () => {
    const campaign = makeCampaign([cand({ candidateId: "c1", mint: USDC, riskDecision: "REJECT" })]);
    const intel = buildSniperStrategyIntelligence({
      campaign,
      riskReports: [riskReport(USDC, "REJECT", [{ id: "freeze-authority-present", severity: "critical", title: "Freeze authority present" }])],
    });
    const secret = "a".repeat(90);
    const tampered = {
      ...intel,
      candidates: [{ ...intel.candidates[0]!, notableFlags: [{ ...intel.candidates[0]!.notableFlags[0]!, title: secret }] }],
    };
    expect(() => validateSniperStrategyIntelligence(tampered)).toThrow(/secret-shaped/);
  });
});

describe("validateSniperStrategyIntelligence — closed schema + parity wall", () => {
  it("rejects an unknown top-level field", () => {
    const campaign = makeCampaign([cleanCandidate("c1", WSOL)]);
    const intel = buildSniperStrategyIntelligence({ campaign });
    expect(() => validateSniperStrategyIntelligence({ ...intel, sendResult: { ok: true } })).toThrow(/CLOSED|unknown field/i);
  });

  it("rejects tampered verdict counts (re-derived parity wall)", () => {
    const campaign = makeCampaign([cleanCandidate("c1", WSOL)]);
    const intel = buildSniperStrategyIntelligence({ campaign });
    expect(() => validateSniperStrategyIntelligence({ ...intel, verdictCounts: { watch: 99, review: 0, blocked: 0, insufficientEvidence: 0 } })).toThrow(/re-derived/);
  });

  it("rejects a reason code outside the closed set", () => {
    const campaign = makeCampaign([cleanCandidate("c1", WSOL)]);
    const intel = buildSniperStrategyIntelligence({ campaign });
    const tampered = { ...intel, candidates: [{ ...intel.candidates[0]!, reasonCodes: ["made-up-code"] }] };
    expect(() => validateSniperStrategyIntelligence(tampered)).toThrow(/reason-code/);
  });

  it("round-trips a built artifact through validation unchanged", () => {
    const campaign = makeCampaign([cleanCandidate("c1", WSOL), cand({ candidateId: "c2", mint: USDC, riskDecision: "REJECT" })]);
    const intel = buildSniperStrategyIntelligence({ campaign, riskReports: [riskReport(USDC, "REJECT", [{ id: "freeze-authority-present", severity: "critical", title: "Freeze authority present" }])] });
    expect(JSON.stringify(validateSniperStrategyIntelligence(intel))).toBe(JSON.stringify(intel));
  });
});
