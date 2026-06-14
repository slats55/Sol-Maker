/**
 * Sprint 104-C — operator watchlist + dry-run campaign typed views in the web command center.
 *
 * Pins, over small schema-shaped artifacts (valid = parseable JSON for the inspector; every value the
 * view reads is verbatim):
 *   - a typed view exists for sniper.watchlist.v1 and leads with the bookkeeping-only framing;
 *   - a typed view exists for sniper.dryrun.campaign.v1, shows LIVE SENDING DISABLED, the verdict
 *     tally, the ranked candidate comparison, the per-candidate blockers, and the stage coverage;
 *   - both views flip to a "do NOT trust" caution when their no-trade / no-send safety literals are
 *     missing or flipped.
 *
 * All mints are well-known public keys used purely as deterministic fixtures. The web src imports no
 * backend code, so these artifacts are synthetic (schema-shaped); the production builders/validators
 * are tested in @soulmaker/sniper.
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
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

function watchlistArtifact(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "sniper.watchlist.v1",
    banner: "SIMULATED PAPER-ONLY SNIPER WATCHLIST",
    disclaimers: ["Not a trade signal."],
    watchlistId: "demo-wl",
    createdAtLabel: null,
    sourceLabel: "watchlist.json",
    network: "mainnet-beta",
    entryCount: 2,
    entries: [
      { entryId: WSOL, mint: WSOL, label: "SOL", provider: "manual", status: "watch", tags: ["bluechip"], notes: [], addedAtLabel: null, lastReviewedAtLabel: null },
      { entryId: "usdc", mint: USDC, label: null, provider: null, status: "review", tags: [], notes: [], addedAtLabel: null, lastReviewedAtLabel: null },
    ],
    distinctMints: [USDC, WSOL].sort(),
    duplicateMints: [],
    statusCounts: { watch: 1, review: 1, blocked: 0, archived: 0 },
    warnings: [],
    notes: [],
    caveats: ["A watchlist is a monitoring list, not a queue of trades."],
    paperOnly: true,
    notLiveResult: true,
    notFinancialAdvice: true,
    notProfitabilityClaim: true,
    statusIsNotTradeReadiness: true,
    neverSends: true,
    redactionApplied: true,
    ...over,
  };
}

function campaignArtifact(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "sniper.dryrun.campaign.v1",
    banner: "SNIPER DRY-RUN CAMPAIGN — a no-send comparison of candidates across paper / dry-run evidence. LIVE SENDING IS DISABLED.",
    disclaimers: ["Not a trade signal."],
    campaignId: "demo-campaign",
    generatedAt: null,
    mode: "mainnet-dry-run",
    network: "mainnet-beta",
    candidateCount: 3,
    verdictCounts: { watch: 1, review: 0, blocked: 1, insufficientEvidence: 1 },
    stages: [
      { stage: "ranking", description: "scoring", candidatesCovered: 2, candidateCount: 3 },
      { stage: "risk", description: "risk", candidatesCovered: 2, candidateCount: 3 },
    ],
    candidates: [
      { candidateId: "a", mint: WSOL, rank: 1, score: 90, watchlistStatus: "watch", riskDecision: "PASS_FOR_PAPER_EVALUATION", riskCriticalFlagCount: 0, token2022Blocker: false, quoteStatus: "observed", buildStatus: "succeeded", buildRefusalCodes: [], simulationStatus: "simulated-ok", releaseCandidateVerdict: "dryrun-complete-blocked-live", preflightVerdict: "pass", finalOperatorVerdict: "watch", blockers: [], nextSafeAction: "WATCH: clean.", notes: [] },
      { candidateId: "b", mint: USDC, rank: 2, score: 99, watchlistStatus: null, riskDecision: "REJECT", riskCriticalFlagCount: 1, token2022Blocker: false, quoteStatus: null, buildStatus: null, buildRefusalCodes: [], simulationStatus: null, releaseCandidateVerdict: null, preflightVerdict: "fail", finalOperatorVerdict: "blocked", blockers: ["deep risk REJECTED this candidate", "token preflight FAILED"], nextSafeAction: "BLOCKED.", notes: [] },
      { candidateId: "c", mint: BONK, rank: null, score: null, watchlistStatus: null, riskDecision: null, riskCriticalFlagCount: null, token2022Blocker: false, quoteStatus: null, buildStatus: null, buildRefusalCodes: [], simulationStatus: null, releaseCandidateVerdict: null, preflightVerdict: null, finalOperatorVerdict: "insufficient-evidence", blockers: [], nextSafeAction: "INSUFFICIENT.", notes: [] },
    ],
    nextSafeAction: "1 candidate(s) BLOCKED — review the blockers below.",
    artifactRefs: ["preflight:pf.json"],
    liveSendStatus: "disabled",
    caveats: ["A campaign compares evidence; it never trades."],
    redactionApplied: true,
    notExecutable: true,
    neverSends: true,
    phase7LiveTradingReady: false,
    scoreCannotOverrideBlock: true,
    ...over,
  };
}

describe("sniper.watchlist.v1 — typed view", () => {
  it("has a typed view and leads with the bookkeeping-only framing", () => {
    expect(hasTypedView("sniper.watchlist.v1")).toBe(true);
    const out = typed(watchlistArtifact());
    expect(out).toContain("bookkeeping");
    expect(out).toContain("demo-wl");
    expect(out).toContain(WSOL);
    expect(out).toContain("watch 1");
    expect(out).toContain("review 1");
  });

  it("flips to a do-NOT-trust caution when the not-trade-readiness literal is flipped", () => {
    const out = typed(watchlistArtifact({ statusIsNotTradeReadiness: false }));
    expect(out).toContain("do NOT trust");
  });
});

describe("sniper.dryrun.campaign.v1 — typed view (command center)", () => {
  it("has a typed view, shows LIVE SENDING DISABLED, the verdict tally, and the candidate comparison", () => {
    expect(hasTypedView("sniper.dryrun.campaign.v1")).toBe(true);
    const out = typed(campaignArtifact());
    expect(out).toContain("LIVE SENDING DISABLED");
    expect(out).toContain("BLOCKED 1");
    expect(out).toContain("watch 1");
    expect(out).toContain("insufficient 1");
    expect(out).toContain(WSOL);
    expect(out).toContain(USDC);
    // The blocked candidate's blocker reasons are surfaced and can never be overridden by a score.
    expect(out).toContain("deep risk REJECTED this candidate");
    expect(out).toContain("Stage coverage");
    expect(out).toContain("never");
  });

  it("flips to a do-NOT-trust caution when liveSendStatus is not disabled", () => {
    const out = typed(campaignArtifact({ liveSendStatus: "enabled" }));
    expect(out).toContain("do NOT trust");
  });

  it("flips to a do-NOT-trust caution when scoreCannotOverrideBlock is flipped", () => {
    const out = typed(campaignArtifact({ scoreCannotOverrideBlock: false }));
    expect(out).toContain("do NOT trust");
  });
});
