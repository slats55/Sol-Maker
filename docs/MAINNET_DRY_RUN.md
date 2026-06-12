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
