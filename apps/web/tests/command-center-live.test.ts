import { describe, expect, it } from "vitest";
import { COMMAND_CENTER_LIVE_FILENAME, renderCommandCenterLiveHtml } from "../src/live/command-center.js";

const html = renderCommandCenterLiveHtml();

describe("command center (live) — document shape", () => {
  it("is a complete HTML document with a single title and its own file", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html.match(/<title>/g) ?? []).toHaveLength(1);
    expect(COMMAND_CENTER_LIVE_FILENAME).toBe("live.html");
  });
});

describe("command center (live) — read-only, never signs", () => {
  it("carries NO wallet/signing/key code", () => {
    for (const s of ["signAndSendTransaction", "signTransaction", "window.solana", "secretKey", "Keypair", "seed"]) expect(html).not.toContain(s);
  });
});

describe("command center (live) — no fake data, explicit truth states", () => {
  it("polls the real status endpoint and names every honest empty/degraded state", () => {
    expect(html).toContain("/api/live/status");
    expect(html).toContain("/api/live/executions");
    for (const s of ["BACKEND OFFLINE", "NO LIVE STATUS", "NO OPEN POSITIONS", "STALE", "DAEMON STOPPED", "HARD STOP ACTIVE", "SAFE STOP ACTIVE", "RPC HEALTHY", "RPC DOWN", "ARMED", "DISARMED", "LIVE", "PAPER"]) expect(html).toContain(s);
  });
  it("contains no sample balances, signatures, positions or PnL", () => {
    expect(html).not.toMatch(/[1-9A-HJ-NP-Za-km-z]{80,}/);
    expect(html).not.toMatch(/\b\d+\.\d{3,} SOL\b/);
    expect(html).not.toContain("demo");
    expect(html).not.toContain("sample");
    expect(html).toContain("estimate");
  });
});
