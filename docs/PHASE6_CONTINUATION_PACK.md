# Phase 6 Continuation Pack (overnight run 2026-06-10, Sprints 61–71)

The precise hand-off for the next session. Everything below is verifiable from the repo —
no claim here rests on memory.

## Where master is

- **Baseline at run start:** `cd7beab2486a9f4d7ce54d8b5634fa3aeaf429ab` (end of the V2 wave, S46–S60;
  1868 tests / 115 files).
- **This run's sprints:** S61–S71, each on its own `sprint-NN-*` branch, each fast-forward-merged
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
`WSOL`; it predates this run).

## What exists now (the Phase 6 simulation stack)

**Package: `packages/simulation` (`@soulmaker/simulation`)** — read-only, dry-run-only,
deps pinned to `@soulmaker/sniper` + `@soulmaker/security`. Boundary enforced by
`no-forbidden-imports.test.ts` (import ALLOWLIST + forbidden-token + determinism scans) and
`package-boundary.test.ts` (manifest pin + literal-lock surface).

**Schemas (all carry the four validated literal locks `neverAuthorizesLiveTrading` /
`neverSigns` / `neverSends` / `dryRunOnly`):**

| Schema | Module | Builder / Validator / Formatter |
| --- | --- | --- |
| `simulation.intent.plan.v2` | `intent-plan.ts` | `buildSimulationIntentPlanV2` / `validate…` / `format…` |
| `simulation.result.v1` | `result.ts` | `buildSimulationResultV1` / `validate…` / `format…` |
| `phase6.audit.report.v1` | `chain-audit.ts` | `buildPhase6AuditReportV1` / `validate…` / `format…` |
| `phase6.simulation.readiness.report.v1` | `readiness.ts` | `buildPhase6SimulationReadinessReportV1` / `validate…` / `format…` |

Plus: `reason-codes.ts` (43 stable codes, 8 categories, append-only), `adapter.ts` (the dry-run
adapter contract + the canonical honest UNAVAILABLE adapter), `safety.ts` (shared literal locks),
`fixtures.ts` (FICTIONAL chains built via production sniper builders — test/e2e only).

**CLI commands (registered, reference-validator-pinned, documented in runbook + README):**
`paper:simulation:intent:plan`, `paper:simulation:result`, `paper:simulation:validate`,
`paper:simulation:audit`, `paper:simulation:readiness`. All: read-only, no write without `--out`,
overwrite refused without `--force`, `--json`, command-specific `--fail-on-*` CI gates.

**Key design decisions a successor must not undo:**

1. `simulation.intent.plan.v1` is permanently the S41 INERT artifact — the real plan is **v2**;
   schema ids are never reused.
2. The run-report-v2 marks every paper-enter "needs operator review", so a paper-enter chain can
   never have fully-met prereqs. The plan builder's `operatorAcknowledgedPaperEnterReview` is the
   deliberate, narrow answer: structured-id-gated (`notMet === ["NO_OPERATOR_BLOCKING"]`), requires
   actual paper-enters and zero unresolved unknowns, surfaced as a warning code the validator
   couples to its field. Do not widen it.
3. The dry-run adapter contract has NO sent/signed/live outcome. A REAL dry-run
   (`simulateTransaction`) needs built+signed transaction material, which this package is
   structurally forbidden from producing — so the canonical adapter reports UNAVAILABLE, honestly.
   Building that capability requires a separately-reviewed transaction-construction boundary and a
   NEW authorization; do not bolt it onto this package.
4. The chain audit and readiness artifacts live in `@soulmaker/simulation` (named `phase6.*`)
   because sniper can never depend on simulation — the dependency points one way only.
5. `phase7LiveTradingReady` is a literal `false` in the readiness schema; the validator refuses
   anything else. Keep it that way.

## Safe next slices (in recommended order)

1. **Simulation diff chain** — `simulation.intent.plan.diff.v2` + `simulation.result.diff.v1`
   (structured-field diffs: codes added/removed, entry status changes, unresolved counts,
   adoption/readiness changes; CLI `paper:simulation:diff:plan` / `:result`). Also still open:
   a sniper `run.report.v2` diff (the v1 diff exists in `run-report-diff.ts`).
2. **Simulation-aware session pack** — a `phase6.*` pack in the simulation package bundling the
   nine chain artifacts + audit + readiness for operator handoff (the sniper session-pack v2
   classifies simulation artifacts as `unsupported`, which is honest but unaware).
3. **CLI flag-level drift validator** — extend `apps/cli/src/cli-reference.test.ts` from
   command-level pinning to flag-level pinning (flags are currently scanned for dangerous names in
   `simulation-security.test.ts` but not doc-pinned).
4. **Operator output-quality pass** over the four simulation formatters (they ship with safety
   phrasing tests; a dedicated quality review remains worthwhile).
5. **Phase 7 boundary spec doc** (docs ONLY — no code, and only with fresh explicit authorization
   noted in the prompt).

## Known risks / honest caveats

- The plan's destination/fee previews are ALWAYS unresolved (no validated route data exists in the
  paper chain) — so today's results are always `skipped_unresolved`/`no_entries`/`blocked` with the
  canonical adapter. That is the honest design, not a bug; resolved-entry adapter paths are
  exercised in tests via schema-legal label-resolved plans.
- The secrets detector (sniper-side) may conservatively false-positive — unchanged from S60.
- The fictional fixture chains live in the package's production source tree (`fixtures.ts`) by
  deliberate choice (importable by CLI tests/e2e); they pass every boundary scan and are labeled
  FICTIONAL throughout.
- `apps/web` (UI lane) was NOT touched this run; the stacked UI branch noted in earlier sessions
  remains where it was.

## Safety boundary for the next run (non-negotiable)

Phase 6 = simulation only. No live trading, no burner live trading, no wallet signing, no
transaction sending, no private-key/seed-phrase handling, no `DANGEROUS_BURNER_LIVE` activation,
no RPC writes, no live-readiness claims. Phase 7 remains **not started and unauthorized**; a new
run may only document its requirements.
