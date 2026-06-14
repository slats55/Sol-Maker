/**
 * Sprint 104-C — `paper:sniper:watchlist:prepare` (the operator watchlist).
 *
 * Create / normalize a `sniper.watchlist.v1` by merging an existing watchlist, a candidate list,
 * and/or repeatable `--add <mint[=label]>` entries (deduped by mint; first wins). These tests pin:
 *   - create from a candidate fixture; the artifact validates with the production validator;
 *   - --add a mint (with an optional label);
 *   - duplicate-mint handling (deduped, first wins, surfaced as a note);
 *   - refusals: an invalid mint, no source, an unknown status / network, --out overwrite;
 *   - --out file behaviour + byte determinism.
 *
 * All mints are FICTIONAL fixture mints or well-known public keys used purely as deterministic,
 * offline fixtures. Nothing here is live data, a trade signal, or a profitability claim.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSniperWatchlist, SNIPER_WATCHLIST_SCHEMA_VERSION } from "@soulmaker/sniper";
import { paperSniperWatchlistPrepareReport } from "./commands.js";

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

function withTmp<T>(fn: (tmp: string) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "wl-prepare-"));
  try {
    return fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const candidatesFile = (tmp: string): string => {
  const p = join(tmp, "candidates.json");
  writeFileSync(
    p,
    JSON.stringify({
      sourceLabel: "candidates.json",
      candidates: [
        { candidateId: "c1", mint: WRAPPED_SOL, symbol: "SOL", sourceTag: "manual" },
        { candidateId: "c2", mint: USDC, name: "USD Coin", tags: ["stable"] },
      ],
    }),
  );
  return p;
};

describe("paper:sniper:watchlist:prepare — create", () => {
  it("creates a watchlist from a candidate fixture and validates with the production validator", () => {
    withTmp((tmp) => {
      const r = paperSniperWatchlistPrepareReport({ cwd: tmp }, { candidatesPath: candidatesFile(tmp), json: true });
      expect(r.exitCode).toBe(0);
      const wl = JSON.parse(r.text);
      expect(wl.schemaVersion).toBe(SNIPER_WATCHLIST_SCHEMA_VERSION);
      expect(() => validateSniperWatchlist(wl)).not.toThrow();
      expect(wl.entryCount).toBe(2);
      expect(wl.entries.map((e: { mint: string }) => e.mint).sort()).toEqual([USDC, WRAPPED_SOL].sort());
      expect(wl.entries[0].status).toBe("watch");
      expect(wl.entries[0].label).toBe("SOL"); // symbol mapped to label
    });
  });

  it("adds a mint with an optional label and respects --status", () => {
    withTmp((tmp) => {
      const r = paperSniperWatchlistPrepareReport(
        { cwd: tmp },
        { add: [`${BONK}=BONK`], status: "review", json: true },
      );
      expect(r.exitCode).toBe(0);
      const wl = JSON.parse(r.text);
      expect(wl.entryCount).toBe(1);
      expect(wl.entries[0].mint).toBe(BONK);
      expect(wl.entries[0].label).toBe("BONK");
      expect(wl.entries[0].status).toBe("review");
      expect(wl.statusCounts).toEqual({ watch: 0, review: 1, blocked: 0, archived: 0 });
    });
  });

  it("dedupes a mint that appears in both --candidates and --add (first wins, surfaced)", () => {
    withTmp((tmp) => {
      const r = paperSniperWatchlistPrepareReport(
        { cwd: tmp },
        { candidatesPath: candidatesFile(tmp), add: [`${USDC}=dup`] },
      );
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain("skipped 1 duplicate-mint");
      // The candidate's USDC entry (label "USD Coin") wins over the --add "dup" label.
      const json = paperSniperWatchlistPrepareReport(
        { cwd: tmp },
        { candidatesPath: candidatesFile(tmp), add: [`${USDC}=dup`], json: true },
      );
      const wl = JSON.parse(json.text);
      expect(wl.entryCount).toBe(2);
      const usdc = wl.entries.find((e: { mint: string }) => e.mint === USDC);
      expect(usdc.label).toBe("USD Coin");
    });
  });
});

describe("paper:sniper:watchlist:prepare — merge an existing watchlist", () => {
  it("merges an existing watchlist with new --add entries, preserving the existing entry", () => {
    withTmp((tmp) => {
      const first = paperSniperWatchlistPrepareReport(
        { cwd: tmp },
        { add: [`${WRAPPED_SOL}=SOL`], status: "blocked", outPath: join(tmp, "wl.json"), json: true },
      );
      expect(first.exitCode).toBe(0);
      const r = paperSniperWatchlistPrepareReport(
        { cwd: tmp },
        { watchlistPath: join(tmp, "wl.json"), add: [`${USDC}=USDC`], json: true },
      );
      expect(r.exitCode).toBe(0);
      const wl = JSON.parse(r.text);
      expect(wl.entryCount).toBe(2);
      const sol = wl.entries.find((e: { mint: string }) => e.mint === WRAPPED_SOL);
      expect(sol.status).toBe("blocked"); // existing status preserved through the round-trip
    });
  });
});

describe("paper:sniper:watchlist:prepare — refusals", () => {
  it("refuses when no source is provided", () => {
    const r = paperSniperWatchlistPrepareReport({}, {});
    expect(r.exitCode).toBe(1);
    expect(r.text).toContain("at least one of");
  });

  it("refuses an invalid mint", () => {
    const r = paperSniperWatchlistPrepareReport({}, { add: ["not-a-mint"] });
    expect(r.exitCode).toBe(1);
    expect(r.text).toContain("Refusing");
  });

  it("refuses a secret-length mint without echoing it", () => {
    const secret = "5".repeat(88);
    const r = paperSniperWatchlistPrepareReport({}, { add: [secret] });
    expect(r.exitCode).toBe(1);
    expect(r.text).not.toContain(secret);
  });

  it("refuses an unknown status and an unknown network", () => {
    expect(paperSniperWatchlistPrepareReport({}, { add: [USDC], status: "ready" }).exitCode).toBe(1);
    expect(paperSniperWatchlistPrepareReport({}, { add: [USDC], network: "mainnet-live" }).exitCode).toBe(1);
  });

  it("refuses --out overwrite without --force, then writes with --force", () => {
    withTmp((tmp) => {
      const out = join(tmp, "wl.json");
      const r1 = paperSniperWatchlistPrepareReport({ cwd: tmp }, { add: [USDC], outPath: out });
      expect(r1.exitCode).toBe(0);
      expect(existsSync(out)).toBe(true);
      const r2 = paperSniperWatchlistPrepareReport({ cwd: tmp }, { add: [USDC], outPath: out });
      expect(r2.exitCode).toBe(1);
      expect(r2.text).toContain("already exists");
      const r3 = paperSniperWatchlistPrepareReport({ cwd: tmp }, { add: [USDC], outPath: out, force: true });
      expect(r3.exitCode).toBe(0);
    });
  });
});

describe("paper:sniper:watchlist:prepare — output", () => {
  it("writes a byte-deterministic, valid artifact to --out", () => {
    withTmp((tmp) => {
      const out1 = join(tmp, "a.json");
      const out2 = join(tmp, "b.json");
      paperSniperWatchlistPrepareReport({ cwd: tmp }, { add: [`${USDC}=USDC`, `${WRAPPED_SOL}=SOL`], outPath: out1 });
      paperSniperWatchlistPrepareReport({ cwd: tmp }, { add: [`${USDC}=USDC`, `${WRAPPED_SOL}=SOL`], outPath: out2 });
      const a = readFileSync(out1, "utf8");
      const b = readFileSync(out2, "utf8");
      expect(a).toBe(b);
      expect(() => validateSniperWatchlist(JSON.parse(a))).not.toThrow();
    });
  });

  it("does not write any file when --out is omitted (no-write default)", () => {
    withTmp((tmp) => {
      const before = existsSync(join(tmp, "watchlist.json"));
      const r = paperSniperWatchlistPrepareReport({ cwd: tmp }, { add: [USDC] });
      expect(r.exitCode).toBe(0);
      expect(existsSync(join(tmp, "watchlist.json"))).toBe(before);
    });
  });
});
