# S109 Continuous Sniper Runbook — paper daemon, performance evidence, hardened canary buy/sell

Sprint 109. Everything in this runbook is either PAPER (nothing sent, nothing held) or
LIVE-GATED-UNSIGNED (an artifact you would still have to sign yourself in Phantom). The backend
never holds a key, never signs, and never sends. No profitability claim is made anywhere.

## The one-screen mental model

```
                    ┌────────────── PAPER (default; structurally cannot send) ──────────────┐
  real feeds ──► live:sniper:daemon ──► risk (real RPC) ──► quotes (real Jupiter) ──► score
                    │                                                                    │
                    │   paper positions open/exit by DETERMINISTIC rule; every decision   │
                    │   journaled; summary + ledger written every loop                    │
                    └──► live:sniper:paper:report  → honest edge verdict                  │
                                                                                          │
                    ┌────────────── LIVE-GATED (unsigned only; every gate refuses) ───────┘
  live:sniper:approve (typed phrase, TTL ≤ 15 min)
        └─► live:canary:prepare-buy  → buy-review + UNSIGNED canary request
        └─► live:canary:prepare-sell → sell-review (UNSIGNED)
        └─► live:sniper:reconcile-position → expected vs observed, unknown stays unknown
  … and the ONLY send path remains: web Live Console → YOU confirm in Phantom.
```

## 1. Continuous paper daemon

```
pnpm soulmaker live:sniper:daemon --mode paper --duration-minutes 30 --poll-seconds 15 \
  --out-dir runs/s109-paper-daemon --profile balanced \
  --rpc-url <read-only-mainnet-rpc> --apply-exits
```

What it does, per loop:

1. Polls the real Jupiter recent-tokens feed AND the real DexScreener token-profiles feed
   (`--sources jupiter,dexscreener` to choose; a failing provider is backed off exponentially and
   never kills the run).
2. Normalizes + dedupes candidates — within the batch and ACROSS loops (a mint is processed once
   per session).
3. Runs the REAL `token:risk` engine per new candidate over your `--rpc-url` (cached with a 10-min
   TTL). Without `--rpc-url` risk stays missing and **no position can ever open** — the daemon says
   so instead of guessing.
4. Fetches a REAL Jupiter quote (SOL → token) sized at `--paper-spend-sol`.
5. Scores with strategy v2 under the profile's risk appetite.
6. Opens a PAPER position only when EVERY deterministic rule passes: no blocking reason, shadow
   `would_enter`, no strategy hard block, fresh quote, expected tokens known, capacity free, no
   duplicate open for the mint.
7. Marks every open position with a REAL sell-side quote (token → SOL) and evaluates the exit rules
   (stop-loss / trailing / take-profit / time / kill-switch). `--apply-exits` closes fired paper
   positions; without it, exits are journaled recommendations.
8. Persists `session.json`, `ledger.json` and `provider-health.json` EVERY loop; appends
   `candidates.jsonl`, `decisions.jsonl`, `positions.jsonl`, `exits.jsonl`.
9. On Ctrl+C (or duration end, or `--max-loops`), writes `summary.json` + `human-report.md`.

Useful flags: `--max-candidates-per-loop 5` (rate-limit hygiene), `--max-paper-positions`,
`--paper-spend-sol`, `--json`, `--force` (overwrite an existing session), `--max-loops` (bounded
proof runs).

Mode is structurally `paper` — `--mode live` (or anything else) is refused, and the persisted state
re-refuses any tampered mode on load.

## 2. Performance evidence

```
pnpm soulmaker live:sniper:paper:report --session runs/s109-paper-daemon \
  --out runs/s109-paper-daemon/performance.md
```

Reads `summary.json` + `ledger.json` and emits `live.paper.performance.report.v1` (+ Markdown):
funnel counts, realized PnL (KNOWN closes only — unknown is counted, never estimated), unrealized
PnL for marked open positions, max drawdown, best/worst trade, hold times, exit tallies, quote
stale rate, no-trade reasons, provider failures — and the edge verdict from a CLOSED set:

- `no-trades` — nothing opened; that is a result, not a failure.
- `insufficient-sample` — fewer than 20 closed PnL-known trades: INCONCLUSIVE, no claim either way.
- `no-edge-in-sample` — the sample lost money. Live frictions would make it worse.
- `possible-edge-unproven` — the sample made paper money; still NOT proof (optimistic fills, short
  window, no fees/MEV modeled). **`edge-proven` does not exist in the vocabulary.**

## 3. Strategy profiles

`conservative` (live default) / `balanced` (daemon default) / `aggressive-paper-only`. Each pins
liquidity floor, risk cap, spend, exits, quote TTL, slippage, position cap, source preferences,
risk appetite and — decisively — `liveEligible`. Rules enforced in code:

- `aggressive-paper-only` (and any profile with riskAppetite `aggressive`) can NEVER be
  live-eligible; a file claiming otherwise is refused.
- Live-gated commands default to `conservative` and refuse a paper-only profile.
- Every cap is bounded by the same hard ceilings the live policy enforces; invalid configs are
  refused, not clamped.
- Pass `--profile <name>` or `--profile path/to/profile.json` (validated against the closed
  `live.strategy.profile.v1` schema).

## 4. Hardened live-gated BUY prepare

```
pnpm soulmaker live:sniper:approve --operator you --confirm I-APPROVE-ONE-CANARY-RECOMMENDATION --out approval.json
pnpm soulmaker live:canary:prepare-buy --candidate-mint <mint> \
  --risk risk.json --quote quote.json --approval approval.json --policy policy.json \
  --spend-sol 0.005 --out-dir runs/s109-live-canary
```

REFUSES (exit 1, no artifact) unless every gate is green: ACTIVE approval (expired = refused),
FRESH quote (stale or unknown age = refused; mint cross-checked), clean risk (REJECT / critical
flag / over policy or profile cap = refused), canary-green live policy (the default policy blocks —
you must supply an explicit `live.policy.v1` with `live_canary` + `liveEnabled`), spend within the
MINIMUM of policy/escalation/profile ceilings, slippage within cap, live-eligible profile. On green
it writes `buy-review.json`, `buy-review.md` (exact risk, quote, amount, slippage, expected tokens,
max loss = the full spend) and the UNSIGNED `canary-request.json` for the Live Console.

## 5. Hardened live-gated SELL prepare + reconciliation

```
pnpm soulmaker live:canary:prepare-sell --ledger runs/positions.json --mint <mint> \
  --quote sell-quote.json --approval approval.json --policy policy.json --out-dir runs/s109-live-canary
```

Emits `sell-review.json` + `sell-review.md` (`live.canary.sell_request.v1`): expected SOL out and
an ESTIMATED PnL (labelled an estimate — never a result). BLOCKED (exit 1) on: unknown position,
closed position, unverified token balance (`tokenAmountRaw` missing — never invented), missing or
stale sell quote, wrong-mint quote, missing/expired approval, non-green policy. `--emergency`
produces a blocked review-only artifact with the exact manual Phantom steps.

```
pnpm soulmaker live:sniper:reconcile-position --ledger runs/positions.json --mint <mint> \
  --observed-token-amount-raw <raw> --observation-source phantom-ui
# or, honestly: --unknown  (the balance could not be read)
```

Verdicts: `matches` | `mismatch` | `unknown`. A paper position expects zero on-chain. A mismatch
tells you NOT to trust the ledger until resolved. Balances are never invented.

## 6. AI ranking proof

```
pnpm soulmaker live:sniper:rank --snapshot snap.json --ai --out ranking.json          # fallback-safe
pnpm soulmaker live:sniper:rank --snapshot snap.json --require-ai --out ranking.json  # proof mode
```

`--require-ai` exits 1 when the AI engine did not really run (missing key, provider failure) —
for proof runs that must show a real Anthropic call. Without it the deterministic fallback stays
the safe default. The clamp is unchanged either way: hard-blocked candidates stay excluded, invented
mints are dropped and logged, the artifact records engine / model / prompt version / inputs hash.

## 7. Operator dashboard

`pnpm run web:build`, then open `apps/web/public/sniper-dashboard.html`. New in S109: the big
posture banner (OFF / PAPER / DRY-RUN / LIVE-GATED / ARMED-CANARY), always-visible emergency
instructions, and read-only viewers for the daemon summary (no-trade reasons, provider health,
quote-stale warnings), the performance report, the position ledger, and the buy/sell review
artifacts. The dashboard still carries zero wallet code; signing lives only in the Live Console.

## 8. What to do next (operator checklist)

1. Run a 30–60 min paper daemon session on real data with `--rpc-url` + `--apply-exits`.
2. Generate the performance report. Read the edge verdict. Believe it.
3. Repeat across days/profiles until the sample is meaningful (≥ 20 closed trades per profile).
4. Only if the evidence justifies it: walk the S108 canary path (approve → prepare-buy → Live
   Console → Phantom) with the default 0.005 SOL micro-cap.
5. After any live canary: `live:canary:prepare-sell` for the exit review, sell in Phantom yourself,
   `live:sniper:reconcile` the close, `live:sniper:reconcile-position` the balance.

## 9. What remains unproven (honest status)

- **Edge is NOT proven.** No daemon session so far has produced ≥ 20 closed PnL-known paper trades;
  every verdict to date is `insufficient-sample` or `no-trades`.
- Paper fills are optimistic: fees, priority fees, failed transactions, slippage-at-fill and MEV
  are not modeled.
- No live buy or live sell has been executed through the S109 path; the unsigned artifacts and the
  refusal walls are proven, the Phantom send itself is a human step that has not been rehearsed
  end-to-end with real funds in this sprint.
- DexScreener profiles carry no liquidity/market data (reported as missing, never invented), so
  those candidates usually need the risk + quote stages to say anything.
