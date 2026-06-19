/**
 * The LIVE (Phantom-bridge) CLI handlers (Sprint 107, Part 1).
 *
 * Read-only / artifact-composing commands for the @soulmaker/live package. NONE of these sign or
 * send anything: `live:canary:prepare` ASSEMBLES a `live.canary.request.v1` from real artifacts the
 * operator generated with the existing real commands (token:risk, execution:build, …); the human
 * signs and submits it in Phantom, in the browser, never here. Kept in its own module so the
 * 16k-line commands.ts does not grow, and so the live surface is reviewable in one place.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";

import { loadConfig, ConfigError } from "@soulmaker/core";
import type { Config, LoadConfigOptions } from "@soulmaker/core";
import { redactValue, redactString } from "@soulmaker/security";
import {
  ALL_CHAIN_ADAPTERS,
  LIVE_HARD_CEILINGS,
  LiveCanaryRequestError,
  LivePolicyError,
  buildLiveCanaryRequest,
  buildLivePolicy,
  evaluateLivePolicy,
  redactCanaryRequestForOutput,
  validateLivePolicy,
} from "@soulmaker/live";
import type {
  BuildLivePolicyInput,
  LiveCanaryPreflightFacts,
  LiveCanaryQuoteFacts,
  LiveCanaryRiskFacts,
  LiveMode,
  LiveModePolicy,
} from "@soulmaker/live";
import { validateUnsignedTxEnvelope } from "@soulmaker/txpreview";
import type { UnsignedTxEnvelope } from "@soulmaker/txpreview";

export interface LiveCommandContext {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  configPath?: string;
  /** Injectable clock for deterministic timestamps in tests. */
  now?: () => string;
}

export interface LiveCliReport {
  text: string;
  exitCode: number;
}

const LAMPORTS_PER_SOL = 1_000_000_000;

function toLoadOptions(ctx: LiveCommandContext): LoadConfigOptions {
  return { cwd: ctx.cwd, env: ctx.env, configPath: ctx.configPath };
}

function isoNow(ctx: LiveCommandContext): string {
  return ctx.now ? ctx.now() : new Date().toISOString();
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function resolvePath(ctx: LiveCommandContext, path: string): string {
  const base = ctx.cwd ?? process.cwd();
  return isAbsolute(path) ? normalize(path) : join(base, path);
}

function readJson(ctx: LiveCommandContext, path: string, label: string): unknown {
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
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

/** Write an ALREADY-redaction-final payload to disk (the caller redacts as appropriate). */
function writeOut(ctx: LiveCommandContext, outPath: string, force: boolean, finalPayload: unknown, label: string): LiveCliReport | string {
  const resolved = resolvePath(ctx, outPath);
  if (!force && existsSync(resolved)) {
    return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
  }
  try {
    writeFileSync(resolved, JSON.stringify(finalPayload, null, 2) + "\n");
  } catch {
    return { text: redactString(`Refusing: cannot write ${label} at ${resolved}`), exitCode: 1 };
  }
  return `\nwrote ${resolved}`;
}

// ---------------------------------------------------------------------------
// Policy construction from flags + config
// ---------------------------------------------------------------------------

export interface LivePolicyFlags {
  policyPath?: string;
  mode?: string;
  liveEnabled?: boolean;
  maxTradeSol?: string;
  maxSlippageBps?: string;
  riskScoreCap?: string;
  cooldownMs?: string;
  killSwitch?: boolean;
  tokenDenylistPath?: string;
  tokenAllowlistPath?: string;
}

function parseNumberFlag(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

/** Build (or load) a live policy from flags + config. `killSwitch` is OR-ed with config.killSwitch. */
function policyFromFlags(ctx: LiveCommandContext, flags: LivePolicyFlags, config: Config): LiveModePolicy {
  if (flags.policyPath) {
    return validateLivePolicy(readJson(ctx, flags.policyPath, "policy"));
  }
  const mode = (flags.mode ?? "paper") as LiveMode;
  const caps: BuildLivePolicyInput["caps"] = {};
  const maxTradeSol = parseNumberFlag(flags.maxTradeSol, "--max-trade-sol");
  if (maxTradeSol !== undefined) caps.maxTradeSol = maxTradeSol;
  const maxSlippageBps = parseNumberFlag(flags.maxSlippageBps, "--max-slippage-bps");
  if (maxSlippageBps !== undefined) caps.maxSlippageBps = maxSlippageBps;
  const riskScoreCap = parseNumberFlag(flags.riskScoreCap, "--risk-score-cap");
  if (riskScoreCap !== undefined) caps.riskScoreCap = riskScoreCap;
  const cooldownMs = parseNumberFlag(flags.cooldownMs, "--cooldown-ms");

  let tokenDenylist: string[] | undefined;
  if (flags.tokenDenylistPath) {
    const arr = readJson(ctx, flags.tokenDenylistPath, "token denylist");
    if (!Array.isArray(arr)) throw new Error("token denylist file must be a JSON array of mints");
    tokenDenylist = arr.map(String);
  }
  let tokenAllowlist: string[] | undefined;
  if (flags.tokenAllowlistPath) {
    const arr = readJson(ctx, flags.tokenAllowlistPath, "token allowlist");
    if (!Array.isArray(arr)) throw new Error("token allowlist file must be a JSON array of mints");
    tokenAllowlist = arr.map(String);
  }

  const isLiveMode = mode === "live_prepare" || mode === "live_canary";
  return buildLivePolicy({
    mode,
    liveEnabled: flags.liveEnabled ?? false,
    walletProvider: isLiveMode ? "phantom" : null,
    caps,
    cooldownMs,
    killSwitch: Boolean(flags.killSwitch) || config.killSwitch,
    tokenDenylist,
    tokenAllowlist,
  });
}

// ---------------------------------------------------------------------------
// live:policy:inspect
// ---------------------------------------------------------------------------

export interface LivePolicyInspectOptions extends LivePolicyFlags {
  json?: boolean;
  out?: string;
  force?: boolean;
}

export function livePolicyInspectReport(ctx: LiveCommandContext = {}, opts: LivePolicyInspectOptions = {}): LiveCliReport {
  let config: Config;
  try {
    config = loadConfig(toLoadOptions(ctx));
  } catch (err) {
    const msg = err instanceof ConfigError ? err.message : String(err);
    return { text: redactString(`Refusing: config is invalid.\n\n${msg}`), exitCode: 1 };
  }
  let policy: LiveModePolicy;
  try {
    policy = policyFromFlags(ctx, opts, config);
  } catch (err) {
    const msg = err instanceof LivePolicyError || err instanceof Error ? err.message : String(err);
    return { text: redactString(`Refusing: ${msg}`), exitCode: 1 };
  }
  const evaluation = evaluateLivePolicy(policy);
  const payload = { policy, evaluation };

  let wrote = "";
  if (opts.out) {
    const r = writeOut(ctx, opts.out, Boolean(opts.force), redactValue(payload), "live policy");
    if (typeof r !== "string") return r;
    wrote = r;
  }
  if (opts.json) return { text: JSON.stringify(redactValue(payload), null, 2), exitCode: 0 };

  const lines: string[] = [];
  lines.push("LIVE MODE POLICY (read-only; this command authorizes nothing)");
  lines.push("============================================================");
  lines.push(`mode:               ${policy.mode}`);
  lines.push(`live enabled:       ${policy.liveEnabled ? "YES" : "no (default)"}`);
  lines.push(`wallet provider:    ${policy.walletProvider ?? "none"}`);
  lines.push(`kill switch:        ${policy.killSwitch ? "ENGAGED" : "off"}`);
  lines.push(`chains allowlisted: ${policy.chainAllowlist.join(", ")}`);
  lines.push("caps (hard ceilings in parentheses):");
  lines.push(`  max trade:        ${policy.caps.maxTradeSol} SOL (≤ ${LIVE_HARD_CEILINGS.maxTradeSol})`);
  lines.push(`  max slippage:     ${policy.caps.maxSlippageBps} bps (≤ ${LIVE_HARD_CEILINGS.maxSlippageBps})`);
  lines.push(`  max daily trades: ${policy.caps.maxDailyTrades} (≤ ${LIVE_HARD_CEILINGS.maxDailyTrades})`);
  lines.push(`  max daily loss:   ${policy.caps.maxDailyLossSol} SOL (≤ ${LIVE_HARD_CEILINGS.maxDailyLossSol})`);
  lines.push(`  risk score cap:   ${policy.caps.riskScoreCap} (≤ ${LIVE_HARD_CEILINGS.riskScoreCap})`);
  lines.push(`  cooldown:         ${policy.cooldownMs}ms`);
  lines.push(`  quote TTL:        ${policy.freshness.quoteTtlMs}ms`);
  lines.push("");
  lines.push(`prepare allowed:    ${evaluation.prepareAllowed ? "YES" : "no"}`);
  lines.push(`canary arm allowed: ${evaluation.canaryArmAllowed ? "YES" : "no"}`);
  if (evaluation.blockingReasons.length > 0) {
    lines.push("blocked because:");
    for (const code of evaluation.blockingReasons) lines.push(`  - ${code}`);
  }
  for (const w of evaluation.warnings) lines.push(`warning: ${w}`);
  lines.push("");
  lines.push("The backend holds no key and never signs or sends. A human signs every transaction in Phantom.");
  return { text: redactString(lines.join("\n")) + wrote, exitCode: 0 };
}

// ---------------------------------------------------------------------------
// live:chains — chain readiness (the ChainAdapter boundary)
// ---------------------------------------------------------------------------

export function liveChainsReport(ctx: LiveCommandContext = {}, opts: { json?: boolean } = {}): LiveCliReport {
  void ctx;
  const payload = { schemaVersion: "live.chains.report.v1", chains: ALL_CHAIN_ADAPTERS };
  if (opts.json) return { text: JSON.stringify(redactValue(payload), null, 2), exitCode: 0 };
  const lines: string[] = [];
  lines.push("LIVE CHAIN READINESS");
  lines.push("====================");
  for (const c of ALL_CHAIN_ADAPTERS) {
    lines.push(`${c.displayName} [${c.chainId}]`);
    lines.push(`  status:  ${c.liveStatus}`);
    lines.push(`  wallet:  ${c.walletProvider ?? "none"}`);
    lines.push(`  ${c.note}`);
  }
  lines.push("");
  lines.push("Only solana-mainnet has a live implementation in Part 1. Other chains are planned, not tradeable.");
  return { text: lines.join("\n"), exitCode: 0 };
}

// ---------------------------------------------------------------------------
// live:kill-switch — show / explain the kill switch + emergency stop
// ---------------------------------------------------------------------------

export function liveKillSwitchReport(ctx: LiveCommandContext = {}, opts: { json?: boolean } = {}): LiveCliReport {
  let config: Config;
  try {
    config = loadConfig(toLoadOptions(ctx));
  } catch (err) {
    const msg = err instanceof ConfigError ? err.message : String(err);
    return { text: redactString(`Refusing: config is invalid.\n\n${msg}`), exitCode: 1 };
  }
  const env = ctx.env ?? process.env;
  const emergencyStop = env.SOULMAKER_EMERGENCY_STOP === "1" || env.SOULMAKER_EMERGENCY_STOP === "true";
  const engaged = config.killSwitch || emergencyStop;
  const payload = {
    schemaVersion: "live.kill_switch.status.v1",
    killSwitch: config.killSwitch,
    emergencyStop,
    liveBlocked: engaged,
  };
  if (opts.json) return { text: JSON.stringify(redactValue(payload), null, 2), exitCode: 0 };
  const lines: string[] = [];
  lines.push("LIVE KILL SWITCH");
  lines.push("================");
  lines.push(`config kill switch:  ${config.killSwitch ? "ENGAGED — all live actions blocked" : "off"}`);
  lines.push(`emergency stop env:  ${emergencyStop ? "PRESENT — all live actions blocked" : "absent"}`);
  lines.push("");
  lines.push(engaged ? "LIVE IS BLOCKED right now." : "Live is not blocked by the kill switch (other gates still apply).");
  lines.push("");
  lines.push("To engage: set killSwitch:true in soulmaker.config.json, or set SOULMAKER_EMERGENCY_STOP=1 in the environment.");
  return { text: lines.join("\n"), exitCode: 0 };
}

// ---------------------------------------------------------------------------
// live:canary:prepare — assemble a live.canary.request.v1 from real artifacts
// ---------------------------------------------------------------------------

export interface LiveCanaryPrepareOptions extends LivePolicyFlags {
  candidateMint?: string;
  riskPath?: string;
  envelopePath?: string;
  quotePath?: string;
  simulationPath?: string;
  spendSol?: string;
  spendLamports?: string;
  auditLog?: string;
  symbol?: string;
  json?: boolean;
  out?: string;
  force?: boolean;
  failOnBlocked?: boolean;
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

function coerceQuoteFacts(value: unknown): LiveCanaryQuoteFacts {
  const obj = asObject(value, "quote facts");
  const str = (k: string): string => {
    const v = obj[k];
    if (typeof v !== "string") throw new Error(`quote facts.${k} must be a string`);
    return v;
  };
  const numOrNull = (k: string): number | null => {
    const v = obj[k];
    return typeof v === "number" ? v : null;
  };
  const labels = Array.isArray(obj.routeLabels) ? obj.routeLabels.filter((x): x is string => typeof x === "string") : [];
  const slippage = obj.slippageBps;
  if (typeof slippage !== "number") throw new Error("quote facts.slippageBps must be a number");
  return {
    provider: str("provider"),
    inputMint: str("inputMint"),
    outputMint: str("outputMint"),
    inAmountRaw: str("inAmountRaw"),
    outAmountRaw: str("outAmountRaw"),
    slippageBps: slippage,
    priceImpactPct: numOrNull("priceImpactPct"),
    quotedAt: typeof obj.quotedAt === "string" ? obj.quotedAt : null,
    ageMs: numOrNull("ageMs"),
    routeLabels: labels,
  };
}

/** Derive minimal quote facts from a built envelope when no explicit --quote was supplied. */
function quoteFactsFromEnvelope(envelope: UnsignedTxEnvelope): LiveCanaryQuoteFacts {
  return {
    provider: envelope.builderId,
    inputMint: "unknown",
    outputMint: envelope.candidateMint ?? "unknown",
    inAmountRaw: envelope.constraints.maxSpendLamports ?? "0",
    outAmountRaw: "0",
    slippageBps: envelope.constraints.slippageBps ?? 0,
    priceImpactPct: null,
    quotedAt: envelope.quotedAt,
    ageMs: null,
    routeLabels: envelope.routeCaveats.slice(0, 4),
  };
}

function extractPreflight(value: unknown): LiveCanaryPreflightFacts {
  const obj = asObject(value, "simulation report");
  return {
    simulationOutcome: typeof obj.outcome === "string" ? obj.outcome : null,
    simulationClassification: typeof obj.classification === "string" ? obj.classification : null,
  };
}

export function liveCanaryPrepareReport(ctx: LiveCommandContext = {}, opts: LiveCanaryPrepareOptions = {}): LiveCliReport {
  let config: Config;
  try {
    config = loadConfig(toLoadOptions(ctx));
  } catch (err) {
    const msg = err instanceof ConfigError ? err.message : String(err);
    return { text: redactString(`Refusing: config is invalid.\n\n${msg}`), exitCode: 1 };
  }
  if (!opts.candidateMint) {
    return { text: "Refusing: --candidate-mint is required.", exitCode: 1 };
  }
  if (!opts.riskPath) {
    return { text: "Refusing: --risk is required (a token:risk --json report; preparing a live request blind is refused).", exitCode: 1 };
  }

  try {
    const policy = policyFromFlags(ctx, opts, config);
    const risk = extractRiskFacts(readJson(ctx, opts.riskPath, "risk report"));

    let envelope: UnsignedTxEnvelope | null = null;
    if (opts.envelopePath) {
      envelope = validateUnsignedTxEnvelope(readJson(ctx, opts.envelopePath, "envelope"));
      if (envelope.candidateMint !== null && envelope.candidateMint !== opts.candidateMint) {
        return { text: redactString(`Refusing: envelope candidateMint (${envelope.candidateMint}) != --candidate-mint (${opts.candidateMint}).`), exitCode: 1 };
      }
    }

    let quote: LiveCanaryQuoteFacts | null = null;
    if (opts.quotePath) {
      quote = coerceQuoteFacts(readJson(ctx, opts.quotePath, "quote facts"));
    } else if (envelope) {
      quote = quoteFactsFromEnvelope(envelope);
    }

    const preflight: LiveCanaryPreflightFacts = opts.simulationPath
      ? extractPreflight(readJson(ctx, opts.simulationPath, "simulation report"))
      : { simulationOutcome: null, simulationClassification: null };

    let spendLamports: string | null = null;
    if (opts.spendLamports !== undefined) {
      if (!/^[0-9]{1,20}$/.test(opts.spendLamports)) return { text: "Refusing: --spend-lamports must be an integer.", exitCode: 1 };
      spendLamports = opts.spendLamports;
    } else if (opts.spendSol !== undefined) {
      const sol = Number(opts.spendSol);
      if (!Number.isFinite(sol) || sol <= 0) return { text: "Refusing: --spend-sol must be a positive number.", exitCode: 1 };
      spendLamports = String(Math.floor(sol * LAMPORTS_PER_SOL));
    } else if (envelope?.constraints.maxSpendLamports) {
      spendLamports = envelope.constraints.maxSpendLamports;
    }

    const nowIso = isoNow(ctx);
    const nowMs = Date.parse(nowIso);
    const request = buildLiveCanaryRequest({
      policy,
      createdAt: nowIso,
      nowMs: Number.isFinite(nowMs) ? nowMs : Date.now(),
      candidate: { mint: opts.candidateMint, symbol: opts.symbol ?? null },
      quote,
      risk,
      preflight,
      spendLamports,
      envelope,
      auditLogPathProvided: Boolean(opts.auditLog),
    });

    const finalRequest = redactCanaryRequestForOutput(request);
    let wrote = "";
    if (opts.out) {
      const r = writeOut(ctx, opts.out, Boolean(opts.force), finalRequest, "live canary request");
      if (typeof r !== "string") return r;
      wrote = r;
    }

    const blocked = request.state === "blocked_by_policy" || request.state === "blocked_by_risk";
    const exitCode = blocked && opts.failOnBlocked ? 2 : 0;

    if (opts.json) return { text: JSON.stringify(finalRequest, null, 2), exitCode };

    const lines: string[] = [];
    lines.push("LIVE CANARY REQUEST (prepared; UNSIGNED; backend holds no key)");
    lines.push("=============================================================");
    lines.push(request.banner);
    lines.push("");
    lines.push(`candidate:   ${request.candidate.mint}${request.candidate.symbol ? ` (${request.candidate.symbol})` : ""}`);
    lines.push(`mode:        ${request.mode}`);
    lines.push(`state:       ${request.state.toUpperCase()}`);
    lines.push(`spend:       ${spendLamports ?? "n/a"} lamports`);
    lines.push(`envelope:    ${envelope ? `present (${envelope.builderId}, ${envelope.network})` : "none"}`);
    lines.push(`risk:        score ${risk.score} / ${risk.decision} / ${risk.criticalFlagCount} critical flag(s)`);
    lines.push(`simulation:  ${preflight.simulationOutcome ?? "not run"}`);
    if (request.blockingReasons.length > 0) {
      lines.push("blocking reasons:");
      for (const reason of request.blockingReasons) lines.push(`  - ${reason}`);
    }
    for (const w of request.warnings) lines.push(`warning: ${w}`);
    lines.push("");
    lines.push(
      request.state === "preflight_ready"
        ? "READY: load this artifact into the web Live Console and confirm in Phantom to send a real transaction."
        : "NOT ready to arm. Resolve the blocking reasons (or run a green simulation) first.",
    );
    return { text: redactString(lines.join("\n")) + wrote, exitCode };
  } catch (err) {
    const msg = err instanceof LiveCanaryRequestError || err instanceof Error ? err.message : String(err);
    return { text: redactString(`Refusing: ${msg}`), exitCode: 1 };
  }
}

// ---------------------------------------------------------------------------
// live:session:report — summarize a live canary session log (read-only)
// ---------------------------------------------------------------------------

export function liveSessionReport(ctx: LiveCommandContext = {}, opts: { sessionLog?: string; json?: boolean } = {}): LiveCliReport {
  const tally: Record<string, number> = {};
  let total = 0;
  let parsedLines = 0;
  if (opts.sessionLog) {
    const resolved = resolvePath(ctx, opts.sessionLog);
    let text: string | null = null;
    try {
      text = stripBom(readFileSync(resolved, "utf8"));
    } catch {
      text = null;
    }
    if (text !== null) {
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        total += 1;
        try {
          const obj = JSON.parse(trimmed) as Record<string, unknown>;
          const state = typeof obj.state === "string" ? obj.state : "unknown";
          tally[state] = (tally[state] ?? 0) + 1;
          parsedLines += 1;
        } catch {
          tally.unparseable = (tally.unparseable ?? 0) + 1;
        }
      }
    }
  }
  const payload = { schemaVersion: "live.session.report.v1", entries: total, parsed: parsedLines, byState: tally };
  if (opts.json) return { text: JSON.stringify(redactValue(payload), null, 2), exitCode: 0 };
  const lines: string[] = [];
  lines.push("LIVE CANARY SESSION");
  lines.push("===================");
  if (!opts.sessionLog) {
    lines.push("No --session-log supplied — nothing to summarize.");
    return { text: lines.join("\n"), exitCode: 0 };
  }
  lines.push(`entries: ${total} (parsed ${parsedLines})`);
  if (total === 0) {
    lines.push("No canary attempts recorded yet.");
  } else {
    for (const [state, count] of Object.entries(tally).sort()) lines.push(`  ${state}: ${count}`);
  }
  return { text: lines.join("\n"), exitCode: 0 };
}
