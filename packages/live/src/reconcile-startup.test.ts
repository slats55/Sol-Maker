import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import type { TokenHolding } from "@soulmaker/execution";
import { buildLedger, openPosition, validateLedger } from "./position.js";
import { reconcileStartup, parseAuditEntries, RECONCILE_RESOLUTION_SCHEMA_VERSION } from "./reconcile-startup.js";
import { MAINNET_EXECUTION_REPORT_SCHEMA_VERSION } from "./mainnet-execute.js";

const WALLET = new PublicKey(Buffer.alloc(32, 1)).toBase58();
const MINT_A = new PublicKey(Buffer.alloc(32, 7)).toBase58();
const MINT_B = new PublicKey(Buffer.alloc(32, 8)).toBase58();
const SIG_BUY = "4".repeat(88);
const SIG_SELL = "5".repeat(88);
const T0 = Date.parse("2026-09-03T12:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

interface Chain {
  statuses: Record<string, { slot: number; err: unknown; confirmationStatus?: string } | null | "error">;
  balances: Record<string, string | "error">;
  holdings: TokenHolding[] | "error";
  sol: number;
}

function rpc(c: Chain) {
  return {
    confirm: {
      getSignatureStatuses: async (sigs: string[]) => {
        const v = c.statuses[sigs[0] as string];
        if (v === "error") throw new Error("rpc down");
        return { value: [v ?? null] };
      },
    },
    balance: {
      getBalanceLamports: async () => c.sol,
      getTokenBalanceRaw: async (_o: string, mint: string) => {
        const v = c.balances[mint];
        if (v === "error") throw new Error("balance rpc down");
        return v ?? "0";
      },
      listTokenHoldings: async () => {
        if (c.holdings === "error") throw new Error("holdings rpc down");
        return c.holdings;
      },
    },
  };
}

function audit(over: Record<string, unknown>) {
  return { schemaVersion: MAINNET_EXECUTION_REPORT_SCHEMA_VERSION, side: "buy", outcome: "confirmed", attemptedAt: at(-60_000), mint: MINT_A, signature: SIG_BUY, feePayer: WALLET, spendLamports: "5000000", ...over };
}

async function run(c: Chain, ledger = buildLedger([]), entries: unknown[] = []) {
  let t = T0;
  return reconcileStartup({ wallet: WALLET, ledger, auditEntries: entries, rpc: rpc(c), nowMs: () => t, clock: () => new Date(t).toISOString(), sleep: async (ms) => { t += ms; }, confirmTimeoutMs: 3_000 });
}

const CONFIRMED = { slot: 10, err: null, confirmationStatus: "confirmed" };

describe("reconcileStartup (S111)", () => {
  it("Case A: a confirmed buy survives restart — ledger open + chain holds the mint → OPEN_CONFIRMED, trading allowed", async () => {
    const p = openPosition({ kind: "live", mint: MINT_A, openedAt: at(-60_000), entrySpendLamports: 5_000_000, tokenAmountRaw: "777", entrySignature: SIG_BUY });
    const r = await run({ statuses: {}, balances: { [MINT_A]: "777" }, holdings: [{ mint: MINT_A, amountRaw: "777", program: "spl-token" }], sol: 1e9 }, buildLedger([p]));
    expect(r.items.map((i) => i.verdict)).toEqual(["OPEN_CONFIRMED"]);
    expect(r.ledgerChanged).toBe(false);
    expect(r.tradingAllowed).toBe(true);
    expect(r.orphans).toEqual([]);
  });

  it("a confirmed sell survives restart — closed position stays closed, PnL not recounted", async () => {
    const p = openPosition({ kind: "live", mint: MINT_A, openedAt: at(-60_000), entrySpendLamports: 5_000_000, entrySignature: SIG_BUY });
    const closed = { ...p, status: "closed" as const, close: { closedAt: at(-1000), closeKind: "live-auto" as const, reason: "take-profit" as const, valueLamports: 6_000_000, pnlLamports: 1_000_000, detail: "", signature: SIG_SELL } };
    const ledger = validateLedger(JSON.parse(JSON.stringify(buildLedger([closed]))));
    const entries = [audit({}), audit({ side: "sell", signature: SIG_SELL, solDeltaLamports: 6_000_000 })];
    const r = await run({ statuses: {}, balances: {}, holdings: [], sol: 1e9 }, ledger, entries);
    expect(r.items.map((i) => i.verdict)).toEqual(["CLOSED_CONFIRMED"]);
    expect(r.ledger.totals.realizedPnlKnownLamports).toBe(1_000_000);
    expect(r.ledgerChanged).toBe(false);
  });

  it("Case E: crash after broadcast, before confirmation — a landed buy is RECOVERED as an open position with its signature", async () => {
    const entries = [audit({ outcome: "submitted-unconfirmed" })];
    const r = await run({ statuses: { [SIG_BUY]: CONFIRMED }, balances: { [MINT_A]: "999" }, holdings: [{ mint: MINT_A, amountRaw: "999", program: "spl-token" }], sol: 1e9 }, buildLedger([]), entries);
    expect(r.items[0]?.verdict).toBe("RECOVERED_OPEN");
    expect(r.ledger.positions[0]?.entrySignature).toBe(SIG_BUY);
    expect(r.ledger.positions[0]?.tokenAmountRaw).toBe("999");
    expect(r.ledger.positions[0]?.entrySpendLamports).toBe(5_000_000);
    expect(r.ledgerChanged).toBe(true);
    expect(r.tradingAllowed).toBe(true);
    expect(r.resolutions[0]?.signature).toBe(SIG_BUY);
  });

  it("Case F: a pending buy that FAILED on-chain never becomes a position", async () => {
    const entries = [audit({ outcome: "submitted-unconfirmed" })];
    const r = await run({ statuses: { [SIG_BUY]: { slot: 3, err: { InstructionError: [1, "Custom"] } } }, balances: {}, holdings: [], sol: 1e9 }, buildLedger([]), entries);
    expect(r.items[0]?.verdict).toBe("RESOLVED_FAILED");
    expect(r.ledger.positions).toHaveLength(0);
    expect(r.tradingAllowed).toBe(true);
  });

  it("a pending buy still unknown at the deadline stays PENDING and BLOCKS trading, with nothing mutated", async () => {
    const entries = [audit({ outcome: "submitted-unconfirmed" })];
    const r = await run({ statuses: { [SIG_BUY]: null }, balances: {}, holdings: [], sol: 1e9 }, buildLedger([]), entries);
    expect(r.items[0]?.verdict).toBe("PENDING_RECONCILIATION");
    expect(r.ledger.positions).toHaveLength(0);
    expect(r.tradingAllowed).toBe(false);
    expect(r.resolutions).toHaveLength(0);
  });

  it("Case B: ledger OPEN but wallet holds 0 — with a journaled confirmed sell → RECOVERED_CLOSED; without → CHAIN_BALANCE_MISMATCH (never deleted, blocks trading)", async () => {
    const p = openPosition({ kind: "live", mint: MINT_A, openedAt: at(-60_000), entrySpendLamports: 5_000_000, entrySignature: SIG_BUY });
    const withSell = await run({ statuses: {}, balances: { [MINT_A]: "0" }, holdings: [], sol: 1e9 }, buildLedger([p]), [audit({ side: "sell", signature: SIG_SELL, solDeltaLamports: 5_500_000 })]);
    expect(withSell.items[0]?.verdict).toBe("RECOVERED_CLOSED");
    expect(withSell.ledger.positions[0]?.status).toBe("closed");
    expect(withSell.ledger.positions[0]?.close?.pnlLamports).toBe(500_000);
    expect(withSell.tradingAllowed).toBe(true);
    const noSell = await run({ statuses: {}, balances: { [MINT_A]: "0" }, holdings: [], sol: 1e9 }, buildLedger([p]));
    expect(noSell.items[0]?.verdict).toBe("CHAIN_BALANCE_MISMATCH");
    expect(noSell.ledger.positions[0]?.status).toBe("open");
    expect(noSell.tradingAllowed).toBe(false);
    expect(noSell.ledgerChanged).toBe(false);
  });

  it("Case D: a chain holding with no Sol Maker provenance is an ORPHAN, never a position, and does not block", async () => {
    const r = await run({ statuses: {}, balances: {}, holdings: [{ mint: MINT_B, amountRaw: "123", program: "token-2022" }], sol: 1e9 });
    expect(r.items[0]?.verdict).toBe("ORPHANED_CHAIN_HOLDING");
    expect(r.orphans[0]?.mint).toBe(MINT_B);
    expect(r.ledger.positions).toHaveLength(0);
    expect(r.tradingAllowed).toBe(true);
  });

  it("is idempotent: a second run over the recovered ledger + resolutions changes nothing", async () => {
    const entries: unknown[] = [audit({ outcome: "submitted-unconfirmed" })];
    const chain: Chain = { statuses: { [SIG_BUY]: CONFIRMED }, balances: { [MINT_A]: "999" }, holdings: [{ mint: MINT_A, amountRaw: "999", program: "spl-token" }], sol: 1e9 };
    const first = await run(chain, buildLedger([]), entries);
    const second = await run(chain, first.ledger, [...entries, ...first.resolutions]);
    expect(second.ledgerChanged).toBe(false);
    expect(second.ledger.positions).toHaveLength(1);
    expect(second.items.map((i) => i.verdict)).toEqual(["OPEN_CONFIRMED"]);
    expect(second.resolutions).toHaveLength(0);
    // Even WITHOUT the resolutions, the ledger's own signature prevents a duplicate recovery.
    const third = await run(chain, first.ledger, entries);
    expect(third.ledger.positions).toHaveLength(1);
    expect(third.ledgerChanged).toBe(false);
  });

  it("malformed audit lines are ignored safely; a corrupt ledger fails at validateLedger before reconciliation", () => {
    const parsed = parseAuditEntries([null, 42, "x", { schemaVersion: "other" }, { schemaVersion: MAINNET_EXECUTION_REPORT_SCHEMA_VERSION, side: "buy" }, audit({ signature: "short" }), { schemaVersion: RECONCILE_RESOLUTION_SCHEMA_VERSION, signature: SIG_SELL }]);
    expect(parsed.executions).toHaveLength(1);
    expect(parsed.executions[0]?.signature).toBeNull();
    expect(parsed.resolved.has(SIG_SELL)).toBe(true);
    expect(() => validateLedger({ schemaVersion: "live.position.ledger.v1", positions: [{ kind: "live", mint: MINT_A }] })).toThrow();
  });

  it("RPC errors never mutate state: status error → UNRESOLVED; balance error on an open position → kept as-is; both block", async () => {
    const pendingErr = await run({ statuses: { [SIG_BUY]: "error" }, balances: {}, holdings: [], sol: 1e9 }, buildLedger([]), [audit({ outcome: "submitted-unconfirmed" })]);
    expect(pendingErr.items[0]?.verdict).toBe("UNRESOLVED_TRANSACTION");
    expect(pendingErr.ledger.positions).toHaveLength(0);
    expect(pendingErr.tradingAllowed).toBe(false);
    const p = openPosition({ kind: "live", mint: MINT_A, openedAt: at(-60_000), entrySpendLamports: 5_000_000, entrySignature: SIG_BUY });
    const balErr = await run({ statuses: {}, balances: { [MINT_A]: "error" }, holdings: "error", sol: 1e9 }, buildLedger([p]));
    expect(balErr.items.find((i) => i.positionId === p.positionId)?.verdict).toBe("UNRESOLVED_TRANSACTION");
    expect(balErr.ledger.positions[0]?.status).toBe("open");
    expect(balErr.ledgerChanged).toBe(false);
    expect(balErr.tradingAllowed).toBe(false);
  });

  it("Invariant 7: paper positions are never reconciled against the wallet and never block", async () => {
    const paper = openPosition({ kind: "paper", mint: MINT_A, openedAt: at(-60_000), entrySpendLamports: 1000 });
    const r = await run({ statuses: {}, balances: { [MINT_A]: "0" }, holdings: [], sol: 1e9 }, buildLedger([paper]));
    expect(r.items[0]?.verdict).toBe("OPEN_CONFIRMED");
    expect(r.items[0]?.detail).toContain("paper");
    expect(r.tradingAllowed).toBe(true);
  });
});
