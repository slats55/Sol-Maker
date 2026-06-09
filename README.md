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
fingerprint, and status **writes nothing**. Sprint 18 indexes a whole **campaign** of runs:
`paper:backtest:research:index --dir <campaign>` treats each immediate child directory as a
run, summarizes each (run digest, kind/schema counts, unknown/malformed totals, and
complete/recognized/stable/in-sync health), aggregates the kind/schema sets across the
campaign, lists the runs needing attention, and emits one deterministic top-level **campaign
digest** (`backtest.research.campaign.index.v1`) over the sorted run digests + stable metadata
(so an added / removed / changed run all move it); `--strict` exits non-zero when any run
needs attention and the index embeds no artifact contents. Sprint 19 completes the
index→diff symmetry with two deterministic **diff** commands:
`paper:backtest:diff:research:bundle` (`backtest.research.bundle.diff.v1`) compares two run
bundles and `paper:backtest:diff:research:index` (`backtest.research.campaign.diff.v1`)
compares two campaign indexes. Each reads only the two named files, writes nothing, and reports
both a `hasChange` flag and a **conservative** `hasRegression` flag — `--fail-on-change` exits
non-zero on any difference, while `--fail-on-regression` fires only on integrity breakage
(a removed/changed artifact, a removed valid run, a run going valid→invalid, an unexpected
digest change, or an unknown/malformed increase) and treats a purely additive run/artifact as a
change, not a regression. Sprint 20 folds a **time series** of campaign indexes into one
deterministic **history report**: `paper:backtest:research:history --index <i0> --index <i1> …`
reads an ordered set of campaign index snapshots (oldest first) and answers which runs first
appeared / disappeared / changed / newly regressed / recovered, each run's first/last-seen,
present-valid-attention-now state, current **valid** and **attention streaks**, and digest-change
count (`backtest.research.campaign.history.report.v1`). It REUSES the Sprint 19 campaign diff for
the since-baseline / since-previous deltas — so `hasChange` and the conservative `hasRegression`
are byte-identical to the diff — and adds `--fail-on-change` / `--fail-on-regression` /
`--fail-on-attention` / `--fail-on-new-attention` for CI, with `--baseline first|previous|<path>`
to pick the reference snapshot. It reads only the named files and writes nothing. Sprint 21 rolls up
a **portfolio** of campaign history reports into one integrity-triage view:
`paper:backtest:research:portfolio --history <campaignId=path> …` folds many per-campaign history
reports (one per campaign) into a single report (`backtest.research.portfolio.report.v1`) that
carries each campaign's change/attention/regression signal **verbatim**, orders campaigns by
integrity triage (most-concerning first), lists the clean/stable campaigns and the top concerns,
sums run totals across campaigns (run ids are campaign-scoped, never de-duplicated), and exposes the
same four `--fail-on-*` CI flags. It reads only the named files and writes nothing. Sprint 22 closes
the symmetry with a **portfolio diff**: `paper:backtest:diff:research:portfolio --base <path> --next
<path>` compares two portfolio reports (`backtest.research.portfolio.diff.v1`) — which campaigns
appeared/disappeared, and, over the campaigns present in **both**, which newly regressed / recovered /
newly need attention / became clean or stable — plus the aggregate count deltas and a conservative
regression flag. A disappearing campaign is a change / scope change, **not** a regression; an added
campaign that already carries a regression sets `hasChange` (gated by `--fail-on-change`), not
`hasRegression`. It reads only the two named files and writes nothing. Sprint 23 adds a **research
artifact pack**: `paper:backtest:research:pack --artifact <label=path> …` collects many local
research artifacts (manifest / bundle / status / campaign index / campaign diff / campaign history /
portfolio report / portfolio diff) into one navigable integrity + navigation summary
(`backtest.research.artifact.pack.v1`) — each artifact's kind / recognized-status / change /
regression / attention flags read **verbatim**, the aggregate counts, which chain layers are present
or missing, and a CI decision (incl. `--fail-on-unsupported`). A known artifact is strictly
validated; an unknown schema is reported as `unsupported`, never silently trusted. It reads the named
files only and writes nothing unless `--out <path>` is given (then only the pack JSON, refusing
overwrite without `--force`). Sprint 24 closes the pack symmetry with a **pack diff**:
`paper:backtest:diff:research:pack --base <path> --next <path>` compares two artifact packs
(`backtest.research.artifact.pack.diff.v1`) — which artifacts appeared/disappeared (paired by label),
and, over the artifacts present in **both**, which newly changed / regressed / recovered / newly need
attention / became newly unsupported — plus the aggregate count deltas, the chain-coverage changes,
and conservative flags with a CI decision (incl. `--fail-on-unsupported`). A newly unsupported
artifact (a common artifact that lost recognition, or an added unsupported artifact) sets
`hasUnsupported`; an added artifact that already carries a regression sets `hasChange` (gated by
`--fail-on-change`), not `hasRegression`. It reads only the two named files and writes nothing. None
of this fetches live data or begins transaction planning (roadmap Phase 6 remains not started;
Phase 7 burner live remains not started). The default mode is `PAPER`. See
[`docs/ROADMAP.md`](docs/ROADMAP.md).

Sprint 25 begins the **sniper** path proper with a safe, offline **candidate intake** layer in a new
pure `@soulmaker/sniper` package: `paper:sniper:candidates:validate --input <path>` validates +
normalizes a local candidate list (`sniper.candidate.list.v1`). Every mint is validated as a 32-byte
Solana **public** key — secret-length / private-key-like input is **refused** so a private key or seed
phrase can never be pasted in and accepted — candidate ids must be unique, and duplicate mints are
surfaced as warnings. The package carries **no chain capability** (no `@solana/web3.js`, no
`@soulmaker/solana`): mint validation uses a pure base58 decoder, and the operator-supplied
liquidity / market / social context is intake metadata that is **not** verified on-chain by this step
(a later read-only preflight does that). It reads the named file only and writes nothing. This is
intake validation — **not** a trade signal, **not** a verified on-chain fact, and **not** advice.

Sprint 26 adds the **token preflight**: `paper:sniper:preflight --candidates <path>` builds a
read-only safety/research summary per candidate (`sniper.token.preflight.report.v1`) — `pass` / `warn`
/ `fail` / `unknown` — by combining each mint's validity with **already-loaded** read-only inspection
(the existing `token:inspect` output) and advisory risk (the existing `token:risk` output), supplied
as local files via `--inspection candidateId=path` / `--risk candidateId=path`. A risk `REJECT` or a
critical flag fails; `CAUTION`, a freeze/mint authority, or a high flag warns; no data is `unknown`.
The pure builder does **no on-chain reads itself** — it is LOCAL-ONLY (no RPC, no network, no wallet),
and the package still carries no chain capability. It writes nothing unless `--out` is given. A `pass`
is **not** a "safe to trade" judgment.

Sprint 27 adds the **paper decision pipeline** — the first real sniper-bot-shaped step:
`paper:sniper:decide --candidates <path> [--preflight <path>] [--rules <path>]` folds the candidate
list, the preflight, and deterministic operator rules into a per-candidate **simulated** decision
(`sniper.paper.decision.report.v1`) — `skip` / `watch` / `paper-enter` / `paper-reject` / `unknown` —
with reasons, blocking risk flags, applied rules, and assumptions. A candidate reaches `paper-enter`
only when the preflight passed and every rule is satisfied. A `paper-enter` is a **paper-only**
decision — **not** a buy/sell order, **not** a transaction, **not** live readiness. `--fail-on-paper-enter`
and `--fail-on-risk` are CI gates; it writes nothing unless `--out`. No network, no wallet, no
transaction build/sign/send. See [`docs/SNIPER_MODEL.md`](docs/SNIPER_MODEL.md).

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
                #                    paper:backtest:research:bundle, paper:backtest:research:status,
                #                    paper:backtest:research:index, paper:backtest:research:history,
                #                    paper:backtest:research:portfolio,
                #                    paper:backtest:diff:research:bundle, paper:backtest:diff:research:index,
                #                    paper:backtest:diff:research:portfolio,
                #                    paper:backtest:research:pack, paper:backtest:diff:research:pack)
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
                #            Sprint 17 adds the research run bundle + integrity/status summary;
                #            Sprint 18 adds the cross-run research campaign index;
                #            Sprint 19 adds the research bundle diff + campaign index diff;
                #            Sprint 20 adds the research campaign history/trend report;
                #            Sprint 21 adds the research portfolio rollup across campaigns;
                #            Sprint 22 adds the research portfolio diff (two portfolio reports);
                #            Sprint 23 adds the research artifact pack (summarizes many artifacts);
                #            Sprint 24 adds the research artifact pack diff (two packs)
                #            (still pure: the package never scans dirs or reads/writes files)
    sniper/     # @soulmaker/sniper    — Phase 5+ PAPER-only, offline sniper decision support;
                #            Sprint 25 adds candidate intake (sniper.candidate.list.v1): pure mint
                #            validation (32-byte pubkey; secret-length input refused), unique ids,
                #            duplicate-mint warnings;
                #            Sprint 26 adds token preflight (sniper.token.preflight.report.v1):
                #            pass/warn/fail/unknown per candidate from already-loaded read-only
                #            inspection + advisory risk;
                #            Sprint 27 adds paper decisions (sniper.paper.decision.report.v1):
                #            skip/watch/paper-enter/paper-reject/unknown from preflight + rules
                #            (paper-only decisions) — NO chain capability, NO wallet, NO network
    adapters/   # Phase 6+ — audited external integrations (placeholder)
  examples/
    backtest/   # injected, copyable example scenarios + fixtures (NOT historical market data)
    sniper/     # injected, copyable candidate-list fixtures (NOT live data, NOT trading results)
  docs/         # ARCHITECTURE, ROADMAP, SNIPER_MODEL, WALLET_SAFETY_MODEL, RISK_MODEL
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

# Sprint 18 — CAMPAIGN INDEX: index a directory of research runs (each immediate child dir is a
# run) into one comparable summary — per-run digests + health, aggregate kinds/schemas, the runs
# needing attention, and a deterministic top-level campaign digest. Writes only the index with
# --out; --strict fails when any run needs attention (unknown/malformed/drift/incomplete):
pnpm soulmaker paper:backtest:research:index --dir <campaign/> --out <campaign/>/campaign-index.json
pnpm soulmaker paper:backtest:research:index --dir <campaign/> --strict

# Sprint 19 — DIFF: compare two bundles or two campaign indexes. Reads only the two files, writes
# nothing. --fail-on-change exits 1 on ANY difference; --fail-on-regression exits 1 ONLY on
# integrity breakage (removed/changed artifact or run, valid→invalid, unknown/malformed increase):
pnpm soulmaker paper:backtest:diff:research:bundle --base <runA/bundle.json> --next <runB/bundle.json> --fail-on-regression
pnpm soulmaker paper:backtest:diff:research:index --base <campA/index.json> --next <campB/index.json> --fail-on-change

# Sprint 20 — HISTORY: fold an ORDERED set of campaign indexes (oldest first) into one trend report —
# which runs appeared/disappeared/changed/regressed/recovered, per-run valid + attention streaks,
# and a conservative regression signal. Reads the named files only, writes nothing. --baseline picks
# the reference (first|previous|<path>); the --fail-on-* flags set a non-zero CI exit:
pnpm soulmaker paper:backtest:research:history --index <t0/index.json> --index <t1/index.json> --index <t2/index.json>
pnpm soulmaker paper:backtest:research:history --index <t0/index.json> --index <t1/index.json> --fail-on-regression --fail-on-new-attention

# Sprint 21 — PORTFOLIO: roll up many per-campaign history reports (one per campaign) into one
# integrity-triage view — which campaigns need attention / regressed / changed / are clean, the top
# concerns, and summed run totals. Reads the named files only, writes nothing. Each --history is
# keyed by a campaign id; the --fail-on-* flags set a non-zero CI exit across the portfolio:
pnpm soulmaker paper:backtest:research:portfolio --history scalping=<scalping-history.json> --history momentum=<momentum-history.json>
pnpm soulmaker paper:backtest:research:portfolio --history scalping=<scalping-history.json> --history momentum=<momentum-history.json> --fail-on-regression --fail-on-new-attention

# Sprint 22 — PORTFOLIO DIFF: compare two portfolio reports — which campaigns appeared/disappeared,
# and (over the campaigns in BOTH) which newly regressed / recovered / newly need attention / became
# clean or stable — plus aggregate count deltas and a conservative regression flag. A disappearing
# campaign is a change, NOT a regression. Reads the two named files only, writes nothing:
pnpm soulmaker paper:backtest:diff:research:portfolio --base <portfolio-before.json> --next <portfolio-after.json>
pnpm soulmaker paper:backtest:diff:research:portfolio --base <portfolio-before.json> --next <portfolio-after.json> --fail-on-regression --fail-on-new-attention

# Sprint 23 — ARTIFACT PACK: collect many local research artifacts into one navigable integrity +
# navigation summary — each artifact's kind/recognized-status/flags, the aggregate counts, which
# chain layers are present/missing, and a CI decision. Each --artifact is "label=path"; a known
# artifact is strictly validated, an unknown schema is reported as unsupported. Reads the named
# files only; writes nothing unless --out is given (then only the pack JSON, --force to overwrite):
pnpm soulmaker paper:backtest:research:pack --artifact campaigns=campaign-history.json --artifact portfolio=portfolio.json --artifact diff=portfolio-diff.json
pnpm soulmaker paper:backtest:research:pack --artifact portfolio=portfolio.json --artifact diff=portfolio-diff.json --fail-on-regression --fail-on-unsupported --out research-pack.json

# Sprint 24 — PACK DIFF: compare two artifact packs (pack-before.json vs pack-now.json), paired by
# label — which artifacts appeared/disappeared, and over the common set which newly changed /
# regressed / recovered / newly need attention / became newly unsupported, plus the aggregate count
# deltas, chain-coverage changes, and a conservative CI decision. Reads the two named files only,
# writes nothing:
pnpm soulmaker paper:backtest:diff:research:pack --base <pack-before.json> --next <pack-now.json>
pnpm soulmaker paper:backtest:diff:research:pack --base <pack-before.json> --next <pack-now.json> --fail-on-regression --fail-on-unsupported

# Sprint 25 — SNIPER CANDIDATE INTAKE: validate + normalize a LOCAL candidate list (operator intake).
# Every mint is validated as a 32-byte Solana public key (secret-length / private-key-like input is
# REFUSED), candidate ids must be unique, and duplicate mints are surfaced as warnings. Reads the named
# file only, writes nothing, no network/RPC/wallet — intake validation, NOT a trade signal:
pnpm soulmaker paper:sniper:candidates:validate --input examples/sniper/candidates.example.json
pnpm soulmaker paper:sniper:candidates:validate --input examples/sniper/candidates.example.json --json
pnpm soulmaker paper:sniper:candidates:validate --input examples/sniper/candidates.example.json --fail-on-warning

# Sprint 26 — SNIPER TOKEN PREFLIGHT: a read-only safety/research summary per candidate (pass / warn /
# fail / unknown), combining mint validity + ALREADY-LOADED read-only inspection (token:inspect output)
# + advisory risk (token:risk output). LOCAL-ONLY: no RPC, no network, no wallet. Risk REJECT or a
# critical flag = fail; CAUTION / freeze or mint authority / high flag = warn; no data = unknown.
# A safety/research preflight, NOT a trade signal. Reads the named files only, writes nothing unless --out:
pnpm soulmaker token:inspect <mint> --json > c1.inspect.json   # existing read-only command (operator-run)
pnpm soulmaker token:risk <mint> --json > c1.risk.json         # existing advisory risk command
pnpm soulmaker paper:sniper:preflight --candidates <candidates.json> --inspection c1=c1.inspect.json --risk c1=c1.risk.json
pnpm soulmaker paper:sniper:preflight --candidates <candidates.json> --risk c1=c1.risk.json --fail-on-fail

# Sprint 27 — PAPER SNIPER DECISIONS: fold the candidate list + preflight + optional operator rules
# into a per-candidate SIMULATED decision — skip / watch / paper-enter / paper-reject / unknown — with
# reasons. A paper-enter is a PAPER-ONLY decision, NOT a buy/sell order, NOT a transaction, NOT live
# readiness. Reads the named files only, writes nothing unless --out. No network, no wallet:
pnpm soulmaker paper:sniper:decide --candidates <candidates.json> --preflight preflight.json
pnpm soulmaker paper:sniper:decide --candidates <candidates.json> --preflight preflight.json --rules rules.json --json
pnpm soulmaker paper:sniper:decide --candidates <candidates.json> --preflight preflight.json --fail-on-paper-enter
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
