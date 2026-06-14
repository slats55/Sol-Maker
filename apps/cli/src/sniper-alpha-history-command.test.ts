/**
 * Sprint 106 — CLI tests for `paper:sniper:alpha:history`. Each test first produces REAL no-send alpha
 * run folders with `paper:sniper:campaign:auto-run` (OFFLINE, Rust engine forced absent, risk from
 * ingested token:risk fixtures), then rolls them up. Everything is deterministic and NO network /
 * signer / send is ever touched.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSniperAlphaHistory } from "@soulmaker/sniper";
import { paperSniperCampaignAutoRunReport, paperSniperAlphaHistoryReport } from "./commands.js";

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Force the Rust engine absent so candidate scoring is honestly unavailable (deterministic, no spawn).
const ctx = { engineBinaryExists: () => false };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "alpha-history-cli-"));
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

/** Produce a real alpha run folder under `dir/<folder>` with two candidates (one clean, one rejected). */
async function makeRun(folder: string, runId: string): Promise<string> {
  const candidatesPath = candidates(`${folder}-candidates.json`, [WSOL, USDC]);
  const passRisk = riskFixture(`${folder}-risk.wsol.json`, "PASS_FOR_PAPER_EVALUATION");
  const rejectRisk = riskFixture(`${folder}-risk.usdc.json`, "REJECT", [{ id: "freeze-authority", severity: "critical" }]);
  const out = join(dir, folder);
  const { exitCode } = await paperSniperCampaignAutoRunReport(ctx, {
    candidatesPath,
    risks: [`${WSOL}=${passRisk}`, `${USDC}=${rejectRisk}`],
    outDir: out,
    runId,
    evidenceProvenance: "fixture",
  });
  expect(exitCode).toBe(0);
  return out;
}

describe("paper:sniper:alpha:history — rollup over real run folders", () => {
  it("rolls up two run folders via --run label=path; the artifact validates and pins live-disabled", async () => {
    await makeRun("run-a", "alpha-a");
    await makeRun("run-b", "alpha-b");
    const out = join(dir, "history.json");
    const { text, exitCode } = paperSniperAlphaHistoryReport(ctx, {
      runs: [`run-a=${join(dir, "run-a")}`, `run-b=${join(dir, "run-b")}`],
      historyId: "demo-history",
      outPath: out,
    });
    expect(exitCode).toBe(0);
    expect(text).toContain("LIVE TRADING IS DISABLED");
    expect(existsSync(out)).toBe(true);
    const history = validateSniperAlphaHistory(JSON.parse(readFileSync(out, "utf8")));
    expect(history.runCount).toBe(2);
    expect(history.totalCandidateCount).toBe(4);
    expect(history.aggregateVerdictCounts.blocked).toBe(2); // one REJECT per run
    expect(history.aggregateVerdictCounts.watch).toBe(2); // one clean per run
    expect(history.liveTradingStatus).toBe("disabled");
    expect(history.authorizesLiveTrading).toBe(false);
    expect(history.anyRunAuthorizesLiveTrading).toBe(false);
    expect(history.evidenceProvenanceRollup.fixture).toBe(2);
    expect(history.runs.map((r) => r.runRef)).toEqual(["run-a", "run-b"]);
    expect(history.topBlockerReasons.some((b) => b.reason.includes("REJECT"))).toBe(true);
  });

  it("auto-discovers run subfolders with --runs-dir", async () => {
    const parent = join(dir, "all-runs");
    mkdirSync(parent, { recursive: true });
    // Re-root two runs under the parent.
    for (const [folder, runId] of [["all-runs/r1", "r1"], ["all-runs/r2", "r2"]] as const) {
      const candidatesPath = candidates(`${runId}-candidates.json`, [WSOL]);
      const passRisk = riskFixture(`${runId}-risk.json`, "PASS_FOR_PAPER_EVALUATION");
      const { exitCode } = await paperSniperCampaignAutoRunReport(ctx, {
        candidatesPath,
        risks: [`${WSOL}=${passRisk}`],
        outDir: join(dir, folder),
        runId,
        evidenceProvenance: "fixture",
      });
      expect(exitCode).toBe(0);
    }
    const { exitCode, text } = paperSniperAlphaHistoryReport(ctx, { runsDir: parent, historyId: "auto", json: true });
    expect(exitCode).toBe(0);
    const json = JSON.parse(text);
    expect(json.runCount).toBe(2);
    expect(json.runs.map((r: { runRef: string }) => r.runRef)).toEqual(["r1", "r2"]);
  });

  it("lists a missing campaign.json as an invalid artifact, never a run", async () => {
    await makeRun("run-a", "alpha-a");
    const empty = join(dir, "run-empty");
    mkdirSync(empty, { recursive: true });
    const { exitCode, text } = paperSniperAlphaHistoryReport(ctx, {
      runs: [`run-a=${join(dir, "run-a")}`, `run-empty=${empty}`],
      json: true,
    });
    expect(exitCode).toBe(0);
    const history = JSON.parse(text);
    expect(history.runCount).toBe(1);
    expect(history.invalidArtifactCount).toBe(1);
    expect(history.invalidArtifacts[0].ref).toBe("run-empty/campaign.json");
    expect(history.invalidArtifacts[0].reason).toContain("missing recognized artifact");
  });

  it("lists a malformed campaign.json as invalid (recognized but unparseable)", async () => {
    const broken = join(dir, "run-broken");
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, "campaign.json"), "{ not valid json");
    const { exitCode, text } = paperSniperAlphaHistoryReport(ctx, { runs: [`run-broken=${broken}`], json: true });
    expect(exitCode).toBe(0);
    const history = JSON.parse(text);
    expect(history.runCount).toBe(0);
    expect(history.invalidArtifactCount).toBe(1);
    expect(history.invalidArtifacts[0].reason).toContain("invalid campaign");
  });

  it("--fail-on-invalid exits non-zero when an artifact is invalid", async () => {
    await makeRun("run-a", "alpha-a");
    const empty = join(dir, "run-empty");
    mkdirSync(empty, { recursive: true });
    const { exitCode } = paperSniperAlphaHistoryReport(ctx, {
      runs: [`run-a=${join(dir, "run-a")}`, `run-empty=${empty}`],
      failOnInvalid: true,
    });
    expect(exitCode).toBe(1);
  });

  it("--fail-on-blocked exits non-zero when a candidate-run is blocked", async () => {
    await makeRun("run-a", "alpha-a");
    const { exitCode } = paperSniperAlphaHistoryReport(ctx, {
      runs: [`run-a=${join(dir, "run-a")}`],
      failOnBlocked: true,
    });
    expect(exitCode).toBe(1);
  });

  it("refuses with no --run / --runs-dir", () => {
    const { exitCode, text } = paperSniperAlphaHistoryReport(ctx, {});
    expect(exitCode).toBe(1);
    expect(text).toContain("Refusing");
  });

  it("refuses a malformed --run argument (no label=path)", () => {
    const { exitCode, text } = paperSniperAlphaHistoryReport(ctx, { runs: ["just-a-path"] });
    expect(exitCode).toBe(1);
    expect(text).toContain("Refusing");
  });

  it("ingests a run pointed straight at a campaign.json file", async () => {
    await makeRun("run-a", "alpha-a");
    const { exitCode, text } = paperSniperAlphaHistoryReport(ctx, {
      runs: [`run-a=${join(dir, "run-a", "campaign.json")}`],
      json: true,
    });
    expect(exitCode).toBe(0);
    const history = JSON.parse(text);
    expect(history.runCount).toBe(1);
    expect(history.runs[0].hasAlphaReport).toBe(true); // sibling alpha-report.json picked up
  });
});
