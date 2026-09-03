import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { LIVE_TRADING_ENV_FLAG, LIVE_TRADING_ENV_VALUE } from "@soulmaker/execution";
import type { MainnetRpcSeams } from "@soulmaker/live";
import { executionMainnetSendReport, executionMainnetSellReport, sessionFromLedger } from "./live-mainnet-commands.js";
import { buildLedger, openPosition } from "@soulmaker/live";

const SIGNER = Keypair.generate();
const MINT = new PublicKey(Buffer.alloc(32, 7)).toBase58();
const BLOCKHASH = new PublicKey(Buffer.alloc(32, 3)).toBase58();
const SIG = "4".repeat(88);
const NOW = "2026-09-03T12:00:00.000Z";

function envelopeJson(): string {
  const message = new TransactionMessage({
    payerKey: SIGNER.publicKey,
    recentBlockhash: BLOCKHASH,
    instructions: [SystemProgram.transfer({ fromPubkey: SIGNER.publicKey, toPubkey: SIGNER.publicKey, lamports: 1 })],
  }).compileToV0Message();
  return JSON.stringify({
    schemaVersion: "txpreview.envelope.v1",
    network: "mainnet-beta",
    feePayerPublicKey: SIGNER.publicKey.toBase58(),
    txBase64: Buffer.from(new VersionedTransaction(message).serialize()).toString("base64"),
    builderId: "jupiter-swap-api",
    candidateMint: MINT,
    routeCaveats: [],
    constraints: { maxSpendLamports: "5000000", slippageBps: 100 },
    quotedAt: new Date(Date.parse(NOW) - 2_000).toISOString(),
    unsigned: true,
    neverSigned: true,
    phase7LiveTradingReady: false,
  });
}

function simulationJson(): string {
  return JSON.stringify({ outcome: "simulated-ok", feePayerPublicKey: SIGNER.publicKey.toBase58(), candidateMint: MINT, builderId: "jupiter-swap-api", simulatedAt: new Date(Date.parse(NOW) - 5_000).toISOString() });
}

function world(sol: number[], token: string[], confirmed = true) {
  const sent: Uint8Array[] = [];
  let si = 0, ti = 0;
  const rpc: MainnetRpcSeams = {
    endpointHost: "rpc.test",
    send: { getLatestBlockhash: async () => ({ blockhash: BLOCKHASH }), sendRawTransaction: async (b: Uint8Array) => { sent.push(b); return SIG; } },
    confirm: { getSignatureStatuses: async () => ({ value: [confirmed ? { slot: 9, err: null, confirmationStatus: "confirmed" } : null] }) },
    balance: { getBalanceLamports: async () => sol[Math.min(si++, sol.length - 1)] as number, getTokenBalanceRaw: async () => token[Math.min(ti++, token.length - 1)] as string },
  };
  return { rpc, sent };
}

function setup(configOverride: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "s111-cli-"));
  writeFileSync(join(dir, "soulmaker.config.json"), JSON.stringify({ mode: "PAPER", killSwitch: false, caps: { maxTradeSizeSol: 0.01, maxDailyLossSol: 0.05, maxOpenPositions: 2 }, phase7LiveTradingReady: true, ...configOverride }));
  writeFileSync(join(dir, "envelope.json"), envelopeJson());
  writeFileSync(join(dir, "simulation.json"), simulationJson());
  return dir;
}

const baseOpts = (dir: string) => ({
  envelopePath: "envelope.json",
  simulationPath: "simulation.json",
  riskScore: "10",
  signerEnvVar: "HOT_WALLET_FILE",
  rpcUrl: "https://rpc.test",
  ledgerPath: "ledger.json",
  auditLog: "audit.jsonl",
  iUnderstandThisCanLoseRealMoney: true,
  maxSpendSol: "0.005",
  slippageCapBps: "300",
  riskScoreCap: "50",
  out: join(dir, "report.json"),
});

const ctx = (dir: string, rpc: MainnetRpcSeams, env: Record<string, string> = {}) => {
  let t = Date.parse(NOW);
  return {
    cwd: dir,
    env: { [LIVE_TRADING_ENV_FLAG]: LIVE_TRADING_ENV_VALUE, HOT_WALLET_FILE: "/fake/hot.keypair", ...env },
    now: () => new Date(t).toISOString(),
    sleep: async (ms: number) => { t += ms; },
    createMainnetRpc: () => rpc,
    readFile: () => JSON.stringify(Array.from(SIGNER.secretKey)),
  };
};

describe("execution:mainnet:send (CLI boundary)", () => {
  it("refuses with no caps, no config flag, or no env sentence — and journals nothing sent", async () => {
    const dir = setup({ phase7LiveTradingReady: false });
    const w = world([1e9], ["0"]);
    const r = await executionMainnetSendReport(ctx(dir, w.rpc), baseOpts(dir));
    expect(r.exitCode).toBe(1);
    expect(r.text).toContain("REFUSED");
    expect(r.text).toContain("config-phase7-ready");
    expect(w.sent).toHaveLength(0);
    expect(existsSync(join(dir, "ledger.json"))).toBe(false);
    const audit = readFileSync(join(dir, "audit.jsonl"), "utf8").trim().split("\n");
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0] as string).outcome).toBe("refused");
  });

  it("refuses a cap above the hard ceiling or above config", async () => {
    const dir = setup();
    const w = world([1e9], ["0"]);
    const r = await executionMainnetSendReport(ctx(dir, w.rpc), { ...baseOpts(dir), maxSpendSol: "0.02" });
    expect(r.exitCode).toBe(1);
    expect(r.text).toContain("--max-spend-sol must be");
    expect(w.sent).toHaveLength(0);
  });

  it("a confirmed buy writes the ledger (live position with signature), the audit log and the report", async () => {
    const dir = setup();
    const w = world([1e9, 1e9, 1e9, 1e9 - 5_005_000], ["0", "777"]);
    const r = await executionMainnetSendReport(ctx(dir, w.rpc), { ...baseOpts(dir), symbol: "TEST" });
    expect(r.exitCode).toBe(0);
    expect(r.text).toContain("CONFIRMED");
    expect(r.text).toContain(SIG);
    const ledger = JSON.parse(readFileSync(join(dir, "ledger.json"), "utf8"));
    expect(ledger.positions).toHaveLength(1);
    expect(ledger.positions[0].kind).toBe("live");
    expect(ledger.positions[0].entrySignature).toBe(SIG);
    expect(ledger.positions[0].tokenAmountRaw).toBe("777");
    expect(existsSync(join(dir, "report.json"))).toBe(true);
    // Neither artifact carries the secret.
    for (const f of ["ledger.json", "audit.jsonl", "report.json"]) {
      expect(readFileSync(join(dir, f), "utf8")).not.toContain(JSON.stringify(Array.from(SIGNER.secretKey)));
    }
  });

  it("an unconfirmed buy exits 2, writes NO ledger, and journals the pending signature", async () => {
    const dir = setup();
    const w = world([1e9], ["0"], false);
    const r = await executionMainnetSendReport({ ...ctx(dir, w.rpc) }, { ...baseOpts(dir), confirmTimeoutMs: "5000" });
    expect(r.exitCode).toBe(2);
    expect(r.text).toContain("SUBMITTED-UNCONFIRMED");
    expect(existsSync(join(dir, "ledger.json"))).toBe(false);
    expect(readFileSync(join(dir, "audit.jsonl"), "utf8")).toContain(SIG);
  });

  it("the daily loss cap and trade cap are derived from the ledger, not memory", () => {
    const old = new Date(Date.parse(NOW) - 3600_000).toISOString();
    const lost = { ...openPosition({ kind: "live", mint: MINT, openedAt: old, entrySpendLamports: 5_000_000, entrySignature: SIG }) };
    const closed = { ...lost, status: "closed" as const, close: { closedAt: NOW, closeKind: "live-auto" as const, reason: "stop-loss" as const, valueLamports: 3_000_000, pnlLamports: -2_000_000, detail: "", signature: SIG } };
    const s = sessionFromLedger(buildLedger([closed]), Date.parse(NOW));
    expect(s.tradesCount).toBe(1);
    expect(s.sessionLossSol).toBeCloseTo(0.002, 9);
    expect(s.mintsTraded).toEqual([MINT]);
  });
});

describe("execution:mainnet:sell (CLI boundary)", () => {
  it("refuses an unknown position without sending", async () => {
    const dir = setup();
    const w = world([1e9], ["0"]);
    const r = await executionMainnetSellReport(ctx(dir, w.rpc), { ...baseOpts(dir), positionId: "live:nope:x", reason: "take-profit" });
    expect(r.exitCode).toBe(1);
    expect(r.text).toContain("unknown position can never be sold");
    expect(w.sent).toHaveLength(0);
  });

  it("a confirmed sell closes the ledger position with realized PnL and the sell signature", async () => {
    const dir = setup();
    const opened = openPosition({ kind: "live", mint: MINT, openedAt: new Date(Date.parse(NOW) - 60_000).toISOString(), entrySpendLamports: 5_000_000, tokenAmountRaw: "777", entrySignature: "3".repeat(88) });
    writeFileSync(join(dir, "ledger.json"), JSON.stringify(buildLedger([opened])));
    const w = world([1e9, 1e9 + 5_300_000], ["777", "0"]);
    const r = await executionMainnetSellReport(ctx(dir, w.rpc), { ...baseOpts(dir), positionId: opened.positionId, reason: "take-profit" });
    expect(r.exitCode).toBe(0);
    expect(r.text).toContain("PnL 300000");
    const ledger = JSON.parse(readFileSync(join(dir, "ledger.json"), "utf8"));
    expect(ledger.positions[0].status).toBe("closed");
    expect(ledger.positions[0].close.closeKind).toBe("live-auto");
    expect(ledger.positions[0].close.signature).toBe(SIG);
    expect(ledger.totals.realizedPnlKnownLamports).toBe(300_000);
  });
});
