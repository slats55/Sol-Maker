/**
 * Sprint 86 — `paper:simulation:route`: the operator path to the S85 route-resolution
 * PROVENANCE artifact (`simulation.route.resolution.v1`).
 *
 * Exercised through the real command function over FICTIONAL chain artifacts in a temp dir.
 * Proves the command is honest end to end: a valid plan yields the canonical all-UNAVAILABLE
 * artifact under the fixed `unavailable-no-route-resolver` id (nothing resolved, invented, or
 * fetched); a missing/garbage input refuses; an invalid/blocked plan or a tripped stop switch
 * yields a BLOCKED artifact (the honest record, gateable with --fail-on-blocked); output is
 * deterministic; --out/--force behave; secret-shaped labels are redacted; and the CLI
 * registration exposes no dangerous flag and keeps the safety framing in its --help description.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFictionalReadyChain,
  validateSimulationRouteResolutionV1,
  SIMULATION_OPERATOR_SAFETY_LINE,
  type FictionalSimulationChain,
} from "@soulmaker/simulation";
import { paperSimulationIntentPlanReport, paperSimulationRouteReport } from "./commands.js";

const CLI_INDEX = join(dirname(fileURLToPath(import.meta.url)), "index.ts");

function withChainDir<T>(fn: (tmp: string, chain: FictionalSimulationChain) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "simulation-route-cli-"));
  const chain = buildFictionalReadyChain();
  writeFileSync(join(tmp, "dec2.json"), JSON.stringify(chain.decision, null, 2));
  writeFileSync(join(tmp, "gates2.json"), JSON.stringify(chain.gates, null, 2));
  writeFileSync(join(tmp, "prereqs2.json"), JSON.stringify(chain.prereqs, null, 2));
  writeFileSync(join(tmp, "ks.json"), JSON.stringify(chain.killSwitchSpec, null, 2));
  writeFileSync(join(tmp, "sp.json"), JSON.stringify(chain.secretsPolicy, null, 2));
  writeFileSync(join(tmp, "bi.json"), JSON.stringify(chain.burnerIsolationSpec, null, 2));
  try {
    return fn(tmp, chain);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function writePlan(tmp: string): void {
  const r = paperSimulationIntentPlanReport(
    { cwd: tmp },
    {
      decisionsPath: "dec2.json",
      gatesPath: "gates2.json",
      prereqsPath: "prereqs2.json",
      killSwitchPath: "ks.json",
      secretsPolicyPath: "sp.json",
      burnerIsolationPath: "bi.json",
      acknowledgePaperEnterReview: true,
      operatorLabel: "fictional-operator",
      planLabel: "fictional-route-plan",
      outPath: "plan.json",
    },
  );
  expect(r.exitCode).toBe(0);
}

describe("paper:simulation:route — the honest happy path", () => {
  it("a valid plan yields the canonical all-UNAVAILABLE artifact (exit 0); validator round-trip", () => {
    withChainDir((tmp) => {
      writePlan(tmp);
      const r = paperSimulationRouteReport({ cwd: tmp }, { planPath: "plan.json", json: true });
      expect(r.exitCode).toBe(0);
      const artifact = validateSimulationRouteResolutionV1(JSON.parse(r.text));
      expect(artifact.resolutionStatus).toBe("unavailable");
      expect(artifact.routeResolverId).toBe("unavailable-no-route-resolver");
      expect(artifact.routeResolverAttempted).toBe(false);
      expect(artifact.blocked).toBe(false);
      expect(artifact.liveStateCaveat).toBe(false);
      expect(artifact.entryCount).toBe(2);
      expect(artifact.unavailableEntryCount).toBe(2);
      expect(artifact.resolvedEntryCount).toBe(0);
      expect(artifact.phase7LiveTradingReady).toBe(false);
      for (const e of artifact.entries) {
        expect(e.routeResolutionStatus).toBe("unavailable");
        expect(e.unresolvedFields).toEqual(["route", "destination", "fee"]);
        expect(e.routePreview).toEqual({ status: "unresolved", label: null });
      }
    });
  });

  it("formatted output carries the safety line and the honest UNAVAILABLE route state", () => {
    withChainDir((tmp) => {
      writePlan(tmp);
      const r = paperSimulationRouteReport({ cwd: tmp }, { planPath: "plan.json", operatorLabel: "fictional-operator" });
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain(SIMULATION_OPERATOR_SAFETY_LINE);
      expect(r.text).toContain("ROUTE PROVENANCE ONLY");
      expect(r.text).toContain("status:   UNAVAILABLE");
      expect(r.text).toContain("unavailable-no-route-resolver");
      expect(r.text).toContain("UNRESOLVED (never invented)");
      expect(r.text).toContain("never signs");
      expect(r.text).toContain("never sends");
    });
  });

  it("output is deterministic: two runs are byte-identical", () => {
    withChainDir((tmp) => {
      writePlan(tmp);
      const a = paperSimulationRouteReport({ cwd: tmp }, { planPath: "plan.json", json: true });
      const b = paperSimulationRouteReport({ cwd: tmp }, { planPath: "plan.json", json: true });
      expect(b.text).toBe(a.text);
    });
  });

  it("--fail-on-unavailable trips on the canonical artifact (the honest CI tripwire)", () => {
    withChainDir((tmp) => {
      writePlan(tmp);
      const r = paperSimulationRouteReport({ cwd: tmp }, { planPath: "plan.json", failOnUnavailable: true });
      expect(r.exitCode).toBe(1);
    });
  });
});

describe("paper:simulation:route — refusals and fail-closed blocking", () => {
  it("refuses a missing --plan, a missing file, and garbage JSON (exit 1, Refusing:)", () => {
    withChainDir((tmp) => {
      const missingFlag = paperSimulationRouteReport({ cwd: tmp }, {});
      expect(missingFlag.exitCode).toBe(1);
      expect(missingFlag.text.startsWith("Refusing:")).toBe(true);
      const missingFile = paperSimulationRouteReport({ cwd: tmp }, { planPath: "nope.json" });
      expect(missingFile.exitCode).toBe(1);
      expect(missingFile.text.startsWith("Refusing:")).toBe(true);
      writeFileSync(join(tmp, "garbage.json"), "{not json");
      const garbage = paperSimulationRouteReport({ cwd: tmp }, { planPath: "garbage.json" });
      expect(garbage.exitCode).toBe(1);
      expect(garbage.text.startsWith("Refusing:")).toBe(true);
    });
  });

  it("a wrong-schema/invalid plan yields a BLOCKED artifact (the honest record); --fail-on-blocked gates it", () => {
    withChainDir((tmp, chain) => {
      // A decision report is not a plan: the builder records it INVALID and blocks, never invents.
      writeFileSync(join(tmp, "not-a-plan.json"), JSON.stringify(chain.decision, null, 2));
      const r = paperSimulationRouteReport({ cwd: tmp }, { planPath: "not-a-plan.json", json: true });
      expect(r.exitCode).toBe(0);
      const artifact = validateSimulationRouteResolutionV1(JSON.parse(r.text));
      expect(artifact.blocked).toBe(true);
      expect(artifact.resolutionStatus).toBe("blocked");
      expect(artifact.blockingReasonCodes).toContain("simulation-route-resolution-invalid-plan");
      expect(artifact.entryCount).toBe(0);
      const gated = paperSimulationRouteReport({ cwd: tmp }, { planPath: "not-a-plan.json", failOnBlocked: true });
      expect(gated.exitCode).toBe(1);
    });
  });

  it("a tampered plan (flipped literal lock) is INVALID and blocks — never accepted", () => {
    withChainDir((tmp) => {
      writePlan(tmp);
      const tampered = JSON.parse(readFileSync(join(tmp, "plan.json"), "utf8")) as Record<string, unknown>;
      tampered.neverSends = false;
      writeFileSync(join(tmp, "tampered.json"), JSON.stringify(tampered));
      const r = paperSimulationRouteReport({ cwd: tmp }, { planPath: "tampered.json", json: true });
      const artifact = validateSimulationRouteResolutionV1(JSON.parse(r.text));
      expect(artifact.blocked).toBe(true);
      expect(artifact.blockingReasonCodes).toContain("simulation-route-resolution-invalid-plan");
    });
  });

  it("--stop-simulation-tripped blocks at resolution time with the kill-switch code", () => {
    withChainDir((tmp) => {
      writePlan(tmp);
      const r = paperSimulationRouteReport({ cwd: tmp }, { planPath: "plan.json", stopSimulationTripped: true, json: true });
      expect(r.exitCode).toBe(0);
      const artifact = validateSimulationRouteResolutionV1(JSON.parse(r.text));
      expect(artifact.blocked).toBe(true);
      expect(artifact.blockingReasonCodes).toContain("simulation-blocked-kill-switch-stop");
      const gated = paperSimulationRouteReport({ cwd: tmp }, { planPath: "plan.json", stopSimulationTripped: true, failOnBlocked: true });
      expect(gated.exitCode).toBe(1);
    });
  });
});

describe("paper:simulation:route — writes nothing by default; --out / overwrite / --force", () => {
  it("writes nothing without --out; --out writes a validating artifact; overwrite refused without --force", () => {
    withChainDir((tmp) => {
      writePlan(tmp);
      const before = readdirSync(tmp).sort();
      paperSimulationRouteReport({ cwd: tmp }, { planPath: "plan.json", json: true });
      expect(readdirSync(tmp).sort()).toEqual(before);

      const out = paperSimulationRouteReport({ cwd: tmp }, { planPath: "plan.json", outPath: "route.json" });
      expect(out.exitCode).toBe(0);
      const written = validateSimulationRouteResolutionV1(JSON.parse(readFileSync(join(tmp, "route.json"), "utf8")));
      expect(written.resolutionStatus).toBe("unavailable");

      const refused = paperSimulationRouteReport({ cwd: tmp }, { planPath: "plan.json", outPath: "route.json" });
      expect(refused.exitCode).toBe(1);
      expect(refused.text).toContain("--force");

      const forced = paperSimulationRouteReport({ cwd: tmp }, { planPath: "plan.json", outPath: "route.json", force: true });
      expect(forced.exitCode).toBe(0);
    });
  });
});

describe("paper:simulation:route — secret hygiene", () => {
  it("a mnemonic-shaped operator label is REDACTED in JSON output, never verbatim", () => {
    withChainDir((tmp) => {
      writePlan(tmp);
      const mnemonicShaped = "apple banana cherry damson elder fig grape honey iris juniper kiwi lemon";
      const r = paperSimulationRouteReport({ cwd: tmp }, { planPath: "plan.json", operatorLabel: mnemonicShaped, json: true });
      expect(r.exitCode).toBe(0);
      expect(r.text).not.toContain(mnemonicShaped);
      expect(r.text).toContain("[REDACTED]");
    });
  });

  it("a key-shaped (long base58) resolution label never survives into output", () => {
    withChainDir((tmp) => {
      writePlan(tmp);
      const keyShaped = "5".repeat(88);
      const r = paperSimulationRouteReport({ cwd: tmp }, { planPath: "plan.json", resolutionLabel: keyShaped, json: true });
      expect(r.exitCode).toBe(0);
      expect(r.text).not.toContain(keyShaped);
    });
  });

  it("an injected privateKey-named field on the plan never reaches the output", () => {
    withChainDir((tmp) => {
      writePlan(tmp);
      const plan = JSON.parse(readFileSync(join(tmp, "plan.json"), "utf8")) as Record<string, unknown>;
      writeFileSync(join(tmp, "evil-plan.json"), JSON.stringify({ ...plan, privateKey: "fictional-injected-value" }));
      const r = paperSimulationRouteReport({ cwd: tmp }, { planPath: "evil-plan.json", json: true });
      // The injected key/value never flows into the produced artifact: the route artifact
      // carries only structured plan facts (labels/blocked/entryCount), and its own CLOSED
      // schema cannot carry a sensitive-named field (the validator refuses one outright).
      expect(r.text).not.toContain("fictional-injected-value");
      expect(r.text).not.toContain("privateKey");
      expect(() => validateSimulationRouteResolutionV1(JSON.parse(r.text))).not.toThrow();
    });
  });
});

describe("paper:simulation:route — CLI registration (help surface pinned to the safety framing)", () => {
  const source = readFileSync(CLI_INDEX, "utf8");
  const block = /\.command\("paper:simulation:route"\)([\s\S]*?)\.action\(/.exec(source)?.[1] ?? "";

  it("is registered exactly once with a --help description that keeps the honest framing", () => {
    expect([...source.matchAll(/\.command\("paper:simulation:route"\)/g)]).toHaveLength(1);
    expect(block).toContain("unavailable-no-route-resolver");
    expect(block).toContain("never signs, never sends, never resolves");
    expect(block).toContain("not live trading, not a buy recommendation, not a transaction approval");
    expect(block).toContain("writes nothing unless --out");
  });

  it("exposes no dangerous flag (no live/send/sign/key/resolver-override surface)", () => {
    const flags = [...block.matchAll(/\.option\(\s*\n?\s*"(--[a-z0-9-]+)/g)].map((m) => m[1] as string);
    expect(flags.sort()).toEqual(
      ["--plan", "--stop-simulation-tripped", "--operator", "--resolution-label", "--json", "--out", "--force", "--fail-on-blocked", "--fail-on-unavailable"].sort(),
    );
    for (const flag of flags) {
      for (const token of ["--live", "--send", "--sign", "--private", "--mnemonic", "--seed", "--wallet", "--dangerous", "--bypass", "--unsafe", "--execute", "--resolver"]) {
        expect(flag.startsWith(token), `suspicious flag ${flag}`).toBe(false);
      }
    }
  });
});
