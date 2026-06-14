/**
 * Sprint 107 — regenerate the committed REDACTED EXAMPLE artifacts in
 * `examples/sniper/alpha-artifacts/`.
 *
 * Every artifact is produced THROUGH PRODUCTION CODE (the same builders the CLI uses) over INJECTED,
 * operator-shaped evidence, with NO wall-clock, so the committed files are byte-deterministic and always
 * match what the real `paper:sniper:alpha:history` / `:diff` / `:trend` and `paper:sniper:strategy:intel`
 * commands would write for these facts. The pin test (`apps/cli/src/alpha-artifact-examples.test.ts`)
 * imports {@link buildAlphaArtifactExamples} and fails loudly if the committed files drift, re-validates
 * each with its production validator, and asserts every no-send / live-disabled literal.
 *
 * Run: `pnpm tsx scripts/gen-alpha-artifact-examples.ts`
 *
 * Everything here is a REDACTED EXAMPLE: well-known public mints used purely as deterministic fixtures
 * (NOT a recommendation, NOT real analysis), evidence provenance honestly labelled `fixture`. No network,
 * no wallet, no key, no transaction, no live result, no profitability claim.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// Relative source imports: the root scripts/ folder is not a workspace package, so the @soulmaker/*
// specifiers do not resolve here. These are the same production modules the CLI uses.
import { redactValue } from "../packages/security/src/index.js";
import {
  buildSniperDryRunCampaign,
  type SniperDryRunCampaign,
  type SniperDryRunCampaignCandidateInput,
} from "../packages/sniper/src/dryrun-campaign.js";
import { buildSniperAlphaRunReport, type SniperAlphaRunReport } from "../packages/sniper/src/alpha-run-report.js";
import { buildSniperAlphaHistory, type SniperAlphaHistory, type SniperAlphaHistoryRunInput } from "../packages/sniper/src/alpha-history.js";
import { diffSniperAlphaHistories } from "../packages/sniper/src/alpha-history-diff.js";
import { buildSniperAlphaHistoryTrend } from "../packages/sniper/src/alpha-history-trend.js";
import { buildSniperStrategyIntelligence } from "../packages/sniper/src/strategy-intelligence.js";

// Well-known public mints, used here ONLY as deterministic fixtures (never a recommendation).
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const cand = (over: Partial<SniperDryRunCampaignCandidateInput> & { candidateId: string; mint: string }): SniperDryRunCampaignCandidateInput => over;

const clean = (id: string, mint: string, score = 88): SniperDryRunCampaignCandidateInput =>
  cand({ candidateId: id, mint, score, riskDecision: "PASS_FOR_PAPER_EVALUATION", quoteStatus: "observed", buildStatus: "succeeded", simulationStatus: "simulated-ok", preflightVerdict: "pass" });

const rejected = (id: string, mint: string): SniperDryRunCampaignCandidateInput =>
  cand({ candidateId: id, mint, riskDecision: "REJECT" });

function campaign(candidates: SniperDryRunCampaignCandidateInput[]): SniperDryRunCampaign {
  return buildSniperDryRunCampaign({ candidates, mode: "mainnet-dry-run" });
}

function report(c: SniperDryRunCampaign, providerHealth: Record<string, string>): SniperAlphaRunReport {
  return buildSniperAlphaRunReport({
    campaign: c,
    campaignRef: "campaign.json",
    campaignPlanRef: "readonly-campaign-plan.json",
    evidenceProvenance: "fixture",
    providerHealth,
    rustEngineStatus: "available",
    phase7Status: "authorized-for-design-only",
  });
}

function run(runRef: string, candidates: SniperDryRunCampaignCandidateInput[], providerHealth: Record<string, string> = { risk: "ok", quote: "ok", simulation: "ok" }): SniperAlphaHistoryRunInput {
  const c = campaign(candidates);
  return { runRef, campaign: c, report: report(c, providerHealth) };
}

/** The "monday" history: a shared run with one blocked candidate, plus a run only seen on monday. */
function mondayHistory(): SniperAlphaHistory {
  return buildSniperAlphaHistory({
    historyId: "example-alpha-history-mon",
    runs: [
      run("runs/alpha-mon", [clean("wsol", WSOL), rejected("usdc", USDC)]),
      run("runs/alpha-only-monday", [clean("bonk", BONK)], { risk: "unavailable", quote: "unavailable", simulation: "unavailable" }),
    ],
  });
}

/** The "tuesday" history: the shared run's blocker cleared, and a new run appeared. */
function tuesdayHistory(): SniperAlphaHistory {
  return buildSniperAlphaHistory({
    historyId: "example-alpha-history-tue",
    runs: [
      run("runs/alpha-mon", [clean("wsol", WSOL), clean("usdc", USDC)]),
      run("runs/alpha-only-tuesday", [rejected("bonk", BONK)]),
    ],
  });
}

/** The "wednesday" history: stable, all clear (used only to give the trend a third snapshot). */
function wednesdayHistory(): SniperAlphaHistory {
  return buildSniperAlphaHistory({
    historyId: "example-alpha-history-wed",
    runs: [run("runs/alpha-mon", [clean("wsol", WSOL), clean("usdc", USDC), clean("bonk", BONK)])],
  });
}

/** A risk-report input shaped like a `token:risk --json` file (fixed date — never "today"). */
const riskReport = (mint: string, decision: string, flags: Array<{ id: string; severity: string; title: string }>, score: number) => ({
  mint,
  report: { mint, score, decision, flags, summary: [], generatedAt: "2026-01-01T00:00:00.000Z", disclaimer: "advisory only" },
});

/**
 * Build every committed example artifact through the production builders. Pure and deterministic — the
 * same inputs always yield byte-identical artifacts. Returns a filename -> artifact map.
 */
export function buildAlphaArtifactExamples(): Record<string, unknown> {
  const monday = mondayHistory();
  const tuesday = tuesdayHistory();
  const wednesday = wednesdayHistory();

  const diff = diffSniperAlphaHistories({
    diffId: "example-alpha-history-diff",
    base: monday,
    next: tuesday,
    baseRef: "alpha-history-mon.json",
    nextRef: "alpha-history-tue.json",
  });

  const trend = buildSniperAlphaHistoryTrend({
    trendId: "example-alpha-history-trend",
    snapshots: [
      { label: "monday", history: monday },
      { label: "tuesday", history: tuesday },
      { label: "wednesday", history: wednesday },
    ],
  });

  const intelCampaign = campaign([clean("wsol", WSOL), rejected("usdc", USDC), cand({ candidateId: "bonk", mint: BONK, watchlistStatus: "watch" })]);
  const strategyIntelligence = buildSniperStrategyIntelligence({
    intelligenceId: "example-strategy-intelligence",
    campaign: intelCampaign,
    evidenceProvenance: "fixture",
    riskReports: [
      riskReport(WSOL, "PASS_FOR_PAPER_EVALUATION", [], 5),
      riskReport(USDC, "REJECT", [{ id: "freeze-authority-present", severity: "critical", title: "Freeze authority present" }], 100),
    ],
  });

  // Same byte format the CLI's --out writes: redactValue() then 2-space JSON + trailing newline.
  return {
    "alpha-history-mon.example.json": redactValue(monday),
    "alpha-history-tue.example.json": redactValue(tuesday),
    "alpha-history-diff.example.json": redactValue(diff),
    "alpha-history-trend.example.json": redactValue(trend),
    "strategy-intelligence.example.json": redactValue(strategyIntelligence),
  };
}

// Write the files only when executed directly (the pin test imports the builder above).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "../examples/sniper/alpha-artifacts");
  mkdirSync(dir, { recursive: true });
  const artifacts = buildAlphaArtifactExamples();
  for (const [name, value] of Object.entries(artifacts)) {
    writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + "\n");
    console.log(`wrote ${join(dir, name)}`);
  }
}
