//! Soulmaker Rust engine sidecar — read-only hot paths behind JSON IPC.
//!
//! Sprint 97 laid the foundation (status + IPC + schema parity); Sprint 98
//! added realtime REPLAY normalization; Sprint 99 added route-quote SCORING
//! intelligence; Sprint 100 added transaction envelope INSPECTION (decoding a
//! strictly-unsigned `txpreview.envelope.v1` into shape facts) and simulation
//! CLASSIFICATION parity (mapping a sim result onto the S95 closed set). Every
//! path consumes a TypeScript-produced/validated document over BOUNDED stdin,
//! and TypeScript re-validates everything the engine emits. Live feeds, live
//! fetching, signing, and sending all remain TypeScript: this crate still has
//! no network capability of any kind, and the S100 transaction work READS
//! bytes only.
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

pub mod base58;
pub mod base64;
pub mod ipc;
pub mod iso8601;
pub mod label_safety;
pub mod mint;
pub mod quote_score;
pub mod realtime;
pub mod safety;
pub mod schema;
pub mod sim_classify;
pub mod status;
pub mod tx_inspect;

pub use quote_score::{score_fetch_report, QuoteScoreReport};
pub use realtime::{normalize_replay_events, RealtimeObservationsReport};
pub use sim_classify::{classify_document, SimClassificationReport};
pub use status::{build_status_report, StatusReport};
pub use tx_inspect::{inspect_envelope, TxInspectReport};
