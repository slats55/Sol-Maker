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
