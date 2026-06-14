/**
 * Sprint 106 — sniper alpha HISTORY typed view in the web command center. Pins, over a schema-shaped
 * artifact (valid = parseable JSON for the inspector; every value the view reads is verbatim), that:
 *   - the schema ships a typed view;
 *   - the view leads with the LIVE TRADING DISABLED framing and the no-send / authorizes-nothing facts;
 *   - the view surfaces the run table, the aggregate verdict tally, the provenance + provider rollups,
 *     the most common blocker reasons, and the invalid-artifact warnings;
 *   - hostile string content is ESCAPED, never injected;
 *   - the view flips to a "do NOT trust" caution when its safety literals are missing / flipped.
 *
 * The web src imports no backend code, so this artifact is synthetic (schema-shaped); the production
 * builder/validator are tested in @soulmaker/sniper.
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

/** Patterns that must never appear in the rendered view (raw tags that would mean unescaped injection). */
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

function historyArtifact(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "sniper.alpha_history.v1",
    banner: "SNIPER ALPHA HISTORY — LIVE TRADING IS DISABLED.",
    disclaimers: ["Not a trade signal.", "Not a profitability claim."],
    historyId: "demo-history",
    generatedAt: null,
    runCount: 2,
    invalidArtifactCount: 1,
    totalCandidateCount: 4,
    aggregateVerdictCounts: { watch: 2, review: 0, blocked: 1, insufficientEvidence: 1 },
    providerHealthRollup: {
      risk: { ok: 2, degraded: 0, unavailable: 0, notAttempted: 0 },
      quote: { ok: 1, degraded: 0, unavailable: 1, notAttempted: 0 },
      simulation: { ok: 0, degraded: 0, unavailable: 0, notAttempted: 2 },
    },
    evidenceProvenanceRollup: { realReadonly: 1, fixture: 1, fictionalExample: 0, mixed: 0 },
    phase7Postures: ["authorized-for-design-only"],
    topBlockerReasons: [{ reason: "deep risk REJECTED this candidate", runCount: 1 }],
    runs: [
      {
        runRef: "run-a",
        runId: "alpha-a",
        mode: "mainnet-dry-run",
        network: "mainnet-beta",
        evidenceProvenance: "real-readonly",
        candidateCount: 2,
        verdictCounts: { watch: 1, review: 0, blocked: 1, insufficientEvidence: 0 },
        providerHealth: { risk: "ok", quote: "ok", simulation: "not-attempted" },
        rustEngineStatus: "available",
        phase7Status: "authorized-for-design-only",
        hasAlphaReport: true,
        topMint: WSOL,
        blockerReasons: ["deep risk REJECTED this candidate"],
        liveTradingStatus: "disabled",
        authorizesLiveTrading: false,
      },
    ],
    invalidArtifacts: [{ ref: "run-empty/campaign.json", reason: "missing recognized artifact (campaign.json)" }],
    sensitiveFieldScan: { scanned: true, signaturePresent: false, txidPresent: false, sendResultPresent: false, keyLikePresent: false },
    anyRunAuthorizesLiveTrading: false,
    nextSafeActions: ["Live trading stays DISABLED."],
    caveats: ["A history rolls up evidence; it never trades."],
    artifactRefs: [],
    liveTradingStatus: "disabled",
    authorizesLiveTrading: false,
    redactionApplied: true,
    neverSends: true,
    phase7LiveTradingReady: false,
    ...over,
  };
}

describe("sniper.alpha_history.v1 — typed view (command center)", () => {
  it("ships a typed view and leads with LIVE TRADING DISABLED + the rollup facts", () => {
    expect(hasTypedView("sniper.alpha_history.v1")).toBe(true);
    const out = typed(historyArtifact());
    expect(out).toContain("LIVE TRADING DISABLED");
    expect(out).toContain("demo-history");
    expect(out).toContain("Runs");
    expect(out).toContain("run-a");
    expect(out).toContain(WSOL);
    expect(out).toContain("real-readonly");
    expect(out).toContain("authorized-for-design-only");
  });

  it("surfaces the aggregate verdict tally and the provenance / provider rollups", () => {
    const out = typed(historyArtifact());
    expect(out).toContain("watch 2");
    expect(out).toContain("blocked 1");
    expect(out).toContain("fixture 1");
    expect(out).toContain("Most common blocker reasons");
    expect(out).toContain("deep risk REJECTED this candidate");
    expect(out).toContain("clean (no signature");
  });

  it("warns about invalid / unrecognized artifacts and never counts them as runs", () => {
    const out = typed(historyArtifact());
    expect(out).toContain("Invalid / unrecognized artifacts");
    expect(out).toContain("run-empty/campaign.json");
    expect(out).toContain("missing recognized artifact");
  });

  it("escapes hostile string content instead of injecting it", () => {
    const out = typed(
      historyArtifact({
        historyId: "<script>alert(1)</script>",
        invalidArtifacts: [{ ref: "<img src=x>evil", reason: "<b>boom</b>" }],
        invalidArtifactCount: 1,
      }),
    );
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).not.toContain("<img src=x>");
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&lt;img");
    for (const re of FORBIDDEN) {
      expect(re.test(out), `forbidden pattern ${re} appeared`).toBe(false);
    }
  });

  it("flips to a do-NOT-trust caution when authorizesLiveTrading is flipped", () => {
    expect(typed(historyArtifact({ authorizesLiveTrading: true }))).toContain("do NOT trust");
  });

  it("flips to a do-NOT-trust caution when anyRunAuthorizesLiveTrading is flipped", () => {
    expect(typed(historyArtifact({ anyRunAuthorizesLiveTrading: true }))).toContain("do NOT trust");
  });

  it("never throws on hostile / type-mismatched shapes", () => {
    const hostile: unknown[] = [
      { schemaVersion: "sniper.alpha_history.v1", runs: "nope", aggregateVerdictCounts: 5 },
      { schemaVersion: "sniper.alpha_history.v1", providerHealthRollup: [], runs: [1, 2] },
      { schemaVersion: "sniper.alpha_history.v1" },
    ];
    for (const shape of hostile) {
      expect(() => typed(shape)).not.toThrow();
    }
  });
});

describe("/sniper page — alpha history section (no-send regression)", async () => {
  const { renderSniper } = await import("../src/pages/sniper.js");
  const out = renderToString(renderSniper());

  it("renders the alpha history section with the no-send framing", () => {
    expect(out).toContain("Alpha run history");
    expect(out).toContain("paper:sniper:alpha:history");
    expect(out).toContain("LIVE TRADING DISABLED");
  });

  it("makes no positive live-enabled claim anywhere on the page", () => {
    // Specific positive claims that could only mean live trading is on — never present in a negation.
    expect(out).not.toMatch(/live trading is enabled/i);
    expect(out).not.toMatch(/live trading is now/i);
    expect(out).not.toMatch(/sending is enabled/i);
    expect(out).not.toMatch(/now ready to trade/i);
    // The disabled framing is, by contrast, present and prominent.
    expect(out).toContain("LIVE TRADING DISABLED");
  });
});
