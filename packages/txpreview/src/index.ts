/**
 * @soulmaker/txpreview — the UNSIGNED transaction preview boundary (Sprint 92).
 *
 * Implements the design in docs/PHASE6_DRY_RUN_BOUNDARY.md as a separately-reviewed package:
 * strictly-validated unsigned envelopes (any embedded signature refused) simulated through the
 * real Solana `simulateTransaction` with sigVerify:false + replaceRecentBlockhash:true, over a
 * seam that exposes NO send method. No signer, no key, no seed phrase, no sending — ever.
 */

export {
  TX_ENVELOPE_SCHEMA_VERSION,
  TX_ENVELOPE_NETWORKS,
  TX_ENVELOPE_MAX_BASE64_LENGTH,
  TxPreviewError,
  validateUnsignedTxEnvelope,
  deserializeUnsignedTransaction,
} from "./envelope.js";
export type { UnsignedTxEnvelope, TxEnvelopeNetwork } from "./envelope.js";

export {
  TX_SIMULATION_REPORT_SCHEMA_VERSION,
  TX_SIMULATION_REPORT_BANNER,
  TX_SIMULATION_OUTCOMES,
  TX_SIMULATION_CAVEATS,
  TX_SIMULATION_CLASSIFICATIONS,
  TX_SIMULATION_CLASSIFICATION_GUIDANCE,
  classifySimulationFailure,
  createTxPreviewRpc,
  simulateUnsignedEnvelope,
  formatTxSimulationReport,
} from "./simulate.js";
export type {
  TxSimulationOutcome,
  TxSimulationClassification,
  TxSimulationReport,
  TxSimulateRpcLike,
  TxPreviewRpc,
  SimulateUnsignedEnvelopeOptions,
} from "./simulate.js";

export { buildUnsignedSelfTransferProbe } from "./probe.js";
export type { SelfTransferProbeInput } from "./probe.js";
