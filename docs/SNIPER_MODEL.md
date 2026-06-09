# Soulmaker Sniper Model (PAPER-only, offline)

This document describes the **sniper decision-support** path: the safe, deterministic, offline layers
a Solana sniper bot needs **before** any live capability exists. It is the product direction the
research/PAPER foundation has been building toward — candidate intake → token preflight → paper-only
decisions → operator workflow → (much later, behind heavy safety work) a simulation boundary and only
then any live/burner trading.

> **Everything here is PAPER-only and offline.** Nothing in `@soulmaker/sniper` holds a wallet, key,
> seed phrase, signer, or keypair; nothing builds, signs, simulates, or sends a transaction; nothing
> places an order or trades live. A sniper "decision" (later sprints) is a **simulated/paper** decision
> only. Phase 6 (transaction planning/simulation) and Phase 7 (burner/live trading) are **not started**.

## Why a separate `@soulmaker/sniper` package

The sniper path is its own domain, distinct from the backtest/research stack. It lives in a new pure
package `@soulmaker/sniper` (deps: only `@soulmaker/security` today) so it can be reused by the CLI
without polluting the backtest package. Crucially, the package carries **no chain capability**: it does
**not** import `@solana/web3.js` or `@soulmaker/solana`. A forbidden-import regression test enforces
this. Any read-only on-chain inspection (a later preflight sprint) is done by the CLI using existing
read-only utilities and passed into the pure builders as already-loaded data — the pure modules never
do I/O, network, or RPC themselves.

## The product path

1. **Candidate intake** (Sprint 25 — implemented) — a validated local list of candidate mints.
2. **Token preflight** (Sprint 26 — implemented) — a read-only safety/research summary per candidate,
   reusing existing read-only Solana inspection + advisory risk output; never a trade signal.
3. **Paper-only decisions** (Sprint 27 — implemented) — candidate list + preflight + operator rules →
   a simulated `skip` / `watch` / `paper-enter` / `paper-reject` / `unknown` decision per candidate.
4. **Operator workflow** (Sprint 28 — implemented) — a `paper:sniper:workflow` helper + the
   [`SNIPER_RUNBOOK.md`](SNIPER_RUNBOOK.md) tying the path together.
5. **Phase 6 simulation boundary** (Sprint 29 — spec only, no implementation).
6. **Simulation engine**, then **burner/live** — only after heavy, explicit safety work.

## Candidate intake (Sprint 25)

A sniper bot needs a safe, validated INTAKE layer before it can score, paper-simulate, or act on a
token. `@soulmaker/sniper` provides it as a pure, deterministic, offline module.

### Schema — `sniper.candidate.list.v1`

A candidate list carries the PAPER-ONLY banner + disclaimers, an optional `sourceLabel`, a
`candidateCount`, the `candidates` array (in input order — operator priority is data), the derived
`distinctMints` / `duplicateMints`, and `warnings` / `notes`. Each **candidate** supports:

- `candidateId` (required, unique) and `mint` (required, validated 32-byte Solana public key);
- optional `symbol`, `name`, `sourceTag`, `sourceNote`;
- optional operator-OBSERVED `observedLiquidityUsd`, `observedMarketCapUsd`, `observedVolumeUsd`
  (non-negative numbers — **operator-supplied, NOT verified on-chain here**);
- optional `socialRefs` (plain strings — **never fetched**);
- optional `observedAtLabel` / `createdLabel` (operator-supplied **strings**, never system time);
- `tags` and `operatorNotes` (string arrays).

### APIs (`@soulmaker/sniper`)

- `normalizeSniperCandidateList(input)` — build a canonical, byte-stable list from operator-friendly
  raw input (`{candidates: [...]}`, with or without a `schemaVersion`). Validates every mint, enforces
  unique candidate ids, surfaces duplicate mints as warnings, fills optional fields to explicit
  `null` / `[]`, and preserves input order. Pure, non-mutating, and **idempotent**.
- `validateSniperCandidateList(value)` — strict backstop validator for a canonical list read from disk.
- `formatSniperCandidateList(list)` — redacted, stable, human-readable rendering.
- `parseMintAddress(input)` / `isValidMintAddress(input)` — pure base58 mint validation (no
  `@solana/web3.js`), mirroring `@soulmaker/solana`'s safety semantics: a valid 32-byte public key
  base58-encodes to 32–44 chars; **anything longer is refused before decoding** (a 64-byte secret key
  base58-encodes to ~88 chars), and the too-long error never echoes the input.
- `SniperCandidateListError`, `InvalidMintAddressError`, and the schema/banner/disclaimer constants.

### Safety rules enforced

- A mint must decode to **exactly 32 bytes** of valid base58; secret-length / private-key-like input is
  **refused** (and never echoed back).
- `candidateId`s must be **unique** (a duplicate id is refused).
- Duplicate **mints** are allowed (the same mint may be observed from two sources) but surfaced as a
  **warning** (and listed in `duplicateMints`).
- An empty list is refused by default (`allowEmpty` opts in).
- Inputs are never mutated; output is deterministic and carries **no wall-clock time**.

### CLI — `paper:sniper:candidates:validate`

```bash
pnpm soulmaker paper:sniper:candidates:validate --input <candidates.json>
pnpm soulmaker paper:sniper:candidates:validate --input <candidates.json> --json
pnpm soulmaker paper:sniper:candidates:validate --input <candidates.json> --fail-on-warning
```

Reads only the named local file (BOM-tolerant). If the file carries a `schemaVersion`, it must be
`sniper.candidate.list.v1` (so the command can't be pointed at, say, a portfolio report). It validates
and normalizes, prints a human summary by default or the canonical list with `--json`, and exits 1 on
malformed JSON / wrong schema / unsafe key-like input (or on any warning with `--fail-on-warning`). It
**writes nothing**, makes no network / RPC call, and touches no wallet. A worked example lives in
[`examples/sniper/`](../examples/sniper/README.md).

## Token preflight (Sprint 26)

The preflight is the next safety gate after intake: for each candidate it combines the mint's
public-key validity, an **already-loaded** read-only on-chain inspection, and an **already-loaded**
advisory risk report into a single status — `pass` / `warn` / `fail` / `unknown` — with explicit
warnings and disqualifying reasons. It is a safety/research summary, **not a trade signal**.

### Keeping I/O and chain capability out of the pure layer

`buildSniperTokenPreflightReport` is **pure**: it does NO on-chain reads itself. The inspection and
risk inputs are values the CLI loaded from **local files** — typically the JSON output of the existing
read-only `token:inspect` (mint/freeze authorities, decimals, supply, program) and `token:risk`
(advisory decision + flags + score) commands. The builder validates/projects those defensively (a
malformed value is treated as absent for that field; a mint mismatch is surfaced as a warning) and
never fetches anything. `@soulmaker/sniper` still imports **no chain capability** — only the pure
`@soulmaker/risk` decision/severity type unions and `@soulmaker/security` for redaction.

### Schema — `sniper.token.preflight.report.v1`

Carries the PAPER-ONLY banner + disclaimers, the `sourceLabel`, a per-candidate `candidates` array,
the `pass` / `warn` / `fail` / `unknown` tally (+ `missingDataCount`), conservative `hasFail` /
`hasWarn` / `hasUnknown` flags, and a CI section (`wouldFailOnFail` / `wouldFailOnWarning` +
`ciFailReasons`). Each **entry** has `candidateId`, `mint`, `mintValid`, a projected `inspection`
summary (or null), a projected `risk` summary (or null), `warnings`, `disqualifiers`, and `status`.

### Conservative status logic (deterministic, honest)

- **fail** — a disqualifier fired: the mint is invalid, the advisory risk decision is `REJECT`, or
  there is ≥1 `critical` risk flag.
- **warn** — a softer concern: risk decision `CAUTION`, a `high`-severity flag, a **freeze authority**
  (the token can be frozen — you may not be able to sell), a **mint authority** (dilution/rug risk),
  an uninitialized mint, or a supplied inspection/risk whose mint doesn't match the candidate.
- **unknown** — no inspection AND no risk data was supplied for that candidate (it can't be assessed).
- **pass** — data was supplied and no concern was found. A `pass` is **not** a "safe to trade"
  judgment and **not** a buy/sell signal.

### CLI — `paper:sniper:preflight`

```bash
# Produce the read-only inputs with the EXISTING read-only commands (operator-run), keeping each as JSON:
#   pnpm soulmaker token:inspect <mint> --json > c1.inspect.json     # read-only mint facts
#   pnpm soulmaker token:risk    <mint> --json > c1.risk.json        # advisory risk report
# Then preflight the candidate list against those local files:
pnpm soulmaker paper:sniper:preflight --candidates <candidates.json> \
  --inspection c1=c1.inspect.json --risk c1=c1.risk.json
pnpm soulmaker paper:sniper:preflight --candidates <candidates.json> --risk c1=c1.risk.json --json
pnpm soulmaker paper:sniper:preflight --candidates <candidates.json> --risk c1=c1.risk.json --out preflight.json
pnpm soulmaker paper:sniper:preflight --candidates <candidates.json> --risk c1=c1.risk.json --fail-on-fail
```

`--inspection` / `--risk` are repeatable `candidateId=path` specs. The command is **LOCAL-ONLY**: it
performs no RPC, makes no network call, and touches no wallet — it only reads the named local files.
It writes nothing unless `--out` is given (then only the report JSON, refusing to overwrite without
`--force`, creating no directories). `--fail-on-fail` / `--fail-on-warning` set the exit code. A
candidate with no `--inspection` and no `--risk` is reported as `unknown`.

> **Live read-only RPC mode is deferred, not faked.** A future `--read-only-rpc` mode could fetch the
> inspection live via the existing read-only `@soulmaker/solana` client (never accepting a key,
> never signing/sending/building a transaction), but CI cannot depend on the network, so it is **not**
> implemented yet. Today, produce the inspection/risk inputs with the existing read-only commands and
> feed them in as local files.

## Paper-only decisions (Sprint 27)

The decision pipeline is the first real sniper-bot-shaped step: it folds a validated candidate list, an
(optional) preflight report, and a small set of deterministic operator **rules** into a per-candidate
**simulated** decision. It is **pure** — it consumes the already-built preflight, re-derives no risk,
reads no chain, and the package still carries no chain capability.

> A `paper-enter` is a **SIMULATED, paper-only** decision — it is **not** a buy/sell order, **not** a
> transaction, and **not** live-trading readiness. Nothing here holds a key or builds/signs/sends a
> transaction.

### Schema — `sniper.paper.decision.report.v1`

Carries the PAPER-ONLY banner + disclaimers, the `sourceLabel`, `hasPreflight`, the **resolved rules**
actually applied (assumptions made explicit), a per-candidate `decisions` array, the
`skip` / `watch` / `paper-enter` / `paper-reject` / `unknown` tally, conservative `hasPaperEnter` /
`hasPaperReject` / `hasRiskReject` flags, and a CI section (`wouldFailOnPaperEnter` / `wouldFailOnRisk`
+ `ciFailReasons`). Each **entry** has `candidateId`, `mint`, `decision`, the `preflightStatus` it was
based on, `reasons`, `blockingRiskFlags`, `appliedRules`, and `assumptions`.

### The five decisions (conservative — `paper-enter` only when EVERY criterion passes)

- **skip** — structurally excluded before evaluation: the mint is on the operator denylist, or it
  failed validation.
- **paper-reject** — evaluated and hard-rejected: the preflight **failed**, or a risk score exceeds the
  rule cap. (A reject is an integrity/risk decision, never a sell order.)
- **watch** — a soft hold: the preflight **warned**, the preflight could not assess it (`unknown`), no
  preflight was supplied, or observed liquidity is below the rule floor. Watch = "gather more / keep
  observing before any paper entry".
- **paper-enter** — the preflight **passed** and every entry rule is satisfied. Simulated only.
- **unknown** — a defensive fallback for an unrecognized preflight status.

### Operator rules (`SniperDecisionRules`, all optional; resolved defaults echoed)

- `requirePreflightPass` (default `true`).
- `maxRiskScore` (default none) — reject when a supplied risk score exceeds it.
- `minObservedLiquidityUsd` (default none) — watch when observed liquidity is null or below it.
- `denyMints` (default `[]`) — skip these mints outright.

### CLI — `paper:sniper:decide`

```bash
pnpm soulmaker paper:sniper:decide --candidates <candidates.json> --preflight <preflight.json>
pnpm soulmaker paper:sniper:decide --candidates <candidates.json> --preflight <preflight.json> --rules <rules.json> --json
pnpm soulmaker paper:sniper:decide --candidates <candidates.json> --preflight <preflight.json> --out decision.json
pnpm soulmaker paper:sniper:decide --candidates <candidates.json> --preflight <preflight.json> --fail-on-paper-enter
pnpm soulmaker paper:sniper:decide --candidates <candidates.json> --preflight <preflight.json> --fail-on-risk
```

`--preflight` and `--rules` are optional (without a preflight, every candidate is conservatively
`watch`ed). The command reads only the named files and **writes nothing** unless `--out` is given (then
only the report JSON, refusing overwrite without `--force`). `--fail-on-paper-enter` is a useful CI
gate to ensure no candidate auto-enters; `--fail-on-risk` trips when any candidate was rejected on
risk. No network, no wallet, no transaction build/sign/send.

## Operator workflow (Sprint 28)

`paper:sniper:workflow` is the operator's "where am I / what do I run next" helper. The pure
`buildSniperWorkflowPlan` (schema `sniper.workflow.plan.v1`) takes the per-stage artifact STATES
(present? valid?) — the CLI checks file existence + light validity read-only and hands those in — and
produces a deterministic ordered plan: each stage (`candidates` → `preflight` → `decide`) marked
`done` / `ready` / `blocked` / `todo`, its command, and the single recommended NEXT command.
`preflight` and `decide` are `blocked` until `candidates` is `done`; an invalid present artifact is
always `blocked`. It **describes** the sequence only — it executes no stage, runs no live action, makes
no network call, and touches no wallet. The full operator walkthrough is in
[`SNIPER_RUNBOOK.md`](SNIPER_RUNBOOK.md).

## Sniper run report (Sprint 30)

The run report is the **navigation + summary** layer over the whole sniper path — the sniper analogue
of the research artifact pack. The pure `buildSniperRunReport` (schema `sniper.run.report.v1`) takes the
candidate list as the **spine** and folds in the optional, strictly-validated preflight, decision, and
workflow artifacts. It is **pure** — the CLI loads the files and hands the parsed values in; the package
still carries no chain capability.

> Every preflight status and decision is carried **VERBATIM** — the report re-derives nothing. A
> `paper-enter` carried through is a **SIMULATED, paper-only** classification — **not** a buy/sell order,
> a transaction, or live-trading readiness.

### Schema — `sniper.run.report.v1`

Carries the PAPER-ONLY banner + disclaimers, an optional `operatorLabel`, the `sourceLabel`, the
`candidateCount`, an `artifactsPresent` block, projected `preflightSummary` / `decisionSummary` /
`workflowSummary` (each null when absent), a per-candidate `candidates` array (each entry: `candidateId`,
`mint`, `mintValid`, `preflightStatus`, `decision`, `riskBlocked`, `watchedMissingInfo`, a merged
`reasons` trail, and `blockingRiskFlags`), the grouped id lists (`paperEnterIds`, `paperRejectIds`,
`skipIds`, `watchIds`, `decisionUnknownIds`, `preflightFailedIds`, `preflightUnknownIds`,
`riskBlockedIds`, `watchedMissingInfoIds`, `invalidCandidateIds`), the CI flags (`hasInvalidCandidate`,
`hasPreflightFailure`, `hasRiskBlock`, `hasPaperEnter`, `hasUnknown`, `hasMissingRecommendedArtifact`),
the `failReasons`, and a compact `navigation` index (only non-empty groups).

### Joining + pairing rules (conservative, honest)

- The **candidate list defines the candidate set + order**. Each candidate is joined to its preflight
  entry and decision entry by `candidateId`.
- A preflight / decision entry that references a `candidateId` **not** in the list is **refused** (the
  operator paired the wrong artifacts).
- A list candidate that a sub-artifact does not cover keeps a `null` `preflightStatus` / `decision` — the
  report never fabricates a status it was not given.
- `mintValid` is read **verbatim** from a supplied preflight entry (a list candidate is always valid, but
  a hand-edited preflight reporting an invalid mint is surfaced as `hasInvalidCandidate`).
- A missing preflight **or** decision sets `hasMissingRecommendedArtifact` (the workflow plan is
  informational, not a recommended-artifact gate).

### CLI — `paper:sniper:report`

```bash
pnpm soulmaker paper:sniper:report --candidates <candidates.json> \
  --preflight <preflight.json> --decisions <decision.json> --workflow <workflow.json> \
  --operator "alice@run-7" --out run.json
pnpm soulmaker paper:sniper:report --candidates <candidates.json> --json
pnpm soulmaker paper:sniper:report --candidates <candidates.json> --preflight <preflight.json> --fail-on-risk
```

`--preflight`, `--decisions`, `--workflow`, and `--operator` are optional. The command reads only the
named files and **writes nothing** unless `--out` is given (then only the report JSON, refusing overwrite
without `--force`, creating no directories). The `--fail-on-*` flags
(`--fail-on-invalid` / `--fail-on-preflight-fail` / `--fail-on-risk` / `--fail-on-paper-enter` /
`--fail-on-unknown` / `--fail-on-missing-recommended`) set the exit code. No network, no wallet, no
transaction build/sign/send.

## Sniper run report diff (Sprint 31)

The run report diff is the **comparison** layer over the run report. The pure `diffSniperRunReports(base,
next)` (schema `sniper.run.report.diff.v1`) strictly validates two `sniper.run.report.v1` artifacts and
pairs candidates by `candidateId`. It separates two axes:

- **Membership** — `candidatesAdded` (in next, not base), `candidatesRemoved` (in base, not next), and the
  common set (`commonCount`).
- **Per-candidate transitions over the common set** — `decisionChanges` and `preflightStatusChanges`
  (each `{candidateId, from, to}`), plus the directional id lists: `newlyInvalidIds`,
  `newlyPreflightFailedIds`, `newlyRiskBlockedIds`, `newlyPaperEnterIds`, `noLongerPaperEnterIds`,
  `newlyUnknownIds`, `noLongerUnknownIds`, and `recoveryIds`.

It also carries aggregate `deltas` (next − base over the derived group sizes) and the conservative CI
flags: `hasChange` (any difference), `hasNewInvalid` / `hasNewPreflightFailure` / `hasNewRiskBlock` /
`hasNewPaperEnter` / `hasNewUnknown`, and `hasRecovery`. **Recovery** is honest and conservative: it
fires only when a candidate that had a *concern* (invalid OR preflight-fail OR risk-blocked OR unknown) in
the base has **none** of those in the next. Every transition is computed **VERBATIM** from the two
reports — the diff re-derives nothing.

### CLI — `paper:sniper:diff:report`

```bash
pnpm soulmaker paper:sniper:diff:report --base <run-a.json> --next <run-b.json>
pnpm soulmaker paper:sniper:diff:report --base <run-a.json> --next <run-b.json> --json --fail-on-new-risk
```

It reads only the two named files and **writes nothing**. The `--fail-on-*` flags (`--fail-on-change`,
`--fail-on-new-invalid`, `--fail-on-new-preflight-fail`, `--fail-on-new-risk`, `--fail-on-new-paper-enter`,
`--fail-on-new-unknown`) set the exit code. A `paper-enter` transition is a change between two
**simulated** classifications, never an order.

## Sniper policy config (Sprint 32)

The policy config makes the assumptions a paper run is governed by **explicit and versioned**, instead of
implicit. The pure `normalizeSniperPolicyConfig` (schema `sniper.policy.config.v1`) builds a canonical,
**conservative-by-default** config; `enforceSniperPolicy` applies it to a built decision report.

> A policy enables **no live behaviour** — there is no key, signer, wallet, or sending field anywhere in
> it. Its enforcement is **tighten-only**: it can downgrade a SIMULATED `paper-enter` to `watch` /
> `paper-reject` or skip a candidate, but it can **never** turn a non-enter into an enter, and it makes no
> currency, profit, ROI, or win-rate claim.

### Fields

- **Base decision rules** (projected onto the existing `SniperDecisionRules` by
  `deriveSniperDecisionRules`, so they drive the decision *build*): `requirePreflightPass`, `maxRiskScore`,
  `minObservedLiquidityUsd`, `denyMints`.
- **Tighten-only enforcement** (applied *after* the build by `enforceSniperPolicy`): `allowPaperEnter` (the
  decision-mode gate — when false, no candidate may paper-enter), `failClosedOnUnknownPreflight` (a watch
  driven by an unknown / absent preflight becomes `paper-reject`), `failClosedOnMissingRisk` (a paper-enter
  with no supplied risk data becomes `watch`), and `disallowedRiskFlags` (a candidate whose preflight risk
  carries a disallowed flag id is `paper-reject`ed — needs the preflight, which `decide` supplies).
- **Candidate-list guards**: `maxCandidatesPerRun` (a longer run is flagged, never silently truncated) and
  `duplicateMintPolicy` (`allow` / `warn` / `reject` — `reject` skips the duplicate-mint candidates).
- **Operator labels**: `policyLabel`, `operatorLabels`.
- **Paper sizing assumptions** (LABELS / simulated units only): `budgetLabel` (an operator label, **not**
  real funds), `maxPaperPositionUnits` (a simulated unit cap, **not** a currency amount), and
  `maxCandidatesToPaperEnter` (cap on simulated paper-enters per run — excess is watched).

### CLI

```bash
pnpm soulmaker paper:sniper:policy:validate --input <policy.json>
pnpm soulmaker paper:sniper:policy:validate --input <policy.json> --json --fail-on-warning
# Govern a decision run with a policy (mutually exclusive with --rules):
pnpm soulmaker paper:sniper:decide --candidates <candidates.json> --preflight <preflight.json> --policy <policy.json>
```

`paper:sniper:policy:validate` reads only the named file and **writes nothing**. On `paper:sniper:decide`,
`--policy` derives the base rules (driving the build) and then applies the tighten-only enforcement; the
resulting decision report is still a valid `sniper.paper.decision.report.v1` (so it pipes straight into the
run report). A worked example policy is in [`examples/sniper/policy.example.json`](../examples/sniper/README.md).

## Sniper audit log (Sprint 33)

The audit log is a deterministic **provenance** record of a paper run — a prerequisite before any Phase 6
simulation can be contemplated. The pure `buildSniperAuditLog` (schema `sniper.audit.log.v1`) derives it
from a single run report: one entry per pipeline step (candidate intake → token preflight → paper decision
→ run report), each with input/output artifact **labels**, a one-line decision summary, and the step's
warnings + failures — all read **verbatim** from the run report.

> The audit log carries **NO wall-clock time**. Every "when" is an operator-supplied LABEL (`runLabel` /
> step labels), never `Date.now()`, so the same run report yields a byte-identical log. A dedicated safety
> test forbids `Date.now`, `new Date`, and `Math.random` in the module.

A recommended-but-absent step (preflight / decision) is recorded with `ran: false` rather than omitted, so
the trail is complete and honest. The log surfaces the run's aggregate signals (`hasFailure`,
`hasWarning`, `hasPaperEnter`, `hasRiskBlock`, `hasUnknown`, `hasMissingRecommendedArtifact`).

### CLI — `paper:sniper:audit`

```bash
pnpm soulmaker paper:sniper:audit --report <run.json> --label "2025-06-09-run-7" --out audit.json
pnpm soulmaker paper:sniper:audit --report <run.json> --label "run-7" --note "reviewed" --json --fail-on-failure
```

It reads the run report only and **writes nothing** unless `--out`. `--fail-on-failure` /
`--fail-on-warning` set the exit code. Provenance over a SIMULATED run — never a live result or an order.

## Sniper session pack (Sprint 34)

The session pack is the sniper analogue of the research artifact pack — it bundles a whole local operator
session into one navigable artifact. The pure `buildSniperSessionPack` (schema `sniper.session.pack.v1`)
takes an already-loaded set of artifacts and classifies each by its `schemaVersion` against a registry of
the **eight known** sniper schemas (candidate list, token preflight, paper decision, workflow plan, run
report, run report diff, policy config, audit log).

> Pack the **canonical** artifacts (each carrying a `schemaVersion`) — e.g. the candidate list from
> `paper:sniper:candidates:validate --json`, not the raw intake file. A known schema is **strictly
> validated** (a corrupt artifact claiming a known schema is **refused**) and its high-level flags are
> read **verbatim**; an unknown / absent schema becomes an `unsupported` entry — surfaced honestly, never
> silently trusted.

The pack reports per-artifact flags (`hasPaperEnter` / `hasRiskBlock` / `hasUnknown` / `hasFailure`, each
`null` when not applicable to that kind), `recognizedCount` / `unsupportedCount`, the classified
`kindsPresent`, and **presence-only** chain-coverage tiers: `isMinimal` (a candidate list is present),
`isDecisionReady` (candidate list + preflight + decision present), and `isAudited` (decision-ready plus a
run report and an audit log present). These tiers describe **presence only** — never completeness,
correctness, or trading readiness. Duplicate labels are refused.

### CLI — `paper:sniper:session:pack`

```bash
pnpm soulmaker paper:sniper:session:pack \
  --artifact candidates=candidates.json --artifact preflight=preflight.json \
  --artifact decision=decision.json --artifact run=run.json --artifact audit=audit.json \
  --label "session-7" --out session.json
```

It reads the named files only and **writes nothing** unless `--out`. The `--fail-on-*` flags
(`--fail-on-risk`, `--fail-on-unknown`, `--fail-on-paper-enter`, `--fail-on-unsupported`) set the exit
code. A `paper-enter` flag carried through is a **simulated** classification, never an order.

## Operator safety gates (Sprint 39)

The safety gates are a deterministic, **fail-closed** check that a paper session is in a safe, complete
state — the gate an operator runs before relying on a session (and a prerequisite posture before any
future Phase 6 work). The pure `buildSniperSafetyGatesReport` (schema `sniper.safety.gates.report.v1`)
evaluates a gate set over a single session pack.

> **Fail-closed.** A concern (an unknown classification, a risk block, a SIMULATED paper-enter) is a
> **FAIL** unless the operator explicitly allowed it; a missing required artifact (candidate list,
> decision report, audit log) or an unsupported artifact is a **FAIL**. The command **exits 1 when not
> ready**. Passing every gate is **LOCAL/PAPER readiness only — NOT authorization to start Phase 6,
> build/sign/send a transaction, or trade.** A `PHASE6_NOT_STARTED` gate is always present and the
> recommendation never authorizes Phase 6.

### Gates

- **Required presence:** `CANDIDATE_LIST_PRESENT`, `DECISION_PRESENT`, `AUDIT_LOG_PRESENT` (each fails if
  absent — these block readiness).
- **Recommended presence:** `PREFLIGHT_PRESENT`, `RUN_REPORT_PRESENT`, `POLICY_PRESENT` (each warns if
  absent — recommended, not blocking).
- **`NO_UNSUPPORTED_ARTIFACT`:** fails if the session pack carries any unsupported artifact.
- **Allowance gates:** `NO_UNKNOWN`, `NO_RISK_BLOCK`, `NO_PAPER_ENTER` — each fails when the condition is
  present, unless the operator passes `--allow-unknown` / `--allow-risk-block` / `--allow-paper-enter`
  (which downgrades the fail to a warn). The resolved allowances are echoed in the report.
- **`PHASE6_NOT_STARTED`:** always `skip` — a reminder that Phase 6 is not started by design.

`ready` is true iff no **required** gate failed.

### CLI — `paper:sniper:safety:gates`

```bash
pnpm soulmaker paper:sniper:safety:gates --session session.json
pnpm soulmaker paper:sniper:safety:gates --session session.json --allow-risk-block --allow-paper-enter --out gates.json
```

It reads the session pack only and **writes nothing** unless `--out`. The non-zero exit when not ready IS
the gate; `--fail-on-warning` also fails on allowed-but-warned conditions.

## What is intentionally NOT here yet

- **No transaction planning / signing / sending / wallet / burner** — Phases 6 and 7, not started. The
  Phase 6 boundary prerequisites are listed in [`SNIPER_RUNBOOK.md`](SNIPER_RUNBOOK.md).
