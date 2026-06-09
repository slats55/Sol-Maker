/**
 * Sprint 36 — SNIPER CLI COHESION. Cross-command invariants that keep the `paper:sniper:*` surface
 * professional and consistent, and lock its safety contract so a future command cannot quietly drift:
 *
 *  1. Every command with a required argument REFUSES (exit 1, message starting "Refusing:") when it is
 *     missing — never a crash, never a silent success.
 *  2. No command writes a file by DEFAULT: a command with an `--out` option writes nothing to its cwd
 *     unless `--out` is given (and the no-`--out` run still succeeds).
 *  3. Every command's `--json` output (given valid inputs) is parseable JSON and is deterministic.
 *
 * These run the real command functions over INJECTED, fictional inputs — no network, no wallet, no live
 * data. They are a backstop against accidental inconsistency, not new behavior.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  paperSniperCandidatesValidateReport,
  paperSniperPreflightReport,
  paperSniperDecideReport,
  paperSniperWorkflowReport,
  paperSniperReportReport,
  paperSniperDiffReportReport,
  paperSniperPolicyValidateReport,
  paperSniperAuditReport,
  paperSniperSessionPackReport,
  type CliReport,
} from "./commands.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "sniper-cohesion-"));
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function writeJson(tmp: string, name: string, value: unknown): string {
  writeFileSync(join(tmp, name), JSON.stringify(value, null, 2));
  return name;
}

const cleanInspection = (mint: string) => ({ mint, decimals: 6, supplyRaw: "1", uiSupply: 1, mintAuthorityPresent: false, freezeAuthorityPresent: false, isInitialized: true, programLabel: "spl-token" });
const riskPass = (mint: string) => ({ mint, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [], summary: [] });

/** Build the canonical artifacts a session needs into `tmp`; returns their relative paths. */
function buildArtifacts(tmp: string): { cands: string; pf: string; dec: string; run: string; audit: string } {
  const raw = writeJson(tmp, "cands.raw.json", { candidates: [{ candidateId: "c1", mint: USDC, observedLiquidityUsd: 50000 }, { candidateId: "c2", mint: WSOL }] });
  const canon = paperSniperCandidatesValidateReport({ cwd: tmp, env: {} }, { inputPath: raw, json: true });
  writeFileSync(join(tmp, "cands.json"), canon.text);
  writeJson(tmp, "c1.insp.json", cleanInspection(USDC));
  writeJson(tmp, "c1.risk.json", riskPass(USDC));
  paperSniperPreflightReport({ cwd: tmp, env: {} }, { candidatesPath: "cands.json", inspections: ["c1=c1.insp.json"], risks: ["c1=c1.risk.json"], outPath: "pf.json" });
  paperSniperDecideReport({ cwd: tmp, env: {} }, { candidatesPath: "cands.json", preflightPath: "pf.json", outPath: "dec.json" });
  const run = paperSniperReportReport({ cwd: tmp, env: {} }, { candidatesPath: "cands.json", preflightPath: "pf.json", decisionsPath: "dec.json", json: true });
  writeFileSync(join(tmp, "run.json"), run.text);
  const audit = paperSniperAuditReport({ cwd: tmp, env: {} }, { reportPath: "run.json", label: "r", json: true });
  writeFileSync(join(tmp, "audit.json"), audit.text);
  return { cands: "cands.json", pf: "pf.json", dec: "dec.json", run: "run.json", audit: "audit.json" };
}

describe("paper:sniper:* — required-argument refusals (consistent, never a crash)", () => {
  const cases: { name: string; run: () => CliReport }[] = [
    { name: "candidates:validate (--input)", run: () => paperSniperCandidatesValidateReport({}, {}) },
    { name: "preflight (--candidates)", run: () => paperSniperPreflightReport({}, {}) },
    { name: "decide (--candidates)", run: () => paperSniperDecideReport({}, {}) },
    { name: "report (--candidates)", run: () => paperSniperReportReport({}, {}) },
    { name: "diff:report (--base)", run: () => paperSniperDiffReportReport({}, {}) },
    { name: "diff:report (--next)", run: () => paperSniperDiffReportReport({}, { basePath: "a.json" }) },
    { name: "policy:validate (--input)", run: () => paperSniperPolicyValidateReport({}, {}) },
    { name: "audit (--report)", run: () => paperSniperAuditReport({}, {}) },
    { name: "session:pack (--artifact)", run: () => paperSniperSessionPackReport({}, {}) },
  ];

  for (const c of cases) {
    it(`${c.name} refuses with exit 1 and a "Refusing:" message`, () => {
      const r = c.run();
      expect(r.exitCode).toBe(1);
      expect(r.text.startsWith("Refusing:")).toBe(true);
    });
  }

  it("decide refuses --rules + --policy together (mutually exclusive)", () => {
    withTmp((tmp) => {
      const cands = writeJson(tmp, "cands.json", { candidates: [{ candidateId: "c1", mint: USDC }] });
      const rules = writeJson(tmp, "rules.json", {});
      const policy = writeJson(tmp, "policy.json", {});
      const r = paperSniperDecideReport({ cwd: tmp, env: {} }, { candidatesPath: cands, rulesPath: rules, policyPath: policy });
      expect(r.exitCode).toBe(1);
      expect(r.text.startsWith("Refusing:")).toBe(true);
    });
  });
});

describe("paper:sniper:* — no command writes a file by DEFAULT (no --out)", () => {
  it("preflight / decide / report / audit / session:pack write nothing without --out", () => {
    withTmp((tmp) => {
      const { cands, pf, dec, run, audit } = buildArtifacts(tmp);
      const before = readdirSync(tmp).sort();
      // Each command run WITHOUT --out, with valid inputs, must succeed and write nothing new.
      const runs: CliReport[] = [
        paperSniperPreflightReport({ cwd: tmp, env: {} }, { candidatesPath: cands, inspections: ["c1=c1.insp.json"], risks: ["c1=c1.risk.json"] }),
        paperSniperDecideReport({ cwd: tmp, env: {} }, { candidatesPath: cands, preflightPath: pf }),
        paperSniperReportReport({ cwd: tmp, env: {} }, { candidatesPath: cands, preflightPath: pf, decisionsPath: dec }),
        paperSniperAuditReport({ cwd: tmp, env: {} }, { reportPath: run }),
        paperSniperSessionPackReport({ cwd: tmp, env: {} }, { artifacts: [`cands=${cands}`, `audit=${audit}`] }),
      ];
      for (const r of runs) expect(r.exitCode).toBe(0);
      expect(readdirSync(tmp).sort()).toEqual(before);
    });
  });

  it("workflow + candidates:validate + diff:report + policy:validate write nothing at all", () => {
    withTmp((tmp) => {
      const { cands, run } = buildArtifacts(tmp);
      const policy = writeJson(tmp, "policy.json", { policyLabel: "p" });
      const before = readdirSync(tmp).sort();
      paperSniperWorkflowReport({ cwd: tmp, env: {} }, { candidatesPath: cands });
      paperSniperCandidatesValidateReport({ cwd: tmp, env: {} }, { inputPath: cands });
      paperSniperDiffReportReport({ cwd: tmp, env: {} }, { basePath: run, nextPath: run });
      paperSniperPolicyValidateReport({ cwd: tmp, env: {} }, { inputPath: policy });
      expect(readdirSync(tmp).sort()).toEqual(before);
    });
  });
});

describe("paper:sniper:* — --json output is parseable + deterministic", () => {
  it("every command emits parseable, stable JSON given valid inputs", () => {
    withTmp((tmp) => {
      const { cands, pf, dec, run, audit } = buildArtifacts(tmp);
      const policy = writeJson(tmp, "policy.json", { policyLabel: "p" });
      const json: { name: string; first: string; second: string }[] = [
        ["candidates:validate", () => paperSniperCandidatesValidateReport({ cwd: tmp, env: {} }, { inputPath: cands, json: true })],
        ["preflight", () => paperSniperPreflightReport({ cwd: tmp, env: {} }, { candidatesPath: cands, inspections: ["c1=c1.insp.json"], risks: ["c1=c1.risk.json"], json: true })],
        ["decide", () => paperSniperDecideReport({ cwd: tmp, env: {} }, { candidatesPath: cands, preflightPath: pf, json: true })],
        ["workflow", () => paperSniperWorkflowReport({ cwd: tmp, env: {} }, { candidatesPath: cands, preflightPath: pf, decisionPath: dec, json: true })],
        ["report", () => paperSniperReportReport({ cwd: tmp, env: {} }, { candidatesPath: cands, preflightPath: pf, decisionsPath: dec, json: true })],
        ["diff:report", () => paperSniperDiffReportReport({ cwd: tmp, env: {} }, { basePath: run, nextPath: run, json: true })],
        ["policy:validate", () => paperSniperPolicyValidateReport({ cwd: tmp, env: {} }, { inputPath: policy, json: true })],
        ["audit", () => paperSniperAuditReport({ cwd: tmp, env: {} }, { reportPath: run, label: "r", json: true })],
        ["session:pack", () => paperSniperSessionPackReport({ cwd: tmp, env: {} }, { artifacts: [`cands=${cands}`, `audit=${audit}`], json: true })],
      ].map(([name, fn]) => {
        const f = (fn as () => CliReport)();
        const s = (fn as () => CliReport)();
        return { name: name as string, first: f.text, second: s.text };
      });
      for (const { name, first, second } of json) {
        expect(() => JSON.parse(first), `${name} --json must be parseable`).not.toThrow();
        const parsed = JSON.parse(first) as { schemaVersion?: string };
        expect(typeof parsed.schemaVersion, `${name} --json must carry a schemaVersion`).toBe("string");
        expect(first, `${name} --json must be deterministic`).toBe(second);
        // No JSON artifact should leak a raw private-key-shaped blob (redaction backstop).
        expect(/[1-9A-HJ-NP-Za-km-z]{80,}/.test(first), `${name} --json must not contain a secret-length base58 blob`).toBe(false);
      }
    });
  });
});
