# SOL MAKER — RETURN AUDIT (Sprint 111, 2026-09-03)

Ground truth from the repository, git, gates, and live mainnet probes. Historical reports were NOT trusted.

## A. Repository ground truth

| Item | Value |
|---|---|
| Repo | `C:\Sol Maker` (main tree, on stale `sprint-6`, 2 harmless untracked files preserved) |
| Remote | `origin = https://github.com/slats55/Sol-Maker.git` (verified, fetched + pruned) |
| `origin/master` | `614cdf2` (2026-06-14) — **behind every live branch; nothing after S107-alpha was merged** |
| Lineage A | `5a65141` S107-P1 → `f58cd0f` S108-P2 → `579e054` S109-P3 (3 squashed commits, 2026-07-03). **Dropped `position.ts` + `sell-request.ts`.** |
| Lineage B | `252a026` (tree-identical to A:P1) → … → `8cd3835` sprint-final → `a44ea13` S109-continuous (11 commits, 2026-07-02). Has daemon, position ledger, sell path, DexScreener feed. |
| Local `sprint-110-…` | Points at `a44ea13`, zero commits — last human intent was to continue **B**. |
| **Chosen base** | **`a44ea13` (lineage B)** — only lineage with a positions ledger + sell path. A's unique bits (session-recorder, alerts) are cherry-pick candidates later. |
| Working branch | `sprint-111-return-live-mainnet-completion` in new worktree `.claude\worktrees\sprint-111-return` (no existing worktree touched). |
| Machine env | `NODE_ENV=production` was set globally → pnpm skipped devDeps → every TS gate falsely failed. Fixed by clearing for the session; **operator must unset it permanently**. No `.env`, no `soulmaker.config.json`, no keypair on this machine. |

## B. Quality gate status (base `a44ea13`)

| Gate | Result | Notes |
|---|---|---|
| `pnpm install --frozen-lockfile` | GREEN | 4s once NODE_ENV cleared |
| `pnpm run typecheck` | GREEN | 6s |
| `pnpm run lint` | GREEN | 17s, 0 warnings |
| `pnpm test` | GREEN | **308 test files**, all pass (17s). Unit-only; zero network tests. |
| `pnpm run web:build` | GREEN | static HTML |
| `pnpm run safety:scan` | GREEN | |
| `cargo check/test --workspace` | GREEN | 80 Rust tests |
| `git diff --check` | GREEN | |
| Live: mainnet RPC | GREEN | slot 444,065,761, solana-core 4.2.2, 214ms |
| Live: Jupiter quote (`lite-api.jup.ag/swap/v1`) | GREEN | real 0.005 SOL→BONK quote, 319ms |
| Live: `token:risk` on-chain | GREEN | mint/freeze authority read for real |
| Live: tx build + simulate | **NOT RUN** | needs a funded fee-payer pubkey (yours) |

## C / D. Reality check

| Capability | Status | Evidence | Missing |
|---|---|---|---|
| Discovery (Jupiter recent-tokens + DexScreener profiles, polling) | REAL + VERIFIED | S109 daemon ran 9 loops on real feeds | No websocket / log subscription; no Pump.fun/Raydium direct pool listener; poll ≥20s |
| Token inspection (`token:risk`, `--deep`) | REAL + VERIFIED | probe today | holder concentration only in `--deep`; no LP-lock check |
| Risk engine (floors, authority, caps) | REAL + VERIFIED | refusal walls fire on real data | enforced at prepare time, not at send time on mainnet (no send exists) |
| Strategy / scoring / profiles | REAL + UNVERIFIED | deterministic rules; 0 entries in S109 window | never produced a live entry |
| Quote (Jupiter lite) | REAL + VERIFIED | today | |
| Tx build (`execution:build --request mainnet-live`) | REAL + UNVERIFIED | code path exists | not exercised on mainnet |
| Simulation (`paper:simulation:tx`) | REAL + UNVERIFIED | code path exists | not exercised on mainnet |
| Signer (local keypair file) | REAL, **DEVNET-ONLY WIRED** | `signer.ts` refuses mainnet unless 14-gate armed; only devnet CLI commands load it | no mainnet loader call site |
| Send (`attemptExecution`) | REAL, **DISCONNECTED on mainnet** | only `execution:devnet:send` / `devnet:rehearse` call it | **no `execution:mainnet:send`** |
| Phantom "execution bridge" | PARTIAL / MANUAL | `live-console.html` calls `signAndSendTransaction` in the browser | human clicks; not automatable; not a bot |
| Confirmation | **MISSING** | send path says "submission is not confirmation" and stops | no `confirmTransaction`, no slot/status poll |
| Position persistence | PARTIAL | JSON ledger `live.position.ledger.v1` (file) | live positions are only created by a human after Phantom; no reconciliation of chain state at startup |
| Exit monitor (SL/TP/trailing/time) | REAL + VERIFIED (paper) | `evaluateExitRules` | live positions are **never auto-closed** by design |
| Sell execution | **MISSING** on mainnet | `prepare-sell` builds a review; human sells in Phantom | |
| Autonomous loop | **PAPER-ONLY** | `DAEMON_MODES = ["paper"]` | no live daemon mode |
| Crash recovery | MISSING | daemon state file exists; no startup chain reconciliation | |
| UI / command center | DISCONNECTED | 13 static HTML pages; no server, no polling, no WS | cannot answer "is the bot running?" live |
| Kill switch | REAL (config/env/file) | read by policy + gate | not consulted mid-flight by any live loop (none exists) |
| Rust engine | REAL (scoring/sim classification) | 80 tests | not on the execution hot path |

## E. Current end-to-end path

```
Feeds (poll) → Dedupe → token:risk → Jupiter quote → Score/Profile → [PAPER open] → mark → exit rule → [PAPER close]
                                                        ↓ (live)
                                            prepare-buy (unsigned request.json)
                                                        ↓  ✗ BROKEN HANDOFF: human must open live-console.html
                                                 Phantom signAndSend (browser)
                                                        ↓  ✗ BROKEN HANDOFF: human pastes signature
                                          live:sniper:reconcile (facts typed by human)
                                                        ↓  ✗ NO auto-confirm, NO auto-sell, NO restart reconcile
```

## F. Blockers to REAL trading

**P0 — launch blockers**
1. No mainnet send command: signer + `attemptExecution` are never assembled for mainnet.
2. No confirmation step after submit (signature → status/slot → token balance delta).
3. No live sell execution.
4. No startup reconciliation (chain truth vs ledger).

**P1 — required today**
5. Daemon has no live mode; live positions cannot auto-exit.
6. UI has no live data path (needs a tiny local status server or file-polling page).
7. Operator config/keypair/env not present; `NODE_ENV=production` poisons the toolchain.

**P2 — hardening**: WS-based discovery, priority-fee/CU tuning, quote-refresh-before-send, retry-with-fresh-blockhash, per-hour trade cap.
**P3 — future**: strategy quality, latency, multi-DEX direct routing.

## G. Today's roadmap (slices)

| Slice | Files | Behavior | Gate |
|---|---|---|---|
| 1 `execution:mainnet:send` | `packages/execution/src/{send,confirm}.ts`, `apps/cli/src/commands.ts` | assemble 14-gate + safety controls + signer + submit + **confirm** (status poll, slot, token delta) → write `execution.attempt` + `live.position` (`live_canary`, `open`) **only on confirmed** | unit tests: failed submit ⇒ no position; unconfirmed ⇒ `submitted_unconfirmed` state; Gate C sim green |
| 2 `execution:mainnet:sell` | `packages/live/src/sell-request.ts`, new `sell-execute.ts` | quote token→SOL, build, sim, send, confirm, close position with realized PnL | unit tests + Gate E |
| 3 reconcile-on-start | `packages/live/src/reconcile-startup.ts` | at daemon start: read wallet token accounts, match to ledger, flag orphans / phantom positions | tests |
| 4 live daemon mode | `packages/live/src/daemon.ts`, `sniper-loop.ts` | `--mode live` behind arming; runs slices 1–3 inside loop with caps + kill switch each tick | tests + Gate F (operator-triggered) |
| 5 live status server + UI | `apps/web/src/live/status-server.ts`, `sniper-dashboard.ts` | `pnpm soulmaker live:ui` serves dashboard + `/api/state` from run dir; page polls every 2s | manual |
| 6 operator setup | `.env.example`, `docs/S111_OPERATOR_RUNBOOK.md` | exact commands | |

## H. Definition of DONE — realistic for today

```
REAL MAINNET BUY:      CODE YES / PROVEN NO  — you must run Gate D with your keypair + funds
REAL MAINNET SELL:     CODE YES / PROVEN NO  — same, Gate E
AUTONOMOUS ENTRY:      YES (after slice 4), PROVEN NO — Gate F is operator-triggered
AUTONOMOUS EXIT:       YES (after slice 4), PROVEN NO
PERSISTENT POSITIONS:  YES (ledger exists; slice 3 adds chain reconcile)
OPERATOR UI:           YES (after slice 5)
EMERGENCY STOP:        YES (kill-switch file/env; slice 4 checks it every tick)
```

Every NO is the same reason: I will not sign, arm, or broadcast with your funds. The code path will be complete and simulated; the first real signature is yours to produce.
