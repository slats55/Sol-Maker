/**
 * Sprint 105-A — CLI tests for the live-read-only auto campaign, the campaign diff, and the alpha
 * report. Every test runs OFFLINE (no --allow-readonly-network) with the Rust engine forced absent
 * (`engineBinaryExists: () => false`), so the runs are deterministic and NO network / signer / send
 * is ever touched. Risk is driven by ingested token:risk fixtures.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateSniperReadonlyCampaignPlan,
  validateSniperDryRunCampaign,
  validateSniperAlphaRunReport,
  validateSniperDryRunCampaignDiff,
  validateSniperProviderHealthReport,
  buildSniperProviderHealthReport,
  type SniperProviderHealthCheckInput,
} from "@soulmaker/sniper";
import { createJupiterQuoteAdapter, type FetchLike, type QuoteProviderAdapter } from "@soulmaker/quotefetch";
import type { ReadOnlyClientConfig, ReadOnlySolanaClient, RpcHealth } from "@soulmaker/solana";
import type { EngineProcessRunner } from "@soulmaker/engine-bridge";
import {
  paperSniperCampaignAutoRunReport,
  paperSniperCampaignDiffReport,
  paperSniperAlphaReportReport,
} from "./commands.js";

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

// Force the Rust engine absent so candidate scoring is honestly unavailable (deterministic, no spawn).
const ctx = { engineBinaryExists: () => false };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "alpha-cli-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, value: unknown): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(value, null, 2) + "\n");
  return p;
}

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(dir, name), "utf8"));
}

const candidates = (mints: string[]) => write("candidates.json", { candidates: mints.map((m) => ({ candidateId: m.slice(0, 6), mint: m })) });
const riskFixture = (name: string, decision: string, flags: Array<{ id: string; severity: string }> = []) => write(name, { decision, flags });

describe("paper:sniper:campaign:auto-run — offline alpha run", () => {
  it("writes the plan, campaign, alpha report, evidence index and RUN_SUMMARY; all validate", async () => {
    const candidatesPath = candidates([WSOL, USDC]);
    const out = join(dir, "alpha");
    const passRisk = riskFixture("risk.wsol.json", "PASS_FOR_PAPER_EVALUATION");
    const rejectRisk = riskFixture("risk.usdc.json", "REJECT", [{ id: "freeze-authority", severity: "critical" }]);
    const { text, exitCode } = await paperSniperCampaignAutoRunReport(ctx, {
      candidatesPath,
      risks: [`${WSOL}=${passRisk}`, `${USDC}=${rejectRisk}`],
      outDir: out,
      runId: "alpha-test",
    });
    expect(exitCode).toBe(0);
    expect(text).toContain("LIVE TRADING IS DISABLED");
    for (const f of ["readonly-campaign-plan.json", "campaign.json", "alpha-report.json", "evidence-index.json", "RUN_SUMMARY.md"]) {
      expect(existsSync(join(out, f)), f).toBe(true);
    }
    const plan = validateSniperReadonlyCampaignPlan(JSON.parse(readFileSync(join(out, "readonly-campaign-plan.json"), "utf8")));
    expect(plan.providerPolicy).toBe("operator-supplied-only");
    expect(plan.noSend).toBe(true);
    const campaign = validateSniperDryRunCampaign(JSON.parse(readFileSync(join(out, "campaign.json"), "utf8")));
    expect(campaign.candidateCount).toBe(2);
    expect(campaign.liveSendStatus).toBe("disabled");
    const alpha = validateSniperAlphaRunReport(JSON.parse(readFileSync(join(out, "alpha-report.json"), "utf8")));
    expect(alpha.liveTradingStatus).toBe("disabled");
    expect(alpha.authorizesLiveTrading).toBe(false);
  });

  it("blocks a REJECT-risk candidate AND skips its quote/build/simulation stages", async () => {
    const candidatesPath = candidates([WSOL, USDC]);
    const out = join(dir, "alpha");
    const rejectRisk = riskFixture("risk.usdc.json", "REJECT", [{ id: "freeze-authority", severity: "critical" }]);
    const passRisk = riskFixture("risk.wsol.json", "PASS_FOR_PAPER_EVALUATION");
    await paperSniperCampaignAutoRunReport(ctx, {
      candidatesPath,
      mode: "mainnet-dry-run",
      // network OFF on purpose — but a REJECT risk fixture is ingested.
      risks: [`${USDC}=${rejectRisk}`, `${WSOL}=${passRisk}`],
      outDir: out,
    });
    const campaign = validateSniperDryRunCampaign(JSON.parse(readFileSync(join(out, "campaign.json"), "utf8")));
    const usdc = campaign.candidates.find((c) => c.mint === USDC)!;
    expect(usdc.finalOperatorVerdict).toBe("blocked");
    // No network -> quote/build/sim never attempted (recorded as null).
    expect(usdc.quoteStatus).toBeNull();
    expect(usdc.buildStatus).toBeNull();
    expect(usdc.simulationStatus).toBeNull();
    // The evidence index records the honest not-attempted / skip.
    const index = readJson("alpha/evidence-index.json") as { candidates: Array<{ mint: string; stages: Array<{ stage: string; status: string }> }> };
    const usdcEv = index.candidates.find((c) => c.mint === USDC)!;
    expect(usdcEv.stages.some((s) => s.stage === "quote-fetch" && s.status === "not-attempted")).toBe(true);
  });

  it("records Rust candidate scoring as honestly unavailable when the engine is absent", async () => {
    const candidatesPath = candidates([WSOL]);
    const out = join(dir, "alpha");
    await paperSniperCampaignAutoRunReport(ctx, { candidatesPath, outDir: out });
    const alpha = validateSniperAlphaRunReport(JSON.parse(readFileSync(join(out, "alpha-report.json"), "utf8")));
    expect(alpha.rustEngineStatus).toBe("unavailable");
    const index = readJson("alpha/evidence-index.json") as { candidates: Array<{ stages: Array<{ stage: string; status: string }> }> };
    expect(index.candidates[0]!.stages.some((s) => s.stage === "candidate-score" && s.status === "unavailable")).toBe(true);
  });

  it("records provider/network stages as not-attempted when read-only network is off", async () => {
    const candidatesPath = candidates([WSOL]);
    const out = join(dir, "alpha");
    await paperSniperCampaignAutoRunReport(ctx, { candidatesPath, outDir: out });
    const alpha = validateSniperAlphaRunReport(JSON.parse(readFileSync(join(out, "alpha-report.json"), "utf8")));
    expect(alpha.providerHealthSummary.quote).toBe("not-attempted");
    expect(alpha.providerHealthSummary.simulation).toBe("not-attempted");
    expect(alpha.evidenceProvenance).toBe("mixed");
  });

  it("ingests an operator score and marks rust not-used", async () => {
    const candidatesPath = candidates([WSOL]);
    const out = join(dir, "alpha");
    const scorePath = write("scores.json", {
      schemaVersion: "engine.sniper.score.report.v1",
      rankedCandidates: [{ candidateId: "wsol", mint: WSOL, rank: 1, score: 88 }],
    });
    await paperSniperCampaignAutoRunReport(ctx, { candidatesPath, scorePath, outDir: out });
    const campaign = validateSniperDryRunCampaign(JSON.parse(readFileSync(join(out, "campaign.json"), "utf8")));
    expect(campaign.candidates[0]!.score).toBe(88);
    const alpha = validateSniperAlphaRunReport(JSON.parse(readFileSync(join(out, "alpha-report.json"), "utf8")));
    expect(alpha.rustEngineStatus).toBe("not-used");
  });

  it("enforces the candidate limit", async () => {
    const candidatesPath = candidates([WSOL, USDC, BONK]);
    const out = join(dir, "alpha");
    await paperSniperCampaignAutoRunReport(ctx, { candidatesPath, limit: 1, outDir: out });
    const campaign = validateSniperDryRunCampaign(JSON.parse(readFileSync(join(out, "campaign.json"), "utf8")));
    expect(campaign.candidateCount).toBe(1);
    const plan = validateSniperReadonlyCampaignPlan(JSON.parse(readFileSync(join(out, "readonly-campaign-plan.json"), "utf8")));
    expect(plan.candidateLimit).toBe(1);
  });

  it("refuses without --out, refuses both spines, refuses an unknown mode", async () => {
    expect((await paperSniperCampaignAutoRunReport(ctx, { candidatesPath: candidates([WSOL]) })).exitCode).toBe(1);
    expect((await paperSniperCampaignAutoRunReport(ctx, { candidatesPath: "a", watchlistPath: "b", outDir: join(dir, "x") })).exitCode).toBe(1);
    expect((await paperSniperCampaignAutoRunReport(ctx, { candidatesPath: candidates([WSOL]), mode: "mainnet-live", outDir: join(dir, "x") })).exitCode).toBe(1);
  });

  it("refuses to overwrite an existing alpha folder without --force", async () => {
    const candidatesPath = candidates([WSOL]);
    const out = join(dir, "alpha");
    await paperSniperCampaignAutoRunReport(ctx, { candidatesPath, outDir: out });
    const second = await paperSniperCampaignAutoRunReport(ctx, { candidatesPath, outDir: out });
    expect(second.exitCode).toBe(1);
    expect(second.text).toContain("already exists");
    const forced = await paperSniperCampaignAutoRunReport(ctx, { candidatesPath, outDir: out, force: true });
    expect(forced.exitCode).toBe(0);
  });
});

// --- Sprint 105-B: provider health integration --------------------------------

const providerHealthFixture = (name: string, checks: SniperProviderHealthCheckInput[]): string =>
  write(name, buildSniperProviderHealthReport({ reportId: "fixture", mode: "mainnet-dry-run", checks }));

/** A ctx whose injected seams let --check-providers probe without any real network. */
function doctorCtx(opts: { rpc?: "ok" | "down"; jupiter?: "ok" | "down" }) {
  const fetchLike: FetchLike = async () => {
    if (opts.jupiter === "down") throw new Error("network error");
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ inputMint: WSOL, inAmount: "1000000", outputMint: USDC, outAmount: "142000", otherAmountThreshold: "141000", priceImpactPct: "0.01", routePlan: [{ swapInfo: { label: "V" } }], contextSlot: 1 }),
    };
  };
  return {
    engineBinaryExists: () => false,
    createEngineRunner: (): EngineProcessRunner => ({
      run: () => Promise.resolve({ started: false, startError: "ENOENT", exitCode: null, timedOut: false, stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false }),
    }),
    createClient: (config: ReadOnlyClientConfig) =>
      ({
        endpointHost: "f",
        getRpcHealth: async (): Promise<RpcHealth> =>
          (opts.rpc === "down" ? { ok: false, endpointHost: config.rpcUrl, error: "connection refused" } : { ok: true, endpointHost: config.rpcUrl, solanaCore: "1.18.0", featureSet: 1, slot: 1 }) as RpcHealth,
      }) as unknown as ReadOnlySolanaClient,
    createQuoteAdapter: (): QuoteProviderAdapter => createJupiterQuoteAdapter({ fetchLike }),
  };
}

describe("paper:sniper:campaign:auto-run — provider health (S105-B)", () => {
  it("ingests --provider-health, writes provider-health.json, and folds it into the alpha summary", async () => {
    const candidatesPath = candidates([WSOL]);
    const out = join(dir, "alpha");
    const ph = providerHealthFixture("ph.json", [
      { provider: "rpc", status: "available" },
      { provider: "jupiter-quote", status: "available" },
      { provider: "simulation", status: "available" },
    ]);
    const { exitCode } = await paperSniperCampaignAutoRunReport(ctx, { candidatesPath, providerHealthPath: ph, outDir: out, risks: [`${WSOL}=${riskFixture("r.json", "PASS_FOR_PAPER_EVALUATION")}`] });
    expect(exitCode).toBe(0);
    expect(existsSync(join(out, "provider-health.json"))).toBe(true);
    validateSniperProviderHealthReport(JSON.parse(readFileSync(join(out, "provider-health.json"), "utf8")));
    const alpha = validateSniperAlphaRunReport(JSON.parse(readFileSync(join(out, "alpha-report.json"), "utf8")));
    expect(alpha.providerHealthSummary.risk).toBe("ok");
    expect(alpha.providerHealthSummary.quote).toBe("ok");
    expect(alpha.providerHealthSummary.simulation).toBe("ok");
    expect(alpha.artifactRefs).toContain("provider-health.json");
  });

  it("when provider health says unavailable, the live network stages are SKIPPED honestly (no network touched)", async () => {
    const candidatesPath = candidates([WSOL]);
    const out = join(dir, "alpha");
    const ph = providerHealthFixture("ph.json", [
      { provider: "rpc", status: "unavailable" },
      { provider: "jupiter-quote", status: "unavailable" },
    ]);
    // networkActive is ON, but the unavailable provider health gates the stages off (no createClient seam,
    // so if it tried to reach the network the test would hang/fail — it doesn't, proving the gate).
    const { exitCode } = await paperSniperCampaignAutoRunReport(ctx, {
      candidatesPath,
      mode: "mainnet-dry-run",
      allowReadonlyNetwork: true,
      providerHealthPath: ph,
      outDir: out,
    });
    expect(exitCode).toBe(0);
    const index = readJson("alpha/evidence-index.json") as { candidates: Array<{ stages: Array<{ stage: string; status: string }> }> };
    const stages = index.candidates[0]!.stages;
    expect(stages.some((s) => s.stage === "deep-risk" && s.status === "skipped")).toBe(true);
    expect(stages.some((s) => s.stage === "quote-fetch" && s.status === "skipped")).toBe(true);
    const alpha = validateSniperAlphaRunReport(JSON.parse(readFileSync(join(out, "alpha-report.json"), "utf8")));
    expect(alpha.providerHealthSummary.risk).toBe("unavailable");
    expect(alpha.providerHealthSummary.quote).toBe("unavailable");
    expect(alpha.liveTradingStatus).toBe("disabled");
  });

  it("--check-providers probes (injected seams), writes provider-health.json, and reflects it", async () => {
    const candidatesPath = candidates([WSOL]);
    const out = join(dir, "alpha");
    const { exitCode } = await paperSniperCampaignAutoRunReport(doctorCtx({ rpc: "ok", jupiter: "ok" }), {
      candidatesPath,
      checkProviders: true,
      outDir: out,
    });
    expect(exitCode).toBe(0);
    const health = validateSniperProviderHealthReport(JSON.parse(readFileSync(join(out, "provider-health.json"), "utf8")));
    expect(health.canRunLiveReadonlyCampaign).toBe(true);
    expect(health.noSend).toBe(true);
    const alpha = validateSniperAlphaRunReport(JSON.parse(readFileSync(join(out, "alpha-report.json"), "utf8")));
    expect(alpha.providerHealthSummary.risk).toBe("ok");
    expect(alpha.providerHealthSummary.quote).toBe("ok");
  });

  it("--check-providers records an unreachable RPC and gates the live stages off", async () => {
    const candidatesPath = candidates([WSOL]);
    const out = join(dir, "alpha");
    await paperSniperCampaignAutoRunReport(doctorCtx({ rpc: "down", jupiter: "ok" }), {
      candidatesPath,
      mode: "mainnet-dry-run",
      allowReadonlyNetwork: true,
      checkProviders: true,
      outDir: out,
    });
    const health = validateSniperProviderHealthReport(JSON.parse(readFileSync(join(out, "provider-health.json"), "utf8")));
    expect(health.canRunLiveReadonlyCampaign).toBe(false);
    const index = readJson("alpha/evidence-index.json") as { candidates: Array<{ stages: Array<{ stage: string; status: string }> }> };
    expect(index.candidates[0]!.stages.some((s) => s.stage === "deep-risk" && s.status === "skipped")).toBe(true);
  });

  it("refuses --provider-health together with --check-providers", async () => {
    const candidatesPath = candidates([WSOL]);
    const ph = providerHealthFixture("ph.json", [{ provider: "rpc", status: "available" }]);
    const r = await paperSniperCampaignAutoRunReport(ctx, { candidatesPath, providerHealthPath: ph, checkProviders: true, outDir: join(dir, "alpha") });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/mutually exclusive/);
  });

  it("refuses a provider-health file with the wrong schema", async () => {
    const candidatesPath = candidates([WSOL]);
    const bad = write("bad.json", { schemaVersion: "not.the.schema", checks: [] });
    const r = await paperSniperCampaignAutoRunReport(ctx, { candidatesPath, providerHealthPath: bad, outDir: join(dir, "alpha") });
    expect(r.exitCode).toBe(1);
  });
});

// --- Sprint 105-C: deep-risk honors --rpc-url (consistency with provider:doctor + simulation) -----

describe("paper:sniper:campaign:auto-run — deep-risk honors --rpc-url (S105-C)", () => {
  /** A read-only client that records the endpoint it was built with and reads a clean mint. */
  function endpointCaptureClient(config: ReadOnlyClientConfig, seen: string[]): ReadOnlySolanaClient {
    seen.push(config.rpcUrl);
    const host = new URL(config.rpcUrl).host;
    return {
      endpointHost: host,
      getRpcHealth: async (): Promise<RpcHealth> => ({ ok: true, endpointHost: host }) as RpcHealth,
      getVersion: async () => ({ solanaCore: "test" }),
      getSolBalance: async () => ({ ownerBase58: WSOL, lamports: 0, sol: 0 }),
      getTokenAccounts: async () => [],
      getTokenMintInfo: async (mint: string | { toBase58(): string }) => ({
        mint: typeof mint === "string" ? mint : mint.toBase58(),
        decimals: 9,
        supplyRaw: "1000",
        uiSupply: 1000,
        mintAuthorityPresent: false,
        freezeAuthorityPresent: false,
        isInitialized: true,
        programLabel: "spl-token",
        source: "test",
      }),
    } as unknown as ReadOnlySolanaClient;
  }

  /** A ctx with a WATCH_ONLY config (fallback endpoint on disk) and an endpoint-capturing client. */
  function captureCtx(seen: string[], configRpcUrl: string) {
    writeFileSync(join(dir, "soulmaker.config.json"), JSON.stringify({ mode: "WATCH_ONLY", rpcUrl: configRpcUrl }));
    return {
      cwd: dir,
      env: {},
      engineBinaryExists: () => false,
      createClient: (config: ReadOnlyClientConfig) => endpointCaptureClient(config, seen),
    };
  }

  // Provider health: RPC available (deep-risk runs), Jupiter unavailable (quote stage skipped → isolate deep-risk).
  const rpcOnlyHealth = () =>
    providerHealthFixture("ph.json", [
      { provider: "rpc", status: "available" },
      { provider: "jupiter-quote", status: "unavailable" },
    ]);

  it("an explicit --rpc-url drives the deep-risk read (flag beats the on-disk/env endpoint)", async () => {
    const candidatesPath = candidates([WSOL]);
    const seen: string[] = [];
    const override = "https://override.rpc.example.com";
    const { exitCode } = await paperSniperCampaignAutoRunReport(captureCtx(seen, "https://env-fallback.example.com"), {
      candidatesPath,
      mode: "mainnet-dry-run",
      allowReadonlyNetwork: true,
      providerHealthPath: rpcOnlyHealth(),
      rpcUrl: override,
      outDir: join(dir, "alpha"),
    });
    expect(exitCode).toBe(0);
    // The deep-risk stage actually read the chain at the override endpoint, NOT the on-disk fallback.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((u) => u === override)).toBe(true);
    // The deep-risk evidence was gathered (honest, executed), proving the stage ran over the override.
    const index = readJson("alpha/evidence-index.json") as { candidates: Array<{ stages: Array<{ stage: string; status: string }> }> };
    expect(index.candidates[0]!.stages.some((s) => s.stage === "deep-risk" && s.status === "executed")).toBe(true);
  });

  it("with no --rpc-url the deep-risk read falls back to the configured/env endpoint", async () => {
    const candidatesPath = candidates([WSOL]);
    const seen: string[] = [];
    const { exitCode } = await paperSniperCampaignAutoRunReport(captureCtx(seen, "https://env-fallback.example.com"), {
      candidatesPath,
      mode: "mainnet-dry-run",
      allowReadonlyNetwork: true,
      providerHealthPath: rpcOnlyHealth(),
      outDir: join(dir, "alpha"),
    });
    expect(exitCode).toBe(0);
    expect(seen.every((u) => u === "https://env-fallback.example.com")).toBe(true);
  });

  it("a malformed --rpc-url makes deep-risk honestly unavailable without touching the network", async () => {
    const candidatesPath = candidates([WSOL]);
    const seen: string[] = [];
    const { exitCode } = await paperSniperCampaignAutoRunReport(captureCtx(seen, "https://env-fallback.example.com"), {
      candidatesPath,
      mode: "mainnet-dry-run",
      allowReadonlyNetwork: true,
      providerHealthPath: rpcOnlyHealth(),
      rpcUrl: "not a url",
      outDir: join(dir, "alpha"),
    });
    expect(exitCode).toBe(0); // the campaign still completes; the candidate just lacks risk evidence
    expect(seen).toEqual([]); // the invalid override never reached a client
    const index = readJson("alpha/evidence-index.json") as { candidates: Array<{ stages: Array<{ stage: string; status: string }> }> };
    const deepRisk = index.candidates[0]!.stages.find((s) => s.stage === "deep-risk");
    expect(deepRisk?.status === "unavailable" || deepRisk?.status === "failed").toBe(true);
  });
});

describe("paper:sniper:campaign:diff — compare two auto-run campaigns", () => {
  it("diffs two campaign.json files and validates", async () => {
    const candidatesPath = candidates([WSOL]);
    // before: WSOL blocked (REJECT); after: WSOL watch (PASS).
    const beforeOut = join(dir, "before");
    const afterOut = join(dir, "after");
    await paperSniperCampaignAutoRunReport(ctx, { candidatesPath, risks: [`${WSOL}=${riskFixture("r1.json", "REJECT", [{ id: "x", severity: "critical" }])}`], outDir: beforeOut });
    await paperSniperCampaignAutoRunReport(ctx, { candidatesPath, risks: [`${WSOL}=${riskFixture("r2.json", "PASS_FOR_PAPER_EVALUATION")}`], outDir: afterOut });
    const diffOut = join(dir, "diff.json");
    const { exitCode } = paperSniperCampaignDiffReport(ctx, { beforePath: join(beforeOut, "campaign.json"), afterPath: join(afterOut, "campaign.json"), outPath: diffOut });
    expect(exitCode).toBe(0);
    const diff = validateSniperDryRunCampaignDiff(JSON.parse(readFileSync(diffOut, "utf8")));
    expect(diff.summary.improvedCount).toBe(1);
    expect(diff.authorizesLiveTrading).toBe(false);
  });

  it("--fail-on-worsened exits non-zero when a candidate worsened", async () => {
    const candidatesPath = candidates([WSOL]);
    const beforeOut = join(dir, "before");
    const afterOut = join(dir, "after");
    await paperSniperCampaignAutoRunReport(ctx, { candidatesPath, risks: [`${WSOL}=${riskFixture("r1.json", "PASS_FOR_PAPER_EVALUATION")}`], outDir: beforeOut });
    await paperSniperCampaignAutoRunReport(ctx, { candidatesPath, risks: [`${WSOL}=${riskFixture("r2.json", "REJECT", [{ id: "x", severity: "critical" }])}`], outDir: afterOut });
    const res = paperSniperCampaignDiffReport(ctx, { beforePath: join(beforeOut, "campaign.json"), afterPath: join(afterOut, "campaign.json"), failOnWorsened: true });
    expect(res.exitCode).toBe(1);
  });

  it("refuses without both --before and --after", () => {
    expect(paperSniperCampaignDiffReport(ctx, { beforePath: "a" }).exitCode).toBe(1);
  });
});

describe("paper:sniper:alpha:report — assemble from a campaign", () => {
  it("builds the alpha report from a campaign.json and validates", async () => {
    const candidatesPath = candidates([WSOL]);
    const out = join(dir, "alpha");
    await paperSniperCampaignAutoRunReport(ctx, { candidatesPath, risks: [`${WSOL}=${riskFixture("r.json", "PASS_FOR_PAPER_EVALUATION")}`], outDir: out });
    const reportOut = join(dir, "report.json");
    const { exitCode } = paperSniperAlphaReportReport(ctx, {
      campaignPath: join(out, "campaign.json"),
      planPath: join(out, "readonly-campaign-plan.json"),
      runId: "report-test",
      evidenceProvenance: "fixture",
      outPath: reportOut,
    });
    expect(exitCode).toBe(0);
    const alpha = validateSniperAlphaRunReport(JSON.parse(readFileSync(reportOut, "utf8")));
    expect(alpha.runId).toBe("report-test");
    expect(alpha.evidenceProvenance).toBe("fixture");
    expect(alpha.liveTradingStatus).toBe("disabled");
  });

  it("refuses without --campaign", () => {
    expect(paperSniperAlphaReportReport(ctx, {}).exitCode).toBe(1);
  });
});
