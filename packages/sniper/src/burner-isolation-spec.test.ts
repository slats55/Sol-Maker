/**
 * Tests for the Sprint 55 SNIPER BURNER ISOLATION SPEC (`sniper.burner.isolation.spec.v1`). The
 * artifact is NOT a wallet — it creates no wallet, imports no wallet, and holds no key; these tests
 * prove the core principles cannot be weakened and that loss bounds stay labels (never amounts).
 */

import { describe, it, expect } from "vitest";
import {
  buildSniperBurnerIsolationSpec,
  validateSniperBurnerIsolationSpec,
  formatSniperBurnerIsolationSpec,
  SniperBurnerIsolationSpecError,
  SNIPER_BURNER_ISOLATION_SPEC_SCHEMA_VERSION,
  SNIPER_BURNER_ISOLATION_SPEC_BANNER,
  BURNER_ISOLATION_CORE_PRINCIPLES,
} from "./burner-isolation-spec.js";

describe("buildSniperBurnerIsolationSpec", () => {
  it("builds a conservative draft spec with the seven core principles permanently true", () => {
    const spec = buildSniperBurnerIsolationSpec({ operatorLabel: "op" });
    expect(spec.schemaVersion).toBe(SNIPER_BURNER_ISOLATION_SPEC_SCHEMA_VERSION);
    expect(spec.banner).toBe(SNIPER_BURNER_ISOLATION_SPEC_BANNER);
    for (const principle of BURNER_ISOLATION_CORE_PRINCIPLES) {
      expect(spec[principle], principle).toBe(true);
    }
    expect(spec.readinessStatus).toBe("draft");
    expect(spec.adopted).toBe(false);
    expect(spec.futureCapRequirements.length).toBeGreaterThan(0);
    expect(spec.operatorApprovalRequirements.length).toBeGreaterThan(0);
    expect(spec.warnings.some((w) => /kill-switch/.test(w))).toBe(true);
    expect(spec.warnings.some((w) => /maxLossLabel/.test(w))).toBe(true);
    expect(() => validateSniperBurnerIsolationSpec(spec)).not.toThrow();
  });

  it("accepts a label loss bound + kill-switch ref, merges additions, honors adopted; deterministic", () => {
    const input = {
      operatorLabel: "op",
      maxLossLabel: "tiny-test-budget",
      killSwitchSpecRef: "ks-main",
      futureCapRequirements: ["a burner session must be time-boxed"],
      readinessStatus: "adopted" as const,
    };
    const spec = buildSniperBurnerIsolationSpec(input);
    expect(spec.maxLossLabel).toBe("tiny-test-budget");
    expect(spec.killSwitchSpecRef).toBe("ks-main");
    expect(spec.adopted).toBe(true);
    expect(spec.futureCapRequirements).toContain("a burner session must be time-boxed");
    expect(spec.warnings.some((w) => /kill-switch|maxLossLabel/.test(w))).toBe(false);
    expect(JSON.stringify(buildSniperBurnerIsolationSpec(input))).toBe(JSON.stringify(spec));
  });

  it("REFUSES a loss bound that looks like an amount (digits / currency markers)", () => {
    for (const bad of ["0.1 SOL", "100", "5usd", "$50", "max-2-sol", "1000-lamports"]) {
      expect(() => buildSniperBurnerIsolationSpec({ maxLossLabel: bad }), bad).toThrow(/pure LABEL/);
    }
    expect(() => buildSniperBurnerIsolationSpec({ maxLossLabel: "tiny-test-budget" })).not.toThrow();
  });

  it("refuses an unknown readiness status and a non-object input", () => {
    expect(() => buildSniperBurnerIsolationSpec({ readinessStatus: "live" as never })).toThrow(SniperBurnerIsolationSpecError);
    expect(() => buildSniperBurnerIsolationSpec(42 as never)).toThrow(/must be an object/);
  });
});

describe("the core principles can NEVER be weakened", () => {
  it("the validator refuses any principle flipped to false", () => {
    const spec = buildSniperBurnerIsolationSpec({});
    for (const principle of BURNER_ISOLATION_CORE_PRINCIPLES) {
      const tampered = JSON.parse(JSON.stringify(spec));
      tampered[principle] = false;
      expect(() => validateSniperBurnerIsolationSpec(tampered), principle).toThrow(/weakened isolation spec is REFUSED/);
    }
  });

  it("the validator refuses an amount-shaped maxLossLabel smuggled into a stored artifact", () => {
    const spec = buildSniperBurnerIsolationSpec({ maxLossLabel: "tiny-test-budget" });
    const tampered = JSON.parse(JSON.stringify(spec));
    tampered.maxLossLabel = "2.5 SOL";
    expect(() => validateSniperBurnerIsolationSpec(tampered)).toThrow(/pure LABEL/);
  });

  it("the validator refuses empty requirement lists and a broken adopted mirror", () => {
    const spec = buildSniperBurnerIsolationSpec({});
    const a = JSON.parse(JSON.stringify(spec));
    a.futureCapRequirements = [];
    expect(() => validateSniperBurnerIsolationSpec(a)).toThrow(/futureCapRequirements/);

    const b = JSON.parse(JSON.stringify(spec));
    b.operatorApprovalRequirements = [];
    expect(() => validateSniperBurnerIsolationSpec(b)).toThrow(/operatorApprovalRequirements/);

    const c = JSON.parse(JSON.stringify(spec));
    c.adopted = true;
    expect(() => validateSniperBurnerIsolationSpec(c)).toThrow(/mirror readinessStatus/);
  });

  it("rejects wrong schema/banner", () => {
    const spec = buildSniperBurnerIsolationSpec({});
    const a = JSON.parse(JSON.stringify(spec));
    a.schemaVersion = "nope";
    expect(() => validateSniperBurnerIsolationSpec(a)).toThrow(/schemaVersion/);
  });
});

describe("formatSniperBurnerIsolationSpec — deterministic operator output", () => {
  it("shows the NOT-A-WALLET banner, the principles, the pairing, and the disclaimers", () => {
    const spec = buildSniperBurnerIsolationSpec({
      operatorLabel: "op",
      maxLossLabel: "tiny-test-budget",
      killSwitchSpecRef: "ks-main",
      readinessStatus: "adopted",
    });
    const text = formatSniperBurnerIsolationSpec(spec, { label: "t" });
    expect(text).toContain("NOT A WALLET, CREATES NO WALLET");
    expect(text).toContain("kill-switch ref: ks-main");
    expect(text).toContain("loss bound LABEL: tiny-test-budget (a label, never an amount)");
    expect(text).toContain("- main wallet permanently excluded");
    expect(text).toContain("- simulation required before any FUTURE send");
    expect(text).toContain("adopted — prerequisite signal, NOT authorization");
    expect(formatSniperBurnerIsolationSpec(spec, { label: "t" })).toBe(text);
  });
});
