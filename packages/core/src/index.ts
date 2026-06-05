export {
  TRADING_MODES,
  capabilitiesFor,
  isLiveMode,
  describeMode,
} from "./modes.js";
export type { TradingMode, ModeCapabilities } from "./modes.js";

export {
  ConfigSchema,
  CapsSchema,
  LiveSchema,
  LoggingSchema,
  HARD_LIMITS,
} from "./config/schema.js";
export type { Config, Caps, LiveConfig } from "./config/schema.js";

export {
  loadConfig,
  ConfigError,
  DEFAULT_CONFIG_FILENAME,
} from "./config/load.js";
export type { LoadConfigOptions } from "./config/load.js";

export {
  evaluateLiveGate,
  assertLiveModeAllowed,
  LiveModeRefusedError,
  BURNER_RISK_ENV_FLAG,
} from "./live-gate.js";
export type { LiveGateResult } from "./live-gate.js";
