import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
  strategyPlanReport,
  paperBacktestReport,
  paperBacktestLintReport,
  stripJsonBom,
} from "./commands.js";
import { buildTokenRiskReport } from "@soulmaker/risk";
import { parseJournal, reduceJournal } from "@soulmaker/paper";
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

// ---------------------------------------------------------------------------
// Phase 6 — strategy:plan (batch → paper candidates; PAPER ONLY, no auto-run)
// ---------------------------------------------------------------------------

/** Write a candidates ARRAY fixture + a strategy config fixture. */
function writePlanFixtures(cwd: string, candidates: unknown, config: unknown): void {
  writeFileSync(join(cwd, "candidates.json"), JSON.stringify(candidates));
  writeFileSync(join(cwd, "config.json"), JSON.stringify(config));
}

describe("strategyPlanReport", () => {
  it("refuses when --candidates is missing", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const out = strategyPlanReport({ cwd, env: {} }, { strategyConfigPath: "config.json" });
      expect(out).toMatch(/^Refusing: --candidates/);
    } finally {
      cleanup();
    }
  });

  it("refuses when --config is missing", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const out = strategyPlanReport({ cwd, env: {} }, { candidatesPath: "candidates.json" });
      expect(out).toMatch(/^Refusing: --config/);
    } finally {
      cleanup();
    }
  });

  it("refuses a missing candidates file cleanly", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "config.json"), JSON.stringify(STRATEGY_CONFIG));
      const out = strategyPlanReport(
        { cwd, env: {} },
        { candidatesPath: "nope.json", strategyConfigPath: "config.json" },
      );
      expect(out).toMatch(/^Refusing: cannot read candidates file/);
    } finally {
      cleanup();
    }
  });

  it("refuses malformed candidates JSON cleanly", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "candidates.json"), "{ not json");
      writeFileSync(join(cwd, "config.json"), JSON.stringify(STRATEGY_CONFIG));
      const out = strategyPlanReport(
        { cwd, env: {} },
        { candidatesPath: "candidates.json", strategyConfigPath: "config.json" },
      );
      expect(out).toMatch(/^Refusing: candidates file is not valid JSON/);
    } finally {
      cleanup();
    }
  });

  it("refuses a non-array candidates file cleanly", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writePlanFixtures(cwd, { mint: MINT_A }, STRATEGY_CONFIG); // object, not array
      const out = strategyPlanReport(
        { cwd, env: {} },
        { candidatesPath: "candidates.json", strategyConfigPath: "config.json" },
      );
      expect(out).toMatch(/^Refusing: candidates file must be a JSON array/);
    } finally {
      cleanup();
    }
  });

  it("refuses a malformed candidate entry, naming its array index", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      // index 0 valid, index 1 missing mint.
      writePlanFixtures(cwd, [strategyCandidate(MINT_A), { symbol: "X" }], STRATEGY_CONFIG);
      const out = strategyPlanReport(
        { cwd, env: {} },
        { candidatesPath: "candidates.json", strategyConfigPath: "config.json" },
      );
      expect(out).toMatch(/^Refusing: malformed candidate at index 1: mint/);
    } finally {
      cleanup();
    }
  });

  it("refuses an invalid config cleanly", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writePlanFixtures(cwd, [strategyCandidate(MINT_A)], { minScoreForWatch: 30 });
      const out = strategyPlanReport(
        { cwd, env: {} },
        { candidatesPath: "candidates.json", strategyConfigPath: "config.json" },
      );
      expect(out).toMatch(/^Refusing: invalid config: minScoreForPaperBuy/);
    } finally {
      cleanup();
    }
  });

  it("refuses a malformed paper state cleanly", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writePlanFixtures(cwd, [strategyCandidate(MINT_A)], STRATEGY_CONFIG);
      writeFileSync(join(cwd, "paper-state.json"), JSON.stringify({ noPositions: true }));
      const out = strategyPlanReport(
        { cwd, env: {} },
        {
          candidatesPath: "candidates.json",
          strategyConfigPath: "config.json",
          paperStatePath: "paper-state.json",
        },
      );
      expect(out).toMatch(/^Refusing: invalid paper-state: missing positions object/);
    } finally {
      cleanup();
    }
  });

  it("produces a human PAPER-ONLY plan with the required disclaimers", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writePlanFixtures(cwd, [strategyCandidate(MINT_A)], STRATEGY_CONFIG);
      const out = strategyPlanReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "candidates.json",
          strategyConfigPath: "config.json",
          defaultPaperSizeUsd: 100,
        },
      );
      expect(out).toContain("Strategy plan");
      expect(out).toContain("PAPER ONLY");
      expect(out).toContain("PAPER_BUY_CANDIDATE");
      expect(out).toMatch(/not financial advice/i);
      expect(out).toMatch(/not a buy recommendation/i);
      expect(out).toMatch(/no transaction was built, signed, simulated, or sent/i);
      // It is a PLAN, not a run: no paper:run language leaks in.
      expect(out).not.toMatch(/buys \/ sells/i);
    } finally {
      cleanup();
    }
  });

  it("--json output is parseable and carries the PAPER-ONLY language", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writePlanFixtures(cwd, [strategyCandidate(MINT_A)], STRATEGY_CONFIG);
      const out = strategyPlanReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "candidates.json",
          strategyConfigPath: "config.json",
          defaultPaperSizeUsd: 100,
          json: true,
        },
      );
      const parsed = JSON.parse(out) as {
        paperOnly: boolean;
        result: {
          createdAt: string;
          paperCandidates: { mint: string; proposedSide: string; proposedSizeUsd: number }[];
        };
      };
      expect(parsed.paperOnly).toBe(true);
      expect(parsed.result.createdAt).toBe(PAPER_TIME);
      expect(parsed.result.paperCandidates).toHaveLength(1);
      expect(parsed.result.paperCandidates[0]?.proposedSide).toBe("BUY");
      expect(out).toMatch(/no transaction was built, signed, simulated, or sent/i);
    } finally {
      cleanup();
    }
  });

  it("--out writes ONLY a parseable PaperCandidate[] array", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writePlanFixtures(cwd, [strategyCandidate(MINT_A)], STRATEGY_CONFIG);
      strategyPlanReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "candidates.json",
          strategyConfigPath: "config.json",
          defaultPaperSizeUsd: 100,
          outPath: "paper-candidates.json",
        },
      );
      const written = readFileSync(join(cwd, "paper-candidates.json"), "utf8");
      const arr = JSON.parse(written) as {
        mint: string;
        proposedSide: string;
        proposedSizeUsd: number;
      }[];
      expect(Array.isArray(arr)).toBe(true);
      expect(arr).toHaveLength(1);
      expect(arr[0]?.mint).toBe(MINT_A);
      expect(arr[0]?.proposedSide).toBe("BUY");
      expect(arr[0]?.proposedSizeUsd).toBe(100);
      // The out file is a candidate list, NOT a run journal/events.
      expect(written).not.toContain("RUN_STARTED");
      expect(written).not.toContain("PAPER_BUY_FILLED");
    } finally {
      cleanup();
    }
  });

  it("the --out file can be MANUALLY handed to paper:run (no auto-chaining)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writePlanFixtures(cwd, [strategyCandidate(MINT_A)], STRATEGY_CONFIG);
      strategyPlanReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "candidates.json",
          strategyConfigPath: "config.json",
          defaultPaperSizeUsd: 100,
          outPath: "paper-candidates.json",
        },
      );
      // The operator separately provides prices and runs paper:run by hand.
      writeFileSync(
        join(cwd, "prices.json"),
        JSON.stringify([
          { mint: MINT_A, priceUsd: 2, observedAt: PAPER_TIME, source: "injected-fixture" },
        ]),
      );
      const runOut = paperRunReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "paper-candidates.json",
          pricesPath: "prices.json",
          maxTradeSizeUsd: 1000,
        },
      );
      expect(runOut).toContain("buys / sells:     1 / 0");
    } finally {
      cleanup();
    }
  });

  it("does not run paper:run, create fills, or touch any journal", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writePlanFixtures(cwd, [strategyCandidate(MINT_A)], STRATEGY_CONFIG);
      strategyPlanReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "candidates.json",
          strategyConfigPath: "config.json",
          defaultPaperSizeUsd: 100,
          outPath: "paper-candidates.json",
        },
      );
      // No journal (.jsonl) file is ever produced by planning.
      const files = readdirSync(cwd);
      expect(files.some((f) => f.endsWith(".jsonl"))).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("does not leak API keys or secrets into human, JSON, or --out output", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const leaky = "https://rpc.example.com/?api-key=SUPERSECRET";
      const candidates = [
        { mint: MINT_A, symbol: "WIF", riskReport: passReport(MINT_A), source: leaky },
      ];
      writePlanFixtures(cwd, candidates, STRATEGY_CONFIG);

      const human = strategyPlanReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        { candidatesPath: "candidates.json", strategyConfigPath: "config.json", defaultPaperSizeUsd: 100 },
      );
      expect(human).not.toContain("SUPERSECRET");

      const json = strategyPlanReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "candidates.json",
          strategyConfigPath: "config.json",
          defaultPaperSizeUsd: 100,
          json: true,
        },
      );
      expect(json).not.toContain("SUPERSECRET");

      strategyPlanReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "candidates.json",
          strategyConfigPath: "config.json",
          defaultPaperSizeUsd: 100,
          outPath: "out.json",
        },
      );
      expect(readFileSync(join(cwd, "out.json"), "utf8")).not.toContain("SUPERSECRET");
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 7 — strategy:plan --journal (read-only journal-aware planning)
// ---------------------------------------------------------------------------

/** A distinct mint for the plan candidate (different from the journal's MINT_A). */
const MINT_B = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

/** Build a journal with one open simulated MINT_A position via paper:run. */
function writeOpenPositionJournal(cwd: string): void {
  const { candidates } = cleanFixtures();
  // Single buy tick only (no second price ⇒ no exit) ⇒ MINT_A stays open.
  writeFileSync(join(cwd, "candidates.json"), JSON.stringify(candidates));
  writeFileSync(
    join(cwd, "prices.json"),
    JSON.stringify([
      { mint: MINT_A, priceUsd: 2, observedAt: PAPER_TIME, source: "injected-fixture" },
    ]),
  );
  paperRunReport(
    { cwd, env: {}, now: () => PAPER_TIME },
    {
      candidatesPath: "candidates.json",
      pricesPath: "prices.json",
      journalPath: "journal.jsonl",
      maxTradeSizeUsd: 1000,
    },
  );
}

describe("strategyPlanReport — --journal (Sprint 7, read-only journal-aware planning)", () => {
  it("derives the same plan from a journal as from the equivalent --paper-state snapshot", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeOpenPositionJournal(cwd);
      // Independently derive the equivalent snapshot from the same journal.
      const journalText = readFileSync(join(cwd, "journal.jsonl"), "utf8");
      const state = reduceJournal(parseJournal(journalText).events);
      writeFileSync(join(cwd, "paper-state.json"), JSON.stringify(state));

      writeFileSync(
        join(cwd, "plan-candidates.json"),
        JSON.stringify([strategyCandidate(MINT_B)]),
      );
      writeFileSync(join(cwd, "config.json"), JSON.stringify(STRATEGY_CONFIG));

      const common = {
        candidatesPath: "plan-candidates.json",
        strategyConfigPath: "config.json",
        json: true,
      } as const;
      const viaJournal = strategyPlanReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        { ...common, journalPath: "journal.jsonl" },
      );
      const viaSnapshot = strategyPlanReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        { ...common, paperStatePath: "paper-state.json" },
      );
      expect(viaJournal).toBe(viaSnapshot);
      expect((JSON.parse(viaJournal) as { paperOnly: boolean }).paperOnly).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("applies position-awareness from the derived journal state (max open positions)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeOpenPositionJournal(cwd);
      writeFileSync(
        join(cwd, "plan-candidates.json"),
        JSON.stringify([strategyCandidate(MINT_B)]),
      );
      // One open simulated position + maxOpenPositions 1 ⇒ a new buy is held to WATCH.
      writeFileSync(
        join(cwd, "config.json"),
        JSON.stringify({ ...STRATEGY_CONFIG, maxOpenPositions: 1 }),
      );
      const out = strategyPlanReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "plan-candidates.json",
          strategyConfigPath: "config.json",
          journalPath: "journal.jsonl",
          includeWatch: true,
          json: true,
        },
      );
      const parsed = JSON.parse(out) as {
        result: { items: { decision: string; reasons: { id: string }[] }[] };
      };
      const item = parsed.result.items[0];
      expect(item?.decision).toBe("WATCH");
      expect(item?.reasons.map((r) => r.id)).toContain("max-open-positions-reached");
    } finally {
      cleanup();
    }
  });

  it("treats an empty journal as a valid empty paper state (no refusal)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "journal.jsonl"), "");
      writeFileSync(
        join(cwd, "plan-candidates.json"),
        JSON.stringify([strategyCandidate(MINT_B)]),
      );
      writeFileSync(join(cwd, "config.json"), JSON.stringify(STRATEGY_CONFIG));
      const out = strategyPlanReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "plan-candidates.json",
          strategyConfigPath: "config.json",
          journalPath: "journal.jsonl",
        },
      );
      expect(out).not.toMatch(/^Refusing/);
      expect(out).toContain("Strategy plan");
      expect(out).toContain("PAPER ONLY");
    } finally {
      cleanup();
    }
  });

  it("refuses a malformed journal (does not silently drop events)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(
        join(cwd, "journal.jsonl"),
        ['{"type":"RUN_STARTED","at":"x","caps":{},"note":"n"}', "{not json"].join("\n"),
      );
      writeFileSync(
        join(cwd, "plan-candidates.json"),
        JSON.stringify([strategyCandidate(MINT_B)]),
      );
      writeFileSync(join(cwd, "config.json"), JSON.stringify(STRATEGY_CONFIG));
      const out = strategyPlanReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "plan-candidates.json",
          strategyConfigPath: "config.json",
          journalPath: "journal.jsonl",
        },
      );
      expect(out).toMatch(/^Refusing: journal is malformed/);
    } finally {
      cleanup();
    }
  });

  it("refuses a journal carrying an invalid fill event", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(
        join(cwd, "journal.jsonl"),
        '{"type":"PAPER_BUY_FILLED","at":"x","fill":{"side":"BUY","mint":"M","quantity":"oops","priceUsd":1,"notionalUsd":1,"feeUsd":0,"filledAt":"x"}}',
      );
      writeFileSync(
        join(cwd, "plan-candidates.json"),
        JSON.stringify([strategyCandidate(MINT_B)]),
      );
      writeFileSync(join(cwd, "config.json"), JSON.stringify(STRATEGY_CONFIG));
      const out = strategyPlanReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "plan-candidates.json",
          strategyConfigPath: "config.json",
          journalPath: "journal.jsonl",
        },
      );
      expect(out).toMatch(/^Refusing: journal has \d+ invalid fill/);
    } finally {
      cleanup();
    }
  });

  it("refuses when BOTH --journal and --paper-state are supplied", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "journal.jsonl"), "");
      writeFileSync(join(cwd, "paper-state.json"), JSON.stringify({ positions: {} }));
      writeFileSync(
        join(cwd, "plan-candidates.json"),
        JSON.stringify([strategyCandidate(MINT_B)]),
      );
      writeFileSync(join(cwd, "config.json"), JSON.stringify(STRATEGY_CONFIG));
      const out = strategyPlanReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "plan-candidates.json",
          strategyConfigPath: "config.json",
          journalPath: "journal.jsonl",
          paperStatePath: "paper-state.json",
        },
      );
      expect(out).toMatch(/^Refusing: supply only one source of paper state/);
    } finally {
      cleanup();
    }
  });

  it("refuses a missing journal file cleanly", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(
        join(cwd, "plan-candidates.json"),
        JSON.stringify([strategyCandidate(MINT_B)]),
      );
      writeFileSync(join(cwd, "config.json"), JSON.stringify(STRATEGY_CONFIG));
      const out = strategyPlanReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "plan-candidates.json",
          strategyConfigPath: "config.json",
          journalPath: "nope.jsonl",
        },
      );
      expect(out).toMatch(/^Refusing: cannot read journal file/);
    } finally {
      cleanup();
    }
  });

  it("never writes to or mutates the journal, and creates no new journal", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeOpenPositionJournal(cwd);
      const before = readFileSync(join(cwd, "journal.jsonl"), "utf8");
      const jsonlBefore = readdirSync(cwd).filter((f) => f.endsWith(".jsonl")).sort();

      writeFileSync(
        join(cwd, "plan-candidates.json"),
        JSON.stringify([strategyCandidate(MINT_B)]),
      );
      writeFileSync(join(cwd, "config.json"), JSON.stringify(STRATEGY_CONFIG));
      strategyPlanReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "plan-candidates.json",
          strategyConfigPath: "config.json",
          journalPath: "journal.jsonl",
          outPath: "out.json",
        },
      );

      // The journal is byte-for-byte unchanged (no append/mutation), and no new
      // .jsonl was produced — planning never runs paper:run or creates fills.
      expect(readFileSync(join(cwd, "journal.jsonl"), "utf8")).toBe(before);
      const jsonlAfter = readdirSync(cwd).filter((f) => f.endsWith(".jsonl")).sort();
      expect(jsonlAfter).toEqual(jsonlBefore);
    } finally {
      cleanup();
    }
  });

  it("keeps a secret-looking candidate value redacted on the journal-aware path", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeOpenPositionJournal(cwd);
      const leaky = "https://rpc.example.com/?api-key=SUPERSECRET";
      writeFileSync(
        join(cwd, "plan-candidates.json"),
        JSON.stringify([
          { mint: MINT_B, symbol: "WIF", riskReport: passReport(MINT_B), source: leaky },
        ]),
      );
      writeFileSync(join(cwd, "config.json"), JSON.stringify(STRATEGY_CONFIG));
      const out = strategyPlanReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "plan-candidates.json",
          strategyConfigPath: "config.json",
          journalPath: "journal.jsonl",
          json: true,
        },
      );
      expect(out).not.toContain("SUPERSECRET");
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 8 — paper:run --journal continuation (Sprint 8): a run started from an
// existing valid journal continues the simulated portfolio (read-before-append).
// ---------------------------------------------------------------------------

/** A SELL candidate fixture for `mint` (a held position is required at run time). */
function sellCandidate(mint: string, proposedSizeUsd = 0) {
  return { mint, proposedSide: "SELL", proposedSizeUsd, riskReport: passReport(mint) };
}

describe("paperRunReport — --journal continuation (Sprint 8)", () => {
  it("reads an existing valid journal as the starting state before appending (sell continuation)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeOpenPositionJournal(cwd); // journal holds an open MINT_A (qty 50 @ 2)
      // A SELL candidate + a higher exit price. Without journal continuation the
      // sell would be rejected ("no open simulated position").
      writeFileSync(join(cwd, "sell.json"), JSON.stringify([sellCandidate(MINT_A, 0)]));
      writeFileSync(
        join(cwd, "sell-prices.json"),
        JSON.stringify([
          { mint: MINT_A, priceUsd: 3, observedAt: PAPER_TIME, source: "injected-fixture" },
        ]),
      );
      const out = paperRunReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "sell.json",
          pricesPath: "sell-prices.json",
          journalPath: "journal.jsonl",
          maxTradeSizeUsd: 1000,
        },
      );
      expect(out).toContain("buys / sells:     0 / 1");
      expect(out).not.toMatch(/no open simulated position/i);
      // (3 - 2) * 50 = +50 realized on the closed position.
      expect(out).toContain("realized PnL:     $50.00");

      // The full journal now reconstructs to a CLOSED MINT_A with +50 realized.
      const journalText = readFileSync(join(cwd, "journal.jsonl"), "utf8");
      const state = reduceJournal(parseJournal(journalText).events);
      expect(state.positions[MINT_A]).toBeUndefined();
      expect(state.realizedPnlUsd).toBe(50);
      expect(state.closedTradeCount).toBe(1);
      // Exactly one buy fill (prior) + one sell fill (this run) — no duplication.
      const fills = parseJournal(journalText).events.filter(
        (e) => e.type === "PAPER_BUY_FILLED" || e.type === "PAPER_SELL_FILLED",
      );
      expect(fills).toHaveLength(2);

      const status = paperStatusReport({ cwd, env: {} }, { journalPath: "journal.jsonl" });
      expect(status).toContain("open positions:   0");
    } finally {
      cleanup();
    }
  });

  it("refuses a malformed existing journal and appends nothing", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(
        join(cwd, "journal.jsonl"),
        ['{"type":"RUN_STARTED","at":"x","caps":{},"note":"n"}', "{not json"].join("\n"),
      );
      const before = readFileSync(join(cwd, "journal.jsonl"), "utf8");
      const { candidates, prices } = cleanFixtures();
      writeFixtures(cwd, candidates, prices);
      const out = paperRunReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "candidates.json",
          pricesPath: "prices.json",
          journalPath: "journal.jsonl",
          maxTradeSizeUsd: 1000,
        },
      );
      expect(out).toMatch(/^Refusing: existing journal is malformed/);
      // The journal is byte-for-byte unchanged — nothing was appended.
      expect(readFileSync(join(cwd, "journal.jsonl"), "utf8")).toBe(before);
    } finally {
      cleanup();
    }
  });

  it("refuses an existing journal carrying an invalid fill payload and appends nothing", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(
        join(cwd, "journal.jsonl"),
        '{"type":"PAPER_BUY_FILLED","at":"x","fill":{"side":"BUY","mint":"M","quantity":"oops","priceUsd":1,"notionalUsd":1,"feeUsd":0,"filledAt":"x"}}',
      );
      const before = readFileSync(join(cwd, "journal.jsonl"), "utf8");
      const { candidates, prices } = cleanFixtures();
      writeFixtures(cwd, candidates, prices);
      const out = paperRunReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "candidates.json",
          pricesPath: "prices.json",
          journalPath: "journal.jsonl",
          maxTradeSizeUsd: 1000,
        },
      );
      expect(out).toMatch(/^Refusing: existing journal has \d+ invalid fill/);
      expect(readFileSync(join(cwd, "journal.jsonl"), "utf8")).toBe(before);
    } finally {
      cleanup();
    }
  });

  it("a missing journal starts from the empty state and creates it on append", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const { candidates, prices } = cleanFixtures();
      writeFixtures(cwd, candidates, prices);
      expect(readdirSync(cwd).some((f) => f === "fresh.jsonl")).toBe(false);
      const out = paperRunReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "candidates.json",
          pricesPath: "prices.json",
          journalPath: "fresh.jsonl",
          maxTradeSizeUsd: 1000,
        },
      );
      expect(out).toContain("buys / sells:     1 / 0");
      // The journal was created and holds this run's events.
      const text = readFileSync(join(cwd, "fresh.jsonl"), "utf8");
      expect(text).toContain("PAPER_BUY_FILLED");
    } finally {
      cleanup();
    }
  });

  it("end-to-end: buy run → strategy:plan --journal emits a sell → sell run → status closes the position", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      // 1) A first paper run opens a simulated MINT_A position and appends to the journal.
      writeOpenPositionJournal(cwd);
      const afterBuy = paperStatusReport({ cwd, env: {} }, { journalPath: "journal.jsonl" });
      expect(afterBuy).toContain("open positions:   1");

      // 2) strategy:plan --journal sees the held position and emits a SELL candidate
      //    (priceChangePct 60 ≥ takeProfitPct 50 ⇒ FULL exit), written to plan.json.
      writeFileSync(
        join(cwd, "plan-candidates.json"),
        JSON.stringify([
          {
            mint: MINT_A,
            symbol: "WIF",
            riskReport: passReport(MINT_A),
            metrics: { priceChangePct: 60 },
            source: "snipe-list",
          },
        ]),
      );
      writeFileSync(
        join(cwd, "config.json"),
        JSON.stringify({ ...STRATEGY_CONFIG, takeProfitPct: 50 }),
      );
      const planOut = strategyPlanReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "plan-candidates.json",
          strategyConfigPath: "config.json",
          journalPath: "journal.jsonl",
          outPath: "plan.json",
        },
      );
      expect(planOut).toContain("PAPER_SELL_CANDIDATE");
      const plan = JSON.parse(readFileSync(join(cwd, "plan.json"), "utf8")) as {
        mint: string;
        proposedSide: string;
      }[];
      expect(plan).toHaveLength(1);
      expect(plan[0]?.proposedSide).toBe("SELL");

      // 3) A later paper run reads the SAME journal as starting state, accepts the
      //    SELL candidate, appends a sell fill — and must NOT reject it.
      writeFileSync(
        join(cwd, "exit-prices.json"),
        JSON.stringify([
          { mint: MINT_A, priceUsd: 3, observedAt: PAPER_TIME, source: "injected-fixture" },
        ]),
      );
      const sellRun = paperRunReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "plan.json",
          pricesPath: "exit-prices.json",
          journalPath: "journal.jsonl",
          maxTradeSizeUsd: 1000,
        },
      );
      expect(sellRun).not.toMatch(/no open simulated position/i);
      expect(sellRun).toContain("buys / sells:     0 / 1");

      // 4) paper:status --journal shows the position closed with realized PnL.
      const status = paperStatusReport({ cwd, env: {} }, { journalPath: "journal.jsonl" });
      expect(status).toContain("open positions:   0");
      expect(status).toContain("closed trades:    1");
      expect(status).toContain("realized PnL:     $50.00");
    } finally {
      cleanup();
    }
  });

  it("regression: a journal-derived SELL never produces 'cannot sell — no open simulated position'", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeOpenPositionJournal(cwd);
      writeFileSync(join(cwd, "sell.json"), JSON.stringify([sellCandidate(MINT_A, 0)]));
      writeFileSync(
        join(cwd, "sell-prices.json"),
        JSON.stringify([
          { mint: MINT_A, priceUsd: 2, observedAt: PAPER_TIME, source: "injected-fixture" },
        ]),
      );
      const out = paperRunReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatesPath: "sell.json",
          pricesPath: "sell-prices.json",
          journalPath: "journal.jsonl",
          maxTradeSizeUsd: 1000,
        },
      );
      expect(out).not.toMatch(/cannot sell — no open simulated position/i);
      expect(out).not.toMatch(/REJECT\(caps\)/);
      expect(out).toContain("buys / sells:     0 / 1");
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Sprint 8 — paper:backtest (deterministic, injected-only simulated replay)
// ---------------------------------------------------------------------------

/** A self-contained one-step buy scenario (config + caps + steps) for MINT_A. */
function buyScenario(): unknown {
  return {
    name: "cli-backtest",
    strategyConfig: STRATEGY_CONFIG, // minScoreForPaperBuy 55 ⇒ a clean PASS buys
    caps: { maxTradeSizeUsd: 1000, maxDailyLossUsd: 1000, maxOpenPositions: 5, killSwitch: false },
    defaultPaperSizeUsd: 100,
    steps: [
      {
        id: "step-1",
        at: PAPER_TIME,
        candidates: [{ mint: MINT_A, riskReport: passReport(MINT_A) }],
        prices: [{ mint: MINT_A, priceUsd: 2, observedAt: PAPER_TIME, source: "injected-fixture" }],
      },
    ],
  };
}

describe("paperBacktestReport (Sprint 8)", () => {
  it("refuses when --scenario is missing", () => {
    expect(paperBacktestReport({}, {})).toMatch(/^Refusing: --scenario/);
  });

  it("refuses a missing scenario file cleanly", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const out = paperBacktestReport({ cwd, env: {} }, { scenarioPath: "nope.json" });
      expect(out).toMatch(/^Refusing: cannot read scenario file/);
    } finally {
      cleanup();
    }
  });

  it("refuses a non-JSON scenario file cleanly", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "scenario.json"), "{ not json");
      const out = paperBacktestReport({ cwd, env: {} }, { scenarioPath: "scenario.json" });
      expect(out).toMatch(/^Refusing: scenario file is not valid JSON/);
    } finally {
      cleanup();
    }
  });

  it("refuses an empty-steps scenario clearly", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(
        join(cwd, "scenario.json"),
        JSON.stringify({ name: "x", strategyConfig: STRATEGY_CONFIG, caps: {}, steps: [] }),
      );
      const out = paperBacktestReport({ cwd, env: {} }, { scenarioPath: "scenario.json" });
      expect(out).toMatch(/^Refusing: /);
    } finally {
      cleanup();
    }
  });

  it("runs a deterministic backtest and prints the required PAPER-ONLY labels", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "scenario.json"), JSON.stringify(buyScenario()));
      const run = () =>
        paperBacktestReport(
          { cwd, env: {}, now: () => PAPER_TIME },
          { scenarioPath: "scenario.json" },
        );
      const out = run();
      for (const label of [
        "SIMULATED PAPER-ONLY REPORT",
        "Uses injected historical data only",
        "Not a live result",
        "Not financial advice",
        "Not a profitability claim",
      ]) {
        expect(out).toContain(label);
      }
      expect(out).toContain("simulated fills:   1 buy / 0 sell");
      expect(out).toBe(run()); // deterministic
    } finally {
      cleanup();
    }
  });

  it("--json output is parseable and carries the labels", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "scenario.json"), JSON.stringify(buyScenario()));
      const out = paperBacktestReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        { scenarioPath: "scenario.json", json: true },
      );
      const parsed = JSON.parse(out) as {
        banner: string;
        scenarioName: string;
        fillCounts: { buyCount: number };
        notProfitabilityClaim: boolean;
      };
      expect(parsed.banner).toBe("SIMULATED PAPER-ONLY REPORT");
      expect(parsed.scenarioName).toBe("cli-backtest");
      expect(parsed.fillCounts.buyCount).toBe(1);
      expect(parsed.notProfitabilityClaim).toBe(true);
      expect(out).toContain("Not financial advice");
    } finally {
      cleanup();
    }
  });

  it("--out writes ONLY the report JSON and creates no journal/fills", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "scenario.json"), JSON.stringify(buyScenario()));
      paperBacktestReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        { scenarioPath: "scenario.json", outPath: "report.json" },
      );
      const written = readFileSync(join(cwd, "report.json"), "utf8");
      const parsed = JSON.parse(written) as { scenarioName: string; stepCount: number };
      expect(parsed.scenarioName).toBe("cli-backtest");
      expect(parsed.stepCount).toBe(1);
      // The report is NOT a journal: no run/fill events leak into it.
      expect(written).not.toContain("RUN_STARTED");
      expect(written).not.toContain("PAPER_BUY_FILLED");
      // No .jsonl journal is ever produced by a backtest.
      expect(readdirSync(cwd).some((f) => f.endsWith(".jsonl"))).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("does not leak a secret-looking injected value into the output", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const leaky = "https://rpc.example.com/?api-key=SUPERSECRET";
      const scenario = buyScenario() as { steps: { candidates: { source?: string }[] }[] };
      scenario.steps[0]!.candidates[0]!.source = leaky;
      writeFileSync(join(cwd, "scenario.json"), JSON.stringify(scenario));
      const out = paperBacktestReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        { scenarioPath: "scenario.json", json: true },
      );
      expect(out).not.toContain("SUPERSECRET");
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Sprint 9 — BOM-tolerant JSON readers
// ---------------------------------------------------------------------------

/** Prefix a string with a leading UTF-8 BOM (U+FEFF). */
function withBom(text: string): string {
  return `\uFEFF${text}`;
}

describe("stripJsonBom (pure helper)", () => {
  it("removes exactly one leading BOM and leaves everything else", () => {
    expect(stripJsonBom("\uFEFFabc")).toBe("abc");
    expect(stripJsonBom("abc")).toBe("abc");
  });

  it("never strips a BOM in the middle of the text", () => {
    expect(stripJsonBom("a\uFEFFb")).toBe("a\uFEFFb");
  });

  it("strips only the FIRST of two leading BOMs", () => {
    expect(stripJsonBom("\uFEFF\uFEFFx")).toBe("\uFEFFx");
  });
});

describe("BOM tolerance — local JSON readers parse a leading UTF-8 BOM", () => {
  it("candidates JSON with a leading BOM parses", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const { candidates, prices } = cleanFixtures();
      writeFileSync(join(cwd, "candidates.json"), withBom(JSON.stringify(candidates)));
      writeFileSync(join(cwd, "prices.json"), JSON.stringify(prices));
      const out = paperRunReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        { candidatesPath: "candidates.json", pricesPath: "prices.json", maxTradeSizeUsd: 1000 },
      );
      expect(out).toContain("buys / sells:     1 / 0");
    } finally {
      cleanup();
    }
  });

  it("prices JSON with a leading BOM parses", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const { candidates, prices } = cleanFixtures();
      writeFileSync(join(cwd, "candidates.json"), JSON.stringify(candidates));
      writeFileSync(join(cwd, "prices.json"), withBom(JSON.stringify(prices)));
      const out = paperRunReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        { candidatesPath: "candidates.json", pricesPath: "prices.json", maxTradeSizeUsd: 1000 },
      );
      expect(out).toContain("buys / sells:     1 / 0");
    } finally {
      cleanup();
    }
  });

  it("strategy config JSON with a leading BOM parses", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(
        join(cwd, "candidate.json"),
        JSON.stringify({ mint: MINT_A, riskReport: passReport(MINT_A) }),
      );
      writeFileSync(join(cwd, "config.json"), withBom(JSON.stringify(STRATEGY_CONFIG)));
      const out = strategyEvaluateReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        { candidatePath: "candidate.json", strategyConfigPath: "config.json" },
      );
      expect(out).not.toMatch(/^Refusing/);
    } finally {
      cleanup();
    }
  });

  it("backtest scenario JSON with a leading BOM parses", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "scenario.json"), withBom(JSON.stringify(buyScenario())));
      const out = paperBacktestReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        { scenarioPath: "scenario.json" },
      );
      expect(out).toContain("SIMULATED PAPER-ONLY REPORT");
      expect(out).toContain("simulated fills:   1 buy / 0 sell");
    } finally {
      cleanup();
    }
  });

  it("optional paper-state JSON with a leading BOM parses", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(
        join(cwd, "candidate.json"),
        JSON.stringify({ mint: MINT_A, riskReport: passReport(MINT_A) }),
      );
      writeFileSync(join(cwd, "config.json"), JSON.stringify(STRATEGY_CONFIG));
      writeFileSync(join(cwd, "paper-state.json"), withBom(JSON.stringify({ positions: {} })));
      const out = strategyEvaluateReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        {
          candidatePath: "candidate.json",
          strategyConfigPath: "config.json",
          paperStatePath: "paper-state.json",
        },
      );
      expect(out).not.toMatch(/^Refusing/);
    } finally {
      cleanup();
    }
  });

  it("a journal with a single leading BOM is tolerated by paper:status", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeOpenPositionJournal(cwd); // creates journal.jsonl with one open MINT_A
      const raw = readFileSync(join(cwd, "journal.jsonl"), "utf8");
      writeFileSync(join(cwd, "journal.jsonl"), withBom(raw)); // prepend a BOM
      const status = paperStatusReport({ cwd, env: {} }, { journalPath: "journal.jsonl" });
      expect(status).toContain("open positions:   1");
    } finally {
      cleanup();
    }
  });

  // Reconciliation coverage (Sprint 9 ⟂ master): the strategy:plan command path was
  // only exercised with a BOM on master. Its candidates array (readJsonArray) and
  // config (readJsonValue) both run through JSON.parse, where a leading BOM throws
  // unless stripped at the read boundary — so this genuinely guards that fix.
  it("strategy:plan parses a BOM-prefixed candidates array + config", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(
        join(cwd, "candidates.json"),
        withBom(JSON.stringify([strategyCandidate(MINT_A)])),
      );
      writeFileSync(join(cwd, "config.json"), withBom(JSON.stringify(STRATEGY_CONFIG)));
      const out = strategyPlanReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        { candidatesPath: "candidates.json", strategyConfigPath: "config.json" },
      );
      expect(out).not.toMatch(/^Refusing/);
      expect(out).toContain("Strategy plan");
      expect(out).toContain("PAPER ONLY");
    } finally {
      cleanup();
    }
  });

  // Reconciliation coverage: the token:risk list reader (readListFile) is the one
  // read site master's BOM fix covered that Sprint 9 did not. A BOM-prefixed denylist
  // must still drive the REJECT. NOTE: list files are doubly safe here — readListFile
  // strips the leading BOM at the read boundary AND parseList's per-entry trim() also
  // neutralizes U+FEFF — so this locks the end-to-end "Windows-saved list" contract.
  it("token:risk tolerates a BOM-prefixed denylist file (readListFile)", async () => {
    const { cwd, cleanup } = withConfig({
      mode: "WATCH_ONLY",
      rpcUrl: "https://rpc.example.com",
    });
    try {
      writeFileSync(join(cwd, "deny.txt"), withBom(`${VALID_PUBKEY}   # rugged\n`));
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
});

describe("BOM tolerance — malformed JSON still refuses (no loose normalization)", () => {
  it("malformed JSON WITHOUT a BOM still refuses", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "scenario.json"), "{ not json");
      const out = paperBacktestReport({ cwd, env: {} }, { scenarioPath: "scenario.json" });
      expect(out).toMatch(/^Refusing: scenario file is not valid JSON/);
    } finally {
      cleanup();
    }
  });

  it("malformed JSON WITH a leading BOM still refuses (only the BOM is stripped)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "scenario.json"), withBom("{ not json"));
      const out = paperBacktestReport({ cwd, env: {} }, { scenarioPath: "scenario.json" });
      expect(out).toMatch(/^Refusing: scenario file is not valid JSON/);
    } finally {
      cleanup();
    }
  });

  it("a candidates array file that is a JSON object (not array) still refuses, even with a BOM", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "candidates.json"), withBom(JSON.stringify({ not: "an array" })));
      writeFileSync(join(cwd, "prices.json"), JSON.stringify([]));
      const out = paperRunReport(
        { cwd, env: {} },
        { candidatesPath: "candidates.json", pricesPath: "prices.json" },
      );
      expect(out).toMatch(/^Refusing: candidates file must be a JSON array/);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Sprint 9 — paper:backtest:lint
// ---------------------------------------------------------------------------

describe("paperBacktestLintReport (scenario linter CLI)", () => {
  it("refuses when --scenario is missing", () => {
    expect(paperBacktestLintReport({}, {})).toMatch(/^Refusing: --scenario/);
  });

  it("a clean scenario lints as VALID with no warnings", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "scenario.json"), JSON.stringify(buyScenario()));
      const out = paperBacktestLintReport({ cwd, env: {} }, { scenarioPath: "scenario.json" });
      expect(out).not.toMatch(/^Refusing/);
      expect(out).toContain("(VALID)");
      expect(out).toContain("Result: scenario is valid and has no warnings.");
    } finally {
      cleanup();
    }
  });

  it("a runnable-but-suspicious scenario reports warnings and stays exit-0", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const scenario = buyScenario() as { caps: Record<string, unknown> };
      scenario.caps.killSwitch = true;
      writeFileSync(join(cwd, "scenario.json"), JSON.stringify(scenario));
      const out = paperBacktestLintReport({ cwd, env: {} }, { scenarioPath: "scenario.json" });
      expect(out).not.toMatch(/^Refusing/);
      expect(out).toContain("RUNNABLE (with warnings)");
      expect(out).toContain("kill-switch-on");
      expect(out).toContain("runnable, but the warnings");
    } finally {
      cleanup();
    }
  });

  it("an invalid scenario refuses (errors block a run)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(
        join(cwd, "scenario.json"),
        JSON.stringify({ name: "x", strategyConfig: STRATEGY_CONFIG, caps: {}, steps: [] }),
      );
      const out = paperBacktestLintReport({ cwd, env: {} }, { scenarioPath: "scenario.json" });
      expect(out).toMatch(/^Refusing: scenario is not runnable/);
    } finally {
      cleanup();
    }
  });

  it("--json output is parseable, stable, and carries the lint result", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "scenario.json"), JSON.stringify(buyScenario()));
      const run = () =>
        paperBacktestLintReport({ cwd, env: {} }, { scenarioPath: "scenario.json", json: true });
      const out = run();
      const parsed = JSON.parse(out) as {
        valid: boolean;
        errors: unknown[];
        warnings: unknown[];
        summary: { name: string };
      };
      expect(parsed.valid).toBe(true);
      expect(parsed.errors).toEqual([]);
      expect(parsed.summary.name).toBe("cli-backtest");
      expect(out).toBe(run()); // stable
    } finally {
      cleanup();
    }
  });

  it("--json does not leak a secret-looking injected value", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const leaky = "https://rpc.example.com/?api-key=SUPERSECRET";
      const scenario = buyScenario() as { steps: { candidates: { source?: string }[] }[] };
      scenario.steps[0]!.candidates[0]!.source = leaky;
      writeFileSync(join(cwd, "scenario.json"), JSON.stringify(scenario));
      const out = paperBacktestLintReport(
        { cwd, env: {} },
        { scenarioPath: "scenario.json", json: true },
      );
      expect(out).not.toContain("SUPERSECRET");
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Sprint 9 — paper:backtest --seed-journal (external seed journal)
// ---------------------------------------------------------------------------

/** A one-step scenario (no candidates) that take-profit-exits a seeded MINT_A. */
function exitSeededScenario(): unknown {
  return {
    name: "seeded-exit",
    strategyConfig: STRATEGY_CONFIG,
    caps: { maxTradeSizeUsd: 1000, maxDailyLossUsd: 1000, maxOpenPositions: 5, killSwitch: false },
    steps: [
      {
        id: "step-1",
        at: PAPER_TIME,
        candidates: [],
        prices: [{ mint: MINT_A, priceUsd: 3, observedAt: PAPER_TIME, source: "injected-fixture" }],
        takeProfitPct: 50, // seeded MINT_A avg 2 → +50% → full exit
      },
    ],
  };
}

describe("paperBacktestReport — --seed-journal (Sprint 9)", () => {
  it("seeds the starting state from an external journal and exits the seeded position", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeOpenPositionJournal(cwd); // journal.jsonl holds open MINT_A (qty 50 @ 2)
      const seedBefore = readFileSync(join(cwd, "journal.jsonl"), "utf8");
      writeFileSync(join(cwd, "scenario.json"), JSON.stringify(exitSeededScenario()));
      const scenarioBefore = readFileSync(join(cwd, "scenario.json"), "utf8");

      const out = paperBacktestReport(
        { cwd, env: {}, now: () => PAPER_TIME },
        { scenarioPath: "scenario.json", seedJournalPath: "journal.jsonl" },
      );
      expect(out).toContain("simulated fills:   0 buy / 1 sell");
      expect(out).toContain("realized PnL:      $50.00");

      // The seed journal is NEVER written, and the scenario file is NEVER mutated.
      expect(readFileSync(join(cwd, "journal.jsonl"), "utf8")).toBe(seedBefore);
      expect(readFileSync(join(cwd, "scenario.json"), "utf8")).toBe(scenarioBefore);
      // No new journal/fills are produced by a backtest.
      expect(readdirSync(cwd).filter((f) => f.endsWith(".jsonl"))).toEqual(["journal.jsonl"]);
    } finally {
      cleanup();
    }
  });

  it("refuses a missing seed journal file", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "scenario.json"), JSON.stringify(exitSeededScenario()));
      const out = paperBacktestReport(
        { cwd, env: {} },
        { scenarioPath: "scenario.json", seedJournalPath: "nope.jsonl" },
      );
      expect(out).toMatch(/^Refusing: cannot read seed journal file/);
    } finally {
      cleanup();
    }
  });

  it("refuses a malformed seed journal", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "scenario.json"), JSON.stringify(exitSeededScenario()));
      writeFileSync(
        join(cwd, "seed.jsonl"),
        ['{"type":"RUN_STARTED","at":"x","caps":{},"note":"n"}', "{not json"].join("\n"),
      );
      const out = paperBacktestReport(
        { cwd, env: {} },
        { scenarioPath: "scenario.json", seedJournalPath: "seed.jsonl" },
      );
      expect(out).toMatch(/^Refusing: scenario\.initialJournal is malformed/);
    } finally {
      cleanup();
    }
  });

  it("refuses when the scenario already embeds initialJournal AND --seed-journal is supplied", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const scenario = exitSeededScenario() as Record<string, unknown>;
      scenario.initialJournal = "";
      writeFileSync(join(cwd, "scenario.json"), JSON.stringify(scenario));
      writeFileSync(join(cwd, "seed.jsonl"), "");
      const out = paperBacktestReport(
        { cwd, env: {} },
        { scenarioPath: "scenario.json", seedJournalPath: "seed.jsonl" },
      );
      expect(out).toMatch(/^Refusing: supply only one seed source/);
    } finally {
      cleanup();
    }
  });
});
