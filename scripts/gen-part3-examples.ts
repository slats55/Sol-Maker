/**
 * Generate committed EXAMPLE artifacts for the Part 3 production operator release (Sprint 109).
 *
 * Deterministic (fixed timestamps, fixture candidates) so re-running produces byte-identical
 * output. No network, wallet, or chain activity. These artifacts show the SHAPE of the operator
 * workflow end-to-end — config → validation → session journal → observe/shadow/armed runs →
 * reconciliation → alerts → the READY-FOR-HUMAN-CANARY report — and every one is produced by the
 * REAL production builders and re-validated before it is written.
 *
 * The readiness report is the honest Phase-8 artifact: its workflow checks are DERIVED from the
 * artifacts this script just built and validated (not asserted), and `realCanaryExecuted` is
 * false because NO real canary has been executed — no human, no funded burner wallet. Not faked.
 *
 * Run: `pnpm tsx scripts/gen-part3-examples.ts`.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildEscalationPolicy,
  buildHumanCanaryReadiness,
  buildLivePolicy,
  buildOperatorAlert,
  buildOperatorConfig,
  buildOperatorReconciliation,
  evaluateOperatorConfig,
  exportSessionLog,
  normalizeObservation,
  prepareSessionAppend,
  runSupervisedOperatorLoop,
  summarizeSessionLog,
  validateHumanCanaryReadiness,
  validateOperatorAlert,
  validateOperatorConfig,
  validateOperatorReconciliation,
  validateOperatorRunReport,
  validateSessionEvent,
  type HumanCanaryWorkflowChecks,
  type OperatorLoopCandidate,
  type OperatorRunMode,
  type SniperCandidateRisk,
  type StrategyQuoteFacts,
} from "../packages/live/src/index.js";
import { redactValue } from "../packages/security/src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const OUT_DIR = join(ROOT, "examples", "live", "part3");
mkdirSync(OUT_DIR, { recursive: true });

const AT = "2026-07-03T12:00:00.000Z";
const NOW_MS = Date.parse(AT);
const CLEAN_MINT = "So11111111111111111111111111111111111111112"; // WSOL — public fixture
const REJECT_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC — public fixture (real freeze authority)
const WALLET = "CgGszXon2aemnsCYRSuguJqkFdSAwCPc31mFcHLDwbpV"; // throwaway devnet PUBLIC key — public fixture
const SIG_FIXTURE = "3xJ9wPqRsTuVwXyZa1bCdEfGhJkMnPqRsTuVwXyZa1bC"; // short fixture, never a real 88-char signature

function write(name: string, value: unknown): void {
  const path = join(OUT_DIR, name);
  writeFileSync(path, JSON.stringify(redactValue(value), null, 2) + "\n");
  console.log(`wrote ${path}`);
}

// ---------------------------------------------------------------------------
// 1) Operator config + validation
// ---------------------------------------------------------------------------

const config = buildOperatorConfig({
  operatorLabel: "part3-example-operator",
  rpcEndpointHttps: "https://api.mainnet-beta.solana.com",
  mode: "armed_canary",
  walletPublicKey: WALLET,
  maxCanarySol: 0.005,
  maxCanariesPerSession: 1,
  maxCanariesPerDay: 1,
  maxDailyLossSol: 0.01,
  quoteTtlMs: 8_000,
  maxSlippageBps: 100,
  cooldownMs: 300_000,
  maxFailedAttempts: 1,
});
validateOperatorConfig(JSON.parse(JSON.stringify(config)));
write("operator-config.example.json", config);
const validation = evaluateOperatorConfig(config);
write("config-validation.example.json", validation);
const configValidated = validation.verdict === "valid" && validation.armedCanaryPermitted === true;

// ---------------------------------------------------------------------------
// 2) Session journal (JSONL) + summary + export
// ---------------------------------------------------------------------------

const SESSION_ID = "part3-example-session";
let journal = "";
let seq = 1;
const append = (kind: Parameters<typeof prepareSessionAppend>[1]["kind"], detail: string, data: Record<string, unknown> | null = null): void => {
  const { line } = prepareSessionAppend(journal, { sessionId: SESSION_ID, seq, at: AT, kind, detail, data });
  journal += line;
  seq += 1;
};
append("session_started", "operator session started by part3-example-operator", { mode: "armed_canary", operatorLabel: "part3-example-operator" });

// ---------------------------------------------------------------------------
// 3) Candidates + the three runs (observe / shadow / armed)
// ---------------------------------------------------------------------------

const cleanRisk: SniperCandidateRisk = { score: 5, decision: "ACCEPT", criticalFlagCount: 0, freezeAuthorityPresent: false, mintAuthorityPresent: false };
const rejectRisk: SniperCandidateRisk = { score: 100, decision: "REJECT", criticalFlagCount: 1, freezeAuthorityPresent: true, mintAuthorityPresent: false };
const freshQuote: StrategyQuoteFacts = { priceImpactPct: 0.5, ageMs: 1_000, slippageBps: 50, routeConfidence: 0.9, provider: "jupiter-lite-api" };

function candidates(): OperatorLoopCandidate[] {
  const clean = normalizeObservation({ mint: CLEAN_MINT, symbol: "WSOL", sourceProviderId: "example-feed", sourceKind: "replay", liquidityUsdHint: 50_000 }, { discoveredAt: AT });
  const reject = normalizeObservation({ mint: REJECT_MINT, symbol: "USDC", sourceProviderId: "example-feed", sourceKind: "replay", liquidityUsdHint: 50_000 }, { discoveredAt: AT });
  return [
    { candidate: { ...clean, risk: cleanRisk }, quote: freshQuote, quoteFresh: true, plannedSpendSol: 0.005 },
    { candidate: { ...reject, risk: rejectRisk }, quote: freshQuote, quoteFresh: true, plannedSpendSol: 0.005 },
  ];
}

function run(mode: OperatorRunMode, armed: boolean): ReturnType<typeof runSupervisedOperatorLoop> {
  return runSupervisedOperatorLoop({
    config,
    requestedMode: mode,
    candidates: candidates(),
    policy: buildLivePolicy({
      mode: mode === "armed_canary" ? "live_canary" : "paper",
      liveEnabled: mode === "armed_canary",
      walletProvider: mode === "armed_canary" ? "phantom" : null,
      caps: { maxTradeSol: config.maxCanarySol, maxPositionSol: config.maxCanarySol, maxDailyLossSol: config.maxDailyLossSol, maxSlippageBps: config.maxSlippageBps },
      freshness: { quoteTtlMs: config.quoteTtlMs, routeTtlMs: config.quoteTtlMs },
      cooldownMs: config.cooldownMs,
    }),
    escalationPolicy: buildEscalationPolicy({
      maxCanarySol: config.maxCanarySol,
      maxCanariesPerSession: config.maxCanariesPerSession,
      maxCanariesPerDay: config.maxCanariesPerDay,
      cooldownMs: config.cooldownMs,
      maxFailedAttempts: config.maxFailedAttempts,
      maxDailyLossSol: config.maxDailyLossSol,
    }),
    escalationSession: { armed, lastCanaryAtMs: null },
    limits: { maxCandidates: null, maxRuntimeMs: null },
    sessionId: SESSION_ID,
    startedAt: AT,
    nowMs: NOW_MS,
  });
}

const observeRun = validateOperatorRunReport(JSON.parse(JSON.stringify(run("observe_only", false))));
write("run-report.observe.example.json", observeRun);
const observeRunProven = observeRun.effectiveMode === "observe_only" && observeRun.totals.canaryRecommended === 0;

const shadowRun = validateOperatorRunReport(JSON.parse(JSON.stringify(run("paper_shadow", false))));
write("run-report.paper-shadow.example.json", shadowRun);
const paperShadowRunProven = shadowRun.effectiveMode === "paper_shadow" && shadowRun.totals.canaryRecommended === 0;

const armedRun = validateOperatorRunReport(JSON.parse(JSON.stringify(run("armed_canary", true)))); // WSOL recommended, USDC risk-ignored
write("run-report.armed-green.example.json", armedRun);
const armedRecommendationProven = armedRun.totals.canaryRecommended === 1 && armedRun.recommendation !== null && armedRun.recommendation.mint === CLEAN_MINT;

// Journal the armed run's events (exactly like live:operator:run does).
for (const e of armedRun.sessionEvents) append(e.kind as Parameters<typeof prepareSessionAppend>[1]["kind"], e.detail, e.data);

// The Phantom lifecycle as an operator would journal it (fixture short signature reference).
append("phantom_submitted", `human submitted the canary in Phantom for ${CLEAN_MINT}`, { mint: CLEAN_MINT });
append("phantom_confirmed", `Phantom reports the canary confirmed for ${CLEAN_MINT}`, { mint: CLEAN_MINT });
append("signature_recorded", "signature reference recorded (prefix only; the slot is the durable key)", { signaturePrefix: SIG_FIXTURE.slice(0, 16), signatureLength: SIG_FIXTURE.length });
append("balance_snapshot", "post-trade balances captured", { solLamports: "94995000", tokenRaw: "347000" });

// ---------------------------------------------------------------------------
// 4) Reconciliation (full-evidence EXAMPLE; fixture facts, never a live claim)
// ---------------------------------------------------------------------------

const reconciliation = buildOperatorReconciliation({
  candidateMint: CLEAN_MINT,
  canary: {
    signature: SIG_FIXTURE,
    submittedAt: AT,
    lastStatusAt: AT,
    status: "finalized",
    slot: 351_000_000,
    err: null,
    inputAmountRaw: "5000000",
    outputAmountRaw: "347306",
    solSpentLamports: "5005000",
    feesLamports: "5000",
    priorityFeeLamports: null,
    balanceBeforeLamports: "100000000",
    balanceAfterLamports: "94995000",
  },
  pre: { solLamports: "100000000", tokenRaw: "0", capturedAt: AT },
  post: { solLamports: "94995000", tokenRaw: "347000", capturedAt: AT },
  tokenDecimals: 6,
  quotedOutRaw: "347306",
  tokenPriceUsd: null,
  priceEvidence: null,
});
validateOperatorReconciliation(JSON.parse(JSON.stringify(reconciliation)));
write("reconciliation.full-evidence.example.json", reconciliation);
append("reconciliation_recorded", `reconciled ${CLEAN_MINT}: ${reconciliation.canary.verdict} (confidence ${reconciliation.confidence})`, {
  mint: CLEAN_MINT,
  verdict: reconciliation.canary.verdict,
  status: reconciliation.canary.status,
  slot: reconciliation.canary.slot,
  confidence: reconciliation.confidence,
  pnlStatus: reconciliation.pnlStatus,
  netLamports: reconciliation.canary.netLamports,
});
const reconciliationPathProven = reconciliation.confidence === "high" && reconciliation.slippageRealizedBps !== null;

append("session_ended", "operator session ended", null);

// Journal + summary + export, each re-validated.
writeFileSync(join(OUT_DIR, "session-journal.example.jsonl"), journal);
console.log(`wrote ${join(OUT_DIR, "session-journal.example.jsonl")}`);
for (const line of journal.trim().split("\n")) validateSessionEvent(JSON.parse(line));
const summary = summarizeSessionLog(journal);
write("session-summary.example.json", summary);
const exported = exportSessionLog(journal);
write("session-export.example.json", exported);
const sessionJournalWorks = summary.status === "ended" && summary.invalidLines === 0 && exported.events.length === summary.events;

// ---------------------------------------------------------------------------
// 5) Alerts (payload examples; sinks stay disabled by default)
// ---------------------------------------------------------------------------

const alertExamples = [
  buildOperatorAlert({ kind: "canary_recommended", sessionId: SESSION_ID, at: AT, detail: `canary recommended for ${CLEAN_MINT} — awaiting HUMAN Phantom approval` }),
  buildOperatorAlert({ kind: "risk_rejected", sessionId: SESSION_ID, at: AT, detail: `${REJECT_MINT} risk-blocked: risk-rejected, freeze-authority-present` }),
  buildOperatorAlert({ kind: "kill_switch_engaged", sessionId: SESSION_ID, at: AT, detail: "kill switch engaged — loop blocked, nothing processed" }),
];
for (const a of alertExamples) validateOperatorAlert(JSON.parse(JSON.stringify(a)));
write("alerts.example.json", { schemaVersion: "live.operator.alert.v1", note: "webhook-file sink payloads (one JSON object per line in the real file); sinks are DISABLED by default", alerts: alertExamples });
const alertsAvailable = alertExamples.length === 3;

// ---------------------------------------------------------------------------
// 6) THE PHASE-8 ARTIFACT: ready-for-human-canary (checks DERIVED, not asserted)
// ---------------------------------------------------------------------------

const dashboardBuilt = existsSync(join(ROOT, "apps", "web", "public", "operator-dashboard.html"));
const checks: HumanCanaryWorkflowChecks = {
  configValidated,
  sessionJournalWorks,
  observeRunProven,
  paperShadowRunProven,
  armedRecommendationProven,
  reconciliationPathProven,
  dashboardBuilt,
  alertsAvailable,
};
const readiness = buildHumanCanaryReadiness({
  generatedAt: AT,
  config,
  checks,
  // NO reconciliation evidence is passed here on purpose: the example reconciliation above is a
  // FIXTURE, not a real trade. Passing it would fake an executed canary; the readiness report
  // must state the truth — no real canary has been executed.
  reconciliation: null,
});
validateHumanCanaryReadiness(JSON.parse(JSON.stringify(readiness)));
write("ready-for-human-canary.report.json", readiness);

console.log(`\nreadiness verdict: ${readiness.verdict} (realCanaryExecuted: ${String(readiness.realCanaryExecuted)})`);
if (readiness.verdict === "not-ready") {
  console.error("readiness is not-ready — missing:", readiness.missing.join("; "));
  process.exitCode = 1;
}
