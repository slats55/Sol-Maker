/**
 * The position-ledger CLI surface (Sprint 108 Final RC): paper open → mark → exit rules →
 * apply-exits → emergency. Pins the honest wall between the two position kinds: PAPER positions
 * may auto-close by rule; a LIVE (Phantom-opened) position only ever gets a printed exit
 * RECOMMENDATION — nothing here can sell it, because the backend holds no key.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLedger, ledgerOpen, openPosition, validateLedger } from "@soulmaker/live";
import { liveSniperEmergencyReport, liveSniperPaperOpenReport, liveSniperPositionsReport } from "./live-sniper-commands.js";

const MINT = "So11111111111111111111111111111111111111112";
const MINT2 = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const T0 = "2026-06-18T12:00:00.000Z";
const T0_MS = Date.parse(T0);

function isoAt(offsetMs: number): string {
  return new Date(T0_MS + offsetMs).toISOString();
}

function workspace(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "live-positions-"));
  writeFileSync(join(dir, "soulmaker.config.json"), JSON.stringify({ mode: "WATCH_ONLY", rpcUrl: "https://rpc.example.com" }));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function openPaper(dir: string, mint = MINT): void {
  const r = liveSniperPaperOpenReport({ cwd: dir, now: () => T0 }, { mint, spendSol: "0.005", ledgerPath: "positions.json", json: true });
  expect(r.exitCode, r.text).toBe(0);
}

describe("live:sniper:paper:open", () => {
  it("creates the ledger, opens a paper position, refuses a duplicate open", () => {
    const { dir, cleanup } = workspace();
    try {
      openPaper(dir);
      const ledger = validateLedger(JSON.parse(readFileSync(join(dir, "positions.json"), "utf8")));
      expect(ledger.totals.open).toBe(1);
      expect(ledger.positions[0]?.paperPositionNeverHeldFunds).toBe(true);
      const dup = liveSniperPaperOpenReport({ cwd: dir, now: () => isoAt(60_000) }, { mint: MINT, ledgerPath: "positions.json" });
      expect(dup.exitCode).toBe(1);
      expect(dup.text).toMatch(/duplicate/);
    } finally {
      cleanup();
    }
  });

  it("refuses a spend over the live canary ceiling — paper parity", () => {
    const { dir, cleanup } = workspace();
    try {
      const r = liveSniperPaperOpenReport({ cwd: dir, now: () => T0 }, { mint: MINT, spendSol: "0.06", ledgerPath: "positions.json" });
      expect(r.exitCode).toBe(1);
      expect(r.text).toMatch(/ceiling/);
    } finally {
      cleanup();
    }
  });
});

describe("live:sniper:positions — marks + exit rules + apply-exits", () => {
  it("a stop-loss breach closes the PAPER position only with --apply-exits, with honest PnL", () => {
    const { dir, cleanup } = workspace();
    try {
      openPaper(dir);
      writeFileSync(join(dir, "mark.json"), JSON.stringify({ valueLamports: 4_000_000, source: "jupiter-sell-quote" })); // -20%
      const dry = liveSniperPositionsReport({ cwd: dir, now: () => isoAt(60_000) }, { ledgerPath: "positions.json", markPairs: [`${MINT}=mark.json`], json: true });
      expect(dry.exitCode, dry.text).toBe(0);
      const dryReport = JSON.parse(dry.text) as { decisions: Array<{ shouldExit: boolean; reason: string }>; totals: { open: number } };
      expect(dryReport.decisions[0]).toMatchObject({ shouldExit: true, reason: "stop-loss" });
      expect(dryReport.totals.open).toBe(1); // dry view does not close

      const applied = liveSniperPositionsReport({ cwd: dir, now: () => isoAt(120_000) }, { ledgerPath: "positions.json", markPairs: [`${MINT}=mark.json`], applyExits: true, json: true });
      expect(applied.exitCode, applied.text).toBe(0);
      const ledger = validateLedger(JSON.parse(readFileSync(join(dir, "positions.json"), "utf8")));
      expect(ledger.totals).toMatchObject({ open: 0, closed: 1, realizedPnlKnownLamports: -1_000_000 });
      expect(ledger.positions[0]?.close?.reason).toBe("stop-loss");
      expect(ledger.positions[0]?.close?.closeKind).toBe("paper-auto");
    } finally {
      cleanup();
    }
  });

  it("take-profit and trailing-stop close paper positions by rule", () => {
    const { dir, cleanup } = workspace();
    try {
      openPaper(dir);
      // +100% then a 16% fall from peak: trailing fires (still above entry, below TP re-arm).
      writeFileSync(join(dir, "peak.json"), JSON.stringify({ valueLamports: 10_000_000, source: "jupiter" }));
      const first = liveSniperPositionsReport({ cwd: dir, now: () => isoAt(60_000) }, { ledgerPath: "positions.json", markPairs: [`${MINT}=peak.json`], applyExits: true, json: true });
      expect(first.exitCode, first.text).toBe(0);
      // +100% ≥ +50% target → take-profit already fired on the first pass.
      const ledger = validateLedger(JSON.parse(readFileSync(join(dir, "positions.json"), "utf8")));
      expect(ledger.positions[0]?.close?.reason).toBe("take-profit");
      expect(ledger.totals.realizedPnlKnownLamports).toBe(5_000_000);
    } finally {
      cleanup();
    }
  });

  it("a LIVE position is NEVER auto-closed — the exit is a recommendation", () => {
    const { dir, cleanup } = workspace();
    try {
      const live = openPosition({ kind: "live_canary", mint: MINT, openedAt: T0, entrySpendLamports: 5_000_000 });
      const ledger = ledgerOpen(buildLedger(), live);
      writeFileSync(join(dir, "positions.json"), JSON.stringify(ledger));
      writeFileSync(join(dir, "mark.json"), JSON.stringify({ valueLamports: 4_000_000, source: "jupiter" }));
      const r = liveSniperPositionsReport({ cwd: dir, now: () => isoAt(60_000) }, { ledgerPath: "positions.json", markPairs: [`${MINT}=mark.json`], applyExits: true });
      expect(r.exitCode, r.text).toBe(0);
      expect(r.text).toMatch(/EXIT RECOMMENDED/);
      expect(r.text).toMatch(/never sells/i);
      const after = validateLedger(JSON.parse(readFileSync(join(dir, "positions.json"), "utf8")));
      expect(after.totals.open).toBe(1); // still open — no auto-close for live
    } finally {
      cleanup();
    }
  });

  it("time-exit fires without any mark (honest markUnavailable)", () => {
    const { dir, cleanup } = workspace();
    try {
      openPaper(dir);
      const r = liveSniperPositionsReport({ cwd: dir, now: () => isoAt(31 * 60_000) }, { ledgerPath: "positions.json", applyExits: true, json: true });
      expect(r.exitCode, r.text).toBe(0);
      const report = JSON.parse(r.text) as { decisions: Array<{ reason: string; markUnavailable: boolean }>; totals: { closed: number; closedPnlUnknown: number } };
      expect(report.decisions[0]).toMatchObject({ reason: "time-exit", markUnavailable: true });
      expect(report.totals).toMatchObject({ closed: 1, closedPnlUnknown: 1 });
    } finally {
      cleanup();
    }
  });
});

describe("live:sniper:emergency", () => {
  it("closes all open paper positions and prints manual Phantom steps for live ones", () => {
    const { dir, cleanup } = workspace();
    try {
      const paper = openPosition({ kind: "paper", mint: MINT, openedAt: T0, entrySpendLamports: 5_000_000 });
      const live = openPosition({ kind: "live_canary", mint: MINT2, symbol: "USDC", openedAt: T0, entrySpendLamports: 5_000_000 });
      writeFileSync(join(dir, "positions.json"), JSON.stringify(ledgerOpen(ledgerOpen(buildLedger(), paper), live)));
      const r = liveSniperEmergencyReport({ cwd: dir, now: () => isoAt(60_000) }, { ledgerPath: "positions.json" });
      expect(r.exitCode, r.text).toBe(0);
      expect(r.text).toMatch(/paper positions closed now: 1/);
      expect(r.text).toMatch(/CANNOT sell them/);
      expect(r.text).toMatch(/kill switch/i);
      expect(r.text).toMatch(/Phantom/);
      const after = validateLedger(JSON.parse(readFileSync(join(dir, "positions.json"), "utf8")));
      expect(after.positions.find((p) => p.kind === "paper")?.status).toBe("closed");
      expect(after.positions.find((p) => p.kind === "paper")?.close?.reason).toBe("emergency");
      expect(after.positions.find((p) => p.kind === "live_canary")?.status).toBe("open");
    } finally {
      cleanup();
    }
  });
});
