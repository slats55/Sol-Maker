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

  it("marks the in-progress matrix schemas as emerging", () => {
    expect(knownSchema("backtest.sensitivity.matrix.v1")?.stability).toBe("emerging");
    expect(knownSchema("backtest.sensitivity.matrix.diff.v1")?.stability).toBe("emerging");
  });

  it("knows the emerging research bundle/status/campaign schemas", () => {
    expect(knownSchema("backtest.research.bundle.v1")?.stability).toBe("emerging");
    expect(knownSchema("backtest.research.status.v1")?.stability).toBe("emerging");
    expect(knownSchema("backtest.research.campaign.index.v1")?.stability).toBe("emerging");
    expect(knownSchema("backtest.research.bundle.v1")?.family).toBe("research");
    expect(knownSchema("backtest.research.status.v1")?.family).toBe("research");
    expect(knownSchema("backtest.research.campaign.index.v1")?.family).toBe("research");
  });

  it("marks shipped schemas as stable with a real CLI command", () => {
    const report = knownSchema("backtest.report.v1");
    expect(report?.stability).toBe("stable");
    expect(report?.cli).toBe("paper:backtest");
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
