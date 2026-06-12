# Phase 7 Live-Send Design Review (Sprint 94 — DOCUMENT ONLY)

> **Status: DESIGN REVIEW. No mainnet send surface exists in this repository, and this document
> does not authorize one.** Implementing anything below requires a separate, explicitly
> authorized sprint (currently planned as Sprint 104 at the earliest), a fresh security review,
> and the full condition list at the bottom of this document. Until then the fourteen-condition
> mainnet live gate stays DEFAULT-BLOCKED (`docs/PHASE7_LIVE_EXECUTION_GATE.md`,
> `docs/EXECUTION_SAFETY.md`) and `execution:readiness` remains structurally incapable of
> reporting anything but `blocked`.

## Purpose

Specify — before any code exists — exactly what the future live-send surface may look like, so
the dangerous path is opened deliberately, minimally, and reviewably instead of accreting. The
guiding principle is unchanged from Sprints 92–94: **refusal-first, evidence-gated, bounded
loss, no surprise capability.**

## Wallet policy

- **Burner wallet only.** The live signer is a dedicated, freshly generated keypair holding only
  the session budget. It is never a main wallet, never an exchange wallet, never reused across
  strategies.
- **No seed phrases, ever.** The signer boundary (`packages/execution/src/signer.ts`) accepts
  only the solana-keygen 64-byte JSON array form, named by environment variable (the variable
  holds the file PATH; the CLI never sees the path or the bytes). No mnemonic parsing will be
  added in any sprint.
- **The signer boundary is the only signing surface.** Key material never leaves
  `signer.ts`; boundaries serialize to a redaction marker; a mainnet-beta boundary loads ONLY
  behind the ARMED fourteen-condition gate (already enforced and tested today).

## Hard preconditions for ANY live send (all enforced in code, none waivable)

| # | Requirement | Already built? |
|---|---|---|
| 1 | The fourteen-condition mainnet live gate ARMED (env + config + CLI ack + network + caps + kill switch clear + quote freshness + simulation + risk + wallet + signer + audit/redaction) | Gate exists (S92); always blocked today |
| 2 | **Tiny first-trade max spend** — the first live trade is capped at a micro amount (target: ≤ 0.005 SOL notional) regardless of configured caps | Cap plumbing exists; the first-trade micro-cap is new |
| 3 | **Manual confirmation** — an interactive, per-trade operator confirmation at execution time; no flag, env var, or config file can pre-answer it | New |
| 4 | **Quote freshness** — a LIVE fetch report evaluated against an explicit `--max-quote-age-ms`; stale or unverifiable quotes refuse (condition 9) | Built (S93) |
| 5 | **Transaction simulation** — the EXACT unsigned envelope must `simulateTransaction` clean immediately before signing; any error refuses | Built (S92, txpreview) |
| 6 | **Risk threshold** — a deep `token:risk` report under the explicit `--risk-score-cap`; a REJECT decision refuses regardless of score | Built (S92/S93) |
| 7 | **Token-2022 blockers** — transfer hook, permanent delegate, non-transferable, default-frozen, pausable, extreme transfer fee ⇒ refuse outright; unknown extension data ⇒ refuse (never assumed absent) | Built (S93 risk flags); live-path enforcement is new |
| 8 | **Slippage cap** — explicit `--slippage-cap-bps`; no default exists; the built transaction's minimum-out must honor it | Built (S92 builder) |
| 9 | **Session loss cap** — running realized-loss accounting; breaching the cap kills the session (no new trades, ever, until a new session is explicitly opened) | Control exists (S92); live accounting is Sprint 96 |
| 10 | **Kill switch** — config kill switch + emergency-stop file both clear at every step (checked before build, before sign, before send) | Built |
| 11 | **Audit artifact required** — every attempt (refused or submitted) appends to the audit journal BEFORE the result is reported; a journal write failure refuses the trade | Built (S92 send path) |
| 12 | **Post-trade reconciliation required** — after any submitted trade: confirm the signature, read the resulting balances, and write a reconciliation artifact; an unreconciled session cannot open new trades | Sprint 96 (devnet first) |

## Operating constraints at first opening

- **No background/autonomous mainnet trading.** The first live surface is a single,
  operator-attended, manually confirmed micro-trade (Sprint 104), then a bounded attended
  session (Sprint 105). Unattended operation is out of scope for both and would require its own
  design review.
- **No new network surface.** The live path reuses the existing quote fetcher, builder,
  txpreview, and send seams — no additional providers are introduced in the live sprint itself.
- **Devnet first, always.** Every new live-path mechanism (micro-cap, manual confirm,
  reconciliation) ships and is proven on devnet (`execution:devnet:rehearse` /
  `execution:devnet:send`) before the mainnet sprint is even scheduled.

## Axiom Pro position

Axiom Pro is a **product/UX benchmark only** (see
`docs/research/COMPETITIVE_SNIPER_REFERENCE.md`): its command-center ergonomics inform our web
UI and rehearsal workflows. It is **not a dependency**: no Axiom endpoint is called, no Axiom
account is required, and no integration will be added unless an official, documented, supported
API exists and is separately reviewed. Sol Maker's value is the auditable safety chain — that
must never depend on a third-party closed product.

## Exact conditions to schedule Sprint 104 (controlled micro-trade)

All of the following, verified in order, each with artifacts:

1. Sprints 94–103 merged green (see `docs/ROADMAP.md` sprint plan), including:
   - a CONFIRMED real devnet broadcast (`rehearsed` outcome with a public signature);
   - real Jupiter swap build + simulation hardening (S95);
   - post-trade reconciliation proven on devnet (S96);
   - full mainnet dry-run release candidate (S102) with a complete evidence chain from one
     command (`paper:sniper:rehearse --mode mainnet-dry-run`);
   - final security audit + live authorization review (S103) with a written sign-off.
2. `execution:readiness` shows exactly three remaining unsatisfied conditions (the three that
   are execution-time-only by design: CLI acknowledgment, signer boundary, audit/redaction).
3. A fresh burner wallet funded with ONLY the micro-trade budget.
4. The operator's explicit, written authorization for that single sprint, naming the spend cap.
5. A rollback/abort plan: kill switch rehearsed, emergency-stop file rehearsed, and the session
   loss cap set at or below the total burner balance.

Anything less, and Sprint 104 does not run. There is no fast path.
