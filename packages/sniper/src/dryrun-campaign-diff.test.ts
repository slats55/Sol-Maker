import { describe, it, expect } from "vitest";
import { buildSniperDryRunCampaign, type SniperDryRunCampaignCandidateInput } from "./dryrun-campaign.js";
import {
  diffSniperDryRunCampaigns,
  validateSniperDryRunCampaignDiff,
  formatSniperDryRunCampaignDiff,
  SniperDryRunCampaignDiffError,
  SNIPER_DRYRUN_CAMPAIGN_DIFF_SCHEMA_VERSION,
  SNIPER_DRYRUN_CAMPAIGN_DIFF_BANNER,
  type SniperDryRunCampaignDiff,
} from "./dryrun-campaign-diff.js";

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

function camp(candidates: SniperDryRunCampaignCandidateInput[]) {
  return buildSniperDryRunCampaign({ campaignId: "c", mode: "mainnet-dry-run", candidates });
}

// Reusable candidate shapes (by intent).
const watchC = (mint: string, score = 90): SniperDryRunCampaignCandidateInput => ({
  candidateId: mint.slice(0, 6),
  mint,
  score,
  riskDecision: "PASS_FOR_PAPER_EVALUATION",
  preflightVerdict: "pass",
  quoteStatus: "observed",
});
const blockedC = (mint: string, score = 90): SniperDryRunCampaignCandidateInput => ({
  candidateId: mint.slice(0, 6),
  mint,
  score,
  riskDecision: "REJECT",
});

describe("diffSniperDryRunCampaigns — valid + status detection", () => {
  it("detects added / removed / unchanged / changed and round-trips", () => {
    const before = camp([watchC(WSOL), blockedC(USDC)]);
    // WSOL unchanged; USDC blocked -> watch (improved); BONK added.
    const after = camp([watchC(WSOL), watchC(USDC), watchC(BONK)]);
    const diff = diffSniperDryRunCampaigns({ before, after });
    expect(diff.schemaVersion).toBe(SNIPER_DRYRUN_CAMPAIGN_DIFF_SCHEMA_VERSION);
    const byMint = new Map(diff.candidateChanges.map((c) => [c.mint, c]));
    expect(byMint.get(WSOL)!.status).toBe("unchanged");
    expect(byMint.get(USDC)!.status).toBe("changed");
    expect(byMint.get(USDC)!.verdictBefore).toBe("blocked");
    expect(byMint.get(USDC)!.verdictAfter).toBe("watch");
    expect(byMint.get(BONK)!.status).toBe("added");
    expect(() => validateSniperDryRunCampaignDiff(diff)).not.toThrow();
  });

  it("detects a removed candidate", () => {
    const before = camp([watchC(WSOL), watchC(USDC)]);
    const after = camp([watchC(WSOL)]);
    const diff = diffSniperDryRunCampaigns({ before, after });
    const usdc = diff.candidateChanges.find((c) => c.mint === USDC)!;
    expect(usdc.status).toBe("removed");
    expect(usdc.verdictBefore).toBe("watch");
    expect(usdc.verdictAfter).toBeNull();
  });

  it("re-derives summary counts incl. improved / worsened / newly-blocked / newly-watch", () => {
    const before = camp([blockedC(WSOL), watchC(USDC)]);
    const after = camp([watchC(WSOL), blockedC(USDC)]);
    const diff = diffSniperDryRunCampaigns({ before, after });
    expect(diff.summary.improvedCount).toBe(1); // WSOL blocked -> watch
    expect(diff.summary.worsenedCount).toBe(1); // USDC watch -> blocked
    expect(diff.summary.newlyBlockedCount).toBe(1);
    expect(diff.summary.newlyWatchCount).toBe(1);
    expect(diff.summary.changedCount).toBe(2);
  });

  it("does not count a one-sided add/remove as improvement or regression (no fake movement)", () => {
    const before = camp([watchC(WSOL)]);
    const after = camp([watchC(WSOL), watchC(USDC)]); // USDC added (watch) — NOT an improvement
    const diff = diffSniperDryRunCampaigns({ before, after });
    expect(diff.summary.addedCount).toBe(1);
    expect(diff.summary.improvedCount).toBe(0);
    expect(diff.summary.newlyWatchCount).toBe(0);
  });

  it("reports a score delta only when both campaigns scored the candidate", () => {
    const before = camp([watchC(WSOL, 80)]);
    const after = camp([watchC(WSOL, 95)]);
    const diff = diffSniperDryRunCampaigns({ before, after });
    expect(diff.candidateChanges[0]!.scoreDelta).toBe(15);
    expect(diff.candidateChanges[0]!.status).toBe("changed");

    // A missing score on one side -> null delta, no fake movement.
    const before2 = camp([{ candidateId: "w", mint: WSOL, riskDecision: "PASS_FOR_PAPER_EVALUATION", preflightVerdict: "pass" }]);
    const after2 = camp([watchC(WSOL, 95)]);
    const diff2 = diffSniperDryRunCampaigns({ before: before2, after: after2 });
    expect(diff2.candidateChanges[0]!.scoreDelta).toBeNull();
  });

  it("records blocker changes (added / removed)", () => {
    const before = camp([watchC(WSOL)]);
    const after = camp([blockedC(WSOL)]);
    const diff = diffSniperDryRunCampaigns({ before, after });
    const wsol = diff.candidateChanges[0]!;
    expect(wsol.blockerChanges.some((b) => b.startsWith("added:"))).toBe(true);
  });
});

describe("diffSniperDryRunCampaigns — refusals", () => {
  it("refuses a missing before / after campaign", () => {
    const after = camp([watchC(WSOL)]);
    expect(() => diffSniperDryRunCampaigns({ after } as never)).toThrow(SniperDryRunCampaignDiffError);
    expect(() => diffSniperDryRunCampaigns({ before: after } as never)).toThrow(SniperDryRunCampaignDiffError);
  });

  it("refuses a secret-shaped diffId", () => {
    const c = camp([watchC(WSOL)]);
    expect(() => diffSniperDryRunCampaigns({ before: c, after: c, diffId: "z".repeat(96) })).toThrow(/secret-shaped|exceeds/);
  });
});

describe("validateSniperDryRunCampaignDiff — closed schema + parity wall", () => {
  const base = (): SniperDryRunCampaignDiff => diffSniperDryRunCampaigns({ before: camp([blockedC(WSOL)]), after: camp([watchC(WSOL)]) });

  it("refuses an unknown / signature field (closed schema)", () => {
    for (const field of ["signature", "txid", "sendResult"]) {
      const diff = { ...base(), [field]: "x" } as unknown;
      expect(() => validateSniperDryRunCampaignDiff(diff), field).toThrow(/the schema is CLOSED/);
    }
  });

  it("refuses authorizesLiveTrading true / liveSendStatus enabled", () => {
    expect(() => validateSniperDryRunCampaignDiff({ ...base(), authorizesLiveTrading: true })).toThrow(/authorizesLiveTrading must literally be false/);
    expect(() => validateSniperDryRunCampaignDiff({ ...base(), liveSendStatus: "enabled" })).toThrow(/liveSendStatus must literally be "disabled"/);
  });

  it("catches a tampered summary (re-derived from candidate changes)", () => {
    const diff = base();
    const tampered = { ...diff, summary: { ...diff.summary, improvedCount: diff.summary.improvedCount + 5 } } as unknown;
    expect(() => validateSniperDryRunCampaignDiff(tampered)).toThrow(/summary must be re-derived/);
  });

  it("catches an added change that carries a verdictBefore", () => {
    const before = camp([watchC(WSOL)]);
    const after = camp([watchC(WSOL), watchC(USDC)]);
    const diff = diffSniperDryRunCampaigns({ before, after });
    const idx = diff.candidateChanges.findIndex((c) => c.status === "added");
    const tamperedChanges = diff.candidateChanges.map((c, i) => (i === idx ? { ...c, verdictBefore: "watch" } : c));
    expect(() => validateSniperDryRunCampaignDiff({ ...diff, candidateChanges: tamperedChanges })).toThrow(/added but has a verdictBefore/);
  });

  it("refuses an unknown candidate-change field (closed nested schema)", () => {
    const diff = base();
    const tampered = { ...diff, candidateChanges: diff.candidateChanges.map((c) => ({ ...c, extra: 1 })) } as unknown;
    expect(() => validateSniperDryRunCampaignDiff(tampered)).toThrow(/has unknown field "extra"/);
  });
});

describe("formatSniperDryRunCampaignDiff", () => {
  it("renders a deterministic, banner-led summary", () => {
    const diff = diffSniperDryRunCampaigns({ before: camp([blockedC(WSOL)]), after: camp([watchC(WSOL)]) });
    const text = formatSniperDryRunCampaignDiff(diff, { label: "demo" });
    expect(text).toContain(SNIPER_DRYRUN_CAMPAIGN_DIFF_BANNER);
    expect(text).toContain("improved");
    expect(text).toContain("DISABLED");
    expect(formatSniperDryRunCampaignDiff(diff, { label: "demo" })).toBe(text);
  });
});
