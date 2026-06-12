//! Soulmaker Rust engine sidecar — FOUNDATION ONLY (Sprint 97).
//!
//! This crate exists so later sprints can move latency-sensitive READ paths
//! (realtime ingestion, quote scoring) into Rust behind the same artifact
//! discipline the TypeScript system already enforces. Today it can do exactly
//! three things: report its own status, speak JSON over stdout, and prove
//! schema parity with the TypeScript validator.
//!
//! What this crate can NEVER do (enforced by `tests/safety_scan.rs` and the
//! TypeScript-side capability scan in `packages/engine-bridge`):
//!   - sign anything
//!   - send any transaction
//!   - load a wallet, key, or seed phrase
//!   - open a network connection
//!
//! TypeScript remains the orchestrator and the validation authority: every
//! byte this engine emits is strictly validated on the TypeScript side before
//! anything reads it.

pub mod ipc;
pub mod safety;
pub mod schema;
pub mod status;

pub use status::{build_status_report, StatusReport};
