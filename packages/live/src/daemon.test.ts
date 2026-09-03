import { describe, it, expect } from "vitest";

import {
  DAEMON_BACKOFF_BASE_MS,
  DAEMON_BACKOFF_MAX_MS,
  buildDaemonSummary,
  completeLoop,
  createDaemonState,
  dedupeAcrossLoops,
  providerAllowed,
  recordNoTradeReasons,
  recordProviderOutcome,
  riskCacheGet,
  riskCachePut,
  validateDaemonState,
} from "./daemon.js";
import { normalizeManualMint } from "./discovery.js";
import type { SniperCandidateRisk } from "./discovery.js";

const MINT_A = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MINT_B = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const AT = "2026-07-02T04:00:00.000Z";

const candidate = (mint: string) => normalizeManualMint({ mint }, { discoveredAt: AT });

const RISK: SniperCandidateRisk = { score: 5, decision: "ACCEPT", criticalFlagCount: 0, freezeAuthorityPresent: false, mintAuthorityPresent: false };

describe("daemon state — mode set is CLOSED to paper | live (S111)", () => {
  it("accepts paper (default) and live; refuses any unknown mode at creation and on resume", () => {
    expect(createDaemonState({ startedAt: AT, profileName: "balanced" }).mode).toBe("paper");
    expect(createDaemonState({ startedAt: AT, profileName: "balanced", mode: "live" }).mode).toBe("live");
    expect(() => createDaemonState({ startedAt: AT, profileName: "balanced", mode: "mainnet" })).toThrow(/paper\|live/);
    const state = createDaemonState({ startedAt: AT, profileName: "balanced" });
    const tampered = JSON.parse(JSON.stringify(state));
    tampered.mode = "yolo";
    expect(() => validateDaemonState(tampered)).toThrow(/paper\|live/);
  });

  it("round-trips through validateDaemonState (closed schema)", () => {
    let state = createDaemonState({ startedAt: AT, profileName: "balanced" });
    state = dedupeAcrossLoops(state, [candidate(MINT_A)]).state;
    state = riskCachePut(state, MINT_A, RISK, 1_000);
    state = recordProviderOutcome(state, "jupiter-recent-tokens", "observed", 1_000);
    state = completeLoop(state, AT);
    const revived = validateDaemonState(JSON.parse(JSON.stringify(state)));
    expect(revived.seenMints).toEqual([MINT_A]);
    expect(revived.totals.loops).toBe(1);
    const extra = { ...JSON.parse(JSON.stringify(state)), surprise: 1 };
    expect(() => validateDaemonState(extra)).toThrow(/CLOSED/);
  });
});

describe("daemon state — cross-loop dedupe", () => {
  it("a mint seen in loop 1 is a duplicate in loop 2, and totals stay honest", () => {
    let state = createDaemonState({ startedAt: AT, profileName: "balanced" });
    const loop1 = dedupeAcrossLoops(state, [candidate(MINT_A), candidate(MINT_B)]);
    state = loop1.state;
    expect(loop1.fresh.map((c) => c.mint)).toEqual([MINT_A, MINT_B]);
    const loop2 = dedupeAcrossLoops(state, [candidate(MINT_A), candidate(MINT_B)]);
    expect(loop2.fresh).toEqual([]);
    expect(loop2.duplicates).toHaveLength(2);
    expect(loop2.state.totals.candidatesSeen).toBe(4);
    expect(loop2.state.totals.newCandidates).toBe(2);
    expect(loop2.state.totals.duplicatesSkipped).toBe(2);
  });
});

describe("daemon state — risk cache TTL", () => {
  it("hits within TTL, misses after TTL, and never serves a future-dated entry", () => {
    let state = createDaemonState({ startedAt: AT, profileName: "balanced" });
    state = riskCachePut(state, MINT_A, RISK, 10_000);
    expect(riskCacheGet(state, MINT_A, 10_000 + 1, 60_000)).toEqual(RISK);
    expect(riskCacheGet(state, MINT_A, 10_000 + 60_001, 60_000)).toBeNull();
    expect(riskCacheGet(state, MINT_A, 9_999, 60_000)).toBeNull(); // clock went backwards → miss
    expect(riskCacheGet(state, MINT_B, 10_001, 60_000)).toBeNull();
  });
});

describe("daemon state — provider health + backoff", () => {
  it("a failing provider backs off exponentially and recovers on success", () => {
    let state = createDaemonState({ startedAt: AT, profileName: "balanced" });
    state = recordProviderOutcome(state, "feed", "blocked", 0, "HTTP 429");
    expect(providerAllowed(state, "feed", DAEMON_BACKOFF_BASE_MS - 1)).toBe(false);
    expect(providerAllowed(state, "feed", DAEMON_BACKOFF_BASE_MS)).toBe(true);
    state = recordProviderOutcome(state, "feed", "blocked", DAEMON_BACKOFF_BASE_MS);
    const h = state.providerHealth.find((x) => x.provider === "feed")!;
    expect(h.consecutiveFailures).toBe(2);
    expect(h.backoffUntilMs).toBe(DAEMON_BACKOFF_BASE_MS + DAEMON_BACKOFF_BASE_MS * 2);
    state = recordProviderOutcome(state, "feed", "observed", 999_999);
    const recovered = state.providerHealth.find((x) => x.provider === "feed")!;
    expect(recovered.consecutiveFailures).toBe(0);
    expect(recovered.backoffUntilMs).toBe(0);
    expect(state.totals.providerFailures).toBe(2);
  });

  it("backoff is capped", () => {
    let state = createDaemonState({ startedAt: AT, profileName: "balanced" });
    for (let i = 0; i < 12; i++) state = recordProviderOutcome(state, "feed", "unavailable", 0);
    const h = state.providerHealth.find((x) => x.provider === "feed")!;
    expect(h.backoffUntilMs).toBeLessThanOrEqual(DAEMON_BACKOFF_MAX_MS);
  });

  it("one bad provider never blocks another", () => {
    let state = createDaemonState({ startedAt: AT, profileName: "balanced" });
    state = recordProviderOutcome(state, "bad", "error", 0);
    expect(providerAllowed(state, "good", 1)).toBe(true);
  });
});

describe("daemon state — summary", () => {
  it("folds totals, no-trade reasons and provider health into an honest summary", () => {
    let state = createDaemonState({ startedAt: AT, profileName: "conservative" });
    state = recordNoTradeReasons(state, ["risk-missing", "risk-missing", "quote-stale"]);
    state = recordProviderOutcome(state, "feed", "observed", 0);
    state = completeLoop(state, AT);
    const summary = buildDaemonSummary(state, {
      endedAt: "2026-07-02T04:30:00.000Z",
      endedBy: "operator-interrupt",
      positions: { open: 1, closed: 2, realizedPnlKnownLamports: -1000, closedPnlUnknown: 1 },
    });
    expect(summary.endedBy).toBe("operator-interrupt");
    expect(summary.noTradeReasons["risk-missing"]).toBe(2);
    expect(summary.positions.realizedPnlKnownLamports).toBe(-1000);
    expect(summary.daemonNeverSends).toBe(true);
    expect(summary.caveats.join(" ")).toMatch(/PAPER/);
  });
});
