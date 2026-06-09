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

## Phase 5 — Strategy rules engine 🟡 (deterministic, paper-only — single + batch + journal-aware + journal-continuing loop + backtest + scenario linting/report stability + report diffing & scenario helpers + suite runs & suite diffing)

Implemented in `@soulmaker/strategy` + `@soulmaker/backtest` + the CLI (Sprint 5
single-candidate engine; Sprint 6 batch plan pipeline; Sprint 7 journal-aware
planning + richer exits; Sprint 8 journal-continuing loop + deterministic backtest;
Sprint 9 scenario linting, example fixtures, report stability + BOM-tolerant JSON;
Sprint 10 backtest report diffing + deterministic scenario-authoring helpers;
Sprint 11 backtest suite runs + suite diffing over directories of injected scenarios;
Sprint 12 deterministic scenario variant generation + suite-over-variants;
Sprint 13 variant-sensitivity workflow + report over the base + its variants;
Sprint 14 paper research lab — sensitivity rankings, variant-plan explain (dry-run),
sensitivity-report diffing, allowlisted config-field perturbations, suite coverage;
Sprint 15 cross-scenario sensitivity matrix — sweep many bases through one plan,
aggregate every (base × variant) cell, diff two matrices;
Sprint 16 research run manifest — index/verify/diff a run's local artifacts for
reproducibility;
Sprint 17 research run bundle + integrity/status — package a run into one self-describing
bundle with a deterministic top-level run digest, plus a quick complete/recognized/stable/
in-sync directory status;
Sprint 18 research campaign index — index many runs under a campaign directory into one
comparable summary with a deterministic top-level campaign digest;
Sprint 19 research bundle diff + campaign index diff — compare two bundles or two campaign
indexes with a conservative regression flag;
Sprint 20 research campaign history report — fold an ordered set of campaign index snapshots
into one deterministic trend report with per-run streaks and a conservative regression signal;
Sprint 21 research portfolio rollup — roll up many per-campaign history reports into one
integrity-triage portfolio view with clean/stable lists, top concerns, and CI flags):

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
- ✅ **(Sprint 11) Backtest suite runs** — `@soulmaker/backtest` exports
  `runBacktestSuite(input)`, `buildBacktestSuiteIndex(result)`, and
  `formatBacktestSuiteIndex`; the CLI adds `paper:backtest:suite --dir <scenarios/>
  [--out-dir <reports/>] [--json] [--fail-on-error] [--force]`. The CLI reads a
  directory of `*.scenario.json` files (sorted by filename, BOM-tolerant; a malformed
  file refuses the whole suite) and the **pure** package runs each through the same
  `lint → runBacktest → validate` paths: a lint error fails+skips a scenario, a
  warning still runs, and a runtime error fails just that one entry without crashing
  the suite. The byte-stable `suite-index.json` aggregates passed/failed counts,
  summed fills, and summed simulated PnL — every total is simulated bookkeeping over
  injected prices, **not** a live result, advice, or a profitability claim. With
  `--out-dir` it writes one report per PASSED scenario plus the index (never a
  journal/fills; preflighted so it never writes partial output).
- ✅ **(Sprint 11) Backtest suite diffing** — `@soulmaker/backtest` exports
  `validateBacktestSuiteIndex`, `diffBacktestSuites(base, next)`, and
  `formatBacktestSuiteDiff`; the CLI adds `paper:backtest:diff:suite --base-dir <a/>
  --next-dir <b/> [--json] [--fail-on-regression]`. It reads ONLY each directory's
  `suite-index.json` (BOM-tolerant; missing/malformed refused), runs no backtests, and
  pairs entries by digest → name → file to produce added/removed/changed scenarios,
  aggregate deltas, and a **conservative** `hasRegression` flag. A SAME-digest result
  drift is a regression (a deterministic replay should be byte-identical); a different
  scenario (different content) is "changed", **not** a regression. `--fail-on-regression`
  exits non-zero only when `hasRegression` is true.
- ✅ **(Sprint 12) Deterministic scenario variant generator** — `@soulmaker/backtest`
  exports `generateScenarioVariants(base, plan)`; the CLI adds
  `paper:backtest:scenario:variants --base <a> --plan <p> --out-dir <d> [--force]
  [--json]`. It applies a small, declarative plan of **bounded numeric perturbations**
  to a base scenario's injected data: each perturbation `multiply`s or `add`s a finite
  delta to a `price` (every injected `priceUsd`) or `metric.<field>` (an allowlisted
  candidate metric), clamped to explicit `[min, max]` bounds, optionally filtered by
  `mint`. It is **pure** — no RNG of any kind, no `Date.now`, no live/historical data,
  no network, no expression/`eval`, no input mutation; output is byte-stable and in
  plan order. It only touches numbers that already exist (an absent field is never
  created and a perturbation that matches nothing is **refused**, not silently
  ignored); `name`, the `steps` structure, `initialJournal`, and config are protected,
  so each variant's name derives from the base name + suffix and the base's INJECTED
  labelling always survives. Every variant validates through the same scenario path;
  the CLI preflights all targets (internal collisions + pre-existing files) before
  writing any (no partial output, no overwrite without `--force`). Variants are
  simulated local scenario data — not a live result, not advice, not a profitability
  claim — and feed straight into `paper:backtest:suite` + `paper:backtest:diff:suite`
  (a deferred Sprint 11 Part-5 item, now shipped as its own focused sprint).
- ✅ **(Sprint 13) Variant-sensitivity workflow** — `@soulmaker/backtest` exports
  `runScenarioVariantSensitivity({ base, plan })`,
  `buildScenarioVariantSensitivityReport`, `validateScenarioVariantSensitivityReport`,
  and `formatScenarioVariantSensitivityReport` (schema `backtest.sensitivity.v1`); the
  CLI adds `paper:backtest:sensitivity --base <a> --plan <p> [--out-dir <d>] [--force]
  [--json]`. It ties Sprint 11 + Sprint 12 into one report layer: it generates the
  variants with the SAME `generateScenarioVariants`, runs the **base scenario once as
  a baseline** plus every variant through the SAME `runBacktestSuite` path (lint →
  `runBacktest` → validate), and summarizes each variant's simulated outputs and its
  **per-field delta versus the baseline** (fills, rejects, realized/unrealized/total
  simulated PnL, notional, open/closed positions). It is **pure** and non-mutating —
  no RNG, no `Date.now`, no network, no timestamps — so an identical input yields a
  byte-identical report; no backtest/suite/variant logic is re-implemented. With
  `--out-dir` the CLI writes `variants/`, one `reports/<id>.report.json` per scenario,
  `reports/suite-index.json`, and `sensitivity-report.json`, preflighting every target
  (internal collisions + pre-existing files) before writing any (no partial output, no
  overwrite without `--force`). A delta is the change between two simulated runs — not
  a prediction, not advice, not a profitability claim.
- ✅ **(Sprint 14) Paper research lab** — five focused, PAPER-only research slices on
  top of Sprints 11–13, all **pure** (no fs/network/RPC/`Date.now`/`Math.random`),
  byte-stable, and non-mutating:
  - **Sensitivity rankings.** The `backtest.sensitivity.v1` report now carries a
    deterministic `rankings` block ordering the diffable variants by the magnitude of
    each simulated bookkeeping delta vs the baseline (`byTotalSimulatedPnlDelta`,
    `by{Realized,Unrealized}SimulatedPnlDelta`, `byFillDelta`, `byRejectDelta`,
    `byWarningDelta`, `byNotionalDelta`). Every dimension maps to a REAL existing delta;
    ties resolve stably by suffix then digest; it is the *largest movement*, never a
    "best"/"winner"/"most profitable" ordering.
  - **Variant-plan explain (dry-run).** `explainScenarioVariantPlan` +
    `validate`/`format` (schema `backtest.variant-plan.explain.v1`) and CLI
    `paper:backtest:scenario:variants:explain --base <a> --plan <p> [--json]` explain
    what generation WOULD do — each perturbation's target/op/value/bounds/mint and how
    many injected values it would change — **without** generating files or running a
    backtest. It reuses the SAME validation as generation; a matched-nothing
    perturbation is reported (`valid:false`, exit 1) instead of thrown so the whole plan
    is inspectable at once.
  - **Sensitivity diff.** `diffScenarioVariantSensitivityReports` + `validate`/`format`
    (schema `backtest.sensitivity.diff.v1`) and CLI `paper:backtest:diff:sensitivity
    --base <a> --next <b> [--json] [--fail-on-regression]` diff two sensitivity reports
    (paired by suffix) with a **conservative** `hasRegression` flag: a same-digest
    variant should replay byte-identically so any drift is a regression, while a
    changed-content variant is "changed", not a regression. Validation is lenient on
    `schemaVersion` so a version mismatch is surfaced, not refused.
  - **Config perturbations.** `generateScenarioVariants` gained a third target form,
    `"config.<field>"`, over a CLOSED, unambiguous allowlist of numeric config fields
    (`config.maxTradeSizeUsd`, `config.takeProfitPct`, …) — no arbitrary dotted paths,
    no `maxOpenPositions` (ambiguous), no mint filter; an absent/non-numeric field
    matches nothing and is refused, and the perturbed variant must still validate.
  - **Suite coverage.** `summarizeBacktestSuiteCoverage` + `validate`/`format` (schema
    `backtest.coverage.v1`) and CLI `paper:backtest:suite:coverage --suite-index <p>
    [--json]` report which simulated paper paths a suite exercised (per-behaviour
    counts, any-behaviour flags, scenario lists, and a transparently-derived
    path-behaviour ratio) using ONLY existing index fields. Explicitly **behavioural
    bookkeeping** coverage — **not** market coverage, **not** test/code coverage, **not**
    a profitability claim.
- ✅ **(Sprint 15) Cross-scenario sensitivity matrix** — `@soulmaker/backtest` exports
  the pure `runScenarioVariantSensitivityMatrix({ name?, bases, plan })`,
  `buildScenarioVariantSensitivityMatrixReport`, `validate…`, and `format…` (schema
  `backtest.sensitivity.matrix.v1`); the CLI adds `paper:backtest:sensitivity:matrix
  --dir <scenarios> --plan <p> [--out-dir <d>] [--force] [--json] [--fail-on-error]`. It
  sweeps SEVERAL injected base scenarios through ONE shared variant plan — each base via
  the EXACT Sprint 13 workflow — and aggregates every `(base × variant)` cell into one
  deterministic, byte-stable, non-mutating report: per-base rows (baseline + cells),
  per-variant **cross-base** delta aggregates (`count`/`sum`/signed `min`・`max`/
  `meanMagnitude`/`maxMagnitude`), and neutral cross-base rankings (largest movement,
  never a "best"/"winner"). It is rectangular by construction (the runner asserts every
  base produced the same ordered suffix set) and conservative: a base that is invalid or
  incompatible with the plan refuses the WHOLE matrix (named) before any aggregate is
  built — no partial matrix. `--out-dir` writes a preflighted
  `sensitivity-matrix-report.json` + `bases/<id>.sensitivity-report.json` tree (overwrite
  refused without `--force`; never a journal). A companion matrix diff —
  `diffScenarioVariantSensitivityMatrixReports` + `validate`/`format` (schema
  `backtest.sensitivity.matrix.diff.v1`) and CLI `paper:backtest:diff:sensitivity:matrix
  --base <a> --next <b> [--json] [--fail-on-regression]` — pairs bases by id and cells by
  suffix with the same conservative regression model (a removed passed base, a
  newly-failing or same-digest-drifted base/cell, or a schema mismatch is a regression; a
  changed-content base and a cross-base aggregate change are not). The package stays pure
  (the CLI layer does all directory IO). Every number is simulated bookkeeping — not a
  live result, not advice, not a profitability claim.
- ✅ **(Sprint 16) Research run manifest & artifact index** — a reproducibility/audit layer
  over the local artifacts the PAPER-only research commands produce. `@soulmaker/backtest`
  exports the pure `classifyBacktestArtifact`, `buildBacktestResearchManifest`,
  `validate…`, `format…`, and `verifyBacktestResearchManifest` (schemas
  `backtest.research.manifest.v1` and `backtest.research.verify.v1`), plus
  `diffBacktestResearchManifests` (schema `backtest.research.manifest.diff.v1`); the CLI adds
  `paper:backtest:research:manifest --dir <d> [--out <m>] [--force] [--json] [--strict]`,
  `paper:backtest:research:verify --manifest <m> --dir <d> [--json]`, and
  `paper:backtest:diff:research:manifest --base <a> --next <b> [--json] [--fail-on-change]`.
  The pure package accepts already-loaded artifact DESCRIPTORS (path + kind + schemaVersion +
  digest + sizeBytes) and aggregates a deterministic, byte-stable manifest (sorted artifacts,
  kind/schema counts, reproducibility warnings); the CLI is the only layer that walks the
  directory (real subdirs only, symlinks skipped, BOM-tolerant, `*.json` only — never a
  `*.jsonl` journal), classifies each file, and fingerprints it with the existing
  non-cryptographic {@link digestContent}. The digest is labelled honestly as
  reproducibility-only (NOT a security/anti-tamper hash); a malformed file is indexed as
  `unknown-json` (never a crash); and research-manifest META files are excluded so a manifest
  written into its own directory never indexes itself (and verify never flags it as extra).
  `verify` recomputes digests/sizes and reports missing/changed/extra/schema-mismatch with a
  VALID/INVALID exit; everything is local bookkeeping — not a live result, not advice, not a
  profitability claim.
- ✅ **(Sprint 17) Research run bundle & integrity/status** — a self-describing summary layer
  **above** the Sprint 16 manifest. `@soulmaker/backtest` exports the pure
  `buildBacktestResearchRunDigest`, `buildBacktestResearchBundle`, `validate…`, `format…`
  (schema `backtest.research.bundle.v1`) and `buildBacktestResearchStatus`, `validate…`,
  `format…` (schema `backtest.research.status.v1`); the CLI adds
  `paper:backtest:research:bundle --dir <d> [--out <b>] [--force] [--json] [--strict]` and
  `paper:backtest:research:status --dir <d> [--manifest <m>] [--json] [--strict]`. The **bundle**
  reuses the manifest builder, then adds a manifest summary (with a manifest digest), kind +
  schema counts, the recognized-schema set, unknown/malformed counts, the sorted per-artifact
  digest references, and one deterministic top-level **run digest** over the sorted artifact
  metadata — identical artifact sets ⇒ an identical run digest; a single changed artifact digest
  changes it. The **status** answers, at a glance, whether the directory is COMPLETE (has
  artifacts), RECOGNIZED (every file classified), STABLE (no unparseable files), and IN SYNC
  with a recorded manifest (drift = missing/extra/digest-/schema-/size-changed), plus one NEUTRAL
  recommended action (operational, never trading advice). The bundle embeds **no artifact
  contents**; the status **writes nothing**; both reuse the same non-cryptographic,
  reproducibility-only digest; the package stays pure (the CLI walks the directory, excludes all
  research META files — manifest/verify/diff/bundle/status — and never reads a `*.jsonl`). Local
  bookkeeping — not a live result, not advice, not a profitability claim.
- ✅ **(Sprint 18) Research campaign index** — a cross-run summary layer **above** the Sprint 17
  per-run bundle/status. `@soulmaker/backtest` exports the pure
  `buildBacktestResearchCampaignIndex`, `validate…`, `format…`, and `buildBacktestResearchCampaignDigest`
  (schema `backtest.research.campaign.index.v1`); the CLI adds
  `paper:backtest:research:index --dir <campaign> [--out <i>] [--force] [--json] [--strict]`.
  Each **immediate child directory** of the campaign dir is treated as a run; the command reuses
  the Sprint 17 bundle + status builders per run to derive its run digest, artifact/kind/schema
  counts, unknown/malformed totals, and complete/recognized/stable/in-sync health (a conventional
  `research-manifest.json` is discovered for drift). The index aggregates the kind/schema sets and
  counts across the campaign, lists the **runs needing attention**, and emits one deterministic
  top-level **campaign digest** over the sorted run digests + stable metadata — identical run sets
  ⇒ an identical campaign digest; an added / removed / changed run (or a validity flip) moves it.
  A merely unhealthy run is counted as needing attention; a structurally bad run is captured as an
  invalid, errored run rather than crashing the campaign. `--strict` exits non-zero when any run
  needs attention. The index embeds **no artifact contents**; the package stays pure (the CLI
  walks the campaign, skips symlinked/hidden child dirs, excludes all research META files — now
  including the campaign index — and never reads a `*.jsonl`); the campaign digest is the same
  non-cryptographic, reproducibility-only fingerprint. Local bookkeeping — not a live result, not
  advice, not a profitability claim.
- ✅ **(Sprint 19) Research bundle diff & campaign index diff** — the diff layer that completes
  the manifest→diff / bundle→diff / campaign→diff symmetry. `@soulmaker/backtest` exports the pure
  `diffBacktestResearchBundles`, `validate…`, `format…` (schema `backtest.research.bundle.diff.v1`)
  and `diffBacktestResearchCampaignIndexes`, `validate…`, `format…` (schema
  `backtest.research.campaign.diff.v1`); the CLI adds
  `paper:backtest:diff:research:bundle --base <b> --next <b> [--json] [--fail-on-change] [--fail-on-regression]`
  and `paper:backtest:diff:research:index --base <i> --next <i> [--json] [--fail-on-change] [--fail-on-regression]`.
  The **bundle diff** pairs artifacts by path (added / removed / digest-changed) and reports the
  run-digest change, aggregate kind/schema/recognized-schema changes, and count deltas. The
  **campaign diff** pairs runs by runId (added / removed / changed) and reports per-run
  digest/valid/attention changes, the campaign-digest change, aggregate kind/schema changes, and
  count deltas. Both carry a `hasChange` flag AND a **conservative** `hasRegression` flag — a
  regression is integrity breakage only (a removed/changed artifact, a removed valid run, a run
  going valid→invalid, an unexpected digest change, an unknown/malformed increase, or an
  incompatible schema); a purely additive new run/artifact is a change, **not** a regression.
  `--fail-on-change` exits non-zero on any difference; `--fail-on-regression` only on a regression.
  Each reads ONLY the two named files and **writes nothing**; the package stays pure (no fs/net,
  no `Date.now`/`Math.random`; the formatters redact internally). Local bookkeeping — not a live
  result, not advice, not a profitability claim.
- ✅ **(Sprint 20) Research campaign history report** — the TIME layer **above** the Sprint 19
  campaign diff. `@soulmaker/backtest` exports the pure `buildBacktestResearchCampaignHistoryReport`,
  `validate…`, `format…` (schema `backtest.research.campaign.history.report.v1`); the CLI adds
  `paper:backtest:research:history --index <i> … [--baseline first|previous|<path>] [--json] [--fail-on-change] [--fail-on-regression] [--fail-on-attention] [--fail-on-new-attention]`.
  It takes an **ordered** set of campaign index snapshots (each strictly validated as a Sprint 18
  `backtest.research.campaign.index.v1`; a non-index / wrong-schema file is refused), walks each
  run's trajectory across them — first/last seen, present + valid + attention now, ever-needed-
  attention, current **valid** and **attention streaks**, and digest-change count — and REUSES the
  Sprint 19 `diffBacktestResearchCampaignIndexes` verbatim for the **since-baseline** and
  **since-previous** deltas, so `hasChange` and the **conservative** `hasRegression` are
  byte-identical to the diff (never re-derived or over-claimed). The report surfaces the runs
  added / removed / changed / newly-needing-attention / recovered since baseline, the runs needing
  attention **now**, the runs with a conservative regression, and the longest valid / attention
  streak leaders. `--baseline` picks the reference snapshot (default `first`); the `--fail-on-*`
  flags set a non-zero exit for change / regression / current attention / new attention. Each reads
  ONLY the named files (in order) and **writes nothing**; the package stays pure (no fs/net, no
  `Date.now`/`Math.random`; the formatter redacts internally). Local bookkeeping — not a live
  result, not advice, not a profitability claim; the conservative regression flag is an
  integrity/reproducibility signal, never a trading recommendation.
- ✅ **(Sprint 21) Research portfolio rollup** — the BREADTH layer **above** the Sprint 20 history
  report. `@soulmaker/backtest` exports the pure `buildBacktestResearchPortfolioReport`, `validate…`,
  `format…` (schema `backtest.research.portfolio.report.v1`); the CLI adds
  `paper:backtest:research:portfolio --history <campaignId=path> … [--json] [--fail-on-change] [--fail-on-regression] [--fail-on-attention] [--fail-on-new-attention]`.
  It takes many per-campaign history reports (each strictly validated as a Sprint 20
  `backtest.research.campaign.history.report.v1`; a non-history / wrong-schema file or a duplicate
  campaign id is refused) and carries **verbatim** each campaign's change / attention / regression /
  streak / count signals — so the portfolio view can never disagree with the reports it summarizes.
  It derives a per-campaign severity status (regression > attention > changed > clean), emits the
  rollup in **integrity-triage order** (most-concerning first — NOT a trading ranking), lists the
  clean (no concern) and stable (no change) campaigns, surfaces the top integrity concerns, and sums
  run totals **across** campaigns (run ids are campaign-scoped and never de-duplicated). The
  `--fail-on-*` flags set a non-zero exit for change / regression / current attention / new attention
  across the portfolio. It reads ONLY the named files and **writes nothing**; the package stays pure
  (no fs/net, no `Date.now`/`Math.random`; the formatter redacts internally). Local bookkeeping —
  not a live result, not advice, not a profitability claim; the conservative regression flag is an
  integrity/reproducibility signal, never a trading recommendation.
- ✅ **(Sprint 22) Research portfolio diff** — the comparison layer that closes the research-stack
  symmetry (index · campaign diff · history · portfolio · **portfolio diff**). `@soulmaker/backtest`
  exports the pure `diffBacktestResearchPortfolioReports`, `validateBacktestResearchPortfolioDiff`,
  `formatBacktestResearchPortfolioDiff` (schema `backtest.research.portfolio.diff.v1`); the CLI adds
  `paper:backtest:diff:research:portfolio --base <path> --next <path> [--json] [--fail-on-change] [--fail-on-regression] [--fail-on-attention] [--fail-on-new-attention]`.
  Both inputs are strictly validated as a Sprint 21 `backtest.research.portfolio.report.v1` (a
  non-portfolio / wrong-schema / duplicate-id file is refused). It separates two axes: **campaign-set
  membership** (campaigns added / removed / common) and **status transitions over the campaigns
  present in BOTH** (newly regressed / recovered / newly-or-no-longer needing attention / newly clean
  / newly stable), plus the aggregate count deltas. The conservative flags are honest and never
  overclaimed: a **disappearing** campaign is a change / scope change, **not** a regression; an
  **added** campaign that already carries a regression sets `hasChange` (gated by `--fail-on-change`),
  not `hasRegression` (there is no base state for it to have regressed from); `hasRegression` fires
  only when a **common** campaign transitions into a conservative regression. The `--fail-on-*` flags
  set a non-zero exit for change / regression / current attention / new attention. It reads ONLY the
  two named files and **writes nothing**; the package stays pure (no fs/net, no
  `Date.now`/`Math.random`; the formatter redacts internally). Local bookkeeping — not a live result,
  not advice, not a profitability claim.
- ✅ **(Sprint 23) Research artifact pack** — the navigation + integrity SUMMARY layer over the whole
  research stack. `@soulmaker/backtest` exports the pure `buildBacktestResearchArtifactPack`,
  `validateBacktestResearchArtifactPack`, `formatBacktestResearchArtifactPack` (schema
  `backtest.research.artifact.pack.v1`); the CLI adds
  `paper:backtest:research:pack --artifact <label=path> … [--json] [--fail-on-change] [--fail-on-regression] [--fail-on-attention] [--fail-on-new-attention] [--fail-on-unsupported] [--fail-on-missing-recommended-layer] [--out <path>] [--force]`.
  It collects an already-loaded set of the **real** research artifacts (manifest, bundle, status,
  campaign index, campaign diff, campaign history, portfolio report, portfolio diff), classifies each
  by its `schemaVersion`, STRICTLY validates a known artifact (a corrupt artifact claiming a known
  schema is refused), reports an unknown schema as an `unsupported` entry (never silently trusted),
  and reads each artifact's high-level change / regression / attention / recovery flags **verbatim**.
  It rolls those into one navigable view: a per-artifact inventory (kind / recognized / status /
  flags / reasons), the aggregate counts, **chain coverage** (which recommended layers are present /
  missing, and whether the pack is minimal / campaign-level / portfolio-level / diff-ready — presence
  only, never a completeness claim), a CI decision, and a compact navigation table. The `--fail-on-*`
  flags gate CI; `--out` writes ONLY the pack JSON (refusing overwrite without `--force`, creating no
  directories) and is omitted-by-default (writes nothing). It reads the named files only and never
  follows nested paths or makes a network call; the package stays pure (no fs/net in the module, no
  `Date.now`/`Math.random`; the formatter redacts internally). Local bookkeeping over a set of local
  artifacts — not a live result, not advice, not a profitability claim.
- ✅ **(Sprint 24) Research artifact pack diff** — the comparison layer that closes the pack
  symmetry. `@soulmaker/backtest` exports the pure `diffBacktestResearchArtifactPacks`,
  `validateBacktestResearchArtifactPackDiff`, `formatBacktestResearchArtifactPackDiff` (schema
  `backtest.research.artifact.pack.diff.v1`); the CLI adds
  `paper:backtest:diff:research:pack --base <path> --next <path> [--json] [--fail-on-change] [--fail-on-regression] [--fail-on-attention] [--fail-on-new-attention] [--fail-on-unsupported]`.
  Both inputs are strictly validated as Sprint 23 packs (a non-pack / wrong-schema / duplicate-label
  input is refused), then artifacts are paired by their stable `label` across two axes: artifact-set
  membership (added / removed / common) and per-artifact transitions over the common set only (newly
  changed / regressed / recovered / newly need attention / newly unsupported, plus kind / source /
  status changes). `hasRegression` is conservative — true only for a COMMON artifact that transitions
  into a regression; a disappearing artifact is a scope change and an added artifact arriving regressed
  sets `hasChange`, not `hasRegression`. A newly unsupported artifact (a common artifact that lost
  recognition, or an added unsupported artifact) sets `hasUnsupported` and is gated by
  `--fail-on-unsupported`. It reports aggregate count deltas and chain-coverage changes and emits a CI
  decision; it reads the two named files only and **writes nothing**; the package stays pure (no
  fs/net, no `Date.now`/`Math.random`; the formatter redacts internally). Local bookkeeping over two
  local summaries — not a live result, not advice, not a profitability claim.

### Sniper decision-support path (PAPER-only, offline) — `@soulmaker/sniper`

> The product direction the research/PAPER foundation supports: candidate intake → token preflight →
> paper-only decisions → operator workflow, all offline and behind the live boundary. See
> [`SNIPER_MODEL.md`](SNIPER_MODEL.md). Nothing here holds a key or builds/signs/sends a transaction.

- ✅ **(Sprint 25) Sniper candidate intake** — a NEW pure, offline package `@soulmaker/sniper`
  (deps: only `@soulmaker/security`) with **no chain capability** (no `@solana/web3.js`, no
  `@soulmaker/solana`; a forbidden-import test enforces this). Exports `normalizeSniperCandidateList`,
  `validateSniperCandidateList`, `formatSniperCandidateList`, `parseMintAddress` / `isValidMintAddress`
  (schema `sniper.candidate.list.v1`); the CLI adds
  `paper:sniper:candidates:validate --input <path> [--json] [--fail-on-warning]`. Every mint is
  validated as a 32-byte Solana public key by a pure base58 decoder mirroring `@soulmaker/solana`'s
  safety semantics (secret-length / private-key-like input is refused before decoding and never
  echoed); candidate ids must be unique; duplicate mints are surfaced as warnings; operator-supplied
  liquidity / market / social / observed context is intake metadata that is **NOT verified on-chain**
  here. Deterministic, no wall-clock time, no mutation; the CLI reads the named file only and writes
  nothing. Intake validation — not a trade signal, not a verified on-chain fact, not advice.
- ✅ **(Sprint 26) Sniper token preflight** — a read-only safety/research summary per candidate.
  `@soulmaker/sniper` exports `buildSniperTokenPreflightReport`, `validateSniperTokenPreflightReport`,
  `formatSniperTokenPreflightReport` (schema `sniper.token.preflight.report.v1`); the CLI adds
  `paper:sniper:preflight --candidates <path> [--inspection candidateId=path] [--risk candidateId=path]
  [--json] [--out <path>] [--force] [--fail-on-fail] [--fail-on-warning]`. The pure builder combines
  each mint's validity with an ALREADY-LOADED read-only inspection (existing `token:inspect` output)
  and advisory risk report (existing `token:risk` output) into a conservative `pass` / `warn` / `fail`
  / `unknown` status (risk `REJECT` or a critical flag = fail; `CAUTION` / freeze-or-mint authority /
  high flag = warn; no data = unknown). LOCAL-ONLY — no RPC, no network, no wallet; the package still
  carries no chain capability. A live `--read-only-rpc` mode is deferred (CI can't depend on the
  network), not faked. Writes nothing unless `--out`. A `pass` is NOT a "safe to trade" judgment and
  NOT a trade signal.
- ✅ **(Sprint 27) Paper-only sniper decisions** — the first real sniper-bot-shaped step.
  `@soulmaker/sniper` exports `buildPaperSniperDecisionReport`, `validatePaperSniperDecisionReport`,
  `formatPaperSniperDecisionReport` (schema `sniper.paper.decision.report.v1`); the CLI adds
  `paper:sniper:decide --candidates <path> [--preflight <path>] [--rules <path>] [--json] [--out <path>]
  [--force] [--fail-on-paper-enter] [--fail-on-risk]`. The pure builder folds a validated candidate
  list + an optional preflight + deterministic operator rules (`requirePreflightPass` / `maxRiskScore`
  / `minObservedLiquidityUsd` / `denyMints`) into a per-candidate SIMULATED `skip` / `watch` /
  `paper-enter` / `paper-reject` / `unknown` decision with reasons, blocking risk flags, applied rules,
  and assumptions. A candidate reaches `paper-enter` only when the preflight passed and every rule is
  satisfied. It re-derives no risk and reads no chain (it consumes the preflight). A `paper-enter` is a
  paper-only decision — NOT a buy/sell order, NOT a transaction, NOT live readiness. Writes nothing
  unless `--out`.
- ✅ **(Sprint 28) Sniper operator workflow** — a read-only helper + runbook tying the path together.
  `@soulmaker/sniper` exports `buildSniperWorkflowPlan`, `validateSniperWorkflowPlan`,
  `formatSniperWorkflowPlan` (schema `sniper.workflow.plan.v1`); the CLI adds
  `paper:sniper:workflow [--candidates <path>] [--preflight <path>] [--decision <path>] [--json]`,
  which checks which local artifacts exist + validate (read-only) and prints each stage's status
  (`done` / `ready` / `blocked` / `todo`) + the recommended NEXT command. It DESCRIBES the
  intake → preflight → decide sequence only — it executes no stage, runs no live action, and writes
  nothing. The operator runbook is `docs/SNIPER_RUNBOOK.md`; a worked example is in `examples/sniper/`.
- ⬜ **Live** snipe-list source (scraping / network fetch) — deferred; explicitly
  out of scope (candidates remain injected local JSON).

## Phase 6 — Transaction planning & simulation ⬜ (NOT started)

> Note: "Sprint 6" in this repo delivered the **strategy → paper plan pipeline**
> (an extension of Phase 5, above), **not** this roadmap phase. Transaction
> planning/simulation remains entirely unstarted — by design.
>
> The boundary contract + the exact prerequisites that must be satisfied before any
> Phase 6 implementation begins are specified in
> [`PHASE_6_SIMULATION_BOUNDARY.md`](PHASE_6_SIMULATION_BOUNDARY.md) (Sprint 29 — SPEC
> ONLY, no code). Key invariants: planner ⟂ signer separated forever, dry-run by default,
> no keys/signing/sending, operator approval + audit logs + kill switch required.

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
