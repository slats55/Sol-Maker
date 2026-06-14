# Sniper alpha artifacts — REDACTED EXAMPLES (no-send, PAPER, read-only)

These files are **committed, redacted, fictional examples** of the no-send sniper alpha artifacts, so
the web inspector (`/sniper`, `pnpm web:inspect`) and the docs have realistic artifacts to render
**without relying on the gitignored `runs/` tree**.

> **LIVE TRADING IS DISABLED.** Every artifact here pins `liveTradingStatus: "disabled"`,
> `authorizesLiveTrading: false`, and `neverSends: true`. These are read-only bookkeeping artifacts —
> **not** a live result, **not** a trade signal, **not** a profitability claim, and **not** live
> readiness. Phase 7 written sign-off and S104 execution authorization are still missing; there is no
> mainnet-send command anywhere in Sol Maker.

Everything is an **injected fixture**: the candidate mints are well-known public mints (WSOL / USDC /
BONK) used purely as deterministic placeholders — **not a recommendation and not real analysis** — and
the evidence provenance is honestly labelled `fixture`. There are no secrets, no endpoints, no keys, no
raw run folders, and no private data.

## Files

| File | Schema | What it shows |
| --- | --- | --- |
| `alpha-history-mon.example.json` | `sniper.alpha_history.v1` | A "monday" rollup: a shared run with one blocked candidate, plus a run only seen that day. |
| `alpha-history-tue.example.json` | `sniper.alpha_history.v1` | A "tuesday" rollup: the shared run's blocker cleared, and a different run appeared. |
| `alpha-history-diff.example.json` | `sniper.alpha_history.diff.v1` | The diff of monday → tuesday: one run `changed` (blocked −1), one `removed`, one `added`. The aggregate blocked count stays flat (a new run re-introduced a blocker) — a reminder that **movement is not momentum**. |
| `alpha-history-trend.example.json` | `sniper.alpha_history.trend.v1` | A three-snapshot trend (monday → tuesday → wednesday) with the blocked series falling to 0 by wednesday. The order is the **supplied order**, never a wall-clock. |
| `strategy-intelligence.example.json` | `sniper.strategy_intelligence.v1` | Per-candidate read-only intelligence: WSOL (`watch`), USDC (`blocked` on a freeze-authority flag, surfaced by name), BONK (`insufficient-evidence`, no risk report). |

## Regenerate

These files are produced **through the production builders** (the same code the CLI uses), with no
wall-clock, so they are byte-deterministic:

```bash
pnpm tsx scripts/gen-alpha-artifact-examples.ts
```

The pin test `apps/cli/src/alpha-artifact-examples.test.ts` re-runs the builders, fails loudly if the
committed files drift, re-validates each with its production validator, and asserts every no-send /
live-disabled literal.

## Inspect

```bash
pnpm web:inspect --input examples/sniper/alpha-artifacts/alpha-history-diff.example.json
pnpm web:inspect --dir examples/sniper/alpha-artifacts
```
