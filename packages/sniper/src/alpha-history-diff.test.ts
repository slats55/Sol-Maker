/**
 * Tests for the Sprint 107 SNIPER ALPHA HISTORY DIFF. Every input here is INJECTED, operator-shaped
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
import { buildSniperAlphaHistory, type SniperAlphaHistory, type SniperAlphaHistoryRunInput } from "./alpha-history.js";
import {
  diffSniperAlphaHistories,
  validateSniperAlphaHistoryDiff,
  formatSniperAlphaHistoryDiff,
  SniperAlphaHistoryDiffError,
  SNIPER_ALPHA_HISTORY_DIFF_SCHEMA_VERSION,
  SNIPER_ALPHA_HISTORY_DIFF_BANNER,
} from "./alpha-history-diff.js";

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const cand = (over: Partial<SniperDryRunCampaignCandidateInput> & { candidateId: string; mint: string }): SniperDryRunCampaignCandidateInput => over;

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
  return buildSniperDryRunCampaign({ candidates, mode: "mainnet-dry-run", ...extra });
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

function runWith(
  runRef: string,
  candidates: SniperDryRunCampaignCandidateInput[],
  opts: { provenance?: string; providerHealth?: Record<string, string>; phase7Status?: string; report?: boolean } = {},
): SniperAlphaHistoryRunInput {
  const campaign = makeCampaign(candidates);
  if (opts.report === false) return { runRef, campaign, report: null };
  const report = makeReport(campaign, {
    evidenceProvenance: opts.provenance ?? "real-readonly",
    providerHealth: opts.providerHealth ?? { risk: "ok", quote: "ok", simulation: "ok" },
    phase7Status: opts.phase7Status ?? "authorized-for-design-only",
  });
  return { runRef, campaign, report };
}

function history(runs: SniperAlphaHistoryRunInput[], extra: Record<string, unknown> = {}): SniperAlphaHistory {
  return buildSniperAlphaHistory({ runs, ...extra });
}

describe("diffSniperAlphaHistories — pinned no-send literals", () => {
  it("produces a diff with the canonical banner + pinned safety literals", () => {
    const base = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    const next = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    const diff = diffSniperAlphaHistories({ base, next, diffId: "demo" });
    expect(diff.schemaVersion).toBe(SNIPER_ALPHA_HISTORY_DIFF_SCHEMA_VERSION);
    expect(diff.banner).toBe(SNIPER_ALPHA_HISTORY_DIFF_BANNER);
    expect(diff.liveTradingStatus).toBe("disabled");
    expect(diff.baseLiveTradingStatus).toBe("disabled");
    expect(diff.nextLiveTradingStatus).toBe("disabled");
    expect(diff.authorizesLiveTrading).toBe(false);
    expect(diff.anyInputAuthorizesLiveTrading).toBe(false);
    expect(diff.neverSends).toBe(true);
    expect(diff.phase7LiveTradingReady).toBe(false);
    expect(diff.redactionApplied).toBe(true);
    expect(diff.sensitiveFieldScan).toEqual({ scanned: true, signaturePresent: false, txidPresent: false, sendResultPresent: false, keyLikePresent: false });
    expect(() => validateSniperAlphaHistoryDiff(diff)).not.toThrow();
  });
});

describe("diffSniperAlphaHistories — identical inputs are a no-op", () => {
  it("identical histories produce an empty/no-op diff (all unchanged, zero deltas)", () => {
    const runs = [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL), cand({ candidateId: "c2", mint: USDC, riskDecision: "REJECT" })])];
    const diff = diffSniperAlphaHistories({ base: history(runs), next: history(runs) });
    expect(diff.summary).toEqual({
      runsAdded: 0,
      runsRemoved: 0,
      runsChanged: 0,
      runsUnchanged: 1,
      totalCandidateDelta: 0,
      invalidArtifactDelta: 0,
      aggregateWatchDelta: 0,
      aggregateReviewDelta: 0,
      aggregateBlockedDelta: 0,
      aggregateInsufficientDelta: 0,
    });
    expect(diff.runChanges.every((c) => c.status === "unchanged")).toBe(true);
    expect(diff.blockerReasonMovement).toEqual([]);
    expect(diff.phase7PostureMovement).toEqual({ added: [], removed: [], retained: ["authorized-for-design-only"] });
    expect(diff.aggregateVerdictMovement.blocked).toEqual({ base: 1, next: 1, delta: 0 });
    expect(() => validateSniperAlphaHistoryDiff(diff)).not.toThrow();
  });
});

describe("diffSniperAlphaHistories — run add / remove", () => {
  it("reports an added run and a removed run, keyed by runRef", () => {
    const base = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    const next = history([runWith("runs/b", [cleanCandidate("c2", BONK)])]);
    const diff = diffSniperAlphaHistories({ base, next });
    const byRef = Object.fromEntries(diff.runChanges.map((c) => [c.runRef, c]));
    expect(byRef["runs/a"]!.status).toBe("removed");
    expect(byRef["runs/a"]!.candidateCountDelta).toBeNull();
    expect(byRef["runs/a"]!.verdictCountDeltas).toBeNull();
    expect(byRef["runs/b"]!.status).toBe("added");
    expect(byRef["runs/b"]!.candidateCountDelta).toBeNull();
    expect(diff.summary.runsAdded).toBe(1);
    expect(diff.summary.runsRemoved).toBe(1);
    expect(diff.summary.totalCandidateDelta).toBe(0); // 1 candidate each side
    expect(() => validateSniperAlphaHistoryDiff(diff)).not.toThrow();
  });

  it("reports a per-run candidate-count delta for a shared run that grew", () => {
    const base = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    const next = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL), cleanCandidate("c2", BONK)])]);
    const diff = diffSniperAlphaHistories({ base, next });
    const a = diff.runChanges.find((c) => c.runRef === "runs/a")!;
    expect(a.status).toBe("changed");
    expect(a.candidateCountDelta).toBe(1);
    expect(a.verdictCountDeltas).toEqual({ watch: 1, review: 0, blocked: 0, insufficientEvidence: 0 });
    expect(diff.summary.totalCandidateDelta).toBe(1);
    expect(diff.summary.aggregateWatchDelta).toBe(1);
    expect(() => validateSniperAlphaHistoryDiff(diff)).not.toThrow();
  });
});

describe("diffSniperAlphaHistories — verdict movement (never overrides a verdict)", () => {
  it("a clean candidate becoming REJECTed shows blocked up / watch down (worsening movement)", () => {
    const base = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    const next = history([runWith("runs/a", [cand({ candidateId: "c1", mint: WRAPPED_SOL, riskDecision: "REJECT" })])]);
    const diff = diffSniperAlphaHistories({ base, next });
    const a = diff.runChanges.find((c) => c.runRef === "runs/a")!;
    expect(a.verdictCountDeltas).toEqual({ watch: -1, review: 0, blocked: 1, insufficientEvidence: 0 });
    expect(diff.aggregateVerdictMovement.blocked).toEqual({ base: 0, next: 1, delta: 1 });
    expect(diff.aggregateVerdictMovement.watch).toEqual({ base: 1, next: 0, delta: -1 });
    expect(diff.summary.aggregateBlockedDelta).toBe(1);
    expect(() => validateSniperAlphaHistoryDiff(diff)).not.toThrow();
  });

  it("a REJECTed candidate becoming clean shows blocked down / watch up (improving movement)", () => {
    const base = history([runWith("runs/a", [cand({ candidateId: "c1", mint: WRAPPED_SOL, riskDecision: "REJECT" })])]);
    const next = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    const diff = diffSniperAlphaHistories({ base, next });
    expect(diff.aggregateVerdictMovement.blocked).toEqual({ base: 1, next: 0, delta: -1 });
    expect(diff.aggregateVerdictMovement.watch).toEqual({ base: 0, next: 1, delta: 1 });
    expect(diff.summary.aggregateBlockedDelta).toBe(-1);
    expect(() => validateSniperAlphaHistoryDiff(diff)).not.toThrow();
  });

  it("the summary line is deterministic and explicitly says live trading is disabled", () => {
    const base = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    const next = history([runWith("runs/a", [cand({ candidateId: "c1", mint: WRAPPED_SOL, riskDecision: "REJECT" })])]);
    const diff = diffSniperAlphaHistories({ base, next });
    expect(diff.summaryLine).toContain("aggregate blocked +1");
    expect(diff.summaryLine).toContain("live trading DISABLED.");
  });
});

describe("diffSniperAlphaHistories — provider + provenance + blocker + phase7 movement", () => {
  it("reports a provider unavailable -> available transition for a shared run and the rollup", () => {
    const base = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)], { providerHealth: { risk: "unavailable", quote: "unavailable", simulation: "unavailable" } })]);
    const next = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)], { providerHealth: { risk: "ok", quote: "ok", simulation: "ok" } })]);
    const diff = diffSniperAlphaHistories({ base, next });
    const a = diff.runChanges.find((c) => c.runRef === "runs/a")!;
    expect(a.providerHealthChanges).toContain("risk: unavailable -> ok");
    expect(diff.providerHealthMovement.risk.ok).toEqual({ base: 0, next: 1, delta: 1 });
    expect(diff.providerHealthMovement.risk.unavailable).toEqual({ base: 1, next: 0, delta: -1 });
    expect(() => validateSniperAlphaHistoryDiff(diff)).not.toThrow();
  });

  it("reports evidence-provenance movement per run and in the rollup", () => {
    const base = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)], { provenance: "fixture" })]);
    const next = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)], { provenance: "real-readonly" })]);
    const diff = diffSniperAlphaHistories({ base, next });
    const a = diff.runChanges.find((c) => c.runRef === "runs/a")!;
    expect(a.provenanceChange).toBe("fixture -> real-readonly");
    expect(diff.provenanceMovement.fixture).toEqual({ base: 1, next: 0, delta: -1 });
    expect(diff.provenanceMovement.realReadonly).toEqual({ base: 0, next: 1, delta: 1 });
  });

  it("reports blocker reason movement by run frequency (movement-only, sorted)", () => {
    const base = history([
      runWith("runs/a", [cand({ candidateId: "c1", mint: USDC, riskDecision: "REJECT" })]),
      runWith("runs/b", [cand({ candidateId: "c2", mint: BONK, riskDecision: "REJECT" })]),
    ]);
    const next = history([
      runWith("runs/a", [cleanCandidate("c1", USDC)]),
      runWith("runs/b", [cand({ candidateId: "c2", mint: BONK, riskDecision: "REJECT" })]),
    ]);
    const diff = diffSniperAlphaHistories({ base, next });
    // The REJECT reason was carried by 2 runs in base, 1 in next: delta -1.
    const rejectMovement = diff.blockerReasonMovement.find((m) => m.reason.includes("REJECT"));
    expect(rejectMovement).toBeDefined();
    expect(rejectMovement!.baseRunCount).toBe(2);
    expect(rejectMovement!.nextRunCount).toBe(1);
    expect(rejectMovement!.delta).toBe(-1);
    // movement-only: no zero deltas survive.
    expect(diff.blockerReasonMovement.every((m) => m.delta !== 0)).toBe(true);
  });

  it("reports phase 7 posture appearing and disappearing", () => {
    const base = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)], { phase7Status: "not-checked" })]);
    const next = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)], { phase7Status: "authorized-for-design-only" })]);
    const diff = diffSniperAlphaHistories({ base, next });
    expect(diff.phase7PostureMovement.added).toEqual(["authorized-for-design-only"]);
    expect(diff.phase7PostureMovement.removed).toEqual(["not-checked"]);
    expect(diff.phase7PostureMovement.retained).toEqual([]);
    expect(() => validateSniperAlphaHistoryDiff(diff)).not.toThrow();
  });
});

describe("diffSniperAlphaHistories — determinism", () => {
  it("produces byte-identical output for identical input", () => {
    const runs = [
      runWith("runs/b", [cleanCandidate("c1", BONK)]),
      runWith("runs/a", [cand({ candidateId: "c2", mint: USDC, riskDecision: "REJECT" })]),
    ];
    const a = diffSniperAlphaHistories({ base: history(runs), next: history(runs) });
    const b = diffSniperAlphaHistories({ base: history(runs), next: history(runs) });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("is stable regardless of the order runs were supplied to each history", () => {
    const forward = [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)]), runWith("runs/b", [cleanCandidate("c2", BONK)])];
    const reversed = [forward[1]!, forward[0]!];
    const next = [runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)]), runWith("runs/c", [cleanCandidate("c3", USDC)])];
    const d1 = diffSniperAlphaHistories({ base: history(forward), next: history(next) });
    const d2 = diffSniperAlphaHistories({ base: history(reversed), next: history([next[1]!, next[0]!]) });
    expect(JSON.stringify(d1)).toBe(JSON.stringify(d2));
    // runChanges are sorted by runRef ascending.
    expect(d1.runChanges.map((c) => c.runRef)).toEqual(["runs/a", "runs/b", "runs/c"]);
  });
});

describe("diffSniperAlphaHistories — refusals", () => {
  it("refuses a non-object input", () => {
    expect(() => diffSniperAlphaHistories(null as never)).toThrow(SniperAlphaHistoryDiffError);
  });

  it("refuses a malformed base history (not a valid sniper.alpha_history.v1)", () => {
    const next = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    expect(() => diffSniperAlphaHistories({ base: { schemaVersion: "nope" } as never, next })).toThrow(/not a valid sniper\.alpha_history\.v1/);
  });

  it("refuses a live-authorizing base history", () => {
    const base = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    const next = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    const hostile = { ...base, authorizesLiveTrading: true } as never;
    expect(() => diffSniperAlphaHistories({ base: hostile, next })).toThrow(SniperAlphaHistoryDiffError);
  });

  it("refuses a base history carrying a forbidden sendResult field", () => {
    const base = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    const next = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    const hostile = { ...base, sendResult: { ok: true } } as never;
    expect(() => diffSniperAlphaHistories({ base: hostile, next })).toThrow(SniperAlphaHistoryDiffError);
  });

  it("deep-scans for a secret-shaped value smuggled into a run's blocker reasons", () => {
    const base = history([runWith("runs/a", [cand({ candidateId: "c1", mint: USDC, riskDecision: "REJECT" })])]);
    const next = history([runWith("runs/a", [cand({ candidateId: "c1", mint: USDC, riskDecision: "REJECT" })])]);
    // Replace the single blocker reason with a 64-hex (secret-shaped) value in BOTH the run and the
    // re-derived topBlockerReasons so the artifact still passes validateSniperAlphaHistory; the diff's
    // deep value-scan must then refuse it.
    const secret = "a".repeat(64);
    const hostile = JSON.parse(JSON.stringify(base)) as typeof base;
    expect(hostile.runs[0]!.blockerReasons.length).toBe(1);
    hostile.runs[0]!.blockerReasons[0] = secret;
    hostile.topBlockerReasons = [{ reason: secret, runCount: 1 }];
    expect(() => diffSniperAlphaHistories({ base: hostile as never, next })).toThrow(/secret-shaped/);
  });

  it("refuses a secret-shaped diffId / baseRef label", () => {
    const base = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    const next = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    expect(() => diffSniperAlphaHistories({ base, next, diffId: "a".repeat(64) })).toThrow(/secret-shaped/);
    expect(() => diffSniperAlphaHistories({ base, next, baseRef: "0x" + "b".repeat(64) })).toThrow(/secret-shaped/);
  });
});

describe("validateSniperAlphaHistoryDiff — parity wall + closed schema", () => {
  function goodDiff() {
    const base = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    const next = history([runWith("runs/a", [cand({ candidateId: "c1", mint: WRAPPED_SOL, riskDecision: "REJECT" })])]);
    return diffSniperAlphaHistories({ base, next });
  }

  it("rejects an unknown top-level field (closed schema)", () => {
    const d = { ...goodDiff(), sendResult: { ok: true } };
    expect(() => validateSniperAlphaHistoryDiff(d)).toThrow(/unknown field "sendResult"/);
  });

  it("rejects a tampered movement triple whose delta != next - base", () => {
    const d = goodDiff();
    d.aggregateVerdictMovement.blocked = { base: 0, next: 1, delta: 99 };
    expect(() => validateSniperAlphaHistoryDiff(d)).toThrow(/delta must equal next - base/);
  });

  it("rejects a tampered summary that no longer matches the run changes", () => {
    const d = goodDiff();
    d.summary.runsChanged = 99;
    expect(() => validateSniperAlphaHistoryDiff(d)).toThrow(/summary must be re-derived/);
  });

  it("rejects runChanges that are not sorted by runRef", () => {
    const base = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)]), runWith("runs/b", [cleanCandidate("c2", BONK)])]);
    const next = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)]), runWith("runs/b", [cleanCandidate("c2", BONK)])]);
    const d = diffSniperAlphaHistories({ base, next });
    d.runChanges = [d.runChanges[1]!, d.runChanges[0]!];
    expect(() => validateSniperAlphaHistoryDiff(d)).toThrow(/sorted by runRef/);
  });

  it("rejects a flipped live-trading literal", () => {
    const d = goodDiff();
    (d as unknown as Record<string, unknown>).liveTradingStatus = "enabled";
    expect(() => validateSniperAlphaHistoryDiff(d)).toThrow(/liveTradingStatus must literally be/);
  });

  it("rejects a blockerReasonMovement entry with a zero delta (movement-only)", () => {
    const d = goodDiff();
    d.blockerReasonMovement = [...d.blockerReasonMovement, { reason: "zzz no movement", baseRunCount: 2, nextRunCount: 2, delta: 0 }];
    expect(() => validateSniperAlphaHistoryDiff(d)).toThrow(/zero delta/);
  });
});

describe("formatSniperAlphaHistoryDiff — redacted, deterministic", () => {
  it("renders the summary line, run changes, and disclaimers; output is redacted + stable", () => {
    const base = history([runWith("runs/a", [cleanCandidate("c1", WRAPPED_SOL)])]);
    const next = history([runWith("runs/a", [cand({ candidateId: "c1", mint: WRAPPED_SOL, riskDecision: "REJECT" })])]);
    const diff = diffSniperAlphaHistories({ base, next });
    const out1 = formatSniperAlphaHistoryDiff(diff, { label: "demo" });
    const out2 = formatSniperAlphaHistoryDiff(diff, { label: "demo" });
    expect(out1).toBe(out2);
    expect(out1).toContain("SNIPER ALPHA HISTORY DIFF");
    expect(out1).toContain("LIVE TRADING IS DISABLED");
    expect(out1).toContain("[changed] runs/a");
  });
});
