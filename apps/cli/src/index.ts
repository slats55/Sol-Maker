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
  paperSniperDecideReport,
  paperSniperWorkflowReport,
  paperSniperReportReport,
  paperSniperDiffReportReport,
  paperSniperPolicyValidateReport,
  paperSniperAuditReport,
  paperSniperSessionPackReport,
  paperSniperSafetyGatesReport,
  paperSniperKillSwitchSpecReport,
  paperPhase6PrereqsReport,
  paperPhase6IntentPlanReport,
  paperPhase6DiffIntentReport,
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
    "Deterministically diff TWO existing sniper run report JSON files (`sniper.run.report.diff.v1`). Reads ONLY the two named files (BOM-tolerant; malformed/wrong-schema refused), runs no report, and writes nothing. Pairs candidates by id and reports membership changes (added / removed / common), per-candidate decision + preflight-status transitions, conservative directional flags (new invalid / preflight-fail / risk-block / paper-enter / unknown / recovery), and aggregate deltas. A paper-enter transition is a change between two SIMULATED, paper-only classifications — never a buy/sell order. No network, no wallet",
  )
  .option("--base <path>", "base run report JSON (sniper.run.report.v1)")
  .option("--next <path>", "next run report JSON (sniper.run.report.v1)")
  .option("--json", "emit the run report diff as stable JSON")
  .option("--fail-on-change", "exit non-zero on any difference")
  .option("--fail-on-new-invalid", "exit non-zero when any candidate became invalid")
  .option("--fail-on-new-preflight-fail", "exit non-zero when any candidate newly failed preflight")
  .option("--fail-on-new-risk", "exit non-zero when any candidate became risk-blocked")
  .option("--fail-on-new-paper-enter", "exit non-zero when any candidate newly paper-enters (SIMULATED)")
  .option("--fail-on-new-unknown", "exit non-zero when any candidate became unknown")
  .action(
    (opts: {
      base?: string;
      next?: string;
      json?: boolean;
      failOnChange?: boolean;
      failOnNewInvalid?: boolean;
      failOnNewPreflightFail?: boolean;
      failOnNewRisk?: boolean;
      failOnNewPaperEnter?: boolean;
      failOnNewUnknown?: boolean;
    }) => {
      const { text, exitCode } = paperSniperDiffReportReport(
        {},
        {
          basePath: opts.base,
          nextPath: opts.next,
          json: Boolean(opts.json),
          failOnChange: Boolean(opts.failOnChange),
          failOnNewInvalid: Boolean(opts.failOnNewInvalid),
          failOnNewPreflightFail: Boolean(opts.failOnNewPreflightFail),
          failOnNewRisk: Boolean(opts.failOnNewRisk),
          failOnNewPaperEnter: Boolean(opts.failOnNewPaperEnter),
          failOnNewUnknown: Boolean(opts.failOnNewUnknown),
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
  .option("--json", "emit the session pack as stable JSON")
  .option("--out <path>", "write ONLY the session pack JSON to this path (writes nothing if omitted)")
  .option("--force", "overwrite an existing --out file (refused by default)")
  .option("--fail-on-risk", "exit non-zero when any artifact carries a risk block")
  .option("--fail-on-unknown", "exit non-zero when any artifact carries an unknown classification")
  .option("--fail-on-paper-enter", "exit non-zero when any artifact carries a SIMULATED paper-enter")
  .option("--fail-on-unsupported", "exit non-zero when any artifact has an unsupported schema")
  .action(
    (opts: {
      artifact?: string[];
      label?: string;
      json?: boolean;
      out?: string;
      force?: boolean;
      failOnRisk?: boolean;
      failOnUnknown?: boolean;
      failOnPaperEnter?: boolean;
      failOnUnsupported?: boolean;
    }) => {
      const { text, exitCode } = paperSniperSessionPackReport(
        {},
        {
          artifacts: opts.artifact ?? [],
          label: opts.label,
          json: Boolean(opts.json),
          outPath: opts.out,
          force: Boolean(opts.force),
          failOnRisk: Boolean(opts.failOnRisk),
          failOnUnknown: Boolean(opts.failOnUnknown),
          failOnPaperEnter: Boolean(opts.failOnPaperEnter),
          failOnUnsupported: Boolean(opts.failOnUnsupported),
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

program.parseAsync(process.argv);
