/**
 * MAINNET EXECUTION COMMANDS (Sprint 111) — `execution:mainnet:send` and `execution:mainnet:sell`.
 *
 * These are the first commands in Sol Maker that can move real funds on mainnet, and they are
 * built to be the hardest to reach: the fourteen-condition live gate (env sentence + config
 * `phase7LiveTradingReady` + explicit CLI acknowledgment + explicit caps + kill switch clear +
 * fresh quote + green simulation of the EXACT envelope + risk under cap + signer boundary +
 * audit log), a signer that must BE the envelope's fee payer, and a ledger that records a
 * position ONLY when the transaction has CONFIRMED on-chain.
 *
 * Every attempt — refused, failed, unconfirmed, confirmed — is appended to the audit log.
 * The keypair file PATH comes from an env var NAME; the path and bytes are never printed.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import { loadConfig, ConfigError } from "@soulmaker/core";
import type { Config, LoadConfigOptions } from "@soulmaker/core";
import { createBalanceRpc, createSendRpc, LIVE_TRADING_ENV_FLAG, LIVE_TRADING_ENV_VALUE } from "@soulmaker/execution";
import type { SessionState } from "@soulmaker/execution";
import { redactString, redactValue } from "@soulmaker/security";
import {
  buildLedger,
  executeMainnetBuy,
  executeMainnetSell,
  LAMPORTS_PER_SOL,
  validateLedger,
  EXIT_REASONS,
} from "@soulmaker/live";
import type { ExitReason, MainnetCaps, MainnetExecutionReport, MainnetRpcSeams, PositionLedger } from "@soulmaker/live";
import { Connection, Keypair } from "@solana/web3.js";
import type { HoldingsRpcLike } from "@soulmaker/execution";
import { reconcileStartup } from "@soulmaker/live";
import { createJupiterSwapBuilder } from "@soulmaker/txbuilder";
import type { SwapTransactionBuilder } from "@soulmaker/txbuilder";
import { createTxPreviewRpc, simulateUnsignedEnvelope } from "@soulmaker/txpreview";
import type { TxPreviewRpc } from "@soulmaker/txpreview";
import { resolveLiveArming, stopState } from "./live-executor.js";
import type { LiveArming, LiveArmingOptions } from "./live-executor.js";

export interface LiveMainnetContext {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  configPath?: string;
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
  /** Factory for the three mainnet RPC seams; injected in tests so the suite never touches the network. */
  createMainnetRpc?: (rpcUrl: string) => MainnetRpcSeams;
  /** Injected keypair-file reader (tests); default readFileSync. Never logs. */
  readFile?: (path: string) => string;
}

export interface LiveMainnetReport {
  text: string;
  exitCode: number;
}

/** Production factory: send + confirm + balances over one endpoint, exposing only what each needs. */
export function createMainnetRpcSeams(rpcUrl: string): MainnetRpcSeams {
  const send = createSendRpc(rpcUrl);
  const balance = createBalanceRpc(rpcUrl);
  const connection = new Connection(rpcUrl, "confirmed");
  return Object.freeze({
    endpointHost: send.endpointHost,
    send: send.rpc,
    balance: balance.rpc,
    confirm: Object.freeze({
      getSignatureStatuses: async (signatures: string[]) => {
        const res = await connection.getSignatureStatuses(signatures, { searchTransactionHistory: true });
        return { value: res.value.map((v) => (v ? { slot: v.slot, err: v.err, confirmationStatus: v.confirmationStatus ?? null } : null)) };
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// Shared option parsing
// ---------------------------------------------------------------------------

export interface MainnetCommonOptions {
  envelopePath?: string;
  simulationPath?: string;
  riskScore?: string;
  signerEnvVar?: string;
  rpcUrl?: string;
  ledgerPath?: string;
  auditLog?: string;
  iUnderstandThisCanLoseRealMoney?: boolean;
  maxSpendSol?: string;
  slippageCapBps?: string;
  riskScoreCap?: string;
  maxQuoteAgeMs?: string;
  sessionLossCapSol?: string;
  minSolReserveSol?: string;
  maxTradesPerDay?: string;
  confirmTimeoutMs?: string;
  out?: string;
  force?: boolean;
  json?: boolean;
}

export interface MainnetSendOptions extends MainnetCommonOptions {
  symbol?: string;
}

export interface MainnetSellOptions extends MainnetCommonOptions {
  positionId?: string;
  reason?: string;
}

/** Hard ceilings for this command surface — a CLI cap may only tighten below these. */
export const MAINNET_HARD_CEILINGS = {
  maxSpendSol: 0.05,
  maxSlippageBps: 500,
  maxQuoteAgeMs: 15_000,
  maxConfirmTimeoutMs: 120_000,
  maxTradesPerDay: 50,
} as const;

function resolvePath(ctx: LiveMainnetContext, path: string): string {
  const base = ctx.cwd ?? process.cwd();
  return isAbsolute(path) ? normalize(path) : join(base, path);
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readJson(ctx: LiveMainnetContext, path: string, label: string): unknown {
  const resolved = resolvePath(ctx, path);
  if (!existsSync(resolved)) throw new Error(`${label} not found at ${path}`);
  try {
    return JSON.parse(stripBom(readFileSync(resolved, "utf8")));
  } catch {
    throw new Error(`${label} at ${path} is not valid JSON`);
  }
}

function emergencyStopPresent(ctx: LiveMainnetContext): boolean {
  const env = ctx.env ?? process.env;
  if (typeof env["SOULMAKER_EMERGENCY_STOP"] === "string" && env["SOULMAKER_EMERGENCY_STOP"].length > 0) return true;
  return existsSync(resolvePath(ctx, ".soulmaker-emergency-stop"));
}

function num(value: string | undefined, label: string, opts: { min: number; max: number; integer?: boolean }): number {
  if (value === undefined) throw new Error(`--${label} is required (explicit caps only; there is no default that can trade)`);
  const n = Number(value);
  if (!Number.isFinite(n) || (opts.integer && !Number.isInteger(n)) || n < opts.min || n > opts.max) {
    throw new Error(`--${label} must be ${opts.integer ? "an integer" : "a number"} in [${opts.min}, ${opts.max}] (caps only tighten)`);
  }
  return n;
}

interface Prepared {
  config: Config;
  env: Record<string, string | undefined>;
  caps: MainnetCaps;
  ledger: PositionLedger;
  ledgerPath: string;
  session: SessionState;
  rpc: MainnetRpcSeams;
  envelopeValue: unknown;
  simulationValue: unknown;
  riskScore: number;
  confirmTimeoutMs: number;
}

/** Derive the session (last 24h) from the persisted ledger — the truth, not process memory. */
export function sessionFromLedger(ledger: PositionLedger, nowMs: number): SessionState {
  const dayAgo = nowMs - 24 * 3600_000;
  const recent = ledger.positions.filter((p) => p.kind === "live" && Date.parse(p.openedAt) >= dayAgo);
  let lossLamports = 0;
  let last: number | null = null;
  for (const p of recent) {
    const pnl = p.close?.pnlLamports ?? null;
    if (pnl !== null && pnl < 0) lossLamports += -pnl;
    const t = Date.parse(p.openedAt);
    if (last === null || t > last) last = t;
  }
  return { tradesCount: recent.length, sessionLossSol: lossLamports / LAMPORTS_PER_SOL, lastTradeAtMs: last, mintsTraded: recent.map((p) => p.mint) };
}

function prepare(ctx: LiveMainnetContext, opts: MainnetCommonOptions): { ok: true; value: Prepared } | { ok: false; text: string } {
  const refuse = (m: string): { ok: false; text: string } => ({ ok: false, text: redactString(`Refusing: ${m}`) });
  if (!opts.envelopePath) return refuse("--envelope <path> is required.");
  if (!opts.simulationPath) return refuse("--simulation <path> is required (a green paper:simulation:tx report for the EXACT envelope).");
  if (!opts.signerEnvVar) return refuse("--signer-env <ENV_VAR_NAME> is required (the NAME of the env var holding the hot-wallet keypair file PATH).");
  if (!opts.auditLog) return refuse("--audit-log <path> is required (every attempt is journaled).");
  if (!opts.ledgerPath) return refuse("--ledger <path> is required (positions persist here; process memory is not truth).");
  if (!opts.rpcUrl) return refuse("--rpc-url <url> is required (no default mainnet endpoint can trade).");
  if (opts.riskScore === undefined || !Number.isFinite(Number(opts.riskScore))) return refuse("--risk-score <n> is required (from token:risk).");
  if (!/^[A-Z][A-Z0-9_]*$/.test(opts.signerEnvVar)) return refuse("--signer-env must be an UPPER_SNAKE_CASE env var NAME, never a path or key.");

  let config: Config;
  try {
    config = loadConfig({ cwd: ctx.cwd, env: ctx.env, configPath: ctx.configPath } satisfies LoadConfigOptions);
  } catch (err) {
    return refuse(`config is invalid.\n\n${err instanceof ConfigError ? err.message : String(err)}`);
  }
  const env = (ctx.env ?? process.env) as Record<string, string | undefined>;

  let caps: MainnetCaps;
  let confirmTimeoutMs: number;
  try {
    const maxSpendSol = num(opts.maxSpendSol, "max-spend-sol", { min: 0.000001, max: Math.min(MAINNET_HARD_CEILINGS.maxSpendSol, config.caps.maxTradeSizeSol) });
    const sessionLossCapSol = num(opts.sessionLossCapSol ?? String(config.caps.maxDailyLossSol), "session-loss-cap-sol", { min: 0.000001, max: config.caps.maxDailyLossSol });
    caps = {
      maxSpendLamports: String(Math.round(maxSpendSol * LAMPORTS_PER_SOL)),
      sessionLossCapSol,
      slippageCapBps: num(opts.slippageCapBps, "slippage-cap-bps", { min: 1, max: MAINNET_HARD_CEILINGS.maxSlippageBps, integer: true }),
      riskScoreCap: num(opts.riskScoreCap, "risk-score-cap", { min: 0, max: 100, integer: true }),
      quoteAgeCapMs: num(opts.maxQuoteAgeMs ?? "8000", "max-quote-age-ms", { min: 500, max: MAINNET_HARD_CEILINGS.maxQuoteAgeMs, integer: true }),
      maxTradesPerSession: num(opts.maxTradesPerDay ?? "10", "max-trades-per-day", { min: 1, max: MAINNET_HARD_CEILINGS.maxTradesPerDay, integer: true }),
      maxOpenPositions: config.caps.maxOpenPositions,
      minSolReserveLamports: Math.round(num(opts.minSolReserveSol ?? "0.01", "min-sol-reserve-sol", { min: 0, max: 1000 }) * LAMPORTS_PER_SOL),
    };
    confirmTimeoutMs = num(opts.confirmTimeoutMs ?? "45000", "confirm-timeout-ms", { min: 5_000, max: MAINNET_HARD_CEILINGS.maxConfirmTimeoutMs, integer: true });
  } catch (err) {
    return refuse((err as Error).message);
  }

  let ledger: PositionLedger;
  try {
    ledger = existsSync(resolvePath(ctx, opts.ledgerPath)) ? validateLedger(readJson(ctx, opts.ledgerPath, "position ledger")) : buildLedger();
  } catch (err) {
    return refuse(`the position ledger could not be read (${(err as Error).message}) — an unreadable ledger never authorizes a trade.`);
  }
  let envelopeValue: unknown;
  let simulationValue: unknown;
  try {
    envelopeValue = readJson(ctx, opts.envelopePath, "unsigned tx envelope");
    simulationValue = readJson(ctx, opts.simulationPath, "simulation report");
  } catch (err) {
    return refuse((err as Error).message);
  }
  let rpc: MainnetRpcSeams;
  try {
    rpc = (ctx.createMainnetRpc ?? createMainnetRpcSeams)(opts.rpcUrl);
  } catch (err) {
    return refuse((err as Error).message);
  }
  const nowMs = ctx.now ? Date.parse(ctx.now()) : Date.now();
  return { ok: true, value: { config, env, caps, ledger, ledgerPath: opts.ledgerPath, session: sessionFromLedger(ledger, nowMs), rpc, envelopeValue, simulationValue, riskScore: Number(opts.riskScore), confirmTimeoutMs } };
}

// ---------------------------------------------------------------------------
// Reporting + persistence (shared)
// ---------------------------------------------------------------------------

function persist(ctx: LiveMainnetContext, opts: MainnetCommonOptions, p: Prepared, report: MainnetExecutionReport): string[] {
  const notes: string[] = [];
  // 1) Audit log FIRST — refused or not, the attempt is journaled before anything else.
  try {
    appendFileSync(resolvePath(ctx, opts.auditLog as string), JSON.stringify(redactValue({ ...report, ledger: undefined })) + "\n");
  } catch {
    notes.push(`WARNING: could not append the audit log at ${opts.auditLog}`);
  }
  // 2) Ledger — written whenever a position opened or closed. A landed tx must never be lost.
  if (report.position) {
    try {
      writeFileSync(resolvePath(ctx, p.ledgerPath), JSON.stringify(redactValue(report.ledger), null, 2) + "\n");
      notes.push(`ledger updated: ${p.ledgerPath}`);
    } catch {
      notes.push(`CRITICAL: the transaction LANDED (${report.signature}) but the ledger at ${p.ledgerPath} could not be written — record it by hand NOW`);
    }
  }
  // 3) Optional full report.
  if (opts.out) {
    const resolved = resolvePath(ctx, opts.out);
    if (existsSync(resolved) && !opts.force) notes.push(`--out ${opts.out} exists (use --force); report not written`);
    else {
      try {
        writeFileSync(resolved, JSON.stringify(redactValue(report), null, 2) + "\n");
        notes.push(`wrote ${opts.out}`);
      } catch {
        notes.push(`could not write ${opts.out}`);
      }
    }
  }
  return notes;
}

function render(report: MainnetExecutionReport, notes: string[]): string {
  const l: string[] = [];
  l.push(`Soulmaker execution:mainnet:${report.side === "buy" ? "send" : "sell"}`);
  l.push("=".repeat(l[0]!.length));
  l.push(`outcome:     ${report.outcome.toUpperCase()}`);
  l.push(`mint:        ${report.mint ?? "-"}`);
  l.push(`endpoint:    ${report.endpointHost}`);
  l.push(`attempted:   ${report.attemptedAt}`);
  if (report.signature) l.push(`signature:   ${report.signature}`);
  if (report.confirm) l.push(`confirm:     ${report.confirm.status}${report.confirm.slot !== null ? ` @ slot ${report.confirm.slot}` : ""} (${report.confirm.polls} poll(s), ${report.confirm.elapsedMs}ms)${report.confirm.errLabel ? ` — ${report.confirm.errLabel}` : ""}`);
  if (report.balancesBefore) l.push(`SOL before:  ${report.balancesBefore.solLamports} lamports   token before: ${report.balancesBefore.tokenRaw}`);
  if (report.balancesAfter) l.push(`SOL after:   ${report.balancesAfter.solLamports} lamports   token after:  ${report.balancesAfter.tokenRaw}`);
  if (report.solDeltaLamports !== null) l.push(`SOL delta:   ${report.solDeltaLamports} lamports`);
  if (report.tokenDelta) l.push(`token delta: ${report.tokenDelta.deltaRaw} raw`);
  if (report.position) {
    const p = report.position;
    l.push(`position:    ${p.positionId} [${p.status}] spend ${p.entrySpendLamports} lamports, tokens ${p.tokenAmountRaw ?? "unknown"}`);
    if (p.close) l.push(`close:       ${p.close.reason} via ${p.close.closeKind} — value ${p.close.valueLamports ?? "unknown"}, PnL ${p.close.pnlLamports ?? "unknown"} lamports`);
  }
  if (report.refusalDetail) l.push(`refusal:     ${report.refusalDetail}`);
  if (report.liveGate && !report.liveGate.armed) l.push(`gate:        ${report.liveGate.checks.filter((c) => c.satisfied).length}/${report.liveGate.checks.length} satisfied`);
  for (const c of report.caveats) l.push(`CAVEAT: ${c}`);
  for (const n of notes) l.push(n);
  l.push("Not a profitability claim. A confirmed transaction is a fact; an edge is not.");
  // Signatures are public chain data but shape-identical to a base58 secret key, so free-text
  // redaction would erase them. Redact the whole block, then restore ONLY the known signatures.
  const sigs = [report.signature, report.position?.entrySignature ?? null, report.position?.close?.signature ?? null].filter((s): s is string => typeof s === "string");
  let text = l.join("\n");
  sigs.forEach((s, i) => { text = text.split(s).join(`\u0000SIG${i}\u0000`); });
  text = redactString(text);
  sigs.forEach((s, i) => { text = text.split(`\u0000SIG${i}\u0000`).join(s); });
  return text;
}

function exitCodeFor(report: MainnetExecutionReport): number {
  return report.outcome === "confirmed" ? 0 : report.outcome === "submitted-unconfirmed" ? 2 : 1;
}

// ---------------------------------------------------------------------------
// execution:mainnet:send
// ---------------------------------------------------------------------------

export async function executionMainnetSendReport(ctx: LiveMainnetContext = {}, opts: MainnetSendOptions = {}): Promise<LiveMainnetReport> {
  const prep = prepare(ctx, opts);
  if (!prep.ok) return { text: prep.text, exitCode: 1 };
  const p = prep.value;
  const nowIso = ctx.now ?? ((): string => new Date().toISOString());
  const report = await executeMainnetBuy({
    envelopeValue: p.envelopeValue,
    simulationValue: p.simulationValue,
    riskScore: p.riskScore,
    env: p.env,
    configPhase7LiveTradingReady: p.config.phase7LiveTradingReady,
    configKillSwitch: p.config.killSwitch,
    emergencyStopFilePresent: emergencyStopPresent(ctx),
    cliAcknowledged: Boolean(opts.iUnderstandThisCanLoseRealMoney),
    caps: p.caps,
    ledger: p.ledger,
    session: p.session,
    signerEnvVar: opts.signerEnvVar as string,
    readFile: ctx.readFile ?? ((path: string): string => readFileSync(path, "utf8")),
    rpc: p.rpc,
    auditLogPathProvided: true,
    nowMs: () => Date.parse(nowIso()),
    clock: nowIso,
    sleep: ctx.sleep,
    confirmTimeoutMs: p.confirmTimeoutMs,
    symbol: opts.symbol ?? null,
  });
  const notes = persist(ctx, opts, p, report);
  if (opts.json) return { text: JSON.stringify(redactValue({ ...report, notes }), null, 2), exitCode: exitCodeFor(report) };
  return { text: render(report, notes), exitCode: exitCodeFor(report) };
}

// ---------------------------------------------------------------------------
// execution:mainnet:sell
// ---------------------------------------------------------------------------

export async function executionMainnetSellReport(ctx: LiveMainnetContext = {}, opts: MainnetSellOptions = {}): Promise<LiveMainnetReport> {
  if (!opts.positionId) return { text: "Refusing: --position-id <id> is required (from the ledger; an unknown position can never be sold).", exitCode: 1 };
  const reason = (opts.reason ?? "operator-manual") as ExitReason;
  if (!(EXIT_REASONS as readonly string[]).includes(reason)) return { text: `Refusing: --reason must be one of ${EXIT_REASONS.join("|")}.`, exitCode: 1 };
  const prep = prepare(ctx, opts);
  if (!prep.ok) return { text: prep.text, exitCode: 1 };
  const p = prep.value;
  const nowIso = ctx.now ?? ((): string => new Date().toISOString());
  const report = await executeMainnetSell({
    envelopeValue: p.envelopeValue,
    simulationValue: p.simulationValue,
    riskScore: p.riskScore,
    env: p.env,
    configPhase7LiveTradingReady: p.config.phase7LiveTradingReady,
    configKillSwitch: p.config.killSwitch,
    emergencyStopFilePresent: emergencyStopPresent(ctx),
    cliAcknowledged: Boolean(opts.iUnderstandThisCanLoseRealMoney),
    caps: p.caps,
    ledger: p.ledger,
    session: p.session,
    signerEnvVar: opts.signerEnvVar as string,
    readFile: ctx.readFile ?? ((path: string): string => readFileSync(path, "utf8")),
    rpc: p.rpc,
    auditLogPathProvided: true,
    nowMs: () => Date.parse(nowIso()),
    clock: nowIso,
    sleep: ctx.sleep,
    confirmTimeoutMs: p.confirmTimeoutMs,
    positionId: opts.positionId,
    reason,
  });
  const notes = persist(ctx, opts, p, report);
  if (opts.json) return { text: JSON.stringify(redactValue({ ...report, notes }), null, 2), exitCode: exitCodeFor(report) };
  return { text: render(report, notes), exitCode: exitCodeFor(report) };
}

export { LIVE_TRADING_ENV_FLAG, LIVE_TRADING_ENV_VALUE };

// ---------------------------------------------------------------------------
// wallet:hot:create / wallet:hot:pubkey (S111) — the ONLY safe way to obtain a bot signer.
// ---------------------------------------------------------------------------

export interface HotWalletCreateOptions {
  out?: string;
}

/**
 * Generate a FRESH hot-wallet keypair for the bot and write it to an operator-chosen `*.keypair`
 * path (gitignored). Prints ONLY the public key. Never overwrites. This is deliberately not an
 * import: a main-wallet secret must never enter this CLI.
 */
export function walletHotCreateReport(ctx: LiveMainnetContext = {}, opts: HotWalletCreateOptions = {}): LiveMainnetReport {
  if (!opts.out) return { text: "Refusing: --out <path ending in .keypair> is required (gitignored by *.keypair).", exitCode: 1 };
  if (!opts.out.endsWith(".keypair")) return { text: "Refusing: --out must end in .keypair so it is gitignored.", exitCode: 1 };
  const path = resolvePath(ctx, opts.out);
  if (existsSync(path)) return { text: `Refusing: ${opts.out} already exists — never overwritten. Use wallet:hot:pubkey to read its PUBLIC key.`, exitCode: 1 };
  const kp = Keypair.generate();
  try {
    writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  } catch (err) {
    return { text: redactString(`Refusing: could not write ${opts.out} (${(err as Error).message})`), exitCode: 1 };
  }
  const lines = [
    "HOT WALLET CREATED (secret written to the file below; NEVER printed, NEVER commit it)",
    "=================================================================================",
    `public key:  ${kp.publicKey.toBase58()}`,
    `file:        ${opts.out}`,
    "",
    "Next:",
    `  1. Fund ONLY this address with the small amount you are willing to risk (e.g. 0.05–0.1 SOL).`,
    `  2. Point the bot at it by env var NAME, e.g.  $env:HOT_WALLET_FILE = "<absolute path to ${opts.out}>"`,
    `  3. Verify: pnpm soulmaker wallet:hot:pubkey --signer-env HOT_WALLET_FILE`,
    "  4. Use --wallet <this public key> --signer-env HOT_WALLET_FILE on execution:mainnet:* and live:sniper:daemon --mode live.",
    "Do NOT use your main Phantom wallet. Do NOT put a seed phrase or key in any command.",
  ];
  return { text: lines.join("\n"), exitCode: 0 };
}

export interface HotWalletPubkeyOptions {
  signerEnvVar?: string;
  /** Optional: the --wallet the operator intends to pass; compared against the signer honestly. */
  wallet?: string;
}

/** Derive and print ONLY the public key of the keypair file named by an env var. */
export function walletHotPubkeyReport(ctx: LiveMainnetContext = {}, opts: HotWalletPubkeyOptions = {}): LiveMainnetReport {
  const env = (ctx.env ?? process.env) as Record<string, string | undefined>;
  if (!opts.signerEnvVar || !/^[A-Z][A-Z0-9_]*$/.test(opts.signerEnvVar)) return { text: "Refusing: --signer-env <ENV_VAR_NAME> is required (UPPER_SNAKE_CASE; the NAME, never a path or key).", exitCode: 1 };
  const filePath = env[opts.signerEnvVar];
  if (!filePath) return { text: `Refusing: env var ${opts.signerEnvVar} is not set.\nKEYPAIR FILE: not configured`, exitCode: 1 };
  let text: string;
  try {
    text = (ctx.readFile ?? ((p: string): string => readFileSync(p, "utf8")))(filePath);
  } catch {
    return { text: `Refusing: the file named by ${opts.signerEnvVar} could not be read (path not shown).\nKEYPAIR FILE: missing or unreadable`, exitCode: 1 };
  }
  let bytes: unknown;
  try {
    bytes = JSON.parse(text);
  } catch {
    return { text: `Refusing: the file named by ${opts.signerEnvVar} is not a solana-keygen JSON array.\nKEYPAIR FILE: present but malformed`, exitCode: 1 };
  }
  if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) {
    return { text: `Refusing: the file named by ${opts.signerEnvVar} is not a 64-byte keypair.\nKEYPAIR FILE: present but malformed`, exitCode: 1 };
  }
  const kp = Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
  const pub = kp.publicKey.toBase58();
  const lines = [`SIGNER: ${pub}`, `KEYPAIR FILE: present (named by ${opts.signerEnvVar}; path and contents never printed)`];
  let exitCode = 0;
  if (opts.wallet) {
    if (opts.wallet === pub) lines.push("PUBLIC KEY MATCH: yes — --wallet equals the signer");
    else { lines.push(`PUBLIC KEY MATCH: NO — --wallet ${opts.wallet} is NOT the signer; the bot signs with ${pub}. Fund and name THAT address.`); exitCode = 1; }
  }
  lines.push("This is the --wallet value the bot signs with. Fund THIS address; nothing else is the bot.");
  return { text: lines.join("\n"), exitCode };
}

// ---------------------------------------------------------------------------
// live:readiness (S111) — the honest ladder: cluster → RPC → signer → balance → reserve → caps →
// ledger → reconciliation → stops → quote → build → simulation → status interface.
// ---------------------------------------------------------------------------

export const READINESS_STATUSES = ["PASS", "BLOCKED_WALLET_UNFUNDED", "BLOCKED_CONFIG", "BLOCKED_STOP", "BLOCKED_RECONCILE", "FAIL_PROVIDER", "FAIL_QUOTE", "FAIL_BUILD", "FAIL_SIMULATION", "SKIPPED"] as const;
export type ReadinessStatus = (typeof READINESS_STATUSES)[number];

export interface ReadinessCheck { name: string; status: ReadinessStatus; detail: string }

export interface ReadinessOptions extends LiveArmingOptions {
  /** A mint to quote/build/simulate against (default: a deep-liquidity reference mint). */
  probeMint?: string;
  probeAmountSol?: string;
  ledgerPath?: string;
  statusPath?: string;
  json?: boolean;
}

export interface ReadinessDeps {
  createMainnetRpc?: (rpcUrl: string) => MainnetRpcSeams & { balance: MainnetRpcSeams["balance"] & HoldingsRpcLike };
  swapBuilder?: SwapTransactionBuilder;
  txPreview?: TxPreviewRpc;
  readFile?: (path: string) => string;
  /** Genesis + slot probe (tests inject; default: a real Connection). */
  clusterProbe?: (rpcUrl: string) => Promise<{ genesis: string; slot: number }>;
}

export const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const PROBE_MINT_DEFAULT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"; // BONK — deep liquidity reference

export async function liveReadinessReport(ctx: LiveMainnetContext & ReadinessDeps = {}, opts: ReadinessOptions = {}): Promise<LiveMainnetReport> {
  const checks: ReadinessCheck[] = [];
  const env = (ctx.env ?? process.env) as Record<string, string | undefined>;
  const push = (name: string, status: ReadinessStatus, detail: string): void => { checks.push({ name, status, detail }); };
  const blocked = (): boolean => checks.some((c) => c.status !== "PASS" && c.status !== "SKIPPED");

  // 1) Config + arming (the exact same resolver the daemon uses).
  let config: Config | null = null;
  let arming: LiveArming | null = null;
  try {
    config = loadConfig({ cwd: ctx.cwd, env: ctx.env, configPath: ctx.configPath });
    push("Config", "PASS", `phase7LiveTradingReady=${config.phase7LiveTradingReady} caps.maxTradeSizeSol=${config.caps.maxTradeSizeSol}`);
  } catch (err) {
    push("Config", "BLOCKED_CONFIG", redactString(err instanceof ConfigError ? err.message.split("\n")[0] ?? "invalid" : String(err)));
  }
  if (config) {
    const armed = resolveLiveArming(env, config, opts);
    if (armed.ok) { arming = armed.value; push("Risk caps", "PASS", `spend≤${Number(arming.caps.maxSpendLamports) / LAMPORTS_PER_SOL} SOL, exposure≤${arming.maxOpenSolExposureLamports / LAMPORTS_PER_SOL} SOL, open≤${arming.caps.maxOpenPositions}, ${arming.maxTradesPerHour}/h, loss≤${arming.caps.sessionLossCapSol} SOL, slip≤${arming.caps.slippageCapBps}bps, impact≤${arming.maxPriceImpactPct}%, reserve≥${arming.caps.minSolReserveLamports / LAMPORTS_PER_SOL} SOL`); }
    else push("Risk caps", "BLOCKED_CONFIG", armed.reasons.join("; "));
  }

  // 2) Signer identity (public key only) must equal --wallet.
  let signerPub: string | null = null;
  if (opts.signerEnvVar && /^[A-Z][A-Z0-9_]*$/.test(opts.signerEnvVar) && env[opts.signerEnvVar]) {
    const r = walletHotPubkeyReport(ctx, { signerEnvVar: opts.signerEnvVar });
    if (r.text.startsWith("SIGNER: ")) {
      signerPub = (r.text.match(/^SIGNER: ([1-9A-HJ-NP-Za-km-z]{32,44})/m) ?? [])[1] ?? null;
      if (signerPub && opts.wallet && signerPub !== opts.wallet) push("Signer", "BLOCKED_CONFIG", `signer is ${signerPub} but --wallet is ${opts.wallet} — the bot signs with the SIGNER; fund/name that one`);
      else push("Signer", "PASS", signerPub ?? "unknown");
    } else push("Signer", "BLOCKED_CONFIG", r.text.split("\n")[0] ?? "unreadable");
  } else push("Signer", "BLOCKED_CONFIG", "--signer-env <ENV_VAR_NAME> not set or env var missing (no bot signer exists yet: run wallet:hot:create)");

  const wallet = signerPub ?? opts.wallet ?? null;
  const rpcUrl = opts.rpcUrl ?? env.SOULMAKER_RPC_URL ?? null;
  // 3) Cluster + RPC + balance.
  let sol: number | null = null;
  let rpc: (MainnetRpcSeams & { balance: MainnetRpcSeams["balance"] & HoldingsRpcLike }) | null = null;
  if (!rpcUrl) push("RPC", "FAIL_PROVIDER", "--rpc-url (or SOULMAKER_RPC_URL) is required");
  else {
    try {
      const probe = ctx.clusterProbe ?? (async (u: string) => { const conn = new Connection(u, "confirmed"); const [genesis, slot] = await Promise.all([conn.getGenesisHash(), conn.getSlot("confirmed")]); return { genesis, slot }; });
      const { genesis, slot } = await probe(rpcUrl);
      if (genesis !== MAINNET_GENESIS_HASH) push("Cluster", "FAIL_PROVIDER", `NOT mainnet-beta (genesis ${genesis.slice(0, 8)}…)`);
      else push("Cluster", "PASS", `mainnet-beta @ slot ${slot} via ${new URL(rpcUrl).host}`);
      rpc = (ctx.createMainnetRpc ?? (createMainnetRpcSeams as ReadinessDeps["createMainnetRpc"]))!(rpcUrl);
      push("RPC", "PASS", rpc.endpointHost);
    } catch (err) {
      push("RPC", "FAIL_PROVIDER", redactString(String((err as Error).message ?? err)).slice(0, 120));
    }
  }
  if (rpc && wallet) {
    try {
      sol = await rpc.balance.getBalanceLamports(wallet);
      const reserve = arming?.caps.minSolReserveLamports ?? 0;
      const spend = arming ? Number(arming.caps.maxSpendLamports) : 0;
      if (sol === 0) push("Balance", "BLOCKED_WALLET_UNFUNDED", `${wallet} holds 0 SOL on mainnet-beta`);
      else push("Balance", "PASS", `${(sol / LAMPORTS_PER_SOL).toFixed(6)} SOL (${sol} lamports) at ${wallet}`);
      if (sol > 0) push("Reserve", sol - spend - 10_000 >= reserve ? "PASS" : "BLOCKED_WALLET_UNFUNDED", `after one max buy (${spend} lamports + fee) the wallet keeps ${sol - spend - 10_000} ≥ reserve ${reserve}? `);
    } catch (err) {
      push("Balance", "FAIL_PROVIDER", redactString(String((err as Error).message ?? err)).slice(0, 120));
    }
  } else push("Balance", "SKIPPED", "no RPC or no wallet");

  // 4) Ledger + reconciliation (read-only pass; resolutions are NOT journaled here).
  let ledger: PositionLedger = buildLedger();
  if (opts.ledgerPath && existsSync(resolvePath(ctx, opts.ledgerPath))) {
    try { ledger = validateLedger(readJson(ctx, opts.ledgerPath, "position ledger")); push("Ledger", "PASS", `${ledger.totals.open} open / ${ledger.totals.closed} closed at ${opts.ledgerPath}`); }
    catch (err) { push("Ledger", "BLOCKED_RECONCILE", redactString((err as Error).message).slice(0, 120)); }
  } else push("Ledger", "PASS", opts.ledgerPath ? `${opts.ledgerPath} absent (fresh ledger)` : "no --ledger given (fresh ledger)");
  if (rpc && wallet) {
    try {
      const rec = await reconcileStartup({ wallet, ledger, auditEntries: [], rpc: { confirm: rpc.confirm, balance: rpc.balance }, nowMs: () => Date.now(), clock: () => new Date().toISOString(), confirmTimeoutMs: 5_000 });
      const open = rec.ledger.positions.filter((p) => p.status === "open" && p.kind === "live").length;
      push("Reconciliation", rec.tradingAllowed ? "PASS" : "BLOCKED_RECONCILE", rec.tradingAllowed ? `no unresolved positions (${open} open live position(s) confirmed on chain${rec.orphans.length > 0 ? `; ${rec.orphans.length} external holding(s) ignored` : ""})` : rec.blockingReasons.join("; "));
    } catch (err) { push("Reconciliation", "FAIL_PROVIDER", redactString(String((err as Error).message ?? err)).slice(0, 120)); }
  } else push("Reconciliation", "SKIPPED", "no RPC or no wallet");

  // 5) Stops.
  const stop = stopState({ cwd: ctx.cwd, env, configKillSwitch: config?.killSwitch === true });
  push("Hard stop", stop === "hard-stop" ? "BLOCKED_STOP" : "PASS", stop === "hard-stop" ? "ON — kill switch / emergency stop active (nothing can send)" : "OFF");
  push("Safe stop", stop === "safe-stop" ? "BLOCKED_STOP" : "PASS", stop === "safe-stop" ? "ON — .soulmaker-no-entry / SOULMAKER_NO_NEW_ENTRIES (no new entries)" : "OFF");

  // 6) Quote → build → simulation against a deep-liquidity probe mint with the REAL wallet as fee payer.
  const probeMint = opts.probeMint ?? PROBE_MINT_DEFAULT;
  const probeSol = Number(opts.probeAmountSol ?? "0.005");
  if (wallet && rpcUrl && Number.isFinite(probeSol) && probeSol > 0) {
    try {
      const builder = ctx.swapBuilder ?? createJupiterSwapBuilder();
      const built = await builder.build({ candidateMint: probeMint, inputMint: "So11111111111111111111111111111111111111112", amountRaw: String(Math.round(probeSol * LAMPORTS_PER_SOL)), slippageBps: arming?.slippageBps ?? 100, walletPublicKey: wallet, network: "mainnet-beta", executionMode: "mainnet-dry-run", killSwitchActive: false, risk: { score: 0, decision: "PASS_FOR_PAPER_EVALUATION", flags: [] }, controls: { maxSpendLamports: String(Math.round(probeSol * LAMPORTS_PER_SOL)), slippageCapBps: arming?.caps.slippageCapBps ?? 500, riskScoreCap: 100 } });
      if (!built.built) { push("Jupiter quote", "FAIL_QUOTE", built.refusals.map((r) => r.code).join(", ")); push("Transaction build", "SKIPPED", "no quote"); push("Simulation", "SKIPPED", "no build"); }
      else {
        push("Jupiter quote", "PASS", `${built.quoteFacts.inAmountRaw} → ${built.quoteFacts.outAmountRaw} raw, impact ${built.quoteFacts.priceImpactPct ?? "?"}%`);
        push("Transaction build", "PASS", `v0 envelope for fee payer ${wallet}`);
        const preview = ctx.txPreview ?? createTxPreviewRpc(rpcUrl);
        const sim = await simulateUnsignedEnvelope(preview, built.envelope);
        push("Simulation", sim.outcome === "simulated-ok" ? "PASS" : "FAIL_SIMULATION", sim.outcome === "simulated-ok" ? `simulated-ok @ slot ${sim.slot ?? "?"}, ${sim.unitsConsumed ?? "?"} CU` : `${sim.outcome}: ${sim.classification} ${sim.errLabel ?? ""}`.trim());
      }
    } catch (err) { push("Jupiter quote", "FAIL_QUOTE", redactString(String((err as Error).message ?? err)).slice(0, 120)); }
  } else { push("Jupiter quote", "SKIPPED", "no wallet/RPC"); push("Transaction build", "SKIPPED", ""); push("Simulation", "SKIPPED", ""); }

  // 7) Status interface: is a daemon publishing status.json?
  if (opts.statusPath) {
    const sp = resolvePath(ctx, opts.statusPath);
    if (!existsSync(sp)) push("Runtime status", "SKIPPED", `${opts.statusPath} absent (no daemon has run yet)`);
    else { try { const s = JSON.parse(readFileSync(sp, "utf8")) as { at?: string; daemon?: { running?: boolean; mode?: string } }; push("Runtime status", "PASS", `${s.daemon?.running ? "RUNNING" : "STOPPED"} ${s.daemon?.mode ?? ""} @ ${s.at ?? "?"}`); } catch { push("Runtime status", "SKIPPED", "status.json unreadable"); } }
  } else push("Runtime status", "SKIPPED", "no --status given");

  // READY_TO_ARM: everything green. READY_TO_SIMULATE: only signer/arming config missing (chain side green). BLOCKED: anything else.
  const chainNames = new Set(["Cluster", "RPC", "Balance", "Reserve", "Ledger", "Reconciliation", "Hard stop", "Safe stop", "Jupiter quote", "Transaction build", "Simulation"]);
  const chainGreen = [...chainNames].every((n) => checks.find((c) => c.name === n)?.status === "PASS" || checks.find((c) => c.name === n)?.status === "SKIPPED");
  const onlyArmingMissing = checks.filter((c) => c.status !== "PASS" && c.status !== "SKIPPED").every((c) => c.name === "Signer" || c.name === "Risk caps" || c.name === "Config");
  const verdict = !blocked() ? "READY_TO_ARM" : chainGreen && onlyArmingMissing ? "READY_TO_SIMULATE" : "BLOCKED";
  const reasons = checks.filter((c) => c.status !== "PASS" && c.status !== "SKIPPED").map((c) => `${c.name}: ${c.detail}`);
  if (opts.json) return { text: JSON.stringify(redactValue({ schemaVersion: "live.readiness.v1", at: new Date().toISOString(), verdict, checks, reasons, notProfitabilityClaim: true }), null, 2), exitCode: verdict === "READY_TO_ARM" ? 0 : 1 };
  const width = 24;
  const lines = ["SOL MAKER LIVE READINESS", "========================"];
  for (const c of checks) lines.push(`${(c.name + " ").padEnd(width, ".")} ${c.status}${c.detail ? "  " + c.detail : ""}`);
  lines.push("", `LIVE READINESS: ${verdict}`);
  for (const r of reasons) lines.push(`Reason: ${r}`);
  if (verdict === "READY_TO_ARM") lines.push("READY_TO_ARM means every gate that can be checked without sending is green. It is NOT a profit claim and arms nothing by itself.");
  if (verdict === "READY_TO_SIMULATE") lines.push("READY_TO_SIMULATE: the chain side (mainnet, RPC, balance, quote, build, simulation) is green; the bot cannot arm until a signer + live config exist. Next: wallet:hot:create.");
  return { text: redactString(lines.join("\n")).replace(/\[REDACTED\]/g, (m) => m), exitCode: verdict === "READY_TO_ARM" ? 0 : 1 };
}
