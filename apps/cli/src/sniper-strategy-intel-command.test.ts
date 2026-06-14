/**
 * Sprint 106 — CLI tests for `paper:sniper:strategy:intel`. Each test produces a REAL no-send campaign
 * with `paper:sniper:campaign:auto-run` (OFFLINE, Rust engine forced absent, risk from ingested
 * token:risk fixtures), then projects it into strategy intelligence with the same risk fixtures.
 * Everything is deterministic and NO network / signer / send is ever touched.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSniperStrategyIntelligence } from "@soulmaker/sniper";
import { paperSniperCampaignAutoRunReport, paperSniperStrategyIntelReport } from "./commands.js";

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const ctx = { engineBinaryExists: () => false };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "strategy-intel-cli-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, value: unknown): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(value, null, 2) + "\n");
  return p;
}

const candidates = (mints: string[]) => write("candidates.json", { candidates: mints.map((m) => ({ candidateId: m.slice(0, 6), mint: m })) });
const riskFixture = (name: string, mint: string, decision: string, flags: Array<{ id: string; severity: string; title: string }> = []) =>
  write(name, { mint, score: decision === "REJECT" ? 90 : 10, decision, flags, summary: [], generatedAt: "2026-06-14T00:00:00.000Z", disclaimer: "advisory only" });

async function makeCampaign(): Promise<string> {
  const candidatesPath = candidates([WSOL, USDC]);
  const passRisk = riskFixture("risk.wsol.json", WSOL, "PASS_FOR_PAPER_EVALUATION");
  const rejectRisk = riskFixture("risk.usdc.json", USDC, "REJECT", [{ id: "freeze-authority-present", severity: "critical", title: "Freeze authority present" }]);
  const out = join(dir, "alpha");
  const { exitCode } = await paperSniperCampaignAutoRunReport(ctx, {
    candidatesPath,
    risks: [`${WSOL}=${passRisk}`, `${USDC}=${rejectRisk}`],
    outDir: out,
    runId: "intel-test",
    evidenceProvenance: "fixture",
  });
  expect(exitCode).toBe(0);
  return join(out, "campaign.json");
}

describe("paper:sniper:strategy:intel — over a real campaign", () => {
  it("projects intelligence and surfaces the freeze-authority flag by name; artifact validates", async () => {
    const campaignPath = await makeCampaign();
    const out = join(dir, "intel.json");
    const { text, exitCode } = paperSniperStrategyIntelReport(ctx, {
      campaignPath,
      risks: [`${WSOL}=${join(dir, "risk.wsol.json")}`, `${USDC}=${join(dir, "risk.usdc.json")}`],
      intelligenceId: "demo-intel",
      evidenceProvenance: "fixture",
      outPath: out,
    });
    expect(exitCode).toBe(0);
    expect(text).toContain("LIVE TRADING IS DISABLED");
    expect(existsSync(out)).toBe(true);
    const intel = validateSniperStrategyIntelligence(JSON.parse(readFileSync(out, "utf8")));
    expect(intel.candidateCount).toBe(2);
    expect(intel.liveTradingStatus).toBe("disabled");
    expect(intel.notAProfitabilityClaim).toBe(true);
    const usdc = intel.candidates.find((c) => c.mint === USDC)!;
    expect(usdc.verdict).toBe("blocked");
    expect(usdc.mintClass).toBe("stablecoin");
    expect(usdc.notableFlags.map((f) => f.id)).toContain("freeze-authority-present");
    expect(usdc.reasonCodes).toContain("authority-freeze-present");
    const wsol = intel.candidates.find((c) => c.mint === WSOL)!;
    expect(wsol.mintClass).toBe("wrapped-sol");
    expect(intel.topConcerns.some((c) => c.flagId === "freeze-authority-present")).toBe(true);
  });

  it("emits machine-readable JSON with --json", async () => {
    const campaignPath = await makeCampaign();
    const { exitCode, text } = paperSniperStrategyIntelReport(ctx, { campaignPath, json: true });
    expect(exitCode).toBe(0);
    const intel = JSON.parse(text);
    expect(intel.schemaVersion).toBe("sniper.strategy_intelligence.v1");
    // No risk reports supplied -> the blocked candidate is still blocked (verdict from the campaign).
    expect(intel.verdictCounts.blocked).toBe(1);
  });

  it("--fail-on-blocked exits non-zero when a candidate is blocked", async () => {
    const campaignPath = await makeCampaign();
    const { exitCode } = paperSniperStrategyIntelReport(ctx, { campaignPath, failOnBlocked: true });
    expect(exitCode).toBe(1);
  });

  it("refuses without --campaign", () => {
    const { exitCode, text } = paperSniperStrategyIntelReport(ctx, {});
    expect(exitCode).toBe(1);
    expect(text).toContain("Refusing");
  });

  it("refuses a malformed --risk argument", async () => {
    const campaignPath = await makeCampaign();
    const { exitCode, text } = paperSniperStrategyIntelReport(ctx, { campaignPath, risks: ["just-a-path"] });
    expect(exitCode).toBe(1);
    expect(text).toContain("Refusing");
  });
});
