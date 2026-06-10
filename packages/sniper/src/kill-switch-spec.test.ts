/**
 * Tests for the Sprint 53 SNIPER KILL-SWITCH SPEC (`sniper.kill_switch.spec.v1`). The artifact is a
 * LOCAL design/checklist — NOT a kill switch: it controls nothing, and these tests prove the live
 * placeholder can never be anything but disabled.
 */

import { describe, it, expect } from "vitest";
import {
  buildSniperKillSwitchSpec,
  validateSniperKillSwitchSpec,
  formatSniperKillSwitchSpec,
  SniperKillSwitchSpecError,
  SNIPER_KILL_SWITCH_SPEC_SCHEMA_VERSION,
  SNIPER_KILL_SWITCH_SPEC_BANNER,
  SNIPER_KILL_SWITCH_MODES,
} from "./kill-switch-spec.js";

describe("buildSniperKillSwitchSpec", () => {
  it("builds a conservative draft spec with the canonical baselines and the three fixed modes", () => {
    const spec = buildSniperKillSwitchSpec({ operatorLabel: "op" });
    expect(spec.schemaVersion).toBe(SNIPER_KILL_SWITCH_SPEC_SCHEMA_VERSION);
    expect(spec.banner).toBe(SNIPER_KILL_SWITCH_SPEC_BANNER);
    expect(spec.readinessStatus).toBe("draft");
    expect(spec.adopted).toBe(false);
    expect(spec.modes.map((m) => m.mode)).toEqual([...SNIPER_KILL_SWITCH_MODES]);
    expect(spec.modes[2]!.status).toBe("placeholder-disabled");
    expect(spec.requiredOperatorConfirmations.length).toBeGreaterThan(0);
    expect(spec.disabledActions.length).toBeGreaterThan(0);
    expect(spec.specOnly).toBe(true);
    expect(spec.performsNoProcessControl).toBe(true);
    expect(spec.warnings.some((w) => /needs an ADOPTED spec/.test(w))).toBe(true);
    expect(() => validateSniperKillSwitchSpec(spec)).not.toThrow();
  });

  it("merges operator additions with the baselines (deduped, sorted) and honors adopted", () => {
    const spec = buildSniperKillSwitchSpec({
      operatorLabel: "op",
      requiredOperatorConfirmations: ["a second human confirms"],
      disabledActions: ["building any new paper decision report"], // duplicate of a baseline entry
      escalationNotes: ["alert the operator channel"],
      readinessStatus: "adopted",
    });
    expect(spec.adopted).toBe(true);
    expect(spec.requiredOperatorConfirmations).toContain("a second human confirms");
    expect(new Set(spec.disabledActions).size).toBe(spec.disabledActions.length);
    expect(spec.escalationNotes).toEqual(["alert the operator channel"]);
    expect(spec.warnings.some((w) => /ADOPTED/.test(w))).toBe(false);
  });

  it("REFUSES an explicitly-empty confirmations list and an unknown readiness status", () => {
    expect(() => buildSniperKillSwitchSpec({ requiredOperatorConfirmations: [] })).toThrow(/unsafe — refused/);
    expect(() => buildSniperKillSwitchSpec({ requiredOperatorConfirmations: ["  "] })).toThrow(/unsafe — refused/);
    expect(() => buildSniperKillSwitchSpec({ readinessStatus: "armed" as never })).toThrow(SniperKillSwitchSpecError);
  });

  it("is deterministic", () => {
    const a = buildSniperKillSwitchSpec({ operatorLabel: "op" });
    const b = buildSniperKillSwitchSpec({ operatorLabel: "op" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("the live placeholder can NEVER be enabled", () => {
  it("the validator refuses a live mode whose status was tampered to specified", () => {
    const spec = buildSniperKillSwitchSpec({});
    const tampered = JSON.parse(JSON.stringify(spec));
    tampered.modes[2].status = "specified";
    expect(() => validateSniperKillSwitchSpec(tampered)).toThrow(/PERMANENTLY disabled/);
  });

  it("the validator refuses a missing or reordered mode set and an extra (live) mode", () => {
    const spec = buildSniperKillSwitchSpec({});
    const missing = JSON.parse(JSON.stringify(spec));
    missing.modes.pop();
    expect(() => validateSniperKillSwitchSpec(missing)).toThrow(/exactly the 3 fixed modes/);

    const reordered = JSON.parse(JSON.stringify(spec));
    reordered.modes.reverse();
    expect(() => validateSniperKillSwitchSpec(reordered)).toThrow(/fixed order/);

    const extra = JSON.parse(JSON.stringify(spec));
    extra.modes.push({ mode: "start-live", description: "x", scope: "phase7-live-disabled", status: "specified" });
    expect(() => validateSniperKillSwitchSpec(extra)).toThrow(/exactly the 3 fixed modes/);
  });
});

describe("validateSniperKillSwitchSpec — strict backstop", () => {
  it("rejects wrong schema/banner, empty requirement lists, and a broken adopted mirror", () => {
    const spec = buildSniperKillSwitchSpec({});
    const a = JSON.parse(JSON.stringify(spec));
    a.schemaVersion = "nope";
    expect(() => validateSniperKillSwitchSpec(a)).toThrow(/schemaVersion/);

    const b = JSON.parse(JSON.stringify(spec));
    b.requiredOperatorConfirmations = [];
    expect(() => validateSniperKillSwitchSpec(b)).toThrow(/unconfirmable/);

    const c = JSON.parse(JSON.stringify(spec));
    c.testRequirements = [];
    expect(() => validateSniperKillSwitchSpec(c)).toThrow(/testRequirements/);

    const d = JSON.parse(JSON.stringify(spec));
    d.adopted = true; // but readinessStatus stays draft
    expect(() => validateSniperKillSwitchSpec(d)).toThrow(/mirror readinessStatus/);

    const e = JSON.parse(JSON.stringify(spec));
    e.performsNoProcessControl = false;
    expect(() => validateSniperKillSwitchSpec(e)).toThrow(/performsNoProcessControl/);
  });
});

describe("formatSniperKillSwitchSpec — deterministic operator output", () => {
  it("shows the NOT-A-LIVE-CONTROL banner, the modes, and the disclaimers", () => {
    const spec = buildSniperKillSwitchSpec({ operatorLabel: "op", readinessStatus: "adopted" });
    const text = formatSniperKillSwitchSpec(spec, { label: "t" });
    expect(text).toContain("NOT A LIVE CONTROL");
    expect(text).toContain("- stop-live-disabled-placeholder [placeholder-disabled]");
    expect(text).toContain("adopted — Phase-6 prerequisite signal, NOT authorization");
    expect(text).toContain("Actions a tripped switch must forbid:");
    expect(formatSniperKillSwitchSpec(spec, { label: "t" })).toBe(text);
  });
});
