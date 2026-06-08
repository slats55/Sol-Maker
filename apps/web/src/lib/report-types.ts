/**
 * Frontend-only catalogue of the report artifact schemas Soulmaker's backtest
 * research tooling emits, plus the *expected* envelope shape a viewer would
 * read later.
 *
 * IMPORTANT: this is documentation + types only. It deliberately does NOT import
 * any backend package and is NOT wired to a file loader or parser. It exists so
 * the report-viewer foundation is typed and so the UI can label known vs.
 * unknown schema ids without ever touching backend code that another sprint may
 * be actively changing.
 */

export type SchemaStability = "stable" | "emerging";

export type SchemaFamily =
  | "report"
  | "suite"
  | "sensitivity"
  | "coverage"
  | "plan"
  | "research";

export interface ReportSchemaInfo {
  readonly id: string;
  readonly title: string;
  readonly family: SchemaFamily;
  readonly stability: SchemaStability;
  readonly description: string;
  /** The CLI command that emits this artifact (or a note for emerging ones). */
  readonly cli: string;
}

/**
 * Known schema ids. `stable` entries correspond to shipped CLI commands;
 * `emerging` entries are backend work-in-progress (e.g. the cross-scenario
 * sensitivity matrix) whose exact CLI shape is not finalized here.
 */
export const KNOWN_REPORT_SCHEMAS: readonly ReportSchemaInfo[] = [
  {
    id: "backtest.report.v1",
    title: "Backtest report",
    family: "report",
    stability: "stable",
    description:
      "A single deterministic, simulated paper backtest over one injected scenario.",
    cli: "paper:backtest",
  },
  {
    id: "backtest.suite.v1",
    title: "Backtest suite index",
    family: "suite",
    stability: "stable",
    description:
      "Aggregated index over a directory of injected scenarios (counts + summed simulated totals).",
    cli: "paper:backtest:suite",
  },
  {
    id: "backtest.suite.diff.v1",
    title: "Suite diff",
    family: "suite",
    stability: "stable",
    description: "Conservative delta between two suite indexes.",
    cli: "paper:backtest:diff:suite",
  },
  {
    id: "backtest.sensitivity.v1",
    title: "Sensitivity report",
    family: "sensitivity",
    stability: "stable",
    description:
      "Per-variant deltas vs a baseline over bounded numeric perturbations, with rankings by movement magnitude.",
    cli: "paper:backtest:sensitivity",
  },
  {
    id: "backtest.sensitivity.diff.v1",
    title: "Sensitivity diff",
    family: "sensitivity",
    stability: "stable",
    description: "Conservative delta between two sensitivity reports (paired by suffix).",
    cli: "paper:backtest:diff:sensitivity",
  },
  {
    id: "backtest.coverage.v1",
    title: "Suite coverage",
    family: "coverage",
    stability: "stable",
    description:
      "Which simulated paper behaviours a suite exercised — behavioural bookkeeping, not market or test coverage.",
    cli: "paper:backtest:suite:coverage",
  },
  {
    id: "backtest.variant-plan.explain.v1",
    title: "Variant-plan explain",
    family: "plan",
    stability: "stable",
    description: "Dry-run explanation of what a variant plan would change, without generating files.",
    cli: "paper:backtest:scenario:variants:explain",
  },
  {
    id: "backtest.sensitivity.matrix.v1",
    title: "Sensitivity matrix",
    family: "sensitivity",
    stability: "emerging",
    description:
      "Cross-scenario sensitivity matrix. Backend work in progress — viewer is a labelled placeholder.",
    cli: "(pending — backend research sprint)",
  },
  {
    id: "backtest.sensitivity.matrix.diff.v1",
    title: "Sensitivity matrix diff",
    family: "sensitivity",
    stability: "emerging",
    description:
      "Delta between two sensitivity matrices. Backend work in progress — viewer is a labelled placeholder.",
    cli: "(pending — backend research sprint)",
  },
  {
    id: "backtest.research.manifest.v1",
    title: "Research run manifest",
    family: "research",
    stability: "emerging",
    description:
      "Manifest of a paper research run's generated artifacts + digests. Backend work in progress — inspector labels it as emerging.",
    cli: "(pending — backend research sprint)",
  },
  {
    id: "backtest.research.verify.v1",
    title: "Research run verify",
    family: "research",
    stability: "emerging",
    description:
      "Result of re-verifying a research manifest against its artifacts on disk. Backend work in progress — inspector labels it as emerging.",
    cli: "(pending — backend research sprint)",
  },
  {
    id: "backtest.research.manifest.diff.v1",
    title: "Research manifest diff",
    family: "research",
    stability: "emerging",
    description:
      "Conservative delta between two research run manifests. Backend work in progress — inspector labels it as emerging.",
    cli: "(pending — backend research sprint)",
  },
  {
    id: "backtest.research.bundle.v1",
    title: "Research run bundle",
    family: "research",
    stability: "emerging",
    description:
      "Bundle summary of a paper research run: run digest, artifact/kind/schema counts, and a manifest summary. Backend work in progress — inspector labels it as emerging.",
    cli: "(pending — backend research sprint)",
  },
  {
    id: "backtest.research.status.v1",
    title: "Research run status",
    family: "research",
    stability: "emerging",
    description:
      "Integrity/status check of a paper research run: completeness, recognition, and manifest sync. Backend work in progress — inspector labels it as emerging.",
    cli: "(pending — backend research sprint)",
  },
];

/** Look up schema metadata by id, or `undefined` for an unknown schema. */
export function knownSchema(id: string): ReportSchemaInfo | undefined {
  return KNOWN_REPORT_SCHEMAS.find((schema) => schema.id === id);
}

/** True when `id` is a schema this foundation recognizes. */
export function isKnownSchema(id: string): boolean {
  return knownSchema(id) !== undefined;
}

/**
 * How the inspector should label a (possibly missing) schemaVersion:
 *   - "absent"   — no usable `schemaVersion` field at all
 *   - "stable"   — a shipped, recognized schema
 *   - "emerging" — a recognized but backend-work-in-progress schema
 *   - "unknown"  — a present-but-unrecognized schema id (labelled honestly, never faked)
 */
export type SchemaRecognition = "absent" | "stable" | "emerging" | "unknown";

/** Classify a raw schemaVersion string without ever pretending to know it. */
export function recognizeSchema(id: string | null | undefined): SchemaRecognition {
  if (typeof id !== "string" || id.length === 0) {
    return "absent";
  }
  const info = knownSchema(id);
  return info ? info.stability : "unknown";
}

/**
 * Frontend-only shape of a report file the viewer expects to READ later.
 *
 * This is intentionally permissive and unknown-tolerant. It is NOT a validator
 * and NOT a parser — it only documents the envelope so components are typed.
 */
export interface ReportEnvelope {
  readonly schemaVersion?: string;
  readonly scenarioDigest?: string;
  readonly [key: string]: unknown;
}

/** Read the declared schema version from an envelope, if present and a string. */
export function envelopeSchema(envelope: ReportEnvelope): string | undefined {
  return typeof envelope.schemaVersion === "string"
    ? envelope.schemaVersion
    : undefined;
}
