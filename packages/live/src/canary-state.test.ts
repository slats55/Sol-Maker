import { describe, expect, it } from "vitest";

import {
  CANARY_STATES,
  canaryReplay,
  canaryTransition,
  isCanaryState,
  isCanaryTerminal,
} from "./canary-state.js";

describe("canary state machine — legal lifecycle", () => {
  it("walks the full happy path to reconciled", () => {
    const result = canaryReplay("preflight_ready", [
      "ARM_AND_REQUEST_PHANTOM",
      "PHANTOM_SUBMITTED",
      "SUBMIT_CONFIRMED",
      "RECONCILED",
    ]);
    expect(result.ok).toBe(true);
    expect(result.state).toBe("reconciled");
  });

  it("quote_ready advances to preflight_ready on a green simulation", () => {
    expect(canaryTransition("quote_ready", "SIMULATION_OK")).toEqual({ ok: true, state: "preflight_ready", error: null });
  });

  it("a Phantom rejection lands in user_rejected (terminal)", () => {
    const r = canaryTransition("phantom_requested", "PHANTOM_REJECTED");
    expect(r.state).toBe("user_rejected");
    expect(isCanaryTerminal(r.state)).toBe(true);
  });

  it("a submitted transaction can fail", () => {
    expect(canaryTransition("submitted", "SUBMIT_FAILED").state).toBe("failed");
  });
});

describe("canary state machine — illegal transitions are refused", () => {
  it("cannot jump straight from preflight_ready to confirmed", () => {
    const r = canaryTransition("preflight_ready", "SUBMIT_CONFIRMED");
    expect(r.ok).toBe(false);
    expect(r.state).toBe("preflight_ready");
    expect(r.error).toMatch(/not legal/);
  });

  it("cannot leave a terminal state", () => {
    for (const terminal of ["blocked_by_policy", "blocked_by_risk", "user_rejected", "failed", "reconciled"] as const) {
      const r = canaryTransition(terminal, "ARM_AND_REQUEST_PHANTOM");
      expect(r.ok).toBe(false);
      expect(r.state).toBe(terminal);
    }
  });

  it("cannot arm directly from quote_ready (preflight is mandatory)", () => {
    expect(canaryTransition("quote_ready", "ARM_AND_REQUEST_PHANTOM").ok).toBe(false);
  });

  it("refuses an unknown event", () => {
    // @ts-expect-error testing a runtime-invalid event
    const r = canaryTransition("preflight_ready", "TELEPORT");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown canary event/);
  });

  it("refuses an unknown state", () => {
    // @ts-expect-error testing a runtime-invalid state
    const r = canaryTransition("nowhere", "ARM_AND_REQUEST_PHANTOM");
    expect(r.ok).toBe(false);
  });

  it("a replay stops at the first illegal transition and reports it", () => {
    const r = canaryReplay("preflight_ready", ["ARM_AND_REQUEST_PHANTOM", "RECONCILED"]);
    expect(r.ok).toBe(false);
    expect(r.state).toBe("phantom_requested");
  });
});

describe("canary state machine — helpers", () => {
  it("isCanaryState recognizes every declared state and rejects others", () => {
    for (const s of CANARY_STATES) expect(isCanaryState(s)).toBe(true);
    expect(isCanaryState("almost")).toBe(false);
    expect(isCanaryState(42)).toBe(false);
  });
});
