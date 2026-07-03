import { describe, expect, it } from "vitest";

import {
  EXIT_POLICY_DEFAULTS,
  LivePositionError,
  POSITION_SPEND_CEILING_LAMPORTS,
  applyMark,
  buildExitPolicy,
  buildLedger,
  closePosition,
  evaluateExitRules,
  ledgerOpen,
  ledgerReplace,
  openPosition,
  validateExitPolicy,
  validateLedger,
} from "./position.js";
import type { LivePosition } from "./position.js";

const MINT = "So11111111111111111111111111111111111111112";
const MINT2 = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const T0 = "2026-06-18T12:00:00.000Z";
const T0_MS = Date.parse(T0);
const ENTRY = 5_000_000; // 0.005 SOL

function open(over: Partial<Parameters<typeof openPosition>[0]> = {}): LivePosition {
  return openPosition({ kind: "paper", mint: MINT, symbol: "WSOL", openedAt: T0, entrySpendLamports: ENTRY, ...over });
}

function mark(p: LivePosition, valueLamports: number, atOffsetMs = 60_000): LivePosition {
  return applyMark(p, { valueLamports, atMs: T0_MS + atOffsetMs, source: "jupiter" });
}

const policy = buildExitPolicy(); // SL 20%, TP 50%, trail 15%, hold 30min

describe("position — open", () => {
  it("opens with a deterministic idempotency key and pinned honesty literals", () => {
    const p = open();
    expect(p.positionId).toBe(`paper:${MINT}:${T0}`);
    expect(p.status).toBe("open");
    expect(p.peakValueLamports).toBe(ENTRY);
    expect(p.paperPositionNeverHeldFunds).toBe(true);
    expect(p.notProfitabilityClaim).toBe(true);
  });

  it("refuses a spend over the position ceiling — PAPER TOO (parity, not fantasy)", () => {
    expect(() => open({ entrySpendLamports: POSITION_SPEND_CEILING_LAMPORTS + 1 })).toThrow(/ceiling/);
    expect(open({ entrySpendLamports: POSITION_SPEND_CEILING_LAMPORTS }).entrySpendLamports).toBe(POSITION_SPEND_CEILING_LAMPORTS);
  });

  it("refuses an invalid mint (never key material) and a non-positive spend", () => {
    expect(() => open({ mint: "5".repeat(88) })).toThrow(LivePositionError);
    expect(() => open({ entrySpendLamports: 0 })).toThrow(LivePositionError);
    expect(() => open({ entrySpendLamports: 1.5 })).toThrow(LivePositionError);
  });

  it("a live_canary position does not claim paper innocence", () => {
    expect(open({ kind: "live_canary" }).paperPositionNeverHeldFunds).toBe(false);
  });
});

describe("position — marks", () => {
  it("the peak ratchets up and never down", () => {
    let p = mark(open(), 10_000_000);
    expect(p.peakValueLamports).toBe(10_000_000);
    p = mark(p, 6_000_000, 120_000);
    expect(p.peakValueLamports).toBe(10_000_000);
    expect(p.lastMark?.valueLamports).toBe(6_000_000);
  });

  it("cannot mark a closed position", () => {
    const closed = closePosition({ position: open(), closedAt: T0, reason: "operator-manual", closeKind: "paper-auto" });
    expect(() => mark(closed, 1_000_000)).toThrow(/closed/);
  });
});

describe("exit rules — the closed reason set fires deterministically", () => {
  it("holds when nothing fired", () => {
    const d = evaluateExitRules({ position: mark(open(), ENTRY), policy, nowMs: T0_MS + 60_000 });
    expect(d.shouldExit).toBe(false);
    expect(d.reason).toBeNull();
    expect(d.unrealizedPnlPct).toBe(0);
  });

  it("stop-loss fires at/below entry - stopLossPct", () => {
    const d = evaluateExitRules({ position: mark(open(), 4_000_000), policy, nowMs: T0_MS + 60_000 }); // -20%
    expect(d.shouldExit).toBe(true);
    expect(d.reason).toBe("stop-loss");
    expect(d.unrealizedPnlPct).toBe(-20);
  });

  it("take-profit fires at/above entry + takeProfitPct", () => {
    const d = evaluateExitRules({ position: mark(open(), 7_500_000), policy, nowMs: T0_MS + 60_000 }); // +50%
    expect(d.shouldExit).toBe(true);
    expect(d.reason).toBe("take-profit");
  });

  it("trailing stop fires on a fall from the PEAK while still above entry (not a stop-loss)", () => {
    let p = mark(open(), 10_000_000); // peak = 2x entry
    p = mark(p, 8_400_000, 120_000); // 16% below peak, +68% vs entry
    const d = evaluateExitRules({ position: p, policy, nowMs: T0_MS + 180_000 });
    expect(d.shouldExit).toBe(true);
    expect(d.reason).toBe("trailing-stop");
  });

  it("trailing stop is disabled when null (same fall that would trip it, still below take-profit)", () => {
    // Peak 2x entry, then fall to +44% vs entry: 28% below peak (trips a 15% trail), below the 50% TP.
    let p = mark(open(), 10_000_000);
    p = mark(p, 7_200_000, 120_000);
    expect(evaluateExitRules({ position: p, policy, nowMs: T0_MS + 180_000 }).reason).toBe("trailing-stop");
    const noTrail = buildExitPolicy({ trailingStopPct: null });
    const d = evaluateExitRules({ position: p, policy: noTrail, nowMs: T0_MS + 180_000 });
    expect(d.shouldExit).toBe(false);
  });

  it("time-exit fires after maxHoldMs even with a healthy price", () => {
    const d = evaluateExitRules({ position: mark(open(), ENTRY + 1_000), policy, nowMs: T0_MS + EXIT_POLICY_DEFAULTS.maxHoldMs });
    expect(d.shouldExit).toBe(true);
    expect(d.reason).toBe("time-exit");
  });

  it("without a mark, price rules are skipped HONESTLY; time still applies", () => {
    const early = evaluateExitRules({ position: open(), policy, nowMs: T0_MS + 60_000 });
    expect(early.shouldExit).toBe(false);
    expect(early.markUnavailable).toBe(true);
    expect(early.unrealizedPnlPct).toBeNull();
    const late = evaluateExitRules({ position: open(), policy, nowMs: T0_MS + EXIT_POLICY_DEFAULTS.maxHoldMs + 1 });
    expect(late.reason).toBe("time-exit");
  });

  it("emergency and kill switch outrank every price rule", () => {
    const winning = mark(open(), 9_000_000);
    expect(evaluateExitRules({ position: winning, policy, nowMs: T0_MS + 1, emergency: true }).reason).toBe("emergency");
    expect(evaluateExitRules({ position: winning, policy, nowMs: T0_MS + 1, killSwitch: true }).reason).toBe("kill-switch");
  });

  it("a live position's exit is flagged as a RECOMMENDATION (the human sells in Phantom)", () => {
    const d = evaluateExitRules({ position: mark(open({ kind: "live_canary" }), 4_000_000), policy, nowMs: T0_MS + 1 });
    expect(d.shouldExit).toBe(true);
    expect(d.exitIsRecommendationOnly).toBe(true);
    expect(evaluateExitRules({ position: mark(open(), 4_000_000), policy, nowMs: T0_MS + 1 }).exitIsRecommendationOnly).toBe(false);
  });
});

describe("exit policy — bounds are refused, not clamped", () => {
  it("refuses a stop that can never fire and an unbounded hold", () => {
    expect(() => buildExitPolicy({ stopLossPct: 91 })).toThrow(/never fire/);
    expect(() => buildExitPolicy({ stopLossPct: 0 })).toThrow(LivePositionError);
    expect(() => buildExitPolicy({ maxHoldMs: 86_400_001 })).toThrow(/time-boxed/);
    expect(() => buildExitPolicy({ maxHoldMs: 5_000 })).toThrow(LivePositionError);
  });

  it("validate round-trips and refuses unknown fields", () => {
    const p = buildExitPolicy({ stopLossPct: 10 });
    expect(validateExitPolicy(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(() => validateExitPolicy({ ...p, autoSell: true })).toThrow(/unknown field/);
  });
});

describe("close — paper/live parity with an honest wall between them", () => {
  it("paper positions may auto-close; PnL is computed only when a value is known", () => {
    const closed = closePosition({ position: mark(open(), 4_000_000), closedAt: T0, reason: "stop-loss", closeKind: "paper-auto", valueLamports: 4_000_000 });
    expect(closed.status).toBe("closed");
    expect(closed.close?.pnlLamports).toBe(-1_000_000);
    const unknown = closePosition({ position: open(), closedAt: T0, reason: "time-exit", closeKind: "paper-auto" });
    expect(unknown.close?.pnlLamports).toBeNull();
  });

  it("a live_canary position can NEVER be auto-closed", () => {
    expect(() => closePosition({ position: open({ kind: "live_canary" }), closedAt: T0, reason: "stop-loss", closeKind: "paper-auto" })).toThrow(/NEVER be auto-closed/);
    const ok = closePosition({ position: open({ kind: "live_canary" }), closedAt: T0, reason: "stop-loss", closeKind: "operator-confirmed", valueLamports: 4_000_000 });
    expect(ok.status).toBe("closed");
  });

  it("double-close is refused", () => {
    const closed = closePosition({ position: open(), closedAt: T0, reason: "operator-manual", closeKind: "paper-auto" });
    expect(() => closePosition({ position: closed, closedAt: T0, reason: "operator-manual", closeKind: "paper-auto" })).toThrow(/already closed/);
  });
});

describe("ledger — duplicate-intent wall + honest totals", () => {
  it("refuses a second OPEN position for the same (kind, mint)", () => {
    const ledger = ledgerOpen(buildLedger(), open());
    expect(() => ledgerOpen(ledger, open({ openedAt: "2026-06-18T13:00:00.000Z" }))).toThrow(/duplicate/);
    // A different mint or a different kind is fine.
    expect(ledgerOpen(ledger, open({ mint: MINT2 })).totals.open).toBe(2);
    expect(ledgerOpen(ledger, open({ kind: "live_canary" })).totals.open).toBe(2);
  });

  it("totals sum KNOWN realized PnL only and count unknown closes separately", () => {
    const a = closePosition({ position: mark(open(), 4_000_000), closedAt: T0, reason: "stop-loss", closeKind: "paper-auto", valueLamports: 4_000_000 });
    const b = closePosition({ position: open({ mint: MINT2 }), closedAt: T0, reason: "time-exit", closeKind: "paper-auto" });
    const ledger = buildLedger([a, b]);
    expect(ledger.totals).toEqual({ open: 0, closed: 2, realizedPnlKnownLamports: -1_000_000, closedPnlUnknown: 1 });
  });

  it("ledgerReplace swaps by positionId and refuses unknown ids", () => {
    const p = open();
    const ledger = ledgerOpen(buildLedger(), p);
    const marked = mark(p, 6_000_000);
    expect(ledgerReplace(ledger, marked).positions[0]?.lastMark?.valueLamports).toBe(6_000_000);
    expect(() => ledgerReplace(ledger, open({ mint: MINT2 }))).toThrow(/unknown positionId/);
  });

  it("validateLedger recomputes totals, restores the peak ratchet, and refuses tampered ids", () => {
    let p = mark(open(), 10_000_000);
    p = mark(p, 6_000_000, 120_000);
    const ledger = buildLedger([p]);
    const revived = validateLedger(JSON.parse(JSON.stringify(ledger)));
    expect(revived.positions[0]?.peakValueLamports).toBe(10_000_000);
    const tampered = JSON.parse(JSON.stringify(ledger)) as { positions: Array<Record<string, unknown>> };
    tampered.positions[0]!.positionId = "paper:evil:now";
    expect(() => validateLedger(tampered)).toThrow(/tampered/);
    const alien = JSON.parse(JSON.stringify(ledger)) as { positions: Array<Record<string, unknown>> };
    alien.positions[0]!.autoTrade = true;
    expect(() => validateLedger(alien)).toThrow(/unknown field/);
  });
});
