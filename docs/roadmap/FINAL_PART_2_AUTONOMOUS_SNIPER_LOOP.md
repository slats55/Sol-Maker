# Final Build — Part 2 of 3: Autonomous Sniper Loop (Solana)

> **Build plan / checklist only. Not implemented in this lane.** This document describes how to
> build the real-time autonomous Solana memecoin sniper *loop* on top of the existing paper/dry-run
> stack, while keeping every send **manually armed and human-approved**. It does **not** add
> autonomous real trading, and it must not be implemented in the same session that builds Part 1
> (Phantom + live execution).

| Field | Value |
| --- | --- |
| Depends on | **Part 1** (Phantom connect + live execution bridge + live policy gates + canary path) merged and audited |
| Base SHA (plan written against) | `614cdf2` |
| Target chain | **Solana only.** Multi-chain is Part 3 (adapter planning). |
| Safety stance | Loop discovers/scores/watches autonomously; **sending stays manual-arm + per-trade human approval**. |

---

## 0. Guardrails for Part 2 (do not regress Part 1)

- The loop **never** sends without (a) an armed session and (b) per-trade human approval. The
  autonomous part is *discovery, scoring, watching, and preparation* — not unattended execution.
- The loop **reuses** the existing fourteen-condition gate, signer boundary, send path, kill switch,
  and reconciliation wall verbatim. It adds inputs to them; it never weakens or bypasses them.
- "Live canary escalation" means *promoting a candidate into the manual canary checklist*, not
  auto-firing a trade.
- Every loop output is an artifact with the existing redaction guarantees and `liveSendStatus`/
  `phase7LiveTradingReady` pins.

---

## 1. Architecture overview

```
                 ┌──────────────────────────────────────────────────────────┐
                 │                  Autonomous Sniper Loop                    │
                 │  (bounded, journaled, kill-switch-aware, paper by default) │
                 └──────────────────────────────────────────────────────────┘
 realtime feed ─▶ candidate ingestion ─▶ risk/anti-rug filter ─▶ scoring/ranking
   (Part: A)          (B)                      (C)                    (D)
        │                                                              │
        ▼                                                              ▼
  provider failover (E) ◀── quote refresh loop (F) ◀──────────  watchlist generation (G)
        │                                                              │
        ▼                                                              ▼
  latency tracking (H) ───────────────▶  paper shadow mode (I)  ──▶ manual arming (J)
                                                                      │
                                                                      ▼
                                                       live canary escalation (K)
                                                  (human approves each send via Part 1)
```

Each lettered stage maps to a build slice below.

---

## 2. Build slices

### A. Real-time pool / mint discovery
- **Goal:** a continuous, bounded feed of newly-launched mints / pools.
- **Build on:** `@soulmaker/realtime` (already has `jupiter-recent-tokens` + replay →
  `realtime.candidates.snapshot.v1`) and `@soulmaker/quotefetch` (live Jupiter).
- **Add:** a long-running, bounded watch that emits snapshots on an interval, with backpressure and
  a hard per-tick item cap. Sources behind an interface so a second discovery source (e.g. a
  pool-creation log subscription) can be added without touching consumers.
- **Safety:** read-only; no signer; bounded memory; journaled to `runs/` (gitignored).

### B. Candidate ingestion pipeline
- **Goal:** normalize raw feed items into the existing candidate shape, de-duplicate by mint, and
  drop malformed/secret-shaped entries.
- **Build on:** the existing candidate-list + `sniper.preflight.input.v1` bridge (token inspect/risk
  paired by mint).
- **Add:** a streaming normalizer with a dedupe window and an explicit "rejected at ingestion"
  reason set. Cross-kind / unknown-mint / duplicate / secret-shaped items are refused (the existing
  preflight-input rules already model this).

### C. Anti-rug / risk filter loop
- **Goal:** apply deep read-only risk checks continuously and gate candidates out early.
- **Build on:** `@soulmaker/risk` + `@soulmaker/solana` deep checks (holder concentration, metadata
  mutability, liquidity depth, freeze/mint authority, Token-2022 extensions).
- **Add:** a per-candidate risk refresh with cache + TTL; a hard-flag set that removes a candidate
  from the watchlist regardless of any score. A REJECT is terminal for that candidate this session.

### D. Scoring / ranking loop
- **Goal:** rank surviving candidates by the existing sniper score.
- **Build on:** Rust `engine sniper-score` → `engine.sniper.score.report.v1` with the TS parity
  wall, and `sniper.score.input.v1`.
- **Add:** a ranking pass over the live set with stable tie-breaking; honest `insufficient-evidence`
  when inputs are missing; a score never overrides a hard risk flag.

### E. Provider failover
- **Goal:** survive a single provider/RPC outage without a silent or fake result.
- **Build on:** `@soulmaker/quotefetch` and `@soulmaker/solana` RPC client (read-only).
- **Add:** a provider registry with health checks, ordered failover, and a recorded "which provider
  served this" field. **All providers down → BLOCKED + honest artifact**, never a fabricated quote.
- **Tests:** PF-1/PF-2/PF-3 in the test gap matrix.

### F. Quote refresh loop
- **Goal:** keep quotes fresh for watchlisted candidates and feed the freshness gate.
- **Build on:** `@soulmaker/quotefetch` (`routequote.fetch.report.v1`) + core
  `evaluateQuoteFreshness` + Rust `engine quote-score`.
- **Add:** an interval refresh with an explicit max-age; a stale quote excludes a candidate from any
  escalation and feeds gate condition #9.

### G. Watchlist generation
- **Goal:** an ordered, bookkeeping-only watchlist of candidates worth attention.
- **Build on:** existing `sniper.watchlist.v1` (`paper:sniper:watchlist:prepare`) — note
  `statusIsNotTradeReadiness` is pinned; status is **not** readiness.
- **Add:** continuous watchlist updates from the ranking loop; entries carry score, risk verdict,
  quote freshness, and provider — all advisory.

### H. Latency tracking
- **Goal:** measure end-to-end loop latency honestly (feed → ingest → risk → score → quote →
  watchlist), including provider latencies.
- **Add:** a latency report artifact (`*.latency.report.v1`) with per-stage timings; **honest
  "timing-unavailable"** where a clock isn't available (the codebase already models honest
  timing-unavailable in the web command center). No fabricated numbers.

### I. Paper shadow mode
- **Goal:** run the entire loop in paper, recording what it *would* have done, with zero send
  capability.
- **Build on:** existing dry-run campaign (`sniper.dryrun.campaign.v1`,
  `paper:sniper:campaign:run`) — per-candidate verdict re-derived, `liveSendStatus: "disabled"`.
- **Add:** a continuous shadow runner that produces a campaign artifact per tick; this is the
  default mode and the benchmark for live behavior.

### J. Manual arming model
- **Goal:** the only path to a real send is an explicit, time-boxed human arm + per-trade approval.
- **Build on:** Part 1's live arming + the fourteen-condition gate + Phantom per-trade approval.
- **Add:** the loop can *propose* an armed candidate but cannot arm itself; arming is a human action
  with a TTL; disarm + kill switch are always one action away.

### K. Live canary escalation
- **Goal:** promote a top-ranked, risk-clean, fresh-quote candidate into the **manual canary
  checklist** ([QA Pack §9](../live/LIVE_READINESS_QA_PACK.md#9-canary-trade-checklist)).
- **Hard rule:** escalation prepares evidence and surfaces the candidate; a human still approves the
  canary send through Part 1. No auto-fire. No "large" trading ever in this part.

---

## 3. Exact modules likely to touch (after Part 1 lands)

**New (Part 2):**
- `packages/sniper/src/loop-*.ts` — the orchestrated loop (bounded, journaled).
- `packages/realtime/src/*` — interval/bounded watch additions + a second discovery source behind an interface.
- `packages/quotefetch/src/*` — provider registry + failover (read-only).
- New schemas: `sniper.loop.tick.v1`, `sniper.loop.latency.report.v1`, `provider.health.report.v1`
  (closed sets; redaction-safe; `liveSendStatus` pinned where relevant).

**Reused unchanged (do not modify the live core):**
- `packages/execution/src/{live-gate,send,signer,modes,safety-controls,reconciliation,session}.ts`
- `packages/risk/*`, `packages/solana/*` (read-only), `crates/solmaker-engine/*` (parity).

**Touch with care (Part 1 may also touch):**
- `apps/web/*` live command center — coordinate; Part 2 adds *read-only loop views*, not send UI.
- `apps/cli/src/commands.ts` — append new `paper:sniper:loop:*` commands; keep mainnet-literal-free.

---

## 4. CLI needs (all paper/observe by default)

- `paper:sniper:loop:shadow` — run the loop in paper shadow mode, bounded, → campaign + latency artifacts.
- `paper:sniper:loop:watch` — discovery + ingestion + risk + score + watchlist, no escalation.
- `paper:provider:doctor` — provider health + failover preview (read-only).
- `paper:sniper:loop:latency` — render the latency report.
- (No `*:arm` or `*:send` command in Part 2 — arming/sending remain Part 1's gated, human surface.)

---

## 5. UI needs

- A **read-only loop dashboard**: live watchlist, per-candidate score/risk/quote/provider, latency
  per stage, provider health, kill-switch state.
- Honest empty/insufficient/timing-unavailable states (match the existing command center).
- A clear visual wall between "the loop is watching" and "a human is arming/approving a send."
- No send affordance in Part 2 UI — escalation links to Part 1's manual canary flow.

---

## 6. Rust acceleration opportunities

The Rust engine already does realtime-normalize, quote-score, sim-classify, tx-inspect, and
sniper-score with TS parity walls. Part 2 can extend Rust for the **hot loop**:
- Bulk candidate normalization + dedupe over a snapshot batch (Rust `realtime-normalize` exists —
  extend to streaming batches).
- Bulk scoring/ranking over the live set (engine `sniper-score` exists — add a batch ranking entry).
- Keep the rule: **Rust does no network, no signer, no send**; TS re-derives and the parity wall
  must agree. Engine reads no clock/env (orchestrator passes `--created-at`).

---

## 7. Tests required (see test gap matrix for IDs)

- Loop is **bounded** (terminates on tick cap / time cap / kill switch) — no runaway.
- Dedupe window correctness; ingestion refusals (cross-kind/unknown-mint/duplicate/secret-shaped).
- Risk filter removes hard-flagged candidates regardless of score (RD-2).
- Ranking stability + `insufficient-evidence` honesty.
- Provider failover: outage → failover → recorded provider; all-down → BLOCKED (PF-1/2/3).
- Quote refresh excludes stale candidates (SQ-1/2/3).
- Shadow mode produces a valid campaign artifact every tick; `liveSendStatus: "disabled"`.
- Escalation **cannot** trigger a send; it only prepares the manual canary evidence.
- Latency report never fabricates timings (honest timing-unavailable).
- Kill switch mid-loop halts discovery and any in-flight preparation; reconciliation if anything
  was armed.

---

## 8. Expected artifacts

| Artifact | Schema (proposed) | Notes |
| --- | --- | --- |
| Loop tick | `sniper.loop.tick.v1` | one per interval; watchlist + provider + timings |
| Latency report | `sniper.loop.latency.report.v1` | per-stage timings; timing-unavailable honest |
| Provider health | `provider.health.report.v1` | per-provider status + which served |
| Shadow campaign | `sniper.dryrun.campaign.v1` (reuse) | per-candidate verdict, `liveSendStatus: disabled` |
| Watchlist | `sniper.watchlist.v1` (reuse) | bookkeeping-only |
| Canary escalation evidence | bundle of the above + score/quote/risk/sim | feeds the manual canary checklist |

---

## 9. Definition of done (Part 2)

- [ ] The loop runs in **paper shadow** continuously, bounded, journaled, kill-switch-aware.
- [ ] Discovery → ingestion → risk → score → quote → watchlist all produce validated artifacts.
- [ ] Provider failover proven (outage + all-down) with honest artifacts.
- [ ] Latency reporting is honest (no fabricated timings).
- [ ] Escalation reaches the **manual** canary checklist and can never auto-send.
- [ ] All new safety/test items in §7 pass; the live core is unchanged.
- [ ] Full gates green; safety audit re-run clean; no new override/bypass anywhere.

*Part 2 makes the loop autonomous in discovery and preparation. It does not make trading
autonomous. Profit is never claimed or guaranteed.*
