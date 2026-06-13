# S104 Controlled Micro-Trade — Design Plan (DESIGN ONLY)

**Status: DESIGN ONLY. This document implements nothing. It opens no live path, registers no
command, and authorizes no trade.** It is the forward-looking plan for a *future, separately
authorized* Sprint 104 controlled mainnet micro-trade. Live trading stays **DISABLED**; the
fourteen-condition live gate stays **default-blocked**. No mainnet send surface exists, and this plan
does not add one.

This plan is the companion to [`PHASE7_AUTHORIZATION_DOSSIER.md`](PHASE7_AUTHORIZATION_DOSSIER.md)
(§§9–12), [`EXECUTION_SAFETY.md`](EXECUTION_SAFETY.md),
[`PHASE7_LIVE_EXECUTION_GATE.md`](PHASE7_LIVE_EXECUTION_GATE.md), and
[`PHASE7_LIVE_SEND_DESIGN_REVIEW.md`](PHASE7_LIVE_SEND_DESIGN_REVIEW.md). Nothing here supersedes
them; it refines the §12 micro-trade safety proposal into a concrete, reviewable build plan that a
human can approve (or reject) *before* any code is written.

> **The proposed command names below are PROPOSALS, written in prose for a future sprint. None of
> them is registered in the CLI today, and S104 must not register any of them without the explicit,
> written authorization described in §1.** This is deliberately documented so the plan can be
> reviewed without any executable surface changing.

---

## 0. Where the repo stands today (Sprint 103-C)

- **Real devnet broadcast: PROVEN.** A funded throwaway devnet key drove the full
  fund → build → simulate → send → confirm → reconcile chain to a confirmed, finalized devnet
  broadcast (devnet slot `469219488`, reconciliation verdict `reconciled`). See the dossier §6.
- **Phase 7 audit: `authorized-for-design-only`.** Fourteen gates verified; all safety invariants
  verified; the **devnet-broadcast-confirmed** micro-trade prerequisite is now **MET**.
- **Remaining blocker: the written human Phase 7 sign-off** (`paper:phase7:signoff:template` →
  `signed-for-controlled-microtrade`). Until it exists, the audit verdict cannot advance past
  `authorized-for-design-only`, and S104 cannot begin.

S104 is therefore **not unblocked**. It is *one human sign-off and one explicit authorization away
from being designable* — not from being executed.

---

## 0.5 The S104 micro-trade PREFLIGHT harness (BUILT in Sprint 104-A — NO-SEND)

Sprint 104-A added a **read-only preflight harness** that answers one question and only that question:
*if a human later gives a separate, explicit S104 execution authorization, are the required structural
inputs already present?* It is the safe, repeatable "are we ready to be *considered*?" check — it
**executes nothing**.

- **Artifact:** `phase7.microtrade.preflight.v1` (in `@soulmaker/execution`) — a pure builder/validator.
  `mode` is pinned `controlled-mainnet-microtrade-preflight`, `network` `mainnet-beta`,
  `liveExecutionAuthorized` / `authorizesLiveTrading` false, `neverSends` / `neverSigns` /
  `notExecutable` true, `requiresSeparateExecutionApproval` true, `phase7LiveTradingReady` false. The
  closed schema refuses any send result or signature; the burner wallet is validated as a 32-byte
  **public** key only (a secret key is refused before it is ever decoded).
- **Command:** `paper:phase7:microtrade:preflight` — reads and strictly validates the Phase 7 audit,
  the sign-off record, the mainnet dry-run release candidate, and the devnet reconciliation; validates
  a public burner wallet and a bounded `--max-spend-sol` (≤ the micro ceiling and ≤ the signed cap);
  requires a `--manual-confirmation-label`. It never signs, never sends, never loads a private key, and
  registers **no mainnet send surface**.

```
pnpm soulmaker paper:phase7:microtrade:preflight \
  --phase7-audit runs/audit.json \
  --sign-off-record runs/signoff.json \
  --release-candidate runs/release-candidate.json \
  --devnet-reconciliation runs/reconciliation.json \
  --burner-wallet <PUBLIC_KEY> \
  --max-spend-sol 0.01 \
  --manual-confirmation-label "operator confirms the single trade by hand" \
  --json
```

The verdict is **re-derived from the structured statuses** (the release candidate's verdict is itself
re-derived from stage evidence, never a candidate score), in precedence order:
`blocked-missing-signoff` → `blocked-missing-devnet-proof` → `blocked-missing-release-candidate` →
`blocked-risk` → `blocked-quote` → `blocked-simulation` → `blocked-missing-burner-wallet` →
`blocked-missing-manual-confirmation` → `ready-for-separate-execution-authorization`.

**`ready-for-separate-execution-authorization` is the BEST possible verdict, and it authorizes
nothing.** It means every structural input is present — never that a trade is approved, never that live
trading is enabled. Reaching it does **not** start S104: entry condition #6 below (a separate, explicit,
written user authorization) still applies, as does the fourteen-condition live gate and a reviewed
execution sprint. On this repo today the preflight reports `blocked-missing-signoff` — the written human
Phase 7 sign-off is the only open prerequisite.

---

## 1. Required entry conditions (ALL must hold before S104 may begin)

S104 must not start — not even as code — until every one of these is independently true:

1. **Real devnet broadcast confirmed** — a `execution.devnet.rehearsal.report.v1` with
   `outcome: rehearsed` and a confirmation slot. *(Met in S103-C.)*
2. **Devnet reconciliation verdict `reconciled`** — a `execution.reconciliation.report.v1` on
   `devnet` with `verdict: reconciled` and a present signature. *(Met in S103-C.)*
3. **Written human Phase 7 sign-off** — a `phase7.human_signoff.record.v1` with status
   `signed-for-controlled-microtrade`, produced only by a human supplying every required
   acknowledgement, an operator label, a signed-at label, and a bounded `--max-spend-sol`. *(Open.)*
4. **Audit verdict `ready-for-separate-microtrade-authorization`** — re-run
   `paper:phase7:authorization:audit --devnet-reconciliation <path> --sign-off-record <path>` and
   confirm the verdict; the artifact must STILL pin `liveExecutionAuthorized: false`,
   `authorizesLiveTrading: false`, `requiresSeparateApproval: true`, `neverSends: true`. *(Open —
   gated on #3.)*
5. **Clean gates** — `pnpm typecheck && pnpm lint && pnpm test && pnpm web:build && pnpm safety:scan`
   green; `cargo fmt --check && cargo check && cargo test && cargo clippy -D warnings` green; no
   tracked secrets; `runs/` ignored.
6. **A separate, explicit, written user authorization for S104** — given by the human *after*
   reading this plan and the dossier. No agent may self-authorize. No flag, env var, or config field
   can substitute for it. The audit reaching `ready-for-separate-microtrade-authorization` is **not**
   that authorization — it only means the repo may be *considered*.

If any condition is missing, S104 stops at the missing condition and reports it honestly. The default
is always "not authorized".

---

## 2. Micro-trade constraints (hard requirements the future build must enforce)

These refine dossier §12. Each is a hard gate, not a default; a build that cannot prove it refuses.

- **Burner wallet only** — a dedicated, disposable burner funded with a tiny amount; never a primary
  or treasury wallet. Reuse the burner-isolation spec already in the repo.
- **No seed phrases, ever** — the signer boundary accepts a local keypair file PATH only (the
  existing `loadLocalSignerBoundary` seam). No mnemonic/seed import is added or accepted.
- **Tiny max spend** — an explicit per-trade cap of **≤ 0.01–0.05 SOL** (the
  `phase7.human_signoff.record.v1` micro ceiling is 0.05 SOL / 50,000,000 lamports). Enforced by the
  fourteen-gate `max-spend-cap` AND the signed record's `maxSpendLamports`; the lower of the two wins.
- **One trade only** — `maxTradesPerSession = 1`. The session must be reconciled before a second
  attempt is even constructible.
- **Manual confirmation required** — an explicit human confirmation at send time (an interactive,
  non-defaultable acknowledgement). No automated trigger.
- **No autonomous trading** — no loop, no scheduler, no "let it run", no background task. A human
  initiates the single attempt by hand.
- **Quote freshness required** — a live quote within an explicit age cap (`quote-fresh`), re-checked
  immediately before send; a stale quote refuses.
- **Risk PASS required** — the candidate's advisory risk must be under an explicit cap; a `REJECT`
  or any critical flag refuses the build.
- **Token-2022 blockers refused** — transfer hooks, permanent delegate, freeze authority, etc. refuse
  the build (reuse the existing deep-risk Token-2022 detection).
- **Simulation required** — the exact unsigned envelope must `simulated-ok` (real `simulateTransaction`,
  `sigVerify:false`) immediately before send.
- **Slippage cap required** — an explicit slippage cap on the quote/build; exceeding it refuses.
- **Session loss cap required** — an explicit `sessionLossCapSol`; breaching it halts the session.
- **Kill switch required** — the kill switch / emergency-stop must be clear before send, and engaging
  it stops everything immediately.
- **Reconciliation required after the trade** — the attempt is journaled, then reconciled with real
  RPC accounting before the continuation wall reopens.
- **No second trade until reconciled** — the existing unreconciled-session refusal wall applies with
  no bypass.

---

## 3. Implementation plan (for the future S104 sprint — not built here)

### 3.1 Command naming proposal (proposed; NOT registered today)

A single, human-driven entry point in the existing `execution:` namespace, mirroring the shape of
`execution:devnet:send` / `execution:devnet:rehearse`:

- `execution:mainnet:microtrade:plan` — a read-only PLAN/preview: resolve the live gate, fetch a
  fresh quote, build the unsigned envelope, simulate it, score risk, and emit a no-send plan
  artifact. Produces nothing signable. This is the safe, reviewable half and should land first.
- `execution:mainnet:microtrade:send` — the gated, single-attempt send. Default-blocked; requires the
  armed fourteen-condition gate, the signed-for-controlled-microtrade record, an interactive manual
  confirmation, and the burner signer boundary. **This command does not exist yet and must not be
  added without the §1 authorization.**

Naming is a proposal; the reviewer may rename. What matters is: a read-only planner lands and is
reviewed before any send command is written.

### 3.2 Signer boundary reuse

Reuse `loadLocalSignerBoundary` unchanged. For mainnet it already refuses to load without an **armed**
fourteen-condition gate (`SignerBoundaryError`). S104 supplies the burner keypair PATH via an env var
(never a committed file); the boundary's redacting `toJSON` and frozen object stay as-is. No new
signer code; no seed handling; no Rust signer.

### 3.3 Live-gate evidence inputs

The fourteen conditions must each be satisfied with REAL evidence at send time:
`env-acknowledgment`, `config-phase7-ready`, `cli-acknowledgment`, `network-mainnet-beta`,
`max-spend-cap`, `session-loss-cap`, `slippage-cap`, `kill-switch-clear`, `quote-fresh`,
`simulation-ok`, `risk-under-threshold`, `wallet-validated`, `signer-boundary`,
`audit-and-redaction`. The gate stays default-blocked and re-verified inside the send seam
(`attemptExecution`) — S104 adds no override and no partial credit.

### 3.4 Audit artifact requirements

- A pre-trade `execution:mainnet:microtrade:plan` artifact (no-send) is retained and inspectable.
- The attempt is journaled to the session ledger exactly like the devnet path.
- A post-trade `execution.reconciliation.report.v1` (mainnet) accounts for the real result.
- The Phase 7 audit is re-run after the trade; the artifact still pins the live-disabled locks
  (the audit describes readiness, it never reports a completed live trade as authorization).

### 3.5 Rollback / stop behavior

- Kill switch / emergency-stop file present → refuse before send; if engaged mid-flow, stop.
- Send is once-only and never retried/chased (reuse the refusal-first send path).
- A failed/timed-out confirmation leaves an honest `pending-confirmation` session that the wall
  blocks until reconciled or audited-acknowledged. No automatic re-send.
- Any gate failure, stale quote, failed simulation, or risk REJECT aborts with a classified reason
  and no broadcast.

### 3.6 Test plan

- Unit: each of the §2 constraints refuses when unmet (table-driven), mirroring the devnet rehearsal
  and live-gate tests.
- The send seam refuses every mode except an armed `mainnet-live-armed` built from real evidence;
  no CLI path constructs that mode without the gate + signed record + manual confirm.
- A red-team test: no flag/env/config can arm the gate, skip the manual confirm, raise the spend cap
  above the signed ceiling, or send a second trade before reconciliation.
- Parity: the plan artifact and reconciliation re-derive on validation; tampering is refused.
- The whole suite, `safety:scan`, and the command-surface audit stay green; `EXPECTED_COMMANDS` and
  the no-mainnet-send invariants are consciously updated only with the §1 authorization.

### 3.7 UI warnings

- The `/sniper` page and operator demo must show, prominently and truthfully: live ENABLED vs
  DISABLED, the armed/blocked gate state, the burner address (non-secret), the spend cap, the
  one-trade-only state, and the reconciliation status. A live attempt must never be presented as
  routine; the default visual state is "live disabled".

### 3.8 Explicit non-dependencies

- **No Axiom dependency.** Axiom remains a UX benchmark only; S104 does not depend on it.
- **No Rust sending or signing.** Rust stays read-only intelligence/inspection behind JSON IPC and
  the TypeScript parity walls. TypeScript remains the orchestrator and final validator.

---

## 4. Non-goals (explicitly out of scope for S104)

- **No autonomous sniper session** — no always-on bot, no auto-buy on detection.
- **No large trade** — the cap stays tiny; S104 is a discipline proof, not a profit attempt.
- **No multi-trade loop** — one human-initiated trade, then stop and reconcile.
- **No hidden signer** — exactly one auditable signer boundary; no alternate code path.
- **No seed import** — no mnemonic/seed handling is added anywhere.
- **No bypass / force-live flag** — none exists and none is added; the gate has no override.
- **No predatory / MEV / sandwich / spam logic** — never in scope.

---

## 5. This document authorizes nothing

This is a design plan, not an authorization. It implements no mainnet send, registers no command, and
arms no gate. A controlled S104 mainnet micro-trade requires a **separate, explicit, written
authorization from the user**, given after reading this plan and the dossier — and even then, only as
a new, separately reviewed sprint that builds and tests the §2 controls from scratch. The safe next
action today is to finish the Phase 7 sign-off (§1.3) and re-run the audit; nothing in this repo may
send a live trade.
