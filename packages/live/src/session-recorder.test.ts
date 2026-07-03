import { describe, expect, it } from "vitest";

import {
  OPERATOR_SESSION_EVENT_KINDS,
  buildSessionEvent,
  deriveEscalationSession,
  exportSessionLog,
  parseSessionLog,
  prepareSessionAppend,
  signatureRef,
  summarizeSessionLog,
  validateSessionEvent,
} from "./session-recorder.js";

const SID = "session-2026-07-03-a";
const T = (n: number): string => `2026-07-03T10:0${n}:00.000Z`;

function startLine(): string {
  return prepareSessionAppend("", { sessionId: SID, seq: 1, at: T(0), kind: "session_started", detail: "operator session started", data: { mode: "observe_only" } }).line;
}

/** Build a journal by appending events in order (exactly like the CLI does). */
function journal(...events: Array<{ kind: (typeof OPERATOR_SESSION_EVENT_KINDS)[number]; detail?: string; data?: Record<string, unknown> | null; at?: string }>): string {
  let text = startLine();
  let seq = 2;
  for (const e of events) {
    text += prepareSessionAppend(text, { sessionId: SID, seq, at: e.at ?? T(Math.min(seq, 9)), kind: e.kind, detail: e.detail ?? e.kind, data: e.data ?? null }).line;
    seq += 1;
  }
  return text;
}

describe("buildSessionEvent — validation", () => {
  it("builds a minimal valid event", () => {
    const e = buildSessionEvent({ sessionId: SID, seq: 1, at: T(0), kind: "session_started", detail: "go" });
    expect(e.schemaVersion).toBe("live.operator.session.event.v1");
    expect(e.data).toBeNull();
  });

  it("refuses unknown kinds, bad ids, bad timestamps and oversized payloads", () => {
    expect(() => buildSessionEvent({ sessionId: SID, seq: 1, at: T(0), kind: "traded" as never, detail: "x" })).toThrow(/closed event vocabulary/);
    expect(() => buildSessionEvent({ sessionId: "bad id!", seq: 1, at: T(0), kind: "note", detail: "x" })).toThrow(/sessionId/);
    expect(() => buildSessionEvent({ sessionId: SID, seq: 0, at: T(0), kind: "note", detail: "x" })).toThrow(/seq/);
    expect(() => buildSessionEvent({ sessionId: SID, seq: 1, at: "yesterday", kind: "note", detail: "x" })).toThrow(/ISO-8601/);
    expect(() => buildSessionEvent({ sessionId: SID, seq: 1, at: T(0), kind: "note", detail: "x", data: { blob: "y".repeat(5000) } })).toThrow(/4000/);
  });

  it("refuses secret material in the detail or data (no secrets in the journal, ever)", () => {
    expect(() => buildSessionEvent({ sessionId: SID, seq: 1, at: T(0), kind: "note", detail: "k", data: { secretKey: "x" } })).toThrow(/sensitive-named/);
    expect(() => buildSessionEvent({ sessionId: SID, seq: 1, at: T(0), kind: "note", detail: "k", data: { seedPhrase: "a b c" } })).toThrow(/sensitive-named/);
    const sig88 = "5".repeat(88);
    expect(() => buildSessionEvent({ sessionId: SID, seq: 1, at: T(0), kind: "signature_recorded", detail: sig88 })).toThrow(/secret-shaped/);
    const nul = "x" + String.fromCharCode(0);
    expect(() => buildSessionEvent({ sessionId: SID, seq: 1, at: T(0), kind: "note", detail: nul })).toThrow(/control character/);
  });

  it("validateSessionEvent refuses unknown fields (closed schema)", () => {
    const good = JSON.parse(startLine().trim()) as Record<string, unknown>;
    expect(validateSessionEvent(good).kind).toBe("session_started");
    expect(() => validateSessionEvent({ ...good, extra: 1 })).toThrow(/unknown field/);
  });
});

describe("prepareSessionAppend — append-only discipline", () => {
  it("an empty journal accepts only seq 1 session_started", () => {
    expect(() => prepareSessionAppend("", { sessionId: SID, seq: 2, at: T(0), kind: "session_started", detail: "x" })).toThrow(/seq 1/);
    expect(() => prepareSessionAppend("", { sessionId: SID, seq: 1, at: T(0), kind: "note", detail: "x" })).toThrow(/session_started/);
    expect(startLine()).toContain('"seq":1');
  });

  it("enforces consecutive seq, matching sessionId, and no second session_started", () => {
    const text = startLine();
    expect(() => prepareSessionAppend(text, { sessionId: SID, seq: 3, at: T(1), kind: "note", detail: "x" })).toThrow(/seq must be 2/);
    expect(() => prepareSessionAppend(text, { sessionId: "other", seq: 2, at: T(1), kind: "note", detail: "x" })).toThrow(/sessionId mismatch/);
    expect(() => prepareSessionAppend(text, { sessionId: SID, seq: 2, at: T(1), kind: "session_started", detail: "x" })).toThrow(/only be the first/);
  });

  it("nothing may follow session_ended", () => {
    const text = journal({ kind: "session_ended" });
    expect(() => prepareSessionAppend(text, { sessionId: SID, seq: 3, at: T(3), kind: "note", detail: "x" })).toThrow(/already ended/);
  });

  it("refuses to append to a journal with zero valid lines", () => {
    expect(() => prepareSessionAppend("not json\n", { sessionId: SID, seq: 1, at: T(0), kind: "session_started", detail: "x" })).toThrow(/no valid event lines/);
  });
});

describe("summarize / export — honest accounting", () => {
  it("summarizes the canary lifecycle and safety events", () => {
    const text = journal(
      { kind: "candidate_observed", data: { mint: "So11111111111111111111111111111111111111112" } },
      { kind: "risk_decision", data: { decision: "CAUTION", score: 35 } },
      { kind: "quote_refresh", data: { outcome: "quote-observed" } },
      { kind: "canary_recommended" },
      { kind: "phantom_approval_pending" },
      { kind: "phantom_submitted" },
      { kind: "phantom_confirmed" },
      { kind: "signature_recorded", data: { ...signatureRef("3xJ9wPqRsTuVwXyZa1bCdEfGhJkMnPqRsTuVwXyZa1bC") } },
      { kind: "reconciliation_recorded", data: { verdict: "reconciled", netLamports: "-5000" } },
      { kind: "session_ended" },
    );
    const s = summarizeSessionLog(text);
    expect(s.status).toBe("ended");
    expect(s.events).toBe(11);
    expect(s.invalidLines).toBe(0);
    expect(s.canary).toMatchObject({ recommended: 1, phantomPending: 1, submitted: 1, confirmed: 1, rejected: 0, timedOut: 0, signaturesRecorded: 1, reconciliationsRecorded: 1 });
    expect(s.pausedPendingRearm).toBe(false);
    expect(s.backendNeverSends).toBe(true);
  });

  it("counts unparseable lines instead of hiding them, and reports open sessions", () => {
    const text = startLine() + "GARBAGE LINE\n";
    const s = summarizeSessionLog(text);
    expect(s.status).toBe("open");
    expect(s.invalidLines).toBe(1);
    expect(s.notes.join(" ")).toMatch(/could not be parsed/);
    expect(s.notes.join(" ")).toMatch(/OPEN/);
    const ex = exportSessionLog(text);
    expect(ex.events).toHaveLength(1);
    expect(ex.invalidLines).toHaveLength(1);
    expect(ex.invalidLines[0]!.lineNumber).toBe(2);
  });

  it("a phantom rejection pauses the loop until a manual re-arm is recorded", () => {
    const paused = journal({ kind: "canary_recommended" }, { kind: "phantom_rejected" });
    expect(summarizeSessionLog(paused).pausedPendingRearm).toBe(true);
    const rearmed = journal({ kind: "canary_recommended" }, { kind: "phantom_rejected" }, { kind: "manual_rearm_recorded", detail: "operator re-armed after review" });
    expect(summarizeSessionLog(rearmed).pausedPendingRearm).toBe(false);
  });

  it("kill switch and emergency stop are pause triggers too", () => {
    expect(summarizeSessionLog(journal({ kind: "kill_switch_engaged" })).pausedPendingRearm).toBe(true);
    expect(summarizeSessionLog(journal({ kind: "emergency_stop_engaged" })).pausedPendingRearm).toBe(true);
  });
});

describe("deriveEscalationSession — durable pause/re-arm across restarts", () => {
  it("counts recommendations, failures and loss; carries the last canary time", () => {
    const text = journal(
      { kind: "canary_recommended", at: "2026-07-03T10:02:00.000Z" },
      { kind: "phantom_rejected" },
      { kind: "reconciliation_recorded", data: { verdict: "reconciled-failed", netLamports: "-1000000" } },
    );
    const d = deriveEscalationSession(text, { armedThisInvocation: true });
    expect(d.canariesThisSession).toBe(1);
    expect(d.failedAttempts).toBe(1);
    expect(d.lastCanaryAtMs).toBe(Date.parse("2026-07-03T10:02:00.000Z"));
    expect(d.dailyLossSol).toBeCloseTo(0.001, 9);
    expect(d.paused).toBe(true);
    // paused ⇒ NOT armed even though the flag was passed: manual re-arm is required first.
    expect(d.armed).toBe(false);
  });

  it("a recorded manual re-arm clears the pause; the flag is still required to arm", () => {
    const text = journal({ kind: "canary_recommended" }, { kind: "phantom_timeout" }, { kind: "manual_rearm_recorded" });
    expect(deriveEscalationSession(text, { armedThisInvocation: false }).armed).toBe(false);
    const d = deriveEscalationSession(text, { armedThisInvocation: true });
    expect(d.paused).toBe(false);
    expect(d.armed).toBe(true);
  });
});

describe("signatureRef — journal-safe signature reference", () => {
  it("stores a prefix + length, never the full 88-char blob", () => {
    const full = "2wJ8kPqRsTuVwXyZ" + "a1bCdEfGhJkMnPqRsTuVwXyZ".repeat(3); // base58-ish, > 80 chars
    const ref = signatureRef(full);
    expect(ref.signaturePrefix).toHaveLength(16);
    expect(ref.signatureLength).toBe(full.length);
    // The ref itself passes the journal's secret scan.
    const e = buildSessionEvent({ sessionId: SID, seq: 1, at: T(0), kind: "session_started", detail: "x", data: { ...ref } });
    expect(e.data).toMatchObject({ signatureLength: full.length });
  });

  it("refuses non-base58 input", () => {
    expect(() => signatureRef("hello world!")).toThrow(/base58/);
  });

  it("parseSessionLog tolerates blank lines", () => {
    expect(parseSessionLog("\n\n" + startLine() + "\n")).toHaveLength(1);
  });
});
