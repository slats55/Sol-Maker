/**
 * THE SUPERVISED OPERATOR LOOP (`live.operator.run.report.v1`, Sprint 109, Part 3).
 *
 * One bounded, journaled, RECOMMEND-ONLY pass of the production operator loop. It composes the
 * Part 1 policy, the Part 2 escalation + per-candidate pipeline, and the Part 3 operator config
 * into the run unit `live:operator:run` executes. The four run modes are `off`, `observe_only`,
 * `paper_shadow`, `armed_canary` — and NONE of them trades:
 *
 *   - off           : processes nothing.
 *   - observe_only  : observes + scores; no shadow, no canary.
 *   - paper_shadow  : adds the would-have simulation; no canary.
 *   - armed_canary  : may RECOMMEND preparing AT MOST ONE tiny canary per run, and only when
 *                     every gate is green. The recommendation is a handoff: a human runs
 *                     `live:canary:prepare` and signs in Phantom. The backend never signs or sends.
 *
 * Structural guarantees, all tested:
 *   - A run can never EXCEED the config's mode (privilege only narrows; asking for more refuses).
 *   - Kill switch / emergency stop block EVERYTHING — zero candidates are processed, in any mode.
 *   - A pause (Phantom rejection / timeout, kill switch, prior pause) requires a recorded MANUAL
 *     re-arm before another canary can be recommended; the loop reports itself paused.
 *   - At most ONE canary recommendation per run, enforced belt-and-braces even if the caps would
 *     have allowed more.
 *   - Every run emits the session events + alerts for the durable journal; the loop itself does
 *     no I/O (the CLI owns files and time).
 */

import type { BuildAlertInput } from "./alerts.js";
import { buildOperatorAlert } from "./alerts.js";
import type { OperatorAlert } from "./alerts.js";
import type { EscalationSessionState, LiveEscalationPolicy } from "./escalation.js";
import type { LiveOperatorConfig, OperatorRunMode } from "./operator-config.js";
import { OPERATOR_MODE_RANK, OPERATOR_RUN_MODES } from "./operator-config.js";
import type { LiveModePolicy } from "./policy.js";
import { evaluateCandidatePipeline } from "./sniper-loop.js";
import type { CandidatePipelineResult } from "./sniper-loop.js";
import type { SniperCandidate } from "./discovery.js";
import type { StrategyQuoteFacts, StrategyRiskAppetite } from "./strategy.js";

export const LIVE_OPERATOR_RUN_REPORT_SCHEMA_VERSION = "live.operator.run.report.v1";

export class OperatorLoopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorLoopError";
  }
}

/** One candidate as the CLI hands it to the loop (already discovered + enriched). */
export interface OperatorLoopCandidate {
  candidate: SniperCandidate;
  quote: StrategyQuoteFacts | null;
  quoteFresh: boolean | null;
  plannedSpendSol: number | null;
}

/** A session-journal event the run wants recorded (the CLI assigns sessionId + seq). */
export interface OperatorLoopSessionEvent {
  kind: string;
  detail: string;
  data: Record<string, unknown> | null;
}

export interface OperatorLoopLimits {
  /** Hard cap on candidates processed this run (null = all supplied). */
  maxCandidates: number | null;
  /** Wall-clock budget for this run in ms (null = no budget). Checked via `elapsedMs`. */
  maxRuntimeMs: number | null;
}

export interface OperatorLoopInput {
  config: LiveOperatorConfig;
  requestedMode: OperatorRunMode;
  candidates: OperatorLoopCandidate[];
  policy: LiveModePolicy;
  escalationPolicy: LiveEscalationPolicy;
  /** Derived from the session journal (durable pause / caps / cooldown / manual re-arm). */
  escalationSession: EscalationSessionState;
  limits: OperatorLoopLimits;
  riskAppetite?: StrategyRiskAppetite;
  sessionId: string | null;
  startedAt: string;
  nowMs: number;
  /** Injected elapsed-ms probe for the runtime budget (the CLI passes a real clock). */
  elapsedMs?: () => number;
}

export interface OperatorRunReport {
  schemaVersion: typeof LIVE_OPERATOR_RUN_REPORT_SCHEMA_VERSION;
  sessionId: string | null;
  operatorLabel: string;
  configMode: OperatorRunMode;
  requestedMode: OperatorRunMode;
  /** The mode the run actually executed under (never above configMode). */
  effectiveMode: OperatorRunMode;
  startedAt: string;
  totals: {
    candidatesSupplied: number;
    processed: number;
    skippedOverBudget: number;
    watch: number;
    paperShadow: number;
    blocked: number;
    ignored: number;
    canaryRecommended: number;
  };
  results: CandidatePipelineResult[];
  /** The single handoff, when armed and every gate was green. NEVER a prepared transaction. */
  recommendation: {
    mint: string;
    symbol: string | null;
    score: number | null;
    nextSteps: string[];
  } | null;
  paused: boolean;
  pauseReasons: string[];
  /** When paused, a human must record a manual re-arm before the next armed run can recommend. */
  manualRearmRequiredToResume: boolean;
  /** Journal events for the CLI to append (sessionId/seq assigned at append time). */
  sessionEvents: OperatorLoopSessionEvent[];
  /** Fully-built alerts for whichever sinks the operator enabled (default: none). */
  alerts: OperatorAlert[];
  /** Pinned honesty literals. */
  loopNeverSends: true;
  backendCustodiesNoKeys: true;
  backendNeverSends: true;
  notProfitabilityClaim: true;
}

const CANARY_NEXT_STEPS = [
  "review the candidate + risk report yourself — a recommendation is not an instruction",
  "build the UNSIGNED request: pnpm soulmaker live:canary:prepare --candidate-mint <mint> --risk <risk.json> --envelope <envelope.json> …",
  "open apps/web/public/live-console.html, load the request, and approve/reject in YOUR Phantom wallet",
  "record the outcome in the session journal and reconcile with live:operator:reconcile",
];

/** Run one supervised, bounded, recommend-only operator pass. Pure. */
export function runSupervisedOperatorLoop(input: OperatorLoopInput): OperatorRunReport {
  const { config } = input;
  if (!(OPERATOR_RUN_MODES as readonly string[]).includes(input.requestedMode)) {
    throw new OperatorLoopError(`requested mode must be one of ${OPERATOR_RUN_MODES.join(" | ")}`);
  }
  if (OPERATOR_MODE_RANK[input.requestedMode] > OPERATOR_MODE_RANK[config.mode]) {
    throw new OperatorLoopError(
      `requested mode "${input.requestedMode}" exceeds the config's mode "${config.mode}" — a run may only reduce privilege. Edit the config (and re-validate) to raise it.`,
    );
  }
  const effectiveMode = input.requestedMode;
  const elapsedMs = input.elapsedMs ?? ((): number => 0);

  const sessionEvents: OperatorLoopSessionEvent[] = [];
  const alerts: OperatorAlert[] = [];
  const alert = (a: Omit<BuildAlertInput, "at" | "sessionId">): void => {
    alerts.push(buildOperatorAlert({ ...a, at: input.startedAt, sessionId: input.sessionId }));
  };

  const base = {
    schemaVersion: LIVE_OPERATOR_RUN_REPORT_SCHEMA_VERSION as typeof LIVE_OPERATOR_RUN_REPORT_SCHEMA_VERSION,
    sessionId: input.sessionId,
    operatorLabel: config.operatorLabel,
    configMode: config.mode,
    requestedMode: input.requestedMode,
    effectiveMode,
    startedAt: input.startedAt,
    loopNeverSends: true as const,
    backendCustodiesNoKeys: true as const,
    backendNeverSends: true as const,
    notProfitabilityClaim: true as const,
  };

  // --- Kill switch / emergency stop: block EVERYTHING, in every mode. ---
  const hardStops: string[] = [];
  if (config.killSwitchEngaged) hardStops.push("kill-switch-engaged");
  if (config.emergencyStopEngaged) hardStops.push("emergency-stop-engaged");
  if (hardStops.length > 0) {
    if (config.killSwitchEngaged) {
      sessionEvents.push({ kind: "kill_switch_engaged", detail: "kill switch engaged — every operator action is blocked", data: null });
      alert({ kind: "kill_switch_engaged", detail: "kill switch engaged — loop blocked, nothing processed" });
    }
    if (config.emergencyStopEngaged) {
      sessionEvents.push({ kind: "emergency_stop_engaged", detail: "emergency stop engaged — every operator action is blocked", data: null });
      alert({ kind: "emergency_stop_engaged", detail: "emergency stop engaged — loop blocked, nothing processed" });
    }
    sessionEvents.push({ kind: "loop_paused", detail: `paused: ${hardStops.join(", ")}`, data: { reasons: hardStops } });
    alert({ kind: "session_paused", detail: `loop paused (${hardStops.join(", ")}) — manual re-arm required after the stop is cleared` });
    return {
      ...base,
      totals: { candidatesSupplied: input.candidates.length, processed: 0, skippedOverBudget: 0, watch: 0, paperShadow: 0, blocked: 0, ignored: 0, canaryRecommended: 0 },
      results: [],
      recommendation: null,
      paused: true,
      pauseReasons: hardStops,
      manualRearmRequiredToResume: true,
      sessionEvents,
      alerts,
    };
  }

  // --- off: processes nothing (and says so). ---
  if (effectiveMode === "off") {
    return {
      ...base,
      totals: { candidatesSupplied: input.candidates.length, processed: 0, skippedOverBudget: 0, watch: 0, paperShadow: 0, blocked: 0, ignored: 0, canaryRecommended: 0 },
      results: [],
      recommendation: null,
      paused: false,
      pauseReasons: [],
      manualRearmRequiredToResume: false,
      sessionEvents: [{ kind: "note", detail: "mode off — nothing processed", data: null }],
      alerts,
    };
  }

  const pausedPendingRearm = input.escalationSession.paused === true;

  // --- Bounded candidate pass. ---
  const results: CandidatePipelineResult[] = [];
  let skippedOverBudget = 0;
  let recommended: OperatorRunReport["recommendation"] = null;
  // Local copy of the escalation counters so a recommendation inside THIS run immediately
  // tightens the gate for the rest of the run (cooldown + caps), exactly like a durable journal would.
  const session: EscalationSessionState = { ...input.escalationSession };

  for (let i = 0; i < input.candidates.length; i++) {
    if (input.limits.maxCandidates !== null && results.length >= input.limits.maxCandidates) {
      skippedOverBudget = input.candidates.length - i;
      sessionEvents.push({ kind: "note", detail: `candidate budget reached (${input.limits.maxCandidates}) — ${skippedOverBudget} candidate(s) not processed`, data: null });
      break;
    }
    if (input.limits.maxRuntimeMs !== null && elapsedMs() > input.limits.maxRuntimeMs) {
      skippedOverBudget = input.candidates.length - i;
      sessionEvents.push({ kind: "note", detail: `runtime budget exhausted (${input.limits.maxRuntimeMs}ms) — ${skippedOverBudget} candidate(s) not processed`, data: null });
      break;
    }
    const item = input.candidates[i]!;
    const result = evaluateCandidatePipeline(
      { candidate: item.candidate, quote: item.quote, quoteFresh: item.quoteFresh, plannedSpendSol: item.plannedSpendSol },
      {
        mode: effectiveMode,
        policy: input.policy,
        escalationPolicy: input.escalationPolicy,
        escalationSession: session,
        riskAppetite: input.riskAppetite,
        nowMs: input.nowMs,
        timestamp: input.startedAt,
      },
    );

    sessionEvents.push({ kind: "candidate_observed", detail: `observed ${item.candidate.mint}`, data: { mint: item.candidate.mint, source: item.candidate.sourceKind } });
    alert({ kind: "candidate_found", detail: `candidate ${item.candidate.mint} (${item.candidate.sourceKind})` });
    if (result.strategy) {
      sessionEvents.push({
        kind: "risk_decision",
        detail: `${item.candidate.mint}: ${result.strategy.decision} (score ${result.strategy.score})`,
        data: { mint: item.candidate.mint, decision: result.strategy.decision, score: result.strategy.score, hardBlocks: result.strategy.hardBlocks },
      });
      if (result.strategy.hardBlocks.length > 0) {
        alert({ kind: "risk_rejected", detail: `${item.candidate.mint} risk-blocked: ${result.strategy.hardBlocks.slice(0, 4).join(", ")}` });
      }
    }
    sessionEvents.push({
      kind: "quote_refresh",
      detail: `${item.candidate.mint}: quote ${item.quote === null ? "missing" : item.quoteFresh === true ? "fresh" : item.quoteFresh === false ? "STALE" : "freshness-unknown"}`,
      data: { mint: item.candidate.mint, present: item.quote !== null, fresh: item.quoteFresh },
    });

    // Belt-and-braces: at most ONE canary recommendation per run, whatever the caps say.
    if (result.action === "prepare_canary_request" && recommended !== null) {
      results.push({ ...result, action: "paper_shadow", canaryPreparable: false, blockingReasons: [...result.blockingReasons, "one-canary-per-run-limit"] });
      continue;
    }

    if (result.action === "prepare_canary_request") {
      recommended = {
        mint: result.mint,
        symbol: item.candidate.symbol ?? null,
        score: result.strategy?.score ?? null,
        nextSteps: [...CANARY_NEXT_STEPS],
      };
      session.canariesThisSession = (session.canariesThisSession ?? 0) + 1;
      session.canariesToday = (session.canariesToday ?? 0) + 1;
      session.lastCanaryAtMs = input.nowMs;
      sessionEvents.push({ kind: "canary_recommended", detail: `RECOMMEND one tiny canary for ${result.mint} — human Phantom approval required; the backend prepared nothing and sends nothing`, data: { mint: result.mint, score: recommended.score } });
      alert({ kind: "canary_recommended", detail: `canary recommended for ${result.mint} — awaiting HUMAN Phantom approval (backend never sends)` });
      alert({ kind: "phantom_approval_pending", detail: `Phantom approval pending for ${result.mint} — a human must sign or reject in their own wallet` });
      sessionEvents.push({ kind: "phantom_approval_pending", detail: `awaiting human Phantom decision for ${result.mint}`, data: { mint: result.mint } });
    }
    results.push(result);
  }

  // --- Pause posture (durable, from the journal-derived session). ---
  const pauseReasons: string[] = [];
  if (pausedPendingRearm) pauseReasons.push("pause-pending-manual-rearm");
  if (pauseReasons.length > 0 && effectiveMode === "armed_canary") {
    sessionEvents.push({ kind: "note", detail: "armed run while paused — no canary can be recommended until a manual re-arm is recorded", data: null });
  }

  const totals = {
    candidatesSupplied: input.candidates.length,
    processed: results.length,
    skippedOverBudget,
    watch: results.filter((r) => r.action === "watch").length,
    paperShadow: results.filter((r) => r.action === "paper_shadow").length,
    blocked: results.filter((r) => r.action === "blocked").length,
    ignored: results.filter((r) => r.action === "ignore").length,
    canaryRecommended: recommended === null ? 0 : 1,
  };

  return {
    ...base,
    totals,
    results,
    recommendation: recommended,
    paused: pausedPendingRearm,
    pauseReasons,
    manualRearmRequiredToResume: pausedPendingRearm,
    sessionEvents,
    alerts,
  };
}

/**
 * Strictly validate a parsed run report: closed top level, pinned literals, and RECOMPUTED tallies
 * (a report whose totals disagree with its own results is refused).
 */
const REPORT_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "sessionId",
  "operatorLabel",
  "configMode",
  "requestedMode",
  "effectiveMode",
  "startedAt",
  "totals",
  "results",
  "recommendation",
  "paused",
  "pauseReasons",
  "manualRearmRequiredToResume",
  "sessionEvents",
  "alerts",
  "loopNeverSends",
  "backendCustodiesNoKeys",
  "backendNeverSends",
  "notProfitabilityClaim",
]);

export function validateOperatorRunReport(value: unknown): OperatorRunReport {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new OperatorLoopError("run report must be a JSON object");
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!REPORT_KEYS.has(key)) throw new OperatorLoopError(`run report carries unknown field "${key}" — the v1 schema is CLOSED`);
  }
  if (obj.schemaVersion !== LIVE_OPERATOR_RUN_REPORT_SCHEMA_VERSION) throw new OperatorLoopError(`run report schemaVersion must be "${LIVE_OPERATOR_RUN_REPORT_SCHEMA_VERSION}"`);
  for (const pin of ["loopNeverSends", "backendCustodiesNoKeys", "backendNeverSends", "notProfitabilityClaim"] as const) {
    if (obj[pin] !== true) throw new OperatorLoopError(`run report.${pin} must be the literal true`);
  }
  if (!Array.isArray(obj.results)) throw new OperatorLoopError("run report.results must be an array");
  const results = obj.results as Array<Record<string, unknown>>;
  const totals = obj.totals as Record<string, unknown> | null;
  if (totals === null || typeof totals !== "object") throw new OperatorLoopError("run report.totals must be an object");
  const countBy = (action: string): number => results.filter((r) => r.action === action).length;
  const recomputed = {
    processed: results.length,
    watch: countBy("watch"),
    paperShadow: countBy("paper_shadow"),
    blocked: countBy("blocked"),
    ignored: countBy("ignore"),
    canaryRecommended: countBy("prepare_canary_request"),
  };
  for (const [key, expected] of Object.entries(recomputed)) {
    if (totals[key] !== expected) throw new OperatorLoopError(`run report totals.${key} is ${String(totals[key])} but the results re-derive ${expected} — refused`);
  }
  if (recomputed.canaryRecommended > 1) throw new OperatorLoopError("run report claims more than one canary recommendation in a single run — refused");
  if (recomputed.canaryRecommended === 1 && obj.recommendation === null) throw new OperatorLoopError("run report has a canary result but no recommendation block — refused");
  if (recomputed.canaryRecommended === 0 && obj.recommendation !== null) throw new OperatorLoopError("run report carries a recommendation with no canary result backing it — refused");
  return obj as unknown as OperatorRunReport;
}
