/**
 * Sprint 105-A — read-only campaign plan + campaign diff + alpha run report typed views in the web
 * command center. Pins, over small schema-shaped artifacts (valid = parseable JSON for the inspector;
 * every value the view reads is verbatim), that:
 *   - each schema ships a typed view;
 *   - each view leads with the LIVE TRADING DISABLED framing and the no-send / authorizes-nothing facts;
 *   - the views surface the alpha workflow content (allowed/disabled stages, candidate movement, top /
 *     blocked / insufficient candidates, provider + Rust health);
 *   - each view flips to a "do NOT trust" caution when its safety literals are missing / flipped.
 *
 * The web src imports no backend code, so these artifacts are synthetic (schema-shaped); the
 * production builders/validators are tested in @soulmaker/sniper.
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

function planArtifact(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "sniper.readonly_campaign.plan.v1",
    banner: "READ-ONLY AUTO-CAMPAIGN PLAN — LIVE TRADING IS DISABLED.",
    disclaimers: ["Not a trade signal."],
    planId: "alpha-plan",
    campaignId: "alpha",
    createdAt: null,
    mode: "paper",
    network: "mainnet-beta",
    inputWatchlistRef: "watchlist.json",
    inputCandidatesRef: null,
    candidateLimit: 25,
    allowedStages: ["candidate-score"],
    disabledStages: ["deep-risk", "quote-fetch", "quote-score", "routequote-prepare", "tx-build-dryrun", "tx-inspect", "simulate", "readiness", "microtrade-preflight"],
    maxQuoteAgeMs: null,
    providerPolicy: "operator-supplied-only",
    noSend: true,
    noSigner: true,
    noLiveTrading: true,
    liveSendStatus: "disabled",
    caveats: ["A plan bounds a campaign; it never trades."],
    redactionApplied: true,
    notExecutable: true,
    phase7LiveTradingReady: false,
    ...over,
  };
}

function diffArtifact(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "sniper.dryrun.campaign.diff.v1",
    banner: "SNIPER DRY-RUN CAMPAIGN DIFF — LIVE TRADING IS DISABLED.",
    disclaimers: ["Not a trade signal."],
    diffId: "demo-diff",
    comparedAt: null,
    beforeCampaignRef: "before.json",
    afterCampaignRef: "after.json",
    candidateChanges: [
      {
        mint: WSOL,
        status: "changed",
        scoreDelta: 9,
        verdictBefore: "blocked",
        verdictAfter: "watch",
        riskChange: "REJECT -> PASS_FOR_PAPER_EVALUATION",
        quoteChange: null,
        buildChange: null,
        simulationChange: null,
        blockerChanges: ["removed: deep risk REJECTED this candidate"],
        nextSafeAction: "IMPROVED: verdict blocked -> watch.",
      },
    ],
    summary: { addedCount: 0, removedCount: 0, unchangedCount: 0, changedCount: 1, improvedCount: 1, worsenedCount: 0, newlyBlockedCount: 0, newlyWatchCount: 1 },
    liveSendStatus: "disabled",
    authorizesLiveTrading: false,
    caveats: ["A diff compares two campaigns; it never trades."],
    redactionApplied: true,
    neverSends: true,
    ...over,
  };
}

function alphaArtifact(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "sniper.alpha_run.report.v1",
    banner: "SNIPER ALPHA RUN REPORT — LIVE TRADING IS DISABLED.",
    disclaimers: ["Not a trade signal.", "Not a profitability claim."],
    runId: "alpha-run",
    generatedAt: null,
    mode: "mainnet-dry-run",
    network: "mainnet-beta",
    watchlistRef: null,
    campaignPlanRef: "readonly-campaign-plan.json",
    campaignRef: "campaign.json",
    diffRef: null,
    candidateCount: 2,
    topCandidates: [
      { candidateId: "wsol", mint: WSOL, rank: 1, score: 90, verdict: "watch", riskDecision: "PASS_FOR_PAPER_EVALUATION", quoteStatus: "observed", buildStatus: null, simulationStatus: null, nextSafeAction: "WATCH." },
    ],
    blockedCandidates: [{ candidateId: "usdc", mint: USDC, verdict: "blocked", blockers: ["deep risk REJECTED this candidate"], nextSafeAction: "BLOCKED." }],
    insufficientEvidenceCandidates: [],
    stageCoverage: [{ stage: "risk", candidatesCovered: 2, candidateCount: 2 }],
    providerHealthSummary: { risk: "ok", quote: "degraded", simulation: "not-attempted" },
    rustEngineStatus: "available",
    phase7Status: "authorized-for-design-only",
    liveTradingStatus: "disabled",
    authorizesLiveTrading: false,
    nextSafeActions: ["Live trading stays DISABLED."],
    caveats: ["This report summarizes a campaign; it never trades."],
    artifactRefs: ["campaign.json"],
    evidenceProvenance: "real-readonly",
    redactionApplied: true,
    neverSends: true,
    phase7LiveTradingReady: false,
    ...over,
  };
}

describe("sniper.readonly_campaign.plan.v1 — typed view", () => {
  it("ships a typed view and leads with LIVE TRADING DISABLED + allowed/disabled stages", () => {
    expect(hasTypedView("sniper.readonly_campaign.plan.v1")).toBe(true);
    const out = typed(planArtifact());
    expect(out).toContain("LIVE TRADING DISABLED");
    expect(out).toContain("Allowed stages");
    expect(out).toContain("Disabled stages");
    expect(out).toContain("operator-supplied-only");
    expect(out).toContain("candidate-score");
  });

  it("flips to a do-NOT-trust caution when noSend is flipped", () => {
    expect(typed(planArtifact({ noSend: false }))).toContain("do NOT trust");
  });
});

describe("sniper.dryrun.campaign.diff.v1 — typed view", () => {
  it("ships a typed view, reports movement, and authorizes nothing", () => {
    expect(hasTypedView("sniper.dryrun.campaign.diff.v1")).toBe(true);
    const out = typed(diffArtifact());
    expect(out).toContain("LIVE TRADING DISABLED");
    expect(out).toContain("improved");
    expect(out).toContain("Changes");
    expect(out).toContain(WSOL);
    expect(out).toContain("blocked → watch");
  });

  it("flips to a do-NOT-trust caution when authorizesLiveTrading is flipped", () => {
    expect(typed(diffArtifact({ authorizesLiveTrading: true }))).toContain("do NOT trust");
  });
});

describe("sniper.alpha_run.report.v1 — typed view (command center)", () => {
  it("ships a typed view, shows LIVE TRADING DISABLED + provenance + provider health + candidates", () => {
    expect(hasTypedView("sniper.alpha_run.report.v1")).toBe(true);
    const out = typed(alphaArtifact());
    expect(out).toContain("LIVE TRADING DISABLED");
    expect(out).toContain("real-readonly");
    expect(out).toContain("Top candidates");
    expect(out).toContain("Blocked candidates");
    expect(out).toContain(WSOL);
    expect(out).toContain(USDC);
    expect(out).toContain("rust=available");
    expect(out).toContain("authorized-for-design-only");
  });

  it("flips to a do-NOT-trust caution when authorizesLiveTrading is flipped", () => {
    expect(typed(alphaArtifact({ authorizesLiveTrading: true }))).toContain("do NOT trust");
  });
});
