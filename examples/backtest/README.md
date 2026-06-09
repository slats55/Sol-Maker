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

There is also one **variant plan** (a different kind of artifact — not a scenario):

| File | What it is |
| --- | --- |
| [`price-sensitivity.variant-plan.json`](price-sensitivity.variant-plan.json) | A Sprint 12 **variant plan**: bounded ±10% (`multiply`) and +$1 (`add`) perturbations of the injected `price`, for `paper:backtest:scenario:variants` (see below). |

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

## Sweeping a scenario into variants (Sprint 12)

To explore a base scenario across bounded "what-ifs" (e.g. *all prices ±10%*),
generate **variants** from it with a small, declarative **plan** of numeric
perturbations, then run the variants as a suite. Each perturbation `multiply`s or
`add`s a finite delta to a `price` (every injected `priceUsd`), a `metric.<field>`
(an allowlisted candidate metric), or a `config.<field>` (an allowlisted numeric
config field — see below), clamped to explicit `[min, max]` bounds and (for
price/metric) optionally restricted to one `mint`. There is **no RNG, no
code/expressions, no live data**, and a perturbation that matches **nothing** is
refused (never silently ignored). The base's `name`, `steps` structure,
`initialJournal`, and every non-allowlisted config field are protected, so each
variant's name is derived from the base name + its `suffix`:

```bash
# Generate one INJECTED variant file per plan entry (refuses overwrite without --force):
pnpm soulmaker paper:backtest:scenario:variants \
  --base examples/backtest/single-mint-buy-hold.scenario.json \
  --plan examples/backtest/price-sensitivity.variant-plan.json \
  --out-dir variants/

# Run the generated variants as a suite, then diff against a baseline suite:
pnpm soulmaker paper:backtest:suite --dir variants/ --out-dir variant-reports/
pnpm soulmaker paper:backtest:diff:suite --base-dir baseline-reports/ --next-dir variant-reports/
```

The shipped [`price-sensitivity.variant-plan.json`](price-sensitivity.variant-plan.json)
produces three variants from the buy-hold base: `price-up-10pct` (×1.1),
`price-down-10pct` (×0.9), and `price-plus-1usd` (+$1, clamped to `[0, 1000000]`).
A uniform price *multiplier* is PnL-invariant under fixed-USD sizing (you buy
inversely more units at a lower entry); an *additive* shift moves the entry and so
moves the simulated PnL. Every variant is **simulated local scenario data** — fake
mints, injected prices — **not a live result, not advice, and not a profitability
claim.**

### Config perturbations (Sprint 14)

Beyond prices and metrics, a perturbation can target a **`config.<field>`** to sweep a
strategy/cap parameter — e.g. *how sensitive are the simulated outputs to a ±50%
change in the trade-size cap or the take-profit threshold?* The allowlist is closed,
conservative, and **unambiguous** (every name resolves to exactly one location):

| `config.<field>` | Location |
| --- | --- |
| `config.maxTradeSizeUsd` · `config.maxDailyLossUsd` · `config.maxPositionSizeUsd` | `caps.*` |
| `config.minScoreForPaperBuy` · `config.maxRiskScore` · `config.takeProfitPct` · `config.stopLossPct` · `config.trailingStopPct` | `strategyConfig.*` |
| `config.defaultPaperSizeUsd` | top-level |

```json
{
  "variants": [
    { "suffix": "cap-up-50pct",  "perturbations": [{ "target": "config.maxTradeSizeUsd", "op": "multiply", "value": 1.5 }] },
    { "suffix": "tp-tighter",    "perturbations": [{ "target": "config.takeProfitPct",   "op": "multiply", "value": 0.5, "min": 1 }] }
  ]
}
```

Only these exact field names are accepted: an **arbitrary dotted path** (e.g.
`config.any.deep.path` or even `config.caps.maxTradeSizeUsd`) is **refused** — there is
no path traversal and no structural editing. `maxOpenPositions` is deliberately **not**
allowlisted because it exists in *both* `caps` and `strategyConfig` (ambiguous). A
`mint` filter is not allowed on a `config` target (the value is global). The targeted
field must already exist as a finite number (an absent optional field matches nothing
and is refused), and the perturbed variant must still validate — so a config
perturbation that would produce an invalid scenario (e.g. a negative cap) is refused.

## Inspecting a variant plan before generating (Sprint 14)

Before you generate variant files (or run a sensitivity sweep), **dry-run** the plan
to see exactly what it would do. `paper:backtest:scenario:variants:explain` reads the
same `--base` + `--plan` files, validates them with the **same** rules as generation,
and explains every variant's perturbations — target, `op`, `value`, `[min, max]`
bounds, `mint` filter, and **how many injected values each would change** — without
writing anything, generating any variant, or running a backtest:

```bash
# Human dry-run report (writes nothing; runs nothing):
pnpm soulmaker paper:backtest:scenario:variants:explain \
  --base examples/backtest/single-mint-buy-hold.scenario.json \
  --plan examples/backtest/price-sensitivity.variant-plan.json

# Stable machine-readable explanation (schema backtest.variant-plan.explain.v1):
pnpm soulmaker paper:backtest:scenario:variants:explain \
  --base examples/backtest/single-mint-buy-hold.scenario.json \
  --plan examples/backtest/price-sensitivity.variant-plan.json --json
```

For the shipped example it reports three variants, each changing **2** injected price
points (6 total), all valid. An invalid base, an invalid plan, or malformed JSON is
**refused** (exit 1), exactly like generation. The one difference: where generation
**throws** on a perturbation that matches **no** values, explain **reports** it
(`matchesNothing: true`, `valid: false`) and exits non-zero — so you can see *every*
problem at once and fix the plan before generating. It is a dry-run inspection only:
it carries `SIMULATED PAPER-ONLY VARIANT PLAN (DRY RUN)`, "Reads injected, simulated
local scenario data only", "Writes nothing…", "Not a live result", "Not financial
advice", and "Not a profitability claim".

## The whole sweep in one step (Sprint 13)

`paper:backtest:sensitivity` runs the entire sweep above as **one** deterministic
workflow: it generates the variants, runs the **base scenario once as a baseline**
plus every variant through the same `lint → backtest → validate` suite path, and
prints a stable report of each variant's **per-field delta versus the baseline**
(fills, simulated PnL, simulated notional, positions):

```bash
# Print the human report (PAPER-only; nothing is written without --out-dir):
pnpm soulmaker paper:backtest:sensitivity \
  --base examples/backtest/single-mint-buy-hold.scenario.json \
  --plan examples/backtest/price-sensitivity.variant-plan.json

# Stable machine-readable report (schema backtest.sensitivity.v1):
pnpm soulmaker paper:backtest:sensitivity \
  --base examples/backtest/single-mint-buy-hold.scenario.json \
  --plan examples/backtest/price-sensitivity.variant-plan.json --json

# Also write the full artifact tree (refuses overwrite without --force):
#   <out>/variants/<stem>.<suffix>.scenario.json   (one per variant)
#   <out>/reports/base.report.json                 (the baseline run)
#   <out>/reports/<suffix>.report.json             (one per variant)
#   <out>/reports/suite-index.json                 (the Sprint 11 suite index)
#   <out>/sensitivity-report.json                  (the Sprint 13 report)
pnpm soulmaker paper:backtest:sensitivity \
  --base examples/backtest/single-mint-buy-hold.scenario.json \
  --plan examples/backtest/price-sensitivity.variant-plan.json --out-dir sensitivity/
```

For the shipped example the baseline buys $100 and holds to a 50%-higher price
(total simulated PnL `50`); `price-up-10pct` / `price-down-10pct` leave that PnL
unchanged (Δ`0`, the multiplier invariance noted above) while `price-plus-1usd`
moves it (Δ ≈ `-16.67`).

The report also carries a deterministic **`rankings`** block (schema `backtest.sensitivity.v1`)
that orders the diffable (passed) variants by the **size** of each simulated
bookkeeping delta versus the baseline — `byTotalSimulatedPnlDelta`,
`byRealizedSimulatedPnlDelta`, `byUnrealizedSimulatedPnlDelta`, `byFillDelta`,
`byRejectDelta`, `byWarningDelta`, and `byNotionalDelta`. Each entry carries the
variant `suffix`, its `scenarioDigest`, the signed `value`, and its `magnitude`
(`|value|`, the sort key). Lists are ordered by `magnitude` descending and ties
resolve stably by `suffix` then `scenarioDigest`, so the order **never** depends on
plan order (a list is empty only when no variant is diffable, e.g. the baseline
failed). The human report prints a concise "Largest … delta" line per dimension. A
ranking surfaces the **largest simulated movement** in either direction — it is
**not** a "best", "winner", or "most profitable" ordering, and a delta is not a
profit, a loss, or a prediction. The report carries `SIMULATED PAPER-ONLY SENSITIVITY`,
"Uses injected, simulated local scenario data only", "Not a live result", "Not
financial advice", and "Not a profitability claim", and writes only after every
output path is preflighted — so it never writes partial output. A delta is the
change between two **simulated** runs — **not** a forecast, a real backtest, or a
profitability claim. (Phases 6 and 7 remain **not started**; nothing here touches a
wallet, key, signing, sending, or the network.)

## Diffing two sensitivity reports (Sprint 14)

To regression-review a sweep across two runs — e.g. before vs. after an engine or
config change — diff two `sensitivity-report.json` files you produced earlier with
`paper:backtest:sensitivity --out-dir`:

```bash
pnpm soulmaker paper:backtest:sensitivity --base base.scenario.json --plan plan.json --out-dir runA/
pnpm soulmaker paper:backtest:sensitivity --base base.scenario.json --plan plan.json --out-dir runB/
pnpm soulmaker paper:backtest:diff:sensitivity \
  --base runA/sensitivity-report.json \
  --next runB/sensitivity-report.json
# --json for a stable machine-readable diff (schema backtest.sensitivity.diff.v1);
# --fail-on-regression to exit non-zero only when hasRegression is true.
```

`paper:backtest:diff:sensitivity` reads **only** the two report files — it runs no
backtest, generates no variants, and writes nothing. It pairs variants by `suffix`
and reports added / removed / **changed** variants, baseline + count deltas, and
top-of-ranking movement. Regressions are **conservative** and bookkeeping-oriented: a
**same-digest** variant (identical content) should replay byte-identically, so any
simulated drift — total-PnL decrease, reject increase, warning increase, fill drop —
is a regression; a **newly-failed** variant, a removed passed variant (lost
coverage), an increased failed count, baseline drift for an identical base, or a
schema mismatch are also regressions. A **changed-digest** variant (different scenario
content, e.g. an edited base) is reported as *changed*, **not** a regression. Every
value is a bookkeeping delta between two **simulations** — not profit, loss, a
prediction, or advice.

## Reviewing suite coverage (Sprint 14)

`paper:backtest:suite:coverage` answers a different question: *did this suite actually
exercise different simulated paper-trading paths, or did every scenario do the same
thing?* It reads **one** `suite-index.json` (from `paper:backtest:suite --out-dir` or a
sensitivity run's `reports/suite-index.json`), runs no backtest, and writes nothing:

```bash
pnpm soulmaker paper:backtest:suite --dir examples/backtest --out-dir reports/
pnpm soulmaker paper:backtest:suite:coverage --suite-index reports/suite-index.json
# --json for a stable machine-readable report (schema backtest.coverage.v1).
```

It reports, using **only** counts the index already carries: per-behaviour scenario
counts (buy fills, sell fills, no-fills, rejects, warnings, open positions, closed
trades, realized/unrealized PnL), which behaviours were exercised **anywhere**, the
scenario id lists per behaviour, the unique run/entry statuses, and a transparently
defined **path-behaviour coverage ratio** = (tracked behaviours exercised by ≥1
scenario) / (7 tracked behaviours). For example, the all-buy-and-hold
`price-sensitivity` sweep covers `3/7` (it never sells, rejects, closes, or realizes
PnL), and the report names exactly which paths are **missing** so you can add a
scenario that exercises them.

> **This is NOT market coverage and NOT test/code coverage.** It is **behavioural
> bookkeeping** coverage over **injected, simulated** data — which paper paths the
> suite touched — not a measure of market conditions, code quality, or profitability.
> The ratio is a plainly-defined fraction, not a score and not advice.

## The full paper research workflow (Sprint 14)

All of the above compose into one **PAPER-only, deterministic, injected-only** research
loop. Nothing here is live, fetched, scraped, or advice; nothing touches a wallet, key,
signing, sending, or the network; Phases 6 and 7 remain **not started**.

```bash
# 1) Choose a local INJECTED scenario (or generate one from a template).
BASE=examples/backtest/single-mint-buy-hold.scenario.json
PLAN=examples/backtest/price-sensitivity.variant-plan.json

# 2) EXPLAIN the variant plan first (dry-run — writes nothing, runs nothing).
pnpm soulmaker paper:backtest:scenario:variants:explain --base "$BASE" --plan "$PLAN"

# 3) GENERATE the variant files (one validated INJECTED scenario per plan entry).
pnpm soulmaker paper:backtest:scenario:variants --base "$BASE" --plan "$PLAN" --out-dir variants/

# 4) Run a variant SENSITIVITY report (base-as-baseline + every variant; rankings + deltas).
pnpm soulmaker paper:backtest:sensitivity --base "$BASE" --plan "$PLAN" --out-dir runA/

# 5) Run a SUITE over a directory of scenarios (e.g. the generated variants).
pnpm soulmaker paper:backtest:suite --dir variants/ --out-dir variant-reports/

# 6) DIFF two suites (regression-review across directories).
pnpm soulmaker paper:backtest:diff:suite --base-dir baseline-reports/ --next-dir variant-reports/

# 7) DIFF two sensitivity reports (e.g. before/after an engine or config change).
pnpm soulmaker paper:backtest:sensitivity --base "$BASE" --plan "$PLAN" --out-dir runB/
pnpm soulmaker paper:backtest:diff:sensitivity \
  --base runA/sensitivity-report.json --next runB/sensitivity-report.json --fail-on-regression

# 8) Review COVERAGE — which simulated paper paths the suite actually exercised.
pnpm soulmaker paper:backtest:suite:coverage --suite-index runA/reports/suite-index.json
```

Every artifact is **simulated bookkeeping over injected data** — not a live result, not
a backtest of real history, not advice, and not a profitability claim. A delta is the
change between two simulations; a ranking is the largest simulated movement, not a
"winner"; coverage is behavioural, not market or test coverage.

## Sweeping many bases at once: the sensitivity matrix (Sprint 15)

Where `paper:backtest:sensitivity` sweeps **one** base scenario through a plan,
`paper:backtest:sensitivity:matrix` sweeps a whole **directory** of base scenarios
through **one shared plan** and aggregates the results into a single
**cross-scenario** report. This very directory is a ready-made matrix: all four shipped
`*.scenario.json` files are compatible with the shipped price plan, so it is a **4-base ×
3-variant** matrix out of the box:

```bash
# Human report (PAPER-only; nothing written without --out-dir):
pnpm soulmaker paper:backtest:sensitivity:matrix \
  --dir examples/backtest \
  --plan examples/backtest/price-sensitivity.variant-plan.json

# Stable machine-readable report (schema backtest.sensitivity.matrix.v1):
pnpm soulmaker paper:backtest:sensitivity:matrix \
  --dir examples/backtest \
  --plan examples/backtest/price-sensitivity.variant-plan.json --json

# Also write the matrix tree (refuses overwrite without --force):
#   <out>/sensitivity-matrix-report.json          (the Sprint 15 matrix report)
#   <out>/bases/<id>.sensitivity-report.json      (one Sprint 13 report per base)
pnpm soulmaker paper:backtest:sensitivity:matrix \
  --dir examples/backtest \
  --plan examples/backtest/price-sensitivity.variant-plan.json --out-dir matrix/
# --fail-on-error exits non-zero if any base baseline or variant run failed.
```

The matrix reads every top-level `*.scenario.json` in `--dir` (sorted by filename,
BOM-tolerant), derives a stable **base id** from each filename (two files that sanitize to
the same id are refused), and runs each base through the SAME Sprint 13 workflow. It is
**rectangular by construction** — every base is swept through the same plan, so each row
has the same variant suffixes — and **conservative**: a base that is invalid or
**incompatible** with the plan (a perturbation matching none of its injected values)
refuses the **whole** matrix, named, before any aggregate is built (no partial output).

For each variant suffix the report aggregates that one perturbation's effect **across all
bases**: `count` / `sum` / signed `min`・`max` / `meanMagnitude` / `maxMagnitude` of each
simulated delta (total/realized/unrealized PnL, fills, rejects, notional), plus neutral
**cross-base rankings** ordered by the size of that movement. As with every layer here, a
cross-base aggregate is **plain arithmetic over simulated deltas** — comparing two
different base scenarios is a bookkeeping comparison, **never** a "which token is better"
claim, a live result, or advice.

To regression-review a matrix across two runs, diff two `sensitivity-matrix-report.json`
files:

```bash
pnpm soulmaker paper:backtest:sensitivity:matrix --dir scenariosA/ --plan "$PLAN" --out-dir runA/
pnpm soulmaker paper:backtest:sensitivity:matrix --dir scenariosB/ --plan "$PLAN" --out-dir runB/
pnpm soulmaker paper:backtest:diff:sensitivity:matrix \
  --base runA/sensitivity-matrix-report.json \
  --next runB/sensitivity-matrix-report.json --fail-on-regression
```

`paper:backtest:diff:sensitivity:matrix` reads **only** the two report files (runs no
backtest, writes nothing). It pairs bases by id and cells by suffix and reports
added / removed / **changed** bases plus count and cross-base aggregate deltas.
Regressions are conservative: a **removed passed base** (lost coverage), a newly-failing
or **same-digest-drifted** base/cell, an increased failed count, or a schema mismatch is a
regression; a **changed-content** base and a cross-base aggregate change are descriptive,
**not** regressions. (Phases 6 and 7 remain **not started**; nothing here touches a
wallet, key, signing, sending, or the network.)

## Packaging & verifying a research run (Sprint 16)

A research run produces a directory of local JSON artifacts (reports, suite indexes,
sensitivity/matrix reports, …). `paper:backtest:research:manifest` indexes that directory
into a stable **manifest** — every artifact's path, detected kind + schema, byte size, and
a **non-cryptographic, reproducibility-only** content digest — so you can answer "what did
this run produce?" and verify the exact set later:

```bash
# Produce a research run (e.g. the cross-scenario matrix) into a directory:
pnpm soulmaker paper:backtest:sensitivity:matrix \
  --dir examples/backtest \
  --plan examples/backtest/price-sensitivity.variant-plan.json --out-dir matrix-run/

# Index it into a manifest (writes ONLY the manifest with --out; --force to overwrite):
pnpm soulmaker paper:backtest:research:manifest --dir matrix-run/ --out matrix-run/research-manifest.json
# --json for a stable machine-readable manifest (schema backtest.research.manifest.v1);
# --strict exits non-zero if any artifact is unknown/malformed.

# Verify the SAME directory later — re-reads every file, recomputes digests/sizes:
pnpm soulmaker paper:backtest:research:verify --manifest matrix-run/research-manifest.json --dir matrix-run/
# Prints VALID (exit 0) when the set matches; INVALID (exit 1) listing every
# missing / digest-changed / schema-changed / size-changed / extra artifact otherwise.

# Diff two manifests (e.g. two runs), failing on any change:
pnpm soulmaker paper:backtest:diff:research:manifest --base runA/manifest.json --next runB/manifest.json --fail-on-change
```

The manifest command walks `--dir` deterministically (real subdirectories only, symlinks
skipped, sorted, BOM-tolerant) and indexes only `*.json` files — **never** a `*.jsonl`
journal. A **malformed** JSON file is indexed as `unknown-json` and reported, never a crash.
A manifest written **into** the run directory is excluded on re-index, so a manifest never
indexes itself (and verify never flags it as "extra").

> **The digest is reproducibility-only, NOT a security guarantee.** It is the same
> non-cryptographic content fingerprint used elsewhere — it detects "same content" and
> traces an artifact, but it is **not** a cryptographic hash and **not** anti-tamper. The
> manifest is local bookkeeping over injected, simulated artifacts — **not** a live result,
> **not** advice, and **not** a profitability claim. Nothing here touches a wallet, key,
> signing, sending, or the network; Phases 6 and 7 remain **not started**.

## Bundling & checking a research run at a glance (Sprint 17)

The manifest answers "what did this run produce, and can I verify it later?". Sprint 17 adds
two commands one level up: a **bundle** that packages the whole run into a single
self-describing summary with a deterministic top-level **run digest**, and a **status** that
tells you — at a glance — whether the directory looks **complete / recognized / stable /
in sync**. Neither embeds artifact contents, and `status` **writes nothing**.

```bash
# Starting from a research run directory (see the Sprint 16 example above):
pnpm soulmaker paper:backtest:sensitivity:matrix \
  --dir examples/backtest \
  --plan examples/backtest/price-sensitivity.variant-plan.json --out-dir matrix-run/

# 1) Record a manifest INTO the run dir (status can then discover it by its conventional name):
pnpm soulmaker paper:backtest:research:manifest --dir matrix-run/ --out matrix-run/research-manifest.json

# 2) BUNDLE the run — one self-describing summary + a deterministic run digest
#    (manifest summary + kind/schema counts + recognized schemas + sorted digest refs):
pnpm soulmaker paper:backtest:research:bundle --dir matrix-run/ --out matrix-run/research-bundle.json
# --json for the machine-readable bundle (schema backtest.research.bundle.v1);
# --strict exits non-zero if any artifact is unknown/malformed. The bundle excludes every
# research META file (manifest/verify/diff/bundle/status), so it never indexes itself.

# 3) STATUS — a quick health check that WRITES NOTHING. The manifest written in step 1 is
#    discovered automatically (research-manifest.json), so drift is reported:
pnpm soulmaker paper:backtest:research:status --dir matrix-run/
# Prints complete / recognized / stable / in-sync verdicts + a single neutral recommended action.

# 4) Demonstrate DRIFT detection — change one artifact, then re-check with --strict:
#    (any edit to a recorded artifact flips "in sync" to no and, with --strict, exits 1)
pnpm soulmaker paper:backtest:research:status --dir matrix-run/ \
  --manifest matrix-run/research-manifest.json --strict
```

> **Same honesty as the manifest.** The run digest is the same **non-cryptographic,
> reproducibility-only** fingerprint — it makes two runs comparable and re-identifiable, but
> it is **not** a cryptographic hash and **not** anti-tamper. The bundle embeds **no** artifact
> contents, the status' recommended action is **operational** guidance about the directory and
> **never** trading advice, and both are local bookkeeping over injected, simulated artifacts —
> **not** a live result, **not** advice, and **not** a profitability claim. Nothing here touches
> a wallet, key, signing, sending, or the network; Phases 6 and 7 remain **not started**.

## Indexing a whole campaign of runs (Sprint 18)

A research **campaign** is just a directory whose immediate child directories are individual
runs. Sprint 18's campaign index summarizes every run at once — per-run digest + health, the
aggregate kinds/schemas, the runs needing attention, and one deterministic top-level **campaign
digest** — so you can answer "what runs exist, which need attention, and did anything change?"
in a single comparable report. It embeds no artifact contents and, without `--out`, writes nothing.

```bash
# 1) Produce two runs side-by-side under one campaign directory (each child dir is a run):
pnpm soulmaker paper:backtest:sensitivity:matrix \
  --dir examples/backtest \
  --plan examples/backtest/price-sensitivity.variant-plan.json --out-dir campaign/run-a/
pnpm soulmaker paper:backtest:sensitivity:matrix \
  --dir examples/backtest \
  --plan examples/backtest/price-sensitivity.variant-plan.json --out-dir campaign/run-b/

# 2) Record a manifest INTO each run dir (so per-run drift can be detected later):
pnpm soulmaker paper:backtest:research:manifest --dir campaign/run-a/ --out campaign/run-a/research-manifest.json
pnpm soulmaker paper:backtest:research:manifest --dir campaign/run-b/ --out campaign/run-b/research-manifest.json

# 3) INDEX the campaign — one comparable summary across both runs + a deterministic campaign digest:
pnpm soulmaker paper:backtest:research:index --dir campaign/ --out campaign/campaign-index.json
# --json for the machine-readable index (schema backtest.research.campaign.index.v1). Only
# immediate child DIRECTORIES are runs; the campaign-index.json written here is a top-level file,
# so it is never mistaken for a run, and symlinked/hidden child dirs are skipped.

# 4) Demonstrate STRICT campaign health — drift one run, then re-index with --strict (exits 1 when
#    any run needs attention: unknown/malformed/drift/incomplete). Edit a recorded artifact in run-a:
#    (after the edit, run-a is no longer in sync with its manifest → it "needs attention")
pnpm soulmaker paper:backtest:research:index --dir campaign/ --strict
```

> **Same honesty, one level up.** The campaign digest is the same **non-cryptographic,
> reproducibility-only** fingerprint over the sorted run digests — it makes two campaigns
> comparable and surfaces added / removed / changed runs, but it is **not** a cryptographic hash
> and **not** anti-tamper. The index embeds **no** artifact contents and is local bookkeeping over
> injected, simulated artifacts — **not** a live result, **not** advice, and **not** a
> profitability claim. Nothing here touches a wallet, key, signing, sending, or the network;
> Phases 6 and 7 remain **not started**.

## Diffing two bundles or two campaigns (Sprint 19)

The manifest, bundle, and campaign index each now have a matching **diff**. Sprint 19 adds the
bundle diff and the campaign index diff, so you can compare two PAPER-only runs (or two whole
campaigns) and tell a harmless addition apart from an integrity **regression**. Each diff reads
only the two named JSON files and **writes nothing**.

```bash
# 1) Produce a BASE campaign (two runs) and snapshot its index + run-a's bundle:
pnpm soulmaker paper:backtest:sensitivity:matrix \
  --dir examples/backtest \
  --plan examples/backtest/price-sensitivity.variant-plan.json --out-dir campaign/run-a/
pnpm soulmaker paper:backtest:sensitivity:matrix \
  --dir examples/backtest \
  --plan examples/backtest/price-sensitivity.variant-plan.json --out-dir campaign/run-b/
pnpm soulmaker paper:backtest:research:index  --dir campaign/        --out base-index.json
pnpm soulmaker paper:backtest:research:bundle --dir campaign/run-a/  --out run-a-base-bundle.json

# 2) Change the campaign: edit an artifact in run-a, then add a NEW run-c. Re-snapshot:
#    (editing run-a changes its content → its run digest moves; run-c is purely additive)
pnpm soulmaker paper:backtest:research:index  --dir campaign/        --out next-index.json
pnpm soulmaker paper:backtest:research:bundle --dir campaign/run-a/  --out run-a-next-bundle.json

# 3) DIFF THE BUNDLES — run-a base vs next. A changed artifact digest is a regression:
pnpm soulmaker paper:backtest:diff:research:bundle --base run-a-base-bundle.json --next run-a-next-bundle.json
# --json for the machine-readable diff (schema backtest.research.bundle.diff.v1).

# 4) DIFF THE CAMPAIGN INDEXES — base vs next. run-a changed (regression), run-c added (additive):
pnpm soulmaker paper:backtest:diff:research:index --base base-index.json --next next-index.json

# 5) STRICT behaviour — the same diff under each fail flag:
#    --fail-on-change exits 1 on ANY difference (so the added run-c alone trips it);
#    --fail-on-regression exits 1 ONLY on integrity breakage (run-a's digest change), NOT on
#    the purely additive run-c:
pnpm soulmaker paper:backtest:diff:research:index --base base-index.json --next next-index.json --fail-on-change
pnpm soulmaker paper:backtest:diff:research:index --base base-index.json --next next-index.json --fail-on-regression
```

> **Conservative by design.** `hasChange` flags any difference; `hasRegression` flags only
> integrity breakage — a removed or content-changed artifact, a removed valid run, a run going
> valid→invalid, an unexpected digest change, or an unknown/malformed increase. A purely **additive**
> new run or artifact is a change, **not** a regression. Every digest is the same
> **non-cryptographic, reproducibility-only** fingerprint, both diffs are local bookkeeping over
> injected, simulated summaries — **not** a live result, **not** advice, and **not** a profitability
> claim — and nothing here touches a wallet, key, signing, sending, or the network; Phases 6 and 7
> remain **not started**.

## Tracking a campaign over time (Sprint 20)

The campaign **diff** compares two snapshots; the campaign **history report** folds an **ordered
set** of campaign index snapshots into one trend view — which runs appeared / disappeared / changed
/ newly regressed / recovered, each run's current **valid** and **attention streaks**, and a
conservative regression signal you can fail CI on. Capture a campaign index after each research
session, keep the JSON files, and point `paper:backtest:research:history` at them oldest-first.

```bash
# 1) Snapshot the campaign index at three points in time (oldest first). In practice you produce
#    one of these per research session; here they are t0/t1/t2 of the same campaign directory:
pnpm soulmaker paper:backtest:research:index --dir campaign/ --out t0-index.json
# … edit/add runs in campaign/ between sessions …
pnpm soulmaker paper:backtest:research:index --dir campaign/ --out t1-index.json
# … edit/add runs again …
pnpm soulmaker paper:backtest:research:index --dir campaign/ --out t2-index.json

# 2) HISTORY — fold the ordered snapshots into one trend report (human-readable):
pnpm soulmaker paper:backtest:research:history --index t0-index.json --index t1-index.json --index t2-index.json
# --json for the machine-readable report (schema backtest.research.campaign.history.report.v1).

# 3) Pick the reference for the "since baseline" deltas:
#    --baseline first    (default) → since the OLDEST snapshot (t0)
#    --baseline previous           → since the SECOND-TO-LAST snapshot (t1)
#    --baseline t1-index.json      → since an EXPLICIT snapshot (matched by its --index path)
pnpm soulmaker paper:backtest:research:history --index t0-index.json --index t1-index.json --index t2-index.json --baseline previous

# 4) STRICT behaviour for CI — each flag sets a non-zero exit:
#    --fail-on-change       any change since baseline
#    --fail-on-regression   ONLY a conservative integrity regression since baseline
#    --fail-on-attention    any run needs attention in the LATEST snapshot
#    --fail-on-new-attention a run newly needs attention since baseline
pnpm soulmaker paper:backtest:research:history --index t0-index.json --index t2-index.json --fail-on-regression --fail-on-new-attention
```

> **Reuses the diff, never re-derives it.** The history report's `hasChange` and conservative
> `hasRegression` come straight from the Sprint 19 campaign diff (baseline → latest), so the
> regression definition is exactly the same: a previously-**valid** run removed, a run going
> **valid→invalid**, a paired run's **run digest** changing, an unknown/malformed increase, or an
> incompatible schema. A purely **additive** new run is a *change*, not a *regression*. Each snapshot
> must be a real `backtest.research.campaign.index.v1` (a bundle, a diff, or a malformed file is
> refused); the report carries no timestamp, so an identical ordered set of snapshots yields a
> byte-identical report. Every digest is the same **non-cryptographic, reproducibility-only**
> fingerprint; this is local bookkeeping over injected, simulated summaries — **not** a live result,
> **not** advice, and **not** a profitability claim — and nothing here touches a wallet, key,
> signing, sending, or the network; Phases 6 and 7 remain **not started**.

## Rolling up a portfolio of campaigns (Sprint 21)

The history report tracks **one** campaign over time; the **portfolio** report rolls up **many**
per-campaign history reports — one per campaign — into a single integrity-triage view: which
campaigns need attention, which regressed, which are clean/stable, the top concerns, and a CI
decision. Produce one history report per campaign (Sprint 20), keep the JSON files, and point
`paper:backtest:research:portfolio` at them, keyed by a campaign id.

```bash
# 1) Produce one history report per campaign (each from that campaign's ordered index snapshots):
pnpm soulmaker paper:backtest:research:history --index scalping/t0.json --index scalping/t1.json --json > scalping-history.json
pnpm soulmaker paper:backtest:research:history --index momentum/t0.json --index momentum/t1.json --json > momentum-history.json

# 2) PORTFOLIO — roll the per-campaign history reports up into one view (human-readable). Each
#    --history is "campaignId=path"; the campaign id is how the campaign is labelled in the report:
pnpm soulmaker paper:backtest:research:portfolio --history scalping=scalping-history.json --history momentum=momentum-history.json
# --json for the machine-readable report (schema backtest.research.portfolio.report.v1).

# 3) STRICT behaviour for CI — each flag sets a non-zero exit across the WHOLE portfolio:
#    --fail-on-change        any campaign changed since baseline
#    --fail-on-regression    ONLY a conservative integrity regression in any campaign
#    --fail-on-attention     any campaign currently needs attention
#    --fail-on-new-attention any campaign newly needs attention since baseline
pnpm soulmaker paper:backtest:research:portfolio --history scalping=scalping-history.json --history momentum=momentum-history.json --fail-on-regression --fail-on-new-attention
```

> **Carries the campaign signals verbatim; orders by triage, not performance.** Every per-campaign
> flag (change / attention / regression), count, and streak is copied straight from that campaign's
> history report, so the portfolio view can never disagree with the per-campaign reports. Campaigns
> are listed in **integrity-triage order** (most-concerning first) — this is a *read-worst-first*
> order, **not** a trading "best/worst" ranking. "Clean" (no integrity concern) and "stable" (no
> change at all) are distinct: a campaign with a persistently-broken run is *stable* yet not *clean*.
> Run totals are **summed** across campaigns — run ids are campaign-scoped, so there is no
> cross-campaign de-duplication. Each `--history` file must be a real
> `backtest.research.campaign.history.report.v1` (a campaign index, a bundle, a malformed file, a bad
> `campaignId=path` spec, or a duplicate campaign id is refused); the report carries no timestamp and
> is independent of the order campaigns are supplied in, so an identical set yields a byte-identical
> report. This is local bookkeeping over injected, simulated summaries — **not** a live result,
> **not** advice, and **not** a profitability claim — and nothing here touches a wallet, key,
> signing, sending, or the network; Phases 6 and 7 remain **not started**.

## Diffing two portfolio snapshots (Sprint 22)

The portfolio report is a single snapshot across many campaigns; the **portfolio diff** compares
**two** such snapshots — e.g. last week's portfolio vs this week's — and answers *which campaigns
appeared or disappeared, and (over the campaigns present in both) which newly regressed, recovered,
newly need attention, or became clean/stable*, plus the aggregate count deltas and a CI decision.
Keep two portfolio report JSON files and point `paper:backtest:diff:research:portfolio` at them.

```bash
# 1) Produce two portfolio snapshots (Sprint 21), e.g. before and after a change:
pnpm soulmaker paper:backtest:research:portfolio --history scalping=scalping-history.json --history momentum=momentum-history.json --json > portfolio-before.json
#    ...make changes, re-run the campaigns, rebuild the history reports...
pnpm soulmaker paper:backtest:research:portfolio --history scalping=scalping-history.json --history momentum=momentum-history.json --json > portfolio-after.json

# 2) PORTFOLIO DIFF — compare the two snapshots (human-readable):
pnpm soulmaker paper:backtest:diff:research:portfolio --base portfolio-before.json --next portfolio-after.json
# --json for the machine-readable diff (schema backtest.research.portfolio.diff.v1).

# 3) STRICT behaviour for CI — each flag sets a non-zero exit:
#    --fail-on-change        any change at all (incl. a campaign added or removed)
#    --fail-on-regression    ONLY a common campaign that newly regressed (no-regression -> regression)
#    --fail-on-attention     current attention newly appeared on a common campaign
#    --fail-on-new-attention since-baseline attention newly appeared on a common campaign
pnpm soulmaker paper:backtest:diff:research:portfolio --base portfolio-before.json --next portfolio-after.json --fail-on-regression --fail-on-new-attention
```

> **Two axes, kept separate — and conservative, non-overclaimed flags.** Campaign **membership**
> (added / removed / common) is reported separately from **status transitions**, which are computed
> only over the campaigns present in **both** reports (a transition needs a before *and* an after).
> A **disappearing** campaign is a change / scope change — **not** a regression (you choose which
> campaigns to track). A campaign that is **added** already carrying a regression sets `hasChange`
> (so `--fail-on-change` catches it) but **not** `hasRegression`, because there is no base state for
> it to have regressed from; `hasRegression` fires only when a **common** campaign transitions into a
> regression. Both `--base` and `--next` must be a real
> `backtest.research.portfolio.report.v1` (a history report, a campaign index, a malformed file, or a
> report with duplicate campaign ids is refused). The diff carries no timestamp, so the same pair
> yields a byte-identical diff. This is local bookkeeping over two injected, simulated summaries —
> **not** a live result, **not** advice, and **not** a profitability claim; the digests behind the
> summaries are non-cryptographic content fingerprints, not an anti-tamper guarantee. Nothing here
> touches a wallet, key, signing, sending, or the network; Phases 6 and 7 remain **not started**.

## Packing a research run into one navigable summary (Sprint 23)

A real research run produces several artifacts — a campaign history, a portfolio report, a portfolio
diff, maybe a manifest/bundle/status. The **artifact pack** collects them into one navigable
integrity + navigation summary so a human or CI can see the whole run's state without opening every
file. Keep the artifact JSON files and point `paper:backtest:research:pack` at them, each keyed by a
label.

```bash
# 1) Produce the per-layer artifacts (Sprints 16–22), keeping each --json output as a file, e.g.:
pnpm soulmaker paper:backtest:research:history --index t0.json --index t1.json --json > campaign-history.json
pnpm soulmaker paper:backtest:research:portfolio --history scalping=campaign-history.json --json > portfolio.json
pnpm soulmaker paper:backtest:diff:research:portfolio --base portfolio-before.json --next portfolio.json --json > portfolio-diff.json

# 2) PACK — collect them into one summary (human-readable). Each --artifact is "label=path":
pnpm soulmaker paper:backtest:research:pack --artifact history=campaign-history.json --artifact portfolio=portfolio.json --artifact diff=portfolio-diff.json
# --json for the machine-readable pack (schema backtest.research.artifact.pack.v1).
# --out research-pack.json writes ONLY the pack JSON (refuses overwrite without --force).

# 3) STRICT behaviour for CI — each flag sets a non-zero exit across the pack:
#    --fail-on-change                    any artifact reports a change
#    --fail-on-regression                any artifact reports a conservative integrity regression
#    --fail-on-attention                 any artifact reports current attention
#    --fail-on-new-attention             any artifact reports newly-needed attention
#    --fail-on-unsupported               any artifact has an unsupported schema
#    --fail-on-missing-recommended-layer a recommended chain layer is missing
pnpm soulmaker paper:backtest:research:pack --artifact portfolio=portfolio.json --artifact diff=portfolio-diff.json --fail-on-regression --fail-on-unsupported
```

> **Classifies and validates real artifacts; never invents a type, never overclaims completeness.**
> Each artifact is classified by its `schemaVersion` against the **ten real research schemas only**.
> A KNOWN artifact is strictly validated — a corrupt artifact that claims a known schema is refused;
> a well-formed but **unknown** schema is reported as an `unsupported` entry (not refused), gated by
> `--fail-on-unsupported`. Every per-artifact change/regression/attention/recovery flag is read
> **verbatim** from that artifact (a flag a kind does not carry is `null`, never invented as `false`),
> so the pack can never disagree with the artifacts it summarizes. The **chain-coverage** tiers
> (minimal / campaign-level / portfolio-level / diff-ready) describe which layers are **present** —
> they are **not** a completeness or correctness guarantee. The pack carries no timestamp, so the same
> set yields a byte-identical pack. It reads the named files only, follows no nested paths, and makes
> no network call; it writes nothing unless `--out` is given (then only the pack JSON). This is local
> bookkeeping over injected, simulated artifacts — **not** a live result, **not** advice, and **not**
> a profitability claim; the digests behind the artifacts are non-cryptographic content fingerprints,
> not an anti-tamper guarantee. Nothing here touches a wallet, key, signing, sending, or the network;
> Phases 6 and 7 remain **not started**.

## Diffing two research packs (Sprint 24)

Keep two artifact-pack JSON files (e.g. last CI run's pack vs this run's pack) and point
`paper:backtest:diff:research:pack` at them to see what drifted across the whole research run at once.

```bash
# 1) Produce a pack per run and keep each --json output as a file:
pnpm soulmaker paper:backtest:research:pack --artifact history=campaign-history.json --artifact portfolio=portfolio.json --json > pack-before.json
# ...later, after a new research run...
pnpm soulmaker paper:backtest:research:pack --artifact history=campaign-history.json --artifact portfolio=portfolio.json --json > pack-now.json

# 2) DIFF — compare the two packs (human-readable). Artifacts are paired by label:
pnpm soulmaker paper:backtest:diff:research:pack --base pack-before.json --next pack-now.json
# --json for the machine-readable diff (schema backtest.research.artifact.pack.diff.v1).

# 3) STRICT behaviour for CI — each flag sets a non-zero exit:
#    --fail-on-change         any artifact added/removed or a common artifact changed
#    --fail-on-regression     a COMMON artifact newly carries a conservative regression
#    --fail-on-attention      current attention newly appeared on a common artifact
#    --fail-on-new-attention  new-attention newly appeared on a common artifact
#    --fail-on-unsupported    an unsupported artifact is newly present (common lost recognition, or added)
pnpm soulmaker paper:backtest:diff:research:pack --base pack-before.json --next pack-now.json --fail-on-regression --fail-on-unsupported
```

> **Conservative, honest transitions.** Artifacts are paired by their stable `label`. The
> artifact-set axis reports added / removed / common; per-artifact transitions (newly changed /
> regressed / recovered / newly need attention / newly unsupported) are computed over the **common**
> set only — an appearance is never relabelled a transition. A disappearing artifact is a scope change,
> **not** a regression; an added artifact that arrives already regressed sets `hasChange` (gated by
> `--fail-on-change`), not `hasRegression`. A newly unsupported artifact (a common artifact that lost
> recognition, or an added unsupported artifact) sets `hasUnsupported`. The diff reads the two named
> files only, makes no network call, and writes nothing. Local bookkeeping over two local summaries —
> **not** a live result, **not** advice, **not** a profitability claim.
