import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  doctorReport,
  configCheckReport,
  modeReport,
  paperStatusReport,
  paperRunReport,
  paperJournalReport,
  solanaDoctorReport,
  walletWatchReport,
  tokenInspectReport,
  tokenAccountsReport,
  tokenRiskReport,
  strategyEvaluateReport,
} from "./commands.js";
import { buildTokenRiskReport } from "@soulmaker/risk";
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
  it("prints a clean empty paper state when no journal is provided", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const out = paperStatusReport({ cwd, env: {} });
      expect(out).toContain("open positions:   0");
      expect(out).toContain("PAPER ONLY");
      expect(out).toContain("No journal provided");
      expect(out).toMatch(/no transaction was built, signed, simulated, or sent/i);
    } finally {
      cleanup();
    }
  });

  it("treats a non-existent journal path as a clean empty state", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const out = paperStatusReport(
        { cwd, env: {} },
        { journalPath: "nope.jsonl" },
      );
      expect(out).toContain("open positions:   0");
      expect(out).toContain("PAPER ONLY");
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

// ---------------------------------------------------------------------------
// Phase 4 — paper trading CLI (offline, simulated-only)
// ---------------------------------------------------------------------------

const PAPER_TIME = "2026-06-05T12:00:00.000Z";
const MINT_A = "So11111111111111111111111111111111111111112";

function passReport(mint: string) {
  return buildTokenRiskReport(
    {
      mint,
      decimals: 6,
      supplyRaw: "1000000",
      uiSupply: 1,
      mintAuthorityPresent: false,
      freezeAuthorityPresent: false,
      isInitialized: true,
      programLabel: "spl-token",
    },
    { now: () => PAPER_TIME },
  );
}

function writeFixtures(cwd: string, candidates: unknown, prices: unknown): void {
  writeFileSync(join(cwd, "candidates.json"), JSON.stringify(candidates));
  writeFileSync(join(cwd, "prices.json"), JSON.stringify(prices));
}

const cleanFixtures = () => ({
  candidates: [{ mint: MINT_A, proposedSizeUsd: 100, riskReport: passReport(MINT_A) }],
  prices: [
    { mint: MINT_A, priceUsd: 2, observedAt: PAPER_TIME, source: "injected-fixture" },
    { mint: MINT_A, priceUsd: 3, observedAt: PAPER_TIME, source: "injected-fixture" },
  ],
});

describe("paperRunReport", () => {
  it("refuses when --candidates is missing", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const out = paperRunReport({ cwd, env: {} }, { pricesPath: "prices.json" });
      expect(out).toMatch(/^Refusing: --candidates/);
    } finally {
      cleanup();
    }
  });

  it("refuses when --prices is missing", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const out = paperRunReport({ cwd, env: {} }, { candidatesPath: "candidates.json" });
      expect(out).toMatch(/^Refusing: --prices/);
    } finally {
      cleanup();
    }
  });

  it("refuses a missing candidates file cleanly", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const out = paperRunReport(
        { cwd, env: {} },
        { candidatesPath: "nope.json", pricesPath: "prices.json" },
      );
      expect(out).toMatch(/^Refusing: cannot read candidates file/);
    } finally {
      cleanup();
    }
  });

  it("refuses invalid numeric caps cleanly", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const { candidates, prices } = cleanFixtures();
      writeFixtures(cwd, candidates, prices);
      const out = paperRunReport(
        { cwd, env: {} },
        {
          candidatesPath: "candidates.json",
          pricesPath: "prices.json",
          maxTradeSizeUsd: Number.NaN, // invalid
        },
      );
      expect(out).toMatch(/^Refusing: invalid max-trade-size-usd/);
    } finally {
      cleanup();
    }
  });

  it("runs deterministically with injected fixtures and reports PAPER ONLY", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const { candidates, prices } = cleanFixtures();
      writeFixtures(cwd, candidates, prices);
      const run = () =>
        paperRunReport(
          { cwd, env: {}, now: () => PAPER_TIME },
          {
            candidatesPath: "candidates.json",
            pricesPath: "prices.json",
            maxTradeSizeUsd: 1000,
          },
        );
      const out = run();
      expect(out).toContain("Paper run");
      expect(out).toContain("PAPER ONLY");
      expect(out).toContain("buys / sells:     1 / 0");
      expect(out).toMatch(/not a buy recommendation|not safe to buy or live-trade/i);
      expect(out).toMatch(/no transaction was built, signed, simulated, or sent/i);
      expect(out).toBe(run()); // deterministic
    } finally {
      cleanup();
    }
  });

  it("--json emits parseable JSON carrying the PAPER-ONLY language", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const { candidates, prices } = cleanFixtures();
      writeFixtures(cwd, candidates, prices);
      const out = paperRunReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "candidates.json",
          pricesPath: "prices.json",
          maxTradeSizeUsd: 1000,
          json: true,
        },
      );
      const parsed = JSON.parse(out) as {
        banner: string;
        summary: { buyCount: number; unrealizedPnlUsd: number };
        events: unknown[];
        disclaimer: string;
      };
      expect(parsed.summary.buyCount).toBe(1);
      expect(parsed.summary.unrealizedPnlUsd).toBe(50); // (3 - 2) * 50
      expect(out).toContain("PAPER ONLY");
      expect(out).toMatch(/no transaction was built, signed, simulated, or sent/i);
    } finally {
      cleanup();
    }
  });

  it("the kill switch blocks all simulated trading", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const { candidates, prices } = cleanFixtures();
      writeFixtures(cwd, candidates, prices);
      const out = paperRunReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "candidates.json",
          pricesPath: "prices.json",
          maxTradeSizeUsd: 1000,
          killSwitch: true,
        },
      );
      expect(out).toContain("buys / sells:     0 / 0");
    } finally {
      cleanup();
    }
  });

  it("does not leak an RPC api-key from config into the report", () => {
    const { cwd, cleanup } = withConfig({
      mode: "PAPER",
      rpcUrl: "https://rpc.example.com/?api-key=SUPERSECRET",
    });
    try {
      const { candidates, prices } = cleanFixtures();
      writeFixtures(cwd, candidates, prices);
      const out = paperRunReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "candidates.json",
          pricesPath: "prices.json",
          maxTradeSizeUsd: 1000,
        },
      );
      expect(out).not.toContain("SUPERSECRET");
    } finally {
      cleanup();
    }
  });

  it("appends to a journal that paper:journal can then summarize", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const { candidates, prices } = cleanFixtures();
      writeFixtures(cwd, candidates, prices);
      const runOut = paperRunReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "candidates.json",
          pricesPath: "prices.json",
          journalPath: "journal.jsonl",
          maxTradeSizeUsd: 1000,
        },
      );
      expect(runOut).toContain("Paper run");

      const journalOut = paperJournalReport({ cwd, env: {} }, { journalPath: "journal.jsonl" });
      expect(journalOut).toContain("Paper journal");
      expect(journalOut).toContain("PAPER ONLY");
      expect(journalOut).toMatch(/events: \d+/);
      expect(journalOut).toContain("BUY"); // the simulated fill is shown

      const statusOut = paperStatusReport({ cwd, env: {} }, { journalPath: "journal.jsonl" });
      expect(statusOut).toContain("open positions:   1");
    } finally {
      cleanup();
    }
  });
});

describe("paperJournalReport", () => {
  it("refuses when --journal is missing", () => {
    const out = paperJournalReport({}, {});
    expect(out).toMatch(/^Refusing: --journal/);
  });

  it("refuses an unreadable journal cleanly", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const out = paperJournalReport({ cwd, env: {} }, { journalPath: "missing.jsonl" });
      expect(out).toMatch(/^Refusing: cannot read journal file/);
    } finally {
      cleanup();
    }
  });

  it("handles malformed JSONL lines cleanly (skips + counts them)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(
        join(cwd, "bad.jsonl"),
        ['{"type":"RUN_STARTED","at":"x","caps":{},"note":"n"}', "{not json", ""].join("\n"),
      );
      const out = paperJournalReport({ cwd, env: {} }, { journalPath: "bad.jsonl" });
      expect(out).toContain("Paper journal");
      expect(out).toContain("malformed lines skipped: 1");
    } finally {
      cleanup();
    }
  });

  it("--json output is parseable", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const { candidates, prices } = cleanFixtures();
      writeFixtures(cwd, candidates, prices);
      paperRunReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "candidates.json",
          pricesPath: "prices.json",
          journalPath: "j.jsonl",
          maxTradeSizeUsd: 1000,
        },
      );
      const out = paperJournalReport({ cwd, env: {} }, { journalPath: "j.jsonl", json: true });
      const parsed = JSON.parse(out) as { eventCount: number; banner: string };
      expect(parsed.eventCount).toBeGreaterThan(0);
      expect(parsed.banner).toContain("PAPER ONLY");
      // The non-negotiable language must survive serialization here too.
      expect(out).toMatch(/no transaction was built, signed, simulated, or sent/i);
    } finally {
      cleanup();
    }
  });

  it("--json does not leak an RPC api-key from config", () => {
    const { cwd, cleanup } = withConfig({
      mode: "PAPER",
      rpcUrl: "https://rpc.example.com/?api-key=SUPERSECRET",
    });
    try {
      const { candidates, prices } = cleanFixtures();
      writeFixtures(cwd, candidates, prices);
      paperRunReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "candidates.json",
          pricesPath: "prices.json",
          journalPath: "leak.jsonl",
          maxTradeSizeUsd: 1000,
        },
      );
      const out = paperJournalReport(
        { cwd, env: {} },
        { journalPath: "leak.jsonl", json: true },
      );
      expect(out).not.toContain("SUPERSECRET");
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 5 — strategy:evaluate (deterministic, paper-only rules engine)
// ---------------------------------------------------------------------------

const STRATEGY_CONFIG = {
  minScoreForPaperBuy: 55,
  minScoreForWatch: 30,
  maxRiskScore: 60,
};

function strategyCandidate(mint: string) {
  return {
    mint,
    symbol: "WIF",
    riskReport: passReport(mint),
    source: "snipe-list",
  };
}

function writeStrategyFixtures(cwd: string, candidate: unknown, config: unknown): void {
  writeFileSync(join(cwd, "candidate.json"), JSON.stringify(candidate));
  writeFileSync(join(cwd, "config.json"), JSON.stringify(config));
}

describe("strategyEvaluateReport", () => {
  it("refuses when --candidate is missing", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const out = strategyEvaluateReport({ cwd, env: {} }, { strategyConfigPath: "config.json" });
      expect(out).toMatch(/^Refusing: --candidate/);
    } finally {
      cleanup();
    }
  });

  it("refuses when --config is missing", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const out = strategyEvaluateReport({ cwd, env: {} }, { candidatePath: "candidate.json" });
      expect(out).toMatch(/^Refusing: --config/);
    } finally {
      cleanup();
    }
  });

  it("refuses a missing candidate file cleanly", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "config.json"), JSON.stringify(STRATEGY_CONFIG));
      const out = strategyEvaluateReport(
        { cwd, env: {} },
        { candidatePath: "nope.json", strategyConfigPath: "config.json" },
      );
      expect(out).toMatch(/^Refusing: cannot read candidate file/);
    } finally {
      cleanup();
    }
  });

  it("refuses malformed candidate JSON cleanly", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "candidate.json"), "{ not json");
      writeFileSync(join(cwd, "config.json"), JSON.stringify(STRATEGY_CONFIG));
      const out = strategyEvaluateReport(
        { cwd, env: {} },
        { candidatePath: "candidate.json", strategyConfigPath: "config.json" },
      );
      expect(out).toMatch(/^Refusing: candidate file is not valid JSON/);
    } finally {
      cleanup();
    }
  });

  it("refuses an invalid config cleanly", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeStrategyFixtures(cwd, strategyCandidate(MINT_A), { minScoreForWatch: 30 });
      const out = strategyEvaluateReport(
        { cwd, env: {} },
        { candidatePath: "candidate.json", strategyConfigPath: "config.json" },
      );
      expect(out).toMatch(/^Refusing: invalid config: minScoreForPaperBuy/);
    } finally {
      cleanup();
    }
  });

  it("refuses a candidate whose riskReport.decision is not a valid literal", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const bad = {
        mint: MINT_A,
        riskReport: { mint: MINT_A, decision: "APPROVED", score: 0, flags: [], summary: [], generatedAt: PAPER_TIME, disclaimer: "x" },
      };
      writeStrategyFixtures(cwd, bad, STRATEGY_CONFIG);
      const out = strategyEvaluateReport(
        { cwd, env: {} },
        { candidatePath: "candidate.json", strategyConfigPath: "config.json" },
      );
      expect(out).toMatch(/^Refusing: malformed candidate: riskReport.decision/);
    } finally {
      cleanup();
    }
  });

  it("refuses a candidate whose riskReport.score is out of range", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const bad = {
        mint: MINT_A,
        riskReport: { mint: MINT_A, decision: "PASS_FOR_PAPER_EVALUATION", score: 150, flags: [], summary: [], generatedAt: PAPER_TIME, disclaimer: "x" },
      };
      writeStrategyFixtures(cwd, bad, STRATEGY_CONFIG);
      const out = strategyEvaluateReport(
        { cwd, env: {} },
        { candidatePath: "candidate.json", strategyConfigPath: "config.json" },
      );
      expect(out).toMatch(/^Refusing: malformed candidate: riskReport.score/);
    } finally {
      cleanup();
    }
  });

  it("produces a human PAPER-ONLY report with the required disclaimers", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeStrategyFixtures(cwd, strategyCandidate(MINT_A), STRATEGY_CONFIG);
      const out = strategyEvaluateReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        { candidatePath: "candidate.json", strategyConfigPath: "config.json" },
      );
      expect(out).toContain("PAPER ONLY");
      expect(out).toContain("decision:    PAPER_BUY_CANDIDATE");
      expect(out).toMatch(/not financial advice/i);
      expect(out).toMatch(/not a buy recommendation/i);
      expect(out).toMatch(/no transaction was built, signed, simulated, or sent/i);
    } finally {
      cleanup();
    }
  });

  it("--json emits parseable JSON carrying the PAPER-ONLY language", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeStrategyFixtures(cwd, strategyCandidate(MINT_A), STRATEGY_CONFIG);
      const out = strategyEvaluateReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        { candidatePath: "candidate.json", strategyConfigPath: "config.json", json: true },
      );
      const parsed = JSON.parse(out) as {
        banner: string;
        paperOnly: boolean;
        report: { decision: string; score: number; createdAt: string };
      };
      expect(parsed.paperOnly).toBe(true);
      expect(parsed.report.decision).toBe("PAPER_BUY_CANDIDATE");
      expect(parsed.report.createdAt).toBe(PAPER_TIME);
      expect(out).toMatch(/no transaction was built, signed, simulated, or sent/i);
    } finally {
      cleanup();
    }
  });

  it("reads an injected --paper-state to apply position-awareness rules", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const paperState = {
        positions: {
          OTHER: {
            mint: "OTHER",
            quantity: 1,
            averageEntryPriceUsd: 100,
            costBasisUsd: 100,
            realizedPnlUsd: 0,
            unrealizedPnlUsd: 0,
            openedAt: PAPER_TIME,
            updatedAt: PAPER_TIME,
          },
        },
        realizedPnlUsd: 0,
        unrealizedPnlUsd: 0,
        fills: [],
        closedTradeCount: 0,
        simulatedNotionalUsd: 0,
      };
      writeStrategyFixtures(cwd, strategyCandidate(MINT_A), {
        ...STRATEGY_CONFIG,
        maxOpenPositions: 1,
      });
      writeFileSync(join(cwd, "paper-state.json"), JSON.stringify(paperState));
      const out = strategyEvaluateReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatePath: "candidate.json",
          strategyConfigPath: "config.json",
          paperStatePath: "paper-state.json",
        },
      );
      // One open position already + maxOpenPositions 1 ⇒ no new buy, just WATCH.
      expect(out).toContain("decision:    WATCH");
      expect(out).toContain("max-open-positions-reached");
    } finally {
      cleanup();
    }
  });

  it("does not leak a secret-looking value injected into a candidate field", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const leakyMint = "https://rpc.example.com/?api-key=SUPERSECRET";
      writeStrategyFixtures(cwd, strategyCandidate(leakyMint), STRATEGY_CONFIG);
      const out = strategyEvaluateReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        { candidatePath: "candidate.json", strategyConfigPath: "config.json" },
      );
      expect(out).not.toContain("SUPERSECRET");
    } finally {
      cleanup();
    }
  });
});
