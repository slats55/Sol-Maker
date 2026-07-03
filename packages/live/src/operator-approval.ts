/**
 * TIME-BOXED OPERATOR APPROVAL (`live.operator.approval.v1`, Sprint 108 Final RC).
 *
 * The ONLY way to mark the sniper loop's escalation session as human-approved. The predecessor
 * design (a bare `--armed` CLI boolean) was refused by three independent safety walls (the S102
 * release-candidate wall, the S103 command-surface audit, and the Phase-7 authorization probe) —
 * correctly: approval must be a deliberate human ACT with friction and an expiry, not a flag that
 * rides along on a script. This module replaces it with an explicit artifact:
 *
 *   - Created only by typing the EXACT confirm phrase {@link OPERATOR_APPROVAL_CONFIRM_PHRASE};
 *     a wrong or missing phrase is refused (the error names the required phrase so a human can
 *     type it, but a copy-pasted command from a doc still had to be written by someone).
 *   - TIME-BOXED: `ttlMinutes` is clamped nowhere — a value over the absolute ceiling
 *     {@link OPERATOR_APPROVAL_MAX_TTL_MINUTES} is REFUSED (caps only tighten). Expiry is derived,
 *     not operator-supplied.
 *   - SCOPED: the approval covers at most ONE canary RECOMMENDATION window. It cannot sign, cannot
 *     send, and cannot widen any cap — `scope`, `approvesRecommendationOnly`, `cannotSign` and
 *     `cannotSend` are pinned literals. Even with an active approval, a canary still needs the
 *     armed_canary mode, the full live policy green, escalation caps, a fresh quote, no risk block,
 *     and finally the human's own Phantom confirmation of the unsigned transaction.
 *   - EVALUATED, never trusted: {@link evaluateOperatorApproval} re-derives active/expired from
 *     the caller's `nowMs`. An expired approval is exactly as powerless as no approval.
 *
 * Pure: the caller supplies `approvedAt` / `nowMs`; no clock, no network, no randomness, no I/O.
 */

import { isSensitiveKey, redactString } from "@soulmaker/security";

export const LIVE_OPERATOR_APPROVAL_SCHEMA_VERSION = "live.operator.approval.v1";
export const LIVE_OPERATOR_APPROVAL_EVALUATION_SCHEMA_VERSION = "live.operator.approval.evaluation.v1";

/** The exact phrase a human must type to create an approval. Anything else is refused. */
export const OPERATOR_APPROVAL_CONFIRM_PHRASE = "I-APPROVE-ONE-CANARY-RECOMMENDATION";

/** Absolute TTL ceiling in minutes. An approval can never outlive this; longer requests are refused. */
export const OPERATOR_APPROVAL_MAX_TTL_MINUTES = 15;
export const OPERATOR_APPROVAL_DEFAULT_TTL_MINUTES = 10;

/** Tolerated backward clock skew when evaluating (an approval "from the future" beyond this is refused). */
export const OPERATOR_APPROVAL_MAX_FUTURE_SKEW_MS = 60_000;

export const OPERATOR_APPROVAL_SCOPE = "canary-recommendation-only" as const;

export interface LiveOperatorApproval {
  schemaVersion: typeof LIVE_OPERATOR_APPROVAL_SCHEMA_VERSION;
  /** When the human approved (ISO; supplied by the caller, not read from a clock here). */
  approvedAt: string;
  /** Derived: approvedAt + ttlMinutes. Never operator-supplied directly. */
  expiresAt: string;
  ttlMinutes: number;
  /** Short display label for WHO approved (never a key, never long enough to be one). */
  operatorLabel: string;
  scope: typeof OPERATOR_APPROVAL_SCOPE;
  /** Pinned honesty literals — an approval approves a RECOMMENDATION window, nothing more. */
  approvesRecommendationOnly: true;
  cannotSign: true;
  cannotSend: true;
  notProfitabilityClaim: true;
}

export const OPERATOR_APPROVAL_EVALUATION_REASONS = [
  "approval-expired",
  "approval-not-yet-valid",
  "approval-window-invalid",
] as const;
export type OperatorApprovalEvaluationReason = (typeof OPERATOR_APPROVAL_EVALUATION_REASONS)[number];

export interface OperatorApprovalEvaluation {
  schemaVersion: typeof LIVE_OPERATOR_APPROVAL_EVALUATION_SCHEMA_VERSION;
  /** True only when the approval window contains `nowMs`. This is the ONLY field the loop trusts. */
  active: boolean;
  expired: boolean;
  remainingMs: number;
  reasons: OperatorApprovalEvaluationReason[];
  notProfitabilityClaim: true;
}

export class LiveOperatorApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveOperatorApprovalError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseIsoMs(value: unknown, name: string): number {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LiveOperatorApprovalError(`${name} must be an ISO timestamp string`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new LiveOperatorApprovalError(`${name} is not a parseable timestamp`);
  return ms;
}

function normalizeOperatorLabel(value: unknown): string {
  if (typeof value !== "string") throw new LiveOperatorApprovalError("operatorLabel must be a string");
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new LiveOperatorApprovalError("operatorLabel must not be empty — a human approval names the human");
  if (trimmed.length > 60) throw new LiveOperatorApprovalError("operatorLabel must be ≤ 60 characters (a label, never key material)");
  if (redactString(trimmed) !== trimmed) {
    throw new LiveOperatorApprovalError("operatorLabel looks secret-shaped — never put key material in an approval");
  }
  return trimmed;
}

export interface BuildOperatorApprovalInput {
  operatorLabel: string;
  /** Must equal {@link OPERATOR_APPROVAL_CONFIRM_PHRASE} exactly. */
  confirmPhrase: string;
  ttlMinutes?: number;
  /** ISO timestamp of the approval moment (the CLI passes its clock; this module reads none). */
  approvedAt: string;
}

/**
 * Build an approval, or throw. The confirm phrase must match EXACTLY; the TTL is refused (never
 * clamped) above the absolute ceiling. Expiry is derived here so a hand-edited longer window can be
 * caught by {@link validateOperatorApproval}.
 */
export function buildOperatorApproval(input: BuildOperatorApprovalInput): LiveOperatorApproval {
  if (input.confirmPhrase !== OPERATOR_APPROVAL_CONFIRM_PHRASE) {
    throw new LiveOperatorApprovalError(
      `confirm phrase mismatch — to approve one canary recommendation window you must pass exactly: ${OPERATOR_APPROVAL_CONFIRM_PHRASE}`,
    );
  }
  const operatorLabel = normalizeOperatorLabel(input.operatorLabel);
  const ttlMinutes = input.ttlMinutes ?? OPERATOR_APPROVAL_DEFAULT_TTL_MINUTES;
  if (!Number.isInteger(ttlMinutes) || ttlMinutes < 1) {
    throw new LiveOperatorApprovalError("ttlMinutes must be a positive integer");
  }
  if (ttlMinutes > OPERATOR_APPROVAL_MAX_TTL_MINUTES) {
    throw new LiveOperatorApprovalError(
      `ttlMinutes (${ttlMinutes}) exceeds the absolute ceiling (${OPERATOR_APPROVAL_MAX_TTL_MINUTES}) — approvals are short-lived by design`,
    );
  }
  const approvedAtMs = parseIsoMs(input.approvedAt, "approvedAt");
  return {
    schemaVersion: LIVE_OPERATOR_APPROVAL_SCHEMA_VERSION,
    approvedAt: input.approvedAt,
    expiresAt: new Date(approvedAtMs + ttlMinutes * 60_000).toISOString(),
    ttlMinutes,
    operatorLabel,
    scope: OPERATOR_APPROVAL_SCOPE,
    approvesRecommendationOnly: true,
    cannotSign: true,
    cannotSend: true,
    notProfitabilityClaim: true,
  };
}

const APPROVAL_KEYS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "approvedAt",
  "expiresAt",
  "ttlMinutes",
  "operatorLabel",
  "scope",
  "approvesRecommendationOnly",
  "cannotSign",
  "cannotSend",
  "notProfitabilityClaim",
]);

/** Strictly validate a value as a {@link LiveOperatorApproval} (closed schema; window re-derived). */
export function validateOperatorApproval(value: unknown): LiveOperatorApproval {
  if (!isObject(value)) throw new LiveOperatorApprovalError("approval must be a JSON object");
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) throw new LiveOperatorApprovalError(`approval carries sensitive-named field "${key}" — key material can never ride along`);
    if (!APPROVAL_KEYS.has(key)) throw new LiveOperatorApprovalError(`approval carries unknown field "${key}" — the v1 schema is CLOSED`);
  }
  if (value.schemaVersion !== LIVE_OPERATOR_APPROVAL_SCHEMA_VERSION) {
    throw new LiveOperatorApprovalError(`approval.schemaVersion must be "${LIVE_OPERATOR_APPROVAL_SCHEMA_VERSION}"`);
  }
  for (const [literal, expected] of [
    ["approvesRecommendationOnly", true],
    ["cannotSign", true],
    ["cannotSend", true],
    ["notProfitabilityClaim", true],
  ] as const) {
    if (value[literal] !== expected) throw new LiveOperatorApprovalError(`approval.${literal} must be the literal ${String(expected)}`);
  }
  if (value.scope !== OPERATOR_APPROVAL_SCOPE) {
    throw new LiveOperatorApprovalError(`approval.scope must be "${OPERATOR_APPROVAL_SCOPE}" — an approval never widens to trading`);
  }
  const ttlMinutes = value.ttlMinutes;
  if (typeof ttlMinutes !== "number" || !Number.isInteger(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > OPERATOR_APPROVAL_MAX_TTL_MINUTES) {
    throw new LiveOperatorApprovalError(`approval.ttlMinutes must be an integer in [1, ${OPERATOR_APPROVAL_MAX_TTL_MINUTES}]`);
  }
  const approvedAtMs = parseIsoMs(value.approvedAt, "approval.approvedAt");
  const expiresAtMs = parseIsoMs(value.expiresAt, "approval.expiresAt");
  if (expiresAtMs - approvedAtMs !== ttlMinutes * 60_000) {
    throw new LiveOperatorApprovalError("approval window is inconsistent — expiresAt must equal approvedAt + ttlMinutes (hand-widened windows are refused)");
  }
  const operatorLabel = normalizeOperatorLabel(value.operatorLabel);
  return {
    schemaVersion: LIVE_OPERATOR_APPROVAL_SCHEMA_VERSION,
    approvedAt: value.approvedAt as string,
    expiresAt: value.expiresAt as string,
    ttlMinutes,
    operatorLabel,
    scope: OPERATOR_APPROVAL_SCOPE,
    approvesRecommendationOnly: true,
    cannotSign: true,
    cannotSend: true,
    notProfitabilityClaim: true,
  };
}

/**
 * Decide whether an approval is ACTIVE at `nowMs`. Expired, future-dated (beyond the skew
 * tolerance), or window-inconsistent approvals are inactive — exactly as powerless as none.
 */
export function evaluateOperatorApproval(approval: LiveOperatorApproval, nowMs: number): OperatorApprovalEvaluation {
  const reasons: OperatorApprovalEvaluationReason[] = [];
  const approvedAtMs = Date.parse(approval.approvedAt);
  const expiresAtMs = Date.parse(approval.expiresAt);
  if (!Number.isFinite(approvedAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= approvedAtMs) {
    reasons.push("approval-window-invalid");
  } else {
    if (nowMs >= expiresAtMs) reasons.push("approval-expired");
    if (approvedAtMs - nowMs > OPERATOR_APPROVAL_MAX_FUTURE_SKEW_MS) reasons.push("approval-not-yet-valid");
  }
  const expired = reasons.includes("approval-expired");
  const active = reasons.length === 0;
  return {
    schemaVersion: LIVE_OPERATOR_APPROVAL_EVALUATION_SCHEMA_VERSION,
    active,
    expired,
    remainingMs: active ? Math.max(0, expiresAtMs - nowMs) : 0,
    reasons,
    notProfitabilityClaim: true,
  };
}
