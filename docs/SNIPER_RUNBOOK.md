# Soulmaker Sniper Operator Runbook (PAPER-only)

This runbook ties together the local, offline sniper path built in `@soulmaker/sniper`. It is the
practical "how do I run this" companion to [`SNIPER_MODEL.md`](SNIPER_MODEL.md) (the design/model doc).

> **Everything here is PAPER-only and offline.** No command in this runbook holds a wallet, key, seed
> phrase, signer, or keypair; none builds, signs, simulates, or sends a transaction; none places an
> order or trades live. A `paper-enter` decision is a **simulated** decision only. Phase 6 (transaction
> planning/simulation) and Phase 7 (burner/live trading) are **NOT started** — see the prerequisites at
> the end of this doc.

## What exists now

| Stage | Command | Artifact schema | What it does |
| --- | --- | --- | --- |
| 0. Where am I? | `paper:sniper:workflow` | `sniper.workflow.plan.v1` | Checks which local artifacts exist + validate, prints the recommended NEXT command. Executes nothing. |
| 1. Candidate intake | `paper:sniper:candidates:validate` | `sniper.candidate.list.v1` | Validates + normalizes a local candidate list (mint pubkey validity, unique ids, duplicate-mint warnings). |
| 2. Read-only inputs | `token:inspect`, `token:risk` | (existing) | Existing read-only commands that produce per-mint inspection + advisory risk JSON. |
| 3. Token preflight | `paper:sniper:preflight` | `sniper.token.preflight.report.v1` | Combines mint validity + inspection + risk into `pass` / `warn` / `fail` / `unknown` per candidate. |
| 4. Paper decisions | `paper:sniper:decide` | `sniper.paper.decision.report.v1` | Folds the candidate list + preflight + rules into `skip` / `watch` / `paper-enter` / `paper-reject` / `unknown`. |

All of stages 1, 3, and 4 live in the pure `@soulmaker/sniper` package, which carries **no chain
capability** (no `@solana/web3.js`, no `@soulmaker/solana`; a forbidden-import test enforces this). The
CLI is what reads files and (for stage 2) talks to read-only RPC.

## What is still PAPER-only

Everything. The sniper path stops at a **simulated decision**. There is no execution layer: a
`paper-enter` is a classification, not an order. The pure builders never do I/O; the CLI commands read
local files (and, only for the existing `token:inspect` / `token:risk`, read-only RPC) and write
nothing unless you pass `--out`.

## The workflow, step by step

Use `paper:sniper:workflow` at any time to see where you are and what to run next:

```bash
pnpm soulmaker paper:sniper:workflow --candidates candidates.json --preflight preflight.json --decision decision.json
```

It prints each stage's status (`done` / `ready` / `blocked` / `todo`) and the single recommended NEXT
command. It only DESCRIBES the sequence — it runs nothing.

### 1. Validate candidates

Author a candidate list (operator-friendly raw input is fine — see
[`examples/sniper/`](../examples/sniper/README.md)):

```json
{ "sourceLabel": "my-watchlist", "candidates": [ { "candidateId": "c1", "mint": "<32-byte base58 mint>", "sourceTag": "manual" } ] }
```

```bash
pnpm soulmaker paper:sniper:candidates:validate --input candidates.json --json > candidates.validated.json
```

Every mint is validated as a 32-byte Solana **public** key — secret-length / private-key-like input is
**refused** — candidate ids must be unique, and duplicate mints are surfaced as warnings. The optional
`observedLiquidityUsd` / market / social fields are operator-supplied intake metadata and are **not**
verified on-chain by this step.

### 2. Gather read-only inputs

For each candidate mint, produce the read-only inputs with the EXISTING read-only commands:

```bash
pnpm soulmaker token:inspect <mint> --json > c1.inspect.json   # mint/freeze authorities, decimals, supply, program
pnpm soulmaker token:risk <mint> --json > c1.risk.json         # advisory risk decision + flags + score
```

`token:inspect` uses read-only RPC; `token:risk` is a pure advisory engine over the inspected facts.
Neither accepts a key or sends anything.

### 3. Preflight

```bash
pnpm soulmaker paper:sniper:preflight --candidates candidates.json \
  --inspection c1=c1.inspect.json --risk c1=c1.risk.json --out preflight.json
```

Each candidate gets `pass` / `warn` / `fail` / `unknown`. A risk `REJECT` or a critical flag is a
`fail`; a `CAUTION`, a freeze/mint authority, or a high-severity flag is a `warn`; a candidate with no
inspection and no risk is `unknown`. This command is **local-only** (no RPC) — it consumes the JSON
from step 2.

### 4. Decide (paper-only)

```bash
# Optional rules: { "requirePreflightPass": true, "maxRiskScore": 60, "minObservedLiquidityUsd": 1000, "denyMints": [] }
pnpm soulmaker paper:sniper:decide --candidates candidates.json --preflight preflight.json --rules rules.json --out decision.json
```

Each candidate gets `skip` / `watch` / `paper-enter` / `paper-reject` / `unknown`. A candidate reaches
`paper-enter` **only** when the preflight passed and every rule is satisfied — and even then it is a
**simulated** decision, never an order.

## How to inspect risk reasons

- The **preflight** entry for a candidate lists its `warnings`, `disqualifiers`, and a capped
  `risk.topFlags` (most-severe first). Run with `--json` to see the full structured entry.
- The **decision** entry lists `reasons`, `blockingRiskFlags` (the flags that caused a `paper-reject`),
  `appliedRules`, and `assumptions`.
- The underlying `token:risk` report has the complete advisory flag list with `detail` and `evidence`.

## CI gates

- `paper:sniper:candidates:validate --fail-on-warning` — fail on a duplicate mint, etc.
- `paper:sniper:preflight --fail-on-fail` / `--fail-on-warning`.
- `paper:sniper:decide --fail-on-paper-enter` (ensure nothing auto-enters) / `--fail-on-risk`.

## What is intentionally NOT implemented

- **No execution**: no order placement, no transaction build/sign/send, no wallet, no signer, no
  keypair, no seed phrase — anywhere.
- **No live snipe-list source**: candidates are local JSON the operator authors; there is no scraper or
  network fetch of opportunities.
- **No live RPC in the sniper commands**: the preflight is local-only (it consumes `token:inspect` /
  `token:risk` output). A live `--read-only-rpc` preflight mode is deferred, not faked.
- **No profitability, win-rate, or ROI claims** anywhere — these are integrity/safety artifacts, not
  performance results.

## Prerequisites before Phase 6 (transaction planning / simulation)

Phase 6 is **not started** and must not begin until ALL of these are stable:

1. Candidate intake stable (Sprint 25 ✅).
2. Token preflight stable (Sprint 26 ✅).
3. Paper decisions stable (Sprint 27 ✅).
4. Operator workflow + runbook stable (Sprint 28 ✅).
5. Risk limits / operator config stable and explicitly versioned.
6. Audit logging + a dry-run-by-default posture designed.
7. A kill-switch design.
8. A secrets policy and burner-wallet **isolation** design (no main-wallet config ever).
9. Test coverage for every boundary, and an explicit, documented **planner ⟂ signer** separation
   (the transaction planner must never have access to a signer).

Phase 6 itself is **planning + simulation only** — still no sending. The full boundary contract +
prerequisites are specified in [`PHASE_6_SIMULATION_BOUNDARY.md`](PHASE_6_SIMULATION_BOUNDARY.md); see
also [`ROADMAP.md`](ROADMAP.md) Phase 6.

## Prerequisites before Phase 7 (burner / live)

Phase 7 is **not started** and is gated behind Phases 0–6 being green PLUS:

- A fresh, isolated **burner** secret (the config must refuse anything main-wallet-shaped).
- Caps enforced **before** building/sending; simulate-before-send; redacted signature + risk logging.
- Live sending behind an explicit, loud opt-in (e.g. `DANGEROUS_BURNER_LIVE`) and operator approval.

None of this exists or is in scope for the current PAPER-only work.
