/**
 * Vocabulary regression for the simulation reason codes (Sprint 62): the union is closed, unique,
 * fully defined, consistently classified, and named within the `simulation-` namespace. The
 * definitions table can never drift from the code list.
 */

import { describe, it, expect } from "vitest";
import {
  SIMULATION_REASON_CATEGORIES,
  SIMULATION_REASON_CODES,
  SIMULATION_REASON_CODE_DEFINITIONS,
  SIMULATION_REASON_SEVERITIES,
  dedupeSimulationReasonCodes,
  isBlockingSimulationReasonCode,
  isSimulationReasonCode,
  simulationReasonCodeDefinition,
} from "./index.js";

describe("simulation reason codes — vocabulary integrity", () => {
  it("has no duplicate codes", () => {
    expect(new Set(SIMULATION_REASON_CODES).size).toBe(SIMULATION_REASON_CODES.length);
  });

  it("has no duplicate categories and keeps them sorted (stable docs order)", () => {
    expect(new Set(SIMULATION_REASON_CATEGORIES).size).toBe(SIMULATION_REASON_CATEGORIES.length);
    expect([...SIMULATION_REASON_CATEGORIES]).toEqual([...SIMULATION_REASON_CATEGORIES].sort());
  });

  it("defines every code exactly once, with the definition keyed by its own code", () => {
    expect(Object.keys(SIMULATION_REASON_CODE_DEFINITIONS).sort()).toEqual([...SIMULATION_REASON_CODES].sort());
    for (const code of SIMULATION_REASON_CODES) {
      expect(SIMULATION_REASON_CODE_DEFINITIONS[code].code).toBe(code);
    }
  });

  it("namespaces every code under simulation- (pipeline) or audit- (chain-audit findings), kebab-case", () => {
    for (const code of SIMULATION_REASON_CODES) {
      expect(code).toMatch(/^(simulation|audit)-[a-z0-9-]+$/);
    }
    // The audit- prefix is reserved for the audit category and vice versa.
    for (const code of SIMULATION_REASON_CODES) {
      const isAuditCode = code.startsWith("audit-");
      expect(SIMULATION_REASON_CODE_DEFINITIONS[code].category === "audit").toBe(isAuditCode);
    }
  });

  it("gives every definition a known category, a known severity, and a non-empty operator message", () => {
    for (const code of SIMULATION_REASON_CODES) {
      const d = SIMULATION_REASON_CODE_DEFINITIONS[code];
      expect(SIMULATION_REASON_CATEGORIES).toContain(d.category);
      expect(SIMULATION_REASON_SEVERITIES).toContain(d.severity);
      expect(d.operatorMessage.length).toBeGreaterThan(20);
    }
  });

  it("keeps blocking/warning flags consistent with severity (single source of truth)", () => {
    for (const code of SIMULATION_REASON_CODES) {
      const d = SIMULATION_REASON_CODE_DEFINITIONS[code];
      expect(d.blocking).toBe(d.severity === "blocking");
      expect(d.warning).toBe(d.severity === "warning");
      expect(d.blocking && d.warning).toBe(false);
    }
  });

  it("classifies every blocked-* code as blocking and every preview/unavailable code as warning", () => {
    for (const code of SIMULATION_REASON_CODES) {
      const d = SIMULATION_REASON_CODE_DEFINITIONS[code];
      if (code.startsWith("simulation-blocked-")) {
        expect(d.blocking, `${code} must be blocking`).toBe(true);
      }
      if (code.startsWith("simulation-preview-unresolved-")) {
        expect(d.severity, `${code} must be a warning`).toBe("warning");
      }
    }
    expect(SIMULATION_REASON_CODE_DEFINITIONS["simulation-dry-run-unavailable-safe-boundary"].severity).toBe("warning");
    expect(SIMULATION_REASON_CODE_DEFINITIONS["simulation-dry-run-skipped-blocked-plan"].severity).toBe("blocking");
    expect(SIMULATION_REASON_CODE_DEFINITIONS["simulation-plan-ready"].severity).toBe("info");
    expect(SIMULATION_REASON_CODE_DEFINITIONS["simulation-result-validated"].severity).toBe("info");
  });

  it("never lets an operator message claim execution, profit, or live readiness", () => {
    for (const code of SIMULATION_REASON_CODES) {
      const msg = SIMULATION_REASON_CODE_DEFINITIONS[code].operatorMessage.toLowerCase();
      expect(msg).not.toContain("profit");
      expect(msg).not.toContain("ready for live");
      expect(msg).not.toContain("executed on-chain");
      expect(msg).not.toContain("trade placed");
    }
  });
});

describe("simulation reason codes — lookups", () => {
  it("isSimulationReasonCode accepts every code and refuses strangers", () => {
    for (const code of SIMULATION_REASON_CODES) expect(isSimulationReasonCode(code)).toBe(true);
    expect(isSimulationReasonCode("simulation-blocked-made-up")).toBe(false);
    expect(isSimulationReasonCode("paper-enter-candidate")).toBe(false);
    expect(isSimulationReasonCode(42)).toBe(false);
    expect(isSimulationReasonCode(null)).toBe(false);
  });

  it("simulationReasonCodeDefinition returns the table entry", () => {
    const d = simulationReasonCodeDefinition("simulation-blocked-kill-switch-stop");
    expect(d.category).toBe("kill-switch");
    expect(d.blocking).toBe(true);
  });

  it("isBlockingSimulationReasonCode mirrors the definitions", () => {
    expect(isBlockingSimulationReasonCode("simulation-blocked-gates-not-ready")).toBe(true);
    expect(isBlockingSimulationReasonCode("simulation-preview-unresolved-amount")).toBe(false);
    expect(isBlockingSimulationReasonCode("simulation-result-validated")).toBe(false);
  });

  it("dedupeSimulationReasonCodes preserves first occurrence", () => {
    expect(
      dedupeSimulationReasonCodes([
        "simulation-blocked-gates-not-ready",
        "simulation-preview-unresolved-amount",
        "simulation-blocked-gates-not-ready",
      ]),
    ).toEqual(["simulation-blocked-gates-not-ready", "simulation-preview-unresolved-amount"]);
  });
});
