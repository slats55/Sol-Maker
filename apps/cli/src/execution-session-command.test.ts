import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import {
  executionSessionStatusReport,
  executionSessionReconcileReport,
  executionSessionAcknowledgeReport,
  executionDevnetRehearseReport,
  executionDevnetSendReport,
  executionReadinessReport,
  paperSniperRehearseReport,
  EXECUTION_SESSION_STATUS_SCHEMA_VERSION,
} from "./commands.js";
import type { RehearsalRpc, ReconciliationRpc, SendRpcLike } from "@soulmaker/execution";

const FULL_ENV = {
  SOLMAKER_ENABLE_DEVNET_EXECUTION: "devnet-only",
} as NodeJS.ProcessEnv;

const NOW = "2026-06-12T09:00:00.000Z";

function writeConfig(dir: string): void {
  writeFileSync(join(dir, "soulmaker.config.json"), JSON.stringify({ mode: "WATCH_ONLY", rpcUrl: "https://rpc.example.com" }));
}

async function withTmpAsync(fn: (tmp: string) => Promise<void>): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), "soulmaker-session-"));
  try {
    await fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function fakeRehearsalRpc(options: { airdropError?: string } = {}): RehearsalRpc {
  let funded = false;
  const send: SendRpcLike = {
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58() }),
    sendRawTransaction: async () => "FakeRehearsalSignature11111111111111111111111",
  };
  return Object.freeze({
    endpointHost: "fake.devnet.example.com",
    faucet: {
      getBalanceLamports: async () => (funded ? 1_000_000_000 : 0),
      requestAirdrop: async () => {
        if (options.airdropError) throw new Error(options.airdropError);
        funded = true;
        return "FakeAirdropSignature1111111111111111111111111";
      },
      getSignatureStatus: async () => ({ confirmed: true, slot: 31337, errLabel: null }),
    },
    send,
  });
}

function fakeReconciliationRpc(
  options: {
    balance?: number;
    status?: "processed" | "confirmed" | "finalized" | null;
    errLabel?: string | null;
    fee?: number | null;
    throwOnStatus?: boolean;
  } = {},
): ReconciliationRpc {
  return Object.freeze({
    endpointHost: "fake.devnet.example.com",
    rpc: Object.freeze({
      getBalanceLamports: async () => options.balance ?? 999_995_000,
      getTokenBalance: async () => null,
      getSignatureStatus: async () => {
        if (options.throwOnStatus) throw new Error("503 unavailable");
        return {
          status: "status" in options ? options.status ?? null : "finalized",
          slot: 31337,
          errLabel: options.errLabel ?? null,
        };
      },
      getTransactionFeeLamports: async () => options.fee ?? 5000,
    }),
  });
}

/** One real rehearsal run over fakes: leaves a rehearsed + reconciled session in the ledger. */
async function runRehearsal(tmp: string, outName = "rehearsal-1"): Promise<void> {
  const r = await executionDevnetRehearseReport(
    { cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => fakeRehearsalRpc(), now: () => NOW, sleep: async () => {} },
    { outDir: join("runs", outName), acknowledgeDevnetExecution: true, skipSimulation: true, json: true },
  );
  expect(r.exitCode, r.text.slice(0, 500)).toBe(0);
}

function ledgerPathOf(tmp: string): string {
  return join(tmp, "runs", "execution-sessions.jsonl");
}

describe("execution:devnet:rehearse — S96 accounting trail", () => {
  it("every rehearsal leaves attempt + reconciliation ledger entries AND a reconciliation report", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      await runRehearsal(tmp);
      const ledger = readFileSync(ledgerPathOf(tmp), "utf8").trim().split("\n");
      expect(ledger).toHaveLength(2);
      const attempt = JSON.parse(ledger[0] as string) as Record<string, unknown>;
      const reconciliation = JSON.parse(ledger[1] as string) as Record<string, unknown>;
      expect(attempt.kind).toBe("execution-attempt");
      expect(attempt.executionOutcome).toBe("rehearsed");
      expect(attempt.signature).toBe("FakeRehearsalSignature11111111111111111111111");
      expect(reconciliation.kind).toBe("reconciliation");
      expect(reconciliation.reconciliationVerdict).toBe("reconciled");
      expect(attempt.sessionId).toBe(reconciliation.sessionId);

      const report = JSON.parse(readFileSync(join(tmp, "runs", "rehearsal-1", "reconciliation-report.json"), "utf8")) as Record<string, unknown>;
      expect(report.schemaVersion).toBe("execution.reconciliation.report.v1");
      expect(report.verdict).toBe("reconciled");
      expect(report.redactionApplied).toBe(true);
      expect(report.neverSends).toBe(true);
    });
  });

  it("a funding-blocked rehearsal records funding-blocked (a retry stays allowed)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await executionDevnetRehearseReport(
        { cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => fakeRehearsalRpc({ airdropError: "429" }), now: () => NOW, sleep: async () => {} },
        { outDir: join("runs", "blocked-1"), acknowledgeDevnetExecution: true, skipSimulation: true },
      );
      expect(r.exitCode).toBe(1);
      const report = JSON.parse(readFileSync(join(tmp, "runs", "blocked-1", "reconciliation-report.json"), "utf8")) as Record<string, unknown>;
      expect(report.verdict).toBe("funding-blocked");
      // The wall allows the retry:
      const second = await executionDevnetRehearseReport(
        { cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => fakeRehearsalRpc(), now: () => NOW, sleep: async () => {} },
        { outDir: join("runs", "blocked-1"), acknowledgeDevnetExecution: true, skipSimulation: true, force: true },
      );
      expect(second.exitCode, second.text.slice(0, 500)).toBe(0);
    });
  });

  it("an UNRECONCILED previous session REFUSES a new rehearsal (and there is no bypass flag)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      mkdirSync(join(tmp, "runs"), { recursive: true });
      // Hand-write a sent-but-unaccounted attempt (as if the process died before reconciling).
      appendFileSync(
        ledgerPathOf(tmp),
        JSON.stringify({
          schemaVersion: "execution.session.ledger.entry.v1",
          kind: "execution-attempt",
          sessionId: "devnet:t1:AAAA",
          recordedAt: NOW,
          network: "devnet",
          command: "execution:devnet:send",
          signerPublicKey: Keypair.generate().publicKey.toBase58(),
          signature: "PendingSig111111111111111111111111111111111111",
          executionOutcome: "submitted",
          balanceLamportsAtAttempt: 1_000_000_000,
          reconciliationVerdict: null,
          reportPath: null,
          reason: null,
        }) + "\n",
      );
      const r = await executionDevnetRehearseReport(
        { cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => fakeRehearsalRpc(), now: () => NOW, sleep: async () => {} },
        { outDir: join("runs", "walled"), acknowledgeDevnetExecution: true, skipSimulation: true },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("Refusing: the previous execution session is not accounted for (pending-confirmation)");
      expect(r.text).toContain("execution:session:reconcile");
      // Nothing was written for the refused run.
      expect(existsSync(join(tmp, "runs", "walled"))).toBe(false);
    });
  });

  it("a MALFORMED ledger fails closed (refuses a new rehearsal)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      mkdirSync(join(tmp, "runs"), { recursive: true });
      appendFileSync(ledgerPathOf(tmp), "this is not json\n");
      const r = await executionDevnetRehearseReport(
        { cwd: tmp, env: FULL_ENV, createRehearsalRpc: () => fakeRehearsalRpc(), now: () => NOW, sleep: async () => {} },
        { outDir: join("runs", "walled"), acknowledgeDevnetExecution: true, skipSimulation: true },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("not accounted for (unknown)");
    });
  });

  it("a reconciled previous session allows the next rehearsal", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      await runRehearsal(tmp, "first");
      await runRehearsal(tmp, "second");
      const ledger = readFileSync(ledgerPathOf(tmp), "utf8").trim().split("\n");
      expect(ledger).toHaveLength(4);
    });
  });
});

describe("execution:session:status — read-only accounting state", () => {
  it("empty ledger -> no-prior-session, allowed, exit 0", () => {
    const tmp = mkdtempSync(join(tmpdir(), "soulmaker-status-"));
    try {
      writeConfig(tmp);
      const r = executionSessionStatusReport({ cwd: tmp, now: () => NOW }, { json: true });
      expect(r.exitCode).toBe(0);
      const report = JSON.parse(r.text) as Record<string, unknown> & { decision: { status: string; allowed: boolean } };
      expect(report.schemaVersion).toBe(EXECUTION_SESSION_STATUS_SCHEMA_VERSION);
      expect(report.decision.status).toBe("no-prior-session");
      expect(report.decision.allowed).toBe(true);
      expect(report.neverSends).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("after a rehearsal: reconciled status with the session entries echoed; --out writes the artifact", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      await runRehearsal(tmp);
      const outPath = join(tmp, "runs", "session-status.json");
      const r = executionSessionStatusReport({ cwd: tmp, now: () => NOW }, { outPath, json: true });
      expect(r.exitCode).toBe(0);
      const report = JSON.parse(readFileSync(outPath, "utf8")) as {
        decision: { status: string };
        latestSession: { entries: Array<{ kind: string }> };
      };
      expect(report.decision.status).toBe("reconciled");
      expect(report.latestSession.entries.map((e) => e.kind)).toEqual(["execution-attempt", "reconciliation"]);
    });
  });
});

describe("execution:session:reconcile — post-hoc accounting with REAL observed data", () => {
  /** Seed a submitted-but-unaccounted session (the exact state the wall blocks on). */
  function seedPendingSession(tmp: string, signerPublicKey: string): void {
    mkdirSync(join(tmp, "runs"), { recursive: true });
    appendFileSync(
      ledgerPathOf(tmp),
      JSON.stringify({
        schemaVersion: "execution.session.ledger.entry.v1",
        kind: "execution-attempt",
        sessionId: "devnet:t1:pending",
        recordedAt: NOW,
        network: "devnet",
        command: "execution:devnet:send",
        signerPublicKey,
        signature: "PendingSig111111111111111111111111111111111111",
        executionOutcome: "submitted",
        balanceLamportsAtAttempt: 1_000_000_000,
        reconciliationVerdict: null,
        reportPath: null,
        reason: null,
      }) + "\n",
    );
  }

  it("finalized signature + fee-exact balance delta -> RECONCILED; the wall opens", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const pubkey = Keypair.generate().publicKey.toBase58();
      seedPendingSession(tmp, pubkey);
      const r = await executionSessionReconcileReport(
        { cwd: tmp, now: () => NOW, sleep: async () => {}, createReconciliationRpc: () => fakeReconciliationRpc() },
        { outDir: join("runs", "reconcile-1"), json: true },
      );
      expect(r.exitCode, r.text.slice(0, 500)).toBe(0);
      const report = JSON.parse(r.text) as Record<string, unknown> & {
        confirmation: { outcome: string };
        delta: { solLamports: number };
        fee: { actualLamports: number; source: string };
      };
      expect(report.verdict).toBe("reconciled");
      expect(report.confirmation.outcome).toBe("finalized");
      expect(report.delta.solLamports).toBe(-5000);
      expect(report.fee).toMatchObject({ actualLamports: 5000, source: "transaction-meta" });
      // The wall opens:
      const status = executionSessionStatusReport({ cwd: tmp, now: () => NOW }, { json: true });
      expect((JSON.parse(status.text) as { decision: { allowed: boolean } }).decision.allowed).toBe(true);
    });
  });

  it("signature still not found -> PENDING-CONFIRMATION, exit 1, wall stays closed", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const pubkey = Keypair.generate().publicKey.toBase58();
      seedPendingSession(tmp, pubkey);
      const r = await executionSessionReconcileReport(
        { cwd: tmp, now: () => NOW, sleep: async () => {}, createReconciliationRpc: () => fakeReconciliationRpc({ status: null }) },
        { outDir: join("runs", "reconcile-pending"), polls: "2", json: true },
      );
      expect(r.exitCode).toBe(1);
      expect((JSON.parse(r.text) as { verdict: string }).verdict).toBe("pending-confirmation");
      const status = executionSessionStatusReport({ cwd: tmp, now: () => NOW }, { json: true });
      expect((JSON.parse(status.text) as { decision: { allowed: boolean } }).decision.allowed).toBe(false);
    });
  });

  it("RPC unavailable -> rpc-unavailable verdict, exit 1, never a fake balance", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const pubkey = Keypair.generate().publicKey.toBase58();
      seedPendingSession(tmp, pubkey);
      const r = await executionSessionReconcileReport(
        { cwd: tmp, now: () => NOW, sleep: async () => {}, createReconciliationRpc: () => fakeReconciliationRpc({ throwOnStatus: true }) },
        { outDir: join("runs", "reconcile-down"), json: true },
      );
      expect(r.exitCode).toBe(1);
      const report = JSON.parse(r.text) as { verdict: string; confirmation: { outcome: string } };
      expect(report.verdict).toBe("rpc-unavailable");
      expect(report.confirmation.outcome).toBe("rpc-unavailable");
    });
  });

  it("balance mismatch beyond the fee -> UNRECONCILED, exit 1", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const pubkey = Keypair.generate().publicKey.toBase58();
      seedPendingSession(tmp, pubkey);
      const r = await executionSessionReconcileReport(
        { cwd: tmp, now: () => NOW, sleep: async () => {}, createReconciliationRpc: () => fakeReconciliationRpc({ balance: 500_000_000 }) },
        { outDir: join("runs", "reconcile-bad"), json: true },
      );
      expect(r.exitCode).toBe(1);
      expect((JSON.parse(r.text) as { verdict: string }).verdict).toBe("unreconciled");
    });
  });

  it("refuses mainnet endpoints and empty ledgers; never resubmits anything", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const empty = await executionSessionReconcileReport({ cwd: tmp }, { outDir: join("runs", "x") });
      expect(empty.exitCode).toBe(1);
      expect(empty.text).toContain("nothing to reconcile");

      const pubkey = Keypair.generate().publicKey.toBase58();
      seedPendingSession(tmp, pubkey);
      const mainnet = await executionSessionReconcileReport(
        { cwd: tmp },
        { outDir: join("runs", "x"), rpcUrl: "https://api.mainnet-beta.solana.com" },
      );
      expect(mainnet.exitCode).toBe(1);
      expect(mainnet.text).toContain("never talks to a mainnet endpoint");
    });
  });
});

describe("execution:session:acknowledge — the explicit audited exit", () => {
  function seedUnknownSession(tmp: string): void {
    mkdirSync(join(tmp, "runs"), { recursive: true });
    appendFileSync(
      ledgerPathOf(tmp),
      JSON.stringify({
        schemaVersion: "execution.session.ledger.entry.v1",
        kind: "execution-attempt",
        sessionId: "devnet:t1:stuck",
        recordedAt: NOW,
        network: "devnet",
        command: "execution:devnet:send",
        signerPublicKey: null,
        signature: "StuckSig11111111111111111111111111111111111111",
        executionOutcome: "submitted",
        balanceLamportsAtAttempt: null,
        reconciliationVerdict: null,
        reportPath: null,
        reason: null,
      }) + "\n",
    );
  }

  it("requires BOTH the explicit flag and a real reason", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      seedUnknownSession(tmp);
      expect(executionSessionAcknowledgeReport({ cwd: tmp }, { reason: "abandoned probe after outage" }).exitCode).toBe(1);
      expect(
        executionSessionAcknowledgeReport({ cwd: tmp }, { acknowledgeUnreconciledSession: true, reason: "short" }).exitCode,
      ).toBe(1);
    });
  });

  it("acknowledging a blocked session appends an audited entry and opens the wall", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      seedUnknownSession(tmp);
      const r = executionSessionAcknowledgeReport(
        { cwd: tmp, now: () => NOW },
        { acknowledgeUnreconciledSession: true, reason: "probe abandoned; balances verified by hand", json: true },
      );
      expect(r.exitCode, r.text.slice(0, 300)).toBe(0);
      const entry = JSON.parse(r.text) as Record<string, unknown>;
      expect(entry.kind).toBe("manual-acknowledgment");
      expect(entry.reason).toBe("probe abandoned; balances verified by hand");
      const status = executionSessionStatusReport({ cwd: tmp, now: () => NOW }, { json: true });
      expect((JSON.parse(status.text) as { decision: { status: string } }).decision.status).toBe("manually-acknowledged");
    });
  });

  it("refuses when nothing is blocked (an acknowledgment must mean something)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = executionSessionAcknowledgeReport(
        { cwd: tmp },
        { acknowledgeUnreconciledSession: true, reason: "no reason needed here at all" },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("nothing to acknowledge");
    });
  });
});

describe("execution:devnet:send — S96 wall + ledger integration", () => {
  it("an unaccounted previous session refuses a new send BEFORE any signer or envelope work", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      mkdirSync(join(tmp, "runs"), { recursive: true });
      appendFileSync(
        ledgerPathOf(tmp),
        JSON.stringify({
          schemaVersion: "execution.session.ledger.entry.v1",
          kind: "execution-attempt",
          sessionId: "devnet:t1:AAAA",
          recordedAt: NOW,
          network: "devnet",
          command: "execution:devnet:send",
          signerPublicKey: null,
          signature: "Sig1111111111111111111111111111111111111111111",
          executionOutcome: "submitted",
          balanceLamportsAtAttempt: null,
          reconciliationVerdict: null,
          reportPath: null,
          reason: null,
        }) + "\n",
      );
      const keyPath = join(tmp, "devnet-signer.json");
      writeFileSync(keyPath, JSON.stringify(Array.from(Keypair.generate().secretKey)));
      const envelopePath = join(tmp, "envelope.json");
      writeFileSync(envelopePath, JSON.stringify({ schemaVersion: "txpreview.envelope.v1" }));
      const r = await executionDevnetSendReport(
        { cwd: tmp, env: { ...FULL_ENV, TEST_SIGNER: keyPath } },
        {
          envelopePath,
          signerEnvVar: "TEST_SIGNER",
          auditLog: join(tmp, "audit.jsonl"),
          riskScore: "0",
          acknowledgeDevnetExecution: true,
        },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("not accounted for (pending-confirmation)");
    });
  });
});

describe("execution:readiness — S96 session evidence", () => {
  it("reports the last session's reconciliation status (clean ledger)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      await runRehearsal(tmp);
      const r = executionReadinessReport({ cwd: tmp, env: {} as NodeJS.ProcessEnv, now: () => NOW }, { json: true });
      expect(r.exitCode).toBe(0);
      const report = JSON.parse(r.text) as {
        verdict: string;
        totalChecks: number;
        evidence: { sessionReconciliation: { status: string; newExecutionAllowed: boolean } };
      };
      expect(report.verdict).toBe("blocked");
      expect(report.totalChecks).toBe(14);
      expect(report.evidence.sessionReconciliation.status).toBe("reconciled");
      expect(report.evidence.sessionReconciliation.newExecutionAllowed).toBe(true);
    });
  });

  it("names an unaccounted session as BLOCKING new execution", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      mkdirSync(join(tmp, "runs"), { recursive: true });
      appendFileSync(
        ledgerPathOf(tmp),
        JSON.stringify({
          schemaVersion: "execution.session.ledger.entry.v1",
          kind: "execution-attempt",
          sessionId: "devnet:t1:AAAA",
          recordedAt: NOW,
          network: "devnet",
          command: "execution:devnet:send",
          signerPublicKey: null,
          signature: "Sig1111111111111111111111111111111111111111111",
          executionOutcome: "submitted",
          balanceLamportsAtAttempt: null,
          reconciliationVerdict: null,
          reportPath: null,
          reason: null,
        }) + "\n",
      );
      const r = executionReadinessReport({ cwd: tmp, env: {} as NodeJS.ProcessEnv, now: () => NOW }, {});
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain("new execution BLOCKED");
      expect(r.text).toContain("pending-confirmation");
    });
  });
});

describe("paper:sniper:rehearse — S96 reconciliation stage", () => {
  function writeCandidates(tmp: string): string {
    const path = join(tmp, "candidates.json");
    writeFileSync(
      path,
      JSON.stringify({
        sourceLabel: "session-test",
        candidates: [{ candidateId: "c-1", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC" }],
      }),
    );
    return path;
  }

  it("paper mode: the reconciliation stage is SKIPPED honestly (nothing to account for)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await paperSniperRehearseReport(
        { cwd: tmp, env: {} as NodeJS.ProcessEnv, now: () => NOW },
        { candidatesPath: writeCandidates(tmp), outDir: "out", json: true },
      );
      const report = JSON.parse(r.text) as { stages: Array<{ stage: string; status: string; detail: string }> };
      const stage = report.stages.find((s) => s.stage === "reconciliation");
      expect(stage?.status).toBe("skipped");
      expect(stage?.detail).toContain("nothing to account for");
    });
  });

  it("devnet mode with --devnet-send: the reconciliation stage reads the artifact verdict back", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp);
      const r = await paperSniperRehearseReport(
        {
          cwd: tmp,
          env: FULL_ENV,
          now: () => NOW,
          sleep: async () => {},
          createRehearsalRpc: () => fakeRehearsalRpc(),
          createTxPreview: () => ({
            endpointHost: "fake.devnet.example.com",
            rpc: {
              simulateTransaction: async () => ({ context: { slot: 1, apiVersion: "1.18" }, value: { err: null, logs: [], unitsConsumed: 1 } }),
            },
          }),
        },
        {
          mode: "devnet",
          candidatesPath: writeCandidates(tmp),
          outDir: join("runs", "out-devnet"),
          devnetSend: true,
          acknowledgeDevnetExecution: true,
          json: true,
        },
      );
      const report = JSON.parse(r.text) as { stages: Array<{ stage: string; status: string; detail: string; artifacts: string[] }> };
      const stage = report.stages.find((s) => s.stage === "reconciliation");
      expect(stage?.status, JSON.stringify(report.stages)).toBe("executed");
      expect(stage?.detail).toContain("reconciled");
      expect(stage?.artifacts).toContain("devnet/reconciliation-report.json");
    });
  });
});
