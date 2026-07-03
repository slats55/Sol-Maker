import { describe, expect, it } from "vitest";

import { SNIPER_DASHBOARD_FILENAME, renderSniperDashboardHtml } from "../src/live/sniper-dashboard.js";

/**
 * The Part 2 sniper dashboard is a READ-ONLY operator surface, distinct from the live console. This
 * test is its safety allowlist: the dashboard must NOT carry any wallet / signing / key-capture code
 * (that lives only in the live console), must disable its dangerous controls, and must never claim
 * guaranteed profit.
 */
const html = renderSniperDashboardHtml();

describe("sniper dashboard — document shape", () => {
  it("is a complete HTML document with a single title and its own file", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html.match(/<title>/g) ?? []).toHaveLength(1);
    expect(SNIPER_DASHBOARD_FILENAME).toBe("sniper-dashboard.html");
  });
});

describe("sniper dashboard — read-only, never signs", () => {
  it("carries NO wallet/signing/key code (that lives only in the live console)", () => {
    expect(html).not.toContain("signAndSendTransaction");
    expect(html).not.toContain("signTransaction");
    expect(html).not.toContain("sendTransaction");
    expect(html).not.toContain("phantom.solana");
    expect(html).not.toContain("VersionedTransaction");
    expect(html).not.toContain("web3.js");
  });

  it("offers no input for a seed phrase or private key (only JSON artifact file pickers)", () => {
    // The page may reassure the reader it NEVER asks for a seed/key, but it must offer no field for one.
    expect(html).toContain("never asks for a seed phrase or private key");
    // No text input / password / textarea exists at all (artifacts load via file pickers only).
    expect(html).not.toMatch(/<input[^>]*type="(text|password)"/i);
    expect(html).not.toContain("<textarea");
    // Every file input accepts JSON artifacts, never key material.
    const fileInputs = html.match(/<input type="file"[^>]*>/g) ?? [];
    expect(fileInputs.length).toBeGreaterThan(0);
    for (const inp of fileInputs) expect(inp).toContain("application/json");
  });

  it("disables the canary controls and routes signing to the live console", () => {
    expect(html).toContain("Prepare Canary (use the CLI)");
    expect(html).toContain("Arm &amp; Sign (use the Live Console)");
    // Both canary buttons are disabled.
    const canaryButtons = (html.match(/<button disabled>/g) ?? []).length;
    expect(canaryButtons).toBeGreaterThanOrEqual(2);
    expect(html).toContain('href="live-console.html"');
  });

  it("makes no profit guarantee and states loss is possible", () => {
    expect(html).not.toMatch(/guaranteed profit|profit guaranteed|guaranteed gains/i);
    expect(html.toLowerCase()).toContain("lose the entire amount");
    expect(html.toLowerCase()).toContain("not a promise of profit");
  });

  it("shows the six loop modes and a kill switch", () => {
    for (const m of ["off", "observe_only", "paper_shadow", "armed_canary", "paused", "killed"]) {
      expect(html).toContain(`id="mode-${m}"`);
    }
    expect(html).toContain("KILL SWITCH");
  });
});

describe("sniper dashboard — S109 command-center sections", () => {
  it("shows the five big posture banner states", () => {
    for (const p of ["OFF", "PAPER", "DRY-RUN", "LIVE-GATED", "ARMED-CANARY"]) {
      expect(html).toContain(`id="posture-${p}"`);
    }
  });

  it("carries viewers for daemon session, performance, positions, buy review and sell review", () => {
    for (const id of ["daemon-file", "perf-file", "ledger-file", "buy-file", "sell-file"]) {
      expect(html).toContain(`id="${id}"`);
    }
    // Each viewer validates its schema and only renders known artifacts.
    for (const schema of [
      "live.sniper.daemon.summary.v1",
      "live.paper.performance.report.v1",
      "live.position.ledger.v1",
      "live.canary.buy_review.v1",
      "live.canary.sell_request.v1",
    ]) {
      expect(html).toContain(schema);
    }
  });

  it("surfaces provider health, no-trade reasons and quote stale warnings", () => {
    expect(html).toContain("Provider health");
    expect(html).toContain("No-trade reasons");
    expect(html).toContain("STALE");
  });

  it("shows the emergency / kill-switch instructions verbatim commands", () => {
    expect(html).toContain("SOULMAKER_EMERGENCY_STOP=1");
    expect(html).toContain("live:sniper:emergency");
    expect(html).toContain("live:sniper:reconcile");
  });

  it("the sell viewer never claims a result — PnL is labelled an estimate", () => {
    expect(html).toContain("estimate, not a result");
  });
});
