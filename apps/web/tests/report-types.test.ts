import { describe, expect, it } from "vitest";

import {
  KNOWN_REPORT_SCHEMAS,
  envelopeSchema,
  isKnownSchema,
  knownSchema,
} from "../src/lib/report-types.js";

const REQUIRED_SCHEMA_IDS = [
  "backtest.report.v1",
  "backtest.suite.v1",
  "backtest.suite.diff.v1",
  "backtest.sensitivity.v1",
  "backtest.sensitivity.diff.v1",
  "backtest.coverage.v1",
  "backtest.variant-plan.explain.v1",
  "backtest.sensitivity.matrix.v1",
  "backtest.sensitivity.matrix.diff.v1",
  "backtest.research.bundle.diff.v1",
  "backtest.research.campaign.diff.v1",
];

describe("report schema registry", () => {
  it("knows every documented schema id", () => {
    for (const id of REQUIRED_SCHEMA_IDS) {
      expect(isKnownSchema(id)).toBe(true);
    }
  });

  it("returns undefined for an unknown schema", () => {
    expect(knownSchema("totally.unknown.v9")).toBeUndefined();
    expect(isKnownSchema("totally.unknown.v9")).toBe(false);
  });

  it("marks shipped schemas as stable with a real CLI command", () => {
    const report = knownSchema("backtest.report.v1");
    expect(report?.stability).toBe("stable");
    expect(report?.cli).toBe("paper:backtest");
  });

  // Matrix + research families shipped on master; relabel them stable with the
  // real CLI command registered in apps/cli. Verified against origin/master.
  const SHIPPED_STABLE: ReadonlyArray<readonly [string, string]> = [
    ["backtest.sensitivity.matrix.v1", "paper:backtest:sensitivity:matrix"],
    ["backtest.sensitivity.matrix.diff.v1", "paper:backtest:diff:sensitivity:matrix"],
    ["backtest.research.manifest.v1", "paper:backtest:research:manifest"],
    ["backtest.research.verify.v1", "paper:backtest:research:verify"],
    ["backtest.research.manifest.diff.v1", "paper:backtest:diff:research:manifest"],
    ["backtest.research.bundle.v1", "paper:backtest:research:bundle"],
    ["backtest.research.status.v1", "paper:backtest:research:status"],
    ["backtest.research.campaign.index.v1", "paper:backtest:research:index"],
    // Sprint 19 research diffs — merged to origin/master (verified at 53a7f83).
    ["backtest.research.bundle.diff.v1", "paper:backtest:diff:research:bundle"],
    ["backtest.research.campaign.diff.v1", "paper:backtest:diff:research:index"],
  ];

  for (const [id, cli] of SHIPPED_STABLE) {
    it(`marks ${id} stable with CLI ${cli}`, () => {
      const info = knownSchema(id);
      expect(info?.stability).toBe("stable");
      expect(info?.cli).toBe(cli);
      // No relabeled schema should keep a "pending"/"emerging" CLI placeholder.
      expect(info?.cli).not.toContain("pending");
    });
  }

  it("no catalogued schema is labelled emerging (all shipped to master)", () => {
    const emerging = KNOWN_REPORT_SCHEMAS.filter((s) => s.stability === "emerging");
    expect(emerging.map((s) => s.id)).toEqual([]);
  });

  it("every schema advertises a non-empty, non-placeholder CLI", () => {
    for (const schema of KNOWN_REPORT_SCHEMAS) {
      expect(schema.cli.length).toBeGreaterThan(0);
      expect(schema.cli).not.toContain("pending");
    }
  });

  it("has no duplicate ids", () => {
    const ids = KNOWN_REPORT_SCHEMAS.map((schema) => schema.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("envelopeSchema", () => {
  it("reads a string schemaVersion", () => {
    expect(envelopeSchema({ schemaVersion: "backtest.report.v1" })).toBe(
      "backtest.report.v1",
    );
  });

  it("returns undefined when absent or non-string", () => {
    expect(envelopeSchema({})).toBeUndefined();
    expect(envelopeSchema({ schemaVersion: 1 as unknown as string })).toBeUndefined();
  });
});
