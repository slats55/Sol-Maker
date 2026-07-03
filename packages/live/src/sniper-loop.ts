/**
 * THE AUTONOMOUS SNIPER LOOP (`live.sniper.loop.v1`, Sprint 108, Part 2).
 *
 * An operator-controlled state machine plus a PURE per-candidate pipeline. The loop discovers,
 * normalizes, risk-checks, scores, watchlists, refreshes quotes, evaluates policy + escalation, runs
 * paper-shadow, and — only in the explicitly-armed mode, only when every gate is green — RECOMMENDS
 * that a single tiny canary request be PREPARED. It does NOT prepare it, sign it, or send it: the
 * recommendation is consumed out-of-band by `live:canary:prepare`, which builds the UNSIGNED request
 * the human signs in Phantom.
 *
 * The two structural safety guarantees, both tested:
 *   1. `loopModeCanTrade(mode)` is `false` for EVERY mode. No mode trades. The loop's strongest
 *      possible output is `prepare_canary_request`, a recommendation; the human's Phantom signature
 *      is still the only thing that moves money.
 *   2. `prepare_canary_request` is reachable ONLY from `armed_canary` with the live policy fully
 *      green for a canary AND escalation permitting one more AND a fresh quote AND no risk block.
 *      Every other mode (off / observe_only / paper_shadow / paused / killed) can NEVER reach it.
 *
 * Pure: the caller supplies `nowMs` + `timestamp`; no clock, no network, no randomness, no I/O.
 */

import { evaluateEscalation } from "./escalation.js";
import type { EscalationSessionState, LiveEscalationPolicy } from "./escalation.js";
import { evaluateLivePolicy } from "./policy.js";
import type { LiveModePolicy, LivePolicyEvaluation } from "./policy.js";
import { scoreStrategyV2 } from "./strategy.js";
import type { StrategyQuoteFacts, StrategyRiskAppetite, StrategyScoreResult } from "./strategy.js";
import type { LiveCandidateThresholds } from "./candidate-score.js";
import type { DiscoveryEvent, SniperCandidate } from "./discovery.js";

export const LIVE_SNIPER_LOOP_SCHEMA_VERSION = "live.sniper.loop.v1";

/** The operator-controlled loop modes. Default is `off`; live behaviour requires an explicit arm. */
export const SNIPER_LOOP_MODES = ["off", "observe_only", "paper_shadow", "armed_canary", "paused", "killed"] as const;
export type SniperLoopMode = (typeof SNIPER_LOOP_MODES)[number];

export const SNIPER_LOOP_DEFAULT_MODE: SniperLoopMode = "off";

/** The ordered pipeline stages a candidate may pass through. */
export const SNIPER_LOOP_STAGES = [
  "discover",
  "normalize",
  "risk_precheck",
  "score",
  "watchlist",
  "refresh_quote",
  "enforce_freshness",
  "policy_eval",
  "paper_shadow",
  "mark_live_canary_candidate",
  "prepare_canary_request",
] as const;
export type SniperLoopStage = (typeof SNIPER_LOOP_STAGES)[number];

/** Operator events that move the loop between modes. The loop NEVER changes its own mode. */
export const SNIPER_LOOP_EVENTS = ["START", "ENABLE_PAPER_SHADOW", "ARM_CANARY", "DISARM", "PAUSE", "RESUME", "KILL", "RESET", "STOP"] as const;
export type SniperLoopEvent = (typeof SNIPER_LOOP_EVENTS)[number];

/**
 * Allowed mode transitions. Arming is a single explicit hop (`paper_shadow → armed_canary`); there
 * is no path that reaches `armed_canary` without first passing through paper-shadow and an explicit
 * ARM_CANARY. KILL is reachable from anywhere and only RESET leaves it.
 */
const MODE_TRANSITIONS: Readonly<Record<SniperLoopMode, Partial<Record<SniperLoopEvent, SniperLoopMode>>>> = {
  off: { START: "observe_only", KILL: "killed" },
  observe_only: {
    ENABLE_PAPER_SHADOW: "paper_shadow",
    PAUSE: "paused",
    STOP: "off",
    KILL: "killed",
  },
  paper_shadow: {
    ARM_CANARY: "armed_canary",
    PAUSE: "paused",
    STOP: "off",
    KILL: "killed",
  },
  armed_canary: {
    DISARM: "paper_shadow",
    PAUSE: "paused",
    STOP: "off",
    KILL: "killed",
  },
  paused: {
    // Resume always returns to the SAFE observe_only mode — re-arming requires the explicit hops again.
    RESUME: "observe_only",
    STOP: "off",
    KILL: "killed",
  },
  killed: {
    // Only an explicit RESET leaves the killed state, and only back to off.
    RESET: "off",
  },
};

export interface SniperLoopModeTransition {
  ok: boolean;
  mode: SniperLoopMode;
  error: string | null;
}

export function isSniperLoopMode(value: unknown): value is SniperLoopMode {
  return typeof value === "string" && (SNIPER_LOOP_MODES as readonly string[]).includes(value);
}

/** Apply one operator event to a mode. Illegal transitions are refused (mode unchanged). Pure. */
export function sniperLoopModeTransition(from: SniperLoopMode, event: SniperLoopEvent): SniperLoopModeTransition {
  if (!isSniperLoopMode(from)) return { ok: false, mode: from, error: `unknown loop mode "${String(from)}"` };
  if (!(SNIPER_LOOP_EVENTS as readonly string[]).includes(event)) return { ok: false, mode: from, error: `unknown loop event "${String(event)}"` };
  const next = MODE_TRANSITIONS[from][event];
  if (next === undefined) return { ok: false, mode: from, error: `event "${event}" is not legal from mode "${from}"` };
  return { ok: true, mode: next, error: null };
}

/** NO mode trades. The loop's strongest output is a recommendation to PREPARE a request. Always false. */
export function loopModeCanTrade(_mode: SniperLoopMode): false {
  void _mode;
  return false;
}

/** Only `armed_canary` may ever reach the prepare-canary recommendation. */
export function loopModeCanPrepareCanary(mode: SniperLoopMode): boolean {
  return mode === "armed_canary";
}

/** Whether the loop runs a paper-shadow simulation in this mode. */
export function loopModeRunsPaperShadow(mode: SniperLoopMode): boolean {
  return mode === "paper_shadow" || mode === "armed_canary";
}

/** Whether the loop does any candidate processing at all in this mode. */
export function loopModeProcesses(mode: SniperLoopMode): boolean {
  return mode === "observe_only" || mode === "paper_shadow" || mode === "armed_canary" || mode === "paused";
}

export const PIPELINE_ACTIONS = ["ignore", "watch", "paper_shadow", "prepare_canary_request", "blocked"] as const;
export type PipelineAction = (typeof PIPELINE_ACTIONS)[number];

export interface CandidatePipelineResult {
  schemaVersion: "live.sniper.pipeline.v1";
  mint: string;
  mode: SniperLoopMode;
  stagesRun: SniperLoopStage[];
  strategy: StrategyScoreResult | null;
  action: PipelineAction;
  /** Intrinsic eligibility: live candidate + no hard block + fresh quote (mode-independent). */
  canaryEligible: boolean;
  /** Eligible AND mode armed AND live policy green for canary AND escalation permits one more. */
  canaryPreparable: boolean;
  blockingReasons: string[];
  events: { event: DiscoveryEvent; detail: string }[];
  /** Pinned honesty literals. */
  notProfitabilityClaim: true;
  loopNeverSends: true;
}

export interface CandidatePipelineContext {
  mode: SniperLoopMode;
  policy: LiveModePolicy;
  /** Pre-computed `evaluateLivePolicy(policy)`; recomputed if absent. */
  policyEvaluation?: LivePolicyEvaluation;
  escalationPolicy: LiveEscalationPolicy;
  escalationSession?: EscalationSessionState;
  thresholds?: Partial<LiveCandidateThresholds>;
  riskAppetite?: StrategyRiskAppetite;
  /** Operator denylist (mints that can never be a live candidate). Defaults to the policy denylist. */
  denylist?: string[];
  /** Operator allowlist (null = no allowlist). Defaults to the policy allowlist. */
  allowlist?: string[] | null;
  nowMs: number;
  timestamp: string;
}

export interface CandidatePipelineInput {
  candidate: SniperCandidate;
  quote?: StrategyQuoteFacts | null;
  /** Whether the quote is within TTL. null = unknown (treated as not-fresh for a canary). */
  quoteFresh?: boolean | null;
  /** Planned canary spend in SOL, if known (checked against the escalation ceiling). */
  plannedSpendSol?: number | null;
}

/**
 * Run one candidate through the loop pipeline for the current mode. Returns the recommended action
 * and a full why-not trail. NEVER prepares, signs, or sends — `prepare_canary_request` is a
 * recommendation only, and is reachable solely from `armed_canary` with every gate green.
 */
export function evaluateCandidatePipeline(input: CandidatePipelineInput, ctx: CandidatePipelineContext): CandidatePipelineResult {
  const mint = input.candidate.mint;
  const base = {
    schemaVersion: "live.sniper.pipeline.v1" as const,
    mint,
    mode: ctx.mode,
    notProfitabilityClaim: true as const,
    loopNeverSends: true as const,
  };

  // off / killed: the loop processes nothing.
  if (!loopModeProcesses(ctx.mode)) {
    const reason = ctx.mode === "killed" ? "loop-killed" : "loop-off";
    return { ...base, stagesRun: [], strategy: null, action: "blocked", canaryEligible: false, canaryPreparable: false, blockingReasons: [reason], events: [] };
  }

  const stagesRun: SniperLoopStage[] = ["discover", "normalize", "risk_precheck", "score"];
  const events: { event: DiscoveryEvent; detail: string }[] = [];
  const blockingReasons: string[] = [];

  const denylist = ctx.denylist ?? ctx.policy.tokenDenylist;
  const allowlist = ctx.allowlist !== undefined ? ctx.allowlist : ctx.policy.tokenAllowlist;
  const strategy = scoreStrategyV2({
    candidate: input.candidate,
    quote: input.quote ?? null,
    thresholds: ctx.thresholds,
    riskAppetite: ctx.riskAppetite,
    denylisted: denylist.includes(mint),
    allowlisted: allowlist !== null && allowlist.includes(mint),
    timestamp: ctx.timestamp,
  });
  events.push({ event: "candidate-scored", detail: `decision=${strategy.decision} score=${strategy.score} confidence=${strategy.confidence}` });
  for (const code of strategy.hardBlocks) blockingReasons.push(code);
  if (strategy.hardBlocks.some((c) => c.startsWith("risk-") || c === "freeze-authority-present" || c === "mint-authority-present")) {
    events.push({ event: "candidate-risk-blocked", detail: strategy.hardBlocks.join(",") });
  }

  // Watchlist anything not ignored.
  if (strategy.decision !== "ignore") {
    stagesRun.push("watchlist");
    events.push({ event: "candidate-watchlisted", detail: `decision=${strategy.decision}` });
  }

  // Quote refresh + freshness.
  stagesRun.push("refresh_quote", "enforce_freshness");
  const quote = input.quote ?? null;
  const quoteFresh = input.quoteFresh ?? null;
  if (quote === null) blockingReasons.push("quote-missing");
  else {
    events.push({ event: "candidate-quote-ready", detail: `provider=${quote.provider ?? "unknown"}` });
    if (quoteFresh === false) blockingReasons.push("quote-stale");
    else if (quoteFresh === null) blockingReasons.push("quote-freshness-unknown");
  }

  // Policy evaluation (live-policy gate verdict).
  stagesRun.push("policy_eval");
  const policyEval = ctx.policyEvaluation ?? evaluateLivePolicy(ctx.policy);

  // Paper shadow runs in shadow + armed modes for any non-ignored candidate.
  const runsShadow = loopModeRunsPaperShadow(ctx.mode) && strategy.decision !== "ignore";
  if (runsShadow) stagesRun.push("paper_shadow");

  // Intrinsic canary eligibility (mode-independent): a clean live candidate with a fresh quote.
  const freshQuote = quote !== null && quoteFresh === true;
  const canaryEligible = strategy.decision === "live_canary_candidate" && strategy.hardBlocks.length === 0 && freshQuote;
  if (canaryEligible) stagesRun.push("mark_live_canary_candidate");

  // Escalation gate (only meaningful when the loop is armed).
  const escalation = evaluateEscalation({
    policy: ctx.escalationPolicy,
    session: ctx.escalationSession ?? {},
    nowMs: ctx.nowMs,
    plannedSpendSol: input.plannedSpendSol ?? null,
  });

  // Canary preparable requires EVERY gate: eligible + armed mode + live policy canary-green + escalation OK.
  let canaryPreparable = false;
  if (canaryEligible && loopModeCanPrepareCanary(ctx.mode)) {
    if (!policyEval.canaryArmAllowed) {
      for (const r of policyEval.blockingReasons) blockingReasons.push(`policy:${r}`);
    }
    if (!escalation.canaryAllowed) {
      for (const r of escalation.blockingReasons) blockingReasons.push(`escalation:${r}`);
    }
    canaryPreparable = policyEval.canaryArmAllowed && escalation.canaryAllowed;
  } else if (canaryEligible && !loopModeCanPrepareCanary(ctx.mode)) {
    blockingReasons.push(`mode:${ctx.mode}-cannot-prepare-canary`);
  }

  // Decide the action. prepare_canary_request is reachable ONLY when canaryPreparable.
  let action: PipelineAction;
  if (canaryPreparable) {
    stagesRun.push("prepare_canary_request");
    events.push({ event: "candidate-canary-eligible", detail: "all gates green — RECOMMEND preparing an unsigned Phantom canary request (human signs)" });
    action = "prepare_canary_request";
  } else if (runsShadow) {
    action = "paper_shadow";
  } else if (strategy.decision !== "ignore") {
    action = "watch";
  } else {
    action = "ignore";
  }

  return {
    ...base,
    stagesRun,
    strategy,
    action,
    canaryEligible,
    canaryPreparable,
    blockingReasons: dedupe(blockingReasons),
    events,
  };
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
