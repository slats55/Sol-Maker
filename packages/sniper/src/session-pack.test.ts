/**
 * Tests for the Sprint 34 SNIPER SESSION PACK. All inputs are INJECTED artifacts built from the real
 * builders. A known schema is strictly validated and its flags read VERBATIM; an unknown schema is
 * surfaced honestly as `unsupported`. Coverage tiers describe PRESENCE only. Nothing here is a trade
 * signal or a live result.
 */

import { describe, it, expect } from "vitest";
import { REDACTED, redactValue } from "@soulmaker/security";
import {
  buildSniperSessionPack,
  validateSniperSessionPack,
  formatSniperSessionPack,
  SniperSessionPackError,
  SNIPER_SESSION_PACK_SCHEMA_VERSION,
  SNIPER_SESSION_PACK_BANNER,
  type SniperSessionPack,
  type SniperSessionPackArtifactInput,
} from "./session-pack.js";
import { normalizeSniperCandidateList, type SniperCandidateInput } from "./candidate-list.js";
import { buildSniperTokenPreflightReport, type SniperPreflightCandidateData } from "./token-preflight.js";
import { buildPaperSniperDecisionReport } from "./paper-decision.js";
import { buildSniperRunReport } from "./run-report.js";
import { buildSniperAuditLog } from "./audit-log.js";
import { normalizeSniperPolicyConfig } from "./policy-config.js";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL = "So11111111111111111111111111111111111111112";

const listOf = (...cands: SniperCandidateInput[]) => normalizeSniperCandidateList({ sourceLabel: "src", candidates: cands });
const cand = (over: Partial<SniperCandidateInput> & { candidateId: string; mint: string }): SniperCandidateInput => over;
const cleanInspection = (mint: string) => ({ mint, decimals: 6, supplyRaw: "1", uiSupply: 1, mintAuthorityPresent: false, freezeAuthorityPresent: false, isInitialized: true, programLabel: "spl-token" });
const riskPass = (mint: string) => ({ mint, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [], summary: [] });
const riskReject = (mint: string) => ({ mint, score: 95, decision: "REJECT", flags: [{ id: "rug", severity: "critical", title: "Rug" }], summary: [] });

/** A full set of session artifacts (candidate list + preflight + decision + run report + audit + policy). */
function fullSession() {
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
  const policy = normalizeSniperPolicyConfig({ policyLabel: "p" });
  return { list, preflight, decision, runReport, audit, policy };
}

const art = (label: string, value: unknown, sourceLabel?: string): SniperSessionPackArtifactInput => ({ label, value, sourceLabel });

describe("buildSniperSessionPack — classification + coverage", () => {
  it("classifies every known artifact, reads flags verbatim, and reports coverage tiers", () => {
    const s = fullSession();
    const pack = buildSniperSessionPack({
      sessionLabel: "session-7",
      artifacts: [
        art("cands", s.list),
        art("pf", s.preflight),
        art("dec", s.decision),
        art("run", s.runReport),
        art("audit", s.audit),
        art("policy", s.policy),
      ],
    });
    expect(pack.schemaVersion).toBe(SNIPER_SESSION_PACK_SCHEMA_VERSION);
    expect(pack.artifactCount).toBe(6);
    expect(pack.recognizedCount).toBe(6);
    expect(pack.unsupportedCount).toBe(0);
    expect(pack.kindsPresent).toEqual(["audit-log", "candidate-list", "paper-decision", "policy-config", "run-report", "token-preflight"]);

    // coverage tiers (PRESENCE only)
    expect(pack.coverage.isMinimal).toBe(true);
    expect(pack.coverage.isDecisionReady).toBe(true);
    expect(pack.coverage.isAudited).toBe(true);

    // verbatim flags: the decision had a paper-enter (good) + a risk reject (bad)
    const decEntry = pack.artifacts.find((a) => a.label === "dec")!;
    expect(decEntry.hasPaperEnter).toBe(true);
    expect(decEntry.hasRiskBlock).toBe(true);
    expect(pack.hasPaperEnter).toBe(true);
    expect(pack.hasRiskBlock).toBe(true);
    expect(() => validateSniperSessionPack(pack)).not.toThrow();
  });

  it("surfaces an unknown schema as unsupported (never refused)", () => {
    const s = fullSession();
    const pack = buildSniperSessionPack({
      artifacts: [art("cands", s.list), art("mystery", { schemaVersion: "backtest.report.v1", foo: 1 }), art("noschema", { foo: 2 })],
    });
    expect(pack.unsupportedCount).toBe(2);
    expect(pack.hasUnsupported).toBe(true);
    const mystery = pack.artifacts.find((a) => a.label === "mystery")!;
    expect(mystery.kind).toBe("unsupported");
    expect(mystery.recognized).toBe(false);
    expect(mystery.notes.some((n) => /unknown schemaVersion/.test(n))).toBe(true);
    const noschema = pack.artifacts.find((a) => a.label === "noschema")!;
    expect(noschema.notes.some((n) => /no schemaVersion/.test(n))).toBe(true);
    expect(pack.warnings.some((w) => /unsupported/.test(w))).toBe(true);
  });

  it("reports a partial session honestly (candidate list only)", () => {
    const s = fullSession();
    const pack = buildSniperSessionPack({ artifacts: [art("cands", s.list)] });
    expect(pack.coverage.isMinimal).toBe(true);
    expect(pack.coverage.isDecisionReady).toBe(false);
    expect(pack.coverage.isAudited).toBe(false);
    expect(pack.hasPaperEnter).toBe(false);
  });
});

describe("buildSniperSessionPack — strictness + determinism", () => {
  it("REFUSES an artifact that claims a known schema but is corrupt", () => {
    const s = fullSession();
    const corrupt = JSON.parse(JSON.stringify(s.decision)) as Record<string, unknown>;
    corrupt.paperEnterCount = "lots"; // breaks validation
    expect(() => buildSniperSessionPack({ artifacts: [art("dec", corrupt)] })).toThrow(/claims sniper.paper.decision.report.v1 but is invalid/);
  });

  it("refuses a duplicate label, a missing label, and an empty set", () => {
    const s = fullSession();
    expect(() => buildSniperSessionPack({ artifacts: [art("x", s.list), art("x", s.preflight)] })).toThrow(/duplicate artifact label/);
    expect(() => buildSniperSessionPack({ artifacts: [{ label: "", value: s.list }] })).toThrow(/label must be a non-empty string/);
    expect(() => buildSniperSessionPack({ artifacts: [] })).toThrow(/at least one artifact/);
  });

  it("is byte-stable, non-mutating, and redactValue round-trips", () => {
    const s = fullSession();
    const input = { sessionLabel: "x", artifacts: [art("cands", s.list), art("run", s.runReport)] };
    const before = JSON.stringify(input);
    const a = JSON.stringify(buildSniperSessionPack(input));
    const b = JSON.stringify(buildSniperSessionPack(input));
    expect(a).toBe(b);
    expect(JSON.stringify(input)).toBe(before);
    const redacted = redactValue(buildSniperSessionPack(input));
    expect(() => validateSniperSessionPack(redacted)).not.toThrow();
    expect(JSON.stringify(redacted)).not.toContain("[Circular]");
  });
});

describe("validateSniperSessionPack", () => {
  const sample = (): SniperSessionPack => {
    const s = fullSession();
    return buildSniperSessionPack({ artifacts: [art("cands", s.list), art("dec", s.decision)] });
  };

  it("accepts a freshly-built pack (round-trips through JSON)", () => {
    expect(() => validateSniperSessionPack(JSON.parse(JSON.stringify(sample())))).not.toThrow();
  });

  it("rejects a wrong schemaVersion and a bad kind", () => {
    expect(() => validateSniperSessionPack(null)).toThrow(SniperSessionPackError);
    const p = JSON.parse(JSON.stringify(sample())) as SniperSessionPack;
    (p as unknown as { schemaVersion: string }).schemaVersion = "sniper.session.pack.v2";
    expect(() => validateSniperSessionPack(p)).toThrow(/schemaVersion/);
    const p2 = JSON.parse(JSON.stringify(sample())) as SniperSessionPack;
    (p2.artifacts[0] as unknown as { kind: string }).kind = "mystery";
    expect(() => validateSniperSessionPack(p2)).toThrow(/kind must be/);
  });

  it("rejects an artifacts length that disagrees with artifactCount", () => {
    const p = JSON.parse(JSON.stringify(sample())) as SniperSessionPack;
    p.artifacts.pop();
    expect(() => validateSniperSessionPack(p)).toThrow(/length must equal artifactCount/);
  });
});

describe("formatSniperSessionPack", () => {
  it("renders a stable, sectioned PAPER-ONLY human pack", () => {
    const s = fullSession();
    const pack = buildSniperSessionPack({ artifacts: [art("cands", s.list), art("dec", s.decision), art("audit", s.audit)] });
    const text = formatSniperSessionPack(pack);
    expect(text).toBe(formatSniperSessionPack(pack)); // deterministic
    expect(text).toContain(SNIPER_SESSION_PACK_BANNER);
    expect(text).toContain("PAPER ONLY");
    expect(text).toContain("Coverage (PRESENCE only");
    expect(text.toLowerCase()).toContain("not a trade signal");
  });

  it("routes the whole output through the shared redactor", () => {
    const secretish = "a".repeat(64);
    const list = normalizeSniperCandidateList({ sourceLabel: secretish, candidates: [{ candidateId: "c1", mint: USDC }] });
    const text = formatSniperSessionPack(buildSniperSessionPack({ sessionLabel: secretish, artifacts: [art("c", list)] }));
    expect(text).toContain(REDACTED);
    expect(text).not.toContain(secretish);
  });
});
