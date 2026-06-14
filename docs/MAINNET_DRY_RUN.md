# Mainnet Dry-Run Workflow (Sprint 95)

The mainnet dry-run is the deepest rehearsal Sol Maker can perform against **real mainnet
state without any possibility of sending**: real risk evidence, a real Jupiter quote, a real
provider-built swap transaction (strictly UNSIGNED), and a real `simulateTransaction` — chained
by one command into one auditable artifact folder.

Nothing in this document is a profitability claim or an authorization. The dry-run's terminal
verdict is always **blocked / live-not-authorized** by design; live trading requires the
separately authorized Phase 7 path (see
[`PHASE7_LIVE_SEND_DESIGN_REVIEW.md`](PHASE7_LIVE_SEND_DESIGN_REVIEW.md)).

## How to run it

```powershell
$env:SOULMAKER_RPC_URL = 'https://api.mainnet-beta.solana.com'
pnpm soulmaker paper:sniper:rehearse `
  --mode mainnet-dry-run `
  --candidates runs/candidates.json `
  --out runs/dry-run-proof `
  --build-wallet <PUBLIC key — never a secret> `
  --amount-sol 0.005 --slippage-bps 50 `
  --max-spend-sol 0.01 --slippage-cap-bps 100 --risk-score-cap 30 `
  --max-quote-age-ms 30000 `
  --rpc-url https://api.mainnet-beta.solana.com `
  --allow-paper-read
```

Every cap is explicit; nothing is defaulted. Omitting the build flags skips the build/simulate
stages honestly (each skip names the exact standalone command).

## The stage chain

| # | Stage | What actually happens | Artifact |
|---|---|---|---|
| 1 | `candidates` | operator file or realtime replay snapshot | `candidates.json` |
| 2 | `risk` | AUTO deep `token:risk` per candidate (Token-2022 extensions included), bridged through the canonical preflight-input prepare | `risk/risk.<mint>.json`, `preflight-input.json` |
| 3 | `quote-fetch` | LIVE Jupiter quote per candidate with real `fetchedAt` provenance | `quotes/…` |
| 4 | `quote-prepare` | observations → `routequote.prepared.v1` | `routequote-prepared.json` |
| 5 | `dry-run` | the full paper chain (19+ artifacts); best verdict is `reviewable-paper-only` | `dry-run/…` |
| 6 | `tx-build` | the REAL Jupiter swap build (fresh quote → `POST /swap`) gated by every refusal check; output is a strictly UNSIGNED envelope | `envelope.json`, **`txbuild-report.json`** (S95 — written on BOTH outcomes) |
| 7 | `tx-simulate` | the REAL `simulateTransaction` (sigVerify:false) over the exact envelope; every failure deterministically classified | `tx-simulation.json` |
| 8 | `devnet-rehearse` | always SKIPPED in this mode — the only send-capable stage is structurally limited to devnet mode | — |
| 8b | `reconciliation` (S96) | always SKIPPED in this mode — see below | — |
| 9 | `readiness` | the fourteen-condition checklist against the evidence above; verdict literally always `blocked` | `readiness.json` |

Plus the stage record itself: `rehearsal-report.json` (`sniper.rehearsal.report.v1`).

## Why it cannot send

- `mainnet-dry-run` mode has **no sign and no send capability** — `attemptExecution` accepts
  only `devnet-execution` and `mainnet-live-armed`, and no shipped CLI command can reach a
  mainnet send even when armed (tests pin this).
- The build's only output validates as a strictly UNSIGNED `txpreview.envelope.v1` (every
  signature slot zero; a signed transaction from the provider is **refused**).
- The simulator runs with `sigVerify:false` — no signer, key, or seed phrase exists anywhere
  on this path, and its RPC seam exposes exactly one method (`simulateTransaction`).
- There is no `mainnet-live` rehearsal mode and no flag combination that creates one.

## How the gates connect

Risk → build: a REJECT decision, an over-cap score, or a Token-2022 BLOCKER extension flag
(transfer hook, permanent delegate, non-transferable, frozen-by-default, pausable, extreme
transfer fee) refuses the build **before any network call** — the provider is never contacted
for a candidate the risk engine rejected.

Quote → build: the builder fetches its quote fresh in-process; with `--max-quote-age-ms`, a
slow provider round-trip that ages the quote past the cap refuses (`build-refused-quote-stale`),
and an impossible future timestamp refuses with its own code (`build-refused-quote-future`).

Build → simulate: only a validated unsigned envelope reaches simulation; the S95 shape gate
also checks the transaction version, the recent blockhash, and (optionally) an operator program
allowlist before anything is simulated.

Simulate → readiness: condition 10 (`simulation-ok`) is satisfied only by a `simulated-ok`
report over the EXACT envelope; a failed or unavailable simulation keeps readiness blocked, and
the failure's classification names the exact next safe action.

## Reading the artifacts

- **`txbuild-report.json`** (`txbuild.report.v1`, S95): one auditable record per build attempt.
  `outcome: refused` is a first-class result — every refusal carries its closed-set code, an
  operator message, and the exact next safe action. `outcome: built` carries the fresh-quote
  facts and the decoded transaction SHAPE facts (version, blockhash presence, instruction
  count, static program ids, address-table lookups). The transaction body itself is never
  embedded.
- **`tx-simulation.json`**: closed outcomes (`simulated-ok | simulated-failed | unavailable |
  refused`) plus the S95 deterministic classification
  (`slippage-or-route-error | compute-exceeded | blockhash-error | account-error |
  program-error | unclassified-error | rpc-unavailable | envelope-refused`) with guidance.
  `simulated-ok` is evidence for review — never readiness.
- **`readiness.json`**: every unsatisfied condition names its next safe action; at least three
  conditions can only finalize at execution time, so the verdict is always `blocked` here.

Render everything locally: `pnpm web:inspect --dir runs/dry-run-proof --out runs/inspect.html`.

## Real evidence (2026-06-12)

Run against live mainnet with a throwaway PUBLIC key as the build wallet:

- BONK (deep risk PASS, score 20): live quote (slot 426052463), **real Jupiter swap build
  succeeded** — v0 transaction, 7 instructions, blockhash present, 5 static programs, 1
  address-table lookup; real mainnet simulation returned `AccountNotFound`, classified
  `account-error` — exactly correct for an unfunded fee payer, and proof the classifier works
  on real chain data.
- USDC (real freeze authority → deep risk REJECT): the build refused pre-network with
  `build-refused-risk-rejected` + `build-refused-risk-over-threshold`; the provider was never
  called; the refusal artifact carries both codes with next safe actions.

A `simulated-ok` on this path requires a funded fee-payer public key; that evidence belongs to
the devnet/post-trade lane (S96), never to an unfunded throwaway.

## Why there is no reconciliation send result in a dry-run (S96)

The S96 reconciliation layer accounts for **what a send actually did**: signature confirmation,
pre/post balance deltas, the real fee. A mainnet dry-run never sends, so there is no send result
to reconcile — and faking one would be exactly the kind of false evidence this repository
refuses to produce. The `reconciliation` stage therefore reports `skipped` with the honest
detail ("mainnet-dry-run NEVER sends, so no send result exists to reconcile"), and a
reconciliation report built in this mode records the verdict `not-sent` with the same caveat.
**That absence is the record, not a gap.**

What still matters as dry-run evidence:

- the build/refusal record (`txbuild.report.v1`) and the simulation classification — they prove
  the decision chain against real mainnet state;
- read-only balance evidence is allowed (the reconciliation RPC seam can read mainnet balances)
  — reads prove observability, never execution;
- the accounting discipline itself is proven on the devnet lane, where every attempt leaves an
  `execution.reconciliation.report.v1` and an unaccounted session refuses the next attempt
  (see [`EXECUTION_SAFETY.md`](EXECUTION_SAFETY.md), "Post-trade reconciliation and the session
  wall").

## Optional quote-quality intelligence (S99)

The quote artifacts a dry-run consumes can additionally be SCORED through the Rust sidecar:
`pnpm soulmaker engine:quote:score --report <routequote.fetch.report.v1> --max-quote-age-ms <ms>`
produces `engine.routequote.score.report.v1` - per-quote quality scores (impact, hops, age), a
deterministic ranking, and closed reason codes. This is read-only ANALYSIS of an existing fetch
report: it feeds nothing downstream, gates nothing, and changes nothing in the dry-run evidence
chain (a deliberate low-risk decision). TypeScript recomputes every score and re-evaluates every
freshness verdict with the real `evaluateQuoteFreshness` before accepting the artifact. A route
score is never a profitability claim and never readiness. See [`RUST_ENGINE.md`](RUST_ENGINE.md).

## Optional candidate scoring + ranking (S101)

The facts a dry-run already collects (advisory risk, token mechanics, quote quality, simulation
evidence) can be folded into ONE `sniper.score.input.v1` bundle and ranked through the Rust sidecar:
`pnpm soulmaker engine:sniper:score --input <sniper.score.input.v1>` produces
`engine.sniper.score.report.v1` - a per-candidate score (0-100), a closed verdict
(watch/caution/reject/insufficient-evidence), and a deterministic ranking. Like the S99 quote score,
this is read-only operator INTELLIGENCE that **feeds nothing downstream, gates nothing, and changes
nothing in the dry-run evidence chain**. It does not send, does not sign, and cannot fund a build:
TypeScript re-derives every component/score/verdict/ranking and cross-checks the echoed facts against
the bundle before accepting the artifact. A high score is NOT "safe to trade", a rejected risk stays
`reject` no matter the score, and the score satisfies none of the fourteen mainnet live-gate
conditions - the dry-run's terminal verdict remains `blocked / live-not-authorized`. See
[`SNIPER_SCORING.md`](SNIPER_SCORING.md) and [`RUST_ENGINE.md`](RUST_ENGINE.md).

## The release candidate (S102)

As of Sprint 102, `paper:sniper:rehearse --mode mainnet-dry-run` no longer leaves the scoring,
quote-score, and tx-inspection layers as separate optional commands — it **chains them into the run**
and folds every stage into ONE auditable, no-send summary: `release-candidate.json`
(`sniper.mainnet_dryrun.release_candidate.v1`). The full chain is now:

candidate discovery/replay → deep risk → quote fetch → quote prepare → **Rust quote score** → paper
dry-run → unsigned tx build → **Rust tx inspection** → real simulation → **Rust candidate scoring +
ranking** → readiness → **release candidate**.

The release candidate carries: the candidate source; the candidate-scoring summary + ranked candidate
facts; the deep-risk summary (worst decision, rejected, critical/high flag counts, Token-2022
blockers); the quote summary (attempted/observed, freshness, Rust quote score); the unsigned tx-build
summary (refused? refusal codes); the Rust tx-inspection summary (version supported, blockhash,
instruction count, unresolvable program ids); the simulation outcome + classification; the readiness
checklist counts; the closed verdict; `liveSendStatus` (always `disabled`); why live is blocked; the
next safe actions; caveats; and the references to every per-stage artifact.

### Reading the RC verdict

The verdict is RE-DERIVED from the structured stage evidence — **never from a candidate score** — in
this precedence (and the validator recomputes it independently, so a high score can never move a
blocked verdict):

| Verdict | Meaning |
|---|---|
| `dryrun-error` | a pipeline stage hard-errored; the run could not complete |
| `dryrun-blocked-risk` | risk REJECT / critical flag / Token-2022 blocker (supreme gate) |
| `dryrun-blocked-quote` | a quote was attempted but is not fresh-and-observed |
| `dryrun-blocked-build` | the unsigned build was refused |
| `dryrun-blocked-simulation` | the real `simulateTransaction` failed |
| `dryrun-insufficient-evidence` | nothing blocking, but required evidence is missing (e.g. Rust scoring unavailable) |
| `dryrun-complete-blocked-live` | dry-run evidence complete; **live still disabled** — the BEST case, never readiness |

Every engine stage (scoring, quote-score, tx-inspect) falls back honestly when Rust is unavailable —
the paper evidence chain never depends on Rust, and a missing scoring layer simply yields
`dryrun-insufficient-evidence` rather than a false complete. Quote freshness is sourced from the
TypeScript readiness evidence, so it never depends on the Rust quote scorer either.

Inspect the whole run folder with the operator command-center view:

```
pnpm web:inspect --dir runs/dry-run-proof
```

The `sniper.mainnet_dryrun.release_candidate.v1` artifact has a dedicated typed view (verdict +
**LIVE SENDING DISABLED** banner, ranked candidates, risk, quote, build/inspection/simulation,
readiness, why-live-blocked, next safe actions, artifact references). Redacted FICTIONAL examples
live in [`examples/sniper/mainnet-dryrun-release-candidate/`](../examples/sniper/mainnet-dryrun-release-candidate/)
(regenerate with `pnpm tsx scripts/gen-mainnet-dryrun-rc-example.ts`).

### Real evidence (2026-06-13)

A real mainnet read-only run (candidate BONK, an unfunded throwaway fee-payer public key) produced a
`dryrun-blocked-simulation` release candidate: deep risk PASS, a live Jupiter quote (Rust quote score
90), a REAL unsigned Jupiter swap envelope (8 instructions), a REAL `simulateTransaction` that
returned `account-error` (the unfunded fee payer — exactly the honest signal), a Rust tx inspection
(version supported), a Rust candidate score (BONK 86/caution), readiness 8/14, and
`liveSendStatus: disabled`. Nothing was signed or sent; the chain produced a complete operator view
and correctly refused to proceed.

## Sprint 103 — Phase 7 authorization audit

The mainnet dry-run release candidate is one input to the Sprint 103 Phase 7 authorization audit
(`phase7.authorization.audit.v1`, `pnpm soulmaker paper:phase7:authorization:audit`). A complete
`dryrun-complete-blocked-live` release candidate proves the dry-run evidence chain is whole — it does
**not** authorize live trading, and the audit treats it as exactly that: one verified invariant among
many, never a path to a send. The audit's best verdict,
`ready-for-separate-microtrade-authorization`, still authorizes nothing. See
[`PHASE7_AUTHORIZATION_DOSSIER.md`](PHASE7_AUTHORIZATION_DOSSIER.md).

## Sprint 103-B — the operator demo workbench

`paper:sniper:operator-demo --out <dir>` assembles a SAFE, showable folder of the whole paper /
dry-run pipeline in one command, with a `sniper.operator_demo.manifest.v1` that labels every artifact
by provenance:

- **real-readonly** — the real Phase 7 authorization audit (over this repo) and a blank Phase 7
  sign-off template;
- **fixture** — an honest devnet funding-status snapshot (the known funding-blocked state; not a live
  read);
- **fictional-example** — the byte-pinned candidate list and the mainnet dry-run release candidate
  (invented mints), which fold in candidate ranking, risk, quote score, tx build, tx inspection,
  simulation, and readiness.

The manifest re-derives its provenance counts, cross-checks every showcased stage against a present
artifact, and pins `liveExecutionDisabled: true` / `neverSends: true`. The folder renders cleanly in
the inspector (`pnpm web:inspect --dir <dir>`) and the `/sniper` command center carries a calm Phase 7
posture section. Nothing in the demo sends, signs, or trades — it is a "look what Sol Maker can do"
exhibit, not a live bot. As of S104-C the demo also ships a fictional `watchlist.json` and
`campaign.json`, so the operator watchlist → campaign workflow below is visible in the demo too. As of
S105-A it additionally ships `readonly-campaign-plan.json`, `campaign-diff.json`, and
`alpha-report.json` — the full alpha workflow, all labelled `fictional-example`.

## Sprint 105-A — live-read-only auto campaign + diff + alpha report

`paper:sniper:campaign:run` (above) aggregates evidence the operator already produced. **S105-A adds
`paper:sniper:campaign:auto-run`, which GATHERS the safe read-only evidence ITSELF** across many
candidates and assembles a no-send alpha folder. It is the alpha operator workflow — and it still never
sends, signs, or loads a key.

Per candidate it runs (each stage isolated; a failure is recorded honestly and the run continues):

1. **candidate scoring** — a `sniper.score.input.v1` bundle scored by the Rust engine (offline,
   intelligence only; a score never moves a verdict). Honest `unavailable` when the engine is absent.
2. **deep risk** — `token:risk --deep` per candidate, **only with `--mode mainnet-dry-run
   --allow-readonly-network`**; otherwise `--risk <mint=path>` is ingested or risk stays unknown.
3. **short-circuit** — a risk **REJECT** / critical flag / Token-2022 blocker marks the candidate's
   quote / build / simulation stages `not-attempted` and skips them.
4. **route quote** — a live fetch + prepare + Rust quote score over the non-rejected candidates
   (network only).
5. **unsigned build + tx-inspect + simulation** — only when the build is fully configured (`--wallet`
   + the explicit caps) and network is on; the build is refusal-first and **never signs or sends**.

It writes `readonly-campaign-plan.json` (`sniper.readonly_campaign.plan.v1` — the constitution it bound
itself to: allowed read-only stages only, no send / sign / arm stage, `noSend`/`noSigner`/
`noLiveTrading` pinned), `campaign.json` (`sniper.dryrun.campaign.v1`), `alpha-report.json`
(`sniper.alpha_run.report.v1`), `evidence-index.json`, per-candidate evidence, and `RUN_SUMMARY.md`.

```
# Offline (no network): ingest risk files; Rust scoring runs offline; network stages not-attempted.
pnpm soulmaker paper:sniper:campaign:auto-run --watchlist runs/watchlist.json \
  --risk <MINT>=risk.<MINT>.json --out runs/alpha

# Live read-only (mainnet-dry-run): gather deep risk + quotes itself. No send, no signer.
pnpm soulmaker paper:sniper:campaign:auto-run --candidates runs/candidates.json \
  --mode mainnet-dry-run --allow-readonly-network --out runs/alpha
```

`paper:sniper:campaign:diff --before <a>/campaign.json --after <b>/campaign.json --out diff.json`
(`sniper.dryrun.campaign.diff.v1`) compares two campaigns by mint — added / removed / unchanged /
changed, score deltas, verdict transitions, and improved / worsened / newly-blocked / newly-watch — and
**reports movement only; it never overrides a verdict and authorizes nothing**.

`paper:sniper:alpha:report --campaign <c>/campaign.json` (`sniper.alpha_run.report.v1`) assembles the
showable summary: top / blocked / insufficient-evidence candidates, stage coverage, provider + Rust
engine health, the Phase 7 posture, and **evidence provenance** (real read-only vs fixture /
fictional-example — never faked). It can never claim profitability or live readiness;
`liveTradingStatus` is pinned `"disabled"`. Inspect the whole folder with
`pnpm web:inspect --dir runs/alpha` — the command center renders the plan, the ranked campaign, the
diff, and the alpha report under a **LIVE TRADING DISABLED** banner.

**Real read-only evidence (2026-06-13):** a live `--mode mainnet-dry-run --allow-readonly-network` run
over WSOL + USDC produced valid artifacts with `provenance: real-readonly`; in the sandbox the public
RPC / quote providers were honestly recorded `unavailable` and both candidates fell to
`insufficient-evidence` — the pipeline faked nothing and sent nothing. Live trading stays disabled.

## Sprint 104-C — operator watchlists + dry-run campaigns

The S104-C operator layer turns the safe pipeline into a workbench for comparing many candidates,
**without crossing the live-money boundary**. Two new artifacts and two new commands:

### Watchlists (`sniper.watchlist.v1`)

`paper:sniper:watchlist:prepare` creates or normalizes a list of candidate mints to monitor:

```
# From a candidate list:
pnpm soulmaker paper:sniper:watchlist:prepare --candidates candidates.json --out runs/watchlist.json
# Add mints (with optional labels), merging + deduping by mint (first wins):
pnpm soulmaker paper:sniper:watchlist:prepare --watchlist runs/watchlist.json --add <MINT>=TICKER --status review --out runs/watchlist.json --force
```

Every mint is validated as a 32-byte public key (secret-length input is refused), and a status
(`watch` / `review` / `blocked` / `archived`) is **bookkeeping only** — `statusIsNotTradeReadiness`
is pinned true and the schema has no readiness/execution field. A watchlist never means a candidate
is ready or safe to trade.

### Dry-run campaigns (`sniper.dryrun.campaign.v1`)

`paper:sniper:campaign:run` compares candidates across the evidence you already gathered, joined **by
mint**, into a no-send campaign folder (`campaign.json` + `RUN_SUMMARY.md`):

```
pnpm soulmaker paper:sniper:campaign:run \
  --watchlist runs/watchlist.json \
  --score candidate-scores.json \                 # engine.sniper.score.report.v1 (engine:sniper:score)
  --preflight preflight.json \                     # sniper.token.preflight.report.v1 (paper:sniper:preflight)
  --risk <MINT>=risk.<MINT>.json \                 # token:risk --json output (repeatable)
  --routequote routequote-prepared.json \          # routequote.prepared.v1 (paper:routequote:prepare/fetch)
  --release-candidate <MINT>=release-candidate.json \  # sniper.mainnet_dryrun.release_candidate.v1 (repeatable)
  --out runs/campaign
```

Each candidate gets a `finalOperatorVerdict` that is **re-derived from the structured evidence**:

- **blocked** — a REJECT risk, a critical risk flag, a Token-2022 blocker, a `fail` preflight, a
  refused build, a failed simulation, a blocking release-candidate verdict, or a `blocked` watchlist
  status. **A candidate's score is never read by the derivation, so a high score can never override a
  blocker** (the validator independently re-derives the verdict and refuses a tampered one).
- **insufficient-evidence** — no core safety evidence (risk / preflight / release candidate) is
  present. Missing evidence is shown honestly, never hidden behind a clean-looking score.
- **review** — core evidence is present but there is a concern (CAUTION risk, `warn`/`unknown`
  preflight, a stale/unavailable quote, a `review` watchlist status, …).
- **watch** — core evidence present, a positive clean signal (risk PASS / preflight pass / RC
  complete), and no concern. **`watch` is the best a candidate reaches — it means keep monitoring,
  never "ready" or "safe to trade".**

The campaign is deterministic and LOCAL-ONLY: it reads the named files only — no RPC, no network, no
wallet, no signer, no send — and is byte-stable (no wall-clock). `liveSendStatus` is pinned
`"disabled"` and the closed schema refuses any `signature` / `txid` / `sendResult` field. Because it
aggregates evidence the operator already produced, it adds no new network surface; the live-read-only
auto-gather flow remains `paper:sniper:rehearse`. Inspect a campaign folder with
`pnpm web:inspect --dir runs/campaign` — the command center renders the ranked comparison, the
per-candidate blockers, and the stage-coverage matrix, with live trading disabled.
