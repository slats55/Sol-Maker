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
  | "research"
  | "sniper"
  | "simulation"
  | "phase6";

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
 * Known schema ids. `stable` entries correspond to shipped CLI commands. The
 * `emerging` tier is kept for forward-compatibility (a recognized schema whose
 * backend work has not yet landed on master), but no catalogued schema is
 * emerging today — the cross-scenario matrix and research-run families have all
 * shipped. CLI command names below are verified against the commands registered
 * in `apps/cli` on master; they are display labels only (this module imports no
 * backend code and runs nothing).
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
    stability: "stable",
    description:
      "Cross-scenario sensitivity matrix: base scenarios × variants, with per-cell deltas and per-variant aggregates.",
    cli: "paper:backtest:sensitivity:matrix",
  },
  {
    id: "backtest.sensitivity.matrix.diff.v1",
    title: "Sensitivity matrix diff",
    family: "sensitivity",
    stability: "stable",
    description:
      "Conservative delta between two sensitivity matrices (bases paired by id, cells by suffix).",
    cli: "paper:backtest:diff:sensitivity:matrix",
  },
  {
    id: "backtest.research.manifest.v1",
    title: "Research run manifest",
    family: "research",
    stability: "stable",
    description:
      "Manifest of a paper research run's generated artifacts + digests.",
    cli: "paper:backtest:research:manifest",
  },
  {
    id: "backtest.research.verify.v1",
    title: "Research run verify",
    family: "research",
    stability: "stable",
    description:
      "Result of re-verifying a research manifest against its artifacts on disk.",
    cli: "paper:backtest:research:verify",
  },
  {
    id: "backtest.research.manifest.diff.v1",
    title: "Research manifest diff",
    family: "research",
    stability: "stable",
    description: "Conservative delta between two research run manifests.",
    cli: "paper:backtest:diff:research:manifest",
  },
  {
    id: "backtest.research.bundle.v1",
    title: "Research run bundle",
    family: "research",
    stability: "stable",
    description:
      "Bundle summary of a paper research run: run digest, artifact/kind/schema counts, and a manifest summary.",
    cli: "paper:backtest:research:bundle",
  },
  {
    id: "backtest.research.status.v1",
    title: "Research run status",
    family: "research",
    stability: "stable",
    description:
      "Integrity/status check of a paper research run: completeness, recognition, and manifest sync.",
    cli: "paper:backtest:research:status",
  },
  {
    id: "backtest.research.campaign.index.v1",
    title: "Research campaign index",
    family: "research",
    stability: "stable",
    description:
      "Campaign-level summary across many paper research runs: per-run digests, drift, and aggregate kind/schema counts.",
    cli: "paper:backtest:research:index",
  },
  {
    id: "backtest.research.bundle.diff.v1",
    title: "Research bundle diff",
    family: "research",
    stability: "stable",
    description:
      "Conservative delta between two research run bundles: run-digest change, artifact add/remove/digest-change, count/schema-set deltas, and a conservative regression flag.",
    cli: "paper:backtest:diff:research:bundle",
  },
  {
    id: "backtest.research.campaign.diff.v1",
    title: "Research campaign diff",
    family: "research",
    stability: "stable",
    description:
      "Conservative delta between two research campaign indexes: campaign-digest change, runs added/removed/changed, attention transitions, aggregate count/schema deltas, and a conservative regression flag.",
    cli: "paper:backtest:diff:research:index",
  },

  // --- Sniper PAPER pipeline (S25–S87; verified against origin/master) -------
  // These are integrity/safety artifacts from the paper-only sniper pipeline.
  // None of them is an order, a transaction, or live-trading readiness.
  {
    id: "sniper.paper.decision.report.v2",
    title: "Sniper paper decision report v2",
    family: "sniper",
    stability: "stable",
    description:
      "Paper-only sniper decisions per candidate (skip/watch/paper-enter/paper-reject/unknown) with machine-readable reason codes and policy visibility. A paper-enter is a SIMULATED classification, never an order.",
    cli: "paper:sniper:decide",
  },
  {
    id: "sniper.run.report.v2",
    title: "Sniper run report v2",
    family: "sniper",
    stability: "stable",
    description:
      "Operator run summary bundling already-built local artifacts verbatim: decisions, preflight statuses, reason-code rollups, policy visibility, and operator-blocking reasons. Built with --schema-version v2.",
    cli: "paper:sniper:report",
  },
  {
    id: "sniper.run.report.diff.v2",
    title: "Sniper run report diff v2",
    family: "sniper",
    stability: "stable",
    description:
      "Structured comparison of two v2 run reports: decision/preflight transitions, operator-blocking reasons added/removed, and reason-code count deltas. Built with --schema-version v2.",
    cli: "paper:sniper:diff:report",
  },

  // --- Phase 6 simulation chain (S61–S87; verified against origin/master) ----
  // Read-only, dry-run-only artifacts. The route resolver and the real dry-run
  // engine do NOT exist; unavailable/unresolved states are the honest record.
  {
    id: "simulation.intent.plan.v2",
    title: "Simulation intent plan v2",
    family: "simulation",
    stability: "stable",
    description:
      "Fail-closed SIMULATION PREVIEW over the strictly-validated v2 chain. Destination/amount/fee previews stay UNRESOLVED (never invented); anything missing or not ready produces a BLOCKED plan.",
    cli: "paper:simulation:intent:plan",
  },
  {
    id: "simulation.result.v1",
    title: "Simulation result v1",
    family: "simulation",
    stability: "stable",
    description:
      "The honest record of one simulation pass over a validated plan: unresolved entries are SKIPPED and the dry-run reports UNAVAILABLE (no real dry-run engine exists — nothing is faked).",
    cli: "paper:simulation:result",
  },
  {
    id: "simulation.route.resolution.v1",
    title: "Simulation route resolution v1",
    family: "simulation",
    stability: "stable",
    description:
      "Per-entry route/destination/fee PROVENANCE over a validated plan. No route resolver exists inside the boundary, so every entry is honestly UNAVAILABLE under the fixed unavailable-no-route-resolver id.",
    cli: "paper:simulation:route",
  },
  {
    id: "simulation.intent.plan.diff.v2",
    title: "Simulation plan diff v2",
    family: "simulation",
    stability: "stable",
    description:
      "Structured-field-only comparison of two simulation intent plans: blocked transitions, reason-code movements, source-ref changes, and per-entry preview changes.",
    cli: "paper:simulation:diff:plan",
  },
  {
    id: "simulation.result.diff.v1",
    title: "Simulation result diff v1",
    family: "simulation",
    stability: "stable",
    description:
      "Structured-field-only comparison of two simulation results: status/blocked transitions, code movements, adapter changes, and per-entry outcome changes.",
    cli: "paper:simulation:diff:result",
  },
  {
    id: "phase6.audit.report.v1",
    title: "Phase 6 chain audit",
    family: "phase6",
    stability: "stable",
    description:
      "Chain audit over the ten Phase 6 artifacts (incl. the S87 route-resolution role): each strictly validated in place, structured cross-references checked, chain conditions surfaced verbatim. Reports — never authorizes.",
    cli: "paper:simulation:audit",
  },
  {
    id: "phase6.simulation.readiness.report.v1",
    title: "Phase 6 simulation readiness",
    family: "phase6",
    stability: "stable",
    description:
      "Structural 'is the Phase 6 simulation stack green?' verdict: machine-verified artifact checks plus eleven verbatim evidence declarations (incl. route-resolution-tests). phase7LiveTradingReady is a literal false, always.",
    cli: "paper:simulation:readiness",
  },
  {
    id: "phase6.simulation.handoff.pack.v1",
    title: "Phase 6 handoff pack",
    family: "phase6",
    stability: "stable",
    description:
      "Session handoff over the twelve Phase 6 chain artifacts (incl. the S87 route-resolution role), each strictly validated and summarized from verbatim structured fields; missing artifacts classified, never invented.",
    cli: "paper:simulation:handoff",
  },
  {
    id: "phase6.operator.bundle.v1",
    title: "Phase 6 operator bundle",
    family: "phase6",
    stability: "stable",
    description:
      "Archiveable operator bundle over the THIRTEEN Phase 6 chain roles (the twelve handoff roles plus the handoff pack itself): per-role state + file integrity refs, a blocking trail recomputed and cross-checked against the pack, and a closed-set operator verdict never better than reviewable-paper-only.",
    cli: "paper:simulation:bundle",
  },
];

/** Look up schema metadata by id, or `undefined` for an unknown schema. */
export function knownSchema(id: string): ReportSchemaInfo | undefined {
  return KNOWN_REPORT_SCHEMAS.find((schema) => schema.id === id);
}

/**
 * Inverse of {@link knownSchema}: find the schema a CLI command emits, matched
 * against the registry's `cli` field. Returns `undefined` for a command that
 * produces no catalogued artifact (e.g. `doctor`, `paper:run`). This is the
 * single source of truth the command-reference page reads so a command's
 * artifact + stability can never drift from the schema registry.
 */
export function schemaForCli(cli: string): ReportSchemaInfo | undefined {
  return KNOWN_REPORT_SCHEMAS.find((schema) => schema.cli === cli);
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
