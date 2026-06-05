/**
 * Pure command implementations. Each returns a string report and performs NO
 * side effects beyond reading config/env (and, for the Solana commands, issuing
 * read-only RPC reads through an injectable client). This keeps them testable
 * and offline in unit tests.
 *
 * Every command is read-only. None of them can build, sign, or send a
 * transaction — the CLI in this phase cannot move funds by construction.
 */

import { readFileSync } from "node:fs";
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

/** `soulmaker paper:status` — paper-trading engine status (Phase 4 stub). */
export function paperStatusReport(ctx: CommandContext = {}): string {
  const config = loadConfig(toLoadOptions(ctx));
  return [
    "Paper trading status",
    "--------------------",
    `mode:            ${config.mode}`,
    `open positions:  0`,
    `realized PnL:    0 SOL`,
    `journal entries: 0`,
    "",
    "Note: the paper trading engine is not implemented yet (Phase 4).",
    "This command is a wired stub so the surface is testable today.",
  ].join("\n");
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

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}
