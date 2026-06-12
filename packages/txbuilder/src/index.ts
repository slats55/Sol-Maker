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
  evaluateBuildRefusals,
} from "./refusals.js";
export type { BuildRefusal, BuildRefusalCode, BuildSwapRequest } from "./refusals.js";

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
