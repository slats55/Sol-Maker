/**
 * The PRODUCTION OPERATOR CLI handlers (Sprint 109, Part 3).
 *
 * The supervised operator release surface: config validation, the durable session journal, the
 * recommend-only supervised run, and post-canary reconciliation. NONE of these sign, send, or
 * trade — the strongest possible output remains a RECOMMENDATION plus a Phantom handoff, and the
 * human is the only signer, in their own wallet, in the browser. The backend holds no key.
 *
 * Design notes:
 *   - ONE validated `live.operator.config.v1` drives everything: the run derives its live policy
 *     and escalation policy FROM the config (mode/caps/kill-switch/emergency-stop/TTL/cooldown),
 *     so there is no second place to mis-configure.
 *   - The session journal is append-only; the run APPENDS its events and DERIVES the durable
 *     escalation state (caps, cooldown, pause, manual re-arm) from the journal — pause and re-arm
 *     survive process restarts.
 *   - Alert sinks are DISABLED by default; `--alert-console` / `--alert-webhook-file` opt in.
 *
 * Kept in its own module so the Part 3 operator surface stays reviewable in one place.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, normalize } from "node:path";

import { redactString, redactValue } from "@soulmaker/security";
import {
  LIVE_ESCALATION_HARD_CEILINGS,
  LiveOperatorConfigError,
  OPERATOR_ALERT_SINKS_DEFAULT,
  OPERATOR_RUN_MODES,
  OperatorLoopError,
  OperatorReconcileError,
  OperatorSessionError,
  buildEscalationPolicy,
  buildLivePolicy,
  buildOperatorReconciliation,
  buildSessionEvent,
  deriveEscalationSession,
  discoverCandidates,
  evaluateOperatorConfig,
  exportSessionLog,
  formatConsoleAlert,
  formatWebhookFileLine,
  parseSessionLog,
  prepareSessionAppend,
  runSupervisedOperatorLoop,
  summarizeSessionLog,
  validateOperatorConfig,
} from "@soulmaker/live";
import type {
  CanaryReconciliationFacts,
  CanaryReconciliationStatus,
  LiveOperatorConfig,
  ManualMintInput,
  ObservationInput,
  OperatorAlertSinks,
  OperatorBalanceSnapshot,
  OperatorLoopCandidate,
  OperatorRunMode,
  OperatorSessionEventKind,
  SniperCandidate,
  SniperCandidateRisk,
  StrategyQuoteFacts,
  StrategyRiskAppetite,
} from "@soulmaker/live";

export interface LiveOperatorContext {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  configPath?: string;
  now?: () => string;
}

export interface LiveOperatorReport {
  text: string;
  exitCode: number;
}

function isoNow(ctx: LiveOperatorContext): string {
  return ctx.now ? ctx.now() : new Date().toISOString();
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function resolvePath(ctx: LiveOperatorContext, path: string): string {
  const base = ctx.cwd ?? process.cwd();
  return isAbsolute(path) ? normalize(path) : join(base, path);
}

function readJson(ctx: LiveOperatorContext, path: string, label: string): unknown {
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

function writeOut(ctx: LiveOperatorContext, outPath: string, force: boolean, finalPayload: unknown, label: string): LiveOperatorReport | string {
  const resolved = resolvePath(ctx, outPath);
  if (!force && existsSync(resolved)) return { text: redactString(`Refusing: ${resolved} already exists (pass --force to overwrite).`), exitCode: 1 };
  try {
    writeFileSync(resolved, JSON.stringify(finalPayload, null, 2) + "\n");
  } catch {
    return { text: redactString(`Refusing: cannot write ${label} at ${resolved}`), exitCode: 1 };
  }
  return `\nwrote ${resolved}`;
}

function fail(err: unknown): LiveOperatorReport {
  const msg = err instanceof Error ? err.message : String(err);
  return { text: redactString(`Refusing: ${msg}`), exitCode: 1 };
}

function loadOperatorConfig(ctx: LiveOperatorContext, path: string | undefined): LiveOperatorConfig {
  if (!path) throw new LiveOperatorConfigError("--config <path> is required (a validated live.operator.config.v1 JSON)");
  return validateOperatorConfig(readJson(ctx, path, "operator config"));
}

// ---------------------------------------------------------------------------
// live:operator:validate
// ---------------------------------------------------------------------------

export interface LiveOperatorValidateOptions {
  configPath?: string;
  json?: boolean;
  out?: string;
  force?: boolean;
}

export function liveOperatorValidateReport(ctx: LiveOperatorContext = {}, opts: LiveOperatorValidateOptions = {}): LiveOperatorReport {
  let config: LiveOperatorConfig;
  try {
    config = loadOperatorConfig(ctx, opts.configPath);
  } catch (err) {
    return fail(err);
  }
  const validation = evaluateOperatorConfig(config);
  let wrote = "";
  if (opts.out) {
    const r = writeOut(ctx, opts.out, Boolean(opts.force), redactValue(validation), "config validation");
    if (typeof r !== "string") return r;
    wrote = r;
  }
  if (opts.json) return { text: JSON.stringify(redactValue(validation), null, 2), exitCode: 0 };
  const lines: string[] = [];
  lines.push("LIVE OPERATOR CONFIG VALIDATION (fail-closed; never an authorization)");
  lines.push("=====================================================================");
  lines.push(`verdict:            valid`);
  lines.push(`operator:           ${validation.operatorLabel}`);
  lines.push(`mode:               ${validation.mode}`);
  lines.push(`rpc endpoint:       ${validation.rpcEndpointHost} (host shown; full URL never echoed)`);
  lines.push(`wallet public key:  ${validation.walletPublicKeyPresent ? "present" : "not set"}`);
  lines.push("caps (ceilings in parentheses):");
  lines.push(`  max canary:          ${validation.caps.maxCanarySol} SOL (≤ ${validation.ceilings.maxCanarySol})`);
  lines.push(`  canaries / session:  ${validation.caps.maxCanariesPerSession} (≤ ${validation.ceilings.maxCanariesPerSession})`);
  lines.push(`  canaries / day:      ${validation.caps.maxCanariesPerDay} (≤ ${validation.ceilings.maxCanariesPerDay})`);
  lines.push(`  max daily loss:      ${validation.caps.maxDailyLossSol} SOL (≤ ${validation.ceilings.maxDailyLossSol})`);
  lines.push(`  slippage cap:        ${validation.caps.maxSlippageBps} bps (≤ ${validation.ceilings.maxSlippageBps})`);
  lines.push(`  quote TTL:           ${validation.caps.quoteTtlMs}ms   cooldown: ${validation.caps.cooldownMs}ms   max failures: ${validation.caps.maxFailedAttempts}`);
  lines.push(`armed_canary permitted now: ${validation.armedCanaryPermitted ? "yes (still recommend-only; the human signs in Phantom)" : "NO"}`);
  for (const b of validation.blockingReasons) lines.push(`  blocked: ${b}`);
  for (const w of validation.warnings) lines.push(`  warning: ${w}`);
  lines.push("");
  lines.push("Pinned: Phantom approval required; large trades disabled; backend custodies no keys and never sends.");
  return { text: redactString(lines.join("\n")) + wrote, exitCode: 0 };
}

// ---------------------------------------------------------------------------
// live:operator:session:start / status / export
// ---------------------------------------------------------------------------

export interface LiveOperatorSessionStartOptions {
  sessionLog?: string;
  sessionId?: string;
  operatorLabel?: string;
  mode?: string;
  json?: boolean;
}

export function liveOperatorSessionStartReport(ctx: LiveOperatorContext = {}, opts: LiveOperatorSessionStartOptions = {}): LiveOperatorReport {
  if (!opts.sessionLog) return { text: "Refusing: --session-log <path> is required (the append-only JSONL journal to create).", exitCode: 1 };
  if (!opts.sessionId) return { text: "Refusing: --session-id <id> is required.", exitCode: 1 };
  const resolved = resolvePath(ctx, opts.sessionLog);
  if (existsSync(resolved)) {
    return { text: redactString(`Refusing: ${resolved} already exists — the journal is append-only and a session is started exactly once. Start a NEW session with a new file.`), exitCode: 1 };
  }
  try {
    const at = isoNow(ctx);
    const { event, line } = prepareSessionAppend("", {
      sessionId: opts.sessionId,
      seq: 1,
      at,
      kind: "session_started",
      detail: `operator session started${opts.operatorLabel ? ` by ${opts.operatorLabel}` : ""}`,
      data: { mode: opts.mode ?? "off", operatorLabel: opts.operatorLabel ?? null },
    });
    writeFileSync(resolved, line);
    if (opts.json) return { text: JSON.stringify(redactValue({ started: true, journal: resolved, event }), null, 2), exitCode: 0 };
    return {
      text: redactString(
        [
          "LIVE OPERATOR SESSION STARTED (append-only journal; never a trade)",
          "==================================================================",
          `journal:    ${resolved}`,
          `session id: ${event.sessionId}`,
          `started at: ${event.at}`,
          "",
          "Every subsequent operator action appends one validated event line. The journal is the durable",
          "memory for caps, cooldown, pause and manual re-arm. It never contains a secret.",
        ].join("\n"),
      ),
      exitCode: 0,
    };
  } catch (err) {
    return fail(err);
  }
}

export interface LiveOperatorSessionStatusOptions {
  sessionLog?: string;
  json?: boolean;
}

export function liveOperatorSessionStatusReport(ctx: LiveOperatorContext = {}, opts: LiveOperatorSessionStatusOptions = {}): LiveOperatorReport {
  if (!opts.sessionLog) return { text: "Refusing: --session-log <path> is required.", exitCode: 1 };
  const resolved = resolvePath(ctx, opts.sessionLog);
  let text: string;
  try {
    text = stripBom(readFileSync(resolved, "utf8"));
  } catch {
    return { text: redactString(`Refusing: cannot read session journal at ${resolved} — start one with live:operator:session:start.`), exitCode: 1 };
  }
  const summary = summarizeSessionLog(text);
  if (opts.json) return { text: JSON.stringify(redactValue(summary), null, 2), exitCode: 0 };
  const lines: string[] = [];
  lines.push("LIVE OPERATOR SESSION STATUS (read-only; honest tallies)");
  lines.push("========================================================");
  lines.push(`session:   ${summary.sessionId ?? "unknown"}   status: ${summary.status.toUpperCase()}`);
  lines.push(`events:    ${summary.events} valid, ${summary.invalidLines} invalid line(s)`);
  lines.push(`started:   ${summary.startedAt ?? "n/a"}   last event: ${summary.lastEventAt ?? "n/a"}`);
  lines.push(`canary:    recommended ${summary.canary.recommended}, phantom pending ${summary.canary.phantomPending}, submitted ${summary.canary.submitted}, confirmed ${summary.canary.confirmed}, rejected ${summary.canary.rejected}, timed out ${summary.canary.timedOut}`);
  lines.push(`safety:    kill-switch ${summary.safety.killSwitchEngagements}, emergency-stop ${summary.safety.emergencyStopEngagements}, pauses ${summary.safety.pauses}, manual re-arms ${summary.safety.manualRearms}`);
  lines.push(`paused pending manual re-arm: ${summary.pausedPendingRearm ? "YES — record a manual re-arm before the next armed run" : "no"}`);
  for (const n of summary.notes) lines.push(`note: ${n}`);
  return { text: redactString(lines.join("\n")), exitCode: 0 };
}

export interface LiveOperatorSessionExportOptions {
  sessionLog?: string;
  json?: boolean;
  out?: string;
  force?: boolean;
}

export function liveOperatorSessionExportReport(ctx: LiveOperatorContext = {}, opts: LiveOperatorSessionExportOptions = {}): LiveOperatorReport {
  if (!opts.sessionLog) return { text: "Refusing: --session-log <path> is required.", exitCode: 1 };
  const resolved = resolvePath(ctx, opts.sessionLog);
  let text: string;
  try {
    text = stripBom(readFileSync(resolved, "utf8"));
  } catch {
    return { text: redactString(`Refusing: cannot read session journal at ${resolved}.`), exitCode: 1 };
  }
  const exported = exportSessionLog(text);
  let wrote = "";
  if (opts.out) {
    const r = writeOut(ctx, opts.out, Boolean(opts.force), redactValue(exported), "session export");
    if (typeof r !== "string") return r;
    wrote = r;
  }
  if (opts.json) return { text: JSON.stringify(redactValue(exported), null, 2), exitCode: 0 };
  const s = exported.summary;
  return {
    text:
      redactString(
        [
          "LIVE OPERATOR SESSION EXPORT (validated events + honest invalid-line records)",
          "=============================================================================",
          `session: ${s.sessionId ?? "unknown"}   status: ${s.status}   events: ${exported.events.length}   invalid: ${exported.invalidLines.length}`,
          "Use --out to write the export artifact (the operator dashboard loads it).",
        ].join("\n"),
      ) + wrote,
    exitCode: 0,
  };
}

// ---------------------------------------------------------------------------
// Session append helper shared by run/reconcile (append-only, seq-continued)
// ---------------------------------------------------------------------------

interface JournalHandle {
  resolved: string;
  text: string;
  sessionId: string;
  nextSeq: number;
}

function openJournal(ctx: LiveOperatorContext, sessionLog: string): JournalHandle {
  const resolved = resolvePath(ctx, sessionLog);
  let text: string;
  try {
    text = stripBom(readFileSync(resolved, "utf8"));
  } catch {
    throw new OperatorSessionError(`cannot read session journal at ${resolved} — start one with live:operator:session:start`);
  }
  const valid = parseSessionLog(text).filter((l) => l.event !== null);
  if (valid.length === 0) throw new OperatorSessionError("session journal contains no valid events — start a new session");
  const last = valid[valid.length - 1]!.event!;
  return { resolved, text, sessionId: last.sessionId, nextSeq: last.seq + 1 };
}

function appendToJournal(handle: JournalHandle, at: string, kind: OperatorSessionEventKind, detail: string, data: Record<string, unknown> | null): void {
  const { line } = prepareSessionAppend(handle.text, { sessionId: handle.sessionId, seq: handle.nextSeq, at, kind, detail, data });
  appendFileSync(handle.resolved, line);
  handle.text += line;
  handle.nextSeq += 1;
}

// ---------------------------------------------------------------------------
// live:operator:run — ONE bounded, journaled, recommend-only supervised pass
// ---------------------------------------------------------------------------

/** Parse repeatable `mint=path` pairs into a map (refuses malformed). */
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

export interface LiveOperatorRunOptions {
  configPath?: string;
  mode?: string;
  snapshotPath?: string;
  mints?: string[];
  riskPairs?: string[];
  quotePairs?: string[];
  sessionLog?: string;
  escalationArmed?: boolean;
  recordManualRearm?: string;
  spendSol?: string;
  riskAppetite?: string;
  maxCandidates?: string;
  maxRuntimeMs?: string;
  alertConsole?: boolean;
  alertWebhookFile?: string;
  json?: boolean;
  out?: string;
  force?: boolean;
}

export function liveOperatorRunReport(ctx: LiveOperatorContext = {}, opts: LiveOperatorRunOptions = {}): LiveOperatorReport {
  const startedWallClockMs = Date.now();
  try {
    const config = loadOperatorConfig(ctx, opts.configPath);
    const requestedMode = (opts.mode ?? "observe_only") as OperatorRunMode;
    if (!(OPERATOR_RUN_MODES as readonly string[]).includes(requestedMode)) {
      return { text: `Refusing: --mode must be one of ${OPERATOR_RUN_MODES.join(" | ")}.`, exitCode: 1 };
    }
    const at = isoNow(ctx);
    const nowMs = Date.parse(at);

    // Journal (optional but strongly recommended; REQUIRED for armed_canary).
    let journal: JournalHandle | null = null;
    if (opts.sessionLog) journal = openJournal(ctx, opts.sessionLog);
    if (requestedMode === "armed_canary" && journal === null) {
      return { text: "Refusing: --mode armed_canary requires --session-log — armed runs must be journaled (caps, cooldown, pause and manual re-arm live there).", exitCode: 1 };
    }

    // Manual re-arm is an explicit, journaled human action.
    if (opts.recordManualRearm !== undefined) {
      if (journal === null) return { text: "Refusing: --record-manual-rearm requires --session-log.", exitCode: 1 };
      const label = opts.recordManualRearm.trim();
      if (label.length === 0) return { text: "Refusing: --record-manual-rearm requires a non-empty operator label.", exitCode: 1 };
      appendToJournal(journal, at, "manual_rearm_recorded", `manual re-arm recorded by ${label}`, { operatorLabel: label });
    }

    // Candidates: real snapshot observations and/or manual mints, enriched by mint-paired files.
    const observations: ObservationInput[] = [];
    if (opts.snapshotPath) {
      const snap = asObject(readJson(ctx, opts.snapshotPath, "realtime snapshot"), "realtime snapshot");
      const obs = Array.isArray(snap.observations) ? snap.observations : [];
      for (const o of obs) if (o && typeof o === "object") observations.push(o as ObservationInput);
    }
    const manualMints: ManualMintInput[] = (opts.mints ?? []).map((m) => ({ mint: m }));
    const discovery = discoverCandidates({ observations, manualMints }, { discoveredAt: at });
    const riskPairs = parsePairs(opts.riskPairs, "--risk");
    const quotePairs = parsePairs(opts.quotePairs, "--quote");
    const plannedSpendSol = opts.spendSol !== undefined ? Number(opts.spendSol) : null;
    const candidates: OperatorLoopCandidate[] = discovery.candidates.map((c) => {
      let candidate: SniperCandidate = c;
      const riskPath = riskPairs.get(c.mint);
      if (riskPath) candidate = { ...candidate, risk: extractCandidateRisk(readJson(ctx, riskPath, `risk report for ${c.mint}`)) };
      let quote: StrategyQuoteFacts | null = null;
      const quotePath = quotePairs.get(c.mint);
      if (quotePath) quote = extractQuoteFacts(readJson(ctx, quotePath, `quote facts for ${c.mint}`));
      const quoteFresh = quote === null ? null : quote.ageMs !== null ? quote.ageMs <= config.quoteTtlMs : null;
      return { candidate, quote, quoteFresh, plannedSpendSol };
    });

    // The live policy + escalation policy are DERIVED from the one validated config.
    const armedRun = requestedMode === "armed_canary";
    const policy = buildLivePolicy({
      mode: armedRun ? "live_canary" : "paper",
      liveEnabled: armedRun,
      walletProvider: armedRun ? "phantom" : null,
      caps: { maxTradeSol: config.maxCanarySol, maxPositionSol: config.maxCanarySol, maxDailyLossSol: config.maxDailyLossSol, maxSlippageBps: config.maxSlippageBps },
      freshness: { quoteTtlMs: config.quoteTtlMs, routeTtlMs: config.quoteTtlMs },
      killSwitch: config.killSwitchEngaged,
      emergencyStopFilePresent: config.emergencyStopEngaged,
      cooldownMs: config.cooldownMs,
    });
    const escalationPolicy = buildEscalationPolicy({
      maxCanarySol: config.maxCanarySol,
      maxCanariesPerSession: config.maxCanariesPerSession,
      maxCanariesPerDay: config.maxCanariesPerDay,
      cooldownMs: config.cooldownMs,
      maxFailedAttempts: config.maxFailedAttempts,
      maxDailyLossSol: config.maxDailyLossSol,
    });
    const escalationSession = journal !== null ? deriveEscalationSession(journal.text, { armedThisInvocation: Boolean(opts.escalationArmed) }) : { armed: Boolean(opts.escalationArmed), lastCanaryAtMs: null };

    const report = runSupervisedOperatorLoop({
      config,
      requestedMode,
      candidates,
      policy,
      escalationPolicy,
      escalationSession,
      limits: {
        maxCandidates: opts.maxCandidates !== undefined ? Number(opts.maxCandidates) : null,
        maxRuntimeMs: opts.maxRuntimeMs !== undefined ? Number(opts.maxRuntimeMs) : null,
      },
      riskAppetite: (opts.riskAppetite ?? "standard") as StrategyRiskAppetite,
      sessionId: journal?.sessionId ?? null,
      startedAt: at,
      nowMs: Number.isFinite(nowMs) ? nowMs : 0,
      elapsedMs: () => Date.now() - startedWallClockMs,
    });

    // Journal the run's events (append-only, seq-continued).
    if (journal !== null) {
      for (const e of report.sessionEvents) {
        appendToJournal(journal, at, e.kind as OperatorSessionEventKind, e.detail, e.data);
      }
    }

    // Alert sinks — DISABLED by default; each is an explicit opt-in.
    const sinks: OperatorAlertSinks = { ...OPERATOR_ALERT_SINKS_DEFAULT };
    if (opts.alertConsole) sinks.console = true;
    if (opts.alertWebhookFile) sinks.webhookFilePath = resolvePath(ctx, opts.alertWebhookFile);
    const alertLines: string[] = [];
    if (sinks.console) for (const a of report.alerts) alertLines.push(formatConsoleAlert(a));
    if (sinks.webhookFilePath !== null) {
      for (const a of report.alerts) appendFileSync(sinks.webhookFilePath, formatWebhookFileLine(a));
    }

    let wrote = "";
    if (opts.out) {
      const r = writeOut(ctx, opts.out, Boolean(opts.force), redactValue(report), "operator run report");
      if (typeof r !== "string") return r;
      wrote = r;
    }
    if (opts.json) return { text: JSON.stringify(redactValue(report), null, 2), exitCode: 0 };

    const lines: string[] = [];
    lines.push("LIVE OPERATOR SUPERVISED RUN (recommend-only; the backend NEVER signs or sends)");
    lines.push("===============================================================================");
    lines.push(`operator: ${report.operatorLabel}   config mode: ${report.configMode}   run mode: ${report.effectiveMode}`);
    lines.push(
      `candidates: ${report.totals.candidatesSupplied} supplied, ${report.totals.processed} processed${report.totals.skippedOverBudget > 0 ? `, ${report.totals.skippedOverBudget} skipped (budget)` : ""} — watch ${report.totals.watch}, shadow ${report.totals.paperShadow}, blocked ${report.totals.blocked}, canary-recommended ${report.totals.canaryRecommended}`,
    );
    for (const r of report.results) {
      const tag = r.action === "prepare_canary_request" ? "CANARY*" : r.action.toUpperCase();
      lines.push(`  [${tag}] ${r.mint}${r.strategy ? ` — ${r.strategy.decision} score ${r.strategy.score}` : ""}${r.blockingReasons.length ? ` (${r.blockingReasons.slice(0, 4).join(", ")})` : ""}`);
    }
    if (report.paused) {
      lines.push("");
      lines.push(`PAUSED: ${report.pauseReasons.join(", ")} — a human must record a manual re-arm (--record-manual-rearm <label>) before the next armed run.`);
    }
    if (report.recommendation !== null) {
      lines.push("");
      lines.push(`* CANARY RECOMMENDED for ${report.recommendation.mint} — awaiting HUMAN Phantom approval. Next steps:`);
      for (const s of report.recommendation.nextSteps) lines.push(`    - ${s}`);
    }
    if (alertLines.length > 0) {
      lines.push("");
      for (const a of alertLines) lines.push(a);
    }
    if (journal !== null) lines.push(`\njournaled ${report.sessionEvents.length} event(s) to ${journal.resolved}`);
    return { text: redactString(lines.join("\n")) + wrote, exitCode: 0 };
  } catch (err) {
    if (err instanceof OperatorLoopError || err instanceof OperatorSessionError || err instanceof LiveOperatorConfigError) return fail(err);
    return fail(err);
  }
}

// ---------------------------------------------------------------------------
// live:operator:reconcile — post-canary accounting from captured facts
// ---------------------------------------------------------------------------

export interface LiveOperatorReconcileOptions {
  candidateMint?: string;
  factsPath?: string;
  prePath?: string;
  postPath?: string;
  tokenDecimals?: string;
  quotedOutRaw?: string;
  tokenPriceUsd?: string;
  priceEvidence?: string;
  sessionLog?: string;
  json?: boolean;
  out?: string;
  force?: boolean;
}

function extractSnapshot(value: unknown, label: string): OperatorBalanceSnapshot {
  const obj = asObject(value, label);
  const strOrNull = (k: string): string | null => (typeof obj[k] === "string" ? (obj[k] as string) : null);
  return { solLamports: strOrNull("solLamports"), tokenRaw: strOrNull("tokenRaw"), capturedAt: strOrNull("capturedAt") };
}

export function liveOperatorReconcileReport(ctx: LiveOperatorContext = {}, opts: LiveOperatorReconcileOptions = {}): LiveOperatorReport {
  if (!opts.candidateMint) return { text: "Refusing: --candidate-mint is required.", exitCode: 1 };
  if (!opts.factsPath) return { text: "Refusing: --facts <path> is required (captured confirmation facts JSON).", exitCode: 1 };
  try {
    const raw = asObject(readJson(ctx, opts.factsPath, "reconciliation facts"), "reconciliation facts");
    const strOrNull = (k: string): string | null => (typeof raw[k] === "string" ? (raw[k] as string) : null);
    const numOrNull = (k: string): number | null => (typeof raw[k] === "number" ? (raw[k] as number) : null);
    const facts: CanaryReconciliationFacts = {
      signature: strOrNull("signature"),
      submittedAt: strOrNull("submittedAt"),
      lastStatusAt: strOrNull("lastStatusAt"),
      status: (typeof raw.status === "string" ? raw.status : "unknown") as CanaryReconciliationStatus,
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
    const record = buildOperatorReconciliation({
      candidateMint: opts.candidateMint,
      canary: facts,
      pre: opts.prePath ? extractSnapshot(readJson(ctx, opts.prePath, "pre-trade snapshot"), "pre-trade snapshot") : { solLamports: null, tokenRaw: null, capturedAt: null },
      post: opts.postPath ? extractSnapshot(readJson(ctx, opts.postPath, "post-trade snapshot"), "post-trade snapshot") : { solLamports: null, tokenRaw: null, capturedAt: null },
      tokenDecimals: opts.tokenDecimals !== undefined ? Number(opts.tokenDecimals) : null,
      quotedOutRaw: opts.quotedOutRaw ?? null,
      tokenPriceUsd: opts.tokenPriceUsd !== undefined ? Number(opts.tokenPriceUsd) : null,
      priceEvidence: opts.priceEvidence ?? null,
    });

    // Journal the reconciliation (append-only) when a session log is supplied.
    if (opts.sessionLog) {
      const journal = openJournal(ctx, opts.sessionLog);
      appendToJournal(journal, isoNow(ctx), "reconciliation_recorded", `reconciled ${record.candidateMint}: ${record.canary.verdict} (confidence ${record.confidence})`, {
        mint: record.candidateMint,
        verdict: record.canary.verdict,
        status: record.canary.status,
        slot: record.canary.slot,
        confidence: record.confidence,
        pnlStatus: record.pnlStatus,
        netLamports: record.canary.netLamports,
      });
    }

    let wrote = "";
    if (opts.out) {
      const r = writeOut(ctx, opts.out, Boolean(opts.force), redactValue(record), "operator reconciliation");
      if (typeof r !== "string") return r;
      wrote = r;
    }
    if (opts.json) return { text: JSON.stringify(redactValue(record), null, 2), exitCode: 0 };
    const lines: string[] = [];
    lines.push("LIVE OPERATOR RECONCILIATION (honest accounting; nothing is estimated silently)");
    lines.push("===============================================================================");
    lines.push(`candidate:       ${record.candidateMint}`);
    lines.push(`status/verdict:  ${record.canary.status} / ${record.canary.verdict}   confidence: ${record.confidence.toUpperCase()}`);
    lines.push(`slot:            ${record.canary.slot ?? "n/a"}`);
    lines.push(`token received:  ${record.grossTokenReceivedRaw ?? "unknown"} raw`);
    lines.push(`SOL spent:       ${record.solSpentLamports ?? "unknown"} lamports (fees: ${record.feesLamports ?? "unknown"})`);
    lines.push(`slippage:        ${record.slippageRealizedBps === null ? "unknown" : `${record.slippageRealizedBps} bps vs quote`}`);
    lines.push(`pnl:             ${record.pnlStatus} — ${record.pnlNote}`);
    for (const n of record.notes) lines.push(`note: ${n}`);
    return { text: redactString(lines.join("\n")) + wrote, exitCode: 0 };
  } catch (err) {
    if (err instanceof OperatorReconcileError || err instanceof OperatorSessionError) return fail(err);
    return fail(err);
  }
}

/** Exported for the CLI reference: the escalation ceilings the operator surface honours. */
export const OPERATOR_SURFACE_CEILINGS = LIVE_ESCALATION_HARD_CEILINGS;

/** Exported for tests: build one journal-safe session event (thin passthrough). */
export const buildOperatorSessionEvent = buildSessionEvent;
