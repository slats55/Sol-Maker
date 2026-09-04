/**
 * Sprint 109 — the continuous PAPER daemon + hardened canary buy/sell surface.
 *
 * Every network seam is injected (fake feeds, fake quotes, fake risk) so these tests prove the
 * ORCHESTRATION exactly: cross-loop dedupe, provider-failure survival, graceful-interrupt summary,
 * the deterministic paper-entry rule, exit application, honest performance reporting, and every
 * refusal wall on the live-gated buy/sell prepare paths.
 */

import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildLedger,
  buildLivePolicy,
  buildOperatorApproval,
  ledgerOpen,
  openPosition,
  validateLedger,
} from "@soulmaker/live";
import type { CandidateSourceAdapter, CandidateSourceResult, CandidateObservation } from "@soulmaker/realtime";
import type { QuoteProviderAdapter, QuoteFetchRequest, QuoteFetchResult } from "@soulmaker/quotefetch";

import {
  liveCanaryPrepareBuyReport,
  liveCanaryPrepareSellReport,
  liveSniperDaemonReport,
  liveSniperPaperReportReport,
  liveSniperReconcilePositionReport,
  WRAPPED_SOL_MINT,
} from "./live-daemon-commands.js";
import { liveSniperRankReport } from "./live-sniper-commands.js";

const MINT_A = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MINT_B = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const T0 = "2026-07-02T12:00:00.000Z";
const T0_MS = Date.parse(T0);

function workspace(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "live-daemon-"));
  writeFileSync(join(dir, "soulmaker.config.json"), JSON.stringify({ mode: "PAPER" }));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** An advancing fake clock (1s per call) so loops progress deterministically. */
function fakeClock(startMs = T0_MS): () => string {
  let t = startMs;
  return () => {
    t += 1000;
    return new Date(t).toISOString();
  };
}

function observation(mint: string, liquidityUsd = 50_000): CandidateObservation {
  return {
    candidateId: `t-${mint.slice(0, 6)}`,
    mint,
    symbol: "TEST",
    name: null,
    sourceProviderId: "fake-feed",
    sourceKind: "live",
    observedAtLabel: T0,
    launchpadLabel: null,
    liquidityUsdHint: liquidityUsd,
    marketCapUsdHint: null,
    holderCountHint: null,
    caveats: [],
  };
}

function fakeSource(id: string, results: () => CandidateSourceResult): CandidateSourceAdapter {
  return Object.freeze({
    providerId: id,
    sourceKind: "live" as const,
    endpointHost: "fake.example",
    fetchOnce: async () => results(),
  });
}

function observedResult(id: string, observations: CandidateObservation[]): CandidateSourceResult {
  return {
    status: "observed",
    observations,
    metadata: { providerId: id, endpointHost: "fake.example", fetchedAt: T0, httpStatus: 200, responseSha256_128: null, statusDetail: null },
  };
}

function blockedResult(id: string): CandidateSourceResult {
  return {
    status: "blocked",
    observations: [],
    metadata: { providerId: id, endpointHost: "fake.example", fetchedAt: T0, httpStatus: 429, responseSha256_128: null, statusDetail: "HTTP 429" },
  };
}

/** A fake quote provider: buys quote a token amount out; sells quote a lamport value out. */
function fakeQuotes(opts: { buyOutRaw?: string | null; sellOutRaw?: () => string | null; clock: () => string }): QuoteProviderAdapter {
  const fetchQuote = async (req: QuoteFetchRequest): Promise<QuoteFetchResult> => {
    const fetchedAt = opts.clock();
    const isSell = req.candidateMint === WRAPPED_SOL_MINT;
    const outRaw = isSell ? (opts.sellOutRaw ? opts.sellOutRaw() : "5000000") : (opts.buyOutRaw ?? "123456789");
    if (outRaw === null) {
      return {
        status: "unavailable",
        observation: {
          schemaVersion: "routequote.observation.input.v1",
          source: "fake-quotes",
          candidateMint: req.candidateMint,
          quoteStatus: "unavailable",
          inputMint: null,
          outputMint: null,
          amountInLabel: null,
          amountOutLabel: null,
          venueLabel: null,
          feeLabel: null,
          observedAtLabel: null,
          statusReason: "fake outage",
          notes: [],
        },
        metadata: { providerId: "fake-quotes", endpointHost: "fake.example", fetchedAt, httpStatus: null, contextSlot: null, priceImpactPct: null, routeLabels: [], responseSha256_128: null, statusDetail: "fake outage" },
      };
    }
    return {
      status: "quote-observed",
      observation: {
        schemaVersion: "routequote.observation.input.v1",
        source: "fake-quotes",
        candidateMint: req.candidateMint,
        quoteStatus: "quote-observed",
        inputMint: req.inputMint,
        outputMint: req.candidateMint,
        amountInLabel: `${req.amountRaw} raw in (ExactIn)`,
        amountOutLabel: `${outRaw} raw out @ ${req.slippageBps} bps slippage`,
        venueLabel: "FakeDEX",
        feeLabel: null,
        observedAtLabel: fetchedAt,
        statusReason: null,
        notes: [],
      },
      metadata: { providerId: "fake-quotes", endpointHost: "fake.example", fetchedAt, httpStatus: 200, contextSlot: null, priceImpactPct: "0.5", routeLabels: ["FakeDEX"], responseSha256_128: null, statusDetail: null },
    };
  };
  return Object.freeze({ providerId: "fake-quotes", endpointHost: "fake.example", fetchQuote });
}

const CLEAN_RISK_REPORT = { score: 5, decision: "ACCEPT", flags: [] };
const REJECT_RISK_REPORT = { score: 100, decision: "REJECT", flags: [{ id: "freeze-authority-present", severity: "critical" }] };

function daemonCtx(dir: string, overrides: Record<string, unknown> = {}) {
  const clock = fakeClock();
  return {
    cwd: dir,
    now: clock,
    sleep: async () => {},
    candidateSources: [fakeSource("fake-feed", () => observedResult("fake-feed", [observation(MINT_A), observation(MINT_B)]))],
    quoteProvider: fakeQuotes({ clock }),
    riskFetcher: async () => CLEAN_RISK_REPORT,
    registerInterrupt: () => () => {},
    ...overrides,
  };
}

describe("live:sniper:daemon — orchestration", () => {
  it("S111: --mode live without arming FAILS CLOSED; an unknown mode is refused; a missing out-dir is refused", async () => {
    const { dir, cleanup } = workspace();
    try {
      const live = await liveSniperDaemonReport(daemonCtx(dir, { env: {} }), { mode: "live", outDir: "runs/x" }); // explicit empty env: never inherit an operator shell
      expect(live.exitCode).toBe(1);
      expect(live.text).toMatch(/fail closed/);
      expect(live.text).toMatch(/SOLMAKER_ENABLE_LIVE_TRADING/);
      expect(live.text).toMatch(/--max-spend-sol is required/);
      const bogus = await liveSniperDaemonReport(daemonCtx(dir), { mode: "bogus", outDir: "runs/x" });
      expect(bogus.exitCode).toBe(1);
      expect(bogus.text).toMatch(/must be "paper" or "live"/);
      const noDir = await liveSniperDaemonReport(daemonCtx(dir), {});
      expect(noDir.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("dedupes candidates ACROSS loops and opens paper positions only by deterministic rule", async () => {
    const { dir, cleanup } = workspace();
    try {
      const r = await liveSniperDaemonReport(daemonCtx(dir), { outDir: "runs/session", maxLoops: "2", json: true });
      expect(r.exitCode, r.text).toBe(0);
      const summary = JSON.parse(r.text);
      // Loop 1 sees 2 new candidates; loop 2 sees the same 2 → duplicates.
      expect(summary.totals.loops).toBe(2);
      expect(summary.totals.newCandidates).toBe(2);
      expect(summary.totals.duplicatesSkipped).toBe(2);
      // Clean risk + fresh quote + capacity → both opened (balanced profile allows 3).
      expect(summary.totals.positionsOpened).toBe(2);
      const ledger = validateLedger(JSON.parse(readFileSync(join(dir, "runs/session/ledger.json"), "utf8")));
      expect(ledger.totals.open).toBe(2);
      expect(ledger.positions.every((p) => p.kind === "paper")).toBe(true);
      // Journals exist.
      for (const f of ["session.json", "candidates.jsonl", "decisions.jsonl", "positions.jsonl", "provider-health.json", "summary.json", "human-report.md"]) {
        expect(existsSync(join(dir, "runs/session", f)), f).toBe(true);
      }
    } finally {
      cleanup();
    }
  });

  it("opens NOTHING when risk is not configured, and says why", async () => {
    const { dir, cleanup } = workspace();
    try {
      const r = await liveSniperDaemonReport(daemonCtx(dir, { riskFetcher: undefined }), { outDir: "runs/norisk", maxLoops: "1", json: true });
      expect(r.exitCode, r.text).toBe(0);
      const summary = JSON.parse(r.text);
      expect(summary.totals.positionsOpened).toBe(0);
      expect(summary.noTradeReasons["risk-not-configured"]).toBe(2);
    } finally {
      cleanup();
    }
  });

  it("a REJECT risk report blocks entry and is counted as risk-rejected", async () => {
    const { dir, cleanup } = workspace();
    try {
      const r = await liveSniperDaemonReport(daemonCtx(dir, { riskFetcher: async () => REJECT_RISK_REPORT }), { outDir: "runs/reject", maxLoops: "1", json: true });
      expect(r.exitCode, r.text).toBe(0);
      const summary = JSON.parse(r.text);
      expect(summary.totals.positionsOpened).toBe(0);
      expect(summary.totals.riskRejected).toBe(2);
      const reasons = Object.keys(summary.noTradeReasons).join(" ");
      expect(reasons).toMatch(/risk-rejected/);
    } finally {
      cleanup();
    }
  });

  it("SURVIVES a failing provider (backoff recorded; the other provider still feeds the loop)", async () => {
    const { dir, cleanup } = workspace();
    try {
      const ctx = daemonCtx(dir, {
        candidateSources: [
          fakeSource("bad-feed", () => blockedResult("bad-feed")),
          fakeSource("good-feed", () => observedResult("good-feed", [observation(MINT_A)])),
        ],
      });
      const r = await liveSniperDaemonReport(ctx, { outDir: "runs/failover", maxLoops: "2", json: true });
      expect(r.exitCode, r.text).toBe(0);
      const summary = JSON.parse(r.text);
      expect(summary.totals.providerFailures).toBeGreaterThanOrEqual(1);
      const bad = summary.providerHealth.find((h: { provider: string }) => h.provider === "bad-feed");
      expect(bad.blocked).toBeGreaterThanOrEqual(1);
      expect(bad.backoffUntilMs).toBeGreaterThan(0);
      expect(summary.totals.newCandidates).toBe(1); // the good feed still worked
      const health = JSON.parse(readFileSync(join(dir, "runs/failover/provider-health.json"), "utf8"));
      expect(health.schemaVersion).toBe("live.sniper.daemon.provider_health.v1");
    } finally {
      cleanup();
    }
  });

  it("writes the summary on a graceful operator interrupt", async () => {
    const { dir, cleanup } = workspace();
    try {
      let trigger: (() => void) | null = null;
      const ctx = daemonCtx(dir, {
        registerInterrupt: (handler: () => void) => {
          trigger = handler;
          return () => {};
        },
        sleep: async () => {
          // Ctrl+C lands during the first inter-loop sleep.
          if (trigger) trigger();
        },
      });
      const r = await liveSniperDaemonReport(ctx, { outDir: "runs/interrupt", durationMinutes: "60", json: true });
      expect(r.exitCode, r.text).toBe(0);
      const summary = JSON.parse(r.text);
      expect(summary.endedBy).toBe("operator-interrupt");
      expect(existsSync(join(dir, "runs/interrupt/summary.json"))).toBe(true);
      expect(existsSync(join(dir, "runs/interrupt/human-report.md"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("applies a stop-loss exit with --apply-exits (and only journals it without)", async () => {
    const { dir, cleanup } = workspace();
    try {
      // Sell marks: loop 1 healthy (5.1M ≥ entry 5M), loop 2 crash (3.9M ≤ 80% of 5M → stop-loss at balanced 20%).
      let sellCall = 0;
      const marks = ["5100000", "3900000", "3900000", "3900000"];
      const mk = () => ({
        ...daemonCtx(dir, {
          candidateSources: [fakeSource("fake-feed", () => observedResult("fake-feed", [observation(MINT_A)]))],
        }),
      });
      const ctxApply = mk();
      ctxApply.quoteProvider = fakeQuotes({ clock: ctxApply.now, sellOutRaw: () => marks[Math.min(sellCall++, marks.length - 1)] ?? null });
      const r = await liveSniperDaemonReport(ctxApply, { outDir: "runs/exits", maxLoops: "3", applyExits: true, json: true });
      expect(r.exitCode, r.text).toBe(0);
      const summary = JSON.parse(r.text);
      expect(summary.totals.positionsOpened).toBe(1);
      expect(summary.totals.positionsClosed).toBe(1);
      const ledger = validateLedger(JSON.parse(readFileSync(join(dir, "runs/exits/ledger.json"), "utf8")));
      const closed = ledger.positions.find((p) => p.status === "closed");
      expect(closed?.close?.reason).toBe("stop-loss");
      expect(closed?.close?.pnlLamports).toBe(3900000 - 5000000);
      const exits = readFileSync(join(dir, "runs/exits/exits.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(exits.some((e) => e.reason === "stop-loss" && e.applied === true)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("without --apply-exits the exit is a journaled recommendation and the position stays open", async () => {
    const { dir, cleanup } = workspace();
    try {
      const ctx = daemonCtx(dir, {
        candidateSources: [fakeSource("fake-feed", () => observedResult("fake-feed", [observation(MINT_A)]))],
      });
      ctx.quoteProvider = fakeQuotes({ clock: ctx.now, sellOutRaw: () => "3900000" });
      const r = await liveSniperDaemonReport(ctx, { outDir: "runs/norec", maxLoops: "2", json: true });
      expect(r.exitCode, r.text).toBe(0);
      const ledger = validateLedger(JSON.parse(readFileSync(join(dir, "runs/norec/ledger.json"), "utf8")));
      expect(ledger.totals.open).toBe(1);
      const exits = readFileSync(join(dir, "runs/norec/exits.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
      expect(exits.some((e) => e.reason === "stop-loss" && e.applied === false)).toBe(true);
    } finally {
      cleanup();
    }
  });
});

describe("live:sniper:paper:report — over a real daemon session folder", () => {
  it("reports no-trades honestly and writes the markdown evidence", async () => {
    const { dir, cleanup } = workspace();
    try {
      await liveSniperDaemonReport(daemonCtx(dir, { riskFetcher: undefined }), { outDir: "runs/session", maxLoops: "1" });
      const r = liveSniperPaperReportReport({ cwd: dir, now: fakeClock() }, { sessionDir: "runs/session", out: "runs/session/performance.md", json: true });
      expect(r.exitCode, r.text).toBe(0);
      const report = JSON.parse(r.text);
      expect(report.edge.verdict).toBe("no-trades");
      expect(existsSync(join(dir, "runs/session/performance.md"))).toBe(true);
      const md = readFileSync(join(dir, "runs/session/performance.md"), "utf8");
      expect(md).toContain("no profitability claim");
    } finally {
      cleanup();
    }
  });

  it("a session with closed trades yields an insufficient-sample verdict (small n) — never an edge claim", async () => {
    const { dir, cleanup } = workspace();
    try {
      let sellCall = 0;
      const ctx = daemonCtx(dir, {
        candidateSources: [fakeSource("fake-feed", () => observedResult("fake-feed", [observation(MINT_A)]))],
      });
      ctx.quoteProvider = fakeQuotes({ clock: ctx.now, sellOutRaw: () => (sellCall++ === 0 ? "5100000" : "8000000") }); // take-profit at +50%
      await liveSniperDaemonReport(ctx, { outDir: "runs/tp", maxLoops: "3", applyExits: true });
      const r = liveSniperPaperReportReport({ cwd: dir, now: fakeClock() }, { sessionDir: "runs/tp", json: true });
      expect(r.exitCode, r.text).toBe(0);
      const report = JSON.parse(r.text);
      expect(report.positions.closed).toBe(1);
      expect(report.exits["take-profit"]).toBe(1);
      expect(report.edge.verdict).toBe("insufficient-sample");
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// live:canary:prepare-buy — the refusal walls
// ---------------------------------------------------------------------------

function writeBuyFixtures(dir: string, opts: { quoteAgeMs?: number; approvalAgeMinutes?: number; policyGreen?: boolean; riskReject?: boolean } = {}): void {
  writeFileSync(join(dir, "risk.json"), JSON.stringify(opts.riskReject ? REJECT_RISK_REPORT : CLEAN_RISK_REPORT));
  writeFileSync(
    join(dir, "quote.json"),
    JSON.stringify({
      provider: "jupiter-lite-api",
      inputMint: WRAPPED_SOL_MINT,
      outputMint: MINT_A,
      inAmountRaw: "5000000",
      outAmountRaw: "123456789",
      slippageBps: 100,
      priceImpactPct: 0.4,
      quotedAt: T0,
      ageMs: opts.quoteAgeMs ?? 1000,
      routeLabels: ["FakeDEX"],
    }),
  );
  const approvedAt = new Date(T0_MS - (opts.approvalAgeMinutes ?? 0) * 60_000).toISOString();
  writeFileSync(join(dir, "approval.json"), JSON.stringify(buildOperatorApproval({ operatorLabel: "myles", confirmPhrase: "I-APPROVE-ONE-CANARY-RECOMMENDATION", approvedAt })));
  const policy = opts.policyGreen === false ? buildLivePolicy() : buildLivePolicy({ mode: "live_canary", liveEnabled: true, walletProvider: "phantom" });
  writeFileSync(join(dir, "policy.json"), JSON.stringify(policy));
}

function buyOpts(overrides: Record<string, string | boolean> = {}) {
  return {
    candidateMint: MINT_A,
    riskPath: "risk.json",
    quotePath: "quote.json",
    approvalPath: "approval.json",
    policyPath: "policy.json",
    spendSol: "0.005",
    json: true,
    ...overrides,
  };
}

describe("live:canary:prepare-buy — refusal walls", () => {
  it("green path: all gates pass → buy review + UNSIGNED request artifacts", () => {
    const { dir, cleanup } = workspace();
    try {
      writeBuyFixtures(dir);
      const r = liveCanaryPrepareBuyReport({ cwd: dir, now: () => T0 }, { ...buyOpts(), outDir: "runs/buy" });
      expect(r.exitCode, r.text).toBe(0);
      const review = JSON.parse(readFileSync(join(dir, "runs/buy/buy-review.json"), "utf8"));
      expect(review.schemaVersion).toBe("live.canary.buy_review.v1");
      expect(review.signed).toBe(false);
      expect(review.maxLossSol).toBe(0.005);
      const request = JSON.parse(readFileSync(join(dir, "runs/buy/canary-request.json"), "utf8"));
      expect(request.signed).toBe(false);
      expect(request.submitted).toBe(false);
      expect(existsSync(join(dir, "runs/buy/buy-review.md"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("refuses a MISSING approval", () => {
    const { dir, cleanup } = workspace();
    try {
      writeBuyFixtures(dir);
      const r = liveCanaryPrepareBuyReport({ cwd: dir, now: () => T0 }, buyOpts({ approvalPath: "" as string }));
      expect(r.exitCode).toBe(1);
      expect(r.text).toMatch(/--approval is required/);
    } finally {
      cleanup();
    }
  });

  it("refuses an EXPIRED approval (as powerless as none)", () => {
    const { dir, cleanup } = workspace();
    try {
      writeBuyFixtures(dir, { approvalAgeMinutes: 60 });
      const r = liveCanaryPrepareBuyReport({ cwd: dir, now: () => T0 }, buyOpts());
      expect(r.exitCode).toBe(1);
      expect(r.text).toMatch(/approval is not active/);
      expect(r.text).toMatch(/approval-expired/);
    } finally {
      cleanup();
    }
  });

  it("refuses a STALE quote", () => {
    const { dir, cleanup } = workspace();
    try {
      writeBuyFixtures(dir, { quoteAgeMs: 60_000 });
      const r = liveCanaryPrepareBuyReport({ cwd: dir, now: () => T0 }, buyOpts());
      expect(r.exitCode).toBe(1);
      expect(r.text).toMatch(/STALE/);
    } finally {
      cleanup();
    }
  });

  it("refuses an EXCESSIVE spend (over the effective canary ceiling)", () => {
    const { dir, cleanup } = workspace();
    try {
      writeBuyFixtures(dir);
      const r = liveCanaryPrepareBuyReport({ cwd: dir, now: () => T0 }, buyOpts({ spendSol: "0.02" }));
      expect(r.exitCode).toBe(1);
      expect(r.text).toMatch(/exceeds the effective canary ceiling/);
    } finally {
      cleanup();
    }
  });

  it("refuses a DISABLED live policy", () => {
    const { dir, cleanup } = workspace();
    try {
      writeBuyFixtures(dir, { policyGreen: false });
      const r = liveCanaryPrepareBuyReport({ cwd: dir, now: () => T0 }, buyOpts());
      expect(r.exitCode).toBe(1);
      expect(r.text).toMatch(/live-disabled/);
    } finally {
      cleanup();
    }
  });

  it("refuses a REJECT risk report and the aggressive-paper-only profile", () => {
    const { dir, cleanup } = workspace();
    try {
      writeBuyFixtures(dir, { riskReject: true });
      const r = liveCanaryPrepareBuyReport({ cwd: dir, now: () => T0 }, buyOpts());
      expect(r.exitCode).toBe(1);
      expect(r.text).toMatch(/REJECT/);
      writeBuyFixtures(dir);
      const agg = liveCanaryPrepareBuyReport({ cwd: dir, now: () => T0 }, buyOpts({ profile: "aggressive-paper-only" }));
      expect(agg.exitCode).toBe(1);
      expect(agg.text).toMatch(/PAPER-ONLY/);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// live:canary:prepare-sell + reconcile-position
// ---------------------------------------------------------------------------

function writeSellFixtures(dir: string, opts: { quoteAgeMs?: number } = {}): void {
  const position = openPosition({ kind: "live_canary", mint: MINT_A, openedAt: "2026-07-02T11:00:00.000Z", entrySpendLamports: 5_000_000, tokenAmountRaw: "123456789" });
  writeFileSync(join(dir, "ledger.json"), JSON.stringify(ledgerOpen(buildLedger(), position)));
  writeFileSync(
    join(dir, "sell-quote.json"),
    JSON.stringify({
      provider: "jupiter-lite-api",
      inputMint: MINT_A,
      outputMint: WRAPPED_SOL_MINT,
      inAmountRaw: "123456789",
      outAmountRaw: "6000000",
      slippageBps: 100,
      priceImpactPct: 0.3,
      quotedAt: T0,
      ageMs: opts.quoteAgeMs ?? 1000,
      routeLabels: ["FakeDEX"],
    }),
  );
  writeFileSync(join(dir, "approval.json"), JSON.stringify(buildOperatorApproval({ operatorLabel: "myles", confirmPhrase: "I-APPROVE-ONE-CANARY-RECOMMENDATION", approvedAt: T0 })));
  writeFileSync(join(dir, "policy.json"), JSON.stringify(buildLivePolicy({ mode: "live_canary", liveEnabled: true, walletProvider: "phantom" })));
}

describe("live:canary:prepare-sell — refusal walls", () => {
  it("green path → review_ready with expected SOL out + ESTIMATED PnL, artifacts written", () => {
    const { dir, cleanup } = workspace();
    try {
      writeSellFixtures(dir);
      const r = liveCanaryPrepareSellReport(
        { cwd: dir, now: () => T0 },
        { ledgerPath: "ledger.json", mint: MINT_A, quotePath: "sell-quote.json", approvalPath: "approval.json", policyPath: "policy.json", outDir: "runs/sell", json: true },
      );
      expect(r.exitCode, r.text).toBe(0);
      const review = JSON.parse(readFileSync(join(dir, "runs/sell/sell-review.json"), "utf8"));
      expect(review.state).toBe("review_ready");
      expect(review.expectedSolOutLamports).toBe("6000000");
      expect(review.estimatedPnlLamports).toBe(1_000_000);
      expect(review.signed).toBe(false);
      expect(existsSync(join(dir, "runs/sell/sell-review.md"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("refuses an UNKNOWN position", () => {
    const { dir, cleanup } = workspace();
    try {
      writeSellFixtures(dir);
      const r = liveCanaryPrepareSellReport({ cwd: dir, now: () => T0 }, { ledgerPath: "ledger.json", mint: MINT_B, quotePath: "sell-quote.json", json: true });
      expect(r.exitCode).toBe(1);
      expect(r.text).toMatch(/no open position for mint/);
    } finally {
      cleanup();
    }
  });

  it("a STALE sell quote produces a BLOCKED review (exit 1)", () => {
    const { dir, cleanup } = workspace();
    try {
      writeSellFixtures(dir, { quoteAgeMs: 60_000 });
      const r = liveCanaryPrepareSellReport(
        { cwd: dir, now: () => T0 },
        { ledgerPath: "ledger.json", mint: MINT_A, quotePath: "sell-quote.json", approvalPath: "approval.json", policyPath: "policy.json", json: true },
      );
      expect(r.exitCode).toBe(1);
      const review = JSON.parse(r.text.split("\nwrote")[0] as string);
      expect(review.state).toBe("blocked");
      expect(review.blockingReasons).toContain("sell-quote-stale");
    } finally {
      cleanup();
    }
  });
});

describe("live:sniper:reconcile-position — unknown stays unknown", () => {
  it("refuses to run without an observation or an explicit --unknown", () => {
    const { dir, cleanup } = workspace();
    try {
      writeSellFixtures(dir);
      const r = liveSniperReconcilePositionReport({ cwd: dir, now: () => T0 }, { ledgerPath: "ledger.json", mint: MINT_A });
      expect(r.exitCode).toBe(1);
      expect(r.text).toMatch(/never invented/);
    } finally {
      cleanup();
    }
  });

  it("--unknown records an honest unknown verdict; a mismatch is called out", () => {
    const { dir, cleanup } = workspace();
    try {
      writeSellFixtures(dir);
      const unknown = liveSniperReconcilePositionReport({ cwd: dir, now: () => T0 }, { ledgerPath: "ledger.json", mint: MINT_A, unknown: true, json: true });
      expect(unknown.exitCode, unknown.text).toBe(0);
      expect(JSON.parse(unknown.text).verdict).toBe("unknown");
      const mismatch = liveSniperReconcilePositionReport(
        { cwd: dir, now: () => T0 },
        { ledgerPath: "ledger.json", mint: MINT_A, observedTokenAmountRaw: "1", observationSource: "phantom-ui", json: true },
      );
      expect(JSON.parse(mismatch.text).verdict).toBe("mismatch");
    } finally {
      cleanup();
    }
  });
});

describe("live:sniper:rank --require-ai — proof mode fails loud", () => {
  it("exits 1 when ANTHROPIC_API_KEY is missing (instead of the silent fallback)", async () => {
    const r = await liveSniperRankReport(
      { env: {} as NodeJS.ProcessEnv, now: () => T0 },
      { mints: [MINT_A], requireAi: true, json: true },
    );
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/--require-ai was set but the AI engine did not run/);
  });

  it("without --require-ai the same situation falls back safely (exit 0)", async () => {
    const r = await liveSniperRankReport({ env: {} as NodeJS.ProcessEnv, now: () => T0 }, { mints: [MINT_A], ai: true, json: true });
    expect(r.exitCode, r.text).toBe(0);
    const ranking = JSON.parse(r.text);
    expect(ranking.engine).toBe("deterministic-fallback");
    expect(ranking.caveats.join(" ")).toMatch(/ai-unavailable/);
  });

  it("exits 1 when the AI call itself fails under --require-ai", async () => {
    // The candidate needs clean risk to be ELIGIBLE — only then is the AI provider really invoked.
    const { dir, cleanup } = workspace();
    try {
      writeFileSync(join(dir, "risk.json"), JSON.stringify(CLEAN_RISK_REPORT));
      const r = await liveSniperRankReport(
        {
          cwd: dir,
          env: { ANTHROPIC_API_KEY: "test-key" } as NodeJS.ProcessEnv,
          now: () => T0,
          aiProvider: async () => {
            throw new Error("simulated outage");
          },
        },
        { mints: [MINT_A], riskPairs: [`${MINT_A}=risk.json`], requireAi: true, json: true },
      );
      expect(r.exitCode).toBe(1);
      expect(r.text).toMatch(/simulated outage/);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// S111 live:sniper:daemon --mode live — the autonomous loop over the REAL execution core (injected seams)
// ---------------------------------------------------------------------------

import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { LIVE_TRADING_ENV_FLAG, LIVE_TRADING_ENV_VALUE } from "@soulmaker/execution";
import type { MainnetRpcSeams } from "@soulmaker/live";
import type { SwapTransactionBuilder } from "@soulmaker/txbuilder";
import type { TxPreviewRpc } from "@soulmaker/txpreview";

const L_SIGNER = Keypair.generate();
const L_WALLET = L_SIGNER.publicKey.toBase58();
const L_BLOCKHASH = new PublicKey(Buffer.alloc(32, 3)).toBase58();
const L_SIG_BUY = "7".repeat(88);
const L_SIG_SELL = "8".repeat(88);
const L_ENV = { [LIVE_TRADING_ENV_FLAG]: LIVE_TRADING_ENV_VALUE, HOT_WALLET_FILE: "/fake/hot.keypair" };
const L_OPTS = { mode: "live", iUnderstandThisCanLoseRealMoney: true, wallet: L_WALLET, signerEnvVar: "HOT_WALLET_FILE", rpcUrl: "https://rpc.test", maxSpendSol: "0.005", maxOpenSolExposureSol: "0.01", maxOpenPositions: "2", maxTradesPerHour: "3", sessionLossCapSol: "0.02", slippageBps: "100", maxPriceImpactPct: "1", minSolReserveSol: "0.01", riskScoreCap: "50" };

function liveWorkspace(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "live-daemon-live-"));
  writeFileSync(join(dir, "soulmaker.config.json"), JSON.stringify({ mode: "PAPER", killSwitch: false, caps: { maxTradeSizeSol: 0.01, maxDailyLossSol: 0.05, maxOpenPositions: 2 }, phase7LiveTradingReady: true }));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function liveEnvelope(candidateMint: string): Record<string, unknown> {
  const message = new TransactionMessage({ payerKey: L_SIGNER.publicKey, recentBlockhash: L_BLOCKHASH, instructions: [SystemProgram.transfer({ fromPubkey: L_SIGNER.publicKey, toPubkey: L_SIGNER.publicKey, lamports: 1 })] }).compileToV0Message();
  return { schemaVersion: "txpreview.envelope.v1", network: "mainnet-beta", feePayerPublicKey: L_WALLET, txBase64: Buffer.from(new VersionedTransaction(message).serialize()).toString("base64"), builderId: "jupiter-swap-api", candidateMint, routeCaveats: [], constraints: { maxSpendLamports: "5000000", slippageBps: 100 }, quotedAt: new Date().toISOString(), unsigned: true, neverSigned: true, phase7LiveTradingReady: false };
}

interface LiveWorld { sent: Uint8Array[]; sigs: string[]; status: unknown; sol: number; token: string; holdings: Array<{ mint: string; amountRaw: string; program: string }>; simOk: boolean }

function liveSeams(w: LiveWorld, clock: () => string) {
  const swapBuilder: SwapTransactionBuilder = {
    builderId: "jupiter-swap-api", endpointHost: "jup.test",
    build: async (req) => ({ built: true, envelope: { ...liveEnvelope(req.candidateMint as string), quotedAt: clock() } as never, quoteFacts: { inAmountRaw: req.amountRaw as string, outAmountRaw: "777", priceImpactPct: "0.1", contextSlot: 1, quotedAt: clock() }, txFacts: {} as never }),
  };
  const txPreview: TxPreviewRpc = { endpointHost: "rpc.test", rpc: { simulateTransaction: async () => ({ context: { slot: 5 }, value: w.simOk ? { err: null, logs: [], unitsConsumed: 1000 } : { err: { InstructionError: [0, "Custom"] }, logs: [], unitsConsumed: 0 } }) as never } };
  const rpc: MainnetRpcSeams & { balance: MainnetRpcSeams["balance"] & { listTokenHoldings: () => Promise<LiveWorld["holdings"]> } } = {
    endpointHost: "rpc.test",
    send: { getLatestBlockhash: async () => ({ blockhash: L_BLOCKHASH }), sendRawTransaction: async (b) => { w.sent.push(b); const s = w.sigs[w.sent.length - 1] ?? L_SIG_BUY; return s; } },
    confirm: { getSignatureStatuses: async () => ({ value: [w.status as never] }) },
    balance: { getBalanceLamports: async () => w.sol, getTokenBalanceRaw: async () => w.token, listTokenHoldings: async () => w.holdings },
  };
  return { swapBuilder, txPreview, createMainnetRpc: () => rpc, readFile: () => JSON.stringify(Array.from(L_SIGNER.secretKey)) };
}

const L_CONFIRMED = { slot: 12, err: null, confirmationStatus: "confirmed" };

describe("live:sniper:daemon --mode live (S111) — autonomous loop over the real execution core", () => {
  it("full lifecycle: reconcile → candidate → confirmed BUY → live position with signature → mark → take-profit → confirmed SELL → closed with realized PnL; status.json written", async () => {
    const { dir, cleanup } = liveWorkspace();
    try {
      const w: LiveWorld = { sent: [], sigs: [L_SIG_BUY, L_SIG_SELL], status: L_CONFIRMED, sol: 1e9, token: "0", holdings: [], simOk: true };
      const clock = fakeClock();
      let sellCall = 0;
      const ctx = {
        cwd: dir, env: L_ENV, now: clock, sleep: async () => {}, registerInterrupt: () => () => {},
        candidateSources: [fakeSource("fake-feed", () => observedResult("fake-feed", [observation(MINT_A)]))],
        quoteProvider: fakeQuotes({ clock, sellOutRaw: () => (sellCall++ === 0 ? "5100000" : "8000000") }), // +60% → take-profit
        riskFetcher: async () => CLEAN_RISK_REPORT,
        ...liveSeams(w, clock),
      };
      // Balance/token reads: the buy sees token 0→777; after the sell, SOL is up and token is 0.
      const rpcSeams = ctx.createMainnetRpc();
      let reads = 0;
      rpcSeams.balance.getTokenBalanceRaw = async () => (w.sent.length === 0 ? "0" : w.sent.length === 1 ? "777" : "0");
      rpcSeams.balance.getBalanceLamports = async () => { reads++; return w.sent.length < 2 ? 1e9 - (w.sent.length === 1 ? 5_005_000 : 0) : 1e9 + 2_900_000; };

      const r = await liveSniperDaemonReport(ctx, { ...L_OPTS, outDir: "runs/live", maxLoops: "3", json: true });
      expect(r.exitCode, r.text).toBe(0);
      const ledger = JSON.parse(readFileSync(join(dir, "runs/live/ledger.json"), "utf8"));
      expect(ledger.positions).toHaveLength(1);
      const p = ledger.positions[0];
      expect(p.kind).toBe("live");
      expect(p.entrySignature).toBe(L_SIG_BUY);
      expect(p.status).toBe("closed");
      expect(p.close.closeKind).toBe("live-auto");
      expect(p.close.reason).toBe("take-profit");
      expect(p.close.signature).toBe(L_SIG_SELL);
      expect(p.close.pnlLamports).toBeGreaterThan(0);
      expect(w.sent).toHaveLength(2);
      // Intents were persisted and are all done; audit journal carries both executions; status is live+armed.
      const intents = JSON.parse(readFileSync(join(dir, "runs/live/intents.json"), "utf8"));
      expect(intents.every((i: { state: string }) => i.state === "done")).toBe(true);
      const audit = readFileSync(join(dir, "runs/live/audit.jsonl"), "utf8");
      expect(audit).toContain(L_SIG_BUY);
      expect(audit).toContain(L_SIG_SELL);
      expect(audit).not.toContain(JSON.stringify(Array.from(L_SIGNER.secretKey)));
      const status = JSON.parse(readFileSync(join(dir, "runs/live/status.json"), "utf8"));
      expect(status.daemon.mode).toBe("live");
      expect(status.daemon.armed).toBe(true);
      expect(status.daemon.running).toBe(false);
      expect(status.wallet.publicKey).toBe(L_WALLET);
      expect(status.execution.lastSignature).toBe(L_SIG_SELL);
      expect(status.positions.recentClosed[0].realizedPnlLamports).toBeGreaterThan(0);
      expect(status.reconciliation.tradingAllowed).toBe(true);
      expect(existsSync(join(dir, "runs/live/reconcile.json"))).toBe(true);
      expect(reads).toBeGreaterThan(0);
    } finally {
      cleanup();
    }
  });

  it("a failed simulation → refused entry, nothing sent, no position; the rejection reason is visible in status", async () => {
    const { dir, cleanup } = liveWorkspace();
    try {
      const w: LiveWorld = { sent: [], sigs: [], status: L_CONFIRMED, sol: 1e9, token: "0", holdings: [], simOk: false };
      const clock = fakeClock();
      const ctx = { cwd: dir, env: L_ENV, now: clock, sleep: async () => {}, registerInterrupt: () => () => {}, candidateSources: [fakeSource("fake-feed", () => observedResult("fake-feed", [observation(MINT_A)]))], quoteProvider: fakeQuotes({ clock }), riskFetcher: async () => CLEAN_RISK_REPORT, ...liveSeams(w, clock) };
      const r = await liveSniperDaemonReport(ctx, { ...L_OPTS, outDir: "runs/simfail", maxLoops: "1", json: true });
      expect(r.exitCode, r.text).toBe(0);
      expect(w.sent).toHaveLength(0);
      const ledger = JSON.parse(readFileSync(join(dir, "runs/simfail/ledger.json"), "utf8"));
      expect(ledger.positions).toHaveLength(0);
      const status = JSON.parse(readFileSync(join(dir, "runs/simfail/status.json"), "utf8"));
      expect(status.lastDecision.verdict).toBe("rejected");
      expect(status.lastDecision.reasons.join(" ")).toMatch(/simulation/);
    } finally {
      cleanup();
    }
  });

  it("SAFE STOP (.soulmaker-no-entry) blocks entries but a fired exit still SELLS; HARD STOP (emergency stop) sends nothing", async () => {
    const { dir, cleanup } = liveWorkspace();
    try {
      // Session 1: buy under normal state (1 loop).
      const w: LiveWorld = { sent: [], sigs: [L_SIG_BUY, L_SIG_SELL], status: L_CONFIRMED, sol: 1e9, token: "0", holdings: [], simOk: true };
      const clock = fakeClock();
      const seams = liveSeams(w, clock);
      const rpcSeams = seams.createMainnetRpc();
      rpcSeams.balance.getTokenBalanceRaw = async () => (w.sent.length === 0 ? "0" : w.sent.length === 1 ? "777" : "0");
      const base = { cwd: dir, env: L_ENV, now: clock, sleep: async () => {}, registerInterrupt: () => () => {}, candidateSources: [fakeSource("fake-feed", () => observedResult("fake-feed", [observation(MINT_A)]))], riskFetcher: async () => CLEAN_RISK_REPORT, ...seams };
      await liveSniperDaemonReport({ ...base, quoteProvider: fakeQuotes({ clock, sellOutRaw: () => "5100000" }) }, { ...L_OPTS, outDir: "runs/stops", maxLoops: "1", json: true });
      expect(w.sent).toHaveLength(1);
      expect(JSON.parse(readFileSync(join(dir, "runs/stops/ledger.json"), "utf8")).positions[0].status).toBe("open");

      // Session 2 (restart, SAFE STOP): reconcile finds the open position held on chain; entries blocked; +60% mark fires take-profit → SELL sends.
      writeFileSync(join(dir, ".soulmaker-no-entry"), "");
      w.holdings = [{ mint: MINT_A, amountRaw: "777", program: "spl-token" }];
      const two = await liveSniperDaemonReport({ ...base, candidateSources: [fakeSource("fake-feed", () => observedResult("fake-feed", [observation(MINT_B)]))], quoteProvider: fakeQuotes({ clock, sellOutRaw: () => "8000000" }) }, { ...L_OPTS, outDir: "runs/stops", maxLoops: "1", json: true, force: true });
      expect(two.exitCode, two.text).toBe(0);
      expect(w.sent).toHaveLength(2);
      const ledger2 = JSON.parse(readFileSync(join(dir, "runs/stops/ledger.json"), "utf8"));
      expect(ledger2.positions).toHaveLength(1); // no MINT_B entry under SAFE STOP
      expect(ledger2.positions[0].status).toBe("closed");
      const status2 = JSON.parse(readFileSync(join(dir, "runs/stops/status.json"), "utf8"));
      expect(status2.stops.safeStop).toBe(true);
      expect(status2.stops.hardStop).toBe(false);
      rmSync(join(dir, ".soulmaker-no-entry"));

      // Session 3 (HARD STOP): a fresh candidate and a fresh open position → NOTHING sends.
      w.holdings = [];
      writeFileSync(join(dir, ".soulmaker-emergency-stop"), "");
      const three = await liveSniperDaemonReport({ ...base, quoteProvider: fakeQuotes({ clock, sellOutRaw: () => "8000000" }) }, { ...L_OPTS, outDir: "runs/hard", maxLoops: "1", json: true });
      expect(three.exitCode, three.text).toBe(0);
      expect(w.sent).toHaveLength(2);
      const status3 = JSON.parse(readFileSync(join(dir, "runs/hard/status.json"), "utf8"));
      expect(status3.stops.hardStop).toBe(true);
      expect(JSON.parse(readFileSync(join(dir, "runs/hard/ledger.json"), "utf8")).positions).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it("startup FAILS CLOSED when reconciliation blocks (ledger open, chain holds 0, no journaled sell)", async () => {
    const { dir, cleanup } = liveWorkspace();
    try {
      const w: LiveWorld = { sent: [], sigs: [], status: L_CONFIRMED, sol: 1e9, token: "0", holdings: [], simOk: true };
      const clock = fakeClock();
      mkdirSync(join(dir, "runs/blocked"), { recursive: true });
      const open = openPosition({ kind: "live", mint: MINT_A, openedAt: new Date(T0_MS - 60_000).toISOString(), entrySpendLamports: 5_000_000, tokenAmountRaw: "777", entrySignature: L_SIG_BUY });
      writeFileSync(join(dir, "runs/blocked/ledger.json"), JSON.stringify(buildLedger([open])));
      const ctx = { cwd: dir, env: L_ENV, now: clock, sleep: async () => {}, registerInterrupt: () => () => {}, candidateSources: [fakeSource("fake-feed", () => observedResult("fake-feed", [observation(MINT_B)]))], quoteProvider: fakeQuotes({ clock }), riskFetcher: async () => CLEAN_RISK_REPORT, ...liveSeams(w, clock) };
      const r = await liveSniperDaemonReport(ctx, { ...L_OPTS, outDir: "runs/blocked", maxLoops: "1", json: true, force: true });
      expect(r.exitCode).toBe(1);
      expect(r.text).toMatch(/reconciliation BLOCKED/);
      expect(r.text).toMatch(/0 on chain/);
      expect(w.sent).toHaveLength(0);
      // The ledger was NOT mutated — the position is still there for the operator.
      expect(JSON.parse(readFileSync(join(dir, "runs/blocked/ledger.json"), "utf8")).positions[0].status).toBe("open");
    } finally {
      cleanup();
    }
  });
});
