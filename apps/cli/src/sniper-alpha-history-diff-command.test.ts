/**
 * Sprint 107 — CLI tests for `paper:sniper:alpha:history:diff`. Each test first produces REAL no-send
 * alpha run folders with `paper:sniper:campaign:auto-run` (OFFLINE, Rust engine forced absent, risk from
 * ingested token:risk fixtures), rolls each into a `sniper.alpha_history.v1`, then diffs the two
 * histories. Everything is deterministic and NO network / signer / send is ever touched.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSniperAlphaHistoryDiff } from "@soulmaker/sniper";
import {
  paperSniperCampaignAutoRunReport,
  paperSniperAlphaHistoryReport,
  paperSniperAlphaHistoryDiffReport,
} from "./commands.js";

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Force the Rust engine absent so candidate scoring is honestly unavailable (deterministic, no spawn).
const ctx = { engineBinaryExists: () => false };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "alpha-history-diff-cli-"));
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

/** Produce a real alpha run folder with WSOL (clean) + USDC (reject OR pass, per `usdcReject`). */
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

/** Roll a single run folder into a history JSON file under `dir/<outName>` using `runRef` as the label. */
function writeHistory(runRef: string, runFolder: string, outName: string): string {
  const out = join(dir, outName);
  const { exitCode } = paperSniperAlphaHistoryReport(ctx, {
    runs: [`${runRef}=${runFolder}`],
    historyId: outName.replace(/\.json$/, ""),
    outPath: out,
  });
  expect(exitCode).toBe(0);
  return out;
}

describe("paper:sniper:alpha:history:diff — over real history rollups", () => {
  it("diffs two histories; the artifact validates and pins live-disabled, reports movement", async () => {
    const baseRun = await makeRun("base-run", "alpha-base", true); // USDC rejected -> blocked
    const nextRun = await makeRun("next-run", "alpha-next", false); // USDC clean -> watch
    const basePath = writeHistory("shared", baseRun, "history-base.json");
    const nextPath = writeHistory("shared", nextRun, "history-next.json");
    const outPath = join(dir, "history-diff.json");

    const { text, exitCode } = paperSniperAlphaHistoryDiffReport(ctx, { basePath, nextPath, diffId: "demo-diff", outPath });
    expect(exitCode).toBe(0);
    expect(text).toContain("LIVE TRADING IS DISABLED");
    expect(existsSync(outPath)).toBe(true);

    const diff = validateSniperAlphaHistoryDiff(JSON.parse(readFileSync(outPath, "utf8")));
    expect(diff.liveTradingStatus).toBe("disabled");
    expect(diff.authorizesLiveTrading).toBe(false);
    expect(diff.anyInputAuthorizesLiveTrading).toBe(false);
    // The shared run's blocked candidate recovered: aggregate blocked fell, watch rose.
    expect(diff.summary.aggregateBlockedDelta).toBe(-1);
    expect(diff.summary.aggregateWatchDelta).toBe(1);
    const shared = diff.runChanges.find((c) => c.runRef === "shared");
    expect(shared?.status).toBe("changed");
    expect(shared?.verdictCountDeltas).toEqual({ watch: 1, review: 0, blocked: -1, insufficientEvidence: 0 });
  });

  it("--fail-on-worsened exits non-zero when the aggregate blocked count rose", async () => {
    const baseRun = await makeRun("base-run", "alpha-base", false); // USDC clean -> watch
    const nextRun = await makeRun("next-run", "alpha-next", true); // USDC rejected -> blocked
    const basePath = writeHistory("shared", baseRun, "history-base.json");
    const nextPath = writeHistory("shared", nextRun, "history-next.json");
    const { exitCode, text } = paperSniperAlphaHistoryDiffReport(ctx, { basePath, nextPath, failOnWorsened: true });
    expect(exitCode).toBe(1);
    expect(text).toContain("--fail-on-worsened");
  });

  it("resolves a --base/--next folder to its alpha-history.json", async () => {
    const baseRun = await makeRun("base-run", "alpha-base", true);
    const nextRun = await makeRun("next-run", "alpha-next", true);
    // Write each history as `alpha-history.json` inside its own folder.
    const baseDir = join(dir, "hist-base");
    const nextDir = join(dir, "hist-next");
    mkdirSync(baseDir, { recursive: true });
    mkdirSync(nextDir, { recursive: true });
    expect(paperSniperAlphaHistoryReport(ctx, { runs: [`shared=${baseRun}`], outPath: join(baseDir, "alpha-history.json") }).exitCode).toBe(0);
    expect(paperSniperAlphaHistoryReport(ctx, { runs: [`shared=${nextRun}`], outPath: join(nextDir, "alpha-history.json") }).exitCode).toBe(0);
    const { exitCode, text } = paperSniperAlphaHistoryDiffReport(ctx, { basePath: baseDir, nextPath: nextDir, json: true });
    expect(exitCode).toBe(0);
    const diff = JSON.parse(text);
    expect(diff.schemaVersion).toBe("sniper.alpha_history.diff.v1");
    expect(diff.summary.runsUnchanged).toBe(1); // identical runs
  });

  it("refuses when --base or --next is missing", () => {
    const a = paperSniperAlphaHistoryDiffReport(ctx, { basePath: "x.json" });
    expect(a.exitCode).toBe(1);
    expect(a.text).toContain("Refusing");
    const b = paperSniperAlphaHistoryDiffReport(ctx, {});
    expect(b.exitCode).toBe(1);
    expect(b.text).toContain("Refusing");
  });

  it("refuses a malformed history file (not a valid sniper.alpha_history.v1)", async () => {
    const nextRun = await makeRun("next-run", "alpha-next", true);
    const nextPath = writeHistory("shared", nextRun, "history-next.json");
    const broken = write("broken.json", { schemaVersion: "nope" });
    const { exitCode, text } = paperSniperAlphaHistoryDiffReport(ctx, { basePath: broken, nextPath });
    expect(exitCode).toBe(1);
    expect(text).toContain("Refusing");
  });

  it("refuses to overwrite an existing --out without --force", async () => {
    const baseRun = await makeRun("base-run", "alpha-base", true);
    const nextRun = await makeRun("next-run", "alpha-next", true);
    const basePath = writeHistory("shared", baseRun, "history-base.json");
    const nextPath = writeHistory("shared", nextRun, "history-next.json");
    const outPath = write("existing-diff.json", { placeholder: true });
    const refused = paperSniperAlphaHistoryDiffReport(ctx, { basePath, nextPath, outPath });
    expect(refused.exitCode).toBe(1);
    expect(refused.text).toContain("already exists");
    const forced = paperSniperAlphaHistoryDiffReport(ctx, { basePath, nextPath, outPath, force: true });
    expect(forced.exitCode).toBe(0);
  });
});
