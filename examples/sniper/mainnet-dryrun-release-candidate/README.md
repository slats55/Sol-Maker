# Mainnet dry-run release candidate (example, no-send)

This folder holds two **redacted, FICTIONAL** examples of the Sprint 102 release-candidate artifact
(`sniper.mainnet_dryrun.release_candidate.v1`) — the no-send summary that
`paper:sniper:rehearse --mode mainnet-dry-run` folds from one mainnet dry-run rehearsal.

Both files are generated **through production code** (`buildMainnetDryRunReleaseCandidate`) with a
fixed clock and invented mints, so they are byte-deterministic and always match what the real
command would write for the same evidence. The pin test
(`apps/cli/src/mainnet-dryrun-rc-example.test.ts`) regenerates them and fails if they drift.

Nothing here is live data, a trade signal, or a profitability claim. There is **no wallet, key,
signature, or send** anywhere — the artifact's `liveSendStatus` is the literal `disabled`.

## Files

- `release-candidate.complete.example.json` — the BEST possible outcome: every stage clean, verdict
  `dryrun-complete-blocked-live`. This means **dry-run evidence complete; live still disabled**. It
  is NOT live-trading readiness — opening the live path is a separate, explicitly-authorized future
  sprint (security audit → micro-trade).
- `release-candidate.blocked-risk.example.json` — a rejected candidate, verdict
  `dryrun-blocked-risk`. The candidate carries a high-ish score (58) but a `REJECT` risk decision:
  **a candidate score can never move a blocked verdict.** A rejected risk stays rejected.

## How to read the verdict

The verdict is RE-DERIVED from the structured stage evidence, never from a candidate score, in this
precedence:

1. `dryrun-error` — a pipeline stage hard-errored (the run could not complete).
2. `dryrun-blocked-risk` — risk REJECT / critical flag / Token-2022 blocker.
3. `dryrun-blocked-quote` — a quote was attempted but is not fresh-and-observed.
4. `dryrun-blocked-build` — the unsigned build was refused.
5. `dryrun-blocked-simulation` — the real `simulateTransaction` failed.
6. `dryrun-insufficient-evidence` — nothing blocking, but required evidence is missing.
7. `dryrun-complete-blocked-live` — dry-run evidence complete; **live still disabled** (the best case).

`liveSendStatus` is always `disabled`, `phase7LiveTradingReady` is always `false`, and the closed
schema refuses any `sendResult` / `signature` field — the artifact is structurally incapable of
reporting a live send.

## Produce one yourself (no-send)

```
pnpm soulmaker paper:sniper:rehearse --mode mainnet-dry-run \
  --candidates <candidates.json> --out runs/<dir> \
  --build-wallet <publicKey> --amount-sol 0.001 --slippage-bps 100 \
  --max-spend-sol 0.01 --slippage-cap-bps 200 --risk-score-cap 60 \
  --max-quote-age-ms 60000 --allow-paper-read
```

This chains candidate scoring, deep risk, quote fetch + Rust quote score, unsigned tx build, Rust tx
inspection, real simulation, readiness, and the release candidate — all read-only. Inspect the run
folder with the operator command-center view:

```
pnpm web:inspect --dir runs/<dir>
```

## Regenerate these examples

```
pnpm tsx scripts/gen-mainnet-dryrun-rc-example.ts
```

See `docs/MAINNET_DRY_RUN.md` for the full stage-by-stage walkthrough and `docs/EXECUTION_SAFETY.md`
for why no send ever occurs.
