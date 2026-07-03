/**
 * The LIVE SNIPER LOOP CLI handlers (Sprint 108, Part 2).
 *
 * Read-only / artifact-composing commands for the Part 2 armed sniper loop. NONE of these sign,
 * send, or trade. They DISCOVER candidates from real `@soulmaker/realtime` snapshots (or manual
 * mints), SCORE them, run a PAPER-SHADOW session, and RUN the loop pipeline to produce a
 * RECOMMENDATION — at most "prepare a canary request". Turning that recommendation into a real
 * UNSIGNED transaction is the separate, already-reviewed `live:canary:prepare` step, and the human
 * still signs it in Phantom. The backend holds no key.
 *
 * Kept in its own module so the live surface stays reviewable in one place.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";

import { loadConfig, ConfigError } from "@soulmaker/core";
import type { Config, LoadConfigOptions } from "@soulmaker/core";
import { redactString, redactValue } from "@soulmaker/security";
import {
  CanaryReconciliationError,
  DiscoveryError,
  LiveEscalationError,
  LivePolicyError,
  LIVE_ESCALATION_HARD_CEILINGS,
  SNIPER_LOOP_MODES,
  SNIPER_LOOP_STAGES,
  buildCanaryReconciliation,
  buildEscalationPolicy,
  buildLivePolicy,
  discoverCandidates,
  evaluateCandidatePipeline,
  scoreStrategyV2,
  shadowDecide,
  buildPaperShadowSession,
  validateEscalationPolicy,
  validateLivePolicy,
} from "@soulmaker/live";
import type {
  CanaryReconciliationFacts,
  CanaryReconciliationStatus,
  LiveEscalationPolicy,
  LiveModePolicy,
  ManualMintInput,
  ObservationInput,
  SniperCandidate,
  SniperCandidateRisk,
  SniperLoopMode,
  StrategyQuoteFacts,
  StrategyRiskAppetite,
} from "@soulmaker/live";

export interface LiveSniperContext {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  configPath?: string;
  now?: () => string;
}

export interface LiveSniperReport {
  text: string;
  exitCode: number;
}

function toLoadOptions(ctx: LiveSniperContext): LoadConfigOptions {
  return { cwd: ctx.cwd, env: ctx.env, configPath: ctx.configPath };
}

function isoNow(ctx: LiveSniperContext): string {
  return ctx.now ? ctx.now() : new Date().toISOString();
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function resolvePath(ctx: LiveSniperContext, path: string): string {
  const base = ctx.cwd ?? process.cwd();
  return isAbsolute(path) ? normalize(path) : join(base, path);
}

function readJson(ctx: LiveSniperContext, path: string, label: string): unknown {
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

function writeOut(ctx: LiveSniperContext, outPath: string, force: boolean, finalPayload: unknown, label: string): LiveSniperReport | string {
  const resolved = resolvePath(ctx, outPath);
  if (!force && existsSync(resolved)) return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
  try {
    writeFileSync(resolved, JSON.stringify(finalPayload, null, 2) + "\n");
  } catch {
    return { text: redactString(`Refusing: cannot write ${label} at ${resolved}`), exitCode: 1 };
  }
  return `\nwrote ${resolved}`;
}

/** Parse repeatable `mint=path` pairs into a map (later wins; refuses malformed). */
function parsePairs(pairs: string[] | undefined, label: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of pairs ?? []) {
    const eq = p.indexOf("=");
    if (eq <= 0) throw new Error(`${label} must be in mint=path form, got "${redactString(p)}"`);
    out.set(p.slice(0, eq).trim(), p.slice(eq + 1).trim());
  }
  return out;
}

/** Map a real token:risk --json report onto the discovery risk shape (null = unknown, never invented). */
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

/** Parse a simple quote-facts JSON (operator-derived from a real quote) into StrategyQuoteFacts. */
function extractQuoteFacts(value: unknown): StrategyQuoteFacts {
  const obj = asObject(value, "quote facts");
  const numOrNull = (k: string): number | null => (typeof obj[k] === "number" ? (obj[k] as number) : null);
  return {
    priceImpactPct: numOrNull("priceImpactPct"),
    ageMs: numOrNull("ageMs"),
    slippageBps: numOrNull("slippageBps"),
    routeConfidence: numOrNull("routeConfidence"),
    provider: typeof obj.provider === "string" ? obj.provider : null,
  };
}

// ---------------------------------------------------------------------------
// Candidate gathering (shared by discover / shadow / run)
// ---------------------------------------------------------------------------

function gatherCandidates(ctx: LiveSniperContext, opts: { snapshotPath?: string; mints?: string[] }, discoveredAt: string): ReturnType<typeof discoverCandidates> {
  const observations: ObservationInput[] = [];
  if (opts.snapshotPath) {
    const snap = asObject(readJson(ctx, opts.snapshotPath, "realtime snapshot"), "realtime snapshot");
    const obs = Array.isArray(snap.observations) ? snap.observations : [];
    for (const o of obs) {
      if (o && typeof o === "object") observations.push(o as ObservationInput);
    }
  }
  const manualMints: ManualMintInput[] = (opts.mints ?? []).map((m) => ({ mint: m }));
  return discoverCandidates({ observations, manualMints }, { discoveredAt });
}

// ---------------------------------------------------------------------------
// live:sniper:policy
// ---------------------------------------------------------------------------

export interface LiveSniperPolicyOptions {
  escalationPath?: string;
  maxCanarySol?: string;
  maxCanariesPerSession?: string;
  cooldownMs?: string;
  json?: boolean;
  out?: string;
  force?: boolean;
}

function escalationFromFlags(ctx: LiveSniperContext, opts: LiveSniperPolicyOptions): LiveEscalationPolicy {
  if (opts.escalationPath) return validateEscalationPolicy(readJson(ctx, opts.escalationPath, "escalation policy"));
  const num = (v: string | undefined): number | undefined => (v === undefined ? undefined : Number(v));
  return buildEscalationPolicy({
    maxCanarySol: num(opts.maxCanarySol),
    maxCanariesPerSession: num(opts.maxCanariesPerSession),
    cooldownMs: num(opts.cooldownMs),
  });
}

export function liveSniperPolicyReport(ctx: LiveSniperContext = {}, opts: LiveSniperPolicyOptions = {}): LiveSniperReport {
  let policy: LiveEscalationPolicy;
  try {
    policy = escalationFromFlags(ctx, opts);
  } catch (err) {
    const msg = err instanceof LiveEscalationError || err instanceof Error ? err.message : String(err);
    return { text: redactString(`Refusing: ${msg}`), exitCode: 1 };
  }
  const payload = { schemaVersion: "live.sniper.policy.report.v1", modes: SNIPER_LOOP_MODES, defaultMode: "off", stages: SNIPER_LOOP_STAGES, escalation: policy, loopNeverSends: true };
  let wrote = "";
  if (opts.out) {
    const r = writeOut(ctx, opts.out, Boolean(opts.force), redactValue(payload), "sniper policy");
    if (typeof r !== "string") return r;
    wrote = r;
  }
  if (opts.json) return { text: JSON.stringify(redactValue(payload), null, 2) + (wrote ? "" : ""), exitCode: 0 };
  const lines: string[] = [];
  lines.push("LIVE SNIPER LOOP POLICY (read-only; the loop NEVER sends)");
  lines.push("========================================================");
  lines.push(`modes:          ${SNIPER_LOOP_MODES.join(" | ")}`);
  lines.push("default mode:   off");
  lines.push("escalation caps (hard ceilings in parentheses):");
  lines.push(`  max canary:           ${policy.maxCanarySol} SOL (≤ ${LIVE_ESCALATION_HARD_CEILINGS.maxCanarySol})`);
  lines.push(`  canaries / session:   ${policy.maxCanariesPerSession} (≤ ${LIVE_ESCALATION_HARD_CEILINGS.maxCanariesPerSession})`);
  lines.push(`  canaries / day:       ${policy.maxCanariesPerDay} (≤ ${LIVE_ESCALATION_HARD_CEILINGS.maxCanariesPerDay})`);
  lines.push(`  cooldown:             ${policy.cooldownMs}ms`);
  lines.push(`  max failed attempts:  ${policy.maxFailedAttempts}`);
  lines.push(`  max daily loss:       ${policy.maxDailyLossSol} SOL`);
  lines.push(`  manual re-arm:        ${policy.manualRearmRequired ? "REQUIRED" : "no"}`);
  lines.push(`  large trades:         ${policy.largeTradesEnabled ? "ENABLED" : "disabled (Part 2 never enables larger trades)"}`);
  lines.push("");
  lines.push("Only armed_canary can recommend preparing a canary; the human signs every transaction in Phantom.");
  return { text: redactString(lines.join("\n")) + wrote, exitCode: 0 };
}

// ---------------------------------------------------------------------------
// live:sniper:discover
// ---------------------------------------------------------------------------

export interface LiveSniperDiscoverOptions {
  snapshotPath?: string;
  mints?: string[];
  json?: boolean;
  out?: string;
  force?: boolean;
}

export function liveSniperDiscoverReport(ctx: LiveSniperContext = {}, opts: LiveSniperDiscoverOptions = {}): LiveSniperReport {
  if (!opts.snapshotPath && (!opts.mints || opts.mints.length === 0)) {
    return { text: "Refusing: supply --snapshot <realtime.candidates.snapshot.v1> and/or one or more --mint <mint>.", exitCode: 1 };
  }
  let result: ReturnType<typeof discoverCandidates>;
  try {
    result = gatherCandidates(ctx, opts, isoNow(ctx));
  } catch (err) {
    const msg = err instanceof DiscoveryError || err instanceof Error ? err.message : String(err);
    return { text: redactString(`Refusing: ${msg}`), exitCode: 1 };
  }
  let wrote = "";
  if (opts.out) {
    const r = writeOut(ctx, opts.out, Boolean(opts.force), redactValue(result), "sniper discovery");
    if (typeof r !== "string") return r;
    wrote = r;
  }
  if (opts.json) return { text: JSON.stringify(redactValue(result), null, 2), exitCode: 0 };
  const lines: string[] = [];
  lines.push("LIVE SNIPER DISCOVERY (read-only observations; never a trade)");
  lines.push("============================================================");
  lines.push(`discovered: ${result.candidates.length}   rejected: ${result.rejections.length}`);
  for (const c of result.candidates) {
    lines.push(`  + ${c.mint}${c.symbol ? ` (${c.symbol})` : ""} — ${c.sourceKind} via ${c.sourceProvider}, confidence ${c.confidence}`);
  }
  for (const r of result.rejections) lines.push(`  - ${r.mint ?? "?"}: ${r.reason}`);
  return { text: redactString(lines.join("\n")) + wrote, exitCode: 0 };
}

// ---------------------------------------------------------------------------
// Attach real risk + quote to candidates (shared by shadow / run)
// ---------------------------------------------------------------------------

interface EnrichedCandidate {
  candidate: SniperCandidate;
  quote: StrategyQuoteFacts | null;
}

function enrichCandidates(ctx: LiveSniperContext, candidates: readonly SniperCandidate[], riskPairs: Map<string, string>, quotePairs: Map<string, string>): EnrichedCandidate[] {
  return candidates.map((c) => {
    let candidate = c;
    const riskPath = riskPairs.get(c.mint);
    if (riskPath) candidate = { ...candidate, risk: extractCandidateRisk(readJson(ctx, riskPath, `risk report for ${c.mint}`)) };
    let quote: StrategyQuoteFacts | null = null;
    const quotePath = quotePairs.get(c.mint);
    if (quotePath) quote = extractQuoteFacts(readJson(ctx, quotePath, `quote facts for ${c.mint}`));
    return { candidate, quote };
  });
}

// ---------------------------------------------------------------------------
// live:sniper:shadow
// ---------------------------------------------------------------------------

export interface LiveSniperShadowOptions {
  snapshotPath?: string;
  mints?: string[];
  riskPairs?: string[];
  quotePairs?: string[];
  riskAppetite?: string;
  sessionId?: string;
  json?: boolean;
  out?: string;
  force?: boolean;
}

export function liveSniperShadowReport(ctx: LiveSniperContext = {}, opts: LiveSniperShadowOptions = {}): LiveSniperReport {
  try {
    const at = isoNow(ctx);
    const discovery = gatherCandidates(ctx, opts, at);
    const riskPairs = parsePairs(opts.riskPairs, "--risk");
    const quotePairs = parsePairs(opts.quotePairs, "--quote");
    const enriched = enrichCandidates(ctx, discovery.candidates, riskPairs, quotePairs);
    const appetite = (opts.riskAppetite ?? "standard") as StrategyRiskAppetite;
    const decisions = enriched.map(({ candidate, quote }) => {
      const strategy = scoreStrategyV2({ candidate, quote, riskAppetite: appetite, timestamp: at });
      return shadowDecide({ candidate, strategy, quote, decidedAt: at });
    });
    const session = buildPaperShadowSession(decisions, { sessionId: opts.sessionId ?? "shadow-session", startedAt: at, endedAt: at });
    let wrote = "";
    if (opts.out) {
      const r = writeOut(ctx, opts.out, Boolean(opts.force), redactValue(session), "paper shadow session");
      if (typeof r !== "string") return r;
      wrote = r;
    }
    if (opts.json) return { text: JSON.stringify(redactValue(session), null, 2), exitCode: 0 };
    const lines: string[] = [];
    lines.push("LIVE SNIPER PAPER-SHADOW SESSION (simulation; no order, no send)");
    lines.push("===============================================================");
    lines.push(`decisions: ${session.totals.decisions}   would_enter: ${session.totals.wouldEnter}   would_skip: ${session.totals.wouldSkip}`);
    for (const d of session.decisions) {
      lines.push(`  ${d.decision === "would_enter" ? "ENTER" : "skip "} ${d.mint} — score ${d.score}, confidence ${d.confidence}${d.blockingReasons.length ? ` [${d.blockingReasons.join(", ")}]` : ""}`);
    }
    lines.push("");
    for (const cv of session.caveats) lines.push(`note: ${cv}`);
    return { text: redactString(lines.join("\n")) + wrote, exitCode: 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { text: redactString(`Refusing: ${msg}`), exitCode: 1 };
  }
}

// ---------------------------------------------------------------------------
// live:sniper:run — run the loop pipeline for a mode (recommendation only)
// ---------------------------------------------------------------------------

export interface LiveSniperRunOptions {
  mode?: string;
  snapshotPath?: string;
  mints?: string[];
  riskPairs?: string[];
  quotePairs?: string[];
  policyPath?: string;
  escalationPath?: string;
  armed?: boolean;
  spendSol?: string;
  riskAppetite?: string;
  json?: boolean;
  out?: string;
  force?: boolean;
  failOnNoCandidate?: boolean;
}

export function liveSniperRunReport(ctx: LiveSniperContext = {}, opts: LiveSniperRunOptions = {}): LiveSniperReport {
  let config: Config;
  try {
    config = loadConfig(toLoadOptions(ctx));
  } catch (err) {
    const msg = err instanceof ConfigError ? err.message : String(err);
    return { text: redactString(`Refusing: config is invalid.\n\n${msg}`), exitCode: 1 };
  }
  const mode = (opts.mode ?? "observe_only") as SniperLoopMode;
  if (!(SNIPER_LOOP_MODES as readonly string[]).includes(mode)) {
    return { text: `Refusing: --mode must be one of ${SNIPER_LOOP_MODES.join(" | ")}.`, exitCode: 1 };
  }
  try {
    const at = isoNow(ctx);
    const nowMs = Date.parse(at);
    const policy: LiveModePolicy = opts.policyPath
      ? validateLivePolicy(readJson(ctx, opts.policyPath, "live policy"))
      : buildLivePolicy({
          mode: mode === "armed_canary" ? "live_canary" : "paper",
          liveEnabled: mode === "armed_canary",
          walletProvider: mode === "armed_canary" ? "phantom" : null,
          killSwitch: config.killSwitch,
        });
    const escalationPolicy: LiveEscalationPolicy = opts.escalationPath ? validateEscalationPolicy(readJson(ctx, opts.escalationPath, "escalation policy")) : buildEscalationPolicy();

    const discovery = gatherCandidates(ctx, opts, at);
    const riskPairs = parsePairs(opts.riskPairs, "--risk");
    const quotePairs = parsePairs(opts.quotePairs, "--quote");
    const enriched = enrichCandidates(ctx, discovery.candidates, riskPairs, quotePairs);
    const appetite = (opts.riskAppetite ?? "standard") as StrategyRiskAppetite;
    const plannedSpendSol = opts.spendSol !== undefined ? Number(opts.spendSol) : null;

    const results = enriched.map(({ candidate, quote }) =>
      evaluateCandidatePipeline(
        { candidate, quote, quoteFresh: quote === null ? null : quote.ageMs !== null ? quote.ageMs <= policy.freshness.quoteTtlMs : null, plannedSpendSol },
        {
          mode,
          policy,
          escalationPolicy,
          escalationSession: { armed: Boolean(opts.armed), lastCanaryAtMs: null },
          riskAppetite: appetite,
          nowMs: Number.isFinite(nowMs) ? nowMs : 0,
          timestamp: at,
        },
      ),
    );

    const recommended = results.filter((r) => r.action === "prepare_canary_request");
    const payload = {
      schemaVersion: "live.sniper.run.report.v1",
      mode,
      ranAt: at,
      totals: {
        candidates: results.length,
        rejected: discovery.rejections.length,
        canaryRecommended: recommended.length,
        paperShadow: results.filter((r) => r.action === "paper_shadow").length,
        watch: results.filter((r) => r.action === "watch").length,
      },
      results,
      rejections: discovery.rejections,
      loopNeverSends: true,
      notProfitabilityClaim: true,
    };

    let wrote = "";
    if (opts.out) {
      const r = writeOut(ctx, opts.out, Boolean(opts.force), redactValue(payload), "sniper run report");
      if (typeof r !== "string") return r;
      wrote = r;
    }

    const noCandidate = results.length === 0;
    const exitCode = noCandidate && opts.failOnNoCandidate ? 2 : 0;
    if (opts.json) return { text: JSON.stringify(redactValue(payload), null, 2), exitCode };

    const lines: string[] = [];
    lines.push("LIVE SNIPER RUN (recommendation only; the loop NEVER signs or sends)");
    lines.push("===================================================================");
    lines.push(`mode: ${mode}   candidates: ${results.length}   canary-recommended: ${recommended.length}`);
    for (const r of results) {
      const tag = r.action === "prepare_canary_request" ? "CANARY*" : r.action.toUpperCase();
      lines.push(`  [${tag}] ${r.mint} — ${r.strategy ? `${r.strategy.decision} score ${r.strategy.score}` : "not scored"}${r.blockingReasons.length ? ` (${r.blockingReasons.slice(0, 4).join(", ")})` : ""}`);
    }
    lines.push("");
    if (recommended.length > 0) {
      lines.push("* CANARY recommendation means: all gates green. NEXT, a human runs `live:canary:prepare` to build the");
      lines.push("  UNSIGNED request, loads it into the web Live Console, and confirms in Phantom. This CLI never sends.");
    } else {
      lines.push("No candidate is canary-eligible right now (or the loop is not armed). Nothing to prepare.");
    }
    return { text: redactString(lines.join("\n")) + wrote, exitCode };
  } catch (err) {
    const msg = err instanceof LivePolicyError || err instanceof LiveEscalationError || err instanceof Error ? err.message : String(err);
    return { text: redactString(`Refusing: ${msg}`), exitCode: 1 };
  }
}

// ---------------------------------------------------------------------------
// live:sniper:reconcile — build a reconciliation record from captured facts
// ---------------------------------------------------------------------------

export interface LiveSniperReconcileOptions {
  candidateMint?: string;
  factsPath?: string;
  json?: boolean;
  out?: string;
  force?: boolean;
}

export function liveSniperReconcileReport(ctx: LiveSniperContext = {}, opts: LiveSniperReconcileOptions = {}): LiveSniperReport {
  if (!opts.candidateMint) return { text: "Refusing: --candidate-mint is required.", exitCode: 1 };
  if (!opts.factsPath) return { text: "Refusing: --facts <path> is required (captured confirmation facts JSON).", exitCode: 1 };
  try {
    const raw = asObject(readJson(ctx, opts.factsPath, "reconciliation facts"), "reconciliation facts");
    const status = (typeof raw.status === "string" ? raw.status : "unknown") as CanaryReconciliationStatus;
    const strOrNull = (k: string): string | null => (typeof raw[k] === "string" ? (raw[k] as string) : null);
    const numOrNull = (k: string): number | null => (typeof raw[k] === "number" ? (raw[k] as number) : null);
    const facts: CanaryReconciliationFacts = {
      signature: strOrNull("signature"),
      submittedAt: strOrNull("submittedAt"),
      lastStatusAt: strOrNull("lastStatusAt"),
      status,
      slot: numOrNull("slot"),
      err: strOrNull("err"),
      inputAmountRaw: strOrNull("inputAmountRaw"),
      outputAmountRaw: strOrNull("outputAmountRaw"),
      solSpentLamports: strOrNull("solSpentLamports"),
      feesLamports: strOrNull("feesLamports"),
      priorityFeeLamports: strOrNull("priorityFeeLamports"),
      balanceBeforeLamports: strOrNull("balanceBeforeLamports"),
      balanceAfterLamports: strOrNull("balanceAfterLamports"),
    };
    const record = buildCanaryReconciliation({ candidateMint: opts.candidateMint, facts });
    let wrote = "";
    if (opts.out) {
      const r = writeOut(ctx, opts.out, Boolean(opts.force), redactValue(record), "canary reconciliation");
      if (typeof r !== "string") return r;
      wrote = r;
    }
    if (opts.json) return { text: JSON.stringify(redactValue(record), null, 2), exitCode: 0 };
    const lines: string[] = [];
    lines.push("LIVE CANARY RECONCILIATION (honest accounting; PnL unknown unless computable)");
    lines.push("==========================================================================");
    lines.push(`candidate:   ${record.candidateMint}`);
    lines.push(`status:      ${record.status}`);
    lines.push(`verdict:     ${record.verdict}`);
    lines.push(`signature:   ${record.signature ?? "none recorded"}`);
    lines.push(`slot:        ${record.slot ?? "n/a"}`);
    lines.push(`net change:  ${record.pnlKnown ? `${record.netLamports} lamports` : "unknown"}`);
    lines.push(`pnl:         ${record.pnlNote}`);
    for (const n of record.notes) lines.push(`note: ${n}`);
    return { text: redactString(lines.join("\n")) + wrote, exitCode: 0 };
  } catch (err) {
    const msg = err instanceof CanaryReconciliationError || err instanceof Error ? err.message : String(err);
    return { text: redactString(`Refusing: ${msg}`), exitCode: 1 };
  }
}

// ---------------------------------------------------------------------------
// live:sniper:session — summarize a sniper session JSONL log (read-only)
// ---------------------------------------------------------------------------

export function liveSniperSessionReport(ctx: LiveSniperContext = {}, opts: { sessionLog?: string; json?: boolean } = {}): LiveSniperReport {
  const tally: Record<string, number> = {};
  let total = 0;
  let parsed = 0;
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
          const action = typeof obj.action === "string" ? obj.action : typeof obj.event === "string" ? obj.event : "unknown";
          tally[action] = (tally[action] ?? 0) + 1;
          parsed += 1;
        } catch {
          tally.unparseable = (tally.unparseable ?? 0) + 1;
        }
      }
    }
  }
  const payload = { schemaVersion: "live.sniper.session.report.v1", entries: total, parsed, byAction: tally };
  if (opts.json) return { text: JSON.stringify(redactValue(payload), null, 2), exitCode: 0 };
  const lines: string[] = [];
  lines.push("LIVE SNIPER SESSION");
  lines.push("===================");
  if (!opts.sessionLog) {
    lines.push("No --session-log supplied — nothing to summarize.");
    return { text: lines.join("\n"), exitCode: 0 };
  }
  lines.push(`entries: ${total} (parsed ${parsed})`);
  for (const [action, count] of Object.entries(tally).sort()) lines.push(`  ${action}: ${count}`);
  return { text: lines.join("\n"), exitCode: 0 };
}
