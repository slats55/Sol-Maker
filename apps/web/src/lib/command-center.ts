/**
 * Sniper Command Center model (Sprint 90).
 *
 * Pure builders that turn an already-built folder index (+ its dry-run
 * overview) into the command-center blocks: the capability strip, the safe
 * pipeline visualization, the candidate intelligence table, and the
 * observability panel. Shared by the static Sniper Command Center page
 * (rendered over the committed byte-pinned `dry-run-sample` fixture) and the
 * loaded folder index (`pnpm web:inspect --dir` over a REAL run folder).
 *
 * Honesty rules, same as the rest of the inspector:
 *   - everything is read DEFENSIVELY from the folder's own artifacts (absent or
 *     mistyped values become `null` / "unknown", never invented);
 *   - no prices, no PnL, no liquidity, no timing data is fabricated — when a
 *     fact is absent the panel says so ("timing unavailable");
 *   - the capability strip states the SAFE truth: the route resolver is a
 *     boundary (honestly unavailable) and live trading is disabled/unauthorized.
 *
 * Pure module: no filesystem, no network, no DOM.
 */

import { asArray, asRecord, readBoolean, readNumber, readString, readStringArray } from "./json-access.js";
import type { FolderArtifactEntry, FolderIndex } from "./folder-index.js";
import { routeStatusExplanation, type DryRunOverview } from "./dry-run-overview.js";

/* ------------------------------------------------------------------ *
 * Capability strip — the honest, static capability truth.
 * ------------------------------------------------------------------ */

export type CapabilityState = "available" | "boundary-only" | "disabled";

export interface SniperCapability {
  readonly key: string;
  readonly label: string;
  readonly state: CapabilityState;
  readonly note: string;
}

/** The capability truth of the PAPER sniper platform (kept in sync with the CLI surface). */
export const SNIPER_CAPABILITIES: readonly SniperCapability[] = [
  {
    key: "intake",
    label: "Candidate intake",
    state: "available",
    note: "Operator-authored candidate lists with strict mint validation (paper:sniper:candidates:validate).",
  },
  {
    key: "intel",
    label: "Read-only inspect / risk",
    state: "available",
    note: "token:inspect / token:risk — read-only RPC, advisory only, never a buy signal.",
  },
  {
    key: "bridge",
    label: "Preflight bridge",
    state: "available",
    note: "paper:sniper:preflight:input:prepare pairs the read-only outputs to candidates by mint.",
  },
  {
    key: "dry-run",
    label: "PAPER dry-run",
    state: "available",
    note: "paper:sniper:dry-run — one command, the full validated artifact chain. Simulation only.",
  },
  {
    key: "bundle",
    label: "Operator bundle",
    state: "available",
    note: "13-role integrity bundle with per-file digests (phase6.operator.bundle.v1).",
  },
  {
    key: "routequote",
    label: "Read-only route quotes",
    state: "available",
    note: "paper:routequote:prepare pairs quote observations to candidates by mint; paper:routequote:fetch fetches REAL quotes from the public Jupiter lite API — observation provenance only, never executable.",
  },
  {
    key: "realtime",
    label: "Real-time candidate feed",
    state: "available",
    note: "paper:realtime:snapshot / :watch read public new-token feeds (read-only observation) — a watched candidate is never an order.",
  },
  {
    key: "tx-simulate",
    label: "Unsigned tx simulation",
    state: "available",
    note: "paper:simulation:tx runs the real simulateTransaction (sigVerify:false) over UNSIGNED envelopes — no signer, no key; simulated-ok is evidence, never readiness.",
  },
  {
    key: "tx-build",
    label: "Unsigned tx builder",
    state: "boundary-only",
    note: "execution:build constructs UNSIGNED swap envelopes refusal-first — it never signs and never sends; an envelope is simulation material, never an order.",
  },
  {
    key: "route",
    label: "Route resolver",
    state: "boundary-only",
    note: "No resolver capability exists inside the simulation boundary — read-only quote observations can supply label facts; execution never.",
  },
  {
    key: "devnet-exec",
    label: "Devnet execution",
    state: "boundary-only",
    note: "execution:devnet:send sends ONLY on devnet behind a double opt-in (env flag + CLI flag), journaled — no mainnet path exists here.",
  },
  {
    key: "live",
    label: "Mainnet live trading",
    state: "disabled",
    note: "Disabled by default: the fourteen-condition mainnet live gate is BLOCKED and mainnet sending has no CLI surface — no wallet, no keys, no orders by construction.",
  },
];

/* ------------------------------------------------------------------ *
 * Shared defensive lookups.
 * ------------------------------------------------------------------ */

/** First VALID artifact in the folder carrying the given schema id. */
function entryBySchema(index: FolderIndex, schemaVersion: string): FolderArtifactEntry | null {
  for (const entry of index.artifacts) {
    if (entry.status === "valid" && entry.schemaVersion === schemaVersion) return entry;
  }
  return null;
}

/** The folder artifact a bundle role points at (via the role's recorded file name). */
function entryByRole(index: FolderIndex, overview: DryRunOverview, role: string): FolderArtifactEntry | null {
  const status = overview.roles.find((r) => r.role === role);
  if (status === undefined || status.fileName === null) return null;
  for (const entry of index.artifacts) {
    if (entry.status === "valid" && entry.name === status.fileName) return entry;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Pipeline visualization.
 * ------------------------------------------------------------------ */

export type StageState = "complete" | "blocked" | "review" | "unavailable" | "not-run";

export interface PipelineStage {
  readonly key: string;
  readonly label: string;
  readonly state: StageState;
  /** One honest sentence; shown as the chip's tooltip/subline. */
  readonly detail: string;
  /** Same-page anchor of the backing artifact, when present in this folder. */
  readonly anchor: string | null;
}

/** Count preflight candidates whose `inspection`/`risk` projection is present. */
function preflightCoverage(
  preflight: FolderArtifactEntry | null,
  key: "inspection" | "risk",
): { supplied: number; total: number } | null {
  if (preflight === null) return null;
  const rec = asRecord(preflight.raw);
  if (rec === null) return null;
  const rows = asArray(rec["candidates"]);
  if (rows === null) return null;
  let supplied = 0;
  for (const row of rows) {
    const candidate = asRecord(row);
    if (candidate === null) continue;
    const section = asRecord(candidate[key]);
    if (section !== null && readBoolean(section, "present") === true) supplied += 1;
  }
  return { supplied, total: rows.length };
}

function coverageStage(
  key: string,
  label: string,
  what: string,
  coverage: { supplied: number; total: number } | null,
  anchor: string | null,
): PipelineStage {
  if (coverage === null) {
    return { key, label, state: "not-run", detail: `No preflight report in this folder — ${what} coverage is unknown.`, anchor };
  }
  if (coverage.total === 0) {
    return { key, label, state: "not-run", detail: "The preflight report carries no candidates.", anchor };
  }
  if (coverage.supplied === 0) {
    return {
      key,
      label,
      state: "not-run",
      detail: `No ${what} data was supplied — those candidates stay honestly unknown (fail-closed).`,
      anchor,
    };
  }
  if (coverage.supplied < coverage.total) {
    return {
      key,
      label,
      state: "review",
      detail: `${String(coverage.supplied)}/${String(coverage.total)} candidates have ${what} data; the rest stay honestly unknown.`,
      anchor,
    };
  }
  return {
    key,
    label,
    state: "complete",
    detail: `${String(coverage.supplied)}/${String(coverage.total)} candidates have ${what} data.`,
    anchor,
  };
}

/**
 * Build the safe pipeline visualization:
 * Candidate → Inspect → Risk → Plan → Paper decision → Route boundary → Audit → Handoff → Bundle.
 * Every state is derived from the folder's own artifacts; nothing is invented.
 */
export function buildPipelineStages(index: FolderIndex, overview: DryRunOverview): readonly PipelineStage[] {
  const stages: PipelineStage[] = [];

  // 1. Candidate intake (the candidate list is not a bundle role; find it by schema).
  const candidates = entryBySchema(index, "sniper.candidate.list.v1");
  const candidateCount = candidates === null ? null : readNumber(asRecord(candidates.raw) ?? {}, "candidateCount");
  stages.push(
    candidates === null
      ? { key: "candidates", label: "Candidates", state: "not-run", detail: "No candidate list artifact in this folder.", anchor: null }
      : {
          key: "candidates",
          label: "Candidates",
          state: "complete",
          detail: `${candidateCount === null ? "?" : String(candidateCount)} candidate(s) validated (strict mint checks).`,
          anchor: candidates.anchor,
        },
  );

  // 2–3. Inspect / Risk coverage, read from the preflight report's own projections.
  const preflight = entryBySchema(index, "sniper.token.preflight.report.v1");
  stages.push(coverageStage("inspect", "Inspect", "inspection", preflightCoverage(preflight, "inspection"), preflight?.anchor ?? null));
  stages.push(coverageStage("risk", "Risk", "risk", preflightCoverage(preflight, "risk"), preflight?.anchor ?? null));

  // 4. Paper decision.
  const decision = entryByRole(index, overview, "decision");
  if (decision === null) {
    stages.push({ key: "decision", label: "Paper decision", state: "not-run", detail: "No decision artifact recorded by the bundle.", anchor: null });
  } else {
    const rec = asRecord(decision.raw) ?? {};
    const paperEnter = readNumber(rec, "paperEnterCount");
    const watch = readNumber(rec, "watchCount");
    const reject = readNumber(rec, "paperRejectCount");
    const counts = `${paperEnter === null ? "?" : String(paperEnter)} paper-enter / ${watch === null ? "?" : String(watch)} watch / ${reject === null ? "?" : String(reject)} reject`;
    stages.push(
      readBoolean(rec, "hasPaperEnter") === true
        ? { key: "decision", label: "Paper decision", state: "review", detail: `${counts}. Simulated paper-enters always demand operator review.`, anchor: decision.anchor }
        : { key: "decision", label: "Paper decision", state: "complete", detail: `${counts}. No paper-enter in this run.`, anchor: decision.anchor },
    );
  }

  // 5. Simulation plan.
  const plan = entryByRole(index, overview, "intent-plan");
  if (plan === null) {
    stages.push({ key: "plan", label: "Plan", state: "not-run", detail: "No intent plan recorded by the bundle.", anchor: null });
  } else {
    const rec = asRecord(plan.raw) ?? {};
    const blocked = readBoolean(rec, "blocked");
    const entryCount = readNumber(rec, "entryCount");
    stages.push(
      blocked === true
        ? { key: "plan", label: "Plan", state: "blocked", detail: "The simulation intent plan is BLOCKED — see the blocking codes.", anchor: plan.anchor }
        : blocked === false
          ? { key: "plan", label: "Plan", state: "complete", detail: `${entryCount === null ? "?" : String(entryCount)} entr(y/ies) previewed — SIMULATED, never executable.`, anchor: plan.anchor }
          : { key: "plan", label: "Plan", state: "review", detail: "Plan present but its blocked flag could not be read.", anchor: plan.anchor },
    );
  }

  // 6. Route boundary — read from the bundle's verbatim route status. Since S91 an attempted
  //    resolver means READ-ONLY quote facts were recorded (review state, no longer always muted);
  //    live execution remains impossible either way.
  const route = entryByRole(index, overview, "route-resolution");
  const routeStatus = overview.routeResolutionStatus;
  const routeAttempted = overview.routeResolverAttempted;
  stages.push({
    key: "route",
    label: "Route boundary",
    state:
      routeStatus === "unavailable"
        ? "unavailable"
        : routeStatus === "blocked"
          ? "blocked"
          : routeStatus === "no_entries" || routeStatus === "resolved"
            ? "complete"
            : routeStatus === "unresolved" && routeAttempted === true
              ? "review"
              : "not-run",
    detail: routeStatusExplanation(routeStatus, routeAttempted),
    anchor: route?.anchor ?? null,
  });

  // 7. Chain audit.
  const audit = entryByRole(index, overview, "audit-report");
  if (audit === null) {
    stages.push({ key: "audit", label: "Audit", state: "not-run", detail: "No chain audit recorded by the bundle.", anchor: null });
  } else {
    const rec = asRecord(audit.raw) ?? {};
    const passed = readBoolean(rec, "auditPassed");
    stages.push(
      passed === true
        ? { key: "audit", label: "Audit", state: "complete", detail: "Chain audit passed (reports — never authorizes).", anchor: audit.anchor }
        : passed === false
          ? { key: "audit", label: "Audit", state: "blocked", detail: "The chain audit found conditions — inspect the audit artifact.", anchor: audit.anchor }
          : { key: "audit", label: "Audit", state: "review", detail: "Audit present but its verdict could not be read.", anchor: audit.anchor },
    );
  }

  // 8. Handoff pack.
  const handoff = entryByRole(index, overview, "handoff-pack");
  if (handoff === null) {
    stages.push({ key: "handoff", label: "Handoff", state: "not-run", detail: "No handoff pack recorded by the bundle.", anchor: null });
  } else {
    const complete = readBoolean(asRecord(handoff.raw) ?? {}, "complete");
    stages.push(
      complete === true
        ? { key: "handoff", label: "Handoff", state: "complete", detail: "Handoff pack complete (12 roles).", anchor: handoff.anchor }
        : { key: "handoff", label: "Handoff", state: "review", detail: "Handoff pack present but not complete — inspect it.", anchor: handoff.anchor },
    );
  }

  // 9. Operator bundle — the run's own verdict, verbatim.
  const verdict = overview.operatorVerdict;
  stages.push({
    key: "bundle",
    label: "Bundle",
    state:
      verdict === "reviewable-paper-only"
        ? "complete"
        : verdict === "blocked"
          ? "blocked"
          : verdict === null
            ? "review"
            : "review",
    detail:
      verdict === "reviewable-paper-only"
        ? "Best possible verdict — and still SIMULATION ONLY."
        : verdict === "blocked"
          ? "Operator verdict: blocked — the codes below are the honest record."
          : `Operator verdict: ${verdict ?? "unknown"} — inspect the bundle.`,
    anchor: overview.bundleAnchor,
  });

  return stages;
}

/* ------------------------------------------------------------------ *
 * Candidate intelligence table.
 * ------------------------------------------------------------------ */

/** Hard cap on rendered candidate rows. */
export const MAX_CANDIDATE_ROWS = 50;

export interface CandidateRow {
  readonly candidateId: string;
  /** Display label: symbol, else name, else the candidateId. */
  readonly label: string;
  readonly mint: string | null;
  /** Preflight status (pass / warn / fail / unknown), verbatim. */
  readonly preflightStatus: string | null;
  readonly riskScore: number | null;
  readonly riskDecision: string | null;
  readonly criticalFlagCount: number | null;
  readonly decision: string | null;
  readonly blockingCodes: readonly string[];
  /** Per-candidate route quote/resolution state (S91): the prepared routequote's quoteStatus when
   * present, else the route-resolution entry status, else null — verbatim, never invented. */
  readonly routeStatus: string | null;
  readonly nextAction: string;
}

export interface CandidateRowsResult {
  readonly rows: readonly CandidateRow[];
  readonly hidden: number;
}

/** The honest next operator action for one candidate's decision state. */
export function candidateNextAction(decision: string | null, preflightStatus: string | null): string {
  switch (decision) {
    case "paper-enter":
      return "Operator review (paper-only — never an order)";
    case "paper-reject":
      return "Do not proceed — risk-rejected";
    case "watch":
      return "Watch only — no entry";
    case "skip":
      return "Skipped";
    default:
      return preflightStatus === "unknown" || preflightStatus === null
        ? "Supply inspect/risk data via the preflight bridge"
        : "Inspect the decision artifact";
  }
}

/**
 * Join the folder's candidate list + preflight report + decision report into
 * per-candidate rows (by candidateId). Defensive everywhere; rows are capped.
 * No prices, no PnL — only what the artifacts themselves carry.
 */
export function buildCandidateRows(index: FolderIndex): CandidateRowsResult {
  const list = entryBySchema(index, "sniper.candidate.list.v1");
  const listRec = list === null ? null : asRecord(list.raw);
  const rowsRaw = listRec === null ? null : asArray(listRec["candidates"]);
  if (rowsRaw === null) return { rows: [], hidden: 0 };

  const preflightByCandidate = new Map<string, Record<string, unknown>>();
  const preflight = entryBySchema(index, "sniper.token.preflight.report.v1");
  const preflightRows = preflight === null ? null : asArray(asRecord(preflight.raw)?.["candidates"]);
  for (const row of preflightRows ?? []) {
    const rec = asRecord(row);
    const id = rec === null ? null : readString(rec, "candidateId");
    if (rec !== null && id !== null && !preflightByCandidate.has(id)) preflightByCandidate.set(id, rec);
  }

  const decisionByCandidate = new Map<string, Record<string, unknown>>();
  const decision =
    entryBySchema(index, "sniper.paper.decision.report.v2") ?? entryBySchema(index, "sniper.paper.decision.report.v1");
  const decisionRows = decision === null ? null : asArray(asRecord(decision.raw)?.["decisions"]);
  for (const row of decisionRows ?? []) {
    const rec = asRecord(row);
    const id = rec === null ? null : readString(rec, "candidateId");
    if (rec !== null && id !== null && !decisionByCandidate.has(id)) decisionByCandidate.set(id, rec);
  }

  // Per-candidate route state (S91): the prepared routequote's per-entry quoteStatus wins (it is
  // the finer-grained fact); the route-resolution entry status is the fallback. Verbatim only.
  const routeStatusByCandidate = new Map<string, string>();
  const routeEntry = entryBySchema(index, "simulation.route.resolution.v1");
  for (const row of asArray(asRecord(routeEntry?.raw ?? null)?.["entries"]) ?? []) {
    const rec = asRecord(row);
    const id = rec === null ? null : readString(rec, "candidateId");
    const status = rec === null ? null : readString(rec, "routeResolutionStatus");
    if (id !== null && status !== null && !routeStatusByCandidate.has(id)) routeStatusByCandidate.set(id, status);
  }
  const routequote = entryBySchema(index, "routequote.prepared.v1");
  for (const row of asArray(asRecord(routequote?.raw ?? null)?.["entries"]) ?? []) {
    const rec = asRecord(row);
    const id = rec === null ? null : readString(rec, "candidateId");
    const status = rec === null ? null : readString(rec, "quoteStatus");
    if (id !== null && status !== null) routeStatusByCandidate.set(id, status);
  }

  const rows: CandidateRow[] = [];
  for (const row of rowsRaw.slice(0, MAX_CANDIDATE_ROWS)) {
    const rec = asRecord(row);
    if (rec === null) continue;
    const candidateId = readString(rec, "candidateId");
    if (candidateId === null) continue;
    const pf = preflightByCandidate.get(candidateId) ?? null;
    const riskProjection = pf === null ? null : asRecord(pf["risk"]);
    const dec = decisionByCandidate.get(candidateId) ?? null;
    const decisionValue = dec === null ? null : readString(dec, "decision");
    const preflightStatus = pf === null ? null : readString(pf, "status");
    rows.push({
      candidateId,
      label: readString(rec, "symbol") ?? readString(rec, "name") ?? candidateId,
      mint: readString(rec, "mint"),
      preflightStatus,
      riskScore: riskProjection === null ? null : readNumber(riskProjection, "score"),
      riskDecision: riskProjection === null ? null : readString(riskProjection, "decision"),
      criticalFlagCount: riskProjection === null ? null : readNumber(riskProjection, "criticalFlagCount"),
      decision: decisionValue,
      blockingCodes: dec === null ? [] : readStringArray(dec, "blockingReasonCodes").items,
      routeStatus: routeStatusByCandidate.get(candidateId) ?? null,
      nextAction: candidateNextAction(decisionValue, preflightStatus),
    });
  }
  return { rows, hidden: Math.max(0, rowsRaw.length - rows.length) };
}

/* ------------------------------------------------------------------ *
 * Observability panel — artifact-derived facts only.
 * ------------------------------------------------------------------ */

export interface ObservabilityFact {
  readonly label: string;
  readonly value: string;
  readonly note: string | null;
}

/** Count of declared readiness evidence areas, read defensively from the readiness artifact. */
function readinessAreaCount(index: FolderIndex, overview: DryRunOverview): number | null {
  const readiness = entryByRole(index, overview, "readiness-report");
  if (readiness === null) return null;
  const rows = asArray(asRecord(readiness.raw)?.["evidence"]);
  return rows === null ? null : rows.length;
}

/**
 * The observability panel: run identity, artifact/scheme counts, integrity
 * signals, route caveat, readiness areas — every value read from the folder's
 * own artifacts. Timing is honestly "unavailable": these artifacts carry no
 * wall-clock by design (determinism), so none is invented.
 */
export function buildObservabilityFacts(index: FolderIndex, overview: DryRunOverview): readonly ObservabilityFact[] {
  const counts = index.counts;
  const areas = readinessAreaCount(index, overview);
  const route = entryByRole(index, overview, "route-resolution");
  const liveStateCaveat = route === null ? null : readBoolean(asRecord(route.raw) ?? {}, "liveStateCaveat");
  return [
    { label: "Run label", value: overview.bundleLabel ?? "(none recorded)", note: null },
    { label: "Operator", value: overview.operatorLabel ?? "(none recorded)", note: null },
    { label: "Operator verdict", value: overview.operatorVerdict ?? "(missing)", note: "verbatim from the bundle" },
    {
      label: "Artifacts",
      value: `${String(counts.validArtifacts)} valid / ${String(counts.malformedFiles)} malformed / ${String(counts.skippedFiles)} skipped`,
      note: "folder scan counts",
    },
    { label: "Distinct schemas", value: String(index.schemaCounts.length), note: null },
    {
      label: "Bundle roles",
      value: `${String(overview.validRoleCount)} valid / ${String(overview.invalidRoleCount)} invalid / ${String(overview.missingRoleCount)} missing`,
      note: "per-file sha256-128 integrity digests recorded in the bundle",
    },
    { label: "Blocking codes", value: String(overview.chainBlockingCodes.total), note: "carried verbatim" },
    {
      label: "Blocking trail consistent",
      value: overview.blockingTrailConsistent === null ? "unknown" : String(overview.blockingTrailConsistent),
      note: overview.blockingTrailConsistent === false ? "codes disagree across the chain — treat as tampered" : null,
    },
    {
      label: "Route status",
      value: overview.routeResolutionStatus ?? "(missing)",
      note: routeStatusExplanation(overview.routeResolutionStatus, overview.routeResolverAttempted),
    },
    {
      label: "Route quote",
      value:
        overview.routeResolverAttempted === true
          ? `read-only quote facts via ${route === null ? "(resolver unknown)" : (readString(asRecord(route.raw) ?? {}, "routeResolverId") ?? "(resolver unknown)")}`
          : "none — honest boundary (no quote observations supplied)",
      note: "an observed quote is an observation, never executable — quotes can never unblock a chain",
    },
    {
      label: "Route live-state caveat",
      value: liveStateCaveat === null ? "unknown" : String(liveStateCaveat),
      note: "a resolved route would still describe a PAST chain state — never an executable promise",
    },
    {
      label: "Readiness (verbatim)",
      value: overview.simulationReadyPerReadiness === null ? "unknown" : String(overview.simulationReadyPerReadiness),
      note: "phase6 SIMULATION readiness — never live readiness",
    },
    {
      label: "Readiness evidence areas",
      value: areas === null ? "unknown" : String(areas),
      note: "declared evidence areas in the readiness artifact",
    },
    {
      label: "Timing",
      value: "unavailable",
      note: "these artifacts carry no wall-clock by design (byte determinism) — nothing is invented",
    },
  ];
}
