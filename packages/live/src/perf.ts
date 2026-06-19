/**
 * The LIVE LATENCY REPORT (`perf.live.latency.report.v1`, Sprint 107, Part 1).
 *
 * A pure summarizer for measured stage latencies of the live pipeline (candidate scoring, policy
 * evaluation, canary assembly, and the Rust engine hot path). The TIMINGS are collected by the
 * benchmark script (scripts/bench-live-latency.ts) from real `performance.now()` deltas on this
 * machine; this module only summarizes them. It never claims a latency it did not measure: a stage
 * with no samples is reported as `unavailable` with null statistics.
 *
 * It is explicitly NOT a throughput or profitability claim — it measures local compute latency to
 * find bottlenecks, nothing more.
 */

export const LIVE_LATENCY_REPORT_SCHEMA_VERSION = "perf.live.latency.report.v1";

export const LATENCY_ENGINES = ["rust", "typescript", "none"] as const;
export type LatencyEngine = (typeof LATENCY_ENGINES)[number];

export interface LatencyStageSamples {
  stage: string;
  engine: LatencyEngine;
  /** Raw per-iteration millisecond timings; empty when the stage could not be measured. */
  samplesMs: number[];
  /** Optional note (e.g. why a Rust stage was unavailable). */
  note?: string;
}

export interface LatencyStageSummary {
  stage: string;
  engine: LatencyEngine;
  availability: "measured" | "unavailable";
  count: number;
  minMs: number | null;
  medianMs: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  note: string | null;
}

export interface LiveLatencyReport {
  schemaVersion: typeof LIVE_LATENCY_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  iterations: number;
  stages: LatencyStageSummary[];
  /** Pinned honesty literals. */
  measuredOnThisMachine: true;
  notThroughputClaim: true;
  notProfitabilityClaim: true;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] as number;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx] as number;
}

/** Summarize one stage's samples. Empty samples → an honest `unavailable` summary with null stats. */
export function summarizeStage(input: LatencyStageSamples): LatencyStageSummary {
  const valid = input.samplesMs.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (valid.length === 0) {
    return {
      stage: input.stage,
      engine: input.engine,
      availability: "unavailable",
      count: 0,
      minMs: null,
      medianMs: null,
      p95Ms: null,
      maxMs: null,
      note: input.note ?? null,
    };
  }
  return {
    stage: input.stage,
    engine: input.engine,
    availability: "measured",
    count: valid.length,
    minMs: round3(valid[0] as number),
    medianMs: round3(percentile(valid, 0.5)),
    p95Ms: round3(percentile(valid, 0.95)),
    maxMs: round3(valid[valid.length - 1] as number),
    note: input.note ?? null,
  };
}

export interface BuildLiveLatencyReportInput {
  generatedAt: string;
  iterations: number;
  stages: LatencyStageSamples[];
}

/** Build the full {@link LiveLatencyReport} from collected stage samples. Pure. */
export function buildLiveLatencyReport(input: BuildLiveLatencyReportInput): LiveLatencyReport {
  return {
    schemaVersion: LIVE_LATENCY_REPORT_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    iterations: input.iterations,
    stages: input.stages.map(summarizeStage),
    measuredOnThisMachine: true,
    notThroughputClaim: true,
    notProfitabilityClaim: true,
  };
}
