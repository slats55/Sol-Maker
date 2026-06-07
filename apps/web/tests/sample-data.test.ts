import { describe, expect, it } from "vitest";

import { COMMANDS } from "../src/lib/command-reference.js";
import { KNOWN_REPORT_SCHEMAS } from "../src/lib/report-types.js";
import { MODES } from "../src/lib/safety.js";
import {
  SAMPLE_ARTIFACTS,
  SAMPLE_BACKTEST_REPORT,
  SAMPLE_METRICS,
  SAMPLE_SOURCE,
  SAMPLE_STATUS_CARDS,
} from "../src/lib/sample-data.js";

describe("sample data labelling", () => {
  it("tags every status card as a non-live local fixture", () => {
    for (const card of SAMPLE_STATUS_CARDS) {
      expect(card.tag.isLive).toBe(false);
      expect(card.tag.source).toBe(SAMPLE_SOURCE);
    }
  });

  it("tags every metric and artifact as a non-live local fixture", () => {
    for (const metric of SAMPLE_METRICS) {
      expect(metric.tag.isLive).toBe(false);
      expect(metric.tag.source).toBe(SAMPLE_SOURCE);
    }
    for (const artifact of SAMPLE_ARTIFACTS) {
      expect(artifact.tag.isLive).toBe(false);
      expect(artifact.tag.source).toBe(SAMPLE_SOURCE);
    }
  });

  it("tags the sample report as a non-live fixture", () => {
    expect(SAMPLE_BACKTEST_REPORT.tag.isLive).toBe(false);
    expect(SAMPLE_BACKTEST_REPORT.tag.source).toBe(SAMPLE_SOURCE);
  });
});

describe("sample status cards stay honest", () => {
  it("reflect the true posture, never a fake connected/running/profit state", () => {
    const byLabel = new Map(SAMPLE_STATUS_CARDS.map((card) => [card.label, card.value]));
    expect(byLabel.get("Mode")).toBe("PAPER");
    expect(byLabel.get("Wallet")).toBe("None connected");
    expect(byLabel.get("Network")).toBe("Offline");
    expect(byLabel.get("Engine")).toBe("Not running");

    const values = SAMPLE_STATUS_CARDS.map((card) => card.value.toLowerCase());
    expect(values).not.toContain("connected");
    expect(values).not.toContain("running");
  });

  it("the only PnL figure is explicitly marked simulated and not real", () => {
    const pnl = SAMPLE_BACKTEST_REPORT.metrics.find((metric) =>
      metric.label.toLowerCase().includes("pnl"),
    );
    expect(pnl).toBeDefined();
    expect(pnl?.value.toLowerCase()).toContain("simulated");
    expect(pnl?.value.toLowerCase()).toContain("not real");
  });
});

describe("sample metric counts stay synced with their source arrays", () => {
  const valueFor = (label: string): string | undefined =>
    SAMPLE_METRICS.find((metric) => metric.label === label)?.value;

  it("matches schema, mode, and command counts", () => {
    expect(valueFor("Report schemas supported")).toBe(String(KNOWN_REPORT_SCHEMAS.length));
    expect(valueFor("Modes described")).toBe(String(MODES.length));
    expect(valueFor("CLI workflows")).toBe(String(COMMANDS.length));
  });
});
