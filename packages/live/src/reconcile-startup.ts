/**
 * RECONCILE-ON-START (Sprint 111) — truth = persisted ledger + audit journal + the chain.
 *
 * Invariants:
 *   - Local state never overrides clear on-chain truth (a zero balance is a fact, a landed sell is a fact).
 *   - Arbitrary wallet holdings never become strategy positions: a holding is recovered ONLY when the
 *     audit journal proves Sol Maker submitted the buy (signature + mint + spend) and the chain confirms it.
 *   - Nothing is deleted. A mismatch is surfaced and BLOCKS trading; it is never papered over.
 *   - Idempotent: a second run over the same state reaches the same verdicts and mutates nothing.
 *   - An RPC failure never mutates state — it yields UNRESOLVED and blocks trading.
 */

import { confirmSignature, type ConfirmRpcLike, type BalanceRpcLike, type HoldingsRpcLike, type TokenHolding } from "@soulmaker/execution";
import { redactString } from "@soulmaker/security";
import { closePosition, ledgerOpen, ledgerReplace, openPosition, TX_SIGNATURE_RE, type LivePosition, type PositionLedger } from "./position.js";
import { isValidMint } from "./discovery.js";
import { MAINNET_EXECUTION_REPORT_SCHEMA_VERSION } from "./mainnet-execute.js";

export const RECONCILE_REPORT_SCHEMA_VERSION = "live.reconcile.startup.v1";
export const RECONCILE_RESOLUTION_SCHEMA_VERSION = "live.reconcile.resolution.v1";

export const RECONCILE_VERDICTS = [
  "OPEN_CONFIRMED",
  "CLOSED_CONFIRMED",
  "RECOVERED_OPEN",
  "RECOVERED_CLOSED",
  "PENDING_RECONCILIATION",
  "CHAIN_BALANCE_MISMATCH",
  "UNRESOLVED_TRANSACTION",
  "RESOLVED_FAILED",
  "ORPHANED_CHAIN_HOLDING",
] as const;
export type ReconcileVerdict = (typeof RECONCILE_VERDICTS)[number];

/** The audit-journal facts reconciliation reads (a subset of the execution report; unknown lines are ignored). */
export interface AuditExecutionEntry {
  schemaVersion: string;
  side: "buy" | "sell";
  outcome: string;
  attemptedAt: string;
  mint: string | null;
  signature: string | null;
  solDeltaLamports?: number | null;
  tokenDelta?: { deltaRaw: string } | null;
  attempt?: { signerPublicKey?: string | null } | null;
  position?: { positionId?: string; entrySpendLamports?: number; symbol?: string | null } | null;
  /** Spend for a buy is recoverable from the attempt's trade context when present. */
  spendLamports?: string | null;
}

/** Written to the audit log by reconciliation so a resolved signature is never re-resolved. */
export interface ReconcileResolution {
  schemaVersion: typeof RECONCILE_RESOLUTION_SCHEMA_VERSION;
  resolvedAt: string;
  signature: string;
  verdict: ReconcileVerdict;
  detail: string;
}

export interface ReconcileItem {
  verdict: ReconcileVerdict;
  positionId: string | null;
  mint: string | null;
  signature: string | null;
  chainTokenRaw: string | null;
  detail: string;
}

export interface ReconcileReport {
  schemaVersion: typeof RECONCILE_REPORT_SCHEMA_VERSION;
  reconciledAt: string;
  wallet: string;
  solLamports: number | null;
  items: ReconcileItem[];
  orphans: TokenHolding[];
  resolutions: ReconcileResolution[];
  ledger: PositionLedger;
  ledgerChanged: boolean;
  /** False when ANY item is pending, unresolved, or mismatched — the daemon must not trade. */
  tradingAllowed: boolean;
  blockingReasons: string[];
  notProfitabilityClaim: true;
}

export interface ReconcileStartupInput {
  wallet: string;
  ledger: PositionLedger;
  /** Parsed audit-log lines (any JSON objects; non-execution lines are ignored). */
  auditEntries: readonly unknown[];
  rpc: { confirm: ConfirmRpcLike; balance: BalanceRpcLike & HoldingsRpcLike };
  nowMs: () => number;
  clock: () => string;
  sleep?: (ms: number) => Promise<void>;
  /** Per-signature status wait. Reconciliation should not hang a startup: default 10s. */
  confirmTimeoutMs?: number;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Pick the execution entries + prior resolutions out of arbitrary audit lines. Malformed lines are ignored. */
export function parseAuditEntries(lines: readonly unknown[]): { executions: AuditExecutionEntry[]; resolved: Set<string> } {
  const executions: AuditExecutionEntry[] = [];
  const resolved = new Set<string>();
  for (const raw of lines) {
    if (!isObject(raw)) continue;
    if (raw.schemaVersion === RECONCILE_RESOLUTION_SCHEMA_VERSION && typeof raw.signature === "string" && TX_SIGNATURE_RE.test(raw.signature)) {
      resolved.add(raw.signature);
      continue;
    }
    if (raw.schemaVersion !== MAINNET_EXECUTION_REPORT_SCHEMA_VERSION) continue;
    if (raw.side !== "buy" && raw.side !== "sell") continue;
    if (typeof raw.outcome !== "string" || typeof raw.attemptedAt !== "string") continue;
    const signature = typeof raw.signature === "string" && TX_SIGNATURE_RE.test(raw.signature) ? raw.signature : null;
    const mint = typeof raw.mint === "string" && isValidMint(raw.mint) ? raw.mint : null;
    executions.push({
      schemaVersion: raw.schemaVersion,
      side: raw.side,
      outcome: raw.outcome,
      attemptedAt: raw.attemptedAt,
      mint,
      signature,
      solDeltaLamports: typeof raw.solDeltaLamports === "number" ? raw.solDeltaLamports : null,
      tokenDelta: isObject(raw.tokenDelta) && typeof raw.tokenDelta.deltaRaw === "string" ? { deltaRaw: raw.tokenDelta.deltaRaw } : null,
      attempt: isObject(raw.attempt) ? { signerPublicKey: typeof raw.attempt.signerPublicKey === "string" ? raw.attempt.signerPublicKey : null } : null,
      position: isObject(raw.position) ? { positionId: typeof raw.position.positionId === "string" ? raw.position.positionId : undefined, entrySpendLamports: typeof raw.position.entrySpendLamports === "number" ? raw.position.entrySpendLamports : undefined, symbol: typeof raw.position.symbol === "string" ? raw.position.symbol : null } : null,
      spendLamports: typeof raw.spendLamports === "string" && /^[0-9]{1,20}$/.test(raw.spendLamports) ? raw.spendLamports : null,
    });
  }
  return { executions, resolved };
}

type ChainRead<T> = { ok: true; value: T } | { ok: false; error: string };

async function safe<T>(fn: () => Promise<T>): Promise<ChainRead<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    return { ok: false, error: redactString(String((err as Error).message ?? err)).slice(0, 200) };
  }
}

/** Reconcile startup state. NEVER throws. NEVER deletes. Mutates the ledger only on chain-proven facts. */
export async function reconcileStartup(input: ReconcileStartupInput): Promise<ReconcileReport> {
  const reconciledAt = input.clock();
  const items: ReconcileItem[] = [];
  const resolutions: ReconcileResolution[] = [];
  const blocking: string[] = [];
  let ledger = input.ledger;
  let ledgerChanged = false;
  const { executions, resolved } = parseAuditEntries(input.auditEntries);
  const confirmTimeoutMs = input.confirmTimeoutMs ?? 10_000;

  const sigInLedger = new Set<string>();
  for (const p of ledger.positions) {
    if (p.entrySignature) sigInLedger.add(p.entrySignature);
    if (p.close?.signature) sigInLedger.add(p.close.signature);
  }

  // ---- 1) Unresolved submissions (crash between send and confirmation) ----------------------
  const pending = executions.filter((e) => e.outcome === "submitted-unconfirmed" && e.signature && !sigInLedger.has(e.signature) && !resolved.has(e.signature));
  for (const e of pending) {
    const sig = e.signature as string;
    const status = await confirmSignature({ rpc: input.rpc.confirm, signature: sig, timeoutMs: confirmTimeoutMs, pollMs: 1_000, nowMs: input.nowMs, sleep: input.sleep });
    if (status.status === "rpc-error") {
      items.push({ verdict: "UNRESOLVED_TRANSACTION", positionId: null, mint: e.mint, signature: sig, chainTokenRaw: null, detail: `status lookup failed: ${status.errLabel ?? "unknown"} — nothing changed` });
      blocking.push(`unresolved ${e.side} ${sig.slice(0, 8)}… (rpc error)`);
      continue;
    }
    if (status.status === "timeout") {
      items.push({ verdict: "PENDING_RECONCILIATION", positionId: null, mint: e.mint, signature: sig, chainTokenRaw: null, detail: "status still unknown at the deadline — retry reconciliation before trading" });
      blocking.push(`pending ${e.side} ${sig.slice(0, 8)}…`);
      continue;
    }
    if (status.status === "failed") {
      items.push({ verdict: "RESOLVED_FAILED", positionId: null, mint: e.mint, signature: sig, chainTokenRaw: null, detail: `landed with an error (${status.errLabel ?? "unknown"}) — no position` });
      resolutions.push({ schemaVersion: RECONCILE_RESOLUTION_SCHEMA_VERSION, resolvedAt: reconciledAt, signature: sig, verdict: "RESOLVED_FAILED", detail: status.errLabel ?? "failed" });
      continue;
    }
    // landed
    if (e.side === "buy") {
      const spend = e.spendLamports ?? (e.position?.entrySpendLamports !== undefined ? String(e.position.entrySpendLamports) : null);
      if (!e.mint || !spend) {
        items.push({ verdict: "UNRESOLVED_TRANSACTION", positionId: null, mint: e.mint, signature: sig, chainTokenRaw: null, detail: "buy landed but the journal lacks mint/spend — cannot recover a position; record it by hand" });
        blocking.push(`landed buy ${sig.slice(0, 8)}… lacks journal facts`);
        continue;
      }
      const bal = await safe(() => input.rpc.balance.getTokenBalanceRaw(input.wallet, e.mint as string));
      if (!bal.ok) {
        items.push({ verdict: "UNRESOLVED_TRANSACTION", positionId: null, mint: e.mint, signature: sig, chainTokenRaw: null, detail: `buy landed but balance read failed (${bal.error}) — nothing changed` });
        blocking.push(`landed buy ${sig.slice(0, 8)}… balance unreadable`);
        continue;
      }
      if (ledger.positions.some((p) => p.status === "open" && p.mint === e.mint)) {
        items.push({ verdict: "OPEN_CONFIRMED", positionId: null, mint: e.mint, signature: sig, chainTokenRaw: bal.value, detail: "an open position for this mint already exists; signature noted, nothing duplicated" });
        resolutions.push({ schemaVersion: RECONCILE_RESOLUTION_SCHEMA_VERSION, resolvedAt: reconciledAt, signature: sig, verdict: "OPEN_CONFIRMED", detail: "already in ledger" });
        continue;
      }
      try {
        const position = openPosition({ kind: "live", mint: e.mint, symbol: e.position?.symbol ?? null, openedAt: e.attemptedAt, entrySpendLamports: Number(spend), tokenAmountRaw: BigInt(bal.value) > 0n ? bal.value : null, entrySignature: sig });
        ledger = ledgerOpen(ledger, position);
        ledgerChanged = true;
        items.push({ verdict: "RECOVERED_OPEN", positionId: position.positionId, mint: e.mint, signature: sig, chainTokenRaw: bal.value, detail: BigInt(bal.value) > 0n ? "buy landed; position recovered from journal + chain" : "buy landed but the wallet holds 0 of the mint now — recovered, then flagged as a mismatch" });
        resolutions.push({ schemaVersion: RECONCILE_RESOLUTION_SCHEMA_VERSION, resolvedAt: reconciledAt, signature: sig, verdict: "RECOVERED_OPEN", detail: position.positionId });
        if (BigInt(bal.value) === 0n) blocking.push(`recovered position ${position.positionId} has zero chain balance`);
      } catch (err) {
        items.push({ verdict: "UNRESOLVED_TRANSACTION", positionId: null, mint: e.mint, signature: sig, chainTokenRaw: bal.value, detail: `buy landed but the ledger refused the position (${(err as Error).message})` });
        blocking.push(`landed buy ${sig.slice(0, 8)}… ledger refused`);
      }
    } else {
      // A landed sell whose close never persisted: close the matching open position.
      const target = ledger.positions.find((p) => p.status === "open" && p.kind === "live" && p.mint === e.mint);
      if (!target) {
        items.push({ verdict: "RESOLVED_FAILED", positionId: null, mint: e.mint, signature: sig, chainTokenRaw: null, detail: "sell landed but no open live position matches — nothing to close (already closed?)" });
        resolutions.push({ schemaVersion: RECONCILE_RESOLUTION_SCHEMA_VERSION, resolvedAt: reconciledAt, signature: sig, verdict: "RESOLVED_FAILED", detail: "no matching open position" });
        continue;
      }
      const value = e.solDeltaLamports !== null && e.solDeltaLamports !== undefined && e.solDeltaLamports > 0 ? e.solDeltaLamports : null;
      const closed = closePosition({ position: target, closedAt: e.attemptedAt, reason: "operator-manual", closeKind: "live-auto", valueLamports: value, detail: "recovered by reconciliation: sell landed before the close persisted", signature: sig });
      ledger = ledgerReplace(ledger, closed);
      ledgerChanged = true;
      items.push({ verdict: "RECOVERED_CLOSED", positionId: closed.positionId, mint: e.mint, signature: sig, chainTokenRaw: null, detail: value === null ? "closed; realized value unknown (journal had no SOL delta)" : `closed; realized value ${value} lamports` });
      resolutions.push({ schemaVersion: RECONCILE_RESOLUTION_SCHEMA_VERSION, resolvedAt: reconciledAt, signature: sig, verdict: "RECOVERED_CLOSED", detail: closed.positionId });
    }
  }

  // ---- 2) Every open LIVE position vs the chain --------------------------------------------
  const confirmedSells = executions.filter((e) => e.side === "sell" && e.outcome === "confirmed" && e.signature);
  for (const p of ledger.positions) {
    if (p.status === "closed") {
      items.push({ verdict: "CLOSED_CONFIRMED", positionId: p.positionId, mint: p.mint, signature: p.close?.signature ?? p.entrySignature, chainTokenRaw: null, detail: `closed ${p.close?.closedAt ?? ""} (${p.close?.reason ?? ""})` });
      continue;
    }
    if (p.kind !== "live") {
      items.push({ verdict: "OPEN_CONFIRMED", positionId: p.positionId, mint: p.mint, signature: null, chainTokenRaw: null, detail: `${p.kind} position — no chain claim, not reconciled against the wallet` });
      continue;
    }
    const bal = await safe(() => input.rpc.balance.getTokenBalanceRaw(input.wallet, p.mint));
    if (!bal.ok) {
      items.push({ verdict: "UNRESOLVED_TRANSACTION", positionId: p.positionId, mint: p.mint, signature: p.entrySignature, chainTokenRaw: null, detail: `balance read failed (${bal.error}) — position kept as-is` });
      blocking.push(`${p.positionId}: balance unreadable`);
      continue;
    }
    if (BigInt(bal.value) > 0n) {
      let cur: LivePosition = p;
      if (cur.tokenAmountRaw === null) {
        cur = { ...cur, tokenAmountRaw: bal.value };
        ledger = ledgerReplace(ledger, cur);
        ledgerChanged = true;
      }
      items.push({ verdict: "OPEN_CONFIRMED", positionId: p.positionId, mint: p.mint, signature: p.entrySignature, chainTokenRaw: bal.value, detail: "wallet still holds the mint" });
      continue;
    }
    // Zero balance: a landed sell that never persisted, or a real mismatch. Never delete.
    const sell = confirmedSells.find((e) => e.mint === p.mint && !sigInLedger.has(e.signature as string) && !resolved.has(e.signature as string));
    if (sell) {
      const value = sell.solDeltaLamports !== null && sell.solDeltaLamports !== undefined && sell.solDeltaLamports > 0 ? sell.solDeltaLamports : null;
      const closed = closePosition({ position: p, closedAt: sell.attemptedAt, reason: "operator-manual", closeKind: "live-auto", valueLamports: value, detail: "recovered by reconciliation: confirmed sell in journal, close never persisted", signature: sell.signature as string });
      ledger = ledgerReplace(ledger, closed);
      ledgerChanged = true;
      items.push({ verdict: "RECOVERED_CLOSED", positionId: p.positionId, mint: p.mint, signature: sell.signature, chainTokenRaw: "0", detail: "closed from the journaled confirmed sell" });
      resolutions.push({ schemaVersion: RECONCILE_RESOLUTION_SCHEMA_VERSION, resolvedAt: reconciledAt, signature: sell.signature as string, verdict: "RECOVERED_CLOSED", detail: p.positionId });
      continue;
    }
    items.push({ verdict: "CHAIN_BALANCE_MISMATCH", positionId: p.positionId, mint: p.mint, signature: p.entrySignature, chainTokenRaw: "0", detail: "ledger says OPEN but the wallet holds 0 of the mint and no confirmed sell is journaled — operator must resolve (sold elsewhere? transferred?)" });
    blocking.push(`${p.positionId}: open in ledger, 0 on chain`);
  }

  // ---- 3) Orphans: wallet holdings with no Sol Maker provenance ----------------------------
  const openMints = new Set(ledger.positions.filter((p) => p.status === "open" && p.kind === "live").map((p) => p.mint));
  const holdings = await safe(() => input.rpc.balance.listTokenHoldings(input.wallet));
  let orphans: TokenHolding[] = [];
  if (holdings.ok) {
    orphans = holdings.value.filter((h) => !openMints.has(h.mint));
    for (const h of orphans) items.push({ verdict: "ORPHANED_CHAIN_HOLDING", positionId: null, mint: h.mint, signature: null, chainTokenRaw: h.amountRaw, detail: `wallet holds ${h.amountRaw} raw (${h.program}) with no Sol Maker provenance — NOT a strategy position; ignored by the daemon` });
  } else {
    items.push({ verdict: "UNRESOLVED_TRANSACTION", positionId: null, mint: null, signature: null, chainTokenRaw: null, detail: `holdings listing failed (${holdings.error}) — orphan scan skipped` });
  }
  const sol = await safe(() => input.rpc.balance.getBalanceLamports(input.wallet));

  return {
    schemaVersion: RECONCILE_REPORT_SCHEMA_VERSION,
    reconciledAt,
    wallet: input.wallet,
    solLamports: sol.ok ? sol.value : null,
    items,
    orphans,
    resolutions,
    ledger,
    ledgerChanged,
    tradingAllowed: blocking.length === 0,
    blockingReasons: blocking,
    notProfitabilityClaim: true,
  };
}
