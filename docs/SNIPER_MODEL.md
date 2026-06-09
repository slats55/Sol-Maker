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
4. **Operator workflow** (Sprint 28 — planned) — fixtures + a runbook tying the path together.
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

## What is intentionally NOT here yet

- **No operator runbook / end-to-end workflow helper** yet — that is Sprint 28.
- **No transaction planning / signing / sending / wallet / burner** — Phases 6 and 7, not started.
