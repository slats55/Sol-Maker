import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
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
  paperBacktestDiffSensitivityReport,
  paperBacktestSensitivityMatrixReport,
  paperBacktestDiffSensitivityMatrixReport,
  paperBacktestSuiteCoverageReport,
  paperBacktestResearchManifestReport,
  paperBacktestResearchVerifyReport,
  paperBacktestDiffResearchManifestReport,
  paperBacktestResearchBundleReport,
  paperBacktestResearchStatusReport,
  paperBacktestResearchIndexReport,
  paperBacktestDiffResearchBundleReport,
  paperBacktestDiffResearchIndexReport,
  paperBacktestResearchHistoryReport,
  paperBacktestResearchPortfolioReport,
  paperBacktestDiffResearchPortfolioReport,
  paperBacktestResearchPackReport,
  paperBacktestDiffResearchPackReport,
  paperSniperCandidatesValidateReport,
  paperSniperPreflightReport,
  paperSniperDecideReport,
  paperSniperWorkflowReport,
  stripJsonBom,
} from "./commands.js";
import { buildTokenRiskReport } from "@soulmaker/risk";
import { parseJournal, reduceJournal } from "@soulmaker/paper";
import {
  runBacktest,
  buildBacktestResearchBundle,
  buildBacktestResearchCampaignIndex,
  buildBacktestResearchCampaignHistoryReport,
  validateBacktestResearchCampaignHistoryReport,
  buildBacktestResearchPortfolioReport,
  validateBacktestResearchPortfolioReport,
  validateBacktestResearchPortfolioDiff,
  diffBacktestResearchPortfolioReports,
  buildBacktestResearchManifest,
  buildBacktestResearchArtifactPack,
  validateBacktestResearchArtifactPack,
  validateBacktestResearchArtifactPackDiff,
  type BacktestArtifactDescriptor,
} from "@soulmaker/backtest";
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

describe("paperBacktestDiffSensitivityReport (Sprint 14, Slice C)", () => {
  function diffBase(): unknown {
    return {
      name: "diff base — INJECTED FIXTURE (simulated)",
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
    name: "diff-sweep",
    variants: [
      { suffix: "up10", perturbations: [{ target: "price", op: "multiply", value: 1.1, min: 0 }] },
      { suffix: "plus1", perturbations: [{ target: "price", op: "add", value: 1, min: 0, max: 1000000 }] },
    ],
  };

  /** Produce a sensitivity report JSON string via the real Sprint 13 command. */
  function makeReportJson(cwd: string): string {
    writeFileSync(join(cwd, "base.scenario.json"), JSON.stringify(diffBase(), null, 2));
    writeFileSync(join(cwd, "plan.json"), JSON.stringify(PLAN, null, 2));
    return paperBacktestSensitivityReport(
      { cwd, env: {} },
      { basePath: "base.scenario.json", planPath: "plan.json", json: true },
    );
  }

  it("refuses when --base or --next is missing", () => {
    expect(paperBacktestDiffSensitivityReport({}, {}).text).toMatch(/^Refusing: --base/);
    expect(paperBacktestDiffSensitivityReport({}, { basePath: "a.json" }).text).toMatch(/^Refusing: --next/);
    expect(paperBacktestDiffSensitivityReport({}, {}).exitCode).toBe(1);
  });

  it("diffs two identical reports with no regression (exit 0) and writes nothing", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const report = makeReportJson(cwd);
      writeFileSync(join(cwd, "a.json"), report);
      writeFileSync(join(cwd, "b.json"), report);
      const before = readdirSync(cwd).sort();
      const r = paperBacktestDiffSensitivityReport({ cwd, env: {} }, { basePath: "a.json", nextPath: "b.json" });
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain("Sensitivity report diff (SIMULATED PAPER-ONLY)");
      expect(r.text).toContain("Regression: no");
      expect(r.text.toLowerCase()).toContain("not a live result");
      // The diff command writes nothing.
      expect(readdirSync(cwd).sort()).toEqual(before);
    } finally {
      cleanup();
    }
  });

  it("emits a stable JSON diff with --json", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const report = makeReportJson(cwd);
      writeFileSync(join(cwd, "a.json"), report);
      writeFileSync(join(cwd, "b.json"), report);
      const r = paperBacktestDiffSensitivityReport({ cwd, env: {} }, { basePath: "a.json", nextPath: "b.json", json: true });
      const parsed = JSON.parse(r.text) as { schemaVersion: string; hasRegression: boolean };
      expect(parsed.schemaVersion).toBe("backtest.sensitivity.diff.v1");
      expect(parsed.hasRegression).toBe(false);
      const r2 = paperBacktestDiffSensitivityReport({ cwd, env: {} }, { basePath: "a.json", nextPath: "b.json", json: true });
      expect(r2.text).toBe(r.text);
    } finally {
      cleanup();
    }
  });

  it("detects a same-digest bookkeeping regression and honors --fail-on-regression", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const report = makeReportJson(cwd);
      writeFileSync(join(cwd, "a.json"), report);
      // Hand-drift a variant's bookkeeping while keeping its digest → same-digest regression.
      const next = JSON.parse(report) as {
        variants: { suffix: string; summary: { totalPnlUsd: number; unrealizedPnlUsd: number } }[];
      };
      const v = next.variants.find((x) => x.suffix === "up10")!;
      v.summary.totalPnlUsd -= 10;
      v.summary.unrealizedPnlUsd -= 10;
      writeFileSync(join(cwd, "b.json"), JSON.stringify(next, null, 2));

      const noFail = paperBacktestDiffSensitivityReport({ cwd, env: {} }, { basePath: "a.json", nextPath: "b.json" });
      expect(noFail.exitCode).toBe(0); // regression present but not failing without the flag
      expect(noFail.text).toContain("Regression: YES");

      const withFail = paperBacktestDiffSensitivityReport(
        { cwd, env: {} },
        { basePath: "a.json", nextPath: "b.json", failOnRegression: true },
      );
      expect(withFail.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses a non-report or malformed JSON file", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const report = makeReportJson(cwd);
      writeFileSync(join(cwd, "a.json"), report);
      writeFileSync(join(cwd, "notreport.json"), JSON.stringify({ hello: "world" }));
      writeFileSync(join(cwd, "bad.json"), "{ not json");
      const nonReport = paperBacktestDiffSensitivityReport({ cwd, env: {} }, { basePath: "a.json", nextPath: "notreport.json" });
      expect(nonReport.text).toMatch(/^Refusing:/);
      expect(nonReport.exitCode).toBe(1);
      const malformed = paperBacktestDiffSensitivityReport({ cwd, env: {} }, { basePath: "a.json", nextPath: "bad.json" });
      expect(malformed.text).toMatch(/^Refusing:/);
      expect(malformed.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });
});

describe("paperBacktestSuiteCoverageReport (Sprint 14, Slice E)", () => {
  function covBase(): unknown {
    return {
      name: "coverage base — INJECTED FIXTURE (simulated)",
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
    name: "cov-sweep",
    variants: [
      { suffix: "up10", perturbations: [{ target: "price", op: "multiply", value: 1.1, min: 0 }] },
      { suffix: "plus1", perturbations: [{ target: "price", op: "add", value: 1, min: 0, max: 1000000 }] },
    ],
  };

  /** Produce a real reports/suite-index.json via the Sprint 13 sensitivity command. */
  function makeSuiteIndex(cwd: string): string {
    writeFileSync(join(cwd, "base.scenario.json"), JSON.stringify(covBase(), null, 2));
    writeFileSync(join(cwd, "plan.json"), JSON.stringify(PLAN, null, 2));
    paperBacktestSensitivityReport(
      { cwd, env: {} },
      { basePath: "base.scenario.json", planPath: "plan.json", outDir: "out" },
    );
    return join("out", "reports", "suite-index.json");
  }

  it("refuses when --suite-index is missing", () => {
    expect(paperBacktestSuiteCoverageReport({}, {})).toMatch(/^Refusing: --suite-index/);
  });

  it("reports coverage (human) with the PAPER-only / not-market-coverage labels", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const indexPath = makeSuiteIndex(cwd);
      const out = paperBacktestSuiteCoverageReport({ cwd, env: {} }, { suiteIndexPath: indexPath });
      expect(out).toContain("SIMULATED PAPER-ONLY COVERAGE");
      expect(out).toContain("PAPER ONLY");
      expect(out.toLowerCase()).toContain("not market coverage");
      expect(out.toLowerCase()).toContain("not a live result");
      expect(out.toLowerCase()).toContain("not a profitability claim");
      expect(out).toContain("Path-behaviour coverage:");
    } finally {
      cleanup();
    }
  });

  it("emits a stable, parseable coverage report with --json", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const indexPath = makeSuiteIndex(cwd);
      const out = paperBacktestSuiteCoverageReport({ cwd, env: {} }, { suiteIndexPath: indexPath, json: true });
      const cov = JSON.parse(out) as { schemaVersion: string; counts: { scenarioCount: number }; notMarketCoverage: boolean };
      expect(cov.schemaVersion).toBe("backtest.coverage.v1");
      expect(cov.notMarketCoverage).toBe(true);
      // baseline + 2 variants ran in the suite index.
      expect(cov.counts.scenarioCount).toBe(3);
      const out2 = paperBacktestSuiteCoverageReport({ cwd, env: {} }, { suiteIndexPath: indexPath, json: true });
      expect(out2).toBe(out);
    } finally {
      cleanup();
    }
  });

  it("refuses a non-index or malformed JSON file (and writes nothing)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "notindex.json"), JSON.stringify({ hello: "world" }));
      writeFileSync(join(cwd, "bad.json"), "{ not json");
      const before = readdirSync(cwd).sort();
      expect(paperBacktestSuiteCoverageReport({ cwd, env: {} }, { suiteIndexPath: "notindex.json" })).toMatch(/^Refusing:/);
      expect(paperBacktestSuiteCoverageReport({ cwd, env: {} }, { suiteIndexPath: "bad.json" })).toMatch(/^Refusing:/);
      expect(readdirSync(cwd).sort()).toEqual(before);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Sprint 15 — paper:backtest:sensitivity:matrix
//   Sweep a directory of injected base scenarios through one shared plan.
// ---------------------------------------------------------------------------

describe("paperBacktestSensitivityMatrixReport (Sprint 15)", () => {
  /** A two-price buy scenario so a price shift visibly moves the held PnL. */
  function matrixBase(name: string, p0: number, p1: number): unknown {
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
            { mint: MINT_A, priceUsd: p0, observedAt: PAPER_TIME, source: "injected-fixture" },
            { mint: MINT_A, priceUsd: p1, observedAt: PAPER_TIME, source: "injected-fixture" },
          ],
        },
      ],
    };
  }

  const PLAN = {
    name: "matrix-sweep",
    variants: [
      { suffix: "up10", perturbations: [{ target: "price", op: "multiply", value: 1.1, min: 0 }] },
      { suffix: "plus1", perturbations: [{ target: "price", op: "add", value: 1, min: 0, max: 1000000 }] },
    ],
  };

  /** Write a scenarios dir (two bases) + a plan file; return { dir, planPath }. */
  function writeMatrixInputs(cwd: string, plan: unknown = PLAN): { dir: string; planPath: string } {
    const dir = writeScenarioDir(cwd, "scenarios", {
      "alpha.scenario.json": matrixBase("alpha", 2, 3),
      "beta.scenario.json": matrixBase("beta", 4, 5),
    });
    writeFileSync(join(cwd, "plan.json"), JSON.stringify(plan, null, 2));
    return { dir, planPath: "plan.json" };
  }

  it("refuses when --dir or --plan is missing", () => {
    expect(paperBacktestSensitivityMatrixReport({}, {}).text).toMatch(/^Refusing: --dir/);
    expect(paperBacktestSensitivityMatrixReport({}, { dir: "scenarios" }).text).toMatch(/^Refusing: --plan/);
    expect(paperBacktestSensitivityMatrixReport({}, {}).exitCode).toBe(1);
  });

  it("refuses a missing scenario directory", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "plan.json"), JSON.stringify(PLAN));
      const r = paperBacktestSensitivityMatrixReport({ cwd, env: {} }, { dir: "nope", planPath: "plan.json" });
      expect(r.text).toMatch(/^Refusing: scenario directory not found/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses an empty directory", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeScenarioDir(cwd, "scenarios", {});
      writeFileSync(join(cwd, "plan.json"), JSON.stringify(PLAN));
      const r = paperBacktestSensitivityMatrixReport({ cwd, env: {} }, { dir, planPath: "plan.json" });
      expect(r.text).toMatch(/^Refusing: no \*\.scenario\.json files/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses (the whole matrix) when a scenario file is malformed JSON", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeScenarioDir(cwd, "scenarios", {
        "alpha.scenario.json": matrixBase("alpha", 2, 3),
        "broken.scenario.json": "{ not json",
      });
      writeFileSync(join(cwd, "plan.json"), JSON.stringify(PLAN));
      const r = paperBacktestSensitivityMatrixReport({ cwd, env: {} }, { dir, planPath: "plan.json" });
      expect(r.text).toMatch(/^Refusing: scenario file broken\.scenario\.json is not valid JSON/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses a malformed plan", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeScenarioDir(cwd, "scenarios", { "alpha.scenario.json": matrixBase("alpha", 2, 3) });
      writeFileSync(join(cwd, "bad-plan.json"), "{ not json");
      const r = paperBacktestSensitivityMatrixReport({ cwd, env: {} }, { dir, planPath: "bad-plan.json" });
      expect(r.text).toMatch(/^Refusing: variant plan file is not valid JSON/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses two base scenarios whose sanitized stems collide", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeScenarioDir(cwd, "scenarios", {
        "a b.scenario.json": matrixBase("a", 2, 3),
        "a_b.scenario.json": matrixBase("b", 4, 5),
      });
      writeFileSync(join(cwd, "plan.json"), JSON.stringify(PLAN));
      const r = paperBacktestSensitivityMatrixReport({ cwd, env: {} }, { dir, planPath: "plan.json" });
      expect(r.text).toMatch(/map to the same base id/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses a base that is incompatible with the plan, naming the base", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeScenarioDir(cwd, "scenarios", { "alpha.scenario.json": matrixBase("alpha", 2, 3) });
      // A mint-filtered perturbation that matches nothing in alpha.
      writeFileSync(
        join(cwd, "plan.json"),
        JSON.stringify({
          name: "ghost",
          variants: [
            {
              suffix: "ghost",
              perturbations: [{ target: "price", op: "multiply", value: 1.1, min: 0, mint: "FakeZZZ9999999999999999999999999999999999999" }],
            },
          ],
        }),
      );
      const r = paperBacktestSensitivityMatrixReport({ cwd, env: {} }, { dir, planPath: "plan.json" });
      expect(r.text).toMatch(/^Refusing: base "alpha" could not be swept through the plan/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("prints a PAPER-only human report (banner + not-live/not-advice/not-profit), exit 0", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const { dir, planPath } = writeMatrixInputs(cwd);
      const r = paperBacktestSensitivityMatrixReport({ cwd, env: {} }, { dir, planPath });
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain("SIMULATED PAPER-ONLY SENSITIVITY MATRIX");
      expect(r.text).toContain("PAPER ONLY");
      expect(r.text.toLowerCase()).toContain("not a live result");
      expect(r.text.toLowerCase()).toContain("not financial advice");
      expect(r.text.toLowerCase()).toContain("not a profitability claim");
      expect(r.text).toContain("alpha");
      expect(r.text).toContain("beta");
      // No --out-dir ⇒ nothing written.
      expect(existsSync(join(cwd, "sensitivity-matrix-report.json"))).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("emits a stable, parseable matrix report with --json (schema + counts)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const { dir, planPath } = writeMatrixInputs(cwd);
      const out = paperBacktestSensitivityMatrixReport({ cwd, env: {} }, { dir, planPath, json: true });
      expect(out.exitCode).toBe(0);
      const report = JSON.parse(out.text) as {
        schemaVersion: string;
        baseCount: number;
        variantCount: number;
        bases: { id: string }[];
        passedBaseCount: number;
      };
      expect(report.schemaVersion).toBe("backtest.sensitivity.matrix.v1");
      expect(report.baseCount).toBe(2);
      expect(report.variantCount).toBe(2);
      expect(report.passedBaseCount).toBe(2);
      expect(report.bases.map((b) => b.id)).toEqual(["alpha", "beta"]);
      // Byte-identical across two runs (no timestamps, deterministic).
      const out2 = paperBacktestSensitivityMatrixReport({ cwd, env: {} }, { dir, planPath, json: true });
      expect(out2.text).toBe(out.text);
    } finally {
      cleanup();
    }
  });

  it("writes the matrix report + one per-base sensitivity report under --out-dir (no journals)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const { dir, planPath } = writeMatrixInputs(cwd);
      const r = paperBacktestSensitivityMatrixReport({ cwd, env: {} }, { dir, planPath, outDir: "out" });
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain("Wrote ");

      const top = readdirSync(join(cwd, "out")).sort();
      expect(top).toEqual(["bases", "sensitivity-matrix-report.json"]);
      const bases = readdirSync(join(cwd, "out", "bases")).sort();
      expect(bases).toEqual(["alpha.sensitivity-report.json", "beta.sensitivity-report.json"]);
      // No journals ever.
      expect(top.some((f) => f.endsWith(".jsonl"))).toBe(false);

      // Headline is a valid matrix report; each base file is a sensitivity report.
      const matrix = JSON.parse(readFileSync(join(cwd, "out", "sensitivity-matrix-report.json"), "utf8")) as {
        schemaVersion: string;
      };
      expect(matrix.schemaVersion).toBe("backtest.sensitivity.matrix.v1");
      const alpha = JSON.parse(readFileSync(join(cwd, "out", "bases", "alpha.sensitivity-report.json"), "utf8")) as {
        schemaVersion: string;
      };
      expect(alpha.schemaVersion).toBe("backtest.sensitivity.v1");
    } finally {
      cleanup();
    }
  });

  it("refuses to overwrite existing outputs unless --force, with no partial write", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const { dir, planPath } = writeMatrixInputs(cwd);
      const opts = { dir, planPath, outDir: "out" };
      expect(paperBacktestSensitivityMatrixReport({ cwd, env: {} }, opts).text).toContain("Wrote ");
      const blocked = paperBacktestSensitivityMatrixReport({ cwd, env: {} }, opts);
      expect(blocked.text).toMatch(/already exist \(pass --force/);
      expect(blocked.exitCode).toBe(1);
      expect(paperBacktestSensitivityMatrixReport({ cwd, env: {} }, { ...opts, force: true }).text).toContain("Wrote ");
    } finally {
      cleanup();
    }
  });

  it("does not write partial output when a later target already exists (no --force)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const { dir, planPath } = writeMatrixInputs(cwd);
      mkdirSync(join(cwd, "out"), { recursive: true });
      writeFileSync(join(cwd, "out", "sensitivity-matrix-report.json"), "{}");
      const r = paperBacktestSensitivityMatrixReport({ cwd, env: {} }, { dir, planPath, outDir: "out" });
      expect(r.text).toMatch(/^Refusing: .* already exist/);
      expect(existsSync(join(cwd, "out", "bases"))).toBe(false);
      expect(readFileSync(join(cwd, "out", "sensitivity-matrix-report.json"), "utf8")).toBe("{}"); // untouched
    } finally {
      cleanup();
    }
  });

  it("does not mutate the base scenario files or the plan file", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const { dir, planPath } = writeMatrixInputs(cwd);
      const alphaBefore = readFileSync(join(cwd, "scenarios", "alpha.scenario.json"), "utf8");
      const planBefore = readFileSync(join(cwd, "plan.json"), "utf8");
      paperBacktestSensitivityMatrixReport({ cwd, env: {} }, { dir, planPath, outDir: "out" });
      expect(readFileSync(join(cwd, "scenarios", "alpha.scenario.json"), "utf8")).toBe(alphaBefore);
      expect(readFileSync(join(cwd, "plan.json"), "utf8")).toBe(planBefore);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-error exits 0 when every base baseline and variant run passed", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const { dir, planPath } = writeMatrixInputs(cwd);
      const r = paperBacktestSensitivityMatrixReport({ cwd, env: {} }, { dir, planPath, failOnError: true });
      expect(r.exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("accepts a BOM-prefixed base scenario", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeScenarioDir(cwd, "scenarios", {
        "alpha.scenario.json": withBom(JSON.stringify(matrixBase("alpha", 2, 3))),
      });
      writeFileSync(join(cwd, "plan.json"), JSON.stringify(PLAN));
      const r = paperBacktestSensitivityMatrixReport({ cwd, env: {} }, { dir, planPath: "plan.json", json: true });
      const report = JSON.parse(r.text) as { baseCount: number };
      expect(report.baseCount).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("redacts secret-looking content in the report output (backstop)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      // An 80+ char base58-looking run in the base scenario NAME ⇒ redacted in the
      // report's baseScenarioName field.
      const secret = "S".repeat(90);
      const dir = writeScenarioDir(cwd, "scenarios", {
        "alpha.scenario.json": matrixBase(secret, 2, 3),
      });
      writeFileSync(join(cwd, "plan.json"), JSON.stringify(PLAN));
      const r = paperBacktestSensitivityMatrixReport({ cwd, env: {} }, { dir, planPath: "plan.json", json: true });
      expect(r.text).not.toContain(secret);
      expect(r.text).toContain("[REDACTED]");
    } finally {
      cleanup();
    }
  });

  it("runs the shipped examples directory end-to-end as a 4-base × 3-variant matrix", () => {
    // ctx defaults cwd to the repo root, so the real examples resolve.
    const r = paperBacktestSensitivityMatrixReport(
      {},
      {
        dir: "examples/backtest",
        planPath: "examples/backtest/price-sensitivity.variant-plan.json",
        json: true,
      },
    );
    expect(r.exitCode).toBe(0);
    const report = JSON.parse(r.text) as {
      schemaVersion: string;
      baseCount: number;
      variantCount: number;
      passedBaseCount: number;
    };
    expect(report.schemaVersion).toBe("backtest.sensitivity.matrix.v1");
    expect(report.baseCount).toBe(4); // the four shipped scenarios
    expect(report.variantCount).toBe(3); // the shipped plan's three variants
    expect(report.passedBaseCount).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Sprint 15 — paper:backtest:diff:sensitivity:matrix
//   Diff two matrix report JSON files; reads two files, writes nothing.
// ---------------------------------------------------------------------------

describe("paperBacktestDiffSensitivityMatrixReport (Sprint 15)", () => {
  function matrixBase(name: string, p0: number, p1: number): unknown {
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
            { mint: MINT_A, priceUsd: p0, observedAt: PAPER_TIME, source: "injected-fixture" },
            { mint: MINT_A, priceUsd: p1, observedAt: PAPER_TIME, source: "injected-fixture" },
          ],
        },
      ],
    };
  }

  const PLAN = {
    name: "matrix-sweep",
    variants: [{ suffix: "plus1", perturbations: [{ target: "price", op: "add", value: 1, min: 0, max: 1000000 }] }],
  };

  /** Produce a matrix report JSON over `bases` via the real Sprint 15 command. */
  function makeMatrixJson(cwd: string, sub: string, bases: Record<string, unknown>): string {
    const dir = writeScenarioDir(cwd, sub, bases);
    writeFileSync(join(cwd, `${sub}.plan.json`), JSON.stringify(PLAN, null, 2));
    const r = paperBacktestSensitivityMatrixReport(
      { cwd, env: {} },
      { dir, planPath: `${sub}.plan.json`, json: true },
    );
    return r.text;
  }

  it("refuses when --base or --next is missing", () => {
    expect(paperBacktestDiffSensitivityMatrixReport({}, {}).text).toMatch(/^Refusing: --base/);
    expect(paperBacktestDiffSensitivityMatrixReport({}, { basePath: "a.json" }).text).toMatch(/^Refusing: --next/);
    expect(paperBacktestDiffSensitivityMatrixReport({}, {}).exitCode).toBe(1);
  });

  it("diffs two identical matrices with no regression (exit 0) and writes nothing", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const report = makeMatrixJson(cwd, "m", {
        "alpha.scenario.json": matrixBase("alpha", 2, 3),
        "beta.scenario.json": matrixBase("beta", 4, 5),
      });
      writeFileSync(join(cwd, "a.json"), report);
      writeFileSync(join(cwd, "b.json"), report);
      const before = readdirSync(cwd).sort();
      const r = paperBacktestDiffSensitivityMatrixReport({ cwd, env: {} }, { basePath: "a.json", nextPath: "b.json" });
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain("Sensitivity matrix diff (SIMULATED PAPER-ONLY)");
      expect(r.text).toContain("Regression: no");
      expect(r.text.toLowerCase()).toContain("not a live result");
      expect(readdirSync(cwd).sort()).toEqual(before); // wrote nothing
    } finally {
      cleanup();
    }
  });

  it("flags a removed passed base as a regression and sets exit 1 with --fail-on-regression", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const baseReport = makeMatrixJson(cwd, "two", {
        "alpha.scenario.json": matrixBase("alpha", 2, 3),
        "beta.scenario.json": matrixBase("beta", 4, 5),
      });
      const nextReport = makeMatrixJson(cwd, "one", {
        "alpha.scenario.json": matrixBase("alpha", 2, 3),
      });
      writeFileSync(join(cwd, "base.json"), baseReport);
      writeFileSync(join(cwd, "next.json"), nextReport);

      const r = paperBacktestDiffSensitivityMatrixReport(
        { cwd, env: {} },
        { basePath: "base.json", nextPath: "next.json", failOnRegression: true },
      );
      expect(r.text).toContain("Regression: YES");
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("emits a stable, parseable matrix diff with --json", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const report = makeMatrixJson(cwd, "m", {
        "alpha.scenario.json": matrixBase("alpha", 2, 3),
        "beta.scenario.json": matrixBase("beta", 4, 5),
      });
      writeFileSync(join(cwd, "a.json"), report);
      writeFileSync(join(cwd, "b.json"), report);
      const r = paperBacktestDiffSensitivityMatrixReport({ cwd, env: {} }, { basePath: "a.json", nextPath: "b.json", json: true });
      const diff = JSON.parse(r.text) as { schemaVersion: string; hasRegression: boolean };
      expect(diff.schemaVersion).toBe("backtest.sensitivity.matrix.diff.v1");
      expect(diff.hasRegression).toBe(false);
      const r2 = paperBacktestDiffSensitivityMatrixReport({ cwd, env: {} }, { basePath: "a.json", nextPath: "b.json", json: true });
      expect(r2.text).toBe(r.text);
    } finally {
      cleanup();
    }
  });

  it("refuses a non-matrix input file", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "a.json"), JSON.stringify({ not: "a matrix" }));
      writeFileSync(join(cwd, "b.json"), JSON.stringify({ not: "a matrix" }));
      const r = paperBacktestDiffSensitivityMatrixReport({ cwd, env: {} }, { basePath: "a.json", nextPath: "b.json" });
      expect(r.text).toMatch(/^Refusing:/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Sprint 16 — paper:backtest:research:manifest / :verify / diff:research:manifest
// ---------------------------------------------------------------------------

describe("paperBacktestResearchManifestReport (Sprint 16)", () => {
  /** Write a small artifact tree under <cwd>/<sub> and return the relative dir. */
  function writeArtifactDir(cwd: string, sub: string): string {
    const dir = join(cwd, sub);
    mkdirSync(join(dir, "reports"), { recursive: true });
    writeFileSync(join(dir, "reports", "a.report.json"), JSON.stringify({ schemaVersion: "backtest.report.v1", x: 1 }, null, 2));
    writeFileSync(join(dir, "suite-index.json"), JSON.stringify({ schemaVersion: "backtest.suite.v1", y: 2 }, null, 2));
    writeFileSync(join(dir, "my.scenario.json"), JSON.stringify({ name: "s", steps: [] }, null, 2));
    return sub;
  }

  it("refuses when --dir is missing or not a directory", () => {
    expect(paperBacktestResearchManifestReport({}, {}).text).toMatch(/^Refusing: --dir/);
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const r = paperBacktestResearchManifestReport({ cwd, env: {} }, { dir: "nope" });
      expect(r.text).toMatch(/^Refusing: artifact directory not found/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("indexes a directory's artifacts with kinds, schemas, and a digest label", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeArtifactDir(cwd, "run");
      const r = paperBacktestResearchManifestReport({ cwd, env: {} }, { dir, json: true });
      expect(r.exitCode).toBe(0);
      const manifest = JSON.parse(r.text) as {
        schemaVersion: string;
        artifactCount: number;
        artifacts: { path: string; kind: string; schemaVersion: string | null }[];
        kindCounts: { kind: string; count: number }[];
        digestAlgorithm: string;
      };
      expect(manifest.schemaVersion).toBe("backtest.research.manifest.v1");
      expect(manifest.artifactCount).toBe(3);
      // Forward-slashed, sorted relative paths (nested reports/ included).
      expect(manifest.artifacts.map((a) => a.path)).toEqual([
        "my.scenario.json",
        "reports/a.report.json",
        "suite-index.json",
      ]);
      expect(manifest.artifacts.find((a) => a.path === "reports/a.report.json")!.kind).toBe("backtest-report");
      expect(manifest.artifacts.find((a) => a.path === "my.scenario.json")!.kind).toBe("scenario");
      expect(manifest.digestAlgorithm).toMatch(/non-cryptographic/);
      // Byte-stable across two runs.
      expect(paperBacktestResearchManifestReport({ cwd, env: {} }, { dir, json: true }).text).toBe(r.text);
    } finally {
      cleanup();
    }
  });

  it("reports a malformed JSON file as unknown-json and --strict exits 1", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeArtifactDir(cwd, "run");
      writeFileSync(join(cwd, "run", "broken.json"), "{ not json");
      const human = paperBacktestResearchManifestReport({ cwd, env: {} }, { dir });
      expect(human.text).toContain("Malformed (unparseable) JSON file(s)");
      expect(human.text).toContain("broken.json");
      expect(human.exitCode).toBe(0); // non-strict
      const strict = paperBacktestResearchManifestReport({ cwd, env: {} }, { dir, strict: true });
      expect(strict.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("--out writes the manifest and refuses to overwrite without --force", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeArtifactDir(cwd, "run");
      const first = paperBacktestResearchManifestReport({ cwd, env: {} }, { dir, outPath: "run/manifest.json" });
      expect(first.text).toContain("Wrote manifest");
      const written = JSON.parse(readFileSync(join(cwd, "run", "manifest.json"), "utf8")) as { schemaVersion: string };
      expect(written.schemaVersion).toBe("backtest.research.manifest.v1");
      const blocked = paperBacktestResearchManifestReport({ cwd, env: {} }, { dir, outPath: "run/manifest.json" });
      expect(blocked.text).toMatch(/already exists \(pass --force/);
      expect(blocked.exitCode).toBe(1);
      expect(paperBacktestResearchManifestReport({ cwd, env: {} }, { dir, outPath: "run/manifest.json", force: true }).text).toContain("Wrote manifest");
    } finally {
      cleanup();
    }
  });

  it("excludes a manifest written into the same dir (so it never indexes itself)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeArtifactDir(cwd, "run");
      // Write the manifest INTO the run dir, then re-index: the manifest meta file is skipped.
      paperBacktestResearchManifestReport({ cwd, env: {} }, { dir, outPath: "run/research-manifest.json" });
      const r = paperBacktestResearchManifestReport({ cwd, env: {} }, { dir, json: true });
      const manifest = JSON.parse(r.text) as { artifactCount: number; artifacts: { path: string }[] };
      expect(manifest.artifactCount).toBe(3); // still 3 — the manifest itself is excluded
      expect(manifest.artifacts.some((a) => a.path === "research-manifest.json")).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("redacts a secret-looking artifact path (backstop)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      mkdirSync(join(cwd, "run"), { recursive: true });
      // An 80+ char base58-looking run in a FILENAME ⇒ redacted in the manifest's path field.
      const secret = "S".repeat(90);
      writeFileSync(join(cwd, "run", `${secret}.report.json`), JSON.stringify({ schemaVersion: "backtest.report.v1" }));
      const r = paperBacktestResearchManifestReport({ cwd, env: {} }, { dir: "run", json: true });
      expect(r.text).not.toContain(secret);
      expect(r.text).toContain("[REDACTED]");
    } finally {
      cleanup();
    }
  });
});

describe("paperBacktestResearchVerifyReport (Sprint 16)", () => {
  function setup(cwd: string): string {
    const dir = join(cwd, "run");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.report.json"), JSON.stringify({ schemaVersion: "backtest.report.v1", x: 1 }, null, 2));
    writeFileSync(join(dir, "b.suite.json"), JSON.stringify({ schemaVersion: "backtest.suite.v1", y: 2 }, null, 2));
    paperBacktestResearchManifestReport({ cwd, env: {} }, { dir: "run", outPath: "manifest.json" });
    return "run";
  }

  it("refuses when --manifest or --dir is missing", () => {
    expect(paperBacktestResearchVerifyReport({}, {}).text).toMatch(/^Refusing: --manifest/);
    expect(paperBacktestResearchVerifyReport({}, { manifestPath: "m.json" }).text).toMatch(/^Refusing: --dir/);
  });

  it("verifies a clean directory as VALID (exit 0) and writes nothing", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = setup(cwd);
      const before = readdirSync(join(cwd, dir)).sort();
      const r = paperBacktestResearchVerifyReport({ cwd, env: {} }, { manifestPath: "manifest.json", dir });
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain("(VALID)");
      expect(readdirSync(join(cwd, dir)).sort()).toEqual(before); // wrote nothing
    } finally {
      cleanup();
    }
  });

  it("detects a changed artifact as INVALID (exit 1)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = setup(cwd);
      writeFileSync(join(cwd, dir, "a.report.json"), JSON.stringify({ schemaVersion: "backtest.report.v1", x: 999 }, null, 2));
      const r = paperBacktestResearchVerifyReport({ cwd, env: {} }, { manifestPath: "manifest.json", dir });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("(INVALID)");
      expect(r.text).toContain("digest-changed");
    } finally {
      cleanup();
    }
  });

  it("detects an extra and a missing artifact", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = setup(cwd);
      writeFileSync(join(cwd, dir, "c.extra.json"), JSON.stringify({ schemaVersion: "backtest.coverage.v1" }));
      rmSync(join(cwd, dir, "b.suite.json"));
      const r = paperBacktestResearchVerifyReport({ cwd, env: {} }, { manifestPath: "manifest.json", dir, json: true });
      const v = JSON.parse(r.text) as { valid: boolean; extraCount: number; missingCount: number };
      expect(v.valid).toBe(false);
      expect(v.extraCount).toBe(1);
      expect(v.missingCount).toBe(1);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses a malformed manifest", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = setup(cwd);
      writeFileSync(join(cwd, "bad.json"), JSON.stringify({ not: "a manifest" }));
      const r = paperBacktestResearchVerifyReport({ cwd, env: {} }, { manifestPath: "bad.json", dir });
      expect(r.text).toMatch(/^Refusing:/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });
});

describe("paperBacktestDiffResearchManifestReport (Sprint 16)", () => {
  /** Produce a manifest JSON string over a freshly-written dir. */
  function makeManifest(cwd: string, sub: string, extra?: { name: string; content: unknown }): string {
    const dir = join(cwd, sub);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.report.json"), JSON.stringify({ schemaVersion: "backtest.report.v1", x: 1 }));
    if (extra) writeFileSync(join(dir, extra.name), JSON.stringify(extra.content));
    return paperBacktestResearchManifestReport({ cwd, env: {} }, { dir: sub, json: true }).text;
  }

  it("refuses when --base or --next is missing", () => {
    expect(paperBacktestDiffResearchManifestReport({}, {}).text).toMatch(/^Refusing: --base/);
    expect(paperBacktestDiffResearchManifestReport({}, { basePath: "a.json" }).text).toMatch(/^Refusing: --next/);
  });

  it("reports no change for two identical manifests (exit 0)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const m = makeManifest(cwd, "one");
      writeFileSync(join(cwd, "a.json"), m);
      writeFileSync(join(cwd, "b.json"), m);
      const r = paperBacktestDiffResearchManifestReport({ cwd, env: {} }, { basePath: "a.json", nextPath: "b.json" });
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain("Changed: no");
      expect(r.text.toLowerCase()).toContain("not a live result");
    } finally {
      cleanup();
    }
  });

  it("detects an added artifact and --fail-on-change exits 1", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const baseM = makeManifest(cwd, "base");
      const nextM = makeManifest(cwd, "next", { name: "b.suite.json", content: { schemaVersion: "backtest.suite.v1" } });
      writeFileSync(join(cwd, "base.json"), baseM);
      writeFileSync(join(cwd, "next.json"), nextM);
      const r = paperBacktestDiffResearchManifestReport(
        { cwd, env: {} },
        { basePath: "base.json", nextPath: "next.json", failOnChange: true, json: true },
      );
      const diff = JSON.parse(r.text) as { hasChange: boolean; added: { path: string }[] };
      expect(diff.hasChange).toBe(true);
      expect(diff.added.map((a) => a.path)).toEqual(["b.suite.json"]);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses a non-manifest input", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "a.json"), JSON.stringify({ nope: true }));
      writeFileSync(join(cwd, "b.json"), JSON.stringify({ nope: true }));
      const r = paperBacktestDiffResearchManifestReport({ cwd, env: {} }, { basePath: "a.json", nextPath: "b.json" });
      expect(r.text).toMatch(/^Refusing:/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });
});

describe("paperBacktestResearchBundleReport (Sprint 17)", () => {
  /** Write a small artifact tree under <cwd>/<sub> and return the relative dir. */
  function writeArtifactDir(cwd: string, sub: string): string {
    const dir = join(cwd, sub);
    mkdirSync(join(dir, "reports"), { recursive: true });
    writeFileSync(join(dir, "reports", "a.report.json"), JSON.stringify({ schemaVersion: "backtest.report.v1", x: 1 }, null, 2));
    writeFileSync(join(dir, "suite-index.json"), JSON.stringify({ schemaVersion: "backtest.suite.v1", y: 2 }, null, 2));
    writeFileSync(join(dir, "my.scenario.json"), JSON.stringify({ name: "s", steps: [] }, null, 2));
    return sub;
  }

  it("refuses when --dir is missing or not a directory", () => {
    expect(paperBacktestResearchBundleReport({}, {}).text).toMatch(/^Refusing: --dir/);
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const r = paperBacktestResearchBundleReport({ cwd, env: {} }, { dir: "nope" });
      expect(r.text).toMatch(/^Refusing: artifact directory not found/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("bundles a directory: counts, recognized schemas, sorted digest refs, and a run digest", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeArtifactDir(cwd, "run");
      const r = paperBacktestResearchBundleReport({ cwd, env: {} }, { dir, json: true });
      expect(r.exitCode).toBe(0);
      const bundle = JSON.parse(r.text) as {
        schemaVersion: string;
        runDigest: string;
        artifactCount: number;
        recognizedSchemaVersions: string[];
        digestEntries: { path: string; digest: string }[];
        manifest: { manifestDigest: string };
      };
      expect(bundle.schemaVersion).toBe("backtest.research.bundle.v1");
      expect(bundle.artifactCount).toBe(3);
      expect(bundle.runDigest).toMatch(/^[0-9a-f]+$/);
      expect(bundle.recognizedSchemaVersions).toEqual(["backtest.report.v1", "backtest.suite.v1"]);
      expect(bundle.digestEntries.map((e) => e.path)).toEqual([
        "my.scenario.json",
        "reports/a.report.json",
        "suite-index.json",
      ]);
      expect(bundle.manifest.manifestDigest).toMatch(/^[0-9a-f]+$/);
      // Byte-stable across two runs.
      expect(paperBacktestResearchBundleReport({ cwd, env: {} }, { dir, json: true }).text).toBe(r.text);
    } finally {
      cleanup();
    }
  });

  it("--out writes the bundle and refuses to overwrite without --force", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeArtifactDir(cwd, "run");
      const first = paperBacktestResearchBundleReport({ cwd, env: {} }, { dir, outPath: "run/bundle.json" });
      expect(first.text).toContain("Wrote bundle");
      const written = JSON.parse(readFileSync(join(cwd, "run", "bundle.json"), "utf8")) as { schemaVersion: string };
      expect(written.schemaVersion).toBe("backtest.research.bundle.v1");
      const blocked = paperBacktestResearchBundleReport({ cwd, env: {} }, { dir, outPath: "run/bundle.json" });
      expect(blocked.text).toMatch(/already exists \(pass --force/);
      expect(blocked.exitCode).toBe(1);
      expect(paperBacktestResearchBundleReport({ cwd, env: {} }, { dir, outPath: "run/bundle.json", force: true }).text).toContain("Wrote bundle");
    } finally {
      cleanup();
    }
  });

  it("reports a malformed JSON file as unknown-json and --strict exits 1", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeArtifactDir(cwd, "run");
      writeFileSync(join(cwd, "run", "broken.json"), "{ not json");
      const human = paperBacktestResearchBundleReport({ cwd, env: {} }, { dir });
      expect(human.text).toContain("Malformed (unparseable) JSON file(s)");
      expect(human.text).toContain("broken.json");
      expect(human.exitCode).toBe(0); // non-strict
      const strict = paperBacktestResearchBundleReport({ cwd, env: {} }, { dir, strict: true });
      expect(strict.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("excludes manifest/bundle/status meta files written into the same dir (never indexes itself)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeArtifactDir(cwd, "run");
      // Drop a manifest, a bundle, and a status file INTO the run dir, then re-bundle.
      paperBacktestResearchManifestReport({ cwd, env: {} }, { dir, outPath: "run/research-manifest.json" });
      paperBacktestResearchBundleReport({ cwd, env: {} }, { dir, outPath: "run/research-bundle.json" });
      paperBacktestResearchStatusReport({ cwd, env: {} }, { dir, json: true }); // writes nothing
      writeFileSync(join(cwd, "run", "research-status.json"), JSON.stringify({ schemaVersion: "backtest.research.status.v1" }));
      const r = paperBacktestResearchBundleReport({ cwd, env: {} }, { dir, json: true });
      const bundle = JSON.parse(r.text) as { artifactCount: number; digestEntries: { path: string }[] };
      expect(bundle.artifactCount).toBe(3); // still 3 — every meta file is excluded
      const paths = bundle.digestEntries.map((e) => e.path);
      expect(paths.some((p) => /research-manifest\.json|research-bundle\.json|research-status\.json/.test(p))).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("ignores *.jsonl files entirely", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeArtifactDir(cwd, "run");
      writeFileSync(join(cwd, "run", "journal.jsonl"), '{"event":"x"}\n{"event":"y"}\n');
      const r = paperBacktestResearchBundleReport({ cwd, env: {} }, { dir, json: true });
      const bundle = JSON.parse(r.text) as { artifactCount: number; digestEntries: { path: string }[] };
      expect(bundle.artifactCount).toBe(3); // .jsonl is never read/indexed
      expect(bundle.digestEntries.some((e) => e.path.endsWith(".jsonl"))).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("skips symlinks (when the platform allows creating one)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeArtifactDir(cwd, "run");
      let symlinkCreated = false;
      try {
        symlinkSync(join(cwd, "run", "reports", "a.report.json"), join(cwd, "run", "linked.report.json"));
        symlinkCreated = true;
      } catch {
        symlinkCreated = false; // Windows without privileges — the walk-skip is still exercised elsewhere
      }
      const r = paperBacktestResearchBundleReport({ cwd, env: {} }, { dir, json: true });
      const bundle = JSON.parse(r.text) as { artifactCount: number; digestEntries: { path: string }[] };
      if (symlinkCreated) {
        expect(bundle.artifactCount).toBe(3); // the symlink is skipped, not indexed
        expect(bundle.digestEntries.some((e) => e.path === "linked.report.json")).toBe(false);
      } else {
        expect(bundle.artifactCount).toBe(3);
      }
    } finally {
      cleanup();
    }
  });

  it("redacts a secret-looking artifact path (backstop)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      mkdirSync(join(cwd, "run"), { recursive: true });
      const secret = "S".repeat(90);
      writeFileSync(join(cwd, "run", `${secret}.report.json`), JSON.stringify({ schemaVersion: "backtest.report.v1" }));
      const r = paperBacktestResearchBundleReport({ cwd, env: {} }, { dir: "run", json: true });
      expect(r.text).not.toContain(secret);
      expect(r.text).toContain("[REDACTED]");
    } finally {
      cleanup();
    }
  });
});

describe("paperBacktestResearchStatusReport (Sprint 17)", () => {
  function writeArtifactDir(cwd: string, sub: string): string {
    const dir = join(cwd, sub);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "a.report.json"), JSON.stringify({ schemaVersion: "backtest.report.v1", x: 1 }, null, 2));
    writeFileSync(join(dir, "b.suite.json"), JSON.stringify({ schemaVersion: "backtest.suite.v1", y: 2 }, null, 2));
    return sub;
  }

  it("refuses when --dir is missing or not a directory", () => {
    expect(paperBacktestResearchStatusReport({}, {}).text).toMatch(/^Refusing: --dir/);
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const r = paperBacktestResearchStatusReport({ cwd, env: {} }, { dir: "nope" });
      expect(r.text).toMatch(/^Refusing: artifact directory not found/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("summarizes a healthy directory (no manifest) and WRITES NOTHING", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeArtifactDir(cwd, "run");
      const before = readdirSync(join(cwd, dir)).sort();
      const r = paperBacktestResearchStatusReport({ cwd, env: {} }, { dir });
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain("SIMULATED PAPER-ONLY RESEARCH STATUS");
      expect(r.text).toContain("- complete:   yes");
      expect(r.text).toContain("No manifest recorded");
      expect(readdirSync(join(cwd, dir)).sort()).toEqual(before); // wrote nothing
    } finally {
      cleanup();
    }
  });

  it("--json emits a valid status object", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeArtifactDir(cwd, "run");
      const r = paperBacktestResearchStatusReport({ cwd, env: {} }, { dir, json: true });
      const status = JSON.parse(r.text) as {
        schemaVersion: string;
        complete: boolean;
        recognized: boolean;
        stable: boolean;
        manifest: { present: boolean };
      };
      expect(status.schemaVersion).toBe("backtest.research.status.v1");
      expect(status.complete).toBe(true);
      expect(status.recognized).toBe(true);
      expect(status.stable).toBe(true);
      expect(status.manifest.present).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("reports IN SYNC against an explicit --manifest", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeArtifactDir(cwd, "run");
      paperBacktestResearchManifestReport({ cwd, env: {} }, { dir, outPath: "manifest.json" });
      const r = paperBacktestResearchStatusReport({ cwd, env: {} }, { dir, manifestPath: "manifest.json", json: true });
      const status = JSON.parse(r.text) as { manifest: { present: boolean; inSync: boolean } };
      expect(status.manifest.present).toBe(true);
      expect(status.manifest.inSync).toBe(true);
      expect(r.exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("discovers a research-manifest.json in the dir and detects drift; --strict exits 1", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeArtifactDir(cwd, "run");
      // Record a manifest INTO the run dir by the conventional name, then mutate an artifact.
      paperBacktestResearchManifestReport({ cwd, env: {} }, { dir, outPath: "run/research-manifest.json" });
      writeFileSync(join(cwd, "run", "a.report.json"), JSON.stringify({ schemaVersion: "backtest.report.v1", x: 999 }, null, 2));
      const r = paperBacktestResearchStatusReport({ cwd, env: {} }, { dir, json: true });
      const status = JSON.parse(r.text) as { manifest: { present: boolean; inSync: boolean; digestChangedCount: number } };
      expect(status.manifest.present).toBe(true); // discovered
      expect(status.manifest.inSync).toBe(false);
      expect(status.manifest.digestChangedCount).toBe(1);
      const strict = paperBacktestResearchStatusReport({ cwd, env: {} }, { dir, strict: true });
      expect(strict.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("--strict exits 1 when a malformed file is present", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeArtifactDir(cwd, "run");
      writeFileSync(join(cwd, "run", "broken.json"), "{ not json");
      const lenient = paperBacktestResearchStatusReport({ cwd, env: {} }, { dir });
      expect(lenient.exitCode).toBe(0);
      const strict = paperBacktestResearchStatusReport({ cwd, env: {} }, { dir, strict: true });
      expect(strict.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses a malformed explicit --manifest", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeArtifactDir(cwd, "run");
      writeFileSync(join(cwd, "bad.json"), JSON.stringify({ not: "a manifest" }));
      const r = paperBacktestResearchStatusReport({ cwd, env: {} }, { dir, manifestPath: "bad.json" });
      expect(r.text).toMatch(/^Refusing:/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });
});

describe("paperBacktestResearchIndexReport (Sprint 18)", () => {
  interface CampaignIndexJson {
    schemaVersion: string;
    campaignName: string | null;
    campaignDigest: string;
    runCount: number;
    validRunCount: number;
    invalidRunCount: number;
    totalArtifactCount: number;
    totalKnownArtifactCount: number;
    totalUnknownArtifactCount: number;
    totalMalformedArtifactCount: number;
    runsNeedingAttention: string[];
    aggregateKindCounts: { kind: string; count: number }[];
    aggregateSchemaVersions: string[];
    runs: {
      runId: string;
      runDigest: string | null;
      valid: boolean;
      artifactCount: number;
      unknownArtifactCount: number;
      malformedArtifactCount: number;
      manifestPresent: boolean;
      inSync: boolean;
      driftDetected: boolean;
      buildError: string | null;
    }[];
  }

  /**
   * Build a campaign tree with three runs: run-1 (two recognized artifacts), run-2 (an unknown
   * parseable file), run-3 (a malformed file). Returns the relative campaign dir.
   */
  function writeCampaign(cwd: string, sub = "campaign"): string {
    const root = join(cwd, sub);
    mkdirSync(join(root, "run-1", "reports"), { recursive: true });
    writeFileSync(
      join(root, "run-1", "reports", "a.report.json"),
      JSON.stringify({ schemaVersion: "backtest.report.v1", x: 1 }, null, 2),
    );
    writeFileSync(join(root, "run-1", "my.scenario.json"), JSON.stringify({ name: "s", steps: [] }, null, 2));
    mkdirSync(join(root, "run-2"), { recursive: true });
    writeFileSync(join(root, "run-2", "weird.json"), JSON.stringify({ hello: "world" }, null, 2));
    mkdirSync(join(root, "run-3"), { recursive: true });
    writeFileSync(join(root, "run-3", "broken.json"), "{ not json");
    return sub;
  }

  /** Recursively list every file under `dir`, sorted (for "writes nothing" assertions). */
  function listFilesRec(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) out.push(...listFilesRec(full));
      else out.push(full);
    }
    return out.sort();
  }

  it("refuses when --dir is missing or not a directory", () => {
    expect(paperBacktestResearchIndexReport({}, {}).text).toMatch(/^Refusing: --dir/);
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const r = paperBacktestResearchIndexReport({ cwd, env: {} }, { dir: "nope" });
      expect(r.text).toMatch(/^Refusing: campaign directory not found/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("scans immediate child directories as runs and counts valid/invalid", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeCampaign(cwd);
      const r = paperBacktestResearchIndexReport({ cwd, env: {} }, { dir, json: true });
      expect(r.exitCode).toBe(0);
      const index = JSON.parse(r.text) as CampaignIndexJson;
      expect(index.schemaVersion).toBe("backtest.research.campaign.index.v1");
      expect(index.campaignName).toBe("campaign");
      expect(index.campaignDigest).toMatch(/^[0-9a-f]+$/);
      expect(index.runs.map((x) => x.runId)).toEqual(["run-1", "run-2", "run-3"]);
      expect(index.runCount).toBe(3);
      expect(index.validRunCount).toBe(1);
      expect(index.invalidRunCount).toBe(2);
      expect(index.runsNeedingAttention).toEqual(["run-2", "run-3"]);
      const run1 = index.runs.find((x) => x.runId === "run-1")!;
      expect(run1.valid).toBe(true);
      expect(run1.artifactCount).toBe(2);
    } finally {
      cleanup();
    }
  });

  it("aggregates kind counts, schema set, and unknown/malformed totals across runs", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeCampaign(cwd);
      const index = JSON.parse(
        paperBacktestResearchIndexReport({ cwd, env: {} }, { dir, json: true }).text,
      ) as CampaignIndexJson;
      expect(index.aggregateKindCounts).toEqual([
        { kind: "backtest-report", count: 1 },
        { kind: "scenario", count: 1 },
        { kind: "unknown-json", count: 2 },
      ]);
      expect(index.aggregateSchemaVersions).toEqual(["backtest.report.v1"]);
      expect(index.totalArtifactCount).toBe(4);
      expect(index.totalKnownArtifactCount).toBe(2);
      expect(index.totalUnknownArtifactCount).toBe(2);
      expect(index.totalMalformedArtifactCount).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("handles a malformed JSON file safely (no crash) and counts it", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeCampaign(cwd);
      const index = JSON.parse(
        paperBacktestResearchIndexReport({ cwd, env: {} }, { dir, json: true }).text,
      ) as CampaignIndexJson;
      const run3 = index.runs.find((x) => x.runId === "run-3")!;
      expect(run3.malformedArtifactCount).toBe(1);
      expect(run3.valid).toBe(false);
      expect(run3.buildError).toBeNull(); // malformed is summarized, not an error
    } finally {
      cleanup();
    }
  });

  it("ignores *.jsonl files entirely (never read or indexed)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeCampaign(cwd);
      writeFileSync(join(cwd, "campaign", "run-1", "journal.jsonl"), '{"event":"x"}\n{"event":"y"}\n');
      const index = JSON.parse(
        paperBacktestResearchIndexReport({ cwd, env: {} }, { dir, json: true }).text,
      ) as CampaignIndexJson;
      expect(index.runs.find((x) => x.runId === "run-1")!.artifactCount).toBe(2); // .jsonl excluded
    } finally {
      cleanup();
    }
  });

  it("excludes research meta files (manifest/bundle/status/campaign-index) from a run's artifacts", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeCampaign(cwd);
      // Drop meta files INTO run-1, then re-index: they must not be counted as artifacts.
      paperBacktestResearchManifestReport({ cwd, env: {} }, { dir: "campaign/run-1", outPath: "campaign/run-1/research-manifest.json" });
      paperBacktestResearchBundleReport({ cwd, env: {} }, { dir: "campaign/run-1", outPath: "campaign/run-1/research-bundle.json" });
      writeFileSync(join(cwd, "campaign", "run-1", "research-status.json"), JSON.stringify({ schemaVersion: "backtest.research.status.v1" }));
      writeFileSync(join(cwd, "campaign", "run-1", "campaign-index.json"), JSON.stringify({ schemaVersion: "backtest.research.campaign.index.v1" }));
      const index = JSON.parse(
        paperBacktestResearchIndexReport({ cwd, env: {} }, { dir, json: true }).text,
      ) as CampaignIndexJson;
      const run1 = index.runs.find((x) => x.runId === "run-1")!;
      expect(run1.artifactCount).toBe(2); // still 2 — every meta file is excluded
      // run-1 now has a recorded manifest matching its (unchanged) artifacts → in sync.
      expect(run1.manifestPresent).toBe(true);
      expect(run1.inSync).toBe(true);
      expect(run1.valid).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("detects manifest drift in a run after an artifact changes", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeCampaign(cwd);
      // Record a manifest for run-1, then mutate an artifact so the directory drifts from it.
      paperBacktestResearchManifestReport({ cwd, env: {} }, { dir: "campaign/run-1", outPath: "campaign/run-1/research-manifest.json" });
      writeFileSync(
        join(cwd, "campaign", "run-1", "reports", "a.report.json"),
        JSON.stringify({ schemaVersion: "backtest.report.v1", x: 999 }, null, 2),
      );
      const index = JSON.parse(
        paperBacktestResearchIndexReport({ cwd, env: {} }, { dir, json: true }).text,
      ) as CampaignIndexJson;
      const run1 = index.runs.find((x) => x.runId === "run-1")!;
      expect(run1.driftDetected).toBe(true);
      expect(run1.inSync).toBe(false);
      expect(run1.valid).toBe(false);
      expect(index.runsNeedingAttention).toContain("run-1");
    } finally {
      cleanup();
    }
  });

  it("skips a symlinked child directory (when the platform allows creating one)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeCampaign(cwd);
      let symlinkCreated = false;
      try {
        symlinkSync(join(cwd, "campaign", "run-1"), join(cwd, "campaign", "linked-run"), "dir");
        symlinkCreated = true;
      } catch {
        symlinkCreated = false; // Windows without privileges — the walk-skip is still exercised elsewhere
      }
      const index = JSON.parse(
        paperBacktestResearchIndexReport({ cwd, env: {} }, { dir, json: true }).text,
      ) as CampaignIndexJson;
      expect(index.runCount).toBe(3); // a symlinked run dir is skipped, never followed
      expect(index.runs.some((x) => x.runId === "linked-run")).toBe(false);
      void symlinkCreated;
    } finally {
      cleanup();
    }
  });

  it("--out writes the campaign index and refuses to overwrite without --force", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeCampaign(cwd);
      const first = paperBacktestResearchIndexReport({ cwd, env: {} }, { dir, outPath: "campaign-index.json" });
      expect(first.text).toContain("Wrote campaign index");
      const written = JSON.parse(readFileSync(join(cwd, "campaign-index.json"), "utf8")) as { schemaVersion: string };
      expect(written.schemaVersion).toBe("backtest.research.campaign.index.v1");
      const blocked = paperBacktestResearchIndexReport({ cwd, env: {} }, { dir, outPath: "campaign-index.json" });
      expect(blocked.text).toMatch(/already exists \(pass --force/);
      expect(blocked.exitCode).toBe(1);
      expect(
        paperBacktestResearchIndexReport({ cwd, env: {} }, { dir, outPath: "campaign-index.json", force: true }).text,
      ).toContain("Wrote campaign index");
    } finally {
      cleanup();
    }
  });

  it("writes nothing when no --out is given", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeCampaign(cwd);
      const root = join(cwd, "campaign");
      const before = listFilesRec(root);
      const r = paperBacktestResearchIndexReport({ cwd, env: {} }, { dir, json: true });
      expect(r.exitCode).toBe(0);
      expect(listFilesRec(root)).toEqual(before); // no file created or modified
    } finally {
      cleanup();
    }
  });

  it("--strict exits non-zero when any run needs attention, 0 otherwise", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeCampaign(cwd);
      expect(paperBacktestResearchIndexReport({ cwd, env: {} }, { dir }).exitCode).toBe(0); // non-strict
      expect(paperBacktestResearchIndexReport({ cwd, env: {} }, { dir, strict: true }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("is deterministic — byte-identical JSON across two indexings", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dir = writeCampaign(cwd);
      const a = paperBacktestResearchIndexReport({ cwd, env: {} }, { dir, json: true }).text;
      const b = paperBacktestResearchIndexReport({ cwd, env: {} }, { dir, json: true }).text;
      expect(a).toBe(b);
    } finally {
      cleanup();
    }
  });

  it("reports an empty campaign (no run subdirectories) without crashing", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      mkdirSync(join(cwd, "empty-campaign"), { recursive: true });
      const r = paperBacktestResearchIndexReport({ cwd, env: {} }, { dir: "empty-campaign", json: true });
      const index = JSON.parse(r.text) as CampaignIndexJson;
      expect(index.runCount).toBe(0);
      expect(index.validRunCount).toBe(0);
      expect(index.invalidRunCount).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("redacts a secret-looking run directory name (backstop)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const secret = "S".repeat(90);
      mkdirSync(join(cwd, "campaign", secret), { recursive: true });
      writeFileSync(join(cwd, "campaign", secret, "a.report.json"), JSON.stringify({ schemaVersion: "backtest.report.v1" }));
      const r = paperBacktestResearchIndexReport({ cwd, env: {} }, { dir: "campaign", json: true });
      expect(r.text).not.toContain(secret);
      expect(r.text).toContain("[REDACTED]");
    } finally {
      cleanup();
    }
  });
});

describe("paperBacktestDiffResearchBundleReport / paperBacktestDiffResearchIndexReport (Sprint 19)", () => {
  function desc(over: Partial<BacktestArtifactDescriptor> = {}): BacktestArtifactDescriptor {
    return { path: "a.report.json", kind: "backtest-report", schemaVersion: "backtest.report.v1", digest: "d1", sizeBytes: 100, ...over };
  }
  /** Write `value` as JSON under <cwd>/<name> and return the relative name. */
  function writeJson(cwd: string, name: string, value: unknown): string {
    writeFileSync(join(cwd, name), JSON.stringify(value, null, 2));
    return name;
  }
  function bundleJson(artifacts: BacktestArtifactDescriptor[], malformedPaths?: string[]) {
    return buildBacktestResearchBundle({ runName: "r", artifacts, malformedPaths });
  }
  function indexJson(runs: { runId: string; artifacts: BacktestArtifactDescriptor[] }[]) {
    return buildBacktestResearchCampaignIndex({ campaignName: "c", runs });
  }
  function listFilesRec(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) out.push(...listFilesRec(full));
      else out.push(full);
    }
    return out.sort();
  }

  describe("bundle diff", () => {
    it("refuses when --base or --next is missing", () => {
      expect(paperBacktestDiffResearchBundleReport({}, {}).text).toMatch(/^Refusing: --base/);
      expect(paperBacktestDiffResearchBundleReport({}, { basePath: "b.json" }).text).toMatch(/^Refusing: --next/);
    });

    it("reads two files and renders a PAPER-ONLY human-readable diff", () => {
      const { cwd, cleanup } = withConfig({ mode: "PAPER" });
      try {
        const base = writeJson(cwd, "base.json", bundleJson([desc({ digest: "d1" })]));
        const next = writeJson(cwd, "next.json", bundleJson([desc({ digest: "d2" })]));
        const r = paperBacktestDiffResearchBundleReport({ cwd, env: {} }, { basePath: base, nextPath: next });
        expect(r.text).toContain("Research bundle diff (SIMULATED PAPER-ONLY)");
        expect(r.text).toContain("Changed: YES");
        expect(r.text).toContain("Regression: YES");
        expect(r.exitCode).toBe(0); // no fail flag
      } finally {
        cleanup();
      }
    });

    it("--json emits a valid, stable diff object", () => {
      const { cwd, cleanup } = withConfig({ mode: "PAPER" });
      try {
        const base = writeJson(cwd, "base.json", bundleJson([desc({ digest: "d1" })]));
        const next = writeJson(cwd, "next.json", bundleJson([desc({ digest: "d2" })]));
        const r = paperBacktestDiffResearchBundleReport({ cwd, env: {} }, { basePath: base, nextPath: next, json: true });
        const diff = JSON.parse(r.text) as { schemaVersion: string; hasChange: boolean; hasRegression: boolean; changed: { path: string }[] };
        expect(diff.schemaVersion).toBe("backtest.research.bundle.diff.v1");
        expect(diff.hasChange).toBe(true);
        expect(diff.hasRegression).toBe(true);
        expect(diff.changed.map((c) => c.path)).toEqual(["a.report.json"]);
      } finally {
        cleanup();
      }
    });

    it("--fail-on-change exits 1 on change, 0 when identical", () => {
      const { cwd, cleanup } = withConfig({ mode: "PAPER" });
      try {
        const base = writeJson(cwd, "base.json", bundleJson([desc({ digest: "d1" })]));
        const next = writeJson(cwd, "next.json", bundleJson([desc({ digest: "d2" })]));
        expect(paperBacktestDiffResearchBundleReport({ cwd, env: {} }, { basePath: base, nextPath: base, failOnChange: true }).exitCode).toBe(0);
        expect(paperBacktestDiffResearchBundleReport({ cwd, env: {} }, { basePath: base, nextPath: next, failOnChange: true }).exitCode).toBe(1);
      } finally {
        cleanup();
      }
    });

    it("--fail-on-regression exits 1 on a removed artifact but 0 on a purely additive change", () => {
      const { cwd, cleanup } = withConfig({ mode: "PAPER" });
      try {
        const base = writeJson(cwd, "base.json", bundleJson([desc({ path: "a.json", digest: "1" })]));
        const added = writeJson(cwd, "added.json", bundleJson([desc({ path: "a.json", digest: "1" }), desc({ path: "b.suite.json", kind: "suite-index", schemaVersion: "backtest.suite.v1", digest: "2" })]));
        const removed = writeJson(cwd, "removed.json", bundleJson([]));
        // additive: change but not a regression
        const addR = paperBacktestDiffResearchBundleReport({ cwd, env: {} }, { basePath: base, nextPath: added, failOnRegression: true });
        expect(addR.exitCode).toBe(0);
        // removed artifact: a regression
        expect(paperBacktestDiffResearchBundleReport({ cwd, env: {} }, { basePath: base, nextPath: removed, failOnRegression: true }).exitCode).toBe(1);
      } finally {
        cleanup();
      }
    });

    it("refuses malformed JSON and a non-bundle file safely", () => {
      const { cwd, cleanup } = withConfig({ mode: "PAPER" });
      try {
        writeFileSync(join(cwd, "bad.json"), "{ not json");
        const base = writeJson(cwd, "base.json", bundleJson([desc()]));
        expect(paperBacktestDiffResearchBundleReport({ cwd, env: {} }, { basePath: "bad.json", nextPath: base }).exitCode).toBe(1);
        const notBundle = writeJson(cwd, "notbundle.json", { schemaVersion: "x" });
        const r = paperBacktestDiffResearchBundleReport({ cwd, env: {} }, { basePath: base, nextPath: notBundle });
        expect(r.text).toMatch(/^Refusing:/);
        expect(r.exitCode).toBe(1);
      } finally {
        cleanup();
      }
    });

    it("writes nothing", () => {
      const { cwd, cleanup } = withConfig({ mode: "PAPER" });
      try {
        const base = writeJson(cwd, "base.json", bundleJson([desc({ digest: "d1" })]));
        const next = writeJson(cwd, "next.json", bundleJson([desc({ digest: "d2" })]));
        const before = listFilesRec(cwd);
        paperBacktestDiffResearchBundleReport({ cwd, env: {} }, { basePath: base, nextPath: next, json: true });
        expect(listFilesRec(cwd)).toEqual(before);
      } finally {
        cleanup();
      }
    });
  });

  describe("campaign index diff", () => {
    it("refuses when --base or --next is missing", () => {
      expect(paperBacktestDiffResearchIndexReport({}, {}).text).toMatch(/^Refusing: --base/);
      expect(paperBacktestDiffResearchIndexReport({}, { basePath: "b.json" }).text).toMatch(/^Refusing: --next/);
    });

    it("reads two files and renders a PAPER-ONLY human-readable diff", () => {
      const { cwd, cleanup } = withConfig({ mode: "PAPER" });
      try {
        const base = writeJson(cwd, "base.json", indexJson([{ runId: "a", artifacts: [desc({ digest: "1" })] }]));
        const next = writeJson(cwd, "next.json", indexJson([{ runId: "a", artifacts: [desc({ digest: "2" })] }, { runId: "b", artifacts: [desc()] }]));
        const r = paperBacktestDiffResearchIndexReport({ cwd, env: {} }, { basePath: base, nextPath: next });
        expect(r.text).toContain("Research campaign diff (SIMULATED PAPER-ONLY)");
        expect(r.text).toContain("Changed: YES");
        expect(r.text).toContain("Regression: YES");
      } finally {
        cleanup();
      }
    });

    it("--json emits a valid, stable diff object", () => {
      const { cwd, cleanup } = withConfig({ mode: "PAPER" });
      try {
        const base = writeJson(cwd, "base.json", indexJson([{ runId: "a", artifacts: [desc({ digest: "1" })] }]));
        const next = writeJson(cwd, "next.json", indexJson([{ runId: "a", artifacts: [desc({ digest: "2" })] }, { runId: "b", artifacts: [desc()] }]));
        const r = paperBacktestDiffResearchIndexReport({ cwd, env: {} }, { basePath: base, nextPath: next, json: true });
        const diff = JSON.parse(r.text) as { schemaVersion: string; hasChange: boolean; hasRegression: boolean; addedRuns: { runId: string }[]; changedRuns: { runId: string }[] };
        expect(diff.schemaVersion).toBe("backtest.research.campaign.diff.v1");
        expect(diff.hasChange).toBe(true);
        expect(diff.addedRuns.map((r2) => r2.runId)).toEqual(["b"]);
        expect(diff.changedRuns.map((r2) => r2.runId)).toEqual(["a"]);
      } finally {
        cleanup();
      }
    });

    it("--fail-on-change exits 1 on change, 0 when identical", () => {
      const { cwd, cleanup } = withConfig({ mode: "PAPER" });
      try {
        const base = writeJson(cwd, "base.json", indexJson([{ runId: "a", artifacts: [desc({ digest: "1" })] }]));
        const next = writeJson(cwd, "next.json", indexJson([{ runId: "a", artifacts: [desc({ digest: "2" })] }]));
        expect(paperBacktestDiffResearchIndexReport({ cwd, env: {} }, { basePath: base, nextPath: base, failOnChange: true }).exitCode).toBe(0);
        expect(paperBacktestDiffResearchIndexReport({ cwd, env: {} }, { basePath: base, nextPath: next, failOnChange: true }).exitCode).toBe(1);
      } finally {
        cleanup();
      }
    });

    it("--fail-on-regression exits 1 on a run going valid→invalid but 0 on a new valid run", () => {
      const { cwd, cleanup } = withConfig({ mode: "PAPER" });
      try {
        const base = writeJson(cwd, "base.json", indexJson([{ runId: "a", artifacts: [desc()] }]));
        const addedValid = writeJson(cwd, "added.json", indexJson([{ runId: "a", artifacts: [desc()] }, { runId: "b", artifacts: [desc()] }]));
        const wentInvalid = writeJson(cwd, "invalid.json", indexJson([{ runId: "a", artifacts: [desc({ path: "u.json", kind: "unknown-json", schemaVersion: null, digest: "u" })] }]));
        expect(paperBacktestDiffResearchIndexReport({ cwd, env: {} }, { basePath: base, nextPath: addedValid, failOnRegression: true }).exitCode).toBe(0);
        expect(paperBacktestDiffResearchIndexReport({ cwd, env: {} }, { basePath: base, nextPath: wentInvalid, failOnRegression: true }).exitCode).toBe(1);
      } finally {
        cleanup();
      }
    });

    it("refuses malformed JSON and a non-index file safely", () => {
      const { cwd, cleanup } = withConfig({ mode: "PAPER" });
      try {
        writeFileSync(join(cwd, "bad.json"), "{ not json");
        const base = writeJson(cwd, "base.json", indexJson([{ runId: "a", artifacts: [desc()] }]));
        expect(paperBacktestDiffResearchIndexReport({ cwd, env: {} }, { basePath: base, nextPath: "bad.json" }).exitCode).toBe(1);
      } finally {
        cleanup();
      }
    });

    it("writes nothing", () => {
      const { cwd, cleanup } = withConfig({ mode: "PAPER" });
      try {
        const base = writeJson(cwd, "base.json", indexJson([{ runId: "a", artifacts: [desc({ digest: "1" })] }]));
        const next = writeJson(cwd, "next.json", indexJson([{ runId: "a", artifacts: [desc({ digest: "2" })] }]));
        const before = listFilesRec(cwd);
        paperBacktestDiffResearchIndexReport({ cwd, env: {} }, { basePath: base, nextPath: next, json: true });
        expect(listFilesRec(cwd)).toEqual(before);
      } finally {
        cleanup();
      }
    });
  });
});

describe("paperBacktestResearchHistoryReport (Sprint 20)", () => {
  function desc(over: Partial<BacktestArtifactDescriptor> = {}): BacktestArtifactDescriptor {
    return { path: "a.report.json", kind: "backtest-report", schemaVersion: "backtest.report.v1", digest: "d1", sizeBytes: 100, ...over };
  }
  function writeJson(cwd: string, name: string, value: unknown): string {
    writeFileSync(join(cwd, name), JSON.stringify(value, null, 2));
    return name;
  }
  function idx(runs: { runId: string; artifacts: BacktestArtifactDescriptor[] }[]) {
    return buildBacktestResearchCampaignIndex({ campaignName: "c", runs });
  }
  const okRun = (runId: string, digest = "d1") => ({ runId, artifacts: [desc({ digest })] });
  const badRun = (runId: string) => ({ runId, artifacts: [desc({ path: "u.json", kind: "unknown-json" as const, schemaVersion: null, digest: "u" })] });
  function listFilesRec(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) out.push(...listFilesRec(full));
      else out.push(full);
    }
    return out.sort();
  }

  it("refuses when no --index is supplied", () => {
    expect(paperBacktestResearchHistoryReport({}, {}).text).toMatch(/^Refusing: at least one --index/);
    expect(paperBacktestResearchHistoryReport({}, { indexPaths: [] }).exitCode).toBe(1);
  });

  it("reads ordered snapshots and renders a PAPER-ONLY human report", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const s0 = writeJson(cwd, "s0.json", idx([okRun("a", "1")]));
      const s1 = writeJson(cwd, "s1.json", idx([okRun("a", "2"), okRun("b")]));
      const r = paperBacktestResearchHistoryReport({ cwd, env: {} }, { indexPaths: [s0, s1] });
      expect(r.text).toContain("SIMULATED PAPER-ONLY RESEARCH CAMPAIGN HISTORY REPORT");
      expect(r.text).toContain("Changed since baseline: YES");
      expect(r.text.toLowerCase()).toContain("not a live result");
      expect(r.exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("--json emits a valid, stable history report object", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const s0 = writeJson(cwd, "s0.json", idx([okRun("a", "1")]));
      const s1 = writeJson(cwd, "s1.json", idx([okRun("a", "2"), okRun("b")]));
      const r = paperBacktestResearchHistoryReport({ cwd, env: {} }, { indexPaths: [s0, s1], json: true });
      const report = JSON.parse(r.text) as { schemaVersion: string; snapshotCount: number; snapshotIds: string[]; runsAddedSinceBaseline: number; hasRegression: boolean };
      expect(report.schemaVersion).toBe("backtest.research.campaign.history.report.v1");
      expect(report.snapshotCount).toBe(2);
      expect(report.snapshotIds).toEqual(["s0.json", "s1.json"]);
      expect(report.runsAddedSinceBaseline).toBe(1);
      expect(report.hasRegression).toBe(true); // run "a" digest changed
      // the emitted (redacted) JSON must still round-trip through the strict backstop validator
      expect(() => validateBacktestResearchCampaignHistoryReport(JSON.parse(r.text))).not.toThrow();
      // byte-stable across repeated calls
      expect(paperBacktestResearchHistoryReport({ cwd, env: {} }, { indexPaths: [s0, s1], json: true }).text).toBe(r.text);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-change exits 1 on change, 0 for an unchanged pair", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const s0 = writeJson(cwd, "s0.json", idx([okRun("a", "1")]));
      const same = writeJson(cwd, "same.json", idx([okRun("a", "1")]));
      const changed = writeJson(cwd, "changed.json", idx([okRun("a", "2")]));
      expect(paperBacktestResearchHistoryReport({ cwd, env: {} }, { indexPaths: [s0, same], failOnChange: true }).exitCode).toBe(0);
      expect(paperBacktestResearchHistoryReport({ cwd, env: {} }, { indexPaths: [s0, changed], failOnChange: true }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-regression exits 1 on a digest change but 0 on a new valid run", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const s0 = writeJson(cwd, "s0.json", idx([okRun("a", "1")]));
      const added = writeJson(cwd, "added.json", idx([okRun("a", "1"), okRun("b")]));
      const regressed = writeJson(cwd, "regressed.json", idx([okRun("a", "2")]));
      expect(paperBacktestResearchHistoryReport({ cwd, env: {} }, { indexPaths: [s0, added], failOnRegression: true }).exitCode).toBe(0);
      expect(paperBacktestResearchHistoryReport({ cwd, env: {} }, { indexPaths: [s0, regressed], failOnRegression: true }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-attention exits 1 when a run needs attention now, 0 otherwise", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      // Two DISTINCT clean snapshots (snapshot ids are the paths, which must be unique).
      const clean0 = writeJson(cwd, "clean0.json", idx([okRun("a")]));
      const clean1 = writeJson(cwd, "clean1.json", idx([okRun("a")]));
      const dirty = writeJson(cwd, "dirty.json", idx([okRun("a"), badRun("b")]));
      expect(paperBacktestResearchHistoryReport({ cwd, env: {} }, { indexPaths: [clean0, clean1], failOnAttention: true }).exitCode).toBe(0);
      expect(paperBacktestResearchHistoryReport({ cwd, env: {} }, { indexPaths: [clean0, dirty], failOnAttention: true }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-new-attention exits 1 when a run newly needs attention since baseline", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const s0 = writeJson(cwd, "s0.json", idx([okRun("a")]));
      const s0copy = writeJson(cwd, "s0copy.json", idx([okRun("a")]));
      const wentBad = writeJson(cwd, "bad.json", idx([badRun("a")]));
      expect(paperBacktestResearchHistoryReport({ cwd, env: {} }, { indexPaths: [s0, s0copy], failOnNewAttention: true }).exitCode).toBe(0);
      expect(paperBacktestResearchHistoryReport({ cwd, env: {} }, { indexPaths: [s0, wentBad], failOnNewAttention: true }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("supports --baseline previous", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const s0 = writeJson(cwd, "s0.json", idx([okRun("a")]));
      const s1 = writeJson(cwd, "s1.json", idx([okRun("a"), okRun("b")]));
      const s2 = writeJson(cwd, "s2.json", idx([okRun("a", "2"), okRun("b")]));
      const r = paperBacktestResearchHistoryReport({ cwd, env: {} }, { indexPaths: [s0, s1, s2], baseline: "previous", json: true });
      const report = JSON.parse(r.text) as { baselineSnapshotId: string; baselineSelector: string; runsAddedSinceBaseline: number };
      expect(report.baselineSnapshotId).toBe("s1.json");
      expect(report.baselineSelector).toBe("previous");
      expect(report.runsAddedSinceBaseline).toBe(0); // b already present at s1
    } finally {
      cleanup();
    }
  });

  it("supports an explicit --baseline <path> (matched against the supplied --index paths)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const s0 = writeJson(cwd, "s0.json", idx([okRun("a")]));
      const s1 = writeJson(cwd, "s1.json", idx([okRun("a"), okRun("b")]));
      const s2 = writeJson(cwd, "s2.json", idx([okRun("a", "2"), okRun("b")]));
      const r = paperBacktestResearchHistoryReport({ cwd, env: {} }, { indexPaths: [s0, s1, s2], baseline: s1, json: true });
      const report = JSON.parse(r.text) as { baselineSnapshotId: string; baselineSelector: string; runsAddedSinceBaseline: number };
      expect(report.baselineSnapshotId).toBe(s1);
      expect(report.baselineSelector).toBe("explicit");
      expect(report.runsAddedSinceBaseline).toBe(0); // b already present at the explicit baseline s1
    } finally {
      cleanup();
    }
  });

  it("refuses an explicit --baseline that is not among the supplied --index paths", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const s0 = writeJson(cwd, "s0.json", idx([okRun("a")]));
      const s1 = writeJson(cwd, "s1.json", idx([okRun("a", "2")]));
      const r = paperBacktestResearchHistoryReport({ cwd, env: {} }, { indexPaths: [s0, s1], baseline: "nope.json" });
      expect(r.text).toMatch(/^Refusing:/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses malformed JSON and a non-index (wrong artifact type) file safely", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "bad.json"), "{ not json");
      const s0 = writeJson(cwd, "s0.json", idx([okRun("a")]));
      expect(paperBacktestResearchHistoryReport({ cwd, env: {} }, { indexPaths: [s0, "bad.json"] }).exitCode).toBe(1);
      // a research bundle is the wrong artifact type for a history snapshot
      const bundle = writeJson(cwd, "bundle.json", buildBacktestResearchBundle({ runName: "r", artifacts: [desc()] }));
      const r = paperBacktestResearchHistoryReport({ cwd, env: {} }, { indexPaths: [s0, bundle] });
      expect(r.text).toMatch(/^Refusing:/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("writes nothing", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const s0 = writeJson(cwd, "s0.json", idx([okRun("a", "1")]));
      const s1 = writeJson(cwd, "s1.json", idx([okRun("a", "2")]));
      const before = listFilesRec(cwd);
      paperBacktestResearchHistoryReport({ cwd, env: {} }, { indexPaths: [s0, s1], json: true });
      expect(listFilesRec(cwd)).toEqual(before);
    } finally {
      cleanup();
    }
  });
});

describe("paperBacktestResearchPortfolioReport (Sprint 21)", () => {
  function desc(over: Partial<BacktestArtifactDescriptor> = {}): BacktestArtifactDescriptor {
    return { path: "a.report.json", kind: "backtest-report", schemaVersion: "backtest.report.v1", digest: "d1", sizeBytes: 100, ...over };
  }
  const okRun = (runId: string, digest = "d1") => ({ runId, artifacts: [desc({ digest })] });
  const badRun = (runId: string) => ({ runId, artifacts: [desc({ path: "u.json", kind: "unknown-json" as const, schemaVersion: null, digest: "u" })] });
  function idx(runs: { runId: string; artifacts: BacktestArtifactDescriptor[] }[]) {
    return buildBacktestResearchCampaignIndex({ campaignName: "c", runs });
  }
  /** Build a real Sprint 20 history report from ordered run-lists. */
  function hist(snapshots: { runId: string; artifacts: BacktestArtifactDescriptor[] }[][]) {
    return buildBacktestResearchCampaignHistoryReport({
      snapshots: snapshots.map((runs, i) => ({ snapshotId: `s${i}`, index: idx(runs) })),
    });
  }
  function writeJson(cwd: string, name: string, value: unknown): string {
    writeFileSync(join(cwd, name), JSON.stringify(value, null, 2));
    return name;
  }
  function listFilesRec(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) out.push(...listFilesRec(full));
      else out.push(full);
    }
    return out.sort();
  }
  // Reusable history-report archetypes.
  const cleanHist = () => hist([[okRun("a")], [okRun("a")]]); // no change
  const changedHist = () => hist([[okRun("a")], [okRun("a"), okRun("b")]]); // additive valid
  const regressedHist = () => hist([[okRun("a", "1")], [okRun("a", "2")]]); // digest change
  const attentionHist = () => hist([[okRun("a"), badRun("bad")], [okRun("a"), badRun("bad")]]); // persistent invalid
  const newAttentionHist = () => hist([[okRun("a")], [okRun("a"), badRun("b")]]); // new invalid run

  it("refuses when no --history is supplied", () => {
    expect(paperBacktestResearchPortfolioReport({}, {}).text).toMatch(/^Refusing: at least one --history/);
    expect(paperBacktestResearchPortfolioReport({}, { histories: [] }).exitCode).toBe(1);
  });

  it("reads campaign history reports and renders a PAPER-ONLY human report", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeJson(cwd, "alpha.json", cleanHist());
      writeJson(cwd, "charlie.json", regressedHist());
      const r = paperBacktestResearchPortfolioReport(
        { cwd, env: {} },
        { histories: ["alpha=alpha.json", "charlie=charlie.json"] },
      );
      expect(r.text).toContain("SIMULATED PAPER-ONLY RESEARCH PORTFOLIO REPORT");
      expect(r.text).toContain("Campaigns (integrity triage");
      expect(r.text.toLowerCase()).toContain("not a live result");
      expect(r.exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("--json emits a valid, stable portfolio report object", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeJson(cwd, "alpha.json", cleanHist());
      writeJson(cwd, "echo.json", newAttentionHist());
      const r = paperBacktestResearchPortfolioReport(
        { cwd, env: {} },
        { histories: ["alpha=alpha.json", "echo=echo.json"], json: true },
      );
      const report = JSON.parse(r.text) as { schemaVersion: string; campaignCount: number; campaignIds: string[]; hasRegression: boolean };
      expect(report.schemaVersion).toBe("backtest.research.portfolio.report.v1");
      expect(report.campaignCount).toBe(2);
      expect(report.campaignIds).toEqual(["alpha", "echo"]);
      expect(report.hasRegression).toBe(true);
      expect(() => validateBacktestResearchPortfolioReport(JSON.parse(r.text))).not.toThrow();
      // byte-stable across repeated calls
      expect(
        paperBacktestResearchPortfolioReport({ cwd, env: {} }, { histories: ["alpha=alpha.json", "echo=echo.json"], json: true }).text,
      ).toBe(r.text);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-change exits 1 on change, 0 when all clean", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeJson(cwd, "clean.json", cleanHist());
      writeJson(cwd, "changed.json", changedHist());
      expect(paperBacktestResearchPortfolioReport({ cwd, env: {} }, { histories: ["a=clean.json"], failOnChange: true }).exitCode).toBe(0);
      expect(paperBacktestResearchPortfolioReport({ cwd, env: {} }, { histories: ["a=clean.json", "b=changed.json"], failOnChange: true }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-regression ignores a benign change but trips on a regression", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeJson(cwd, "changed.json", changedHist());
      writeJson(cwd, "regressed.json", regressedHist());
      expect(paperBacktestResearchPortfolioReport({ cwd, env: {} }, { histories: ["a=changed.json"], failOnRegression: true }).exitCode).toBe(0);
      expect(paperBacktestResearchPortfolioReport({ cwd, env: {} }, { histories: ["a=changed.json", "b=regressed.json"], failOnRegression: true }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-attention trips only when a campaign currently needs attention", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeJson(cwd, "regressed.json", regressedHist()); // changed/regressed but still valid -> no attention
      writeJson(cwd, "attention.json", attentionHist());
      expect(paperBacktestResearchPortfolioReport({ cwd, env: {} }, { histories: ["a=regressed.json"], failOnAttention: true }).exitCode).toBe(0);
      expect(paperBacktestResearchPortfolioReport({ cwd, env: {} }, { histories: ["a=attention.json"], failOnAttention: true }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-new-attention ignores persistent attention but trips on newly-needed attention", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeJson(cwd, "attention.json", attentionHist()); // invalid in both snapshots -> not newly
      writeJson(cwd, "new.json", newAttentionHist());
      expect(paperBacktestResearchPortfolioReport({ cwd, env: {} }, { histories: ["a=attention.json"], failOnNewAttention: true }).exitCode).toBe(0);
      expect(paperBacktestResearchPortfolioReport({ cwd, env: {} }, { histories: ["a=new.json"], failOnNewAttention: true }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses a malformed history file", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "bad.json"), "{ not json");
      const r = paperBacktestResearchPortfolioReport({ cwd, env: {} }, { histories: ["a=bad.json"] });
      expect(r.text).toMatch(/^Refusing:/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses a wrong artifact type (a campaign index, not a history report)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeJson(cwd, "index.json", idx([okRun("a")]));
      const r = paperBacktestResearchPortfolioReport({ cwd, env: {} }, { histories: ["a=index.json"] });
      expect(r.text).toMatch(/is not a valid campaign history report/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses a duplicate campaign id", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeJson(cwd, "a.json", cleanHist());
      writeJson(cwd, "b.json", regressedHist());
      const r = paperBacktestResearchPortfolioReport({ cwd, env: {} }, { histories: ["dup=a.json", "dup=b.json"] });
      expect(r.text).toMatch(/duplicate campaignId "dup"/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses a bad campaignId=path spec", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeJson(cwd, "a.json", cleanHist());
      expect(paperBacktestResearchPortfolioReport({ cwd, env: {} }, { histories: ["noequals"] }).exitCode).toBe(1);
      expect(paperBacktestResearchPortfolioReport({ cwd, env: {} }, { histories: ["noequals"] }).text).toMatch(/must be "campaignId=path"/);
      expect(paperBacktestResearchPortfolioReport({ cwd, env: {} }, { histories: ["=a.json"] }).exitCode).toBe(1);
      expect(paperBacktestResearchPortfolioReport({ cwd, env: {} }, { histories: ["a="] }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("writes nothing", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeJson(cwd, "a.json", cleanHist());
      writeJson(cwd, "b.json", regressedHist());
      const before = listFilesRec(cwd);
      paperBacktestResearchPortfolioReport({ cwd, env: {} }, { histories: ["a=a.json", "b=b.json"], json: true });
      expect(listFilesRec(cwd)).toEqual(before);
    } finally {
      cleanup();
    }
  });
});

describe("paperBacktestDiffResearchPortfolioReport (Sprint 22)", () => {
  function desc(over: Partial<BacktestArtifactDescriptor> = {}): BacktestArtifactDescriptor {
    return { path: "a.report.json", kind: "backtest-report", schemaVersion: "backtest.report.v1", digest: "d1", sizeBytes: 100, ...over };
  }
  const okRun = (runId: string, digest = "d1") => ({ runId, artifacts: [desc({ digest })] });
  const badRun = (runId: string) => ({ runId, artifacts: [desc({ path: "u.json", kind: "unknown-json" as const, schemaVersion: null, digest: "u" })] });
  function idx(runs: { runId: string; artifacts: BacktestArtifactDescriptor[] }[]) {
    return buildBacktestResearchCampaignIndex({ campaignName: "c", runs });
  }
  function hist(snapshots: { runId: string; artifacts: BacktestArtifactDescriptor[] }[][]) {
    return buildBacktestResearchCampaignHistoryReport({
      snapshots: snapshots.map((runs, i) => ({ snapshotId: `s${i}`, index: idx(runs) })),
    });
  }
  const pc = (campaignId: string, report: unknown) => ({ campaignId, report });
  const portfolio = (campaigns: { campaignId: string; report: unknown }[]) =>
    buildBacktestResearchPortfolioReport({ campaigns });
  function writeJson(cwd: string, name: string, value: unknown): string {
    writeFileSync(join(cwd, name), JSON.stringify(value, null, 2));
    return name;
  }
  function listFilesRec(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) out.push(...listFilesRec(full));
      else out.push(full);
    }
    return out.sort();
  }
  // History-report archetypes (real Sprint 20 reports).
  const cleanHist = () => hist([[okRun("a")], [okRun("a")]]); // clean + stable
  const changedHist = () => hist([[okRun("a")], [okRun("a"), okRun("b")]]); // additive valid -> changed, clean
  const regressedHist = () => hist([[okRun("a", "1")], [okRun("a", "2")]]); // digest change -> regression, still valid
  const attentionHist = () => hist([[okRun("a"), badRun("bad")], [okRun("a"), badRun("bad")]]); // persistent invalid
  const newAttentionHist = () => hist([[okRun("a")], [okRun("a"), badRun("b")]]); // new invalid run

  it("refuses when --base or --next is missing", () => {
    expect(paperBacktestDiffResearchPortfolioReport({}, {}).text).toMatch(/^Refusing: --base/);
    expect(paperBacktestDiffResearchPortfolioReport({}, { basePath: "b.json" }).text).toMatch(/^Refusing: --next/);
    expect(paperBacktestDiffResearchPortfolioReport({}, {}).exitCode).toBe(1);
  });

  it("renders a PAPER-ONLY human diff by default", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = writeJson(cwd, "base.json", portfolio([pc("alpha", cleanHist()), pc("bravo", cleanHist())]));
      const next = writeJson(cwd, "next.json", portfolio([pc("alpha", cleanHist()), pc("bravo", regressedHist())]));
      const r = paperBacktestDiffResearchPortfolioReport({ cwd, env: {} }, { basePath: base, nextPath: next });
      expect(r.text).toContain("SIMULATED PAPER-ONLY RESEARCH PORTFOLIO DIFF");
      expect(r.text).toContain("PAPER ONLY");
      expect(r.text.toLowerCase()).toContain("not a live result");
      expect(r.text).toContain("Regression: YES");
      expect(r.exitCode).toBe(0); // no fail flag set
    } finally {
      cleanup();
    }
  });

  it("--json emits a valid, stable portfolio diff object", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = writeJson(cwd, "base.json", portfolio([pc("alpha", cleanHist())]));
      const next = writeJson(cwd, "next.json", portfolio([pc("alpha", cleanHist()), pc("charlie", cleanHist())]));
      const r = paperBacktestDiffResearchPortfolioReport({ cwd, env: {} }, { basePath: base, nextPath: next, json: true });
      const diff = JSON.parse(r.text) as { schemaVersion: string; hasChange: boolean; addedCampaigns: { campaignId: string }[]; commonCampaignIds: string[] };
      expect(diff.schemaVersion).toBe("backtest.research.portfolio.diff.v1");
      expect(diff.hasChange).toBe(true);
      expect(diff.addedCampaigns.map((c) => c.campaignId)).toEqual(["charlie"]);
      expect(diff.commonCampaignIds).toEqual(["alpha"]);
      expect(() => validateBacktestResearchPortfolioDiff(JSON.parse(r.text))).not.toThrow();
      // byte-stable across repeated calls
      expect(paperBacktestDiffResearchPortfolioReport({ cwd, env: {} }, { basePath: base, nextPath: next, json: true }).text).toBe(r.text);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-change exits 1 on change, 0 when identical", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = writeJson(cwd, "base.json", portfolio([pc("alpha", cleanHist())]));
      const same = writeJson(cwd, "same.json", portfolio([pc("alpha", cleanHist())]));
      const changed = writeJson(cwd, "changed.json", portfolio([pc("alpha", cleanHist()), pc("bravo", cleanHist())]));
      expect(paperBacktestDiffResearchPortfolioReport({ cwd, env: {} }, { basePath: base, nextPath: same, failOnChange: true }).exitCode).toBe(0);
      expect(paperBacktestDiffResearchPortfolioReport({ cwd, env: {} }, { basePath: base, nextPath: changed, failOnChange: true }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-regression ignores a benign added campaign but trips on a newly-regressed common campaign", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = writeJson(cwd, "base.json", portfolio([pc("alpha", cleanHist())]));
      const added = writeJson(cwd, "added.json", portfolio([pc("alpha", cleanHist()), pc("bravo", cleanHist())]));
      const regressed = writeJson(cwd, "regressed.json", portfolio([pc("alpha", regressedHist())]));
      expect(paperBacktestDiffResearchPortfolioReport({ cwd, env: {} }, { basePath: base, nextPath: added, failOnRegression: true }).exitCode).toBe(0);
      expect(paperBacktestDiffResearchPortfolioReport({ cwd, env: {} }, { basePath: base, nextPath: regressed, failOnRegression: true }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-attention trips only when current attention newly appears on a common campaign", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = writeJson(cwd, "base.json", portfolio([pc("alpha", cleanHist())]));
      const regressedOnly = writeJson(cwd, "regressed.json", portfolio([pc("alpha", regressedHist())])); // changed/regressed but still valid
      const attention = writeJson(cwd, "attention.json", portfolio([pc("alpha", newAttentionHist())]));
      expect(paperBacktestDiffResearchPortfolioReport({ cwd, env: {} }, { basePath: base, nextPath: regressedOnly, failOnAttention: true }).exitCode).toBe(0);
      expect(paperBacktestDiffResearchPortfolioReport({ cwd, env: {} }, { basePath: base, nextPath: attention, failOnAttention: true }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-new-attention trips when new-since-baseline attention newly appears", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = writeJson(cwd, "base.json", portfolio([pc("alpha", cleanHist())]));
      const changed = writeJson(cwd, "changed.json", portfolio([pc("alpha", changedHist())])); // change, no attention
      const newAttn = writeJson(cwd, "new.json", portfolio([pc("alpha", newAttentionHist())]));
      expect(paperBacktestDiffResearchPortfolioReport({ cwd, env: {} }, { basePath: base, nextPath: changed, failOnNewAttention: true }).exitCode).toBe(0);
      expect(paperBacktestDiffResearchPortfolioReport({ cwd, env: {} }, { basePath: base, nextPath: newAttn, failOnNewAttention: true }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("an identical portfolio pair exits 0 even with every fail flag set", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = writeJson(cwd, "base.json", portfolio([pc("alpha", attentionHist()), pc("bravo", regressedHist())]));
      const same = writeJson(cwd, "same.json", portfolio([pc("alpha", attentionHist()), pc("bravo", regressedHist())]));
      const r = paperBacktestDiffResearchPortfolioReport(
        { cwd, env: {} },
        { basePath: base, nextPath: same, failOnChange: true, failOnRegression: true, failOnAttention: true, failOnNewAttention: true },
      );
      expect(r.exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("refuses a malformed base file", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "bad.json"), "{ not json");
      const next = writeJson(cwd, "next.json", portfolio([pc("alpha", cleanHist())]));
      const r = paperBacktestDiffResearchPortfolioReport({ cwd, env: {} }, { basePath: "bad.json", nextPath: next });
      expect(r.text).toMatch(/^Refusing:/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses a malformed next file", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = writeJson(cwd, "base.json", portfolio([pc("alpha", cleanHist())]));
      writeFileSync(join(cwd, "bad.json"), "{ not json");
      const r = paperBacktestDiffResearchPortfolioReport({ cwd, env: {} }, { basePath: base, nextPath: "bad.json" });
      expect(r.text).toMatch(/^Refusing:/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses a wrong artifact type (a history report, not a portfolio report)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = writeJson(cwd, "base.json", portfolio([pc("alpha", cleanHist())]));
      const wrong = writeJson(cwd, "wrong.json", cleanHist()); // a history report, not a portfolio report
      const r = paperBacktestDiffResearchPortfolioReport({ cwd, env: {} }, { basePath: base, nextPath: wrong });
      expect(r.text).toMatch(/portfolio report is invalid/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("writes nothing", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = writeJson(cwd, "base.json", portfolio([pc("alpha", cleanHist())]));
      const next = writeJson(cwd, "next.json", portfolio([pc("alpha", regressedHist())]));
      const before = listFilesRec(cwd);
      paperBacktestDiffResearchPortfolioReport({ cwd, env: {} }, { basePath: base, nextPath: next, json: true });
      expect(listFilesRec(cwd)).toEqual(before);
    } finally {
      cleanup();
    }
  });
});

describe("paperBacktestResearchPackReport (Sprint 23)", () => {
  function desc(over: Partial<BacktestArtifactDescriptor> = {}): BacktestArtifactDescriptor {
    return { path: "a.report.json", kind: "backtest-report", schemaVersion: "backtest.report.v1", digest: "d1", sizeBytes: 100, ...over };
  }
  const okRun = (runId: string, digest = "d1") => ({ runId, artifacts: [desc({ digest })] });
  const badRun = (runId: string) => ({ runId, artifacts: [desc({ path: "u.json", kind: "unknown-json" as const, schemaVersion: null, digest: "u" })] });
  function idx(runs: { runId: string; artifacts: BacktestArtifactDescriptor[] }[]) {
    return buildBacktestResearchCampaignIndex({ campaignName: "c", runs });
  }
  function hist(snaps: { runId: string; artifacts: BacktestArtifactDescriptor[] }[][]) {
    return buildBacktestResearchCampaignHistoryReport({ snapshots: snaps.map((runs, i) => ({ snapshotId: `s${i}`, index: idx(runs) })) });
  }
  const pc = (campaignId: string, report: unknown) => ({ campaignId, report });
  const portfolio = (campaigns: { campaignId: string; report: unknown }[]) => buildBacktestResearchPortfolioReport({ campaigns });
  function writeJson(cwd: string, name: string, value: unknown): string {
    writeFileSync(join(cwd, name), JSON.stringify(value, null, 2));
    return name;
  }
  function listFilesRec(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) out.push(...listFilesRec(full));
      else out.push(full);
    }
    return out.sort();
  }
  // Real artifact fixtures.
  const cleanPortfolio = () => portfolio([pc("alpha", hist([[okRun("a")], [okRun("a")]]))]);
  const regressedPortfolio = () => portfolio([pc("alpha", hist([[okRun("a", "1")], [okRun("a", "2")]]))]);
  const portfolioDiffRegression = () => diffBacktestResearchPortfolioReports(cleanPortfolio(), regressedPortfolio());
  const historyNewAttention = () => hist([[okRun("a")], [okRun("a"), badRun("b")]]);
  const manifest = () => buildBacktestResearchManifest({ artifacts: [desc()] });

  it("refuses when no --artifact is supplied", () => {
    expect(paperBacktestResearchPackReport({}, {}).text).toMatch(/^Refusing: at least one --artifact/);
    expect(paperBacktestResearchPackReport({}, { artifacts: [] }).exitCode).toBe(1);
  });

  it("reads artifacts and renders a PAPER-ONLY human pack", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeJson(cwd, "pf.json", cleanPortfolio());
      writeJson(cwd, "pd.json", portfolioDiffRegression());
      const r = paperBacktestResearchPackReport({ cwd, env: {} }, { artifacts: ["pf=pf.json", "pd=pd.json"] });
      expect(r.text).toContain("SIMULATED PAPER-ONLY RESEARCH ARTIFACT PACK");
      expect(r.text).toContain("Artifacts:");
      expect(r.text.toLowerCase()).toContain("not a live result");
      expect(r.exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("--json emits a valid, stable pack object", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeJson(cwd, "pf.json", cleanPortfolio());
      writeJson(cwd, "pd.json", portfolioDiffRegression());
      const r = paperBacktestResearchPackReport({ cwd, env: {} }, { artifacts: ["pf=pf.json", "pd=pd.json"], json: true });
      const obj = JSON.parse(r.text) as { schemaVersion: string; recognizedCount: number; artifactLabels: string[] };
      expect(obj.schemaVersion).toBe("backtest.research.artifact.pack.v1");
      expect(obj.recognizedCount).toBe(2);
      expect(obj.artifactLabels).toEqual(["pd", "pf"]);
      expect(() => validateBacktestResearchArtifactPack(JSON.parse(r.text))).not.toThrow();
      expect(paperBacktestResearchPackReport({ cwd, env: {} }, { artifacts: ["pf=pf.json", "pd=pd.json"], json: true }).text).toBe(r.text);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-change exits 1 on change, 0 when clean", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeJson(cwd, "pf.json", cleanPortfolio());
      writeJson(cwd, "pd.json", portfolioDiffRegression());
      expect(paperBacktestResearchPackReport({ cwd, env: {} }, { artifacts: ["pf=pf.json"], failOnChange: true }).exitCode).toBe(0);
      expect(paperBacktestResearchPackReport({ cwd, env: {} }, { artifacts: ["pf=pf.json", "pd=pd.json"], failOnChange: true }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-regression trips on a regression but not a clean pack", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeJson(cwd, "pf.json", cleanPortfolio());
      writeJson(cwd, "pd.json", portfolioDiffRegression());
      expect(paperBacktestResearchPackReport({ cwd, env: {} }, { artifacts: ["pf=pf.json"], failOnRegression: true }).exitCode).toBe(0);
      expect(paperBacktestResearchPackReport({ cwd, env: {} }, { artifacts: ["pd=pd.json"], failOnRegression: true }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-attention and --fail-on-new-attention trip on an attention artifact", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeJson(cwd, "ci.json", idx([okRun("a"), badRun("b")])); // campaign index with an invalid run
      writeJson(cwd, "hist.json", historyNewAttention());
      expect(paperBacktestResearchPackReport({ cwd, env: {} }, { artifacts: ["ci=ci.json"], failOnAttention: true }).exitCode).toBe(1);
      expect(paperBacktestResearchPackReport({ cwd, env: {} }, { artifacts: ["hist=hist.json"], failOnNewAttention: true }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-unsupported trips only when an unsupported artifact is present", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeJson(cwd, "pf.json", cleanPortfolio());
      writeJson(cwd, "weird.json", { schemaVersion: "backtest.unknown.v9", foo: 1 });
      expect(paperBacktestResearchPackReport({ cwd, env: {} }, { artifacts: ["pf=pf.json"], failOnUnsupported: true }).exitCode).toBe(0);
      expect(paperBacktestResearchPackReport({ cwd, env: {} }, { artifacts: ["pf=pf.json", "w=weird.json"], failOnUnsupported: true }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses a bad spec, a duplicate label, a missing file, and malformed JSON", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeJson(cwd, "pf.json", cleanPortfolio());
      writeFileSync(join(cwd, "bad.json"), "{ not json");
      expect(paperBacktestResearchPackReport({ cwd, env: {} }, { artifacts: ["noequals"] }).exitCode).toBe(1);
      expect(paperBacktestResearchPackReport({ cwd, env: {} }, { artifacts: ["noequals"] }).text).toMatch(/must be "label=path"/);
      expect(paperBacktestResearchPackReport({ cwd, env: {} }, { artifacts: ["dup=pf.json", "dup=pf.json"] }).text).toMatch(/duplicate artifact label/);
      expect(paperBacktestResearchPackReport({ cwd, env: {} }, { artifacts: ["m=missing.json"] }).exitCode).toBe(1);
      expect(paperBacktestResearchPackReport({ cwd, env: {} }, { artifacts: ["b=bad.json"] }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("refuses a corrupt artifact that claims a known schema", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const corrupt = JSON.parse(JSON.stringify(cleanPortfolio())) as { campaignCount: unknown };
      corrupt.campaignCount = "oops";
      writeJson(cwd, "corrupt.json", corrupt);
      const r = paperBacktestResearchPackReport({ cwd, env: {} }, { artifacts: ["pf=corrupt.json"] });
      expect(r.text).toMatch(/claims schema .* but is invalid/);
      expect(r.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("--out writes ONLY the pack JSON and refuses overwrite without --force", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeJson(cwd, "pf.json", cleanPortfolio());
      const before = listFilesRec(cwd);
      const r = paperBacktestResearchPackReport({ cwd, env: {} }, { artifacts: ["pf=pf.json"], outPath: "pack.json" });
      expect(r.exitCode).toBe(0);
      const after = listFilesRec(cwd);
      expect(after.length).toBe(before.length + 1); // exactly one new file
      const written = JSON.parse(readFileSync(join(cwd, "pack.json"), "utf8"));
      expect(() => validateBacktestResearchArtifactPack(written)).not.toThrow();
      // refuse overwrite without --force
      const r2 = paperBacktestResearchPackReport({ cwd, env: {} }, { artifacts: ["pf=pf.json"], outPath: "pack.json" });
      expect(r2.exitCode).toBe(1);
      expect(r2.text).toMatch(/already exists/);
      // --force overwrites
      const r3 = paperBacktestResearchPackReport({ cwd, env: {} }, { artifacts: ["pf=pf.json"], outPath: "pack.json", force: true });
      expect(r3.exitCode).toBe(0);
      expect(listFilesRec(cwd).length).toBe(after.length); // still exactly one new file (overwritten)
    } finally {
      cleanup();
    }
  });

  it("writes nothing without --out", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeJson(cwd, "pf.json", cleanPortfolio());
      writeJson(cwd, "m.json", manifest());
      const before = listFilesRec(cwd);
      paperBacktestResearchPackReport({ cwd, env: {} }, { artifacts: ["pf=pf.json", "m=m.json"], json: true });
      expect(listFilesRec(cwd)).toEqual(before);
    } finally {
      cleanup();
    }
  });
});

describe("paperBacktestDiffResearchPackReport (Sprint 24)", () => {
  function desc(over: Partial<BacktestArtifactDescriptor> = {}): BacktestArtifactDescriptor {
    return { path: "a.report.json", kind: "backtest-report", schemaVersion: "backtest.report.v1", digest: "d1", sizeBytes: 100, ...over };
  }
  const okRun = (runId: string, digest = "d1") => ({ runId, artifacts: [desc({ digest })] });
  const badRun = (runId: string) => ({ runId, artifacts: [desc({ path: "u.json", kind: "unknown-json" as const, schemaVersion: null, digest: "u" })] });
  function idx(runs: { runId: string; artifacts: BacktestArtifactDescriptor[] }[]) {
    return buildBacktestResearchCampaignIndex({ campaignName: "c", runs });
  }
  function hist(snaps: { runId: string; artifacts: BacktestArtifactDescriptor[] }[][]) {
    return buildBacktestResearchCampaignHistoryReport({ snapshots: snaps.map((runs, i) => ({ snapshotId: `s${i}`, index: idx(runs) })) });
  }
  const pc = (campaignId: string, report: unknown) => ({ campaignId, report });
  const portfolio = (campaigns: { campaignId: string; report: unknown }[]) => buildBacktestResearchPortfolioReport({ campaigns });
  function writeJson(cwd: string, name: string, value: unknown): string {
    writeFileSync(join(cwd, name), JSON.stringify(value, null, 2));
    return name;
  }
  // Real artifact fixtures + real packs.
  const cleanPortfolio = () => portfolio([pc("alpha", hist([[okRun("a")], [okRun("a")]]))]);
  const regressedPortfolio = () => portfolio([pc("alpha", hist([[okRun("a", "1")], [okRun("a", "2")]]))]);
  const portfolioDiffRegression = () => diffBacktestResearchPortfolioReports(cleanPortfolio(), regressedPortfolio());
  const cleanIndex = () => idx([okRun("a")]);
  const attentionIndex = () => idx([okRun("a"), badRun("b")]);
  const unsupported = () => ({ schemaVersion: "vendor.unknown.v9", foo: 1 });
  const art = (label: string, value: unknown) => ({ label, value });
  const pack = (artifacts: { label: string; value: unknown }[]) => buildBacktestResearchArtifactPack({ artifacts });

  it("refuses when --base or --next is missing", () => {
    expect(paperBacktestDiffResearchPackReport({}, {}).text).toMatch(/^Refusing: --base/);
    expect(paperBacktestDiffResearchPackReport({}, { basePath: "b.json" }).text).toMatch(/^Refusing: --next/);
    expect(paperBacktestDiffResearchPackReport({}, {}).exitCode).toBe(1);
  });

  it("renders a PAPER-ONLY human diff by default", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = writeJson(cwd, "base.json", pack([art("ci", cleanIndex())]));
      const next = writeJson(cwd, "next.json", pack([art("ci", attentionIndex())]));
      const r = paperBacktestDiffResearchPackReport({ cwd, env: {} }, { basePath: base, nextPath: next });
      expect(r.text).toContain("SIMULATED PAPER-ONLY RESEARCH ARTIFACT PACK DIFF");
      expect(r.text).toContain("PAPER ONLY");
      expect(r.text.toLowerCase()).toContain("not a live result");
      expect(r.text).toContain("Attention newly appeared: YES");
      expect(r.exitCode).toBe(0); // no fail flag set
    } finally {
      cleanup();
    }
  });

  it("--json emits a valid, stable pack diff object", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = writeJson(cwd, "base.json", pack([art("ci", cleanIndex())]));
      const next = writeJson(cwd, "next.json", pack([art("ci", cleanIndex()), art("pd", portfolioDiffRegression())]));
      const r = paperBacktestDiffResearchPackReport({ cwd, env: {} }, { basePath: base, nextPath: next, json: true });
      const obj = JSON.parse(r.text) as { schemaVersion: string; hasChange: boolean; addedArtifacts: { label: string }[]; commonArtifactLabels: string[] };
      expect(obj.schemaVersion).toBe("backtest.research.artifact.pack.diff.v1");
      expect(obj.hasChange).toBe(true);
      expect(obj.addedArtifacts.map((a) => a.label)).toEqual(["pd"]);
      expect(obj.commonArtifactLabels).toEqual(["ci"]);
      expect(() => validateBacktestResearchArtifactPackDiff(JSON.parse(r.text))).not.toThrow();
      // byte-stable across repeated calls
      expect(paperBacktestDiffResearchPackReport({ cwd, env: {} }, { basePath: base, nextPath: next, json: true }).text).toBe(r.text);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-change exits 1 on change, 0 when identical", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = writeJson(cwd, "base.json", pack([art("ci", cleanIndex())]));
      const same = writeJson(cwd, "same.json", pack([art("ci", cleanIndex())]));
      const changed = writeJson(cwd, "changed.json", pack([art("ci", cleanIndex()), art("m2", cleanIndex())]));
      expect(paperBacktestDiffResearchPackReport({ cwd, env: {} }, { basePath: base, nextPath: same, failOnChange: true }).exitCode).toBe(0);
      expect(paperBacktestDiffResearchPackReport({ cwd, env: {} }, { basePath: base, nextPath: changed, failOnChange: true }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-regression ignores an added regressed artifact but trips on a common newly-regressed one", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = writeJson(cwd, "base.json", pack([art("pf", cleanPortfolio())]));
      // an ADDED artifact arriving with a regression -> change, not regression
      const added = writeJson(cwd, "added.json", pack([art("pf", cleanPortfolio()), art("pd", portfolioDiffRegression())]));
      // a COMMON artifact transitioning into regression
      const baseHist = writeJson(cwd, "bh.json", pack([art("h", hist([[okRun("a")], [okRun("a")]]))]));
      const nextHist = writeJson(cwd, "nh.json", pack([art("h", hist([[okRun("a", "1")], [okRun("a", "2")]]))]));
      expect(paperBacktestDiffResearchPackReport({ cwd, env: {} }, { basePath: base, nextPath: added, failOnRegression: true }).exitCode).toBe(0);
      expect(paperBacktestDiffResearchPackReport({ cwd, env: {} }, { basePath: baseHist, nextPath: nextHist, failOnRegression: true }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-unsupported trips on a common artifact that lost recognition and on an added unsupported artifact", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = writeJson(cwd, "base.json", pack([art("pf", cleanPortfolio()), art("x", cleanPortfolio())]));
      const lostRecognition = writeJson(cwd, "lost.json", pack([art("pf", cleanPortfolio()), art("x", unsupported())]));
      const addedUnsupported = writeJson(cwd, "addu.json", pack([art("pf", cleanPortfolio()), art("x", cleanPortfolio()), art("w", unsupported())]));
      const noChange = writeJson(cwd, "same.json", pack([art("pf", cleanPortfolio()), art("x", cleanPortfolio())]));
      expect(paperBacktestDiffResearchPackReport({ cwd, env: {} }, { basePath: base, nextPath: noChange, failOnUnsupported: true }).exitCode).toBe(0);
      expect(paperBacktestDiffResearchPackReport({ cwd, env: {} }, { basePath: base, nextPath: lostRecognition, failOnUnsupported: true }).exitCode).toBe(1);
      expect(paperBacktestDiffResearchPackReport({ cwd, env: {} }, { basePath: base, nextPath: addedUnsupported, failOnUnsupported: true }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("an identical pack pair exits 0 even with every fail flag set", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = writeJson(cwd, "base.json", pack([art("ci", attentionIndex()), art("pd", portfolioDiffRegression())]));
      const same = writeJson(cwd, "same.json", pack([art("ci", attentionIndex()), art("pd", portfolioDiffRegression())]));
      const r = paperBacktestDiffResearchPackReport(
        { cwd, env: {} },
        { basePath: base, nextPath: same, failOnChange: true, failOnRegression: true, failOnAttention: true, failOnNewAttention: true, failOnUnsupported: true },
      );
      expect(r.exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("refuses a malformed base file and a non-pack (wrong-schema) next file", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      writeFileSync(join(cwd, "bad.json"), "{ not json");
      const goodPack = writeJson(cwd, "next.json", pack([art("ci", cleanIndex())]));
      const r1 = paperBacktestDiffResearchPackReport({ cwd, env: {} }, { basePath: "bad.json", nextPath: goodPack });
      expect(r1.text).toMatch(/^Refusing:/);
      expect(r1.exitCode).toBe(1);
      // a valid JSON file that is NOT an artifact pack (a bare portfolio report)
      const notAPack = writeJson(cwd, "pf.json", cleanPortfolio());
      const r2 = paperBacktestDiffResearchPackReport({ cwd, env: {} }, { basePath: goodPack, nextPath: notAPack });
      expect(r2.text).toMatch(/^Refusing:/);
      expect(r2.exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("writes nothing (read-only command)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const base = writeJson(cwd, "base.json", pack([art("ci", cleanIndex())]));
      const next = writeJson(cwd, "next.json", pack([art("ci", attentionIndex())]));
      const before = readdirSync(cwd).sort();
      paperBacktestDiffResearchPackReport({ cwd, env: {} }, { basePath: base, nextPath: next, json: true });
      expect(readdirSync(cwd).sort()).toEqual(before);
    } finally {
      cleanup();
    }
  });
});

describe("paperSniperCandidatesValidateReport (Sprint 25)", () => {
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
  function writeJson(cwd: string, name: string, value: unknown): string {
    writeFileSync(join(cwd, name), JSON.stringify(value, null, 2));
    return name;
  }

  it("refuses when --input is missing", () => {
    expect(paperSniperCandidatesValidateReport({}, {}).text).toMatch(/^Refusing: --input/);
    expect(paperSniperCandidatesValidateReport({}, {}).exitCode).toBe(1);
  });

  it("validates a raw operator list and renders a PAPER-ONLY human summary", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const f = writeJson(cwd, "cands.json", {
        candidates: [
          { candidateId: "c1", mint: USDC, symbol: "USDC", sourceTag: "manual" },
          { candidateId: "c2", mint: WRAPPED_SOL, name: "Wrapped SOL" },
        ],
      });
      const r = paperSniperCandidatesValidateReport({ cwd, env: {} }, { inputPath: f });
      expect(r.text).toContain("SIMULATED PAPER-ONLY SNIPER CANDIDATE LIST");
      expect(r.text).toContain("PAPER ONLY");
      expect(r.text.toLowerCase()).toContain("not live data");
      expect(r.exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("--json emits a valid, stable normalized candidate list", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const f = writeJson(cwd, "cands.json", { sourceLabel: "watch", candidates: [{ candidateId: "c1", mint: USDC }] });
      const r = paperSniperCandidatesValidateReport({ cwd, env: {} }, { inputPath: f, json: true });
      const obj = JSON.parse(r.text) as { schemaVersion: string; candidateCount: number; candidates: { mint: string }[] };
      expect(obj.schemaVersion).toBe("sniper.candidate.list.v1");
      expect(obj.candidateCount).toBe(1);
      expect(obj.candidates[0]!.mint).toBe(USDC);
      // byte-stable across repeated calls
      expect(paperSniperCandidatesValidateReport({ cwd, env: {} }, { inputPath: f, json: true }).text).toBe(r.text);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-warning exits 1 on a duplicate mint, 0 otherwise", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const clean = writeJson(cwd, "clean.json", { candidates: [{ candidateId: "c1", mint: USDC }] });
      const dup = writeJson(cwd, "dup.json", {
        candidates: [
          { candidateId: "c1", mint: USDC, sourceTag: "a" },
          { candidateId: "c2", mint: USDC, sourceTag: "b" },
        ],
      });
      expect(paperSniperCandidatesValidateReport({ cwd, env: {} }, { inputPath: clean, failOnWarning: true }).exitCode).toBe(0);
      const r = paperSniperCandidatesValidateReport({ cwd, env: {} }, { inputPath: dup, failOnWarning: true });
      expect(r.exitCode).toBe(1);
      expect(r.text).toContain("Duplicate mints:");
    } finally {
      cleanup();
    }
  });

  it("refuses a duplicate candidateId, an invalid mint, and secret-length input", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const dupId = writeJson(cwd, "dupid.json", {
        candidates: [{ candidateId: "x", mint: USDC }, { candidateId: "x", mint: WRAPPED_SOL }],
      });
      const badMint = writeJson(cwd, "bad.json", { candidates: [{ candidateId: "c1", mint: "not-a-mint" }] });
      const secretLike = writeJson(cwd, "secret.json", { candidates: [{ candidateId: "c1", mint: "z".repeat(88) }] });
      expect(paperSniperCandidatesValidateReport({ cwd, env: {} }, { inputPath: dupId }).exitCode).toBe(1);
      expect(paperSniperCandidatesValidateReport({ cwd, env: {} }, { inputPath: badMint }).exitCode).toBe(1);
      const r = paperSniperCandidatesValidateReport({ cwd, env: {} }, { inputPath: secretLike });
      expect(r.exitCode).toBe(1);
      expect(r.text).toMatch(/too long to be a public key/);
      expect(r.text).not.toContain("z".repeat(88)); // never echo the secret-like input
    } finally {
      cleanup();
    }
  });

  it("refuses a wrong-schema file and a malformed file", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const wrong = writeJson(cwd, "wrong.json", { schemaVersion: "backtest.report.v1", candidates: [{ candidateId: "c1", mint: USDC }] });
      expect(paperSniperCandidatesValidateReport({ cwd, env: {} }, { inputPath: wrong }).exitCode).toBe(1);
      expect(paperSniperCandidatesValidateReport({ cwd, env: {} }, { inputPath: wrong }).text).toMatch(/schemaVersion must be/);
      writeFileSync(join(cwd, "malformed.json"), "{ not json");
      expect(paperSniperCandidatesValidateReport({ cwd, env: {} }, { inputPath: "malformed.json" }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("accepts a canonical list that carries the correct schemaVersion (round-trips)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const f = writeJson(cwd, "cands.json", { candidates: [{ candidateId: "c1", mint: USDC }] });
      const normalized = JSON.parse(paperSniperCandidatesValidateReport({ cwd, env: {} }, { inputPath: f, json: true }).text);
      const f2 = writeJson(cwd, "canonical.json", normalized);
      const r = paperSniperCandidatesValidateReport({ cwd, env: {} }, { inputPath: f2, json: true });
      expect(JSON.parse(r.text).candidateCount).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("writes nothing (read-only command)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const f = writeJson(cwd, "cands.json", { candidates: [{ candidateId: "c1", mint: USDC }] });
      const before = readdirSync(cwd).sort();
      paperSniperCandidatesValidateReport({ cwd, env: {} }, { inputPath: f, json: true });
      expect(readdirSync(cwd).sort()).toEqual(before);
    } finally {
      cleanup();
    }
  });
});

describe("paperSniperPreflightReport (Sprint 26)", () => {
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const WSOL = "So11111111111111111111111111111111111111112";
  function writeJson(cwd: string, name: string, value: unknown): string {
    writeFileSync(join(cwd, name), JSON.stringify(value, null, 2));
    return name;
  }
  const cleanInspection = (mint: string) => ({ mint, decimals: 6, supplyRaw: "1", uiSupply: 1, mintAuthorityPresent: false, freezeAuthorityPresent: false, isInitialized: true, programLabel: "spl-token" });
  const freezeInspection = (mint: string) => ({ ...cleanInspection(mint), freezeAuthorityPresent: true });
  const riskPass = (mint: string) => ({ mint, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [], summary: [] });
  const riskReject = (mint: string) => ({ mint, score: 95, decision: "REJECT", flags: [{ id: "rug", severity: "critical", title: "Rug" }], summary: [] });

  it("refuses when --candidates is missing", () => {
    expect(paperSniperPreflightReport({}, {}).text).toMatch(/^Refusing: --candidates/);
    expect(paperSniperPreflightReport({}, {}).exitCode).toBe(1);
  });

  it("renders a PAPER-ONLY human preflight (pass + fail + unknown)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const cands = writeJson(cwd, "cands.json", { candidates: [{ candidateId: "good", mint: USDC }, { candidateId: "bad", mint: WSOL }, { candidateId: "unk", mint: USDC }] });
      writeJson(cwd, "good.insp.json", cleanInspection(USDC));
      writeJson(cwd, "good.risk.json", riskPass(USDC));
      writeJson(cwd, "bad.risk.json", riskReject(WSOL));
      const r = paperSniperPreflightReport(
        { cwd, env: {} },
        { candidatesPath: cands, inspections: ["good=good.insp.json"], risks: ["good=good.risk.json", "bad=bad.risk.json"] },
      );
      expect(r.text).toContain("SIMULATED PAPER-ONLY SNIPER TOKEN PREFLIGHT");
      expect(r.text).toContain("[PASS]");
      expect(r.text).toContain("[FAIL]");
      expect(r.text).toContain("[UNKNOWN]");
      expect(r.text.toLowerCase()).toContain("not a trade signal");
      expect(r.exitCode).toBe(0); // no fail flag set
    } finally {
      cleanup();
    }
  });

  it("--json emits a valid, stable preflight report", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const cands = writeJson(cwd, "cands.json", { candidates: [{ candidateId: "c1", mint: USDC }] });
      writeJson(cwd, "c1.risk.json", riskPass(USDC));
      const r = paperSniperPreflightReport({ cwd, env: {} }, { candidatesPath: cands, risks: ["c1=c1.risk.json"], json: true });
      const obj = JSON.parse(r.text) as { schemaVersion: string; passCount: number; candidates: { status: string }[] };
      expect(obj.schemaVersion).toBe("sniper.token.preflight.report.v1");
      expect(obj.passCount).toBe(1);
      expect(obj.candidates[0]!.status).toBe("pass");
      // byte-stable
      expect(paperSniperPreflightReport({ cwd, env: {} }, { candidatesPath: cands, risks: ["c1=c1.risk.json"], json: true }).text).toBe(r.text);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-fail and --fail-on-warning set the exit code", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const cands = writeJson(cwd, "cands.json", { candidates: [{ candidateId: "c1", mint: USDC }] });
      writeJson(cwd, "reject.json", riskReject(USDC));
      writeJson(cwd, "freeze.json", freezeInspection(USDC));
      expect(paperSniperPreflightReport({ cwd, env: {} }, { candidatesPath: cands, risks: ["c1=reject.json"], failOnFail: true }).exitCode).toBe(1);
      expect(paperSniperPreflightReport({ cwd, env: {} }, { candidatesPath: cands, inspections: ["c1=freeze.json"], failOnFail: true }).exitCode).toBe(0); // warn, not fail
      expect(paperSniperPreflightReport({ cwd, env: {} }, { candidatesPath: cands, inspections: ["c1=freeze.json"], failOnWarning: true }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });

  it("--out writes ONLY the report JSON and refuses overwrite without --force", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const cands = writeJson(cwd, "cands.json", { candidates: [{ candidateId: "c1", mint: USDC }] });
      writeJson(cwd, "c1.risk.json", riskPass(USDC));
      const before = readdirSync(cwd).length;
      const r1 = paperSniperPreflightReport({ cwd, env: {} }, { candidatesPath: cands, risks: ["c1=c1.risk.json"], outPath: "pf.json" });
      expect(r1.exitCode).toBe(0);
      expect(readdirSync(cwd).length).toBe(before + 1);
      const written = JSON.parse(readFileSync(join(cwd, "pf.json"), "utf8")) as { schemaVersion: string };
      expect(written.schemaVersion).toBe("sniper.token.preflight.report.v1");
      const r2 = paperSniperPreflightReport({ cwd, env: {} }, { candidatesPath: cands, risks: ["c1=c1.risk.json"], outPath: "pf.json" });
      expect(r2.exitCode).toBe(1);
      expect(r2.text).toMatch(/already exists/);
      expect(paperSniperPreflightReport({ cwd, env: {} }, { candidatesPath: cands, risks: ["c1=c1.risk.json"], outPath: "pf.json", force: true }).exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("refuses malformed candidate file, a bad spec, and data for an unknown candidateId", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const cands = writeJson(cwd, "cands.json", { candidates: [{ candidateId: "c1", mint: USDC }] });
      writeJson(cwd, "c1.risk.json", riskPass(USDC));
      writeFileSync(join(cwd, "malformed.json"), "{ not json");
      expect(paperSniperPreflightReport({ cwd, env: {} }, { candidatesPath: "malformed.json" }).exitCode).toBe(1);
      expect(paperSniperPreflightReport({ cwd, env: {} }, { candidatesPath: cands, risks: ["noeq"] }).exitCode).toBe(1);
      const r = paperSniperPreflightReport({ cwd, env: {} }, { candidatesPath: cands, risks: ["ghost=c1.risk.json"] });
      expect(r.exitCode).toBe(1);
      expect(r.text).toMatch(/unknown candidateId/);
    } finally {
      cleanup();
    }
  });

  it("writes nothing without --out (read-only by default)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const cands = writeJson(cwd, "cands.json", { candidates: [{ candidateId: "c1", mint: USDC }] });
      writeJson(cwd, "c1.risk.json", riskPass(USDC));
      const before = readdirSync(cwd).sort();
      paperSniperPreflightReport({ cwd, env: {} }, { candidatesPath: cands, risks: ["c1=c1.risk.json"], json: true });
      expect(readdirSync(cwd).sort()).toEqual(before);
    } finally {
      cleanup();
    }
  });
});

describe("paperSniperDecideReport (Sprint 27)", () => {
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const WSOL = "So11111111111111111111111111111111111111112";
  function writeJson(cwd: string, name: string, value: unknown): string {
    writeFileSync(join(cwd, name), JSON.stringify(value, null, 2));
    return name;
  }
  const cleanInspection = (mint: string) => ({ mint, decimals: 6, supplyRaw: "1", uiSupply: 1, mintAuthorityPresent: false, freezeAuthorityPresent: false, isInitialized: true, programLabel: "spl-token" });
  const riskPass = (mint: string) => ({ mint, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [], summary: [] });
  const riskReject = (mint: string) => ({ mint, score: 95, decision: "REJECT", flags: [{ id: "rug", severity: "critical", title: "Rug" }], summary: [] });

  /** Build a candidate file + a preflight file for it via the real preflight command. */
  function setup(cwd: string): { cands: string; preflight: string } {
    const cands = writeJson(cwd, "cands.json", { candidates: [{ candidateId: "good", mint: USDC, observedLiquidityUsd: 50000 }, { candidateId: "bad", mint: WSOL }] });
    writeJson(cwd, "good.insp.json", cleanInspection(USDC));
    writeJson(cwd, "good.risk.json", riskPass(USDC));
    writeJson(cwd, "bad.risk.json", riskReject(WSOL));
    const pf = paperSniperPreflightReport(
      { cwd, env: {} },
      { candidatesPath: cands, inspections: ["good=good.insp.json"], risks: ["good=good.risk.json", "bad=bad.risk.json"], outPath: "preflight.json" },
    );
    expect(pf.exitCode).toBe(0);
    return { cands, preflight: "preflight.json" };
  }

  it("refuses when --candidates is missing", () => {
    expect(paperSniperDecideReport({}, {}).text).toMatch(/^Refusing: --candidates/);
    expect(paperSniperDecideReport({}, {}).exitCode).toBe(1);
  });

  it("renders a PAPER-ONLY human decision report (paper-enter + paper-reject)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const { cands, preflight } = setup(cwd);
      const r = paperSniperDecideReport({ cwd, env: {} }, { candidatesPath: cands, preflightPath: preflight });
      expect(r.text).toContain("SIMULATED PAPER-ONLY SNIPER DECISION REPORT");
      expect(r.text).toContain("[PAPER-ENTER]");
      expect(r.text).toContain("[PAPER-REJECT]");
      expect(r.text.toLowerCase()).toContain("not a trade signal");
      expect(r.exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("--json emits a valid, stable decision report", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const { cands, preflight } = setup(cwd);
      const r = paperSniperDecideReport({ cwd, env: {} }, { candidatesPath: cands, preflightPath: preflight, json: true });
      const obj = JSON.parse(r.text) as { schemaVersion: string; paperEnterCount: number; paperRejectCount: number; decisions: { candidateId: string; decision: string }[] };
      expect(obj.schemaVersion).toBe("sniper.paper.decision.report.v1");
      expect(obj.paperEnterCount).toBe(1);
      expect(obj.paperRejectCount).toBe(1);
      expect(obj.decisions.find((d) => d.candidateId === "good")!.decision).toBe("paper-enter");
      expect(paperSniperDecideReport({ cwd, env: {} }, { candidatesPath: cands, preflightPath: preflight, json: true }).text).toBe(r.text);
    } finally {
      cleanup();
    }
  });

  it("--fail-on-paper-enter and --fail-on-risk set the exit code", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const { cands, preflight } = setup(cwd);
      expect(paperSniperDecideReport({ cwd, env: {} }, { candidatesPath: cands, preflightPath: preflight, failOnPaperEnter: true }).exitCode).toBe(1);
      expect(paperSniperDecideReport({ cwd, env: {} }, { candidatesPath: cands, preflightPath: preflight, failOnRisk: true }).exitCode).toBe(1);
      // with no preflight, everything is watched → neither gate trips
      expect(paperSniperDecideReport({ cwd, env: {} }, { candidatesPath: cands, failOnPaperEnter: true, failOnRisk: true }).exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("applies a rules file (denylist → skip)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const { cands, preflight } = setup(cwd);
      const rules = writeJson(cwd, "rules.json", { denyMints: [USDC] });
      const r = paperSniperDecideReport({ cwd, env: {} }, { candidatesPath: cands, preflightPath: preflight, rulesPath: rules, json: true });
      const obj = JSON.parse(r.text) as { decisions: { candidateId: string; decision: string }[] };
      expect(obj.decisions.find((d) => d.candidateId === "good")!.decision).toBe("skip");
    } finally {
      cleanup();
    }
  });

  it("--out writes ONLY the report JSON and refuses overwrite without --force", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const { cands, preflight } = setup(cwd);
      const before = readdirSync(cwd).length;
      const r1 = paperSniperDecideReport({ cwd, env: {} }, { candidatesPath: cands, preflightPath: preflight, outPath: "decision.json" });
      expect(r1.exitCode).toBe(0);
      expect(readdirSync(cwd).length).toBe(before + 1);
      const written = JSON.parse(readFileSync(join(cwd, "decision.json"), "utf8")) as { schemaVersion: string };
      expect(written.schemaVersion).toBe("sniper.paper.decision.report.v1");
      expect(paperSniperDecideReport({ cwd, env: {} }, { candidatesPath: cands, preflightPath: preflight, outPath: "decision.json" }).exitCode).toBe(1);
      expect(paperSniperDecideReport({ cwd, env: {} }, { candidatesPath: cands, preflightPath: preflight, outPath: "decision.json", force: true }).exitCode).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("refuses a malformed candidate file, a wrong-schema preflight, and bad rules", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const cands = writeJson(cwd, "cands.json", { candidates: [{ candidateId: "c1", mint: USDC }] });
      writeFileSync(join(cwd, "malformed.json"), "{ not json");
      expect(paperSniperDecideReport({ cwd, env: {} }, { candidatesPath: "malformed.json" }).exitCode).toBe(1);
      const wrongPf = writeJson(cwd, "wrongpf.json", { schemaVersion: "backtest.report.v1" });
      expect(paperSniperDecideReport({ cwd, env: {} }, { candidatesPath: cands, preflightPath: wrongPf }).exitCode).toBe(1);
      writeFileSync(join(cwd, "badrules.json"), "[]");
      expect(paperSniperDecideReport({ cwd, env: {} }, { candidatesPath: cands, rulesPath: "badrules.json" }).exitCode).toBe(1);
    } finally {
      cleanup();
    }
  });
});

describe("paperSniperWorkflowReport (Sprint 28)", () => {
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  function writeJson(cwd: string, name: string, value: unknown): string {
    writeFileSync(join(cwd, name), JSON.stringify(value, null, 2));
    return name;
  }
  const riskPass = (mint: string) => ({ mint, score: 10, decision: "PASS_FOR_PAPER_EVALUATION", flags: [], summary: [] });

  it("with nothing supplied, recommends candidate intake first and writes nothing", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const before = readdirSync(cwd).sort();
      const r = paperSniperWorkflowReport({ cwd, env: {} }, {});
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain("SIMULATED PAPER-ONLY SNIPER WORKFLOW PLAN");
      expect(r.text).toContain("Next: soulmaker paper:sniper:candidates:validate");
      expect(r.text.toLowerCase()).toContain("executes no stage");
      expect(readdirSync(cwd).sort()).toEqual(before); // writes nothing
    } finally {
      cleanup();
    }
  });

  it("recognizes a valid candidate list as done and recommends preflight next", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const cands = writeJson(cwd, "cands.json", { candidates: [{ candidateId: "c1", mint: USDC }] });
      const r = paperSniperWorkflowReport({ cwd, env: {} }, { candidatesPath: cands, json: true });
      const plan = JSON.parse(r.text) as { schemaVersion: string; stages: { stage: string; status: string }[]; nextStage: string };
      expect(plan.schemaVersion).toBe("sniper.workflow.plan.v1");
      expect(plan.stages.find((s) => s.stage === "candidates")!.status).toBe("done");
      expect(plan.stages.find((s) => s.stage === "preflight")!.status).toBe("ready");
      expect(plan.nextStage).toBe("preflight");
    } finally {
      cleanup();
    }
  });

  it("flags an invalid candidate file as blocked (hasInvalidArtifact)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const bad = writeJson(cwd, "bad.json", { schemaVersion: "backtest.report.v1", candidates: [] });
      const r = paperSniperWorkflowReport({ cwd, env: {} }, { candidatesPath: bad, json: true });
      const plan = JSON.parse(r.text) as { stages: { stage: string; status: string; valid: boolean }[]; hasInvalidArtifact: boolean };
      expect(plan.hasInvalidArtifact).toBe(true);
      expect(plan.stages.find((s) => s.stage === "candidates")!.status).toBe("blocked");
    } finally {
      cleanup();
    }
  });

  it("treats a missing supplied path as not-present (not invalid)", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const r = paperSniperWorkflowReport({ cwd, env: {} }, { candidatesPath: "does-not-exist.json", json: true });
      const plan = JSON.parse(r.text) as { stages: { stage: string; present: boolean; valid: boolean | null }[]; hasInvalidArtifact: boolean };
      const c = plan.stages.find((s) => s.stage === "candidates")!;
      expect(c.present).toBe(false);
      expect(c.valid).toBeNull();
      expect(plan.hasInvalidArtifact).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("reports the full chain complete when all three artifacts validate", () => {
    const { cwd, cleanup } = withConfig({ mode: "PAPER" });
    try {
      const cands = writeJson(cwd, "cands.json", { candidates: [{ candidateId: "c1", mint: USDC }] });
      writeJson(cwd, "c1.risk.json", riskPass(USDC));
      paperSniperPreflightReport({ cwd, env: {} }, { candidatesPath: cands, risks: ["c1=c1.risk.json"], outPath: "pf.json" });
      paperSniperDecideReport({ cwd, env: {} }, { candidatesPath: cands, preflightPath: "pf.json", outPath: "dec.json" });
      const r = paperSniperWorkflowReport({ cwd, env: {} }, { candidatesPath: cands, preflightPath: "pf.json", decisionPath: "dec.json", json: true });
      const plan = JSON.parse(r.text) as { complete: boolean; doneCount: number; nextStage: string | null };
      expect(plan.complete).toBe(true);
      expect(plan.doneCount).toBe(3);
      expect(plan.nextStage).toBeNull();
    } finally {
      cleanup();
    }
  });
});
