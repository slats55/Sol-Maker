# S109 Proof Evidence — real runs, exact commands, honest numbers

Date: 2026-07-03 (UTC timestamps below are from the artifacts). All artifacts live under the
gitignored `runs/` folder on the operator machine; this document records the commands and the
numbers verbatim. Nothing here is a profitability claim.

## 1. Continuous paper daemon — REAL market session

```
pnpm soulmaker live:sniper:daemon --mode paper --duration-minutes 3 --poll-seconds 20 \
  --out-dir runs/s109-paper-daemon --profile balanced \
  --rpc-url https://api.mainnet-beta.solana.com --apply-exits --max-candidates-per-loop 3
```

Result (`runs/s109-paper-daemon/summary.json`, schema `live.sniper.daemon.summary.v1`):

- Session 2026-07-03T01:59:07Z → 02:01:53Z, **9 loops**, ended by `duration-elapsed`, exit 0.
- **504 candidate observations** from the two REAL feeds; **107 unique** after cross-loop dedupe
  (397 duplicates skipped) — live pump.fun launches (mint suffix `…pump`) plus DexScreener profiles.
- **27 real `token:risk` checks** over the public mainnet RPC (0 REJECT among them this window).
- **10 real Jupiter quotes** fetched (0 stale, 0 unavailable).
- **17 liquidity rejections** with real dollar figures (e.g. `liquidity-below-floor
  (2538.83… < 10000)`) — the balanced profile's floor firing on real market data.
- **0 paper positions opened** — the deterministic entry rule passed for no candidate in this
  window (`shadow-would-enter` failed 26×; brand-new launches score `watch`). That is the honest
  outcome, not a failure.
- Provider health: `jupiter-recent-tokens` 9/9 observed, `dexscreener-token-profiles` 9/9 observed,
  0 failures, 0 backoffs.

## 2. Performance evidence

```
pnpm soulmaker live:sniper:paper:report --session runs/s109-paper-daemon \
  --out runs/s109-paper-daemon/performance.md
```

Verdict: **`no-trades`** — "No paper positions were opened this session — there is nothing to
evaluate. That is a result, not a failure." Realized PnL 0; funnel table matches the summary above.

## 3. Live-gated BUY — green path with a REAL quote

```
# real risk (mainnet):   token:risk BONK → score 0, PASS_FOR_PAPER_EVALUATION,
#                        freeze+mint authority renounced (runs/s109-live-canary/bonk-risk.json)
# real quote (Jupiter):  5,000,000 lamports → 9,212,626,162 BONK raw, impact 0
pnpm soulmaker live:canary:prepare-buy --candidate-mint DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263 \
  --symbol BONK --risk …/bonk-risk.json --quote …/bonk-quote.json --approval …/approval.json \
  --policy …/policy-live.json --spend-sol 0.005 --out-dir runs/s109-live-canary
```

Exit 0. Quote age at prepare: **1816ms** (TTL 8000ms). Approval active (585s left). Request state
`quote_ready` (honest: `preflight_ready` requires a green simulation). Wrote `buy-review.json`,
`buy-review.md`, `canary-request.json` — the request pins `signed:false / submitted:false`;
nothing was sent.

## 4. Live-gated BUY — the five refusal walls (all exit 1, real artifacts)

| Wall | Exact refusal |
| --- | --- |
| Stale quote | `Refusing: the quote is STALE (21810ms old > TTL 8000ms) — fetch a fresh quote and retry.` |
| Missing approval | `Refusing: --approval is required (create one with live:sniper:approve; there is no flag substitute).` |
| Expired approval | `Refusing: the operator approval is not active (approval-expired) — create a fresh one with live:sniper:approve.` |
| Excessive spend (0.02 SOL, fresh quote) | `Refusing: spend 0.02 SOL exceeds the effective canary ceiling 0.005 SOL (min of policy 0.005, escalation 0.005, profile 0.005).` |
| Disabled live policy | `Refusing: the live policy does not allow arming a canary: live-disabled, mode-not-live, wallet-provider-not-phantom.` |

## 5. Live-gated SELL + reconciliation

- Unknown position (against the real daemon ledger): `Refusing: no open position for mint … exists
  in the ledger — an unknown position can never be sold.` (exit 1)
- Rehearsal sell review over a REAL round-trip quote (paper BONK position, 9,212,626,162 raw):
  real sell-side quote returned **4,990,997 lamports** for the 5,000,000-lamport entry →
  `REVIEW_READY`, estimated PnL **−9,003 lamports (−0.18%)** labelled "estimate only" — the real,
  measured round-trip friction (spread + impact) of an instant in-and-out.
- Reconciliation: `--unknown` → verdict `UNKNOWN` ("the on-chain state is honestly unknown");
  observed `0` for the paper position → verdict `MATCHES` (a paper position expects zero on-chain).

## 6. AI ranking proof (no ANTHROPIC_API_KEY in this environment)

```
pnpm soulmaker live:sniper:rank --mint So111… --ai --out runs/s109-ai-ranking.json   # exit 0
pnpm soulmaker live:sniper:rank --mint So111… --require-ai                           # exit 1
```

- Fallback: `engine: deterministic-fallback`, inputs sha256-128 recorded, honest caveat
  `ai-unavailable: ANTHROPIC_API_KEY is not set — deterministic fallback used`.
- Proof mode: `Refusing: --require-ai was set but the AI engine did not run (ANTHROPIC_API_KEY is
  not set)…` — exit 1. A real-provider run remains to be captured when a key is present.

## 7. UI

`pnpm run web:build` green. `sniper-dashboard.html` verified in a real browser: posture banner
(OFF/PAPER/DRY-RUN/LIVE-GATED/ARMED-CANARY) renders and switches, emergency instructions visible,
S109 viewers present, **zero console errors/warnings**.

## What this does and does not prove

Proven: continuous real-data monitoring, cross-loop dedupe, real risk + quote integration, honest
no-trade decisions, provider health, every buy/sell refusal wall, unsigned-only artifacts, honest
reconciliation, AI fallback + loud proof mode.

NOT proven: any trading edge (verdict `no-trades` — the entry rule opened nothing in a 3-minute
window; longer sessions are required), live buy/sell execution (nothing was sent — by design), AI
ranking against the real Anthropic API (no key in this environment), paper PnL under live frictions.
