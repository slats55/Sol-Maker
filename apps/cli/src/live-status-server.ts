/**
 * LIVE STATUS SERVER (Sprint 111) — the smallest honest bridge between the daemon's atomic
 * `status.json` and the Command Center. Serves the static web build plus:
 *
 *   GET /health                 → { ok, statusPresent, liveness }
 *   GET /api/live/status        → the status document + `liveness` (RUNNING | STALE | STOPPED | NO_LIVE_STATUS)
 *   GET /api/live/positions     → open + recent closed from the status document
 *   GET /api/live/executions    → the last N audit-journal executions (public data; signatures preserved)
 *
 * Never fabricates: a missing/unreadable status file is 503 NO_LIVE_STATUS; a status older than the
 * heartbeat threshold is STALE even if the file says running. Every response is passed through the
 * redactor. No secret can be served because none is ever read.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, join, normalize, resolve } from "node:path";
import { redactValue } from "@soulmaker/security";

export const STATUS_SERVER_DEFAULT_PORT = 8378;
export const STATUS_STALE_AFTER_SECONDS_DEFAULT = 90;
export const LIVENESS = ["RUNNING", "STALE", "STOPPED", "NO_LIVE_STATUS"] as const;
export type Liveness = (typeof LIVENESS)[number];

export interface StatusServerOptions {
  statusPath: string;
  auditLogPath?: string;
  webDir: string;
  port?: number;
  host?: string;
  staleAfterSeconds?: number;
  nowMs?: () => number;
}

interface StatusDoc { at?: string; daemon?: { running?: boolean; [k: string]: unknown }; [k: string]: unknown }

export function readStatus(path: string, nowMs: number, staleAfterSeconds: number): { liveness: Liveness; status: StatusDoc | null; ageSeconds: number | null; error: string | null } {
  if (!existsSync(path)) return { liveness: "NO_LIVE_STATUS", status: null, ageSeconds: null, error: "status.json not found — no daemon has published state" };
  let doc: StatusDoc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8")) as StatusDoc;
  } catch {
    return { liveness: "NO_LIVE_STATUS", status: null, ageSeconds: null, error: "status.json unreadable" };
  }
  const at = typeof doc.at === "string" ? Date.parse(doc.at) : NaN;
  const ageSeconds = Number.isFinite(at) ? Math.max(0, Math.round((nowMs - at) / 1000)) : null;
  if (doc.daemon?.running !== true) return { liveness: "STOPPED", status: doc, ageSeconds, error: null };
  if (ageSeconds === null || ageSeconds > staleAfterSeconds) return { liveness: "STALE", status: doc, ageSeconds, error: `last heartbeat ${ageSeconds ?? "?"}s ago (threshold ${staleAfterSeconds}s)` };
  return { liveness: "RUNNING", status: doc, ageSeconds, error: null };
}

export function readExecutions(auditLogPath: string | undefined, limit = 25): unknown[] {
  if (!auditLogPath || !existsSync(auditLogPath)) return [];
  const lines = readFileSync(auditLogPath, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const out: unknown[] = [];
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try {
      const v = JSON.parse(lines[i] as string) as Record<string, unknown>;
      if (v.schemaVersion === "live.mainnet.execution.v1") {
        out.push({ side: v.side, outcome: v.outcome, attemptedAt: v.attemptedAt, mint: v.mint, signature: v.signature ?? null, slot: (v.confirm as { slot?: number } | null)?.slot ?? null, confirmStatus: (v.confirm as { status?: string } | null)?.status ?? null, refusalDetail: v.refusalDetail ?? null, solDeltaLamports: v.solDeltaLamports ?? null, positionId: (v.position as { positionId?: string } | null)?.positionId ?? null });
      }
    } catch {
      /* skip malformed lines */
    }
  }
  return out;
}

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(redactValue(body)));
}

export function createStatusServer(opts: StatusServerOptions): Server {
  const nowMs = opts.nowMs ?? ((): number => Date.now());
  const stale = opts.staleAfterSeconds ?? STATUS_STALE_AFTER_SECONDS_DEFAULT;
  const webDir = resolve(opts.webDir);
  const statusPath = isAbsolute(opts.statusPath) ? opts.statusPath : resolve(opts.statusPath);
  const auditPath = opts.auditLogPath ? (isAbsolute(opts.auditLogPath) ? opts.auditLogPath : resolve(opts.auditLogPath)) : undefined;

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method !== "GET") return json(res, 405, { error: "GET only" });
    if (url.pathname === "/health") {
      const s = readStatus(statusPath, nowMs(), stale);
      return json(res, 200, { ok: true, statusPresent: s.status !== null, liveness: s.liveness, ageSeconds: s.ageSeconds, at: new Date(nowMs()).toISOString() });
    }
    if (url.pathname === "/api/live/status") {
      const s = readStatus(statusPath, nowMs(), stale);
      if (!s.status) return json(res, 503, { liveness: s.liveness, error: s.error, status: null });
      return json(res, 200, { liveness: s.liveness, ageSeconds: s.ageSeconds, error: s.error, status: s.status });
    }
    if (url.pathname === "/api/live/positions") {
      const s = readStatus(statusPath, nowMs(), stale);
      if (!s.status) return json(res, 503, { liveness: s.liveness, error: s.error, positions: null });
      return json(res, 200, { liveness: s.liveness, positions: (s.status as { positions?: unknown }).positions ?? null });
    }
    if (url.pathname === "/api/live/executions") {
      return json(res, 200, { executions: readExecutions(auditPath) });
    }
    // Static web build. Path traversal is refused by containment.
    let file = normalize(join(webDir, url.pathname === "/" ? "live.html" : url.pathname));
    if (!file.startsWith(webDir)) return json(res, 403, { error: "forbidden" });
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) return json(res, 404, { error: "not found" });
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(readFileSync(file));
  });
}
