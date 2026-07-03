# S109 — S108 Extension Audit (pre-sprint safety check)

Date: 2026-07-02 (S109 session). Audited at commit `8cd3835a2467dc76f69b0e460104fd945a40fdb7`
(branch `sprint-final-real-sniper-execution-rc`, the S108 tip; **not merged to master** — master is
`614cdf24816bb8f6a8f9327bcbb14b596e7d8d6e`, an ancestor, so S108 fast-forwards cleanly).
S109 branches from the S108 tip: `sprint-109-continuous-sniper-proof-canary-hardening`.

This audit was performed by reading the code (not the docs) before extending it. Every claim below
names the file that proves it.

## Baseline gates on the S108 tip (all green before any S109 change)

| Gate | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm run typecheck` | PASS |
| `pnpm run lint` | PASS (0 warnings) |
| `pnpm test` | PASS — 4576 passed / 16 skipped (301 files) |
| `pnpm run web:build` | PASS (11 pages + live console + sniper dashboard) |
| `pnpm run safety:scan` | PASS (794 tracked text files, clean) |
| `cargo test --workspace` | PASS |

## What S108 actually added (5 commits over master)

- `252a026` — S107 Part 1: Phantom-signing live execution bridge (`packages/live`: policy,
  chain-adapter, canary-request, canary-state, candidate-score, perf; CLI `live:policy:inspect`,
  `live:chains`, `live:kill-switch`, `live:canary:prepare`, `live:session:report`; web Live Console).
- `2e5335f` — S107B docs-only QA pack + Part 2/3 build plans + safety audit.
- `fd3ffe3` — S108 Part 2: autonomous sniper loop (discovery, strategy v2, escalation, sniper-loop,
  paper-shadow, quote-refresh) + **time-boxed operator approval** replacing the refused `--armed`
  boolean; CLI `live:sniper:{policy,discover,shadow,run,approve,session}`.
- `fa350dc` — S108 exits + positions ledger (`position.ts`) + clamped AI decision layer
  (`ai-ranker.ts`, `ai-provider.ts`); CLI `live:sniper:{rank,paper:open,positions,emergency,reconcile}`;
  web sniper dashboard.
- `8cd3835` — S108 runbook (`docs/LIVE_SNIPER_CANARY_RUNBOOK.md`).

## Safety invariants verified intact (file:evidence)

1. **Operator approval TTL system intact** — `packages/live/src/operator-approval.ts`: exact confirm
   phrase `I-APPROVE-ONE-CANARY-RECOMMENDATION` required (mismatch refused), TTL ceiling 15 min
   (over-ceiling REFUSED, never clamped), `expiresAt` derived (hand-widened windows refused by
   `validateOperatorApproval`), `evaluateOperatorApproval` re-derives active/expired from caller
   `nowMs`. An expired approval is exactly as powerless as none.
2. **`--armed`-style bypass is gone** — grep over `apps/cli/src` + `packages/live/src`: the string
   `--armed` appears only in comments describing its refusal. `live:sniper:run` arms the escalation
   session ONLY through `--approval <path>` to a validated, unexpired `live.operator.approval.v1`
   (`apps/cli/src/live-sniper-commands.ts:487-492`).
3. **Phantom-only signing remains true** — `packages/live/src/policy.ts`:
   `LIVE_WALLET_PROVIDERS = ["phantom"]`; `evaluateLivePolicy` blocks `wallet-provider-not-phantom`.
   The canary request pins `walletProvider: "phantom"`, `signed: false`, `submitted: false`,
   `backendCustodiesNoKeys: true` (`canary-request.ts`).
4. **Live disabled by default** — `buildLivePolicy` defaults `mode: "paper"`, `liveEnabled: false`;
   `evaluateLivePolicy` blocks `live-disabled` + `mode-not-live` unless explicitly configured.
5. **No private key handling** — grep for `Keypair|secretKey|signTransaction|sendTransaction` in
   `packages/live/src`: hits are only red-team tests proving a `secretKey`-named field is REFUSED by
   the closed-schema validators. The package has no signer, no sender, no RPC write path.
6. **Canary cap hard-ceilinged** — `LIVE_HARD_CEILINGS` (max trade 0.05 SOL, slippage 300 bps,
   risk cap 50) in `policy.ts`; caps only tighten (over-ceiling REFUSED). Escalation ceilings
   (`escalation.ts`): 0.05 SOL/canary, 3/session, 5/day, 30s cooldown floor. The position ledger
   applies the same spend ceiling to PAPER positions (`position.ts: POSITION_SPEND_CEILING_LAMPORTS`).
7. **AI ranking cannot bypass deterministic safety** — `ai-ranker.ts`: hard-blocked candidates are
   excluded from the eligible set BEFORE the AI sees anything (`buildRankingFacts`); `clampRanking`
   discards AI rankings of blocked mints (recorded in `aiAttemptedOverride`), drops invented mints,
   appends omissions deterministically; malformed AI output is rejected whole and the deterministic
   fallback runs. AI failure never blocks (exit 0).
8. **Phase-7 authorization verdict remains design-only** — S108 did not touch
   `packages/execution`'s Phase-7 audit; the canary request pins `phase7LiveTradingReady: false`
   as a validated literal (`canary-request.ts:343`). No mainnet send surface was added; the only
   send-capable command remains `execution:devnet:send`.
9. **Live surfaces discoverable + documented** — all `live:*` commands registered in
   `apps/cli/src/index.ts` (lines 3975–4424) with refusal-first descriptions; documented in
   `docs/LIVE_EXECUTION_PHANTOM.md` + `docs/LIVE_SNIPER_CANARY_RUNBOOK.md`.
10. **Branch state** — the older `sprint-107-final-live-part1-phantom-execution-rc` and
    `sprint-108-final-live-part2-autonomous-sniper-rc` branches hold a single superseded commit
    (same subject as `252a026`, different SHA) and are fully contained in the S108 branch's history;
    no unmerged predecessor work is lost by building on `sprint-final-real-sniper-execution-rc`.

## What S109 will safely extend

- **Continuous paper daemon** (`live:sniper:daemon`): multi-loop orchestration OVER the existing
  pure pipeline (discovery → risk → quote → strategy → paper positions → exits). Network adapters
  reuse the proven read-only `@soulmaker/realtime` (Jupiter recent tokens) + `@soulmaker/quotefetch`
  (Jupiter lite quotes). Paper mode only; no new send surface.
- **Paper performance evidence** (`live:sniper:paper:report`): pure computation over daemon
  artifacts; honest edge verdict (small sample → inconclusive).
- **Buy canary hardening** (`live:canary:prepare-buy`): the existing `live:canary:prepare` builder
  plus MANDATORY operator approval (TTL-evaluated), fresh-quote refusal, spend/slippage refusals,
  and an operator review artifact (json+md). Still unsigned-only.
- **Sell side** (`live:canary:prepare-sell`, `live:sniper:reconcile-position`): a new UNSIGNED sell
  request artifact + honest position reconciliation (unknown stays unknown).
- **Second detection source**: a DexScreener read-only adapter in `@soulmaker/realtime` following
  the existing closed-status adapter contract.
- **Strategy profiles** (`live.strategy.profile.v1`): conservative / balanced /
  aggressive-paper-only; aggressive is structurally live-ineligible.
- **AI proof hardening**: `--require-ai` (fail loud when AI unavailable instead of silent fallback),
  example artifacts.
- **UI**: daemon session viewer + banner states on the existing static dashboard.

## What must NOT be weakened (S109 contract)

- No new flag may arm anything; approval stays an expiring artifact created by typing the phrase.
- `LIVE_HARD_CEILINGS`, escalation ceilings, and the approval TTL ceiling are untouchable.
- `loopModeCanTrade` stays `false` for every mode; the daemon adds NO trading mode.
- The backend still never signs, sends, or custodies a key; sell-side is unsigned-request-only.
- AI stays advisory + clamped; `--require-ai` may only make AI failure LOUDER, never softer.
- The aggressive profile can never be live-eligible; live-gated paths default to conservative.
- No profitability claims: every new artifact pins `notProfitabilityClaim: true`.

## Commands/files inspected for this audit

`git log/diff origin/master..origin/sprint-final-real-sniper-execution-rc`;
`packages/live/src/{index,policy,operator-approval,discovery,strategy,position,sniper-loop,quote-refresh,ai-ranker,canary-request,escalation}.ts`;
`apps/cli/src/{live-commands,live-sniper-commands,ai-provider,index,cli-reference.test}.ts`;
`packages/realtime/src/{types,jupiter-recent}.ts`; `packages/quotefetch/src/jupiter.ts`;
grep sweeps for `--armed`, `Keypair|secretKey|signTransaction|sendTransaction`,
`phase7LiveTradingReady`; baseline gate runs listed above.
