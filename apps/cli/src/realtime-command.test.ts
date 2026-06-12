/**
 * Sprint 92 — `paper:realtime:snapshot` + `paper:realtime:watch` (real-time candidate ingestion).
 *
 * Pins:
 *   - refusals: bad source, replay without --replay-file, malformed replay file, PAPER without
 *     --allow-paper-read (live source only), bounded --polls/--interval-ms, missing --journal,
 *     missing --out-dir directory, overwrite without --force;
 *   - snapshot happy path over an INJECTED live adapter: snapshot.json + candidates.json, and
 *     the candidates file feeds the REAL candidate validator downstream;
 *   - replay source needs NO network gate and is labeled replay end-to-end;
 *   - watch: bounded polls, append-per-poll JSONL journal, cross-poll mint dedupe, injected
 *     sleep (no real waiting in tests);
 *   - safety: watching produces observations only — pinned watch/never-trade literals.
 */

import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJupiterRecentAdapter } from "@soulmaker/realtime";
import type { FetchLike } from "@soulmaker/realtime";
import { paperRealtimeSnapshotReport, paperRealtimeWatchReport, paperSniperCandidatesValidateReport } from "./commands.js";

const MINT_A = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MINT_B = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const FIXED_CLOCK = (): string => "2026-06-12T04:30:00.000Z";

async function withTmpAsync<T>(fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), "realtime-cmd-"));
  try {
    return await fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function writeConfig(tmp: string, mode: string): void {
  writeFileSync(join(tmp, "soulmaker.config.json"), JSON.stringify({ mode }));
}

function feedBody(mints: string[]): string {
  return JSON.stringify(
    mints.map((mint, i) => ({ id: mint, name: `Tok${i}`, symbol: `T${i}`, launchpad: "pump.fun", liquidity: 1500 + i, holderCount: 3, mcap: 9000 })),
  );
}

/** Live-adapter context: first poll sees A, later polls see A+B (new-mint dedupe surface). */
function liveCtx(tmp: string, opts: { mode?: string } = {}) {
  writeConfig(tmp, opts.mode ?? "WATCH_ONLY");
  let call = 0;
  const fetchLike: FetchLike = async () => {
    call += 1;
    return { ok: true, status: 200, text: async () => feedBody(call === 1 ? [MINT_A] : [MINT_A, MINT_B]) };
  };
  return {
    cwd: tmp,
    env: {},
    createCandidateSource: () => createJupiterRecentAdapter({ fetchLike, clock: FIXED_CLOCK }),
    sleep: async () => {},
    now: FIXED_CLOCK,
  };
}

const readJson = (tmp: string, name: string): unknown => JSON.parse(readFileSync(join(tmp, name), "utf8"));

describe("paper:realtime:snapshot — refusals", () => {
  it("refuses a bad source, replay without a file, and a malformed replay file", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp, "WATCH_ONLY");
      const ctx = { cwd: tmp, env: {} };
      expect((await paperRealtimeSnapshotReport(ctx, { source: "telepathy" })).text).toContain("--source");
      expect((await paperRealtimeSnapshotReport(ctx, { source: "replay" })).text).toContain("--replay-file");
      writeFileSync(join(tmp, "replay.json"), JSON.stringify({ nope: true }));
      const r = await paperRealtimeSnapshotReport(ctx, { source: "replay", replayFile: "replay.json" });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("events array");
    });
  });

  it("refuses a PAPER-mode LIVE read without --allow-paper-read; replay needs no gate", async () => {
    await withTmpAsync(async (tmp) => {
      const ctx = liveCtx(tmp, { mode: "PAPER" });
      const live = await paperRealtimeSnapshotReport(ctx, {});
      expect(live.exitCode).toBe(1);
      expect(live.text).toContain("--allow-paper-read");

      writeFileSync(join(tmp, "replay.json"), JSON.stringify({ events: [{ mint: MINT_A, symbol: "AAA" }] }));
      const replay = await paperRealtimeSnapshotReport(ctx, { source: "replay", replayFile: "replay.json", json: true });
      expect(replay.exitCode, replay.text.slice(0, 300)).toBe(0);
      const snapshot = JSON.parse(replay.text) as Record<string, unknown>;
      expect(snapshot.sourceKind).toBe("replay");
    });
  });

  it("refuses a missing --out-dir directory and overwrite without --force", async () => {
    await withTmpAsync(async (tmp) => {
      const ctx = liveCtx(tmp);
      expect((await paperRealtimeSnapshotReport(ctx, { outDir: "missing" })).text).toContain("does not exist");
      writeFileSync(join(tmp, "snapshot.json"), "{}");
      const r = await paperRealtimeSnapshotReport(ctx, { outDir: "." });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("already exists");
    });
  });
});

describe("paper:realtime:snapshot — happy path", () => {
  it("writes snapshot.json + candidates.json; the candidates feed the REAL validator", async () => {
    await withTmpAsync(async (tmp) => {
      const ctx = liveCtx(tmp);
      const r = await paperRealtimeSnapshotReport(ctx, { outDir: "." });
      expect(r.exitCode, r.text.slice(0, 400)).toBe(0);
      expect(r.text).toContain("wrote 2 file(s)");
      expect(r.text).toContain("paper:sniper:dry-run");

      const snapshot = readJson(tmp, "snapshot.json") as Record<string, unknown>;
      expect(snapshot.schemaVersion).toBe("realtime.candidates.snapshot.v1");
      expect(snapshot.watchOnly).toBe(true);
      expect(snapshot.neverTrades).toBe(true);
      expect(snapshot.phase7LiveTradingReady).toBe(false);

      const validate = paperSniperCandidatesValidateReport({ cwd: tmp, env: {} }, { inputPath: "candidates.json", json: true });
      expect(validate.exitCode, validate.text.slice(0, 300)).toBe(0);
      expect(validate.text).toContain(MINT_A);
    });
  });

  it("--fail-on-not-observed gates a blocked poll; the artifact stays honest", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp, "WATCH_ONLY");
      const blockedFetch: FetchLike = async () => ({ ok: false, status: 429, text: async () => "x" });
      const ctx = {
        cwd: tmp,
        env: {},
        createCandidateSource: () => createJupiterRecentAdapter({ fetchLike: blockedFetch, clock: FIXED_CLOCK }),
      };
      const r = await paperRealtimeSnapshotReport(ctx, { json: true, failOnNotObserved: true });
      expect(r.exitCode).toBe(1);
      const snapshot = JSON.parse(r.text) as Record<string, unknown>;
      expect(snapshot.status).toBe("blocked");
      expect(snapshot.keptCount).toBe(0);
    });
  });
});

describe("paper:realtime:watch — bounded, journaled, deduplicated", () => {
  it("refuses unbounded/missing polls, bad interval, and a missing journal", async () => {
    await withTmpAsync(async (tmp) => {
      const ctx = liveCtx(tmp);
      expect((await paperRealtimeWatchReport(ctx, { journal: "j.jsonl" })).text).toContain("--polls");
      expect((await paperRealtimeWatchReport(ctx, { polls: "121", journal: "j.jsonl" })).text).toContain("--polls");
      expect((await paperRealtimeWatchReport(ctx, { polls: "2", intervalMs: "50", journal: "j.jsonl" })).text).toContain("--interval-ms");
      expect((await paperRealtimeWatchReport(ctx, { polls: "2" })).text).toContain("--journal");
    });
  });

  it("appends one JSONL line per poll and deduplicates new mints across polls", async () => {
    await withTmpAsync(async (tmp) => {
      const ctx = liveCtx(tmp);
      const r = await paperRealtimeWatchReport(ctx, { polls: "3", intervalMs: "1000", journal: "watch.jsonl", json: true });
      expect(r.exitCode, r.text.slice(0, 400)).toBe(0);
      const summary = JSON.parse(r.text) as Record<string, unknown>;
      expect(summary.schemaVersion).toBe("realtime.watch.summary.v1");
      expect(summary.polls).toBe(3);
      expect(summary.distinctMintsObserved).toBe(2);
      expect(summary.neverTrades).toBe(true);
      expect(summary.phase7LiveTradingReady).toBe(false);

      const lines = readFileSync(join(tmp, "watch.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(lines).toHaveLength(3);
      expect(lines[0]?.newMintCount).toBe(1); // poll 1: A is new
      expect(lines[1]?.newMintCount).toBe(1); // poll 2: B is new (A deduplicated)
      expect(lines[2]?.newMintCount).toBe(0); // poll 3: nothing new
      for (const line of lines) {
        expect(line.watchOnly).toBe(true);
        expect(line.neverTrades).toBe(true);
      }
    });
  });

  it("a mid-watch poll failure is journaled as an error line and the watch continues", async () => {
    await withTmpAsync(async (tmp) => {
      writeConfig(tmp, "WATCH_ONLY");
      let call = 0;
      const flaky: FetchLike = async () => {
        call += 1;
        if (call === 2) throw new Error("socket hang up");
        return { ok: true, status: 200, text: async () => feedBody([MINT_A]) };
      };
      const ctx = {
        cwd: tmp,
        env: {},
        createCandidateSource: () => createJupiterRecentAdapter({ fetchLike: flaky, clock: FIXED_CLOCK }),
        sleep: async () => {},
      };
      const r = await paperRealtimeWatchReport(ctx, { polls: "3", journal: "watch.jsonl", json: true });
      expect(r.exitCode).toBe(0);
      const lines = readFileSync(join(tmp, "watch.jsonl"), "utf8").trim().split("\n");
      expect(lines).toHaveLength(3);
      expect(existsSync(join(tmp, "watch.jsonl"))).toBe(true);
    });
  });
});
