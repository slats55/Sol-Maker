# Execution Safety Model (Sprints 92–96)

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

## Post-trade reconciliation and the session wall (Sprint 96)

Every execution attempt must be **accounted for afterward** — that is the reconciliation
requirement, and it is enforced, not advisory:

1. **Every attempt leaves a trail.** `execution:devnet:rehearse` and `execution:devnet:send`
   append `execution.session.ledger.entry.v1` lines to the session ledger
   (`runs/execution-sessions.jsonl`, gitignored), and the rehearsal additionally writes
   `execution.reconciliation.report.v1` next to its report — even a funding-blocked run is
   recorded.
2. **The unreconciled-session refusal rule.** A NEW devnet execution attempt is refused while
   the latest session is sent-but-unconfirmed, confirmed-but-unreconciled, pending-confirmation,
   unknown, or in error. Continuation is allowed ONLY after `reconciled`, `not-sent`,
   `funding-blocked`, or an explicit audited acknowledgment. The wall fails CLOSED: a ledger
   that cannot be fully parsed blocks too. **There is no bypass flag.** The only exits are:
   - `execution:session:reconcile` — accounts for the session with REAL observed data: a
     bounded confirmation re-check (with transaction-history search), the CURRENT balance, and
     the ACTUAL fee from transaction meta, compared expected-vs-actual into a closed verdict
     set (`reconciled | unreconciled | pending-confirmation | not-sent | funding-blocked |
     rpc-unavailable | unsupported | error`);
   - `execution:session:acknowledge` — the explicit, audited human exit: requires the
     `--acknowledge-unreconciled-session` flag AND a verbatim `--reason` (≥ 10 chars), appends
     a `manual-acknowledgment` ledger entry, and refuses when nothing is blocked.
3. **Confirmation tracking is bounded and classified.** `trackConfirmation` polls a hard-capped
   number of times and classifies into a CLOSED set — `confirmed | finalized | timeout |
   dropped | rpc-unavailable | signature-error | unknown` — each with exact operator guidance.
   No guidance ever says "resend"; the tracker's RPC seam has no send method, so it
   structurally cannot resubmit. `dropped` is claimed only with explicit blockhash-expiry
   facts, never guessed.
4. **Balance facts are observations or honestly unavailable.** Deltas (SOL lamports; token raw
   amounts via BigInt) are computed only when both sides were actually read; an unobservable
   side yields `unavailable`, never zero. No P/L is estimated anywhere.
5. **Readiness reports the accounting state.** `execution:readiness` includes the last
   session's reconciliation status as evidence (`evidence.sessionReconciliation`) and names the
   exact next safe action when the wall is closed.

`execution:session:status` shows the ledger and the continuation decision read-only.
Mainnet-dry-run reconciliation reports record `not-sent` with the explicit caveat that no send
result exists to reconcile — that absence is the honest record, not a gap.

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

Since S95 the risk report's **flag ids ride into the build request**: a Token-2022 BLOCKER
extension (transfer hook, permanent delegate, non-transferable, frozen-by-default, pausable,
extreme transfer fee) refuses the build pre-network with its own code
(`build-refused-token2022-blocker`) — independent of, and in addition to, the score/decision
gates.

## Transaction build safety (Sprint 95)

The swap build path is a **provider adapter boundary**, not a one-off
(`packages/txbuilder/src/jupiter-swap.ts` behind the `SwapTransactionBuilder` interface; the
CLI injects it through a seam, which is how tests prove provider-never-called properties):

1. **Refusal-first** — `evaluateBuildRefusals` runs over a CLOSED 29-code set BEFORE any
   network call: kill switch, mode, network match, wallet/mint validity, amount, risk
   (missing/REJECT/over-cap/Token-2022 blocker), spend cap, slippage cap, allowlist validity.
   Refusals accumulate; the same request facts always produce the same codes.
2. **Strict response validation** — the provider's transaction is accepted only if it
   validates as a strictly UNSIGNED `txpreview.envelope.v1` (any embedded signature refuses),
   and the fresh quote's mints/amounts are cross-checked against the request and the spend cap.
3. **The S95 shape gate** — the validated envelope's decoded transaction must also pass:
   supported version (`legacy`/0), a real recent blockhash, and — when the operator supplies a
   program allowlist — every statically-resolvable invoked program on the list. Program ids
   loaded through address-lookup tables cannot be verified offline, so under an allowlist they
   refuse HONESTLY (`build-refused-unsupported-instruction`) instead of passing unverified. No
   allowlist supplied = no program check (the default).
4. **Operator guidance taxonomy** — every refusal code and every simulation-failure
   classification carries a plain operator message and an exact next safe action
   (`BUILD_REFUSAL_GUIDANCE`, `TX_SIMULATION_CLASSIFICATION_GUIDANCE`); completeness is pinned
   by tests, and no guidance ever suggests bypassing a gate.
5. **An auditable record per attempt** — `--report-out` (and the rehearsal always) writes
   `txbuild.report.v1` on BOTH outcomes: a refused build is a first-class artifact, never just
   error text. The report carries the redacted request summary, the refusals with guidance,
   the fresh-quote facts, and the transaction SHAPE facts — never the transaction body.
6. **Simulation before live** — the dry-run pipeline's only continuation is
   `paper:simulation:tx` (sigVerify:false over the unsigned envelope). Every failure is
   deterministically classified (`slippage-or-route-error`, `compute-exceeded`,
   `blockhash-error`, `account-error`, `program-error`, `unclassified-error`,
   `rpc-unavailable`, `envelope-refused`) from the program error + bounded redacted logs.
   Live-gate condition 10 accepts only `simulated-ok` over the EXACT envelope.
7. **No mainnet send surface** — unchanged: the builder cannot sign, the simulator cannot
   send, and no CLI command reaches a mainnet send (see
   [`MAINNET_DRY_RUN.md`](MAINNET_DRY_RUN.md) for the end-to-end workflow and the real
   2026-06-12 evidence).

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
- Start a new execution attempt on top of an unaccounted one (the S96 session wall refuses; the
  only exits are a real reconciliation or an explicit audited acknowledgment).
