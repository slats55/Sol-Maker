#!/usr/bin/env -S npx tsx
import { Command } from "commander";
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
  if (/^(Refusing|RPC read failed|Config is INVALID)/m.test(text)) {
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
  .description("Show paper-trading status (Phase 4 stub)")
  .action(() => {
    console.log(paperStatusReport());
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

program.parseAsync(process.argv);
