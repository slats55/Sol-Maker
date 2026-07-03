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

## ⚠️ Status: Phases 0–5 complete (read-only watcher, advisory risk, simulated paper engine, paper strategy/backtest research lab through Sprint 24); the PAPER sniper pipeline is operator-runnable end to end (Sprints 25–90: intake → read-only inspect/risk → the S90 preflight **bridge** → preflight → policy → decisions → audit → governance specs → safety gates → Phase 6 prereqs → simulation intent plan → result → route resolution → chain audit → readiness → handoff → operator bundle, all through one `paper:sniper:dry-run` command with a local web inspector and a Sniper Command Center page). Route resolution is honestly UNAVAILABLE (no resolver capability exists), the real `simulateTransaction` dry-run is designed but unbuilt, and Phase 7 (live trading) is NOT started. No live trading. By design.

> **Sprint 107 — Part 1 of the live build (NEW): a Phantom-signing live execution bridge.** Sol
> Maker can now prepare a **real** unsigned Solana mainnet transaction and hand it to **your own
> Phantom wallet** to sign — through a separate, isolated browser **Live Console**. It is
> **disabled by default, micro-capped (0.005 SOL default trade), and human-confirmed**: the backend
> holds **no key**, signs nothing, and there is **no mainnet CLI send surface**. No real canary
> trade has been broadcast by this build, and **no profit is claimed or guaranteed**. See
> [`docs/LIVE_EXECUTION_PHANTOM.md`](docs/LIVE_EXECUTION_PHANTOM.md). Paper mode and the whole paper
> pipeline below are unchanged.

### Live execution (Part 1) — quick reference

```bash
# Inspect the live-mode policy gate (read-only; default = everything blocked):
pnpm soulmaker live:policy:inspect
pnpm soulmaker live:chains            # chain readiness (only solana-mainnet is live)
pnpm soulmaker live:kill-switch       # kill switch / emergency stop status

# Assemble a Phantom-signable canary request from real artifacts (never signs/sends):
pnpm soulmaker live:canary:prepare --candidate-mint <MINT> --risk runs/risk.json \
  --envelope runs/envelope.json --simulation runs/sim.json --spend-sol 0.005 \
  --mode live_canary --live-enabled --out runs/request.json

# Then confirm in the browser, in YOUR Phantom wallet:
pnpm web:build   # writes apps/web/public/live-console.html — open it with the Phantom extension
```

The full step-by-step canary flow, the four live modes, the hard caps, and the safety guarantees are
in [`docs/LIVE_EXECUTION_PHANTOM.md`](docs/LIVE_EXECUTION_PHANTOM.md).

> **Sprint 108 — Part 2 of the live build (NEW): an armed, operator-controlled sniper loop.** It
> discovers real candidates (real `@soulmaker/realtime` feeds or manual mints), scores them
> transparently (v2), runs a paper-shadow "would-have" simulation, and — only in the explicitly-armed
> mode with every gate green — **recommends** preparing one tiny canary. `loopModeCanTrade` is `false`
> for **every** mode: the loop never signs, sends, or trades. A human still prepares the unsigned
> request and signs it in Phantom. Real mainnet evidence (risk + quotes) and the honest live-capability
> matrix are in [`docs/FINAL_PART_2_STATUS.md`](docs/FINAL_PART_2_STATUS.md); the human canary
> procedure is in [`docs/LIVE_SNIPER_CANARY_RUNBOOK.md`](docs/LIVE_SNIPER_CANARY_RUNBOOK.md).

### Live sniper loop (Part 2) — quick reference

```bash
pnpm soulmaker live:sniper:policy                      # loop modes (default off) + escalation caps
pnpm soulmaker live:sniper:discover --mint <MINT>      # real-time / manual candidate discovery (read-only)
pnpm soulmaker live:sniper:shadow --mint <MINT> --risk <MINT>=risk.json --quote <MINT>=q.json
pnpm soulmaker live:sniper:run --mode armed_canary --escalation-armed --mint <MINT> \
  --risk <MINT>=risk.json --quote <MINT>=q.json --spend-sol 0.005   # recommends only; never sends
pnpm web:build   # also writes apps/web/public/sniper-dashboard.html — read-only operator dashboard
```

The loop never signs or sends. When it recommends a canary, a human runs `live:canary:prepare`, loads
the unsigned request into the Live Console, and confirms in Phantom. No mode trades autonomously.

> **Sprint 109 — Part 3 of the live build (NEW): the supervised operator release.** One strict
> fail-closed operator config drives everything; an append-only session journal makes caps,
> cooldown, pauses and manual re-arms durable across restarts; the supervised run stays
> recommend-only in every mode; reconciliation computes honest PnL (unknown when evidence is
> missing); alerts are local-only and off by default. **No real canary has been executed** — the
> truthful machine artifact is `examples/live/part3/ready-for-human-canary.report.json`. See
> [`docs/FINAL_PART_3_PRODUCTION_CANARY_RUNBOOK.md`](docs/FINAL_PART_3_PRODUCTION_CANARY_RUNBOOK.md)
> (the human canary procedure) and
> [`docs/FINAL_LIVE_RELEASE_DOSSIER.md`](docs/FINAL_LIVE_RELEASE_DOSSIER.md) (capabilities,
> guarantees, limitations, remaining work).

### Production operator release (Part 3) — quick reference

```bash
pnpm soulmaker live:operator:validate --config runs/operator-config.json   # strict fail-closed validation
pnpm soulmaker live:operator:session:start --session-log runs/session.jsonl --session-id s1 --operator you
pnpm soulmaker live:operator:run --config runs/operator-config.json --mode observe_only \
  --snapshot runs/snapshot.json --session-log runs/session.jsonl           # supervised pass (recommend-only)
pnpm soulmaker live:operator:session:status --session-log runs/session.jsonl
pnpm soulmaker live:operator:session:export --session-log runs/session.jsonl --out runs/session-export.json
pnpm soulmaker live:operator:reconcile --candidate-mint <MINT> --facts runs/facts.json \
  --pre runs/pre.json --post runs/post.json                                # honest post-canary accounting
pnpm web:build   # also writes apps/web/public/operator-dashboard.html — the read-only operator view
```

Modes `off | observe_only | paper_shadow | armed_canary` — none trades; `armed_canary` may
RECOMMEND at most one tiny canary per run and requires the journal + an explicit arm. Kill switch /
emergency stop block everything. Large trades stay disabled. The backend never holds keys and never
sends — the human signs in Phantom, always.

### Run the PAPER sniper right now

```bash
pnpm install && pnpm soulmaker paper:sniper:dry-run \
  --candidates examples/sniper/operator-dress-rehearsal/candidates.rich.json \
  --preflight-input examples/sniper/operator-dress-rehearsal/preflight-input.rich.json \
  --adopt-specs --operator "you" --acknowledge-paper-enter-review \
  --out runs/first-rehearsal
# then read runs/first-rehearsal/RUN_SUMMARY.md, and inspect in the local web UI:
pnpm web:inspect --dir runs/first-rehearsal --force   # → apps/web/public/research-folder.html
```

Start with [`examples/sniper/operator-dress-rehearsal/`](examples/sniper/operator-dress-rehearsal/README.md)
(four ready-to-run fictional examples covering every verdict),
[`examples/sniper/real-input-rehearsal/`](examples/sniper/real-input-rehearsal/README.md) (the S90
real-input workflow: read-only inspect/risk → preflight bridge → dry-run → web UI) and
[`docs/SNIPER_RUNBOOK.md`](docs/SNIPER_RUNBOOK.md) (the full operator runbook). A clean run ends
**`blocked` on `simulation-blocked-prereqs-not-ready`** — simulated paper-enters always demand
operator review; that is the honest designed end state, not a bug. The committed
`apps/web/public/sniper.html` page is the **Sniper Command Center** over the shipped sample run.

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
transaction build/sign/send.

Sprint 28 ties the path together with an operator helper and a runbook:
`paper:sniper:workflow` checks which local artifacts exist + validate and prints the recommended NEXT
command in the intake → preflight → decide sequence (`sniper.workflow.plan.v1`). It **describes** the
sequence only — it executes no stage, runs no live action, and writes nothing. The full operator
walkthrough lives in [`docs/SNIPER_RUNBOOK.md`](docs/SNIPER_RUNBOOK.md); the model/design is in
[`docs/SNIPER_MODEL.md`](docs/SNIPER_MODEL.md).

Sprint 30 bundles the path's artifacts into one navigable **run report**: `paper:sniper:report
--candidates <path> [--preflight <path>] [--decisions <path>] [--workflow <path>]` joins the candidate
list, the preflight, the decision report, and the workflow plan into one operator-readable
`sniper.run.report.v1` — a per-candidate reason trail (preflight status + simulated decision), grouped
id lists (paper-enter / paper-reject / skip / watch / risk-blocked / missing-info / unknown / invalid),
a navigation index, and a CI section (`--fail-on-invalid` / `--fail-on-preflight-fail` / `--fail-on-risk`
/ `--fail-on-paper-enter` / `--fail-on-unknown` / `--fail-on-missing-recommended`). Every status and
decision is carried **verbatim** — the report re-derives nothing. It writes nothing unless `--out`; a
`paper-enter` carried through is a **simulated** classification, never an order.

Sprint 31 compares two run reports: `paper:sniper:diff:report --base <a> --next <b>` produces a
`sniper.run.report.diff.v1` — candidates added / removed / present in both, per-candidate decision and
preflight-status transitions, conservative directional flags (`--fail-on-new-invalid` /
`--fail-on-new-preflight-fail` / `--fail-on-new-risk` / `--fail-on-new-paper-enter` /
`--fail-on-new-unknown`, plus `--fail-on-change` and a `hasRecovery` signal), and aggregate deltas. It
reads only the two files and **writes nothing**; every transition is computed verbatim from the two
reports.

Sprint 32 makes the decision policy explicit and versioned: `paper:sniper:policy:validate --input
<policy.json>` validates + normalizes a `sniper.policy.config.v1` (conservative by default), and
`paper:sniper:decide --policy <policy.json>` governs a run with it. A policy carries base decision rules
plus **tighten-only** enforcement (`allowPaperEnter`, `failClosedOnUnknownPreflight`,
`failClosedOnMissingRisk`, `disallowedRiskFlags`), candidate-list guards (`maxCandidatesPerRun`,
`duplicateMintPolicy`), and paper sizing assumptions that are **labels / simulated units only** (no
currency, profit, or ROI claim). Enforcement can only make a run **more** conservative — it may downgrade
a simulated `paper-enter` to `watch`/`paper-reject`, never the reverse, and enables no live behaviour.

Sprint 33 adds a deterministic **audit log** — a prerequisite for any future Phase 6 simulation:
`paper:sniper:audit --report <run.json> --label <run-id>` builds a `sniper.audit.log.v1`, one entry per
pipeline step (intake → preflight → decide → report) with input/output artifact labels, a one-line
decision summary, and the step's warnings/failures. It carries **no wall-clock time** — the run label is
operator-supplied, never `Date.now()` — so the same run report yields a byte-identical log. It writes
nothing unless `--out`; `--fail-on-failure` / `--fail-on-warning` gate CI.

Sprint 34 bundles a whole local operator session: `paper:sniper:session:pack --artifact <label=path> …`
collects the sniper artifacts (candidate list, preflight, decision, run report + diff, policy, audit log)
into one `sniper.session.pack.v1`. Each artifact is classified by its `schemaVersion` against a registry
of the **known** sniper schemas — a known schema is strictly validated and its flags read verbatim, while
an **unknown** schema is surfaced honestly as `unsupported` (never silently trusted). Coverage tiers
(`isMinimal` / `isDecisionReady` / `isAudited`) describe **presence only**, never completeness or trading
readiness. It writes nothing unless `--out`; `--fail-on-risk` / `--fail-on-unknown` /
`--fail-on-paper-enter` / `--fail-on-unsupported` gate CI.

Sprint 39 adds a **fail-closed** pre-simulation safety check: `paper:sniper:safety:gates --session
<pack.json>` evaluates a `sniper.safety.gates.report.v1` over a session pack — candidate list / decision
/ audit log present, no unsupported artifacts, and (gated by explicit `--allow-unknown` /
`--allow-risk-block` / `--allow-paper-enter`) no unknowns / risk blocks / simulated paper-enters. It is
fail-closed (a concern fails its gate unless explicitly allowed) and **exits 1 when not ready**. Passing
every gate is **local/paper readiness only — never Phase 6 authorization**; Phase 6 and Phase 7 remain
not started.

Sprint 40 turns the Phase 6 boundary prerequisites into a machine-readable checklist:
`paper:phase6:prereqs --session <pack.json>` reads a session pack and reports a
`phase6.prerequisite.report.v1` — the five artifact prerequisites (intake / preflight / decisions /
config / audit) derived from the pack, plus the six design prerequisites (workflow / risk limits / test
coverage / kill-switch / secrets policy / burner isolation) reported as documented. It implements **no
transaction planning** and can **never authorize Phase 6**: `phase6ImplementationStarted` is always
false and `requiresExplicitHumanApproval` always true — beginning Phase 6 is an explicit human decision,
never a machine verdict.

Sprint 41 adds the Phase 6 boundary's first, deliberately **inert** step — *type-contract data only*:
`paper:phase6:intent:plan --decisions <decision.json>` builds a `simulation.intent.plan.v1`, one **inert,
not-executable** entry per simulated paper-enter. Each entry is plain DATA describing the *hypothetical
intent* a future planner would consider (a hypothetical side, an amount **label** — never currency —
reason codes, the risk constraints / required operator approvals / future simulation checks). It holds
**no destination, no signer, no key, no executable field**; `executable` is always false and every
required approval is unsatisfied. It builds, signs, simulates, and sends **nothing** and imports no chain
capability. Phase 6 and Phase 7 remain not started — this is data shapes for review, not a step toward
sending. Sprint 42 adds `paper:phase6:diff:intent --base <plan-a.json> --next <plan-b.json>` — a
deterministic diff between two INERT plans (`simulation.intent.plan.diff.v1`; `executable` stays false
on both sides, always).

Sprints 53–55 add the three machine-readable Phase-6 prerequisite SPEC artifacts (design documents —
they control nothing, store no secret, and create no wallet):
`paper:sniper:kill-switch:spec` (`sniper.kill_switch.spec.v1`; fixed modes with a permanently-disabled
live placeholder), `paper:sniper:secrets:policy` (`sniper.secrets.policy.v1`; six core rules as
constants, secret-shaped input refused and never echoed), and `paper:sniper:burner:isolation:spec`
(`sniper.burner.isolation.spec.v1`; burner-only principles as constants, loss bounds as LABELS only).
An ADOPTED spec is a Phase-6 prerequisite signal consumed by `paper:phase6:prereqs --schema-version v2`
— never authorization.

Sprints 61–66 begin the **authorized Phase 6 simulation slice** in a separate package,
`@soulmaker/simulation` — read-only, dry-run-only, structurally incapable of signing or sending
(import-allowlist + forbidden-token source scans enforce it). `paper:simulation:intent:plan` builds a
`simulation.intent.plan.v2`: a **fail-closed preview** over the strictly-validated v2 chain (decision
v2 + READY safety gates v2 + phase6 prereqs v2 + the three ADOPTED specs). Anything missing, invalid,
v1, not ready, or not adopted — or a declared stop-simulation kill switch — produces a **BLOCKED**
plan with stable reason codes and zero entries. Previews never invent a destination/amount/fee
(unsupplied values stay UNRESOLVED; amounts are paper-unit LABELS only).
`paper:simulation:result` builds a `simulation.result.v1` from a plan: unresolved entries are
SKIPPED, and the only dry-run adapter honestly reports **UNAVAILABLE** (a real dry-run needs
transaction material the boundary forbids building — nothing is faked). `paper:simulation:validate`
strictly validates both artifacts, including their literal safety locks (`neverSigns`, `neverSends`,
`dryRunOnly`, `neverAuthorizesLiveTrading`). Sprint 92 adds `paper:simulation:tx` — the REAL
`simulateTransaction` preview the dry-run boundary doc designed: a strictly-validated **UNSIGNED**
envelope (`txpreview.envelope.v1`; any embedded signature is refused) simulated with
`sigVerify:false` + `replaceRecentBlockhash:true` over a seam with **no send method** — a
`simulated-ok` is evidence for review, never live-trading readiness. Sprint 67 closes the v2 audit gap:
`paper:simulation:audit` builds a `phase6.audit.report.v1` over the **ten** chain artifacts
(Sprint 87 added the route-resolution artifact via `--route`) — each strictly validated in
place, structured cross-references checked (labels/counts/blocked states, never prose; a route
built from a different plan is a blocking mismatch), missing artifacts reported as warnings,
invalid/v1/mismatched artifacts failing the audit, and the chain's own blocking conditions
surfaced verbatim. Sprint 69 adds the
structural verdict: `paper:simulation:readiness` builds a `phase6.simulation.readiness.report.v1`
whose artifact checks are machine-verified and whose evidence references are recorded verbatim as
declarations — and whose `phase7LiveTradingReady` is a **literal false** the validator refuses to
see flipped. Sprint 73 adds the simulation diff chain: `paper:simulation:diff:plan`
(`simulation.intent.plan.diff.v2`) and `paper:simulation:diff:result` (`simulation.result.diff.v1`)
compare two strictly-validated artifacts from STRUCTURED FIELDS ONLY — blocked transitions, reason-code
movements, source-ref mismatches, and per-entry changes surfaced as stable `simulation-diff-*`
findings, with `--fail-on-diff` as the CI gate (an invalid or tampered side refuses outright).
Sprint 75 adds the simulation-aware session handoff: `paper:simulation:handoff` builds a
`phase6.simulation.handoff.pack.v1` over the twelve chain artifacts (Sprint 87 added the
route-resolution artifact via `--route`) — each strictly validated in place and summarized from
verbatim structured fields, missing artifacts CLASSIFIED (never invented), the chain's blocking
conditions and the readiness verdict carried verbatim, one deterministic next safe action, and a
literal-false `phase7LiveTradingReady`. Sprint 86 adds the
route-resolution provenance step: `paper:simulation:route` builds a
`simulation.route.resolution.v1` from a validated intent plan via the canonical builder — the
only one that exists, so every entry is honestly UNAVAILABLE under the fixed
`unavailable-no-route-resolver` id (route/destination/fee stay UNRESOLVED, never invented or
fetched), and the readiness evidence bar now REQUIRES `route-resolution-tests` as its eleventh
area (older ten-area readiness artifacts re-validate as INVALID, fail-closed). Sprint 87 makes
that artifact a first-class AUDITED and HANDED-OFF chain role — the route remains a
contract/capability boundary: no resolver exists, the real dry-run remains unauthorized and
unbuilt. Sprint 88 adds the OPERATOR layer: `paper:simulation:bundle` builds a
`phase6.operator.bundle.v1` over THIRTEEN roles (the twelve handoff roles plus the handoff pack
itself, via `--handoff`) with per-file truncated `sha256-128` integrity digests, a blocking trail
RECOMPUTED from the bundled artifacts and cross-checked against the handoff pack's verbatim trail
(a stale/tampered pack blocks the bundle), and a closed-set operator verdict whose best value is
`reviewable-paper-only`; and `paper:sniper:dry-run` is the one-command PAPER orchestrator — an
operator candidate file in, the complete validated artifact directory out (nineteen artifacts plus
`RUN_SUMMARY.md`), with route resolution honestly all-UNAVAILABLE and a blocked chain written as
the honest record (`--fail-on-blocked` gates). A simulation result
is never an execution and never live readiness — Phase 7 remains not started and unauthorized.

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
                #            skip/watch/paper-enter/paper-reject/unknown from preflight + rules;
                #            Sprint 28 adds the operator workflow helper (sniper.workflow.plan.v1):
                #            describes the intake->preflight->decide sequence, executes nothing;
                #            Sprint 30 adds the run report (sniper.run.report.v1): joins candidate
                #            list + preflight + decision + workflow into one navigable per-candidate
                #            view; Sprint 31 adds the run report diff (sniper.run.report.diff.v1):
                #            compares two run reports (added/removed/transitions/recovery);
                #            Sprint 32 adds the policy config (sniper.policy.config.v1): explicit,
                #            conservative, tighten-only operator/risk policy for paper:sniper:decide;
                #            Sprint 33 adds the audit log (sniper.audit.log.v1): deterministic
                #            per-step provenance over a run report, no wall-clock time;
                #            Sprint 34 adds the session pack (sniper.session.pack.v1): bundles all
                #            sniper artifacts, classifies each, surfaces unsupported schemas honestly;
                #            Sprint 39 adds the safety gates (sniper.safety.gates.report.v1): fail-closed
                #            pre-simulation readiness check (local/paper only, NOT Phase 6 authorization);
                #            Sprint 40 adds the Phase 6 prereq tracker (phase6.prerequisite.report.v1):
                #            machine-readable boundary-spec checklist, NEVER authorizes Phase 6;
                #            Sprint 41 adds the INERT simulation intent plan (simulation.intent.plan.v1):
                #            type-contract DATA only, executable always false, builds/signs/sends NOTHING;
                #            Sprint 42 adds the inert intent plan diff (simulation.intent.plan.diff.v1):
                #            compares two inert plans (still not executable)
                #            (paper-only) — NO chain capability, NO wallet, NO network
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
pnpm soulmaker token:inspect <mint> --json --out c1.inspect.json   # existing read-only command (operator-run; --out writes UTF-8 — prefer it over `>` on Windows)
pnpm soulmaker token:risk <mint> --json --out c1.risk.json         # existing advisory risk command
pnpm soulmaker paper:sniper:preflight --candidates <candidates.json> --inspection c1=c1.inspect.json --risk c1=c1.risk.json
pnpm soulmaker paper:sniper:preflight --candidates <candidates.json> --risk c1=c1.risk.json --fail-on-fail

# Sprint 47 — PREFLIGHT INPUT VALIDATION: bundle the LOCAL inspection/risk inputs into ONE validated
# artifact (sniper.preflight.input.v1) and check it BEFORE the preflight — unsupported shapes, missing
# sections, and mint mismatches surface here (local-only; verifies NO on-chain fact; writes nothing):
pnpm soulmaker paper:sniper:preflight:input:validate --input pf-input.json --candidates <candidates.json> --json
pnpm soulmaker paper:sniper:preflight:input:validate --input pf-input.json --fail-on-missing-risk
pnpm soulmaker paper:sniper:preflight --candidates <candidates.json> --preflight-input pf-input.json

# Sprint 90 — REAL-INPUT BRIDGE: pair standalone token:inspect --json / token:risk --json output files
# to candidates BY MINT and write the canonical preflight input artifact paper:sniper:dry-run consumes
# via --preflight-input. Values carried VERBATIM; uncovered candidates stay honestly warned (never
# marked safe); malformed / cross-kind / unknown-mint / duplicate / secret-shaped files are REFUSED.
# LOCAL-ONLY: no RPC, no network, no wallet (walkthrough: examples/sniper/real-input-rehearsal/):
pnpm soulmaker paper:sniper:preflight:input:prepare --candidates <candidates.json> --inspect c1.inspect.json --risk c1.risk.json --out pf-input.artifact.json

# Sprint 91 — READ-ONLY ROUTE QUOTE BRIDGE: pair operator-supplied quote observation files
# (routequote.observation.input.v1) to candidates BY MINT and write the canonical
# routequote.prepared.v1 artifact that paper:sniper:dry-run consumes via --routequote and
# paper:simulation:route via --quotes. CLOSED outcome set (quote-observed | unavailable | blocked |
# error | unsupported — nothing can mean "executable"); every observed quote carries the mandatory
# caveats (read-only observation only; not a transaction; quote may expire; route not simulated).
# LOCAL-ONLY: an observation proves a quote was VISIBLE at some point, never that one is executable:
pnpm soulmaker paper:routequote:prepare --candidates <candidates.json> --quote c1.quote.json --out rq.artifact.json

# Sprint 92 — REAL READ-ONLY QUOTE FETCHER: fetch one live quote per candidate from a public quote
# API (free Jupiter lite tier by default) and write the SAME routequote.observation.input.v1 files an
# operator would author by hand, plus a routequote.fetch.report.v1 with honest freshness metadata
# (real fetch timestamp, provider id, HTTP status, context slot, price impact, truncated digest).
# Provider failures map onto the CLOSED status set (network down -> unavailable; 401/403/429 ->
# blocked; other non-2xx -> error; unparseable -> unsupported) — never upgraded, never faked.
# Network READ only: no wallet, no keys, no signing, no sending, no transaction construction; a
# fetched quote can never unblock a blocked chain. PAPER mode requires --allow-paper-read:
pnpm soulmaker paper:routequote:fetch --candidates <candidates.json> --amount-sol 0.01 --allow-paper-read --out-dir runs/quotes

# Sprint 92 — REAL-TIME CANDIDATE INGESTION: poll a public new-token feed (Jupiter recent-tokens,
# incl. pump.fun launches) or a local replay file, normalize observations into the EXISTING
# candidate-list contract, and write snapshot.json + candidates.json the PAPER pipeline consumes.
# Watching is READ-ONLY observation — no wallet, no keys, no order; market figures are
# provider-reported HINTS; replay data is always labeled replay; the watch is always BOUNDED
# (--polls max 120) with an interrupt-safe append-only JSONL journal:
pnpm soulmaker paper:realtime:snapshot --allow-paper-read --min-liquidity-usd 1000 --out-dir runs/feed
pnpm soulmaker paper:realtime:watch --polls 10 --interval-ms 5000 --journal runs/watch.jsonl --allow-paper-read

# Sprint 92 — GATED EXECUTION (architecture real, live DISABLED by default, mainnet sending has NO
# CLI surface). execution:status shows the resolved mode + the FOURTEEN-condition mainnet live gate
# (default BLOCKED) + the core gate; execution:build is the refusal-first UNSIGNED swap builder
# (only output is a txpreview envelope for paper:simulation:tx); execution:devnet:send is the ONLY
# send surface and is DEVNET-ONLY behind a double opt-in (env flag + CLI flag), journaled, signer
# path from an env var NAME (never the key). See docs/PHASE7_LIVE_EXECUTION_GATE.md:
pnpm soulmaker execution:status --request mainnet-live --i-understand-this-can-lose-real-money
pnpm soulmaker execution:build --candidate-mint <mint> --wallet <pubkey> --risk risk.json --amount-sol 0.01 --slippage-bps 50 --max-spend-sol 0.02 --slippage-cap-bps 100 --risk-score-cap 30 --request mainnet-dry-run --allow-paper-read --out envelope.json
pnpm soulmaker paper:simulation:tx --envelope envelope.json --rpc-url <mainnet rpc> --allow-paper-read

# Sprint 93 — QUOTE FRESHNESS end-to-end (envelopes carry quotedAt; explicit caps everywhere; no
# default cap by design), the DEVNET END-TO-END BROADCAST REHEARSAL (throwaway gitignored keypair,
# airdrop, probe, simulate, send, confirm — an airdrop rate limit becomes an honest
# devnet-funding-blocked artifact), the HONEST mainnet readiness checklist (structurally incapable
# of reporting armed), and the UNIFIED rehearsal workflow paper:sniper:rehearse (closed mode set:
# paper default / devnet behind --devnet-send + double opt-in / mainnet-dry-run which can never
# send; every skipped stage names its exact next command). See docs/EXECUTION_SAFETY.md:
pnpm soulmaker execution:readiness --quote-report runs/quotes/fetch-report.json --max-quote-age-ms 30000 --risk risk.json --risk-score-cap 30
SOLMAKER_ENABLE_DEVNET_EXECUTION=devnet-only pnpm soulmaker execution:devnet:rehearse --out runs/devnet-rehearsal/today --acknowledge-devnet-execution
pnpm soulmaker paper:sniper:rehearse --candidates candidates.json --out runs/rehearsal-today
pnpm soulmaker paper:sniper:rehearse --mode mainnet-dry-run --candidates candidates.json --build-wallet <pubkey> --risk risk.json --amount-sol 0.01 --slippage-bps 50 --max-spend-sol 0.02 --slippage-cap-bps 100 --risk-score-cap 30 --allow-paper-read --out runs/rehearsal-dry-run

# Sprint 103-B — DEVNET PROOF UNBLOCKER + PHASE 7 SIGN-OFF + OPERATOR DEMO (live trading stays DISABLED).
# execution:devnet:funding-status reads a throwaway devnet key's balance once and emits the honest
# execution.devnet.funding_status.v1 (funded re-derived from the observed lamports; mainnet refused; no
# secret serialized); --complete-if-funded chains the rehearsal --skip-airdrop. paper:phase7:signoff:template
# is the FUTURE-human-authorization mechanism (a blank template-only checklist; even a fully-signed record
# authorizes no live trade). paper:sniper:operator-demo assembles a SAFE, showable demo folder + manifest
# (every artifact labelled by provenance; live pinned disabled). The Phase 7 audit can consume a
# funding-status / reconciliation / sign-off record as evidence. None of these sends, signs, or trades:
pnpm soulmaker execution:devnet:funding-status --public-key <KEY> --out runs/funding
pnpm soulmaker paper:phase7:signoff:template --out runs/signoff.json
pnpm soulmaker paper:sniper:operator-demo --out runs/demo

# Sprint 104-C — OPERATOR WATCHLIST + DRY-RUN CAMPAIGNS (live trading stays DISABLED).
# paper:sniper:watchlist:prepare creates/normalizes a sniper.watchlist.v1 by merging an existing
# watchlist, a candidate list, and/or --add <mint[=label]> entries (deduped by mint; mints validated as
# public keys). A status (watch/review/blocked/archived) is bookkeeping ONLY — never a trade signal.
pnpm soulmaker paper:sniper:watchlist:prepare --candidates <candidates.json> --out runs/watchlist.json

# paper:sniper:campaign:run COMPARES candidates across the evidence you already gathered (--score,
# --preflight, --risk <mint=path>, --routequote, --release-candidate <mint=path>, joined BY MINT) into
# a no-send sniper.dryrun.campaign.v1 + RUN_SUMMARY.md. Each verdict (watch/review/blocked/
# insufficient-evidence) is RE-DERIVED; a high score can NEVER override a blocker. Live stays DISABLED.
pnpm soulmaker paper:sniper:campaign:run --watchlist runs/watchlist.json --preflight preflight.json --out runs/campaign

# Sprint 105-B — READ-ONLY PROVIDER READINESS: paper:sniper:provider:doctor resolves the read-only
# provider config (--rpc-url / --jupiter-url / env vars > safe public keyless defaults) and runs BOUNDED
# read-only probes (an RPC health call, a tiny WSOL->USDC Jupiter quote, a no-network Rust engine check)
# into a sniper.provider_health.report.v1. REACHABILITY only (available/unavailable/timeout/rate-limited/
# misconfigured/error/skipped) — a provider being down is honest evidence, never a candidate risk verdict.
# No raw endpoint is printed (every endpoint is reduced to its host); never sends, signs, loads a key, or
# builds/simulates. --fail-on-unavailable gates CI; live trading stays DISABLED.
pnpm soulmaker paper:sniper:provider:doctor --mode mainnet-dry-run --out runs/provider-health.json

# Sprint 105-A — LIVE-READ-ONLY AUTO CAMPAIGN: paper:sniper:campaign:auto-run GATHERS the safe read-only
# evidence ITSELF across candidates (Rust scoring, deep risk, route-quote fetch/score, unsigned build +
# simulation in mainnet-dry-run mode) and writes a no-send alpha folder — sniper.readonly_campaign.plan.v1
# + sniper.dryrun.campaign.v1 + sniper.alpha_run.report.v1 + per-candidate evidence + RUN_SUMMARY.md.
# Network reads happen ONLY with --mode mainnet-dry-run + the explicit --allow-readonly-network opt-in;
# a risk REJECT short-circuits the downstream stages; unavailable providers/Rust are recorded honestly.
# It NEVER sends, signs, or loads a key — live trading stays DISABLED. (S105-C) --rpc-url drives the
# provider probe, deep risk AND simulation at the SAME endpoint (flag > SOULMAKER_RPC_URL env > default);
# a key in the URL is never printed, and it has no effect in paper mode (the run warns you).
pnpm soulmaker paper:sniper:campaign:auto-run --watchlist runs/watchlist.json --risk <MINT>=risk.<MINT>.json --out runs/alpha
pnpm soulmaker paper:sniper:campaign:auto-run --candidates runs/candidates.json --mode mainnet-dry-run --allow-readonly-network --rpc-url <RPC_URL> --out runs/alpha

# paper:sniper:campaign:diff compares two campaigns (--before/--after) into sniper.dryrun.campaign.diff.v1
# (added/removed/unchanged/changed, score deltas, verdict transitions, improved/worsened/newly-blocked/
# newly-watch). It authorizes nothing and never overrides a verdict.
pnpm soulmaker paper:sniper:campaign:diff --before runs/prev/campaign.json --after runs/alpha/campaign.json --out runs/alpha/campaign-diff.json

# paper:sniper:alpha:report assembles a showable sniper.alpha_run.report.v1 from a campaign (+ optional
# plan/diff/watchlist refs). It can never claim live readiness or profitability; live trading stays DISABLED.
pnpm soulmaker paper:sniper:alpha:report --campaign runs/alpha/campaign.json --plan runs/alpha/readonly-campaign-plan.json --out runs/alpha/alpha-report.json

# Sprint 106 — ALPHA HISTORY: paper:sniper:alpha:history folds MANY no-send alpha run folders into ONE
# deterministic sniper.alpha_history.v1 rollup (per-run mode/network/provenance, the watch/review/blocked/
# insufficient-evidence tally, provider-health + evidence-provenance rollups, the most common blocker
# reasons, and the Phase 7 postures across runs). Each run's spine is its validated campaign.json; a
# missing / malformed / unrecognized artifact is listed honestly and NEVER counted as a run; a run
# claiming live authorization is refused. LOCAL-ONLY — live trading stays DISABLED, authorizes nothing.
# --fail-on-invalid / --fail-on-blocked gate CI.
pnpm soulmaker paper:sniper:alpha:history --runs-dir runs --out runs/alpha-history.json
pnpm soulmaker paper:sniper:alpha:history --run before=runs/alpha-before --run after=runs/alpha-after --out runs/alpha-history.json

# Sprint 107 — ALPHA HISTORY DIFF: paper:sniper:alpha:history:diff compares two no-send sniper.alpha_history.v1
# rollups (--base / --next; a path may be a folder holding alpha-history.json) into sniper.alpha_history.diff.v1.
# It reports MOVEMENT only — runs added/removed/changed (keyed by runRef), per-run candidate-count + verdict-count
# + provider + provenance deltas, the aggregate verdict / provider-health / evidence-provenance rollup movement,
# the blocker-reason frequency movement, the Phase 7 posture movement, plus a one-line operator summary. It NEVER
# re-derives a verdict; both inputs are re-validated + deep-scanned and a malformed / live-authorizing rollup is
# refused. "Movement is not momentum" — never a buy signal, never a profitability claim. LOCAL-ONLY — live trading
# stays DISABLED, authorizes nothing. --fail-on-worsened gates CI when the aggregate blocked count rose.
pnpm soulmaker paper:sniper:alpha:history:diff --base runs/alpha-history-mon.json --next runs/alpha-history-tue.json --out runs/alpha-history-diff.json

# Sprint 107 — ALPHA HISTORY TREND: paper:sniper:alpha:history:trend folds an ORDERED list of
# sniper.alpha_history.v1 rollups (--history <label=path>, repeatable, kept in supplied order; and/or
# --histories-dir <parent>; a path may be a folder holding alpha-history.json) into
# sniper.alpha_history.trend.v1. The order is the SUPPLIED order — NO wall-clock, no fake time series. It
# reports the watch/review/blocked/insufficient-evidence series + candidate series across snapshots,
# step-to-step deltas, blocker-reason totals, evidence-provenance totals, and per-provider ok-run
# consistency, plus a one-line summary. Each snapshot is re-validated + deep-scanned; a malformed /
# live-authorizing rollup is refused. LOCAL-ONLY — live trading stays DISABLED, authorizes nothing.
pnpm soulmaker paper:sniper:alpha:history:trend --history mon=runs/alpha-history-mon.json --history tue=runs/alpha-history-tue.json --out runs/alpha-history-trend.json

# Sprint 106 — STRATEGY INTELLIGENCE: paper:sniper:strategy:intel projects a campaign (--campaign) +
# per-mint token:risk reports (--risk <mint=path>) into read-only per-candidate intelligence cards — the
# notable risk flags by NAME (freeze/mint authority, Token-2022 risks, holder concentration, mutable
# metadata, thin liquidity), a mint class (wrapped-SOL/stablecoin/other), a confidence label (evidence
# completeness, never price direction), closed reason codes, and plain-English why-this-matters /
# what-to-study-next. Verdicts come from the campaign (a score can NEVER override a blocker). It is
# sniper.strategy_intelligence.v1 — never a buy signal, never a profitability claim; LOCAL-ONLY.
pnpm soulmaker paper:sniper:strategy:intel --campaign runs/alpha/campaign.json --risk <MINT>=risk.<MINT>.json --out runs/alpha/strategy-intel.json

# Sprint 27 — PAPER SNIPER DECISIONS: fold the candidate list + preflight + optional operator rules
# into a per-candidate SIMULATED decision — skip / watch / paper-enter / paper-reject / unknown — with
# reasons. A paper-enter is a PAPER-ONLY decision, NOT a buy/sell order, NOT a transaction, NOT live
# readiness. Reads the named files only, writes nothing unless --out. No network, no wallet:
pnpm soulmaker paper:sniper:decide --candidates <candidates.json> --preflight preflight.json
pnpm soulmaker paper:sniper:decide --candidates <candidates.json> --preflight preflight.json --rules rules.json --json
pnpm soulmaker paper:sniper:decide --candidates <candidates.json> --preflight preflight.json --fail-on-paper-enter
# Sprint 46 — --schema-version v2 emits sniper.paper.decision.report.v2: the SAME simulated decisions
# plus stable machine-readable reason codes (per-candidate trails, blocking/warning/policy/risk
# subsets, sorted summary counts). v1 stays the default; codes are integrity/risk explanations,
# never trading advice:
pnpm soulmaker paper:sniper:decide --candidates <candidates.json> --preflight preflight.json --schema-version v2 --json

# Sprint 48 — POLICY CONFIG V2 (sniper.policy.config.v2): explicit policyMode (conservative /
# balanced-paper / research-only; contradictions REFUSED) + reason-code-aware riskLimits
# (disallowedReasonCodes / disallowedPreflightStatuses / maxWarningsPerCandidate / require*).
# Tighten-only; a v2 policy requires the v2 decision path (the v1 path refuses it, fail-closed):
pnpm soulmaker paper:sniper:policy:validate --input policy-v2.json --schema-version v2 --json
pnpm soulmaker paper:sniper:decide --candidates <candidates.json> --preflight preflight.json --policy policy-v2.json --schema-version v2

# Sprint 28 — SNIPER OPERATOR WORKFLOW: a read-only helper that checks which local artifacts exist +
# validate and prints the recommended NEXT command in the intake -> preflight -> decide sequence. It
# DESCRIBES the sequence only — it executes no stage, runs no live action, and writes nothing:
pnpm soulmaker paper:sniper:workflow
pnpm soulmaker paper:sniper:workflow --candidates candidates.json --preflight preflight.json --decision decision.json --json
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
- [`docs/EXECUTION_SAFETY.md`](docs/EXECUTION_SAFETY.md) — the gated execution lane: modes, the fourteen-condition live gate, quote freshness, the signer boundary, the devnet rehearsal (S92–S93)
- [`docs/PAPER_TRADING_MODEL.md`](docs/PAPER_TRADING_MODEL.md) — simulated paper engine (Phase 4) + backtest
- [`docs/STRATEGY_MODEL.md`](docs/STRATEGY_MODEL.md) — paper-only strategy rules engine (Phase 5)
- [`examples/backtest/README.md`](examples/backtest/README.md) — injected example scenarios (fixtures, not market truth)
- [`docs/REFERENCE_REPO_AUDIT.md`](docs/REFERENCE_REPO_AUDIT.md) — audit of reference repos
- [`SECURITY.md`](SECURITY.md) — the authoritative security rules

## License

License decision is intentionally **pending** (see `SECURITY.md` →
"License & dependencies"). Until decided, Soulmaker stays original and does
**not** vendor third-party (esp. GPL) code. It is private and unpublished.
