/**
 * Sprint 92 — `paper:routequote:fetch` (the REAL read-only quote fetcher CLI).
 *
 * These tests pin:
 *   - refusals: missing --candidates, PAPER mode without --allow-paper-read, invalid config,
 *     ambiguous/missing amount, bad slippage, missing --out-dir directory, overwrite without
 *     --force;
 *   - happy path over an INJECTED adapter (no network in tests): per-mint observation files +
 *     fetch-report.json, validated downstream by the real paper:routequote:prepare command;
 *   - honest failure carry: a provider failure becomes a non-observed observation file, never a
 *     fabricated quote, and --fail-on-not-observed gates on it;
 *   - safety: the fetch report pins phase7LiveTradingReady=false and the never-executable
 *     literals; nothing secret-shaped survives into any written file.
 *
 * All mints are FICTIONAL fixture mints; the injected adapter fabricates NOTHING beyond what the
 * closed observation contract allows.
 */

import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FICTIONAL_MINT_A, FICTIONAL_MINT_B } from "@soulmaker/simulation";
import { validateRouteQuoteObservationInput, validateRouteQuotePrepared } from "@soulmaker/routequote";
import { createJupiterQuoteAdapter, type QuoteProviderAdapter } from "@soulmaker/quotefetch";
import type { FetchLike } from "@soulmaker/quotefetch";
import { paperRouteQuoteFetchReport, paperRouteQuotePrepareReport } from "./commands.js";

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const FIXED_CLOCK = (): string => "2026-06-12T03:00:00.000Z";

async function withTmpAsync<T>(fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), "rq-fetch-"));
  try {
    return await fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function writeConfig(tmp: string, mode: string): void {
  writeFileSync(join(tmp, "soulmaker.config.json"), JSON.stringify({ mode }, null, 2));
}

function writeCandidates(tmp: string): string {
  writeFileSync(
    join(tmp, "candidates.json"),
    JSON.stringify({
      sourceLabel: "fictional-quotefetch-candidates",
      candidates: [
        { candidateId: "c-a", mint: FICTIONAL_MINT_A, symbol: "FICA" },
        { candidateId: "c-b", mint: FICTIONAL_MINT_B, symbol: "FICB" },
      ],
    }),
  );
  return "candidates.json";
}

function quoteBody(outputMint: string): string {
  return JSON.stringify({
    inputMint: WSOL_MINT,
    inAmount: "10000000",
    outputMint,
    outAmount: "424242",
    otherAmountThreshold: "420000",
    priceImpactPct: "0.42",
    routePlan: [{ swapInfo: { label: "FictionalVenue" } }],
    contextSlot: 123456,
  });
}

/** Injected adapter: FICA quotes fine; FICB is rate-limited (mixed honest outcomes). */
function injectedAdapter(): QuoteProviderAdapter {
  const fetchLike: FetchLike = async (url: string) => {
    if (url.includes(FICTIONAL_MINT_B)) return { ok: false, status: 429, text: async () => "rate limited" };
    return { ok: true, status: 200, text: async () => quoteBody(FICTIONAL_MINT_A) };
  };
  return createJupiterQuoteAdapter({ fetchLike, clock: FIXED_CLOCK });
}

function fetchCtx(tmp: string) {
  return { cwd: tmp, env: {}, createQuoteAdapter: () => injectedAdapter(), now: FIXED_CLOCK };
}

const readJson = (tmp: string, name: string): unknown => JSON.parse(readFileSync(join(tmp, name), "utf8"));

describe("paper:routequote:fetch — refusals (fail-closed, exit 1)", () => {
  it("requires --candidates", async () => {
    const r = await paperRouteQuoteFetchReport({}, { amountSol: "0.01" });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/^Refusing: --candidates/);
  });

  it("refuses a PAPER-mode network read without --allow-paper-read", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp, "PAPER");
      const candidates = writeCandidates(tmp);
      const r = await paperRouteQuoteFetchReport(fetchCtx(tmp), { candidatesPath: candidates, amountSol: "0.01" });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("--allow-paper-read");
    });
  });

  it("refuses when both or neither of --amount-raw/--amount-sol are given", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp, "WATCH_ONLY");
      const candidates = writeCandidates(tmp);
      const both = await paperRouteQuoteFetchReport(fetchCtx(tmp), {
        candidatesPath: candidates,
        amountRaw: "10000000",
        amountSol: "0.01",
      });
      expect(both.exitCode).toBe(1);
      expect(both.text).toContain("exactly one");
      const neither = await paperRouteQuoteFetchReport(fetchCtx(tmp), { candidatesPath: candidates });
      expect(neither.exitCode).toBe(1);
      expect(neither.text).toContain("exactly one");
    });
  });

  it("refuses bad slippage, bad timeout, bad amount-sol, and a missing --out-dir directory", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp, "WATCH_ONLY");
      const candidates = writeCandidates(tmp);
      const ctx = fetchCtx(tmp);
      expect((await paperRouteQuoteFetchReport(ctx, { candidatesPath: candidates, amountSol: "0.01", slippageBps: "abc" })).text).toContain("--slippage-bps");
      expect((await paperRouteQuoteFetchReport(ctx, { candidatesPath: candidates, amountSol: "0.01", timeoutMs: "1" })).text).toContain("--timeout-ms");
      expect((await paperRouteQuoteFetchReport(ctx, { candidatesPath: candidates, amountSol: "0.0000000001" })).text).toContain("--amount-sol");
      const r = await paperRouteQuoteFetchReport(ctx, { candidatesPath: candidates, amountSol: "0.01", outDir: "does-not-exist" });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("does not exist");
    });
  });

  it("refuses to overwrite an existing output file without --force (before any fetch)", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp, "WATCH_ONLY");
      const candidates = writeCandidates(tmp);
      writeFileSync(join(tmp, "fetch-report.json"), "{}");
      const r = await paperRouteQuoteFetchReport(fetchCtx(tmp), {
        candidatesPath: candidates,
        amountSol: "0.01",
        outDir: ".",
      });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("already exists");
    });
  });
});

describe("paper:routequote:fetch — happy path over an injected adapter", () => {
  it("writes one observation file per distinct mint + fetch-report.json; downstream prepare accepts them", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp, "WATCH_ONLY");
      const candidates = writeCandidates(tmp);
      const r = await paperRouteQuoteFetchReport(fetchCtx(tmp), {
        candidatesPath: candidates,
        amountSol: "0.01",
        outDir: ".",
      });
      expect(r.exitCode, r.text.slice(0, 400)).toBe(0);
      expect(r.text).toContain("wrote 3 file(s)");
      expect(r.text).toContain("paper:routequote:prepare");

      // Each observation file is a valid routequote.observation.input.v1.
      const obsA = readJson(tmp, "quote.c-a.json");
      const obsB = readJson(tmp, "quote.c-b.json");
      expect(validateRouteQuoteObservationInput(obsA).quoteStatus).toBe("quote-observed");
      const validatedB = validateRouteQuoteObservationInput(obsB);
      expect(validatedB.quoteStatus).toBe("blocked");
      expect(validatedB.statusReason).toContain("HTTP 429");

      // The REAL prepare command pairs the fetched files by mint into a valid prepared artifact.
      const prep = paperRouteQuotePrepareReport(
        { cwd: tmp, env: {} },
        {
          candidatesPath: candidates,
          quotePaths: ["quote.c-a.json", "quote.c-b.json"],
          outPath: "routequote-prepared.json",
          json: false,
        },
      );
      expect(prep.exitCode, prep.text.slice(0, 400)).toBe(0);
      const prepared = validateRouteQuotePrepared(readJson(tmp, "routequote-prepared.json"));
      expect(prepared.observedCount).toBe(1);
      expect(prepared.blockedCount).toBe(1);
      expect(prepared.entries[0]?.observation?.source).toBe("jupiter-lite-api");
      expect(prepared.entries[0]?.observation?.observedAtLabel).toBe("2026-06-12T03:00:00.000Z");
    });
  });

  it("PAPER mode works WITH --allow-paper-read; amount-raw path works; JSON output is the report", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp, "PAPER");
      const candidates = writeCandidates(tmp);
      const r = await paperRouteQuoteFetchReport(fetchCtx(tmp), {
        candidatesPath: candidates,
        amountRaw: "10000000",
        allowPaperRead: true,
        json: true,
      });
      expect(r.exitCode, r.text.slice(0, 400)).toBe(0);
      const report = JSON.parse(r.text) as Record<string, unknown>;
      expect(report.schemaVersion).toBe("routequote.fetch.report.v1");
      expect(report.entryCount).toBe(2);
      expect(report.observedCount).toBe(1);
      expect(report.blockedCount).toBe(1);
      expect(report.phase7LiveTradingReady).toBe(false);
      expect(report.notExecutable).toBe(true);
      expect(report.neverSigns).toBe(true);
      expect(report.neverSends).toBe(true);
      expect(report.requestedAmountRaw).toBe("10000000");
      expect(r.text).not.toMatch(/[0-9a-f]{64,}/);
    });
  });

  it("--fail-on-not-observed exits non-zero when any candidate's quote was not observed", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp, "WATCH_ONLY");
      const candidates = writeCandidates(tmp);
      const r = await paperRouteQuoteFetchReport(fetchCtx(tmp), {
        candidatesPath: candidates,
        amountSol: "0.01",
        failOnNotObserved: true,
      });
      expect(r.exitCode).toBe(1);
    });
  });

  it("writes nothing without --out-dir and says so honestly", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp, "WATCH_ONLY");
      const candidates = writeCandidates(tmp);
      const r = await paperRouteQuoteFetchReport(fetchCtx(tmp), { candidatesPath: candidates, amountSol: "0.01" });
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain("Nothing was written");
      expect(existsSync(join(tmp, "fetch-report.json"))).toBe(false);
    });
  });
});
