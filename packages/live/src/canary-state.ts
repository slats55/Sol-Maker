/**
 * The CANARY STATE MACHINE (Sprint 107, Part 1).
 *
 * A pure reducer over a CLOSED set of canary states. It models the full lifecycle of a single
 * tiny, human-confirmed live trade — from the backend's prepared request through the browser's
 * Phantom signature to on-chain reconciliation. The backend can only ever reach the "ready" and
 * "blocked" states; everything from "phantom_requested" onward is driven by the browser client
 * reporting what the human and the chain actually did.
 *
 * The reducer NEVER advances state on its own and NEVER fabricates a signature. Illegal
 * transitions are refused (the state is unchanged and an error is returned). No clock, no network.
 */

export const CANARY_STATES = [
  "blocked_by_policy",
  "blocked_by_risk",
  "quote_ready",
  "preflight_ready",
  "phantom_requested",
  "user_rejected",
  "submitted",
  "confirmed",
  "failed",
  "reconciled",
] as const;
export type CanaryState = (typeof CANARY_STATES)[number];

/** States from which no further transition is possible. */
export const CANARY_TERMINAL_STATES: ReadonlySet<CanaryState> = new Set<CanaryState>([
  "blocked_by_policy",
  "blocked_by_risk",
  "user_rejected",
  "failed",
  "reconciled",
]);

export const CANARY_EVENTS = [
  "RISK_BLOCK",
  "SIMULATION_OK",
  "ARM_AND_REQUEST_PHANTOM",
  "PHANTOM_REJECTED",
  "PHANTOM_SUBMITTED",
  "SUBMIT_CONFIRMED",
  "SUBMIT_FAILED",
  "RECONCILED",
] as const;
export type CanaryEvent = (typeof CANARY_EVENTS)[number];

/**
 * Allowed transitions. A target state is reachable from a source only if the event is listed here.
 * Read it as: "in state X, event E moves to state Y".
 */
const TRANSITIONS: Readonly<Record<CanaryState, Partial<Record<CanaryEvent, CanaryState>>>> = {
  quote_ready: {
    SIMULATION_OK: "preflight_ready",
    RISK_BLOCK: "blocked_by_risk",
  },
  preflight_ready: {
    ARM_AND_REQUEST_PHANTOM: "phantom_requested",
    RISK_BLOCK: "blocked_by_risk",
  },
  phantom_requested: {
    PHANTOM_REJECTED: "user_rejected",
    PHANTOM_SUBMITTED: "submitted",
    SUBMIT_FAILED: "failed",
  },
  submitted: {
    SUBMIT_CONFIRMED: "confirmed",
    SUBMIT_FAILED: "failed",
  },
  confirmed: {
    RECONCILED: "reconciled",
  },
  // Terminal states: no outgoing transitions.
  blocked_by_policy: {},
  blocked_by_risk: {},
  user_rejected: {},
  failed: {},
  reconciled: {},
};

export interface CanaryTransitionResult {
  ok: boolean;
  state: CanaryState;
  /** Present when ok is false. */
  error: string | null;
}

export function isCanaryState(value: unknown): value is CanaryState {
  return typeof value === "string" && (CANARY_STATES as readonly string[]).includes(value);
}

export function isCanaryTerminal(state: CanaryState): boolean {
  return CANARY_TERMINAL_STATES.has(state);
}

/**
 * Apply one event to a state. Returns the next state on a legal transition, or the unchanged state
 * plus an error on an illegal one. Pure — no side effects.
 */
export function canaryTransition(from: CanaryState, event: CanaryEvent): CanaryTransitionResult {
  if (!isCanaryState(from)) {
    return { ok: false, state: from, error: `unknown canary state "${String(from)}"` };
  }
  if (!(CANARY_EVENTS as readonly string[]).includes(event)) {
    return { ok: false, state: from, error: `unknown canary event "${String(event)}"` };
  }
  const next = TRANSITIONS[from][event];
  if (next === undefined) {
    return { ok: false, state: from, error: `event "${event}" is not legal from state "${from}"` };
  }
  return { ok: true, state: next, error: null };
}

/** Replay a sequence of events from a start state, stopping at the first illegal transition. */
export function canaryReplay(from: CanaryState, events: readonly CanaryEvent[]): CanaryTransitionResult {
  let state = from;
  for (const event of events) {
    const result = canaryTransition(state, event);
    if (!result.ok) return result;
    state = result.state;
  }
  return { ok: true, state, error: null };
}
