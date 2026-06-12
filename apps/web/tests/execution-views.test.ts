/**
 * Sprint 93 — execution-lane typed views + command-center additions.
 *
 * Pins, over small synthetic artifacts (every rendered value verbatim):
 *   - typed views exist for sniper.rehearsal.report.v1 (stage table + never-sends framing),
 *     execution.readiness.report.v1 (the fourteen-condition checklist + freshness evidence +
 *     never-armed framing), execution.devnet.rehearsal.report.v1 (steps + signature +
 *     confirmation + honest funding-blocked), and txpreview.simulation.report.v1;
 *   - the new schemas are recognized by the registry (no "unknown schema" caution for them);
 *   - the capability strip gained the freshness / rehearse / readiness rows and still shows
 *     live trading disabled.
 */

import { describe, expect, it } from "vitest";
import { hasTypedView, renderTypedArtifactView } from "../src/components/artifact-views.js";
import { SNIPER_CAPABILITIES } from "../src/lib/command-center.js";
import { renderToString } from "../src/lib/html.js";
import { normalizeArtifact } from "../src/lib/local-artifact.js";
import { isKnownSchema } from "../src/lib/report-types.js";

function typed(raw: unknown): string {
  const view = renderTypedArtifactView(normalizeArtifact(raw), raw);
  expect(view).not.toBeNull();
  return renderToString(view!);
}

describe("S93 schemas are recognized", () => {
  it.each([
    "sniper.rehearsal.report.v1",
    "execution.readiness.report.v1",
    "execution.devnet.rehearsal.report.v1",
    "execution.status.report.v1",
    "execution.attempt.report.v1",
    "txpreview.envelope.v1",
    "txpreview.simulation.report.v1",
    "routequote.fetch.report.v1",
    "realtime.candidates.snapshot.v1",
  ])("%s is in the registry", (id) => {
    expect(isKnownSchema(id)).toBe(true);
  });

  it.each([
    "sniper.rehearsal.report.v1",
    "execution.readiness.report.v1",
    "execution.devnet.rehearsal.report.v1",
    "txpreview.simulation.report.v1",
  ])("%s ships a typed view", (id) => {
    expect(hasTypedView(id)).toBe(true);
  });
});

describe("sniper.rehearsal.report.v1 typed view", () => {
  it("renders the stage table verbatim with the never-sends framing and next commands", () => {
    const html = typed({
      schemaVersion: "sniper.rehearsal.report.v1",
      mode: "paper",
      outcome: "blocked",
      generatedAt: "2026-06-12T08:00:00.000Z",
      executedCount: 3,
      skippedCount: 5,
      blockedCount: 1,
      neverSendsOnMainnet: true,
      phase7LiveTradingReady: false,
      stages: [
        { stage: "candidates", status: "executed", detail: "candidates from operator file candidates.json", artifacts: [], nextCommand: null },
        { stage: "dry-run", status: "blocked", detail: "operator bundle verdict: blocked", artifacts: [], nextCommand: null },
        { stage: "quote-fetch", status: "skipped", detail: "paper mode reaches no network", artifacts: [], nextCommand: "pnpm soulmaker paper:routequote:fetch --candidates c.json" },
      ],
    });
    expect(html).toContain("no mode of this workflow can send on mainnet");
    expect(html).toContain("candidates from operator file candidates.json");
    expect(html).toContain("paper:routequote:fetch");
    expect(html).toContain("blocked");
  });
});

describe("execution.readiness.report.v1 typed view", () => {
  it("renders the checklist with [x]/[ ] boxes, next safe actions, and the freshness evidence", () => {
    const html = typed({
      schemaVersion: "execution.readiness.report.v1",
      verdict: "blocked",
      satisfiedCount: 2,
      totalChecks: 14,
      blockedReason: "12 of 14 live-gate condition(s) unsatisfied: env-acknowledgment, quote-fresh",
      nextSafeAction: "env-acknowledgment: remains unset",
      conditions: [
        { gate: "network-mainnet-beta", satisfied: true, detail: "network is exactly mainnet-beta", nextAction: "evaluated against mainnet-beta" },
        { gate: "quote-fresh", satisfied: false, detail: "the quote freshness check did not pass", nextAction: "fetch a LIVE quote then pass --quote-report" },
      ],
      evidence: {
        quoteFreshness: { sourceSchema: "routequote.fetch.report.v1", fetchedAt: "2026-06-12T07:59:00.000Z", capMs: 30000, verdict: "stale", ageMs: 60000, detail: "the quote is 60000ms old" },
      },
    });
    expect(html).toContain("structurally incapable of reporting armed");
    expect(html).toContain("[x]");
    expect(html).toContain("[ ]");
    expect(html).toContain("quote-fresh");
    expect(html).toContain("fetch a LIVE quote");
    expect(html).toContain("stale");
    expect(html).toContain("2026-06-12T07:59:00.000Z");
  });
});

describe("execution.devnet.rehearsal.report.v1 typed view", () => {
  it("renders steps, the signature, and the confirmation slot for a rehearsed run", () => {
    const html = typed({
      schemaVersion: "execution.devnet.rehearsal.report.v1",
      outcome: "rehearsed",
      network: "devnet",
      endpointHost: "api.devnet.solana.com",
      signerPublicKey: "AHgF6Ayj5CRKfBYTkosWXkYfEiAq9BnEq7WqUJggYkJ3",
      signerSource: "generated-throwaway",
      signature: "FakeSig1111111111111111111111111111111111111",
      neverMainnet: true,
      airdrop: { requested: true, lamports: 1000000000, signature: "Air111", status: "confirmed" },
      confirmation: { confirmed: true, slot: 424242, errLabel: null, polls: 2 },
      steps: [
        { step: "funding", status: "ok", detail: "balance 1000000000 lamports (airdrop: confirmed)" },
        { step: "send", status: "ok", detail: "submitted once" },
      ],
    });
    expect(html).toContain("never mainnet readiness");
    expect(html).toContain("rehearsed");
    expect(html).toContain("424");
    expect(html).toContain("submitted once");
  });

  it("renders the honest devnet-funding-blocked outcome", () => {
    const html = typed({
      schemaVersion: "execution.devnet.rehearsal.report.v1",
      outcome: "devnet-funding-blocked",
      network: "devnet",
      endpointHost: "api.devnet.solana.com",
      signerPublicKey: null,
      signerSource: "generated-throwaway",
      signature: null,
      airdrop: { requested: true, lamports: 1000000000, signature: null, status: "unavailable" },
      confirmation: null,
      steps: [{ step: "funding", status: "unavailable", detail: "airdrop unavailable (rate limit or faucet outage)" }],
    });
    expect(html).toContain("devnet-funding-blocked");
    expect(html).toContain("rate limit");
    expect(html).toContain("never a faked");
  });
});

describe("txpreview.simulation.report.v1 typed view", () => {
  it("renders the outcome, slot, and the evidence-never-readiness framing", () => {
    const html = typed({
      schemaVersion: "txpreview.simulation.report.v1",
      outcome: "simulated-ok",
      network: "mainnet-beta",
      endpointHost: "rpc.example.com",
      builderId: "jupiter-swap-api",
      feePayerPublicKey: "AHgF6Ayj5CRKfBYTkosWXkYfEiAq9BnEq7WqUJggYkJ3",
      simulatedAt: "2026-06-12T08:00:00.000Z",
      slot: 312345678,
      unitsConsumed: 142337,
      errLabel: null,
      neverSigns: true,
      neverSends: true,
    });
    expect(html).toContain("simulated-ok");
    expect(html).toContain("evidence for review, never readiness");
    expect(html).toContain("jupiter-swap-api");
  });
});

describe("capability strip — S93 rows", () => {
  it("gained freshness / rehearse / readiness rows and still shows live trading disabled", () => {
    const keys = SNIPER_CAPABILITIES.map((c) => c.key);
    expect(keys).toContain("freshness");
    expect(keys).toContain("rehearse");
    expect(keys).toContain("readiness");
    const live = SNIPER_CAPABILITIES.find((c) => c.key === "live");
    expect(live?.state).toBe("disabled");
    const devnet = SNIPER_CAPABILITIES.find((c) => c.key === "devnet-exec");
    expect(devnet?.state).toBe("boundary-only");
    expect(devnet?.note).toContain("execution:devnet:rehearse");
  });
});
