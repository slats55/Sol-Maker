/**
 * EXECUTION SESSION LEDGER + CONTINUATION WALL (Sprint 96) — the accounting safety wall: every
 * execution attempt and every reconciliation is recorded as one append-only JSONL entry, and a
 * NEW execution attempt is allowed ONLY when the latest relevant session is fully accounted for.
 *
 * Fail-closed by construction:
 *   - a ledger that cannot be fully parsed blocks (unknown is never treated as clean);
 *   - an attempt with no reconciliation entry blocks (sent-but-unaccounted is the exact failure
 *     mode this wall exists to stop);
 *   - there is NO bypass flag — the only exits are a real reconciliation (observed data) or an
 *     explicit, audited manual acknowledgment that itself becomes a ledger entry.
 *
 * This module is PURE (parse + evaluate + build entries); file IO lives with the caller so the
 * ledger location stays under the gitignored runs/ artifact system.
 */

import { RECONCILIATION_VERDICTS } from "./reconciliation.js";
import type { ReconciliationVerdict } from "./reconciliation.js";

export const SESSION_LEDGER_ENTRY_SCHEMA_VERSION = "execution.session.ledger.entry.v1";

/** The conventional ledger file name under the gitignored runs/ directory. */
export const SESSION_LEDGER_FILE_NAME = "execution-sessions.jsonl";

export const SESSION_LEDGER_ENTRY_KINDS = ["execution-attempt", "reconciliation", "manual-acknowledgment"] as const;
export type SessionLedgerEntryKind = (typeof SESSION_LEDGER_ENTRY_KINDS)[number];

export interface SessionLedgerEntry {
  schemaVersion: string;
  kind: SessionLedgerEntryKind;
  sessionId: string;
  recordedAt: string;
  network: string;
  /** The CLI command that produced this entry (provenance, not authorization). */
  command: string;
  /** PUBLIC signer key of the attempt; never key material. */
  signerPublicKey: string | null;
  /** Transaction signature when one was submitted (public chain data). */
  signature: string | null;
  /** The attempt's outcome literal (e.g. a rehearsal outcome); null on non-attempt entries. */
  executionOutcome: string | null;
  /** Balance observed at attempt time (lamports); lets a post-hoc reconcile anchor its "pre". */
  balanceLamportsAtAttempt: number | null;
  /** The reconciliation verdict; null on non-reconciliation entries. */
  reconciliationVerdict: ReconciliationVerdict | null;
  /** Relative path of the produced artifact, when one was written. */
  reportPath: string | null;
  /** The REQUIRED operator reason on a manual acknowledgment; null otherwise. */
  reason: string | null;
}

export interface CreateSessionLedgerEntryInput {
  kind: SessionLedgerEntryKind;
  sessionId: string;
  recordedAt: string;
  network: string;
  command: string;
  signerPublicKey?: string | null;
  signature?: string | null;
  executionOutcome?: string | null;
  balanceLamportsAtAttempt?: number | null;
  reconciliationVerdict?: ReconciliationVerdict | null;
  reportPath?: string | null;
  reason?: string | null;
}

/** Build one normalized ledger entry. Throws on structurally invalid input — never half-records. */
export function createSessionLedgerEntry(input: CreateSessionLedgerEntryInput): SessionLedgerEntry {
  if (!SESSION_LEDGER_ENTRY_KINDS.includes(input.kind)) {
    throw new Error(`session ledger entry kind must be one of: ${SESSION_LEDGER_ENTRY_KINDS.join(", ")}`);
  }
  for (const [field, value] of [
    ["sessionId", input.sessionId],
    ["recordedAt", input.recordedAt],
    ["network", input.network],
    ["command", input.command],
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`session ledger entry requires a non-empty ${field}`);
    }
  }
  if (input.kind === "manual-acknowledgment" && (typeof input.reason !== "string" || input.reason.trim().length < 10)) {
    throw new Error("a manual acknowledgment requires an explicit reason (at least 10 characters)");
  }
  if (
    input.kind === "reconciliation" &&
    (input.reconciliationVerdict == null || !RECONCILIATION_VERDICTS.includes(input.reconciliationVerdict))
  ) {
    throw new Error("a reconciliation entry requires a verdict from the closed verdict set");
  }
  return Object.freeze({
    schemaVersion: SESSION_LEDGER_ENTRY_SCHEMA_VERSION,
    kind: input.kind,
    sessionId: input.sessionId,
    recordedAt: input.recordedAt,
    network: input.network,
    command: input.command,
    signerPublicKey: input.signerPublicKey ?? null,
    signature: input.signature ?? null,
    executionOutcome: input.executionOutcome ?? null,
    balanceLamportsAtAttempt: input.balanceLamportsAtAttempt ?? null,
    reconciliationVerdict: input.reconciliationVerdict ?? null,
    reportPath: input.reportPath ?? null,
    reason: input.reason ?? null,
  });
}

/** Derive a deterministic session id from public attempt facts (no randomness, no secrets). */
export function deriveSessionId(input: { network: string; startedAt: string; signerPublicKey: string | null }): string {
  const keyPart = input.signerPublicKey === null ? "unsigned" : input.signerPublicKey.slice(0, 8);
  return `${input.network}:${input.startedAt}:${keyPart}`;
}

export interface ParsedSessionLedger {
  entries: SessionLedgerEntry[];
  /** Lines that failed to parse or validate. ANY malformed line fails the wall closed. */
  malformedLines: number;
}

/** Parse a JSONL ledger text. Tolerant line-by-line; malformed lines are COUNTED, never dropped silently. */
export function parseSessionLedger(text: string): ParsedSessionLedger {
  const entries: SessionLedgerEntry[] = [];
  let malformedLines = 0;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/^\uFEFF/, "").trim();
    if (line.length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      malformedLines += 1;
      continue;
    }
    const rec = value as Partial<SessionLedgerEntry> | null;
    if (
      rec === null ||
      typeof rec !== "object" ||
      rec.schemaVersion !== SESSION_LEDGER_ENTRY_SCHEMA_VERSION ||
      !SESSION_LEDGER_ENTRY_KINDS.includes(rec.kind as SessionLedgerEntryKind) ||
      typeof rec.sessionId !== "string" ||
      rec.sessionId.length === 0 ||
      typeof rec.network !== "string" ||
      rec.network.length === 0 ||
      typeof rec.recordedAt !== "string" ||
      typeof rec.command !== "string" ||
      (rec.kind === "reconciliation" &&
        !RECONCILIATION_VERDICTS.includes(rec.reconciliationVerdict as ReconciliationVerdict))
    ) {
      malformedLines += 1;
      continue;
    }
    entries.push({
      schemaVersion: SESSION_LEDGER_ENTRY_SCHEMA_VERSION,
      kind: rec.kind as SessionLedgerEntryKind,
      sessionId: rec.sessionId,
      recordedAt: rec.recordedAt,
      network: rec.network,
      command: rec.command,
      signerPublicKey: typeof rec.signerPublicKey === "string" ? rec.signerPublicKey : null,
      signature: typeof rec.signature === "string" ? rec.signature : null,
      executionOutcome: typeof rec.executionOutcome === "string" ? rec.executionOutcome : null,
      balanceLamportsAtAttempt:
        typeof rec.balanceLamportsAtAttempt === "number" && Number.isFinite(rec.balanceLamportsAtAttempt)
          ? rec.balanceLamportsAtAttempt
          : null,
      reconciliationVerdict: (rec.reconciliationVerdict as ReconciliationVerdict | undefined) ?? null,
      reportPath: typeof rec.reportPath === "string" ? rec.reportPath : null,
      reason: typeof rec.reason === "string" ? rec.reason : null,
    });
  }
  return { entries, malformedLines };
}

export const SESSION_CONTINUATION_STATUSES = [
  "no-prior-session",
  "manually-acknowledged",
  "unknown",
  ...RECONCILIATION_VERDICTS,
] as const;
export type SessionContinuationStatus = (typeof SESSION_CONTINUATION_STATUSES)[number];

/** The ONLY statuses after which a new execution attempt proceeds. Closed; everything else blocks. */
export const SESSION_CONTINUATION_ALLOWED_STATUSES: readonly SessionContinuationStatus[] = [
  "no-prior-session",
  "manually-acknowledged",
  "reconciled",
  "not-sent",
  "funding-blocked",
];

export interface SessionContinuationDecision {
  allowed: boolean;
  status: SessionContinuationStatus;
  sessionId: string | null;
  blockedReason: string | null;
  nextSafeAction: string;
}

export interface EvaluateSessionContinuationInput {
  entries: SessionLedgerEntry[];
  malformedLines?: number;
  network: string;
}

const RECONCILE_NEXT = "Run `pnpm soulmaker execution:session:reconcile --ledger <ledger> --out <dir>` to account for the previous attempt with real observed data.";
const ACKNOWLEDGE_NEXT =
  "If the session is genuinely abandoned, acknowledge it explicitly: `pnpm soulmaker execution:session:acknowledge --ledger <ledger> --reason \"...\" --acknowledge-unreconciled-session` (audited; appends a ledger entry).";

/**
 * Decide whether a NEW execution attempt may proceed, from the latest relevant session's state.
 * Pure and fail-closed: malformed ledgers, unknown outcomes, and unaccounted attempts all block.
 */
export function evaluateSessionContinuation(input: EvaluateSessionContinuationInput): SessionContinuationDecision {
  const decide = (
    allowed: boolean,
    status: SessionContinuationStatus,
    sessionId: string | null,
    blockedReason: string | null,
    nextSafeAction: string,
  ): SessionContinuationDecision => ({ allowed, status, sessionId, blockedReason, nextSafeAction });

  if ((input.malformedLines ?? 0) > 0) {
    return decide(
      false,
      "unknown",
      null,
      `the session ledger could not be fully parsed (${input.malformedLines} malformed line(s)) — fail closed`,
      `Inspect the ledger file by hand and repair or archive it; a partially readable accounting trail never authorizes execution. ${ACKNOWLEDGE_NEXT}`,
    );
  }
  const relevant = input.entries.filter((e) => e.network === input.network);
  if (relevant.length === 0) {
    return decide(true, "no-prior-session", null, null, "No prior execution session on this network — proceed.");
  }
  const last = relevant[relevant.length - 1];
  if (last === undefined) {
    return decide(true, "no-prior-session", null, null, "No prior execution session on this network — proceed.");
  }
  const latestSessionId = last.sessionId;
  const session = relevant.filter((e) => e.sessionId === latestSessionId);
  const latest = session[session.length - 1] ?? last;

  if (latest.kind === "manual-acknowledgment") {
    return decide(
      true,
      "manually-acknowledged",
      latestSessionId,
      null,
      "The previous session was explicitly acknowledged (audited in the ledger) — proceed.",
    );
  }
  if (latest.kind === "reconciliation") {
    const verdict = latest.reconciliationVerdict as ReconciliationVerdict;
    const allowed = SESSION_CONTINUATION_ALLOWED_STATUSES.includes(verdict);
    return decide(
      allowed,
      verdict,
      latestSessionId,
      allowed ? null : `the latest reconciliation verdict is "${verdict}" — the previous session is not accounted for`,
      allowed ? "The previous session is accounted for — proceed." : `${RECONCILE_NEXT} ${ACKNOWLEDGE_NEXT}`,
    );
  }
  // Latest entry is an execution attempt with NO reconciliation after it.
  const outcome = latest.executionOutcome;
  if (outcome === "devnet-funding-blocked") {
    return decide(
      true,
      "funding-blocked",
      latestSessionId,
      null,
      "The previous attempt was funding-blocked (nothing was submitted) — a retry is safe.",
    );
  }
  if (outcome === "blocked" || outcome === "refused") {
    return decide(
      true,
      "not-sent",
      latestSessionId,
      null,
      "The previous attempt was refused before submission — a new attempt is safe.",
    );
  }
  if (outcome === "submitted" || outcome === "submitted-unconfirmed") {
    return decide(
      false,
      "pending-confirmation",
      latestSessionId,
      "the previous attempt SUBMITTED a transaction that is not confirmed-and-reconciled",
      `${RECONCILE_NEXT} ${ACKNOWLEDGE_NEXT}`,
    );
  }
  if (outcome === "rehearsed") {
    return decide(
      false,
      "unreconciled",
      latestSessionId,
      "the previous attempt confirmed a transaction but no reconciliation entry follows it",
      `${RECONCILE_NEXT} ${ACKNOWLEDGE_NEXT}`,
    );
  }
  return decide(
    false,
    "unknown",
    latestSessionId,
    `the previous attempt's outcome "${outcome ?? "missing"}" is not recognized — fail closed`,
    `${RECONCILE_NEXT} ${ACKNOWLEDGE_NEXT}`,
  );
}
