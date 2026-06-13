/**
 * Sprint 97 — Rust engine sidecar typed view + registry parity.
 *
 * Pins, over small synthetic artifacts (every rendered value verbatim):
 *   - engine.status.report.v1 is registered (family engine, stable) and maps
 *     to the engine:status CLI command;
 *   - the typed view renders the safety markers, capability lists, and caveats;
 *   - an artifact claiming an enabled capability renders the DANGER framing
 *     (the view never normalizes a violation into a calm summary);
 *   - hostile shapes never throw and hostile strings never escape into markup.
 */

import { describe, expect, it } from "vitest";
import { hasTypedView, renderTypedArtifactView } from "../src/components/artifact-views.js";
import { renderToString } from "../src/lib/html.js";
import { normalizeArtifact } from "../src/lib/local-artifact.js";
import { isKnownSchema, knownSchema, schemaForCli, KNOWN_REPORT_SCHEMAS } from "../src/lib/report-types.js";
import { COMMANDS } from "../src/lib/command-reference.js";

function typed(raw: unknown): string {
  const view = renderTypedArtifactView(normalizeArtifact(raw), raw);
  expect(view).not.toBeNull();
  return renderToString(view!);
}

const base = {
  schemaVersion: "engine.status.report.v1",
  banner: "RUST ENGINE STATUS — sidecar foundation report.",
  engineName: "solmaker-engine",
  engineVersion: "0.1.0",
  buildProfile: "debug",
  rustcVersion: "rustc 1.96.0 (ac68faa20 2026-05-25)",
  ipcVersion: "engine.ipc.v1",
  safetyMode: "sidecar-read-only",
  signerSupport: "disabled",
  sendSupport: "disabled",
  mainnetSendSupport: "disabled",
  supportedCapabilities: ["json-ipc", "schema-parity", "status"],
  disabledCapabilities: ["mainnet-live", "seed-phrase-handling", "sending", "signing", "wallet-loading"],
  createdAt: "2026-06-12T00:00:00.000Z",
  caveats: ["Foundation sidecar only — no execution capability exists in this engine yet."],
  neverSends: true,
  phase7LiveTradingReady: false,
};

describe("S97 engine schema registry parity", () => {
  it("engine.status.report.v1 is registered with a typed view", () => {
    expect(isKnownSchema("engine.status.report.v1")).toBe(true);
    expect(hasTypedView("engine.status.report.v1")).toBe(true);
  });

  it("is catalogued as the stable engine family emitted by engine:status", () => {
    const info = knownSchema("engine.status.report.v1");
    expect(info?.family).toBe("engine");
    expect(info?.stability).toBe("stable");
    expect(info?.cli).toBe("engine:status");
    expect(schemaForCli("engine:status")?.id).toBe("engine.status.report.v1");
  });

  it("the command reference lists engine:status in the Rust engine group, never chain-reading", () => {
    const ref = COMMANDS.find((c) => c.command === "engine:status");
    expect(ref).toBeDefined();
    expect(ref?.group).toBe("Rust engine (sidecar)");
    expect(ref?.readsChain).toBe(false);
  });

  it("every catalogued schema id stays unique after the engine addition", () => {
    const ids = KNOWN_REPORT_SCHEMAS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("engine.status.report.v1 typed view", () => {
  it("renders the disabled safety markers, capabilities, and caveats", () => {
    const html = typed(base);
    expect(html).toContain("every execution capability disabled");
    expect(html).toContain("solmaker-engine 0.1.0");
    expect(html).toContain("rustc 1.96.0");
    expect(html).toContain("engine.ipc.v1");
    expect(html).toContain("sidecar-read-only");
    expect(html).toContain("json-ipc, schema-parity, status");
    expect(html).toContain("mainnet-live, seed-phrase-handling, sending, signing, wallet-loading");
    expect(html).toContain("Foundation sidecar only — no execution capability exists in this engine yet.");
  });

  it("an artifact claiming signing enabled renders the DANGER framing", () => {
    const html = typed({ ...base, signerSupport: "enabled" });
    expect(html).toContain("do NOT trust this artifact");
    expect(html).not.toContain("every execution capability disabled");
  });

  it("a null rustcVersion renders honestly as unavailable", () => {
    const html = typed({ ...base, rustcVersion: null });
    expect(html).toContain("unavailable");
  });

  it("hostile shapes never throw; hostile strings stay escaped", () => {
    expect(() => typed({ schemaVersion: "engine.status.report.v1", supportedCapabilities: 7, caveats: "nope" })).not.toThrow();
    const html = typed({ ...base, banner: "<script>alert(1)</script>", caveats: ["<img src=x onerror=alert(1)>"] });
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
  });
});

// ---------------------------------------------------------------------------
// Sprint 98 — engine.realtime.observations.report.v1 (replay normalization)
// ---------------------------------------------------------------------------

const realtimeBase = {
  schemaVersion: "engine.realtime.observations.report.v1",
  banner: "RUST ENGINE REALTIME REPLAY — candidate observations normalized from an operator-supplied replay file.",
  engineName: "solmaker-engine",
  engineVersion: "0.1.0",
  ipcVersion: "engine.ipc.v1",
  providerId: "replay-file",
  sourceKind: "replay",
  endpointHost: "local-replay-file",
  fetchedAt: "replay",
  status: "observed",
  statusDetail: null,
  eventCount: 3,
  observationCount: 2,
  duplicateMintCount: 1,
  observations: [
    {
      candidateId: "rt-so111111",
      mint: "So11111111111111111111111111111111111111112",
      symbol: "SOL",
      name: "Wrapped SOL",
      sourceProviderId: "replay-file",
      sourceKind: "replay",
      observedAtLabel: "t0",
      launchpadLabel: "pump.fun",
      liquidityUsdHint: 1250.5,
      marketCapUsdHint: null,
      holderCountHint: null,
      caveats: ["A watched candidate is an OBSERVATION — never an order, never a trade, never execution."],
    },
  ],
  createdAt: "2026-06-12T00:00:00.000Z",
  caveats: ["Replay normalization only: every observation comes from an operator-supplied replay file and is NEVER live market data."],
  neverSends: true,
  phase7LiveTradingReady: false,
};

describe("S98 engine realtime schema registry parity", () => {
  it("engine.realtime.observations.report.v1 is registered (family engine, stable) with a typed view", () => {
    expect(isKnownSchema("engine.realtime.observations.report.v1")).toBe(true);
    expect(hasTypedView("engine.realtime.observations.report.v1")).toBe(true);
    const info = knownSchema("engine.realtime.observations.report.v1");
    expect(info?.family).toBe("engine");
    expect(info?.stability).toBe("stable");
    expect(info?.cli).toBe("paper:realtime:snapshot");
  });

  it("schemaForCli keeps resolving paper:realtime:snapshot to the SNAPSHOT schema (the command's primary artifact)", () => {
    expect(schemaForCli("paper:realtime:snapshot")?.id).toBe("realtime.candidates.snapshot.v1");
  });
});

describe("engine.realtime.observations.report.v1 typed view", () => {
  it("renders the replay framing, counts, observation table, and caveats", () => {
    const html = typed(realtimeBase);
    expect(html).toContain("NOT live market data");
    expect(html).toContain("solmaker-engine 0.1.0");
    expect(html).toContain("replay-file");
    expect(html).toContain("rt-so111111");
    expect(html).toContain("So11111111111111111111111111111111111111112");
    expect(html).toContain("pump.fun");
    expect(html).toContain("duplicate mints skipped");
    expect(html).toContain("NEVER live market data");
  });

  it("an artifact claiming a live sourceKind renders the do-not-trust framing", () => {
    const html = typed({ ...realtimeBase, sourceKind: "live" });
    expect(html).toContain("do NOT trust this artifact");
  });

  it("hostile shapes never throw; hostile strings stay escaped", () => {
    expect(() => typed({ schemaVersion: "engine.realtime.observations.report.v1", observations: 7 })).not.toThrow();
    const html = typed({
      ...realtimeBase,
      observations: [{ ...realtimeBase.observations[0], symbol: "<script>alert(1)</script>" }],
    });
    expect(html).not.toContain("<script>alert");
  });
});

// ---------------------------------------------------------------------------
// Sprint 99 — engine.routequote.score.report.v1 (route-quote scoring)
// ---------------------------------------------------------------------------

const scoreBase = {
  schemaVersion: "engine.routequote.score.report.v1",
  banner: "RUST ENGINE ROUTE QUOTE SCORES — quote-quality intelligence.",
  engineName: "solmaker-engine",
  engineVersion: "0.1.0",
  ipcVersion: "engine.ipc.v1",
  scoredAt: "2026-06-12T12:00:00.000Z",
  maxQuoteAgeMs: 60000,
  providerId: "jupiter-lite-api",
  endpointHost: "lite-api.jup.ag",
  reportFetchedAt: "2026-06-12T11:59:30.000Z",
  requestedInputMint: "So11111111111111111111111111111111111111112",
  requestedAmountRaw: "10000000",
  requestedSlippageBps: 50,
  entryCount: 2,
  includedCount: 1,
  excludedCount: 1,
  entries: [
    {
      candidateId: "cand-usdc",
      mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      status: "quote-observed",
      included: true,
      score: 85,
      components: { impactPenalty: 5, hopPenalty: 0, agePenalty: 10 },
      facts: {
        priceImpactPct: "0.5",
        hopCount: 1,
        routeLabels: ["Raydium"],
        fetchedAt: "2026-06-12T11:59:30.000Z",
        ageMs: 30000,
        freshnessVerdict: "fresh",
        contextSlot: 426052463,
      },
      reasons: [],
    },
    {
      candidateId: "cand-stale",
      mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
      status: "quote-observed",
      included: false,
      score: null,
      components: null,
      facts: {
        priceImpactPct: "0.1",
        hopCount: 1,
        routeLabels: ["Orca"],
        fetchedAt: "2026-06-12T11:00:00.000Z",
        ageMs: 3600000,
        freshnessVerdict: "stale",
        contextSlot: null,
      },
      reasons: ["stale"],
    },
  ],
  ranking: ["cand-usdc"],
  bestCandidateId: "cand-usdc",
  caveats: ["A route score is INTELLIGENCE about quote quality — never a profitability claim."],
  notExecutable: true,
  notProfitabilityClaim: true,
  neverSigns: true,
  neverSends: true,
  phase7LiveTradingReady: false,
};

describe("S99 engine quote score schema registry parity", () => {
  it("engine.routequote.score.report.v1 is registered (family engine, stable) with a typed view", () => {
    expect(isKnownSchema("engine.routequote.score.report.v1")).toBe(true);
    expect(hasTypedView("engine.routequote.score.report.v1")).toBe(true);
    const info = knownSchema("engine.routequote.score.report.v1");
    expect(info?.family).toBe("engine");
    expect(info?.stability).toBe("stable");
    expect(info?.cli).toBe("engine:quote:score");
    expect(schemaForCli("engine:quote:score")?.id).toBe("engine.routequote.score.report.v1");
  });

  it("the command reference lists engine:quote:score in the Rust engine group, never chain-reading", () => {
    const ref = COMMANDS.find((c) => c.command === "engine:quote:score");
    expect(ref).toBeDefined();
    expect(ref?.group).toBe("Rust engine (sidecar)");
    expect(ref?.readsChain).toBe(false);
    expect(ref?.summary).toContain("never a profitability claim");
  });
});

describe("engine.routequote.score.report.v1 typed view", () => {
  it("renders the intelligence framing, scoring facts, entry table, and caveats", () => {
    const html = typed(scoreBase);
    expect(html).toContain("never a profitability claim");
    expect(html).toContain("cand-usdc");
    expect(html).toContain("85");
    expect(html).toContain("excluded");
    expect(html).toContain("stale");
    expect(html).toContain("no default exists");
    expect(html).toContain("Raydium");
  });

  it("an artifact missing its safety literals renders the do-not-trust framing", () => {
    const html = typed({ ...scoreBase, notProfitabilityClaim: false });
    expect(html).toContain("do NOT trust this artifact");
  });

  it("a null best candidate renders honestly", () => {
    const html = typed({ ...scoreBase, bestCandidateId: null, ranking: [] });
    expect(html).toContain("none (no entry was both observed and fresh)");
  });

  it("hostile shapes never throw; hostile strings stay escaped", () => {
    expect(() => typed({ schemaVersion: "engine.routequote.score.report.v1", entries: "nope" })).not.toThrow();
    const html = typed({
      ...scoreBase,
      entries: [{ ...scoreBase.entries[0], candidateId: "<script>alert(1)</script>" }],
    });
    expect(html).not.toContain("<script>alert");
  });
});

// ---------------------------------------------------------------------------
// Sprint 100 — engine.tx.inspect.report.v1 + engine.sim.classification.report.v1
// ---------------------------------------------------------------------------

const txInspectBase = {
  schemaVersion: "engine.tx.inspect.report.v1",
  banner: "RUST ENGINE TX INSPECT — shape facts.",
  engineName: "solmaker-engine",
  engineVersion: "0.1.0",
  ipcVersion: "engine.ipc.v1",
  network: "devnet",
  feePayerPublicKey: "So11111111111111111111111111111111111111112",
  builderId: "test-builder",
  candidateMint: null,
  shape: {
    version: 0,
    versionSupported: true,
    blockhashPresent: true,
    instructionCount: 1,
    accountKeyCount: 2,
    staticProgramIds: ["11111111111111111111111111111111"],
    addressTableLookupCount: 0,
    unresolvableProgramIdCount: 0,
  },
  unsigned: true,
  createdAt: "2026-06-12T00:00:00.000Z",
  caveats: ["Shape facts only — the transaction body is never echoed."],
  notExecutable: true,
  neverSigns: true,
  neverSends: true,
  phase7LiveTradingReady: false,
};

const simClassBase = {
  schemaVersion: "engine.sim.classification.report.v1",
  banner: "RUST ENGINE SIM CLASSIFY — classification.",
  engineName: "solmaker-engine",
  engineVersion: "0.1.0",
  ipcVersion: "engine.ipc.v1",
  classification: "account-error",
  classificationMessage: "An account the transaction needs is missing, invalid, or underfunded.",
  classificationNextAction: "Check the wallet's balance and the token accounts involved, then rebuild.",
  errLabelPresent: true,
  logLineCount: 2,
  createdAt: "2026-06-12T00:00:00.000Z",
  caveats: ["Classification is derived ONLY from the error label and logs."],
  notExecutable: true,
  neverSigns: true,
  neverSends: true,
  phase7LiveTradingReady: false,
};

describe("S100 engine tx/sim schema registry parity", () => {
  it("both S100 schemas are registered (family engine, stable) with typed views", () => {
    for (const [id, cli] of [
      ["engine.tx.inspect.report.v1", "engine:tx:inspect"],
      ["engine.sim.classification.report.v1", "engine:sim:classify"],
    ] as const) {
      expect(isKnownSchema(id)).toBe(true);
      expect(hasTypedView(id)).toBe(true);
      const info = knownSchema(id);
      expect(info?.family).toBe("engine");
      expect(info?.stability).toBe("stable");
      expect(info?.cli).toBe(cli);
      expect(schemaForCli(cli)?.id).toBe(id);
    }
  });

  it("the command reference lists both S100 commands in the Rust engine group, never chain-reading", () => {
    for (const cmd of ["engine:tx:inspect", "engine:sim:classify"]) {
      const ref = COMMANDS.find((c) => c.command === cmd);
      expect(ref, cmd).toBeDefined();
      expect(ref?.group).toBe("Rust engine (sidecar)");
      expect(ref?.readsChain).toBe(false);
    }
  });
});

describe("engine.tx.inspect.report.v1 typed view", () => {
  it("renders the shape facts, fee payer, program ids, and caveats", () => {
    const html = typed(txInspectBase);
    expect(html).toContain("read-only");
    expect(html).toContain("So11111111111111111111111111111111111111112");
    expect(html).toContain("11111111111111111111111111111111");
    expect(html).toContain("supported");
    expect(html).toContain("present");
  });

  it("an unsupported version or not-proven-unsigned artifact renders the do-not-trust framing", () => {
    expect(typed({ ...txInspectBase, shape: { ...txInspectBase.shape, versionSupported: false } })).toContain("do NOT trust this artifact");
    expect(typed({ ...txInspectBase, unsigned: false })).toContain("do NOT trust this artifact");
  });

  it("hostile shapes never throw; hostile strings stay escaped", () => {
    expect(() => typed({ schemaVersion: "engine.tx.inspect.report.v1", shape: "nope" })).not.toThrow();
    const html = typed({ ...txInspectBase, builderId: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert");
  });
});

describe("engine.sim.classification.report.v1 typed view", () => {
  it("renders the classification, guidance, and caveats", () => {
    const html = typed(simClassBase);
    expect(html).toContain("never an execution signal");
    expect(html).toContain("account-error");
    expect(html).toContain("missing, invalid, or underfunded");
  });

  it("an artifact missing its safety literals renders the do-not-trust framing", () => {
    expect(typed({ ...simClassBase, neverSends: false })).toContain("do NOT trust this artifact");
  });

  it("hostile shapes never throw; hostile strings stay escaped", () => {
    expect(() => typed({ schemaVersion: "engine.sim.classification.report.v1", classification: 7 })).not.toThrow();
    const html = typed({ ...simClassBase, classificationMessage: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert");
  });
});

// ---------------------------------------------------------------------------
// S101 — engine.sniper.score.report.v1 (memecoin candidate scoring + ranking)
// ---------------------------------------------------------------------------

const candidateScoreFactKeys = {
  riskDecision: null, riskScore: null, riskCriticalFlagCount: null, riskHighFlagCount: null,
  freezeAuthorityPresent: null, mintAuthorityPresent: null, token2022Blocker: null, holderConcentrationRisk: null,
  metadataMutable: null, liquidityHint: null, quoteObserved: null, quoteScore: null, quoteFreshness: null,
  priceImpactHigh: null, simulationOutcome: null, simulationClassification: null, txBuildRefused: null,
};

const candidateScoreBase = {
  schemaVersion: "engine.sniper.score.report.v1",
  banner: "RUST ENGINE SNIPER CANDIDATE SCORES — fixture banner.",
  engineName: "solmaker-engine",
  engineVersion: "0.1.0",
  ipcVersion: "engine.ipc.v1",
  createdAt: "2026-06-13T12:00:00.000Z",
  scoringEngine: "solmaker-engine",
  engineSource: "rust",
  mode: "mainnet-dry-run",
  network: "mainnet-beta-readonly",
  candidateCount: 2,
  rankedCandidates: [
    {
      ...candidateScoreFactKeys, candidateId: "clean", mint: "So11111111111111111111111111111111111111112", source: "jupiter-recent-tokens",
      rank: 1, score: 97, verdict: "watch", reasonCodes: ["paper-only", "mainnet-live-disabled"],
      components: { riskSafety: 40, quoteQuality: 22, quoteFreshness: 10, liquidity: 10, tokenMechanics: 10, simulationEvidence: 5 },
      nextSafeAction: "watch-and-paper-dry-run",
      riskDecision: "PASS_FOR_PAPER_EVALUATION", quoteObserved: true, quoteScore: 90, quoteFreshness: "fresh", caveats: [],
    },
    {
      ...candidateScoreFactKeys, candidateId: "rejected", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", source: "operator",
      rank: 2, score: 55, verdict: "reject", reasonCodes: ["paper-only", "mainnet-live-disabled", "risk-rejected"],
      components: { riskSafety: 0, quoteQuality: 25, quoteFreshness: 10, liquidity: 10, tokenMechanics: 5, simulationEvidence: 5 },
      nextSafeAction: "do-not-proceed-risk-gate",
      riskDecision: "REJECT", freezeAuthorityPresent: true, quoteObserved: true, quoteScore: 100, quoteFreshness: "fresh", caveats: ["real freeze authority"],
    },
  ],
  ranking: ["clean", "rejected"],
  bestCandidateId: "clean",
  caveats: ["A candidate score is INTELLIGENCE about a candidate — fixture caveat."],
  redactionApplied: true,
  notExecutable: true,
  notProfitabilityClaim: true,
  neverSigns: true,
  neverSends: true,
  phase7LiveTradingReady: false,
  scoreIsNotLiveReadiness: true,
  highScoreIsNotSafeToTrade: true,
};

describe("S101 engine.sniper.score.report.v1 registry parity", () => {
  it("is registered with a typed view in the engine family", () => {
    expect(isKnownSchema("engine.sniper.score.report.v1")).toBe(true);
    expect(hasTypedView("engine.sniper.score.report.v1")).toBe(true);
    const info = knownSchema("engine.sniper.score.report.v1");
    expect(info?.family).toBe("engine");
    expect(info?.stability).toBe("stable");
    expect(info?.cli).toBe("engine:sniper:score");
    expect(schemaForCli("engine:sniper:score")?.id).toBe("engine.sniper.score.report.v1");
  });

  it("the command reference lists engine:sniper:score in the Rust engine group, never chain-reading", () => {
    const ref = COMMANDS.find((c) => c.command === "engine:sniper:score");
    expect(ref).toBeDefined();
    expect(ref?.group).toBe("Rust engine (sidecar)");
    expect(ref?.readsChain).toBe(false);
  });

  it("every catalogued schema id stays unique after the S101 addition", () => {
    const ids = KNOWN_REPORT_SCHEMAS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("engine.sniper.score.report.v1 typed view", () => {
  it("renders the intelligence-only framing, ranking, verdicts, and caveats", () => {
    const html = typed(candidateScoreBase);
    expect(html).toContain("operator intelligence only");
    expect(html).toContain("clean");
    expect(html).toContain("rejected");
    expect(html).toContain("watch");
    expect(html).toContain("reject");
    expect(html).toContain("97");
    expect(html).toContain("watch-and-paper-dry-run");
    expect(html).toContain("risk-rejected");
    expect(html).toContain("A candidate score is INTELLIGENCE about a candidate");
  });

  it("flips to do-NOT-trust framing when a safety literal is missing", () => {
    expect(typed({ ...candidateScoreBase, scoreIsNotLiveReadiness: false })).toContain("do NOT trust this artifact");
    expect(typed({ ...candidateScoreBase, highScoreIsNotSafeToTrade: false })).toContain("do NOT trust this artifact");
  });

  it("never throws on hostile shapes and never lets a hostile string escape", () => {
    expect(() => typed({ schemaVersion: "engine.sniper.score.report.v1", rankedCandidates: "nope" })).not.toThrow();
    const html = typed({ ...candidateScoreBase, network: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert");
  });
});
