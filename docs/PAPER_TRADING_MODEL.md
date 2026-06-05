# Soulmaker Paper Trading Model (Phase 4 / Sprint 4; Sprint 8 journal-continuing runs + backtest)

The paper engine (`@soulmaker/paper` + the `paper:*` CLI commands) is a
**deterministic, offline, simulated-only** trading sandbox. It exists to prove
that the system can consume advisory risk reports, enforce caps, and keep an
auditable journal — **without ever touching a wallet, key, or the chain.**

> **Simulated only.** Paper trading does **not** imply live-trading readiness.
> No transaction is built, signed, simulated, or sent. No private keys or wallet
> secrets are accepted. Paper PnL is computed from **injected** prices and is
> **not** real market performance. A risk `PASS_FOR_PAPER_EVALUATION` means
> "eligible for paper evaluation", **not** "safe to buy", "approved for live
> trading", "profitable", or "executable".

---

## What it is (and is not)

- **Is:** pure domain logic — simulated orders/fills, weighted-average positions,
  realized + unrealized PnL, cap + kill-switch checks, an append-only journal,
  and report generation. Deterministic: identical input → byte-identical output.
- **Is not:** a router, a DEX adapter, a transaction builder, a signer, or a
  network client. `@soulmaker/paper` has **no** dependency on `@solana/web3.js`,
  no RPC, no filesystem, and no SDK for Raydium/Jupiter/Pump.fun/Jito/Warp.

The package is pure; the **CLI** owns all local file I/O (reading injected
candidate/price fixtures, appending to a JSONL journal, printing reports).

## Determinism

- Ids come from a seeded monotonic counter (`order-1`, `fill-1`, …) — never
  `Math.random()`.
- Timestamps are injected: simulated fills are stamped with the triggering price
  point's `observedAt`; run-level events use an injectable `now` (defaulted to a
  fixed value so the package never reads wall-clock time itself).
- Tests inject a fixed clock and fixed prices, so output is fully reproducible.

## Data flow

```
@soulmaker/risk  TokenRiskReport (decision)        injected price points
        │                                                   │
        ▼                                                   ▼
   PaperCandidate ───────────────► runPaperSession(caps, candidates, prices, TP/SL)
                                          │
            risk filter → caps/kill-switch checks → simulated fills → TP/SL sweep
                                          │
                         events[] + final PaperState + PaperRunSummary
                                          │
        CLI: formatPaperReport (human) | JSON envelope | append JSONL journal
```

## Risk integration (the candidate filter)

A candidate may enter a simulated **buy** only if its advisory risk decision is
`PASS_FOR_PAPER_EVALUATION`:

| Risk decision | Paper buy? |
| --- | --- |
| `REJECT` | never (`CANDIDATE_REJECTED_BY_RISK`) |
| `CAUTION` | blocked by default; allowed only with `--allow-caution` (off by default) |
| `PASS_FOR_PAPER_EVALUATION` | eligible for **paper evaluation only** |
| missing / invalid report | treated as `REJECT` (fail safe) |

A critical risk flag forces `REJECT` upstream in `@soulmaker/risk` and can never
be rescued by an allowlist credit, so it can never reach a paper buy.

> **Upstream of the candidate:** the Phase 5 strategy engine
> (`@soulmaker/strategy`, see [`STRATEGY_MODEL.md`](STRATEGY_MODEL.md)) is the
> layer that *decides* whether a token becomes a paper buy/sell candidate at all.
> It only ever **feeds** this paper engine — it performs no simulated fill itself,
> touches no wallet/chain, and builds/signs/simulates/sends nothing. A strategy
> `PAPER_BUY_CANDIDATE` is a candidate for *this* simulated engine, not a real buy.
>
> **Producing the candidate file (Sprint 6):** `strategy:plan` evaluates a *batch*
> of injected candidates and can write **only** the resulting `PaperCandidate[]`
> to a file (`--out`). That file is exactly the `--candidates` input this engine
> expects, so the operator can **manually** run
> `paper:run --candidates <plan-out.json> --prices <prices.json>`. The bridge is
> **manual by design**: `strategy:plan` never invokes `paper:run`, never fills,
> and never writes a journal — it emits a plan, nothing more.

## Caps & kill switch (enforced before every simulated action)

`PaperRiskCaps` (USD, simulation-scoped — distinct from the on-chain SOL caps in
`@soulmaker/core`):

| Cap | Effect |
| --- | --- |
| `killSwitch` | engaged → **no** simulated trades at all (emergency stop) |
| `maxTradeSizeUsd` | rejects an oversized candidate |
| `maxOpenPositions` | rejects opening a **new** position at the limit (adding to an existing one is allowed) |
| `maxDailyLossUsd` | once realized losses reach the cap, further buys are blocked |
| `maxPositionSizeUsd` (optional) | caps a single position's total cost basis |

The CLI `--kill-switch` flag is **OR-ed** with the core config `killSwitch`, so a
global emergency stop also halts paper runs.

Ordering within a run is deterministic: all candidate buys/sells are processed in
array order **first**, then the TP/SL sweep runs. The `maxDailyLossUsd` cap is
therefore evaluated against **realized PnL at buy time** — losses that only
materialize in the TP/SL sweep do not retroactively block earlier buys in the
same run (they do constrain subsequent runs that share the journal/state).

## Simulated trading rules

- **BUY:** requires risk-pass + valid injected price + all caps. Fills at the
  *first* injected price for the mint; opens/adds to a position (weighted-average
  cost basis); appends `PAPER_BUY_FILLED`.
- **SELL (explicit):** requires an open position; fills at the *latest* injected
  price; realizes PnL; reduces or closes the position (partial sells supported).
- **Take-profit / stop-loss:** thresholds in percent, evaluated against the
  injected price series in order. The first threshold crossed triggers a
  full-position simulated sell; the `TAKE_PROFIT_TRIGGERED` /
  `STOP_LOSS_TRIGGERED` event is always appended **before** the sell fill.

## Journal (append-only)

- Events are newline-delimited JSON (`JSONL`). The CLI **appends** (never
  truncates) with `appendFileSync`.
- `parseJournal` skips blank lines and reports malformed lines (bad JSON, unknown
  type, missing `at`) without losing the good ones — one bad line is never fatal.
- `reduceJournal` replays fill events to reconstruct positions + realized PnL.
  Unrealized PnL cannot be recomputed from fills alone (no live prices in the
  journal); the CLI surfaces the value recorded by the most recent run.
- `deriveStateFromJournalText` (Sprint 7) is a **strict** reconstruction for
  callers that need an *authoritative* portfolio snapshot: it composes
  `parseJournal` + `reduceJournal` and **additionally validates each fill payload**
  (finite non-negative amounts, a side matching the event type), returning
  `parseErrors` and `fillErrors` separately so the caller can refuse rather than
  silently fold a corrupt fill. It is pure (no filesystem) and only folds the
  well-formed fills, so the returned state is never `NaN`-corrupted.
  `strategy:plan --journal` uses it **read-only** (see
  [`STRATEGY_MODEL.md`](STRATEGY_MODEL.md)) and `paper:run --journal` uses it to
  derive a run's **starting state** (below); `paper:journal`/`paper:status` keep
  their lenient display behaviour.

## Journal-continuing runs (Sprint 8)

`runPaperSession` takes an optional injected `startingState` (a `PaperState`). It
is **cloned** (`cloneState`) so the caller's object is never mutated, and the run
proceeds from it: a sell can close a pre-existing position, and the caps
(`maxOpenPositions`, `maxPositionSizeUsd`, `maxDailyLossUsd`, kill switch) all
account for the carried-forward positions and realized PnL. Omitting it preserves
the original empty-state behaviour exactly.

The CLI wires this through `paper:run --journal`:

- If the journal **exists**, it is read **first** and the starting state is
  **strictly** derived (`deriveStateFromJournalText`). A malformed line or an
  invalid fill **refuses the run and appends nothing** — a journal used as the
  authoritative portfolio for a new run must not silently drop events.
- If the journal **does not exist**, the run starts from the empty state and the
  journal is **created** on append.
- A valid journal is only ever **appended to** — existing events are never
  truncated or rewritten.

This makes `strategy:plan --journal` → `paper:run --journal` a real paper-only
loop: a `PAPER_SELL_CANDIDATE` derived from the journal now finds its open
simulated position instead of being rejected with "no open simulated position".

## Backtest / replay (Sprint 8)

`@soulmaker/backtest` (CLI `paper:backtest`) replays an injected, self-contained
local JSON **scenario** (embedded strategy config + caps + ordered steps, plus an
optional seed `initialJournal`) through the **same** production code paths —
`planStrategyBatch` then `runPaperSession` with `startingState` — carrying the
simulated portfolio forward between steps, then reconstructs the final state with
`reduceJournal` + `markFinalUnrealized` + `summarize`. It is **pure** (no
fs/network/RPC/`Date.now`/`Math.random`) and **byte-stable** for a given scenario,
and refuses a malformed or empty-steps scenario clearly. Its report carries
**injected-historical-data-only** language and is **not a live result, not a
profitability claim, and not advice**. The command never writes a journal or any
fills; `--out` writes only the report JSON. See
[`ARCHITECTURE.md`](ARCHITECTURE.md) for the data flow.

## PnL reporting

`PaperRunSummary`: realized PnL, unrealized PnL, total PnL, open position count,
closed trade count, buy/sell counts, rejected-candidate counts (risk / caps /
price), and simulated notional volume. Every rendered report (human and `--json`)
carries the `PAPER ONLY` banner and the "no transaction was built, signed,
simulated, or sent" disclaimer.

## CLI

| Command | Purpose |
| --- | --- |
| `paper:run` | run a deterministic simulated evaluation from injected fixtures (with `--journal`, **continues** from an existing valid journal) |
| `paper:journal` | read + summarize an append-only journal (lenient display) |
| `paper:status` | real status from an optional journal (clean empty state otherwise) |
| `paper:backtest` | deterministic, injected-only simulated replay of a local scenario (Sprint 8) |

`paper:run` options: `--candidates <path>` `--prices <path>` `--journal <path>`
`--max-trade-size-usd` `--max-daily-loss-usd` `--max-open-positions`
`--max-position-size-usd` `--take-profit-pct` `--stop-loss-pct` `--kill-switch`
`--allow-caution` `--json`. With `--journal`, an existing journal is read first
and becomes the run's starting state (strict; refuses a malformed journal before
appending). Missing/unreadable fixtures and invalid numeric caps are refused
cleanly; secrets are never leaked (output is redacted).

`paper:backtest` options: `--scenario <path>` `--json` `--out <path>` (writes the
report JSON only — never a journal or fills). A malformed/empty scenario is
refused cleanly; output is redacted.

## Limitations (be honest)

- Prices are **injected fixtures**, not market data. PnL is bookkeeping, not a
  prediction or a track record.
- There is no slippage, liquidity, partial-fill, or latency modeling beyond the
  simple price-point model; fills are exact at the injected price.
- Nothing here is wired to execution. Live sending remains Phase 7, behind every
  gate in [`WALLET_SAFETY_MODEL.md`](WALLET_SAFETY_MODEL.md).
