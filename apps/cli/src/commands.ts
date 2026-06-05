/**
 * Command implementations. Each returns a string report. Side effects are
 * limited to: reading config/env; read-only RPC reads through an injectable
 * client (Solana commands); and local file I/O for the offline paper engine
 * (reading injected candidate/price fixtures and appending to a JSONL journal).
 *
 * No command can build, sign, simulate, or send a transaction — the CLI cannot
 * move funds by construction. The paper commands are pure simulation over
 * injected data and touch no wallet, key, or network.
 */

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  loadConfig,
  evaluateLiveGate,
  describeMode,
  capabilitiesFor,
  ConfigError,
  type Config,
  type LoadConfigOptions,
} from "@soulmaker/core";
import { redactValue, redactString } from "@soulmaker/security";
import {
  createReadOnlySolanaClient,
  endpointHostOf,
  parsePublicKey,
  buildWalletWatchReport,
  formatWalletWatchReport,
  buildTokenInspectReport,
  formatTokenInspectReport,
  InvalidPublicKeyError,
  type ReadOnlySolanaClient,
  type ReadOnlyClientConfig,
  type TokenAccountSummary,
} from "@soulmaker/solana";
import {
  buildTokenRiskReport,
  formatTokenRiskReport,
  parseList,
  type TokenRiskInput,
} from "@soulmaker/risk";
import {
  runPaperSession,
  parseJournal,
  reduceJournal,
  deriveStateFromJournalText,
  summarize,
  formatPaperReport,
  buildReportEnvelope,
  initialState,
  lastRunSummary,
  serializeEvents,
  type PaperCandidate,
  type PaperPricePoint,
  type PaperRiskCaps,
  type PaperRunSummary,
  type PaperState,
} from "@soulmaker/paper";
import {
  evaluateStrategy,
  formatStrategyReport,
  buildStrategyEnvelope,
  portfolioFromPaperState,
  planStrategyBatch,
  formatStrategyPlanReport,
  buildStrategyPlanEnvelope,
  type StrategyCandidate,
  type StrategyConfig,
  type StrategyPortfolio,
  type StrategyPlanInput,
} from "@soulmaker/strategy";

export interface CommandContext {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  configPath?: string;
  /** Factory for the read-only Solana client; injected in tests to avoid network. */
  createClient?: (config: ReadOnlyClientConfig) => ReadOnlySolanaClient;
  /** Injectable clock for deterministic report timestamps. */
  now?: () => string;
}

export interface ChainReadOptions {
  /** Permit chain reads while in PAPER mode (explicit opt-in). */
  allowPaperRead?: boolean;
}

function toLoadOptions(ctx: CommandContext): LoadConfigOptions {
  return { cwd: ctx.cwd, env: ctx.env, configPath: ctx.configPath };
}

const isoNow = (): string => new Date().toISOString();

// ---------------------------------------------------------------------------
// Phase 0–1 commands (unchanged behavior)
// ---------------------------------------------------------------------------

/** `soulmaker doctor` — environment & safety self-check. */
export function doctorReport(ctx: CommandContext = {}): string {
  const lines: string[] = [];
  lines.push("Soulmaker doctor");
  lines.push("================");
  lines.push(`node:           ${process.version}`);

  let config: Config | null = null;
  let configStatus: string;
  try {
    config = loadConfig(toLoadOptions(ctx));
    configStatus = "OK";
  } catch (err) {
    configStatus =
      err instanceof ConfigError ? `INVALID\n${err.message}` : String(err);
  }
  lines.push(`config:         ${configStatus}`);

  if (config) {
    const caps = capabilitiesFor(config.mode);
    lines.push(`mode:           ${describeMode(config.mode)}`);
    lines.push(`kill switch:    ${config.killSwitch ? "ENGAGED" : "off"}`);
    lines.push(`log redaction:  ${config.logging.redact ? "on" : "OFF (!!)"}`);
    lines.push(
      `caps:           ${config.caps.maxTradeSizeSol} SOL/trade, ` +
        `${config.caps.maxDailyLossSol} SOL/day max loss, ` +
        `${config.caps.maxOpenPositions} open max`,
    );

    const gate = evaluateLiveGate(config, ctx.env ?? process.env);
    lines.push(`can send funds: ${caps.canSend ? "mode-allowed" : "no"}`);
    lines.push(
      `live gate:      ${gate.allowed ? "OPEN (live sending possible)" : "CLOSED (safe)"}`,
    );
    if (!gate.allowed) {
      lines.push("  refused because:");
      for (const reason of gate.reasons) lines.push(`    - ${reason}`);
    }
  }

  lines.push("");
  lines.push(
    config && configStatus === "OK"
      ? "Result: healthy."
      : "Result: configuration needs attention.",
  );
  return lines.join("\n");
}

/** `soulmaker config:check` — validate config and print it (redacted). */
export function configCheckReport(ctx: CommandContext = {}): string {
  try {
    const config = loadConfig(toLoadOptions(ctx));
    const safe = redactValue(config);
    return ["Config is VALID.", "", JSON.stringify(safe, null, 2)].join("\n");
  } catch (err) {
    if (err instanceof ConfigError) {
      return `Config is INVALID.\n\n${err.message}`;
    }
    throw err;
  }
}

/** `soulmaker mode` — show current mode and what it permits. */
export function modeReport(ctx: CommandContext = {}): string {
  const config = loadConfig(toLoadOptions(ctx));
  const caps = capabilitiesFor(config.mode);
  return [
    `mode: ${describeMode(config.mode)}`,
    `  read chain:        ${yesNo(caps.canReadChain)}`,
    `  build tx:          ${yesNo(caps.canBuildTransactions)}`,
    `  simulate tx:       ${yesNo(caps.canSimulate)}`,
    `  sign & send funds: ${yesNo(caps.canSend)}`,
    `  is live:           ${yesNo(caps.isLive)}`,
  ].join("\n");
}

export interface PaperStatusOptions {
  /** Optional path to a paper journal (JSONL). */
  journalPath?: string;
  json?: boolean;
}

/**
 * `soulmaker paper:status` — real paper engine status. With no journal (or a
 * journal that does not exist yet) it prints a clean empty state; with a journal
 * it summarizes reconstructed open positions, PnL and recent events.
 */
export function paperStatusReport(
  ctx: CommandContext = {},
  opts: PaperStatusOptions = {},
): string {
  if (!opts.journalPath) return renderEmptyPaperStatus(opts.json);
  const resolved = resolvePath(ctx, opts.journalPath);
  let text: string;
  try {
    text = readFileSync(resolved, "utf8");
  } catch {
    // A missing journal is a clean empty state, not an error.
    return renderEmptyPaperStatus(opts.json);
  }
  return renderJournalReport("Paper status", text, opts.json);
}

// ---------------------------------------------------------------------------
// Phase 2 — read-only Solana commands
// ---------------------------------------------------------------------------

/** `soulmaker solana:doctor` — read-only RPC readiness check (no wallet, no sends). */
export async function solanaDoctorReport(
  ctx: CommandContext = {},
): Promise<string> {
  const lines: string[] = [];
  lines.push("Soulmaker solana:doctor");
  lines.push("=======================");

  let config: Config;
  try {
    config = loadConfig(toLoadOptions(ctx));
  } catch (err) {
    const msg = err instanceof ConfigError ? err.message : String(err);
    return redactString(`Refusing: config is invalid.\n\n${msg}`);
  }

  const caps = capabilitiesFor(config.mode);
  lines.push(`mode:            ${describeMode(config.mode)}`);
  lines.push(
    `reads chain:     ${caps.canReadChain ? "yes" : `no (mode ${config.mode})`}`,
  );
  lines.push(`rpc url set:     ${config.rpcUrl ? "yes" : "no"}`);

  if (!config.rpcUrl) {
    lines.push("");
    lines.push(
      "No rpcUrl configured. Set SOULMAKER_RPC_URL or rpcUrl in " +
        "soulmaker.config.json to enable read-only chain access.",
    );
    return redactString(lines.join("\n"));
  }

  lines.push(`rpc host:        ${endpointHostOf(config.rpcUrl)}`);

  // A health/version probe is generic RPC liveness — safe in any mode.
  const make = ctx.createClient ?? createReadOnlySolanaClient;
  try {
    const client = make({ rpcUrl: config.rpcUrl });
    const health = await client.getRpcHealth();
    if (health.ok) {
      lines.push(
        `rpc health:      OK (solana-core ${health.solanaCore ?? "?"}, slot ${health.slot ?? "?"})`,
      );
    } else {
      lines.push(`rpc health:      FAILED — ${health.error ?? "unknown"}`);
    }
  } catch (err) {
    lines.push(
      `rpc health:      ERROR — ${redactString(String((err as Error)?.message ?? err))}`,
    );
  }

  if (!caps.canReadChain) {
    lines.push("");
    lines.push(
      "Note: this mode does not read chain. wallet:watch / token:* need " +
        "WATCH_ONLY/SIMULATION/DANGEROUS_BURNER_LIVE, or --allow-paper-read.",
    );
  }
  return redactString(lines.join("\n"));
}

type ChainGate =
  | { ok: true; config: Config; client: ReadOnlySolanaClient }
  | { ok: false; message: string };

/** Shared gate for chain-read commands: capability + rpcUrl, then build a client. */
function openChainRead(ctx: CommandContext, opts: ChainReadOptions): ChainGate {
  let config: Config;
  try {
    config = loadConfig(toLoadOptions(ctx));
  } catch (err) {
    const msg = err instanceof ConfigError ? err.message : String(err);
    return { ok: false, message: `Refusing: config is invalid.\n\n${msg}` };
  }

  const caps = capabilitiesFor(config.mode);
  if (!caps.canReadChain) {
    const paperOverride = config.mode === "PAPER" && opts.allowPaperRead === true;
    if (!paperOverride) {
      const suffix =
        config.mode === "PAPER"
          ? ", or pass --allow-paper-read to read chain in PAPER mode."
          : ".";
      return {
        ok: false,
        message:
          `Refusing: mode ${config.mode} does not read chain. ` +
          `Use WATCH_ONLY, SIMULATION, or DANGEROUS_BURNER_LIVE${suffix}`,
      };
    }
  }

  const rpcUrl = config.rpcUrl;
  if (!rpcUrl) {
    return {
      ok: false,
      message:
        "Refusing: no rpcUrl configured. Set SOULMAKER_RPC_URL or rpcUrl in config.",
    };
  }

  const make = ctx.createClient ?? createReadOnlySolanaClient;
  return { ok: true, config, client: make({ rpcUrl }) };
}

function readError(err: unknown): string {
  const message = (err as Error)?.message ?? String(err);
  return `RPC read failed (read-only): ${redactString(message)}`;
}

/** `soulmaker wallet:watch <publicKey>` — read-only wallet snapshot. */
export async function walletWatchReport(
  owner: string,
  ctx: CommandContext = {},
  opts: ChainReadOptions = {},
): Promise<string> {
  const gate = openChainRead(ctx, opts);
  if (!gate.ok) return redactString(gate.message);

  try {
    const report = await buildWalletWatchReport(gate.client, owner, {
      now: ctx.now,
      capabilityNote: describeMode(gate.config.mode),
    });
    return formatWalletWatchReport(report);
  } catch (err) {
    if (err instanceof InvalidPublicKeyError) {
      return `Refusing: ${err.message}`;
    }
    return readError(err);
  }
}

/** `soulmaker token:inspect <mint>` — read-only mint inspection. */
export async function tokenInspectReport(
  mint: string,
  ctx: CommandContext = {},
  opts: ChainReadOptions = {},
): Promise<string> {
  const gate = openChainRead(ctx, opts);
  if (!gate.ok) return redactString(gate.message);

  try {
    const report = await buildTokenInspectReport(gate.client, mint, {
      now: ctx.now,
    });
    return formatTokenInspectReport(report);
  } catch (err) {
    if (err instanceof InvalidPublicKeyError) {
      return `Refusing: ${err.message}`;
    }
    return readError(err);
  }
}

/** `soulmaker token:accounts <ownerPublicKey>` — list SPL token accounts read-only. */
export async function tokenAccountsReport(
  owner: string,
  ctx: CommandContext = {},
  opts: ChainReadOptions = {},
): Promise<string> {
  const gate = openChainRead(ctx, opts);
  if (!gate.ok) return redactString(gate.message);

  try {
    parsePublicKey(owner); // validate; throws InvalidPublicKeyError
  } catch (err) {
    if (err instanceof InvalidPublicKeyError) return `Refusing: ${err.message}`;
    throw err;
  }

  try {
    const accounts = await gate.client.getTokenAccounts(owner);
    return formatTokenAccounts(
      owner,
      accounts,
      gate.client.endpointHost,
      (ctx.now ?? isoNow)(),
    );
  } catch (err) {
    return readError(err);
  }
}

function formatTokenAccounts(
  owner: string,
  accounts: TokenAccountSummary[],
  endpointHost: string,
  timestamp: string,
): string {
  const lines: string[] = [];
  lines.push("SPL token accounts (READ-ONLY)");
  lines.push("==============================");
  lines.push(`owner:           ${owner}`);
  lines.push(`token accounts:  ${accounts.length}`);
  for (const acct of accounts) {
    lines.push(
      `  - ${acct.mint}  ${acct.uiAmount}  ` +
        `(acct ${acct.tokenAccount}, ${acct.programLabel})`,
    );
  }
  lines.push(`rpc host:        ${endpointHost}`);
  lines.push(`time:            ${timestamp}`);
  lines.push("");
  lines.push("READ-ONLY: no transaction was built, signed, or sent.");
  return redactString(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Phase 3 — read-only advisory risk engine
// ---------------------------------------------------------------------------

export interface RiskCommandOptions extends ChainReadOptions {
  /** Path to a newline-separated allowlist file (relative to cwd or absolute). */
  allowlistPath?: string;
  /** Path to a newline-separated denylist file. */
  denylistPath?: string;
  /** Path to a newline-separated previously-traded mints file. */
  previouslyTradedPath?: string;
  /** Emit the report as stable JSON instead of the human-readable block. */
  json?: boolean;
}

/** Read + parse one operator list file. Throws a clear (non-secret) error. */
function readListFile(
  ctx: CommandContext,
  path: string | undefined,
  label: string,
): string[] | undefined {
  if (!path) return undefined;
  const base = ctx.cwd ?? process.cwd();
  const resolved = isAbsolute(path) ? path : join(base, path);
  let content: string;
  try {
    content = readFileSync(resolved, "utf8");
  } catch {
    throw new Error(`cannot read ${label} list file at ${resolved}`);
  }
  return parseList(content).entries;
}

/**
 * `soulmaker token:risk <mint>` — read-only, advisory token risk report.
 *
 * Read-only by construction: it inspects the mint via `@soulmaker/solana`, runs
 * the pure `@soulmaker/risk` engine, and prints an advisory report. It builds,
 * signs, simulates, and sends NOTHING. This is NOT a buy recommendation.
 */
export async function tokenRiskReport(
  mint: string,
  ctx: CommandContext = {},
  opts: RiskCommandOptions = {},
): Promise<string> {
  const gate = openChainRead(ctx, opts);
  if (!gate.ok) return redactString(gate.message);

  // Validate the mint up front so an invalid key fails clearly.
  try {
    parsePublicKey(mint);
  } catch (err) {
    if (err instanceof InvalidPublicKeyError) return `Refusing: ${err.message}`;
    throw err;
  }

  // Load operator lists from files (if provided). Failures are clean refusals.
  let allowlist: string[] | undefined;
  let denylist: string[] | undefined;
  let previouslyTradedMints: string[] | undefined;
  try {
    allowlist = readListFile(ctx, opts.allowlistPath, "allowlist");
    denylist = readListFile(ctx, opts.denylistPath, "denylist");
    previouslyTradedMints = readListFile(
      ctx,
      opts.previouslyTradedPath,
      "previously-traded",
    );
  } catch (err) {
    return redactString(`Refusing: ${(err as Error).message}`);
  }

  try {
    const inspection = await buildTokenInspectReport(gate.client, mint, {
      now: ctx.now,
    });
    const input: TokenRiskInput = {
      mint: inspection.mint,
      decimals: inspection.decimals,
      supplyRaw: inspection.supplyRaw,
      uiSupply: inspection.uiSupply,
      mintAuthorityPresent: inspection.mintAuthorityPresent,
      freezeAuthorityPresent: inspection.freezeAuthorityPresent,
      isInitialized: inspection.isInitialized,
      programLabel: inspection.programLabel,
      allowlist,
      denylist,
      previouslyTradedMints,
    };
    const report = buildTokenRiskReport(input, { now: ctx.now });
    if (opts.json) {
      // redactValue is a backstop; the report carries only public data.
      return JSON.stringify(redactValue(report), null, 2);
    }
    return formatTokenRiskReport(report);
  } catch (err) {
    if (err instanceof InvalidPublicKeyError) return `Refusing: ${err.message}`;
    return readError(err);
  }
}

// ---------------------------------------------------------------------------
// Phase 4 — offline, simulated-only paper trading engine
// ---------------------------------------------------------------------------

export interface PaperRunCommandOptions {
  candidatesPath?: string;
  pricesPath?: string;
  /** Optional JSONL journal to APPEND this run's events to (append-only). */
  journalPath?: string;
  maxTradeSizeUsd?: number;
  maxDailyLossUsd?: number;
  maxOpenPositions?: number;
  maxPositionSizeUsd?: number;
  takeProfitPct?: number;
  stopLossPct?: number;
  killSwitch?: boolean;
  /** Allow CAUTION risk reports into paper evaluation (default false). */
  allowCaution?: boolean;
  json?: boolean;
}

const DEFAULT_PAPER_CAPS = {
  maxTradeSizeUsd: 100,
  maxDailyLossUsd: 500,
  maxOpenPositions: 3,
} as const;

function resolvePath(ctx: CommandContext, path: string): string {
  const base = ctx.cwd ?? process.cwd();
  return isAbsolute(path) ? path : join(base, path);
}

function readJsonArray(
  ctx: CommandContext,
  path: string,
  label: string,
): unknown[] {
  const resolved = resolvePath(ctx, path);
  let text: string;
  try {
    text = readFileSync(resolved, "utf8");
  } catch {
    throw new Error(`cannot read ${label} file at ${resolved}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label} file is not valid JSON at ${resolved}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} file must be a JSON array`);
  }
  return parsed;
}

function requireNonNeg(value: number, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid ${name}: must be a non-negative number`);
  }
  return value;
}

function requireNonNegInt(value: number, name: string): number {
  const n = requireNonNeg(value, name);
  if (!Number.isInteger(n)) {
    throw new Error(`invalid ${name}: must be a non-negative integer`);
  }
  return n;
}

function optionalNonNeg(value: number | undefined, name: string): number | undefined {
  return value === undefined ? undefined : requireNonNeg(value, name);
}

/** Assemble simulated caps from CLI options; throws a clear error on bad input. */
function buildPaperCaps(
  ctx: CommandContext,
  opts: PaperRunCommandOptions,
): PaperRiskCaps {
  const maxTradeSizeUsd = requireNonNeg(
    opts.maxTradeSizeUsd ?? DEFAULT_PAPER_CAPS.maxTradeSizeUsd,
    "max-trade-size-usd",
  );
  const maxDailyLossUsd = requireNonNeg(
    opts.maxDailyLossUsd ?? DEFAULT_PAPER_CAPS.maxDailyLossUsd,
    "max-daily-loss-usd",
  );
  const maxOpenPositions = requireNonNegInt(
    opts.maxOpenPositions ?? DEFAULT_PAPER_CAPS.maxOpenPositions,
    "max-open-positions",
  );
  const maxPositionSizeUsd = optionalNonNeg(
    opts.maxPositionSizeUsd,
    "max-position-size-usd",
  );

  // Global safety: OR the CLI --kill-switch flag with the core config's kill
  // switch (best-effort load; paper runs do not otherwise require a config).
  let configKill = false;
  try {
    configKill = loadConfig(toLoadOptions(ctx)).killSwitch;
  } catch {
    configKill = false;
  }

  return {
    maxTradeSizeUsd,
    maxDailyLossUsd,
    maxOpenPositions,
    killSwitch: Boolean(opts.killSwitch) || configKill,
    maxPositionSizeUsd,
    allowCautionRiskReports: Boolean(opts.allowCaution),
  };
}

/**
 * `soulmaker paper:run` — run a deterministic, simulated-only paper evaluation
 * from local injected candidate + price fixtures. No chain access, no wallet, no
 * transaction is built, signed, simulated, or sent.
 */
export function paperRunReport(
  ctx: CommandContext = {},
  opts: PaperRunCommandOptions = {},
): string {
  if (!opts.candidatesPath) return "Refusing: --candidates <path> is required.";
  if (!opts.pricesPath) return "Refusing: --prices <path> is required.";

  let candidates: PaperCandidate[];
  let prices: PaperPricePoint[];
  let caps: PaperRiskCaps;
  let takeProfitPct: number | undefined;
  let stopLossPct: number | undefined;
  try {
    candidates = readJsonArray(ctx, opts.candidatesPath, "candidates") as PaperCandidate[];
    prices = readJsonArray(ctx, opts.pricesPath, "prices") as PaperPricePoint[];
    caps = buildPaperCaps(ctx, opts);
    takeProfitPct = optionalNonNeg(opts.takeProfitPct, "take-profit-pct");
    stopLossPct = optionalNonNeg(opts.stopLossPct, "stop-loss-pct");
  } catch (err) {
    return redactString(`Refusing: ${(err as Error).message}`);
  }

  const result = runPaperSession({
    caps,
    candidates,
    prices,
    takeProfitPct,
    stopLossPct,
    now: ctx.now ?? isoNow,
  });

  if (opts.journalPath) {
    const resolved = resolvePath(ctx, opts.journalPath);
    try {
      // Append-only: never truncates an existing journal.
      appendFileSync(resolved, serializeEvents(result.events));
    } catch {
      return redactString(`Refusing: cannot write journal file at ${resolved}`);
    }
  }

  if (opts.json) {
    return JSON.stringify(
      redactValue(buildReportEnvelope(result.state, result.summary, result.events)),
      null,
      2,
    );
  }
  return formatPaperReport(result.state, result.summary, {
    title: "Paper run",
    recentEvents: result.events,
  });
}

/**
 * `soulmaker paper:journal` — read and summarize an append-only paper journal.
 * Malformed lines are skipped and counted, never fatal.
 */
export function paperJournalReport(
  ctx: CommandContext = {},
  opts: { journalPath?: string; json?: boolean } = {},
): string {
  if (!opts.journalPath) return "Refusing: --journal <path> is required.";
  const resolved = resolvePath(ctx, opts.journalPath);
  let text: string;
  try {
    text = readFileSync(resolved, "utf8");
  } catch {
    return redactString(`Refusing: cannot read journal file at ${resolved}`);
  }
  return renderJournalReport("Paper journal", text, opts.json);
}

/** Empty-state paper status (no journal). */
function renderEmptyPaperStatus(json?: boolean): string {
  const state = initialState();
  const summary = summarize(state, []);
  if (json) {
    return JSON.stringify(
      redactValue(buildReportEnvelope(state, summary, [])),
      null,
      2,
    );
  }
  return (
    formatPaperReport(state, summary, { title: "Paper status" }) +
    "\n\nNo journal provided — empty paper state."
  );
}

/** Shared journal rendering for paper:journal and paper:status. */
function renderJournalReport(
  title: string,
  text: string,
  json?: boolean,
): string {
  const { events, errors } = parseJournal(text);
  const state = reduceJournal(events);
  const summary: PaperRunSummary = summarize(state, events);
  // Unrealized PnL cannot be recomputed from fills alone (no live prices in the
  // journal); surface the value recorded by the most recent run, if any.
  const last = lastRunSummary(events);
  if (last) {
    summary.unrealizedPnlUsd = last.unrealizedPnlUsd;
    summary.totalPnlUsd = summary.realizedPnlUsd + last.unrealizedPnlUsd;
  }

  if (json) {
    const envelope = {
      ...buildReportEnvelope(state, summary, events),
      eventCount: events.length,
      malformedLines: errors.length,
    };
    return JSON.stringify(redactValue(envelope), null, 2);
  }

  let out = formatPaperReport(state, summary, { title, recentEvents: events });
  out += `\n\nevents: ${events.length}`;
  if (errors.length) out += `\nmalformed lines skipped: ${errors.length}`;
  return out;
}

// ---------------------------------------------------------------------------
// Phase 5 — deterministic, paper-only strategy rules engine
// ---------------------------------------------------------------------------

export interface StrategyEvaluateCommandOptions {
  /** Path to a JSON StrategyCandidate object. */
  candidatePath?: string;
  /** Path to a JSON StrategyConfig object. */
  strategyConfigPath?: string;
  /** Optional path to a JSON PaperState (for position-awareness rules). */
  paperStatePath?: string;
  json?: boolean;
}

/** Read + parse one local JSON file into an unknown value. Clean errors only. */
function readJsonValue(ctx: CommandContext, path: string, label: string): unknown {
  const resolved = resolvePath(ctx, path);
  let text: string;
  try {
    text = readFileSync(resolved, "utf8");
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
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

const VALID_RISK_DECISIONS = ["REJECT", "CAUTION", "PASS_FOR_PAPER_EVALUATION"];

/** Validate a candidate JSON object (read-only; never normalizes or mutates). */
function asStrategyCandidate(value: unknown): StrategyCandidate {
  const obj = asObject(value, "candidate");
  if (typeof obj.mint !== "string" || obj.mint.length === 0) {
    throw new Error("malformed candidate: mint must be a non-empty string");
  }
  // A missing riskReport is allowed (the engine fails safe, treating it as
  // REJECT ⇒ SKIP). But a *present* report must be well-formed: a valid decision
  // literal and a finite score in [0, 100]. Anything else is a malformed
  // candidate and is refused cleanly rather than silently fed to the engine.
  const rr = obj.riskReport;
  if (rr !== undefined && rr !== null) {
    if (typeof rr !== "object" || Array.isArray(rr)) {
      throw new Error("malformed candidate: riskReport must be an object");
    }
    const report = rr as Record<string, unknown>;
    if (
      typeof report.decision !== "string" ||
      !VALID_RISK_DECISIONS.includes(report.decision)
    ) {
      throw new Error(
        "malformed candidate: riskReport.decision must be one of " +
          "REJECT, CAUTION, PASS_FOR_PAPER_EVALUATION",
      );
    }
    if (
      typeof report.score !== "number" ||
      !Number.isFinite(report.score) ||
      report.score < 0 ||
      report.score > 100
    ) {
      throw new Error(
        "malformed candidate: riskReport.score must be a finite number in [0, 100]",
      );
    }
  }
  return obj as unknown as StrategyCandidate;
}

/** Validate a strategy config JSON object: the required numeric thresholds. */
function asStrategyConfig(value: unknown): StrategyConfig {
  const obj = asObject(value, "config");
  for (const key of [
    "minScoreForPaperBuy",
    "minScoreForWatch",
    "maxRiskScore",
  ] as const) {
    const v = obj[key];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`invalid config: ${key} must be a finite number`);
    }
  }
  return obj as unknown as StrategyConfig;
}

/** Validate an injected PaperState JSON object and derive the portfolio view. */
function asPortfolio(value: unknown): StrategyPortfolio {
  return portfolioFromPaperState(asPaperState(value));
}

/** Validate an injected PaperState JSON object (read-only; never normalizes). */
function asPaperState(value: unknown): PaperState {
  const obj = asObject(value, "paper-state");
  if (obj.positions === null || typeof obj.positions !== "object") {
    throw new Error("invalid paper-state: missing positions object");
  }
  return obj as unknown as PaperState;
}

/**
 * Validate a JSON array of candidates, one entry at a time, surfacing the array
 * index of the first malformed entry. Reuses the single-candidate validator so
 * the per-entry rules stay identical to `strategy:evaluate`.
 */
function asStrategyCandidates(values: unknown[]): StrategyCandidate[] {
  return values.map((value, index) => {
    try {
      return asStrategyCandidate(value);
    } catch (err) {
      const detail = (err as Error).message.replace(/^malformed candidate: /, "");
      throw new Error(`malformed candidate at index ${index}: ${detail}`);
    }
  });
}

/**
 * `soulmaker strategy:evaluate` — evaluate one local candidate against a local
 * strategy config (and optional injected paper state) and print a deterministic,
 * PAPER-ONLY decision report. Reads injected local JSON only: no chain access,
 * no wallet, no RPC; it builds, signs, simulates, and sends NOTHING. The report
 * only feeds paper simulation and is NOT financial advice or a buy recommendation.
 */
export function strategyEvaluateReport(
  ctx: CommandContext = {},
  opts: StrategyEvaluateCommandOptions = {},
): string {
  if (!opts.candidatePath) return "Refusing: --candidate <path> is required.";
  if (!opts.strategyConfigPath) return "Refusing: --config <path> is required.";

  let candidate: StrategyCandidate;
  let config: StrategyConfig;
  let portfolio: StrategyPortfolio | undefined;
  try {
    candidate = asStrategyCandidate(readJsonValue(ctx, opts.candidatePath, "candidate"));
    config = asStrategyConfig(readJsonValue(ctx, opts.strategyConfigPath, "config"));
    portfolio = opts.paperStatePath
      ? asPortfolio(readJsonValue(ctx, opts.paperStatePath, "paper-state"))
      : undefined;
  } catch (err) {
    return redactString(`Refusing: ${(err as Error).message}`);
  }

  const report = evaluateStrategy({
    candidate,
    config,
    portfolio,
    now: ctx.now ?? isoNow,
  });

  if (opts.json) {
    // redactValue is a backstop; the report carries only injected/public data.
    return JSON.stringify(redactValue(buildStrategyEnvelope(report)), null, 2);
  }
  return formatStrategyReport(report);
}

// ---------------------------------------------------------------------------
// Phase 6 — paper-only strategy → paper plan pipeline
// ---------------------------------------------------------------------------

export interface StrategyPlanCommandOptions {
  /** Path to a JSON array of StrategyCandidate objects. */
  candidatesPath?: string;
  /** Path to a JSON StrategyConfig object. */
  strategyConfigPath?: string;
  /** Optional path to a JSON PaperState (for position-awareness rules). */
  paperStatePath?: string;
  /**
   * Optional path to an append-only paper journal (JSONL). Read-only: the derived
   * PaperState feeds the position-awareness rules. Mutually exclusive with
   * `paperStatePath` — supply only one source of paper state.
   */
  journalPath?: string;
  /** Optional path to write ONLY the resulting PaperCandidate[] array. */
  outPath?: string;
  /** Keep SKIP items in the report (never in paperCandidates). */
  includeSkipped?: boolean;
  /** Keep WATCH items in the report (never in paperCandidates). */
  includeWatch?: boolean;
  /** Fallback simulated notional (USD) for converted candidates lacking one. */
  defaultPaperSizeUsd?: number;
  json?: boolean;
}

/**
 * Strictly derive a {@link PaperState} from a local append-only paper journal
 * (JSONL) for position-aware planning. READ-ONLY: it reads the file and never
 * writes, truncates, or mutates the journal or its entries. Any malformed line or
 * invalid fill is refused (cleanly) rather than silently dropped — deriving an
 * authoritative portfolio snapshot must not lose events. An empty/blank journal
 * yields the empty initial state. Throws a clear, non-secret error on failure.
 */
function paperStateFromJournalFile(ctx: CommandContext, path: string): PaperState {
  const resolved = resolvePath(ctx, path);
  let text: string;
  try {
    text = readFileSync(resolved, "utf8");
  } catch {
    throw new Error(`cannot read journal file at ${resolved}`);
  }
  const { state, parseErrors, fillErrors } = deriveStateFromJournalText(text);
  if (parseErrors.length > 0) {
    const first = parseErrors[0];
    throw new Error(
      `journal is malformed: ${parseErrors.length} bad line(s); ` +
        `first at line ${first?.line}: ${first?.reason}`,
    );
  }
  if (fillErrors.length > 0) {
    const first = fillErrors[0];
    throw new Error(
      `journal has ${fillErrors.length} invalid fill event(s); ` +
        `first at event index ${first?.index}: ${first?.reason}`,
    );
  }
  return state;
}

/**
 * `soulmaker strategy:plan` — evaluate a BATCH of injected candidates and emit a
 * deterministic, PAPER-ONLY plan plus the `PaperCandidate[]` an operator may
 * LATER hand to `paper:run`. It reads injected local JSON only: no chain access,
 * no wallet, no RPC. It does NOT run paper trades, create fills, or touch the
 * journal — it produces a plan/candidate set only. It builds, signs, simulates,
 * and sends NOTHING, and is NOT financial advice or a buy recommendation.
 */
export function strategyPlanReport(
  ctx: CommandContext = {},
  opts: StrategyPlanCommandOptions = {},
): string {
  if (!opts.candidatesPath) return "Refusing: --candidates <path> is required.";
  if (!opts.strategyConfigPath) return "Refusing: --config <path> is required.";
  // Exactly one source of paper state: a prebuilt snapshot OR a derived journal.
  if (opts.journalPath && opts.paperStatePath) {
    return (
      "Refusing: supply only one source of paper state — " +
      "pass either --journal or --paper-state, not both."
    );
  }

  let input: StrategyPlanInput;
  try {
    const candidates = asStrategyCandidates(
      readJsonArray(ctx, opts.candidatesPath, "candidates"),
    );
    const config = asStrategyConfig(readJsonValue(ctx, opts.strategyConfigPath, "config"));
    // Paper state comes from a derived (read-only) journal, a prebuilt snapshot,
    // or neither. The journal is never written or mutated by planning.
    let paperState: PaperState | undefined;
    if (opts.journalPath) {
      paperState = paperStateFromJournalFile(ctx, opts.journalPath);
    } else if (opts.paperStatePath) {
      paperState = asPaperState(readJsonValue(ctx, opts.paperStatePath, "paper-state"));
    }
    const defaultPaperSizeUsd = optionalNonNeg(opts.defaultPaperSizeUsd, "size");
    input = {
      candidates,
      config,
      paperState,
      defaultPaperSizeUsd,
      includeSkipped: Boolean(opts.includeSkipped),
      includeWatch: Boolean(opts.includeWatch),
      now: ctx.now ?? isoNow,
    };
  } catch (err) {
    return redactString(`Refusing: ${(err as Error).message}`);
  }

  // Pure planning only — this NEVER runs a paper session, fills, or a journal.
  const result = planStrategyBatch(input);

  // Optional: write ONLY the PaperCandidate[] (redacted) for a later paper:run.
  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    try {
      writeFileSync(
        resolved,
        JSON.stringify(redactValue(result.paperCandidates), null, 2) + "\n",
      );
    } catch {
      return redactString(`Refusing: cannot write output file at ${resolved}`);
    }
  }

  if (opts.json) {
    // The plan references each converted candidate from BOTH `items` and
    // `paperCandidates`; redactValue treats any shared (even non-cyclic)
    // reference as circular, so flatten to a plain JSON tree first to redact it
    // fully. redactValue remains a backstop — the result carries only
    // injected/public data. (No true cycles exist, so stringify cannot throw.)
    const envelope: unknown = JSON.parse(JSON.stringify(buildStrategyPlanEnvelope(result)));
    return JSON.stringify(redactValue(envelope), null, 2);
  }
  return formatStrategyPlanReport(result, { title: "Strategy plan" });
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}
