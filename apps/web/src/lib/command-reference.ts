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
  | "Backtest research"
  | "Research runs";

export const COMMAND_GROUP_ORDER: readonly CommandGroup[] = [
  "Diagnostics",
  "Read-only chain",
  "Risk",
  "Paper trading",
  "Strategy",
  "Backtest research",
  "Research runs",
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
    command: "paper:backtest:sensitivity:matrix",
    summary:
      "Sweep a directory of base scenarios through one shared variant plan; aggregate every base × variant cell into a stable matrix.",
    group: "Backtest research",
    readsChain: false,
  },
  {
    command: "paper:backtest:diff:sensitivity:matrix",
    summary:
      "Conservative delta between two sensitivity matrices (bases paired by id, cells by suffix).",
    group: "Backtest research",
    readsChain: false,
  },
  {
    command: "paper:backtest:suite:coverage",
    summary: "Report which simulated paper behaviours a suite exercised.",
    group: "Backtest research",
    readsChain: false,
  },

  // Research runs — reproducibility / integrity tooling over a directory of a
  // research run's local JSON artifacts (and across a campaign of runs). All
  // read local files only; the diff/verify/status commands write nothing.
  {
    command: "paper:backtest:research:manifest",
    summary:
      "Build a reproducibility manifest of a run's local JSON artifacts + content digests.",
    group: "Research runs",
    readsChain: false,
  },
  {
    command: "paper:backtest:research:verify",
    summary:
      "Re-verify a manifest against the current local artifacts (missing / changed / extra / schema-mismatch). Writes nothing.",
    group: "Research runs",
    readsChain: false,
  },
  {
    command: "paper:backtest:diff:research:manifest",
    summary:
      "Conservative delta between two research manifests (artifacts paired by path). Reads two files, writes nothing.",
    group: "Research runs",
    readsChain: false,
  },
  {
    command: "paper:backtest:research:bundle",
    summary:
      "Package a run's local artifacts into one self-describing bundle: manifest summary + counts + a top-level run digest.",
    group: "Research runs",
    readsChain: false,
  },
  {
    command: "paper:backtest:diff:research:bundle",
    summary:
      "Conservative delta between two research bundles (artifacts paired by path): hasChange plus a conservative integrity hasRegression. Reads two files, writes nothing.",
    group: "Research runs",
    readsChain: false,
  },
  {
    command: "paper:backtest:research:status",
    summary:
      "Summarize a research directory's health — complete / recognized / stable / in-sync — with a neutral recommended action.",
    group: "Research runs",
    readsChain: false,
  },
  {
    command: "paper:backtest:research:index",
    summary:
      "Index a campaign directory of runs into one comparable summary: per-run digests + health and aggregate kind/schema counts.",
    group: "Research runs",
    readsChain: false,
  },
  {
    command: "paper:backtest:diff:research:index",
    summary:
      "Conservative delta between two campaign indexes (runs paired by runId): hasChange plus a conservative integrity hasRegression. Reads two files, writes nothing.",
    group: "Research runs",
    readsChain: false,
  },
];

/** Commands in a given group, in declared order. */
export function commandsByGroup(group: CommandGroup): CommandRef[] {
  return COMMANDS.filter((command) => command.group === group);
}

/**
 * Static web-dashboard build/inspect commands. Unlike {@link COMMANDS} (which
 * are `pnpm soulmaker …` backend CLI workflows), these are local, offline
 * dashboard-generation commands. They read/write local files only — no chain,
 * no wallet, no network.
 */
export interface WebCommandRef {
  /** Full invocation as typed in a terminal (from the repo root). */
  readonly command: string;
  readonly summary: string;
}

export const WEB_COMMANDS: readonly WebCommandRef[] = [
  {
    command: "pnpm web:build",
    summary:
      "Regenerate every static dashboard page from src/ into apps/web/public/. Offline; reads styles/ and writes public/ only.",
  },
  {
    command:
      "pnpm web:inspect --input <report.json> --out apps/web/public/research-artifact.html --force",
    summary:
      "Read ONE local PAPER report JSON and render it into the artifact inspector page. Local-only, no upload, no network; --force overwrites the committed empty-state page.",
  },
  {
    command: "pnpm web:inspect --input <report.json> --json",
    summary:
      "Print a machine-readable summary of the report to stdout and write no HTML file.",
  },
];

/** The canonical inspect command shown in instructions (with default --out). */
export const WEB_INSPECT_EXAMPLE =
  "pnpm web:inspect --input <report.json> --out apps/web/public/research-artifact.html --force";
