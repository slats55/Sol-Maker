import { describe, it, expect } from "vitest";
import { buildTokenRiskReport } from "@soulmaker/risk";
import { runPaperSession } from "./run.js";
import {
  serializeEvents,
  parseJournal,
  reduceJournal,
  deriveStateFromJournalText,
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

describe("deriveStateFromJournalText", () => {
  it("derives the same state as parseJournal + reduceJournal for a clean journal", () => {
    const run = runPaperSession({
      caps: CAPS,
      candidates: [cleanCandidate(A, 100)],
      prices: [price(A, 2)],
      now: at,
    });
    const text = serializeEvents(run.events);
    const derived = deriveStateFromJournalText(text);
    const expected = reduceJournal(parseJournal(text).events);
    expect(derived.parseErrors).toEqual([]);
    expect(derived.fillErrors).toEqual([]);
    expect(JSON.stringify(derived.state)).toBe(JSON.stringify(expected));
    expect(derived.state.positions[A]?.quantity).toBe(50);
  });

  it("an empty or blank journal yields the empty initial state with no errors", () => {
    const derived = deriveStateFromJournalText("   \n\n  ");
    expect(derived.parseErrors).toEqual([]);
    expect(derived.fillErrors).toEqual([]);
    expect(derived.events).toEqual([]);
    expect(derived.state.positions).toEqual({});
    expect(derived.state.realizedPnlUsd).toBe(0);
  });

  it("reports malformed (unparseable) lines as parseErrors", () => {
    const text = [
      '{"type":"RUN_STARTED","at":"x","caps":{},"note":"n"}',
      "{not json",
    ].join("\n");
    const derived = deriveStateFromJournalText(text);
    expect(derived.parseErrors.length).toBe(1);
    expect(derived.parseErrors[0]?.line).toBe(2);
  });

  it("reports an invalid fill payload as a fillError WITHOUT corrupting state", () => {
    // The event line parses (known type + string `at`), but the fill is unusable.
    const text = [
      '{"type":"PAPER_BUY_FILLED","at":"x","fill":{"side":"BUY","mint":"M","quantity":"oops","priceUsd":1,"notionalUsd":1,"feeUsd":0,"filledAt":"x"}}',
    ].join("\n");
    const derived = deriveStateFromJournalText(text);
    expect(derived.parseErrors).toEqual([]);
    expect(derived.fillErrors.length).toBe(1);
    expect(derived.fillErrors[0]?.reason).toMatch(/quantity/);
    // The bad fill is excluded, so the reconstructed state is the empty state.
    expect(derived.state.positions).toEqual({});
  });

  it("rejects a fill whose side contradicts its event type", () => {
    const text =
      '{"type":"PAPER_SELL_FILLED","at":"x","realizedPnlUsd":0,"fill":{"side":"BUY","mint":"M","quantity":1,"priceUsd":1,"notionalUsd":1,"feeUsd":0,"filledAt":"x"}}';
    const derived = deriveStateFromJournalText(text);
    expect(derived.fillErrors.length).toBe(1);
    expect(derived.fillErrors[0]?.reason).toMatch(/side/);
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
