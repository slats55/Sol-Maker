/**
 * Sprint 105-B — the provider health report typed view in the web command center. Pins, over small
 * schema-shaped artifacts (valid = parseable JSON for the inspector; every value the view reads is
 * verbatim), that:
 *   - the schema ships a typed view;
 *   - the view leads with the LIVE TRADING DISABLED framing and the reachability-only / no-send facts;
 *   - it surfaces per-provider statuses, redacted (host-only) endpoints, latency, and the summary;
 *   - it flips to a "do NOT trust" caution when its safety literals are missing / flipped.
 *
 * The web src imports no backend code, so these artifacts are synthetic (schema-shaped); the
 * production builder / validator is tested in @soulmaker/sniper.
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

function healthArtifact(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "sniper.provider_health.report.v1",
    banner: "SNIPER PROVIDER HEALTH REPORT — LIVE TRADING IS DISABLED.",
    disclaimers: ["Not a live result."],
    reportId: "ph-1",
    checkedAt: null,
    mode: "mainnet-dry-run",
    network: "mainnet-beta",
    providerProfile: "public-default",
    checks: [
      {
        checkId: "rpc",
        provider: "rpc",
        status: "available",
        latencyMs: 203.13,
        redactedEndpoint: "https://api.mainnet-beta.solana.com",
        message: "RPC reachable",
        nextSafeAction: "rpc is ready for read-only reads.",
      },
      {
        checkId: "jupiter-quote",
        provider: "jupiter-quote",
        status: "rate-limited",
        latencyMs: 80,
        redactedEndpoint: "https://lite-api.jup.ag",
        message: "Jupiter quote probe: blocked (HTTP 429)",
        nextSafeAction: "Retry later; the campaign skips this stage honestly.",
      },
    ],
    summary: {
      availableCount: 1,
      unavailableCount: 0,
      skippedCount: 0,
      misconfiguredCount: 0,
      timeoutCount: 0,
      rateLimitedCount: 1,
      errorCount: 0,
    },
    canRunLiveReadonlyCampaign: false,
    canRunFixtureCampaign: true,
    noSend: true,
    noSigner: true,
    liveSendStatus: "disabled",
    authorizesLiveTrading: false,
    caveats: ["Reachability only; never a risk verdict."],
    redactionApplied: true,
    ...over,
  };
}

describe("provider health report typed view", () => {
  it("ships a typed view for the schema", () => {
    expect(hasTypedView("sniper.provider_health.report.v1")).toBe(true);
  });

  it("leads with LIVE TRADING DISABLED + reachability-only framing", () => {
    const out = typed(healthArtifact());
    expect(out).toContain("LIVE TRADING DISABLED");
    expect(out).toContain("reachability only");
    expect(out).toContain("never a candidate risk verdict");
  });

  it("surfaces per-provider statuses, redacted host-only endpoints, and latency", () => {
    const out = typed(healthArtifact());
    expect(out).toContain("rpc");
    expect(out).toContain("jupiter-quote");
    expect(out).toContain("rate-limited");
    expect(out).toContain("https://api.mainnet-beta.solana.com");
    expect(out).toContain("203.13 ms");
    // canRunLiveReadonlyCampaign is shown honestly false here.
    expect(out).toContain("live-readonly=false");
  });

  it("renders the summary counts", () => {
    const out = typed(healthArtifact());
    expect(out).toContain("1 available");
    expect(out).toContain("1 rate-limited");
  });

  it("flips to a do-NOT-trust caution when the no-send literal is flipped", () => {
    const out = typed(healthArtifact({ noSend: false }));
    expect(out).toContain("do NOT trust");
  });

  it("flips to a do-NOT-trust caution when liveSendStatus is not disabled", () => {
    const out = typed(healthArtifact({ liveSendStatus: "enabled" }));
    expect(out).toContain("do NOT trust");
  });

  it("flips to a do-NOT-trust caution when authorizesLiveTrading is true", () => {
    const out = typed(healthArtifact({ authorizesLiveTrading: true }));
    expect(out).toContain("do NOT trust");
  });

  it("escapes hostile endpoint/message content instead of injecting it", () => {
    const out = typed(
      healthArtifact({
        checks: [
          {
            checkId: "rpc",
            provider: "rpc",
            status: "misconfigured",
            latencyMs: null,
            redactedEndpoint: "[invalid-endpoint]",
            message: "<script>alert(1)</script>",
            nextSafeAction: "Fix the endpoint.",
          },
        ],
        summary: { availableCount: 0, unavailableCount: 0, skippedCount: 0, misconfiguredCount: 1, timeoutCount: 0, rateLimitedCount: 0, errorCount: 0 },
      }),
    );
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toContain("misconfigured");
  });
});
