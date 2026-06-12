/**
 * Sprint 96 — reconciliation/session typed views.
 *
 * Pins, over small synthetic artifacts (every rendered value verbatim):
 *   - typed views exist for execution.reconciliation.report.v1 (verdict + confirmation
 *     classification + observed-only balance facts + expected-vs-actual) and
 *     execution.session.status.v1 (continuation decision + the latest session's trail);
 *   - the readiness view surfaces the S96 session-reconciliation evidence;
 *   - blocked states render as the wall WORKING (caution framing + next safe action);
 *   - hostile shapes never throw and hostile strings never escape into markup.
 */

import { describe, expect, it } from "vitest";
import { hasTypedView, renderTypedArtifactView } from "../src/components/artifact-views.js";
import { renderToString } from "../src/lib/html.js";
import { normalizeArtifact } from "../src/lib/local-artifact.js";
import { isKnownSchema } from "../src/lib/report-types.js";

function typed(raw: unknown): string {
  const view = renderTypedArtifactView(normalizeArtifact(raw), raw);
  expect(view).not.toBeNull();
  return renderToString(view!);
}

describe("S96 schemas are recognized", () => {
  it.each(["execution.reconciliation.report.v1", "execution.session.status.v1"])("%s is in the registry with a typed view", (id) => {
    expect(isKnownSchema(id)).toBe(true);
    expect(hasTypedView(id)).toBe(true);
  });
});

describe("execution.reconciliation.report.v1 typed view", () => {
  const base = {
    schemaVersion: "execution.reconciliation.report.v1",
    mode: "devnet-execution",
    network: "devnet",
    sessionId: "devnet:2026-06-12T09:00:00.000Z:8FenZasy",
    command: "execution:session:reconcile",
    signature: "ReconcileSig1111111111111111111111111111111111",
    confirmation: {
      outcome: "finalized",
      signature: "ReconcileSig1111111111111111111111111111111111",
      slot: 31337,
      errLabel: null,
      polls: 2,
      guidance: "Finalized at the reported slot. Proceed to balance reconciliation.",
    },
    pre: { label: "pre", observedAt: "t1", ownerPublicKey: "owner", sol: { lamports: 1000000000, status: "observed", errLabel: null }, token: null },
    post: { label: "post", observedAt: "t2", ownerPublicKey: "owner", sol: { lamports: 999995000, status: "observed", errLabel: null }, token: null },
    delta: { solLamports: -5000, solStatus: "computed", token: null },
    fee: { estimatedLamports: 5000, actualLamports: 5000, source: "transaction-meta" },
    expected: { kind: "self-transfer-probe", summary: "SOL decreases by exactly the network fee", maxFeeLamports: 10000 },
    actualSummary: "SOL delta -5000 lamports",
    verdict: "reconciled",
    blockedReason: null,
    nextSafeAction: "Session accounted for. A new devnet execution attempt may proceed.",
    createdAt: "2026-06-12T09:05:00.000Z",
    redactionApplied: true,
    neverSends: true,
    phase7LiveTradingReady: false,
  };

  it("renders a reconciled session: verdict, confirmation classification, observed balances, real fee", () => {
    const html = typed(base);
    expect(html).toContain("RECONCILED");
    expect(html).toContain("this session is accounted for");
    expect(html).toContain("finalized");
    expect(html).toContain("31337");
    expect(html).toContain("-5000 lamports");
    expect(html).toContain("transaction-meta");
    expect(html).toContain("SOL delta -5000 lamports");
    expect(html).toContain("nothing is estimated");
  });

  it("renders a pending session as the wall WORKING with the next safe action", () => {
    const html = typed({
      ...base,
      verdict: "pending-confirmation",
      confirmation: { ...base.confirmation, outcome: "timeout", guidance: "Do NOT resend." },
      blockedReason: "the signature did not confirm within the bounded polls — submission is not confirmation",
      nextSafeAction: "Re-run execution:session:reconcile until the signature confirms.",
    });
    expect(html).toContain("PENDING-CONFIRMATION");
    expect(html).toContain("BLOCKED until this session is accounted for");
    expect(html).toContain("submission is not confirmation");
    expect(html).toContain("Re-run execution:session:reconcile");
  });

  it("unobservable balances render as unavailable, never zero-filled", () => {
    const html = typed({
      ...base,
      post: { ...base.post, sol: { lamports: null, status: "rpc-unavailable", errLabel: "down" } },
      delta: { solLamports: null, solStatus: "unavailable", token: null },
      verdict: "rpc-unavailable",
      actualSummary: "balance effect unobservable (pre/post not both observed)",
    });
    expect(html).toContain("rpc-unavailable (not observed)");
    expect(html).toContain("unavailable (pre/post not both observed)");
    expect(html).not.toContain("post 0 lamports");
  });

  it("hostile shapes never throw; hostile strings stay escaped", () => {
    expect(() => typed({ schemaVersion: "execution.reconciliation.report.v1", verdict: 7, delta: "nope", confirmation: [] })).not.toThrow();
    const html = typed({ ...base, actualSummary: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert");
  });
});

describe("execution.session.status.v1 typed view", () => {
  const base = {
    schemaVersion: "execution.session.status.v1",
    ledgerPath: "runs/execution-sessions.jsonl",
    ledgerPresent: true,
    network: "devnet",
    entryCount: 2,
    malformedLines: 0,
    decision: {
      allowed: true,
      status: "reconciled",
      sessionId: "devnet:t1:8FenZasy",
      blockedReason: null,
      nextSafeAction: "The previous session is accounted for — proceed.",
    },
    latestSession: {
      sessionId: "devnet:t1:8FenZasy",
      entries: [
        { kind: "execution-attempt", recordedAt: "t1", command: "execution:devnet:rehearse", signature: "Sig1", executionOutcome: "rehearsed", reconciliationVerdict: null, reportPath: "r.json", reason: null },
        { kind: "reconciliation", recordedAt: "t2", command: "execution:devnet:rehearse", signature: "Sig1", executionOutcome: null, reconciliationVerdict: "reconciled", reportPath: "rec.json", reason: null },
      ],
    },
    createdAt: "2026-06-12T09:05:00.000Z",
    caveats: [],
    redactionApplied: true,
    neverSends: true,
    phase7LiveTradingReady: false,
  };

  it("renders an allowed decision with the session trail", () => {
    const html = typed(base);
    expect(html).toContain("ALLOWED");
    expect(html).toContain("reconciled");
    expect(html).toContain("devnet:t1:8FenZasy");
    expect(html).toContain("execution-attempt");
    expect(html).toContain("verdict reconciled");
    expect(html).toContain("no bypass flag");
  });

  it("renders a blocked decision as the refusal wall working", () => {
    const html = typed({
      ...base,
      decision: {
        allowed: false,
        status: "pending-confirmation",
        sessionId: "devnet:t2:8FenZasy",
        blockedReason: "the previous attempt SUBMITTED a transaction that is not confirmed-and-reconciled",
        nextSafeAction: "Run `pnpm soulmaker execution:session:reconcile ...`.",
      },
    });
    expect(html).toContain("BLOCKED (the refusal wall is working)");
    expect(html).toContain("not confirmed-and-reconciled");
    expect(html).toContain("execution:session:reconcile");
  });

  it("manual acknowledgments render their verbatim reason", () => {
    const html = typed({
      ...base,
      latestSession: {
        sessionId: "devnet:t1:8FenZasy",
        entries: [
          { kind: "manual-acknowledgment", recordedAt: "t3", command: "execution:session:acknowledge", signature: null, executionOutcome: null, reconciliationVerdict: null, reportPath: null, reason: "probe abandoned; balances verified by hand" },
        ],
      },
    });
    expect(html).toContain("probe abandoned; balances verified by hand");
  });

  it("hostile shapes never throw", () => {
    expect(() => typed({ schemaVersion: "execution.session.status.v1", decision: "nope", latestSession: 5 })).not.toThrow();
  });
});

describe("execution.readiness.report.v1 — S96 session evidence", () => {
  it("surfaces the session-reconciliation evidence with the blocked framing", () => {
    const html = typed({
      schemaVersion: "execution.readiness.report.v1",
      verdict: "blocked",
      satisfiedCount: 2,
      totalChecks: 14,
      blockedReason: "12 of 14 unsatisfied",
      nextSafeAction: "env-acknowledgment: remains unset",
      conditions: [],
      evidence: {
        sessionReconciliation: {
          ledgerPath: "runs/execution-sessions.jsonl",
          status: "pending-confirmation",
          sessionId: "devnet:t9:AAAA",
          newExecutionAllowed: false,
          blockedReason: "the previous attempt SUBMITTED a transaction that is not confirmed-and-reconciled",
          nextSafeAction: "Run execution:session:reconcile.",
        },
      },
    });
    expect(html).toContain("Session reconciliation evidence (S96)");
    expect(html).toContain("pending-confirmation");
    expect(html).toContain("NO — blocked by the refusal wall");
    expect(html).toContain("devnet:t9:AAAA");
  });
});
