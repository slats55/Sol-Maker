# Backtest example scenarios

These are **small, deterministic, INJECTED fixtures** for the paper-only backtest
engine (`@soulmaker/backtest`). They exist as copyable starting points and as test
fixtures.

> **What these are NOT.** They are **not** historical market data, **not** real
> token prices, and **not** a record of anything that happened on-chain. Every
> mint here is a fake, obviously-dummy placeholder (`FakeAAA…`, `FakeBBB…`,
> `FakeCCC…`), and every price is an injected number with `"source":
> "injected-fixture"`. The simulated PnL they produce is bookkeeping arithmetic
> over those injected numbers — **not a live result, not a profitability claim,
> and not financial advice.** Nothing here builds, signs, simulates, or sends a
> transaction, and there is no wallet, key, or network anywhere in the pipeline.

## The scenarios

| File | What it shows |
| --- | --- |
| [`single-mint-buy-hold.scenario.json`](single-mint-buy-hold.scenario.json) | One mint, one simulated buy, **held** to the end — final unrealized PnL is marked at the last injected price. |
| [`single-mint-buy-full-exit.scenario.json`](single-mint-buy-full-exit.scenario.json) | One mint bought then **fully exited** by a take-profit sweep — deterministic realized PnL, position closed. |
| [`multi-mint-partial-exit.scenario.json`](multi-mint-partial-exit.scenario.json) | Three mints: one **partial-exits** (scales out half), one is **held**, one is **rejected** by the advisory risk gate (the skip path). |
| [`seed-journal-continuation.scenario.json`](seed-journal-continuation.scenario.json) | Starts from an **embedded `initialJournal`** that already holds an open simulated position, then continues the replay (and opens a new entry). |

## How to run

From the repository root:

```bash
# 1) Lint a scenario WITHOUT running it (errors block a run; warnings flag
#    suspicious-but-allowed design). Add --json for a stable, redacted result.
pnpm soulmaker paper:backtest:lint --scenario examples/backtest/single-mint-buy-full-exit.scenario.json

# 2) Run the deterministic, simulated replay and print the human report.
pnpm soulmaker paper:backtest --scenario examples/backtest/single-mint-buy-full-exit.scenario.json

# 3) Emit the stable JSON report (machine-readable).
pnpm soulmaker paper:backtest --scenario examples/backtest/single-mint-buy-hold.scenario.json --json

# 4) Write ONLY the report JSON to a file (never a journal or fills).
pnpm soulmaker paper:backtest --scenario examples/backtest/single-mint-buy-hold.scenario.json --json --out report.json
```

The `seed-journal-continuation` example embeds its starting journal in the
scenario file. You can also seed a backtest from a **separate** JSONL journal
without editing the scenario:

```bash
pnpm soulmaker paper:backtest --scenario some.scenario.json --seed-journal path/to/journal.jsonl
```

`--seed-journal` is mutually exclusive with an embedded `initialJournal` (supplying
both is refused, so there is no hidden override). The seed journal is read strictly
and **never written**, and the scenario file is **never modified**.

## What the reports mean (and do not mean)

A backtest report is a deterministic summary of a simulated replay:

- **`schemaVersion`** — the report shape (`backtest.report.v1`).
- **`scenarioDigest`** — a non-cryptographic content digest of the scenario, for
  reproducibility/traceability only (two scenarios that differ only in key order
  share a digest). It is **not** a security or integrity guarantee.
- **`warnings`** — scenario-linter findings, surfaced so suspicious design is
  visible rather than hidden.
- **`equityCurve`** — one sample per step (cumulative realized/unrealized/total
  PnL, open/closed counts, simulated turnover), marked at that step's injected
  prices.
- **`perMint`** — exact per-mint aggregates (fill counts, open quantity, realized
  and unrealized PnL, turnover). Realized PnL is recomputed exactly from each
  mint's own fills — never estimated.

Every number is **simulated bookkeeping from injected prices**. The report
explicitly carries `SIMULATED PAPER-ONLY REPORT`, "Uses injected historical data
only", "Not a live result", "Not financial advice", and "Not a profitability
claim". Treat these examples as a way to learn the tool and to author your own
scenarios — never as evidence that any strategy is profitable.

## Authoring your own

Copy one of these files, change the mints/prices/steps, then **lint before you
run**:

```bash
pnpm soulmaker paper:backtest:lint --scenario my.scenario.json
```

The linter explains structural errors (which prevent a run) and warnings (which
flag suspicious design, e.g. a missing trade size, non-monotonic timestamps,
duplicate step ids, or a kill switch that silently disables all trading).

## Generating scenarios from a template (Sprint 10)

Instead of copying a file by hand, you can deterministically generate a scenario
**skeleton** from a built-in template. These are the same shapes as the examples
above — small, **INJECTED** fixtures (fake mints + injected prices), **not** real
historical data:

```bash
# Templates: buy-hold | buy-full-exit | partial-exit | seed-journal-continuation
pnpm soulmaker paper:backtest:scenario:new --template buy-hold --out my.scenario.json
# It refuses to overwrite an existing file unless you pass --force.

# Produce several variants from a base scenario + a small, SAFE patch matrix
# (a patch may only set strategyConfig / caps / defaultPaperSizeUsd — never steps,
# name, or initialJournal, and never code/expressions). One file per variant:
pnpm soulmaker paper:backtest:scenario:matrix --base my.scenario.json --matrix matrix.json --out-dir variants/
```

Every generated scenario validates immediately — lint and run it exactly as above.

## Diffing two reports (Sprint 10)

To **review** or **regression-test** a change, diff two report JSON files you
produced earlier with `paper:backtest --out`:

```bash
pnpm soulmaker paper:backtest --scenario a.scenario.json --json --out base-report.json
pnpm soulmaker paper:backtest --scenario b.scenario.json --json --out next-report.json
pnpm soulmaker paper:backtest:diff --base base-report.json --next next-report.json
# --json for a stable machine-readable diff; --fail-on-regression to exit non-zero
# only when the diff flags a (bookkeeping) regression.
```

`paper:backtest:diff` reads **only** the two report files — it runs no backtest and
writes nothing. Every value it prints is a **bookkeeping delta between two
simulations**: a negative or positive delta is **not** profit, loss, a prediction,
or advice. A different `scenarioDigest` is reported as a *different scenario*, not a
regression; regressions are conservative and bookkeeping-oriented.

## Running a whole directory as a suite (Sprint 11)

This very directory is a ready-made **suite**: `paper:backtest:suite` runs every
`*.scenario.json` here (sorted by filename, BOM-tolerant) through the same
`lint → backtest → validate` paths and aggregates their **simulated** reports into
one stable index. A suite is just a directory of injected scenarios — its output is
simulated **bookkeeping only**, **not** a live result, **not** advice, **not** a
profitability claim:

```bash
# Human summary (passed/failed counts, summed fills + simulated PnL, per-entry lines):
pnpm soulmaker paper:backtest:suite --dir examples/backtest
# Stable machine-readable index:
pnpm soulmaker paper:backtest:suite --dir examples/backtest --json
# Also write one report per PASSED scenario + suite-index.json into a directory
# (never a journal/fills; refuses to overwrite without --force):
pnpm soulmaker paper:backtest:suite --dir examples/backtest --out-dir reports/
# Exit non-zero if any scenario failed (a lint error fails+skips a scenario;
# a warning still runs):
pnpm soulmaker paper:backtest:suite --dir examples/backtest --fail-on-error
```

A malformed JSON file refuses the **whole** suite; an otherwise-valid scenario that
fails lint becomes a clearly-marked failed entry without crashing the run.

## Diffing two suites (Sprint 11)

To regression-review across whole directories, generate two suite output directories
and diff them by their `suite-index.json`:

```bash
pnpm soulmaker paper:backtest:suite --dir scenariosA/ --out-dir reportsA/
pnpm soulmaker paper:backtest:suite --dir scenariosB/ --out-dir reportsB/
pnpm soulmaker paper:backtest:diff:suite --base-dir reportsA/ --next-dir reportsB/
# --json for a stable machine-readable diff; --fail-on-regression to exit non-zero
# only when hasRegression is true.
```

`paper:backtest:diff:suite` reads **only** each directory's `suite-index.json` — it
runs no backtests, reads no scenarios, and writes nothing. It pairs entries by
digest → name → file and reports added / removed / **changed** scenarios plus
aggregate deltas. A SAME-digest result drift is a regression (a deterministic replay
should be byte-identical); a *changed* scenario (different content) is a bookkeeping
difference, **not** a regression by default.
