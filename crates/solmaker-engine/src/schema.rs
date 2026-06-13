//! Schema identifiers for every artifact this engine can emit. One constant
//! per artifact; the TypeScript schema registry must know each id BEFORE a
//! release ships it (schema parity is a test on both sides).

/// The engine status artifact (Sprint 97 foundation).
pub const ENGINE_STATUS_SCHEMA_VERSION: &str = "engine.status.report.v1";

/// Normalized replay candidate observations (Sprint 98 realtime hot path).
pub const ENGINE_REALTIME_OBSERVATIONS_SCHEMA_VERSION: &str =
    "engine.realtime.observations.report.v1";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_ids_are_stable() {
        assert_eq!(ENGINE_STATUS_SCHEMA_VERSION, "engine.status.report.v1");
        assert_eq!(
            ENGINE_REALTIME_OBSERVATIONS_SCHEMA_VERSION,
            "engine.realtime.observations.report.v1"
        );
    }
}
