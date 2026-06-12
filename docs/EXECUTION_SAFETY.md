# Execution Safety Model (Sprints 92–93)

This document is the operator's map of the **gated execution lane**: what each mode can do, where
the boundaries are, and exactly why live mainnet trading cannot happen from this codebase today.
It complements [`PHASE7_LIVE_EXECUTION_GATE.md`](PHASE7_LIVE_EXECUTION_GATE.md) (the gate design
record) and [`SNIPER_RUNBOOK.md`](SNIPER_RUNBOOK.md) (the paper-lane runbook).

Nothing in this document is a profitability claim, and nothing below is an authorization. The
default state of every gate is **blocked**.

## The closed mode set

`resolveExecutionMode` resolves every request fail-closed into exactly one of six modes:

| Mode | Build | Sign | Send | How it is reached |
|---|---|---|---|---|
| `paper` (DEFAULT) | no | no | no | the default; any unknown request also lands here |
| `readonly` | no | no | no | `--request readonly` |
| `devnet-execution` | devnet | devnet | devnet | `SOLMAKER_ENABLE_DEVNET_EXECUTION=devnet-only` **AND** `--acknowledge-devnet-execution` |
| `mainnet-dry-run` | mainnet | no | **no — structurally** | `--request mainnet-dry-run` |
| `mainnet-live-blocked` | — | — | — | `--request mainnet-live` with ANY of the fourteen gate conditions failed (the practical permanent state) |
| `mainnet-live-armed` | yes | yes | yes | ALL fourteen conditions pass — **and no shipped CLI command can reach a mainnet send even then** |

The send path (`attemptExecution`) accepts only `devnet-execution` and `mainnet-live-armed`, and
re-verifies the full fourteen-condition gate itself for the latter. **There is no mainnet send
CLI surface**: opening one requires a separate, explicitly authorized future sprint, a dedicated
review, and its own tests.

## The fourteen-condition mainnet live gate

All fourteen must independently pass; there is no override, no force flag, and no partial credit
(see `packages/execution/src/live-gate.ts`):

1. `env-acknowledgment` — `SOLMAKER_ENABLE_LIVE_TRADING` carries the exact acknowledgment sentence
2. `config-phase7-ready` — config `phase7LiveTradingReady: true`
3. `cli-acknowledgment` — `--i-understand-this-can-lose-real-money` (execution time only)
4. `network-mainnet-beta` — the target is exactly `mainnet-beta`
5. `max-spend-cap` — an explicit per-trade lamports cap
6. `session-loss-cap` — an explicit session loss cap in SOL
7. `slippage-cap` — an explicit slippage cap in bps
8. `kill-switch-clear` — explicitly clear (unknown is BLOCKED)
9. `quote-fresh` — the quote freshness check passed (see below)
10. `simulation-ok` — the EXACT envelope simulated ok
11. `risk-under-threshold` — advisory risk score under an explicit cap
12. `wallet-validated` — the destination public key validates
13. `signer-boundary` — the signer was loaded through the approved boundary
14. `audit-and-redaction` — an audit path is set and redaction findings are exactly zero

`execution:status` shows the live checklist; `execution:readiness` (S93) evaluates it against
operator-NAMED evidence and names every gap's exact next safe action — and is **structurally
incapable of reporting armed** (conditions 3, 13, and 14 finalize only at execution time).

## Quote freshness (Sprint 93)

One pure, fail-closed evaluator (`@soulmaker/core` `evaluateQuoteFreshness`) answers "is this
quote fresh?" everywhere. Its honesty rules:

- **No default age cap exists.** A missing or invalid cap is `cap-missing` and NOT fresh — a
  hidden default would falsely imply safety.
- A **missing** timestamp is NOT fresh — the absence of a quote can never make anything
  executable.
- A **malformed** timestamp is NOT fresh (refused, never guessed).
- A **future** timestamp is NOT fresh — clock disagreement blocks, it never rounds in the
  operator's favor.

Where it is wired:

- the **builder** stamps `quotedAt` into every `txpreview.envelope.v1` (the fresh quote's
  timestamp), and an explicit `--max-quote-age-ms` refuses a build whose quote aged out
  mid-flight (`build-refused-quote-stale`);
- **`execution:devnet:send`** computes the REAL quote age from the envelope's `quotedAt`:
  stale / missing / future refuses at the safety wall. The only quoteless exception is the
  self-transfer probe (sender == recipient — it moves nothing);
- **live-gate condition 9** is fed by `execution:status` / `execution:readiness` from a LIVE
  `routequote.fetch.report.v1` plus the explicit cap. Operator-supplied quote artifacts
  (`routequote.prepared.v1`) are **refused** as a freshness source: hand-typed quotes can never
  satisfy live freshness.

## The signer boundary

`packages/execution/src/signer.ts` is the only place in the repository where signing capability
exists:

- the only accepted form is the standard solana-keygen 64-byte JSON array, whose file PATH comes
  from an environment variable **NAME** — the path, the file, and the bytes are never logged,
  echoed, or serialized (`toJSON()` returns a redaction marker);
- **devnet-first**: loading a mainnet-beta signer refuses unless the ARMED fourteen-check gate
  result is presented;
- there is no seed-phrase handling and never will be;
- S93's throwaway generator (`createThrowawayDevnetSigner`) creates devnet-only keys INSIDE the
  boundary, writes them only to a `.keypair`-suffixed file (the repo's `*.keypair` gitignore rule
  covers it), and the CLI additionally restricts generated keys to `runs/` directories
  (gitignored) — two independent rules must both fail before a secret could become committable.

## The devnet rehearsal (Sprint 93)

`execution:devnet:rehearse` drives the FULL chain against the real devnet cluster: throwaway key
→ airdrop → unsigned self-transfer probe → real `simulateTransaction` → the refusal-first send
path → bounded confirmation polling — all recorded in one honest artifact
(`execution.devnet.rehearsal.report.v1`).

- It runs behind the same double opt-in as `execution:devnet:send`, refuses mainnet endpoints,
  and has **no mainnet variant** — a mainnet rehearsal is exactly what the live gate blocks.
- An airdrop rate limit or faucet outage produces an honest `devnet-funding-blocked` artifact
  with every completed step preserved — never a faked success.
- A probe that fails simulation is never sent. Submission is not confirmation, and the report
  says so.
- Devnet SOL is valueless: a confirmed rehearsal proves execution **discipline** (boundaries,
  gates, journaling), never mainnet readiness.

## The unified rehearsal workflow (Sprint 93)

`paper:sniper:rehearse` chains the existing production commands over one output directory with an
honest per-stage record (`sniper.rehearsal.report.v1`). The mode set is closed:

- `paper` (DEFAULT) — fully offline; every network stage is skipped and names its exact
  standalone command;
- `devnet` — adds the devnet broadcast rehearsal, and ONLY behind the explicit `--devnet-send`
  flag on top of the devnet double opt-in;
- `mainnet-dry-run` — adds live quote fetch/prepare, the unsigned build, and the real
  simulation. It can NEVER send: the only send-capable stage is structurally limited to devnet
  mode.

There is no `mainnet-live` mode and no flag combination that sends on mainnet.

## Kill switch and emergency stop

Both the config `killSwitch` and the emergency-stop file/env block every execution path:
the builder refuses to build, the safety controls refuse the trade, the gate condition 8 fails,
and the rehearsal records the refusal. Controls only ever tighten; no code path loosens another
check.

## Risk gates

Building blind is refused: `execution:build` requires a `token:risk --json` report whose mint
matches the candidate, an explicit `--risk-score-cap`, and refuses `REJECT` decisions outright.
Since S93 `token:risk --deep` also inspects Token-2022 extensions read-only (transfer hooks,
permanent delegates, transfer fees, default-frozen state, pausable, non-transferable, mint close
authority, and more) — the high-risk extensions force `REJECT`, and unreadable extension data is
an explicit caution, never "no extensions, all clear".

## Audit requirements

Every send-capable path journals every attempt — refused or submitted — to an append-only JSONL
audit log before reporting it. Live-gate condition 14 additionally demands zero unresolved
redaction findings over the attempt's artifacts. Artifact field names are chosen to be
redaction-safe, and every CLI output passes through the redaction backstop.

## What this codebase deliberately cannot do

- Send on mainnet (no CLI surface; the gate blocks the library path).
- Trade unattended (every send-capable command demands explicit per-run flags).
- Loosen a cap from a flag (caps only tighten against config).
- Treat a missing fact as safe (unknowns block or caution — everywhere).
- Fake a success (failed airdrops, failed simulations, stale quotes, and blocked chains are all
  first-class honest artifacts).
