/**
 * Sprint 103-B — the Phase 7 human sign-off builder/validator.
 *
 * The record is a MECHANISM for a future explicit human authorization — it authorizes nothing by
 * itself. These tests pin:
 *   - the default record is `template-only` (a blank checklist), scope `none`;
 *   - a missing acknowledgement refuses any signed status;
 *   - the granted scope can never exceed controlled-microtrade and there is no autonomous-trading scope;
 *   - a fully-signed controlled-microtrade record STILL pins authorizesLiveExecution=false / neverSends;
 *   - a max-spend above the micro ceiling is refused; a secret-shaped / bad label is refused;
 *   - the validator is a closed-schema parity wall: a tampered status / scope / flipped lock is refused.
 */

import { describe, it, expect } from "vitest";
import {
  buildPhase7HumanSignoff,
  validatePhase7HumanSignoff,
  requiredAcknowledgementsFor,
  grantedScopeFor,
  Phase7HumanSignoffError,
  PHASE7_MICROTRADE_MAX_SPEND_LAMPORTS,
} from "./phase7-human-signoff.js";

const MICRO_ACK_IDS = requiredAcknowledgementsFor("controlled-mainnet-microtrade-only").map((a) => a.id);
const DESIGN_ACK_IDS = requiredAcknowledgementsFor("design-review-only").map((a) => a.id);

describe("phase7 human sign-off — default + design", () => {
  it("the default record is a template-only checklist that authorizes nothing", () => {
    const r = buildPhase7HumanSignoff();
    expect(r.signoffStatus).toBe("template-only");
    expect(r.grantedScope).toBe("none");
    expect(r.targetScope).toBe("controlled-mainnet-microtrade-only");
    expect(r.requiredAcknowledgements.length).toBe(MICRO_ACK_IDS.length);
    expect(r.missingAcknowledgements).toEqual(MICRO_ACK_IDS);
    expect(r.authorizesLiveExecution).toBe(false);
    expect(r.neverSends).toBe(true);
    expect(r.phase7LiveTradingReady).toBe(false);
    expect(() => validatePhase7HumanSignoff(r)).not.toThrow();
  });

  it("a partial attempt is not-signed until every required acknowledgement is supplied", () => {
    const r = buildPhase7HumanSignoff({
      targetScope: "design-review-only",
      acknowledgedIds: DESIGN_ACK_IDS.slice(0, 1),
      operatorLabel: "operator-a",
      signedAtLabel: "2026-06-13",
    });
    expect(r.signoffStatus).toBe("not-signed");
    expect(r.grantedScope).toBe("none");
    expect(r.missingAcknowledgements.length).toBeGreaterThan(0);
  });

  it("a complete design-review record is signed-for-s104-design (NOT a micro-trade authorization)", () => {
    const r = buildPhase7HumanSignoff({
      repoSha: "abc1234",
      targetScope: "design-review-only",
      acknowledgedIds: DESIGN_ACK_IDS,
      operatorLabel: "operator-a",
      signedAtLabel: "2026-06-13",
    });
    expect(r.signoffStatus).toBe("signed-for-s104-design");
    expect(r.grantedScope).toBe("design-review-only");
    // It does NOT carry a micro-trade spend authorization.
    expect(r.maxSpendLamports).toBeNull();
    expect(() => validatePhase7HumanSignoff(r)).not.toThrow();
  });
});

describe("phase7 human sign-off — controlled micro-trade", () => {
  function fullMicroInput(overrides: Record<string, unknown> = {}) {
    return {
      repoSha: "e607238",
      auditArtifactRef: "phase7.authorization.audit.v1",
      targetScope: "controlled-mainnet-microtrade-only" as const,
      acknowledgedIds: MICRO_ACK_IDS,
      operatorLabel: "operator-a",
      signedAtLabel: "2026-06-13",
      maxSpendLamports: 1_000_000,
      ...overrides,
    };
  }

  it("a fully-signed micro-trade record records evidence but still authorizes no live execution", () => {
    const r = buildPhase7HumanSignoff(fullMicroInput());
    expect(r.signoffStatus).toBe("signed-for-controlled-microtrade");
    expect(r.grantedScope).toBe("controlled-mainnet-microtrade-only");
    expect(r.maxSpendLamports).toBe(1_000_000);
    expect(r.maxSpendSol).toBe(0.001);
    // Even fully signed, every live-execution lock holds.
    expect(r.authorizesLiveExecution).toBe(false);
    expect(r.requiresSeparateExecutionSprint).toBe(true);
    expect(r.neverSends).toBe(true);
    expect(r.phase7LiveTradingReady).toBe(false);
    expect(r.oneTradeOnly).toBe(true);
    expect(r.noAutonomousTrading).toBe(true);
    expect(() => validatePhase7HumanSignoff(r)).not.toThrow();
  });

  it("a missing max-spend keeps a micro-trade record not-signed", () => {
    const r = buildPhase7HumanSignoff(fullMicroInput({ maxSpendLamports: null }));
    expect(r.signoffStatus).toBe("not-signed");
  });

  it("refuses a max-spend above the micro ceiling", () => {
    expect(() => buildPhase7HumanSignoff(fullMicroInput({ maxSpendLamports: PHASE7_MICROTRADE_MAX_SPEND_LAMPORTS + 1 }))).toThrow(/ceiling/);
  });

  it("refuses a max-spend on a non-micro-trade target scope", () => {
    expect(() =>
      buildPhase7HumanSignoff({ targetScope: "design-review-only", acknowledgedIds: DESIGN_ACK_IDS, operatorLabel: "a", signedAtLabel: "x", maxSpendLamports: 1000 }),
    ).toThrow(/only meaningful/);
  });

  it("the granted scope is never broader than controlled-microtrade", () => {
    expect(grantedScopeFor("signed-for-controlled-microtrade")).toBe("controlled-mainnet-microtrade-only");
    expect(grantedScopeFor("template-only")).toBe("none");
    expect(grantedScopeFor("not-signed")).toBe("none");
  });
});

describe("phase7 human sign-off — input safety + validator parity wall", () => {
  it("refuses an unknown acknowledgement id and a secret-shaped label", () => {
    expect(() => buildPhase7HumanSignoff({ acknowledgedIds: ["not-a-real-ack"] })).toThrow(/unknown acknowledgement/);
    expect(() => buildPhase7HumanSignoff({ operatorLabel: `Bearer ${"a".repeat(40)}` })).toThrow(/secret-shaped/);
  });

  it("rejects an unknown field (closed schema)", () => {
    const v = buildPhase7HumanSignoff() as unknown as Record<string, unknown>;
    v["extra"] = "x";
    expect(() => validatePhase7HumanSignoff(v)).toThrow(/CLOSED/);
  });

  it("refuses a tampered status that outruns the acknowledgements", () => {
    const v = buildPhase7HumanSignoff() as unknown as Record<string, unknown>;
    v["signoffStatus"] = "signed-for-controlled-microtrade";
    v["grantedScope"] = "controlled-mainnet-microtrade-only";
    expect(() => validatePhase7HumanSignoff(v)).toThrow(/re-derived/);
  });

  it("refuses a record that grants a scope its status does not support", () => {
    const v = buildPhase7HumanSignoff({
      targetScope: "design-review-only",
      acknowledgedIds: DESIGN_ACK_IDS,
      operatorLabel: "a",
      signedAtLabel: "x",
    }) as unknown as Record<string, unknown>;
    // status signed-for-s104-design but scope tampered upward
    v["grantedScope"] = "controlled-mainnet-microtrade-only";
    expect(() => validatePhase7HumanSignoff(v)).toThrow(/grantedScope/);
  });

  it("refuses each flipped safety lock", () => {
    for (const [field, bad] of [
      ["manualConfirmationRequired", false],
      ["burnerWalletRequired", false],
      ["oneTradeOnly", false],
      ["noAutonomousTrading", false],
      ["killSwitchRequired", false],
      ["reconciliationRequired", false],
      ["authorizesLiveExecution", true],
      ["requiresSeparateExecutionSprint", false],
      ["neverSends", false],
      ["phase7LiveTradingReady", true],
    ] as const) {
      const v = buildPhase7HumanSignoff() as unknown as Record<string, unknown>;
      v[field] = bad;
      expect(() => validatePhase7HumanSignoff(v), field).toThrow(Phase7HumanSignoffError);
    }
  });

  it("refuses a retained max-spend on a record that is not signed-for-controlled-microtrade", () => {
    const v = buildPhase7HumanSignoff() as unknown as Record<string, unknown>;
    v["maxSpendLamports"] = 1_000_000;
    v["maxSpendSol"] = 0.001;
    expect(() => validatePhase7HumanSignoff(v)).toThrow(Phase7HumanSignoffError);
  });
});
