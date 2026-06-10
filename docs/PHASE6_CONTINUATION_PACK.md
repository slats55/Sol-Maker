# Phase 6 Continuation Pack (continuation run 2026-06-10 #2, Sprints 73–82)

The precise hand-off for the next session. Everything below is verifiable from the repo —
no claim here rests on memory.

## Where master is

- **Baseline at run start:** `32e530026ab988f5fd3c703c295addc9eeeb763e` (end of the S61–S72 wave;
  2044 tests / 125 files).
- **This run's sprints:** S73–S82, each on its own `sprint-NN-*` branch, each fast-forward-merged
  to `master` via ref-push only after full gates were green. The final SHA is whatever
  `git rev-parse origin/master` says — verify, don't trust this file.

```bash
git fetch origin --prune
git rev-parse master origin/master   # must match
pnpm install && pnpm typecheck && pnpm lint && pnpm test
git diff --check
```

Expected at the time this pack was written: typecheck/lint/test/diff-check all exit 0
(lint carries ONE pre-existing warning in `packages/sniper/src/policy-config-v2.test.ts` — unused
`WSOL`; it predates this run), 2202+ tests across 134+ files.

## What this run added (on top of the S61–S72 stack)

| Schema | Module | CLI |
| --- | --- | --- |
| `simulation.intent.plan.diff.v2` | `packages/simulation/src/intent-plan-diff.ts` | `paper:simulation:diff:plan` |
| `simulation.result.diff.v1` | `packages/simulation/src/result-diff.ts` | `paper:simulation:diff:result` |
| `sniper.run.report.diff.v2` | `packages/sniper/src/run-report-v2-diff.ts` | `paper:sniper:diff:report --schema-version v2` |
| `phase6.simulation.handoff.pack.v1` | `packages/simulation/src/handoff-pack.ts` | `paper:simulation:handoff` |

Plus: 18 new `simulation-diff-*` reason codes (new append-only `diff` category, 61 codes total);
the shared `SIMULATION_OPERATOR_SAFETY_LINE` printed by every simulation formatter (S76); strict
tally recomputation in BOTH decision-report validators (S77); the full-chain e2e including
readiness → diffs → handoff (S78); the dry-run boundary design doc (S79, pinned by
`dry-run-boundary-doc.test.ts`); the TEN-area readiness evidence bar (S80); pinned production
module list + lane-wide dangerous-flag scan + security review invariants 39–47 (S81).

## Key design decisions a successor must not undo

Decisions 1–5 from the S61–S71 pack still stand verbatim (v1 plan schema id never reused; the
narrow structured-id-gated paper-enter acknowledgment; the adapter contract with no
sent/signed/live outcome; phase6.* artifacts live in simulation because sniper can never depend on
simulation; `phase7LiveTradingReady` is a validated literal false). New in this run:

6. **Diffs compare structured fields only and refuse invalid sides.** A diff never downgrades a
   tampered/wrong-schema artifact to a finding — it refuses outright. Side labels are metadata and
   are never compared. The findings sequence is recomputed by the validator; do not add findings
   the validator cannot recompute.
7. **The v2 run-report diff reuses the v1 differ verbatim** over exact v1 views (the same
   projection the v2 validator uses). Never fork the v1 semantics.
8. **The handoff pack never invents state.** Missing → classified missing; invalid → classified
   with redacted error and a NULL readiness verdict. Its `nextSafeAction` is a pure function of
   (complete, hasBlockingConditions, simulationReadyPerReadiness) that the validator recomputes.
9. **Tally recomputation is now part of both decision validators** (v1 + v2). Every production
   path (builders, tighten-only enforcement, v1→v2 upgrade) derives tallies identically — if a
   future builder path fails this, fix the path, never the validator.
10. **The readiness evidence bar is ten areas and append-only.** Extending it is the sanctioned
    way to raise the Phase 6 bar; an old artifact failing re-validation is the intended fail-closed
    behavior.
11. **The dry-run boundary stays design-only** until a fresh explicit authorization. The honest
    technical finding (signing is not the barrier; route/amount resolution and transaction
    construction are) is recorded in `PHASE6_DRY_RUN_BOUNDARY.md` — implement behind the EXISTING
    adapter contract in a NEW package, never inside `@soulmaker/simulation`.

## Safe next slices (in recommended order)

1. **Route-resolution artifact design** (docs/schema only unless freshly authorized): the
   validated input the dry-run boundary doc names as its first prerequisite — provenance-carrying,
   strictly validated, never operator-typed addresses accepted silently.
2. **Operator dress rehearsal** — drive the full chain over real candidate intake (paper-only;
   read-only RPC for `token:inspect`/`token:risk`) and record the session pack/handoff produced.
3. **Handoff-pack diff** (`phase6.simulation.handoff.pack.diff.v1`) if session-over-session
   comparison proves useful — same structured-field-only rules as S73/S74.
4. **Phase 7 boundary spec doc** (docs ONLY — and only with fresh explicit authorization noted in
   the prompt; S84 in the sprint plan this run worked from).

## Known risks / honest caveats

- Destination/fee previews remain ALWAYS unresolved (no validated route data exists in the paper
  chain) — results stay `skipped_unresolved`/`no_entries`/`blocked` with the canonical adapter.
  Honest design, not a bug; resolved-entry adapter paths are exercised via schema-legal
  label-resolved test plans only.
- A REAL completed dry-run still exists ONLY through test adapters. Nothing in this run changed
  that, on purpose.
- The secrets detector (sniper-side) may conservatively false-positive — unchanged since S60.
- `apps/web` (UI lane) was NOT touched this run; the stacked UI branch noted in earlier sessions
  remains where it was.
- The fictional fixture chains live in `fixtures.ts` (production source tree) by deliberate
  choice — labeled FICTIONAL throughout, scanned on every run.

## Safety boundary for the next run (non-negotiable)

Phase 6 = simulation only. No live trading, no burner live trading, no wallet signing, no
transaction sending, no private-key/seed-phrase handling, no `DANGEROUS_BURNER_LIVE` activation,
no RPC writes, no live-readiness claims. Phase 7 remains **not started and unauthorized**; a new
run may only document its requirements.
