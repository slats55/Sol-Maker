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
