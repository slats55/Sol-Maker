#!/usr/bin/env -S npx tsx
import { Command } from "commander";
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
} from "./commands.js";

/** Coerce a commander string option to a number, or undefined when absent. */
function num(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

const program = new Command();

program
  .name("soulmaker")
  .description(
    "Soulmaker — security-first Solana trading command center (read-only CLI).",
  )
  .version("0.0.0");

/** Print a report and set a non-zero exit code for refusals/read failures. */
function printResult(text: string): void {
  console.log(text);
  // Match the FIRST line only: a refusal report *starts* with one of these, so a
  // success report that merely contains such a word later cannot trip the exit.
  const firstLine = text.split("\n", 1)[0] ?? "";
  if (/^(Refusing|RPC read failed|Config is INVALID)/.test(firstLine)) {
    process.exitCode = 1;
  }
}

program
  .command("doctor")
  .description("Run an environment & safety self-check")
  .action(() => {
    console.log(doctorReport());
  });

program
  .command("config:check")
  .description("Validate the config and print it (secrets redacted)")
  .action(() => {
    printResult(configCheckReport());
  });

program
  .command("mode")
  .description("Show the current trading mode and what it permits")
  .action(() => {
    console.log(modeReport());
  });

program
  .command("paper:status")
  .description("Show paper-trading status from an optional journal (PAPER ONLY)")
  .option("--journal <path>", "paper journal JSONL file to summarize")
  .option("--json", "emit the status as stable JSON")
  .action((opts: { journal?: string; json?: boolean }) => {
    printResult(
      paperStatusReport({}, { journalPath: opts.journal, json: Boolean(opts.json) }),
    );
  });

program
  .command("paper:run")
  .description(
    "Run a deterministic, simulated-only paper evaluation from injected fixtures (PAPER ONLY)",
  )
  .option("--candidates <path>", "JSON array of paper candidates (with risk reports)")
  .option("--prices <path>", "JSON array of injected price points")
  .option("--journal <path>", "append this run's events to a JSONL journal")
  .option("--max-trade-size-usd <number>", "max simulated USD per trade")
  .option("--max-daily-loss-usd <number>", "max simulated realized USD loss before buys stop")
  .option("--max-open-positions <number>", "max simultaneous simulated positions")
  .option("--max-position-size-usd <number>", "optional max cost basis per position")
  .option("--take-profit-pct <number>", "take-profit threshold in percent")
  .option("--stop-loss-pct <number>", "stop-loss threshold in percent")
  .option("--kill-switch", "engage the kill switch: no simulated trades")
  .option("--allow-caution", "allow CAUTION risk reports into paper evaluation")
  .option("--json", "emit the report as stable JSON")
  .action(
    (opts: {
      candidates?: string;
      prices?: string;
      journal?: string;
      maxTradeSizeUsd?: string;
      maxDailyLossUsd?: string;
      maxOpenPositions?: string;
      maxPositionSizeUsd?: string;
      takeProfitPct?: string;
      stopLossPct?: string;
      killSwitch?: boolean;
      allowCaution?: boolean;
      json?: boolean;
    }) => {
      printResult(
        paperRunReport(
          {},
          {
            candidatesPath: opts.candidates,
            pricesPath: opts.prices,
            journalPath: opts.journal,
            maxTradeSizeUsd: num(opts.maxTradeSizeUsd),
            maxDailyLossUsd: num(opts.maxDailyLossUsd),
            maxOpenPositions: num(opts.maxOpenPositions),
            maxPositionSizeUsd: num(opts.maxPositionSizeUsd),
            takeProfitPct: num(opts.takeProfitPct),
            stopLossPct: num(opts.stopLossPct),
            killSwitch: Boolean(opts.killSwitch),
            allowCaution: Boolean(opts.allowCaution),
            json: Boolean(opts.json),
          },
        ),
      );
    },
  );

program
  .command("paper:journal")
  .description("Read and summarize an append-only paper journal (PAPER ONLY)")
  .option("--journal <path>", "paper journal JSONL file")
  .option("--json", "emit the summary as stable JSON")
  .action((opts: { journal?: string; json?: boolean }) => {
    printResult(
      paperJournalReport({}, { journalPath: opts.journal, json: Boolean(opts.json) }),
    );
  });

program
  .command("solana:doctor")
  .description("Read-only RPC readiness check (no wallet, no sends)")
  .action(async () => {
    printResult(await solanaDoctorReport());
  });

program
  .command("wallet:watch <publicKey>")
  .description("Read-only wallet snapshot: SOL balance + SPL token accounts")
  .option("--allow-paper-read", "permit chain reads while in PAPER mode")
  .action(async (publicKey: string, opts: { allowPaperRead?: boolean }) => {
    printResult(
      await walletWatchReport(
        publicKey,
        {},
        { allowPaperRead: Boolean(opts.allowPaperRead) },
      ),
    );
  });

program
  .command("token:inspect <mint>")
  .description("Read-only token mint inspection (not a buy recommendation)")
  .option("--allow-paper-read", "permit chain reads while in PAPER mode")
  .action(async (mint: string, opts: { allowPaperRead?: boolean }) => {
    printResult(
      await tokenInspectReport(
        mint,
        {},
        { allowPaperRead: Boolean(opts.allowPaperRead) },
      ),
    );
  });

program
  .command("token:accounts <ownerPublicKey>")
  .description("Read-only list of a wallet's SPL token accounts")
  .option("--allow-paper-read", "permit chain reads while in PAPER mode")
  .action(async (owner: string, opts: { allowPaperRead?: boolean }) => {
    printResult(
      await tokenAccountsReport(
        owner,
        {},
        { allowPaperRead: Boolean(opts.allowPaperRead) },
      ),
    );
  });

program
  .command("token:risk <mint>")
  .description(
    "Read-only ADVISORY token risk report (flags + score). Not a buy recommendation.",
  )
  .option("--allow-paper-read", "permit chain reads while in PAPER mode")
  .option("--allowlist <path>", "newline-separated allowlist file")
  .option("--denylist <path>", "newline-separated denylist file")
  .option("--previously-traded <path>", "newline-separated previously-traded mints file")
  .option("--json", "emit the report as stable JSON")
  .action(
    async (
      mint: string,
      opts: {
        allowPaperRead?: boolean;
        allowlist?: string;
        denylist?: string;
        previouslyTraded?: string;
        json?: boolean;
      },
    ) => {
      printResult(
        await tokenRiskReport(
          mint,
          {},
          {
            allowPaperRead: Boolean(opts.allowPaperRead),
            allowlistPath: opts.allowlist,
            denylistPath: opts.denylist,
            previouslyTradedPath: opts.previouslyTraded,
            json: Boolean(opts.json),
          },
        ),
      );
    },
  );

program
  .command("strategy:evaluate")
  .description(
    "Evaluate a local candidate against a local strategy config (PAPER ONLY; feeds paper simulation; not advice)",
  )
  .option("--candidate <path>", "JSON StrategyCandidate object (with a risk report)")
  .option("--config <path>", "JSON StrategyConfig object")
  .option("--paper-state <path>", "optional JSON PaperState for position-awareness rules")
  .option("--json", "emit the report as stable JSON")
  .action(
    (opts: {
      candidate?: string;
      config?: string;
      paperState?: string;
      json?: boolean;
    }) => {
      printResult(
        strategyEvaluateReport(
          {},
          {
            candidatePath: opts.candidate,
            strategyConfigPath: opts.config,
            paperStatePath: opts.paperState,
            json: Boolean(opts.json),
          },
        ),
      );
    },
  );

program
  .command("strategy:plan")
  .description(
    "Evaluate a BATCH of local candidates and emit paper candidates for a later paper:run (PAPER ONLY; does not run paper trades; not advice)",
  )
  .option("--candidates <path>", "JSON array of StrategyCandidate objects")
  .option("--config <path>", "JSON StrategyConfig object")
  .option("--paper-state <path>", "optional JSON PaperState for position-awareness rules")
  .option(
    "--journal <path>",
    "optional READ-ONLY paper journal (JSONL); derives PaperState for position-awareness (mutually exclusive with --paper-state)",
  )
  .option("--out <path>", "write ONLY the resulting PaperCandidate[] array to this file")
  .option("--size <number>", "fallback simulated USD size for converted candidates")
  .option("--include-skipped", "keep SKIP decisions in the report (never in paper candidates)")
  .option("--include-watch", "keep WATCH decisions in the report (never in paper candidates)")
  .option("--json", "emit the plan as stable JSON")
  .action(
    (opts: {
      candidates?: string;
      config?: string;
      paperState?: string;
      journal?: string;
      out?: string;
      size?: string;
      includeSkipped?: boolean;
      includeWatch?: boolean;
      json?: boolean;
    }) => {
      printResult(
        strategyPlanReport(
          {},
          {
            candidatesPath: opts.candidates,
            strategyConfigPath: opts.config,
            paperStatePath: opts.paperState,
            journalPath: opts.journal,
            outPath: opts.out,
            defaultPaperSizeUsd: num(opts.size),
            includeSkipped: Boolean(opts.includeSkipped),
            includeWatch: Boolean(opts.includeWatch),
            json: Boolean(opts.json),
          },
        ),
      );
    },
  );

program
  .command("paper:backtest")
  .description(
    "Deterministic, injected-only simulated replay of a local scenario through plan → paper (PAPER ONLY; not a live result; not financial advice; not a profitability claim)",
  )
  .option("--scenario <path>", "local JSON backtest scenario (config + caps + steps)")
  .option("--out <path>", "write ONLY the report JSON to this file (never a journal/fills)")
  .option("--json", "emit the report as stable JSON")
  .action((opts: { scenario?: string; out?: string; json?: boolean }) => {
    printResult(
      paperBacktestReport(
        {},
        {
          scenarioPath: opts.scenario,
          outPath: opts.out,
          json: Boolean(opts.json),
        },
      ),
    );
  });

program.parseAsync(process.argv);
