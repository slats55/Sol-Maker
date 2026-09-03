/**
 * LIVE EXECUTOR (Sprint 111) — the piece that connects the daemon's decisions to the mainnet
 * execution core (executeMainnetBuy / executeMainnetSell). Owns:
 *
 *   - ARMING: one coherent safety model shared with execution:mainnet:send/:sell — the env sentence,
 *     config `phase7LiveTradingReady`, the explicit CLI acknowledgment, and EXPLICIT caps. Any
 *     missing cap fails startup; there is no default that can trade.
 *   - STOP STATES: SAFE STOP (kill switch / emergency stop: no new entries, risk-reducing exits
 *     still allowed) and HARD STOP (no sends at all). Checked EVERY tick by the daemon.
 *   - IN-FLIGHT INTENTS: persisted per mint BEFORE a send; a lingering intent on restart blocks
 *     trading until reconciled (a crash mid-send can never cause a blind re-buy).
 *   - SELL RETRY POLICY: bounded attempts with backoff; a failed sell keeps the position OPEN and
 *     visible as EXIT_FAILED_RETRYABLE, then EXIT_FAILED_TERMINAL at the ceiling.
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";
import type { Config } from "@soulmaker/core";
import { LIVE_TRADING_ENV_FLAG, LIVE_TRADING_ENV_VALUE } from "@soulmaker/execution";
import type { SessionState } from "@soulmaker/execution";
import { redactValue } from "@soulmaker/security";
import { executeMainnetBuy, executeMainnetSell, LAMPORTS_PER_SOL } from "@soulmaker/live";
import type { ExitReason, LivePosition, MainnetCaps, MainnetExecutionReport, MainnetRpcSeams, PositionLedger } from "@soulmaker/live";
import type { SwapTransactionBuilder } from "@soulmaker/txbuilder";
import { simulateUnsignedEnvelope, type TxPreviewRpc } from "@soulmaker/txpreview";

export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
export const NO_ENTRY_FILE = ".soulmaker-no-entry";
export const EMERGENCY_STOP_FILE = ".soulmaker-emergency-stop";
export const INTENT_STATES = ["in-flight", "done"] as const;
export const EXIT_STATES = ["EXIT_PENDING", "EXIT_FAILED_RETRYABLE", "EXIT_FAILED_TERMINAL", "CLOSED"] as const;
export type ExitState = (typeof EXIT_STATES)[number];
export const SELL_RETRY_CEILING = 5;
export const SELL_RETRY_BACKOFF_MS = [0, 15_000, 30_000, 60_000, 120_000] as const;

/** Hard ceilings for the live daemon — every flag may only tighten below these. */
export const LIVE_DAEMON_HARD_CEILINGS = {
  maxSpendSol: 0.05,
  maxOpenSolExposureSol: 0.25,
  maxOpenPositions: 5,
  maxTradesPerHour: 20,
  maxSlippageBps: 500,
  maxPriceImpactPct: 5,
  maxQuoteAgeMs: 15_000,
} as const;

export type StopState = "none" | "safe-stop" | "hard-stop";

export interface LiveArming {
  wallet: string;
  signerEnvVar: string;
  rpcUrl: string;
  caps: MainnetCaps;
  maxOpenSolExposureLamports: number;
  maxTradesPerHour: number;
  maxPriceImpactPct: number;
  slippageBps: number;
  confirmTimeoutMs: number;
}

export interface LiveArmingOptions {
  iUnderstandThisCanLoseRealMoney?: boolean;
  wallet?: string;
  signerEnvVar?: string;
  rpcUrl?: string;
  maxSpendSol?: string;
  maxOpenSolExposureSol?: string;
  maxOpenPositions?: string;
  maxTradesPerHour?: string;
  sessionLossCapSol?: string;
  slippageBps?: string;
  maxPriceImpactPct?: string;
  minSolReserveSol?: string;
  riskScoreCap?: string;
  maxQuoteAgeMs?: string;
  confirmTimeoutMs?: string;
}

function num(value: string | undefined, label: string, min: number, max: number, integer = false): number {
  if (value === undefined) throw new Error(`--${label} is required for --mode live (explicit caps only; no default can trade)`);
  const n = Number(value);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n)) || n < min || n > max) {
    throw new Error(`--${label} must be ${integer ? "an integer" : "a number"} in [${min}, ${max}] (caps only tighten)`);
  }
  return n;
}

/** Resolve + validate live arming. Fails closed on ANY missing acknowledgment or cap. */
export function resolveLiveArming(env: Record<string, string | undefined>, config: Config, opts: LiveArmingOptions): { ok: true; value: LiveArming } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  if (env[LIVE_TRADING_ENV_FLAG] !== LIVE_TRADING_ENV_VALUE) reasons.push(`${LIVE_TRADING_ENV_FLAG} must be EXACTLY "${LIVE_TRADING_ENV_VALUE}"`);
  if (config.phase7LiveTradingReady !== true) reasons.push("config phase7LiveTradingReady must be true");
  if (opts.iUnderstandThisCanLoseRealMoney !== true) reasons.push("--i-understand-this-can-lose-real-money must be passed");
  if (!opts.wallet || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(opts.wallet)) reasons.push("--wallet <PUBLIC key> is required (the hot wallet; confirm it on purpose)");
  if (!opts.signerEnvVar || !/^[A-Z][A-Z0-9_]*$/.test(opts.signerEnvVar)) reasons.push("--signer-env <ENV_VAR_NAME> is required (holds the keypair file PATH; never a key)");
  else if (!env[opts.signerEnvVar]) reasons.push(`env var ${opts.signerEnvVar} is not set`);
  if (!opts.rpcUrl || !/^https?:\/\//.test(opts.rpcUrl)) reasons.push("--rpc-url <url> is required for live");
  let caps: MainnetCaps | null = null;
  let extra: Pick<LiveArming, "maxOpenSolExposureLamports" | "maxTradesPerHour" | "maxPriceImpactPct" | "slippageBps" | "confirmTimeoutMs"> | null = null;
  try {
    const maxSpendSol = num(opts.maxSpendSol, "max-spend-sol", 0.000001, Math.min(LIVE_DAEMON_HARD_CEILINGS.maxSpendSol, config.caps.maxTradeSizeSol));
    const maxOpenPositions = num(opts.maxOpenPositions, "max-open-positions", 1, Math.min(LIVE_DAEMON_HARD_CEILINGS.maxOpenPositions, config.caps.maxOpenPositions), true);
    const maxOpenSolExposureSol = num(opts.maxOpenSolExposureSol, "max-open-sol-exposure-sol", maxSpendSol, LIVE_DAEMON_HARD_CEILINGS.maxOpenSolExposureSol);
    caps = {
      maxSpendLamports: String(Math.round(maxSpendSol * LAMPORTS_PER_SOL)),
      sessionLossCapSol: num(opts.sessionLossCapSol, "session-loss-cap-sol", 0.000001, config.caps.maxDailyLossSol),
      slippageCapBps: num(opts.slippageBps, "slippage-bps", 1, LIVE_DAEMON_HARD_CEILINGS.maxSlippageBps, true),
      riskScoreCap: num(opts.riskScoreCap, "risk-score-cap", 0, 100, true),
      quoteAgeCapMs: num(opts.maxQuoteAgeMs ?? "8000", "max-quote-age-ms", 500, LIVE_DAEMON_HARD_CEILINGS.maxQuoteAgeMs, true),
      maxTradesPerSession: Math.min(LIVE_DAEMON_HARD_CEILINGS.maxTradesPerHour * 24, 100),
      maxOpenPositions,
      minSolReserveLamports: Math.round(num(opts.minSolReserveSol, "min-sol-reserve-sol", 0, 1000) * LAMPORTS_PER_SOL),
    };
    extra = {
      maxOpenSolExposureLamports: Math.round(maxOpenSolExposureSol * LAMPORTS_PER_SOL),
      maxTradesPerHour: num(opts.maxTradesPerHour, "max-trades-per-hour", 1, LIVE_DAEMON_HARD_CEILINGS.maxTradesPerHour, true),
      maxPriceImpactPct: num(opts.maxPriceImpactPct, "max-price-impact-pct", 0.01, LIVE_DAEMON_HARD_CEILINGS.maxPriceImpactPct),
      slippageBps: caps.slippageCapBps,
      confirmTimeoutMs: num(opts.confirmTimeoutMs ?? "45000", "confirm-timeout-ms", 5_000, 120_000, true),
    };
  } catch (err) {
    reasons.push((err as Error).message);
  }
  if (reasons.length > 0 || !caps || !extra) return { ok: false, reasons };
  return { ok: true, value: { wallet: opts.wallet as string, signerEnvVar: opts.signerEnvVar as string, rpcUrl: opts.rpcUrl as string, caps, ...extra } };
}

/**
 * SAFE STOP  = `.soulmaker-no-entry` file or SOULMAKER_NO_NEW_ENTRIES=true: no new entries; risk-reducing
 *              exits still go through the FULL fourteen-condition gate and may send.
 * HARD STOP  = the existing kill switch / emergency stop (`.soulmaker-emergency-stop`, SOULMAKER_EMERGENCY_STOP,
 *              SOULMAKER_KILL_SWITCH=true, config.killSwitch): NOTHING sends. The execution core refuses this on
 *              its own (gate condition kill-switch-clear), so the daemon cannot bypass it even if it tried.
 * Checked EVERY tick.
 */
export function stopState(input: { cwd?: string; env: Record<string, string | undefined>; configKillSwitch: boolean }): StopState {
  const base = input.cwd ?? process.cwd();
  if (input.configKillSwitch || input.env.SOULMAKER_KILL_SWITCH === "true" || (input.env.SOULMAKER_EMERGENCY_STOP ?? "").length > 0 || existsSync(join(base, EMERGENCY_STOP_FILE))) return "hard-stop";
  if (input.env.SOULMAKER_NO_NEW_ENTRIES === "true" || existsSync(join(base, NO_ENTRY_FILE))) return "safe-stop";
  return "none";
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export interface InFlightIntent {
  intentId: string;
  mint: string;
  side: "buy" | "sell";
  at: string;
  state: (typeof INTENT_STATES)[number];
}

export interface ExitAttemptState {
  positionId: string;
  attempts: number;
  nextAllowedMs: number;
  lastError: string | null;
  state: ExitState;
}

export interface LiveExecutorDeps {
  cwd?: string;
  env: Record<string, string | undefined>;
  config: Config;
  arming: LiveArming;
  auditLogPath: string;
  intentsPath: string;
  swapBuilder: SwapTransactionBuilder;
  txPreview: TxPreviewRpc;
  rpc: MainnetRpcSeams;
  readFile: (path: string) => string;
  nowMs: () => number;
  clock: () => string;
  sleep?: (ms: number) => Promise<void>;
}

export type EntryOutcome = { kind: "refused"; reason: string; report: MainnetExecutionReport | null } | { kind: "executed"; report: MainnetExecutionReport };

function resolvePath(cwd: string | undefined, p: string): string {
  return isAbsolute(p) ? normalize(p) : join(cwd ?? process.cwd(), p);
}

/** Session state from the persisted ledger over the last hour/day (never process memory). */
export function liveSessionFromLedger(ledger: PositionLedger, nowMs: number, maxTradesPerHour: number): SessionState & { tradesLastHour: number; openExposureLamports: number; hourCapReached: boolean } {
  const dayAgo = nowMs - 24 * 3600_000;
  const hourAgo = nowMs - 3600_000;
  const live = ledger.positions.filter((p) => p.kind === "live");
  const recent = live.filter((p) => Date.parse(p.openedAt) >= dayAgo);
  const lastHour = live.filter((p) => Date.parse(p.openedAt) >= hourAgo);
  let lossLamports = 0;
  let last: number | null = null;
  for (const p of recent) {
    const pnl = p.close?.pnlLamports ?? null;
    if (pnl !== null && pnl < 0) lossLamports += -pnl;
    const t = Date.parse(p.openedAt);
    if (last === null || t > last) last = t;
  }
  const openExposureLamports = live.filter((p) => p.status === "open").reduce((a, p) => a + p.entrySpendLamports, 0);
  return {
    tradesCount: recent.length,
    sessionLossSol: lossLamports / LAMPORTS_PER_SOL,
    lastTradeAtMs: last,
    mintsTraded: recent.map((p) => p.mint),
    tradesLastHour: lastHour.length,
    openExposureLamports,
    hourCapReached: lastHour.length >= maxTradesPerHour,
  };
}

export class LiveExecutor {
  private intents = new Map<string, InFlightIntent>();
  private exitAttempts = new Map<string, ExitAttemptState>();
  private seq = 0;

  constructor(private readonly deps: LiveExecutorDeps) {}

  /** Load persisted intents. Any lingering in-flight intent is a blocker (crash mid-send). */
  loadIntents(): InFlightIntent[] {
    const path = resolvePath(this.deps.cwd, this.deps.intentsPath);
    if (!existsSync(path)) return [];
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
      if (!Array.isArray(raw)) return [];
      for (const r of raw as InFlightIntent[]) if (r && typeof r.mint === "string" && r.state === "in-flight") this.intents.set(r.mint, r);
    } catch {
      /* unreadable intents file: treated as no intents, but the caller also gets a reconcile pass */
    }
    return [...this.intents.values()];
  }

  lingeringIntents(): InFlightIntent[] {
    return [...this.intents.values()].filter((i) => i.state === "in-flight");
  }

  private persistIntents(): void {
    writeFileSync(resolvePath(this.deps.cwd, this.deps.intentsPath), JSON.stringify([...this.intents.values()], null, 2) + "\n");
  }

  private audit(entry: unknown): void {
    try {
      appendFileSync(resolvePath(this.deps.cwd, this.deps.auditLogPath), JSON.stringify(redactValue(entry)) + "\n");
    } catch {
      /* the execution report itself is returned to the daemon, which journals it too */
    }
  }

  exitStateFor(positionId: string): ExitAttemptState | null {
    return this.exitAttempts.get(positionId) ?? null;
  }

  allExitStates(): ExitAttemptState[] {
    return [...this.exitAttempts.values()];
  }

  private async buildAndSimulate(req: { candidateMint: string; inputMint: string; amountRaw: string; riskScore: number; riskDecision: string | null; riskFlags: Array<{ id: string; severity: string }> }): Promise<{ ok: true; envelope: unknown; simulation: unknown; priceImpactPct: number | null } | { ok: false; reason: string }> {
    const a = this.deps.arming;
    const built = await this.deps.swapBuilder.build({
      candidateMint: req.candidateMint,
      inputMint: req.inputMint,
      amountRaw: req.amountRaw,
      slippageBps: a.slippageBps,
      walletPublicKey: a.wallet,
      network: "mainnet-beta",
      executionMode: "mainnet-live-armed",
      killSwitchActive: false,
      risk: { score: req.riskScore, decision: req.riskDecision, flags: req.riskFlags },
      controls: { maxSpendLamports: a.caps.maxSpendLamports, slippageCapBps: a.caps.slippageCapBps, riskScoreCap: a.caps.riskScoreCap, maxQuoteAgeMs: a.caps.quoteAgeCapMs },
    });
    if (!built.built) return { ok: false, reason: `build refused: ${built.refusals.map((r) => r.code).join(", ")}` };
    const impact = built.quoteFacts.priceImpactPct !== null ? Number(built.quoteFacts.priceImpactPct) : null;
    if (impact !== null && Number.isFinite(impact) && impact > a.maxPriceImpactPct) return { ok: false, reason: `price impact ${impact}% exceeds cap ${a.maxPriceImpactPct}%` };
    const simulation = await simulateUnsignedEnvelope(this.deps.txPreview, built.envelope, { clock: this.deps.clock });
    if (simulation.outcome !== "simulated-ok") return { ok: false, reason: `simulation ${simulation.outcome}: ${simulation.classification} — ${simulation.errLabel ?? ""}`.trim() };
    return { ok: true, envelope: built.envelope, simulation, priceImpactPct: impact };
  }

  private common(ledger: PositionLedger, stop: StopState) {
    const a = this.deps.arming;
    return {
      riskScore: 0,
      env: this.deps.env,
      configPhase7LiveTradingReady: this.deps.config.phase7LiveTradingReady,
      configKillSwitch: this.deps.config.killSwitch,
      emergencyStopFilePresent: stop === "hard-stop",
      cliAcknowledged: true,
      caps: a.caps,
      ledger,
      session: liveSessionFromLedger(ledger, this.deps.nowMs(), a.maxTradesPerHour),
      signerEnvVar: a.signerEnvVar,
      readFile: this.deps.readFile,
      rpc: this.deps.rpc,
      auditLogPathProvided: true,
      nowMs: this.deps.nowMs,
      clock: this.deps.clock,
      sleep: this.deps.sleep,
      confirmTimeoutMs: a.confirmTimeoutMs,
    };
  }

  /**
   * ENTRY. Every wall re-checked here regardless of what the daemon decided: stop state, hour cap,
   * aggregate exposure, duplicate/in-flight intent, then build → simulate → executeMainnetBuy.
   */
  async buy(input: { ledger: PositionLedger; mint: string; symbol: string | null; spendLamports: string; riskScore: number; riskDecision: string | null; riskFlags: Array<{ id: string; severity: string }>; stop: StopState }): Promise<EntryOutcome> {
    const a = this.deps.arming;
    if (input.stop !== "none") return { kind: "refused", reason: `${input.stop}: no new entries`, report: null };
    const session = liveSessionFromLedger(input.ledger, this.deps.nowMs(), a.maxTradesPerHour);
    if (session.hourCapReached) return { kind: "refused", reason: `hour cap reached (${session.tradesLastHour}/${a.maxTradesPerHour})`, report: null };
    if (session.openExposureLamports + Number(input.spendLamports) > a.maxOpenSolExposureLamports) return { kind: "refused", reason: `aggregate exposure cap (${session.openExposureLamports} + ${input.spendLamports} > ${a.maxOpenSolExposureLamports})`, report: null };
    if (this.intents.get(input.mint)?.state === "in-flight") return { kind: "refused", reason: "an execution intent for this mint is already in flight", report: null };
    if (input.ledger.positions.some((p) => p.status === "open" && p.kind === "live" && p.mint === input.mint)) return { kind: "refused", reason: "open live position exists for this mint", report: null };

    const built = await this.buildAndSimulate({ candidateMint: input.mint, inputMint: WRAPPED_SOL_MINT, amountRaw: input.spendLamports, riskScore: input.riskScore, riskDecision: input.riskDecision, riskFlags: input.riskFlags });
    if (!built.ok) return { kind: "refused", reason: built.reason, report: null };

    // Persist the intent BEFORE sending. A crash after this line leaves a lingering in-flight
    // intent that blocks the next start until the operator/reconciler resolves it.
    const intent: InFlightIntent = { intentId: `buy:${input.mint}:${this.deps.clock()}:${++this.seq}`, mint: input.mint, side: "buy", at: this.deps.clock(), state: "in-flight" };
    this.intents.set(input.mint, intent);
    this.persistIntents();
    let report: MainnetExecutionReport;
    try {
      report = await executeMainnetBuy({ ...this.common(input.ledger, input.stop), riskScore: input.riskScore, envelopeValue: built.envelope, simulationValue: built.simulation, symbol: input.symbol });
    } finally {
      this.intents.set(input.mint, { ...intent, state: "done" });
      this.persistIntents();
    }
    this.audit({ ...report, ledger: undefined, intentId: intent.intentId });
    return { kind: "executed", report };
  }

  /**
   * EXIT. Under HARD STOP nothing is sent (the core refuses too). Under SAFE STOP exits proceed.
   * Bounded retries with backoff; a failed sell keeps the position OPEN and visible.
   */
  async sell(input: { ledger: PositionLedger; position: LivePosition; reason: ExitReason; detail: string; stop: StopState }): Promise<EntryOutcome> {
    const p = input.position;
    const now = this.deps.nowMs();
    const prior = this.exitAttempts.get(p.positionId) ?? { positionId: p.positionId, attempts: 0, nextAllowedMs: 0, lastError: null, state: "EXIT_PENDING" as ExitState };
    if (input.stop === "hard-stop") return { kind: "refused", reason: "hard-stop: no sends (sell recommended; run execution:mainnet:sell after clearing the stop)", report: null };
    if (prior.state === "EXIT_FAILED_TERMINAL") return { kind: "refused", reason: `sell retry ceiling reached (${prior.attempts}) — position stays OPEN; sell manually with execution:mainnet:sell`, report: null };
    if (now < prior.nextAllowedMs) return { kind: "refused", reason: `sell backoff: next attempt in ${Math.ceil((prior.nextAllowedMs - now) / 1000)}s`, report: null };
    if (p.tokenAmountRaw === null) return { kind: "refused", reason: "token amount unknown — reconcile first (live:sniper:daemon reconciles on start)", report: null };
    if (this.intents.get(p.mint)?.state === "in-flight") return { kind: "refused", reason: "an execution intent for this mint is already in flight", report: null };

    const fail = (reason: string): EntryOutcome => {
      const attempts = prior.attempts + 1;
      const backoff = SELL_RETRY_BACKOFF_MS[Math.min(attempts, SELL_RETRY_BACKOFF_MS.length - 1)] as number;
      const state: ExitState = attempts >= SELL_RETRY_CEILING ? "EXIT_FAILED_TERMINAL" : "EXIT_FAILED_RETRYABLE";
      this.exitAttempts.set(p.positionId, { positionId: p.positionId, attempts, nextAllowedMs: now + backoff, lastError: reason, state });
      return { kind: "refused", reason: `${state}: ${reason}`, report: null };
    };

    // Fresh quote + build + simulate every attempt (quote refresh + blockhash refresh are implicit).
    const built = await this.buildAndSimulate({ candidateMint: WRAPPED_SOL_MINT, inputMint: p.mint, amountRaw: p.tokenAmountRaw, riskScore: 0, riskDecision: "PASS_FOR_PAPER_EVALUATION", riskFlags: [] });
    if (!built.ok) return fail(built.reason);
    // The builder names the OUTPUT as candidateMint; the execution core keys a sell by the position's mint.
    const envelope = { ...(built.envelope as Record<string, unknown>), candidateMint: p.mint };
    const simulation = { ...(built.simulation as Record<string, unknown>), candidateMint: p.mint };

    const intent: InFlightIntent = { intentId: `sell:${p.mint}:${this.deps.clock()}:${++this.seq}`, mint: p.mint, side: "sell", at: this.deps.clock(), state: "in-flight" };
    this.intents.set(p.mint, intent);
    this.persistIntents();
    let report: MainnetExecutionReport;
    try {
      report = await executeMainnetSell({ ...this.common(input.ledger, input.stop), riskScore: 0, envelopeValue: envelope, simulationValue: simulation, positionId: p.positionId, reason: input.reason, detail: input.detail });
    } finally {
      this.intents.set(p.mint, { ...intent, state: "done" });
      this.persistIntents();
    }
    this.audit({ ...report, ledger: undefined, intentId: intent.intentId });
    if (report.outcome === "confirmed") {
      this.exitAttempts.set(p.positionId, { positionId: p.positionId, attempts: prior.attempts + 1, nextAllowedMs: 0, lastError: null, state: "CLOSED" });
      return { kind: "executed", report };
    }
    if (report.outcome === "submitted-unconfirmed") {
      // Do NOT retry a sell whose status is unknown — a second sell could double-spend the token. Reconcile first.
      this.exitAttempts.set(p.positionId, { positionId: p.positionId, attempts: prior.attempts + 1, nextAllowedMs: Number.MAX_SAFE_INTEGER, lastError: "unconfirmed sell — reconcile before any retry", state: "EXIT_PENDING" });
      return { kind: "executed", report };
    }
    const out = fail(report.refusalDetail ?? report.outcome);
    return { ...out, report };
  }
}
