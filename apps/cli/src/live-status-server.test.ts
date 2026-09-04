import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createStatusServer, readExecutions, readStatus, STATUS_STALE_AFTER_SECONDS_DEFAULT } from "./live-status-server.js";

const SIG = "9".repeat(88);
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const getJson = async (url: string, init?: RequestInit): Promise<J> => (await (await fetch(url, init)).json()) as J;
const NOW = Date.parse("2026-09-03T12:00:00.000Z");
function status(over: Record<string, unknown> = {}, atOffsetSeconds = 0, running = true): string {
  return JSON.stringify({ schemaVersion: "live.runtime.status.v1", at: new Date(NOW - atOffsetSeconds * 1000).toISOString(), daemon: { running, mode: "live", armed: true, loops: 3, endedBy: running ? null : "max-loops-reached" }, stops: { safeStop: false, hardStop: false }, wallet: { publicKey: "8woaFdNBscqrqV2AZBu9ycTpmnrTkuKE1aZJLYWamFPh", solLamports: 190_000_000 }, positions: { open: 0, openList: [], recentClosed: [] }, execution: { lastSignature: SIG }, ...over });
}

describe("readStatus liveness (S111)", () => {
  it("NO_LIVE_STATUS when absent or unreadable; STOPPED when running=false; STALE past the heartbeat; RUNNING otherwise", () => {
    const d = mkdtempSync(join(tmpdir(), "s111-status-"));
    const p = join(d, "status.json");
    expect(readStatus(p, NOW, 90).liveness).toBe("NO_LIVE_STATUS");
    writeFileSync(p, "{not json");
    expect(readStatus(p, NOW, 90).liveness).toBe("NO_LIVE_STATUS");
    writeFileSync(p, status({}, 5, false));
    expect(readStatus(p, NOW, 90).liveness).toBe("STOPPED");
    writeFileSync(p, status({}, 200, true));
    const stale = readStatus(p, NOW, 90);
    expect(stale.liveness).toBe("STALE");
    expect(stale.ageSeconds).toBe(200);
    writeFileSync(p, status({}, 5, true));
    expect(readStatus(p, NOW, STATUS_STALE_AFTER_SECONDS_DEFAULT).liveness).toBe("RUNNING");
    rmSync(d, { recursive: true, force: true });
  });
});

describe("live:status:serve (S111)", () => {
  let dir: string;
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => { if (close) await close(); close = null; rmSync(dir, { recursive: true, force: true }); });

  async function boot(files: Record<string, string>, nowMs = NOW): Promise<string> {
    dir = mkdtempSync(join(tmpdir(), "s111-serve-"));
    mkdirSync(join(dir, "web"));
    writeFileSync(join(dir, "web", "live.html"), "<html>live</html>");
    for (const [k, v] of Object.entries(files)) writeFileSync(join(dir, k), v);
    const server = createStatusServer({ statusPath: join(dir, "status.json"), auditLogPath: join(dir, "audit.jsonl"), webDir: join(dir, "web"), staleAfterSeconds: 90, nowMs: () => nowMs });
    await new Promise<void>((r) => { server.listen(0, "127.0.0.1", () => r()); });
    close = () => new Promise<void>((r) => { server.close(() => r()); });
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("serves the page, /health, and an honest 503 NO_LIVE_STATUS when no daemon has published", async () => {
    const base = await boot({});
    expect(await (await fetch(`${base}/`)).text()).toContain("live");
    const h = await getJson(`${base}/health`);
    expect(h.liveness).toBe("NO_LIVE_STATUS");
    const s = await fetch(`${base}/api/live/status`);
    expect(s.status).toBe(503);
    expect(((await s.json()) as J).status).toBeNull();
  });

  it("serves RUNNING status with the public signature intact, and STALE when the heartbeat is old", async () => {
    const base = await boot({ "status.json": status({}, 5, true), "audit.jsonl": JSON.stringify({ schemaVersion: "live.mainnet.execution.v1", side: "buy", outcome: "confirmed", attemptedAt: "t", mint: "m", signature: SIG, confirm: { slot: 12, status: "confirmed" } }) + "\n" });
    const j = await getJson(`${base}/api/live/status`);
    expect(j.liveness).toBe("RUNNING");
    expect(j.status.execution.lastSignature).toBe(SIG);
    const ex = await getJson(`${base}/api/live/executions`);
    expect(ex.executions[0].signature).toBe(SIG);
    expect(ex.executions[0].slot).toBe(12);
    writeFileSync(join(dir, "status.json"), status({}, 500, true));
    expect((await getJson(`${base}/api/live/status`)).liveness).toBe("STALE");
  });

  it("refuses path traversal and non-GET", async () => {
    const base = await boot({});
    expect((await fetch(`${base}/../status.json`)).status).not.toBe(200);
    expect((await fetch(`${base}/health`, { method: "POST" })).status).toBe(405);
  });

  it("readExecutions skips malformed lines and unrelated schemas", () => {
    const d = mkdtempSync(join(tmpdir(), "s111-audit-"));
    writeFileSync(join(d, "a.jsonl"), 'nope\n{"schemaVersion":"other"}\n' + JSON.stringify({ schemaVersion: "live.mainnet.execution.v1", side: "sell", outcome: "failed-onchain", attemptedAt: "t", mint: "m", signature: SIG }) + "\n");
    const ex = readExecutions(join(d, "a.jsonl"));
    expect(ex).toHaveLength(1);
    expect((ex[0] as { outcome: string }).outcome).toBe("failed-onchain");
    rmSync(d, { recursive: true, force: true });
  });
});
