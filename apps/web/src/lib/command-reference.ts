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
  | "Research runs"
  | "Sniper (paper-only)"
  | "Phase 6 simulation"
  | "Execution (gated)"
  | "Rust engine (sidecar)";

export const COMMAND_GROUP_ORDER: readonly CommandGroup[] = [
  "Diagnostics",
  "Read-only chain",
  "Risk",
  "Paper trading",
  "Strategy",
  "Backtest research",
  "Research runs",
  "Sniper (paper-only)",
  "Phase 6 simulation",
  "Execution (gated)",
  "Rust engine (sidecar)",
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

  // Sniper (paper-only) — the S25+ integrity/safety pipeline over LOCAL JSON
  // artifacts the operator authors. Nothing here places orders, builds
  // transactions, or touches a wallet; a paper-enter is a SIMULATED
  // classification that always demands operator review.
  {
    command: "paper:sniper:candidates:validate",
    summary: "Validate an operator-authored local candidate list (paper-only intake; no scraper, no fetch).",
    group: "Sniper (paper-only)",
    readsChain: false,
  },
  {
    command: "paper:sniper:preflight",
    summary: "Summarize local token:inspect / token:risk output per candidate (pass / warn / fail / unknown).",
    group: "Sniper (paper-only)",
    readsChain: false,
  },
  {
    command: "paper:sniper:preflight:input:prepare",
    summary:
      "The read-only intelligence BRIDGE: pair standalone token:inspect --json / token:risk --json files to candidates by mint and emit the preflight input artifact paper:sniper:dry-run consumes. Candidates without data stay honestly uncovered — never marked safe.",
    group: "Sniper (paper-only)",
    readsChain: false,
  },
  {
    command: "paper:routequote:prepare",
    summary:
      "The S91 read-only ROUTE QUOTE bridge: pair operator-supplied quote observation files to candidates by mint and emit the routequote.prepared.v1 artifact paper:sniper:dry-run consumes via --routequote. Closed outcome set — an observed quote is an observation with mandatory caveats, never executable.",
    group: "Sniper (paper-only)",
    readsChain: false,
  },
  {
    command: "paper:sniper:decide",
    summary:
      "Paper-only decisions per candidate (skip / watch / paper-enter / paper-reject / unknown). Use --schema-version v2 for the reason-coded v2 artifact. Never an order.",
    group: "Sniper (paper-only)",
    readsChain: false,
  },
  {
    command: "paper:sniper:report",
    summary:
      "Bundle a run's already-built artifacts into one operator summary (verbatim; re-derives nothing). Use --schema-version v2 for rollups + operator-blocking reasons.",
    group: "Sniper (paper-only)",
    readsChain: false,
  },
  {
    command: "paper:sniper:diff:report",
    summary:
      "Structured comparison of two run reports (decision/preflight transitions, code deltas). Use --schema-version v2 for the v2 layers. Reads two files, writes nothing.",
    group: "Sniper (paper-only)",
    readsChain: false,
  },
  {
    command: "paper:sniper:safety:gates",
    summary: "Fail-closed go/no-go gates over a session's artifacts — exits non-zero when NOT ready.",
    group: "Sniper (paper-only)",
    readsChain: false,
  },
  {
    command: "paper:phase6:prereqs",
    summary: "Track Phase 6 prerequisites from a session pack (reports readiness; NEVER authorizes anything).",
    group: "Sniper (paper-only)",
    readsChain: false,
  },
  {
    command: "paper:sniper:dry-run",
    summary:
      "The S88 PAPER dry-run ORCHESTRATOR: one command runs the whole chain over an operator-supplied candidate file (19 artifacts + RUN_SUMMARY.md into ONE output directory). A BLOCKED chain still writes the full honest artifact set; route resolution stays honestly UNAVAILABLE unless --routequote supplies read-only quote observations (label facts + live-state caveat — never executable). Never an order, never a transaction.",
    group: "Sniper (paper-only)",
    readsChain: false,
  },
  {
    command: "paper:routequote:fetch",
    summary:
      "The S92 LIVE read-only quote fetcher: one quote per candidate from the public Jupiter lite API, written as the SAME observation files an operator would author by hand plus a routequote.fetch.report.v1 with honest freshness provenance (real fetchedAt). Provider failures map onto the closed status set — never upgraded, never faked.",
    group: "Sniper (paper-only)",
    readsChain: true,
  },
  {
    command: "paper:realtime:snapshot",
    summary:
      "One bounded poll of a public new-token feed (or a local replay file) normalized into the candidate-list contract (realtime.candidates.snapshot.v1). Watch-only observation; market figures are provider-reported HINTS.",
    group: "Sniper (paper-only)",
    readsChain: true,
  },
  {
    command: "paper:realtime:watch",
    summary:
      "The BOUNDED realtime watch (max 120 polls) with an interrupt-safe append-only JSONL journal and cross-poll mint dedupe. A watched candidate is never an order.",
    group: "Sniper (paper-only)",
    readsChain: true,
  },
  {
    command: "paper:sniper:rehearse",
    summary:
      "The S93/S94 UNIFIED rehearsal workflow: chain candidates → risk evidence (S94: AUTOMATIC deep token:risk per candidate in mainnet-dry-run mode, Token-2022 extensions included; --skip-auto-risk / --preflight-input / --risk override) → quote fetch/prepare → dry-run → unsigned build → real simulation → optional devnet broadcast → readiness over ONE output directory with an honest per-stage record (sniper.rehearsal.report.v1 with riskSource). Closed mode set paper (default, offline) | devnet (broadcast only behind --devnet-send + the double opt-in) | mainnet-dry-run (structurally cannot send). NO mainnet-live mode.",
    group: "Sniper (paper-only)",
    readsChain: true,
  },

  // Phase 6 simulation — read-only, dry-run-only artifacts over the validated
  // v2 chain. The route resolver and the real dry-run engine do NOT exist:
  // unresolved/unavailable states in these artifacts are the honest record,
  // and phase7LiveTradingReady is a literal false everywhere it appears.
  {
    command: "paper:simulation:intent:plan",
    summary:
      "Fail-closed SIMULATION PREVIEW over the validated v2 chain (simulation.intent.plan.v2). Unsupplied values stay UNRESOLVED; anything missing/not-ready BLOCKS the plan.",
    group: "Phase 6 simulation",
    readsChain: false,
  },
  {
    command: "paper:simulation:result",
    summary:
      "One honest simulation pass over a validated plan (simulation.result.v1): unresolved entries SKIPPED, dry-run honestly UNAVAILABLE (no engine exists — nothing faked).",
    group: "Phase 6 simulation",
    readsChain: false,
  },
  {
    command: "paper:simulation:route",
    summary:
      "Route-resolution PROVENANCE over a validated plan (simulation.route.resolution.v1). Honestly UNAVAILABLE without --quotes; with --quotes read-only quote observations enter as label facts with the live-state caveat — never invented, never executable.",
    group: "Phase 6 simulation",
    readsChain: false,
  },
  {
    command: "paper:simulation:validate",
    summary: "Strictly validate simulation artifacts with the production validators (literal safety locks enforced).",
    group: "Phase 6 simulation",
    readsChain: false,
  },
  {
    command: "paper:simulation:audit",
    summary:
      "Chain audit over the ten Phase 6 artifacts incl. the route-resolution role via --route (phase6.audit.report.v1). Reports — never authorizes.",
    group: "Phase 6 simulation",
    readsChain: false,
  },
  {
    command: "paper:simulation:readiness",
    summary:
      "Structural simulation-stack readiness verdict with eleven verbatim evidence declarations (phase6.simulation.readiness.report.v1). phase7LiveTradingReady is a literal false.",
    group: "Phase 6 simulation",
    readsChain: false,
  },
  {
    command: "paper:simulation:diff:plan",
    summary: "Structured-field-only comparison of two simulation intent plans (simulation.intent.plan.diff.v2).",
    group: "Phase 6 simulation",
    readsChain: false,
  },
  {
    command: "paper:simulation:diff:result",
    summary: "Structured-field-only comparison of two simulation results (simulation.result.diff.v1).",
    group: "Phase 6 simulation",
    readsChain: false,
  },
  {
    command: "paper:simulation:handoff",
    summary:
      "Session handoff over the twelve Phase 6 chain artifacts incl. the route-resolution role via --route (phase6.simulation.handoff.pack.v1). Missing artifacts classified, never invented.",
    group: "Phase 6 simulation",
    readsChain: false,
  },
  {
    command: "paper:simulation:bundle",
    summary:
      "Archiveable OPERATOR BUNDLE over the thirteen chain roles incl. the handoff pack itself (phase6.operator.bundle.v1). Blocking trail RECOMPUTED and cross-checked against the pack (a stale/tampered pack blocks the bundle); per-file sha256-128 integrity digests; best verdict is reviewable-paper-only.",
    group: "Phase 6 simulation",
    readsChain: false,
  },
  {
    command: "paper:simulation:tx",
    summary:
      "The REAL simulateTransaction (sigVerify:false, replaceRecentBlockhash:true) over a strictly-validated UNSIGNED envelope (txpreview.simulation.report.v1). A signed transaction is refused; S95 classifies every failure deterministically (slippage/compute/blockhash/account/program) with the exact next safe action; simulated-ok is evidence for review, never readiness; nothing here can send.",
    group: "Phase 6 simulation",
    readsChain: true,
  },

  // Execution (gated) — the S92/S93 execution lane. Live trading is DISABLED by
  // default behind the fourteen-condition mainnet live gate; mainnet sending has
  // NO CLI surface at all (deliberately). See docs/EXECUTION_SAFETY.md.
  {
    command: "execution:status",
    summary:
      "Resolve and SHOW the execution mode plus the FULL fourteen-condition mainnet live-gate checklist (default BLOCKED) and the core gate. S93: --quote-report + --max-quote-age-ms evaluate condition 9 from a LIVE fetch report. Read-only; can never arm anything.",
    group: "Execution (gated)",
    readsChain: false,
  },
  {
    command: "execution:build",
    summary:
      "REFUSAL-FIRST unsigned swap build: every refusal (kill switch, mode, risk, Token-2022 blockers, caps, slippage, wallet, mint match) evaluates BEFORE any network call; the only artifact is an UNSIGNED txpreview envelope (S93: quotedAt freshness provenance; S95: post-build SHAPE gate — version/blockhash + optional --allowed-programs — and --report-out writes txbuild.report.v1 on BOTH outcomes with codes + next safe actions). Never signs, never sends.",
    group: "Execution (gated)",
    readsChain: true,
  },
  {
    command: "execution:devnet:send",
    summary:
      "The ONLY send surface, DEVNET-ONLY by construction behind a double opt-in (env flag + CLI flag); every attempt journaled. S93: the REAL quote age is computed from the envelope's quotedAt — stale/missing/future refuses; the quoteless self-transfer probe is the only exception. S96: an unaccounted previous session refuses a new send; a submitted attempt stays pending-confirmation until reconciled.",
    group: "Execution (gated)",
    readsChain: true,
  },
  {
    command: "execution:devnet:rehearse",
    summary:
      "The S93 devnet END-TO-END broadcast rehearsal: throwaway gitignored keypair, airdrop, unsigned self-transfer probe, simulation, gated send, confirmation — written as one honest artifact set (an airdrop rate limit is devnet-funding-blocked, never faked success). No mainnet variant exists. S96: every run leaves a reconciliation report + session ledger entries; an unaccounted previous session refuses a new run.",
    group: "Execution (gated)",
    readsChain: true,
  },
  {
    command: "execution:readiness",
    summary:
      "The HONEST mainnet readiness checklist: all fourteen live-gate conditions evaluated against operator-NAMED evidence, every gap named with its exact next safe action. Structurally incapable of reporting armed; no bypass flag, no force flag. S96: reports the last session's reconciliation status as evidence.",
    group: "Execution (gated)",
    readsChain: false,
  },
  {
    command: "execution:session:status",
    summary:
      "S96 read-only session accounting status: the latest execution session's ledger entries and the continuation decision a NEW devnet attempt would face (allowed only after reconciled / not-sent / funding-blocked / an explicit audited acknowledgment). Writes nothing unless --out.",
    group: "Execution (gated)",
    readsChain: false,
  },
  {
    command: "execution:session:reconcile",
    summary:
      "S96 post-trade accounting over the LATEST devnet session: bounded confirmation re-check (transaction-history search), CURRENT balance read, ACTUAL fee from transaction meta, expected-vs-actual verdict (execution.reconciliation.report.v1), appended to the session ledger. READ-ONLY RPC — can never sign, send, or resend; exits 1 while the wall stays closed.",
    group: "Execution (gated)",
    readsChain: true,
  },
  {
    command: "execution:session:acknowledge",
    summary:
      "S96: the EXPLICIT, AUDITED manual exit from a blocked session — appends a manual-acknowledgment ledger entry with your verbatim --reason (>= 10 chars) plus the required --acknowledge-unreconciled-session flag. Refuses when nothing is blocked; erases nothing; no force/bypass variant exists.",
    group: "Execution (gated)",
    readsChain: false,
  },
  // Rust engine (sidecar)
  {
    command: "engine:status",
    summary:
      "S97 Rust sidecar foundation: invoke the solmaker-engine binary over JSON IPC and STRICTLY validate engine.status.report.v1 (CLOSED schema; signer/send/mainnet-send must literally be disabled). No Rust toolchain reports UNAVAILABLE honestly (exit 0 unless --fail-on-unavailable). The engine cannot sign, send, or touch the network by construction.",
    group: "Rust engine (sidecar)",
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
