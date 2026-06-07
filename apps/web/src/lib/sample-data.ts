/**
 * Local UI sample fixtures — clearly labelled, never live, never real.
 *
 * Every value here is static scaffolding so the dashboard shell renders with
 * representative structure. None of it is fetched, none of it is a real wallet,
 * balance, position, or market result. Each item is tagged with
 * `source: "sample-local-ui-fixture"` and `isLive: false` so it can never be
 * mistaken for live data.
 *
 * The honest sample status cards reflect the project's TRUE posture (PAPER /
 * no wallet / offline / engine not running) — they never fake a connected
 * wallet, a running bot, or profit.
 */

import { COMMANDS } from "./command-reference.js";
import { KNOWN_REPORT_SCHEMAS, type ReportEnvelope } from "./report-types.js";
import { MODES } from "./safety.js";

export const SAMPLE_SOURCE = "sample-local-ui-fixture" as const;

/** Marker stamped on every sample item. */
export interface SampleTag {
  readonly source: typeof SAMPLE_SOURCE;
  readonly isLive: false;
}

export const SAMPLE_TAG: SampleTag = { source: SAMPLE_SOURCE, isLive: false };

/**
 * Tone for sample status cards. Intentionally a SUBSET of the components' `Tone`
 * (it omits `"danger"`): honest posture cards only ever report safe/neutral/
 * caution states — never a danger state — so the type makes that impossible.
 */
export type CardTone = "safe" | "neutral" | "caution";

export interface SampleStatusCard {
  readonly tag: SampleTag;
  readonly label: string;
  readonly value: string;
  readonly tone: CardTone;
  readonly note: string;
}

/** Honest posture cards for the overview (true state, not fabricated activity). */
export const SAMPLE_STATUS_CARDS: readonly SampleStatusCard[] = [
  {
    tag: SAMPLE_TAG,
    label: "Mode",
    value: "PAPER",
    tone: "safe",
    note: "Default, fully simulated. No wallet, no chain access.",
  },
  {
    tag: SAMPLE_TAG,
    label: "Wallet",
    value: "None connected",
    tone: "safe",
    note: "This dashboard never connects a wallet or holds a key.",
  },
  {
    tag: SAMPLE_TAG,
    label: "Network",
    value: "Offline",
    tone: "safe",
    note: "No live market data, no trading / data provider calls.",
  },
  {
    tag: SAMPLE_TAG,
    label: "Engine",
    value: "Not running",
    tone: "neutral",
    note: "No live bot. Research artifacts are generated locally by the CLI.",
  },
];

export interface SampleMetric {
  readonly tag: SampleTag;
  readonly label: string;
  readonly value: string;
  readonly hint: string;
}

/**
 * Structural metrics for the overview — counts of research scaffolding, never
 * money or performance. (Deliberately avoids any dollar / PnL figure here.)
 */
// Counts are DERIVED from the real arrays so they can never go stale.
export const SAMPLE_METRICS: readonly SampleMetric[] = [
  {
    tag: SAMPLE_TAG,
    label: "Report schemas supported",
    value: String(KNOWN_REPORT_SCHEMAS.length),
    hint: "Known backtest artifact schemas the viewer foundation recognizes.",
  },
  {
    tag: SAMPLE_TAG,
    label: "Modes described",
    value: String(MODES.length),
    hint: "PAPER · WATCH_ONLY · SIMULATION · DANGEROUS_BURNER_LIVE.",
  },
  {
    tag: SAMPLE_TAG,
    label: "CLI workflows",
    value: String(COMMANDS.length),
    hint: "Existing commands documented in the reference page.",
  },
];

export interface SampleReportSummary {
  readonly tag: SampleTag;
  readonly envelope: ReportEnvelope;
  readonly metrics: readonly { readonly label: string; readonly value: string }[];
}

/**
 * A sample backtest report summary for the viewer foundation. The PnL figure is
 * explicitly labelled simulated + not real; the digest is an obvious placeholder.
 */
export const SAMPLE_BACKTEST_REPORT: SampleReportSummary = {
  tag: SAMPLE_TAG,
  envelope: {
    schemaVersion: "backtest.report.v1",
    scenarioDigest: "sample-fixture-digest",
  },
  metrics: [
    { label: "Steps", value: "6" },
    { label: "Simulated fills", value: "4" },
    { label: "Rejections", value: "1" },
    { label: "Closed positions", value: "2" },
    { label: "Open positions", value: "1" },
    { label: "Total simulated PnL", value: "+12.50 (simulated · not real · not advice)" },
  ],
};

export interface SampleArtifact {
  readonly tag: SampleTag;
  readonly name: string;
  readonly schema: string;
  readonly kind: string;
}

/** Sample artifact listing for empty/placeholder states in the viewer pages. */
export const SAMPLE_ARTIFACTS: readonly SampleArtifact[] = [
  {
    tag: SAMPLE_TAG,
    name: "buy-hold.report.json",
    schema: "backtest.report.v1",
    kind: "Report",
  },
  {
    tag: SAMPLE_TAG,
    name: "suite-index.json",
    schema: "backtest.suite.v1",
    kind: "Suite index",
  },
  {
    tag: SAMPLE_TAG,
    name: "sensitivity-report.json",
    schema: "backtest.sensitivity.v1",
    kind: "Sensitivity",
  },
];
