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
| `pnpm rust:check` / `rust:build` / `rust:test` | Cargo passthroughs over the workspace |
| `pnpm rust:fmt` / `rust:fmt:check` / `rust:clippy` | Formatting + lints (clippy runs `-D warnings`) |

## Future hot paths (each its own sprint, each behind this boundary)

- **S98** realtime ingestion — DONE (replay normalization; live feed stays
  TypeScript by reviewed decision).
- **S99** quote routing/scoring — DONE (scoring intelligence over fetched
  quote artifacts; live fetching stays TypeScript by reviewed decision).
- **S100** transaction simulate/devnet execution core — only with a reviewed
  expansion of the safety boundary and scans on both sides.

Rust never becomes the source of truth for safety decisions: every artifact
crosses the bridge through the TypeScript validator first.
