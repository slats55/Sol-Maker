import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
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
  paperBacktestDiffReport,
  paperBacktestScenarioNewReport,
  paperBacktestScenarioMatrixReport,
  paperBacktestScenarioVariantsReport,
  paperBacktestVariantPlanExplainReport,
  paperBacktestSuiteReport,
  paperBacktestDiffSuiteReport,
  paperBacktestSensitivityReport,
  stripJsonBom,
} from "./commands.js";
import { buildTokenRiskReport } from "@soulmaker/risk";
import { parseJournal, reduceJournal } from "@soulmaker/paper";
import { runBacktest } from "@soulmaker/backtest";
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

// ---------------------------------------------------------------------------
// Sprint 10 — paper:backtest:diff (deterministic report diffing)
// ---------------------------------------------------------------------------

describe("paperBacktestDiffReport (Sprint 10)", () => {
  /** Write a real backtest report JSON to `name`, returning the report object. */
  function writeReport(cwd: string, name: string, scenario: unknown): Record<string, unknown> {
    const report = runBacktest(scenario) as unknown as Record<string, unknown>;
    writeFileSync(join(cwd, name), JSON.stringify(report, null, 2));
    return report;
  }

  it("refuses when --base or --next is missing", () => {
    expect(paperBacktestDiffReport({}, {}).text).toMatch(/^Refusing: --base/);
    expect(paperBacktestDiffReport({}, { basePath: "a.json" }).text).toMatch(/^Refusing: --next/);
    expect(paperBacktestDiffReport({}, { basePath: "a.json" }).exitCode).toBe(1);
  });

  it("diffs two identical reports to a zero diff with no regression (exit 0)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeReport(cwd, "base.json", buyScenario());
      writeReport(cwd, "next.json", buyScenario());
      const { text, exitCode } = paperBacktestDiffReport(
        { cwd, env: {} },
        { basePath: "base.json", nextPath: "next.json" },
      );
      expect(text).toContain("status:     same-scenario");
      expect(text).toContain("Regression: no");
      expect(text).toContain("Not a live result. Not financial advice. Not a profitability claim.");
      expect(exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("emits stable, parseable, redacted JSON with --json", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeReport(cwd, "base.json", buyScenario());
      writeReport(cwd, "next.json", buyScenario());
      const a = paperBacktestDiffReport({ cwd, env: {} }, { basePath: "base.json", nextPath: "next.json", json: true });
      const b = paperBacktestDiffReport({ cwd, env: {} }, { basePath: "base.json", nextPath: "next.json", json: true });
      expect(a.text).toBe(b.text); // byte-stable for the same input pair
      const parsed = JSON.parse(a.text) as { schemaVersion: string; hasRegression: boolean };
      expect(parsed.schemaVersion).toBe("backtest.diff.v1");
      expect(parsed.hasRegression).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("refuses a malformed report file (not valid JSON)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeReport(cwd, "base.json", buyScenario());
      writeFileSync(join(cwd, "next.json"), "{ not json");
      const { text, exitCode } = paperBacktestDiffReport(
        { cwd, env: {} },
        { basePath: "base.json", nextPath: "next.json" },
      );
      expect(text).toMatch(/^Refusing: next report file is not valid JSON/);
      expect(exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses a JSON file that is not a backtest report", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeReport(cwd, "base.json", buyScenario());
      writeFileSync(join(cwd, "next.json"), JSON.stringify({ not: "a report" }));
      const { text, exitCode } = paperBacktestDiffReport(
        { cwd, env: {} },
        { basePath: "base.json", nextPath: "next.json" },
      );
      expect(text).toMatch(/^Refusing: invalid backtest report/);
      expect(exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("accepts a BOM-prefixed report file (reconciled BOM reader)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const report = writeReport(cwd, "base.json", buyScenario());
      // Re-write base with a leading BOM; the diff must still parse it.
      writeFileSync(join(cwd, "base.json"), withBom(JSON.stringify(report, null, 2)));
      writeReport(cwd, "next.json", buyScenario());
      const { text, exitCode } = paperBacktestDiffReport(
        { cwd, env: {} },
        { basePath: "base.json", nextPath: "next.json" },
      );
      expect(text).not.toMatch(/^Refusing/);
      expect(text).toContain("status:     same-scenario");
      expect(exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-regression exits non-zero for a regression (same digest, worse PnL)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = writeReport(cwd, "base.json", buyScenario());
      // Craft a worse "next": SAME scenarioDigest, lower simulated PnL.
      const pnl = base.pnl as { realizedUsd: number; unrealizedUsd: number; totalUsd: number };
      const worse = { ...base, pnl: { ...pnl, realizedUsd: pnl.realizedUsd - 10, totalUsd: pnl.totalUsd - 10 } };
      writeFileSync(join(cwd, "worse.json"), JSON.stringify(worse, null, 2));

      const guarded = paperBacktestDiffReport(
        { cwd, env: {} },
        { basePath: "base.json", nextPath: "worse.json", failOnRegression: true },
      );
      expect(guarded.text).toContain("Regression: YES");
      expect(guarded.exitCode).toBe(1);

      // Without the flag, the same negative diff exits 0 (still reports the regression).
      const unguarded = paperBacktestDiffReport(
        { cwd, env: {} },
        { basePath: "base.json", nextPath: "worse.json" },
      );
      expect(unguarded.text).toContain("Regression: YES");
      expect(unguarded.exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-regression exits zero when there is no regression", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeReport(cwd, "base.json", buyScenario());
      writeReport(cwd, "next.json", buyScenario());
      const { exitCode } = paperBacktestDiffReport(
        { cwd, env: {} },
        { basePath: "base.json", nextPath: "next.json", failOnRegression: true },
      );
      expect(exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Sprint 10 — paper:backtest:scenario:new (deterministic scenario skeletons)
// ---------------------------------------------------------------------------

describe("paperBacktestScenarioNewReport (Sprint 10)", () => {
  it("refuses when --template or --out is missing", () => {
    expect(paperBacktestScenarioNewReport({}, {}).startsWith("Refusing: --template")).toBe(true);
    expect(
      paperBacktestScenarioNewReport({}, { template: "buy-hold" }).startsWith("Refusing: --out"),
    ).toBe(true);
  });

  it("refuses an unknown template", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const out = paperBacktestScenarioNewReport(
        { cwd, env: {} },
        { template: "nope", outPath: "s.json" },
      );
      expect(out).toMatch(/^Refusing: unknown template/);
      expect(readdirSync(cwd)).not.toContain("s.json"); // nothing written
    } finally {
      cleanup();
    }
  });

  it("writes ONLY the scenario file, and it lints VALID + runs through the CLI", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const before = readdirSync(cwd);
      const out = paperBacktestScenarioNewReport(
        { cwd, env: {} },
        { template: "buy-hold", outPath: "gen.scenario.json" },
      );
      expect(out).toContain("Wrote backtest scenario — buy-hold");
      expect(out).toContain("lints:     VALID");

      // Exactly one new file appeared (no journal/report side effects).
      const after = readdirSync(cwd).filter((f) => !before.includes(f));
      expect(after).toEqual(["gen.scenario.json"]);

      // The written scenario lints VALID and runs through the real backtest CLI.
      const lint = paperBacktestLintReport({ cwd, env: {} }, { scenarioPath: "gen.scenario.json" });
      expect(lint).toContain("(VALID)");
      const bt = paperBacktestReport({ cwd, env: {} }, { scenarioPath: "gen.scenario.json" });
      expect(bt).toContain("SIMULATED PAPER-ONLY REPORT");
      expect(bt).toContain("simulated fills:   1 buy / 0 sell");
    } finally {
      cleanup();
    }
  });

  it("refuses to overwrite an existing file unless --force is given", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const first = paperBacktestScenarioNewReport(
        { cwd, env: {} },
        { template: "buy-hold", outPath: "s.json" },
      );
      expect(first).toContain("Wrote backtest scenario");

      const blocked = paperBacktestScenarioNewReport(
        { cwd, env: {} },
        { template: "buy-full-exit", outPath: "s.json" },
      );
      expect(blocked).toMatch(/^Refusing: .* already exists \(pass --force/);

      const forced = paperBacktestScenarioNewReport(
        { cwd, env: {} },
        { template: "buy-full-exit", outPath: "s.json", force: true },
      );
      expect(forced).toContain("Wrote backtest scenario — buy-full-exit");
      // The file now holds the full-exit scenario (a sell occurs).
      const bt = paperBacktestReport({ cwd, env: {} }, { scenarioPath: "s.json" });
      expect(bt).toContain("simulated fills:   1 buy / 1 sell");
    } finally {
      cleanup();
    }
  });

  it("applies a custom --name to the generated scenario", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      paperBacktestScenarioNewReport(
        { cwd, env: {} },
        { template: "buy-hold", outPath: "s.json", name: "my fixture" },
      );
      const written = JSON.parse(readFileSync(join(cwd, "s.json"), "utf8")) as { name: string };
      expect(written.name).toBe("my fixture");
    } finally {
      cleanup();
    }
  });

  it("seed-journal-continuation generates a scenario that lints with its expected warning", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const out = paperBacktestScenarioNewReport(
        { cwd, env: {} },
        { template: "seed-journal-continuation", outPath: "s.json", json: true },
      );
      const env = JSON.parse(out) as { template: string; lint: { valid: boolean; warnings: string[] } };
      expect(env.template).toBe("seed-journal-continuation");
      expect(env.lint.valid).toBe(true);
      expect(env.lint.warnings).toEqual(["initial-journal-open-positions"]);
    } finally {
      cleanup();
    }
  });

  it("a generated scenario re-saved WITH a leading BOM still lints + runs", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      paperBacktestScenarioNewReport(
        { cwd, env: {} },
        { template: "buy-full-exit", outPath: "s.json" },
      );
      const raw = readFileSync(join(cwd, "s.json"), "utf8");
      writeFileSync(join(cwd, "s.json"), withBom(raw)); // simulate a Windows re-save
      const lint = paperBacktestLintReport({ cwd, env: {} }, { scenarioPath: "s.json" });
      expect(lint).not.toMatch(/^Refusing/);
      const bt = paperBacktestReport({ cwd, env: {} }, { scenarioPath: "s.json" });
      expect(bt).toContain("simulated fills:   1 buy / 1 sell");
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Sprint 10 — paper:backtest:scenario:matrix (deterministic variant expansion)
// ---------------------------------------------------------------------------

describe("paperBacktestScenarioMatrixReport (Sprint 10)", () => {
  const MATRIX = {
    name: "sizing-sweep",
    variants: [
      { suffix: "size-25", patch: { defaultPaperSizeUsd: 25 } },
      { suffix: "size-50", patch: { defaultPaperSizeUsd: 50 } },
    ],
  };

  function writeBaseAndMatrix(cwd: string, matrix: unknown = MATRIX): void {
    writeFileSync(join(cwd, "base.scenario.json"), JSON.stringify(buyScenario(), null, 2));
    writeFileSync(join(cwd, "matrix.json"), JSON.stringify(matrix, null, 2));
  }

  it("refuses when --base, --matrix, or --out-dir is missing", () => {
    expect(paperBacktestScenarioMatrixReport({}, {})).toMatch(/^Refusing: --base/);
    expect(paperBacktestScenarioMatrixReport({}, { basePath: "b.json" })).toMatch(/^Refusing: --matrix/);
    expect(
      paperBacktestScenarioMatrixReport({}, { basePath: "b.json", matrixPath: "m.json" }),
    ).toMatch(/^Refusing: --out-dir/);
  });

  it("writes one validating, runnable scenario file per variant", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndMatrix(cwd);
      const out = paperBacktestScenarioMatrixReport(
        { cwd, env: {} },
        { basePath: "base.scenario.json", matrixPath: "matrix.json", outDir: "out" },
      );
      expect(out).toContain("Wrote 2 scenario variant(s) — sizing-sweep");

      const files = readdirSync(join(cwd, "out")).sort();
      expect(files).toEqual(["base.size-25.scenario.json", "base.size-50.scenario.json"]);

      // Each variant has its patched size, derives its name from the base + suffix
      // (so the base's labelling is retained, never replaced), and runs.
      for (const [file, size, suffix] of [
        ["base.size-25.scenario.json", 25, "size-25"],
        ["base.size-50.scenario.json", 50, "size-50"],
      ] as const) {
        const v = JSON.parse(readFileSync(join(cwd, "out", file), "utf8")) as {
          name: string;
          defaultPaperSizeUsd: number;
        };
        expect(v.defaultPaperSizeUsd).toBe(size);
        expect(v.name).toBe(`cli-backtest [${suffix}]`); // base name + suffix
        const lint = paperBacktestLintReport({ cwd, env: {} }, { scenarioPath: `out/${file}` });
        expect(lint).toContain("(VALID)");
      }
    } finally {
      cleanup();
    }
  });

  it("does not mutate the base scenario file", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndMatrix(cwd);
      const before = readFileSync(join(cwd, "base.scenario.json"), "utf8");
      paperBacktestScenarioMatrixReport(
        { cwd, env: {} },
        { basePath: "base.scenario.json", matrixPath: "matrix.json", outDir: "out" },
      );
      expect(readFileSync(join(cwd, "base.scenario.json"), "utf8")).toBe(before);
    } finally {
      cleanup();
    }
  });

  it("refuses to overwrite existing variant files unless --force is given", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndMatrix(cwd);
      const opts = { basePath: "base.scenario.json", matrixPath: "matrix.json", outDir: "out" };
      expect(paperBacktestScenarioMatrixReport({ cwd, env: {} }, opts)).toContain("Wrote 2");
      expect(paperBacktestScenarioMatrixReport({ cwd, env: {} }, opts)).toMatch(
        /^Refusing: .* already exist \(pass --force/,
      );
      expect(
        paperBacktestScenarioMatrixReport({ cwd, env: {} }, { ...opts, force: true }),
      ).toContain("Wrote 2");
    } finally {
      cleanup();
    }
  });

  it("refuses a patch that touches a protected key (no partial writes)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndMatrix(cwd, {
        variants: [{ suffix: "x", patch: { steps: [] } }],
      });
      const out = paperBacktestScenarioMatrixReport(
        { cwd, env: {} },
        { basePath: "base.scenario.json", matrixPath: "matrix.json", outDir: "out" },
      );
      expect(out).toMatch(/^Refusing: matrix.variants\[0\].patch may only set/);
      // Nothing was written.
      expect(readdirSync(cwd)).not.toContain("out");
    } finally {
      cleanup();
    }
  });

  it("refuses a malformed matrix file", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "base.scenario.json"), JSON.stringify(buyScenario()));
      writeFileSync(join(cwd, "matrix.json"), "{ not json");
      const out = paperBacktestScenarioMatrixReport(
        { cwd, env: {} },
        { basePath: "base.scenario.json", matrixPath: "matrix.json", outDir: "out" },
      );
      expect(out).toMatch(/^Refusing: matrix file is not valid JSON/);
    } finally {
      cleanup();
    }
  });

  it("emits a stable JSON envelope with --json", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndMatrix(cwd);
      const out = paperBacktestScenarioMatrixReport(
        { cwd, env: {} },
        { basePath: "base.scenario.json", matrixPath: "matrix.json", outDir: "out", json: true },
      );
      const env = JSON.parse(out) as { name: string; variants: { suffix: string }[] };
      expect(env.name).toBe("sizing-sweep");
      expect(env.variants.map((v) => v.suffix)).toEqual(["size-25", "size-50"]);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Sprint 12 — paper:backtest:scenario:variants (bounded perturbation variants)
// ---------------------------------------------------------------------------

describe("paperBacktestScenarioVariantsReport (Sprint 12)", () => {
  const PLAN = {
    name: "price-sweep",
    variants: [
      { suffix: "x2", perturbations: [{ target: "price", op: "multiply", value: 2 }] },
      { suffix: "half", perturbations: [{ target: "price", op: "multiply", value: 0.5 }] },
    ],
  };

  /** A buy scenario with TWO MINT_A price points so a perturbation visibly moves PnL. */
  function twoPriceBuyScenario(name: string): unknown {
    return {
      name,
      strategyConfig: STRATEGY_CONFIG,
      caps: { maxTradeSizeUsd: 1000, maxDailyLossUsd: 1000, maxOpenPositions: 5, killSwitch: false },
      defaultPaperSizeUsd: 100,
      steps: [
        {
          id: "step-1",
          at: PAPER_TIME,
          candidates: [{ mint: MINT_A, riskReport: passReport(MINT_A) }],
          prices: [
            { mint: MINT_A, priceUsd: 2, observedAt: PAPER_TIME, source: "injected-fixture" },
            { mint: MINT_A, priceUsd: 3, observedAt: PAPER_TIME, source: "injected-fixture" },
          ],
        },
      ],
    };
  }

  function writeBaseAndPlan(cwd: string, plan: unknown = PLAN): void {
    writeFileSync(join(cwd, "base.scenario.json"), JSON.stringify(buyScenario(), null, 2));
    writeFileSync(join(cwd, "plan.json"), JSON.stringify(plan, null, 2));
  }

  it("refuses when --base, --plan, or --out-dir is missing", () => {
    expect(paperBacktestScenarioVariantsReport({}, {})).toMatch(/^Refusing: --base/);
    expect(paperBacktestScenarioVariantsReport({}, { basePath: "b.json" })).toMatch(/^Refusing: --plan/);
    expect(
      paperBacktestScenarioVariantsReport({}, { basePath: "b.json", planPath: "p.json" }),
    ).toMatch(/^Refusing: --out-dir/);
  });

  it("writes one validating, perturbed scenario file per variant", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndPlan(cwd);
      const out = paperBacktestScenarioVariantsReport(
        { cwd, env: {} },
        { basePath: "base.scenario.json", planPath: "plan.json", outDir: "out" },
      );
      expect(out).toContain("Wrote 2 scenario variant(s) — price-sweep");
      // Required PAPER-only / simulated labelling in human output.
      expect(out).toContain("PAPER ONLY");
      expect(out).toContain("simulated local scenario data");

      const files = readdirSync(join(cwd, "out")).sort();
      expect(files).toEqual(["base.half.scenario.json", "base.x2.scenario.json"]);

      // buyScenario has one MINT_A price point at 2 ⇒ ×2 → 4, ×0.5 → 1.
      for (const [file, price, suffix] of [
        ["base.x2.scenario.json", 4, "x2"],
        ["base.half.scenario.json", 1, "half"],
      ] as const) {
        const v = JSON.parse(readFileSync(join(cwd, "out", file), "utf8")) as {
          name: string;
          steps: { prices: { priceUsd: number }[] }[];
        };
        expect(v.name).toBe(`cli-backtest [${suffix}]`); // base name + suffix
        expect(v.steps[0]?.prices[0]?.priceUsd).toBe(price);
        const lint = paperBacktestLintReport({ cwd, env: {} }, { scenarioPath: `out/${file}` });
        expect(lint).toContain("(VALID)");
      }
    } finally {
      cleanup();
    }
  });

  it("does not mutate the base scenario file", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndPlan(cwd);
      const before = readFileSync(join(cwd, "base.scenario.json"), "utf8");
      paperBacktestScenarioVariantsReport(
        { cwd, env: {} },
        { basePath: "base.scenario.json", planPath: "plan.json", outDir: "out" },
      );
      expect(readFileSync(join(cwd, "base.scenario.json"), "utf8")).toBe(before);
    } finally {
      cleanup();
    }
  });

  it("refuses to overwrite existing variant files unless --force is given", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndPlan(cwd);
      const opts = { basePath: "base.scenario.json", planPath: "plan.json", outDir: "out" };
      expect(paperBacktestScenarioVariantsReport({ cwd, env: {} }, opts)).toContain("Wrote 2");
      expect(paperBacktestScenarioVariantsReport({ cwd, env: {} }, opts)).toMatch(
        /^Refusing: .* already exist \(pass --force/,
      );
      expect(
        paperBacktestScenarioVariantsReport({ cwd, env: {} }, { ...opts, force: true }),
      ).toContain("Wrote 2");
    } finally {
      cleanup();
    }
  });

  it("refuses a disallowed perturbation and writes nothing (no partial output)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndPlan(cwd, {
        variants: [{ suffix: "x", perturbations: [{ target: "caps.maxTradeSizeUsd", op: "add", value: 1 }] }],
      });
      const out = paperBacktestScenarioVariantsReport(
        { cwd, env: {} },
        { basePath: "base.scenario.json", planPath: "plan.json", outDir: "out" },
      );
      expect(out).toMatch(/^Refusing: plan.variants\[0\].perturbations\[0\].target/);
      expect(readdirSync(cwd)).not.toContain("out"); // nothing written
    } finally {
      cleanup();
    }
  });

  it("refuses a perturbation that matches no values (no partial output)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndPlan(cwd, {
        variants: [{ suffix: "x", perturbations: [{ target: "metric.liquidityUsd", op: "add", value: 1 }] }],
      });
      const out = paperBacktestScenarioVariantsReport(
        { cwd, env: {} },
        { basePath: "base.scenario.json", planPath: "plan.json", outDir: "out" },
      );
      expect(out).toMatch(/^Refusing: .* matched no values/);
      expect(readdirSync(cwd)).not.toContain("out");
    } finally {
      cleanup();
    }
  });

  it("refuses a malformed plan file", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "base.scenario.json"), JSON.stringify(buyScenario()));
      writeFileSync(join(cwd, "plan.json"), "{ not json");
      const out = paperBacktestScenarioVariantsReport(
        { cwd, env: {} },
        { basePath: "base.scenario.json", planPath: "plan.json", outDir: "out" },
      );
      expect(out).toMatch(/^Refusing: variant plan file is not valid JSON/);
    } finally {
      cleanup();
    }
  });

  it("emits a stable JSON envelope with --json (suffix + changeCount)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndPlan(cwd);
      const out = paperBacktestScenarioVariantsReport(
        { cwd, env: {} },
        { basePath: "base.scenario.json", planPath: "plan.json", outDir: "out", json: true },
      );
      const env = JSON.parse(out) as {
        command: string;
        name: string;
        variants: { suffix: string; changeCount: number }[];
      };
      expect(env.command).toBe("paper:backtest:scenario:variants");
      expect(env.name).toBe("price-sweep");
      expect(env.variants.map((v) => v.suffix)).toEqual(["x2", "half"]);
      expect(env.variants.every((v) => v.changeCount === 1)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("wires into the suite flow: generate variants → suite → diff:suite (deterministic)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "base.scenario.json"), JSON.stringify(twoPriceBuyScenario("wire base")));
      // Two plans share the suffix "shift" (⇒ matching suite ids) but differ in delta,
      // so diff:suite pairs them and reports a deterministic, simulated diff.
      writeFileSync(
        join(cwd, "plan-a.json"),
        JSON.stringify({ name: "a", variants: [{ suffix: "shift", perturbations: [{ target: "price", op: "add", value: 1, min: 0 }] }] }),
      );
      writeFileSync(
        join(cwd, "plan-b.json"),
        JSON.stringify({ name: "b", variants: [{ suffix: "shift", perturbations: [{ target: "price", op: "add", value: 2, min: 0 }] }] }),
      );

      expect(
        paperBacktestScenarioVariantsReport(
          { cwd, env: {} },
          { basePath: "base.scenario.json", planPath: "plan-a.json", outDir: "var-a" },
        ),
      ).toContain("Wrote 1");
      expect(
        paperBacktestScenarioVariantsReport(
          { cwd, env: {} },
          { basePath: "base.scenario.json", planPath: "plan-b.json", outDir: "var-b" },
        ),
      ).toContain("Wrote 1");

      // The suite runner picks up the generated *.scenario.json files.
      const sa = paperBacktestSuiteReport({ cwd, env: {} }, { dir: "var-a", outDir: "suite-a" });
      const sb = paperBacktestSuiteReport({ cwd, env: {} }, { dir: "var-b", outDir: "suite-b" });
      expect(sa.exitCode).toBe(0);
      expect(sb.exitCode).toBe(0);
      expect(readdirSync(join(cwd, "suite-a"))).toContain("base.shift.report.json");

      const diff = paperBacktestDiffSuiteReport(
        { cwd, env: {} },
        { baseDir: "suite-a", nextDir: "suite-b", json: true },
      );
      const parsed = JSON.parse(diff.text) as { schemaVersion: string };
      expect(parsed.schemaVersion).toBe("backtest.suite.diff.v1");
      expect(diff.exitCode).toBe(0);
      // Determinism: identical inputs ⇒ byte-identical diff.
      const diff2 = paperBacktestDiffSuiteReport(
        { cwd, env: {} },
        { baseDir: "suite-a", nextDir: "suite-b", json: true },
      );
      expect(diff2.text).toBe(diff.text);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Sprint 13 — paper:backtest:sensitivity (variant-over-base sensitivity workflow)
// ---------------------------------------------------------------------------

describe("paperBacktestSensitivityReport (Sprint 13)", () => {
  /** A two-price buy scenario so a price shift visibly moves the held PnL. */
  function sensBaseScenario(name = "sens base"): unknown {
    return {
      name,
      strategyConfig: STRATEGY_CONFIG,
      caps: { maxTradeSizeUsd: 1000, maxDailyLossUsd: 1000, maxOpenPositions: 5, killSwitch: false },
      defaultPaperSizeUsd: 100,
      steps: [
        {
          id: "step-1",
          at: PAPER_TIME,
          candidates: [{ mint: MINT_A, riskReport: passReport(MINT_A) }],
          prices: [
            { mint: MINT_A, priceUsd: 2, observedAt: PAPER_TIME, source: "injected-fixture" },
            { mint: MINT_A, priceUsd: 3, observedAt: PAPER_TIME, source: "injected-fixture" },
          ],
        },
      ],
    };
  }

  const PLAN = {
    name: "sens-sweep",
    variants: [
      { suffix: "up10", perturbations: [{ target: "price", op: "multiply", value: 1.1, min: 0 }] },
      { suffix: "plus1", perturbations: [{ target: "price", op: "add", value: 1, min: 0, max: 1000000 }] },
    ],
  };

  function writeBaseAndPlan(cwd: string, plan: unknown = PLAN): void {
    writeFileSync(join(cwd, "base.scenario.json"), JSON.stringify(sensBaseScenario(), null, 2));
    writeFileSync(join(cwd, "plan.json"), JSON.stringify(plan, null, 2));
  }

  const baseOpts = { basePath: "base.scenario.json", planPath: "plan.json" };

  it("refuses when --base or --plan is missing", () => {
    expect(paperBacktestSensitivityReport({}, {})).toMatch(/^Refusing: --base/);
    expect(paperBacktestSensitivityReport({}, { basePath: "b.json" })).toMatch(/^Refusing: --plan/);
  });

  it("prints a PAPER-only human report (banner + not-live/not-advice/not-profit) without --out-dir", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndPlan(cwd);
      const out = paperBacktestSensitivityReport({ cwd, env: {} }, baseOpts);
      expect(out).toContain("SIMULATED PAPER-ONLY SENSITIVITY");
      expect(out).toContain("PAPER ONLY");
      expect(out).toContain("simulated local scenario data");
      expect(out.toLowerCase()).toContain("not a live result");
      expect(out.toLowerCase()).toContain("not financial advice");
      expect(out.toLowerCase()).toContain("not a profitability claim");
      expect(out).toContain("up10");
      expect(out).toContain("plus1");
      // No --out-dir ⇒ nothing written.
      expect(existsSync(join(cwd, "sensitivity-report.json"))).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("emits a stable, parseable sensitivity report with --json (schema + counts)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndPlan(cwd);
      const out = paperBacktestSensitivityReport({ cwd, env: {} }, { ...baseOpts, json: true });
      const report = JSON.parse(out) as {
        schemaVersion: string;
        variantCount: number;
        baseline: { status: string };
        variants: { suffix: string }[];
      };
      expect(report.schemaVersion).toBe("backtest.sensitivity.v1");
      expect(report.variantCount).toBe(2);
      expect(report.baseline.status).toBe("passed");
      expect(report.variants.map((v) => v.suffix)).toEqual(["up10", "plus1"]);
      // Byte-identical across two runs (no timestamps, deterministic).
      const out2 = paperBacktestSensitivityReport({ cwd, env: {} }, { ...baseOpts, json: true });
      expect(out2).toBe(out);
    } finally {
      cleanup();
    }
  });

  it("does not mutate the base scenario file or the plan file", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndPlan(cwd);
      const baseBefore = readFileSync(join(cwd, "base.scenario.json"), "utf8");
      const planBefore = readFileSync(join(cwd, "plan.json"), "utf8");
      paperBacktestSensitivityReport({ cwd, env: {} }, { ...baseOpts, outDir: "out" });
      expect(readFileSync(join(cwd, "base.scenario.json"), "utf8")).toBe(baseBefore);
      expect(readFileSync(join(cwd, "plan.json"), "utf8")).toBe(planBefore);
    } finally {
      cleanup();
    }
  });

  it("writes the full deterministic artifact tree under --out-dir", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndPlan(cwd);
      const out = paperBacktestSensitivityReport({ cwd, env: {} }, { ...baseOpts, outDir: "out" });
      expect(out).toContain("Wrote ");

      const top = readdirSync(join(cwd, "out")).sort();
      expect(top).toEqual(["reports", "sensitivity-report.json", "variants"]);

      const variants = readdirSync(join(cwd, "out", "variants")).sort();
      expect(variants).toEqual(["base.plus1.scenario.json", "base.up10.scenario.json"]);

      const reports = readdirSync(join(cwd, "out", "reports")).sort();
      expect(reports).toEqual(["base.report.json", "plus1.report.json", "suite-index.json", "up10.report.json"]);

      // Headline report is a valid backtest.sensitivity.v1 with a passed baseline.
      const report = JSON.parse(readFileSync(join(cwd, "out", "sensitivity-report.json"), "utf8")) as {
        schemaVersion: string;
        baseline: { status: string; summary: { totalPnlUsd: number } };
        variants: { suffix: string; deltas: { totalPnlUsd: { delta: number } } | null }[];
      };
      expect(report.schemaVersion).toBe("backtest.sensitivity.v1");
      expect(report.baseline.status).toBe("passed");
      // Flat +1 shift moves the held PnL; uniform ×1.1 does not.
      expect(report.variants.find((v) => v.suffix === "plus1")?.deltas?.totalPnlUsd.delta).not.toBe(0);
      expect(report.variants.find((v) => v.suffix === "up10")?.deltas?.totalPnlUsd.delta).toBe(0);

      // The embedded suite index is the real Sprint 11 artifact.
      const suiteIndex = JSON.parse(readFileSync(join(cwd, "out", "reports", "suite-index.json"), "utf8")) as {
        schemaVersion: string;
      };
      expect(suiteIndex.schemaVersion).toBe("backtest.suite.v1");
    } finally {
      cleanup();
    }
  });

  it("the written variant scenarios re-run through paper:backtest to the SAME report (reuses the path)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndPlan(cwd);
      paperBacktestSensitivityReport({ cwd, env: {} }, { ...baseOpts, outDir: "out" });
      // Independently replay the written up10 variant scenario; it must byte-match the
      // report the workflow wrote for that variant (same production backtest path).
      const replay = paperBacktestReport(
        { cwd, env: {} },
        { scenarioPath: "out/variants/base.up10.scenario.json", json: true },
      );
      const written = readFileSync(join(cwd, "out", "reports", "up10.report.json"), "utf8").trimEnd();
      expect(JSON.parse(replay)).toEqual(JSON.parse(written));
    } finally {
      cleanup();
    }
  });

  it("refuses to overwrite existing outputs unless --force", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndPlan(cwd);
      const opts = { ...baseOpts, outDir: "out" };
      expect(paperBacktestSensitivityReport({ cwd, env: {} }, opts)).toContain("Wrote ");
      expect(paperBacktestSensitivityReport({ cwd, env: {} }, opts)).toMatch(
        /^Refusing: .* already exist \(pass --force/,
      );
      expect(paperBacktestSensitivityReport({ cwd, env: {} }, { ...opts, force: true })).toContain("Wrote ");
    } finally {
      cleanup();
    }
  });

  it("refuses a colliding 'base' variant suffix before writing anything", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndPlan(cwd, {
        name: "collide",
        variants: [{ suffix: "base", perturbations: [{ target: "price", op: "add", value: 1, min: 0 }] }],
      });
      const out = paperBacktestSensitivityReport({ cwd, env: {} }, { ...baseOpts, outDir: "out" });
      expect(out).toMatch(/^Refusing: output filename collision/);
      // No partial output: the subdirs were never created.
      expect(existsSync(join(cwd, "out", "reports"))).toBe(false);
      expect(existsSync(join(cwd, "out", "variants"))).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("does not write partial output when a later target already exists (no --force)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndPlan(cwd);
      // Pre-create ONLY the headline file; the existence preflight must refuse the
      // whole write so none of the variants/reports are created.
      mkdirSync(join(cwd, "out"), { recursive: true });
      writeFileSync(join(cwd, "out", "sensitivity-report.json"), "{}");
      const out = paperBacktestSensitivityReport({ cwd, env: {} }, { ...baseOpts, outDir: "out" });
      expect(out).toMatch(/^Refusing: .* already exist/);
      expect(existsSync(join(cwd, "out", "variants"))).toBe(false);
      expect(existsSync(join(cwd, "out", "reports"))).toBe(false);
      expect(readFileSync(join(cwd, "out", "sensitivity-report.json"), "utf8")).toBe("{}"); // untouched
    } finally {
      cleanup();
    }
  });

  it("refuses an invalid base scenario and a malformed plan", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      // Invalid base (empty steps).
      writeFileSync(join(cwd, "bad-base.json"), JSON.stringify({ name: "x", steps: [] }));
      writeFileSync(join(cwd, "plan.json"), JSON.stringify(PLAN));
      expect(
        paperBacktestSensitivityReport({ cwd, env: {} }, { basePath: "bad-base.json", planPath: "plan.json" }),
      ).toMatch(/^Refusing: /);

      // Malformed plan JSON.
      writeFileSync(join(cwd, "base.scenario.json"), JSON.stringify(sensBaseScenario()));
      writeFileSync(join(cwd, "bad-plan.json"), "{ not json");
      expect(
        paperBacktestSensitivityReport(
          { cwd, env: {} },
          { basePath: "base.scenario.json", planPath: "bad-plan.json" },
        ),
      ).toMatch(/^Refusing: variant plan file is not valid JSON/);
    } finally {
      cleanup();
    }
  });

  it("runs the shipped example base + variant plan end-to-end (real files)", () => {
    // ctx defaults cwd to process.cwd() (the repo root), so the real examples resolve.
    const out = paperBacktestSensitivityReport(
      {},
      {
        basePath: "examples/backtest/single-mint-buy-hold.scenario.json",
        planPath: "examples/backtest/price-sensitivity.variant-plan.json",
        json: true,
      },
    );
    const report = JSON.parse(out) as { schemaVersion: string; variantCount: number; baseline: { status: string } };
    expect(report.schemaVersion).toBe("backtest.sensitivity.v1");
    expect(report.variantCount).toBe(3); // the shipped plan has three variants
    expect(report.baseline.status).toBe("passed");
  });
});

// ---------------------------------------------------------------------------
// Sprint 11 — paper:backtest:suite (run a directory of scenarios as one suite)
// ---------------------------------------------------------------------------

/** A second distinct passing scenario (renamed buy scenario ⇒ a different digest). */
function buyScenarioNamed(name: string): unknown {
  return { ...(buyScenario() as Record<string, unknown>), name };
}

/** Write scenario files into `<cwd>/<sub>` and return the relative dir arg. */
function writeScenarioDir(cwd: string, sub: string, files: Record<string, unknown>): string {
  const dir = join(cwd, sub);
  mkdirSync(dir, { recursive: true });
  for (const [name, scenario] of Object.entries(files)) {
    const text = typeof scenario === "string" ? scenario : JSON.stringify(scenario, null, 2);
    writeFileSync(join(dir, name), text);
  }
  return sub;
}

describe("paperBacktestSuiteReport (Sprint 11)", () => {
  it("refuses when --dir is missing", () => {
    const r = paperBacktestSuiteReport({}, {});
    expect(r.text).toMatch(/^Refusing: --dir/);
    expect(r.exitCode).toBe(1);
  });

  it("refuses a missing directory", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const r = paperBacktestSuiteReport({ cwd, env: {} }, { dir: "nope" });
      expect(r.text).toMatch(/^Refusing: scenario directory not found/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses an empty directory (no false confidence)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeScenarioDir(cwd, "scenarios", {});
      const r = paperBacktestSuiteReport({ cwd, env: {} }, { dir });
      expect(r.text).toMatch(/^Refusing: no \*\.scenario\.json files/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("runs a valid directory deterministically, in filename order", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeScenarioDir(cwd, "scenarios", {
        "b.scenario.json": buyScenarioNamed("second"),
        "a.scenario.json": buyScenarioNamed("first"),
      });
      const r = paperBacktestSuiteReport({ cwd, env: {} }, { dir, json: true });
      expect(r.exitCode).toBe(0);
      const index = JSON.parse(r.text) as {
        schemaVersion: string;
        summary: { scenarioCount: number; passedCount: number };
        entries: { id: string }[];
      };
      expect(index.schemaVersion).toBe("backtest.suite.v1");
      expect(index.summary.scenarioCount).toBe(2);
      expect(index.summary.passedCount).toBe(2);
      expect(index.entries.map((e) => e.id)).toEqual(["a", "b"]); // sorted by filename
    } finally {
      cleanup();
    }
  });

  it("human output carries the required PAPER-ONLY labels", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeScenarioDir(cwd, "scenarios", { "a.scenario.json": buyScenario() });
      const r = paperBacktestSuiteReport({ cwd, env: {} }, { dir });
      expect(r.text).toContain("SIMULATED PAPER-ONLY SUITE");
      expect(r.text).toContain("Not a profitability claim");
      expect(r.exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("--out-dir writes one report per passed scenario + suite-index.json, and NO journals", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeScenarioDir(cwd, "scenarios", {
        "a.scenario.json": buyScenarioNamed("a"),
        "b.scenario.json": buyScenarioNamed("b"),
      });
      const r = paperBacktestSuiteReport({ cwd, env: {} }, { dir, outDir: "out" });
      expect(r.exitCode).toBe(0);
      const written = readdirSync(join(cwd, "out")).sort();
      expect(written).toEqual(["a.report.json", "b.report.json", "suite-index.json"]);
      // Never any journal/fills.
      expect(written.some((f) => f.endsWith(".jsonl"))).toBe(false);
      // Each report is a real backtest report.
      const rep = JSON.parse(readFileSync(join(cwd, "out", "a.report.json"), "utf8")) as { schemaVersion: string };
      expect(rep.schemaVersion).toBe("backtest.report.v1");
      const idx = JSON.parse(readFileSync(join(cwd, "out", "suite-index.json"), "utf8")) as { schemaVersion: string };
      expect(idx.schemaVersion).toBe("backtest.suite.v1");
    } finally {
      cleanup();
    }
  });

  it("refuses to overwrite existing output files unless --force", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeScenarioDir(cwd, "scenarios", { "a.scenario.json": buyScenario() });
      const first = paperBacktestSuiteReport({ cwd, env: {} }, { dir, outDir: "out" });
      expect(first.exitCode).toBe(0);
      const blocked = paperBacktestSuiteReport({ cwd, env: {} }, { dir, outDir: "out" });
      expect(blocked.text).toMatch(/already exist \(pass --force/);
      expect(blocked.exitCode).toBe(1);
      const forced = paperBacktestSuiteReport({ cwd, env: {} }, { dir, outDir: "out", force: true });
      expect(forced.exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("an invalid scenario becomes a failed entry without crashing the suite", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeScenarioDir(cwd, "scenarios", {
        "good.scenario.json": buyScenario(),
        "bad.scenario.json": { name: "x", strategyConfig: STRATEGY_CONFIG, caps: {}, steps: [] },
      });
      const r = paperBacktestSuiteReport({ cwd, env: {} }, { dir, json: true });
      const index = JSON.parse(r.text) as { summary: { passedCount: number; failedCount: number } };
      expect(index.summary.passedCount).toBe(1);
      expect(index.summary.failedCount).toBe(1);
      // Without --fail-on-error, a failed entry still exits 0 (clearly reported).
      expect(r.exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-error exits non-zero when any scenario failed", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeScenarioDir(cwd, "scenarios", {
        "good.scenario.json": buyScenario(),
        "bad.scenario.json": { name: "x", strategyConfig: STRATEGY_CONFIG, caps: {}, steps: [] },
      });
      const r = paperBacktestSuiteReport({ cwd, env: {} }, { dir, failOnError: true });
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses two scenarios whose sanitized stems collide", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeScenarioDir(cwd, "scenarios", {
        "a b.scenario.json": buyScenario(),
        "a_b.scenario.json": buyScenario(),
      });
      const r = paperBacktestSuiteReport({ cwd, env: {} }, { dir });
      expect(r.text).toMatch(/map to the same output name/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("accepts a BOM-prefixed scenario file", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeScenarioDir(cwd, "scenarios", {
        "a.scenario.json": withBom(JSON.stringify(buyScenario())),
      });
      const r = paperBacktestSuiteReport({ cwd, env: {} }, { dir, json: true });
      const index = JSON.parse(r.text) as { summary: { passedCount: number } };
      expect(index.summary.passedCount).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses (the whole suite) when a scenario file is malformed JSON", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeScenarioDir(cwd, "scenarios", {
        "a.scenario.json": buyScenario(),
        "broken.scenario.json": "{ not json",
      });
      const r = paperBacktestSuiteReport({ cwd, env: {} }, { dir });
      expect(r.text).toMatch(/^Refusing: scenario file broken\.scenario\.json is not valid JSON/);
      expect(r.exitCode).toBe(1);
      // Nothing was written.
      expect(existsSync(join(cwd, "out"))).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("redacts secret-looking content in the output (backstop)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const secret = "S".repeat(90); // an 80+ char base58-looking run ⇒ redacted
      const dir = writeScenarioDir(cwd, "scenarios", {
        "a.scenario.json": buyScenarioNamed(secret),
      });
      const r = paperBacktestSuiteReport({ cwd, env: {} }, { dir });
      expect(r.text).not.toContain(secret);
      expect(r.text).toContain("[REDACTED]");
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Sprint 11 — paper:backtest:diff:suite (compare two suite output directories)
// ---------------------------------------------------------------------------

describe("paperBacktestDiffSuiteReport (Sprint 11)", () => {
  /** Generate a suite output directory from a set of scenario files. */
  function makeSuiteDir(cwd: string, sub: string, files: Record<string, unknown>): string {
    const scenarios = writeScenarioDir(cwd, `${sub}-src`, files);
    const r = paperBacktestSuiteReport({ cwd, env: {} }, { dir: scenarios, outDir: sub });
    expect(r.exitCode).toBe(0);
    return sub;
  }

  it("refuses when --base-dir or --next-dir is missing", () => {
    expect(paperBacktestDiffSuiteReport({}, {}).text).toMatch(/^Refusing: --base-dir/);
    expect(paperBacktestDiffSuiteReport({}, { baseDir: "a" }).text).toMatch(/^Refusing: --next-dir/);
    expect(paperBacktestDiffSuiteReport({}, { baseDir: "a" }).exitCode).toBe(1);
  });

  it("refuses a directory with no suite-index.json", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = makeSuiteDir(cwd, "base", { "a.scenario.json": buyScenario() });
      writeScenarioDir(cwd, "empty", {}); // exists but no suite-index.json
      const r = paperBacktestDiffSuiteReport({ cwd, env: {} }, { baseDir: base, nextDir: "empty" });
      expect(r.text).toMatch(/^Refusing: no suite-index\.json found in next/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("diffs two identical suite dirs to no regression (exit 0)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const files = { "a.scenario.json": buyScenarioNamed("a"), "b.scenario.json": buyScenarioNamed("b") };
      // Same source ⇒ identical entries/digests in both suite indexes.
      const src = writeScenarioDir(cwd, "src", files);
      paperBacktestSuiteReport({ cwd, env: {} }, { dir: src, outDir: "base" });
      paperBacktestSuiteReport({ cwd, env: {} }, { dir: src, outDir: "next" });
      const r = paperBacktestDiffSuiteReport({ cwd, env: {} }, { baseDir: "base", nextDir: "next" });
      expect(r.text).toContain("Regression: no");
      expect(r.text).toContain("Not a profitability claim");
      expect(r.exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("detects an added scenario between two suites", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = makeSuiteDir(cwd, "base", { "a.scenario.json": buyScenarioNamed("a") });
      const next = makeSuiteDir(cwd, "next", {
        "a.scenario.json": buyScenarioNamed("a"),
        "b.scenario.json": buyScenarioNamed("b"),
      });
      const r = paperBacktestDiffSuiteReport({ cwd, env: {} }, { baseDir: base, nextDir: next, json: true });
      const diff = JSON.parse(r.text) as { added: { id: string }[]; schemaVersion: string };
      expect(diff.schemaVersion).toBe("backtest.suite.diff.v1");
      expect(diff.added.map((a) => a.id)).toEqual(["b"]);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-regression exits 1 on a dropped passed scenario; JSON stays parseable", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = makeSuiteDir(cwd, "base", {
        "a.scenario.json": buyScenarioNamed("a"),
        "b.scenario.json": buyScenarioNamed("b"),
      });
      const next = makeSuiteDir(cwd, "next", { "a.scenario.json": buyScenarioNamed("a") });

      const guarded = paperBacktestDiffSuiteReport(
        { cwd, env: {} },
        { baseDir: base, nextDir: next, failOnRegression: true },
      );
      expect(guarded.text).toContain("Regression: YES");
      expect(guarded.exitCode).toBe(1);

      // JSON parseable even on a regression, and without the flag exit stays 0.
      const asJson = paperBacktestDiffSuiteReport(
        { cwd, env: {} },
        { baseDir: base, nextDir: next, json: true },
      );
      const diff = JSON.parse(asJson.text) as { hasRegression: boolean };
      expect(diff.hasRegression).toBe(true);
      expect(asJson.exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("refuses a malformed suite-index.json", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = makeSuiteDir(cwd, "base", { "a.scenario.json": buyScenario() });
      const next = writeScenarioDir(cwd, "next", { });
      writeFileSync(join(cwd, "next", "suite-index.json"), "{ not json");
      const r = paperBacktestDiffSuiteReport({ cwd, env: {} }, { baseDir: base, nextDir: next });
      expect(r.text).toMatch(/^Refusing: suite-index\.json in next .* is not valid JSON/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses a JSON file that is not a suite index", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = makeSuiteDir(cwd, "base", { "a.scenario.json": buyScenario() });
      writeScenarioDir(cwd, "next", {});
      writeFileSync(join(cwd, "next", "suite-index.json"), JSON.stringify({ not: "an index" }));
      const r = paperBacktestDiffSuiteReport({ cwd, env: {} }, { baseDir: base, nextDir: "next" });
      expect(r.text).toMatch(/^Refusing: invalid backtest suite index/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("accepts a BOM-prefixed suite-index.json", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = makeSuiteDir(cwd, "base", { "a.scenario.json": buyScenario() });
      const next = makeSuiteDir(cwd, "next", { "a.scenario.json": buyScenario() });
      // Re-save the next index with a leading BOM; the diff must still parse it.
      const idxPath = join(cwd, "next", "suite-index.json");
      writeFileSync(idxPath, withBom(readFileSync(idxPath, "utf8")));
      const r = paperBacktestDiffSuiteReport({ cwd, env: {} }, { baseDir: base, nextDir: next });
      expect(r.text).not.toMatch(/^Refusing/);
      expect(r.text).toContain("Backtest suite diff");
    } finally {
      cleanup();
    }
  });
});

describe("paperBacktestVariantPlanExplainReport (Sprint 14, Slice B)", () => {
  function explainBase(): unknown {
    return {
      name: "explain base — INJECTED FIXTURE (simulated)",
      strategyConfig: STRATEGY_CONFIG,
      caps: { maxTradeSizeUsd: 1000, maxDailyLossUsd: 1000, maxOpenPositions: 5, killSwitch: false },
      defaultPaperSizeUsd: 100,
      steps: [
        {
          id: "step-1",
          at: PAPER_TIME,
          candidates: [{ mint: MINT_A, riskReport: passReport(MINT_A) }],
          prices: [
            { mint: MINT_A, priceUsd: 2, observedAt: PAPER_TIME, source: "injected-fixture" },
            { mint: MINT_A, priceUsd: 3, observedAt: PAPER_TIME, source: "injected-fixture" },
          ],
        },
      ],
    };
  }

  const PLAN = {
    name: "explain-sweep",
    variants: [
      { suffix: "up10", perturbations: [{ target: "price", op: "multiply", value: 1.1, min: 0 }] },
      { suffix: "plus1", perturbations: [{ target: "price", op: "add", value: 1, min: 0, max: 1000000 }] },
    ],
  };

  function writeBaseAndPlan(cwd: string, plan: unknown = PLAN): void {
    writeFileSync(join(cwd, "base.scenario.json"), JSON.stringify(explainBase(), null, 2));
    writeFileSync(join(cwd, "plan.json"), JSON.stringify(plan, null, 2));
  }

  const baseOpts = { basePath: "base.scenario.json", planPath: "plan.json" };

  it("refuses when --base or --plan is missing", () => {
    expect(paperBacktestVariantPlanExplainReport({}, {}).text).toMatch(/^Refusing: --base/);
    expect(paperBacktestVariantPlanExplainReport({}, { basePath: "b.json" }).text).toMatch(/^Refusing: --plan/);
    expect(paperBacktestVariantPlanExplainReport({}, {}).exitCode).toBe(1);
  });

  it("prints a PAPER-only DRY-RUN human report and writes nothing", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndPlan(cwd);
      const r = paperBacktestVariantPlanExplainReport({ cwd, env: {} }, baseOpts);
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain("SIMULATED PAPER-ONLY VARIANT PLAN (DRY RUN)");
      expect(r.text).toContain("PAPER ONLY");
      expect(r.text.toLowerCase()).toContain("injected");
      expect(r.text.toLowerCase()).toContain("not a live result");
      expect(r.text.toLowerCase()).toContain("not financial advice");
      expect(r.text.toLowerCase()).toContain("not a profitability claim");
      expect(r.text).toContain("up10");
      expect(r.text).toContain("plus1");
      // A dry run writes nothing.
      expect(readdirSync(cwd).sort()).toEqual(["base.scenario.json", "plan.json", "soulmaker.config.json"]);
    } finally {
      cleanup();
    }
  });

  it("emits a stable, parseable JSON explanation with --json", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndPlan(cwd);
      const r = paperBacktestVariantPlanExplainReport({ cwd, env: {} }, { ...baseOpts, json: true });
      expect(r.exitCode).toBe(0);
      const ex = JSON.parse(r.text) as {
        schemaVersion: string;
        valid: boolean;
        variantCount: number;
        totalMatchedValueCount: number;
        variants: { suffix: string; perturbations: { matchedValueCount: number }[] }[];
      };
      expect(ex.schemaVersion).toBe("backtest.variant-plan.explain.v1");
      expect(ex.valid).toBe(true);
      expect(ex.variantCount).toBe(2);
      expect(ex.totalMatchedValueCount).toBe(4);
      expect(ex.variants.map((v) => v.suffix)).toEqual(["up10", "plus1"]);
      // Byte-stable across two runs.
      const r2 = paperBacktestVariantPlanExplainReport({ cwd, env: {} }, { ...baseOpts, json: true });
      expect(r2.text).toBe(r.text);
    } finally {
      cleanup();
    }
  });

  it("does not mutate the base or plan files", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndPlan(cwd);
      const baseBefore = readFileSync(join(cwd, "base.scenario.json"), "utf8");
      const planBefore = readFileSync(join(cwd, "plan.json"), "utf8");
      paperBacktestVariantPlanExplainReport({ cwd, env: {} }, baseOpts);
      expect(readFileSync(join(cwd, "base.scenario.json"), "utf8")).toBe(baseBefore);
      expect(readFileSync(join(cwd, "plan.json"), "utf8")).toBe(planBefore);
    } finally {
      cleanup();
    }
  });

  it("refuses an invalid base, an invalid plan, and malformed JSON", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "bad-base.json"), JSON.stringify({ name: "x", steps: [] }));
      writeFileSync(join(cwd, "plan.json"), JSON.stringify(PLAN));
      writeFileSync(join(cwd, "not-json.json"), "{ this is not json");
      const badBase = paperBacktestVariantPlanExplainReport({ cwd, env: {} }, { basePath: "bad-base.json", planPath: "plan.json" });
      expect(badBase.text).toMatch(/^Refusing:/);
      expect(badBase.exitCode).toBe(1);

      writeFileSync(join(cwd, "base.scenario.json"), JSON.stringify(explainBase()));
      const badPlan = paperBacktestVariantPlanExplainReport({ cwd, env: {} }, { basePath: "base.scenario.json", planPath: "not-json.json" });
      expect(badPlan.text).toMatch(/^Refusing:/);
      expect(badPlan.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("reports (and refuses with exit 1) a perturbation that matches no values", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeBaseAndPlan(cwd, {
        variants: [{ suffix: "nomatch", perturbations: [{ target: "price", op: "multiply", value: 1.1, mint: "FakeZZZ9999999999999999999999999999999999999" }] }],
      });
      const r = paperBacktestVariantPlanExplainReport({ cwd, env: {} }, baseOpts);
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("MATCHES NOTHING");
      expect(r.text).toContain("Refusals:");
      // JSON form also reports valid:false with exit 1.
      const rj = paperBacktestVariantPlanExplainReport({ cwd, env: {} }, { ...baseOpts, json: true });
      expect(rj.exitCode).toBe(1);
      expect((JSON.parse(rj.text) as { valid: boolean }).valid).toBe(false);
    } finally {
      cleanup();
    }
  });
});
