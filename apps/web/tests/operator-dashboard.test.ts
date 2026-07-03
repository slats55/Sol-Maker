import { describe, expect, it } from "vitest";

import { OPERATOR_DASHBOARD_FILENAME, renderOperatorDashboardHtml } from "../src/live/operator-dashboard.js";

/**
 * The Part 3 production operator dashboard is a READ-ONLY operator surface, distinct from the live
 * console. This test is its safety allowlist: it must NOT carry wallet / signing / key-capture code
 * (that lives only in the live console), must disable its dangerous controls, must state that the
 * backend never holds keys, and must never claim guaranteed profit.
 */
const html = renderOperatorDashboardHtml();

describe("operator dashboard — document shape", () => {
  it("is a complete HTML document with a single title and its own file", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html.match(/<title>/g) ?? []).toHaveLength(1);
    expect(OPERATOR_DASHBOARD_FILENAME).toBe("operator-dashboard.html");
  });
});

describe("operator dashboard — read-only, never signs", () => {
  it("carries NO wallet/signing/key code (that lives only in the live console)", () => {
    expect(html).not.toContain("signAndSendTransaction");
    expect(html).not.toContain("signTransaction");
    expect(html).not.toContain("sendTransaction");
    expect(html).not.toContain("phantom.solana");
    expect(html).not.toContain("VersionedTransaction");
    expect(html).not.toContain("web3.js");
  });

  it("offers no input for a seed phrase or private key (only JSON artifact file pickers)", () => {
    expect(html).toContain("never asks for a seed phrase or private key");
    expect(html).not.toMatch(/<input[^>]*type="(text|password)"/i);
    expect(html).not.toContain("<textarea");
    const fileInputs = html.match(/<input type="file"[^>]*>/g) ?? [];
    expect(fileInputs.length).toBe(4); // config validation, run report, reconciliation, session export
    for (const inp of fileInputs) expect(inp).toContain("application/json");
  });

  it("disables the canary controls and routes signing to the live console", () => {
    expect(html).toContain("Prepare Canary (use the CLI)");
    expect(html).toContain("Approve in Phantom (use the Live Console)");
    const disabledButtons = (html.match(/<button disabled>/g) ?? []).length;
    expect(disabledButtons).toBeGreaterThanOrEqual(2);
    expect(html).toContain('href="live-console.html"');
  });

  it("states clearly that the backend never holds keys", () => {
    expect(html).toContain("The backend never holds keys");
  });

  it("makes no profit guarantee and states loss is possible", () => {
    expect(html).not.toMatch(/guaranteed profit|profit guaranteed|guaranteed gains/i);
    expect(html.toLowerCase()).toContain("lose the entire amount");
    expect(html.toLowerCase()).toContain("not a promise of profit");
  });
});

describe("operator dashboard — the operator view panels exist", () => {
  it("has the mode/safety, feed, risk, canary/Phantom, positions, reconciliation, timeline and evidence panels", () => {
    for (const anchor of [
      'id="cfg-file"',
      'id="cfg-safety"',
      'id="feed-rows"',
      'id="risk-cards"',
      'id="canary-status"',
      'id="phantom-life"',
      'id="positions-paper"',
      'id="positions-live"',
      'id="recon-summary"',
      'id="timeline-rows"',
      'id="evidence-list"',
      'id="canary-gate"',
    ]) {
      expect(html).toContain(anchor);
    }
  });

  it("only accepts the four Part 3 artifact schemas by name", () => {
    expect(html).toContain("live.operator.config.validation.v1");
    expect(html).toContain("live.operator.run.report.v1");
    expect(html).toContain("live.operator.session.export.v1");
    expect(html).toContain("live.operator.reconciliation.v1");
  });

  it("shows the Phantom lifecycle states pending/submitted/confirmed/rejected/timed out", () => {
    for (const s of ["pending", "submitted", "confirmed", "rejected", "timed out"]) {
      expect(html.toLowerCase()).toContain(s);
    }
  });

  it("states large trades remain disabled and points at the runbook", () => {
    expect(html).toContain("Large trades remain disabled");
    expect(html).toContain("FINAL_PART_3_PRODUCTION_CANARY_RUNBOOK.md");
  });
});
