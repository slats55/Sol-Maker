//! Schema identifiers for every artifact this engine can emit. One constant
//! per artifact; the TypeScript schema registry must know each id BEFORE a
//! release ships it (schema parity is a test on both sides).

/// The engine status artifact (Sprint 97 foundation).
pub const ENGINE_STATUS_SCHEMA_VERSION: &str = "engine.status.report.v1";

/// Normalized replay candidate observations (Sprint 98 realtime hot path).
pub const ENGINE_REALTIME_OBSERVATIONS_SCHEMA_VERSION: &str =
    "engine.realtime.observations.report.v1";

/// Route-quote scoring intelligence (Sprint 99 quote/router hot path).
pub const ENGINE_ROUTEQUOTE_SCORE_SCHEMA_VERSION: &str = "engine.routequote.score.report.v1";

/// Transaction envelope shape inspection (Sprint 100).
pub const ENGINE_TX_INSPECT_SCHEMA_VERSION: &str = "engine.tx.inspect.report.v1";

/// Simulation-failure classification parity (Sprint 100).
pub const ENGINE_SIM_CLASSIFICATION_SCHEMA_VERSION: &str = "engine.sim.classification.report.v1";

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
        assert_eq!(
            ENGINE_ROUTEQUOTE_SCORE_SCHEMA_VERSION,
            "engine.routequote.score.report.v1"
        );
        assert_eq!(
            ENGINE_TX_INSPECT_SCHEMA_VERSION,
            "engine.tx.inspect.report.v1"
        );
        assert_eq!(
            ENGINE_SIM_CLASSIFICATION_SCHEMA_VERSION,
            "engine.sim.classification.report.v1"
        );
    }
}
