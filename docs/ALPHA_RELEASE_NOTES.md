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
