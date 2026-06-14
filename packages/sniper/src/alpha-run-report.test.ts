import { describe, it, expect } from "vitest";
import { buildSniperDryRunCampaign, type SniperDryRunCampaign } from "./dryrun-campaign.js";
import {
  buildSniperAlphaRunReport,
  validateSniperAlphaRunReport,
  formatSniperAlphaRunReport,
  SniperAlphaRunReportError,
  SNIPER_ALPHA_RUN_REPORT_SCHEMA_VERSION,
  SNIPER_ALPHA_RUN_REPORT_BANNER,
  type SniperAlphaRunReport,
} from "./alpha-run-report.js";

const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

function campaign(): SniperDryRunCampaign {
  return buildSniperDryRunCampaign({
    campaignId: "alpha-campaign",
    mode: "mainnet-dry-run",
    network: "mainnet-beta",
    candidates: [
      // clean -> watch
      { candidateId: "wsol", mint: WSOL, rank: 1, score: 95, riskDecision: "PASS_FOR_PAPER_EVALUATION", preflightVerdict: "pass", quoteStatus: "observed" },
      // REJECT risk -> blocked (score is high but can never rescue it)
      { candidateId: "usdc", mint: USDC, rank: 2, score: 99, riskDecision: "REJECT", preflightVerdict: "pass" },
      // no core evidence -> insufficient-evidence
      { candidateId: "bonk", mint: BONK, score: 50 },
    ],
  });
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    campaign: campaign(),
    campaignRef: "campaign.json",
    campaignPlanRef: "readonly-campaign-plan.json",
    ...overrides,
  };
}

describe("buildSniperAlphaRunReport — valid", () => {
  it("builds a report from a campaign and round-trips through the validator", () => {
    const report = buildSniperAlphaRunReport(baseInput());
    expect(report.schemaVersion).toBe(SNIPER_ALPHA_RUN_REPORT_SCHEMA_VERSION);
    expect(report.banner).toBe(SNIPER_ALPHA_RUN_REPORT_BANNER);
    expect(report.mode).toBe("mainnet-dry-run");
    expect(report.candidateCount).toBe(3);
    expect(report.liveTradingStatus).toBe("disabled");
    expect(report.authorizesLiveTrading).toBe(false);
    expect(report.phase7LiveTradingReady).toBe(false);
    expect(() => validateSniperAlphaRunReport(report)).not.toThrow();
  });

  it("partitions the candidates by the campaign's own verdicts", () => {
    const report = buildSniperAlphaRunReport(baseInput());
    expect(report.topCandidates.map((c) => c.candidateId)).toEqual(["wsol"]);
    expect(report.blockedCandidates.map((c) => c.candidateId)).toEqual(["usdc"]);
    expect(report.insufficientEvidenceCandidates.map((c) => c.candidateId)).toEqual(["bonk"]);
    // The blocked candidate keeps a non-empty blocker list (a high score never rescued it).
    expect(report.blockedCandidates[0]!.blockers.length).toBeGreaterThan(0);
  });

  it("copies the campaign stage coverage", () => {
    const report = buildSniperAlphaRunReport(baseInput());
    expect(report.stageCoverage.length).toBeGreaterThan(0);
    const risk = report.stageCoverage.find((s) => s.stage === "risk");
    expect(risk?.candidateCount).toBe(3);
  });

  it("records provider health, rust status, phase7 status and provenance honestly", () => {
    const report = buildSniperAlphaRunReport(
      baseInput({
        providerHealth: { risk: "ok", quote: "degraded", simulation: "unavailable" },
        rustEngineStatus: "available",
        phase7Status: "authorized-for-design-only",
        evidenceProvenance: "real-readonly",
      }),
    );
    expect(report.providerHealthSummary).toEqual({ risk: "ok", quote: "degraded", simulation: "unavailable" });
    expect(report.rustEngineStatus).toBe("available");
    expect(report.phase7Status).toBe("authorized-for-design-only");
    expect(report.evidenceProvenance).toBe("real-readonly");
  });

  it("always appends the live-disabled next-safe-action", () => {
    const report = buildSniperAlphaRunReport(baseInput());
    expect(report.nextSafeActions.some((a) => /Live trading stays DISABLED/.test(a))).toBe(true);
  });

  it("defaults provider/rust/provenance to honest unavailable-ish values", () => {
    const report = buildSniperAlphaRunReport(baseInput());
    expect(report.providerHealthSummary).toEqual({ risk: "not-attempted", quote: "not-attempted", simulation: "not-attempted" });
    expect(report.rustEngineStatus).toBe("not-used");
    expect(report.phase7Status).toBe("not-checked");
    expect(report.evidenceProvenance).toBe("mixed");
  });

  it("respects an explicit topLimit", () => {
    const report = buildSniperAlphaRunReport(baseInput({ topLimit: 0 }));
    expect(report.topCandidates).toHaveLength(0);
  });
});

describe("buildSniperAlphaRunReport — refusals", () => {
  it("refuses a missing campaign", () => {
    expect(() => buildSniperAlphaRunReport({ campaignRef: "c.json", campaignPlanRef: "p.json" } as never)).toThrow(SniperAlphaRunReportError);
  });

  it("refuses an invalid provider health status", () => {
    expect(() => buildSniperAlphaRunReport(baseInput({ providerHealth: { risk: "great" } }))).toThrow(/providerHealth.risk must be one of/);
  });

  it("refuses an invalid evidence provenance", () => {
    expect(() => buildSniperAlphaRunReport(baseInput({ evidenceProvenance: "real" }))).toThrow(/evidenceProvenance must be one of/);
  });

  it("refuses a secret-shaped runId / phase7Status", () => {
    const secret = "z".repeat(96);
    expect(() => buildSniperAlphaRunReport(baseInput({ runId: secret }))).toThrow(/secret-shaped|exceeds/);
    expect(() => buildSniperAlphaRunReport(baseInput({ phase7Status: secret }))).toThrow(/secret-shaped|exceeds/);
  });
});

describe("validateSniperAlphaRunReport — closed schema + safety literals", () => {
  const base = (): SniperAlphaRunReport => buildSniperAlphaRunReport(baseInput());

  it("refuses an unknown / send-result / signature field (closed schema)", () => {
    for (const field of ["sendResult", "signature", "txid", "anything"]) {
      const report = { ...base(), [field]: "x" } as unknown;
      expect(() => validateSniperAlphaRunReport(report), field).toThrow(/the schema is CLOSED/);
    }
  });

  it("refuses a missing field", () => {
    const { runId: _drop, ...rest } = base();
    void _drop;
    expect(() => validateSniperAlphaRunReport(rest)).toThrow(/missing field "runId"/);
  });

  it("refuses liveTradingStatus other than disabled", () => {
    const report = { ...base(), liveTradingStatus: "enabled" } as unknown;
    expect(() => validateSniperAlphaRunReport(report)).toThrow(/liveTradingStatus must literally be "disabled"/);
  });

  it("refuses authorizesLiveTrading set to true", () => {
    const report = { ...base(), authorizesLiveTrading: true } as unknown;
    expect(() => validateSniperAlphaRunReport(report)).toThrow(/authorizesLiveTrading must literally be false/);
  });

  it("refuses phase7LiveTradingReady set to true", () => {
    const report = { ...base(), phase7LiveTradingReady: true } as unknown;
    expect(() => validateSniperAlphaRunReport(report)).toThrow(/phase7LiveTradingReady must literally be false/);
  });

  it("refuses a candidateCount smaller than blocked + insufficient", () => {
    const report = { ...base(), candidateCount: 1 } as unknown;
    expect(() => validateSniperAlphaRunReport(report)).toThrow(/smaller than the blocked \+ insufficient/);
  });

  it("refuses a blocked candidate with no blockers", () => {
    const report = base();
    const tampered = {
      ...report,
      blockedCandidates: [{ ...report.blockedCandidates[0]!, blockers: [] }],
    } as unknown;
    expect(() => validateSniperAlphaRunReport(tampered)).toThrow(/must carry at least one blocker/);
  });

  it("refuses a top candidate whose verdict is blocked", () => {
    const report = base();
    const tampered = {
      ...report,
      topCandidates: [{ ...report.topCandidates[0]!, verdict: "blocked" }],
    } as unknown;
    expect(() => validateSniperAlphaRunReport(tampered)).toThrow(/verdict must be "watch" or "review"/);
  });
});

describe("formatSniperAlphaRunReport", () => {
  it("renders a deterministic, banner-led summary", () => {
    const report = buildSniperAlphaRunReport(baseInput({ evidenceProvenance: "real-readonly" }));
    const text = formatSniperAlphaRunReport(report, { label: "demo" });
    expect(text).toContain(SNIPER_ALPHA_RUN_REPORT_BANNER);
    expect(text).toContain("provenance: real-readonly");
    expect(text).toContain("DISABLED");
    expect(text).toContain("[BLOCKED] usdc");
    expect(formatSniperAlphaRunReport(report, { label: "demo" })).toBe(text);
  });
});
