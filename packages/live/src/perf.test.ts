import { describe, expect, it } from "vitest";

import { buildLiveLatencyReport, summarizeStage } from "./perf.js";

describe("summarizeStage", () => {
  it("computes min / median / p95 / max from samples", () => {
    const s = summarizeStage({ stage: "policy-eval", engine: "typescript", samplesMs: [1, 2, 3, 4, 100] });
    expect(s.availability).toBe("measured");
    expect(s.count).toBe(5);
    expect(s.minMs).toBe(1);
    expect(s.medianMs).toBe(3);
    expect(s.maxMs).toBe(100);
    expect(s.p95Ms).toBe(100);
  });

  it("reports an honest unavailable summary when there are no samples", () => {
    const s = summarizeStage({ stage: "rust-sniper-score", engine: "rust", samplesMs: [], note: "engine binary absent" });
    expect(s.availability).toBe("unavailable");
    expect(s.count).toBe(0);
    expect(s.minMs).toBeNull();
    expect(s.medianMs).toBeNull();
    expect(s.note).toBe("engine binary absent");
  });

  it("drops negative / non-finite samples", () => {
    const s = summarizeStage({ stage: "x", engine: "typescript", samplesMs: [5, -1, NaN, 3] });
    expect(s.count).toBe(2);
    expect(s.minMs).toBe(3);
  });
});

describe("buildLiveLatencyReport", () => {
  it("assembles a report with pinned honesty literals", () => {
    const report = buildLiveLatencyReport({
      generatedAt: "2026-06-18T00:00:00Z",
      iterations: 100,
      stages: [
        { stage: "policy-eval", engine: "typescript", samplesMs: [0.1, 0.2, 0.15] },
        { stage: "rust-status-spawn", engine: "rust", samplesMs: [] },
      ],
    });
    expect(report.schemaVersion).toBe("perf.live.latency.report.v1");
    expect(report.stages).toHaveLength(2);
    expect(report.stages[1]?.availability).toBe("unavailable");
    expect(report.measuredOnThisMachine).toBe(true);
    expect(report.notProfitabilityClaim).toBe(true);
  });
});
