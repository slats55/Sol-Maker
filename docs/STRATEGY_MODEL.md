# Soulmaker Strategy Model (Phase 5 / Sprints 5–10)

The strategy engine (`@soulmaker/strategy` + the `strategy:evaluate` and
`strategy:plan` CLI commands) is a **deterministic, paper-only rules engine**. It
decides whether a token candidate should be **skipped**, **watched**, or
submitted to the paper-trading engine as a simulated **paper-buy** or
**paper-sell** candidate — and nothing more. Its output **only ever feeds
`@soulmaker/paper`.**

- **Sprint 5** added the single-candidate engine and `strategy:evaluate`.
- **Sprint 6** added the **batch plan pipeline** and `strategy:plan`: evaluate a
  *list* of injected candidates and emit a deterministic `PaperCandidate[]` an
  operator may **later, manually** hand to `paper:run`. It **never auto-runs paper
  trades.**
- **Sprint 7** added two paper-only refinements: **journal-aware planning**
  (`strategy:plan --journal` derives the simulated portfolio from a **read-only**
  paper journal, instead of a prebuilt `--paper-state` snapshot) and **richer
  simulated exits** (trailing stop, partial/scaled take-profit, and per-mint
  position-aware sizing). It is still paper-only and still never auto-runs.
- **Sprint 8** closed the paper-only **loop** and added the **deterministic
  backtest**. `paper:run --journal` now **continues** from an existing valid
  journal (a strict starting state), so a `PAPER_SELL_CANDIDATE` derived from the
  journal actually fills instead of being rejected. A new `@soulmaker/backtest`
  package (CLI `paper:backtest`) replays an injected, self-contained local scenario
  through the **same** `planStrategyBatch` → `runPaperSession` code paths — still
  paper-only, still never live; see [`PAPER_TRADING_MODEL.md`](PAPER_TRADING_MODEL.md).
- **Sprint 9** hardened the **backtest** side of this pipeline (in
  `@soulmaker/backtest`): a scenario **validator + linter** (`validateBacktestScenario`
  / `lintBacktestScenario`, CLI `paper:backtest:lint`), stabler/richer reports
  (`schemaVersion`, `scenarioDigest`, `equityCurve`, **exact** `perMint` aggregates,
  surfaced `warnings`), an external `--seed-journal`, BOM-tolerant JSON reading, and
  copyable **injected** example scenarios under `examples/backtest/`. The strategy
  engine itself is unchanged and still only feeds paper; see
  [`PAPER_TRADING_MODEL.md`](PAPER_TRADING_MODEL.md).
- **Sprint 10** made the backtest easier to **review and regression-test** (still in
  `@soulmaker/backtest`, still injected-only): a **report diff**
  (`diffBacktestReports`, CLI `paper:backtest:diff`) that deterministically compares
  two existing simulated report JSON files into compatibility + deltas + a
  conservative `hasRegression` flag (a delta is bookkeeping, **not** a prediction or
  advice), and deterministic **scenario-authoring helpers**
  (`buildExampleBacktestScenario`/`expandScenarioMatrix`, CLI
  `paper:backtest:scenario:new`/`:matrix`) that emit INJECTED scenario skeletons and
  safe config-only variants (fake mints + injected prices — **not** real historical
  data). The strategy engine itself is again unchanged and still only feeds paper.

(Sprints 5–10 extend this Phase 5 package; they do **not** begin roadmap Phase 6
— transaction planning/simulation — which remains **not started** (and Phase 7
burner live mode remains **not started**).)

> **Paper-only. Not advice.** The strategy engine **does not execute trades** and
> **does not build, sign, simulate, or send a transaction.** It uses
> **injected / read-only** data only. It is **not financial advice**, **not a buy
> recommendation**, and **not live-trading authorization**, and it makes **no
> profitability claim**. A `PAPER_BUY_CANDIDATE` means "a candidate for
> *simulated* paper evaluation", **not** a real buy.

---

## What it is (and is not)

- **Is:** pure decision logic. Given one advisory `@soulmaker/risk` report plus
  optional injected market metrics (and an optional view of the current
  *simulated* portfolio), it emits a deterministic {@link StrategyReport} with a
  single decision, a 0–100 score, stable reason/disqualifier ids, the gating risk
  decision/score, and the required paper-only disclaimers.
- **Is not:** a router, a DEX adapter, a transaction builder, a signer, a price
  feed, or a network client. `@soulmaker/strategy` has **no** dependency on
  `@solana/web3.js`, no RPC, no wallet, no filesystem, no `Date.now`, and no
  `Math.random`. There is no signer, `Keypair`, secret key, mnemonic, or
  transaction type anywhere in it.

The package is **pure**; the **CLI** owns all local file I/O (reading the injected
candidate / config / paper-state JSON and printing redacted reports).

## Determinism

- The clock is **injected** (`now: () => string`); the package defaults to a
  fixed value and never reads wall-clock time itself.
- The report id comes from a **seeded** monotonic counter (`strategy-1`, …),
  never `Math.random()`.
- Identical inputs → byte-identical output. Tests inject a fixed clock and assert
  reproducibility and **no mutation** of the input candidate/config.

## Decisions

| Decision | Meaning |
| --- | --- |
| `SKIP` | do nothing with this candidate |
| `WATCH` | keep observing; take **no** simulated action yet |
| `PAPER_BUY_CANDIDATE` | eligible to be submitted to the **paper** engine as a *simulated* buy candidate — **not** a real buy |
| `PAPER_SELL_CANDIDATE` | eligible to be submitted to the **paper** engine as a *simulated* sell candidate (held position only) |

## Data flow

```
@soulmaker/risk  TokenRiskReport (decision + score)     injected metrics
        │                                                      │
        ▼                                                      ▼
   StrategyCandidate ───────────► evaluateStrategy(candidate, config, portfolio?)
   (+ optional PaperState ─ portfolioFromPaperState ─► StrategyPortfolio)
                                          │
                            risk gate → metric gates → cooldowns → score → decide
                                          │
                                   StrategyReport (decision, score, reasons, …)
                                          │
        CLI: formatStrategyReport (human) | JSON envelope (--json)
                                          │
                                          ▼
                         feeds @soulmaker/paper ONLY (a paper candidate)
```

## Rules (deterministic, in order)

### 1. Risk gate (hard disqualifiers; both entry & exit paths)

| Advisory risk decision | Result |
| --- | --- |
| missing / no report | `SKIP` (fail-safe — treated as REJECT) |
| `REJECT` | **always** `SKIP` |
| `CAUTION` | `SKIP` by default; continues **only** if `allowCaution` is true |
| `PASS_FOR_PAPER_EVALUATION` | continues |
| unrecognized decision | `SKIP` (fail-safe — malformed/injected input) |

Independently, an advisory **risk score above `maxRiskScore`** ⇒ `SKIP`. This
applies even to `CAUTION`-allowed and `PASS` candidates: `allowCaution` lets a
candidate *past the decision check*, but it can **never** bypass the score cap or
any other disqualifier. A risk score that is **non-finite or outside `[0, 100]`**
(malformed/injected input) is itself a disqualifier ⇒ `SKIP` — it can neither
slip past the cap (a `NaN > max` comparison is false) nor *inflate* the strategy
score (the risk value is bounded into `[0, 100]` before it drives the penalty).
The CLI additionally **refuses** a present-but-malformed `riskReport` outright.

### 2. Entry metric gates (only when **not** holding)

Each gate fires only when its threshold is configured. A configured-but-**missing**
metric is itself a disqualifier (never assumed to pass):

- `minLiquidityUsd` — liquidity missing or `< min` ⇒ `SKIP`.
- `minVolumeUsd` — volume missing or `< min` ⇒ `SKIP`.
- `maxPriceChangePct` — `priceChangePct` missing, or `|priceChangePct| > max` ⇒
  `SKIP` (avoid chasing a pump/dump on entry).

### 3. Cooldowns

- `cooldownAfterLossMinutes` — within the window of the last simulated **loss**
  in this mint ⇒ `SKIP` (the most conservative outcome).
- `cooldownAfterTradeMinutes` — within the window of the last simulated **trade**
  ⇒ capped to `WATCH`. This is the documented "more conservative" choice: it
  prevents a new buy (or an immediate re-trade of a held position) while still
  surfacing the token for observation, rather than silently dropping it.

The window is the **past** only: elapsed time is floored at zero, so a *future*
timestamp (clock skew, replayed or hand-edited fixtures) is **not** treated as
"in cooldown" and never suppresses a decision indefinitely.

### 4. Position awareness

- `maxOpenPositions` — at the limit, **no new `PAPER_BUY_CANDIDATE`** is produced;
  a would-be buy is capped to `WATCH`.
- `maxPositionConcentrationPct` — when the portfolio's most-concentrated position
  already meets/exceeds the cap, a would-be buy is capped to `WATCH`.
- **Holding a position:** entry gates are skipped and the **exit** rules run (see
  the next section). A held candidate still passes the risk gate first; a
  post-trade cooldown or a missing `priceChangePct` metric yields `WATCH`.

### 4a. Simulated exits (held positions; Sprint 7)

The exit decision is a small, pure module (`packages/strategy/src/exits.ts`,
`decideSimulatedExit`) producing a structured, **paper-only, simulated** plan —
`FULL_EXIT`, `PARTIAL_EXIT`, or `HOLD` — recorded on the report as `report.exit`
alongside the supporting reasons. Every input is **injected**; nothing is fetched.
Rules are evaluated **risk-first**, and the first match wins:

| # | Rule | Config / injected metric | Outcome |
| --- | --- | --- | --- |
| 1 | **Stop loss** | `stopLossPct`; `priceChangePct ≤ −stopLossPct` | `FULL_EXIT` (`STOP_LOSS`) |
| 2 | **Trailing stop** | `trailingStopPct`; drawdown from a **positive** peak `≥ trailingStopPct` | `FULL_EXIT` (`TRAILING_STOP`) |
| 3 | **Take profit** | `takeProfitPct`; `priceChangePct ≥ takeProfitPct` | `FULL_EXIT` (`TAKE_PROFIT`) |
| 4 | **Partial take profit** | `takeProfitPartialPct`; `priceChangePct ≥` it, **and** a sizable injected position | `PARTIAL_EXIT` (`PARTIAL_TAKE_PROFIT`) |
| 5 | otherwise | — | `HOLD` ⇒ `WATCH` |

- **Trailing stop.** The drawdown is the injected `drawdownFromPeakPct`, or derived
  as `peakPriceChangePct − priceChangePct`. It **only arms once the position
  reached a positive peak** — below that, the downside is the stop-loss's job. A
  non-positive threshold means "disabled" (consistent with `paper:run`).
- **Partial / scaled exit.** Scales out `partialExitFraction` of the position
  (default `0.5`). The USD size is `round2(fraction × positionSize)` where the
  **position size** is the injected `metrics.positionSizeUsd` or, when absent, the
  **per-mint simulated cost basis** derived from the injected paper state
  (`positionSizeUsdByMint`). If no positive size can be resolved, the partial
  **cannot be sized** and the engine **holds** (`PARTIAL_EXIT_UNSIZED`) rather than
  emit an unsized exit. So a `PARTIAL_EXIT` always carries a **positive** `sizeUsd`.
- A `FULL_EXIT` keeps the existing convention: the converted sell candidate has
  size `0`, which `paper:run` reads as "exit the whole simulated position".
- These rules are **backward-compatible**: with only `takeProfitPct` / `stopLossPct`
  configured (the Sprint 6 surface), behaviour is unchanged.

### 5. Score (deterministic, 0–100, clamped)

Defined in `packages/strategy/src/score.ts` with exported constants. Start at a
neutral base (`SCORE_BASE = 60`), subtract a portion of the advisory **risk**
score (`RISK_PENALTY_FACTOR = 0.6`; a missing risk score is treated as maximally
risky), then add small bonuses for positive injected metrics — liquidity (`+15`),
volume (`+10`), holders (`+10`/`+5` stepped), age (`+5`), healthy momentum
(`+10`) — and a penalty for negative momentum (`−10`). The result is **clamped to
`[0, 100]`**.

- `score ≥ minScoreForPaperBuy` ⇒ buy-eligible (subject to the position caps and
  trade cooldown above).
- `score ≥ minScoreForWatch` (but below the buy threshold) ⇒ `WATCH`.
- below the watch threshold ⇒ `SKIP`.

**Disqualifiers always override the score.** Any hard disqualifier forces `SKIP`
regardless of how high the score is — a high score can never turn a
risk-`REJECT`, a failed metric gate, or a loss cooldown into a buy.

## Output language (non-negotiable)

Every report (human and `--json`) states, in `disclaimer` + `notes`:

- **PAPER ONLY** — strategy output only feeds simulated paper evaluation.
- **Not financial advice.**
- **Not a buy recommendation.**
- **Not live-trading authorization** (and no profitability claim).
- A **`PAPER_BUY_CANDIDATE`** means a candidate for *simulated* paper evaluation,
  not a real buy.
- **No transaction was built, signed, simulated, or sent.**

All rendered output is passed through `@soulmaker/security`'s `redactString` /
`redactValue` as a backstop, so an injected secret-looking value can never leak.

## Batch planning — `strategy:plan` (Sprint 6)

`strategy:plan` is the **paper-only bridge** from the strategy engine to the paper
engine. It evaluates a **batch** of injected candidates (a snipe-/candidate-list)
and produces a deterministic plan plus the `PaperCandidate[]` an operator may
**later, by hand** pass to `paper:run`. It produces a **plan/candidate set only**:
it does **not** auto-run paper trades, create fills, or touch the journal.

```
StrategyCandidate[]  ──►  planStrategyBatch (evaluateStrategy per candidate)
   keep only PAPER_BUY_CANDIDATE / PAPER_SELL_CANDIDATE
   convert each → PaperCandidate (carries the advisory risk report + provenance)
   ▼
StrategyPlanResult { items, paperCandidates, counts, disclaimers }
   ▼
CLI: human report | --json envelope | --out writes ONLY PaperCandidate[]
   ▼
operator MANUALLY runs:  paper:run --candidates <out.json> --prices <prices.json>
```

**Inclusion / omission rules**

- `PAPER_BUY_CANDIDATE` → a `PaperCandidate` with `proposedSide: "BUY"`.
- `PAPER_SELL_CANDIDATE` → a `PaperCandidate` with `proposedSide: "SELL"`. (The
  paper candidate type already supports sell intent, so the conversion is real,
  not report-only.)
- `WATCH` and `SKIP` are **never** converted into `paperCandidates`. They are also
  omitted from the report `items` by default; `--include-watch` / `--include-skipped`
  surface them in `items` (with an `omissionReason`) **but still never** in
  `paperCandidates`.
- A hard **disqualifier** (risk `REJECT`, risk score above cap, a failed metric
  gate, a loss cooldown) forces `SKIP`, so it can never become a paper candidate —
  even with a high score.

**Simulated size.** Each converted candidate carries `proposedSizeUsd`. A
**sized partial exit** uses the exit plan's computed `sizeUsd` (a positive USD
fraction of the simulated position). Otherwise the size is resolved as: a
per-candidate `proposedSizeUsd` ► the configured `--size` default ► `0`. A `0` buy
size is the deliberate fail-safe: `paper:run` rejects a non-positive buy by its
caps, so a sizeless plan can never open a simulated position by accident. For a
**full sell**, `0` means "exit the whole simulated position" in `paper:run`; a
**partial sell** carries its positive `sizeUsd`, which `paper:run` converts to a
quantity at the injected sell price (clamped to the held quantity).

**Provenance.** Every converted candidate carries `source` (`strategy-plan:<origin>`)
and a `reason` making explicit it came from the strategy plan and is paper-only
("…no transaction was built, signed, simulated, or sent"), plus the advisory
`riskReport` so `paper:run` re-gates on the same evidence.

**Duplicates & order.** Candidate **order is preserved**; **duplicate mints are
preserved** (each gets its own stable item id, e.g. `strategy-plan-1`,
`strategy-plan-2`). The strategy layer does not assume one-position-per-mint —
`paper:run` and its caps remain the place that constraint is enforced.

The counts on `StrategyPlanResult` (`paperBuyCandidateCount`,
`paperSellCandidateCount`, `watchCount`, `skippedCount`, `rejectedCount`) are over
**all** candidates: `skippedCount` is a soft `SKIP` (score below the watch
threshold, no disqualifier); `rejectedCount` is a hard `SKIP` (a disqualifier
fired).

## Journal-aware planning — `strategy:plan --journal` (Sprint 7)

`strategy:plan` can derive its simulated portfolio snapshot from an **append-only
paper journal** instead of a prebuilt `--paper-state` file. `--journal <path>`
reads the local JSONL journal **read-only**, reconstructs a `PaperState` with the
existing paper reducer (`deriveStateFromJournalText` = `parseJournal` +
`reduceJournal` + fill validation), and feeds that state to the same
position-awareness and partial-exit-sizing rules.

- **Read-only.** The journal is **never written, truncated, or mutated**, and no
  journal is ever created. Planning still **never** runs `paper:run` or creates
  fills.
- **One source of paper state.** `--journal` and `--paper-state` are **mutually
  exclusive**; supplying both is refused cleanly (supply only one).
- **Strict, not lenient.** Deriving an *authoritative* portfolio must not silently
  drop events, so a journal with **any** malformed line or **invalid fill payload**
  is **refused** (unlike `paper:journal`, which tolerates and counts bad lines). A
  missing file is refused; an **empty/blank** journal yields the valid empty state.
- **Equivalence.** A valid journal produces the **same** plan as the equivalent
  `--paper-state` snapshot reduced from that journal (covered by tests).

## CLI

| Command | Purpose |
| --- | --- |
| `strategy:evaluate` | evaluate **one** local candidate against a local config (PAPER ONLY) |
| `strategy:plan` | evaluate a **batch** and emit `PaperCandidate[]` for a later, manual `paper:run` (PAPER ONLY; no auto-run) |

`strategy:evaluate` options: `--candidate <path>` (JSON `StrategyCandidate`),
`--config <path>` (JSON `StrategyConfig`), `--paper-state <path>` (optional JSON
`PaperState` for position-awareness), `--json`.

`strategy:plan` options: `--candidates <path>` (JSON **array** of
`StrategyCandidate`), `--config <path>` (JSON `StrategyConfig`), `--paper-state
<path>` (optional JSON `PaperState`), `--journal <path>` (optional **read-only**
paper journal JSONL; derives `PaperState`; mutually exclusive with `--paper-state`),
`--out <path>` (write **only** the `PaperCandidate[]`), `--size <number>` (fallback
simulated USD size), `--include-skipped`, `--include-watch`, `--json`.

Both commands read **injected local JSON only**: no chain access, no RPC, no
wallet. Missing/malformed candidate files, malformed JSON, a non-array candidates
file, a malformed candidate entry (reported **with its array index**), an invalid
config, a malformed paper state, a malformed/unreadable journal, an invalid
journal fill, and supplying **both** `--journal` and `--paper-state` are all
**refused cleanly**; secrets are never leaked (human, `--json`, and `--out` output
are all redacted). `strategy:plan` never invokes `paper:run`, never creates fills,
and never writes (or mutates) a journal.

## Relationship to the other layers

- **Consumes `@soulmaker/risk`:** the advisory decision is the first gate; the
  advisory score caps eligibility. `PASS_FOR_PAPER_EVALUATION` is *eligibility for
  paper evaluation*, never a live-trading judgment. See
  [`RISK_MODEL.md`](RISK_MODEL.md).
- **Feeds `@soulmaker/paper` only:** a `PAPER_BUY_CANDIDATE` /
  `PAPER_SELL_CANDIDATE` is a candidate for the simulated engine in
  [`PAPER_TRADING_MODEL.md`](PAPER_TRADING_MODEL.md). The strategy engine never
  performs the simulated fill itself, and never reaches execution.
- **Never touches the live boundary:** there is no path from strategy output to a
  signer or a send. Live sending remains Phase 7, behind every gate in
  [`WALLET_SAFETY_MODEL.md`](WALLET_SAFETY_MODEL.md).

## Limitations (be honest)

- Metrics are **injected fixtures**, not live market data. The score is a
  transparent heuristic filter, **not** a probability, a price target, or a
  track record.
- The exit rules (take-profit, stop-loss, trailing stop, partial take-profit) act
  on **injected** metrics (`priceChangePct`, `peakPriceChangePct`,
  `drawdownFromPeakPct`, `positionSizeUsd`) and a derived simulated position size.
  They are deterministic bookkeeping, **not** a fill, a price prediction, or a
  performance claim. A multi-step **simulated backtest** (replaying an injected
  scenario through plan → paper) **is** implemented in **Sprint 8** as
  `@soulmaker/backtest` / `paper:backtest` — injected local data only, deterministic
  and byte-stable, and explicitly **not a live result, not a profitability claim,
  and not advice** (see [`PAPER_TRADING_MODEL.md`](PAPER_TRADING_MODEL.md) and
  [`ROADMAP.md`](ROADMAP.md)).
- **Candidate-list ingestion** is wired only as far as **injected local JSON** (a
  `StrategyCandidate[]` file fed to `strategy:plan`). There is **no live
  snipe-list source, scraping, or network fetch** — and there will be no
  `references/`-style scraping. The operator supplies the list.
- The plan is the **end** of the automated path. `strategy:plan` emits a
  `PaperCandidate[]`; an operator must **manually** pass it to `paper:run`. There
  is **no auto-chaining**, and nothing is wired to execution.
