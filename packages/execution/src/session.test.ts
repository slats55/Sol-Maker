import { describe, it, expect } from "vitest";
import {
  SESSION_LEDGER_ENTRY_SCHEMA_VERSION,
  SESSION_CONTINUATION_ALLOWED_STATUSES,
  createSessionLedgerEntry,
  deriveSessionId,
  parseSessionLedger,
  evaluateSessionContinuation,
} from "./session.js";
import type { SessionLedgerEntry } from "./session.js";

const AT = "2026-06-12T09:00:00.000Z";
const PUBKEY = "8FenZasyRe3HeUEm4X8iTAufaamnryU2JB8cRzWyHgwm";
const SIG = "FakeLedgerSignature1111111111111111111111111111";

function attempt(overrides: Partial<SessionLedgerEntry> = {}): SessionLedgerEntry {
  return createSessionLedgerEntry({
    kind: "execution-attempt",
    sessionId: overrides.sessionId ?? "devnet:t1:8FenZasy",
    recordedAt: AT,
    network: overrides.network ?? "devnet",
    command: "execution:devnet:rehearse",
    signerPublicKey: PUBKEY,
    signature: overrides.signature ?? SIG,
    executionOutcome: overrides.executionOutcome ?? "rehearsed",
    balanceLamportsAtAttempt: 1_000_000_000,
    ...overrides,
  });
}

function reconciliation(verdict: SessionLedgerEntry["reconciliationVerdict"], sessionId = "devnet:t1:8FenZasy"): SessionLedgerEntry {
  return createSessionLedgerEntry({
    kind: "reconciliation",
    sessionId,
    recordedAt: AT,
    network: "devnet",
    command: "execution:session:reconcile",
    reconciliationVerdict: verdict,
    reportPath: "runs/x/reconciliation-report.json",
  });
}

describe("session ledger entries — normalized, validated, never half-recorded", () => {
  it("builds a frozen, schema-stamped entry", () => {
    const entry = attempt();
    expect(entry.schemaVersion).toBe(SESSION_LEDGER_ENTRY_SCHEMA_VERSION);
    expect(Object.isFrozen(entry)).toBe(true);
  });

  it("a manual acknowledgment REQUIRES an explicit reason", () => {
    expect(() =>
      createSessionLedgerEntry({ kind: "manual-acknowledgment", sessionId: "s", recordedAt: AT, network: "devnet", command: "x" }),
    ).toThrowError(/reason/);
    expect(() =>
      createSessionLedgerEntry({
        kind: "manual-acknowledgment",
        sessionId: "s",
        recordedAt: AT,
        network: "devnet",
        command: "x",
        reason: "short",
      }),
    ).toThrowError(/reason/);
  });

  it("a reconciliation entry REQUIRES a closed-set verdict", () => {
    expect(() =>
      createSessionLedgerEntry({
        kind: "reconciliation",
        sessionId: "s",
        recordedAt: AT,
        network: "devnet",
        command: "x",
        reconciliationVerdict: "great" as SessionLedgerEntry["reconciliationVerdict"],
      }),
    ).toThrowError(/closed verdict set/);
  });

  it("deriveSessionId is deterministic and uses only PUBLIC facts", () => {
    const id = deriveSessionId({ network: "devnet", startedAt: AT, signerPublicKey: PUBKEY });
    expect(id).toBe(`devnet:${AT}:8FenZasy`);
    expect(deriveSessionId({ network: "devnet", startedAt: AT, signerPublicKey: null })).toContain("unsigned");
  });
});

describe("parseSessionLedger — tolerant line parse; malformed lines COUNTED, never silent", () => {
  it("round-trips appended JSONL entries", () => {
    const text = [JSON.stringify(attempt()), JSON.stringify(reconciliation("reconciled"))].join("\n") + "\n";
    const parsed = parseSessionLedger(text);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.malformedLines).toBe(0);
  });

  it("counts unparseable and structurally invalid lines", () => {
    const text = ["not json", JSON.stringify({ schemaVersion: "other.v1" }), JSON.stringify(attempt()), ""].join("\n");
    const parsed = parseSessionLedger(text);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.malformedLines).toBe(2);
  });
});

describe("evaluateSessionContinuation — the refusal wall (fail-closed)", () => {
  it("no prior session -> allowed", () => {
    const d = evaluateSessionContinuation({ entries: [], network: "devnet" });
    expect(d.allowed).toBe(true);
    expect(d.status).toBe("no-prior-session");
  });

  it("sent but unconfirmed -> BLOCKED pending-confirmation", () => {
    const d = evaluateSessionContinuation({ entries: [attempt({ executionOutcome: "submitted-unconfirmed" })], network: "devnet" });
    expect(d.allowed).toBe(false);
    expect(d.status).toBe("pending-confirmation");
    expect(d.nextSafeAction).toContain("execution:session:reconcile");
  });

  it("confirmed (rehearsed) with NO reconciliation entry -> BLOCKED unreconciled", () => {
    const d = evaluateSessionContinuation({ entries: [attempt({ executionOutcome: "rehearsed" })], network: "devnet" });
    expect(d.allowed).toBe(false);
    expect(d.status).toBe("unreconciled");
    expect(d.blockedReason).toContain("no reconciliation entry");
  });

  it("reconciled previous session -> allowed", () => {
    const d = evaluateSessionContinuation({ entries: [attempt(), reconciliation("reconciled")], network: "devnet" });
    expect(d.allowed).toBe(true);
    expect(d.status).toBe("reconciled");
  });

  it("funding-blocked previous session -> retry allowed", () => {
    const entries = [attempt({ executionOutcome: "devnet-funding-blocked", signature: null }), reconciliation("funding-blocked")];
    const d = evaluateSessionContinuation({ entries, network: "devnet" });
    expect(d.allowed).toBe(true);
    expect(d.status).toBe("funding-blocked");
  });

  it("attempt-only funding-blocked outcome (no reconciliation row yet) also allows retry", () => {
    const d = evaluateSessionContinuation({
      entries: [attempt({ executionOutcome: "devnet-funding-blocked", signature: null })],
      network: "devnet",
    });
    expect(d.allowed).toBe(true);
    expect(d.status).toBe("funding-blocked");
  });

  it("pending-confirmation reconciliation verdict -> BLOCKED", () => {
    const d = evaluateSessionContinuation({ entries: [attempt(), reconciliation("pending-confirmation")], network: "devnet" });
    expect(d.allowed).toBe(false);
    expect(d.status).toBe("pending-confirmation");
  });

  it("error / rpc-unavailable / unsupported / unreconciled verdicts all BLOCK", () => {
    for (const verdict of ["error", "rpc-unavailable", "unsupported", "unreconciled"] as const) {
      const d = evaluateSessionContinuation({ entries: [attempt(), reconciliation(verdict)], network: "devnet" });
      expect(d.allowed, verdict).toBe(false);
    }
  });

  it("unknown attempt outcome -> BLOCKED fail-closed", () => {
    const d = evaluateSessionContinuation({ entries: [attempt({ executionOutcome: "mystery" })], network: "devnet" });
    expect(d.allowed).toBe(false);
    expect(d.status).toBe("unknown");
  });

  it("malformed ledger lines -> BLOCKED fail-closed (a partial trail never authorizes)", () => {
    const d = evaluateSessionContinuation({ entries: [attempt(), reconciliation("reconciled")], malformedLines: 1, network: "devnet" });
    expect(d.allowed).toBe(false);
    expect(d.status).toBe("unknown");
    expect(d.blockedReason).toContain("malformed");
  });

  it("manual acknowledgment is the ONLY non-data exit and it must be a ledger entry", () => {
    const ack = createSessionLedgerEntry({
      kind: "manual-acknowledgment",
      sessionId: "devnet:t1:8FenZasy",
      recordedAt: AT,
      network: "devnet",
      command: "execution:session:acknowledge",
      reason: "probe abandoned after RPC outage; balances verified by hand",
    });
    const d = evaluateSessionContinuation({ entries: [attempt({ executionOutcome: "submitted-unconfirmed" }), ack], network: "devnet" });
    expect(d.allowed).toBe(true);
    expect(d.status).toBe("manually-acknowledged");
  });

  it("a different network's sessions never gate this network", () => {
    const d = evaluateSessionContinuation({
      entries: [attempt({ network: "testnet", executionOutcome: "submitted-unconfirmed" })],
      network: "devnet",
    });
    expect(d.allowed).toBe(true);
    expect(d.status).toBe("no-prior-session");
  });

  it("only a later session's state matters: an old reconciled session does not unblock a new pending one", () => {
    const entries = [
      attempt({ sessionId: "devnet:t1:8FenZasy" }),
      reconciliation("reconciled", "devnet:t1:8FenZasy"),
      attempt({ sessionId: "devnet:t2:8FenZasy", executionOutcome: "submitted-unconfirmed" }),
    ];
    const d = evaluateSessionContinuation({ entries, network: "devnet" });
    expect(d.allowed).toBe(false);
    expect(d.sessionId).toBe("devnet:t2:8FenZasy");
  });

  it("the allowed-status list is closed and contains no bypass-shaped status", () => {
    expect(SESSION_CONTINUATION_ALLOWED_STATUSES).toEqual([
      "no-prior-session",
      "manually-acknowledged",
      "reconciled",
      "not-sent",
      "funding-blocked",
    ]);
  });
});
