/**
 * Sprint 90 — the shipped `examples/sniper/real-input-rehearsal/` fixtures and workflow.
 *
 * Pins, with the production validators:
 *
 *   - FIXTURE FIDELITY: every committed inspect/risk fixture is byte-faithful to what the
 *     production builders (`buildTokenInspectReport` / the real risk engine) produce for the
 *     invented facts — regenerated via `scripts/gen-real-input-rehearsal-fixtures.ts` and compared;
 *   - the MIXED run (FICA clean + FICB freeze-authority REJECT): bridge succeeds, decisions are
 *     paper-enter + paper-reject, and ONE rejected candidate honestly blocks the whole chain
 *     (verdict `blocked`, route `blocked`, three blocking codes, plan blocked with 0 entries);
 *   - the CLEAN remedy run (FICA only): the canonical honest end state — verdict `blocked` on
 *     `simulation-blocked-prereqs-not-ready` alone, route honestly `unavailable`, plan unblocked
 *     with 1 entry;
 *   - byte determinism of the bridged artifact, and README/code agreement.
 *
 * Everything is FICTIONAL (invented mints that do not exist on-chain). Nothing here is live data,
 * a trade signal, or a profitability claim.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePhase6OperatorBundleV1, validateSimulationIntentPlanV2 } from "@soulmaker/simulation";
import { validateSniperPreflightInput } from "@soulmaker/sniper";
import { buildRealInputRehearsalFixtures } from "../../../scripts/gen-real-input-rehearsal-fixtures.js";
import { paperSniperPreflightInputPrepareReport, paperSniperDryRunReport } from "./commands.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REHEARSAL_DIR = join(HERE, "../../../examples/sniper/real-input-rehearsal");

const FIXTURE_FILES = [
  "inspect.fica.fictional.json",
  "risk.fica.fictional.json",
  "inspect.ficb.fictional.json",
  "risk.ficb.fictional.json",
] as const;

const fixture = (name: string): string => join(REHEARSAL_DIR, name);
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "real-input-"));
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const MIXED = {
  candidatesPath: fixture("candidates.fictional.json"),
  inspectPaths: [fixture("inspect.fica.fictional.json"), fixture("inspect.ficb.fictional.json")],
  riskPaths: [fixture("risk.fica.fictional.json"), fixture("risk.ficb.fictional.json")],
} as const;

const CLEAN = {
  candidatesPath: fixture("candidates.clean.fictional.json"),
  inspectPaths: [fixture("inspect.fica.fictional.json")],
  riskPaths: [fixture("risk.fica.fictional.json")],
} as const;

describe("real-input rehearsal — fixture fidelity (production code is the source of truth)", () => {
  it("every committed inspect/risk fixture equals the production builders' regeneration", async () => {
    const regenerated = await buildRealInputRehearsalFixtures();
    expect(Object.keys(regenerated).sort()).toEqual([...FIXTURE_FILES].sort());
    for (const name of FIXTURE_FILES) {
      expect(readJson(fixture(name)), name).toEqual(regenerated[name]);
    }
  });

  it("the FICB risk fixture is a real risk-engine critical REJECT (freeze authority)", () => {
    const risk = readJson(fixture("risk.ficb.fictional.json")) as Record<string, unknown>;
    expect(risk.decision).toBe("REJECT");
    const flags = risk.flags as Array<Record<string, unknown>>;
    expect(flags.some((f) => f.id === "freeze-authority-present" && f.severity === "critical")).toBe(true);
  });
});

describe("real-input rehearsal — the mixed run (one REJECT honestly blocks the chain)", () => {
  it("bridges, decides paper-enter + paper-reject, and ends blocked with the pinned codes", () => {
    withTmp((tmp) => {
      const ctx = { cwd: tmp, env: {} };
      const prep = paperSniperPreflightInputPrepareReport(ctx, { ...MIXED, inspectPaths: [...MIXED.inspectPaths], riskPaths: [...MIXED.riskPaths], outPath: "pf.json" });
      expect(prep.exitCode, prep.text.slice(0, 300)).toBe(0);
      const artifact = validateSniperPreflightInput(readJson(join(tmp, "pf.json")));
      expect(artifact.entryCount).toBe(2);
      expect(artifact.validationStatus).toBe("valid");

      const dry = paperSniperDryRunReport(ctx, {
        candidatesPath: MIXED.candidatesPath,
        preflightInputPath: "pf.json",
        adoptSpecs: true,
        acknowledgePaperEnterReview: true,
        operatorLabel: "rehearsal",
        runLabel: "real-input-rehearsal",
        outDir: "out",
      });
      expect(dry.exitCode, dry.text.slice(0, 300)).toBe(0); // blocked still writes the honest set

      const decision = readJson(join(tmp, "out", "decision.json")) as {
        decisions: Array<{ candidateId: string; decision: string }>;
      };
      expect(decision.decisions.map((d) => `${d.candidateId}:${d.decision}`)).toEqual([
        "fica:paper-enter",
        "ficb:paper-reject",
      ]);

      const plan = validateSimulationIntentPlanV2(readJson(join(tmp, "out", "intent-plan.json")));
      expect(plan.blocked).toBe(true);
      expect(plan.entryCount).toBe(0);

      const bundle = validatePhase6OperatorBundleV1(readJson(join(tmp, "out", "operator-bundle.json")));
      expect(bundle.operatorVerdict).toBe("blocked");
      expect(bundle.routeResolutionStatus).toBe("blocked");
      expect([...bundle.chainBlockingCodes].sort()).toEqual(
        [
          "simulation-blocked-prereqs-not-ready",
          "simulation-dry-run-skipped-blocked-plan",
          "simulation-route-resolution-blocked-plan",
        ].sort(),
      );
    });
  });
});

describe("real-input rehearsal — the clean remedy run (canonical honest end state)", () => {
  it("ends blocked on prereqs review ONLY, route honestly unavailable, plan unblocked", () => {
    withTmp((tmp) => {
      const ctx = { cwd: tmp, env: {} };
      const prep = paperSniperPreflightInputPrepareReport(ctx, { ...CLEAN, inspectPaths: [...CLEAN.inspectPaths], riskPaths: [...CLEAN.riskPaths], outPath: "pf.json" });
      expect(prep.exitCode, prep.text.slice(0, 300)).toBe(0);

      const dry = paperSniperDryRunReport(ctx, {
        candidatesPath: CLEAN.candidatesPath,
        preflightInputPath: "pf.json",
        adoptSpecs: true,
        acknowledgePaperEnterReview: true,
        operatorLabel: "rehearsal",
        runLabel: "real-input-rehearsal-clean",
        outDir: "out",
      });
      expect(dry.exitCode, dry.text.slice(0, 300)).toBe(0);

      const plan = validateSimulationIntentPlanV2(readJson(join(tmp, "out", "intent-plan.json")));
      expect(plan.blocked).toBe(false);
      expect(plan.entryCount).toBe(1);

      const bundle = validatePhase6OperatorBundleV1(readJson(join(tmp, "out", "operator-bundle.json")));
      expect(bundle.operatorVerdict).toBe("blocked");
      expect(bundle.routeResolutionStatus).toBe("unavailable");
      expect(bundle.chainBlockingCodes).toEqual(["simulation-blocked-prereqs-not-ready"]);
    });
  });

  it("the bridged artifact is byte-deterministic across two runs", () => {
    withTmp((tmp) => {
      const ctx = { cwd: tmp, env: {} };
      const opts = { ...CLEAN, inspectPaths: [...CLEAN.inspectPaths], riskPaths: [...CLEAN.riskPaths] };
      paperSniperPreflightInputPrepareReport(ctx, { ...opts, outPath: "pf1.json" });
      paperSniperPreflightInputPrepareReport(ctx, { ...opts, outPath: "pf2.json" });
      expect(readFileSync(join(tmp, "pf1.json"), "utf8")).toBe(readFileSync(join(tmp, "pf2.json"), "utf8"));
    });
  });
});

describe("real-input rehearsal — README/code agreement", () => {
  it("the README names the commands, every fixture file, and the generator script", () => {
    const readme = readFileSync(join(REHEARSAL_DIR, "README.md"), "utf8");
    for (const needle of [
      "paper:sniper:preflight:input:prepare",
      "paper:sniper:dry-run",
      "web:inspect",
      "candidates.fictional.json",
      "candidates.clean.fictional.json",
      ...FIXTURE_FILES,
      "scripts/gen-real-input-rehearsal-fixtures.ts",
      "simulation-blocked-prereqs-not-ready",
    ]) {
      expect(readme, `README must mention ${needle}`).toContain(needle);
    }
    // The pinned outcomes documented above must match what this suite asserts.
    expect(readme).toContain("paper-reject");
    expect(readme).toContain("unavailable");
  });
});
