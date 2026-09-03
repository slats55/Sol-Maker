import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { loadConfig } from "@soulmaker/core";
import { LIVE_TRADING_ENV_FLAG, LIVE_TRADING_ENV_VALUE } from "@soulmaker/execution";
import { buildLedger, openPosition, type MainnetRpcSeams } from "@soulmaker/live";
import type { SwapTransactionBuilder } from "@soulmaker/txbuilder";
import type { TxPreviewRpc } from "@soulmaker/txpreview";
import { LiveExecutor, resolveLiveArming, stopState, SELL_RETRY_CEILING, NO_ENTRY_FILE, EMERGENCY_STOP_FILE } from "./live-executor.js";

const SIGNER = Keypair.generate();
const WALLET = SIGNER.publicKey.toBase58();
const MINT = new PublicKey(Buffer.alloc(32, 7)).toBase58();
const BLOCKHASH = new PublicKey(Buffer.alloc(32, 3)).toBase58();
const SIG = "6".repeat(88);
const T0 = Date.parse("2026-09-03T12:00:00.000Z");

const ENV = { [LIVE_TRADING_ENV_FLAG]: LIVE_TRADING_ENV_VALUE, HOT_WALLET_FILE: "/fake/hot.keypair" };
const OPTS = { iUnderstandThisCanLoseRealMoney: true, wallet: WALLET, signerEnvVar: "HOT_WALLET_FILE", rpcUrl: "https://rpc.test", maxSpendSol: "0.005", maxOpenSolExposureSol: "0.01", maxOpenPositions: "2", maxTradesPerHour: "3", sessionLossCapSol: "0.02", slippageBps: "100", maxPriceImpactPct: "1", minSolReserveSol: "0.01", riskScoreCap: "50" };

function configDir(over: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "s111-exec-"));
  writeFileSync(join(dir, "soulmaker.config.json"), JSON.stringify({ mode: "PAPER", killSwitch: false, caps: { maxTradeSizeSol: 0.01, maxDailyLossSol: 0.05, maxOpenPositions: 2 }, phase7LiveTradingReady: true, ...over }));
  return dir;
}

function envelope(candidateMint: string): Record<string, unknown> {
  const message = new TransactionMessage({ payerKey: SIGNER.publicKey, recentBlockhash: BLOCKHASH, instructions: [SystemProgram.transfer({ fromPubkey: SIGNER.publicKey, toPubkey: SIGNER.publicKey, lamports: 1 })] }).compileToV0Message();
  return { schemaVersion: "txpreview.envelope.v1", network: "mainnet-beta", feePayerPublicKey: WALLET, txBase64: Buffer.from(new VersionedTransaction(message).serialize()).toString("base64"), builderId: "jupiter-swap-api", candidateMint, routeCaveats: [], constraints: { maxSpendLamports: "5000000", slippageBps: 100 }, quotedAt: new Date(T0 - 1000).toISOString(), unsigned: true, neverSigned: true, phase7LiveTradingReady: false };
}

interface World { builds: number; sims: number; sent: Uint8Array[]; impact: string; simOk: boolean; status: unknown; sol: number[]; token: string[] }

function deps(dir: string, w: World) {
  let t = T0;
  let si = 0, ti = 0;
  const swapBuilder: SwapTransactionBuilder = {
    builderId: "jupiter-swap-api",
    endpointHost: "jup.test",
    build: async (req) => { w.builds++; return { built: true, envelope: envelope(req.candidateMint as string) as never, quoteFacts: { inAmountRaw: req.amountRaw as string, outAmountRaw: "777", priceImpactPct: w.impact, contextSlot: 1, quotedAt: new Date(t).toISOString() }, txFacts: {} as never }; },
  };
  const txPreview: TxPreviewRpc = { endpointHost: "rpc.test", rpc: { simulateTransaction: async () => { w.sims++; return { context: { slot: 5 }, value: w.simOk ? { err: null, logs: [], unitsConsumed: 1000 } : { err: { InstructionError: [0, "Custom"] }, logs: [], unitsConsumed: 0 } } as never; } } };
  const rpc: MainnetRpcSeams = {
    endpointHost: "rpc.test",
    send: { getLatestBlockhash: async () => ({ blockhash: BLOCKHASH }), sendRawTransaction: async (b) => { w.sent.push(b); return SIG; } },
    confirm: { getSignatureStatuses: async () => ({ value: [w.status as never] }) },
    balance: { getBalanceLamports: async () => w.sol[Math.min(si++, w.sol.length - 1)] as number, getTokenBalanceRaw: async () => w.token[Math.min(ti++, w.token.length - 1)] as string },
  };
  const config = loadConfig({ cwd: dir, env: ENV });
  const arming = resolveLiveArming(ENV, config, OPTS);
  if (!arming.ok) throw new Error(arming.reasons.join("; "));
  return { cwd: dir, env: ENV, config, arming: arming.value, auditLogPath: "audit.jsonl", intentsPath: "intents.json", swapBuilder, txPreview, rpc, readFile: () => JSON.stringify(Array.from(SIGNER.secretKey)), nowMs: () => t, clock: () => new Date(t).toISOString(), sleep: async (ms: number) => { t += ms; } };
}

const CONFIRMED = { slot: 9, err: null, confirmationStatus: "confirmed" };
const world = (over: Partial<World> = {}): World => ({ builds: 0, sims: 0, sent: [], impact: "0.1", simOk: true, status: CONFIRMED, sol: [1e9, 1e9, 1e9, 1e9 - 5_005_000], token: ["0", "777"], ...over });

describe("resolveLiveArming (S111) — fails closed", () => {
  it("refuses without the env sentence, config flag, acknowledgment, wallet, signer env, or ANY cap", () => {
    const dir = configDir();
    const config = loadConfig({ cwd: dir, env: ENV });
    const none = resolveLiveArming({}, { ...config, phase7LiveTradingReady: false }, {});
    expect(none.ok).toBe(false);
    if (!none.ok) {
      expect(none.reasons.join("\n")).toContain(LIVE_TRADING_ENV_FLAG);
      expect(none.reasons.join("\n")).toContain("phase7LiveTradingReady");
      expect(none.reasons.join("\n")).toContain("--i-understand-this-can-lose-real-money");
      expect(none.reasons.join("\n")).toContain("--wallet");
      expect(none.reasons.join("\n")).toContain("--signer-env");
      expect(none.reasons.join("\n")).toContain("--max-spend-sol");
    }
    for (const missing of ["maxSpendSol", "maxOpenSolExposureSol", "maxOpenPositions", "maxTradesPerHour", "sessionLossCapSol", "slippageBps", "maxPriceImpactPct", "minSolReserveSol", "riskScoreCap"] as const) {
      const r = resolveLiveArming(ENV, config, { ...OPTS, [missing]: undefined });
      expect(r.ok, missing).toBe(false);
    }
  });

  it("caps may only tighten: above the hard ceiling or above config is refused", () => {
    const config = loadConfig({ cwd: configDir(), env: ENV });
    expect(resolveLiveArming(ENV, config, { ...OPTS, maxSpendSol: "0.02" }).ok).toBe(false);
    expect(resolveLiveArming(ENV, config, { ...OPTS, maxTradesPerHour: "99" }).ok).toBe(false);
    expect(resolveLiveArming(ENV, config, { ...OPTS, maxOpenPositions: "3" }).ok).toBe(false);
    const ok = resolveLiveArming(ENV, config, OPTS);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.caps.maxSpendLamports).toBe("5000000");
  });
});

describe("stopState (S111)", () => {
  it("none → safe-stop (no-entry file / env) → hard-stop (emergency stop / kill switch), hard wins", () => {
    const dir = mkdtempSync(join(tmpdir(), "s111-stop-"));
    expect(stopState({ cwd: dir, env: {}, configKillSwitch: false })).toBe("none");
    expect(stopState({ cwd: dir, env: { SOULMAKER_NO_NEW_ENTRIES: "true" }, configKillSwitch: false })).toBe("safe-stop");
    writeFileSync(join(dir, NO_ENTRY_FILE), "");
    expect(stopState({ cwd: dir, env: {}, configKillSwitch: false })).toBe("safe-stop");
    expect(stopState({ cwd: dir, env: {}, configKillSwitch: true })).toBe("hard-stop");
    writeFileSync(join(dir, EMERGENCY_STOP_FILE), "");
    expect(stopState({ cwd: dir, env: {}, configKillSwitch: false })).toBe("hard-stop");
  });
});

describe("LiveExecutor.buy (S111)", () => {
  it("SAFE STOP refuses entry with nothing built or sent", async () => {
    const dir = configDir(); const w = world(); const ex = new LiveExecutor(deps(dir, w));
    const r = await ex.buy({ ledger: buildLedger([]), mint: MINT, symbol: null, spendLamports: "5000000", riskScore: 10, riskDecision: "PASS", riskFlags: [], stop: "safe-stop" });
    expect(r.kind).toBe("refused");
    expect(w.builds).toBe(0); expect(w.sent).toHaveLength(0);
  });

  it("HARD STOP refuses entry at the daemon AND, if bypassed, the execution core refuses too (kill-switch-clear)", async () => {
    const dir = configDir(); const w = world(); const ex = new LiveExecutor(deps(dir, w));
    const daemonLevel = await ex.buy({ ledger: buildLedger([]), mint: MINT, symbol: null, spendLamports: "5000000", riskScore: 10, riskDecision: "PASS", riskFlags: [], stop: "hard-stop" });
    expect(daemonLevel.kind).toBe("refused"); expect(w.sent).toHaveLength(0);
    // Bypass the daemon-level check: the core must still refuse because the config kill switch is on.
    const dirKill = configDir({ killSwitch: true }); const w2 = world(); const ex2 = new LiveExecutor(deps(dirKill, w2));
    const core = await ex2.buy({ ledger: buildLedger([]), mint: MINT, symbol: null, spendLamports: "5000000", riskScore: 10, riskDecision: "PASS", riskFlags: [], stop: "none" });
    expect(core.kind).toBe("executed");
    if (core.kind === "executed") { expect(core.report.outcome).toBe("refused"); expect(core.report.refusalDetail).toContain("kill-switch-clear"); }
    expect(w2.sent).toHaveLength(0);
  });

  it("price impact over the cap, or a failed simulation, refuses before any send", async () => {
    const dir = configDir(); const w = world({ impact: "2.5" }); const ex = new LiveExecutor(deps(dir, w));
    const r = await ex.buy({ ledger: buildLedger([]), mint: MINT, symbol: null, spendLamports: "5000000", riskScore: 10, riskDecision: "PASS", riskFlags: [], stop: "none" });
    expect(r.kind).toBe("refused"); if (r.kind === "refused") expect(r.reason).toContain("price impact");
    const w2 = world({ simOk: false }); const ex2 = new LiveExecutor(deps(dir, w2));
    const r2 = await ex2.buy({ ledger: buildLedger([]), mint: MINT, symbol: null, spendLamports: "5000000", riskScore: 10, riskDecision: "PASS", riskFlags: [], stop: "none" });
    expect(r2.kind).toBe("refused"); if (r2.kind === "refused") expect(r2.reason).toContain("simulation");
    expect(w.sent.length + w2.sent.length).toBe(0);
  });

  it("a confirmed buy returns a live position with the signature, journals the audit line, and marks the intent done", async () => {
    const dir = configDir(); const w = world(); const ex = new LiveExecutor(deps(dir, w));
    const r = await ex.buy({ ledger: buildLedger([]), mint: MINT, symbol: "T", spendLamports: "5000000", riskScore: 10, riskDecision: "PASS", riskFlags: [], stop: "none" });
    expect(r.kind).toBe("executed");
    if (r.kind === "executed") { expect(r.report.outcome).toBe("confirmed"); expect(r.report.position?.entrySignature).toBe(SIG); expect(r.report.ledger.totals.open).toBe(1); }
    expect(readFileSync(join(dir, "audit.jsonl"), "utf8")).toContain(SIG);
    expect(JSON.parse(readFileSync(join(dir, "intents.json"), "utf8"))[0].state).toBe("done");
    expect(ex.lingeringIntents()).toHaveLength(0);
  });

  it("Invariant 3: a lingering in-flight intent (crash mid-send) is surfaced on load and blocks a re-buy of that mint", async () => {
    const dir = configDir(); const w = world();
    writeFileSync(join(dir, "intents.json"), JSON.stringify([{ intentId: "buy:x", mint: MINT, side: "buy", at: new Date(T0).toISOString(), state: "in-flight" }]));
    const ex = new LiveExecutor(deps(dir, w));
    expect(ex.loadIntents()).toHaveLength(1);
    expect(ex.lingeringIntents()[0]?.mint).toBe(MINT);
    const r = await ex.buy({ ledger: buildLedger([]), mint: MINT, symbol: null, spendLamports: "5000000", riskScore: 10, riskDecision: "PASS", riskFlags: [], stop: "none" });
    expect(r.kind).toBe("refused"); if (r.kind === "refused") expect(r.reason).toContain("in flight");
    expect(w.sent).toHaveLength(0);
  });

  it("hour cap and aggregate exposure cap derive from the ledger and refuse", async () => {
    const dir = configDir(); const w = world(); const ex = new LiveExecutor(deps(dir, w));
    const mk = (i: number, open: boolean) => { const p = openPosition({ kind: "live", mint: new PublicKey(Buffer.alloc(32, 20 + i)).toBase58(), openedAt: new Date(T0 - 60_000 * i).toISOString(), entrySpendLamports: 4_000_000, entrySignature: "3".repeat(88) }); return open ? p : { ...p, status: "closed" as const, close: { closedAt: new Date(T0).toISOString(), closeKind: "live-auto" as const, reason: "take-profit" as const, valueLamports: 4_000_000, pnlLamports: 0, detail: "", signature: "3".repeat(88) } }; };
    const hourCap = await ex.buy({ ledger: buildLedger([mk(1, false), mk(2, false), mk(3, false)]), mint: MINT, symbol: null, spendLamports: "5000000", riskScore: 10, riskDecision: "PASS", riskFlags: [], stop: "none" });
    expect(hourCap.kind).toBe("refused"); if (hourCap.kind === "refused") expect(hourCap.reason).toContain("hour cap");
    const exposure = await ex.buy({ ledger: buildLedger([mk(1, true), mk(2, true)]), mint: MINT, symbol: null, spendLamports: "5000000", riskScore: 10, riskDecision: "PASS", riskFlags: [], stop: "none" });
    expect(exposure.kind).toBe("refused"); if (exposure.kind === "refused") expect(exposure.reason).toContain("exposure");
    expect(w.sent).toHaveLength(0);
  });
});

describe("LiveExecutor.sell (S111)", () => {
  const OPENED = openPosition({ kind: "live", mint: MINT, openedAt: new Date(T0 - 120_000).toISOString(), entrySpendLamports: 5_000_000, tokenAmountRaw: "777", entrySignature: "3".repeat(88) });
  const sellArgs = (stop: "none" | "safe-stop" | "hard-stop") => ({ ledger: buildLedger([OPENED]), position: OPENED, reason: "take-profit" as const, detail: "tp", stop });

  it("SAFE STOP still permits an exit; HARD STOP refuses the send", async () => {
    const dir = configDir(); const w = world({ sol: [1e9, 1e9 + 5_500_000], token: ["777", "0"] }); const ex = new LiveExecutor(deps(dir, w));
    const safe = await ex.sell(sellArgs("safe-stop"));
    expect(safe.kind).toBe("executed"); if (safe.kind === "executed") { expect(safe.report.outcome).toBe("confirmed"); expect(safe.report.position?.close?.pnlLamports).toBe(500_000); }
    expect(w.sent).toHaveLength(1);
    expect(ex.exitStateFor(OPENED.positionId)?.state).toBe("CLOSED");
    const w2 = world(); const ex2 = new LiveExecutor(deps(dir, w2));
    const hard = await ex2.sell(sellArgs("hard-stop"));
    expect(hard.kind).toBe("refused"); expect(w2.sent).toHaveLength(0);
  });

  it("every retry rebuilds + resimulates (fresh quote/blockhash); failures back off and hit the terminal ceiling; the position stays OPEN", async () => {
    const dir = configDir(); const w = world({ simOk: false }); const d = deps(dir, w); const ex = new LiveExecutor(d);
    let last = await ex.sell(sellArgs("none"));
    expect(last.kind).toBe("refused"); if (last.kind === "refused") expect(last.reason).toContain("EXIT_FAILED_RETRYABLE");
    expect(w.builds).toBe(1); expect(w.sims).toBe(1);
    const backoff = await ex.sell(sellArgs("none"));
    expect(backoff.kind).toBe("refused"); if (backoff.kind === "refused") expect(backoff.reason).toContain("backoff");
    expect(w.builds).toBe(1);
    for (let i = 1; i < SELL_RETRY_CEILING; i++) { await d.sleep(600_000); last = await ex.sell(sellArgs("none")); }
    expect(w.builds).toBe(SELL_RETRY_CEILING);
    expect(ex.exitStateFor(OPENED.positionId)?.state).toBe("EXIT_FAILED_TERMINAL");
    await d.sleep(600_000);
    const terminal = await ex.sell(sellArgs("none"));
    expect(terminal.kind).toBe("refused"); if (terminal.kind === "refused") expect(terminal.reason).toContain("retry ceiling");
    expect(w.sent).toHaveLength(0);
  });

  it("an UNCONFIRMED sell becomes EXIT_PENDING, is never retried, and the position stays OPEN", async () => {
    const dir = configDir(); const w = world({ status: null, token: ["777"] }); const d = deps(dir, w); const ex = new LiveExecutor(d);
    const r = await ex.sell(sellArgs("none"));
    expect(r.kind).toBe("executed"); if (r.kind === "executed") { expect(r.report.outcome).toBe("submitted-unconfirmed"); expect(r.report.ledger.positions[0]?.status).toBe("open"); }
    expect(ex.exitStateFor(OPENED.positionId)?.state).toBe("EXIT_PENDING");
    await d.sleep(3_600_000);
    const again = await ex.sell(sellArgs("none"));
    expect(again.kind).toBe("refused");
    expect(w.sent).toHaveLength(1);
  });

  it("artifacts never carry the secret", async () => {
    const dir = configDir(); const w = world(); const ex = new LiveExecutor(deps(dir, w));
    await ex.buy({ ledger: buildLedger([]), mint: MINT, symbol: null, spendLamports: "5000000", riskScore: 10, riskDecision: "PASS", riskFlags: [], stop: "none" });
    for (const f of ["audit.jsonl", "intents.json"]) if (existsSync(join(dir, f))) expect(readFileSync(join(dir, f), "utf8")).not.toContain(JSON.stringify(Array.from(SIGNER.secretKey)));
  });
});
