# solmaker-engine — safety boundary

This crate is the Rust **sidecar foundation** (Sprint 97). TypeScript remains
the orchestrator and the validation authority. This document states what the
engine cannot do and how that is enforced.

## What this crate CANNOT do

- **Sign anything.** There is no signer, no key type, no crypto dependency.
- **Send anything.** There is no RPC client, no send path, no transaction type.
- **Load wallet/key material.** No keypair file reading, no seed-phrase
  handling, no environment-variable secrets. The engine reads **no**
  environment variables at all.
- **Touch the network.** No HTTP client, no websocket, no socket API.
- **Spawn processes.** `build.rs` runs `rustc --version` at build time; the
  shipped binary spawns nothing.
- **Read a clock.** Timestamps come from the orchestrator (`--created-at`),
  so identical invocations are byte-identical.

## What this crate CAN do (Sprint 97)

- `solmaker-engine status [--json] [--created-at <iso>]` — emit the
  `engine.status.report.v1` artifact describing exactly this posture.

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
