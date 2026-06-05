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
  sweep → summary; returns ordered journal events + final state + summary.
- `journal.ts` — pure (de)serialization + `reduceJournal` replay; malformed
  lines are reported, never fatal.
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

## Strategy rules engine (`@soulmaker/strategy`, Phase 5)

A **pure**, deterministic, **paper-only** decision layer. It turns one advisory
`@soulmaker/risk` report plus injected, read-only metrics into a single decision —
`SKIP` / `WATCH` / `PAPER_BUY_CANDIDATE` / `PAPER_SELL_CANDIDATE` — whose only
consumer is `@soulmaker/paper`. It depends on `@soulmaker/risk` (advisory decision
+ score), `@soulmaker/paper` **types only** (to adapt a `PaperState`), and
`@soulmaker/security` (redaction backstop) — no `core`, no `solana`, no
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
  score → decide. Disqualifiers always override the score; never mutates input.
- `report.ts` — `formatStrategyReport` (redacted human block) + JSON envelope,
  always carrying the PAPER-ONLY / not-advice language.
- `portfolio.ts` — `portfolioFromPaperState`: pure adapter from a simulated
  `PaperState` to the engine's lightweight portfolio view (open count, held
  mints, top concentration).

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
        ▼
   feeds @soulmaker/paper ONLY (a paper candidate) — never execution
```

The CLI's `strategy:evaluate` reads injected local JSON only (candidate + config,
optional paper-state), refuses missing/malformed input cleanly, and redacts all
output. The report is **paper-only** and explicitly **not** financial advice, a
buy recommendation, or live-trading authorization. See
[`STRATEGY_MODEL.md`](STRATEGY_MODEL.md).

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
