# Sol Maker — Alpha Release Notes

A short, honest status of the no-send alpha. For the full checklist see
[ALPHA_RELEASE_CHECKLIST.md](ALPHA_RELEASE_CHECKLIST.md); for every command see
[SNIPER_RUNBOOK.md](SNIPER_RUNBOOK.md).

> **LIVE TRADING IS DISABLED — 0% by policy.** Nothing in the alpha signs, sends, loads a key, or
> authorizes a trade. The only broadcast surface anywhere is `execution:devnet:send` (devnet, double
> opt-in). There is no `mainnet:send` / `go-live` / `arm-live` / bypass command or flag.

## What works (no-send, read-only, tested)

- **Provider readiness** — `paper:sniper:provider:doctor` (`sniper.provider_health.report.v1`): bounded
  read-only probes (RPC, Jupiter quote, Rust engine); reachability only, every endpoint reduced to its
  host.
- **Watchlist** — `paper:sniper:watchlist:prepare` (`sniper.watchlist.v1`; a status is bookkeeping, never
  trade readiness).
- **Live-read-only auto-campaign** — `paper:sniper:campaign:auto-run` gathers deep risk + route quotes +
  unsigned-build + simulation itself across candidates and writes a no-send alpha folder
  (`readonly-campaign-plan.json` + `campaign.json` + `alpha-report.json` + per-candidate evidence +
  `RUN_SUMMARY.md`). Network reads need `--mode mainnet-dry-run --allow-readonly-network`.
- **Diff + report** — `paper:sniper:campaign:diff` (movement only, authorizes nothing) and
  `paper:sniper:alpha:report` (showable summary; never a profitability or live-readiness claim).
- **Command center** — `pnpm web:inspect --dir runs/alpha` renders every artifact under a **LIVE TRADING
  DISABLED** banner; `/sniper` carries the honest Phase 7 posture.

## New in Sprint 105-C

- **`--rpc-url` is now honored consistently** across `paper:sniper:campaign:auto-run`: the provider
  probe (`--check-providers`), the per-candidate deep-risk read, and the simulation all use the **same**
  read-only endpoint. Precedence: **`--rpc-url` flag > `SOULMAKER_RPC_URL` env > public keyless default**.
  A malformed override is refused without printing it; a secret-bearing one is reduced to its host in
  every report; the run warns when `--rpc-url` has no effect (paper mode).
- **End-to-end regression suite** locks the no-send checkpoint (live disabled + `authorizesLiveTrading`
  false in every artifact; no `signature`/`sendResult`/`txid` field; deterministic output; per-candidate
  failure isolation; provider-health reuse; candidate-limit enforcement).
- **Repeatable demo** — [examples/sniper/alpha-workflow/README.md](../examples/sniper/alpha-workflow/README.md)
  (offline-fixture + live-read-only, copy-pasteable, using committed example candidates).

## New in Sprint 106

- **Alpha history rollup** — `paper:sniper:alpha:history` (`sniper.alpha_history.v1`) folds MANY no-send
  alpha run folders into ONE deterministic rollup (`--run <label=path>` / `--runs-dir <parent>`): the
  candidate total, the watch / review / blocked / insufficient-evidence tally, the provider-health +
  evidence-provenance rollups, the most common blocker reasons, and the Phase 7 postures across runs. A
  missing / malformed / unrecognized artifact is listed honestly and never counted as a run; a run that
  claims live authorization is refused. `liveTradingStatus` pinned `"disabled"`; authorizes nothing.
- **Strategy intelligence** — `paper:sniper:strategy:intel` (`sniper.strategy_intelligence.v1`) projects a
  campaign + per-mint `token:risk` reports into read-only per-candidate intelligence cards: the notable
  risk flags BY NAME, a mint class (wrapped-SOL / stablecoin / other), a confidence label (evidence
  completeness — never price direction), closed reason codes, and plain-English why-this-matters /
  what-to-study-next. Verdicts come from the campaign (a score never overrides a blocker). Never a buy
  signal, never a profitability claim.
- **Typed web views** for both new schemas on `/sniper`, under the LIVE TRADING DISABLED banner, with a
  do-NOT-trust caution when the safety literals are missing; hostile content escaped.
- **Demo + regression** — the operator walkthrough covers both commands, and the end-to-end regression
  suite now drives `alpha:history` and `strategy:intel` (artifacts validate, stay live-disabled, smuggle
  no send/signature field, surface the freeze-authority flag).

## New in Sprint 107

- **Alpha history diff** — `paper:sniper:alpha:history:diff` (`sniper.alpha_history.diff.v1`) compares two
  `sniper.alpha_history.v1` rollups (`--base` / `--next`; a path may be a folder holding
  `alpha-history.json`). Runs are paired by `runRef` (an alpha history carries run-level counts, not
  per-candidate identity); it reports MOVEMENT only — runs added / removed / changed, per-run candidate +
  verdict + provider + provenance + topMint + blocker deltas, the aggregate rollup movement, the
  blocker-reason frequency movement, and the Phase 7 posture movement. It NEVER re-derives a verdict;
  both inputs are re-validated + deep-scanned and a malformed / live-authorizing rollup is refused.
  **Movement is not momentum.** `--fail-on-worsened` gates CI when the aggregate blocked count rose.
- **Alpha history trend** — `paper:sniper:alpha:history:trend` (`sniper.alpha_history.trend.v1`) folds an
  ORDERED list of rollups into one series. The order is the **supplied order** — no wall-clock, no fake
  time series. It reports the verdict + candidate series across snapshots, step-to-step deltas, the
  blocker-reason totals, the evidence-provenance totals, and the per-provider ok-run consistency.
- **Committed redacted examples** — `examples/sniper/alpha-artifacts/` ships byte-deterministic example
  artifacts (history, diff, trend, strategy-intelligence) produced through the production builders, so
  `/sniper` and the docs render realistic artifacts without the gitignored `runs/` tree. Inspect them with
  `pnpm web:inspect --dir examples/sniper/alpha-artifacts`.
- **Typed web views** for both new schemas on `/sniper`, under the LIVE TRADING DISABLED banner, with a
  do-NOT-trust caution when the safety literals are missing; hostile content escaped.
- **Deliberately deferred (honest):** folding live quote / liquidity depth and the Rust candidate score
  into the strategy-intelligence cards was NOT done — both would mutate the closed, stable
  `sniper.strategy_intelligence.v1` schema and the live probe would break the pure builder's no-network
  invariant; that work is a `sniper.strategy_intelligence.v2` sprint.

## What does NOT work (honest)

- **Live trading** — not implemented; 0% by policy.
- **Mainnet send** — no command, no flag, no seam.
- **Signed Phase 7 authorization** — no written human sign-off exists; the audit stays
  `authorized-for-design-only` and the micro-trade preflight stays `blocked-missing-signoff`.
- **S104-B micro-trade send surface** — not built; must not be built without separate, explicit written
  user authorization.

## How to demo in one minute (offline, no network)

```sh
mkdir -p runs/alpha
pnpm soulmaker paper:sniper:watchlist:prepare --candidates examples/sniper/candidates.example.json --status watch --out runs/alpha/watchlist.json
pnpm soulmaker paper:sniper:provider:doctor --mode paper --out runs/alpha/provider-health.json --force
pnpm soulmaker paper:sniper:campaign:auto-run --watchlist runs/alpha/watchlist.json --provider-health runs/alpha/provider-health.json --run-id alpha-demo --out runs/alpha --force
pnpm web:inspect --dir runs/alpha --force   # then: pnpm web:build  to restore the static site
```
