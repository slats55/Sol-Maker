/**
 * Sprint 104-C — `paper:sniper:campaign:run` (the dry-run campaign).
 *
 * Compare candidates across the evidence the operator already gathered (ranking / risk / quote /
 * dry-run), joined BY MINT, into a no-send `sniper.dryrun.campaign.v1` folder. These tests pin:
 *   - a fixture campaign with multiple candidates landing different verdicts (blocked / insufficient /
 *     watch) — the per-candidate verdict is re-derived, so a high score cannot rescue a blocked one;
 *   - honest handling when an evidence stage is absent (Rust score / risk unavailable);
 *   - the output folder is written (campaign.json + RUN_SUMMARY.md) and validates;
 *   - refusals (no spine, both spines, malformed supplied evidence);
 *   - no send / sign seam exists (liveSendStatus pinned disabled) + --json determinism.
 *
 * The preflight evidence is generated THROUGH the production preflight command; the release candidate
 * is the byte-pinned committed example. All mints are well-known public keys used purely as
 * deterministic fixtures. Nothing here is live data, a trade signal, or a profitability claim.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSniperDryRunCampaign } from "@soulmaker/sniper";
import { paperSniperCampaignRunReport, paperSniperPreflightReport } from "./commands.js";

const ENGINE_SNIPER_SCORE_SCHEMA_VERSION = "engine.sniper.score.report.v1";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../../..");
const RC_COMPLETE = join(ROOT, "examples/sniper/mainnet-dryrun-release-candidate/release-candidate.complete.example.json");

const WSOL = "So11111111111111111111111111111111111111112"; // A — watch
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // B — blocked (risk REJECT)
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"; // C — review (preflight unknown)
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"; // D — insufficient (no evidence)

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "campaign-"));
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const cleanInspection = (mint: string) => ({
  mint,
  decimals: 6,
  supplyRaw: "1",
  uiSupply: 1,
  mintAuthorityPresent: false,
  freezeAuthorityPresent: false,
  isInitialized: true,
  programLabel: "spl-token",
});
const riskPass = (mint: string) => ({ mint, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [], summary: [] });
const riskReject = (mint: string) => ({
  mint,
  score: 100,
  decision: "REJECT",
  flags: [{ id: "freeze-authority", severity: "critical", title: "Freeze authority present" }],
  summary: [],
});

function writeJson(dir: string, name: string, value: unknown): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(value, null, 2));
  return p;
}

/** Build a preflight report over A (pass), B (fail/REJECT), C (unknown) via the production command. */
function buildPreflight(tmp: string): string {
  writeJson(tmp, "spine.json", {
    candidates: [
      { candidateId: "a", mint: WSOL },
      { candidateId: "b", mint: USDC },
      { candidateId: "c", mint: BONK },
      { candidateId: "d", mint: JUP },
    ],
  });
  writeJson(tmp, "pf-cands.json", { candidates: [{ candidateId: "a", mint: WSOL }, { candidateId: "b", mint: USDC }, { candidateId: "c", mint: BONK }] });
  writeJson(tmp, "a.insp.json", cleanInspection(WSOL));
  writeJson(tmp, "a.risk.json", riskPass(WSOL));
  writeJson(tmp, "b.insp.json", cleanInspection(USDC));
  writeJson(tmp, "b.risk.json", riskReject(USDC));
  const r = paperSniperPreflightReport(
    { cwd: tmp },
    {
      candidatesPath: "pf-cands.json",
      inspections: ["a=a.insp.json", "b=b.insp.json"],
      risks: ["a=a.risk.json", "b=b.risk.json"],
      outPath: "pf.json",
    },
  );
  expect(r.exitCode).toBe(0);
  return "pf.json";
}

describe("paper:sniper:campaign:run — comparison + verdicts", () => {
  it("compares 4 candidates landing watch / blocked / review / insufficient-evidence", () => {
    withTmp((tmp) => {
      const pf = buildPreflight(tmp);
      writeJson(tmp, "score.json", {
        schemaVersion: ENGINE_SNIPER_SCORE_SCHEMA_VERSION,
        rankedCandidates: [
          { candidateId: "a", mint: WSOL, rank: 1, score: 95 },
          { candidateId: "b", mint: USDC, rank: 2, score: 99 }, // a high score must NOT rescue the blocked B
        ],
      });
      const r = paperSniperCampaignRunReport(
        { cwd: tmp },
        {
          candidatesPath: "spine.json",
          preflightPath: pf,
          scorePath: "score.json",
          releaseCandidates: [`${WSOL}=${RC_COMPLETE}`],
          json: true,
        },
      );
      expect(r.exitCode).toBe(0);
      const campaign = JSON.parse(r.text);
      expect(() => validateSniperDryRunCampaign(campaign)).not.toThrow();
      const byMint = Object.fromEntries(campaign.candidates.map((c: { mint: string }) => [c.mint, c]));
      expect(byMint[WSOL].finalOperatorVerdict).toBe("watch");
      expect(byMint[USDC].finalOperatorVerdict).toBe("blocked"); // risk REJECT
      expect(byMint[USDC].score).toBe(99); // score is recorded…
      expect(byMint[USDC].blockers.length).toBeGreaterThan(0); // …but never overrides the block
      expect(byMint[BONK].finalOperatorVerdict).toBe("review"); // preflight unknown
      expect(byMint[JUP].finalOperatorVerdict).toBe("insufficient-evidence"); // no evidence
      expect(campaign.verdictCounts).toEqual({ watch: 1, review: 1, blocked: 1, insufficientEvidence: 1 });
      expect(campaign.liveSendStatus).toBe("disabled");
    });
  });

  it("attaches deep risk from --risk <mint=path> (token:risk) over a mint with no preflight", () => {
    withTmp((tmp) => {
      writeJson(tmp, "spine.json", { candidates: [{ candidateId: "c", mint: BONK }] });
      writeJson(tmp, "c.risk.json", riskReject(BONK));
      const r = paperSniperCampaignRunReport({ cwd: tmp }, { candidatesPath: "spine.json", risks: [`${BONK}=c.risk.json`], json: true });
      expect(r.exitCode).toBe(0);
      const campaign = JSON.parse(r.text);
      expect(campaign.candidates[0].finalOperatorVerdict).toBe("blocked");
      expect(campaign.candidates[0].riskDecision).toBe("REJECT");
    });
  });
});

describe("paper:sniper:campaign:run — honest absence", () => {
  it("with no risk/score evidence, every candidate is insufficient-evidence (not silently 'fine')", () => {
    withTmp((tmp) => {
      writeJson(tmp, "spine.json", { candidates: [{ candidateId: "a", mint: WSOL }, { candidateId: "b", mint: USDC }] });
      const r = paperSniperCampaignRunReport({ cwd: tmp }, { candidatesPath: "spine.json", json: true });
      expect(r.exitCode).toBe(0);
      const campaign = JSON.parse(r.text);
      expect(campaign.verdictCounts.insufficientEvidence).toBe(2);
      expect(campaign.verdictCounts.watch).toBe(0);
    });
  });

  it("works from a watchlist spine and carries the watchlist status through", () => {
    withTmp((tmp) => {
      // A blocked watchlist status alone forces a blocked verdict (no other evidence needed).
      writeJson(tmp, "wl.json", {
        schemaVersion: "sniper.watchlist.v1",
        entries: [{ mint: USDC, status: "blocked" }],
      });
      // Normalize via the prepare path is simpler — but a raw watchlist is accepted too.
      const raw = { entries: [{ mint: USDC, status: "blocked" }] };
      writeJson(tmp, "wl-raw.json", raw);
      const r = paperSniperCampaignRunReport({ cwd: tmp }, { watchlistPath: "wl-raw.json", json: true });
      expect(r.exitCode).toBe(0);
      const campaign = JSON.parse(r.text);
      expect(campaign.candidates[0].watchlistStatus).toBe("blocked");
      expect(campaign.candidates[0].finalOperatorVerdict).toBe("blocked");
    });
  });
});

describe("paper:sniper:campaign:run — output folder", () => {
  it("writes campaign.json + RUN_SUMMARY.md and refuses overwrite without --force", () => {
    withTmp((tmp) => {
      writeJson(tmp, "spine.json", { candidates: [{ candidateId: "a", mint: WSOL }] });
      const outDir = join(tmp, "campaign");
      const r1 = paperSniperCampaignRunReport({ cwd: tmp }, { candidatesPath: "spine.json", outDir });
      expect(r1.exitCode).toBe(0);
      expect(existsSync(join(outDir, "campaign.json"))).toBe(true);
      expect(existsSync(join(outDir, "RUN_SUMMARY.md"))).toBe(true);
      expect(() => validateSniperDryRunCampaign(JSON.parse(readFileSync(join(outDir, "campaign.json"), "utf8")))).not.toThrow();
      const r2 = paperSniperCampaignRunReport({ cwd: tmp }, { candidatesPath: "spine.json", outDir });
      expect(r2.exitCode).toBe(1);
      expect(r2.text).toContain("already exists");
    });
  });

  it("--fail-on-blocked sets a non-zero exit when a candidate is blocked", () => {
    withTmp((tmp) => {
      writeJson(tmp, "spine.json", { candidates: [{ candidateId: "b", mint: USDC }] });
      writeJson(tmp, "b.risk.json", riskReject(USDC));
      const r = paperSniperCampaignRunReport({ cwd: tmp }, { candidatesPath: "spine.json", risks: [`${USDC}=b.risk.json`], failOnBlocked: true });
      expect(r.exitCode).toBe(1);
    });
  });

  it("does not write any file when --out is omitted (no-write default)", () => {
    withTmp((tmp) => {
      writeJson(tmp, "spine.json", { candidates: [{ candidateId: "a", mint: WSOL }] });
      const r = paperSniperCampaignRunReport({ cwd: tmp }, { candidatesPath: "spine.json" });
      expect(r.exitCode).toBe(0);
      expect(existsSync(join(tmp, "campaign.json"))).toBe(false);
    });
  });
});

describe("paper:sniper:campaign:run — refusals + determinism", () => {
  it("refuses with no spine and with both spines", () => {
    expect(paperSniperCampaignRunReport({}, {}).exitCode).toBe(1);
    expect(paperSniperCampaignRunReport({}, { candidatesPath: "a.json", watchlistPath: "b.json" }).exitCode).toBe(1);
  });

  it("refuses a malformed supplied evidence file (operator pointed at a bad file)", () => {
    withTmp((tmp) => {
      writeJson(tmp, "spine.json", { candidates: [{ candidateId: "a", mint: WSOL }] });
      writeFileSync(join(tmp, "score.json"), "{ not json");
      const r = paperSniperCampaignRunReport({ cwd: tmp }, { candidatesPath: "spine.json", scorePath: "score.json" });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("Refusing");
    });
  });

  it("emits parseable, deterministic --json with a schemaVersion and no secret-length blob", () => {
    withTmp((tmp) => {
      writeJson(tmp, "spine.json", { candidates: [{ candidateId: "a", mint: WSOL }, { candidateId: "b", mint: USDC }] });
      const first = paperSniperCampaignRunReport({ cwd: tmp }, { candidatesPath: "spine.json", json: true }).text;
      const second = paperSniperCampaignRunReport({ cwd: tmp }, { candidatesPath: "spine.json", json: true }).text;
      expect(first).toBe(second);
      const parsed = JSON.parse(first);
      expect(parsed.schemaVersion).toBe("sniper.dryrun.campaign.v1");
      expect(/[1-9A-HJ-NP-Za-km-z]{80,}/.test(first)).toBe(false);
    });
  });
});
