/**
 * Sprint 106 — sniper strategy intelligence typed view in the web command center. Pins, over a
 * schema-shaped artifact, that the schema ships a typed view; the view leads with the LIVE TRADING
 * DISABLED / not-a-buy-signal framing; it surfaces the candidate cards, the verdict / confidence /
 * mint-class facts, and the top concerns; hostile content is ESCAPED; and the view flips to a
 * do-NOT-trust caution when its safety literals are missing.
 *
 * The web src imports no backend code, so this artifact is synthetic; the production builder/validator
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

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function intelArtifact(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "sniper.strategy_intelligence.v1",
    banner: "SNIPER STRATEGY INTELLIGENCE — LIVE TRADING IS DISABLED.",
    disclaimers: ["Not a buy signal.", "Not a profitability claim."],
    intelligenceId: "demo-intel",
    generatedAt: null,
    campaignRef: "campaign.json",
    evidenceProvenance: "fixture",
    candidateCount: 1,
    verdictCounts: { watch: 0, review: 0, blocked: 1, insufficientEvidence: 0 },
    confidenceCounts: { high: 1, medium: 0, low: 0 },
    mintClassCounts: { wrappedSol: 0, stablecoin: 1, other: 0 },
    topConcerns: [{ flagId: "freeze-authority-present", severity: "critical", candidateCount: 1 }],
    candidates: [
      {
        candidateId: "usdc",
        mint: USDC,
        mintClass: "stablecoin",
        verdict: "blocked",
        score: null,
        riskDecision: "REJECT",
        riskScore: 90,
        hasRiskReport: true,
        notableFlags: [{ id: "freeze-authority-present", severity: "critical", title: "Freeze authority present" }],
        confidence: "high",
        reasonCodes: ["risk-rejected", "authority-freeze-present", "verdict-blocked"],
        whyItMatters: "This candidate failed a read-only gate and is BLOCKED.",
        whatToStudyNext: "Drop or deprioritize; never override a risk gate.",
      },
    ],
    strategyNotes: ["0 of 1 candidate(s) are monitorable."],
    nextSafeActions: ["Live trading stays DISABLED."],
    caveats: ["Intelligence explains evidence; it never trades."],
    liveTradingStatus: "disabled",
    authorizesLiveTrading: false,
    redactionApplied: true,
    neverSends: true,
    phase7LiveTradingReady: false,
    notAProfitabilityClaim: true,
    ...over,
  };
}

describe("sniper.strategy_intelligence.v1 — typed view (command center)", () => {
  it("ships a typed view and leads with LIVE TRADING DISABLED + the candidate intelligence", () => {
    expect(hasTypedView("sniper.strategy_intelligence.v1")).toBe(true);
    const out = typed(intelArtifact());
    expect(out).toContain("LIVE TRADING DISABLED");
    expect(out).toContain("NOT a buy signal");
    expect(out).toContain("demo-intel");
    expect(out).toContain(USDC);
    expect(out).toContain("freeze-authority-present");
    expect(out).toContain("authority-freeze-present"); // a reason code
    expect(out).toContain("stablecoin");
    expect(out).toContain("Top read-only concerns");
  });

  it("escapes hostile string content instead of injecting it", () => {
    const out = typed(
      intelArtifact({
        intelligenceId: "<script>alert(1)</script>",
        strategyNotes: ["<img src=x>evil"],
      }),
    );
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).not.toContain("<img src=x>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("flips to a do-NOT-trust caution when notAProfitabilityClaim is flipped", () => {
    expect(typed(intelArtifact({ notAProfitabilityClaim: false }))).toContain("do NOT trust");
  });

  it("flips to a do-NOT-trust caution when authorizesLiveTrading is flipped", () => {
    expect(typed(intelArtifact({ authorizesLiveTrading: true }))).toContain("do NOT trust");
  });

  it("never throws on hostile / type-mismatched shapes", () => {
    const hostile: unknown[] = [
      { schemaVersion: "sniper.strategy_intelligence.v1", candidates: "nope", verdictCounts: 5 },
      { schemaVersion: "sniper.strategy_intelligence.v1", topConcerns: [1, 2], candidates: [null] },
      { schemaVersion: "sniper.strategy_intelligence.v1" },
    ];
    for (const shape of hostile) {
      expect(() => typed(shape)).not.toThrow();
    }
  });
});
