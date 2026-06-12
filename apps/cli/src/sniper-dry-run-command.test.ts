/**
 * Sprint 88 — `paper:sniper:dry-run` (the PAPER dry-run orchestrator) and
 * `paper:simulation:bundle` (the operator bundle) through the REAL command functions.
 *
 * The orchestrator is the operator's one command: candidate file in → the FULL validated artifact
 * directory out (sniper chain + Phase 6 simulation chain + operator bundle + RUN_SUMMARY.md).
 * These tests pin, with production validators:
 *
 *   - the happy path over FICTIONAL candidates (clean risk → honest blocked-on-prereqs-review
 *     verdict; freeze-authority/watch-only → reviewable-paper-only);
 *   - refusals: missing/malformed candidate file, invalid mint, secret-shaped mint, missing --out,
 *     --adopt-specs without --operator, existing files without --force;
 *   - the honest degraded paths: no preflight data → unknown preflight → fail-closed chain;
 *     draft specs → blocked chain; route ALWAYS honestly unavailable;
 *   - byte determinism across two full runs;
 *   - registration + flag pinning for both commands;
 *   - secret hygiene over every produced file.
 *
 * Everything here is invented; nothing is live data, a trade signal, or a profitability claim.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FICTIONAL_MINT_A,
  FICTIONAL_MINT_B,
  validateSimulationIntentPlanV2,
  validateSimulationResultV1,
  validateSimulationRouteResolutionV1,
  validatePhase6AuditReportV1,
  validatePhase6SimulationReadinessReportV1,
  validatePhase6SimulationHandoffPackV1,
  validatePhase6OperatorBundleV1,
  type Phase6OperatorBundleV1,
} from "@soulmaker/simulation";
import {
  paperSniperDryRunReport,
  paperSimulationBundleReport,
  PAPER_DRY_RUN_FILES,
} from "./commands.js";

const readJson = (dir: string, name: string): unknown => JSON.parse(readFileSync(join(dir, name), "utf8"));

/** Write a FICTIONAL operator candidate file (clean or freeze-authority data). */
function writeCandidateInputs(dir: string, opts: { freezeAuthority: boolean }): void {
  writeFileSync(
    join(dir, "candidates.input.json"),
    JSON.stringify({
      sourceLabel: "fictional-dry-run-candidates",
      candidates: [
        { candidateId: "dr-a", mint: FICTIONAL_MINT_A, symbol: "FICA", sourceTag: "fixture", observedLiquidityUsd: 50000 },
        { candidateId: "dr-b", mint: FICTIONAL_MINT_B, symbol: "FICB", sourceTag: "fixture", observedLiquidityUsd: 45000 },
      ],
    }, null, 2),
  );
  const inspection = (mint: string) => ({
    mint,
    decimals: 6,
    mintAuthorityPresent: false,
    freezeAuthorityPresent: opts.freezeAuthority,
    isInitialized: true,
    programLabel: "spl-token",
  });
  const risk = (mint: string) => ({
    mint,
    score: 10,
    decision: "PASS_FOR_PAPER_EVALUATION",
    flags: [],
    summary: ["fictional: no concern in invented data"],
  });
  writeFileSync(
    join(dir, "preflight.input.json"),
    JSON.stringify({
      sourceLabel: "fictional-dry-run-preflight-input",
      entries: [
        { candidateId: "dr-a", mint: FICTIONAL_MINT_A, inspection: inspection(FICTIONAL_MINT_A), risk: risk(FICTIONAL_MINT_A) },
        { candidateId: "dr-b", mint: FICTIONAL_MINT_B, inspection: inspection(FICTIONAL_MINT_B), risk: risk(FICTIONAL_MINT_B) },
      ],
    }, null, 2),
  );
}

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "dry-run-"));
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const HAPPY_OPTS = {
  candidatesPath: "candidates.input.json",
  preflightInputPath: "preflight.input.json",
  adoptSpecs: true,
  acknowledgePaperEnterReview: true,
  operatorLabel: "fictional-operator",
  runLabel: "fictional-dry-run",
} as const;

describe("paper:sniper:dry-run — happy path over fictional candidates", () => {
  it("writes the FULL artifact set; every artifact validates; the verdict is honest", () => {
    withTmp((tmp) => {
      writeCandidateInputs(tmp, { freezeAuthority: false });
      const ctx = { cwd: tmp, env: {} };
      const r = paperSniperDryRunReport(ctx, { ...HAPPY_OPTS, outDir: "out" });
      expect(r.exitCode, r.text.slice(0, 300)).toBe(0);
      const out = join(tmp, "out");
      expect(readdirSync(out).sort()).toEqual([...PAPER_DRY_RUN_FILES].sort());
      const plan = validateSimulationIntentPlanV2(readJson(out, "intent-plan.json"));
      expect(plan.blocked).toBe(false);
      expect(plan.entryCount).toBe(2);
      const result = validateSimulationResultV1(readJson(out, "simulation-result.json"));
      expect(result.resultStatus).toBe("skipped_unresolved"); // honest: nothing simulated from unresolved previews
      const route = validateSimulationRouteResolutionV1(readJson(out, "route-resolution.json"));
      expect(route.resolutionStatus).toBe("unavailable"); // honest boundary: no resolver capability exists
      expect(route.routeResolverAttempted).toBe(false);
      const audit = validatePhase6AuditReportV1(readJson(out, "chain-audit.json"));
      expect(audit.auditPassed).toBe(true);
      expect(audit.chainComplete).toBe(true);
      const readiness = validatePhase6SimulationReadinessReportV1(readJson(out, "readiness.json"));
      expect(readiness.phase6SimulationReady).toBe(true);
      expect(readiness.phase7LiveTradingReady).toBe(false);
      const handoff = validatePhase6SimulationHandoffPackV1(readJson(out, "handoff-pack.json"));
      expect(handoff.complete).toBe(true);
      const bundle = validatePhase6OperatorBundleV1(readJson(out, "operator-bundle.json"));
      expect(bundle.complete).toBe(true);
      expect(bundle.blockingTrailConsistent).toBe(true);
      // Clean risk → paper-enters → the prereqs review condition is carried VERBATIM: honest blocked.
      expect(bundle.operatorVerdict).toBe("blocked");
      expect(bundle.chainBlockingCodes).toEqual(["simulation-blocked-prereqs-not-ready"]);
      // Every named role is file-backed with a truncated integrity digest.
      for (const f of bundle.files) {
        expect(f.fileName, f.role).not.toBeNull();
        expect(f.digest).toMatch(/^sha256-128:[0-9a-f]{32}$/);
      }
      const summary = readFileSync(join(out, "RUN_SUMMARY.md"), "utf8");
      expect(summary).toContain("SIMULATION ONLY");
      expect(summary).toContain("never signs, never sends");
      expect(summary).not.toMatch(/ready for live|live-ready/i);
      // The blocking CODES appear verbatim in the summary, not just a count.
      expect(summary).toContain("`simulation-blocked-prereqs-not-ready`");
      // The route status carries its per-status explanation.
      expect(summary).toContain("nothing was faked");
      // The terminal output surfaces the codes and the one-line UI inspection command.
      expect(r.text).toContain("✗ simulation-blocked-prereqs-not-ready");
      expect(r.text).toContain(`pnpm web:inspect --dir "${out}" --force`);
      expect(r.text).toContain("nothing was faked");
    });
  });

  it("watch-only candidates (freeze authority → no paper-enter) reach reviewable-paper-only", () => {
    withTmp((tmp) => {
      writeCandidateInputs(tmp, { freezeAuthority: true });
      const ctx = { cwd: tmp, env: {} };
      const r = paperSniperDryRunReport(ctx, {
        ...HAPPY_OPTS,
        acknowledgePaperEnterReview: false,
        outDir: "out",
        failOnBlocked: true,
      });
      expect(r.exitCode, r.text.slice(0, 300)).toBe(0);
      const bundle = validatePhase6OperatorBundleV1(readJson(join(tmp, "out"), "operator-bundle.json"));
      expect(bundle.chainBlockingCodes).toEqual([]);
      expect(bundle.operatorVerdict).toBe("reviewable-paper-only");
      expect(bundle.simulationReadyPerReadiness).toBe(true);
    });
  });

  it("is byte-deterministic: two runs over the same input produce identical artifact sets", () => {
    withTmp((tmp) => {
      writeCandidateInputs(tmp, { freezeAuthority: false });
      const ctx = { cwd: tmp, env: {} };
      expect(paperSniperDryRunReport(ctx, { ...HAPPY_OPTS, outDir: "a" }).exitCode).toBe(0);
      expect(paperSniperDryRunReport(ctx, { ...HAPPY_OPTS, outDir: "b" }).exitCode).toBe(0);
      for (const f of PAPER_DRY_RUN_FILES) {
        expect(readFileSync(join(tmp, "b", f), "utf8"), f).toBe(readFileSync(join(tmp, "a", f), "utf8"));
      }
    });
  });

  it("--json emits the operator bundle itself (machine-readable verdict)", () => {
    withTmp((tmp) => {
      writeCandidateInputs(tmp, { freezeAuthority: false });
      const r = paperSniperDryRunReport({ cwd: tmp, env: {} }, { ...HAPPY_OPTS, outDir: "out", json: true });
      expect(r.exitCode).toBe(0);
      const bundle = validatePhase6OperatorBundleV1(JSON.parse(r.text));
      expect(bundle.bundleLabel).toBe("fictional-dry-run");
    });
  });
});

describe("paper:sniper:dry-run — refusals and honest degraded paths", () => {
  it("refuses a missing/malformed candidate file, a missing --out, and --adopt-specs without --operator", () => {
    withTmp((tmp) => {
      const ctx = { cwd: tmp, env: {} };
      expect(paperSniperDryRunReport(ctx, { outDir: "out" }).text.startsWith("Refusing:")).toBe(true);
      expect(paperSniperDryRunReport(ctx, { candidatesPath: "nope.json", outDir: "out" }).exitCode).toBe(1);
      writeFileSync(join(tmp, "bad.json"), "{not json");
      expect(paperSniperDryRunReport(ctx, { candidatesPath: "bad.json", outDir: "out" }).exitCode).toBe(1);
      writeCandidateInputs(tmp, { freezeAuthority: false });
      expect(paperSniperDryRunReport(ctx, { candidatesPath: "candidates.input.json" }).exitCode).toBe(1);
      expect(
        paperSniperDryRunReport(ctx, { candidatesPath: "candidates.input.json", outDir: "out", adoptSpecs: true }).exitCode,
      ).toBe(1);
      // No partial output directory is left behind by pure refusals.
      expect(readdirSync(tmp).includes("out")).toBe(false);
    });
  });

  it("refuses an invalid mint and never echoes a secret-length mint value", () => {
    withTmp((tmp) => {
      const ctx = { cwd: tmp, env: {} };
      writeFileSync(join(tmp, "bad-mint.json"), JSON.stringify({ candidates: [{ candidateId: "x", mint: "not-a-mint" }] }));
      expect(paperSniperDryRunReport(ctx, { candidatesPath: "bad-mint.json", outDir: "out" }).exitCode).toBe(1);
      const fakeSecret = "9".repeat(88); // secret-key-length base58 blob (entirely fictional)
      writeFileSync(join(tmp, "secret-mint.json"), JSON.stringify({ candidates: [{ candidateId: "x", mint: fakeSecret }] }));
      const r = paperSniperDryRunReport(ctx, { candidatesPath: "secret-mint.json", outDir: "out" });
      expect(r.exitCode).toBe(1);
      expect(r.text.includes(fakeSecret)).toBe(false);
    });
  });

  it("no preflight data + draft specs → the chain BLOCKS honestly and still writes every artifact", () => {
    withTmp((tmp) => {
      writeCandidateInputs(tmp, { freezeAuthority: false });
      const ctx = { cwd: tmp, env: {} };
      const r = paperSniperDryRunReport(ctx, {
        candidatesPath: "candidates.input.json",
        operatorLabel: "fictional-operator",
        outDir: "out",
      });
      expect(r.exitCode).toBe(0); // the blocked artifact set IS the honest record
      const out = join(tmp, "out");
      expect(readdirSync(out).sort()).toEqual([...PAPER_DRY_RUN_FILES].sort());
      const plan = validateSimulationIntentPlanV2(readJson(out, "intent-plan.json"));
      expect(plan.blocked).toBe(true);
      expect(plan.blockingReasonCodes).toContain("simulation-blocked-kill-switch-not-adopted");
      const bundle = validatePhase6OperatorBundleV1(readJson(out, "operator-bundle.json"));
      expect(bundle.operatorVerdict).toBe("blocked");
      expect(bundle.blockingTrailConsistent).toBe(true);
      // --fail-on-blocked gates the same state.
      const gated = paperSniperDryRunReport(ctx, {
        candidatesPath: "candidates.input.json",
        operatorLabel: "fictional-operator",
        outDir: "out",
        force: true,
        failOnBlocked: true,
      });
      expect(gated.exitCode).toBe(1);
    });
  });

  it("a tripped stop-simulation switch blocks the whole chain (verbatim code in the bundle)", () => {
    withTmp((tmp) => {
      writeCandidateInputs(tmp, { freezeAuthority: false });
      const r = paperSniperDryRunReport({ cwd: tmp, env: {} }, { ...HAPPY_OPTS, stopSimulationTripped: true, outDir: "out" });
      expect(r.exitCode).toBe(0);
      const bundle = validatePhase6OperatorBundleV1(readJson(join(tmp, "out"), "operator-bundle.json"));
      expect(bundle.chainBlockingCodes).toContain("simulation-blocked-kill-switch-stop");
      expect(bundle.operatorVerdict).toBe("blocked");
    });
  });

  it("refuses to overwrite an existing artifact file without --force", () => {
    withTmp((tmp) => {
      writeCandidateInputs(tmp, { freezeAuthority: false });
      const ctx = { cwd: tmp, env: {} };
      mkdirSync(join(tmp, "out"));
      writeFileSync(join(tmp, "out", "operator-bundle.json"), "{}");
      const r = paperSniperDryRunReport(ctx, { ...HAPPY_OPTS, outDir: "out" });
      expect(r.exitCode).toBe(1);
      expect(r.text.startsWith("Refusing:")).toBe(true);
      expect(paperSniperDryRunReport(ctx, { ...HAPPY_OPTS, outDir: "out", force: true }).exitCode).toBe(0);
    });
  });

  it("secret hygiene: no produced file carries a secret-bearing key or key-shaped value", () => {
    withTmp((tmp) => {
      writeCandidateInputs(tmp, { freezeAuthority: false });
      expect(paperSniperDryRunReport({ cwd: tmp, env: {} }, { ...HAPPY_OPTS, outDir: "out" }).exitCode).toBe(0);
      for (const f of PAPER_DRY_RUN_FILES) {
        const text = readFileSync(join(tmp, "out", f), "utf8");
        expect(/"(privateKey|secretKey|mnemonic|seedPhrase|keypair|passphrase)"/i.test(text), `${f} carries a secret-bearing key`).toBe(false);
        for (const m of text.matchAll(/"([1-9A-HJ-NP-Za-km-z]{64,})"/g)) {
          expect(m[1], `${f} carries a base58 key-shaped value`).toBe(undefined);
        }
      }
    });
  });
});

describe("paper:simulation:bundle — the operator bundle command over a real dry-run output", () => {
  function bundleOpts(dir: string) {
    return {
      decisionsPath: join(dir, "decision.json"),
      runReportPath: join(dir, "run-report.json"),
      gatesPath: join(dir, "safety-gates.json"),
      prereqsPath: join(dir, "prereqs.json"),
      killSwitchPath: join(dir, "kill-switch.json"),
      secretsPolicyPath: join(dir, "secrets-policy.json"),
      burnerIsolationPath: join(dir, "burner-isolation.json"),
      intentPlanPath: join(dir, "intent-plan.json"),
      simulationResultPath: join(dir, "simulation-result.json"),
      routePath: join(dir, "route-resolution.json"),
      auditPath: join(dir, "chain-audit.json"),
      readinessPath: join(dir, "readiness.json"),
      handoffPath: join(dir, "handoff-pack.json"),
      operatorLabel: "fictional-operator",
      bundleLabel: "fictional-rebundle",
    };
  }

  it("rebuilds a complete, trail-consistent bundle from the files on disk (re-verification)", () => {
    withTmp((tmp) => {
      writeCandidateInputs(tmp, { freezeAuthority: false });
      const ctx = { cwd: tmp, env: {} };
      expect(paperSniperDryRunReport(ctx, { ...HAPPY_OPTS, outDir: "out" }).exitCode).toBe(0);
      const r = paperSimulationBundleReport(ctx, { ...bundleOpts("out"), json: true });
      expect(r.exitCode).toBe(0);
      const bundle = validatePhase6OperatorBundleV1(JSON.parse(r.text)) as Phase6OperatorBundleV1;
      expect(bundle.complete).toBe(true);
      expect(bundle.blockingTrailConsistent).toBe(true);
      // Re-bundling the same files reproduces the same digests the orchestrator recorded.
      const original = validatePhase6OperatorBundleV1(readJson(join(tmp, "out"), "operator-bundle.json"));
      expect(bundle.files.map((f) => f.digest)).toEqual(original.files.map((f) => f.digest));
    });
  });

  it("a TAMPERED artifact file changes its digest and is classified invalid (fail closed)", () => {
    withTmp((tmp) => {
      writeCandidateInputs(tmp, { freezeAuthority: false });
      const ctx = { cwd: tmp, env: {} };
      expect(paperSniperDryRunReport(ctx, { ...HAPPY_OPTS, outDir: "out" }).exitCode).toBe(0);
      const planPath = join(tmp, "out", "intent-plan.json");
      const plan = JSON.parse(readFileSync(planPath, "utf8")) as Record<string, unknown>;
      writeFileSync(planPath, JSON.stringify({ ...plan, neverSends: false }, null, 2) + "\n");
      const r = paperSimulationBundleReport(ctx, { ...bundleOpts("out"), json: true, failOnBlocked: true });
      expect(r.exitCode).toBe(1);
      const bundle = validatePhase6OperatorBundleV1(JSON.parse(r.text));
      expect(bundle.invalidRoles).toContain("intent-plan");
      expect(bundle.operatorVerdict).toBe("blocked");
      const original = validatePhase6OperatorBundleV1(readJson(join(tmp, "out"), "operator-bundle.json"));
      const tampered = bundle.files.find((f) => f.role === "intent-plan")!;
      const recorded = original.files.find((f) => f.role === "intent-plan")!;
      expect(tampered.digest).not.toBe(recorded.digest);
    });
  });

  it("writes nothing by default; --out refuses overwrite without --force; missing roles classified", () => {
    withTmp((tmp) => {
      const ctx = { cwd: tmp, env: {} };
      const before = readdirSync(tmp).sort();
      const r = paperSimulationBundleReport(ctx, { json: true });
      expect(r.exitCode).toBe(0);
      expect(readdirSync(tmp).sort()).toEqual(before);
      const bundle = validatePhase6OperatorBundleV1(JSON.parse(r.text));
      expect(bundle.missingCount).toBe(13);
      expect(bundle.operatorVerdict).toBe("incomplete");
      expect(paperSimulationBundleReport(ctx, { json: true, failOnIncomplete: true }).exitCode).toBe(1);
      writeFileSync(join(tmp, "bundle.json"), "{}");
      expect(paperSimulationBundleReport(ctx, { outPath: "bundle.json" }).exitCode).toBe(1);
      expect(paperSimulationBundleReport(ctx, { outPath: "bundle.json", force: true }).exitCode).toBe(0);
    });
  });

  it("refuses a named-but-unreadable file outright", () => {
    withTmp((tmp) => {
      const r = paperSimulationBundleReport({ cwd: tmp, env: {} }, { decisionsPath: "missing.json" });
      expect(r.exitCode).toBe(1);
      expect(r.text.startsWith("Refusing:")).toBe(true);
    });
  });
});

describe("CLI registration — both Sprint 88 commands are registered exactly once", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");

  it("paper:sniper:dry-run and paper:simulation:bundle are registered exactly once", () => {
    expect([...source.matchAll(/\.command\("paper:sniper:dry-run"\)/g)]).toHaveLength(1);
    expect([...source.matchAll(/\.command\("paper:simulation:bundle"\)/g)]).toHaveLength(1);
  });

  it("the dry-run registration exposes the curated flag surface", () => {
    const block = /\.command\("paper:sniper:dry-run"\)([\s\S]*?)\.action\(/.exec(source)![1]!;
    const flags = [...block.matchAll(/\.option\(\s*\n?\s*"(--[a-z0-9-]+)/g)].map((m) => m[1]);
    expect(flags.slice().sort()).toEqual(
      [
        "--candidates", "--preflight-input", "--policy", "--kill-switch", "--secrets-policy",
        "--burner-isolation", "--adopt-specs", "--acknowledge-paper-enter-review",
        "--stop-simulation-tripped", "--operator", "--run-label", "--out", "--force", "--json",
        "--fail-on-blocked",
      ].sort(),
    );
  });
});
