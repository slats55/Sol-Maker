# Sol Maker — Operator Demo Workbench

A one-command, SAFE showcase of Sol Maker's paper / dry-run pipeline. **Nothing here sends, signs, or
trades. Live execution is disabled.**

This directory is a committed pointer, not a generated run. Generate the demo folder locally (the
output lives under the gitignored `runs/`, so it is never committed):

```
pnpm soulmaker paper:sniper:operator-demo --out runs/demo
pnpm web:inspect --dir runs/demo --out runs/demo.html --force   # render the folder
```

## What it produces

One folder with a `sniper.operator_demo.manifest.v1` manifest + a `README.md`, and these artifacts —
each labelled by provenance so a fixture or fictional example can never be mistaken for live evidence:

| role | file | provenance | what it shows |
| --- | --- | --- | --- |
| `phase7-authorization-audit` | `phase7-authorization-audit.json` | real-readonly | the real Phase 7 audit over this repo (verdict re-derived; authorizes nothing) |
| `phase7-human-signoff` | `phase7-signoff-template.json` | real-readonly | a blank Phase 7 sign-off template (status `template-only`) |
| `devnet-funding-status` | `devnet-funding-status.json` | fixture | an honest funding-blocked snapshot (not a live read) |
| `candidate-input` | `candidates.json` | fictional-example | the fictional candidate list that seeds the ranking |
| `mainnet-dry-run-release-candidate` | `release-candidate.json` | fictional-example | a no-send release candidate folding in candidate ranking, risk, quote score, tx build, tx inspection, simulation, and readiness |

## Why live trading is disabled

The fourteen-condition mainnet live gate defaults blocked, no CLI command can send on mainnet, the
signer boundary refuses a mainnet load without an armed gate, and the Phase 7 authorization audit
verdict is `authorized-for-design-only` until a confirmed devnet broadcast and a written human sign-off
exist. See [`docs/PHASE7_AUTHORIZATION_DOSSIER.md`](../../../docs/PHASE7_AUTHORIZATION_DOSSIER.md).
