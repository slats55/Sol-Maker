/**
 * POSITION LEDGER + EXIT RULES (`live.position.v1` / `live.exit.policy.v1`, Sprint 108 Final RC).
 *
 * The missing half of a sniper: not the entry, the EXIT. This module tracks positions and decides —
 * deterministically, transparently — when a position should be closed: stop-loss, take-profit,
 * trailing stop, time-based exit, kill switch, or operator emergency. It works identically for the
 * two kinds of position this system can honestly have:
 *
 *   - `paper`       — a simulated position opened from a paper-shadow `would_enter`. It never held
 *                     funds (`paperPositionNeverHeldFunds` is pinned) and may be closed automatically.
 *   - `live_canary` — a REAL tiny position the human opened by confirming a canary in Phantom.
 *                     The backend cannot sell what it cannot sign: an exit here is a RECOMMENDATION
 *                     (`closeKind: "operator-confirmed"` records the human's real close afterwards),
 *                     and an automatic close (`paper-auto`) is structurally REFUSED for this kind.
 *
 * Honesty contract:
 *   - A mark (current value) comes from a REAL sell-side quote the caller supplies. No mark → no
 *     stop-loss / take-profit / trailing evaluation; only time and emergency exits can fire, and the
 *     decision says `markUnavailable` instead of inventing a price.
 *   - PnL is reported ONLY when computable from entry + mark/close facts; totals sum known PnLs and
 *     count unknown ones separately. Never a fabricated profit. No profitability claim, ever.
 *   - Caps only tighten: entry spend is refused above the live position ceiling — PAPER TOO, so the
 *     paper ledger rehearses exactly what a live canary could do, never a fantasy size.
 *   - Duplicate-intent prevention: one OPEN position per (kind, mint); a second open is refused.
 *     Every position carries a deterministic `positionId` (idempotency key).
 *
 * Pure: the caller supplies every timestamp; no clock, no network, no randomness, no I/O.
 */

import { isSensitiveKey, redactString } from "@soulmaker/security";

import { LIVE_HARD_CEILINGS } from "./policy.js";
import { isValidMint } from "./discovery.js";

export const LIVE_POSITION_SCHEMA_VERSION = "live.position.v1";
export const LIVE_POSITION_LEDGER_SCHEMA_VERSION = "live.position.ledger.v1";
export const LIVE_EXIT_POLICY_SCHEMA_VERSION = "live.exit.policy.v1";
export const LIVE_EXIT_DECISION_SCHEMA_VERSION = "live.exit.decision.v1";

export const LAMPORTS_PER_SOL = 1_000_000_000;

/** Position kinds. `paper` may auto-close; `live_canary` closes only via an operator-confirmed fact. */
export const POSITION_KINDS = ["paper", "live_canary"] as const;
export type PositionKind = (typeof POSITION_KINDS)[number];

export const POSITION_STATUSES = ["open", "closed"] as const;
export type PositionStatus = (typeof POSITION_STATUSES)[number];

/** The closed set of exit reasons. Priority (first match wins) is the array order. */
export const EXIT_REASONS = ["emergency", "kill-switch", "stop-loss", "trailing-stop", "take-profit", "time-exit", "operator-manual"] as const;
export type ExitReason = (typeof EXIT_REASONS)[number];

/** How a close was applied. `paper-auto` is refused for live positions. */
export const CLOSE_KINDS = ["paper-auto", "operator-confirmed"] as const;
export type CloseKind = (typeof CLOSE_KINDS)[number];

/** Exit-policy hard bounds. A stop that can never fire and an unbounded hold are both refused. */
export const EXIT_POLICY_BOUNDS = {
  /** Stop-loss percent must be in (0, 90] — "lose everything before stopping" is not a policy. */
  maxStopLossPct: 90,
  /** Take-profit percent must be positive and ≤ 10000 (a 100x target is a config error, honest cap). */
  maxTakeProfitPct: 10_000,
  /** Trailing percent in (0, 90] when enabled. */
  maxTrailingStopPct: 90,
  /** Max hold ceiling: one UTC day. A canary is not a hodl. */
  maxMaxHoldMs: 86_400_000,
  /** Floor so a position cannot be configured to time-out instantly by accident. */
  minMaxHoldMs: 10_000,
} as const;

export const EXIT_POLICY_DEFAULTS = {
  stopLossPct: 20,
  takeProfitPct: 50,
  trailingStopPct: 15 as number | null,
  maxHoldMs: 1_800_000,
} as const;

export interface LiveExitPolicy {
  schemaVersion: typeof LIVE_EXIT_POLICY_SCHEMA_VERSION;
  /** Close when value falls this % below entry. */
  stopLossPct: number;
  /** Close when value rises this % above entry. */
  takeProfitPct: number;
  /** Close when value falls this % below the PEAK mark (null = trailing disabled). */
  trailingStopPct: number | null;
  /** Close when the position has been open this long, whatever the price. */
  maxHoldMs: number;
  notProfitabilityClaim: true;
}

/** A REAL sell-side observation: what the position's tokens would fetch, in lamports, right now. */
export interface PositionMark {
  /** Value of the whole position in lamports if sold at the observed quote. */
  valueLamports: number;
  atMs: number;
  /** Where the mark came from (provider id) — provenance, never invented. */
  source: string;
}

export interface PositionClose {
  closedAt: string;
  closeKind: CloseKind;
  reason: ExitReason;
  /** Value realized (paper: marked; live: operator-captured), when known. */
  valueLamports: number | null;
  /** Realized PnL in lamports (value - entry spend), when computable. */
  pnlLamports: number | null;
  detail: string;
}

export interface LivePosition {
  schemaVersion: typeof LIVE_POSITION_SCHEMA_VERSION;
  /** Deterministic idempotency key: `${kind}:${mint}:${openedAt}`. */
  positionId: string;
  kind: PositionKind;
  mint: string;
  symbol: string | null;
  status: PositionStatus;
  openedAt: string;
  /** Entry spend in lamports (≤ the live position ceiling — paper too, for parity). */
  entrySpendLamports: number;
  /** Token amount received (raw integer string; pass-through, never math'd). */
  tokenAmountRaw: string | null;
  /** Highest observed value since open (ratchets up only). Starts at entry spend. */
  peakValueLamports: number;
  /** Last observed value + when (null until first mark). */
  lastMark: { valueLamports: number; atMs: number; source: string } | null;
  close: PositionClose | null;
  /** Pinned honesty literals. */
  paperPositionNeverHeldFunds: boolean;
  notProfitabilityClaim: true;
}

export interface ExitDecision {
  schemaVersion: typeof LIVE_EXIT_DECISION_SCHEMA_VERSION;
  positionId: string;
  shouldExit: boolean;
  reason: ExitReason | null;
  /** True when SL/TP/trailing could not be evaluated because no mark exists. */
  markUnavailable: boolean;
  /** Unrealized PnL % vs entry, when a mark exists; else null. Not a prediction. */
  unrealizedPnlPct: number | null;
  heldMs: number;
  detail: string;
  /** For live positions the exit is a RECOMMENDATION — the human sells via Phantom. */
  exitIsRecommendationOnly: boolean;
  notProfitabilityClaim: true;
}

export class LivePositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LivePositionError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireSafePositiveInt(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new LivePositionError(`${name} must be a positive safe integer`);
  }
  return value;
}

function parseIsoMs(value: unknown, name: string): number {
  if (typeof value !== "string") throw new LivePositionError(`${name} must be an ISO timestamp string`);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new LivePositionError(`${name} is not a parseable timestamp`);
  return ms;
}

// ---------------------------------------------------------------------------
// Exit policy
// ---------------------------------------------------------------------------

export interface BuildExitPolicyInput {
  stopLossPct?: number;
  takeProfitPct?: number;
  trailingStopPct?: number | null;
  maxHoldMs?: number;
}

/** Normalize a partial config into a complete exit policy (or throw — bounds are refused, not clamped). */
export function buildExitPolicy(input: BuildExitPolicyInput = {}): LiveExitPolicy {
  const stopLossPct = input.stopLossPct ?? EXIT_POLICY_DEFAULTS.stopLossPct;
  if (!Number.isFinite(stopLossPct) || stopLossPct <= 0 || stopLossPct > EXIT_POLICY_BOUNDS.maxStopLossPct) {
    throw new LivePositionError(`stopLossPct must be in (0, ${EXIT_POLICY_BOUNDS.maxStopLossPct}] — a stop that can never fire is not a policy`);
  }
  const takeProfitPct = input.takeProfitPct ?? EXIT_POLICY_DEFAULTS.takeProfitPct;
  if (!Number.isFinite(takeProfitPct) || takeProfitPct <= 0 || takeProfitPct > EXIT_POLICY_BOUNDS.maxTakeProfitPct) {
    throw new LivePositionError(`takeProfitPct must be in (0, ${EXIT_POLICY_BOUNDS.maxTakeProfitPct}]`);
  }
  const trailingStopPct = input.trailingStopPct === undefined ? EXIT_POLICY_DEFAULTS.trailingStopPct : input.trailingStopPct;
  if (trailingStopPct !== null && (!Number.isFinite(trailingStopPct) || trailingStopPct <= 0 || trailingStopPct > EXIT_POLICY_BOUNDS.maxTrailingStopPct)) {
    throw new LivePositionError(`trailingStopPct must be null (disabled) or in (0, ${EXIT_POLICY_BOUNDS.maxTrailingStopPct}]`);
  }
  const maxHoldMs = input.maxHoldMs ?? EXIT_POLICY_DEFAULTS.maxHoldMs;
  if (!Number.isInteger(maxHoldMs) || maxHoldMs < EXIT_POLICY_BOUNDS.minMaxHoldMs || maxHoldMs > EXIT_POLICY_BOUNDS.maxMaxHoldMs) {
    throw new LivePositionError(`maxHoldMs must be an integer in [${EXIT_POLICY_BOUNDS.minMaxHoldMs}, ${EXIT_POLICY_BOUNDS.maxMaxHoldMs}] — a canary is time-boxed by design`);
  }
  return { schemaVersion: LIVE_EXIT_POLICY_SCHEMA_VERSION, stopLossPct, takeProfitPct, trailingStopPct, maxHoldMs, notProfitabilityClaim: true };
}

const EXIT_POLICY_KEYS: ReadonlySet<string> = new Set(["schemaVersion", "stopLossPct", "takeProfitPct", "trailingStopPct", "maxHoldMs", "notProfitabilityClaim"]);

/** Strictly validate an exit policy (closed schema; bounds re-applied). */
export function validateExitPolicy(value: unknown): LiveExitPolicy {
  if (!isObject(value)) throw new LivePositionError("exit policy must be a JSON object");
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) throw new LivePositionError(`exit policy carries sensitive-named field "${key}"`);
    if (!EXIT_POLICY_KEYS.has(key)) throw new LivePositionError(`exit policy carries unknown field "${key}" — the v1 schema is CLOSED`);
  }
  if (value.schemaVersion !== LIVE_EXIT_POLICY_SCHEMA_VERSION) {
    throw new LivePositionError(`exit policy.schemaVersion must be "${LIVE_EXIT_POLICY_SCHEMA_VERSION}"`);
  }
  return buildExitPolicy({
    stopLossPct: value.stopLossPct as number,
    takeProfitPct: value.takeProfitPct as number,
    trailingStopPct: value.trailingStopPct as number | null,
    maxHoldMs: value.maxHoldMs as number,
  });
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

/** The absolute per-position ceiling in lamports (paper parity with the live canary ceiling). */
export const POSITION_SPEND_CEILING_LAMPORTS = Math.round(LIVE_HARD_CEILINGS.maxPositionSol * LAMPORTS_PER_SOL);

export interface OpenPositionInput {
  kind: PositionKind;
  mint: string;
  symbol?: string | null;
  openedAt: string;
  entrySpendLamports: number;
  /** Token amount received (raw integer string), when known from the quote/confirmation. */
  tokenAmountRaw?: string | null;
}

/** Open a position (or throw). The spend ceiling applies to PAPER too — parity, not fantasy. */
export function openPosition(input: OpenPositionInput): LivePosition {
  if (!(POSITION_KINDS as readonly string[]).includes(input.kind)) {
    throw new LivePositionError(`kind must be one of ${POSITION_KINDS.join("|")}`);
  }
  if (!isValidMint(input.mint)) throw new LivePositionError("mint must be a valid base58 mint (never key material)");
  const entrySpendLamports = requireSafePositiveInt(input.entrySpendLamports, "entrySpendLamports");
  if (entrySpendLamports > POSITION_SPEND_CEILING_LAMPORTS) {
    throw new LivePositionError(
      `entrySpendLamports (${entrySpendLamports}) exceeds the position ceiling (${POSITION_SPEND_CEILING_LAMPORTS} = ${LIVE_HARD_CEILINGS.maxPositionSol} SOL) — paper rehearses only what live could do`,
    );
  }
  parseIsoMs(input.openedAt, "openedAt");
  let symbol: string | null = null;
  if (typeof input.symbol === "string" && input.symbol.trim().length > 0) {
    const trimmed = input.symbol.trim().slice(0, 32);
    symbol = redactString(trimmed) === trimmed ? trimmed : null;
  }
  let tokenAmountRaw: string | null = null;
  if (typeof input.tokenAmountRaw === "string" && /^[0-9]{1,38}$/.test(input.tokenAmountRaw)) tokenAmountRaw = input.tokenAmountRaw;
  return {
    schemaVersion: LIVE_POSITION_SCHEMA_VERSION,
    positionId: `${input.kind}:${input.mint}:${input.openedAt}`,
    kind: input.kind,
    mint: input.mint,
    symbol,
    status: "open",
    openedAt: input.openedAt,
    entrySpendLamports,
    tokenAmountRaw,
    peakValueLamports: entrySpendLamports,
    lastMark: null,
    close: null,
    paperPositionNeverHeldFunds: input.kind === "paper",
    notProfitabilityClaim: true,
  };
}

/** Apply a REAL sell-side mark. The peak ratchets up only; the mark is recorded verbatim. */
export function applyMark(position: LivePosition, mark: PositionMark): LivePosition {
  if (position.status !== "open") throw new LivePositionError(`cannot mark a ${position.status} position`);
  const valueLamports = requireSafePositiveInt(mark.valueLamports, "mark.valueLamports");
  if (!Number.isFinite(mark.atMs)) throw new LivePositionError("mark.atMs must be a finite ms timestamp");
  const source = typeof mark.source === "string" && mark.source.trim().length > 0 ? mark.source.trim().slice(0, 60) : "unknown";
  return {
    ...position,
    peakValueLamports: Math.max(position.peakValueLamports, valueLamports),
    lastMark: { valueLamports, atMs: mark.atMs, source },
  };
}

export interface EvaluateExitInput {
  position: LivePosition;
  policy: LiveExitPolicy;
  nowMs: number;
  /** Panic inputs — either forces an exit decision regardless of price. */
  killSwitch?: boolean;
  emergency?: boolean;
}

/**
 * Decide whether the position should exit NOW. Deterministic priority: emergency, kill-switch,
 * stop-loss, trailing-stop, take-profit, time-exit. Without a mark, price rules are honestly
 * skipped (`markUnavailable`) — never guessed.
 */
export function evaluateExitRules(input: EvaluateExitInput): ExitDecision {
  const { position, policy, nowMs } = input;
  if (position.status !== "open") {
    throw new LivePositionError("exit rules evaluate OPEN positions only");
  }
  const openedMs = parseIsoMs(position.openedAt, "position.openedAt");
  const heldMs = Math.max(0, nowMs - openedMs);
  const mark = position.lastMark;
  const markUnavailable = mark === null;
  const unrealizedPnlPct = mark === null ? null : Math.round(((mark.valueLamports - position.entrySpendLamports) / position.entrySpendLamports) * 10_000) / 100;

  const decide = (reason: ExitReason | null, detail: string): ExitDecision => ({
    schemaVersion: LIVE_EXIT_DECISION_SCHEMA_VERSION,
    positionId: position.positionId,
    shouldExit: reason !== null,
    reason,
    markUnavailable,
    unrealizedPnlPct,
    heldMs,
    detail,
    exitIsRecommendationOnly: position.kind === "live_canary",
    notProfitabilityClaim: true,
  });

  if (input.emergency === true) return decide("emergency", "operator emergency — close/recommend-close everything");
  if (input.killSwitch === true) return decide("kill-switch", "kill switch engaged — no position may stay open unmanaged");

  if (mark !== null) {
    const entry = position.entrySpendLamports;
    const stopFloor = entry * (1 - policy.stopLossPct / 100);
    if (mark.valueLamports <= stopFloor) {
      return decide("stop-loss", `value ${mark.valueLamports} ≤ stop floor ${Math.round(stopFloor)} (entry ${entry}, stop ${policy.stopLossPct}%)`);
    }
    if (policy.trailingStopPct !== null && position.peakValueLamports > entry) {
      const trailFloor = position.peakValueLamports * (1 - policy.trailingStopPct / 100);
      if (mark.valueLamports <= trailFloor) {
        return decide("trailing-stop", `value ${mark.valueLamports} ≤ trail floor ${Math.round(trailFloor)} (peak ${position.peakValueLamports}, trail ${policy.trailingStopPct}%)`);
      }
    }
    const profitCeil = entry * (1 + policy.takeProfitPct / 100);
    if (mark.valueLamports >= profitCeil) {
      return decide("take-profit", `value ${mark.valueLamports} ≥ target ${Math.round(profitCeil)} (entry ${entry}, take-profit ${policy.takeProfitPct}%)`);
    }
  }

  if (heldMs >= policy.maxHoldMs) {
    return decide("time-exit", `held ${heldMs}ms ≥ max hold ${policy.maxHoldMs}ms${markUnavailable ? " (no mark available — time rule still applies)" : ""}`);
  }

  return decide(null, markUnavailable ? "no mark available — price rules skipped honestly; holding within time box" : "no exit rule fired — holding");
}

export interface ClosePositionInput {
  position: LivePosition;
  closedAt: string;
  reason: ExitReason;
  closeKind: CloseKind;
  /** Realized value in lamports when known (paper: the mark used; live: operator-captured). */
  valueLamports?: number | null;
  detail?: string;
}

/**
 * Close a position. `paper-auto` is REFUSED for `live_canary` positions — the backend cannot sell
 * what it cannot sign; a live close records the human's real, already-executed Phantom close.
 */
export function closePosition(input: ClosePositionInput): LivePosition {
  const { position } = input;
  if (position.status !== "open") throw new LivePositionError("position is already closed");
  if (!(EXIT_REASONS as readonly string[]).includes(input.reason)) {
    throw new LivePositionError(`reason must be one of ${EXIT_REASONS.join("|")}`);
  }
  if (!(CLOSE_KINDS as readonly string[]).includes(input.closeKind)) {
    throw new LivePositionError(`closeKind must be one of ${CLOSE_KINDS.join("|")}`);
  }
  if (position.kind === "live_canary" && input.closeKind === "paper-auto") {
    throw new LivePositionError("a live_canary position can NEVER be auto-closed — the human sells in Phantom, then records the close as operator-confirmed");
  }
  parseIsoMs(input.closedAt, "closedAt");
  let valueLamports: number | null = null;
  if (input.valueLamports !== undefined && input.valueLamports !== null) {
    valueLamports = requireSafePositiveInt(input.valueLamports, "valueLamports");
  }
  const pnlLamports = valueLamports === null ? null : valueLamports - position.entrySpendLamports;
  return {
    ...position,
    status: "closed",
    close: {
      closedAt: input.closedAt,
      closeKind: input.closeKind,
      reason: input.reason,
      valueLamports,
      pnlLamports,
      detail: (input.detail ?? "").slice(0, 200),
    },
  };
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export interface PositionLedger {
  schemaVersion: typeof LIVE_POSITION_LEDGER_SCHEMA_VERSION;
  positions: LivePosition[];
  totals: {
    open: number;
    closed: number;
    /** Sum of KNOWN realized PnLs only. */
    realizedPnlKnownLamports: number;
    /** Closes whose PnL is unknown (no realized value captured) — counted, never guessed. */
    closedPnlUnknown: number;
  };
  notProfitabilityClaim: true;
}

export function buildLedger(positions: readonly LivePosition[] = []): PositionLedger {
  // Duplicate-intent wall: one OPEN position per (kind, mint).
  const openKeys = new Set<string>();
  for (const p of positions) {
    if (p.status !== "open") continue;
    const key = `${p.kind}:${p.mint}`;
    if (openKeys.has(key)) throw new LivePositionError(`duplicate OPEN position for ${key} — duplicate intents are refused`);
    openKeys.add(key);
  }
  const closed = positions.filter((p) => p.status === "closed");
  const known = closed.filter((p) => p.close?.pnlLamports !== null && p.close?.pnlLamports !== undefined);
  return {
    schemaVersion: LIVE_POSITION_LEDGER_SCHEMA_VERSION,
    positions: [...positions],
    totals: {
      open: positions.length - closed.length,
      closed: closed.length,
      realizedPnlKnownLamports: known.reduce((sum, p) => sum + (p.close?.pnlLamports ?? 0), 0),
      closedPnlUnknown: closed.length - known.length,
    },
    notProfitabilityClaim: true,
  };
}

/** Add a new position to a ledger; a second OPEN position for the same (kind, mint) is refused. */
export function ledgerOpen(ledger: PositionLedger, position: LivePosition): PositionLedger {
  return buildLedger([...ledger.positions, position]);
}

/** Replace a position (matched by positionId) after a mark/close. Unknown ids are refused. */
export function ledgerReplace(ledger: PositionLedger, updated: LivePosition): PositionLedger {
  const idx = ledger.positions.findIndex((p) => p.positionId === updated.positionId);
  if (idx < 0) throw new LivePositionError(`unknown positionId "${updated.positionId}"`);
  const next = [...ledger.positions];
  next[idx] = updated;
  return buildLedger(next);
}

const LEDGER_KEYS: ReadonlySet<string> = new Set(["schemaVersion", "positions", "totals", "notProfitabilityClaim"]);
const POSITION_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "positionId",
  "kind",
  "mint",
  "symbol",
  "status",
  "openedAt",
  "entrySpendLamports",
  "tokenAmountRaw",
  "peakValueLamports",
  "lastMark",
  "close",
  "paperPositionNeverHeldFunds",
  "notProfitabilityClaim",
]);

/** Strictly validate a persisted ledger (closed schemas; totals RECOMPUTED, never trusted). */
export function validateLedger(value: unknown): PositionLedger {
  if (!isObject(value)) throw new LivePositionError("ledger must be a JSON object");
  for (const key of Object.keys(value)) {
    if (!LEDGER_KEYS.has(key)) throw new LivePositionError(`ledger carries unknown field "${key}" — the v1 schema is CLOSED`);
  }
  if (value.schemaVersion !== LIVE_POSITION_LEDGER_SCHEMA_VERSION) {
    throw new LivePositionError(`ledger.schemaVersion must be "${LIVE_POSITION_LEDGER_SCHEMA_VERSION}"`);
  }
  if (!Array.isArray(value.positions)) throw new LivePositionError("ledger.positions must be an array");
  const positions = value.positions.map((raw, i) => validatePosition(raw, `positions[${i}]`));
  return buildLedger(positions);
}

function validatePosition(value: unknown, label: string): LivePosition {
  if (!isObject(value)) throw new LivePositionError(`${label} must be a JSON object`);
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) throw new LivePositionError(`${label} carries sensitive-named field "${key}"`);
    if (!POSITION_KEYS.has(key)) throw new LivePositionError(`${label} carries unknown field "${key}" — the v1 schema is CLOSED`);
  }
  if (value.schemaVersion !== LIVE_POSITION_SCHEMA_VERSION) throw new LivePositionError(`${label}.schemaVersion must be "${LIVE_POSITION_SCHEMA_VERSION}"`);
  if (!(POSITION_KINDS as readonly string[]).includes(value.kind as string)) throw new LivePositionError(`${label}.kind is invalid`);
  if (!(POSITION_STATUSES as readonly string[]).includes(value.status as string)) throw new LivePositionError(`${label}.status is invalid`);
  if (!isValidMint(value.mint)) throw new LivePositionError(`${label}.mint is not a valid mint`);
  const base = openPosition({
    kind: value.kind as PositionKind,
    mint: value.mint as string,
    symbol: (value.symbol as string | null) ?? null,
    openedAt: value.openedAt as string,
    entrySpendLamports: value.entrySpendLamports as number,
    tokenAmountRaw: (value.tokenAmountRaw as string | null) ?? null,
  });
  if (value.positionId !== base.positionId) {
    throw new LivePositionError(`${label}.positionId does not match its derivation — tampered ids are refused`);
  }
  let position = base;
  if (value.lastMark !== null && value.lastMark !== undefined) {
    const m = value.lastMark as Record<string, unknown>;
    position = applyMark(position, { valueLamports: m.valueLamports as number, atMs: m.atMs as number, source: m.source as string });
  }
  // Peak may legitimately exceed the last mark (ratchet) — restore it, but never below entry/mark.
  if (typeof value.peakValueLamports === "number" && Number.isSafeInteger(value.peakValueLamports)) {
    position = { ...position, peakValueLamports: Math.max(position.peakValueLamports, value.peakValueLamports) };
  }
  if (value.status === "closed") {
    const c = value.close;
    if (!isObject(c)) throw new LivePositionError(`${label} is closed but carries no close record`);
    position = closePosition({
      position,
      closedAt: c.closedAt as string,
      reason: c.reason as ExitReason,
      closeKind: c.closeKind as CloseKind,
      valueLamports: (c.valueLamports as number | null) ?? null,
      detail: (c.detail as string) ?? "",
    });
  }
  return position;
}
