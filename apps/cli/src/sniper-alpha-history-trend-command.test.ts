/**
 * Sprint 107 — CLI tests for `paper:sniper:alpha:history:trend`. Each test produces REAL no-send alpha
 * run folders with `paper:sniper:campaign:auto-run` (OFFLINE, Rust engine forced absent, risk from
 * ingested token:risk fixtures), rolls each into a `sniper.alpha_history.v1`, then folds the histories
 * into a trend. Everything is deterministic and NO network / signer / send is ever touched.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSniperAlphaHistoryTrend } from "@soulmaker/sniper";
import {
  paperSniperCampaignAutoRunReport,
  paperSniperAlphaHistoryReport,
  paperSniperAlphaHistoryTrendReport,
} from "./commands.js";

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const ctx = { engineBinaryExists: () => false };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "alpha-history-trend-cli-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, value: unknown): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(value, null, 2) + "\n");
  return p;
}

const candidates = (name: string, mints: string[]) =>
  write(name, { candidates: mints.map((m) => ({ candidateId: m.slice(0, 6), mint: m })) });
const riskFixture = (name: string, decision: string, flags: Array<{ id: string; severity: string }> = []) =>
  write(name, { decision, flags });

async function makeRun(folder: string, runId: string, usdcReject: boolean): Promise<string> {
  const candidatesPath = candidates(`${folder}-candidates.json`, [WSOL, USDC]);
  const passRisk = riskFixture(`${folder}-risk.wsol.json`, "PASS_FOR_PAPER_EVALUATION");
  const usdcRisk = usdcReject
    ? riskFixture(`${folder}-risk.usdc.json`, "REJECT", [{ id: "freeze-authority", severity: "critical" }])
    : riskFixture(`${folder}-risk.usdc.json`, "PASS_FOR_PAPER_EVALUATION");
  const out = join(dir, folder);
  const { exitCode } = await paperSniperCampaignAutoRunReport(ctx, {
    candidatesPath,
    risks: [`${WSOL}=${passRisk}`, `${USDC}=${usdcRisk}`],
    outDir: out,
    runId,
    evidenceProvenance: "fixture",
  });
  expect(exitCode).toBe(0);
  return out;
}

function writeHistory(runRef: string, runFolder: string, outName: string): string {
  const out = join(dir, outName);
  const { exitCode } = paperSniperAlphaHistoryReport(ctx, { runs: [`${runRef}=${runFolder}`], historyId: outName.replace(/\.json$/, ""), outPath: out });
  expect(exitCode).toBe(0);
  return out;
}

describe("paper:sniper:alpha:history:trend — over real history rollups", () => {
  it("folds three histories into a trend in supplied order; validates + pins live-disabled", async () => {
    const r1 = await makeRun("run-1", "alpha-1", true); // blocked=1
    const r2 = await makeRun("run-2", "alpha-2", false); // blocked=0
    const r3 = await makeRun("run-3", "alpha-3", true); // blocked=1
    const h1 = writeHistory("shared", r1, "h1.json");
    const h2 = writeHistory("shared", r2, "h2.json");
    const h3 = writeHistory("shared", r3, "h3.json");
    const outPath = join(dir, "trend.json");
    const { text, exitCode } = paperSniperAlphaHistoryTrendReport(ctx, {
      histories: [`mon=${h1}`, `tue=${h2}`, `wed=${h3}`],
      trendId: "demo-trend",
      outPath,
    });
    expect(exitCode).toBe(0);
    expect(text).toContain("LIVE TRADING IS DISABLED");
    expect(existsSync(outPath)).toBe(true);
    const trend = validateSniperAlphaHistoryTrend(JSON.parse(readFileSync(outPath, "utf8")));
    expect(trend.snapshots.map((s) => s.label)).toEqual(["mon", "tue", "wed"]);
    expect(trend.verdictSeries.blocked).toEqual([1, 0, 1]);
    expect(trend.liveTradingStatus).toBe("disabled");
    expect(trend.authorizesLiveTrading).toBe(false);
  });

  it("auto-discovers history files from --histories-dir, sorted by name", async () => {
    const parent = join(dir, "histories");
    mkdirSync(parent, { recursive: true });
    const r1 = await makeRun("run-1", "alpha-1", true);
    const r2 = await makeRun("run-2", "alpha-2", false);
    expect(paperSniperAlphaHistoryReport(ctx, { runs: [`shared=${r1}`], outPath: join(parent, "01-mon.json") }).exitCode).toBe(0);
    expect(paperSniperAlphaHistoryReport(ctx, { runs: [`shared=${r2}`], outPath: join(parent, "02-tue.json") }).exitCode).toBe(0);
    const { exitCode, text } = paperSniperAlphaHistoryTrendReport(ctx, { historiesDir: parent, json: true });
    expect(exitCode).toBe(0);
    const trend = JSON.parse(text);
    expect(trend.schemaVersion).toBe("sniper.alpha_history.trend.v1");
    expect(trend.snapshots.map((s: { label: string }) => s.label)).toEqual(["01-mon", "02-tue"]);
  });

  it("refuses fewer than two snapshots", async () => {
    const r1 = await makeRun("run-1", "alpha-1", true);
    const h1 = writeHistory("shared", r1, "h1.json");
    const { exitCode, text } = paperSniperAlphaHistoryTrendReport(ctx, { histories: [`mon=${h1}`] });
    expect(exitCode).toBe(1);
    expect(text).toContain("at least two snapshots");
  });

  it("refuses with no --history / --histories-dir", () => {
    const { exitCode, text } = paperSniperAlphaHistoryTrendReport(ctx, {});
    expect(exitCode).toBe(1);
    expect(text).toContain("Refusing");
  });

  it("refuses a malformed history file", async () => {
    const r1 = await makeRun("run-1", "alpha-1", true);
    const h1 = writeHistory("shared", r1, "h1.json");
    const broken = write("broken.json", { schemaVersion: "nope" });
    const { exitCode, text } = paperSniperAlphaHistoryTrendReport(ctx, { histories: [`mon=${h1}`, `tue=${broken}`] });
    expect(exitCode).toBe(1);
    expect(text).toContain("Refusing");
  });

  it("refuses a malformed --history argument (no label=path)", () => {
    const { exitCode, text } = paperSniperAlphaHistoryTrendReport(ctx, { histories: ["just-a-path"] });
    expect(exitCode).toBe(1);
    expect(text).toContain("Refusing");
  });
});
