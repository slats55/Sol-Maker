/**
 * Sprint 89 — the shipped `examples/sniper/operator-dress-rehearsal/` fixtures.
 *
 * These tests run the REAL `paper:sniper:dry-run` orchestrator over every shipped rehearsal
 * example and pin, with production validators, exactly the outcomes the folder README documents:
 *
 *   - minimal (no preflight data, draft specs)  → blocked (6 conditions, route `blocked`);
 *   - rich (clean paper-enter path, adopted)    → blocked on prereqs review (route `unavailable`);
 *   - watch-only (freeze authority, adopted)    → reviewable-paper-only (route `no_entries`);
 *   - blocked-risk (critical REJECT, adopted)   → blocked (audit not clean, route `blocked`);
 *   - byte determinism over a rehearsal run, and README/code agreement.
 *
 * Everything is a FICTIONAL fixture — invented mints and invented inspection/risk values; nothing
 * is live data, a trade signal, or a profitability claim. If pipeline behavior changes, this suite
 * fails loudly so the README is updated alongside it.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePhase6OperatorBundleV1 } from "@soulmaker/simulation";
import {
  paperSniperDryRunReport,
  paperSniperCandidatesValidateReport,
  paperSniperPreflightInputValidateReport,
  PAPER_DRY_RUN_FILES,
} from "./commands.js";

const REHEARSAL_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../examples/sniper/operator-dress-rehearsal",
);

const readJson = (dir: string, name: string): unknown => JSON.parse(readFileSync(join(dir, name), "utf8"));

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "rehearsal-"));
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Each shipped rehearsal with the EXACT outcome its README documents (a snapshot of intent). */
const REHEARSALS = [
  {
    name: "minimal",
    opts: { candidatesPath: join(REHEARSAL_DIR, "candidates.minimal.json") },
    verdict: "blocked",
    routeStatus: "blocked",
    codes: [
      "simulation-blocked-prereqs-not-ready",
      "simulation-blocked-kill-switch-not-adopted",
      "simulation-blocked-secrets-policy-not-adopted",
      "simulation-blocked-burner-isolation-not-adopted",
      "simulation-dry-run-skipped-blocked-plan",
      "simulation-route-resolution-blocked-plan",
    ],
  },
  {
    name: "rich",
    opts: {
      candidatesPath: join(REHEARSAL_DIR, "candidates.rich.json"),
      preflightInputPath: join(REHEARSAL_DIR, "preflight-input.rich.json"),
      adoptSpecs: true,
      acknowledgePaperEnterReview: true,
      operatorLabel: "rehearsal-operator",
      runLabel: "rehearsal-rich",
    },
    verdict: "blocked",
    routeStatus: "unavailable",
    codes: ["simulation-blocked-prereqs-not-ready"],
  },
  {
    name: "watch-only",
    opts: {
      candidatesPath: join(REHEARSAL_DIR, "candidates.watch-only.json"),
      preflightInputPath: join(REHEARSAL_DIR, "preflight-input.watch-only.json"),
      adoptSpecs: true,
      operatorLabel: "rehearsal-operator",
      runLabel: "rehearsal-watch-only",
    },
    verdict: "reviewable-paper-only",
    routeStatus: "no_entries",
    codes: [],
  },
  {
    name: "blocked-risk",
    opts: {
      candidatesPath: join(REHEARSAL_DIR, "candidates.blocked-risk.json"),
      preflightInputPath: join(REHEARSAL_DIR, "preflight-input.blocked-risk.json"),
      adoptSpecs: true,
      operatorLabel: "rehearsal-operator",
      runLabel: "rehearsal-blocked-risk",
    },
    verdict: "blocked",
    routeStatus: "blocked",
    codes: [
      "simulation-blocked-prereqs-not-ready",
      "simulation-dry-run-skipped-blocked-plan",
      "simulation-route-resolution-blocked-plan",
    ],
  },
] as const;

describe("examples/sniper/operator-dress-rehearsal — every rehearsal runs as documented", () => {
  for (const r of REHEARSALS) {
    it(`${r.name}: writes the full artifact set with the documented verdict + blocking codes`, () => {
      withTmp((tmp) => {
        const out = paperSniperDryRunReport({ cwd: tmp, env: {} }, { ...r.opts, outDir: "out" });
        expect(out.exitCode, out.text.slice(0, 300)).toBe(0);
        const dir = join(tmp, "out");
        expect(readdirSync(dir).sort()).toEqual([...PAPER_DRY_RUN_FILES].sort());
        const bundle = validatePhase6OperatorBundleV1(readJson(dir, "operator-bundle.json"));
        expect(bundle.operatorVerdict).toBe(r.verdict);
        expect(bundle.routeResolutionStatus).toBe(r.routeStatus);
        expect([...bundle.chainBlockingCodes].sort()).toEqual([...r.codes].sort());
        expect(bundle.complete).toBe(true);
        expect(bundle.blockingTrailConsistent).toBe(true);
        const summary = readFileSync(join(dir, "RUN_SUMMARY.md"), "utf8");
        expect(summary).toContain("SIMULATION ONLY");
        expect(summary).not.toMatch(/ready for live|live-ready/i);
      });
    });
  }

  it("the committed web demo fixture IS the rich rehearsal's exact output (no drift)", () => {
    // apps/web/fixtures/dry-run-sample/ is a real, committed orchestrator output used by the web
    // inspector's dry-run overview tests and demo. Regenerate it here and byte-compare: if pipeline
    // output ever changes, this fails loudly and the fixture must be regenerated alongside.
    const fixtureDir = join(REHEARSAL_DIR, "../../../apps/web/fixtures/dry-run-sample");
    withTmp((tmp) => {
      const rich = REHEARSALS[1];
      expect(paperSniperDryRunReport({ cwd: tmp, env: {} }, { ...rich.opts, outDir: "out" }).exitCode).toBe(0);
      expect(readdirSync(fixtureDir).sort()).toEqual([...PAPER_DRY_RUN_FILES].sort());
      for (const f of PAPER_DRY_RUN_FILES) {
        expect(readFileSync(join(fixtureDir, f), "utf8"), f).toBe(readFileSync(join(tmp, "out", f), "utf8"));
      }
    });
  });

  it("the rich rehearsal is byte-deterministic across two runs", () => {
    withTmp((tmp) => {
      const rich = REHEARSALS[1];
      expect(paperSniperDryRunReport({ cwd: tmp, env: {} }, { ...rich.opts, outDir: "a" }).exitCode).toBe(0);
      expect(paperSniperDryRunReport({ cwd: tmp, env: {} }, { ...rich.opts, outDir: "b" }).exitCode).toBe(0);
      for (const f of PAPER_DRY_RUN_FILES) {
        expect(readFileSync(join(tmp, "b", f), "utf8"), f).toBe(readFileSync(join(tmp, "a", f), "utf8"));
      }
    });
  });
});

describe("examples/sniper/operator-dress-rehearsal — inputs validate with the production validators", () => {
  const ctx = { cwd: REHEARSAL_DIR, env: {} };

  for (const name of ["minimal", "rich", "watch-only", "blocked-risk"] as const) {
    it(`candidates.${name}.json validates and normalizes`, () => {
      const r = paperSniperCandidatesValidateReport(ctx, { inputPath: `candidates.${name}.json`, json: true });
      expect(r.exitCode).toBe(0);
      const list = JSON.parse(r.text) as { schemaVersion: string; warnings: string[] };
      expect(list.schemaVersion).toBe("sniper.candidate.list.v1");
      expect(list.warnings).toEqual([]);
    });
  }

  for (const name of ["rich", "watch-only", "blocked-risk"] as const) {
    it(`preflight-input.${name}.json validates + cross-checks against its candidate list`, () => {
      const r = paperSniperPreflightInputValidateReport(ctx, {
        inputPath: `preflight-input.${name}.json`,
        candidatesPath: `candidates.${name}.json`,
        json: true,
      });
      expect(r.exitCode).toBe(0);
      const artifact = JSON.parse(r.text) as {
        schemaVersion: string;
        crossCheckedAgainstCandidateList: boolean;
        uncoveredCandidateCount: number;
      };
      expect(artifact.schemaVersion).toBe("sniper.preflight.input.v1");
      expect(artifact.crossCheckedAgainstCandidateList).toBe(true);
      expect(artifact.uncoveredCandidateCount).toBe(0);
    });
  }

  it("the README documents the exact verdicts and lead blocking code this suite pins", () => {
    const readme = readFileSync(join(REHEARSAL_DIR, "README.md"), "utf8");
    expect(readme).toContain("`reviewable-paper-only`");
    expect(readme).toContain("`blocked`");
    expect(readme).toContain("simulation-blocked-prereqs-not-ready");
    expect(readme).toContain("paper:sniper:dry-run");
    expect(readme).toContain("web:inspect");
    // The fixture disclaimers stay loud.
    expect(readme).toMatch(/FICTIONAL/);
    expect(readme).toMatch(/NOT financial advice/);
  });
});
