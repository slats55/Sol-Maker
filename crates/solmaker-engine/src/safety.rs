//! The engine's safety posture as DATA, so the status artifact states it and
//! both test suites (Rust and TypeScript) can pin it. These are constants on
//! purpose: there is no configuration, flag, or environment variable that can
//! flip any of them — enabling a capability requires a code change that the
//! capability scans on both sides are built to catch.

/// The only safety mode the foundation engine has.
pub const SAFETY_MODE: &str = "sidecar-read-only";

/// Everything the engine CAN do today. Alphabetical for determinism.
/// `realtime-replay-normalize` (Sprint 98) is replay-FILE normalization over
/// bounded stdin — it adds no network, filesystem, clock, or env capability.
pub const SUPPORTED_CAPABILITIES: [&str; 4] = [
    "json-ipc",
    "realtime-replay-normalize",
    "schema-parity",
    "status",
];

/// Everything the engine explicitly CANNOT do. Alphabetical for determinism.
pub const DISABLED_CAPABILITIES: [&str; 5] = [
    "mainnet-live",
    "seed-phrase-handling",
    "sending",
    "signing",
    "wallet-loading",
];

/// Signer support marker. Always `disabled`; there is no signer code to enable.
pub const SIGNER_SUPPORT: &str = "disabled";

/// Send support marker. Always `disabled`; there is no send code to enable.
pub const SEND_SUPPORT: &str = "disabled";

/// Mainnet send support marker. Always `disabled`; doubly so — there is no
/// send code AND no network code.
pub const MAINNET_SEND_SUPPORT: &str = "disabled";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_execution_marker_is_disabled() {
        assert_eq!(SIGNER_SUPPORT, "disabled");
        assert_eq!(SEND_SUPPORT, "disabled");
        assert_eq!(MAINNET_SEND_SUPPORT, "disabled");
    }

    #[test]
    fn capability_lists_are_sorted_and_disjoint() {
        let mut supported = SUPPORTED_CAPABILITIES.to_vec();
        supported.sort_unstable();
        assert_eq!(supported, SUPPORTED_CAPABILITIES.to_vec());
        let mut disabled = DISABLED_CAPABILITIES.to_vec();
        disabled.sort_unstable();
        assert_eq!(disabled, DISABLED_CAPABILITIES.to_vec());
        for cap in SUPPORTED_CAPABILITIES {
            assert!(!DISABLED_CAPABILITIES.contains(&cap));
        }
    }

    #[test]
    fn no_execution_shaped_capability_is_supported() {
        for cap in SUPPORTED_CAPABILITIES {
            for forbidden in [
                "sign", "send", "wallet", "seed", "mainnet", "execute", "trade",
            ] {
                assert!(
                    !cap.contains(forbidden),
                    "supported capability {cap:?} looks execution-shaped ({forbidden:?})"
                );
            }
        }
    }
}
