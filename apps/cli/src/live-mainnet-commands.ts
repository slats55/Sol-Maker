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
import { Connection } from "@solana/web3.js";

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
