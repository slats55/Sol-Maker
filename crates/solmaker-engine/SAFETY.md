# solmaker-engine — safety boundary

This crate is the Rust **read-only sidecar** (Sprint 97 foundation, Sprint 98
realtime replay hot path). TypeScript remains the orchestrator and the
validation authority. This document states what the engine cannot do and how
that is enforced.

## What this crate CANNOT do

- **Sign anything.** There is no signer, no key type, no crypto dependency.
- **Send anything.** There is no RPC client, no send path, no transaction type.
- **Load wallet/key material.** No keypair file reading, no seed-phrase
  handling, no environment-variable secrets. The engine reads **no**
  environment variables at all.
- **Touch the network.** No HTTP client, no websocket, no socket API.
- **Read the filesystem.** Replay input arrives over BOUNDED stdin (2 MiB
  ceiling), never via a path argument — the engine opens no files.
- **Spawn processes.** `build.rs` runs `rustc --version` at build time; the
  shipped binary spawns nothing.
- **Read a clock.** Timestamps come from the orchestrator (`--created-at`),
  so identical invocations are byte-identical.

## What this crate CAN do

- `solmaker-engine status [--json] [--created-at <iso>]` — emit the
  `engine.status.report.v1` artifact describing exactly this posture (S97).
- `solmaker-engine realtime-normalize [--json] [--created-at <iso>]` — read
  ONE replay events JSON document from bounded stdin and emit
  `engine.realtime.observations.report.v1`: normalized candidate observations
  mirroring the TypeScript replay adapter field by field (S98). Replay data is
  labeled replay on every observation; a malformed document is refused with
  exit 2.

## S98 network-capability review (decision: NO network)

Sprint 98's realtime slice explicitly reviewed whether the engine should gain
a live feed adapter. **Decision: no.** The dual-side capability scans forbid
every network-shaped token; weakening that load-bearing wall for an optional
slice failed the low-risk bar. Live ingestion remains TypeScript
(`packages/realtime`); the engine normalizes REPLAY files only. The single new
input channel is bounded stdin — content never rides in argv, error messages
carry indexes/lengths but never input values, and secret-shaped labels are
dropped by the engine then independently re-checked (and refused, never
repaired) by the TypeScript validator.

## How the boundary is enforced

1. **Rust-side scan** (`tests/safety_scan.rs`): fails the build's test gate if
   any signer/key/send/subprocess/network-shaped token appears in `src/`, or
   if the dependency list drifts from the reviewed allowlist
   (`serde`, `serde_json`).
2. **TypeScript-side scan** (`packages/engine-bridge`): the same forbidden
   tokens are scanned from the TypeScript test suite, so the wall holds even
   on machines without a Rust toolchain.
3. **Strict validation at the boundary**: TypeScript validates every byte the
   engine emits against a CLOSED schema before anything reads it. Unknown
   fields, missing disabled-markers, or a `signerSupport` other than
   `"disabled"` refuse the artifact.
4. **No CLI surface**: the engine has no command that takes a key, wallet,
   URL, or RPC endpoint.

## Changing this boundary

Enabling any disabled capability requires: a sprint-reviewed design doc, code
changes on BOTH sides of the scan, schema registry updates, and a new safety
review. There is no flag, environment variable, or config file that can flip
any of it at runtime.
