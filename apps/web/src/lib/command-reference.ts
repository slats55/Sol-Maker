/**
 * Reference data for the existing Soulmaker CLI workflows.
 *
 * This is factual documentation of commands that already ship in
 * `@soulmaker/cli` (see apps/cli/src/index.ts), not sample/fixture data. It is
 * read-only display content; the dashboard never executes any of these commands.
 *
 * All commands are invoked from the repo root as:
 *   pnpm soulmaker <command> [options]
 */

export const CLI_INVOCATION = "pnpm soulmaker <command> [options]";

export type CommandGroup =
  | "Diagnostics"
  | "Read-only chain"
  | "Risk"
  | "Paper trading"
  | "Strategy"
  | "Backtest research";

export const COMMAND_GROUP_ORDER: readonly CommandGroup[] = [
  "Diagnostics",
  "Read-only chain",
  "Risk",
  "Paper trading",
  "Strategy",
  "Backtest research",
];

export interface CommandRef {
  readonly command: string;
  readonly summary: string;
  readonly group: CommandGroup;
  /**
   * True when the command reads public chain state. In PAPER mode these require
   * an explicit `--allow-paper-read` opt-in and accept public keys only.
   */
  readonly readsChain: boolean;
}

export const COMMANDS: readonly CommandRef[] = [
  // Diagnostics
  {
    command: "doctor",
    summary: "Environment / config sanity check. No chain, no key.",
    group: "Diagnostics",
    readsChain: false,
  },
  {
    command: "config:check",
    summary: "Validate soulmaker.config.json against the safety schema.",
    group: "Diagnostics",
    readsChain: false,
  },
  {
    command: "mode",
    summary: "Show the configured mode and its capabilities (read/build/simulate/send).",
    group: "Diagnostics",
    readsChain: false,
  },

  // Read-only chain
  {
    command: "solana:doctor",
    summary: "Read-only RPC health / version check. Host-only endpoint display.",
    group: "Read-only chain",
    readsChain: true,
  },
  {
    command: "wallet:watch <pubkey>",
    summary: "Watch a public address: SOL balance + token accounts. Public keys only.",
    group: "Read-only chain",
    readsChain: true,
  },
  {
    command: "token:inspect <mint>",
    summary: "Inspect a token mint: decimals, supply, authorities, program, init state.",
    group: "Read-only chain",
    readsChain: true,
  },
  {
    command: "token:accounts <pubkey>",
    summary: "List SPL / Token-2022 accounts for a public address.",
    group: "Read-only chain",
    readsChain: true,
  },

  // Risk
  {
    command: "token:risk <mint>",
    summary: "Advisory, read-only risk flags + score. Not a buy recommendation.",
    group: "Risk",
    readsChain: true,
  },

  // Paper trading
  {
    command: "paper:run",
    summary: "Run a simulated paper session over injected candidates + prices.",
    group: "Paper trading",
    readsChain: false,
  },
  {
    command: "paper:journal",
    summary: "Summarize an append-only paper trade journal (JSONL).",
    group: "Paper trading",
    readsChain: false,
  },
  {
    command: "paper:status",
    summary: "Show simulated portfolio state derived from a paper journal.",
    group: "Paper trading",
    readsChain: false,
  },

  // Strategy
  {
    command: "strategy:evaluate",
    summary: "Evaluate one candidate into a single paper-only decision.",
    group: "Strategy",
    readsChain: false,
  },
  {
    command: "strategy:plan",
    summary: "Turn a candidate list into a PaperCandidate[] plan (manual hand-off only).",
    group: "Strategy",
    readsChain: false,
  },

  // Backtest research
  {
    command: "paper:backtest",
    summary: "Replay an injected scenario into a deterministic simulated report.",
    group: "Backtest research",
    readsChain: false,
  },
  {
    command: "paper:backtest:lint",
    summary: "Validate / lint a scenario (errors block; warnings stay runnable).",
    group: "Backtest research",
    readsChain: false,
  },
  {
    command: "paper:backtest:diff",
    summary: "Conservative delta between two backtest report files.",
    group: "Backtest research",
    readsChain: false,
  },
  {
    command: "paper:backtest:scenario:new",
    summary: "Generate a deterministic example scenario from a built-in template.",
    group: "Backtest research",
    readsChain: false,
  },
  {
    command: "paper:backtest:scenario:matrix",
    summary: "Expand a base scenario across a config-only patch matrix.",
    group: "Backtest research",
    readsChain: false,
  },
  {
    command: "paper:backtest:scenario:variants",
    summary: "Generate bounded numeric perturbation variants of a base scenario.",
    group: "Backtest research",
    readsChain: false,
  },
  {
    command: "paper:backtest:scenario:variants:explain",
    summary: "Dry-run: explain what a variant plan would change, without writing files.",
    group: "Backtest research",
    readsChain: false,
  },
  {
    command: "paper:backtest:suite",
    summary: "Run a directory of scenarios and write a suite index.",
    group: "Backtest research",
    readsChain: false,
  },
  {
    command: "paper:backtest:diff:suite",
    summary: "Conservative delta between two suite indexes.",
    group: "Backtest research",
    readsChain: false,
  },
  {
    command: "paper:backtest:sensitivity",
    summary: "Run a base + variants and report per-variant deltas vs the baseline.",
    group: "Backtest research",
    readsChain: false,
  },
  {
    command: "paper:backtest:diff:sensitivity",
    summary: "Conservative delta between two sensitivity reports.",
    group: "Backtest research",
    readsChain: false,
  },
  {
    command: "paper:backtest:suite:coverage",
    summary: "Report which simulated paper behaviours a suite exercised.",
    group: "Backtest research",
    readsChain: false,
  },
];

/** Commands in a given group, in declared order. */
export function commandsByGroup(group: CommandGroup): CommandRef[] {
  return COMMANDS.filter((command) => command.group === group);
}
