import { describe, it, expect } from "vitest";
import {
  buildTokenRiskReport,
  formatTokenRiskReport,
  RISK_DISCLAIMER,
} from "./risk-report.js";
import type { TokenRiskInput } from "./types.js";

const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const FIXED_TIME = "2026-06-05T12:00:00.000Z";
const at = () => FIXED_TIME;

const CLEAN: TokenRiskInput = {
  mint: MINT,
  decimals: 6,
  supplyRaw: "1000000000000",
  uiSupply: 1_000_000,
  mintAuthorityPresent: false,
  freezeAuthorityPresent: false,
  isInitialized: true,
  programLabel: "spl-token",
};

describe("buildTokenRiskReport", () => {
  it("a clean standard SPL mint produces PASS_FOR_PAPER_EVALUATION at score 0", () => {
    const report = buildTokenRiskReport(CLEAN, { now: at });
    expect(report.decision).toBe("PASS_FOR_PAPER_EVALUATION");
    expect(report.score).toBe(0);
    expect(report.generatedAt).toBe(FIXED_TIME);
  });

  it("denylisted mint → REJECT with a critical flag", () => {
    const report = buildTokenRiskReport({ ...CLEAN, denylist: [MINT] }, { now: at });
    expect(report.decision).toBe("REJECT");
    expect(report.flags.some((f) => f.severity === "critical")).toBe(true);
  });

  it("freeze authority present → REJECT", () => {
    const report = buildTokenRiskReport(
      { ...CLEAN, freezeAuthorityPresent: true },
      { now: at },
    );
    expect(report.decision).toBe("REJECT");
  });

  it("uninitialized mint → REJECT with a critical flag", () => {
    const report = buildTokenRiskReport(
      { ...CLEAN, isInitialized: false },
      { now: at },
    );
    expect(report.decision).toBe("REJECT");
    expect(report.flags.some((f) => f.id === "mint-not-initialized")).toBe(true);
  });

  it("mint authority present → CAUTION (single high flag = 30)", () => {
    const report = buildTokenRiskReport(
      { ...CLEAN, mintAuthorityPresent: true },
      { now: at },
    );
    expect(report.decision).toBe("CAUTION");
    expect(report.score).toBe(30);
  });

  it("carries the advisory disclaimer and read-only summary", () => {
    const report = buildTokenRiskReport(CLEAN, { now: at });
    expect(report.disclaimer).toBe(RISK_DISCLAIMER);
    const joined = report.summary.join("\n");
    expect(joined).toMatch(/not a buy recommendation/i);
    expect(joined).toMatch(/no transaction was built, signed, simulated, or sent/i);
  });

  it("is deterministic with an injectable clock", () => {
    const a = buildTokenRiskReport(CLEAN, { now: at });
    const b = buildTokenRiskReport(CLEAN, { now: at });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("formatTokenRiskReport", () => {
  it("renders a stable, READ-ONLY, advisory block", () => {
    const report = buildTokenRiskReport(
      { ...CLEAN, mintAuthorityPresent: true },
      { now: at },
    );
    const text = formatTokenRiskReport(report);
    expect(text).toContain("Token risk report (READ-ONLY)");
    expect(text).toContain(`mint:        ${MINT}`);
    expect(text).toContain("decision:    CAUTION");
    expect(text).toContain("score:       30/100");
    expect(text).toContain("HIGH: Mint authority present");
    expect(text).toMatch(/not a buy recommendation/i);
    expect(text).toMatch(/no transaction was built, signed, simulated, or sent/i);
  });

  it("is deterministic for a fixed report", () => {
    const report = buildTokenRiskReport(CLEAN, { now: at });
    expect(formatTokenRiskReport(report)).toBe(formatTokenRiskReport(report));
  });

  it("redacts an api-key even if one somehow appears in a mint-shaped field", () => {
    // Defense-in-depth: the report never carries a URL, but the formatter must
    // still scrub a secret-looking span if one is ever injected.
    const report = buildTokenRiskReport(
      { ...CLEAN, mint: "https://rpc.example.com/?api-key=SUPERSECRET" },
      { now: at },
    );
    expect(formatTokenRiskReport(report)).not.toContain("SUPERSECRET");
  });
});
