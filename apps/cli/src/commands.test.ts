import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  doctorReport,
  configCheckReport,
  modeReport,
  paperStatusReport,
  solanaDoctorReport,
  walletWatchReport,
  tokenInspectReport,
  tokenAccountsReport,
  tokenRiskReport,
} from "./commands.js";
import type {
  ReadOnlyClientConfig,
  ReadOnlySolanaClient,
} from "@soulmaker/solana";

/** Write a temp config dir and return its path + a cleanup fn. */
function withConfig(config: unknown): { cwd: string; cleanup: () => void } {
  const cwd = mkdtempSync(join(tmpdir(), "soulmaker-cli-"));
  writeFileSync(
    join(cwd, "soulmaker.config.json"),
    JSON.stringify(config, null, 2),
  );
  return { cwd, cleanup: () => rmSync(cwd, { recursive: true, force: true }) };
}

const VALID_PUBKEY = "So11111111111111111111111111111111111111112";

/** An in-memory read-only client so CLI tests never touch the network. */
function fakeSolanaClient(): ReadOnlySolanaClient {
  return {
    endpointHost: "rpc.example.com",
    getRpcHealth: async () => ({
      ok: true,
      endpointHost: "rpc.example.com",
      solanaCore: "1.18.22",
      slot: 7,
    }),
    getVersion: async () => ({ solanaCore: "1.18.22" }),
    getSolBalance: async () => ({
      ownerBase58: VALID_PUBKEY,
      lamports: 1_000_000_000,
      sol: 1,
    }),
    getTokenAccounts: async () => [
      {
        tokenAccount: "Tok1111111111111111111111111111111111111111",
        mint: "Min1111111111111111111111111111111111111111",
        programLabel: "spl-token",
        amountRaw: "1000",
        decimals: 3,
        uiAmount: 1,
      },
    ],
    getTokenMintInfo: async () => ({
      mint: VALID_PUBKEY,
      decimals: 9,
      supplyRaw: "0",
      uiSupply: 0,
      mintAuthorityPresent: false,
      freezeAuthorityPresent: false,
      isInitialized: true,
      programLabel: "spl-token",
      source: "test",
    }),
  };
}

const fakeClientFactory = (_config: ReadOnlyClientConfig): ReadOnlySolanaClient =>
  fakeSolanaClient();

describe("doctorReport", () => {
  it("reports a healthy, safe default config", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const out = doctorReport({ cwd, env: {} });
      expect(out).toContain("Result: healthy.");
      expect(out).toContain("live gate:      CLOSED (safe)");
      expect(out).toContain("can send funds: no");
    } finally {
      cleanup();
    }
  });

  it("keeps the live gate CLOSED even in burner-live mode without env flags", () => {
    const { cwd, cleanup } = withConfig({
      mode: "DANGEROUS_BURNER_LIVE",
      live: { acknowledgeBurnerRisk: true, confirmFreshBurner: true },
    });
    try {
      const out = doctorReport({ cwd, env: {} });
      expect(out).toContain("live gate:      CLOSED (safe)");
    } finally {
      cleanup();
    }
  });
});

describe("configCheckReport", () => {
  it("validates a good config", () => {
    const { cwd, cleanup } = withConfig({ mode: "WATCH_ONLY" });
    try {
      expect(configCheckReport({ cwd, env: {} })).toContain("Config is VALID.");
    } finally {
      cleanup();
    }
  });

  it("reports an invalid config without throwing", () => {
    const { cwd, cleanup } = withConfig({ mode: "NONSENSE" });
    try {
      expect(configCheckReport({ cwd, env: {} })).toContain("Config is INVALID.");
    } finally {
      cleanup();
    }
  });

  it("does not print secrets even if a config-shaped secret sneaks in", () => {
    // burnerKeyEnvVar is just a NAME, but prove redaction runs over output.
    const { cwd, cleanup } = withConfig({
      mode: "WATCH_ONLY",
      rpcUrl: "https://rpc.example.com/?api-key=supersecret",
    });
    try {
      const out = configCheckReport({ cwd, env: {} });
      expect(out).not.toContain("supersecret");
    } finally {
      cleanup();
    }
  });
});

describe("modeReport", () => {
  it("shows PAPER cannot send", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const out = modeReport({ cwd, env: {} });
      expect(out).toContain("sign & send funds: no");
    } finally {
      cleanup();
    }
  });
});

describe("paperStatusReport", () => {
  it("reports an empty paper journal", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const out = paperStatusReport({ cwd, env: {} });
      expect(out).toContain("open positions:  0");
      expect(out).toContain("Phase 4");
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 2 — read-only Solana commands
// ---------------------------------------------------------------------------

describe("solanaDoctorReport", () => {
  it("explains PAPER cannot read chain and reports no rpc url", async () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const out = await solanaDoctorReport({ cwd, env: {} });
      expect(out).toContain("reads chain:     no (mode PAPER)");
      expect(out).toContain("rpc url set:     no");
      expect(out).toContain("No rpcUrl configured");
    } finally {
      cleanup();
    }
  });

  it("runs a read-only health check when an rpc url is set", async () => {
    const { cwd, cleanup } = withConfig({
      mode: "WATCH_ONLY",
      rpcUrl: "https://rpc.example.com/?api-key=SUPERSECRET",
    });
    try {
      const out = await solanaDoctorReport({
        cwd,
        env: {},
        createClient: fakeClientFactory,
      });
      expect(out).toContain("rpc health:      OK");
      expect(out).toContain("rpc host:        rpc.example.com");
      // The api-key in the configured rpcUrl must never be printed.
      expect(out).not.toContain("SUPERSECRET");
    } finally {
      cleanup();
    }
  });
});

describe("walletWatchReport", () => {
  it("refuses in PAPER mode without --allow-paper-read", async () => {
    const { cwd, cleanup } = withConfig({
      mode: "PAPER",
      rpcUrl: "https://rpc.example.com",
    });
    try {
      const out = await walletWatchReport(VALID_PUBKEY, {
        cwd,
        env: {},
        createClient: fakeClientFactory,
      });
      expect(out).toMatch(/^Refusing: mode PAPER does not read chain/);
    } finally {
      cleanup();
    }
  });

  it("allows a PAPER read when --allow-paper-read is passed", async () => {
    const { cwd, cleanup } = withConfig({
      mode: "PAPER",
      rpcUrl: "https://rpc.example.com",
    });
    try {
      const out = await walletWatchReport(
        VALID_PUBKEY,
        { cwd, env: {}, createClient: fakeClientFactory },
        { allowPaperRead: true },
      );
      expect(out).toContain("Wallet watch (READ-ONLY)");
      expect(out).toContain(VALID_PUBKEY);
    } finally {
      cleanup();
    }
  });

  it("refuses when no rpc url is configured", async () => {
    const { cwd, cleanup } = withConfig({ mode: "WATCH_ONLY" });
    try {
      const out = await walletWatchReport(VALID_PUBKEY, {
        cwd,
        env: {},
        createClient: fakeClientFactory,
      });
      expect(out).toMatch(/Refusing: no rpcUrl configured/);
    } finally {
      cleanup();
    }
  });

  it("refuses an invalid public key", async () => {
    const { cwd, cleanup } = withConfig({
      mode: "WATCH_ONLY",
      rpcUrl: "https://rpc.example.com",
    });
    try {
      const out = await walletWatchReport("not-a-key", {
        cwd,
        env: {},
        createClient: fakeClientFactory,
      });
      expect(out).toMatch(/^Refusing:/);
    } finally {
      cleanup();
    }
  });

  it("works with NO burner env vars set (Phase 2 needs none)", async () => {
    const { cwd, cleanup } = withConfig({
      mode: "WATCH_ONLY",
      rpcUrl: "https://rpc.example.com",
    });
    try {
      // env is deliberately empty: no SOULMAKER_I_UNDERSTAND_BURNER_RISK,
      // no burner key — read-only watching must not require any of them.
      const out = await walletWatchReport(VALID_PUBKEY, {
        cwd,
        env: {},
        createClient: fakeClientFactory,
      });
      expect(out).toContain("Wallet watch (READ-ONLY)");
      expect(out).toContain("no transaction was built, signed, or sent");
    } finally {
      cleanup();
    }
  });
});

describe("tokenInspectReport", () => {
  it("refuses an invalid mint", async () => {
    const { cwd, cleanup } = withConfig({
      mode: "WATCH_ONLY",
      rpcUrl: "https://rpc.example.com",
    });
    try {
      const out = await tokenInspectReport("bad-mint", {
        cwd,
        env: {},
        createClient: fakeClientFactory,
      });
      expect(out).toMatch(/^Refusing:/);
    } finally {
      cleanup();
    }
  });

  it("prints a mint inspection that warns it is not a buy recommendation", async () => {
    const { cwd, cleanup } = withConfig({
      mode: "WATCH_ONLY",
      rpcUrl: "https://rpc.example.com",
    });
    try {
      const out = await tokenInspectReport(VALID_PUBKEY, {
        cwd,
        env: {},
        createClient: fakeClientFactory,
      });
      expect(out).toContain("Token mint inspection (READ-ONLY)");
      expect(out).toMatch(/NOT a buy recommendation/i);
    } finally {
      cleanup();
    }
  });
});

describe("tokenAccountsReport", () => {
  it("lists token accounts read-only for a valid owner", async () => {
    const { cwd, cleanup } = withConfig({
      mode: "WATCH_ONLY",
      rpcUrl: "https://rpc.example.com",
    });
    try {
      const out = await tokenAccountsReport(VALID_PUBKEY, {
        cwd,
        env: {},
        createClient: fakeClientFactory,
      });
      expect(out).toContain("SPL token accounts (READ-ONLY)");
      expect(out).toContain("token accounts:  1");
    } finally {
      cleanup();
    }
  });

  it("refuses an invalid owner key", async () => {
    const { cwd, cleanup } = withConfig({
      mode: "WATCH_ONLY",
      rpcUrl: "https://rpc.example.com",
    });
    try {
      const out = await tokenAccountsReport("xxx", {
        cwd,
        env: {},
        createClient: fakeClientFactory,
      });
      expect(out).toMatch(/^Refusing:/);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — read-only advisory risk command
// ---------------------------------------------------------------------------

const FIXED_TIME = "2026-06-05T12:00:00.000Z";

describe("tokenRiskReport", () => {
  it("refuses an invalid mint", async () => {
    const { cwd, cleanup } = withConfig({
      mode: "WATCH_ONLY",
      rpcUrl: "https://rpc.example.com",
    });
    try {
      const out = await tokenRiskReport("bad-mint", {
        cwd,
        env: {},
        createClient: fakeClientFactory,
      });
      expect(out).toMatch(/^Refusing:/);
    } finally {
      cleanup();
    }
  });

  it("refuses when no rpc url is configured", async () => {
    const { cwd, cleanup } = withConfig({ mode: "WATCH_ONLY" });
    try {
      const out = await tokenRiskReport(VALID_PUBKEY, {
        cwd,
        env: {},
        createClient: fakeClientFactory,
      });
      expect(out).toMatch(/Refusing: no rpcUrl configured/);
    } finally {
      cleanup();
    }
  });

  it("refuses in PAPER mode without --allow-paper-read", async () => {
    const { cwd, cleanup } = withConfig({
      mode: "PAPER",
      rpcUrl: "https://rpc.example.com",
    });
    try {
      const out = await tokenRiskReport(VALID_PUBKEY, {
        cwd,
        env: {},
        createClient: fakeClientFactory,
      });
      expect(out).toMatch(/^Refusing: mode PAPER does not read chain/);
    } finally {
      cleanup();
    }
  });

  it("works in PAPER mode with --allow-paper-read and a fake RPC client", async () => {
    const { cwd, cleanup } = withConfig({
      mode: "PAPER",
      rpcUrl: "https://rpc.example.com",
    });
    try {
      const out = await tokenRiskReport(
        VALID_PUBKEY,
        { cwd, env: {}, createClient: fakeClientFactory, now: () => FIXED_TIME },
        { allowPaperRead: true },
      );
      expect(out).toContain("Token risk report (READ-ONLY)");
      expect(out).toContain(`mint:        ${VALID_PUBKEY}`);
      expect(out).toContain("generated:   " + FIXED_TIME);
    } finally {
      cleanup();
    }
  });

  it("states READ-ONLY, not-a-buy-recommendation, and no transaction sent", async () => {
    const { cwd, cleanup } = withConfig({
      mode: "WATCH_ONLY",
      rpcUrl: "https://rpc.example.com",
    });
    try {
      const out = await tokenRiskReport(VALID_PUBKEY, {
        cwd,
        env: {},
        createClient: fakeClientFactory,
      });
      expect(out).toContain("READ-ONLY");
      expect(out).toMatch(/not a buy recommendation/i);
      expect(out).toMatch(/no transaction was built, signed, simulated, or sent/i);
    } finally {
      cleanup();
    }
  });

  it("does not leak an RPC api-key into the report", async () => {
    const { cwd, cleanup } = withConfig({
      mode: "WATCH_ONLY",
      rpcUrl: "https://rpc.example.com/?api-key=SUPERSECRET",
    });
    try {
      const out = await tokenRiskReport(VALID_PUBKEY, {
        cwd,
        env: {},
        createClient: fakeClientFactory,
      });
      expect(out).not.toContain("SUPERSECRET");
    } finally {
      cleanup();
    }
  });

  it("--json emits parseable JSON with the advisory fields and phrasing", async () => {
    const { cwd, cleanup } = withConfig({
      mode: "WATCH_ONLY",
      rpcUrl: "https://rpc.example.com",
    });
    try {
      const out = await tokenRiskReport(
        VALID_PUBKEY,
        { cwd, env: {}, createClient: fakeClientFactory, now: () => FIXED_TIME },
        { json: true },
      );
      const parsed = JSON.parse(out) as {
        mint: string;
        score: number;
        decision: string;
        flags: unknown[];
        summary: string[];
        disclaimer: string;
        generatedAt: string;
      };
      expect(parsed.mint).toBe(VALID_PUBKEY);
      expect(typeof parsed.score).toBe("number");
      expect(Array.isArray(parsed.flags)).toBe(true);
      expect(parsed.generatedAt).toBe(FIXED_TIME);
      // Required product language survives in the serialized form too.
      expect(out).toContain("READ-ONLY");
      expect(out).toMatch(/not a buy recommendation/i);
      expect(out).toMatch(/no transaction was built, signed, simulated, or sent/i);
    } finally {
      cleanup();
    }
  });

  it("a denylist file (with comments/blanks) drives a REJECT decision", async () => {
    const { cwd, cleanup } = withConfig({
      mode: "WATCH_ONLY",
      rpcUrl: "https://rpc.example.com",
    });
    try {
      writeFileSync(
        join(cwd, "deny.txt"),
        ["# known-bad mints", "", `${VALID_PUBKEY}   # rugged`, ""].join("\n"),
      );
      const out = await tokenRiskReport(
        VALID_PUBKEY,
        { cwd, env: {}, createClient: fakeClientFactory, now: () => FIXED_TIME },
        { denylistPath: "deny.txt" },
      );
      expect(out).toContain("decision:    REJECT");
      expect(out).toMatch(/denylist/i);
    } finally {
      cleanup();
    }
  });

  it("refuses cleanly when a list file cannot be read", async () => {
    const { cwd, cleanup } = withConfig({
      mode: "WATCH_ONLY",
      rpcUrl: "https://rpc.example.com",
    });
    try {
      const out = await tokenRiskReport(
        VALID_PUBKEY,
        { cwd, env: {}, createClient: fakeClientFactory },
        { allowlistPath: "does-not-exist.txt" },
      );
      expect(out).toMatch(/^Refusing: cannot read allowlist list file/);
    } finally {
      cleanup();
    }
  });
});
