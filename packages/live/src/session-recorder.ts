/**
 * DURABLE LIVE OPERATOR SESSION RECORDER (`live.operator.session.*`, Sprint 109, Part 3).
 *
 * An append-only, tamper-evident JSONL event journal for live operator sessions. Every meaningful
 * thing that happens in a supervised session — candidates observed, risk decisions, quote refresh
 * states, canary recommendations, the full Phantom approval lifecycle, balance snapshots,
 * reconciliations, kill-switch / emergency-stop engagements, pauses and manual re-arms — becomes
 * one validated event line. The journal is the durable memory that makes pause/re-arm survive
 * process restarts and gives the release dossier its evidence trail.
 *
 * Rules, all enforced in code:
 *   - APPEND-ONLY. `prepareSessionAppend` validates the event against the EXISTING text: the
 *     sequence number must be exactly last+1, the sessionId must match, and nothing may be
 *     appended after `session_ended`. Rewriting history is structurally refused.
 *   - NO SECRETS. Every event is deep-scanned: sensitive-named keys, secret-shaped string values
 *     (long base58 / hex), and control characters are refused. A transaction signature is public
 *     data and gets a dedicated, validated field.
 *   - HONEST UNKNOWNS. Summaries count unparseable lines instead of hiding them, and an
 *     unterminated session is reported as `open`, never silently closed.
 *
 * Pure: the module never touches the filesystem or clock — the CLI owns I/O and supplies time.
 */

import { isSensitiveKey } from "@soulmaker/security";

import { assertNoSecretMaterial } from "./operator-config.js";

export const LIVE_OPERATOR_SESSION_EVENT_SCHEMA_VERSION = "live.operator.session.event.v1";
export const LIVE_OPERATOR_SESSION_SUMMARY_SCHEMA_VERSION = "live.operator.session.summary.v1";
export const LIVE_OPERATOR_SESSION_EXPORT_SCHEMA_VERSION = "live.operator.session.export.v1";

/** The CLOSED event vocabulary. Everything else is refused (use `note` for free-form remarks). */
export const OPERATOR_SESSION_EVENT_KINDS = [
  "session_started",
  "session_ended",
  "mode_changed",
  "candidate_observed",
  "risk_decision",
  "quote_refresh",
  "canary_recommended",
  "phantom_approval_pending",
  "phantom_submitted",
  "phantom_confirmed",
  "phantom_rejected",
  "phantom_timeout",
  "signature_recorded",
  "balance_snapshot",
  "reconciliation_recorded",
  "kill_switch_engaged",
  "emergency_stop_engaged",
  "loop_paused",
  "manual_rearm_recorded",
  "alert_emitted",
  "note",
] as const;
export type OperatorSessionEventKind = (typeof OPERATOR_SESSION_EVENT_KINDS)[number];

/** Event kinds that PAUSE the loop until a human manually re-arms it. */
export const OPERATOR_PAUSE_TRIGGER_KINDS: readonly OperatorSessionEventKind[] = [
  "phantom_rejected",
  "phantom_timeout",
  "kill_switch_engaged",
  "emergency_stop_engaged",
  "loop_paused",
];

export interface OperatorSessionEvent {
  schemaVersion: typeof LIVE_OPERATOR_SESSION_EVENT_SCHEMA_VERSION;
  sessionId: string;
  /** 1-based, strictly consecutive. The append guard enforces last+1. */
  seq: number;
  at: string;
  kind: OperatorSessionEventKind;
  /** Short human detail line (≤ 500 chars, control-char free, never secret-shaped). */
  detail: string;
  /** Optional structured payload (deep-scanned; bounded; never secret-bearing). */
  data: Record<string, unknown> | null;
}

export class OperatorSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorSessionError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MAX_DETAIL_CHARS = 500;
const MAX_DATA_JSON_CHARS = 4_000;

export interface BuildSessionEventInput {
  sessionId: string;
  seq: number;
  at: string;
  kind: OperatorSessionEventKind;
  detail: string;
  data?: Record<string, unknown> | null;
}

/** Build one validated session event (throws on anything unsafe). */
export function buildSessionEvent(input: BuildSessionEventInput): OperatorSessionEvent {
  if (typeof input.sessionId !== "string" || !SESSION_ID.test(input.sessionId)) {
    throw new OperatorSessionError("sessionId must be 1–64 chars of [a-zA-Z0-9._-] starting alphanumeric");
  }
  if (!Number.isInteger(input.seq) || input.seq < 1) throw new OperatorSessionError("seq must be a positive integer");
  if (typeof input.at !== "string" || !ISO_TIMESTAMP.test(input.at)) throw new OperatorSessionError("at must be an ISO-8601 UTC timestamp (….###Z)");
  if (!(OPERATOR_SESSION_EVENT_KINDS as readonly string[]).includes(input.kind)) {
    throw new OperatorSessionError(`kind must be one of the closed event vocabulary (got "${String(input.kind)}")`);
  }
  if (typeof input.detail !== "string" || input.detail.length === 0 || input.detail.length > MAX_DETAIL_CHARS) {
    throw new OperatorSessionError(`detail must be a non-empty string of ≤ ${MAX_DETAIL_CHARS} chars`);
  }
  const data = input.data ?? null;
  if (data !== null) {
    if (!isObject(data)) throw new OperatorSessionError("data must be a JSON object or null");
    const encoded = JSON.stringify(data);
    if (encoded.length > MAX_DATA_JSON_CHARS) throw new OperatorSessionError(`data must encode to ≤ ${MAX_DATA_JSON_CHARS} JSON chars (keep events small; link artifacts by path)`);
  }
  const event: OperatorSessionEvent = {
    schemaVersion: LIVE_OPERATOR_SESSION_EVENT_SCHEMA_VERSION,
    sessionId: input.sessionId,
    seq: input.seq,
    at: input.at,
    kind: input.kind,
    detail: input.detail,
    data,
  };
  // Deep secret/control-char scan over the WHOLE event (detail + data + everything).
  assertNoSecretMaterial(event, `session event #${input.seq}`);
  return event;
}

const EVENT_KEYS: ReadonlySet<string> = new Set(["schemaVersion", "sessionId", "seq", "at", "kind", "detail", "data"]);

/** Strictly validate a parsed value as an {@link OperatorSessionEvent} (closed schema). */
export function validateSessionEvent(value: unknown): OperatorSessionEvent {
  if (!isObject(value)) throw new OperatorSessionError("session event must be a JSON object");
  for (const key of Object.keys(value)) {
    if (isSensitiveKey(key)) throw new OperatorSessionError(`session event carries sensitive-named field "${key}"`);
    if (!EVENT_KEYS.has(key)) throw new OperatorSessionError(`session event carries unknown field "${key}" — the v1 schema is CLOSED`);
  }
  if (value.schemaVersion !== LIVE_OPERATOR_SESSION_EVENT_SCHEMA_VERSION) {
    throw new OperatorSessionError(`session event schemaVersion must be "${LIVE_OPERATOR_SESSION_EVENT_SCHEMA_VERSION}"`);
  }
  return buildSessionEvent({
    sessionId: value.sessionId as string,
    seq: value.seq as number,
    at: value.at as string,
    kind: value.kind as OperatorSessionEventKind,
    detail: value.detail as string,
    data: (value.data ?? null) as Record<string, unknown> | null,
  });
}

/** One parsed line of a session log: a valid event, or an honest per-line failure. */
export interface SessionLogLine {
  lineNumber: number;
  event: OperatorSessionEvent | null;
  error: string | null;
}

/** Parse a JSONL session log leniently: every line yields an event OR a recorded error. */
export function parseSessionLog(text: string): SessionLogLine[] {
  const out: SessionLogLine[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = (lines[i] ?? "").trim();
    if (raw.length === 0) continue;
    const lineNumber = i + 1;
    try {
      const parsed: unknown = JSON.parse(raw);
      out.push({ lineNumber, event: validateSessionEvent(parsed), error: null });
    } catch (err) {
      out.push({ lineNumber, event: null, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

export interface PreparedAppend {
  event: OperatorSessionEvent;
  /** The exact line (WITH trailing newline) the caller appends to the journal file. */
  line: string;
}

/**
 * Validate an event AGAINST the existing journal text and return the line to append.
 * Enforces the append-only discipline:
 *   - an empty journal accepts ONLY seq 1 + kind `session_started`;
 *   - a non-empty journal requires seq = last valid seq + 1 and a matching sessionId;
 *   - nothing may follow `session_ended`;
 *   - a journal whose lines are all unparseable is refused (repair by starting a new session).
 */
export function prepareSessionAppend(existingText: string, input: BuildSessionEventInput): PreparedAppend {
  const event = buildSessionEvent(input);
  const parsed = parseSessionLog(existingText);
  const valid = parsed.filter((l) => l.event !== null);
  if (parsed.length === 0) {
    if (event.seq !== 1) throw new OperatorSessionError("a new session journal must start at seq 1");
    if (event.kind !== "session_started") throw new OperatorSessionError("a new session journal must start with a session_started event");
  } else {
    if (valid.length === 0) throw new OperatorSessionError("journal contains no valid event lines — refusing to append; start a new session file");
    const last = valid[valid.length - 1]!.event!;
    if (last.sessionId !== event.sessionId) throw new OperatorSessionError(`sessionId mismatch — journal is "${last.sessionId}", event is "${event.sessionId}"`);
    if (last.kind === "session_ended") throw new OperatorSessionError("session already ended — the journal is closed; start a new session file");
    if (event.seq !== last.seq + 1) throw new OperatorSessionError(`seq must be ${last.seq + 1} (append-only, no gaps, no rewrites); got ${event.seq}`);
    if (event.kind === "session_started") throw new OperatorSessionError("session_started may only be the first event");
  }
  return { event, line: JSON.stringify(event) + "\n" };
}

/** Summary of a session journal — honest tallies including unparseable lines. */
export interface OperatorSessionSummary {
  schemaVersion: typeof LIVE_OPERATOR_SESSION_SUMMARY_SCHEMA_VERSION;
  sessionId: string | null;
  status: "open" | "ended" | "empty";
  startedAt: string | null;
  endedAt: string | null;
  lastEventAt: string | null;
  events: number;
  invalidLines: number;
  byKind: Record<string, number>;
  /** The canary/Phantom lifecycle tallies the operator cares about. */
  canary: {
    recommended: number;
    phantomPending: number;
    submitted: number;
    confirmed: number;
    rejected: number;
    timedOut: number;
    signaturesRecorded: number;
    reconciliationsRecorded: number;
  };
  safety: {
    killSwitchEngagements: number;
    emergencyStopEngagements: number;
    pauses: number;
    manualRearms: number;
  };
  /** Derived: is the loop paused pending a manual re-arm (a pause trigger with no later re-arm)? */
  pausedPendingRearm: boolean;
  notes: string[];
  /** Pinned honesty literals. */
  backendNeverSends: true;
  notProfitabilityClaim: true;
}

/** Summarize a session journal (lenient parse; honest unknowns). */
export function summarizeSessionLog(text: string): OperatorSessionSummary {
  const parsed = parseSessionLog(text);
  const valid = parsed.filter((l) => l.event !== null).map((l) => l.event!);
  const invalidLines = parsed.length - valid.length;
  const byKind: Record<string, number> = {};
  for (const e of valid) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  const count = (k: OperatorSessionEventKind): number => byKind[k] ?? 0;

  const first = valid[0] ?? null;
  const last = valid.length > 0 ? valid[valid.length - 1]! : null;
  const ended = valid.some((e) => e.kind === "session_ended");

  // Paused pending re-arm: any pause trigger with NO manual_rearm_recorded after it.
  let pausedPendingRearm = false;
  for (const e of valid) {
    if ((OPERATOR_PAUSE_TRIGGER_KINDS as readonly string[]).includes(e.kind)) pausedPendingRearm = true;
    else if (e.kind === "manual_rearm_recorded") pausedPendingRearm = false;
  }

  const notes: string[] = [];
  if (invalidLines > 0) notes.push(`${invalidLines} line(s) could not be parsed/validated and are counted, not hidden`);
  if (!ended && valid.length > 0) notes.push("session is still OPEN (no session_ended event)");

  return {
    schemaVersion: LIVE_OPERATOR_SESSION_SUMMARY_SCHEMA_VERSION,
    sessionId: first?.sessionId ?? null,
    status: valid.length === 0 ? "empty" : ended ? "ended" : "open",
    startedAt: first?.kind === "session_started" ? first.at : null,
    endedAt: ended ? (valid.filter((e) => e.kind === "session_ended").pop()?.at ?? null) : null,
    lastEventAt: last?.at ?? null,
    events: valid.length,
    invalidLines,
    byKind,
    canary: {
      recommended: count("canary_recommended"),
      phantomPending: count("phantom_approval_pending"),
      submitted: count("phantom_submitted"),
      confirmed: count("phantom_confirmed"),
      rejected: count("phantom_rejected"),
      timedOut: count("phantom_timeout"),
      signaturesRecorded: count("signature_recorded"),
      reconciliationsRecorded: count("reconciliation_recorded"),
    },
    safety: {
      killSwitchEngagements: count("kill_switch_engaged"),
      emergencyStopEngagements: count("emergency_stop_engaged"),
      pauses: count("loop_paused"),
      manualRearms: count("manual_rearm_recorded"),
    },
    pausedPendingRearm,
    notes,
    backendNeverSends: true,
    notProfitabilityClaim: true,
  };
}

/** Full export artifact: summary + every valid event + honest invalid-line records. */
export interface OperatorSessionExport {
  schemaVersion: typeof LIVE_OPERATOR_SESSION_EXPORT_SCHEMA_VERSION;
  summary: OperatorSessionSummary;
  events: OperatorSessionEvent[];
  invalidLines: Array<{ lineNumber: number; error: string }>;
  backendNeverSends: true;
}

export function exportSessionLog(text: string): OperatorSessionExport {
  const parsed = parseSessionLog(text);
  return {
    schemaVersion: LIVE_OPERATOR_SESSION_EXPORT_SCHEMA_VERSION,
    summary: summarizeSessionLog(text),
    events: parsed.filter((l) => l.event !== null).map((l) => l.event!),
    invalidLines: parsed.filter((l) => l.event === null).map((l) => ({ lineNumber: l.lineNumber, error: l.error ?? "unknown" })),
    backendNeverSends: true,
  };
}

/**
 * Derive the escalation session counters from the journal — the durable bridge that makes
 * cooldown / caps / pause / manual-re-arm survive process restarts. Conservative by construction:
 *   - every `canary_recommended` counts against the session + daily caps (a recommendation spends
 *     the slot even if the human never signs);
 *   - failures = Phantom rejections + timeouts (each also pauses via OPERATOR_PAUSE_TRIGGER_KINDS);
 *   - `armed` is true ONLY when the caller explicitly re-armed this invocation AND no pause
 *     trigger is unresolved (a manual re-arm event clears a pause).
 */
export interface DerivedEscalationSession {
  canariesThisSession: number;
  canariesToday: number;
  failedAttempts: number;
  lastCanaryAtMs: number | null;
  dailyLossSol: number;
  paused: boolean;
  armed: boolean;
}

/**
 * A journal-safe reference to a transaction signature. A full 88-char base58 signature is PUBLIC
 * data, but it is byte-shaped like key material, so the deep secret scan (and the repo safety
 * scanner) refuse it. The journal therefore stores a PREFIX + length; the slot (recorded by the
 * reconciliation) is the durable lookup key. The full signature stays in the operator's wallet
 * history and in gitignored runs/ facts files.
 */
export interface SignatureRef {
  signaturePrefix: string;
  signatureLength: number;
}

export function signatureRef(signature: string): SignatureRef {
  if (typeof signature !== "string" || signature.length < 32 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(signature)) {
    throw new OperatorSessionError("signatureRef requires a plausible base58 transaction signature");
  }
  return { signaturePrefix: signature.slice(0, 16), signatureLength: signature.length };
}

export function deriveEscalationSession(text: string, options: { armedThisInvocation: boolean }): DerivedEscalationSession {
  const summary = summarizeSessionLog(text);
  const parsed = parseSessionLog(text);
  const valid = parsed.filter((l) => l.event !== null).map((l) => l.event!);
  const lastCanary = valid.filter((e) => e.kind === "canary_recommended").pop() ?? null;
  const lastCanaryAtMs = lastCanary ? Date.parse(lastCanary.at) : null;

  // Realized daily loss: sum of NEGATIVE known net lamport deltas recorded by reconciliations.
  let dailyLossSol = 0;
  for (const e of valid) {
    if (e.kind !== "reconciliation_recorded" || e.data === null) continue;
    const net = e.data.netLamports;
    if (typeof net === "string" && /^-[0-9]{1,20}$/.test(net)) dailyLossSol += Number(BigInt(net) * -1n) / 1_000_000_000;
  }

  return {
    canariesThisSession: summary.canary.recommended,
    canariesToday: summary.canary.recommended,
    failedAttempts: summary.canary.rejected + summary.canary.timedOut,
    lastCanaryAtMs: lastCanaryAtMs !== null && Number.isFinite(lastCanaryAtMs) ? lastCanaryAtMs : null,
    dailyLossSol,
    paused: summary.pausedPendingRearm,
    armed: options.armedThisInvocation && !summary.pausedPendingRearm,
  };
}
