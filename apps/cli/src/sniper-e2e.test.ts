/**
 * Sprint 35 — END-TO-END sniper PAPER pipeline test over the shipped FICTIONAL fixtures.
 *
 * This proves the whole offline sniper path works together through the real CLI command functions:
 * candidate intake -> token preflight -> paper decision -> run report -> run report diff -> audit log ->
 * session pack. Every fixture is INVENTED (synthetic mints + made-up inspection/risk values) and clearly
 * labeled — nothing here is live data, a real on-chain fact, a trade signal, or a profitability claim.
 *
 * Every shipped `examples/sniper/*.json` file is validated against a production validator, and every
 * generated artifact is validated + checked for coherence + determinism. Artifacts are generated into a
 * temp dir (never committed), so they can never drift from the code.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateSniperCandidateList,
  validateSniperTokenPreflightReport,
  validatePaperSniperDecisionReport,
  validateSniperRunReport,
  validateSniperRunReportDiff,
  validateSniperAuditLog,
  validateSniperSessionPack,
  validateSniperPolicyConfig,
} from "@soulmaker/sniper";
import {
  paperSniperCandidatesValidateReport,
  paperSniperPreflightReport,
  paperSniperDecideReport,
  paperSniperReportReport,
  paperSniperDiffReportReport,
  paperSniperAuditReport,
  paperSniperSessionPackReport,
  paperSniperPolicyValidateReport,
} from "./commands.js";

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), "../../../examples/sniper");
const ex = (name: string): string => join(EXAMPLES, name);
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

describe("examples/sniper — shipped fixtures validate against production validators", () => {
  it("the fictional candidate list validates (3 distinct fictional mints, no warnings)", () => {
    const r = paperSniperCandidatesValidateReport({ cwd: EXAMPLES, env: {} }, { inputPath: "candidates.fictional.json", json: true });
    expect(r.exitCode).toBe(0);
    const list = validateSniperCandidateList(JSON.parse(r.text));
    expect(list.candidateCount).toBe(3);
    expect(list.warnings).toEqual([]);
    expect(list.candidates.map((c) => c.candidateId)).toEqual(["fic-clean", "fic-freeze", "fic-reject"]);
  });

  it("the duplicate-mint fixture warns (and --fail-on-warning exits 1)", () => {
    const r = paperSniperCandidatesValidateReport({ cwd: EXAMPLES, env: {} }, { inputPath: "candidates.duplicate-mint.json", json: true });
    expect(r.exitCode).toBe(0);
    const list = validateSniperCandidateList(JSON.parse(r.text));
    expect(list.duplicateMints.length).toBe(1);
    expect(list.warnings.length).toBeGreaterThan(0);
    expect(paperSniperCandidatesValidateReport({ cwd: EXAMPLES, env: {} }, { inputPath: "candidates.duplicate-mint.json", failOnWarning: true }).exitCode).toBe(1);
  });

  it("the invalid-mint fixture is REFUSED (negative fixture)", () => {
    const r = paperSniperCandidatesValidateReport({ cwd: EXAMPLES, env: {} }, { inputPath: "candidates.invalid-mint.json" });
    expect(r.exitCode).toBe(1);
  });

  it("the example policy config validates", () => {
    const r = paperSniperPolicyValidateReport({ cwd: EXAMPLES, env: {} }, { inputPath: "policy.example.json", json: true });
    expect(r.exitCode).toBe(0);
    expect(() => validateSniperPolicyConfig(JSON.parse(r.text))).not.toThrow();
  });

  it("the preflight-inputs fixture is well-formed (per-candidate inspection/risk)", () => {
    const inputs = readJson(ex("preflight-inputs.fictional.json")) as Record<string, { inspection?: unknown; risk?: unknown }>;
    expect(inputs["fic-clean"]!.inspection).toBeDefined();
    expect(inputs["fic-clean"]!.risk).toBeDefined();
    expect(inputs["fic-freeze"]!.inspection).toBeDefined();
    expect(inputs["fic-reject"]!.risk).toBeDefined();
  });
});

describe("examples/sniper — full PAPER pipeline end-to-end (intake -> … -> session pack)", () => {
  it("drives the whole pipeline through the CLI and validates every stage", () => {
    const tmp = mkdtempSync(join(tmpdir(), "sniper-e2e-"));
    try {
      const ctx = { cwd: tmp, env: {} };

      // 1) Intake: produce the CANONICAL candidate list from the fictional fixture.
      const canon = paperSniperCandidatesValidateReport(ctx, { inputPath: ex("candidates.fictional.json"), json: true });
      expect(canon.exitCode).toBe(0);
      writeFileSync(join(tmp, "candidates.json"), canon.text);
      validateSniperCandidateList(JSON.parse(canon.text));

      // Split the preflight-inputs fixture into per-candidate inspection/risk files.
      const inputs = readJson(ex("preflight-inputs.fictional.json")) as Record<string, { inspection?: unknown; risk?: unknown }>;
      const inspections: string[] = [];
      const risks: string[] = [];
      for (const [cid, entry] of Object.entries(inputs)) {
        if (cid.startsWith("_")) continue;
        if (entry.inspection !== undefined) {
          writeFileSync(join(tmp, `${cid}.insp.json`), JSON.stringify(entry.inspection));
          inspections.push(`${cid}=${cid}.insp.json`);
        }
        if (entry.risk !== undefined) {
          writeFileSync(join(tmp, `${cid}.risk.json`), JSON.stringify(entry.risk));
          risks.push(`${cid}=${cid}.risk.json`);
        }
      }

      // 2) Preflight: 1 pass (fic-clean), 1 warn (fic-freeze freeze authority), 1 fail (fic-reject risk REJECT).
      const pf = paperSniperPreflightReport(ctx, { candidatesPath: "candidates.json", inspections, risks, outPath: "preflight.json" });
      expect(pf.exitCode).toBe(0);
      const preflight = validateSniperTokenPreflightReport(readJson(join(tmp, "preflight.json")));
      expect(preflight.passCount).toBe(1);
      expect(preflight.warnCount).toBe(1);
      expect(preflight.failCount).toBe(1);

      // 3) Decide: fic-clean paper-enter, fic-freeze watch, fic-reject paper-reject.
      const dec = paperSniperDecideReport(ctx, { candidatesPath: "candidates.json", preflightPath: "preflight.json", outPath: "decision.json" });
      expect(dec.exitCode).toBe(0);
      const decision = validatePaperSniperDecisionReport(readJson(join(tmp, "decision.json")));
      expect(decision.decisions.find((d) => d.candidateId === "fic-clean")!.decision).toBe("paper-enter");
      expect(decision.decisions.find((d) => d.candidateId === "fic-freeze")!.decision).toBe("watch");
      expect(decision.decisions.find((d) => d.candidateId === "fic-reject")!.decision).toBe("paper-reject");

      // 3b) Decide under the example policy (mutually exclusive with --rules) still validates + stays >= conservative.
      const decPolicy = paperSniperDecideReport(ctx, { candidatesPath: "candidates.json", preflightPath: "preflight.json", policyPath: ex("policy.example.json"), json: true });
      expect(decPolicy.exitCode).toBe(0);
      const decisionPolicy = validatePaperSniperDecisionReport(JSON.parse(decPolicy.text));
      expect(decisionPolicy.paperEnterCount).toBeLessThanOrEqual(decision.paperEnterCount);

      // 4) Run report (full).
      const run = paperSniperReportReport(ctx, { candidatesPath: "candidates.json", preflightPath: "preflight.json", decisionsPath: "decision.json", outPath: "run.json" });
      expect(run.exitCode).toBe(0);
      const runReport = validateSniperRunReport(readJson(join(tmp, "run.json")));
      expect(runReport.paperEnterIds).toEqual(["fic-clean"]);
      expect(runReport.paperRejectIds).toEqual(["fic-reject"]);
      expect(runReport.hasMissingRecommendedArtifact).toBe(false);

      // 5) A baseline run report (candidates only) + diff: the full run newly paper-enters + newly risk-blocks.
      const runBase = paperSniperReportReport(ctx, { candidatesPath: "candidates.json", outPath: "run-base.json" });
      expect(runBase.exitCode).toBe(0);
      const diff = paperSniperDiffReportReport(ctx, { basePath: "run-base.json", nextPath: "run.json", json: true });
      expect(diff.exitCode).toBe(0);
      const reportDiff = validateSniperRunReportDiff(JSON.parse(diff.text));
      expect(reportDiff.hasChange).toBe(true);
      expect(reportDiff.newlyPaperEnterIds).toContain("fic-clean");
      expect(reportDiff.newlyRiskBlockedIds).toContain("fic-reject");

      // 6) Audit log.
      const audit = paperSniperAuditReport(ctx, { reportPath: "run.json", label: "e2e-run", outPath: "audit.json" });
      expect(audit.exitCode).toBe(0);
      const auditLog = validateSniperAuditLog(readJson(join(tmp, "audit.json")));
      expect(auditLog.stepCount).toBe(4);
      expect(auditLog.steps.every((s) => s.ran)).toBe(true);

      // 7) Session pack over the canonical artifacts.
      const pack = paperSniperSessionPackReport(ctx, {
        label: "e2e-session",
        artifacts: ["candidates=candidates.json", "preflight=preflight.json", "decision=decision.json", "run=run.json", "audit=audit.json"],
        outPath: "pack.json",
      });
      expect(pack.exitCode).toBe(0);
      const sessionPack = validateSniperSessionPack(readJson(join(tmp, "pack.json")));
      expect(sessionPack.recognizedCount).toBe(5);
      expect(sessionPack.unsupportedCount).toBe(0);
      expect(sessionPack.coverage.isAudited).toBe(true);
      expect(sessionPack.hasPaperEnter).toBe(true);
      expect(sessionPack.hasRiskBlock).toBe(true);

      // Determinism: regenerating the preflight is byte-identical.
      const pf2 = paperSniperPreflightReport(ctx, { candidatesPath: "candidates.json", inspections, risks, json: true });
      const pf3 = paperSniperPreflightReport(ctx, { candidatesPath: "candidates.json", inspections, risks, json: true });
      expect(pf2.text).toBe(pf3.text);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
