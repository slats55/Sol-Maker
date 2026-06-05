import { describe, it, expect } from "vitest";
import {
  scoreRiskFlags,
  SEVERITY_WEIGHTS,
  ALLOWLIST_CREDIT,
  DECISION_THRESHOLDS,
  SCORE_MIN,
  SCORE_MAX,
} from "./risk-score.js";
import type { RiskFlag, RiskSeverity } from "./types.js";

let n = 0;
function mk(severity: RiskSeverity, id?: string): RiskFlag {
  return {
    id: id ?? `flag-${severity}-${n++}`,
    severity,
    title: "t",
    detail: "d",
  };
}

describe("scoreRiskFlags — severity weights", () => {
  it("sums per-severity weights", () => {
    const { score } = scoreRiskFlags([mk("high"), mk("medium"), mk("low")]);
    expect(score).toBe(
      SEVERITY_WEIGHTS.high + SEVERITY_WEIGHTS.medium + SEVERITY_WEIGHTS.low,
    );
  });

  it("info flags contribute zero", () => {
    const { score } = scoreRiskFlags([mk("info"), mk("info")]);
    expect(score).toBe(0);
  });
});

describe("scoreRiskFlags — decisions", () => {
  it("any critical flag forces REJECT regardless of score", () => {
    const r = scoreRiskFlags([mk("critical")]);
    expect(r.hasCritical).toBe(true);
    expect(r.decision).toBe("REJECT");
    expect(r.score).toBe(SCORE_MAX); // critical weight is 100
  });

  it("score >= REJECT_AT (70) without a critical flag still REJECTs", () => {
    // three highs = 90 ≥ 70
    const r = scoreRiskFlags([mk("high"), mk("high"), mk("high")]);
    expect(r.hasCritical).toBe(false);
    expect(r.score).toBeGreaterThanOrEqual(DECISION_THRESHOLDS.REJECT_AT);
    expect(r.decision).toBe("REJECT");
  });

  it("score in [30, 70) → CAUTION", () => {
    // one high = 30
    const r = scoreRiskFlags([mk("high")]);
    expect(r.score).toBe(30);
    expect(r.decision).toBe("CAUTION");
  });

  it("score < 30 → PASS_FOR_PAPER_EVALUATION", () => {
    const r = scoreRiskFlags([mk("medium")]); // 15
    expect(r.score).toBe(15);
    expect(r.decision).toBe("PASS_FOR_PAPER_EVALUATION");
  });

  it("no flags → score 0 → PASS_FOR_PAPER_EVALUATION", () => {
    const r = scoreRiskFlags([]);
    expect(r.score).toBe(0);
    expect(r.decision).toBe("PASS_FOR_PAPER_EVALUATION");
  });
});

describe("scoreRiskFlags — allowlist credit", () => {
  it("applies the allowlist credit once", () => {
    const r = scoreRiskFlags([mk("high"), mk("info", "allowlisted-mint")]);
    expect(r.score).toBe(SEVERITY_WEIGHTS.high + ALLOWLIST_CREDIT); // 30 - 10 = 20
    expect(r.decision).toBe("PASS_FOR_PAPER_EVALUATION");
  });

  it("an allowlist credit can never rescue a critical (still REJECT)", () => {
    const r = scoreRiskFlags([mk("critical"), mk("info", "allowlisted-mint")]);
    expect(r.decision).toBe("REJECT");
  });
});

describe("scoreRiskFlags — clamping", () => {
  it("clamps high above 100 down to 100", () => {
    const many = Array.from({ length: 5 }, () => mk("critical"));
    expect(scoreRiskFlags(many).score).toBe(SCORE_MAX);
  });

  it("clamps below 0 up to 0", () => {
    const credits = Array.from({ length: 5 }, () => mk("info", "allowlisted-mint"));
    // 5 × -10 = -50, but only one credit id is counted per occurrence → still clamps ≥ 0
    expect(scoreRiskFlags(credits).score).toBe(SCORE_MIN);
    expect(scoreRiskFlags(credits).score).toBeGreaterThanOrEqual(SCORE_MIN);
  });
});
