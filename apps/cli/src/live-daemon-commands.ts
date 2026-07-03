/**
 * The CONTINUOUS PAPER DAEMON + hardened canary buy/sell CLI handlers (Sprint 109).
 *
 * Five commands, one contract: REAL data in, honest artifacts out, and no way to send.
 *
 *   live:sniper:daemon            — the continuous PAPER loop over real market feeds. It discovers
 *                                   (Jupiter recent-tokens + DexScreener), risk-checks (real
 *                                   token:risk over RPC when configured), quotes (real Jupiter),
 *                                   scores, opens/exits PAPER positions by deterministic rule, and
 *                                   journals every decision. Mode is structurally "paper".
 *   live:sniper:paper:report      — turns one daemon session into performance EVIDENCE (honest
 *                                   edge verdict; small sample = inconclusive, loss = no edge).
 *   live:canary:prepare-buy       — the HARDENED buy path: refuses without an ACTIVE operator
 *                                   approval, a FRESH quote, clean risk, a green live policy, and
 *                                   an in-cap spend/slippage; emits an operator buy review + the
 *                                   UNSIGNED canary request. Never signs, never sends.
 *   live:canary:prepare-sell      — the sell mirror: UNSIGNED sell review from a ledger position +
 *                                   a fresh sell-side quote; refuses unknown positions, stale
 *                                   quotes, unverified balances, missing approvals.
 *   live:sniper:reconcile-position — expected-vs-observed balance reconciliation; unknown stays
 *                                   unknown, balances are never invented.
 *
 * Network access is limited to the SAME read-only adapters proven in earlier sprints
 * (@soulmaker/realtime feeds, @soulmaker/quotefetch quotes, token:risk RPC reads). Every seam is
 * injectable so tests drive the daemon without a network. The backend holds no key.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";

import { loadConfig, ConfigError } from "@soulmaker/core";
import type { Config, LoadConfigOptions } from "@soulmaker/core";
import { redactString, redactValue } from "@soulmaker/security";
import {
  buildDaemonSummary,
  buildEscalationPolicy,
  buildLedger,
  buildLiveCanaryRequest,
  buildLivePolicy,
  buildLiveSellRequest,
  buildPaperPerformanceReport,
  closePosition,
  completeLoop,
  createDaemonState,
  dedupeAcrossLoops,
  discoverCandidates,
  applyMark,
  evaluateExitRules,
  evaluateLivePolicy,
  evaluateOperatorApproval,
  formatPaperPerformanceMarkdown,
  getBuiltinProfile,
  ledgerOpen,
  ledgerReplace,
  openPosition,
  profileExitPolicy,
  reconcilePosition,
  recordNoTradeReasons,
  recordProviderOutcome,
  redactCanaryRequestForOutput,
  requireLiveEligibleProfile,
  riskCacheGet,
  riskCachePut,
  bumpTotals,
  providerAllowed,
  scoreStrategyV2,
  shadowDecide,
  validateLedger,
  validateLivePolicy,
  validateOperatorApproval,
  validateStrategyProfile,
  LivePolicyError,
  LivePositionError,
  LiveSellRequestError,
  StrategyProfileError,
  DaemonStateError,
  LiveOperatorApprovalError,
  LiveCanaryRequestError,
} from "@soulmaker/live";
import type {
  DaemonState,
  DaemonSummary,
  LiveCanaryQuoteFacts,
  LiveCanaryRiskFacts,
  LiveModePolicy,
  LivePosition,
  OperatorApprovalEvaluation,
  PositionLedger,
  SniperCandidate,
  SniperCandidateRisk,
  StrategyProfile,
  StrategyQuoteFacts,
} from "@soulmaker/live";
import { createDexscreenerAdapter, createJupiterRecentAdapter } from "@soulmaker/realtime";
import type { CandidateSourceAdapter, CandidateObservation } from "@soulmaker/realtime";
import { createJupiterQuoteAdapter } from "@soulmaker/quotefetch";
import type { QuoteProviderAdapter } from "@soulmaker/quotefetch";
import { validateUnsignedTxEnvelope } from "@soulmaker/txpreview";
import type { UnsignedTxEnvelope } from "@soulmaker/txpreview";

import { tokenRiskReport } from "./commands.js";

export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

/** Daemon bounds — a runaway session is a config error, refused up front. */
export const DAEMON_MAX_DURATION_MINUTES = 480;
export const DAEMON_MIN_POLL_SECONDS = 5;

export interface LiveDaemonContext {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  configPath?: string;
  now?: () => string;
  /** Injectable sleeper (tests: no-op). Sleeps in small chunks so an interrupt lands fast. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable candidate feed adapters (tests: fakes). Default: real Jupiter + DexScreener. */
  candidateSources?: CandidateSourceAdapter[];
  /** Injectable quote provider (tests: fake). Default: the real Jupiter lite adapter. */
  quoteProvider?: QuoteProviderAdapter;
  /**
   * Injectable REAL risk fetcher: returns a parsed token:risk --json report object or null when
   * risk could not be fetched. Default shells into the existing read-only token:risk command.
   */
  riskFetcher?: (mint: string) => Promise<unknown | null>;
  /** Injectable interrupt registration (tests: manual trigger). Returns an unregister fn. */
  registerInterrupt?: (handler: () => void) => () => void;
}

export interface LiveDaemonReport {
  text: string;
  exitCode: number;
}

function toLoadOptions(ctx: LiveDaemonContext): LoadConfigOptions {
  return { cwd: ctx.cwd, env: ctx.env, configPath: ctx.configPath };
}

function isoNow(ctx: LiveDaemonContext): string {
  return ctx.now ? ctx.now() : new Date().toISOString();
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function resolvePath(ctx: LiveDaemonContext, path: string): string {
  const base = ctx.cwd ?? process.cwd();
  return isAbsolute(path) ? normalize(path) : join(base, path);
}

function readJson(ctx: LiveDaemonContext, path: string, label: string): unknown {
  const resolved = resolvePath(ctx, path);
  let text: string;
  try {
    text = stripBom(readFileSync(resolved, "utf8"));
  } catch {
    throw new Error(`cannot read ${label} file at ${resolved}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} file is not valid JSON at ${resolved}`);
  }
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value as Record<string, unknown>;
}

function writeJsonFile(path: string, payload: unknown): void {
  writeFileSync(path, JSON.stringify(payload, null, 2) + "\n");
}

function appendJsonl(path: string, entry: unknown): void {
  appendFileSync(path, JSON.stringify(redactValue(entry)) + "\n");
}

/** Map a token:risk --json report onto the discovery risk shape (same rules as the S108 commands). */
function extractCandidateRisk(value: unknown): SniperCandidateRisk {
  const obj = asObject(value, "risk report");
  const score = typeof obj.score === "number" ? obj.score : NaN;
  const decision = typeof obj.decision === "string" ? obj.decision : "UNKNOWN";
  const flags = Array.isArray(obj.flags) ? obj.flags : [];
  let criticalFlagCount = 0;
  let freezeAuthorityPresent: boolean | null = null;
  let mintAuthorityPresent: boolean | null = null;
  for (const f of flags) {
    if (!f || typeof f !== "object") continue;
    const fid = (f as Record<string, unknown>).id;
    const sev = (f as Record<string, unknown>).severity;
    if (sev === "critical") criticalFlagCount += 1;
    if (fid === "freeze-authority-present") freezeAuthorityPresent = true;
    else if (fid === "freeze-authority-renounced") freezeAuthorityPresent = false;
    if (fid === "mint-authority-present") mintAuthorityPresent = true;
    else if (fid === "mint-authority-renounced") mintAuthorityPresent = false;
  }
  if (!Number.isFinite(score)) throw new Error("risk report has no numeric score");
  return { score, decision, criticalFlagCount, freezeAuthorityPresent, mintAuthorityPresent };
}

/** Parse the leading raw integer out of a quotefetch amountOutLabel ("N raw out ..."). */
function parseOutAmountRaw(label: string | null): string | null {
  if (typeof label !== "string") return null;
  const m = /^([0-9]{1,30}) raw out/.exec(label);
  return m ? (m[1] as string) : null;
}

const LAMPORTS_PER_SOL = 1_000_000_000;

function solToLamportsRaw(sol: number): string {
  return String(Math.round(sol * LAMPORTS_PER_SOL));
}

// ---------------------------------------------------------------------------
// Profile resolution (shared)
// ---------------------------------------------------------------------------

function resolveProfile(ctx: LiveDaemonContext, profileOpt: string | undefined, fallback: string): StrategyProfile {
  const value = profileOpt ?? fallback;
  if (value.endsWith(".json")) return validateStrategyProfile(readJson(ctx, value, "strategy profile"));
  return getBuiltinProfile(value);
}

// ---------------------------------------------------------------------------
// live:sniper:daemon
// ---------------------------------------------------------------------------

export interface LiveSniperDaemonOptions {
  mode?: string;
  durationMinutes?: string;
  pollSeconds?: string;
  outDir?: string;
  maxCandidatesPerLoop?: string;
  maxPaperPositions?: string;
  paperSpendSol?: string;
  applyExits?: boolean;
  profile?: string;
  /** Read-only RPC endpoint enabling REAL per-candidate token:risk checks. */
  rpcUrl?: string;
  /** Comma-separated source ids: jupiter,dexscreener (default both). */
  sources?: string;
  /** Bounded loop count (tests / short proofs). 0/absent = bounded by duration only. */
  maxLoops?: string;
  json?: boolean;
  force?: boolean;
}

interface DaemonFiles {
  sessionPath: string;
  ledgerPath: string;
  candidatesPath: string;
  decisionsPath: string;
  positionsPath: string;
  exitsPath: string;
  providerHealthPath: string;
  summaryPath: string;
  humanReportPath: string;
}

function daemonFiles(outDir: string): DaemonFiles {
  return {
    sessionPath: join(outDir, "session.json"),
    ledgerPath: join(outDir, "ledger.json"),
    candidatesPath: join(outDir, "candidates.jsonl"),
    decisionsPath: join(outDir, "decisions.jsonl"),
    positionsPath: join(outDir, "positions.jsonl"),
    exitsPath: join(outDir, "exits.jsonl"),
    providerHealthPath: join(outDir, "provider-health.json"),
    summaryPath: join(outDir, "summary.json"),
    humanReportPath: join(outDir, "human-report.md"),
  };
}

function defaultSources(sources: string | undefined): CandidateSourceAdapter[] {
  const wanted = (sources ?? "jupiter,dexscreener")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const adapters: CandidateSourceAdapter[] = [];
  for (const w of wanted) {
    if (w === "jupiter") adapters.push(createJupiterRecentAdapter());
    else if (w === "dexscreener") adapters.push(createDexscreenerAdapter());
    else throw new Error(`unknown source "${redactString(w)}" — valid sources: jupiter, dexscreener`);
  }
  if (adapters.length === 0) throw new Error("at least one candidate source is required");
  return adapters;
}

function chunkedSleep(sleep: (ms: number) => Promise<void>, totalMs: number, interrupted: () => boolean): Promise<void> {
  // Sleep in ≤500ms chunks so Ctrl+C lands within half a second.
  return (async () => {
    let remaining = totalMs;
    while (remaining > 0 && !interrupted()) {
      const chunk = Math.min(500, remaining);
      await sleep(chunk);
      remaining -= chunk;
    }
  })();
}

/**
 * The continuous PAPER sniper daemon. Every loop: poll real feeds → dedupe across loops → real
 * risk (cached, TTL) → real quote → score → open paper positions by deterministic rule → mark +
 * exit open positions → journal + persist. Paper-only by construction; nothing here can send.
 */
export async function liveSniperDaemonReport(ctx: LiveDaemonContext = {}, opts: LiveSniperDaemonOptions = {}): Promise<LiveDaemonReport> {
  // --- Validate configuration up front (refusals, not surprises mid-run) ---
  if ((opts.mode ?? "paper") !== "paper") {
    return { text: 'Refusing: --mode must be "paper" — the daemon has no live mode, by design.', exitCode: 1 };
  }
  if (!opts.outDir) {
    return { text: "Refusing: --out-dir is required (e.g. runs/s109-paper-daemon).", exitCode: 1 };
  }
  const durationMinutes = opts.durationMinutes === undefined ? 10 : Number(opts.durationMinutes);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0 || durationMinutes > DAEMON_MAX_DURATION_MINUTES) {
    return { text: `Refusing: --duration-minutes must be in (0, ${DAEMON_MAX_DURATION_MINUTES}].`, exitCode: 1 };
  }
  const pollSeconds = opts.pollSeconds === undefined ? 15 : Number(opts.pollSeconds);
  if (!Number.isInteger(pollSeconds) || pollSeconds < DAEMON_MIN_POLL_SECONDS) {
    return { text: `Refusing: --poll-seconds must be an integer ≥ ${DAEMON_MIN_POLL_SECONDS}.`, exitCode: 1 };
  }
  const maxCandidatesPerLoop = opts.maxCandidatesPerLoop === undefined ? 5 : Number(opts.maxCandidatesPerLoop);
  if (!Number.isInteger(maxCandidatesPerLoop) || maxCandidatesPerLoop < 1 || maxCandidatesPerLoop > 25) {
    return { text: "Refusing: --max-candidates-per-loop must be an integer in [1, 25].", exitCode: 1 };
  }
  const maxLoops = opts.maxLoops === undefined ? Infinity : Number(opts.maxLoops);
  if (opts.maxLoops !== undefined && (!Number.isInteger(maxLoops) || maxLoops < 1)) {
    return { text: "Refusing: --max-loops must be a positive integer.", exitCode: 1 };
  }

  let config: Config;
  try {
    config = loadConfig(toLoadOptions(ctx));
  } catch (err) {
    const msg = err instanceof ConfigError ? err.message : String(err);
    return { text: redactString(`Refusing: config is invalid.\n\n${msg}`), exitCode: 1 };
  }

  let profile: StrategyProfile;
  let sources: CandidateSourceAdapter[];
  try {
    profile = resolveProfile(ctx, opts.profile, "balanced");
    sources = ctx.candidateSources ?? defaultSources(opts.sources);
  } catch (err) {
    const msg = err instanceof StrategyProfileError || err instanceof Error ? err.message : String(err);
    return { text: redactString(`Refusing: ${msg}`), exitCode: 1 };
  }
  const maxPaperPositions = opts.maxPaperPositions === undefined ? profile.maxOpenPositions : Number(opts.maxPaperPositions);
  if (!Number.isInteger(maxPaperPositions) || maxPaperPositions < 1) {
    return { text: "Refusing: --max-paper-positions must be a positive integer.", exitCode: 1 };
  }
  const paperSpendSol = opts.paperSpendSol === undefined ? profile.maxSpendSol : Number(opts.paperSpendSol);
  if (!Number.isFinite(paperSpendSol) || paperSpendSol <= 0 || paperSpendSol > profile.maxSpendSol) {
    return { text: `Refusing: --paper-spend-sol must be in (0, ${profile.maxSpendSol}] (the profile's maxSpendSol; caps only tighten).`, exitCode: 1 };
  }

  const outDir = resolvePath(ctx, opts.outDir);
  const files = daemonFiles(outDir);
  try {
    mkdirSync(outDir, { recursive: true });
  } catch {
    return { text: redactString(`Refusing: cannot create --out-dir at ${outDir}`), exitCode: 1 };
  }
  if (!opts.force && existsSync(files.sessionPath)) {
    return { text: redactString(`Refusing: ${files.sessionPath} already exists (pass --force to overwrite the session).`), exitCode: 1 };
  }

  const quoteProvider = ctx.quoteProvider ?? createJupiterQuoteAdapter();
  const riskFetcher =
    ctx.riskFetcher ??
    (opts.rpcUrl
      ? async (mint: string): Promise<unknown | null> => {
          // The SAME read-only token:risk command an operator runs by hand; JSON parsed or null.
          const text = await tokenRiskReport(mint, { cwd: ctx.cwd, env: ctx.env, configPath: ctx.configPath }, { json: true, allowPaperRead: true, rpcUrl: opts.rpcUrl });
          try {
            return JSON.parse(text) as unknown;
          } catch {
            return null;
          }
        }
      : null);

  const sleep = ctx.sleep ?? ((ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms)));
  let interrupted = false;
  const unregister = (ctx.registerInterrupt ?? ((handler: () => void): (() => void) => {
    const h = (): void => handler();
    process.on("SIGINT", h);
    return () => process.removeListener("SIGINT", h);
  }))(() => {
    interrupted = true;
  });

  const startedAt = isoNow(ctx);
  let state: DaemonState = createDaemonState({ startedAt, profileName: profile.name });
  let ledger: PositionLedger = buildLedger();
  const deadlineMs = Date.parse(startedAt) + durationMinutes * 60_000;
  const exitPolicy = profileExitPolicy(profile);

  const journalDecision = (entry: Record<string, unknown>): void => appendJsonl(files.decisionsPath, entry);

  const persist = (): void => {
    writeJsonFile(files.sessionPath, redactValue(state));
    writeJsonFile(files.ledgerPath, redactValue(ledger));
    writeJsonFile(files.providerHealthPath, redactValue({ schemaVersion: "live.sniper.daemon.provider_health.v1", at: state.lastLoopAt ?? startedAt, providers: state.providerHealth }));
  };

  let endedBy: DaemonSummary["endedBy"] = "duration-elapsed";
  try {
    // ---------------- the loop ----------------
    for (;;) {
      const loopAt = isoNow(ctx);
      const loopMs = Date.parse(loopAt);

      // 1) Poll every allowed source; one bad provider never kills the loop.
      const observations: CandidateObservation[] = [];
      for (const source of sources) {
        if (!providerAllowed(state, source.providerId, loopMs)) {
          journalDecision({ at: loopAt, stage: "discover", provider: source.providerId, action: "skipped", reason: "provider-backed-off" });
          continue;
        }
        try {
          const result = await source.fetchOnce();
          state = recordProviderOutcome(state, source.providerId, result.status, loopMs, result.metadata.statusDetail);
          if (result.status === "observed") observations.push(...result.observations);
          else journalDecision({ at: loopAt, stage: "discover", provider: source.providerId, action: "no-data", reason: result.status, detail: result.metadata.statusDetail });
        } catch (err) {
          // Adapters are contracted not to throw; if one does anyway, the daemon survives it.
          state = recordProviderOutcome(state, source.providerId, "error", loopMs, (err as Error).message ?? "adapter threw");
          journalDecision({ at: loopAt, stage: "discover", provider: source.providerId, action: "no-data", reason: "adapter-threw" });
        }
      }

      // 2) Normalize + dedupe (within the batch, then across loops).
      const discovery = discoverCandidates({ observations }, { discoveredAt: loopAt });
      for (const c of discovery.candidates) appendJsonl(files.candidatesPath, { at: loopAt, mint: c.mint, symbol: c.symbol, source: c.sourceProvider, liquidityUsd: c.liquidityUsd, confidence: c.confidence });
      const deduped = dedupeAcrossLoops(state, discovery.candidates);
      state = deduped.state;

      const toProcess = deduped.fresh.slice(0, maxCandidatesPerLoop);
      for (const skipped of deduped.fresh.slice(maxCandidatesPerLoop)) {
        state = recordNoTradeReasons(state, ["loop-capacity-reached"]);
        journalDecision({ at: loopAt, stage: "capacity", mint: skipped.mint, action: "skip", reason: "loop-capacity-reached" });
      }

      // 3..6) Per candidate: risk → liquidity floor → quote → score → deterministic paper entry.
      for (const raw of toProcess) {
        let candidate: SniperCandidate = raw;
        const blocking: string[] = [];

        // Risk (cache first, then the REAL fetcher when configured).
        let risk = riskCacheGet(state, candidate.mint, loopMs);
        if (risk !== null) {
          state = bumpTotals(state, { riskCacheHits: 1 });
        } else if (riskFetcher !== null) {
          try {
            const report = await riskFetcher(candidate.mint);
            if (report !== null) {
              risk = extractCandidateRisk(report);
              state = riskCachePut(state, candidate.mint, risk, loopMs);
              state = bumpTotals(state, { riskChecked: 1 });
            } else {
              blocking.push("risk-unavailable");
            }
          } catch {
            blocking.push("risk-unavailable");
          }
        } else {
          blocking.push("risk-not-configured");
        }
        if (risk !== null) {
          candidate = { ...candidate, risk };
          if (risk.decision === "REJECT" || risk.criticalFlagCount > 0) {
            state = bumpTotals(state, { riskRejected: 1 });
            blocking.push(`risk-rejected (score ${risk.score}, ${risk.decision})`);
          } else if (risk.score > profile.maxRiskScore) {
            state = bumpTotals(state, { riskRejected: 1 });
            blocking.push(`risk-score-over-profile-cap (${risk.score} > ${profile.maxRiskScore})`);
          }
        }

        // Liquidity floor (known-and-below → reject; unknown → recorded, not invented).
        if (candidate.liquidityUsd !== null && candidate.liquidityUsd < profile.minLiquidityUsd) {
          state = bumpTotals(state, { liquidityRejected: 1 });
          blocking.push(`liquidity-below-floor (${candidate.liquidityUsd} < ${profile.minLiquidityUsd})`);
        }

        // Quote (only when nothing has blocked yet — save the rate limit for viable candidates).
        let quote: StrategyQuoteFacts | null = null;
        let entryOutAmountRaw: string | null = null;
        if (blocking.length === 0) {
          try {
            const q = await quoteProvider.fetchQuote({
              candidateMint: candidate.mint,
              inputMint: WRAPPED_SOL_MINT,
              amountRaw: solToLamportsRaw(paperSpendSol),
              slippageBps: profile.maxSlippageBps,
            });
            if (q.status === "quote-observed") {
              const fetchedMs = Date.parse(q.metadata.fetchedAt);
              const ageMs = Number.isFinite(fetchedMs) ? Math.max(0, loopMs - fetchedMs) : null;
              quote = {
                priceImpactPct: q.metadata.priceImpactPct !== null ? Number(q.metadata.priceImpactPct) : null,
                ageMs,
                slippageBps: profile.maxSlippageBps,
                routeConfidence: null,
                provider: q.metadata.providerId,
              };
              if (quote.priceImpactPct !== null && !Number.isFinite(quote.priceImpactPct)) quote.priceImpactPct = null;
              entryOutAmountRaw = parseOutAmountRaw(q.observation.amountOutLabel);
              state = bumpTotals(state, { quotesFetched: 1 });
              if (ageMs !== null && ageMs > profile.quoteFreshnessTtlMs) {
                state = bumpTotals(state, { quotesStale: 1 });
                blocking.push("quote-stale");
              }
            } else {
              state = bumpTotals(state, { quotesUnavailable: 1 });
              blocking.push(`quote-${q.status}`);
            }
          } catch {
            state = bumpTotals(state, { quotesUnavailable: 1 });
            blocking.push("quote-fetch-failed");
          }
        }

        // Score + shadow decision (the same strategy the loop uses; nothing bespoke).
        const strategy = scoreStrategyV2({ candidate, quote, riskAppetite: profile.riskAppetite, timestamp: loopAt });
        const shadow = shadowDecide({ candidate, strategy, quote, decidedAt: loopAt }, { outAmountRaw: entryOutAmountRaw });

        // Deterministic paper-entry rule: EVERY condition must hold.
        const openPaper = ledger.positions.filter((p) => p.status === "open" && p.kind === "paper");
        const quoteFresh = quote !== null && quote.ageMs !== null && quote.ageMs <= profile.quoteFreshnessTtlMs;
        const rules: Array<[string, boolean]> = [
          ["no-blocking-reasons", blocking.length === 0],
          ["shadow-would-enter", shadow.decision === "would_enter"],
          ["no-strategy-hard-block", strategy.hardBlocks.length === 0],
          ["quote-fresh", quoteFresh],
          ["expected-tokens-known", entryOutAmountRaw !== null],
          ["position-capacity", openPaper.length < Math.min(maxPaperPositions, profile.maxOpenPositions)],
          ["no-open-position-for-mint", !openPaper.some((p) => p.mint === candidate.mint)],
        ];
        const failed = rules.filter(([, ok]) => !ok).map(([name]) => name);

        if (failed.length === 0) {
          try {
            const position = openPosition({
              kind: "paper",
              mint: candidate.mint,
              symbol: candidate.symbol,
              openedAt: loopAt,
              entrySpendLamports: Math.round(paperSpendSol * LAMPORTS_PER_SOL),
              tokenAmountRaw: entryOutAmountRaw,
            });
            ledger = ledgerOpen(ledger, position);
            state = bumpTotals(state, { positionsOpened: 1 });
            appendJsonl(files.positionsPath, { at: loopAt, event: "open", positionId: position.positionId, mint: position.mint, entrySpendLamports: position.entrySpendLamports, tokenAmountRaw: position.tokenAmountRaw });
            journalDecision({ at: loopAt, stage: "entry", mint: candidate.mint, action: "paper-open", score: strategy.score, decision: strategy.decision });
          } catch (err) {
            journalDecision({ at: loopAt, stage: "entry", mint: candidate.mint, action: "open-refused", reason: (err as Error).message });
          }
        } else {
          const reasons = [...blocking, ...strategy.hardBlocks, ...failed.filter((f) => f !== "no-blocking-reasons" && f !== "no-strategy-hard-block")];
          state = recordNoTradeReasons(state, reasons.length > 0 ? reasons : ["not-eligible"]);
          journalDecision({ at: loopAt, stage: "entry", mint: candidate.mint, action: "no-trade", score: strategy.score, decision: strategy.decision, failedRules: failed, blocking: reasons.slice(0, 8) });
        }
      }

      // 7..8) Mark + exit every open paper position via a REAL sell-side quote.
      for (const p of ledger.positions) {
        if (p.status !== "open" || p.kind !== "paper") continue;
        let marked: LivePosition = p;
        if (p.tokenAmountRaw !== null) {
          try {
            const sellQ = await quoteProvider.fetchQuote({
              candidateMint: WRAPPED_SOL_MINT,
              inputMint: p.mint,
              amountRaw: p.tokenAmountRaw,
              slippageBps: profile.maxSlippageBps,
            });
            if (sellQ.status === "quote-observed") {
              const out = parseOutAmountRaw(sellQ.observation.amountOutLabel);
              if (out !== null && Number.isSafeInteger(Number(out)) && Number(out) > 0) {
                marked = applyMark(p, { valueLamports: Number(out), atMs: loopMs, source: sellQ.metadata.providerId });
                ledger = ledgerReplace(ledger, marked);
                state = bumpTotals(state, { quotesFetched: 1 });
              }
            } else {
              state = bumpTotals(state, { quotesUnavailable: 1 });
            }
          } catch {
            state = bumpTotals(state, { quotesUnavailable: 1 });
          }
        }
        const decision = evaluateExitRules({ position: marked, policy: exitPolicy, nowMs: loopMs, killSwitch: config.killSwitch === true });
        if (decision.shouldExit && decision.reason !== null) {
          appendJsonl(files.exitsPath, { at: loopAt, positionId: marked.positionId, mint: marked.mint, reason: decision.reason, unrealizedPnlPct: decision.unrealizedPnlPct, applied: Boolean(opts.applyExits), detail: decision.detail });
          if (opts.applyExits) {
            const closed = closePosition({
              position: marked,
              closedAt: loopAt,
              reason: decision.reason,
              closeKind: "paper-auto",
              valueLamports: marked.lastMark?.valueLamports ?? null,
              detail: decision.detail,
            });
            ledger = ledgerReplace(ledger, closed);
            state = bumpTotals(state, { positionsClosed: 1 });
            appendJsonl(files.positionsPath, { at: loopAt, event: "close", positionId: closed.positionId, mint: closed.mint, reason: decision.reason, pnlLamports: closed.close?.pnlLamports ?? null });
          }
        }
      }

      // 9..10) Persist every loop; decide whether to keep going.
      state = completeLoop(state, loopAt);
      persist();

      if (interrupted) {
        endedBy = "operator-interrupt";
        break;
      }
      if (state.totals.loops >= maxLoops) {
        endedBy = "max-loops-reached";
        break;
      }
      if (Date.parse(isoNow(ctx)) + pollSeconds * 1000 > deadlineMs) {
        endedBy = "duration-elapsed";
        break;
      }
      await chunkedSleep(sleep, pollSeconds * 1000, () => interrupted);
      if (interrupted) {
        endedBy = "operator-interrupt";
        break;
      }
    }
  } catch (err) {
    unregister();
    const msg = err instanceof DaemonStateError || err instanceof LivePositionError || err instanceof Error ? err.message : String(err);
    persist();
    return { text: redactString(`Daemon aborted on an unexpected error (state persisted honestly): ${msg}`), exitCode: 1 };
  }
  unregister();

  // Final artifacts: summary + human report.
  const endedAt = isoNow(ctx);
  const summary = buildDaemonSummary(state, { endedAt, endedBy, positions: ledger.totals });
  writeJsonFile(files.summaryPath, redactValue(summary));
  const performance = buildPaperPerformanceReport({ summary, ledger, generatedAt: endedAt });
  const humanLines: string[] = [];
  humanLines.push(`# Paper daemon session — ${profile.name}`);
  humanLines.push("");
  humanLines.push(`${startedAt} → ${endedAt} (${state.totals.loops} loop(s), ended by ${endedBy}). PAPER only — nothing was sent.`);
  humanLines.push("");
  humanLines.push(`- Candidates seen ${state.totals.candidatesSeen} (new ${state.totals.newCandidates}, duplicates ${state.totals.duplicatesSkipped})`);
  humanLines.push(`- Risk checked ${state.totals.riskChecked} (cache hits ${state.totals.riskCacheHits}, rejected ${state.totals.riskRejected})`);
  humanLines.push(`- Quotes fetched ${state.totals.quotesFetched} (stale ${state.totals.quotesStale}, unavailable ${state.totals.quotesUnavailable})`);
  humanLines.push(`- Paper positions opened ${state.totals.positionsOpened}, closed ${state.totals.positionsClosed}, open ${ledger.totals.open}`);
  humanLines.push(`- Known realized PnL ${ledger.totals.realizedPnlKnownLamports} lamports (unknown closes: ${ledger.totals.closedPnlUnknown})`);
  humanLines.push(`- Edge verdict: ${performance.edge.verdict}`);
  humanLines.push("");
  humanLines.push("Full evidence: summary.json, ledger.json, candidates.jsonl, decisions.jsonl, positions.jsonl, exits.jsonl, provider-health.json.");
  humanLines.push("Generate the full performance report with live:sniper:paper:report.");
  writeFileSync(files.humanReportPath, redactString(humanLines.join("\n")) + "\n");

  if (opts.json) return { text: JSON.stringify(redactValue(summary), null, 2), exitCode: 0 };
  const lines: string[] = [];
  lines.push("PAPER SNIPER DAEMON — session complete (PAPER only; the daemon can never send)");
  lines.push("=============================================================================");
  lines.push(`profile: ${profile.name}   loops: ${state.totals.loops}   ended by: ${endedBy}`);
  lines.push(`candidates: ${state.totals.candidatesSeen} seen, ${state.totals.newCandidates} new, ${state.totals.duplicatesSkipped} duplicates`);
  lines.push(`risk: ${state.totals.riskChecked} checked, ${state.totals.riskRejected} rejected   quotes: ${state.totals.quotesFetched} fetched, ${state.totals.quotesUnavailable} unavailable`);
  lines.push(`paper positions: ${state.totals.positionsOpened} opened, ${state.totals.positionsClosed} closed, ${ledger.totals.open} still open`);
  lines.push(`known realized PnL: ${ledger.totals.realizedPnlKnownLamports} lamports   edge: ${performance.edge.verdict}`);
  lines.push("");
  lines.push(`artifacts: ${outDir}`);
  return { text: redactString(lines.join("\n")), exitCode: 0 };
}

// ---------------------------------------------------------------------------
// live:sniper:paper:report
// ---------------------------------------------------------------------------

export interface LivePaperReportOptions {
  sessionDir?: string;
  out?: string;
  json?: boolean;
  force?: boolean;
}

export function liveSniperPaperReportReport(ctx: LiveDaemonContext = {}, opts: LivePaperReportOptions = {}): LiveDaemonReport {
  if (!opts.sessionDir) return { text: "Refusing: --session <dir> is required (a live:sniper:daemon --out-dir).", exitCode: 1 };
  try {
    const dir = resolvePath(ctx, opts.sessionDir);
    const summaryRaw = readJson(ctx, join(dir, "summary.json"), "daemon summary");
    const ledger = validateLedger(readJson(ctx, join(dir, "ledger.json"), "position ledger"));
    // The summary is consumed structurally; its state core is re-validated where it matters.
    const summary = asObject(summaryRaw, "daemon summary") as unknown as DaemonSummary;
    if (summary.schemaVersion !== "live.sniper.daemon.summary.v1") {
      return { text: "Refusing: summary.json is not a live.sniper.daemon.summary.v1 artifact.", exitCode: 1 };
    }
    const report = buildPaperPerformanceReport({ summary, ledger, generatedAt: isoNow(ctx) });
    const md = formatPaperPerformanceMarkdown(report);

    let wrote = "";
    if (opts.out) {
      const resolved = resolvePath(ctx, opts.out);
      if (!opts.force && existsSync(resolved)) return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
      writeFileSync(resolved, redactString(md));
      writeJsonFile(resolved.replace(/\.md$/, "") + ".json", redactValue(report));
      wrote = `\nwrote ${resolved} (+ .json)`;
    }
    if (opts.json) return { text: JSON.stringify(redactValue(report), null, 2), exitCode: 0 };
    return { text: redactString(md) + wrote, exitCode: 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: redactString(`Refusing: ${msg}`), exitCode: 1 };
  }
}

// ---------------------------------------------------------------------------
// Shared canary-prepare plumbing (approval + policy + quote coercion)
// ---------------------------------------------------------------------------

function coerceQuoteFacts(value: unknown): LiveCanaryQuoteFacts {
  const obj = asObject(value, "quote facts");
  const str = (k: string): string => {
    const v = obj[k];
    if (typeof v !== "string") throw new Error(`quote facts.${k} must be a string`);
    return v;
  };
  const numOrNull = (k: string): number | null => (typeof obj[k] === "number" ? (obj[k] as number) : null);
  const labels = Array.isArray(obj.routeLabels) ? obj.routeLabels.filter((x): x is string => typeof x === "string") : [];
  if (typeof obj.slippageBps !== "number") throw new Error("quote facts.slippageBps must be a number");
  return {
    provider: str("provider"),
    inputMint: str("inputMint"),
    outputMint: str("outputMint"),
    inAmountRaw: str("inAmountRaw"),
    outAmountRaw: str("outAmountRaw"),
    slippageBps: obj.slippageBps,
    priceImpactPct: numOrNull("priceImpactPct"),
    quotedAt: typeof obj.quotedAt === "string" ? obj.quotedAt : null,
    ageMs: numOrNull("ageMs"),
    routeLabels: labels,
  };
}

function extractRiskFacts(value: unknown): LiveCanaryRiskFacts {
  const obj = asObject(value, "risk report");
  const score = typeof obj.score === "number" ? obj.score : NaN;
  const decision = typeof obj.decision === "string" ? obj.decision : "UNKNOWN";
  const flags = Array.isArray(obj.flags) ? obj.flags : [];
  const flagIds: string[] = [];
  let criticalFlagCount = 0;
  for (const f of flags) {
    if (f && typeof f === "object") {
      const fid = (f as Record<string, unknown>).id;
      const sev = (f as Record<string, unknown>).severity;
      if (typeof fid === "string") flagIds.push(fid);
      if (sev === "critical") criticalFlagCount += 1;
    }
  }
  if (!Number.isFinite(score)) throw new Error("risk report has no numeric score");
  return { score, decision, criticalFlagCount, flagIds };
}

/** Load + evaluate an operator approval; the caller decides how to refuse. */
function loadApproval(ctx: LiveDaemonContext, path: string, nowMs: number): OperatorApprovalEvaluation {
  const approval = validateOperatorApproval(readJson(ctx, path, "operator approval"));
  return evaluateOperatorApproval(approval, nowMs);
}

/**
 * Compute the quote's effective age at `nowMs`. Prefers an explicit ageMs; falls back to
 * quotedAt. Null when neither is usable (the caller treats that as NOT fresh).
 */
function quoteAgeAt(quote: LiveCanaryQuoteFacts, nowMs: number): number | null {
  if (quote.ageMs !== null && Number.isFinite(quote.ageMs)) return quote.ageMs;
  if (quote.quotedAt !== null) {
    const t = Date.parse(quote.quotedAt);
    if (Number.isFinite(t)) return Math.max(0, nowMs - t);
  }
  return null;
}

// ---------------------------------------------------------------------------
// live:canary:prepare-buy — the hardened buy path
// ---------------------------------------------------------------------------

export interface LiveCanaryPrepareBuyOptions {
  candidateMint?: string;
  riskPath?: string;
  quotePath?: string;
  approvalPath?: string;
  policyPath?: string;
  envelopePath?: string;
  simulationPath?: string;
  spendSol?: string;
  profile?: string;
  symbol?: string;
  outDir?: string;
  json?: boolean;
  force?: boolean;
}

/**
 * HARDENED buy prepare. Unlike the S107 `live:canary:prepare` (which can emit blocked artifacts
 * for review), this command REFUSES loudly unless EVERY gate is green up front: active approval,
 * fresh quote, clean risk, green live policy, in-cap spend + slippage, live-eligible profile.
 * On green it assembles the same UNSIGNED live.canary.request.v1 plus an operator buy review.
 * It never signs and never sends; Phantom + the human remain the only send path.
 */
export function liveCanaryPrepareBuyReport(ctx: LiveDaemonContext = {}, opts: LiveCanaryPrepareBuyOptions = {}): LiveDaemonReport {
  const refuse = (msg: string): LiveDaemonReport => ({ text: redactString(`Refusing: ${msg}`), exitCode: 1 });
  if (!opts.candidateMint) return refuse("--candidate-mint is required.");
  if (!opts.riskPath) return refuse("--risk is required (a token:risk --json report; preparing blind is refused).");
  if (!opts.quotePath) return refuse("--quote is required (fresh quote facts; a buy without a fresh quote is refused).");
  if (!opts.approvalPath) return refuse("--approval is required (create one with live:sniper:approve; there is no flag substitute).");
  if (!opts.policyPath) return refuse("--policy is required (a live.policy.v1 file; the default policy blocks live and this command refuses instead of pretending).");

  try {
    const nowIso = isoNow(ctx);
    const nowMs = Date.parse(nowIso);

    // Profile: live-gated default is conservative; a paper-only profile is refused.
    const profile = requireLiveEligibleProfile(resolveProfile(ctx, opts.profile, "conservative"));

    // Approval: required AND active (an expired approval is exactly as powerless as none).
    const approvalEval = loadApproval(ctx, opts.approvalPath, Number.isFinite(nowMs) ? nowMs : 0);
    if (!approvalEval.active) {
      return refuse(`the operator approval is not active (${approvalEval.reasons.join(", ") || "inactive"}) — create a fresh one with live:sniper:approve.`);
    }

    // Live policy: must be canary-green.
    const policy: LiveModePolicy = validateLivePolicy(readJson(ctx, opts.policyPath, "live policy"));
    const policyEval = evaluateLivePolicy(policy);
    if (!policyEval.canaryArmAllowed) {
      return refuse(`the live policy does not allow arming a canary: ${policyEval.blockingReasons.join(", ")}.`);
    }

    // Risk: must be clean (REJECT / critical flags / over-cap are refusals, not warnings).
    const risk = extractRiskFacts(readJson(ctx, opts.riskPath, "risk report"));
    if (risk.decision === "REJECT") return refuse(`the risk report says REJECT (score ${risk.score}) — a rejected token can never be bought.`);
    if (risk.criticalFlagCount > 0) return refuse(`the risk report carries ${risk.criticalFlagCount} critical flag(s) (${risk.flagIds.slice(0, 4).join(", ")}) — refused.`);
    if (risk.score > policy.caps.riskScoreCap) return refuse(`risk score ${risk.score} exceeds the policy cap ${policy.caps.riskScoreCap}.`);
    if (risk.score > profile.maxRiskScore) return refuse(`risk score ${risk.score} exceeds the profile ("${profile.name}") cap ${profile.maxRiskScore}.`);

    // Quote: must be for this mint and FRESH per the policy TTL.
    const quote = coerceQuoteFacts(readJson(ctx, opts.quotePath, "quote facts"));
    if (quote.outputMint !== opts.candidateMint) return refuse(`the quote's outputMint (${quote.outputMint}) is not the candidate mint.`);
    const age = quoteAgeAt(quote, Number.isFinite(nowMs) ? nowMs : 0);
    if (age === null) return refuse("the quote's age is unknown (no ageMs and no parseable quotedAt) — an unverifiable quote is treated as stale.");
    if (age > policy.freshness.quoteTtlMs) return refuse(`the quote is STALE (${age}ms old > TTL ${policy.freshness.quoteTtlMs}ms) — fetch a fresh quote and retry.`);
    if (quote.slippageBps > policy.caps.maxSlippageBps) return refuse(`quote slippage ${quote.slippageBps} bps exceeds the policy cap ${policy.caps.maxSlippageBps} bps.`);
    if (quote.slippageBps > profile.maxSlippageBps) return refuse(`quote slippage ${quote.slippageBps} bps exceeds the profile cap ${profile.maxSlippageBps} bps.`);

    // Spend: required, and within EVERY ceiling (policy cap, escalation canary cap, profile cap).
    if (opts.spendSol === undefined) return refuse("--spend-sol is required.");
    const spendSol = Number(opts.spendSol);
    if (!Number.isFinite(spendSol) || spendSol <= 0) return refuse("--spend-sol must be a positive number.");
    const escalation = buildEscalationPolicy();
    const ceiling = Math.min(policy.caps.maxTradeSol, escalation.maxCanarySol, profile.maxSpendSol);
    if (spendSol > ceiling) {
      return refuse(`spend ${spendSol} SOL exceeds the effective canary ceiling ${ceiling} SOL (min of policy ${policy.caps.maxTradeSol}, escalation ${escalation.maxCanarySol}, profile ${profile.maxSpendSol}).`);
    }
    const spendLamports = String(Math.round(spendSol * LAMPORTS_PER_SOL));

    // Optional real UNSIGNED envelope + simulation facts (same rules as live:canary:prepare).
    let envelope: UnsignedTxEnvelope | null = null;
    if (opts.envelopePath) {
      envelope = validateUnsignedTxEnvelope(readJson(ctx, opts.envelopePath, "envelope"));
      if (envelope.candidateMint !== null && envelope.candidateMint !== opts.candidateMint) {
        return refuse(`envelope candidateMint (${envelope.candidateMint}) != --candidate-mint (${opts.candidateMint}).`);
      }
    }
    const preflight = opts.simulationPath
      ? ((): { simulationOutcome: string | null; simulationClassification: string | null } => {
          const sim = asObject(readJson(ctx, opts.simulationPath!, "simulation report"), "simulation report");
          return {
            simulationOutcome: typeof sim.outcome === "string" ? sim.outcome : null,
            simulationClassification: typeof sim.classification === "string" ? sim.classification : null,
          };
        })()
      : { simulationOutcome: null, simulationClassification: null };

    // All gates green — assemble the UNSIGNED request (its builder re-derives its own state).
    const request = buildLiveCanaryRequest({
      policy,
      createdAt: nowIso,
      nowMs: Number.isFinite(nowMs) ? nowMs : 0,
      candidate: { mint: opts.candidateMint, symbol: opts.symbol ?? null },
      quote,
      risk,
      preflight,
      spendLamports,
      envelope,
      auditLogPathProvided: true,
    });
    const finalRequest = redactCanaryRequestForOutput(request);

    const review = {
      schemaVersion: "live.canary.buy_review.v1",
      createdAt: nowIso,
      candidate: { mint: opts.candidateMint, symbol: opts.symbol ?? null },
      profile: profile.name,
      approval: { active: true, expiresInMs: approvalEval.remainingMs },
      spend: { sol: spendSol, lamports: spendLamports, effectiveCeilingSol: ceiling },
      maxLossSol: spendSol,
      risk: { score: risk.score, decision: risk.decision, criticalFlagCount: risk.criticalFlagCount, flagIds: risk.flagIds },
      quote: {
        provider: quote.provider,
        inAmountRaw: quote.inAmountRaw,
        expectedTokensRaw: quote.outAmountRaw,
        slippageBps: quote.slippageBps,
        priceImpactPct: quote.priceImpactPct,
        ageMs: age,
        ttlMs: policy.freshness.quoteTtlMs,
        routeLabels: quote.routeLabels,
      },
      requestState: request.state,
      blockingReasons: request.blockingReasons,
      nextStep:
        request.state === "preflight_ready"
          ? "Load the canary request into the web Live Console and confirm in Phantom yourself."
          : "Run a green simulation (paper:simulation:tx) and re-prepare to reach preflight_ready before arming.",
      signed: false,
      submitted: false,
      backendCustodiesNoKeys: true,
      requiresPhantomHumanConfirmation: true,
      notProfitabilityClaim: true,
    };

    let wrote = "";
    if (opts.outDir) {
      const dir = resolvePath(ctx, opts.outDir);
      mkdirSync(dir, { recursive: true });
      const jsonPath = join(dir, "buy-review.json");
      const mdPath = join(dir, "buy-review.md");
      const requestPath = join(dir, "canary-request.json");
      for (const p of [jsonPath, mdPath, requestPath]) {
        if (!opts.force && existsSync(p)) return refuse(`${p} already exists (pass --force to overwrite).`);
      }
      writeJsonFile(jsonPath, redactValue(review));
      writeJsonFile(requestPath, finalRequest);
      const md: string[] = [];
      md.push(`# BUY REVIEW — ${opts.candidateMint}${opts.symbol ? ` (${opts.symbol})` : ""}`);
      md.push("");
      md.push("UNSIGNED. The backend holds no key. You sign in Phantom, or nothing happens. Max loss = full spend.");
      md.push("");
      md.push(`- Spend: **${spendSol} SOL** (${spendLamports} lamports; ceiling ${ceiling} SOL)`);
      md.push(`- Max loss: **${spendSol} SOL** (memecoins can go to zero)`);
      md.push(`- Risk: score ${risk.score}, ${risk.decision}, ${risk.criticalFlagCount} critical flag(s)`);
      md.push(`- Quote: ${quote.outAmountRaw} tokens expected (raw), slippage ${quote.slippageBps} bps, impact ${quote.priceImpactPct ?? "?"}%, age ${age}ms / TTL ${policy.freshness.quoteTtlMs}ms via ${quote.provider}`);
      md.push(`- Approval: active, ${Math.round(approvalEval.remainingMs / 1000)}s remaining`);
      md.push(`- Profile: ${profile.name} (live-eligible)`);
      md.push(`- Request state: ${request.state}`);
      md.push("");
      md.push(review.nextStep);
      writeFileSync(mdPath, redactString(md.join("\n")) + "\n");
      wrote = `\nwrote ${jsonPath}\nwrote ${mdPath}\nwrote ${requestPath}`;
    }

    if (opts.json) return { text: JSON.stringify(redactValue(review), null, 2), exitCode: 0 };
    const lines: string[] = [];
    lines.push("BUY CANARY PREPARED (UNSIGNED; every gate was green; Phantom still decides)");
    lines.push("==========================================================================");
    lines.push(`candidate: ${opts.candidateMint}   spend: ${spendSol} SOL (max loss ${spendSol} SOL)`);
    lines.push(`risk: ${risk.score}/${risk.decision}   quote age: ${age}ms (TTL ${policy.freshness.quoteTtlMs}ms)   slippage: ${quote.slippageBps} bps`);
    lines.push(`approval: active (${Math.round(approvalEval.remainingMs / 1000)}s left)   profile: ${profile.name}   request: ${request.state}`);
    lines.push("");
    lines.push(review.nextStep);
    return { text: redactString(lines.join("\n")) + wrote, exitCode: 0 };
  } catch (err) {
    const msg =
      err instanceof LivePolicyError ||
      err instanceof LiveOperatorApprovalError ||
      err instanceof LiveCanaryRequestError ||
      err instanceof StrategyProfileError ||
      err instanceof Error
        ? err.message
        : String(err);
    return { text: redactString(`Refusing: ${msg}`), exitCode: 1 };
  }
}

// ---------------------------------------------------------------------------
// live:canary:prepare-sell
// ---------------------------------------------------------------------------

export interface LiveCanaryPrepareSellOptions {
  ledgerPath?: string;
  positionId?: string;
  mint?: string;
  quotePath?: string;
  approvalPath?: string;
  policyPath?: string;
  envelopePath?: string;
  emergency?: boolean;
  profile?: string;
  outDir?: string;
  json?: boolean;
  force?: boolean;
}

/**
 * Prepare an UNSIGNED sell review for one ledger position. The builder in @soulmaker/live owns the
 * refusal logic (unknown position / stale quote / unverified balance / missing approval / policy);
 * this handler resolves the position, loads the artifacts, and writes sell-review.json + .md.
 * A blocked result exits 1 — a refusal is loud, not a warning.
 */
export function liveCanaryPrepareSellReport(ctx: LiveDaemonContext = {}, opts: LiveCanaryPrepareSellOptions = {}): LiveDaemonReport {
  const refuse = (msg: string): LiveDaemonReport => ({ text: redactString(`Refusing: ${msg}`), exitCode: 1 });
  if (!opts.ledgerPath) return refuse("--ledger <path> is required.");
  if (!opts.positionId && !opts.mint) return refuse("--position-id or --mint is required.");
  try {
    const nowIso = isoNow(ctx);
    const nowMs = Date.parse(nowIso);

    const ledger = validateLedger(readJson(ctx, opts.ledgerPath, "position ledger"));
    const position = ledger.positions.find((p) => (opts.positionId ? p.positionId === opts.positionId : p.mint === opts.mint && p.status === "open"));
    if (position === undefined) {
      return refuse(`no ${opts.positionId ? `position "${opts.positionId}"` : `open position for mint ${opts.mint}`} exists in the ledger — an unknown position can never be sold.`);
    }

    // Live-gated path: profile must be live-eligible (conservative default).
    requireLiveEligibleProfile(resolveProfile(ctx, opts.profile, "conservative"));

    const quote = opts.quotePath ? coerceQuoteFacts(readJson(ctx, opts.quotePath, "sell quote facts")) : null;
    // Normalize the quote age against NOW so a stale quotedAt is caught even without ageMs.
    const quoteWithAge = quote === null ? null : { ...quote, ageMs: quoteAgeAt(quote, Number.isFinite(nowMs) ? nowMs : 0) };

    const approvalEvaluation = opts.approvalPath ? loadApproval(ctx, opts.approvalPath, Number.isFinite(nowMs) ? nowMs : 0) : null;
    const policy = opts.policyPath ? validateLivePolicy(readJson(ctx, opts.policyPath, "live policy")) : buildLivePolicy();
    const envelope = opts.envelopePath ? validateUnsignedTxEnvelope(readJson(ctx, opts.envelopePath, "sell envelope")) : null;

    const request = buildLiveSellRequest({
      position,
      quote: quoteWithAge,
      policy,
      approvalEvaluation,
      envelope,
      createdAt: nowIso,
      nowMs: Number.isFinite(nowMs) ? nowMs : 0,
      emergencyReview: Boolean(opts.emergency),
    });

    let wrote = "";
    if (opts.outDir) {
      const dir = resolvePath(ctx, opts.outDir);
      mkdirSync(dir, { recursive: true });
      const jsonPath = join(dir, "sell-review.json");
      const mdPath = join(dir, "sell-review.md");
      for (const p of [jsonPath, mdPath]) {
        if (!opts.force && existsSync(p)) return refuse(`${p} already exists (pass --force to overwrite).`);
      }
      writeJsonFile(jsonPath, redactValue(request));
      const md: string[] = [];
      md.push(`# SELL REVIEW — ${position.mint}${position.symbol ? ` (${position.symbol})` : ""} [${request.state.toUpperCase()}]`);
      md.push("");
      md.push(request.banner);
      md.push("");
      md.push(`- Position: ${position.positionId} (${position.kind}, entry ${position.entrySpendLamports} lamports)`);
      md.push(`- Token balance (ledger): ${position.tokenAmountRaw ?? "UNVERIFIED — refused"}`);
      md.push(`- Expected SOL out: ${request.expectedSolOutLamports ?? "unknown"} lamports`);
      md.push(`- Estimated PnL: ${request.estimatedPnlLamports ?? "unknown"} lamports (${request.estimatedPnlPct ?? "?"}%) — an ESTIMATE, not a result`);
      md.push(`- Approval: ${request.approval.supplied ? (request.approval.active ? "active" : `inactive (${request.approval.reasons.join(", ")})`) : "missing"}`);
      if (request.blockingReasons.length > 0) {
        md.push("");
        md.push("Blocked because:");
        for (const b of request.blockingReasons) md.push(`- ${b}`);
      }
      for (const w of request.warnings) md.push(`- note: ${w}`);
      writeFileSync(mdPath, redactString(md.join("\n")) + "\n");
      wrote = `\nwrote ${jsonPath}\nwrote ${mdPath}`;
    }

    const exitCode = request.state === "blocked" ? 1 : 0;
    if (opts.json) return { text: JSON.stringify(redactValue(request), null, 2) + wrote, exitCode };
    const lines: string[] = [];
    lines.push(`SELL REVIEW — ${request.state.toUpperCase()} (UNSIGNED; this CLI cannot sell)`);
    lines.push("=====================================================================");
    lines.push(`position:  ${position.positionId} (${position.kind})`);
    lines.push(`expected:  ${request.expectedSolOutLamports ?? "unknown"} lamports out`);
    lines.push(`est. PnL:  ${request.estimatedPnlLamports ?? "unknown"} lamports (${request.estimatedPnlPct ?? "?"}%) — estimate only`);
    if (request.blockingReasons.length > 0) {
      lines.push("blocked because:");
      for (const b of request.blockingReasons) lines.push(`  - ${b}`);
    } else {
      lines.push("All gates green. The human signs the sell in Phantom; record the real close with live:sniper:reconcile.");
    }
    return { text: redactString(lines.join("\n")) + wrote, exitCode };
  } catch (err) {
    const msg = err instanceof LiveSellRequestError || err instanceof LivePositionError || err instanceof Error ? err.message : String(err);
    return { text: redactString(`Refusing: ${msg}`), exitCode: 1 };
  }
}

// ---------------------------------------------------------------------------
// live:sniper:reconcile-position
// ---------------------------------------------------------------------------

export interface LiveReconcilePositionOptions {
  ledgerPath?: string;
  positionId?: string;
  mint?: string;
  observedTokenAmountRaw?: string;
  observationSource?: string;
  /** Explicitly record that the balance could NOT be observed (honest unknown). */
  unknown?: boolean;
  json?: boolean;
  out?: string;
  force?: boolean;
}

export function liveSniperReconcilePositionReport(ctx: LiveDaemonContext = {}, opts: LiveReconcilePositionOptions = {}): LiveDaemonReport {
  const refuse = (msg: string): LiveDaemonReport => ({ text: redactString(`Refusing: ${msg}`), exitCode: 1 });
  if (!opts.ledgerPath) return refuse("--ledger <path> is required.");
  if (!opts.positionId && !opts.mint) return refuse("--position-id or --mint is required.");
  if (!opts.unknown && opts.observedTokenAmountRaw === undefined) {
    return refuse("supply --observed-token-amount-raw <raw> (a REAL wallet/provider observation) or --unknown (the balance could not be read). Balances are never invented.");
  }
  if (opts.unknown && opts.observedTokenAmountRaw !== undefined) {
    return refuse("--unknown and --observed-token-amount-raw are mutually exclusive.");
  }
  if (opts.observedTokenAmountRaw !== undefined && !/^[0-9]{1,30}$/.test(opts.observedTokenAmountRaw)) {
    return refuse("--observed-token-amount-raw must be a raw integer string.");
  }
  try {
    const ledger = validateLedger(readJson(ctx, opts.ledgerPath, "position ledger"));
    const position = ledger.positions.find((p) => (opts.positionId ? p.positionId === opts.positionId : p.mint === opts.mint));
    if (position === undefined) return refuse("no matching position exists in the ledger.");
    const record = reconcilePosition({
      position,
      observedTokenAmountRaw: opts.unknown ? null : (opts.observedTokenAmountRaw as string),
      observationSource: opts.observationSource ?? (opts.unknown ? null : "operator-supplied"),
      reconciledAt: isoNow(ctx),
    });
    let wrote = "";
    if (opts.out) {
      const resolved = resolvePath(ctx, opts.out);
      if (!opts.force && existsSync(resolved)) return refuse(`${resolved} already exists (pass --force to overwrite).`);
      writeJsonFile(resolved, redactValue(record));
      wrote = `\nwrote ${resolved}`;
    }
    if (opts.json) return { text: JSON.stringify(redactValue(record), null, 2) + wrote, exitCode: 0 };
    const lines: string[] = [];
    lines.push("POSITION RECONCILIATION (expected vs observed; unknown stays unknown)");
    lines.push("=====================================================================");
    lines.push(`position:  ${record.positionId} (${record.kind}, ${record.status})`);
    lines.push(`expected:  ${record.expectedTokenAmountRaw ?? "unknown"}`);
    lines.push(`observed:  ${record.observedTokenAmountRaw ?? "not observable"} (${record.observationSource})`);
    lines.push(`verdict:   ${record.verdict.toUpperCase()}`);
    for (const n of record.notes) lines.push(`note: ${n}`);
    return { text: redactString(lines.join("\n")) + wrote, exitCode: 0 };
  } catch (err) {
    const msg = err instanceof LivePositionError || err instanceof Error ? err.message : String(err);
    return { text: redactString(`Refusing: ${msg}`), exitCode: 1 };
  }
}
