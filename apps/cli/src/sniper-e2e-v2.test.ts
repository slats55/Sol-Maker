/**
 * Sprint 58 — END-TO-END V2 sniper pipeline test over the shipped FICTIONAL fixtures.
 *
 * This proves the WHOLE v2 surface works together through the real CLI command functions:
 * candidate intake → preflight input validation → preflight → policy v2 → decision v2 →
 * (v1 decision/run report for the audit chain) → audit log → run report v2 → the three spec
 * artifacts → session pack v1 → safety gates v2 → phase6 prereqs v2 → session pack v2.
 *
 * Every fixture is INVENTED (synthetic mints + made-up inspection/risk values) and clearly labeled
 * fictional — nothing here is live data, a real on-chain fact, a trade signal, or a profitability
 * claim. Artifacts are generated into a temp dir (never committed), so they can never drift from
 * the code; every generated artifact is validated with its PRODUCTION validator, the sequence is
 * proven deterministic (two runs, byte-identical files), and every fixture + generated artifact is
 * scanned for secret-shaped fields.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateSniperCandidateList,
  validateSniperPreflightInput,
  validateSniperTokenPreflightReport,
  validateSniperPolicyConfigV2,
  validatePaperSniperDecisionReportV2,
  validatePaperSniperDecisionReport,
  validateSniperRunReport,
  validateSniperRunReportV2,
  validateSniperAuditLog,
  validateSniperKillSwitchSpec,
  validateSniperSecretsPolicy,
  validateSniperBurnerIsolationSpec,
  validateSniperSessionPack,
  validateSniperSafetyGatesReportV2,
  validatePhase6PrerequisiteReportV2,
  validateSniperSessionPackV2,
} from "@soulmaker/sniper";
import {
  paperSniperCandidatesValidateReport,
  paperSniperPreflightInputValidateReport,
  paperSniperPreflightReport,
  paperSniperPolicyValidateReport,
  paperSniperDecideReport,
  paperSniperReportReport,
  paperSniperAuditReport,
  paperSniperKillSwitchSpecReport,
  paperSniperSecretsPolicyReport,
  paperSniperBurnerIsolationSpecReport,
  paperSniperSessionPackReport,
  paperSniperSafetyGatesReport,
  paperPhase6PrereqsReport,
} from "./commands.js";

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), "../../../examples/sniper");

/** The shipped v2-suite input fixtures (all fictional, all labeled). */
const V2_INPUT_FIXTURES = [
  "candidates.fictional.json",
  "preflight-input.v2.fictional.json",
  "policy-v2.fictional.json",
  "kill-switch.config.fictional.json",
  "secrets-policy.config.fictional.json",
  "burner-isolation.config.fictional.json",
] as const;

/** Run the FULL v2 pipeline through the real command functions; returns the generated file names. */
function runV2Pipeline(cwd: string): string[] {
  for (const f of V2_INPUT_FIXTURES) copyFileSync(join(EXAMPLES, f), join(cwd, f));
  const ctx = { cwd, env: {} };
  const must = (label: string, r: { exitCode: number; text: string }): string => {
    expect(r.exitCode, `${label}: ${r.text.slice(0, 200)}`).toBe(0);
    return r.text;
  };

  // 1) intake → canonical candidate list
  writeFileSync(join(cwd, "cands.json"), must("candidates", paperSniperCandidatesValidateReport(ctx, { inputPath: "candidates.fictional.json", json: true })));
  // 2) preflight input validation (cross-checked against the list)
  writeFileSync(join(cwd, "pf-input.json"), must("preflight-input", paperSniperPreflightInputValidateReport(ctx, { inputPath: "preflight-input.v2.fictional.json", candidatesPath: "cands.json", json: true })));
  // 3) preflight, driven by the validated input artifact
  must("preflight", paperSniperPreflightReport(ctx, { candidatesPath: "cands.json", preflightInputPath: "pf-input.json", outPath: "pf.json" }));
  // 4) policy v2
  writeFileSync(join(cwd, "policy2.json"), must("policy-v2", paperSniperPolicyValidateReport(ctx, { inputPath: "policy-v2.fictional.json", schemaVersion: "v2", json: true })));
  // 5) decision v2 under the policy
  must("decision-v2", paperSniperDecideReport(ctx, { candidatesPath: "cands.json", preflightPath: "pf.json", policyPath: "policy2.json", schemaVersion: "v2", outPath: "dec2.json" }));
  // 6-7) v1 decision + v1 run report (the audit log consumes the v1 run report)
  must("decision-v1", paperSniperDecideReport(ctx, { candidatesPath: "cands.json", preflightPath: "pf.json", outPath: "dec1.json" }));
  must("run-report-v1", paperSniperReportReport(ctx, { candidatesPath: "cands.json", preflightPath: "pf.json", decisionsPath: "dec1.json", outPath: "run1.json" }));
  // 8) audit log
  must("audit", paperSniperAuditReport(ctx, { reportPath: "run1.json", label: "fictional-run", outPath: "audit.json" }));
  // 9) run report v2 (rollups + policy visibility + input coverage)
  must("run-report-v2", paperSniperReportReport(ctx, {
    candidatesPath: "cands.json", preflightPath: "pf.json", preflightInputPath: "pf-input.json",
    decisionsPath: "dec2.json", policyPath: "policy2.json", schemaVersion: "v2",
    operatorLabel: "fictional-op", outPath: "run2.json",
  }));
  // 10-12) the three spec artifacts (adopted, fictional)
  must("kill-switch", paperSniperKillSwitchSpecReport(ctx, { inputPath: "kill-switch.config.fictional.json", outPath: "ks.json" }));
  must("secrets-policy", paperSniperSecretsPolicyReport(ctx, { inputPath: "secrets-policy.config.fictional.json", outPath: "sp.json" }));
  must("burner-isolation", paperSniperBurnerIsolationSpecReport(ctx, { inputPath: "burner-isolation.config.fictional.json", outPath: "bi.json" }));
  // 13) session pack v1 (the gates' sessionPack artifact)
  must("session-pack-v1", paperSniperSessionPackReport(ctx, { artifacts: ["cands=cands.json", "dec1=dec1.json", "audit=audit.json"], label: "fictional-session", outPath: "pack1.json" }));
  // 14) safety gates v2 over the whole artifact set (exits 1 when NOT ready — must be ready here)
  must("safety-gates-v2", paperSniperSafetyGatesReport(ctx, {
    schemaVersion: "v2", candidatesPath: "cands.json", preflightInputPath: "pf-input.json",
    preflightPath: "pf.json", policyPath: "policy2.json", decisionsPath: "dec2.json",
    runReportPath: "run2.json", sessionPath: "pack1.json", auditPath: "audit.json",
    operatorLabel: "fictional-op", outPath: "gates2.json",
  }));
  // 15) phase6 prereqs v2 with everything incl. the specs
  must("phase6-prereqs-v2", paperPhase6PrereqsReport(ctx, {
    schemaVersion: "v2", sessionPath: "pack1.json", policyPath: "policy2.json", gatesPath: "gates2.json",
    decisionsPath: "dec2.json", runReportPath: "run2.json", auditPath: "audit.json",
    killSwitchPath: "ks.json", secretsPolicyPath: "sp.json", burnerIsolationPath: "bi.json",
    operatorLabel: "fictional-op", outPath: "prereqs2.json",
  }));
  // 16) session pack v2 bundling the full v2 surface
  must("session-pack-v2", paperSniperSessionPackReport(ctx, {
    schemaVersion: "v2",
    artifacts: [
      "cands=cands.json", "pf-input=pf-input.json", "pf=pf.json", "policy2=policy2.json",
      "dec2=dec2.json", "run2=run2.json", "gates2=gates2.json", "prereqs2=prereqs2.json",
      "ks=ks.json", "sp=sp.json", "bi=bi.json", "audit=audit.json",
    ],
    label: "fictional-session-v2",
    outPath: "pack2.json",
  }));

  return [
    "cands.json", "pf-input.json", "pf.json", "policy2.json", "dec2.json", "dec1.json", "run1.json",
    "audit.json", "run2.json", "ks.json", "sp.json", "bi.json", "pack1.json", "gates2.json",
    "prereqs2.json", "pack2.json",
  ];
}

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "sniper-e2e-v2-"));
  writeFileSync(join(tmp, "soulmaker.config.json"), JSON.stringify({ mode: "PAPER" }));
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const readJson = (dir: string, name: string): unknown => JSON.parse(readFileSync(join(dir, name), "utf8"));

describe("sniper e2e v2 — the full pipeline over the fictional fixtures", () => {
  it("runs end-to-end; every generated artifact validates with its PRODUCTION validator", () => {
    withTmp((tmp) => {
      runV2Pipeline(tmp);
      const list = validateSniperCandidateList(readJson(tmp, "cands.json"));
      expect(list.candidateCount).toBe(3);
      const pfInput = validateSniperPreflightInput(readJson(tmp, "pf-input.json"));
      expect(pfInput.crossCheckedAgainstCandidateList).toBe(true);
      expect(pfInput.missingRiskCount).toBe(1); // fic-freeze (honest)
      validateSniperTokenPreflightReport(readJson(tmp, "pf.json"));
      const policy = validateSniperPolicyConfigV2(readJson(tmp, "policy2.json"));
      expect(policy.policyMode).toBe("research-only");
      const dec2 = validatePaperSniperDecisionReportV2(readJson(tmp, "dec2.json"));
      expect(dec2.paperEnterCount).toBe(0); // research-only: nothing can paper-enter
      expect(dec2.hasRiskReject).toBe(true); // the fictional rug pattern is rejected
      expect(dec2.policySchemaVersion).toBe("sniper.policy.config.v2");
      validatePaperSniperDecisionReport(readJson(tmp, "dec1.json"));
      validateSniperRunReport(readJson(tmp, "run1.json"));
      const audit = validateSniperAuditLog(readJson(tmp, "audit.json"));
      expect(audit.hasFailure).toBe(true); // the risk reject is an audit failure (honest)
      const run2 = validateSniperRunReportV2(readJson(tmp, "run2.json"));
      expect(run2.reasonCodeRollup).not.toBeNull();
      expect(run2.missingRequiredPreflightInput).toBe(false); // required AND supplied
      const ks = validateSniperKillSwitchSpec(readJson(tmp, "ks.json"));
      expect(ks.adopted).toBe(true);
      expect(validateSniperSecretsPolicy(readJson(tmp, "sp.json")).adopted).toBe(true);
      const bi = validateSniperBurnerIsolationSpec(readJson(tmp, "bi.json"));
      expect(bi.killSwitchSpecRef).toBe("fictional-op");
      validateSniperSessionPack(readJson(tmp, "pack1.json"));
      const gates = validateSniperSafetyGatesReportV2(readJson(tmp, "gates2.json"));
      expect(gates.ready).toBe(true); // the governed, fully-bundled session passes the gates
      expect(gates.neverAuthorizesPhase6).toBe(true);
      const prereqs = validatePhase6PrerequisiteReportV2(readJson(tmp, "prereqs2.json"));
      // the audit honestly records the risk reject as a failure, so full readiness stays false —
      // while all three spec buckets ARE met by the adopted fictional specs.
      expect(prereqs.phase6ImplementationReady).toBe(false);
      expect(prereqs.buckets.find((b) => b.bucket === "kill-switch")!.ready).toBe(true);
      expect(prereqs.buckets.find((b) => b.bucket === "secrets-policy")!.ready).toBe(true);
      expect(prereqs.buckets.find((b) => b.bucket === "burner-isolation")!.ready).toBe(true);
      expect(prereqs.phase7LiveTradingReady).toBe(false);
      const pack2 = validateSniperSessionPackV2(readJson(tmp, "pack2.json"));
      expect(pack2.recognizedCount).toBe(12);
      expect(pack2.unsupportedCount).toBe(0);
      expect(pack2.coverage.isV2DecisionReady).toBe(true);
      expect(pack2.coverage.isSpecComplete).toBe(true);
      expect(pack2.coverage.isV2Audited).toBe(true);
      expect(pack2.hasNotAdoptedSpec).toBe(false);
    });
  });

  it("is deterministic: two full runs produce byte-identical artifacts", () => {
    withTmp((a) => {
      withTmp((b) => {
        const filesA = runV2Pipeline(a);
        const filesB = runV2Pipeline(b);
        expect(filesB).toEqual(filesA);
        for (const f of filesA) {
          expect(readFileSync(join(b, f), "utf8"), f).toBe(readFileSync(join(a, f), "utf8"));
        }
      });
    });
  });
});

describe("sniper e2e v2 — fixture hygiene", () => {
  /** Recursively collect every object key and string value. */
  function walk(value: unknown, keys: string[], strings: string[]): void {
    if (typeof value === "string") {
      strings.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) walk(v, keys, strings);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        keys.push(k);
        walk(v, keys, strings);
      }
    }
  }

  it("no shipped fixture or generated artifact contains a realistic secret field", () => {
    withTmp((tmp) => {
      const files = runV2Pipeline(tmp);
      const sources: { name: string; value: unknown }[] = [
        ...V2_INPUT_FIXTURES.map((f) => ({ name: f, value: JSON.parse(readFileSync(join(EXAMPLES, f), "utf8")) as unknown })),
        ...files.map((f) => ({ name: f, value: readJson(tmp, f) })),
      ];
      for (const { name, value } of sources) {
        const keys: string[] = [];
        const strings: string[] = [];
        walk(value, keys, strings);
        // Key names: the artifacts legitimately FORBID these things (forbidRecoveryWordsStorage,
        // storesNoSecretMaterial, secrets-policy schema ids…), so only exact-bearing keys are banned.
        for (const k of keys) {
          expect(/^(privateKey|secretKey|mnemonic|seedPhrase|keypair|passphrase)$/i.test(k), `${name} carries secret-bearing key "${k}"`).toBe(false);
        }
        // Values: nothing key-shaped (long base58/hex, BIP39-shaped phrases).
        for (const s of strings) {
          expect(/^[1-9A-HJ-NP-Za-km-z]{64,}$/.test(s.trim()), `${name} carries a base58 key-shaped value`).toBe(false);
          expect(/^(0x)?[0-9a-fA-F]{64,}$/.test(s.trim()), `${name} carries a hex key-shaped value`).toBe(false);
          const words = s.trim().split(/\s+/);
          expect((words.length === 12 || words.length === 24) && words.every((w) => /^[a-z]{3,8}$/.test(w)), `${name} carries a phrase-shaped value`).toBe(false);
        }
      }
    });
  });

  it("every shipped v2-suite fixture is labeled FICTIONAL in its _comment", () => {
    for (const f of V2_INPUT_FIXTURES) {
      if (f === "candidates.fictional.json") continue; // labeled + covered by the S35 suite
      const raw = JSON.parse(readFileSync(join(EXAMPLES, f), "utf8")) as { _comment?: string };
      expect(typeof raw._comment, f).toBe("string");
      expect(/FICTIONAL/i.test(raw._comment as string), `${f} must be labeled fictional`).toBe(true);
    }
  });

  it("examples/sniper has no stray unlabeled v2 fixture (every *.fictional/*.config file accounted for)", () => {
    const names = readdirSync(EXAMPLES).filter((n) => n.endsWith(".json"));
    for (const extra of names.filter((n) => /v2|config\.fictional/.test(n))) {
      expect(V2_INPUT_FIXTURES.includes(extra as (typeof V2_INPUT_FIXTURES)[number]), `unexpected v2 fixture ${extra} — add it to the suite`).toBe(true);
    }
  });
});
