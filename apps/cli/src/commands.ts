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

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join } from "node:path";
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
import {
  runBacktest,
  formatBacktestReport,
  lintBacktestScenario,
  diffBacktestReports,
  formatBacktestReportDiff,
  buildExampleBacktestScenario,
  listBacktestScenarioTemplates,
  expandScenarioMatrix,
  generateScenarioVariants,
  explainScenarioVariantPlan,
  formatScenarioVariantPlanExplanation,
  runBacktestSuite,
  buildBacktestSuiteIndex,
  formatBacktestSuiteIndex,
  diffBacktestSuites,
  formatBacktestSuiteDiff,
  runScenarioVariantSensitivity,
  formatScenarioVariantSensitivityReport,
  diffScenarioVariantSensitivityReports,
  formatScenarioVariantSensitivityDiff,
  runScenarioVariantSensitivityMatrix,
  formatScenarioVariantSensitivityMatrixReport,
  diffScenarioVariantSensitivityMatrixReports,
  formatScenarioVariantSensitivityMatrixDiff,
  summarizeBacktestSuiteCoverage,
  formatBacktestSuiteCoverage,
  classifyBacktestArtifact,
  buildBacktestResearchManifest,
  formatBacktestResearchManifest,
  verifyBacktestResearchManifest,
  formatBacktestResearchVerification,
  diffBacktestResearchManifests,
  formatBacktestResearchManifestDiff,
  buildBacktestResearchBundle,
  formatBacktestResearchBundle,
  buildBacktestResearchStatus,
  formatBacktestResearchStatus,
  buildBacktestResearchCampaignIndex,
  formatBacktestResearchCampaignIndex,
  diffBacktestResearchBundles,
  formatBacktestResearchBundleDiff,
  diffBacktestResearchCampaignIndexes,
  formatBacktestResearchCampaignIndexDiff,
  digestContent,
  BACKTEST_RESEARCH_MANIFEST_SCHEMA_VERSION,
  BACKTEST_RESEARCH_VERIFY_SCHEMA_VERSION,
  BACKTEST_RESEARCH_MANIFEST_DIFF_SCHEMA_VERSION,
  BACKTEST_RESEARCH_BUNDLE_SCHEMA_VERSION,
  BACKTEST_RESEARCH_STATUS_SCHEMA_VERSION,
  BACKTEST_RESEARCH_CAMPAIGN_INDEX_SCHEMA_VERSION,
  type BacktestReport,
  type BacktestReportDiff,
  type BacktestScenario,
  type BacktestScenarioTemplate,
  type BacktestLintIssue,
  type BacktestScenarioLintResult,
  type BacktestSuiteScenario,
  type BacktestSuiteResult,
  type BacktestSuiteIndex,
  type BacktestSuiteDiff,
  type ScenarioVariantSensitivityRun,
  type ScenarioVariantPlanExplanation,
  type ScenarioVariantSensitivityDiff,
  type ScenarioVariantSensitivityMatrixRun,
  type ScenarioVariantSensitivityMatrixDiff,
  type BacktestSuiteCoverageReport,
  type BacktestArtifactDescriptor,
  type BacktestArtifactKind,
  type BacktestResearchManifest,
  type BacktestResearchVerification,
  type BacktestResearchManifestDiff,
  type BacktestResearchBundle,
  type BacktestResearchStatus,
  type BacktestResearchCampaignIndex,
  type BacktestResearchCampaignRunInput,
  type BacktestResearchBundleDiff,
  type BacktestResearchCampaignIndexDiff,
} from "@soulmaker/backtest";

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

/**
 * Remove a SINGLE leading UTF-8 BOM (U+FEFF) from the start of decoded text, if
 * present. Node's `readFileSync(path, "utf8")` does NOT strip the BOM, so a file
 * saved by a Windows editor or `Set-Content -Encoding utf8` begins with U+FEFF,
 * which `JSON.parse` rejects ("Unexpected token") and which a strict JSONL parser
 * would treat as part of the first line.
 *
 * This only ever touches the very first character, so it can never alter a BOM
 * that appears mid-content. It does not trim whitespace, does not normalize, and
 * does not otherwise relax parsing — malformed JSON/JSONL still fails exactly as
 * before. Pure and deterministic.
 *
 * Applied once at every file-read boundary below (the single place a BOM can
 * enter), so no downstream parser has to remember to strip it — a decoding fix
 * only; it reads no wallet, key, or network and moves no funds.
 */
export function stripJsonBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

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
    text = stripJsonBom(readFileSync(resolved, "utf8"));
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
    content = stripJsonBom(readFileSync(resolved, "utf8"));
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
    text = stripJsonBom(readFileSync(resolved, "utf8"));
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
 * Read an existing journal file's text, or `null` when the file does not exist
 * yet (a clean "start from empty state" signal that the caller then creates on
 * append). Any OTHER read failure (permissions, a directory, …) throws so the
 * caller refuses the run rather than silently starting from an empty state and
 * appending to — or over an — unreadable journal.
 */
function readJournalTextIfExists(resolved: string): string | null {
  try {
    // Tolerate a single leading BOM (Windows editors); never touch mid-file BOMs.
    return stripJsonBom(readFileSync(resolved, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw new Error(`cannot read journal file at ${resolved}`);
  }
}

/**
 * Strictly derive a starting {@link PaperState} from an existing journal's text
 * for a stateful `paper:run --journal` continuation. When the journal is used as
 * the authoritative portfolio for a NEW run, a malformed line or an invalid fill
 * must refuse the run (never silently drop events) — otherwise the appended fills
 * would build on a corrupted/partial state. Returns the derived state, or a
 * human, non-secret refusal reason. An empty/blank journal yields the empty state.
 */
function startingStateFromJournalText(
  text: string,
): { ok: true; state: PaperState } | { ok: false; reason: string } {
  const { state, parseErrors, fillErrors } = deriveStateFromJournalText(text);
  if (parseErrors.length > 0) {
    const first = parseErrors[0];
    return {
      ok: false,
      reason:
        `existing journal is malformed: ${parseErrors.length} bad line(s); ` +
        `first at line ${first?.line}: ${first?.reason}. No events were appended.`,
    };
  }
  if (fillErrors.length > 0) {
    const first = fillErrors[0];
    return {
      ok: false,
      reason:
        `existing journal has ${fillErrors.length} invalid fill event(s); ` +
        `first at event index ${first?.index}: ${first?.reason}. No events were appended.`,
    };
  }
  return { ok: true, state };
}

/**
 * `soulmaker paper:run` — run a deterministic, simulated-only paper evaluation
 * from local injected candidate + price fixtures. No chain access, no wallet, no
 * transaction is built, signed, simulated, or sent.
 *
 * With `--journal`, the run is *stateful and continuous*: if the journal file
 * already exists it is read FIRST and the simulated portfolio is strictly derived
 * from it (via `deriveStateFromJournalText`) as the run's starting state — so a
 * sell candidate produced from that journal finds its open position and the caps
 * account for positions already held. A malformed line or invalid fill in the
 * existing journal refuses the run and appends nothing. A missing journal starts
 * from the empty state and is created on append. The journal is only ever
 * appended to — existing events are never truncated or rewritten.
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

  // When continuing a journal, strictly derive the starting state BEFORE running.
  // Refuse (and append nothing) on a missing-but-unreadable or corrupt journal.
  let startingState: PaperState | undefined;
  let journalResolved: string | undefined;
  if (opts.journalPath) {
    journalResolved = resolvePath(ctx, opts.journalPath);
    let existing: string | null;
    try {
      existing = readJournalTextIfExists(journalResolved);
    } catch (err) {
      return redactString(`Refusing: ${(err as Error).message}`);
    }
    if (existing !== null) {
      const derived = startingStateFromJournalText(existing);
      if (!derived.ok) return redactString(`Refusing: ${derived.reason}`);
      startingState = derived.state;
    }
  }

  const result = runPaperSession({
    caps,
    candidates,
    prices,
    takeProfitPct,
    stopLossPct,
    now: ctx.now ?? isoNow,
    ...(startingState !== undefined ? { startingState } : {}),
  });

  if (journalResolved) {
    try {
      // Append-only: never truncates or rewrites existing journal events.
      appendFileSync(journalResolved, serializeEvents(result.events));
    } catch {
      return redactString(`Refusing: cannot write journal file at ${journalResolved}`);
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
    text = stripJsonBom(readFileSync(resolved, "utf8"));
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
    text = stripJsonBom(readFileSync(resolved, "utf8"));
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
    text = stripJsonBom(readFileSync(resolved, "utf8"));
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

// ---------------------------------------------------------------------------
// Sprint 8 — paper:backtest (deterministic, injected-only simulated replay)
// Sprint 9 — paper:backtest:lint + --seed-journal (validate/lint, external seed)
// ---------------------------------------------------------------------------

export interface PaperBacktestCommandOptions {
  /** Path to a local JSON backtest scenario (self-contained: config + caps + steps). */
  scenarioPath?: string;
  /** Optional path to write ONLY the report JSON (never a journal or fills). */
  outPath?: string;
  /**
   * Optional path to an external append-only JSONL journal that seeds the
   * backtest's STARTING simulated state. Mutually exclusive with a scenario that
   * already embeds `initialJournal` (both supplied ⇒ refuse). Read-only: the
   * journal file is never written and the scenario file is never modified.
   */
  seedJournalPath?: string;
  json?: boolean;
}

/** True only for a plain (non-array) JSON object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Read an external seed-journal file (BOM-tolerant, single leading BOM) and
 * compose it onto a COPY of the scenario as `initialJournal`. Refuses (cleanly)
 * when the scenario already embeds `initialJournal` (no hidden override) or when
 * the seed file cannot be read. The scenario file on disk is never modified; the
 * seed journal is only ever read. Returns the composed scenario or a refusal.
 */
function composeSeedJournal(
  ctx: CommandContext,
  scenario: unknown,
  seedJournalPath: string,
): { ok: true; scenario: unknown } | { ok: false; reason: string } {
  if (!isPlainObject(scenario)) {
    // Let the engine produce the canonical "scenario must be a JSON object" refusal.
    return { ok: true, scenario };
  }
  if (scenario.initialJournal !== undefined) {
    return {
      ok: false,
      reason:
        "supply only one seed source — the scenario already embeds initialJournal; " +
        "do not also pass --seed-journal.",
    };
  }
  const resolved = resolvePath(ctx, seedJournalPath);
  let text: string;
  try {
    // Tolerate a single leading BOM (Windows editors); never touch mid-file BOMs.
    text = stripJsonBom(readFileSync(resolved, "utf8"));
  } catch {
    return { ok: false, reason: `cannot read seed journal file at ${resolved}` };
  }
  // Compose onto a COPY — the original scenario object is never mutated.
  return { ok: true, scenario: { ...scenario, initialJournal: text } };
}

/**
 * `soulmaker paper:backtest` — replay an injected, local JSON scenario through the
 * real `planStrategyBatch` → `runPaperSession` (journal-continuing) code paths and
 * print a deterministic, PAPER-ONLY simulated report. It reads ONE local JSON file
 * only: no chain access, no wallet, no RPC, no network. It builds, signs,
 * simulates, and sends NOTHING. The scenario embeds its own strategy config + caps,
 * so it is a single reproducible artifact. The report uses injected historical data
 * only — it is NOT a live result, NOT a profitability claim, and NOT financial
 * advice. The command never writes a journal or any fills; `--out` writes only the
 * report JSON. It lives beside the other `paper:*` commands because the artifact is
 * a paper-simulation report (the strategy layer is an internal driver).
 *
 * With `--seed-journal <path>`, an EXTERNAL append-only JSONL journal seeds the
 * starting simulated state instead of embedding it in the scenario. It is
 * mutually exclusive with a scenario that already embeds `initialJournal` (both
 * supplied ⇒ refuse, so there is no hidden override). The seed journal is read
 * strictly (the engine refuses a malformed one) and never written; the scenario
 * file is never modified.
 */
export function paperBacktestReport(
  ctx: CommandContext = {},
  opts: PaperBacktestCommandOptions = {},
): string {
  if (!opts.scenarioPath) return "Refusing: --scenario <path> is required.";

  let scenario: unknown;
  try {
    scenario = readJsonValue(ctx, opts.scenarioPath, "scenario");
  } catch (err) {
    return redactString(`Refusing: ${(err as Error).message}`);
  }

  // Optional external seed journal, composed onto a scenario copy (never mutates
  // the scenario file; refuses if the scenario already embeds initialJournal).
  if (opts.seedJournalPath) {
    const composed = composeSeedJournal(ctx, scenario, opts.seedJournalPath);
    if (!composed.ok) return redactString(`Refusing: ${composed.reason}`);
    scenario = composed.scenario;
  }

  let report: BacktestReport;
  try {
    // Pure replay; validates the scenario strictly and refuses malformed input.
    report = runBacktest(scenario);
  } catch (err) {
    return redactString(`Refusing: ${(err as Error).message}`);
  }

  // Optional: write ONLY the redacted report JSON (never a journal/fills).
  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(report), null, 2) + "\n");
    } catch {
      return redactString(`Refusing: cannot write output file at ${resolved}`);
    }
  }

  if (opts.json) {
    return JSON.stringify(redactValue(report), null, 2);
  }
  return formatBacktestReport(report);
}

export interface PaperBacktestLintCommandOptions {
  /** Path to a local JSON backtest scenario to validate/lint (never run). */
  scenarioPath?: string;
  json?: boolean;
}

function lintIssueLine(issue: BacktestLintIssue): string {
  return issue.path
    ? `- [${issue.code}] ${issue.message} (at ${issue.path})`
    : `- [${issue.code}] ${issue.message}`;
}

/** Render a redacted, human-readable scenario-lint report (deterministic). */
function formatScenarioLintReport(result: BacktestScenarioLintResult): string {
  const { summary } = result;
  const status = result.valid
    ? result.warnings.length > 0
      ? "RUNNABLE (with warnings)"
      : "VALID"
    : "INVALID";

  const lines: string[] = [];
  // First line drives the CLI exit code: an INVALID scenario refuses (exit 1).
  if (result.valid) {
    const header = `Scenario lint — ${summary.name ?? "(unnamed)"} (${status})`;
    lines.push(header);
    lines.push("=".repeat(header.length));
  } else {
    lines.push(`Refusing: scenario is not runnable — ${result.errors.length} error(s).`);
    lines.push("=".repeat(40));
  }

  lines.push(`scenario:    ${summary.name ?? "(unnamed)"}`);
  lines.push(`steps:       ${summary.stepCount}`);
  lines.push(`candidates:  ${summary.candidateCount}`);
  lines.push(`prices:      ${summary.priceCount}`);
  lines.push(`journal:     ${summary.hasInitialJournal ? "present" : "absent"}`);
  lines.push(`errors:      ${summary.errorCount}`);
  lines.push(`warnings:    ${summary.warningCount}`);

  lines.push("");
  lines.push(`Errors (${result.errors.length}):`);
  if (result.errors.length === 0) lines.push("- (none)");
  else for (const e of result.errors) lines.push(lintIssueLine(e));

  lines.push("");
  lines.push(`Warnings (${result.warnings.length}):`);
  if (result.warnings.length === 0) lines.push("- (none)");
  else for (const w of result.warnings) lines.push(lintIssueLine(w));

  lines.push("");
  if (!result.valid) {
    lines.push("Result: scenario has errors and cannot be run until they are fixed.");
  } else if (result.warnings.length > 0) {
    lines.push(
      "Result: scenario is runnable, but the warnings above flag suspicious design — " +
        "review them before trusting the backtest.",
    );
  } else {
    lines.push("Result: scenario is valid and has no warnings.");
  }

  return redactString(lines.join("\n"));
}

/**
 * `soulmaker paper:backtest:lint` — validate/lint a local JSON backtest scenario
 * WITHOUT running it. Reads ONE local JSON file only: no chain access, no wallet,
 * no RPC, no network. It writes no journal and no report. Errors mean the scenario
 * cannot run (the command refuses, exit 1, in human mode); warnings mean the
 * scenario is runnable but suspicious. `--json` emits the stable, redacted
 * {@link BacktestScenarioLintResult} (its `valid` field carries the status).
 */
export function paperBacktestLintReport(
  ctx: CommandContext = {},
  opts: PaperBacktestLintCommandOptions = {},
): string {
  if (!opts.scenarioPath) return "Refusing: --scenario <path> is required.";

  let scenario: unknown;
  try {
    scenario = readJsonValue(ctx, opts.scenarioPath, "scenario");
  } catch (err) {
    return redactString(`Refusing: ${(err as Error).message}`);
  }

  const result = lintBacktestScenario(scenario);

  if (opts.json) {
    // redactValue is a backstop; lint messages carry only structural identifiers.
    return JSON.stringify(redactValue(result), null, 2);
  }
  return formatScenarioLintReport(result);
}

export interface PaperBacktestDiffCommandOptions {
  /** Path to the BASE backtest report JSON (the reference). */
  basePath?: string;
  /** Path to the NEXT backtest report JSON (compared against base). */
  nextPath?: string;
  json?: boolean;
  /** Exit non-zero when the diff reports a (bookkeeping) regression. */
  failOnRegression?: boolean;
}

/**
 * A CLI report plus the exit code the caller should set. Most commands signal a
 * refusal through their first output line; `paper:backtest:diff` additionally
 * needs a clean (parseable) success body with a non-zero exit under
 * `--fail-on-regression`, so it returns the exit code explicitly.
 */
export interface CliReport {
  text: string;
  exitCode: number;
}

/**
 * `soulmaker paper:backtest:diff` — deterministically diff TWO existing backtest
 * report JSON files. Reads ONLY the two named files (BOM-tolerant, malformed JSON
 * refused); it runs no backtest, reads no scenario, writes nothing, and never
 * touches the network/RPC/wallet/filesystem beyond those two reads. `--json` emits
 * the stable, redacted {@link BacktestReportDiff}; `--fail-on-regression` sets a
 * non-zero exit only when `diff.hasRegression` is true. A delta is simulated
 * bookkeeping — never profit, loss, a prediction, or advice.
 */
export function paperBacktestDiffReport(
  ctx: CommandContext = {},
  opts: PaperBacktestDiffCommandOptions = {},
): CliReport {
  if (!opts.basePath) return { text: "Refusing: --base <path> is required.", exitCode: 1 };
  if (!opts.nextPath) return { text: "Refusing: --next <path> is required.", exitCode: 1 };

  let baseValue: unknown;
  try {
    baseValue = readJsonValue(ctx, opts.basePath, "base report");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let nextValue: unknown;
  try {
    nextValue = readJsonValue(ctx, opts.nextPath, "next report");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let diff: BacktestReportDiff;
  try {
    // Validates both reports strictly; a non-report or schema-missing file refuses.
    diff = diffBacktestReports(baseValue, nextValue);
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  const exitCode = opts.failOnRegression && diff.hasRegression ? 1 : 0;

  if (opts.json) {
    // redactValue is a backstop; the diff carries only injected scenario identifiers.
    return { text: JSON.stringify(redactValue(diff), null, 2), exitCode };
  }
  return {
    text: formatBacktestReportDiff(diff, { baseLabel: opts.basePath, nextLabel: opts.nextPath }),
    exitCode,
  };
}

export interface PaperBacktestScenarioNewCommandOptions {
  /** Built-in template name (see `listBacktestScenarioTemplates`). */
  template?: string;
  /** Local path to write the generated scenario JSON to (required). */
  outPath?: string;
  /** Optional scenario name override (must be non-empty when provided). */
  name?: string;
  /** Overwrite an existing `--out` file (refused by default). */
  force?: boolean;
  json?: boolean;
}

/** Render the human confirmation for a freshly written scenario (deterministic, redacted). */
function formatScenarioNewReport(
  template: BacktestScenarioTemplate,
  scenario: BacktestScenario,
  resolved: string,
  lint: BacktestScenarioLintResult,
  outArg: string,
): string {
  const status =
    lint.warnings.length > 0 ? `RUNNABLE (with ${lint.warnings.length} warning(s))` : "VALID";
  const header = `Wrote backtest scenario — ${template} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];
  lines.push(`template:  ${template}`);
  lines.push(`name:      ${scenario.name}`);
  lines.push(`out:       ${resolved}`);
  lines.push(`steps:     ${scenario.steps.length}`);
  lines.push(`lints:     ${status}`);
  for (const w of lint.warnings) lines.push(`  - [${w.code}] ${w.message}`);
  lines.push("");
  lines.push("Notes:");
  lines.push("- Injected fixture — fake mints + injected prices, NOT real market data, NOT advice.");
  lines.push(`- Lint it:  soulmaker paper:backtest:lint --scenario ${outArg}`);
  lines.push(`- Run it:   soulmaker paper:backtest --scenario ${outArg}`);
  return redactString(lines.join("\n"));
}

/**
 * `soulmaker paper:backtest:scenario:new` — write a deterministic, INJECTED
 * backtest scenario SKELETON from a built-in template. It builds the scenario with
 * the pure `@soulmaker/backtest` builder (fake mints, injected prices — never real
 * data, keys, or wallets), confirms it lints valid, then writes ONLY that one JSON
 * file. It refuses to overwrite an existing file unless `--force` is given, and
 * touches no network/RPC/wallet. Lint/run the result with `paper:backtest:lint` /
 * `paper:backtest`.
 */
export function paperBacktestScenarioNewReport(
  ctx: CommandContext = {},
  opts: PaperBacktestScenarioNewCommandOptions = {},
): string {
  if (!opts.template) return "Refusing: --template <name> is required.";
  if (!opts.outPath) return "Refusing: --out <path> is required.";

  const templates = listBacktestScenarioTemplates();
  const info = templates.find((t) => t.template === opts.template);
  if (!info) {
    return redactString(
      `Refusing: unknown template "${opts.template}". ` +
        `Known templates: ${templates.map((t) => t.template).join(", ")}.`,
    );
  }

  let scenario: BacktestScenario;
  try {
    scenario = buildExampleBacktestScenario(
      info.template,
      opts.name !== undefined ? { name: opts.name } : {},
    );
  } catch (err) {
    return redactString(`Refusing: ${(err as Error).message}`);
  }

  // Defensive backstop: a built-in template must lint valid before we write it.
  const lint = lintBacktestScenario(scenario);
  if (!lint.valid) {
    return redactString(
      `Refusing: generated scenario unexpectedly failed validation (${lint.errors.length} error(s)).`,
    );
  }

  const resolved = resolvePath(ctx, opts.outPath);
  if (!opts.force && existsSync(resolved)) {
    return redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`);
  }
  try {
    writeFileSync(resolved, JSON.stringify(redactValue(scenario), null, 2) + "\n");
  } catch {
    return redactString(`Refusing: cannot write scenario file at ${resolved}`);
  }

  if (opts.json) {
    const envelope = {
      command: "paper:backtest:scenario:new",
      template: info.template,
      name: scenario.name,
      out: resolved,
      stepCount: scenario.steps.length,
      lint: { valid: lint.valid, warnings: lint.warnings.map((w) => w.code) },
    };
    return JSON.stringify(redactValue(envelope), null, 2);
  }
  return formatScenarioNewReport(info.template, scenario, resolved, lint, opts.outPath);
}

export interface PaperBacktestScenarioMatrixCommandOptions {
  /** Path to the base scenario JSON (required). */
  basePath?: string;
  /** Path to the matrix JSON ({ name?, variants: [{ suffix, patch }] }) (required). */
  matrixPath?: string;
  /** Directory to write one scenario file per variant into (required; created if absent). */
  outDir?: string;
  /** Overwrite existing variant files (refused by default). */
  force?: boolean;
  json?: boolean;
}

/** Strip a scenario file's extension(s) to a stem used to name variant files. */
function scenarioStem(path: string): string {
  const stem = basename(path).replace(/\.scenario\.json$/i, "").replace(/\.json$/i, "");
  return stem.length > 0 ? stem : "scenario";
}

/**
 * `soulmaker paper:backtest:scenario:matrix` — expand a base scenario by a small
 * declarative matrix of SAFE, config-only patches into one validated INJECTED
 * scenario file per variant. It reads ONLY the two named JSON files (BOM-tolerant,
 * malformed refused), runs the pure `expandScenarioMatrix` (no code/expressions —
 * patches may only set strategyConfig/caps/defaultPaperSizeUsd; steps/name/journal
 * are protected), then writes one file per variant into `--out-dir`. It refuses to
 * overwrite any existing variant file unless `--force` is given (it checks every
 * target BEFORE writing any), and touches no network/RPC/wallet.
 */
export function paperBacktestScenarioMatrixReport(
  ctx: CommandContext = {},
  opts: PaperBacktestScenarioMatrixCommandOptions = {},
): string {
  if (!opts.basePath) return "Refusing: --base <path> is required.";
  if (!opts.matrixPath) return "Refusing: --matrix <path> is required.";
  if (!opts.outDir) return "Refusing: --out-dir <path> is required.";

  let baseValue: unknown;
  try {
    baseValue = readJsonValue(ctx, opts.basePath, "base scenario");
  } catch (err) {
    return redactString(`Refusing: ${(err as Error).message}`);
  }

  let matrixValue: unknown;
  try {
    matrixValue = readJsonValue(ctx, opts.matrixPath, "matrix");
  } catch (err) {
    return redactString(`Refusing: ${(err as Error).message}`);
  }

  let result: ReturnType<typeof expandScenarioMatrix>;
  try {
    result = expandScenarioMatrix(baseValue, matrixValue);
  } catch (err) {
    return redactString(`Refusing: ${(err as Error).message}`);
  }

  const outDir = resolvePath(ctx, opts.outDir);
  const stem = scenarioStem(opts.basePath);
  const targets = result.variants.map((v) => ({
    suffix: v.suffix,
    scenario: v.scenario,
    path: join(outDir, `${stem}.${v.suffix}.scenario.json`),
  }));

  // Refuse if ANY target already exists (check all before writing any — no partial writes).
  if (!opts.force) {
    const existing = targets.filter((t) => existsSync(t.path));
    if (existing.length > 0) {
      return redactString(
        `Refusing: ${existing.length} output file(s) already exist (pass --force to overwrite): ` +
          existing.map((t) => t.path).join(", "),
      );
    }
  }

  try {
    mkdirSync(outDir, { recursive: true });
  } catch {
    return redactString(`Refusing: cannot create output directory at ${outDir}`);
  }
  for (const t of targets) {
    try {
      writeFileSync(t.path, JSON.stringify(redactValue(t.scenario), null, 2) + "\n");
    } catch {
      return redactString(`Refusing: cannot write scenario file at ${t.path}`);
    }
  }

  if (opts.json) {
    const envelope = {
      command: "paper:backtest:scenario:matrix",
      name: result.name,
      base: opts.basePath,
      outDir,
      variants: targets.map((t) => ({ suffix: t.suffix, name: t.scenario.name, out: t.path })),
    };
    return JSON.stringify(redactValue(envelope), null, 2);
  }

  const title = result.name ?? scenarioStem(opts.basePath);
  const header = `Wrote ${targets.length} scenario variant(s) — ${title} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];
  lines.push(`base:      ${opts.basePath}`);
  lines.push(`matrix:    ${result.name ?? "(unnamed)"}`);
  lines.push(`out-dir:   ${outDir}`);
  lines.push(`variants:  ${targets.length}`);
  for (const t of targets) {
    const lint = lintBacktestScenario(t.scenario);
    const status = lint.warnings.length > 0 ? `RUNNABLE (+${lint.warnings.length} warning(s))` : "VALID";
    lines.push(`- ${t.suffix}: ${t.path}  [${status}]`);
  }
  lines.push("");
  lines.push("Notes:");
  lines.push("- Injected fixtures — fake mints + injected prices, NOT real market data, NOT advice.");
  lines.push("- Every variant validates; lint/run with paper:backtest:lint / paper:backtest.");
  return redactString(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Sprint 12 — paper:backtest:scenario:variants (bounded perturbation variants)
// ---------------------------------------------------------------------------

export interface PaperBacktestScenarioVariantsCommandOptions {
  /** Path to the base scenario JSON (required). */
  basePath?: string;
  /** Path to the variant plan JSON ({ name?, variants: [{ suffix, perturbations }] }) (required). */
  planPath?: string;
  /** Directory to write one scenario file per variant into (required; created if absent). */
  outDir?: string;
  /** Overwrite existing variant files (refused by default). */
  force?: boolean;
  json?: boolean;
}

/**
 * `soulmaker paper:backtest:scenario:variants` — generate INJECTED scenario
 * variants from a base scenario by applying a small, declarative plan of BOUNDED
 * numeric perturbations (multiply/add, clamped to explicit bounds) to its injected
 * prices and candidate metrics. It reads ONLY the two named JSON files (BOM-tolerant,
 * malformed refused), runs the pure `generateScenarioVariants` (no code/expressions,
 * no RNG — perturbations may only touch `price` / `metric.<field>` numbers that
 * already exist; steps structure, name, journal, and config are protected), then
 * writes one validated file per variant into `--out-dir`. It preflights EVERY target
 * (internal name collisions, and — without `--force` — pre-existing files) before
 * writing any, so a detectable problem refuses with no partial output. It touches no
 * network/RPC/wallet. Feed the output dir into `paper:backtest:suite`, then compare
 * with `paper:backtest:diff:suite`.
 */
export function paperBacktestScenarioVariantsReport(
  ctx: CommandContext = {},
  opts: PaperBacktestScenarioVariantsCommandOptions = {},
): string {
  if (!opts.basePath) return "Refusing: --base <path> is required.";
  if (!opts.planPath) return "Refusing: --plan <path> is required.";
  if (!opts.outDir) return "Refusing: --out-dir <path> is required.";

  let baseValue: unknown;
  try {
    baseValue = readJsonValue(ctx, opts.basePath, "base scenario");
  } catch (err) {
    return redactString(`Refusing: ${(err as Error).message}`);
  }

  let planValue: unknown;
  try {
    planValue = readJsonValue(ctx, opts.planPath, "variant plan");
  } catch (err) {
    return redactString(`Refusing: ${(err as Error).message}`);
  }

  let result: ReturnType<typeof generateScenarioVariants>;
  try {
    result = generateScenarioVariants(baseValue, planValue);
  } catch (err) {
    return redactString(`Refusing: ${(err as Error).message}`);
  }

  const outDir = resolvePath(ctx, opts.outDir);
  const stem = scenarioStem(opts.basePath);
  const targets = result.variants.map((v) => ({
    suffix: v.suffix,
    scenario: v.scenario,
    changeCount: v.changeCount,
    path: join(outDir, `${stem}.${v.suffix}.scenario.json`),
  }));

  // Preflight: refuse on any internal filename collision (case-insensitive, so a
  // case-only suffix difference cannot clobber a sibling on a case-insensitive FS).
  const seen = new Set<string>();
  for (const t of targets) {
    const key = t.path.toLowerCase();
    if (seen.has(key)) {
      return redactString(
        `Refusing: output filename collision at ${t.path} — rename a variant suffix`,
      );
    }
    seen.add(key);
  }

  // Refuse if ANY target already exists (check all before writing any — no partial writes).
  if (!opts.force) {
    const existing = targets.filter((t) => existsSync(t.path));
    if (existing.length > 0) {
      return redactString(
        `Refusing: ${existing.length} output file(s) already exist (pass --force to overwrite): ` +
          existing.map((t) => t.path).join(", "),
      );
    }
  }

  try {
    mkdirSync(outDir, { recursive: true });
  } catch {
    return redactString(`Refusing: cannot create output directory at ${outDir}`);
  }
  for (const t of targets) {
    try {
      writeFileSync(t.path, JSON.stringify(redactValue(t.scenario), null, 2) + "\n");
    } catch {
      return redactString(`Refusing: cannot write scenario file at ${t.path}`);
    }
  }

  if (opts.json) {
    const envelope = {
      command: "paper:backtest:scenario:variants",
      name: result.name,
      base: opts.basePath,
      outDir,
      variants: targets.map((t) => ({
        suffix: t.suffix,
        name: t.scenario.name,
        changeCount: t.changeCount,
        out: t.path,
      })),
    };
    return JSON.stringify(redactValue(envelope), null, 2);
  }

  const title = result.name ?? scenarioStem(opts.basePath);
  const header = `Wrote ${targets.length} scenario variant(s) — ${title} (PAPER ONLY)`;
  const lines: string[] = [header, "=".repeat(header.length)];
  lines.push(`base:      ${opts.basePath}`);
  lines.push(`plan:      ${result.name ?? "(unnamed)"}`);
  lines.push(`out-dir:   ${outDir}`);
  lines.push(`variants:  ${targets.length}`);
  for (const t of targets) {
    const lint = lintBacktestScenario(t.scenario);
    const status = lint.warnings.length > 0 ? `RUNNABLE (+${lint.warnings.length} warning(s))` : "VALID";
    lines.push(`- ${t.suffix}: ${t.path}  [${status}, ${t.changeCount} value(s) changed]`);
  }
  lines.push("");
  lines.push("Notes:");
  lines.push("- Injected fixtures — bounded perturbations of injected prices/metrics, NOT real market data, NOT advice.");
  lines.push("- Variants are simulated local scenario data, not live results and not a profitability claim.");
  lines.push("- Every variant validates; run them as a suite: paper:backtest:suite --dir <out-dir>.");
  return redactString(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Sprint 14 (Slice B) — paper:backtest:scenario:variants:explain
//   Dry-run inspection of a variant plan against a base scenario: reads the two
//   local JSON files, explains every perturbation (target / op / value / bounds /
//   mint filter / how many injected values it WOULD change), and reports validity.
//   It writes nothing, generates no variants, and runs no backtest.
// ---------------------------------------------------------------------------

export interface PaperBacktestVariantPlanExplainCommandOptions {
  /** Path to the base scenario JSON (required). */
  basePath?: string;
  /** Path to the variant plan JSON (required). */
  planPath?: string;
  json?: boolean;
}

/**
 * `soulmaker paper:backtest:scenario:variants:explain` — explain what
 * `paper:backtest:scenario:variants` (Sprint 12) WOULD do, without doing it. Reads
 * ONLY the two named local JSON files (BOM-tolerant; missing args / malformed JSON /
 * invalid base / invalid plan all refuse), validates them with the SAME rules as
 * generation, and reports each variant's perturbations and how many injected values
 * each would change (a dry-run count). It writes nothing, generates no variant files,
 * and runs no backtest. `--json` emits the stable, redacted explanation. The exit code
 * is non-zero only when the plan is invalid (some perturbation matches no values),
 * mirroring that generation would refuse it. No chain access, no wallet, no network.
 */
export function paperBacktestVariantPlanExplainReport(
  ctx: CommandContext = {},
  opts: PaperBacktestVariantPlanExplainCommandOptions = {},
): CliReport {
  if (!opts.basePath) return { text: "Refusing: --base <path> is required.", exitCode: 1 };
  if (!opts.planPath) return { text: "Refusing: --plan <path> is required.", exitCode: 1 };

  let baseValue: unknown;
  try {
    baseValue = readJsonValue(ctx, opts.basePath, "base scenario");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let planValue: unknown;
  try {
    planValue = readJsonValue(ctx, opts.planPath, "variant plan");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let explanation: ScenarioVariantPlanExplanation;
  try {
    explanation = explainScenarioVariantPlan(baseValue, planValue);
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // A plan with a matched-nothing perturbation is reported (not thrown) but still
  // refused at the exit-code level, mirroring that generation would refuse it.
  const exitCode = explanation.valid ? 0 : 1;
  if (opts.json) {
    // redactValue is a backstop; the explanation carries only injected scenario identifiers.
    return { text: JSON.stringify(redactValue(explanation), null, 2), exitCode };
  }
  return {
    text: redactString(
      formatScenarioVariantPlanExplanation(explanation, {
        baseLabel: opts.basePath,
        planLabel: opts.planPath,
      }),
    ),
    exitCode,
  };
}

// ---------------------------------------------------------------------------
// Sprint 11 — paper:backtest:suite (run a directory of scenarios as one suite)
//             paper:backtest:diff:suite (compare two suite outputs)
// ---------------------------------------------------------------------------

export interface PaperBacktestSuiteCommandOptions {
  /** Directory of local `*.scenario.json` files to run as one suite (required). */
  dir?: string;
  /** Optional directory to write one report per passed scenario + suite-index.json. */
  outDir?: string;
  /** Overwrite existing output files (refused by default). */
  force?: boolean;
  json?: boolean;
  /** Exit non-zero when any scenario in the suite failed. */
  failOnError?: boolean;
}

/**
 * Derive a filesystem-safe, collision-checkable stem from a scenario filename.
 * Strips the `.scenario.json` suffix and replaces anything outside [A-Za-z0-9._-]
 * (and any run of dots, to kill `..`) with `_`. `readdirSync` already yields plain
 * basenames, so there is no path separator to traverse; this is a defensive
 * backstop plus the key used to detect two scenarios mapping to one output name.
 */
function suiteScenarioStem(file: string): string {
  const base = file.replace(/\.scenario\.json$/i, "");
  const safe = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/\.{2,}/g, "_");
  return safe.length > 0 ? safe : "scenario";
}

/**
 * Write the suite's report files + `suite-index.json` into `--out-dir`. Preflights
 * every target path (internal collisions, and — without `--force` — pre-existing
 * files) BEFORE writing anything, so a detectable problem refuses with no partial
 * output. Reports are written exactly like `paper:backtest --out` (redacted JSON);
 * NO journal or fills are ever written. Returns ok or a clean, non-secret reason.
 */
function writeSuiteOutputs(
  ctx: CommandContext,
  outDirArg: string,
  force: boolean,
  result: BacktestSuiteResult,
  index: BacktestSuiteIndex,
): { ok: true; written: string[] } | { ok: false; reason: string } {
  const outDir = resolvePath(ctx, outDirArg);
  const reports = result.entries
    .filter((e) => e.status === "passed" && e.report !== null && e.reportFile !== null)
    .map((e) => ({ path: join(outDir, e.reportFile as string), report: e.report as BacktestReport }));
  const indexPath = join(outDir, "suite-index.json");

  // Preflight: refuse on any internal filename collision (no partial writes).
  const seen = new Set<string>();
  for (const path of [...reports.map((r) => r.path), indexPath]) {
    if (seen.has(path)) {
      return { ok: false, reason: `output filename collision at ${path} — rename a scenario` };
    }
    seen.add(path);
  }
  // Preflight: refuse to overwrite existing files unless --force.
  if (!force) {
    const existing = [...seen].filter((p) => existsSync(p));
    if (existing.length > 0) {
      return {
        ok: false,
        reason:
          `${existing.length} output file(s) already exist (pass --force to overwrite): ` +
          existing.join(", "),
      };
    }
  }

  try {
    mkdirSync(outDir, { recursive: true });
  } catch {
    return { ok: false, reason: `cannot create output directory at ${outDir}` };
  }
  const written: string[] = [];
  for (const r of reports) {
    try {
      writeFileSync(r.path, JSON.stringify(redactValue(r.report), null, 2) + "\n");
      written.push(r.path);
    } catch {
      return { ok: false, reason: `cannot write report file at ${r.path}` };
    }
  }
  try {
    writeFileSync(indexPath, JSON.stringify(redactValue(index), null, 2) + "\n");
    written.push(indexPath);
  } catch {
    return { ok: false, reason: `cannot write suite index at ${indexPath}` };
  }
  return { ok: true, written };
}

/**
 * `soulmaker paper:backtest:suite` — run a whole directory of injected
 * `*.scenario.json` files as one deterministic, PAPER-ONLY suite and aggregate the
 * simulated reports into a stable index. It reads ONLY local scenario files (sorted
 * by filename, BOM-tolerant); a malformed-JSON file refuses the whole suite. With
 * `--out-dir` it writes one redacted report JSON per PASSED scenario plus
 * `suite-index.json` (never a journal or fills), preflighting targets so it never
 * writes partial output. Without `--out-dir` it writes nothing. `--json` prints the
 * suite index JSON; `--fail-on-error` exits non-zero if any scenario failed (a
 * failed scenario is still clearly reported either way). No chain access, no wallet,
 * no RPC, no network — every number is simulated bookkeeping, not a live result.
 */
export function paperBacktestSuiteReport(
  ctx: CommandContext = {},
  opts: PaperBacktestSuiteCommandOptions = {},
): CliReport {
  if (!opts.dir) return { text: "Refusing: --dir <path> is required.", exitCode: 1 };

  const dir = resolvePath(ctx, opts.dir);
  let isDir = false;
  try {
    isDir = statSync(dir).isDirectory();
  } catch {
    return { text: redactString(`Refusing: scenario directory not found at ${dir}`), exitCode: 1 };
  }
  if (!isDir) {
    return { text: redactString(`Refusing: ${dir} is not a directory`), exitCode: 1 };
  }

  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return { text: redactString(`Refusing: cannot read scenario directory at ${dir}`), exitCode: 1 };
  }
  // Deterministic: only top-level *.scenario.json files, sorted by filename.
  const scenarioFiles = names.filter((f) => /\.scenario\.json$/i.test(f)).sort();
  if (scenarioFiles.length === 0) {
    return {
      text: redactString(`Refusing: no *.scenario.json files found in ${dir}`),
      exitCode: 1,
    };
  }

  // Parse every scenario up front (BOM-tolerant). A malformed file or a
  // sanitized-stem collision refuses the WHOLE suite before anything runs.
  const scenarios: BacktestSuiteScenario[] = [];
  const stems = new Map<string, string>();
  for (const file of scenarioFiles) {
    const full = join(dir, file);
    let text: string;
    try {
      text = stripJsonBom(readFileSync(full, "utf8"));
    } catch {
      return { text: redactString(`Refusing: cannot read scenario file at ${full}`), exitCode: 1 };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { text: redactString(`Refusing: scenario file ${file} is not valid JSON`), exitCode: 1 };
    }
    const stem = suiteScenarioStem(file);
    const prior = stems.get(stem);
    if (prior !== undefined) {
      return {
        text: redactString(
          `Refusing: scenario files "${prior}" and "${file}" map to the same output name ` +
            `"${stem}" — rename one to avoid an ambiguous report file.`,
        ),
        exitCode: 1,
      };
    }
    stems.set(stem, file);
    const envelope: BacktestSuiteScenario = { scenario: parsed, file, id: stem };
    if (opts.outDir) envelope.reportFile = `${stem}.report.json`;
    scenarios.push(envelope);
  }

  let result: BacktestSuiteResult;
  try {
    result = runBacktestSuite({ name: basename(dir), scenarios });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }
  const index = buildBacktestSuiteIndex(result);

  let writtenNote = "";
  if (opts.outDir) {
    const written = writeSuiteOutputs(ctx, opts.outDir, Boolean(opts.force), result, index);
    if (!written.ok) {
      return { text: redactString(`Refusing: ${written.reason}`), exitCode: 1 };
    }
    writtenNote =
      `\n\nWrote ${written.written.length} file(s) to ${resolvePath(ctx, opts.outDir)}:\n` +
      written.written.map((p) => `- ${p}`).join("\n");
  }

  const exitCode = opts.failOnError && index.summary.failedCount > 0 ? 1 : 0;
  if (opts.json) {
    // redactValue is a backstop; the index carries only injected scenario identifiers.
    return { text: JSON.stringify(redactValue(index), null, 2), exitCode };
  }
  return { text: formatBacktestSuiteIndex(index, { label: opts.dir }) + writtenNote, exitCode };
}

export interface PaperBacktestDiffSuiteCommandOptions {
  /** Directory holding the BASE suite output (must contain suite-index.json). */
  baseDir?: string;
  /** Directory holding the NEXT suite output (must contain suite-index.json). */
  nextDir?: string;
  json?: boolean;
  /** Exit non-zero only when the diff reports a regression. */
  failOnRegression?: boolean;
}

/**
 * Read and parse `suite-index.json` from a suite output directory (BOM-tolerant).
 * Returns the parsed value or a clean, non-secret refusal reason. Read-only.
 */
function readSuiteIndexFromDir(
  ctx: CommandContext,
  dirArg: string,
  label: string,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  const dir = resolvePath(ctx, dirArg);
  let isDir = false;
  try {
    isDir = statSync(dir).isDirectory();
  } catch {
    return { ok: false, reason: `${label} directory not found at ${dir}` };
  }
  if (!isDir) return { ok: false, reason: `${label} path ${dir} is not a directory` };

  const indexPath = join(dir, "suite-index.json");
  let text: string;
  try {
    text = stripJsonBom(readFileSync(indexPath, "utf8"));
  } catch {
    return { ok: false, reason: `no suite-index.json found in ${label} directory ${dir}` };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, reason: `suite-index.json in ${label} directory ${dir} is not valid JSON` };
  }
}

/**
 * `soulmaker paper:backtest:diff:suite` — deterministically diff TWO suite output
 * directories by reading each one's `suite-index.json` (BOM-tolerant; a missing or
 * malformed index refuses). It runs no backtests, reads no scenarios, and writes
 * nothing — it only compares two already-produced indexes. `--json` emits the
 * stable, redacted {@link BacktestSuiteDiff}; `--fail-on-regression` sets a non-zero
 * exit only when `diff.hasRegression` is true. A delta is simulated bookkeeping —
 * never profit, loss, a prediction, or advice; a changed scenario is not a
 * regression. No chain access, no wallet, no RPC, no network.
 */
export function paperBacktestDiffSuiteReport(
  ctx: CommandContext = {},
  opts: PaperBacktestDiffSuiteCommandOptions = {},
): CliReport {
  if (!opts.baseDir) return { text: "Refusing: --base-dir <path> is required.", exitCode: 1 };
  if (!opts.nextDir) return { text: "Refusing: --next-dir <path> is required.", exitCode: 1 };

  const base = readSuiteIndexFromDir(ctx, opts.baseDir, "base");
  if (!base.ok) return { text: redactString(`Refusing: ${base.reason}`), exitCode: 1 };
  const next = readSuiteIndexFromDir(ctx, opts.nextDir, "next");
  if (!next.ok) return { text: redactString(`Refusing: ${next.reason}`), exitCode: 1 };

  let diff: BacktestSuiteDiff;
  try {
    // Validates both indexes strictly; a non-index file refuses.
    diff = diffBacktestSuites(base.value, next.value);
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  const exitCode = opts.failOnRegression && diff.hasRegression ? 1 : 0;
  if (opts.json) {
    // redactValue is a backstop; the diff carries only injected scenario identifiers.
    return { text: JSON.stringify(redactValue(diff), null, 2), exitCode };
  }
  return {
    text: formatBacktestSuiteDiff(diff, { baseLabel: opts.baseDir, nextLabel: opts.nextDir }),
    exitCode,
  };
}

// ---------------------------------------------------------------------------
// Sprint 13 — paper:backtest:sensitivity
//   Generate deterministic variants of a base scenario, run the base (baseline)
//   plus every variant through the existing suite path, and emit a stable
//   sensitivity report of how each variant moved the simulated outputs.
// ---------------------------------------------------------------------------

export interface PaperBacktestSensitivityCommandOptions {
  /** Path to the base scenario JSON (required). */
  basePath?: string;
  /** Path to the variant plan JSON ({ name?, variants: [{ suffix, perturbations }] }) (required). */
  planPath?: string;
  /** Optional directory to write variants/ + reports/ + sensitivity-report.json into. */
  outDir?: string;
  /** Overwrite existing output files (refused by default). */
  force?: boolean;
  json?: boolean;
}

/**
 * Write the full sensitivity artifact tree into `--out-dir`:
 *
 *   <out-dir>/variants/<stem>.<suffix>.scenario.json   (one per generated variant)
 *   <out-dir>/reports/base.report.json                 (the baseline run)
 *   <out-dir>/reports/<suffix>.report.json             (one per PASSED variant)
 *   <out-dir>/reports/suite-index.json                 (Sprint 11 suite index)
 *   <out-dir>/sensitivity-report.json                  (Sprint 13 report)
 *
 * EVERY target path is preflighted up front — internal collisions (case-insensitive,
 * so a case-only suffix difference cannot clobber a sibling and a "base" suffix
 * cannot clobber the baseline report) and, without `--force`, any pre-existing
 * file — BEFORE a single file is written. So any detectable problem (including a
 * later output that would fail) refuses with NO partial output. Reports/scenarios
 * are written redacted, exactly like the suite/variants commands. Never writes a
 * journal or fills.
 */
function writeSensitivityOutputs(
  ctx: CommandContext,
  outDirArg: string,
  force: boolean,
  run: ScenarioVariantSensitivityRun,
  stem: string,
): { ok: true; written: string[] } | { ok: false; reason: string } {
  const outDir = resolvePath(ctx, outDirArg);
  const variantsDir = join(outDir, "variants");
  const reportsDir = join(outDir, "reports");

  const targets: { path: string; value: unknown }[] = [];
  // One scenario file per generated variant (suffix already validated [A-Za-z0-9._-]).
  for (const v of run.variantsResult.variants) {
    targets.push({ path: join(variantsDir, `${stem}.${v.suffix}.scenario.json`), value: v.scenario });
  }
  // The baseline report (entries[0]); a valid base always runs, so this is present.
  const baselineEntry = run.suiteResult.entries[0];
  if (baselineEntry?.report) {
    targets.push({ path: join(reportsDir, "base.report.json"), value: baselineEntry.report });
  }
  // One report per PASSED variant (a failed variant produces no report).
  for (const e of run.suiteResult.entries.slice(1)) {
    if (e.report) targets.push({ path: join(reportsDir, `${e.id}.report.json`), value: e.report });
  }
  // The aggregate suite index and the headline sensitivity report.
  targets.push({ path: join(reportsDir, "suite-index.json"), value: run.suiteIndex });
  targets.push({ path: join(outDir, "sensitivity-report.json"), value: run.report });

  // Preflight: refuse on any internal filename collision (no partial writes).
  const seen = new Set<string>();
  for (const t of targets) {
    const key = t.path.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, reason: `output filename collision at ${t.path} — rename a variant suffix` };
    }
    seen.add(key);
  }
  // Preflight: refuse to overwrite any existing target unless --force (check ALL first).
  if (!force) {
    const existing = targets.filter((t) => existsSync(t.path));
    if (existing.length > 0) {
      return {
        ok: false,
        reason:
          `${existing.length} output file(s) already exist (pass --force to overwrite): ` +
          existing.map((t) => t.path).join(", "),
      };
    }
  }

  try {
    mkdirSync(variantsDir, { recursive: true });
    mkdirSync(reportsDir, { recursive: true });
  } catch {
    return { ok: false, reason: `cannot create output directories under ${outDir}` };
  }
  const written: string[] = [];
  for (const t of targets) {
    try {
      writeFileSync(t.path, JSON.stringify(redactValue(t.value), null, 2) + "\n");
      written.push(t.path);
    } catch {
      return { ok: false, reason: `cannot write output file at ${t.path}` };
    }
  }
  return { ok: true, written };
}

/**
 * `soulmaker paper:backtest:sensitivity` — the Sprint 13 workflow. It reads ONLY the
 * two named local JSON files (BOM-tolerant; missing args / malformed JSON / invalid
 * base / invalid plan all refuse), generates deterministic variants via the Sprint
 * 12 generator, runs the BASE (as a baseline) plus every variant through the Sprint
 * 11 suite path, and emits a stable, versioned sensitivity report of each variant's
 * per-field delta versus the baseline. With `--out-dir` it writes the variants, the
 * per-scenario reports, the suite index, and `sensitivity-report.json` (preflighted
 * so it never writes partial output; refuses to overwrite without `--force`).
 * `--json` prints the report JSON; otherwise a human report led by the PAPER-ONLY
 * banner. No chain access, no wallet, no RPC, no network — every number is simulated
 * bookkeeping over injected prices, not a live result and not a profitability claim.
 */
export function paperBacktestSensitivityReport(
  ctx: CommandContext = {},
  opts: PaperBacktestSensitivityCommandOptions = {},
): string {
  if (!opts.basePath) return "Refusing: --base <path> is required.";
  if (!opts.planPath) return "Refusing: --plan <path> is required.";

  let baseValue: unknown;
  try {
    baseValue = readJsonValue(ctx, opts.basePath, "base scenario");
  } catch (err) {
    return redactString(`Refusing: ${(err as Error).message}`);
  }

  let planValue: unknown;
  try {
    planValue = readJsonValue(ctx, opts.planPath, "variant plan");
  } catch (err) {
    return redactString(`Refusing: ${(err as Error).message}`);
  }

  let run: ScenarioVariantSensitivityRun;
  try {
    run = runScenarioVariantSensitivity({ base: baseValue, plan: planValue });
  } catch (err) {
    return redactString(`Refusing: ${(err as Error).message}`);
  }

  let writtenNote = "";
  if (opts.outDir) {
    const stem = scenarioStem(opts.basePath);
    const res = writeSensitivityOutputs(ctx, opts.outDir, Boolean(opts.force), run, stem);
    if (!res.ok) return redactString(`Refusing: ${res.reason}`);
    writtenNote =
      `\n\nWrote ${res.written.length} file(s) to ${resolvePath(ctx, opts.outDir)}:\n` +
      res.written.map((p) => `- ${p}`).join("\n");
  }

  if (opts.json) {
    // redactValue is a backstop; the report carries only injected scenario identifiers.
    return JSON.stringify(redactValue(run.report), null, 2);
  }
  return redactString(
    formatScenarioVariantSensitivityReport(run.report, { label: opts.basePath }) + writtenNote,
  );
}

// ---------------------------------------------------------------------------
// Sprint 14 (Slice C) — paper:backtest:diff:sensitivity
//   Deterministically diff TWO sensitivity report JSON files (the analogue of
//   paper:backtest:diff:suite for the Sprint 13 sensitivity report). Reads only
//   the two named files, runs no backtest, generates no variants, writes nothing.
// ---------------------------------------------------------------------------

export interface PaperBacktestDiffSensitivityCommandOptions {
  /** Path to the BASE sensitivity report JSON (required). */
  basePath?: string;
  /** Path to the NEXT sensitivity report JSON (required). */
  nextPath?: string;
  json?: boolean;
  /** Exit non-zero when the diff reports a conservative bookkeeping regression. */
  failOnRegression?: boolean;
}

/**
 * `soulmaker paper:backtest:diff:sensitivity` — deterministically diff TWO Sprint 13
 * sensitivity report JSON files. Reads ONLY the two named local files (BOM-tolerant; a
 * missing/malformed/non-report file refuses), runs no backtest, generates no variants,
 * and writes nothing. It pairs variants by suffix and reports added/removed/changed
 * variants, baseline + count deltas, ranking movement, and a conservative
 * `hasRegression` flag. A delta is simulated bookkeeping — never profit, loss, a
 * prediction, or advice; a changed (different-content) variant is not a regression.
 * `--json` emits the stable, redacted diff; `--fail-on-regression` sets a non-zero exit
 * only when `diff.hasRegression` is true. No chain access, no wallet, no RPC, no network.
 */
export function paperBacktestDiffSensitivityReport(
  ctx: CommandContext = {},
  opts: PaperBacktestDiffSensitivityCommandOptions = {},
): CliReport {
  if (!opts.basePath) return { text: "Refusing: --base <path> is required.", exitCode: 1 };
  if (!opts.nextPath) return { text: "Refusing: --next <path> is required.", exitCode: 1 };

  let baseValue: unknown;
  try {
    baseValue = readJsonValue(ctx, opts.basePath, "base sensitivity report");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let nextValue: unknown;
  try {
    nextValue = readJsonValue(ctx, opts.nextPath, "next sensitivity report");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let diff: ScenarioVariantSensitivityDiff;
  try {
    // Validates both reports structurally; a non-report refuses.
    diff = diffScenarioVariantSensitivityReports(baseValue, nextValue);
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  const exitCode = opts.failOnRegression && diff.hasRegression ? 1 : 0;
  if (opts.json) {
    // redactValue is a backstop; the diff carries only injected scenario identifiers.
    return { text: JSON.stringify(redactValue(diff), null, 2), exitCode };
  }
  return {
    text: formatScenarioVariantSensitivityDiff(diff, { baseLabel: opts.basePath, nextLabel: opts.nextPath }),
    exitCode,
  };
}

// ---------------------------------------------------------------------------
// Sprint 15 — paper:backtest:sensitivity:matrix
//   Sweep a DIRECTORY of injected base scenarios through ONE shared variant plan
//   and aggregate every (base × variant) cell into a deterministic matrix report.
// ---------------------------------------------------------------------------

export interface PaperBacktestSensitivityMatrixCommandOptions {
  /** Directory of local `*.scenario.json` base scenarios to sweep (required). */
  dir?: string;
  /** Path to the SHARED variant plan JSON applied to every base (required). */
  planPath?: string;
  /** Optional directory to write the matrix report + per-base sensitivity reports into. */
  outDir?: string;
  /** Overwrite existing output files (refused by default). */
  force?: boolean;
  json?: boolean;
  /** Exit non-zero when any base baseline or variant run failed. */
  failOnError?: boolean;
}

/**
 * Write the matrix artifact tree into `--out-dir`:
 *
 *   <out-dir>/sensitivity-matrix-report.json          (Sprint 15 matrix report)
 *   <out-dir>/bases/<id>.sensitivity-report.json      (one Sprint 13 report per base)
 *
 * EVERY target path is preflighted up front — internal collisions (case-insensitive) and,
 * without `--force`, any pre-existing file — BEFORE a single file is written, so any
 * detectable problem refuses with NO partial output. Base ids are already sanitized,
 * collision-checked filename stems, so the per-base files cannot clobber each other. All
 * JSON is written redacted, exactly like the suite/sensitivity commands. Never writes a
 * journal or fills.
 */
function writeSensitivityMatrixOutputs(
  ctx: CommandContext,
  outDirArg: string,
  force: boolean,
  run: ScenarioVariantSensitivityMatrixRun,
): { ok: true; written: string[] } | { ok: false; reason: string } {
  const outDir = resolvePath(ctx, outDirArg);
  const basesDir = join(outDir, "bases");

  const targets: { path: string; value: unknown }[] = [
    { path: join(outDir, "sensitivity-matrix-report.json"), value: run.report },
  ];
  for (const { id, run: baseRun } of run.baseRuns) {
    targets.push({ path: join(basesDir, `${id}.sensitivity-report.json`), value: baseRun.report });
  }

  // Preflight: refuse on any internal filename collision (no partial writes).
  const seen = new Set<string>();
  for (const t of targets) {
    const key = t.path.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, reason: `output filename collision at ${t.path} — rename a base scenario` };
    }
    seen.add(key);
  }
  // Preflight: refuse to overwrite any existing target unless --force (check ALL first).
  if (!force) {
    const existing = targets.filter((t) => existsSync(t.path));
    if (existing.length > 0) {
      return {
        ok: false,
        reason:
          `${existing.length} output file(s) already exist (pass --force to overwrite): ` +
          existing.map((t) => t.path).join(", "),
      };
    }
  }

  try {
    mkdirSync(basesDir, { recursive: true });
  } catch {
    return { ok: false, reason: `cannot create output directories under ${outDir}` };
  }
  const written: string[] = [];
  for (const t of targets) {
    try {
      writeFileSync(t.path, JSON.stringify(redactValue(t.value), null, 2) + "\n");
      written.push(t.path);
    } catch {
      return { ok: false, reason: `cannot write output file at ${t.path}` };
    }
  }
  return { ok: true, written };
}

/**
 * `soulmaker paper:backtest:sensitivity:matrix` — the Sprint 15 multi-base workflow. It
 * reads ONLY local files: every top-level `*.scenario.json` in `--dir` (sorted by filename,
 * BOM-tolerant) as a base, plus the one `--plan` JSON. A missing/non-directory/empty `--dir`,
 * a malformed scenario, a duplicate sanitized base stem, a malformed plan, or a base that is
 * invalid or incompatible with the plan all refuse the WHOLE matrix with NO output. It sweeps
 * each base through the SAME plan via the Sprint 13 sensitivity workflow and aggregates every
 * (base × variant) cell into a stable matrix report. With `--out-dir` it writes the matrix
 * report and one per-base sensitivity report (preflighted; refuses to overwrite without
 * `--force`; never a journal or fills). `--json` prints the matrix report JSON; otherwise a
 * human report led by the PAPER-ONLY banner. `--fail-on-error` exits non-zero if any base
 * baseline or variant run failed. No chain access, no wallet, no RPC, no network — every
 * number is simulated bookkeeping over injected prices, not a live result.
 */
export function paperBacktestSensitivityMatrixReport(
  ctx: CommandContext = {},
  opts: PaperBacktestSensitivityMatrixCommandOptions = {},
): CliReport {
  if (!opts.dir) return { text: "Refusing: --dir <path> is required.", exitCode: 1 };
  if (!opts.planPath) return { text: "Refusing: --plan <path> is required.", exitCode: 1 };

  const dir = resolvePath(ctx, opts.dir);
  let isDir = false;
  try {
    isDir = statSync(dir).isDirectory();
  } catch {
    return { text: redactString(`Refusing: scenario directory not found at ${dir}`), exitCode: 1 };
  }
  if (!isDir) {
    return { text: redactString(`Refusing: ${dir} is not a directory`), exitCode: 1 };
  }

  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return { text: redactString(`Refusing: cannot read scenario directory at ${dir}`), exitCode: 1 };
  }
  // Deterministic: only top-level *.scenario.json files, sorted by filename.
  const scenarioFiles = names.filter((f) => /\.scenario\.json$/i.test(f)).sort();
  if (scenarioFiles.length === 0) {
    return { text: redactString(`Refusing: no *.scenario.json files found in ${dir}`), exitCode: 1 };
  }

  // Read the shared plan first (BOM-tolerant); a missing/malformed plan refuses.
  let planValue: unknown;
  try {
    planValue = readJsonValue(ctx, opts.planPath, "variant plan");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // Parse every base up front (BOM-tolerant). A malformed file or a sanitized-stem
  // collision refuses the WHOLE matrix before anything runs.
  const bases: { id: string; scenario: unknown }[] = [];
  const stems = new Map<string, string>();
  for (const file of scenarioFiles) {
    const full = join(dir, file);
    let text: string;
    try {
      text = stripJsonBom(readFileSync(full, "utf8"));
    } catch {
      return { text: redactString(`Refusing: cannot read scenario file at ${full}`), exitCode: 1 };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { text: redactString(`Refusing: scenario file ${file} is not valid JSON`), exitCode: 1 };
    }
    const stem = suiteScenarioStem(file);
    const prior = stems.get(stem);
    if (prior !== undefined) {
      return {
        text: redactString(
          `Refusing: base scenario files "${prior}" and "${file}" map to the same base id ` +
            `"${stem}" — rename one to avoid an ambiguous matrix row.`,
        ),
        exitCode: 1,
      };
    }
    stems.set(stem, file);
    bases.push({ id: stem, scenario: parsed });
  }

  let run: ScenarioVariantSensitivityMatrixRun;
  try {
    run = runScenarioVariantSensitivityMatrix({ name: basename(dir), bases, plan: planValue });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let writtenNote = "";
  if (opts.outDir) {
    const res = writeSensitivityMatrixOutputs(ctx, opts.outDir, Boolean(opts.force), run);
    if (!res.ok) return { text: redactString(`Refusing: ${res.reason}`), exitCode: 1 };
    writtenNote =
      `\n\nWrote ${res.written.length} file(s) to ${resolvePath(ctx, opts.outDir)}:\n` +
      res.written.map((p) => `- ${p}`).join("\n");
  }

  const failed = run.report.failedBaseCount > 0 || run.report.failedVariantRunCount > 0;
  const exitCode = opts.failOnError && failed ? 1 : 0;
  if (opts.json) {
    // redactValue is a backstop; the report carries only injected scenario identifiers.
    return { text: JSON.stringify(redactValue(run.report), null, 2), exitCode };
  }
  return {
    text: redactString(
      formatScenarioVariantSensitivityMatrixReport(run.report, { label: opts.dir }) + writtenNote,
    ),
    exitCode,
  };
}

// ---------------------------------------------------------------------------
// Sprint 15 — paper:backtest:diff:sensitivity:matrix
//   Deterministically diff TWO sensitivity matrix report JSON files. Reads only the
//   two named files, runs no backtest, sweeps no bases, writes nothing.
// ---------------------------------------------------------------------------

export interface PaperBacktestDiffSensitivityMatrixCommandOptions {
  /** Path to the BASE matrix report JSON (required). */
  basePath?: string;
  /** Path to the NEXT matrix report JSON (required). */
  nextPath?: string;
  json?: boolean;
  /** Exit non-zero when the diff reports a conservative bookkeeping regression. */
  failOnRegression?: boolean;
}

/**
 * `soulmaker paper:backtest:diff:sensitivity:matrix` — deterministically diff TWO Sprint 15
 * matrix report JSON files. Reads ONLY the two named local files (BOM-tolerant; a
 * missing/malformed/non-matrix file refuses), runs no backtest, sweeps no bases, and writes
 * nothing. It pairs bases by id and cells by suffix and reports added/removed/changed bases,
 * count deltas, descriptive cross-base aggregate changes, ranking movement, and a
 * conservative `hasRegression` flag. A delta is simulated bookkeeping — never profit, loss, a
 * prediction, or advice; a changed (different-content) base is not a regression. `--json`
 * emits the stable, redacted diff; `--fail-on-regression` sets a non-zero exit only when
 * `diff.hasRegression` is true. No chain access, no wallet, no RPC, no network.
 */
export function paperBacktestDiffSensitivityMatrixReport(
  ctx: CommandContext = {},
  opts: PaperBacktestDiffSensitivityMatrixCommandOptions = {},
): CliReport {
  if (!opts.basePath) return { text: "Refusing: --base <path> is required.", exitCode: 1 };
  if (!opts.nextPath) return { text: "Refusing: --next <path> is required.", exitCode: 1 };

  let baseValue: unknown;
  try {
    baseValue = readJsonValue(ctx, opts.basePath, "base matrix report");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let nextValue: unknown;
  try {
    nextValue = readJsonValue(ctx, opts.nextPath, "next matrix report");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let diff: ScenarioVariantSensitivityMatrixDiff;
  try {
    // Validates both reports structurally; a non-matrix refuses.
    diff = diffScenarioVariantSensitivityMatrixReports(baseValue, nextValue);
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  const exitCode = opts.failOnRegression && diff.hasRegression ? 1 : 0;
  if (opts.json) {
    // redactValue is a backstop; the diff carries only injected scenario identifiers.
    return { text: JSON.stringify(redactValue(diff), null, 2), exitCode };
  }
  return {
    text: formatScenarioVariantSensitivityMatrixDiff(diff, { baseLabel: opts.basePath, nextLabel: opts.nextPath }),
    exitCode,
  };
}

// ---------------------------------------------------------------------------
// Sprint 14 (Slice E) — paper:backtest:suite:coverage
//   Read ONE suite-index.json and report which simulated paper-trading paths the
//   suite exercised (behavioural bookkeeping coverage — NOT market/test coverage).
// ---------------------------------------------------------------------------

export interface PaperBacktestSuiteCoverageCommandOptions {
  /** Path to a suite-index.json (or a sensitivity run's reports/suite-index.json) (required). */
  suiteIndexPath?: string;
  json?: boolean;
}

/**
 * `soulmaker paper:backtest:suite:coverage` — summarize the BEHAVIOURAL coverage of a
 * suite from its `suite-index.json`. Reads ONLY the one named local file (BOM-tolerant;
 * a missing/malformed/non-index file refuses), runs no backtest, and writes nothing. It
 * reports per-behaviour scenario counts, which simulated paths were exercised anywhere,
 * the scenario id lists, and a transparently-derived path-behaviour coverage ratio.
 * This is behavioural bookkeeping coverage — NOT market coverage, NOT test coverage,
 * NOT a profitability claim. `--json` emits the stable, redacted coverage report. No
 * chain access, no wallet, no RPC, no network.
 */
export function paperBacktestSuiteCoverageReport(
  ctx: CommandContext = {},
  opts: PaperBacktestSuiteCoverageCommandOptions = {},
): string {
  if (!opts.suiteIndexPath) return "Refusing: --suite-index <path> is required.";

  let value: unknown;
  try {
    value = readJsonValue(ctx, opts.suiteIndexPath, "suite index");
  } catch (err) {
    return redactString(`Refusing: ${(err as Error).message}`);
  }

  let report: BacktestSuiteCoverageReport;
  try {
    // Validates the input as a suite index; a non-index refuses.
    report = summarizeBacktestSuiteCoverage(value);
  } catch (err) {
    return redactString(`Refusing: ${(err as Error).message}`);
  }

  if (opts.json) {
    // redactValue is a backstop; the report carries only injected scenario identifiers.
    return JSON.stringify(redactValue(report), null, 2);
  }
  return formatBacktestSuiteCoverage(report, { label: opts.suiteIndexPath });
}

// ---------------------------------------------------------------------------
// Sprint 16 — paper:backtest:research:manifest / :verify / diff:research:manifest
//   Index, verify, and diff the LOCAL JSON artifacts a PAPER-only research run
//   produced — a reproducibility/audit layer. Reads local files only; no backtest,
//   no journal, no network, no wallet.
// ---------------------------------------------------------------------------

/**
 * Research META schemas — these index/describe/summarize artifacts and are not themselves run
 * artifacts. Excluding them from the directory walk means a manifest/bundle/status written into
 * the same run dir is never indexed (a bundle never indexes itself, and verify never sees a meta
 * file as "extra"). Covers Sprint 16 (manifest/verify/manifest-diff) and Sprint 17 (bundle/status).
 */
const RESEARCH_META_SCHEMAS = new Set<string>([
  BACKTEST_RESEARCH_MANIFEST_SCHEMA_VERSION,
  BACKTEST_RESEARCH_VERIFY_SCHEMA_VERSION,
  BACKTEST_RESEARCH_MANIFEST_DIFF_SCHEMA_VERSION,
  BACKTEST_RESEARCH_BUNDLE_SCHEMA_VERSION,
  BACKTEST_RESEARCH_STATUS_SCHEMA_VERSION,
  BACKTEST_RESEARCH_CAMPAIGN_INDEX_SCHEMA_VERSION,
]);

/**
 * Deterministically list every top-level-and-nested `*.json` file under `rootDir`, as
 * forward-slashed paths RELATIVE to `rootDir`, sorted. Recurses real subdirectories only
 * (symlinks are skipped — no traversal outside the tree) to a bounded depth, so a research
 * output tree (`bases/`, `reports/`, `variants/`) is covered without following links. Never
 * includes `*.jsonl` journals.
 */
function listJsonArtifactPaths(rootDir: string): string[] {
  const out: string[] = [];
  const MAX_DEPTH = 8;
  const walk = (dir: string, rel: string, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue; // deterministic; never follow a link out of the tree
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, childRel, depth + 1);
      else if (entry.isFile() && /\.json$/i.test(entry.name)) out.push(childRel);
    }
  };
  walk(rootDir, "", 0);
  return out.sort();
}

/**
 * Read every `*.json` artifact under `rootDir` and build a descriptor per file: its
 * forward-slashed relative path, detected kind + schema, a deterministic non-cryptographic
 * content digest, and byte size. A malformed (unparseable) file is indexed as `unknown-json`
 * (digest over its raw text) and recorded in `malformed` — never a crash. Research-manifest
 * META files (a manifest/verify/diff written into the same dir) are EXCLUDED so a manifest
 * never indexes itself (and verify never sees it as "extra"). Read-only.
 */
function collectArtifactDescriptors(rootDir: string): {
  descriptors: BacktestArtifactDescriptor[];
  malformed: string[];
} {
  const descriptors: BacktestArtifactDescriptor[] = [];
  const malformed: string[] = [];
  for (const rel of listJsonArtifactPaths(rootDir)) {
    const full = join(rootDir, rel);
    let raw: string;
    try {
      raw = stripJsonBom(readFileSync(full, "utf8"));
    } catch {
      continue; // unreadable file — skip (it cannot be part of a reproducible set)
    }
    let sizeBytes: number;
    try {
      sizeBytes = statSync(full).size;
    } catch {
      sizeBytes = Buffer.byteLength(raw, "utf8");
    }
    let kind: BacktestArtifactKind;
    let schemaVersion: string | null;
    let digest: string;
    try {
      const parsed = JSON.parse(raw);
      const classified = classifyBacktestArtifact(parsed);
      // Skip research-manifest meta files so a manifest never indexes itself.
      if (classified.schemaVersion !== null && RESEARCH_META_SCHEMAS.has(classified.schemaVersion)) {
        continue;
      }
      kind = classified.kind;
      schemaVersion = classified.schemaVersion;
      digest = digestContent(parsed);
    } catch {
      malformed.push(rel);
      kind = "unknown-json";
      schemaVersion = null;
      digest = digestContent(raw);
    }
    descriptors.push({ path: rel, kind, schemaVersion, digest, sizeBytes });
  }
  return { descriptors, malformed };
}

/** Resolve `--dir` to an existing directory or a clean refusal reason. */
function resolveArtifactDir(
  ctx: CommandContext,
  dirArg: string,
  label: string,
): { ok: true; dir: string } | { ok: false; reason: string } {
  const dir = resolvePath(ctx, dirArg);
  let isDir = false;
  try {
    isDir = statSync(dir).isDirectory();
  } catch {
    return { ok: false, reason: `${label} directory not found at ${dir}` };
  }
  if (!isDir) return { ok: false, reason: `${label} path ${dir} is not a directory` };
  return { ok: true, dir };
}

export interface PaperBacktestResearchManifestCommandOptions {
  /** Directory of local research artifacts to index (required). */
  dir?: string;
  /** Optional path to write the manifest JSON to (writes nothing without it). */
  outPath?: string;
  /** Overwrite the --out file if it exists (refused by default). */
  force?: boolean;
  json?: boolean;
  /** Exit non-zero if any artifact is unknown/malformed. */
  strict?: boolean;
}

/**
 * `soulmaker paper:backtest:research:manifest` — build a reproducibility MANIFEST of the
 * local JSON artifacts under `--dir` (recursing real subdirectories, BOM-tolerant, sorted).
 * Each artifact is classified by schema/shape and fingerprinted with a non-cryptographic,
 * reproducibility-only content digest; a malformed file is indexed as `unknown-json` and
 * reported, never a crash. With `--out` it writes ONLY the manifest JSON (refuses to
 * overwrite without `--force`; no other file is touched). `--json` prints the manifest;
 * `--strict` exits non-zero when any unknown/malformed artifact is present. It reads local
 * files only — no backtest, no journal, no network, no wallet. The manifest is local
 * bookkeeping, not a live result, not advice, and not a profitability claim.
 */
export function paperBacktestResearchManifestReport(
  ctx: CommandContext = {},
  opts: PaperBacktestResearchManifestCommandOptions = {},
): CliReport {
  if (!opts.dir) return { text: "Refusing: --dir <path> is required.", exitCode: 1 };

  const resolved = resolveArtifactDir(ctx, opts.dir, "artifact");
  if (!resolved.ok) return { text: redactString(`Refusing: ${resolved.reason}`), exitCode: 1 };

  const { descriptors, malformed } = collectArtifactDescriptors(resolved.dir);

  let manifest: BacktestResearchManifest;
  try {
    manifest = buildBacktestResearchManifest({ runName: basename(resolved.dir), artifacts: descriptors });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // Write the manifest only when --out is given; refuse to overwrite without --force.
  let writtenNote = "";
  if (opts.outPath) {
    const outPath = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(outPath)) {
      return {
        text: redactString(`Refusing: ${outPath} already exists (pass --force to overwrite).`),
        exitCode: 1,
      };
    }
    try {
      writeFileSync(outPath, JSON.stringify(redactValue(manifest), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write manifest to ${outPath}`), exitCode: 1 };
    }
    writtenNote = `\n\nWrote manifest to ${outPath}`;
  }

  const unknownCount = manifest.artifacts.filter((a) => a.kind === "unknown-json").length;
  const exitCode = opts.strict && (unknownCount > 0 || malformed.length > 0) ? 1 : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(manifest), null, 2), exitCode };
  }
  const malformedNote =
    malformed.length > 0
      ? `\n\nMalformed (unparseable) JSON file(s), indexed as unknown-json:\n` +
        malformed.map((p) => `- ${p}`).join("\n")
      : "";
  return {
    text: redactString(
      formatBacktestResearchManifest(manifest, { label: opts.dir }) + malformedNote + writtenNote,
    ),
    exitCode,
  };
}

export interface PaperBacktestResearchVerifyCommandOptions {
  /** Path to a manifest JSON to verify against (required). */
  manifestPath?: string;
  /** Directory of current local artifacts (required). */
  dir?: string;
  json?: boolean;
}

/**
 * `soulmaker paper:backtest:research:verify` — verify a previously-written MANIFEST against
 * the CURRENT artifacts under `--dir`. Re-reads each local artifact, recomputes its digest +
 * size, and reports missing / digest-changed / schema-changed / size-changed / extra / ok per
 * artifact plus a VALID/INVALID verdict. It reads local files only and WRITES NOTHING. Exit 0
 * when valid, 1 when invalid (or on a malformed/missing manifest). `--json` emits the stable,
 * redacted verification. No backtest, no journal, no network, no wallet.
 */
export function paperBacktestResearchVerifyReport(
  ctx: CommandContext = {},
  opts: PaperBacktestResearchVerifyCommandOptions = {},
): CliReport {
  if (!opts.manifestPath) return { text: "Refusing: --manifest <path> is required.", exitCode: 1 };
  if (!opts.dir) return { text: "Refusing: --dir <path> is required.", exitCode: 1 };

  let manifestValue: unknown;
  try {
    manifestValue = readJsonValue(ctx, opts.manifestPath, "manifest");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  const resolved = resolveArtifactDir(ctx, opts.dir, "artifact");
  if (!resolved.ok) return { text: redactString(`Refusing: ${resolved.reason}`), exitCode: 1 };

  const { descriptors } = collectArtifactDescriptors(resolved.dir);

  let verification: BacktestResearchVerification;
  try {
    verification = verifyBacktestResearchManifest(manifestValue, descriptors);
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  const exitCode = verification.valid ? 0 : 1;
  if (opts.json) {
    return { text: JSON.stringify(redactValue(verification), null, 2), exitCode };
  }
  return { text: redactString(formatBacktestResearchVerification(verification)), exitCode };
}

export interface PaperBacktestDiffResearchManifestCommandOptions {
  /** Path to the BASE manifest JSON (required). */
  basePath?: string;
  /** Path to the NEXT manifest JSON (required). */
  nextPath?: string;
  json?: boolean;
  /** Exit non-zero when the diff reports any change. */
  failOnChange?: boolean;
}

/**
 * `soulmaker paper:backtest:diff:research:manifest` — diff TWO manifest JSON files. Reads
 * ONLY the two named local files (BOM-tolerant; a missing/malformed/non-manifest file
 * refuses), runs no backtest, and writes nothing. It pairs artifacts by path and reports
 * added/removed/changed artifacts, count + total-size deltas, and per-kind / per-schema count
 * changes. `--json` emits the stable, redacted diff; `--fail-on-change` exits non-zero when
 * `diff.hasChange` is true. No network, no wallet.
 */
export function paperBacktestDiffResearchManifestReport(
  ctx: CommandContext = {},
  opts: PaperBacktestDiffResearchManifestCommandOptions = {},
): CliReport {
  if (!opts.basePath) return { text: "Refusing: --base <path> is required.", exitCode: 1 };
  if (!opts.nextPath) return { text: "Refusing: --next <path> is required.", exitCode: 1 };

  let baseValue: unknown;
  try {
    baseValue = readJsonValue(ctx, opts.basePath, "base manifest");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let nextValue: unknown;
  try {
    nextValue = readJsonValue(ctx, opts.nextPath, "next manifest");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let diff: BacktestResearchManifestDiff;
  try {
    diff = diffBacktestResearchManifests(baseValue, nextValue);
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  const exitCode = opts.failOnChange && diff.hasChange ? 1 : 0;
  if (opts.json) {
    return { text: JSON.stringify(redactValue(diff), null, 2), exitCode };
  }
  return {
    text: formatBacktestResearchManifestDiff(diff, { baseLabel: opts.basePath, nextLabel: opts.nextPath }),
    exitCode,
  };
}

// ---------------------------------------------------------------------------
// Sprint 17 — paper:backtest:research:bundle / :status
//   Package a PAPER-only research run into ONE self-describing bundle summary
//   (manifest summary + counts + a deterministic top-level run digest) and a
//   quick directory health/integrity status. Reads local files only; no
//   backtest, no journal, no network, no wallet. The status writes nothing.
// ---------------------------------------------------------------------------

export interface PaperBacktestResearchBundleCommandOptions {
  /** Directory of local research artifacts to bundle (required). */
  dir?: string;
  /** Optional path to write the bundle JSON to (writes nothing without it). */
  outPath?: string;
  /** Overwrite the --out file if it exists (refused by default). */
  force?: boolean;
  json?: boolean;
  /** Exit non-zero if any artifact is unknown/malformed. */
  strict?: boolean;
}

/**
 * `soulmaker paper:backtest:research:bundle` — package the local JSON artifacts under `--dir`
 * into ONE self-describing bundle: a manifest summary, artifact + kind counts, the recognized
 * schema-version set, unknown/malformed counts, the sorted per-artifact digest references, and a
 * deterministic top-level NON-CRYPTOGRAPHIC run digest. It walks real subdirectories (BOM-
 * tolerant, sorted), reads `*.json` only (never `*.jsonl`), skips symlinks, and excludes research
 * meta files (manifest/verify/diff/status/bundle) so a bundle never indexes itself. A malformed
 * file is indexed as `unknown-json` and reported, never a crash. With `--out` it writes ONLY the
 * bundle JSON (refuses to overwrite without `--force`). `--json` prints the bundle; `--strict`
 * exits non-zero when any unknown/malformed artifact is present. Local files only — no backtest,
 * no journal, no network, no wallet. The bundle embeds no artifact contents and is not a live
 * result, not advice, and not a profitability claim.
 */
export function paperBacktestResearchBundleReport(
  ctx: CommandContext = {},
  opts: PaperBacktestResearchBundleCommandOptions = {},
): CliReport {
  if (!opts.dir) return { text: "Refusing: --dir <path> is required.", exitCode: 1 };

  const resolved = resolveArtifactDir(ctx, opts.dir, "artifact");
  if (!resolved.ok) return { text: redactString(`Refusing: ${resolved.reason}`), exitCode: 1 };

  const { descriptors, malformed } = collectArtifactDescriptors(resolved.dir);

  let bundle: BacktestResearchBundle;
  try {
    bundle = buildBacktestResearchBundle({
      runName: basename(resolved.dir),
      artifacts: descriptors,
      malformedPaths: malformed,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // Write the bundle only when --out is given; refuse to overwrite without --force.
  let writtenNote = "";
  if (opts.outPath) {
    const outPath = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(outPath)) {
      return {
        text: redactString(`Refusing: ${outPath} already exists (pass --force to overwrite).`),
        exitCode: 1,
      };
    }
    try {
      writeFileSync(outPath, JSON.stringify(redactValue(bundle), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write bundle to ${outPath}`), exitCode: 1 };
    }
    writtenNote = `\n\nWrote bundle to ${outPath}`;
  }

  const exitCode =
    opts.strict && (bundle.unknownArtifactCount > 0 || bundle.malformedArtifactCount > 0) ? 1 : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(bundle), null, 2), exitCode };
  }
  const malformedNote =
    malformed.length > 0
      ? `\n\nMalformed (unparseable) JSON file(s), indexed as unknown-json:\n` +
        malformed.map((p) => `- ${p}`).join("\n")
      : "";
  return {
    text: redactString(
      formatBacktestResearchBundle(bundle, { label: opts.dir }) + malformedNote + writtenNote,
    ),
    exitCode,
  };
}

/** Read-only: load a manifest JSON from the run dir by its conventional name, or null. */
function discoverResearchManifest(dir: string): unknown {
  const candidate = join(dir, "research-manifest.json");
  if (!existsSync(candidate)) return null;
  try {
    return JSON.parse(stripJsonBom(readFileSync(candidate, "utf8")));
  } catch {
    return null; // a malformed discovered manifest is ignored (status reports "no manifest")
  }
}

export interface PaperBacktestResearchStatusCommandOptions {
  /** Directory of current local research artifacts to summarize (required). */
  dir?: string;
  /** Optional manifest JSON to check the directory against (else a conventional one is discovered). */
  manifestPath?: string;
  json?: boolean;
  /** Exit non-zero when unknown/malformed/drift/invalid conditions exist. */
  strict?: boolean;
}

/**
 * `soulmaker paper:backtest:research:status` — summarize a research directory's health at a
 * glance: COMPLETE (has artifacts), RECOGNIZED (every file classified), STABLE (no unparseable
 * files), and IN SYNC (matches a recorded manifest, if one is provided via `--manifest` or
 * discovered as `research-manifest.json` in the dir). Reports kinds/schemas present, unknown +
 * malformed counts, a bundle-candidate validity check, manifest drift (missing/extra/changed),
 * and a single NEUTRAL recommended action (operational, never trading advice). It reads local
 * files only and WRITES NOTHING. `--json` emits the stable, redacted status. `--strict` exits
 * non-zero when any unknown/malformed/drift/invalid condition exists. No backtest, no journal,
 * no network, no wallet.
 */
export function paperBacktestResearchStatusReport(
  ctx: CommandContext = {},
  opts: PaperBacktestResearchStatusCommandOptions = {},
): CliReport {
  if (!opts.dir) return { text: "Refusing: --dir <path> is required.", exitCode: 1 };

  const resolved = resolveArtifactDir(ctx, opts.dir, "artifact");
  if (!resolved.ok) return { text: redactString(`Refusing: ${resolved.reason}`), exitCode: 1 };

  // Load a manifest to check against: explicit --manifest wins; else discover a conventional one.
  let manifestValue: unknown = null;
  if (opts.manifestPath) {
    try {
      manifestValue = readJsonValue(ctx, opts.manifestPath, "manifest");
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
  } else {
    manifestValue = discoverResearchManifest(resolved.dir);
  }

  const { descriptors, malformed } = collectArtifactDescriptors(resolved.dir);

  let status: BacktestResearchStatus;
  try {
    status = buildBacktestResearchStatus({
      runName: basename(resolved.dir),
      artifacts: descriptors,
      malformedPaths: malformed,
      manifest: manifestValue,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  const driftPresent = status.manifest.present && !status.manifest.inSync;
  const unsafe =
    status.unknownArtifactCount > 0 ||
    status.malformedArtifactCount > 0 ||
    driftPresent ||
    !status.bundleCandidateValid;
  const exitCode = opts.strict && unsafe ? 1 : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(status), null, 2), exitCode };
  }
  return { text: redactString(formatBacktestResearchStatus(status, { label: opts.dir })), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 18 — paper:backtest:research:index
//   Index MANY research runs living side-by-side under a campaign directory
//   into ONE comparable campaign-level summary (per-run digests + health +
//   aggregate kinds/schemas + a deterministic top-level campaign digest).
//   Reads local files only; no backtest, no journal, no network, no wallet.
// ---------------------------------------------------------------------------

/**
 * Deterministically list the IMMEDIATE child directories of `campaignDir` (each a candidate
 * research run), as plain names sorted ascending. Symlinks are skipped (never followed out of the
 * tree) and hidden dot-directories (e.g. `.git`, `.tmp`) are excluded. Only real subdirectories
 * are returned — top-level files (including a campaign index written here) are never treated as a
 * run. Read-only.
 */
function listRunDirectories(campaignDir: string): string[] {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(campaignDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // deterministic; never follow a link out of the tree
    if (!entry.isDirectory()) continue; // only immediate child directories are candidate runs
    if (entry.name.startsWith(".")) continue; // skip hidden/dot directories
    dirs.push(entry.name);
  }
  return dirs.sort();
}

export interface PaperBacktestResearchIndexCommandOptions {
  /** Campaign directory whose immediate child directories are research runs (required). */
  dir?: string;
  /** Optional path to write the campaign index JSON to (writes nothing without it). */
  outPath?: string;
  /** Overwrite the --out file if it exists (refused by default). */
  force?: boolean;
  json?: boolean;
  /** Exit non-zero if any run needs attention (unknown/malformed/drift/invalid/incomplete). */
  strict?: boolean;
}

/**
 * `soulmaker paper:backtest:research:index` — index a CAMPAIGN directory of research runs. Each
 * IMMEDIATE child directory of `--dir` is treated as a run: its local `*.json` artifacts are
 * walked (recursing real subdirs, BOM-tolerant, sorted; never `*.jsonl`; symlinks skipped; research
 * meta files excluded), classified, and digested, and a conventional `research-manifest.json` (if
 * present) is loaded to detect drift. The command then summarizes every run — run digest, artifact
 * + kind + schema counts, unknown/malformed totals, and complete/recognized/stable/in-sync health —
 * aggregates the kind/schema sets across the campaign, lists the runs needing attention, and emits a
 * deterministic top-level NON-CRYPTOGRAPHIC campaign digest. With `--out` it writes ONLY the
 * campaign index JSON (refuses to overwrite without `--force`). `--json` prints the index; `--strict`
 * exits non-zero when any run needs attention. Local files only — no backtest, no journal, no
 * network, no wallet. The index embeds no artifact contents and is not a live result, not advice,
 * and not a profitability claim.
 */
export function paperBacktestResearchIndexReport(
  ctx: CommandContext = {},
  opts: PaperBacktestResearchIndexCommandOptions = {},
): CliReport {
  if (!opts.dir) return { text: "Refusing: --dir <path> is required.", exitCode: 1 };

  const resolved = resolveArtifactDir(ctx, opts.dir, "campaign");
  if (!resolved.ok) return { text: redactString(`Refusing: ${resolved.reason}`), exitCode: 1 };

  // Each immediate child directory is a candidate run; assemble its already-loaded descriptors.
  const runs: BacktestResearchCampaignRunInput[] = listRunDirectories(resolved.dir).map((name) => {
    const runDir = join(resolved.dir, name);
    const { descriptors, malformed } = collectArtifactDescriptors(runDir);
    const manifest = discoverResearchManifest(runDir);
    return { runId: name, artifacts: descriptors, malformedPaths: malformed, manifest };
  });

  let index: BacktestResearchCampaignIndex;
  try {
    index = buildBacktestResearchCampaignIndex({ campaignName: basename(resolved.dir), runs });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // Write the campaign index only when --out is given; refuse to overwrite without --force.
  let writtenNote = "";
  if (opts.outPath) {
    const outPath = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(outPath)) {
      return {
        text: redactString(`Refusing: ${outPath} already exists (pass --force to overwrite).`),
        exitCode: 1,
      };
    }
    try {
      writeFileSync(outPath, JSON.stringify(redactValue(index), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write campaign index to ${outPath}`), exitCode: 1 };
    }
    writtenNote = `\n\nWrote campaign index to ${outPath}`;
  }

  const exitCode = opts.strict && index.invalidRunCount > 0 ? 1 : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(index), null, 2), exitCode };
  }
  return {
    text: redactString(formatBacktestResearchCampaignIndex(index, { label: opts.dir }) + writtenNote),
    exitCode,
  };
}

// ---------------------------------------------------------------------------
// Sprint 19 — paper:backtest:diff:research:bundle / :index
//   Diff two LOCAL research bundle / campaign index JSON files. Reads ONLY the
//   two named files, runs no backtest, and writes nothing. Both expose a
//   conservative regression flag distinct from "any change". No network, no
//   wallet.
// ---------------------------------------------------------------------------

export interface PaperBacktestDiffResearchBundleCommandOptions {
  /** Path to the BASE bundle JSON (required). */
  basePath?: string;
  /** Path to the NEXT bundle JSON (required). */
  nextPath?: string;
  json?: boolean;
  /** Exit non-zero when the diff reports any change. */
  failOnChange?: boolean;
  /** Exit non-zero only on a conservative integrity regression. */
  failOnRegression?: boolean;
}

/**
 * `soulmaker paper:backtest:diff:research:bundle` — diff TWO research bundle JSON files. Reads
 * ONLY the two named local files (BOM-tolerant; a missing/malformed/non-bundle file refuses),
 * runs no backtest, and writes nothing. It pairs artifacts by path and reports added/removed/
 * digest-changed, the top-level run-digest change, aggregate kind/schema/recognized-schema
 * changes, and unknown/malformed/warning/count deltas, with a `hasChange` flag and a CONSERVATIVE
 * `hasRegression` flag (integrity breakage only). `--json` emits the stable, redacted diff;
 * `--fail-on-change` exits non-zero when anything changed; `--fail-on-regression` exits non-zero
 * only on a regression. No network, no wallet.
 */
export function paperBacktestDiffResearchBundleReport(
  ctx: CommandContext = {},
  opts: PaperBacktestDiffResearchBundleCommandOptions = {},
): CliReport {
  if (!opts.basePath) return { text: "Refusing: --base <path> is required.", exitCode: 1 };
  if (!opts.nextPath) return { text: "Refusing: --next <path> is required.", exitCode: 1 };

  let baseValue: unknown;
  try {
    baseValue = readJsonValue(ctx, opts.basePath, "base bundle");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let nextValue: unknown;
  try {
    nextValue = readJsonValue(ctx, opts.nextPath, "next bundle");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let diff: BacktestResearchBundleDiff;
  try {
    diff = diffBacktestResearchBundles(baseValue, nextValue);
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  const exitCode =
    (opts.failOnChange && diff.hasChange) || (opts.failOnRegression && diff.hasRegression) ? 1 : 0;
  if (opts.json) {
    return { text: JSON.stringify(redactValue(diff), null, 2), exitCode };
  }
  return {
    text: formatBacktestResearchBundleDiff(diff, { baseLabel: opts.basePath, nextLabel: opts.nextPath }),
    exitCode,
  };
}

export interface PaperBacktestDiffResearchIndexCommandOptions {
  /** Path to the BASE campaign index JSON (required). */
  basePath?: string;
  /** Path to the NEXT campaign index JSON (required). */
  nextPath?: string;
  json?: boolean;
  /** Exit non-zero when the diff reports any change. */
  failOnChange?: boolean;
  /** Exit non-zero only on a conservative integrity regression. */
  failOnRegression?: boolean;
}

/**
 * `soulmaker paper:backtest:diff:research:index` — diff TWO campaign index JSON files. Reads ONLY
 * the two named local files (BOM-tolerant; a missing/malformed/non-index file refuses), runs no
 * backtest, and writes nothing. It pairs runs by runId and reports runs added/removed, per-run
 * digest / valid-status / unknown-malformed changes, the runs newly needing (or no longer
 * needing) attention, the top-level campaign-digest change, aggregate kind/schema changes, and
 * run/artifact count deltas, with a `hasChange` flag and a CONSERVATIVE `hasRegression` flag
 * (removed valid run / valid→invalid / unexpected run-digest change / unknown-malformed increase /
 * incompatible schema). `--json` emits the stable, redacted diff; `--fail-on-change` exits
 * non-zero when anything changed; `--fail-on-regression` exits non-zero only on a regression. No
 * network, no wallet.
 */
export function paperBacktestDiffResearchIndexReport(
  ctx: CommandContext = {},
  opts: PaperBacktestDiffResearchIndexCommandOptions = {},
): CliReport {
  if (!opts.basePath) return { text: "Refusing: --base <path> is required.", exitCode: 1 };
  if (!opts.nextPath) return { text: "Refusing: --next <path> is required.", exitCode: 1 };

  let baseValue: unknown;
  try {
    baseValue = readJsonValue(ctx, opts.basePath, "base campaign index");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let nextValue: unknown;
  try {
    nextValue = readJsonValue(ctx, opts.nextPath, "next campaign index");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let diff: BacktestResearchCampaignIndexDiff;
  try {
    diff = diffBacktestResearchCampaignIndexes(baseValue, nextValue);
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  const exitCode =
    (opts.failOnChange && diff.hasChange) || (opts.failOnRegression && diff.hasRegression) ? 1 : 0;
  if (opts.json) {
    return { text: JSON.stringify(redactValue(diff), null, 2), exitCode };
  }
  return {
    text: formatBacktestResearchCampaignIndexDiff(diff, { baseLabel: opts.basePath, nextLabel: opts.nextPath }),
    exitCode,
  };
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}
