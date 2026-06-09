# Phase 6 — Transaction Planning & Simulation Boundary (SPEC ONLY — NOT IMPLEMENTED)

> **Status: NOT STARTED. This is a boundary specification, not an implementation.** No transaction
> planning, simulation, signing, or sending exists in this repo, and none may be added without
> satisfying every gate below. This document is the contract that any future Phase 6 work must honor.
> Phase 7 (burner/live trading) is even further out and is governed separately (see the end).

This spec exists because the codebase is now far enough along the PAPER-only sniper path (candidate
intake → token preflight → paper decisions → operator workflow; see
[`SNIPER_MODEL.md`](SNIPER_MODEL.md) and [`SNIPER_RUNBOOK.md`](SNIPER_RUNBOOK.md)) that the NEXT
temptation is to "just build a transaction". Phase 6 is where that could begin — and it is the single
most dangerous transition in the project. The whole point of this document is to make that transition
**slow, gated, auditable, and impossible to do by accident**.

## What Phase 6 IS (and is not)

Phase 6 is **transaction PLANNING + SIMULATION only**:

- A **transaction plan** is a plain, inert DATA object describing *intent* — destinations, amounts,
  fees, slippage assumptions, the candidate it came from, and the operator-approved parameters. It is
  reviewable text/JSON. It is **not** a signed transaction and **not** something that can be sent.
- **Simulation** means a read-only, no-state-change preview (e.g. an RPC `simulateTransaction`-style
  call **against a burner/test fixture only**, later) that estimates the outcome. Simulation **never
  sends**.

Phase 6 is **NOT**: signing, sending, real order placement, live trading, wallet import, or holding a
real (main-wallet) key. Those are Phase 7 and beyond, and are out of scope here.

## Hard boundaries (non-negotiable; a violation is a release blocker)

Any Phase 6 implementation MUST satisfy ALL of these. They are stated as invariants so they can be
tested and reviewed:

1. **No private keys.** No code path accepts, derives, stores, or logs a private key.
2. **No seed phrases / mnemonics.** Never accepted or generated.
3. **No keypair creation.** No `Keypair`/signer object is created anywhere in the planner.
4. **No signing.** No transaction signing, anywhere in Phase 6.
5. **No sending.** No transaction is ever sent in Phase 6. Simulation is read-only.
6. **No wallet import.** No main-wallet config, file, or env is read. (Burners come in Phase 7, isolated.)
7. **No live order placement.** No exchange/DEX order is placed.
8. **Planner ⟂ signer — separated FOREVER.** The transaction **planner** is a pure module that emits a
   plan DATA object and is *structurally incapable* of signing or sending: it has no signer dependency,
   no key access, and no network-send seam. The signer (Phase 7) is a separate module that the planner
   never imports and never calls. This separation is permanent, not a phase-by-phase convenience.
9. **Dry-run by default.** Every Phase 6 command is read-only / dry-run unless an explicit, loud,
   per-invocation flag opts into simulation — and even then it only *simulates*, never sends.
10. **Operator approval required.** No plan proceeds to simulation (or, later, to any Phase 7 step)
    without an explicit operator approval step. No blind/auto flow.
11. **Audit logs required.** Every plan + simulation is recorded to a redacted, append-only audit log
    (secrets are redacted via `@soulmaker/security`; non-cryptographic content fingerprints only).
12. **Simulation uses burner/test fixtures only.** When live simulation is eventually wired, it runs
    against a **burner/test** context, never a main wallet, and CI must not depend on the network.
13. **No new hidden network calls / no new RPC client.** Reuse the existing read-only Solana client
    seam (`ReadOnlySolanaClient`, which exposes only read methods); add no send-capable seam.
14. **Caps enforced before anything.** The existing core risk caps / LIVE GATE are evaluated before a
    plan is even produced; a plan that would exceed caps is refused, not produced-and-flagged.

These extend, and never weaken, the repo-wide safety rules in
[`WALLET_SAFETY_MODEL.md`](WALLET_SAFETY_MODEL.md) and the Phase 5 PAPER-only guarantees.

## Exact prerequisites before ANY Phase 6 implementation begins

Phase 6 work MUST NOT start until every one of these is true and verified:

1. **Candidate intake stable** — `sniper.candidate.list.v1` + `paper:sniper:candidates:validate`
   (Sprint 25 ✅), with mint-pubkey validation and secret-input refusal.
2. **Preflight stable** — `sniper.token.preflight.report.v1` + `paper:sniper:preflight` (Sprint 26 ✅).
3. **Paper decisions stable** — `sniper.paper.decision.report.v1` + `paper:sniper:decide`
   (Sprint 27 ✅), with conservative `paper-enter` semantics.
4. **Operator workflow stable** — `paper:sniper:workflow` + the runbook (Sprint 28 ✅).
5. **Risk limits stable** — the advisory risk engine + the core caps / LIVE GATE are settled, versioned,
   and exercised by tests; the thresholds a planner would consult are explicit config, not magic
   numbers.
6. **Operator config stable** — a single, versioned source of truth for modes, caps, and approvals
   (built on `@soulmaker/core`), with no main-wallet material.
7. **Logs / audit stable** — a redacted, append-only audit-log facility exists and is tested (reusing
   `@soulmaker/security` redaction); every safety-relevant action is loggable.
8. **Test coverage** — the PAPER path has comprehensive deterministic tests (it does), and a Phase 6
   plan to add *boundary* tests that prove unsafe plans are refused and that the planner cannot sign or
   send (structural tests, not just behavioral).
9. **Kill-switch design** — a documented, testable way to halt all Phase 6/7 activity immediately
   (a config/env switch that the planner and any future signer both honor, default-safe).
10. **Secrets policy** — a written policy for how (future) burner secrets are stored, scoped, rotated,
    and kept out of logs/plans, plus how the repo guarantees they never touch the planner.
11. **Burner-wallet isolation design** — a design (not an implementation) for how a Phase 7 burner is
    isolated from any main wallet: separate process/credential boundary, refusal of main-wallet-shaped
    config, and a fresh-burner requirement.

These prerequisites are now tracked by a machine-readable checklist: `paper:phase6:prereqs --session
<pack.json>` (schema `phase6.prerequisite.report.v1`, Sprint 40) derives the artifact prerequisites from a
session pack and reports the design prerequisites as `documented`. That tracker **never authorizes Phase
6** — `phase6ImplementationStarted` is always false and `requiresExplicitHumanApproval` always true; an
all-prerequisites-addressed report is **not** a go signal.

When all of the above are checked off, Phase 6 may begin as a **planner that emits inert plan data**,
plus boundary tests — still with **no signer, no sending** — and only after an explicit human decision.

## How Phase 6 will be introduced safely (when the time comes)

- Start with **type contracts only**: pure, inert TypeScript interfaces for a plan DATA object and the
  planner's input/output — with **no** `@solana/web3.js` transaction classes (no `VersionedTransaction`,
  no `TransactionInstruction`) imported, because at the planning layer a plan is just reviewable data.
- Add a pure `buildTransactionPlanDraft(...)` that produces that inert data from a paper decision +
  approved parameters, with the same determinism + redaction + no-IO discipline as the sniper layer.
- Add boundary/safety tests FIRST (refuse over-cap plans; prove the module imports no signer/key/send
  seam) before any simulation wiring.
- Only then, behind an explicit dry-run-by-default flag and operator approval, wire **read-only**
  simulation against a burner/test fixture — never against a main wallet, never sending.

> This document deliberately contains **no code**. Introducing the type contracts above is itself a
> future, reviewed step — it is not done here, so that "Phase 6 not started" remains literally true.

## Phase 7 (burner / live) — even stricter, governed separately

Phase 7 is gated behind Phases 0–6 all green PLUS: a fresh isolated burner secret (config refuses
anything main-wallet-shaped), caps enforced before building/sending, simulate-before-send, redacted
signature + risk logging, and a loud explicit opt-in (e.g. `DANGEROUS_BURNER_LIVE`) with operator
approval and the kill switch armed. See [`ROADMAP.md`](ROADMAP.md) Phase 7. None of it is in scope now.
