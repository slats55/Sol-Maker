/**
 * @soulmaker/txbuilder — refusal-first unsigned swap transaction builder (Sprint 92).
 *
 * The transaction-construction capability class the dry-run boundary doc kept out of
 * @soulmaker/simulation — implemented as its own separately-reviewed package. Every build is
 * refusal-first over a CLOSED reason set; the only possible output is a strictly-validated
 * UNSIGNED txpreview envelope. No signer, no secret key, no sending.
 */

export {
  BUILD_REFUSAL_CODES,
  BUILD_PERMITTED_MODES,
  BUILD_REFUSAL_GUIDANCE,
  TOKEN2022_BUILD_BLOCKER_FLAG_IDS,
  evaluateBuildRefusals,
} from "./refusals.js";
export type { BuildRefusal, BuildRefusalCode, BuildRefusalGuidance, BuildSwapRequest } from "./refusals.js";

export {
  JUPITER_SWAP_BUILDER_ID,
  JUPITER_SWAP_BASE_URL,
  createJupiterSwapBuilder,
} from "./jupiter-swap.js";
export type {
  BuildSwapResult,
  BuiltQuoteFacts,
  SwapTransactionBuilder,
  JupiterSwapBuilderOptions,
  FetchLike,
} from "./jupiter-swap.js";

export {
  SUPPORTED_TX_VERSIONS,
  inspectUnsignedTransactionShape,
  evaluateTxShapeRefusals,
} from "./inspect.js";
export type { TxShapeFacts } from "./inspect.js";

export {
  TXBUILD_REPORT_SCHEMA_VERSION,
  TXBUILD_REPORT_BANNER,
  TXBUILD_REPORT_OUTCOMES,
  TXBUILD_REPORT_CAVEATS,
  composeTxBuildReport,
} from "./report.js";
export type { TxBuildReport, TxBuildReportOutcome, TxBuildReportRefusal, ComposeTxBuildReportInput } from "./report.js";
