/**
 * Tests for the Sprint 39 SNIPER SAFETY GATES. All inputs are INJECTED session packs built from the real
 * builders. The gates are FAIL-CLOSED. Passing is local/paper readiness ONLY — never Phase 6
 * authorization or a trade signal.
 */

import { describe, it, expect } from "vitest";
import { REDACTED } from "@soulmaker/security";
import {
  buildSniperSafetyGatesReport,
  validateSniperSafetyGatesReport,
  formatSniperSafetyGatesReport,
  SniperSafetyGatesReportError,
  SNIPER_SAFETY_GATES_REPORT_SCHEMA_VERSION,
  SNIPER_SAFETY_GATES_REPORT_BANNER,
  type SniperSafetyGatesReport,
} from "./safety-gates.js";
import { buildSniperSessionPack, type SniperSessionPackArtifactInput } from "./session-pack.js";
import { normalizeSniperCandidateList, type SniperCandidateInput } from "./candidate-list.js";
import { buildSniperTokenPreflightReport, type SniperPreflightCandidateData } from "./token-preflight.js";
import { buildPaperSniperDecisionReport } from "./paper-decision.js";
import { buildSniperRunReport } from "./run-report.js";
import { buildSniperAuditLog } from "./audit-log.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

const listOf = (...cands: SniperCandidateInput[]) => normalizeSniperCandidateList({ sourceLabel: "src", candidates: cands });
const cand = (over: Partial<SniperCandidateInput> & { candidateId: string; mint: string }): SniperCandidateInput => over;
const cleanInspection = (mint: string) => ({ mint, decimals: 6, supplyRaw: "1", uiSupply: 1, mintAuthorityPresent: false, freezeAuthorityPresent: false, isInitialized: true, programLabel: "spl-token" });
const riskPass = (mint: string) => ({ mint, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [], summary: [] });
const riskReject = (mint: string) => ({ mint, score: 95, decision: "REJECT", flags: [{ id: "rug", severity: "critical", title: "Rug" }], summary: [] });

const art = (label: string, value: unknown): SniperSessionPackArtifactInput => ({ label, value });

/** A complete session pack (candidate list + preflight + decision + run report + audit). */
function fullSessionPack() {
  const list = listOf(cand({ candidateId: "good", mint: USDC }), cand({ candidateId: "bad", mint: WSOL }));
  const preflight = buildSniperTokenPreflightReport({
    candidateList: list,
    candidateData: [
      { candidateId: "good", inspection: cleanInspection(USDC), risk: riskPass(USDC) },
      { candidateId: "bad", risk: riskReject(WSOL) },
    ] as SniperPreflightCandidateData[],
  });
  const decision = buildPaperSniperDecisionReport({ candidateList: list, preflight });
  const runReport = buildSniperRunReport({ candidateList: list, preflight, decision });
  const audit = buildSniperAuditLog({ runReport, runLabel: "r" });
  return buildSniperSessionPack({
    sessionLabel: "full",
    artifacts: [art("cands", list), art("pf", preflight), art("dec", decision), art("run", runReport), art("audit", audit)],
  });
}

describe("buildSniperSafetyGatesReport — fail-closed evaluation", () => {
  it("a complete session with a paper-enter + risk-block is NOT ready by default (fail-closed)", () => {
    const report = buildSniperSafetyGatesReport({ sessionPack: fullSessionPack() });
    expect(report.schemaVersion).toBe(SNIPER_SAFETY_GATES_REPORT_SCHEMA_VERSION);
    // presence gates pass, but NO_RISK_BLOCK and NO_PAPER_ENTER fail (not allowed)
    expect(report.gates.find((g) => g.id === "NO_RISK_BLOCK")!.status).toBe("fail");
    expect(report.gates.find((g) => g.id === "NO_PAPER_ENTER")!.status).toBe("fail");
    expect(report.ready).toBe(false);
    expect(report.hasFailure).toBe(true);
    expect(report.failReasons.length).toBeGreaterThan(0);
    expect(() => validateSniperSafetyGatesReport(report)).not.toThrow();
  });

  it("allowances downgrade the corresponding fails to warns and reach ready", () => {
    const report = buildSniperSafetyGatesReport({
      sessionPack: fullSessionPack(),
      allowances: { allowRiskBlock: true, allowPaperEnter: true },
    });
    expect(report.gates.find((g) => g.id === "NO_RISK_BLOCK")!.status).toBe("warn");
    expect(report.gates.find((g) => g.id === "NO_PAPER_ENTER")!.status).toBe("warn");
    expect(report.ready).toBe(true);
    expect(report.hasWarning).toBe(true);
    expect(report.recommendation).toMatch(/NOT Phase 6 authorization/);
  });

  it("fails the required presence gates when the decision/audit are absent", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pack = buildSniperSessionPack({ artifacts: [art("cands", list)] });
    const report = buildSniperSafetyGatesReport({ sessionPack: pack });
    expect(report.gates.find((g) => g.id === "CANDIDATE_LIST_PRESENT")!.status).toBe("pass");
    expect(report.gates.find((g) => g.id === "DECISION_PRESENT")!.status).toBe("fail");
    expect(report.gates.find((g) => g.id === "AUDIT_LOG_PRESENT")!.status).toBe("fail");
    expect(report.gates.find((g) => g.id === "PREFLIGHT_PRESENT")!.status).toBe("warn"); // recommended, not required
    expect(report.ready).toBe(false);
  });

  it("fails NO_UNSUPPORTED_ARTIFACT when the session has an unsupported artifact", () => {
    const list = listOf(cand({ candidateId: "c1", mint: USDC }));
    const pack = buildSniperSessionPack({ artifacts: [art("cands", list), art("mystery", { schemaVersion: "backtest.report.v1" })] });
    const report = buildSniperSafetyGatesReport({ sessionPack: pack });
    expect(report.gates.find((g) => g.id === "NO_UNSUPPORTED_ARTIFACT")!.status).toBe("fail");
    expect(report.ready).toBe(false);
  });

  it("always marks the PHASE6 gate skip (Phase 6 not started by design)", () => {
    const report = buildSniperSafetyGatesReport({ sessionPack: fullSessionPack(), allowances: { allowRiskBlock: true, allowPaperEnter: true } });
    const phase6 = report.gates.find((g) => g.id === "PHASE6_NOT_STARTED")!;
    expect(phase6.status).toBe("skip");
    expect(phase6.required).toBe(false);
    // even when ready, the recommendation never authorizes Phase 6
    expect(report.recommendation).not.toMatch(/start Phase 6|authorized|proceed to Phase 6/i);
  });
});

describe("buildSniperSafetyGatesReport — determinism + rejection", () => {
  it("is byte-stable, non-mutating, and echoes resolved allowances", () => {
    const pack = fullSessionPack();
    const before = JSON.stringify(pack);
    const a = JSON.stringify(buildSniperSafetyGatesReport({ sessionPack: pack }));
    const b = JSON.stringify(buildSniperSafetyGatesReport({ sessionPack: pack }));
    expect(a).toBe(b);
    expect(JSON.stringify(pack)).toBe(before);
    const report = buildSniperSafetyGatesReport({ sessionPack: pack });
    expect(report.allowances).toEqual({ allowUnknown: false, allowRiskBlock: false, allowPaperEnter: false });
  });

  it("refuses a non-session-pack input and bad allowances", () => {
    expect(() => buildSniperSafetyGatesReport({ sessionPack: { schemaVersion: "x" } })).toThrow(/session pack is invalid/);
    expect(() => buildSniperSafetyGatesReport({ sessionPack: fullSessionPack(), allowances: { allowUnknown: "yes" as never } })).toThrow(/must be a boolean/);
  });
});

describe("validateSniperSafetyGatesReport", () => {
  const sample = (): SniperSafetyGatesReport => buildSniperSafetyGatesReport({ sessionPack: fullSessionPack() });

  it("accepts a freshly-built report (round-trips through JSON)", () => {
    expect(() => validateSniperSafetyGatesReport(JSON.parse(JSON.stringify(sample())))).not.toThrow();
  });

  it("rejects a wrong schemaVersion and a bad gate status", () => {
    expect(() => validateSniperSafetyGatesReport(null)).toThrow(SniperSafetyGatesReportError);
    const r = JSON.parse(JSON.stringify(sample())) as SniperSafetyGatesReport;
    (r as unknown as { schemaVersion: string }).schemaVersion = "sniper.safety.gates.report.v2";
    expect(() => validateSniperSafetyGatesReport(r)).toThrow(/schemaVersion/);
    const r2 = JSON.parse(JSON.stringify(sample())) as SniperSafetyGatesReport;
    (r2.gates[0] as unknown as { status: string }).status = "boom";
    expect(() => validateSniperSafetyGatesReport(r2)).toThrow(/status must be/);
  });
});

describe("formatSniperSafetyGatesReport", () => {
  it("renders a stable, sectioned PAPER-ONLY human gates report", () => {
    const report = buildSniperSafetyGatesReport({ sessionPack: fullSessionPack() });
    const text = formatSniperSafetyGatesReport(report);
    expect(text).toBe(formatSniperSafetyGatesReport(report)); // deterministic
    expect(text).toContain(SNIPER_SAFETY_GATES_REPORT_BANNER);
    expect(text).toContain("PAPER ONLY");
    expect(text).toContain("READY:    NO");
    expect(text.toLowerCase()).toContain("not authorization to start phase 6");
  });

  it("routes the whole output through the shared redactor", () => {
    const secretish = "a".repeat(64);
    const list = normalizeSniperCandidateList({ sourceLabel: secretish, candidates: [{ candidateId: "c1", mint: USDC }] });
    const pack = buildSniperSessionPack({ sessionLabel: secretish, artifacts: [art("c", list)] });
    const text = formatSniperSafetyGatesReport(buildSniperSafetyGatesReport({ sessionPack: pack, operatorLabel: secretish }));
    expect(text).toContain(REDACTED);
    expect(text).not.toContain(secretish);
  });
});
