import { describe, expect, it } from "vitest";

import {
  LIVE_ESCALATION_HARD_CEILINGS,
  LIVE_ESCALATION_MIN_COOLDOWN_MS,
  LiveEscalationError,
  buildEscalationPolicy,
  evaluateEscalation,
  validateEscalationPolicy,
} from "./escalation.js";

describe("escalation policy — build (caps only tighten)", () => {
  it("defaults are conservative and below every ceiling", () => {
    const p = buildEscalationPolicy();
    expect(p.maxCanarySol).toBeLessThanOrEqual(LIVE_ESCALATION_HARD_CEILINGS.maxCanarySol);
    expect(p.maxCanariesPerSession).toBeLessThanOrEqual(LIVE_ESCALATION_HARD_CEILINGS.maxCanariesPerSession);
    expect(p.manualRearmRequired).toBe(true);
    expect(p.largeTradesEnabled).toBe(false);
  });

  it("refuses a per-canary spend over the hard ceiling", () => {
    expect(() => buildEscalationPolicy({ maxCanarySol: 1 })).toThrow(LiveEscalationError);
  });

  it("refuses a per-session count over the hard ceiling", () => {
    expect(() => buildEscalationPolicy({ maxCanariesPerSession: 99 })).toThrow(/tighten/);
  });

  it("refuses a cooldown below the minimum floor (no back-to-back canaries)", () => {
    expect(() => buildEscalationPolicy({ cooldownMs: 100 })).toThrow(/back-to-back/);
    expect(buildEscalationPolicy({ cooldownMs: LIVE_ESCALATION_MIN_COOLDOWN_MS }).cooldownMs).toBe(LIVE_ESCALATION_MIN_COOLDOWN_MS);
  });

  it("validate refuses largeTradesEnabled true and unknown fields", () => {
    const p = buildEscalationPolicy();
    expect(() => validateEscalationPolicy({ ...p, largeTradesEnabled: true })).toThrow(/largeTradesEnabled/);
    expect(() => validateEscalationPolicy({ ...p, surprise: 1 })).toThrow(/CLOSED/);
    expect(validateEscalationPolicy(p)).toEqual(p);
  });
});

describe("escalation — evaluate (default refused; every refusal a code)", () => {
  const policy = buildEscalationPolicy({ maxCanariesPerSession: 2, maxCanariesPerDay: 3, cooldownMs: 60_000, maxFailedAttempts: 2, maxDailyLossSol: 0.02 });
  const NOW = 1_000_000;

  it("allows when armed, under caps, and out of cooldown", () => {
    const r = evaluateEscalation({ policy, session: { armed: true, lastCanaryAtMs: null }, nowMs: NOW });
    expect(r.canaryAllowed).toBe(true);
    expect(r.blockingReasons).toHaveLength(0);
  });

  it("blocks when not armed (manual rearm required)", () => {
    const r = evaluateEscalation({ policy, session: { armed: false }, nowMs: NOW });
    expect(r.canaryAllowed).toBe(false);
    expect(r.blockingReasons).toContain("not-armed");
  });

  it("blocks when paused", () => {
    const r = evaluateEscalation({ policy, session: { armed: true, paused: true }, nowMs: NOW });
    expect(r.blockingReasons).toContain("escalation-paused");
  });

  it("blocks at the per-session cap", () => {
    const r = evaluateEscalation({ policy, session: { armed: true, canariesThisSession: 2 }, nowMs: NOW });
    expect(r.blockingReasons).toContain("session-canary-cap-reached");
    expect(r.remainingThisSession).toBe(0);
  });

  it("blocks at the per-day cap", () => {
    const r = evaluateEscalation({ policy, session: { armed: true, canariesToday: 3 }, nowMs: NOW });
    expect(r.blockingReasons).toContain("daily-canary-cap-reached");
  });

  it("blocks during cooldown and reports remaining ms", () => {
    const r = evaluateEscalation({ policy, session: { armed: true, lastCanaryAtMs: NOW - 10_000 }, nowMs: NOW });
    expect(r.blockingReasons).toContain("cooldown-active");
    expect(r.cooldownRemainingMs).toBe(50_000);
  });

  it("blocks after too many failed attempts", () => {
    const r = evaluateEscalation({ policy, session: { armed: true, failedAttempts: 2 }, nowMs: NOW });
    expect(r.blockingReasons).toContain("failed-attempts-cap-reached");
  });

  it("blocks after the daily loss cap is hit", () => {
    const r = evaluateEscalation({ policy, session: { armed: true, dailyLossSol: 0.02 }, nowMs: NOW });
    expect(r.blockingReasons).toContain("daily-loss-cap-reached");
  });

  it("blocks a planned spend over the canary ceiling (and large-trades-not-enabled)", () => {
    const r = evaluateEscalation({ policy, session: { armed: true }, nowMs: NOW, plannedSpendSol: 0.04 });
    expect(r.blockingReasons).toContain("spend-over-canary-ceiling");
    expect(r.blockingReasons).toContain("large-trades-not-enabled");
  });
});
