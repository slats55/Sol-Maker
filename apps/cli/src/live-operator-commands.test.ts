import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { validateOperatorRunReport, validateOperatorReconciliation, validateOperatorAlert, validateSessionEvent } from "@soulmaker/live";

import {
  liveOperatorReconcileReport,
  liveOperatorRunReport,
  liveOperatorSessionExportReport,
  liveOperatorSessionStartReport,
  liveOperatorSessionStatusReport,
  liveOperatorValidateReport,
} from "./live-operator-commands.js";

const NOW = "2026-07-03T12:00:00.000Z";
const ctx = { cwd: process.cwd(), env: {} as NodeJS.ProcessEnv, now: () => NOW };
const CLEAN_MINT = "So11111111111111111111111111111111111111112";
const WALLET = "CgGszXon2aemnsCYRSuguJqkFdSAwCPc31mFcHLDwbpV";

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "live-operator-"));
}

function writeConfig(dir: string, overrides: Record<string, unknown> = {}): string {
  const path = join(dir, "operator-config.json");
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: "live.operator.config.v1",
      operatorLabel: "test-operator",
      mode: "armed_canary",
      walletPublicKey: WALLET,
      rpcEndpointHttps: "https://api.mainnet-beta.solana.com",
      maxCanarySol: 0.005,
      maxCanariesPerSession: 1,
      maxCanariesPerDay: 1,
      maxDailyLossSol: 0.01,
      quoteTtlMs: 8000,
      maxSlippageBps: 100,
      cooldownMs: 300000,
      maxFailedAttempts: 1,
      killSwitchEngaged: false,
      emergencyStopEngaged: false,
      phantomApprovalRequired: true,
      largeTradesEnabled: false,
      backendCustodiesNoKeys: true,
      backendNeverSends: true,
      ...overrides,
    }),
  );
  return path;
}

function writeRiskAndQuote(dir: string): { risk: string; quote: string } {
  const risk = join(dir, "risk.json");
  writeFileSync(risk, JSON.stringify({ mint: CLEAN_MINT, score: 5, decision: "ACCEPT", flags: [{ id: "freeze-authority-renounced", severity: "info" }, { id: "mint-authority-renounced", severity: "info" }] }));
  const quote = join(dir, "quote.json");
  writeFileSync(quote, JSON.stringify({ provider: "jupiter-lite-api", priceImpactPct: 0.5, ageMs: 1000, slippageBps: 50, routeConfidence: 0.9 }));
  return { risk, quote };
}

/** A realtime-style snapshot whose observation carries the liquidity evidence a canary needs. */
function writeSnapshot(dir: string): string {
  const snapshot = join(dir, "snapshot.json");
  writeFileSync(
    snapshot,
    JSON.stringify({
      schemaVersion: "realtime.candidates.snapshot.v1",
      observations: [{ mint: CLEAN_MINT, symbol: "WSOL", sourceProviderId: "test-feed", sourceKind: "live", liquidityUsdHint: 50_000 }],
    }),
  );
  return snapshot;
}

function startSession(dir: string): string {
  const log = join(dir, "session.jsonl");
  const r = liveOperatorSessionStartReport(ctx, { sessionLog: log, sessionId: "s-test-1", operatorLabel: "test-operator", mode: "observe_only" });
  expect(r.exitCode).toBe(0);
  return log;
}

describe("live:operator:validate", () => {
  it("validates a good config and reports armed_canary permitted (never an authorization)", () => {
    const dir = tmp();
    const r = liveOperatorValidateReport(ctx, { configPath: writeConfig(dir), json: true });
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.text) as Record<string, unknown>;
    expect(parsed.verdict).toBe("valid");
    expect(parsed.armedCanaryPermitted).toBe(true);
    expect(parsed.largeTradesEnabled).toBe(false);
  });

  it("fails closed on a config carrying a secret-named field", () => {
    const dir = tmp();
    const r = liveOperatorValidateReport(ctx, { configPath: writeConfig(dir, { secretKey: "oops" }) });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/sensitive-named/);
  });

  it("fails closed on an over-ceiling cap and on a keyed RPC endpoint", () => {
    const dir = tmp();
    expect(liveOperatorValidateReport(ctx, { configPath: writeConfig(dir, { maxCanarySol: 1 }) }).exitCode).toBe(1);
    const dir2 = tmp();
    const r = liveOperatorValidateReport(ctx, { configPath: writeConfig(dir2, { rpcEndpointHttps: "https://rpc.example.com/?cluster=x" }) });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/query string/);
  });

  it("never echoes the full RPC URL (host only)", () => {
    const dir = tmp();
    const r = liveOperatorValidateReport(ctx, { configPath: writeConfig(dir, { rpcEndpointHttps: "https://rpc.example.com/private-path-segment" }), json: true });
    expect(r.exitCode).toBe(0);
    expect(r.text).not.toContain("private-path-segment");
  });
});

describe("live:operator:session:* — the durable journal", () => {
  it("start creates the journal; a second start on the same file is refused (append-only)", () => {
    const dir = tmp();
    const log = startSession(dir);
    expect(existsSync(log)).toBe(true);
    const again = liveOperatorSessionStartReport(ctx, { sessionLog: log, sessionId: "s-test-2" });
    expect(again.exitCode).toBe(1);
    expect(again.text).toMatch(/append-only/);
  });

  it("status + export report honest tallies and validate every event", () => {
    const dir = tmp();
    const log = startSession(dir);
    const status = liveOperatorSessionStatusReport(ctx, { sessionLog: log, json: true });
    expect(status.exitCode).toBe(0);
    const s = JSON.parse(status.text) as { status: string; events: number };
    expect(s.status).toBe("open");
    expect(s.events).toBe(1);

    const out = join(dir, "export.json");
    const exportR = liveOperatorSessionExportReport(ctx, { sessionLog: log, out });
    expect(exportR.exitCode).toBe(0);
    const exported = JSON.parse(readFileSync(out, "utf8")) as { events: unknown[] };
    expect(exported.events).toHaveLength(1);
    for (const e of exported.events) validateSessionEvent(e);
  });

  it("status on a missing journal is a clear refusal", () => {
    expect(liveOperatorSessionStatusReport(ctx, { sessionLog: join(tmp(), "nope.jsonl") }).exitCode).toBe(1);
  });
});

describe("live:operator:run — supervised, recommend-only", () => {
  it("observe_only processes but can never recommend; the journal grows", () => {
    const dir = tmp();
    const config = writeConfig(dir);
    const log = startSession(dir);
    const { risk, quote } = writeRiskAndQuote(dir);
    const r = liveOperatorRunReport(ctx, {
      configPath: config,
      mode: "observe_only",
      mints: [CLEAN_MINT],
      riskPairs: [`${CLEAN_MINT}=${risk}`],
      quotePairs: [`${CLEAN_MINT}=${quote}`],
      sessionLog: log,
      json: true,
    });
    expect(r.exitCode).toBe(0);
    const report = validateOperatorRunReport(JSON.parse(r.text));
    expect(report.effectiveMode).toBe("observe_only");
    expect(report.totals.canaryRecommended).toBe(0);
    // Journal grew beyond the start event and every line validates.
    const lines = readFileSync(log, "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) validateSessionEvent(JSON.parse(line));
  });

  it("paper_shadow shadows but never recommends", () => {
    const dir = tmp();
    const { risk, quote } = writeRiskAndQuote(dir);
    const r = liveOperatorRunReport(ctx, {
      configPath: writeConfig(dir),
      mode: "paper_shadow",
      mints: [CLEAN_MINT],
      riskPairs: [`${CLEAN_MINT}=${risk}`],
      quotePairs: [`${CLEAN_MINT}=${quote}`],
      json: true,
    });
    const report = validateOperatorRunReport(JSON.parse(r.text));
    expect(report.totals.canaryRecommended).toBe(0);
    expect(report.totals.paperShadow).toBe(1);
  });

  it("armed_canary REQUIRES the session journal", () => {
    const dir = tmp();
    const r = liveOperatorRunReport(ctx, { configPath: writeConfig(dir), mode: "armed_canary", mints: [CLEAN_MINT] });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/requires --session-log/);
  });

  it("armed_canary + green candidate + --escalation-armed ⇒ exactly ONE recommendation, Phantom handoff, journaled", () => {
    const dir = tmp();
    const config = writeConfig(dir);
    const log = startSession(dir);
    const { risk, quote } = writeRiskAndQuote(dir);
    const r = liveOperatorRunReport(ctx, {
      configPath: config,
      mode: "armed_canary",
      snapshotPath: writeSnapshot(dir),
      riskPairs: [`${CLEAN_MINT}=${risk}`],
      quotePairs: [`${CLEAN_MINT}=${quote}`],
      sessionLog: log,
      escalationArmed: true,
      spendSol: "0.005",
      json: true,
    });
    expect(r.exitCode).toBe(0);
    const report = validateOperatorRunReport(JSON.parse(r.text));
    expect(report.totals.canaryRecommended).toBe(1);
    expect(report.recommendation!.mint).toBe(CLEAN_MINT);
    expect(report.recommendation!.nextSteps.join(" ")).toMatch(/Phantom/);
    const journalText = readFileSync(log, "utf8");
    expect(journalText).toContain("canary_recommended");
    expect(journalText).toContain("phantom_approval_pending");
  });

  it("a MANUAL mint (no liquidity evidence) can never reach a canary recommendation, even armed", () => {
    const dir = tmp();
    const config = writeConfig(dir);
    const log = startSession(dir);
    const { risk, quote } = writeRiskAndQuote(dir);
    const r = liveOperatorRunReport(ctx, {
      configPath: config,
      mode: "armed_canary",
      mints: [CLEAN_MINT],
      riskPairs: [`${CLEAN_MINT}=${risk}`],
      quotePairs: [`${CLEAN_MINT}=${quote}`],
      sessionLog: log,
      escalationArmed: true,
      json: true,
    });
    const report = validateOperatorRunReport(JSON.parse(r.text));
    expect(report.totals.canaryRecommended).toBe(0);
  });

  it("without --escalation-armed the armed run recommends NOTHING (manual arm each invocation)", () => {
    const dir = tmp();
    const config = writeConfig(dir);
    const log = startSession(dir);
    const { risk, quote } = writeRiskAndQuote(dir);
    const r = liveOperatorRunReport(ctx, {
      configPath: config,
      mode: "armed_canary",
      snapshotPath: writeSnapshot(dir),
      riskPairs: [`${CLEAN_MINT}=${risk}`],
      quotePairs: [`${CLEAN_MINT}=${quote}`],
      sessionLog: log,
      json: true,
    });
    const report = validateOperatorRunReport(JSON.parse(r.text));
    expect(report.totals.canaryRecommended).toBe(0);
  });

  it("a SECOND armed run on the same journal is capped by the durable session (one canary per session)", () => {
    const dir = tmp();
    const config = writeConfig(dir);
    const log = startSession(dir);
    const { risk, quote } = writeRiskAndQuote(dir);
    const opts = {
      configPath: config,
      mode: "armed_canary",
      snapshotPath: writeSnapshot(dir),
      riskPairs: [`${CLEAN_MINT}=${risk}`],
      quotePairs: [`${CLEAN_MINT}=${quote}`],
      sessionLog: log,
      escalationArmed: true,
      json: true,
    };
    const first = validateOperatorRunReport(JSON.parse(liveOperatorRunReport(ctx, opts).text));
    expect(first.totals.canaryRecommended).toBe(1);
    const second = validateOperatorRunReport(JSON.parse(liveOperatorRunReport(ctx, opts).text));
    expect(second.totals.canaryRecommended).toBe(0);
    expect(JSON.stringify(second.results)).toMatch(/session-canary-cap-reached|cooldown-active/);
  });

  it("kill switch in the CONFIG blocks everything and pauses", () => {
    const dir = tmp();
    const r = liveOperatorRunReport(ctx, { configPath: writeConfig(dir, { killSwitchEngaged: true }), mode: "observe_only", mints: [CLEAN_MINT], json: true });
    const report = validateOperatorRunReport(JSON.parse(r.text));
    expect(report.totals.processed).toBe(0);
    expect(report.paused).toBe(true);
    expect(report.pauseReasons).toContain("kill-switch-engaged");
  });

  it("requesting a mode ABOVE the config mode is refused", () => {
    const dir = tmp();
    const r = liveOperatorRunReport(ctx, { configPath: writeConfig(dir, { mode: "observe_only", walletPublicKey: null }), mode: "paper_shadow", mints: [CLEAN_MINT] });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/exceeds the config/);
  });

  it("--record-manual-rearm journals the human re-arm and unblocks a paused session", () => {
    const dir = tmp();
    const config = writeConfig(dir);
    const log = startSession(dir);
    // Simulate a Phantom rejection recorded out-of-band (paused pending re-arm).
    const existing = readFileSync(log, "utf8");
    const rejected = { schemaVersion: "live.operator.session.event.v1", sessionId: "s-test-1", seq: 2, at: NOW, kind: "phantom_rejected", detail: "human rejected in Phantom", data: null };
    writeFileSync(log, existing + JSON.stringify(rejected) + "\n");

    const { risk, quote } = writeRiskAndQuote(dir);
    const snapshot = writeSnapshot(dir);
    const pausedRun = liveOperatorRunReport(ctx, {
      configPath: config,
      mode: "armed_canary",
      snapshotPath: snapshot,
      riskPairs: [`${CLEAN_MINT}=${risk}`],
      quotePairs: [`${CLEAN_MINT}=${quote}`],
      sessionLog: log,
      escalationArmed: true,
      json: true,
    });
    const pausedReport = validateOperatorRunReport(JSON.parse(pausedRun.text));
    expect(pausedReport.paused).toBe(true);
    expect(pausedReport.totals.canaryRecommended).toBe(0);

    // Re-arm + failed-attempts still at cap ⇒ still no recommendation (failure cap holds),
    // but the pause itself is cleared and the re-arm is journaled.
    const rearmed = liveOperatorRunReport(ctx, {
      configPath: config,
      mode: "armed_canary",
      snapshotPath: snapshot,
      riskPairs: [`${CLEAN_MINT}=${risk}`],
      quotePairs: [`${CLEAN_MINT}=${quote}`],
      sessionLog: log,
      escalationArmed: true,
      recordManualRearm: "test-operator",
      json: true,
    });
    const rearmedReport = validateOperatorRunReport(JSON.parse(rearmed.text));
    expect(rearmedReport.paused).toBe(false);
    expect(readFileSync(log, "utf8")).toContain("manual_rearm_recorded");
    expect(rearmedReport.totals.canaryRecommended).toBe(0); // failed-attempts-cap-reached still blocks
    expect(JSON.stringify(rearmedReport.results)).toMatch(/failed-attempts-cap-reached/);
  });

  it("alert sinks are OFF by default and the webhook file sink appends validated payloads when enabled", () => {
    const dir = tmp();
    const config = writeConfig(dir);
    const { risk, quote } = writeRiskAndQuote(dir);
    const alertFile = join(dir, "alerts.jsonl");
    // Default: no sink output, no file.
    const silent = liveOperatorRunReport(ctx, { configPath: config, mode: "observe_only", mints: [CLEAN_MINT], riskPairs: [`${CLEAN_MINT}=${risk}`], quotePairs: [`${CLEAN_MINT}=${quote}`] });
    expect(silent.exitCode).toBe(0);
    expect(silent.text).not.toContain("[ALERT");
    expect(existsSync(alertFile)).toBe(false);
    // Opt-in: console lines + webhook JSONL lines that validate.
    const loud = liveOperatorRunReport(ctx, {
      configPath: config,
      mode: "observe_only",
      mints: [CLEAN_MINT],
      riskPairs: [`${CLEAN_MINT}=${risk}`],
      quotePairs: [`${CLEAN_MINT}=${quote}`],
      alertConsole: true,
      alertWebhookFile: alertFile,
    });
    expect(loud.exitCode).toBe(0);
    expect(loud.text).toContain("[ALERT");
    const lines = readFileSync(alertFile, "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) validateOperatorAlert(JSON.parse(line));
  });

  it("--max-candidates bounds the pass", () => {
    const dir = tmp();
    const r = liveOperatorRunReport(ctx, {
      configPath: writeConfig(dir),
      mode: "observe_only",
      mints: [CLEAN_MINT, "A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6", "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E"],
      maxCandidates: "1",
      json: true,
    });
    const report = validateOperatorRunReport(JSON.parse(r.text));
    expect(report.totals.processed).toBe(1);
    expect(report.totals.skippedOverBudget).toBe(2);
  });
});

describe("live:operator:reconcile", () => {
  function writeFacts(dir: string): string {
    const facts = join(dir, "facts.json");
    writeFileSync(
      facts,
      JSON.stringify({
        signature: "3xJ9wPqRsTuVwXyZa1bCdEfGhJkMnPqRsTuVwXyZa1bC",
        submittedAt: NOW,
        lastStatusAt: NOW,
        status: "finalized",
        slot: 351000000,
        feesLamports: "5000",
      }),
    );
    return facts;
  }

  it("computes the full accounting from facts + snapshots and journals the reconciliation", () => {
    const dir = tmp();
    const log = startSession(dir);
    const facts = writeFacts(dir);
    const pre = join(dir, "pre.json");
    writeFileSync(pre, JSON.stringify({ solLamports: "100000000", tokenRaw: "0", capturedAt: NOW }));
    const post = join(dir, "post.json");
    writeFileSync(post, JSON.stringify({ solLamports: "94995000", tokenRaw: "347000", capturedAt: NOW }));

    const r = liveOperatorReconcileReport(ctx, {
      candidateMint: CLEAN_MINT,
      factsPath: facts,
      prePath: pre,
      postPath: post,
      tokenDecimals: "6",
      quotedOutRaw: "347306",
      sessionLog: log,
      json: true,
    });
    expect(r.exitCode).toBe(0);
    const record = validateOperatorReconciliation(JSON.parse(r.text));
    expect(record.confidence).toBe("high");
    expect(record.grossTokenReceivedRaw).toBe("347000");
    expect(record.slippageRealizedBps).toBe(-8);
    expect(readFileSync(log, "utf8")).toContain("reconciliation_recorded");
  });

  it("missing snapshots yield honest unknowns (low/medium confidence, no invented PnL)", () => {
    const dir = tmp();
    const r = liveOperatorReconcileReport(ctx, { candidateMint: CLEAN_MINT, factsPath: writeFacts(dir), json: true });
    expect(r.exitCode).toBe(0);
    const record = validateOperatorReconciliation(JSON.parse(r.text));
    expect(record.grossTokenReceivedRaw).toBeNull();
    expect(record.confidence).not.toBe("high");
    expect(["unknown", "realized-loss-known"]).toContain(record.pnlStatus);
  });

  it("refuses a price without evidence", () => {
    const dir = tmp();
    const r = liveOperatorReconcileReport(ctx, { candidateMint: CLEAN_MINT, factsPath: writeFacts(dir), tokenPriceUsd: "1.0" });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/together/);
  });
});
