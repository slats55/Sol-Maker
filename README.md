# Soulmaker

> A private, **security-first** Solana memecoin trading command center.
> **Wallet safety first. Speed second.**

Soulmaker is a personal bot + command center for watching Solana token/pool
activity, filtering risky launches, paper trading, simulating transactions, and
— only much later, behind many gates — executing tightly-capped **burner-wallet**
trades. It is built to be independently controlled, auditable, and safe from
wallet-drainer behavior.

This project exists because raw private keys handed to untrusted "sniper bots"
get drained. Soulmaker is the opposite of that: it is read-only and simulated by
default, and live sending is impossible unless a stack of explicit safety gates
all pass.

---

## ⚠️ Status: Phases 0–1 done; Phase 2 read-only core complete; Phase 3 advisory risk engine complete; Phase 4 simulated paper engine complete; Phase 5 paper-only strategy rules engine complete (Sprint 5 single-candidate + Sprint 6 batch plan pipeline + Sprint 7 journal-aware planning & richer simulated exits + Sprint 8 journal-continuing paper runs & deterministic simulated backtest + Sprint 9 scenario linting, example fixtures, stabler/richer backtest reports & BOM-tolerant JSON parsing + Sprint 10 backtest report diffing & deterministic scenario-authoring helpers + Sprint 11 backtest suite runs & suite diffing over directories of injected scenarios). No live trading. By design.

Nothing in this repository can move funds. There is **no transaction signing or
sending code anywhere in it yet** — the read-only Solana watcher (Phase 2) and
advisory risk engine (Phase 3) are read-only by construction, the Phase 4 paper
engine is **simulated-only** (injected prices, no wallet, no chain), and the
Phase 5 strategy engine is a **pure, paper-only** rules engine that only feeds the
paper engine (no chain, no wallet, no execution). Sprint 6 adds `strategy:plan`,
which turns an injected candidate **list** into a `PaperCandidate[]` an operator
passes to `paper:run` **manually**. Sprint 7 adds `strategy:plan --journal` (derive
the simulated portfolio from a **read-only** paper journal) and richer **simulated**
exits (trailing stop, partial take-profit, position-aware sizing). Sprint 8 closes
the loop: `paper:run --journal` now **continues** from an existing valid journal
(strictly derived starting state, append-only) so a sell candidate produced from
the journal actually finds its open position — and a new `@soulmaker/backtest`
package + `paper:backtest` command replay injected, local-only steps through the
**same** `plan → paper` code paths into a deterministic, **simulated** report. It
is **injected historical data only**: not a live result, not a profitability
claim, not advice. Sprint 9 hardens that backtest foundation: a scenario
**linter** (`paper:backtest:lint`) flags structural errors and
suspicious-but-allowed design before a run; copyable **example fixtures** live
under [`examples/backtest/`](examples/backtest/); the report gains a stable
`schemaVersion`, a reproducibility `scenarioDigest`, a per-step `equityCurve`, and
**exact** `perMint` aggregates (all bookkeeping from injected prices); the CLI's
local JSON readers tolerate a leading UTF-8 **BOM**; and `paper:backtest
--seed-journal` can seed a run from an external JSONL journal. Sprint 10 makes the
backtest easier to review and regression-test, **still injected-only**:
`paper:backtest:diff` deterministically compares **two existing** report JSON files
(metadata/compatibility, summary deltas, warning/equity/per-mint diffs, and a
conservative `hasRegression` flag) — every delta is a bookkeeping difference between
two **simulations**, never a prediction, profit/loss, or advice; and
`paper:backtest:scenario:new` / `paper:backtest:scenario:matrix` deterministically
author injected scenario **skeletons** (fake mints, injected prices — not real
historical data) from built-in templates and safe, config-only patches. Sprint 11
adds the **suite** layer, still injected-only: `paper:backtest:suite` runs a whole
directory of `*.scenario.json` files as one deterministic suite and aggregates their
**simulated** reports into a stable `suite-index.json` (passed/failed counts, summed
fills and PnL, per-entry summaries); `paper:backtest:diff:suite` compares two suite
output directories by their indexes (added/removed/changed scenarios, aggregate
deltas, and a conservative `hasRegression` flag). A suite total is simulated
bookkeeping summed over injected prices — not a live result, not advice, not a
profitability claim; a *changed* scenario (different content) is a bookkeeping
difference, never a recommendation. Sprint 12 adds
`paper:backtest:scenario:variants`: it generates injected scenario variants from a
base by applying a small, declarative plan of **bounded numeric perturbations**
(`multiply`/`add`, clamped to explicit bounds) to the injected `price` points and
candidate `metric.<field>` values — no code, no expressions, no RNG; the steps
structure, name, journal, and config are protected, and a perturbation that
matches nothing is refused rather than silently ignored. Its output dir feeds
straight into `paper:backtest:suite` + `paper:backtest:diff:suite` for a
price-sensitivity sweep, and every variant is simulated local scenario data — not
a live result, not advice, not a profitability claim. Sprint 13 adds
`paper:backtest:sensitivity`, one workflow over the same two layers: it generates
those variants, runs the **base scenario once as a baseline** plus every variant
through the same suite path, and emits a stable, versioned
(`backtest.sensitivity.v1`) report of each variant's **per-field delta versus the
baseline** (fills, simulated PnL, notional, positions). With `--out-dir` it writes
the variants, one report per scenario, the suite index, and `sensitivity-report.json`
(preflighted so it never writes partial output; refuses to overwrite without
`--force`). A delta is the change between two simulated runs — not a prediction, not
advice, not a profitability claim. Sprint 14 rounds out the **paper research lab** on
top of these layers: the sensitivity report now carries deterministic **rankings** of
the diffable variants by the size of each bookkeeping delta (largest movement, never a
"best"/"winner"); `paper:backtest:scenario:variants:explain` is a **dry-run** that
explains a variant plan (each perturbation's target/op/value/bounds/mint and how many
injected values it would change) without generating or running anything;
`paper:backtest:diff:sensitivity` diffs two sensitivity reports with a conservative
`hasRegression` flag; variant plans gained an allowlisted **`config.<field>`**
perturbation target (e.g. `config.maxTradeSizeUsd`, no path traversal); and
`paper:backtest:suite:coverage` reports which simulated paper-trading paths a suite
exercised (behavioural bookkeeping coverage, **not** market or test coverage). Sprint 15
adds the **cross-scenario sensitivity matrix**: `paper:backtest:sensitivity:matrix --dir
<scenarios> --plan <plan>` sweeps a whole directory of injected base scenarios through
**one shared variant plan** (each base via the Sprint 13 workflow) and aggregates every
`(base × variant)` cell into a stable, versioned (`backtest.sensitivity.matrix.v1`)
report — per-base rows, per-variant cross-base delta aggregates (sum / signed min・max /
mean & max magnitude), and neutral cross-base rankings (largest movement, never a
"best"/"winner"). A base that is invalid or incompatible with the plan refuses the whole
matrix (named) with no partial output; `--out-dir` writes the matrix report plus one
per-base sensitivity report, and `paper:backtest:diff:sensitivity:matrix` diffs two matrix
reports with a conservative `hasRegression` flag. Sprint 16 adds a **reproducibility /
audit** layer over all of these local artifacts: `paper:backtest:research:manifest --dir
<artifacts>` indexes every local JSON artifact a research run produced — classifying each
by schema and fingerprinting it with a **non-cryptographic, reproducibility-only** content
digest — into a stable (`backtest.research.manifest.v1`) manifest;
`paper:backtest:research:verify --manifest <m> --dir <d>` later re-reads the directory and
reports any missing / changed / extra / schema-mismatched artifact (exit 1 if the set
drifted); and `paper:backtest:diff:research:manifest` diffs two manifests. The manifest
answers "what exactly did this local PAPER-only run produce, and can I verify it later?" —
it is local bookkeeping, not a security/anti-tamper guarantee. Sprint 17 packages a run
**above** the manifest: `paper:backtest:research:bundle --dir <artifacts>` builds one
self-describing **bundle** (`backtest.research.bundle.v1`) — a manifest summary, kind +
schema counts, the recognized-schema set, unknown/malformed counts, the sorted per-artifact
digest references, and one deterministic top-level **run digest** that fingerprints the
whole artifact set (so two runs compare at a glance; a single changed artifact changes the
run digest) — and `paper:backtest:research:status --dir <artifacts>` gives a quick health
check (`backtest.research.status.v1`): is the directory **complete / recognized / stable /
in sync** with its recorded manifest, with a single neutral recommended action. Both embed
no artifact contents, the run digest is the same **non-cryptographic, reproducibility-only**
fingerprint, and status **writes nothing**. None of this fetches live
data or begins transaction planning (roadmap Phase 6 remains not started; Phase 7 burner
live remains not started). The default mode is `PAPER`. See
[`docs/ROADMAP.md`](docs/ROADMAP.md).

## Non-negotiable security rules (summary)

The full, authoritative list is in [`SECURITY.md`](SECURITY.md). The short form:

1. **Never** request, store, print, log, commit, or transmit a seed / recovery
   phrase. Ever.
2. **Never** use your main wallet for automated trading.
3. The only live mode is `DANGEROUS_BURNER_LIVE`, and only with a **fresh
   burner** holding trivial funds.
4. Default mode is `PAPER` (or read-only `WATCH_ONLY`).
5. Live sending is impossible unless **every** live-mode gate passes.
6. Hard caps: max trade size, max daily loss, max open positions, kill switch.
7. All secrets are **redacted** from logs (keys, seeds, RPC/API keys, bearer
   tokens, cookies, session tokens).
8. No hidden fees, transfers, referral skims, or unreviewed destination
   accounts.
9. Every transaction is **simulated** and rendered as a **human-readable plan**
   before any signing/sending (later phases).
10. No "auto-approve everything" behavior.

## Repository layout

```
soulmaker/
  apps/
    cli/        # @soulmaker/cli  — read-only CLI (doctor, config:check, mode, paper:status,
                #                    solana:doctor, wallet:watch, token:inspect/accounts/risk,
                #                    paper:run/journal, strategy:evaluate, strategy:plan,
                #                    paper:backtest, paper:backtest:lint, paper:backtest:diff,
                #                    paper:backtest:scenario:new, paper:backtest:scenario:matrix,
                #                    paper:backtest:scenario:variants,
                #                    paper:backtest:scenario:variants:explain,
                #                    paper:backtest:suite, paper:backtest:diff:suite,
                #                    paper:backtest:suite:coverage,
                #                    paper:backtest:sensitivity, paper:backtest:diff:sensitivity,
                #                    paper:backtest:sensitivity:matrix, paper:backtest:diff:sensitivity:matrix,
                #                    paper:backtest:research:manifest/verify, paper:backtest:diff:research:manifest,
                #                    paper:backtest:research:bundle, paper:backtest:research:status)
    web/        # Phase 8 dashboard (placeholder)
  packages/
    core/       # @soulmaker/core      — config schema, modes, risk caps, LIVE GATE
    security/   # @soulmaker/security  — secret redaction + redacting logger
    solana/     # Phase 2 — read-only RPC watcher (public-key/mint reads only)
    risk/       # Phase 3 — read-only advisory token risk flags + scoring
    paper/      # Phase 4 — deterministic, simulated-only paper trading engine;
                #            Sprint 8 adds journal-continuing runs (injectable startingState)
    strategy/   # Phase 5 — deterministic, paper-only strategy rules engine (feeds paper);
                #            Sprint 6 adds the batch plan pipeline → PaperCandidate[];
                #            Sprint 7 adds journal-aware planning + richer simulated exits
    backtest/   # @soulmaker/backtest  — Sprint 8 deterministic, injected-only simulated
                #            replay over plan → paper; Sprint 9 adds scenario lint/validate,
                #            a content digest, and stabler/richer reports (not a live result);
                #            Sprint 10 adds report diffing + scenario template/matrix builders;
                #            Sprint 11 adds the pure suite runner/index + suite diffing;
                #            Sprint 12 adds the deterministic scenario variant generator;
                #            Sprint 13 adds the pure variant-sensitivity workflow + report;
                #            Sprint 14 adds sensitivity rankings, variant-plan explain,
                #            sensitivity diff, config.<field> perturbations, and suite coverage;
                #            Sprint 15 adds the multi-base sensitivity matrix + matrix diff;
                #            Sprint 16 adds the research artifact manifest (build/verify/diff);
                #            Sprint 17 adds the research run bundle + integrity/status summary
                #            (still pure: the package never scans dirs or reads/writes files)
    adapters/   # Phase 6+ — audited external integrations (placeholder)
  examples/
    backtest/   # injected, copyable example scenarios + fixtures (NOT historical market data)
  docs/         # ARCHITECTURE, ROADMAP, WALLET_SAFETY_MODEL, RISK_MODEL, REFERENCE_REPO_AUDIT
  scripts/      # thin operational scripts
  tests/        # cross-package integration tests (unit tests live beside code)
  references/   # study-only clones (gitignored, never committed, never run with funds)
```

## Tech stack

TypeScript-first pnpm monorepo on Node.js ≥ 20. Zod for config validation,
Vitest for tests, a custom pino-compatible **redacting** logger, ESLint +
`tsc --noEmit` for quality. `@solana/web3.js` / `@solana/spl-token` arrive in
Phase 2 (read-only first).

## Getting started

```bash
pnpm install

# quality gates
pnpm typecheck      # tsc --noEmit across the monorepo
pnpm lint           # eslint
pnpm test           # vitest (one-shot)
pnpm check          # all three

# the read-only CLI
pnpm soulmaker doctor
pnpm soulmaker config:check
pnpm soulmaker mode
pnpm soulmaker paper:status

# read-only chain commands (need rpcUrl; PAPER mode needs --allow-paper-read)
pnpm soulmaker solana:doctor
pnpm soulmaker wallet:watch <publicKey>
pnpm soulmaker token:inspect <mint>
pnpm soulmaker token:accounts <ownerPublicKey>
pnpm soulmaker token:risk <mint>      # advisory risk report — NOT a buy recommendation

# simulated-only paper trading (offline; injected fixtures; PAPER ONLY)
pnpm soulmaker paper:run --candidates <candidates.json> --prices <prices.json>
pnpm soulmaker paper:journal --journal <journal.jsonl>
pnpm soulmaker paper:status   --journal <journal.jsonl>
# --journal makes paper:run STATEFUL: an existing valid journal is read first and
# becomes the run's starting state (append-only). A malformed journal is refused
# before anything is appended; a missing journal starts empty and is created.
pnpm soulmaker paper:run --candidates <candidates.json> --prices <prices.json> \
  --journal <journal.jsonl>

# paper-only strategy decisioning (offline; injected JSON; feeds paper only; not advice)
pnpm soulmaker strategy:evaluate --candidate <candidate.json> --config <config.json>

# batch plan: a candidate LIST → PaperCandidate[] for a later, MANUAL paper:run
# (PAPER ONLY; does NOT auto-run paper trades; not advice)
pnpm soulmaker strategy:plan --candidates <candidates.json> --config <config.json> \
  --size 100 --out <paper-candidates.json>
# optional position-awareness from a READ-ONLY paper journal (instead of --paper-state):
pnpm soulmaker strategy:plan --candidates <candidates.json> --config <config.json> \
  --journal <journal.jsonl>
# then, by hand — pass the SAME journal so the run continues from it (Sprint 8):
pnpm soulmaker paper:run --candidates <paper-candidates.json> --prices <prices.json> \
  --journal <journal.jsonl>

# deterministic, injected-only SIMULATED backtest/replay (PAPER ONLY; not a live
# result; not a profitability claim; not advice). The scenario is one local JSON
# file embedding its own strategy config + caps + ordered steps:
pnpm soulmaker paper:backtest --scenario <scenario.json>
pnpm soulmaker paper:backtest --scenario <scenario.json> --json --out <report.json>
# seed the starting state from an EXTERNAL journal (mutually exclusive with an
# embedded initialJournal; read-only — the journal is never written):
pnpm soulmaker paper:backtest --scenario <scenario.json> --seed-journal <journal.jsonl>

# lint/validate a scenario WITHOUT running it (Sprint 9): errors block a run,
# warnings flag suspicious-but-allowed design. Local JSON readers tolerate a
# leading UTF-8 BOM. Copyable example scenarios live in examples/backtest/:
pnpm soulmaker paper:backtest:lint --scenario examples/backtest/single-mint-buy-full-exit.scenario.json
pnpm soulmaker paper:backtest:lint --scenario <scenario.json> --json

# Sprint 10 — deterministically DIFF two existing SIMULATED report JSON files
# (reads only the two files; runs no backtest; deltas are bookkeeping, not advice
# or a prediction). --fail-on-regression exits non-zero only on a regression:
pnpm soulmaker paper:backtest:diff --base <base-report.json> --next <next-report.json>
pnpm soulmaker paper:backtest:diff --base <base.json> --next <next.json> --json
pnpm soulmaker paper:backtest:diff --base <base.json> --next <next.json> --fail-on-regression

# Sprint 10 — author INJECTED scenario skeletons (fake mints + injected prices,
# NOT real historical data). Templates: buy-hold | buy-full-exit | partial-exit |
# seed-journal-continuation. Refuses to overwrite without --force:
pnpm soulmaker paper:backtest:scenario:new --template buy-hold --out <scenario.json>
# expand a base scenario by a SAFE, config-only matrix into one file per variant
# (patches may only set strategyConfig/caps/defaultPaperSizeUsd; no code/expressions):
pnpm soulmaker paper:backtest:scenario:matrix --base <base.json> --matrix <matrix.json> --out-dir <dir>

# Sprint 11 — run a DIRECTORY of injected *.scenario.json files as ONE deterministic
# suite (sorted by filename, BOM-tolerant; a malformed file refuses the whole suite).
# Lint errors fail+skip a scenario; warnings still run. Totals are SIMULATED
# bookkeeping summed over injected prices — not a live result, not advice:
pnpm soulmaker paper:backtest:suite --dir examples/backtest
pnpm soulmaker paper:backtest:suite --dir examples/backtest --json
# --out-dir writes one report per PASSED scenario + suite-index.json (never a journal/
# fills; refuses to overwrite without --force). --fail-on-error exits non-zero if any
# scenario failed:
pnpm soulmaker paper:backtest:suite --dir examples/backtest --out-dir <reports/>
# compare TWO suite output directories by their suite-index.json (added/removed/changed
# scenarios + aggregate deltas + hasRegression; a changed scenario is NOT a regression):
pnpm soulmaker paper:backtest:diff:suite --base-dir <reportsA/> --next-dir <reportsB/>
pnpm soulmaker paper:backtest:diff:suite --base-dir <reportsA/> --next-dir <reportsB/> --json
pnpm soulmaker paper:backtest:diff:suite --base-dir <reportsA/> --next-dir <reportsB/> --fail-on-regression

# Sprint 12 — generate INJECTED scenario VARIANTS from a base by applying a plan of
# BOUNDED numeric perturbations (multiply/add, clamped) to its injected prices/metrics.
# No code/expressions, no RNG; steps/name/journal/config are protected; a perturbation
# that matches nothing is refused. Writes one validated file per variant (--force to
# overwrite). Feed the out-dir into a suite + suite diff for a price-sensitivity sweep:
pnpm soulmaker paper:backtest:scenario:variants \
  --base examples/backtest/single-mint-buy-hold.scenario.json \
  --plan examples/backtest/price-sensitivity.variant-plan.json --out-dir <variants/>
pnpm soulmaker paper:backtest:suite --dir <variants/> --out-dir <variant-reports/>
pnpm soulmaker paper:backtest:diff:suite --base-dir <baseline-reports/> --next-dir <variant-reports/>

# Sprint 13 — the whole sensitivity sweep as ONE workflow: generate the variants,
# run the BASE once as a baseline + every variant through the same suite path, and
# emit a stable backtest.sensitivity.v1 report of each variant's per-field delta vs
# the baseline. --out-dir writes variants/ + reports/ + sensitivity-report.json
# (preflighted, no partial writes; --force to overwrite). Simulated bookkeeping only:
pnpm soulmaker paper:backtest:sensitivity \
  --base examples/backtest/single-mint-buy-hold.scenario.json \
  --plan examples/backtest/price-sensitivity.variant-plan.json
pnpm soulmaker paper:backtest:sensitivity \
  --base examples/backtest/single-mint-buy-hold.scenario.json \
  --plan examples/backtest/price-sensitivity.variant-plan.json --out-dir <sensitivity/> --json

# Sprint 14 — the paper research lab on top of the layers above.
# (a) DRY-RUN explain a variant plan (no files, no backtest): each perturbation's
#     target/op/value/bounds/mint + how many injected values it would change. A
#     config.<field> target (allowlisted, e.g. config.maxTradeSizeUsd) is supported:
pnpm soulmaker paper:backtest:scenario:variants:explain \
  --base examples/backtest/single-mint-buy-hold.scenario.json \
  --plan examples/backtest/price-sensitivity.variant-plan.json
# (b) DIFF two sensitivity reports (pairs variants by suffix; conservative regression;
#     a same-digest drift is a regression, a changed-content variant is not):
pnpm soulmaker paper:backtest:diff:sensitivity \
  --base <runA/sensitivity-report.json> --next <runB/sensitivity-report.json> --fail-on-regression
# (c) COVERAGE of a suite index — which simulated paper paths were exercised
#     (behavioural bookkeeping coverage, NOT market/test coverage):
pnpm soulmaker paper:backtest:suite:coverage --suite-index <reports/suite-index.json>

# Sprint 15 — CROSS-SCENARIO sensitivity MATRIX: sweep a whole directory of injected
# base scenarios through ONE shared variant plan and aggregate every (base × variant)
# cell. The examples directory is a ready-made 4-base × 3-variant matrix. --out-dir
# writes sensitivity-matrix-report.json + bases/<id>.sensitivity-report.json:
pnpm soulmaker paper:backtest:sensitivity:matrix \
  --dir examples/backtest \
  --plan examples/backtest/price-sensitivity.variant-plan.json --out-dir <matrix/> --json
# DIFF two matrix reports (pairs bases by id and cells by suffix; conservative regression
# — a removed passed base or a same-digest drift is a regression, a changed base is not):
pnpm soulmaker paper:backtest:diff:sensitivity:matrix \
  --base <runA/sensitivity-matrix-report.json> --next <runB/sensitivity-matrix-report.json> --fail-on-regression

# Sprint 16 — REPRODUCIBILITY: index a research run's local artifacts into a manifest
# (classify + a non-cryptographic, reproducibility-only content digest per file), then
# verify the exact set later. Reads local files only; writes only the manifest with --out:
pnpm soulmaker paper:backtest:research:manifest --dir <matrix/> --out <matrix/>/research-manifest.json
pnpm soulmaker paper:backtest:research:verify --manifest <matrix/>/research-manifest.json --dir <matrix/>
# (exit 1 if anything is missing/changed/extra). DIFF two manifests (--fail-on-change):
pnpm soulmaker paper:backtest:diff:research:manifest --base <runA/manifest.json> --next <runB/manifest.json>

# Sprint 17 — BUNDLE: package the run into one self-describing summary with a deterministic
# top-level run digest (manifest summary + counts + recognized schemas + sorted digest refs).
# Embeds no artifact contents; writes only the bundle with --out; --strict fails on unknown/malformed:
pnpm soulmaker paper:backtest:research:bundle --dir <matrix/> --out <matrix/>/research-bundle.json
# STATUS: a quick health check — complete / recognized / stable / in-sync — that WRITES NOTHING.
# A manifest is discovered (research-manifest.json) or passed with --manifest; --strict fails on drift:
pnpm soulmaker paper:backtest:research:status --dir <matrix/>
pnpm soulmaker paper:backtest:research:status --dir <matrix/> --manifest <matrix/>/research-manifest.json --strict
```

Configuration comes from `soulmaker.config.json` (copy
`soulmaker.config.example.json`) and/or `SOULMAKER_*` environment variables
(copy `.env.example` → `.env`). Both `.env` and `soulmaker.config.json` are
gitignored. Defaults are safe: `PAPER` mode, kill switch off, redaction on.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design & boundaries
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — phased plan (Phases 0 → 8)
- [`docs/WALLET_SAFETY_MODEL.md`](docs/WALLET_SAFETY_MODEL.md) — key handling & live gate
- [`docs/RISK_MODEL.md`](docs/RISK_MODEL.md) — caps, kill switch, token risk flags
- [`docs/PAPER_TRADING_MODEL.md`](docs/PAPER_TRADING_MODEL.md) — simulated paper engine (Phase 4) + backtest
- [`docs/STRATEGY_MODEL.md`](docs/STRATEGY_MODEL.md) — paper-only strategy rules engine (Phase 5)
- [`examples/backtest/README.md`](examples/backtest/README.md) — injected example scenarios (fixtures, not market truth)
- [`docs/REFERENCE_REPO_AUDIT.md`](docs/REFERENCE_REPO_AUDIT.md) — audit of reference repos
- [`SECURITY.md`](SECURITY.md) — the authoritative security rules

## License

License decision is intentionally **pending** (see `SECURITY.md` →
"License & dependencies"). Until decided, Soulmaker stays original and does
**not** vendor third-party (esp. GPL) code. It is private and unpublished.
