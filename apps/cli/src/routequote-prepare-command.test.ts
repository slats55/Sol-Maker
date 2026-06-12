/**
 * Sprint 91 — `paper:routequote:prepare` (the READ-ONLY ROUTE QUOTE BRIDGE) plus the
 * `paper:simulation:route --quotes` and `paper:sniper:dry-run --routequote` seams it feeds.
 *
 * These tests pin:
 *   - prepare refusals: missing --candidates, malformed JSON, cross-kind files, unknown mints,
 *     duplicate observations, secret-shaped keys, --out overwrite;
 *   - prepare happy path: by-mint pairing, the production validator accepts the artifact, the
 *     mandatory caveats ride along, byte determinism, the exact next commands;
 *   - dry-run WITHOUT --routequote: route resolution stays the honest all-UNAVAILABLE boundary
 *     (byte-identical to the pre-S91 behavior for the same inputs);
 *   - dry-run WITH --routequote: the route artifact records the quote-derived label facts with
 *     provenance + the live-state caveat, the prepared artifact is carried into the out dir, the
 *     audit/handoff/bundle chain stays valid and mirrors the state, and output is deterministic;
 *   - fail-closed seams: a quotes file for a different candidate set refuses; a mint contradiction
 *     refuses; a BLOCKED chain (risk-rejected candidate) never applies quote facts.
 *
 * All mints are FICTIONAL fixture mints. Nothing here is live data, a trade signal, or a
 * profitability claim — an observed quote is an observation, never an executable.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FICTIONAL_MINT_A, FICTIONAL_MINT_B, validateSimulationRouteResolutionV1, validateSimulationIntentPlanV2 } from "@soulmaker/simulation";
import {
  ROUTE_QUOTE_OBSERVATION_INPUT_SCHEMA_VERSION,
  ROUTE_QUOTE_RESOLVER_ID,
  ROUTE_QUOTE_CAVEATS,
  validateRouteQuotePrepared,
} from "@soulmaker/routequote";
import type { PublicKeyInput, ReadOnlyClientConfig, ReadOnlySolanaClient } from "@soulmaker/solana";
import {
  paperRouteQuotePrepareReport,
  paperSniperPreflightInputPrepareReport,
  paperSniperDryRunReport,
  paperSimulationRouteReport,
  tokenInspectReport,
  tokenRiskReport,
} from "./commands.js";

const WSOL_MINT = "So11111111111111111111111111111111111111112";

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "rq-prepare-"));
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function withTmpAsync<T>(fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), "rq-prepare-"));
  try {
    return await fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** In-memory read-only client; mint B optionally carries a freeze authority (risk REJECT). */
function fakeSolanaClient(freezeOnB: boolean): ReadOnlySolanaClient {
  return {
    endpointHost: "rpc.example.com",
    getRpcHealth: async () => ({ ok: true, endpointHost: "rpc.example.com", solanaCore: "1.18.22", slot: 7 }),
    getVersion: async () => ({ solanaCore: "1.18.22" }),
    getSolBalance: async () => ({ ownerBase58: WSOL_MINT, lamports: 0, sol: 0 }),
    getTokenAccounts: async () => [],
    getTokenMintInfo: async (mint: PublicKeyInput) => {
      const m = typeof mint === "string" ? mint : mint.toBase58();
      return {
        mint: m,
        decimals: 6,
        supplyRaw: "1000000000",
        uiSupply: 1000,
        mintAuthorityPresent: false,
        freezeAuthorityPresent: freezeOnB && m === FICTIONAL_MINT_B,
        isInitialized: true,
        programLabel: "spl-token",
        source: "test",
      };
    },
  };
}

function readCtx(tmp: string, freezeOnB = false) {
  writeFileSync(
    join(tmp, "soulmaker.config.json"),
    JSON.stringify({ mode: "WATCH_ONLY", rpcUrl: "https://rpc.example.com" }, null, 2),
  );
  return { cwd: tmp, env: {}, createClient: (_config: ReadOnlyClientConfig) => fakeSolanaClient(freezeOnB) };
}

function writeCandidates(tmp: string): string {
  writeFileSync(
    join(tmp, "candidates.json"),
    JSON.stringify(
      {
        sourceLabel: "fictional-routequote-candidates",
        candidates: [
          { candidateId: "c-a", mint: FICTIONAL_MINT_A, symbol: "FICA", observedLiquidityUsd: 50000 },
          { candidateId: "c-b", mint: FICTIONAL_MINT_B, symbol: "FICB", observedLiquidityUsd: 45000 },
        ],
      },
      null,
      2,
    ),
  );
  return "candidates.json";
}

function observation(mint: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: ROUTE_QUOTE_OBSERVATION_INPUT_SCHEMA_VERSION,
    source: "operator-supplied",
    candidateMint: mint,
    quoteStatus: "quote-observed",
    inputMint: WSOL_MINT,
    outputMint: mint,
    amountInLabel: "0.05 SOL (paper units)",
    amountOutLabel: "12345 units (paper)",
    venueLabel: "fictional-amm",
    feeLabel: "0.3% pool fee (label only)",
    observedAtLabel: "rehearsal-session",
    ...overrides,
  };
}

function writeObservation(tmp: string, name: string, mint: string, overrides: Record<string, unknown> = {}): string {
  writeFileSync(join(tmp, name), JSON.stringify(observation(mint, overrides), null, 2));
  return name;
}

/** Generate inspect/risk fixtures through the PRODUCTION read-only commands, then the bridge. */
async function preparePreflightInput(tmp: string, freezeOnB = false): Promise<void> {
  const ctx = readCtx(tmp, freezeOnB);
  for (const [tag, mint] of [
    ["a", FICTIONAL_MINT_A],
    ["b", FICTIONAL_MINT_B],
  ] as const) {
    const insp = await tokenInspectReport(mint, ctx, { json: true, outPath: `${tag}.inspect.json` });
    expect(insp.startsWith("Refusing"), insp.slice(0, 200)).toBe(false);
    const risk = await tokenRiskReport(mint, ctx, { json: true, outPath: `${tag}.risk.json` });
    expect(risk.startsWith("Refusing"), risk.slice(0, 200)).toBe(false);
  }
  const prep = paperSniperPreflightInputPrepareReport(
    { cwd: tmp, env: {} },
    {
      candidatesPath: "candidates.json",
      inspectPaths: ["a.inspect.json", "b.inspect.json"],
      riskPaths: ["a.risk.json", "b.risk.json"],
      outPath: "pf.json",
    },
  );
  expect(prep.exitCode, prep.text.slice(0, 300)).toBe(0);
}

const readJson = (tmp: string, name: string): unknown => JSON.parse(readFileSync(join(tmp, name), "utf8"));

describe("paper:routequote:prepare — refusals (fail-closed, exit 1)", () => {
  it("requires --candidates", () => {
    const r = paperRouteQuotePrepareReport({}, { quotePaths: ["q.json"] });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/^Refusing: --candidates/);
  });

  it("refuses malformed JSON and a cross-kind --quote file", () => {
    withTmp((tmp) => {
      const cands = writeCandidates(tmp);
      writeFileSync(join(tmp, "broken.json"), "{nope");
      const a = paperRouteQuotePrepareReport({ cwd: tmp, env: {} }, { candidatesPath: cands, quotePaths: ["broken.json"] });
      expect(a.exitCode).toBe(1);
      expect(a.text.startsWith("Refusing:")).toBe(true);
      writeFileSync(join(tmp, "pf-shaped.json"), JSON.stringify({ schemaVersion: "sniper.preflight.input.v1" }));
      const b = paperRouteQuotePrepareReport({ cwd: tmp, env: {} }, { candidatesPath: cands, quotePaths: ["pf-shaped.json"] });
      expect(b.exitCode).toBe(1);
      expect(b.text).toContain("cross-kind");
    });
  });

  it("refuses an observation for an unknown mint and duplicate observations", () => {
    withTmp((tmp) => {
      const cands = writeCandidates(tmp);
      const stranger = writeObservation(tmp, "stranger.json", WSOL_MINT, { inputMint: FICTIONAL_MINT_A, outputMint: WSOL_MINT, candidateMint: WSOL_MINT });
      const a = paperRouteQuotePrepareReport({ cwd: tmp, env: {} }, { candidatesPath: cands, quotePaths: [stranger] });
      expect(a.exitCode).toBe(1);
      expect(a.text).toContain("unknown-mint");
      const q1 = writeObservation(tmp, "q1.json", FICTIONAL_MINT_A);
      const q2 = writeObservation(tmp, "q2.json", FICTIONAL_MINT_A, { venueLabel: "another-amm" });
      const b = paperRouteQuotePrepareReport({ cwd: tmp, env: {} }, { candidatesPath: cands, quotePaths: [q1, q2] });
      expect(b.exitCode).toBe(1);
      expect(b.text).toContain("duplicates mint");
    });
  });

  it("refuses a secret-shaped key in a --quote file (never bridged)", () => {
    withTmp((tmp) => {
      const cands = writeCandidates(tmp);
      const q = writeObservation(tmp, "q.json", FICTIONAL_MINT_A, { apiKey: "x" });
      const r = paperRouteQuotePrepareReport({ cwd: tmp, env: {} }, { candidatesPath: cands, quotePaths: [q] });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("secret-shaped key");
    });
  });

  it("refuses to overwrite an existing --out without --force", () => {
    withTmp((tmp) => {
      const cands = writeCandidates(tmp);
      const q = writeObservation(tmp, "q.json", FICTIONAL_MINT_A);
      const opts = { candidatesPath: cands, quotePaths: [q], outPath: "rq.json" };
      expect(paperRouteQuotePrepareReport({ cwd: tmp, env: {} }, opts).exitCode).toBe(0);
      const again = paperRouteQuotePrepareReport({ cwd: tmp, env: {} }, opts);
      expect(again.exitCode).toBe(1);
      expect(again.text).toContain("already exists");
      expect(paperRouteQuotePrepareReport({ cwd: tmp, env: {} }, { ...opts, force: true }).exitCode).toBe(0);
    });
  });
});

describe("paper:routequote:prepare — happy path", () => {
  it("pairs by mint, validates, carries the mandatory caveats, and prints the next commands", () => {
    withTmp((tmp) => {
      const cands = writeCandidates(tmp);
      const q = writeObservation(tmp, "q.json", FICTIONAL_MINT_A);
      const r = paperRouteQuotePrepareReport(
        { cwd: tmp, env: {} },
        { candidatesPath: cands, quotePaths: [q], outPath: "rq.json" },
      );
      expect(r.exitCode, r.text.slice(0, 300)).toBe(0);
      expect(r.text).toContain("Next:");
      expect(r.text).toContain("paper:sniper:dry-run --candidates");
      expect(r.text).toContain("--routequote");
      expect(r.text).toContain("paper:simulation:route --plan");

      const artifact = validateRouteQuotePrepared(readJson(tmp, "rq.json"));
      expect(artifact.resolverId).toBe(ROUTE_QUOTE_RESOLVER_ID);
      expect(artifact.entryCount).toBe(2);
      expect(artifact.observedCount).toBe(1);
      expect(artifact.unavailableCount).toBe(1);
      const a = artifact.entries.find((e) => e.candidateId === "c-a")!;
      expect(a.caveats).toEqual([...ROUTE_QUOTE_CAVEATS]);
      expect(a.routeLabel).toContain("NOT executable");
      expect(artifact.phase7LiveTradingReady).toBe(false);
    });
  });

  it("writes a byte-deterministic artifact across two runs and matches --json", () => {
    withTmp((tmp) => {
      const cands = writeCandidates(tmp);
      const q = writeObservation(tmp, "q.json", FICTIONAL_MINT_A);
      const opts = { candidatesPath: cands, quotePaths: [q] };
      paperRouteQuotePrepareReport({ cwd: tmp, env: {} }, { ...opts, outPath: "rq1.json" });
      paperRouteQuotePrepareReport({ cwd: tmp, env: {} }, { ...opts, outPath: "rq2.json" });
      expect(readFileSync(join(tmp, "rq1.json"), "utf8")).toBe(readFileSync(join(tmp, "rq2.json"), "utf8"));
      const j = paperRouteQuotePrepareReport({ cwd: tmp, env: {} }, { ...opts, json: true });
      expect(JSON.parse(j.text)).toEqual(readJson(tmp, "rq1.json"));
    });
  });

  it("gates make missing/non-observed quotes loud on demand", () => {
    withTmp((tmp) => {
      const cands = writeCandidates(tmp);
      const q = writeObservation(tmp, "q.json", FICTIONAL_MINT_A);
      expect(
        paperRouteQuotePrepareReport({ cwd: tmp, env: {} }, { candidatesPath: cands, quotePaths: [q], failOnMissingQuote: true }).exitCode,
      ).toBe(1);
      expect(
        paperRouteQuotePrepareReport({ cwd: tmp, env: {} }, { candidatesPath: cands, quotePaths: [q], failOnNotObserved: true }).exitCode,
      ).toBe(1);
      expect(
        paperRouteQuotePrepareReport({ cwd: tmp, env: {} }, { candidatesPath: cands, quotePaths: [q], failOnWarning: true }).exitCode,
      ).toBe(1);
    });
  });
});

describe("paper:sniper:dry-run — routequote integration", () => {
  const dryRunOpts = (routequote: boolean) => ({
    candidatesPath: "candidates.json",
    preflightInputPath: "pf.json",
    ...(routequote ? { routequotePath: "rq.json" } : {}),
    adoptSpecs: true,
    acknowledgePaperEnterReview: true,
    operatorLabel: "fictional-operator",
    runLabel: "fictional-routequote-run",
    outDir: routequote ? "out-rq" : "out-plain",
  });

  it("WITHOUT --routequote the route stage stays the honest all-UNAVAILABLE boundary", async () => {
    await withTmpAsync(async (tmp) => {
      writeCandidates(tmp);
      await preparePreflightInput(tmp);
      const dry = paperSniperDryRunReport({ cwd: tmp, env: {} }, dryRunOpts(false));
      expect(dry.exitCode, dry.text.slice(0, 300)).toBe(0);
      const route = validateSimulationRouteResolutionV1(readJson(tmp, join("out-plain", "route-resolution.json")));
      expect(route.routeResolverAttempted).toBe(false);
      expect(route.resolutionStatus).toBe("unavailable");
      expect(route.liveStateCaveat).toBe(false);
    });
  });

  it("WITH --routequote the route artifact carries quote facts + caveat through the whole chain", async () => {
    await withTmpAsync(async (tmp) => {
      writeCandidates(tmp);
      await preparePreflightInput(tmp);
      writeObservation(tmp, "qa.json", FICTIONAL_MINT_A);
      writeObservation(tmp, "qb.json", FICTIONAL_MINT_B);
      const prep = paperRouteQuotePrepareReport(
        { cwd: tmp, env: {} },
        { candidatesPath: "candidates.json", quotePaths: ["qa.json", "qb.json"], outPath: "rq.json" },
      );
      expect(prep.exitCode, prep.text.slice(0, 300)).toBe(0);

      const dry = paperSniperDryRunReport({ cwd: tmp, env: {} }, dryRunOpts(true));
      expect(dry.exitCode, dry.text.slice(0, 600)).toBe(0);
      expect(dry.text).toContain("routequote-prepared.json");

      // The plan is unblocked with 2 entries; the route artifact records the quote facts.
      const plan = validateSimulationIntentPlanV2(readJson(tmp, join("out-rq", "intent-plan.json")));
      expect(plan.blocked).toBe(false);
      const route = validateSimulationRouteResolutionV1(readJson(tmp, join("out-rq", "route-resolution.json")));
      expect(route.routeResolverId).toBe(ROUTE_QUOTE_RESOLVER_ID);
      expect(route.routeResolverAttempted).toBe(true);
      expect(route.resolutionStatus).toBe("unresolved"); // destination facts stay honestly unresolved
      expect(route.liveStateCaveat).toBe(true);
      expect(route.phase7LiveTradingReady).toBe(false);
      for (const e of route.entries) {
        expect(e.routePreview.status).toBe("resolved-as-label");
        expect(e.routePreview.label).toContain("NOT executable");
        expect(e.unresolvedFields).toContain("destination");
      }

      // The prepared artifact rides VERBATIM in the out dir and still validates.
      const carried = validateRouteQuotePrepared(readJson(tmp, join("out-rq", "routequote-prepared.json")));
      expect(carried.observedCount).toBe(2);

      // The bundle mirrors the state honestly; the chain audit accepted the route artifact.
      const bundle = readJson(tmp, join("out-rq", "operator-bundle.json")) as Record<string, unknown>;
      expect(bundle.routeResolutionStatus).toBe("unresolved");
      expect(bundle.routeResolverAttempted).toBe(true);
      expect(bundle.routeLiveStateCaveat).toBe(true);
      expect(bundle.phase7LiveTradingReady).toBe(false);

      // RUN_SUMMARY surfaces the quote provenance honestly.
      const summary = readFileSync(join(tmp, "out-rq", "RUN_SUMMARY.md"), "utf8");
      expect(summary).toContain("Route quote provenance");
      expect(summary).toContain("never executable");
    });
  });

  it("dry-run --routequote output is deterministic (byte-identical route artifacts across runs)", async () => {
    await withTmpAsync(async (tmp) => {
      writeCandidates(tmp);
      await preparePreflightInput(tmp);
      writeObservation(tmp, "qa.json", FICTIONAL_MINT_A);
      const prep = paperRouteQuotePrepareReport(
        { cwd: tmp, env: {} },
        { candidatesPath: "candidates.json", quotePaths: ["qa.json"], outPath: "rq.json" },
      );
      expect(prep.exitCode).toBe(0);
      const base = dryRunOpts(true);
      const r1 = paperSniperDryRunReport({ cwd: tmp, env: {} }, { ...base, outDir: "o1" });
      const r2 = paperSniperDryRunReport({ cwd: tmp, env: {} }, { ...base, outDir: "o2" });
      expect(r1.exitCode).toBe(0);
      expect(r2.exitCode).toBe(0);
      for (const f of ["route-resolution.json", "routequote-prepared.json", "operator-bundle.json", "RUN_SUMMARY.md"]) {
        expect(readFileSync(join(tmp, "o1", f), "utf8")).toBe(readFileSync(join(tmp, "o2", f), "utf8"));
      }
    });
  });

  it("FAILS CLOSED: a routequote prepared for a DIFFERENT candidate set refuses", async () => {
    await withTmpAsync(async (tmp) => {
      writeCandidates(tmp);
      await preparePreflightInput(tmp);
      // Prepare quotes against a one-candidate list, then run dry-run over the two-candidate list.
      writeFileSync(
        join(tmp, "candidates-other.json"),
        JSON.stringify({
          sourceLabel: "other",
          candidates: [{ candidateId: "c-a", mint: FICTIONAL_MINT_A, symbol: "FICA" }],
        }),
      );
      writeObservation(tmp, "qa.json", FICTIONAL_MINT_A);
      const prep = paperRouteQuotePrepareReport(
        { cwd: tmp, env: {} },
        { candidatesPath: "candidates-other.json", quotePaths: ["qa.json"], outPath: "rq.json" },
      );
      expect(prep.exitCode).toBe(0);
      const dry = paperSniperDryRunReport({ cwd: tmp, env: {} }, dryRunOpts(true));
      expect(dry.exitCode).toBe(1);
      expect(dry.text).toContain("does not cover candidate(s)");
    });
  });

  it("FAILS CLOSED: a tampered routequote artifact refuses (validator backstop)", async () => {
    await withTmpAsync(async (tmp) => {
      writeCandidates(tmp);
      await preparePreflightInput(tmp);
      writeObservation(tmp, "qa.json", FICTIONAL_MINT_A);
      writeObservation(tmp, "qb.json", FICTIONAL_MINT_B);
      const prep = paperRouteQuotePrepareReport(
        { cwd: tmp, env: {} },
        { candidatesPath: "candidates.json", quotePaths: ["qa.json", "qb.json"], outPath: "rq.json" },
      );
      expect(prep.exitCode).toBe(0);
      const tampered = readJson(tmp, "rq.json") as { entries: Array<{ routeLabel: string | null }> };
      tampered.entries[0]!.routeLabel = "executable route via mega-dex";
      writeFileSync(join(tmp, "rq.json"), JSON.stringify(tampered, null, 2));
      const dry = paperSniperDryRunReport({ cwd: tmp, env: {} }, dryRunOpts(true));
      expect(dry.exitCode).toBe(1);
      expect(dry.text).toContain("recomputed deterministic label");
    });
  });

  it("a BLOCKED chain (risk-rejected candidate) never applies quote facts — quotes cannot unblock", async () => {
    await withTmpAsync(async (tmp) => {
      writeCandidates(tmp);
      await preparePreflightInput(tmp, true); // freeze authority on FICB → critical risk REJECT
      writeObservation(tmp, "qa.json", FICTIONAL_MINT_A);
      writeObservation(tmp, "qb.json", FICTIONAL_MINT_B);
      const prep = paperRouteQuotePrepareReport(
        { cwd: tmp, env: {} },
        { candidatesPath: "candidates.json", quotePaths: ["qa.json", "qb.json"], outPath: "rq.json" },
      );
      expect(prep.exitCode).toBe(0);
      const dry = paperSniperDryRunReport({ cwd: tmp, env: {} }, dryRunOpts(true));
      expect(dry.exitCode, dry.text.slice(0, 600)).toBe(0); // blocked chain is the honest record
      const plan = readJson(tmp, join("out-rq", "intent-plan.json")) as { blocked: boolean };
      expect(plan.blocked).toBe(true);
      const route = validateSimulationRouteResolutionV1(readJson(tmp, join("out-rq", "route-resolution.json")));
      expect(route.blocked).toBe(true);
      expect(route.routeResolverAttempted).toBe(false);
      expect(route.entries).toEqual([]);
      expect(route.liveStateCaveat).toBe(false);
    });
  });
});

describe("paper:simulation:route --quotes (standalone seam)", () => {
  it("applies observed facts to a real plan and reports skipped non-plan quotes", async () => {
    await withTmpAsync(async (tmp) => {
      writeCandidates(tmp);
      await preparePreflightInput(tmp);
      // Build a real plan via the dry-run, then use the standalone route command over it.
      const dry = paperSniperDryRunReport(
        { cwd: tmp, env: {} },
        {
          candidatesPath: "candidates.json",
          preflightInputPath: "pf.json",
          adoptSpecs: true,
          acknowledgePaperEnterReview: true,
          operatorLabel: "fictional-operator",
          runLabel: "plan-source",
          outDir: "plain",
        },
      );
      expect(dry.exitCode).toBe(0);
      writeObservation(tmp, "qa.json", FICTIONAL_MINT_A);
      const prep = paperRouteQuotePrepareReport(
        { cwd: tmp, env: {} },
        { candidatesPath: "candidates.json", quotePaths: ["qa.json"], outPath: "rq.json" },
      );
      expect(prep.exitCode).toBe(0);

      const r = paperSimulationRouteReport(
        { cwd: tmp, env: {} },
        { planPath: join("plain", "intent-plan.json"), quotesPath: "rq.json", outPath: "route.json" },
      );
      expect(r.exitCode, r.text.slice(0, 300)).toBe(0);
      expect(r.text).toContain("Quotes: 1 observed label fact(s) applied");
      const route = validateSimulationRouteResolutionV1(readJson(tmp, "route.json"));
      expect(route.routeResolverAttempted).toBe(true);
      const ea = route.entries.find((e) => e.candidateId === "c-a")!;
      expect(ea.routePreview.status).toBe("resolved-as-label");
      const eb = route.entries.find((e) => e.candidateId === "c-b")!;
      expect(eb.routePreview.status).toBe("unresolved");
      expect(eb.operatorText).toContain("observed no quote");
    });
  });

  it("refuses a quotes file that does not cover the plan's candidates", async () => {
    await withTmpAsync(async (tmp) => {
      writeCandidates(tmp);
      await preparePreflightInput(tmp);
      const dry = paperSniperDryRunReport(
        { cwd: tmp, env: {} },
        {
          candidatesPath: "candidates.json",
          preflightInputPath: "pf.json",
          adoptSpecs: true,
          acknowledgePaperEnterReview: true,
          operatorLabel: "fictional-operator",
          runLabel: "plan-source",
          outDir: "plain",
        },
      );
      expect(dry.exitCode).toBe(0);
      writeFileSync(
        join(tmp, "candidates-other.json"),
        JSON.stringify({ sourceLabel: "other", candidates: [{ candidateId: "c-a", mint: FICTIONAL_MINT_A, symbol: "FICA" }] }),
      );
      writeObservation(tmp, "qa.json", FICTIONAL_MINT_A);
      const prep = paperRouteQuotePrepareReport(
        { cwd: tmp, env: {} },
        { candidatesPath: "candidates-other.json", quotePaths: ["qa.json"], outPath: "rq.json" },
      );
      expect(prep.exitCode).toBe(0);
      const r = paperSimulationRouteReport(
        { cwd: tmp, env: {} },
        { planPath: join("plain", "intent-plan.json"), quotesPath: "rq.json" },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("no entry for plan candidate");
    });
  });
});
