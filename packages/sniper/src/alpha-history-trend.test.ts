/**
 * Tests for the Sprint 107 SNIPER ALPHA HISTORY TREND. Every input here is INJECTED, operator-shaped
 * evidence — fake labels, fake candidate ids, real (well-known) mint public keys used purely as
 * deterministic fixtures. Nothing here is real market data, a live result, or a profitability claim.
 */

import { describe, it, expect } from "vitest";
import {
  buildSniperDryRunCampaign,
  type SniperDryRunCampaign,
  type SniperDryRunCampaignCandidateInput,
} from "./dryrun-campaign.js";
import { buildSniperAlphaRunReport, type SniperAlphaRunReport } from "./alpha-run-report.js";
import { buildSniperAlphaHistory, type SniperAlphaHistory, type SniperAlphaHistoryRunInput } from "./alpha-history.js";
import {
  buildSniperAlphaHistoryTrend,
  validateSniperAlphaHistoryTrend,
  formatSniperAlphaHistoryTrend,
  SniperAlphaHistoryTrendError,
  SNIPER_ALPHA_HISTORY_TREND_SCHEMA_VERSION,
  SNIPER_ALPHA_HISTORY_TREND_BANNER,
  type SniperAlphaHistoryTrendSnapshotInput,
} from "./alpha-history-trend.js";

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const cand = (over: Partial<SniperDryRunCampaignCandidateInput> & { candidateId: string; mint: string }): SniperDryRunCampaignCandidateInput => over;

const cleanCandidate = (id: string, mint: string, score = 90): SniperDryRunCampaignCandidateInput =>
  cand({ candidateId: id, mint, score, riskDecision: "PASS_FOR_PAPER_EVALUATION", quoteStatus: "observed", buildStatus: "succeeded", simulationStatus: "simulated-ok", preflightVerdict: "pass" });

function makeCampaign(candidates: SniperDryRunCampaignCandidateInput[]): SniperDryRunCampaign {
  return buildSniperDryRunCampaign({ candidates, mode: "mainnet-dry-run" });
}

function makeReport(campaign: SniperDryRunCampaign, extra: Record<string, unknown> = {}): SniperAlphaRunReport {
  return buildSniperAlphaRunReport({
    campaign,
    campaignRef: "campaign.json",
    campaignPlanRef: "readonly-campaign-plan.json",
    evidenceProvenance: "real-readonly",
    providerHealth: { risk: "ok", quote: "ok", simulation: "ok" },
    rustEngineStatus: "available",
    phase7Status: "authorized-for-design-only",
    ...extra,
  });
}

function runWith(runRef: string, candidates: SniperDryRunCampaignCandidateInput[], opts: { provenance?: string; providerHealth?: Record<string, string> } = {}): SniperAlphaHistoryRunInput {
  const campaign = makeCampaign(candidates);
  const report = makeReport(campaign, { evidenceProvenance: opts.provenance ?? "real-readonly", providerHealth: opts.providerHealth ?? { risk: "ok", quote: "ok", simulation: "ok" } });
  return { runRef, campaign, report };
}

function history(historyId: string, runs: SniperAlphaHistoryRunInput[]): SniperAlphaHistory {
  return buildSniperAlphaHistory({ historyId, runs });
}

function snap(label: string, h: SniperAlphaHistory): SniperAlphaHistoryTrendSnapshotInput {
  return { label, history: h };
}

describe("buildSniperAlphaHistoryTrend — pinned no-send literals", () => {
  it("builds a trend with the canonical banner + pinned safety literals", () => {
    const h1 = history("mon", [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    const h2 = history("tue", [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    const trend = buildSniperAlphaHistoryTrend({ trendId: "demo", snapshots: [snap("mon", h1), snap("tue", h2)] });
    expect(trend.schemaVersion).toBe(SNIPER_ALPHA_HISTORY_TREND_SCHEMA_VERSION);
    expect(trend.banner).toBe(SNIPER_ALPHA_HISTORY_TREND_BANNER);
    expect(trend.liveTradingStatus).toBe("disabled");
    expect(trend.authorizesLiveTrading).toBe(false);
    expect(trend.anyInputAuthorizesLiveTrading).toBe(false);
    expect(trend.neverSends).toBe(true);
    expect(trend.phase7LiveTradingReady).toBe(false);
    expect(trend.redactionApplied).toBe(true);
    expect(trend.sensitiveFieldScan).toEqual({ scanned: true, signaturePresent: false, txidPresent: false, sendResultPresent: false, keyLikePresent: false });
    expect(() => validateSniperAlphaHistoryTrend(trend)).not.toThrow();
  });
});

describe("buildSniperAlphaHistoryTrend — series + step deltas in supplied order", () => {
  it("keeps the supplied order and derives the verdict series + candidate series", () => {
    const h1 = history("mon", [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL), cand({ candidateId: "c2", mint: USDC, riskDecision: "REJECT" })])]);
    const h2 = history("tue", [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    const h3 = history("wed", [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL), cleanCandidate("c3", BONK)])]);
    const trend = buildSniperAlphaHistoryTrend({ snapshots: [snap("mon", h1), snap("tue", h2), snap("wed", h3)] });
    expect(trend.snapshots.map((s) => s.label)).toEqual(["mon", "tue", "wed"]);
    expect(trend.verdictSeries.blocked).toEqual([1, 0, 0]);
    expect(trend.verdictSeries.watch).toEqual([1, 1, 2]);
    expect(trend.totalCandidateSeries).toEqual([2, 1, 2]);
    expect(trend.stepDeltas).toHaveLength(2);
    expect(trend.stepDeltas[0]).toEqual({ fromLabel: "mon", toLabel: "tue", candidateDelta: -1, verdictDeltas: { watch: 0, review: 0, blocked: -1, insufficientEvidence: 0 } });
    expect(trend.stepDeltas[1]!.verdictDeltas.watch).toBe(1);
    expect(() => validateSniperAlphaHistoryTrend(trend)).not.toThrow();
  });

  it("computes a deterministic summary line that says live trading is disabled", () => {
    const h1 = history("mon", [runWith("runs/a", [cand({ candidateId: "c1", mint: USDC, riskDecision: "REJECT" })])]);
    const h2 = history("tue", [runWith("runs/a", [cleanCandidate("c1", USDC)])]);
    const trend = buildSniperAlphaHistoryTrend({ snapshots: [snap("mon", h1), snap("tue", h2)] });
    expect(trend.summaryLine).toContain("blocked 1 -> 0 (-1)");
    expect(trend.summaryLine).toContain("live trading DISABLED.");
  });
});

describe("buildSniperAlphaHistoryTrend — reason totals + provenance + provider consistency", () => {
  it("totals blocker reasons across snapshots, sorted desc by run occurrence", () => {
    const h1 = history("mon", [runWith("runs/a", [cand({ candidateId: "c1", mint: USDC, riskDecision: "REJECT" })]), runWith("runs/b", [cand({ candidateId: "c2", mint: BONK, riskDecision: "REJECT" })])]);
    const h2 = history("tue", [runWith("runs/a", [cand({ candidateId: "c1", mint: USDC, riskDecision: "REJECT" })])]);
    const trend = buildSniperAlphaHistoryTrend({ snapshots: [snap("mon", h1), snap("tue", h2)] });
    const reject = trend.blockerReasonTotals.find((r) => r.reason.includes("REJECT"));
    expect(reject).toBeDefined();
    expect(reject!.totalRunCount).toBe(3); // 2 runs in mon + 1 in tue
    expect(reject!.snapshotCount).toBe(2);
    expect(trend.blockerReasonTotals[0]!.totalRunCount).toBeGreaterThanOrEqual(trend.blockerReasonTotals[trend.blockerReasonTotals.length - 1]!.totalRunCount);
  });

  it("derives provider consistency labels (always-ok / sometimes-ok / never-ok)", () => {
    const ok = history("mon", [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)], { providerHealth: { risk: "ok", quote: "ok", simulation: "ok" } })]);
    const bad = history("tue", [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)], { providerHealth: { risk: "unavailable", quote: "ok", simulation: "ok" } })]);
    const trend = buildSniperAlphaHistoryTrend({ snapshots: [snap("mon", ok), snap("tue", bad)] });
    expect(trend.providerHealthConsistency.risk).toEqual({ okRuns: 1, totalRuns: 2, label: "sometimes-ok" });
    expect(trend.providerHealthConsistency.quote.label).toBe("always-ok");
    expect(trend.provenanceTotals.realReadonly).toBe(2);
  });
});

describe("buildSniperAlphaHistoryTrend — empty snapshot handling", () => {
  it("tolerates an empty-history snapshot mixed with a non-empty one (no crash, honest consistency)", () => {
    const empty = buildSniperAlphaHistory({ historyId: "empty", runs: [] });
    const full = history("full", [runWith("runs/a", [cand({ candidateId: "c1", mint: USDC, riskDecision: "REJECT" })], { providerHealth: { risk: "ok", quote: "ok", simulation: "ok" } })]);
    const trend = buildSniperAlphaHistoryTrend({ snapshots: [snap("empty", empty), snap("full", full)] });
    expect(trend.snapshots[0]!.runCount).toBe(0);
    expect(trend.verdictSeries.blocked).toEqual([0, 1]);
    // The only run-bearing snapshot has an ok risk provider, so consistency is "always-ok" over 1 run.
    expect(trend.providerHealthConsistency.risk).toEqual({ okRuns: 1, totalRuns: 1, label: "always-ok" });
    expect(() => validateSniperAlphaHistoryTrend(trend)).not.toThrow();
  });
});

describe("buildSniperAlphaHistoryTrend — determinism", () => {
  it("produces byte-identical output for identical input", () => {
    const mk = () => [snap("mon", history("mon", [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])])), snap("tue", history("tue", [runWith("runs/a", [cand({ candidateId: "c1", mint: WRAPPED_SOL, riskDecision: "REJECT" })])]))];
    const a = buildSniperAlphaHistoryTrend({ snapshots: mk() });
    const b = buildSniperAlphaHistoryTrend({ snapshots: mk() });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("buildSniperAlphaHistoryTrend — refusals + malformed input handling", () => {
  it("refuses fewer than two snapshots", () => {
    const h = history("mon", [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    expect(() => buildSniperAlphaHistoryTrend({ snapshots: [snap("mon", h)] })).toThrow(/at least two snapshots/);
  });

  it("refuses duplicate snapshot labels", () => {
    const h1 = history("mon", [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    const h2 = history("tue", [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    expect(() => buildSniperAlphaHistoryTrend({ snapshots: [snap("mon", h1), snap("mon", h2)] })).toThrow(/duplicate snapshot label/);
  });

  it("refuses a malformed snapshot history (not a valid sniper.alpha_history.v1)", () => {
    const h = history("tue", [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    expect(() => buildSniperAlphaHistoryTrend({ snapshots: [{ label: "mon", history: { schemaVersion: "nope" } as never }, snap("tue", h)] })).toThrow(/not a valid sniper\.alpha_history\.v1/);
  });

  it("refuses a live-authorizing snapshot history", () => {
    const h1 = history("mon", [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    const h2 = history("tue", [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    const hostile = { ...h1, authorizesLiveTrading: true } as never;
    expect(() => buildSniperAlphaHistoryTrend({ snapshots: [{ label: "mon", history: hostile }, snap("tue", h2)] })).toThrow(SniperAlphaHistoryTrendError);
  });

  it("deep-scans a snapshot for a secret-shaped value smuggled into a run's blocker reasons", () => {
    const h1 = history("mon", [runWith("runs/a", [cand({ candidateId: "c1", mint: USDC, riskDecision: "REJECT" })])]);
    const h2 = history("tue", [runWith("runs/a", [cleanCandidate("c1", USDC)])]);
    const secret = "a".repeat(64);
    const hostile = JSON.parse(JSON.stringify(h1)) as typeof h1;
    expect(hostile.runs[0]!.blockerReasons.length).toBe(1);
    hostile.runs[0]!.blockerReasons[0] = secret;
    hostile.topBlockerReasons = [{ reason: secret, runCount: 1 }];
    expect(() => buildSniperAlphaHistoryTrend({ snapshots: [{ label: "mon", history: hostile as never }, snap("tue", h2)] })).toThrow(/secret-shaped/);
  });
});

describe("validateSniperAlphaHistoryTrend — parity wall + closed schema", () => {
  function goodTrend() {
    const h1 = history("mon", [runWith("runs/a", [cand({ candidateId: "c1", mint: USDC, riskDecision: "REJECT" })])]);
    const h2 = history("tue", [runWith("runs/a", [cleanCandidate("c1", USDC)])]);
    return buildSniperAlphaHistoryTrend({ snapshots: [snap("mon", h1), snap("tue", h2)] });
  }

  it("rejects an unknown top-level field (closed schema)", () => {
    const t = { ...goodTrend(), sendResult: { ok: true } };
    expect(() => validateSniperAlphaHistoryTrend(t)).toThrow(/unknown field "sendResult"/);
  });

  it("rejects a tampered step delta", () => {
    const t = goodTrend();
    t.stepDeltas[0]!.verdictDeltas.blocked = 99;
    expect(() => validateSniperAlphaHistoryTrend(t)).toThrow(/stepDeltas must be re-derived/);
  });

  it("rejects a tampered verdict series", () => {
    const t = goodTrend();
    t.verdictSeries.blocked = [9, 9];
    expect(() => validateSniperAlphaHistoryTrend(t)).toThrow(/verdictSeries must be re-derived/);
  });

  it("rejects blockerReasonTotals that are not sorted desc", () => {
    const t = goodTrend();
    t.blockerReasonTotals = [
      { reason: "aaa", totalRunCount: 1, snapshotCount: 1 },
      { reason: "bbb", totalRunCount: 5, snapshotCount: 1 },
    ];
    expect(() => validateSniperAlphaHistoryTrend(t)).toThrow(/sorted by totalRunCount desc/);
  });

  it("rejects a flipped live-trading literal", () => {
    const t = goodTrend();
    (t as unknown as Record<string, unknown>).liveTradingStatus = "enabled";
    expect(() => validateSniperAlphaHistoryTrend(t)).toThrow(/liveTradingStatus must literally be/);
  });
});

describe("formatSniperAlphaHistoryTrend — redacted, deterministic", () => {
  it("renders snapshots, step deltas, and disclaimers; output is redacted + stable", () => {
    const h1 = history("mon", [runWith("runs/a", [cand({ candidateId: "c1", mint: USDC, riskDecision: "REJECT" })])]);
    const h2 = history("tue", [runWith("runs/a", [cleanCandidate("c1", USDC)])]);
    const trend = buildSniperAlphaHistoryTrend({ snapshots: [snap("mon", h1), snap("tue", h2)] });
    const out1 = formatSniperAlphaHistoryTrend(trend, { label: "demo" });
    const out2 = formatSniperAlphaHistoryTrend(trend, { label: "demo" });
    expect(out1).toBe(out2);
    expect(out1).toContain("SNIPER ALPHA HISTORY TREND");
    expect(out1).toContain("LIVE TRADING IS DISABLED");
    expect(out1).toContain("mon -> tue");
  });
});
