//! The JSON IPC contract between this sidecar and the TypeScript orchestrator.
//!
//! Contract (engine.ipc.v1):
//!   - The orchestrator invokes the engine binary with an argument ARRAY
//!     (never a shell string) and reads stdout to completion.
//!   - The engine writes EXACTLY ONE JSON document to stdout (pretty-printed,
//!     trailing newline) and nothing else; diagnostics go to stderr.
//!   - Every document carries a `schemaVersion` the TypeScript registry knows;
//!     the TypeScript side strictly validates before use and refuses unknown
//!     or malformed output. Rust output is never trusted unvalidated.
//!   - Determinism: the engine reads no clock and no environment; any
//!     timestamp is supplied by the orchestrator via `--created-at` so the
//!     same invocation always produces the same bytes.
//!   - Exit codes: 0 = the report was produced; 2 = the invocation was
//!     refused (unknown command / malformed argument). There is no partial
//!     success.

/// Version label for the stdout JSON contract described above.
pub const IPC_VERSION: &str = "engine.ipc.v1";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_version_is_the_v1_label() {
        assert_eq!(IPC_VERSION, "engine.ipc.v1");
    }
}
