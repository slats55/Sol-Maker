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
import { createHash } from "node:crypto";
import { basename, isAbsolute, join, normalize } from "node:path";
import {
  loadConfig,
  evaluateLiveGate,
  evaluateQuoteFreshness,
  describeMode,
  capabilitiesFor,
  ConfigError,
  type Config,
  type LoadConfigOptions,
  type QuoteFreshnessResult,
} from "@soulmaker/core";
import { redactValue, redactString, isSensitiveKey } from "@soulmaker/security";
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
  buildSimulationIntentPlanV2,
  validateSimulationIntentPlanV2,
  formatSimulationIntentPlanV2,
  buildSimulationResultV1,
  validateSimulationResultV1,
  formatSimulationResultV1,
  diffSimulationIntentPlansV2,
  formatSimulationIntentPlanDiffV2,
  diffSimulationResultsV1,
  formatSimulationResultDiffV1,
  buildPhase6AuditReportV1,
  formatPhase6AuditReportV1,
  buildPhase6SimulationReadinessReportV1,
  formatPhase6SimulationReadinessReportV1,
  buildPhase6SimulationHandoffPackV1,
  formatPhase6SimulationHandoffPackV1,
  buildSimulationRouteResolutionV1,
  formatSimulationRouteResolutionV1,
  buildPhase6OperatorBundleV1,
  formatPhase6OperatorBundleV1,
  PHASE6_READINESS_EVIDENCE_AREAS,
  SIMULATION_INTENT_PLAN_V2_SCHEMA_VERSION,
  SIMULATION_RESULT_V1_SCHEMA_VERSION,
  type SimulationIntentPlanV2,
  type SimulationResultV1,
  type SimulationIntentPlanDiffV2,
  type SimulationResultDiffV1,
  type Phase6AuditReportV1,
  type Phase6ReadinessEvidenceArea,
  type Phase6SimulationReadinessReportV1,
  type Phase6SimulationHandoffPackV1,
  type SimulationRouteResolutionV1,
  type SimulationRouteFactsInput,
  type Phase6OperatorBundleV1,
  type Phase6OperatorBundleRole,
} from "@soulmaker/simulation";
import {
  ROUTE_QUOTE_OBSERVATION_INPUT_SCHEMA_VERSION,
  ROUTE_QUOTE_PREPARED_SCHEMA_VERSION,
  normalizeRouteQuotePrepared,
  validateRouteQuotePrepared,
  toRouteQuoteFacts,
  formatRouteQuotePrepared,
  type RouteQuotePrepared,
} from "@soulmaker/routequote";
import {
  createJupiterQuoteAdapter,
  fetchQuotesForCandidates,
  formatRouteQuoteFetchReport,
  type QuoteProviderAdapter,
  type JupiterQuoteAdapterOptions,
  type RouteQuoteFetchReport,
} from "@soulmaker/quotefetch";
import {
  createJupiterRecentAdapter,
  createReplayCandidateAdapter,
  buildRealtimeCandidatesSnapshot,
  formatRealtimeCandidatesSnapshot,
  type CandidateSourceAdapter,
  type JupiterRecentAdapterOptions,
  type RealtimeCandidatesSnapshot,
} from "@soulmaker/realtime";
import {
  createTxPreviewRpc,
  simulateUnsignedEnvelope,
  formatTxSimulationReport,
  validateUnsignedTxEnvelope,
  TxPreviewError,
  type TxPreviewRpc,
  type TxSimulationReport,
} from "@soulmaker/txpreview";
import {
  createJupiterSwapBuilder,
  type SwapTransactionBuilder,
  type JupiterSwapBuilderOptions,
} from "@soulmaker/txbuilder";
import {
  resolveExecutionMode,
  evaluateMainnetLiveGate,
  loadLocalSignerBoundary,
  createThrowawayDevnetSigner,
  loadThrowawayDevnetSigner,
  attemptExecution,
  createSendRpc,
  createRehearsalRpc,
  runDevnetRehearsal,
  SignerBoundaryError,
  LIVE_TRADING_ENV_FLAG,
  DEVNET_EXECUTION_ENV_FLAG,
  DEVNET_EXECUTION_ENV_VALUE,
  DEVNET_REHEARSAL_MAX_AIRDROP_ATTEMPTS,
  type ResolvedExecutionMode,
  type OperatorSafetyControls,
  type SendRpc,
  type RehearsalRpc,
  type RehearsalSignerSource,
  type TransactionSigningBoundary,
  type DevnetRehearsalReport,
} from "@soulmaker/execution";
import {
  parseMintAddress,
  normalizeSniperCandidateList,
  formatSniperCandidateList,
  buildSniperTokenPreflightReport,
  formatSniperTokenPreflightReport,
  normalizeSniperPreflightInput,
  formatSniperPreflightInput,
  SNIPER_PREFLIGHT_INPUT_SCHEMA_VERSION,
  buildPaperSniperDecisionReport,
  formatPaperSniperDecisionReport,
  buildPaperSniperDecisionReportV2,
  formatPaperSniperDecisionReportV2,
  validateSniperTokenPreflightReport,
  validatePaperSniperDecisionReport,
  buildSniperWorkflowPlan,
  formatSniperWorkflowPlan,
  buildSniperRunReport,
  formatSniperRunReport,
  buildSniperRunReportV2,
  formatSniperRunReportV2,
  diffSniperRunReports,
  formatSniperRunReportDiff,
  diffSniperRunReportsV2,
  formatSniperRunReportDiffV2,
  normalizeSniperPolicyConfig,
  formatSniperPolicyConfig,
  deriveSniperDecisionRules,
  enforceSniperPolicy,
  normalizeSniperPolicyConfigV2,
  formatSniperPolicyConfigV2,
  upgradeSniperPolicyConfigV1ToV2,
  SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION,
  buildSniperAuditLog,
  formatSniperAuditLog,
  buildSniperSessionPack,
  formatSniperSessionPack,
  buildSniperSessionPackV2,
  formatSniperSessionPackV2,
  buildSniperSafetyGatesReport,
  formatSniperSafetyGatesReport,
  buildSniperSafetyGatesReportV2,
  formatSniperSafetyGatesReportV2,
  buildPhase6PrerequisiteReport,
  formatPhase6PrerequisiteReport,
  buildPhase6PrerequisiteReportV2,
  formatPhase6PrerequisiteReportV2,
  buildSniperKillSwitchSpec,
  formatSniperKillSwitchSpec,
  SNIPER_KILL_SWITCH_SPEC_SCHEMA_VERSION,
  buildSniperSecretsPolicy,
  formatSniperSecretsPolicy,
  SNIPER_SECRETS_POLICY_SCHEMA_VERSION,
  buildSniperBurnerIsolationSpec,
  formatSniperBurnerIsolationSpec,
  SNIPER_BURNER_ISOLATION_SPEC_SCHEMA_VERSION,
  buildSimulationIntentPlan,
  formatSimulationIntentPlan,
  diffSimulationIntentPlans,
  formatSimulationIntentPlanDiff,
  SNIPER_CANDIDATE_LIST_SCHEMA_VERSION,
  SNIPER_POLICY_CONFIG_SCHEMA_VERSION,
  type SniperCandidateList,
  type SniperTokenPreflightReport,
  type SniperPreflightCandidateData,
  type SniperPreflightInput,
  type SniperPaperDecisionReport,
  type SniperPaperDecisionReportV2,
  type SniperDecisionRules,
  type SniperWorkflowStageState,
  type SniperRunReport,
  type SniperRunReportV2,
  type SniperRunReportDiff,
  type SniperRunReportDiffV2,
  type SniperPolicyConfig,
  type SniperPolicyConfigV2,
  type SniperAuditLog,
  type SniperSessionPack,
  type SniperSessionPackV2,
  type SniperSessionPackArtifactInput,
  type SniperSafetyGatesReport,
  type SniperSafetyGatesReportV2,
  type Phase6PrerequisiteReport,
  type Phase6PrerequisiteReportV2,
  type SniperKillSwitchSpec,
  type SniperSecretsPolicy,
  type SniperBurnerIsolationSpec,
  type SimulationIntentPlan,
  type SimulationIntentPlanDiff,
} from "@soulmaker/sniper";
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
  buildBacktestResearchCampaignHistoryReport,
  formatBacktestResearchCampaignHistoryReport,
  buildBacktestResearchPortfolioReport,
  formatBacktestResearchPortfolioReport,
  diffBacktestResearchPortfolioReports,
  formatBacktestResearchPortfolioDiff,
  buildBacktestResearchArtifactPack,
  formatBacktestResearchArtifactPack,
  diffBacktestResearchArtifactPacks,
  formatBacktestResearchArtifactPackDiff,
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
  type BacktestResearchCampaignHistoryReport,
  type BacktestResearchCampaignHistorySnapshotInput,
  type BacktestResearchCampaignHistoryBaselineSelector,
  type BacktestResearchPortfolioReport,
  type BacktestResearchPortfolioCampaignInput,
  type BacktestResearchPortfolioDiff,
  type BacktestResearchArtifactPackInput,
  type BacktestResearchArtifactPack,
  type BacktestResearchArtifactPackDiff,
} from "@soulmaker/backtest";

export interface CommandContext {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  configPath?: string;
  /** Factory for the read-only Solana client; injected in tests to avoid network. */
  createClient?: (config: ReadOnlyClientConfig) => ReadOnlySolanaClient;
  /** Factory for the read-only quote adapter; injected in tests to avoid network. */
  createQuoteAdapter?: (options: JupiterQuoteAdapterOptions) => QuoteProviderAdapter;
  /** Factory for the live candidate source; injected in tests to avoid network. */
  createCandidateSource?: (options: JupiterRecentAdapterOptions) => CandidateSourceAdapter;
  /** Factory for the simulate-only tx preview RPC; injected in tests to avoid network. */
  createTxPreview?: (rpcUrl: string) => TxPreviewRpc;
  /** Factory for the refusal-first swap builder; injected in tests to avoid network. */
  createSwapBuilder?: (options: JupiterSwapBuilderOptions) => SwapTransactionBuilder;
  /** Factory for the send-path RPC; injected in tests to avoid network. */
  createSendRpc?: (rpcUrl: string) => SendRpc;
  /** Factory for the devnet rehearsal RPC (faucet + send seams); injected in tests. */
  createRehearsalRpc?: (rpcUrl: string) => RehearsalRpc;
  /** Injectable sleep for the bounded realtime watch; injected in tests. */
  sleep?: (ms: number) => Promise<void>;
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

export interface TokenInspectCommandOptions extends ChainReadOptions {
  /** Emit the inspection as stable JSON (the shape the sniper preflight bridge consumes). */
  json?: boolean;
  /** Optional path to write ONLY the inspection JSON (UTF-8; refuses overwrite without force). */
  outPath?: string;
  /** Overwrite an existing --out file (refused by default). */
  force?: boolean;
}

/** `soulmaker token:inspect <mint>` — read-only mint inspection. */
export async function tokenInspectReport(
  mint: string,
  ctx: CommandContext = {},
  opts: TokenInspectCommandOptions = {},
): Promise<string> {
  // Fail early on a doomed --out before any chain read happens.
  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`);
    }
  }

  const gate = openChainRead(ctx, opts);
  if (!gate.ok) return redactString(gate.message);

  try {
    const report = await buildTokenInspectReport(gate.client, mint, {
      now: ctx.now,
    });
    // Optional write: ONLY the inspection JSON, UTF-8 (shell redirection on Windows
    // PowerShell writes UTF-16, which downstream JSON readers refuse).
    let wroteLine = "";
    if (opts.outPath) {
      const resolved = resolvePath(ctx, opts.outPath);
      try {
        writeFileSync(resolved, JSON.stringify(redactValue(report), null, 2) + "\n");
      } catch (err) {
        return redactString(
          `Refusing: cannot write inspection JSON at ${resolved}: ${(err as Error).message}`,
        );
      }
      wroteLine = `\nwrote ${resolved}`;
    }
    if (opts.json) {
      return JSON.stringify(redactValue(report), null, 2);
    }
    return formatTokenInspectReport(report) + wroteLine;
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
  /** Optional path to write ONLY the risk report JSON (UTF-8; refuses overwrite without force). */
  outPath?: string;
  /** Overwrite an existing --out file (refused by default). */
  force?: boolean;
  /**
   * Sprint 92: ALSO run the deep read-only checks (holder concentration via
   * getTokenLargestAccounts + Metaplex metadata mutability). A deep check that fails or is
   * unsupported by the RPC seam is reported as an explicit unknown caution — never skipped
   * silently, never assumed safe. Without this flag the report is byte-identical to before.
   */
  deep?: boolean;
  /**
   * Sprint 92: provider-reported price impact percent from a small quote probe
   * (`paper:routequote:fetch` report → `entries[].metadata.priceImpactPct`). Feeds the
   * liquidity-depth flags. Operator-supplied provenance — quoted, never fetched here.
   */
  priceImpactPct?: string;
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
  // Fail early on a doomed --out before any chain read happens.
  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`);
    }
  }

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

  // --price-impact-pct: operator-supplied from a quote probe; must parse as a non-negative number.
  let quotePriceImpactPct: number | undefined;
  if (opts.priceImpactPct !== undefined) {
    const parsed = Number(opts.priceImpactPct);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return "Refusing: --price-impact-pct must be a non-negative number (from a quote probe's priceImpactPct).";
    }
    quotePriceImpactPct = parsed;
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

    // Sprint 92 deep checks: per-check isolation — one failing read becomes an explicit
    // unknown caution (the *Available:false form), never an abort and never a silent pass.
    if (opts.deep) {
      if (typeof gate.client.getTokenHolderConcentration === "function") {
        try {
          const holders = await gate.client.getTokenHolderConcentration(mint);
          input.holderDataAvailable = true;
          input.topHolderPct = holders.top1Pct;
          input.top5HolderPct = holders.top5Pct;
        } catch {
          input.holderDataAvailable = false;
        }
      } else {
        input.holderDataAvailable = false;
      }
      if (typeof gate.client.getTokenMetadataInfo === "function") {
        try {
          const metadata = await gate.client.getTokenMetadataInfo(mint);
          if (metadata.metadataAccountFound && metadata.isMutable !== null) {
            input.metadataAvailable = true;
            input.metadataMutable = metadata.isMutable;
          } else {
            input.metadataAvailable = false;
          }
        } catch {
          input.metadataAvailable = false;
        }
      } else {
        input.metadataAvailable = false;
      }
      // S93: Token-2022 extension facts ride on the SAME jsonParsed inspection read. A seam
      // that did not parse extensions on a Token-2022 mint is an honest unknown caution; a
      // classic mint is not-applicable (extensions cannot exist there).
      if (inspection.token2022Extensions !== undefined) {
        input.token2022 = inspection.token2022Extensions;
      } else if (inspection.programLabel === "spl-token-2022") {
        input.token2022 = { status: "unavailable" };
      } else {
        input.token2022 = { status: "not-applicable" };
      }
    }
    if (quotePriceImpactPct !== undefined) {
      input.quotePriceImpactPct = quotePriceImpactPct;
    }

    const report = buildTokenRiskReport(input, { now: ctx.now });
    // Optional write: ONLY the risk report JSON, UTF-8 (shell redirection on Windows
    // PowerShell writes UTF-16, which downstream JSON readers refuse).
    let wroteLine = "";
    if (opts.outPath) {
      const resolved = resolvePath(ctx, opts.outPath);
      try {
        writeFileSync(resolved, JSON.stringify(redactValue(report), null, 2) + "\n");
      } catch (err) {
        return redactString(
          `Refusing: cannot write risk report JSON at ${resolved}: ${(err as Error).message}`,
        );
      }
      wroteLine = `\nwrote ${resolved}`;
    }
    if (opts.json) {
      // redactValue is a backstop; the report carries only public data.
      return JSON.stringify(redactValue(report), null, 2);
    }
    return formatTokenRiskReport(report) + wroteLine;
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
  // normalize() collapses doubled separators some shells/wrappers inject into absolute paths.
  return isAbsolute(path) ? normalize(path) : join(base, path);
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

// ---------------------------------------------------------------------------
// Sprint 20 — paper:backtest:research:history
//   Fold an ORDERED set of campaign index JSON snapshots into one deterministic
//   trend report: which runs appeared/disappeared/changed/regressed/recovered,
//   per-run valid + attention streaks, and a CONSERVATIVE regression signal
//   (reusing the Sprint 19 diff semantics) suitable for CI. Reads the named
//   files only, runs no backtest, and writes nothing. No network, no wallet.
// ---------------------------------------------------------------------------

export interface PaperBacktestResearchHistoryCommandOptions {
  /** Ordered campaign index JSON paths (repeatable; oldest first, latest last). Required (>=1). */
  indexPaths?: string[];
  json?: boolean;
  /** Exit non-zero when there is any change since baseline. */
  failOnChange?: boolean;
  /** Exit non-zero only on a conservative integrity regression since baseline. */
  failOnRegression?: boolean;
  /** Exit non-zero when any run currently needs attention. */
  failOnAttention?: boolean;
  /** Exit non-zero when any run newly needs attention since baseline. */
  failOnNewAttention?: boolean;
  /** Baseline for the "since baseline" deltas: "first" (default), "previous", or a supplied path. */
  baseline?: string;
}

/**
 * `soulmaker paper:backtest:research:history` — fold an ORDERED set of campaign index JSON files
 * into one deterministic history/trend report. Reads ONLY the named local files in the given order
 * (oldest first, latest last; BOM-tolerant; a missing/malformed/non-index/wrong-schema file
 * refuses), runs no backtest, and writes nothing. It walks each run's trajectory across the
 * snapshots — first/last seen, present/valid/attention now, ever-needed-attention, current valid +
 * attention streaks, and digest-change count — and REUSES the Sprint 19 campaign diff for the
 * "since baseline" / "since previous snapshot" deltas, so `hasChange` and the CONSERVATIVE
 * `hasRegression` are byte-identical to the diff. `--baseline first|previous|<path>` chooses the
 * reference snapshot (default `first`). `--json` emits the stable, redacted report; the
 * `--fail-on-*` flags set a non-zero exit for change / regression / current attention / new
 * attention. No network, no wallet. The report embeds no artifact contents and is not a live
 * result, advice, or a profitability claim.
 */
export function paperBacktestResearchHistoryReport(
  ctx: CommandContext = {},
  opts: PaperBacktestResearchHistoryCommandOptions = {},
): CliReport {
  const paths = opts.indexPaths ?? [];
  if (paths.length === 0) {
    return { text: "Refusing: at least one --index <path> is required.", exitCode: 1 };
  }

  // Read each campaign index file in order; the snapshot id is the path as supplied on the CLI.
  const snapshots: BacktestResearchCampaignHistorySnapshotInput[] = [];
  for (const path of paths) {
    let value: unknown;
    try {
      value = readJsonValue(ctx, path, "campaign index");
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    snapshots.push({ snapshotId: path, index: value });
  }

  // Baseline selector: "first" (default) / "previous" / an explicit supplied path (== a snapshot id).
  let baseline: BacktestResearchCampaignHistoryBaselineSelector;
  if (opts.baseline === undefined || opts.baseline === "first") baseline = "first";
  else if (opts.baseline === "previous") baseline = "previous";
  else baseline = { snapshotId: opts.baseline };

  let report: BacktestResearchCampaignHistoryReport;
  try {
    report = buildBacktestResearchCampaignHistoryReport({ snapshots, baseline });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  const exitCode =
    (opts.failOnChange && report.hasChange) ||
    (opts.failOnRegression && report.hasRegression) ||
    (opts.failOnAttention && report.hasAttention) ||
    (opts.failOnNewAttention && report.hasNewAttentionSinceBaseline)
      ? 1
      : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(report), null, 2), exitCode };
  }
  return { text: formatBacktestResearchCampaignHistoryReport(report), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 21 — paper:backtest:research:portfolio
//   Roll up MANY campaign history reports — one per campaign — into a single
//   deterministic, PAPER-only integrity-triage portfolio view: which campaigns
//   need attention / regressed / changed / are clean, the top concerns, and a
//   CI decision. Reads the named files only, runs no backtest, and writes
//   nothing. No network, no wallet.
// ---------------------------------------------------------------------------

export interface PaperBacktestResearchPortfolioCommandOptions {
  /** Repeatable "campaignId=path" specs (one per campaign history report). Required (>=1). */
  histories?: string[];
  json?: boolean;
  /** Exit non-zero when any campaign changed since baseline. */
  failOnChange?: boolean;
  /** Exit non-zero only on a conservative integrity regression in any campaign. */
  failOnRegression?: boolean;
  /** Exit non-zero when any campaign currently needs attention. */
  failOnAttention?: boolean;
  /** Exit non-zero when any campaign newly needs attention since baseline. */
  failOnNewAttention?: boolean;
}

/** Split a `--history campaignId=path` spec on its FIRST `=` (paths may contain `=`). */
function parsePortfolioHistoryArg(spec: string): { campaignId: string; path: string } | null {
  const eq = spec.indexOf("=");
  if (eq <= 0 || eq === spec.length - 1) return null;
  return { campaignId: spec.slice(0, eq), path: spec.slice(eq + 1) };
}

/**
 * `soulmaker paper:backtest:research:portfolio` — roll up MANY campaign history report JSON files
 * into one deterministic portfolio report. Reads ONLY the named local files (BOM-tolerant; a
 * missing/malformed/non-history/wrong-schema file refuses), runs no backtest, and writes nothing.
 * Each `--history campaignId=path` names one campaign; every per-campaign signal is carried verbatim
 * from its history report, the per-campaign rollup is emitted in integrity-triage order
 * (most-concerning first), and the `--fail-on-*` flags set a non-zero exit for change / regression /
 * current attention / new attention across the portfolio. A bad spec, a duplicate campaignId, or
 * zero histories refuses with exit 1. No network, no wallet. The report embeds no artifact contents
 * and is not a live result, advice, or a profitability claim.
 */
export function paperBacktestResearchPortfolioReport(
  ctx: CommandContext = {},
  opts: PaperBacktestResearchPortfolioCommandOptions = {},
): CliReport {
  const specs = opts.histories ?? [];
  if (specs.length === 0) {
    return { text: "Refusing: at least one --history <campaignId=path> is required.", exitCode: 1 };
  }

  // Read each campaign history report file; the campaignId is the key supplied on the CLI, and the
  // path is recorded as the campaign's sourceLabel. Duplicate-id detection is left to the builder.
  const campaigns: BacktestResearchPortfolioCampaignInput[] = [];
  for (const spec of specs) {
    const parsed = parsePortfolioHistoryArg(spec);
    if (!parsed) {
      return {
        text: redactString(`Refusing: --history must be "campaignId=path" (got "${spec}").`),
        exitCode: 1,
      };
    }
    let value: unknown;
    try {
      value = readJsonValue(ctx, parsed.path, `campaign history report (${parsed.campaignId})`);
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    campaigns.push({ campaignId: parsed.campaignId, report: value, sourceLabel: parsed.path });
  }

  let report: BacktestResearchPortfolioReport;
  try {
    report = buildBacktestResearchPortfolioReport({ campaigns });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  const exitCode =
    (opts.failOnChange && report.hasChange) ||
    (opts.failOnRegression && report.hasRegression) ||
    (opts.failOnAttention && report.hasAttention) ||
    (opts.failOnNewAttention && report.hasNewAttentionSinceBaseline)
      ? 1
      : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(report), null, 2), exitCode };
  }
  return { text: formatBacktestResearchPortfolioReport(report), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 22 — paper:backtest:diff:research:portfolio
//   Deterministically diff TWO portfolio report JSON files: which campaigns
//   appeared / disappeared / changed / newly-regressed / recovered / newly-need
//   attention, the aggregate count deltas, and a CONSERVATIVE regression flag
//   suitable for CI. Reads the two named files only, runs no backtest, and
//   writes nothing. No network, no wallet.
// ---------------------------------------------------------------------------

export interface PaperBacktestDiffResearchPortfolioCommandOptions {
  /** BASE portfolio report JSON path (the reference). Required. */
  basePath?: string;
  /** NEXT portfolio report JSON path (compared against base). Required. */
  nextPath?: string;
  json?: boolean;
  /** Exit non-zero when the diff reports any change. */
  failOnChange?: boolean;
  /** Exit non-zero only on a conservative integrity regression (a common campaign newly regressed). */
  failOnRegression?: boolean;
  /** Exit non-zero when current attention newly appeared on a common campaign. */
  failOnAttention?: boolean;
  /** Exit non-zero when newly-needed-since-baseline attention newly appeared on a common campaign. */
  failOnNewAttention?: boolean;
}

/**
 * `soulmaker paper:backtest:diff:research:portfolio` — deterministically diff TWO portfolio report
 * JSON files. Reads ONLY the two named local files (BOM-tolerant; a missing/malformed/non-portfolio/
 * wrong-schema file refuses), runs no backtest, and writes nothing. Campaigns are paired by
 * campaignId (added / removed / common); status transitions (newly-regressed / recovered /
 * newly-attention / newly-clean / newly-stable) are computed over the common set, while
 * appeared/disappeared campaigns are reported as a campaign-set change. `--json` emits the stable,
 * redacted diff; the `--fail-on-*` flags set a non-zero exit for change / conservative regression /
 * current attention / new attention. No network, no wallet. The diff embeds no artifact contents and
 * is not a live result, advice, or a profitability claim.
 */
export function paperBacktestDiffResearchPortfolioReport(
  ctx: CommandContext = {},
  opts: PaperBacktestDiffResearchPortfolioCommandOptions = {},
): CliReport {
  if (!opts.basePath) return { text: "Refusing: --base <path> is required.", exitCode: 1 };
  if (!opts.nextPath) return { text: "Refusing: --next <path> is required.", exitCode: 1 };

  let baseValue: unknown;
  try {
    baseValue = readJsonValue(ctx, opts.basePath, "base portfolio report");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let nextValue: unknown;
  try {
    nextValue = readJsonValue(ctx, opts.nextPath, "next portfolio report");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let diff: BacktestResearchPortfolioDiff;
  try {
    diff = diffBacktestResearchPortfolioReports(baseValue, nextValue, {
      baseLabel: opts.basePath,
      nextLabel: opts.nextPath,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  const exitCode =
    (opts.failOnChange && diff.hasChange) ||
    (opts.failOnRegression && diff.hasRegression) ||
    (opts.failOnAttention && diff.hasAttention) ||
    (opts.failOnNewAttention && diff.hasNewAttention)
      ? 1
      : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(diff), null, 2), exitCode };
  }
  return {
    text: formatBacktestResearchPortfolioDiff(diff, { baseLabel: opts.basePath, nextLabel: opts.nextPath }),
    exitCode,
  };
}

// ---------------------------------------------------------------------------
// Sprint 23 — paper:backtest:research:pack
//   Collect MANY local research artifact JSON files (manifest / bundle / status
//   / campaign index / campaign diff / campaign history / portfolio report /
//   portfolio diff) into one navigable integrity + navigation summary: each
//   artifact's kind/status/flags, the aggregate counts, chain coverage, and a
//   CI decision. Reads the named files only; writes nothing unless --out is
//   given (then only the pack JSON, refusing overwrite without --force). No
//   network, no wallet.
// ---------------------------------------------------------------------------

export interface PaperBacktestResearchPackCommandOptions {
  /** Repeatable "label=path" specs (one per artifact). Required (>=1). */
  artifacts?: string[];
  json?: boolean;
  /** Exit non-zero when any artifact reports a change. */
  failOnChange?: boolean;
  /** Exit non-zero only on a conservative integrity regression in any artifact. */
  failOnRegression?: boolean;
  /** Exit non-zero when any artifact reports current attention. */
  failOnAttention?: boolean;
  /** Exit non-zero when any artifact reports newly-needed attention. */
  failOnNewAttention?: boolean;
  /** Exit non-zero when any artifact has an unsupported schema. */
  failOnUnsupported?: boolean;
  /** Exit non-zero when a recommended chain layer is missing. */
  failOnMissingRecommendedLayer?: boolean;
  /** Optional path to write the pack JSON (writes nothing if omitted). */
  outPath?: string;
  /** Overwrite an existing --out file (refused by default). */
  force?: boolean;
}

/** Split an `--artifact label=path` spec on its FIRST `=` (paths may contain `=`). */
function parsePackArtifactArg(spec: string): { label: string; path: string } | null {
  const eq = spec.indexOf("=");
  if (eq <= 0 || eq === spec.length - 1) return null;
  return { label: spec.slice(0, eq), path: spec.slice(eq + 1) };
}

/**
 * `soulmaker paper:backtest:research:pack` — collect MANY local research artifact JSON files into one
 * deterministic artifact pack. Reads ONLY the named local files (BOM-tolerant; a missing/malformed
 * file, a bad `label=path` spec, a duplicate label, or an artifact that CLAIMS a known schema but
 * fails validation refuses with exit 1). Each `--artifact label=path` names one artifact; a known
 * schema is strictly validated and summarized, while an unknown schema is reported as `unsupported`
 * (gated by `--fail-on-unsupported`). The `--fail-on-*` flags set a non-zero exit for change /
 * regression / current attention / new attention / an unsupported artifact / a missing recommended
 * layer. `--json` emits the stable, redacted pack. With `--out <path>` it writes ONLY the pack JSON
 * (refusing to overwrite an existing file unless `--force` is given, and creating no directories);
 * without `--out` it writes nothing. No network, no wallet. The pack embeds no artifact contents
 * beyond their own high-level flags and is not a live result, advice, or a profitability claim.
 */
export function paperBacktestResearchPackReport(
  ctx: CommandContext = {},
  opts: PaperBacktestResearchPackCommandOptions = {},
): CliReport {
  const specs = opts.artifacts ?? [];
  if (specs.length === 0) {
    return { text: "Refusing: at least one --artifact <label=path> is required.", exitCode: 1 };
  }

  // Read each artifact file; the label is the key supplied on the CLI, the path is its sourceLabel.
  // Duplicate-label detection is left to the builder.
  const artifacts: BacktestResearchArtifactPackInput[] = [];
  for (const spec of specs) {
    const parsed = parsePackArtifactArg(spec);
    if (!parsed) {
      return { text: redactString(`Refusing: --artifact must be "label=path" (got "${spec}").`), exitCode: 1 };
    }
    let value: unknown;
    try {
      value = readJsonValue(ctx, parsed.path, `research artifact (${parsed.label})`);
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    artifacts.push({ label: parsed.label, value, sourceLabel: parsed.path });
  }

  let pack: BacktestResearchArtifactPack;
  try {
    pack = buildBacktestResearchArtifactPack({ artifacts });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // Optional write: ONLY the pack JSON, refuse overwrite without --force, create no directories.
  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(pack), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write pack file at ${resolved}`), exitCode: 1 };
    }
  }

  const exitCode =
    (opts.failOnChange && pack.hasChange) ||
    (opts.failOnRegression && pack.hasRegression) ||
    (opts.failOnAttention && pack.hasAttention) ||
    (opts.failOnNewAttention && pack.hasNewAttention) ||
    (opts.failOnUnsupported && pack.hasUnsupportedArtifact) ||
    (opts.failOnMissingRecommendedLayer && pack.hasMissingRecommendedLayer)
      ? 1
      : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(pack), null, 2), exitCode };
  }
  return { text: formatBacktestResearchArtifactPack(pack), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 24 — paper:backtest:diff:research:pack
//   Deterministically diff TWO artifact pack JSON files: which artifacts
//   appeared / disappeared / changed / newly-regressed / recovered / newly-need
//   attention / newly-unsupported, the aggregate count deltas, the chain-
//   coverage changes, and a CONSERVATIVE regression flag suitable for CI. Reads
//   the two named files only, runs nothing, and writes nothing. No network, no
//   wallet.
// ---------------------------------------------------------------------------

export interface PaperBacktestDiffResearchPackCommandOptions {
  /** BASE artifact pack JSON path (the reference). Required. */
  basePath?: string;
  /** NEXT artifact pack JSON path (compared against base). Required. */
  nextPath?: string;
  json?: boolean;
  /** Exit non-zero when the diff reports any change. */
  failOnChange?: boolean;
  /** Exit non-zero only on a conservative integrity regression (a common artifact newly regressed). */
  failOnRegression?: boolean;
  /** Exit non-zero when current attention newly appeared on a common artifact. */
  failOnAttention?: boolean;
  /** Exit non-zero when new-attention newly appeared on a common artifact. */
  failOnNewAttention?: boolean;
  /** Exit non-zero when an unsupported artifact is newly present (common lost recognition or added unsupported). */
  failOnUnsupported?: boolean;
}

/**
 * `soulmaker paper:backtest:diff:research:pack` — deterministically diff TWO artifact pack JSON files.
 * Reads ONLY the two named local files (BOM-tolerant; a missing/malformed/non-pack/wrong-schema file
 * refuses), runs nothing, and writes nothing. Artifacts are paired by label (added / removed /
 * common); per-artifact transitions (newly-changed / newly-regressed / recovered / newly-attention /
 * newly-unsupported) are computed over the common set, while appeared/disappeared artifacts are
 * reported as an artifact-set change. `--json` emits the stable, redacted diff; the `--fail-on-*`
 * flags set a non-zero exit for change / conservative regression / current attention / new attention /
 * a newly-present unsupported artifact. No network, no wallet. The diff embeds no artifact contents
 * and is not a live result, advice, or a profitability claim.
 */
export function paperBacktestDiffResearchPackReport(
  ctx: CommandContext = {},
  opts: PaperBacktestDiffResearchPackCommandOptions = {},
): CliReport {
  if (!opts.basePath) return { text: "Refusing: --base <path> is required.", exitCode: 1 };
  if (!opts.nextPath) return { text: "Refusing: --next <path> is required.", exitCode: 1 };

  let baseValue: unknown;
  try {
    baseValue = readJsonValue(ctx, opts.basePath, "base artifact pack");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let nextValue: unknown;
  try {
    nextValue = readJsonValue(ctx, opts.nextPath, "next artifact pack");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let diff: BacktestResearchArtifactPackDiff;
  try {
    diff = diffBacktestResearchArtifactPacks(baseValue, nextValue, {
      baseLabel: opts.basePath,
      nextLabel: opts.nextPath,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  const exitCode =
    (opts.failOnChange && diff.hasChange) ||
    (opts.failOnRegression && diff.hasRegression) ||
    (opts.failOnAttention && diff.hasAttention) ||
    (opts.failOnNewAttention && diff.hasNewAttention) ||
    (opts.failOnUnsupported && diff.hasUnsupported)
      ? 1
      : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(diff), null, 2), exitCode };
  }
  return {
    text: formatBacktestResearchArtifactPackDiff(diff, { baseLabel: opts.basePath, nextLabel: opts.nextPath }),
    exitCode,
  };
}

// ---------------------------------------------------------------------------
// Sprint 25 — paper:sniper:candidates:validate
//   Validate + normalize a LOCAL sniper candidate list (operator intake): every
//   mint is validated as a 32-byte Solana public key (secret-length / private-
//   key-like input is REFUSED), candidate ids must be unique, and duplicate
//   mints are surfaced as warnings. Reads the named file only, writes nothing,
//   no network, no RPC, no wallet. This is intake validation — NOT a trade
//   signal and NOT a verified on-chain fact.
// ---------------------------------------------------------------------------

export interface PaperSniperCandidatesValidateCommandOptions {
  /** Candidate list JSON path (operator intake). Required. */
  inputPath?: string;
  json?: boolean;
  /** Exit non-zero when the normalized list carries any warning (e.g. duplicate mints). */
  failOnWarning?: boolean;
}

/**
 * `soulmaker paper:sniper:candidates:validate` — validate + normalize a LOCAL sniper candidate list.
 * Reads ONLY the named local file (BOM-tolerant). The file may be operator-friendly raw input
 * (`{candidates: [...]}`) or a canonical `sniper.candidate.list.v1`; if it carries a `schemaVersion`,
 * it must be the candidate-list schema (a wrong-schema file is refused so an operator can't point this
 * at, say, a portfolio report). Every mint is validated as a 32-byte Solana public key — secret-length
 * / private-key-like input is refused (exit 1) — candidate ids must be unique, and duplicate mints are
 * surfaced as warnings. `--json` emits the normalized canonical list; `--fail-on-warning` exits 1 on
 * any warning. Writes nothing, no network, no RPC, no wallet.
 */
export function paperSniperCandidatesValidateReport(
  ctx: CommandContext = {},
  opts: PaperSniperCandidatesValidateCommandOptions = {},
): CliReport {
  if (!opts.inputPath) return { text: "Refusing: --input <path> is required.", exitCode: 1 };

  let value: unknown;
  try {
    value = readJsonValue(ctx, opts.inputPath, "sniper candidate list");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  if (!isPlainObject(value)) {
    return { text: "Refusing: candidate list must be a JSON object with a candidates array.", exitCode: 1 };
  }
  // If a schemaVersion is present it must be the candidate-list schema (don't normalize a portfolio
  // report, etc.). An absent schemaVersion is fine — operator-friendly raw input is accepted.
  if (value.schemaVersion !== undefined && value.schemaVersion !== SNIPER_CANDIDATE_LIST_SCHEMA_VERSION) {
    return {
      text: redactString(
        `Refusing: schemaVersion must be "${SNIPER_CANDIDATE_LIST_SCHEMA_VERSION}" (got "${String(value.schemaVersion)}").`,
      ),
      exitCode: 1,
    };
  }

  let list: SniperCandidateList;
  try {
    list = normalizeSniperCandidateList({
      sourceLabel: typeof value.sourceLabel === "string" ? value.sourceLabel : opts.inputPath,
      candidates: (value.candidates ?? []) as never,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  const exitCode = opts.failOnWarning && list.warnings.length > 0 ? 1 : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(list), null, 2), exitCode };
  }
  return { text: formatSniperCandidateList(list, { label: opts.inputPath }), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 26 — paper:sniper:preflight
//   Build a PAPER-only token preflight summary over a LOCAL candidate list plus
//   already-loaded read-only inspection (token:inspect output) + advisory risk
//   (token:risk output) JSON files. Per candidate: pass / warn / fail / unknown,
//   with warnings + disqualifying reasons. LOCAL-ONLY: no RPC, no network, no
//   wallet. Reads the named files only; writes nothing unless --out. This is a
//   safety/research preflight — NOT a trade signal.
// ---------------------------------------------------------------------------

export interface PaperSniperPreflightCommandOptions {
  /** Candidate list JSON path. Required. */
  candidatesPath?: string;
  /** Repeatable "candidateId=path" read-only inspection JSON files (token:inspect output). */
  inspections?: string[];
  /** Repeatable "candidateId=path" advisory risk JSON files (token:risk output). */
  risks?: string[];
  /**
   * Optional validated preflight input artifact (`sniper.preflight.input.v1`, or raw operator input
   * accepted by the validator). Mutually exclusive with --inspection / --risk; its verbatim
   * per-candidate inspection/risk values drive the build.
   */
  preflightInputPath?: string;
  json?: boolean;
  /** Optional path to write the preflight report JSON (writes nothing if omitted). */
  outPath?: string;
  /** Overwrite an existing --out file (refused by default). */
  force?: boolean;
  /** Exit non-zero when any candidate failed preflight. */
  failOnFail?: boolean;
  /** Exit non-zero when any candidate has a preflight warning. */
  failOnWarning?: boolean;
}

/**
 * `soulmaker paper:sniper:preflight` — build a PAPER-only token preflight summary over a LOCAL
 * candidate list plus already-loaded read-only inspection + advisory risk JSON files. Reads ONLY the
 * named local files (BOM-tolerant). `--candidates` is the candidate list (raw operator input or a
 * canonical `sniper.candidate.list.v1`); each `--inspection candidateId=path` / `--risk
 * candidateId=path` supplies that candidate's already-loaded read-only inspection (token:inspect
 * output) / advisory risk (token:risk output). It performs NO on-chain reads itself — there is no RPC,
 * no network, no wallet. Each candidate gets a `pass` / `warn` / `fail` / `unknown` status with
 * warnings + disqualifiers. `--json` emits the report; `--out` writes ONLY the report JSON (refusing
 * overwrite without `--force`, creating no directories); `--fail-on-fail` / `--fail-on-warning` set the
 * exit code. This is a safety/research preflight — NOT a trade signal, not a verified-safe guarantee.
 */
export function paperSniperPreflightReport(
  ctx: CommandContext = {},
  opts: PaperSniperPreflightCommandOptions = {},
): CliReport {
  if (!opts.candidatesPath) return { text: "Refusing: --candidates <path> is required.", exitCode: 1 };
  if (opts.preflightInputPath && ((opts.inspections?.length ?? 0) > 0 || (opts.risks?.length ?? 0) > 0)) {
    return { text: "Refusing: --preflight-input is mutually exclusive with --inspection / --risk.", exitCode: 1 };
  }

  // 1) Read + normalize the candidate list (same wrong-schema guard as the validate command).
  let raw: unknown;
  try {
    raw = readJsonValue(ctx, opts.candidatesPath, "sniper candidate list");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }
  if (!isPlainObject(raw)) {
    return { text: "Refusing: candidate list must be a JSON object with a candidates array.", exitCode: 1 };
  }
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== SNIPER_CANDIDATE_LIST_SCHEMA_VERSION) {
    return {
      text: redactString(`Refusing: candidate list schemaVersion must be "${SNIPER_CANDIDATE_LIST_SCHEMA_VERSION}".`),
      exitCode: 1,
    };
  }
  let list: SniperCandidateList;
  try {
    list = normalizeSniperCandidateList({
      sourceLabel: typeof raw.sourceLabel === "string" ? raw.sourceLabel : opts.candidatesPath,
      candidates: (raw.candidates ?? []) as never,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // 2) Load the optional inspection + risk files, keyed by candidateId.
  const dataById = new Map<string, SniperPreflightCandidateData>();
  const loadInto = (specs: string[] | undefined, kind: "inspection" | "risk"): string | null => {
    for (const spec of specs ?? []) {
      const parsed = parsePackArtifactArg(spec);
      if (!parsed) return `--${kind} must be "candidateId=path" (got "${spec}").`;
      let value: unknown;
      try {
        value = readJsonValue(ctx, parsed.path, `${kind} (${parsed.label})`);
      } catch (err) {
        return (err as Error).message;
      }
      const entry = dataById.get(parsed.label) ?? { candidateId: parsed.label };
      if (kind === "inspection") entry.inspection = value;
      else entry.risk = value;
      dataById.set(parsed.label, entry);
    }
    return null;
  };
  const inspErr = loadInto(opts.inspections, "inspection");
  if (inspErr) return { text: redactString(`Refusing: ${inspErr}`), exitCode: 1 };
  const riskErr = loadInto(opts.risks, "risk");
  if (riskErr) return { text: redactString(`Refusing: ${riskErr}`), exitCode: 1 };

  // 2b) Or: a validated preflight input artifact (Sprint 47). Its verbatim per-candidate values
  //     drive the build; it is normalized + CROSS-CHECKED against the candidate list first, so an
  //     unknown candidateId or a disagreeing mint refuses here instead of failing mid-build.
  if (opts.preflightInputPath) {
    let inputRaw: unknown;
    try {
      inputRaw = readJsonValue(ctx, opts.preflightInputPath, "preflight input");
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    if (!isPlainObject(inputRaw)) {
      return { text: "Refusing: preflight input must be a JSON object with an entries array.", exitCode: 1 };
    }
    if (inputRaw.schemaVersion !== undefined && inputRaw.schemaVersion !== SNIPER_PREFLIGHT_INPUT_SCHEMA_VERSION) {
      return { text: redactString(`Refusing: preflight input schemaVersion must be "${SNIPER_PREFLIGHT_INPUT_SCHEMA_VERSION}".`), exitCode: 1 };
    }
    let inputArtifact: SniperPreflightInput;
    try {
      inputArtifact = normalizeSniperPreflightInput({
        sourceLabel: typeof inputRaw.sourceLabel === "string" ? inputRaw.sourceLabel : opts.preflightInputPath,
        candidateListRef: typeof inputRaw.candidateListRef === "string" ? inputRaw.candidateListRef : null,
        entries: (inputRaw.entries ?? []) as never,
        candidateList: list,
      });
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    for (const e of inputArtifact.entries) {
      const entry: SniperPreflightCandidateData = { candidateId: e.candidateId };
      if (e.inspection !== null) entry.inspection = e.inspection;
      if (e.risk !== null) entry.risk = e.risk;
      dataById.set(e.candidateId, entry);
    }
  }

  // 3) Build the preflight report.
  let report: SniperTokenPreflightReport;
  try {
    report = buildSniperTokenPreflightReport({ candidateList: list, candidateData: [...dataById.values()] });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // 4) Optional write: ONLY the report JSON, refuse overwrite without --force, create no directories.
  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(report), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write preflight report at ${resolved}`), exitCode: 1 };
    }
  }

  const exitCode =
    (opts.failOnFail && report.hasFail) || (opts.failOnWarning && report.hasWarn) ? 1 : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(report), null, 2), exitCode };
  }
  return { text: formatSniperTokenPreflightReport(report, { label: opts.candidatesPath }), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 47 — paper:sniper:preflight:input:validate
//   Validate a LOCAL preflight input artifact (sniper.preflight.input.v1):
//   per-candidate token:inspect / token:risk shaped values, projected with the
//   SAME logic the preflight uses. LOCAL-ONLY: no RPC, no network, no wallet.
//   Reads the named files only; writes nothing.
// ---------------------------------------------------------------------------

export interface PaperSniperPreflightInputValidateCommandOptions {
  /** Preflight input JSON path (raw operator input or a canonical artifact). Required. */
  inputPath?: string;
  /** Optional candidate list JSON path to CROSS-CHECK entries against. */
  candidatesPath?: string;
  json?: boolean;
  /** Exit non-zero when the validated artifact carries any warning. */
  failOnWarning?: boolean;
  /** Exit non-zero when any entry has no usable risk report. */
  failOnMissingRisk?: boolean;
  /** Exit non-zero when any entry has no usable inspection. */
  failOnMissingInspection?: boolean;
}

/**
 * `soulmaker paper:sniper:preflight:input:validate` — validate + normalize a LOCAL preflight input
 * artifact (`sniper.preflight.input.v1`): per-candidate, already-loaded read-only inspection
 * (token:inspect output) and advisory risk (token:risk output) values, projected with the SAME logic
 * the preflight itself uses, so an unsupported shape / missing section / mint mismatch surfaces HERE
 * instead of silently mid-preflight. `--candidates` (optional) cross-checks entries against the list
 * (unknown candidateId or disagreeing mint = refusal; uncovered candidates = warning). LOCAL-ONLY: it
 * fetches nothing and verifies NO on-chain fact. Reads the named files only and writes nothing.
 */
export function paperSniperPreflightInputValidateReport(
  ctx: CommandContext = {},
  opts: PaperSniperPreflightInputValidateCommandOptions = {},
): CliReport {
  if (!opts.inputPath) return { text: "Refusing: --input <path> is required.", exitCode: 1 };

  let raw: unknown;
  try {
    raw = readJsonValue(ctx, opts.inputPath, "preflight input");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }
  if (!isPlainObject(raw)) {
    return { text: "Refusing: preflight input must be a JSON object with an entries array.", exitCode: 1 };
  }
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== SNIPER_PREFLIGHT_INPUT_SCHEMA_VERSION) {
    return {
      text: redactString(`Refusing: preflight input schemaVersion must be "${SNIPER_PREFLIGHT_INPUT_SCHEMA_VERSION}".`),
      exitCode: 1,
    };
  }

  // Optional candidate list for the cross-check (same wrong-schema guard as the sibling commands).
  let candidateList: unknown;
  if (opts.candidatesPath) {
    let candsRaw: unknown;
    try {
      candsRaw = readJsonValue(ctx, opts.candidatesPath, "sniper candidate list");
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    if (!isPlainObject(candsRaw)) {
      return { text: "Refusing: candidate list must be a JSON object with a candidates array.", exitCode: 1 };
    }
    if (candsRaw.schemaVersion !== undefined && candsRaw.schemaVersion !== SNIPER_CANDIDATE_LIST_SCHEMA_VERSION) {
      return {
        text: redactString(`Refusing: candidate list schemaVersion must be "${SNIPER_CANDIDATE_LIST_SCHEMA_VERSION}".`),
        exitCode: 1,
      };
    }
    try {
      candidateList = normalizeSniperCandidateList({
        sourceLabel: typeof candsRaw.sourceLabel === "string" ? candsRaw.sourceLabel : opts.candidatesPath,
        candidates: (candsRaw.candidates ?? []) as never,
      });
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
  }

  let artifact: SniperPreflightInput;
  try {
    artifact = normalizeSniperPreflightInput({
      sourceLabel: typeof raw.sourceLabel === "string" ? raw.sourceLabel : opts.inputPath,
      candidateListRef:
        typeof raw.candidateListRef === "string" ? raw.candidateListRef : (opts.candidatesPath ?? null),
      entries: (raw.entries ?? []) as never,
      candidateList,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  const exitCode =
    (opts.failOnWarning && artifact.hasWarnings) ||
    (opts.failOnMissingRisk && artifact.missingRiskCount > 0) ||
    (opts.failOnMissingInspection && artifact.missingInspectionCount > 0)
      ? 1
      : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(artifact), null, 2), exitCode };
  }
  return { text: formatSniperPreflightInput(artifact, { label: opts.inputPath }), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 90 — paper:sniper:preflight:input:prepare
//   The READ-ONLY INTELLIGENCE BRIDGE: pair standalone token:inspect /
//   token:risk JSON output files to a candidate list BY MINT and emit the
//   canonical preflight input artifact (sniper.preflight.input.v1) that
//   paper:sniper:dry-run consumes via --preflight-input. LOCAL-ONLY: no RPC,
//   no network, no wallet. Candidates without data stay honestly uncovered
//   (warnings), never invented. Secret-shaped input is REFUSED.
// ---------------------------------------------------------------------------

export interface PaperSniperPreflightInputPrepareCommandOptions {
  /** Candidate list JSON path (raw operator input or canonical). Required. */
  candidatesPath?: string;
  /** Repeatable token:inspect --json output file paths (matched to candidates by mint). */
  inspectPaths?: string[];
  /** Repeatable token:risk --json output file paths (matched to candidates by mint). */
  riskPaths?: string[];
  /** Optional operator label for the produced artifact. */
  sourceLabel?: string;
  json?: boolean;
  /** Optional path to write ONLY the canonical preflight input JSON (refuses overwrite without --force). */
  outPath?: string;
  /** Overwrite an existing --out file (refused by default). */
  force?: boolean;
  /** Exit non-zero when the produced artifact carries any warning. */
  failOnWarning?: boolean;
  /** Exit non-zero when any candidate has no usable risk report. */
  failOnMissingRisk?: boolean;
  /** Exit non-zero when any candidate has no usable inspection. */
  failOnMissingInspection?: boolean;
}

/**
 * Depth-capped scan for secret-shaped KEY NAMES anywhere in a parsed read-only output file.
 * Returns the offending key path (key names only — never a value) or null. Fail-closed backstop:
 * legitimate token:inspect / token:risk output never carries such keys, so any hit is either the
 * wrong file or something that must not flow into an artifact.
 */
function findSensitiveKeyPath(value: unknown, path = "", depth = 0): string | null {
  if (depth > 8 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findSensitiveKeyPath(value[i], `${path}[${i}]`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    if (isSensitiveKey(key)) return childPath;
    const hit = findSensitiveKeyPath(child, childPath, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * `soulmaker paper:sniper:preflight:input:prepare` — the real-input bridge from the read-only
 * intelligence commands into the PAPER dry-run. It reads a candidate list plus standalone
 * `token:inspect --json` / `token:risk --json` output files, matches each file to candidates BY
 * MINT, and emits the canonical `sniper.preflight.input.v1` artifact that `paper:sniper:dry-run`
 * (and `paper:sniper:preflight`) consume via `--preflight-input`. Honesty rules: raw values are
 * carried VERBATIM; a candidate without data stays uncovered with an explicit warning (never
 * marked safe); nothing here fetches chain data or verifies any on-chain fact. Refusals (exit 1):
 * malformed JSON, a file that does not look like the named command's output (an inspect/risk
 * cross-up is named explicitly), a file whose mint matches no candidate, duplicate files for one
 * mint, secret-shaped key names anywhere in an input file, and secret-length mint strings (never
 * echoed). `--out` writes ONLY the artifact JSON, refusing overwrite without `--force` and
 * creating no directories. No network, no RPC, no wallet.
 */
export function paperSniperPreflightInputPrepareReport(
  ctx: CommandContext = {},
  opts: PaperSniperPreflightInputPrepareCommandOptions = {},
): CliReport {
  if (!opts.candidatesPath) return { text: "Refusing: --candidates <path> is required.", exitCode: 1 };
  if ((opts.inspectPaths?.length ?? 0) === 0 && (opts.riskPaths?.length ?? 0) === 0) {
    return {
      text: "Refusing: supply at least one --inspect <path> or --risk <path> file (token:inspect --json / token:risk --json output).",
      exitCode: 1,
    };
  }

  // 1) Read + normalize the candidate list (same wrong-schema guard as the sibling commands).
  let raw: unknown;
  try {
    raw = readJsonValue(ctx, opts.candidatesPath, "sniper candidate list");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }
  if (!isPlainObject(raw)) {
    return { text: "Refusing: candidate list must be a JSON object with a candidates array.", exitCode: 1 };
  }
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== SNIPER_CANDIDATE_LIST_SCHEMA_VERSION) {
    return {
      text: redactString(`Refusing: candidate list schemaVersion must be "${SNIPER_CANDIDATE_LIST_SCHEMA_VERSION}".`),
      exitCode: 1,
    };
  }
  let list: SniperCandidateList;
  try {
    list = normalizeSniperCandidateList({
      sourceLabel: typeof raw.sourceLabel === "string" ? raw.sourceLabel : opts.candidatesPath,
      candidates: (raw.candidates ?? []) as never,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }
  const candidateMints = new Set(list.distinctMints);

  // 2) Load each read-only output file: strict local checks, then keyed by canonical mint.
  interface LoadedFile {
    path: string;
    value: Record<string, unknown>;
  }
  const loadFiles = (
    paths: string[] | undefined,
    kind: "inspect" | "risk",
  ): { byMint?: Map<string, LoadedFile>; error?: string } => {
    const byMint = new Map<string, LoadedFile>();
    for (const path of paths ?? []) {
      let value: unknown;
      try {
        value = readJsonValue(ctx, path, `--${kind} file`);
      } catch (err) {
        return { error: (err as Error).message };
      }
      if (!isPlainObject(value)) {
        return { error: `--${kind} "${path}" must be a JSON object (token:${kind === "inspect" ? "inspect" : "risk"} --json output).` };
      }
      // Fail-closed: a secret-shaped KEY anywhere means this is not read-only command output.
      const sensitive = findSensitiveKeyPath(value);
      if (sensitive !== null) {
        return { error: `--${kind} "${path}" carries a secret-shaped key ("${sensitive}") — refusing to bridge it into any artifact.` };
      }
      // Cross-up guards first (friendlier than the generic shape refusal).
      const riskShaped = ("score" in value || "flags" in value) && !("decimals" in value);
      const inspectShaped = ("decimals" in value || "supplyRaw" in value) && !("score" in value);
      if (kind === "inspect" && riskShaped) {
        return { error: `--inspect "${path}" looks like token:risk output — pass it with --risk instead.` };
      }
      if (kind === "risk" && inspectShaped) {
        return { error: `--risk "${path}" looks like token:inspect output — pass it with --inspect instead.` };
      }
      if (kind === "inspect" && !inspectShaped) {
        return { error: `--inspect "${path}" does not look like token:inspect --json output (no decimals/supplyRaw fields).` };
      }
      if (kind === "risk" && !riskShaped) {
        return { error: `--risk "${path}" does not look like token:risk --json output (no score/flags fields).` };
      }
      if (typeof value.mint !== "string") {
        return { error: `--${kind} "${path}" carries no mint string.` };
      }
      let mint: string;
      try {
        mint = parseMintAddress(value.mint); // refuses secret-length input outright, never echoed
      } catch (err) {
        return { error: `--${kind} "${path}": ${(err as Error).message}` };
      }
      const existing = byMint.get(mint);
      if (existing) {
        return { error: `duplicate --${kind} for mint ${mint} ("${existing.path}" and "${path}").` };
      }
      if (!candidateMints.has(mint)) {
        return { error: `--${kind} "${path}" is for mint ${mint}, which is not in the candidate list.` };
      }
      byMint.set(mint, { path, value });
    }
    return { byMint };
  };

  const inspects = loadFiles(opts.inspectPaths, "inspect");
  if (inspects.error) return { text: redactString(`Refusing: ${inspects.error}`), exitCode: 1 };
  const risks = loadFiles(opts.riskPaths, "risk");
  if (risks.error) return { text: redactString(`Refusing: ${risks.error}`), exitCode: 1 };

  // 3) Pair BY MINT, in candidate-list order. A candidate without data stays honestly uncovered
  //    (the normalizer records the warning); data is carried VERBATIM, never adjusted.
  const entries = list.candidates.map((c) => {
    const inspect = inspects.byMint?.get(c.mint);
    const risk = risks.byMint?.get(c.mint);
    const provenance = [
      ...(inspect ? [`inspect:${inspect.path}`] : []),
      ...(risk ? [`risk:${risk.path}`] : []),
    ].join(" + ");
    return {
      candidateId: c.candidateId,
      mint: c.mint,
      ...(inspect ? { inspection: inspect.value } : {}),
      ...(risk ? { risk: risk.value } : {}),
      sourceLabel: provenance.length > 0 ? provenance : null,
    };
  });

  let artifact: SniperPreflightInput;
  try {
    artifact = normalizeSniperPreflightInput({
      sourceLabel: opts.sourceLabel ?? `prepared from read-only outputs for ${opts.candidatesPath}`,
      candidateListRef: opts.candidatesPath,
      entries,
      candidateList: list,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // 4) Optional write: ONLY the artifact JSON, refuse overwrite without --force, create no directories.
  let wrotePath: string | null = null;
  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(artifact), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write preflight input at ${resolved}`), exitCode: 1 };
    }
    wrotePath = resolved;
  }

  const exitCode =
    (opts.failOnWarning && artifact.hasWarnings) ||
    (opts.failOnMissingRisk && artifact.missingRiskCount > 0) ||
    (opts.failOnMissingInspection && artifact.missingInspectionCount > 0)
      ? 1
      : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(artifact), null, 2), exitCode };
  }

  const lines = [formatSniperPreflightInput(artifact, { label: opts.candidatesPath }), "", "Next:"];
  if (wrotePath) {
    lines.push(
      `- Run the PAPER dry-run: pnpm soulmaker paper:sniper:dry-run --candidates "${opts.candidatesPath}" --preflight-input "${opts.outPath}" --out <output-dir> --adopt-specs --operator <your-name> --acknowledge-paper-enter-review`,
      "- Then open the output folder in the web UI: pnpm web:inspect --dir <output-dir> --force",
    );
  } else {
    lines.push(
      "- Nothing was written (no --out). Re-run with --out <path> to produce the file paper:sniper:dry-run consumes via --preflight-input.",
    );
  }
  return { text: redactString(lines.join("\n")), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 91 — paper:routequote:prepare
//   The READ-ONLY ROUTE QUOTE bridge: pair operator-supplied quote observation
//   files (`routequote.observation.input.v1`) to a candidate list BY MINT and
//   emit the canonical prepared artifact (`routequote.prepared.v1`) that
//   paper:simulation:route consumes via --quotes and paper:sniper:dry-run via
//   --routequote. LOCAL-ONLY: no RPC, no network, no wallet — an observation
//   proves a quote was VISIBLE at some point, never that one is executable.
// ---------------------------------------------------------------------------

export interface PaperRouteQuotePrepareCommandOptions {
  /** Candidate list JSON path. Required. */
  candidatesPath?: string;
  /** Quote observation files (`routequote.observation.input.v1`; repeatable, paired by mint). */
  quotePaths?: string[];
  /** Operator label recorded on the produced artifact. */
  sourceLabel?: string;
  json?: boolean;
  /** Optional path to write the prepared routequote JSON (writes nothing if omitted). */
  outPath?: string;
  /** Overwrite an existing --out file (refused by default). */
  force?: boolean;
  /** Exit non-zero when the produced artifact carries any warning. */
  failOnWarning?: boolean;
  /** Exit non-zero when any candidate has no quote observation at all. */
  failOnMissingQuote?: boolean;
  /** Exit non-zero when any candidate's quote was not observed (unavailable/blocked/error/unsupported). */
  failOnNotObserved?: boolean;
}

/**
 * `soulmaker paper:routequote:prepare` — pair operator-supplied READ-ONLY quote observation files
 * to a candidate list BY MINT and emit the canonical `routequote.prepared.v1` artifact. Each
 * observation file is strictly validated (CLOSED schema; closed outcome set; secret-shaped
 * fields/values refused, never echoed); an observation for a mint not in the candidate list is
 * REFUSED; duplicates are REFUSED; a candidate without an observation stays honestly
 * `unavailable`. Every observed quote carries the mandatory caveat set: read-only observation
 * only, never executable, never a transaction, never an order. LOCAL-ONLY: reads only the named
 * files, fetches nothing, verifies no on-chain fact; writes nothing unless `--out` (refusing
 * overwrite without `--force`). Never signs, never sends. No network, no wallet.
 */
export function paperRouteQuotePrepareReport(
  ctx: CommandContext = {},
  opts: PaperRouteQuotePrepareCommandOptions = {},
): CliReport {
  if (!opts.candidatesPath) return { text: "Refusing: --candidates <path> is required.", exitCode: 1 };

  // 1) Read + normalize the candidate list (same wrong-schema guard as the sibling commands).
  let raw: unknown;
  try {
    raw = readJsonValue(ctx, opts.candidatesPath, "sniper candidate list");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }
  if (!isPlainObject(raw)) {
    return { text: "Refusing: candidate list must be a JSON object with a candidates array.", exitCode: 1 };
  }
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== SNIPER_CANDIDATE_LIST_SCHEMA_VERSION) {
    return {
      text: redactString(`Refusing: candidate list schemaVersion must be "${SNIPER_CANDIDATE_LIST_SCHEMA_VERSION}".`),
      exitCode: 1,
    };
  }
  let list: SniperCandidateList;
  try {
    list = normalizeSniperCandidateList({
      sourceLabel: typeof raw.sourceLabel === "string" ? raw.sourceLabel : opts.candidatesPath,
      candidates: (raw.candidates ?? []) as never,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // 2) Read each observation file: strict local checks (the normalizer does the deep validation,
  //    by-mint pairing, unknown-mint and duplicate refusals).
  const observations: unknown[] = [];
  for (const path of opts.quotePaths ?? []) {
    let value: unknown;
    try {
      value = readJsonValue(ctx, path, "--quote file");
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    if (!isPlainObject(value)) {
      return { text: redactString(`Refusing: --quote "${path}" must be a JSON object (a routequote.observation.input.v1 file).`), exitCode: 1 };
    }
    if (value.schemaVersion !== ROUTE_QUOTE_OBSERVATION_INPUT_SCHEMA_VERSION) {
      return {
        text: redactString(
          `Refusing: --quote "${path}" schemaVersion must be "${ROUTE_QUOTE_OBSERVATION_INPUT_SCHEMA_VERSION}" — a cross-kind file is refused.`,
        ),
        exitCode: 1,
      };
    }
    const sensitive = findSensitiveKeyPath(value);
    if (sensitive !== null) {
      return {
        text: redactString(`Refusing: --quote "${path}" carries a secret-shaped key ("${sensitive}") — refusing to bridge it into any artifact.`),
        exitCode: 1,
      };
    }
    observations.push(value);
  }

  // 3) Build the canonical prepared artifact (by-mint pairing; fail-closed refusals inside).
  let artifact: RouteQuotePrepared;
  try {
    artifact = normalizeRouteQuotePrepared({
      candidateList: list,
      observations,
      sourceLabel: opts.sourceLabel ?? `prepared from operator-supplied quote observations for ${opts.candidatesPath}`,
      candidateListRef: opts.candidatesPath,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // 4) Optional write: ONLY the artifact JSON, refuse overwrite without --force, create no directories.
  let wrotePath: string | null = null;
  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(artifact), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write prepared routequote at ${resolved}`), exitCode: 1 };
    }
    wrotePath = resolved;
  }

  const missingQuoteCount = artifact.entries.filter((e) => !e.observationSupplied).length;
  const exitCode =
    (opts.failOnWarning && artifact.hasWarnings) ||
    (opts.failOnMissingQuote && missingQuoteCount > 0) ||
    (opts.failOnNotObserved && artifact.observedCount < artifact.entryCount)
      ? 1
      : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(artifact), null, 2), exitCode };
  }

  const lines = [formatRouteQuotePrepared(artifact, { label: opts.candidatesPath }), "", "Next:"];
  if (wrotePath) {
    lines.push(
      `- Run the PAPER dry-run with quote provenance: pnpm soulmaker paper:sniper:dry-run --candidates "${opts.candidatesPath}" --routequote "${opts.outPath}" --out <output-dir> --adopt-specs --operator <your-name> --acknowledge-paper-enter-review`,
      `- Or build a standalone route artifact: pnpm soulmaker paper:simulation:route --plan <intent-plan.json> --quotes "${opts.outPath}" --out <route-resolution.json>`,
      "- Then open the output folder in the web UI: pnpm web:inspect --dir <output-dir> --force",
    );
  } else {
    lines.push(
      "- Nothing was written (no --out). Re-run with --out <path> to produce the file paper:sniper:dry-run consumes via --routequote.",
    );
  }
  return { text: redactString(lines.join("\n")), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 92 — paper:routequote:fetch
//   The REAL read-only quote fetcher the S89/S91 stub reserved: fetch one live
//   quote per candidate from a public quote API (Jupiter lite tier), normalize
//   EVERY outcome into routequote.observation.input.v1 files plus an honest
//   freshness/provenance fetch report. Network READ only — no wallet, no keys,
//   no signing, no sending, no transaction; a quote is never an order.
// ---------------------------------------------------------------------------

/** Wrapped-SOL mint — the conventional swap input for a quote probe. */
const WSOL_MINT = "So11111111111111111111111111111111111111112";

export interface PaperRouteQuoteFetchCommandOptions {
  /** Candidate list JSON path. Required. */
  candidatesPath?: string;
  /** Swap INPUT mint (defaults to wrapped SOL). */
  inputMint?: string;
  /** Input amount in raw base units (integer string). Exactly one of amountRaw/amountSol. */
  amountRaw?: string;
  /** Input amount in SOL (decimal string, up to 9 dp) — converted to lamports. */
  amountSol?: string;
  /** Slippage tolerance in basis points (default 50). */
  slippageBps?: string;
  /** Override the provider base URL (defaults to the free Jupiter lite endpoint). */
  endpoint?: string;
  /** Per-request timeout in milliseconds (default 10000). */
  timeoutMs?: string;
  /** Explicit opt-in to a network read while in PAPER mode. */
  allowPaperRead?: boolean;
  /** Directory to write quote.<candidateId>.json files + fetch-report.json into. */
  outDir?: string;
  force?: boolean;
  json?: boolean;
  /** Exit non-zero when any candidate's quote was not observed. */
  failOnNotObserved?: boolean;
}

/** Convert a decimal SOL string (≤9 dp) into a lamports integer string. Refuses anything else. */
function solToLamportsRaw(amountSol: string): string {
  const match = /^([0-9]+)(?:\.([0-9]{1,9}))?$/.exec(amountSol.trim());
  if (!match) {
    throw new Error("--amount-sol must be a plain decimal with at most 9 decimal places (e.g. 0.01)");
  }
  const whole = match[1] ?? "0";
  const frac = (match[2] ?? "").padEnd(9, "0");
  const raw = `${whole}${frac}`.replace(/^0+(?=[0-9])/, "");
  if (/^0+$/.test(raw)) throw new Error("--amount-sol must be greater than zero");
  return raw;
}

/** A filename-safe slug from a candidate id (bounded; never trusted raw). */
function quoteFileSlug(candidateId: string): string {
  const slug = candidateId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return slug.length > 0 ? slug : "candidate";
}

/**
 * `soulmaker paper:routequote:fetch` — fetch a REAL read-only quote per candidate over public
 * HTTP and emit the observation files `paper:routequote:prepare` consumes, plus a fetch report
 * with honest freshness metadata. This command READS the network; it cannot sign, send, build,
 * or execute anything, and a fetched quote can never unblock a blocked chain downstream.
 */
export async function paperRouteQuoteFetchReport(
  ctx: CommandContext = {},
  opts: PaperRouteQuoteFetchCommandOptions = {},
): Promise<CliReport> {
  if (!opts.candidatesPath) return { text: "Refusing: --candidates <path> is required.", exitCode: 1 };

  // Same honesty gate as the chain-read commands: network reads in PAPER mode are an explicit
  // opt-in, and an invalid config refuses outright (no rpcUrl needed — this is HTTP, not RPC).
  let config: Config;
  try {
    config = loadConfig(toLoadOptions(ctx));
  } catch (err) {
    const msg = err instanceof ConfigError ? err.message : String(err);
    return { text: redactString(`Refusing: config is invalid.\n\n${msg}`), exitCode: 1 };
  }
  const caps = capabilitiesFor(config.mode);
  if (!caps.canReadChain && !(config.mode === "PAPER" && opts.allowPaperRead === true)) {
    return {
      text:
        `Refusing: mode ${config.mode} does not read the network. ` +
        "Use WATCH_ONLY/SIMULATION, or pass --allow-paper-read to fetch read-only quotes in PAPER mode.",
      exitCode: 1,
    };
  }

  // Candidate list: same strict normalization as the sibling routequote command.
  let raw: unknown;
  try {
    raw = readJsonValue(ctx, opts.candidatesPath, "sniper candidate list");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }
  if (!isPlainObject(raw)) {
    return { text: "Refusing: candidate list must be a JSON object with a candidates array.", exitCode: 1 };
  }
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== SNIPER_CANDIDATE_LIST_SCHEMA_VERSION) {
    return {
      text: redactString(`Refusing: candidate list schemaVersion must be "${SNIPER_CANDIDATE_LIST_SCHEMA_VERSION}".`),
      exitCode: 1,
    };
  }
  let list: SniperCandidateList;
  try {
    list = normalizeSniperCandidateList({
      sourceLabel: typeof raw.sourceLabel === "string" ? raw.sourceLabel : opts.candidatesPath,
      candidates: (raw.candidates ?? []) as never,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // Amount: exactly one of --amount-raw / --amount-sol.
  if ((opts.amountRaw === undefined) === (opts.amountSol === undefined)) {
    return {
      text: "Refusing: pass exactly one of --amount-raw <units> or --amount-sol <sol> (the quote probe size must be explicit).",
      exitCode: 1,
    };
  }
  let amountRaw: string;
  try {
    amountRaw = opts.amountRaw !== undefined ? opts.amountRaw.trim() : solToLamportsRaw(opts.amountSol as string);
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  const slippageBps = opts.slippageBps === undefined ? 50 : Number(opts.slippageBps);
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 10000) {
    return { text: "Refusing: --slippage-bps must be an integer between 0 and 10000.", exitCode: 1 };
  }
  const timeoutMs = opts.timeoutMs === undefined ? 10_000 : Number(opts.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    return { text: "Refusing: --timeout-ms must be an integer between 100 and 120000.", exitCode: 1 };
  }

  // Refuse a doomed --out-dir before any network read happens. The directory must exist
  // (this command never mkdirs), and no target file may exist without --force.
  const plannedWrites: Array<{ path: string; kind: "observation" | "report"; mint?: string; candidateId?: string }> = [];
  if (opts.outDir) {
    const dir = resolvePath(ctx, opts.outDir);
    if (!existsSync(dir)) {
      return { text: redactString(`Refusing: --out-dir ${dir} does not exist (create it first; this command never mkdirs).`), exitCode: 1 };
    }
    const seenMints = new Set<string>();
    for (const candidate of list.candidates) {
      if (seenMints.has(candidate.mint)) continue; // prepare accepts ONE observation per mint
      seenMints.add(candidate.mint);
      plannedWrites.push({
        path: join(dir, `quote.${quoteFileSlug(candidate.candidateId)}.json`),
        kind: "observation",
        mint: candidate.mint,
        candidateId: candidate.candidateId,
      });
    }
    plannedWrites.push({ path: join(dir, "fetch-report.json"), kind: "report" });
    if (!opts.force) {
      for (const planned of plannedWrites) {
        if (existsSync(planned.path)) {
          return { text: redactString(`Refusing: ${planned.path} already exists (pass --force to overwrite).`), exitCode: 1 };
        }
      }
    }
  }

  // Fetch (sequential; one candidate's failure never aborts the batch — the adapter maps
  // every provider problem onto the closed observation status set).
  const makeAdapter = ctx.createQuoteAdapter ?? createJupiterQuoteAdapter;
  let adapter: QuoteProviderAdapter;
  try {
    adapter = makeAdapter({ baseUrl: opts.endpoint, timeoutMs, clock: ctx.now });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }
  let report: RouteQuoteFetchReport;
  try {
    report = await fetchQuotesForCandidates(adapter, list, {
      inputMint: opts.inputMint ?? WSOL_MINT,
      amountRaw,
      slippageBps,
      candidateListRef: opts.candidatesPath,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // Writes: one observation file per distinct mint + the fetch report. Redaction backstop on all.
  const wrotePaths: string[] = [];
  const observationPaths: string[] = [];
  if (opts.outDir) {
    const byMint = new Map(report.entries.map((e) => [e.mint, e.observation]));
    for (const planned of plannedWrites) {
      const value =
        planned.kind === "report" ? report : byMint.get(planned.mint as string);
      if (value === undefined) continue;
      try {
        writeFileSync(planned.path, JSON.stringify(redactValue(value), null, 2) + "\n");
      } catch {
        return { text: redactString(`Refusing: cannot write ${planned.path}`), exitCode: 1 };
      }
      wrotePaths.push(planned.path);
      if (planned.kind === "observation") observationPaths.push(planned.path);
    }
  }

  const exitCode = opts.failOnNotObserved && report.observedCount < report.entryCount ? 1 : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(report), null, 2), exitCode };
  }

  const lines = [formatRouteQuoteFetchReport(report), ""];
  if (wrotePaths.length > 0) {
    lines.push(`wrote ${wrotePaths.length} file(s):`);
    for (const p of wrotePaths) lines.push(`  - ${p}`);
    lines.push("", "Next:");
    const quoteFlags = observationPaths.map((p) => `--quote "${p}"`).join(" ");
    lines.push(
      `- Pair the fetched observations to the candidates: pnpm soulmaker paper:routequote:prepare --candidates "${opts.candidatesPath}" ${quoteFlags} --out <routequote-prepared.json>`,
      "- Then run the PAPER dry-run with quote provenance: pnpm soulmaker paper:sniper:dry-run --candidates <candidates.json> --routequote <routequote-prepared.json> --out <output-dir>",
      "- A fetched quote is an observation with a freshness timestamp — NOT execution, NOT route readiness, and it can never unblock a blocked chain.",
    );
  } else {
    lines.push(
      "Next:",
      "- Nothing was written (no --out-dir). Re-run with --out-dir <dir> to emit the observation files paper:routequote:prepare consumes.",
    );
  }
  return { text: redactString(lines.join("\n")), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 92 — paper:realtime:snapshot / paper:realtime:watch
//   Real-time candidate INGESTION: poll a public new-token feed (Jupiter
//   recent-tokens) or a local replay file, normalize observations into the
//   EXISTING sniper candidate-list contract, and write honest artifacts.
//   Watching is read-only observation — it can never place an order.
// ---------------------------------------------------------------------------

const REALTIME_SOURCES = ["jupiter-recent", "replay"] as const;
type RealtimeSourceId = (typeof REALTIME_SOURCES)[number];

export interface PaperRealtimeSnapshotCommandOptions {
  /** Which source to poll: "jupiter-recent" (live) or "replay" (local file). */
  source?: string;
  /** Replay events JSON path (required when source is "replay"). */
  replayFile?: string;
  /** Keep at most this many observations (default 25, max 50). */
  limit?: string;
  /** Drop observations whose liquidity hint is missing or below this (USD). */
  minLiquidityUsd?: string;
  /** Override the live feed base URL. */
  endpoint?: string;
  timeoutMs?: string;
  /** Explicit opt-in to a network read while in PAPER mode (live source only). */
  allowPaperRead?: boolean;
  /** Directory to write snapshot.json + candidates.json into (must exist). */
  outDir?: string;
  force?: boolean;
  json?: boolean;
  /** Exit non-zero when the poll did not observe (unavailable/blocked/error/unsupported). */
  failOnNotObserved?: boolean;
}

interface RealtimeSourceGate {
  ok: boolean;
  message?: string;
  adapter?: CandidateSourceAdapter;
  sourceKind?: "live" | "replay";
}

/** Resolve + gate the requested candidate source (config honesty gate for live reads). */
function openRealtimeSource(
  ctx: CommandContext,
  opts: { source?: string; replayFile?: string; endpoint?: string; timeoutMs?: number; allowPaperRead?: boolean },
): RealtimeSourceGate {
  const source = (opts.source ?? "jupiter-recent") as RealtimeSourceId;
  if (!REALTIME_SOURCES.includes(source)) {
    return { ok: false, message: `Refusing: --source must be one of ${REALTIME_SOURCES.join("|")}.` };
  }

  if (source === "replay") {
    if (!opts.replayFile) {
      return { ok: false, message: 'Refusing: --replay-file <path> is required when --source is "replay".' };
    }
    let eventsValue: unknown;
    try {
      eventsValue = readJsonValue(ctx, opts.replayFile, "replay events file");
    } catch (err) {
      return { ok: false, message: redactString(`Refusing: ${(err as Error).message}`) };
    }
    try {
      return { ok: true, adapter: createReplayCandidateAdapter(eventsValue), sourceKind: "replay" };
    } catch (err) {
      return { ok: false, message: redactString(`Refusing: ${(err as Error).message}`) };
    }
  }

  // Live source: same honesty gate as every network-reading command.
  let config: Config;
  try {
    config = loadConfig(toLoadOptions(ctx));
  } catch (err) {
    const msg = err instanceof ConfigError ? err.message : String(err);
    return { ok: false, message: redactString(`Refusing: config is invalid.\n\n${msg}`) };
  }
  const caps = capabilitiesFor(config.mode);
  if (!caps.canReadChain && !(config.mode === "PAPER" && opts.allowPaperRead === true)) {
    return {
      ok: false,
      message:
        `Refusing: mode ${config.mode} does not read the network. ` +
        "Use WATCH_ONLY/SIMULATION, or pass --allow-paper-read to watch the feed in PAPER mode.",
    };
  }
  const makeSource = ctx.createCandidateSource ?? createJupiterRecentAdapter;
  try {
    return {
      ok: true,
      adapter: makeSource({ baseUrl: opts.endpoint, timeoutMs: opts.timeoutMs, clock: ctx.now }),
      sourceKind: "live",
    };
  } catch (err) {
    return { ok: false, message: redactString(`Refusing: ${(err as Error).message}`) };
  }
}

/**
 * `soulmaker paper:realtime:snapshot` — ONE poll of a candidate source folded into a
 * `realtime.candidates.snapshot.v1` artifact plus a ready-to-use canonical candidate list.
 * Watching is read-only observation: no wallet, no keys, no order — the output feeds the
 * existing PAPER intake (`paper:sniper:dry-run --candidates`).
 */
export async function paperRealtimeSnapshotReport(
  ctx: CommandContext = {},
  opts: PaperRealtimeSnapshotCommandOptions = {},
): Promise<CliReport> {
  const limit = opts.limit === undefined ? 25 : Number(opts.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return { text: "Refusing: --limit must be an integer between 1 and 50.", exitCode: 1 };
  }
  let minLiquidityUsdHint: number | undefined;
  if (opts.minLiquidityUsd !== undefined) {
    minLiquidityUsdHint = Number(opts.minLiquidityUsd);
    if (!Number.isFinite(minLiquidityUsdHint) || minLiquidityUsdHint < 0) {
      return { text: "Refusing: --min-liquidity-usd must be a non-negative number.", exitCode: 1 };
    }
  }
  const timeoutMs = opts.timeoutMs === undefined ? 10_000 : Number(opts.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    return { text: "Refusing: --timeout-ms must be an integer between 100 and 120000.", exitCode: 1 };
  }

  // Refuse a doomed --out-dir before any network read happens.
  let plannedSnapshotPath: string | null = null;
  let plannedCandidatesPath: string | null = null;
  if (opts.outDir) {
    const dir = resolvePath(ctx, opts.outDir);
    if (!existsSync(dir)) {
      return { text: redactString(`Refusing: --out-dir ${dir} does not exist (create it first; this command never mkdirs).`), exitCode: 1 };
    }
    plannedSnapshotPath = join(dir, "snapshot.json");
    plannedCandidatesPath = join(dir, "candidates.json");
    if (!opts.force) {
      for (const p of [plannedSnapshotPath, plannedCandidatesPath]) {
        if (existsSync(p)) {
          return { text: redactString(`Refusing: ${p} already exists (pass --force to overwrite).`), exitCode: 1 };
        }
      }
    }
  }

  const gate = openRealtimeSource(ctx, {
    source: opts.source,
    replayFile: opts.replayFile,
    endpoint: opts.endpoint,
    timeoutMs,
    allowPaperRead: opts.allowPaperRead,
  });
  if (!gate.ok || !gate.adapter || !gate.sourceKind) {
    return { text: gate.message ?? "Refusing: candidate source unavailable.", exitCode: 1 };
  }

  let snapshot: RealtimeCandidatesSnapshot;
  try {
    const result = await gate.adapter.fetchOnce();
    snapshot = buildRealtimeCandidatesSnapshot(result, gate.sourceKind, { limit, minLiquidityUsdHint });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  const wrotePaths: string[] = [];
  if (plannedSnapshotPath !== null) {
    try {
      writeFileSync(plannedSnapshotPath, JSON.stringify(redactValue(snapshot), null, 2) + "\n");
      wrotePaths.push(plannedSnapshotPath);
      if (snapshot.candidateList !== null && plannedCandidatesPath !== null) {
        writeFileSync(plannedCandidatesPath, JSON.stringify(redactValue(snapshot.candidateList), null, 2) + "\n");
        wrotePaths.push(plannedCandidatesPath);
      }
    } catch {
      return { text: redactString(`Refusing: cannot write snapshot artifacts under ${opts.outDir}`), exitCode: 1 };
    }
  }

  const exitCode = opts.failOnNotObserved && snapshot.status !== "observed" ? 1 : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(snapshot), null, 2), exitCode };
  }

  const lines = [formatRealtimeCandidatesSnapshot(snapshot), ""];
  if (wrotePaths.length > 0) {
    lines.push(`wrote ${wrotePaths.length} file(s):`);
    for (const p of wrotePaths) lines.push(`  - ${p}`);
    lines.push("", "Next:");
    if (snapshot.candidateList !== null && plannedCandidatesPath !== null) {
      lines.push(
        `- Inspect + risk-check the candidates read-only, then bridge them: pnpm soulmaker paper:sniper:preflight:input:prepare --candidates "${plannedCandidatesPath}" --inspect <mint.inspect.json> --risk <mint.risk.json> --out pf-input.json`,
        `- Fetch read-only route quotes for them: pnpm soulmaker paper:routequote:fetch --candidates "${plannedCandidatesPath}" --amount-sol 0.01 --out-dir <quotes-dir>`,
        `- Run the PAPER dry-run: pnpm soulmaker paper:sniper:dry-run --candidates "${plannedCandidatesPath}" --out <run-dir>`,
        "- A watched candidate is an observation — inspect and risk-check before any paper decision; nothing here is an order.",
      );
    } else {
      lines.push("- The poll observed no usable candidates; nothing to feed the pipeline.");
    }
  } else {
    lines.push("Next:", "- Nothing was written (no --out-dir). Re-run with --out-dir <dir> to emit snapshot.json + candidates.json.");
  }
  return { text: redactString(lines.join("\n")), exitCode };
}

export interface PaperRealtimeWatchCommandOptions {
  source?: string;
  replayFile?: string;
  /** Number of polls to run (REQUIRED; 1..120 — the watch is always bounded). */
  polls?: string;
  /** Milliseconds between polls (default 5000, min 1000). */
  intervalMs?: string;
  /** JSONL journal path (REQUIRED; appended per poll — interrupt-safe). */
  journal?: string;
  limit?: string;
  minLiquidityUsd?: string;
  endpoint?: string;
  timeoutMs?: string;
  allowPaperRead?: boolean;
  json?: boolean;
}

/**
 * `soulmaker paper:realtime:watch` — a BOUNDED sequence of polls (never an infinite loop)
 * appending one JSONL line per poll to a journal (interrupt-safe: every line is flushed as it
 * happens; killing the watch loses at most the in-flight poll). New mints are deduplicated
 * across the whole watch. Watching can never trigger an order — there is nothing here that
 * builds, signs, or sends.
 */
export async function paperRealtimeWatchReport(
  ctx: CommandContext = {},
  opts: PaperRealtimeWatchCommandOptions = {},
): Promise<CliReport> {
  const polls = Number(opts.polls);
  if (!Number.isInteger(polls) || polls < 1 || polls > 120) {
    return { text: "Refusing: --polls <n> is required (an integer between 1 and 120 — the watch is always bounded).", exitCode: 1 };
  }
  const intervalMs = opts.intervalMs === undefined ? 5_000 : Number(opts.intervalMs);
  if (!Number.isInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 300_000) {
    return { text: "Refusing: --interval-ms must be an integer between 1000 and 300000.", exitCode: 1 };
  }
  if (!opts.journal) {
    return { text: "Refusing: --journal <path> is required (the watch must leave an explicit, append-only record).", exitCode: 1 };
  }
  const timeoutMs = opts.timeoutMs === undefined ? 10_000 : Number(opts.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
    return { text: "Refusing: --timeout-ms must be an integer between 100 and 120000.", exitCode: 1 };
  }
  const limit = opts.limit === undefined ? 25 : Number(opts.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return { text: "Refusing: --limit must be an integer between 1 and 50.", exitCode: 1 };
  }
  let minLiquidityUsdHint: number | undefined;
  if (opts.minLiquidityUsd !== undefined) {
    minLiquidityUsdHint = Number(opts.minLiquidityUsd);
    if (!Number.isFinite(minLiquidityUsdHint) || minLiquidityUsdHint < 0) {
      return { text: "Refusing: --min-liquidity-usd must be a non-negative number.", exitCode: 1 };
    }
  }

  const journalPath = resolvePath(ctx, opts.journal);

  const gate = openRealtimeSource(ctx, {
    source: opts.source,
    replayFile: opts.replayFile,
    endpoint: opts.endpoint,
    timeoutMs,
    allowPaperRead: opts.allowPaperRead,
  });
  if (!gate.ok || !gate.adapter || !gate.sourceKind) {
    return { text: gate.message ?? "Refusing: candidate source unavailable.", exitCode: 1 };
  }

  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const seenMints = new Set<string>();
  const statusTally: Record<string, number> = {};
  let newMintTotal = 0;

  for (let poll = 1; poll <= polls; poll += 1) {
    let line: Record<string, unknown>;
    try {
      const result = await gate.adapter.fetchOnce();
      const snapshot = buildRealtimeCandidatesSnapshot(result, gate.sourceKind, { limit, minLiquidityUsdHint });
      const newObservations = snapshot.observations.filter((o) => !seenMints.has(o.mint));
      for (const o of newObservations) seenMints.add(o.mint);
      newMintTotal += newObservations.length;
      statusTally[snapshot.status] = (statusTally[snapshot.status] ?? 0) + 1;
      line = {
        poll,
        fetchedAt: snapshot.fetchedAt,
        status: snapshot.status,
        statusDetail: snapshot.statusDetail,
        keptCount: snapshot.keptCount,
        newMintCount: newObservations.length,
        newCandidates: newObservations.map((o) => ({
          candidateId: o.candidateId,
          mint: o.mint,
          symbol: o.symbol,
          launchpadLabel: o.launchpadLabel,
          liquidityUsdHint: o.liquidityUsdHint,
          sourceKind: o.sourceKind,
        })),
        watchOnly: true,
        neverTrades: true,
      };
    } catch (err) {
      statusTally["error"] = (statusTally["error"] ?? 0) + 1;
      line = { poll, status: "error", statusDetail: redactString((err as Error).message).slice(0, 200), watchOnly: true, neverTrades: true };
    }
    // Append-per-poll: the journal survives an interrupt at any point.
    try {
      appendFileSync(journalPath, JSON.stringify(redactValue(line)) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot append watch journal at ${journalPath}`), exitCode: 1 };
    }
    if (poll < polls) await sleep(intervalMs);
  }

  const summary = {
    schemaVersion: "realtime.watch.summary.v1",
    watchOnly: true,
    neverTrades: true,
    phase7LiveTradingReady: false,
    providerId: gate.adapter.providerId,
    sourceKind: gate.sourceKind,
    polls,
    intervalMs,
    distinctMintsObserved: seenMints.size,
    newMintTotal,
    statusTally,
    journal: journalPath,
  };

  if (opts.json) {
    return { text: JSON.stringify(redactValue(summary), null, 2), exitCode: 0 };
  }
  const lines = [
    "REAL-TIME WATCH COMPLETE (bounded; read-only observation — nothing was traded)",
    `provider:        ${summary.providerId} (${summary.sourceKind})`,
    `polls:           ${polls} @ ${intervalMs}ms`,
    `distinct mints:  ${seenMints.size}`,
    `journal:         ${journalPath}`,
    "",
    "Next:",
    `- Snapshot the current feed into a candidate list: pnpm soulmaker paper:realtime:snapshot --source ${opts.source ?? "jupiter-recent"} --out-dir <dir>`,
    "- A watched candidate is an observation — inspect and risk-check before any paper decision.",
  ];
  return { text: redactString(lines.join("\n")), exitCode: 0 };
}

// ---------------------------------------------------------------------------
// Sprint 92 — paper:simulation:tx
//   The REAL simulateTransaction preview the dry-run boundary doc designed:
//   a strictly-validated UNSIGNED envelope simulated with sigVerify:false +
//   replaceRecentBlockhash:true over a seam with NO send method. Nothing is
//   signed, nothing is sent; simulated-ok is evidence, never readiness.
// ---------------------------------------------------------------------------

export interface PaperSimulationTxCommandOptions {
  /** Unsigned transaction envelope JSON path (txpreview.envelope.v1). Required. */
  envelopePath?: string;
  /** RPC endpoint for the simulation (overrides config rpcUrl). */
  rpcUrl?: string;
  /** Explicit opt-in to a network read while in PAPER mode. */
  allowPaperRead?: boolean;
  json?: boolean;
  outPath?: string;
  force?: boolean;
  /** Exit non-zero unless the outcome is simulated-ok. */
  failOnNotOk?: boolean;
}

/**
 * `soulmaker paper:simulation:tx` — simulate one UNSIGNED transaction envelope against real
 * chain state. The envelope is validated fail-closed first (a signed transaction, a key-shaped
 * field, or a fee-payer mismatch refuses before any network I/O); a transport failure becomes an
 * honest `unavailable` report; a program error stays `simulated-failed`. No signer, no sending.
 */
export async function paperSimulationTxReport(
  ctx: CommandContext = {},
  opts: PaperSimulationTxCommandOptions = {},
): Promise<CliReport> {
  if (!opts.envelopePath) return { text: "Refusing: --envelope <path> is required.", exitCode: 1 };

  // Fail early on a doomed --out before any read or network happens.
  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
  }

  // Config honesty gate (network read).
  let config: Config;
  try {
    config = loadConfig(toLoadOptions(ctx));
  } catch (err) {
    const msg = err instanceof ConfigError ? err.message : String(err);
    return { text: redactString(`Refusing: config is invalid.\n\n${msg}`), exitCode: 1 };
  }
  const caps = capabilitiesFor(config.mode);
  if (!caps.canReadChain && !(config.mode === "PAPER" && opts.allowPaperRead === true)) {
    return {
      text:
        `Refusing: mode ${config.mode} does not read the network. ` +
        "Use WATCH_ONLY/SIMULATION, or pass --allow-paper-read to simulate read-only in PAPER mode.",
      exitCode: 1,
    };
  }

  // Read + validate the envelope FAIL-CLOSED before any network I/O. An invalid envelope is an
  // input error (refusal), not a simulation outcome.
  let envelopeValue: unknown;
  try {
    envelopeValue = readJsonValue(ctx, opts.envelopePath, "unsigned tx envelope");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }
  let network: string;
  try {
    network = validateUnsignedTxEnvelope(envelopeValue).network;
  } catch (err) {
    const msg = err instanceof TxPreviewError ? err.message : (err as Error).message;
    return { text: redactString(`Refusing: ${msg}`), exitCode: 1 };
  }

  const rpcUrl = opts.rpcUrl ?? config.rpcUrl;
  if (!rpcUrl) {
    return { text: "Refusing: no RPC endpoint. Pass --rpc-url or set rpcUrl in config.", exitCode: 1 };
  }
  // Best-effort cluster sanity: an obvious envelope/endpoint mismatch is refused, not simulated.
  const host = rpcUrl.toLowerCase();
  if (network === "mainnet-beta" && host.includes("devnet")) {
    return { text: "Refusing: the envelope targets mainnet-beta but --rpc-url looks like a devnet endpoint.", exitCode: 1 };
  }
  if (network === "devnet" && host.includes("mainnet")) {
    return { text: "Refusing: the envelope targets devnet but --rpc-url looks like a mainnet endpoint.", exitCode: 1 };
  }

  const makePreview = ctx.createTxPreview ?? createTxPreviewRpc;
  let report: TxSimulationReport;
  try {
    const preview = makePreview(rpcUrl);
    report = await simulateUnsignedEnvelope(preview, envelopeValue, { clock: ctx.now });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // Optional write: ONLY the report JSON (UTF-8; overwrite refused earlier without --force).
  let wroteLine = "";
  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(report), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write simulation report at ${resolved}`), exitCode: 1 };
    }
    wroteLine = `\nwrote ${resolved}`;
  }

  const exitCode = opts.failOnNotOk && report.outcome !== "simulated-ok" ? 1 : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(report), null, 2), exitCode };
  }
  const lines = [
    formatTxSimulationReport(report) + wroteLine,
    "",
    "Next:",
    "- A simulated-ok outcome is evidence for operator review — it does NOT arm anything and is NOT live-trading readiness.",
    "- Inspect the JSON: re-run with --json (or open the --out file in the web inspector).",
  ];
  return { text: redactString(lines.join("\n")), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 92 — execution:status / execution:build / execution:devnet:send
//   The GATED execution boundary's operator surface. Status shows the resolved
//   execution mode + the FULL fourteen-condition mainnet live-gate checklist
//   (default: BLOCKED, every condition failed). Build wraps the refusal-first
//   unsigned swap builder. Devnet send is the ONLY send surface tonight —
//   mainnet sending deliberately has NO CLI surface.
// ---------------------------------------------------------------------------

/** Convert a SOL decimal string to lamports (integer string); throws on bad input. */
function solFlagToLamports(flag: string, name: string): string {
  const match = /^([0-9]+)(?:\.([0-9]{1,9}))?$/.exec(flag.trim());
  if (!match) throw new Error(`${name} must be a plain decimal with at most 9 decimal places`);
  const raw = `${match[1]}${(match[2] ?? "").padEnd(9, "0")}`.replace(/^0+(?=[0-9])/, "");
  if (/^0+$/.test(raw)) throw new Error(`${name} must be greater than zero`);
  return raw;
}

/** Is the emergency stop engaged? (env flag OR a stop file in the working directory). */
function emergencyStopPresent(ctx: CommandContext): boolean {
  const env = ctx.env ?? process.env;
  if (typeof env["SOULMAKER_EMERGENCY_STOP"] === "string" && env["SOULMAKER_EMERGENCY_STOP"].length > 0) return true;
  return existsSync(resolvePath(ctx, ".soulmaker-emergency-stop"));
}

export interface ExecutionStatusCommandOptions {
  /** What to evaluate: paper (default) | readonly | devnet | mainnet-dry-run | mainnet-live. */
  request?: string;
  acknowledgeDevnetExecution?: boolean;
  iUnderstandThisCanLoseRealMoney?: boolean;
  /**
   * Sprint 93: a LIVE quote fetch report (routequote.fetch.report.v1) whose fetchedAt provenance
   * feeds live-gate condition 9 — evaluated against --max-quote-age-ms. Operator-supplied
   * artifacts (routequote.prepared.v1 / observation inputs) are REFUSED here: hand-typed quotes
   * can never satisfy live freshness.
   */
  quoteReportPath?: string;
  /** Sprint 93: the EXPLICIT quote age cap in ms (required with --quote-report; no default). */
  maxQuoteAgeMs?: string;
  json?: boolean;
  outPath?: string;
  force?: boolean;
}

interface StatusQuoteFreshness {
  sourceSchema: string;
  fetchedAt: string | null;
  capMs: number | null;
  verdict: string;
  ageMs: number | null;
  detail: string;
}

/**
 * Resolve live-gate condition 9 inputs from an operator-named quote fetch report (S93). Returns
 * an error string on refusal; a parsed freshness block otherwise. ONLY a live
 * `routequote.fetch.report.v1` qualifies — operator-supplied quote artifacts are refused by
 * schema, and a missing/invalid cap fails closed inside the evaluator.
 */
function resolveStatusQuoteFreshness(
  ctx: CommandContext,
  quoteReportPath: string,
  maxQuoteAgeMsFlag: string | undefined,
): { ok: true; freshness: StatusQuoteFreshness; quoteFresh: boolean } | { ok: false; message: string } {
  let value: unknown;
  try {
    value = readJsonValue(ctx, quoteReportPath, "quote fetch report");
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  if (!isPlainObject(value) || typeof value.schemaVersion !== "string") {
    return { ok: false, message: "--quote-report is not a schema-versioned artifact" };
  }
  if (value.schemaVersion !== "routequote.fetch.report.v1") {
    return {
      ok: false,
      message:
        `--quote-report has schemaVersion "${value.schemaVersion}" — only a LIVE routequote.fetch.report.v1 can feed live-gate condition 9. ` +
        "Operator-supplied quote artifacts (routequote.prepared.v1 / observation inputs) are deliberately refused here: hand-typed quotes can never satisfy live freshness.",
    };
  }
  const fetchedAt = typeof value.fetchedAt === "string" ? value.fetchedAt : null;
  const capMs = maxQuoteAgeMsFlag === undefined ? null : Number(maxQuoteAgeMsFlag);
  const nowMs = ctx.now ? Date.parse(ctx.now()) : Date.now();
  const freshness: QuoteFreshnessResult = evaluateQuoteFreshness({ fetchedAt, nowMs, maxAgeMs: capMs });
  return {
    ok: true,
    quoteFresh: freshness.fresh,
    freshness: {
      sourceSchema: "routequote.fetch.report.v1",
      fetchedAt,
      capMs: Number.isInteger(capMs) && (capMs as number) > 0 ? capMs : null,
      verdict: freshness.verdict,
      ageMs: freshness.ageMs,
      detail: freshness.detail,
    },
  };
}

/**
 * `soulmaker execution:status` — resolve and SHOW the execution mode honestly: the closed mode
 * set, why the resolution landed where it did, the full fourteen-condition mainnet live-gate
 * checklist, the long-standing core live gate, and the emergency-stop state. Pure read; this
 * command can never arm anything.
 */
export function executionStatusReport(
  ctx: CommandContext = {},
  opts: ExecutionStatusCommandOptions = {},
): CliReport {
  let config: Config;
  try {
    config = loadConfig(toLoadOptions(ctx));
  } catch (err) {
    const msg = err instanceof ConfigError ? err.message : String(err);
    return { text: redactString(`Refusing: config is invalid.\n\n${msg}`), exitCode: 1 };
  }
  const env = (ctx.env ?? process.env) as Record<string, string | undefined>;
  const stop = emergencyStopPresent(ctx);

  // S93: an operator-named LIVE quote fetch report (+ explicit cap) feeds condition 9 honestly.
  let quoteFreshness: StatusQuoteFreshness | null = null;
  let quoteFresh: boolean | null = null; // no report named -> honestly unsatisfied
  if (opts.quoteReportPath) {
    const resolvedQuote = resolveStatusQuoteFreshness(ctx, opts.quoteReportPath, opts.maxQuoteAgeMs);
    if (!resolvedQuote.ok) {
      return { text: redactString(`Refusing: ${resolvedQuote.message}`), exitCode: 1 };
    }
    quoteFreshness = resolvedQuote.freshness;
    quoteFresh = resolvedQuote.quoteFresh;
  } else if (opts.maxQuoteAgeMs !== undefined) {
    return { text: "Refusing: --max-quote-age-ms requires --quote-report (a cap without a quote evaluates nothing).", exitCode: 1 };
  }

  const resolved: ResolvedExecutionMode = resolveExecutionMode({
    requested: opts.request ?? "paper",
    env,
    devnetCliAcknowledged: Boolean(opts.acknowledgeDevnetExecution),
    liveGateInput: {
      env,
      configPhase7LiveTradingReady: config.phase7LiveTradingReady,
      cliAcknowledged: Boolean(opts.iUnderstandThisCanLoseRealMoney),
      network: "mainnet-beta",
      maxSpendLamports: solFlagToLamports(String(config.caps.maxTradeSizeSol), "caps.maxTradeSizeSol"),
      sessionLossCapSol: config.caps.maxDailyLossSol,
      slippageCapBps: null, // no slippage cap exists in config yet — honestly unsatisfied
      killSwitchActive: config.killSwitch || stop ? true : false,
      quoteFresh, // S93: real verdict when a live fetch report was named; otherwise unsatisfied
      simulationOutcome: null, // no simulation — honestly unsatisfied
      riskScore: null,
      riskScoreCap: null,
      walletPublicKeyValid: false,
      signerBoundaryKind: null,
      auditLogPathProvided: false,
      redactionFindings: null,
    },
  });
  // The status surface ALWAYS shows the gate checklist, even for paper/readonly requests.
  const liveGate = resolved.liveGate ?? evaluateMainnetLiveGate({ env, configPhase7LiveTradingReady: config.phase7LiveTradingReady });
  const coreGate = evaluateLiveGate(config, env as NodeJS.ProcessEnv);

  const status = {
    schemaVersion: "execution.status.report.v1",
    requested: opts.request ?? "paper",
    mode: resolved.mode,
    reasons: resolved.reasons,
    killSwitch: config.killSwitch,
    emergencyStopPresent: stop,
    mainnetLiveGate: {
      armed: liveGate.armed,
      satisfiedCount: liveGate.checks.filter((c) => c.satisfied).length,
      totalChecks: liveGate.checks.length,
      checks: liveGate.checks,
    },
    coreLiveGate: { open: coreGate.allowed, reasons: coreGate.reasons },
    quoteFreshness, // S93: null when no live fetch report was named
    liveTradingEnvFlag: LIVE_TRADING_ENV_FLAG,
    devnetExecutionEnvFlag: DEVNET_EXECUTION_ENV_FLAG,
    phase7LiveTradingReady: config.phase7LiveTradingReady,
    note: "Live trading requires BOTH gates (the fourteen-condition execution gate AND the core DANGEROUS_BURNER_LIVE gate). Default state: blocked. Mainnet sending has NO CLI surface in Sprint 92.",
  };

  let wroteLine = "";
  if (opts.outPath) {
    const resolvedPath = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolvedPath)) {
      return { text: redactString(`Refusing: ${resolvedPath} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolvedPath, JSON.stringify(redactValue(status), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write execution status at ${resolvedPath}`), exitCode: 1 };
    }
    wroteLine = `\nwrote ${resolvedPath}`;
  }

  if (opts.json) {
    return { text: JSON.stringify(redactValue(status), null, 2), exitCode: 0 };
  }
  const lines: string[] = [];
  lines.push("EXECUTION STATUS (read-only; this command can never arm anything)");
  lines.push("=================================================================");
  lines.push(`requested:        ${status.requested}`);
  lines.push(`resolved mode:    ${status.mode}`);
  for (const reason of resolved.reasons) lines.push(`  - ${reason}`);
  lines.push(`kill switch:      ${config.killSwitch ? "ENGAGED" : "off"}`);
  lines.push(`emergency stop:   ${stop ? "PRESENT (everything refuses)" : "absent"}`);
  lines.push("");
  lines.push(
    `mainnet live gate: ${liveGate.armed ? "ARMED (!!)" : "BLOCKED"} — ${status.mainnetLiveGate.satisfiedCount}/${status.mainnetLiveGate.totalChecks} conditions satisfied`,
  );
  for (const check of liveGate.checks) {
    lines.push(`  [${check.satisfied ? "x" : " "}] ${check.gate}: ${check.detail}`);
  }
  lines.push("");
  lines.push(`core live gate:   ${coreGate.allowed ? "OPEN (!!)" : "CLOSED (safe)"}`);
  if (!coreGate.allowed) for (const reason of coreGate.reasons) lines.push(`  - ${reason}`);
  if (quoteFreshness !== null) {
    lines.push("");
    lines.push(`quote freshness:  ${quoteFreshness.verdict.toUpperCase()} — ${quoteFreshness.detail}`);
    lines.push(`  fetchedAt: ${quoteFreshness.fetchedAt ?? "missing"} | age: ${quoteFreshness.ageMs ?? "n/a"}ms | cap: ${quoteFreshness.capMs ?? "MISSING"}ms`);
  }
  lines.push("");
  lines.push(status.note);
  return { text: redactString(lines.join("\n")) + wroteLine, exitCode: 0 };
}

export interface ExecutionReadinessCommandOptions {
  /** A LIVE routequote.fetch.report.v1 for condition 9 (operator-supplied artifacts refused). */
  quoteReportPath?: string;
  /** The EXPLICIT quote age cap in ms for condition 9. */
  maxQuoteAgeMs?: string;
  /** A token:risk --json report for condition 11. */
  riskPath?: string;
  /** The EXPLICIT advisory risk score cap for condition 11. */
  riskScoreCap?: string;
  /** A txpreview.simulation.report.v1 for condition 10. */
  simulationPath?: string;
  /** The EXPLICIT slippage cap in bps for condition 7 (config has none yet). */
  slippageCapBps?: string;
  /** The destination wallet PUBLIC key for condition 12. */
  wallet?: string;
  /** The audit log path that WOULD be used (condition 14's path half). */
  auditLog?: string;
  json?: boolean;
  outPath?: string;
  force?: boolean;
}

const READINESS_NEXT_ACTIONS: Readonly<Record<string, string>> = {
  "env-acknowledgment":
    "remains unset until a FUTURE sprint explicitly authorizes live trading — there is no readiness shortcut",
  "config-phase7-ready":
    "config phase7LiveTradingReady stays false until Phase 7 is explicitly authorized and implemented",
  "cli-acknowledgment":
    "the --i-understand-this-can-lose-real-money flag exists only at execution time; readiness never accepts it",
  "network-mainnet-beta": "evaluated against mainnet-beta",
  "max-spend-cap": "set an explicit per-trade cap via config caps.maxTradeSizeSol",
  "session-loss-cap": "set an explicit session loss cap via config caps.maxDailyLossSol",
  "slippage-cap": "pass --slippage-cap-bps <bps> (no default exists by design)",
  "kill-switch-clear": "clear config killSwitch and remove any emergency-stop file/env",
  "quote-fresh":
    "fetch a LIVE quote (paper:routequote:fetch --json --out quotes.json) then pass --quote-report quotes.json --max-quote-age-ms <ms>",
  "simulation-ok":
    "build an unsigned envelope (execution:build --request mainnet-dry-run ... --out envelope.json), simulate it (paper:simulation:tx --envelope envelope.json --out sim.json), then pass --simulation sim.json",
  "risk-under-threshold": "run token:risk <mint> --deep --json --out risk.json, then pass --risk risk.json --risk-score-cap <n>",
  "wallet-validated": "pass --wallet <publicKey> (a PUBLIC key; never a secret)",
  "signer-boundary":
    "the signer boundary loads ONLY at execution time through --signer-env; readiness never loads key material",
  "audit-and-redaction":
    "pass --audit-log <path>; redaction findings finalize at execution time over the attempt's artifacts",
};

/**
 * Risk-flag ids produced by the S93 Token-2022 extension checks. Readiness surfaces these
 * individually so an operator sees EXACTLY which extension facts ride on the risk evidence —
 * critical/high entries are the blockers (transfer hooks, permanent delegates, frozen-by-default
 * accounts, pausable tokens, transfer fees, mint close authority).
 */
const TOKEN2022_RISK_FLAG_IDS: ReadonlySet<string> = new Set([
  "token-2022-program",
  "token-2022-extensions-unknown",
  "transfer-hook-present",
  "permanent-delegate-present",
  "non-transferable-token",
  "default-account-state-frozen",
  "pausable-token",
  "transfer-fee-present",
  "transfer-fee-extreme",
  "mint-close-authority-present",
  "confidential-transfers-enabled",
  "scaled-ui-amount-present",
  "interest-bearing-token",
  "metadata-pointer-present",
  "token-2022-unexamined-extension",
  "token-2022-no-risky-extensions",
]);

/**
 * `soulmaker execution:readiness` — the HONEST mainnet readiness checklist (Sprint 93): every
 * one of the fourteen live-gate conditions evaluated against operator-NAMED evidence (live
 * quote report + explicit age cap, risk report + explicit cap, simulation report, wallet,
 * audit path), each failure named with its exact next safe action. STRUCTURALLY incapable of
 * reporting "armed": the CLI acknowledgment, the signer boundary, and the redaction findings
 * evaluate only at execution time, so at least three conditions always remain unsatisfied
 * here. No bypass flag, no force-arm flag, no env-only enable — deliberately. Read-only.
 */
export function executionReadinessReport(
  ctx: CommandContext = {},
  opts: ExecutionReadinessCommandOptions = {},
): CliReport {
  let config: Config;
  try {
    config = loadConfig(toLoadOptions(ctx));
  } catch (err) {
    const msg = err instanceof ConfigError ? err.message : String(err);
    return { text: redactString(`Refusing: config is invalid.\n\n${msg}`), exitCode: 1 };
  }
  const env = (ctx.env ?? process.env) as Record<string, string | undefined>;
  const stop = emergencyStopPresent(ctx);

  if (opts.outPath) {
    const resolvedPath = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolvedPath)) {
      return { text: redactString(`Refusing: ${resolvedPath} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
  }

  // Condition 9 evidence: a LIVE quote fetch report + the explicit cap.
  let quoteFreshness: StatusQuoteFreshness | null = null;
  let quoteFresh: boolean | null = null;
  if (opts.quoteReportPath) {
    const resolvedQuote = resolveStatusQuoteFreshness(ctx, opts.quoteReportPath, opts.maxQuoteAgeMs);
    if (!resolvedQuote.ok) {
      return { text: redactString(`Refusing: ${resolvedQuote.message}`), exitCode: 1 };
    }
    quoteFreshness = resolvedQuote.freshness;
    quoteFresh = resolvedQuote.quoteFresh;
  } else if (opts.maxQuoteAgeMs !== undefined) {
    return { text: "Refusing: --max-quote-age-ms requires --quote-report (a cap without a quote evaluates nothing).", exitCode: 1 };
  }

  // Condition 11 evidence: a token:risk report + the explicit cap. S94: the Token-2022
  // extension flags riding on the report are surfaced individually (the critical/high ones are
  // the extension blockers).
  let riskScore: number | null = null;
  let riskMint: string | null = null;
  let riskDecision: string | null = null;
  const riskToken2022Flags: Array<{ id: string; severity: string }> = [];
  if (opts.riskPath) {
    let riskValue: unknown;
    try {
      riskValue = readJsonValue(ctx, opts.riskPath, "token risk report");
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    if (!isPlainObject(riskValue) || typeof riskValue.score !== "number" || typeof riskValue.decision !== "string") {
      return { text: "Refusing: --risk file is not a token:risk --json report (score/decision missing).", exitCode: 1 };
    }
    riskScore = riskValue.score;
    riskMint = typeof riskValue.mint === "string" ? riskValue.mint : null;
    riskDecision = riskValue.decision;
    if (Array.isArray(riskValue.flags)) {
      for (const flag of riskValue.flags) {
        if (isPlainObject(flag) && typeof flag.id === "string" && TOKEN2022_RISK_FLAG_IDS.has(flag.id)) {
          riskToken2022Flags.push({ id: flag.id, severity: typeof flag.severity === "string" ? flag.severity : "unknown" });
        }
      }
    }
  }
  const riskScoreCap = opts.riskScoreCap === undefined ? null : Number(opts.riskScoreCap);

  // Condition 10 evidence: a txpreview simulation report.
  let simulationOutcome: string | null = null;
  let simulationDetail: { endpointHost: string | null; simulatedAt: string | null } | null = null;
  if (opts.simulationPath) {
    let simValue: unknown;
    try {
      simValue = readJsonValue(ctx, opts.simulationPath, "simulation report");
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    if (!isPlainObject(simValue) || simValue.schemaVersion !== "txpreview.simulation.report.v1" || typeof simValue.outcome !== "string") {
      return { text: "Refusing: --simulation is not a txpreview.simulation.report.v1 artifact.", exitCode: 1 };
    }
    simulationOutcome = simValue.outcome;
    simulationDetail = {
      endpointHost: typeof simValue.endpointHost === "string" ? simValue.endpointHost : null,
      simulatedAt: typeof simValue.simulatedAt === "string" ? simValue.simulatedAt : null,
    };
  }

  // Condition 12 evidence: the destination wallet PUBLIC key.
  let walletPublicKeyValid = false;
  if (opts.wallet) {
    try {
      parsePublicKey(opts.wallet);
      walletPublicKeyValid = true;
    } catch {
      return { text: "Refusing: --wallet is not a valid base58 PUBLIC key (never paste secret key material).", exitCode: 1 };
    }
  }

  const slippageCapBps = opts.slippageCapBps === undefined ? null : Number(opts.slippageCapBps);

  const gate = evaluateMainnetLiveGate({
    env,
    configPhase7LiveTradingReady: config.phase7LiveTradingReady,
    cliAcknowledged: false, // NEVER accepted here — execution-time only
    network: "mainnet-beta",
    maxSpendLamports: solFlagToLamports(String(config.caps.maxTradeSizeSol), "caps.maxTradeSizeSol"),
    sessionLossCapSol: config.caps.maxDailyLossSol,
    slippageCapBps: Number.isInteger(slippageCapBps) ? slippageCapBps : null,
    killSwitchActive: config.killSwitch || stop ? true : false,
    quoteFresh,
    simulationOutcome,
    riskScore,
    riskScoreCap: Number.isFinite(riskScoreCap as number) ? riskScoreCap : null,
    walletPublicKeyValid,
    signerBoundaryKind: null, // NEVER loaded here — readiness never touches key material
    auditLogPathProvided: typeof opts.auditLog === "string" && opts.auditLog.trim().length > 0,
    redactionFindings: null, // finalize at execution time over the attempt's artifacts
  });

  const conditions = gate.checks.map((check) => ({
    gate: check.gate,
    satisfied: check.satisfied,
    detail: check.detail,
    nextAction: READINESS_NEXT_ACTIONS[check.gate] ?? "no shortcut exists",
  }));
  const missing = conditions.filter((c) => !c.satisfied);

  const report = {
    schemaVersion: "execution.readiness.report.v1",
    banner:
      "MAINNET READINESS CHECKLIST — an honest, read-only evaluation of the fourteen live-gate conditions against operator-named evidence. This command can NEVER report armed (the CLI acknowledgment, the signer boundary, and the redaction findings evaluate only at execution time), it has no bypass or force flag, and nothing it prints is an authorization.",
    generatedAt: (ctx.now ?? isoNow)(),
    network: "mainnet-beta",
    /** What this checklist evaluates AGAINST — never what it can do. Readiness cannot execute. */
    requestedMode: "mainnet-live (evaluation only — this command can never execute or arm)",
    mode: { killSwitch: config.killSwitch, emergencyStopPresent: stop, configPhase7LiveTradingReady: config.phase7LiveTradingReady },
    verdict: "blocked" as const,
    satisfiedCount: conditions.filter((c) => c.satisfied).length,
    totalChecks: conditions.length,
    conditions,
    blockedReason: `${missing.length} of ${conditions.length} live-gate condition(s) unsatisfied: ${missing.map((c) => c.gate).join(", ")}`,
    /** S94: the explicit operator caps this evaluation ran with (null = not supplied; no defaults exist). */
    caps: {
      maxSpendPerTradeSol: config.caps.maxTradeSizeSol,
      sessionLossCapSol: config.caps.maxDailyLossSol,
      slippageCapBps: Number.isInteger(slippageCapBps) ? slippageCapBps : null,
      riskScoreCap: Number.isFinite(riskScoreCap as number) ? riskScoreCap : null,
      quoteAgeCapMs: quoteFreshness?.capMs ?? null,
    },
    evidence: {
      quoteFreshness,
      risk:
        riskScore === null
          ? null
          : {
              score: riskScore,
              mint: riskMint,
              decision: riskDecision,
              cap: Number.isFinite(riskScoreCap as number) ? riskScoreCap : null,
              /** Where the risk evidence came from — readiness only ever accepts a named file. */
              source: `operator-named file: ${opts.riskPath ?? ""}`,
              /** S94: Token-2022 extension flags riding on the report (critical/high = blockers). */
              token2022Flags: riskToken2022Flags,
            },
      simulation: simulationOutcome === null ? null : { outcome: simulationOutcome, ...simulationDetail },
      wallet: walletPublicKeyValid ? opts.wallet : null,
      auditLogPath: opts.auditLog ?? null,
      /** Readiness NEVER loads key material; the boundary is an execution-time construct. */
      signerBoundary: "not-loaded — key material loads only at execution time through --signer-env",
    },
    mainnetDryRunNote:
      "mainnet-dry-run needs NO gate: execution:build --request mainnet-dry-run builds + paper:simulation:tx simulates against real chain state, and neither can send.",
    nextSafeAction:
      missing.length > 0
        ? `${missing[0]?.gate}: ${READINESS_NEXT_ACTIONS[missing[0]?.gate ?? ""] ?? "no shortcut exists"}`
        : "none — and even a fully-evidenced checklist arms nothing from this command",
    phase7LiveTradingReady: false,
    neverSends: true,
    caveats: [
      "Readiness is evidence collection, not authorization — the send path re-verifies every condition itself.",
      "Mainnet sending has NO CLI surface; opening one requires a separate explicitly-authorized future sprint.",
    ],
  };

  let wroteLine = "";
  if (opts.outPath) {
    const resolvedPath = resolvePath(ctx, opts.outPath);
    try {
      writeFileSync(resolvedPath, JSON.stringify(redactValue(report), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write readiness report at ${resolvedPath}`), exitCode: 1 };
    }
    wroteLine = `\nwrote ${resolvedPath}`;
  }
  if (opts.json) {
    return { text: JSON.stringify(redactValue(report), null, 2) + wroteLine, exitCode: 0 };
  }
  const lines: string[] = [];
  lines.push("MAINNET READINESS CHECKLIST (read-only; can never arm anything)");
  lines.push("================================================================");
  lines.push(`network:     mainnet-beta | evaluated for: mainnet-live (evaluation only)`);
  lines.push(`verdict:     BLOCKED — ${report.satisfiedCount}/${report.totalChecks} conditions satisfied`);
  lines.push(`kill switch: ${config.killSwitch ? "ENGAGED" : "off"} | emergency stop: ${stop ? "PRESENT" : "absent"}`);
  lines.push(
    `caps:        spend/trade ${report.caps.maxSpendPerTradeSol} SOL | session loss ${report.caps.sessionLossCapSol} SOL | slippage ${report.caps.slippageCapBps ?? "UNSET"} bps | risk score ${report.caps.riskScoreCap ?? "UNSET"} | quote age ${report.caps.quoteAgeCapMs ?? "UNSET"} ms`,
  );
  lines.push("");
  for (const c of conditions) {
    lines.push(`  [${c.satisfied ? "x" : " "}] ${c.gate}: ${c.detail}`);
    if (!c.satisfied) lines.push(`        next: ${c.nextAction}`);
  }
  lines.push("");
  if (quoteFreshness !== null) {
    lines.push(`quote freshness: ${quoteFreshness.verdict.toUpperCase()} (age ${quoteFreshness.ageMs ?? "n/a"}ms, cap ${quoteFreshness.capMs ?? "MISSING"}ms)`);
  }
  if (riskScore !== null) {
    lines.push(`risk evidence:   score ${riskScore} (cap ${report.caps.riskScoreCap ?? "UNSET"}; decision ${riskDecision ?? "unknown"}; source: operator-named file)`);
    if (riskToken2022Flags.length > 0) {
      lines.push(`token-2022:      ${riskToken2022Flags.map((f) => `${f.id} [${f.severity}]`).join(", ")}`);
    }
  }
  lines.push(`simulation:      ${simulationOutcome ?? "not supplied"} | signer boundary: never loaded here | audit path: ${opts.auditLog ?? "not supplied"}`);
  lines.push(`next safe action: ${report.nextSafeAction}`);
  lines.push(report.mainnetDryRunNote);
  lines.push("");
  for (const caveat of report.caveats) lines.push(`CAVEAT: ${caveat}`);
  return { text: redactString(lines.join("\n")) + wroteLine, exitCode: 0 };
}

export interface ExecutionBuildCommandOptions {
  candidateMint?: string;
  inputMint?: string;
  amountRaw?: string;
  amountSol?: string;
  slippageBps?: string;
  /** The wallet PUBLIC key the unsigned transaction is built FOR. */
  wallet?: string;
  /** token:risk --json output file for the candidate (required). */
  riskPath?: string;
  /** Requested mode for the build: devnet | mainnet-dry-run | mainnet-live. */
  request?: string;
  acknowledgeDevnetExecution?: boolean;
  iUnderstandThisCanLoseRealMoney?: boolean;
  maxSpendSol?: string;
  slippageCapBps?: string;
  riskScoreCap?: string;
  /** Sprint 93: explicit quote-age cap in ms — a build whose fresh quote aged past it refuses. */
  maxQuoteAgeMs?: string;
  endpoint?: string;
  allowPaperRead?: boolean;
  json?: boolean;
  outPath?: string;
  force?: boolean;
}

/**
 * `soulmaker execution:build` — the refusal-first unsigned swap build. EVERY refusal reason is
 * evaluated before any network call; the only possible artifact is a strictly-validated UNSIGNED
 * envelope for `paper:simulation:tx`. Building never signs and never sends.
 */
export async function executionBuildReport(
  ctx: CommandContext = {},
  opts: ExecutionBuildCommandOptions = {},
): Promise<CliReport> {
  if (!opts.candidateMint) return { text: "Refusing: --candidate-mint <mint> is required.", exitCode: 1 };
  if (!opts.wallet) return { text: "Refusing: --wallet <publicKey> is required (a PUBLIC key; never a secret).", exitCode: 1 };
  if (!opts.riskPath) return { text: "Refusing: --risk <token-risk.json> is required (run token:risk --json --out first; building blind is never allowed).", exitCode: 1 };
  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
  }

  let config: Config;
  try {
    config = loadConfig(toLoadOptions(ctx));
  } catch (err) {
    const msg = err instanceof ConfigError ? err.message : String(err);
    return { text: redactString(`Refusing: config is invalid.\n\n${msg}`), exitCode: 1 };
  }
  const caps = capabilitiesFor(config.mode);
  if (!caps.canReadChain && !(config.mode === "PAPER" && opts.allowPaperRead === true)) {
    return {
      text: `Refusing: mode ${config.mode} does not read the network. Use WATCH_ONLY/SIMULATION, or pass --allow-paper-read.`,
      exitCode: 1,
    };
  }
  const env = (ctx.env ?? process.env) as Record<string, string | undefined>;
  const stop = emergencyStopPresent(ctx);

  // Amount: exactly one of --amount-raw / --amount-sol.
  if ((opts.amountRaw === undefined) === (opts.amountSol === undefined)) {
    return { text: "Refusing: pass exactly one of --amount-raw <units> or --amount-sol <sol>.", exitCode: 1 };
  }
  let amountRaw: string;
  try {
    amountRaw = opts.amountRaw !== undefined ? opts.amountRaw.trim() : solFlagToLamports(opts.amountSol as string, "--amount-sol");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // Caps: explicit flags, TIGHTEN-ONLY against the config hard caps.
  if (!opts.maxSpendSol) return { text: "Refusing: --max-spend-sol <sol> is required (an explicit per-trade spend cap).", exitCode: 1 };
  let maxSpendLamports: string;
  try {
    maxSpendLamports = solFlagToLamports(opts.maxSpendSol, "--max-spend-sol");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }
  if (Number(opts.maxSpendSol) > config.caps.maxTradeSizeSol) {
    return {
      text: `Refusing: --max-spend-sol ${opts.maxSpendSol} exceeds the config cap caps.maxTradeSizeSol=${config.caps.maxTradeSizeSol} (caps only tighten).`,
      exitCode: 1,
    };
  }
  const slippageBps = opts.slippageBps === undefined ? null : Number(opts.slippageBps);
  const slippageCapBps = opts.slippageCapBps === undefined ? null : Number(opts.slippageCapBps);
  const riskScoreCap = opts.riskScoreCap === undefined ? null : Number(opts.riskScoreCap);
  let maxQuoteAgeMs: number | null = null;
  if (opts.maxQuoteAgeMs !== undefined) {
    const cap = Number(opts.maxQuoteAgeMs);
    if (!Number.isInteger(cap) || cap <= 0) {
      return { text: "Refusing: --max-quote-age-ms must be a positive integer of milliseconds.", exitCode: 1 };
    }
    maxQuoteAgeMs = cap;
  }

  // Risk file: the candidate's token:risk --json output, mint cross-checked.
  let riskValue: unknown;
  try {
    riskValue = readJsonValue(ctx, opts.riskPath, "token risk report");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }
  if (!isPlainObject(riskValue) || typeof riskValue.score !== "number" || typeof riskValue.decision !== "string") {
    return { text: "Refusing: --risk file is not a token:risk --json report (score/decision missing).", exitCode: 1 };
  }
  if (riskValue.mint !== opts.candidateMint) {
    return { text: "Refusing: the --risk report is for a DIFFERENT mint than --candidate-mint.", exitCode: 1 };
  }

  const resolved = resolveExecutionMode({
    requested: opts.request ?? "paper",
    env,
    devnetCliAcknowledged: Boolean(opts.acknowledgeDevnetExecution),
    liveGateInput: { env, configPhase7LiveTradingReady: config.phase7LiveTradingReady, cliAcknowledged: Boolean(opts.iUnderstandThisCanLoseRealMoney) },
  });

  const makeBuilder = ctx.createSwapBuilder ?? createJupiterSwapBuilder;
  const builder = makeBuilder({ baseUrl: opts.endpoint, clock: ctx.now });
  const result = await builder.build({
    candidateMint: opts.candidateMint,
    inputMint: opts.inputMint ?? WSOL_MINT,
    amountRaw,
    slippageBps,
    walletPublicKey: opts.wallet,
    network: opts.request === "devnet" ? "devnet" : "mainnet-beta",
    executionMode: resolved.mode,
    killSwitchActive: config.killSwitch || stop,
    risk: { score: riskValue.score, decision: riskValue.decision },
    controls: { maxSpendLamports, slippageCapBps, riskScoreCap, maxQuoteAgeMs },
  });

  if (!result.built) {
    const lines = [
      `BUILD REFUSED (${result.refusals.length} reason(s); resolved mode: ${resolved.mode})`,
      ...result.refusals.map((r) => `  - ${r.code}: ${r.detail}`),
      "",
      "Nothing was fetched or built unless every pre-network check passed. Fix the refusals and re-run.",
    ];
    if (opts.json) {
      return { text: JSON.stringify(redactValue({ built: false, mode: resolved.mode, refusals: result.refusals }), null, 2), exitCode: 1 };
    }
    return { text: redactString(lines.join("\n")), exitCode: 1 };
  }

  // S93 fix: txBase64 is strictly-validated PUBLIC transaction bytes whose 64 zero-byte
  // signature slot encodes to a long base64 'A' run — the base58-blob redaction backstop can
  // false-positive on it and corrupt the envelope. Everything else stays behind the backstop;
  // the envelope validator (closed schema, bounded redaction-stable fields) is the wall for
  // txBase64 itself.
  const envelopeOut = { ...(redactValue(result.envelope) as Record<string, unknown>), txBase64: result.envelope.txBase64 };

  let wroteLine = "";
  if (opts.outPath) {
    const resolvedPath = resolvePath(ctx, opts.outPath);
    try {
      writeFileSync(resolvedPath, JSON.stringify(envelopeOut, null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write envelope at ${resolvedPath}`), exitCode: 1 };
    }
    wroteLine = `\nwrote ${resolvedPath}`;
  }

  if (opts.json) {
    return {
      text: JSON.stringify({ ...(redactValue({ built: true, mode: resolved.mode, quoteFacts: result.quoteFacts }) as Record<string, unknown>), envelope: envelopeOut }, null, 2),
      exitCode: 0,
    };
  }
  const lines = [
    "UNSIGNED SWAP ENVELOPE BUILT (nothing signed, nothing sent)",
    `mode:         ${resolved.mode}`,
    `builder:      ${result.envelope.builderId}`,
    `candidate:    ${result.envelope.candidateMint}`,
    `fee payer:    ${result.envelope.feePayerPublicKey} (public key)`,
    `quote:        in ${result.quoteFacts.inAmountRaw} raw -> out ${result.quoteFacts.outAmountRaw} raw @ ${result.quoteFacts.quotedAt}`,
    `impact:       ${result.quoteFacts.priceImpactPct ?? "not reported"}%`,
    wroteLine.trim(),
    "",
    "Next:",
    `- Simulate it for real (no signer needed): pnpm soulmaker paper:simulation:tx --envelope "${opts.outPath ?? "<envelope.json>"}" --rpc-url <mainnet rpc> --allow-paper-read`,
    "- An unsigned envelope is simulation material — never an order, never live-trading readiness.",
  ];
  return { text: redactString(lines.filter((l) => l !== "").join("\n")), exitCode: 0 };
}

export interface ExecutionDevnetSendCommandOptions {
  envelopePath?: string;
  /** The NAME of the env var holding the devnet keypair file PATH. */
  signerEnvVar?: string;
  rpcUrl?: string;
  acknowledgeDevnetExecution?: boolean;
  /** Append-only JSONL audit log path (required). */
  auditLog?: string;
  /** Explicit advisory risk score for the trade context (required; probes use 0). */
  riskScore?: string;
  /** Sprint 93: tighten the quote-age cap (ms) below the 60s devnet-probe ceiling. */
  maxQuoteAgeMs?: string;
  json?: boolean;
}

/** The devnet-probe quote-age ceiling (S92); --max-quote-age-ms may only TIGHTEN below it. */
const DEVNET_SEND_QUOTE_AGE_CAP_MS = 60_000;

/**
 * `soulmaker execution:devnet:send` — the ONLY send surface in Sprint 92, and it is DEVNET-ONLY
 * by construction: the resolved mode must be devnet-execution (env flag + CLI flag), the envelope
 * and the signer boundary must both be devnet, every safety control is enforced, and the attempt
 * (refused or submitted) is appended to the audit log. There is no mainnet variant of this
 * command — deliberately.
 */
export async function executionDevnetSendReport(
  ctx: CommandContext = {},
  opts: ExecutionDevnetSendCommandOptions = {},
): Promise<CliReport> {
  if (!opts.envelopePath) return { text: "Refusing: --envelope <path> is required.", exitCode: 1 };
  if (!opts.signerEnvVar) return { text: "Refusing: --signer-env <ENV_VAR_NAME> is required (the NAME of the env var holding the devnet keypair file PATH).", exitCode: 1 };
  if (!opts.auditLog) return { text: "Refusing: --audit-log <path> is required (every attempt is journaled).", exitCode: 1 };
  if (opts.riskScore === undefined || !Number.isFinite(Number(opts.riskScore))) {
    return { text: "Refusing: --risk-score <n> is required (explicit; a self-transfer probe is 0).", exitCode: 1 };
  }

  let config: Config;
  try {
    config = loadConfig(toLoadOptions(ctx));
  } catch (err) {
    const msg = err instanceof ConfigError ? err.message : String(err);
    return { text: redactString(`Refusing: config is invalid.\n\n${msg}`), exitCode: 1 };
  }
  const env = (ctx.env ?? process.env) as Record<string, string | undefined>;
  const stop = emergencyStopPresent(ctx);

  const resolved = resolveExecutionMode({
    requested: "devnet",
    env,
    devnetCliAcknowledged: Boolean(opts.acknowledgeDevnetExecution),
  });
  if (resolved.mode !== "devnet-execution") {
    return {
      text: redactString(
        [
          "Refusing: devnet execution is NOT enabled.",
          ...resolved.reasons.map((r) => `  - ${r}`),
          `Enable it explicitly: set ${DEVNET_EXECUTION_ENV_FLAG}=${DEVNET_EXECUTION_ENV_VALUE} and pass --acknowledge-devnet-execution.`,
        ].join("\n"),
      ),
      exitCode: 1,
    };
  }

  let envelopeValue: unknown;
  try {
    envelopeValue = readJsonValue(ctx, opts.envelopePath, "unsigned tx envelope");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }
  let envelope;
  try {
    envelope = validateUnsignedTxEnvelope(envelopeValue);
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let signer;
  try {
    signer = loadLocalSignerBoundary({
      envVarName: opts.signerEnvVar,
      env,
      readFile: (path: string) => readFileSync(path, "utf8"),
      network: "devnet",
    });
  } catch (err) {
    const msg = err instanceof SignerBoundaryError ? err.message : "signer boundary failed";
    return { text: redactString(`Refusing: ${msg}`), exitCode: 1 };
  }

  const rpcUrl = opts.rpcUrl ?? "https://api.devnet.solana.com";
  if (rpcUrl.toLowerCase().includes("mainnet")) {
    return { text: "Refusing: execution:devnet:send never talks to a mainnet endpoint.", exitCode: 1 };
  }
  const makeSendRpc = ctx.createSendRpc ?? createSendRpc;
  let sendRpc: SendRpc;
  try {
    sendRpc = makeSendRpc(rpcUrl);
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // Quote-age cap (S93): the 60s devnet-probe ceiling stands; --max-quote-age-ms only tightens.
  let quoteAgeCapMs = DEVNET_SEND_QUOTE_AGE_CAP_MS;
  if (opts.maxQuoteAgeMs !== undefined) {
    const cap = Number(opts.maxQuoteAgeMs);
    if (!Number.isInteger(cap) || cap <= 0 || cap > DEVNET_SEND_QUOTE_AGE_CAP_MS) {
      return {
        text: `Refusing: --max-quote-age-ms must be a positive integer of at most ${DEVNET_SEND_QUOTE_AGE_CAP_MS} (caps only tighten).`,
        exitCode: 1,
      };
    }
    quoteAgeCapMs = cap;
  }

  // Quote age (S93): a swap envelope carries its quote's fetchedAt as `quotedAt` — the REAL age
  // is computed here and a stale/missing/future timestamp refuses at the safety wall. The ONLY
  // quoteless exception is the self-transfer probe (sender == recipient, moves nothing).
  const nowMs = ctx.now ? Date.parse(ctx.now()) : Date.now();
  let quoteAgeMs: number | null;
  if (envelope.builderId === "self-transfer-probe" && envelope.quotedAt === null) {
    quoteAgeMs = 0;
  } else {
    quoteAgeMs = evaluateQuoteFreshness({ fetchedAt: envelope.quotedAt, nowMs, maxAgeMs: quoteAgeCapMs }).ageMs;
  }

  // Devnet probe safety controls — explicit, tight, and honest (devnet SOL is valueless, the
  // discipline is not): one trade, tiny loss cap, cooldown 0, duplicate protection on.
  const controls: OperatorSafetyControls = {
    killSwitchActive: config.killSwitch,
    emergencyStopFilePresent: stop,
    maxSpendPerTradeLamports: envelope.constraints.maxSpendLamports ?? "1",
    maxTradesPerSession: 1,
    sessionLossCapSol: 0.01,
    slippageCapBps: envelope.constraints.slippageBps ?? 0,
    riskScoreCap: 100,
    quoteAgeCapMs,
    allowedMints: null,
    blockedMints: [],
    allowedProviders: null,
    networkLock: "devnet",
    auditLogRequired: true,
    cooldownMs: 0,
    duplicateMintProtection: true,
  };
  const report = await attemptExecution({
    mode: resolved.mode,
    signer,
    envelopeValue,
    rpc: sendRpc.rpc,
    endpointHost: sendRpc.endpointHost,
    controls,
    trade: {
      mint: envelope.candidateMint ?? envelope.feePayerPublicKey,
      provider: envelope.builderId,
      network: envelope.network,
      spendLamports: envelope.constraints.maxSpendLamports ?? "1",
      slippageBps: envelope.constraints.slippageBps ?? 0,
      riskScore: Number(opts.riskScore),
      quoteAgeMs,
      auditLogPathProvided: true,
    },
    session: { tradesCount: 0, sessionLossSol: 0, lastTradeAtMs: null, mintsTraded: [] },
    nowMs,
    clock: ctx.now,
  });

  // Journal the attempt — refused or submitted — before reporting it.
  try {
    appendFileSync(resolvePath(ctx, opts.auditLog), JSON.stringify(redactValue(report)) + "\n");
  } catch {
    return { text: redactString(`Refusing: cannot append the audit log at ${opts.auditLog}`), exitCode: 1 };
  }

  const exitCode = report.outcome === "submitted" ? 0 : 1;
  if (opts.json) {
    return { text: JSON.stringify(redactValue(report), null, 2), exitCode };
  }
  const lines = [
    `DEVNET EXECUTION ATTEMPT: ${report.outcome.toUpperCase()}`,
    `mode:       ${report.mode}`,
    `endpoint:   ${report.endpointHost}`,
    report.signature !== null ? `signature:  ${report.signature}` : `refusal:    ${report.refusalCode}: ${report.refusalDetail}`,
    ...report.safetyViolations.map((v) => `  - ${v.code}: ${v.detail}`),
    `audit log:  ${opts.auditLog} (appended)`,
    "",
    ...report.caveats.map((c) => `CAVEAT: ${c}`),
  ];
  return { text: redactString(lines.join("\n")), exitCode };
}

export interface ExecutionDevnetRehearseCommandOptions {
  /** Output DIRECTORY for the rehearsal artifacts (+ the throwaway keypair). Required. */
  outDir?: string;
  rpcUrl?: string;
  acknowledgeDevnetExecution?: boolean;
  /** Reuse an existing devnet keypair via env var NAME instead of generating a throwaway. */
  signerEnvVar?: string;
  /** Airdrop request in SOL (devnet faucet; valueless). Default 1. */
  airdropSol?: string;
  /** Bounded faucet retries (default 3, hard cap 5 — the faucet is never spammed). */
  airdropAttempts?: string;
  skipAirdrop?: boolean;
  /** Skip the pre-send simulateTransaction step (kept ON by default). */
  skipSimulation?: boolean;
  json?: boolean;
  force?: boolean;
}

const REHEARSAL_REPORT_FILE = "devnet-rehearsal-report.json";
const REHEARSAL_AUDIT_FILE = "devnet-rehearsal-audit.jsonl";
const REHEARSAL_KEYPAIR_FILE = "throwaway.devnet.keypair";

/**
 * `soulmaker execution:devnet:rehearse` — the DEVNET end-to-end broadcast rehearsal (Sprint 93):
 * generate (or load) a devnet-only signer, airdrop devnet SOL, build the unsigned self-transfer
 * probe, simulate it, submit it through the refusal-first send path, confirm it, and write the
 * full honest artifact set into ONE output directory. DEVNET ONLY by construction — same double
 * opt-in as execution:devnet:send; there is NO mainnet variant. A generated throwaway keypair is
 * written ONLY under a `runs/` directory (gitignored) with the gitignored `.keypair` suffix, and
 * its secret bytes never reach a log, report, or terminal. An airdrop rate-limit or faucet
 * outage produces an honest `devnet-funding-blocked` artifact — never a faked success.
 */
export async function executionDevnetRehearseReport(
  ctx: CommandContext = {},
  opts: ExecutionDevnetRehearseCommandOptions = {},
): Promise<CliReport> {
  if (!opts.outDir) return { text: "Refusing: --out <dir> is required (rehearsal artifacts + the throwaway keypair live there).", exitCode: 1 };

  let config: Config;
  try {
    config = loadConfig(toLoadOptions(ctx));
  } catch (err) {
    const msg = err instanceof ConfigError ? err.message : String(err);
    return { text: redactString(`Refusing: config is invalid.\n\n${msg}`), exitCode: 1 };
  }
  const env = (ctx.env ?? process.env) as Record<string, string | undefined>;
  const stop = emergencyStopPresent(ctx);

  const resolved = resolveExecutionMode({
    requested: "devnet",
    env,
    devnetCliAcknowledged: Boolean(opts.acknowledgeDevnetExecution),
  });
  if (resolved.mode !== "devnet-execution") {
    return {
      text: redactString(
        [
          "Refusing: devnet execution is NOT enabled.",
          ...resolved.reasons.map((r) => `  - ${r}`),
          `Enable it explicitly: set ${DEVNET_EXECUTION_ENV_FLAG}=${DEVNET_EXECUTION_ENV_VALUE} and pass --acknowledge-devnet-execution.`,
        ].join("\n"),
      ),
      exitCode: 1,
    };
  }

  const rpcUrl = opts.rpcUrl ?? "https://api.devnet.solana.com";
  if (rpcUrl.toLowerCase().includes("mainnet")) {
    return { text: "Refusing: execution:devnet:rehearse never talks to a mainnet endpoint.", exitCode: 1 };
  }

  let airdropLamports: number | undefined;
  if (opts.airdropSol !== undefined) {
    const sol = Number(opts.airdropSol);
    if (!Number.isFinite(sol) || sol <= 0 || sol > 2) {
      return { text: "Refusing: --airdrop-sol must be a positive number of devnet SOL (at most 2).", exitCode: 1 };
    }
    airdropLamports = Math.round(sol * 1_000_000_000);
  }

  let airdropAttempts: number | undefined;
  if (opts.airdropAttempts !== undefined) {
    const n = Number(opts.airdropAttempts);
    if (!Number.isInteger(n) || n < 1 || n > DEVNET_REHEARSAL_MAX_AIRDROP_ATTEMPTS) {
      return {
        text: `Refusing: --airdrop-attempts must be an integer between 1 and ${DEVNET_REHEARSAL_MAX_AIRDROP_ATTEMPTS} (the faucet is never spammed).`,
        exitCode: 1,
      };
    }
    airdropAttempts = n;
  }

  const outDir = resolvePath(ctx, opts.outDir);
  const reportPath = join(outDir, REHEARSAL_REPORT_FILE);
  if (!opts.force && existsSync(reportPath)) {
    return { text: redactString(`Refusing: ${reportPath} already exists (pass --force to overwrite).`), exitCode: 1 };
  }

  // Signer: operator-supplied devnet keypair (env var NAME), or a generated throwaway. A
  // throwaway is only ever written under a `runs/` path segment (gitignored) AND with the
  // gitignored `.keypair` suffix — two independent rules must both fail before a secret could
  // become committable.
  let signer: TransactionSigningBoundary;
  let signerSource: RehearsalSignerSource;
  let keypairPath: string | null = null;
  if (opts.signerEnvVar) {
    try {
      signer = loadLocalSignerBoundary({
        envVarName: opts.signerEnvVar,
        env,
        readFile: (path: string) => readFileSync(path, "utf8"),
        network: "devnet",
      });
    } catch (err) {
      const msg = err instanceof SignerBoundaryError ? err.message : "signer boundary failed";
      return { text: redactString(`Refusing: ${msg}`), exitCode: 1 };
    }
    signerSource = "operator-env";
  } else {
    const segments = normalize(outDir).split(/[\\/]/);
    if (!segments.includes("runs")) {
      return {
        text: "Refusing: a generated throwaway keypair is only written under a runs/ directory (gitignored). Point --out inside runs/ or pass --signer-env to reuse an existing devnet keypair.",
        exitCode: 1,
      };
    }
    try {
      mkdirSync(outDir, { recursive: true });
    } catch {
      return { text: redactString(`Refusing: cannot create output directory at ${outDir}`), exitCode: 1 };
    }
    // S94: an existing throwaway keypair in the output directory is REUSED, never overwritten —
    // a faucet-blocked run can be funded externally and rerun against the SAME key.
    const throwawayPath = join(outDir, REHEARSAL_KEYPAIR_FILE);
    try {
      if (existsSync(throwawayPath)) {
        const reused = loadThrowawayDevnetSigner({
          keypairPath: throwawayPath,
          readFile: (path: string) => readFileSync(path, "utf8"),
        });
        signer = reused.boundary;
        keypairPath = reused.keypairPath;
        signerSource = "reused-throwaway";
      } else {
        const throwaway = createThrowawayDevnetSigner({
          keypairPath: throwawayPath,
          writeFile: (path: string, contents: string) => writeFileSync(path, contents),
        });
        signer = throwaway.boundary;
        keypairPath = throwaway.keypairPath;
        signerSource = "generated-throwaway";
      }
    } catch (err) {
      const msg = err instanceof SignerBoundaryError ? err.message : "throwaway signer load/generation failed";
      return { text: redactString(`Refusing: ${msg}`), exitCode: 1 };
    }
  }
  try {
    mkdirSync(outDir, { recursive: true });
  } catch {
    return { text: redactString(`Refusing: cannot create output directory at ${outDir}`), exitCode: 1 };
  }

  const makeRehearsalRpc = ctx.createRehearsalRpc ?? createRehearsalRpc;
  let rpc: RehearsalRpc;
  try {
    rpc = makeRehearsalRpc(rpcUrl);
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // Simulation seam backed by the real txpreview boundary (sigVerify:false; cannot send).
  const makePreview = ctx.createTxPreview ?? createTxPreviewRpc;
  const simulate = opts.skipSimulation
    ? undefined
    : async (envelopeValue: unknown): Promise<{ outcome: string; errLabel: string | null }> => {
        const report = await simulateUnsignedEnvelope(makePreview(rpcUrl), envelopeValue, { clock: ctx.now });
        return { outcome: report.outcome, errLabel: report.errLabel };
      };

  const report: DevnetRehearsalReport = await runDevnetRehearsal({
    mode: resolved.mode,
    signer,
    rpc,
    signerSource,
    throwawayFilePath: keypairPath,
    simulate,
    killSwitchActive: config.killSwitch,
    emergencyStopFilePresent: stop,
    skipAirdrop: Boolean(opts.skipAirdrop),
    airdropLamports,
    airdropAttempts,
    clock: ctx.now,
    sleep: ctx.sleep,
  });

  // Journal + write the report. The attempt (when one was made) is appended to the audit log
  // exactly like execution:devnet:send journals its attempts.
  try {
    if (report.attempt !== null) {
      appendFileSync(join(outDir, REHEARSAL_AUDIT_FILE), JSON.stringify(redactValue(report.attempt)) + "\n");
    }
    writeFileSync(reportPath, JSON.stringify(redactValue(report), null, 2) + "\n");
  } catch {
    return { text: redactString(`Refusing: cannot write rehearsal artifacts under ${outDir}`), exitCode: 1 };
  }

  const broadcast = report.outcome === "rehearsed" || report.outcome === "submitted-unconfirmed";
  const exitCode = broadcast ? 0 : 1;
  if (opts.json) {
    return { text: JSON.stringify(redactValue(report), null, 2), exitCode };
  }
  const lines = [
    `DEVNET END-TO-END REHEARSAL: ${report.outcome.toUpperCase()}`,
    `network:    devnet (${report.endpointHost})`,
    `signer:     ${report.signerPublicKey ?? "none"} (${report.signerSource}; public key)`,
    keypairPath !== null
      ? `keypair:    ${keypairPath} (throwaway; gitignored; ${signerSource === "reused-throwaway" ? "REUSED from a prior run" : "delete after use"})`
      : "",
    "",
    "steps:",
    ...report.steps.map((s) => `  [${s.status === "ok" ? "x" : " "}] ${s.step}: ${s.detail}`),
    "",
    report.signature !== null ? `signature:  ${report.signature}` : "signature:  none (nothing was submitted)",
    report.confirmation !== null
      ? `confirmed:  ${report.confirmation.confirmed ? `yes (slot ${report.confirmation.slot ?? "unknown"})` : "no"} after ${report.confirmation.polls} poll(s)`
      : "",
    `artifacts:  ${reportPath}`,
    ...(report.fundingGuidance !== null ? ["", ...report.fundingGuidance.map((g) => `NEXT: ${g}`)] : []),
    "",
    ...report.caveats.map((c) => `CAVEAT: ${c}`),
  ];
  return { text: redactString(lines.filter((l) => l !== "").join("\n")), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 27 — paper:sniper:decide
//   Fold a LOCAL candidate list + an optional preflight report + optional
//   operator rules into a per-candidate SIMULATED decision (skip / watch /
//   paper-enter / paper-reject / unknown), with reasons. A paper-enter is a
//   paper-only decision — NOT a buy/sell order, NOT a transaction, NOT live
//   readiness. Reads the named files only; writes nothing unless --out. No
//   network, no wallet.
// ---------------------------------------------------------------------------

export interface PaperSniperDecideCommandOptions {
  /** Candidate list JSON path. Required. */
  candidatesPath?: string;
  /** Optional preflight report JSON path (sniper.token.preflight.report.v1). */
  preflightPath?: string;
  /** Optional decision rules JSON path. */
  rulesPath?: string;
  /** Optional policy config JSON path (sniper.policy.config.v1). Mutually exclusive with --rules. */
  policyPath?: string;
  json?: boolean;
  /** Optional path to write the decision report JSON (writes nothing if omitted). */
  outPath?: string;
  /** Overwrite an existing --out file (refused by default). */
  force?: boolean;
  /** Exit non-zero when any candidate would paper-enter. */
  failOnPaperEnter?: boolean;
  /** Exit non-zero when any candidate was paper-rejected on risk. */
  failOnRisk?: boolean;
  /** Artifact schema version to produce: "v1" (default; unchanged) or "v2" (structured reason codes). */
  schemaVersion?: string;
}

/**
 * `soulmaker paper:sniper:decide` — produce a PAPER-only per-candidate decision report from a LOCAL
 * candidate list, an optional preflight report, and optional operator rules. Reads ONLY the named
 * local files (BOM-tolerant). Each candidate gets a SIMULATED `skip` / `watch` / `paper-enter` /
 * `paper-reject` / `unknown` decision with reasons — a `paper-enter` is a paper-only decision, never a
 * buy/sell order, a transaction, or live readiness. `--policy <path>` (a `sniper.policy.config.v1`,
 * mutually exclusive with `--rules`) governs the run: its base rules drive the build and its
 * tighten-only enforcement is applied afterward (it can only downgrade a SIMULATED paper-enter, never
 * the reverse). `--schema-version v2` emits `sniper.paper.decision.report.v2` — the same decisions
 * plus stable machine-readable reason codes (the v1 default is unchanged). `--json` emits the report;
 * `--out` writes ONLY the report JSON (refusing overwrite without `--force`, creating no directories);
 * `--fail-on-paper-enter` / `--fail-on-risk` set the exit code. No network, no wallet, no transaction
 * build/sign/send.
 */
export function paperSniperDecideReport(
  ctx: CommandContext = {},
  opts: PaperSniperDecideCommandOptions = {},
): CliReport {
  if (!opts.candidatesPath) return { text: "Refusing: --candidates <path> is required.", exitCode: 1 };
  if (opts.rulesPath && opts.policyPath) {
    return { text: "Refusing: --rules and --policy are mutually exclusive.", exitCode: 1 };
  }
  const schemaVersion = opts.schemaVersion ?? "v1";
  if (schemaVersion !== "v1" && schemaVersion !== "v2") {
    return { text: 'Refusing: --schema-version must be "v1" or "v2".', exitCode: 1 };
  }

  // 1) Read + normalize the candidate list (same wrong-schema guard as the other sniper commands).
  let raw: unknown;
  try {
    raw = readJsonValue(ctx, opts.candidatesPath, "sniper candidate list");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }
  if (!isPlainObject(raw)) {
    return { text: "Refusing: candidate list must be a JSON object with a candidates array.", exitCode: 1 };
  }
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== SNIPER_CANDIDATE_LIST_SCHEMA_VERSION) {
    return {
      text: redactString(`Refusing: candidate list schemaVersion must be "${SNIPER_CANDIDATE_LIST_SCHEMA_VERSION}".`),
      exitCode: 1,
    };
  }
  let list: SniperCandidateList;
  try {
    list = normalizeSniperCandidateList({
      sourceLabel: typeof raw.sourceLabel === "string" ? raw.sourceLabel : opts.candidatesPath,
      candidates: (raw.candidates ?? []) as never,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // 2) Optional preflight + rules (the builder strictly validates each).
  let preflight: unknown;
  if (opts.preflightPath) {
    try {
      preflight = readJsonValue(ctx, opts.preflightPath, "preflight report");
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
  }
  let rules: SniperDecisionRules | undefined;
  if (opts.rulesPath) {
    let rulesValue: unknown;
    try {
      rulesValue = readJsonValue(ctx, opts.rulesPath, "decision rules");
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    if (!isPlainObject(rulesValue)) {
      return { text: "Refusing: decision rules must be a JSON object.", exitCode: 1 };
    }
    rules = rulesValue as SniperDecisionRules;
  }

  // 2b) Optional policy (mutually exclusive with --rules): its base rules drive the build and its
  //     tighten-only enforcement is applied to the built report afterward. A v2 policy (mode + risk
  //     limits) is reason-code-aware, so it REQUIRES the v2 report path — using it with the v1
  //     report would silently drop its limits, which is fail-open and therefore refused.
  let policy: SniperPolicyConfig | undefined;
  let policyV2: SniperPolicyConfigV2 | undefined;
  if (opts.policyPath) {
    let policyValue: unknown;
    try {
      policyValue = readJsonValue(ctx, opts.policyPath, "policy config");
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    if (!isPlainObject(policyValue)) {
      return { text: "Refusing: policy config must be a JSON object.", exitCode: 1 };
    }
    const looksV2 =
      policyValue.schemaVersion === SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION ||
      policyValue.policyMode !== undefined ||
      policyValue.riskLimits !== undefined;
    if (
      policyValue.schemaVersion !== undefined &&
      policyValue.schemaVersion !== SNIPER_POLICY_CONFIG_SCHEMA_VERSION &&
      policyValue.schemaVersion !== SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION
    ) {
      return { text: redactString(`Refusing: policy config schemaVersion must be "${SNIPER_POLICY_CONFIG_SCHEMA_VERSION}" or "${SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION}".`), exitCode: 1 };
    }
    if (looksV2) {
      if (schemaVersion !== "v2") {
        return {
          text: "Refusing: this policy carries v2 fields (policyMode/riskLimits) — its risk limits are reason-code-aware and require --schema-version v2 (they would be silently dropped on the v1 path).",
          exitCode: 1,
        };
      }
      try {
        policyV2 = normalizeSniperPolicyConfigV2(policyValue as never);
      } catch (err) {
        return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
      }
    } else {
      try {
        policy = normalizeSniperPolicyConfig(policyValue as never);
      } catch (err) {
        return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
      }
      rules = deriveSniperDecisionRules(policy);
    }
  }

  // 3) Build the decision report (v1: build + tighten-only enforcement; v2: codes-aware builder).
  let report: SniperPaperDecisionReport | SniperPaperDecisionReportV2;
  let formatted: string;
  try {
    if (schemaVersion === "v2") {
      const appliedPolicy = policyV2 ?? policy;
      const v2 = buildPaperSniperDecisionReportV2({
        candidateList: list,
        preflight,
        rules: appliedPolicy ? undefined : rules,
        policy: appliedPolicy,
      });
      report = v2;
      formatted = formatPaperSniperDecisionReportV2(v2, { label: opts.candidatesPath });
    } else {
      let v1 = buildPaperSniperDecisionReport({ candidateList: list, preflight, rules });
      if (policy) v1 = enforceSniperPolicy(v1, policy, { preflight });
      report = v1;
      formatted = formatPaperSniperDecisionReport(v1, { label: opts.candidatesPath });
    }
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // 4) Optional write: ONLY the report JSON, refuse overwrite without --force, create no directories.
  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(report), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write decision report at ${resolved}`), exitCode: 1 };
    }
  }

  const exitCode =
    (opts.failOnPaperEnter && report.hasPaperEnter) || (opts.failOnRisk && report.hasRiskReject) ? 1 : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(report), null, 2), exitCode };
  }
  return { text: formatted, exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 28 — paper:sniper:workflow
//   Operator helper: check which LOCAL sniper artifacts exist + validate, and
//   print the recommended next command in the intake -> preflight -> decide
//   sequence. It DESCRIBES the sequence only — it executes no stage, runs no
//   live action, reaches no network, and touches no wallet. Reads the named
//   files only (to check validity); writes nothing.
// ---------------------------------------------------------------------------

export interface PaperSniperWorkflowCommandOptions {
  /** Candidate list JSON path (optional). */
  candidatesPath?: string;
  /** Preflight report JSON path (optional). */
  preflightPath?: string;
  /** Decision report JSON path (optional). */
  decisionPath?: string;
  json?: boolean;
}

/** Resolve one artifact's workflow state: exists? validates as the expected kind? (read-only). */
function sniperArtifactState(
  ctx: CommandContext,
  path: string | undefined,
  kind: "candidates" | "preflight" | "decide",
): SniperWorkflowStageState {
  if (!path) return { path: null, present: false, valid: null };
  const resolved = resolvePath(ctx, path);
  if (!existsSync(resolved)) return { path, present: false, valid: null };
  let value: unknown;
  try {
    value = readJsonValue(ctx, path, `${kind} artifact`);
  } catch (err) {
    return { path, present: true, valid: false, detail: redactString((err as Error).message) };
  }
  try {
    if (kind === "candidates") {
      if (!isPlainObject(value)) throw new Error("not a candidate list object");
      if (value.schemaVersion !== undefined && value.schemaVersion !== SNIPER_CANDIDATE_LIST_SCHEMA_VERSION) {
        throw new Error(`wrong schemaVersion "${String(value.schemaVersion)}"`);
      }
      const list = normalizeSniperCandidateList({
        sourceLabel: typeof value.sourceLabel === "string" ? value.sourceLabel : path,
        candidates: (value.candidates ?? []) as never,
      });
      return { path, present: true, valid: true, detail: `${list.candidateCount} candidate(s)` };
    }
    if (kind === "preflight") {
      const pf = validateSniperTokenPreflightReport(value);
      return { path, present: true, valid: true, detail: `${pf.candidateCount} candidate(s) preflighted` };
    }
    const dec = validatePaperSniperDecisionReport(value);
    return { path, present: true, valid: true, detail: `${dec.candidateCount} decision(s)` };
  } catch (err) {
    return { path, present: true, valid: false, detail: redactString((err as Error).message) };
  }
}

/**
 * `soulmaker paper:sniper:workflow` — print the recommended LOCAL, PAPER-only sniper command sequence
 * (intake → preflight → decide) and where the operator is in it. For each supplied artifact path it
 * checks existence and light validity (read-only), then emits a deterministic plan: each stage's
 * status (`done` / `ready` / `blocked` / `todo`), its command, and the single recommended NEXT command.
 * It DESCRIBES the sequence only — it executes no stage, runs no live action, makes no network call,
 * and touches no wallet. `--json` emits the plan. It writes nothing.
 */
export function paperSniperWorkflowReport(
  ctx: CommandContext = {},
  opts: PaperSniperWorkflowCommandOptions = {},
): CliReport {
  const candidates = sniperArtifactState(ctx, opts.candidatesPath, "candidates");
  const preflight = sniperArtifactState(ctx, opts.preflightPath, "preflight");
  const decide = sniperArtifactState(ctx, opts.decisionPath, "decide");
  const plan = buildSniperWorkflowPlan({ candidates, preflight, decide });
  if (opts.json) {
    return { text: JSON.stringify(redactValue(plan), null, 2), exitCode: 0 };
  }
  return { text: formatSniperWorkflowPlan(plan), exitCode: 0 };
}

// ---------------------------------------------------------------------------
// Sprint 30 — paper:sniper:report
//   Bundle a LOCAL candidate list + optional preflight + optional decision +
//   optional workflow plan into one navigable, operator-readable run report
//   (`sniper.run.report.v1`). Per-candidate reason trail (preflight status +
//   simulated decision), grouped id lists, a navigation index, and a CI section.
//   Reads the named files only; writes nothing unless --out. No network, no
//   wallet. A paper-enter carried through is a SIMULATED classification — NOT a
//   buy/sell order, NOT a transaction, NOT live readiness.
// ---------------------------------------------------------------------------

export interface PaperSniperReportCommandOptions {
  /** Candidate list JSON path. Required. */
  candidatesPath?: string;
  /** Optional preflight report JSON path (sniper.token.preflight.report.v1). */
  preflightPath?: string;
  /** Optional decision report JSON path (sniper.paper.decision.report.v1). */
  decisionsPath?: string;
  /** Optional workflow plan JSON path (sniper.workflow.plan.v1). */
  workflowPath?: string;
  /** Optional operator label echoed into the report (a string only). */
  operatorLabel?: string;
  json?: boolean;
  /** Optional path to write the run report JSON (writes nothing if omitted). */
  outPath?: string;
  /** Overwrite an existing --out file (refused by default). */
  force?: boolean;
  failOnInvalid?: boolean;
  failOnPreflightFail?: boolean;
  failOnRisk?: boolean;
  failOnPaperEnter?: boolean;
  failOnUnknown?: boolean;
  failOnMissingRecommended?: boolean;
  /** Exit non-zero when the v2 report carries any operator-blocking reason (v2 only). */
  failOnBlocking?: boolean;
  /** Run report schema to produce: "v1" (default; unchanged) or "v2" (rollups/policy/coverage). */
  schemaVersion?: string;
  /** Optional preflight input artifact JSON path (sniper.preflight.input.v1; v2 only). */
  preflightInputPath?: string;
  /** Optional policy config JSON path (sniper.policy.config.v1|v2; v2 only). */
  policyPath?: string;
}

/**
 * `soulmaker paper:sniper:report` — bundle a LOCAL candidate list + an optional preflight + an optional
 * decision report + an optional workflow plan into one navigable run report (`sniper.run.report.v1`,
 * or `.v2` with `--schema-version v2`, which adds reason-code rollups from a v2 decision, policy
 * visibility, preflight-input coverage, unresolved unknowns, and operator-blocking reasons).
 * Reads ONLY the named local files (BOM-tolerant). The candidate list is the spine; each supplied
 * sub-artifact is STRICTLY validated and must reference only candidates in the list (a wrong pairing is
 * refused). Every preflight status and decision is carried VERBATIM — nothing is re-derived. `--json`
 * emits the report; `--out` writes ONLY the report JSON (refusing overwrite without `--force`, creating
 * no directories); the `--fail-on-*` flags set the exit code. A `paper-enter` carried through is a
 * SIMULATED classification — NOT a buy/sell order, a transaction, or live readiness. No network, no
 * wallet, no transaction build/sign/send.
 */
export function paperSniperReportReport(
  ctx: CommandContext = {},
  opts: PaperSniperReportCommandOptions = {},
): CliReport {
  if (!opts.candidatesPath) return { text: "Refusing: --candidates <path> is required.", exitCode: 1 };
  const schemaVersion = opts.schemaVersion ?? "v1";
  if (schemaVersion !== "v1" && schemaVersion !== "v2") {
    return { text: 'Refusing: --schema-version must be "v1" or "v2".', exitCode: 1 };
  }
  if (schemaVersion === "v1" && (opts.preflightInputPath || opts.policyPath || opts.failOnBlocking)) {
    return { text: "Refusing: --preflight-input / --policy / --fail-on-blocking require --schema-version v2.", exitCode: 1 };
  }

  // 1) Read + normalize the candidate list (same wrong-schema guard as the other sniper commands).
  let raw: unknown;
  try {
    raw = readJsonValue(ctx, opts.candidatesPath, "sniper candidate list");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }
  if (!isPlainObject(raw)) {
    return { text: "Refusing: candidate list must be a JSON object with a candidates array.", exitCode: 1 };
  }
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== SNIPER_CANDIDATE_LIST_SCHEMA_VERSION) {
    return {
      text: redactString(`Refusing: candidate list schemaVersion must be "${SNIPER_CANDIDATE_LIST_SCHEMA_VERSION}".`),
      exitCode: 1,
    };
  }
  let list: SniperCandidateList;
  try {
    list = normalizeSniperCandidateList({
      sourceLabel: typeof raw.sourceLabel === "string" ? raw.sourceLabel : opts.candidatesPath,
      candidates: (raw.candidates ?? []) as never,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // 2) Optional sub-artifacts (the builder strictly validates each).
  const readOptional = (path: string | undefined, label: string): { ok: true; value: unknown } | { ok: false; text: string } => {
    if (!path) return { ok: true, value: undefined };
    try {
      return { ok: true, value: readJsonValue(ctx, path, label) };
    } catch (err) {
      return { ok: false, text: redactString(`Refusing: ${(err as Error).message}`) };
    }
  };
  const pf = readOptional(opts.preflightPath, "preflight report");
  if (!pf.ok) return { text: pf.text, exitCode: 1 };
  const dec = readOptional(opts.decisionsPath, "decision report");
  if (!dec.ok) return { text: dec.text, exitCode: 1 };
  const wf = readOptional(opts.workflowPath, "workflow plan");
  if (!wf.ok) return { text: wf.text, exitCode: 1 };
  const pfInput = readOptional(opts.preflightInputPath, "preflight input");
  if (!pfInput.ok) return { text: pfInput.text, exitCode: 1 };
  const pol = readOptional(opts.policyPath, "policy config");
  if (!pol.ok) return { text: pol.text, exitCode: 1 };

  // 3) Build the run report (v1 unchanged; v2 adds rollups/policy/coverage/blocking reasons).
  let report: SniperRunReport | SniperRunReportV2;
  let formatted: string;
  let blocking = false;
  try {
    if (schemaVersion === "v2") {
      const v2 = buildSniperRunReportV2({
        candidateList: list,
        preflight: pf.value,
        preflightInput: pfInput.value,
        decision: dec.value,
        policy: pol.value,
        workflow: wf.value,
        operatorLabel: opts.operatorLabel ?? null,
      });
      report = v2;
      blocking = v2.operatorBlockingReasons.length > 0;
      formatted = formatSniperRunReportV2(v2, { label: opts.candidatesPath });
    } else {
      const v1 = buildSniperRunReport({
        candidateList: list,
        preflight: pf.value,
        decision: dec.value,
        workflow: wf.value,
        operatorLabel: opts.operatorLabel ?? null,
      });
      report = v1;
      formatted = formatSniperRunReport(v1, { label: opts.candidatesPath });
    }
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // 4) Optional write: ONLY the report JSON, refuse overwrite without --force, create no directories.
  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(report), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write run report at ${resolved}`), exitCode: 1 };
    }
  }

  const exitCode =
    (opts.failOnInvalid && report.hasInvalidCandidate) ||
    (opts.failOnPreflightFail && report.hasPreflightFailure) ||
    (opts.failOnRisk && report.hasRiskBlock) ||
    (opts.failOnPaperEnter && report.hasPaperEnter) ||
    (opts.failOnUnknown && report.hasUnknown) ||
    (opts.failOnMissingRecommended && report.hasMissingRecommendedArtifact) ||
    (opts.failOnBlocking && blocking)
      ? 1
      : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(report), null, 2), exitCode };
  }
  return { text: formatted, exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 31 — paper:sniper:diff:report
//   Deterministically diff TWO existing sniper run report JSON files
//   (`sniper.run.report.diff.v1`). Reads ONLY the two named files (BOM-tolerant,
//   malformed/wrong-schema refused); runs no report, writes nothing. Pairs
//   candidates by id: membership (added/removed/common) + per-candidate decision
//   and preflight-status transitions + conservative got-worse/recovered signals.
//   A paper-enter transition is between two SIMULATED classifications — NOT a
//   buy/sell order. No network, no wallet.
// ---------------------------------------------------------------------------

export interface PaperSniperDiffReportCommandOptions {
  /** Base run report JSON path. Required. */
  basePath?: string;
  /** Next run report JSON path. Required. */
  nextPath?: string;
  json?: boolean;
  failOnChange?: boolean;
  failOnNewInvalid?: boolean;
  failOnNewPreflightFail?: boolean;
  failOnNewRisk?: boolean;
  failOnNewPaperEnter?: boolean;
  failOnNewUnknown?: boolean;
  /** Diff schema to produce: "v1" (default; two v1 reports) or "v2" (two v2 reports + v2 layers). */
  schemaVersion?: string;
  /** Exit non-zero when a NEW operator-blocking condition appeared (requires --schema-version v2). */
  failOnNewOperatorBlocking?: boolean;
}

/**
 * `soulmaker paper:sniper:diff:report` — deterministically diff TWO existing sniper run report JSON
 * files. Reads ONLY the two named files (BOM-tolerant; malformed/wrong-schema refused), runs no report,
 * and writes nothing. Pairs candidates by id and reports membership changes (added / removed / common),
 * per-candidate decision + preflight-status transitions, and conservative directional flags. `--json`
 * emits the stable, redacted diff; the `--fail-on-*` flags set the exit code. A `paper-enter` transition
 * is a change between two SIMULATED, paper-only classifications — never a buy/sell order. No network,
 * no wallet.
 */
export function paperSniperDiffReportReport(
  ctx: CommandContext = {},
  opts: PaperSniperDiffReportCommandOptions = {},
): CliReport {
  if (!opts.basePath) return { text: "Refusing: --base <path> is required.", exitCode: 1 };
  if (!opts.nextPath) return { text: "Refusing: --next <path> is required.", exitCode: 1 };
  const schemaVersion = opts.schemaVersion ?? "v1";
  if (schemaVersion !== "v1" && schemaVersion !== "v2") {
    return { text: `Refusing: --schema-version must be "v1" or "v2" (got "${schemaVersion}").`, exitCode: 1 };
  }
  if (opts.failOnNewOperatorBlocking && schemaVersion !== "v2") {
    return { text: "Refusing: --fail-on-new-operator-blocking requires --schema-version v2.", exitCode: 1 };
  }

  let baseValue: unknown;
  let nextValue: unknown;
  try {
    baseValue = readJsonValue(ctx, opts.basePath, "base run report");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }
  try {
    nextValue = readJsonValue(ctx, opts.nextPath, "next run report");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  if (schemaVersion === "v2") {
    let diffV2: SniperRunReportDiffV2;
    try {
      diffV2 = diffSniperRunReportsV2(baseValue, nextValue);
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    const exitCode =
      (opts.failOnChange && diffV2.hasAnyChange) ||
      (opts.failOnNewInvalid && diffV2.hasNewInvalid) ||
      (opts.failOnNewPreflightFail && diffV2.hasNewPreflightFailure) ||
      (opts.failOnNewRisk && diffV2.hasNewRiskBlock) ||
      (opts.failOnNewPaperEnter && diffV2.hasNewPaperEnter) ||
      (opts.failOnNewUnknown && diffV2.hasNewUnknown) ||
      (opts.failOnNewOperatorBlocking && diffV2.hasNewOperatorBlocking)
        ? 1
        : 0;
    if (opts.json) {
      return { text: JSON.stringify(redactValue(diffV2), null, 2), exitCode };
    }
    return { text: formatSniperRunReportDiffV2(diffV2, { label: `${opts.basePath} → ${opts.nextPath}` }), exitCode };
  }

  let diff: SniperRunReportDiff;
  try {
    diff = diffSniperRunReports(baseValue, nextValue);
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  const exitCode =
    (opts.failOnChange && diff.hasChange) ||
    (opts.failOnNewInvalid && diff.hasNewInvalid) ||
    (opts.failOnNewPreflightFail && diff.hasNewPreflightFailure) ||
    (opts.failOnNewRisk && diff.hasNewRiskBlock) ||
    (opts.failOnNewPaperEnter && diff.hasNewPaperEnter) ||
    (opts.failOnNewUnknown && diff.hasNewUnknown)
      ? 1
      : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(diff), null, 2), exitCode };
  }
  return { text: formatSniperRunReportDiff(diff, { label: `${opts.basePath} → ${opts.nextPath}` }), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 32 — paper:sniper:policy:validate
//   Validate + normalize a LOCAL sniper policy config (`sniper.policy.config.v1`):
//   base decision rules, tighten-only enforcement switches, candidate-list guards,
//   operator labels, and paper sizing assumptions (LABELS / simulated units only —
//   no currency / profit claims). Conservative by default. Reads the named file
//   only, writes nothing, no network/RPC/wallet. A policy enables NO live behaviour.
// ---------------------------------------------------------------------------

export interface PaperSniperPolicyValidateCommandOptions {
  /** Policy config JSON path (operator-friendly raw input or a canonical config). Required. */
  inputPath?: string;
  json?: boolean;
  /** Exit non-zero when the normalized policy carries any warning. */
  failOnWarning?: boolean;
  /** Policy schema to produce: "v1" (default) or "v2" (mode + risk limits; a canonical v1 is upgraded). */
  schemaVersion?: string;
}

/**
 * `soulmaker paper:sniper:policy:validate` — validate + normalize a LOCAL sniper policy config. Reads
 * ONLY the named local file (BOM-tolerant). The file may be operator-friendly raw input or a canonical
 * `sniper.policy.config.v1`; if it carries a `schemaVersion`, it must be the policy schema. Missing
 * fields take CONSERVATIVE defaults. `--json` emits the normalized canonical config; `--fail-on-warning`
 * exits 1 on any warning. A policy enables NO live behaviour and makes no currency / profit claim. Writes
 * nothing, no network, no RPC, no wallet.
 */
export function paperSniperPolicyValidateReport(
  ctx: CommandContext = {},
  opts: PaperSniperPolicyValidateCommandOptions = {},
): CliReport {
  if (!opts.inputPath) return { text: "Refusing: --input <path> is required.", exitCode: 1 };
  const schemaVersion = opts.schemaVersion ?? "v1";
  if (schemaVersion !== "v1" && schemaVersion !== "v2") {
    return { text: 'Refusing: --schema-version must be "v1" or "v2".', exitCode: 1 };
  }

  let value: unknown;
  try {
    value = readJsonValue(ctx, opts.inputPath, "sniper policy config");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }
  if (!isPlainObject(value)) {
    return { text: "Refusing: policy config must be a JSON object.", exitCode: 1 };
  }

  if (schemaVersion === "v2") {
    // v2 accepts: raw v2 operator input, a canonical v2, or a canonical v1 (upgraded).
    if (
      value.schemaVersion !== undefined &&
      value.schemaVersion !== SNIPER_POLICY_CONFIG_SCHEMA_VERSION &&
      value.schemaVersion !== SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION
    ) {
      return {
        text: redactString(`Refusing: schemaVersion must be "${SNIPER_POLICY_CONFIG_SCHEMA_VERSION}" or "${SNIPER_POLICY_CONFIG_V2_SCHEMA_VERSION}" (got "${String(value.schemaVersion)}").`),
        exitCode: 1,
      };
    }
    let configV2: SniperPolicyConfigV2;
    try {
      configV2 =
        value.schemaVersion === SNIPER_POLICY_CONFIG_SCHEMA_VERSION
          ? upgradeSniperPolicyConfigV1ToV2(value)
          : normalizeSniperPolicyConfigV2(value as never);
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    const exitCode = opts.failOnWarning && configV2.warnings.length > 0 ? 1 : 0;
    if (opts.json) {
      return { text: JSON.stringify(redactValue(configV2), null, 2), exitCode };
    }
    return { text: formatSniperPolicyConfigV2(configV2, { label: opts.inputPath }), exitCode };
  }

  if (value.schemaVersion !== undefined && value.schemaVersion !== SNIPER_POLICY_CONFIG_SCHEMA_VERSION) {
    return {
      text: redactString(`Refusing: schemaVersion must be "${SNIPER_POLICY_CONFIG_SCHEMA_VERSION}" (got "${String(value.schemaVersion)}").`),
      exitCode: 1,
    };
  }
  // FAIL-CLOSED: a v2-shaped policy (mode / risk limits) must not be silently weakened to v1.
  if (value.policyMode !== undefined || value.riskLimits !== undefined) {
    return {
      text: "Refusing: this policy carries v2 fields (policyMode/riskLimits) — validate it with --schema-version v2.",
      exitCode: 1,
    };
  }

  let config: SniperPolicyConfig;
  try {
    config = normalizeSniperPolicyConfig(value as never);
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  const exitCode = opts.failOnWarning && config.warnings.length > 0 ? 1 : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(config), null, 2), exitCode };
  }
  return { text: formatSniperPolicyConfig(config, { label: opts.inputPath }), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 33 — paper:sniper:audit
//   Build a deterministic local AUDIT LOG (`sniper.audit.log.v1`) from a LOCAL
//   run report: one entry per pipeline step (intake → preflight → decide →
//   report) with input/output artifact labels, a one-line decision summary, and
//   the step's warnings + failures. Carries NO wall-clock time — the run label is
//   operator-supplied. Reads the named file only; writes nothing unless --out.
//   No network, no wallet. Provenance over a SIMULATED run — not a live result.
// ---------------------------------------------------------------------------

export interface PaperSniperAuditCommandOptions {
  /** Run report JSON path (sniper.run.report.v1). Required. */
  reportPath?: string;
  /** Operator-supplied run label (a string only — never system time). */
  label?: string;
  /** Repeatable operator-supplied notes. */
  notes?: string[];
  json?: boolean;
  /** Optional path to write the audit log JSON (writes nothing if omitted). */
  outPath?: string;
  /** Overwrite an existing --out file (refused by default). */
  force?: boolean;
  /** Exit non-zero when any step recorded a failure. */
  failOnFailure?: boolean;
  /** Exit non-zero when any step recorded a warning. */
  failOnWarning?: boolean;
}

/**
 * `soulmaker paper:sniper:audit` — build a deterministic local audit log from a LOCAL run report
 * (`sniper.run.report.v1`). Reads ONLY the named file (BOM-tolerant). It emits one entry per pipeline
 * step (intake → preflight → decide → report) with input/output artifact labels, a one-line decision
 * summary, and the step's warnings + failures — read VERBATIM from the run report. It carries NO
 * wall-clock time: `--label` is an operator-supplied string. `--json` emits the log; `--out` writes ONLY
 * the log JSON (refusing overwrite without `--force`, creating no directories); `--fail-on-failure` /
 * `--fail-on-warning` set the exit code. Provenance over a SIMULATED run — not a live result, not an
 * order. No network, no wallet.
 */
export function paperSniperAuditReport(
  ctx: CommandContext = {},
  opts: PaperSniperAuditCommandOptions = {},
): CliReport {
  if (!opts.reportPath) return { text: "Refusing: --report <path> is required.", exitCode: 1 };

  let value: unknown;
  try {
    value = readJsonValue(ctx, opts.reportPath, "run report");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let log: SniperAuditLog;
  try {
    log = buildSniperAuditLog({ runReport: value, runLabel: opts.label ?? null, notes: opts.notes });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(log), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write audit log at ${resolved}`), exitCode: 1 };
    }
  }

  const exitCode =
    (opts.failOnFailure && log.hasFailure) || (opts.failOnWarning && log.hasWarning) ? 1 : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(log), null, 2), exitCode };
  }
  return { text: formatSniperAuditLog(log, { label: opts.reportPath }), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 34 — paper:sniper:session:pack
//   Bundle MANY local sniper artifact JSON files into one deterministic session
//   pack (`sniper.session.pack.v1`). Each --artifact label=path is classified by
//   its schemaVersion; a known sniper schema is strictly validated (a corrupt one
//   is refused), an unknown schema is surfaced honestly as `unsupported`. Reads
//   the named files only; writes nothing unless --out. No network, no wallet.
//   Coverage tiers describe PRESENCE only — not completeness or trading readiness.
// ---------------------------------------------------------------------------

export interface PaperSniperSessionPackCommandOptions {
  /** Repeatable "label=path" sniper artifact JSON files. At least one required. */
  artifacts?: string[];
  /** Optional operator session label. */
  label?: string;
  json?: boolean;
  /** Optional path to write the session pack JSON (writes nothing if omitted). */
  outPath?: string;
  /** Overwrite an existing --out file (refused by default). */
  force?: boolean;
  failOnRisk?: boolean;
  failOnUnknown?: boolean;
  failOnPaperEnter?: boolean;
  failOnUnsupported?: boolean;
  /** v2 only: exit non-zero when any packed spec artifact is NOT adopted. */
  failOnNotAdoptedSpec?: boolean;
  /** Pack schema to produce: "v1" (default; unchanged) or "v2" (full v2 registry incl. spec artifacts). */
  schemaVersion?: string;
}

/**
 * `soulmaker paper:sniper:session:pack` — collect MANY local sniper artifact JSON files into one
 * deterministic session pack (`sniper.session.pack.v1`). Reads ONLY the named local files (BOM-tolerant;
 * a missing/malformed file, a bad `label=path` spec, a duplicate label, or an artifact that CLAIMS a
 * known sniper schema but fails validation refuses with exit 1). A known schema is classified +
 * validated + its flags read VERBATIM; an unknown schema is surfaced as `unsupported` (gated by
 * `--fail-on-unsupported`). `--json` emits the pack; `--out` writes ONLY the pack JSON (refusing
 * overwrite without `--force`, creating no directories); the `--fail-on-*` flags set the exit code.
 * Coverage tiers describe PRESENCE only. No network, no wallet, no transaction build/sign/send.
 */
export function paperSniperSessionPackReport(
  ctx: CommandContext = {},
  opts: PaperSniperSessionPackCommandOptions = {},
): CliReport {
  const schemaVersion = opts.schemaVersion ?? "v1";
  if (schemaVersion !== "v1" && schemaVersion !== "v2") {
    return { text: 'Refusing: --schema-version must be "v1" or "v2".', exitCode: 1 };
  }
  if (schemaVersion === "v1" && opts.failOnNotAdoptedSpec) {
    return { text: "Refusing: --fail-on-not-adopted-spec requires --schema-version v2.", exitCode: 1 };
  }
  const specs = opts.artifacts ?? [];
  if (specs.length === 0) {
    return { text: "Refusing: at least one --artifact <label=path> is required.", exitCode: 1 };
  }

  const artifacts: SniperSessionPackArtifactInput[] = [];
  for (const spec of specs) {
    const parsed = parsePackArtifactArg(spec);
    if (!parsed) {
      return { text: redactString(`Refusing: --artifact must be "label=path" (got "${spec}").`), exitCode: 1 };
    }
    let value: unknown;
    try {
      value = readJsonValue(ctx, parsed.path, `sniper artifact (${parsed.label})`);
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    artifacts.push({ label: parsed.label, sourceLabel: parsed.path, value });
  }

  // --- v2: the full v2 registry (spec artifacts, v2 reports, gates/prereq trackers) ---
  if (schemaVersion === "v2") {
    let packV2: SniperSessionPackV2;
    try {
      packV2 = buildSniperSessionPackV2({ sessionLabel: opts.label ?? null, artifacts });
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    if (opts.outPath) {
      const resolved = resolvePath(ctx, opts.outPath);
      if (!opts.force && existsSync(resolved)) {
        return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
      }
      try {
        writeFileSync(resolved, JSON.stringify(redactValue(packV2), null, 2) + "\n");
      } catch {
        return { text: redactString(`Refusing: cannot write session pack at ${resolved}`), exitCode: 1 };
      }
    }
    const exitCode =
      (opts.failOnRisk && packV2.hasRiskBlock) ||
      (opts.failOnUnknown && packV2.hasUnknown) ||
      (opts.failOnPaperEnter && packV2.hasPaperEnter) ||
      (opts.failOnUnsupported && packV2.hasUnsupported) ||
      (opts.failOnNotAdoptedSpec && packV2.hasNotAdoptedSpec)
        ? 1
        : 0;
    if (opts.json) {
      return { text: JSON.stringify(redactValue(packV2), null, 2), exitCode };
    }
    return { text: formatSniperSessionPackV2(packV2, { label: opts.label }), exitCode };
  }

  let pack: SniperSessionPack;
  try {
    pack = buildSniperSessionPack({ sessionLabel: opts.label ?? null, artifacts });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(pack), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write session pack at ${resolved}`), exitCode: 1 };
    }
  }

  const exitCode =
    (opts.failOnRisk && pack.hasRiskBlock) ||
    (opts.failOnUnknown && pack.hasUnknown) ||
    (opts.failOnPaperEnter && pack.hasPaperEnter) ||
    (opts.failOnUnsupported && pack.hasUnsupported)
      ? 1
      : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(pack), null, 2), exitCode };
  }
  return { text: formatSniperSessionPack(pack, { label: opts.label }), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 39 — paper:sniper:safety:gates
//   Evaluate FAIL-CLOSED operator safety gates over a LOCAL session pack
//   (`sniper.safety.gates.report.v1`): candidate list / decision / audit log
//   present, no unsupported artifacts, and — gated by explicit operator
//   allowances — no unknowns / risk blocks / SIMULATED paper-enters. Exits 1
//   when NOT ready (by default). Passing is LOCAL/PAPER readiness ONLY — NOT
//   Phase 6 authorization. Reads the named file only; writes nothing unless --out.
// ---------------------------------------------------------------------------

export interface PaperSniperSafetyGatesCommandOptions {
  /** Session pack JSON path (sniper.session.pack.v1). Required on the v1 path; optional artifact on v2. */
  sessionPath?: string;
  /** Optional operator label echoed into the report. */
  operatorLabel?: string;
  allowUnknown?: boolean;
  allowRiskBlock?: boolean;
  allowPaperEnter?: boolean;
  json?: boolean;
  /** Optional path to write the gates report JSON (writes nothing if omitted). */
  outPath?: string;
  /** Overwrite an existing --out file (refused by default). */
  force?: boolean;
  /** Also exit non-zero when any gate warned (even when ready). */
  failOnWarning?: boolean;
  /** Gates schema to produce: "v1" (default; session-pack based) or "v2" (artifact-direct, code-aware). */
  schemaVersion?: string;
  /** v2 only: candidate list JSON path. */
  candidatesPath?: string;
  /** v2 only: preflight input artifact JSON path (sniper.preflight.input.v1). */
  preflightInputPath?: string;
  /** v2 only: preflight report JSON path (sniper.token.preflight.report.v1). */
  preflightPath?: string;
  /** v2 only: policy config JSON path (sniper.policy.config.v1|v2). */
  policyPath?: string;
  /** v2 only: decision report JSON path (must be sniper.paper.decision.report.v2). */
  decisionsPath?: string;
  /** v2 only: run report JSON path (must be sniper.run.report.v2). */
  runReportPath?: string;
  /** v2 only: audit log JSON path (sniper.audit.log.v1). */
  auditPath?: string;
}

/**
 * `soulmaker paper:sniper:safety:gates` — evaluate FAIL-CLOSED operator safety gates over a LOCAL session
 * pack (`sniper.session.pack.v1`). Reads ONLY the named file (BOM-tolerant). It checks the required
 * artifacts are present (candidate list / decision / audit log), that there are no unsupported artifacts,
 * and — gated by `--allow-unknown` / `--allow-risk-block` / `--allow-paper-enter` — that there are no
 * unknowns / risk blocks / SIMULATED paper-enters. It is fail-closed: a concern fails its gate unless
 * explicitly allowed. The command exits **1 when NOT ready** (by default), 0 when ready (or +1 with
 * `--fail-on-warning` if any gate warned). `--json` emits the report; `--out` writes ONLY the report JSON
 * (refusing overwrite without `--force`). Passing is LOCAL/PAPER readiness ONLY — NOT Phase 6
 * authorization, and Phase 6/7 remain not started. No network, no wallet.
 */
export function paperSniperSafetyGatesReport(
  ctx: CommandContext = {},
  opts: PaperSniperSafetyGatesCommandOptions = {},
): CliReport {
  const schemaVersion = opts.schemaVersion ?? "v1";
  if (schemaVersion !== "v1" && schemaVersion !== "v2") {
    return { text: 'Refusing: --schema-version must be "v1" or "v2".', exitCode: 1 };
  }

  // --- v2: artifact-direct, code-aware, policy-as-the-only-allowance gates ---
  if (schemaVersion === "v2") {
    if (opts.allowUnknown || opts.allowRiskBlock || opts.allowPaperEnter) {
      return {
        text: "Refusing: the --allow-* flags are v1-only — in v2 the POLICY is the single source of allowances.",
        exitCode: 1,
      };
    }
    const readOptional = (path: string | undefined, label: string): { ok: true; value: unknown } | { ok: false; text: string } => {
      if (!path) return { ok: true, value: undefined };
      try {
        return { ok: true, value: readJsonValue(ctx, path, label) };
      } catch (err) {
        return { ok: false, text: redactString(`Refusing: ${(err as Error).message}`) };
      }
    };
    // The candidate list gets the SAME raw-input normalization every sibling command applies
    // (a canonical list passes through unchanged; everything else stays strictly validated).
    let candidateListValue: unknown;
    if (opts.candidatesPath) {
      let candsRaw: unknown;
      try {
        candsRaw = readJsonValue(ctx, opts.candidatesPath, "sniper candidate list");
      } catch (err) {
        return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
      }
      if (isPlainObject(candsRaw) && (candsRaw.schemaVersion === undefined || candsRaw.schemaVersion === SNIPER_CANDIDATE_LIST_SCHEMA_VERSION)) {
        try {
          candidateListValue = normalizeSniperCandidateList({
            sourceLabel: typeof candsRaw.sourceLabel === "string" ? candsRaw.sourceLabel : opts.candidatesPath,
            candidates: (candsRaw.candidates ?? []) as never,
          });
        } catch {
          candidateListValue = candsRaw; // let the gate report the strict-validation failure
        }
      } else {
        candidateListValue = candsRaw;
      }
    }
    const reads = {
      preflightInput: readOptional(opts.preflightInputPath, "preflight input"),
      preflight: readOptional(opts.preflightPath, "preflight report"),
      policy: readOptional(opts.policyPath, "policy config"),
      decision: readOptional(opts.decisionsPath, "decision report"),
      runReport: readOptional(opts.runReportPath, "run report"),
      sessionPack: readOptional(opts.sessionPath, "session pack"),
      auditLog: readOptional(opts.auditPath, "audit log"),
    };
    for (const r of Object.values(reads)) {
      if (!r.ok) return { text: r.text, exitCode: 1 };
    }
    const v = <K extends keyof typeof reads>(k: K): unknown => (reads[k] as { ok: true; value: unknown }).value;
    let reportV2: SniperSafetyGatesReportV2;
    try {
      reportV2 = buildSniperSafetyGatesReportV2({
        candidateList: candidateListValue,
        preflightInput: v("preflightInput"),
        preflight: v("preflight"),
        policy: v("policy"),
        decision: v("decision"),
        runReport: v("runReport"),
        sessionPack: v("sessionPack"),
        auditLog: v("auditLog"),
        operatorLabel: opts.operatorLabel ?? null,
      });
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    if (opts.outPath) {
      const resolved = resolvePath(ctx, opts.outPath);
      if (!opts.force && existsSync(resolved)) {
        return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
      }
      try {
        writeFileSync(resolved, JSON.stringify(redactValue(reportV2), null, 2) + "\n");
      } catch {
        return { text: redactString(`Refusing: cannot write safety gates report at ${resolved}`), exitCode: 1 };
      }
    }
    const exitCode = !reportV2.ready || (opts.failOnWarning && reportV2.hasWarning) ? 1 : 0;
    if (opts.json) {
      return { text: JSON.stringify(redactValue(reportV2), null, 2), exitCode };
    }
    return { text: formatSniperSafetyGatesReportV2(reportV2, { label: opts.operatorLabel ?? undefined }), exitCode };
  }

  if (!opts.sessionPath) return { text: "Refusing: --session <path> is required.", exitCode: 1 };
  if (opts.candidatesPath || opts.preflightInputPath || opts.preflightPath || opts.policyPath || opts.decisionsPath || opts.runReportPath || opts.auditPath) {
    return { text: "Refusing: the per-artifact flags require --schema-version v2.", exitCode: 1 };
  }

  let value: unknown;
  try {
    value = readJsonValue(ctx, opts.sessionPath, "session pack");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let report: SniperSafetyGatesReport;
  try {
    report = buildSniperSafetyGatesReport({
      sessionPack: value,
      operatorLabel: opts.operatorLabel ?? null,
      allowances: {
        allowUnknown: Boolean(opts.allowUnknown),
        allowRiskBlock: Boolean(opts.allowRiskBlock),
        allowPaperEnter: Boolean(opts.allowPaperEnter),
      },
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(report), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write safety gates report at ${resolved}`), exitCode: 1 };
    }
  }

  // Fail-closed gate: exit 1 when NOT ready, or (with --fail-on-warning) when any gate warned.
  const exitCode = !report.ready || (opts.failOnWarning && report.hasWarning) ? 1 : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(report), null, 2), exitCode };
  }
  return { text: formatSniperSafetyGatesReport(report, { label: opts.sessionPath }), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 53 — paper:sniper:kill-switch:spec
//   Build a machine-readable LOCAL kill-switch DESIGN artifact
//   (`sniper.kill_switch.spec.v1`). It is NOT a kill switch: no process
//   control, no live controls, no network, no wallet. The live mode is a
//   permanently-disabled placeholder. Reads the optional --input config only;
//   writes nothing unless --out.
// ---------------------------------------------------------------------------

export interface PaperSniperKillSwitchSpecCommandOptions {
  /** Optional spec config JSON path (operator-friendly raw input). */
  inputPath?: string;
  /** Optional operator label (overrides the config's). */
  operatorLabel?: string;
  json?: boolean;
  /** Optional path to write the spec JSON (writes nothing if omitted). */
  outPath?: string;
  /** Overwrite an existing --out file (refused by default). */
  force?: boolean;
  /** Exit non-zero when the spec is not ADOPTED (useful as a Phase-6 prerequisite gate). */
  failOnNotAdopted?: boolean;
}

/**
 * `soulmaker paper:sniper:kill-switch:spec` — build a machine-readable LOCAL kill-switch DESIGN
 * artifact (`sniper.kill_switch.spec.v1`). It is NOT a kill switch: it performs no process control,
 * exposes no live controls, and its `stop-live-disabled-placeholder` mode is permanently disabled.
 * `--input` supplies an operator config (confirmations / disabled actions / escalation notes / audit
 * + test requirements / readinessStatus); the canonical baselines are always merged in. `--json`
 * emits the spec; `--out` writes ONLY the spec JSON (refusing overwrite without `--force`);
 * `--fail-on-not-adopted` exits 1 while the spec is not adopted. No network, no wallet.
 */
export function paperSniperKillSwitchSpecReport(
  ctx: CommandContext = {},
  opts: PaperSniperKillSwitchSpecCommandOptions = {},
): CliReport {
  let config: Record<string, unknown> = {};
  if (opts.inputPath) {
    let raw: unknown;
    try {
      raw = readJsonValue(ctx, opts.inputPath, "kill-switch spec config");
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    if (!isPlainObject(raw)) {
      return { text: "Refusing: kill-switch spec config must be a JSON object.", exitCode: 1 };
    }
    if (raw.schemaVersion !== undefined && raw.schemaVersion !== SNIPER_KILL_SWITCH_SPEC_SCHEMA_VERSION) {
      return { text: redactString(`Refusing: kill-switch spec schemaVersion must be "${SNIPER_KILL_SWITCH_SPEC_SCHEMA_VERSION}".`), exitCode: 1 };
    }
    config = raw;
  }

  let spec: SniperKillSwitchSpec;
  try {
    spec = buildSniperKillSwitchSpec({
      operatorLabel: opts.operatorLabel ?? (typeof config.operatorLabel === "string" ? config.operatorLabel : null),
      requiredOperatorConfirmations: config.requiredOperatorConfirmations as never,
      disabledActions: config.disabledActions as never,
      escalationNotes: config.escalationNotes as never,
      auditRequirements: config.auditRequirements as never,
      testRequirements: config.testRequirements as never,
      readinessStatus: config.readinessStatus as never,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(spec), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write kill-switch spec at ${resolved}`), exitCode: 1 };
    }
  }

  const exitCode = opts.failOnNotAdopted && !spec.adopted ? 1 : 0;
  if (opts.json) {
    return { text: JSON.stringify(redactValue(spec), null, 2), exitCode };
  }
  return { text: formatSniperKillSwitchSpec(spec, { label: opts.inputPath }), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 54 — paper:sniper:secrets:policy
//   Build a machine-readable LOCAL secrets policy (`sniper.secrets.policy.v1`).
//   Stores NO secret: secret-bearing keys and key-shaped values in the input
//   are REFUSED without being echoed. The six core rules are constants. Reads
//   the optional --input config only; writes nothing unless --out.
// ---------------------------------------------------------------------------

export interface PaperSniperSecretsPolicyCommandOptions {
  /** Optional policy config JSON path (operator-friendly raw input). */
  inputPath?: string;
  /** Optional operator label (overrides the config's). */
  operatorLabel?: string;
  json?: boolean;
  /** Optional path to write the policy JSON (writes nothing if omitted). */
  outPath?: string;
  /** Overwrite an existing --out file (refused by default). */
  force?: boolean;
  /** Exit non-zero when the policy is not ADOPTED. */
  failOnNotAdopted?: boolean;
}

/**
 * `soulmaker paper:sniper:secrets:policy` — build a machine-readable LOCAL secrets policy
 * (`sniper.secrets.policy.v1`). It stores NO secret: a secret-bearing key or a key-shaped value in
 * the input is REFUSED without ever being echoed. The six core rules (forbid main wallet / forbid
 * seed phrase storage / forbid private key logging / require burner isolation for live / require
 * redaction / require explicit dangerous opt-in for live) are constants that cannot be configured
 * off. `--json` emits the policy; `--out` writes ONLY the policy JSON (refusing overwrite without
 * `--force`); `--fail-on-not-adopted` exits 1 while not adopted. No network, no wallet.
 */
export function paperSniperSecretsPolicyReport(
  ctx: CommandContext = {},
  opts: PaperSniperSecretsPolicyCommandOptions = {},
): CliReport {
  let config: Record<string, unknown> = {};
  if (opts.inputPath) {
    let raw: unknown;
    try {
      raw = readJsonValue(ctx, opts.inputPath, "secrets policy config");
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    if (!isPlainObject(raw)) {
      return { text: "Refusing: secrets policy config must be a JSON object.", exitCode: 1 };
    }
    if (raw.schemaVersion !== undefined && raw.schemaVersion !== SNIPER_SECRETS_POLICY_SCHEMA_VERSION) {
      return { text: redactString(`Refusing: secrets policy schemaVersion must be "${SNIPER_SECRETS_POLICY_SCHEMA_VERSION}".`), exitCode: 1 };
    }
    config = raw;
  }

  let policy: SniperSecretsPolicy;
  try {
    // The WHOLE config is passed through (minus schemaVersion) so the builder's secret-shaped-input
    // scan sees every key the operator wrote — an unknown secret-bearing key must be refused, not
    // silently dropped by CLI cherry-picking.
    const { schemaVersion: _schemaVersion, ...rest } = config;
    policy = buildSniperSecretsPolicy({
      ...rest,
      operatorLabel: opts.operatorLabel ?? (typeof config.operatorLabel === "string" ? config.operatorLabel : null),
    } as never);
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(policy), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write secrets policy at ${resolved}`), exitCode: 1 };
    }
  }

  const exitCode = opts.failOnNotAdopted && !policy.adopted ? 1 : 0;
  if (opts.json) {
    return { text: JSON.stringify(redactValue(policy), null, 2), exitCode };
  }
  return { text: formatSniperSecretsPolicy(policy, { label: opts.inputPath }), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 55 — paper:sniper:burner:isolation:spec
//   Build a machine-readable LOCAL burner isolation DESIGN artifact
//   (`sniper.burner.isolation.spec.v1`). It is NOT a wallet: it creates no
//   wallet, imports no wallet, and holds no key. Loss bounds are LABELS only.
//   Reads the optional --input config only; writes nothing unless --out.
// ---------------------------------------------------------------------------

export interface PaperSniperBurnerIsolationSpecCommandOptions {
  /** Optional spec config JSON path (operator-friendly raw input). */
  inputPath?: string;
  /** Optional operator label (overrides the config's). */
  operatorLabel?: string;
  json?: boolean;
  /** Optional path to write the spec JSON (writes nothing if omitted). */
  outPath?: string;
  /** Overwrite an existing --out file (refused by default). */
  force?: boolean;
  /** Exit non-zero when the spec is not ADOPTED. */
  failOnNotAdopted?: boolean;
}

/**
 * `soulmaker paper:sniper:burner:isolation:spec` — build a machine-readable LOCAL burner isolation
 * DESIGN artifact (`sniper.burner.isolation.spec.v1`). It is NOT a wallet: it creates no wallet,
 * imports no wallet, and holds no key. The seven core principles (burner-only / main wallet
 * excluded / simulation-before-any-send / redacted logging / explicit opt-in / operator approval /
 * creates-no-wallet) are constants that cannot be configured off; `maxLossLabel` must be a pure
 * LABEL (digits/currency markers refused — never an amount claim). `--json` emits the spec; `--out`
 * writes ONLY the spec JSON (refusing overwrite without `--force`); `--fail-on-not-adopted` exits 1
 * while not adopted. No network, no wallet.
 */
export function paperSniperBurnerIsolationSpecReport(
  ctx: CommandContext = {},
  opts: PaperSniperBurnerIsolationSpecCommandOptions = {},
): CliReport {
  let config: Record<string, unknown> = {};
  if (opts.inputPath) {
    let raw: unknown;
    try {
      raw = readJsonValue(ctx, opts.inputPath, "burner isolation spec config");
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    if (!isPlainObject(raw)) {
      return { text: "Refusing: burner isolation spec config must be a JSON object.", exitCode: 1 };
    }
    if (raw.schemaVersion !== undefined && raw.schemaVersion !== SNIPER_BURNER_ISOLATION_SPEC_SCHEMA_VERSION) {
      return { text: redactString(`Refusing: burner isolation spec schemaVersion must be "${SNIPER_BURNER_ISOLATION_SPEC_SCHEMA_VERSION}".`), exitCode: 1 };
    }
    config = raw;
  }

  let spec: SniperBurnerIsolationSpec;
  try {
    spec = buildSniperBurnerIsolationSpec({
      operatorLabel: opts.operatorLabel ?? (typeof config.operatorLabel === "string" ? config.operatorLabel : null),
      maxLossLabel: config.maxLossLabel as never,
      futureCapRequirements: config.futureCapRequirements as never,
      operatorApprovalRequirements: config.operatorApprovalRequirements as never,
      killSwitchSpecRef: config.killSwitchSpecRef as never,
      readinessStatus: config.readinessStatus as never,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(spec), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write burner isolation spec at ${resolved}`), exitCode: 1 };
    }
  }

  const exitCode = opts.failOnNotAdopted && !spec.adopted ? 1 : 0;
  if (opts.json) {
    return { text: JSON.stringify(redactValue(spec), null, 2), exitCode };
  }
  return { text: formatSniperBurnerIsolationSpec(spec, { label: opts.inputPath }), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 40 — paper:phase6:prereqs
//   Turn the docs/PHASE_6_SIMULATION_BOUNDARY.md prerequisites into a
//   machine-readable checklist (`phase6.prerequisite.report.v1`) from a LOCAL
//   session pack: the artifact prereqs (intake/preflight/decisions/config/audit)
//   are derived from the pack; the design prereqs are reported as documented.
//   It NEVER authorizes Phase 6 (phase6ImplementationStarted always false,
//   requiresExplicitHumanApproval always true) and implements NO transaction
//   planning. Reads the named file only; writes nothing unless --out.
// ---------------------------------------------------------------------------

export interface PaperPhase6PrereqsCommandOptions {
  /** Session pack JSON path (sniper.session.pack.v1). Required on the v1 path; optional artifact on v2. */
  sessionPath?: string;
  /** Optional operator label echoed into the report. */
  operatorLabel?: string;
  json?: boolean;
  /** Optional path to write the prerequisite report JSON (writes nothing if omitted). */
  outPath?: string;
  /** Overwrite an existing --out file (refused by default). */
  force?: boolean;
  /** Exit non-zero when readiness is not met (v1: artifact prereqs; v2: phase6ImplementationReady). */
  failOnUnmet?: boolean;
  /** Tracker schema to produce: "v1" (default; session-pack based) or "v2" (bucketed, artifact-direct). */
  schemaVersion?: string;
  /** v2 only: policy config JSON path (sniper.policy.config.v1|v2). */
  policyPath?: string;
  /** v2 only: safety gates v2 report JSON path. */
  gatesPath?: string;
  /** v2 only: decision report JSON path (sniper.paper.decision.report.v2). */
  decisionsPath?: string;
  /** v2 only: run report JSON path (sniper.run.report.v2). */
  runReportPath?: string;
  /** v2 only: audit log JSON path (sniper.audit.log.v1). */
  auditPath?: string;
  /** v2 only: kill-switch spec JSON path (sniper.kill_switch.spec.v1). */
  killSwitchPath?: string;
  /** v2 only: secrets policy JSON path (sniper.secrets.policy.v1). */
  secretsPolicyPath?: string;
  /** v2 only: burner isolation spec JSON path (sniper.burner.isolation.spec.v1). */
  burnerIsolationPath?: string;
}

/**
 * `soulmaker paper:phase6:prereqs` — turn the `docs/PHASE_6_SIMULATION_BOUNDARY.md` prerequisites into a
 * machine-readable checklist (`phase6.prerequisite.report.v1`) from a LOCAL session pack. Reads ONLY the
 * named file (BOM-tolerant). The five artifact prerequisites (candidate intake / preflight / paper
 * decisions / operator config / audit logging) are derived from the session pack; the six design
 * prerequisites are reported as `documented` (their design exists in the boundary spec). It implements NO
 * transaction planning, carries no chain capability, and can NEVER authorize Phase 6
 * (`phase6ImplementationStarted` is always false; `requiresExplicitHumanApproval` always true). `--json`
 * emits the report; `--out` writes ONLY the report JSON (refusing overwrite without `--force`);
 * `--fail-on-unmet` exits 1 when any artifact prerequisite is not met. No network, no wallet.
 */
export function paperPhase6PrereqsReport(
  ctx: CommandContext = {},
  opts: PaperPhase6PrereqsCommandOptions = {},
): CliReport {
  const schemaVersion = opts.schemaVersion ?? "v1";
  if (schemaVersion !== "v1" && schemaVersion !== "v2") {
    return { text: 'Refusing: --schema-version must be "v1" or "v2".', exitCode: 1 };
  }

  // --- v2: bucketed, artifact-direct tracker (never authorizes; phase7 never ready) ---
  if (schemaVersion === "v2") {
    const readOptional = (path: string | undefined, label: string): { ok: true; value: unknown } | { ok: false; text: string } => {
      if (!path) return { ok: true, value: undefined };
      try {
        return { ok: true, value: readJsonValue(ctx, path, label) };
      } catch (err) {
        return { ok: false, text: redactString(`Refusing: ${(err as Error).message}`) };
      }
    };
    const reads = {
      sessionPack: readOptional(opts.sessionPath, "session pack"),
      policy: readOptional(opts.policyPath, "policy config"),
      safetyGates: readOptional(opts.gatesPath, "safety gates report"),
      decision: readOptional(opts.decisionsPath, "decision report"),
      runReport: readOptional(opts.runReportPath, "run report"),
      auditLog: readOptional(opts.auditPath, "audit log"),
      killSwitchSpec: readOptional(opts.killSwitchPath, "kill-switch spec"),
      secretsPolicy: readOptional(opts.secretsPolicyPath, "secrets policy"),
      burnerIsolationSpec: readOptional(opts.burnerIsolationPath, "burner isolation spec"),
    };
    for (const r of Object.values(reads)) {
      if (!r.ok) return { text: r.text, exitCode: 1 };
    }
    const v = <K extends keyof typeof reads>(k: K): unknown => (reads[k] as { ok: true; value: unknown }).value;
    let reportV2: Phase6PrerequisiteReportV2;
    try {
      reportV2 = buildPhase6PrerequisiteReportV2({
        sessionPack: v("sessionPack"),
        policy: v("policy"),
        safetyGates: v("safetyGates"),
        decision: v("decision"),
        runReport: v("runReport"),
        auditLog: v("auditLog"),
        killSwitchSpec: v("killSwitchSpec"),
        secretsPolicy: v("secretsPolicy"),
        burnerIsolationSpec: v("burnerIsolationSpec"),
        operatorLabel: opts.operatorLabel ?? null,
      });
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    if (opts.outPath) {
      const resolved = resolvePath(ctx, opts.outPath);
      if (!opts.force && existsSync(resolved)) {
        return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
      }
      try {
        writeFileSync(resolved, JSON.stringify(redactValue(reportV2), null, 2) + "\n");
      } catch {
        return { text: redactString(`Refusing: cannot write prerequisite report at ${resolved}`), exitCode: 1 };
      }
    }
    const exitCode = opts.failOnUnmet && !reportV2.phase6ImplementationReady ? 1 : 0;
    if (opts.json) {
      return { text: JSON.stringify(redactValue(reportV2), null, 2), exitCode };
    }
    return { text: formatPhase6PrerequisiteReportV2(reportV2, { label: opts.operatorLabel ?? undefined }), exitCode };
  }

  if (
    opts.policyPath || opts.gatesPath || opts.decisionsPath || opts.runReportPath || opts.auditPath ||
    opts.killSwitchPath || opts.secretsPolicyPath || opts.burnerIsolationPath
  ) {
    return { text: "Refusing: the per-artifact flags require --schema-version v2.", exitCode: 1 };
  }
  if (!opts.sessionPath) return { text: "Refusing: --session <path> is required.", exitCode: 1 };

  let value: unknown;
  try {
    value = readJsonValue(ctx, opts.sessionPath, "session pack");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let report: Phase6PrerequisiteReport;
  try {
    report = buildPhase6PrerequisiteReport({ sessionPack: value, operatorLabel: opts.operatorLabel ?? null });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(report), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write phase 6 prerequisite report at ${resolved}`), exitCode: 1 };
    }
  }

  const exitCode = opts.failOnUnmet && !report.artifactPrerequisitesMet ? 1 : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(report), null, 2), exitCode };
  }
  return { text: formatPhase6PrerequisiteReport(report, { label: opts.sessionPath }), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 41 — paper:phase6:intent:plan
//   Build an INERT, NOT-EXECUTABLE simulation intent plan (`simulation.intent.plan.v1`)
//   from a LOCAL paper decision report: one inert entry per SIMULATED paper-enter,
//   each with a hypothetical side, an amount LABEL (never currency), reason codes,
//   the constraints/approvals/checks a FUTURE Phase 6 simulator would need (all
//   approvals UNSATISFIED). `executable` is always false. It builds/signs/simulates/
//   sends NOTHING and carries no chain capability. Reads the named file only; writes
//   nothing unless --out.
// ---------------------------------------------------------------------------

export interface PaperPhase6IntentPlanCommandOptions {
  /** Decision report JSON path (sniper.paper.decision.report.v1). Required. */
  decisionsPath?: string;
  /** Optional plan label echoed into the plan. */
  planLabel?: string;
  /** Optional amount LABEL applied to every entry (never currency). */
  amountLabel?: string;
  /** Optional SIMULATED unit count applied to every entry (not currency). */
  amountUnits?: number;
  json?: boolean;
  /** Optional path to write the inert plan JSON (writes nothing if omitted). */
  outPath?: string;
  /** Overwrite an existing --out file (refused by default). */
  force?: boolean;
}

/**
 * `soulmaker paper:phase6:intent:plan` — build an INERT, NOT-EXECUTABLE simulation intent plan
 * (`simulation.intent.plan.v1`) from a LOCAL paper decision report. Reads ONLY the named file
 * (BOM-tolerant). It produces one inert DATA entry per SIMULATED `paper-enter`, each carrying a
 * hypothetical side, an amount LABEL (never a currency amount), reason codes, the risk constraints / the
 * required operator approvals (ALL unsatisfied) / the future simulation checks a Phase 6 simulator would
 * need. The plan's `executable` flag is always false; it builds, signs, simulates, and sends NOTHING and
 * carries no chain capability. `--json` emits the plan; `--out` writes ONLY the plan JSON (refusing
 * overwrite without `--force`). No network, no wallet, no transaction build/sign/send.
 */
export function paperPhase6IntentPlanReport(
  ctx: CommandContext = {},
  opts: PaperPhase6IntentPlanCommandOptions = {},
): CliReport {
  if (!opts.decisionsPath) return { text: "Refusing: --decisions <path> is required.", exitCode: 1 };

  let value: unknown;
  try {
    value = readJsonValue(ctx, opts.decisionsPath, "decision report");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let plan: SimulationIntentPlan;
  try {
    plan = buildSimulationIntentPlan({
      decisionReport: value,
      planLabel: opts.planLabel ?? null,
      amountLabel: opts.amountLabel ?? null,
      amountUnits: typeof opts.amountUnits === "number" ? opts.amountUnits : null,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(plan), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write simulation intent plan at ${resolved}`), exitCode: 1 };
    }
  }

  if (opts.json) {
    return { text: JSON.stringify(redactValue(plan), null, 2), exitCode: 0 };
  }
  return { text: formatSimulationIntentPlan(plan, { label: opts.decisionsPath }), exitCode: 0 };
}

// ---------------------------------------------------------------------------
// Sprint 42 — paper:phase6:diff:intent
//   Deterministically diff TWO existing INERT simulation intent plans
//   (`simulation.intent.plan.diff.v1`). Reads ONLY the two named files; runs no
//   plan, writes nothing. Comparing two non-executable DATA objects executes
//   NOTHING. `executable` is always false. No network, no wallet.
// ---------------------------------------------------------------------------

export interface PaperPhase6DiffIntentCommandOptions {
  /** Base intent plan JSON path. Required. */
  basePath?: string;
  /** Next intent plan JSON path. Required. */
  nextPath?: string;
  json?: boolean;
  failOnChange?: boolean;
  failOnNewEntry?: boolean;
}

/**
 * `soulmaker paper:phase6:diff:intent` — deterministically diff TWO existing INERT simulation intent plan
 * JSON files (`simulation.intent.plan.diff.v1`). Reads ONLY the two named files (BOM-tolerant;
 * malformed/wrong-schema refused), runs no plan, and writes nothing. It pairs hypothetical entries by id
 * (added / removed / common) and reports per-entry amount label/unit changes. Comparing two
 * NOT-EXECUTABLE plans executes NOTHING; the diff's `executable` flag is always false. `--json` emits the
 * stable, redacted diff; `--fail-on-change` / `--fail-on-new-entry` set the exit code. No network, no
 * wallet.
 */
export function paperPhase6DiffIntentReport(
  ctx: CommandContext = {},
  opts: PaperPhase6DiffIntentCommandOptions = {},
): CliReport {
  if (!opts.basePath) return { text: "Refusing: --base <path> is required.", exitCode: 1 };
  if (!opts.nextPath) return { text: "Refusing: --next <path> is required.", exitCode: 1 };

  let baseValue: unknown;
  let nextValue: unknown;
  try {
    baseValue = readJsonValue(ctx, opts.basePath, "base intent plan");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }
  try {
    nextValue = readJsonValue(ctx, opts.nextPath, "next intent plan");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let diff: SimulationIntentPlanDiff;
  try {
    diff = diffSimulationIntentPlans(baseValue, nextValue);
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  const exitCode =
    (opts.failOnChange && diff.hasChange) || (opts.failOnNewEntry && diff.hasNewEntry) ? 1 : 0;

  if (opts.json) {
    return { text: JSON.stringify(redactValue(diff), null, 2), exitCode };
  }
  return { text: formatSimulationIntentPlanDiff(diff, { label: `${opts.basePath} → ${opts.nextPath}` }), exitCode };
}

function yesNo(value: boolean): string {
  return value ? "yes" : "no";
}

// ---------------------------------------------------------------------------
// Sprint 66 — paper:simulation:intent:plan / paper:simulation:result /
//             paper:simulation:validate
//   The Phase 6 CLI surface over @soulmaker/simulation. Read-only over the
//   named artifact files; writes nothing unless --out; never signs, never
//   sends, never authorizes live trading (literal locks validated).
// ---------------------------------------------------------------------------

export interface PaperSimulationIntentPlanCommandOptions {
  /** Path to the v2 decision report (omitting it produces an honestly BLOCKED plan). */
  decisionsPath?: string;
  /** Path to the v2 safety gates report. */
  gatesPath?: string;
  /** Path to the v2 phase6 prerequisite report. */
  prereqsPath?: string;
  /** Path to the kill-switch spec. */
  killSwitchPath?: string;
  /** Path to the secrets policy. */
  secretsPolicyPath?: string;
  /** Path to the burner isolation spec. */
  burnerIsolationPath?: string;
  /** Operator-declared stop-simulation kill-switch state (true BLOCKS the plan). */
  stopSimulationTripped?: boolean;
  /** EXPLICIT operator acknowledgment that the paper-enters were reviewed (narrow; surfaced). */
  acknowledgePaperEnterReview?: boolean;
  operatorLabel?: string;
  planLabel?: string;
  /** Paper-unit amount LABEL applied to every entry (never currency). */
  amountLabel?: string;
  json?: boolean;
  outPath?: string;
  force?: boolean;
  /** Exit non-zero when the plan is BLOCKED. */
  failOnBlocking?: boolean;
  /** Exit non-zero when any entry carries unresolved fields. */
  failOnUnresolved?: boolean;
}

/**
 * `soulmaker paper:simulation:intent:plan` — build a `simulation.intent.plan.v2` from the named
 * v2-chain artifact files. Fail-closed: a missing/invalid/v1 artifact, not-ready gates, unmet
 * prereqs, a non-adopted spec, or a declared stop-simulation switch produces a BLOCKED plan with
 * stable reason codes (the command still exits 0 unless a --fail-on-* flag asks otherwise — the
 * blocked plan IS the honest artifact). A named-but-unreadable file refuses outright. Previews
 * never invent a destination/amount/fee. Reads only the named files; writes nothing unless
 * `--out` (refusing overwrite without `--force`). No network, no wallet.
 */
export function paperSimulationIntentPlanReport(
  ctx: CommandContext = {},
  opts: PaperSimulationIntentPlanCommandOptions = {},
): CliReport {
  const read = (path: string | undefined, label: string): { value: unknown; error?: string } => {
    if (!path) return { value: undefined };
    try {
      return { value: readJsonValue(ctx, path, label) };
    } catch (err) {
      return { value: undefined, error: (err as Error).message };
    }
  };
  const sources = [
    ["decisions", read(opts.decisionsPath, "decision report")],
    ["gates", read(opts.gatesPath, "safety gates report")],
    ["prereqs", read(opts.prereqsPath, "phase6 prerequisite report")],
    ["kill-switch", read(opts.killSwitchPath, "kill-switch spec")],
    ["secrets-policy", read(opts.secretsPolicyPath, "secrets policy")],
    ["burner-isolation", read(opts.burnerIsolationPath, "burner isolation spec")],
  ] as const;
  for (const [label, r] of sources) {
    if (r.error) return { text: redactString(`Refusing: ${label}: ${r.error}`), exitCode: 1 };
  }

  let plan: SimulationIntentPlanV2;
  try {
    plan = buildSimulationIntentPlanV2({
      decision: sources[0][1].value,
      safetyGates: sources[1][1].value,
      prereqs: sources[2][1].value,
      killSwitchSpec: sources[3][1].value,
      secretsPolicy: sources[4][1].value,
      burnerIsolationSpec: sources[5][1].value,
      stopSimulationTripped: Boolean(opts.stopSimulationTripped),
      operatorAcknowledgedPaperEnterReview: Boolean(opts.acknowledgePaperEnterReview),
      operatorLabel: opts.operatorLabel ?? null,
      planLabel: opts.planLabel ?? null,
      paperAmountLabel: opts.amountLabel ?? null,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(plan), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write simulation intent plan at ${resolved}`), exitCode: 1 };
    }
  }

  let exitCode = 0;
  if (opts.failOnBlocking && plan.blocked) exitCode = 1;
  if (opts.failOnUnresolved && plan.unresolvedEntryCount > 0) exitCode = 1;
  if (opts.json) {
    return { text: JSON.stringify(redactValue(plan), null, 2), exitCode };
  }
  return { text: formatSimulationIntentPlanV2(plan, { label: opts.planLabel ?? undefined }), exitCode };
}

export interface PaperSimulationResultCommandOptions {
  /** Path to the `simulation.intent.plan.v2` artifact (required). */
  planPath?: string;
  /** Operator-declared stop-simulation kill-switch state AT RESULT TIME (true BLOCKS). */
  stopSimulationTripped?: boolean;
  json?: boolean;
  outPath?: string;
  force?: boolean;
  /** Exit non-zero when the result is BLOCKED. */
  failOnBlocked?: boolean;
  /** Exit non-zero when any entry was skipped over unresolved previews. */
  failOnUnresolved?: boolean;
  /** Exit non-zero when the dry-run was unavailable. */
  failOnDryRunUnavailable?: boolean;
}

/**
 * `soulmaker paper:simulation:result` — build a `simulation.result.v1` from a named intent-plan
 * file using the package's honest UNAVAILABLE dry-run adapter (the ONLY adapter that exists: a
 * real dry-run needs transaction material the simulation boundary forbids building, so resolved
 * entries report unavailable — never faked). The plan is strictly revalidated (an invalid plan
 * refuses); unresolved previews are SKIPPED; a blocked plan or a declared stop-simulation switch
 * produces a BLOCKED result. Reads only the named file; writes nothing unless `--out` (refusing
 * overwrite without `--force`). Never signs, never sends. No network, no wallet.
 */
export function paperSimulationResultReport(
  ctx: CommandContext = {},
  opts: PaperSimulationResultCommandOptions = {},
): CliReport {
  if (!opts.planPath) {
    return { text: "Refusing: --plan <path> is required (a simulation.intent.plan.v2 artifact).", exitCode: 1 };
  }
  let raw: unknown;
  try {
    raw = readJsonValue(ctx, opts.planPath, "simulation intent plan");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let result: SimulationResultV1;
  try {
    result = buildSimulationResultV1({ plan: raw, stopSimulationTripped: Boolean(opts.stopSimulationTripped) });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(result), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write simulation result at ${resolved}`), exitCode: 1 };
    }
  }

  let exitCode = 0;
  if (opts.failOnBlocked && result.resultStatus === "blocked") exitCode = 1;
  if (opts.failOnUnresolved && result.skippedCount > 0) exitCode = 1;
  if (opts.failOnDryRunUnavailable && result.resultStatus === "dry_run_unavailable") exitCode = 1;
  if (opts.json) {
    return { text: JSON.stringify(redactValue(result), null, 2), exitCode };
  }
  return { text: formatSimulationResultV1(result, { label: opts.planPath }), exitCode };
}

export interface PaperSimulationValidateCommandOptions {
  /** Path to a `simulation.intent.plan.v2` artifact to validate. */
  planPath?: string;
  /** Path to a `simulation.result.v1` artifact to validate. */
  resultPath?: string;
  json?: boolean;
}

interface SimulationValidationOutcome {
  path: string;
  expectedSchemaVersion: string;
  valid: boolean;
  error: string | null;
}

/**
 * `soulmaker paper:simulation:validate` — strictly validate named simulation artifacts with the
 * PRODUCTION validators (`simulation.intent.plan.v2` via `--plan`, `simulation.result.v1` via
 * `--result`; at least one is required). Validation includes the literal safety locks — a flipped
 * `neverSigns`/`neverSends`/`dryRunOnly`/`neverAuthorizesLiveTrading` is INVALID. Exits 1 when any
 * named artifact is unreadable or invalid. Reads only the named files; writes nothing. No
 * network, no wallet.
 */
export function paperSimulationValidateReport(
  ctx: CommandContext = {},
  opts: PaperSimulationValidateCommandOptions = {},
): CliReport {
  if (!opts.planPath && !opts.resultPath) {
    return { text: "Refusing: pass --plan <path> and/or --result <path> to validate.", exitCode: 1 };
  }
  const outcomes: SimulationValidationOutcome[] = [];
  const check = (path: string | undefined, label: string, expected: string, validate: (v: unknown) => unknown): void => {
    if (!path) return;
    try {
      const value = readJsonValue(ctx, path, label);
      validate(value);
      outcomes.push({ path, expectedSchemaVersion: expected, valid: true, error: null });
    } catch (err) {
      outcomes.push({ path, expectedSchemaVersion: expected, valid: false, error: redactString((err as Error).message) });
    }
  };
  check(opts.planPath, "simulation intent plan", SIMULATION_INTENT_PLAN_V2_SCHEMA_VERSION, validateSimulationIntentPlanV2);
  check(opts.resultPath, "simulation result", SIMULATION_RESULT_V1_SCHEMA_VERSION, validateSimulationResultV1);

  const allValid = outcomes.every((o) => o.valid);
  const exitCode = allValid ? 0 : 1;
  if (opts.json) {
    return { text: JSON.stringify(redactValue({ allValid, outcomes }), null, 2), exitCode };
  }
  const lines = ["SIMULATION ARTIFACT VALIDATION (production validators; literal safety locks enforced)"];
  for (const o of outcomes) {
    lines.push(`${o.valid ? "✓ VALID  " : "✗ INVALID"} ${o.expectedSchemaVersion}  ${o.path}`);
    if (o.error) lines.push(`    ${o.error}`);
  }
  lines.push(allValid ? "All named artifacts are strictly valid." : "Validation FAILED — fix or rebuild the artifact(s) above.");
  return { text: redactString(lines.join("\n")), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 67 (+87) — paper:simulation:audit
//   The Phase 6 CHAIN AUDIT (`phase6.audit.report.v1`) over the ten v2/
//   simulation artifacts (Sprint 87 added the route-resolution artifact).
//   Reports; never authorizes. Reads only the named files; writes nothing
//   unless --out.
// ---------------------------------------------------------------------------

export interface PaperSimulationAuditCommandOptions {
  decisionsPath?: string;
  runReportPath?: string;
  gatesPath?: string;
  prereqsPath?: string;
  killSwitchPath?: string;
  secretsPolicyPath?: string;
  burnerIsolationPath?: string;
  intentPlanPath?: string;
  simulationResultPath?: string;
  /** Path to the `simulation.route.resolution.v1` artifact (Sprint 87). */
  routePath?: string;
  operatorLabel?: string;
  json?: boolean;
  outPath?: string;
  force?: boolean;
  /** Exit non-zero when the audit FAILED (any blocking finding). */
  failOnFindings?: boolean;
  /** Exit non-zero when the chain is incomplete (any artifact missing or invalid). */
  failOnIncomplete?: boolean;
  /** Exit non-zero when the chain carries any surfaced blocking condition of its own. */
  failOnChainConditions?: boolean;
}

/**
 * `soulmaker paper:simulation:audit` — build a `phase6.audit.report.v1` over the named chain
 * artifact files (decision v2, run report v2, safety gates v2, prereqs v2, the three specs, the
 * simulation intent plan v2, the simulation result v1, and the route-resolution artifact v1).
 * Each artifact is strictly validated
 * in place; missing artifacts are WARNINGS (an incomplete chain is reported, never assumed);
 * invalid artifacts, v1 stand-ins, and structured cross-reference mismatches FAIL the audit; the
 * chain's own blocking conditions are surfaced verbatim and never waived. A named-but-unreadable
 * file refuses outright. The audit reports — it never authorizes anything. Reads only the named
 * files, writes nothing unless `--out` (refusing overwrite without `--force`). No network, no
 * wallet.
 */
export function paperSimulationAuditReport(
  ctx: CommandContext = {},
  opts: PaperSimulationAuditCommandOptions = {},
): CliReport {
  const read = (path: string | undefined, label: string): { value: unknown; error?: string } => {
    if (!path) return { value: undefined };
    try {
      return { value: readJsonValue(ctx, path, label) };
    } catch (err) {
      return { value: undefined, error: (err as Error).message };
    }
  };
  const sources = [
    ["decisions", read(opts.decisionsPath, "decision report")],
    ["run-report", read(opts.runReportPath, "run report")],
    ["gates", read(opts.gatesPath, "safety gates report")],
    ["prereqs", read(opts.prereqsPath, "phase6 prerequisite report")],
    ["kill-switch", read(opts.killSwitchPath, "kill-switch spec")],
    ["secrets-policy", read(opts.secretsPolicyPath, "secrets policy")],
    ["burner-isolation", read(opts.burnerIsolationPath, "burner isolation spec")],
    ["intent-plan", read(opts.intentPlanPath, "simulation intent plan")],
    ["simulation-result", read(opts.simulationResultPath, "simulation result")],
    ["route", read(opts.routePath, "route-resolution artifact")],
  ] as const;
  for (const [label, r] of sources) {
    if (r.error) return { text: redactString(`Refusing: ${label}: ${r.error}`), exitCode: 1 };
  }

  let report: Phase6AuditReportV1;
  try {
    report = buildPhase6AuditReportV1({
      decision: sources[0][1].value,
      runReport: sources[1][1].value,
      safetyGates: sources[2][1].value,
      prereqs: sources[3][1].value,
      killSwitchSpec: sources[4][1].value,
      secretsPolicy: sources[5][1].value,
      burnerIsolationSpec: sources[6][1].value,
      intentPlan: sources[7][1].value,
      simulationResult: sources[8][1].value,
      routeResolution: sources[9][1].value,
      operatorLabel: opts.operatorLabel ?? null,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(report), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write phase6 audit report at ${resolved}`), exitCode: 1 };
    }
  }

  let exitCode = 0;
  if (opts.failOnFindings && !report.auditPassed) exitCode = 1;
  if (opts.failOnIncomplete && !report.chainComplete) exitCode = 1;
  if (opts.failOnChainConditions && report.chainConditionCodes.length > 0) exitCode = 1;
  if (opts.json) {
    return { text: JSON.stringify(redactValue(report), null, 2), exitCode };
  }
  return { text: formatPhase6AuditReportV1(report, { label: opts.operatorLabel ?? undefined }), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 69 — paper:simulation:readiness
//   The structural "is the Phase 6 simulation stack green?" report
//   (`phase6.simulation.readiness.report.v1`). phase7LiveTradingReady is a
//   literal false, always.
// ---------------------------------------------------------------------------

export interface PaperSimulationReadinessCommandOptions {
  /** Path to the `phase6.audit.report.v1` artifact. */
  auditPath?: string;
  /** Path to the `simulation.intent.plan.v2` artifact. */
  planPath?: string;
  /** Path to the `simulation.result.v1` artifact. */
  resultPath?: string;
  /** Repeatable `area=ref` evidence declarations (verbatim; never verified). */
  evidence?: string[];
  operatorLabel?: string;
  json?: boolean;
  outPath?: string;
  force?: boolean;
  /** Exit non-zero when phase6SimulationReady is false. */
  failOnNotReady?: boolean;
}

/**
 * `soulmaker paper:simulation:readiness` — build a `phase6.simulation.readiness.report.v1` from
 * the named audit/plan/result files plus repeatable `--evidence area=ref` declarations. Artifact
 * checks are machine-verified (strict validators); evidence references are recorded VERBATIM as
 * declarations (the command cannot run tests and never claims it did). Readiness is fail-closed,
 * and `phase7LiveTradingReady` is a literal false — this command is structurally incapable of
 * claiming live-trading readiness. Reads only the named files, writes nothing unless `--out`
 * (refusing overwrite without `--force`). No network, no wallet.
 */
export function paperSimulationReadinessReport(
  ctx: CommandContext = {},
  opts: PaperSimulationReadinessCommandOptions = {},
): CliReport {
  const read = (path: string | undefined, label: string): { value: unknown; error?: string } => {
    if (!path) return { value: undefined };
    try {
      return { value: readJsonValue(ctx, path, label) };
    } catch (err) {
      return { value: undefined, error: (err as Error).message };
    }
  };
  const audit = read(opts.auditPath, "phase6 audit report");
  const plan = read(opts.planPath, "simulation intent plan");
  const result = read(opts.resultPath, "simulation result");
  for (const [label, r] of [["audit", audit], ["plan", plan], ["result", result]] as const) {
    if (r.error) return { text: redactString(`Refusing: ${label}: ${r.error}`), exitCode: 1 };
  }

  const evidence: Partial<Record<Phase6ReadinessEvidenceArea, string>> = {};
  for (const raw of opts.evidence ?? []) {
    const eq = raw.indexOf("=");
    if (eq <= 0 || eq === raw.length - 1) {
      return { text: redactString(`Refusing: --evidence must be area=ref (got "${raw}").`), exitCode: 1 };
    }
    const area = raw.slice(0, eq);
    if (!(PHASE6_READINESS_EVIDENCE_AREAS as readonly string[]).includes(area)) {
      return {
        text: redactString(`Refusing: unknown evidence area "${area}" (known: ${PHASE6_READINESS_EVIDENCE_AREAS.join(", ")}).`),
        exitCode: 1,
      };
    }
    evidence[area as Phase6ReadinessEvidenceArea] = raw.slice(eq + 1);
  }

  let report: Phase6SimulationReadinessReportV1;
  try {
    report = buildPhase6SimulationReadinessReportV1({
      auditReport: audit.value,
      intentPlan: plan.value,
      simulationResult: result.value,
      evidence,
      operatorLabel: opts.operatorLabel ?? null,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(report), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write phase6 readiness report at ${resolved}`), exitCode: 1 };
    }
  }

  const exitCode = opts.failOnNotReady && !report.phase6SimulationReady ? 1 : 0;
  if (opts.json) {
    return { text: JSON.stringify(redactValue(report), null, 2), exitCode };
  }
  return { text: formatPhase6SimulationReadinessReportV1(report, { label: opts.operatorLabel ?? undefined }), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 75 (+87) — paper:simulation:handoff
//   The simulation-aware session handoff (`phase6.simulation.handoff.pack.v1`):
//   twelve chain artifacts (Sprint 87 added the route-resolution artifact)
//   strictly validated in place and summarized from structured fields;
//   missing artifacts CLASSIFIED, never invented. Reads only the named files;
//   writes nothing unless --out; never signs, never sends;
//   phase7LiveTradingReady is a literal false.
// ---------------------------------------------------------------------------

export interface PaperSimulationHandoffCommandOptions {
  decisionsPath?: string;
  runReportPath?: string;
  gatesPath?: string;
  prereqsPath?: string;
  killSwitchPath?: string;
  secretsPolicyPath?: string;
  burnerIsolationPath?: string;
  intentPlanPath?: string;
  simulationResultPath?: string;
  /** Path to the `simulation.route.resolution.v1` artifact (Sprint 87). */
  routePath?: string;
  auditPath?: string;
  readinessPath?: string;
  operatorLabel?: string;
  packLabel?: string;
  json?: boolean;
  outPath?: string;
  force?: boolean;
  /** Exit non-zero when the pack is incomplete (any artifact missing or invalid). */
  failOnIncomplete?: boolean;
  /** Exit non-zero when the chain carries any blocking condition (verbatim codes). */
  failOnBlocking?: boolean;
  /** Exit non-zero unless the verbatim readiness verdict is true (missing/invalid counts as NOT ready). */
  failOnNotReady?: boolean;
}

/**
 * `soulmaker paper:simulation:handoff` — build a `phase6.simulation.handoff.pack.v1` from the
 * named chain artifact files (the ten audited roles — including the Sprint 87 route-resolution
 * artifact — plus the chain audit and the readiness report). Each artifact is strictly validated
 * in place and summarized from VERBATIM structured
 * fields; a missing artifact is CLASSIFIED as missing (never invented); a named-but-unreadable
 * file refuses outright. The chain's blocking conditions and the readiness verdict are carried
 * verbatim, and `phase7LiveTradingReady` is a literal false. Reads only the named files, writes
 * nothing unless `--out` (refusing overwrite without `--force`). Never signs, never sends. No
 * network, no wallet.
 */
export function paperSimulationHandoffReport(
  ctx: CommandContext = {},
  opts: PaperSimulationHandoffCommandOptions = {},
): CliReport {
  const read = (path: string | undefined, label: string): { value: unknown; error?: string } => {
    if (!path) return { value: undefined };
    try {
      return { value: readJsonValue(ctx, path, label) };
    } catch (err) {
      return { value: undefined, error: (err as Error).message };
    }
  };
  const sources = [
    ["decisions", read(opts.decisionsPath, "decision report")],
    ["run-report", read(opts.runReportPath, "run report")],
    ["gates", read(opts.gatesPath, "safety gates report")],
    ["prereqs", read(opts.prereqsPath, "phase6 prerequisite report")],
    ["kill-switch", read(opts.killSwitchPath, "kill-switch spec")],
    ["secrets-policy", read(opts.secretsPolicyPath, "secrets policy")],
    ["burner-isolation", read(opts.burnerIsolationPath, "burner isolation spec")],
    ["intent-plan", read(opts.intentPlanPath, "simulation intent plan")],
    ["simulation-result", read(opts.simulationResultPath, "simulation result")],
    ["route", read(opts.routePath, "route-resolution artifact")],
    ["audit", read(opts.auditPath, "phase6 audit report")],
    ["readiness", read(opts.readinessPath, "phase6 readiness report")],
  ] as const;
  for (const [label, r] of sources) {
    if (r.error) return { text: redactString(`Refusing: ${label}: ${r.error}`), exitCode: 1 };
  }

  let pack: Phase6SimulationHandoffPackV1;
  try {
    pack = buildPhase6SimulationHandoffPackV1({
      decision: sources[0][1].value,
      runReport: sources[1][1].value,
      safetyGates: sources[2][1].value,
      prereqs: sources[3][1].value,
      killSwitchSpec: sources[4][1].value,
      secretsPolicy: sources[5][1].value,
      burnerIsolationSpec: sources[6][1].value,
      intentPlan: sources[7][1].value,
      simulationResult: sources[8][1].value,
      routeResolution: sources[9][1].value,
      auditReport: sources[10][1].value,
      readinessReport: sources[11][1].value,
      operatorLabel: opts.operatorLabel ?? null,
      packLabel: opts.packLabel ?? null,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(pack), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write phase6 handoff pack at ${resolved}`), exitCode: 1 };
    }
  }

  let exitCode = 0;
  if (opts.failOnIncomplete && !pack.complete) exitCode = 1;
  if (opts.failOnBlocking && pack.hasBlockingConditions) exitCode = 1;
  if (opts.failOnNotReady && pack.simulationReadyPerReadiness !== true) exitCode = 1;
  if (opts.json) {
    return { text: JSON.stringify(redactValue(pack), null, 2), exitCode };
  }
  return { text: formatPhase6SimulationHandoffPackV1(pack, { label: opts.packLabel ?? undefined }), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 86 — paper:simulation:route
//   The route-resolution PROVENANCE artifact (`simulation.route.resolution.v1`)
//   from a named intent-plan file via the S85 canonical builder — the ONLY
//   builder that exists: no route-resolution capability lives inside this
//   boundary, so every entry is honestly UNAVAILABLE under the fixed
//   `unavailable-no-route-resolver` id. Nothing is resolved, invented, or
//   fetched. Reads only the named file; writes nothing unless --out.
// ---------------------------------------------------------------------------

export interface PaperSimulationRouteCommandOptions {
  /** Path to the `simulation.intent.plan.v2` artifact (required). */
  planPath?: string;
  /** Optional `routequote.prepared.v1` artifact (Sprint 91): READ-ONLY quote observations whose
   * label facts enter the artifact with provenance. Contradictions with the plan REFUSE. */
  quotesPath?: string;
  /** Operator-declared stop-simulation kill-switch state AT RESOLUTION TIME (true BLOCKS). */
  stopSimulationTripped?: boolean;
  operatorLabel?: string;
  /** Optional resolution label echoed into the artifact. */
  resolutionLabel?: string;
  json?: boolean;
  outPath?: string;
  force?: boolean;
  /** Exit non-zero when the artifact is BLOCKED (missing/invalid/blocked plan or tripped stop). */
  failOnBlocked?: boolean;
  /** Exit non-zero when any entry is UNAVAILABLE — the canonical state today, so this gate trips
   * on EVERY honest artifact until a separately-authorized resolver exists. CI tripwire only. */
  failOnUnavailable?: boolean;
}

/**
 * `soulmaker paper:simulation:route` — build a `simulation.route.resolution.v1` from a named
 * intent-plan file using the package's CANONICAL builder, the only one that exists: no
 * route-resolution capability lives inside the simulation boundary (the import allowlist keeps it
 * that way), so every entry is honestly UNAVAILABLE under the fixed `unavailable-no-route-resolver`
 * id — route, destination, and fee stay unresolved, never invented, never fetched. The plan is
 * strictly validated in place; a missing/invalid/blocked plan or a declared stop-simulation switch
 * produces a BLOCKED artifact with stable reason codes (exit 0 — the blocked artifact IS the
 * honest record; `--fail-on-blocked` gates it). A named-but-unreadable file refuses outright.
 * Reads only the named file; writes nothing unless `--out` (refusing overwrite without `--force`).
 * Never signs, never sends, never resolves. No network, no wallet.
 */
export function paperSimulationRouteReport(
  ctx: CommandContext = {},
  opts: PaperSimulationRouteCommandOptions = {},
): CliReport {
  if (!opts.planPath) {
    return { text: "Refusing: --plan <path> is required (a simulation.intent.plan.v2 artifact).", exitCode: 1 };
  }
  let raw: unknown;
  try {
    raw = readJsonValue(ctx, opts.planPath, "simulation intent plan");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // Optional Sprint 91 quote seam: a strictly-validated routequote.prepared.v1 whose label facts
  // enter the builder with provenance. The prepared artifact must COVER every plan entry
  // (candidateId + mint) — a stale or mismatched quotes file refuses outright (fail closed); an
  // observed quote for a candidate that is NOT in the plan is skipped and reported, never applied.
  let routeFacts: SimulationRouteFactsInput | null = null;
  let quotesApplied = 0;
  let quotesSkipped: string[] = [];
  if (opts.quotesPath) {
    let quotesRaw: unknown;
    try {
      quotesRaw = readJsonValue(ctx, opts.quotesPath, "prepared routequote");
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    let prepared: RouteQuotePrepared;
    try {
      prepared = validateRouteQuotePrepared(quotesRaw);
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    let plan: SimulationIntentPlanV2 | null = null;
    try {
      plan = validateSimulationIntentPlanV2(raw);
    } catch {
      plan = null; // The builder records the invalid plan as a BLOCKED artifact; facts stay unapplied.
    }
    if (plan !== null && !plan.blocked) {
      const preparedById = new Map(prepared.entries.map((e) => [e.candidateId, e]));
      for (const pe of plan.entries) {
        const q = preparedById.get(pe.candidateId);
        if (q === undefined) {
          return {
            text: redactString(
              `Refusing: the prepared routequote carries no entry for plan candidate "${pe.candidateId}" — it was prepared for a different candidate set; rebuild it with paper:routequote:prepare (fail closed).`,
            ),
            exitCode: 1,
          };
        }
        if (q.mint !== pe.mint) {
          return {
            text: redactString(
              `Refusing: the prepared routequote entry for "${pe.candidateId}" contradicts the plan's mint — fail closed.`,
            ),
            exitCode: 1,
          };
        }
      }
      const all = toRouteQuoteFacts(prepared);
      const planIds = new Set(plan.entries.map((e) => e.candidateId));
      routeFacts = { resolverId: all.resolverId, facts: all.facts.filter((f) => planIds.has(f.candidateId)) };
      quotesApplied = routeFacts.facts.length;
      quotesSkipped = all.facts.filter((f) => !planIds.has(f.candidateId)).map((f) => f.candidateId);
    }
  }

  let artifact: SimulationRouteResolutionV1;
  try {
    artifact = buildSimulationRouteResolutionV1({
      intentPlan: raw,
      stopSimulationTripped: Boolean(opts.stopSimulationTripped),
      operatorLabel: opts.operatorLabel ?? null,
      resolutionLabel: opts.resolutionLabel ?? null,
      routeFacts,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(artifact), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write route-resolution artifact at ${resolved}`), exitCode: 1 };
    }
  }

  let exitCode = 0;
  if (opts.failOnBlocked && artifact.blocked) exitCode = 1;
  if (opts.failOnUnavailable && artifact.unavailableEntryCount > 0) exitCode = 1;
  if (opts.json) {
    return { text: JSON.stringify(redactValue(artifact), null, 2), exitCode };
  }
  const lines = [formatSimulationRouteResolutionV1(artifact, { label: opts.planPath })];
  if (opts.quotesPath) {
    lines.push("");
    lines.push(
      `Quotes: ${quotesApplied} observed label fact(s) applied from ${opts.quotesPath} (read-only observation provenance — never executable).`,
    );
    if (quotesSkipped.length > 0) {
      lines.push(
        `Skipped ${quotesSkipped.length} observed quote(s) for candidates not in the plan (${quotesSkipped.join(", ")}) — a quote can never add a candidate to the plan.`,
      );
    }
  }
  return { text: redactString(lines.join("\n")), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 88 — paper:simulation:bundle
//   The OPERATOR BUNDLE (`phase6.operator.bundle.v1`): thirteen chain
//   artifacts (the twelve handoff roles plus the handoff pack itself)
//   strictly validated in place and collected into one archiveable,
//   re-verifiable operator artifact with per-file integrity refs (truncated
//   sha256-128 digests — full 64-hex digests are key-shaped to the shared
//   redactor ON PURPOSE), a recomputed blocking trail cross-checked against
//   the handoff pack's verbatim trail, and a closed-set operator verdict
//   whose best value is reviewable-paper-only. Reads only the named files;
//   writes nothing unless --out; never signs, never sends.
// ---------------------------------------------------------------------------

export interface PaperSimulationBundleCommandOptions {
  decisionsPath?: string;
  runReportPath?: string;
  gatesPath?: string;
  prereqsPath?: string;
  killSwitchPath?: string;
  secretsPolicyPath?: string;
  burnerIsolationPath?: string;
  intentPlanPath?: string;
  simulationResultPath?: string;
  /** Path to the `simulation.route.resolution.v1` artifact. */
  routePath?: string;
  auditPath?: string;
  readinessPath?: string;
  /** Path to the `phase6.simulation.handoff.pack.v1` artifact. */
  handoffPath?: string;
  operatorLabel?: string;
  bundleLabel?: string;
  json?: boolean;
  outPath?: string;
  force?: boolean;
  /** Exit non-zero when the operator verdict is `blocked`. */
  failOnBlocked?: boolean;
  /** Exit non-zero when the bundle is incomplete (any artifact missing or invalid). */
  failOnIncomplete?: boolean;
}

/**
 * `soulmaker paper:simulation:bundle` — build a `phase6.operator.bundle.v1` from the named chain
 * artifact files (the twelve handoff roles plus the handoff pack itself). Each artifact is
 * strictly validated in place and summarized from VERBATIM structured fields; a missing artifact
 * is CLASSIFIED as missing (never invented); a named-but-unreadable file refuses outright. Every
 * named file gets an integrity reference (file name + truncated `sha256-128` digest of the bytes
 * read). The chain's blocking conditions are RECOMPUTED from the bundled artifacts and
 * cross-checked against the handoff pack's verbatim trail — a stale or tampered pack surfaces as
 * a blocked bundle. The closed-set operator verdict can never be better than
 * `reviewable-paper-only`, and `phase7LiveTradingReady` is a literal false. Reads only the named
 * files, writes nothing unless `--out` (refusing overwrite without `--force`). Never signs, never
 * sends. No network, no wallet.
 */
export function paperSimulationBundleReport(
  ctx: CommandContext = {},
  opts: PaperSimulationBundleCommandOptions = {},
): CliReport {
  const files: Partial<Record<Phase6OperatorBundleRole, { fileName: string; digest: string }>> = {};
  const read = (
    path: string | undefined,
    role: Phase6OperatorBundleRole | null,
    label: string,
  ): { value: unknown; error?: string } => {
    if (!path) return { value: undefined };
    const resolved = resolvePath(ctx, path);
    let bytes: Buffer;
    try {
      bytes = readFileSync(resolved);
    } catch {
      return { value: undefined, error: `cannot read ${label} file at ${resolved}` };
    }
    let value: unknown;
    try {
      value = JSON.parse(stripJsonBom(bytes.toString("utf8")));
    } catch {
      return { value: undefined, error: `${label} file is not valid JSON at ${resolved}` };
    }
    if (role) {
      files[role] = {
        fileName: path,
        digest: `sha256-128:${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}`,
      };
    }
    return { value };
  };
  const sources = [
    ["decisions", read(opts.decisionsPath, "decision", "decision report")],
    ["run-report", read(opts.runReportPath, "run-report", "run report")],
    ["gates", read(opts.gatesPath, "safety-gates", "safety gates report")],
    ["prereqs", read(opts.prereqsPath, "prereqs", "phase6 prerequisite report")],
    ["kill-switch", read(opts.killSwitchPath, "kill-switch-spec", "kill-switch spec")],
    ["secrets-policy", read(opts.secretsPolicyPath, "secrets-policy", "secrets policy")],
    ["burner-isolation", read(opts.burnerIsolationPath, "burner-isolation-spec", "burner isolation spec")],
    ["intent-plan", read(opts.intentPlanPath, "intent-plan", "simulation intent plan")],
    ["simulation-result", read(opts.simulationResultPath, "simulation-result", "simulation result")],
    ["route", read(opts.routePath, "route-resolution", "route-resolution artifact")],
    ["audit", read(opts.auditPath, "audit-report", "phase6 audit report")],
    ["readiness", read(opts.readinessPath, "readiness-report", "phase6 readiness report")],
    ["handoff", read(opts.handoffPath, "handoff-pack", "phase6 handoff pack")],
  ] as const;
  for (const [label, r] of sources) {
    if (r.error) return { text: redactString(`Refusing: ${label}: ${r.error}`), exitCode: 1 };
  }

  let bundle: Phase6OperatorBundleV1;
  try {
    bundle = buildPhase6OperatorBundleV1({
      decision: sources[0][1].value,
      runReport: sources[1][1].value,
      safetyGates: sources[2][1].value,
      prereqs: sources[3][1].value,
      killSwitchSpec: sources[4][1].value,
      secretsPolicy: sources[5][1].value,
      burnerIsolationSpec: sources[6][1].value,
      intentPlan: sources[7][1].value,
      simulationResult: sources[8][1].value,
      routeResolution: sources[9][1].value,
      auditReport: sources[10][1].value,
      readinessReport: sources[11][1].value,
      handoffPack: sources[12][1].value,
      files,
      operatorLabel: opts.operatorLabel ?? null,
      bundleLabel: opts.bundleLabel ?? null,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(bundle), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write operator bundle at ${resolved}`), exitCode: 1 };
    }
  }

  let exitCode = 0;
  if (opts.failOnBlocked && bundle.operatorVerdict === "blocked") exitCode = 1;
  if (opts.failOnIncomplete && !bundle.complete) exitCode = 1;
  if (opts.json) {
    return { text: JSON.stringify(redactValue(bundle), null, 2), exitCode };
  }
  return { text: formatPhase6OperatorBundleV1(bundle, { label: opts.bundleLabel ?? undefined }), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 88 — paper:sniper:dry-run
//   The PAPER-only dry-run ORCHESTRATOR: one command that takes an operator
//   candidate file and drives the ENTIRE existing chain — intake → preflight →
//   policy → decision v2 → run report v2 → audit log → session pack → specs →
//   gates v2 → prereqs v2 → intent plan v2 → simulation result → route
//   resolution (honestly all-UNAVAILABLE; no resolver capability exists) →
//   chain audit → readiness → handoff pack → operator bundle — writing every
//   artifact into ONE output directory plus a deterministic RUN_SUMMARY.md.
//   Every stage uses the existing production builders and command functions;
//   nothing is faked, nothing is invented, a blocked chain is the honest
//   artifact set (exit 0; --fail-on-blocked gates). It creates no live order,
//   no transaction, touches no wallet, and reaches no network.
// ---------------------------------------------------------------------------

/** The extra artifact a dry run writes when `--routequote` is supplied (Sprint 91): the validated
 * `routequote.prepared.v1` carried VERBATIM into the output folder so the chain's quote
 * provenance is inspectable next to the route-resolution artifact it fed. */
export const PAPER_DRY_RUN_ROUTEQUOTE_FILE = "routequote-prepared.json";

/** The artifact files one dry run writes into its output directory (stable order). */
export const PAPER_DRY_RUN_FILES = [
  "candidates.json",
  "preflight.json",
  "policy.json",
  "decision.json",
  "run-report.json",
  "audit-log.json",
  "session-pack.json",
  "kill-switch.json",
  "secrets-policy.json",
  "burner-isolation.json",
  "safety-gates.json",
  "prereqs.json",
  "intent-plan.json",
  "simulation-result.json",
  "route-resolution.json",
  "chain-audit.json",
  "readiness.json",
  "handoff-pack.json",
  "operator-bundle.json",
  "RUN_SUMMARY.md",
] as const;

/** The canonical Phase 6 readiness evidence declarations (the same repo refs the e2e suite pins —
 * each names the test file / doc that actually exercises that area in THIS repo). */
export const PAPER_DRY_RUN_READINESS_EVIDENCE: readonly string[] = [
  "package-boundary-tests=packages/simulation/src/no-forbidden-imports.test.ts",
  "cli-commands=apps/cli/src/simulation-commands.test.ts",
  "e2e-fixtures=apps/cli/src/simulation-e2e.test.ts",
  "source-scans=packages/simulation/src/package-boundary.test.ts",
  "docs=docs/SNIPER_RUNBOOK.md",
  "diff-chain-tests=packages/simulation/src/intent-plan-diff.test.ts",
  "handoff-pack-tests=packages/simulation/src/handoff-pack.test.ts",
  "output-quality-tests=packages/simulation/src/operator-output-quality.test.ts",
  "tally-validation-tests=packages/sniper/src/decision-tally-hardening.test.ts",
  "dry-run-boundary-doc=docs/PHASE6_DRY_RUN_BOUNDARY.md",
  "route-resolution-tests=packages/simulation/src/route-resolution.test.ts",
];

export interface PaperSniperDryRunCommandOptions {
  /** Candidate list JSON path (raw operator input or a canonical sniper.candidate.list.v1). Required. */
  candidatesPath?: string;
  /** Optional preflight input (`sniper.preflight.input.v1`) with per-candidate inspection/risk. */
  preflightInputPath?: string;
  /** Optional prepared routequote (`routequote.prepared.v1`, Sprint 91): READ-ONLY quote
   * observations carried into the route-resolution stage as label facts with provenance. Omitted →
   * the route stage stays the honest all-UNAVAILABLE boundary, exactly as before. */
  routequotePath?: string;
  /** Optional policy config path (v1 configs are upgraded; default: a fail-closed v2 policy). */
  policyPath?: string;
  /** Optional existing kill-switch spec artifact path (built draft/adopted otherwise). */
  killSwitchPath?: string;
  /** Optional existing secrets policy artifact path (built draft/adopted otherwise). */
  secretsPolicyPath?: string;
  /** Optional existing burner isolation spec artifact path (built draft/adopted otherwise). */
  burnerIsolationPath?: string;
  /** Build the three governance specs as ADOPTED (requires --operator). Without this flag (and
   * without supplied spec files) the specs are built as DRAFT and the chain blocks honestly. */
  adoptSpecs?: boolean;
  /** Apply the narrow paper-enter-review acknowledgment to the intent plan. */
  acknowledgePaperEnterReview?: boolean;
  /** Operator-declared stop-simulation kill-switch state (true BLOCKS the chain). */
  stopSimulationTripped?: boolean;
  operatorLabel?: string;
  /** Label echoed into the plan / route / handoff / bundle artifacts. */
  runLabel?: string;
  /** Output DIRECTORY for the full artifact set (created if missing). Required. */
  outDir?: string;
  /** Overwrite existing artifact files in the output directory (refused by default). */
  force?: boolean;
  json?: boolean;
  /** Exit non-zero when the final operator verdict is `blocked`. */
  failOnBlocked?: boolean;
}

/**
 * `soulmaker paper:sniper:dry-run` — run the FULL PAPER dry-run pipeline over an operator-supplied
 * candidate file and write the complete, validated, auditable artifact set into one output
 * directory. Every stage is the EXISTING production path: candidate intake (strict mint
 * validation), token preflight over operator-supplied inspection/risk data (entries without data
 * stay honestly `unknown`), a fail-closed v2 policy, the v2 decision/run-report/gates/prereqs
 * chain, the governance specs (DRAFT by default — pass `--adopt-specs` with `--operator` to adopt
 * the canonical paper-only specs for this run, or supply your own adopted spec files), then the
 * Phase 6 simulation chain (intent plan → result → route resolution → audit → readiness → handoff)
 * and the Sprint 88 operator bundle with per-file integrity digests. Route resolution is honestly
 * all-UNAVAILABLE: no route-resolver capability exists inside the simulation boundary and nothing
 * is invented. A BLOCKED chain still writes the full honest artifact set (exit 0;
 * `--fail-on-blocked` gates). Single-run diffs are not applicable and are not written. It creates
 * no live order, builds no transaction, touches no wallet, and reaches no network.
 */
export function paperSniperDryRunReport(
  ctx: CommandContext = {},
  opts: PaperSniperDryRunCommandOptions = {},
): CliReport {
  if (!opts.candidatesPath) return { text: "Refusing: --candidates <path> is required.", exitCode: 1 };
  if (!opts.outDir) return { text: "Refusing: --out <dir> is required (the artifact output directory).", exitCode: 1 };
  if (opts.adoptSpecs && !opts.operatorLabel) {
    return { text: "Refusing: --adopt-specs requires --operator <label> (spec adoption is an explicit operator decision).", exitCode: 1 };
  }

  const outDir = resolvePath(ctx, opts.outDir);
  const dryRunFiles: string[] = [...PAPER_DRY_RUN_FILES, ...(opts.routequotePath ? [PAPER_DRY_RUN_ROUTEQUOTE_FILE] : [])];
  if (!opts.force) {
    for (const f of dryRunFiles) {
      if (existsSync(join(outDir, f))) {
        return { text: redactString(`Refusing: ${join(outDir, f)} already exists (pass --force to overwrite).`), exitCode: 1 };
      }
    }
  }

  // 1) Candidate intake (same wrong-schema + strict-mint guards as the sibling commands).
  let raw: unknown;
  try {
    raw = readJsonValue(ctx, opts.candidatesPath, "sniper candidate list");
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }
  if (!isPlainObject(raw)) {
    return { text: "Refusing: candidate list must be a JSON object with a candidates array.", exitCode: 1 };
  }
  if (raw.schemaVersion !== undefined && raw.schemaVersion !== SNIPER_CANDIDATE_LIST_SCHEMA_VERSION) {
    return { text: redactString(`Refusing: candidate list schemaVersion must be "${SNIPER_CANDIDATE_LIST_SCHEMA_VERSION}".`), exitCode: 1 };
  }
  let candidateList: SniperCandidateList;
  try {
    candidateList = normalizeSniperCandidateList({
      sourceLabel: typeof raw.sourceLabel === "string" ? raw.sourceLabel : opts.candidatesPath,
      candidates: (raw.candidates ?? []) as never,
    });
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // 2) Optional preflight input (per-candidate inspection/risk; cross-checked against the list).
  const dataById = new Map<string, SniperPreflightCandidateData>();
  if (opts.preflightInputPath) {
    let inputRaw: unknown;
    try {
      inputRaw = readJsonValue(ctx, opts.preflightInputPath, "preflight input");
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    if (!isPlainObject(inputRaw)) {
      return { text: "Refusing: preflight input must be a JSON object with an entries array.", exitCode: 1 };
    }
    if (inputRaw.schemaVersion !== undefined && inputRaw.schemaVersion !== SNIPER_PREFLIGHT_INPUT_SCHEMA_VERSION) {
      return { text: redactString(`Refusing: preflight input schemaVersion must be "${SNIPER_PREFLIGHT_INPUT_SCHEMA_VERSION}".`), exitCode: 1 };
    }
    let inputArtifact: SniperPreflightInput;
    try {
      inputArtifact = normalizeSniperPreflightInput({
        sourceLabel: typeof inputRaw.sourceLabel === "string" ? inputRaw.sourceLabel : opts.preflightInputPath,
        candidateListRef: typeof inputRaw.candidateListRef === "string" ? inputRaw.candidateListRef : null,
        entries: (inputRaw.entries ?? []) as never,
        candidateList,
      });
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    for (const e of inputArtifact.entries) {
      const entry: SniperPreflightCandidateData = { candidateId: e.candidateId };
      if (e.inspection !== null) entry.inspection = e.inspection;
      if (e.risk !== null) entry.risk = e.risk;
      dataById.set(e.candidateId, entry);
    }
  }

  // 2b) Optional prepared routequote (Sprint 91): strictly validated, then cross-checked BOTH ways
  //     against the candidate list — a quotes file prepared for a different candidate set refuses
  //     outright (fail closed; rebuild it with paper:routequote:prepare).
  let routequote: RouteQuotePrepared | null = null;
  if (opts.routequotePath) {
    let routequoteRaw: unknown;
    try {
      routequoteRaw = readJsonValue(ctx, opts.routequotePath, "prepared routequote");
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    if (isPlainObject(routequoteRaw) && routequoteRaw.schemaVersion !== ROUTE_QUOTE_PREPARED_SCHEMA_VERSION) {
      return {
        text: redactString(`Refusing: --routequote schemaVersion must be "${ROUTE_QUOTE_PREPARED_SCHEMA_VERSION}" (build it with paper:routequote:prepare).`),
        exitCode: 1,
      };
    }
    try {
      routequote = validateRouteQuotePrepared(routequoteRaw);
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    const mintById = new Map(candidateList.candidates.map((c) => [c.candidateId, c.mint]));
    for (const e of routequote.entries) {
      const expected = mintById.get(e.candidateId);
      if (expected === undefined) {
        return {
          text: redactString(
            `Refusing: the prepared routequote carries entry "${e.candidateId}" which is not in this candidate list — it was prepared for a different set; rebuild it with paper:routequote:prepare (fail closed).`,
          ),
          exitCode: 1,
        };
      }
      if (expected !== e.mint) {
        return {
          text: redactString(`Refusing: the prepared routequote entry "${e.candidateId}" contradicts the candidate list's mint — fail closed.`),
          exitCode: 1,
        };
      }
    }
    const covered = new Set(routequote.entries.map((e) => e.candidateId));
    const uncovered = candidateList.candidates.filter((c) => !covered.has(c.candidateId));
    if (uncovered.length > 0) {
      return {
        text: redactString(
          `Refusing: the prepared routequote does not cover candidate(s) ${uncovered.map((c) => c.candidateId).join(", ")} — rebuild it with paper:routequote:prepare over THIS candidate list (fail closed).`,
        ),
        exitCode: 1,
      };
    }
  }

  // 3) Policy: operator-supplied (v1 upgraded to v2) or the fail-closed default.
  let policy: SniperPolicyConfigV2;
  if (opts.policyPath) {
    let policyValue: unknown;
    try {
      policyValue = readJsonValue(ctx, opts.policyPath, "policy config");
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
    if (!isPlainObject(policyValue)) {
      return { text: "Refusing: policy config must be a JSON object.", exitCode: 1 };
    }
    try {
      policy =
        policyValue.schemaVersion === SNIPER_POLICY_CONFIG_SCHEMA_VERSION
          ? upgradeSniperPolicyConfigV1ToV2(normalizeSniperPolicyConfig(policyValue as never))
          : normalizeSniperPolicyConfigV2(policyValue as never);
    } catch (err) {
      return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
    }
  } else {
    policy = normalizeSniperPolicyConfigV2({
      policyLabel: "paper-dry-run-default-policy",
      policyMode: "balanced-paper",
      allowPaperEnter: true,
      requirePreflightPass: true,
      failClosedOnUnknownPreflight: true,
      failClosedOnMissingRisk: true,
    });
  }

  // 4) The sniper-side chain through the production builders (the fixtures' exact recipe).
  const operatorLabel = opts.operatorLabel ?? null;
  const runLabel = opts.runLabel ?? "paper-dry-run";
  let chainFiles: Array<readonly [string, unknown]>;
  try {
    const preflight = buildSniperTokenPreflightReport({ candidateList, candidateData: [...dataById.values()] });
    const decision = buildPaperSniperDecisionReportV2({ candidateList, preflight, policy });
    const runReport = buildSniperRunReportV2({ candidateList, preflight, decision, policy, operatorLabel });
    const decisionV1 = buildPaperSniperDecisionReport({ candidateList, preflight });
    const runReportV1 = buildSniperRunReport({ candidateList, preflight, decision: decisionV1 });
    const auditLog = buildSniperAuditLog({ runReport: runReportV1, runLabel });
    const sessionPack = buildSniperSessionPack({
      sessionLabel: runLabel,
      artifacts: [
        { label: "candidates", value: candidateList },
        { label: "preflight", value: preflight },
        { label: "decision", value: decision },
        { label: "run-report", value: runReport },
        { label: "audit-log", value: auditLog },
        { label: "policy", value: policy },
      ],
    });
    const readinessStatus = opts.adoptSpecs ? "adopted" : "draft";
    const killSwitchSpec = opts.killSwitchPath
      ? readJsonValue(ctx, opts.killSwitchPath, "kill-switch spec")
      : buildSniperKillSwitchSpec({
          operatorLabel,
          requiredOperatorConfirmations: opts.adoptSpecs
            ? [`${operatorLabel} confirms adoption of the canonical PAPER-only kill-switch spec for this dry run`]
            : undefined,
          readinessStatus,
        });
    const secretsPolicy = opts.secretsPolicyPath
      ? readJsonValue(ctx, opts.secretsPolicyPath, "secrets policy")
      : buildSniperSecretsPolicy({ operatorLabel, readinessStatus });
    const burnerIsolationSpec = opts.burnerIsolationPath
      ? readJsonValue(ctx, opts.burnerIsolationPath, "burner isolation spec")
      : buildSniperBurnerIsolationSpec({ operatorLabel, killSwitchSpecRef: operatorLabel ?? runLabel, readinessStatus });
    const gates = buildSniperSafetyGatesReportV2({
      candidateList,
      preflight,
      policy,
      decision,
      runReport,
      sessionPack,
      auditLog,
      operatorLabel,
    });
    const prereqs = buildPhase6PrerequisiteReportV2({
      sessionPack,
      policy,
      safetyGates: gates,
      decision,
      runReport,
      auditLog,
      killSwitchSpec,
      secretsPolicy,
      burnerIsolationSpec,
      operatorLabel,
    });
    chainFiles = [
      ["candidates.json", candidateList],
      ["preflight.json", preflight],
      ["policy.json", policy],
      ["decision.json", decision],
      ["run-report.json", runReport],
      ["audit-log.json", auditLog],
      ["session-pack.json", sessionPack],
      ["kill-switch.json", killSwitchSpec],
      ["secrets-policy.json", secretsPolicy],
      ["burner-isolation.json", burnerIsolationSpec],
      ["safety-gates.json", gates],
      ["prereqs.json", prereqs],
      ...(routequote !== null ? [[PAPER_DRY_RUN_ROUTEQUOTE_FILE, routequote] as const] : []),
    ] as const as Array<readonly [string, unknown]>;
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  // 5) Write the sniper-side artifacts (the directory is created here, after every refusal path).
  try {
    mkdirSync(outDir, { recursive: true });
    for (const [name, value] of chainFiles) {
      writeFileSync(join(outDir, name), JSON.stringify(redactValue(value), null, 2) + "\n");
    }
  } catch {
    return {
      text: redactString(
        `Refusing: cannot write dry-run artifacts under ${outDir} (partially written files, if any, remain for inspection).`,
      ),
      exitCode: 1,
    };
  }

  // 6) The Phase 6 simulation chain through the REAL command functions over the written files.
  const inner: CommandContext = { ...ctx, cwd: outDir };
  const force = true; // own-output files only; the pre-existing-file refusal already ran above.
  const steps: Array<readonly [string, CliReport]> = [];
  const run = (label: string, r: CliReport): CliReport | null => {
    steps.push([label, r]);
    return r.exitCode !== 0 ? r : null;
  };
  let failed =
    run("intent-plan", paperSimulationIntentPlanReport(inner, {
      decisionsPath: "decision.json",
      gatesPath: "safety-gates.json",
      prereqsPath: "prereqs.json",
      killSwitchPath: "kill-switch.json",
      secretsPolicyPath: "secrets-policy.json",
      burnerIsolationPath: "burner-isolation.json",
      acknowledgePaperEnterReview: Boolean(opts.acknowledgePaperEnterReview),
      stopSimulationTripped: Boolean(opts.stopSimulationTripped),
      operatorLabel: opts.operatorLabel,
      planLabel: runLabel,
      outPath: "intent-plan.json",
      force,
    }));
  failed =
    failed ??
    run("simulation-result", paperSimulationResultReport(inner, {
      planPath: "intent-plan.json",
      stopSimulationTripped: Boolean(opts.stopSimulationTripped),
      outPath: "simulation-result.json",
      force,
    }));
  failed =
    failed ??
    run("route-resolution", paperSimulationRouteReport(inner, {
      planPath: "intent-plan.json",
      quotesPath: routequote !== null ? PAPER_DRY_RUN_ROUTEQUOTE_FILE : undefined,
      stopSimulationTripped: Boolean(opts.stopSimulationTripped),
      operatorLabel: opts.operatorLabel,
      resolutionLabel: runLabel,
      outPath: "route-resolution.json",
      force,
    }));
  const auditPaths = {
    decisionsPath: "decision.json",
    runReportPath: "run-report.json",
    gatesPath: "safety-gates.json",
    prereqsPath: "prereqs.json",
    killSwitchPath: "kill-switch.json",
    secretsPolicyPath: "secrets-policy.json",
    burnerIsolationPath: "burner-isolation.json",
    intentPlanPath: "intent-plan.json",
    simulationResultPath: "simulation-result.json",
    routePath: "route-resolution.json",
  } as const;
  failed =
    failed ??
    run("chain-audit", paperSimulationAuditReport(inner, {
      ...auditPaths,
      operatorLabel: opts.operatorLabel,
      outPath: "chain-audit.json",
      force,
    }));
  failed =
    failed ??
    run("readiness", paperSimulationReadinessReport(inner, {
      auditPath: "chain-audit.json",
      planPath: "intent-plan.json",
      resultPath: "simulation-result.json",
      evidence: [...PAPER_DRY_RUN_READINESS_EVIDENCE],
      operatorLabel: opts.operatorLabel,
      outPath: "readiness.json",
      force,
    }));
  failed =
    failed ??
    run("handoff-pack", paperSimulationHandoffReport(inner, {
      ...auditPaths,
      auditPath: "chain-audit.json",
      readinessPath: "readiness.json",
      operatorLabel: opts.operatorLabel,
      packLabel: runLabel,
      outPath: "handoff-pack.json",
      force,
    }));
  let bundleJson = "";
  if (!failed) {
    const r = paperSimulationBundleReport(inner, {
      ...auditPaths,
      auditPath: "chain-audit.json",
      readinessPath: "readiness.json",
      handoffPath: "handoff-pack.json",
      operatorLabel: opts.operatorLabel,
      bundleLabel: runLabel,
      outPath: "operator-bundle.json",
      force,
      json: true,
    });
    steps.push(["operator-bundle", r]);
    if (r.exitCode !== 0) failed = r;
    else bundleJson = r.text;
  }
  if (failed) {
    const failedLabel = steps[steps.length - 1]![0];
    return {
      text: redactString(
        `Refusing: dry-run stage "${failedLabel}" failed:\n${failed.text}\n(Artifacts written so far remain under ${outDir} for inspection.)`,
      ),
      exitCode: 1,
    };
  }

  const bundle = JSON.parse(bundleJson) as Phase6OperatorBundleV1;

  // Per-status route explanation (the honest boundary, phrased for the state that produced it).
  const routeExplanation =
    bundle.routeResolutionStatus === "unavailable"
      ? "expected — no route resolver exists inside the simulation boundary; nothing was faked"
      : bundle.routeResolutionStatus === "blocked"
        ? "the plan is blocked, so no resolution was attempted"
        : bundle.routeResolutionStatus === "no_entries"
          ? "watch-only plan — nothing to resolve"
          : bundle.routeResolutionStatus === "unresolved" && bundle.routeResolverAttempted === true
            ? "a READ-ONLY quote observation supplied partial label facts (live-state caveat applies); the remaining facts stay honestly unresolved — never invented, never executable"
            : bundle.routeResolutionStatus === "resolved" && bundle.routeResolverAttempted === true
              ? "label-resolved facts from a READ-ONLY quote observation (live-state caveat applies) — still simulation only, never executable"
              : "honest boundary — no resolver capability exists";

  // 7) RUN_SUMMARY.md — deterministic markdown derived ONLY from the bundle's structured state.
  const summaryLines = [
    "# PAPER Dry-Run Summary",
    "",
    "> **SIMULATION ONLY** — this run never signs, never sends, never authorizes live trading.",
    "> Phase 7 (live/burner trading) is NOT authorized. `phase7LiveTradingReady` is literally `false`.",
    "",
    `- **Run label:** ${runLabel}`,
    `- **Operator:** ${opts.operatorLabel ?? "(none declared)"}`,
    `- **Operator verdict:** \`${bundle.operatorVerdict}\``,
    `- **Route resolution:** ${bundle.routeResolutionStatus ?? "unknown"} (${routeExplanation}; resolver attempted: ${String(bundle.routeResolverAttempted)})`,
    ...(routequote !== null
      ? [
          `- **Route quote provenance:** ${routequote.observedCount}/${routequote.entryCount} candidate(s) carried an observed READ-ONLY quote (\`${PAPER_DRY_RUN_ROUTEQUOTE_FILE}\`; observation only — never executable, never an order)`,
        ]
      : []),
    `- **Readiness verdict (verbatim):** ${bundle.simulationReadyPerReadiness === null ? "unknown" : String(bundle.simulationReadyPerReadiness)}`,
    `- **Chain blocking conditions:** ${bundle.chainBlockingCodes.length}`,
    "",
    `**What happened:** ${bundle.whatHappened}`,
    "",
    "## Blocking conditions",
    "",
    ...(bundle.chainBlockingCodes.length > 0
      ? ["Chain blocking codes (verbatim):", "", ...bundle.chainBlockingCodes.map((c) => `- \`${c}\``), ""]
      : []),
    ...(bundle.whyBlocked.length > 0 ? bundle.whyBlocked.map((l) => `- ${l}`) : ["- none"]),
    "",
    "## What to inspect next",
    "",
    ...bundle.whatToInspectNext.map((l) => `- ${l}`),
    "",
    "## Artifacts",
    "",
    "| role | file | digest | state |",
    "| --- | --- | --- | --- |",
    ...bundle.artifacts.map((a, i) => {
      const f = bundle.files[i]!;
      const state = a.present ? (a.valid ? "valid" : "INVALID") : "missing";
      return `| ${a.role} | ${f.fileName ?? "—"} | ${f.digest ?? "—"} | ${state} |`;
    }),
    "",
    "Diffs are not applicable to a single run — compare two runs with `paper:simulation:diff:plan` / `paper:simulation:diff:result`.",
    "",
    "Inspect this folder in the web inspector: `pnpm web:inspect --dir <this directory>`.",
    "",
  ];
  try {
    writeFileSync(join(outDir, "RUN_SUMMARY.md"), redactString(summaryLines.join("\n")));
  } catch {
    return { text: redactString(`Refusing: cannot write RUN_SUMMARY.md under ${outDir}`), exitCode: 1 };
  }

  const exitCode = opts.failOnBlocked && bundle.operatorVerdict === "blocked" ? 1 : 0;
  if (opts.json) {
    return { text: bundleJson, exitCode };
  }
  const lines = [
    "PAPER DRY-RUN COMPLETE — SIMULATION ONLY (never signs, never sends, never authorizes live trading)",
    `verdict:  ${bundle.operatorVerdict}`,
    `route:    ${bundle.routeResolutionStatus ?? "unknown"} (${routeExplanation})`,
    `readiness verdict (verbatim): ${bundle.simulationReadyPerReadiness === null ? "unknown" : String(bundle.simulationReadyPerReadiness)}`,
    `blocking: ${bundle.chainBlockingCodes.length} chain blocking condition(s)`,
    ...bundle.chainBlockingCodes.map((c) => `  ✗ ${c}`),
    "",
    `artifacts: ${dryRunFiles.length} files under ${outDir}`,
    ...dryRunFiles.map((f) => `  - ${join(outDir, f)}`),
    "",
    `What happened: ${bundle.whatHappened}`,
    ...(bundle.whyBlocked.length > 0 ? ["", "Why blocked:", ...bundle.whyBlocked.map((l) => `✗ ${l}`)] : []),
    "",
    "Next:",
    ...bundle.whatToInspectNext.map((l) => `- ${l}`),
    `- Full summary: ${join(outDir, "RUN_SUMMARY.md")}`,
    `- Inspect in the web UI: pnpm web:inspect --dir "${outDir}" --force`,
  ];
  return { text: redactString(lines.join("\n")), exitCode };
}

// ---------------------------------------------------------------------------
// Sprint 73 — paper:simulation:diff:plan / paper:simulation:diff:result
//   The Phase 6 diff chain: structured-field-only comparisons of two intent
//   plans (`simulation.intent.plan.diff.v2`) or two simulation results
//   (`simulation.result.diff.v1`). Reads only the two named files; writes
//   nothing unless --out; never signs, never sends (literal locks validated).
// ---------------------------------------------------------------------------

export interface PaperSimulationDiffCommandOptions {
  /** Path to the BASE artifact (required). */
  basePath?: string;
  /** Path to the NEXT artifact (required). */
  nextPath?: string;
  json?: boolean;
  outPath?: string;
  force?: boolean;
  /** Exit non-zero when the diff reports ANY structured change. */
  failOnDiff?: boolean;
}

/** Shared base/next plumbing for the two simulation diff commands (read → diff → out → exit). */
function runSimulationDiffCommand<T extends { hasChange: boolean }>(
  ctx: CommandContext,
  opts: PaperSimulationDiffCommandOptions,
  expectedSchema: string,
  diff: (base: unknown, next: unknown) => T,
  format: (d: T) => string,
  writeLabel: string,
): CliReport {
  if (!opts.basePath || !opts.nextPath) {
    return {
      text: `Refusing: --base <path> and --next <path> are both required (two ${expectedSchema} artifacts).`,
      exitCode: 1,
    };
  }
  let baseValue: unknown;
  let nextValue: unknown;
  try {
    baseValue = readJsonValue(ctx, opts.basePath, `base ${writeLabel}`);
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }
  try {
    nextValue = readJsonValue(ctx, opts.nextPath, `next ${writeLabel}`);
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  let result: T;
  try {
    result = diff(baseValue, nextValue);
  } catch (err) {
    return { text: redactString(`Refusing: ${(err as Error).message}`), exitCode: 1 };
  }

  if (opts.outPath) {
    const resolved = resolvePath(ctx, opts.outPath);
    if (!opts.force && existsSync(resolved)) {
      return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
    }
    try {
      writeFileSync(resolved, JSON.stringify(redactValue(result), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write ${writeLabel} diff at ${resolved}`), exitCode: 1 };
    }
  }

  const exitCode = opts.failOnDiff && result.hasChange ? 1 : 0;
  if (opts.json) {
    return { text: JSON.stringify(redactValue(result), null, 2), exitCode };
  }
  return { text: format(result), exitCode };
}

/**
 * `soulmaker paper:simulation:diff:plan` — build a `simulation.intent.plan.diff.v2` from two
 * named `simulation.intent.plan.v2` files (--base / --next, both required). Both artifacts are
 * STRICTLY validated through the production plan validator — an unreadable, invalid, tampered, or
 * wrong-schema artifact refuses outright (a flipped literal lock is invalid). The diff compares
 * STRUCTURED FIELDS ONLY and reports stable `simulation-diff-plan-*` findings; `--fail-on-diff`
 * gates CI on any change. Reads only the two named files; writes nothing unless `--out` (refusing
 * overwrite without `--force`). Never signs, never sends. No network, no wallet.
 */
export function paperSimulationDiffPlanReport(
  ctx: CommandContext = {},
  opts: PaperSimulationDiffCommandOptions = {},
): CliReport {
  return runSimulationDiffCommand<SimulationIntentPlanDiffV2>(
    ctx,
    opts,
    "simulation.intent.plan.v2",
    diffSimulationIntentPlansV2,
    (d) => formatSimulationIntentPlanDiffV2(d, { label: opts.basePath && opts.nextPath ? `${opts.basePath} → ${opts.nextPath}` : undefined }),
    "simulation intent plan",
  );
}

/**
 * `soulmaker paper:simulation:diff:result` — build a `simulation.result.diff.v1` from two named
 * `simulation.result.v1` files (--base / --next, both required). Both artifacts are STRICTLY
 * validated through the production result validator — an unreadable, invalid, tampered, or
 * wrong-schema artifact refuses outright (a flipped literal lock is invalid). The diff compares
 * STRUCTURED FIELDS ONLY and reports stable `simulation-diff-result-*` findings; `--fail-on-diff`
 * gates CI on any change. Reads only the two named files; writes nothing unless `--out` (refusing
 * overwrite without `--force`). Never signs, never sends. No network, no wallet.
 */
export function paperSimulationDiffResultReport(
  ctx: CommandContext = {},
  opts: PaperSimulationDiffCommandOptions = {},
): CliReport {
  return runSimulationDiffCommand<SimulationResultDiffV1>(
    ctx,
    opts,
    "simulation.result.v1",
    diffSimulationResultsV1,
    (d) => formatSimulationResultDiffV1(d, { label: opts.basePath && opts.nextPath ? `${opts.basePath} → ${opts.nextPath}` : undefined }),
    "simulation result",
  );
}

// ---------------------------------------------------------------------------
// Sprint 93 — paper:sniper:rehearse
//   ONE senior-operator workflow command that chains the EXISTING safe steps
//   (candidates -> risk bridge -> quote fetch -> quote prepare -> paper
//   dry-run -> tx build -> tx simulate -> optional devnet rehearse ->
//   readiness) into one output directory with an honest per-stage record.
//   It hides nothing: every stage is the production command, every skip names
//   the exact next command, and the mode set is CLOSED (paper | devnet |
//   mainnet-dry-run). There is no mainnet-live mode — deliberately.
// ---------------------------------------------------------------------------

export const SNIPER_REHEARSAL_REPORT_SCHEMA_VERSION = "sniper.rehearsal.report.v1";

export const SNIPER_REHEARSE_MODES = ["paper", "devnet", "mainnet-dry-run"] as const;
export type SniperRehearseMode = (typeof SNIPER_REHEARSE_MODES)[number];

export type RehearseStageStatus = "executed" | "skipped" | "blocked" | "failed" | "unavailable";

export interface SniperRehearseStage {
  stage:
    | "candidates"
    | "risk"
    | "quote-fetch"
    | "quote-prepare"
    | "dry-run"
    | "tx-build"
    | "tx-simulate"
    | "devnet-rehearse"
    | "readiness";
  status: RehearseStageStatus;
  detail: string;
  /** Artifact path(s) this stage produced or consumed, relative to the out dir where possible. */
  artifacts: string[];
  /** The exact command an operator runs to do/redo this stage standalone (when applicable). */
  nextCommand: string | null;
}

export interface PaperSniperRehearseCommandOptions {
  /** Workflow mode: paper (default) | devnet | mainnet-dry-run. There is NO mainnet-live mode. */
  mode?: string;
  /** Candidate list JSON path (exactly one of --candidates / --replay-file). */
  candidatesPath?: string;
  /** Realtime replay events file — the candidates come from a realtime snapshot replay. */
  replayFile?: string;
  /** Optional preflight input (sniper.preflight.input.v1) with per-candidate inspection/risk. */
  preflightInputPath?: string;
  /**
   * S94: opt OUT of automatic risk evidence. In mainnet-dry-run mode WITHOUT --preflight-input,
   * the rehearsal fetches a deep token:risk report per candidate automatically (the operator no
   * longer has to hand-supply risk evidence). Other modes never auto-fetch (paper is offline).
   */
  skipAutoRisk?: boolean;
  /** Optional already-prepared routequote artifact (skips the fetch/prepare stages). */
  routequotePath?: string;
  /** Quote fetch inputs (mainnet-dry-run mode). */
  amountSol?: string;
  slippageBps?: string;
  endpoint?: string;
  maxQuoteAgeMs?: string;
  /** Tx build inputs (mainnet-dry-run mode; all explicit, same flags as execution:build). */
  wallet?: string;
  riskPath?: string;
  maxSpendSol?: string;
  slippageCapBps?: string;
  riskScoreCap?: string;
  /** Devnet mode: the devnet broadcast rehearsal runs ONLY with this explicit flag. */
  devnetSend?: boolean;
  acknowledgeDevnetExecution?: boolean;
  rpcUrl?: string;
  /** Dry-run governance. */
  adoptSpecs?: boolean;
  operatorLabel?: string;
  allowPaperRead?: boolean;
  outDir?: string;
  force?: boolean;
  json?: boolean;
  failOnBlocked?: boolean;
}

/** S94: auto-risk fetches at most this many candidate risk reports per rehearsal (recorded honestly when truncated). */
export const REHEARSE_AUTO_RISK_MAX_CANDIDATES = 10;

const REHEARSE_NEXT: Readonly<Record<string, string>> = {
  risk: "automatic in mainnet-dry-run mode (deep token:risk per candidate); or manually: pnpm soulmaker token:risk <mint> --deep --json --out <risk.json> per candidate, then paper:sniper:preflight:input:prepare to bridge them",
  "quote-fetch": "pnpm soulmaker paper:routequote:fetch --candidates <candidates.json> --amount-sol <sol> --out <dir> --allow-paper-read",
  "quote-prepare": "pnpm soulmaker paper:routequote:prepare --candidates <candidates.json> --quote <quote.*.json> --out <prepared.json>",
  "tx-build": "pnpm soulmaker execution:build --candidate-mint <mint> --wallet <publicKey> --risk <risk.json> --amount-sol <sol> --slippage-bps <bps> --max-spend-sol <sol> --slippage-cap-bps <bps> --risk-score-cap <n> --request mainnet-dry-run --allow-paper-read --out <envelope.json>",
  "tx-simulate": "pnpm soulmaker paper:simulation:tx --envelope <envelope.json> --allow-paper-read --out <sim.json>",
  "devnet-rehearse": "pnpm soulmaker execution:devnet:rehearse --out runs/<dir> --acknowledge-devnet-execution (requires SOLMAKER_ENABLE_DEVNET_EXECUTION=devnet-only)",
};

/**
 * `soulmaker paper:sniper:rehearse` — the UNIFIED sniper rehearsal workflow (Sprint 93). Chains
 * the existing production commands over ONE output directory and records an honest per-stage
 * report (`sniper.rehearsal.report.v1`). Closed mode set:
 *
 *   - `paper` (DEFAULT): fully offline — candidates (file or realtime replay) -> paper dry-run
 *     -> readiness. Network stages are SKIPPED with their exact next commands.
 *   - `devnet`: paper stages + the devnet broadcast rehearsal, and ONLY behind the explicit
 *     `--devnet-send` flag on top of the devnet double opt-in.
 *   - `mainnet-dry-run`: paper stages + live quote fetch/prepare + unsigned tx build + real
 *     simulateTransaction. It can NEVER send — the only send-capable stage is structurally
 *     limited to devnet mode.
 *
 * There is NO mainnet-live mode and no flag combination that sends on mainnet. A blocked chain
 * exits 0 with the honest report (`--fail-on-blocked` gates).
 */
export async function paperSniperRehearseReport(
  ctx: CommandContext = {},
  opts: PaperSniperRehearseCommandOptions = {},
): Promise<CliReport> {
  const mode = (opts.mode ?? "paper") as SniperRehearseMode;
  if (!(SNIPER_REHEARSE_MODES as readonly string[]).includes(mode)) {
    return {
      text: redactString(
        `Refusing: --mode must be one of ${SNIPER_REHEARSE_MODES.join(" | ")}. There is NO mainnet-live rehearsal mode — opening one requires a separate, explicitly authorized future sprint.`,
      ),
      exitCode: 1,
    };
  }
  if (!opts.outDir) return { text: "Refusing: --out <dir> is required (every stage writes under it).", exitCode: 1 };
  if ((opts.candidatesPath === undefined) === (opts.replayFile === undefined)) {
    return { text: "Refusing: pass exactly one of --candidates <file> or --replay-file <events.json>.", exitCode: 1 };
  }
  if (opts.devnetSend && mode !== "devnet") {
    return { text: `Refusing: --devnet-send is only meaningful with --mode devnet (current mode: ${mode}). No other mode can send anything.`, exitCode: 1 };
  }

  const outDir = resolvePath(ctx, opts.outDir);
  const reportPath = join(outDir, "rehearsal-report.json");
  if (!opts.force && existsSync(reportPath)) {
    return { text: redactString(`Refusing: ${reportPath} already exists (pass --force to overwrite).`), exitCode: 1 };
  }
  try {
    mkdirSync(outDir, { recursive: true });
  } catch {
    return { text: redactString(`Refusing: cannot create output directory at ${outDir}`), exitCode: 1 };
  }

  const stages: SniperRehearseStage[] = [];
  const push = (stage: SniperRehearseStage["stage"], status: RehearseStageStatus, detail: string, artifacts: string[] = [], nextCommand: string | null = null): void => {
    stages.push({ stage, status, detail: redactString(detail).slice(0, 500), artifacts, nextCommand });
  };

  // --- Stage 1: candidates ---------------------------------------------------
  let candidatesPath: string;
  if (opts.replayFile !== undefined) {
    const realtimeDir = join(outDir, "realtime");
    try {
      mkdirSync(realtimeDir, { recursive: true });
    } catch {
      return { text: redactString(`Refusing: cannot create ${realtimeDir}`), exitCode: 1 };
    }
    const snapshot = await paperRealtimeSnapshotReport(ctx, {
      source: "replay",
      replayFile: opts.replayFile,
      outDir: realtimeDir,
      force: opts.force,
    });
    candidatesPath = join(realtimeDir, "candidates.json");
    if (snapshot.exitCode !== 0 || !existsSync(candidatesPath)) {
      push("candidates", "failed", `realtime replay snapshot failed: ${snapshot.text.slice(0, 200)}`);
      return finishRehearsal();
    }
    push("candidates", "executed", `candidates from realtime REPLAY snapshot of ${opts.replayFile}`, ["realtime/snapshot.json", "realtime/candidates.json"]);
  } else {
    candidatesPath = opts.candidatesPath as string;
    push("candidates", "executed", `candidates from operator file ${candidatesPath}`, [candidatesPath]);
  }

  // --- Stage 2: risk evidence ----------------------------------------------------
  // S94: in mainnet-dry-run mode the rehearsal fetches the risk evidence ITSELF by default — a
  // deep token:risk report per candidate (Token-2022 extensions included), bridged through the
  // canonical preflight-input prepare command. Operator-supplied --preflight-input always wins;
  // --skip-auto-risk opts out; other modes never reach the network for risk (paper is offline).
  let preflightInputPath: string | null = opts.preflightInputPath ?? null;
  let riskSource: "operator" | "automatic" | "none" = preflightInputPath !== null ? "operator" : "none";
  let autoRiskBuildTargetPath: string | null = null;
  if (preflightInputPath !== null) {
    push("risk", "executed", `operator-supplied preflight input (inspection/risk per candidate): ${preflightInputPath}`, [preflightInputPath]);
  } else if (opts.riskPath !== undefined) {
    riskSource = "operator";
    push(
      "risk",
      "executed",
      `operator-supplied token:risk report for the build target: ${opts.riskPath} (no per-candidate preflight input — pass nothing to let auto-risk fetch one per candidate)`,
      [opts.riskPath],
    );
  } else if (mode === "mainnet-dry-run" && opts.skipAutoRisk !== true) {
    const mints: string[] = [];
    try {
      const rawList = readJsonValue(ctx, candidatesPath, "sniper candidate list");
      if (isPlainObject(rawList) && Array.isArray(rawList.candidates)) {
        for (const entry of rawList.candidates) {
          if (isPlainObject(entry) && typeof entry.mint === "string" && entry.mint.length > 0 && !mints.includes(entry.mint)) {
            mints.push(entry.mint);
          }
        }
      }
    } catch {
      // No readable mints — recorded honestly below.
    }
    if (mints.length === 0) {
      push("risk", "failed", "auto-risk could not read any candidate mint from the candidate list", [], REHEARSE_NEXT.risk ?? null);
    } else {
      const riskDir = join(outDir, "risk");
      try {
        mkdirSync(riskDir, { recursive: true });
      } catch {
        return { text: redactString(`Refusing: cannot create ${riskDir}`), exitCode: 1 };
      }
      const cappedMints = mints.slice(0, REHEARSE_AUTO_RISK_MAX_CANDIDATES);
      const truncatedNote =
        mints.length > cappedMints.length ? ` (first ${cappedMints.length} of ${mints.length} candidates — run token:risk manually for the rest)` : "";
      const riskPaths: string[] = [];
      const riskArtifacts: string[] = [];
      let firstFailure: string | null = null;
      for (const mint of cappedMints) {
        const riskOut = join(riskDir, `risk.${mint}.json`);
        const text = await tokenRiskReport(mint, ctx, {
          deep: true,
          outPath: riskOut,
          force: opts.force,
          allowPaperRead: opts.allowPaperRead,
        });
        if (existsSync(riskOut)) {
          riskPaths.push(riskOut);
          riskArtifacts.push(`risk/risk.${mint}.json`);
          if (mint === mints[0]) autoRiskBuildTargetPath = riskOut;
        } else if (firstFailure === null) {
          firstFailure = text.slice(0, 200);
        }
      }
      if (riskPaths.length === 0) {
        push(
          "risk",
          "unavailable",
          `auto-risk could not fetch any deep risk report (chain read unavailable or refused): ${firstFailure ?? "no detail"}`,
          [],
          REHEARSE_NEXT.risk ?? null,
        );
      } else {
        const preparedPath = join(outDir, "preflight-input.json");
        const prepare = paperSniperPreflightInputPrepareReport(ctx, {
          candidatesPath,
          riskPaths,
          sourceLabel: "paper:sniper:rehearse auto-risk",
          outPath: preparedPath,
          force: opts.force,
        });
        if (prepare.exitCode === 0 && existsSync(preparedPath)) {
          preflightInputPath = preparedPath;
          riskSource = "automatic";
          push(
            "risk",
            "executed",
            `AUTO risk: deep token:risk (Token-2022 extensions included) fetched for ${riskPaths.length}/${mints.length} candidate(s) and bridged into the preflight input${truncatedNote}${firstFailure !== null ? `; first failure: ${firstFailure}` : ""}`,
            ["preflight-input.json", ...riskArtifacts],
          );
        } else {
          push("risk", "failed", `auto-risk bridge refused: ${prepare.text.slice(0, 200)}`, riskArtifacts, REHEARSE_NEXT.risk ?? null);
        }
      }
    }
  } else if (mode === "mainnet-dry-run") {
    push("risk", "skipped", "--skip-auto-risk: the dry-run preflight stage stays honestly unknown per candidate", [], REHEARSE_NEXT.risk ?? null);
  } else {
    push(
      "risk",
      "skipped",
      `no --preflight-input supplied and mode ${mode} never auto-fetches risk (no network) — the dry-run preflight stage stays honestly unknown per candidate`,
      [],
      REHEARSE_NEXT.risk ?? null,
    );
  }

  // --- Stages 3+4: quote fetch + prepare (mainnet-dry-run only) ----------------
  let routequotePath: string | null = opts.routequotePath ?? null;
  let fetchReportPath: string | null = null;
  if (routequotePath !== null) {
    push("quote-fetch", "skipped", `a prepared routequote was supplied directly: ${routequotePath}`, [routequotePath]);
    push("quote-prepare", "skipped", "prepare not needed — prepared artifact supplied", []);
  } else if (mode !== "mainnet-dry-run") {
    const why =
      mode === "devnet"
        ? "the quote provider serves mainnet only — no devnet quotes exist"
        : "paper mode reaches no network";
    push("quote-fetch", "skipped", `${why}`, [], REHEARSE_NEXT["quote-fetch"] ?? null);
    push("quote-prepare", "skipped", "nothing to prepare without a fetch", [], REHEARSE_NEXT["quote-prepare"] ?? null);
  } else {
    const quotesDir = join(outDir, "quotes");
    try {
      mkdirSync(quotesDir, { recursive: true });
    } catch {
      return { text: redactString(`Refusing: cannot create ${quotesDir}`), exitCode: 1 };
    }
    const fetch = await paperRouteQuoteFetchReport(ctx, {
      candidatesPath,
      amountSol: opts.amountSol ?? "0.01",
      slippageBps: opts.slippageBps,
      endpoint: opts.endpoint,
      allowPaperRead: opts.allowPaperRead,
      outDir: quotesDir,
      force: opts.force,
    });
    fetchReportPath = join(quotesDir, "fetch-report.json");
    if (!existsSync(fetchReportPath)) {
      push("quote-fetch", "unavailable", `quote fetch produced no report: ${fetch.text.slice(0, 200)}`, [], REHEARSE_NEXT["quote-fetch"] ?? null);
      fetchReportPath = null;
    } else {
      const quoteFiles = readdirSync(quotesDir).filter((f) => f.startsWith("quote.") && f.endsWith(".json"));
      push(
        "quote-fetch",
        fetch.exitCode === 0 ? "executed" : "unavailable",
        `live quote fetch wrote ${quoteFiles.length} observation file(s) (exit ${fetch.exitCode})`,
        ["quotes/fetch-report.json", ...quoteFiles.map((f) => `quotes/${f}`)],
      );
      if (quoteFiles.length > 0) {
        const preparedPath = join(outDir, "routequote-prepared.json");
        const prepare = paperRouteQuotePrepareReport(ctx, {
          candidatesPath,
          quotePaths: quoteFiles.map((f) => join(quotesDir, f)),
          sourceLabel: "paper:sniper:rehearse quote fetch",
          outPath: preparedPath,
          force: opts.force,
        });
        if (prepare.exitCode === 0 && existsSync(preparedPath)) {
          routequotePath = preparedPath;
          push("quote-prepare", "executed", "prepared routequote built from the fetched observations", ["routequote-prepared.json"]);
        } else {
          push("quote-prepare", "failed", `prepare refused: ${prepare.text.slice(0, 200)}`, [], REHEARSE_NEXT["quote-prepare"] ?? null);
        }
      } else {
        push("quote-prepare", "unavailable", "no quote observation files to prepare (provider unavailable/blocked) — the route stage stays honestly unavailable", [], null);
      }
    }
  }

  // --- Stage 5: paper dry-run ---------------------------------------------------
  const dryRunDir = join(outDir, "dry-run");
  const dryRun = paperSniperDryRunReport(ctx, {
    candidatesPath,
    preflightInputPath: preflightInputPath ?? undefined,
    routequotePath: routequotePath ?? undefined,
    adoptSpecs: opts.adoptSpecs,
    operatorLabel: opts.operatorLabel,
    runLabel: "paper:sniper:rehearse",
    outDir: dryRunDir,
    force: opts.force,
  });
  let dryRunVerdict: string | null = null;
  if (dryRun.exitCode === 0 && existsSync(join(dryRunDir, "operator-bundle.json"))) {
    try {
      const bundle = JSON.parse(stripJsonBom(readFileSync(join(dryRunDir, "operator-bundle.json"), "utf8"))) as { operatorVerdict?: string };
      dryRunVerdict = typeof bundle.operatorVerdict === "string" ? bundle.operatorVerdict : null;
    } catch {
      dryRunVerdict = null;
    }
    // "reviewable-paper-only" is the BEST possible bundle verdict; anything else (blocked /
    // incomplete / attention / unreadable) is honestly a blocked stage.
    push(
      "dry-run",
      dryRunVerdict === "reviewable-paper-only" ? "executed" : "blocked",
      `full paper dry-run chain completed; operator bundle verdict: ${dryRunVerdict ?? "unreadable"}`,
      ["dry-run/operator-bundle.json", "dry-run/RUN_SUMMARY.md"],
    );
  } else {
    push("dry-run", "failed", `dry-run refused: ${dryRun.text.slice(0, 300)}`);
    return finishRehearsal();
  }

  // --- Stages 6+7: unsigned build + real simulation (mainnet-dry-run only) -------
  // S94: the build's risk evidence comes from --risk when supplied, otherwise from the auto-risk
  // report of the build target (the FIRST candidate) — the operator no longer has to hand-feed it.
  const effectiveRiskPath = opts.riskPath ?? autoRiskBuildTargetPath ?? undefined;
  let envelopePath: string | null = null;
  let simulationPath: string | null = null;
  if (mode !== "mainnet-dry-run") {
    const why = mode === "devnet" ? "the swap builder serves mainnet only; the devnet stage uses the self-transfer probe instead" : "paper mode builds nothing";
    push("tx-build", "skipped", why, [], REHEARSE_NEXT["tx-build"] ?? null);
    push("tx-simulate", "skipped", "nothing to simulate without a build", [], REHEARSE_NEXT["tx-simulate"] ?? null);
  } else if (!opts.wallet || !effectiveRiskPath || !opts.maxSpendSol || !opts.slippageCapBps || !opts.riskScoreCap || !opts.slippageBps) {
    push(
      "tx-build",
      "skipped",
      "tx build needs ALL of --wallet --risk (or auto-risk) --amount-sol --slippage-bps --max-spend-sol --slippage-cap-bps --risk-score-cap (explicit caps; nothing is defaulted)",
      [],
      REHEARSE_NEXT["tx-build"] ?? null,
    );
    push("tx-simulate", "skipped", "nothing to simulate without a build", [], REHEARSE_NEXT["tx-simulate"] ?? null);
  } else {
    // The build target is the FIRST candidate's mint (one candidate per build — explicit).
    let buildMint: string | null = null;
    try {
      const rawList = readJsonValue(ctx, candidatesPath, "sniper candidate list");
      if (isPlainObject(rawList) && Array.isArray(rawList.candidates) && isPlainObject(rawList.candidates[0])) {
        const first = rawList.candidates[0] as Record<string, unknown>;
        buildMint = typeof first.mint === "string" ? first.mint : null;
      }
    } catch {
      buildMint = null;
    }
    if (buildMint === null) {
      push("tx-build", "failed", "could not read the first candidate's mint for the build target");
      push("tx-simulate", "skipped", "nothing to simulate without a build", []);
    } else {
      envelopePath = join(outDir, "envelope.json");
      const build = await executionBuildReport(ctx, {
        candidateMint: buildMint,
        amountSol: opts.amountSol ?? "0.01",
        slippageBps: opts.slippageBps,
        wallet: opts.wallet,
        riskPath: effectiveRiskPath,
        request: "mainnet-dry-run",
        maxSpendSol: opts.maxSpendSol,
        slippageCapBps: opts.slippageCapBps,
        riskScoreCap: opts.riskScoreCap,
        maxQuoteAgeMs: opts.maxQuoteAgeMs,
        endpoint: opts.endpoint,
        allowPaperRead: opts.allowPaperRead,
        outPath: envelopePath,
        force: opts.force,
      });
      if (build.exitCode !== 0 || !existsSync(envelopePath)) {
        push("tx-build", "blocked", `build refused: ${build.text.slice(0, 300)}`, [], REHEARSE_NEXT["tx-build"] ?? null);
        envelopePath = null;
        push("tx-simulate", "skipped", "nothing to simulate without a build", []);
      } else {
        push("tx-build", "executed", `UNSIGNED mainnet-dry-run envelope built for ${buildMint} (nothing signed, nothing sent)`, ["envelope.json"]);
        simulationPath = join(outDir, "tx-simulation.json");
        const sim = await paperSimulationTxReport(ctx, {
          envelopePath,
          rpcUrl: opts.rpcUrl,
          allowPaperRead: opts.allowPaperRead,
          outPath: simulationPath,
          force: opts.force,
        });
        let simOutcome: string | null = null;
        if (existsSync(simulationPath)) {
          try {
            simOutcome = (JSON.parse(stripJsonBom(readFileSync(simulationPath, "utf8"))) as { outcome?: string }).outcome ?? null;
          } catch {
            simOutcome = null;
          }
        }
        if (simOutcome === "simulated-ok") {
          push("tx-simulate", "executed", "the exact envelope simulated ok against recent chain state", ["tx-simulation.json"]);
        } else if (simOutcome === null) {
          push("tx-simulate", "unavailable", `simulation produced no report (exit ${sim.exitCode}): ${sim.text.slice(0, 200)}`, [], REHEARSE_NEXT["tx-simulate"] ?? null);
          simulationPath = null;
        } else {
          push("tx-simulate", "failed", `simulation outcome: ${simOutcome}`, ["tx-simulation.json"]);
        }
      }
    }
  }

  // --- Stage 8: devnet rehearse (devnet mode + explicit flag ONLY) ----------------
  if (mode === "devnet" && opts.devnetSend === true) {
    const devnetDir = join(outDir, "devnet");
    const rehearse = await executionDevnetRehearseReport(ctx, {
      outDir: devnetDir,
      rpcUrl: opts.rpcUrl,
      acknowledgeDevnetExecution: opts.acknowledgeDevnetExecution,
      force: opts.force,
    });
    let outcome: string | null = null;
    let signature: string | null = null;
    const devnetReportPath = join(devnetDir, "devnet-rehearsal-report.json");
    if (existsSync(devnetReportPath)) {
      try {
        const parsed = JSON.parse(stripJsonBom(readFileSync(devnetReportPath, "utf8"))) as { outcome?: string; signature?: string | null };
        outcome = parsed.outcome ?? null;
        signature = parsed.signature ?? null;
      } catch {
        outcome = null;
      }
    }
    if (outcome === "rehearsed" || outcome === "submitted-unconfirmed") {
      push("devnet-rehearse", "executed", `devnet broadcast ${outcome}${signature !== null ? `; signature ${signature}` : ""}`, ["devnet/devnet-rehearsal-report.json"]);
    } else if (outcome !== null) {
      push("devnet-rehearse", "blocked", `devnet rehearsal outcome: ${outcome}`, ["devnet/devnet-rehearsal-report.json"], REHEARSE_NEXT["devnet-rehearse"] ?? null);
    } else {
      push("devnet-rehearse", "failed", `devnet rehearsal refused: ${rehearse.text.slice(0, 300)}`, [], REHEARSE_NEXT["devnet-rehearse"] ?? null);
    }
  } else if (mode === "devnet") {
    push("devnet-rehearse", "skipped", "devnet broadcast requires the EXPLICIT --devnet-send flag (plus the devnet double opt-in)", [], REHEARSE_NEXT["devnet-rehearse"] ?? null);
  } else {
    push("devnet-rehearse", "skipped", `mode ${mode} can never send anything — the only send-capable stage is structurally limited to devnet mode`, []);
  }

  // --- Stage 9: readiness (always; read-only) -------------------------------------
  const readinessPath = join(outDir, "readiness.json");
  const readiness = executionReadinessReport(ctx, {
    quoteReportPath: fetchReportPath ?? undefined,
    maxQuoteAgeMs: fetchReportPath !== null ? opts.maxQuoteAgeMs : undefined,
    riskPath: effectiveRiskPath,
    riskScoreCap: opts.riskScoreCap,
    simulationPath: simulationPath ?? undefined,
    slippageCapBps: opts.slippageCapBps,
    wallet: opts.wallet,
    outPath: readinessPath,
    force: opts.force,
  });
  if (readiness.exitCode === 0 && existsSync(readinessPath)) {
    let satisfied = "?";
    try {
      const parsed = JSON.parse(stripJsonBom(readFileSync(readinessPath, "utf8"))) as { satisfiedCount?: number; totalChecks?: number };
      satisfied = `${parsed.satisfiedCount ?? "?"}/${parsed.totalChecks ?? "?"}`;
    } catch {
      satisfied = "?";
    }
    push("readiness", "executed", `mainnet readiness checklist written (${satisfied} conditions satisfied; verdict blocked by design)`, ["readiness.json"]);
  } else {
    push("readiness", "failed", `readiness refused: ${readiness.text.slice(0, 200)}`);
  }

  return finishRehearsal();

  function finishRehearsal(): CliReport {
    const ranStages = stages.filter((s) => s.status !== "skipped");
    const cleanRun = ranStages.every((s) => s.status === "executed");
    const report = {
      schemaVersion: SNIPER_REHEARSAL_REPORT_SCHEMA_VERSION,
      banner:
        "SNIPER REHEARSAL REPORT — a chained run of the EXISTING production commands with an honest per-stage record. A skipped stage names its exact standalone command; a blocked stage is the system working, not a bug. Nothing here is live-trading readiness, and no mode of this command can send on mainnet.",
      mode,
      outcome: cleanRun ? "rehearsed" : "blocked",
      generatedAt: (ctx.now ?? isoNow)(),
      /** S94: where the per-candidate risk evidence came from — automatic | operator | none. */
      riskSource,
      stages,
      executedCount: stages.filter((s) => s.status === "executed").length,
      skippedCount: stages.filter((s) => s.status === "skipped").length,
      blockedCount: stages.filter((s) => s.status === "blocked" || s.status === "failed" || s.status === "unavailable").length,
      neverSendsOnMainnet: true,
      phase7LiveTradingReady: false,
      caveats: [
        "Every stage above is the existing production command — run them standalone with the printed next commands.",
        "paper is the default mode; devnet broadcast requires --mode devnet --devnet-send plus the devnet double opt-in.",
        "mainnet-dry-run may build and simulate but is structurally incapable of sending.",
      ],
    };
    try {
      writeFileSync(reportPath, JSON.stringify(redactValue(report), null, 2) + "\n");
    } catch {
      return { text: redactString(`Refusing: cannot write the rehearsal report at ${reportPath}`), exitCode: 1 };
    }
    const exitCode = opts.failOnBlocked && report.outcome !== "rehearsed" ? 1 : 0;
    if (opts.json) {
      return { text: JSON.stringify(redactValue(report), null, 2), exitCode };
    }
    const lines: string[] = [];
    lines.push(`SNIPER REHEARSAL (${mode}): ${report.outcome.toUpperCase()}`);
    lines.push("=".repeat(40));
    lines.push(`risk evidence: ${riskSource === "automatic" ? "AUTOMATIC (deep token:risk per candidate)" : riskSource === "operator" ? "operator-supplied" : "none"}`);
    for (const s of stages) {
      lines.push(`  [${s.status === "executed" ? "x" : s.status === "skipped" ? "-" : " "}] ${s.stage} (${s.status}): ${s.detail}`);
      if (s.nextCommand !== null && s.status !== "executed") lines.push(`        next: ${s.nextCommand}`);
    }
    lines.push("");
    lines.push(`artifacts under: ${outDir}`);
    lines.push(`stage record:    ${reportPath}`);
    lines.push("");
    for (const caveat of report.caveats) lines.push(`CAVEAT: ${caveat}`);
    return { text: redactString(lines.join("\n")), exitCode };
  }
}
