/**
 * Sprint 103-B — `paper:sniper:operator-demo` at the CLI layer (the showable workbench).
 *
 * Pins:
 *   - one command writes a complete, valid demo folder + a sniper.operator_demo.manifest.v1;
 *   - every referenced artifact exists and validates; provenance labels (real-readonly / fixture /
 *     fictional-example) are preserved and the counts are honest;
 *   - the demo needs NO network and NO signer (no RPC/signer seam is injected) — nothing is sent;
 *   - the manifest pins live execution disabled and every artifact has a KNOWN schemaVersion.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validatePhase7AuthorizationAudit, validatePhase7HumanSignoff, validateDevnetFundingStatus } from "@soulmaker/execution";
import {
  validateSniperOperatorDemoManifest as validateManifest,
  validateMainnetDryRunReleaseCandidate as validateRc,
  validateSniperWatchlist,
  validateSniperDryRunCampaign,
  validateSniperReadonlyCampaignPlan,
  validateSniperDryRunCampaignDiff,
  validateSniperAlphaRunReport,
} from "@soulmaker/sniper";
import { paperSniperOperatorDemoReport } from "./commands.js";

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "operator-demo-"));
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe("paper:sniper:operator-demo", () => {
  it("assembles a complete, valid demo folder with honest provenance and live disabled", () => {
    withTmp((tmp) => {
      // No RPC/signer/preview seam injected — proves the demo needs no network and never sends.
      const r = paperSniperOperatorDemoReport(
        { cwd: tmp, now: () => "2026-06-13T00:00:00.000Z" },
        { outDir: "demo", demoId: "demo-1", json: true },
      );
      expect(r.exitCode, r.text.slice(0, 600)).toBe(0);
      const manifest = validateManifest(JSON.parse(r.text));

      expect(manifest.artifactCount).toBe(10);
      expect(manifest.realReadonlyCount).toBe(2);
      expect(manifest.fixtureCount).toBe(1);
      // candidate + release-candidate + watchlist + campaign + plan + diff + alpha-report
      expect(manifest.fictionalExampleCount).toBe(7);
      expect(manifest.allArtifactsValid).toBe(true);
      expect(manifest.liveExecutionDisabled).toBe(true);
      expect(manifest.neverSends).toBe(true);
      expect(manifest.phase7LiveTradingReady).toBe(false);

      // Every referenced artifact exists on disk and validates against its own schema.
      const dir = join(tmp, "demo");
      const files = readdirSync(dir).sort();
      expect(files).toContain("operator-demo-manifest.json");
      expect(files).toContain("README.md");
      for (const a of manifest.artifacts) {
        expect(existsSync(join(dir, a.fileName)), a.fileName).toBe(true);
        expect(a.present).toBe(true);
        expect(a.valid).toBe(true);
        expect(a.schemaVersion === null || typeof a.schemaVersion === "string").toBe(true);
      }

      // Re-validate the real/fixture artifacts through their own validators.
      validatePhase7AuthorizationAudit(JSON.parse(readFileSync(join(dir, "phase7-authorization-audit.json"), "utf8")));
      validatePhase7HumanSignoff(JSON.parse(readFileSync(join(dir, "phase7-signoff-template.json"), "utf8")));
      const funding = validateDevnetFundingStatus(JSON.parse(readFileSync(join(dir, "devnet-funding-status.json"), "utf8")));
      expect(funding.fundingSourceStatus).toBe("unfunded"); // honest funding-blocked fixture
      validateRc(JSON.parse(readFileSync(join(dir, "release-candidate.json"), "utf8")));
      // S104-C operator workflow artifacts: a watchlist + a no-send campaign comparing the candidates.
      validateSniperWatchlist(JSON.parse(readFileSync(join(dir, "watchlist.json"), "utf8")));
      const campaign = validateSniperDryRunCampaign(JSON.parse(readFileSync(join(dir, "campaign.json"), "utf8")));
      expect(campaign.liveSendStatus).toBe("disabled");
      // The demo campaign shows a re-derived spread (watch / review / blocked) — never authorizing a trade.
      expect(campaign.verdictCounts.blocked).toBeGreaterThanOrEqual(1);
      // S105-A alpha workflow artifacts: the plan, a campaign diff, and the alpha run report.
      const plan = validateSniperReadonlyCampaignPlan(JSON.parse(readFileSync(join(dir, "readonly-campaign-plan.json"), "utf8")));
      expect(plan.liveSendStatus).toBe("disabled");
      const diff = validateSniperDryRunCampaignDiff(JSON.parse(readFileSync(join(dir, "campaign-diff.json"), "utf8")));
      expect(diff.authorizesLiveTrading).toBe(false);
      expect(diff.summary.improvedCount).toBeGreaterThanOrEqual(1); // candidate 0 review -> watch
      const alpha = validateSniperAlphaRunReport(JSON.parse(readFileSync(join(dir, "alpha-report.json"), "utf8")));
      expect(alpha.liveTradingStatus).toBe("disabled");
      expect(alpha.evidenceProvenance).toBe("fictional-example");

      // Every showcased stage points at a present artifact role.
      const roles = new Set(manifest.artifacts.map((a) => a.role));
      for (const s of manifest.pipelineStages) expect(roles.has(s.evidencedBy), s.stage).toBe(true);
    });
  });

  it("refuses to overwrite an existing demo without --force", () => {
    withTmp((tmp) => {
      const first = paperSniperOperatorDemoReport({ cwd: tmp, now: () => "2026-06-13T00:00:00.000Z" }, { outDir: "demo" });
      expect(first.exitCode).toBe(0);
      const again = paperSniperOperatorDemoReport({ cwd: tmp, now: () => "2026-06-13T00:00:00.000Z" }, { outDir: "demo" });
      expect(again.exitCode).toBe(1);
      expect(again.text).toContain("already exists");
      const forced = paperSniperOperatorDemoReport({ cwd: tmp, now: () => "2026-06-13T00:00:00.000Z" }, { outDir: "demo", force: true });
      expect(forced.exitCode).toBe(0);
    });
  });

  it("requires --out", () => {
    const r = paperSniperOperatorDemoReport({}, {});
    expect(r.exitCode).toBe(1);
    expect(r.text).toContain("--out <dir> is required");
  });

  it("the demo manifest and all artifacts contain no secret-key material", () => {
    withTmp((tmp) => {
      paperSniperOperatorDemoReport({ cwd: tmp, now: () => "2026-06-13T00:00:00.000Z" }, { outDir: "demo" });
      const dir = join(tmp, "demo");
      for (const f of readdirSync(dir)) {
        const text = readFileSync(join(dir, f), "utf8");
        expect(text, f).not.toMatch(/"secretKey"|"privateKey"/i);
        expect(text, f).not.toMatch(/\[(\s*\d{1,3}\s*,){63}\s*\d{1,3}\s*\]/);
      }
    });
  });
});
