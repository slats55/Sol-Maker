# Soulmaker Paper Trading Model (Phase 4 / Sprint 4; Sprint 8 journal-continuing runs + backtest; Sprint 9 scenario linting + report stability; Sprint 10 report diffing + scenario helpers; Sprint 11 backtest suites + suite diffing; Sprint 12 scenario variant generation; Sprint 13 variant-sensitivity workflow)

The paper engine (`@soulmaker/paper` + the `paper:*` CLI commands) is a
**deterministic, offline, simulated-only** trading sandbox. It exists to prove
that the system can consume advisory risk reports, enforce caps, and keep an
auditable journal — **without ever touching a wallet, key, or the chain.**

> **Simulated only.** Paper trading does **not** imply live-trading readiness.
> No transaction is built, signed, simulated, or sent. No private keys or wallet
> secrets are accepted. Paper PnL is computed from **injected** prices and is
> **not** real market performance. A risk `PASS_FOR_PAPER_EVALUATION` means
> "eligible for paper evaluation", **not** "safe to buy", "approved for live
> trading", "profitable", or "executable".

---

## What it is (and is not)

- **Is:** pure domain logic — simulated orders/fills, weighted-average positions,
  realized + unrealized PnL, cap + kill-switch checks, an append-only journal,
  and report generation. Deterministic: identical input → byte-identical output.
- **Is not:** a router, a DEX adapter, a transaction builder, a signer, or a
  network client. `@soulmaker/paper` has **no** dependency on `@solana/web3.js`,
  no RPC, no filesystem, and no SDK for Raydium/Jupiter/Pump.fun/Jito/Warp.

The package is pure; the **CLI** owns all local file I/O (reading injected
candidate/price fixtures, appending to a JSONL journal, printing reports).

## Determinism

- Ids come from a seeded monotonic counter (`order-1`, `fill-1`, …) — never
  `Math.random()`.
- Timestamps are injected: simulated fills are stamped with the triggering price
  point's `observedAt`; run-level events use an injectable `now` (defaulted to a
  fixed value so the package never reads wall-clock time itself).
- Tests inject a fixed clock and fixed prices, so output is fully reproducible.

## Data flow

```
@soulmaker/risk  TokenRiskReport (decision)        injected price points
        │                                                   │
        ▼                                                   ▼
   PaperCandidate ───────────────► runPaperSession(caps, candidates, prices, TP/SL)
                                          │
            risk filter → caps/kill-switch checks → simulated fills → TP/SL sweep
                                          │
                         events[] + final PaperState + PaperRunSummary
                                          │
        CLI: formatPaperReport (human) | JSON envelope | append JSONL journal
```

## Risk integration (the candidate filter)

A candidate may enter a simulated **buy** only if its advisory risk decision is
`PASS_FOR_PAPER_EVALUATION`:

| Risk decision | Paper buy? |
| --- | --- |
| `REJECT` | never (`CANDIDATE_REJECTED_BY_RISK`) |
| `CAUTION` | blocked by default; allowed only with `--allow-caution` (off by default) |
| `PASS_FOR_PAPER_EVALUATION` | eligible for **paper evaluation only** |
| missing / invalid report | treated as `REJECT` (fail safe) |

A critical risk flag forces `REJECT` upstream in `@soulmaker/risk` and can never
be rescued by an allowlist credit, so it can never reach a paper buy.

> **Upstream of the candidate:** the Phase 5 strategy engine
> (`@soulmaker/strategy`, see [`STRATEGY_MODEL.md`](STRATEGY_MODEL.md)) is the
> layer that *decides* whether a token becomes a paper buy/sell candidate at all.
> It only ever **feeds** this paper engine — it performs no simulated fill itself,
> touches no wallet/chain, and builds/signs/simulates/sends nothing. A strategy
> `PAPER_BUY_CANDIDATE` is a candidate for *this* simulated engine, not a real buy.
>
> **Producing the candidate file (Sprint 6):** `strategy:plan` evaluates a *batch*
> of injected candidates and can write **only** the resulting `PaperCandidate[]`
> to a file (`--out`). That file is exactly the `--candidates` input this engine
> expects, so the operator can **manually** run
> `paper:run --candidates <plan-out.json> --prices <prices.json>`. The bridge is
> **manual by design**: `strategy:plan` never invokes `paper:run`, never fills,
> and never writes a journal — it emits a plan, nothing more.

## Caps & kill switch (enforced before every simulated action)

`PaperRiskCaps` (USD, simulation-scoped — distinct from the on-chain SOL caps in
`@soulmaker/core`):

| Cap | Effect |
| --- | --- |
| `killSwitch` | engaged → **no** simulated trades at all (emergency stop) |
| `maxTradeSizeUsd` | rejects an oversized candidate |
| `maxOpenPositions` | rejects opening a **new** position at the limit (adding to an existing one is allowed) |
| `maxDailyLossUsd` | once realized losses reach the cap, further buys are blocked |
| `maxPositionSizeUsd` (optional) | caps a single position's total cost basis |

The CLI `--kill-switch` flag is **OR-ed** with the core config `killSwitch`, so a
global emergency stop also halts paper runs.

Ordering within a run is deterministic: all candidate buys/sells are processed in
array order **first**, then the TP/SL sweep runs. The `maxDailyLossUsd` cap is
therefore evaluated against **realized PnL at buy time** — losses that only
materialize in the TP/SL sweep do not retroactively block earlier buys in the
same run (they do constrain subsequent runs that share the journal/state).

## Simulated trading rules

- **BUY:** requires risk-pass + valid injected price + all caps. Fills at the
  *first* injected price for the mint; opens/adds to a position (weighted-average
  cost basis); appends `PAPER_BUY_FILLED`.
- **SELL (explicit):** requires an open position; fills at the *latest* injected
  price; realizes PnL; reduces or closes the position (partial sells supported).
- **Take-profit / stop-loss:** thresholds in percent, evaluated against the
  injected price series in order. The first threshold crossed triggers a
  full-position simulated sell; the `TAKE_PROFIT_TRIGGERED` /
  `STOP_LOSS_TRIGGERED` event is always appended **before** the sell fill.

## Journal (append-only)

- Events are newline-delimited JSON (`JSONL`). The CLI **appends** (never
  truncates) with `appendFileSync`.
- `parseJournal` skips blank lines and reports malformed lines (bad JSON, unknown
  type, missing `at`) without losing the good ones — one bad line is never fatal.
- `reduceJournal` replays fill events to reconstruct positions + realized PnL.
  Unrealized PnL cannot be recomputed from fills alone (no live prices in the
  journal); the CLI surfaces the value recorded by the most recent run.
- `deriveStateFromJournalText` (Sprint 7) is a **strict** reconstruction for
  callers that need an *authoritative* portfolio snapshot: it composes
  `parseJournal` + `reduceJournal` and **additionally validates each fill payload**
  (finite non-negative amounts, a side matching the event type), returning
  `parseErrors` and `fillErrors` separately so the caller can refuse rather than
  silently fold a corrupt fill. It is pure (no filesystem) and only folds the
  well-formed fills, so the returned state is never `NaN`-corrupted.
  `strategy:plan --journal` uses it **read-only** (see
  [`STRATEGY_MODEL.md`](STRATEGY_MODEL.md)) and `paper:run --journal` uses it to
  derive a run's **starting state** (below); `paper:journal`/`paper:status` keep
  their lenient display behaviour.

## Journal-continuing runs (Sprint 8)

`runPaperSession` takes an optional injected `startingState` (a `PaperState`). It
is **cloned** (`cloneState`) so the caller's object is never mutated, and the run
proceeds from it: a sell can close a pre-existing position, and the caps
(`maxOpenPositions`, `maxPositionSizeUsd`, `maxDailyLossUsd`, kill switch) all
account for the carried-forward positions and realized PnL. Omitting it preserves
the original empty-state behaviour exactly.

The CLI wires this through `paper:run --journal`:

- If the journal **exists**, it is read **first** and the starting state is
  **strictly** derived (`deriveStateFromJournalText`). A malformed line or an
  invalid fill **refuses the run and appends nothing** — a journal used as the
  authoritative portfolio for a new run must not silently drop events.
- If the journal **does not exist**, the run starts from the empty state and the
  journal is **created** on append.
- A valid journal is only ever **appended to** — existing events are never
  truncated or rewritten.

This makes `strategy:plan --journal` → `paper:run --journal` a real paper-only
loop: a `PAPER_SELL_CANDIDATE` derived from the journal now finds its open
simulated position instead of being rejected with "no open simulated position".

## Backtest / replay (Sprint 8)

`@soulmaker/backtest` (CLI `paper:backtest`) replays an injected, self-contained
local JSON **scenario** (embedded strategy config + caps + ordered steps, plus an
optional seed `initialJournal`) through the **same** production code paths —
`planStrategyBatch` then `runPaperSession` with `startingState` — carrying the
simulated portfolio forward between steps, then reconstructs the final state with
`reduceJournal` + `markFinalUnrealized` + `summarize`. It is **pure** (no
fs/network/RPC/`Date.now`/`Math.random`) and **byte-stable** for a given scenario,
and refuses a malformed or empty-steps scenario clearly. Its report carries
**injected-historical-data-only** language and is **not a live result, not a
profitability claim, and not advice**. The command never writes a journal or any
fills; `--out` writes only the report JSON. See
[`ARCHITECTURE.md`](ARCHITECTURE.md) for the data flow.

## Scenario linting, examples & report stability (Sprint 9)

Sprint 9 hardens the backtest so scenarios are easier to author, inspect, and
trust — and harder to misread as real performance. Everything stays
**injected-only and simulated**.

- **Scenario validator / linter.** `@soulmaker/backtest` exports
  `validateBacktestScenario` (throwing; `validateScenario` is a back-compatible
  alias) and `lintBacktestScenario(input) → { valid, errors, warnings, summary }`.
  Both are built on one shared, non-throwing validation **core**, so the validator
  and the linter can never disagree about what is structurally valid. **Errors**
  prevent a run (structural problems + a malformed embedded journal); **warnings**
  flag suspicious-but-allowed design — e.g. no trade sizing (no positive
  `defaultPaperSizeUsd` and no candidate `proposedSizeUsd`), `defaultPaperSizeUsd`
  above `maxTradeSizeUsd`, non-monotonic timestamps, duplicate step ids, duplicate
  mints in a step, empty candidate/price arrays, a step's candidates with no
  matching injected price, the kill switch on, caps that guarantee no buys,
  `allowCautionRiskReports`, extreme/disabled exit thresholds, and a seed journal
  that already holds open positions or realized PnL before step 1. The linter is
  **pure, deterministic, and non-mutating**, and it never runs the backtest. CLI:
  `paper:backtest:lint --scenario <path> [--json]` (errors refuse with exit 1;
  warnings stay runnable but suspicious).

- **Richer, stabler reports.** `BacktestReport` now carries a stable
  `schemaVersion` (`backtest.report.v1`); a deterministic, non-cryptographic
  `scenarioDigest` (a canonical content hash, for reproducibility/traceability
  only — **not** security or anti-tamper); the scenario `warnings` (so suspicious
  design is visible, not hidden); a per-step `equityCurve` (cumulative
  realized/unrealized/total PnL, open/closed counts, simulated turnover — one entry
  per step, marked at that step's injected prices); and **exact** `perMint`
  aggregates (per-mint fill counts, open quantity, realized + unrealized + total
  PnL, turnover). Per-mint realized PnL is **recomputed from each mint's own fills**
  through the same weighted-average engine — it is exact, never invented or
  estimated, even for a fully-closed position. The human report is sectioned and
  JSON output stays byte-stable for a given scenario.

- **External seed journal.** `paper:backtest --seed-journal <path>` seeds the
  starting state from a separate JSONL journal instead of embedding it. It is
  composed onto a scenario **copy** at the CLI layer (the pure engine stays
  scenario-driven and filesystem-free), is **mutually exclusive** with an embedded
  `initialJournal` (supplying both is refused — no hidden override), is read
  strictly (a malformed journal refuses), is **never written**, and never modifies
  the scenario file.

- **BOM-tolerant JSON.** The CLI's local JSON readers (candidates, prices, strategy
  config, paper-state, backtest scenario) and journal reads tolerate a single
  leading UTF-8 **BOM** (`stripJsonBom`), which Windows editors and
  `Set-Content -Encoding utf8` add. Malformed JSON still refuses cleanly (no loose
  normalization), and a BOM in the middle of a file is never stripped.

- **Example scenarios.** [`examples/backtest/`](../examples/backtest/) ships small,
  **injected**, deterministic example scenarios (buy & hold, buy & full exit,
  multi-mint partial exit + hold + reject, seed-journal continuation) with a README.
  They are copyable starting points and test fixtures — **not** historical market
  truth, not real prices, not a track record.

## Report diffing & scenario helpers (Sprint 10)

Sprint 10 makes the backtest easier to **review** and **regression-test**.
Everything stays **injected-only and simulated**; nothing fetches live data and
nothing touches a wallet, key, or transaction.

- **Report diff.** `@soulmaker/backtest` exports `validateBacktestReport`,
  `diffBacktestReports(base, next)`, and `formatBacktestReportDiff`; the CLI adds
  `paper:backtest:diff --base <a> --next <b> [--json] [--fail-on-regression]`. It
  reads **only** the two report JSON files (BOM-tolerant; malformed/non-report JSON
  refused), runs **no** backtest, reads no scenario, and writes nothing. The diff
  reports metadata/**compatibility** (schema/digest/name match; same-scenario vs
  different-scenario vs schema-mismatch), **summary deltas** (steps, candidates,
  fills, rejects, realized/unrealized/total PnL, positions, turnover), a
  warning/equity/per-mint **set-diff** (sorted deterministically), and a
  **conservative** `hasRegression` flag. Every value is a bookkeeping difference
  between two **simulations** — a negative or positive delta is **not** profit,
  loss, a prediction, or advice. `hasRegression` is bookkeeping-oriented: schema
  problems always flag; PnL/fills/rejects/warning regressions flag only for the
  **same** `scenarioDigest` (a deterministic replay should reproduce identical
  numbers), and a *different* digest is treated as "different scenario", not a
  regression. `--fail-on-regression` exits non-zero only when `hasRegression` is
  true; without it the command exits 0 even on negative deltas.

- **Scenario helpers.** `buildExampleBacktestScenario(template)` +
  `listBacktestScenarioTemplates()` build deterministic INJECTED scenario skeletons
  from built-in templates (`buy-hold`, `buy-full-exit`, `partial-exit`,
  `seed-journal-continuation`); `expandScenarioMatrix(base, matrix)` produces
  variants from a base scenario plus a small, **safe, config-only** patch matrix.
  CLI: `paper:backtest:scenario:new --template <name> --out <path> [--name <name>]
  [--force]` and `paper:backtest:scenario:matrix --base <a> --matrix <m> --out-dir
  <d> [--force]`. The builders are **pure** (the CLI does the writing); generated
  scenarios use fake mints and injected prices (never real tokens/keys/wallets),
  validate immediately, and are not overwritten without `--force`. The matrix patch
  system is intentionally tiny: a patch may only set
  `strategyConfig`/`caps`/`defaultPaperSizeUsd` — never `steps`, `name`, or
  `initialJournal` (so the injected labelling can never be edited into something
  misleading), and never code or expressions.

## Backtest suites & suite diffing (Sprint 11)

Sprint 11 adds an orchestration layer so a whole **directory** of injected scenarios
can be run together and compared over time. Everything stays **injected-only and
simulated**; nothing fetches live data and nothing touches a wallet, key, or
transaction. A "suite" is just a directory of `*.scenario.json` files — suite output
is simulated **bookkeeping only**, **not** a live result, **not** financial advice,
and **not** a profitability claim.

- **Suite runs.** `@soulmaker/backtest` exports `runBacktestSuite(input)`,
  `buildBacktestSuiteIndex(result)`, and `formatBacktestSuiteIndex`; the CLI adds
  `paper:backtest:suite --dir <scenarios/> [--out-dir <reports/>] [--json]
  [--fail-on-error] [--force]`. The CLI reads the directory's `*.scenario.json` files
  (sorted by filename, BOM-tolerant; a malformed file refuses the **whole** suite),
  and the **pure** package runs each through the same `lintBacktestScenario →
  runBacktest → validateBacktestReport` paths a single backtest uses. A lint error
  **fails and skips** a scenario (it is not run); a warning still runs but is
  surfaced; a runtime error fails just that one entry without crashing the suite. The
  byte-stable `suite-index.json` (`backtest.suite.v1`) carries passed/failed/warning
  counts, total steps/candidates, summed simulated fills, and summed realized /
  unrealized / total simulated PnL, plus a per-entry summary. With `--out-dir` the CLI
  writes one report JSON per **passed** scenario plus `suite-index.json` (never a
  journal or fills; it preflights every target so it never writes partial output and
  refuses to overwrite without `--force`). `--fail-on-error` exits non-zero if any
  scenario failed; without it the command exits 0 while still clearly reporting
  failures.

- **Suite diffing.** `@soulmaker/backtest` exports `validateBacktestSuiteIndex`,
  `diffBacktestSuites(base, next)`, and `formatBacktestSuiteDiff`; the CLI adds
  `paper:backtest:diff:suite --base-dir <a/> --next-dir <b/> [--json]
  [--fail-on-regression]`. It reads **only** each directory's `suite-index.json`
  (BOM-tolerant; missing/malformed refused), runs **no** backtests, reads no
  scenarios, and writes nothing. It pairs entries by scenario **digest**, then
  **name**, then **file**, and reports added / removed / **changed** scenarios,
  aggregate summary deltas, a warning-count delta, per-entry summary deltas, and a
  **conservative** `hasRegression` flag. A SAME-digest result drift is a regression
  (a deterministic replay of one scenario should be byte-identical); a newly-failing
  scenario or an increased failed count is a regression; a dropped passed scenario is
  lost coverage. A *changed* scenario (same name/file, different content) is a
  bookkeeping difference, **not** a regression by default — different scenarios are
  expected to differ. `--fail-on-regression` exits non-zero only when `hasRegression`
  is true; without it the command exits 0 even when regressions are reported.

## Scenario variant generation (Sprint 12)

Sprint 12 adds a deterministic **variant generator** so a base scenario can be swept
across bounded what-ifs (e.g. "all prices ±10%") and the variants run as a suite.
Where `expandScenarioMatrix` SETS config-only fields to absolute values, this
applies **relative, bounded perturbations** to the *data a scenario replays*.

`@soulmaker/backtest` exports `generateScenarioVariants(base, plan)`; the CLI adds
`paper:backtest:scenario:variants --base <a> --plan <p> --out-dir <d> [--force]
[--json]`. The plan is `{ name?, variants: [{ suffix, perturbations: [...] }] }`. A
perturbation is `{ target, op, value, min?, max?, mint? }`:

- **`target`** is `"price"` (every injected price point's `priceUsd`) or
  `"metric.<field>"` for an allowlisted candidate metric (`priceUsd`, `liquidityUsd`,
  `volumeUsd`, `ageSeconds`, `holderCount`, `priceChangePct`, `peakPriceChangePct`,
  `drawdownFromPeakPct`, `positionSizeUsd`). No free-form dotted paths.
- **`op`** is `multiply` (`old * value`, a factor) or `add` (`old + value`, an integer
  or numeric delta). `value` must be finite.
- **`min`/`max`** are explicit, optional clamp bounds; the result is clamped into
  `[min, max]` (`min > max` is refused, and arithmetic that overflows to a non-finite
  number with no usable bound is refused).
- **`mint`** optionally restricts the perturbation to one mint's values.

It is **pure**: no RNG of any kind, no `Date.now`, no live/historical data, no
network, no expression/`eval`, no input mutation; output is byte-stable and emitted
in plan order. It only touches numbers that **already exist** — an absent field is
never created, and a perturbation that matches **nothing** is refused rather than
silently ignored. `name`, the `steps` structure, `initialJournal`, and config are
protected, so each variant's name is derived from the base name + the variant
`suffix` and the base's INJECTED labelling always survives. Every generated variant
validates through the same `validateBacktestScenario` path; the CLI preflights every
output path (internal name collisions, case-insensitive, plus pre-existing files)
**before** writing any, so it never writes partial output and never overwrites
without `--force`. A generated variant is **simulated local scenario data** — not a
live result, not advice, not a profitability claim — and its `--out-dir` feeds
straight into `paper:backtest:suite` + `paper:backtest:diff:suite` for a
price-sensitivity sweep.

## Variant-sensitivity workflow (Sprint 13)

Sprint 13 folds the Sprint 11 + Sprint 12 pieces into **one** workflow that answers
"how sensitive are the simulated outputs to a bounded perturbation of the injected
data?" — without re-implementing anything. `@soulmaker/backtest` exports
`runScenarioVariantSensitivity({ base, plan })`,
`buildScenarioVariantSensitivityReport`, `validateScenarioVariantSensitivityReport`,
and `formatScenarioVariantSensitivityReport` (schema `backtest.sensitivity.v1`); the
CLI adds `paper:backtest:sensitivity --base <a> --plan <p> [--out-dir <d>] [--force]
[--json]`.

The workflow:

1. generates the variants with the SAME `generateScenarioVariants` (Sprint 12) — so
   an invalid base or invalid plan is refused up front;
2. runs the **base scenario once as a baseline** AND every variant through the SAME
   `runBacktestSuite` path (Sprint 11): lint → `runBacktest` → validate, with the
   baseline as the suite's first entry (so it also yields a real `suite-index.json`);
3. summarizes each variant's simulated outputs and its **per-field delta versus the
   baseline** — `stepCount`, `candidateCount`, buy/sell fills, rejects, realized /
   unrealized / total simulated PnL, simulated notional, open / closed positions.
   Every summarized field is a real backtest-report field; no metric is invented.

The baseline (**Option A**) is the most useful design: every variant has a concrete
reference to diff against. The report carries the PAPER-ONLY banner, the
not-live / not-advice / not-a-profitability-claim labelling, the base scenario's
name + content digest, the plan name, per-variant rows, and the aggregate suite
summary. It is **pure** and non-mutating (the base runs on an independent deep copy)
and carries **no timestamps**, so an identical input yields a **byte-identical**
report. A delta is the change between two simulated runs — not a prediction, not
advice, not a profitability claim; a failed variant carries a null summary and null
deltas and is counted, never silently dropped.

With `--out-dir` the CLI writes the full artifact tree —
`variants/<stem>.<suffix>.scenario.json`, one `reports/<id>.report.json` per
scenario (the baseline as `reports/base.report.json`), `reports/suite-index.json`,
and `sensitivity-report.json` — preflighting **every** target (internal name
collisions, case-insensitive, plus pre-existing files) before writing any, so it
never writes partial output and never overwrites without `--force`. Without
`--out-dir` it writes nothing and just prints the report (human or `--json`).

## PnL reporting

`PaperRunSummary`: realized PnL, unrealized PnL, total PnL, open position count,
closed trade count, buy/sell counts, rejected-candidate counts (risk / caps /
price), and simulated notional volume. Every rendered report (human and `--json`)
carries the `PAPER ONLY` banner and the "no transaction was built, signed,
simulated, or sent" disclaimer.

## CLI

| Command | Purpose |
| --- | --- |
| `paper:run` | run a deterministic simulated evaluation from injected fixtures (with `--journal`, **continues** from an existing valid journal) |
| `paper:journal` | read + summarize an append-only journal (lenient display) |
| `paper:status` | real status from an optional journal (clean empty state otherwise) |
| `paper:backtest` | deterministic, injected-only simulated replay of a local scenario (Sprint 8; Sprint 9 adds `--seed-journal` + richer report) |
| `paper:backtest:lint` | validate/lint a scenario **without** running it (Sprint 9): errors block a run, warnings flag suspicious design |
| `paper:backtest:diff` | deterministically diff **two existing** report JSON files (Sprint 10): compatibility + deltas + conservative `hasRegression`; deltas are bookkeeping, not advice |
| `paper:backtest:scenario:new` | write a deterministic INJECTED scenario skeleton from a built-in template (Sprint 10); refuses overwrite without `--force` |
| `paper:backtest:scenario:matrix` | expand a base scenario by a safe, config-only patch matrix into one INJECTED file per variant (Sprint 10) |
| `paper:backtest:scenario:variants` | generate INJECTED variants from a base by applying a plan of **bounded numeric perturbations** (multiply/add, clamped) to its injected prices/metrics (Sprint 12); no code/RNG; steps/name/journal/config protected; refuses overwrite without `--force` |
| `paper:backtest:suite` | run a **directory** of `*.scenario.json` files as one deterministic suite and aggregate a byte-stable `suite-index.json` (Sprint 11); `--out-dir` also writes one report per passed scenario; `--fail-on-error` exits non-zero on any failure |
| `paper:backtest:diff:suite` | diff **two** suite output directories by their `suite-index.json` (Sprint 11): added/removed/changed scenarios + aggregate deltas + conservative `hasRegression`; a changed scenario is not a regression |
| `paper:backtest:sensitivity` | run a base scenario (baseline) + bounded variants of it through the suite path and emit a stable `backtest.sensitivity.v1` report of each variant's per-field delta vs the baseline (Sprint 13); `--out-dir` writes variants/ + reports/ + `sensitivity-report.json` (preflighted, no partial writes, `--force` to overwrite); deltas are simulated bookkeeping, not a profitability claim |

`paper:run` options: `--candidates <path>` `--prices <path>` `--journal <path>`
`--max-trade-size-usd` `--max-daily-loss-usd` `--max-open-positions`
`--max-position-size-usd` `--take-profit-pct` `--stop-loss-pct` `--kill-switch`
`--allow-caution` `--json`. With `--journal`, an existing journal is read first
and becomes the run's starting state (strict; refuses a malformed journal before
appending). Missing/unreadable fixtures and invalid numeric caps are refused
cleanly; secrets are never leaked (output is redacted).

`paper:backtest` options: `--scenario <path>` `--json` `--out <path>` (writes the
report JSON only — never a journal or fills) `--seed-journal <path>` (Sprint 9;
seed the starting state from an external JSONL journal, mutually exclusive with an
embedded `initialJournal`, read-only). A malformed/empty scenario is refused
cleanly; output is redacted.

`paper:backtest:lint` options: `--scenario <path>` `--json`. Reads one local JSON
scenario, runs the pure linter, and prints a readable (or stable, redacted JSON)
result. Errors refuse (exit 1); warnings stay runnable but suspicious.

## Limitations (be honest)

- Prices are **injected fixtures**, not market data. PnL is bookkeeping, not a
  prediction or a track record.
- There is no slippage, liquidity, partial-fill, or latency modeling beyond the
  simple price-point model; fills are exact at the injected price.
- A sensitivity delta (Sprint 13) measures how a **bounded, injected** what-if moved
  the **simulated** bookkeeping — it is not a forecast, a backtest of real history,
  or any indication of live profitability.
- Nothing here is wired to execution. Live sending remains Phase 7, behind every
  gate in [`WALLET_SAFETY_MODEL.md`](WALLET_SAFETY_MODEL.md). Phase 6 (transaction
  planning) and Phase 7 (burner live mode) are still **not started**.
