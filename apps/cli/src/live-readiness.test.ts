import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { LIVE_TRADING_ENV_FLAG, LIVE_TRADING_ENV_VALUE } from "@soulmaker/execution";
import { redactValue } from "@soulmaker/security";
import type { MainnetRpcSeams } from "@soulmaker/live";
import { buildLedger, openPosition } from "@soulmaker/live";
import type { SwapTransactionBuilder } from "@soulmaker/txbuilder";
import type { TxPreviewRpc } from "@soulmaker/txpreview";
import { liveReadinessReport, walletHotCreateReport, walletHotPubkeyReport } from "./live-mainnet-commands.js";

const SIGNER = Keypair.generate();
const PUB = SIGNER.publicKey.toBase58();
const OTHER = Keypair.generate().publicKey.toBase58();
const SECRET_JSON = JSON.stringify(Array.from(SIGNER.secretKey));
const dir = () => mkdtempSync(join(tmpdir(), "s111-hot-"));

describe("wallet:hot:create (S111)", () => {
  it("creates a valid 64-byte keypair at --out, prints ONLY the public key, never the secret", () => {
    const d = dir();
    const r = walletHotCreateReport({ cwd: d }, { out: "hot.keypair" });
    expect(r.exitCode, r.text).toBe(0);
    const pub = (r.text.match(/public key:\s+([1-9A-HJ-NP-Za-km-z]{32,44})/) ?? [])[1] as string;
    expect(() => new PublicKey(pub)).not.toThrow();
    const bytes = JSON.parse(readFileSync(join(d, "hot.keypair"), "utf8"));
    expect(bytes).toHaveLength(64);
    expect(Keypair.fromSecretKey(Uint8Array.from(bytes)).publicKey.toBase58()).toBe(pub);
    expect(r.text).not.toContain(JSON.stringify(bytes));
    expect(r.text).not.toMatch(/\[\s*\d+\s*,\s*\d+/);
    expect(redactValue({ note: r.text })).toEqual({ note: r.text });
    if (process.platform !== "win32") expect(statSync(join(d, "hot.keypair")).mode & 0o077).toBe(0);
  });

  it("refuses to overwrite, refuses a non-.keypair destination, and fails safely on an unwritable path", () => {
    const d = dir();
    writeFileSync(join(d, "hot.keypair"), "[]");
    expect(walletHotCreateReport({ cwd: d }, { out: "hot.keypair" }).exitCode).toBe(1);
    expect(readFileSync(join(d, "hot.keypair"), "utf8")).toBe("[]");
    expect(walletHotCreateReport({ cwd: d }, { out: "hot.json" }).text).toMatch(/must end in .keypair/);
    const r = walletHotCreateReport({ cwd: d }, { out: "no/such/dir/hot.keypair" });
    expect(r.exitCode).toBe(1);
    expect(existsSync(join(d, "no"))).toBe(false);
    expect(walletHotCreateReport({ cwd: d }, {}).text).toMatch(/--out/);
  });
});

describe("wallet:hot:pubkey (S111)", () => {
  const ctx = (env: Record<string, string>, file = SECRET_JSON) => ({ env, readFile: () => file });

  it("derives the correct public key and never emits the secret", () => {
    const r = walletHotPubkeyReport(ctx({ HOT_WALLET_FILE: "/x" }), { signerEnvVar: "HOT_WALLET_FILE" });
    expect(r.exitCode).toBe(0);
    expect(r.text).toContain(`SIGNER: ${PUB}`);
    expect(r.text).toContain("KEYPAIR FILE: present");
    expect(r.text).not.toContain(SECRET_JSON);
    expect(r.text).not.toContain("/x");
  });

  it("--wallet match passes; mismatch is reported honestly with exit 1", () => {
    expect(walletHotPubkeyReport(ctx({ HOT_WALLET_FILE: "/x" }), { signerEnvVar: "HOT_WALLET_FILE", wallet: PUB }).text).toContain("PUBLIC KEY MATCH: yes");
    const r = walletHotPubkeyReport(ctx({ HOT_WALLET_FILE: "/x" }), { signerEnvVar: "HOT_WALLET_FILE", wallet: OTHER });
    expect(r.exitCode).toBe(1);
    expect(r.text).toContain("PUBLIC KEY MATCH: NO");
  });

  it("missing env var, unreadable file, and malformed keypair each fail clearly", () => {
    expect(walletHotPubkeyReport({ env: {} }, { signerEnvVar: "HOT_WALLET_FILE" }).text).toMatch(/not set/);
    expect(walletHotPubkeyReport({ env: { HOT_WALLET_FILE: "/nope" }, readFile: () => { throw new Error("ENOENT"); } }, { signerEnvVar: "HOT_WALLET_FILE" }).text).toMatch(/missing or unreadable/);
    expect(walletHotPubkeyReport(ctx({ HOT_WALLET_FILE: "/x" }, "not json"), { signerEnvVar: "HOT_WALLET_FILE" }).text).toMatch(/malformed/);
    expect(walletHotPubkeyReport(ctx({ HOT_WALLET_FILE: "/x" }, "[1,2,3]"), { signerEnvVar: "HOT_WALLET_FILE" }).text).toMatch(/64-byte/);
    expect(walletHotPubkeyReport({ env: {} }, { signerEnvVar: "lower" }).text).toMatch(/UPPER_SNAKE_CASE/);
  });
});

// ---------------------------------------------------------------------------
// live:readiness — the ladder over injected seams (no network)
// ---------------------------------------------------------------------------

const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const MINT = new PublicKey(Buffer.alloc(32, 7)).toBase58();
function txBase64(payer: string): string {
  const pk = new PublicKey(payer);
  const msg = new TransactionMessage({ payerKey: pk, recentBlockhash: new PublicKey(Buffer.alloc(32, 3)).toBase58(), instructions: [SystemProgram.transfer({ fromPubkey: pk, toPubkey: pk, lamports: 1 })] }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");
}

interface RWorld { genesis: string; sol: number; token: string; holdings: Array<{ mint: string; amountRaw: string; program: string }>; simOk: boolean; impact: string }

function readinessCtx(d: string, w: RWorld, env: Record<string, string> = {}) {
  const rpc = {
    endpointHost: "rpc.test",
    send: { getLatestBlockhash: async () => ({ blockhash: "x" }), sendRawTransaction: async () => "y" },
    confirm: { getSignatureStatuses: async () => ({ value: [null] }) },
    balance: { getBalanceLamports: async () => w.sol, getTokenBalanceRaw: async () => w.token, listTokenHoldings: async () => w.holdings },
  } as unknown as MainnetRpcSeams & { balance: MainnetRpcSeams["balance"] & { listTokenHoldings: () => Promise<RWorld["holdings"]> } };
  const swapBuilder: SwapTransactionBuilder = { builderId: "jupiter-swap-api", endpointHost: "jup.test", build: async (req) => ({ built: true, envelope: { schemaVersion: "txpreview.envelope.v1", network: "mainnet-beta", feePayerPublicKey: req.walletPublicKey, txBase64: txBase64(req.walletPublicKey as string), builderId: "jupiter-swap-api", candidateMint: req.candidateMint, routeCaveats: [], constraints: { maxSpendLamports: req.amountRaw, slippageBps: 100 }, quotedAt: new Date().toISOString(), unsigned: true, neverSigned: true, phase7LiveTradingReady: false } as never, quoteFacts: { inAmountRaw: req.amountRaw as string, outAmountRaw: "777", priceImpactPct: w.impact, contextSlot: 1, quotedAt: new Date().toISOString() }, txFacts: {} as never }) };
  const txPreview: TxPreviewRpc = { endpointHost: "rpc.test", rpc: { simulateTransaction: async () => ({ context: { slot: 5 }, value: w.simOk ? { err: null, logs: [], unitsConsumed: 1000 } : { err: { InstructionError: [0, "Custom"] }, logs: [], unitsConsumed: 0 } }) as never } };
  return { cwd: d, env, readFile: () => SECRET_JSON, createMainnetRpc: () => rpc, swapBuilder, txPreview, clusterProbe: async () => ({ genesis: w.genesis, slot: 123 }) };
}

function cfgDir(over: Record<string, unknown> = {}): string {
  const d = dir();
  writeFileSync(join(d, "soulmaker.config.json"), JSON.stringify({ mode: "PAPER", killSwitch: false, caps: { maxTradeSizeSol: 0.01, maxDailyLossSol: 0.05, maxOpenPositions: 2 }, phase7LiveTradingReady: true, ...over }));
  return d;
}

const ARM_ENV = { [LIVE_TRADING_ENV_FLAG]: LIVE_TRADING_ENV_VALUE, HOT_WALLET_FILE: "/fake" };
const CAPS = { iUnderstandThisCanLoseRealMoney: true, wallet: PUB, signerEnvVar: "HOT_WALLET_FILE", rpcUrl: "https://rpc.test", maxSpendSol: "0.005", maxOpenSolExposureSol: "0.01", maxOpenPositions: "1", maxTradesPerHour: "2", sessionLossCapSol: "0.02", slippageBps: "100", maxPriceImpactPct: "1", minSolReserveSol: "0.05", riskScoreCap: "40" };
const GREEN: RWorld = { genesis: MAINNET_GENESIS, sol: 190_000_000, token: "0", holdings: [], simOk: true, impact: "0.1" };
const status = (text: string, name: string) => (text.split("\n").find((l) => l.startsWith(name + " ")) ?? "").replace(/^[^.]+\.+ /, "").split("  ")[0];

describe("live:readiness (S111)", () => {
  it("full green ladder → READY_TO_ARM (and it is the ONLY way to get READY_TO_ARM)", async () => {
    const d = cfgDir();
    const r = await liveReadinessReport(readinessCtx(d, GREEN, ARM_ENV), { ...CAPS, ledgerPath: "ledger.json" });
    expect(r.exitCode, r.text).toBe(0);
    expect(r.text).toContain("LIVE READINESS: READY_TO_ARM");
    expect(status(r.text, "Cluster")).toBe("PASS");
    expect(status(r.text, "Signer")).toBe("PASS");
    expect(status(r.text, "Simulation")).toBe("PASS");
    expect(r.text).toMatch(/Reconciliation .* PASS {2}no unresolved positions/);
    expect(r.text).not.toContain(SECRET_JSON);
  });

  it("signer absent → Signer BLOCKED and verdict READY_TO_SIMULATE (never READY_TO_ARM)", async () => {
    const d = cfgDir();
    const r = await liveReadinessReport(readinessCtx(d, GREEN, {}), { ...CAPS, signerEnvVar: undefined });
    expect(r.exitCode).toBe(1);
    expect(status(r.text, "Signer")).toBe("BLOCKED_CONFIG");
    expect(r.text).toContain("LIVE READINESS: READY_TO_SIMULATE");
    expect(r.text).toContain("wallet:hot:create");
  });

  it("signer ≠ --wallet → BLOCKED with the signer named", async () => {
    const d = cfgDir();
    const r = await liveReadinessReport(readinessCtx(d, GREEN, ARM_ENV), { ...CAPS, wallet: OTHER });
    expect(status(r.text, "Signer")).toBe("BLOCKED_CONFIG");
    expect(r.text).toContain(`signer is ${PUB}`);
    expect(r.text).not.toContain("READY_TO_ARM");
  });

  it("wrong cluster → FAIL_PROVIDER and BLOCKED", async () => {
    const d = cfgDir();
    const r = await liveReadinessReport(readinessCtx(d, { ...GREEN, genesis: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" }, ARM_ENV), CAPS);
    expect(status(r.text, "Cluster")).toBe("FAIL_PROVIDER");
    expect(r.text).toContain("LIVE READINESS: BLOCKED");
  });

  it("unfunded wallet and insufficient reserve → BLOCKED_WALLET_UNFUNDED", async () => {
    const d = cfgDir();
    const zero = await liveReadinessReport(readinessCtx(d, { ...GREEN, sol: 0 }, ARM_ENV), CAPS);
    expect(status(zero.text, "Balance")).toBe("BLOCKED_WALLET_UNFUNDED");
    expect(zero.text).toContain("LIVE READINESS: BLOCKED");
    const thin = await liveReadinessReport(readinessCtx(d, { ...GREEN, sol: 30_000_000 }, ARM_ENV), CAPS); // 0.03 < 0.005 spend + 0.05 reserve
    expect(status(thin.text, "Reserve")).toBe("BLOCKED_WALLET_UNFUNDED");
  });

  it("a missing hard cap, a missing config flag, and a HARD STOP each BLOCK", async () => {
    const d = cfgDir();
    const noCap = await liveReadinessReport(readinessCtx(d, GREEN, ARM_ENV), { ...CAPS, maxSpendSol: undefined });
    expect(status(noCap.text, "Risk caps")).toBe("BLOCKED_CONFIG");
    expect(noCap.text).toMatch(/--max-spend-sol is required/);
    const noFlag = await liveReadinessReport(readinessCtx(cfgDir({ phase7LiveTradingReady: false }), GREEN, ARM_ENV), CAPS);
    expect(noFlag.text).toMatch(/phase7LiveTradingReady must be true/);
    writeFileSync(join(d, ".soulmaker-emergency-stop"), "");
    const stopped = await liveReadinessReport(readinessCtx(d, GREEN, ARM_ENV), CAPS);
    expect(status(stopped.text, "Hard stop")).toBe("BLOCKED_STOP");
    expect(stopped.text).toContain("LIVE READINESS: BLOCKED");
  });

  it("simulation failure → FAIL_SIMULATION and BLOCKED; blocked reconciliation → BLOCKED_RECONCILE", async () => {
    const d = cfgDir();
    const sim = await liveReadinessReport(readinessCtx(d, { ...GREEN, simOk: false }, ARM_ENV), CAPS);
    expect(status(sim.text, "Simulation")).toBe("FAIL_SIMULATION");
    expect(sim.text).toContain("LIVE READINESS: BLOCKED");
    const open = openPosition({ kind: "live", mint: MINT, openedAt: new Date(Date.now() - 60_000).toISOString(), entrySpendLamports: 5_000_000, tokenAmountRaw: "777", entrySignature: "3".repeat(88) });
    writeFileSync(join(d, "ledger.json"), JSON.stringify(buildLedger([open])));
    const rec = await liveReadinessReport(readinessCtx(d, { ...GREEN, token: "0" }, ARM_ENV), { ...CAPS, ledgerPath: "ledger.json" });
    expect(status(rec.text, "Reconciliation")).toBe("BLOCKED_RECONCILE");
    expect(rec.text).toContain("0 on chain");
  });

  it("--json emits a stable structured report without secrets", async () => {
    const d = cfgDir();
    const r = await liveReadinessReport(readinessCtx(d, GREEN, ARM_ENV), { ...CAPS, json: true });
    const j = JSON.parse(r.text);
    expect(j.schemaVersion).toBe("live.readiness.v1");
    expect(j.verdict).toBe("READY_TO_ARM");
    expect(j.checks.every((c: { status: string }) => typeof c.status === "string")).toBe(true);
    expect(r.text).not.toContain(SECRET_JSON);
  });
});
