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

## What Rust does now (S97)

- `crates/solmaker-engine` — a Cargo workspace member with exactly two
  dependencies (`serde`, `serde_json`; a tested allowlist refuses drift).
- `solmaker-engine status [--json] [--created-at <iso>]` — emits the
  `engine.status.report.v1` artifact: engine identity, build profile, rustc
  version (embedded at build time), IPC version, the CLOSED supported
  capability list (`status`, `json-ipc`, `schema-parity`), the explicit
  disabled list, and safety markers.
- Determinism: the engine reads **no clock and no environment variables**;
  `--created-at` is supplied by the TypeScript orchestrator, so identical
  invocations produce byte-identical output.

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
- The argument vocabulary is a CLOSED allowlist (`status`, `--json`,
  `--created-at <iso>`); anything secret-shaped, path-shaped, or
  metacharacter-bearing is refused before a process exists.
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
| `pnpm rust:check` / `rust:build` / `rust:test` | Cargo passthroughs over the workspace |
| `pnpm rust:fmt` / `rust:fmt:check` / `rust:clippy` | Formatting + lints (clippy runs `-D warnings`) |

## Future hot paths (each its own sprint, each behind this boundary)

- **S98** realtime ingestion: Rust candidate feed with parity tests against
  the TypeScript adapter's `realtime.candidates.snapshot.v1`.
- **S99** quote routing/scoring over operator-supplied/fetched quote
  artifacts.
- **S100** transaction simulate/devnet execution core — only with a reviewed
  expansion of the safety boundary and scans on both sides.

Rust never becomes the source of truth for safety decisions: every artifact
crosses the bridge through the TypeScript validator first.
