/**
 * Sprint 107 — sniper alpha history DIFF + TREND typed views in the web command center. Pins, over
 * schema-shaped artifacts (valid = parseable JSON for the inspector; every value the view reads is
 * verbatim), that:
 *   - each schema ships a typed view;
 *   - the view leads with the LIVE TRADING DISABLED framing and the no-send / authorizes-nothing facts;
 *   - the diff surfaces the run-change table + movement summary; the trend surfaces the snapshot table,
 *     step deltas, and blocker-reason totals;
 *   - hostile string content is ESCAPED, never injected;
 *   - the view flips to a "do NOT trust" caution when its safety literals are missing / flipped;
 *   - it never throws on hostile / type-mismatched shapes.
 *
 * The web src imports no backend code, so these artifacts are synthetic (schema-shaped); the production
 * builders/validators are tested in @soulmaker/sniper.
 */

import { describe, expect, it } from "vitest";
import { hasTypedView, renderTypedArtifactView } from "../src/components/artifact-views.js";
import { renderToString } from "../src/lib/html.js";
import { normalizeArtifact } from "../src/lib/local-artifact.js";

function typed(raw: unknown): string {
  const view = renderTypedArtifactView(normalizeArtifact(raw), raw);
  expect(view).not.toBeNull();
  return renderToString(view!);
}

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const FORBIDDEN: readonly RegExp[] = [
  /<script/i,
  /<img\s/i,
  /\bsignTransaction\b/,
  /\bsendTransaction\b/,
  /\bprivateKey\b/,
  /\bsecretKey\b/,
  /\bundefined\b/,
  /\bNaN\b/,
  /\[object Object\]/,
];

const triple = (base: number, next: number) => ({ base, next, delta: next - base });

function diffArtifact(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "sniper.alpha_history.diff.v1",
    banner: "SNIPER ALPHA HISTORY DIFF — LIVE TRADING IS DISABLED.",
    disclaimers: ["Not a trade signal.", "Movement is not momentum."],
    diffId: "demo-diff",
    comparedAt: null,
    baseRef: "alpha-history-mon.json",
    nextRef: "alpha-history-tue.json",
    baseHistoryId: "example-mon",
    nextHistoryId: "example-tue",
    runIdentity: {
      baseRunCount: 2,
      nextRunCount: 2,
      baseInvalidArtifactCount: 0,
      nextInvalidArtifactCount: 0,
      baseTotalCandidateCount: 3,
      nextTotalCandidateCount: 3,
    },
    runChanges: [
      {
        runRef: "runs/alpha-mon",
        status: "changed",
        candidateCountDelta: 0,
        verdictCountDeltas: { watch: 1, review: 0, blocked: -1, insufficientEvidence: 0 },
        providerHealthChanges: ["risk: unavailable -> ok"],
        provenanceChange: null,
        topMintChange: `${WSOL} -> ${USDC}`,
        rustEngineChange: null,
        phase7Change: null,
        blockerReasonChanges: ["removed: deep risk REJECTED this candidate"],
        movementNote: "Evidence moved (blocked -1 · watch +1). Re-check the changed signals; live trading stays disabled.",
      },
      {
        runRef: "runs/alpha-only-tuesday",
        status: "added",
        candidateCountDelta: null,
        verdictCountDeltas: null,
        providerHealthChanges: [],
        provenanceChange: null,
        topMintChange: null,
        rustEngineChange: null,
        phase7Change: null,
        blockerReasonChanges: ["added: deep risk REJECTED this candidate"],
        movementNote: "ADDED in the next history. Newly compared; live trading stays disabled.",
      },
    ],
    aggregateVerdictMovement: {
      watch: triple(1, 2),
      review: triple(0, 0),
      blocked: triple(1, 1),
      insufficientEvidence: triple(1, 0),
    },
    providerHealthMovement: {
      risk: { ok: triple(1, 2), degraded: triple(0, 0), unavailable: triple(1, 0), notAttempted: triple(0, 0) },
      quote: { ok: triple(2, 2), degraded: triple(0, 0), unavailable: triple(0, 0), notAttempted: triple(0, 0) },
      simulation: { ok: triple(2, 2), degraded: triple(0, 0), unavailable: triple(0, 0), notAttempted: triple(0, 0) },
    },
    provenanceMovement: { realReadonly: triple(2, 2), fixture: triple(0, 0), fictionalExample: triple(0, 0), mixed: triple(0, 0) },
    blockerReasonMovement: [{ reason: "deep risk REJECTED this candidate", baseRunCount: 1, nextRunCount: 1, delta: 0 }],
    phase7PostureMovement: { added: ["authorized-for-design-only"], removed: ["not-checked"], retained: [] },
    summary: {
      runsAdded: 1,
      runsRemoved: 0,
      runsChanged: 1,
      runsUnchanged: 0,
      totalCandidateDelta: 0,
      invalidArtifactDelta: 0,
      aggregateWatchDelta: 1,
      aggregateReviewDelta: 0,
      aggregateBlockedDelta: 0,
      aggregateInsufficientDelta: -1,
    },
    summaryLine: "NEXT vs BASE: +1 run(s) added · 0 removed · 1 changed · 0 unchanged · aggregate blocked 0 · watch +1 · candidates 0 · live trading DISABLED.",
    sensitiveFieldScan: { scanned: true, signaturePresent: false, txidPresent: false, sendResultPresent: false, keyLikePresent: false },
    baseLiveTradingStatus: "disabled",
    nextLiveTradingStatus: "disabled",
    liveTradingStatus: "disabled",
    authorizesLiveTrading: false,
    anyInputAuthorizesLiveTrading: false,
    caveats: ["A diff compares two alpha-history rollups; it never trades."],
    redactionApplied: true,
    neverSends: true,
    phase7LiveTradingReady: false,
    ...over,
  };
}

function trendArtifact(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "sniper.alpha_history.trend.v1",
    banner: "SNIPER ALPHA HISTORY TREND — LIVE TRADING IS DISABLED.",
    disclaimers: ["Not a trade signal.", "Movement is not momentum."],
    trendId: "demo-trend",
    generatedAt: null,
    snapshotCount: 2,
    snapshots: [
      {
        label: "monday",
        historyId: "example-mon",
        runCount: 1,
        totalCandidateCount: 2,
        invalidArtifactCount: 0,
        verdictCounts: { watch: 1, review: 0, blocked: 1, insufficientEvidence: 0 },
        providerOk: { risk: 1, quote: 1, simulation: 1 },
        provenanceCounts: { realReadonly: 0, fixture: 1, fictionalExample: 0, mixed: 0 },
      },
      {
        label: "tuesday",
        historyId: "example-tue",
        runCount: 1,
        totalCandidateCount: 2,
        invalidArtifactCount: 0,
        verdictCounts: { watch: 2, review: 0, blocked: 0, insufficientEvidence: 0 },
        providerOk: { risk: 0, quote: 1, simulation: 1 },
        provenanceCounts: { realReadonly: 0, fixture: 1, fictionalExample: 0, mixed: 0 },
      },
    ],
    stepDeltas: [
      { fromLabel: "monday", toLabel: "tuesday", candidateDelta: 0, verdictDeltas: { watch: 1, review: 0, blocked: -1, insufficientEvidence: 0 } },
    ],
    totalCandidateSeries: [2, 2],
    verdictSeries: { watch: [1, 2], review: [0, 0], blocked: [1, 0], insufficientEvidence: [0, 0] },
    blockerReasonTotals: [{ reason: "deep risk REJECTED this candidate", totalRunCount: 1, snapshotCount: 1 }],
    provenanceTotals: { realReadonly: 0, fixture: 2, fictionalExample: 0, mixed: 0 },
    providerHealthConsistency: {
      risk: { okRuns: 1, totalRuns: 2, label: "sometimes-ok" },
      quote: { okRuns: 2, totalRuns: 2, label: "always-ok" },
      simulation: { okRuns: 2, totalRuns: 2, label: "always-ok" },
    },
    summaryLine: "2 snapshots (monday -> tuesday) · blocked 1 -> 0 (-1) · watch 1 -> 2 (+1) · candidates 2 -> 2 · live trading DISABLED.",
    sensitiveFieldScan: { scanned: true, signaturePresent: false, txidPresent: false, sendResultPresent: false, keyLikePresent: false },
    liveTradingStatus: "disabled",
    authorizesLiveTrading: false,
    anyInputAuthorizesLiveTrading: false,
    caveats: ["A trend chains ordered alpha-history snapshots; it never trades."],
    redactionApplied: true,
    neverSends: true,
    phase7LiveTradingReady: false,
    ...over,
  };
}

describe("sniper.alpha_history.diff.v1 — typed view (command center)", () => {
  it("ships a typed view and leads with LIVE TRADING DISABLED + the movement facts", () => {
    expect(hasTypedView("sniper.alpha_history.diff.v1")).toBe(true);
    const out = typed(diffArtifact());
    expect(out).toContain("LIVE TRADING DISABLED");
    expect(out).toContain("example-mon");
    expect(out).toContain("example-tue");
    expect(out).toContain("Run changes");
    expect(out).toContain("runs/alpha-mon");
    expect(out).toContain("changed");
    expect(out).toContain("Movement is not momentum");
  });

  it("surfaces the verdict movement, blocker movement, and phase 7 movement", () => {
    const out = typed(diffArtifact());
    expect(out).toContain("blocked movement");
    expect(out).toContain("Blocker reason movement");
    expect(out).toContain("Phase 7 posture movement");
    expect(out).toContain("authorized-for-design-only");
    expect(out).toContain("clean (no signature");
  });

  it("escapes hostile string content instead of injecting it", () => {
    const out = typed(
      diffArtifact({
        baseHistoryId: "<script>alert(1)</script>",
        summaryLine: "<img src=x>evil",
      }),
    );
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).not.toContain("<img src=x>");
    expect(out).toContain("&lt;script&gt;");
    for (const re of FORBIDDEN) expect(re.test(out), `forbidden pattern ${re}`).toBe(false);
  });

  it("flips to a do-NOT-trust caution when a safety literal is flipped", () => {
    expect(typed(diffArtifact({ authorizesLiveTrading: true }))).toContain("do NOT trust");
    expect(typed(diffArtifact({ anyInputAuthorizesLiveTrading: true }))).toContain("do NOT trust");
  });

  it("never throws on hostile / type-mismatched shapes", () => {
    const hostile: unknown[] = [
      { schemaVersion: "sniper.alpha_history.diff.v1", runChanges: "nope", aggregateVerdictMovement: 5 },
      { schemaVersion: "sniper.alpha_history.diff.v1", runIdentity: [], runChanges: [1, 2] },
      { schemaVersion: "sniper.alpha_history.diff.v1" },
    ];
    for (const shape of hostile) expect(() => typed(shape)).not.toThrow();
  });
});

describe("sniper.alpha_history.trend.v1 — typed view (command center)", () => {
  it("ships a typed view and leads with LIVE TRADING DISABLED + the series facts", () => {
    expect(hasTypedView("sniper.alpha_history.trend.v1")).toBe(true);
    const out = typed(trendArtifact());
    expect(out).toContain("LIVE TRADING DISABLED");
    expect(out).toContain("demo-trend");
    expect(out).toContain("Snapshots");
    expect(out).toContain("monday");
    expect(out).toContain("tuesday");
    expect(out).toContain("supplied order");
  });

  it("surfaces the step deltas, blocker totals, and provider consistency", () => {
    const out = typed(trendArtifact());
    expect(out).toContain("Step deltas");
    expect(out).toContain("Most common blocker reasons");
    expect(out).toContain("deep risk REJECTED this candidate");
    expect(out).toContain("sometimes-ok");
    expect(out).toContain("always-ok");
  });

  it("escapes hostile string content instead of injecting it", () => {
    const out = typed(trendArtifact({ trendId: "<script>alert(1)</script>", summaryLine: "<img src=x>evil" }));
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).not.toContain("<img src=x>");
    expect(out).toContain("&lt;script&gt;");
    for (const re of FORBIDDEN) expect(re.test(out), `forbidden pattern ${re}`).toBe(false);
  });

  it("flips to a do-NOT-trust caution when a safety literal is flipped", () => {
    expect(typed(trendArtifact({ neverSends: false }))).toContain("do NOT trust");
    expect(typed(trendArtifact({ liveTradingStatus: "enabled" }))).toContain("do NOT trust");
  });

  it("never throws on hostile / type-mismatched shapes", () => {
    const hostile: unknown[] = [
      { schemaVersion: "sniper.alpha_history.trend.v1", snapshots: "nope", verdictSeries: 5 },
      { schemaVersion: "sniper.alpha_history.trend.v1", providerHealthConsistency: [], snapshots: [1, 2] },
      { schemaVersion: "sniper.alpha_history.trend.v1" },
    ];
    for (const shape of hostile) expect(() => typed(shape)).not.toThrow();
  });
});

describe("/sniper page — alpha history diff + trend (no-send regression)", async () => {
  const { renderSniper } = await import("../src/pages/sniper.js");
  const out = renderToString(renderSniper());

  it("surfaces the new diff + trend commands and the committed examples", () => {
    expect(out).toContain("paper:sniper:alpha:history:diff");
    expect(out).toContain("paper:sniper:alpha:history:trend");
    expect(out).toContain("examples/sniper/alpha-artifacts");
    expect(out).toContain("LIVE TRADING DISABLED");
  });

  it("makes no positive live-enabled claim anywhere on the page", () => {
    expect(out).not.toMatch(/live trading is enabled/i);
    expect(out).not.toMatch(/live trading is now/i);
    expect(out).not.toMatch(/sending is enabled/i);
    expect(out).not.toMatch(/now ready to trade/i);
  });
});
