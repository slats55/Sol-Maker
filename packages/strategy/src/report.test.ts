import { describe, it, expect } from "vitest";
import { evaluateStrategy } from "./evaluate.js";
import {
  formatStrategyReport,
  buildStrategyEnvelope,
  STRATEGY_DISCLAIMER,
} from "./report.js";
import type { RiskDecision, TokenRiskReport } from "@soulmaker/risk";
import type { StrategyCandidate, StrategyConfig } from "./types.js";

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NOW = "2026-06-05T12:00:00.000Z";
const at = () => NOW;

function risk(decision: RiskDecision, score: number): TokenRiskReport {
  return {
    mint: MINT,
    score,
    decision,
    flags: [],
    summary: ["advisory only"],
    generatedAt: NOW,
    disclaimer: "advisory only",
  };
}

const config: StrategyConfig = {
  minScoreForPaperBuy: 55,
  minScoreForWatch: 30,
  maxRiskScore: 60,
};

function buyReport() {
  const candidate: StrategyCandidate = {
    mint: MINT,
    symbol: "WIF",
    riskReport: risk("PASS_FOR_PAPER_EVALUATION", 0),
    source: "snipe-list",
  };
  return evaluateStrategy({ candidate, config, now: at });
}

describe("formatStrategyReport", () => {
  it("renders a stable PAPER-ONLY block with the decision, score and risk line", () => {
    const text = formatStrategyReport(buyReport());
    expect(text).toContain("PAPER ONLY");
    expect(text).toContain(`mint:        ${MINT}`);
    expect(text).toContain("symbol:      WIF");
    expect(text).toContain("decision:    PAPER_BUY_CANDIDATE");
    expect(text).toContain("score:       ");
    expect(text).toContain("PASS_FOR_PAPER_EVALUATION");
    expect(text).toContain(`created:     ${NOW}`);
  });

  it("contains the required paper-only / not-advice product language", () => {
    const text = formatStrategyReport(buyReport());
    expect(text).toMatch(/paper only/i);
    expect(text).toMatch(/not financial advice/i);
    expect(text).toMatch(/not a buy recommendation/i);
    expect(text).toMatch(/not live-trading authorization/i);
    expect(text).toMatch(/no transaction was built, signed, simulated, or sent/i);
    expect(text).toMatch(/candidate for simulated paper evaluation/i);
  });

  it("is deterministic for a fixed report", () => {
    const report = buyReport();
    expect(formatStrategyReport(report)).toBe(formatStrategyReport(report));
  });

  it("redacts a secret-looking span if one is ever injected into a field", () => {
    const candidate: StrategyCandidate = {
      mint: "https://rpc.example.com/?api-key=SUPERSECRET",
      riskReport: risk("PASS_FOR_PAPER_EVALUATION", 0),
    };
    const report = evaluateStrategy({ candidate, config, now: at });
    expect(formatStrategyReport(report)).not.toContain("SUPERSECRET");
  });
});

describe("buildStrategyEnvelope", () => {
  it("carries the banner, disclaimer and notes so language survives serialization", () => {
    const envelope = buildStrategyEnvelope(buyReport());
    expect(envelope.paperOnly).toBe(true);
    expect(envelope.notFinancialAdvice).toBe(true);
    expect(envelope.disclaimer).toBe(STRATEGY_DISCLAIMER);
    const json = JSON.stringify(envelope);
    expect(json).toMatch(/no transaction was built, signed, simulated, or sent/i);
    expect(json).toMatch(/not a buy recommendation/i);
  });
});
