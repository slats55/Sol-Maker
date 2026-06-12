# Phase 6 Continuation Pack (continuation run 2026-06-10 #2, Sprints 73–82; addenda: S85–S91)

The precise hand-off for the next session. Everything below is verifiable from the repo —
no claim here rests on memory.

## Addendum — Sprint 91 (read-only route quote package + route provenance integration; 2026-06-12) — COMPLETED

S91 un-blinded the route stage with READ-ONLY observation provenance. No execution capability
entered the codebase: no wallet, no signing, no transaction, no live order; Phase 7 remains
unauthorized; `phase7LiveTradingReady` stays a validated literal `false` everywhere.

- **New package** — `@soulmaker/routequote` (`packages/routequote/`): pure (no fs/network/chain
  imports — its forbidden-import scan also forbids `@soulmaker/simulation`, and the simulation
  package's own allowlist is untouched). Schemas: `routequote.observation.input.v1` (one
  operator-supplied observation per candidate mint; CLOSED outcome set `quote-observed |
  unavailable | blocked | error | unsupported`; `quote-observed` requires validated input/output
  mints with outputMint === candidateMint; non-observed statuses must carry NULL facts; labels
  bounded + redaction-stable, secret-shaped values refused and never echoed; observed-at is an
  operator LABEL, never system time) and `routequote.prepared.v1` (by-mint pairing against a
  strictly-validated candidate list; unknown-mint/duplicate observations REFUSED; per-entry
  deterministic `routeLabel` recomputed by the validator; the MANDATORY caveat set verbatim;
  `destinationLabel` ALWAYS null in v1 — a quote validates no destination). Conversion:
  `toRouteQuoteFacts` emits facts ONLY for observed entries under the fixed
  `routequote-operator-supplied` provenance id.
- **Simulation integration, schema UNCHANGED** — `buildSimulationRouteResolutionV1` gained an
  optional `routeFacts` input (strict shape validation; a fact for a candidate not in the plan, a
  mint contradiction, or a duplicate THROWS; a blocked chain never applies facts and records no
  attempt). `simulation.route.resolution.v1` is byte-compatible: the S85 validator already
  required exactly this shape (attempted resolver + label-resolved facts + mandatory
  `liveStateCaveat`), so every pre-S91 artifact revalidates and the no-quotes default build is
  byte-identical to pre-S91.
- **CLI** — new `paper:routequote:prepare` (`--candidates` + repeatable `--quote`, `--out`/
  `--force`, `--fail-on-warning`/`--fail-on-missing-quote`/`--fail-on-not-observed`; exact next
  commands emitted); `paper:simulation:route --quotes` (prepared artifact must COVER every plan
  entry by candidateId+mint or it refuses; observed quotes for non-plan candidates are skipped
  and reported, never applied); `paper:sniper:dry-run --routequote` (cross-checked BOTH ways
  against the candidate list; the validated artifact rides verbatim into the out dir as
  `routequote-prepared.json` — a 21st file; RUN_SUMMARY + terminal summary carry the quote
  provenance line). Audit/handoff/bundle carry the new route state through the EXISTING verbatim
  mirrors (`routeResolutionStatus`/`routeResolverAttempted`/`routeLiveStateCaveat`).
- **UI** — typed views for both routequote schemas (observation-only framing + mandatory
  caveats); the command-center route stage un-mutes to "review" with the quote framing when
  `unresolved` + attempted; per-candidate "Route quote" column (prepared quoteStatus wins, route
  entry status is the fallback); observability panel gained the "Route quote" fact; capability
  strip gained "Read-only route quotes = available" while route resolver stays boundary-only and
  live trading stays disabled/unauthorized.
- **Example** — `examples/sniper/routequote-rehearsal/` (committed fictional observation files +
  README chain), pinned by `apps/cli/src/routequote-rehearsal-example.test.ts`: unblocked 1-entry
  plan; route `unresolved` w/ attempted + caveat + route/fee labels resolved and destination
  honestly unresolved; verdict still `blocked` on `simulation-blocked-prereqs-not-ready` (a quote
  can never change it); byte determinism.
- **Bug fix** — the core config loader now strips a UTF-8 BOM before `JSON.parse`
  (`packages/core/src/config/load.ts` + `load.test.ts`) — the S90 PowerShell-redirect bug.
- **NOT built (still future, by design)** — a live read-only quote FETCHER (the S89 stub in
  `PHASE6_DRY_RUN_BOUNDARY.md` remains its design of record), any route resolver/execution, a
  real `simulateTransaction` engine, Phase 7 anything.

## Addendum — Sprint 90 (real-input bridge + Sniper Command Center + competitive mapping; 2026-06-11) — COMPLETED

S90 built the missing bridge from real read-only token intelligence into the PAPER dry-run, plus
the unified command-center UI. No capability changed at the boundary: the route remains honestly
all-UNAVAILABLE, no resolver/wallet/signing entered the codebase, Phase 7 remains unauthorized.

- **The bridge** — `paper:sniper:preflight:input:prepare` (`apps/cli/src/commands.ts`): pairs
  standalone `token:inspect --json` / `token:risk --json` output files to a candidate list BY
  MINT and emits the canonical `sniper.preflight.input.v1` that `paper:sniper:dry-run
  --preflight-input` consumes. Values carried VERBATIM via `normalizeSniperPreflightInput`
  (candidate-list cross-check included); uncovered candidates stay warned, never marked safe;
  refusals: malformed JSON, cross-kind files (named explicitly), a mint matching no candidate,
  duplicate files per mint, secret-shaped key names anywhere (key path named, value never
  echoed), secret-length mints (never echoed). `--out` refuse-overwrite-without-`--force`,
  no mkdir. The human output ends with the exact next dry-run + web-inspect commands.
- **Capture flags** — `token:inspect` gained `--json` / `--out` / `--force`; `token:risk` gained
  `--out` / `--force`. `--out` writes UTF-8 (PowerShell `>` writes UTF-16, which the downstream
  JSON readers refuse — documented in the runbook/README).
- **Real-input rehearsal** — `examples/sniper/real-input-rehearsal/`: README with the real-path
  command chain (operator-supplied mints/RPC) and an offline fictional path runnable now.
  Fixtures generated THROUGH PRODUCTION CODE by the committed
  `scripts/gen-real-input-rehearsal-fixtures.ts` (fixed clock; FICB carries a freeze authority so
  the REAL risk engine emits a critical REJECT). Pinned by
  `apps/cli/src/real-input-rehearsal-example.test.ts`: fixture fidelity vs regeneration; the
  MIXED run (paper-enter + paper-reject → ONE rejected candidate honestly blocks the whole
  chain: verdict `blocked`, route `blocked`, 3 codes, plan blocked 0 entries); the CLEAN remedy
  run (`blocked` on `simulation-blocked-prereqs-not-ready` alone, route `unavailable`, plan
  unblocked 1 entry); byte determinism; README/code agreement.
- **Sniper Command Center** — new `/sniper` page (`apps/web/src/pages/sniper.ts`) over the
  committed `dry-run-sample` fixture (SAMPLE-labelled), and the SAME blocks now render on every
  `web:inspect --dir` dry-run folder: honest capability strip (route = boundary only; live
  trading = disabled/unauthorized), dashboard cards, pipeline visualization (Candidate → Inspect
  → Risk → Decision → Plan → Route boundary → Audit → Handoff → Bundle; states derived from the
  folder's own artifacts), candidate intelligence table (no prices/PnL/fake liquidity),
  observability panel (timing honestly "unavailable" — artifacts carry no wall-clock by design).
  Pure model in `apps/web/src/lib/command-center.ts`; sample loader in `lib/sample-run.ts`.
- **Competitive mapping** — `docs/research/COMPETITIVE_SNIPER_REFERENCE.md`: detect→analyze→
  execute→exit mapped to the safe PAPER chain; risk-check gap list (metadata mutability,
  liquidity depth, owner concentration, transfer hooks, honeypot simulation — all future
  READ-ONLY work); execute/exit topics recorded as Phase 7 future-only, not designed, not built.
- **Hygiene** — `runs/` is now gitignored (every doc points operators there).

## Addendum — Sprint 89 (operator dress rehearsal + dry-run UX + UI landing overview; 2026-06-11) — COMPLETED

S89 made the S88 orchestrator feel like a product workflow. No capability was added: the route
remains honestly all-UNAVAILABLE, no resolver/wallet/signing/network entered the codebase, and
Phase 7 remains unauthorized.

- **Shipped dress rehearsal examples** (`examples/sniper/operator-dress-rehearsal/`): four
  ready-to-run fictional candidate files — minimal (draft specs → `blocked`, 6 codes), rich
  (clean paper-enter path → `blocked` on `simulation-blocked-prereqs-not-ready`, route
  `unavailable`), watch-only (→ `reviewable-paper-only`, route `no_entries`), blocked-risk
  (critical REJECT → `blocked`, route `blocked`) — plus a README with exact commands, the
  20-file output tree, the closed verdict set, and the route-status semantics.
  `apps/cli/src/dress-rehearsal-examples.test.ts` runs the REAL orchestrator over each and pins
  the documented verdicts/codes/route statuses, input validity, determinism, and README/code
  agreement.
- **Dry-run CLI UX** (`paper:sniper:dry-run`): the terminal summary and `RUN_SUMMARY.md` now list
  the chain blocking codes VERBATIM (previously only a count + narrative); the route line carries
  a per-status explanation (`unavailable` = expected boundary / `blocked` = blocked plan /
  `no_entries` = watch-only); the terminal ends with the exact `pnpm web:inspect --dir … --force`
  command. `resolvePath()` now normalizes absolute paths (Windows shell wrappers inject doubled
  backslashes into displayed paths). All output still derives only from the bundle's structured
  state — byte-deterministic.
- **Web dry-run landing overview** (`apps/web/src/lib/dry-run-overview.ts` + folder page): the
  folder inspector recognizes a dry-run output folder by its VALID `phase6.operator.bundle.v1`
  and renders a landing block first — SIMULATION-ONLY banner, operator-verdict card (honest tone
  mapping; the best verdict explicitly stays paper-only), route-status card with the per-status
  explanation, blocking codes verbatim, a clickable 13-role artifact-chain strip
  (valid/invalid/missing states, anchors into the per-artifact sections), bundle
  completeness/trail-consistency cards, and a `RUN_SUMMARY.md` pointer. Everything is read
  VERBATIM from the bundle through the defensive accessors — nothing recomputed or invented;
  non-dry-run folders render exactly as before. `apps/web/fixtures/dry-run-sample/` is a real
  committed orchestrator output (over the rich rehearsal) byte-pinned by the CLI suite against a
  fresh run, so it can never drift. Browser-verified: 10 pages HTTP 200, 0 console
  errors/warnings.
- **Honest semantics unchanged:** the clean dress rehearsal still ends `blocked` (paper-enters
  demand review); the watch-only chain is still the only `reviewable-paper-only` state. Do not
  "fix" either.

## Addendum — Sprint 88 (operator bundle + PAPER dry-run orchestrator + UI merge; 2026-06-11) — COMPLETED

S88 closed the gap between "validated artifact system" and "operator-runnable PAPER dry run".
No live capability was added; the route remains honestly all-UNAVAILABLE, the real dry-run
remains unauthorized and unbuilt, and Phase 7 remains unauthorized.

- **UI lane MERGED:** `sprint-aux-web-ui-phase6-artifact-views` (28 commits) rebased cleanly onto
  the S87 master and fast-forward-merged. The web dashboard (apps/web) is now on master:
  29-schema registry, typed Phase 6 views, local folder inspector (`pnpm web:inspect --dir`),
  command reference. The UI lane is no longer a parallel-branch risk.
- **`phase6.operator.bundle.v1`** (`packages/simulation/src/operator-bundle.ts`): THIRTEEN roles —
  the twelve handoff roles plus the handoff pack itself — each strictly validated in place with
  verbatim structured summaries. New machinery beyond the handoff pack: per-role FILE REFERENCES
  with truncated `sha256-128` digests (truncated ON PURPOSE — the shared redactor treats 64-hex
  blobs as key-shaped); the blocking trail RECOMPUTED from the bundled artifacts and cross-checked
  against the handoff pack's verbatim trail (`blockingTrailConsistent`; a stale/tampered pack is a
  blocked bundle); a CLOSED operator verdict (`blocked` / `incomplete` / `attention` /
  `reviewable-paper-only` — deliberately no "ready") with deterministic
  whatHappened/whyBlocked/whatToInspectNext text, ALL recomputed by the validator (even
  downgrading the verdict is refused). CLI: `paper:simulation:bundle` (flags pinned).
- **`paper:sniper:dry-run`** — the operator orchestrator: candidate file in → 19 artifacts +
  `RUN_SUMMARY.md` out, all through the EXISTING production builders and command functions
  (fixtures.ts's exact recipe for the sniper side; the e2e pipeline's exact steps for the
  simulation side). Honest behaviors pinned by test: specs are DRAFT by default (`--adopt-specs`
  + `--operator` is the explicit adoption decision); candidates without preflight data stay
  `unknown` and the fail-closed default policy keeps them out of paper-enter; a clean paper-enter
  run is HONESTLY `blocked` on the verbatim `simulation-blocked-prereqs-not-ready` condition
  (paper-enters always demand review); a watch-only run reaches `reviewable-paper-only` — the
  best verdict that exists; a blocked chain still writes the full artifact set (exit 0;
  `--fail-on-blocked` gates); two runs are byte-identical.
- **Resolver assessment renewed (S88 decision record, in PHASE6_DRY_RUN_BOUNDARY.md):** Option 1
  (real read-only resolver) declined — it needs a NEW separately-scanned package outside the
  simulation import allowlist and its own sprint; Option 2 is fully real (adapter seam + route
  contract + CLI + orchestrator + bundle carriage). Nothing was faked to move percentages.
- **Honest catch worth knowing:** the canonical "ready chain" dress rehearsal ends `blocked`, not
  green — that is the system telling the truth (prereqs' NO_OPERATOR_BLOCKING stays unmet while
  paper-enters await review; the plan-level acknowledgment unblocks the PLAN but the condition is
  still carried verbatim through audit/handoff/bundle). Do not "fix" this; it is the designed
  behavior, now documented in the runbook's dry-run section.

Updated next slices: (1) the separate read-only quote package per the S88 decision record
(route facts enter ONLY through the existing resolved-entry contract + liveStateCaveat);
(2) operator dress rehearsal with REAL read-only `token:inspect`/`token:risk` output as the
preflight input (the dry-run command consumes it today); (3) handoff-pack/bundle diff if
session-over-session comparison proves useful.

## Addendum — Sprint 87 (route artifact audited and handed off; 2026-06-10) — COMPLETED

S87 executed exactly the slice S86 named as "next slice (3)": the route-resolution artifact is
now a first-class AUDITED and HANDED-OFF role. No capability was added; the route remains a
contract/provenance boundary, the real resolver does not exist, the real dry-run remains
unauthorized and unbuilt, and Phase 7 remains unauthorized.

- **Audit role bump (9 → 10):** `route-resolution` joined `PHASE6_AUDIT_ROLES`
  (`phase6.audit.report.v1`). The supplied artifact is validated by the S85 validator (which
  recomputes every mirror — never trusted), a missing route is a WARNING (incomplete chain,
  honest), an invalid/tampered/wrong-schema route is BLOCKING, and a blocked route's blocking
  codes surface VERBATIM as chain conditions. A pre-S87 nine-role audit artifact re-validates as
  INVALID — the intended fail-closed bump, same shape as S80/S86.
- **Structured plan↔route cross-checks:** when both the plan and the route are strictly valid,
  the route's `sourcePlanRef` must agree with the audited plan on planLabel / operatorLabel /
  entryCount / blocked (a disagreement is a blocking `audit-source-ref-mismatch`); a route that
  records its plan as missing/invalid beside a strictly-valid audited plan is likewise a
  mismatch (it was not built from this chain's plan). Blocked-plan consistency is covered by the
  combination: the S85 validator already refuses a green route over a blocked ref, and the
  cross-check refuses a ref that disagrees with the audited plan.
- **Handoff role bump (11 → 12):** `route-resolution` joined `PHASE6_HANDOFF_ROLES`
  (`phase6.simulation.handoff.pack.v1`) with a verbatim structured summary (resolutionStatus,
  blocked, entryCount, unavailableEntryCount, liveStateCaveat, routeResolverAttempted); a
  blocked route's codes are carried verbatim into `chainBlockingCodes`, and the validator's
  recomputable lower bound now also refuses a stripped blocking trail while the route summary
  alone signals a blocked route. A pre-S87 eleven-role pack re-validates as INVALID.
- **CLI:** `--route <path>` on `paper:simulation:audit` and `paper:simulation:handoff` (pinned
  in the CLI reference validator, commands AND flags). A named-but-unreadable route file refuses
  outright; an omitted flag classifies the role per the audit/handoff missing conventions. No
  command calls a resolver, constructs a transaction, or touches RPC.
- **E2E chain:** plan → result → validate → route → audit (`--route`) → readiness (11 evidence
  areas) → diffs → handoff (`--route`), byte-deterministic across two full runs. The readiness
  `CHAIN_COMPLETE` check detail no longer hardcodes "9" (it follows `PHASE6_AUDIT_ROLES.length`),
  so a chain audited without the route is honestly NOT ready until re-audited with it.

Honest boundary note (unchanged from S86): the route artifact in the audit/handoff is still the
honest all-UNAVAILABLE record — `paper:simulation:result` still does NOT consume route.json; that
wiring belongs to the future, separately-authorized dry-run boundary.

Updated next slices: (1) operator dress rehearsal over real candidate intake (runbook S86-prep
section; now exercises `--route` through audit/handoff); (2) handoff-pack diff
(`phase6.simulation.handoff.pack.diff.v1`) if session-over-session comparison proves useful;
(3) Phase 7 boundary spec doc (docs ONLY, fresh authorization required).

## Addendum — Sprint 86 (route-resolution readiness evidence + operator CLI; 2026-06-10) — COMPLETED

S86 integrated the S85 route-resolution artifact into the readiness workflow and the operator
CLI path. Three changes, all fail-closed, none adding capability:

- **Eleventh readiness evidence area:** `route-resolution-tests` joined
  `PHASE6_READINESS_EVIDENCE_AREAS` (append-only, stable order). A readiness artifact built
  against the ten-area bar re-validates as INVALID — the intended fail-closed bump, same as S80.
  Missing route-resolution evidence blocks readiness with
  `simulation-readiness-evidence-missing`.
- **Validator hardening (S86):** the readiness validator now RECOMPUTES the evidence-missing
  blocking code from the report's own evidence list (the one blocking code it can recompute) —
  an undeclared area with a clean blocking trail, or the code over fully-declared evidence, is
  refused in both directions. Mirrors are never trusted where recomputation is possible.
- **`paper:simulation:route` CLI command:** builds a `simulation.route.resolution.v1` from a
  named `simulation.intent.plan.v2` via the S85 CANONICAL builder — the only one that exists, so
  the command can only ever emit the honest all-UNAVAILABLE record under
  `unavailable-no-route-resolver`. Flags: `--plan` (required), `--stop-simulation-tripped`,
  `--operator`, `--resolution-label`, `--json`, `--out`/`--force`, `--fail-on-blocked`,
  `--fail-on-unavailable` (a CI tripwire that trips on every honest artifact until a separately
  authorized resolver exists). Missing/garbage input refuses; an invalid/blocked plan or tripped
  stop switch yields a BLOCKED artifact (exit 0; the gate flags it). Pinned in the CLI reference
  validator (commands AND flags); the full e2e chain now runs plan → result → route → audit →
  readiness (11 evidence areas) → diffs → handoff with byte determinism.

New decision a successor must not undo:

13. **Route-resolution evidence is required by readiness, but route resolution itself remains
    UNAVAILABLE.** The `route-resolution-tests` area claims only that the ARTIFACT layer is
    tested. The result path does NOT consume route-resolution artifacts yet — that wiring belongs
    to the future, separately-authorized dry-run boundary (`PHASE6_DRY_RUN_BOUNDARY.md`, S86
    section), which must consume the strictly re-validated artifact as its only route-state
    input. Never bridge that gap by inventing resolved facts or relaxing the canonical builder.

Honest boundary note: `paper:simulation:result` and the audit/handoff role sets were deliberately
NOT extended to consume route.json this sprint — forcing that link before the dry-run boundary is
designed-in would be artificial. Readiness requires the EVIDENCE; the chain records the ARTIFACT.

Updated next slices: (1) operator dress rehearsal over real candidate intake (see the runbook's
S86-prep section — needs operator-supplied real input; never invent it); (2) handoff-pack diff
(`phase6.simulation.handoff.pack.diff.v1`) if session-over-session comparison proves useful;
(3) extend the audit/handoff role registry with the route-resolution artifact as a TENTH/TWELFTH
audited role (conscious fail-closed bump, mirrors S80/S86); (4) Phase 7 boundary spec doc (docs
ONLY, fresh authorization required).

## Addendum — Sprint 85 (route-resolution artifact; 2026-06-10)

S84 (handoff-pack blocking-lower-bound hardening) and S85 landed after this pack was written.
S85 shipped `simulation.route.resolution.v1` (`packages/simulation/src/route-resolution.ts` +
`route-resolution.test.ts`) — the provenance layer the dry-run boundary doc names as its FIRST
prerequisite, as schema/validator/formatter ONLY (no resolver capability, no CLI command, no
adapter change, deliberately):

- Canonical builder: consumes a strictly-validated `simulation.intent.plan.v2`; records one entry
  per plan preview entry, every fact honestly UNAVAILABLE under the fixed
  `unavailable-no-route-resolver` id (no route-resolution capability exists inside the boundary).
  Missing/invalid/blocked plan or a tripped stop switch BLOCKS (zero entries, stable codes).
- Validator recomputes EVERY mirror (blocking trail, status precedence, tallies, per-entry code
  trails, live-state caveat, next safe action); `resolved` is refused while any route/destination/
  fee fact is missing; the v1 schema is CLOSED (unknown/sensitive-named/execution-shaped fields
  refused); a future real resolver's artifacts must carry `liveStateCaveat: true` or be refused.
- 11 new `simulation-route-resolution-*` reason codes in a new append-only `route-resolution`
  category; the S81 pinned module list was consciously extended; the operator-output-quality sweep
  now covers the new formatter. The 10-area readiness evidence bar was NOT extended (a candidate
  11th area, route-resolution tests, is a sanctioned future bump).

New decision a successor must not undo:

12. **Route resolution is an artifact contract, not a capability.** `@soulmaker/simulation` can
    DESCRIBE route-resolution state but never perform it; the canonical builder can only ever emit
    UNAVAILABLE. A real resolver lives with the future `@soulmaker/txpreview` work and must emit
    artifacts that pass THIS validator — including the mandatory live-state caveat on any
    label-resolved fact. Never let the builder invent a fact to make a status greener.

Updated next slices: (1) operator dress rehearsal (see below); (2) extend the readiness evidence
bar with a `route-resolution-tests` area (conscious fail-closed re-validation bump); (3) a
`paper:simulation:route` CLI command if operators need to generate the artifact outside tests;
(4) handoff-pack diff; (5) Phase 7 boundary spec doc (docs ONLY, fresh authorization required).

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
10. **The readiness evidence bar is append-only.** Extending it is the sanctioned way to raise
    the Phase 6 bar; an old artifact failing re-validation is the intended fail-closed behavior.
    (Ten areas when this was written; ELEVEN since S86 added `route-resolution-tests`.)
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
