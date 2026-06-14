/**
 * Sprint 105-C — END-TO-END regression for the no-send alpha workflow.
 *
 * Drives the full operator chain with INJECTED fixtures (never the network):
 *   provider:doctor → watchlist:prepare → campaign:auto-run → campaign:diff → alpha:report
 *
 * The suite is the safety net that keeps the alpha checkpoint from drifting toward live trading:
 *   - live trading stays DISABLED and authorizesLiveTrading stays false in EVERY committed artifact;
 *   - no signature / sendResult / txid / secret-key field is ever smuggled into an artifact;
 *   - a risk-REJECT candidate is blocked and a clean candidate is never falsely "blocked";
 *   - a missing provider still yields a useful, honest report;
 *   - provenance (real-readonly / fixture / unavailable / skipped / blocked) is labelled, never faked;
 *   - identical input yields byte-identical artifacts (determinism);
 *   - one candidate failing never kills the campaign (per-candidate isolation);
 *   - an ingested provider-health report is REUSED, never re-probed.
 *
 * Every run forces the Rust engine absent (`engineBinaryExists: () => false`) and stays in paper
 * mode (no --allow-readonly-network), so nothing spawns and nothing reaches the network.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateSniperDryRunCampaign,
  validateSniperAlphaRunReport,
  validateSniperProviderHealthReport,
  validateSniperWatchlist,
  validateSniperAlphaHistory,
  validateSniperStrategyIntelligence,
  buildSniperProviderHealthReport,
  type SniperProviderHealthCheckInput,
} from "@soulmaker/sniper";
import type { ReadOnlyClientConfig, ReadOnlySolanaClient } from "@soulmaker/solana";
import {
  paperSniperWatchlistPrepareReport,
  paperSniperCampaignAutoRunReport,
  paperSniperCampaignDiffReport,
  paperSniperAlphaReportReport,
  paperSniperAlphaHistoryReport,
  paperSniperStrategyIntelReport,
} from "./commands.js";

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

// Rust engine forced absent → deterministic, no spawn.
const ctx = { engineBinaryExists: () => false };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "alpha-regression-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, value: unknown): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(value, null, 2) + "\n");
  return p;
}
function readJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(dir, rel), "utf8"));
}

const candidatesFile = (mints: string[]) => write("candidates.json", { candidates: mints.map((m) => ({ candidateId: m.slice(0, 6), mint: m })) });
const riskFixture = (name: string, decision: string, flags: Array<{ id: string; severity: string }> = []) => write(name, { decision, flags });
const providerHealthFixture = (name: string, checks: SniperProviderHealthCheckInput[], reportId = "regression-fixture") =>
  write(name, buildSniperProviderHealthReport({ reportId, mode: "mainnet-dry-run", checks }));

/**
 * Deep-scan a JSON value for any field that would imply a real send actually happened. A no-send
 * artifact may DESCRIBE that sending is disabled (string literals like "disabled"), but it must
 * never carry a populated signature / txid / sendResult / secret-key value.
 */
function assertNoSendArtifact(value: unknown, where: string): void {
  const forbidden = /^(signature|txSignature|txid|txId|sendResult|secretKey|privateKey|keypair|mnemonic|seedPhrase)$/i;
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${path}[${i}]`));
    } else if (v !== null && typeof v === "object") {
      for (const [k, val] of Object.entries(v)) {
        if (forbidden.test(k) && val !== null && val !== undefined && val !== false && val !== "") {
          throw new Error(`${where}: forbidden populated field "${k}" at ${path} (value: ${JSON.stringify(val).slice(0, 80)})`);
        }
        walk(val, `${path}.${k}`);
      }
    }
  };
  walk(value, where);
}

/** Assert the safety literals every committed alpha artifact must pin. */
function assertLiveDisabled(value: Record<string, unknown>, where: string): void {
  if ("authorizesLiveTrading" in value) expect(value.authorizesLiveTrading, `${where}.authorizesLiveTrading`).toBe(false);
  if ("liveSendStatus" in value) expect(value.liveSendStatus, `${where}.liveSendStatus`).toBe("disabled");
  if ("liveTradingStatus" in value) expect(value.liveTradingStatus, `${where}.liveTradingStatus`).toBe("disabled");
  if ("phase7LiveTradingReady" in value) expect(value.phase7LiveTradingReady, `${where}.phase7LiveTradingReady`).toBe(false);
  if ("neverSends" in value) expect(value.neverSends, `${where}.neverSends`).toBe(true);
}

/** Run the full no-send chain once; return the produced alpha folder path. */
async function runAlphaWorkflow(opts: { reject?: string; provenance?: string; provider?: SniperProviderHealthCheckInput[] } = {}): Promise<string> {
  const cands = candidatesFile([WSOL, USDC]);
  // 1) watchlist:prepare (LOCAL-ONLY) from the candidate spine.
  const watchlistPath = join(dir, "watchlist.json");
  const wl = paperSniperWatchlistPrepareReport(ctx, { candidatesPath: cands, status: "watch", outPath: watchlistPath, watchlistId: "regr-wl" });
  expect(wl.exitCode).toBe(0);
  // 2) provider:doctor (ingest a fixture — the demo flow writes one then ingests it).
  const ph = providerHealthFixture("provider-health-input.json", opts.provider ?? [
    { provider: "rpc", status: "available" },
    { provider: "jupiter-quote", status: "available" },
  ]);
  // 3) campaign:auto-run (paper; risks ingested; one clean, one REJECT).
  const out = join(dir, "alpha");
  const passRisk = riskFixture("risk.wsol.json", "PASS_FOR_PAPER_EVALUATION");
  const rejectRisk = riskFixture("risk.usdc.json", "REJECT", [{ id: opts.reject ?? "freeze-authority", severity: "critical" }]);
  const run = await paperSniperCampaignAutoRunReport(ctx, {
    watchlistPath,
    providerHealthPath: ph,
    risks: [`${WSOL}=${passRisk}`, `${USDC}=${rejectRisk}`],
    evidenceProvenance: opts.provenance,
    outDir: out,
    runId: "regr-run",
  });
  expect(run.exitCode).toBe(0);
  return out;
}

describe("alpha workflow regression — full no-send chain (S105-C)", () => {
  it("runs provider:doctor → watchlist → auto-run → diff → alpha:report; everything validates and stays live-disabled", async () => {
    const out = await runAlphaWorkflow({ provenance: "fixture" });

    // Watchlist validates and is bookkeeping-only.
    const watchlist = validateSniperWatchlist(readJson("watchlist.json"));
    expect(watchlist.entries.length).toBe(2);

    // Campaign + alpha report validate.
    const campaign = validateSniperDryRunCampaign(JSON.parse(readFileSync(join(out, "campaign.json"), "utf8")));
    const alpha = validateSniperAlphaRunReport(JSON.parse(readFileSync(join(out, "alpha-report.json"), "utf8")));
    expect(campaign.candidateCount).toBe(2);
    assertLiveDisabled(campaign as unknown as Record<string, unknown>, "campaign");
    assertLiveDisabled(alpha as unknown as Record<string, unknown>, "alpha");

    // 4) campaign:diff — a SECOND run where the rejected candidate now passes; diff validates.
    const after = await runAlphaWorkflowAfter();
    const diffPath = join(dir, "diff.json");
    const diff = paperSniperCampaignDiffReport(ctx, {
      beforePath: join(out, "campaign.json"),
      afterPath: join(after, "campaign.json"),
      outPath: diffPath,
    });
    expect(diff.exitCode).toBe(0);

    // 5) alpha:report — standalone projection of the campaign + diff.
    const reportPath = join(dir, "alpha-standalone.json");
    const standalone = paperSniperAlphaReportReport(ctx, {
      campaignPath: join(out, "campaign.json"),
      diffPath,
      watchlistPath: join(dir, "watchlist.json"),
      evidenceProvenance: "fixture",
      outPath: reportPath,
    });
    expect(standalone.exitCode).toBe(0);
    const standaloneReport = validateSniperAlphaRunReport(JSON.parse(readFileSync(reportPath, "utf8")));
    assertLiveDisabled(standaloneReport as unknown as Record<string, unknown>, "standalone");

    // No committed artifact smuggles a send/signature field.
    for (const rel of ["watchlist.json", "alpha/campaign.json", "alpha/alpha-report.json", "alpha/readonly-campaign-plan.json", "alpha/evidence-index.json", "diff.json", "alpha-standalone.json"]) {
      assertNoSendArtifact(readJson(rel), rel);
    }
  });

  it("a risk-REJECT candidate is BLOCKED while a clean candidate is never falsely blocked", async () => {
    const out = await runAlphaWorkflow();
    const campaign = validateSniperDryRunCampaign(JSON.parse(readFileSync(join(out, "campaign.json"), "utf8")));
    const usdc = campaign.candidates.find((c) => c.mint === USDC)!;
    const wsol = campaign.candidates.find((c) => c.mint === WSOL)!;
    expect(usdc.finalOperatorVerdict).toBe("blocked");
    expect(wsol.finalOperatorVerdict).not.toBe("blocked");
  });

  it("a missing provider-health report still yields a useful, valid alpha report", async () => {
    const cands = candidatesFile([WSOL]);
    const out = join(dir, "alpha");
    const run = await paperSniperCampaignAutoRunReport(ctx, {
      candidatesPath: cands,
      risks: [`${WSOL}=${riskFixture("r.json", "PASS_FOR_PAPER_EVALUATION")}`],
      outDir: out,
    });
    expect(run.exitCode).toBe(0);
    const alpha = validateSniperAlphaRunReport(JSON.parse(readFileSync(join(out, "alpha-report.json"), "utf8")));
    expect(alpha.candidateCount).toBe(1);
    // With no provider health the run is still honest about what it did NOT do.
    expect(alpha.providerHealthSummary.simulation).toBe("not-attempted");
    assertLiveDisabled(alpha as unknown as Record<string, unknown>, "alpha-no-provider");
  });

  it("provenance is labelled honestly (operator override is echoed; evidence carries skipped/not-attempted)", async () => {
    const out = await runAlphaWorkflow({ provenance: "fixture" });
    const alpha = validateSniperAlphaRunReport(JSON.parse(readFileSync(join(out, "alpha-report.json"), "utf8")));
    expect(alpha.evidenceProvenance).toBe("fixture");
    const index = readJson("alpha/evidence-index.json") as { candidates: Array<{ stages: Array<{ stage: string; status: string }> }> };
    const allStatuses = new Set(index.candidates.flatMap((c) => c.stages.map((s) => s.status)));
    // Honest, non-faked provenance vocabulary appears (ingested risk + not-attempted network stages).
    expect(allStatuses.has("ingested")).toBe(true);
    expect(allStatuses.has("not-attempted") || allStatuses.has("skipped")).toBe(true);
  });

  it("makes NO fake profitability / live-readiness claim and carries the disabled banner", async () => {
    const out = await runAlphaWorkflow();
    const summary = readFileSync(join(out, "RUN_SUMMARY.md"), "utf8");
    expect(summary).toContain("LIVE TRADING DISABLED");
    expect(summary).not.toMatch(/guaranteed|profit guarantee|ready to trade live|live[- ]ready/i);
    const alphaText = JSON.stringify(readJson("alpha/alpha-report.json"));
    expect(alphaText).not.toMatch(/guaranteed profit|ready to trade live/i);
  });
});

/** A second auto-run (same spine) where the formerly-rejected candidate now passes — for the diff. */
async function runAlphaWorkflowAfter(): Promise<string> {
  const cands = candidatesFile([WSOL, USDC]);
  const watchlistPath = join(dir, "watchlist-after.json");
  paperSniperWatchlistPrepareReport(ctx, { candidatesPath: cands, status: "watch", outPath: watchlistPath, watchlistId: "regr-wl-after" });
  const ph = providerHealthFixture("ph-after.json", [
    { provider: "rpc", status: "available" },
    { provider: "jupiter-quote", status: "available" },
  ]);
  const out = join(dir, "alpha-after");
  await paperSniperCampaignAutoRunReport(ctx, {
    watchlistPath,
    providerHealthPath: ph,
    risks: [`${WSOL}=${riskFixture("r-after-wsol.json", "PASS_FOR_PAPER_EVALUATION")}`, `${USDC}=${riskFixture("r-after-usdc.json", "PASS_FOR_PAPER_EVALUATION")}`],
    outDir: out,
    runId: "regr-run-after",
  });
  return out;
}

describe("alpha workflow regression — reliability + determinism (S105-C)", () => {
  it("identical input yields byte-identical artifacts (deterministic; stable ordering + filenames)", async () => {
    const cands = candidatesFile([WSOL, USDC, BONK]);
    const risks = [
      `${WSOL}=${riskFixture("r1.json", "PASS_FOR_PAPER_EVALUATION")}`,
      `${USDC}=${riskFixture("r2.json", "REJECT", [{ id: "freeze-authority", severity: "critical" }])}`,
      `${BONK}=${riskFixture("r3.json", "PASS_FOR_PAPER_EVALUATION")}`,
    ];
    const runOnce = async (outName: string): Promise<string> => {
      const out = join(dir, outName);
      await paperSniperCampaignAutoRunReport(ctx, { candidatesPath: cands, risks, outDir: out, runId: "determinism" });
      return out;
    };
    const a = await runOnce("run-a");
    const b = await runOnce("run-b");
    for (const f of ["readonly-campaign-plan.json", "campaign.json", "alpha-report.json", "evidence-index.json"]) {
      expect(readFileSync(join(a, f), "utf8"), `${f} must be byte-identical across identical runs`).toBe(readFileSync(join(b, f), "utf8"));
    }
    // Candidate order is the spine order, preserved.
    const campaign = validateSniperDryRunCampaign(JSON.parse(readFileSync(join(a, "campaign.json"), "utf8")));
    expect(campaign.candidates.map((c) => c.mint)).toEqual([WSOL, USDC, BONK]);
  });

  it("one candidate's deep-risk failing never kills the campaign (per-candidate isolation)", async () => {
    // A network run where the injected client THROWS for USDC but reads WSOL cleanly.
    writeFileSync(join(dir, "soulmaker.config.json"), JSON.stringify({ mode: "WATCH_ONLY", rpcUrl: "https://rpc.example.com" }));
    const cands = candidatesFile([WSOL, USDC]);
    const ph = providerHealthFixture("ph.json", [
      { provider: "rpc", status: "available" },
      { provider: "jupiter-quote", status: "unavailable" }, // isolate deep-risk
    ]);
    const flakyCtx = {
      cwd: dir,
      env: {},
      engineBinaryExists: () => false,
      createClient: (_config: ReadOnlyClientConfig): ReadOnlySolanaClient =>
        ({
          endpointHost: "rpc.example.com",
          getRpcHealth: async () => ({ ok: true, endpointHost: "rpc.example.com" }),
          getVersion: async () => ({ solanaCore: "test" }),
          getSolBalance: async () => ({ ownerBase58: WSOL, lamports: 0, sol: 0 }),
          getTokenAccounts: async () => [],
          getTokenMintInfo: async (mint: string | { toBase58(): string }) => {
            const m = typeof mint === "string" ? mint : mint.toBase58();
            if (m === USDC) throw new Error("rpc exploded for this mint");
            return { mint: m, decimals: 9, supplyRaw: "1000", uiSupply: 1000, mintAuthorityPresent: false, freezeAuthorityPresent: false, isInitialized: true, programLabel: "spl-token", source: "test" };
          },
        }) as unknown as ReadOnlySolanaClient,
    };
    const out = join(dir, "alpha");
    const run = await paperSniperCampaignAutoRunReport(flakyCtx, {
      candidatesPath: cands,
      mode: "mainnet-dry-run",
      allowReadonlyNetwork: true,
      providerHealthPath: ph,
      outDir: out,
    });
    expect(run.exitCode).toBe(0); // the campaign completes despite one candidate failing
    const campaign = validateSniperDryRunCampaign(JSON.parse(readFileSync(join(out, "campaign.json"), "utf8")));
    expect(campaign.candidateCount).toBe(2); // BOTH candidates are still present
    const index = readJson("alpha/evidence-index.json") as { candidates: Array<{ mint: string; stages: Array<{ stage: string; status: string }> }> };
    const usdcEv = index.candidates.find((c) => c.mint === USDC)!;
    const wsolEv = index.candidates.find((c) => c.mint === WSOL)!;
    expect(usdcEv.stages.some((s) => s.stage === "deep-risk" && (s.status === "failed" || s.status === "unavailable"))).toBe(true);
    expect(wsolEv.stages.some((s) => s.stage === "deep-risk" && s.status === "executed")).toBe(true);
  });

  it("an ingested provider-health report is REUSED (not re-probed): its reportId + statuses survive", async () => {
    const cands = candidatesFile([WSOL]);
    const ph = providerHealthFixture(
      "ph.json",
      [
        { provider: "rpc", status: "timeout" },
        { provider: "jupiter-quote", status: "rate-limited" },
      ],
      "DISTINCTIVE-REUSE-ID",
    );
    const out = join(dir, "alpha");
    // No createClient / createQuoteAdapter seam is injected — if the doctor were RE-PROBED instead of
    // reusing the ingested report, it would need those seams; the ingest path needs none.
    const run = await paperSniperCampaignAutoRunReport(ctx, { candidatesPath: cands, providerHealthPath: ph, outDir: out });
    expect(run.exitCode).toBe(0);
    const written = validateSniperProviderHealthReport(JSON.parse(readFileSync(join(out, "provider-health.json"), "utf8")));
    expect(written.reportId).toBe("DISTINCTIVE-REUSE-ID");
    expect(written.checks.find((c) => c.provider === "rpc")?.status).toBe("timeout");
    expect(written.checks.find((c) => c.provider === "jupiter-quote")?.status).toBe("rate-limited");
  });

  it("the candidate limit is enforced (no unbounded scan)", async () => {
    const cands = candidatesFile([WSOL, USDC, BONK]);
    const out = join(dir, "alpha");
    await paperSniperCampaignAutoRunReport(ctx, { candidatesPath: cands, limit: 2, outDir: out, risks: [`${WSOL}=${riskFixture("r.json", "PASS_FOR_PAPER_EVALUATION")}`] });
    const campaign = validateSniperDryRunCampaign(JSON.parse(readFileSync(join(out, "campaign.json"), "utf8")));
    expect(campaign.candidateCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Sprint 106 — the alpha workflow now extends to the HISTORY rollup and the
// STRATEGY INTELLIGENCE projection. This block drives the documented demo
// (examples/sniper/alpha-workflow/README.md sections C + D) end-to-end so the
// operator demo can never silently drift toward live trading.
// ---------------------------------------------------------------------------
describe("alpha workflow regression — S106 history + strategy intelligence", () => {
  it("alpha:history rolls up two run folders; the artifact validates, stays live-disabled, smuggles no send field", async () => {
    const before = await runAlphaWorkflow({ provenance: "fixture" });
    const after = await runAlphaWorkflowAfter();
    const historyPath = join(dir, "alpha-history.json");
    const history = paperSniperAlphaHistoryReport(ctx, {
      runs: [`before=${before}`, `after=${after}`],
      historyId: "regr-history",
      outPath: historyPath,
    });
    expect(history.exitCode).toBe(0);
    const rolled = validateSniperAlphaHistory(readJson("alpha-history.json"));
    expect(rolled.runCount).toBe(2);
    expect(rolled.invalidArtifactCount).toBe(0);
    expect(rolled.totalCandidateCount).toBe(4);
    assertLiveDisabled(rolled as unknown as Record<string, unknown>, "alpha-history");
    expect(rolled.anyRunAuthorizesLiveTrading).toBe(false);
    assertNoSendArtifact(readJson("alpha-history.json"), "alpha-history.json");
  });

  it("alpha:history lists a missing/unrecognized artifact honestly and never counts it as a run", async () => {
    const before = await runAlphaWorkflow({ provenance: "fixture" });
    const history = paperSniperAlphaHistoryReport(ctx, {
      runs: [`good=${before}`, `missing=${join(dir, "does-not-exist")}`],
      json: true,
    });
    expect(history.exitCode).toBe(0);
    const rolled = JSON.parse(history.text);
    expect(rolled.runCount).toBe(1);
    expect(rolled.invalidArtifactCount).toBe(1);
    expect(rolled.invalidArtifacts[0].ref).toBe("missing/campaign.json");
  });

  it("strategy:intel explains a campaign, surfaces freeze-authority by name, and stays live-disabled", async () => {
    const out = await runAlphaWorkflow({ provenance: "fixture" });
    const intelPath = join(dir, "strategy-intel.json");
    const intel = paperSniperStrategyIntelReport(ctx, {
      campaignPath: join(out, "campaign.json"),
      risks: [`${WSOL}=${join(dir, "risk.wsol.json")}`, `${USDC}=${join(dir, "risk.usdc.json")}`],
      intelligenceId: "regr-intel",
      evidenceProvenance: "fixture",
      outPath: intelPath,
    });
    expect(intel.exitCode).toBe(0);
    const projected = validateSniperStrategyIntelligence(readJson("strategy-intel.json"));
    expect(projected.candidateCount).toBe(2);
    assertLiveDisabled(projected as unknown as Record<string, unknown>, "strategy-intel");
    expect(projected.notAProfitabilityClaim).toBe(true);
    const usdc = projected.candidates.find((c) => c.mint === USDC)!;
    expect(usdc.verdict).toBe("blocked");
    expect(usdc.notableFlags.map((f) => f.id)).toContain("freeze-authority");
    assertNoSendArtifact(readJson("strategy-intel.json"), "strategy-intel.json");
  });
});
