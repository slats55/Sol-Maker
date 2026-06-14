/**
 * Sprint 105-B — `paper:sniper:provider:doctor` (READ-ONLY provider readiness).
 *
 * These tests pin, over INJECTED seams (no network in tests):
 *   - all-available → canRunLiveReadonlyCampaign true, the safety literals pinned;
 *   - RPC / Jupiter unavailable, timeout, rate-limited → honest statuses, live-readiness false;
 *   - a secret-bearing endpoint is reduced to its host and never printed raw;
 *   - flag > env precedence;
 *   - output file behaviour (write + overwrite protection);
 *   - the doctor never reaches a send / sign / build / simulate seam — its report can never authorize live.
 *
 * All endpoints / mints here are public, well-known reads; the injected adapters fabricate nothing
 * beyond the closed health / observation contracts.
 */

import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJupiterQuoteAdapter, type QuoteProviderAdapter, type FetchLike } from "@soulmaker/quotefetch";
import type { EngineProcessRunner } from "@soulmaker/engine-bridge";
import type { ReadOnlyClientConfig, ReadOnlySolanaClient, RpcHealth } from "@soulmaker/solana";
import { validateSniperProviderHealthReport } from "@soulmaker/sniper";
import { paperSniperProviderDoctorReport } from "./commands.js";

const WSOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const FIXED_CLOCK = (): string => "2026-06-13T03:00:00.000Z";

async function withTmp<T>(fn: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = mkdtempSync(join(tmpdir(), "provider-doctor-"));
  try {
    return await fn(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** A fake read-only RPC client exposing only getRpcHealth (the doctor uses nothing else). */
function fakeClient(health: RpcHealth): (config: ReadOnlyClientConfig) => ReadOnlySolanaClient {
  return (config) =>
    ({
      endpointHost: "fake",
      getRpcHealth: async (): Promise<RpcHealth> => ({ ...health, endpointHost: config.rpcUrl }) as RpcHealth,
    }) as unknown as ReadOnlySolanaClient;
}

function quoteBody(): string {
  return JSON.stringify({
    inputMint: WSOL_MINT,
    inAmount: "1000000",
    outputMint: USDC_MINT,
    outAmount: "142000",
    otherAmountThreshold: "141000",
    priceImpactPct: "0.01",
    routePlan: [{ swapInfo: { label: "PublicVenue" } }],
    contextSlot: 999999,
  });
}

/** Jupiter adapter over an injected fetch; `mode` chooses the honest outcome. */
function jupiterAdapter(mode: "ok" | "rate-limited" | "down"): () => QuoteProviderAdapter {
  const fetchLike: FetchLike = async () => {
    if (mode === "rate-limited") return { ok: false, status: 429, text: async () => "rate limited" };
    if (mode === "down") throw new Error("network error: ECONNREFUSED");
    return { ok: true, status: 200, text: async () => quoteBody() };
  };
  return () => createJupiterQuoteAdapter({ fetchLike, clock: FIXED_CLOCK });
}

function okEngineRunner(): EngineProcessRunner {
  return {
    run(_c, args) {
      const idx = args.indexOf("--created-at");
      const createdAt = idx === -1 ? null : (args[idx + 1] ?? null);
      const artifact = {
        schemaVersion: "engine.status.report.v1",
        banner: "RUST ENGINE STATUS — test fixture banner.",
        engineName: "solmaker-engine",
        engineVersion: "0.1.0",
        buildProfile: "debug",
        rustcVersion: "rustc 1.96.0",
        ipcVersion: "engine.ipc.v1",
        safetyMode: "sidecar-read-only",
        signerSupport: "disabled",
        sendSupport: "disabled",
        mainnetSendSupport: "disabled",
        supportedCapabilities: ["json-ipc", "schema-parity", "status"],
        disabledCapabilities: ["mainnet-live", "seed-phrase-handling", "sending", "signing", "wallet-loading"],
        createdAt,
        caveats: ["test fixture caveat"],
        neverSends: true,
        phase7LiveTradingReady: false,
      };
      return Promise.resolve({
        started: true,
        startError: null,
        exitCode: 0,
        timedOut: false,
        stdout: JSON.stringify(artifact) + "\n",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      });
    },
  };
}

function missingEngineRunner(): EngineProcessRunner {
  return {
    run() {
      return Promise.resolve({
        started: false,
        startError: "ENOENT",
        exitCode: null,
        timedOut: false,
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      });
    },
  };
}

const HEALTHY: RpcHealth = { ok: true, endpointHost: "x", solanaCore: "1.18.0", featureSet: 1, slot: 123 };

function ctxWith(opts: {
  rpcHealth?: RpcHealth;
  jupiter?: "ok" | "rate-limited" | "down";
  engine?: "ok" | "missing";
  env?: Record<string, string | undefined>;
  cwd?: string;
}) {
  return {
    cwd: opts.cwd ?? "/repo",
    env: (opts.env ?? {}) as NodeJS.ProcessEnv,
    now: FIXED_CLOCK,
    createClient: fakeClient(opts.rpcHealth ?? HEALTHY),
    createQuoteAdapter: jupiterAdapter(opts.jupiter ?? "ok"),
    createEngineRunner: () => (opts.engine === "missing" ? missingEngineRunner() : okEngineRunner()),
    engineBinaryExists: () => false,
  };
}

const readJson = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, "utf8"));

describe("paper:sniper:provider:doctor — all providers available", () => {
  it("emits a valid report; live-readonly campaign is allowed; safety literals are pinned", async () => {
    const r = await paperSniperProviderDoctorReport(ctxWith({ jupiter: "ok", engine: "ok" }), { mode: "mainnet-dry-run", json: true });
    expect(r.exitCode).toBe(0);
    const report = JSON.parse(r.text) as Record<string, unknown>;
    expect(() => validateSniperProviderHealthReport(report)).not.toThrow();
    expect(report.canRunLiveReadonlyCampaign).toBe(true);
    expect(report.liveSendStatus).toBe("disabled");
    expect(report.noSend).toBe(true);
    expect(report.noSigner).toBe(true);
    expect(report.authorizesLiveTrading).toBe(false);
    const checks = report.checks as Array<Record<string, unknown>>;
    expect(checks.find((c) => c.provider === "rpc")?.status).toBe("available");
    expect(checks.find((c) => c.provider === "jupiter-quote")?.status).toBe("available");
    expect(checks.find((c) => c.provider === "rust-engine")?.status).toBe("available");
  });
});

describe("paper:sniper:provider:doctor — honest provider failures", () => {
  it("RPC unavailable → status unavailable, live-readonly false", async () => {
    const r = await paperSniperProviderDoctorReport(
      ctxWith({ rpcHealth: { ok: false, endpointHost: "x", error: "connection refused" } }),
      { mode: "mainnet-dry-run", json: true },
    );
    const report = JSON.parse(r.text) as Record<string, unknown>;
    const checks = report.checks as Array<Record<string, unknown>>;
    expect(checks.find((c) => c.provider === "rpc")?.status).toBe("unavailable");
    expect(report.canRunLiveReadonlyCampaign).toBe(false);
  });

  it("RPC timeout is classified as timeout", async () => {
    const r = await paperSniperProviderDoctorReport(
      ctxWith({ rpcHealth: { ok: false, endpointHost: "x", error: "request timed out after 10000ms" } }),
      { mode: "mainnet-dry-run", json: true },
    );
    const checks = (JSON.parse(r.text) as Record<string, unknown>).checks as Array<Record<string, unknown>>;
    expect(checks.find((c) => c.provider === "rpc")?.status).toBe("timeout");
  });

  it("Jupiter rate-limited (HTTP 429) → status rate-limited, live-readonly false", async () => {
    const r = await paperSniperProviderDoctorReport(ctxWith({ jupiter: "rate-limited" }), { mode: "mainnet-dry-run", json: true });
    const report = JSON.parse(r.text) as Record<string, unknown>;
    const checks = report.checks as Array<Record<string, unknown>>;
    expect(checks.find((c) => c.provider === "jupiter-quote")?.status).toBe("rate-limited");
    expect(report.canRunLiveReadonlyCampaign).toBe(false);
  });

  it("Jupiter network down → status unavailable", async () => {
    const r = await paperSniperProviderDoctorReport(ctxWith({ jupiter: "down" }), { mode: "mainnet-dry-run", json: true });
    const checks = (JSON.parse(r.text) as Record<string, unknown>).checks as Array<Record<string, unknown>>;
    expect(checks.find((c) => c.provider === "jupiter-quote")?.status).toBe("unavailable");
  });

  it("Rust engine absent → status unavailable, but live-readonly stays true (RPC + quote reachable)", async () => {
    const r = await paperSniperProviderDoctorReport(ctxWith({ engine: "missing" }), { mode: "mainnet-dry-run", json: true });
    const report = JSON.parse(r.text) as Record<string, unknown>;
    const checks = report.checks as Array<Record<string, unknown>>;
    expect(checks.find((c) => c.provider === "rust-engine")?.status).toBe("unavailable");
    expect(report.canRunLiveReadonlyCampaign).toBe(true);
  });

  it("exits non-zero with --fail-on-unavailable when live-readonly cannot run", async () => {
    const r = await paperSniperProviderDoctorReport(
      ctxWith({ rpcHealth: { ok: false, endpointHost: "x", error: "down" } }),
      { mode: "mainnet-dry-run", failOnUnavailable: true },
    );
    expect(r.exitCode).toBe(1);
  });
});

describe("paper:sniper:provider:doctor — redaction + endpoint resolution", () => {
  it("reduces a secret-bearing RPC URL to its host and never prints the key", async () => {
    const r = await paperSniperProviderDoctorReport(
      ctxWith({}),
      { mode: "mainnet-dry-run", rpcUrl: "https://mainnet.helius-rpc.com/?api-key=SUPERSECRETKEY123456", json: true },
    );
    expect(r.text).not.toContain("SUPERSECRETKEY123456");
    const checks = (JSON.parse(r.text) as Record<string, unknown>).checks as Array<Record<string, unknown>>;
    expect(checks.find((c) => c.provider === "rpc")?.redactedEndpoint).toBe("https://mainnet.helius-rpc.com");
  });

  it("prefers a --rpc-url flag over the env var", async () => {
    const r = await paperSniperProviderDoctorReport(
      ctxWith({ env: { SOULMAKER_READONLY_RPC_URL: "https://env-rpc.example.com" } }),
      { mode: "mainnet-dry-run", rpcUrl: "https://flag-rpc.example.com", json: true },
    );
    const checks = (JSON.parse(r.text) as Record<string, unknown>).checks as Array<Record<string, unknown>>;
    expect(checks.find((c) => c.provider === "rpc")?.redactedEndpoint).toBe("https://flag-rpc.example.com");
  });

  it("falls back to the env var when no flag is given", async () => {
    const r = await paperSniperProviderDoctorReport(
      ctxWith({ env: { SOULMAKER_READONLY_RPC_URL: "https://env-rpc.example.com" } }),
      { mode: "mainnet-dry-run", json: true },
    );
    const checks = (JSON.parse(r.text) as Record<string, unknown>).checks as Array<Record<string, unknown>>;
    expect(checks.find((c) => c.provider === "rpc")?.redactedEndpoint).toBe("https://env-rpc.example.com");
  });

  it("a misconfigured RPC URL is marked misconfigured, never probed", async () => {
    const r = await paperSniperProviderDoctorReport(ctxWith({}), { mode: "mainnet-dry-run", rpcUrl: "not a url", json: true });
    const checks = (JSON.parse(r.text) as Record<string, unknown>).checks as Array<Record<string, unknown>>;
    expect(checks.find((c) => c.provider === "rpc")?.status).toBe("misconfigured");
  });
});

describe("paper:sniper:provider:doctor — devnet skips the mainnet-only quote", () => {
  it("skips the Jupiter probe on devnet-review", async () => {
    const r = await paperSniperProviderDoctorReport(ctxWith({}), { mode: "devnet-review", json: true });
    const report = JSON.parse(r.text) as Record<string, unknown>;
    expect(report.network).toBe("devnet");
    const checks = report.checks as Array<Record<string, unknown>>;
    expect(checks.find((c) => c.provider === "jupiter-quote")?.status).toBe("skipped");
  });
});

describe("paper:sniper:provider:doctor — output file behaviour", () => {
  it("writes the report to --out and refuses to overwrite without --force", async () => {
    await withTmp(async (tmp) => {
      const out = join(tmp, "provider-health.json");
      const first = await paperSniperProviderDoctorReport(ctxWith({}), { mode: "mainnet-dry-run", outPath: out });
      expect(first.exitCode).toBe(0);
      expect(existsSync(out)).toBe(true);
      const written = readJson(out);
      expect(() => validateSniperProviderHealthReport(written)).not.toThrow();

      const second = await paperSniperProviderDoctorReport(ctxWith({}), { mode: "mainnet-dry-run", outPath: out });
      expect(second.exitCode).toBe(1);
      expect(second.text).toMatch(/already exists/);

      const forced = await paperSniperProviderDoctorReport(ctxWith({}), { mode: "mainnet-dry-run", outPath: out, force: true });
      expect(forced.exitCode).toBe(0);
    });
  });
});

describe("paper:sniper:provider:doctor — refuses an invalid mode", () => {
  it("rejects a live mode", async () => {
    const r = await paperSniperProviderDoctorReport(ctxWith({}), { mode: "mainnet-live" });
    expect(r.exitCode).toBe(1);
    expect(r.text).toMatch(/Refusing/);
  });
});
