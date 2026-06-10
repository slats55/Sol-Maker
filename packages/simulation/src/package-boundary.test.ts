/**
 * Package-boundary regression for `@soulmaker/simulation` (Sprint 61).
 *
 * Locks the boundary DECLARATIONS (the manifest and the exported safety surface) the way
 * `no-forbidden-imports.test.ts` locks the source: the dependency allowlist is exactly
 * `@soulmaker/sniper` + `@soulmaker/security`, the safety literals are frozen and exactly the four
 * documented locks, and {@link assertSimulationSafetyLiterals} refuses every flipped/missing lock.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SIMULATION_PACKAGE_CAPABILITY_STATEMENT,
  SIMULATION_PACKAGE_DISCLAIMERS,
  SIMULATION_SAFETY_LITERALS,
  SIMULATION_SAFETY_LITERAL_KEYS,
  SimulationSafetyError,
  assertSimulationSafetyLiterals,
} from "./index.js";

const PKG_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

describe("@soulmaker/simulation — package manifest boundary", () => {
  const manifest = JSON.parse(readFileSync(join(PKG_DIR, "package.json"), "utf8")) as {
    name: string;
    private: boolean;
    type: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };

  it("is the private, ESM @soulmaker/simulation package", () => {
    expect(manifest.name).toBe("@soulmaker/simulation");
    expect(manifest.private).toBe(true);
    expect(manifest.type).toBe("module");
  });

  it("depends ONLY on @soulmaker/sniper and @soulmaker/security (workspace allowlist)", () => {
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      "@soulmaker/security",
      "@soulmaker/sniper",
    ]);
    for (const version of Object.values(manifest.dependencies ?? {})) {
      expect(version).toBe("workspace:*");
    }
  });

  it("declares no dev/peer/optional dependencies of its own (the root toolchain is enough)", () => {
    expect(manifest.devDependencies).toBeUndefined();
    expect(manifest.peerDependencies).toBeUndefined();
    expect(manifest.optionalDependencies).toBeUndefined();
  });
});

describe("@soulmaker/simulation — exported safety surface", () => {
  it("exports exactly the four documented literal locks, all true and frozen", () => {
    expect(SIMULATION_SAFETY_LITERAL_KEYS).toEqual([
      "neverAuthorizesLiveTrading",
      "neverSigns",
      "neverSends",
      "dryRunOnly",
    ]);
    expect(SIMULATION_SAFETY_LITERALS).toEqual({
      neverAuthorizesLiveTrading: true,
      neverSigns: true,
      neverSends: true,
      dryRunOnly: true,
    });
    expect(Object.isFrozen(SIMULATION_SAFETY_LITERALS)).toBe(true);
  });

  it("carries the capability statement and the never-live disclaimers", () => {
    expect(SIMULATION_PACKAGE_CAPABILITY_STATEMENT).toContain("never authorize live trading");
    expect(SIMULATION_PACKAGE_CAPABILITY_STATEMENT).toContain("never signs");
    expect(SIMULATION_PACKAGE_CAPABILITY_STATEMENT).toContain("never sends");
    expect(SIMULATION_PACKAGE_DISCLAIMERS.length).toBeGreaterThanOrEqual(5);
    expect(SIMULATION_PACKAGE_DISCLAIMERS.some((d) => d.includes("NEVER authorize live trading"))).toBe(true);
    expect(SIMULATION_PACKAGE_DISCLAIMERS.some((d) => d.includes("Phase 7"))).toBe(true);
    expect(SIMULATION_PACKAGE_DISCLAIMERS).toContain("Not financial advice.");
    expect(SIMULATION_PACKAGE_DISCLAIMERS).toContain("Not a profitability claim.");
  });

  it("assertSimulationSafetyLiterals accepts an artifact carrying every lock", () => {
    expect(() =>
      assertSimulationSafetyLiterals({ ...SIMULATION_SAFETY_LITERALS, anything: "else" }, "artifact"),
    ).not.toThrow();
  });

  it.each(SIMULATION_SAFETY_LITERAL_KEYS.map((k) => [k] as const))(
    "refuses an artifact whose %s lock is flipped to false",
    (key) => {
      const artifact = { ...SIMULATION_SAFETY_LITERALS, [key]: false };
      expect(() => assertSimulationSafetyLiterals(artifact, "artifact")).toThrow(SimulationSafetyError);
      expect(() => assertSimulationSafetyLiterals(artifact, "artifact")).toThrow(key);
    },
  );

  it.each(SIMULATION_SAFETY_LITERAL_KEYS.map((k) => [k] as const))(
    "refuses an artifact whose %s lock is missing entirely",
    (key) => {
      const artifact: Record<string, unknown> = { ...SIMULATION_SAFETY_LITERALS };
      delete artifact[key];
      expect(() => assertSimulationSafetyLiterals(artifact, "artifact")).toThrow(SimulationSafetyError);
    },
  );

  it("refuses a truthy-but-not-literal-true lock (e.g. the string \"true\")", () => {
    const artifact = { ...SIMULATION_SAFETY_LITERALS, neverSigns: "true" };
    expect(() => assertSimulationSafetyLiterals(artifact, "artifact")).toThrow(SimulationSafetyError);
  });

  it("refuses a non-object artifact", () => {
    expect(() => assertSimulationSafetyLiterals(null, "artifact")).toThrow(SimulationSafetyError);
    expect(() => assertSimulationSafetyLiterals([], "artifact")).toThrow(SimulationSafetyError);
    expect(() => assertSimulationSafetyLiterals("artifact", "artifact")).toThrow(SimulationSafetyError);
  });

  it("SimulationSafetyError is a named Error", () => {
    const err = new SimulationSafetyError("boundary violated");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SimulationSafetyError");
    expect(err.message).toBe("boundary violated");
  });
});
