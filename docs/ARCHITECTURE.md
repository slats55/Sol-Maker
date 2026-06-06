# Soulmaker Architecture

## Goals

1. **Safety is structural, not procedural.** Unsafe actions should be
   *impossible by construction* in the current phase, not merely discouraged.
2. **Separation of live vs. simulated.** Read/build/simulate are separated from
   sign/send, with the live boundary guarded by a single, well-tested gate.
3. **Auditable.** Config is validated and explicit; secrets are redacted;
   eventual transactions are simulated and previewed before sending.
4. **Original, minimal, tested code.** Reference repos accelerate *design*, not
   copy-paste.

## Monorepo shape

TypeScript-first **pnpm workspace**. Internal packages are consumed by their
source (`exports: "./src/index.ts"`) and run/tested via `tsx`/Vitest, so there
is no build step required for development. `tsc --noEmit` typechecks the whole
tree in one pass.

```
apps/cli          @soulmaker/cli       read-only command surface
apps/web          (Phase 8)            local dashboard (placeholder)

packages/security @soulmaker/security  redaction + redacting logger      [no deps]
packages/core     @soulmaker/core      config, modes, caps, LIVE GATE    [zod]
packages/solana   @soulmaker/solana    read-only chain access (Phase 2)  [web3.js, spl-token, security]
packages/risk     @soulmaker/risk      token risk flags + scoring (Phase 3)   [security]
packages/paper    @soulmaker/paper     simulated paper trading (Phase 4)      [risk, security]
packages/strategy @soulmaker/strategy  paper-only strategy rules (Phase 5)    [risk, paper, security]
packages/backtest @soulmaker/backtest  deterministic simulated replay + scenario lint + report diff + scenario builders + suite runs/diffing + variant generation/explain + variant-sensitivity workflow/rankings/diff + suite coverage (Sprint 8–14)  [strategy, paper, security]
packages/adapters @soulmaker/adapters  audited external integrations (Phase 6+)
```

### Dependency direction

```
        cli ─────────────┐
         │               │
         ▼               ▼
       core  ◄────── (security)
         ▲               ▲
         │               │
  solana/risk/strategy/paper/adapters  (later phases)
```

- `@soulmaker/security` has **zero dependencies** and depends on nothing else in
  the repo. It is the redaction chokepoint and must stay tiny and auditable.
- `@soulmaker/core` owns config, modes, caps, and the **live gate** — the single
  source of truth for "is a live send allowed?".
- Everything that could touch the chain (solana, strategy, paper, adapters) sits
  *below* core and must route any live intent through core's gate. `solana` is
  now implemented as a **read-only** layer (Phase 2), `risk` as a **pure,
  advisory, read-only** engine (Phase 3), `paper` as a **pure, simulated-only**
  engine (Phase 4), and `strategy` as a **pure, paper-only** rules engine
  (Phase 5) whose output only feeds `paper`; `adapters` remains a typed
  placeholder. Note `@soulmaker/solana`, `@soulmaker/risk`, `@soulmaker/paper`,
  and `@soulmaker/strategy` depend on `@soulmaker/security` (for redaction) but
  **not** on `core` — the CLI is what composes config/modes (core) with the
  read-only client (solana), the risk engine (risk), the paper engine (paper),
  and the strategy engine (strategy). `@soulmaker/paper` depends on
  `@soulmaker/risk` for the advisory decision type; `@soulmaker/strategy` depends
  on `@soulmaker/risk` (advisory decision + score) and on `@soulmaker/paper`
  **types only** (to adapt a simulated `PaperState` into its portfolio view).
- `@soulmaker/backtest` (Sprint 8) sits **above** both strategy and paper: it
  depends on `@soulmaker/strategy` (run `planStrategyBatch`), `@soulmaker/paper`
  (run `runPaperSession`/journal reconstruction), and `@soulmaker/security`
  (redaction). Neither strategy nor paper depends on it, so there is **no cycle**
  and `@soulmaker/strategy` keeps its "decision-only, never runs a paper session"
  contract — the backtest is the orchestrator that drives a session. It is pure
  (no `core`, `solana`, `@solana/web3.js`, RPC, filesystem, network, `Date.now`,
  or `Math.random`).
- **(Sprint 10)** `@soulmaker/backtest` also exports pure, offline helpers that sit
  *beside* the replay engine rather than driving it: `validateBacktestReport` +
  `diffBacktestReports`/`formatBacktestReportDiff` (compare two already-produced
  report objects), and the scenario-authoring builders
  `buildExampleBacktestScenario`/`listBacktestScenarioTemplates` +
  `expandScenarioMatrix` (deterministic INJECTED scenario skeletons/variants). All
  are pure and non-mutating; the CLI (`paper:backtest:diff`,
  `paper:backtest:scenario:new`/`:matrix`) is the only layer that reads/writes
  files. A report diff is bookkeeping over two **simulations** — not a live result,
  prediction, or advice; generated scenarios are fixtures, not market data.
- **(Sprint 11)** `@soulmaker/backtest` adds a pure **suite** layer on top of the
  same primitives: `runBacktestSuite(input)` runs an ordered list of already-parsed
  scenarios through `lintBacktestScenario → runBacktest → validateBacktestReport`,
  `buildBacktestSuiteIndex(result)` aggregates a byte-stable index, and
  `diffBacktestSuites(base, next)` compares two indexes. The pure package still
  **never scans a directory or reads/writes a file** — the CLI
  (`paper:backtest:suite`, `paper:backtest:diff:suite`) owns all directory traversal
  and file I/O and hands the package already-parsed scenarios/indexes. A suite total
  is simulated bookkeeping summed over injected prices; a suite diff is the change
  between two simulated suites — never a live result, prediction, or advice.
- **(Sprint 12)** `@soulmaker/backtest` adds `generateScenarioVariants(base, plan)`:
  the relative-perturbation complement to `expandScenarioMatrix`. It applies a small,
  declarative plan of **bounded numeric perturbations** (`multiply`/`add`, clamped to
  explicit `[min, max]`) to a base scenario's injected `price` points and allowlisted
  candidate `metric.<field>` values, producing one validated variant per `suffix`. It
  is pure and non-mutating (no RNG, no `Date.now`, no expression/`eval`), touches only
  numbers that already exist (an empty match is refused), and protects `name`/`steps`/
  `initialJournal`/config so the INJECTED labelling survives. The CLI
  (`paper:backtest:scenario:variants`) owns all file I/O and preflights every output
  path before writing any; variants feed straight into the Sprint 11 suite + suite
  diff. Variants are simulated local scenario data — not a live result, not advice.
- **(Sprint 13)** `@soulmaker/backtest` adds `runScenarioVariantSensitivity({ base,
  plan })` (plus `buildScenarioVariantSensitivityReport`,
  `validateScenarioVariantSensitivityReport`,
  `formatScenarioVariantSensitivityReport`; schema `backtest.sensitivity.v1`): one
  pure report layer ON TOP of Sprints 11 + 12 that re-implements nothing. It calls
  `generateScenarioVariants` to build the variants, then runs the **base once as a
  baseline** plus every variant through the SAME `runBacktestSuite` path (so it also
  emits a real `suite-index.json`), and summarizes each variant's per-field **delta
  versus the baseline** over the existing report fields. Pure and non-mutating (the
  base runs on a deep copy) with **no timestamps**, so the report is byte-stable. The
  CLI (`paper:backtest:sensitivity`) owns all file I/O and preflights every output
  path before writing any. A delta is the change between two simulated runs — not a
  prediction, not advice, not a profitability claim.
- **(Sprint 14)** `@soulmaker/backtest` adds the **paper research lab** — five pure
  slices on top of Sprints 11–13, each a deterministic, byte-stable, non-mutating
  report layer that re-implements no engine logic:
  - the `backtest.sensitivity.v1` report gains a deterministic `rankings` block
    (built inside `sensitivity.ts`) ordering diffable variants by the magnitude of each
    real per-field delta — largest movement, never a "best"/"winner" ordering;
  - `explainScenarioVariantPlan` (in `scenario-variants.ts`; schema
    `backtest.variant-plan.explain.v1`) DRY-RUNS a plan, reusing the SAME private
    normalize/apply helpers as `generateScenarioVariants` so validation never diverges;
  - `sensitivity-diff.ts` (`diffScenarioVariantSensitivityReports`; schema
    `backtest.sensitivity.diff.v1`) diffs two sensitivity reports paired by suffix —
    the sensitivity analogue of `suite-diff.ts`, with a conservative same-digest-drift
    regression rule and `schemaVersion`-lenient validation;
  - `generateScenarioVariants` gains a `"config.<field>"` target over a CLOSED
    allowlist of unambiguous numeric config fields (no path traversal, no mint filter);
  - `coverage.ts` (`summarizeBacktestSuiteCoverage`; schema `backtest.coverage.v1`)
    summarizes which simulated paper paths a suite index exercised — behavioural
    bookkeeping coverage, explicitly **not** market or test coverage.
  The CLI adds `paper:backtest:scenario:variants:explain`,
  `paper:backtest:diff:sensitivity`, and `paper:backtest:suite:coverage`; all read only
  local JSON, write nothing, and run no backtest.

## The live boundary

There is exactly **one** way to be allowed to sign/send: pass
`assertLiveModeAllowed(config, env)` in `packages/core/src/live-gate.ts`. It
fails **closed** and requires *all* of:

- `mode === "DANGEROUS_BURNER_LIVE"`
- `killSwitch === false`
- `live.acknowledgeBurnerRisk === true`
- `live.confirmFreshBurner === true`
- `live.burnerKeyEnvVar` set **and** that env var present
- `SOULMAKER_I_UNDERSTAND_BURNER_RISK === "true"` in the environment
- caps within hard limits

Mode → capability mapping lives in `packages/core/src/modes.ts`
(`capabilitiesFor`): only `DANGEROUS_BURNER_LIVE` has `canSend: true`. In the
current repo **no code consumes `canSend`/the gate to actually send** — there is
no signing/sending implementation at all. The gate and capability model exist so
that when execution is built (Phase 7) it has exactly one door to go through.

## Read-only Solana layer (`@soulmaker/solana`, Phase 2)

A small, read-only layer over `@solana/web3.js` / `@solana/spl-token`:

- `public-key.ts` — `parsePublicKey` / `isValidPublicKey` / `publicKeyToBase58`.
  Validates 32-byte public keys and **refuses secret-length input** (anything
  longer than a 44-char public key — e.g. an ~88-char secret key — is rejected
  with a pointed message). There is no path that treats input as a private key.
- `rpc-client.ts` — `createReadOnlySolanaClient(config)` builds a `Connection`
  and returns a **frozen** object exposing only read methods: `getRpcHealth`,
  `getVersion`, `getSolBalance`, `getTokenAccounts`, `getTokenMintInfo`. There is
  no `sendTransaction`/`signTransaction`/`requestAirdrop`/signer — a test asserts
  none exist and that the object is frozen. The client depends on a narrow
  `SolanaRpcLike` seam (a read-only subset of `Connection`), so unit tests inject
  an in-memory fake and never hit the network.
- `wallet-watch.ts` / `token-inspect.ts` — assemble structured, redacted reports
  (SOL balance + token accounts; mint decimals/supply/authorities) with an
  injectable clock for deterministic tests, plus human-readable formatters.

The endpoint is only ever shown as a **host** (`new URL(rpcUrl).host`), which
drops any `?api-key=` query, and all rendered output is passed through
`redactString` as a backstop. The CLI gates these commands on
`capabilitiesFor(mode).canReadChain` and refuses in `PAPER` mode unless
`--allow-paper-read` is passed; none of them require any burner/live env var.

## Read-only risk engine (`@soulmaker/risk`, Phase 3)

A **pure**, advisory layer that turns read-only mint facts into structured risk
flags and a numeric score. It depends only on `@soulmaker/security` (for the
redaction backstop) — not on `core` or `solana`, and not on the network. It
holds no signer, secret key, or keypair, and builds/signs/simulates/sends
nothing.

- `lists.ts` — pure allow/deny/previously-traded utilities (`parseList`,
  `dedupeList`, `listIncludes`); case-preserving (base58 is case-sensitive),
  comment/blank-aware, duplicate-detecting. No file I/O (the CLI reads files).
- `risk-flags.ts` — `evaluateRiskFlags(input)`: deterministic, ordered,
  explained flags. Unknown facts become cautions, never assumed safe.
- `risk-score.ts` — `scoreRiskFlags(flags)`: per-severity weights + allowlist
  credit, clamped to `[0, 100]`, plus the decision (`REJECT` / `CAUTION` /
  `PASS_FOR_PAPER_EVALUATION`). Any critical flag forces `REJECT`.
- `risk-report.ts` — `buildTokenRiskReport(input, { now })` (injectable clock →
  deterministic) and `formatTokenRiskReport` (redacted human block).

**Data flow:**

```
@soulmaker/solana  getTokenMintInfo / buildTokenInspectReport   (read-only chain facts)
        │  mint, decimals, supply, authorities, program, initialized
        ▼
CLI  tokenRiskReport  ──+── reads operator list files → parseList (pure)
        │               └── maps facts + lists → TokenRiskInput
        ▼
@soulmaker/risk  buildTokenRiskReport  → flags + advisory score + decision
        ▼
CLI  formatTokenRiskReport (human) | JSON.stringify(redactValue(report))  (--json)
```

The CLI's `token:risk` reuses the same `openChainRead` gate as the other Phase 2
read commands (capability + `rpcUrl`, `--allow-paper-read` for PAPER), validates
the mint, and is read-only end to end. The report is **advisory only** and is
explicitly **not** a buy recommendation.

## Paper trading engine (`@soulmaker/paper`, Phase 4)

A **pure**, deterministic, **simulated-only** trading sandbox. It depends only on
`@soulmaker/risk` (for the advisory decision) and `@soulmaker/security` (redaction
backstop) — no `core`, no `solana`, no `@solana/web3.js`, no RPC, no filesystem,
no signer/keypair/transaction, and no DEX/execution SDK. Identical input →
byte-identical output (seeded ids, injectable clock).

- `types.ts` — simulated orders/fills/positions, caps, journal event union.
- `engine.ts` — pure reducers (`applyBuyFill`, `applySellFill`, `markUnrealized`)
  with weighted-average cost basis; never mutates input state.
- `caps.ts` — `checkBuyCaps` (kill switch, trade size, daily loss, open
  positions, optional per-position ceiling), evaluated **before** every action.
- `run.ts` — `runPaperSession`: risk filter → caps → simulated fills → TP/SL
  sweep → summary; returns ordered journal events + final state + summary. An
  optional injected `startingState` (Sprint 8, cloned via `cloneState` so the
  caller's object is never mutated) lets a run **continue** an existing simulated
  portfolio: sells, caps, and PnL all see the carried-forward positions. Omitting
  it preserves the original empty-state behavior exactly.
- `journal.ts` — pure (de)serialization + `reduceJournal` replay; malformed
  lines are reported, never fatal. `deriveStateFromJournalText` (Sprint 7) is the
  **strict** variant (parse + reduce + fill-payload validation) used by
  `strategy:plan --journal` and by `paper:run --journal` continuation.
- `report.ts` — `summarize` + redacted human formatter + JSON envelope (always
  carries the `PAPER ONLY` banner + "nothing was built/signed/simulated/sent").

**Data flow:**

```
@soulmaker/risk decision ──► PaperCandidate ─┐
injected price points ───────────────────────┤
CLI paper:run  → runPaperSession(caps, candidates, prices, TP/SL)
        │  events[] + PaperState + PaperRunSummary
        ▼
CLI: formatPaperReport (human) | JSON envelope (--json) | append JSONL journal
        ▲
CLI paper:journal / paper:status  → parseJournal + reduceJournal (pure)
```

The CLI owns all file I/O: it reads injected candidate/price fixtures, **appends**
(never truncates) to the JSONL journal, and prints redacted human or JSON output.
`paper:run` needs no chain access and no wallet; the `--kill-switch` flag is
OR-ed with the core config kill switch so a global stop also halts paper runs.

**Journal-continuing runs (Sprint 8).** With `--journal`, `paper:run` is stateful:
the CLI reads an existing journal **first** and strictly derives the run's
`startingState` via `deriveStateFromJournalText`. A malformed line or invalid fill
is **refused before anything is appended** (a journal used as authoritative state
must not silently drop events); a missing journal starts from the empty state and
is created on append; a valid journal is only ever appended to. This makes
`strategy:plan --journal` → `paper:run --journal` a real paper-only loop — a sell
candidate derived from the journal now finds its open simulated position instead
of being rejected with "no open simulated position". The lenient read-only summary
commands (`paper:journal` / `paper:status`) keep their tolerant display behavior;
only the **stateful** run/planning paths use the strict derivation.

## Strategy rules engine (`@soulmaker/strategy`, Phase 5)

A **pure**, deterministic, **paper-only** decision layer. It turns one advisory
`@soulmaker/risk` report plus injected, read-only metrics into a single decision —
`SKIP` / `WATCH` / `PAPER_BUY_CANDIDATE` / `PAPER_SELL_CANDIDATE` — whose only
consumer is `@soulmaker/paper`. It depends on `@soulmaker/risk` (advisory decision
+ score), `@soulmaker/paper` **types only** (to adapt a `PaperState` and to emit
`PaperCandidate[]` from the Sprint 6 plan pipeline), and `@soulmaker/security`
(redaction backstop) — no `core`, no `solana`, no
`@solana/web3.js`, no RPC, no filesystem, no signer/keypair/transaction, no
`Date.now`, no `Math.random`. Identical input → byte-identical output (seeded id,
injectable clock).

- `types.ts` — `StrategyCandidate` / `StrategyConfig` / `StrategyReport` /
  `StrategyDecision` / `StrategyReason` / `StrategyPortfolio`.
- `reasons.ts` — the stable kebab-case reason/disqualifier id catalog so tests
  assert exact behavior.
- `score.ts` — `scoreCandidate`: a transparent additive 0–100 model (neutral base
  − risk penalty + metric bonuses), clamped, with exported constants.
- `evaluate.ts` — `evaluateStrategy`: risk gate → entry metric gates → cooldowns →
  score → decide. Disqualifiers always override the score; never mutates input. For
  held positions it delegates the exit decision to `exits.ts` and records a
  structured `report.exit`.
- `exits.ts` (Sprint 7) — `decideSimulatedExit`: the pure exit-decision model
  (stop-loss → trailing-stop → take-profit → partial take-profit → hold),
  evaluated risk-first, producing a `SimulatedExitPlan` (`FULL_EXIT` /
  `PARTIAL_EXIT` / `HOLD`). A partial exit is sized from an injected/derived
  position size or the engine holds; deterministic and pure.
- `report.ts` — `formatStrategyReport` (redacted human block) + JSON envelope,
  always carrying the PAPER-ONLY / not-advice language.
- `portfolio.ts` — `portfolioFromPaperState`: pure adapter from a simulated
  `PaperState` to the engine's lightweight portfolio view (open count, held
  mints, top concentration, and **per-mint cost basis** for position-aware
  partial-exit sizing).
- `plan.ts` (Sprint 6) — the **batch plan pipeline**: `planStrategyBatch`
  (evaluate a `StrategyCandidate[]` → `StrategyPlanResult`),
  `strategyReportToPaperCandidate` (convert a paper-eligible decision → a
  `PaperCandidate`, carrying the advisory risk report + provenance),
  `buildPaperCandidateBatch`, and `formatStrategyPlanReport` / the JSON envelope.
  Pure: only `PaperCandidate` / `PaperState` **types** from `@soulmaker/paper`,
  no runtime coupling. `WATCH`/`SKIP` are never converted; disqualifiers can never
  be bypassed; order and duplicate mints are preserved.

**Data flow:**

```
@soulmaker/risk  TokenRiskReport (decision + score)     injected metrics
        │                                                      │
        ▼                                                      ▼
   StrategyCandidate ────────► evaluateStrategy(candidate, config, portfolio?)
   (+ optional PaperState ─ portfolioFromPaperState ─► StrategyPortfolio)
        │  StrategyReport (decision, score, reasons, disqualifiers, risk*, notes)
        ▼
CLI strategy:evaluate  → formatStrategyReport (human) | JSON envelope (--json)

   StrategyCandidate[] ─► planStrategyBatch ─► StrategyPlanResult
        │  (PAPER_BUY/SELL_CANDIDATE → PaperCandidate; WATCH/SKIP omitted)
        ▼
CLI strategy:plan  → human | JSON envelope | --out writes ONLY PaperCandidate[]
        ▼
   operator MANUALLY → paper:run   (no auto-chaining; never execution)
```

The CLI's `strategy:evaluate` (one candidate) and `strategy:plan` (a batch) read
injected local JSON only, refuse missing/malformed input cleanly (the batch
reports a malformed entry **with its array index**), and redact all output
(human, `--json`, and the `--out` file). `strategy:plan` produces a plan only — it
never invokes `paper:run`, creates fills, or writes a journal. Its optional
`--journal <path>` (Sprint 7) derives the simulated `PaperState` from a
**read-only** paper journal (via `@soulmaker/paper`'s `deriveStateFromJournalText`)
instead of a `--paper-state` snapshot; the two are mutually exclusive, the journal
is never written or mutated, and a malformed journal/invalid fill is refused. The
output is **paper-only** and explicitly **not** financial advice, a buy
recommendation, or live-trading authorization. A **forbidden-import regression
test** (`no-forbidden-imports.test.ts`) asserts the package source (now including
`exits.ts`) imports no `@solana/web3*`, `fs`/`node:fs`, `http(s)`, or `ws`. See
[`STRATEGY_MODEL.md`](STRATEGY_MODEL.md).

## Backtest / replay engine (`@soulmaker/backtest`, Sprint 8)

A **pure**, deterministic, **simulated-only** replay engine that bridges
journal-continuing paper runs and historical replay. It orchestrates the SAME
production code paths the manual loop uses — `planStrategyBatch` (decide) then
`runPaperSession` started from the carried-forward state (simulate) — over an
ordered list of injected **steps**, and reports a deterministic summary. It
depends on `@soulmaker/strategy`, `@soulmaker/paper`, and `@soulmaker/security`;
nothing depends on it (no cycle). No `core`, `solana`, `@solana/web3.js`, RPC,
filesystem, network, `Date.now`, or `Math.random` — the only clock is each step's
injected `at`, so a given scenario yields **byte-stable** output.

- `types.ts` — `BacktestScenario` (a self-contained artifact: embedded
  `strategyConfig` + `caps` + ordered `steps` + optional seed `initialJournal`),
  `BacktestStep`, `BacktestStepResult`, `BacktestReport`, plus the Sprint 9 lint
  types (`BacktestLintIssue`, `BacktestScenarioLintResult`/`…Summary`) and report
  aggregates (`BacktestEquityPoint`, `BacktestPerMintAggregate`).
- `lint.ts` (Sprint 9) — the shared structural-validation **core**
  (`collectScenarioIssues`, non-throwing, collects every blocking problem and, when
  clean, returns the narrowed scenario), `computeScenarioWarnings` (suspicious-but-
  allowed design), and `lintBacktestScenario` → `{ valid, errors, warnings, summary }`.
  Pure, deterministic, non-mutating; never runs the backtest.
- `digest.ts` (Sprint 9) — `canonicalize` (recursive key-sorted JSON) + `digestContent`
  (a dependency-free, **non-cryptographic** FNV-1a content digest — for
  reproducibility/traceability only, never security; no `node:crypto`, keeping the
  package pure).
- `backtest.ts` — `validateBacktestScenario` (the throwing wrapper over the lint
  core; `validateScenario` is a back-compatible alias) and `runBacktest`: seed
  (optional, via `deriveStateFromJournalText`) → per step `planStrategyBatch` →
  `runPaperSession` (continued) → final `reduceJournal` + `markFinalUnrealized` +
  `summarize`. It now also emits the `equityCurve` (one sample per step), **exact**
  `perMint` aggregates (realized PnL recomputed from each mint's own fills), the
  `scenarioDigest`, `schemaVersion`, and the scenario `warnings`. The scenario is
  never mutated.
- `report.ts` — `formatBacktestReport` (sectioned, redacted human block:
  Scenario / Warnings / Summary / Equity curve / Per-mint / Open positions / Steps /
  Notes) + the required labels: **SIMULATED PAPER-ONLY REPORT**, *uses injected
  historical data only*, *not a live result*, *not financial advice*, *not a
  profitability claim*.
- `report-validate.ts` / `diff.ts` / `templates.ts` / `matrix.ts` (Sprint 10) — the
  pure, offline helpers that sit *beside* the engine: strict report validation, the
  two-report diff (`diffBacktestReports`/`formatBacktestReportDiff`), and the
  deterministic INJECTED scenario builders (`buildExampleBacktestScenario`,
  `expandScenarioMatrix`).
- `suite.ts` / `suite-report.ts` / `suite-validate.ts` / `suite-diff.ts` (Sprint 11)
  — the pure **suite** layer: `runBacktestSuite`/`buildBacktestSuiteIndex`/
  `formatBacktestSuiteIndex` (run an ordered list of already-parsed scenarios and
  aggregate a byte-stable `backtest.suite.v1` index), `validateBacktestSuiteIndex`
  (strict index validation), and `diffBacktestSuites`/`formatBacktestSuiteDiff`
  (`backtest.suite.diff.v1`: pair by digest → name → file, aggregate deltas, a
  conservative `hasRegression`). All still pure — the package never scans a directory
  or reads/writes a file.
- `scenario-variants.ts` (Sprint 12; **config targets Sprint 14**) — the pure variant
  generator `generateScenarioVariants(base, plan)`: bounded numeric perturbations
  (`multiply`/`add`, clamped) over the allowlisted `price` / `metric.<field>` /
  `config.<field>` targets, one validated variant per `suffix`. No RNG, no clock, no
  I/O; protects `name`/`steps`/`initialJournal`/non-allowlisted config; refuses an
  empty match and an arbitrary dotted path. **(Sprint 14)** also hosts
  `explainScenarioVariantPlan` (+ `validate…`/`format…`; schema
  `backtest.variant-plan.explain.v1`), a DRY-RUN inspector reusing the same private
  normalize/apply helpers.
- `sensitivity.ts` (Sprint 13; **rankings Sprint 14**) — the pure **variant-sensitivity**
  workflow `runScenarioVariantSensitivity({ base, plan })` (+ `build…Report`/
  `validate…Report`/`format…Report`; schema `backtest.sensitivity.v1`). It composes the
  two layers above: generate variants, run the base once as a baseline + every variant
  through `runBacktestSuite`, and report each variant's per-field delta vs the baseline
  plus a deterministic `rankings` block. No RNG, no clock, no timestamps, no I/O, no
  input mutation → byte-stable report. No backtest/suite/variant logic is re-implemented.
- `sensitivity-diff.ts` (Sprint 14) — the pure sensitivity-report diff
  `diffScenarioVariantSensitivityReports(base, next)` (+ `validate…`/`format…`; schema
  `backtest.sensitivity.diff.v1`): pair variants by suffix, report added/removed/changed
  + baseline/count deltas + ranking movement, with a conservative `hasRegression`
  (same-digest drift only) and `schemaVersion`-lenient validation. The sensitivity
  analogue of `suite-diff.ts`.
- `coverage.ts` (Sprint 14) — the pure suite-coverage summary
  `summarizeBacktestSuiteCoverage(index)` (+ `validate…`/`format…`; schema
  `backtest.coverage.v1`): per-behaviour scenario counts, any-behaviour flags, scenario
  lists, and a path-behaviour coverage ratio over existing index fields. Behavioural
  bookkeeping coverage only — not market/test coverage.

**Data flow:**

```
BacktestScenario (config + caps + steps[, initialJournal])
        │  per step (carrying simulated state forward):
        ▼
  planStrategyBatch(candidates, config, paperState) ─► PaperCandidate[]
        ▼
  runPaperSession(caps, candidates, prices, startingState) ─► events + state
        ▼  (all steps)
  reduceJournal(seed+steps) → markFinalUnrealized → summarize → BacktestReport
        ▼
CLI paper:backtest  → human | --json | --out writes ONLY the report JSON
```

**Suite data flow (Sprint 11):**

```
CLI paper:backtest:suite --dir <scenarios/>
        │  read+parse *.scenario.json (sorted, BOM-tolerant; malformed ⇒ refuse)
        ▼
  runBacktestSuite({ scenarios })   per entry: lint → runBacktest → validate
        ▼
  buildBacktestSuiteIndex(result)   ─► byte-stable suite-index.json (backtest.suite.v1)
        ▼
  --out-dir writes one report per PASSED scenario + suite-index.json (never a journal)

CLI paper:backtest:diff:suite --base-dir <a/> --next-dir <b/>
        │  read each dir's suite-index.json (BOM-tolerant; missing/malformed ⇒ refuse)
        ▼
  diffBacktestSuites(base, next)  ─► added/removed/changed + aggregate deltas + hasRegression
```

**Variant data flow (Sprint 12):**

```
CLI paper:backtest:scenario:variants --base <a> --plan <p> --out-dir <d>
        │  read+parse base scenario + variant plan (BOM-tolerant; malformed ⇒ refuse)
        ▼
  generateScenarioVariants(base, plan)   per variant: clone → apply bounded
        │                                 perturbations (price / metric.<field>) → validate
        ▼
  preflight every <stem>.<suffix>.scenario.json (collisions + existing) ⇒ no partial writes
        ▼
  write one validated INJECTED scenario per variant  →  feed paper:backtest:suite
```

**Sensitivity data flow (Sprint 13):**

```
CLI paper:backtest:sensitivity --base <a> --plan <p> [--out-dir <d>]
        │  read+parse base scenario + variant plan (BOM-tolerant; malformed ⇒ refuse)
        ▼
  runScenarioVariantSensitivity({ base, plan })
        │   generateScenarioVariants(base, plan)            (Sprint 12; invalid base/plan ⇒ refuse)
        │   runBacktestSuite({ base-as-baseline, ...variants })   (Sprint 11; lint→run→validate)
        │   buildScenarioVariantSensitivityReport(suite, variants)  per-field Δ vs baseline
        ▼
  byte-stable sensitivity-report.json (backtest.sensitivity.v1) — no timestamps
        ▼
  --out-dir: preflight ALL targets (collisions + existing) ⇒ no partial writes, then write
             variants/ + reports/<id>.report.json + reports/suite-index.json + sensitivity-report.json
```

The CLI's `paper:backtest` reads ONE local JSON scenario, refuses malformed input
cleanly, redacts all output, and never writes a journal or any fills (`--out`
writes the report JSON only). The report uses **injected historical data only** —
it is **not** a live result, a profitability claim, or financial advice. The
command lives beside the other `paper:*` commands because its artifact is a
paper-simulation report; the strategy layer is an internal driver. A
**forbidden-import regression test** asserts the package imports no
`@solana/web3*`, `fs`/`node:fs`, `http(s)`, or `ws`.

**Sprint 9 CLI surface.** `paper:backtest:lint --scenario <path> [--json]`
validates/lints a scenario **without** running it (errors refuse with exit 1;
warnings stay runnable). `paper:backtest --seed-journal <path>` seeds the run from
an external JSONL journal — composed onto a scenario **copy** at the CLI layer so
the pure engine stays scenario-driven; it is mutually exclusive with an embedded
`initialJournal` (both ⇒ refuse), read strictly, never written, and the scenario
file is never modified. All local JSON readers (and journal reads) tolerate a
single leading UTF-8 **BOM** via `stripJsonBom` (malformed JSON still refuses; a
mid-content BOM is never stripped). Copyable, **injected** example scenarios live
under `examples/backtest/` (fixtures, not market truth). See
[`PAPER_TRADING_MODEL.md`](PAPER_TRADING_MODEL.md).

## Configuration

- Sources, lowest→highest precedence: **schema defaults → `soulmaker.config.json`
  → `SOULMAKER_*` env vars** (`packages/core/src/config/load.ts`).
- Validated by a **strict** Zod schema (`schema.ts`): unknown keys rejected,
  hard caps enforced via `.max()`, redaction non-disableable via a refinement.
- `null` in JSON is treated as "unset" so optional fields fall back to defaults.

## Logging & redaction

- `@soulmaker/security` provides `createLogger`, a small JSON-lines logger with
  a **pino-compatible** interface (`info/warn/error/debug/child`). We own this
  boundary deliberately: redaction runs over **every field of every record** via
  pattern matching (bearer tokens, long base58/hex blobs, mnemonics, api-key
  query params) **and** key-name matching (`privateKey`, `seed`, `cookie`, …).
- Rationale for not starting with a third-party logger's path-based redaction: a
  secret must be scrubbed even when logged under an unexpected key or inside a
  free-form string. The interface is intentionally compatible so we can mount it
  onto a pino transport later for rotation/shipping without changing callers.

## Testing

- **Vitest**, configured at the root. Unit tests live beside code
  (`*.test.ts`). Cross-package integration tests will live in `tests/`.
- Security-critical behavior has **negative** tests: redaction proves secrets do
  not appear in output; the live gate proves it refuses unsafe config; the schema
  proves it rejects oversized caps and disabled redaction.

## Why this stack

- **TypeScript + Zod** → types *and* runtime validation of untrusted config.
- **pnpm workspace** → clear package boundaries; the security package can be kept
  dependency-free and small.
- **Vitest + tsx** → fast, no build step in dev.
- **@solana/web3.js / @solana/spl-token** (Phase 2+) → standard, read-only first.
- **OctoBot** (GPL, Python) informs the *separation of live vs. simulated*,
  strategy-engine, and paper-trading concepts only — no code is copied. See
  [`REFERENCE_REPO_AUDIT.md`](REFERENCE_REPO_AUDIT.md).
