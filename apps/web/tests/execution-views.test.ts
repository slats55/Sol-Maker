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

  it("S95: renders the failure classification with its next safe action; hidden for none/pre-S95", () => {
    const failed = typed({
      schemaVersion: "txpreview.simulation.report.v1",
      outcome: "simulated-failed",
      network: "mainnet-beta",
      endpointHost: "rpc.example.com",
      builderId: "jupiter-swap-api",
      feePayerPublicKey: "AHgF6Ayj5CRKfBYTkosWXkYfEiAq9BnEq7WqUJggYkJ3",
      simulatedAt: "2026-06-12T08:00:00.000Z",
      slot: 426052463,
      unitsConsumed: 0,
      errLabel: '"AccountNotFound"',
      classification: "account-error",
      classificationMessage: "An account the transaction needs is missing, invalid, or underfunded.",
      classificationNextAction: "Check the wallet's balance and the token accounts involved, then rebuild.",
      neverSigns: true,
      neverSends: true,
    });
    expect(failed).toContain("Failure classification");
    expect(failed).toContain("account-error");
    expect(failed).toContain("then rebuild");
    // A pre-S95 report (no classification field) renders without the section.
    const preS95 = typed({
      schemaVersion: "txpreview.simulation.report.v1",
      outcome: "simulated-failed",
      errLabel: "x",
    });
    expect(preS95).not.toContain("Failure classification");
  });
});

describe("txbuild.report.v1 typed view (S95)", () => {
  it("is in the registry and ships a typed view", () => {
    expect(isKnownSchema("txbuild.report.v1")).toBe(true);
    expect(hasTypedView("txbuild.report.v1")).toBe(true);
  });

  it("REFUSED attempt: refusal table with code, message, and next safe action verbatim", () => {
    const html = typed({
      schemaVersion: "txbuild.report.v1",
      outcome: "refused",
      builderId: "jupiter-swap-api",
      endpointHost: "lite-api.jup.ag",
      attemptedAt: "2026-06-12T08:00:00.000Z",
      requestSummary: {
        candidateMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        inputMint: "So11111111111111111111111111111111111111112",
        amountRaw: "5000000",
        slippageBps: 50,
        walletPublicKey: "AHgF6Ayj5CRKfBYTkosWXkYfEiAq9BnEq7WqUJggYkJ3",
        network: "mainnet-beta",
        executionMode: "mainnet-dry-run",
        programAllowlistActive: false,
      },
      refusals: [
        {
          code: "build-refused-risk-rejected",
          detail: "the advisory risk decision is REJECT — never built",
          message: "The advisory risk decision for this candidate is REJECT.",
          nextAction: "Do not trade this token. A REJECT is never overridable at build time.",
        },
      ],
      quoteFacts: null,
      txFacts: null,
      envelopeRef: null,
      neverSigns: true,
      neverSends: true,
      phase7LiveTradingReady: false,
    });
    expect(html).toContain("REFUSED");
    expect(html).toContain("the system working, not a bug");
    expect(html).toContain("build-refused-risk-rejected");
    expect(html).toContain("never overridable at build time");
    expect(html).toContain("not supplied (no program check)");
  });

  it("BUILT attempt: quote facts + transaction shape facts rendered", () => {
    const html = typed({
      schemaVersion: "txbuild.report.v1",
      outcome: "built",
      builderId: "jupiter-swap-api",
      endpointHost: "lite-api.jup.ag",
      attemptedAt: "2026-06-12T20:20:14.752Z",
      requestSummary: {
        candidateMint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
        inputMint: "So11111111111111111111111111111111111111112",
        amountRaw: "5000000",
        slippageBps: 50,
        walletPublicKey: "AHgF6Ayj5CRKfBYTkosWXkYfEiAq9BnEq7WqUJggYkJ3",
        network: "mainnet-beta",
        executionMode: "mainnet-dry-run",
        programAllowlistActive: true,
      },
      refusals: [],
      quoteFacts: { inAmountRaw: "5000000", outAmountRaw: "7541869650", priceImpactPct: "0", contextSlot: 426052463, quotedAt: "2026-06-12T20:20:14.752Z" },
      txFacts: { version: 0, versionSupported: true, blockhashPresent: true, instructionCount: 7, staticProgramIds: ["11111111111111111111111111111111"], addressTableLookupCount: 1, unresolvableProgramIdCount: 0 },
      envelopeRef: "envelope.json",
      neverSigns: true,
      neverSends: true,
      phase7LiveTradingReady: false,
    });
    expect(html).toContain("BUILT");
    expect(html).toContain("never an order");
    expect(html).toContain("7541869650");
    expect(html).toContain("426052463");
    expect(html).toContain("Transaction shape facts");
    expect(html).toContain("ACTIVE");
    expect(html).toContain("None — every check passed.");
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
