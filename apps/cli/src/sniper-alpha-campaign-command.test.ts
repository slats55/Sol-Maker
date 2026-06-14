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
} from "@soulmaker/sniper";
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
