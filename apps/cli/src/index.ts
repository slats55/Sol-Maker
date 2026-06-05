#!/usr/bin/env -S npx tsx
import { Command } from "commander";
import {
  doctorReport,
  configCheckReport,
  modeReport,
  paperStatusReport,
} from "./commands.js";

const program = new Command();

program
  .name("soulmaker")
  .description(
    "Soulmaker — security-first Solana trading command center (read-only CLI).",
  )
  .version("0.0.0");

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
    console.log(configCheckReport());
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

program.parse(process.argv);
