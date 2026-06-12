//! Schema identifiers for every artifact this engine can emit. One constant
//! per artifact; the TypeScript schema registry must know each id BEFORE a
//! release ships it (schema parity is a test on both sides).

/// The engine status artifact — the only schema the foundation sprint emits.
pub const ENGINE_STATUS_SCHEMA_VERSION: &str = "engine.status.report.v1";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_schema_id_is_stable() {
        assert_eq!(ENGINE_STATUS_SCHEMA_VERSION, "engine.status.report.v1");
    }
}
