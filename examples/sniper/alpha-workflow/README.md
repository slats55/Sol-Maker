# Alpha workflow — repeatable no-send demo

A copy-pasteable walkthrough of the Sol Maker alpha: **provider doctor → watchlist → live-read-only
auto-campaign → diff → alpha report → command center**.

> **LIVE TRADING IS DISABLED.** Nothing here signs, sends, loads a key, or authorizes a trade. The
> only broadcast surface anywhere in Sol Maker is `execution:devnet:send` (devnet, double opt-in).
> Run everything from the repo root.

All generated artifacts land under `runs/` (gitignored). The commands below never commit anything.

---

## A. Offline / fixture demo (no network, fully reproducible)

This uses the committed fixture [`examples/sniper/candidates.example.json`](../candidates.example.json)
(well-known public mints used as deterministic, NON-live examples) and runs entirely offline. It always
produces the same artifacts on any machine.

```sh
# 0. A scratch output dir (gitignored).
mkdir -p runs/alpha

# 1. Prepare a watchlist from the candidate fixture (LOCAL-ONLY; a status is bookkeeping, not readiness).
pnpm soulmaker paper:sniper:watchlist:prepare \
  --candidates examples/sniper/candidates.example.json --status watch \
  --out runs/alpha/watchlist.json

# 2. Provider doctor (paper mode is offline; it records reachability only, never a risk verdict).
pnpm soulmaker paper:sniper:provider:doctor --mode paper \
  --out runs/alpha/provider-health.json --force

# 3. Auto-campaign over the watchlist, ingesting the provider-health report.
#    Paper mode reaches NO network: candidates without ingested --risk read as insufficient-evidence.
pnpm soulmaker paper:sniper:campaign:auto-run \
  --watchlist runs/alpha/watchlist.json \
  --provider-health runs/alpha/provider-health.json \
  --run-id alpha-demo --out runs/alpha --force

# 4. Inspect the whole folder in the command center (every artifact under a LIVE TRADING DISABLED banner).
pnpm web:inspect --dir runs/alpha --force
#    Restore the static site afterward with:  pnpm web:build
```

The `runs/alpha` folder now holds `provider-health.json`, `readonly-campaign-plan.json`, `campaign.json`,
`alpha-report.json`, `evidence-index.json`, per-candidate evidence, and `RUN_SUMMARY.md`.

To see a **diff**, run step 3 twice into two folders (e.g. `runs/alpha-before`, `runs/alpha-after`) and:

```sh
pnpm soulmaker paper:sniper:campaign:diff \
  --before runs/alpha-before/campaign.json --after runs/alpha-after/campaign.json \
  --out runs/alpha/campaign-diff.json
pnpm soulmaker paper:sniper:alpha:report \
  --campaign runs/alpha-after/campaign.json --diff runs/alpha/campaign-diff.json \
  --out runs/alpha/alpha-report.json --force
```

---

## B. Live read-only demo (real public providers; still no-send)

Same flow, but `--mode mainnet-dry-run --allow-readonly-network` lets the campaign gather **deep risk +
route quotes itself** from real read-only providers. It still **never** sends, signs, or loads a key.

```sh
# Probe reachability first; the doctor reduces every endpoint to its host (a key in a URL is never printed).
pnpm soulmaker paper:sniper:provider:doctor --mode mainnet-dry-run \
  --rpc-url <RPC_URL> --out runs/alpha/provider-health.json --force

# Run the live-read-only campaign. --check-providers probes first and gates the live stages on reachability.
pnpm soulmaker paper:sniper:campaign:auto-run \
  --candidates examples/sniper/candidates.example.json \
  --mode mainnet-dry-run --allow-readonly-network --check-providers \
  --rpc-url <RPC_URL> --out runs/alpha --force
```

### `--rpc-url` is honored consistently

An explicit `--rpc-url` drives the **provider doctor probe**, the **deep-risk read**, AND the
**simulation** at the *same* endpoint, so the gathered evidence is internally consistent.
Precedence: **`--rpc-url` flag > `SOULMAKER_RPC_URL` env > public keyless default.** A key embedded in
the URL reaches the read-only client only and is reduced to its host in every report — it is never
printed. `--rpc-url` has no effect in paper mode (paper reaches no network); the run warns you when so.

### When providers are unavailable

The doctor records each provider's exact status — `unavailable` / `timeout` / `rate-limited` /
`misconfigured` / `error` — and re-derives `canRunLiveReadonlyCampaign: false`. It never fakes a result.
The campaign with `--check-providers` then **skips** the live stages that depend on the unreachable
provider (honest `skipped` evidence, not failure spam) and still writes a complete alpha folder. Fall
back to the offline demo (A) until providers recover, or supply a healthier `--rpc-url` / `--jupiter-url`.
A provider being down is **never** a candidate risk verdict.

---

## C. Alpha history rollup (Sprint 106 · offline)

Once you have **more than one** alpha run folder, fold them into ONE deterministic rollup. Re-run the
offline demo (A) into two folders first, then:

```sh
# Two runs side by side (re-run step 3 twice into two dirs).
pnpm soulmaker paper:sniper:campaign:auto-run --watchlist runs/alpha/watchlist.json --out runs/alpha-1 --force
pnpm soulmaker paper:sniper:campaign:auto-run --watchlist runs/alpha/watchlist.json --out runs/alpha-2 --force

# Roll up explicit folders by label…
pnpm soulmaker paper:sniper:alpha:history \
  --run day-1=runs/alpha-1 --run day-2=runs/alpha-2 \
  --out runs/alpha-history.json

# …or auto-discover every run folder under a parent.
pnpm soulmaker paper:sniper:alpha:history --runs-dir runs --out runs/alpha-history.json --force

# Inspect the rollup as a typed view.
pnpm web:inspect --input runs/alpha-history.json
```

The `sniper.alpha_history.v1` artifact aggregates, across runs: the candidate total, the
`watch` / `review` / `blocked` / `insufficient-evidence` tally, the provider-health and
evidence-provenance rollups, the most common blocker reasons, and the Phase 7 postures. A
missing / malformed / unrecognized artifact is listed under `invalidArtifacts` and **never** counted as
a run; a run that claims live authorization is **refused**. Add `--fail-on-invalid` /
`--fail-on-blocked` to gate CI. It authorizes nothing and can never report a live send.

## C2. Compare + chart history rollups over time (Sprint 107 · offline)

Once you have **two or more** history rollups (re-roll the campaign into different histories on
different days), compare them and chart the series. Both are deterministic, read the named files only,
and authorize nothing.

```sh
# Roll up two batches into two histories (a path may also be a folder holding alpha-history.json).
pnpm soulmaker paper:sniper:alpha:history --run mon=runs/alpha-1 --out runs/alpha-history-mon.json --force
pnpm soulmaker paper:sniper:alpha:history --run tue=runs/alpha-2 --out runs/alpha-history-tue.json --force

# Diff: what MOVED between two rollups (runs added / removed / changed, verdict / provider deltas).
pnpm soulmaker paper:sniper:alpha:history:diff \
  --base runs/alpha-history-mon.json --next runs/alpha-history-tue.json \
  --out runs/alpha-history-diff.json

# Trend: an ORDERED series across many rollups (supplied order — NO wall-clock).
pnpm soulmaker paper:sniper:alpha:history:trend \
  --history mon=runs/alpha-history-mon.json --history tue=runs/alpha-history-tue.json \
  --out runs/alpha-history-trend.json

# Inspect either as a typed view.
pnpm web:inspect --input runs/alpha-history-diff.json
```

The diff (`sniper.alpha_history.diff.v1`) pairs runs by `runRef` — an alpha history carries run-level
counts, not per-candidate identity — and reports **movement only**: runs added / removed / changed,
per-run + aggregate verdict / provider / provenance deltas, the blocker-reason frequency movement, and
the Phase 7 posture movement. The trend (`sniper.alpha_history.trend.v1`) reports the verdict + candidate
series across snapshots, step-to-step deltas, blocker-reason totals, and per-provider ok-run consistency.
Neither re-derives a verdict; both re-validate + deep-scan each input and refuse a live-authorizing
rollup. **Movement is not momentum** — a falling blocked count is bookkeeping, never a buy signal.
`--fail-on-worsened` gates the diff in CI when the aggregate blocked count rose.

Don't have run folders handy? Committed redacted examples live in `examples/sniper/alpha-artifacts/`:

```sh
pnpm web:inspect --dir examples/sniper/alpha-artifacts
```

## D. Strategy intelligence (Sprint 106)

Explain a campaign's candidates — the read-only "why a verdict + what to study next". The **offline**
form works from the campaign alone (verdicts come from the campaign; candidates without a risk report
read as low confidence):

```sh
pnpm soulmaker paper:sniper:strategy:intel \
  --campaign runs/alpha/campaign.json \
  --out runs/alpha/strategy-intel.json

pnpm web:inspect --input runs/alpha/strategy-intel.json
```

To surface the notable risk flags **by name** (freeze / mint authority, Token-2022 risks, holder
concentration, mutable metadata, thin liquidity), first gather a read-only `token:risk` report per mint
(this is the only step that reaches a public RPC — read-only, no key, no send), then pass each by mint:

```sh
# token:risk takes the mint as a positional argument; the read-only RPC comes from SOULMAKER_RPC_URL
# (or the keyless public default). --deep adds the holder-concentration + metadata-mutability reads.
pnpm soulmaker token:risk So11111111111111111111111111111111111111112 --deep \
  --json --out runs/alpha/risk.wsol.json
pnpm soulmaker token:risk EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --deep \
  --json --out runs/alpha/risk.usdc.json

pnpm soulmaker paper:sniper:strategy:intel \
  --campaign runs/alpha/campaign.json \
  --risk So11111111111111111111111111111111111111112=runs/alpha/risk.wsol.json \
  --risk EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v=runs/alpha/risk.usdc.json \
  --out runs/alpha/strategy-intel.json --force
```

The `sniper.strategy_intelligence.v1` artifact then surfaces, per candidate: the notable risk flags by
name, a mint class (`wrapped-sol` / `stablecoin` / `other`), a **confidence** label (evidence
completeness — never price direction), closed reason codes, and plain-English `whyItMatters` /
`whatToStudyNext`. Verdicts come from the campaign's own re-derivation — a high score can **never**
override a blocker, and a flag is shown ONLY when its risk report carries it. It is **never** a buy
signal and **never** a profitability claim.

## What "good" vs "blocked" looks like

| Candidate verdict | What it means | What you should do |
| --- | --- | --- |
| `watch` | clean read-only evidence (risk PASS, no blocking flag) | keep on the watchlist; keep monitoring. **NOT** a buy signal |
| `review` | a concern, or a positive clean signal is missing | re-check risk / quote / simulation before any next step |
| `blocked` | failed a read-only gate (risk REJECT, critical flag, Token-2022 blocker, refused build, failed simulation, fail preflight) | drop or remediate; a score can never override it |
| `insufficient-evidence` | core evidence (risk / preflight / release candidate) is missing | gather the missing evidence and re-run |

A **good** offline run with the committed fixture yields a mix of `watch` and `insufficient-evidence`
(paper mode reaches no network, so candidates without ingested `--risk` are honestly
`insufficient-evidence`). A candidate with a critical risk flag is **blocked**. In every artifact,
`liveTradingStatus` / `liveSendStatus` read `"disabled"` and `authorizesLiveTrading` is `false`.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Refusing: --out … already exists` | the target file/dir is present | add `--force`, or write to a fresh path |
| every candidate is `insufficient-evidence` | paper mode reaches no network and no `--risk` was ingested | ingest `token:risk` files via `--risk <mint>=path`, or run the live-read-only demo (B) |
| `provider unavailable` in the doctor report | the RPC / quote endpoint is down or throttled | supply a healthier `--rpc-url` / `--jupiter-url`, or fall back to the offline demo (A) — a down provider is never a candidate risk verdict |
| `Refusing: … is secret-shaped` | a candidate / label looks like a key | candidates carry PUBLIC mints only; never pass a private key or seed anywhere |
| `alpha:history` shows an `invalidArtifacts` entry | a run folder lacks `campaign.json`, or it is malformed | re-generate that run with `campaign:auto-run`; the rollup never counts it as a run |
| `strategy:intel` candidate is low-confidence | no `token:risk` report was supplied for that mint | run `token:risk --deep --json --out` for the mint and pass it via `--risk` |

## Provenance labels you will see

| label | meaning |
| --- | --- |
| `real-readonly` | real evidence read live from a public RPC / quote provider (no send, no signer) |
| `fixture` | deterministic committed example evidence |
| `unavailable` | a provider could not be reached — recorded honestly, never faked |
| `skipped` | a stage was gated off (provider down, or risk blocked the candidate) |
| `blocked` | a candidate failed a risk / build / simulation gate — never overridable by a score |

## What this demo never does

No mainnet send, no signer, no key load, no live trading (0% by policy). The alpha artifacts pin
`liveSendStatus` / `liveTradingStatus` `"disabled"` and refuse any `signature` / `txid` / `sendResult`
field. See [docs/ALPHA_RELEASE_CHECKLIST.md](../../../docs/ALPHA_RELEASE_CHECKLIST.md) for the full
status and [docs/SNIPER_RUNBOOK.md](../../../docs/SNIPER_RUNBOOK.md) for every command.
