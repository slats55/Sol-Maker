# Soulmaker Roadmap

Phased, safety-gated plan. Each phase must be **tested and green** before the
next begins. Live trading does not appear until Phase 7, behind every gate in
[`WALLET_SAFETY_MODEL.md`](WALLET_SAFETY_MODEL.md).

Legend: ✅ done · 🟡 in progress · ⬜ not started

---

## Phase 0 — Repository foundation & audit ✅

- ✅ Strict TypeScript pnpm monorepo.
- ✅ Core docs: `README.md`, `SECURITY.md`, `docs/ROADMAP.md`,
  `docs/ARCHITECTURE.md`, `docs/WALLET_SAFETY_MODEL.md`, `docs/RISK_MODEL.md`,
  `docs/REFERENCE_REPO_AUDIT.md`.
- ✅ `.env.example`, `.gitignore`, example config.
- ✅ `test` / `lint` / `typecheck` scripts.
- ✅ Secret redaction utility (`@soulmaker/security`).
- ✅ Config schema (`@soulmaker/core`, Zod).
- ✅ Initial CLI skeleton (`@soulmaker/cli`).
- ✅ No live trading.

## Phase 1 — Safety foundation ✅

- ✅ Config loader with Zod (`loadConfig`).
- ✅ Mode system: `PAPER`, `WATCH_ONLY`, `SIMULATION`, `DANGEROUS_BURNER_LIVE`.
- ✅ Live-mode gate (`evaluateLiveGate` / `assertLiveModeAllowed`, fail-closed).
- ✅ Max trade size, daily loss cap, max open positions, kill switch (schema).
- ✅ Redacted logger.
- ✅ Tests: secrets are redacted; live mode refuses unsafe config; schema
  rejects missing/unsafe live config.

> Phases 0 and 1 are implemented in this commit. Everything below is planned.

## Phase 2 — Solana read-only watcher 🟡 (read-only core complete)

Implemented in `@soulmaker/solana` + the CLI (Sprint 2):

- ✅ Read-only RPC abstraction over `@solana/web3.js`: health, version, SOL
  balance, SPL token accounts (classic + Token-2022), token mint info.
- ✅ Read-only wallet / public-key monitor (`wallet:watch`, `token:accounts`).
- ✅ Token mint inspection (`token:inspect`): decimals, supply, mint authority
  present, freeze authority present, initialized — feeds Phase 3.
- ✅ Public-key validation that **refuses secret-length input** (no private keys).
- ✅ CLI: `solana:doctor`, `wallet:watch`, `token:inspect`, `token:accounts`,
  PAPER-gated with an explicit `--allow-paper-read` override.
- ✅ Deterministic, offline (mocked-RPC) tests; optional live mainnet smoke
  verified manually (read-only).
- ✅ **No live sends. No signer. No key custody.** The client exposes only read
  methods and is a frozen object (a send method cannot be bolted on).
- ⬜ WebSocket streaming + live pool/token-launch **event** abstraction
  (deferred to a later read-only sprint / folded into Phase 3 inputs).

## Phase 3 — Filter & risk engine 🟡 (read-only advisory engine complete)

Implemented in `@soulmaker/risk` + the CLI (Sprint 3):

- ✅ Read-only, advisory **risk flags** from `@soulmaker/solana` mint facts:
  denylisted mint, mint not initialized, freeze authority present (critical);
  mint authority present, unknown token program, suspicious decimals (high);
  supply unparsable, zero supply, previously-traded mint (medium); unknown
  authority/initialization (low); allowlisted, renounced authorities, standard
  SPL / Token-2022 program (info). Deterministic, fully offline-tested.
- ✅ **Allowlist / denylist / previously-traded** support: pure list parser
  (ignores blanks + `# comments`, case-preserving, dedupes); CLI file options.
- ✅ **Advisory score** (0–100, clamped) + decision
  (`REJECT` / `CAUTION` / `PASS_FOR_PAPER_EVALUATION`) with documented weights and
  thresholds. `PASS_FOR_PAPER_EVALUATION` is **not** a live-trading judgment.
- ✅ CLI: `token:risk <mint>` (`--allow-paper-read`, `--allowlist`, `--denylist`,
  `--previously-traded`, `--json`). Read-only; advisory; not a buy recommendation.
- ✅ **No tx build/sign/send. No key custody. No execution SDKs.** Every flag is
  explained; output is redacted as a backstop.
- ⬜ Off-chain / pool-derived flags (metadata mutable, socials, pool size, LP
  burn/lock, deployer denylist) — deferred (need data not available read-only yet).

## Phase 4 — Paper trading engine 🟡 (deterministic simulated engine complete; Sprint 8 journal-continuing runs)

Implemented in `@soulmaker/paper` + the CLI (Sprint 4; Sprint 8 journal continuation):

- ✅ Simulated buy/sell against **injected** prices (weighted-average positions,
  realized + unrealized PnL). No chain, no wallet, no transaction.
- ✅ TP/SL: percent thresholds over the injected price series; trigger event
  always precedes the simulated sell fill.
- ✅ Append-only JSONL **trade journal** (malformed lines skipped + counted;
  state reconstructable via `reduceJournal`).
- ✅ PnL report (realized/unrealized/total, open/closed counts, rejections,
  simulated notional) — human + stable JSON, redacted, always "PAPER ONLY".
- ✅ Risk integration: only `PASS_FOR_PAPER_EVALUATION` may enter a paper buy;
  `CAUTION` blocked by default; missing report ⇒ treated as `REJECT`.
- ✅ Caps + kill switch enforced **before** every simulated action (CLI
  `--kill-switch` OR-ed with the core config kill switch).
- ✅ CLI: `paper:run`, `paper:journal`, `paper:status` (real, replacing the stub).
- ✅ Deterministic (seeded ids + injected clock), fully offline tests.
- ✅ **(Sprint 8) Journal-continuing runs** — `runPaperSession` accepts an optional
  injected `startingState` (cloned, never mutated) so a run can continue an existing
  simulated portfolio: sells/caps/PnL all see the carried-forward positions. CLI
  `paper:run --journal` now reads an existing journal FIRST and strictly derives the
  starting state (`deriveStateFromJournalText`); a malformed line / invalid fill is
  refused **before** anything is appended; a missing journal starts empty; the journal
  is only ever appended to (never truncated or rewritten). This makes `strategy:plan
  --journal` → `paper:run --journal` a real paper-only loop (a journal-derived sell
  candidate now finds its open position instead of being rejected).
- ⬜ Snipe-list **ingestion** wiring (candidates are supplied as fixtures today;
  a live snipe-list source is a later sprint). Still **no real sends**.

## Phase 5 — Strategy rules engine 🟡 (deterministic, paper-only — single + batch + journal-aware + journal-continuing loop + backtest + scenario linting/report stability + report diffing & scenario helpers)

Implemented in `@soulmaker/strategy` + `@soulmaker/backtest` + the CLI (Sprint 5
single-candidate engine; Sprint 6 batch plan pipeline; Sprint 7 journal-aware
planning + richer exits; Sprint 8 journal-continuing loop + deterministic backtest;
Sprint 9 scenario linting, example fixtures, report stability + BOM-tolerant JSON;
Sprint 10 backtest report diffing + deterministic scenario-authoring helpers):

- ✅ Deterministic, **paper-only** rules engine: turns an advisory
  `@soulmaker/risk` report + injected, read-only metrics into a single decision —
  `SKIP` / `WATCH` / `PAPER_BUY_CANDIDATE` / `PAPER_SELL_CANDIDATE` — that feeds
  `@soulmaker/paper` **only**.
- ✅ **Risk gate:** `REJECT` ⇒ always `SKIP`; `CAUTION` ⇒ `SKIP` unless
  `allowCaution`; risk score above `maxRiskScore` ⇒ `SKIP` (never bypassable).
- ✅ **Metric gates** (when configured): liquidity / volume minimums and a max
  absolute price-change band; a configured-but-missing metric is a disqualifier.
- ✅ **Cooldowns:** post-loss ⇒ `SKIP`; post-trade ⇒ capped to `WATCH`.
- ✅ **Position awareness:** `maxOpenPositions` and `maxPositionConcentrationPct`
  block a new paper buy (cap to `WATCH`); held positions run take-profit /
  stop-loss exit rules (`PAPER_SELL_CANDIDATE`).
- ✅ **Score** (0–100, clamped) with documented constants; **disqualifiers always
  override the score** — a high score can never bypass a hard disqualifier.
- ✅ Stable reason/disqualifier ids; injected clock + seeded id ⇒ deterministic,
  no-mutation; fully offline tests.
- ✅ CLI: `strategy:evaluate` (`--candidate`, `--config`, `--paper-state`,
  `--json`). Reads injected local JSON only; refuses missing/malformed input
  cleanly; redacted output; PAPER-ONLY / not-advice disclaimers.
- ✅ **(Sprint 6) Batch plan pipeline** (`plan.ts`): `planStrategyBatch` evaluates
  a `StrategyCandidate[]` and converts only `PAPER_BUY_CANDIDATE` /
  `PAPER_SELL_CANDIDATE` into a deterministic `PaperCandidate[]` (carrying the
  advisory risk report + paper-only provenance). `WATCH`/`SKIP` are never
  converted; disqualifiers can never be bypassed; order and duplicate mints are
  preserved.
- ✅ **(Sprint 6) Candidate-list ingestion** as injected local JSON, and CLI
  `strategy:plan` (`--candidates`, `--config`, `--paper-state`, `--out`, `--size`,
  `--include-skipped`, `--include-watch`, `--json`). Emits a `PaperCandidate[]`
  the operator passes to `paper:run` **manually** — it **does not auto-run paper
  trades**, create fills, or touch the journal. Malformed entries are refused with
  their array index; all output (incl. `--out`) is redacted.
- ✅ **(Sprint 6) Forbidden-import regression test** asserts the package source
  imports no `@solana/web3*`, `fs`/`node:fs`, `http(s)`, or `ws`.
- ✅ **(Sprint 7) Journal-aware planning** — `strategy:plan --journal <path>`
  derives the simulated portfolio from a **read-only** append-only paper journal
  (via `deriveStateFromJournalText` = `parseJournal` + `reduceJournal` + fill
  validation) instead of a `--paper-state` snapshot. The journal is never written
  or mutated; `--journal`/`--paper-state` are mutually exclusive; a malformed
  journal or invalid fill is refused; an empty journal yields the empty state.
- ✅ **(Sprint 7) Richer simulated exits** — a pure exit-decision module
  (`exits.ts`) adds **trailing stop**, **partial/scaled take-profit**, and
  **per-mint position-aware sizing** on top of take-profit/stop-loss, recorded as a
  structured `report.exit` (`FULL_EXIT` / `PARTIAL_EXIT` / `HOLD`). Deterministic,
  pure, backward-compatible; a partial exit always carries a positive sized
  notional or holds.
- ✅ **No tx build/sign/simulate/send. No wallet, RPC, network, or execution SDK.
  No `Date.now` / `Math.random`.** Output is not advice and makes no profitability
  claim.
- ✅ **(Sprint 8) Journal-continuing paper loop** — `strategy:plan --journal` and
  `paper:run --journal` now form a real paper-only loop: planning derives the held
  portfolio from the journal and emits a `PAPER_SELL_CANDIDATE`; the run continues
  from the same journal-derived state and accepts that sell (no more "cannot sell —
  no open simulated position"). See Phase 4 for the engine/CLI details.
- ✅ **(Sprint 8) Deterministic simulated backtest** (`@soulmaker/backtest` +
  `paper:backtest`) — replays an injected, self-contained local JSON scenario
  (embedded strategy config + caps + ordered steps) through the **same** production
  code paths (`planStrategyBatch` → `runPaperSession` with `startingState`,
  `deriveStateFromJournalText`, `reduceJournal`, `summarize`), carrying the simulated
  portfolio forward between steps. Pure (no fs/network/RPC/`Date.now`/`Math.random`),
  byte-stable for a given scenario, and refuses a malformed/empty scenario. The
  report carries the required labels — **SIMULATED PAPER-ONLY REPORT**, *uses
  injected historical data only*, *not a live result*, *not financial advice*, *not
  a profitability claim*. A new package because the backtest orchestrates BOTH
  strategy and paper (it sits above each); neither depends on it, so there is no
  cycle and `@soulmaker/strategy` keeps its "never runs a paper session" contract.
- ✅ **(Sprint 9) Scenario validator + linter** — `@soulmaker/backtest` exports
  `validateBacktestScenario` (throwing) and `lintBacktestScenario` (structured
  `{ valid, errors, warnings, summary }`), both built on one shared collecting core
  so they never disagree. **Errors** block a run (structural problems + a malformed
  embedded journal); **warnings** flag suspicious-but-allowed design (missing trade
  sizing, non-monotonic timestamps, duplicate step ids, duplicate mints, empty
  candidate/price arrays, kill switch on, zero caps, `allowCaution`, extreme exit
  thresholds, a seed journal with open positions/realized PnL, …). Pure,
  deterministic, non-mutating. CLI `paper:backtest:lint --scenario <path> [--json]`
  (errors refuse, exit 1; warnings stay runnable).
- ✅ **(Sprint 9) Report stability + richer structure** — `BacktestReport` gains a
  stable `schemaVersion` (`backtest.report.v1`), a deterministic non-cryptographic
  `scenarioDigest` (canonical content hash, for reproducibility — **not** security),
  a per-step `equityCurve`, **exact** per-mint aggregates (`perMint`; realized PnL
  recomputed from each mint's own fills — never invented), and the scenario
  `warnings`. The human report is sectioned (Scenario / Warnings / Summary / Equity
  curve / Per-mint / Open positions / Steps / Notes) and JSON stays byte-stable.
- ✅ **(Sprint 9) BOM-tolerant JSON parsing** — the CLI's local JSON readers (and
  journal reads) tolerate a single leading UTF-8 BOM (`stripJsonBom`) so files saved
  by Windows editors / `Set-Content -Encoding utf8` parse; malformed JSON still
  refuses (no loose normalization, never strips a mid-content BOM).
- ✅ **(Sprint 9) External seed journal** — `paper:backtest --seed-journal <path>`
  seeds the starting state from a separate JSONL journal, composed onto a scenario
  copy at the CLI layer (the pure engine stays scenario-driven). Mutually exclusive
  with an embedded `initialJournal` (both ⇒ refuse); read strictly; never written;
  the scenario file is never modified.
- ✅ **(Sprint 9) Example fixtures** — `examples/backtest/` ships small, INJECTED,
  deterministic example scenarios (buy & hold, buy & full exit, multi-mint partial
  exit + hold + reject, seed-journal continuation) with a README. They are fixtures,
  **not** historical market truth.
- ✅ **(Sprint 10) Backtest report diffing** — `@soulmaker/backtest` exports
  `validateBacktestReport`, `diffBacktestReports(base, next)`, and
  `formatBacktestReportDiff`; the CLI adds `paper:backtest:diff --base <a> --next <b>
  [--json] [--fail-on-regression]`. It reads ONLY the two report files (BOM-tolerant,
  malformed refused), runs no backtest, and produces metadata/compatibility, summary
  deltas, a warning/equity/per-mint diff, and a **conservative** `hasRegression`
  flag. Every delta is a bookkeeping difference between two **simulations** — not a
  prediction, not profit/loss, not advice. `--fail-on-regression` exits non-zero only
  when `hasRegression` is true; a different `scenarioDigest` is "different scenario",
  not a regression.
- ✅ **(Sprint 10) Deterministic scenario-authoring helpers** — `@soulmaker/backtest`
  exports `listBacktestScenarioTemplates`, `buildExampleBacktestScenario(template)`,
  and `expandScenarioMatrix(base, matrix)`; the CLI adds
  `paper:backtest:scenario:new --template <name> --out <path>` (built-in templates:
  buy-hold, buy-full-exit, partial-exit, seed-journal-continuation) and
  `paper:backtest:scenario:matrix --base <a> --matrix <m> --out-dir <d>`. These are
  deterministic INJECTED fixtures (fake mints + injected prices — **not** real
  historical data, no keys/wallets); the matrix patch system is intentionally tiny
  and safe (config-only: `strategyConfig`/`caps`/`defaultPaperSizeUsd`; never code,
  never `steps`/`name`/`initialJournal`). Every generated scenario validates; files
  are not overwritten without `--force`.
- ⬜ **Live** snipe-list source (scraping / network fetch) — deferred; explicitly
  out of scope (candidates remain injected local JSON).

## Phase 6 — Transaction planning & simulation ⬜ (NOT started)

> Note: "Sprint 6" in this repo delivered the **strategy → paper plan pipeline**
> (an extension of Phase 5, above), **not** this roadmap phase. Transaction
> planning/simulation remains entirely unstarted — by design.

- ⬜ Transaction **plan** object (explicit destinations, amounts, fees).
- ⬜ Human-readable preview (no blind signing).
- ⬜ Simulation interface (`simulateTransaction`).
- ⬜ **Still no sending.** Tests prove unsafe plans are rejected.

## Phase 7 — Burner-wallet live mode ⬜ (NOT started)

- ⬜ Only after Phases 0–6 are green.
- ⬜ Live sending behind explicit `DANGEROUS_BURNER_LIVE`.
- ⬜ Requires a **fresh burner** secret; refuses main-wallet-style config.
- ⬜ Enforce caps **before** building/sending.
- ⬜ Simulate before send; log signatures + risk flags (redacted).

## Phase 8 — Web dashboard ⬜

- ⬜ Local web UI (`apps/web`).
- ⬜ Phantom via Solana Wallet Adapter — **watch-only** first.
- ⬜ Balances, positions, logs, risk flags, transaction preview.
- ⬜ **Manual approve** flow preferred over raw key custody.

---

## Definition of done (every phase)

1. `pnpm check` (typecheck + lint + test) is green.
2. New safety behavior has explicit tests, including negative tests.
3. Docs updated (this file + any model docs the phase touches).
4. No secret can reach a log or a committed file.
5. Small, reviewable commit(s).
