# Devnet end-to-end broadcast rehearsal (Sprint 93)

A walkthrough of `execution:devnet:rehearse` — the first path that exercises the FULL execution
chain against a real cluster, on **devnet only**: fund a throwaway key, build the unsigned
self-transfer probe, simulate it, submit it through the refusal-first send path, and confirm the
signature.

**This is not live trading and never becomes it.** Devnet SOL is valueless; the probe is a
self-transfer (sender == recipient, so no value moves even on devnet); and nothing here arms,
weakens, or substitutes for the fourteen-condition mainnet live gate. A confirmed rehearsal is
execution-discipline evidence — boundaries, gates, journaling — never mainnet readiness.

## Run it

```bash
# The same double opt-in as execution:devnet:send — both are required:
#   1) the env flag, exactly:
SOLMAKER_ENABLE_DEVNET_EXECUTION=devnet-only \
pnpm soulmaker execution:devnet:rehearse \
  --out runs/devnet-rehearsal/$(date +%Y-%m-%d) \
  --acknowledge-devnet-execution        # 2) the explicit CLI flag
```

On PowerShell:

```powershell
$env:SOLMAKER_ENABLE_DEVNET_EXECUTION = 'devnet-only'
pnpm soulmaker execution:devnet:rehearse --out runs/devnet-rehearsal/today --acknowledge-devnet-execution
```

Useful flags: `--airdrop-sol 0.5` (devnet faucet request, max 2), `--skip-airdrop` (the signer is
already funded), `--signer-env MY_DEVNET_KEY` (reuse an existing devnet keypair via the env var
NAME holding its file path), `--rpc-url` (mainnet endpoints are refused), `--json`, `--force`.

## What to expect in the output directory

| File | What it is |
|---|---|
| `devnet-rehearsal-report.json` | `execution.devnet.rehearsal.report.v1` — every step (mode, signer, funding, build-probe, simulate, send, confirm) with its honest status, the airdrop record, the signature, and the confirmation slot |
| `devnet-rehearsal-audit.jsonl` | append-only journal of the send attempt (refused or submitted), exactly like `execution:devnet:send` journals |
| `throwaway.devnet.keypair` | the generated throwaway devnet keypair (only when `--signer-env` was not used) — see below |

Outcomes are a closed set: `rehearsed` (confirmed on devnet), `submitted-unconfirmed`
(submission is not confirmation — verify the signature independently), `devnet-funding-blocked`
(the faucet rate-limited or the balance stayed below the minimum — the honest, common case; rerun
later or fund the key at <https://faucet.solana.com>), and `blocked` (a wall refused: mode,
signer, simulation, or a safety control).

## How secrets are handled

- The throwaway key is generated INSIDE the signer boundary (`signer.ts`) and written exactly
  once, to a file ending in `.keypair` — which the repository's `*.keypair` gitignore rule covers
  — and the CLI additionally refuses to generate one outside a `runs/` directory (also
  gitignored). Two independent rules must both fail before a secret could become committable.
- The secret bytes never appear in any report, journal, log line, or terminal output; the
  boundary serializes to a redaction marker. Tests pin all of this.
- The key is throwaway by design: delete it after the rehearsal. It holds only valueless devnet
  SOL.
- Reusing a key via `--signer-env` passes the env var NAME — never the path and never the key —
  on the command line.

## Why this is not mainnet live trading

- The mode wall accepts `devnet-execution` only; there is no mainnet variant of the command, and
  mainnet-looking RPC endpoints are refused outright.
- The envelope, the signer boundary, and the send path each independently require devnet.
- Mainnet sending has NO CLI surface anywhere in this repository, and the fourteen-condition
  mainnet live gate remains BLOCKED by default (see `docs/EXECUTION_SAFETY.md` and
  `docs/PHASE7_LIVE_EXECUTION_GATE.md`).
