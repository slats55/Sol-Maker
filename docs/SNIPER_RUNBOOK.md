# Soulmaker Sniper Operator Runbook (PAPER-only)

This runbook ties together the local, offline sniper path built in `@soulmaker/sniper`. It is the
practical "how do I run this" companion to [`SNIPER_MODEL.md`](SNIPER_MODEL.md) (the design/model doc).

> **Everything here is PAPER-only and offline.** No command in this runbook holds a wallet, key, seed
> phrase, signer, or keypair; none builds, signs, simulates, or sends a transaction; none places an
> order or trades live. A `paper-enter` decision is a **simulated** decision only. Phase 6 (transaction
> planning/simulation) and Phase 7 (burner/live trading) are **NOT started** — see the prerequisites at
> the end of this doc.

## What exists now

| Stage | Command | Artifact schema | What it does |
| --- | --- | --- | --- |
| 0. Where am I? | `paper:sniper:workflow` | `sniper.workflow.plan.v1` | Checks which local artifacts exist + validate, prints the recommended NEXT command. Executes nothing. |
| 1. Candidate intake | `paper:sniper:candidates:validate` | `sniper.candidate.list.v1` | Validates + normalizes a local candidate list (mint pubkey validity, unique ids, duplicate-mint warnings). |
| 2. Read-only inputs | `token:inspect`, `token:risk` | (existing) | Existing read-only commands that produce per-mint inspection + advisory risk JSON. |
| 3. Token preflight | `paper:sniper:preflight` | `sniper.token.preflight.report.v1` | Combines mint validity + inspection + risk into `pass` / `warn` / `fail` / `unknown` per candidate. |
| 4. Paper decisions | `paper:sniper:decide` | `sniper.paper.decision.report.v1` | Folds the candidate list + preflight + rules into `skip` / `watch` / `paper-enter` / `paper-reject` / `unknown`. |
| 5. Run report | `paper:sniper:report` | `sniper.run.report.v1` | Joins candidate list + preflight + decision + workflow into one navigable per-candidate view (reason trail, grouped ids, navigation, CI section). |
| 6. Run report diff | `paper:sniper:diff:report` | `sniper.run.report.diff.v1` | Compares two run reports: added/removed candidates, decision + preflight-status transitions, conservative got-worse/recovered flags. |
| —. Policy config | `paper:sniper:policy:validate` | `sniper.policy.config.v1` | Validates a conservative, tighten-only operator/risk policy; `paper:sniper:decide --policy` governs a run with it. |
| 7. Audit log | `paper:sniper:audit` | `sniper.audit.log.v1` | Deterministic per-step provenance over a run report (intake → preflight → decide → report); no wall-clock time. |
| 8. Session pack | `paper:sniper:session:pack` | `sniper.session.pack.v1` | Bundles all session artifacts; classifies each by schema, surfaces unsupported ones honestly; presence-only coverage tiers. |

All of stages 1, 3, and 4 live in the pure `@soulmaker/sniper` package, which carries **no chain
capability** (no `@solana/web3.js`, no `@soulmaker/solana`; a forbidden-import test enforces this). The
CLI is what reads files and (for stage 2) talks to read-only RPC.

## What is still PAPER-only

Everything. The sniper path stops at a **simulated decision**. There is no execution layer: a
`paper-enter` is a classification, not an order. The pure builders never do I/O; the CLI commands read
local files (and, only for the existing `token:inspect` / `token:risk`, read-only RPC) and write
nothing unless you pass `--out`.

## Command reference (at a glance)

Every `paper:sniper:*` command is consistent: it reads only the named local files, **writes nothing
unless `--out`** (where supported), refuses a missing required argument with a `Refusing:` message (exit
1), and emits stable, redacted JSON with `--json`. A cross-command cohesion test
([`apps/cli/src/sniper-cohesion.test.ts`](../apps/cli/src/sniper-cohesion.test.ts)) locks these
invariants.

| Command | Required | Writes? | Schema |
| --- | --- | --- | --- |
| `paper:sniper:candidates:validate` | `--input` | never | `sniper.candidate.list.v1` |
| `paper:sniper:preflight` | `--candidates` | `--out` only | `sniper.token.preflight.report.v1` |
| `paper:sniper:decide` | `--candidates` | `--out` only | `sniper.paper.decision.report.v1` (or `.v2` via `--schema-version v2`) |
| `paper:sniper:policy:validate` | `--input` | never | `sniper.policy.config.v1` |
| `paper:sniper:workflow` | (none) | never | `sniper.workflow.plan.v1` |
| `paper:sniper:report` | `--candidates` | `--out` only | `sniper.run.report.v1` |
| `paper:sniper:diff:report` | `--base`, `--next` | never | `sniper.run.report.diff.v1` |
| `paper:sniper:audit` | `--report` | `--out` only | `sniper.audit.log.v1` |
| `paper:sniper:session:pack` | `--artifact` (≥1) | `--out` only | `sniper.session.pack.v1` |
| `paper:sniper:safety:gates` | `--session` | `--out` only | `sniper.safety.gates.report.v1` |
| `paper:phase6:prereqs` | `--session` | `--out` only | `phase6.prerequisite.report.v1` |
| `paper:phase6:intent:plan` | `--decisions` | `--out` only | `simulation.intent.plan.v1` (INERT, not executable) |
| `paper:phase6:diff:intent` | `--base`, `--next` | never | `simulation.intent.plan.diff.v1` (INERT) |

Common flags: `--json` (stable JSON), `--out <path>` + `--force` (write the artifact; refuse overwrite
without `--force`), and command-specific `--fail-on-*` CI gates (see [CI gates](#ci-gates)).

## The workflow, step by step

Use `paper:sniper:workflow` at any time to see where you are and what to run next:

```bash
pnpm soulmaker paper:sniper:workflow --candidates candidates.json --preflight preflight.json --decision decision.json
```

It prints each stage's status (`done` / `ready` / `blocked` / `todo`) and the single recommended NEXT
command. It only DESCRIBES the sequence — it runs nothing.

### 1. Validate candidates

Author a candidate list (operator-friendly raw input is fine — see
[`examples/sniper/`](../examples/sniper/README.md)):

```json
{ "sourceLabel": "my-watchlist", "candidates": [ { "candidateId": "c1", "mint": "<32-byte base58 mint>", "sourceTag": "manual" } ] }
```

```bash
pnpm soulmaker paper:sniper:candidates:validate --input candidates.json --json > candidates.validated.json
```

Every mint is validated as a 32-byte Solana **public** key — secret-length / private-key-like input is
**refused** — candidate ids must be unique, and duplicate mints are surfaced as warnings. The optional
`observedLiquidityUsd` / market / social fields are operator-supplied intake metadata and are **not**
verified on-chain by this step.

### 2. Gather read-only inputs

For each candidate mint, produce the read-only inputs with the EXISTING read-only commands:

```bash
pnpm soulmaker token:inspect <mint> --json > c1.inspect.json   # mint/freeze authorities, decimals, supply, program
pnpm soulmaker token:risk <mint> --json > c1.risk.json         # advisory risk decision + flags + score
```

`token:inspect` uses read-only RPC; `token:risk` is a pure advisory engine over the inspected facts.
Neither accepts a key or sends anything.

### 3. Preflight

```bash
pnpm soulmaker paper:sniper:preflight --candidates candidates.json \
  --inspection c1=c1.inspect.json --risk c1=c1.risk.json --out preflight.json
```

Each candidate gets `pass` / `warn` / `fail` / `unknown`. A risk `REJECT` or a critical flag is a
`fail`; a `CAUTION`, a freeze/mint authority, or a high-severity flag is a `warn`; a candidate with no
inspection and no risk is `unknown`. This command is **local-only** (no RPC) — it consumes the JSON
from step 2.

### 4. Decide (paper-only)

```bash
# Optional rules: { "requirePreflightPass": true, "maxRiskScore": 60, "minObservedLiquidityUsd": 1000, "denyMints": [] }
pnpm soulmaker paper:sniper:decide --candidates candidates.json --preflight preflight.json --rules rules.json --out decision.json
```

Each candidate gets `skip` / `watch` / `paper-enter` / `paper-reject` / `unknown`. A candidate reaches
`paper-enter` **only** when the preflight passed and every rule is satisfied — and even then it is a
**simulated** decision, never an order.

#### Machine-readable reason codes (Sprint 46)

Add `--schema-version v2` to emit `sniper.paper.decision.report.v2` — the same decisions plus stable
**reason codes** (e.g. `preflight-fail`, `risk-score-exceeds-cap`, `policy-paper-enter-disabled`) with
per-candidate trails, blocking/warning/policy/risk subsets, and sorted summary counts. Tooling should
read the codes, never the free-text reasons. The default stays v1; an existing v1 artifact can be
lifted with `upgradePaperSniperDecisionReportV1ToV2` (structured fields only — codes from an upgrade
are a conservative subset). Codes are integrity/risk explanations, **not** trading advice.

```bash
pnpm soulmaker paper:sniper:decide --candidates candidates.json --preflight preflight.json --schema-version v2 --json
```

#### Governing a run with a policy (Sprint 32)

Instead of ad-hoc `--rules`, an operator can govern a run with an explicit, versioned **policy**
(`sniper.policy.config.v1`, conservative by default — see `examples/sniper/policy.example.json`):

```bash
pnpm soulmaker paper:sniper:policy:validate --input policy.json --json     # validate + normalize first
pnpm soulmaker paper:sniper:decide --candidates candidates.json --preflight preflight.json --policy policy.json --out decision.json
```

`--policy` (mutually exclusive with `--rules`) derives the base rules (driving the build) and then applies
the policy's **tighten-only** enforcement: `allowPaperEnter` (off ⇒ no paper-enter), fail-closed on
unknown preflight / missing risk, `disallowedRiskFlags`, `duplicateMintPolicy`, and a
`paperSizing.maxCandidatesToPaperEnter` cap. Enforcement can only make the run **more** conservative —
never the reverse, and never live. The output is still a `sniper.paper.decision.report.v1`.

### 5. Run report (bundle the run)

Bundle the artifacts into one navigable report an operator (or CI) can read at a glance:

```bash
pnpm soulmaker paper:sniper:report --candidates candidates.json \
  --preflight preflight.json --decisions decision.json --workflow workflow.json \
  --operator "alice@run-7" --out run.json
```

The candidate list is the spine; the preflight, decision, and workflow are optional and strictly
validated (a sub-artifact referencing a candidate id not in the list is refused as a wrong pairing).
The report carries a per-candidate **reason trail** (each candidate's preflight status + simulated
decision, with provenance-prefixed reasons), the grouped id lists (`paperEnterIds`, `paperRejectIds`,
`skipIds`, `watchIds`, `riskBlockedIds`, `watchedMissingInfoIds`, `preflightFailedIds`,
`preflightUnknownIds`, `invalidCandidateIds`), a compact **navigation** index, and a CI section. Every
status/decision is carried **verbatim** — the report re-derives nothing. It writes nothing unless
`--out`. CI gates: `--fail-on-invalid`, `--fail-on-preflight-fail`, `--fail-on-risk`,
`--fail-on-paper-enter`, `--fail-on-unknown`, `--fail-on-missing-recommended`. A `paper-enter` carried
through is a **simulated** classification, never an order.

### 6. Run report diff (run-vs-run)

Compare two run reports (e.g. yesterday vs today) to see exactly what moved:

```bash
pnpm soulmaker paper:sniper:diff:report --base run-yesterday.json --next run-today.json
pnpm soulmaker paper:sniper:diff:report --base run-yesterday.json --next run-today.json --json --fail-on-new-risk
```

It pairs candidates by id and reports membership changes (added / removed / common), per-candidate
**decision** and **preflight-status** transitions, the directional id lists (`newlyInvalidIds`,
`newlyPreflightFailedIds`, `newlyRiskBlockedIds`, `newlyPaperEnterIds`, `noLongerPaperEnterIds`,
`newlyUnknownIds`, `noLongerUnknownIds`, `recoveryIds`), and the aggregate deltas. The `recovery` signal
fires only when a candidate that had a concern (invalid / preflight-fail / risk-blocked / unknown) in the
base has **none** in the next. It reads the two files only and **writes nothing**. CI gates:
`--fail-on-change`, `--fail-on-new-invalid`, `--fail-on-new-preflight-fail`, `--fail-on-new-risk`,
`--fail-on-new-paper-enter`, `--fail-on-new-unknown`.

### 7. Audit log (provenance)

Leave a deterministic audit trail for a run — required before any future Phase 6 simulation:

```bash
pnpm soulmaker paper:sniper:audit --report run.json --label "2025-06-09-run-7" --out audit.json
pnpm soulmaker paper:sniper:audit --report run.json --label "run-7" --note "manual review ok" --json --fail-on-failure
```

It derives one entry per pipeline step (intake → preflight → decide → report) from the run report, with
the step's input/output artifact labels, a one-line decision summary, and its warnings + failures (all
verbatim). A recommended-but-absent step (preflight/decision) is recorded `ran: false`, not omitted. The
log carries **no wall-clock time** — `--label` is an operator-supplied string, never system time — so the
same run report yields a byte-identical log. It reads the run report only and **writes nothing** unless
`--out`. CI gates: `--fail-on-failure`, `--fail-on-warning`.

### 8. Session pack (bundle the whole session)

Collect every artifact of a run into one navigable pack for archival / review:

```bash
pnpm soulmaker paper:sniper:session:pack \
  --artifact candidates=candidates.json --artifact preflight=preflight.json \
  --artifact decision=decision.json --artifact run=run.json --artifact audit=audit.json \
  --label "2025-06-09-session" --out session.json
```

Pack the **canonical** artifacts (each with a `schemaVersion`) — e.g. the candidate list emitted by
`paper:sniper:candidates:validate --json`, not the raw intake file. Each `--artifact label=path` is
classified by its schema: a known sniper schema is strictly validated (a corrupt one claiming a known
schema is refused) and its flags are read verbatim, while an unknown schema is surfaced as `unsupported`.
The pack's coverage tiers (`isMinimal` / `isDecisionReady` / `isAudited`) describe **presence only** —
they never claim completeness, correctness, or trading readiness. It reads the named files only and
**writes nothing** unless `--out`. CI gates: `--fail-on-risk`, `--fail-on-unknown`,
`--fail-on-paper-enter`, `--fail-on-unsupported`.

### 9. Safety gates (fail-closed pre-simulation check)

Before relying on a session, run the fail-closed safety gates over its session pack:

```bash
pnpm soulmaker paper:sniper:safety:gates --session session.json
#   → READY: NO if anything is missing or any unknown/risk-block/paper-enter is present (exit 1)

# Explicitly allow the expected conditions to reach READY (still local/paper only):
pnpm soulmaker paper:sniper:safety:gates --session session.json --allow-risk-block --allow-paper-enter --out gates.json
```

The gates check the required artifacts are present (candidate list / decision / audit log), that there
are no unsupported artifacts, and — gated by `--allow-unknown` / `--allow-risk-block` /
`--allow-paper-enter` — that there are no unknowns / risk blocks / simulated paper-enters. It is
**fail-closed**: a concern fails its gate unless you explicitly allow it, and the command **exits 1 when
not ready**. A `PHASE6_NOT_STARTED` gate is always present and the recommendation never authorizes Phase
6 — **passing is local/paper readiness only, never Phase 6 authorization.** It reads the session pack only
and **writes nothing** unless `--out`. CI: the non-zero exit IS the gate; add `--fail-on-warning` to also
fail on allowed-but-warned conditions.

### 10. Phase 6 prerequisite tracker (machine-readable checklist)

Track the boundary-spec prerequisites against a session pack:

```bash
pnpm soulmaker paper:phase6:prereqs --session session.json
pnpm soulmaker paper:phase6:prereqs --session session.json --json --fail-on-unmet
```

It reports the five **artifact** prerequisites (candidate intake / preflight / paper decisions / operator
config / audit logging) as `met` / `not-met` from the session pack, and the six **design** prerequisites
(operator workflow / risk limits / test coverage / kill-switch / secrets policy / burner isolation) as
`documented` (their design exists in the spec — **not** that Phase 6 implemented them). It implements **no
transaction planning** and can **never authorize Phase 6**: `phase6ImplementationStarted` is always false
and `requiresExplicitHumanApproval` always true. Even an all-prerequisites-addressed report is **not** a
go signal — beginning Phase 6 is an explicit human decision. `--fail-on-unmet` exits 1 when an artifact
prerequisite is missing.

### 11. Inert simulation intent plan (Phase 6 boundary — DATA ONLY)

The boundary spec's first, deliberately **inert** step — *type-contract data only*. It is **not
executable** and does nothing toward Phase 6 beyond letting the data shapes be reviewed:

```bash
pnpm soulmaker paper:phase6:intent:plan --decisions decision.json
pnpm soulmaker paper:phase6:intent:plan --decisions decision.json --amount-label small-test --amount-units 50 --out plan.json
```

It produces one **inert** entry per simulated `paper-enter`: a hypothetical side, an amount **label**
(never currency), reason codes, and the risk constraints / required operator approvals (**all
unsatisfied**) / future simulation checks a Phase 6 simulator would need. It holds **no destination, no
signer, no key, no executable field**; `executable` is always false. It builds, signs, simulates, and
sends **nothing**. It reads the decision report only and **writes nothing** unless `--out`. Phase 6 and
Phase 7 remain not started — beginning Phase 6 requires an explicit human decision.

Compare two inert plans (still not executable):

```bash
pnpm soulmaker paper:phase6:diff:intent --base plan-a.json --next plan-b.json --fail-on-new-entry
```

It pairs the hypothetical entries by id (added / removed / common) and reports amount label/unit changes.
The diff's `executable` flag is always false — comparing two non-executable plans executes nothing.

## How to inspect risk reasons

- The **preflight** entry for a candidate lists its `warnings`, `disqualifiers`, and a capped
  `risk.topFlags` (most-severe first). Run with `--json` to see the full structured entry.
- The **decision** entry lists `reasons`, `blockingRiskFlags` (the flags that caused a `paper-reject`),
  `appliedRules`, and `assumptions`.
- The underlying `token:risk` report has the complete advisory flag list with `detail` and `evidence`.

## CI gates

- `paper:sniper:candidates:validate --fail-on-warning` — fail on a duplicate mint, etc.
- `paper:sniper:preflight --fail-on-fail` / `--fail-on-warning`.
- `paper:sniper:decide --fail-on-paper-enter` (ensure nothing auto-enters) / `--fail-on-risk`.
- `paper:sniper:report --fail-on-invalid` / `--fail-on-preflight-fail` / `--fail-on-risk` /
  `--fail-on-paper-enter` / `--fail-on-unknown` / `--fail-on-missing-recommended` — gate the bundled run.
- `paper:sniper:diff:report --fail-on-change` / `--fail-on-new-invalid` / `--fail-on-new-preflight-fail` /
  `--fail-on-new-risk` / `--fail-on-new-paper-enter` / `--fail-on-new-unknown` — gate a run-vs-run diff.
- `paper:sniper:policy:validate --fail-on-warning` — gate a policy config that carries a warning.
- `paper:sniper:audit --fail-on-failure` / `--fail-on-warning` — gate a run's audit trail.
- `paper:sniper:session:pack --fail-on-risk` / `--fail-on-unknown` / `--fail-on-paper-enter` /
  `--fail-on-unsupported` — gate a bundled session.
- `paper:sniper:safety:gates` — exits 1 when NOT ready (fail-closed); `--allow-*` to permit expected
  conditions, `--fail-on-warning` to also fail on allowed-but-warned conditions.

## Security boundary

The full security review of this PAPER-only pipeline — the boundary, the ten invariants that hold it, and
the automated backstop tests that fail loudly if any is weakened — is in
[`SNIPER_SECURITY_REVIEW.md`](SNIPER_SECURITY_REVIEW.md).

## What is intentionally NOT implemented

- **No execution**: no order placement, no transaction build/sign/send, no wallet, no signer, no
  keypair, no seed phrase — anywhere.
- **No live snipe-list source**: candidates are local JSON the operator authors; there is no scraper or
  network fetch of opportunities.
- **No live RPC in the sniper commands**: the preflight is local-only (it consumes `token:inspect` /
  `token:risk` output). A live `--read-only-rpc` preflight mode is deferred, not faked.
- **No profitability, win-rate, or ROI claims** anywhere — these are integrity/safety artifacts, not
  performance results.

## Prerequisites before Phase 6 (transaction planning / simulation)

Phase 6 is **not started** and must not begin until ALL of these are stable:

1. Candidate intake stable (Sprint 25 ✅).
2. Token preflight stable (Sprint 26 ✅).
3. Paper decisions stable (Sprint 27 ✅).
4. Operator workflow + runbook stable (Sprint 28 ✅).
5. Risk limits / operator config stable and explicitly versioned.
6. Audit logging (Sprint 33 ✅ — `paper:sniper:audit`, deterministic, no wall-clock time) + a
   dry-run-by-default posture designed.
7. A kill-switch design.
8. A secrets policy and burner-wallet **isolation** design (no main-wallet config ever).
9. Test coverage for every boundary, and an explicit, documented **planner ⟂ signer** separation
   (the transaction planner must never have access to a signer).

Phase 6 itself is **planning + simulation only** — still no sending. The full boundary contract +
prerequisites are specified in [`PHASE_6_SIMULATION_BOUNDARY.md`](PHASE_6_SIMULATION_BOUNDARY.md); see
also [`ROADMAP.md`](ROADMAP.md) Phase 6.

## Prerequisites before Phase 7 (burner / live)

Phase 7 is **not started** and is gated behind Phases 0–6 being green PLUS:

- A fresh, isolated **burner** secret (the config must refuse anything main-wallet-shaped).
- Caps enforced **before** building/sending; simulate-before-send; redacted signature + risk logging.
- Live sending behind an explicit, loud opt-in (e.g. `DANGEROUS_BURNER_LIVE`) and operator approval.

None of this exists or is in scope for the current PAPER-only work.
