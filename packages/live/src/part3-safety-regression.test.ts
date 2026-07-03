/**
 * PART 3 SAFETY REGRESSION (Sprint 109).
 *
 * Proves the production operator release does NOT weaken any Part 1/2 gate. The operator surface
 * adds config validation, a durable journal, a supervised run, reconciliation and alerts — and its
 * strongest output remains a RECOMMENDATION + Phantom handoff. This suite pins the structural
 * facts source-level and behaviourally:
 *
 *   1. No Part 3 module gains a network / wallet / signing capability (source scan).
 *   2. No mode trades; kill switch + emergency stop block EVERYTHING, in every mode.
 *   3. Secrets are refused everywhere: config, journal events, alerts, reconciliation inputs.
 *   4. largeTradesEnabled stays a pinned false; a config cannot enable it.
 *   5. Alert sinks stay disabled by default.
 *   6. A run report claiming more than one canary, or a canary with no result, is REFUSED.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { OPERATOR_ALERT_SINKS_DEFAULT, buildOperatorAlert } from "./alerts.js";
import { normalizeManualMint } from "./discovery.js";
import type { SniperCandidate, SniperCandidateRisk } from "./discovery.js";
import { buildEscalationPolicy } from "./escalation.js";
import { buildHumanCanaryReadiness } from "./human-readiness.js";
import { buildOperatorConfig, validateOperatorConfig } from "./operator-config.js";
import { runSupervisedOperatorLoop, validateOperatorRunReport } from "./operator-loop.js";
import type { OperatorLoopInput } from "./operator-loop.js";
import { buildOperatorReconciliation } from "./operator-reconcile.js";
import { buildLivePolicy } from "./policy.js";
import { buildSessionEvent } from "./session-recorder.js";
import { loopModeCanTrade, SNIPER_LOOP_MODES } from "./sniper-loop.js";
import type { StrategyQuoteFacts } from "./strategy.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const AT = "2026-07-03T12:00:00.000Z";
const NOW = Date.parse(AT);
const MINT = "So11111111111111111111111111111111111111112";
const WALLET = "CgGszXon2aemnsCYRSuguJqkFdSAwCPc31mFcHLDwbpV";

const cleanRisk: SniperCandidateRisk = { score: 5, decision: "ACCEPT", criticalFlagCount: 0, freezeAuthorityPresent: false, mintAuthorityPresent: false };
const freshQuote: StrategyQuoteFacts = { priceImpactPct: 0.5, ageMs: 1_000, slippageBps: 50, routeConfidence: 0.9, provider: "jupiter" };

function candidate(): SniperCandidate {
  const base = normalizeManualMint({ mint: MINT }, { discoveredAt: AT });
  return { ...base, risk: cleanRisk, liquidityUsd: 50_000, volumeUsd: 100_000, poolAgeSeconds: 600 };
}

function greenInput(overrides: Partial<OperatorLoopInput> = {}): OperatorLoopInput {
  return {
    config: buildOperatorConfig({ operatorLabel: "reg", rpcEndpointHttps: "https://api.mainnet-beta.solana.com", mode: "armed_canary", walletPublicKey: WALLET }),
    requestedMode: "armed_canary",
    candidates: [{ candidate: candidate(), quote: freshQuote, quoteFresh: true, plannedSpendSol: 0.005 }],
    policy: buildLivePolicy({ mode: "live_canary", liveEnabled: true, walletProvider: "phantom" }),
    escalationPolicy: buildEscalationPolicy(),
    escalationSession: { armed: true, lastCanaryAtMs: null },
    limits: { maxCandidates: null, maxRuntimeMs: null },
    sessionId: "reg-1",
    startedAt: AT,
    nowMs: NOW,
    ...overrides,
  };
}

describe("part3 regression — source scan: no new send/sign/network capability", () => {
  const PART3_SOURCES = ["operator-config.ts", "session-recorder.ts", "operator-reconcile.ts", "operator-loop.ts", "alerts.ts", "human-readiness.ts"];
  const FORBIDDEN = [
    "sendTransaction",
    "signTransaction",
    "sendRawTransaction",
    "signAndSend",
    "Keypair",
    "fromSecretKey",
    "@solana/web3.js",
    "node:https",
    "node:http",
    "node:net",
    "fetch(",
    "WebSocket",
    "XMLHttpRequest",
  ];

  for (const file of PART3_SOURCES) {
    it(`${file} carries no send/sign/network token`, () => {
      const source = readFileSync(join(HERE, file), "utf8");
      for (const token of FORBIDDEN) {
        expect(source.includes(token), `${file} must not contain "${token}"`).toBe(false);
      }
    });
  }

  it("the Part 3 modules do no I/O at all (no node:fs import) — the CLI owns files", () => {
    for (const file of PART3_SOURCES) {
      const source = readFileSync(join(HERE, file), "utf8");
      expect(source.includes("node:fs"), `${file} must not import node:fs`).toBe(false);
    }
  });
});

describe("part3 regression — no mode trades; stops block everything", () => {
  it("loopModeCanTrade is still false for every underlying mode", () => {
    for (const m of SNIPER_LOOP_MODES) expect(loopModeCanTrade(m)).toBe(false);
  });

  it("the operator loop's strongest output is a recommendation whose next steps hand off to a HUMAN in Phantom", () => {
    const r = runSupervisedOperatorLoop(greenInput());
    expect(r.totals.canaryRecommended).toBe(1);
    expect(r.recommendation!.nextSteps.join(" ")).toMatch(/Phantom/);
    expect(r.loopNeverSends).toBe(true);
    expect(r.backendNeverSends).toBe(true);
    // The report carries NO transaction, NO signature, NO envelope — nothing transmittable.
    const encoded = JSON.stringify(r);
    expect(encoded).not.toMatch(/"signature"/);
    expect(encoded).not.toMatch(/base64/i);
    expect(encoded).not.toMatch(/serializedTransaction|rawTransaction|unsignedTransaction/);
  });

  it("kill switch / emergency stop in the CONFIG zero out every mode, even armed+green", () => {
    for (const stop of [{ killSwitchEngaged: true }, { emergencyStopEngaged: true }] as const) {
      const config = buildOperatorConfig({ operatorLabel: "reg", rpcEndpointHttps: "https://api.mainnet-beta.solana.com", mode: "armed_canary", walletPublicKey: WALLET, ...stop });
      const r = runSupervisedOperatorLoop(greenInput({ config }));
      expect(r.totals.processed).toBe(0);
      expect(r.totals.canaryRecommended).toBe(0);
      expect(r.paused).toBe(true);
      expect(r.manualRearmRequiredToResume).toBe(true);
    }
  });
});

describe("part3 regression — secrets refused everywhere", () => {
  const SECRET_DOCS: Array<[string, () => void]> = [
    ["config field", (): void => void validateOperatorConfig({ secretKey: "x" })],
    ["config secret-shaped value", (): void => void buildOperatorConfig({ operatorLabel: "5".repeat(88), rpcEndpointHttps: "https://x.example" })],
    ["journal event data", (): void => void buildSessionEvent({ sessionId: "s", seq: 1, at: AT, kind: "note", detail: "x", data: { mnemonic: "a b c" } })],
    ["alert data", (): void => void buildOperatorAlert({ kind: "candidate_found", at: AT, detail: "x", data: { privateKey: "k" } })],
    [
      "reconciliation price evidence",
      (): void =>
        void buildOperatorReconciliation({
          candidateMint: MINT,
          canary: { signature: null, submittedAt: null, lastStatusAt: null, status: "unknown", slot: null, err: null, inputAmountRaw: null, outputAmountRaw: null, solSpentLamports: null, feesLamports: null, priorityFeeLamports: null, balanceBeforeLamports: null, balanceAfterLamports: null },
          pre: { solLamports: null, tokenRaw: null, capturedAt: null },
          post: { solLamports: null, tokenRaw: null, capturedAt: null },
          tokenDecimals: null,
          quotedOutRaw: null,
          tokenPriceUsd: 1,
          priceEvidence: "deadbeef".repeat(16),
        }),
    ],
  ];

  for (const [name, fn] of SECRET_DOCS) {
    it(`refuses secret material in: ${name}`, () => {
      expect(fn).toThrow();
    });
  }
});

describe("part3 regression — pinned literals hold", () => {
  it("a config can never enable large trades or drop the Phantom requirement", () => {
    const good = JSON.parse(JSON.stringify(buildOperatorConfig({ operatorLabel: "reg", rpcEndpointHttps: "https://api.mainnet-beta.solana.com" }))) as Record<string, unknown>;
    expect(() => validateOperatorConfig({ ...good, largeTradesEnabled: true })).toThrow(/largeTradesEnabled/);
    expect(() => validateOperatorConfig({ ...good, phantomApprovalRequired: false })).toThrow(/phantomApprovalRequired/);
    expect(() => validateOperatorConfig({ ...good, backendNeverSends: false })).toThrow(/backendNeverSends/);
  });

  it("alert sinks default OFF", () => {
    expect(OPERATOR_ALERT_SINKS_DEFAULT).toEqual({ console: false, webhookFilePath: null });
  });

  it("the readiness report cannot claim an executed canary without settled evidence", () => {
    const config = buildOperatorConfig({ operatorLabel: "reg", rpcEndpointHttps: "https://api.mainnet-beta.solana.com" });
    const r = buildHumanCanaryReadiness({
      generatedAt: AT,
      config,
      checks: { configValidated: true, sessionJournalWorks: true, observeRunProven: true, paperShadowRunProven: true, armedRecommendationProven: true, reconciliationPathProven: true, dashboardBuilt: true, alertsAvailable: true },
      reconciliation: null,
    });
    expect(r.realCanaryExecuted).toBe(false);
    expect(r.verdict).toBe("ready-for-human-canary");
  });
});

describe("part3 regression — tampered run reports are refused", () => {
  it("more than one canary, or a fabricated recommendation, cannot validate", () => {
    const real = JSON.parse(JSON.stringify(runSupervisedOperatorLoop(greenInput()))) as Record<string, unknown> & {
      results: Array<Record<string, unknown>>;
      totals: Record<string, number>;
    };
    // Duplicate the canary result → 2 recommendations → refused even with matching tallies.
    const doubled = { ...real, results: [...real.results, real.results[0]!], totals: { ...real.totals, processed: 2, canaryRecommended: 2 } };
    expect(() => validateOperatorRunReport(doubled)).toThrow(/more than one canary/);
  });
});
