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
