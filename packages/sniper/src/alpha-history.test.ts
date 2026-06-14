/**
 * Tests for the Sprint 106 SNIPER ALPHA HISTORY rollup. Every input here is INJECTED, operator-shaped
 * evidence — fake run refs, fake candidate ids, real (well-known) mint public keys used purely as
 * deterministic fixtures. Nothing here is real market data, a live result, or a profitability claim.
 */

import { describe, it, expect } from "vitest";
import {
  buildSniperDryRunCampaign,
  type SniperDryRunCampaign,
  type SniperDryRunCampaignCandidateInput,
} from "./dryrun-campaign.js";
import { buildSniperAlphaRunReport, type SniperAlphaRunReport } from "./alpha-run-report.js";
import {
  buildSniperAlphaHistory,
  validateSniperAlphaHistory,
  formatSniperAlphaHistory,
  SniperAlphaHistoryError,
  SNIPER_ALPHA_HISTORY_SCHEMA_VERSION,
  SNIPER_ALPHA_HISTORY_BANNER,
  type SniperAlphaHistoryRunInput,
} from "./alpha-history.js";

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const cand = (over: Partial<SniperDryRunCampaignCandidateInput> & { candidateId: string; mint: string }): SniperDryRunCampaignCandidateInput =>
  over;

const cleanCandidate = (id: string, mint: string, score = 90): SniperDryRunCampaignCandidateInput =>
  cand({
    candidateId: id,
    mint,
    score,
    riskDecision: "PASS_FOR_PAPER_EVALUATION",
    quoteStatus: "observed",
    buildStatus: "succeeded",
    simulationStatus: "simulated-ok",
    preflightVerdict: "pass",
  });

function makeCampaign(candidates: SniperDryRunCampaignCandidateInput[], extra: Record<string, unknown> = {}): SniperDryRunCampaign {
  return buildSniperDryRunCampaign({ candidates, ...extra });
}

function makeReport(campaign: SniperDryRunCampaign, extra: Record<string, unknown> = {}): SniperAlphaRunReport {
  return buildSniperAlphaRunReport({
    campaign,
    campaignRef: "campaign.json",
    campaignPlanRef: "readonly-campaign-plan.json",
    ...extra,
  });
}

/** A typical run with a campaign + an alpha report. */
function runWith(runRef: string, candidates: SniperDryRunCampaignCandidateInput[], opts: { mode?: string; provenance?: string; report?: boolean; providerHealth?: Record<string, string> } = {}): SniperAlphaHistoryRunInput {
  const campaign = makeCampaign(candidates, { mode: opts.mode ?? "mainnet-dry-run" });
  if (opts.report === false) return { runRef, campaign, report: null };
  const report = makeReport(campaign, {
    evidenceProvenance: opts.provenance ?? "real-readonly",
    providerHealth: opts.providerHealth ?? { risk: "ok", quote: "ok", simulation: "ok" },
    rustEngineStatus: "available",
    phase7Status: "authorized-for-design-only",
  });
  return { runRef, campaign, report };
}

describe("buildSniperAlphaHistory — valid rollup", () => {
  it("builds a history with the no-send labelling + pinned literals", () => {
    const h = buildSniperAlphaHistory({
      historyId: "demo",
      runs: [
        runWith("runs/alpha-a", [cleanCandidate("c1", WRAPPED_SOL), cand({ candidateId: "c2", mint: USDC, riskDecision: "REJECT" })]),
      ],
    });
    expect(h.schemaVersion).toBe(SNIPER_ALPHA_HISTORY_SCHEMA_VERSION);
    expect(h.banner).toBe(SNIPER_ALPHA_HISTORY_BANNER);
    expect(h.liveTradingStatus).toBe("disabled");
    expect(h.authorizesLiveTrading).toBe(false);
    expect(h.anyRunAuthorizesLiveTrading).toBe(false);
    expect(h.neverSends).toBe(true);
    expect(h.phase7LiveTradingReady).toBe(false);
    expect(h.redactionApplied).toBe(true);
    expect(h.sensitiveFieldScan).toEqual({ scanned: true, signaturePresent: false, txidPresent: false, sendResultPresent: false, keyLikePresent: false });
    expect(h.runCount).toBe(1);
    expect(h.totalCandidateCount).toBe(2);
    expect(h.aggregateVerdictCounts).toEqual({ watch: 1, review: 0, blocked: 1, insufficientEvidence: 0 });
    expect(() => validateSniperAlphaHistory(h)).not.toThrow();
  });

  it("aggregates verdict counts + provenance + provider health across runs", () => {
    const h = buildSniperAlphaHistory({
      runs: [
        runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)], { provenance: "real-readonly", providerHealth: { risk: "ok", quote: "ok", simulation: "ok" } }),
        runWith("runs/b", [cand({ candidateId: "c2", mint: USDC, riskDecision: "REJECT" }), cand({ candidateId: "c3", mint: BONK, watchlistStatus: "watch" })], { provenance: "fixture", providerHealth: { risk: "unavailable", quote: "not-attempted", simulation: "unavailable" } }),
      ],
    });
    expect(h.runCount).toBe(2);
    expect(h.totalCandidateCount).toBe(3);
    expect(h.aggregateVerdictCounts).toEqual({ watch: 1, review: 0, blocked: 1, insufficientEvidence: 1 });
    expect(h.evidenceProvenanceRollup).toEqual({ realReadonly: 1, fixture: 1, fictionalExample: 0, mixed: 0 });
    expect(h.providerHealthRollup.risk).toEqual({ ok: 1, degraded: 0, unavailable: 1, notAttempted: 0 });
    expect(h.providerHealthRollup.quote).toEqual({ ok: 1, degraded: 0, unavailable: 0, notAttempted: 1 });
    expect(h.phase7Postures).toEqual(["authorized-for-design-only"]);
    expect(() => validateSniperAlphaHistory(h)).not.toThrow();
  });

  it("rolls up the most common blocker reasons by run frequency", () => {
    const h = buildSniperAlphaHistory({
      runs: [
        runWith("runs/a", [cand({ candidateId: "c1", mint: USDC, riskDecision: "REJECT" })]),
        runWith("runs/b", [cand({ candidateId: "c2", mint: BONK, riskDecision: "REJECT" })]),
        runWith("runs/c", [cand({ candidateId: "c3", mint: WRAPPED_SOL, preflightVerdict: "fail" })]),
      ],
    });
    expect(h.topBlockerReasons[0]!.runCount).toBe(2);
    expect(h.topBlockerReasons[0]!.reason).toContain("REJECT");
    expect(h.topBlockerReasons.some((b) => b.reason.includes("preflight"))).toBe(true);
  });

  it("derives the best monitorable mint per run (rank asc, score desc)", () => {
    const h = buildSniperAlphaHistory({
      runs: [
        runWith("runs/a", [cleanCandidate("low", WRAPPED_SOL, 40), cleanCandidate("high", BONK, 95)]),
      ],
    });
    expect(h.runs[0]!.topMint).toBe(BONK);
  });

  it("ingests a campaign-only run (no alpha report) with defaulted provider health", () => {
    const h = buildSniperAlphaHistory({
      runs: [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)], { report: false })],
    });
    expect(h.runs[0]!.hasAlphaReport).toBe(false);
    expect(h.runs[0]!.providerHealth).toEqual({ risk: "not-attempted", quote: "not-attempted", simulation: "not-attempted" });
    expect(h.runs[0]!.evidenceProvenance).toBe("mixed");
    expect(h.runs[0]!.rustEngineStatus).toBe("not-used");
    expect(h.runs[0]!.phase7Status).toBe("not-checked");
    expect(() => validateSniperAlphaHistory(h)).not.toThrow();
  });
});

describe("buildSniperAlphaHistory — determinism + stable sorting", () => {
  it("produces a byte-identical artifact for identical input", () => {
    const make = () =>
      buildSniperAlphaHistory({
        historyId: "demo",
        runs: [
          runWith("runs/b", [cleanCandidate("c1", WRAPPED_SOL)]),
          runWith("runs/a", [cand({ candidateId: "c2", mint: USDC, riskDecision: "REJECT" })]),
        ],
      });
    expect(JSON.stringify(make())).toBe(JSON.stringify(make()));
  });

  it("sorts runs by runRef ascending regardless of input order", () => {
    const h = buildSniperAlphaHistory({
      runs: [
        runWith("runs/zeta", [cleanCandidate("c1", WRAPPED_SOL)]),
        runWith("runs/alpha", [cleanCandidate("c2", USDC)]),
        runWith("runs/mid", [cleanCandidate("c3", BONK)]),
      ],
    });
    expect(h.runs.map((r) => r.runRef)).toEqual(["runs/alpha", "runs/mid", "runs/zeta"]);
  });

  it("formats deterministically (byte-identical for identical input)", () => {
    const h = buildSniperAlphaHistory({ historyId: "demo", runs: [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])] });
    expect(formatSniperAlphaHistory(h, { label: "demo" })).toBe(formatSniperAlphaHistory(h, { label: "demo" }));
  });
});

describe("buildSniperAlphaHistory — reliability + bounded output at scale", () => {
  // Build N distinct runs (each a campaign with one clean + one rejected candidate).
  function manyRuns(n: number): SniperAlphaHistoryRunInput[] {
    const runs: SniperAlphaHistoryRunInput[] = [];
    for (let i = 0; i < n; i++) {
      const label = `runs/r-${String(i).padStart(3, "0")}`;
      runs.push(runWith(label, [cleanCandidate(`clean-${i}`, WRAPPED_SOL), cand({ candidateId: `rej-${i}`, mint: USDC, riskDecision: "REJECT" })]));
    }
    return runs;
  }

  it("is order-independent: shuffled input yields the byte-identical artifact (stable sort)", () => {
    const runs = manyRuns(40);
    const inOrder = buildSniperAlphaHistory({ historyId: "scale", runs });
    const reversed = buildSniperAlphaHistory({ historyId: "scale", runs: [...runs].reverse() });
    expect(JSON.stringify(inOrder)).toBe(JSON.stringify(reversed));
    expect(inOrder.runCount).toBe(40);
    expect(inOrder.runs.map((r) => r.runRef)).toEqual([...inOrder.runs.map((r) => r.runRef)].sort());
  });

  it("bounds the blocker-reason rollup (never an unbounded list)", () => {
    // Each run contributes a distinct blocker reason via a unique critical flag count.
    const runs: SniperAlphaHistoryRunInput[] = [];
    for (let i = 0; i < 60; i++) {
      runs.push(runWith(`runs/r-${String(i).padStart(3, "0")}`, [cand({ candidateId: `rej-${i}`, mint: USDC, riskDecision: "REJECT", riskCriticalFlagCount: (i % 9) + 1 })]));
    }
    const h = buildSniperAlphaHistory({ runs });
    expect(h.runCount).toBe(60);
    expect(h.topBlockerReasons.length).toBeLessThanOrEqual(24); // MAX_TOP_BLOCKER_REASONS
    expect(() => validateSniperAlphaHistory(h)).not.toThrow();
  });

  it("validates a large rollup and re-derives every aggregate", () => {
    const h = buildSniperAlphaHistory({ runs: manyRuns(100) });
    expect(h.totalCandidateCount).toBe(200);
    expect(h.aggregateVerdictCounts.watch).toBe(100);
    expect(h.aggregateVerdictCounts.blocked).toBe(100);
    expect(() => validateSniperAlphaHistory(h)).not.toThrow();
  });
});

describe("buildSniperAlphaHistory — invalid / unrecognized artifacts", () => {
  it("records invalid artifacts honestly and never counts them as runs", () => {
    const h = buildSniperAlphaHistory({
      runs: [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])],
      invalidArtifacts: [
        { ref: "runs/broken/campaign.json", reason: "malformed JSON" },
        { ref: "runs/empty", reason: "missing recognized artifact (campaign.json)" },
      ],
    });
    expect(h.runCount).toBe(1);
    expect(h.invalidArtifactCount).toBe(2);
    expect(h.invalidArtifacts.map((a) => a.ref)).toEqual(["runs/broken/campaign.json", "runs/empty"]);
    expect(() => validateSniperAlphaHistory(h)).not.toThrow();
  });

  it("handles an empty history (no valid runs) with an honest next safe action", () => {
    const h = buildSniperAlphaHistory({ runs: [], invalidArtifacts: [{ ref: "runs/x", reason: "missing recognized artifact (campaign.json)" }] });
    expect(h.runCount).toBe(0);
    expect(h.totalCandidateCount).toBe(0);
    expect(h.nextSafeActions.some((a) => a.includes("No valid runs"))).toBe(true);
    expect(() => validateSniperAlphaHistory(h)).not.toThrow();
  });

  it("sorts invalid artifacts deterministically by ref then reason", () => {
    const h = buildSniperAlphaHistory({
      runs: [],
      invalidArtifacts: [
        { ref: "runs/z", reason: "bad" },
        { ref: "runs/a", reason: "second" },
        { ref: "runs/a", reason: "first" },
      ],
    });
    expect(h.invalidArtifacts).toEqual([
      { ref: "runs/a", reason: "first" },
      { ref: "runs/a", reason: "second" },
      { ref: "runs/z", reason: "bad" },
    ]);
  });
});

describe("buildSniperAlphaHistory — malformed input is refused", () => {
  it("refuses a duplicate runRef", () => {
    expect(() =>
      buildSniperAlphaHistory({
        runs: [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)]), runWith("runs/a", [cleanCandidate("c2", USDC)])],
      }),
    ).toThrow(SniperAlphaHistoryError);
  });

  it("refuses a run with no campaign", () => {
    expect(() => buildSniperAlphaHistory({ runs: [{ runRef: "runs/a", campaign: {} as never }] })).toThrow(SniperAlphaHistoryError);
  });

  it("refuses a secret-shaped runRef", () => {
    expect(() =>
      buildSniperAlphaHistory({ runs: [runWith("a".repeat(90), [cleanCandidate("c1", WRAPPED_SOL)])] }),
    ).toThrow(SniperAlphaHistoryError);
  });

  it("refuses a mismatched campaign/report pair", () => {
    const campaign = makeCampaign([cleanCandidate("c1", WRAPPED_SOL)]);
    const otherCampaign = makeCampaign([cleanCandidate("c1", WRAPPED_SOL), cleanCandidate("c2", USDC)]);
    const report = makeReport(otherCampaign);
    expect(() => buildSniperAlphaHistory({ runs: [{ runRef: "runs/a", campaign, report }] })).toThrow(/mismatched pair/);
  });
});

describe("buildSniperAlphaHistory — safety refusals (live authorization / sensitive fields)", () => {
  it("refuses a campaign that claims a non-disabled live-send status", () => {
    const campaign = { ...makeCampaign([cleanCandidate("c1", WRAPPED_SOL)]), liveSendStatus: "enabled" } as unknown as SniperDryRunCampaign;
    expect(() => buildSniperAlphaHistory({ runs: [{ runRef: "runs/a", campaign }] })).toThrow(/non-disabled live-send/);
  });

  it("refuses a report that claims live authorization", () => {
    const campaign = makeCampaign([cleanCandidate("c1", WRAPPED_SOL)]);
    const report = { ...makeReport(campaign), authorizesLiveTrading: true } as unknown as SniperAlphaRunReport;
    expect(() => buildSniperAlphaHistory({ runs: [{ runRef: "runs/a", campaign, report }] })).toThrow(/live authorization/);
  });

  it("refuses a run carrying a forbidden send/signature field", () => {
    const campaign = makeCampaign([cleanCandidate("c1", WRAPPED_SOL)]);
    const tampered = { ...campaign, sendResult: { ok: true } } as unknown as SniperDryRunCampaign;
    expect(() => buildSniperAlphaHistory({ runs: [{ runRef: "runs/a", campaign: tampered }] })).toThrow(/forbidden send/);
  });
});

describe("validateSniperAlphaHistory — closed schema + parity wall", () => {
  it("rejects an unknown top-level field (the schema is CLOSED)", () => {
    const h = buildSniperAlphaHistory({ runs: [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])] });
    expect(() => validateSniperAlphaHistory({ ...h, signature: "abc" })).toThrow(/CLOSED|unknown field/i);
  });

  it("rejects a tampered aggregate verdict count (re-derived parity wall)", () => {
    const h = buildSniperAlphaHistory({ runs: [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])] });
    const tampered = { ...h, aggregateVerdictCounts: { watch: 99, review: 0, blocked: 0, insufficientEvidence: 0 } };
    expect(() => validateSniperAlphaHistory(tampered)).toThrow(/re-derived/);
  });

  it("rejects a tampered live-trading status", () => {
    const h = buildSniperAlphaHistory({ runs: [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])] });
    expect(() => validateSniperAlphaHistory({ ...h, liveTradingStatus: "enabled" })).toThrow(/disabled/);
  });

  it("rejects runs that are not sorted by runRef", () => {
    const h = buildSniperAlphaHistory({
      runs: [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)]), runWith("runs/b", [cleanCandidate("c2", USDC)])],
    });
    const unsorted = { ...h, runs: [...h.runs].reverse() };
    expect(() => validateSniperAlphaHistory(unsorted)).toThrow(/sorted/);
  });

  it("round-trips a built artifact through validation unchanged", () => {
    const h = buildSniperAlphaHistory({
      historyId: "demo",
      runs: [
        runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)]),
        runWith("runs/b", [cand({ candidateId: "c2", mint: USDC, riskDecision: "REJECT" })], { report: false }),
      ],
      invalidArtifacts: [{ ref: "runs/x/campaign.json", reason: "malformed JSON" }],
    });
    expect(JSON.stringify(validateSniperAlphaHistory(h))).toBe(JSON.stringify(h));
  });
});
