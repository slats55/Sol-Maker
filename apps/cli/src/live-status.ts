/**
 * RUNTIME STATUS (Sprint 111) — the authoritative, per-loop operator state. The dashboard reads
 * THIS (via the status server), never logs. Written atomically (tmp → rename) so a reader can
 * never observe half-written JSON. Contains PUBLIC data only.
 */

import { renameSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { redactValue } from "@soulmaker/security";
import type { LivePosition, PositionLedger, ReconcileReport } from "@soulmaker/live";
import type { ExitAttemptState, InFlightIntent, StopState } from "./live-executor.js";

export const RUNTIME_STATUS_SCHEMA_VERSION = "live.runtime.status.v1";

export interface RuntimeStatusPositionView {
  positionId: string;
  mint: string;
  symbol: string | null;
  openedAt: string;
  entrySignature: string | null;
  entrySpendLamports: number;
  tokenAmountRaw: string | null;
  /** Estimated exit value from the latest REAL sell-side quote; null when no mark exists. */
  markValueLamports: number | null;
  markAt: string | null;
  unrealizedPnlLamports: number | null;
  unrealizedPnlPct: number | null;
  exitState: string | null;
  exitAttempts: number;
  exitLastError: string | null;
  status: "open" | "closed";
  closedAt: string | null;
  closeReason: string | null;
  closeSignature: string | null;
  realizedPnlLamports: number | null;
  realizedPnlPct: number | null;
  /** Estimates: valuation is from a quote; realized PnL is net of fees ONLY when it came from the real SOL delta. */
  estimate: true;
}

export interface RuntimeStatus {
  schemaVersion: typeof RUNTIME_STATUS_SCHEMA_VERSION;
  at: string;
  daemon: { running: boolean; mode: "paper" | "live"; armed: boolean; startedAt: string; loops: number; lastLoopAt: string | null; endedBy: string | null; version: string };
  stops: { safeStop: boolean; hardStop: boolean; state: StopState };
  cluster: "mainnet-beta";
  wallet: { publicKey: string | null; solLamports: number | null; reserveLamports: number | null; availableUnderCapsLamports: number | null };
  providers: { rpcHost: string | null; rpcStatus: "healthy" | "degraded" | "down" | "unknown"; lastSlot: number | null; quoteProvider: "healthy" | "degraded" | "down" | "unknown"; feeds: Array<{ providerId: string; status: string; detail: string | null }> };
  scanner: { running: boolean; candidatesSeen: number; newCandidates: number; lastCandidate: { mint: string; symbol: string | null; at: string } | null };
  lastDecision: { mint: string; symbol: string | null; at: string; verdict: "accepted" | "rejected"; reasons: string[]; score: number | null } | null;
  execution: { lastIntent: InFlightIntent | null; lastOutcome: string | null; lastSignature: string | null; lastConfirmSlot: number | null; lastError: string | null; lastAt: string | null; inFlight: InFlightIntent[] };
  positions: { open: number; openList: RuntimeStatusPositionView[]; recentClosed: RuntimeStatusPositionView[]; openExposureLamports: number; unrealizedPnlLamports: number | null };
  session: { tradesLastHour: number; tradesToday: number; realizedPnlLamports: number; lossCapLamports: number | null; lossUsedLamports: number; lossRemainingLamports: number | null; maxTradesPerHour: number | null; maxOpenPositions: number | null };
  reconciliation: { at: string | null; tradingAllowed: boolean | null; blockingReasons: string[]; orphans: number; verdicts: Record<string, number> } | null;
  notProfitabilityClaim: true;
}

export function positionView(p: LivePosition, exit: ExitAttemptState | null): RuntimeStatusPositionView {
  const mark = p.lastMark?.valueLamports ?? null;
  const unreal = p.status === "open" && mark !== null ? mark - p.entrySpendLamports : null;
  const realized = p.close?.pnlLamports ?? null;
  return {
    positionId: p.positionId, mint: p.mint, symbol: p.symbol, openedAt: p.openedAt, entrySignature: p.entrySignature, entrySpendLamports: p.entrySpendLamports, tokenAmountRaw: p.tokenAmountRaw,
    markValueLamports: mark, markAt: p.lastMark ? new Date(p.lastMark.atMs).toISOString() : null,
    unrealizedPnlLamports: unreal, unrealizedPnlPct: unreal !== null && p.entrySpendLamports > 0 ? (unreal / p.entrySpendLamports) * 100 : null,
    exitState: exit?.state ?? null, exitAttempts: exit?.attempts ?? 0, exitLastError: exit?.lastError ?? null,
    status: p.status, closedAt: p.close?.closedAt ?? null, closeReason: p.close?.reason ?? null, closeSignature: p.close?.signature ?? null,
    realizedPnlLamports: realized, realizedPnlPct: realized !== null && p.entrySpendLamports > 0 ? (realized / p.entrySpendLamports) * 100 : null,
    estimate: true,
  };
}

export function reconciliationView(r: ReconcileReport | null): RuntimeStatus["reconciliation"] {
  if (!r) return null;
  const verdicts: Record<string, number> = {};
  for (const i of r.items) verdicts[i.verdict] = (verdicts[i.verdict] ?? 0) + 1;
  return { at: r.reconciledAt, tradingAllowed: r.tradingAllowed, blockingReasons: r.blockingReasons, orphans: r.orphans.length, verdicts };
}

export function ledgerSessionView(ledger: PositionLedger, kind: "paper" | "live", nowMs: number): { tradesLastHour: number; tradesToday: number; realizedPnlLamports: number; lossUsedLamports: number; openExposureLamports: number } {
  const ps = ledger.positions.filter((p) => p.kind === kind);
  const hour = ps.filter((p) => Date.parse(p.openedAt) >= nowMs - 3600_000).length;
  const day = ps.filter((p) => Date.parse(p.openedAt) >= nowMs - 86_400_000);
  let realized = 0, loss = 0;
  for (const p of day) { const pnl = p.close?.pnlLamports ?? null; if (pnl !== null) { realized += pnl; if (pnl < 0) loss += -pnl; } }
  return { tradesLastHour: hour, tradesToday: day.length, realizedPnlLamports: realized, lossUsedLamports: loss, openExposureLamports: ps.filter((p) => p.status === "open").reduce((a, p) => a + p.entrySpendLamports, 0) };
}

/** Atomic write: tmp file in the same directory → rename. Readers never see a torn file. */
export function writeStatusAtomic(path: string, status: RuntimeStatus): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(redactValue(status), null, 2) + "\n");
  renameSync(tmp, path);
}
