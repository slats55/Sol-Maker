/**
 * Tests for the Sprint 104-C SNIPER WATCHLIST. Everything here is INJECTED, operator-shaped test data
 * — fake entry ids, real (well-known) mint public keys used purely as deterministic fixtures, made-up
 * operator labels/notes. Nothing here is real market data, a live result, a verified on-chain fact, or
 * a profitability claim.
 */

import { describe, it, expect } from "vitest";
import { REDACTED } from "@soulmaker/security";
import {
  normalizeSniperWatchlist,
  validateSniperWatchlist,
  formatSniperWatchlist,
  SniperWatchlistError,
  SNIPER_WATCHLIST_SCHEMA_VERSION,
  SNIPER_WATCHLIST_BANNER,
  SNIPER_WATCHLIST_STATUSES,
  type SniperWatchlistEntryInput,
  type SniperWatchlist,
} from "./watchlist.js";

// Real, well-known Solana mints used purely as deterministic, offline fixtures.
const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const entry = (over: Partial<SniperWatchlistEntryInput> & { mint: string }): SniperWatchlistEntryInput => over;
const wl = (entries: SniperWatchlistEntryInput[], extra: Record<string, unknown> = {}) =>
  normalizeSniperWatchlist({ entries, ...extra });

describe("normalizeSniperWatchlist — valid", () => {
  it("normalizes a valid watchlist with the PAPER-ONLY labelling + closed safety literals", () => {
    const w = wl(
      [
        entry({ mint: WRAPPED_SOL, label: "SOL", provider: "manual", status: "watch", tags: ["bluechip"] }),
        entry({ entryId: "usdc", mint: USDC, status: "review", notes: ["stable; monitor only"] }),
      ],
      { watchlistId: "demo", sourceLabel: "watchlist.json", network: "mainnet-beta", createdAtLabel: "session-1" },
    );
    expect(w.schemaVersion).toBe(SNIPER_WATCHLIST_SCHEMA_VERSION);
    expect(w.banner).toBe(SNIPER_WATCHLIST_BANNER);
    expect(w.watchlistId).toBe("demo");
    expect(w.network).toBe("mainnet-beta");
    expect(w.sourceLabel).toBe("watchlist.json");
    expect(w.createdAtLabel).toBe("session-1");
    expect(w.entryCount).toBe(2);
    expect(w.entries[0]!.entryId).toBe(WRAPPED_SOL); // defaults to the mint
    expect(w.entries[1]!.entryId).toBe("usdc");
    expect(w.statusCounts).toEqual({ watch: 1, review: 1, blocked: 0, archived: 0 });
    expect(w.distinctMints).toEqual([USDC, WRAPPED_SOL].sort());
    expect(w.duplicateMints).toEqual([]);
    expect(w.paperOnly).toBe(true);
    expect(w.statusIsNotTradeReadiness).toBe(true);
    expect(w.neverSends).toBe(true);
    expect(w.redactionApplied).toBe(true);
    expect(() => validateSniperWatchlist(w)).not.toThrow();
  });

  it("defaults every optional field deterministically and is idempotent", () => {
    const w = wl([entry({ mint: USDC })]);
    const e = w.entries[0]!;
    expect(e.entryId).toBe(USDC);
    expect(e.label).toBeNull();
    expect(e.provider).toBeNull();
    expect(e.status).toBe("watch");
    expect(e.tags).toEqual([]);
    expect(e.notes).toEqual([]);
    expect(e.addedAtLabel).toBeNull();
    expect(e.lastReviewedAtLabel).toBeNull();
    expect(w.watchlistId).toBe("sniper-watchlist");
    expect(w.network).toBe("mainnet-beta");
    // Idempotent: re-normalizing the canonical output yields a deep-equal watchlist.
    const again = normalizeSniperWatchlist({ ...w, entries: w.entries });
    expect(again).toEqual(w);
  });

  it("accepts every status in the closed set", () => {
    for (const status of SNIPER_WATCHLIST_STATUSES) {
      const w = wl([entry({ mint: USDC, status })]);
      expect(w.entries[0]!.status).toBe(status);
    }
  });
});

describe("normalizeSniperWatchlist — duplicate mints are deterministic (surfaced, not refused)", () => {
  it("allows duplicate mints across distinct entry ids, surfaces them, and is order-stable", () => {
    const w = wl([
      entry({ entryId: "a", mint: USDC, status: "watch" }),
      entry({ entryId: "b", mint: USDC, status: "review" }),
      entry({ entryId: "c", mint: WRAPPED_SOL }),
    ]);
    expect(w.entryCount).toBe(3);
    expect(w.duplicateMints).toEqual([USDC]);
    expect(w.warnings.some((m) => m.includes("more than one entry"))).toBe(true);
    expect(w.entries.map((e) => e.entryId)).toEqual(["a", "b", "c"]); // input order preserved
    expect(() => validateSniperWatchlist(w)).not.toThrow();
  });

  it("refuses a duplicate entry id", () => {
    expect(() => wl([entry({ entryId: "dup", mint: USDC }), entry({ entryId: "dup", mint: WRAPPED_SOL })])).toThrow(
      SniperWatchlistError,
    );
  });
});

describe("normalizeSniperWatchlist — refusals", () => {
  it("refuses an invalid mint", () => {
    expect(() => wl([entry({ mint: "not-a-real-mint" })])).toThrow(SniperWatchlistError);
  });

  it("refuses a secret-length / private-key-like mint before it is echoed", () => {
    const secretish = "5".repeat(88); // ~64-byte secret key length
    expect(() => wl([entry({ mint: secretish })])).toThrow(SniperWatchlistError);
  });

  it("refuses a secret-shaped label / provider / note (never echoes it)", () => {
    const secret = "z".repeat(88); // a base58 blob the shared redactor scrubs (≥80 chars)
    expect(() => wl([entry({ mint: USDC, label: secret })])).toThrow(SniperWatchlistError);
    expect(() => wl([entry({ mint: USDC, provider: secret })])).toThrow(SniperWatchlistError);
    expect(() => wl([entry({ mint: USDC, notes: [secret] })])).toThrow(SniperWatchlistError);
  });

  it("refuses a control character / NUL / BOM in a label", () => {
    const withControl = "a" + String.fromCharCode(0x07) + "b"; // BEL control char
    const withBom = "a" + String.fromCharCode(0xfeff) + "b"; // BOM
    const withNul = "a" + String.fromCharCode(0x00) + "b"; // NUL
    expect(() => wl([entry({ mint: USDC, label: withControl })])).toThrow(SniperWatchlistError);
    expect(() => wl([entry({ mint: USDC, label: withBom })])).toThrow(SniperWatchlistError);
    expect(() => wl([entry({ mint: USDC, label: withNul })])).toThrow(SniperWatchlistError);
  });

  it("refuses an unknown status and an unknown network", () => {
    expect(() => wl([entry({ mint: USDC, status: "ready" as never })])).toThrow(SniperWatchlistError);
    expect(() => wl([entry({ mint: USDC })], { network: "mainnet-live" })).toThrow(SniperWatchlistError);
  });

  it("refuses an empty watchlist unless allowEmpty", () => {
    expect(() => wl([])).toThrow(SniperWatchlistError);
    const w = normalizeSniperWatchlist({ entries: [], allowEmpty: true });
    expect(w.entryCount).toBe(0);
    expect(w.warnings.some((m) => m.includes("empty"))).toBe(true);
  });
});

describe("validateSniperWatchlist — closed schema + re-derived tallies", () => {
  it("refuses an unknown top-level field (the schema is CLOSED)", () => {
    const w = wl([entry({ mint: USDC })]) as unknown as Record<string, unknown>;
    expect(() => validateSniperWatchlist({ ...w, extra: 1 })).toThrow(/CLOSED/);
  });

  it("refuses an unknown entry field (the schema is CLOSED)", () => {
    const w = wl([entry({ mint: USDC })]) as SniperWatchlist;
    const tampered = { ...w, entries: [{ ...w.entries[0]!, sneaky: true }] };
    expect(() => validateSniperWatchlist(tampered)).toThrow(/CLOSED/);
  });

  it("refuses a fabricated status count (must be re-derived)", () => {
    const w = wl([entry({ mint: USDC, status: "watch" })]) as SniperWatchlist;
    const tampered = { ...w, statusCounts: { watch: 5, review: 0, blocked: 0, archived: 0 } };
    expect(() => validateSniperWatchlist(tampered)).toThrow(/statusCounts/);
  });

  it("refuses a fabricated duplicateMints list (must be re-derived)", () => {
    const w = wl([entry({ mint: USDC })]) as SniperWatchlist;
    const tampered = { ...w, duplicateMints: [USDC] };
    expect(() => validateSniperWatchlist(tampered)).toThrow(/duplicateMints/);
  });

  it("refuses a flipped safety literal (status can never mean trade readiness)", () => {
    const w = wl([entry({ mint: USDC })]) as unknown as Record<string, unknown>;
    expect(() => validateSniperWatchlist({ ...w, statusIsNotTradeReadiness: false })).toThrow(/statusIsNotTradeReadiness/);
    expect(() => validateSniperWatchlist({ ...w, neverSends: false })).toThrow(/neverSends/);
  });

  it("has no field that could carry trade-readiness / live-execution meaning", () => {
    const w = wl([entry({ mint: USDC, status: "watch" })]) as unknown as Record<string, unknown>;
    for (const forbidden of ["ready", "tradeReady", "liveSendStatus", "executable", "armed", "canTrade"]) {
      expect(forbidden in w).toBe(false);
    }
  });
});

describe("formatSniperWatchlist", () => {
  it("renders a stable, redacted summary leading with the PAPER-ONLY banner", () => {
    const w = wl([entry({ mint: WRAPPED_SOL, label: "SOL", status: "watch" })], { watchlistId: "demo" });
    const text = formatSniperWatchlist(w, { label: "demo" });
    expect(text).toContain(SNIPER_WATCHLIST_BANNER);
    expect(text).toContain("status=watch");
    expect(text).toContain(WRAPPED_SOL);
    expect(text).toContain("Not a trade signal.");
    // Deterministic.
    expect(formatSniperWatchlist(w, { label: "demo" })).toBe(text);
  });

  it("redacts a secret that reaches the formatter via a normally-safe path", () => {
    // Build a valid watchlist, then inject a secret-shaped note directly to prove the formatter scrubs.
    const w = wl([entry({ mint: BONK })]) as SniperWatchlist;
    const blob = "z".repeat(88); // base58 blob the shared redactor scrubs
    const tampered: SniperWatchlist = {
      ...w,
      entries: [{ ...w.entries[0]!, notes: [`token ${blob}`] }],
    };
    const text = formatSniperWatchlist(tampered);
    expect(text).toContain(REDACTED);
    expect(text).not.toContain(blob);
  });
});
