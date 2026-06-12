import { describe, it, expect } from "vitest";
import {
  EXECUTION_RECONCILIATION_REPORT_SCHEMA_VERSION,
  RECONCILIATION_VERDICTS,
  CONFIRMATION_OUTCOMES,
  CONFIRMATION_GUIDANCE,
  CONFIRMATION_HARD_MAX_POLLS,
  readBalanceSnapshot,
  computeBalanceDelta,
  trackConfirmation,
  buildReconciliationReport,
} from "./reconciliation.js";
import type {
  BalanceSnapshot,
  ConfirmationTrackResult,
  ExpectedEffect,
  ReconciliationRpcLike,
} from "./reconciliation.js";

const CLOCK = (): string => "2026-06-12T09:00:00.000Z";
const OWNER = "8FenZasyRe3HeUEm4X8iTAufaamnryU2JB8cRzWyHgwm";
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SIG = "FakeReconcileSignature111111111111111111111111";

const PROBE_EXPECTED: ExpectedEffect = {
  kind: "self-transfer-probe",
  summary: "self-transfer probe: SOL decreases by exactly the network fee; no other change",
  maxFeeLamports: 10_000,
};

function balanceRpc(overrides: Partial<ReconciliationRpcLike> = {}): Pick<ReconciliationRpcLike, "getBalanceLamports" | "getTokenBalance"> {
  return {
    getBalanceLamports: overrides.getBalanceLamports ?? (async () => 1_000_000_000),
    getTokenBalance: overrides.getTokenBalance ?? (async () => ({ amountRaw: "5000000", decimals: 6 })),
  };
}

function snapshot(label: "pre" | "post", lamports: number | null, tokenRaw: string | null = null): BalanceSnapshot {
  return {
    label,
    observedAt: CLOCK(),
    ownerPublicKey: OWNER,
    sol:
      lamports === null
        ? { lamports: null, status: "rpc-unavailable", errLabel: "down" }
        : { lamports, status: "observed", errLabel: null },
    token:
      tokenRaw === null
        ? null
        : { mint: MINT, amountRaw: tokenRaw, decimals: 6, status: "observed", errLabel: null },
  };
}

function confirmation(outcome: ConfirmationTrackResult["outcome"], errLabel: string | null = null): ConfirmationTrackResult {
  return { outcome, signature: SIG, slot: 31337, errLabel, polls: 1, guidance: CONFIRMATION_GUIDANCE[outcome] };
}

describe("readBalanceSnapshot — observed values only, honest failure statuses", () => {
  it("reads SOL and token balances as observed facts", async () => {
    const snap = await readBalanceSnapshot({ rpc: balanceRpc(), ownerPublicKeyBase58: OWNER, tokenMint: MINT, label: "pre", clock: CLOCK });
    expect(snap.sol).toEqual({ lamports: 1_000_000_000, status: "observed", errLabel: null });
    expect(snap.token).toEqual({ mint: MINT, amountRaw: "5000000", decimals: 6, status: "observed", errLabel: null });
    expect(snap.observedAt).toBe("2026-06-12T09:00:00.000Z");
  });

  it("no token account -> honest no-account status (an observed zero by absence)", async () => {
    const snap = await readBalanceSnapshot({
      rpc: balanceRpc({ getTokenBalance: async () => null }),
      ownerPublicKeyBase58: OWNER,
      tokenMint: MINT,
      label: "post",
      clock: CLOCK,
    });
    expect(snap.token?.status).toBe("no-account");
    expect(snap.token?.amountRaw).toBeNull();
  });

  it("RPC failure -> rpc-unavailable, never a fake number, never throws", async () => {
    const snap = await readBalanceSnapshot({
      rpc: {
        getBalanceLamports: async () => {
          throw new Error("ECONNREFUSED 127.0.0.1");
        },
        getTokenBalance: async () => {
          throw new Error("ECONNREFUSED 127.0.0.1");
        },
      },
      ownerPublicKeyBase58: OWNER,
      tokenMint: MINT,
      label: "pre",
      clock: CLOCK,
    });
    expect(snap.sol.status).toBe("rpc-unavailable");
    expect(snap.sol.lamports).toBeNull();
    expect(snap.token?.status).toBe("rpc-unavailable");
  });

  it("malformed RPC responses (negative / non-integer / bad token shape) -> malformed status", async () => {
    const bad = await readBalanceSnapshot({
      rpc: balanceRpc({
        getBalanceLamports: async () => -5 as number,
        getTokenBalance: async () => ({ amountRaw: "not-a-number", decimals: 6 }),
      }),
      ownerPublicKeyBase58: OWNER,
      tokenMint: MINT,
      label: "pre",
      clock: CLOCK,
    });
    expect(bad.sol.status).toBe("malformed");
    expect(bad.sol.lamports).toBeNull();
    expect(bad.token?.status).toBe("malformed");
  });

  it("no mint supplied -> token facts absent entirely (never fabricated)", async () => {
    const snap = await readBalanceSnapshot({ rpc: balanceRpc(), ownerPublicKeyBase58: OWNER, label: "pre", clock: CLOCK });
    expect(snap.token).toBeNull();
  });

  it("never serializes anything secret-shaped: the snapshot carries ONLY the public key", async () => {
    const snap = await readBalanceSnapshot({ rpc: balanceRpc(), ownerPublicKeyBase58: OWNER, tokenMint: MINT, label: "pre", clock: CLOCK });
    const text = JSON.stringify(snap);
    expect(text).toContain(OWNER);
    expect(text).not.toMatch(/secret|seed|mnemonic|keypair/i);
    expect(text).not.toMatch(/[0-9a-f]{64}/i);
  });
});

describe("computeBalanceDelta — only actually observed values produce a number", () => {
  it("SOL delta from two observed snapshots", () => {
    const delta = computeBalanceDelta(snapshot("pre", 1_000_000_000), snapshot("post", 999_995_000));
    expect(delta.solLamports).toBe(-5000);
    expect(delta.solStatus).toBe("computed");
    expect(delta.token).toBeNull();
  });

  it("unobserved side -> delta unavailable, NEVER zero-filled", () => {
    const delta = computeBalanceDelta(snapshot("pre", 1_000_000_000), snapshot("post", null));
    expect(delta.solLamports).toBeNull();
    expect(delta.solStatus).toBe("unavailable");
  });

  it("token delta computed with BigInt semantics; no-account counts as observed zero", () => {
    const pre = snapshot("pre", 100, "0");
    pre.token = { mint: MINT, amountRaw: null, decimals: null, status: "no-account", errLabel: null };
    const post = snapshot("post", 100, "123456789012345678");
    const delta = computeBalanceDelta(pre, post);
    expect(delta.token?.amountRawDelta).toBe("123456789012345678");
    expect(delta.token?.status).toBe("computed");
  });

  it("token side unobservable -> token delta unavailable", () => {
    const pre = snapshot("pre", 100, "5");
    const post = snapshot("post", 100, "9");
    post.token = { mint: MINT, amountRaw: null, decimals: null, status: "rpc-unavailable", errLabel: "down" };
    const delta = computeBalanceDelta(pre, post);
    expect(delta.token?.amountRawDelta).toBeNull();
    expect(delta.token?.status).toBe("unavailable");
  });
});

describe("trackConfirmation — bounded polling, closed classification, never resends", () => {
  const status = (s: "processed" | "confirmed" | "finalized" | null, errLabel: string | null = null) => ({
    status: s,
    slot: s === null ? null : 31337,
    errLabel,
  });

  it("confirmed path: classification + slot + guidance", async () => {
    const r = await trackConfirmation({ signature: SIG, rpc: { getSignatureStatus: async () => status("confirmed") }, sleep: async () => {} });
    expect(r.outcome).toBe("confirmed");
    expect(r.slot).toBe(31337);
    expect(r.polls).toBe(1);
    expect(r.guidance).toContain("balance reconciliation");
  });

  it("finalized is classified distinctly", async () => {
    const r = await trackConfirmation({ signature: SIG, rpc: { getSignatureStatus: async () => status("finalized") }, sleep: async () => {} });
    expect(r.outcome).toBe("finalized");
  });

  it("timeout path: bounded polls, honest outcome, anti-resend guidance", async () => {
    let calls = 0;
    const r = await trackConfirmation({
      signature: SIG,
      rpc: {
        getSignatureStatus: async () => {
          calls += 1;
          return status(null);
        },
      },
      maxPolls: 4,
      sleep: async () => {},
    });
    expect(r.outcome).toBe("timeout");
    expect(r.polls).toBe(4);
    expect(calls).toBe(4);
    expect(r.guidance).toContain("Do NOT resend");
  });

  it("RPC unavailable path: classified on the first throw, no retry storm", async () => {
    let calls = 0;
    const r = await trackConfirmation({
      signature: SIG,
      rpc: {
        getSignatureStatus: async () => {
          calls += 1;
          throw new Error("503 service unavailable");
        },
      },
      maxPolls: 10,
      sleep: async () => {},
    });
    expect(r.outcome).toBe("rpc-unavailable");
    expect(calls).toBe(1);
    expect(r.errLabel).toContain("503");
  });

  it("signature error path: err label preserved, classified signature-error", async () => {
    const r = await trackConfirmation({
      signature: SIG,
      rpc: { getSignatureStatus: async () => status("confirmed", "InstructionError [0, custom]") },
      sleep: async () => {},
    });
    expect(r.outcome).toBe("signature-error");
    expect(r.errLabel).toContain("InstructionError");
    expect(r.guidance).toContain("fee was still charged");
  });

  it("dropped: classified ONLY with explicit blockhash-expiry facts", async () => {
    const r = await trackConfirmation({
      signature: SIG,
      rpc: { getSignatureStatus: async () => status(null) },
      lastValidBlockHeight: 100,
      getBlockHeight: async () => 150,
      maxPolls: 5,
      sleep: async () => {},
    });
    expect(r.outcome).toBe("dropped");
    expect(r.guidance).toContain("did not execute");
  });

  it("the poll bound is a hard cap and the module cannot submit (no send method on the seam)", async () => {
    let calls = 0;
    const r = await trackConfirmation({
      signature: SIG,
      rpc: {
        getSignatureStatus: async () => {
          calls += 1;
          return status(null);
        },
      },
      maxPolls: 10_000,
      sleep: async () => {},
    });
    expect(r.polls).toBe(CONFIRMATION_HARD_MAX_POLLS);
    expect(calls).toBe(CONFIRMATION_HARD_MAX_POLLS);
    expect(r.outcome).toBe("timeout");
  });

  it("every outcome has exact guidance and none of it says resend/resubmit as an action", () => {
    for (const outcome of CONFIRMATION_OUTCOMES) {
      const guidance = CONFIRMATION_GUIDANCE[outcome];
      expect(guidance.length).toBeGreaterThan(20);
      expect(/(^|[^t] )resend it|please resend|resubmit the transaction now/i.test(guidance)).toBe(false);
    }
  });
});

describe("buildReconciliationReport — deterministic fail-closed verdicts; nothing faked", () => {
  const base = {
    mode: "devnet-execution" as const,
    network: "devnet",
    sessionId: "devnet:2026-06-12T09:00:00.000Z:8FenZasy",
    command: "execution:devnet:rehearse",
    expected: PROBE_EXPECTED,
    clock: CLOCK,
  };

  it("the verdict set is closed and exact", () => {
    expect(RECONCILIATION_VERDICTS).toEqual([
      "reconciled",
      "unreconciled",
      "pending-confirmation",
      "not-sent",
      "funding-blocked",
      "rpc-unavailable",
      "unsupported",
      "error",
    ]);
  });

  it("confirmed probe with delta == -actualFee -> reconciled", () => {
    const report = buildReconciliationReport({
      ...base,
      signature: SIG,
      confirmation: confirmation("confirmed"),
      pre: snapshot("pre", 1_000_000_000),
      post: snapshot("post", 999_995_000),
      feeActualLamports: 5000,
    });
    expect(report.schemaVersion).toBe(EXECUTION_RECONCILIATION_REPORT_SCHEMA_VERSION);
    expect(report.verdict).toBe("reconciled");
    expect(report.delta?.solLamports).toBe(-5000);
    expect(report.fee).toEqual({ estimatedLamports: null, actualLamports: 5000, source: "transaction-meta" });
    expect(report.blockedReason).toBeNull();
    expect(report.neverSends).toBe(true);
    expect(report.phase7LiveTradingReady).toBe(false);
  });

  it("confirmed probe with delta NOT matching the actual fee -> unreconciled, mismatch named", () => {
    const report = buildReconciliationReport({
      ...base,
      signature: SIG,
      confirmation: confirmation("confirmed"),
      pre: snapshot("pre", 1_000_000_000),
      post: snapshot("post", 999_990_000),
      feeActualLamports: 5000,
    });
    expect(report.verdict).toBe("unreconciled");
    expect(report.blockedReason).toContain("does not equal the actual fee");
  });

  it("SOL increase on a probe -> unreconciled (a probe can only burn its fee)", () => {
    const report = buildReconciliationReport({
      ...base,
      signature: SIG,
      confirmation: confirmation("confirmed"),
      pre: snapshot("pre", 1_000_000_000),
      post: snapshot("post", 2_000_000_000),
    });
    expect(report.verdict).toBe("unreconciled");
    expect(report.blockedReason).toContain("INCREASED");
  });

  it("fee burn above the explicit bound -> unreconciled", () => {
    const report = buildReconciliationReport({
      ...base,
      signature: SIG,
      confirmation: confirmation("confirmed"),
      pre: snapshot("pre", 1_000_000_000),
      post: snapshot("post", 999_000_000),
    });
    expect(report.verdict).toBe("unreconciled");
    expect(report.blockedReason).toContain("fee bound");
  });

  it("confirmed but balances unobservable -> rpc-unavailable, NEVER reconciled", () => {
    const report = buildReconciliationReport({
      ...base,
      signature: SIG,
      confirmation: confirmation("confirmed"),
      pre: snapshot("pre", 1_000_000_000),
      post: snapshot("post", null),
    });
    expect(report.verdict).toBe("rpc-unavailable");
    expect(report.actualSummary).toContain("unobservable");
  });

  it("timeout confirmation -> pending-confirmation with anti-resend next action", () => {
    const report = buildReconciliationReport({
      ...base,
      signature: SIG,
      confirmation: confirmation("timeout"),
      pre: snapshot("pre", 1_000_000_000),
      post: snapshot("post", 1_000_000_000),
    });
    expect(report.verdict).toBe("pending-confirmation");
    expect(report.nextSafeAction).toContain("Do NOT start a new execution attempt");
  });

  it("signature-error -> error verdict requiring review", () => {
    const report = buildReconciliationReport({
      ...base,
      signature: SIG,
      confirmation: confirmation("signature-error", "InstructionError"),
    });
    expect(report.verdict).toBe("error");
    expect(report.blockedReason).toContain("landed with an error");
  });

  it("dropped with zero observed delta -> reconciled (no effect, proven)", () => {
    const report = buildReconciliationReport({
      ...base,
      signature: SIG,
      confirmation: confirmation("dropped"),
      pre: snapshot("pre", 1_000_000_000),
      post: snapshot("post", 1_000_000_000),
    });
    expect(report.verdict).toBe("reconciled");
  });

  it("dropped with a NON-zero delta -> unreconciled (never assumed harmless)", () => {
    const report = buildReconciliationReport({
      ...base,
      signature: SIG,
      confirmation: confirmation("dropped"),
      pre: snapshot("pre", 1_000_000_000),
      post: snapshot("post", 999_000_000),
    });
    expect(report.verdict).toBe("unreconciled");
  });

  it("no signature -> not-sent", () => {
    const report = buildReconciliationReport({ ...base });
    expect(report.verdict).toBe("not-sent");
    expect(report.nextSafeAction).toContain("safe");
  });

  it("funding blocked -> funding-blocked (retry is safe; nothing was submitted)", () => {
    const report = buildReconciliationReport({ ...base, fundingBlocked: true });
    expect(report.verdict).toBe("funding-blocked");
    expect(report.nextSafeAction).toContain("retry is safe");
  });

  it("mainnet-dry-run -> not-sent with the explicit never-sends caveat", () => {
    const report = buildReconciliationReport({
      ...base,
      mode: "mainnet-dry-run",
      network: "mainnet-beta",
      expected: { kind: "none", summary: "dry-run: nothing is sent", maxFeeLamports: null },
    });
    expect(report.verdict).toBe("not-sent");
    expect(report.blockedReason).toContain("never sends");
    expect(report.caveats.join(" ")).toContain("mainnet-dry-run NEVER sends");
  });

  it("submitted but no confirmation facts -> pending-confirmation", () => {
    const report = buildReconciliationReport({ ...base, signature: SIG });
    expect(report.verdict).toBe("pending-confirmation");
  });

  it("unsupported expected-effect kind -> unsupported (never guessed)", () => {
    const report = buildReconciliationReport({
      ...base,
      expected: { kind: "swap" as unknown as ExpectedEffect["kind"], summary: "?", maxFeeLamports: null },
    });
    expect(report.verdict).toBe("unsupported");
  });

  it("unexpected token movement on a probe -> unreconciled", () => {
    const report = buildReconciliationReport({
      ...base,
      signature: SIG,
      confirmation: confirmation("confirmed"),
      pre: snapshot("pre", 1_000_000_000, "1000"),
      post: snapshot("post", 999_995_000, "900"),
      feeActualLamports: 5000,
    });
    expect(report.verdict).toBe("unreconciled");
    expect(report.blockedReason).toContain("token");
  });

  it("report carries no P/L field anywhere — accounting only", () => {
    const report = buildReconciliationReport({ ...base, signature: SIG, confirmation: confirmation("confirmed"), pre: snapshot("pre", 10), post: snapshot("post", 5) });
    const keys = JSON.stringify(Object.keys(report));
    expect(keys).not.toMatch(/profit|pnl|gain|estimatedValue/i);
  });
});
