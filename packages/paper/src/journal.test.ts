import { describe, it, expect } from "vitest";
import { buildTokenRiskReport } from "@soulmaker/risk";
import { runPaperSession } from "./run.js";
import {
  serializeEvents,
  parseJournal,
  reduceJournal,
  lastRunSummary,
} from "./journal.js";
import type { PaperCandidate, PaperPricePoint } from "./types.js";

const A = "So11111111111111111111111111111111111111112";
const FIXED = "2026-06-05T12:00:00.000Z";
const at = () => FIXED;

function cleanCandidate(mint: string, sizeUsd: number): PaperCandidate {
  return {
    mint,
    proposedSizeUsd: sizeUsd,
    riskReport: buildTokenRiskReport(
      {
        mint,
        decimals: 6,
        supplyRaw: "1000000",
        uiSupply: 1,
        mintAuthorityPresent: false,
        freezeAuthorityPresent: false,
        isInitialized: true,
        programLabel: "spl-token",
      },
      { now: at },
    ),
  };
}

const price = (mint: string, priceUsd: number): PaperPricePoint => ({
  mint,
  priceUsd,
  observedAt: FIXED,
  source: "injected-fixture",
});

const CAPS = {
  maxTradeSizeUsd: 1000,
  maxDailyLossUsd: 1000,
  maxOpenPositions: 10,
  killSwitch: false,
};

describe("serializeEvents / parseJournal", () => {
  it("round-trips events through JSONL", () => {
    const run = runPaperSession({
      caps: CAPS,
      candidates: [cleanCandidate(A, 100)],
      prices: [price(A, 2), price(A, 3)],
      takeProfitPct: 40,
      now: at,
    });
    const text = serializeEvents(run.events);
    expect(text.endsWith("\n")).toBe(true);
    const { events, errors } = parseJournal(text);
    expect(errors).toEqual([]);
    expect(events.length).toBe(run.events.length);
    expect(JSON.stringify(events)).toBe(JSON.stringify(run.events));
  });

  it("skips blank lines and reports malformed lines without losing good ones", () => {
    const good = runPaperSession({
      caps: CAPS,
      candidates: [cleanCandidate(A, 100)],
      prices: [price(A, 2)],
      now: at,
    });
    const text = [
      "",
      serializeEvents(good.events).trimEnd(),
      "{not valid json",
      '{"type":"NONSENSE","at":"x"}',
      '{"at":"x"}',
      "   ",
    ].join("\n");
    const { events, errors } = parseJournal(text);
    expect(events.length).toBe(good.events.length); // good events preserved
    expect(errors.length).toBe(3); // bad json, unknown type, missing type
  });
});

describe("reduceJournal", () => {
  it("reconstructs positions and realized PnL from fill events", () => {
    const run = runPaperSession({
      caps: CAPS,
      candidates: [cleanCandidate(A, 100)],
      prices: [price(A, 2), price(A, 3)],
      takeProfitPct: 40, // buy @2, TP sell @3 → realized +50, position closed
      now: at,
    });
    const { events } = parseJournal(serializeEvents(run.events));
    const state = reduceJournal(events);
    expect(state.realizedPnlUsd).toBe(50);
    expect(state.closedTradeCount).toBe(1);
    expect(state.positions[A]).toBeUndefined();
  });

  it("reconstructs an open position when there is no exit", () => {
    const run = runPaperSession({
      caps: CAPS,
      candidates: [cleanCandidate(A, 100)],
      prices: [price(A, 2)],
      now: at,
    });
    const state = reduceJournal(parseJournal(serializeEvents(run.events)).events);
    expect(state.positions[A]?.quantity).toBe(50);
    expect(state.realizedPnlUsd).toBe(0);
  });

  it("is append-only safe: replaying a superset never mutates earlier results", () => {
    const run1 = runPaperSession({
      caps: CAPS,
      candidates: [cleanCandidate(A, 100)],
      prices: [price(A, 2)],
      now: at,
    });
    const events1 = parseJournal(serializeEvents(run1.events)).events;
    const stateA = reduceJournal(events1);
    // Append more events (a second buy) and re-reduce; the first fill is unchanged.
    const run2 = runPaperSession({
      caps: CAPS,
      candidates: [cleanCandidate(A, 100)],
      prices: [price(A, 4)],
      now: at,
    });
    const combined = [...events1, ...parseJournal(serializeEvents(run2.events)).events];
    const stateB = reduceJournal(combined);
    expect(stateA.positions[A]?.quantity).toBe(50); // unchanged
    expect(stateB.positions[A]?.quantity).toBe(75); // 50 @2 + 25 @4
  });
});

describe("lastRunSummary", () => {
  it("returns the most recent RUN_COMPLETED summary", () => {
    const run = runPaperSession({
      caps: CAPS,
      candidates: [cleanCandidate(A, 100)],
      prices: [price(A, 2)],
      now: at,
    });
    const summary = lastRunSummary(parseJournal(serializeEvents(run.events)).events);
    expect(summary?.buyCount).toBe(1);
  });
});
