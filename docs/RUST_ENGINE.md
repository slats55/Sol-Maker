# Rust engine sidecar (`solmaker-engine`)

Sprint 97 introduced Rust into Sol Maker as a **sidecar foundation** — not a
rewrite. TypeScript remains the orchestrator and the validation authority for
everything; the Rust engine is a separate process that, today, can only
describe itself.

## Why Rust is being introduced

The latency-sensitive READ paths planned for later sprints — realtime
candidate ingestion (S98), quote routing/scoring (S99), transaction
simulation and devnet execution support (S100) — benefit from a compiled,
GC-free engine. Introducing the crate now, behind the same artifact/validator
discipline the TypeScript system already enforces, means those hot paths land
into an audited boundary instead of creating one under time pressure.

No performance claim is made yet. The only latency measured today is the IPC
overhead itself (process spawn + JSON parse + validation), printed by
`engine:status` and explicitly labelled as never a trading-latency claim.

## What Rust does now (S97 foundation + S98 realtime replay)

- `crates/solmaker-engine` — a Cargo workspace member with exactly two
  dependencies (`serde`, `serde_json`; a tested allowlist refuses drift).
- `solmaker-engine status [--json] [--created-at <iso>]` — emits the
  `engine.status.report.v1` artifact: engine identity, build profile, rustc
  version (embedded at build time), IPC version, the CLOSED supported
  capability list (`status`, `json-ipc`, `schema-parity`,
  `realtime-replay-normalize`), the explicit disabled list, and safety
  markers.
- `solmaker-engine realtime-normalize [--json] [--created-at <iso>]` (S98) —
  reads ONE replay events document from BOUNDED stdin (2 MiB ceiling) and
  emits `engine.realtime.observations.report.v1`: candidate observations
  normalized exactly as `packages/realtime`'s replay adapter normalizes them
  (mint re-validation via a pure base58 decode, bounded labels, secret-shape
  dropping that mirrors `redactString`, duplicate-mint dedup keeping the
  first, provider-reported hints kept verbatim, replay caveats pinned byte
  for byte). A malformed document is refused with exit 2 — error messages
  carry indexes and lengths, never input values.
- Determinism: the engine reads **no clock, no environment variables, and no
  filesystem**; `--created-at` is supplied by the TypeScript orchestrator, so
  identical invocations produce byte-identical output.

## S99 quote/router scoring hot path

- `solmaker-engine quote-score [--json] --scored-at <iso> --max-quote-age-ms <n>`
  consumes a TypeScript-produced `routequote.fetch.report.v1` over the same
  bounded stdin and emits `engine.routequote.score.report.v1`: per-entry
  quote-quality scores (base 100 minus impact/hop/age penalties), a
  deterministic ranking (score desc → age asc → candidateId asc), and CLOSED
  reason codes (`not-observed`, `stale`, `future-timestamp`,
  `price-impact-high`, `impact-unavailable`, `hop-count-high/unknown`, …).
- **Freshness parity is a wall, not a test**: the engine mirrors
  `evaluateQuoteFreshness` (same closed verdict set, hand-built ISO-8601
  epoch arithmetic cross-checked against `Date.parse`), and the TypeScript
  validator RE-EVALUATES every entry with the real evaluator plus RECOMPUTES
  every score from its components and the full ranking — any disagreement
  refuses the whole artifact (`schema-mismatch`).
- The age cap is an EXPLICIT operator argument (`--max-quote-age-ms`,
  mirroring the no-default-cap principle of the freshness evaluator); the
  scoring instant is orchestrator-supplied (`--scored-at`) — the engine still
  reads no clock.
- A route score is INTELLIGENCE about quote quality — the artifact pins
  `notExecutable`, `notProfitabilityClaim`, `neverSigns`, `neverSends`,
  `phase7LiveTradingReady:false`, and the existing TypeScript quote path,
  freshness gates, and dry-run evidence chain are UNCHANGED (deliberate
  low-risk decision: the scorer is a standalone read-only analysis command,
  `engine:quote:score`, fed by `paper:routequote:fetch --out-dir` artifacts).
- The S99 network review again decided **NO Rust network access** — live
  quote fetching stays in TypeScript (`packages/quotefetch`).

## S100 transaction inspection + simulation classification

Sprint 100 is the first sprint where Rust touches transaction *bytes* — but
still only to READ them. Two new subcommands, both pure functions over their
input, both behind the same bounded-stdin + strict-TypeScript-validation
boundary:

- `solmaker-engine tx-inspect [--json] [--created-at <iso>]` — decode a
  strictly-UNSIGNED `txpreview.envelope.v1` from bounded stdin and emit
  `engine.tx.inspect.report.v1`: the same SHAPE facts the TypeScript
  `inspectUnsignedTransactionShape` produces (version + supported flag, real
  recent-blockhash presence, instruction count, account count, the
  statically-resolvable program ids, address-lookup-table count, and the count
  of instructions whose program id is ALT-loaded). The base64 decode and the
  Solana transaction wire-format parse are **hand-written in pure Rust** (no
  `solana-sdk`, no `bincode` — the dependency allowlist stays exactly
  `serde + serde_json`); a signed transaction (any non-zero signature slot) is
  refused with exit 2, mirroring the TypeScript envelope boundary.
- `solmaker-engine sim-classify [--json] [--created-at <iso>]` — read a bounded
  `{ errLabel, logs }` simulation result from stdin and emit
  `engine.sim.classification.report.v1`: the S95 CLOSED classification
  (`slippage-or-route-error`, `compute-exceeded`, `blockhash-error`,
  `account-error`, `program-error`, `unclassified-error`) plus the verbatim
  operator guidance. The pattern set mirrors `classifySimulationFailure` byte
  for byte.

**The TypeScript parity wall (authoritative).** Rust output is never trusted:

- for `tx-inspect`, the bridge independently re-runs the REAL
  `validateUnsignedTxEnvelope` + `inspectUnsignedTransactionShape`
  (`@solana/web3.js` decoder) on the same envelope and refuses the artifact
  unless every shape fact matches — so an artifact survives only when the
  hand-written Rust parser and the battle-tested web3.js decoder AGREE;
- for `sim-classify`, the bridge re-runs the REAL `classifySimulationFailure`
  on the same input and refuses on any disagreement.

A signed envelope, an unsupported version, or any envelope the TypeScript
authority rejects makes the bridge return `refused` — the Rust report is
discarded, never surfaced as truth.

**Decision — the Rust devnet SEND core is DECLINED this sprint.** Slice 4 of
the S100 plan (a Rust devnet-only execution/send core) was reviewed and
**not built**. Rationale, recorded here and in
[`EXECUTION_SAFETY.md`](EXECUTION_SAFETY.md):

- The engine's entire safety guarantee is that it *cannot* sign, send, open a
  socket, or load key material — enforced by a `serde + serde_json`-only
  dependency allowlist and dual-side capability scans. A devnet send core would
  require adding an RPC client (network), a signer, and keypair loading to the
  crate — dismantling that wall for an optional slice.
- The send path already exists, fully gated, in TypeScript
  (`packages/execution` — `resolveExecutionMode`, the signer boundary, the
  fourteen-condition live gate, the S96 session/reconciliation wall). Moving it
  into Rust would create a second send surface to audit, with no safety upside.
- The real devnet broadcast is still externally faucet-blocked, so there is no
  funded path to even exercise a Rust send core today.

**S101 preconditions** a future Rust devnet-send core would have to meet before
it could be reconsidered: a dedicated safety review expanding the dependency
allowlist with a written decision per crate; a Rust signer boundary that is
devnet-cluster-pinned and structurally cannot accept a mainnet endpoint;
keypair paths gitignored and never logged; invocation ONLY after the
TypeScript execution gate + session wall pass; reconciliation still through the
S96 layer; and capability-scan exceptions narrowed to the exact new tokens with
tests proving no mainnet reachability. Until all of that exists and is
authorized, the engine stays read-only.

## S101 sniper candidate scoring hot path

- `solmaker-engine sniper-score [--json] [--created-at <iso>]` consumes a
  TypeScript-produced `sniper.score.input.v1` bundle of already-collected
  facts over the same bounded stdin and emits `engine.sniper.score.report.v1`:
  a deterministic per-candidate score (0–100, the clamped sum of six published
  component buckets — risk safety, quote quality, quote freshness, liquidity,
  token mechanics, simulation evidence), a CLOSED verdict (`watch` / `caution`
  / `reject` / `insufficient-evidence`), CLOSED reason codes, and a
  deterministic ranking (verdict rank desc → score desc → candidateId asc).
- **Scoring parity is a wall, not a test**: the TypeScript validator RE-DERIVES
  every component, the score, the verdict, the ordered reason set, and the full
  ranking from the echoed facts, AND cross-checks every echoed fact against the
  exact input bundle bytes — Rust can neither fabricate, drop, nor alter a
  candidate's facts. Any disagreement refuses the whole artifact
  (`schema-mismatch`). The validator also enforces the HARD gates
  independently: a `REJECT` risk decision, a critical risk flag, or a
  Token-2022 blocker can never be `watch`; a stale quote can never be `watch`.
- The scoring instant is orchestrator-supplied (`--created-at`); the engine
  reads no clock. Missing facts produce `insufficient-evidence`, never a fake
  green.
- A candidate score is INTELLIGENCE only — the artifact pins `notExecutable`,
  `notProfitabilityClaim`, `neverSigns`, `neverSends`,
  `phase7LiveTradingReady:false`, plus `scoreIsNotLiveReadiness:true` and
  `highScoreIsNotSafeToTrade:true`. A high score never overrides a risk gate, a
  rejected risk stays rejected, and the score satisfies none of the fourteen
  mainnet live-gate conditions and gates nothing. The existing risk,
  execution, and dry-run evidence chains are UNCHANGED (deliberate low-risk
  decision: scoring is a standalone read-only command, `engine:sniper:score`,
  fed by a `sniper.score.input.v1` bundle). See
  [`SNIPER_SCORING.md`](SNIPER_SCORING.md) for the full design + safety
  boundary.
- The dependency allowlist stays exactly `serde + serde_json`; the S101 review
  again decided **NO Rust network access** — feeds, risk, and quote fetching
  all stay in TypeScript.

## S98 realtime hot path — how it flows

```
replay file ──(CLI reads, bounded)──▶ engine-bridge ──stdin──▶ solmaker-engine realtime-normalize
                                                                      │ stdout (one JSON doc)
   realtime.candidates.snapshot.v1 ◀── buildRealtimeCandidatesSnapshot ◀── STRICT TypeScript validation
```

- `pnpm soulmaker paper:realtime:snapshot --source replay --replay-file <f> --engine rust`
  runs the Rust normalizer; **the snapshot artifact is byte-identical to the
  TypeScript path's** for the same file (proven by tests and by a real run:
  `snapshot.json`/`candidates.json` byte-equal across engines).
- TypeScript never repairs Rust output: the validator re-parses every mint,
  re-checks every label with the real `redactString`, pins the caveats byte
  for byte, recomputes the count identities, and refuses the whole artifact
  on any mismatch (`schema-mismatch`).
- A machine without a Rust engine gets an honest refusal (exit 1) telling the
  operator to install Rust or rerun with `--engine ts` — never a silent
  fallback, never a fake.
- The **network-capability review decided NO Rust network access** this
  sprint: the live Jupiter feed stays in TypeScript. See
  `crates/solmaker-engine/SAFETY.md` for the recorded decision.

## What Rust cannot do yet (and how that is enforced)

The engine has **no code path** for signing, sending, wallet/keypair/seed
handling, networking, or subprocesses. `signerSupport`, `sendSupport`, and
`mainnetSendSupport` are hard-coded `"disabled"` constants; there is no flag,
env var, or config that flips them. Enforcement is layered:

1. **Rust-side scan** (`crates/solmaker-engine/tests/safety_scan.rs`):
   forbidden capability tokens in `src/` fail `cargo test`; the dependency
   allowlist is pinned.
2. **TypeScript-side mirror** (`packages/engine-bridge/src/engine-safety.test.ts`):
   the same scan runs from `pnpm test` on every machine — the wall holds even
   where no Rust toolchain exists.
3. **Strict boundary validation**: the bridge refuses any artifact whose key
   set differs from the CLOSED schema or whose safety markers are anything
   but the literal `disabled`.

See [`../crates/solmaker-engine/SAFETY.md`](../crates/solmaker-engine/SAFETY.md).

## TypeScript ↔ Rust IPC (`engine.ipc.v1`)

- The orchestrator (`packages/engine-bridge`) invokes the engine with an
  **argument array** — never a shell string (`shell: false`, always).
- The argument vocabulary is a CLOSED allowlist (`status`,
  `realtime-normalize`, `--json`, `--created-at <iso>`); anything
  secret-shaped, path-shaped, or metacharacter-bearing is refused before a
  process exists. Replay content travels over stdin, never argv.
- The child environment is rebuilt from a NAME allowlist (PATH/cargo/rustup
  homes and Windows process basics); secret-shaped variables are never
  forwarded.
- stdout/stderr are capped at 1 MiB and execution at 30 s; the engine writes
  exactly one JSON document to stdout.
- Binary discovery: `target/release/` → `target/debug/` → `cargo run
  --quiet -p solmaker-engine --`. A machine with none of these gets a
  structured `unavailable` result — honest, exit 0, never a project failure
  (CI can opt into `--fail-on-unavailable`).

## Commands

| Command | What it does |
| --- | --- |
| `pnpm soulmaker engine:status` | Invoke the sidecar, validate, render (also `--json`, `--out <path>`, `--force`, `--fail-on-unavailable`) |
| `pnpm soulmaker paper:realtime:snapshot --engine rust` | S98: replay normalization through the Rust sidecar (`--source replay` only; byte-identical snapshot; honest refusal when no engine exists) |
| `pnpm soulmaker engine:quote:score --report <f> --max-quote-age-ms <n>` | S99: route-quote scoring intelligence over a fetch report (scores recomputed + freshness re-evaluated by TypeScript before acceptance) |
| `pnpm soulmaker engine:tx:inspect --envelope <f>` | S100: unsigned-transaction SHAPE inspection (facts re-derived by the real @solana/web3.js decoder before acceptance; a signed envelope is refused) |
| `pnpm soulmaker engine:sim:classify --report <f> \| --err-label <label>` | S100: simulation-failure classification into the S95 closed set (re-run by the real classifier before acceptance) |
| `pnpm soulmaker engine:sniper:score --input <f>` | S101: memecoin candidate scoring + ranking over a `sniper.score.input.v1` facts bundle (every component/score/verdict/ranking re-derived and the echoed facts cross-checked against the bundle before acceptance; a rejected risk stays rejected) |
| `pnpm rust:check` / `rust:build` / `rust:test` | Cargo passthroughs over the workspace |
| `pnpm rust:fmt` / `rust:fmt:check` / `rust:clippy` | Formatting + lints (clippy runs `-D warnings`) |

## Future hot paths (each its own sprint, each behind this boundary)

- **S98** realtime ingestion — DONE (replay normalization; live feed stays
  TypeScript by reviewed decision).
- **S99** quote routing/scoring — DONE (scoring intelligence over fetched
  quote artifacts; live fetching stays TypeScript by reviewed decision).
- **S100** transaction inspection + simulation classification — DONE (reads
  transaction *bytes* only; the Rust devnet send core was reviewed and
  DECLINED). The send path stays in TypeScript.
- **S101** memecoin candidate scoring + operator ranking — DONE (deterministic
  intelligence over a facts bundle; no network, no send, rejected risk stays
  rejected; live execution stays TypeScript and default-blocked).
- A Rust devnet/mainnet execution core remains DECLINED — only with a reviewed
  expansion of the safety boundary and scans on both sides (see the S101
  preconditions above).

Rust never becomes the source of truth for safety decisions: every artifact
crosses the bridge through the TypeScript validator first.
