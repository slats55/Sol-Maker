/**
 * Tests for the Sprint 104-C SNIPER DRY-RUN CAMPAIGN. Everything here is INJECTED, operator-shaped
 * evidence — fake candidate ids, real (well-known) mint public keys used purely as deterministic
 * fixtures. Nothing here is real market data, a live result, a verified on-chain fact, or a
 * profitability claim.
 */

import { describe, it, expect } from "vitest";
import { REDACTED } from "@soulmaker/security";
import {
  buildSniperDryRunCampaign,
  validateSniperDryRunCampaign,
  formatSniperDryRunCampaign,
  deriveSniperCampaignCandidateVerdict,
  SniperDryRunCampaignError,
  SNIPER_DRYRUN_CAMPAIGN_SCHEMA_VERSION,
  SNIPER_DRYRUN_CAMPAIGN_BANNER,
  type SniperDryRunCampaignCandidateInput,
  type SniperDryRunCampaign,
} from "./dryrun-campaign.js";

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const cand = (over: Partial<SniperDryRunCampaignCandidateInput> & { candidateId: string; mint: string }): SniperDryRunCampaignCandidateInput =>
  over;
const campaign = (candidates: SniperDryRunCampaignCandidateInput[], extra: Record<string, unknown> = {}) =>
  buildSniperDryRunCampaign({ candidates, ...extra });

// A fully-clean candidate (risk PASS + fresh quote + sim ok + build succeeded + preflight pass).
const cleanCandidate = (id: string, mint: string): SniperDryRunCampaignCandidateInput =>
  cand({
    candidateId: id,
    mint,
    score: 90,
    riskDecision: "PASS_FOR_PAPER_EVALUATION",
    quoteStatus: "observed",
    buildStatus: "succeeded",
    simulationStatus: "simulated-ok",
    preflightVerdict: "pass",
  });

describe("buildSniperDryRunCampaign — valid", () => {
  it("builds a campaign with the no-send labelling + pinned literals", () => {
    const c = campaign([cleanCandidate("c1", WRAPPED_SOL)], { campaignId: "demo", mode: "mainnet-dry-run" });
    expect(c.schemaVersion).toBe(SNIPER_DRYRUN_CAMPAIGN_SCHEMA_VERSION);
    expect(c.banner).toBe(SNIPER_DRYRUN_CAMPAIGN_BANNER);
    expect(c.mode).toBe("mainnet-dry-run");
    expect(c.network).toBe("mainnet-beta");
    expect(c.liveSendStatus).toBe("disabled");
    expect(c.neverSends).toBe(true);
    expect(c.notExecutable).toBe(true);
    expect(c.phase7LiveTradingReady).toBe(false);
    expect(c.scoreCannotOverrideBlock).toBe(true);
    expect(c.candidateCount).toBe(1);
    expect(c.candidates[0]!.finalOperatorVerdict).toBe("watch");
    expect(c.verdictCounts).toEqual({ watch: 1, review: 0, blocked: 0, insufficientEvidence: 0 });
    expect(() => validateSniperDryRunCampaign(c)).not.toThrow();
  });

  it("re-derives verdict counts and stage coverage", () => {
    const c = campaign([
      cleanCandidate("c1", WRAPPED_SOL),
      cand({ candidateId: "c2", mint: USDC, riskDecision: "REJECT" }), // blocked
      cand({ candidateId: "c3", mint: BONK, watchlistStatus: "watch" }), // no core evidence -> insufficient
    ]);
    expect(c.verdictCounts).toEqual({ watch: 1, review: 0, blocked: 1, insufficientEvidence: 1 });
    const risk = c.stages.find((s) => s.stage === "risk")!;
    expect(risk.candidatesCovered).toBe(2); // c1 PASS + c2 REJECT
    expect(risk.candidateCount).toBe(3);
  });
});

describe("buildSniperDryRunCampaign — verdict derivation (a score can never override a blocker)", () => {
  it("a REJECT risk candidate is BLOCKED even with a perfect score", () => {
    const c = campaign([
      cand({ candidateId: "c1", mint: USDC, score: 100, riskDecision: "REJECT", quoteStatus: "observed", buildStatus: "succeeded", simulationStatus: "simulated-ok", preflightVerdict: "pass" }),
    ]);
    expect(c.candidates[0]!.finalOperatorVerdict).toBe("blocked");
    expect(c.candidates[0]!.blockers.some((b) => b.includes("REJECT"))).toBe(true);
  });

  it("a critical-flag / Token-2022 / preflight-fail / build-refused / sim-failed candidate is BLOCKED", () => {
    const blockers: SniperDryRunCampaignCandidateInput[] = [
      cand({ candidateId: "crit", mint: USDC, score: 99, riskDecision: "PASS_FOR_PAPER_EVALUATION", riskCriticalFlagCount: 1 }),
      cand({ candidateId: "t22", mint: USDC, score: 99, riskDecision: "PASS_FOR_PAPER_EVALUATION", token2022Blocker: true }),
      cand({ candidateId: "pf", mint: USDC, score: 99, preflightVerdict: "fail" }),
      cand({ candidateId: "build", mint: USDC, score: 99, preflightVerdict: "pass", buildStatus: "refused", buildRefusalCodes: ["risk-rejected"] }),
      cand({ candidateId: "sim", mint: USDC, score: 99, preflightVerdict: "pass", simulationStatus: "failed" }),
      cand({ candidateId: "wl", mint: USDC, score: 99, riskDecision: "PASS_FOR_PAPER_EVALUATION", watchlistStatus: "blocked" }),
      cand({ candidateId: "rc", mint: USDC, score: 99, releaseCandidateVerdict: "dryrun-blocked-simulation" }),
    ];
    for (const b of blockers) {
      const c = campaign([b]);
      expect(c.candidates[0]!.finalOperatorVerdict, `${b.candidateId} should be blocked`).toBe("blocked");
      expect(c.candidates[0]!.blockers.length).toBeGreaterThan(0);
    }
  });

  it("a stale quote (otherwise clean) is REVIEW, not watch", () => {
    const c = campaign([
      cand({ candidateId: "c1", mint: USDC, riskDecision: "PASS_FOR_PAPER_EVALUATION", quoteStatus: "stale", preflightVerdict: "pass" }),
    ]);
    expect(c.candidates[0]!.finalOperatorVerdict).toBe("review");
    expect(c.candidates[0]!.nextSafeAction).toContain("stale");
  });

  it("a CAUTION risk is REVIEW", () => {
    const c = campaign([cand({ candidateId: "c1", mint: USDC, riskDecision: "CAUTION", preflightVerdict: "warn" })]);
    expect(c.candidates[0]!.finalOperatorVerdict).toBe("review");
  });

  it("no core evidence (only a watchlist status / score) is INSUFFICIENT-EVIDENCE", () => {
    const c = campaign([cand({ candidateId: "c1", mint: USDC, score: 88, watchlistStatus: "watch", quoteStatus: "observed" })]);
    expect(c.candidates[0]!.finalOperatorVerdict).toBe("insufficient-evidence");
  });

  it("a clean candidate with a positive signal and no concern is WATCH", () => {
    const c = campaign([cleanCandidate("c1", USDC)]);
    expect(c.candidates[0]!.finalOperatorVerdict).toBe("watch");
    expect(c.candidates[0]!.blockers).toEqual([]);
  });

  it("deriveSniperCampaignCandidateVerdict is pure and ignores the score (exported)", () => {
    const base = {
      watchlistStatus: null,
      riskDecision: "REJECT" as const,
      riskCriticalFlagCount: null,
      token2022Blocker: false,
      quoteStatus: null,
      buildStatus: null,
      buildRefusalCodes: [],
      simulationStatus: null,
      releaseCandidateVerdict: null,
      preflightVerdict: null,
    };
    expect(deriveSniperCampaignCandidateVerdict(base)).toBe("blocked");
  });
});

describe("validateSniperDryRunCampaign — closed schema + parity wall", () => {
  it("refuses an unknown top-level field (the schema is CLOSED — no send/signature field can appear)", () => {
    const c = campaign([cleanCandidate("c1", USDC)]) as unknown as Record<string, unknown>;
    expect(() => validateSniperDryRunCampaign({ ...c, signature: "abc" })).toThrow(/CLOSED/);
    expect(() => validateSniperDryRunCampaign({ ...c, sendResult: { ok: true } })).toThrow(/CLOSED/);
    expect(() => validateSniperDryRunCampaign({ ...c, txid: "abc" })).toThrow(/CLOSED/);
  });

  it("refuses an unknown candidate field (the schema is CLOSED)", () => {
    const c = campaign([cleanCandidate("c1", USDC)]) as SniperDryRunCampaign;
    const tampered = { ...c, candidates: [{ ...c.candidates[0]!, signature: "sneaky" }] };
    expect(() => validateSniperDryRunCampaign(tampered)).toThrow(/CLOSED/);
  });

  it("refuses a tampered verdict — a 'watch' verdict on a REJECT candidate is re-derived to blocked", () => {
    const c = campaign([cand({ candidateId: "c1", mint: USDC, score: 100, riskDecision: "REJECT" })]) as SniperDryRunCampaign;
    const tampered: SniperDryRunCampaign = {
      ...c,
      candidates: [{ ...c.candidates[0]!, finalOperatorVerdict: "watch", blockers: [] }],
    };
    expect(() => validateSniperDryRunCampaign(tampered)).toThrow(/re-derived/);
  });

  it("refuses a blocked candidate with no blocker reasons, and a non-blocked one WITH blockers", () => {
    const c = campaign([cand({ candidateId: "c1", mint: USDC, riskDecision: "REJECT" })]) as SniperDryRunCampaign;
    const noReasons: SniperDryRunCampaign = { ...c, candidates: [{ ...c.candidates[0]!, blockers: [] }] };
    expect(() => validateSniperDryRunCampaign(noReasons)).toThrow(/no blocker reasons/);

    const clean = campaign([cleanCandidate("c1", USDC)]) as SniperDryRunCampaign;
    const fakeBlockers: SniperDryRunCampaign = { ...clean, candidates: [{ ...clean.candidates[0]!, blockers: ["fake"] }] };
    expect(() => validateSniperDryRunCampaign(fakeBlockers)).toThrow(/not blocked but carries blocker/);
  });

  it("refuses a fabricated verdict count and a tampered stage coverage", () => {
    const c = campaign([cleanCandidate("c1", USDC)]) as SniperDryRunCampaign;
    expect(() => validateSniperDryRunCampaign({ ...c, verdictCounts: { watch: 5, review: 0, blocked: 0, insufficientEvidence: 0 } })).toThrow(/verdictCounts/);
    const tamperedStages = c.stages.map((s) => (s.stage === "risk" ? { ...s, candidatesCovered: 99 } : s));
    expect(() => validateSniperDryRunCampaign({ ...c, stages: tamperedStages })).toThrow(/stages/);
  });

  it("refuses a flipped live-send / safety literal (liveSendStatus can never be enabled)", () => {
    const c = campaign([cleanCandidate("c1", USDC)]) as unknown as Record<string, unknown>;
    expect(() => validateSniperDryRunCampaign({ ...c, liveSendStatus: "enabled" })).toThrow(/liveSendStatus/);
    expect(() => validateSniperDryRunCampaign({ ...c, neverSends: false })).toThrow(/neverSends/);
    expect(() => validateSniperDryRunCampaign({ ...c, phase7LiveTradingReady: true })).toThrow(/phase7LiveTradingReady/);
  });
});

describe("buildSniperDryRunCampaign — refusals", () => {
  it("refuses an empty candidate list", () => {
    expect(() => campaign([])).toThrow(SniperDryRunCampaignError);
  });
  it("refuses a duplicate candidateId", () => {
    expect(() => campaign([cand({ candidateId: "x", mint: USDC }), cand({ candidateId: "x", mint: WRAPPED_SOL })])).toThrow(SniperDryRunCampaignError);
  });
  it("refuses an invalid mint and a secret-length mint", () => {
    expect(() => campaign([cand({ candidateId: "c1", mint: "nope" })])).toThrow(SniperDryRunCampaignError);
    expect(() => campaign([cand({ candidateId: "c1", mint: "5".repeat(88) })])).toThrow(SniperDryRunCampaignError);
  });
  it("refuses an unknown mode / network / enum value", () => {
    expect(() => campaign([cleanCandidate("c1", USDC)], { mode: "mainnet-live" })).toThrow(SniperDryRunCampaignError);
    expect(() => campaign([cleanCandidate("c1", USDC)], { network: "mainnet-live" })).toThrow(SniperDryRunCampaignError);
    expect(() => campaign([cand({ candidateId: "c1", mint: USDC, riskDecision: "MAYBE" })])).toThrow(SniperDryRunCampaignError);
  });
});

describe("formatSniperDryRunCampaign", () => {
  it("renders a stable, redacted comparison leading with the banner + tally", () => {
    const c = campaign([cleanCandidate("c1", WRAPPED_SOL), cand({ candidateId: "c2", mint: USDC, riskDecision: "REJECT" })]);
    const text = formatSniperDryRunCampaign(c, { label: "demo" });
    expect(text).toContain(SNIPER_DRYRUN_CAMPAIGN_BANNER);
    expect(text).toContain("[watch]");
    expect(text).toContain("[BLOCKED]");
    expect(text).toContain("LIVE SENDING IS DISABLED");
    expect(text).toContain("Not a trade signal.");
    expect(formatSniperDryRunCampaign(c, { label: "demo" })).toBe(text);
  });

  it("redacts a secret reaching the formatter via a note", () => {
    const c = campaign([cleanCandidate("c1", BONK)]) as SniperDryRunCampaign;
    const blob = "z".repeat(88);
    const tampered: SniperDryRunCampaign = { ...c, candidates: [{ ...c.candidates[0]!, notes: [`leak ${blob}`] }] };
    const text = formatSniperDryRunCampaign(tampered);
    expect(text).toContain(REDACTED);
    expect(text).not.toContain(blob);
  });
});
