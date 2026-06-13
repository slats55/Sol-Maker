//! Soulmaker Rust engine sidecar — read-only hot paths behind JSON IPC.
//!
//! Sprint 97 laid the foundation (status + IPC + schema parity); Sprint 98
//! added realtime REPLAY normalization (an operator's replay events document
//! arrives over BOUNDED stdin and leaves as normalized candidate observations
//! that TypeScript validates and folds into the existing
//! `realtime.candidates.snapshot.v1`); Sprint 99 added route-quote SCORING
//! intelligence over a TypeScript-produced `routequote.fetch.report.v1`
//! (freshness semantics mirror the TypeScript evaluator and TypeScript
//! re-evaluates every entry). Live feeds and live fetching remain TypeScript:
//! this crate still has no network capability of any kind.
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
pub mod iso8601;
pub mod label_safety;
pub mod mint;
pub mod quote_score;
pub mod realtime;
pub mod safety;
pub mod schema;
pub mod status;

pub use quote_score::{score_fetch_report, QuoteScoreReport};
pub use realtime::{normalize_replay_events, RealtimeObservationsReport};
pub use status::{build_status_report, StatusReport};
