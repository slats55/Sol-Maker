#!/usr/bin/env -S npx tsx
import { Command } from "commander";
import { PHASE6_READINESS_EVIDENCE_AREAS } from "@soulmaker/simulation";
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
  paperSniperPreflightInputValidateReport,
  paperSniperPreflightInputPrepareReport,
  paperRouteQuotePrepareReport,
  paperRouteQuoteFetchReport,
  paperRealtimeSnapshotReport,
  paperRealtimeWatchReport,
  paperSimulationTxReport,
  engineStatusReport,
  engineQuoteScoreReport,
  engineTxInspectReport,
  engineSimClassifyReport,
  engineSniperScoreReport,
  executionStatusReport,
  executionBuildReport,
  executionDevnetSendReport,
  executionDevnetRehearseReport,
  executionDevnetFundingStatusReport,
  executionReadinessReport,
  phase7AuthorizationAuditReport,
  phase7SignoffTemplateReport,
  phase7MicrotradePreflightReport,
  paperSniperOperatorDemoReport,
  paperSniperWatchlistPrepareReport,
  paperSniperCampaignRunReport,
  paperSniperProviderDoctorReport,
  paperSniperCampaignAutoRunReport,
  paperSniperCampaignDiffReport,
  paperSniperAlphaReportReport,
  executionSessionStatusReport,
  executionSessionReconcileReport,
  executionSessionAcknowledgeReport,
  paperSniperRehearseReport,
  paperSniperDecideReport,
  paperSniperWorkflowReport,
  paperSniperReportReport,
  paperSniperDiffReportReport,
  paperSniperPolicyValidateReport,
  paperSniperAuditReport,
  paperSniperSessionPackReport,
  paperSniperSafetyGatesReport,
  paperSniperKillSwitchSpecReport,
  paperSniperSecretsPolicyReport,
  paperSniperBurnerIsolationSpecReport,
  paperPhase6PrereqsReport,
  paperPhase6IntentPlanReport,
  paperPhase6DiffIntentReport,
  paperSimulationIntentPlanReport,
  paperSimulationResultReport,
  paperSimulationRouteReport,
  paperSimulationValidateReport,
  paperSimulationAuditReport,
  paperSimulationReadinessReport,
  paperSimulationDiffPlanReport,
  paperSimulationDiffResultReport,
  paperSimulationHandoffReport,
  paperSimulationBundleReport,
  paperSniperDryRunReport,
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
  .option("--json", "emit the inspection as stable JSON (the shape the sniper preflight bridge consumes)")
  .option("--out <path>", "write ONLY the inspection JSON to this path (UTF-8; refused if it exists)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .action(
    async (
      mint: string,
      opts: { allowPaperRead?: boolean; json?: boolean; out?: string; force?: boolean },
    ) => {
      printResult(
        await tokenInspectReport(
          mint,
          {},
          {
            allowPaperRead: Boolean(opts.allowPaperRead),
            json: Boolean(opts.json),
            outPath: opts.out,
            force: Boolean(opts.force),
          },
        ),
      );
    },
  );

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
    "Read-only ADVISORY token risk report (flags + score). Not a buy recommendation. --deep adds holder-concentration + metadata-mutability reads (S92); --price-impact-pct feeds the liquidity-depth flags from a quote probe.",
  )
  .option("--allow-paper-read", "permit chain reads while in PAPER mode")
  .option("--allowlist <path>", "newline-separated allowlist file")
  .option("--denylist <path>", "newline-separated denylist file")
  .option("--previously-traded <path>", "newline-separated previously-traded mints file")
  .option("--deep", "ALSO run the deep read-only checks: holder concentration (getTokenLargestAccounts) + Metaplex metadata mutability; a failed deep read is an explicit unknown caution, never a silent pass")
  .option("--price-impact-pct <pct>", "provider-reported price impact percent from a small quote probe (paper:routequote:fetch report) — feeds the liquidity-depth flags")
  .option("--json", "emit the report as stable JSON")
  .option("--out <path>", "write ONLY the risk report JSON to this path (UTF-8; refused if it exists)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .action(
    async (
      mint: string,
      opts: {
        allowPaperRead?: boolean;
        allowlist?: string;
        denylist?: string;
        previouslyTraded?: string;
        deep?: boolean;
        priceImpactPct?: string;
        json?: boolean;
        out?: string;
        force?: boolean;
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
            deep: Boolean(opts.deep),
            priceImpactPct: opts.priceImpactPct,
            json: Boolean(opts.json),
            outPath: opts.out,
            force: Boolean(opts.force),
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
  .option(
    "--seed-journal <path>",
    "seed the starting state from an external JSONL journal (mutually exclusive with embedded initialJournal)",
  )
  .option("--json", "emit the report as stable JSON")
  .action((opts: { scenario?: string; out?: string; seedJournal?: string; json?: boolean }) => {
    printResult(
      paperBacktestReport(
        {},
        {
          scenarioPath: opts.scenario,
          outPath: opts.out,
          seedJournalPath: opts.seedJournal,
          json: Boolean(opts.json),
        },
      ),
    );
  });

program
  .command("paper:backtest:lint")
  .description(
    "Validate/lint a local JSON backtest scenario WITHOUT running it (PAPER ONLY; errors block a run, warnings flag suspicious design)",
  )
  .option("--scenario <path>", "local JSON backtest scenario to lint")
  .option("--json", "emit the lint result as stable JSON")
  .action((opts: { scenario?: string; json?: boolean }) => {
    printResult(
      paperBacktestLintReport({}, { scenarioPath: opts.scenario, json: Boolean(opts.json) }),
    );
  });

program
  .command("paper:backtest:diff")
  .description(
    "Deterministically diff TWO existing backtest report JSON files (PAPER ONLY; deltas are simulated bookkeeping, not a live result, not advice, not a profitability claim)",
  )
  .option("--base <path>", "BASE backtest report JSON (the reference)")
  .option("--next <path>", "NEXT backtest report JSON (compared against base)")
  .option("--json", "emit the diff as stable JSON")
  .option("--fail-on-regression", "exit non-zero when the diff reports a regression")
  .action((opts: { base?: string; next?: string; json?: boolean; failOnRegression?: boolean }) => {
    const { text, exitCode } = paperBacktestDiffReport(
      {},
      {
        basePath: opts.base,
        nextPath: opts.next,
        json: Boolean(opts.json),
        failOnRegression: Boolean(opts.failOnRegression),
      },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("paper:backtest:scenario:new")
  .description(
    "Write a deterministic, INJECTED backtest scenario skeleton from a built-in template (PAPER ONLY; fake mints + injected prices, not real market data)",
  )
  .option("--template <name>", "template: buy-hold | buy-full-exit | partial-exit | seed-journal-continuation")
  .option("--out <path>", "write ONLY the generated scenario JSON to this file")
  .option("--name <name>", "override the scenario name")
  .option("--force", "overwrite the --out file if it already exists")
  .option("--json", "emit a stable JSON envelope (template, out, lint status)")
  .action((opts: { template?: string; out?: string; name?: string; force?: boolean; json?: boolean }) => {
    printResult(
      paperBacktestScenarioNewReport(
        {},
        {
          template: opts.template,
          outPath: opts.out,
          name: opts.name,
          force: Boolean(opts.force),
          json: Boolean(opts.json),
        },
      ),
    );
  });

program
  .command("paper:backtest:scenario:matrix")
  .description(
    "Expand a base scenario by a small matrix of SAFE config-only patches into one INJECTED scenario file per variant (PAPER ONLY; no code/expressions; steps/name/journal protected)",
  )
  .option("--base <path>", "base scenario JSON")
  .option("--matrix <path>", "matrix JSON: { name?, variants: [{ suffix, patch }] }")
  .option("--out-dir <path>", "directory to write one scenario file per variant (created if absent)")
  .option("--force", "overwrite existing variant files")
  .option("--json", "emit a stable JSON envelope of what was written")
  .action((opts: { base?: string; matrix?: string; outDir?: string; force?: boolean; json?: boolean }) => {
    printResult(
      paperBacktestScenarioMatrixReport(
        {},
        {
          basePath: opts.base,
          matrixPath: opts.matrix,
          outDir: opts.outDir,
          force: Boolean(opts.force),
          json: Boolean(opts.json),
        },
      ),
    );
  });

program
  .command("paper:backtest:scenario:variants")
  .description(
    "Generate INJECTED scenario variants from a base by applying a plan of BOUNDED numeric perturbations (multiply/add, clamped) to its injected prices/metrics — one validated scenario file per variant (PAPER ONLY; no code/expressions; no RNG; steps/name/journal/config protected)",
  )
  .option("--base <path>", "base scenario JSON")
  .option("--plan <path>", "variant plan JSON: { name?, variants: [{ suffix, perturbations }] }")
  .option("--out-dir <path>", "directory to write one scenario file per variant (created if absent)")
  .option("--force", "overwrite existing variant files")
  .option("--json", "emit a stable JSON envelope of what was written")
  .action((opts: { base?: string; plan?: string; outDir?: string; force?: boolean; json?: boolean }) => {
    printResult(
      paperBacktestScenarioVariantsReport(
        {},
        {
          basePath: opts.base,
          planPath: opts.plan,
          outDir: opts.outDir,
          force: Boolean(opts.force),
          json: Boolean(opts.json),
        },
      ),
    );
  });

program
  .command("paper:backtest:scenario:variants:explain")
  .description(
    "Explain (DRY RUN) what paper:backtest:scenario:variants would do for a base + plan: each perturbation's target/op/value/bounds/mint and how many injected values it would change (PAPER ONLY; writes nothing, generates no variants, runs no backtest)",
  )
  .option("--base <path>", "base scenario JSON")
  .option("--plan <path>", "variant plan JSON: { name?, variants: [{ suffix, perturbations }] }")
  .option("--json", "emit the explanation as stable JSON")
  .action((opts: { base?: string; plan?: string; json?: boolean }) => {
    const { text, exitCode } = paperBacktestVariantPlanExplainReport(
      {},
      { basePath: opts.base, planPath: opts.plan, json: Boolean(opts.json) },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("paper:backtest:suite")
  .description(
    "Run a directory of injected *.scenario.json files as one deterministic suite and aggregate a stable index (PAPER ONLY; simulated bookkeeping, not a live result, not advice, not a profitability claim)",
  )
  .option("--dir <path>", "directory of local *.scenario.json files to run")
  .option("--out-dir <path>", "write one report per passed scenario + suite-index.json here")
  .option("--force", "overwrite existing output files")
  .option("--json", "emit the suite index as stable JSON")
  .option("--fail-on-error", "exit non-zero when any scenario in the suite failed")
  .action(
    (opts: { dir?: string; outDir?: string; force?: boolean; json?: boolean; failOnError?: boolean }) => {
      const { text, exitCode } = paperBacktestSuiteReport(
        {},
        {
          dir: opts.dir,
          outDir: opts.outDir,
          force: Boolean(opts.force),
          json: Boolean(opts.json),
          failOnError: Boolean(opts.failOnError),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:backtest:diff:suite")
  .description(
    "Deterministically diff TWO suite output directories by their suite-index.json (PAPER ONLY; deltas are simulated bookkeeping, a changed scenario is not a regression, not a live result, not advice)",
  )
  .option("--base-dir <path>", "BASE suite output directory (contains suite-index.json)")
  .option("--next-dir <path>", "NEXT suite output directory (contains suite-index.json)")
  .option("--json", "emit the suite diff as stable JSON")
  .option("--fail-on-regression", "exit non-zero when the diff reports a regression")
  .action(
    (opts: { baseDir?: string; nextDir?: string; json?: boolean; failOnRegression?: boolean }) => {
      const { text, exitCode } = paperBacktestDiffSuiteReport(
        {},
        {
          baseDir: opts.baseDir,
          nextDir: opts.nextDir,
          json: Boolean(opts.json),
          failOnRegression: Boolean(opts.failOnRegression),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:backtest:sensitivity")
  .description(
    "Run a base scenario plus bounded variants of it and report each variant's per-field delta vs the baseline (PAPER ONLY; deterministic; injected local data; simulated bookkeeping, not a live result, not advice, not a profitability claim)",
  )
  .option("--base <path>", "base scenario JSON (run once as the baseline)")
  .option("--plan <path>", "variant plan JSON: { name?, variants: [{ suffix, perturbations }] }")
  .option("--out-dir <path>", "optional dir to write variants/ + reports/ + sensitivity-report.json")
  .option("--force", "overwrite existing output files")
  .option("--json", "emit the sensitivity report as stable JSON")
  .action((opts: { base?: string; plan?: string; outDir?: string; force?: boolean; json?: boolean }) => {
    printResult(
      paperBacktestSensitivityReport(
        {},
        {
          basePath: opts.base,
          planPath: opts.plan,
          outDir: opts.outDir,
          force: Boolean(opts.force),
          json: Boolean(opts.json),
        },
      ),
    );
  });

program
  .command("paper:backtest:sensitivity:matrix")
  .description(
    "Sweep a directory of injected base scenarios through ONE shared variant plan and aggregate every (base × variant) cell into a stable matrix (PAPER ONLY; deterministic; injected local data; simulated bookkeeping, not a live result, not advice, not a profitability claim)",
  )
  .option("--dir <path>", "directory of local *.scenario.json base scenarios to sweep")
  .option("--plan <path>", "shared variant plan JSON: { name?, variants: [{ suffix, perturbations }] }")
  .option("--out-dir <path>", "optional dir to write sensitivity-matrix-report.json + bases/<id>.sensitivity-report.json")
  .option("--force", "overwrite existing output files")
  .option("--json", "emit the matrix report as stable JSON")
  .option("--fail-on-error", "exit non-zero when any base baseline or variant run failed")
  .action(
    (opts: { dir?: string; plan?: string; outDir?: string; force?: boolean; json?: boolean; failOnError?: boolean }) => {
      const { text, exitCode } = paperBacktestSensitivityMatrixReport(
        {},
        {
          dir: opts.dir,
          planPath: opts.plan,
          outDir: opts.outDir,
          force: Boolean(opts.force),
          json: Boolean(opts.json),
          failOnError: Boolean(opts.failOnError),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:backtest:diff:sensitivity:matrix")
  .description(
    "Deterministically diff TWO sensitivity matrix report JSON files (PAPER ONLY; pairs bases by id and cells by suffix; deltas are simulated bookkeeping, a changed base is not a regression, not a live result, not advice)",
  )
  .option("--base <path>", "BASE matrix report JSON (the reference)")
  .option("--next <path>", "NEXT matrix report JSON (compared against base)")
  .option("--json", "emit the matrix diff as stable JSON")
  .option("--fail-on-regression", "exit non-zero when the diff reports a regression")
  .action((opts: { base?: string; next?: string; json?: boolean; failOnRegression?: boolean }) => {
    const { text, exitCode } = paperBacktestDiffSensitivityMatrixReport(
      {},
      {
        basePath: opts.base,
        nextPath: opts.next,
        json: Boolean(opts.json),
        failOnRegression: Boolean(opts.failOnRegression),
      },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("paper:backtest:suite:coverage")
  .description(
    "Summarize which simulated paper-trading paths a suite exercised from its suite-index.json (PAPER ONLY; behavioural bookkeeping coverage, NOT market coverage, NOT test coverage, NOT a profitability claim)",
  )
  .option("--suite-index <path>", "path to a suite-index.json (e.g. a suite or sensitivity run's reports/suite-index.json)")
  .option("--json", "emit the coverage report as stable JSON")
  .action((opts: { suiteIndex?: string; json?: boolean }) => {
    printResult(
      paperBacktestSuiteCoverageReport({}, { suiteIndexPath: opts.suiteIndex, json: Boolean(opts.json) }),
    );
  });

program
  .command("paper:backtest:diff:sensitivity")
  .description(
    "Deterministically diff TWO sensitivity report JSON files (PAPER ONLY; pairs variants by suffix; deltas are simulated bookkeeping, a changed variant is not a regression, not a live result, not advice)",
  )
  .option("--base <path>", "BASE sensitivity report JSON (the reference)")
  .option("--next <path>", "NEXT sensitivity report JSON (compared against base)")
  .option("--json", "emit the sensitivity diff as stable JSON")
  .option("--fail-on-regression", "exit non-zero when the diff reports a regression")
  .action((opts: { base?: string; next?: string; json?: boolean; failOnRegression?: boolean }) => {
    const { text, exitCode } = paperBacktestDiffSensitivityReport(
      {},
      {
        basePath: opts.base,
        nextPath: opts.next,
        json: Boolean(opts.json),
        failOnRegression: Boolean(opts.failOnRegression),
      },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("paper:backtest:research:manifest")
  .description(
    "Build a reproducibility manifest of the LOCAL JSON artifacts a paper research run produced (PAPER ONLY; classifies each artifact + a non-cryptographic reproducibility-only content digest; local artifacts only, not a live result, not advice)",
  )
  .option("--dir <path>", "directory of local research artifacts to index (recurses real subdirs)")
  .option("--out <path>", "write ONLY the manifest JSON to this file")
  .option("--force", "overwrite the --out file if it already exists")
  .option("--json", "emit the manifest as stable JSON")
  .option("--strict", "exit non-zero if any unknown/malformed artifact is present")
  .action((opts: { dir?: string; out?: string; force?: boolean; json?: boolean; strict?: boolean }) => {
    const { text, exitCode } = paperBacktestResearchManifestReport(
      {},
      {
        dir: opts.dir,
        outPath: opts.out,
        force: Boolean(opts.force),
        json: Boolean(opts.json),
        strict: Boolean(opts.strict),
      },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("paper:backtest:research:verify")
  .description(
    "Verify a previously-written research manifest against the CURRENT local artifacts (PAPER ONLY; recomputes digests/sizes → missing/changed/extra/schema-mismatch; writes nothing; exit 1 if invalid)",
  )
  .option("--manifest <path>", "manifest JSON to verify against")
  .option("--dir <path>", "directory of current local artifacts")
  .option("--json", "emit the verification as stable JSON")
  .action((opts: { manifest?: string; dir?: string; json?: boolean }) => {
    const { text, exitCode } = paperBacktestResearchVerifyReport(
      {},
      { manifestPath: opts.manifest, dir: opts.dir, json: Boolean(opts.json) },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("paper:backtest:diff:research:manifest")
  .description(
    "Deterministically diff TWO research manifest JSON files (PAPER ONLY; pairs artifacts by path → added/removed/changed + count/size deltas; reads two files, writes nothing)",
  )
  .option("--base <path>", "BASE manifest JSON (the reference)")
  .option("--next <path>", "NEXT manifest JSON (compared against base)")
  .option("--json", "emit the manifest diff as stable JSON")
  .option("--fail-on-change", "exit non-zero when the diff reports any change")
  .action((opts: { base?: string; next?: string; json?: boolean; failOnChange?: boolean }) => {
    const { text, exitCode } = paperBacktestDiffResearchManifestReport(
      {},
      {
        basePath: opts.base,
        nextPath: opts.next,
        json: Boolean(opts.json),
        failOnChange: Boolean(opts.failOnChange),
      },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("paper:backtest:research:bundle")
  .description(
    "Package a research run's LOCAL JSON artifacts into one self-describing bundle: manifest summary + counts + a deterministic non-cryptographic top-level run digest (PAPER ONLY; embeds no contents; local artifacts only, not a live result, not advice)",
  )
  .option("--dir <path>", "directory of local research artifacts to bundle (recurses real subdirs)")
  .option("--out <path>", "write ONLY the bundle JSON to this file")
  .option("--force", "overwrite the --out file if it already exists")
  .option("--json", "emit the bundle as stable JSON")
  .option("--strict", "exit non-zero if any unknown/malformed artifact is present")
  .action((opts: { dir?: string; out?: string; force?: boolean; json?: boolean; strict?: boolean }) => {
    const { text, exitCode } = paperBacktestResearchBundleReport(
      {},
      {
        dir: opts.dir,
        outPath: opts.out,
        force: Boolean(opts.force),
        json: Boolean(opts.json),
        strict: Boolean(opts.strict),
      },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("paper:backtest:research:status")
  .description(
    "Summarize a research directory's health at a glance — complete / recognized / stable / in-sync — with a neutral recommended action (PAPER ONLY; reads local files only and writes nothing; exit 1 with --strict on unknown/malformed/drift)",
  )
  .option("--dir <path>", "directory of current local research artifacts to summarize")
  .option("--manifest <path>", "manifest JSON to check against (else research-manifest.json is discovered)")
  .option("--json", "emit the status as stable JSON")
  .option("--strict", "exit non-zero on any unknown/malformed/drift/invalid condition")
  .action((opts: { dir?: string; manifest?: string; json?: boolean; strict?: boolean }) => {
    const { text, exitCode } = paperBacktestResearchStatusReport(
      {},
      {
        dir: opts.dir,
        manifestPath: opts.manifest,
        json: Boolean(opts.json),
        strict: Boolean(opts.strict),
      },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("paper:backtest:research:index")
  .description(
    "Index a CAMPAIGN directory of research runs into one comparable summary: per-run digests + health, aggregate kinds/schemas, and a deterministic non-cryptographic top-level campaign digest (PAPER ONLY; each immediate child dir is a run; reads local files only; exit 1 with --strict when any run needs attention)",
  )
  .option("--dir <path>", "campaign directory whose immediate child directories are research runs")
  .option("--out <path>", "write ONLY the campaign index JSON to this file")
  .option("--force", "overwrite the --out file if it already exists")
  .option("--json", "emit the campaign index as stable JSON")
  .option("--strict", "exit non-zero if any run needs attention (unknown/malformed/drift/invalid)")
  .action((opts: { dir?: string; out?: string; force?: boolean; json?: boolean; strict?: boolean }) => {
    const { text, exitCode } = paperBacktestResearchIndexReport(
      {},
      {
        dir: opts.dir,
        outPath: opts.out,
        force: Boolean(opts.force),
        json: Boolean(opts.json),
        strict: Boolean(opts.strict),
      },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("paper:backtest:diff:research:bundle")
  .description(
    "Deterministically diff TWO research bundle JSON files (PAPER ONLY; pairs artifacts by path → added/removed/digest-changed + run-digest/kind/schema/count changes; a conservative regression flag distinct from any change; reads two files, writes nothing)",
  )
  .option("--base <path>", "BASE bundle JSON (the reference)")
  .option("--next <path>", "NEXT bundle JSON (compared against base)")
  .option("--json", "emit the bundle diff as stable JSON")
  .option("--fail-on-change", "exit non-zero when the diff reports any change")
  .option("--fail-on-regression", "exit non-zero only on a conservative integrity regression")
  .action((opts: { base?: string; next?: string; json?: boolean; failOnChange?: boolean; failOnRegression?: boolean }) => {
    const { text, exitCode } = paperBacktestDiffResearchBundleReport(
      {},
      {
        basePath: opts.base,
        nextPath: opts.next,
        json: Boolean(opts.json),
        failOnChange: Boolean(opts.failOnChange),
        failOnRegression: Boolean(opts.failOnRegression),
      },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("paper:backtest:diff:research:index")
  .description(
    "Deterministically diff TWO campaign index JSON files (PAPER ONLY; pairs runs by runId → added/removed runs + per-run digest/valid/attention changes + campaign-digest/kind/schema/count changes; a conservative regression flag distinct from any change; reads two files, writes nothing)",
  )
  .option("--base <path>", "BASE campaign index JSON (the reference)")
  .option("--next <path>", "NEXT campaign index JSON (compared against base)")
  .option("--json", "emit the campaign diff as stable JSON")
  .option("--fail-on-change", "exit non-zero when the diff reports any change")
  .option("--fail-on-regression", "exit non-zero only on a conservative integrity regression")
  .action((opts: { base?: string; next?: string; json?: boolean; failOnChange?: boolean; failOnRegression?: boolean }) => {
    const { text, exitCode } = paperBacktestDiffResearchIndexReport(
      {},
      {
        basePath: opts.base,
        nextPath: opts.next,
        json: Boolean(opts.json),
        failOnChange: Boolean(opts.failOnChange),
        failOnRegression: Boolean(opts.failOnRegression),
      },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("paper:backtest:research:history")
  .description(
    "Fold an ORDERED set of campaign index JSON snapshots into one deterministic trend report (PAPER ONLY; per-run first/last-seen, present/valid/attention now, valid + attention streaks, digest-change count; reuses the Sprint 19 diff for since-baseline/since-previous change + conservative regression; reads the named files only, writes nothing)",
  )
  .option(
    "--index <path>",
    "campaign index JSON snapshot (repeatable; oldest first, latest last)",
    (value: string, previous: string[]) => previous.concat(value),
    [] as string[],
  )
  .option("--baseline <ref>", 'since-baseline reference: "first" (default), "previous", or a supplied --index path')
  .option("--json", "emit the history report as stable JSON")
  .option("--fail-on-change", "exit non-zero when there is any change since baseline")
  .option("--fail-on-regression", "exit non-zero only on a conservative integrity regression since baseline")
  .option("--fail-on-attention", "exit non-zero when any run currently needs attention")
  .option("--fail-on-new-attention", "exit non-zero when any run newly needs attention since baseline")
  .action(
    (opts: {
      index?: string[];
      baseline?: string;
      json?: boolean;
      failOnChange?: boolean;
      failOnRegression?: boolean;
      failOnAttention?: boolean;
      failOnNewAttention?: boolean;
    }) => {
      const { text, exitCode } = paperBacktestResearchHistoryReport(
        {},
        {
          indexPaths: opts.index ?? [],
          baseline: opts.baseline,
          json: Boolean(opts.json),
          failOnChange: Boolean(opts.failOnChange),
          failOnRegression: Boolean(opts.failOnRegression),
          failOnAttention: Boolean(opts.failOnAttention),
          failOnNewAttention: Boolean(opts.failOnNewAttention),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:backtest:research:portfolio")
  .description(
    "Roll up MANY campaign history report JSON files into one deterministic integrity-triage portfolio report (PAPER ONLY; per-campaign change/attention/regression carried verbatim, integrity-triage ordering, clean/stable lists, top concerns, summed run totals, CI decision; reads the named files only, writes nothing)",
  )
  .option(
    "--history <campaignId=path>",
    "campaign history report JSON, keyed by a campaign id (repeatable)",
    (value: string, previous: string[]) => previous.concat(value),
    [] as string[],
  )
  .option("--json", "emit the portfolio report as stable JSON")
  .option("--fail-on-change", "exit non-zero when any campaign changed since baseline")
  .option("--fail-on-regression", "exit non-zero only on a conservative integrity regression in any campaign")
  .option("--fail-on-attention", "exit non-zero when any campaign currently needs attention")
  .option("--fail-on-new-attention", "exit non-zero when any campaign newly needs attention since baseline")
  .action(
    (opts: {
      history?: string[];
      json?: boolean;
      failOnChange?: boolean;
      failOnRegression?: boolean;
      failOnAttention?: boolean;
      failOnNewAttention?: boolean;
    }) => {
      const { text, exitCode } = paperBacktestResearchPortfolioReport(
        {},
        {
          histories: opts.history ?? [],
          json: Boolean(opts.json),
          failOnChange: Boolean(opts.failOnChange),
          failOnRegression: Boolean(opts.failOnRegression),
          failOnAttention: Boolean(opts.failOnAttention),
          failOnNewAttention: Boolean(opts.failOnNewAttention),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:backtest:diff:research:portfolio")
  .description(
    "Deterministically diff TWO portfolio report JSON files (PAPER ONLY; pairs campaigns by campaignId → added/removed campaigns + per-campaign status/flag/count changes over the common set; conservative newly-regressed / recovered / newly-attention transitions + aggregate count deltas; a conservative regression flag distinct from any change; reads two files, writes nothing)",
  )
  .option("--base <path>", "BASE portfolio report JSON (the reference)")
  .option("--next <path>", "NEXT portfolio report JSON (compared against base)")
  .option("--json", "emit the portfolio diff as stable JSON")
  .option("--fail-on-change", "exit non-zero when the diff reports any change")
  .option("--fail-on-regression", "exit non-zero only on a conservative integrity regression (a common campaign newly regressed)")
  .option("--fail-on-attention", "exit non-zero when current attention newly appeared on a common campaign")
  .option("--fail-on-new-attention", "exit non-zero when newly-needed-since-baseline attention newly appeared on a common campaign")
  .action(
    (opts: {
      base?: string;
      next?: string;
      json?: boolean;
      failOnChange?: boolean;
      failOnRegression?: boolean;
      failOnAttention?: boolean;
      failOnNewAttention?: boolean;
    }) => {
      const { text, exitCode } = paperBacktestDiffResearchPortfolioReport(
        {},
        {
          basePath: opts.base,
          nextPath: opts.next,
          json: Boolean(opts.json),
          failOnChange: Boolean(opts.failOnChange),
          failOnRegression: Boolean(opts.failOnRegression),
          failOnAttention: Boolean(opts.failOnAttention),
          failOnNewAttention: Boolean(opts.failOnNewAttention),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:backtest:research:pack")
  .description(
    "Collect MANY local research artifact JSON files into one navigable integrity + navigation summary (PAPER ONLY; each --artifact label=path is classified by schemaVersion, a known artifact is strictly validated + summarized, an unknown schema is reported as unsupported; per-artifact kind/status/flags, aggregate counts, chain coverage, CI decision; `backtest.research.artifact.pack.v1`; reads the named files only, writes nothing unless --out)",
  )
  .option(
    "--artifact <label=path>",
    "research artifact JSON, keyed by a label (repeatable)",
    (value: string, previous: string[]) => previous.concat(value),
    [] as string[],
  )
  .option("--json", "emit the artifact pack as stable JSON")
  .option("--fail-on-change", "exit non-zero when any artifact reports a change")
  .option("--fail-on-regression", "exit non-zero only on a conservative integrity regression in any artifact")
  .option("--fail-on-attention", "exit non-zero when any artifact reports current attention")
  .option("--fail-on-new-attention", "exit non-zero when any artifact reports newly-needed attention")
  .option("--fail-on-unsupported", "exit non-zero when any artifact has an unsupported schema")
  .option("--fail-on-missing-recommended-layer", "exit non-zero when a recommended chain layer is missing")
  .option("--out <path>", "write ONLY the pack JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .action(
    (opts: {
      artifact?: string[];
      json?: boolean;
      failOnChange?: boolean;
      failOnRegression?: boolean;
      failOnAttention?: boolean;
      failOnNewAttention?: boolean;
      failOnUnsupported?: boolean;
      failOnMissingRecommendedLayer?: boolean;
      out?: string;
      force?: boolean;
    }) => {
      const { text, exitCode } = paperBacktestResearchPackReport(
        {},
        {
          artifacts: opts.artifact ?? [],
          json: Boolean(opts.json),
          failOnChange: Boolean(opts.failOnChange),
          failOnRegression: Boolean(opts.failOnRegression),
          failOnAttention: Boolean(opts.failOnAttention),
          failOnNewAttention: Boolean(opts.failOnNewAttention),
          failOnUnsupported: Boolean(opts.failOnUnsupported),
          failOnMissingRecommendedLayer: Boolean(opts.failOnMissingRecommendedLayer),
          outPath: opts.out,
          force: Boolean(opts.force),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:backtest:diff:research:pack")
  .description(
    "Deterministically diff TWO artifact pack JSON files (PAPER ONLY; pairs artifacts by label → added/removed artifacts + per-artifact kind/status/flag changes over the common set; conservative newly-regressed / recovered / newly-attention / newly-unsupported transitions + aggregate count deltas + chain-coverage changes; a conservative regression flag distinct from any change; `backtest.research.artifact.pack.diff.v1`; reads two files, writes nothing)",
  )
  .option("--base <path>", "BASE artifact pack JSON (the reference)")
  .option("--next <path>", "NEXT artifact pack JSON (compared against base)")
  .option("--json", "emit the pack diff as stable JSON")
  .option("--fail-on-change", "exit non-zero when the diff reports any change")
  .option("--fail-on-regression", "exit non-zero only on a conservative integrity regression (a common artifact newly regressed)")
  .option("--fail-on-attention", "exit non-zero when current attention newly appeared on a common artifact")
  .option("--fail-on-new-attention", "exit non-zero when new-attention newly appeared on a common artifact")
  .option("--fail-on-unsupported", "exit non-zero when an unsupported artifact is newly present (common lost recognition or added unsupported)")
  .action(
    (opts: {
      base?: string;
      next?: string;
      json?: boolean;
      failOnChange?: boolean;
      failOnRegression?: boolean;
      failOnAttention?: boolean;
      failOnNewAttention?: boolean;
      failOnUnsupported?: boolean;
    }) => {
      const { text, exitCode } = paperBacktestDiffResearchPackReport(
        {},
        {
          basePath: opts.base,
          nextPath: opts.next,
          json: Boolean(opts.json),
          failOnChange: Boolean(opts.failOnChange),
          failOnRegression: Boolean(opts.failOnRegression),
          failOnAttention: Boolean(opts.failOnAttention),
          failOnNewAttention: Boolean(opts.failOnNewAttention),
          failOnUnsupported: Boolean(opts.failOnUnsupported),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:sniper:candidates:validate")
  .description(
    "Validate + normalize a LOCAL sniper candidate list (PAPER ONLY; operator intake): every mint is validated as a 32-byte Solana public key (secret-length / private-key-like input is REFUSED), candidate ids must be unique, duplicate mints are surfaced as warnings; accepts operator-friendly raw input or a canonical `sniper.candidate.list.v1`; reads the named file only, writes nothing, no network/RPC/wallet — intake validation, NOT a trade signal or a verified on-chain fact",
  )
  .option("--input <path>", "candidate list JSON (operator intake)")
  .option("--json", "emit the normalized candidate list as stable JSON")
  .option("--fail-on-warning", "exit non-zero when the normalized list carries any warning (e.g. duplicate mints)")
  .action(
    (opts: { input?: string; json?: boolean; failOnWarning?: boolean }) => {
      const { text, exitCode } = paperSniperCandidatesValidateReport(
        {},
        {
          inputPath: opts.input,
          json: Boolean(opts.json),
          failOnWarning: Boolean(opts.failOnWarning),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:sniper:preflight")
  .description(
    "Build a PAPER-only token preflight summary over a LOCAL candidate list + already-loaded read-only inspection (token:inspect output) and advisory risk (token:risk output) JSON files (`sniper.token.preflight.report.v1`). Per candidate: pass / warn / fail / unknown with warnings + disqualifiers (risk REJECT or a critical flag = fail; CAUTION / freeze or mint authority / high flag = warn; no data = unknown). LOCAL-ONLY: NO RPC, NO network, NO wallet. Reads the named files only, writes nothing unless --out. A safety/research preflight — NOT a trade signal",
  )
  .option("--candidates <path>", "candidate list JSON")
  .option(
    "--inspection <candidateId=path>",
    "read-only mint inspection JSON for a candidate (token:inspect output; repeatable)",
    (value: string, previous: string[]) => previous.concat(value),
    [] as string[],
  )
  .option(
    "--risk <candidateId=path>",
    "advisory risk report JSON for a candidate (token:risk output; repeatable)",
    (value: string, previous: string[]) => previous.concat(value),
    [] as string[],
  )
  .option("--preflight-input <path>", "validated preflight input artifact (sniper.preflight.input.v1; mutually exclusive with --inspection/--risk)")
  .option("--json", "emit the preflight report as stable JSON")
  .option("--out <path>", "write ONLY the preflight report JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-fail", "exit non-zero when any candidate failed preflight")
  .option("--fail-on-warning", "exit non-zero when any candidate has a preflight warning")
  .action(
    (opts: {
      candidates?: string;
      inspection?: string[];
      risk?: string[];
      preflightInput?: string;
      json?: boolean;
      out?: string;
      force?: boolean;
      failOnFail?: boolean;
      failOnWarning?: boolean;
    }) => {
      const { text, exitCode } = paperSniperPreflightReport(
        {},
        {
          candidatesPath: opts.candidates,
          inspections: opts.inspection ?? [],
          risks: opts.risk ?? [],
          preflightInputPath: opts.preflightInput,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnFail: Boolean(opts.failOnFail),
          failOnWarning: Boolean(opts.failOnWarning),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:sniper:preflight:input:validate")
  .description(
    "Validate + normalize a LOCAL sniper preflight INPUT artifact (`sniper.preflight.input.v1`): per-candidate, already-loaded token:inspect / token:risk shaped values, projected with the SAME logic paper:sniper:preflight uses, so an unsupported shape / missing section / mint mismatch surfaces HERE instead of silently mid-preflight. Mints are validated as 32-byte public keys (secret-length input is REFUSED, never echoed). --candidates optionally CROSS-CHECKS entries against the list (unknown candidateId or disagreeing mint = refusal; uncovered candidates = warning). LOCAL-ONLY: fetches nothing, verifies NO on-chain fact. Reads the named files only, writes nothing, no network/RPC/wallet",
  )
  .option("--input <path>", "preflight input JSON (raw operator input or a canonical artifact)")
  .option("--candidates <path>", "candidate list JSON to cross-check entries against (optional)")
  .option("--json", "emit the normalized canonical preflight input artifact as stable JSON")
  .option("--fail-on-warning", "exit non-zero when the validated artifact carries any warning")
  .option("--fail-on-missing-risk", "exit non-zero when any entry has no usable risk report")
  .option("--fail-on-missing-inspection", "exit non-zero when any entry has no usable inspection")
  .action(
    (opts: {
      input?: string;
      candidates?: string;
      json?: boolean;
      failOnWarning?: boolean;
      failOnMissingRisk?: boolean;
      failOnMissingInspection?: boolean;
    }) => {
      const { text, exitCode } = paperSniperPreflightInputValidateReport(
        {},
        {
          inputPath: opts.input,
          candidatesPath: opts.candidates,
          json: Boolean(opts.json),
          failOnWarning: Boolean(opts.failOnWarning),
          failOnMissingRisk: Boolean(opts.failOnMissingRisk),
          failOnMissingInspection: Boolean(opts.failOnMissingInspection),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:sniper:preflight:input:prepare")
  .description(
    "BRIDGE read-only intelligence into the PAPER dry-run: pair standalone token:inspect --json / token:risk --json output files to a candidate list BY MINT and emit the canonical preflight input artifact (sniper.preflight.input.v1) that paper:sniper:dry-run consumes via --preflight-input. Raw values are carried VERBATIM; a candidate without data stays honestly uncovered (warned, never marked safe); malformed, cross-kind, unknown-mint, duplicate, or secret-shaped files are REFUSED. LOCAL-ONLY: no RPC, no network, no wallet — nothing here verifies an on-chain fact",
  )
  .option("--candidates <path>", "candidate list JSON to pair against (required)")
  .option(
    "--inspect <path>",
    "token:inspect --json output file (repeatable; matched to a candidate by mint)",
    (value: string, previous: string[]) => previous.concat(value),
    [] as string[],
  )
  .option(
    "--risk <path>",
    "token:risk --json output file (repeatable; matched to a candidate by mint)",
    (value: string, previous: string[]) => previous.concat(value),
    [] as string[],
  )
  .option("--source-label <label>", "operator label recorded on the produced artifact")
  .option("--json", "emit the canonical preflight input artifact as stable JSON")
  .option("--out <path>", "write ONLY the canonical preflight input JSON to this path (refused if it exists)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-warning", "exit non-zero when the produced artifact carries any warning")
  .option("--fail-on-missing-risk", "exit non-zero when any candidate has no usable risk report")
  .option("--fail-on-missing-inspection", "exit non-zero when any candidate has no usable inspection")
  .action(
    (opts: {
      candidates?: string;
      inspect: string[];
      risk: string[];
      sourceLabel?: string;
      json?: boolean;
      out?: string;
      force?: boolean;
      failOnWarning?: boolean;
      failOnMissingRisk?: boolean;
      failOnMissingInspection?: boolean;
    }) => {
      const { text, exitCode } = paperSniperPreflightInputPrepareReport(
        {},
        {
          candidatesPath: opts.candidates,
          inspectPaths: opts.inspect,
          riskPaths: opts.risk,
          sourceLabel: opts.sourceLabel,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnWarning: Boolean(opts.failOnWarning),
          failOnMissingRisk: Boolean(opts.failOnMissingRisk),
          failOnMissingInspection: Boolean(opts.failOnMissingInspection),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:routequote:prepare")
  .description(
    "BRIDGE read-only route-quote observations into the PAPER dry-run: pair operator-supplied quote observation files (routequote.observation.input.v1) to a candidate list BY MINT and emit the canonical prepared artifact (routequote.prepared.v1) that paper:sniper:dry-run consumes via --routequote and paper:simulation:route via --quotes. The outcome set is CLOSED (quote-observed | unavailable | blocked | error | unsupported — nothing here can mean executable); every observed quote carries the mandatory caveat set; a candidate without an observation stays honestly unavailable; malformed, cross-kind, unknown-mint, duplicate, or secret-shaped files are REFUSED. LOCAL-ONLY: no RPC, no network, no wallet — an observation proves a quote was visible at some point, never that one is executable",
  )
  .option("--candidates <path>", "candidate list JSON to pair against (required)")
  .option(
    "--quote <path>",
    "quote observation file (routequote.observation.input.v1; repeatable; matched to a candidate by mint)",
    (value: string, previous: string[]) => previous.concat(value),
    [] as string[],
  )
  .option("--source-label <label>", "operator label recorded on the produced artifact")
  .option("--json", "emit the canonical prepared routequote artifact as stable JSON")
  .option("--out <path>", "write ONLY the canonical prepared routequote JSON to this path (refused if it exists)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-warning", "exit non-zero when the produced artifact carries any warning")
  .option("--fail-on-missing-quote", "exit non-zero when any candidate has no quote observation at all")
  .option("--fail-on-not-observed", "exit non-zero when any candidate's quote was not observed (unavailable/blocked/error/unsupported)")
  .action(
    (opts: {
      candidates?: string;
      quote: string[];
      sourceLabel?: string;
      json?: boolean;
      out?: string;
      force?: boolean;
      failOnWarning?: boolean;
      failOnMissingQuote?: boolean;
      failOnNotObserved?: boolean;
    }) => {
      const { text, exitCode } = paperRouteQuotePrepareReport(
        {},
        {
          candidatesPath: opts.candidates,
          quotePaths: opts.quote,
          sourceLabel: opts.sourceLabel,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnWarning: Boolean(opts.failOnWarning),
          failOnMissingQuote: Boolean(opts.failOnMissingQuote),
          failOnNotObserved: Boolean(opts.failOnNotObserved),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:routequote:fetch")
  .description(
    "FETCH a REAL read-only quote per candidate from a public quote API (free Jupiter lite tier by default) and emit routequote.observation.input.v1 files + a freshness/provenance fetch report (routequote.fetch.report.v1). The outcome set is CLOSED (quote-observed | unavailable | blocked | error | unsupported — nothing here can mean executable); every observed quote carries the mandatory caveat set plus a REAL fetch timestamp, provider id, price impact, and truncated response digest. Network READ only: no wallet, no keys, no signing, no sending, no transaction construction — a quote is an observation, never an order, and can never unblock a blocked chain. PAPER mode requires --allow-paper-read",
  )
  .option("--candidates <path>", "candidate list JSON (required; each candidate mint is quoted as the swap OUTPUT)")
  .option("--input-mint <mint>", "swap INPUT mint (default: wrapped SOL So11111111111111111111111111111111111111112)")
  .option("--amount-raw <units>", "input amount in raw base units (integer; exactly one of --amount-raw/--amount-sol)")
  .option("--amount-sol <sol>", "input amount in SOL (decimal, up to 9 dp; converted to lamports)")
  .option("--slippage-bps <bps>", "slippage tolerance in basis points (default 50)")
  .option("--endpoint <url>", "override the provider base URL (default: the free Jupiter lite endpoint)")
  .option("--timeout-ms <ms>", "per-request timeout in milliseconds (default 10000)")
  .option("--allow-paper-read", "explicitly allow this read-only network fetch while in PAPER mode")
  .option("--out-dir <dir>", "write quote.<candidateId>.json per distinct mint + fetch-report.json into this EXISTING directory (existing files refused)")
  .option("--force", "overwrite existing output files (refused by default)")
  .option("--json", "emit the fetch report as stable JSON")
  .option("--fail-on-not-observed", "exit non-zero when any candidate's quote was not observed")
  .action(
    async (opts: {
      candidates?: string;
      inputMint?: string;
      amountRaw?: string;
      amountSol?: string;
      slippageBps?: string;
      endpoint?: string;
      timeoutMs?: string;
      allowPaperRead?: boolean;
      outDir?: string;
      force?: boolean;
      json?: boolean;
      failOnNotObserved?: boolean;
    }) => {
      const { text, exitCode } = await paperRouteQuoteFetchReport(
        {},
        {
          candidatesPath: opts.candidates,
          inputMint: opts.inputMint,
          amountRaw: opts.amountRaw,
          amountSol: opts.amountSol,
          slippageBps: opts.slippageBps,
          endpoint: opts.endpoint,
          timeoutMs: opts.timeoutMs,
          allowPaperRead: Boolean(opts.allowPaperRead),
          outDir: opts.outDir,
          force: Boolean(opts.force),
          json: Boolean(opts.json),
          failOnNotObserved: Boolean(opts.failOnNotObserved),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:realtime:snapshot")
  .description(
    "ONE poll of a real-time candidate source — the public Jupiter recent-tokens feed (live) or a local replay file — folded into a realtime.candidates.snapshot.v1 artifact plus a ready-to-use canonical sniper.candidate.list.v1. Watching is READ-ONLY observation: no wallet, no keys, no signing, no sending, no order — market figures are provider-reported HINTS, replay data is always labeled replay, and the output feeds the existing PAPER intake. PAPER mode requires --allow-paper-read for the live source. S98: --engine rust normalizes a replay file through the Rust sidecar (strictly validated; byte-identical snapshot)",
  )
  .option("--source <id>", 'candidate source: "jupiter-recent" (live, default) or "replay" (local file)')
  .option("--replay-file <path>", 'replay events JSON ({ events: [{ mint, ... }] }; required for --source replay)')
  .option("--engine <id>", 'normalizer: "ts" (default) or "rust" (S98 sidecar hot path; --source replay only; honest refusal when no Rust engine exists)')
  .option("--limit <n>", "keep at most this many observations (default 25, max 50)")
  .option("--min-liquidity-usd <usd>", "drop observations whose liquidity HINT is missing or below this")
  .option("--endpoint <url>", "override the live feed base URL")
  .option("--timeout-ms <ms>", "per-request timeout in milliseconds (default 10000)")
  .option("--allow-paper-read", "explicitly allow the live network read while in PAPER mode")
  .option("--out-dir <dir>", "write snapshot.json + candidates.json into this EXISTING directory (existing files refused)")
  .option("--force", "overwrite existing output files (refused by default)")
  .option("--json", "emit the snapshot artifact as stable JSON")
  .option("--fail-on-not-observed", "exit non-zero when the poll did not observe")
  .action(
    async (opts: {
      source?: string;
      replayFile?: string;
      engine?: string;
      limit?: string;
      minLiquidityUsd?: string;
      endpoint?: string;
      timeoutMs?: string;
      allowPaperRead?: boolean;
      outDir?: string;
      force?: boolean;
      json?: boolean;
      failOnNotObserved?: boolean;
    }) => {
      const { text, exitCode } = await paperRealtimeSnapshotReport(
        {},
        {
          source: opts.source,
          replayFile: opts.replayFile,
          engine: opts.engine,
          limit: opts.limit,
          minLiquidityUsd: opts.minLiquidityUsd,
          endpoint: opts.endpoint,
          timeoutMs: opts.timeoutMs,
          allowPaperRead: Boolean(opts.allowPaperRead),
          outDir: opts.outDir,
          force: Boolean(opts.force),
          json: Boolean(opts.json),
          failOnNotObserved: Boolean(opts.failOnNotObserved),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:realtime:watch")
  .description(
    "A BOUNDED sequence of real-time candidate polls (never an infinite loop; --polls is required, max 120) appending one JSONL line per poll to an explicit journal — interrupt-safe: every line is flushed as it happens. New mints are deduplicated across the watch. Watching is READ-ONLY observation and can never trigger an order: no wallet, no keys, no signing, no sending. PAPER mode requires --allow-paper-read for the live source",
  )
  .option("--source <id>", 'candidate source: "jupiter-recent" (live, default) or "replay" (local file)')
  .option("--replay-file <path>", "replay events JSON (required for --source replay)")
  .option("--polls <n>", "REQUIRED number of polls (1..120 — the watch is always bounded)")
  .option("--interval-ms <ms>", "milliseconds between polls (default 5000, min 1000)")
  .option("--journal <path>", "REQUIRED JSONL journal path (appended per poll)")
  .option("--limit <n>", "keep at most this many observations per poll (default 25, max 50)")
  .option("--min-liquidity-usd <usd>", "drop observations whose liquidity HINT is missing or below this")
  .option("--endpoint <url>", "override the live feed base URL")
  .option("--timeout-ms <ms>", "per-request timeout in milliseconds (default 10000)")
  .option("--allow-paper-read", "explicitly allow the live network read while in PAPER mode")
  .option("--json", "emit the watch summary as stable JSON")
  .action(
    async (opts: {
      source?: string;
      replayFile?: string;
      polls?: string;
      intervalMs?: string;
      journal?: string;
      limit?: string;
      minLiquidityUsd?: string;
      endpoint?: string;
      timeoutMs?: string;
      allowPaperRead?: boolean;
      json?: boolean;
    }) => {
      const { text, exitCode } = await paperRealtimeWatchReport(
        {},
        {
          source: opts.source,
          replayFile: opts.replayFile,
          polls: opts.polls,
          intervalMs: opts.intervalMs,
          journal: opts.journal,
          limit: opts.limit,
          minLiquidityUsd: opts.minLiquidityUsd,
          endpoint: opts.endpoint,
          timeoutMs: opts.timeoutMs,
          allowPaperRead: Boolean(opts.allowPaperRead),
          json: Boolean(opts.json),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:sniper:decide")
  .description(
    "Produce a PAPER-only per-candidate decision report from a LOCAL candidate list + an optional preflight + optional operator rules (`sniper.paper.decision.report.v1`, or `.v2` with --schema-version v2 for stable machine-readable reason codes). Each candidate gets a SIMULATED skip / watch / paper-enter / paper-reject / unknown with reasons (denylist or invalid mint = skip; preflight fail or risk-score-over-cap = paper-reject; preflight warn / unknown / no preflight / low liquidity = watch; preflight pass + all rules = paper-enter). A paper-enter is a paper-only decision — NOT a buy/sell order, NOT a transaction, NOT live readiness. Reads the named files only, writes nothing unless --out. No network, no wallet",
  )
  .option("--candidates <path>", "candidate list JSON")
  .option("--preflight <path>", "preflight report JSON (sniper.token.preflight.report.v1)")
  .option("--rules <path>", "decision rules JSON (requirePreflightPass / maxRiskScore / minObservedLiquidityUsd / denyMints)")
  .option("--policy <path>", "policy config JSON (sniper.policy.config.v1; tighten-only; mutually exclusive with --rules)")
  .option("--schema-version <version>", "decision report schema to produce: v1 (default) or v2 (adds structured reason codes)")
  .option("--json", "emit the decision report as stable JSON")
  .option("--out <path>", "write ONLY the decision report JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-paper-enter", "exit non-zero when any candidate would paper-enter")
  .option("--fail-on-risk", "exit non-zero when any candidate was paper-rejected on risk")
  .action(
    (opts: {
      candidates?: string;
      preflight?: string;
      rules?: string;
      policy?: string;
      schemaVersion?: string;
      json?: boolean;
      out?: string;
      force?: boolean;
      failOnPaperEnter?: boolean;
      failOnRisk?: boolean;
    }) => {
      const { text, exitCode } = paperSniperDecideReport(
        {},
        {
          candidatesPath: opts.candidates,
          preflightPath: opts.preflight,
          rulesPath: opts.rules,
          policyPath: opts.policy,
          schemaVersion: opts.schemaVersion,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnPaperEnter: Boolean(opts.failOnPaperEnter),
          failOnRisk: Boolean(opts.failOnRisk),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:sniper:workflow")
  .description(
    "Operator helper: print the recommended LOCAL, PAPER-only sniper command sequence (intake -> preflight -> decide) and where you are in it (`sniper.workflow.plan.v1`). For each supplied artifact path it checks existence + light validity (read-only) and emits each stage's status (done/ready/blocked/todo), its command, and the single recommended NEXT command. It DESCRIBES the sequence only — it executes no stage, runs no live action, makes no network call, and touches no wallet. Writes nothing",
  )
  .option("--candidates <path>", "candidate list JSON (optional)")
  .option("--preflight <path>", "preflight report JSON (optional)")
  .option("--decision <path>", "decision report JSON (optional)")
  .option("--json", "emit the workflow plan as stable JSON")
  .action((opts: { candidates?: string; preflight?: string; decision?: string; json?: boolean }) => {
    const { text, exitCode } = paperSniperWorkflowReport(
      {},
      {
        candidatesPath: opts.candidates,
        preflightPath: opts.preflight,
        decisionPath: opts.decision,
        json: Boolean(opts.json),
      },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("paper:sniper:report")
  .description(
    "Bundle a LOCAL candidate list + an optional preflight + an optional decision report + an optional workflow plan into one navigable PAPER-only run report (`sniper.run.report.v1`). Per-candidate reason trail (preflight status + simulated decision), grouped id lists (paper-enter / paper-reject / skip / watch / risk-blocked / missing-info / unknown / invalid), a navigation index, and a CI section. The candidate list is the spine; each sub-artifact is strictly validated and must reference only candidates in the list. Every status/decision is carried VERBATIM — nothing is re-derived. Reads the named files only, writes nothing unless --out. A paper-enter carried through is a SIMULATED classification — NOT a buy/sell order, NOT a transaction, NOT live readiness. No network, no wallet",
  )
  .option("--candidates <path>", "candidate list JSON")
  .option("--preflight <path>", "preflight report JSON (sniper.token.preflight.report.v1)")
  .option("--decisions <path>", "decision report JSON (sniper.paper.decision.report.v1, or .v2 with --schema-version v2)")
  .option("--workflow <path>", "workflow plan JSON (sniper.workflow.plan.v1)")
  .option("--preflight-input <path>", "preflight input artifact JSON (sniper.preflight.input.v1; requires --schema-version v2)")
  .option("--policy <path>", "policy config JSON (sniper.policy.config.v1|v2; requires --schema-version v2)")
  .option("--schema-version <version>", "run report schema to produce: v1 (default) or v2 (rollups/policy/coverage/blocking reasons)")
  .option("--operator <label>", "operator label echoed into the report (a string only)")
  .option("--json", "emit the run report as stable JSON")
  .option("--out <path>", "write ONLY the run report JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-invalid", "exit non-zero when any candidate reported an invalid mint")
  .option("--fail-on-preflight-fail", "exit non-zero when any candidate failed preflight")
  .option("--fail-on-risk", "exit non-zero when any candidate is blocked on risk")
  .option("--fail-on-paper-enter", "exit non-zero when any candidate carried a SIMULATED paper-enter")
  .option("--fail-on-unknown", "exit non-zero when any candidate could not be classified")
  .option("--fail-on-missing-recommended", "exit non-zero when a recommended artifact (preflight/decision) is absent")
  .option("--fail-on-blocking", "exit non-zero when any operator-blocking reason is present (v2 only)")
  .action(
    (opts: {
      candidates?: string;
      preflight?: string;
      decisions?: string;
      workflow?: string;
      preflightInput?: string;
      policy?: string;
      schemaVersion?: string;
      operator?: string;
      json?: boolean;
      out?: string;
      force?: boolean;
      failOnInvalid?: boolean;
      failOnPreflightFail?: boolean;
      failOnRisk?: boolean;
      failOnPaperEnter?: boolean;
      failOnUnknown?: boolean;
      failOnMissingRecommended?: boolean;
      failOnBlocking?: boolean;
    }) => {
      const { text, exitCode } = paperSniperReportReport(
        {},
        {
          candidatesPath: opts.candidates,
          preflightPath: opts.preflight,
          decisionsPath: opts.decisions,
          workflowPath: opts.workflow,
          preflightInputPath: opts.preflightInput,
          policyPath: opts.policy,
          schemaVersion: opts.schemaVersion,
          operatorLabel: opts.operator,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnInvalid: Boolean(opts.failOnInvalid),
          failOnPreflightFail: Boolean(opts.failOnPreflightFail),
          failOnRisk: Boolean(opts.failOnRisk),
          failOnPaperEnter: Boolean(opts.failOnPaperEnter),
          failOnUnknown: Boolean(opts.failOnUnknown),
          failOnMissingRecommended: Boolean(opts.failOnMissingRecommended),
          failOnBlocking: Boolean(opts.failOnBlocking),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:sniper:diff:report")
  .description(
    "Deterministically diff TWO existing sniper run report JSON files (`sniper.run.report.diff.v1`, or `.v2` with --schema-version v2). Reads ONLY the two named files (BOM-tolerant; malformed/wrong-schema refused), runs no report, and writes nothing. Pairs candidates by id and reports membership changes (added / removed / common), per-candidate decision + preflight-status transitions, conservative directional flags (new invalid / preflight-fail / risk-block / paper-enter / unknown / recovery), and aggregate deltas. V2 compares two v2 run reports: the v1 core is computed by the unchanged v1 differ, then the v2 layers are compared structured-field-only (policy visibility + the structured policy/decision mismatch, preflight-input coverage, unresolved unknowns, operator-blocking reasons VERBATIM, reason-code rollup deltas, per-candidate code trails). A paper-enter transition is a change between two SIMULATED, paper-only classifications — never a buy/sell order. No network, no wallet",
  )
  .option("--base <path>", "base run report JSON (sniper.run.report.v1, or .v2 with --schema-version v2)")
  .option("--next <path>", "next run report JSON (sniper.run.report.v1, or .v2 with --schema-version v2)")
  .option("--schema-version <version>", "diff schema to produce: v1 (default; two v1 reports) or v2 (two v2 reports + v2 layers)")
  .option("--json", "emit the run report diff as stable JSON")
  .option("--fail-on-change", "exit non-zero on any difference (v2: any v1-core OR v2-layer difference)")
  .option("--fail-on-new-invalid", "exit non-zero when any candidate became invalid")
  .option("--fail-on-new-preflight-fail", "exit non-zero when any candidate newly failed preflight")
  .option("--fail-on-new-risk", "exit non-zero when any candidate became risk-blocked")
  .option("--fail-on-new-paper-enter", "exit non-zero when any candidate newly paper-enters (SIMULATED)")
  .option("--fail-on-new-unknown", "exit non-zero when any candidate became unknown")
  .option("--fail-on-new-operator-blocking", "exit non-zero when a NEW operator-blocking condition appeared (requires --schema-version v2)")
  .action(
    (opts: {
      base?: string;
      next?: string;
      schemaVersion?: string;
      json?: boolean;
      failOnChange?: boolean;
      failOnNewInvalid?: boolean;
      failOnNewPreflightFail?: boolean;
      failOnNewRisk?: boolean;
      failOnNewPaperEnter?: boolean;
      failOnNewUnknown?: boolean;
      failOnNewOperatorBlocking?: boolean;
    }) => {
      const { text, exitCode } = paperSniperDiffReportReport(
        {},
        {
          basePath: opts.base,
          nextPath: opts.next,
          schemaVersion: opts.schemaVersion,
          json: Boolean(opts.json),
          failOnChange: Boolean(opts.failOnChange),
          failOnNewInvalid: Boolean(opts.failOnNewInvalid),
          failOnNewPreflightFail: Boolean(opts.failOnNewPreflightFail),
          failOnNewRisk: Boolean(opts.failOnNewRisk),
          failOnNewPaperEnter: Boolean(opts.failOnNewPaperEnter),
          failOnNewUnknown: Boolean(opts.failOnNewUnknown),
          failOnNewOperatorBlocking: Boolean(opts.failOnNewOperatorBlocking),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:sniper:policy:validate")
  .description(
    "Validate + normalize a LOCAL sniper policy config (`sniper.policy.config.v1`, or `.v2` with --schema-version v2): base decision rules, tighten-only enforcement switches (allowPaperEnter / failClosedOnUnknownPreflight / failClosedOnMissingRisk / disallowedRiskFlags), candidate-list guards (maxCandidatesPerRun / duplicateMintPolicy), operator labels, and paper sizing assumptions (LABELS / simulated units only — no currency / profit claims). V2 adds an explicit policyMode (conservative / balanced-paper / research-only; contradictions REFUSED) and reason-code-aware riskLimits; a canonical v1 input is upgraded losslessly. Conservative by default; a policy enables NO live behaviour. Accepts operator-friendly raw input or a canonical config; reads the named file only, writes nothing, no network/RPC/wallet",
  )
  .option("--input <path>", "policy config JSON (operator-friendly raw input or a canonical config)")
  .option("--schema-version <version>", "policy schema to produce: v1 (default) or v2 (mode + risk limits; a canonical v1 is upgraded)")
  .option("--json", "emit the normalized canonical policy config as stable JSON")
  .option("--fail-on-warning", "exit non-zero when the normalized policy carries any warning")
  .action((opts: { input?: string; schemaVersion?: string; json?: boolean; failOnWarning?: boolean }) => {
    const { text, exitCode } = paperSniperPolicyValidateReport(
      {},
      { inputPath: opts.input, schemaVersion: opts.schemaVersion, json: Boolean(opts.json), failOnWarning: Boolean(opts.failOnWarning) },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("paper:sniper:audit")
  .description(
    "Build a deterministic local AUDIT LOG (`sniper.audit.log.v1`) from a LOCAL run report (`sniper.run.report.v1`): one entry per pipeline step (intake -> preflight -> decide -> report) with input/output artifact labels, a one-line decision summary, and the step's warnings + failures (read VERBATIM). It carries NO wall-clock time — --label is an operator-supplied string. Reads the named file only, writes nothing unless --out. Provenance over a SIMULATED run — NOT a live result, NOT an order. No network, no wallet",
  )
  .option("--report <path>", "run report JSON (sniper.run.report.v1)")
  .option("--label <string>", "operator-supplied run label (a string only — never system time)")
  .option(
    "--note <string>",
    "operator-supplied note (repeatable)",
    (value: string, previous: string[]) => previous.concat(value),
    [] as string[],
  )
  .option("--json", "emit the audit log as stable JSON")
  .option("--out <path>", "write ONLY the audit log JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-failure", "exit non-zero when any step recorded a failure")
  .option("--fail-on-warning", "exit non-zero when any step recorded a warning")
  .action(
    (opts: {
      report?: string;
      label?: string;
      note?: string[];
      json?: boolean;
      out?: string;
      force?: boolean;
      failOnFailure?: boolean;
      failOnWarning?: boolean;
    }) => {
      const { text, exitCode } = paperSniperAuditReport(
        {},
        {
          reportPath: opts.report,
          label: opts.label,
          notes: opts.note ?? [],
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnFailure: Boolean(opts.failOnFailure),
          failOnWarning: Boolean(opts.failOnWarning),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:sniper:session:pack")
  .description(
    "Bundle MANY local sniper artifact JSON files into one deterministic session pack (`sniper.session.pack.v1`). Each --artifact label=path is classified by its schemaVersion; a KNOWN sniper schema (candidate list / preflight / decision / workflow / run report / run report diff / policy config / audit log) is strictly validated and its flags read VERBATIM, while an UNKNOWN schema is surfaced honestly as `unsupported`. Coverage tiers describe PRESENCE only (which artifact kinds are present) — never completeness or trading readiness. Reads the named files only, writes nothing unless --out. No network, no wallet",
  )
  .option(
    "--artifact <label=path>",
    "sniper artifact JSON for the session (repeatable)",
    (value: string, previous: string[]) => previous.concat(value),
    [] as string[],
  )
  .option("--label <string>", "operator session label")
  .option("--schema-version <version>", "pack schema: v1 (default) or v2 (full v2 registry — preflight input, policy/decision/run-report/gates/prereq v2, kill-switch/secrets/burner specs)")
  .option("--json", "emit the session pack as stable JSON")
  .option("--out <path>", "write ONLY the session pack JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-risk", "exit non-zero when any artifact carries a risk block")
  .option("--fail-on-unknown", "exit non-zero when any artifact carries an unknown classification")
  .option("--fail-on-paper-enter", "exit non-zero when any artifact carries a SIMULATED paper-enter")
  .option("--fail-on-unsupported", "exit non-zero when any artifact has an unsupported schema")
  .option("--fail-on-not-adopted-spec", "v2 only: exit non-zero when any packed spec artifact is NOT adopted")
  .action(
    (opts: {
      artifact?: string[];
      label?: string;
      schemaVersion?: string;
      json?: boolean;
      out?: string;
      force?: boolean;
      failOnRisk?: boolean;
      failOnUnknown?: boolean;
      failOnPaperEnter?: boolean;
      failOnUnsupported?: boolean;
      failOnNotAdoptedSpec?: boolean;
    }) => {
      const { text, exitCode } = paperSniperSessionPackReport(
        {},
        {
          artifacts: opts.artifact ?? [],
          label: opts.label,
          schemaVersion: opts.schemaVersion,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnRisk: Boolean(opts.failOnRisk),
          failOnUnknown: Boolean(opts.failOnUnknown),
          failOnPaperEnter: Boolean(opts.failOnPaperEnter),
          failOnUnsupported: Boolean(opts.failOnUnsupported),
          failOnNotAdoptedSpec: Boolean(opts.failOnNotAdoptedSpec),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:sniper:safety:gates")
  .description(
    "Evaluate FAIL-CLOSED operator safety gates over a LOCAL session pack (`sniper.safety.gates.report.v1`): candidate list / decision / audit log present, no unsupported artifacts, and — gated by explicit operator allowances — no unknowns / risk blocks / SIMULATED paper-enters. Exits 1 when NOT ready (by default). Passing is LOCAL/PAPER readiness ONLY — NOT Phase 6 authorization (Phase 6/7 remain not started). Reads the named file only, writes nothing unless --out. No network, no wallet",
  )
  .option("--session <path>", "session pack JSON (sniper.session.pack.v1)")
  .option("--operator <label>", "operator label echoed into the report")
  .option("--allow-unknown", "v1 only: allow unknown classifications (downgrades that gate's fail to a warn)")
  .option("--allow-risk-block", "v1 only: allow risk blocks (downgrades that gate's fail to a warn)")
  .option("--allow-paper-enter", "v1 only: allow SIMULATED paper-enters (downgrades that gate's fail to a warn)")
  .option("--schema-version <version>", "gates schema: v1 (default; session-pack based) or v2 (artifact-direct, code-aware; the POLICY is the only allowance source)")
  .option("--candidates <path>", "v2 only: candidate list JSON")
  .option("--preflight-input <path>", "v2 only: preflight input artifact JSON (sniper.preflight.input.v1)")
  .option("--preflight <path>", "v2 only: preflight report JSON (sniper.token.preflight.report.v1)")
  .option("--policy <path>", "v2 only: policy config JSON (sniper.policy.config.v1|v2)")
  .option("--decisions <path>", "v2 only: decision report JSON (must be sniper.paper.decision.report.v2)")
  .option("--run-report <path>", "v2 only: run report JSON (must be sniper.run.report.v2)")
  .option("--audit <path>", "v2 only: audit log JSON (sniper.audit.log.v1)")
  .option("--json", "emit the safety gates report as stable JSON")
  .option("--out <path>", "write ONLY the gates report JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-warning", "also exit non-zero when any gate warned (even when ready)")
  .action(
    (opts: {
      session?: string;
      operator?: string;
      allowUnknown?: boolean;
      allowRiskBlock?: boolean;
      allowPaperEnter?: boolean;
      schemaVersion?: string;
      candidates?: string;
      preflightInput?: string;
      preflight?: string;
      policy?: string;
      decisions?: string;
      runReport?: string;
      audit?: string;
      json?: boolean;
      out?: string;
      force?: boolean;
      failOnWarning?: boolean;
    }) => {
      const { text, exitCode } = paperSniperSafetyGatesReport(
        {},
        {
          sessionPath: opts.session,
          operatorLabel: opts.operator,
          allowUnknown: Boolean(opts.allowUnknown),
          allowRiskBlock: Boolean(opts.allowRiskBlock),
          allowPaperEnter: Boolean(opts.allowPaperEnter),
          schemaVersion: opts.schemaVersion,
          candidatesPath: opts.candidates,
          preflightInputPath: opts.preflightInput,
          preflightPath: opts.preflight,
          policyPath: opts.policy,
          decisionsPath: opts.decisions,
          runReportPath: opts.runReport,
          auditPath: opts.audit,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnWarning: Boolean(opts.failOnWarning),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:sniper:kill-switch:spec")
  .description(
    "Build a machine-readable LOCAL kill-switch DESIGN artifact (`sniper.kill_switch.spec.v1`). It is NOT a kill switch: it performs no process control, exposes no live controls, and its stop-live placeholder mode is PERMANENTLY disabled (the validator refuses anything else). Carries the fixed modes (stop-paper-decisions / stop-simulation / stop-live-disabled-placeholder), required operator confirmations (an unconfirmable switch is refused), the actions a tripped switch must forbid, escalation notes, and audit + test requirements — all merged with conservative canonical baselines. An ADOPTED spec is a Phase-6 PREREQUISITE signal, never authorization. Reads the optional --input config only, writes nothing unless --out. No network, no wallet",
  )
  .option("--input <path>", "spec config JSON (operator-friendly raw input; optional)")
  .option("--operator <label>", "operator label (overrides the config's)")
  .option("--json", "emit the spec as stable JSON")
  .option("--out <path>", "write ONLY the spec JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-not-adopted", "exit non-zero while the spec is not ADOPTED")
  .action(
    (opts: { input?: string; operator?: string; json?: boolean; out?: string; force?: boolean; failOnNotAdopted?: boolean }) => {
      const { text, exitCode } = paperSniperKillSwitchSpecReport(
        {},
        {
          inputPath: opts.input,
          operatorLabel: opts.operator,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnNotAdopted: Boolean(opts.failOnNotAdopted),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:sniper:secrets:policy")
  .description(
    "Build a machine-readable LOCAL secrets policy (`sniper.secrets.policy.v1`). It stores NO secret: a secret-bearing key or a key-shaped value (long base58/hex, 12/24-word phrase) anywhere in the input is REFUSED without being echoed. The six core rules are CONSTANTS that cannot be configured off: forbid main wallet use, forbid seed phrase storage, forbid private key logging, require burner isolation for any FUTURE live work, require redaction, require an explicit dangerous opt-in for any FUTURE live capability. An ADOPTED policy is a Phase-6 PREREQUISITE signal, never authorization. Reads the optional --input config only, writes nothing unless --out. No network, no wallet",
  )
  .option("--input <path>", "policy config JSON (operator-friendly raw input; optional)")
  .option("--operator <label>", "operator label (overrides the config's)")
  .option("--json", "emit the policy as stable JSON")
  .option("--out <path>", "write ONLY the policy JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-not-adopted", "exit non-zero while the policy is not ADOPTED")
  .action(
    (opts: { input?: string; operator?: string; json?: boolean; out?: string; force?: boolean; failOnNotAdopted?: boolean }) => {
      const { text, exitCode } = paperSniperSecretsPolicyReport(
        {},
        {
          inputPath: opts.input,
          operatorLabel: opts.operator,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnNotAdopted: Boolean(opts.failOnNotAdopted),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:sniper:burner:isolation:spec")
  .description(
    "Build a machine-readable LOCAL burner isolation DESIGN artifact (`sniper.burner.isolation.spec.v1`). It is NOT a wallet: it creates no wallet, imports no wallet, and holds no key. Seven core principles are CONSTANTS that cannot be configured off: burner-only, main wallet permanently excluded, simulation required before any FUTURE send, redacted logging, explicit dangerous opt-in for any FUTURE live capability, human operator approval for every escalation, and creates-no-wallet. maxLossLabel must be a pure LABEL (digits/currency markers REFUSED — never an amount claim); killSwitchSpecRef pairs it with an adopted kill-switch spec. An ADOPTED spec is a Phase-6 PREREQUISITE signal, never authorization. Reads the optional --input config only, writes nothing unless --out. No network, no wallet",
  )
  .option("--input <path>", "spec config JSON (operator-friendly raw input; optional)")
  .option("--operator <label>", "operator label (overrides the config's)")
  .option("--json", "emit the spec as stable JSON")
  .option("--out <path>", "write ONLY the spec JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-not-adopted", "exit non-zero while the spec is not ADOPTED")
  .action(
    (opts: { input?: string; operator?: string; json?: boolean; out?: string; force?: boolean; failOnNotAdopted?: boolean }) => {
      const { text, exitCode } = paperSniperBurnerIsolationSpecReport(
        {},
        {
          inputPath: opts.input,
          operatorLabel: opts.operator,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnNotAdopted: Boolean(opts.failOnNotAdopted),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:phase6:prereqs")
  .description(
    "Turn the docs/PHASE_6_SIMULATION_BOUNDARY.md prerequisites into a machine-readable checklist (`phase6.prerequisite.report.v1`) from a LOCAL session pack. The five artifact prerequisites (candidate intake / preflight / paper decisions / operator config / audit logging) are derived from the session pack; the six design prerequisites are reported as documented. It implements NO transaction planning, carries no chain capability, and can NEVER authorize Phase 6 (phase6ImplementationStarted always false; requiresExplicitHumanApproval always true). Reads the named file only, writes nothing unless --out. No network, no wallet",
  )
  .option("--session <path>", "session pack JSON (sniper.session.pack.v1)")
  .option("--operator <label>", "operator label echoed into the report")
  .option("--schema-version <version>", "tracker schema: v1 (default; session-pack based) or v2 (explicit readiness buckets over the v2 artifacts; never authorizes)")
  .option("--policy <path>", "v2 only: policy config JSON (sniper.policy.config.v1|v2)")
  .option("--gates <path>", "v2 only: safety gates v2 report JSON")
  .option("--decisions <path>", "v2 only: decision report JSON (sniper.paper.decision.report.v2)")
  .option("--run-report <path>", "v2 only: run report JSON (sniper.run.report.v2)")
  .option("--audit <path>", "v2 only: audit log JSON (sniper.audit.log.v1)")
  .option("--kill-switch <path>", "v2 only: kill-switch spec JSON (sniper.kill_switch.spec.v1; must be ADOPTED to meet its bucket)")
  .option("--secrets-policy <path>", "v2 only: secrets policy JSON (sniper.secrets.policy.v1; must be ADOPTED to meet its bucket)")
  .option("--burner-isolation <path>", "v2 only: burner isolation spec JSON (sniper.burner.isolation.spec.v1; must be ADOPTED and kill-switch-paired)")
  .option("--json", "emit the prerequisite report as stable JSON")
  .option("--out <path>", "write ONLY the prerequisite report JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-unmet", "exit non-zero when readiness is not met (v1: artifact prereqs; v2: phase6ImplementationReady)")
  .action(
    (opts: {
      session?: string;
      operator?: string;
      schemaVersion?: string;
      policy?: string;
      gates?: string;
      decisions?: string;
      runReport?: string;
      audit?: string;
      killSwitch?: string;
      secretsPolicy?: string;
      burnerIsolation?: string;
      json?: boolean;
      out?: string;
      force?: boolean;
      failOnUnmet?: boolean;
    }) => {
      const { text, exitCode } = paperPhase6PrereqsReport(
        {},
        {
          sessionPath: opts.session,
          operatorLabel: opts.operator,
          schemaVersion: opts.schemaVersion,
          policyPath: opts.policy,
          gatesPath: opts.gates,
          decisionsPath: opts.decisions,
          runReportPath: opts.runReport,
          auditPath: opts.audit,
          killSwitchPath: opts.killSwitch,
          secretsPolicyPath: opts.secretsPolicy,
          burnerIsolationPath: opts.burnerIsolation,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnUnmet: Boolean(opts.failOnUnmet),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:phase6:intent:plan")
  .description(
    "Build an INERT, NOT-EXECUTABLE simulation intent plan (`simulation.intent.plan.v1`) from a LOCAL paper decision report. One inert DATA entry per SIMULATED paper-enter, each with a hypothetical side, an amount LABEL (never currency), reason codes, and the risk constraints / required operator approvals (ALL unsatisfied) / future simulation checks a Phase 6 simulator would need. `executable` is always false; it builds/signs/simulates/sends NOTHING and carries no chain capability. Reads the named file only, writes nothing unless --out. This is type-contract DATA only — Phase 6/7 remain not started. No network, no wallet",
  )
  .option("--decisions <path>", "decision report JSON (sniper.paper.decision.report.v1)")
  .option("--plan-label <string>", "plan label echoed into the plan")
  .option("--amount-label <string>", "amount LABEL applied to every entry (never currency)")
  .option("--amount-units <number>", "SIMULATED unit count applied to every entry (not currency)")
  .option("--json", "emit the inert simulation intent plan as stable JSON")
  .option("--out <path>", "write ONLY the inert plan JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .action(
    (opts: { decisions?: string; planLabel?: string; amountLabel?: string; amountUnits?: string; json?: boolean; out?: string; force?: boolean }) => {
      const { text, exitCode } = paperPhase6IntentPlanReport(
        {},
        {
          decisionsPath: opts.decisions,
          planLabel: opts.planLabel,
          amountLabel: opts.amountLabel,
          amountUnits: num(opts.amountUnits),
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:phase6:diff:intent")
  .description(
    "Deterministically diff TWO existing INERT simulation intent plan JSON files (`simulation.intent.plan.diff.v1`). Reads ONLY the two named files (BOM-tolerant; malformed/wrong-schema refused), runs no plan, and writes nothing. Pairs hypothetical entries by id (added / removed / common) and reports per-entry amount label/unit changes. Comparing two NOT-EXECUTABLE plans executes NOTHING; the diff's executable flag is always false. No network, no wallet",
  )
  .option("--base <path>", "base intent plan JSON (simulation.intent.plan.v1)")
  .option("--next <path>", "next intent plan JSON (simulation.intent.plan.v1)")
  .option("--json", "emit the intent plan diff as stable JSON")
  .option("--fail-on-change", "exit non-zero on any difference")
  .option("--fail-on-new-entry", "exit non-zero when any hypothetical entry was added")
  .action(
    (opts: { base?: string; next?: string; json?: boolean; failOnChange?: boolean; failOnNewEntry?: boolean }) => {
      const { text, exitCode } = paperPhase6DiffIntentReport(
        {},
        {
          basePath: opts.base,
          nextPath: opts.next,
          json: Boolean(opts.json),
          failOnChange: Boolean(opts.failOnChange),
          failOnNewEntry: Boolean(opts.failOnNewEntry),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:simulation:intent:plan")
  .description(
    "Build a `simulation.intent.plan.v2` — the first REAL Phase 6 artifact: a fail-closed SIMULATION PREVIEW over the strictly-validated v2 chain (decision v2 + READY safety gates v2 + phase6 prereqs v2) and the three ADOPTED governance specs. A missing/invalid/v1 artifact, not-ready gates, unmet prereqs, a non-adopted spec, or a declared stop-simulation kill switch produces a BLOCKED plan with stable reason codes (the blocked plan IS the honest artifact). Previews NEVER invent a destination/amount/fee — unsupplied values stay UNRESOLVED; amounts resolve only as the operator's paper-unit LABEL. The plan can never authorize live trading, never signs, never sends (literal locks, validated). Reads only the named files, writes nothing unless --out. No network, no wallet",
  )
  .option("--decisions <path>", "v2 decision report JSON (sniper.paper.decision.report.v2)")
  .option("--gates <path>", "v2 safety gates report JSON (sniper.safety.gates.report.v2)")
  .option("--prereqs <path>", "v2 phase6 prerequisite report JSON (phase6.prerequisite.report.v2)")
  .option("--kill-switch <path>", "kill-switch spec JSON (sniper.kill_switch.spec.v1; must be adopted)")
  .option("--secrets-policy <path>", "secrets policy JSON (sniper.secrets.policy.v1; must be adopted)")
  .option("--burner-isolation <path>", "burner isolation spec JSON (sniper.burner.isolation.spec.v1; must be adopted)")
  .option("--stop-simulation-tripped", "declare the stop-simulation kill switch TRIPPED (blocks the plan)")
  .option("--acknowledge-paper-enter-review", "EXPLICIT operator acknowledgment that the paper-enters were reviewed (covers ONLY the NO_OPERATOR_BLOCKING prereq item; loudly surfaced)")
  .option("--operator <label>", "operator label echoed into the plan")
  .option("--plan-label <label>", "plan label echoed into the plan")
  .option("--amount-label <label>", "paper-unit amount LABEL applied to every entry (never currency)")
  .option("--json", "emit the plan as stable JSON")
  .option("--out <path>", "write ONLY the plan JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-blocking", "exit non-zero when the plan is BLOCKED")
  .option("--fail-on-unresolved", "exit non-zero when any entry carries unresolved fields")
  .action(
    (opts: {
      decisions?: string; gates?: string; prereqs?: string; killSwitch?: string; secretsPolicy?: string;
      burnerIsolation?: string; stopSimulationTripped?: boolean; acknowledgePaperEnterReview?: boolean;
      operator?: string; planLabel?: string; amountLabel?: string; json?: boolean; out?: string; force?: boolean;
      failOnBlocking?: boolean; failOnUnresolved?: boolean;
    }) => {
      const { text, exitCode } = paperSimulationIntentPlanReport(
        {},
        {
          decisionsPath: opts.decisions,
          gatesPath: opts.gates,
          prereqsPath: opts.prereqs,
          killSwitchPath: opts.killSwitch,
          secretsPolicyPath: opts.secretsPolicy,
          burnerIsolationPath: opts.burnerIsolation,
          stopSimulationTripped: Boolean(opts.stopSimulationTripped),
          acknowledgePaperEnterReview: Boolean(opts.acknowledgePaperEnterReview),
          operatorLabel: opts.operator,
          planLabel: opts.planLabel,
          amountLabel: opts.amountLabel,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnBlocking: Boolean(opts.failOnBlocking),
          failOnUnresolved: Boolean(opts.failOnUnresolved),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:simulation:result")
  .description(
    "Build a `simulation.result.v1` from a named `simulation.intent.plan.v2` file using the package's honest UNAVAILABLE dry-run adapter — the ONLY adapter that exists: a real dry-run needs transaction material the simulation boundary forbids building, so it is reported UNAVAILABLE, never faked. The plan is strictly revalidated (an invalid plan refuses); unresolved previews are SKIPPED (nothing is simulated from invented values); a blocked plan or --stop-simulation-tripped produces a BLOCKED result. The result never claims chain inclusion, execution, trade success, or profit/loss, and can never authorize live trading (literal locks, validated). Reads only the named file, writes nothing unless --out. No network, no wallet",
  )
  .option("--plan <path>", "simulation intent plan JSON (simulation.intent.plan.v2; required)")
  .option("--stop-simulation-tripped", "declare the stop-simulation kill switch TRIPPED at result time (blocks the result)")
  .option("--json", "emit the result as stable JSON")
  .option("--out <path>", "write ONLY the result JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-blocked", "exit non-zero when the result is BLOCKED")
  .option("--fail-on-unresolved", "exit non-zero when any entry was skipped over unresolved previews")
  .option("--fail-on-dry-run-unavailable", "exit non-zero when the dry-run was unavailable")
  .action(
    (opts: {
      plan?: string; stopSimulationTripped?: boolean; json?: boolean; out?: string; force?: boolean;
      failOnBlocked?: boolean; failOnUnresolved?: boolean; failOnDryRunUnavailable?: boolean;
    }) => {
      const { text, exitCode } = paperSimulationResultReport(
        {},
        {
          planPath: opts.plan,
          stopSimulationTripped: Boolean(opts.stopSimulationTripped),
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnBlocked: Boolean(opts.failOnBlocked),
          failOnUnresolved: Boolean(opts.failOnUnresolved),
          failOnDryRunUnavailable: Boolean(opts.failOnDryRunUnavailable),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:simulation:route")
  .description(
    "Build a `simulation.route.resolution.v1` — the honest ROUTE-RESOLUTION PROVENANCE record over a named `simulation.intent.plan.v2`. Without --quotes every entry is honestly UNAVAILABLE under the fixed `unavailable-no-route-resolver` id (no route-resolution capability exists inside the simulation boundary): route, destination, and fee stay UNRESOLVED — never invented, never fetched, never typed in by hand. With --quotes (a routequote.prepared.v1 from paper:routequote:prepare) READ-ONLY quote observations enter as label facts with provenance and the mandatory live-state caveat — still never executable, and a quote that contradicts the plan REFUSES. A missing/invalid/blocked plan or a declared stop-simulation kill switch produces a BLOCKED artifact with stable reason codes (the blocked artifact IS the honest record; quotes never unblock it). This artifact is provenance only: not live trading, not a buy recommendation, not a transaction approval; it never signs, never sends, never executes. Reads only the named files, writes nothing unless --out. No network, no wallet",
  )
  .option("--plan <path>", "simulation intent plan JSON (simulation.intent.plan.v2; required)")
  .option("--quotes <path>", "prepared routequote JSON (routequote.prepared.v1 from paper:routequote:prepare): READ-ONLY quote observations carried in as label facts with provenance; contradictions with the plan REFUSE")
  .option("--stop-simulation-tripped", "declare the stop-simulation kill switch TRIPPED at resolution time (blocks the artifact)")
  .option("--operator <label>", "operator label echoed into the artifact")
  .option("--resolution-label <label>", "resolution label echoed into the artifact")
  .option("--json", "emit the route-resolution artifact as stable JSON")
  .option("--out <path>", "write ONLY the artifact JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-blocked", "exit non-zero when the artifact is BLOCKED")
  .option("--fail-on-unavailable", "exit non-zero when any entry is UNAVAILABLE (trips on every honest artifact until a quote source or separately-authorized resolver supplies facts)")
  .action(
    (opts: {
      plan?: string; quotes?: string; stopSimulationTripped?: boolean; operator?: string; resolutionLabel?: string;
      json?: boolean; out?: string; force?: boolean; failOnBlocked?: boolean; failOnUnavailable?: boolean;
    }) => {
      const { text, exitCode } = paperSimulationRouteReport(
        {},
        {
          planPath: opts.plan,
          quotesPath: opts.quotes,
          stopSimulationTripped: Boolean(opts.stopSimulationTripped),
          operatorLabel: opts.operator,
          resolutionLabel: opts.resolutionLabel,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnBlocked: Boolean(opts.failOnBlocked),
          failOnUnavailable: Boolean(opts.failOnUnavailable),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:simulation:bundle")
  .description(
    "Build a phase6.operator.bundle.v1 OPERATOR BUNDLE from the named chain artifact files (the twelve handoff roles plus the handoff pack itself). Each artifact is strictly validated in place and summarized from verbatim structured fields; a missing artifact is CLASSIFIED as missing, never invented; every named file gets a truncated sha256-128 integrity digest. The chain's blocking conditions are RECOMPUTED and cross-checked against the handoff pack's verbatim trail (a stale/tampered pack blocks the bundle), and the closed-set operator verdict can never be better than reviewable-paper-only. phase7LiveTradingReady is a literal false. Reads only the named files; writes nothing unless --out. SIMULATION ONLY: never signs, never sends, never authorizes live trading. No network, no wallet",
  )
  .option("--decisions <path>", "v2 decision report JSON")
  .option("--run-report <path>", "v2 run report JSON")
  .option("--gates <path>", "v2 safety gates report JSON")
  .option("--prereqs <path>", "v2 phase6 prerequisite report JSON")
  .option("--kill-switch <path>", "kill-switch spec JSON")
  .option("--secrets-policy <path>", "secrets policy JSON")
  .option("--burner-isolation <path>", "burner isolation spec JSON")
  .option("--intent-plan <path>", "simulation intent plan JSON (simulation.intent.plan.v2)")
  .option("--simulation-result <path>", "simulation result JSON (simulation.result.v1)")
  .option("--route <path>", "route-resolution artifact JSON (simulation.route.resolution.v1)")
  .option("--audit <path>", "phase6 audit report JSON (phase6.audit.report.v1)")
  .option("--readiness <path>", "phase6 readiness report JSON (phase6.simulation.readiness.report.v1)")
  .option("--handoff <path>", "phase6 handoff pack JSON (phase6.simulation.handoff.pack.v1)")
  .option("--operator <label>", "operator label echoed into the bundle")
  .option("--bundle-label <label>", "bundle label echoed into the bundle")
  .option("--json", "emit the operator bundle as stable JSON")
  .option("--out <path>", "write ONLY the bundle JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-blocked", "exit non-zero when the operator verdict is blocked")
  .option("--fail-on-incomplete", "exit non-zero when any bundled artifact is missing or invalid")
  .action(
    (opts: {
      decisions?: string; runReport?: string; gates?: string; prereqs?: string; killSwitch?: string;
      secretsPolicy?: string; burnerIsolation?: string; intentPlan?: string; simulationResult?: string;
      route?: string; audit?: string; readiness?: string; handoff?: string; operator?: string;
      bundleLabel?: string; json?: boolean; out?: string; force?: boolean;
      failOnBlocked?: boolean; failOnIncomplete?: boolean;
    }) => {
      const { text, exitCode } = paperSimulationBundleReport(
        {},
        {
          decisionsPath: opts.decisions,
          runReportPath: opts.runReport,
          gatesPath: opts.gates,
          prereqsPath: opts.prereqs,
          killSwitchPath: opts.killSwitch,
          secretsPolicyPath: opts.secretsPolicy,
          burnerIsolationPath: opts.burnerIsolation,
          intentPlanPath: opts.intentPlan,
          simulationResultPath: opts.simulationResult,
          routePath: opts.route,
          auditPath: opts.audit,
          readinessPath: opts.readiness,
          handoffPath: opts.handoff,
          operatorLabel: opts.operator,
          bundleLabel: opts.bundleLabel,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnBlocked: Boolean(opts.failOnBlocked),
          failOnIncomplete: Boolean(opts.failOnIncomplete),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:sniper:dry-run")
  .description(
    "Run the FULL PAPER dry-run pipeline over an operator-supplied candidate file and write the complete validated artifact set (candidates -> preflight -> policy -> v2 decision/run-report/gates/prereqs -> specs -> intent plan -> simulation result -> route resolution -> chain audit -> readiness -> handoff pack -> operator bundle -> RUN_SUMMARY.md) into ONE output directory. Route resolution is honestly all-UNAVAILABLE unless --routequote supplies READ-ONLY quote observations (label facts with provenance; live-state caveat; never executable) — nothing is ever invented. A BLOCKED chain still writes the full honest artifact set (exit 0; --fail-on-blocked gates). SIMULATION ONLY: it creates no live order, builds no transaction, touches no wallet, and reaches no network. Phase 7 (live trading) remains unauthorized",
  )
  .option("--candidates <path>", "candidate list JSON (raw operator input or sniper.candidate.list.v1; required)")
  .option("--preflight-input <path>", "preflight input JSON with per-candidate inspection/risk (sniper.preflight.input.v1)")
  .option("--routequote <path>", "prepared routequote JSON (routequote.prepared.v1 from paper:routequote:prepare): READ-ONLY quote observations carried into the route stage as label facts with provenance; omitted = the honest all-UNAVAILABLE boundary")
  .option("--policy <path>", "policy config JSON (v1 upgraded to v2; default: a fail-closed v2 policy)")
  .option("--kill-switch <path>", "existing kill-switch spec artifact JSON (built draft/adopted otherwise)")
  .option("--secrets-policy <path>", "existing secrets policy artifact JSON (built draft/adopted otherwise)")
  .option("--burner-isolation <path>", "existing burner isolation spec artifact JSON (built draft/adopted otherwise)")
  .option("--adopt-specs", "build the governance specs as ADOPTED for this run (requires --operator; DRAFT specs block the chain honestly otherwise)")
  .option("--acknowledge-paper-enter-review", "apply the narrow paper-enter-review operator acknowledgment to the intent plan")
  .option("--stop-simulation-tripped", "declare the stop-simulation kill switch TRIPPED (blocks the whole chain)")
  .option("--operator <label>", "operator label echoed through the chain")
  .option("--run-label <label>", "run label echoed into the plan/route/handoff/bundle artifacts")
  .option("--out <dir>", "output DIRECTORY for the full artifact set (created if missing; required)")
  .option("--force", "overwrite existing artifact files in the output directory (refused by default)")
  .option("--json", "emit the final operator bundle as stable JSON")
  .option("--fail-on-blocked", "exit non-zero when the final operator verdict is blocked")
  .action(
    (opts: {
      candidates?: string; preflightInput?: string; routequote?: string; policy?: string; killSwitch?: string;
      secretsPolicy?: string; burnerIsolation?: string; adoptSpecs?: boolean;
      acknowledgePaperEnterReview?: boolean; stopSimulationTripped?: boolean; operator?: string;
      runLabel?: string; out?: string; force?: boolean; json?: boolean; failOnBlocked?: boolean;
    }) => {
      const { text, exitCode } = paperSniperDryRunReport(
        {},
        {
          candidatesPath: opts.candidates,
          preflightInputPath: opts.preflightInput,
          routequotePath: opts.routequote,
          policyPath: opts.policy,
          killSwitchPath: opts.killSwitch,
          secretsPolicyPath: opts.secretsPolicy,
          burnerIsolationPath: opts.burnerIsolation,
          adoptSpecs: Boolean(opts.adoptSpecs),
          acknowledgePaperEnterReview: Boolean(opts.acknowledgePaperEnterReview),
          stopSimulationTripped: Boolean(opts.stopSimulationTripped),
          operatorLabel: opts.operator,
          runLabel: opts.runLabel,
          outDir: opts.out,
          force: Boolean(opts.force),
          json: Boolean(opts.json),
          failOnBlocked: Boolean(opts.failOnBlocked),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:sniper:rehearse")
  .description(
    "The UNIFIED sniper rehearsal workflow (Sprint 93): chain the existing production commands (candidates [file or realtime replay] -> risk bridge -> quote fetch -> quote prepare -> paper dry-run -> unsigned tx build -> real simulation -> optional devnet broadcast rehearsal -> mainnet readiness checklist) over ONE output directory with an honest per-stage record (sniper.rehearsal.report.v1). CLOSED mode set: paper (DEFAULT; fully offline) | devnet (broadcast only behind --devnet-send + the devnet double opt-in) | mainnet-dry-run (live quotes + build + simulate; structurally CANNOT send). There is NO mainnet-live mode — deliberately. Every skipped stage names its exact standalone command; a blocked chain exits 0 with the honest report (--fail-on-blocked gates)",
  )
  .option("--mode <mode>", "paper (default) | devnet | mainnet-dry-run — there is NO mainnet-live mode")
  .option("--candidates <path>", "candidate list JSON (exactly one of --candidates / --replay-file)")
  .option("--replay-file <path>", "realtime replay events JSON — candidates come from a replay snapshot")
  .option("--preflight-input <path>", "preflight input JSON with per-candidate inspection/risk (sniper.preflight.input.v1)")
  .option("--skip-auto-risk", "opt OUT of S94 automatic risk evidence (mainnet-dry-run fetches deep token:risk per candidate by default)")
  .option("--routequote <path>", "already-prepared routequote artifact (skips the fetch/prepare stages)")
  .option("--amount-sol <sol>", "quote/build input amount in SOL (default 0.01 for the quote probe)")
  .option("--slippage-bps <bps>", "explicit slippage tolerance for quote fetch + build")
  .option("--endpoint <url>", "override the quote/build provider base URL")
  .option("--max-quote-age-ms <ms>", "explicit quote-age cap for the build + readiness stages")
  .option("--build-wallet <publicKey>", "wallet PUBLIC key forwarded to the build stage (never a secret)")
  .option("--risk <path>", "token:risk --json report for the build target (building blind is refused)")
  .option("--max-spend-sol <sol>", "explicit per-trade spend cap for the build stage")
  .option("--slippage-cap-bps <bps>", "explicit slippage cap for the build stage")
  .option("--risk-score-cap <n>", "explicit advisory risk score cap for the build stage")
  .option("--devnet-send", "EXPLICIT opt-in to the devnet broadcast rehearsal (devnet mode only)")
  .option("--acknowledge-devnet-execution", "the explicit devnet acknowledgment flag (with the env flag)")
  .option("--rpc-url <url>", "RPC endpoint for the simulate/devnet stages")
  .option("--session-ledger <path>", "S96: session ledger path for the devnet stage (default runs/execution-sessions.jsonl)")
  .option("--adopt-specs", "build the dry-run governance specs as ADOPTED (requires --operator)")
  .option("--operator <label>", "operator label echoed through the dry-run chain")
  .option("--allow-paper-read", "explicitly allow network reads while in PAPER mode (quote fetch + simulation)")
  .option("--out <dir>", "output DIRECTORY for all stage artifacts (created if missing; required)")
  .option("--force", "overwrite existing artifacts in the output directory")
  .option("--json", "emit the rehearsal stage report as stable JSON")
  .option("--fail-on-blocked", "exit non-zero when any executed stage blocked or failed")
  .action(
    async (opts: {
      mode?: string;
      candidates?: string;
      replayFile?: string;
      preflightInput?: string;
      skipAutoRisk?: boolean;
      routequote?: string;
      amountSol?: string;
      slippageBps?: string;
      endpoint?: string;
      maxQuoteAgeMs?: string;
      buildWallet?: string;
      risk?: string;
      maxSpendSol?: string;
      slippageCapBps?: string;
      riskScoreCap?: string;
      devnetSend?: boolean;
      acknowledgeDevnetExecution?: boolean;
      rpcUrl?: string;
      sessionLedger?: string;
      adoptSpecs?: boolean;
      operator?: string;
      allowPaperRead?: boolean;
      out?: string;
      force?: boolean;
      json?: boolean;
      failOnBlocked?: boolean;
    }) => {
      const { text, exitCode } = await paperSniperRehearseReport(
        {},
        {
          mode: opts.mode,
          candidatesPath: opts.candidates,
          replayFile: opts.replayFile,
          preflightInputPath: opts.preflightInput,
          skipAutoRisk: Boolean(opts.skipAutoRisk),
          routequotePath: opts.routequote,
          amountSol: opts.amountSol,
          slippageBps: opts.slippageBps,
          endpoint: opts.endpoint,
          maxQuoteAgeMs: opts.maxQuoteAgeMs,
          wallet: opts.buildWallet,
          riskPath: opts.risk,
          maxSpendSol: opts.maxSpendSol,
          slippageCapBps: opts.slippageCapBps,
          riskScoreCap: opts.riskScoreCap,
          devnetSend: Boolean(opts.devnetSend),
          acknowledgeDevnetExecution: Boolean(opts.acknowledgeDevnetExecution),
          rpcUrl: opts.rpcUrl,
          sessionLedger: opts.sessionLedger,
          adoptSpecs: Boolean(opts.adoptSpecs),
          operatorLabel: opts.operator,
          allowPaperRead: Boolean(opts.allowPaperRead),
          outDir: opts.out,
          force: Boolean(opts.force),
          json: Boolean(opts.json),
          failOnBlocked: Boolean(opts.failOnBlocked),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:simulation:tx")
  .description(
    "Simulate ONE strictly-validated UNSIGNED transaction envelope (txpreview.envelope.v1) against real chain state via simulateTransaction with sigVerify:false + replaceRecentBlockhash:true — which is why NO signer, key, or seed phrase exists at this boundary. A signed transaction, key-shaped field, or fee-payer mismatch is REFUSED before any network I/O; transport failure -> honest `unavailable`; program error -> `simulated-failed`. simulated-ok is EVIDENCE for review, never live-trading readiness, and nothing here can send. PAPER mode requires --allow-paper-read",
  )
  .option("--envelope <path>", "unsigned transaction envelope JSON (txpreview.envelope.v1; required)")
  .option("--rpc-url <url>", "RPC endpoint for the simulation (overrides config rpcUrl; obvious cluster mismatches with the envelope are refused)")
  .option("--allow-paper-read", "explicitly allow this read-only network simulation while in PAPER mode")
  .option("--json", "emit the simulation report as stable JSON")
  .option("--out <path>", "write ONLY the simulation report JSON to this path (refused if it exists)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-not-ok", "exit non-zero unless the outcome is simulated-ok")
  .action(
    async (opts: {
      envelope?: string;
      rpcUrl?: string;
      allowPaperRead?: boolean;
      json?: boolean;
      out?: string;
      force?: boolean;
      failOnNotOk?: boolean;
    }) => {
      const { text, exitCode } = await paperSimulationTxReport(
        {},
        {
          envelopePath: opts.envelope,
          rpcUrl: opts.rpcUrl,
          allowPaperRead: Boolean(opts.allowPaperRead),
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnNotOk: Boolean(opts.failOnNotOk),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("execution:status")
  .description(
    "Resolve and SHOW the execution mode honestly (paper | readonly | devnet-execution | mainnet-dry-run | mainnet-live-blocked | mainnet-live-armed) plus the FULL fourteen-condition mainnet live-gate checklist (default: BLOCKED, every condition failed), the core DANGEROUS_BURNER_LIVE gate, and the emergency-stop state. Read-only: this command can never arm anything. Mainnet sending has NO CLI surface in Sprint 92 — deliberately",
  )
  .option("--request <mode>", "what to evaluate: paper (default) | readonly | devnet | mainnet-dry-run | mainnet-live")
  .option("--acknowledge-devnet-execution", "the explicit devnet acknowledgment flag (with the env flag)")
  .option("--i-understand-this-can-lose-real-money", "the explicit mainnet-live CLI acknowledgment (one of FOURTEEN required conditions; never sufficient alone)")
  .option("--quote-report <path>", "a LIVE routequote.fetch.report.v1 whose fetchedAt provenance feeds live-gate condition 9 (operator-supplied quote artifacts are refused — hand-typed quotes can never satisfy live freshness)")
  .option("--max-quote-age-ms <ms>", "the EXPLICIT quote age cap for condition 9 (required with --quote-report; there is no default cap by design)")
  .option("--json", "emit the status report as stable JSON")
  .option("--out <path>", "write ONLY the status report JSON to this path (refused if it exists)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .action(
    (opts: {
      request?: string;
      acknowledgeDevnetExecution?: boolean;
      iUnderstandThisCanLoseRealMoney?: boolean;
      quoteReport?: string;
      maxQuoteAgeMs?: string;
      json?: boolean;
      out?: string;
      force?: boolean;
    }) => {
      const { text, exitCode } = executionStatusReport(
        {},
        {
          request: opts.request,
          acknowledgeDevnetExecution: Boolean(opts.acknowledgeDevnetExecution),
          iUnderstandThisCanLoseRealMoney: Boolean(opts.iUnderstandThisCanLoseRealMoney),
          quoteReportPath: opts.quoteReport,
          maxQuoteAgeMs: opts.maxQuoteAgeMs,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("execution:build")
  .description(
    "REFUSAL-FIRST unsigned swap build (Jupiter swap API): every refusal reason — kill switch, mode, risk REJECT/over-cap, spend cap, slippage cap, wallet, mint match — is evaluated BEFORE any network call, and the only possible artifact is a strictly-validated UNSIGNED txpreview.envelope.v1 for paper:simulation:tx. Building never signs and never sends; an envelope is simulation material, never an order. Caps only TIGHTEN against config. PAPER mode requires --allow-paper-read",
  )
  .option("--candidate-mint <mint>", "the mint to swap INTO (required)")
  .option("--input-mint <mint>", "the swap input mint (default: wrapped SOL)")
  .option("--amount-raw <units>", "input amount in raw base units (exactly one of --amount-raw/--amount-sol)")
  .option("--amount-sol <sol>", "input amount in SOL (decimal, up to 9 dp)")
  .option("--slippage-bps <bps>", "explicit slippage tolerance in basis points (refused when missing)")
  .option("--wallet <publicKey>", "the wallet PUBLIC key the transaction is built FOR (required; never a secret)")
  .option("--risk <path>", "token:risk --json report for the candidate (required; building blind is refused)")
  .option("--request <mode>", "requested execution mode: devnet | mainnet-dry-run | mainnet-live (default paper -> build refuses)")
  .option("--acknowledge-devnet-execution", "the explicit devnet acknowledgment flag")
  .option("--i-understand-this-can-lose-real-money", "the explicit mainnet-live CLI acknowledgment (never sufficient alone)")
  .option("--max-spend-sol <sol>", "explicit per-trade spend cap in SOL (required; must not exceed config caps)")
  .option("--slippage-cap-bps <bps>", "explicit slippage cap in basis points (refused when missing)")
  .option("--risk-score-cap <n>", "explicit advisory risk score cap (refused when missing)")
  .option("--max-quote-age-ms <ms>", "explicit quote-age cap: a build whose fresh quote aged past it (slow provider) is refused; the envelope always carries quotedAt for downstream gates")
  .option("--allowed-programs <path>", "OPTIONAL program allowlist (JSON array of base58 program ids): every statically-resolvable invoked program must be listed, and ALT-loaded program ids refuse honestly; absent = no program check")
  .option("--report-out <path>", "write the txbuild.report.v1 attempt record here — on BOTH outcomes (a refused build is a first-class artifact with codes + next safe actions)")
  .option("--endpoint <url>", "override the provider base URL")
  .option("--allow-paper-read", "explicitly allow the network read while in PAPER mode")
  .option("--json", "emit the build result as stable JSON")
  .option("--out <path>", "write ONLY the unsigned envelope JSON to this path (refused if it exists)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .action(
    async (opts: {
      candidateMint?: string;
      inputMint?: string;
      amountRaw?: string;
      amountSol?: string;
      slippageBps?: string;
      wallet?: string;
      risk?: string;
      request?: string;
      acknowledgeDevnetExecution?: boolean;
      iUnderstandThisCanLoseRealMoney?: boolean;
      maxSpendSol?: string;
      slippageCapBps?: string;
      riskScoreCap?: string;
      maxQuoteAgeMs?: string;
      allowedPrograms?: string;
      reportOut?: string;
      endpoint?: string;
      allowPaperRead?: boolean;
      json?: boolean;
      out?: string;
      force?: boolean;
    }) => {
      const { text, exitCode } = await executionBuildReport(
        {},
        {
          candidateMint: opts.candidateMint,
          inputMint: opts.inputMint,
          amountRaw: opts.amountRaw,
          amountSol: opts.amountSol,
          slippageBps: opts.slippageBps,
          wallet: opts.wallet,
          riskPath: opts.risk,
          request: opts.request,
          acknowledgeDevnetExecution: Boolean(opts.acknowledgeDevnetExecution),
          iUnderstandThisCanLoseRealMoney: Boolean(opts.iUnderstandThisCanLoseRealMoney),
          maxSpendSol: opts.maxSpendSol,
          slippageCapBps: opts.slippageCapBps,
          riskScoreCap: opts.riskScoreCap,
          maxQuoteAgeMs: opts.maxQuoteAgeMs,
          allowedProgramsPath: opts.allowedPrograms,
          reportOutPath: opts.reportOut,
          endpoint: opts.endpoint,
          allowPaperRead: Boolean(opts.allowPaperRead),
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("execution:devnet:send")
  .description(
    "The ONLY send surface in Sprint 92, DEVNET-ONLY by construction: requires SOLMAKER_ENABLE_DEVNET_EXECUTION=devnet-only AND --acknowledge-devnet-execution; the envelope and the signer boundary must both be devnet; every operator safety control is enforced; every attempt (refused or submitted) is appended to the required --audit-log. The signer keypair file PATH comes from an env var NAME (--signer-env) and is never logged or serialized. There is NO mainnet variant of this command — deliberately. Submission is not confirmation",
  )
  .option("--envelope <path>", "unsigned transaction envelope JSON (txpreview.envelope.v1; required; must be devnet)")
  .option("--signer-env <ENV_VAR_NAME>", "the NAME of the env var holding the devnet keypair file PATH (required)")
  .option("--rpc-url <url>", "devnet RPC endpoint (default https://api.devnet.solana.com; mainnet endpoints refused)")
  .option("--acknowledge-devnet-execution", "the explicit devnet acknowledgment flag (required with the env flag)")
  .option("--audit-log <path>", "append-only JSONL audit log (required; every attempt is journaled)")
  .option("--risk-score <n>", "explicit advisory risk score for the trade context (required; a self-transfer probe is 0)")
  .option("--max-quote-age-ms <ms>", "tighten the quote-age cap below the 60s devnet-probe ceiling; the envelope's quotedAt provenance is checked against it (a stale/missing/future quote refuses)")
  .option("--session-ledger <path>", "S96: session ledger path (default runs/execution-sessions.jsonl) — an unaccounted previous session REFUSES a new attempt; a submitted attempt records as pending-confirmation until reconciled")
  .option("--json", "emit the attempt report as stable JSON")
  .action(
    async (opts: {
      envelope?: string;
      signerEnv?: string;
      rpcUrl?: string;
      acknowledgeDevnetExecution?: boolean;
      auditLog?: string;
      riskScore?: string;
      maxQuoteAgeMs?: string;
      sessionLedger?: string;
      json?: boolean;
    }) => {
      const { text, exitCode } = await executionDevnetSendReport(
        {},
        {
          envelopePath: opts.envelope,
          signerEnvVar: opts.signerEnv,
          rpcUrl: opts.rpcUrl,
          acknowledgeDevnetExecution: Boolean(opts.acknowledgeDevnetExecution),
          auditLog: opts.auditLog,
          riskScore: opts.riskScore,
          maxQuoteAgeMs: opts.maxQuoteAgeMs,
          sessionLedger: opts.sessionLedger,
          json: Boolean(opts.json),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("execution:readiness")
  .description(
    "The HONEST mainnet readiness checklist (Sprint 93): evaluate ALL fourteen live-gate conditions against operator-NAMED evidence (a LIVE quote fetch report + explicit age cap, a token:risk report + explicit cap, a txpreview simulation report, a wallet public key, an audit path) and name every missing condition with its exact next safe action. STRUCTURALLY incapable of reporting armed: the CLI acknowledgment, the signer boundary, and the redaction findings evaluate only at execution time. No bypass flag, no force flag, no env-only enable. Read-only; mainnet sending has NO CLI surface",
  )
  .option("--quote-report <path>", "a LIVE routequote.fetch.report.v1 for condition 9 (operator-supplied quote artifacts refused)")
  .option("--max-quote-age-ms <ms>", "the EXPLICIT quote age cap for condition 9 (no default by design)")
  .option("--risk <path>", "a token:risk --json report for condition 11")
  .option("--risk-score-cap <n>", "the EXPLICIT advisory risk score cap for condition 11")
  .option("--simulation <path>", "a txpreview.simulation.report.v1 for condition 10")
  .option("--slippage-cap-bps <bps>", "the EXPLICIT slippage cap for condition 7 (config has none)")
  .option("--wallet <publicKey>", "the destination wallet PUBLIC key for condition 12 (never a secret)")
  .option("--audit-log <path>", "the audit log path that WOULD be used (condition 14's path half)")
  .option("--session-ledger <path>", "S96: session ledger path (default runs/execution-sessions.jsonl) — the last session's reconciliation status is reported as evidence")
  .option("--json", "emit the readiness report as stable JSON")
  .option("--out <path>", "write ONLY the readiness report JSON to this path (refused if it exists)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .action(
    (opts: {
      quoteReport?: string;
      maxQuoteAgeMs?: string;
      risk?: string;
      riskScoreCap?: string;
      simulation?: string;
      slippageCapBps?: string;
      wallet?: string;
      auditLog?: string;
      sessionLedger?: string;
      json?: boolean;
      out?: string;
      force?: boolean;
    }) => {
      const { text, exitCode } = executionReadinessReport(
        {},
        {
          quoteReportPath: opts.quoteReport,
          maxQuoteAgeMs: opts.maxQuoteAgeMs,
          riskPath: opts.risk,
          riskScoreCap: opts.riskScoreCap,
          simulationPath: opts.simulation,
          slippageCapBps: opts.slippageCapBps,
          wallet: opts.wallet,
          auditLog: opts.auditLog,
          sessionLedger: opts.sessionLedger,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("execution:devnet:rehearse")
  .description(
    "DEVNET end-to-end broadcast rehearsal (Sprint 93/94): generate a THROWAWAY devnet keypair (written ONLY under runs/ with the gitignored .keypair suffix; secret bytes never logged), REUSE an existing throwaway in the output directory automatically (external funding sticks to the same key), or load an operator devnet keypair via --signer-env, airdrop devnet SOL with bounded retries, build the unsigned self-transfer probe, simulate it, submit it through the refusal-first send path, confirm it, and write the honest artifact set into --out. Same double opt-in as execution:devnet:send (env flag + --acknowledge-devnet-execution); mainnet endpoints are refused; an airdrop rate limit becomes an honest devnet-funding-blocked artifact, never a faked success. There is NO mainnet variant — deliberately",
  )
  .option("--out <dir>", "output DIRECTORY for the rehearsal artifacts + throwaway keypair (required; must be under runs/ unless --signer-env)")
  .option("--rpc-url <url>", "devnet RPC endpoint (default https://api.devnet.solana.com; mainnet endpoints refused)")
  .option("--acknowledge-devnet-execution", "the explicit devnet acknowledgment flag (required with the env flag)")
  .option("--signer-env <ENV_VAR_NAME>", "reuse an existing devnet keypair: the NAME of the env var holding its file PATH")
  .option("--airdrop-sol <sol>", "devnet airdrop request in SOL (default 1; at most 2; valueless devnet SOL)")
  .option("--airdrop-attempts <n>", "bounded faucet retries per run (default 3; hard cap 5 — the faucet is never spammed)")
  .option("--skip-airdrop", "do not request an airdrop (the signer must already be funded)")
  .option("--skip-simulation", "skip the pre-send simulateTransaction step (kept on by default)")
  .option("--session-ledger <path>", "S96: session ledger path (default runs/execution-sessions.jsonl) — an unaccounted previous session REFUSES a new attempt")
  .option("--json", "emit the rehearsal report as stable JSON")
  .option("--force", "overwrite an existing rehearsal report in the output directory")
  .action(
    async (opts: {
      out?: string;
      rpcUrl?: string;
      acknowledgeDevnetExecution?: boolean;
      signerEnv?: string;
      airdropSol?: string;
      airdropAttempts?: string;
      skipAirdrop?: boolean;
      skipSimulation?: boolean;
      sessionLedger?: string;
      json?: boolean;
      force?: boolean;
    }) => {
      const { text, exitCode } = await executionDevnetRehearseReport(
        {},
        {
          outDir: opts.out,
          rpcUrl: opts.rpcUrl,
          acknowledgeDevnetExecution: Boolean(opts.acknowledgeDevnetExecution),
          signerEnvVar: opts.signerEnv,
          airdropSol: opts.airdropSol,
          airdropAttempts: opts.airdropAttempts,
          skipAirdrop: Boolean(opts.skipAirdrop),
          skipSimulation: Boolean(opts.skipSimulation),
          sessionLedger: opts.sessionLedger,
          json: Boolean(opts.json),
          force: Boolean(opts.force),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("execution:devnet:funding-status")
  .description(
    "Sprint 103-B devnet proof unblocker: READ a throwaway devnet key's balance once and emit the honest execution.devnet.funding_status.v1 artifact (funded / unfunded / faucet-rate-limited / faucet-unavailable / rpc-unavailable / unknown). Resolve the PUBLIC key from --public-key (status only), --signer-env, or a reused throwaway under --out. Optionally attempt a BOUNDED devnet faucet airdrop. When the key is funded, --complete-if-funded chains the existing devnet rehearsal with --skip-airdrop to land the real broadcast + reconciliation. Mainnet endpoints are refused; no trade is ever sent; no secret key is serialized",
  )
  .option("--public-key <base58>", "PUBLIC key to check (status only; cannot complete the proof on its own)")
  .option("--signer-env <ENV_VAR_NAME>", "reuse an existing devnet keypair: the NAME of the env var holding its file PATH (can complete)")
  .option("--out <dir>", "output DIRECTORY for the funding-status artifact (and the rehearsal artifacts when completing)")
  .option("--rpc-url <url>", "devnet RPC endpoint (default https://api.devnet.solana.com; mainnet endpoints refused)")
  .option("--min-lamports <n>", "broadcast-ready minimum in lamports (default the rehearsal probe minimum)")
  .option("--attempt-airdrop", "attempt a BOUNDED devnet faucet airdrop when the key is short (devnet only; never spammed)")
  .option("--airdrop-sol <sol>", "devnet airdrop request in SOL (default 1; at most 2; valueless devnet SOL)")
  .option("--airdrop-attempts <n>", "bounded faucet retries (default 3; hard cap 5)")
  .option("--complete-if-funded", "when funded, chain the devnet rehearsal (--skip-airdrop) to land the proof (needs a signer + --out)")
  .option("--acknowledge-devnet-execution", "the explicit devnet acknowledgment flag (required to complete)")
  .option("--session-ledger <path>", "S96 session ledger path (default runs/execution-sessions.jsonl)")
  .option("--json", "emit the funding-status artifact as stable JSON")
  .option("--force", "overwrite an existing funding-status artifact in the output directory")
  .action(
    async (opts: {
      publicKey?: string;
      signerEnv?: string;
      out?: string;
      rpcUrl?: string;
      minLamports?: string;
      attemptAirdrop?: boolean;
      airdropSol?: string;
      airdropAttempts?: string;
      completeIfFunded?: boolean;
      acknowledgeDevnetExecution?: boolean;
      sessionLedger?: string;
      json?: boolean;
      force?: boolean;
    }) => {
      const { text, exitCode } = await executionDevnetFundingStatusReport(
        {},
        {
          publicKey: opts.publicKey,
          signerEnvVar: opts.signerEnv,
          outDir: opts.out,
          rpcUrl: opts.rpcUrl,
          minLamports: opts.minLamports,
          attemptAirdrop: Boolean(opts.attemptAirdrop),
          airdropSol: opts.airdropSol,
          airdropAttempts: opts.airdropAttempts,
          completeIfFunded: Boolean(opts.completeIfFunded),
          acknowledgeDevnetExecution: Boolean(opts.acknowledgeDevnetExecution),
          sessionLedger: opts.sessionLedger,
          json: Boolean(opts.json),
          force: Boolean(opts.force),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("engine:status")
  .description(
    "S97 Rust sidecar foundation: invoke the solmaker-engine binary's status command over JSON IPC and STRICTLY validate the engine.status.report.v1 artifact (closed schema; signer/send/mainnet-send must literally be disabled). A machine without a Rust toolchain reports UNAVAILABLE honestly (exit 0 unless --fail-on-unavailable). The engine cannot sign, send, or load keys by construction",
  )
  .option("--json", "emit the validated engine artifact as stable JSON")
  .option("--out <path>", "write ONLY the validated artifact JSON to this path (refused if it exists)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-unavailable", "exit 1 when no Rust engine is available (default: honest report, exit 0)")
  .action(async (opts: { json?: boolean; out?: string; force?: boolean; failOnUnavailable?: boolean }) => {
    const { text, exitCode } = await engineStatusReport(
      {},
      { json: Boolean(opts.json), outPath: opts.out, force: Boolean(opts.force), failOnUnavailable: Boolean(opts.failOnUnavailable) },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("engine:quote:score")
  .description(
    "S99 Rust route-quote scoring: run a routequote.fetch.report.v1 (from paper:routequote:fetch --out-dir) through the Rust sidecar and STRICTLY validate engine.routequote.score.report.v1 — every score is RECOMPUTED from its components and every freshness verdict RE-EVALUATED with the real evaluateQuoteFreshness; any disagreement refuses the artifact. A route score is quote-quality INTELLIGENCE only (impact, hops, age) — never a profitability claim, never readiness, never an order. Requires an EXPLICIT --max-quote-age-ms (no default cap by design). No Rust engine reports UNAVAILABLE honestly (exit 0 unless --fail-on-unavailable)",
  )
  .requiredOption("--report <path>", "routequote.fetch.report.v1 file to score")
  .requiredOption("--max-quote-age-ms <ms>", "EXPLICIT quote age cap in milliseconds (no default exists by design)")
  .option("--json", "emit the validated score artifact as stable JSON")
  .option("--out <path>", "write ONLY the validated artifact JSON to this path (refused if it exists)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-unavailable", "exit 1 when no Rust engine is available (default: honest report, exit 0)")
  .action(async (opts: { report?: string; maxQuoteAgeMs?: string; json?: boolean; out?: string; force?: boolean; failOnUnavailable?: boolean }) => {
    const { text, exitCode } = await engineQuoteScoreReport(
      {},
      {
        reportPath: opts.report,
        maxQuoteAgeMs: opts.maxQuoteAgeMs,
        json: Boolean(opts.json),
        outPath: opts.out,
        force: Boolean(opts.force),
        failOnUnavailable: Boolean(opts.failOnUnavailable),
      },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("engine:tx:inspect")
  .description(
    "S100 Rust unsigned-transaction shape inspection: decode a strictly-UNSIGNED txpreview.envelope.v1 through the Rust sidecar and STRICTLY validate engine.tx.inspect.report.v1. The bridge re-derives the shape facts with the real @solana/web3.js decoder and refuses unless every fact matches; a SIGNED transaction is refused. Read-only — never signs, never sends. No Rust engine reports UNAVAILABLE honestly (exit 0 unless --fail-on-unavailable)",
  )
  .requiredOption("--envelope <path>", "txpreview.envelope.v1 file to inspect (strictly unsigned)")
  .option("--json", "emit the validated inspect artifact as stable JSON")
  .option("--out <path>", "write ONLY the validated artifact JSON to this path (refused if it exists)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-unavailable", "exit 1 when no Rust engine is available (default: honest report, exit 0)")
  .action(async (opts: { envelope?: string; json?: boolean; out?: string; force?: boolean; failOnUnavailable?: boolean }) => {
    const { text, exitCode } = await engineTxInspectReport(
      {},
      { envelopePath: opts.envelope, json: Boolean(opts.json), outPath: opts.out, force: Boolean(opts.force), failOnUnavailable: Boolean(opts.failOnUnavailable) },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("engine:sim:classify")
  .description(
    "S100 Rust simulation-failure classification: map a simulation result onto the S95 CLOSED set (slippage/compute/blockhash/account/program/unclassified) through the Rust sidecar. TypeScript re-runs the real classifySimulationFailure and refuses on disagreement. A classification explains WHY a simulation failed — never an execution signal. Pass --report <txpreview.simulation.report.v1> or --err-label <label> with optional --log entries",
  )
  .option("--report <path>", "txpreview.simulation.report.v1 file (uses its errLabel + logs)")
  .option("--err-label <label>", "classify a literal program error label directly")
  .option("--log <line...>", "log line(s) to include when using --err-label (repeatable)")
  .option("--json", "emit the validated classification artifact as stable JSON")
  .option("--fail-on-unavailable", "exit 1 when no Rust engine is available (default: honest report, exit 0)")
  .action(async (opts: { report?: string; errLabel?: string; log?: string[]; json?: boolean; failOnUnavailable?: boolean }) => {
    const { text, exitCode } = await engineSimClassifyReport(
      {},
      { reportPath: opts.report, errLabel: opts.errLabel, logs: opts.log, json: Boolean(opts.json), failOnUnavailable: Boolean(opts.failOnUnavailable) },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("engine:sniper:score")
  .description(
    "S101 Rust memecoin candidate scoring: rank a sniper.score.input.v1 bundle of already-collected facts (risk, token mechanics, quote quality, simulation evidence) into a deterministic per-candidate score (0-100) + closed verdict (watch/caution/reject/insufficient-evidence) through the Rust sidecar. TypeScript re-derives every component, score, verdict, reason set, and the ranking and cross-checks the echoed facts against the bundle, refusing on any disagreement. A score is INTELLIGENCE only — never a buy signal, never readiness, and a rejected risk stays rejected no matter the score (honest report, exit 0)",
  )
  .requiredOption("--input <path>", "sniper.score.input.v1 bundle file to score")
  .option("--json", "emit the validated score artifact as stable JSON")
  .option("--out <path>", "write ONLY the validated artifact JSON to this path (refused if it exists)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-unavailable", "exit 1 when no Rust engine is available (default: honest report, exit 0)")
  .action(async (opts: { input?: string; json?: boolean; out?: string; force?: boolean; failOnUnavailable?: boolean }) => {
    const { text, exitCode } = await engineSniperScoreReport(
      {},
      {
        inputPath: opts.input,
        json: Boolean(opts.json),
        outPath: opts.out,
        force: Boolean(opts.force),
        failOnUnavailable: Boolean(opts.failOnUnavailable),
      },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("execution:session:status")
  .description(
    "S96 read-only session accounting status: the latest execution session's ledger entries and the continuation decision a NEW devnet attempt would face (allowed only after reconciled / not-sent / funding-blocked / explicit acknowledgment). Reads the gitignored runs/ ledger; writes nothing unless --out; can never reconcile, acknowledge, or execute anything",
  )
  .option("--ledger <path>", "session ledger path (default runs/execution-sessions.jsonl)")
  .option("--network <network>", "network whose sessions gate continuation (default devnet)")
  .option("--json", "emit the status report as stable JSON")
  .option("--out <path>", "write ONLY the status report JSON to this path (refused if it exists)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .action((opts: { ledger?: string; network?: string; json?: boolean; out?: string; force?: boolean }) => {
    const { text, exitCode } = executionSessionStatusReport(
      {},
      { ledger: opts.ledger, network: opts.network, json: Boolean(opts.json), outPath: opts.out, force: Boolean(opts.force) },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("execution:session:reconcile")
  .description(
    "S96 post-trade accounting over the LATEST devnet execution session: re-check the signature's confirmation status (bounded polls, transaction-history search), read the CURRENT balance, read the ACTUAL fee from transaction meta, compare expected-vs-actual, write execution.reconciliation.report.v1 into --out, and append the verdict to the session ledger (the continuation wall's input). READ-ONLY RPC — this command can never sign, send, or resend; devnet sessions only; mainnet endpoints refused. Exits 1 when the verdict still blocks a new attempt",
  )
  .option("--ledger <path>", "session ledger path (default runs/execution-sessions.jsonl)")
  .option("--out <dir>", "output DIRECTORY for the reconciliation report (required)")
  .option("--rpc-url <url>", "devnet RPC endpoint (default https://api.devnet.solana.com; mainnet endpoints refused)")
  .option("--mint <mint>", "optional token mint to include in the balance reads")
  .option("--max-fee-lamports <n>", "tighten the acceptable probe fee bound (default 10000; bounds only tighten)")
  .option("--polls <n>", "bounded confirmation polls (default 5; hard cap 60)")
  .option("--json", "emit the reconciliation report as stable JSON")
  .option("--force", "overwrite an existing reconciliation report in the output directory")
  .action(
    async (opts: { ledger?: string; out?: string; rpcUrl?: string; mint?: string; maxFeeLamports?: string; polls?: string; json?: boolean; force?: boolean }) => {
      const { text, exitCode } = await executionSessionReconcileReport(
        {},
        {
          ledger: opts.ledger,
          outDir: opts.out,
          rpcUrl: opts.rpcUrl,
          mint: opts.mint,
          maxFeeLamports: opts.maxFeeLamports,
          polls: opts.polls,
          json: Boolean(opts.json),
          force: Boolean(opts.force),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("execution:session:acknowledge")
  .description(
    "S96: the EXPLICIT, AUDITED manual exit from a blocked session — appends a manual-acknowledgment entry (with your verbatim --reason) to the session ledger so the continuation wall opens. Requires BOTH --reason (>= 10 chars) and --acknowledge-unreconciled-session; refuses when nothing is blocked. This documents a human decision in the permanent accounting trail; it erases nothing and there is no force/bypass variant",
  )
  .option("--ledger <path>", "session ledger path (default runs/execution-sessions.jsonl)")
  .option("--reason <text>", "the REQUIRED explicit reason (at least 10 characters; recorded verbatim)")
  .option("--acknowledge-unreconciled-session", "the REQUIRED explicit acknowledgment flag")
  .option("--json", "emit the appended ledger entry as stable JSON")
  .action((opts: { ledger?: string; reason?: string; acknowledgeUnreconciledSession?: boolean; json?: boolean }) => {
    const { text, exitCode } = executionSessionAcknowledgeReport(
      {},
      {
        ledger: opts.ledger,
        reason: opts.reason,
        acknowledgeUnreconciledSession: Boolean(opts.acknowledgeUnreconciledSession),
        json: Boolean(opts.json),
      },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("paper:simulation:validate")
  .description(
    "Strictly validate named simulation artifacts with the PRODUCTION validators: `simulation.intent.plan.v2` via --plan and/or `simulation.result.v1` via --result (at least one required). Validation enforces the literal safety locks — a flipped neverSigns/neverSends/dryRunOnly/neverAuthorizesLiveTrading is INVALID. Exits 1 when any named artifact is unreadable or invalid. Reads only the named files, writes nothing. No network, no wallet",
  )
  .option("--plan <path>", "simulation intent plan JSON to validate (simulation.intent.plan.v2)")
  .option("--result <path>", "simulation result JSON to validate (simulation.result.v1)")
  .option("--json", "emit the validation outcomes as stable JSON")
  .action((opts: { plan?: string; result?: string; json?: boolean }) => {
    const { text, exitCode } = paperSimulationValidateReport(
      {},
      { planPath: opts.plan, resultPath: opts.result, json: Boolean(opts.json) },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("paper:simulation:audit")
  .description(
    "Build a `phase6.audit.report.v1` — the CHAIN AUDIT over the ten v2/simulation artifacts (decision v2, run report v2, safety gates v2, prereqs v2, the three governance specs, the simulation intent plan v2, the simulation result v1, the route-resolution artifact v1). Each artifact is strictly validated in place; MISSING artifacts are warnings (an incomplete chain is reported, never assumed); invalid artifacts, v1 stand-ins, and structured cross-reference mismatches FAIL the audit (a route built from a different plan is a mismatch); the chain's own blocking conditions (not-ready gates/prereqs, non-adopted specs, blocked plan/result/route) are surfaced VERBATIM and never waived. The audit reports — it never authorizes anything; Phase 7 remains not started. Reads only the named files, writes nothing unless --out. No network, no wallet",
  )
  .option("--decisions <path>", "v2 decision report JSON")
  .option("--run-report <path>", "v2 run report JSON")
  .option("--gates <path>", "v2 safety gates report JSON")
  .option("--prereqs <path>", "v2 phase6 prerequisite report JSON")
  .option("--kill-switch <path>", "kill-switch spec JSON")
  .option("--secrets-policy <path>", "secrets policy JSON")
  .option("--burner-isolation <path>", "burner isolation spec JSON")
  .option("--intent-plan <path>", "simulation intent plan JSON (simulation.intent.plan.v2)")
  .option("--simulation-result <path>", "simulation result JSON (simulation.result.v1)")
  .option("--route <path>", "route-resolution artifact JSON (simulation.route.resolution.v1)")
  .option("--operator <label>", "operator label echoed into the report")
  .option("--json", "emit the audit report as stable JSON")
  .option("--out <path>", "write ONLY the audit report JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-findings", "exit non-zero when the audit FAILED (any blocking finding)")
  .option("--fail-on-incomplete", "exit non-zero when the chain is incomplete")
  .option("--fail-on-chain-conditions", "exit non-zero when the chain carries any surfaced blocking condition")
  .action(
    (opts: {
      decisions?: string; runReport?: string; gates?: string; prereqs?: string; killSwitch?: string;
      secretsPolicy?: string; burnerIsolation?: string; intentPlan?: string; simulationResult?: string;
      route?: string; operator?: string; json?: boolean; out?: string; force?: boolean;
      failOnFindings?: boolean; failOnIncomplete?: boolean; failOnChainConditions?: boolean;
    }) => {
      const { text, exitCode } = paperSimulationAuditReport(
        {},
        {
          decisionsPath: opts.decisions,
          runReportPath: opts.runReport,
          gatesPath: opts.gates,
          prereqsPath: opts.prereqs,
          killSwitchPath: opts.killSwitch,
          secretsPolicyPath: opts.secretsPolicy,
          burnerIsolationPath: opts.burnerIsolation,
          intentPlanPath: opts.intentPlan,
          simulationResultPath: opts.simulationResult,
          routePath: opts.route,
          operatorLabel: opts.operator,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnFindings: Boolean(opts.failOnFindings),
          failOnIncomplete: Boolean(opts.failOnIncomplete),
          failOnChainConditions: Boolean(opts.failOnChainConditions),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:simulation:readiness")
  .description(
    "Build a `phase6.simulation.readiness.report.v1` — the structural answer to 'is the Phase 6 simulation stack green?'. Artifact checks are machine-verified with the production validators (a PASSED, chain-COMPLETE phase6 audit + a strictly-valid intent plan + result); evidence references (--evidence area=ref, repeatable) are recorded VERBATIM as declarations — the command cannot run tests and never claims it did. Readiness is fail-closed (anything missing blocks), and phase7LiveTradingReady is a LITERAL false the validator refuses to see flipped — this command is structurally incapable of claiming live-trading readiness. Reads only the named files, writes nothing unless --out. No network, no wallet",
  )
  .option("--audit <path>", "phase6 audit report JSON (phase6.audit.report.v1)")
  .option("--plan <path>", "simulation intent plan JSON (simulation.intent.plan.v2)")
  .option("--result <path>", "simulation result JSON (simulation.result.v1)")
  .option(
    "--evidence <area=ref...>",
    `declared evidence reference (repeatable; areas: ${PHASE6_READINESS_EVIDENCE_AREAS.join(", ")})`,
    (value: string, prev: string[] = []) => [...prev, value],
  )
  .option("--operator <label>", "operator label echoed into the report")
  .option("--json", "emit the readiness report as stable JSON")
  .option("--out <path>", "write ONLY the readiness report JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-not-ready", "exit non-zero when phase6SimulationReady is false")
  .action(
    (opts: {
      audit?: string; plan?: string; result?: string; evidence?: string[]; operator?: string;
      json?: boolean; out?: string; force?: boolean; failOnNotReady?: boolean;
    }) => {
      const { text, exitCode } = paperSimulationReadinessReport(
        {},
        {
          auditPath: opts.audit,
          planPath: opts.plan,
          resultPath: opts.result,
          evidence: opts.evidence,
          operatorLabel: opts.operator,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnNotReady: Boolean(opts.failOnNotReady),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:simulation:handoff")
  .description(
    "Build a `phase6.simulation.handoff.pack.v1` — the simulation-aware SESSION HANDOFF over twelve chain artifacts (decision v2, run report v2, safety gates v2, prereqs v2, the three governance specs, the simulation intent plan v2, the simulation result v1, the route-resolution artifact v1, the phase6 audit report, the phase6 readiness report). Each artifact is strictly validated in place and summarized from VERBATIM structured fields; a MISSING artifact is classified as missing — state is never invented. The chain's blocking conditions (including a blocked route's) and the readiness verdict are carried verbatim, and phase7LiveTradingReady is a LITERAL false the validator refuses to see flipped — a handoff pack can never claim or authorize live trading. Reads only the named files, writes nothing unless --out. No network, no wallet",
  )
  .option("--decisions <path>", "v2 decision report JSON")
  .option("--run-report <path>", "v2 run report JSON")
  .option("--gates <path>", "v2 safety gates report JSON")
  .option("--prereqs <path>", "v2 phase6 prerequisite report JSON")
  .option("--kill-switch <path>", "kill-switch spec JSON")
  .option("--secrets-policy <path>", "secrets policy JSON")
  .option("--burner-isolation <path>", "burner isolation spec JSON")
  .option("--intent-plan <path>", "simulation intent plan JSON (simulation.intent.plan.v2)")
  .option("--simulation-result <path>", "simulation result JSON (simulation.result.v1)")
  .option("--route <path>", "route-resolution artifact JSON (simulation.route.resolution.v1)")
  .option("--audit <path>", "phase6 audit report JSON (phase6.audit.report.v1)")
  .option("--readiness <path>", "phase6 readiness report JSON (phase6.simulation.readiness.report.v1)")
  .option("--operator <label>", "operator label echoed into the pack")
  .option("--pack-label <label>", "pack label echoed into the pack")
  .option("--json", "emit the handoff pack as stable JSON")
  .option("--out <path>", "write ONLY the pack JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-incomplete", "exit non-zero when the pack is incomplete (any artifact missing or invalid)")
  .option("--fail-on-blocking", "exit non-zero when the chain carries any blocking condition")
  .option("--fail-on-not-ready", "exit non-zero unless the verbatim readiness verdict is true (missing counts as NOT ready)")
  .action(
    (opts: {
      decisions?: string; runReport?: string; gates?: string; prereqs?: string; killSwitch?: string;
      secretsPolicy?: string; burnerIsolation?: string; intentPlan?: string; simulationResult?: string;
      route?: string; audit?: string; readiness?: string; operator?: string; packLabel?: string; json?: boolean;
      out?: string; force?: boolean; failOnIncomplete?: boolean; failOnBlocking?: boolean; failOnNotReady?: boolean;
    }) => {
      const { text, exitCode } = paperSimulationHandoffReport(
        {},
        {
          decisionsPath: opts.decisions,
          runReportPath: opts.runReport,
          gatesPath: opts.gates,
          prereqsPath: opts.prereqs,
          killSwitchPath: opts.killSwitch,
          secretsPolicyPath: opts.secretsPolicy,
          burnerIsolationPath: opts.burnerIsolation,
          intentPlanPath: opts.intentPlan,
          simulationResultPath: opts.simulationResult,
          routePath: opts.route,
          auditPath: opts.audit,
          readinessPath: opts.readiness,
          operatorLabel: opts.operator,
          packLabel: opts.packLabel,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnIncomplete: Boolean(opts.failOnIncomplete),
          failOnBlocking: Boolean(opts.failOnBlocking),
          failOnNotReady: Boolean(opts.failOnNotReady),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:simulation:diff:plan")
  .description(
    "Build a `simulation.intent.plan.diff.v2` — a deterministic STRUCTURED-FIELD-ONLY comparison of two simulation intent plans (--base vs --next, both required and both strictly validated; an invalid, tampered, or wrong-schema artifact refuses outright). Surfaces the blocked transition, blocking/warning code movements, source-artifact ref changes, readiness/spec-adoption changes, the operator acknowledgment, and per-entry preview changes as stable simulation-diff-plan-* findings. A diff over previews is still a preview: never signs, never sends, never authorizes live trading (literal locks, validated). Reads only the two named files, writes nothing unless --out. No network, no wallet",
  )
  .option("--base <path>", "BASE simulation intent plan JSON (simulation.intent.plan.v2; required)")
  .option("--next <path>", "NEXT simulation intent plan JSON (simulation.intent.plan.v2; required)")
  .option("--json", "emit the diff as stable JSON")
  .option("--out <path>", "write ONLY the diff JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-diff", "exit non-zero when the diff reports ANY structured change")
  .action(
    (opts: { base?: string; next?: string; json?: boolean; out?: string; force?: boolean; failOnDiff?: boolean }) => {
      const { text, exitCode } = paperSimulationDiffPlanReport(
        {},
        {
          basePath: opts.base,
          nextPath: opts.next,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnDiff: Boolean(opts.failOnDiff),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:simulation:diff:result")
  .description(
    "Build a `simulation.result.diff.v1` — a deterministic STRUCTURED-FIELD-ONLY comparison of two simulation results (--base vs --next, both required and both strictly validated; an invalid, tampered, or wrong-schema artifact refuses outright). Surfaces the status/blocked transitions, blocking-code movements, adapter identity changes, source-plan ref changes, and per-entry status/code/unresolved-field changes as stable simulation-diff-result-* findings. A diff over dry-run records is still a dry-run record: it never claims execution or a trade, never signs, never sends (literal locks, validated). Reads only the two named files, writes nothing unless --out. No network, no wallet",
  )
  .option("--base <path>", "BASE simulation result JSON (simulation.result.v1; required)")
  .option("--next <path>", "NEXT simulation result JSON (simulation.result.v1; required)")
  .option("--json", "emit the diff as stable JSON")
  .option("--out <path>", "write ONLY the diff JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-diff", "exit non-zero when the diff reports ANY structured change")
  .action(
    (opts: { base?: string; next?: string; json?: boolean; out?: string; force?: boolean; failOnDiff?: boolean }) => {
      const { text, exitCode } = paperSimulationDiffResultReport(
        {},
        {
          basePath: opts.base,
          nextPath: opts.next,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnDiff: Boolean(opts.failOnDiff),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:phase7:authorization:audit")
  .description(
    "Build the READ-ONLY `phase7.authorization.audit.v1` — the written, versioned answer to 'is the repo ready to be CONSIDERED for a separately-authorized S104 controlled micro-trade?'. The cheap structural facts are MACHINE-VERIFIED at runtime (the fourteen-condition live gate defaults to BLOCKED; the mode resolver is fail-closed; a mainnet signer refuses without an armed gate; the redactor strips secrets; the release candidate pins live-send disabled; the reconciliation wall fail-closes; the CLI surface carries no mainnet-send command/flag; the Rust dependency allowlist holds). The verdict is RE-DERIVED from the evidence and DEFAULTS to not-authorized. This command authorizes NOTHING and sends NOTHING; a controlled micro-trade still needs a separate, explicit, written authorization",
  )
  .option("--audit-id <label>", "operator label echoed into the audit (default: phase7-authorization-audit)")
  .option("--repo-sha <sha>", "the repo SHA the audit was run against (recorded verbatim)")
  .option("--devnet-broadcast-confirmed", "assert a real devnet end-to-end broadcast has confirmed + reconciled (a micro-trade prerequisite; default false)")
  .option("--sign-off-present", "assert a written human Phase 7 sign-off is recorded in the dossier (a micro-trade prerequisite; default false)")
  .option("--devnet-funding-status <path>", "optional evidence: a devnet funding-status artifact (context for the broadcast prerequisite)")
  .option("--devnet-reconciliation <path>", "optional evidence: a devnet reconciliation report (verdict 'reconciled' proves the broadcast; authoritative over the flag)")
  .option("--sign-off-record <path>", "optional evidence: a Phase 7 sign-off record (signed-for-controlled-microtrade proves it; authoritative over the flag)")
  .option("--json", "emit the audit artifact as stable JSON")
  .option("--out <path>", "write ONLY the audit JSON to this path (refused if it exists without --force)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-not-ready", "exit non-zero unless the verdict is ready-for-separate-microtrade-authorization")
  .action(
    (opts: {
      auditId?: string;
      repoSha?: string;
      devnetBroadcastConfirmed?: boolean;
      signOffPresent?: boolean;
      devnetFundingStatus?: string;
      devnetReconciliation?: string;
      signOffRecord?: string;
      json?: boolean;
      out?: string;
      force?: boolean;
      failOnNotReady?: boolean;
    }) => {
      const { text, exitCode } = phase7AuthorizationAuditReport(
        {},
        {
          auditId: opts.auditId,
          repoSha: opts.repoSha,
          devnetBroadcastConfirmed: Boolean(opts.devnetBroadcastConfirmed),
          signOffPresent: Boolean(opts.signOffPresent),
          devnetFundingStatusPath: opts.devnetFundingStatus,
          devnetReconciliationPath: opts.devnetReconciliation,
          signOffRecordPath: opts.signOffRecord,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnNotReady: Boolean(opts.failOnNotReady),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:sniper:operator-demo")
  .description(
    "Sprint 103-B operator demo workbench: assemble a SAFE, showable demo folder + sniper.operator_demo.manifest.v1. Writes the REAL read-only Phase 7 audit + a blank sign-off template, an honest devnet funding-status FIXTURE, and the byte-pinned FICTIONAL candidate + mainnet dry-run release-candidate examples (which fold in candidate ranking, risk, quote score, tx build, tx inspection, simulation, and readiness). Every artifact is labelled by provenance (real-readonly / fixture / fictional-example) and the manifest pins live execution disabled. Nothing here signs, sends, or trades — it is a 'look what Sol Maker can do' exhibit, not a live bot",
  )
  .requiredOption("--out <dir>", "output DIRECTORY for the demo artifacts + manifest")
  .option("--demo-id <label>", "operator label echoed into the manifest (default sniper-operator-demo)")
  .option("--json", "emit the demo manifest as stable JSON")
  .option("--force", "overwrite existing demo artifacts in the output directory")
  .action((opts: { out?: string; demoId?: string; json?: boolean; force?: boolean }) => {
    const { text, exitCode } = paperSniperOperatorDemoReport(
      {},
      { outDir: opts.out, demoId: opts.demoId, json: Boolean(opts.json), force: Boolean(opts.force) },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("paper:sniper:watchlist:prepare")
  .description(
    "Sprint 104-C operator watchlist: create or normalize a `sniper.watchlist.v1` from an existing watchlist (--watchlist), a candidate list (--candidates), and/or repeatable --add <mint[=label]> entries. Sources are merged and DEDUPED by mint (first wins), every mint is validated as a 32-byte Solana public key (secret-length / private-key-like input is REFUSED), and the result is normalized. A status (watch / review / blocked / archived) is bookkeeping ONLY — never a trade signal and never trade readiness. Reads the named files only; writes nothing unless --out (refused if it exists without --force; no directories created). LOCAL-ONLY: no RPC, no network, no wallet",
  )
  .option("--watchlist <path>", "existing watchlist to start from (canonical sniper.watchlist.v1 or raw {entries:[...]})")
  .option("--candidates <path>", "candidate list to seed entries from (raw operator input or canonical sniper.candidate.list.v1)")
  .option(
    "--add <mint>",
    'a mint (or "mint=label") to add as a watch entry (repeatable)',
    (value: string, previous: string[]) => previous.concat(value),
    [] as string[],
  )
  .option("--status <status>", "default status for seeded/added entries: watch | review | blocked | archived (default watch)")
  .option("--watchlist-id <label>", "operator label echoed into the watchlist (default sniper-watchlist)")
  .option("--source <label>", "source label echoed into the watchlist")
  .option("--network <network>", "network the watchlist is scoped to: mainnet-beta | devnet | testnet (default mainnet-beta)")
  .option("--json", "emit the normalized watchlist as stable JSON")
  .option("--out <path>", "write ONLY the watchlist JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-warning", "exit non-zero when the normalized watchlist carries any warning (e.g. duplicate mints)")
  .action(
    (opts: {
      watchlist?: string;
      candidates?: string;
      add?: string[];
      status?: string;
      watchlistId?: string;
      source?: string;
      network?: string;
      json?: boolean;
      out?: string;
      force?: boolean;
      failOnWarning?: boolean;
    }) => {
      const { text, exitCode } = paperSniperWatchlistPrepareReport(
        {},
        {
          watchlistPath: opts.watchlist,
          candidatesPath: opts.candidates,
          add: opts.add,
          status: opts.status,
          watchlistId: opts.watchlistId,
          source: opts.source,
          network: opts.network,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnWarning: Boolean(opts.failOnWarning),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:sniper:campaign:run")
  .description(
    "Sprint 104-C dry-run campaign: COMPARE candidates across the evidence you already gathered and write a SAFE no-send campaign folder + `sniper.dryrun.campaign.v1`. The spine is --candidates or --watchlist; --score (engine.sniper.score.report.v1), --preflight (sniper.token.preflight.report.v1), --risk <mint=path> (token:risk JSON), --routequote (routequote.prepared.v1), and --release-candidate <mint=path> (sniper.mainnet_dryrun.release_candidate.v1) attach ranking / risk / quote / dry-run evidence BY MINT. Each candidate's verdict (watch / review / blocked / insufficient-evidence) is RE-DERIVED — a high score can NEVER override a blocker, and missing evidence is shown as insufficient-evidence, never hidden. Reads the named files only; LOCAL-ONLY (no RPC, no network, no wallet, no signer, no send). Live trading stays DISABLED",
  )
  .option("--candidates <path>", "candidate list spine (raw operator input or canonical sniper.candidate.list.v1)")
  .option("--watchlist <path>", "watchlist spine (sniper.watchlist.v1; supplies the per-mint watchlist status too)")
  .option("--score <path>", "engine.sniper.score.report.v1 (rank + score per candidate; intelligence only)")
  .option("--preflight <path>", "sniper.token.preflight.report.v1 (preflight verdict + a fallback risk decision per candidate)")
  .option(
    "--risk <mint=path>",
    "token:risk JSON for a mint (the authoritative deep-risk decision; repeatable)",
    (value: string, previous: string[]) => previous.concat(value),
    [] as string[],
  )
  .option("--routequote <path>", "routequote.prepared.v1 (route-quote observation status per candidate)")
  .option(
    "--release-candidate <mint=path>",
    "sniper.mainnet_dryrun.release_candidate.v1 for a mint (RC verdict + build + simulation; repeatable)",
    (value: string, previous: string[]) => previous.concat(value),
    [] as string[],
  )
  .option("--mode <mode>", "campaign mode: paper | mainnet-dry-run | devnet-review (default paper)")
  .option("--network <network>", "network: mainnet-beta | devnet | testnet (default mainnet-beta)")
  .option("--campaign-id <label>", "operator label echoed into the campaign (default sniper-dryrun-campaign)")
  .option("--limit <n>", "cap the number of candidates compared (default: all)", (v: string) => Number.parseInt(v, 10))
  .option("--json", "emit the campaign as stable JSON")
  .option("--out <dir>", "output DIRECTORY for campaign.json + RUN_SUMMARY.md (writes nothing if omitted)")
  .option("--force", "overwrite existing campaign artifacts in the output directory")
  .option("--fail-on-blocked", "exit non-zero when any candidate is blocked")
  .action(
    (opts: {
      candidates?: string;
      watchlist?: string;
      score?: string;
      preflight?: string;
      risk?: string[];
      routequote?: string;
      releaseCandidate?: string[];
      mode?: string;
      network?: string;
      campaignId?: string;
      limit?: number;
      json?: boolean;
      out?: string;
      force?: boolean;
      failOnBlocked?: boolean;
    }) => {
      const { text, exitCode } = paperSniperCampaignRunReport(
        {},
        {
          candidatesPath: opts.candidates,
          watchlistPath: opts.watchlist,
          scorePath: opts.score,
          preflightPath: opts.preflight,
          risks: opts.risk,
          routequotePath: opts.routequote,
          releaseCandidates: opts.releaseCandidate,
          mode: opts.mode,
          network: opts.network,
          campaignId: opts.campaignId,
          limit: opts.limit,
          json: Boolean(opts.json),
          outDir: opts.out,
          force: Boolean(opts.force),
          failOnBlocked: Boolean(opts.failOnBlocked),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:sniper:provider:doctor")
  .description(
    "Sprint 105-B READ-ONLY provider readiness check: resolve the read-only provider config (explicit flags > env vars > safe public keyless defaults) and run BOUNDED read-only probes — an RPC health call, a tiny WSOL→USDC Jupiter quote, and a no-network Rust engine check — into a `sniper.provider_health.report.v1`. It reports REACHABILITY only (available / unavailable / timeout / rate-limited / misconfigured / error / skipped); a provider being down is honest evidence, never a candidate risk verdict. It NEVER sends, NEVER signs, NEVER loads a key, and NEVER builds or simulates a transaction; no raw endpoint is printed (every endpoint is reduced to its host). LIVE TRADING stays DISABLED",
  )
  .option("--mode <mode>", "paper | mainnet-dry-run | devnet-review (default paper; devnet skips the mainnet-only quote probe)")
  .option("--rpc-url <url>", "read-only RPC endpoint to probe (overrides env / default; a key in the URL is never printed)")
  .option("--jupiter-url <url>", "read-only Jupiter quote base URL to probe (overrides env / default)")
  .option("--provider-profile <label>", "short label describing the endpoint set (echoed into the report)")
  .option("--timeout-ms <ms>", "per-probe timeout, clamped to [1000, 60000] (default 10000)")
  .option("--retry-limit <n>", "read-only retry budget, clamped to [0, 5] (default 1)")
  .option("--report-id <label>", "operator label echoed into the provider health report")
  .option("--json", "emit the provider health report as stable JSON")
  .option("--out <path>", "write the provider health report JSON to this path (refused if it exists without --force)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-unavailable", "exit non-zero when the live read-only providers are not all reachable")
  .action(
    async (opts: {
      mode?: string;
      rpcUrl?: string;
      jupiterUrl?: string;
      providerProfile?: string;
      timeoutMs?: string;
      retryLimit?: string;
      reportId?: string;
      json?: boolean;
      out?: string;
      force?: boolean;
      failOnUnavailable?: boolean;
    }) => {
      const { text, exitCode } = await paperSniperProviderDoctorReport(
        {},
        {
          mode: opts.mode,
          rpcUrl: opts.rpcUrl,
          jupiterUrl: opts.jupiterUrl,
          providerProfile: opts.providerProfile,
          timeoutMs: opts.timeoutMs,
          retryLimit: opts.retryLimit,
          reportId: opts.reportId,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnUnavailable: Boolean(opts.failOnUnavailable),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:sniper:campaign:auto-run")
  .description(
    "Sprint 105-A LIVE-READ-ONLY auto campaign: GATHER the safe read-only evidence itself across many candidates (candidate scoring via the Rust engine, deep risk, route-quote fetch + score, and an unsigned build dry-run + simulation in mainnet-dry-run mode) and assemble a no-send alpha folder — `sniper.readonly_campaign.plan.v1` + `sniper.dryrun.campaign.v1` + `sniper.alpha_run.report.v1` + per-candidate evidence + RUN_SUMMARY.md. Network reads happen ONLY in --mode mainnet-dry-run with the explicit --allow-readonly-network opt-in; a risk REJECT short-circuits the downstream quote/build/simulation stages for that candidate; an unavailable provider or Rust engine is recorded HONESTLY, never faked. It NEVER sends, NEVER signs, NEVER loads a key, and adds no mainnet send surface — live trading stays DISABLED",
  )
  .option("--candidates <path>", "candidate list spine (raw operator input or canonical sniper.candidate.list.v1)")
  .option("--watchlist <path>", "watchlist spine (sniper.watchlist.v1; supplies the per-mint watchlist status too)")
  .option("--mode <mode>", "paper | mainnet-dry-run (default paper; there is no live mode)")
  .option("--network <network>", "network label echoed into the artifacts (default mainnet-beta)")
  .option("--allow-readonly-network", "opt in to LIVE read-only network reads (mainnet-dry-run only): deep risk, route quote, simulation")
  .option("--limit <n>", "cap the number of candidates (network runs are also hard-capped)", (v: string) => Number.parseInt(v, 10))
  .option("--run-id <label>", "operator label echoed into the alpha report / plan")
  .option("--campaign-id <label>", "operator label echoed into the campaign")
  .option("--max-quote-age-ms <ms>", "quote-age cap fed to the route-quote scorer (default 60000)")
  .option("--amount-sol <sol>", "probe amount in SOL for the route-quote fetch (default 0.01)")
  .option("--score <path>", "ingest a pre-computed engine.sniper.score.report.v1 instead of running the Rust scorer")
  .option(
    "--risk <mint=path>",
    "token:risk JSON for a mint (used when network reads are off, or as an override; repeatable)",
    (value: string, previous: string[]) => previous.concat(value),
    [] as string[],
  )
  .option("--build-wallet <publicKey>", "PUBLIC key to build the unsigned dry-run for (a public key; never a secret)")
  .option("--slippage-bps <bps>", "slippage for the unsigned build dry-run")
  .option("--max-spend-sol <sol>", "explicit max-spend cap for the unsigned build dry-run (nothing is defaulted)")
  .option("--slippage-cap-bps <bps>", "explicit slippage cap for the unsigned build dry-run")
  .option("--risk-score-cap <score>", "explicit risk-score cap for the unsigned build dry-run")
  .option("--endpoint <url>", "read-only RPC / quote endpoint override")
  .option("--rpc-url <url>", "read-only RPC url for the simulation")
  .option("--phase7-status <label>", "Phase 7 posture label echoed into the alpha report (default authorized-for-design-only)")
  .option("--evidence-provenance <label>", "real-readonly | fixture | fictional-example | mixed (default derived from the run)")
  .option("--json", "emit the alpha report as stable JSON")
  .option("--out <dir>", "REQUIRED output directory for the alpha run folder")
  .option("--force", "overwrite existing artifacts in the output directory")
  .option("--fail-on-blocked", "exit non-zero when any candidate is blocked")
  .action(
    async (opts: {
      candidates?: string;
      watchlist?: string;
      mode?: string;
      network?: string;
      allowReadonlyNetwork?: boolean;
      limit?: number;
      runId?: string;
      campaignId?: string;
      maxQuoteAgeMs?: string;
      amountSol?: string;
      score?: string;
      risk?: string[];
      buildWallet?: string;
      slippageBps?: string;
      maxSpendSol?: string;
      slippageCapBps?: string;
      riskScoreCap?: string;
      endpoint?: string;
      rpcUrl?: string;
      phase7Status?: string;
      evidenceProvenance?: string;
      json?: boolean;
      out?: string;
      force?: boolean;
      failOnBlocked?: boolean;
    }) => {
      const { text, exitCode } = await paperSniperCampaignAutoRunReport(
        {},
        {
          candidatesPath: opts.candidates,
          watchlistPath: opts.watchlist,
          mode: opts.mode,
          network: opts.network,
          allowReadonlyNetwork: Boolean(opts.allowReadonlyNetwork),
          limit: opts.limit,
          runId: opts.runId,
          campaignId: opts.campaignId,
          maxQuoteAgeMs: opts.maxQuoteAgeMs,
          amountSol: opts.amountSol,
          scorePath: opts.score,
          risks: opts.risk,
          wallet: opts.buildWallet,
          slippageBps: opts.slippageBps,
          maxSpendSol: opts.maxSpendSol,
          slippageCapBps: opts.slippageCapBps,
          riskScoreCap: opts.riskScoreCap,
          endpoint: opts.endpoint,
          rpcUrl: opts.rpcUrl,
          phase7Status: opts.phase7Status,
          evidenceProvenance: opts.evidenceProvenance,
          json: Boolean(opts.json),
          outDir: opts.out,
          force: Boolean(opts.force),
          failOnBlocked: Boolean(opts.failOnBlocked),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:sniper:campaign:diff")
  .description(
    "Sprint 105-A campaign diff: compare two `sniper.dryrun.campaign.v1` files (--before / --after) candidate-by-candidate (keyed by mint) into `sniper.dryrun.campaign.diff.v1` — added / removed / unchanged / changed, score deltas, verdict transitions, and improved / worsened / newly-blocked / newly-watch tallies. It NEVER re-derives or overrides a campaign verdict and authorizes NOTHING; liveSendStatus is pinned disabled and the closed schema refuses any signature / send result. LOCAL-ONLY (no RPC / network / wallet / signer / send)",
  )
  .option("--before <path>", "the earlier sniper.dryrun.campaign.v1 file")
  .option("--after <path>", "the later sniper.dryrun.campaign.v1 file")
  .option("--diff-id <label>", "operator label echoed into the diff")
  .option("--json", "emit the diff as stable JSON")
  .option("--out <path>", "write ONLY the diff JSON to this path (refused if it exists without --force)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-worsened", "exit non-zero when any candidate worsened or became newly blocked")
  .action((opts: { before?: string; after?: string; diffId?: string; json?: boolean; out?: string; force?: boolean; failOnWorsened?: boolean }) => {
    const { text, exitCode } = paperSniperCampaignDiffReport(
      {},
      {
        beforePath: opts.before,
        afterPath: opts.after,
        diffId: opts.diffId,
        json: Boolean(opts.json),
        outPath: opts.out,
        force: Boolean(opts.force),
        failOnWorsened: Boolean(opts.failOnWorsened),
      },
    );
    console.log(text);
    if (exitCode !== 0) process.exitCode = exitCode;
  });

program
  .command("paper:sniper:alpha:report")
  .description(
    "Sprint 105-A alpha run report: assemble a showable `sniper.alpha_run.report.v1` from a campaign (--campaign) plus optional plan / diff / watchlist refs — top / blocked / insufficient-evidence candidates, stage coverage, provider + Rust engine health, Phase 7 posture, and evidence provenance. Candidate verdicts come from the campaign's own re-derivation; the report can NEVER claim live readiness or profitability, liveTradingStatus is pinned disabled and the closed schema refuses any signature / send result. LOCAL-ONLY (no RPC / network / wallet / signer / send)",
  )
  .option("--campaign <path>", "the sniper.dryrun.campaign.v1 this report projects (required)")
  .option("--plan <path>", "the sniper.readonly_campaign.plan.v1 the campaign ran under (ref only)")
  .option("--diff <path>", "an optional sniper.dryrun.campaign.diff.v1 to reference")
  .option("--watchlist <path>", "an optional sniper.watchlist.v1 to reference")
  .option("--run-id <label>", "operator label echoed into the report")
  .option("--phase7-status <label>", "Phase 7 posture label (default authorized-for-design-only)")
  .option("--evidence-provenance <label>", "real-readonly | fixture | fictional-example | mixed (default mixed)")
  .option("--rust-engine-status <label>", "available | unavailable | mixed | not-used (default not-used)")
  .option("--json", "emit the report as stable JSON")
  .option("--out <path>", "write ONLY the report JSON to this path (refused if it exists without --force)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .action(
    (opts: {
      campaign?: string;
      plan?: string;
      diff?: string;
      watchlist?: string;
      runId?: string;
      phase7Status?: string;
      evidenceProvenance?: string;
      rustEngineStatus?: string;
      json?: boolean;
      out?: string;
      force?: boolean;
    }) => {
      const { text, exitCode } = paperSniperAlphaReportReport(
        {},
        {
          campaignPath: opts.campaign,
          planPath: opts.plan,
          diffPath: opts.diff,
          watchlistPath: opts.watchlist,
          runId: opts.runId,
          phase7Status: opts.phase7Status,
          evidenceProvenance: opts.evidenceProvenance,
          rustEngineStatus: opts.rustEngineStatus,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:phase7:signoff:template")
  .description(
    "Sprint 103-B: generate the READ-ONLY `phase7.human_signoff.record.v1` — the clean mechanism for a FUTURE explicit human Phase 7 authorization. With no acknowledgements it is a blank `template-only` checklist; supplying every required acknowledgement for the target scope plus --operator-label, --signed-at, and (for a micro-trade) --max-spend-sol produces a SIGNED record. The status/scope are RE-DERIVED — the command cannot fake a signature, the granted scope can never exceed controlled-microtrade, and even a fully-signed record authorizes NO live trade and creates NO mainnet send (it is evidence only; the fourteen-condition live gate and a separate S104 sprint are still required)",
  )
  .option("--record-id <label>", "operator label echoed into the record (default phase7-human-signoff-template)")
  .option("--repo-sha <sha>", "the repo SHA the sign-off applies to (recorded verbatim)")
  .option("--audit-ref <ref>", "a reference to the phase7.authorization.audit.v1 this sign-off accompanies")
  .option("--scope <scope>", "target scope: design-review-only | controlled-mainnet-microtrade-only (default the latter)")
  .option("--acknowledge <id...>", "an acknowledgement id the human explicitly checks (repeatable)")
  .option("--operator-label <label>", "operator label for a signed record (not a legal identity)")
  .option("--signed-at <label>", "a signed-at label for a signed record")
  .option("--max-spend-sol <sol>", "bounded per-trade max spend in SOL (required to fully sign a micro-trade; micro ceiling enforced)")
  .option("--json", "emit the sign-off record as stable JSON")
  .option("--out <path>", "write ONLY the record JSON to this path (refused if it exists without --force)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--require-signed", "exit non-zero unless the record reached a signed status")
  .action(
    (opts: {
      recordId?: string;
      repoSha?: string;
      auditRef?: string;
      scope?: string;
      acknowledge?: string[];
      operatorLabel?: string;
      signedAt?: string;
      maxSpendSol?: string;
      json?: boolean;
      out?: string;
      force?: boolean;
      requireSigned?: boolean;
    }) => {
      const { text, exitCode } = phase7SignoffTemplateReport(
        {},
        {
          recordId: opts.recordId,
          repoSha: opts.repoSha,
          auditRef: opts.auditRef,
          scope: opts.scope,
          acknowledge: opts.acknowledge,
          operatorLabel: opts.operatorLabel,
          signedAt: opts.signedAt,
          maxSpendSol: opts.maxSpendSol,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          requireSigned: Boolean(opts.requireSigned),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program
  .command("paper:phase7:microtrade:preflight")
  .description(
    "Sprint 104-A: build the READ-ONLY `phase7.microtrade.preflight.v1` — the structural answer to 'IF a human later gives a separate, explicit S104 execution authorization, are the required inputs present?'. It reads and strictly validates the Phase 7 audit, the sign-off record, the mainnet dry-run release candidate, and the devnet reconciliation, validates a PUBLIC burner wallet (a secret key is refused) and a bounded max-spend, and folds them into one re-derived verdict. It DOES NOT execute a trade: it never signs, never sends, never loads a private key, registers no mainnet send surface, and the best verdict it can reach, ready-for-separate-execution-authorization, authorizes NOTHING — a separate, explicit, written S104 execution authorization, the fourteen-condition live gate, and a reviewed sprint are still required",
  )
  .option("--preflight-id <label>", "operator label echoed into the artifact (default phase7-microtrade-preflight)")
  .option("--repo-sha <sha>", "the repo SHA the preflight was run against (recorded verbatim)")
  .option("--phase7-audit <path>", "evidence: a phase7.authorization.audit.v1 (a not-authorized audit is refused)")
  .option("--sign-off-record <path>", "evidence: a phase7.human_signoff.record.v1 (signed-for-controlled-microtrade satisfies the gate)")
  .option("--release-candidate <path>", "evidence: a sniper.mainnet_dryrun.release_candidate.v1 (dryrun-complete-blocked-live satisfies the gate)")
  .option("--devnet-reconciliation <path>", "evidence: a devnet execution.reconciliation.report.v1 (verdict 'reconciled' proves the broadcast)")
  .option("--burner-wallet <pubkey>", "a dedicated PUBLIC burner wallet address (32-byte public key only; a secret key is refused)")
  .option("--max-spend-sol <sol>", "a bounded per-trade max spend in SOL (micro ceiling enforced; must not exceed the signed cap)")
  .option("--manual-confirmation-label <label>", "an explicit manual-confirmation label (the operator will confirm the single trade by hand)")
  .option("--json", "emit the preflight artifact as stable JSON")
  .option("--out <path>", "write ONLY the preflight JSON to this path (refused if it exists without --force)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .action(
    (opts: {
      preflightId?: string;
      repoSha?: string;
      phase7Audit?: string;
      signOffRecord?: string;
      releaseCandidate?: string;
      devnetReconciliation?: string;
      burnerWallet?: string;
      maxSpendSol?: string;
      manualConfirmationLabel?: string;
      json?: boolean;
      out?: string;
      force?: boolean;
    }) => {
      const { text, exitCode } = phase7MicrotradePreflightReport(
        {},
        {
          preflightId: opts.preflightId,
          repoSha: opts.repoSha,
          phase7AuditPath: opts.phase7Audit,
          signOffRecordPath: opts.signOffRecord,
          releaseCandidatePath: opts.releaseCandidate,
          devnetReconciliationPath: opts.devnetReconciliation,
          burnerWallet: opts.burnerWallet,
          maxSpendSol: opts.maxSpendSol,
          manualConfirmationLabel: opts.manualConfirmationLabel,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
        },
      );
      console.log(text);
      if (exitCode !== 0) process.exitCode = exitCode;
    },
  );

program.parseAsync(process.argv);
