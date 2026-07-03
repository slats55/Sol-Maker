/**
 * Sprint 109 — the continuous PAPER daemon + hardened canary buy/sell surface.
 *
 * Every network seam is injected (fake feeds, fake quotes, fake risk) so these tests prove the
 * ORCHESTRATION exactly: cross-loop dedupe, provider-failure survival, graceful-interrupt summary,
 * the deterministic paper-entry rule, exit application, honest performance reporting, and every
 * refusal wall on the live-gated buy/sell prepare paths.
 */

import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  it("refuses any non-paper mode and a missing out-dir", async () => {
    const { dir, cleanup } = workspace();
    try {
      const live = await liveSniperDaemonReport(daemonCtx(dir), { mode: "live", outDir: "runs/x" });
      expect(live.exitCode).toBe(1);
      expect(live.text).toMatch(/no live mode/);
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
